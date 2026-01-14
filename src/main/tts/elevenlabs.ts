/**
 * Nova Desktop - ElevenLabs TTS Provider
 * Text-to-Speech integration using ElevenLabs API with streaming support
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
} from '../../shared/types/tts';

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
 * ElevenLabs TTS Provider
 * Implements streaming text-to-speech with speech queue and barge-in support
 */
export class ElevenLabsTTS extends EventEmitter implements TTSProvider {
  readonly name = 'elevenlabs';
  private _status: TTSStatus = TTSStatus.IDLE;
  private config: TTSConfig;
  private speechQueue: SpeechQueueItem[] = [];
  private abortController: AbortController | null = null;
  private isProcessingQueue = false;
  private isPaused = false;
  private currentSpeechId: string | null = null;

  constructor(config: Partial<TTSConfig> = {}) {
    super();
    this.config = { ...DEFAULT_TTS_CONFIG, ...config } as TTSConfig;

    if (!this.config.apiKey) {
      throw new Error(
        'ElevenLabs API key is required. Set ELEVENLABS_API_KEY in your environment or pass it in the configuration.'
      );
    }

    logger.info('ElevenLabsTTS initialized', {
      voiceId: this.config.voiceId,
      modelId: this.config.modelId,
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
   */
  private buildBody(text: string): Record<string, unknown> {
    return {
      text,
      model_id: this.config.modelId,
      voice_settings: {
        stability: this.config.stability,
        similarity_boost: this.config.similarityBoost,
        style: this.config.style,
        use_speaker_boost: this.config.useSpeakerBoost,
      },
    };
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
      const audio = Buffer.from(arrayBuffer);

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
   */
  async *synthesizeStream(text: string): AsyncGenerator<TTSAudioChunk> {
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
      });

      this.abortController = new AbortController();

      const timeoutId = setTimeout(() => {
        this.abortController?.abort();
      }, this.config.timeout);

      const response = await fetch(this.buildUrl(true), {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify(this.buildBody(text)),
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
    if (!this.isProcessingQueue) {
      await this.processQueue();
    }
  }

  /**
   * Process the speech queue
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessingQueue || this.isPaused) {
      return;
    }

    this.isProcessingQueue = true;

    while (this.speechQueue.length > 0 && !this.isPaused) {
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
    logger.info('Configuration updated', {
      voiceId: this.config.voiceId,
      modelId: this.config.modelId,
    });
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
