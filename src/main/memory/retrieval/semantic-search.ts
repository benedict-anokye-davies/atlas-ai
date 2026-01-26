/**
 * Atlas Desktop - Semantic Search
 * Advanced semantic search retrieval for the memory system
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../../utils/logger';
import { getVectorStore, VectorSearchResult, VectorMetadata } from '../vector-store';
import { getSemanticChunker } from '../semantic-chunker';
import { clamp01 } from '../../../shared/utils';

const logger = createModuleLogger('SemanticSearch');

/**
 * Search context for relevance boosting
 */
export interface SearchContext {
  /** Current conversation topics */
  currentTopics?: string[];
  /** Recent user messages for context */
  recentMessages?: string[];
  /** Session ID for session-aware search */
  sessionId?: string;
  /** User preferences for personalization */
  userPreferences?: string[];
}

/**
 * Semantic search options
 */
export interface SemanticSearchOptions {
  /** Maximum results to return */
  limit?: number;
  /** Minimum similarity score (0-1) */
  minScore?: number;
  /** Minimum importance score */
  minImportance?: number;
  /** Filter by source types */
  sourceTypes?: VectorMetadata['sourceType'][];
  /** Filter by topics */
  topics?: string[];
  /** Filter by tags */
  tags?: string[];
  /** Include summaries in results */
  includeSummaries?: boolean;
  /** Apply importance boosting to scores */
  boostByImportance?: boolean;
  /** Apply recency boosting */
  boostByRecency?: boolean;
  /** Weight for semantic similarity (0-1) */
  semanticWeight?: number;
  /** Weight for importance (0-1) */
  importanceWeight?: number;
  /** Weight for recency (0-1) */
  recencyWeight?: number;
}

/**
 * Enhanced search result with combined scoring
 */
export interface EnhancedSearchResult {
  /** Original search result */
  result: VectorSearchResult;
  /** Combined final score */
  finalScore: number;
  /** Semantic similarity score */
  semanticScore: number;
  /** Importance score */
  importanceScore: number;
  /** Recency score */
  recencyScore: number;
  /** Relevance explanation */
  relevance: {
    matchedTopics: string[];
    matchedTags: string[];
    ageInHours: number;
  };
}

/**
 * Search events
 */
export interface SemanticSearchEvents {
  'search-performed': (query: string, results: number) => void;
  'context-search': (context: SearchContext, results: number) => void;
  error: (error: Error) => void;
}

/**
 * Default search options
 */
const DEFAULT_OPTIONS: Required<SemanticSearchOptions> = {
  limit: 10,
  minScore: 0.3,
  minImportance: 0,
  sourceTypes: [],
  topics: [],
  tags: [],
  includeSummaries: false,
  boostByImportance: true,
  boostByRecency: true,
  semanticWeight: 0.5,
  importanceWeight: 0.3,
  recencyWeight: 0.2,
};

/**
 * Semantic Search Service
 * Provides intelligent search across the memory system
 */
export class SemanticSearchService extends EventEmitter {
  constructor() {
    super();
    logger.info('SemanticSearchService initialized');
  }

  /**
   * Perform semantic search
   */
  async search(query: string, options?: SemanticSearchOptions): Promise<EnhancedSearchResult[]> {
    const opts = { ...DEFAULT_OPTIONS, ...options };

    try {
      const vectorStore = await getVectorStore();

      // Build vector store search options
      const searchOptions = {
        limit: opts.limit * 2, // Over-fetch for post-filtering
        minScore: opts.minScore * 0.8, // Lower threshold initially
        sourceType: opts.sourceTypes?.length === 1 ? opts.sourceTypes[0] : undefined,
        minImportance: opts.minImportance,
        topics: opts.topics,
        tags: opts.tags,
        includeSummaries: opts.includeSummaries,
      };

      // Perform vector search
      const results = await vectorStore.search(query, searchOptions);

      // Enhance and re-score results
      const enhanced = this.enhanceResults(results, query, opts);

      // Apply final filters
      const filtered = enhanced
        .filter((r) => {
          // Filter by source types
          if (opts.sourceTypes?.length) {
            if (!opts.sourceTypes.includes(r.result.document.metadata.sourceType)) {
              return false;
            }
          }
          // Filter by minimum score
          if (r.finalScore < opts.minScore) {
            return false;
          }
          return true;
        })
        .slice(0, opts.limit);

      this.emit('search-performed', query, filtered.length);
      logger.debug('Semantic search completed', {
        query: query.slice(0, 50),
        results: filtered.length,
      });

      return filtered;
    } catch (error) {
      this.emit('error', error as Error);
      logger.error('Semantic search failed', { error: (error as Error).message });
      throw error;
    }
  }

  /**
   * Search with context awareness
   */
  async searchWithContext(
    query: string,
    context: SearchContext,
    options?: SemanticSearchOptions
  ): Promise<EnhancedSearchResult[]> {
    // Build enhanced query incorporating context
    let enhancedQuery = query;

    // Add topic context
    if (context.currentTopics?.length) {
      enhancedQuery += ' ' + context.currentTopics.join(' ');
    }

    // Perform search with context-aware options
    const opts: SemanticSearchOptions = {
      ...options,
      topics: [...(options?.topics || []), ...(context.currentTopics || [])],
    };

    const results = await this.search(enhancedQuery, opts);

    // Boost results that match session
    if (context.sessionId) {
      for (const result of results) {
        if (result.result.document.metadata.sessionId === context.sessionId) {
          result.finalScore *= 1.2; // 20% boost for same session
        }
      }
      // Re-sort
      results.sort((a, b) => b.finalScore - a.finalScore);
    }

    this.emit('context-search', context, results.length);
    return results;
  }

  /**
   * Find related memories for a given document
   */
  async findRelated(
    documentId: string,
    options?: SemanticSearchOptions
  ): Promise<EnhancedSearchResult[]> {
    const vectorStore = await getVectorStore();
    const doc = await vectorStore.get(documentId);

    if (!doc) {
      throw new Error(`Document not found: ${documentId}`);
    }

    // Search by the document's vector
    const results = await vectorStore.searchByVector(doc.vector, {
      limit: (options?.limit ?? 10) + 1, // +1 to exclude self
      minScore: options?.minScore,
      minImportance: options?.minImportance,
    });

    // Filter out the source document and enhance
    const filtered = results.filter((r) => r.document.id !== documentId);
    const enhanced = this.enhanceResults(
      filtered,
      doc.content,
      { ...DEFAULT_OPTIONS, ...options }
    );

    return enhanced.slice(0, options?.limit ?? 10);
  }

  /**
   * Search by topic
   */
  async searchByTopic(topic: string, options?: SemanticSearchOptions): Promise<EnhancedSearchResult[]> {
    return this.search(topic, {
      ...options,
      topics: [topic, ...(options?.topics || [])],
    });
  }

  /**
   * Search for facts about a subject
   */
  async searchFacts(subject: string, options?: SemanticSearchOptions): Promise<EnhancedSearchResult[]> {
    return this.search(subject, {
      ...options,
      sourceTypes: ['fact', 'preference', ...(options?.sourceTypes || [])],
      boostByImportance: true,
    });
  }

  /**
   * Search recent memories
   */
  async searchRecent(query: string, options?: SemanticSearchOptions): Promise<EnhancedSearchResult[]> {
    return this.search(query, {
      ...options,
      recencyWeight: 0.5,
      semanticWeight: 0.4,
      importanceWeight: 0.1,
    });
  }

  /**
   * Enhance results with combined scoring
   */
  private enhanceResults(
    results: VectorSearchResult[],
    query: string,
    options: Required<SemanticSearchOptions>
  ): EnhancedSearchResult[] {
    const chunker = getSemanticChunker();
    const queryTopics = chunker.extractTopics(query);
    const now = Date.now();

    const enhanced: EnhancedSearchResult[] = [];

    for (const result of results) {
      const doc = result.document;

      // Calculate semantic score (already from vector search)
      const semanticScore = result.score;

      // Calculate importance score
      const importanceScore = doc.metadata.importance;

      // Calculate recency score (decay over 7 days)
      const ageMs = now - doc.accessedAt;
      const ageHours = ageMs / (1000 * 60 * 60);
      const recencyScore = Math.max(0, 1 - ageHours / 168);

      // Find matched topics and tags
      const matchedTopics = doc.metadata.topics?.filter((t) => queryTopics.includes(t)) || [];
      const matchedTags = doc.metadata.tags?.filter((t) => options.tags.includes(t)) || [];

      // Topic bonus
      const topicBonus = matchedTopics.length * 0.1;

      // Calculate final score
      let finalScore =
        semanticScore * options.semanticWeight +
        importanceScore * options.importanceWeight +
        recencyScore * options.recencyWeight +
        topicBonus;

      // Apply boosting
      if (options.boostByImportance && importanceScore > 0.7) {
        finalScore *= 1.1; // 10% boost for high importance
      }
      if (options.boostByRecency && recencyScore > 0.8) {
        finalScore *= 1.05; // 5% boost for very recent
      }

      // Normalize to 0-1
      finalScore = clamp01(finalScore);

      enhanced.push({
        result,
        finalScore,
        semanticScore,
        importanceScore,
        recencyScore,
        relevance: {
          matchedTopics,
          matchedTags,
          ageInHours: ageHours,
        },
      });
    }

    // Sort by final score
    enhanced.sort((a, b) => b.finalScore - a.finalScore);

    return enhanced;
  }

  /**
   * Get search statistics
   */
  async getStats(): Promise<{
    totalDocuments: number;
    averageImportance: number;
    topTopics: Array<{ topic: string; count: number }>;
  }> {
    const vectorStore = await getVectorStore();
    const stats = await vectorStore.getStats();
    const indexManager = (vectorStore as unknown as { indexManager: { getTopicStats: () => Array<{ topic: string; count: number }> } }).indexManager;

    return {
      totalDocuments: stats.totalVectors,
      averageImportance: stats.averageImportance,
      topTopics: indexManager?.getTopicStats?.() || [],
    };
  }

  // Type-safe event emitter methods
  on<K extends keyof SemanticSearchEvents>(event: K, listener: SemanticSearchEvents[K]): this {
    return super.on(event, listener);
  }

  off<K extends keyof SemanticSearchEvents>(event: K, listener: SemanticSearchEvents[K]): this {
    return super.off(event, listener);
  }

  emit<K extends keyof SemanticSearchEvents>(
    event: K,
    ...args: Parameters<SemanticSearchEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }
}

// Singleton instance
let searchService: SemanticSearchService | null = null;

/**
 * Get or create the semantic search service
 */
export function getSemanticSearchService(): SemanticSearchService {
  if (!searchService) {
    searchService = new SemanticSearchService();
  }
  return searchService;
}

export default SemanticSearchService;
