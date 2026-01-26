/**
 * Atlas Desktop - Knowledge Retriever
 * Retrieves relevant knowledge for LLM context
 */

import { createModuleLogger } from '../utils/logger';
import {
  KnowledgeStore,
  KnowledgeEntry,
  KnowledgeCategory,
  getKnowledgeStore,
} from './knowledge-store';
import { FactExtractor, getFactExtractor } from './fact-extractor';

const logger = createModuleLogger('KnowledgeRetriever');

/**
 * Context relevance score
 */
interface RelevanceScore {
  entry: KnowledgeEntry;
  score: number;
  reason: string;
}

/**
 * Retrieved context result
 */
export interface RetrievedContext {
  /** Knowledge entries relevant to the query */
  entries: KnowledgeEntry[];
  /** Formatted context string for LLM */
  contextString: string;
  /** Statistics about retrieval */
  stats: {
    total: number;
    byCategory: Record<KnowledgeCategory, number>;
    averageRelevance: number;
  };
}

/**
 * Retrieval options
 */
export interface RetrievalOptions {
  /** Maximum entries to retrieve */
  maxEntries?: number;
  /** Minimum relevance score (0-1) */
  minRelevance?: number;
  /** Include user preferences */
  includePreferences?: boolean;
  /** Include user facts */
  includeUserFacts?: boolean;
  /** Weight for recency vs relevance */
  recencyWeight?: number;
  /** Categories to include (all if not specified) */
  categories?: KnowledgeCategory[];
}

/**
 * Default retrieval options
 */
const DEFAULT_OPTIONS: Required<RetrievalOptions> = {
  maxEntries: 15,
  minRelevance: 0.3,
  includePreferences: true,
  includeUserFacts: true,
  recencyWeight: 0.2,
  categories: [],
};

/**
 * KnowledgeRetriever - Retrieves relevant knowledge for conversations
 */
export class KnowledgeRetriever {
  private knowledgeStore: KnowledgeStore | null = null;
  private factExtractor: FactExtractor | null = null;

  constructor() {
    logger.info('KnowledgeRetriever initialized');
  }

  /**
   * Get or initialize the knowledge store
   */
  private async getStore(): Promise<KnowledgeStore> {
    if (!this.knowledgeStore) {
      this.knowledgeStore = await getKnowledgeStore();
    }
    return this.knowledgeStore;
  }

  /**
   * Get or initialize the fact extractor
   */
  private getExtractor(): FactExtractor {
    if (!this.factExtractor) {
      this.factExtractor = getFactExtractor();
    }
    return this.factExtractor;
  }

  /**
   * Extract keywords from query
   */
  private extractKeywords(query: string): string[] {
    // Remove common words and punctuation
    const stopWords = new Set([
      'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'may', 'might', 'must', 'can', 'shall', 'i', 'you', 'he',
      'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them', 'my',
      'your', 'his', 'her', 'its', 'our', 'their', 'what', 'which', 'who',
      'whom', 'this', 'that', 'these', 'those', 'am', 'and', 'but', 'or',
      'nor', 'for', 'yet', 'so', 'as', 'at', 'by', 'from', 'in', 'into',
      'of', 'on', 'to', 'with', 'about', 'against', 'between', 'through',
      'during', 'before', 'after', 'above', 'below', 'up', 'down', 'out',
      'off', 'over', 'under', 'again', 'further', 'then', 'once', 'here',
      'there', 'when', 'where', 'why', 'how', 'all', 'any', 'both', 'each',
      'few', 'more', 'most', 'other', 'some', 'such', 'no', 'not', 'only',
      'own', 'same', 'than', 'too', 'very', 'just', 'also', 'now', 'please',
      'tell', 'know', 'think', 'want', 'need', 'help', 'like', 'get',
    ]);

    return query
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 2 && !stopWords.has(word));
  }

  /**
   * Calculate relevance score for an entry given a query
   */
  private calculateRelevance(
    entry: KnowledgeEntry,
    query: string,
    keywords: string[],
    options: Required<RetrievalOptions>
  ): RelevanceScore {
    let score = 0;
    const reasons: string[] = [];

    // Text matching in natural form
    const naturalLower = entry.naturalForm.toLowerCase();
    const queryLower = query.toLowerCase();

    // Direct text match
    if (naturalLower.includes(queryLower)) {
      score += 0.5;
      reasons.push('direct match');
    }

    // Keyword matching
    let keywordMatches = 0;
    for (const keyword of keywords) {
      if (
        naturalLower.includes(keyword) ||
        entry.subject.includes(keyword) ||
        entry.object.includes(keyword)
      ) {
        keywordMatches++;
      }
    }
    if (keywordMatches > 0) {
      const keywordScore = Math.min(0.4, keywordMatches * 0.15);
      score += keywordScore;
      reasons.push(`${keywordMatches} keywords`);
    }

    // Confidence boost
    score += entry.confidenceScore * 0.2;
    if (entry.confidenceScore > 0.8) {
      reasons.push('high confidence');
    }

    // Reinforcement boost
    if (entry.reinforcements > 1) {
      score += Math.min(0.1, entry.reinforcements * 0.02);
      reasons.push('reinforced');
    }

    // Recency factor
    const ageInDays = (Date.now() - entry.accessedAt) / (1000 * 60 * 60 * 24);
    const recencyFactor = Math.max(0, 1 - ageInDays / 30); // Decay over 30 days
    score += recencyFactor * options.recencyWeight;
    if (recencyFactor > 0.7) {
      reasons.push('recent');
    }

    // Category-specific boosts
    if (entry.category === 'user_preference' && options.includePreferences) {
      score += 0.1;
    }
    if (entry.category === 'user_fact' && options.includeUserFacts) {
      score += 0.1;
    }

    // Normalize score
    score = Math.min(1.0, score);

    return {
      entry,
      score,
      reason: reasons.join(', ') || 'general match',
    };
  }

  /**
   * Retrieve relevant knowledge for a query
   */
  async retrieve(query: string, options?: RetrievalOptions): Promise<RetrievedContext> {
    const opts: Required<RetrievalOptions> = { ...DEFAULT_OPTIONS, ...options };
    const store = await this.getStore();
    const keywords = this.extractKeywords(query);

    // Get all entries (filtered by category if specified)
    const allEntries = store.query({
      category: opts.categories.length === 1 ? opts.categories[0] : undefined,
      minConfidence: 'low',
    });

    // Score all entries
    const scored: RelevanceScore[] = allEntries.map((entry) =>
      this.calculateRelevance(entry, query, keywords, opts)
    );

    // Filter by minimum relevance and sort by score
    const relevant = scored
      .filter((s) => s.score >= opts.minRelevance)
      .sort((a, b) => b.score - a.score)
      .slice(0, opts.maxEntries);

    // Also add high-priority user info if not already included
    if (opts.includeUserFacts || opts.includePreferences) {
      const priorityFacts = store.query({
        minConfidence: 'high',
        sortBy: 'confidence',
        limit: 5,
      });

      for (const fact of priorityFacts) {
        if (!relevant.some((r) => r.entry.id === fact.id)) {
          relevant.push({
            entry: fact,
            score: fact.confidenceScore * 0.8,
            reason: 'high-priority user info',
          });
        }
      }
    }

    // Re-sort and trim
    relevant.sort((a, b) => b.score - a.score);
    const finalEntries = relevant.slice(0, opts.maxEntries).map((r) => r.entry);

    // Build context string
    const contextString = this.buildContextString(finalEntries);

    // Calculate stats
    const byCategory: Record<KnowledgeCategory, number> = {
      user_preference: 0,
      user_fact: 0,
      user_habit: 0,
      world_fact: 0,
      task_pattern: 0,
      relationship: 0,
      custom: 0,
    };
    for (const entry of finalEntries) {
      byCategory[entry.category]++;
    }

    const avgRelevance =
      relevant.length > 0
        ? relevant.reduce((sum, r) => sum + r.score, 0) / relevant.length
        : 0;

    logger.debug('Knowledge retrieved', {
      query: query.slice(0, 50),
      keywords: keywords.length,
      found: finalEntries.length,
    });

    return {
      entries: finalEntries,
      contextString,
      stats: {
        total: finalEntries.length,
        byCategory,
        averageRelevance: avgRelevance,
      },
    };
  }

  /**
   * Build a context string from knowledge entries
   */
  private buildContextString(entries: KnowledgeEntry[]): string {
    if (entries.length === 0) {
      return '';
    }

    // Group by category
    const grouped: Record<string, KnowledgeEntry[]> = {};
    for (const entry of entries) {
      const key = this.getCategoryLabel(entry.category);
      if (!grouped[key]) {
        grouped[key] = [];
      }
      grouped[key].push(entry);
    }

    // Build formatted string
    const sections: string[] = [];

    for (const [category, categoryEntries] of Object.entries(grouped)) {
      const facts = categoryEntries.map((e) => `- ${e.naturalForm}`).join('\n');
      sections.push(`${category}:\n${facts}`);
    }

    return `Relevant context about the user:\n\n${sections.join('\n\n')}`;
  }

  /**
   * Get human-readable category label
   */
  private getCategoryLabel(category: KnowledgeCategory): string {
    const labels: Record<KnowledgeCategory, string> = {
      user_preference: 'User Preferences',
      user_fact: 'Known Facts',
      user_habit: 'User Habits',
      world_fact: 'General Knowledge',
      task_pattern: 'Task Patterns',
      relationship: 'Relationships',
      custom: 'Other',
    };
    return labels[category];
  }

  /**
   * Process conversation turn - extract facts and update knowledge
   */
  async processConversation(userMessage: string, assistantResponse?: string): Promise<void> {
    const extractor = this.getExtractor();
    await extractor.processConversationTurn(userMessage, assistantResponse);
  }

  /**
   * Get context for LLM prompt enhancement
   */
  async getContextForPrompt(userQuery: string): Promise<string> {
    const result = await this.retrieve(userQuery);
    return result.contextString;
  }

  /**
   * Get retrieval statistics
   */
  async getStats(): Promise<{
    totalKnowledge: number;
    byCategory: Record<KnowledgeCategory, number>;
    averageConfidence: number;
  }> {
    const store = await this.getStore();
    return store.getStats();
  }
}

// Singleton instance
let knowledgeRetriever: KnowledgeRetriever | null = null;

/**
 * Get or create the knowledge retriever instance
 */
export function getKnowledgeRetriever(): KnowledgeRetriever {
  if (!knowledgeRetriever) {
    knowledgeRetriever = new KnowledgeRetriever();
  }
  return knowledgeRetriever;
}

/**
 * Shutdown the knowledge retriever
 */
export function shutdownKnowledgeRetriever(): void {
  knowledgeRetriever = null;
}

export default KnowledgeRetriever;
