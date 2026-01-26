/**
 * Atlas Desktop - Skill Integration
 * Session 043-C: Integrate skills with agent system
 *
 * Connects the skill system with the agent and LLM for
 * intelligent skill execution during conversations.
 */

import type { Skill, SkillContext, SkillResult } from '../../shared/types/skill';
import { getSkillManager, SkillManager } from './skill-manager';
import { getSkillSelector, SkillSelector } from './skill-selector';
import { getBuiltInSkills } from './skills';
// Note: getAgent can be imported when needed for agent integration
// import { getAgent } from './index';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('skill-integration');

/**
 * Skill execution result for agent
 */
export interface SkillExecutionResult {
  /** Whether a skill was executed */
  handled: boolean;

  /** The skill that was executed (if any) */
  skill?: Skill;

  /** The result of the skill execution */
  result?: SkillResult;

  /** Human-readable response */
  response?: string;

  /** Whether to continue with LLM processing */
  continueWithLLM: boolean;
}

/**
 * Initialize the skill system
 * Call this during app startup
 */
export async function initializeSkillSystem(): Promise<void> {
  logger.info('[SkillIntegration] Initializing skill system...');

  const skillManager = getSkillManager();

  // Initialize the manager
  await skillManager.initialize();

  // Register built-in skills
  const builtInSkills = getBuiltInSkills();

  for (const skill of builtInSkills) {
    try {
      await skillManager.registerSkill(skill);
      logger.info(`[SkillIntegration] Registered skill: ${skill.id}`);
    } catch (error) {
      logger.error(`[SkillIntegration] Failed to register skill ${skill.id}:`, error);
    }
  }

  logger.info(
    `[SkillIntegration] Skill system initialized with ${skillManager.getSkills().length} skills`
  );
}

/**
 * Process a user query through the skill system
 * Returns the result if a skill handled it, or null if no skill matched
 */
export async function processWithSkills(
  query: string,
  context?: Partial<SkillContext>
): Promise<SkillExecutionResult> {
  const selector = getSkillSelector();
  const manager = getSkillManager();

  // Check if this is likely a skill-activating query
  if (!selector.isSkillQuery(query)) {
    logger.debug('[SkillIntegration] Query does not appear to be skill-related');
    return {
      handled: false,
      continueWithLLM: true,
    };
  }

  // Create full context
  const fullContext: SkillContext = {
    query,
    timestamp: Date.now(),
    ...context,
  };

  // Detect intent
  const detectedIntent = selector.detectIntent(query);
  if (detectedIntent) {
    fullContext.intent = detectedIntent.intent;
    logger.debug(
      `[SkillIntegration] Detected intent: ${detectedIntent.intent} (${detectedIntent.confidence})`
    );
  }

  // Try to execute with skills
  const result = await manager.executeForContext(fullContext);

  if (!result) {
    logger.debug('[SkillIntegration] No skill matched the query');
    return {
      handled: false,
      continueWithLLM: true,
    };
  }

  // Find which skill was executed
  const matches = await manager.findMatchingSkills(fullContext);
  const executedSkill = matches[0]?.skill;

  logger.info(
    `[SkillIntegration] Skill ${executedSkill?.id} handled query with success=${result.success}`
  );

  return {
    handled: true,
    skill: executedSkill,
    result,
    response: result.response,
    continueWithLLM: result.continueInContext ?? false,
  };
}

/**
 * Get available skills for a query (for UI suggestions)
 */
export async function getAvailableSkills(
  query: string
): Promise<Array<{ skill: Skill; confidence: number }>> {
  const selector = getSkillSelector();
  const suggestions = await selector.getSuggestions(query);

  return suggestions.map((s) => ({
    skill: s.skill,
    confidence: s.confidence,
  }));
}

/**
 * Execute a specific skill by ID
 */
export async function executeSkillById(
  skillId: string,
  query: string,
  context?: Partial<SkillContext>
): Promise<SkillResult | null> {
  const manager = getSkillManager();
  const skill = manager.getSkill(skillId);

  if (!skill) {
    logger.warn(`[SkillIntegration] Skill not found: ${skillId}`);
    return null;
  }

  const fullContext: SkillContext = {
    query,
    timestamp: Date.now(),
    ...context,
  };

  return manager.executeSkill(skillId, fullContext);
}

/**
 * Get all registered skills
 */
export function getAllSkills(): Skill[] {
  return getSkillManager().getSkills();
}

/**
 * Get active skills
 */
export function getActiveSkills(): Skill[] {
  return getSkillManager().getActiveSkills();
}

/**
 * Enable or disable a skill
 */
export function setSkillEnabled(skillId: string, enabled: boolean): void {
  getSkillManager().setSkillEnabled(skillId, enabled);
}

/**
 * Get skill manager instance
 */
export function getSkillManagerInstance(): SkillManager {
  return getSkillManager();
}

/**
 * Get skill selector instance
 */
export function getSkillSelectorInstance(): SkillSelector {
  return getSkillSelector();
}

/**
 * Shutdown the skill system
 */
export async function shutdownSkillSystem(): Promise<void> {
  logger.info('[SkillIntegration] Shutting down skill system...');
  await getSkillManager().shutdown();
  logger.info('[SkillIntegration] Skill system shut down');
}

/**
 * Skill system events
 */
export const SkillEvents = {
  /** Subscribe to skill events */
  subscribe(
    event:
      | 'skill-registered'
      | 'skill-executed'
      | 'skill-error'
      | 'skill-activated'
      | 'skill-deactivated',
    callback: (data: unknown) => void
  ): () => void {
    const manager = getSkillManager();
    manager.on(event, callback);
    return () => manager.off(event, callback);
  },
};

export default {
  initializeSkillSystem,
  processWithSkills,
  getAvailableSkills,
  executeSkillById,
  getAllSkills,
  getActiveSkills,
  setSkillEnabled,
  shutdownSkillSystem,
  SkillEvents,
};
