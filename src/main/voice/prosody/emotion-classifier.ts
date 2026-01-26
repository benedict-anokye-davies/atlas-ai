/**
 * Atlas Voice - Prosody Emotion Classifier
 *
 * Classifies emotions from prosody features by comparing against
 * baseline and matching deviation patterns to known emotion profiles.
 *
 * @module voice/prosody/emotion-classifier
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../../utils/logger';
import {
  ProsodyFeatures,
  ProsodyDeviation,
  ProsodyEmotionType,
  ProsodyEmotionSignal,
  EMOTION_PROSODY_PATTERNS,
  SimpleProsodyFeatures,
} from './types';
import { ProsodyBaselineTracker, getProsodyBaselineTracker } from './baseline-tracker';

const logger = createModuleLogger('ProsodyEmotionClassifier');

// =============================================================================
// Types
// =============================================================================

export interface ClassifierConfig {
  /** Minimum confidence to report emotion (0-1) */
  confidenceThreshold: number;
  /** Weight for pitch features (0-1) */
  pitchWeight: number;
  /** Weight for pace features (0-1) */
  paceWeight: number;
  /** Weight for volume features (0-1) */
  volumeWeight: number;
  /** Weight for pause features (0-1) */
  pauseWeight: number;
  /** Weight for quality features (0-1) */
  qualityWeight: number;
  /** Enable secondary emotion detection */
  detectSecondary: boolean;
  /** History length for smoothing (number of samples) */
  smoothingWindow: number;
}

const DEFAULT_CONFIG: ClassifierConfig = {
  confidenceThreshold: 0.5,
  pitchWeight: 0.3,
  paceWeight: 0.25,
  volumeWeight: 0.2,
  pauseWeight: 0.15,
  qualityWeight: 0.1,
  detectSecondary: true,
  smoothingWindow: 3,
};

interface EmotionScore {
  type: ProsodyEmotionType;
  score: number;
  matches: string[];
}

// =============================================================================
// Emotion Classifier Class
// =============================================================================

/**
 * Classifies emotions from prosody features
 */
export class ProsodyEmotionClassifier extends EventEmitter {
  private config: ClassifierConfig;
  private baselineTracker: ProsodyBaselineTracker;
  private emotionHistory: ProsodyEmotionSignal[] = [];
  private lastEmotion: ProsodyEmotionSignal | null = null;

  constructor(
    config: Partial<ClassifierConfig> = {},
    baselineTracker?: ProsodyBaselineTracker
  ) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.baselineTracker = baselineTracker || getProsodyBaselineTracker();
    
    logger.info('ProsodyEmotionClassifier initialized', { config: this.config });
  }

  // ===========================================================================
  // Classification
  // ===========================================================================

  /**
   * Classify emotion from prosody features
   */
  classify(features: ProsodyFeatures): ProsodyEmotionSignal {
    // Update baseline with new sample
    this.baselineTracker.updateBaseline(features);

    // Calculate deviation from baseline
    const deviation = this.baselineTracker.calculateDeviation(features);

    // Score each emotion pattern
    const scores = this.scoreAllEmotions(features, deviation);

    // Sort by score
    scores.sort((a, b) => b.score - a.score);

    // Get primary emotion
    const primary = scores[0];
    const secondary = this.config.detectSecondary && scores.length > 1 ? scores[1] : null;

    // Calculate intensity based on deviation magnitude
    const intensity = this.calculateIntensity(deviation);

    // Build signal
    const signal: ProsodyEmotionSignal = {
      type: primary.score >= this.config.confidenceThreshold ? primary.type : 'neutral',
      intensity,
      confidence: primary.score,
      source: 'voice',
      indicators: primary.matches,
      secondaryType: secondary && secondary.score >= this.config.confidenceThreshold * 0.7
        ? secondary.type
        : undefined,
      secondaryConfidence: secondary?.score,
      suggestedTone: this.mapEmotionToTone(primary.type),
      rawScores: Object.fromEntries(scores.map(s => [s.type, s.score])),
      timestamp: Date.now(),
    };

    // Apply smoothing
    const smoothedSignal = this.applySmoothing(signal);

    // Store and emit
    this.lastEmotion = smoothedSignal;
    this.emit('emotion', smoothedSignal);

    logger.debug('Emotion classified', {
      type: smoothedSignal.type,
      confidence: smoothedSignal.confidence.toFixed(2),
      intensity: smoothedSignal.intensity,
      indicators: smoothedSignal.indicators.slice(0, 3),
    });

    return smoothedSignal;
  }

  /**
   * Quick classification from simplified features
   */
  quickClassify(features: SimpleProsodyFeatures): ProsodyEmotionType {
    const checks = this.baselineTracker.quickDeviationCheck(features);

    // Simple rule-based classification
    if (checks.pitchHigh && checks.fast) return 'excited';
    if (checks.pitchHigh && checks.loud) return 'angry';
    if (checks.pitchLow && checks.slow) return 'sad';
    if (checks.fast && checks.loud) return 'frustrated';
    if (checks.slow && checks.quiet) return 'tired';
    if (checks.pitchHigh && checks.quiet) return 'anxious';

    return 'neutral';
  }

  // ===========================================================================
  // Scoring
  // ===========================================================================

  /**
   * Score all emotion patterns against current features
   */
  private scoreAllEmotions(
    features: ProsodyFeatures,
    deviation: ProsodyDeviation | null
  ): EmotionScore[] {
    const scores: EmotionScore[] = [];

    for (const [emotionType, pattern] of Object.entries(EMOTION_PROSODY_PATTERNS)) {
      const { score, matches } = this.scoreEmotionPattern(
        emotionType as ProsodyEmotionType,
        pattern,
        features,
        deviation
      );
      scores.push({ type: emotionType as ProsodyEmotionType, score, matches });
    }

    return scores;
  }

  /**
   * Score a single emotion pattern
   */
  private scoreEmotionPattern(
    emotionType: ProsodyEmotionType,
    pattern: typeof EMOTION_PROSODY_PATTERNS[keyof typeof EMOTION_PROSODY_PATTERNS],
    features: ProsodyFeatures,
    deviation: ProsodyDeviation | null
  ): { score: number; matches: string[] } {
    let totalScore = 0;
    let totalWeight = 0;
    const matches: string[] = [];

    // Score pitch
    const pitchScore = this.scoreDimension(
      deviation?.pitch.zScore || 0,
      pattern.pitch,
      'pitch'
    );
    if (pitchScore.match) matches.push(pitchScore.indicator);
    totalScore += pitchScore.score * this.config.pitchWeight;
    totalWeight += this.config.pitchWeight;

    // Score pace
    const paceScore = this.scoreDimension(
      deviation?.pace.zScore || 0,
      pattern.pace,
      'pace'
    );
    if (paceScore.match) matches.push(paceScore.indicator);
    totalScore += paceScore.score * this.config.paceWeight;
    totalWeight += this.config.paceWeight;

    // Score volume
    const volumeScore = this.scoreDimension(
      deviation?.volume.zScore || 0,
      pattern.volume,
      'volume'
    );
    if (volumeScore.match) matches.push(volumeScore.indicator);
    totalScore += volumeScore.score * this.config.volumeWeight;
    totalWeight += this.config.volumeWeight;

    // Score pauses
    const pauseScore = this.scorePauses(
      features.pauses,
      pattern.pauses,
      deviation?.pauses.deviation || 0
    );
    if (pauseScore.match) matches.push(pauseScore.indicator);
    totalScore += pauseScore.score * this.config.pauseWeight;
    totalWeight += this.config.pauseWeight;

    // Score quality (jitter/shimmer indicate stress)
    const qualityScore = this.scoreQuality(
      features.quality,
      deviation?.quality,
      pattern
    );
    if (qualityScore.match) matches.push(qualityScore.indicator);
    totalScore += qualityScore.score * this.config.qualityWeight;
    totalWeight += this.config.qualityWeight;

    // Normalize
    const normalizedScore = totalWeight > 0 ? totalScore / totalWeight : 0;

    return { score: normalizedScore, matches };
  }

  /**
   * Score a single dimension (pitch, pace, volume)
   */
  private scoreDimension(
    zScore: number,
    expected: 'higher' | 'lower' | 'variable' | 'normal',
    dimension: string
  ): { score: number; match: boolean; indicator: string } {
    let score = 0;
    let match = false;
    let indicator = '';

    switch (expected) {
      case 'higher':
        score = Math.max(0, Math.min(1, (zScore + 1) / 2)); // Maps -1..3 to 0..1
        match = zScore > 0.5;
        indicator = `${dimension} elevated`;
        break;
      case 'lower':
        score = Math.max(0, Math.min(1, (-zScore + 1) / 2)); // Maps -3..1 to 0..1
        match = zScore < -0.5;
        indicator = `${dimension} reduced`;
        break;
      case 'variable':
        // Variable = high absolute z-score
        score = Math.abs(zScore) / 2;
        match = Math.abs(zScore) > 1;
        indicator = `${dimension} variable`;
        break;
      case 'normal':
        // Normal = low absolute z-score
        score = Math.max(0, 1 - Math.abs(zScore));
        match = Math.abs(zScore) < 0.5;
        indicator = `${dimension} normal`;
        break;
    }

    return { score, match, indicator };
  }

  /**
   * Score pause patterns
   */
  private scorePauses(
    pauses: ProsodyFeatures['pauses'],
    expected: 'more' | 'fewer' | 'longer' | 'shorter' | 'normal',
    deviation: number
  ): { score: number; match: boolean; indicator: string } {
    let score = 0;
    let match = false;
    let indicator = '';

    switch (expected) {
      case 'more':
      case 'longer':
        score = Math.max(0, Math.min(1, (deviation + 1) / 2));
        match = deviation > 0.3;
        indicator = 'pauses increased';
        break;
      case 'fewer':
      case 'shorter':
        score = Math.max(0, Math.min(1, (-deviation + 1) / 2));
        match = deviation < -0.3;
        indicator = 'pauses decreased';
        break;
      case 'normal':
        score = Math.max(0, 1 - Math.abs(deviation));
        match = Math.abs(deviation) < 0.3;
        indicator = 'pauses normal';
        break;
    }

    return { score, match, indicator };
  }

  /**
   * Score voice quality (jitter/shimmer)
   */
  private scoreQuality(
    quality: ProsodyFeatures['quality'],
    deviationQuality: ProsodyDeviation['quality'] | undefined,
    pattern: typeof EMOTION_PROSODY_PATTERNS[keyof typeof EMOTION_PROSODY_PATTERNS]
  ): { score: number; match: boolean; indicator: string } {
    // High jitter/shimmer often indicates stress or emotional arousal
    const isStressed = deviationQuality?.isStressed || false;
    const jitterDev = deviationQuality?.jitterDeviation || 0;
    const shimmerDev = deviationQuality?.shimmerDeviation || 0;

    // Emotions with high arousal should have elevated jitter/shimmer
    const highArousalEmotions: ProsodyEmotionType[] = [
      'angry', 'frustrated', 'excited', 'anxious'
    ];
    const expectsStress = highArousalEmotions.includes(pattern as unknown as ProsodyEmotionType);

    let score = 0;
    let match = false;
    let indicator = '';

    if (expectsStress) {
      score = (Math.max(jitterDev, shimmerDev) + 1) / 2;
      match = isStressed;
      indicator = 'voice quality stressed';
    } else {
      score = Math.max(0, 1 - Math.max(jitterDev, shimmerDev));
      match = !isStressed;
      indicator = 'voice quality stable';
    }

    return { score: Math.max(0, Math.min(1, score)), match, indicator };
  }

  // ===========================================================================
  // Intensity & Tone Mapping
  // ===========================================================================

  /**
   * Calculate emotion intensity from deviation magnitude
   */
  private calculateIntensity(
    deviation: ProsodyDeviation | null
  ): 'subtle' | 'moderate' | 'strong' {
    if (!deviation) return 'subtle';

    const magnitude = deviation.overallMagnitude;

    if (magnitude > 2.0) return 'strong';
    if (magnitude > 1.0) return 'moderate';
    return 'subtle';
  }

  /**
   * Map emotion type to suggested response tone
   */
  private mapEmotionToTone(
    emotion: ProsodyEmotionType
  ): 'calm' | 'energetic' | 'empathetic' | 'patient' | 'reassuring' | 'professional' {
    const toneMap: Record<ProsodyEmotionType, typeof this.mapEmotionToTone extends (e: ProsodyEmotionType) => infer R ? R : never> = {
      neutral: 'professional',
      happy: 'energetic',
      sad: 'empathetic',
      angry: 'calm',
      frustrated: 'patient',
      excited: 'energetic',
      anxious: 'reassuring',
      confused: 'patient',
      tired: 'calm',
      bored: 'energetic',
    };

    return toneMap[emotion] || 'professional';
  }

  // ===========================================================================
  // Smoothing & History
  // ===========================================================================

  /**
   * Apply temporal smoothing to reduce noise
   */
  private applySmoothing(signal: ProsodyEmotionSignal): ProsodyEmotionSignal {
    // Add to history
    this.emotionHistory.push(signal);

    // Trim history
    while (this.emotionHistory.length > this.config.smoothingWindow) {
      this.emotionHistory.shift();
    }

    // Not enough history for smoothing
    if (this.emotionHistory.length < 2) {
      return signal;
    }

    // Count emotion occurrences in window
    const emotionCounts = new Map<ProsodyEmotionType, number>();
    const confidenceSum = new Map<ProsodyEmotionType, number>();

    for (const hist of this.emotionHistory) {
      const count = emotionCounts.get(hist.type) || 0;
      emotionCounts.set(hist.type, count + 1);

      const confSum = confidenceSum.get(hist.type) || 0;
      confidenceSum.set(hist.type, confSum + hist.confidence);
    }

    // Find most common emotion
    let dominantEmotion: ProsodyEmotionType = signal.type;
    let maxCount = 0;

    for (const [emotion, count] of emotionCounts.entries()) {
      if (count > maxCount) {
        maxCount = count;
        dominantEmotion = emotion;
      }
    }

    // Average confidence for dominant emotion
    const avgConfidence = (confidenceSum.get(dominantEmotion) || signal.confidence) / maxCount;

    // Return smoothed signal if different
    if (dominantEmotion !== signal.type) {
      return {
        ...signal,
        type: dominantEmotion,
        confidence: avgConfidence,
        indicators: [...signal.indicators, 'smoothed'],
      };
    }

    return signal;
  }

  // ===========================================================================
  // State Queries
  // ===========================================================================

  /**
   * Get last classified emotion
   */
  getLastEmotion(): ProsodyEmotionSignal | null {
    return this.lastEmotion;
  }

  /**
   * Get emotion history
   */
  getEmotionHistory(): ProsodyEmotionSignal[] {
    return [...this.emotionHistory];
  }

  /**
   * Get current emotion trend
   */
  getEmotionTrend(): {
    improving: boolean;
    stable: boolean;
    declining: boolean;
    dominantEmotion: ProsodyEmotionType;
  } {
    if (this.emotionHistory.length < 2) {
      return {
        improving: false,
        stable: true,
        declining: false,
        dominantEmotion: 'neutral',
      };
    }

    // Count emotions
    const emotionCounts = new Map<ProsodyEmotionType, number>();
    for (const signal of this.emotionHistory) {
      const count = emotionCounts.get(signal.type) || 0;
      emotionCounts.set(signal.type, count + 1);
    }

    // Find dominant
    let dominantEmotion: ProsodyEmotionType = 'neutral';
    let maxCount = 0;
    for (const [emotion, count] of emotionCounts.entries()) {
      if (count > maxCount) {
        maxCount = count;
        dominantEmotion = emotion;
      }
    }

    // Calculate trend based on positive vs negative emotions
    const positiveEmotions: ProsodyEmotionType[] = ['happy', 'excited', 'neutral'];
    const negativeEmotions: ProsodyEmotionType[] = ['sad', 'angry', 'frustrated', 'anxious', 'tired'];

    const recentHalf = this.emotionHistory.slice(-Math.ceil(this.emotionHistory.length / 2));
    const olderHalf = this.emotionHistory.slice(0, Math.floor(this.emotionHistory.length / 2));

    const recentPositive = recentHalf.filter(s => positiveEmotions.includes(s.type)).length;
    const olderPositive = olderHalf.filter(s => positiveEmotions.includes(s.type)).length;

    const recentRatio = recentHalf.length > 0 ? recentPositive / recentHalf.length : 0.5;
    const olderRatio = olderHalf.length > 0 ? olderPositive / olderHalf.length : 0.5;

    const diff = recentRatio - olderRatio;

    return {
      improving: diff > 0.2,
      stable: Math.abs(diff) <= 0.2,
      declining: diff < -0.2,
      dominantEmotion,
    };
  }

  /**
   * Reset history
   */
  resetHistory(): void {
    this.emotionHistory = [];
    this.lastEmotion = null;
    logger.info('Emotion history reset');
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<ClassifierConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('Classifier config updated', { config: this.config });
  }
}

// =============================================================================
// Singleton
// =============================================================================

let instance: ProsodyEmotionClassifier | null = null;

/**
 * Get the prosody emotion classifier singleton
 */
export function getProsodyEmotionClassifier(
  config?: Partial<ClassifierConfig>
): ProsodyEmotionClassifier {
  if (!instance) {
    instance = new ProsodyEmotionClassifier(config);
  }
  return instance;
}

export default ProsodyEmotionClassifier;
