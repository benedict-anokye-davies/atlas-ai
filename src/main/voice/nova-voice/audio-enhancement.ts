/**
 * NovaVoice - Enhanced Audio Processing
 * Noise suppression, AEC, AGC, and audio enhancements
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../../utils/logger';

const logger = createModuleLogger('NovaVoice-AudioProcessing');

// ============================================
// Noise Suppression (RNNoise-inspired)
// ============================================

/**
 * Spectral noise gate parameters
 */
interface NoiseGateConfig {
  threshold: number;      // -60 to 0 dB
  attack: number;         // ms
  release: number;        // ms
  ratio: number;          // compression ratio
  makeupGain: number;     // dB
}

const DEFAULT_NOISE_GATE: NoiseGateConfig = {
  threshold: -40,
  attack: 5,
  release: 50,
  ratio: 4,
  makeupGain: 0,
};

/**
 * Simple spectral noise suppression
 * Based on spectral subtraction method
 */
export class NoiseSuppressionProcessor {
  private noiseFloor: Float32Array;
  private smoothingFactor = 0.98;
  private suppressionFactor = 0.9;
  private isCalibrated = false;
  private calibrationFrames = 0;
  private readonly calibrationDuration = 30; // frames
  
  constructor(private fftSize: number = 512) {
    this.noiseFloor = new Float32Array(fftSize / 2);
  }
  
  /**
   * Start noise floor calibration
   * Should be called during silence
   */
  startCalibration(): void {
    this.isCalibrated = false;
    this.calibrationFrames = 0;
    this.noiseFloor.fill(0);
    logger.info('Starting noise calibration');
  }
  
  /**
   * Process audio frame for noise reduction
   */
  process(samples: Float32Array): Float32Array {
    // Simple spectral subtraction approximation
    // In production, use proper FFT-based processing
    
    const output = new Float32Array(samples.length);
    const rms = this.calculateRMS(samples);
    
    // Calibration phase - learn noise floor
    if (!this.isCalibrated && this.calibrationFrames < this.calibrationDuration) {
      for (let i = 0; i < samples.length; i++) {
        this.noiseFloor[i % this.noiseFloor.length] = 
          this.smoothingFactor * this.noiseFloor[i % this.noiseFloor.length] +
          (1 - this.smoothingFactor) * Math.abs(samples[i]);
      }
      this.calibrationFrames++;
      
      if (this.calibrationFrames >= this.calibrationDuration) {
        this.isCalibrated = true;
        logger.info('Noise calibration complete', { avgNoiseFloor: this.getAverageNoiseFloor() });
      }
      
      return samples; // Pass through during calibration
    }
    
    // Apply spectral subtraction
    const avgNoiseFloor = this.getAverageNoiseFloor();
    const threshold = avgNoiseFloor * 2;
    
    for (let i = 0; i < samples.length; i++) {
      const sample = samples[i];
      const absSample = Math.abs(sample);
      
      if (absSample > threshold) {
        // Signal is above noise floor, apply mild suppression
        const suppressionAmount = Math.min(1, (absSample - avgNoiseFloor) / absSample);
        output[i] = sample * (this.suppressionFactor + (1 - this.suppressionFactor) * suppressionAmount);
      } else {
        // Signal is at noise floor, apply heavy suppression
        output[i] = sample * (1 - this.suppressionFactor);
      }
    }
    
    return output;
  }
  
  private calculateRMS(samples: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < samples.length; i++) {
      sum += samples[i] * samples[i];
    }
    return Math.sqrt(sum / samples.length);
  }
  
  private getAverageNoiseFloor(): number {
    let sum = 0;
    for (let i = 0; i < this.noiseFloor.length; i++) {
      sum += this.noiseFloor[i];
    }
    return sum / this.noiseFloor.length;
  }
  
  /**
   * Update suppression parameters
   */
  setSuppressionFactor(factor: number): void {
    this.suppressionFactor = Math.max(0, Math.min(1, factor));
  }
}

// ============================================
// Acoustic Echo Cancellation (AEC)
// ============================================

/**
 * Simple AEC using NLMS algorithm
 * For production, use WebRTC's AEC3
 */
export class AcousticEchoCanceller {
  private filterLength: number;
  private filterCoeffs: Float32Array;
  private referenceBuffer: Float32Array;
  private bufferIndex = 0;
  private mu = 0.01; // Step size
  private enabled = true;
  
  constructor(filterLength: number = 1024) {
    this.filterLength = filterLength;
    this.filterCoeffs = new Float32Array(filterLength);
    this.referenceBuffer = new Float32Array(filterLength);
  }
  
  /**
   * Add reference signal (speaker output)
   */
  addReference(samples: Float32Array): void {
    for (let i = 0; i < samples.length; i++) {
      this.referenceBuffer[this.bufferIndex] = samples[i];
      this.bufferIndex = (this.bufferIndex + 1) % this.filterLength;
    }
  }
  
  /**
   * Process microphone input to remove echo
   */
  process(micInput: Float32Array): Float32Array {
    if (!this.enabled) return micInput;
    
    const output = new Float32Array(micInput.length);
    
    for (let i = 0; i < micInput.length; i++) {
      // Estimate echo
      let echoEstimate = 0;
      for (let j = 0; j < this.filterLength; j++) {
        const refIndex = (this.bufferIndex - j + this.filterLength) % this.filterLength;
        echoEstimate += this.filterCoeffs[j] * this.referenceBuffer[refIndex];
      }
      
      // Subtract estimated echo
      const error = micInput[i] - echoEstimate;
      output[i] = error;
      
      // Update filter coefficients (NLMS)
      const refPower = this.calculatePower();
      if (refPower > 1e-10) {
        const normalizedMu = this.mu / (refPower + 1e-10);
        for (let j = 0; j < this.filterLength; j++) {
          const refIndex = (this.bufferIndex - j + this.filterLength) % this.filterLength;
          this.filterCoeffs[j] += normalizedMu * error * this.referenceBuffer[refIndex];
        }
      }
    }
    
    return output;
  }
  
  private calculatePower(): number {
    let power = 0;
    for (let i = 0; i < this.filterLength; i++) {
      power += this.referenceBuffer[i] * this.referenceBuffer[i];
    }
    return power;
  }
  
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }
  
  reset(): void {
    this.filterCoeffs.fill(0);
    this.referenceBuffer.fill(0);
    this.bufferIndex = 0;
  }
}

// ============================================
// Automatic Gain Control (AGC)
// ============================================

export interface AGCConfig {
  targetLevel: number;      // Target RMS level (0-1)
  maxGain: number;          // Maximum gain in dB
  minGain: number;          // Minimum gain in dB
  attackTime: number;       // Attack time in ms
  releaseTime: number;      // Release time in ms
  enabled: boolean;
}

const DEFAULT_AGC_CONFIG: AGCConfig = {
  targetLevel: 0.3,
  maxGain: 30,
  minGain: -20,
  attackTime: 10,
  releaseTime: 100,
  enabled: true,
};

export class AutomaticGainControl {
  private config: AGCConfig;
  private currentGain = 1.0;
  private sampleRate: number;
  private attackCoeff: number;
  private releaseCoeff: number;
  
  constructor(sampleRate: number = 16000, config: Partial<AGCConfig> = {}) {
    this.config = { ...DEFAULT_AGC_CONFIG, ...config };
    this.sampleRate = sampleRate;
    this.attackCoeff = Math.exp(-1 / (this.config.attackTime * sampleRate / 1000));
    this.releaseCoeff = Math.exp(-1 / (this.config.releaseTime * sampleRate / 1000));
  }
  
  process(samples: Float32Array): Float32Array {
    if (!this.config.enabled) return samples;
    
    const output = new Float32Array(samples.length);
    const rms = this.calculateRMS(samples);
    
    // Calculate desired gain
    let desiredGain = 1.0;
    if (rms > 1e-10) {
      desiredGain = this.config.targetLevel / rms;
    }
    
    // Apply gain limits
    const maxLinearGain = Math.pow(10, this.config.maxGain / 20);
    const minLinearGain = Math.pow(10, this.config.minGain / 20);
    desiredGain = Math.max(minLinearGain, Math.min(maxLinearGain, desiredGain));
    
    // Smooth gain changes
    for (let i = 0; i < samples.length; i++) {
      // Use attack or release coefficient based on gain direction
      const coeff = desiredGain > this.currentGain ? this.attackCoeff : this.releaseCoeff;
      this.currentGain = coeff * this.currentGain + (1 - coeff) * desiredGain;
      
      // Apply gain with soft clipping
      output[i] = this.softClip(samples[i] * this.currentGain);
    }
    
    return output;
  }
  
  private calculateRMS(samples: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < samples.length; i++) {
      sum += samples[i] * samples[i];
    }
    return Math.sqrt(sum / samples.length);
  }
  
  private softClip(sample: number): number {
    // Soft clipping using tanh
    if (Math.abs(sample) < 0.5) {
      return sample;
    }
    return Math.tanh(sample);
  }
  
  getCurrentGain(): number {
    return this.currentGain;
  }
  
  getCurrentGainDb(): number {
    return 20 * Math.log10(this.currentGain);
  }
  
  setConfig(config: Partial<AGCConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

// ============================================
// Voice Activity Detector with Adaptive Threshold
// ============================================

export interface AdaptiveVADConfig {
  initialThreshold: number;
  minThreshold: number;
  maxThreshold: number;
  adaptationRate: number;
  hangoverFrames: number;
}

const DEFAULT_ADAPTIVE_VAD_CONFIG: AdaptiveVADConfig = {
  initialThreshold: 0.01,
  minThreshold: 0.005,
  maxThreshold: 0.1,
  adaptationRate: 0.001,
  hangoverFrames: 10,
};

export class AdaptiveVAD {
  private config: AdaptiveVADConfig;
  private currentThreshold: number;
  private noiseEstimate: number = 0;
  private hangoverCounter = 0;
  private isActive = false;
  
  constructor(config: Partial<AdaptiveVADConfig> = {}) {
    this.config = { ...DEFAULT_ADAPTIVE_VAD_CONFIG, ...config };
    this.currentThreshold = this.config.initialThreshold;
  }
  
  process(samples: Float32Array): { isSpeech: boolean; confidence: number; threshold: number } {
    const energy = this.calculateEnergy(samples);
    
    // Update noise estimate during silence
    if (!this.isActive) {
      this.noiseEstimate = 0.99 * this.noiseEstimate + 0.01 * energy;
    }
    
    // Adapt threshold based on noise
    const adaptiveThreshold = Math.max(
      this.config.minThreshold,
      Math.min(this.config.maxThreshold, this.noiseEstimate * 3)
    );
    
    this.currentThreshold = 0.99 * this.currentThreshold + 0.01 * adaptiveThreshold;
    
    // Detect speech
    const isSpeech = energy > this.currentThreshold;
    
    // Hangover logic
    if (isSpeech) {
      this.hangoverCounter = this.config.hangoverFrames;
      this.isActive = true;
    } else if (this.hangoverCounter > 0) {
      this.hangoverCounter--;
    } else {
      this.isActive = false;
    }
    
    const confidence = Math.min(1, energy / (this.currentThreshold + 1e-10));
    
    return {
      isSpeech: this.isActive,
      confidence,
      threshold: this.currentThreshold,
    };
  }
  
  private calculateEnergy(samples: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < samples.length; i++) {
      sum += samples[i] * samples[i];
    }
    return sum / samples.length;
  }
  
  reset(): void {
    this.currentThreshold = this.config.initialThreshold;
    this.noiseEstimate = 0;
    this.hangoverCounter = 0;
    this.isActive = false;
  }
}

// ============================================
// Audio Enhancement Pipeline
// ============================================

export interface AudioEnhancementConfig {
  enableNoiseSuppression: boolean;
  enableAEC: boolean;
  enableAGC: boolean;
  enableAdaptiveVAD: boolean;
  noiseSuppressionLevel: number; // 0-1
  agcTargetLevel: number;        // 0-1
}

const DEFAULT_ENHANCEMENT_CONFIG: AudioEnhancementConfig = {
  enableNoiseSuppression: true,
  enableAEC: true,
  enableAGC: true,
  enableAdaptiveVAD: true,
  noiseSuppressionLevel: 0.8,
  agcTargetLevel: 0.3,
};

export class AudioEnhancementPipeline extends EventEmitter {
  private config: AudioEnhancementConfig;
  private noiseSuppressor: NoiseSuppressionProcessor;
  private aec: AcousticEchoCanceller;
  private agc: AutomaticGainControl;
  private adaptiveVad: AdaptiveVAD;
  private sampleRate: number;
  
  constructor(sampleRate: number = 16000, config: Partial<AudioEnhancementConfig> = {}) {
    super();
    this.sampleRate = sampleRate;
    this.config = { ...DEFAULT_ENHANCEMENT_CONFIG, ...config };
    
    this.noiseSuppressor = new NoiseSuppressionProcessor();
    this.aec = new AcousticEchoCanceller();
    this.agc = new AutomaticGainControl(sampleRate, { targetLevel: config.agcTargetLevel });
    this.adaptiveVad = new AdaptiveVAD();
    
    this.noiseSuppressor.setSuppressionFactor(this.config.noiseSuppressionLevel);
    
    logger.info('Audio enhancement pipeline initialized', { config: this.config });
  }
  
  /**
   * Process audio through full enhancement pipeline
   */
  process(samples: Float32Array, speakerOutput?: Float32Array): {
    enhanced: Float32Array;
    vadResult: { isSpeech: boolean; confidence: number };
  } {
    let audio = samples;
    
    // 1. AEC (if speaker output is provided)
    if (this.config.enableAEC && speakerOutput) {
      this.aec.addReference(speakerOutput);
      audio = this.aec.process(audio);
    }
    
    // 2. Noise Suppression
    if (this.config.enableNoiseSuppression) {
      audio = this.noiseSuppressor.process(audio);
    }
    
    // 3. AGC
    if (this.config.enableAGC) {
      audio = this.agc.process(audio);
    }
    
    // 4. Adaptive VAD
    let vadResult = { isSpeech: false, confidence: 0 };
    if (this.config.enableAdaptiveVAD) {
      const result = this.adaptiveVad.process(audio);
      vadResult = { isSpeech: result.isSpeech, confidence: result.confidence };
    }
    
    return { enhanced: audio, vadResult };
  }
  
  /**
   * Start noise calibration
   */
  calibrateNoise(): void {
    this.noiseSuppressor.startCalibration();
  }
  
  /**
   * Reset all processors
   */
  reset(): void {
    this.aec.reset();
    this.adaptiveVad.reset();
  }
  
  /**
   * Update configuration
   */
  setConfig(config: Partial<AudioEnhancementConfig>): void {
    this.config = { ...this.config, ...config };
    this.noiseSuppressor.setSuppressionFactor(this.config.noiseSuppressionLevel);
    this.agc.setConfig({ targetLevel: this.config.agcTargetLevel });
    logger.info('Audio enhancement config updated', { config: this.config });
  }
  
  /**
   * Get current AGC gain
   */
  getCurrentGain(): number {
    return this.agc.getCurrentGainDb();
  }
}

// ============================================
// Exports
// ============================================

export {
  DEFAULT_NOISE_GATE,
  DEFAULT_AGC_CONFIG,
  DEFAULT_ADAPTIVE_VAD_CONFIG,
  DEFAULT_ENHANCEMENT_CONFIG,
};
