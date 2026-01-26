/**
 * Atlas Desktop - Skill Manager
 * Session 043-A: Skill system architecture
 *
 * Manages skill registration, activation, and execution.
 * Skills are higher-level abstractions that group related tools
 * and provide context-aware activation.
 */

import { EventEmitter } from 'events';
import type {
  Skill,
  SkillConfig,
  SkillContext,
  SkillResult,
  SkillRegistration,
  SkillMatch,
  SkillManagerEvent,
  SkillManagerEventPayloads,
  SkillCategory,
  SkillTrigger,
} from '../../shared/types/skill';
import { createModuleLogger } from '../utils/logger';
import { getErrorMessage } from '../../shared/utils';

const logger = createModuleLogger('skill-manager');

/**
 * Skill Manager configuration
 */
export interface SkillManagerConfig {
  /** Maximum skills that can be active at once */
  maxActiveSkills?: number;

  /** Default timeout for skill execution (ms) */
  defaultTimeout?: number;

  /** Whether to auto-activate skills on registration */
  autoActivate?: boolean;

  /** Minimum confidence threshold for skill matching */
  minConfidenceThreshold?: number;

  /** Enable skill execution logging */
  enableLogging?: boolean;

  /** Enable skill metrics collection */
  enableMetrics?: boolean;
}

/**
 * Default manager configuration
 */
const DEFAULT_MANAGER_CONFIG: Required<SkillManagerConfig> = {
  maxActiveSkills: 20,
  defaultTimeout: 30000,
  autoActivate: true,
  minConfidenceThreshold: 0.3,
  enableLogging: true,
  enableMetrics: true,
};

/**
 * Skill execution metrics
 */
interface SkillMetrics {
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  averageExecutionTime: number;
  lastExecutionTime: number;
  lastExecutedAt?: number;
}

/**
 * SkillManager Class
 * Central manager for all skills in the system
 */
export class SkillManager extends EventEmitter {
  private skills: Map<string, SkillRegistration> = new Map();
  private metrics: Map<string, SkillMetrics> = new Map();
  private config: Required<SkillManagerConfig>;
  private initialized = false;

  constructor(config?: SkillManagerConfig) {
    super();
    this.config = { ...DEFAULT_MANAGER_CONFIG, ...config };
    logger.info('[SkillManager] Created with config:', this.config);
  }

  /**
   * Initialize the skill manager
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      logger.warn('[SkillManager] Already initialized');
      return;
    }

    logger.info('[SkillManager] Initializing...');
    this.initialized = true;
    logger.info('[SkillManager] Initialized successfully');
  }

  /**
   * Register a skill
   */
  async registerSkill(skill: Skill, config?: SkillConfig): Promise<void> {
    if (this.skills.has(skill.id)) {
      throw new Error(`Skill '${skill.id}' is already registered`);
    }

    logger.info(`[SkillManager] Registering skill: ${skill.id}`);

    // Initialize skill if it has an initialize method
    if (skill.initialize) {
      try {
        await skill.initialize(config);
      } catch (error) {
        logger.error(`[SkillManager] Failed to initialize skill '${skill.id}':`, error);
        throw error;
      }
    }

    // Create registration entry
    const registration: SkillRegistration = {
      skill,
      registeredAt: Date.now(),
      enabled: true,
      userConfig: config,
      executionCount: 0,
    };

    this.skills.set(skill.id, registration);

    // Initialize metrics
    this.metrics.set(skill.id, {
      totalExecutions: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
      averageExecutionTime: 0,
      lastExecutionTime: 0,
    });

    // Auto-activate if configured
    if (this.config.autoActivate) {
      await this.activateSkill(skill.id);
    }

    this.emitEvent('skill-registered', {
      skillId: skill.id,
      metadata: skill.metadata,
    });

    logger.info(`[SkillManager] Skill '${skill.id}' registered successfully`);
  }

  /**
   * Unregister a skill
   */
  async unregisterSkill(skillId: string): Promise<void> {
    const registration = this.skills.get(skillId);
    if (!registration) {
      throw new Error(`Skill '${skillId}' is not registered`);
    }

    logger.info(`[SkillManager] Unregistering skill: ${skillId}`);

    // Deactivate if active
    if (registration.skill.state === 'active') {
      await this.deactivateSkill(skillId);
    }

    // Cleanup skill resources
    if (registration.skill.cleanup) {
      try {
        await registration.skill.cleanup();
      } catch (error) {
        logger.error(`[SkillManager] Failed to cleanup skill '${skillId}':`, error);
      }
    }

    this.skills.delete(skillId);
    this.metrics.delete(skillId);

    this.emitEvent('skill-unregistered', { skillId });

    logger.info(`[SkillManager] Skill '${skillId}' unregistered`);
  }

  /**
   * Activate a skill
   */
  async activateSkill(skillId: string): Promise<void> {
    const registration = this.skills.get(skillId);
    if (!registration) {
      throw new Error(`Skill '${skillId}' is not registered`);
    }

    if (registration.skill.state === 'active') {
      logger.debug(`[SkillManager] Skill '${skillId}' is already active`);
      return;
    }

    logger.info(`[SkillManager] Activating skill: ${skillId}`);

    // Check active skill limit
    const activeCount = this.getActiveSkills().length;
    if (activeCount >= this.config.maxActiveSkills) {
      throw new Error(`Maximum active skills (${this.config.maxActiveSkills}) reached`);
    }

    // Update state
    registration.skill.state = 'activating';

    try {
      if (registration.skill.activate) {
        await registration.skill.activate();
      }
      registration.skill.state = 'active';
      registration.error = undefined;

      this.emitEvent('skill-activated', { skillId });
      logger.info(`[SkillManager] Skill '${skillId}' activated`);
    } catch (error) {
      registration.skill.state = 'error';
      registration.error = getErrorMessage(error);
      logger.error(`[SkillManager] Failed to activate skill '${skillId}':`, error);
      throw error;
    }
  }

  /**
   * Deactivate a skill
   */
  async deactivateSkill(skillId: string): Promise<void> {
    const registration = this.skills.get(skillId);
    if (!registration) {
      throw new Error(`Skill '${skillId}' is not registered`);
    }

    if (registration.skill.state !== 'active') {
      logger.debug(`[SkillManager] Skill '${skillId}' is not active`);
      return;
    }

    logger.info(`[SkillManager] Deactivating skill: ${skillId}`);

    registration.skill.state = 'deactivating';

    try {
      if (registration.skill.deactivate) {
        await registration.skill.deactivate();
      }
      registration.skill.state = 'installed';

      this.emitEvent('skill-deactivated', { skillId });
      logger.info(`[SkillManager] Skill '${skillId}' deactivated`);
    } catch (error) {
      registration.skill.state = 'error';
      registration.error = getErrorMessage(error);
      logger.error(`[SkillManager] Failed to deactivate skill '${skillId}':`, error);
      throw error;
    }
  }

  /**
   * Enable/disable a skill
   */
  setSkillEnabled(skillId: string, enabled: boolean): void {
    const registration = this.skills.get(skillId);
    if (!registration) {
      throw new Error(`Skill '${skillId}' is not registered`);
    }

    registration.enabled = enabled;
    logger.info(`[SkillManager] Skill '${skillId}' ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Find skills that match the given context
   */
  async findMatchingSkills(context: SkillContext): Promise<SkillMatch[]> {
    const matches: SkillMatch[] = [];

    for (const [skillId, registration] of this.skills) {
      // Skip disabled skills
      if (!registration.enabled) continue;

      // Skip non-active skills
      if (registration.skill.state !== 'active') continue;

      try {
        const confidence = await registration.skill.shouldHandle(context);

        if (confidence >= this.config.minConfidenceThreshold) {
          // Find which trigger matched
          const matchedTrigger = this.findMatchedTrigger(registration.skill, context);

          matches.push({
            skill: registration.skill,
            confidence,
            matchedTrigger,
            matchedKeywords:
              matchedTrigger?.type === 'keyword'
                ? this.findMatchedKeywords(matchedTrigger.keywords || [], context.query)
                : undefined,
          });
        }
      } catch (error) {
        logger.error(`[SkillManager] Error checking skill '${skillId}':`, error);
      }
    }

    // Sort by confidence (highest first)
    matches.sort((a, b) => b.confidence - a.confidence);

    return matches;
  }

  /**
   * Execute the best matching skill for the context
   */
  async executeForContext(context: SkillContext): Promise<SkillResult | null> {
    const matches = await this.findMatchingSkills(context);

    if (matches.length === 0) {
      logger.debug('[SkillManager] No matching skills found for context');
      return null;
    }

    // Execute the highest confidence match
    const bestMatch = matches[0];
    logger.info(
      `[SkillManager] Best matching skill: ${bestMatch.skill.id} (confidence: ${bestMatch.confidence})`
    );

    return this.executeSkill(bestMatch.skill.id, context);
  }

  /**
   * Execute a specific skill
   */
  async executeSkill(skillId: string, context: SkillContext): Promise<SkillResult> {
    const registration = this.skills.get(skillId);
    if (!registration) {
      throw new Error(`Skill '${skillId}' is not registered`);
    }

    if (!registration.enabled) {
      throw new Error(`Skill '${skillId}' is disabled`);
    }

    if (registration.skill.state !== 'active') {
      throw new Error(`Skill '${skillId}' is not active`);
    }

    const startTime = Date.now();

    logger.info(`[SkillManager] Executing skill: ${skillId}`);

    try {
      // Execute with timeout
      const timeout = registration.userConfig?.timeout ?? this.config.defaultTimeout;
      const result = await this.executeWithTimeout(
        registration.skill.execute(context),
        timeout,
        skillId
      );

      const executionTime = Date.now() - startTime;

      // Update registration
      registration.lastExecuted = Date.now();
      registration.executionCount = (registration.executionCount || 0) + 1;

      // Update metrics
      this.updateMetrics(skillId, true, executionTime);

      // Emit event
      this.emitEvent('skill-executed', {
        skillId,
        result,
        executionTime,
      });

      logger.info(`[SkillManager] Skill '${skillId}' executed in ${executionTime}ms`);

      return {
        ...result,
        executionTime,
      };
    } catch (error) {
      const executionTime = Date.now() - startTime;

      // Update metrics
      this.updateMetrics(skillId, false, executionTime);

      const errorMessage = getErrorMessage(error);

      this.emitEvent('skill-error', {
        skillId,
        error: errorMessage,
      });

      logger.error(`[SkillManager] Skill '${skillId}' execution failed:`, error);

      return {
        success: false,
        error: errorMessage,
        executionTime,
      };
    }
  }

  /**
   * Update skill configuration
   */
  async updateSkillConfig(skillId: string, config: Partial<SkillConfig>): Promise<void> {
    const registration = this.skills.get(skillId);
    if (!registration) {
      throw new Error(`Skill '${skillId}' is not registered`);
    }

    const newConfig = {
      ...registration.userConfig,
      ...config,
    };

    registration.userConfig = newConfig;

    if (registration.skill.updateConfig) {
      await registration.skill.updateConfig(config);
    }

    this.emitEvent('skill-config-changed', {
      skillId,
      config: newConfig,
    });

    logger.info(`[SkillManager] Skill '${skillId}' config updated`);
  }

  /**
   * Get all registered skills
   */
  getSkills(): Skill[] {
    return Array.from(this.skills.values()).map((r) => r.skill);
  }

  /**
   * Get all active skills
   */
  getActiveSkills(): Skill[] {
    return Array.from(this.skills.values())
      .filter((r) => r.skill.state === 'active' && r.enabled)
      .map((r) => r.skill);
  }

  /**
   * Get skills by category
   */
  getSkillsByCategory(category: SkillCategory): Skill[] {
    return Array.from(this.skills.values())
      .filter((r) => r.skill.metadata.category === category)
      .map((r) => r.skill);
  }

  /**
   * Get a skill by ID
   */
  getSkill(skillId: string): Skill | undefined {
    return this.skills.get(skillId)?.skill;
  }

  /**
   * Get skill registration
   */
  getSkillRegistration(skillId: string): SkillRegistration | undefined {
    return this.skills.get(skillId);
  }

  /**
   * Get skill metrics
   */
  getSkillMetrics(skillId: string): SkillMetrics | undefined {
    return this.metrics.get(skillId);
  }

  /**
   * Get all skill metrics
   */
  getAllMetrics(): Map<string, SkillMetrics> {
    return new Map(this.metrics);
  }

  /**
   * Get manager configuration
   */
  getConfig(): Required<SkillManagerConfig> {
    return { ...this.config };
  }

  /**
   * Update manager configuration
   */
  updateConfig(config: Partial<SkillManagerConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('[SkillManager] Config updated:', this.config);
  }

  /**
   * Check if manager is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Shutdown the skill manager
   */
  async shutdown(): Promise<void> {
    logger.info('[SkillManager] Shutting down...');

    // Deactivate all active skills
    for (const [skillId, registration] of this.skills) {
      if (registration.skill.state === 'active') {
        try {
          await this.deactivateSkill(skillId);
        } catch (error) {
          logger.error(
            `[SkillManager] Error deactivating skill '${skillId}' during shutdown:`,
            error
          );
        }
      }
    }

    // Clear all registrations
    this.skills.clear();
    this.metrics.clear();
    this.initialized = false;

    logger.info('[SkillManager] Shutdown complete');
  }

  // Private helper methods

  private async executeWithTimeout<T>(
    promise: Promise<T>,
    timeout: number,
    skillId: string
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Skill '${skillId}' execution timed out after ${timeout}ms`));
      }, timeout);

      promise
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  private findMatchedTrigger(skill: Skill, context: SkillContext): SkillTrigger | undefined {
    for (const trigger of skill.triggers) {
      if (trigger.type === 'keyword' && trigger.keywords) {
        const queryLower = context.query.toLowerCase();
        if (trigger.keywords.some((kw) => queryLower.includes(kw.toLowerCase()))) {
          return trigger;
        }
      }

      if (trigger.type === 'intent' && context.intent && trigger.intents) {
        if (trigger.intents.includes(context.intent)) {
          return trigger;
        }
      }

      if (trigger.type === 'always') {
        return trigger;
      }
    }

    return undefined;
  }

  private findMatchedKeywords(keywords: string[], query: string): string[] {
    const queryLower = query.toLowerCase();
    return keywords.filter((kw) => queryLower.includes(kw.toLowerCase()));
  }

  private updateMetrics(skillId: string, success: boolean, executionTime: number): void {
    const metrics = this.metrics.get(skillId);
    if (!metrics) return;

    metrics.totalExecutions++;
    if (success) {
      metrics.successfulExecutions++;
    } else {
      metrics.failedExecutions++;
    }

    // Update average execution time
    metrics.averageExecutionTime =
      (metrics.averageExecutionTime * (metrics.totalExecutions - 1) + executionTime) /
      metrics.totalExecutions;

    metrics.lastExecutionTime = executionTime;
    metrics.lastExecutedAt = Date.now();
  }

  private emitEvent<E extends SkillManagerEvent>(
    event: E,
    payload: SkillManagerEventPayloads[E]
  ): void {
    this.emit(event, payload);
  }
}

// Singleton instance
let skillManagerInstance: SkillManager | null = null;

/**
 * Get the global skill manager instance
 */
export function getSkillManager(config?: SkillManagerConfig): SkillManager {
  if (!skillManagerInstance) {
    skillManagerInstance = new SkillManager(config);
  }
  return skillManagerInstance;
}

/**
 * Shutdown the global skill manager
 */
export async function shutdownSkillManager(): Promise<void> {
  if (skillManagerInstance) {
    await skillManagerInstance.shutdown();
    skillManagerInstance = null;
  }
}

/**
 * Reset the skill manager (for testing)
 */
export async function resetSkillManager(): Promise<void> {
  await shutdownSkillManager();
}

export default SkillManager;
