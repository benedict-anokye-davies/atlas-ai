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
  /** Echo cancellation strength (0-1) */
  echoCancellationStrength: number;

  /** Sample rate */
  sampleRate: number;
}

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

  enableEchoCancellation: false, // Disabled by default until 036-C
  echoCancellationStrength: 0.7,

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
  private noiseFloor: Float32Array | null = null;
  private noiseFloorEstimate: number = 0;

  // High-pass filter state (first-order IIR)
  private highPassPrev: number = 0;
  private highPassAlpha: number = 0;

  // Echo cancellation state
  private echoReference: Float32Array | null = null;
  private echoReferenceTimestamp: number = 0;
  private echoDelayMs: number = 50; // Typical speaker-to-mic delay

  // Statistics
  private framesProcessed: number = 0;
  private totalInputLevel: number = 0;
  private totalOutputLevel: number = 0;
  private totalProcessingTime: number = 0;

  constructor(config?: Partial<AudioPreprocessorConfig>) {
    super();
    this.config = { ...DEFAULT_PREPROCESSOR_CONFIG, ...config };

    // Calculate high-pass filter coefficient
    this.updateHighPassCoefficient();

    logger.info('AudioPreprocessor initialized', {
      noiseGate: this.config.enableNoiseGate,
      noiseReduction: this.config.enableNoiseReduction,
      highPass: this.config.enableHighPass,
      echoCancellation: this.config.enableEchoCancellation,
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

    // 5. Echo cancellation (subtract reference signal)
    if (this.config.enableEchoCancellation && this.echoReference) {
      processed = this.applyEchoCancellation(processed) as Float32Array;
    }

    // Calculate output level for statistics
    const outputLevel = this.calculateRMS(processed);
    this.totalOutputLevel += outputLevel;

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
      // Store frame for noise estimation
      this.noiseBuffer.push(new Float32Array(input));

      // Keep only recent frames
      if (this.noiseBuffer.length > this.config.noiseEstimationFrames) {
        this.noiseBuffer.shift();
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
   * Apply echo cancellation by subtracting reference signal
   * This is a basic implementation - more sophisticated AEC would use adaptive filters
   */
  private applyEchoCancellation(input: Float32Array): Float32Array {
    if (!this.echoReference) {
      return input;
    }

    const output = new Float32Array(input.length);
    const strength = this.config.echoCancellationStrength;

    // Check if reference is recent enough (within 500ms)
    const now = Date.now();
    if (now - this.echoReferenceTimestamp > 500) {
      this.echoReference = null;
      return input;
    }

    // Simple subtraction (in production, use NLMS or similar adaptive filter)
    const refLength = Math.min(input.length, this.echoReference.length);
    for (let i = 0; i < input.length; i++) {
      if (i < refLength) {
        // Subtract scaled reference
        output[i] = input[i] - this.echoReference[i] * strength;
      } else {
        output[i] = input[i];
      }
    }

    return output;
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
    };
  }

  /**
   * Reset statistics and state
   */
  reset(): void {
    this.noiseGateGain = 1.0;
    this.noiseGateActivations = 0;
    this.noiseBuffer = [];
    this.noiseFloor = null;
    this.noiseFloorEstimate = 0;
    this.highPassPrev = 0;
    this.echoReference = null;
    this.echoReferenceTimestamp = 0;
    this.framesProcessed = 0;
    this.totalInputLevel = 0;
    this.totalOutputLevel = 0;
    this.totalProcessingTime = 0;

    logger.debug('AudioPreprocessor reset');
  }

  /**
   * Reset only the noise estimate (useful when moving to a new environment)
   */
  resetNoiseEstimate(): void {
    this.noiseBuffer = [];
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

export default AudioPreprocessor;
