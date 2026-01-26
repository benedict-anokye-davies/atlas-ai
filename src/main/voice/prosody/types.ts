/**
 * Atlas Voice - Prosody Analysis Types
 *
 * Type definitions for voice prosody analysis including pitch, pace,
 * volume, and derived emotion signals.
 *
 * Based on Hume AI EVI research - prosody-based emotion detection.
 *
 * @module voice/prosody/types
 */

// =============================================================================
// Prosody Feature Types
// =============================================================================

/**
 * Raw prosody features extracted from audio
 */
export interface ProsodyFeatures {
  /** Pitch (fundamental frequency) statistics */
  pitch: {
    /** Mean pitch in Hz */
    mean: number;
    /** Standard deviation of pitch */
    std: number;
    /** Pitch slope (rising/falling intonation) */
    slope: number;
    /** Minimum pitch in Hz */
    min: number;
    /** Maximum pitch in Hz */
    max: number;
    /** Pitch range (max - min) */
    range: number;
  };
  /** Speaking rate metrics */
  pace: {
    /** Words per minute (estimated) */
    wordsPerMinute: number;
    /** Syllables per second (estimated) */
    syllablesPerSecond: number;
    /** Variability in pace (std of inter-word gaps) */
    variability: number;
  };
  /** Volume/energy metrics */
  volume: {
    /** Mean RMS energy (0-1 normalized) */
    mean: number;
    /** Standard deviation of energy */
    std: number;
    /** Peak energy */
    peak: number;
    /** Dynamic range (peak/mean ratio) */
    dynamicRange: number;
  };
  /** Pause analysis */
  pauses: {
    /** Number of pauses detected */
    count: number;
    /** Total pause duration in ms */
    totalDuration: number;
    /** Mean pause duration in ms */
    meanDuration: number;
    /** Longest pause in ms */
    maxDuration: number;
    /** Pause durations array */
    durations: number[];
  };
  /** Voice quality metrics */
  quality: {
    /** Jitter (pitch perturbation) - indicates stress/tension */
    jitter: number;
    /** Shimmer (amplitude perturbation) - indicates fatigue/emotion */
    shimmer: number;
    /** Harmonics-to-noise ratio - voice clarity */
    hnr: number;
  };
  /** Timing metadata */
  timestamp: number;
  /** Duration of analyzed segment in ms */
  duration: number;
}

/**
 * Simplified prosody features for quick analysis
 */
export interface SimpleProsodyFeatures {
  pitchMean: number;
  pitchVariability: number;
  pace: number;
  volume: number;
  pauseRatio: number; // pause time / total time
  jitter: number;
}

// =============================================================================
// Baseline Types
// =============================================================================

/**
 * User's baseline prosody profile (what's "normal" for them)
 */
export interface ProsodyBaseline {
  /** User identifier (for multi-user support) */
  userId: string;
  /** Baseline pitch statistics */
  pitch: {
    mean: number;
    std: number;
    min: number;
    max: number;
  };
  /** Baseline pace */
  pace: {
    wordsPerMinute: number;
    syllablesPerSecond: number;
  };
  /** Baseline volume */
  volume: {
    mean: number;
    std: number;
  };
  /** Baseline pause patterns */
  pauses: {
    meanDuration: number;
    frequency: number; // pauses per minute
  };
  /** Baseline voice quality */
  quality: {
    jitter: number;
    shimmer: number;
  };
  /** Number of samples used to build baseline */
  sampleCount: number;
  /** Last update timestamp */
  lastUpdated: number;
  /** Confidence in baseline (0-1, increases with more samples) */
  confidence: number;
}

/**
 * Deviation from baseline
 */
export interface ProsodyDeviation {
  /** Pitch deviation (z-score) */
  pitch: number;
  /** Pace deviation (z-score) */
  pace: number;
  /** Volume deviation (z-score) */
  volume: number;
  /** Pause frequency deviation */
  pauseFrequency: number;
  /** Jitter deviation */
  jitter: number;
  /** Overall deviation magnitude */
  magnitude: number;
}

// =============================================================================
// Emotion Types
// =============================================================================

/**
 * Emotion types detectable from prosody
 */
export type ProsodyEmotionType =
  | 'neutral'
  | 'excited'
  | 'frustrated'
  | 'tired'
  | 'anxious'
  | 'happy'
  | 'sad'
  | 'angry'
  | 'confused'
  | 'stressed';

/**
 * Emotion intensity levels
 */
export type EmotionIntensity = 'subtle' | 'moderate' | 'strong';

/**
 * Emotion signal detected from prosody analysis
 */
export interface ProsodyEmotionSignal {
  /** Primary emotion type */
  type: ProsodyEmotionType;
  /** Intensity of the emotion */
  intensity: EmotionIntensity;
  /** Confidence score (0-1) */
  confidence: number;
  /** Prosody indicators that contributed to detection */
  indicators: string[];
  /** Suggested response tone for Atlas */
  suggestedTone: ResponseTone;
  /** Raw deviation data */
  deviation?: ProsodyDeviation;
}

/**
 * Response tone recommendation
 */
export type ResponseTone =
  | 'calm'
  | 'energetic'
  | 'patient'
  | 'reassuring'
  | 'empathetic'
  | 'professional'
  | 'encouraging'
  | 'gentle';

/**
 * Full emotion state combining prosody and text signals
 */
export interface CombinedEmotionState {
  /** Prosody-based emotion signal */
  prosody?: ProsodyEmotionSignal;
  /** Text-based emotion signal (from existing EmotionDetector) */
  text?: {
    type: string;
    intensity: string;
    confidence: number;
  };
  /** Combined/resolved emotion */
  resolved: ProsodyEmotionSignal;
  /** Whether prosody and text signals agree */
  agreement: boolean;
  /** Timestamp */
  timestamp: number;
}

// =============================================================================
// Prosody Patterns
// =============================================================================

/**
 * Known prosody patterns for emotion detection
 * Based on acoustic research literature
 */
export interface EmotionProsodyPattern {
  emotion: ProsodyEmotionType;
  /** Expected pitch deviation direction */
  pitchDirection: 'higher' | 'lower' | 'variable' | 'neutral';
  /** Expected pitch variability */
  pitchVariability: 'increased' | 'decreased' | 'neutral';
  /** Expected pace change */
  paceChange: 'faster' | 'slower' | 'variable' | 'neutral';
  /** Expected volume change */
  volumeChange: 'louder' | 'quieter' | 'variable' | 'neutral';
  /** Expected pause pattern */
  pausePattern: 'more' | 'fewer' | 'longer' | 'shorter' | 'neutral';
  /** Voice quality indicators */
  qualityIndicators: {
    jitterChange: 'increased' | 'decreased' | 'neutral';
    shimmerChange: 'increased' | 'decreased' | 'neutral';
  };
}

/**
 * Research-based emotion prosody patterns
 */
export const EMOTION_PROSODY_PATTERNS: EmotionProsodyPattern[] = [
  {
    emotion: 'excited',
    pitchDirection: 'higher',
    pitchVariability: 'increased',
    paceChange: 'faster',
    volumeChange: 'louder',
    pausePattern: 'fewer',
    qualityIndicators: { jitterChange: 'increased', shimmerChange: 'neutral' },
  },
  {
    emotion: 'happy',
    pitchDirection: 'higher',
    pitchVariability: 'increased',
    paceChange: 'faster',
    volumeChange: 'louder',
    pausePattern: 'neutral',
    qualityIndicators: { jitterChange: 'neutral', shimmerChange: 'neutral' },
  },
  {
    emotion: 'frustrated',
    pitchDirection: 'higher',
    pitchVariability: 'increased',
    paceChange: 'faster',
    volumeChange: 'louder',
    pausePattern: 'fewer',
    qualityIndicators: { jitterChange: 'increased', shimmerChange: 'increased' },
  },
  {
    emotion: 'angry',
    pitchDirection: 'higher',
    pitchVariability: 'increased',
    paceChange: 'faster',
    volumeChange: 'louder',
    pausePattern: 'fewer',
    qualityIndicators: { jitterChange: 'increased', shimmerChange: 'increased' },
  },
  {
    emotion: 'anxious',
    pitchDirection: 'higher',
    pitchVariability: 'increased',
    paceChange: 'faster',
    volumeChange: 'variable',
    pausePattern: 'more',
    qualityIndicators: { jitterChange: 'increased', shimmerChange: 'increased' },
  },
  {
    emotion: 'stressed',
    pitchDirection: 'higher',
    pitchVariability: 'increased',
    paceChange: 'variable',
    volumeChange: 'variable',
    pausePattern: 'variable',
    qualityIndicators: { jitterChange: 'increased', shimmerChange: 'increased' },
  },
  {
    emotion: 'sad',
    pitchDirection: 'lower',
    pitchVariability: 'decreased',
    paceChange: 'slower',
    volumeChange: 'quieter',
    pausePattern: 'longer',
    qualityIndicators: { jitterChange: 'neutral', shimmerChange: 'increased' },
  },
  {
    emotion: 'tired',
    pitchDirection: 'lower',
    pitchVariability: 'decreased',
    paceChange: 'slower',
    volumeChange: 'quieter',
    pausePattern: 'longer',
    qualityIndicators: { jitterChange: 'neutral', shimmerChange: 'increased' },
  },
  {
    emotion: 'confused',
    pitchDirection: 'variable',
    pitchVariability: 'increased',
    paceChange: 'slower',
    volumeChange: 'neutral',
    pausePattern: 'more',
    qualityIndicators: { jitterChange: 'neutral', shimmerChange: 'neutral' },
  },
  {
    emotion: 'neutral',
    pitchDirection: 'neutral',
    pitchVariability: 'neutral',
    paceChange: 'neutral',
    volumeChange: 'neutral',
    pausePattern: 'neutral',
    qualityIndicators: { jitterChange: 'neutral', shimmerChange: 'neutral' },
  },
];

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Prosody analyzer configuration
 */
export interface ProsodyAnalyzerConfig {
  /** Minimum audio duration (ms) for reliable analysis */
  minDuration: number;
  /** Sample rate of input audio */
  sampleRate: number;
  /** Frame size for analysis (samples) */
  frameSize: number;
  /** Hop size between frames (samples) */
  hopSize: number;
  /** Pitch detection range (Hz) */
  pitchRange: { min: number; max: number };
  /** Pause detection threshold (silence duration ms) */
  pauseThreshold: number;
  /** Minimum confidence to report emotion */
  minEmotionConfidence: number;
  /** Whether to use baseline comparison */
  useBaseline: boolean;
  /** Baseline learning rate (EMA alpha) */
  baselineLearningRate: number;
}

/**
 * Default prosody analyzer configuration
 */
export const DEFAULT_PROSODY_CONFIG: ProsodyAnalyzerConfig = {
  minDuration: 500, // 500ms minimum
  sampleRate: 16000, // 16kHz (Deepgram default)
  frameSize: 512, // ~32ms at 16kHz
  hopSize: 256, // 50% overlap
  pitchRange: { min: 50, max: 500 }, // Human voice range
  pauseThreshold: 200, // 200ms pause threshold
  minEmotionConfidence: 0.5, // 50% minimum confidence
  useBaseline: true,
  baselineLearningRate: 0.1, // EMA alpha for baseline updates
};

// =============================================================================
// Event Types
// =============================================================================

/**
 * Prosody analysis result event
 */
export interface ProsodyAnalysisEvent {
  /** Extracted features */
  features: ProsodyFeatures;
  /** Deviation from baseline (if available) */
  deviation?: ProsodyDeviation;
  /** Detected emotion signal */
  emotion?: ProsodyEmotionSignal;
  /** Audio segment timestamp */
  timestamp: number;
  /** Analysis latency in ms */
  latency: number;
}

/**
 * Baseline update event
 */
export interface BaselineUpdateEvent {
  /** Previous baseline (if any) */
  previous?: ProsodyBaseline;
  /** New baseline */
  current: ProsodyBaseline;
  /** Change magnitude */
  changeMagnitude: number;
}
