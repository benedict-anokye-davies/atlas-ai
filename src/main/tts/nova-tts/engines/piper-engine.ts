/**
 * Nova TTS - Piper Engine
 * Fast local neural TTS using Piper (ONNX-based VITS)
 */

import { EventEmitter } from 'events';
import { spawn, ChildProcess } from 'child_process';
import { existsSync, mkdirSync, createWriteStream, readFileSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { app } from 'electron';
import { pipeline } from 'stream/promises';
import { createModuleLogger } from '../../../utils/logger';
import {
  NovaTTSEngine,
  NovaTTSVoice,
  NovaTTSEngineStatus,
  SynthesisOptions,
  NovaTTSAudioChunk,
  NovaTTSSynthesisResult,
  EngineInfo,
  ModelDownloadProgress,
} from '../types';
import { PIPER_VOICES, NOVA_PREMIUM_VOICES } from '../voices';

const logger = createModuleLogger('NovaTTS-Piper');

/**
 * Piper engine configuration
 */
export interface PiperEngineConfig {
  /** Path to Piper executable */
  piperPath: string;
  /** Path to store models */
  modelsPath: string;
  /** Default sample rate */
  sampleRate: number;
  /** JSON config suffix */
  configSuffix: string;
}

/**
 * Get default Piper paths
 */
function getDefaultPaths(): { piperPath: string; modelsPath: string } {
  const userDataPath = app?.getPath?.('userData') || 
    join(process.env.HOME || process.env.USERPROFILE || '.', '.nova-tts');
  const modelsPath = join(userDataPath, 'models', 'piper');
  
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
 * Default Piper configuration
 */
const DEFAULT_PIPER_CONFIG: PiperEngineConfig = {
  ...getDefaultPaths(),
  sampleRate: 22050,
  configSuffix: '.onnx.json',
};

/**
 * Piper TTS Engine
 * High-quality local neural TTS with fast inference
 */
export class PiperEngine extends EventEmitter {
  readonly name: NovaTTSEngine = 'piper';
  private config: PiperEngineConfig;
  private _status: NovaTTSEngineStatus = NovaTTSEngineStatus.UNINITIALIZED;
  private availableVoices: NovaTTSVoice[] = [];
  private downloadedVoices: Set<string> = new Set();
  private currentProcess: ChildProcess | null = null;

  constructor(config: Partial<PiperEngineConfig> = {}) {
    super();
    const defaults = getDefaultPaths();
    this.config = {
      ...DEFAULT_PIPER_CONFIG,
      piperPath: defaults.piperPath,
      modelsPath: defaults.modelsPath,
      ...config,
    };
  }

  /**
   * Get current status
   */
  get status(): NovaTTSEngineStatus {
    return this._status;
  }

  /**
   * Set status and emit event
   */
  private setStatus(status: NovaTTSEngineStatus): void {
    if (this._status !== status) {
      this._status = status;
      this.emit('engine-status', this.name, status);
    }
  }

  /**
   * Initialize the engine
   */
  async initialize(): Promise<void> {
    this.setStatus(NovaTTSEngineStatus.LOADING);

    try {
      // Ensure directories exist
      if (!existsSync(this.config.modelsPath)) {
        mkdirSync(this.config.modelsPath, { recursive: true });
      }

      // Check Piper availability
      const piperAvailable = await this.isPiperAvailable();
      if (!piperAvailable) {
        logger.warn('Piper executable not found', { path: this.config.piperPath });
      }

      // Scan for downloaded voices
      this.scanDownloadedVoices();

      // Load voice catalog
      this.availableVoices = [...PIPER_VOICES, ...NOVA_PREMIUM_VOICES.filter(v => v.engine === 'piper')];

      this.setStatus(NovaTTSEngineStatus.READY);
      logger.info('Piper engine initialized', {
        piperAvailable,
        downloadedVoices: this.downloadedVoices.size,
        availableVoices: this.availableVoices.length,
      });
    } catch (error) {
      this.setStatus(NovaTTSEngineStatus.ERROR);
      logger.error('Failed to initialize Piper engine', { error: (error as Error).message });
      throw error;
    }
  }

  /**
   * Shutdown the engine
   */
  async shutdown(): Promise<void> {
    if (this.currentProcess) {
      this.currentProcess.kill();
      this.currentProcess = null;
    }
    this.setStatus(NovaTTSEngineStatus.SHUTDOWN);
    logger.info('Piper engine shutdown');
  }

  /**
   * Check if Piper executable is available
   */
  async isPiperAvailable(): Promise<boolean> {
    if (!existsSync(this.config.piperPath)) {
      return false;
    }

    return new Promise((resolve) => {
      const proc = spawn(this.config.piperPath, ['--help'], { timeout: 5000 });
      proc.on('close', (code) => resolve(code === 0));
      proc.on('error', () => resolve(false));
    });
  }

  /**
   * Scan models directory for downloaded voices
   */
  private scanDownloadedVoices(): void {
    this.downloadedVoices.clear();
    
    for (const voice of [...PIPER_VOICES, ...NOVA_PREMIUM_VOICES.filter(v => v.engine === 'piper')]) {
      const modelPath = this.getModelPath(voice.id);
      if (existsSync(modelPath)) {
        this.downloadedVoices.add(voice.id);
      }
    }

    logger.debug('Scanned downloaded voices', { count: this.downloadedVoices.size });
  }

  /**
   * Get model file path for a voice
   */
  getModelPath(voiceId: string): string {
    // Extract model filename from voice ID
    const voice = this.availableVoices.find(v => v.id === voiceId);
    if (voice?.downloadUrl) {
      const filename = voice.downloadUrl.split('/').pop() || `${voiceId}.onnx`;
      return join(this.config.modelsPath, filename);
    }
    return join(this.config.modelsPath, `${voiceId}.onnx`);
  }

  /**
   * Get config file path for a voice
   */
  getConfigPath(voiceId: string): string {
    return this.getModelPath(voiceId) + '.json';
  }

  /**
   * Get available voices
   */
  getVoices(): NovaTTSVoice[] {
    return this.availableVoices.map(v => ({
      ...v,
      modelPath: this.getModelPath(v.id),
    }));
  }

  /**
   * Get a specific voice
   */
  getVoice(voiceId: string): NovaTTSVoice | null {
    return this.availableVoices.find(v => v.id === voiceId) || null;
  }

  /**
   * Check if voice is downloaded
   */
  isVoiceDownloaded(voiceId: string): boolean {
    return this.downloadedVoices.has(voiceId);
  }

  /**
   * Download a voice model
   */
  async downloadVoice(voiceId: string): Promise<void> {
    const voice = this.getVoice(voiceId);
    if (!voice) {
      throw new Error(`Voice not found: ${voiceId}`);
    }

    if (!voice.downloadUrl) {
      throw new Error(`Voice has no download URL: ${voiceId}`);
    }

    const modelPath = this.getModelPath(voiceId);
    const configPath = this.getConfigPath(voiceId);

    // Ensure directory exists
    mkdirSync(dirname(modelPath), { recursive: true });

    logger.info('Downloading voice model', { voiceId, url: voice.downloadUrl });

    try {
      // Download model file
      await this.downloadFile(voice.downloadUrl, modelPath, voiceId);

      // Download config file if available
      if (voice.downloadUrl.endsWith('.onnx')) {
        const configUrl = voice.downloadUrl + '.json';
        try {
          await this.downloadFile(configUrl, configPath, voiceId, true);
        } catch {
          logger.debug('Config file not found, using defaults');
        }
      }

      this.downloadedVoices.add(voiceId);
      logger.info('Voice download complete', { voiceId });
    } catch (error) {
      // Clean up partial downloads
      if (existsSync(modelPath)) unlinkSync(modelPath);
      if (existsSync(configPath)) unlinkSync(configPath);
      throw error;
    }
  }

  /**
   * Download a file with progress reporting
   */
  private async downloadFile(
    url: string, 
    destPath: string, 
    voiceId: string,
    silent = false
  ): Promise<void> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Download failed: ${response.statusText}`);
    }

    const totalBytes = parseInt(response.headers.get('content-length') || '0', 10);
    let downloadedBytes = 0;
    const startTime = Date.now();

    const writeStream = createWriteStream(destPath);
    const reader = response.body?.getReader();
    
    if (!reader) {
      throw new Error('Failed to get response reader');
    }

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      writeStream.write(Buffer.from(value));
      downloadedBytes += value.length;

      if (!silent && totalBytes > 0) {
        const elapsed = (Date.now() - startTime) / 1000;
        const speedBps = downloadedBytes / elapsed;
        const etaSeconds = (totalBytes - downloadedBytes) / speedBps;

        const progress: ModelDownloadProgress = {
          voiceId,
          totalBytes,
          downloadedBytes,
          progress: (downloadedBytes / totalBytes) * 100,
          speedBps,
          etaSeconds,
          status: 'downloading',
        };

        this.emit('download-progress', progress);
      }
    }

    writeStream.end();

    // Emit completion
    if (!silent) {
      this.emit('download-progress', {
        voiceId,
        totalBytes: downloadedBytes,
        downloadedBytes,
        progress: 100,
        speedBps: 0,
        etaSeconds: 0,
        status: 'complete',
      });
    }
  }

  /**
   * Delete a downloaded voice
   */
  async deleteVoice(voiceId: string): Promise<void> {
    const modelPath = this.getModelPath(voiceId);
    const configPath = this.getConfigPath(voiceId);

    if (existsSync(modelPath)) unlinkSync(modelPath);
    if (existsSync(configPath)) unlinkSync(configPath);

    this.downloadedVoices.delete(voiceId);
    logger.info('Voice deleted', { voiceId });
  }

  /**
   * Synthesize text to speech
   */
  async synthesize(text: string, options: SynthesisOptions): Promise<NovaTTSSynthesisResult> {
    if (this._status !== NovaTTSEngineStatus.READY) {
      throw new Error('Piper engine not ready');
    }

    const voice = this.getVoice(options.voiceId);
    if (!voice) {
      throw new Error(`Voice not found: ${options.voiceId}`);
    }

    if (!this.isVoiceDownloaded(options.voiceId)) {
      throw new Error(`Voice not downloaded: ${options.voiceId}`);
    }

    const startTime = Date.now();
    const id = `piper_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    this.setStatus(NovaTTSEngineStatus.BUSY);
    this.emit('synthesis-start', id, text, options);

    try {
      const modelPath = this.getModelPath(options.voiceId);
      const audio = await this.runPiper(text, modelPath, options);

      const processingTimeMs = Date.now() - startTime;
      const durationMs = (audio.length / 2 / this.config.sampleRate) * 1000;
      const rtf = processingTimeMs / durationMs;

      const result: NovaTTSSynthesisResult = {
        id,
        audio,
        format: {
          type: 'pcm',
          sampleRate: this.config.sampleRate,
          channels: 1,
          bitDepth: 16,
        },
        durationMs,
        characterCount: text.length,
        wordCount: text.split(/\s+/).length,
        latencyMs: processingTimeMs,
        processingTimeMs,
        rtf,
        voiceId: options.voiceId,
        engine: this.name,
        emotion: options.emotion,
        style: options.style,
      };

      this.emit('synthesis-complete', result);
      this.setStatus(NovaTTSEngineStatus.READY);

      return result;
    } catch (error) {
      this.emit('synthesis-error', id, error as Error);
      this.setStatus(NovaTTSEngineStatus.READY);
      throw error;
    }
  }

  /**
   * Synthesize text with streaming
   */
  async *synthesizeStream(text: string, options: SynthesisOptions): AsyncGenerator<NovaTTSAudioChunk> {
    // Piper doesn't support true streaming, so we simulate it with chunked output
    const result = await this.synthesize(text, options);
    
    const chunkSize = options.streamChunkSize || 4096;
    const numChunks = Math.ceil(result.audio.length / chunkSize);
    const chunkDuration = result.durationMs / numChunks;

    for (let i = 0; i < numChunks; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, result.audio.length);
      const chunkData = result.audio.subarray(start, end);

      const chunk: NovaTTSAudioChunk = {
        id: `${result.id}_chunk_${i}`,
        sequence: i,
        data: Buffer.from(chunkData),
        format: `pcm_${this.config.sampleRate}`,
        sampleRate: this.config.sampleRate,
        durationMs: chunkDuration,
        text: i === 0 ? text : '',
        isFinal: i === numChunks - 1,
        timestamp: Date.now(),
      };

      this.emit('audio-chunk', chunk);
      yield chunk;
    }
  }

  /**
   * Run Piper process to synthesize audio
   */
  private runPiper(text: string, modelPath: string, options: SynthesisOptions): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];

      // Build Piper arguments
      const args = [
        '--model', modelPath,
        '--output-raw',
      ];

      // Add speaking rate if specified
      if (options.characteristics?.speakingRate) {
        const rate = options.characteristics.speakingRate / 150; // Normalize to 1.0
        args.push('--length-scale', (1 / rate).toFixed(2));
      }

      logger.debug('Running Piper', { args: args.join(' ') });

      const proc = spawn(this.config.piperPath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this.currentProcess = proc;

      proc.stdout.on('data', (data: Buffer) => {
        chunks.push(data);
      });

      proc.stderr.on('data', (data: Buffer) => {
        const msg = data.toString();
        if (!msg.includes('Real-time factor')) {
          logger.debug('Piper stderr', { message: msg.trim() });
        }
      });

      proc.on('close', (code) => {
        this.currentProcess = null;
        if (code === 0) {
          resolve(Buffer.concat(chunks));
        } else {
          reject(new Error(`Piper process exited with code ${code}`));
        }
      });

      proc.on('error', (error) => {
        this.currentProcess = null;
        reject(error);
      });

      // Send text to Piper stdin
      proc.stdin.write(text);
      proc.stdin.end();
    });
  }

  /**
   * Stop current synthesis
   */
  stop(): void {
    if (this.currentProcess) {
      this.currentProcess.kill();
      this.currentProcess = null;
    }
  }

  /**
   * Get engine information
   */
  getEngineInfo(): EngineInfo {
    return {
      engine: this.name,
      name: 'Piper TTS',
      description: 'Fast local neural TTS using ONNX-based VITS models',
      available: existsSync(this.config.piperPath),
      status: this._status,
      supportsStreaming: false, // Simulated streaming only
      supportsCloning: false,
      supportsEmotion: false,
      supportsStyle: false,
      supportedLanguages: ['en-US', 'en-GB', 'de-DE', 'es-ES', 'fr-FR', 'it-IT', 'pl-PL', 'pt-BR', 'ru-RU', 'uk-UA', 'zh-CN'],
      requiresGpu: false,
      averageLatencyMs: 200,
      averageRtf: 0.1, // ~10x real-time
    };
  }
}

export default PiperEngine;
