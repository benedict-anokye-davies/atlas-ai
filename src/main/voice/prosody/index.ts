/**
 * Atlas Voice - Prosody Analysis Module
 *
 * Provides voice-based emotion detection through prosody analysis.
 * Integrates with the voice pipeline to detect user emotions from
 * speech characteristics (pitch, pace, volume, pauses).
 *
 * @module voice/prosody
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../../utils/logger';
import {
  ProsodyFeatures,
  ProsodyBaseline,
  ProsodyDeviation,
  ProsodyEmotionSignal,
  ProsodyEmotionType,
  ProsodyAnalyzerConfig,
  DEFAULT_PROSODY_CONFIG,
} from './types';
import {
  ProsodyFeatureExtractor,
  getProsodyFeatureExtractor,
} from './feature-extractor';
import {
  ProsodyBaselineTracker,
  getProsodyBaselineTracker,
  BaselineTrackerConfig,
} from './baseline-tracker';
import {
  ProsodyEmotionClassifier,
  getProsodyEmotionClassifier,
  ClassifierConfig,
} from './emotion-classifier';

const logger = createModuleLogger('ProsodyAnalyzer');

// =============================================================================
// Types
// =============================================================================

export interface ProsodyAnalyzerEvents {
  /** Emitted when prosody features are extracted */
  'features': (features: ProsodyFeatures) => void;
  /** Emitted when emotion is detected */
  'emotion': (signal: ProsodyEmotionSignal) => void;
  /** Emitted when deviation from baseline is detected */
  'deviation': (deviation: ProsodyDeviation) => void;
  /** Emitted when baseline is updated */
  'baseline-updated': (baseline: ProsodyBaseline) => void;
  /** Emitted when baseline is established */
  'baseline-established': () => void;
  /** Emitted on analysis error */
  'error': (error: Error) => void;
}

export interface ProsodyAnalyzerFullConfig {
  analyzer: ProsodyAnalyzerConfig;
  baseline: Partial<BaselineTrackerConfig>;
  classifier: Partial<ClassifierConfig>;
}

// =============================================================================
// Prosody Analyzer Class
// =============================================================================

/**
 * Main prosody analyzer that orchestrates feature extraction,
 * baseline tracking, and emotion classification.
 */
export class ProsodyAnalyzer extends EventEmitter {
  private featureExtractor: ProsodyFeatureExtractor;
  private baselineTracker: ProsodyBaselineTracker;
  private emotionClassifier: ProsodyEmotionClassifier;
  private config: ProsodyAnalyzerConfig;
  private isEnabled = true;
  private baselineEstablished = false;

  constructor(config: Partial<ProsodyAnalyzerFullConfig> = {}) {
    super();

    this.config = { ...DEFAULT_PROSODY_CONFIG, ...config.analyzer };

    // Initialize components
    this.featureExtractor = getProsodyFeatureExtractor();
    this.baselineTracker = getProsodyBaselineTracker(config.baseline);
    this.emotionClassifier = getProsodyEmotionClassifier(config.classifier);

    // Wire up events
    this.setupEventForwarding();

    logger.info('ProsodyAnalyzer initialized', {
      config: this.config,
      baselineEstablished: this.baselineTracker.isEstablished(),
    });
  }

  /**
   * Set up event forwarding from sub-components
   */
  private setupEventForwarding(): void {
    // Forward feature extraction events
    this.featureExtractor.on('features', (features: ProsodyFeatures) => {
      this.emit('features', features);
    });

    // Forward baseline events
    this.baselineTracker.on('baseline-updated', (baseline: ProsodyBaseline) => {
      this.emit('baseline-updated', baseline);

      // Check if baseline just became established
      if (!this.baselineEstablished && this.baselineTracker.isEstablished()) {
        this.baselineEstablished = true;
        this.emit('baseline-established');
        logger.info('Prosody baseline established');
      }
    });

    // Forward emotion events
    this.emotionClassifier.on('emotion', (signal: ProsodyEmotionSignal) => {
      this.emit('emotion', signal);
    });
  }

  // ===========================================================================
  // Analysis Methods
  // ===========================================================================

  /**
   * Analyze audio buffer and return emotion signal
   */
  analyze(audioBuffer: Buffer | Int16Array): ProsodyEmotionSignal | null {
    if (!this.isEnabled) {
      return null;
    }

    try {
      // Extract prosody features
      const features = this.featureExtractor.extractFeatures(audioBuffer);
      if (!features) {
        return null;
      }

      // Classify emotion
      const signal = this.emotionClassifier.classify(features);

      logger.debug('Prosody analysis complete', {
        emotion: signal.type,
        confidence: signal.confidence.toFixed(2),
        intensity: signal.intensity,
      });

      return signal;
    } catch (error) {
      logger.error('Prosody analysis failed', { error });
      this.emit('error', error as Error);
      return null;
    }
  }

  /**
   * Process streaming audio chunk
   * Accumulates audio and analyzes when enough is collected
   */
  processChunk(chunk: Buffer | Int16Array): ProsodyEmotionSignal | null {
    if (!this.isEnabled) {
      return null;
    }

    try {
      // Process chunk (accumulates internally)
      const features = this.featureExtractor.processChunk(chunk);
      if (!features) {
        return null; // Not enough audio accumulated yet
      }

      // Classify emotion
      const signal = this.emotionClassifier.classify(features);
      return signal;
    } catch (error) {
      logger.error('Chunk processing failed', { error });
      this.emit('error', error as Error);
      return null;
    }
  }

  /**
   * Quick emotion estimate from current state
   */
  quickEstimate(): ProsodyEmotionType {
    const lastEmotion = this.emotionClassifier.getLastEmotion();
    return lastEmotion?.type || 'neutral';
  }

  // ===========================================================================
  // State Management
  // ===========================================================================

  /**
   * Enable prosody analysis
   */
  enable(): void {
    this.isEnabled = true;
    logger.info('Prosody analysis enabled');
  }

  /**
   * Disable prosody analysis
   */
  disable(): void {
    this.isEnabled = false;
    this.featureExtractor.resetAccumulator();
    logger.info('Prosody analysis disabled');
  }

  /**
   * Check if prosody analysis is enabled
   */
  isAnalysisEnabled(): boolean {
    return this.isEnabled;
  }

  /**
   * Reset for new utterance
   */
  resetForNewUtterance(): void {
    this.featureExtractor.resetAccumulator();
  }

  /**
   * Reset all state including history
   */
  reset(): void {
    this.featureExtractor.resetAccumulator();
    this.emotionClassifier.resetHistory();
    logger.info('Prosody analyzer reset');
  }

  // ===========================================================================
  // Baseline Access
  // ===========================================================================

  /**
   * Check if baseline is established
   */
  isBaselineEstablished(): boolean {
    return this.baselineTracker.isEstablished();
  }

  /**
   * Get baseline establishment progress (0-100%)
   */
  getBaselineProgress(): number {
    return this.baselineTracker.getEstablishmentProgress();
  }

  /**
   * Get current baseline
   */
  getBaseline(): ProsodyBaseline | null {
    return this.baselineTracker.getBaseline();
  }

  /**
   * Reset baseline to start fresh
   */
  resetBaseline(): void {
    this.baselineTracker.resetBaseline();
    this.baselineEstablished = false;
  }

  // ===========================================================================
  // Emotion State Access
  // ===========================================================================

  /**
   * Get last detected emotion
   */
  getLastEmotion(): ProsodyEmotionSignal | null {
    return this.emotionClassifier.getLastEmotion();
  }

  /**
   * Get emotion history
   */
  getEmotionHistory(): ProsodyEmotionSignal[] {
    return this.emotionClassifier.getEmotionHistory();
  }

  /**
   * Get emotion trend
   */
  getEmotionTrend(): ReturnType<ProsodyEmotionClassifier['getEmotionTrend']> {
    return this.emotionClassifier.getEmotionTrend();
  }

  /**
   * Get suggested TTS tone based on current emotion
   */
  getSuggestedTone(): string {
    const lastEmotion = this.emotionClassifier.getLastEmotion();
    return lastEmotion?.suggestedTone || 'professional';
  }

  // ===========================================================================
  // LLM Prompt Modifier
  // ===========================================================================

  /**
   * Get system prompt modifier based on detected emotion
   * (For injection into LLM context)
   */
  getSystemPromptModifier(): string | null {
    const emotion = this.emotionClassifier.getLastEmotion();
    if (!emotion || emotion.confidence < 0.5) {
      return null;
    }

    const modifiers: Record<ProsodyEmotionType, string> = {
      neutral: '',
      happy: 'The user sounds happy. Feel free to be enthusiastic.',
      sad: 'The user sounds sad. Be empathetic and supportive.',
      angry: 'The user sounds frustrated or angry. Stay calm and solution-focused.',
      frustrated: 'The user sounds frustrated. Be patient, acknowledge the difficulty.',
      excited: 'The user sounds excited. Match their energy.',
      anxious: 'The user sounds anxious. Be reassuring, break things into steps.',
      confused: 'The user sounds confused. Be patient, explain clearly.',
      tired: 'The user sounds tired. Be concise and supportive.',
      bored: 'The user seems disengaged. Try to be engaging.',
    };

    const modifier = modifiers[emotion.type];
    if (!modifier) return null;

    return `[VOICE EMOTION: ${emotion.type.toUpperCase()} (${(emotion.confidence * 100).toFixed(0)}% confidence)]\n${modifier}`;
  }

  // ===========================================================================
  // Status & Stats
  // ===========================================================================

  /**
   * Get analyzer status
   */
  getStatus(): {
    enabled: boolean;
    baselineEstablished: boolean;
    baselineProgress: number;
    lastEmotion: ProsodyEmotionType | null;
    emotionConfidence: number;
    trend: string;
  } {
    const lastEmotion = this.emotionClassifier.getLastEmotion();
    const trend = this.emotionClassifier.getEmotionTrend();

    let trendStr = 'stable';
    if (trend.improving) trendStr = 'improving';
    if (trend.declining) trendStr = 'declining';

    return {
      enabled: this.isEnabled,
      baselineEstablished: this.baselineTracker.isEstablished(),
      baselineProgress: this.baselineTracker.getEstablishmentProgress(),
      lastEmotion: lastEmotion?.type || null,
      emotionConfidence: lastEmotion?.confidence || 0,
      trend: trendStr,
    };
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Clean up resources
   */
  destroy(): void {
    this.baselineTracker.forceSave();
    this.removeAllListeners();
    logger.info('ProsodyAnalyzer destroyed');
  }
}

// =============================================================================
// Singleton
// =============================================================================

let instance: ProsodyAnalyzer | null = null;

/**
 * Get the prosody analyzer singleton
 */
export function getProsodyAnalyzer(
  config?: Partial<ProsodyAnalyzerFullConfig>
): ProsodyAnalyzer {
  if (!instance) {
    instance = new ProsodyAnalyzer(config);
  }
  return instance;
}

/**
 * Reset the singleton (for testing)
 */
export function resetProsodyAnalyzer(): void {
  if (instance) {
    instance.destroy();
    instance = null;
  }
}

// =============================================================================
// Re-exports
// =============================================================================

export * from './types';
export { ProsodyFeatureExtractor, getProsodyFeatureExtractor } from './feature-extractor';
export {
  ProsodyBaselineTracker,
  getProsodyBaselineTracker,
  resetProsodyBaselineTracker,
} from './baseline-tracker';
export { ProsodyEmotionClassifier, getProsodyEmotionClassifier } from './emotion-classifier';

export default ProsodyAnalyzer;
