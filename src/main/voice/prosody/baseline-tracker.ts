/**
 * Atlas Voice - Prosody Baseline Tracker
 *
 * Tracks and learns user's normal speech patterns over time using
 * Exponential Moving Average (EMA) for smooth baseline updates.
 *
 * @module voice/prosody/baseline-tracker
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { createModuleLogger } from '../../utils/logger';
import {
  ProsodyFeatures,
  ProsodyBaseline,
  ProsodyDeviation,
  SimpleProsodyFeatures,
} from './types';

const logger = createModuleLogger('ProsodyBaselineTracker');

// =============================================================================
// Constants
// =============================================================================

/** EMA smoothing factor for baseline updates (0.1 = slow adaptation, 0.5 = fast) */
const DEFAULT_EMA_ALPHA = 0.15;

/** Minimum samples before baseline is considered established */
const MIN_SAMPLES_FOR_BASELINE = 10;

/** Maximum age of baseline data before considered stale (30 days) */
const MAX_BASELINE_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** Save to disk interval (5 minutes) */
const SAVE_INTERVAL_MS = 5 * 60 * 1000;

// =============================================================================
// Baseline Tracker Class
// =============================================================================

export interface BaselineTrackerConfig {
  /** EMA smoothing factor (0.0-1.0, higher = faster adaptation) */
  emaAlpha: number;
  /** Minimum samples before baseline is established */
  minSamples: number;
  /** User ID for multi-user support */
  userId: string;
  /** Data storage path */
  storagePath?: string;
}

const DEFAULT_CONFIG: BaselineTrackerConfig = {
  emaAlpha: DEFAULT_EMA_ALPHA,
  minSamples: MIN_SAMPLES_FOR_BASELINE,
  userId: 'default',
};

/**
 * Tracks user's speech baseline patterns for deviation detection
 */
export class ProsodyBaselineTracker extends EventEmitter {
  private config: BaselineTrackerConfig;
  private baseline: ProsodyBaseline | null = null;
  private storagePath: string;
  private saveTimer: NodeJS.Timeout | null = null;
  private isDirty = false;

  constructor(config: Partial<BaselineTrackerConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    // Set up storage path
    const userDataPath = app?.getPath?.('userData') || './data';
    this.storagePath = config.storagePath || path.join(userDataPath, 'prosody');
    
    // Load existing baseline
    this.loadBaseline();
    
    // Start periodic save
    this.startPeriodicSave();
    
    logger.info('ProsodyBaselineTracker initialized', {
      userId: this.config.userId,
      storagePath: this.storagePath,
      hasBaseline: !!this.baseline,
    });
  }

  // ===========================================================================
  // Baseline Management
  // ===========================================================================

  /**
   * Update baseline with new prosody features
   */
  updateBaseline(features: ProsodyFeatures): void {
    if (!this.baseline) {
      // Initialize baseline from first features
      this.baseline = this.initializeBaseline(features);
      logger.info('Baseline initialized from first sample');
    } else {
      // Update existing baseline with EMA
      this.applyEMAUpdate(features);
    }

    this.baseline.sampleCount++;
    this.baseline.lastUpdated = Date.now();
    this.isDirty = true;

    // Emit update event
    this.emit('baseline-updated', this.baseline);

    logger.debug('Baseline updated', {
      sampleCount: this.baseline.sampleCount,
      pitchMean: this.baseline.pitch.mean.toFixed(1),
      paceMean: this.baseline.pace.mean.toFixed(0),
    });
  }

  /**
   * Initialize baseline from first features sample
   */
  private initializeBaseline(features: ProsodyFeatures): ProsodyBaseline {
    return {
      userId: this.config.userId,
      pitch: {
        mean: features.pitch.mean,
        std: features.pitch.std,
        rangeLow: features.pitch.mean - features.pitch.std * 2,
        rangeHigh: features.pitch.mean + features.pitch.std * 2,
      },
      pace: {
        mean: features.pace.wordsPerMinute,
        std: 20, // Initial estimate
        normal: features.pace.wordsPerMinute,
      },
      volume: {
        mean: features.volume.mean,
        std: features.volume.std,
        comfortable: features.volume.mean,
      },
      pausePattern: {
        typicalDuration: features.pauses.meanDuration || 200,
        frequencyPerMinute: features.pauses.count * (60000 / features.duration),
      },
      quality: {
        jitterBaseline: features.quality.jitter,
        shimmerBaseline: features.quality.shimmer,
      },
      sampleCount: 0,
      establishedAt: Date.now(),
      lastUpdated: Date.now(),
    };
  }

  /**
   * Apply EMA update to baseline
   */
  private applyEMAUpdate(features: ProsodyFeatures): void {
    if (!this.baseline) return;

    const alpha = this.config.emaAlpha;
    const oneMinusAlpha = 1 - alpha;

    // Update pitch
    this.baseline.pitch.mean = alpha * features.pitch.mean + oneMinusAlpha * this.baseline.pitch.mean;
    this.baseline.pitch.std = alpha * features.pitch.std + oneMinusAlpha * this.baseline.pitch.std;
    this.baseline.pitch.rangeLow = this.baseline.pitch.mean - this.baseline.pitch.std * 2;
    this.baseline.pitch.rangeHigh = this.baseline.pitch.mean + this.baseline.pitch.std * 2;

    // Update pace
    this.baseline.pace.mean = alpha * features.pace.wordsPerMinute + oneMinusAlpha * this.baseline.pace.mean;
    // Estimate std from variation
    const paceDeviation = Math.abs(features.pace.wordsPerMinute - this.baseline.pace.mean);
    this.baseline.pace.std = alpha * paceDeviation + oneMinusAlpha * this.baseline.pace.std;
    this.baseline.pace.normal = this.baseline.pace.mean;

    // Update volume
    this.baseline.volume.mean = alpha * features.volume.mean + oneMinusAlpha * this.baseline.volume.mean;
    this.baseline.volume.std = alpha * features.volume.std + oneMinusAlpha * this.baseline.volume.std;
    this.baseline.volume.comfortable = this.baseline.volume.mean;

    // Update pause patterns
    if (features.pauses.count > 0 && features.pauses.meanDuration > 0) {
      this.baseline.pausePattern.typicalDuration =
        alpha * features.pauses.meanDuration + oneMinusAlpha * this.baseline.pausePattern.typicalDuration;
      const pauseFreq = features.pauses.count * (60000 / features.duration);
      this.baseline.pausePattern.frequencyPerMinute =
        alpha * pauseFreq + oneMinusAlpha * this.baseline.pausePattern.frequencyPerMinute;
    }

    // Update quality metrics
    this.baseline.quality.jitterBaseline =
      alpha * features.quality.jitter + oneMinusAlpha * this.baseline.quality.jitterBaseline;
    this.baseline.quality.shimmerBaseline =
      alpha * features.quality.shimmer + oneMinusAlpha * this.baseline.quality.shimmerBaseline;
  }

  // ===========================================================================
  // Deviation Calculation
  // ===========================================================================

  /**
   * Calculate deviation from baseline
   */
  calculateDeviation(features: ProsodyFeatures): ProsodyDeviation | null {
    if (!this.baseline || !this.isEstablished()) {
      return null;
    }

    // Calculate z-scores for each dimension
    const pitchZScore = this.baseline.pitch.std > 0
      ? (features.pitch.mean - this.baseline.pitch.mean) / this.baseline.pitch.std
      : 0;

    const paceZScore = this.baseline.pace.std > 0
      ? (features.pace.wordsPerMinute - this.baseline.pace.mean) / this.baseline.pace.std
      : 0;

    const volumeZScore = this.baseline.volume.std > 0
      ? (features.volume.mean - this.baseline.volume.mean) / this.baseline.volume.std
      : 0;

    // Pause deviation (ratio comparison)
    const pauseDeviation = this.baseline.pausePattern.typicalDuration > 0
      ? (features.pauses.meanDuration || 0) / this.baseline.pausePattern.typicalDuration - 1
      : 0;

    // Quality deviation
    const jitterDeviation = this.baseline.quality.jitterBaseline > 0
      ? features.quality.jitter / this.baseline.quality.jitterBaseline - 1
      : 0;
    const shimmerDeviation = this.baseline.quality.shimmerBaseline > 0
      ? features.quality.shimmer / this.baseline.quality.shimmerBaseline - 1
      : 0;

    // Overall magnitude (RMS of z-scores)
    const magnitude = Math.sqrt(
      (pitchZScore ** 2 + paceZScore ** 2 + volumeZScore ** 2) / 3
    );

    const deviation: ProsodyDeviation = {
      pitch: {
        zScore: pitchZScore,
        direction: pitchZScore > 0.5 ? 'higher' : pitchZScore < -0.5 ? 'lower' : 'normal',
        percentChange: this.baseline.pitch.mean > 0
          ? ((features.pitch.mean - this.baseline.pitch.mean) / this.baseline.pitch.mean) * 100
          : 0,
      },
      pace: {
        zScore: paceZScore,
        direction: paceZScore > 0.5 ? 'faster' : paceZScore < -0.5 ? 'slower' : 'normal',
        percentChange: this.baseline.pace.mean > 0
          ? ((features.pace.wordsPerMinute - this.baseline.pace.mean) / this.baseline.pace.mean) * 100
          : 0,
      },
      volume: {
        zScore: volumeZScore,
        direction: volumeZScore > 0.5 ? 'louder' : volumeZScore < -0.5 ? 'quieter' : 'normal',
        percentChange: this.baseline.volume.mean > 0
          ? ((features.volume.mean - this.baseline.volume.mean) / this.baseline.volume.mean) * 100
          : 0,
      },
      pauses: {
        deviation: pauseDeviation,
        direction: pauseDeviation > 0.3 ? 'more' : pauseDeviation < -0.3 ? 'fewer' : 'normal',
      },
      quality: {
        jitterDeviation,
        shimmerDeviation,
        isStressed: jitterDeviation > 0.5 || shimmerDeviation > 0.5,
      },
      overallMagnitude: magnitude,
      isSignificant: magnitude > 1.0, // More than 1 std deviation overall
      timestamp: Date.now(),
    };

    this.emit('deviation', deviation);
    return deviation;
  }

  /**
   * Quick deviation check from simplified features
   */
  quickDeviationCheck(features: SimpleProsodyFeatures): {
    pitchHigh: boolean;
    pitchLow: boolean;
    fast: boolean;
    slow: boolean;
    loud: boolean;
    quiet: boolean;
  } {
    const result = {
      pitchHigh: false,
      pitchLow: false,
      fast: false,
      slow: false,
      loud: false,
      quiet: false,
    };

    if (!this.baseline || !this.isEstablished()) {
      return result;
    }

    const pitchThreshold = 1.5; // std deviations
    const paceThreshold = 1.5;
    const volumeThreshold = 1.5;

    const pitchZ = this.baseline.pitch.std > 0
      ? (features.pitchMean - this.baseline.pitch.mean) / this.baseline.pitch.std
      : 0;
    const paceZ = this.baseline.pace.std > 0
      ? (features.pace - this.baseline.pace.mean) / this.baseline.pace.std
      : 0;
    const volumeZ = this.baseline.volume.std > 0
      ? (features.volume - this.baseline.volume.mean) / this.baseline.volume.std
      : 0;

    result.pitchHigh = pitchZ > pitchThreshold;
    result.pitchLow = pitchZ < -pitchThreshold;
    result.fast = paceZ > paceThreshold;
    result.slow = paceZ < -paceThreshold;
    result.loud = volumeZ > volumeThreshold;
    result.quiet = volumeZ < -volumeThreshold;

    return result;
  }

  // ===========================================================================
  // State Queries
  // ===========================================================================

  /**
   * Check if baseline has enough samples to be reliable
   */
  isEstablished(): boolean {
    return !!this.baseline && this.baseline.sampleCount >= this.config.minSamples;
  }

  /**
   * Check if baseline is stale and needs refreshing
   */
  isStale(): boolean {
    if (!this.baseline) return true;
    return Date.now() - this.baseline.lastUpdated > MAX_BASELINE_AGE_MS;
  }

  /**
   * Get current baseline
   */
  getBaseline(): ProsodyBaseline | null {
    return this.baseline ? { ...this.baseline } : null;
  }

  /**
   * Get baseline establishment progress (0-100%)
   */
  getEstablishmentProgress(): number {
    if (!this.baseline) return 0;
    return Math.min(100, (this.baseline.sampleCount / this.config.minSamples) * 100);
  }

  // ===========================================================================
  // Persistence
  // ===========================================================================

  /**
   * Load baseline from disk
   */
  private loadBaseline(): void {
    const filePath = this.getBaselineFilePath();
    
    try {
      if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, 'utf8');
        this.baseline = JSON.parse(data) as ProsodyBaseline;
        
        // Check if stale
        if (this.isStale()) {
          logger.warn('Loaded baseline is stale, will refresh with new samples');
        }
        
        logger.info('Baseline loaded from disk', {
          sampleCount: this.baseline.sampleCount,
          lastUpdated: new Date(this.baseline.lastUpdated).toISOString(),
        });
      }
    } catch (error) {
      logger.warn('Failed to load baseline from disk', { error, filePath });
      this.baseline = null;
    }
  }

  /**
   * Save baseline to disk
   */
  private saveBaseline(): void {
    if (!this.baseline || !this.isDirty) return;

    const filePath = this.getBaselineFilePath();
    
    try {
      // Ensure directory exists
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      fs.writeFileSync(filePath, JSON.stringify(this.baseline, null, 2));
      this.isDirty = false;
      
      logger.debug('Baseline saved to disk', { filePath });
    } catch (error) {
      logger.error('Failed to save baseline to disk', { error, filePath });
    }
  }

  /**
   * Get baseline file path for current user
   */
  private getBaselineFilePath(): string {
    return path.join(this.storagePath, `baseline-${this.config.userId}.json`);
  }

  /**
   * Start periodic save timer
   */
  private startPeriodicSave(): void {
    if (this.saveTimer) {
      clearInterval(this.saveTimer);
    }
    
    this.saveTimer = setInterval(() => {
      this.saveBaseline();
    }, SAVE_INTERVAL_MS);
  }

  /**
   * Force save baseline now
   */
  forceSave(): void {
    this.saveBaseline();
  }

  /**
   * Reset baseline to start fresh
   */
  resetBaseline(): void {
    this.baseline = null;
    this.isDirty = true;
    this.saveBaseline();
    logger.info('Baseline reset');
    this.emit('baseline-reset');
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Clean up resources
   */
  destroy(): void {
    if (this.saveTimer) {
      clearInterval(this.saveTimer);
      this.saveTimer = null;
    }
    
    // Final save
    this.saveBaseline();
    
    this.removeAllListeners();
    logger.info('ProsodyBaselineTracker destroyed');
  }
}

// =============================================================================
// Singleton
// =============================================================================

let instance: ProsodyBaselineTracker | null = null;

/**
 * Get the prosody baseline tracker singleton
 */
export function getProsodyBaselineTracker(
  config?: Partial<BaselineTrackerConfig>
): ProsodyBaselineTracker {
  if (!instance) {
    instance = new ProsodyBaselineTracker(config);
  }
  return instance;
}

/**
 * Reset the singleton (for testing)
 */
export function resetProsodyBaselineTracker(): void {
  if (instance) {
    instance.destroy();
    instance = null;
  }
}

export default ProsodyBaselineTracker;
