/**
 * Nova Desktop - Offline TTS Provider
 * Local text-to-speech using Piper (neural TTS) with espeak fallback
 * Provides offline speech synthesis when ElevenLabs is unavailable
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
    downloadUrl: 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/amy/medium/en_US-amy-medium.onnx',
    configUrl: 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/amy/medium/en_US-amy-medium.onnx.json',
    size: 63,
  },
  'en_US-lessac-medium': {
    id: 'en_US-lessac-medium',
    name: 'Lessac (US English)',
    language: 'en_US',
    quality: 'medium',
    sampleRate: 22050,
    downloadUrl: 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/medium/en_US-lessac-medium.onnx',
    configUrl: 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json',
    size: 63,
  },
  'en_GB-alba-medium': {
    id: 'en_GB-alba-medium',
    name: 'Alba (British English)',
    language: 'en_GB',
    quality: 'medium',
    sampleRate: 22050,
    downloadUrl: 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_GB/alba/medium/en_GB-alba-medium.onnx',
    configUrl: 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_GB/alba/medium/en_GB-alba-medium.onnx.json',
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
  /** Speaking rate (0.5 - 2.0) */
  speakingRate?: number;
  /** Use espeak as fallback if Piper unavailable */
  useEspeakFallback?: boolean;
}

/**
 * Default offline TTS configuration
 */
const DEFAULT_OFFLINE_TTS_CONFIG: OfflineTTSConfig = {
  voiceId: DEFAULT_PIPER_VOICE,
  sampleRate: 22050,
  speakingRate: 1.0,
  useEspeakFallback: true,
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
  const userDataPath = app?.getPath?.('userData') || join(process.env.HOME || process.env.USERPROFILE || '.', '.nova');
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
 */
export class OfflineTTS extends EventEmitter implements TTSProvider {
  readonly name = 'offline';
  private _status: TTSStatus = TTSStatus.IDLE;
  private config: OfflineTTSConfig;
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

    // Ensure models directory exists
    if (this.config.modelsPath && !existsSync(this.config.modelsPath)) {
      mkdirSync(this.config.modelsPath, { recursive: true });
    }

    logger.info('OfflineTTS initialized', {
      voiceId: this.config.voiceId,
      modelsPath: this.config.modelsPath,
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
    } catch {
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
    } catch {
      this.espeakAvailable = false;
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
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        fileStream.write(Buffer.from(value));
      }
    } finally {
      fileStream.close();
      reader.releaseLock();
    }
  }

  /**
   * Synthesize text using Piper
   */
  private async synthesizeWithPiper(text: string): Promise<Buffer> {
    const modelPath = this.getModelPath();

    if (!existsSync(modelPath)) {
      throw new Error(`Model not found: ${modelPath}. Please download the model first.`);
    }

    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];

      const args = [
        '--model', modelPath,
        '--output_raw',
      ];

      if (this.config.speakingRate && this.config.speakingRate !== 1.0) {
        args.push('--length_scale', String(1 / this.config.speakingRate));
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
          resolve(Buffer.concat(chunks));
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
   * Synthesize text using espeak-ng
   */
  private async synthesizeWithEspeak(text: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const espeakCmd = process.platform === 'win32' ? 'espeak-ng' : 'espeak-ng';

      const args = [
        '--stdout',
        '-v', 'en-us',
        '-s', String(Math.round(175 * (this.config.speakingRate || 1.0))),
        text,
      ];

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

      // Try Piper first, then espeak
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
          throw new Error('No TTS engine available. Install Piper or espeak-ng.');
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
    logger.info('Configuration updated', { voiceId: this.config.voiceId });
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
