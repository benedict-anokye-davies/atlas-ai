/**
 * Atlas Desktop - Base Skill Class
 * Session 043-A: Skill system architecture
 *
 * Abstract base class that provides common functionality for skills.
 * Extend this class to create new skills easily.
 */

import type {
  Skill,
  SkillConfig,
  SkillContext,
  SkillResult,
  SkillMetadata,
  SkillTrigger,
  SkillCapabilities,
  SkillState,
} from '../../../shared/types/skill';
import type { AgentTool } from '../../../shared/types/agent';
import { createModuleLogger } from '../../utils/logger';

const logger = createModuleLogger('base-skill');

/**
 * Base Skill Class
 * Provides common functionality and structure for implementing skills
 */
export abstract class BaseSkill implements Skill {
  abstract readonly id: string;
  abstract readonly metadata: SkillMetadata;
  abstract readonly triggers: SkillTrigger[];
  abstract readonly capabilities: SkillCapabilities;

  protected config: SkillConfig = {
    settings: {},
    features: {},
    timeout: 30000,
    maxRetries: 2,
  };

  private _state: SkillState = 'installed';
  private _tools: AgentTool[] = [];

  /**
   * Current skill state
   */
  get state(): SkillState {
    return this._state;
  }

  set state(value: SkillState) {
    this._state = value;
  }

  /**
   * Tools provided by this skill
   */
  get tools(): AgentTool[] {
    return this._tools;
  }

  /**
   * Initialize the skill
   * Override in subclass if needed
   */
  async initialize(config?: SkillConfig): Promise<void> {
    logger.info(`[${this.id}] Initializing skill`);

    if (config) {
      this.config = { ...this.config, ...config };
    }

    // Register any tools
    this._tools = this.registerTools();

    logger.info(`[${this.id}] Skill initialized with ${this._tools.length} tools`);
  }

  /**
   * Activate the skill
   * Override in subclass if needed
   */
  async activate(): Promise<void> {
    logger.info(`[${this.id}] Activating skill`);
    this._state = 'active';
  }

  /**
   * Deactivate the skill
   * Override in subclass if needed
   */
  async deactivate(): Promise<void> {
    logger.info(`[${this.id}] Deactivating skill`);
    this._state = 'installed';
  }

  /**
   * Cleanup skill resources
   * Override in subclass if needed
   */
  async cleanup(): Promise<void> {
    logger.info(`[${this.id}] Cleaning up skill`);
    this._tools = [];
  }

  /**
   * Check if this skill should handle the given context
   * Returns a confidence score 0-1
   * Override in subclass to implement custom matching logic
   */
  async shouldHandle(context: SkillContext): Promise<number> {
    const query = context.query.toLowerCase();

    // Check keyword triggers
    for (const trigger of this.triggers) {
      if (trigger.type === 'keyword' && trigger.keywords) {
        const matchedKeywords = trigger.keywords.filter((kw) => query.includes(kw.toLowerCase()));

        if (matchedKeywords.length > 0) {
          // Score based on number of matched keywords
          const score = Math.min(1, 0.3 + matchedKeywords.length * 0.2);
          return score * (trigger.priority ?? 1);
        }
      }

      if (trigger.type === 'intent' && context.intent && trigger.intents) {
        if (trigger.intents.includes(context.intent)) {
          return 0.8 * (trigger.priority ?? 1);
        }
      }

      if (trigger.type === 'always') {
        return 0.5 * (trigger.priority ?? 0.5);
      }
    }

    return 0;
  }

  /**
   * Execute the skill
   * Must be implemented by subclass
   */
  abstract execute(context: SkillContext): Promise<SkillResult>;

  /**
   * Get current configuration
   */
  getConfig(): SkillConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  async updateConfig(config: Partial<SkillConfig>): Promise<void> {
    this.config = {
      ...this.config,
      ...config,
      settings: { ...this.config.settings, ...config.settings },
      features: { ...this.config.features, ...config.features },
    };
    logger.info(`[${this.id}] Config updated`);
  }

  /**
   * Register tools for this skill
   * Override in subclass to provide skill-specific tools
   */
  protected registerTools(): AgentTool[] {
    return [];
  }

  /**
   * Helper to create a successful result
   */
  protected success(data: unknown, response?: string): SkillResult {
    return {
      success: true,
      data,
      response,
    };
  }

  /**
   * Helper to create a failed result
   */
  protected failure(error: string): SkillResult {
    return {
      success: false,
      error,
    };
  }

  /**
   * Helper to extract keywords from query
   */
  protected extractKeywords(query: string, keywords: string[]): string[] {
    const queryLower = query.toLowerCase();
    return keywords.filter((kw) => queryLower.includes(kw.toLowerCase()));
  }

  /**
   * Helper to check if query contains any of the keywords
   */
  protected containsAny(query: string, keywords: string[]): boolean {
    const queryLower = query.toLowerCase();
    return keywords.some((kw) => queryLower.includes(kw.toLowerCase()));
  }

  /**
   * Helper to check if query contains all of the keywords
   */
  protected containsAll(query: string, keywords: string[]): boolean {
    const queryLower = query.toLowerCase();
    return keywords.every((kw) => queryLower.includes(kw.toLowerCase()));
  }
}

export default BaseSkill;
