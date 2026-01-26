/**
 * Atlas Desktop - Acoustic Scene Classifier
 * Classify acoustic environment (office, home, outdoors, etc.)
 *
 * Features:
 * - Environment classification
 * - Noise level estimation
 * - Audio event detection
 * - Context-aware mode switching
 * - Background sound analysis
 *
 * @module ml/acoustic-scene-classifier
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('AcousticSceneClassifier');

// ============================================================================
// Types
// ============================================================================

export type AcousticScene =
  | 'office'
  | 'home'
  | 'outdoor'
  | 'cafe'
  | 'transit'
  | 'street'
  | 'quiet'
  | 'noisy'
  | 'unknown';

export interface SceneClassification {
  scene: AcousticScene;
  confidence: number;
  secondBest?: { scene: AcousticScene; confidence: number };
  noiseLevel: number; // dB
  audioEvents: AudioEvent[];
  timestamp: number;
}

export interface AudioEvent {
  type: string;
  confidence: number;
  timestamp: number;
  duration?: number;
}

export interface SceneFeatures {
  spectralCentroid: number;
  spectralRolloff: number;
  spectralFlux: number;
  zeroCrossingRate: number;
  energy: number;
  mfccs: number[];
  bandEnergies: number[];
}

export interface AcousticSceneConfig {
  frameSize: number; // ms
  hopSize: number; // ms
  numMels: number;
  numMfccs: number;
  classificationInterval: number; // ms
  smoothingWindow: number;
}

export interface AcousticSceneEvents {
  'scene-classified': (classification: SceneClassification) => void;
  'scene-changed': (from: AcousticScene, to: AcousticScene) => void;
  'audio-event': (event: AudioEvent) => void;
  'noise-level-changed': (level: number) => void;
  error: (error: Error) => void;
}

// ============================================================================
// Scene Profile Templates
// ============================================================================

const SCENE_PROFILES: Record<AcousticScene, Partial<SceneFeatures>> = {
  office: {
    spectralCentroid: 2000,
    zeroCrossingRate: 0.05,
    energy: 0.02,
  },
  home: {
    spectralCentroid: 1500,
    zeroCrossingRate: 0.03,
    energy: 0.01,
  },
  outdoor: {
    spectralCentroid: 3000,
    spectralRolloff: 4000,
    zeroCrossingRate: 0.1,
    energy: 0.05,
  },
  cafe: {
    spectralCentroid: 2500,
    zeroCrossingRate: 0.08,
    energy: 0.04,
  },
  transit: {
    spectralCentroid: 1000,
    spectralRolloff: 2000,
    energy: 0.08,
  },
  street: {
    spectralCentroid: 3500,
    spectralRolloff: 5000,
    zeroCrossingRate: 0.12,
    energy: 0.1,
  },
  quiet: {
    energy: 0.005,
    zeroCrossingRate: 0.01,
  },
  noisy: {
    energy: 0.15,
    zeroCrossingRate: 0.15,
  },
  unknown: {},
};

// ============================================================================
// Acoustic Scene Classifier
// ============================================================================

export class AcousticSceneClassifier extends EventEmitter {
  private config: AcousticSceneConfig;
  private currentScene: AcousticScene = 'unknown';
  private sceneHistory: SceneClassification[] = [];
  private lastNoiseLevel = 0;

  // Feature extraction
  private melFilterbank: number[][] = [];

  // Stats
  private stats = {
    classificationsCount: 0,
    sceneChanges: 0,
    audioEventsDetected: 0,
    avgNoiseLevel: 0,
  };

  constructor(config?: Partial<AcousticSceneConfig>) {
    super();
    this.config = {
      frameSize: 25,
      hopSize: 10,
      numMels: 40,
      numMfccs: 13,
      classificationInterval: 1000,
      smoothingWindow: 5,
      ...config,
    };

    this.initializeMelFilterbank();

    logger.info('AcousticSceneClassifier initialized', { config: this.config });
  }

  // ============================================================================
  // Initialization
  // ============================================================================

  private initializeMelFilterbank(): void {
    const numFilters = this.config.numMels;
    const fftSize = 512;
    const sampleRate = 16000;

    const melScale = (f: number) => 2595 * Math.log10(1 + f / 700);
    const invMelScale = (m: number) => 700 * (Math.pow(10, m / 2595) - 1);

    const minMel = melScale(0);
    const maxMel = melScale(sampleRate / 2);
    const melPoints: number[] = [];

    for (let i = 0; i <= numFilters + 1; i++) {
      melPoints.push(invMelScale(minMel + (i * (maxMel - minMel)) / (numFilters + 1)));
    }

    const fftBins = melPoints.map((f) => Math.floor((fftSize + 1) * f / sampleRate));

    this.melFilterbank = [];
    for (let i = 0; i < numFilters; i++) {
      const filter = new Array(fftSize / 2 + 1).fill(0);

      for (let j = fftBins[i]; j < fftBins[i + 1]; j++) {
        filter[j] = (j - fftBins[i]) / (fftBins[i + 1] - fftBins[i]);
      }
      for (let j = fftBins[i + 1]; j < fftBins[i + 2]; j++) {
        filter[j] = (fftBins[i + 2] - j) / (fftBins[i + 2] - fftBins[i + 1]);
      }

      this.melFilterbank.push(filter);
    }
  }

  // ============================================================================
  // Classification
  // ============================================================================

  /**
   * Classify acoustic scene from audio
   */
  classify(samples: Float32Array, sampleRate: number): SceneClassification {
    // Extract features
    const features = this.extractFeatures(samples, sampleRate);

    // Calculate noise level
    const noiseLevel = this.calculateNoiseLevel(samples);

    // Detect audio events
    const audioEvents = this.detectAudioEvents(samples, sampleRate);

    // Classify scene
    const scores = this.calculateSceneScores(features);

    // Get top scenes
    const sortedScenes = Object.entries(scores).sort(([, a], [, b]) => b - a) as [AcousticScene, number][];

    const topScene = sortedScenes[0];
    const secondScene = sortedScenes[1];

    const classification: SceneClassification = {
      scene: topScene[0],
      confidence: topScene[1],
      secondBest: secondScene ? { scene: secondScene[0], confidence: secondScene[1] } : undefined,
      noiseLevel,
      audioEvents,
      timestamp: Date.now(),
    };

    // Apply temporal smoothing
    const smoothedClassification = this.applySmoothing(classification);

    // Check for scene change
    if (smoothedClassification.scene !== this.currentScene) {
      const oldScene = this.currentScene;
      this.currentScene = smoothedClassification.scene;
      this.stats.sceneChanges++;
      this.emit('scene-changed', oldScene, this.currentScene);
      logger.info('Scene changed', { from: oldScene, to: this.currentScene });
    }

    // Check for noise level change
    if (Math.abs(noiseLevel - this.lastNoiseLevel) > 5) {
      this.lastNoiseLevel = noiseLevel;
      this.emit('noise-level-changed', noiseLevel);
    }

    // Update stats
    this.stats.classificationsCount++;
    this.stats.audioEventsDetected += audioEvents.length;
    this.stats.avgNoiseLevel =
      (this.stats.avgNoiseLevel * (this.stats.classificationsCount - 1) + noiseLevel) /
      this.stats.classificationsCount;

    // Emit events
    this.emit('scene-classified', smoothedClassification);
    for (const event of audioEvents) {
      this.emit('audio-event', event);
    }

    // Store in history
    this.sceneHistory.push(smoothedClassification);
    if (this.sceneHistory.length > 100) {
      this.sceneHistory.shift();
    }

    return smoothedClassification;
  }

  /**
   * Extract acoustic features
   */
  private extractFeatures(samples: Float32Array, sampleRate: number): SceneFeatures {
    const frameSize = Math.floor((this.config.frameSize / 1000) * sampleRate);
    const hopSize = Math.floor((this.config.hopSize / 1000) * sampleRate);
    const numFrames = Math.floor((samples.length - frameSize) / hopSize);

    if (numFrames < 1) {
      return this.getDefaultFeatures();
    }

    // Frame-level features
    let totalCentroid = 0;
    let totalRolloff = 0;
    let totalZCR = 0;
    let totalEnergy = 0;
    let prevSpectrum: number[] | null = null;
    let totalFlux = 0;
    const allMfccs: number[][] = [];
    const bandEnergies = new Array(8).fill(0);

    for (let i = 0; i < numFrames; i++) {
      const start = i * hopSize;
      const frame = samples.slice(start, start + frameSize);

      // Apply window
      const windowed = this.applyHammingWindow(frame);

      // Compute spectrum
      const spectrum = this.computeSpectrum(windowed);

      // Spectral centroid
      let centroid = 0;
      let totalMag = 0;
      for (let j = 0; j < spectrum.length; j++) {
        const freq = (j * sampleRate) / (2 * spectrum.length);
        centroid += freq * spectrum[j];
        totalMag += spectrum[j];
      }
      totalCentroid += totalMag > 0 ? centroid / totalMag : 0;

      // Spectral rolloff (85%)
      let cumSum = 0;
      let rolloff = 0;
      for (let j = 0; j < spectrum.length; j++) {
        cumSum += spectrum[j];
        if (cumSum >= 0.85 * totalMag) {
          rolloff = (j * sampleRate) / (2 * spectrum.length);
          break;
        }
      }
      totalRolloff += rolloff;

      // Spectral flux
      if (prevSpectrum) {
        let flux = 0;
        for (let j = 0; j < spectrum.length; j++) {
          const diff = spectrum[j] - prevSpectrum[j];
          if (diff > 0) flux += diff;
        }
        totalFlux += flux;
      }
      prevSpectrum = spectrum;

      // Zero crossing rate
      let zcr = 0;
      for (let j = 1; j < frame.length; j++) {
        if ((frame[j] >= 0 && frame[j - 1] < 0) || (frame[j] < 0 && frame[j - 1] >= 0)) {
          zcr++;
        }
      }
      totalZCR += zcr / frame.length;

      // Energy
      let energy = 0;
      for (let j = 0; j < frame.length; j++) {
        energy += frame[j] * frame[j];
      }
      totalEnergy += energy / frame.length;

      // MFCCs
      const mfccs = this.computeMFCCs(spectrum);
      allMfccs.push(mfccs);

      // Band energies
      const bandsPerBin = spectrum.length / 8;
      for (let b = 0; b < 8; b++) {
        let bandEnergy = 0;
        const startBin = Math.floor(b * bandsPerBin);
        const endBin = Math.floor((b + 1) * bandsPerBin);
        for (let j = startBin; j < endBin; j++) {
          bandEnergy += spectrum[j] * spectrum[j];
        }
        bandEnergies[b] += bandEnergy;
      }
    }

    // Average features
    const avgMfccs = new Array(this.config.numMfccs).fill(0);
    for (const mfcc of allMfccs) {
      for (let i = 0; i < mfcc.length; i++) {
        avgMfccs[i] += mfcc[i];
      }
    }
    for (let i = 0; i < avgMfccs.length; i++) {
      avgMfccs[i] /= numFrames;
    }

    return {
      spectralCentroid: totalCentroid / numFrames,
      spectralRolloff: totalRolloff / numFrames,
      spectralFlux: totalFlux / (numFrames - 1),
      zeroCrossingRate: totalZCR / numFrames,
      energy: totalEnergy / numFrames,
      mfccs: avgMfccs,
      bandEnergies: bandEnergies.map((e) => e / numFrames),
    };
  }

  /**
   * Get default features
   */
  private getDefaultFeatures(): SceneFeatures {
    return {
      spectralCentroid: 0,
      spectralRolloff: 0,
      spectralFlux: 0,
      zeroCrossingRate: 0,
      energy: 0,
      mfccs: new Array(this.config.numMfccs).fill(0),
      bandEnergies: new Array(8).fill(0),
    };
  }

  /**
   * Apply Hamming window
   */
  private applyHammingWindow(frame: Float32Array): Float32Array {
    const windowed = new Float32Array(frame.length);
    for (let i = 0; i < frame.length; i++) {
      const window = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (frame.length - 1));
      windowed[i] = frame[i] * window;
    }
    return windowed;
  }

  /**
   * Compute power spectrum
   */
  private computeSpectrum(frame: Float32Array): number[] {
    const n = 512;
    const padded = new Float32Array(n);
    for (let i = 0; i < Math.min(frame.length, n); i++) {
      padded[i] = frame[i];
    }

    const spectrum: number[] = [];
    for (let k = 0; k <= n / 2; k++) {
      let real = 0;
      let imag = 0;
      for (let t = 0; t < n; t++) {
        const angle = (2 * Math.PI * k * t) / n;
        real += padded[t] * Math.cos(angle);
        imag -= padded[t] * Math.sin(angle);
      }
      spectrum.push(Math.sqrt(real * real + imag * imag));
    }

    return spectrum;
  }

  /**
   * Compute MFCCs
   */
  private computeMFCCs(spectrum: number[]): number[] {
    // Apply mel filterbank
    const melEnergies: number[] = [];
    for (const filter of this.melFilterbank) {
      let energy = 0;
      for (let i = 0; i < Math.min(filter.length, spectrum.length); i++) {
        energy += filter[i] * spectrum[i];
      }
      melEnergies.push(Math.log(energy + 1e-10));
    }

    // DCT
    const mfccs: number[] = [];
    for (let i = 0; i < this.config.numMfccs; i++) {
      let coeff = 0;
      for (let j = 0; j < melEnergies.length; j++) {
        coeff += melEnergies[j] * Math.cos((Math.PI * i * (j + 0.5)) / melEnergies.length);
      }
      mfccs.push(coeff);
    }

    return mfccs;
  }

  /**
   * Calculate scene scores
   */
  private calculateSceneScores(features: SceneFeatures): Record<AcousticScene, number> {
    const scores: Record<AcousticScene, number> = {
      office: 0,
      home: 0,
      outdoor: 0,
      cafe: 0,
      transit: 0,
      street: 0,
      quiet: 0,
      noisy: 0,
      unknown: 0.1, // Baseline
    };

    for (const [scene, profile] of Object.entries(SCENE_PROFILES) as [AcousticScene, Partial<SceneFeatures>][]) {
      let score = 0;
      let count = 0;

      if (profile.spectralCentroid !== undefined) {
        const diff = Math.abs(features.spectralCentroid - profile.spectralCentroid) / profile.spectralCentroid;
        score += Math.exp(-diff * 2);
        count++;
      }

      if (profile.spectralRolloff !== undefined) {
        const diff = Math.abs(features.spectralRolloff - profile.spectralRolloff) / profile.spectralRolloff;
        score += Math.exp(-diff * 2);
        count++;
      }

      if (profile.zeroCrossingRate !== undefined) {
        const diff = Math.abs(features.zeroCrossingRate - profile.zeroCrossingRate) / profile.zeroCrossingRate;
        score += Math.exp(-diff * 2);
        count++;
      }

      if (profile.energy !== undefined) {
        const diff = Math.abs(features.energy - profile.energy) / profile.energy;
        score += Math.exp(-diff * 2);
        count++;
      }

      if (count > 0) {
        scores[scene] = score / count;
      }
    }

    // Normalize
    const total = Object.values(scores).reduce((a, b) => a + b, 0);
    for (const scene of Object.keys(scores) as AcousticScene[]) {
      scores[scene] /= total;
    }

    return scores;
  }

  /**
   * Apply temporal smoothing
   */
  private applySmoothing(classification: SceneClassification): SceneClassification {
    if (this.sceneHistory.length < this.config.smoothingWindow) {
      return classification;
    }

    // Count recent scene votes
    const recentScenes = this.sceneHistory.slice(-this.config.smoothingWindow);
    const sceneCounts = new Map<AcousticScene, number>();

    for (const c of recentScenes) {
      sceneCounts.set(c.scene, (sceneCounts.get(c.scene) || 0) + 1);
    }

    // Get majority scene
    let majorityScene = classification.scene;
    let maxCount = 0;

    for (const [scene, count] of sceneCounts) {
      if (count > maxCount) {
        maxCount = count;
        majorityScene = scene;
      }
    }

    // Use majority if different and count is high enough
    if (majorityScene !== classification.scene && maxCount >= this.config.smoothingWindow * 0.6) {
      return {
        ...classification,
        scene: majorityScene,
        confidence: maxCount / this.config.smoothingWindow,
      };
    }

    return classification;
  }

  /**
   * Calculate noise level in dB
   */
  private calculateNoiseLevel(samples: Float32Array): number {
    let rms = 0;
    for (let i = 0; i < samples.length; i++) {
      rms += samples[i] * samples[i];
    }
    rms = Math.sqrt(rms / samples.length);

    // Convert to dB (reference: 1.0)
    const db = 20 * Math.log10(rms + 1e-10);

    // Map to typical range (0-100)
    const normalized = Math.max(0, Math.min(100, db + 60));

    return normalized;
  }

  /**
   * Detect audio events
   */
  private detectAudioEvents(samples: Float32Array, sampleRate: number): AudioEvent[] {
    const events: AudioEvent[] = [];
    const frameSize = Math.floor(0.1 * sampleRate); // 100ms frames
    const numFrames = Math.floor(samples.length / frameSize);

    for (let i = 0; i < numFrames; i++) {
      const start = i * frameSize;
      const frame = samples.slice(start, start + frameSize);

      // Calculate frame energy
      let energy = 0;
      for (let j = 0; j < frame.length; j++) {
        energy += frame[j] * frame[j];
      }
      energy = Math.sqrt(energy / frame.length);

      // Detect sudden increases (potential events)
      if (i > 0) {
        const prevStart = (i - 1) * frameSize;
        const prevFrame = samples.slice(prevStart, prevStart + frameSize);
        let prevEnergy = 0;
        for (let j = 0; j < prevFrame.length; j++) {
          prevEnergy += prevFrame[j] * prevFrame[j];
        }
        prevEnergy = Math.sqrt(prevEnergy / prevFrame.length);

        if (energy > prevEnergy * 3 && energy > 0.05) {
          // Classify event type based on characteristics
          const zcr = this.calculateZCR(frame);
          const eventType = this.classifyEvent(energy, zcr);

          events.push({
            type: eventType,
            confidence: Math.min(energy / 0.1, 1),
            timestamp: Date.now(),
            duration: 100,
          });
        }
      }
    }

    return events;
  }

  /**
   * Calculate zero crossing rate
   */
  private calculateZCR(frame: Float32Array): number {
    let zcr = 0;
    for (let i = 1; i < frame.length; i++) {
      if ((frame[i] >= 0 && frame[i - 1] < 0) || (frame[i] < 0 && frame[i - 1] >= 0)) {
        zcr++;
      }
    }
    return zcr / frame.length;
  }

  /**
   * Classify event type
   */
  private classifyEvent(energy: number, zcr: number): string {
    if (zcr > 0.2) {
      return 'noise_burst';
    } else if (energy > 0.2) {
      return 'impact';
    } else if (zcr > 0.1) {
      return 'voice';
    } else {
      return 'ambient_change';
    }
  }

  // ============================================================================
  // Utilities
  // ============================================================================

  /**
   * Get current scene
   */
  getCurrentScene(): AcousticScene {
    return this.currentScene;
  }

  /**
   * Get scene history
   */
  getSceneHistory(limit = 50): SceneClassification[] {
    return this.sceneHistory.slice(-limit);
  }

  /**
   * Get statistics
   */
  getStats(): {
    classificationsCount: number;
    sceneChanges: number;
    audioEventsDetected: number;
    avgNoiseLevel: number;
    currentScene: AcousticScene;
  } {
    return {
      ...this.stats,
      currentScene: this.currentScene,
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<AcousticSceneConfig>): void {
    this.config = { ...this.config, ...config };
    this.initializeMelFilterbank();
    logger.info('Config updated', { config: this.config });
  }
}

// ============================================================================
// Singleton
// ============================================================================

let acousticSceneClassifier: AcousticSceneClassifier | null = null;

export function getAcousticSceneClassifier(): AcousticSceneClassifier {
  if (!acousticSceneClassifier) {
    acousticSceneClassifier = new AcousticSceneClassifier();
  }
  return acousticSceneClassifier;
}
