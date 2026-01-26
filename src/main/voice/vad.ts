/**
 * Atlas Voice Activity Detection (VAD) Manager
 *
 * Real-time voice activity detection using the Silero VAD model for detecting
 * speech in audio streams. This is the core component that determines when the
 * user starts and stops speaking.
 *
 * Architecture:
 * - Uses ONNX Runtime for efficient model inference
 * - Frame-based processing with configurable window sizes
 * - Adaptive thresholds that learn from ambient noise
 * - Multiple VAD modes for different environments
 *
 * Key Features:
 * - Adaptive silence timeout based on conversation flow
 * - Sentence ending detection for natural turn-taking
 * - "Still listening" state for incomplete thoughts
 * - Configurable pause patterns
 * - Adaptive thresholds based on ambient noise
 * - Noise profiling during initialization
 * - VAD modes: aggressive, balanced, permissive
 * - Accuracy metrics tracking
 *
 * @module voice/vad
 *
 * @example
 * ```typescript
 * const vad = new VADManager({ mode: 'balanced' });
 * await vad.start();
 *
 * vad.on('speech-start', (event) => console.log('User started speaking'));
 * vad.on('speech-end', (event) => console.log('User stopped speaking'));
 *
 * // Process audio frames
 * vad.processFrame(audioFloat32Array);
 *
 * // Graceful shutdown
 * await vad.stop();
 * ```
 */

import { EventEmitter } from 'events';
import { FrameProcessor, FrameProcessorOptions, Message } from '@ricky0123/vad-node';
import * as ort from 'onnxruntime-node';
import { sendToMainWindow } from '../utils/main-window';
import { createModuleLogger } from '../utils/logger';
import { getConfig } from '../config';
import {
  VADConfig,
  VADEvent,
  SpeechSegment,
  DEFAULT_VAD_CONFIG,
  VADMode,
  VAD_MODE_PRESETS,
  NoiseProfile,
  NoiseEnvironmentType,
  NOISE_ENVIRONMENT_THRESHOLDS,
  AdaptiveVADConfig,
  DEFAULT_ADAPTIVE_VAD_CONFIG,
  VADAccuracyMetrics,
  DEFAULT_VAD_ACCURACY_METRICS,
  AdaptiveThresholdState,
  AdaptiveVADStatus,
} from '../../shared/types/voice';
import { join } from 'path';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { homedir } from 'os';

const logger = createModuleLogger('VAD');

// =============================================================================
// Constants
// =============================================================================

/**
 * Model configuration constants.
 * These paths define where the Silero VAD model is located or downloaded.
 */
const MODEL_PATHS = {
  /** Path to bundled model included with @ricky0123/vad-node */
  BUNDLED: join(require.resolve('@ricky0123/vad-node'), '..', 'silero_vad.onnx'),

  /** Local cache path for downloaded model */
  LOCAL_CACHE: join(homedir(), '.atlas', 'models', 'silero_vad.onnx'),

  /** Remote URL for model download (fallback) */
  DOWNLOAD_URL: 'https://github.com/snakers4/silero-vad/raw/master/files/silero_vad.onnx',
} as const;

/**
 * Frame processor configuration.
 *
 * These values control the sensitivity and responsiveness of speech detection.
 * Tuned for real-time voice assistant use with low latency requirements.
 *
 * @remarks
 * - Lower positiveSpeechThreshold = more sensitive to speech (may have false positives)
 * - Higher redemptionFrames = longer pause before speech-end (more natural but slower)
 * - Lower minSpeechFrames = detect shorter utterances (better for "yes"/"no" responses)
 */
const FRAME_PROCESSOR_DEFAULTS: FrameProcessorOptions = {
  /** Probability threshold to start detecting speech (lowered from 0.5 for sensitivity) */
  positiveSpeechThreshold: 0.15,

  /** Probability threshold to stop detecting speech (hysteresis for stability) */
  negativeSpeechThreshold: 0.10,

  /** Frames to include before speech detection (captures word beginnings) */
  preSpeechPadFrames: 1,

  /** Frames of silence before ending speech (reduced from 12 for faster response) */
  redemptionFrames: 6,

  /** Samples per frame (must match model expectations) */
  frameSamples: 1536,

  /** Minimum frames to consider valid speech (reduced from 3 for short utterances) */
  minSpeechFrames: 2,

  /** Submit partial speech on pause for real-time feedback */
  submitUserSpeechOnPause: true,
} as const;

/**
 * Adaptive threshold calculation constants.
 */
const ADAPTIVE_CONSTANTS = {
  /** Number of probability samples to keep for rolling average */
  PROBABILITY_HISTORY_SIZE: 100,

  /** Minimum samples needed before noise profile is valid */
  NOISE_PROFILE_MIN_SAMPLES: 50,

  /** Maximum samples for noise profile (prevents memory growth) */
  NOISE_PROFILE_MAX_SAMPLES: 200,
} as const;

/**
 * Adaptive silence configuration.
 *
 * Controls how the system handles pauses in speech to determine when the user
 * has finished speaking vs. is just pausing to think.
 */
const ADAPTIVE_SILENCE_DEFAULTS: AdaptiveSilenceConfig = {
  /** Base silence duration before ending speech (ms) - reduced for faster response */
  baseSilenceMs: 800,

  /** Extended silence for incomplete sentences (ms) */
  incompleteSilenceMs: 1500,

  /** Pauses shorter than this trigger "still listening" feedback (ms) */
  shortPauseMs: 300,

  /** Maximum silence before forced speech end (ms) - prevents hanging */
  maxSilenceMs: 3000,

  /** Enable heuristic detection of incomplete sentences */
  detectSentenceEndings: true,

  /** Adjust timeout dynamically based on transcript content */
  adaptiveTimeout: true,
} as const;

// =============================================================================
// Types
// =============================================================================

/**
 * Events emitted by VADManager.
 * Use these to react to speech detection state changes.
 */
export interface VADManagerEvents {
  /** Emitted when speech is first detected */
  'speech-start': (event: VADEvent) => void;

  /** Emitted when speech ends (after silence timeout) */
  'speech-end': (event: VADEvent) => void;

  /** Emitted with complete speech segment including audio */
  'speech-segment': (segment: SpeechSegment) => void;

  /** Emitted on each frame with current speech probability (0-1) */
  'vad-probability': (probability: number) => void;

  /** Emitted during pause when more speech is expected */
  'still-listening': (event: StillListeningEvent) => void;

  /** Emitted on listening state transitions (for UI) */
  'listening-state': (state: ListeningState) => void;

  /** Emitted when noise profile is updated */
  'noise-profile-updated': (profile: NoiseProfile) => void;

  /** Emitted when VAD mode changes */
  'mode-changed': (from: VADMode, to: VADMode, reason: string) => void;

  /** Emitted when adaptive threshold is adjusted */
  'threshold-adapted': (state: AdaptiveThresholdState) => void;

  /** Emitted when accuracy metrics are updated */
  'metrics-updated': (metrics: VADAccuracyMetrics) => void;

  /** Emitted when detected noise environment changes */
  'environment-changed': (type: NoiseEnvironmentType) => void;

  /** Emitted when whisper mode is enabled/disabled */
  'whisper-mode-changed': (
    enabled: boolean,
    reason: 'manual' | 'auto_detect' | 'voice_command',
  ) => void;

  /** Emitted when whispered speech is detected */
  'whisper-detected': (rmsLevel: number, confidence: number) => void;

  /** Emitted when normal (non-whispered) speech is detected */
  'normal-speech-detected': (rmsLevel: number) => void;

  /** Emitted on errors (subscribe to handle gracefully) */
  error: (error: Error) => void;

  /** Emitted when VAD processing starts */
  started: () => void;

  /** Emitted when VAD processing stops */
  stopped: () => void;
}

/**
 * Event emitted when VAD detects a pause but expects more speech.
 * Useful for showing "still listening..." UI feedback.
 */
export interface StillListeningEvent {
  /** Event timestamp (Unix ms) */
  timestamp: number;

  /** How long the pause has been (ms) */
  pauseDuration: number;

  /** Why we think there's more speech coming */
  reason: 'incomplete_sentence' | 'short_pause' | 'thinking_pause';

  /** How much longer we'll wait (ms) */
  extendedTimeout: number;
}

/**
 * Listening state for UI feedback.
 * Transitions: idle -> listening -> hearing -> still_listening -> processing -> idle
 */
export type ListeningState =
  | 'idle' // Not listening for speech
  | 'listening' // Actively listening, no speech yet
  | 'hearing' // Speech detected, capturing audio
  | 'still_listening' // Pause detected, waiting for more speech
  | 'processing'; // Speech complete, being processed

/**
 * Configuration for adaptive silence detection.
 */
export interface AdaptiveSilenceConfig {
  /** Base silence duration before ending speech (ms) */
  baseSilenceMs: number;

  /** Extended silence for incomplete sentences (ms) */
  incompleteSilenceMs: number;

  /** Short pause threshold - pauses shorter trigger "still listening" (ms) */
  shortPauseMs: number;

  /** Maximum silence before forced end (ms) */
  maxSilenceMs: number;

  /** Enable sentence ending detection heuristics */
  detectSentenceEndings: boolean;

  /** Enable adaptive timeout based on transcript content */
  adaptiveTimeout: boolean;
}

/**
 * Internal state for noise profiling during initialization.
 */
interface NoiseProfilingState {
  isActive: boolean;
  startTime: number;
  samples: number[];
  rmsValues: number[];
  peakValues: number[];
  lowFreqEnergy: number[];
  midFreqEnergy: number[];
  highFreqEnergy: number[];
}

// =============================================================================
// Silero Model Wrapper
// =============================================================================

/**
 * Wrapper for the Silero VAD ONNX model.
 *
 * Manages the ONNX Runtime inference session and internal state tensors.
 * The Silero model is stateful (RNN-based), so state must be maintained
 * between frame processing calls.
 *
 * @internal
 */
class SileroModel {
  private session: ort.InferenceSession | null = null;
  private _h: ort.Tensor | null = null;
  private _c: ort.Tensor | null = null;
  private _sr: ort.Tensor | null = null;

  /**
   * Initialize the ONNX session with the model file.
   * @param modelPath - Path to the silero_vad.onnx file
   * @throws {Error} If model loading fails
   */
  async init(modelPath: string): Promise<void> {
    this.session = await ort.InferenceSession.create(modelPath);
    this.reset_state();
    logger.debug('Silero ONNX session created');
  }

  /**
   * Reset the RNN state tensors.
   * Call this when starting a new audio stream to clear history.
   */
  reset_state(): void {
    const zeroes = new Float32Array(2 * 64).fill(0);
    this._h = new ort.Tensor('float32', zeroes, [2, 1, 64]);
    this._c = new ort.Tensor('float32', zeroes, [2, 1, 64]);
    this._sr = new ort.Tensor('int64', BigInt64Array.from([BigInt(16000)]), []);
  }

  /**
   * Process an audio frame and return speech probability.
   *
   * @param audioFrame - Float32Array of audio samples (normalized -1 to 1)
   * @returns Speech and non-speech probabilities
   * @throws {Error} If model is not initialized
   */
  async process(audioFrame: Float32Array): Promise<{ isSpeech: number; notSpeech: number }> {
    if (!this.session) {
      throw new Error('Model not initialized - call init() first');
    }

    const input = new ort.Tensor('float32', audioFrame, [1, audioFrame.length]);

    const feeds = {
      input: input,
      h: this._h!,
      c: this._c!,
      sr: this._sr!,
    };

    const result = await this.session.run(feeds);

    // Update RNN state for next frame
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

// =============================================================================
// VADManager Class
// =============================================================================

/**
 * Voice Activity Detection Manager.
 *
 * Detects speech segments in audio streams using the Silero VAD model.
 * Provides adaptive silence timeout, sentence detection, and noise profiling
 * for natural conversation flow.
 *
 * @example
 * ```typescript
 * const vad = new VADManager({
 *   threshold: 0.3,
 *   adaptive: { baseSilenceMs: 1000 },
 *   adaptiveVAD: { mode: 'balanced' },
 * });
 *
 * await vad.start();
 *
 * vad.on('speech-start', () => startRecording());
 * vad.on('speech-end', () => processRecording());
 * vad.on('still-listening', (event) => showFeedback(event.reason));
 *
 * // Feed audio frames from microphone
 * audioStream.on('data', (frame) => vad.processFrame(frame));
 * ```
 *
 * @fires speech-start - When speech begins
 * @fires speech-end - When speech ends (after silence timeout)
 * @fires speech-segment - With complete audio segment
 * @fires still-listening - During pause when more speech expected
 */
export class VADManager extends EventEmitter {
  private model: SileroModel | null = null;
  private frameProcessor: FrameProcessor | null = null;
  private isRunning: boolean = false;
  private isClosing: boolean = false;
  private isProcessing: boolean = false;
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

  // Adaptive VAD state
  private adaptiveVADConfig: AdaptiveVADConfig;
  private currentMode: VADMode = 'balanced';
  private noiseProfile: NoiseProfile | null = null;
  private adaptiveThresholdState: AdaptiveThresholdState;
  private metrics: VADAccuracyMetrics;
  private metricsStartTime: number = 0;
  private modeStartTime: number = 0;
  private lastSpeechEndTime: number = 0;
  private speechDurations: number[] = [];
  private silenceDurations: number[] = [];
  private pendingSegmentValidation: Map<number, { startTime: number; duration: number }> =
    new Map();

  // Noise profiling state
  private noiseProfilingState: NoiseProfilingState = {
    isActive: false,
    startTime: 0,
    samples: [],
    rmsValues: [],
    peakValues: [],
    lowFreqEnergy: [],
    midFreqEnergy: [],
    highFreqEnergy: [],
  };
  private noiseProfileUpdateInterval: NodeJS.Timeout | null = null;

  /**
   * Creates a new VADManager instance.
   *
   * @param config - Configuration options (merged with defaults)
   * @param config.adaptive - Adaptive silence configuration
   * @param config.adaptiveVAD - Adaptive VAD mode configuration
   */
  constructor(
    config?: Partial<VADConfig> & {
      adaptive?: Partial<AdaptiveSilenceConfig>;
      adaptiveVAD?: Partial<AdaptiveVADConfig>;
    },
  ) {
    super();
    this.setMaxListeners(20); // Prevent memory leak warnings
    const atlasConfig = getConfig();

    this.config = {
      ...DEFAULT_VAD_CONFIG,
      threshold: atlasConfig.vadThreshold,
      silenceDuration: atlasConfig.vadSilenceDuration,
      ...config,
    };

    this.adaptiveConfig = {
      ...ADAPTIVE_SILENCE_DEFAULTS,
      ...config?.adaptive,
    };

    this.adaptiveVADConfig = {
      ...DEFAULT_ADAPTIVE_VAD_CONFIG,
      ...config?.adaptiveVAD,
    };

    this.currentMode = this.adaptiveVADConfig.mode;

    // Initialize adaptive threshold state from mode preset
    const preset = VAD_MODE_PRESETS[this.currentMode];
    this.adaptiveThresholdState = {
      currentThreshold: preset.positiveSpeechThreshold,
      baseThreshold: preset.positiveSpeechThreshold,
      noiseAdjustment: 0,
      activityAdjustment: 0,
      currentNoiseFloor: 0,
      recentProbabilities: [],
      isAdapting: false,
      lastAdaptation: 0,
    };

    // Initialize metrics
    this.metrics = { ...DEFAULT_VAD_ACCURACY_METRICS };

    logger.info('VADManager initialized', {
      threshold: this.config.threshold,
      silenceDuration: this.config.silenceDuration,
      minSpeechDuration: this.config.minSpeechDuration,
      adaptiveTimeout: this.adaptiveConfig.adaptiveTimeout,
      adaptiveVADEnabled: this.adaptiveVADConfig.enabled,
      mode: this.currentMode,
    });
  }

  /**
   * Gets the path to the Silero VAD model, downloading if necessary.
   *
   * Resolution order:
   * 1. Bundled model from @ricky0123/vad-node package
   * 2. Local cache at ~/.atlas/models/
   * 3. Download from GitHub (fallback)
   *
   * @returns Path to the ONNX model file
   * @throws {Error} If model cannot be found or downloaded
   */
  private async getModelPath(): Promise<string> {
    // Try bundled model first (preferred - no download needed)
    if (existsSync(MODEL_PATHS.BUNDLED)) {
      logger.debug('Using bundled Silero VAD model', { path: MODEL_PATHS.BUNDLED });
      return MODEL_PATHS.BUNDLED;
    }

    // Check local cache (previously downloaded)
    if (existsSync(MODEL_PATHS.LOCAL_CACHE)) {
      logger.debug('Using cached Silero VAD model', { path: MODEL_PATHS.LOCAL_CACHE });
      return MODEL_PATHS.LOCAL_CACHE;
    }

    // Download model as fallback
    logger.info('Downloading Silero VAD model (bundled not found)...');

    const dir = join(homedir(), '.atlas', 'models');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const response = await fetch(MODEL_PATHS.DOWNLOAD_URL);
    if (!response.ok) {
      throw new Error(`Failed to download VAD model: ${response.status} ${response.statusText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    writeFileSync(MODEL_PATHS.LOCAL_CACHE, buffer);

    logger.info('Silero VAD model downloaded successfully', { path: MODEL_PATHS.LOCAL_CACHE });
    return MODEL_PATHS.LOCAL_CACHE;
  }

  /**
   * Initializes the Silero VAD model and frame processor.
   *
   * @throws {Error} If model loading fails
   */
  private async initialize(): Promise<void> {
    try {
      logger.debug('Loading Silero VAD model...');

      const modelPath = await this.getModelPath();

      this.model = new SileroModel();
      await this.model.init(modelPath);

      this.createFrameProcessor();

      logger.info('Silero VAD model loaded', {
        modelPath,
        mode: this.currentMode,
      });
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to load Silero VAD model', { error: err.message });
      throw new Error(`VAD initialization failed: ${err.message}`);
    }
  }

  /**
   * Creates or recreates the frame processor with current mode settings.
   *
   * The frame processor handles the low-level speech detection logic,
   * including threshold comparison and state machine management.
   */
  private createFrameProcessor(): void {
    const sampleRate = this.config.sampleRate;
    const frameSamples = this.config.frameSize;
    const framesPerSecond = sampleRate / frameSamples;

    const preset = VAD_MODE_PRESETS[this.currentMode];
    const effectiveThreshold = this.adaptiveVADConfig.enabled
      ? this.adaptiveThresholdState.currentThreshold
      : preset.positiveSpeechThreshold;

    // Calculate frame-based parameters from time-based config
    const minSpeechFrames = Math.max(
      1,
      Math.ceil((this.config.minSpeechDuration / 1000) * framesPerSecond),
    );
    const redemptionFrames = Math.max(
      1,
      Math.ceil((this.config.silenceDuration / 1000) * framesPerSecond),
    );

    const processorOptions: FrameProcessorOptions = {
      ...FRAME_PROCESSOR_DEFAULTS,
      positiveSpeechThreshold: effectiveThreshold,
      negativeSpeechThreshold: Math.max(0.01, effectiveThreshold - 0.15),
      frameSamples: frameSamples,
      minSpeechFrames,
      redemptionFrames,
    };

    this.frameProcessor = new FrameProcessor(
      (frame) => this.model!.process(frame),
      () => this.model!.reset_state(),
      processorOptions,
    );

    logger.debug('Frame processor created', {
      threshold: effectiveThreshold,
      mode: this.currentMode,
      minSpeechFrames,
      redemptionFrames,
    });
  }

  /**
   * Starts VAD processing.
   *
   * Initializes the model if not already done, resets state, and begins
   * noise profiling if adaptive VAD is enabled.
   *
   * @fires started - When processing begins
   * @throws {Error} If initialization fails
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('VAD already running, ignoring start request');
      return;
    }

    try {
      if (!this.model || !this.frameProcessor) {
        await this.initialize();
      }

      this.frameProcessor!.resume();
      this.isRunning = true;
      this.isClosing = false;
      this.isProcessing = false;
      this.isSpeaking = false;
      this.speechStartTime = 0;
      this.currentTranscript = '';
      this.lastSpeechTime = 0;
      this.stillListeningEmitted = false;

      // Initialize metrics timing
      this.metricsStartTime = Date.now();
      this.modeStartTime = Date.now();

      // Start noise profiling if adaptive VAD is enabled
      if (this.adaptiveVADConfig.enabled) {
        this.startNoiseProfiling();
      }

      // Start silence monitoring interval
      this.startSilenceMonitoring();

      // Start noise profile update interval if configured
      if (this.adaptiveVADConfig.enabled && this.adaptiveVADConfig.noiseProfileUpdateInterval > 0) {
        this.startNoiseProfileUpdateInterval();
      }

      // Update listening state
      this.setListeningState('listening');

      logger.info('VAD started', {
        adaptiveEnabled: this.adaptiveVADConfig.enabled,
        mode: this.currentMode,
      });
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

    // Set closing flag FIRST to prevent race conditions
    this.isClosing = true;
    this.isRunning = false;

    // Stop intervals
    this.stopSilenceMonitoring();
    this.stopNoiseProfileUpdateInterval();
    this.stopNoiseProfiling();

    // Update mode metrics before stopping
    this.updateModeMetrics();

    // Wait for any in-progress audio processing to complete
    const maxWait = 500;
    const startWait = Date.now();
    while (this.isProcessing && Date.now() - startWait < maxWait) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    // End any in-progress segment with error handling
    if (this.frameProcessor) {
      try {
        const result = this.frameProcessor.endSegment();
        if (result.msg !== undefined && result.audio) {
          this.handleMessage(result.msg, result.audio);
        }
      } catch (error) {
        logger.warn('Error ending VAD segment during stop', {
          error: (error as Error).message,
        });
      }
    }

    this.isSpeaking = false;
    this.speechStartTime = 0;
    this.currentTranscript = '';
    this.lastSpeechTime = 0;
    this.stillListeningEmitted = false;
    this.isProcessing = false;

    // Update listening state
    this.setListeningState('idle');

    logger.info('VAD stopped');
    this.emit('stopped');
  }

  /**
   * Start noise profiling to learn ambient noise characteristics
   */
  private startNoiseProfiling(): void {
    logger.info('Starting noise profiling...');

    this.noiseProfilingState = {
      isActive: true,
      startTime: Date.now(),
      samples: [],
      rmsValues: [],
      peakValues: [],
      lowFreqEnergy: [],
      midFreqEnergy: [],
      highFreqEnergy: [],
    };

    // Set a timeout to complete profiling
    setTimeout(() => {
      this.completeNoiseProfiling();
    }, this.adaptiveVADConfig.noiseProfilingDuration);
  }

  /**
   * Stop noise profiling
   */
  private stopNoiseProfiling(): void {
    this.noiseProfilingState.isActive = false;
  }

  /**
   * Process audio frame for noise profiling
   */
  private processNoiseProfilingFrame(audio: Float32Array): void {
    if (
      !this.noiseProfilingState.isActive ||
      this.noiseProfilingState.samples.length >= ADAPTIVE_CONSTANTS.NOISE_PROFILE_MAX_SAMPLES
    ) {
      return;
    }

    // Calculate RMS
    let sum = 0;
    let peak = 0;
    for (let i = 0; i < audio.length; i++) {
      const sample = Math.abs(audio[i]);
      sum += sample * sample;
      if (sample > peak) peak = sample;
    }
    const rms = Math.sqrt(sum / audio.length);

    this.noiseProfilingState.rmsValues.push(rms);
    this.noiseProfilingState.peakValues.push(peak);

    // Simple spectral analysis (simplified for performance)
    if (this.adaptiveVADConfig.enableSpectralAnalysis) {
      const spectral = this.calculateSimpleSpectrum(audio);
      this.noiseProfilingState.lowFreqEnergy.push(spectral.low);
      this.noiseProfilingState.midFreqEnergy.push(spectral.mid);
      this.noiseProfilingState.highFreqEnergy.push(spectral.high);
    }

    this.noiseProfilingState.samples.push(rms);
  }

  /**
   * Calculate simple spectral energy bands
   * This is a simplified version - in production you might use FFT
   */
  private calculateSimpleSpectrum(audio: Float32Array): {
    low: number;
    mid: number;
    high: number;
  } {
    // Simple approximation using zero-crossing rate and energy
    // Low frequencies: slower variations, Mid: moderate, High: rapid variations
    let lowEnergy = 0;
    let midEnergy = 0;
    let highEnergy = 0;

    for (let i = 1; i < audio.length; i++) {
      const diff = Math.abs(audio[i] - audio[i - 1]);
      const energy = audio[i] * audio[i];

      // Classify energy based on local variation
      if (diff < 0.05) {
        lowEnergy += energy;
      } else if (diff < 0.15) {
        midEnergy += energy;
      } else {
        highEnergy += energy;
      }
    }

    const total = lowEnergy + midEnergy + highEnergy || 1;

    return {
      low: lowEnergy / total,
      mid: midEnergy / total,
      high: highEnergy / total,
    };
  }

  /**
   * Complete noise profiling and build the noise profile
   */
  private completeNoiseProfiling(): void {
    if (
      !this.noiseProfilingState.isActive ||
      this.noiseProfilingState.rmsValues.length < ADAPTIVE_CONSTANTS.NOISE_PROFILE_MIN_SAMPLES
    ) {
      logger.warn('Noise profiling incomplete - insufficient samples', {
        samples: this.noiseProfilingState.rmsValues.length,
        required: ADAPTIVE_CONSTANTS.NOISE_PROFILE_MIN_SAMPLES,
      });

      // Use default profile
      this.noiseProfile = this.createDefaultNoiseProfile();
      this.noiseProfilingState.isActive = false;
      return;
    }

    const rmsValues = this.noiseProfilingState.rmsValues;
    const peakValues = this.noiseProfilingState.peakValues;

    // Calculate statistics
    const noiseFloor = this.calculateMean(rmsValues);
    const peakNoiseLevel = Math.max(...peakValues);
    const noiseStdDev = this.calculateStdDev(rmsValues);

    // Calculate spectral profile if available
    let spectralProfile = { lowFreqEnergy: 0.33, midFreqEnergy: 0.34, highFreqEnergy: 0.33 };
    if (this.adaptiveVADConfig.enableSpectralAnalysis) {
      spectralProfile = {
        lowFreqEnergy: this.calculateMean(this.noiseProfilingState.lowFreqEnergy),
        midFreqEnergy: this.calculateMean(this.noiseProfilingState.midFreqEnergy),
        highFreqEnergy: this.calculateMean(this.noiseProfilingState.highFreqEnergy),
      };
    }

    // Classify environment
    const environmentType = this.classifyEnvironment(noiseFloor, peakNoiseLevel);

    // Estimate SNR (assuming typical speech at ~0.3 RMS)
    const typicalSpeechLevel = 0.3;
    const estimatedSNR = noiseFloor > 0 ? 20 * Math.log10(typicalSpeechLevel / noiseFloor) : 30;

    this.noiseProfile = {
      noiseFloor,
      peakNoiseLevel,
      noiseStdDev,
      estimatedSNR,
      spectralProfile,
      createdAt: Date.now(),
      profilingDuration: Date.now() - this.noiseProfilingState.startTime,
      sampleCount: rmsValues.length,
      isValid: true,
      environmentType,
    };

    this.noiseProfilingState.isActive = false;

    logger.info('Noise profile complete', {
      noiseFloor: noiseFloor.toFixed(4),
      peakNoiseLevel: peakNoiseLevel.toFixed(4),
      estimatedSNR: estimatedSNR.toFixed(1),
      environmentType,
      samples: rmsValues.length,
    });

    // Emit event
    this.emit('noise-profile-updated', this.noiseProfile);

    // Apply adaptive threshold based on noise profile
    this.applyAdaptiveThreshold();

    // Auto-select mode if enabled
    if (this.adaptiveVADConfig.autoModeSelection) {
      this.autoSelectMode();
    }
  }

  /**
   * Create a default noise profile when profiling fails
   */
  private createDefaultNoiseProfile(): NoiseProfile {
    return {
      noiseFloor: 0.02,
      peakNoiseLevel: 0.05,
      noiseStdDev: 0.01,
      estimatedSNR: 20,
      spectralProfile: {
        lowFreqEnergy: 0.4,
        midFreqEnergy: 0.35,
        highFreqEnergy: 0.25,
      },
      createdAt: Date.now(),
      profilingDuration: 0,
      sampleCount: 0,
      isValid: false,
      environmentType: 'unknown',
    };
  }

  /**
   * Classify the noise environment based on measured levels
   */
  private classifyEnvironment(noiseFloor: number, peakNoise: number): NoiseEnvironmentType {
    const thresholds = NOISE_ENVIRONMENT_THRESHOLDS;

    if (noiseFloor <= thresholds.quiet.maxNoiseFloor && peakNoise <= thresholds.quiet.maxPeak) {
      return 'quiet';
    }
    if (noiseFloor <= thresholds.normal.maxNoiseFloor && peakNoise <= thresholds.normal.maxPeak) {
      return 'normal';
    }
    if (noiseFloor <= thresholds.noisy.maxNoiseFloor && peakNoise <= thresholds.noisy.maxPeak) {
      return 'noisy';
    }
    return 'very_noisy';
  }

  /**
   * Apply adaptive threshold based on noise profile
   */
  private applyAdaptiveThreshold(): void {
    if (!this.adaptiveVADConfig.enabled || !this.noiseProfile) {
      return;
    }

    const preset = VAD_MODE_PRESETS[this.currentMode];
    const baseThreshold = preset.positiveSpeechThreshold;

    // Calculate noise adjustment
    // Higher noise floor -> higher threshold needed
    const noiseAdjustment =
      this.noiseProfile.noiseFloor *
      preset.noiseFloorMultiplier *
      this.adaptiveVADConfig.noiseFloorWeight;

    // Calculate activity adjustment based on recent probabilities
    let activityAdjustment = 0;
    if (this.adaptiveThresholdState.recentProbabilities.length > 10) {
      const recentAvg = this.calculateMean(this.adaptiveThresholdState.recentProbabilities);
      // If lots of high probabilities (possible false positives), increase threshold
      // If lots of low probabilities (possible missed speech), decrease threshold
      activityAdjustment = (recentAvg - 0.5) * 0.2 * this.adaptiveVADConfig.activityWeight;
    }

    // Calculate new threshold with smoothing
    const rawThreshold = baseThreshold + noiseAdjustment + activityAdjustment;
    const clampedThreshold = Math.max(
      this.adaptiveVADConfig.minThreshold,
      Math.min(this.adaptiveVADConfig.maxThreshold, rawThreshold)
    );

    // Apply smoothing
    const previousThreshold = this.adaptiveThresholdState.currentThreshold;
    const newThreshold =
      previousThreshold * this.adaptiveVADConfig.thresholdSmoothing +
      clampedThreshold * (1 - this.adaptiveVADConfig.thresholdSmoothing);

    // Update state
    this.adaptiveThresholdState = {
      currentThreshold: newThreshold,
      baseThreshold,
      noiseAdjustment,
      activityAdjustment,
      currentNoiseFloor: this.noiseProfile.noiseFloor,
      recentProbabilities: this.adaptiveThresholdState.recentProbabilities,
      isAdapting: true,
      lastAdaptation: Date.now(),
    };

    // Recreate frame processor with new threshold if significantly different
    if (Math.abs(newThreshold - previousThreshold) > 0.02) {
      this.createFrameProcessor();

      logger.debug('Adaptive threshold updated', {
        previous: previousThreshold.toFixed(3),
        new: newThreshold.toFixed(3),
        noiseAdjustment: noiseAdjustment.toFixed(3),
        activityAdjustment: activityAdjustment.toFixed(3),
      });

      this.emit('threshold-adapted', this.adaptiveThresholdState);
    }
  }

  /**
   * Auto-select VAD mode based on noise profile
   */
  private autoSelectMode(): void {
    if (!this.noiseProfile) return;

    const previousMode = this.currentMode;
    let newMode: VADMode = 'balanced';
    let reason = '';

    switch (this.noiseProfile.environmentType) {
      case 'quiet':
        newMode = 'permissive';
        reason = 'quiet environment detected';
        break;
      case 'normal':
        newMode = 'balanced';
        reason = 'normal environment detected';
        break;
      case 'noisy':
      case 'very_noisy':
        newMode = 'aggressive';
        reason = 'noisy environment detected';
        break;
      default:
        newMode = 'balanced';
        reason = 'unknown environment, using default';
    }

    if (newMode !== previousMode) {
      this.setMode(newMode, reason);
    }
  }

  /**
   * Set VAD mode
   */
  setMode(mode: VADMode, reason: string = 'manual selection'): void {
    if (mode === this.currentMode) return;

    const previousMode = this.currentMode;

    // Update mode metrics before switching
    this.updateModeMetrics();

    this.currentMode = mode;
    this.modeStartTime = Date.now();

    // Update adaptive threshold state with new mode's base threshold
    const preset = VAD_MODE_PRESETS[mode];
    this.adaptiveThresholdState.baseThreshold = preset.positiveSpeechThreshold;

    // Apply new threshold
    if (this.adaptiveVADConfig.enabled) {
      this.applyAdaptiveThreshold();
    } else {
      this.adaptiveThresholdState.currentThreshold = preset.positiveSpeechThreshold;
      this.createFrameProcessor();
    }

    logger.info('VAD mode changed', {
      from: previousMode,
      to: mode,
      reason,
      threshold: this.adaptiveThresholdState.currentThreshold.toFixed(3),
    });

    this.emit('mode-changed', previousMode, mode, reason);
  }

  /**
   * Start noise profile update interval
   */
  private startNoiseProfileUpdateInterval(): void {
    if (this.noiseProfileUpdateInterval) {
      clearInterval(this.noiseProfileUpdateInterval);
    }

    this.noiseProfileUpdateInterval = setInterval(() => {
      if (this.isRunning && !this.isSpeaking && !this.noiseProfilingState.isActive) {
        this.startNoiseProfiling();
      }
    }, this.adaptiveVADConfig.noiseProfileUpdateInterval);
  }

  /**
   * Stop noise profile update interval
   */
  private stopNoiseProfileUpdateInterval(): void {
    if (this.noiseProfileUpdateInterval) {
      clearInterval(this.noiseProfileUpdateInterval);
      this.noiseProfileUpdateInterval = null;
    }
  }

  /**
   * Process an audio frame
   * @param audio Float32Array of audio samples (expected 16kHz mono)
   */
  async processAudio(audio: Float32Array): Promise<void> {
    // Check both running state and closing flag to prevent race conditions
    if (!this.isRunning || !this.frameProcessor || this.isClosing) {
      return;
    }

    // Mark as processing to prevent stop() from cleaning up mid-process
    this.isProcessing = true;

    try {
      // Process for noise profiling if active
      if (this.noiseProfilingState.isActive) {
        this.processNoiseProfilingFrame(audio);
      }

      // Double-check frameProcessor still exists
      if (!this.frameProcessor || this.isClosing) {
        return;
      }

      const result = await this.frameProcessor.process(audio);

      // Check again after async operation
      if (this.isClosing) {
        return;
      }

      // Emit probability if available
      if (result.probs) {
        this.currentProbability = result.probs.isSpeech;
        this.emit('vad-probability', result.probs.isSpeech);

        // Debug: log high speech probabilities
        if (result.probs.isSpeech > 0.15) {
          logger.debug('VAD speech probability', {
            probability: result.probs.isSpeech.toFixed(3),
            threshold: this.adaptiveThresholdState.currentThreshold.toFixed(3),
            mode: this.currentMode,
            speaking: this.isSpeaking,
          });
        }

        // Track probability for adaptive threshold
        if (this.adaptiveVADConfig.enabled) {
          this.adaptiveThresholdState.recentProbabilities.push(result.probs.isSpeech);
          if (this.adaptiveThresholdState.recentProbabilities.length > ADAPTIVE_CONSTANTS.PROBABILITY_HISTORY_SIZE) {
            this.adaptiveThresholdState.recentProbabilities.shift();
          }
        }
      }

      // Handle message if available (use !== undefined since Message.SpeechStart = 0 is falsy)
      if (result.msg !== undefined) {
        this.handleMessage(result.msg, result.audio);
      }
    } catch (error) {
      // Silently ignore errors during shutdown
      if (!this.isClosing) {
        logger.error('Error processing audio frame', {
          error: (error as Error).message,
        });
        this.emit('error', error as Error);
      }
    } finally {
      this.isProcessing = false;
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

        // Track silence duration
        if (this.lastSpeechEndTime > 0) {
          const silenceDuration = now - this.lastSpeechEndTime;
          this.silenceDurations.push(silenceDuration);
          if (this.silenceDurations.length > 50) {
            this.silenceDurations.shift();
          }
        }

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

          // Track for metrics
          this.metrics.totalSpeechSegments++;
          this.metrics.modeMetrics[this.currentMode].segmentsDetected++;
          this.speechDurations.push(duration);
          if (this.speechDurations.length > 50) {
            this.speechDurations.shift();
          }

          // Store for validation (will be validated when transcript arrives)
          this.pendingSegmentValidation.set(this.speechStartTime, {
            startTime: this.speechStartTime,
            duration,
          });

          // Clean up old pending validations (older than 30 seconds)
          const cutoff = now - 30000;
          for (const [key] of this.pendingSegmentValidation) {
            if (key < cutoff) {
              // Mark as false positive if never validated
              this.metrics.falsePositives++;
              this.metrics.modeMetrics[this.currentMode].falsePositives++;
              this.pendingSegmentValidation.delete(key);
            }
          }

          logger.debug('Speech segment complete', {
            duration,
            samples: audio.length,
          });

          this.emit('speech-segment', segment);
          this.setListeningState('processing');
          this.lastSpeechEndTime = now;
        }

        this.emit('speech-end', {
          type: 'speech-end',
          timestamp: now,
          duration: this.isSpeaking ? now - this.speechStartTime : 0,
        } as VADEvent);

        this.isSpeaking = false;
        this.speechStartTime = 0;

        // Update metrics
        this.updateMetrics();
        break;

      case Message.VADMisfire:
        logger.debug('VAD misfire - speech too short');
        this.metrics.misfires++;
        this.isSpeaking = false;
        this.speechStartTime = 0;
        this.setListeningState('listening');

        // Update metrics
        this.updateMetrics();
        break;
    }
  }

  /**
   * Validate a speech segment (called when transcript is received)
   * This helps track VAD accuracy
   */
  validateSpeechSegment(startTime: number, hasValidTranscript: boolean): void {
    const pendingSegment = this.pendingSegmentValidation.get(startTime);
    if (pendingSegment) {
      this.pendingSegmentValidation.delete(startTime);

      if (hasValidTranscript) {
        this.metrics.validTranscripts++;
        this.metrics.modeMetrics[this.currentMode].validTranscripts++;
      } else {
        this.metrics.falsePositives++;
        this.metrics.modeMetrics[this.currentMode].falsePositives++;
      }

      this.updateMetrics();
    }
  }

  /**
   * Update VAD accuracy metrics
   */
  private updateMetrics(): void {
    const now = Date.now();
    this.metrics.uptime = now - this.metricsStartTime;
    this.metrics.lastUpdated = now;

    // Calculate averages
    if (this.speechDurations.length > 0) {
      this.metrics.avgSpeechDuration = this.calculateMean(this.speechDurations);
    }
    if (this.silenceDurations.length > 0) {
      this.metrics.avgSilenceDuration = this.calculateMean(this.silenceDurations);
    }

    // Calculate accuracy and false positive rate
    if (this.metrics.totalSpeechSegments > 0) {
      this.metrics.accuracy = this.metrics.validTranscripts / this.metrics.totalSpeechSegments;
      this.metrics.falsePositiveRate =
        this.metrics.falsePositives / this.metrics.totalSpeechSegments;
    }

    this.emit('metrics-updated', this.metrics);
  }

  /**
   * Update mode-specific metrics before mode switch
   */
  private updateModeMetrics(): void {
    const timeInMode = Date.now() - this.modeStartTime;
    this.metrics.modeMetrics[this.currentMode].timeInMode += timeInMode;
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
      sendToMainWindow('atlas:still-listening', event);
    } catch (error) {
      logger.debug('Could not send still-listening to renderer', { error });
    }
  }

  /**
   * Send listening state to renderer
   */
  private sendListeningStateToRenderer(state: ListeningState): void {
    try {
      sendToMainWindow('atlas:listening-state', state);
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
    logger.info('Adaptive silence config updated', config);
  }

  /**
   * Update adaptive VAD configuration
   */
  updateAdaptiveVADConfig(config: Partial<AdaptiveVADConfig>): void {
    this.adaptiveVADConfig = { ...this.adaptiveVADConfig, ...config };

    // Apply mode change if specified
    if (config.mode && config.mode !== this.currentMode) {
      this.setMode(config.mode, 'configuration update');
    }

    // Restart noise profile interval if changed
    if (config.noiseProfileUpdateInterval !== undefined) {
      this.stopNoiseProfileUpdateInterval();
      if (this.adaptiveVADConfig.enabled && config.noiseProfileUpdateInterval > 0) {
        this.startNoiseProfileUpdateInterval();
      }
    }

    logger.info('Adaptive VAD config updated', config);
  }

  /**
   * Get current adaptive silence configuration
   */
  getAdaptiveConfig(): AdaptiveSilenceConfig {
    return { ...this.adaptiveConfig };
  }

  /**
   * Get current adaptive VAD configuration
   */
  getAdaptiveVADConfig(): AdaptiveVADConfig {
    return { ...this.adaptiveVADConfig };
  }

  /**
   * Get current listening state
   */
  getListeningState(): ListeningState {
    return this.currentListeningState;
  }

  /**
   * Get current VAD mode
   */
  getMode(): VADMode {
    return this.currentMode;
  }

  /**
   * Get current noise profile
   */
  getNoiseProfile(): NoiseProfile | null {
    return this.noiseProfile ? { ...this.noiseProfile } : null;
  }

  /**
   * Get VAD accuracy metrics
   */
  getMetrics(): VADAccuracyMetrics {
    return { ...this.metrics };
  }

  /**
   * Get adaptive threshold state
   */
  getAdaptiveThresholdState(): AdaptiveThresholdState {
    return { ...this.adaptiveThresholdState };
  }

  /**
   * Update VAD configuration
   */
  updateConfig(config: Partial<VADConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('VAD config updated', config);
  }

  /**
   * Get current VAD status (extended with adaptive info)
   */
  getStatus(): AdaptiveVADStatus {
    return {
      isRunning: this.isRunning,
      isSpeaking: this.isSpeaking,
      probability: this.currentProbability,
      speechDuration: this.isSpeaking ? Date.now() - this.speechStartTime : 0,
      mode: this.currentMode,
      adaptiveState: { ...this.adaptiveThresholdState },
      noiseProfile: this.noiseProfile ? { ...this.noiseProfile } : null,
      metrics: { ...this.metrics },
      isProfilingNoise: this.noiseProfilingState.isActive,
      recommendedMode: this.getRecommendedMode(),
    };
  }

  /**
   * Get recommended mode based on current conditions
   */
  private getRecommendedMode(): VADMode {
    if (!this.noiseProfile) return 'balanced';

    switch (this.noiseProfile.environmentType) {
      case 'quiet':
        return 'permissive';
      case 'normal':
        return 'balanced';
      case 'noisy':
      case 'very_noisy':
        return 'aggressive';
      default:
        return 'balanced';
    }
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

  /**
   * Reset metrics
   */
  resetMetrics(): void {
    this.metrics = { ...DEFAULT_VAD_ACCURACY_METRICS };
    this.metricsStartTime = Date.now();
    this.speechDurations = [];
    this.silenceDurations = [];
    this.pendingSegmentValidation.clear();
    logger.info('VAD metrics reset');
  }

  /**
   * Force a noise profile update
   */
  async forceNoiseProfileUpdate(): Promise<void> {
    if (!this.isRunning || this.isSpeaking) {
      logger.warn('Cannot update noise profile - VAD not running or speech in progress');
      return;
    }

    this.startNoiseProfiling();
  }

  // Utility functions
  private calculateMean(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, val) => sum + val, 0) / values.length;
  }

  private calculateStdDev(values: number[]): number {
    if (values.length === 0) return 0;
    const mean = this.calculateMean(values);
    const squaredDiffs = values.map((val) => Math.pow(val - mean, 2));
    return Math.sqrt(this.calculateMean(squaredDiffs));
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
