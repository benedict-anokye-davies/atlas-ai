/**
 * Atlas Desktop - Skill Selector
 * Session 043-C: Auto-select skills based on query
 *
 * Provides intelligent skill selection using pattern matching,
 * intent detection, and context analysis.
 */

import type { Skill, SkillContext, SkillMatch } from '../../shared/types/skill';
import { getSkillManager } from './skill-manager';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('skill-selector');

/**
 * Intent detection result
 */
export interface DetectedIntent {
  intent: string;
  confidence: number;
  entities: Record<string, string>;
}

/**
 * Intent patterns for common actions
 */
const INTENT_PATTERNS: Array<{
  intent: string;
  patterns: RegExp[];
  entities?: Array<{ name: string; pattern: RegExp }>;
}> = [
  {
    intent: 'calculate',
    patterns: [
      /^(what is|what's|calculate|compute|how much is)\s+[\d\s+\-*/()%]+/i,
      /\d+\s*(plus|minus|times|divided|multiply|add|subtract)\s+\d+/i,
      /\d+\s*[+\-*/^%]\s*\d+/,
      /(\d+)\s*%\s*(of)\s*(\d+)/i,
    ],
  },
  {
    intent: 'set_timer',
    patterns: [
      /^(set|start|create)\s+(a\s+)?timer/i,
      /timer\s+(for|of)\s+\d+/i,
      /\d+\s*(minute|second|hour|min|sec|hr)s?\s+timer/i,
      /remind me in\s+\d+/i,
    ],
    entities: [{ name: 'duration', pattern: /(\d+)\s*(minute|second|hour|min|sec|hr)s?/i }],
  },
  {
    intent: 'check_timer',
    patterns: [
      /how much time\s+(is )?(left|remaining)/i,
      /(check|status)\s+(of\s+)?(my\s+)?timer/i,
      /timer\s+status/i,
    ],
  },
  {
    intent: 'cancel_timer',
    patterns: [/(cancel|stop|clear|delete)\s+(my\s+)?timer/i, /timer\s+(cancel|stop)/i],
  },
  {
    intent: 'get_weather',
    patterns: [
      /^(what('s| is) the\s+)?weather/i,
      /weather\s+(in|for|at)\s+/i,
      /^(is it|will it)\s+(rain|snow|sunny|cloudy|hot|cold)/i,
      /^do i need\s+(an?\s+)?(umbrella|jacket|coat)/i,
    ],
    entities: [{ name: 'location', pattern: /(?:in|for|at)\s+([a-zA-Z\s,]+?)(?:\?|$)/i }],
  },
  {
    intent: 'get_forecast',
    patterns: [
      /weather\s+forecast/i,
      /forecast\s+(for|in)\s+/i,
      /what('s| is) the\s+forecast/i,
      /weather\s+(this|next)\s+week/i,
    ],
  },
  {
    intent: 'search_web',
    patterns: [
      /^(search|google|look up|find)\s+(for\s+)?/i,
      /^what is\s+/i,
      /^who is\s+/i,
      /^where is\s+/i,
      /^when (was|did|is)\s+/i,
    ],
  },
  {
    intent: 'open_app',
    patterns: [/^(open|launch|start|run)\s+/i],
    entities: [{ name: 'app_name', pattern: /(?:open|launch|start|run)\s+(.+?)(?:\s+app)?$/i }],
  },
  {
    intent: 'file_operation',
    patterns: [
      /^(create|make|new)\s+(a\s+)?file/i,
      /^(read|open|show)\s+(the\s+)?file/i,
      /^(delete|remove)\s+(the\s+)?file/i,
      /^(list|show)\s+(the\s+)?files/i,
    ],
  },
  {
    intent: 'git_operation',
    patterns: [
      /^git\s+(status|add|commit|push|pull|branch|checkout)/i,
      /^(commit|push|pull)\s+(the\s+)?changes/i,
      /^what('s| is) the\s+git status/i,
    ],
  },
];

/**
 * Skill Selector Class
 * Provides intelligent skill selection and intent detection
 */
export class SkillSelector {
  private intentPatterns = INTENT_PATTERNS;

  /**
   * Detect intent from query
   */
  detectIntent(query: string): DetectedIntent | null {
    const queryLower = query.toLowerCase().trim();

    for (const { intent, patterns, entities } of this.intentPatterns) {
      for (const pattern of patterns) {
        if (pattern.test(queryLower)) {
          // Extract entities if defined
          const extractedEntities: Record<string, string> = {};

          if (entities) {
            for (const entity of entities) {
              const match = query.match(entity.pattern);
              if (match && match[1]) {
                extractedEntities[entity.name] = match[1].trim();
              }
            }
          }

          // Calculate confidence based on pattern specificity
          const confidence = this.calculateIntentConfidence(query, pattern);

          logger.debug(`[SkillSelector] Detected intent: ${intent} (confidence: ${confidence})`);

          return {
            intent,
            confidence,
            entities: extractedEntities,
          };
        }
      }
    }

    return null;
  }

  /**
   * Select the best skill for a query
   */
  async selectSkill(query: string): Promise<SkillMatch | null> {
    const skillManager = getSkillManager();

    // Detect intent first
    const detectedIntent = this.detectIntent(query);

    // Create context with detected intent
    const context: SkillContext = {
      query,
      intent: detectedIntent?.intent,
      timestamp: Date.now(),
    };

    // Find matching skills
    const matches = await skillManager.findMatchingSkills(context);

    if (matches.length === 0) {
      logger.debug('[SkillSelector] No matching skills found');
      return null;
    }

    // Return best match
    const bestMatch = matches[0];
    logger.info(
      `[SkillSelector] Selected skill: ${bestMatch.skill.id} (confidence: ${bestMatch.confidence})`
    );

    return bestMatch;
  }

  /**
   * Select and execute the best skill for a query
   */
  async selectAndExecute(
    query: string,
    additionalContext?: Partial<SkillContext>
  ): Promise<{ skill: Skill; result: import('../../shared/types/skill').SkillResult } | null> {
    const skillManager = getSkillManager();

    // Detect intent
    const detectedIntent = this.detectIntent(query);

    // Create full context
    const context: SkillContext = {
      query,
      intent: detectedIntent?.intent,
      timestamp: Date.now(),
      ...additionalContext,
    };

    // Execute for context
    const result = await skillManager.executeForContext(context);

    if (!result) {
      return null;
    }

    // Find which skill was executed
    const matches = await skillManager.findMatchingSkills(context);
    const executedSkill = matches[0]?.skill;

    if (!executedSkill) {
      return null;
    }

    return {
      skill: executedSkill,
      result,
    };
  }

  /**
   * Get skill suggestions for a query (for autocomplete/preview)
   */
  async getSuggestions(
    query: string,
    limit: number = 3
  ): Promise<Array<{ skill: Skill; confidence: number; preview: string }>> {
    const skillManager = getSkillManager();
    const detectedIntent = this.detectIntent(query);

    const context: SkillContext = {
      query,
      intent: detectedIntent?.intent,
      timestamp: Date.now(),
    };

    const matches = await skillManager.findMatchingSkills(context);

    return matches.slice(0, limit).map((match) => ({
      skill: match.skill,
      confidence: match.confidence,
      preview: this.generatePreview(match.skill, query),
    }));
  }

  /**
   * Check if query is likely skill-activating
   */
  isSkillQuery(query: string): boolean {
    const detectedIntent = this.detectIntent(query);

    if (detectedIntent && detectedIntent.confidence > 0.5) {
      return true;
    }

    // Check for common skill trigger patterns
    const skillTriggerPatterns = [
      /^(what|how|when|where|who|why|can you|please|set|start|create|open|show|get|find|search|calculate)/i,
      /\?$/,
      /\d+.*\d+/, // Math-like pattern
      /timer|weather|calculate|search|open|remind/i,
    ];

    return skillTriggerPatterns.some((p) => p.test(query));
  }

  /**
   * Add custom intent pattern
   */
  addIntentPattern(
    intent: string,
    patterns: RegExp[],
    entities?: Array<{ name: string; pattern: RegExp }>
  ): void {
    this.intentPatterns.push({ intent, patterns, entities });
    logger.info(`[SkillSelector] Added custom intent pattern: ${intent}`);
  }

  /**
   * Calculate confidence score for detected intent
   */
  private calculateIntentConfidence(query: string, pattern: RegExp): number {
    // Base confidence
    let confidence = 0.7;

    // Boost confidence if pattern matches at start
    if (pattern.source.startsWith('^')) {
      confidence += 0.1;
    }

    // Boost confidence for longer queries that match
    if (query.length > 20) {
      confidence += 0.05;
    }

    // Boost confidence for question marks
    if (query.endsWith('?')) {
      confidence += 0.05;
    }

    return Math.min(1, confidence);
  }

  /**
   * Generate a preview of what the skill will do
   */
  private generatePreview(skill: Skill, query: string): string {
    // Use example queries from metadata if available
    if (skill.metadata.exampleQueries && skill.metadata.exampleQueries.length > 0) {
      // Find the most similar example query
      const queryLower = query.toLowerCase();
      for (const example of skill.metadata.exampleQueries) {
        if (queryLower.includes(example.toLowerCase().split(' ')[0])) {
          return `Similar to: "${example}"`;
        }
      }
    }

    return skill.metadata.description;
  }
}

// Singleton instance
let skillSelectorInstance: SkillSelector | null = null;

/**
 * Get the global skill selector instance
 */
export function getSkillSelector(): SkillSelector {
  if (!skillSelectorInstance) {
    skillSelectorInstance = new SkillSelector();
  }
  return skillSelectorInstance;
}

/**
 * Reset the skill selector (for testing)
 */
export function resetSkillSelector(): void {
  skillSelectorInstance = null;
}

export default SkillSelector;
