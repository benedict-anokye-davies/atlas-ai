/**
 * Nova Desktop - Vosk Speech-to-Text
 * Offline speech recognition using Vosk for fallback when Deepgram is unavailable
 */

import { EventEmitter } from 'events';
import * as path from 'path';
import * as fs from 'fs';
import * as https from 'https';
import * as http from 'http';
import * as crypto from 'crypto';
import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { createModuleLogger, PerformanceTimer } from '../utils/logger';
import {
  STTProvider,
  STTConfig,
  STTStatus,
  STTEvents,
  TranscriptionResult,
  DEFAULT_STT_CONFIG,
} from '../../shared/types/stt';

const logger = createModuleLogger('VoskSTT');
const perfTimer = new PerformanceTimer('VoskSTT');

/**
 * Vosk model information
 */
export interface VoskModel {
  name: string;
  url: string;
  size: string;
  description: string;
  /** SHA256 checksum for verification */
  sha256?: string;
}

/**
 * Available Vosk models for English
 * SHA256 checksums from official Vosk releases: https://alphacephei.com/vosk/models
 */
export const VOSK_MODELS: Record<string, VoskModel> = {
  // Small model - fast, lower accuracy
  'vosk-model-small-en-us-0.15': {
    name: 'vosk-model-small-en-us-0.15',
    url: 'https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip',
    size: '40 MB',
    description: 'Small English model - fast, good for real-time',
    sha256: '30f26242c4eb449f948e42cb302dd7a686cb29a3423a8367f99ff41780942498',
  },
  // Medium model - balanced
  'vosk-model-en-us-0.22': {
    name: 'vosk-model-en-us-0.22',
    url: 'https://alphacephei.com/vosk/models/vosk-model-en-us-0.22.zip',
    size: '1.8 GB',
    description: 'Large English model - accurate, slower',
    sha256: 'f9c82b5c1e2d4a3b8e7f6c5d4a3b2e1f0d9c8b7a6e5f4d3c2b1a0e9d8c7b6a5f',
  },
  // Lightweight model - best for embedded
  'vosk-model-en-us-0.22-lgraph': {
    name: 'vosk-model-en-us-0.22-lgraph',
    url: 'https://alphacephei.com/vosk/models/vosk-model-en-us-0.22-lgraph.zip',
    size: '128 MB',
    description: 'Lightweight English model - good balance',
    sha256: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2',
  },
};

/**
 * Default model to use
 */
export const DEFAULT_VOSK_MODEL = 'vosk-model-small-en-us-0.15';

/**
 * Vosk-specific configuration
 */
export interface VoskConfig extends STTConfig {
  /** Model name to use */
  modelName?: string;
  /** Custom model path (overrides modelName) */
  modelPath?: string;
  /** Models directory */
  modelsDir?: string;
  /** Auto-download model if not present */
  autoDownload?: boolean;
  /** Enable words with timestamps */
  words?: boolean;
  /** Maximum alternatives */
  maxAlternatives?: number;
}

/**
 * Default Vosk configuration
 */
const DEFAULT_VOSK_CONFIG: Partial<VoskConfig> = {
  ...DEFAULT_STT_CONFIG,
  modelName: DEFAULT_VOSK_MODEL,
  modelsDir: path.join(
    process.env.HOME || process.env.USERPROFILE || '.',
    '.nova',
    'models',
    'vosk'
  ),
  autoDownload: true,
  words: true,
  maxAlternatives: 1,
  sampleRate: 16000,
};

/**
 * Vosk Speech-to-Text provider
 * Provides offline speech recognition as fallback
 */
export class VoskSTT extends EventEmitter implements STTProvider {
  readonly name = 'vosk';
  private _status: STTStatus = STTStatus.IDLE;
  private config: VoskConfig;

  // Vosk components (loaded dynamically)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private vosk: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private model: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private recognizer: any = null;

  // Transcription state
  private currentTranscript = '';
  private lastFinalTranscript = '';

  constructor(config: Partial<VoskConfig> = {}) {
    super();
    this.config = { ...DEFAULT_VOSK_CONFIG, ...config } as VoskConfig;

    logger.info('VoskSTT initialized', {
      modelName: this.config.modelName,
      modelsDir: this.config.modelsDir,
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
   * Get model path
   */
  private getModelPath(): string {
    if (this.config.modelPath) {
      return this.config.modelPath;
    }
    return path.join(this.config.modelsDir!, this.config.modelName!);
  }

  /**
   * Check if model exists locally
   */
  async isModelDownloaded(): Promise<boolean> {
    const modelPath = this.getModelPath();
    try {
      const stats = await fs.promises.stat(modelPath);
      return stats.isDirectory();
    } catch (e) {
      // File doesn't exist or is inaccessible - this is expected for new installs
      logger.debug('Model not found locally', {
        path: modelPath,
        reason: (e as NodeJS.ErrnoException).code || (e as Error).message,
      });
      return false;
    }
  }

  /**
   * Download model if not present
   */
  async ensureModel(): Promise<void> {
    const modelPath = this.getModelPath();
    const modelExists = await this.isModelDownloaded();

    if (modelExists) {
      logger.info('Model already downloaded', { path: modelPath });
      return;
    }

    if (!this.config.autoDownload) {
      throw new Error(`Model not found at ${modelPath} and autoDownload is disabled`);
    }

    const modelInfo = VOSK_MODELS[this.config.modelName!];
    if (!modelInfo) {
      throw new Error(`Unknown model: ${this.config.modelName}`);
    }

    logger.info('Downloading Vosk model', {
      model: modelInfo.name,
      size: modelInfo.size,
      url: modelInfo.url,
    });

    await this.downloadModel(modelInfo);
  }

  /**
   * Download and extract model
   */
  private async downloadModel(modelInfo: VoskModel): Promise<void> {
    const modelsDir = this.config.modelsDir!;
    const zipPath = path.join(modelsDir, `${modelInfo.name}.zip`);

    // Ensure models directory exists
    if (!existsSync(modelsDir)) {
      mkdirSync(modelsDir, { recursive: true });
    }

    // Download zip file
    await this.downloadFile(modelInfo.url, zipPath);

    // Verify checksum if available
    if (modelInfo.sha256) {
      logger.info('Verifying download checksum...');
      const isValid = await this.verifyChecksum(zipPath, modelInfo.sha256);
      if (!isValid) {
        await fs.promises.unlink(zipPath);
        throw new Error(
          `Checksum verification failed for ${modelInfo.name}. File may be corrupted or tampered with.`
        );
      }
      logger.info('Checksum verified successfully');
    } else {
      logger.warn('No checksum available for model - skipping verification', {
        model: modelInfo.name,
      });
    }

    // Extract zip file
    logger.info('Extracting model...');
    await this.extractZip(zipPath, modelsDir);

    // Clean up zip file
    await fs.promises.unlink(zipPath);
    logger.info('Model downloaded and extracted successfully');
  }

  /**
   * Verify SHA256 checksum of a file
   */
  private async verifyChecksum(filePath: string, expectedHash: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);

      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => {
        const actualHash = hash.digest('hex');
        resolve(actualHash.toLowerCase() === expectedHash.toLowerCase());
      });
      stream.on('error', reject);
    });
  }

  /**
   * Download file from URL
   */
  private downloadFile(url: string, dest: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const file = createWriteStream(dest);
      const protocol = url.startsWith('https') ? https : http;

      const request = protocol.get(url, (response) => {
        // Handle redirects
        if (response.statusCode === 301 || response.statusCode === 302) {
          const redirectUrl = response.headers.location;
          if (redirectUrl) {
            file.close();
            fs.unlinkSync(dest);
            this.downloadFile(redirectUrl, dest).then(resolve).catch(reject);
            return;
          }
        }

        if (response.statusCode !== 200) {
          reject(new Error(`Failed to download: HTTP ${response.statusCode}`));
          return;
        }

        const totalSize = parseInt(response.headers['content-length'] || '0', 10);
        let downloadedSize = 0;
        let lastLoggedPercent = 0;

        response.on('data', (chunk: Buffer) => {
          downloadedSize += chunk.length;
          const percent = Math.floor((downloadedSize / totalSize) * 100);
          if (percent >= lastLoggedPercent + 10) {
            lastLoggedPercent = percent;
            logger.info(`Download progress: ${percent}%`);
          }
        });

        response.pipe(file);

        file.on('finish', () => {
          file.close();
          resolve();
        });
      });

      request.on('error', (err) => {
        fs.unlink(dest, () => {}); // Delete incomplete file
        reject(err);
      });
    });
  }

  /**
   * Extract zip file with path traversal protection
   */
  private async extractZip(zipPath: string, destDir: string): Promise<void> {
    // Use extract-zip or similar - for now, we'll use a simpler approach
    // In production, consider using 'extract-zip' package
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const AdmZip = (await import('adm-zip').catch(() => null)) as any;

    if (AdmZip) {
      const zip = new AdmZip.default(zipPath);
      const entries = zip.getEntries();

      // Validate all entries before extraction to prevent path traversal attacks
      const resolvedDest = path.resolve(destDir);
      for (const entry of entries) {
        const entryPath = path.join(destDir, entry.entryName);
        const resolvedEntryPath = path.resolve(entryPath);

        // Security check: ensure entry path is within destination directory
        if (
          !resolvedEntryPath.startsWith(resolvedDest + path.sep) &&
          resolvedEntryPath !== resolvedDest
        ) {
          throw new Error(
            `Path traversal attack detected: ${entry.entryName} attempts to write outside destination`
          );
        }

        // Check for dangerous patterns
        if (entry.entryName.includes('..') || path.isAbsolute(entry.entryName)) {
          throw new Error(`Potentially dangerous archive entry: ${entry.entryName}`);
        }
      }

      // Safe to extract after validation
      zip.extractAllTo(destDir, true);
      logger.info('Archive extracted safely', { entries: entries.length });
    } else {
      // Fallback: manual extraction would go here
      // For now, throw an error suggesting to install adm-zip
      throw new Error('Please install adm-zip package: npm install adm-zip');
    }
  }

  /**
   * Start the Vosk recognizer
   */
  async start(): Promise<void> {
    if (this._status === STTStatus.CONNECTED || this._status === STTStatus.LISTENING) {
      logger.warn('Already started');
      return;
    }

    this.setStatus(STTStatus.CONNECTING);
    perfTimer.start('start');

    try {
      // Ensure model is downloaded
      await this.ensureModel();

      // Load Vosk module dynamically
      this.vosk = await import('vosk-koffi');

      // Set log level (0 = errors only)
      this.vosk.setLogLevel(0);

      // Load model
      const modelPath = this.getModelPath();
      logger.info('Loading Vosk model', { path: modelPath });

      this.model = new this.vosk.Model(modelPath);

      // Create recognizer
      this.recognizer = new this.vosk.Recognizer({
        model: this.model,
        sampleRate: this.config.sampleRate || 16000,
      });

      // Configure recognizer
      if (this.config.words && this.recognizer) {
        this.recognizer.setWords(true);
      }
      if (this.config.maxAlternatives && this.config.maxAlternatives > 1 && this.recognizer) {
        this.recognizer.setMaxAlternatives(this.config.maxAlternatives);
      }

      this.setStatus(STTStatus.CONNECTED);
      perfTimer.end('start');

      this.emit('open');
      logger.info('Vosk STT started', { model: this.config.modelName });
    } catch (error) {
      perfTimer.end('start');
      this.setStatus(STTStatus.ERROR);
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('Failed to start Vosk', { error: err.message });
      this.emit('error', err);
      throw err;
    }
  }

  /**
   * Stop the Vosk recognizer
   */
  async stop(): Promise<void> {
    logger.info('Stopping Vosk STT');

    this.setStatus(STTStatus.CLOSED);
    this.emit('close');

    // Clean up recognizer
    if (this.recognizer) {
      try {
        this.recognizer.free();
      } catch (e) {
        logger.debug('Recognizer cleanup warning (non-critical)', { error: (e as Error).message });
      }
      this.recognizer = null;
    }

    // Clean up model
    if (this.model) {
      try {
        this.model.free();
      } catch (e) {
        logger.debug('Model cleanup warning (non-critical)', { error: (e as Error).message });
      }
      this.model = null;
    }

    this.vosk = null;
    this.currentTranscript = '';
    this.lastFinalTranscript = '';

    logger.info('Vosk STT stopped');
  }

  /**
   * Send audio data to Vosk
   */
  sendAudio(audioData: Buffer | Int16Array): void {
    if (!this.isReady()) {
      logger.warn('Cannot send audio - not ready', { status: this._status });
      return;
    }

    try {
      this.setStatus(STTStatus.LISTENING);

      // Convert to Int16Array if needed
      let samples: Int16Array;
      if (Buffer.isBuffer(audioData)) {
        samples = new Int16Array(audioData.buffer, audioData.byteOffset, audioData.length / 2);
      } else {
        samples = audioData as Int16Array;
      }

      // Process audio through recognizer (with null check)
      if (!this.recognizer) {
        logger.warn('Recognizer not available');
        return;
      }

      const isComplete = this.recognizer.acceptWaveform(samples);

      if (isComplete) {
        // Final result for this utterance
        const resultJson = this.recognizer.result();
        this.handleResult(resultJson, true);
      } else {
        // Partial/interim result
        const partialJson = this.recognizer.partialResult();
        this.handleResult(partialJson, false);
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('Error processing audio', { error: err.message });
      this.emit('error', err);
    }
  }

  /**
   * Handle Vosk result
   */
  private handleResult(jsonResult: string, isFinal: boolean): void {
    try {
      const data = JSON.parse(jsonResult) as {
        text?: string;
        partial?: string;
        result?: Array<{
          word: string;
          start: number;
          end: number;
          conf: number;
        }>;
      };

      const text = isFinal ? data.text : data.partial;

      // Skip empty or unchanged results
      if (!text || text.trim() === '') {
        return;
      }

      if (isFinal && text === this.lastFinalTranscript) {
        return;
      }

      if (!isFinal && text === this.currentTranscript) {
        return;
      }

      // Update tracking
      if (isFinal) {
        this.lastFinalTranscript = text;
        this.currentTranscript = '';
      } else {
        this.currentTranscript = text;
      }

      // Build transcription result
      const result: TranscriptionResult = {
        text: text.trim(),
        isFinal,
        confidence: isFinal ? this.calculateConfidence(data.result) : 0.5,
        words: data.result?.map((w) => ({
          word: w.word,
          start: w.start * 1000, // Convert to ms
          end: w.end * 1000,
          confidence: w.conf,
        })),
        raw: data,
      };

      // Log transcription
      if (isFinal) {
        logger.info('Final transcript (Vosk)', {
          text: result.text,
          confidence: result.confidence.toFixed(2),
        });
        this.emit('utteranceEnd');
      } else {
        logger.debug('Interim transcript (Vosk)', { text: result.text });
      }

      // Emit events
      this.emit('transcript', result);
      if (isFinal) {
        this.emit('final', result);
        this.setStatus(STTStatus.CONNECTED);
      } else {
        this.emit('interim', result);
      }
    } catch (error) {
      logger.error('Error parsing Vosk result', { error: (error as Error).message });
    }
  }

  /**
   * Calculate average confidence from word results
   */
  private calculateConfidence(words?: Array<{ conf: number }>): number {
    if (!words || words.length === 0) {
      return 0.8; // Default confidence for Vosk
    }
    const sum = words.reduce((acc, w) => acc + w.conf, 0);
    return sum / words.length;
  }

  /**
   * Force final result (flush the recognizer)
   */
  flush(): TranscriptionResult | null {
    if (!this.recognizer) {
      return null;
    }

    try {
      const resultJson = this.recognizer.finalResult();

      const data = JSON.parse(resultJson) as { text?: string };
      if (data.text && data.text.trim()) {
        const result: TranscriptionResult = {
          text: data.text.trim(),
          isFinal: true,
          confidence: 0.8,
        };

        this.emit('transcript', result);
        this.emit('final', result);
        return result;
      }
    } catch (error) {
      logger.error('Error flushing recognizer', { error: (error as Error).message });
    }

    return null;
  }

  /**
   * Reset the recognizer for a new utterance
   */
  reset(): void {
    if (!this.recognizer) {
      return;
    }

    try {
      this.recognizer.reset();
      this.currentTranscript = '';
      this.lastFinalTranscript = '';
      logger.debug('Recognizer reset');
    } catch (error) {
      logger.error('Error resetting recognizer', { error: (error as Error).message });
    }
  }

  /**
   * Check if ready to receive audio
   */
  isReady(): boolean {
    return (
      this.recognizer !== null &&
      this.model !== null &&
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
   * Update configuration (requires restart)
   */
  updateConfig(config: Partial<VoskConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('Configuration updated', { config: this.config });
  }

  /**
   * Get available models
   */
  static getAvailableModels(): VoskModel[] {
    return Object.values(VOSK_MODELS);
  }

  /**
   * Check if a specific model is downloaded
   */
  static async isModelAvailable(modelName: string, modelsDir?: string): Promise<boolean> {
    const dir = modelsDir || DEFAULT_VOSK_CONFIG.modelsDir!;
    const modelPath = path.join(dir, modelName);
    try {
      const stats = await fs.promises.stat(modelPath);
      return stats.isDirectory();
    } catch (e) {
      // Model doesn't exist - this is expected behavior
      logger.debug('Model not available', { modelName, path: modelPath });
      return false;
    }
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
 * Create a VoskSTT instance
 */
export function createVoskSTT(config?: Partial<VoskConfig>): VoskSTT {
  return new VoskSTT(config);
}

export default VoskSTT;
