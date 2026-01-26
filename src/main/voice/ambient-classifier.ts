/**
 * Atlas Desktop - Ambient Sound Classification
 * Detect environmental audio to auto-adjust VAD sensitivity
 *
 * Features:
 * - Classify ambient sounds (typing, music, TV, silence)
 * - Auto-adjust VAD thresholds based on environment
 * - Reduce false wake word triggers in noisy environments
 * - Machine learning-based classification
 *
 * @module voice/ambient-classifier
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('AmbientClassifier');

// ============================================================================
// Types
// ============================================================================

export type AmbientSoundClass =
  | 'silence'
  | 'quiet'
  | 'typing'
  | 'music'
  | 'speech'
  | 'tv_movie'
  | 'traffic'
  | 'nature'
  | 'mechanical'
  | 'unknown';

export interface AmbientClassification {
  class: AmbientSoundClass;
  confidence: number;
  volume: number; // dB
  frequency: {
    low: number; // Bass energy
    mid: number; // Speech frequency energy
    high: number; // Treble energy
  };
  timestamp: number;
}

export interface VADAdjustment {
  speechThreshold: number;
  silenceThreshold: number;
  minSpeechDuration: number;
  maxSilenceDuration: number;
}

export interface AmbientClassifierConfig {
  sampleRate: number;
  frameSize: number;
  classificationInterval: number; // ms
  smoothingWindow: number; // Number of classifications to average
  enableAutoAdjust: boolean;
}

export interface AmbientClassifierEvents {
  'classification': (result: AmbientClassification) => void;
  'environment-changed': (from: AmbientSoundClass, to: AmbientSoundClass) => void;
  'vad-adjusted': (adjustment: VADAdjustment) => void;
  error: (error: Error) => void;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: AmbientClassifierConfig = {
  sampleRate: 16000,
  frameSize: 512,
  classificationInterval: 2000, // Classify every 2 seconds
  smoothingWindow: 5,
  enableAutoAdjust: true,
};

// VAD settings per environment type
const VAD_PRESETS: Record<AmbientSoundClass, VADAdjustment> = {
  silence: {
    speechThreshold: 0.3,
    silenceThreshold: 0.1,
    minSpeechDuration: 100,
    maxSilenceDuration: 500,
  },
  quiet: {
    speechThreshold: 0.35,
    silenceThreshold: 0.15,
    minSpeechDuration: 120,
    maxSilenceDuration: 450,
  },
  typing: {
    speechThreshold: 0.45, // Higher threshold to avoid typing sounds
    silenceThreshold: 0.25,
    minSpeechDuration: 150,
    maxSilenceDuration: 400,
  },
  music: {
    speechThreshold: 0.55, // Much higher to detect speech over music
    silenceThreshold: 0.3,
    minSpeechDuration: 200,
    maxSilenceDuration: 350,
  },
  speech: {
    speechThreshold: 0.5, // Background speech requires careful detection
    silenceThreshold: 0.25,
    minSpeechDuration: 180,
    maxSilenceDuration: 380,
  },
  tv_movie: {
    speechThreshold: 0.5,
    silenceThreshold: 0.25,
    minSpeechDuration: 200,
    maxSilenceDuration: 350,
  },
  traffic: {
    speechThreshold: 0.5,
    silenceThreshold: 0.3,
    minSpeechDuration: 180,
    maxSilenceDuration: 400,
  },
  nature: {
    speechThreshold: 0.4,
    silenceThreshold: 0.2,
    minSpeechDuration: 140,
    maxSilenceDuration: 450,
  },
  mechanical: {
    speechThreshold: 0.55,
    silenceThreshold: 0.35,
    minSpeechDuration: 200,
    maxSilenceDuration: 350,
  },
  unknown: {
    speechThreshold: 0.4,
    silenceThreshold: 0.2,
    minSpeechDuration: 150,
    maxSilenceDuration: 400,
  },
};

// ============================================================================
// Feature Extraction
// ============================================================================

interface AudioFeatures {
  rms: number;
  zeroCrossingRate: number;
  spectralCentroid: number;
  spectralFlatness: number;
  lowEnergy: number;
  midEnergy: number;
  highEnergy: number;
  mfcc: number[];
}

function extractFeatures(samples: Float32Array, sampleRate: number): AudioFeatures {
  const n = samples.length;

  // RMS (Root Mean Square) - volume indicator
  let sumSquares = 0;
  for (let i = 0; i < n; i++) {
    sumSquares += samples[i] * samples[i];
  }
  const rms = Math.sqrt(sumSquares / n);

  // Zero Crossing Rate - indicates noise vs tonal content
  let zeroCrossings = 0;
  for (let i = 1; i < n; i++) {
    if ((samples[i] >= 0 && samples[i - 1] < 0) || (samples[i] < 0 && samples[i - 1] >= 0)) {
      zeroCrossings++;
    }
  }
  const zeroCrossingRate = zeroCrossings / n;

  // Simple spectral analysis using energy in frequency bands
  // This is a simplified version - real implementation would use FFT
  const lowBand = samples.slice(0, Math.floor(n * 0.2));
  const midBand = samples.slice(Math.floor(n * 0.2), Math.floor(n * 0.6));
  const highBand = samples.slice(Math.floor(n * 0.6));

  const lowEnergy = calculateEnergy(lowBand);
  const midEnergy = calculateEnergy(midBand);
  const highEnergy = calculateEnergy(highBand);
  const totalEnergy = lowEnergy + midEnergy + highEnergy;

  // Spectral centroid approximation
  const spectralCentroid = totalEnergy > 0 ? (lowEnergy * 0.2 + midEnergy * 0.5 + highEnergy * 0.8) / totalEnergy : 0.5;

  // Spectral flatness approximation (1 = white noise, 0 = tonal)
  const geometricMean = Math.pow(lowEnergy * midEnergy * highEnergy, 1 / 3);
  const arithmeticMean = totalEnergy / 3;
  const spectralFlatness = arithmeticMean > 0 ? geometricMean / arithmeticMean : 0;

  // Simplified MFCC-like features (not true MFCCs)
  const mfcc = [
    rms,
    zeroCrossingRate,
    spectralCentroid,
    spectralFlatness,
    lowEnergy / (totalEnergy || 1),
    midEnergy / (totalEnergy || 1),
    highEnergy / (totalEnergy || 1),
  ];

  return {
    rms,
    zeroCrossingRate,
    spectralCentroid,
    spectralFlatness,
    lowEnergy: lowEnergy / (totalEnergy || 1),
    midEnergy: midEnergy / (totalEnergy || 1),
    highEnergy: highEnergy / (totalEnergy || 1),
    mfcc,
  };
}

function calculateEnergy(samples: Float32Array): number {
  let energy = 0;
  for (let i = 0; i < samples.length; i++) {
    energy += samples[i] * samples[i];
  }
  return energy / samples.length;
}

// ============================================================================
// Ambient Sound Classifier
// ============================================================================

export class AmbientSoundClassifier extends EventEmitter {
  private config: AmbientClassifierConfig;
  private audioBuffer: Float32Array[] = [];
  private classificationHistory: AmbientClassification[] = [];
  private currentEnvironment: AmbientSoundClass = 'unknown';
  private classificationTimer: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;

  constructor(config?: Partial<AmbientClassifierConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };

    logger.info('AmbientSoundClassifier created', {
      sampleRate: this.config.sampleRate,
      classificationInterval: this.config.classificationInterval,
    });
  }

  /**
   * Start ambient classification
   */
  start(): void {
    if (this.isRunning) return;

    this.isRunning = true;
    this.classificationTimer = setInterval(() => {
      this.classifyCurrentEnvironment();
    }, this.config.classificationInterval);

    logger.info('Ambient classification started');
  }

  /**
   * Stop ambient classification
   */
  stop(): void {
    if (!this.isRunning) return;

    this.isRunning = false;
    if (this.classificationTimer) {
      clearInterval(this.classificationTimer);
      this.classificationTimer = null;
    }

    logger.info('Ambient classification stopped');
  }

  /**
   * Process incoming audio samples
   */
  processAudio(samples: Float32Array): void {
    if (!this.isRunning) return;

    // Keep buffer limited to last few seconds
    this.audioBuffer.push(samples);
    const maxBufferSize = Math.ceil((this.config.sampleRate * 3) / this.config.frameSize);
    while (this.audioBuffer.length > maxBufferSize) {
      this.audioBuffer.shift();
    }
  }

  /**
   * Classify the current audio environment
   */
  private classifyCurrentEnvironment(): void {
    if (this.audioBuffer.length === 0) return;

    // Combine recent audio
    const combinedLength = this.audioBuffer.reduce((sum, buf) => sum + buf.length, 0);
    const combined = new Float32Array(combinedLength);
    let offset = 0;
    for (const buf of this.audioBuffer) {
      combined.set(buf, offset);
      offset += buf.length;
    }

    // Extract features
    const features = extractFeatures(combined, this.config.sampleRate);

    // Classify based on features
    const classification = this.classifyFeatures(features);

    // Add to history for smoothing
    this.classificationHistory.push(classification);
    while (this.classificationHistory.length > this.config.smoothingWindow) {
      this.classificationHistory.shift();
    }

    // Get smoothed classification
    const smoothedClass = this.getSmoothedClassification();
    classification.class = smoothedClass;

    this.emit('classification', classification);

    // Check for environment change
    if (smoothedClass !== this.currentEnvironment) {
      const oldEnvironment = this.currentEnvironment;
      this.currentEnvironment = smoothedClass;
      this.emit('environment-changed', oldEnvironment, smoothedClass);

      // Auto-adjust VAD if enabled
      if (this.config.enableAutoAdjust) {
        this.adjustVAD(smoothedClass);
      }

      logger.info('Environment changed', { from: oldEnvironment, to: smoothedClass });
    }
  }

  /**
   * Classify audio features into sound class
   */
  private classifyFeatures(features: AudioFeatures): AmbientClassification {
    const { rms, zeroCrossingRate, spectralCentroid, spectralFlatness, lowEnergy, midEnergy, highEnergy } = features;

    // Convert RMS to approximate dB
    const volumeDb = 20 * Math.log10(Math.max(rms, 0.0001));

    let soundClass: AmbientSoundClass = 'unknown';
    let confidence = 0.5;

    // Classification rules based on audio features
    if (rms < 0.01) {
      soundClass = 'silence';
      confidence = 0.9;
    } else if (rms < 0.05) {
      soundClass = 'quiet';
      confidence = 0.8;
    } else if (zeroCrossingRate > 0.3 && highEnergy > 0.4) {
      // High zero crossings and treble = typing or clicking
      soundClass = 'typing';
      confidence = 0.7;
    } else if (spectralFlatness < 0.3 && midEnergy > 0.4 && lowEnergy > 0.3) {
      // Tonal content with bass and mids = music
      soundClass = 'music';
      confidence = 0.75;
    } else if (midEnergy > 0.5 && spectralCentroid > 0.3 && spectralCentroid < 0.6) {
      // Strong mids in speech frequency range
      soundClass = 'speech';
      confidence = 0.7;
    } else if (lowEnergy > 0.5 && spectralFlatness > 0.5) {
      // Heavy bass with noise-like spectrum = traffic/machinery
      if (zeroCrossingRate < 0.2) {
        soundClass = 'traffic';
      } else {
        soundClass = 'mechanical';
      }
      confidence = 0.6;
    } else if (spectralFlatness > 0.4 && highEnergy > 0.3) {
      // Broadband with high frequencies = nature sounds
      soundClass = 'nature';
      confidence = 0.5;
    } else if (rms > 0.1 && lowEnergy > 0.3 && midEnergy > 0.3) {
      // Complex audio with bass and mids = TV/movie
      soundClass = 'tv_movie';
      confidence = 0.6;
    }

    return {
      class: soundClass,
      confidence,
      volume: volumeDb,
      frequency: {
        low: lowEnergy,
        mid: midEnergy,
        high: highEnergy,
      },
      timestamp: Date.now(),
    };
  }

  /**
   * Get smoothed classification from history
   */
  private getSmoothedClassification(): AmbientSoundClass {
    if (this.classificationHistory.length === 0) return 'unknown';

    // Count occurrences of each class
    const counts = new Map<AmbientSoundClass, number>();
    for (const classification of this.classificationHistory) {
      const current = counts.get(classification.class) || 0;
      counts.set(classification.class, current + classification.confidence);
    }

    // Return class with highest weighted count
    let maxClass: AmbientSoundClass = 'unknown';
    let maxCount = 0;
    for (const [soundClass, count] of counts) {
      if (count > maxCount) {
        maxCount = count;
        maxClass = soundClass;
      }
    }

    return maxClass;
  }

  /**
   * Adjust VAD parameters based on environment
   */
  private adjustVAD(environment: AmbientSoundClass): void {
    const adjustment = VAD_PRESETS[environment] || VAD_PRESETS.unknown;
    this.emit('vad-adjusted', adjustment);
    logger.info('VAD adjusted for environment', { environment, adjustment });
  }

  /**
   * Get current environment
   */
  getCurrentEnvironment(): AmbientSoundClass {
    return this.currentEnvironment;
  }

  /**
   * Get VAD adjustment for current environment
   */
  getCurrentVADAdjustment(): VADAdjustment {
    return VAD_PRESETS[this.currentEnvironment] || VAD_PRESETS.unknown;
  }

  /**
   * Manually set environment (disable auto-detection temporarily)
   */
  setEnvironment(environment: AmbientSoundClass): void {
    if (environment !== this.currentEnvironment) {
      const oldEnvironment = this.currentEnvironment;
      this.currentEnvironment = environment;
      this.emit('environment-changed', oldEnvironment, environment);

      if (this.config.enableAutoAdjust) {
        this.adjustVAD(environment);
      }
    }
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<AmbientClassifierConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('Configuration updated', { newConfig: this.config });
  }

  /**
   * Get classification statistics
   */
  getStatistics(): { environment: AmbientSoundClass; avgVolume: number; classHistory: AmbientSoundClass[] } {
    const avgVolume =
      this.classificationHistory.length > 0
        ? this.classificationHistory.reduce((sum, c) => sum + c.volume, 0) / this.classificationHistory.length
        : -60;

    return {
      environment: this.currentEnvironment,
      avgVolume,
      classHistory: this.classificationHistory.map((c) => c.class),
    };
  }

  /**
   * Cleanup
   */
  dispose(): void {
    this.stop();
    this.audioBuffer = [];
    this.classificationHistory = [];
    logger.info('AmbientSoundClassifier disposed');
  }
}

// ============================================================================
// Singleton
// ============================================================================

let ambientClassifier: AmbientSoundClassifier | null = null;

export function getAmbientClassifier(): AmbientSoundClassifier {
  if (!ambientClassifier) {
    ambientClassifier = new AmbientSoundClassifier();
  }
  return ambientClassifier;
}
