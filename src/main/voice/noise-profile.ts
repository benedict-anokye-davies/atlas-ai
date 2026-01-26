/**
 * Atlas Adaptive Noise Profile Learning System
 *
 * Provides intelligent noise profiling for improved STT accuracy:
 * - Samples ambient noise during initialization
 * - Builds comprehensive noise profile from environment
 * - Adaptive noise reduction based on learned profile
 * - Re-learns profile on significant environmental changes
 * - Multiple named profiles (office, home, cafe, etc.)
 * - Voice command: "Learn this environment"
 * - Real-time noise level indicator support
 *
 * The noise profile includes:
 * - RMS noise floor estimation
 * - Spectral characteristics (frequency distribution)
 * - Temporal variance (stability of noise)
 * - Peak noise levels
 * - SNR estimation for speech detection
 */

import { EventEmitter } from 'events';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createModuleLogger } from '../utils/logger';
import {
  NoiseProfile,
  NoiseEnvironmentType,
  NOISE_ENVIRONMENT_THRESHOLDS,
} from '../../shared/types/voice';

const logger = createModuleLogger('NoiseProfile');

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Named noise profile for specific environments
 */
export interface NamedNoiseProfile extends NoiseProfile {
  /** Unique identifier for the profile */
  id: string;
  /** User-friendly name (e.g., "Office", "Home", "Coffee Shop") */
  name: string;
  /** Optional description */
  description?: string;
  /** Whether this is the default profile */
  isDefault: boolean;
  /** Number of times this profile has been used */
  usageCount: number;
  /** Last time this profile was used */
  lastUsed: number;
  /** Auto-detected location hint (if available) */
  locationHint?: string;
}

/**
 * Noise profile storage format
 */
export interface NoiseProfileStorage {
  version: number;
  activeProfileId: string | null;
  profiles: NamedNoiseProfile[];
  lastUpdated: number;
}

/**
 * Configuration for noise profiling
 */
export interface NoiseProfilingConfig {
  /** Duration for initial noise sampling (ms) */
  samplingDuration: number;
  /** Minimum samples required for valid profile */
  minSamples: number;
  /** Maximum samples to collect */
  maxSamples: number;
  /** Interval between profile updates during continuous learning (ms) */
  updateInterval: number;
  /** Threshold for detecting significant environment change (0-1) */
  changeThreshold: number;
  /** Enable automatic environment change detection */
  autoDetectChange: boolean;
  /** Enable spectral analysis for better profiling */
  enableSpectralAnalysis: boolean;
  /** FFT size for spectral analysis (power of 2) */
  fftSize: number;
  /** Number of frequency bands for analysis */
  frequencyBands: number;
  /** Smoothing factor for noise floor estimation (0-1) */
  smoothingFactor: number;
  /** Enable persistent storage of profiles */
  enableStorage: boolean;
  /** Storage path for profiles */
  storagePath: string;
}

/**
 * Default noise profiling configuration
 */
export const DEFAULT_NOISE_PROFILING_CONFIG: NoiseProfilingConfig = {
  samplingDuration: 3000, // 3 seconds for initial profiling
  minSamples: 50, // Minimum 50 frames (~1.6 seconds at 32ms frames)
  maxSamples: 300, // Maximum 300 frames (~10 seconds)
  updateInterval: 60000, // Update profile every 60 seconds
  changeThreshold: 0.3, // 30% change triggers re-learning
  autoDetectChange: true,
  enableSpectralAnalysis: true,
  fftSize: 512,
  frequencyBands: 8,
  smoothingFactor: 0.95,
  enableStorage: true,
  storagePath: join(homedir(), '.atlas', 'noise-profiles.json'),
};

/**
 * Real-time noise analysis result
 */
export interface NoiseAnalysisResult {
  /** Current RMS level (0-1) */
  level: number;
  /** Level in decibels */
  levelDb: number;
  /** Is current level above typical speech threshold */
  isLoud: boolean;
  /** Is environment stable (low variance) */
  isStable: boolean;
  /** Estimated environment type */
  environmentType: NoiseEnvironmentType;
  /** Confidence in environment classification (0-1) */
  confidence: number;
  /** Deviation from current profile (0-1, 0 = matches perfectly) */
  profileDeviation: number;
  /** Spectral characteristics */
  spectrum: SpectralAnalysis;
  /** Timestamp */
  timestamp: number;
}

/**
 * Spectral analysis result
 */
export interface SpectralAnalysis {
  /** Energy in each frequency band (0-1) */
  bands: number[];
  /** Dominant frequency band index */
  dominantBand: number;
  /** Spectral centroid (weighted average frequency) */
  centroid: number;
  /** Spectral spread (bandwidth) */
  spread: number;
  /** Spectral flatness (0 = tonal, 1 = noise-like) */
  flatness: number;
}

/**
 * Noise level indicator data for UI
 */
export interface NoiseLevelIndicator {
  /** Current noise level (0-1) */
  level: number;
  /** Level in decibels (-60 to 0) */
  levelDb: number;
  /** Peak level in recent history (0-1) */
  peak: number;
  /** Average level (0-1) */
  average: number;
  /** Noise floor from profile (0-1) */
  noiseFloor: number;
  /** Current SNR estimate in dB */
  snrDb: number;
  /** Environment quality indicator (0-1, 1 = ideal for speech) */
  quality: number;
  /** Status message for UI */
  status: 'excellent' | 'good' | 'fair' | 'poor' | 'learning';
  /** Timestamp */
  timestamp: number;
}

/**
 * Events emitted by NoiseProfileManager
 */
export interface NoiseProfileManagerEvents {
  /** Profiling started */
  'profiling-start': () => void;
  /** Profiling progress update */
  'profiling-progress': (progress: number) => void;
  /** Profiling completed */
  'profiling-complete': (profile: NamedNoiseProfile) => void;
  /** Profile switched */
  'profile-switch': (profile: NamedNoiseProfile) => void;
  /** Environment change detected */
  'environment-change': (from: NoiseEnvironmentType, to: NoiseEnvironmentType) => void;
  /** Noise level update (throttled for UI) */
  'noise-level': (indicator: NoiseLevelIndicator) => void;
  /** Analysis result (real-time) */
  analysis: (result: NoiseAnalysisResult) => void;
  /** Profile saved */
  'profile-saved': (profile: NamedNoiseProfile) => void;
  /** Error occurred */
  error: (error: Error) => void;
}

// ============================================================================
// Noise Profile Manager
// ============================================================================

/**
 * NoiseProfileManager - Central manager for noise profiling
 *
 * Handles all aspects of noise profile learning and management:
 * - Initial environment sampling
 * - Continuous noise monitoring
 * - Profile storage and retrieval
 * - Environment change detection
 * - Adaptive threshold calculation
 */
export class NoiseProfileManager extends EventEmitter {
  private config: NoiseProfilingConfig;
  private isInitialized: boolean = false;
  private isLearning: boolean = false;
  private activeProfile: NamedNoiseProfile | null = null;
  private profiles: Map<string, NamedNoiseProfile> = new Map();

  // Learning state
  private learningSamples: Float32Array[] = [];
  private learningStartTime: number = 0;
  private learningTargetName: string = '';

  // Real-time analysis state
  private recentLevels: number[] = [];
  private recentSpectra: SpectralAnalysis[] = [];
  private peakLevel: number = 0;
  private peakDecayRate: number = 0.98;
  private lastAnalysisTime: number = 0;
  private analysisInterval: number = 50; // 50ms between analysis updates

  // Noise level indicator state (throttled for UI)
  private lastIndicatorTime: number = 0;
  private indicatorInterval: number = 100; // 100ms between UI updates

  // Environment change detection
  private environmentHistory: NoiseEnvironmentType[] = [];
  private lastEnvironmentChangeTime: number = 0;
  private environmentChangeDebounce: number = 5000; // 5 second debounce

  // Update interval
  private updateIntervalId: NodeJS.Timeout | null = null;

  constructor(config?: Partial<NoiseProfilingConfig>) {
    super();
    this.config = { ...DEFAULT_NOISE_PROFILING_CONFIG, ...config };

    logger.info('NoiseProfileManager created', {
      samplingDuration: this.config.samplingDuration,
      enableSpectralAnalysis: this.config.enableSpectralAnalysis,
      enableStorage: this.config.enableStorage,
    });
  }

  /**
   * Initialize the noise profile manager
   * Loads stored profiles and prepares for operation
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      logger.warn('NoiseProfileManager already initialized');
      return;
    }

    try {
      // Load stored profiles if enabled
      if (this.config.enableStorage) {
        await this.loadProfiles();
      }

      // Create default profile if none exist
      if (this.profiles.size === 0) {
        const defaultProfile = this.createDefaultProfile();
        this.profiles.set(defaultProfile.id, defaultProfile);
        this.activeProfile = defaultProfile;
        logger.info('Created default noise profile');
      } else {
        // Find and set active profile
        const stored = this.getStorageData();
        if (stored?.activeProfileId) {
          this.activeProfile = this.profiles.get(stored.activeProfileId) || null;
        }
        if (!this.activeProfile) {
          // Use first default or first available
          for (const profile of this.profiles.values()) {
            if (profile.isDefault) {
              this.activeProfile = profile;
              break;
            }
          }
          if (!this.activeProfile) {
            this.activeProfile = this.profiles.values().next().value || null;
          }
        }
      }

      this.isInitialized = true;
      logger.info('NoiseProfileManager initialized', {
        profileCount: this.profiles.size,
        activeProfile: this.activeProfile?.name,
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('Failed to initialize NoiseProfileManager', { error: err.message });
      this.emit('error', err);
      throw err;
    }
  }

  /**
   * Start continuous noise monitoring
   */
  startMonitoring(): void {
    if (this.updateIntervalId) {
      return;
    }

    this.updateIntervalId = setInterval(() => {
      // Periodic profile update check
      if (this.config.autoDetectChange && this.activeProfile && !this.isLearning) {
        this.checkEnvironmentChange();
      }
    }, this.config.updateInterval);

    logger.info('Noise monitoring started');
  }

  /**
   * Stop continuous noise monitoring
   */
  stopMonitoring(): void {
    if (this.updateIntervalId) {
      clearInterval(this.updateIntervalId);
      this.updateIntervalId = null;
    }

    logger.info('Noise monitoring stopped');
  }

  /**
   * Start learning a new noise profile
   * @param name Name for the new profile
   * @param description Optional description
   */
  startLearning(name?: string, description?: string): void {
    if (this.isLearning) {
      logger.warn('Already learning noise profile');
      return;
    }

    this.isLearning = true;
    this.learningSamples = [];
    this.learningStartTime = Date.now();
    this.learningTargetName = name || this.generateProfileName();

    logger.info('Started noise profile learning', {
      name: this.learningTargetName,
      duration: this.config.samplingDuration,
    });

    this.emit('profiling-start');

    // Set timeout to complete learning
    setTimeout(() => {
      if (this.isLearning) {
        this.completeLearning(description);
      }
    }, this.config.samplingDuration);
  }

  /**
   * Process an audio frame for noise analysis
   * Call this continuously with audio data
   * @param audio Float32Array of audio samples (16kHz mono)
   */
  processAudioFrame(audio: Float32Array): void {
    const now = Date.now();

    // Collect samples if learning
    if (this.isLearning) {
      this.collectLearningSample(audio);
    }

    // Perform real-time analysis
    if (now - this.lastAnalysisTime >= this.analysisInterval) {
      const analysis = this.analyzeAudioFrame(audio);
      this.emit('analysis', analysis);
      this.lastAnalysisTime = now;

      // Update noise level indicator (throttled)
      if (now - this.lastIndicatorTime >= this.indicatorInterval) {
        const indicator = this.calculateNoiseLevelIndicator(analysis);
        this.emit('noise-level', indicator);
        this.lastIndicatorTime = now;
      }
    }
  }

  /**
   * Manually trigger environment re-learning
   * Voice command handler for "Learn this environment"
   */
  learnCurrentEnvironment(): void {
    const name = this.suggestEnvironmentName();
    logger.info('Voice command: Learn this environment', { suggestedName: name });
    this.startLearning(name, 'Learned via voice command');
  }

  /**
   * Get the current active profile
   */
  getActiveProfile(): NamedNoiseProfile | null {
    return this.activeProfile;
  }

  /**
   * Get all saved profiles
   */
  getAllProfiles(): NamedNoiseProfile[] {
    return Array.from(this.profiles.values());
  }

  /**
   * Switch to a different profile by ID
   */
  switchProfile(profileId: string): boolean {
    const profile = this.profiles.get(profileId);
    if (!profile) {
      logger.warn('Profile not found', { profileId });
      return false;
    }

    const previousProfile = this.activeProfile;
    this.activeProfile = profile;
    profile.usageCount++;
    profile.lastUsed = Date.now();

    // Save updated profile
    if (this.config.enableStorage) {
      this.saveProfiles();
    }

    logger.info('Switched noise profile', {
      from: previousProfile?.name,
      to: profile.name,
    });

    this.emit('profile-switch', profile);
    return true;
  }

  /**
   * Delete a profile by ID
   */
  deleteProfile(profileId: string): boolean {
    const profile = this.profiles.get(profileId);
    if (!profile) {
      return false;
    }

    if (profile.isDefault && this.profiles.size === 1) {
      logger.warn('Cannot delete the only default profile');
      return false;
    }

    this.profiles.delete(profileId);

    // If deleted active profile, switch to another
    if (this.activeProfile?.id === profileId) {
      for (const p of this.profiles.values()) {
        this.activeProfile = p;
        break;
      }
    }

    if (this.config.enableStorage) {
      this.saveProfiles();
    }

    logger.info('Deleted noise profile', { name: profile.name });
    return true;
  }

  /**
   * Rename a profile
   */
  renameProfile(profileId: string, newName: string): boolean {
    const profile = this.profiles.get(profileId);
    if (!profile) {
      return false;
    }

    profile.name = newName;

    if (this.config.enableStorage) {
      this.saveProfiles();
    }

    logger.info('Renamed noise profile', { id: profileId, newName });
    return true;
  }

  /**
   * Get the current noise level indicator
   */
  getCurrentNoiseLevel(): NoiseLevelIndicator {
    const avgLevel =
      this.recentLevels.length > 0
        ? this.recentLevels.reduce((a, b) => a + b, 0) / this.recentLevels.length
        : 0;

    const noiseFloor = this.activeProfile?.noiseFloor || 0.02;
    const typicalSpeechLevel = 0.3;
    const snrDb = avgLevel > 0 ? 20 * Math.log10(typicalSpeechLevel / avgLevel) : 30;

    return {
      level: avgLevel,
      levelDb: this.linearToDb(avgLevel),
      peak: this.peakLevel,
      average: avgLevel,
      noiseFloor,
      snrDb,
      quality: this.calculateEnvironmentQuality(avgLevel, noiseFloor),
      status: this.isLearning ? 'learning' : this.getQualityStatus(snrDb),
      timestamp: Date.now(),
    };
  }

  /**
   * Calculate optimal VAD threshold based on noise profile
   */
  calculateOptimalVADThreshold(): number {
    if (!this.activeProfile) {
      return 0.5; // Default balanced threshold
    }

    const { noiseFloor, estimatedSNR, environmentType } = this.activeProfile;

    // Base threshold from environment type
    let baseThreshold: number;
    switch (environmentType) {
      case 'quiet':
        baseThreshold = 0.35;
        break;
      case 'normal':
        baseThreshold = 0.5;
        break;
      case 'noisy':
        baseThreshold = 0.65;
        break;
      case 'very_noisy':
        baseThreshold = 0.75;
        break;
      default:
        baseThreshold = 0.5;
    }

    // Adjust based on noise floor
    const noiseAdjustment = Math.min(0.2, noiseFloor * 2);

    // Adjust based on SNR
    const snrAdjustment = estimatedSNR < 10 ? 0.1 : estimatedSNR < 15 ? 0.05 : 0;

    const finalThreshold = Math.min(
      0.85,
      Math.max(0.2, baseThreshold + noiseAdjustment + snrAdjustment)
    );

    logger.debug('Calculated optimal VAD threshold', {
      baseThreshold,
      noiseAdjustment,
      snrAdjustment,
      finalThreshold,
    });

    return finalThreshold;
  }

  /**
   * Calculate optimal noise gate threshold based on profile
   */
  calculateOptimalNoiseGateThreshold(): number {
    if (!this.activeProfile) {
      return -40; // Default -40dB
    }

    const noiseFloorDb = this.linearToDb(this.activeProfile.noiseFloor);
    // Set gate 6dB above noise floor
    return Math.max(-60, Math.min(-20, noiseFloorDb + 6));
  }

  /**
   * Get noise reduction strength based on profile
   */
  calculateNoiseReductionStrength(): number {
    if (!this.activeProfile) {
      return 0.5; // Default medium strength
    }

    switch (this.activeProfile.environmentType) {
      case 'quiet':
        return 0.2; // Light reduction
      case 'normal':
        return 0.4;
      case 'noisy':
        return 0.6;
      case 'very_noisy':
        return 0.8; // Heavy reduction
      default:
        return 0.5;
    }
  }

  /**
   * Check if the current environment has significantly changed
   */
  isEnvironmentChanged(): boolean {
    if (!this.activeProfile || this.recentLevels.length < 10) {
      return false;
    }

    const currentAvg =
      this.recentLevels.slice(-20).reduce((a, b) => a + b, 0) /
      Math.min(20, this.recentLevels.length);

    const profileNoiseFloor = this.activeProfile.noiseFloor;
    const deviation = Math.abs(currentAvg - profileNoiseFloor) / profileNoiseFloor;

    return deviation > this.config.changeThreshold;
  }

  /**
   * Get learning progress (0-1)
   */
  getLearningProgress(): number {
    if (!this.isLearning) {
      return 0;
    }

    const elapsed = Date.now() - this.learningStartTime;
    return Math.min(1, elapsed / this.config.samplingDuration);
  }

  /**
   * Check if currently learning
   */
  get learning(): boolean {
    return this.isLearning;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<NoiseProfilingConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('NoiseProfilingConfig updated', config);
  }

  /**
   * Get current configuration
   */
  getConfig(): NoiseProfilingConfig {
    return { ...this.config };
  }

  /**
   * Shutdown the manager
   */
  async shutdown(): Promise<void> {
    this.stopMonitoring();

    if (this.config.enableStorage) {
      await this.saveProfiles();
    }

    this.isLearning = false;
    this.isInitialized = false;
    
    // Clean up event listeners to prevent memory leaks
    this.removeAllListeners();

    logger.info('NoiseProfileManager shutdown');
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Collect a sample during learning phase
   */
  private collectLearningSample(audio: Float32Array): void {
    if (!this.isLearning) return;

    // Only collect during silence (low energy frames)
    const rms = this.calculateRMS(audio);
    const rmsDb = this.linearToDb(rms);

    // Skip frames that might contain speech (above -30dB)
    if (rmsDb > -30) {
      return;
    }

    if (this.learningSamples.length < this.config.maxSamples) {
      this.learningSamples.push(new Float32Array(audio));
    }

    // Emit progress
    const progress = this.getLearningProgress();
    this.emit('profiling-progress', progress);
  }

  /**
   * Complete the learning phase and create profile
   */
  private completeLearning(description?: string): void {
    if (!this.isLearning) return;

    this.isLearning = false;

    if (this.learningSamples.length < this.config.minSamples) {
      logger.warn('Insufficient samples for noise profile', {
        collected: this.learningSamples.length,
        required: this.config.minSamples,
      });

      // Create profile with limited data anyway
      if (this.learningSamples.length > 10) {
        // At least some data
        this.createProfileFromSamples(description);
      } else {
        this.emit('error', new Error('Insufficient audio samples for noise profile'));
      }
      return;
    }

    this.createProfileFromSamples(description);
  }

  /**
   * Create a profile from collected samples
   */
  private createProfileFromSamples(description?: string): void {
    const samples = this.learningSamples;

    // Calculate RMS values
    const rmsValues = samples.map((s) => this.calculateRMS(s));
    const noiseFloor = this.calculateMean(rmsValues);
    const peakNoiseLevel = Math.max(...rmsValues);
    const noiseStdDev = this.calculateStdDev(rmsValues);

    // Calculate spectral profile
    let spectralProfile = {
      lowFreqEnergy: 0.4,
      midFreqEnergy: 0.35,
      highFreqEnergy: 0.25,
    };

    if (this.config.enableSpectralAnalysis) {
      spectralProfile = this.calculateAverageSpectralProfile(samples);
    }

    // Estimate SNR
    const typicalSpeechLevel = 0.3;
    const estimatedSNR = noiseFloor > 0 ? 20 * Math.log10(typicalSpeechLevel / noiseFloor) : 30;

    // Classify environment
    const environmentType = this.classifyEnvironment(noiseFloor, peakNoiseLevel);

    // Create the profile
    const profile: NamedNoiseProfile = {
      id: this.generateProfileId(),
      name: this.learningTargetName,
      description,
      isDefault: this.profiles.size === 0,
      usageCount: 0,
      lastUsed: Date.now(),
      noiseFloor,
      peakNoiseLevel,
      noiseStdDev,
      estimatedSNR,
      spectralProfile,
      createdAt: Date.now(),
      profilingDuration: Date.now() - this.learningStartTime,
      sampleCount: samples.length,
      isValid: true,
      environmentType,
    };

    // Store and activate profile
    this.profiles.set(profile.id, profile);
    this.activeProfile = profile;

    // Save to storage
    if (this.config.enableStorage) {
      this.saveProfiles();
    }

    logger.info('Noise profile created', {
      name: profile.name,
      noiseFloor: noiseFloor.toFixed(4),
      estimatedSNR: estimatedSNR.toFixed(1),
      environmentType,
      samples: samples.length,
    });

    this.emit('profiling-complete', profile);
    this.emit('profile-saved', profile);
  }

  /**
   * Analyze a single audio frame
   */
  private analyzeAudioFrame(audio: Float32Array): NoiseAnalysisResult {
    const level = this.calculateRMS(audio);
    const levelDb = this.linearToDb(level);

    // Update recent levels history
    this.recentLevels.push(level);
    if (this.recentLevels.length > 100) {
      this.recentLevels.shift();
    }

    // Update peak with decay
    this.peakLevel = Math.max(level, this.peakLevel * this.peakDecayRate);

    // Calculate variance for stability
    const variance =
      this.recentLevels.length > 10 ? this.calculateStdDev(this.recentLevels.slice(-20)) : 0;

    const isStable = variance < 0.02;

    // Spectral analysis
    const spectrum = this.analyzeSpectrum(audio);
    this.recentSpectra.push(spectrum);
    if (this.recentSpectra.length > 20) {
      this.recentSpectra.shift();
    }

    // Environment classification
    const environmentType = this.classifyEnvironment(level, this.peakLevel);

    // Calculate profile deviation
    let profileDeviation = 0;
    if (this.activeProfile) {
      profileDeviation =
        Math.abs(level - this.activeProfile.noiseFloor) / (this.activeProfile.noiseFloor || 0.01);
    }

    // Calculate confidence
    const confidence = isStable ? Math.min(1, this.recentLevels.length / 50) : 0.5;

    return {
      level,
      levelDb,
      isLoud: levelDb > -20,
      isStable,
      environmentType,
      confidence,
      profileDeviation: Math.min(1, profileDeviation),
      spectrum,
      timestamp: Date.now(),
    };
  }

  /**
   * Analyze frequency spectrum of audio
   */
  private analyzeSpectrum(audio: Float32Array): SpectralAnalysis {
    // Simple spectral analysis without FFT
    // Uses zero-crossing rate and energy distribution as proxies

    let lowEnergy = 0;
    let midEnergy = 0;
    let highEnergy = 0;
    let zeroCrossings = 0;

    for (let i = 1; i < audio.length; i++) {
      const sample = audio[i];
      const prevSample = audio[i - 1];
      const energy = sample * sample;

      // Count zero crossings (higher = more high frequency content)
      if (sample * prevSample < 0) {
        zeroCrossings++;
      }

      // Simple band energy estimation based on local variation
      const diff = Math.abs(sample - prevSample);
      if (diff < 0.02) {
        lowEnergy += energy;
      } else if (diff < 0.1) {
        midEnergy += energy;
      } else {
        highEnergy += energy;
      }
    }

    // Normalize
    const total = lowEnergy + midEnergy + highEnergy || 1;
    const bands = [
      lowEnergy / total,
      midEnergy / total,
      highEnergy / total,
      // Pad to configured number of bands
      ...new Array(Math.max(0, this.config.frequencyBands - 3)).fill(0),
    ];

    // Find dominant band
    const dominantBand = bands.indexOf(Math.max(...bands));

    // Zero crossing rate as proxy for spectral centroid
    const zcr = zeroCrossings / audio.length;
    const centroid = zcr; // Higher ZCR = higher centroid

    // Spectral spread (variance of band energies)
    const meanEnergy = 1 / bands.length;
    const spread = Math.sqrt(
      bands.reduce((sum, b) => sum + Math.pow(b - meanEnergy, 2), 0) / bands.length
    );

    // Spectral flatness (geometric mean / arithmetic mean)
    // Simplified: use variance as proxy (lower variance = flatter)
    const flatness = 1 - Math.min(1, spread * 10);

    return {
      bands: bands.slice(0, this.config.frequencyBands),
      dominantBand,
      centroid,
      spread,
      flatness,
    };
  }

  /**
   * Calculate average spectral profile from samples
   */
  private calculateAverageSpectralProfile(samples: Float32Array[]): {
    lowFreqEnergy: number;
    midFreqEnergy: number;
    highFreqEnergy: number;
  } {
    let lowSum = 0;
    let midSum = 0;
    let highSum = 0;

    for (const sample of samples) {
      const spectrum = this.analyzeSpectrum(sample);
      lowSum += spectrum.bands[0] || 0;
      midSum += spectrum.bands[1] || 0;
      highSum += spectrum.bands[2] || 0;
    }

    const count = samples.length || 1;
    const total = (lowSum + midSum + highSum) / count || 1;

    return {
      lowFreqEnergy: lowSum / count / total,
      midFreqEnergy: midSum / count / total,
      highFreqEnergy: highSum / count / total,
    };
  }

  /**
   * Calculate noise level indicator for UI
   */
  private calculateNoiseLevelIndicator(analysis: NoiseAnalysisResult): NoiseLevelIndicator {
    const noiseFloor = this.activeProfile?.noiseFloor || 0.02;
    const typicalSpeechLevel = 0.3;
    const snrDb = analysis.level > 0 ? 20 * Math.log10(typicalSpeechLevel / analysis.level) : 30;
    const quality = this.calculateEnvironmentQuality(analysis.level, noiseFloor);

    return {
      level: analysis.level,
      levelDb: analysis.levelDb,
      peak: this.peakLevel,
      average:
        this.recentLevels.length > 0
          ? this.recentLevels.reduce((a, b) => a + b, 0) / this.recentLevels.length
          : analysis.level,
      noiseFloor,
      snrDb,
      quality,
      status: this.isLearning ? 'learning' : this.getQualityStatus(snrDb),
      timestamp: analysis.timestamp,
    };
  }

  /**
   * Calculate environment quality score (0-1)
   */
  private calculateEnvironmentQuality(currentLevel: number, _noiseFloor: number): number {
    // Quality is inverse of noise level relative to ideal
    const idealNoiseFloor = 0.01;
    const worstNoiseFloor = 0.15;

    const normalized = (currentLevel - idealNoiseFloor) / (worstNoiseFloor - idealNoiseFloor);
    return Math.max(0, Math.min(1, 1 - normalized));
  }

  /**
   * Get quality status string for UI
   */
  private getQualityStatus(snrDb: number): 'excellent' | 'good' | 'fair' | 'poor' {
    if (snrDb >= 25) return 'excellent';
    if (snrDb >= 18) return 'good';
    if (snrDb >= 12) return 'fair';
    return 'poor';
  }

  /**
   * Check for environment change and emit event
   */
  private checkEnvironmentChange(): void {
    if (this.recentLevels.length < 30) return;

    const now = Date.now();
    if (now - this.lastEnvironmentChangeTime < this.environmentChangeDebounce) {
      return;
    }

    const currentAvg = this.recentLevels.slice(-30).reduce((a, b) => a + b, 0) / 30;
    const currentType = this.classifyEnvironment(currentAvg, this.peakLevel);

    // Track environment history
    this.environmentHistory.push(currentType);
    if (this.environmentHistory.length > 10) {
      this.environmentHistory.shift();
    }

    // Check if environment has consistently changed
    if (this.environmentHistory.length >= 5) {
      const recentTypes = this.environmentHistory.slice(-5);
      const consistentType = recentTypes.every((t) => t === currentType);

      if (
        consistentType &&
        this.activeProfile &&
        currentType !== this.activeProfile.environmentType
      ) {
        this.lastEnvironmentChangeTime = now;
        logger.info('Environment change detected', {
          from: this.activeProfile.environmentType,
          to: currentType,
        });
        this.emit('environment-change', this.activeProfile.environmentType, currentType);
      }
    }
  }

  /**
   * Classify environment type based on noise levels
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
   * Create a default noise profile
   */
  private createDefaultProfile(): NamedNoiseProfile {
    return {
      id: this.generateProfileId(),
      name: 'Default',
      description: 'Default noise profile',
      isDefault: true,
      usageCount: 0,
      lastUsed: Date.now(),
      noiseFloor: 0.02,
      peakNoiseLevel: 0.05,
      noiseStdDev: 0.01,
      estimatedSNR: 25,
      spectralProfile: {
        lowFreqEnergy: 0.4,
        midFreqEnergy: 0.35,
        highFreqEnergy: 0.25,
      },
      createdAt: Date.now(),
      profilingDuration: 0,
      sampleCount: 0,
      isValid: false,
      environmentType: 'normal',
    };
  }

  /**
   * Suggest a name for the current environment
   */
  private suggestEnvironmentName(): string {
    const hour = new Date().getHours();
    let timeOfDay: string;

    if (hour >= 6 && hour < 12) {
      timeOfDay = 'Morning';
    } else if (hour >= 12 && hour < 17) {
      timeOfDay = 'Afternoon';
    } else if (hour >= 17 && hour < 21) {
      timeOfDay = 'Evening';
    } else {
      timeOfDay = 'Night';
    }

    // Check current environment type from recent analysis
    const envType = this.activeProfile?.environmentType || 'normal';
    let envName: string;

    switch (envType) {
      case 'quiet':
        envName = 'Quiet Room';
        break;
      case 'noisy':
        envName = 'Busy Area';
        break;
      case 'very_noisy':
        envName = 'Loud Environment';
        break;
      default:
        envName = 'Room';
    }

    return `${timeOfDay} ${envName}`;
  }

  /**
   * Generate a unique profile name
   */
  private generateProfileName(): string {
    const existingNames = new Set(Array.from(this.profiles.values()).map((p) => p.name));
    const baseName = 'Environment';
    let counter = 1;

    while (existingNames.has(`${baseName} ${counter}`)) {
      counter++;
    }

    return `${baseName} ${counter}`;
  }

  /**
   * Generate a unique profile ID
   */
  private generateProfileId(): string {
    return `profile_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Load profiles from storage
   */
  private async loadProfiles(): Promise<void> {
    const storagePath = this.config.storagePath;

    if (!existsSync(storagePath)) {
      logger.debug('No stored profiles found');
      return;
    }

    try {
      const data = readFileSync(storagePath, 'utf-8');
      const storage: NoiseProfileStorage = JSON.parse(data);

      // Validate version
      if (storage.version !== 1) {
        logger.warn('Unknown profile storage version', { version: storage.version });
        return;
      }

      // Load profiles
      for (const profile of storage.profiles) {
        this.profiles.set(profile.id, profile);
      }

      logger.info('Loaded noise profiles', { count: this.profiles.size });
    } catch (error) {
      logger.error('Failed to load noise profiles', { error: (error as Error).message });
    }
  }

  /**
   * Save profiles to storage
   */
  private async saveProfiles(): Promise<void> {
    const storagePath = this.config.storagePath;

    // Ensure directory exists
    const dir = storagePath.substring(
      0,
      storagePath.lastIndexOf('/') || storagePath.lastIndexOf('\\')
    );
    if (dir && !existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const storage: NoiseProfileStorage = {
      version: 1,
      activeProfileId: this.activeProfile?.id || null,
      profiles: Array.from(this.profiles.values()),
      lastUpdated: Date.now(),
    };

    try {
      writeFileSync(storagePath, JSON.stringify(storage, null, 2), 'utf-8');
      logger.debug('Saved noise profiles', { count: this.profiles.size });
    } catch (error) {
      logger.error('Failed to save noise profiles', { error: (error as Error).message });
    }
  }

  /**
   * Get storage data without loading profiles
   */
  private getStorageData(): NoiseProfileStorage | null {
    const storagePath = this.config.storagePath;

    if (!existsSync(storagePath)) {
      return null;
    }

    try {
      const data = readFileSync(storagePath, 'utf-8');
      return JSON.parse(data) as NoiseProfileStorage;
    } catch {
      return null;
    }
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  private calculateRMS(samples: Float32Array): number {
    if (samples.length === 0) return 0;
    let sum = 0;
    for (let i = 0; i < samples.length; i++) {
      sum += samples[i] * samples[i];
    }
    return Math.sqrt(sum / samples.length);
  }

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

  private linearToDb(linear: number): number {
    return 20 * Math.log10(Math.max(linear, 1e-10));
  }

  // Type-safe event emitter methods
  on<K extends keyof NoiseProfileManagerEvents>(
    event: K,
    listener: NoiseProfileManagerEvents[K]
  ): this {
    return super.on(event, listener);
  }

  off<K extends keyof NoiseProfileManagerEvents>(
    event: K,
    listener: NoiseProfileManagerEvents[K]
  ): this {
    return super.off(event, listener);
  }

  emit<K extends keyof NoiseProfileManagerEvents>(
    event: K,
    ...args: Parameters<NoiseProfileManagerEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let noiseProfileManager: NoiseProfileManager | null = null;

/**
 * Get or create the noise profile manager instance
 */
export function getNoiseProfileManager(
  config?: Partial<NoiseProfilingConfig>
): NoiseProfileManager {
  if (!noiseProfileManager) {
    noiseProfileManager = new NoiseProfileManager(config);
  }
  return noiseProfileManager;
}

/**
 * Initialize the noise profile manager (async)
 */
export async function initializeNoiseProfileManager(
  config?: Partial<NoiseProfilingConfig>
): Promise<NoiseProfileManager> {
  const manager = getNoiseProfileManager(config);
  await manager.initialize();
  return manager;
}

/**
 * Shutdown the noise profile manager
 */
export async function shutdownNoiseProfileManager(): Promise<void> {
  if (noiseProfileManager) {
    await noiseProfileManager.shutdown();
    noiseProfileManager = null;
  }
}

export default NoiseProfileManager;
