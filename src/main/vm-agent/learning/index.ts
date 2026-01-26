/**
 * Atlas Desktop - VM Agent Learning Module
 *
 * Exports for predictive engine, few-shot learning, active learning,
 * and context fusion capabilities.
 *
 * @module vm-agent/learning
 */

// =============================================================================
// Predictive Engine
// =============================================================================

export {
  PredictiveEngine,
  getPredictiveEngine,
  resetPredictiveEngine,
  PREDICTION_CONSTANTS,
  type ActionPrediction,
  type ActionSequence,
  type TransitionMatrix,
  type IntentPattern,
  type PredictionContext,
} from './predictive-engine';

// =============================================================================
// Few-Shot Learner
// =============================================================================

export {
  FewShotLearner,
  getFewShotLearner,
  resetFewShotLearner,
  FEW_SHOT_CONSTANTS,
  type TaskTemplate,
  type TaskParameter,
  type ActionTemplate,
  type StoredDemonstration,
  type LearningResult,
  type ExecutionContext,
} from './few-shot-learner';

// =============================================================================
// Active Learning
// =============================================================================

export {
  ActiveLearner,
  getActiveLearner,
  resetActiveLearner,
  ACTIVE_LEARNING_CONSTANTS,
  type QueryType,
  type ActiveQuery,
  type QueryOption,
  type QueryContext,
  type QueryResponse,
  type FeedbackRecord,
  type LearningAdjustment,
} from './active-learning';

// =============================================================================
// Context Fusion
// =============================================================================

export {
  ContextFusionEngine,
  getContextFusionEngine,
  resetContextFusionEngine,
  CONTEXT_FUSION_CONSTANTS,
  type FusedContext,
  type RankedElement,
  type RecommendedAction,
  type TaskContext,
  type UserPreferences,
  type RiskAssessment,
  type RiskFactor,
  type ContextInsight,
  type FusionInput,
} from './context-fusion';

// =============================================================================
// Learning Module Initialization
// =============================================================================

import { createModuleLogger } from '../../utils/logger';
import { getPredictiveEngine } from './predictive-engine';
import { getFewShotLearner } from './few-shot-learner';
import { getActiveLearner } from './active-learning';
import { getContextFusionEngine } from './context-fusion';

const logger = createModuleLogger('LearningModule');

/**
 * Initialize all learning components
 */
export async function initializeLearning(): Promise<void> {
  logger.info('Initializing learning module...');

  try {
    // Initialize all learners
    await Promise.all([
      getPredictiveEngine().initialize(),
      getFewShotLearner().initialize(),
      getActiveLearner().initialize(),
    ]);

    // Context fusion doesn't need async init
    getContextFusionEngine();

    logger.info('Learning module initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize learning module', { error });
    throw error;
  }
}

/**
 * Reset all learning components (for testing)
 */
export function resetLearning(): void {
  resetPredictiveEngine();
  resetFewShotLearner();
  resetActiveLearner();
  resetContextFusionEngine();
  logger.info('Learning module reset');
}

/**
 * Get learning module status
 */
export function getLearningStatus(): {
  predictive: {
    patterns: number;
    sequences: number;
    predictions: number;
  };
  fewShot: {
    templates: number;
    demonstrations: number;
    successRate: number;
  };
  activeLearning: {
    pendingQueries: number;
    feedbackRecords: number;
    successRate: number;
  };
} {
  const predictiveStats = getPredictiveEngine().getStats();
  const fewShotStats = getFewShotLearner().getStats();
  const activeStats = getActiveLearner().getStats();

  return {
    predictive: {
      patterns: predictiveStats.intentPatterns,
      sequences: predictiveStats.actionSequences,
      predictions: predictiveStats.totalPredictions,
    },
    fewShot: {
      templates: fewShotStats.totalTemplates,
      demonstrations: fewShotStats.totalDemonstrations,
      successRate: fewShotStats.avgSuccessRate,
    },
    activeLearning: {
      pendingQueries: getActiveLearner().getPendingQueries().length,
      feedbackRecords: activeStats.totalFeedback,
      successRate: activeStats.successRate,
    },
  };
}
