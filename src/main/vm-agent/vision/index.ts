/**
 * Atlas Desktop - VM Agent Vision Module Index
 *
 * Exports all vision intelligence components for VM agent.
 *
 * @module vm-agent/vision
 */

// =============================================================================
// VLM Analyzer
// =============================================================================
export {
  VLM_ANALYZER_CONSTANTS,
  VLMAnalyzer,
  getVLMAnalyzer,
  resetVLMAnalyzer,
} from './vlm-analyzer';

// =============================================================================
// Visual Memory
// =============================================================================
export {
  VISUAL_MEMORY_CONSTANTS,
  VisualSnapshot,
  VisualPattern,
  LayoutHash,
  VisualMemoryManager,
  getVisualMemory,
  resetVisualMemory,
} from './visual-memory';

// =============================================================================
// Self-Healing Selectors
// =============================================================================
export {
  SELF_HEALING_CONSTANTS,
  SelectorCandidate,
  HealingAttempt,
  ElementProfile,
  SelfHealingSelectorsManager,
  getSelfHealingSelectors,
  resetSelfHealingSelectors,
} from './self-healing-selectors';

// =============================================================================
// Enhanced Screen Understanding
// =============================================================================
export {
  ENHANCED_SCREEN_CONSTANTS,
  ScreenUnderstanding,
  ApplicationContext,
  InteractionMap,
  ScreenLayout,
  ScreenRegion,
  ElementQuery,
  EnhancedScreenManager,
  getEnhancedScreen,
  resetEnhancedScreen,
} from './enhanced-screen';

// =============================================================================
// Vision Module Types (Re-exported from core)
// =============================================================================
export type {
  VLMAnalysisRequest,
  VLMAnalysisResult,
  EnhancedUIElement,
  ElementSelector,
  ElementSignature,
  SelectorStrategy,
  SelectorMatchResult,
  ElementHealing,
} from '../core/types';

// =============================================================================
// Module Initialization
// =============================================================================

import { createModuleLogger } from '../../utils/logger';
import { getVLMAnalyzer } from './vlm-analyzer';
import { getVisualMemory } from './visual-memory';
import { getSelfHealingSelectors } from './self-healing-selectors';
import { getEnhancedScreen } from './enhanced-screen';

const logger = createModuleLogger('VisionModule');

/**
 * Initialize all vision components
 */
export async function initializeVision(): Promise<void> {
  logger.info('Initializing vision module...');

  try {
    // Initialize components
    const vlm = getVLMAnalyzer();
    await vlm.initialize();

    const memory = getVisualMemory();
    await memory.initialize();

    const selectors = getSelfHealingSelectors();
    await selectors.initialize();

    // Enhanced screen doesn't need explicit init
    getEnhancedScreen();

    logger.info('Vision module initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize vision module', { error });
    throw error;
  }
}

/**
 * Reset all vision components (for testing)
 */
export function resetVision(): void {
  resetVLMAnalyzer();
  resetVisualMemory();
  resetSelfHealingSelectors();
  resetEnhancedScreen();
  logger.info('Vision module reset');
}

/**
 * Get vision module status
 */
export function getVisionStatus(): {
  vlm: { initialized: boolean; stats: ReturnType<typeof getVLMAnalyzer>['getStats'] };
  memory: { initialized: boolean; stats: ReturnType<typeof getVisualMemory>['getStats'] };
  selectors: { initialized: boolean; stats: ReturnType<typeof getSelfHealingSelectors>['getStats'] };
  screen: { cacheSize: number };
} {
  const vlm = getVLMAnalyzer();
  const memory = getVisualMemory();
  const selectors = getSelfHealingSelectors();
  const screen = getEnhancedScreen();

  return {
    vlm: {
      initialized: true,
      stats: vlm.getStats(),
    },
    memory: {
      initialized: true,
      stats: memory.getStats(),
    },
    selectors: {
      initialized: true,
      stats: selectors.getStats(),
    },
    screen: {
      cacheSize: screen.getStats().cacheSize,
    },
  };
}
