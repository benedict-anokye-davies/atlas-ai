/**
 * Atlas Voice - Prosody Feature Extractor
 *
 * Extracts prosody features (pitch, pace, volume, pauses) from audio buffers.
 * Uses DSP techniques: autocorrelation for pitch, RMS for energy, etc.
 *
 * @module voice/prosody/feature-extractor
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../../utils/logger';
import {
  ProsodyFeatures,
  SimpleProsodyFeatures,
  ProsodyAnalyzerConfig,
  DEFAULT_PROSODY_CONFIG,
} from './types';

const logger = createModuleLogger('ProsodyFeatureExtractor');

// =============================================================================
// DSP Utilities
// =============================================================================

/**
 * Convert Int16 audio samples to Float32 (-1 to 1)
 */
function int16ToFloat32(int16Array: Int16Array): Float32Array {
  const float32Array = new Float32Array(int16Array.length);
  for (let i = 0; i < int16Array.length; i++) {
    float32Array[i] = int16Array[i] / 32768.0;
  }
  return float32Array;
}

/**
 * Calculate RMS (Root Mean Square) energy of a signal
 */
function calculateRMS(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / samples.length);
}

/**
 * Calculate zero-crossing rate (rough frequency estimate)
 */
function calculateZCR(samples: Float32Array): number {
  if (samples.length < 2) return 0;
  
  let crossings = 0;
  for (let i = 1; i < samples.length; i++) {
    if ((samples[i] >= 0 && samples[i - 1] < 0) ||
        (samples[i] < 0 && samples[i - 1] >= 0)) {
      crossings++;
    }
  }
  return crossings / samples.length;
}

/**
 * Autocorrelation-based pitch detection (YIN-inspired)
 */
function detectPitch(
  samples: Float32Array,
  sampleRate: number,
  minFreq: number,
  maxFreq: number
): number | null {
  const minPeriod = Math.floor(sampleRate / maxFreq);
  const maxPeriod = Math.floor(sampleRate / minFreq);
  
  if (samples.length < maxPeriod * 2) {
    return null; // Not enough samples
  }
  
  // Calculate difference function (simplified YIN)
  const diffFunc = new Float32Array(maxPeriod - minPeriod + 1);
  
  for (let tau = minPeriod; tau <= maxPeriod; tau++) {
    let sum = 0;
    for (let j = 0; j < samples.length - tau; j++) {
      const diff = samples[j] - samples[j + tau];
      sum += diff * diff;
    }
    diffFunc[tau - minPeriod] = sum;
  }
  
  // Cumulative mean normalized difference
  const cmndf = new Float32Array(diffFunc.length);
  cmndf[0] = 1;
  let runningSum = diffFunc[0];
  
  for (let tau = 1; tau < diffFunc.length; tau++) {
    runningSum += diffFunc[tau];
    cmndf[tau] = diffFunc[tau] * tau / runningSum;
  }
  
  // Find first minimum below threshold
  const threshold = 0.1;
  let bestTau = -1;
  
  for (let tau = 1; tau < cmndf.length - 1; tau++) {
    if (cmndf[tau] < threshold &&
        cmndf[tau] < cmndf[tau - 1] &&
        cmndf[tau] < cmndf[tau + 1]) {
      bestTau = tau + minPeriod;
      break;
    }
  }
  
  // Fallback: find global minimum
  if (bestTau < 0) {
    let minVal = Infinity;
    for (let tau = 0; tau < cmndf.length; tau++) {
      if (cmndf[tau] < minVal) {
        minVal = cmndf[tau];
        bestTau = tau + minPeriod;
      }
    }
    // Only use if confidence is reasonable
    if (minVal > 0.5) return null;
  }
  
  return bestTau > 0 ? sampleRate / bestTau : null;
}

/**
 * Detect pauses (silence segments) in audio
 */
function detectPauses(
  samples: Float32Array,
  sampleRate: number,
  frameSize: number,
  silenceThreshold: number,
  minPauseDuration: number
): number[] {
  const pauses: number[] = [];
  const minPauseFrames = Math.ceil((minPauseDuration / 1000) * sampleRate / frameSize);
  
  let silentFrames = 0;
  let pauseStart = -1;
  
  for (let i = 0; i < samples.length; i += frameSize) {
    const frame = samples.slice(i, i + frameSize);
    const rms = calculateRMS(frame);
    
    if (rms < silenceThreshold) {
      if (pauseStart < 0) pauseStart = i;
      silentFrames++;
    } else {
      if (silentFrames >= minPauseFrames && pauseStart >= 0) {
        const pauseDuration = (silentFrames * frameSize / sampleRate) * 1000;
        pauses.push(pauseDuration);
      }
      silentFrames = 0;
      pauseStart = -1;
    }
  }
  
  // Check trailing pause
  if (silentFrames >= minPauseFrames && pauseStart >= 0) {
    const pauseDuration = (silentFrames * frameSize / sampleRate) * 1000;
    pauses.push(pauseDuration);
  }
  
  return pauses;
}

/**
 * Calculate jitter (pitch perturbation)
 */
function calculateJitter(pitchValues: number[]): number {
  if (pitchValues.length < 2) return 0;
  
  let sum = 0;
  for (let i = 1; i < pitchValues.length; i++) {
    sum += Math.abs(pitchValues[i] - pitchValues[i - 1]);
  }
  
  const meanPitch = pitchValues.reduce((a, b) => a + b, 0) / pitchValues.length;
  return meanPitch > 0 ? (sum / (pitchValues.length - 1)) / meanPitch : 0;
}

/**
 * Calculate shimmer (amplitude perturbation)
 */
function calculateShimmer(energyValues: number[]): number {
  if (energyValues.length < 2) return 0;
  
  let sum = 0;
  for (let i = 1; i < energyValues.length; i++) {
    sum += Math.abs(energyValues[i] - energyValues[i - 1]);
  }
  
  const meanEnergy = energyValues.reduce((a, b) => a + b, 0) / energyValues.length;
  return meanEnergy > 0 ? (sum / (energyValues.length - 1)) / meanEnergy : 0;
}

/**
 * Calculate mean and standard deviation
 */
function calculateStats(values: number[]): { mean: number; std: number; min: number; max: number } {
  if (values.length === 0) {
    return { mean: 0, std: 0, min: 0, max: 0 };
  }
  
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
  const std = Math.sqrt(variance);
  const min = Math.min(...values);
  const max = Math.max(...values);
  
  return { mean, std, min, max };
}

/**
 * Estimate linear slope (for pitch contour)
 */
function calculateSlope(values: number[]): number {
  if (values.length < 2) return 0;
  
  const n = values.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += values[i];
    sumXY += i * values[i];
    sumXX += i * i;
  }
  
  const denominator = n * sumXX - sumX * sumX;
  return denominator !== 0 ? (n * sumXY - sumX * sumY) / denominator : 0;
}

// =============================================================================
// Feature Extractor Class
// =============================================================================

/**
 * Extracts prosody features from audio buffers
 */
export class ProsodyFeatureExtractor extends EventEmitter {
  private config: ProsodyAnalyzerConfig;
  private silenceThreshold = 0.01; // RMS threshold for silence

  constructor(config: Partial<ProsodyAnalyzerConfig> = {}) {
    super();
    this.config = { ...DEFAULT_PROSODY_CONFIG, ...config };
    logger.info('ProsodyFeatureExtractor initialized', { config: this.config });
  }

  /**
   * Extract full prosody features from audio buffer
   */
  extractFeatures(audioBuffer: Buffer | Int16Array): ProsodyFeatures | null {
    const startTime = performance.now();
    
    // Convert to float samples
    let samples: Float32Array;
    if (Buffer.isBuffer(audioBuffer)) {
      const int16 = new Int16Array(
        audioBuffer.buffer,
        audioBuffer.byteOffset,
        audioBuffer.byteLength / 2
      );
      samples = int16ToFloat32(int16);
    } else {
      samples = int16ToFloat32(audioBuffer);
    }

    // Check minimum duration
    const durationMs = (samples.length / this.config.sampleRate) * 1000;
    if (durationMs < this.config.minDuration) {
      logger.debug('Audio too short for prosody analysis', { durationMs });
      return null;
    }

    // Extract frame-by-frame features
    const pitchValues: number[] = [];
    const energyValues: number[] = [];
    
    for (let i = 0; i < samples.length - this.config.frameSize; i += this.config.hopSize) {
      const frame = samples.slice(i, i + this.config.frameSize);
      
      // Pitch detection
      const pitch = detectPitch(
        frame,
        this.config.sampleRate,
        this.config.pitchRange.min,
        this.config.pitchRange.max
      );
      if (pitch !== null) {
        pitchValues.push(pitch);
      }
      
      // Energy calculation
      const rms = calculateRMS(frame);
      energyValues.push(rms);
    }

    // Calculate pitch statistics
    const pitchStats = calculateStats(pitchValues);
    const pitchSlope = calculateSlope(pitchValues);

    // Calculate energy statistics
    const energyStats = calculateStats(energyValues);

    // Detect pauses
    const pauses = detectPauses(
      samples,
      this.config.sampleRate,
      this.config.frameSize,
      this.silenceThreshold,
      this.config.pauseThreshold
    );
    const pauseStats = calculateStats(pauses);

    // Calculate voice quality metrics
    const jitter = calculateJitter(pitchValues);
    const shimmer = calculateShimmer(energyValues);

    // Estimate speaking rate (rough approximation based on energy changes)
    const energyChanges = energyValues.filter((e, i) => 
      i > 0 && Math.abs(e - energyValues[i - 1]) > 0.05
    ).length;
    const estimatedSyllables = energyChanges / 2; // Rough heuristic
    const syllablesPerSecond = estimatedSyllables / (durationMs / 1000);
    const wordsPerMinute = syllablesPerSecond * 60 / 1.5; // ~1.5 syllables per word

    const features: ProsodyFeatures = {
      pitch: {
        mean: pitchStats.mean,
        std: pitchStats.std,
        slope: pitchSlope,
        min: pitchStats.min,
        max: pitchStats.max,
        range: pitchStats.max - pitchStats.min,
      },
      pace: {
        wordsPerMinute: Math.max(0, Math.min(300, wordsPerMinute)), // Clamp to reasonable range
        syllablesPerSecond: Math.max(0, Math.min(8, syllablesPerSecond)),
        variability: 0, // Would need word timestamps for accurate calculation
      },
      volume: {
        mean: energyStats.mean,
        std: energyStats.std,
        peak: energyStats.max,
        dynamicRange: energyStats.mean > 0 ? energyStats.max / energyStats.mean : 0,
      },
      pauses: {
        count: pauses.length,
        totalDuration: pauses.reduce((a, b) => a + b, 0),
        meanDuration: pauseStats.mean,
        maxDuration: pauseStats.max,
        durations: pauses,
      },
      quality: {
        jitter,
        shimmer,
        hnr: 0, // Harmonic-to-noise ratio requires more complex analysis
      },
      timestamp: Date.now(),
      duration: durationMs,
    };

    const latency = performance.now() - startTime;
    logger.debug('Prosody features extracted', {
      durationMs,
      pitchMean: pitchStats.mean.toFixed(1),
      wordsPerMinute: wordsPerMinute.toFixed(0),
      pauseCount: pauses.length,
      latency: latency.toFixed(1),
    });

    this.emit('features', features, latency);
    return features;
  }

  /**
   * Extract simplified features for quick analysis
   */
  extractSimpleFeatures(audioBuffer: Buffer | Int16Array): SimpleProsodyFeatures | null {
    const features = this.extractFeatures(audioBuffer);
    if (!features) return null;

    const totalDuration = features.duration;
    const pauseRatio = totalDuration > 0 
      ? features.pauses.totalDuration / totalDuration 
      : 0;

    return {
      pitchMean: features.pitch.mean,
      pitchVariability: features.pitch.std / Math.max(features.pitch.mean, 1),
      pace: features.pace.wordsPerMinute,
      volume: features.volume.mean,
      pauseRatio,
      jitter: features.quality.jitter,
    };
  }

  /**
   * Analyze a stream of audio chunks
   * Accumulates audio and extracts features when enough is collected
   */
  private accumulatedAudio: Int16Array[] = [];
  private accumulatedLength = 0;
  private readonly minAccumulatedMs = 1000; // 1 second minimum

  processChunk(chunk: Buffer | Int16Array): ProsodyFeatures | null {
    // Convert to Int16Array
    let int16: Int16Array;
    if (Buffer.isBuffer(chunk)) {
      int16 = new Int16Array(chunk.buffer, chunk.byteOffset, chunk.byteLength / 2);
    } else {
      int16 = chunk;
    }

    // Accumulate
    this.accumulatedAudio.push(int16);
    this.accumulatedLength += int16.length;

    // Check if we have enough audio
    const durationMs = (this.accumulatedLength / this.config.sampleRate) * 1000;
    if (durationMs < this.minAccumulatedMs) {
      return null;
    }

    // Merge accumulated audio
    const merged = new Int16Array(this.accumulatedLength);
    let offset = 0;
    for (const arr of this.accumulatedAudio) {
      merged.set(arr, offset);
      offset += arr.length;
    }

    // Extract features
    const features = this.extractFeatures(merged);

    // Reset accumulator
    this.accumulatedAudio = [];
    this.accumulatedLength = 0;

    return features;
  }

  /**
   * Reset the chunk accumulator
   */
  resetAccumulator(): void {
    this.accumulatedAudio = [];
    this.accumulatedLength = 0;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<ProsodyAnalyzerConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('ProsodyFeatureExtractor config updated', { config: this.config });
  }

  /**
   * Get current configuration
   */
  getConfig(): ProsodyAnalyzerConfig {
    return { ...this.config };
  }
}

// =============================================================================
// Singleton
// =============================================================================

let instance: ProsodyFeatureExtractor | null = null;

/**
 * Get the prosody feature extractor singleton
 */
export function getProsodyFeatureExtractor(): ProsodyFeatureExtractor {
  if (!instance) {
    instance = new ProsodyFeatureExtractor();
  }
  return instance;
}

export default ProsodyFeatureExtractor;
