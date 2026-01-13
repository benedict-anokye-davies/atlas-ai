/**
 * Nova Desktop - Offline STT Provider (Whisper)
 * Offline speech-to-text fallback using local Whisper model
 *
 * Note: This is a stub implementation. Full implementation requires
 * platform-specific native binaries (whisper.cpp or similar).
 * The interface matches DeepgramSTT for seamless fallback.
 */

import { EventEmitter } from 'events';
import { createModuleLogger, PerformanceTimer } from '../utils/logger';
import {
  STTProvider,
  STTConfig,
  STTStatus,
  STTEvents,
  TranscriptionResult,
  DEFAULT_STT_CONFIG,
} from '../../shared/types/stt';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';

const logger = createModuleLogger('OfflineSTT');
const perfTimer = new PerformanceTimer('OfflineSTT');

/**
 * Offline STT configuration
 */
export interface OfflineSTTConfig extends STTConfig {
  /** Model size: tiny, base, small, medium, large */
  modelSize?: 'tiny' | 'base' | 'small' | 'medium' | 'large';
  /** Path to model file */
  modelPath?: string;
  /** Number of threads to use */
  threads?: number;
  /** Enable GPU acceleration if available */
  useGPU?: boolean;
}

/**
 * Default offline STT configuration
 */
const DEFAULT_OFFLINE_CONFIG: Partial<OfflineSTTConfig> = {
  ...DEFAULT_STT_CONFIG,
  modelSize: 'base',
  threads: 4,
  useGPU: false,
};

// Model download URLs (whisper.cpp format)
const MODEL_URLS: Record<string, string> = {
  tiny: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin',
  base: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin',
  small: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin',
  medium: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.en.bin',
  large: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large.bin',
};

// Model sizes in MB (approximate)
const MODEL_SIZES: Record<string, number> = {
  tiny: 75,
  base: 142,
  small: 466,
  medium: 1500,
  large: 2900,
};

/**
 * Offline Speech-to-Text Provider
 * Uses local Whisper model for transcription without internet
 */
export class OfflineSTT extends EventEmitter implements STTProvider {
  readonly name = 'offline-whisper';
  private _status: STTStatus = STTStatus.IDLE;
  private config: OfflineSTTConfig;
  private modelLoaded: boolean = false;
  private audioBuffer: Int16Array[] = [];
  private isProcessing: boolean = false;

  constructor(config: Partial<OfflineSTTConfig> = {}) {
    super();
    this.config = { ...DEFAULT_OFFLINE_CONFIG, ...config } as OfflineSTTConfig;

    logger.info('OfflineSTT initialized', {
      modelSize: this.config.modelSize,
      threads: this.config.threads,
    });
  }

  /**
   * Get current status
   */
  get status(): STTStatus {
    return this._status;
  }

  /**
   * Set status and emit event
   */
  private setStatus(status: STTStatus): void {
    if (this._status !== status) {
      const previousStatus = this._status;
      this._status = status;
      logger.debug('Status changed', { from: previousStatus, to: status });
      this.emit('status', status);
    }
  }

  /**
   * Get model path for the configured size
   */
  private getModelPath(): string {
    if (this.config.modelPath) {
      return this.config.modelPath;
    }

    const modelDir = join(homedir(), '.nova', 'models', 'whisper');
    const modelFile = `ggml-${this.config.modelSize}.en.bin`;
    return join(modelDir, modelFile);
  }

  /**
   * Check if model is downloaded
   */
  isModelDownloaded(): boolean {
    const modelPath = this.getModelPath();
    return existsSync(modelPath);
  }

  /**
   * Get model download info
   */
  getModelInfo(): { size: number; url: string; path: string; downloaded: boolean } {
    const size = this.config.modelSize || 'base';
    return {
      size: MODEL_SIZES[size],
      url: MODEL_URLS[size],
      path: this.getModelPath(),
      downloaded: this.isModelDownloaded(),
    };
  }

  /**
   * Download the model (stub - actual implementation would use fetch)
   */
  async downloadModel(onProgress?: (progress: number) => void): Promise<void> {
    const modelPath = this.getModelPath();
    const modelDir = join(modelPath, '..');

    if (!existsSync(modelDir)) {
      mkdirSync(modelDir, { recursive: true });
    }

    if (this.isModelDownloaded()) {
      logger.info('Model already downloaded', { path: modelPath });
      return;
    }

    const size = this.config.modelSize || 'base';
    const url = MODEL_URLS[size];

    logger.info('Downloading Whisper model...', {
      size,
      url,
      targetPath: modelPath,
    });

    // Stub: In a real implementation, this would download the model
    // For now, we'll simulate progress and then throw an error
    // indicating the model needs to be downloaded manually
    for (let i = 0; i <= 100; i += 10) {
      onProgress?.(i);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    throw new Error(
      `Model download not yet implemented. Please download manually from ${url} to ${modelPath}`
    );
  }

  /**
   * Load the Whisper model
   */
  private async loadModel(): Promise<void> {
    if (this.modelLoaded) {
      return;
    }

    const modelPath = this.getModelPath();

    if (!existsSync(modelPath)) {
      throw new Error(
        `Whisper model not found at ${modelPath}. ` +
          `Please download the model or set a valid modelPath.`
      );
    }

    logger.info('Loading Whisper model...', { path: modelPath });
    perfTimer.start('loadModel');

    // Stub: In a real implementation, this would load the model
    // using whisper.cpp bindings or similar
    await new Promise((resolve) => setTimeout(resolve, 100));

    this.modelLoaded = true;
    perfTimer.end('loadModel');
    logger.info('Whisper model loaded');
  }

  /**
   * Start the offline STT
   */
  async start(): Promise<void> {
    if (this._status === STTStatus.CONNECTED || this._status === STTStatus.LISTENING) {
      logger.warn('Already started');
      return;
    }

    this.setStatus(STTStatus.CONNECTING);

    try {
      await this.loadModel();
      this.audioBuffer = [];
      this.setStatus(STTStatus.CONNECTED);
      this.emit('open');
      logger.info('Offline STT started');
    } catch (error) {
      this.setStatus(STTStatus.ERROR);
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('Failed to start offline STT', { error: err.message });
      this.emit('error', err);
      throw err;
    }
  }

  /**
   * Stop the offline STT
   */
  async stop(): Promise<void> {
    logger.info('Stopping offline STT');

    // Process any remaining audio
    if (this.audioBuffer.length > 0) {
      await this.processBufferedAudio();
    }

    this.audioBuffer = [];
    this.setStatus(STTStatus.CLOSED);
    this.emit('close');
    logger.info('Offline STT stopped');
  }

  /**
   * Send audio data for transcription
   */
  sendAudio(audioData: Buffer | Int16Array): void {
    if (!this.isReady()) {
      logger.warn('Cannot send audio - not ready', { status: this._status });
      return;
    }

    // Convert Buffer to Int16Array if needed
    let samples: Int16Array;
    if (Buffer.isBuffer(audioData)) {
      samples = new Int16Array(audioData.buffer, audioData.byteOffset, audioData.length / 2);
    } else {
      samples = audioData as Int16Array;
    }

    this.audioBuffer.push(samples);
    this.setStatus(STTStatus.LISTENING);
    this.emit('speechStarted');

    // Process when we have enough audio (e.g., 1 second at 16kHz)
    const totalSamples = this.audioBuffer.reduce((sum, buf) => sum + buf.length, 0);
    if (totalSamples >= this.config.sampleRate! && !this.isProcessing) {
      this.processBufferedAudio();
    }
  }

  /**
   * Process buffered audio through Whisper
   */
  private async processBufferedAudio(): Promise<void> {
    if (this.audioBuffer.length === 0 || this.isProcessing) {
      return;
    }

    this.isProcessing = true;
    this.setStatus(STTStatus.PROCESSING);
    perfTimer.start('transcribe');

    try {
      // Combine all audio buffers
      const totalLength = this.audioBuffer.reduce((sum, buf) => sum + buf.length, 0);
      const combined = new Int16Array(totalLength);
      let offset = 0;
      for (const buf of this.audioBuffer) {
        combined.set(buf, offset);
        offset += buf.length;
      }
      this.audioBuffer = [];

      // Stub: In a real implementation, this would call whisper.cpp
      // For now, emit an empty result to show the interface works
      const result: TranscriptionResult = {
        text: '',
        isFinal: true,
        confidence: 0,
        duration: (totalLength / this.config.sampleRate!) * 1000,
        language: 'en',
        raw: { stub: true, samples: totalLength },
      };

      // In a real implementation:
      // const result = await this.whisper.transcribe(combined);

      perfTimer.end('transcribe');

      if (result.text) {
        logger.info('Transcription result', {
          text: result.text,
          confidence: result.confidence,
        });

        this.emit('transcript', result);
        if (result.isFinal) {
          this.emit('final', result);
        } else {
          this.emit('interim', result);
        }
      }

      this.emit('utteranceEnd');
      this.setStatus(STTStatus.CONNECTED);
    } catch (error) {
      perfTimer.end('transcribe');
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('Transcription failed', { error: err.message });
      this.emit('error', err);
      this.setStatus(STTStatus.ERROR);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Check if ready to receive audio
   */
  isReady(): boolean {
    return (
      this.modelLoaded &&
      (this._status === STTStatus.CONNECTED || this._status === STTStatus.LISTENING)
    );
  }

  /**
   * Get current configuration
   */
  getConfig(): STTConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<OfflineSTTConfig>): void {
    const modelChanged = config.modelSize && config.modelSize !== this.config.modelSize;
    this.config = { ...this.config, ...config };

    if (modelChanged) {
      this.modelLoaded = false;
      logger.info('Model size changed, will reload on next start');
    }

    logger.info('Configuration updated', config);
  }

  // Type-safe event emitter methods
  on<K extends keyof STTEvents>(event: K, listener: STTEvents[K]): this {
    return super.on(event, listener);
  }

  off<K extends keyof STTEvents>(event: K, listener: STTEvents[K]): this {
    return super.off(event, listener);
  }

  emit<K extends keyof STTEvents>(event: K, ...args: Parameters<STTEvents[K]>): boolean {
    return super.emit(event, ...args);
  }
}

/**
 * Create an OfflineSTT instance
 */
export function createOfflineSTT(config?: Partial<OfflineSTTConfig>): OfflineSTT {
  return new OfflineSTT(config);
}

export default OfflineSTT;
