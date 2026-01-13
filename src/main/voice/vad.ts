/**
 * Nova Voice Activity Detection (VAD) Manager
 * Uses Silero VAD model for detecting speech in audio streams
 *
 * This implementation uses @ricky0123/vad-node's FrameProcessor for real-time
 * voice activity detection.
 */

import { EventEmitter } from 'events';
import { FrameProcessor, FrameProcessorOptions, Message } from '@ricky0123/vad-node';
import * as ort from 'onnxruntime-node';
import { createModuleLogger } from '../utils/logger';
import { getConfig } from '../config';
import {
  VADConfig,
  VADEvent,
  VADStatus,
  SpeechSegment,
  DEFAULT_VAD_CONFIG,
} from '../../shared/types/voice';
import { join } from 'path';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { homedir } from 'os';

const logger = createModuleLogger('VAD');

// Path to Silero VAD model - bundled with @ricky0123/vad-node
const BUNDLED_MODEL_PATH = join(require.resolve('@ricky0123/vad-node'), '..', 'silero_vad.onnx');

// Fallback path in case we need to download
const LOCAL_MODEL_PATH = join(homedir(), '.nova', 'models', 'silero_vad.onnx');
const MODEL_URL = 'https://github.com/snakers4/silero-vad/raw/master/files/silero_vad.onnx';

// Default frame processor options
const DEFAULT_FRAME_PROCESSOR_OPTIONS: FrameProcessorOptions = {
  positiveSpeechThreshold: 0.5,
  negativeSpeechThreshold: 0.35,
  preSpeechPadFrames: 1,
  redemptionFrames: 8,
  frameSamples: 1536,
  minSpeechFrames: 3,
  submitUserSpeechOnPause: true,
};

/**
 * VAD Manager Events
 */
export interface VADManagerEvents {
  'speech-start': (event: VADEvent) => void;
  'speech-end': (event: VADEvent) => void;
  'speech-segment': (segment: SpeechSegment) => void;
  'vad-probability': (probability: number) => void;
  error: (error: Error) => void;
  started: () => void;
  stopped: () => void;
}

/**
 * Silero VAD Model wrapper
 */
class SileroModel {
  private session: ort.InferenceSession | null = null;
  private _h: ort.Tensor | null = null;
  private _c: ort.Tensor | null = null;
  private _sr: ort.Tensor | null = null;

  async init(modelPath: string): Promise<void> {
    this.session = await ort.InferenceSession.create(modelPath);
    this.reset_state();
    logger.debug('Silero ONNX session created');
  }

  reset_state(): void {
    const zeroes = new Float32Array(2 * 64).fill(0);
    this._h = new ort.Tensor('float32', zeroes, [2, 1, 64]);
    this._c = new ort.Tensor('float32', zeroes, [2, 1, 64]);
    this._sr = new ort.Tensor('int64', BigInt64Array.from([BigInt(16000)]), []);
  }

  async process(audioFrame: Float32Array): Promise<{ isSpeech: number; notSpeech: number }> {
    if (!this.session) {
      throw new Error('Model not initialized');
    }

    const input = new ort.Tensor('float32', audioFrame, [1, audioFrame.length]);

    const feeds = {
      input: input,
      h: this._h!,
      c: this._c!,
      sr: this._sr!,
    };

    const result = await this.session.run(feeds);

    this._h = result.hn as ort.Tensor;
    this._c = result.cn as ort.Tensor;

    const output = result.output as ort.Tensor;
    const isSpeech = (output.data as Float32Array)[0];

    return {
      isSpeech,
      notSpeech: 1 - isSpeech,
    };
  }
}

/**
 * VADManager class
 * Detects speech segments in audio streams using Silero VAD
 */
export class VADManager extends EventEmitter {
  private model: SileroModel | null = null;
  private frameProcessor: FrameProcessor | null = null;
  private isRunning: boolean = false;
  private config: Required<VADConfig>;

  // Speech tracking state
  private isSpeaking: boolean = false;
  private speechStartTime: number = 0;
  private currentProbability: number = 0;

  constructor(config?: Partial<VADConfig>) {
    super();
    const novaConfig = getConfig();

    this.config = {
      ...DEFAULT_VAD_CONFIG,
      threshold: novaConfig.vadThreshold,
      silenceDuration: novaConfig.vadSilenceDuration,
      ...config,
    };

    logger.info('VADManager initialized', {
      threshold: this.config.threshold,
      silenceDuration: this.config.silenceDuration,
      minSpeechDuration: this.config.minSpeechDuration,
    });
  }

  /**
   * Get path to Silero VAD model, downloading if necessary
   */
  private async getModelPath(): Promise<string> {
    // Try bundled model first
    if (existsSync(BUNDLED_MODEL_PATH)) {
      logger.debug('Using bundled Silero VAD model', { path: BUNDLED_MODEL_PATH });
      return BUNDLED_MODEL_PATH;
    }

    // Check local cache
    if (existsSync(LOCAL_MODEL_PATH)) {
      logger.debug('Using cached Silero VAD model', { path: LOCAL_MODEL_PATH });
      return LOCAL_MODEL_PATH;
    }

    // Download model
    logger.info('Downloading Silero VAD model...');

    const dir = join(homedir(), '.nova', 'models');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const response = await fetch(MODEL_URL);
    if (!response.ok) {
      throw new Error(`Failed to download model: ${response.statusText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    writeFileSync(LOCAL_MODEL_PATH, buffer);

    logger.info('Silero VAD model downloaded', { path: LOCAL_MODEL_PATH });
    return LOCAL_MODEL_PATH;
  }

  /**
   * Initialize Silero VAD model
   */
  private async initialize(): Promise<void> {
    try {
      logger.debug('Loading Silero VAD model...');

      const modelPath = await this.getModelPath();

      this.model = new SileroModel();
      await this.model.init(modelPath);

      // Calculate frame processor options from config
      const sampleRate = this.config.sampleRate;
      const frameSamples = this.config.frameSize;
      const framesPerSecond = sampleRate / frameSamples;

      const processorOptions: FrameProcessorOptions = {
        ...DEFAULT_FRAME_PROCESSOR_OPTIONS,
        positiveSpeechThreshold: this.config.threshold,
        negativeSpeechThreshold: Math.max(0.01, this.config.threshold - 0.15),
        frameSamples: frameSamples,
        minSpeechFrames: Math.max(
          1,
          Math.ceil((this.config.minSpeechDuration / 1000) * framesPerSecond)
        ),
        redemptionFrames: Math.max(
          1,
          Math.ceil((this.config.silenceDuration / 1000) * framesPerSecond)
        ),
      };

      this.frameProcessor = new FrameProcessor(
        (frame) => this.model!.process(frame),
        () => this.model!.reset_state(),
        processorOptions
      );

      logger.info('Silero VAD model loaded', {
        modelPath,
        frameSamples: processorOptions.frameSamples,
        threshold: processorOptions.positiveSpeechThreshold,
      });
    } catch (error) {
      logger.error('Failed to load Silero VAD model', {
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * Start VAD processing
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('VAD already running');
      return;
    }

    try {
      if (!this.model || !this.frameProcessor) {
        await this.initialize();
      }

      this.frameProcessor!.resume();
      this.isRunning = true;
      this.isSpeaking = false;
      this.speechStartTime = 0;

      logger.info('VAD started');
      this.emit('started');
    } catch (error) {
      this.isRunning = false;
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('Failed to start VAD', { error: err.message });
      this.emit('error', err);
      throw err;
    }
  }

  /**
   * Stop VAD processing
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;

    // End any in-progress segment
    if (this.frameProcessor) {
      const result = this.frameProcessor.endSegment();
      if (result.msg && result.audio) {
        this.handleMessage(result.msg, result.audio);
      }
    }

    this.isSpeaking = false;
    this.speechStartTime = 0;

    logger.info('VAD stopped');
    this.emit('stopped');
  }

  /**
   * Process an audio frame
   * @param audio Float32Array of audio samples (expected 16kHz mono)
   */
  async processAudio(audio: Float32Array): Promise<void> {
    if (!this.isRunning || !this.frameProcessor) {
      return;
    }

    try {
      const result = await this.frameProcessor.process(audio);

      // Emit probability if available
      if (result.probs) {
        this.currentProbability = result.probs.isSpeech;
        this.emit('vad-probability', result.probs.isSpeech);
      }

      // Handle message if available (use !== undefined since Message.SpeechStart = 0 is falsy)
      if (result.msg !== undefined) {
        this.handleMessage(result.msg, result.audio);
      }
    } catch (error) {
      logger.error('Error processing audio frame', {
        error: (error as Error).message,
      });
      this.emit('error', error as Error);
    }
  }

  /**
   * Handle VAD message from frame processor
   */
  private handleMessage(msg: Message, audio?: Float32Array): void {
    const now = Date.now();

    switch (msg) {
      case Message.SpeechStart:
        this.isSpeaking = true;
        this.speechStartTime = now;
        logger.debug('Speech started', { timestamp: now });
        this.emit('speech-start', {
          type: 'speech-start',
          timestamp: now,
        } as VADEvent);
        break;

      case Message.SpeechEnd:
        if (this.isSpeaking && audio) {
          const duration = now - this.speechStartTime;

          const segment: SpeechSegment = {
            audio,
            startTime: this.speechStartTime,
            endTime: now,
            duration,
            forcedEnd: false,
          };

          logger.debug('Speech segment complete', {
            duration,
            samples: audio.length,
          });

          this.emit('speech-segment', segment);
        }

        this.emit('speech-end', {
          type: 'speech-end',
          timestamp: now,
          duration: this.isSpeaking ? now - this.speechStartTime : 0,
        } as VADEvent);

        this.isSpeaking = false;
        this.speechStartTime = 0;
        break;

      case Message.VADMisfire:
        logger.debug('VAD misfire - speech too short');
        this.isSpeaking = false;
        this.speechStartTime = 0;
        break;
    }
  }

  /**
   * Update VAD configuration
   */
  updateConfig(config: Partial<VADConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('VAD config updated', config);
  }

  /**
   * Get current VAD status
   */
  getStatus(): VADStatus {
    return {
      isRunning: this.isRunning,
      isSpeaking: this.isSpeaking,
      probability: this.currentProbability,
      speechDuration: this.isSpeaking ? Date.now() - this.speechStartTime : 0,
    };
  }

  /**
   * Check if VAD is running
   */
  get running(): boolean {
    return this.isRunning;
  }

  /**
   * Check if speech is currently detected
   */
  get speaking(): boolean {
    return this.isSpeaking;
  }

  /**
   * Reset the VAD state
   * Call this when starting a new conversation
   */
  reset(): void {
    if (this.frameProcessor) {
      this.frameProcessor.reset();
    }
    if (this.model) {
      this.model.reset_state();
    }
    this.isSpeaking = false;
    this.speechStartTime = 0;
    this.currentProbability = 0;
    logger.debug('VAD state reset');
  }
}

// Singleton instance
let vadManager: VADManager | null = null;

/**
 * Get or create the VAD manager instance
 */
export function getVADManager(): VADManager {
  if (!vadManager) {
    vadManager = new VADManager();
  }
  return vadManager;
}

/**
 * Shutdown the VAD manager
 */
export async function shutdownVADManager(): Promise<void> {
  if (vadManager) {
    await vadManager.stop();
    vadManager = null;
  }
}

export default VADManager;
