/**
 * @fileoverview Unified Memory Brain - Atlas's Complete Memory System
 * @module memory/unified-brain
 * @author Atlas Team
 * @since 1.0.0
 * 
 * @description
 * The UnifiedMemoryBrain is the central intelligence layer that combines
 * all of Atlas's memory systems into a coherent, queryable whole:
 * 
 * 1. **MemoryManager** - Conversation history and session management
 * 2. **ObsidianBrain** - Human-readable markdown notes with backlinks
 * 3. **KnowledgeStore** - Structured facts and relationships
 * 4. **LanceDB** - Vector embeddings for semantic search
 * 5. **Personality/Context** - Current context and user understanding
 * 
 * This module provides:
 * - Unified query interface across all memory types
 * - Automatic memory consolidation and deduplication
 * - Semantic relationship discovery
 * - Context-aware memory retrieval
 * - Memory importance ranking
 * - Forgetting/pruning strategies
 * 
 * @example
 * ```typescript
 * const brain = getUnifiedBrain();
 * await brain.initialize();
 * 
 * // Store a memory (auto-routes to correct storage)
 * await brain.remember({
 *   content: 'User prefers TypeScript over JavaScript',
 *   type: 'preference',
 *   importance: 0.8,
 * });
 * 
 * // Unified search across all memory
 * const results = await brain.recall('programming language preferences');
 * 
 * // Get contextual memories for LLM
 * const context = await brain.getContextForQuery('Help me write some code');
 * ```
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import { getMemoryManager, MemoryEntry, MemoryType } from './index';
import { 
  getKnowledgeStore, 
  KnowledgeEntry, 
  KnowledgeCategory 
} from './knowledge-store';
import { 
  getVaultPath, 
  initializeVault, 
  VaultDirectory 
} from './obsidian-brain';
import { createNote, readNote, NoteMetadata } from './note-writer';
import { 
  getLanceSyncManager, 
  VaultSearchResult, 
  VaultSearchOptions 
} from './lance-sync';
import { extractBacklinks, findBacklinksTo, buildLinkGraph } from './backlinks';
import { getPreferenceLearner } from './preference-learner';
import { getUserProfileManager, UserProfileManager } from './user-profile';
import { getTopicDetector, TopicDetector, DetectedTopic } from './topic-detector';
import { getImportanceScorer, ImportanceScorer } from './importance-scorer';
import { getSemanticDeduplicator, SemanticDeduplicator } from './deduplicator';
import { ChatMessage } from '../../shared/types/llm';

const logger = createModuleLogger('UnifiedBrain');

// =============================================================================
// Types
// =============================================================================

/**
 * Memory source type
 */
export type MemorySource = 
  | 'conversation'    // From chat history
  | 'obsidian'        // From markdown notes
  | 'knowledge'       // From knowledge store
  | 'vector'          // From vector similarity
  | 'inferred'        // Inferred from patterns
  | 'worldbox';       // From WorldBox observations

/**
 * Unified memory item that can come from any source
 */
export interface UnifiedMemory {
  id: string;
  content: string;
  type: MemoryType | KnowledgeCategory | 'note' | 'insight';
  source: MemorySource;
  importance: number;
  relevanceScore?: number;
  createdAt: number;
  accessedAt: number;
  tags: string[];
  metadata?: Record<string, unknown>;
  
  // Source-specific data
  originalEntry?: MemoryEntry | KnowledgeEntry | NoteMetadata;
  backlinks?: string[];
  relationships?: Array<{ target: string; relationship: string }>;
}

/**
 * Query for unified memory search
 */
export interface MemoryQuery {
  text: string;
  types?: Array<MemoryType | KnowledgeCategory | 'note'>;
  sources?: MemorySource[];
  minImportance?: number;
  limit?: number;
  includeRelated?: boolean;
  timeRange?: {
    start?: number;
    end?: number;
  };
  tags?: string[];
}

/**
 * Context bundle for LLM
 */
export interface ContextBundle {
  relevantMemories: UnifiedMemory[];
  userPreferences: Record<string, unknown>;
  currentTopics: string[];
  recentContext: string[];
  relationshipMap: Map<string, string[]>;
  worldboxWisdom?: string[];
  totalTokenEstimate: number;
}

/**
 * Memory storage request
 */
export interface RememberRequest {
  content: string;
  type: MemoryType | KnowledgeCategory;
  importance?: number;
  tags?: string[];
  source?: MemorySource;
  metadata?: Record<string, unknown>;
  relationships?: Array<{ target: string; relationship: string }>;
}

// =============================================================================
// UnifiedMemoryBrain Class
// =============================================================================

/**
 * Unified Memory Brain
 * 
 * Central orchestrator for all of Atlas's memory systems.
 * Provides a single, coherent interface for memory operations.
 */
export class UnifiedMemoryBrain extends EventEmitter {
  private initialized = false;
  private memoryCache: Map<string, UnifiedMemory> = new Map();
  private relationshipGraph: Map<string, Set<string>> = new Map();
  
  // Cached subsystem instances (resolved from async getters)
  private memoryManager: Awaited<ReturnType<typeof getMemoryManager>> | null = null;
  private knowledgeStore: Awaited<ReturnType<typeof getKnowledgeStore>> | null = null;
  private lanceSync: Awaited<ReturnType<typeof getLanceSyncManager>> | null = null;
  private topicDetector: TopicDetector | null = null;
  private profileManager: UserProfileManager | null = null;
  private importanceScorer: ImportanceScorer | null = null;
  private deduplicator: SemanticDeduplicator | null = null;
  
  // Stats tracking
  private stats = {
    totalMemories: 0,
    queriesProcessed: 0,
    memoriesStored: 0,
    cacheHits: 0,
    cacheMisses: 0,
  };

  constructor() {
    super();
    logger.info('UnifiedMemoryBrain created');
  }

  // ===========================================================================
  // Initialization
  // ===========================================================================

  /**
   * Initialize the unified brain
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    logger.info('Initializing UnifiedMemoryBrain...');

    try {
      // Initialize subsystems in order (these are async getters that auto-initialize)
      this.memoryManager = await getMemoryManager();
      this.knowledgeStore = await getKnowledgeStore();
      await initializeVault();
      this.lanceSync = await getLanceSyncManager();
      
      // Get sync singletons (some are async)
      this.topicDetector = getTopicDetector();
      this.profileManager = await getUserProfileManager();
      this.importanceScorer = getImportanceScorer();
      this.deduplicator = await getSemanticDeduplicator();

      // Build initial relationship graph
      await this.buildRelationshipGraph();

      // Load WorldBox wisdom if available
      await this.loadWorldBoxWisdom();

      this.initialized = true;
      this.emit('initialized');
      logger.info('UnifiedMemoryBrain initialized');
    } catch (error) {
      logger.error('Failed to initialize UnifiedMemoryBrain', { error });
      throw error;
    }
  }

  // ===========================================================================
  // Core Memory Operations
  // ===========================================================================

  /**
   * Store a memory - auto-routes to appropriate storage
   * 
   * @param request - Memory to store
   * @returns The stored unified memory
   */
  async remember(request: RememberRequest): Promise<UnifiedMemory> {
    if (!this.initialized) await this.initialize();

    logger.debug('Remembering new memory', { type: request.type, content: request.content.slice(0, 100) });

    // Calculate importance if not provided
    const importance = request.importance ?? await this.calculateImportance(request.content);

    // Check for duplicates using the cached deduplicator
    if (this.deduplicator) {
      const duplicates = await this.deduplicator.findDuplicatesFor(request.content);
      if (duplicates.length > 0) {
        const duplicate = duplicates[0];
        logger.debug('Found duplicate, reinforcing existing memory', { duplicateId: duplicate.memory1.id });
        return this.reinforceMemory(duplicate.memory1.id);
      }
    }

    // Route to appropriate storage
    let storedId: string;
    let unifiedMemory: UnifiedMemory;

    if (this.isKnowledgeCategory(request.type)) {
      // Store as knowledge
      storedId = await this.storeAsKnowledge(request, importance);
      unifiedMemory = await this.loadKnowledgeAsUnified(storedId);
    } else if (request.type === 'fact' || request.type === 'preference') {
      // Store in both knowledge store AND obsidian
      storedId = await this.storeAsKnowledge(request, importance);
      await this.storeAsNote(request, importance);
      unifiedMemory = await this.loadKnowledgeAsUnified(storedId);
    } else {
      // Store in memory manager
      storedId = await this.storeInMemory(request, importance);
      unifiedMemory = await this.loadMemoryAsUnified(storedId);
    }

    // Update relationship graph
    if (request.relationships) {
      for (const rel of request.relationships) {
        this.addRelationship(storedId, rel.target, rel.relationship);
      }
    }

    // Update cache
    this.memoryCache.set(storedId, unifiedMemory);

    // Emit event
    this.emit('memory-stored', unifiedMemory);
    this.stats.memoriesStored++;

    return unifiedMemory;
  }

  /**
   * Recall memories based on a query
   * 
   * @param query - Search query (string or structured)
   * @returns Array of relevant memories, ranked by relevance
   */
  async recall(query: string | MemoryQuery): Promise<UnifiedMemory[]> {
    if (!this.initialized) await this.initialize();

    const structuredQuery: MemoryQuery = typeof query === 'string' 
      ? { text: query, limit: 10 }
      : query;

    logger.debug('Recalling memories', { query: structuredQuery.text });
    this.stats.queriesProcessed++;

    const results: UnifiedMemory[] = [];

    // 1. Vector search (most relevant)
    const vectorResults = await this.searchVectors(structuredQuery);
    results.push(...vectorResults);

    // 2. Knowledge store search
    const knowledgeResults = await this.searchKnowledge(structuredQuery);
    results.push(...knowledgeResults);

    // 3. Memory manager search
    const memoryResults = await this.searchMemory(structuredQuery);
    results.push(...memoryResults);

    // 4. Include related memories if requested
    if (structuredQuery.includeRelated) {
      const relatedIds = new Set<string>();
      for (const memory of results) {
        const related = this.relationshipGraph.get(memory.id);
        if (related) {
          related.forEach(id => relatedIds.add(id));
        }
      }
      
      for (const id of relatedIds) {
        const cached = this.memoryCache.get(id);
        if (cached && !results.find(r => r.id === id)) {
          results.push({ ...cached, relevanceScore: 0.5 });
        }
      }
    }

    // Deduplicate and rank
    const deduplicated = this.deduplicateResults(results);
    const ranked = this.rankResults(deduplicated, structuredQuery.text);

    // Apply limit
    const limited = ranked.slice(0, structuredQuery.limit || 10);

    // Update access times
    for (const memory of limited) {
      memory.accessedAt = Date.now();
    }

    return limited;
  }

  /**
   * Get contextual memories for an LLM query
   * 
   * @param userMessage - The user's current message
   * @param maxTokens - Maximum tokens budget for context
   * @returns Context bundle for LLM
   */
  async getContextForQuery(userMessage: string, maxTokens: number = 2000): Promise<ContextBundle> {
    if (!this.initialized) await this.initialize();

    logger.debug('Building context for query', { message: userMessage.slice(0, 100), maxTokens });

    // Detect topics in the query using cached instance
    const topicResult = this.topicDetector?.detect(userMessage);
    const topics = topicResult?.topics || [];

    // Get user preferences using cached instance
    const _profile = this.profileManager?.getProfile();
    const preferences = this.profileManager?.getPreferences() || [];
    const preferencesMap: Record<string, unknown> = {};
    for (const pref of preferences) {
      preferencesMap[pref.key] = pref.value;
    }

    // Search for relevant memories
    const memories = await this.recall({
      text: userMessage,
      limit: 20,
      includeRelated: true,
    });

    // Get recent conversation context from cached memory manager
    const recentMessages = this.memoryManager?.getRecentMessages(5) || [];
    const recentContext = recentMessages.map((m: ChatMessage) => m.content);

    // Load WorldBox wisdom if relevant
    let worldboxWisdom: string[] | undefined;
    if (this.isEvolutionaryQuery(userMessage)) {
      worldboxWisdom = await this.getWorldBoxWisdom();
    }

    // Build relationship map for the context
    const relationshipMap = new Map<string, string[]>();
    for (const memory of memories) {
      const related = this.relationshipGraph.get(memory.id);
      if (related) {
        relationshipMap.set(memory.id, Array.from(related));
      }
    }

    // Estimate token count
    const tokenEstimate = this.estimateTokens(memories, recentContext, worldboxWisdom);

    // Prune if over budget
    let finalMemories = memories;
    if (tokenEstimate > maxTokens) {
      finalMemories = this.pruneToTokenBudget(memories, maxTokens, worldboxWisdom?.length || 0);
    }

    return {
      relevantMemories: finalMemories,
      userPreferences: preferencesMap,
      currentTopics: topics.map((t: DetectedTopic) => t.name),
      recentContext,
      relationshipMap,
      worldboxWisdom,
      totalTokenEstimate: this.estimateTokens(finalMemories, recentContext, worldboxWisdom),
    };
  }

  /**
   * Reinforce an existing memory (increase importance)
   */
  async reinforceMemory(memoryId: string): Promise<UnifiedMemory> {
    if (!this.initialized) await this.initialize();
    
    // Try knowledge store first using cached instance
    if (this.knowledgeStore) {
      // Use query() to find entry by searching for text that might match
      const allEntries = this.knowledgeStore.query({});
      const entry = allEntries.find((e: KnowledgeEntry) => e.id === memoryId);
      if (entry) {
        // Reinforce by using reinforceKnowledge
        this.knowledgeStore.reinforceKnowledge(memoryId, 0.1);
        return this.loadKnowledgeAsUnified(memoryId);
      }
    }

    // Try memory manager using cached instance
    if (this.memoryManager) {
      const entry = this.memoryManager.getEntry(memoryId);
      if (entry) {
        entry.importance = Math.min(1.0, entry.importance + 0.1);
        entry.accessedAt = Date.now();
        return this.loadMemoryAsUnified(memoryId);
      }
    }

    throw new Error(`Memory not found: ${memoryId}`);
  }

  /**
   * Forget a memory
   */
  async forget(memoryId: string): Promise<boolean> {
    if (!this.initialized) await this.initialize();

    // Remove from cache
    this.memoryCache.delete(memoryId);

    // Remove from relationship graph
    this.relationshipGraph.delete(memoryId);
    for (const [, relations] of this.relationshipGraph) {
      relations.delete(memoryId);
    }

    // Try both stores
    let removedFromKnowledge = false;
    let removedFromMemory = false;
    
    if (this.knowledgeStore) {
      removedFromKnowledge = this.knowledgeStore.removeKnowledge(memoryId);
    }
    if (this.memoryManager) {
      removedFromMemory = this.memoryManager.removeEntry(memoryId);
    }

    this.emit('memory-forgotten', memoryId);
    
    return removedFromKnowledge || removedFromMemory;
  }

  // ===========================================================================
  // Relationship Management
  // ===========================================================================

  /**
   * Add a relationship between memories
   */
  addRelationship(sourceId: string, targetId: string, relationship: string): void {
    if (!this.relationshipGraph.has(sourceId)) {
      this.relationshipGraph.set(sourceId, new Set());
    }
    this.relationshipGraph.get(sourceId)!.add(targetId);

    // Bidirectional
    if (!this.relationshipGraph.has(targetId)) {
      this.relationshipGraph.set(targetId, new Set());
    }
    this.relationshipGraph.get(targetId)!.add(sourceId);

    logger.debug('Added relationship', { sourceId, targetId, relationship });
  }

  /**
   * Get all memories related to a given memory
   */
  getRelatedMemories(memoryId: string): string[] {
    const related = this.relationshipGraph.get(memoryId);
    return related ? Array.from(related) : [];
  }

  // ===========================================================================
  // WorldBox Integration
  // ===========================================================================

  private worldboxWisdom: string[] = [];

  /**
   * Load wisdom from WorldBox observations
   */
  private async loadWorldBoxWisdom(): Promise<void> {
    try {
      const { getEvolutionaryObserver } = await import('../vm-agent/worldbox');
      const observer = getEvolutionaryObserver();
      this.worldboxWisdom = observer.getEvolutionaryWisdom();
      logger.debug('Loaded WorldBox wisdom', { count: this.worldboxWisdom.length });
    } catch {
      // WorldBox module might not be available
      logger.debug('WorldBox wisdom not available');
    }
  }

  /**
   * Get WorldBox evolutionary wisdom
   */
  async getWorldBoxWisdom(): Promise<string[]> {
    if (this.worldboxWisdom.length === 0) {
      await this.loadWorldBoxWisdom();
    }
    return this.worldboxWisdom;
  }

  /**
   * Check if query is about evolution/life/nature
   */
  private isEvolutionaryQuery(query: string): boolean {
    const evolutionaryKeywords = [
      'evolution', 'survival', 'adaptation', 'species', 'civilization',
      'extinct', 'nature', 'life', 'death', 'compete', 'cooperate',
      'war', 'peace', 'growth', 'decay', 'change', 'pattern',
    ];
    const lower = query.toLowerCase();
    return evolutionaryKeywords.some(keyword => lower.includes(keyword));
  }

  // ===========================================================================
  // Private Helper Methods
  // ===========================================================================

  private isKnowledgeCategory(type: string): type is KnowledgeCategory {
    return [
      'user_preference', 'user_fact', 'user_habit',
      'world_fact', 'task_pattern', 'relationship', 'custom'
    ].includes(type);
  }

  private async storeAsKnowledge(request: RememberRequest, importance: number): Promise<string> {
    if (!this.knowledgeStore) throw new Error('Knowledge store not initialized');
    
    // Parse subject-predicate-object if possible
    const parsed = this.parseKnowledgeTriple(request.content);
    
    const entry = this.knowledgeStore.addKnowledge({
      category: request.type as KnowledgeCategory,
      subject: parsed.subject,
      predicate: parsed.predicate,
      object: parsed.object,
      confidenceScore: importance,
      source: request.source === 'conversation' ? 'conversation' : 'explicit',
      tags: request.tags || [],
    });
    
    return entry.id;
  }

  private async storeAsNote(request: RememberRequest, importance: number): Promise<string> {
    const directory = this.getDirectoryForType(request.type);
    const title = this.generateNoteTitle(request.content);
    
    const metadata: NoteMetadata = {
      type: request.type,
      tags: request.tags || [],
      importance,
      ...request.metadata,
    };
    
    await createNote(directory, title, request.content, metadata);
    
    return `${directory}/${title}`;
  }

  private async storeInMemory(request: RememberRequest, importance: number): Promise<string> {
    if (!this.memoryManager) throw new Error('Memory manager not initialized');
    
    const entry = this.memoryManager.addEntry(
      request.type as MemoryType,
      request.content,
      {
        importance,
        tags: request.tags,
        metadata: request.metadata,
      }
    );
    
    return entry.id;
  }

  private async loadKnowledgeAsUnified(id: string): Promise<UnifiedMemory> {
    if (!this.knowledgeStore) throw new Error('Knowledge store not initialized');
    
    const allEntries = this.knowledgeStore.query({});
    const entry = allEntries.find((e: KnowledgeEntry) => e.id === id);
    
    if (!entry) {
      throw new Error(`Knowledge entry not found: ${id}`);
    }
    
    return {
      id: entry.id,
      content: entry.naturalForm,
      type: entry.category,
      source: entry.source as MemorySource,
      importance: entry.confidenceScore,
      createdAt: entry.createdAt,
      accessedAt: entry.accessedAt,
      tags: entry.tags,
      metadata: entry.metadata,
      originalEntry: entry,
    };
  }

  private async loadMemoryAsUnified(id: string): Promise<UnifiedMemory> {
    if (!this.memoryManager) throw new Error('Memory manager not initialized');
    
    const entry = this.memoryManager.getEntry(id);
    
    if (!entry) {
      throw new Error(`Memory entry not found: ${id}`);
    }
    
    return {
      id: entry.id,
      content: entry.content,
      type: entry.type,
      source: 'conversation',
      importance: entry.importance,
      createdAt: entry.createdAt,
      accessedAt: entry.accessedAt,
      tags: entry.tags || [],
      metadata: entry.metadata,
      originalEntry: entry,
    };
  }

  private async searchVectors(query: MemoryQuery): Promise<UnifiedMemory[]> {
    if (!this.lanceSync) return [];
    
    const options: VaultSearchOptions = {
      limit: query.limit || 10,
      minScore: 0.5,
    };
    
    const results = await this.lanceSync.searchNotes(query.text, options);
    
    return results.map((r: VaultSearchResult) => this.vaultResultToUnified(r));
  }

  private async searchKnowledge(query: MemoryQuery): Promise<UnifiedMemory[]> {
    if (!this.knowledgeStore) return [];
    
    // Query knowledge store - use query() with text and category filter
    // KnowledgeQuery supports text search natively
    const results = await this.knowledgeStore.query({
      text: query.text,
      category: query.types?.[0] as KnowledgeCategory,
      limit: query.limit || 10,
    });
    
    return results.map((entry: KnowledgeEntry) => ({
      id: entry.id,
      content: entry.naturalForm,
      type: entry.category,
      source: 'knowledge' as MemorySource,
      importance: entry.confidenceScore,
      relevanceScore: 0.7, // Knowledge matches are fairly relevant
      createdAt: entry.createdAt,
      accessedAt: entry.accessedAt,
      tags: entry.tags,
      originalEntry: entry,
    }));
  }

  private async searchMemory(query: MemoryQuery): Promise<UnifiedMemory[]> {
    if (!this.memoryManager) return [];
    
    const results = this.memoryManager.searchEntries({
      text: query.text,
      limit: query.limit || 10,
    });
    
    return results.map((entry: MemoryEntry) => ({
      id: entry.id,
      content: entry.content,
      type: entry.type,
      source: 'conversation' as MemorySource,
      importance: entry.importance,
      relevanceScore: 0.6,
      createdAt: entry.createdAt,
      accessedAt: entry.accessedAt,
      tags: entry.tags || [],
      originalEntry: entry,
    }));
  }

  private vaultResultToUnified(result: VaultSearchResult): UnifiedMemory {
    return {
      id: result.path,
      content: result.excerpt,
      type: 'note',
      source: 'obsidian',
      importance: result.score,
      relevanceScore: result.score,
      createdAt: result.metadata.created ? new Date(result.metadata.created as string).getTime() : Date.now(),
      accessedAt: Date.now(),
      tags: (result.metadata.tags as string[]) || [],
      metadata: result.metadata,
      backlinks: (result.metadata.backlinks as string[]) || undefined,
    };
  }

  private deduplicateResults(results: UnifiedMemory[]): UnifiedMemory[] {
    const seen = new Map<string, UnifiedMemory>();
    
    for (const memory of results) {
      const key = memory.id;
      const existing = seen.get(key);
      
      if (!existing || (memory.relevanceScore || 0) > (existing.relevanceScore || 0)) {
        seen.set(key, memory);
      }
    }
    
    return Array.from(seen.values());
  }

  private rankResults(results: UnifiedMemory[], _query: string): UnifiedMemory[] {
    return results.sort((a, b) => {
      // Primary: relevance score
      const relDiff = (b.relevanceScore || 0) - (a.relevanceScore || 0);
      if (Math.abs(relDiff) > 0.1) return relDiff;
      
      // Secondary: importance
      const impDiff = b.importance - a.importance;
      if (Math.abs(impDiff) > 0.1) return impDiff;
      
      // Tertiary: recency
      return b.accessedAt - a.accessedAt;
    });
  }

  private calculateImportance(content: string): number {
    if (!this.importanceScorer) return 0.5;
    // Use scoreMemory with a mock entry since score() doesn't exist
    const mockEntry: MemoryEntry = {
      id: 'temp',
      type: 'fact',
      content,
      importance: 0.5,
      createdAt: Date.now(),
      accessedAt: Date.now(),
    };
    const scored = this.importanceScorer.scoreMemory(mockEntry);
    return scored.finalScore;
  }

  private parseKnowledgeTriple(content: string): { subject: string; predicate: string; object: string } {
    // Simple parsing - could be enhanced with NLP
    const words = content.split(' ');
    
    if (words.length >= 3) {
      return {
        subject: words[0],
        predicate: words.slice(1, -1).join(' '),
        object: words[words.length - 1],
      };
    }
    
    return {
      subject: 'entity',
      predicate: 'has_property',
      object: content,
    };
  }

  private getDirectoryForType(type: string): VaultDirectory {
    const mapping: Record<string, VaultDirectory> = {
      'user_preference': 'profile',
      'user_fact': 'profile',
      'user_habit': 'profile',
      'preference': 'profile',
      'fact': 'concepts',
      'world_fact': 'concepts',
      'task_pattern': 'skills',
      'context': 'daily',
      'conversation': 'conversations',
    };
    
    return mapping[type] || 'concepts';
  }

  private generateNoteTitle(content: string): string {
    // Extract first meaningful phrase
    const cleaned = content.replace(/[^\w\s]/g, '').slice(0, 50);
    return cleaned.split(' ').slice(0, 5).join('-').toLowerCase();
  }

  private async buildRelationshipGraph(): Promise<void> {
    logger.debug('Building relationship graph...');
    
    if (!this.knowledgeStore) return;
    
    // Use query({}) to get all entries
    const entries = await this.knowledgeStore.query({});
    
    // Build relationships from knowledge entries
    for (const entry of entries) {
      // Connect entries with same subject
      const sameSubject = entries.filter(e => e.subject === entry.subject && e.id !== entry.id);
      for (const related of sameSubject) {
        this.addRelationship(entry.id, related.id, 'same_subject');
      }
      
      // Connect entries with same tags
      for (const tag of entry.tags) {
        const sameTag = entries.filter(e => e.tags.includes(tag) && e.id !== entry.id);
        for (const related of sameTag) {
          this.addRelationship(entry.id, related.id, 'same_tag');
        }
      }
    }
    
    logger.debug('Relationship graph built', { nodes: this.relationshipGraph.size });
  }

  private estimateTokens(memories: UnifiedMemory[], context: string[], wisdom?: string[]): number {
    let chars = 0;
    
    for (const memory of memories) {
      chars += memory.content.length;
    }
    
    for (const ctx of context) {
      chars += ctx.length;
    }
    
    if (wisdom) {
      for (const w of wisdom) {
        chars += w.length;
      }
    }
    
    // Rough estimate: 4 chars per token
    return Math.ceil(chars / 4);
  }

  private pruneToTokenBudget(
    memories: UnifiedMemory[], 
    maxTokens: number,
    wisdomTokens: number
  ): UnifiedMemory[] {
    const available = maxTokens - wisdomTokens - 200; // Reserve 200 for overhead
    let currentTokens = 0;
    const pruned: UnifiedMemory[] = [];
    
    // Already sorted by relevance
    for (const memory of memories) {
      const tokens = Math.ceil(memory.content.length / 4);
      if (currentTokens + tokens <= available) {
        pruned.push(memory);
        currentTokens += tokens;
      }
    }
    
    return pruned;
  }

  // ===========================================================================
  // Stats & Status
  // ===========================================================================

  /**
   * Get brain statistics
   */
  getStats(): typeof this.stats {
    return { ...this.stats };
  }

  /**
   * Get initialization status
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Shutdown the brain
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down UnifiedMemoryBrain...');
    
    // Save all subsystems - use cached instances
    if (this.memoryManager) {
      await this.memoryManager.shutdown();
    }
    
    if (this.knowledgeStore) {
      await this.knowledgeStore.save();
    }
    
    this.initialized = false;
    this.emit('shutdown');
  }
}

// =============================================================================
// Singleton
// =============================================================================

let brainInstance: UnifiedMemoryBrain | null = null;

/**
 * Get the UnifiedMemoryBrain singleton
 */
export function getUnifiedBrain(): UnifiedMemoryBrain {
  if (!brainInstance) {
    brainInstance = new UnifiedMemoryBrain();
  }
  return brainInstance;
}

/**
 * Initialize the unified brain
 */
export async function initializeUnifiedBrain(): Promise<UnifiedMemoryBrain> {
  const brain = getUnifiedBrain();
  await brain.initialize();
  return brain;
}

/**
 * Shutdown the unified brain
 */
export async function shutdownUnifiedBrain(): Promise<void> {
  if (brainInstance) {
    await brainInstance.shutdown();
    brainInstance = null;
  }
}

export default UnifiedMemoryBrain;
