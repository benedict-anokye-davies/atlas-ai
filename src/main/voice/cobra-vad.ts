/**
 * Atlas Voice Activity Detection (VAD) using Picovoice Cobra
 *
 * Cobra is a highly accurate, low-latency Voice Activity Detector (VAD).
 * Performance: 99% TPR (True Positive Rate), 0.05% CPU usage
 *
 * This replaces the Silero VAD implementation per research findings.
 *
 * Key differences from Silero:
 * - Uses same Picovoice API key as Porcupine (wake word)
 * - Simpler API: returns voice probability 0.0 - 1.0
 * - More efficient: no ONNX runtime required
 * - Lower latency: ~10ms per frame
 */

import { Cobra } from '@picovoice/cobra-node';
import { EventEmitter } from 'events';
import { BrowserWindow } from 'electron';
import { createModuleLogger } from '../utils/logger';
import { getConfig } from '../config';
import {
  VADEvent,
  SpeechSegment,
  VADMode,
  VAD_MODE_PRESETS,
  NoiseProfile,
  NoiseEnvironmentType,
  ListeningState,
  StillListeningEvent,
} from '../../shared/types/voice';

const logger = createModuleLogger('CobraVAD');

/**
 * Cobra VAD Configuration
 */
export interface CobraVADConfig {
  /** Picovoice access key (same as Porcupine) */
  accessKey?: string;
  /** Speech probability threshold (0-1), default 0.5 */
  threshold?: number;
  /** Minimum speech duration in ms before triggering, default 250 */
  minSpeechDuration?: number;
  /** Silence duration in ms to end speech segment, default 1000 */
  silenceDuration?: number;
  /** Maximum speech duration in ms before forced end, default 30000 */
  maxSpeechDuration?: number;
  /** VAD mode preset */
  mode?: VADMode;
  /** Enable adaptive thresholding based on ambient noise */
  adaptiveThreshold?: boolean;
  /** Enable noise profiling during initialization */
  enableNoiseProfiling?: boolean;
  /** Noise profiling duration in ms */
  noiseProfilingDuration?: number;
}

/**
 * Default Cobra VAD configuration
 */
const DEFAULT_COBRA_CONFIG: Required<CobraVADConfig> = {
  accessKey: '',
  threshold: 0.5,
  minSpeechDuration: 250,
  silenceDuration: 1000,
  maxSpeechDuration: 30000,
  mode: 'balanced',
  adaptiveThreshold: true,
  enableNoiseProfiling: true,
  noiseProfilingDuration: 2000,
};

/**
 * Cobra VAD Events
 */
export interface CobraVADEvents {
  'speech-start': (event: VADEvent) => void;
  'speech-end': (event: VADEvent) => void;
  'speech-segment': (segment: SpeechSegment) => void;
  'vad-probability': (probability: number) => void;
  'listening-state': (state: ListeningState) => void;
  'still-listening': (event: StillListeningEvent) => void;
  'noise-profile-updated': (profile: NoiseProfile) => void;
  'mode-changed': (from: VADMode, to: VADMode, reason: string) => void;
  error: (error: Error) => void;
  started: () => void;
  stopped: () => void;
}

/**
 * Noise profiling state
 */
interface NoiseProfilingState {
  isActive: boolean;
  startTime: number;
  probabilities: number[];
}

/**
 * CobraVADManager - Voice Activity Detection using Picovoice Cobra
 *
 * Advantages over Silero:
 * - 99% true positive rate
 * - 0.05% CPU usage
 * - No ONNX runtime dependency
 * - Same API key as Porcupine
 */
export class CobraVADManager extends EventEmitter {
  private cobra: Cobra | null = null;
  private isRunning: boolean = false;
  private isClosing: boolean = false;
  private config: Required<CobraVADConfig>;

  // Speech state tracking
  private isSpeaking: boolean = false;
  private speechStartTime: number = 0;
  private lastSpeechTime: number = 0;
  private currentProbability: number = 0;
  private speechFrameCount: number = 0;
  private silenceFrameCount: number = 0;
  private currentListeningState: ListeningState = 'idle';

  // Audio buffer for speech segment
  private audioBuffer: Float32Array[] = [];
  private audioBufferDuration: number = 0;

  // Current mode
  private currentMode: VADMode = 'balanced';

  // Noise profiling
  private noiseProfilingState: NoiseProfilingState = {
    isActive: false,
    startTime: 0,
    probabilities: [],
  };
  private noiseProfile: NoiseProfile | null = null;
  private adaptiveThreshold: number = 0.5;

  // Adaptive silence tracking
  private currentTranscript: string = '';
  private stillListeningEmitted: boolean = false;

  // Frame timing (Cobra uses 512 samples at 16kHz = 32ms per frame)
  private readonly FRAME_DURATION_MS = 32;
  private readonly SAMPLE_RATE = 16000;
  private readonly FRAME_SIZE = 512;

  constructor(config?: Partial<CobraVADConfig>) {
    super();
    const atlasConfig = getConfig();

    this.config = {
      ...DEFAULT_COBRA_CONFIG,
      accessKey: config?.accessKey || atlasConfig.porcupineApiKey, // Reuse Porcupine key
      threshold: config?.threshold ?? atlasConfig.vadThreshold,
      ...config,
    };

    this.currentMode = this.config.mode;
    this.adaptiveThreshold = VAD_MODE_PRESETS[this.currentMode].positiveSpeechThreshold;

    logger.info('CobraVADManager initialized', {
      threshold: this.config.threshold,
      mode: this.currentMode,
      adaptiveThreshold: this.config.adaptiveThreshold,
    });
  }

  /**
   * Initialize Cobra VAD
   */
  private async initialize(): Promise<void> {
    try {
      logger.debug('Initializing Picovoice Cobra...');

      this.cobra = new Cobra(this.config.accessKey);

      logger.info('Picovoice Cobra initialized', {
        sampleRate: this.SAMPLE_RATE,
        frameLength: this.FRAME_SIZE,
        version: this.cobra.version,
      });
    } catch (error) {
      logger.error('Failed to initialize Cobra', {
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
      logger.warn('Cobra VAD already running');
      return;
    }

    try {
      if (!this.cobra) {
        await this.initialize();
      }

      this.isRunning = true;
      this.isClosing = false;
      this.isSpeaking = false;
      this.speechStartTime = 0;
      this.lastSpeechTime = 0;
      this.speechFrameCount = 0;
      this.silenceFrameCount = 0;
      this.audioBuffer = [];
      this.audioBufferDuration = 0;
      this.stillListeningEmitted = false;

      this.setListeningState('listening');

      // Start noise profiling if enabled
      if (this.config.enableNoiseProfiling) {
        this.startNoiseProfiling();
      }

      logger.info('Cobra VAD started', { mode: this.currentMode });
      this.emit('started');
    } catch (error) {
      this.isRunning = false;
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('Failed to start Cobra VAD', { error: err.message });
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

    this.isClosing = true;
    this.isRunning = false;

    // End any in-progress speech segment
    if (this.isSpeaking && this.audioBuffer.length > 0) {
      this.endSpeechSegment(false);
    }

    this.isSpeaking = false;
    this.speechStartTime = 0;
    this.lastSpeechTime = 0;
    this.speechFrameCount = 0;
    this.silenceFrameCount = 0;
    this.audioBuffer = [];
    this.audioBufferDuration = 0;

    this.setListeningState('idle');

    logger.info('Cobra VAD stopped');
    this.emit('stopped');
  }

  /**
   * Release Cobra resources
   */
  async release(): Promise<void> {
    await this.stop();

    if (this.cobra) {
      this.cobra.release();
      this.cobra = null;
    }

    logger.info('Cobra VAD released');
  }

  /**
   * Start noise profiling
   */
  private startNoiseProfiling(): void {
    logger.info('Starting noise profiling...');

    this.noiseProfilingState = {
      isActive: true,
      startTime: Date.now(),
      probabilities: [],
    };

    // Complete profiling after configured duration
    setTimeout(() => {
      this.completeNoiseProfiling();
    }, this.config.noiseProfilingDuration);
  }

  /**
   * Complete noise profiling and build profile
   */
  private completeNoiseProfiling(): void {
    if (!this.noiseProfilingState.isActive) {
      return;
    }

    const probabilities = this.noiseProfilingState.probabilities;

    if (probabilities.length < 30) {
      logger.warn('Noise profiling incomplete - insufficient samples', {
        samples: probabilities.length,
      });
      this.noiseProfilingState.isActive = false;
      return;
    }

    // Calculate statistics
    const sorted = [...probabilities].sort((a, b) => a - b);
    const noiseFloor = sorted[Math.floor(sorted.length * 0.25)]; // 25th percentile
    const peakNoise = sorted[Math.floor(sorted.length * 0.95)]; // 95th percentile
    const mean = probabilities.reduce((a, b) => a + b, 0) / probabilities.length;

    // Classify environment based on baseline probability
    let environmentType: NoiseEnvironmentType = 'normal';
    if (noiseFloor <= 0.05) {
      environmentType = 'quiet';
    } else if (noiseFloor <= 0.15) {
      environmentType = 'normal';
    } else if (noiseFloor <= 0.3) {
      environmentType = 'noisy';
    } else {
      environmentType = 'very_noisy';
    }

    this.noiseProfile = {
      noiseFloor,
      peakNoiseLevel: peakNoise,
      noiseStdDev: this.calculateStdDev(probabilities, mean),
      estimatedSNR: noiseFloor > 0 ? 20 * Math.log10(0.8 / noiseFloor) : 30,
      spectralProfile: {
        lowFreqEnergy: 0.33,
        midFreqEnergy: 0.34,
        highFreqEnergy: 0.33,
      },
      createdAt: Date.now(),
      profilingDuration: Date.now() - this.noiseProfilingState.startTime,
      sampleCount: probabilities.length,
      isValid: true,
      environmentType,
    };

    this.noiseProfilingState.isActive = false;

    // Apply adaptive threshold
    if (this.config.adaptiveThreshold) {
      this.applyAdaptiveThreshold();
    }

    logger.info('Noise profile complete', {
      noiseFloor: noiseFloor.toFixed(3),
      peakNoise: peakNoise.toFixed(3),
      environmentType,
      samples: probabilities.length,
    });

    this.emit('noise-profile-updated', this.noiseProfile);
  }

  /**
   * Apply adaptive threshold based on noise profile
   */
  private applyAdaptiveThreshold(): void {
    if (!this.noiseProfile) return;

    const preset = VAD_MODE_PRESETS[this.currentMode];
    const baseThreshold = preset.positiveSpeechThreshold;

    // Increase threshold in noisier environments
    const noiseAdjustment = Math.min(0.2, this.noiseProfile.noiseFloor * 2);

    this.adaptiveThreshold = Math.min(0.9, Math.max(0.2, baseThreshold + noiseAdjustment));

    logger.debug('Adaptive threshold applied', {
      base: baseThreshold,
      adjustment: noiseAdjustment,
      final: this.adaptiveThreshold,
    });
  }

  /**
   * Process an audio frame
   * @param audio Int16Array of audio samples (512 samples at 16kHz)
   */
  async processAudio(audio: Int16Array | Float32Array): Promise<void> {
    if (!this.isRunning || !this.cobra || this.isClosing) {
      return;
    }

    try {
      // Convert Float32Array to Int16Array if needed
      let int16Audio: Int16Array;
      if (audio instanceof Float32Array) {
        int16Audio = new Int16Array(audio.length);
        for (let i = 0; i < audio.length; i++) {
          int16Audio[i] = Math.max(-32768, Math.min(32767, Math.floor(audio[i] * 32767)));
        }
      } else {
        int16Audio = audio;
      }

      // Get voice probability from Cobra
      const probability = this.cobra.process(int16Audio);
      this.currentProbability = probability;

      // Emit probability for monitoring
      this.emit('vad-probability', probability);

      // Collect for noise profiling
      if (this.noiseProfilingState.isActive) {
        this.noiseProfilingState.probabilities.push(probability);
      }

      // Determine effective threshold
      const threshold = this.config.adaptiveThreshold
        ? this.adaptiveThreshold
        : this.config.threshold;

      const now = Date.now();

      if (probability >= threshold) {
        // Speech detected
        this.handleSpeechFrame(audio, now);
      } else {
        // Silence detected
        this.handleSilenceFrame(now);
      }
    } catch (error) {
      if (!this.isClosing) {
        logger.error('Error processing audio frame', {
          error: (error as Error).message,
        });
        this.emit('error', error as Error);
      }
    }
  }

  /**
   * Handle a frame where speech is detected
   */
  private handleSpeechFrame(audio: Int16Array | Float32Array, now: number): void {
    this.speechFrameCount++;
    this.silenceFrameCount = 0;
    this.lastSpeechTime = now;

    // Convert and buffer audio
    const floatAudio = audio instanceof Float32Array ? audio : this.int16ToFloat32(audio);
    this.audioBuffer.push(new Float32Array(floatAudio));
    this.audioBufferDuration += this.FRAME_DURATION_MS;

    // Check if we should start a new speech segment
    const speechDuration = this.speechFrameCount * this.FRAME_DURATION_MS;

    if (!this.isSpeaking && speechDuration >= this.config.minSpeechDuration) {
      // Speech segment started
      this.isSpeaking = true;
      this.speechStartTime = now - speechDuration;
      this.stillListeningEmitted = false;
      this.setListeningState('hearing');

      logger.debug('Speech started', {
        probability: this.currentProbability.toFixed(3),
        threshold: this.adaptiveThreshold.toFixed(3),
      });

      this.emit('speech-start', {
        type: 'speech-start',
        timestamp: this.speechStartTime,
      } as VADEvent);
    }

    // Check for max speech duration
    if (this.isSpeaking) {
      const totalDuration = now - this.speechStartTime;
      if (totalDuration >= this.config.maxSpeechDuration) {
        logger.warn('Max speech duration reached, forcing end');
        this.endSpeechSegment(true);
      }
    }
  }

  /**
   * Handle a frame where silence is detected
   */
  private handleSilenceFrame(now: number): void {
    this.silenceFrameCount++;

    const silenceDuration = this.silenceFrameCount * this.FRAME_DURATION_MS;

    if (this.isSpeaking) {
      // Check for "still listening" state (short pause)
      if (
        silenceDuration >= 500 &&
        silenceDuration < this.config.silenceDuration &&
        !this.stillListeningEmitted
      ) {
        this.stillListeningEmitted = true;
        this.setListeningState('still_listening');

        const reason = this.isIncompleteSentence(this.currentTranscript)
          ? 'incomplete_sentence'
          : 'short_pause';

        this.emit('still-listening', {
          timestamp: now,
          pauseDuration: silenceDuration,
          reason,
          extendedTimeout: this.config.silenceDuration + 500,
        } as StillListeningEvent);
      }

      // Check if silence duration exceeds threshold
      if (silenceDuration >= this.config.silenceDuration) {
        this.endSpeechSegment(false);
      }
    } else {
      // Not speaking, reset speech frame count
      if (silenceDuration > 500) {
        this.speechFrameCount = 0;
        // Keep a small buffer for pre-speech audio
        while (this.audioBuffer.length > 10) {
          this.audioBuffer.shift();
        }
        this.audioBufferDuration = this.audioBuffer.length * this.FRAME_DURATION_MS;
      }
    }
  }

  /**
   * End the current speech segment
   */
  private endSpeechSegment(forcedEnd: boolean): void {
    if (!this.isSpeaking) return;

    const now = Date.now();
    const duration = now - this.speechStartTime;

    // Concatenate audio buffer
    const totalSamples = this.audioBuffer.reduce((sum, buf) => sum + buf.length, 0);
    const audio = new Float32Array(totalSamples);
    let offset = 0;
    for (const buf of this.audioBuffer) {
      audio.set(buf, offset);
      offset += buf.length;
    }

    const segment: SpeechSegment = {
      audio,
      startTime: this.speechStartTime,
      endTime: now,
      duration,
      forcedEnd,
    };

    logger.debug('Speech segment complete', {
      duration,
      samples: totalSamples,
      forcedEnd,
    });

    this.emit('speech-segment', segment);
    this.emit('speech-end', {
      type: 'speech-end',
      timestamp: now,
      duration,
    } as VADEvent);

    // Reset state
    this.isSpeaking = false;
    this.speechStartTime = 0;
    this.speechFrameCount = 0;
    this.silenceFrameCount = 0;
    this.audioBuffer = [];
    this.audioBufferDuration = 0;
    this.stillListeningEmitted = false;

    this.setListeningState('processing');

    // Return to listening after a short delay
    setTimeout(() => {
      if (this.isRunning && this.currentListeningState === 'processing') {
        this.setListeningState('listening');
      }
    }, 500);
  }

  /**
   * Set VAD mode
   */
  setMode(mode: VADMode, reason: string = 'manual'): void {
    if (mode === this.currentMode) return;

    const previousMode = this.currentMode;
    this.currentMode = mode;

    // Update adaptive threshold for new mode
    const preset = VAD_MODE_PRESETS[mode];
    this.adaptiveThreshold = preset.positiveSpeechThreshold;

    // Re-apply noise adjustment if we have a profile
    if (this.config.adaptiveThreshold && this.noiseProfile) {
      this.applyAdaptiveThreshold();
    }

    logger.info('VAD mode changed', {
      from: previousMode,
      to: mode,
      reason,
      threshold: this.adaptiveThreshold.toFixed(3),
    });

    this.emit('mode-changed', previousMode, mode, reason);
  }

  /**
   * Update transcript for adaptive silence detection
   */
  setCurrentTranscript(transcript: string): void {
    this.currentTranscript = transcript;

    // Reset still listening state if we got new speech
    if (this.currentListeningState === 'still_listening') {
      this.setListeningState('hearing');
      this.stillListeningEmitted = false;
    }
  }

  /**
   * Check if sentence appears incomplete
   */
  private isIncompleteSentence(transcript: string): boolean {
    if (!transcript) return false;

    const text = transcript.trim().toLowerCase();

    // Ends with continuation words
    const continuationWords = [
      'and',
      'but',
      'or',
      'so',
      'because',
      'although',
      'however',
      'then',
      'if',
      'when',
      'while',
      'the',
      'a',
      'an',
      'to',
      'for',
    ];

    const lastWord = text.split(/\s+/).pop() || '';
    if (continuationWords.includes(lastWord)) return true;

    // Ends with comma or dash
    if (text.endsWith(',') || text.endsWith('-')) return true;

    return false;
  }

  /**
   * Set and broadcast listening state
   */
  private setListeningState(state: ListeningState): void {
    if (this.currentListeningState === state) return;

    this.currentListeningState = state;
    this.emit('listening-state', state);

    // Send to renderer
    try {
      const mainWindow = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('atlas:listening-state', state);
      }
    } catch {
      // Ignore IPC errors
    }
  }

  /**
   * Convert Int16Array to Float32Array
   */
  private int16ToFloat32(int16: Int16Array): Float32Array {
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 32768.0;
    }
    return float32;
  }

  /**
   * Calculate standard deviation
   */
  private calculateStdDev(values: number[], mean: number): number {
    if (values.length === 0) return 0;
    const squaredDiffs = values.map((v) => Math.pow(v - mean, 2));
    return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / values.length);
  }

  /**
   * Reset VAD state
   */
  reset(): void {
    if (this.cobra) {
      // Cobra doesn't have internal state to reset
    }

    this.isSpeaking = false;
    this.speechStartTime = 0;
    this.lastSpeechTime = 0;
    this.speechFrameCount = 0;
    this.silenceFrameCount = 0;
    this.audioBuffer = [];
    this.audioBufferDuration = 0;
    this.currentTranscript = '';
    this.stillListeningEmitted = false;

    if (this.isRunning) {
      this.setListeningState('listening');
    }

    logger.debug('Cobra VAD state reset');
  }

  // Getters
  get running(): boolean {
    return this.isRunning;
  }

  get speaking(): boolean {
    return this.isSpeaking;
  }

  get probability(): number {
    return this.currentProbability;
  }

  get mode(): VADMode {
    return this.currentMode;
  }

  get threshold(): number {
    return this.adaptiveThreshold;
  }

  getListeningState(): ListeningState {
    return this.currentListeningState;
  }

  getNoiseProfile(): NoiseProfile | null {
    return this.noiseProfile;
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      isSpeaking: this.isSpeaking,
      probability: this.currentProbability,
      threshold: this.adaptiveThreshold,
      mode: this.currentMode,
      noiseProfile: this.noiseProfile,
      listeningState: this.currentListeningState,
      speechDuration: this.isSpeaking ? Date.now() - this.speechStartTime : 0,
    };
  }
}

// Singleton instance
let cobraVADManager: CobraVADManager | null = null;

/**
 * Get or create the Cobra VAD manager instance
 */
export function getCobraVADManager(): CobraVADManager {
  if (!cobraVADManager) {
    cobraVADManager = new CobraVADManager();
  }
  return cobraVADManager;
}

/**
 * Shutdown the Cobra VAD manager
 */
export async function shutdownCobraVADManager(): Promise<void> {
  if (cobraVADManager) {
    await cobraVADManager.release();
    cobraVADManager = null;
  }
}

export default CobraVADManager;
