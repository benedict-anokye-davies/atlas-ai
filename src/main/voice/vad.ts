/**
 * Nova Voice Activity Detection (VAD) Manager
 * Uses Silero VAD model for detecting speech in audio streams
 *
 * This implementation uses @ricky0123/vad-node's FrameProcessor for real-time
 * voice activity detection.
 *
 * Enhanced Features:
 * - Adaptive silence timeout based on conversation flow
 * - Sentence ending detection for natural turn-taking
 * - "Still listening" state for incomplete thoughts
 * - Configurable pause patterns
 */

import { EventEmitter } from 'events';
import { FrameProcessor, FrameProcessorOptions, Message } from '@ricky0123/vad-node';
import * as ort from 'onnxruntime-node';
import { BrowserWindow } from 'electron';
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
  'still-listening': (event: StillListeningEvent) => void;
  'listening-state': (state: ListeningState) => void;
  error: (error: Error) => void;
  started: () => void;
  stopped: () => void;
}

/**
 * Still listening event - emitted when VAD detects a pause but expects more speech
 */
export interface StillListeningEvent {
  timestamp: number;
  pauseDuration: number;
  reason: 'incomplete_sentence' | 'short_pause' | 'thinking_pause';
  extendedTimeout: number;
}

/**
 * Listening state for UI feedback
 */
export type ListeningState =
  | 'idle' // Not listening
  | 'listening' // Actively listening for speech
  | 'hearing' // Speech detected, capturing
  | 'still_listening' // Pause detected, waiting for more
  | 'processing'; // Speech complete, processing

/**
 * Adaptive silence configuration
 */
export interface AdaptiveSilenceConfig {
  /** Base silence duration (ms) before ending speech */
  baseSilenceMs: number;
  /** Extended silence for incomplete sentences (ms) */
  incompleteSilenceMs: number;
  /** Short pause threshold - pauses shorter trigger "still listening" */
  shortPauseMs: number;
  /** Maximum silence before forced end (ms) */
  maxSilenceMs: number;
  /** Enable sentence ending detection */
  detectSentenceEndings: boolean;
  /** Enable adaptive timeout based on transcript */
  adaptiveTimeout: boolean;
}

/**
 * Default adaptive silence configuration
 */
const DEFAULT_ADAPTIVE_CONFIG: AdaptiveSilenceConfig = {
  baseSilenceMs: 1500,
  incompleteSilenceMs: 2500,
  shortPauseMs: 500,
  maxSilenceMs: 5000,
  detectSentenceEndings: true,
  adaptiveTimeout: true,
};

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
 * Enhanced with adaptive silence timeout and sentence detection
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

  // Adaptive silence state
  private adaptiveConfig: AdaptiveSilenceConfig;
  private currentTranscript: string = '';
  private lastSpeechTime: number = 0;
  private currentListeningState: ListeningState = 'idle';
  private silenceCheckInterval: NodeJS.Timeout | null = null;
  private stillListeningEmitted: boolean = false;

  constructor(config?: Partial<VADConfig> & { adaptive?: Partial<AdaptiveSilenceConfig> }) {
    super();
    const novaConfig = getConfig();

    this.config = {
      ...DEFAULT_VAD_CONFIG,
      threshold: novaConfig.vadThreshold,
      silenceDuration: novaConfig.vadSilenceDuration,
      ...config,
    };

    this.adaptiveConfig = {
      ...DEFAULT_ADAPTIVE_CONFIG,
      ...config?.adaptive,
    };

    logger.info('VADManager initialized', {
      threshold: this.config.threshold,
      silenceDuration: this.config.silenceDuration,
      minSpeechDuration: this.config.minSpeechDuration,
      adaptiveTimeout: this.adaptiveConfig.adaptiveTimeout,
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
      this.currentTranscript = '';
      this.lastSpeechTime = 0;
      this.stillListeningEmitted = false;

      // Start silence monitoring interval
      this.startSilenceMonitoring();

      // Update listening state
      this.setListeningState('listening');

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

    // Stop silence monitoring
    this.stopSilenceMonitoring();

    // End any in-progress segment
    if (this.frameProcessor) {
      const result = this.frameProcessor.endSegment();
      if (result.msg && result.audio) {
        this.handleMessage(result.msg, result.audio);
      }
    }

    this.isSpeaking = false;
    this.speechStartTime = 0;
    this.currentTranscript = '';
    this.lastSpeechTime = 0;
    this.stillListeningEmitted = false;

    // Update listening state
    this.setListeningState('idle');

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
        this.lastSpeechTime = now;
        this.stillListeningEmitted = false;
        this.setListeningState('hearing');
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
          this.setListeningState('processing');
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
        this.setListeningState('listening');
        break;
    }
  }

  /**
   * Start silence monitoring interval
   */
  private startSilenceMonitoring(): void {
    if (this.silenceCheckInterval) {
      clearInterval(this.silenceCheckInterval);
    }

    // Check for extended silence every 200ms
    this.silenceCheckInterval = setInterval(() => {
      this.checkForExtendedSilence();
    }, 200);
  }

  /**
   * Stop silence monitoring interval
   */
  private stopSilenceMonitoring(): void {
    if (this.silenceCheckInterval) {
      clearInterval(this.silenceCheckInterval);
      this.silenceCheckInterval = null;
    }
  }

  /**
   * Check for extended silence and emit "still listening" events
   */
  private checkForExtendedSilence(): void {
    if (!this.isRunning || this.isSpeaking || this.lastSpeechTime === 0) {
      return;
    }

    const now = Date.now();
    const silenceDuration = now - this.lastSpeechTime;

    // Check if we should emit "still listening"
    if (
      silenceDuration >= this.adaptiveConfig.shortPauseMs &&
      silenceDuration < this.getEffectiveSilenceTimeout() &&
      !this.stillListeningEmitted
    ) {
      const reason = this.detectPauseReason();
      const extendedTimeout = this.getEffectiveSilenceTimeout();

      this.stillListeningEmitted = true;
      this.setListeningState('still_listening');

      const event: StillListeningEvent = {
        timestamp: now,
        pauseDuration: silenceDuration,
        reason,
        extendedTimeout,
      };

      logger.debug('Still listening', {
        pauseDuration: silenceDuration,
        reason,
        extendedTimeout,
      });

      this.emit('still-listening', event);
      this.sendStillListeningToRenderer(event);
    }
  }

  /**
   * Detect the reason for the current pause
   */
  private detectPauseReason(): 'incomplete_sentence' | 'short_pause' | 'thinking_pause' {
    if (!this.adaptiveConfig.detectSentenceEndings) {
      return 'short_pause';
    }

    const transcript = this.currentTranscript.trim().toLowerCase();

    // Check for incomplete sentence patterns
    if (this.isIncompleteSentence(transcript)) {
      return 'incomplete_sentence';
    }

    // Check for thinking patterns
    if (this.isThinkingPause(transcript)) {
      return 'thinking_pause';
    }

    return 'short_pause';
  }

  /**
   * Check if the current transcript appears to be an incomplete sentence
   */
  private isIncompleteSentence(transcript: string): boolean {
    if (!transcript) return false;

    // Ends with continuation words
    const continuationEndings = [
      'and',
      'but',
      'or',
      'so',
      'because',
      'although',
      'however',
      'therefore',
      'then',
      'if',
      'when',
      'while',
      'unless',
      'until',
      'after',
      'before',
      'that',
      'which',
      'who',
      'whom',
      'whose',
      'where',
      'like',
      'such as',
      'for example',
      'including',
      'especially',
      'particularly',
      'the',
      'a',
      'an',
      'my',
      'your',
      'their',
      'its',
      'to',
      'for',
      'with',
      'of',
      'in',
      'on',
      'at',
      'by',
    ];

    const lastWord = transcript.split(/\s+/).pop() || '';

    if (continuationEndings.includes(lastWord)) {
      return true;
    }

    // Ends with comma (incomplete list or clause)
    if (transcript.endsWith(',')) {
      return true;
    }

    // Ends with ellipsis or dash (trailing off)
    if (transcript.endsWith('...') || transcript.endsWith('-') || transcript.endsWith('—')) {
      return true;
    }

    return false;
  }

  /**
   * Check if the pause appears to be a thinking pause
   */
  private isThinkingPause(transcript: string): boolean {
    if (!transcript) return false;

    // Thinking indicators
    const thinkingPatterns = [
      /\bum+\b$/i,
      /\buh+\b$/i,
      /\bhmm+\b$/i,
      /\blet me (think|see)\b/i,
      /\bi (think|guess|mean)\b$/i,
      /\bwell\b$/i,
      /\bso\b$/i,
      /\bactually\b$/i,
    ];

    return thinkingPatterns.some((pattern) => pattern.test(transcript));
  }

  /**
   * Get the effective silence timeout based on adaptive settings
   */
  private getEffectiveSilenceTimeout(): number {
    if (!this.adaptiveConfig.adaptiveTimeout) {
      return this.adaptiveConfig.baseSilenceMs;
    }

    const transcript = this.currentTranscript.trim().toLowerCase();

    // Check for complete sentence (ends with terminal punctuation)
    if (this.isCompleteSentence(transcript)) {
      return this.adaptiveConfig.baseSilenceMs;
    }

    // Check for incomplete sentence
    if (this.isIncompleteSentence(transcript)) {
      return this.adaptiveConfig.incompleteSilenceMs;
    }

    // Check for thinking pause
    if (this.isThinkingPause(transcript)) {
      return this.adaptiveConfig.incompleteSilenceMs;
    }

    return this.adaptiveConfig.baseSilenceMs;
  }

  /**
   * Check if the transcript appears to be a complete sentence
   */
  private isCompleteSentence(transcript: string): boolean {
    if (!transcript) return false;

    // Ends with terminal punctuation
    return /[.!?]$/.test(transcript);
  }

  /**
   * Set and broadcast the current listening state
   */
  private setListeningState(state: ListeningState): void {
    if (this.currentListeningState === state) return;

    this.currentListeningState = state;
    this.emit('listening-state', state);

    // Send to renderer via IPC
    this.sendListeningStateToRenderer(state);

    logger.debug('Listening state changed', { state });
  }

  /**
   * Send still listening event to renderer
   */
  private sendStillListeningToRenderer(event: StillListeningEvent): void {
    try {
      const mainWindow = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('nova:still-listening', event);
      }
    } catch (error) {
      logger.debug('Could not send still-listening to renderer', { error });
    }
  }

  /**
   * Send listening state to renderer
   */
  private sendListeningStateToRenderer(state: ListeningState): void {
    try {
      const mainWindow = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('nova:listening-state', state);
      }
    } catch (error) {
      logger.debug('Could not send listening-state to renderer', { error });
    }
  }

  /**
   * Update the current transcript (called by STT integration)
   * This allows VAD to make adaptive decisions based on what's being said
   */
  setCurrentTranscript(transcript: string): void {
    this.currentTranscript = transcript;
    this.lastSpeechTime = Date.now();
    this.stillListeningEmitted = false;

    // If we were in "still listening" state, go back to "hearing"
    if (this.currentListeningState === 'still_listening') {
      this.setListeningState('hearing');
    }
  }

  /**
   * Update adaptive silence configuration
   */
  updateAdaptiveConfig(config: Partial<AdaptiveSilenceConfig>): void {
    this.adaptiveConfig = { ...this.adaptiveConfig, ...config };
    logger.info('Adaptive config updated', config);
  }

  /**
   * Get current adaptive silence configuration
   */
  getAdaptiveConfig(): AdaptiveSilenceConfig {
    return { ...this.adaptiveConfig };
  }

  /**
   * Get current listening state
   */
  getListeningState(): ListeningState {
    return this.currentListeningState;
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
  getStatus(): VADStatus & { listeningState: ListeningState } {
    return {
      isRunning: this.isRunning,
      isSpeaking: this.isSpeaking,
      probability: this.currentProbability,
      speechDuration: this.isSpeaking ? Date.now() - this.speechStartTime : 0,
      listeningState: this.currentListeningState,
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
    this.currentTranscript = '';
    this.lastSpeechTime = 0;
    this.stillListeningEmitted = false;
    this.setListeningState('listening');
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
