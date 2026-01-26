/**
 * Atlas Desktop - Offline TTS Provider
 * Local text-to-speech using Piper (neural TTS) with espeak fallback
 * Provides offline speech synthesis when ElevenLabs is unavailable
 * Supports speed/pitch customization via native TTS parameters
 */

import { EventEmitter } from 'events';
import { spawn, ChildProcess } from 'child_process';
import { existsSync, mkdirSync, createWriteStream } from 'fs';
import { join } from 'path';
import { app } from 'electron';
import { createModuleLogger, PerformanceTimer } from '../utils/logger';
import {
  TTSProvider,
  TTSConfig,
  TTSStatus,
  TTSEvents,
  TTSAudioChunk,
  TTSSynthesisResult,
  SpeechQueueItem,
  VoiceSettings,
  DEFAULT_VOICE_SETTINGS,
  validateVoiceSettings,
} from '../../shared/types/tts';

const logger = createModuleLogger('OfflineTTS');
const perfTimer = new PerformanceTimer('OfflineTTS');

/**
 * Piper voice model information
 */
export interface PiperVoice {
  id: string;
  name: string;
  language: string;
  quality: 'low' | 'medium' | 'high';
  sampleRate: number;
  downloadUrl: string;
  configUrl: string;
  size: number; // MB
}

/**
 * Available Piper voices
 */
export const PIPER_VOICES: Record<string, PiperVoice> = {
  // English voices
  'en_US-amy-medium': {
    id: 'en_US-amy-medium',
    name: 'Amy (US English)',
    language: 'en_US',
    quality: 'medium',
    sampleRate: 22050,
    downloadUrl:
      'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/amy/medium/en_US-amy-medium.onnx',
    configUrl:
      'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/amy/medium/en_US-amy-medium.onnx.json',
    size: 63,
  },
  'en_US-lessac-medium': {
    id: 'en_US-lessac-medium',
    name: 'Lessac (US English)',
    language: 'en_US',
    quality: 'medium',
    sampleRate: 22050,
    downloadUrl:
      'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/medium/en_US-lessac-medium.onnx',
    configUrl:
      'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json',
    size: 63,
  },
  'en_GB-alba-medium': {
    id: 'en_GB-alba-medium',
    name: 'Alba (British English)',
    language: 'en_GB',
    quality: 'medium',
    sampleRate: 22050,
    downloadUrl:
      'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_GB/alba/medium/en_GB-alba-medium.onnx',
    configUrl:
      'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_GB/alba/medium/en_GB-alba-medium.onnx.json',
    size: 63,
  },
};

/**
 * Default Piper voice
 */
export const DEFAULT_PIPER_VOICE = 'en_US-amy-medium';

/**
 * Offline TTS configuration
 */
export interface OfflineTTSConfig {
  /** Voice model ID */
  voiceId?: string;
  /** Path to Piper executable */
  piperPath?: string;
  /** Path to voice models directory */
  modelsPath?: string;
  /** Output sample rate */
  sampleRate?: number;
  /** Speaking rate (0.5 - 2.0) - deprecated, use voiceSettings.speed */
  speakingRate?: number;
  /** Use espeak as fallback if Piper unavailable */
  useEspeakFallback?: boolean;
  /** Voice settings (speed/pitch) */
  voiceSettings?: VoiceSettings;
}

/**
 * Default offline TTS configuration
 */
const DEFAULT_OFFLINE_TTS_CONFIG: OfflineTTSConfig = {
  voiceId: DEFAULT_PIPER_VOICE,
  sampleRate: 22050,
  speakingRate: 1.0,
  useEspeakFallback: true,
  voiceSettings: DEFAULT_VOICE_SETTINGS,
};

/**
 * Generate a unique ID
 */
function generateId(): string {
  return `tts_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Get default paths based on platform
 */
function getDefaultPaths(): { piperPath: string; modelsPath: string } {
  const userDataPath =
    app?.getPath?.('userData') || join(process.env.HOME || process.env.USERPROFILE || '.', '.atlas');
  const modelsPath = join(userDataPath, 'models', 'piper');

  // Platform-specific Piper executable
  const platform = process.platform;
  let piperExecutable = 'piper';
  if (platform === 'win32') {
    piperExecutable = 'piper.exe';
  }

  return {
    piperPath: join(userDataPath, 'bin', piperExecutable),
    modelsPath,
  };
}

/**
 * Offline TTS Provider
 * Uses Piper for high-quality local neural TTS with espeak fallback
 * Supports speed/pitch customization via native TTS parameters and audio processing
 */
export class OfflineTTS extends EventEmitter implements TTSProvider {
  readonly name = 'offline';
  private _status: TTSStatus = TTSStatus.IDLE;
  private config: OfflineTTSConfig;
  private voiceSettings: VoiceSettings;
  private speechQueue: SpeechQueueItem[] = [];
  private currentProcess: ChildProcess | null = null;
  private isProcessingQueue = false;
  private isPaused = false;
  private currentSpeechId: string | null = null;
  private piperAvailable: boolean | null = null;
  private espeakAvailable: boolean | null = null;

  constructor(config: Partial<OfflineTTSConfig> = {}) {
    super();
    const defaults = getDefaultPaths();
    this.config = {
      ...DEFAULT_OFFLINE_TTS_CONFIG,
      piperPath: defaults.piperPath,
      modelsPath: defaults.modelsPath,
      ...config,
    };

    // Initialize voice settings from config or use defaults
    this.voiceSettings = validateVoiceSettings(
      config.voiceSettings || DEFAULT_VOICE_SETTINGS
    );

    // Sync speakingRate with voice settings speed for backward compatibility
    if (config.speakingRate && !config.voiceSettings) {
      this.voiceSettings.speed = Math.max(0.5, Math.min(2.0, config.speakingRate));
    }

    // Ensure models directory exists
    if (this.config.modelsPath && !existsSync(this.config.modelsPath)) {
      mkdirSync(this.config.modelsPath, { recursive: true });
    }

    logger.info('OfflineTTS initialized', {
      voiceId: this.config.voiceId,
      modelsPath: this.config.modelsPath,
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
   * Check if Piper is available
   */
  async isPiperAvailable(): Promise<boolean> {
    if (this.piperAvailable !== null) {
      return this.piperAvailable;
    }

    try {
      // Check if piper executable exists
      if (!existsSync(this.config.piperPath!)) {
        logger.info('Piper executable not found', { path: this.config.piperPath });
        this.piperAvailable = false;
        return false;
      }

      // Try to run piper --help
      const result = await new Promise<boolean>((resolve) => {
        const proc = spawn(this.config.piperPath!, ['--help'], {
          timeout: 5000,
        });

        proc.on('close', (code) => {
          resolve(code === 0);
        });

        proc.on('error', () => {
          resolve(false);
        });
      });

      this.piperAvailable = result;
      logger.info('Piper availability', { available: result });
      return result;
    } catch (error) {
      logger.debug('Piper availability check failed', { error: (error as Error).message });
      this.piperAvailable = false;
      return false;
    }
  }

  /**
   * Check if espeak is available
   */
  async isEspeakAvailable(): Promise<boolean> {
    if (this.espeakAvailable !== null) {
      return this.espeakAvailable;
    }

    try {
      const espeakCmd = process.platform === 'win32' ? 'espeak-ng' : 'espeak-ng';

      const result = await new Promise<boolean>((resolve) => {
        const proc = spawn(espeakCmd, ['--version'], {
          timeout: 5000,
          shell: true,
        });

        proc.on('close', (code) => {
          resolve(code === 0);
        });

        proc.on('error', () => {
          resolve(false);
        });
      });

      this.espeakAvailable = result;
      logger.info('espeak-ng availability', { available: result });
      return result;
    } catch (error) {
      logger.debug('espeak-ng availability check failed', { error: (error as Error).message });
      this.espeakAvailable = false;
      return false;
    }
  }

  /**
   * Check if Windows SAPI is available (Windows only)
   */
  private sapiAvailable: boolean | null = null;
  async isSapiAvailable(): Promise<boolean> {
    if (this.sapiAvailable !== null) {
      return this.sapiAvailable;
    }

    // Only available on Windows
    if (process.platform !== 'win32') {
      this.sapiAvailable = false;
      return false;
    }

    try {
      const result = await new Promise<boolean>((resolve) => {
        const proc = spawn('powershell', [
          '-NoProfile',
          '-Command',
          'Add-Type -AssemblyName System.Speech; [System.Speech.Synthesis.SpeechSynthesizer]::new() | Out-Null; Write-Output "ok"'
        ], {
          timeout: 5000,
          shell: false,
        });

        let output = '';
        proc.stdout?.on('data', (data) => {
          output += data.toString();
        });

        proc.on('close', (code) => {
          resolve(code === 0 && output.includes('ok'));
        });

        proc.on('error', () => {
          resolve(false);
        });
      });

      this.sapiAvailable = result;
      logger.info('Windows SAPI availability', { available: result });
      return result;
    } catch (error) {
      logger.debug('Windows SAPI availability check failed', { error: (error as Error).message });
      this.sapiAvailable = false;
      return false;
    }
  }

  /**
   * Check if voice model is downloaded
   */
  isModelDownloaded(voiceId?: string): boolean {
    const voice = voiceId || this.config.voiceId!;
    const modelPath = join(this.config.modelsPath!, `${voice}.onnx`);
    return existsSync(modelPath);
  }

  /**
   * Get model path for a voice
   */
  getModelPath(voiceId?: string): string {
    const voice = voiceId || this.config.voiceId!;
    return join(this.config.modelsPath!, `${voice}.onnx`);
  }

  /**
   * Download voice model
   */
  async downloadModel(voiceId?: string): Promise<void> {
    const voice = voiceId || this.config.voiceId!;
    const voiceInfo = PIPER_VOICES[voice];

    if (!voiceInfo) {
      throw new Error(`Unknown voice: ${voice}`);
    }

    if (this.isModelDownloaded(voice)) {
      logger.info('Model already downloaded', { voice });
      return;
    }

    logger.info('Downloading voice model', {
      voice,
      size: `${voiceInfo.size}MB`,
    });

    this.setStatus(TTSStatus.LOADING);

    try {
      // Download model file
      const modelPath = this.getModelPath(voice);
      await this.downloadFile(voiceInfo.downloadUrl, modelPath);

      // Download config file
      const configPath = modelPath + '.json';
      await this.downloadFile(voiceInfo.configUrl, configPath);

      logger.info('Model download complete', { voice });
      this.setStatus(TTSStatus.IDLE);
    } catch (error) {
      this.setStatus(TTSStatus.ERROR);
      throw new Error(`Failed to download model: ${(error as Error).message}`);
    }
  }

  /**
   * Download a file from URL
   */
  private async downloadFile(url: string, destPath: string): Promise<void> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Download failed: ${response.status}`);
    }

    const fileStream = createWriteStream(destPath);
    const reader = response.body?.getReader();

    if (!reader) {
      throw new Error('No response body');
    }

    try {
      let done = false;
      while (!done) {
        const result = await reader.read();
        done = result.done;
        if (result.value) {
          fileStream.write(Buffer.from(result.value));
        }
      }
    } finally {
      fileStream.close();
      reader.releaseLock();
    }
  }

  /**
   * Synthesize text using Piper
   * Piper supports speed via length_scale parameter (inverted: 0.5 = 2x speed)
   * Pitch is handled via post-processing audio manipulation
   */
  private async synthesizeWithPiper(text: string): Promise<Buffer> {
    const modelPath = this.getModelPath();

    if (!existsSync(modelPath)) {
      throw new Error(`Model not found: ${modelPath}. Please download the model first.`);
    }

    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];

      const args = ['--model', modelPath, '--output_raw'];

      // Apply speed via Piper's length_scale parameter
      // length_scale < 1 = faster, > 1 = slower (inverted from our speed)
      const effectiveSpeed = this.voiceSettings.speed;
      if (effectiveSpeed !== 1.0) {
        const lengthScale = 1 / effectiveSpeed;
        args.push('--length_scale', String(lengthScale));
        logger.debug('Piper speed adjustment', {
          speed: effectiveSpeed,
          lengthScale,
        });
      }

      const proc = spawn(this.config.piperPath!, args);
      this.currentProcess = proc;

      proc.stdout.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });

      proc.stderr.on('data', (data: Buffer) => {
        logger.debug('Piper stderr', { message: data.toString() });
      });

      proc.on('close', (code) => {
        this.currentProcess = null;
        if (code === 0) {
          let audioBuffer = Buffer.concat(chunks);

          // Apply pitch adjustment via audio processing if needed
          if (this.voiceSettings.pitch !== 0) {
            audioBuffer = this.applyPitchShift(audioBuffer, this.voiceSettings.pitch);
          }

          resolve(audioBuffer);
        } else {
          reject(new Error(`Piper exited with code ${code}`));
        }
      });

      proc.on('error', (error) => {
        this.currentProcess = null;
        reject(error);
      });

      // Send text to stdin
      proc.stdin.write(text);
      proc.stdin.end();
    });
  }

  /**
   * Apply pitch shift to PCM audio data
   * Uses simple resampling for pitch shifting
   * @param audioData - Raw PCM audio buffer (16-bit signed)
   * @param semitones - Pitch shift in semitones
   * @returns Processed audio buffer
   */
  private applyPitchShift(audioData: Buffer, semitones: number): Buffer {
    if (semitones === 0) return audioData;

    const pitchFactor = Math.pow(2, semitones / 12);
    const numSamples = audioData.length / 2;
    const resampledLength = Math.floor(numSamples / pitchFactor);

    if (resampledLength <= 0) return audioData;

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

    // Time stretch back to original duration using overlap-add
    return this.timeStretchToOriginalDuration(resampled, pitchFactor);
  }

  /**
   * Time stretch audio to restore original duration after pitch shift
   */
  private timeStretchToOriginalDuration(audioData: Buffer, factor: number): Buffer {
    if (factor === 1.0) return audioData;

    const numSamples = audioData.length / 2;
    const targetLength = Math.floor(numSamples * factor);
    const sampleRate = this.config.sampleRate || 22050;

    // Window size for overlap-add (20ms)
    const windowSize = Math.floor(sampleRate * 0.02);
    const hopSize = Math.floor(windowSize / 2);

    const output = Buffer.alloc(targetLength * 2);
    const synthesis = new Float32Array(targetLength);

    let outPos = 0;
    let inPos = 0;

    while (outPos < targetLength && inPos < numSamples - windowSize) {
      for (let i = 0; i < windowSize && outPos + i < targetLength; i++) {
        const window = 0.5 * (1 - Math.cos((2 * Math.PI * i) / windowSize));
        const sampleIdx = Math.min(inPos + i, numSamples - 1);
        const sample = audioData.readInt16LE(sampleIdx * 2) / 32768.0;
        synthesis[outPos + i] += sample * window;
      }

      outPos += Math.floor(hopSize * factor);
      inPos += hopSize;
    }

    for (let i = 0; i < targetLength; i++) {
      const sample = Math.max(-1, Math.min(1, synthesis[i]));
      output.writeInt16LE(Math.round(sample * 32767), i * 2);
    }

    return output;
  }

  /**
   * Synthesize text using espeak-ng
   * espeak-ng supports both speed (-s) and pitch (-p) natively
   */
  private async synthesizeWithEspeak(text: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const espeakCmd = process.platform === 'win32' ? 'espeak-ng' : 'espeak-ng';

      // espeak default speed is 175 words per minute
      // Our speed multiplier: 1.0 = 175, 2.0 = 350, 0.5 = 87.5
      const baseSpeed = 175;
      const effectiveSpeed = Math.round(baseSpeed * this.voiceSettings.speed);

      // espeak pitch: 0-99, default is 50
      // Our pitch: -12 to +12 semitones, we map it to espeak's range
      // -12 semitones = pitch 20, +12 semitones = pitch 80
      const basePitch = 50;
      const pitchRange = 30; // +/- 30 from base
      const effectivePitch = Math.round(
        basePitch + (this.voiceSettings.pitch / 12) * pitchRange
      );

      const args = [
        '--stdout',
        '-v',
        'en-us',
        '-s',
        String(effectiveSpeed),
        '-p',
        String(Math.max(0, Math.min(99, effectivePitch))),
        text,
      ];

      logger.debug('espeak voice settings', {
        speed: this.voiceSettings.speed,
        pitch: this.voiceSettings.pitch,
        espeakSpeed: effectiveSpeed,
        espeakPitch: effectivePitch,
      });

      const proc = spawn(espeakCmd, args, { shell: true });
      this.currentProcess = proc;

      proc.stdout.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });

      proc.stderr.on('data', (data: Buffer) => {
        logger.debug('espeak stderr', { message: data.toString() });
      });

      proc.on('close', (code) => {
        this.currentProcess = null;
        if (code === 0) {
          resolve(Buffer.concat(chunks));
        } else {
          reject(new Error(`espeak exited with code ${code}`));
        }
      });

      proc.on('error', (error) => {
        this.currentProcess = null;
        reject(error);
      });
    });
  }

  /**
   * Synthesize text using Windows SAPI (System.Speech)
   * Provides basic TTS using Windows built-in speech synthesis
   */
  private async synthesizeWithSapi(text: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      // Create a temp file path for the WAV output
      const tempPath = join(
        app?.getPath?.('temp') || process.env.TEMP || '/tmp',
        `sapi_${Date.now()}.wav`
      );

      // SAPI rate: -10 to 10, default is 0
      // Our speed: 0.5 to 2.0, map to -5 to +5
      const sapiRate = Math.round((this.voiceSettings.speed - 1.0) * 5);

      // Build PowerShell script for SAPI synthesis
      const escapedText = text.replace(/'/g, "''").replace(/"/g, '`"');
      const escapedPath = tempPath.replace(/'/g, "''");

      const psScript = `
        Add-Type -AssemblyName System.Speech
        $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
        $synth.Rate = ${Math.max(-10, Math.min(10, sapiRate))}
        $synth.SetOutputToWaveFile('${escapedPath}')
        $synth.Speak('${escapedText}')
        $synth.Dispose()
        Write-Output 'done'
      `;

      logger.debug('SAPI voice settings', {
        speed: this.voiceSettings.speed,
        sapiRate,
        tempPath,
      });

      const proc = spawn('powershell', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        psScript
      ], { shell: false });
      this.currentProcess = proc;

      let stderr = '';
      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on('close', async (code) => {
        this.currentProcess = null;
        if (code === 0 && existsSync(tempPath)) {
          try {
            const { readFile, unlink } = await import('fs/promises');
            const wavData = await readFile(tempPath);
            // Clean up temp file
            await unlink(tempPath).catch(() => {});
            resolve(wavData);
          } catch (error) {
            reject(new Error(`Failed to read SAPI output: ${(error as Error).message}`));
          }
        } else {
          reject(new Error(`SAPI failed with code ${code}: ${stderr}`));
        }
      });

      proc.on('error', (error) => {
        this.currentProcess = null;
        reject(error);
      });
    });
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

      let audio: Buffer;
      let format: string;

      // Try Piper first, then espeak, then Windows SAPI
      const piperOk = await this.isPiperAvailable();
      if (piperOk && this.isModelDownloaded()) {
        audio = await this.synthesizeWithPiper(text);
        format = `pcm_${this.config.sampleRate}`;
      } else if (this.config.useEspeakFallback) {
        const espeakOk = await this.isEspeakAvailable();
        if (espeakOk) {
          audio = await this.synthesizeWithEspeak(text);
          format = 'wav';
        } else {
          // Try Windows SAPI as last resort
          const sapiOk = await this.isSapiAvailable();
          if (sapiOk) {
            logger.info('Using Windows SAPI as fallback TTS');
            audio = await this.synthesizeWithSapi(text);
            format = 'wav';
          } else {
            throw new Error('No TTS engine available. Install Piper or espeak-ng, or use Windows with SAPI.');
          }
        }
      } else {
        throw new Error('Piper not available and espeak fallback disabled.');
      }

      const latency = Date.now() - startTime;
      perfTimer.end('synthesize');

      // Estimate duration (16-bit PCM at sample rate)
      const bytesPerSecond = this.config.sampleRate! * 2;
      const duration = Math.round((audio.length / bytesPerSecond) * 1000);

      const result: TTSSynthesisResult = {
        audio,
        format,
        duration,
        characterCount: text.length,
        latency,
      };

      logger.info('Synthesis complete', {
        latency,
        audioSize: audio.length,
        duration,
      });

      this.setStatus(TTSStatus.IDLE);
      this.emit('synthesized', result);
      return result;
    } catch (error) {
      perfTimer.end('synthesize');
      this.setStatus(TTSStatus.ERROR);

      logger.error('Synthesis failed', { error: (error as Error).message });
      this.emit('error', error as Error);
      throw error;
    }
  }

  /**
   * Synthesize text with streaming (returns async generator)
   * Note: Piper doesn't support true streaming, so we simulate chunks
   */
  async *synthesizeStream(text: string): AsyncGenerator<TTSAudioChunk> {
    this.setStatus(TTSStatus.SYNTHESIZING);
    perfTimer.start('synthesizeStream');

    const startTime = Date.now();

    try {
      // Synthesize full audio first
      const result = await this.synthesize(text);

      // Emit audio in chunks to simulate streaming
      const chunkSize = 4096;
      const audio = result.audio;

      for (let i = 0; i < audio.length; i += chunkSize) {
        const chunk = audio.slice(i, Math.min(i + chunkSize, audio.length));
        const isLast = i + chunkSize >= audio.length;

        const audioChunk: TTSAudioChunk = {
          data: chunk,
          format: result.format,
          isFinal: false,
          duration: Math.round((chunk.length / (this.config.sampleRate! * 2)) * 1000),
        };

        this.emit('chunk', audioChunk);
        yield audioChunk;

        if (isLast) break;
      }

      // Emit final chunk indicator
      const finalChunk: TTSAudioChunk = {
        data: Buffer.alloc(0),
        format: result.format,
        isFinal: true,
        duration: 0,
      };

      this.emit('chunk', finalChunk);
      yield finalChunk;

      perfTimer.end('synthesizeStream');

      logger.info('Streaming synthesis complete', {
        latency: Date.now() - startTime,
        totalBytes: audio.length,
      });

      this.setStatus(TTSStatus.IDLE);
    } catch (error) {
      perfTimer.end('synthesizeStream');
      this.setStatus(TTSStatus.ERROR);

      logger.error('Streaming failed', { error: (error as Error).message });
      this.emit('error', error as Error);
      throw error;
    }
  }

  /**
   * Speak text (synthesize and emit for playback)
   */
  async speak(text: string, priority = 0): Promise<void> {
    const item: SpeechQueueItem = {
      id: generateId(),
      text,
      priority,
      queuedAt: Date.now(),
      status: 'pending',
    };

    // Insert based on priority
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

        const chunks: Buffer[] = [];
        let wasCancelled = false;

        for await (const chunk of this.synthesizeStream(item.text)) {
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

          const fullAudio = Buffer.concat(chunks);
          const result: TTSSynthesisResult = {
            audio: fullAudio,
            format: `pcm_${this.config.sampleRate}`,
            duration: Math.round((fullAudio.length / (this.config.sampleRate! * 2)) * 1000),
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
   * Stop current speech and clear queue
   */
  stop(): void {
    logger.info('Stopping speech');

    // Kill current process
    if (this.currentProcess) {
      this.currentProcess.kill();
      this.currentProcess = null;
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
   * Clear speech queue
   */
  clearQueue(): void {
    this.speechQueue = this.speechQueue.filter((q) => q.status === 'speaking');
    this.emit('queueUpdate', [...this.speechQueue]);
    logger.info('Speech queue cleared');
  }

  /**
   * Get provider configuration (returns TTSConfig-compatible object)
   */
  getConfig(): TTSConfig {
    return {
      apiKey: '', // Not needed for offline
      voiceId: this.config.voiceId,
    };
  }

  /**
   * Get offline-specific configuration
   */
  getOfflineConfig(): OfflineTTSConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<OfflineTTSConfig>): void {
    this.config = { ...this.config, ...config };

    // Update voice settings if provided
    if (config.voiceSettings) {
      this.setVoiceSettings(config.voiceSettings);
    }

    logger.info('Configuration updated', {
      voiceId: this.config.voiceId,
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

    // Sync with legacy speakingRate for backward compatibility
    this.config.speakingRate = newSettings.speed;

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
   * Preview voice settings with a sample text
   * @param previewText - Optional text to preview
   */
  async previewVoiceSettings(previewText?: string): Promise<void> {
    const text = previewText || 'This is how I will sound with the current voice settings.';
    this.emit('voiceSettingsPreview', this.voiceSettings, text);
    await this.speak(text, 10);
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
   * Get available Piper voices
   */
  static getAvailableVoices(): PiperVoice[] {
    return Object.values(PIPER_VOICES);
  }

  /**
   * Get voice information
   */
  static getVoiceInfo(voiceId: string): PiperVoice | undefined {
    return PIPER_VOICES[voiceId];
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
 * Create an OfflineTTS instance
 */
export function createOfflineTTS(config?: Partial<OfflineTTSConfig>): OfflineTTS {
  return new OfflineTTS(config);
}

export default OfflineTTS;
