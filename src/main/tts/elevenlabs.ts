/**
 * Atlas Desktop - ElevenLabs TTS Provider
 * Text-to-Speech integration using ElevenLabs API with streaming support
 * Includes speed/pitch control via audio processing
 */

import { EventEmitter } from 'events';
import { createModuleLogger, PerformanceTimer } from '../utils/logger';
import { APIError, withRetry } from '../utils/errors';
import {
  TTSProvider,
  TTSConfig,
  TTSStatus,
  TTSEvents,
  TTSAudioChunk,
  TTSSynthesisResult,
  SpeechQueueItem,
  DEFAULT_TTS_CONFIG,
  VoiceSettings,
  DEFAULT_VOICE_SETTINGS,
  validateVoiceSettings,
} from '../../shared/types/tts';
import type { DynamicVoiceSettings } from '../voice/emotion-to-voice-mapper';

const logger = createModuleLogger('ElevenLabsTTS');
const perfTimer = new PerformanceTimer('ElevenLabsTTS');

/**
 * ElevenLabs API endpoints
 */
const ELEVENLABS_BASE_URL = 'https://api.elevenlabs.io/v1';

/**
 * Audio format configurations
 */
const AUDIO_FORMATS = {
  mp3_44100_128: { mimeType: 'audio/mpeg', sampleRate: 44100, bytesPerSecond: 16000 },
  mp3_22050_32: { mimeType: 'audio/mpeg', sampleRate: 22050, bytesPerSecond: 4000 },
  pcm_16000: { mimeType: 'audio/pcm', sampleRate: 16000, bytesPerSecond: 32000 },
  pcm_22050: { mimeType: 'audio/pcm', sampleRate: 22050, bytesPerSecond: 44100 },
  pcm_24000: { mimeType: 'audio/pcm', sampleRate: 24000, bytesPerSecond: 48000 },
  pcm_44100: { mimeType: 'audio/pcm', sampleRate: 44100, bytesPerSecond: 88200 },
} as const;

/**
 * Generate a unique ID
 */
function generateId(): string {
  return `tts_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Audio processor for speed and pitch adjustment
 * Uses simple time-domain processing suitable for real-time audio
 */
class AudioProcessor {
  /**
   * Apply speed change to PCM audio data
   * Uses linear interpolation for time stretching/compression
   * @param audioData - Raw PCM audio buffer (16-bit signed)
   * @param speed - Speed multiplier (0.5 to 2.0)
   * @param sampleRate - Audio sample rate
   * @returns Processed audio buffer
   */
  static applySpeed(audioData: Buffer, speed: number, _sampleRate: number): Buffer {
    if (speed === 1.0) return audioData;

    const numSamples = audioData.length / 2; // 16-bit = 2 bytes per sample
    const newLength = Math.floor(numSamples / speed);
    const output = Buffer.alloc(newLength * 2);

    for (let i = 0; i < newLength; i++) {
      const srcIndex = i * speed;
      const srcIndexInt = Math.floor(srcIndex);
      const frac = srcIndex - srcIndexInt;

      // Linear interpolation
      const sample1 = audioData.readInt16LE(srcIndexInt * 2);
      const sample2Index = Math.min(srcIndexInt + 1, numSamples - 1);
      const sample2 = audioData.readInt16LE(sample2Index * 2);

      const interpolated = Math.round(sample1 + frac * (sample2 - sample1));
      output.writeInt16LE(Math.max(-32768, Math.min(32767, interpolated)), i * 2);
    }

    return output;
  }

  /**
   * Apply pitch shift to PCM audio data
   * Uses a simple resampling approach combined with speed adjustment
   * to maintain original duration while changing pitch
   * @param audioData - Raw PCM audio buffer (16-bit signed)
   * @param semitones - Pitch shift in semitones (-12 to +12)
   * @param sampleRate - Audio sample rate
   * @returns Processed audio buffer
   */
  static applyPitch(audioData: Buffer, semitones: number, sampleRate: number): Buffer {
    if (semitones === 0) return audioData;

    // Pitch shift factor: 2^(semitones/12)
    const pitchFactor = Math.pow(2, semitones / 12);

    // Step 1: Resample to change pitch (this also changes speed)
    const numSamples = audioData.length / 2;
    const resampledLength = Math.floor(numSamples / pitchFactor);
    const resampled = Buffer.alloc(resampledLength * 2);

    for (let i = 0; i < resampledLength; i++) {
      const srcIndex = i * pitchFactor;
      const srcIndexInt = Math.floor(srcIndex);
      const frac = srcIndex - srcIndexInt;

      const sample1 = audioData.readInt16LE(Math.min(srcIndexInt, numSamples - 1) * 2);
      const sample2 = audioData.readInt16LE(Math.min(srcIndexInt + 1, numSamples - 1) * 2);

      const interpolated = Math.round(sample1 + frac * (sample2 - sample1));
      resampled.writeInt16LE(Math.max(-32768, Math.min(32767, interpolated)), i * 2);
    }

    // Step 2: Time stretch back to original duration
    // This uses WSOLA-lite (overlap-add without pitch preservation)
    return this.timeStretch(resampled, pitchFactor, sampleRate);
  }

  /**
   * Time stretch audio to restore original duration after pitch shift
   * Uses simple overlap-add for efficiency
   */
  private static timeStretch(audioData: Buffer, factor: number, sampleRate: number): Buffer {
    if (factor === 1.0) return audioData;

    const numSamples = audioData.length / 2;
    const targetLength = Math.floor(numSamples * factor);
    const output = Buffer.alloc(targetLength * 2);

    // Window size for overlap-add (20ms)
    const windowSize = Math.floor(sampleRate * 0.02);
    const hopSize = Math.floor(windowSize / 2);

    let outPos = 0;
    let inPos = 0;
    const synthesis = new Float32Array(targetLength);

    while (outPos < targetLength && inPos < numSamples - windowSize) {
      // Apply Hanning window and overlap-add
      for (let i = 0; i < windowSize && outPos + i < targetLength; i++) {
        const window = 0.5 * (1 - Math.cos((2 * Math.PI * i) / windowSize));
        const sampleIdx = Math.min(inPos + i, numSamples - 1);
        const sample = audioData.readInt16LE(sampleIdx * 2) / 32768.0;
        synthesis[outPos + i] += sample * window;
      }

      outPos += Math.floor(hopSize * factor);
      inPos += hopSize;
    }

    // Convert back to 16-bit PCM
    for (let i = 0; i < targetLength; i++) {
      const sample = Math.max(-1, Math.min(1, synthesis[i]));
      output.writeInt16LE(Math.round(sample * 32767), i * 2);
    }

    return output;
  }

  /**
   * Apply both speed and pitch adjustments
   * @param audioData - Raw PCM audio buffer
   * @param settings - Voice settings with speed and pitch
   * @param sampleRate - Audio sample rate
   * @returns Processed audio buffer
   */
  static applyVoiceSettings(
    audioData: Buffer,
    settings: VoiceSettings,
    sampleRate: number
  ): Buffer {
    let processed = audioData;

    // Apply pitch first (affects duration, then compensated)
    if (settings.pitch !== 0) {
      processed = this.applyPitch(processed, settings.pitch, sampleRate);
    }

    // Apply speed (simple time stretch/compress)
    if (settings.speed !== 1.0) {
      processed = this.applySpeed(processed, settings.speed, sampleRate);
    }

    return processed;
  }
}

/**
 * ElevenLabs TTS Provider
 * Implements streaming text-to-speech with speech queue and barge-in support
 * Supports speed/pitch customization via audio post-processing
 */
export class ElevenLabsTTS extends EventEmitter implements TTSProvider {
  readonly name = 'elevenlabs';
  private _status: TTSStatus = TTSStatus.IDLE;
  private config: TTSConfig;
  private voiceSettings: VoiceSettings;
  private dynamicSettings: DynamicVoiceSettings | null = null; // For emotion-based voice
  private speechQueue: SpeechQueueItem[] = [];
  private abortController: AbortController | null = null;
  private isProcessingQueue = false;
  private isPaused = false;
  private currentSpeechId: string | null = null;
  private isStopping = false; // Prevent race conditions during stop

  constructor(config: Partial<TTSConfig> = {}) {
    super();
    this.setMaxListeners(20); // Prevent memory leak warnings
    this.config = { ...DEFAULT_TTS_CONFIG, ...config } as TTSConfig;
    this.voiceSettings = validateVoiceSettings(config.voiceSettings || DEFAULT_VOICE_SETTINGS);

    if (!this.config.apiKey) {
      throw new Error(
        'ElevenLabs API key is required. Set ELEVENLABS_API_KEY in your environment or pass it in the configuration.'
      );
    }

    logger.info('ElevenLabsTTS initialized', {
      voiceId: this.config.voiceId,
      modelId: this.config.modelId,
      voiceSettings: this.voiceSettings,
    });
  }

  /**
   * Get current status
   */
  get status(): TTSStatus {
    return this._status;
  }

  /**
   * Set status and emit event
   */
  private setStatus(status: TTSStatus): void {
    if (this._status !== status) {
      const previousStatus = this._status;
      this._status = status;
      logger.debug('Status changed', { from: previousStatus, to: status });
      this.emit('status', status);
    }
  }

  /**
   * Build request URL for text-to-speech
   */
  private buildUrl(streaming = true): string {
    const voiceId = this.config.voiceId;
    const endpoint = streaming ? 'stream' : '';
    return `${ELEVENLABS_BASE_URL}/text-to-speech/${voiceId}${endpoint ? '/' + endpoint : ''}`;
  }

  /**
   * Build request headers
   */
  private buildHeaders(): Record<string, string> {
    return {
      Accept: AUDIO_FORMATS[this.config.outputFormat!].mimeType,
      'Content-Type': 'application/json',
      'xi-api-key': this.config.apiKey,
    };
  }

  /**
   * Build request body
   * @param text - Text to synthesize
   * @param optimizeLatency - When true, optimizes for faster first chunk delivery
   */
  private buildBody(text: string, optimizeLatency = false): Record<string, unknown> {
    // Use dynamic settings if available, otherwise fall back to config
    const stability = this.dynamicSettings?.stability ?? this.config.stability;
    const similarityBoost = this.dynamicSettings?.similarityBoost ?? this.config.similarityBoost;
    const style = this.dynamicSettings?.style ?? this.config.style;
    const useSpeakerBoost = this.dynamicSettings?.useSpeakerBoost ?? this.config.useSpeakerBoost;

    const body: Record<string, unknown> = {
      text,
      model_id: this.config.modelId,
      voice_settings: {
        stability,
        similarity_boost: similarityBoost,
        style,
        use_speaker_boost: useSpeakerBoost,
      },
    };

    // For low-latency streaming, use optimize_streaming_latency option
    // This tells ElevenLabs to prioritize speed over quality for first chunks
    if (optimizeLatency) {
      body.optimize_streaming_latency = 3; // Max latency optimization (0-4 scale)
    }

    return body;
  }

  /**
   * Estimate audio duration from buffer size
   */
  private estimateDuration(bufferSize: number): number {
    const format = this.config.outputFormat!;
    const bytesPerSecond = AUDIO_FORMATS[format].bytesPerSecond;
    return Math.round((bufferSize / bytesPerSecond) * 1000);
  }

  /**
   * Synthesize text to speech (returns full audio buffer)
   */
  async synthesize(text: string): Promise<TTSSynthesisResult> {
    this.setStatus(TTSStatus.SYNTHESIZING);
    perfTimer.start('synthesize');

    const startTime = Date.now();

    try {
      logger.debug('Synthesizing text', {
        length: text.length,
        voiceId: this.config.voiceId,
      });

      const response = await withRetry(
        async () => {
          this.abortController = new AbortController();

          const timeoutId = setTimeout(() => {
            this.abortController?.abort();
          }, this.config.timeout);

          try {
            const res = await fetch(this.buildUrl(false), {
              method: 'POST',
              headers: this.buildHeaders(),
              body: JSON.stringify(this.buildBody(text)),
              signal: this.abortController.signal,
            });

            clearTimeout(timeoutId);

            if (!res.ok) {
              const errorData = await res.text();
              throw new Error(
                `ElevenLabs API returned an error (${res.status}): ${errorData}. Check your API key and voice settings.`
              );
            }

            return res;
          } catch (error) {
            clearTimeout(timeoutId);
            throw error;
          }
        },
        {
          maxAttempts: 3,
          initialDelayMs: 1000,
          onRetry: (attempt, error) => {
            logger.warn(`Synthesis attempt ${attempt} failed`, { error: error.message });
          },
        }
      );

      const arrayBuffer = await response.arrayBuffer();
      let audio = Buffer.from(arrayBuffer);

      // Apply voice settings (speed/pitch) if needed
      const processedAudio = this.processAudioWithSettings(audio, this.config.outputFormat!);
      audio = processedAudio;

      const latency = Date.now() - startTime;
      perfTimer.end('synthesize');

      const result: TTSSynthesisResult = {
        audio,
        format: this.config.outputFormat!,
        duration: this.estimateDuration(audio.length),
        characterCount: text.length,
        latency,
      };

      logger.info('Synthesis complete', {
        latency,
        audioSize: audio.length,
        duration: result.duration,
        voiceSettings: this.voiceSettings,
      });

      this.setStatus(TTSStatus.IDLE);
      this.emit('synthesized', result);
      return result;
    } catch (error) {
      perfTimer.end('synthesize');
      this.setStatus(TTSStatus.ERROR);

      const apiError = new APIError(
        `ElevenLabs synthesis failed: ${(error as Error).message}`,
        'elevenlabs',
        undefined,
        { error: (error as Error).message }
      );

      logger.error('Synthesis failed', { error: (error as Error).message });
      this.emit('error', apiError);
      throw apiError;
    } finally {
      this.abortController = null;
    }
  }

  /**
   * Synthesize text with streaming (returns async generator)
   * @param text - Text to synthesize
   * @param optimizeLatency - When true, prioritizes first chunk speed over quality
   */
  async *synthesizeStream(text: string, optimizeLatency = true): AsyncGenerator<TTSAudioChunk> {
    this.setStatus(TTSStatus.SYNTHESIZING);
    perfTimer.start('synthesizeStream');

    const startTime = Date.now();
    let totalBytes = 0;
    let chunkCount = 0;
    let firstChunkReceived = false;

    try {
      logger.debug('Starting streaming synthesis', {
        length: text.length,
        voiceId: this.config.voiceId,
        optimizeLatency,
      });

      this.abortController = new AbortController();

      const timeoutId = setTimeout(() => {
        this.abortController?.abort();
      }, this.config.timeout);

      const response = await fetch(this.buildUrl(true), {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify(this.buildBody(text, optimizeLatency)),
        signal: this.abortController.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.text();
        throw new Error(
          `ElevenLabs streaming API returned an error (${response.status}): ${errorData}. Check your API key and voice settings.`
        );
      }

      if (!response.body) {
        throw new Error(
          'ElevenLabs streaming response body is empty. This may indicate a network issue.'
        );
      }

      const reader = response.body.getReader();

      try {
        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            break;
          }

          if (!firstChunkReceived) {
            firstChunkReceived = true;
            const timeToFirstChunk = Date.now() - startTime;
            logger.info('First chunk received', { timeToFirstChunk });
          }

          const chunk = Buffer.from(value);
          totalBytes += chunk.length;
          chunkCount++;

          const audioChunk: TTSAudioChunk = {
            data: chunk,
            format: this.config.outputFormat!,
            isFinal: false,
            duration: this.estimateDuration(chunk.length),
          };

          this.emit('chunk', audioChunk);
          yield audioChunk;
        }
      } finally {
        reader.releaseLock();
      }

      // Emit final chunk indicator
      const finalChunk: TTSAudioChunk = {
        data: Buffer.alloc(0),
        format: this.config.outputFormat!,
        isFinal: true,
        duration: 0,
      };

      this.emit('chunk', finalChunk);
      yield finalChunk;

      const latency = Date.now() - startTime;
      perfTimer.end('synthesizeStream');

      logger.info('Streaming synthesis complete', {
        latency,
        totalBytes,
        chunkCount,
        duration: this.estimateDuration(totalBytes),
      });

      this.setStatus(TTSStatus.IDLE);
    } catch (error) {
      perfTimer.end('synthesizeStream');

      // Check if it was cancelled
      if ((error as Error).name === 'AbortError') {
        logger.info('Streaming cancelled');
        this.setStatus(TTSStatus.IDLE);
        return;
      }

      this.setStatus(TTSStatus.ERROR);

      const apiError = new APIError(
        `ElevenLabs streaming failed: ${(error as Error).message}`,
        'elevenlabs',
        undefined,
        { error: (error as Error).message }
      );

      logger.error('Streaming failed', { error: (error as Error).message });
      this.emit('error', apiError);
      throw apiError;
    } finally {
      this.abortController = null;
    }
  }

  /**
   * Speak text (synthesize and emit for playback)
   * Adds to speech queue with priority
   */
  async speak(text: string, priority = 0): Promise<void> {
    // Don't queue new speech while stopping
    if (this.isStopping) {
      logger.debug('Ignoring speak request - currently stopping');
      return;
    }

    const item: SpeechQueueItem = {
      id: generateId(),
      text,
      priority,
      queuedAt: Date.now(),
      status: 'pending',
    };

    // Insert based on priority (higher priority first)
    const insertIndex = this.speechQueue.findIndex((q) => q.priority < priority);
    if (insertIndex === -1) {
      this.speechQueue.push(item);
    } else {
      this.speechQueue.splice(insertIndex, 0, item);
    }

    logger.debug('Added to speech queue', {
      id: item.id,
      priority,
      queueLength: this.speechQueue.length,
    });

    this.emit('queueUpdate', [...this.speechQueue]);

    // Start processing queue if not already
    if (!this.isProcessingQueue && !this.isStopping) {
      await this.processQueue();
    }
  }

  /**
   * Process the speech queue
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessingQueue || this.isPaused || this.isStopping) {
      return;
    }

    this.isProcessingQueue = true;

    while (this.speechQueue.length > 0 && !this.isPaused && !this.isStopping) {
      const item = this.speechQueue[0];

      if (item.status === 'cancelled') {
        this.speechQueue.shift();
        continue;
      }

      item.status = 'speaking';
      this.currentSpeechId = item.id;
      this.emit('queueUpdate', [...this.speechQueue]);

      try {
        this.setStatus(TTSStatus.PLAYING);
        this.emit('playbackStart');

        // Collect all audio chunks for this speech item
        const chunks: Buffer[] = [];
        let wasCancelled = false;

        for await (const chunk of this.synthesizeStream(item.text)) {
          // Check if cancelled (status may have been changed externally by stop())
          if ((item.status as string) === 'cancelled') {
            wasCancelled = true;
            break;
          }
          if (chunk.data.length > 0) {
            chunks.push(chunk.data);
          }
        }

        if (!wasCancelled && (item.status as string) !== 'cancelled') {
          item.status = 'completed';
          this.emit('playbackEnd');

          // Emit synthesized result
          const fullAudio = Buffer.concat(chunks);
          const result: TTSSynthesisResult = {
            audio: fullAudio,
            format: this.config.outputFormat!,
            duration: this.estimateDuration(fullAudio.length),
            characterCount: item.text.length,
          };
          this.emit('synthesized', result);
        }
      } catch (error) {
        logger.error('Speech queue item failed', {
          id: item.id,
          error: (error as Error).message,
        });
        item.status = 'cancelled';
      }

      this.speechQueue.shift();
      this.currentSpeechId = null;
      this.emit('queueUpdate', [...this.speechQueue]);
    }

    this.isProcessingQueue = false;

    if (this.speechQueue.length === 0) {
      this.setStatus(TTSStatus.IDLE);
    }
  }

  /**
   * Stop current speech and clear queue (barge-in)
   */
  stop(): void {
    logger.info('Stopping speech');

    // Set stopping flag FIRST to prevent race conditions
    this.isStopping = true;

    // Cancel current synthesis
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    // Cancel current speech item
    if (this.currentSpeechId) {
      const current = this.speechQueue.find((q) => q.id === this.currentSpeechId);
      if (current) {
        current.status = 'cancelled';
      }
    }

    // Clear queue
    this.speechQueue = [];
    this.currentSpeechId = null;
    this.isProcessingQueue = false;
    this.isPaused = false;

    this.setStatus(TTSStatus.IDLE);
    this.emit('interrupted');
    this.emit('queueUpdate', []);

    // Reset stopping flag after cleanup
    this.isStopping = false;
  }

  /**
   * Pause playback
   */
  pause(): void {
    if (this._status === TTSStatus.PLAYING || this._status === TTSStatus.SYNTHESIZING) {
      this.isPaused = true;
      this.setStatus(TTSStatus.PAUSED);
      logger.info('Speech paused');
    }
  }

  /**
   * Resume playback
   */
  resume(): void {
    if (this._status === TTSStatus.PAUSED) {
      this.isPaused = false;
      this.setStatus(TTSStatus.IDLE);
      logger.info('Speech resumed');

      // Continue processing queue
      this.processQueue();
    }
  }

  /**
   * Check if currently speaking
   */
  isSpeaking(): boolean {
    return (
      this._status === TTSStatus.PLAYING ||
      this._status === TTSStatus.SYNTHESIZING ||
      this.speechQueue.some((q) => q.status === 'speaking')
    );
  }

  /**
   * Get speech queue
   */
  getQueue(): SpeechQueueItem[] {
    return [...this.speechQueue];
  }

  /**
   * Clear speech queue (keeps current item)
   */
  clearQueue(): void {
    // Cancel all pending items
    this.speechQueue = this.speechQueue.filter((q) => q.status === 'speaking');
    this.emit('queueUpdate', [...this.speechQueue]);
    logger.info('Speech queue cleared');
  }

  /**
   * Get provider configuration
   */
  getConfig(): TTSConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<TTSConfig>): void {
    this.config = { ...this.config, ...config };

    // Update voice settings if provided
    if (config.voiceSettings) {
      this.setVoiceSettings(config.voiceSettings);
    }

    logger.info('Configuration updated', {
      voiceId: this.config.voiceId,
      modelId: this.config.modelId,
      voiceSettings: this.voiceSettings,
    });
  }

  /**
   * Get current voice settings (speed/pitch)
   */
  getVoiceSettings(): VoiceSettings {
    return { ...this.voiceSettings };
  }

  /**
   * Set voice settings (speed/pitch)
   * @param settings - Partial voice settings to update
   */
  setVoiceSettings(settings: Partial<VoiceSettings>): void {
    const newSettings = validateVoiceSettings({
      ...this.voiceSettings,
      ...settings,
    });

    const changed =
      newSettings.speed !== this.voiceSettings.speed ||
      newSettings.pitch !== this.voiceSettings.pitch;

    this.voiceSettings = newSettings;

    if (changed) {
      logger.info('Voice settings updated', { settings: this.voiceSettings });
      this.emit('voiceSettingsChanged', this.voiceSettings);
    }
  }

  /**
   * Reset voice settings to defaults
   */
  resetVoiceSettings(): void {
    this.setVoiceSettings(DEFAULT_VOICE_SETTINGS);
    logger.info('Voice settings reset to defaults');
  }

  /**
   * Set dynamic voice settings for emotion-based synthesis
   * These settings override the base config for the next synthesis calls
   * @param settings - Dynamic voice settings from EmotionToVoiceMapper
   */
  setDynamicVoiceSettings(settings: DynamicVoiceSettings | null): void {
    this.dynamicSettings = settings;
    
    // Also apply speed/pitch to voice settings for post-processing
    if (settings) {
      this.setVoiceSettings({
        speed: settings.speed,
        pitch: settings.pitch * 10, // Convert from -0.3..0.3 to semitones -3..3
      });
      
      logger.debug('Dynamic voice settings applied', {
        stability: settings.stability.toFixed(2),
        style: settings.style.toFixed(2),
        speed: settings.speed.toFixed(2),
      });
    } else {
      logger.debug('Dynamic voice settings cleared');
    }
  }

  /**
   * Get current dynamic voice settings
   */
  getDynamicVoiceSettings(): DynamicVoiceSettings | null {
    return this.dynamicSettings;
  }

  /**
   * Clear dynamic voice settings (revert to config defaults)
   */
  clearDynamicVoiceSettings(): void {
    this.dynamicSettings = null;
    this.resetVoiceSettings();
  }

  /**
   * Preview voice settings with a sample text
   * Speaks the text with current settings for user feedback
   * @param previewText - Optional text to preview (defaults to standard phrase)
   */
  async previewVoiceSettings(previewText?: string): Promise<void> {
    const text = previewText || 'This is how I will sound with the current voice settings.';
    this.emit('voiceSettingsPreview', this.voiceSettings, text);
    await this.speak(text, 10); // High priority for preview
  }

  /**
   * Adjust speed incrementally
   * @param delta - Amount to adjust (positive = faster, negative = slower)
   */
  adjustSpeed(delta: number): void {
    const { min, max, step } = { min: 0.5, max: 2.0, step: 0.1 };
    const newSpeed = this.voiceSettings.speed + delta * step;
    const clampedSpeed = Math.max(min, Math.min(max, Math.round(newSpeed * 10) / 10));
    this.setVoiceSettings({ speed: clampedSpeed });
  }

  /**
   * Adjust pitch incrementally
   * @param delta - Amount to adjust (positive = higher, negative = lower)
   */
  adjustPitch(delta: number): void {
    const { min, max, step } = { min: -12, max: 12, step: 1 };
    const newPitch = this.voiceSettings.pitch + delta * step;
    const clampedPitch = Math.max(min, Math.min(max, Math.round(newPitch)));
    this.setVoiceSettings({ pitch: clampedPitch });
  }

  /**
   * Check if voice settings need audio processing
   * (i.e., not at default values)
   */
  private needsAudioProcessing(): boolean {
    return this.voiceSettings.speed !== 1.0 || this.voiceSettings.pitch !== 0;
  }

  /**
   * Process audio buffer with current voice settings
   * Only applies processing for PCM formats; MP3 requires decoding first
   * @param audioBuffer - Raw audio buffer
   * @param format - Audio format string
   * @returns Processed audio buffer
   */
  private processAudioWithSettings(audioBuffer: Buffer, format: string): Buffer {
    if (!this.needsAudioProcessing()) {
      return audioBuffer;
    }

    // Only process PCM formats directly
    // MP3 would need decoding which is more complex
    if (!format.startsWith('pcm_')) {
      logger.debug('Skipping audio processing for non-PCM format', { format });
      return audioBuffer;
    }

    const sampleRate = AUDIO_FORMATS[format as keyof typeof AUDIO_FORMATS]?.sampleRate || 44100;

    try {
      const processed = AudioProcessor.applyVoiceSettings(
        audioBuffer,
        this.voiceSettings,
        sampleRate
      );
      logger.debug('Audio processed with voice settings', {
        originalSize: audioBuffer.length,
        processedSize: processed.length,
        settings: this.voiceSettings,
      });
      return processed;
    } catch (error) {
      logger.warn('Audio processing failed, returning original', {
        error: (error as Error).message,
      });
      return audioBuffer;
    }
  }

  /**
   * Get available voices from ElevenLabs API
   */
  async getVoices(): Promise<Array<{ voiceId: string; name: string; category: string }>> {
    try {
      const response = await fetch(`${ELEVENLABS_BASE_URL}/voices`, {
        headers: {
          'xi-api-key': this.config.apiKey,
        },
      });

      if (!response.ok) {
        throw new Error(
          `Failed to fetch ElevenLabs voices (${response.status}). Check your API key.`
        );
      }

      const data = (await response.json()) as {
        voices: Array<{
          voice_id: string;
          name: string;
          category: string;
        }>;
      };

      return data.voices.map((v) => ({
        voiceId: v.voice_id,
        name: v.name,
        category: v.category,
      }));
    } catch (error) {
      logger.error('Failed to fetch voices', { error: (error as Error).message });
      throw error;
    }
  }

  /**
   * Get user subscription info
   */
  async getSubscriptionInfo(): Promise<{
    characterCount: number;
    characterLimit: number;
    tier: string;
  }> {
    try {
      const response = await fetch(`${ELEVENLABS_BASE_URL}/user/subscription`, {
        headers: {
          'xi-api-key': this.config.apiKey,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch subscription: ${response.status}`);
      }

      const data = (await response.json()) as {
        character_count: number;
        character_limit: number;
        tier: string;
      };

      return {
        characterCount: data.character_count,
        characterLimit: data.character_limit,
        tier: data.tier,
      };
    } catch (error) {
      logger.error('Failed to fetch subscription info', { error: (error as Error).message });
      throw error;
    }
  }

  // Type-safe event emitter methods
  on<K extends keyof TTSEvents>(event: K, listener: TTSEvents[K]): this {
    return super.on(event, listener);
  }

  off<K extends keyof TTSEvents>(event: K, listener: TTSEvents[K]): this {
    return super.off(event, listener);
  }

  emit<K extends keyof TTSEvents>(event: K, ...args: Parameters<TTSEvents[K]>): boolean {
    return super.emit(event, ...args);
  }
}

/**
 * Create an ElevenLabsTTS instance with API key
 */
export function createElevenLabsTTS(apiKey: string, config?: Partial<TTSConfig>): ElevenLabsTTS {
  return new ElevenLabsTTS({ apiKey, ...config });
}

export default ElevenLabsTTS;
