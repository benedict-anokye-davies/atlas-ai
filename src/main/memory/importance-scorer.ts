/**
 * Nova Desktop - Importance Scorer
 * Scores memories by importance for retention and consolidation
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import { MemoryEntry, MemoryType } from './index';

const logger = createModuleLogger('ImportanceScorer');

/**
 * Memory categories for scoring
 */
export type MemoryCategory =
  | 'user_preference' // "I like X", "I prefer Y"
  | 'user_fact' // "My name is X", "I live in Y"
  | 'decision' // "Let's do X", "I decided Y"
  | 'instruction' // "Remember to X", "Always Y"
  | 'agreement' // "Yes, that's correct", "We agreed on X"
  | 'question' // Questions asked by user
  | 'task' // Tasks, reminders, todos
  | 'casual' // General conversation, small talk
  | 'feedback' // User feedback on Nova's responses
  | 'correction'; // User correcting Nova

/**
 * Category weights for importance scoring
 */
const CATEGORY_WEIGHTS: Record<MemoryCategory, number> = {
  user_preference: 0.9,
  user_fact: 0.95,
  decision: 0.8,
  instruction: 0.85,
  agreement: 0.7,
  task: 0.75,
  feedback: 0.7,
  correction: 0.8,
  question: 0.5,
  casual: 0.3,
};

/**
 * Pattern matchers for category detection
 */
interface CategoryPattern {
  patterns: RegExp[];
  negativePatterns?: RegExp[];
}

const CATEGORY_PATTERNS: Record<MemoryCategory, CategoryPattern> = {
  user_preference: {
    patterns: [
      /\bi\s+(?:like|love|prefer|enjoy|want|need)\s+/i,
      /\bi\s+(?:don't|do not|dont)\s+(?:like|want|need)\s+/i,
      /\bmy\s+favorite\s+/i,
      /\bi\s+(?:always|usually|normally|typically)\s+/i,
      /\bi\s+(?:never|rarely|seldom)\s+/i,
      /\bi\s+(?:hate|dislike|can't stand)\s+/i,
    ],
  },
  user_fact: {
    patterns: [
      /\bmy\s+name\s+is\s+/i,
      /\bi\s+am\s+(?:a|an)\s+/i,
      /\bi\s+(?:work|live|study)\s+(?:at|in|as)\s+/i,
      /\bmy\s+(?:birthday|age|job|occupation)\s+is\s+/i,
      /\bi\s+have\s+(?:a|an)?\s*(?:\d+\s+)?(?:kids?|children|pets?|dog|cat)/i,
      /\bi\s+(?:was born|grew up)\s+/i,
      /\bmy\s+(?:phone|email|address)\s+/i,
    ],
  },
  decision: {
    patterns: [
      /\blet's\s+(?:go with|do|use|try)\s+/i,
      /\bi\s+(?:decided|choose|chose|picked|selected)\s+/i,
      /\bwe\s+(?:should|will|shall)\s+/i,
      /\bi'll\s+(?:go with|take|use)\s+/i,
    ],
  },
  instruction: {
    patterns: [
      /\b(?:remember|don't forget|always|never)\s+(?:to|that)\s+/i,
      /\bmake\s+sure\s+(?:to|you)\s+/i,
      /\bwhen\s+i\s+(?:ask|say)\s+.+\s+(?:do|respond|say)\s+/i,
      /\b(?:from now on|going forward)\s+/i,
    ],
  },
  agreement: {
    patterns: [
      /\b(?:yes|yeah|yep|correct|exactly|that's right)\b/i,
      /\bi\s+agree\b/i,
      /\bthat's\s+(?:correct|right|perfect)\b/i,
      /\bwe\s+agreed\s+/i,
    ],
  },
  task: {
    patterns: [
      /\b(?:remind|reminder)\s+(?:me|to)\s+/i,
      /\b(?:todo|to-do|task)\s*:/i,
      /\bby\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d+)/i,
      /\bdeadline\s+/i,
      /\bschedule\s+/i,
    ],
  },
  feedback: {
    patterns: [
      /\bthat\s+(?:was|is)\s+(?:helpful|great|good|perfect|exactly what)\b/i,
      /\b(?:thanks|thank you)\b/i,
      /\bthat\s+(?:wasn't|isn't)\s+(?:what i|helpful|right)\b/i,
    ],
  },
  correction: {
    patterns: [
      /\bno,?\s+(?:i meant|that's not|actually)\s+/i,
      /\bi\s+(?:meant|said|wanted)\s+.+\s+not\s+/i,
      /\bthat's\s+(?:wrong|incorrect|not right)\b/i,
      /\byou\s+(?:misunderstood|got it wrong)\b/i,
    ],
  },
  question: {
    patterns: [/\?$/],
  },
  casual: {
    patterns: [
      /^(?:hi|hello|hey|good morning|good afternoon|good evening)\b/i,
      /^(?:how are you|what's up|sup)\b/i,
      /\b(?:bye|goodbye|see you|later)\b/i,
      /\b(?:thanks|thank you|ok|okay)\s*$/i,
    ],
  },
};

/**
 * Keyword importance boosters
 */
const IMPORTANCE_BOOSTERS: Record<string, number> = {
  // High priority indicators
  important: 0.2,
  urgent: 0.25,
  critical: 0.25,
  'must remember': 0.3,
  "don't forget": 0.25,
  always: 0.15,
  never: 0.15,
  // Personal information indicators
  'my name': 0.3,
  birthday: 0.2,
  anniversary: 0.2,
  password: 0.3,
  secret: 0.2,
  // Relationship indicators
  wife: 0.15,
  husband: 0.15,
  partner: 0.15,
  children: 0.15,
  parents: 0.15,
};

/**
 * Decay factors for memory aging
 */
const DECAY_CONFIG = {
  /** Hours until half decay */
  halfLifeHours: 168, // 1 week
  /** Minimum importance after decay */
  minImportance: 0.1,
  /** Categories exempt from decay */
  noDecayCategories: ['user_fact', 'user_preference', 'instruction'] as MemoryCategory[],
};

/**
 * Memory consolidation levels
 */
export type ConsolidationLevel = 'short_term' | 'working' | 'long_term';

/**
 * Scored memory with additional metadata
 */
export interface ScoredMemory {
  /** Original memory entry */
  entry: MemoryEntry;
  /** Detected category */
  category: MemoryCategory;
  /** Raw importance score before decay */
  rawScore: number;
  /** Final score after all factors */
  finalScore: number;
  /** Consolidation level */
  consolidationLevel: ConsolidationLevel;
  /** Confidence in category detection */
  categoryConfidence: number;
  /** Keywords that boosted score */
  boosters: string[];
}

/**
 * Importance Scorer Events
 */
export interface ImportanceScorerEvents {
  'memory-scored': (scored: ScoredMemory) => void;
  'memory-consolidated': (id: string, level: ConsolidationLevel) => void;
  'memory-decayed': (id: string, oldScore: number, newScore: number) => void;
}

/**
 * Importance Scorer Configuration
 */
export interface ImportanceScorerConfig {
  /** Enable automatic decay */
  enableDecay: boolean;
  /** Decay check interval in ms */
  decayIntervalMs: number;
  /** Threshold for long-term consolidation */
  longTermThreshold: number;
  /** Threshold for working memory */
  workingMemoryThreshold: number;
}

const DEFAULT_CONFIG: ImportanceScorerConfig = {
  enableDecay: true,
  decayIntervalMs: 3600000, // 1 hour
  longTermThreshold: 0.7,
  workingMemoryThreshold: 0.4,
};

/**
 * Importance Scorer
 * Analyzes and scores memories for retention and consolidation
 */
export class ImportanceScorer extends EventEmitter {
  private config: ImportanceScorerConfig;
  private decayTimer: NodeJS.Timeout | null = null;
  private scoredMemories: Map<string, ScoredMemory> = new Map();

  constructor(config?: Partial<ImportanceScorerConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    logger.info('ImportanceScorer initialized', { config: this.config });
  }

  /**
   * Start decay timer
   */
  startDecayTimer(): void {
    if (this.config.enableDecay && !this.decayTimer) {
      this.decayTimer = setInterval(() => this.applyDecay(), this.config.decayIntervalMs);
      logger.info('Decay timer started');
    }
  }

  /**
   * Stop decay timer
   */
  stopDecayTimer(): void {
    if (this.decayTimer) {
      clearInterval(this.decayTimer);
      this.decayTimer = null;
      logger.info('Decay timer stopped');
    }
  }

  /**
   * Detect the category of a text
   */
  detectCategory(text: string): { category: MemoryCategory; confidence: number } {
    const normalizedText = text.trim();
    const scores: Record<MemoryCategory, number> = {} as Record<MemoryCategory, number>;

    // Initialize scores
    for (const category of Object.keys(CATEGORY_PATTERNS) as MemoryCategory[]) {
      scores[category] = 0;
    }

    // Check each category's patterns
    for (const [category, { patterns, negativePatterns }] of Object.entries(CATEGORY_PATTERNS)) {
      const cat = category as MemoryCategory;

      // Check positive patterns
      for (const pattern of patterns) {
        if (pattern.test(normalizedText)) {
          scores[cat] += 1;
        }
      }

      // Check negative patterns (reduce score)
      if (negativePatterns) {
        for (const pattern of negativePatterns) {
          if (pattern.test(normalizedText)) {
            scores[cat] -= 0.5;
          }
        }
      }
    }

    // Find highest scoring category
    let bestCategory: MemoryCategory = 'casual';
    let bestScore = 0;

    for (const [category, score] of Object.entries(scores)) {
      if (score > bestScore) {
        bestScore = score;
        bestCategory = category as MemoryCategory;
      }
    }

    // Calculate confidence based on score difference
    const sortedScores = Object.values(scores).sort((a, b) => b - a);
    const scoreDiff = sortedScores[0] - (sortedScores[1] || 0);
    const confidence = bestScore > 0 ? Math.min(1, 0.5 + scoreDiff * 0.25) : 0.3;

    return { category: bestCategory, confidence };
  }

  /**
   * Find importance boosters in text
   */
  findBoosters(text: string): { boosters: string[]; totalBoost: number } {
    const normalizedText = text.toLowerCase();
    const boosters: string[] = [];
    let totalBoost = 0;

    for (const [keyword, boost] of Object.entries(IMPORTANCE_BOOSTERS)) {
      if (normalizedText.includes(keyword)) {
        boosters.push(keyword);
        totalBoost += boost;
      }
    }

    return { boosters, totalBoost: Math.min(totalBoost, 0.5) }; // Cap boost at 0.5
  }

  /**
   * Calculate base importance score
   */
  calculateBaseScore(text: string, category: MemoryCategory): number {
    const categoryWeight = CATEGORY_WEIGHTS[category];
    const { totalBoost } = this.findBoosters(text);

    // Consider text length (longer = potentially more important)
    const wordCount = text.split(/\s+/).length;
    const lengthBonus = Math.min(wordCount / 100, 0.1); // Up to 0.1 for long texts

    // Consider specificity (has names, numbers, dates)
    const hasSpecifics =
      /\b(?:\d+|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december)\b/i.test(
        text
      );
    const specificityBonus = hasSpecifics ? 0.1 : 0;

    return Math.min(1, categoryWeight + totalBoost + lengthBonus + specificityBonus);
  }

  /**
   * Apply time-based decay to a score
   */
  applyTimeDecay(score: number, createdAt: number, category: MemoryCategory): number {
    // Skip decay for certain categories
    if (DECAY_CONFIG.noDecayCategories.includes(category)) {
      return score;
    }

    const ageHours = (Date.now() - createdAt) / (1000 * 60 * 60);
    const decayFactor = Math.pow(0.5, ageHours / DECAY_CONFIG.halfLifeHours);
    const decayedScore = score * decayFactor;

    return Math.max(DECAY_CONFIG.minImportance, decayedScore);
  }

  /**
   * Determine consolidation level based on score
   */
  getConsolidationLevel(score: number): ConsolidationLevel {
    if (score >= this.config.longTermThreshold) {
      return 'long_term';
    }
    if (score >= this.config.workingMemoryThreshold) {
      return 'working';
    }
    return 'short_term';
  }

  /**
   * Score a memory entry
   */
  scoreMemory(entry: MemoryEntry): ScoredMemory {
    const { category, confidence } = this.detectCategory(entry.content);
    const { boosters } = this.findBoosters(entry.content);

    const rawScore = this.calculateBaseScore(entry.content, category);
    const finalScore = this.applyTimeDecay(rawScore, entry.createdAt, category);
    const consolidationLevel = this.getConsolidationLevel(finalScore);

    const scored: ScoredMemory = {
      entry,
      category,
      rawScore,
      finalScore,
      consolidationLevel,
      categoryConfidence: confidence,
      boosters,
    };

    this.scoredMemories.set(entry.id, scored);
    this.emit('memory-scored', scored);

    logger.debug('Memory scored', {
      id: entry.id,
      category,
      rawScore: rawScore.toFixed(2),
      finalScore: finalScore.toFixed(2),
      level: consolidationLevel,
    });

    return scored;
  }

  /**
   * Batch score multiple memories
   */
  scoreMemories(entries: MemoryEntry[]): ScoredMemory[] {
    return entries.map((entry) => this.scoreMemory(entry));
  }

  /**
   * Get scored memory by ID
   */
  getScoredMemory(id: string): ScoredMemory | undefined {
    return this.scoredMemories.get(id);
  }

  /**
   * Get memories by consolidation level
   */
  getMemoriesByLevel(level: ConsolidationLevel): ScoredMemory[] {
    return Array.from(this.scoredMemories.values()).filter((m) => m.consolidationLevel === level);
  }

  /**
   * Get memories by category
   */
  getMemoriesByCategory(category: MemoryCategory): ScoredMemory[] {
    return Array.from(this.scoredMemories.values()).filter((m) => m.category === category);
  }

  /**
   * Get top N most important memories
   */
  getTopMemories(n: number): ScoredMemory[] {
    return Array.from(this.scoredMemories.values())
      .sort((a, b) => b.finalScore - a.finalScore)
      .slice(0, n);
  }

  /**
   * Apply decay to all tracked memories
   */
  applyDecay(): void {
    let decayedCount = 0;

    for (const [id, scored] of this.scoredMemories) {
      const newScore = this.applyTimeDecay(
        scored.rawScore,
        scored.entry.createdAt,
        scored.category
      );

      if (newScore !== scored.finalScore) {
        const oldScore = scored.finalScore;
        scored.finalScore = newScore;
        scored.consolidationLevel = this.getConsolidationLevel(newScore);

        this.emit('memory-decayed', id, oldScore, newScore);
        decayedCount++;
      }
    }

    if (decayedCount > 0) {
      logger.debug('Decay applied', { affectedMemories: decayedCount });
    }
  }

  /**
   * Promote a memory (boost importance)
   */
  promoteMemory(id: string, boost = 0.2): ScoredMemory | undefined {
    const scored = this.scoredMemories.get(id);
    if (!scored) return undefined;

    scored.rawScore = Math.min(1, scored.rawScore + boost);
    scored.finalScore = this.applyTimeDecay(
      scored.rawScore,
      scored.entry.createdAt,
      scored.category
    );
    scored.consolidationLevel = this.getConsolidationLevel(scored.finalScore);

    const oldLevel = scored.consolidationLevel;
    if (oldLevel !== scored.consolidationLevel) {
      this.emit('memory-consolidated', id, scored.consolidationLevel);
    }

    logger.debug('Memory promoted', {
      id,
      newScore: scored.finalScore.toFixed(2),
      level: scored.consolidationLevel,
    });

    return scored;
  }

  /**
   * Demote a memory (reduce importance)
   */
  demoteMemory(id: string, penalty = 0.2): ScoredMemory | undefined {
    const scored = this.scoredMemories.get(id);
    if (!scored) return undefined;

    scored.rawScore = Math.max(DECAY_CONFIG.minImportance, scored.rawScore - penalty);
    scored.finalScore = this.applyTimeDecay(
      scored.rawScore,
      scored.entry.createdAt,
      scored.category
    );
    scored.consolidationLevel = this.getConsolidationLevel(scored.finalScore);

    logger.debug('Memory demoted', {
      id,
      newScore: scored.finalScore.toFixed(2),
      level: scored.consolidationLevel,
    });

    return scored;
  }

  /**
   * Remove a scored memory
   */
  removeMemory(id: string): boolean {
    return this.scoredMemories.delete(id);
  }

  /**
   * Get statistics about scored memories
   */
  getStats(): {
    total: number;
    byLevel: Record<ConsolidationLevel, number>;
    byCategory: Record<MemoryCategory, number>;
    averageScore: number;
  } {
    const memories = Array.from(this.scoredMemories.values());
    const byLevel: Record<ConsolidationLevel, number> = {
      short_term: 0,
      working: 0,
      long_term: 0,
    };
    const byCategory: Partial<Record<MemoryCategory, number>> = {};

    let totalScore = 0;

    for (const m of memories) {
      byLevel[m.consolidationLevel]++;
      byCategory[m.category] = (byCategory[m.category] || 0) + 1;
      totalScore += m.finalScore;
    }

    return {
      total: memories.length,
      byLevel,
      byCategory: byCategory as Record<MemoryCategory, number>,
      averageScore: memories.length > 0 ? totalScore / memories.length : 0,
    };
  }

  /**
   * Clear all scored memories
   */
  clear(): void {
    this.scoredMemories.clear();
    logger.info('ImportanceScorer cleared');
  }

  /**
   * Shutdown the scorer
   */
  shutdown(): void {
    this.stopDecayTimer();
    this.removeAllListeners();
    logger.info('ImportanceScorer shutdown');
  }

  // Type-safe event emitter methods
  on<K extends keyof ImportanceScorerEvents>(event: K, listener: ImportanceScorerEvents[K]): this {
    return super.on(event, listener);
  }

  off<K extends keyof ImportanceScorerEvents>(event: K, listener: ImportanceScorerEvents[K]): this {
    return super.off(event, listener);
  }

  emit<K extends keyof ImportanceScorerEvents>(
    event: K,
    ...args: Parameters<ImportanceScorerEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }
}

// Singleton instance
let scorerInstance: ImportanceScorer | null = null;

/**
 * Get or create the importance scorer instance
 */
export function getImportanceScorer(config?: Partial<ImportanceScorerConfig>): ImportanceScorer {
  if (!scorerInstance) {
    scorerInstance = new ImportanceScorer(config);
    scorerInstance.startDecayTimer();
  }
  return scorerInstance;
}

/**
 * Shutdown the importance scorer
 */
export function shutdownImportanceScorer(): void {
  if (scorerInstance) {
    scorerInstance.shutdown();
    scorerInstance = null;
  }
}

export default ImportanceScorer;
