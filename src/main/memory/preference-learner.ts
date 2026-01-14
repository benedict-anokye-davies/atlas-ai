/**
 * Nova Desktop - Preference Learner
 * Extracts and learns user preferences from conversations
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import { getMemoryManager, MemoryManager } from './index';

const logger = createModuleLogger('PreferenceLearner');

/**
 * Types of preferences Nova can learn
 */
export type PreferenceType =
  | 'likes' // Things user likes
  | 'dislikes' // Things user dislikes
  | 'preference' // General preferences (A over B)
  | 'habit' // User habits (I always/usually/never)
  | 'fact' // Personal facts (name, location, job)
  | 'style' // Communication style preferences
  | 'schedule' // Time-related preferences
  | 'restriction'; // Dietary, accessibility, etc.

/**
 * Confidence levels for extracted preferences
 */
export type ConfidenceLevel = 'high' | 'medium' | 'low';

/**
 * A learned preference
 */
export interface LearnedPreference {
  /** Unique identifier */
  id: string;
  /** Type of preference */
  type: PreferenceType;
  /** Subject of the preference */
  subject: string;
  /** Value/detail of the preference */
  value: string;
  /** Original text that led to this preference */
  sourceText: string;
  /** Confidence in this extraction */
  confidence: ConfidenceLevel;
  /** Confidence score (0-1) */
  confidenceScore: number;
  /** When it was learned */
  learnedAt: number;
  /** Number of times confirmed */
  confirmations: number;
  /** Category for grouping */
  category?: string;
}

/**
 * Extraction pattern configuration
 */
interface ExtractionPattern {
  pattern: RegExp;
  type: PreferenceType;
  extractSubject: (match: RegExpMatchArray) => string;
  extractValue: (match: RegExpMatchArray) => string;
  confidence: ConfidenceLevel;
  category?: string;
}

/**
 * Extraction patterns for different preference types
 */
const EXTRACTION_PATTERNS: ExtractionPattern[] = [
  // Likes - "I like X", "I love X", "I enjoy X"
  {
    pattern: /\bi\s+(?:really\s+)?(?:like|love|enjoy|adore)\s+(?:to\s+)?(.+?)(?:\.|,|!|\?|$)/gi,
    type: 'likes',
    extractSubject: (m) => m[1].trim(),
    extractValue: (m) => `likes ${m[1].trim()}`,
    confidence: 'high',
  },

  // Dislikes - "I don't like X", "I hate X", "I can't stand X"
  {
    pattern: /\bi\s+(?:don't|do not|dont)\s+(?:really\s+)?(?:like|enjoy)\s+(.+?)(?:\.|,|!|\?|$)/gi,
    type: 'dislikes',
    extractSubject: (m) => m[1].trim(),
    extractValue: (m) => `dislikes ${m[1].trim()}`,
    confidence: 'high',
  },
  {
    pattern: /\bi\s+(?:hate|dislike|can't stand|cannot stand)\s+(.+?)(?:\.|,|!|\?|$)/gi,
    type: 'dislikes',
    extractSubject: (m) => m[1].trim(),
    extractValue: (m) => `strongly dislikes ${m[1].trim()}`,
    confidence: 'high',
  },

  // Preferences - "I prefer X over Y", "I'd rather X"
  {
    pattern: /\bi\s+prefer\s+(.+?)\s+(?:over|to|than)\s+(.+?)(?:\.|,|!|\?|$)/gi,
    type: 'preference',
    extractSubject: (m) => m[1].trim(),
    extractValue: (m) => `prefers ${m[1].trim()} over ${m[2].trim()}`,
    confidence: 'high',
  },
  {
    pattern: /\bi(?:'d| would)\s+rather\s+(.+?)(?:\.|,|!|\?|$)/gi,
    type: 'preference',
    extractSubject: (m) => m[1].trim(),
    extractValue: (m) => `prefers ${m[1].trim()}`,
    confidence: 'medium',
  },

  // Habits - "I always X", "I usually X", "I never X"
  {
    pattern: /\bi\s+always\s+(.+?)(?:\.|,|!|\?|$)/gi,
    type: 'habit',
    extractSubject: (m) => m[1].trim(),
    extractValue: (m) => `always ${m[1].trim()}`,
    confidence: 'high',
  },
  {
    pattern: /\bi\s+(?:usually|normally|typically)\s+(.+?)(?:\.|,|!|\?|$)/gi,
    type: 'habit',
    extractSubject: (m) => m[1].trim(),
    extractValue: (m) => `usually ${m[1].trim()}`,
    confidence: 'medium',
  },
  {
    pattern: /\bi\s+never\s+(.+?)(?:\.|,|!|\?|$)/gi,
    type: 'habit',
    extractSubject: (m) => m[1].trim(),
    extractValue: (m) => `never ${m[1].trim()}`,
    confidence: 'high',
  },

  // Personal facts - "My name is X", "I'm X years old", "I live in X"
  {
    pattern: /\bmy\s+name\s+is\s+(\w+)/gi,
    type: 'fact',
    extractSubject: () => 'name',
    extractValue: (m) => m[1].trim(),
    confidence: 'high',
    category: 'identity',
  },
  {
    pattern: /\bi(?:'m| am)\s+(\d+)\s+(?:years?\s+old|yo)/gi,
    type: 'fact',
    extractSubject: () => 'age',
    extractValue: (m) => m[1],
    confidence: 'high',
    category: 'identity',
  },
  {
    pattern: /\bi\s+live\s+in\s+(.+?)(?:\.|,|!|\?|$)/gi,
    type: 'fact',
    extractSubject: () => 'location',
    extractValue: (m) => m[1].trim(),
    confidence: 'high',
    category: 'location',
  },
  {
    pattern: /\bi(?:'m| am)\s+(?:a|an)\s+(.+?)(?:\.|,|!|\?|$)/gi,
    type: 'fact',
    extractSubject: () => 'occupation/role',
    extractValue: (m) => m[1].trim(),
    confidence: 'medium',
    category: 'occupation',
  },
  {
    pattern: /\bi\s+work\s+(?:at|for)\s+(.+?)(?:\.|,|!|\?|$)/gi,
    type: 'fact',
    extractSubject: () => 'workplace',
    extractValue: (m) => m[1].trim(),
    confidence: 'high',
    category: 'occupation',
  },
  {
    pattern: /\bmy\s+(?:birthday|bday)\s+is\s+(?:on\s+)?(.+?)(?:\.|,|!|\?|$)/gi,
    type: 'fact',
    extractSubject: () => 'birthday',
    extractValue: (m) => m[1].trim(),
    confidence: 'high',
    category: 'identity',
  },

  // Favorites - "My favorite X is Y"
  {
    pattern: /\bmy\s+favorite\s+(\w+)\s+is\s+(.+?)(?:\.|,|!|\?|$)/gi,
    type: 'likes',
    extractSubject: (m) => `favorite ${m[1].trim()}`,
    extractValue: (m) => m[2].trim(),
    confidence: 'high',
  },

  // Communication style - "Please call me X", "I prefer formal/casual"
  {
    pattern: /\b(?:please\s+)?call\s+me\s+(\w+)/gi,
    type: 'style',
    extractSubject: () => 'preferred name',
    extractValue: (m) => m[1].trim(),
    confidence: 'high',
    category: 'communication',
  },
  {
    pattern: /\bi\s+prefer\s+(formal|casual|brief|detailed)\s+(?:responses?|communication)?/gi,
    type: 'style',
    extractSubject: () => 'communication style',
    extractValue: (m) => m[1].trim(),
    confidence: 'high',
    category: 'communication',
  },

  // Schedule preferences - "I wake up at X", "I work from X to Y"
  {
    pattern: /\bi\s+(?:wake\s+up|get\s+up)\s+(?:at\s+)?(\d+(?::\d+)?(?:\s*(?:am|pm))?)/gi,
    type: 'schedule',
    extractSubject: () => 'wake time',
    extractValue: (m) => m[1].trim(),
    confidence: 'medium',
    category: 'schedule',
  },
  {
    pattern: /\bi\s+(?:go\s+to\s+(?:bed|sleep))\s+(?:at\s+)?(\d+(?::\d+)?(?:\s*(?:am|pm))?)/gi,
    type: 'schedule',
    extractSubject: () => 'sleep time',
    extractValue: (m) => m[1].trim(),
    confidence: 'medium',
    category: 'schedule',
  },

  // Restrictions - "I'm allergic to X", "I can't eat X", "I'm vegetarian"
  {
    pattern: /\bi(?:'m| am)\s+allergic\s+to\s+(.+?)(?:\.|,|!|\?|$)/gi,
    type: 'restriction',
    extractSubject: () => 'allergy',
    extractValue: (m) => m[1].trim(),
    confidence: 'high',
    category: 'health',
  },
  {
    pattern: /\bi\s+(?:can't|cannot|don't)\s+eat\s+(.+?)(?:\.|,|!|\?|$)/gi,
    type: 'restriction',
    extractSubject: () => 'dietary restriction',
    extractValue: (m) => m[1].trim(),
    confidence: 'high',
    category: 'diet',
  },
  {
    pattern: /\bi(?:'m| am)\s+(vegetarian|vegan|pescatarian|gluten[- ]?free)/gi,
    type: 'restriction',
    extractSubject: () => 'diet',
    extractValue: (m) => m[1].trim(),
    confidence: 'high',
    category: 'diet',
  },
];

/**
 * Preference Learner Events
 */
export interface PreferenceLearnerEvents {
  'preference-learned': (preference: LearnedPreference) => void;
  'preference-confirmed': (preference: LearnedPreference) => void;
  'preference-updated': (preference: LearnedPreference) => void;
  'preferences-loaded': (count: number) => void;
  error: (error: Error) => void;
}

/**
 * Preference Learner Configuration
 */
export interface PreferenceLearnerConfig {
  /** Minimum confidence score to store preference */
  minConfidenceScore: number;
  /** Enable automatic storage to memory manager */
  autoStore: boolean;
  /** Maximum preferences to keep per type */
  maxPerType: number;
}

const DEFAULT_CONFIG: PreferenceLearnerConfig = {
  minConfidenceScore: 0.5,
  autoStore: true,
  maxPerType: 50,
};

/**
 * Preference Learner
 * Extracts and manages user preferences from conversations
 */
export class PreferenceLearner extends EventEmitter {
  private config: PreferenceLearnerConfig;
  private preferences: Map<string, LearnedPreference> = new Map();
  private memoryManager: MemoryManager | null = null;

  constructor(config?: Partial<PreferenceLearnerConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    logger.info('PreferenceLearner initialized', { config: this.config });
  }

  /**
   * Initialize with memory manager
   */
  async initialize(): Promise<void> {
    try {
      this.memoryManager = await getMemoryManager();
      await this.loadFromMemory();
      logger.info('PreferenceLearner connected to MemoryManager');
    } catch (error) {
      logger.error('Failed to connect to MemoryManager', { error: (error as Error).message });
    }
  }

  /**
   * Load existing preferences from memory manager
   */
  private async loadFromMemory(): Promise<void> {
    if (!this.memoryManager) return;

    try {
      const entries = this.memoryManager.searchEntries({
        type: 'preference',
        limit: 200,
      });

      for (const entry of entries) {
        // Reconstruct preference from stored entry
        if (entry.metadata?.preferenceData) {
          const pref = entry.metadata.preferenceData as LearnedPreference;
          this.preferences.set(pref.id, pref);
        }
      }

      this.emit('preferences-loaded', this.preferences.size);
      logger.info('Preferences loaded from memory', { count: this.preferences.size });
    } catch (error) {
      logger.error('Failed to load preferences', { error: (error as Error).message });
    }
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `pref-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get confidence score from level
   */
  private getConfidenceScore(level: ConfidenceLevel): number {
    switch (level) {
      case 'high':
        return 0.9;
      case 'medium':
        return 0.7;
      case 'low':
        return 0.5;
    }
  }

  /**
   * Extract preferences from text
   */
  extractPreferences(text: string): LearnedPreference[] {
    const extracted: LearnedPreference[] = [];
    const normalizedText = text.trim();

    for (const pattern of EXTRACTION_PATTERNS) {
      // Reset regex state
      pattern.pattern.lastIndex = 0;

      let match;
      while ((match = pattern.pattern.exec(normalizedText)) !== null) {
        const subject = pattern.extractSubject(match);
        const value = pattern.extractValue(match);
        const confidenceScore = this.getConfidenceScore(pattern.confidence);

        // Skip if below minimum confidence
        if (confidenceScore < this.config.minConfidenceScore) continue;

        // Check for duplicates
        const existingKey = `${pattern.type}:${subject}`;
        const existing = this.findSimilarPreference(pattern.type, subject);

        if (existing) {
          // Update existing preference
          existing.confirmations++;
          existing.confidenceScore = Math.min(1, existing.confidenceScore + 0.1);
          this.emit('preference-confirmed', existing);
          continue;
        }

        const preference: LearnedPreference = {
          id: this.generateId(),
          type: pattern.type,
          subject,
          value,
          sourceText: match[0],
          confidence: pattern.confidence,
          confidenceScore,
          learnedAt: Date.now(),
          confirmations: 1,
          category: pattern.category,
        };

        extracted.push(preference);
      }
    }

    // Store and emit for each extracted preference
    for (const pref of extracted) {
      this.storePreference(pref);
      this.emit('preference-learned', pref);
    }

    if (extracted.length > 0) {
      logger.info('Preferences extracted', {
        count: extracted.length,
        types: extracted.map((p) => p.type),
      });
    }

    return extracted;
  }

  /**
   * Find a similar existing preference
   */
  private findSimilarPreference(
    type: PreferenceType,
    subject: string
  ): LearnedPreference | undefined {
    const normalizedSubject = subject.toLowerCase();

    for (const pref of this.preferences.values()) {
      if (pref.type === type && pref.subject.toLowerCase() === normalizedSubject) {
        return pref;
      }
    }

    return undefined;
  }

  /**
   * Store a preference
   */
  private storePreference(preference: LearnedPreference): void {
    this.preferences.set(preference.id, preference);

    // Store in memory manager if enabled
    if (this.config.autoStore && this.memoryManager) {
      this.memoryManager.addEntry('preference', preference.value, {
        importance: preference.confidenceScore,
        tags: [preference.type, preference.category || 'general'],
        metadata: { preferenceData: preference },
      });
    }

    // Prune if over limit
    this.prunePreferencesByType(preference.type);
  }

  /**
   * Prune preferences by type to stay within limit
   */
  private prunePreferencesByType(type: PreferenceType): void {
    const prefsOfType = Array.from(this.preferences.values())
      .filter((p) => p.type === type)
      .sort((a, b) => {
        // Sort by confirmations, then by recency
        if (b.confirmations !== a.confirmations) {
          return b.confirmations - a.confirmations;
        }
        return b.learnedAt - a.learnedAt;
      });

    if (prefsOfType.length > this.config.maxPerType) {
      const toRemove = prefsOfType.slice(this.config.maxPerType);
      for (const pref of toRemove) {
        this.preferences.delete(pref.id);
      }
      logger.debug('Pruned old preferences', {
        type,
        removed: toRemove.length,
      });
    }
  }

  /**
   * Get all preferences
   */
  getAllPreferences(): LearnedPreference[] {
    return Array.from(this.preferences.values());
  }

  /**
   * Get preferences by type
   */
  getPreferencesByType(type: PreferenceType): LearnedPreference[] {
    return Array.from(this.preferences.values()).filter((p) => p.type === type);
  }

  /**
   * Get preferences by category
   */
  getPreferencesByCategory(category: string): LearnedPreference[] {
    return Array.from(this.preferences.values()).filter((p) => p.category === category);
  }

  /**
   * Get high-confidence preferences
   */
  getHighConfidencePreferences(minScore = 0.8): LearnedPreference[] {
    return Array.from(this.preferences.values())
      .filter((p) => p.confidenceScore >= minScore)
      .sort((a, b) => b.confidenceScore - a.confidenceScore);
  }

  /**
   * Get preference summary for LLM context
   */
  getPreferenceSummary(): string {
    const prefs = this.getHighConfidencePreferences(0.7);
    if (prefs.length === 0) return '';

    const groups: Record<string, string[]> = {};

    for (const pref of prefs) {
      const key = pref.type;
      if (!groups[key]) groups[key] = [];
      groups[key].push(pref.value);
    }

    const parts: string[] = [];

    if (groups.fact) {
      parts.push(`Personal info: ${groups.fact.join(', ')}`);
    }
    if (groups.likes) {
      parts.push(`Likes: ${groups.likes.join(', ')}`);
    }
    if (groups.dislikes) {
      parts.push(`Dislikes: ${groups.dislikes.join(', ')}`);
    }
    if (groups.preference) {
      parts.push(`Preferences: ${groups.preference.join(', ')}`);
    }
    if (groups.habit) {
      parts.push(`Habits: ${groups.habit.join(', ')}`);
    }
    if (groups.restriction) {
      parts.push(`Restrictions: ${groups.restriction.join(', ')}`);
    }

    return parts.join('. ');
  }

  /**
   * Search preferences by keyword
   */
  searchPreferences(keyword: string): LearnedPreference[] {
    const normalizedKeyword = keyword.toLowerCase();
    return Array.from(this.preferences.values()).filter(
      (p) =>
        p.subject.toLowerCase().includes(normalizedKeyword) ||
        p.value.toLowerCase().includes(normalizedKeyword) ||
        p.sourceText.toLowerCase().includes(normalizedKeyword)
    );
  }

  /**
   * Manually add a preference
   */
  addPreference(
    type: PreferenceType,
    subject: string,
    value: string,
    options?: {
      confidence?: ConfidenceLevel;
      category?: string;
    }
  ): LearnedPreference {
    const preference: LearnedPreference = {
      id: this.generateId(),
      type,
      subject,
      value,
      sourceText: `Manual: ${value}`,
      confidence: options?.confidence || 'high',
      confidenceScore: this.getConfidenceScore(options?.confidence || 'high'),
      learnedAt: Date.now(),
      confirmations: 1,
      category: options?.category,
    };

    this.storePreference(preference);
    this.emit('preference-learned', preference);

    return preference;
  }

  /**
   * Remove a preference
   */
  removePreference(id: string): boolean {
    return this.preferences.delete(id);
  }

  /**
   * Clear all preferences
   */
  clear(): void {
    this.preferences.clear();
    logger.info('PreferenceLearner cleared');
  }

  /**
   * Get statistics
   */
  getStats(): {
    total: number;
    byType: Record<PreferenceType, number>;
    averageConfidence: number;
    mostConfirmed: LearnedPreference | null;
  } {
    const prefs = Array.from(this.preferences.values());
    const byType: Partial<Record<PreferenceType, number>> = {};

    let totalConfidence = 0;
    let mostConfirmed: LearnedPreference | null = null;

    for (const pref of prefs) {
      byType[pref.type] = (byType[pref.type] || 0) + 1;
      totalConfidence += pref.confidenceScore;

      if (!mostConfirmed || pref.confirmations > mostConfirmed.confirmations) {
        mostConfirmed = pref;
      }
    }

    return {
      total: prefs.length,
      byType: byType as Record<PreferenceType, number>,
      averageConfidence: prefs.length > 0 ? totalConfidence / prefs.length : 0,
      mostConfirmed,
    };
  }

  /**
   * Shutdown the learner
   */
  shutdown(): void {
    this.removeAllListeners();
    logger.info('PreferenceLearner shutdown');
  }

  // Type-safe event emitter methods
  on<K extends keyof PreferenceLearnerEvents>(
    event: K,
    listener: PreferenceLearnerEvents[K]
  ): this {
    return super.on(event, listener);
  }

  off<K extends keyof PreferenceLearnerEvents>(
    event: K,
    listener: PreferenceLearnerEvents[K]
  ): this {
    return super.off(event, listener);
  }

  emit<K extends keyof PreferenceLearnerEvents>(
    event: K,
    ...args: Parameters<PreferenceLearnerEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }
}

// Singleton instance
let learnerInstance: PreferenceLearner | null = null;

/**
 * Get or create the preference learner instance
 */
export async function getPreferenceLearner(
  config?: Partial<PreferenceLearnerConfig>
): Promise<PreferenceLearner> {
  if (!learnerInstance) {
    learnerInstance = new PreferenceLearner(config);
    await learnerInstance.initialize();
  }
  return learnerInstance;
}

/**
 * Shutdown the preference learner
 */
export function shutdownPreferenceLearner(): void {
  if (learnerInstance) {
    learnerInstance.shutdown();
    learnerInstance = null;
  }
}

export default PreferenceLearner;
