/**
 * Nova Audio Preprocessor
 * Provides audio signal processing including:
 * - Noise gate (reduces low-level noise)
 * - Noise reduction (basic spectral subtraction)
 * - High-pass filter (removes DC offset and rumble)
 * - Echo cancellation (prevents Nova from hearing itself)
 *
 * Session 036-A: Audio Pipeline Enhancements
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('AudioPreprocessor');

/**
 * Echo cancellation aggressiveness levels
 */
export type EchoCancellationAggressiveness = 'low' | 'medium' | 'high' | 'aggressive';

/**
 * NLMS (Normalized Least Mean Squares) filter configuration
 */
export interface NLMSConfig {
  /** Filter length in samples (longer = better cancellation but more latency) */
  filterLength: number;
  /** Step size (mu) - controls adaptation speed vs stability (0.01-1.0) */
  stepSize: number;
  /** Regularization constant to prevent division by zero */
  epsilon: number;
  /** Enable double-talk detection (reduces adaptation when user is speaking) */
  enableDoubleTalkDetection: boolean;
  /** Double-talk detection threshold (ratio of mic energy to reference energy) */
  doubleTalkThreshold: number;
}

/**
 * Mic ducking configuration
 */
export interface MicDuckingConfig {
  /** Enable mic ducking during TTS playback */
  enabled: boolean;
  /** Ducking attenuation in dB (negative value) */
  attenuationDb: number;
  /** Attack time in ms (how fast to duck) */
  attackMs: number;
  /** Release time in ms (how fast to recover after TTS ends) */
  releaseMs: number;
  /** Hold time in ms (how long to hold duck after last TTS sample) */
  holdMs: number;
}

/**
 * Audio preprocessor configuration
 */
export interface AudioPreprocessorConfig {
  /** Enable noise gate */
  enableNoiseGate: boolean;
  /** Noise gate threshold in dB (samples below this are attenuated) */
  noiseGateThreshold: number;
  /** Noise gate attack time in ms */
  noiseGateAttack: number;
  /** Noise gate release time in ms */
  noiseGateRelease: number;

  /** Enable noise reduction */
  enableNoiseReduction: boolean;
  /** Noise reduction strength (0-1) */
  noiseReductionStrength: number;
  /** Number of frames to use for noise estimation */
  noiseEstimationFrames: number;

  /** Enable high-pass filter */
  enableHighPass: boolean;
  /** High-pass cutoff frequency in Hz */
  highPassCutoff: number;

  /** Enable echo cancellation */
  enableEchoCancellation: boolean;
  /** Echo cancellation strength (0-1) - legacy, use aggressiveness instead */
  echoCancellationStrength: number;
  /** Echo cancellation aggressiveness level */
  echoCancellationAggressiveness: EchoCancellationAggressiveness;
  /** NLMS adaptive filter configuration */
  nlmsConfig: NLMSConfig;
  /** Mic ducking configuration */
  micDuckingConfig: MicDuckingConfig;

  /** Sample rate */
  sampleRate: number;
}

/**
 * NLMS configuration presets by aggressiveness level
 */
export const NLMS_PRESETS: Record<EchoCancellationAggressiveness, NLMSConfig> = {
  low: {
    filterLength: 512,
    stepSize: 0.1,
    epsilon: 0.01,
    enableDoubleTalkDetection: true,
    doubleTalkThreshold: 0.3,
  },
  medium: {
    filterLength: 1024,
    stepSize: 0.2,
    epsilon: 0.001,
    enableDoubleTalkDetection: true,
    doubleTalkThreshold: 0.4,
  },
  high: {
    filterLength: 2048,
    stepSize: 0.3,
    epsilon: 0.0001,
    enableDoubleTalkDetection: true,
    doubleTalkThreshold: 0.5,
  },
  aggressive: {
    filterLength: 4096,
    stepSize: 0.5,
    epsilon: 0.00001,
    enableDoubleTalkDetection: false,
    doubleTalkThreshold: 0.6,
  },
};

/**
 * Default mic ducking configuration
 */
export const DEFAULT_MIC_DUCKING_CONFIG: MicDuckingConfig = {
  enabled: true,
  attenuationDb: -20, // 20dB reduction during TTS
  attackMs: 5, // Fast attack
  releaseMs: 100, // Gradual release
  holdMs: 50, // Short hold after TTS ends
};

/**
 * Default audio preprocessor configuration
 */
export const DEFAULT_PREPROCESSOR_CONFIG: AudioPreprocessorConfig = {
  enableNoiseGate: true,
  noiseGateThreshold: -40, // dB
  noiseGateAttack: 5, // ms
  noiseGateRelease: 50, // ms

  enableNoiseReduction: true,
  noiseReductionStrength: 0.5,
  noiseEstimationFrames: 10,

  enableHighPass: true,
  highPassCutoff: 80, // Hz

  enableEchoCancellation: true, // Now enabled by default with NLMS
  echoCancellationStrength: 0.7, // Legacy setting
  echoCancellationAggressiveness: 'medium',
  nlmsConfig: NLMS_PRESETS.medium,
  micDuckingConfig: DEFAULT_MIC_DUCKING_CONFIG,

  sampleRate: 16000,
};

/**
 * Preprocessor statistics
 */
export interface PreprocessorStats {
  framesProcessed: number;
  noiseGateActivations: number;
  averageInputLevel: number;
  averageOutputLevel: number;
  estimatedNoiseFloor: number;
  processingTimeMs: number;
  // Echo cancellation stats
  echoCancellationActive: boolean;
  echoReductionDb: number;
  nlmsFilterConverged: boolean;
  micDuckingActive: boolean;
  currentMicDuckingGain: number;
}

/**
 * Audio Preprocessor
 * Processes audio frames to reduce noise and improve quality
 */
export class AudioPreprocessor extends EventEmitter {
  private config: AudioPreprocessorConfig;
  private isEnabled: boolean = true;

  // Noise gate state
  private noiseGateGain: number = 1.0;
  private noiseGateActivations: number = 0;

  // Noise estimation state
  private noiseBuffer: Float32Array[] = [];
  private noiseBufferSamples: number = 0; // Track total samples for memory management
  private noiseFloor: Float32Array | null = null;
  private noiseFloorEstimate: number = 0;

  // Maximum noise buffer size (prevent memory leaks)
  // Limit to ~10 seconds of audio at 16kHz (160,000 samples total)
  private static readonly MAX_NOISE_BUFFER_SAMPLES = 16000 * 10;

  // High-pass filter state (first-order IIR)
  private highPassPrev: number = 0;
  private highPassAlpha: number = 0;

  // Echo cancellation state - NLMS adaptive filter
  private echoReference: Float32Array | null = null;
  private echoReferenceTimestamp: number = 0;
  private echoDelayMs: number = 50; // Typical speaker-to-mic delay

  // NLMS filter state
  private nlmsWeights: Float32Array;
  private nlmsReferenceBuffer: Float32Array;
  private nlmsBufferIndex: number = 0;
  private nlmsConverged: boolean = false;
  private nlmsErrorHistory: number[] = [];
  private static readonly NLMS_CONVERGENCE_THRESHOLD = 0.01;
  private static readonly NLMS_ERROR_HISTORY_LENGTH = 50;

  // Mic ducking state
  private micDuckingGain: number = 1.0;
  private isTTSPlaying: boolean = false;
  private ttsEndTimestamp: number = 0;
  private echoReductionDb: number = 0;

  // Statistics
  private framesProcessed: number = 0;
  private totalInputLevel: number = 0;
  private totalOutputLevel: number = 0;
  private totalProcessingTime: number = 0;

  constructor(config?: Partial<AudioPreprocessorConfig>) {
    super();
    this.config = { ...DEFAULT_PREPROCESSOR_CONFIG, ...config };

    // Initialize NLMS filter
    const filterLength = this.config.nlmsConfig.filterLength;
    this.nlmsWeights = new Float32Array(filterLength);
    this.nlmsReferenceBuffer = new Float32Array(filterLength);

    // Calculate high-pass filter coefficient
    this.updateHighPassCoefficient();

    logger.info('AudioPreprocessor initialized', {
      noiseGate: this.config.enableNoiseGate,
      noiseReduction: this.config.enableNoiseReduction,
      highPass: this.config.enableHighPass,
      echoCancellation: this.config.enableEchoCancellation,
      echoAggressiveness: this.config.echoCancellationAggressiveness,
      nlmsFilterLength: filterLength,
      micDucking: this.config.micDuckingConfig.enabled,
    });
  }

  /**
   * Update high-pass filter coefficient based on cutoff frequency
   */
  private updateHighPassCoefficient(): void {
    const RC = 1.0 / (2.0 * Math.PI * this.config.highPassCutoff);
    const dt = 1.0 / this.config.sampleRate;
    this.highPassAlpha = RC / (RC + dt);
  }

  /**
   * Process an audio frame through the preprocessor pipeline
   * @param input Float32Array of audio samples
   * @returns Processed audio samples
   */
  process(input: Float32Array): Float32Array {
    if (!this.isEnabled) {
      return input;
    }

    const startTime = performance.now();

    // Copy input to output buffer
    const output = new Float32Array(input.length);
    output.set(input);
    let processed = output;

    // Calculate input level for statistics
    const inputLevel = this.calculateRMS(input);
    this.totalInputLevel += inputLevel;

    // 0. Apply mic ducking first (reduce mic sensitivity during TTS playback)
    if (this.config.micDuckingConfig.enabled) {
      processed = this.applyMicDucking(processed);
    }

    // 1. High-pass filter (remove DC offset and rumble)
    if (this.config.enableHighPass) {
      processed = this.applyHighPass(processed) as Float32Array;
    }

    // 2. Noise estimation (update noise floor estimate)
    if (this.config.enableNoiseReduction) {
      this.updateNoiseEstimate(processed);
    }

    // 3. Noise reduction (spectral subtraction)
    if (this.config.enableNoiseReduction && this.noiseFloor) {
      processed = this.applyNoiseReduction(processed) as Float32Array;
    }

    // 4. Noise gate (attenuate very quiet sections)
    if (this.config.enableNoiseGate) {
      processed = this.applyNoiseGate(processed) as Float32Array;
    }

    // 5. Echo cancellation using NLMS adaptive filter
    if (this.config.enableEchoCancellation && this.echoReference) {
      processed = this.applyNLMSEchoCancellation(processed);
    }

    // Calculate output level for statistics
    const outputLevel = this.calculateRMS(processed);
    this.totalOutputLevel += outputLevel;

    // Update echo reduction statistic
    if (inputLevel > 0 && this.config.enableEchoCancellation) {
      this.echoReductionDb = this.linearToDb(outputLevel / inputLevel);
    }

    // Update statistics
    this.framesProcessed++;
    this.totalProcessingTime += performance.now() - startTime;

    return processed;
  }

  /**
   * Calculate RMS (Root Mean Square) level of audio
   */
  private calculateRMS(samples: Float32Array): number {
    if (samples.length === 0) return 0;

    let sum = 0;
    for (let i = 0; i < samples.length; i++) {
      sum += samples[i] * samples[i];
    }
    return Math.sqrt(sum / samples.length);
  }

  /**
   * Convert linear amplitude to decibels
   */
  private linearToDb(linear: number): number {
    return 20 * Math.log10(Math.max(linear, 1e-10));
  }

  /**
   * Convert decibels to linear amplitude
   */
  private dbToLinear(db: number): number {
    return Math.pow(10, db / 20);
  }

  /**
   * Apply high-pass filter to remove DC offset and low-frequency rumble
   */
  private applyHighPass(input: Float32Array): Float32Array {
    const output = new Float32Array(input.length);
    let prevIn = input[0];
    let prevOut = this.highPassPrev;

    for (let i = 0; i < input.length; i++) {
      output[i] = this.highPassAlpha * (prevOut + input[i] - prevIn);
      prevIn = input[i];
      prevOut = output[i];
    }

    this.highPassPrev = prevOut;
    return output;
  }

  /**
   * Update noise floor estimate from quiet frames
   */
  private updateNoiseEstimate(input: Float32Array): void {
    const level = this.calculateRMS(input);
    const levelDb = this.linearToDb(level);

    // Only update noise estimate during quiet periods (below noise gate threshold + margin)
    if (levelDb < this.config.noiseGateThreshold + 10) {
      // Check if adding this frame would exceed memory limit
      if (this.noiseBufferSamples + input.length > AudioPreprocessor.MAX_NOISE_BUFFER_SAMPLES) {
        // Remove oldest frames until we have room
        while (
          this.noiseBuffer.length > 0 &&
          this.noiseBufferSamples + input.length > AudioPreprocessor.MAX_NOISE_BUFFER_SAMPLES
        ) {
          const removed = this.noiseBuffer.shift();
          if (removed) {
            this.noiseBufferSamples -= removed.length;
          }
        }
      }

      // Store frame for noise estimation
      const frameCopy = new Float32Array(input);
      this.noiseBuffer.push(frameCopy);
      this.noiseBufferSamples += frameCopy.length;

      // Keep only recent frames (based on frame count)
      while (this.noiseBuffer.length > this.config.noiseEstimationFrames) {
        const removed = this.noiseBuffer.shift();
        if (removed) {
          this.noiseBufferSamples -= removed.length;
        }
      }

      // Update noise floor estimate (average of quiet frames)
      if (this.noiseBuffer.length >= this.config.noiseEstimationFrames / 2) {
        this.noiseFloor = this.estimateNoiseFloor();
        this.noiseFloorEstimate = this.calculateRMS(this.noiseFloor);
      }
    }
  }

  /**
   * Estimate noise floor from collected quiet frames
   */
  private estimateNoiseFloor(): Float32Array {
    if (this.noiseBuffer.length === 0) {
      return new Float32Array(512); // Default size
    }

    const frameSize = this.noiseBuffer[0].length;
    const noiseFloor = new Float32Array(frameSize);

    // Average the absolute values across all noise frames
    for (let i = 0; i < frameSize; i++) {
      let sum = 0;
      for (const frame of this.noiseBuffer) {
        sum += Math.abs(frame[i]);
      }
      noiseFloor[i] = sum / this.noiseBuffer.length;
    }

    return noiseFloor;
  }

  /**
   * Apply noise reduction using spectral subtraction
   * This is a simple time-domain approach (spectral subtraction would use FFT)
   */
  private applyNoiseReduction(input: Float32Array): Float32Array {
    if (!this.noiseFloor || this.noiseFloor.length !== input.length) {
      return input;
    }

    const output = new Float32Array(input.length);
    const strength = this.config.noiseReductionStrength;

    for (let i = 0; i < input.length; i++) {
      const sample = input[i];
      const noise = this.noiseFloor[i] * strength;

      // Soft thresholding - reduce samples near noise floor
      if (Math.abs(sample) < noise * 2) {
        // Samples near noise floor are attenuated
        const attenuation = Math.max(0, 1 - noise / (Math.abs(sample) + 1e-10));
        output[i] = sample * attenuation;
      } else {
        // Samples well above noise floor pass through
        output[i] = sample;
      }
    }

    return output;
  }

  /**
   * Apply noise gate to attenuate very quiet sections
   */
  private applyNoiseGate(input: Float32Array): Float32Array {
    const output = new Float32Array(input.length);
    const level = this.calculateRMS(input);
    const levelDb = this.linearToDb(level);
    const thresholdDb = this.config.noiseGateThreshold;

    // Calculate attack/release coefficients
    const attackSamples = (this.config.noiseGateAttack / 1000) * this.config.sampleRate;
    const releaseSamples = (this.config.noiseGateRelease / 1000) * this.config.sampleRate;
    const attackCoeff = Math.exp(-1.0 / attackSamples);
    const releaseCoeff = Math.exp(-1.0 / releaseSamples);

    // Determine target gain
    let targetGain: number;
    if (levelDb > thresholdDb) {
      targetGain = 1.0;
    } else if (levelDb > thresholdDb - 10) {
      // Soft knee - gradual transition
      const ratio = (levelDb - (thresholdDb - 10)) / 10;
      targetGain = ratio * ratio; // Quadratic curve
    } else {
      targetGain = 0.1; // Don't completely silence, just attenuate
      this.noiseGateActivations++;
    }

    // Smooth gain changes
    const coeff = targetGain > this.noiseGateGain ? attackCoeff : releaseCoeff;
    this.noiseGateGain = coeff * this.noiseGateGain + (1 - coeff) * targetGain;

    // Apply gain
    for (let i = 0; i < input.length; i++) {
      output[i] = input[i] * this.noiseGateGain;
    }

    return output;
  }

  /**
   * Apply mic ducking to reduce mic sensitivity during TTS playback
   * This significantly reduces the amount of echo that needs to be cancelled
   */
  private applyMicDucking(input: Float32Array): Float32Array {
    const config = this.config.micDuckingConfig;
    const now = Date.now();

    // Calculate target gain based on TTS playback state
    let targetGain: number;
    if (this.isTTSPlaying) {
      // TTS is actively playing - apply full ducking
      targetGain = this.dbToLinear(config.attenuationDb);
    } else if (now - this.ttsEndTimestamp < config.holdMs) {
      // TTS just ended - hold ducking for a short time
      targetGain = this.dbToLinear(config.attenuationDb);
    } else {
      // TTS not playing - normal gain
      targetGain = 1.0;
    }

    // Smooth gain changes with attack/release
    const attackCoeff = Math.exp(-1000 / (config.attackMs * this.config.sampleRate));
    const releaseCoeff = Math.exp(-1000 / (config.releaseMs * this.config.sampleRate));
    const coeff = targetGain < this.micDuckingGain ? attackCoeff : releaseCoeff;

    // Apply gain smoothly sample-by-sample
    const output = new Float32Array(input.length);
    for (let i = 0; i < input.length; i++) {
      this.micDuckingGain = coeff * this.micDuckingGain + (1 - coeff) * targetGain;
      output[i] = input[i] * this.micDuckingGain;
    }

    return output;
  }

  /**
   * Apply NLMS (Normalized Least Mean Squares) adaptive filter for echo cancellation
   * This provides much better echo cancellation than simple subtraction
   */
  private applyNLMSEchoCancellation(input: Float32Array): Float32Array {
    if (!this.echoReference) {
      return input;
    }

    const output = new Float32Array(input.length);
    const config = this.config.nlmsConfig;
    const filterLength = config.filterLength;
    const mu = config.stepSize;
    const epsilon = config.epsilon;

    // Check if reference is recent enough (within 1 second for NLMS)
    const now = Date.now();
    if (now - this.echoReferenceTimestamp > 1000) {
      this.echoReference = null;
      return input;
    }

    // Process each sample with NLMS algorithm
    for (let i = 0; i < input.length; i++) {
      // Get the reference sample (with delay compensation)
      const refIndex = Math.min(i, this.echoReference.length - 1);
      const refSample = refIndex >= 0 ? this.echoReference[refIndex] : 0;

      // Update circular reference buffer
      this.nlmsReferenceBuffer[this.nlmsBufferIndex] = refSample;

      // Compute estimated echo: y_hat = W^T * x
      let echoEstimate = 0;
      for (let j = 0; j < filterLength; j++) {
        const bufIdx = (this.nlmsBufferIndex - j + filterLength) % filterLength;
        echoEstimate += this.nlmsWeights[j] * this.nlmsReferenceBuffer[bufIdx];
      }

      // Compute error signal (desired output = input - estimated echo)
      const error = input[i] - echoEstimate;
      output[i] = error;

      // Calculate normalization factor (power of reference buffer)
      let refPower = epsilon;
      for (let j = 0; j < filterLength; j++) {
        const bufIdx = (this.nlmsBufferIndex - j + filterLength) % filterLength;
        refPower += this.nlmsReferenceBuffer[bufIdx] * this.nlmsReferenceBuffer[bufIdx];
      }

      // Double-talk detection: reduce adaptation when user is speaking
      let adaptationRate = mu;
      if (config.enableDoubleTalkDetection) {
        const micEnergy = input[i] * input[i];
        const refEnergy = refSample * refSample + epsilon;
        const energyRatio = micEnergy / refEnergy;

        // If mic energy is much higher than reference, user might be speaking
        if (energyRatio > config.doubleTalkThreshold * 10) {
          adaptationRate *= 0.1; // Slow down adaptation during double-talk
        }
      }

      // Update filter weights: W = W + (mu * error * x) / ||x||^2
      const normalizedStep = adaptationRate / refPower;
      for (let j = 0; j < filterLength; j++) {
        const bufIdx = (this.nlmsBufferIndex - j + filterLength) % filterLength;
        this.nlmsWeights[j] += normalizedStep * error * this.nlmsReferenceBuffer[bufIdx];
      }

      // Advance buffer index
      this.nlmsBufferIndex = (this.nlmsBufferIndex + 1) % filterLength;

      // Track error for convergence detection
      this.nlmsErrorHistory.push(Math.abs(error));
      if (this.nlmsErrorHistory.length > AudioPreprocessor.NLMS_ERROR_HISTORY_LENGTH) {
        this.nlmsErrorHistory.shift();
      }
    }

    // Check for filter convergence
    if (this.nlmsErrorHistory.length >= AudioPreprocessor.NLMS_ERROR_HISTORY_LENGTH) {
      const avgError =
        this.nlmsErrorHistory.reduce((a, b) => a + b, 0) / this.nlmsErrorHistory.length;
      this.nlmsConverged = avgError < AudioPreprocessor.NLMS_CONVERGENCE_THRESHOLD;
    }

    return output;
  }

  /**
   * Legacy echo cancellation method - kept for backwards compatibility
   * @deprecated Use applyNLMSEchoCancellation instead
   */
  private applyEchoCancellation(input: Float32Array): Float32Array {
    // Delegate to NLMS implementation
    return this.applyNLMSEchoCancellation(input);
  }

  /**
   * Set the echo reference signal (called when TTS audio is played)
   * @param reference The audio being played through speakers
   */
  setEchoReference(reference: Float32Array): void {
    if (!this.config.enableEchoCancellation) return;

    this.echoReference = new Float32Array(reference);
    this.echoReferenceTimestamp = Date.now();

    logger.debug('Echo reference updated', { samples: reference.length });
  }

  /**
   * Clear the echo reference (called when TTS playback ends)
   */
  clearEchoReference(): void {
    this.echoReference = null;
    this.echoReferenceTimestamp = 0;
  }

  /**
   * Notify that TTS playback has started (enables mic ducking)
   */
  notifyTTSStart(): void {
    this.isTTSPlaying = true;
    logger.debug('TTS started - mic ducking active');
    this.emit('tts-start');
  }

  /**
   * Notify that TTS playback has ended (begins mic ducking release)
   */
  notifyTTSEnd(): void {
    this.isTTSPlaying = false;
    this.ttsEndTimestamp = Date.now();
    logger.debug('TTS ended - mic ducking releasing');
    this.emit('tts-end');
  }

  /**
   * Check if TTS is currently playing
   */
  get isTTSActive(): boolean {
    return this.isTTSPlaying;
  }

  /**
   * Set echo cancellation aggressiveness level
   * @param level The aggressiveness level
   */
  setAggressiveness(level: EchoCancellationAggressiveness): void {
    this.config.echoCancellationAggressiveness = level;
    this.config.nlmsConfig = { ...NLMS_PRESETS[level] };

    // Resize NLMS filter if needed
    const newLength = this.config.nlmsConfig.filterLength;
    if (newLength !== this.nlmsWeights.length) {
      this.nlmsWeights = new Float32Array(newLength);
      this.nlmsReferenceBuffer = new Float32Array(newLength);
      this.nlmsBufferIndex = 0;
      this.nlmsConverged = false;
      this.nlmsErrorHistory = [];
    }

    logger.info('Echo cancellation aggressiveness set', {
      level,
      filterLength: newLength,
      stepSize: this.config.nlmsConfig.stepSize,
    });
    this.emit('aggressiveness-changed', level);
  }

  /**
   * Get current aggressiveness level
   */
  getAggressiveness(): EchoCancellationAggressiveness {
    return this.config.echoCancellationAggressiveness;
  }

  /**
   * Update mic ducking configuration
   */
  setMicDuckingConfig(config: Partial<MicDuckingConfig>): void {
    this.config.micDuckingConfig = { ...this.config.micDuckingConfig, ...config };
    logger.info('Mic ducking config updated', config);
  }

  /**
   * Enable or disable the preprocessor
   */
  setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
    logger.info('AudioPreprocessor', { enabled });
  }

  /**
   * Check if preprocessor is enabled
   */
  get enabled(): boolean {
    return this.isEnabled;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<AudioPreprocessorConfig>): void {
    this.config = { ...this.config, ...config };

    // Recalculate filter coefficients if needed
    if (config.highPassCutoff !== undefined || config.sampleRate !== undefined) {
      this.updateHighPassCoefficient();
    }

    logger.info('AudioPreprocessor config updated', config);
  }

  /**
   * Get current configuration
   */
  getConfig(): AudioPreprocessorConfig {
    return { ...this.config };
  }

  /**
   * Get preprocessor statistics
   */
  getStats(): PreprocessorStats {
    return {
      framesProcessed: this.framesProcessed,
      noiseGateActivations: this.noiseGateActivations,
      averageInputLevel: this.framesProcessed > 0 ? this.totalInputLevel / this.framesProcessed : 0,
      averageOutputLevel:
        this.framesProcessed > 0 ? this.totalOutputLevel / this.framesProcessed : 0,
      estimatedNoiseFloor: this.noiseFloorEstimate,
      processingTimeMs:
        this.framesProcessed > 0 ? this.totalProcessingTime / this.framesProcessed : 0,
      // Echo cancellation stats
      echoCancellationActive: this.config.enableEchoCancellation && this.echoReference !== null,
      echoReductionDb: this.echoReductionDb,
      nlmsFilterConverged: this.nlmsConverged,
      micDuckingActive: this.isTTSPlaying || Date.now() - this.ttsEndTimestamp < this.config.micDuckingConfig.holdMs,
      currentMicDuckingGain: this.micDuckingGain,
    };
  }

  /**
   * Reset statistics and state
   */
  reset(): void {
    this.noiseGateGain = 1.0;
    this.noiseGateActivations = 0;
    this.noiseBuffer = [];
    this.noiseBufferSamples = 0;
    this.noiseFloor = null;
    this.noiseFloorEstimate = 0;
    this.highPassPrev = 0;
    this.echoReference = null;
    this.echoReferenceTimestamp = 0;
    this.framesProcessed = 0;
    this.totalInputLevel = 0;
    this.totalOutputLevel = 0;
    this.totalProcessingTime = 0;

    // Reset NLMS filter state
    const filterLength = this.config.nlmsConfig.filterLength;
    this.nlmsWeights = new Float32Array(filterLength);
    this.nlmsReferenceBuffer = new Float32Array(filterLength);
    this.nlmsBufferIndex = 0;
    this.nlmsConverged = false;
    this.nlmsErrorHistory = [];
    this.echoReductionDb = 0;

    // Reset mic ducking state
    this.micDuckingGain = 1.0;
    this.isTTSPlaying = false;
    this.ttsEndTimestamp = 0;

    logger.debug('AudioPreprocessor reset');
  }

  /**
   * Reset only the NLMS filter (useful when acoustic conditions change)
   */
  resetNLMSFilter(): void {
    const filterLength = this.config.nlmsConfig.filterLength;
    this.nlmsWeights = new Float32Array(filterLength);
    this.nlmsReferenceBuffer = new Float32Array(filterLength);
    this.nlmsBufferIndex = 0;
    this.nlmsConverged = false;
    this.nlmsErrorHistory = [];

    logger.debug('NLMS filter reset');
  }

  /**
   * Reset only the noise estimate (useful when moving to a new environment)
   */
  resetNoiseEstimate(): void {
    this.noiseBuffer = [];
    this.noiseBufferSamples = 0;
    this.noiseFloor = null;
    this.noiseFloorEstimate = 0;

    logger.debug('Noise estimate reset');
  }
}

// Singleton instance
let audioPreprocessor: AudioPreprocessor | null = null;

/**
 * Get or create the audio preprocessor instance
 */
export function getAudioPreprocessor(): AudioPreprocessor {
  if (!audioPreprocessor) {
    audioPreprocessor = new AudioPreprocessor();
  }
  return audioPreprocessor;
}

/**
 * Shutdown the audio preprocessor
 */
export function shutdownAudioPreprocessor(): void {
  if (audioPreprocessor) {
    audioPreprocessor.reset();
    audioPreprocessor = null;
  }
}

// ============================================================================
// System Audio Ducking
// Reduces volume of other applications (Spotify, YouTube, etc.) when Atlas speaks
// ============================================================================

import { exec } from 'child_process';
import { promisify } from 'util';
import {
  SystemAudioDuckingConfig,
  DEFAULT_SYSTEM_AUDIO_DUCKING_CONFIG,
  SystemDuckingState,
  SystemDuckingStatus,
  SystemDuckingEvents,
  AudioSessionInfo,
} from '../../shared/types/voice';

const execAsync = promisify(exec);

/**
 * System Audio Ducker
 * Controls system volume to automatically lower other audio when Atlas speaks.
 * Uses Windows Audio Session API via PowerShell for per-app volume control.
 */
export class SystemAudioDucker extends EventEmitter {
  private config: SystemAudioDuckingConfig;
  private state: SystemDuckingState = 'idle';
  private originalVolume: number = 1.0;
  private currentVolume: number = 1.0;
  private targetVolume: number = 1.0;
  private duckStartTime: number = 0;
  private lastError: string | undefined;

  // Animation state
  private animationFrame: NodeJS.Timeout | null = null;
  private holdTimeout: NodeJS.Timeout | null = null;
  private readonly ANIMATION_INTERVAL_MS = 16; // ~60fps for smooth fading

  // Per-session volume tracking (for per-app ducking)
  private sessionVolumes: Map<number, number> = new Map();

  // Platform detection
  private readonly isWindows: boolean;
  private readonly isMac: boolean;
  private readonly isLinux: boolean;

  constructor(config?: Partial<SystemAudioDuckingConfig>) {
    super();
    this.config = { ...DEFAULT_SYSTEM_AUDIO_DUCKING_CONFIG, ...config };

    // Detect platform
    this.isWindows = process.platform === 'win32';
    this.isMac = process.platform === 'darwin';
    this.isLinux = process.platform === 'linux';

    logger.info('SystemAudioDucker initialized', {
      enabled: this.config.enabled,
      duckLevel: this.config.duckLevel,
      platform: process.platform,
    });
  }

  /**
   * Get current ducking status
   */
  getStatus(): SystemDuckingStatus {
    return {
      state: this.state,
      currentVolume: this.currentVolume,
      originalVolume: this.originalVolume,
      targetVolume: this.targetVolume,
      isActive: this.state !== 'idle',
      duckStartTime: this.duckStartTime,
      lastError: this.lastError,
    };
  }

  /**
   * Get current configuration
   */
  getConfig(): SystemAudioDuckingConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<SystemAudioDuckingConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('SystemAudioDucker config updated', config);
  }

  /**
   * Enable or disable ducking
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
    if (!enabled && this.state !== 'idle') {
      this.stopDucking();
    }
    logger.info('SystemAudioDucker', { enabled });
  }

  /**
   * Start ducking - called when TTS starts
   */
  async startDucking(): Promise<void> {
    if (!this.config.enabled) {
      logger.debug('System audio ducking disabled, skipping');
      return;
    }

    if (this.state !== 'idle') {
      logger.debug('Already ducking, refreshing state');
      // Cancel any pending release
      this.clearHoldTimeout();
      if (this.state === 'releasing' || this.state === 'holding') {
        this.transitionTo('ducked');
      }
      return;
    }

    try {
      // Get current system volume before ducking
      this.originalVolume = await this.getSystemVolume();
      this.duckStartTime = Date.now();

      // Calculate target ducked volume
      this.targetVolume = Math.max(
        this.originalVolume * this.config.duckLevel,
        this.config.minVolume
      );

      logger.info('Starting system audio ducking', {
        originalVolume: this.originalVolume,
        targetVolume: this.targetVolume,
      });

      this.emit('duck-start', this.originalVolume);
      this.transitionTo('attacking');

      // Start the fade animation
      this.startVolumeAnimation();
    } catch (error) {
      this.lastError = (error as Error).message;
      logger.error('Failed to start ducking', { error: this.lastError });
      this.emit('error', error as Error);
    }
  }

  /**
   * Stop ducking - called when TTS ends
   */
  async stopDucking(): Promise<void> {
    if (this.state === 'idle') {
      return;
    }

    // If we're attacking or ducked, transition to holding first
    if (this.state === 'attacking' || this.state === 'ducked') {
      this.transitionTo('holding');

      // After hold time, start releasing
      this.holdTimeout = setTimeout(() => {
        this.transitionTo('releasing');
        this.startVolumeAnimation();
      }, this.config.holdMs);
    }
    // If already holding or releasing, let it continue
  }

  /**
   * Force immediate stop and restore volume
   */
  async forceStop(): Promise<void> {
    this.clearHoldTimeout();
    this.stopVolumeAnimation();

    if (this.state !== 'idle') {
      try {
        await this.setSystemVolume(this.originalVolume);
        this.currentVolume = this.originalVolume;
      } catch (error) {
        logger.error('Failed to restore volume on force stop', { error: (error as Error).message });
      }
      this.transitionTo('idle');
      this.emit('duck-end', this.originalVolume);
    }
  }

  /**
   * Transition to a new state
   */
  private transitionTo(newState: SystemDuckingState): void {
    const oldState = this.state;
    if (oldState !== newState) {
      this.state = newState;
      logger.debug('Ducking state transition', { from: oldState, to: newState });
      this.emit('state-change', oldState, newState);
    }
  }

  /**
   * Start the volume fade animation
   */
  private startVolumeAnimation(): void {
    this.stopVolumeAnimation();

    const startVolume = this.currentVolume;
    const startTime = Date.now();

    // Determine fade duration based on state
    const duration = this.state === 'attacking'
      ? this.config.attackMs
      : this.config.releaseMs;

    // Determine target
    const target = this.state === 'attacking'
      ? this.targetVolume
      : Math.min(this.originalVolume, this.config.maxVolume);

    this.animationFrame = setInterval(async () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1.0);

      // Apply fade curve
      const easedProgress = this.applyFadeCurve(progress);

      // Calculate current volume
      const newVolume = startVolume + (target - startVolume) * easedProgress;

      // Clamp to valid range
      this.currentVolume = Math.max(this.config.minVolume, Math.min(1.0, newVolume));

      try {
        await this.setSystemVolume(this.currentVolume);
        this.emit('volume-change', this.currentVolume);
      } catch (error) {
        logger.error('Failed to set volume during animation', { error: (error as Error).message });
      }

      // Check if animation complete
      if (progress >= 1.0) {
        this.stopVolumeAnimation();

        if (this.state === 'attacking') {
          this.transitionTo('ducked');
        } else if (this.state === 'releasing') {
          this.transitionTo('idle');
          this.emit('duck-end', this.currentVolume);
        }
      }
    }, this.ANIMATION_INTERVAL_MS);
  }

  /**
   * Stop the volume fade animation
   */
  private stopVolumeAnimation(): void {
    if (this.animationFrame) {
      clearInterval(this.animationFrame);
      this.animationFrame = null;
    }
  }

  /**
   * Clear the hold timeout
   */
  private clearHoldTimeout(): void {
    if (this.holdTimeout) {
      clearTimeout(this.holdTimeout);
      this.holdTimeout = null;
    }
  }

  /**
   * Apply fade curve to progress value
   */
  private applyFadeCurve(progress: number): number {
    switch (this.config.fadeType) {
      case 'exponential':
        // Exponential ease-out for natural sounding fades
        return 1 - Math.pow(1 - progress, 3);
      case 'logarithmic':
        // Logarithmic curve (inverse exponential)
        return Math.pow(progress, 0.5);
      case 'linear':
      default:
        return progress;
    }
  }

  /**
   * Get current system volume (0-1)
   * Platform-specific implementation
   */
  private async getSystemVolume(): Promise<number> {
    try {
      if (this.isWindows) {
        return await this.getWindowsVolume();
      } else if (this.isMac) {
        return await this.getMacVolume();
      } else if (this.isLinux) {
        return await this.getLinuxVolume();
      }

      logger.warn('Unsupported platform for audio ducking');
      return 1.0;
    } catch (error) {
      logger.error('Failed to get system volume', { error: (error as Error).message });
      return 1.0;
    }
  }

  /**
   * Set system volume (0-1)
   * Platform-specific implementation
   */
  private async setSystemVolume(volume: number): Promise<void> {
    // Clamp volume to valid range
    const clampedVolume = Math.max(0, Math.min(1, volume));

    try {
      if (this.isWindows) {
        await this.setWindowsVolume(clampedVolume);
      } else if (this.isMac) {
        await this.setMacVolume(clampedVolume);
      } else if (this.isLinux) {
        await this.setLinuxVolume(clampedVolume);
      } else {
        logger.warn('Unsupported platform for audio ducking');
      }
    } catch (error) {
      logger.error('Failed to set system volume', { error: (error as Error).message, volume });
      throw error;
    }
  }

  // ============================================================================
  // Windows Implementation (PowerShell + Audio Session API)
  // ============================================================================

  /**
   * Get volume on Windows using PowerShell
   */
  private async getWindowsVolume(): Promise<number> {
    const script = `
      Add-Type -TypeDefinition @'
      using System;
      using System.Runtime.InteropServices;

      [Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
      interface IAudioEndpointVolume {
        int RegisterControlChangeNotify(IntPtr pNotify);
        int UnregisterControlChangeNotify(IntPtr pNotify);
        int GetChannelCount(out uint pnChannelCount);
        int SetMasterVolumeLevel(float fLevelDB, ref Guid pguidEventContext);
        int SetMasterVolumeLevelScalar(float fLevel, ref Guid pguidEventContext);
        int GetMasterVolumeLevel(out float pfLevelDB);
        int GetMasterVolumeLevelScalar(out float pfLevel);
      }

      [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
      interface IMMDevice {
        int Activate(ref Guid iid, uint dwClsCtx, IntPtr pActivationParams, out IAudioEndpointVolume ppInterface);
      }

      [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
      interface IMMDeviceEnumerator {
        int EnumAudioEndpoints(int dataFlow, int dwStateMask, out IntPtr ppDevices);
        int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice ppEndpoint);
      }

      [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
      class MMDeviceEnumerator { }

      public class AudioManager {
        public static float GetMasterVolume() {
          IMMDeviceEnumerator enumerator = (IMMDeviceEnumerator)new MMDeviceEnumerator();
          IMMDevice device;
          enumerator.GetDefaultAudioEndpoint(0, 1, out device);
          Guid iid = typeof(IAudioEndpointVolume).GUID;
          IAudioEndpointVolume volume;
          device.Activate(ref iid, 1, IntPtr.Zero, out volume);
          float level;
          volume.GetMasterVolumeLevelScalar(out level);
          return level;
        }
      }
'@ -ErrorAction SilentlyContinue

      try {
        [AudioManager]::GetMasterVolume()
      } catch {
        (Get-AudioDevice -PlaybackVolume) / 100
      }
    `;

    try {
      const { stdout } = await execAsync(`powershell -Command "${script.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, {
        timeout: 5000,
      });
      const volume = parseFloat(stdout.trim());
      return isNaN(volume) ? 1.0 : volume;
    } catch (error) {
      // Fallback to simpler method
      try {
        const { stdout } = await execAsync(
          'powershell -Command "(Get-AudioDevice -PlaybackVolume) / 100"',
          { timeout: 3000 }
        );
        const volume = parseFloat(stdout.trim());
        return isNaN(volume) ? 1.0 : volume;
      } catch {
        logger.warn('Could not get Windows volume, using default');
        return 1.0;
      }
    }
  }

  /**
   * Set volume on Windows using PowerShell
   */
  private async setWindowsVolume(volume: number): Promise<void> {
    const volumePercent = Math.round(volume * 100);

    const script = `
      Add-Type -TypeDefinition @'
      using System;
      using System.Runtime.InteropServices;

      [Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
      interface IAudioEndpointVolume {
        int RegisterControlChangeNotify(IntPtr pNotify);
        int UnregisterControlChangeNotify(IntPtr pNotify);
        int GetChannelCount(out uint pnChannelCount);
        int SetMasterVolumeLevel(float fLevelDB, ref Guid pguidEventContext);
        int SetMasterVolumeLevelScalar(float fLevel, ref Guid pguidEventContext);
        int GetMasterVolumeLevel(out float pfLevelDB);
        int GetMasterVolumeLevelScalar(out float pfLevel);
      }

      [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
      interface IMMDevice {
        int Activate(ref Guid iid, uint dwClsCtx, IntPtr pActivationParams, out IAudioEndpointVolume ppInterface);
      }

      [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
      interface IMMDeviceEnumerator {
        int EnumAudioEndpoints(int dataFlow, int dwStateMask, out IntPtr ppDevices);
        int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice ppEndpoint);
      }

      [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
      class MMDeviceEnumerator { }

      public class AudioManager {
        public static void SetMasterVolume(float level) {
          IMMDeviceEnumerator enumerator = (IMMDeviceEnumerator)new MMDeviceEnumerator();
          IMMDevice device;
          enumerator.GetDefaultAudioEndpoint(0, 1, out device);
          Guid iid = typeof(IAudioEndpointVolume).GUID;
          IAudioEndpointVolume volume;
          device.Activate(ref iid, 1, IntPtr.Zero, out volume);
          Guid guid = Guid.Empty;
          volume.SetMasterVolumeLevelScalar(level, ref guid);
        }
      }
'@ -ErrorAction SilentlyContinue

      try {
        [AudioManager]::SetMasterVolume(${volume})
      } catch {
        Set-AudioDevice -PlaybackVolume ${volumePercent}
      }
    `;

    try {
      await execAsync(`powershell -Command "${script.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, {
        timeout: 5000,
      });
    } catch (error) {
      // Fallback to simpler method using nircmd if available, or Set-AudioDevice
      try {
        await execAsync(
          `powershell -Command "Set-AudioDevice -PlaybackVolume ${volumePercent}"`,
          { timeout: 3000 }
        );
      } catch {
        // Try nircmd as last resort (if installed)
        try {
          await execAsync(`nircmd.exe setsysvolume ${Math.round(volume * 65535)}`, {
            timeout: 2000,
          });
        } catch {
          throw new Error('Could not set Windows volume - no compatible method found');
        }
      }
    }
  }

  // ============================================================================
  // macOS Implementation (osascript)
  // ============================================================================

  /**
   * Get volume on macOS using AppleScript
   */
  private async getMacVolume(): Promise<number> {
    try {
      const { stdout } = await execAsync(
        'osascript -e "output volume of (get volume settings)"',
        { timeout: 3000 }
      );
      const volume = parseInt(stdout.trim(), 10);
      return isNaN(volume) ? 1.0 : volume / 100;
    } catch (error) {
      logger.warn('Could not get macOS volume', { error: (error as Error).message });
      return 1.0;
    }
  }

  /**
   * Set volume on macOS using AppleScript
   */
  private async setMacVolume(volume: number): Promise<void> {
    const volumePercent = Math.round(volume * 100);
    try {
      await execAsync(`osascript -e "set volume output volume ${volumePercent}"`, {
        timeout: 3000,
      });
    } catch (error) {
      throw new Error(`Could not set macOS volume: ${(error as Error).message}`);
    }
  }

  // ============================================================================
  // Linux Implementation (pactl/amixer)
  // ============================================================================

  /**
   * Get volume on Linux using pactl or amixer
   */
  private async getLinuxVolume(): Promise<number> {
    // Try PulseAudio first
    try {
      const { stdout } = await execAsync(
        "pactl get-sink-volume @DEFAULT_SINK@ | grep -oP '\\d+%' | head -1 | tr -d '%'",
        { timeout: 3000 }
      );
      const volume = parseInt(stdout.trim(), 10);
      if (!isNaN(volume)) {
        return volume / 100;
      }
    } catch {
      // Fall through to amixer
    }

    // Try ALSA amixer
    try {
      const { stdout } = await execAsync(
        "amixer get Master | grep -oP '\\d+%' | head -1 | tr -d '%'",
        { timeout: 3000 }
      );
      const volume = parseInt(stdout.trim(), 10);
      return isNaN(volume) ? 1.0 : volume / 100;
    } catch (error) {
      logger.warn('Could not get Linux volume', { error: (error as Error).message });
      return 1.0;
    }
  }

  /**
   * Set volume on Linux using pactl or amixer
   */
  private async setLinuxVolume(volume: number): Promise<void> {
    const volumePercent = Math.round(volume * 100);

    // Try PulseAudio first
    try {
      await execAsync(`pactl set-sink-volume @DEFAULT_SINK@ ${volumePercent}%`, {
        timeout: 3000,
      });
      return;
    } catch {
      // Fall through to amixer
    }

    // Try ALSA amixer
    try {
      await execAsync(`amixer set Master ${volumePercent}%`, { timeout: 3000 });
    } catch (error) {
      throw new Error(`Could not set Linux volume: ${(error as Error).message}`);
    }
  }

  // ============================================================================
  // Per-App Volume Control (Windows only - advanced feature)
  // ============================================================================

  /**
   * Get list of audio sessions (Windows only)
   * This allows per-app volume control instead of system-wide
   */
  async getAudioSessions(): Promise<AudioSessionInfo[]> {
    if (!this.isWindows) {
      logger.warn('Per-app audio control only supported on Windows');
      return [];
    }

    const script = `
      $OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::UTF8
      Get-Process | Where-Object {$_.MainWindowHandle -ne 0} | ForEach-Object {
        $process = $_
        try {
          $audioSession = Get-AudioSession -ProcessId $process.Id -ErrorAction SilentlyContinue
          if ($audioSession) {
            [PSCustomObject]@{
              PID = $process.Id
              Name = $process.ProcessName
              Volume = $audioSession.Volume
              Muted = $audioSession.Muted
            } | ConvertTo-Json -Compress
          }
        } catch {}
      }
    `;

    try {
      const { stdout } = await execAsync(`powershell -Command "${script.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, {
        timeout: 10000,
      });

      const sessions: AudioSessionInfo[] = [];
      const lines = stdout.trim().split('\n').filter(Boolean);

      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          const isSelf = this.config.excludedProcesses.some(
            (p) => parsed.Name.toLowerCase() === p.toLowerCase().replace('.exe', '')
          );

          sessions.push({
            pid: parsed.PID,
            processName: parsed.Name,
            displayName: parsed.Name,
            volume: parsed.Volume || 1.0,
            isMuted: parsed.Muted || false,
            isSelf,
          });
        } catch {
          // Skip malformed entries
        }
      }

      return sessions;
    } catch (error) {
      logger.debug('Could not enumerate audio sessions', { error: (error as Error).message });
      return [];
    }
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.stopVolumeAnimation();
    this.clearHoldTimeout();
    this.removeAllListeners();
  }

  // Type-safe event emitter methods
  on<K extends keyof SystemDuckingEvents>(event: K, listener: SystemDuckingEvents[K]): this {
    return super.on(event, listener);
  }

  off<K extends keyof SystemDuckingEvents>(event: K, listener: SystemDuckingEvents[K]): this {
    return super.off(event, listener);
  }

  emit<K extends keyof SystemDuckingEvents>(
    event: K,
    ...args: Parameters<SystemDuckingEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }
}

// Singleton instance for system audio ducking
let systemAudioDucker: SystemAudioDucker | null = null;

/**
 * Get or create the system audio ducker instance
 */
export function getSystemAudioDucker(config?: Partial<SystemAudioDuckingConfig>): SystemAudioDucker {
  if (!systemAudioDucker) {
    systemAudioDucker = new SystemAudioDucker(config);
  }
  return systemAudioDucker;
}

/**
 * Shutdown the system audio ducker
 */
export async function shutdownSystemAudioDucker(): Promise<void> {
  if (systemAudioDucker) {
    await systemAudioDucker.forceStop();
    systemAudioDucker.dispose();
    systemAudioDucker = null;
  }
}

export default AudioPreprocessor;
