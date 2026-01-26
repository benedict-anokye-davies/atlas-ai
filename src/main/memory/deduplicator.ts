/**
 * Atlas Desktop - Semantic Deduplicator
 * Detects and merges semantically similar memories to prevent redundancy
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import {
  getVectorStore,
  UnifiedVectorStore,
  VectorDocument,
} from './vector-store';
import { EmbeddingGenerator, getEmbeddingGenerator } from './vector-store/embeddings';

const logger = createModuleLogger('Deduplicator');

/**
 * Deduplication configuration
 */
export interface DeduplicationConfig {
  /** Similarity threshold (0-1) for considering memories as duplicates (default: 0.85) */
  similarityThreshold: number;
  /** Minimum importance difference to prefer one memory over another */
  importanceDifferenceThreshold: number;
  /** Maximum age difference (ms) to consider memories as duplicates */
  maxAgeDifferenceMs: number;
  /** Batch size for processing memories */
  batchSize: number;
  /** Enable scheduled deduplication */
  enableScheduled: boolean;
  /** Scheduled deduplication interval (ms, default: 6 hours) */
  scheduledIntervalMs: number;
  /** Preserve memories with importance above this threshold even if duplicates */
  preserveImportanceThreshold: number;
  /** Minimum content length difference ratio to consider as variation */
  contentLengthVariationRatio: number;
  /** Maximum memories to process per run */
  maxMemoriesPerRun: number;
}

/**
 * Default deduplication configuration
 */
const DEFAULT_CONFIG: DeduplicationConfig = {
  similarityThreshold: 0.85,
  importanceDifferenceThreshold: 0.1,
  maxAgeDifferenceMs: 7 * 24 * 60 * 60 * 1000, // 7 days
  batchSize: 50,
  enableScheduled: true,
  scheduledIntervalMs: 6 * 60 * 60 * 1000, // 6 hours
  preserveImportanceThreshold: 0.9,
  contentLengthVariationRatio: 0.3,
  maxMemoriesPerRun: 500,
};

/**
 * A pair of memories identified as potential duplicates
 */
export interface DuplicatePair {
  /** First memory in the pair */
  memory1: VectorDocument;
  /** Second memory in the pair */
  memory2: VectorDocument;
  /** Similarity score between the two */
  similarity: number;
  /** Recommended action */
  action: 'merge' | 'keep_both' | 'remove_older';
  /** Reason for the recommendation */
  reason: string;
}

/**
 * Result of merging two memories
 */
export interface MergeResult {
  /** The merged/kept memory */
  kept: VectorDocument;
  /** The removed memory ID */
  removedId: string;
  /** Whether content was merged */
  contentMerged: boolean;
  /** Merge strategy used */
  strategy: 'keep_newer' | 'keep_longer' | 'keep_important' | 'merge_content';
}

/**
 * Deduplication run result
 */
export interface DeduplicationResult {
  /** Total memories scanned */
  memoriesScanned: number;
  /** Duplicate pairs found */
  duplicatePairsFound: number;
  /** Memories merged */
  memoriesMerged: number;
  /** Memories removed */
  memoriesRemoved: number;
  /** Memories preserved (important variations) */
  memoriesPreserved: number;
  /** Processing duration (ms) */
  durationMs: number;
  /** Timestamp of the run */
  timestamp: number;
  /** Any errors encountered */
  errors: string[];
}

/**
 * Deduplicator events
 */
export interface DeduplicatorEvents {
  'deduplication-started': (reason: string) => void;
  'deduplication-completed': (result: DeduplicationResult) => void;
  'duplicate-found': (pair: DuplicatePair) => void;
  'memory-merged': (result: MergeResult) => void;
  'memory-preserved': (memory: VectorDocument, reason: string) => void;
  'scheduled-run': () => void;
  error: (error: Error) => void;
}

/**
 * Semantic Deduplicator
 * Detects and handles duplicate memories based on semantic similarity
 */
export class SemanticDeduplicator extends EventEmitter {
  private config: DeduplicationConfig;
  private vectorStore: UnifiedVectorStore | null = null;
  private embedder: EmbeddingGenerator | null = null;
  private scheduledTimer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private lastResult: DeduplicationResult | null = null;

  constructor(config?: Partial<DeduplicationConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    logger.info('SemanticDeduplicator created', { config: this.config });
  }

  /**
   * Initialize the deduplicator
   */
  async initialize(): Promise<void> {
    try {
      this.vectorStore = await getVectorStore();
      this.embedder = await getEmbeddingGenerator();

      // Start scheduled deduplication if enabled
      if (this.config.enableScheduled) {
        this.startScheduledDeduplication();
      }

      logger.info('SemanticDeduplicator initialized');
    } catch (error) {
      logger.error('Failed to initialize SemanticDeduplicator', {
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * Start scheduled deduplication
   */
  private startScheduledDeduplication(): void {
    if (this.scheduledTimer) {
      clearInterval(this.scheduledTimer);
    }

    this.scheduledTimer = setInterval(() => {
      this.emit('scheduled-run');
      this.runDeduplication('scheduled').catch((error) => {
        logger.error('Scheduled deduplication failed', { error: (error as Error).message });
      });
    }, this.config.scheduledIntervalMs);

    logger.info('Scheduled deduplication started', {
      intervalMs: this.config.scheduledIntervalMs,
    });
  }

  /**
   * Stop scheduled deduplication
   */
  private stopScheduledDeduplication(): void {
    if (this.scheduledTimer) {
      clearInterval(this.scheduledTimer);
      this.scheduledTimer = null;
      logger.info('Scheduled deduplication stopped');
    }
  }

  /**
   * Run deduplication process
   */
  async runDeduplication(reason: string = 'manual'): Promise<DeduplicationResult> {
    if (this.isRunning) {
      logger.warn('Deduplication already in progress');
      return this.lastResult || this.createEmptyResult();
    }

    if (!this.vectorStore || !this.embedder) {
      throw new Error('Deduplicator not initialized');
    }

    this.isRunning = true;
    this.emit('deduplication-started', reason);
    const startTime = Date.now();
    const errors: string[] = [];

    let memoriesScanned = 0;
    let duplicatePairsFound = 0;
    let memoriesMerged = 0;
    let memoriesRemoved = 0;
    let memoriesPreserved = 0;

    try {
      // Get all documents to process
      const allDocs = this.vectorStore.getByRecency(this.config.maxMemoriesPerRun);
      memoriesScanned = allDocs.length;

      logger.debug('Starting deduplication scan', { documentCount: allDocs.length });

      // Find duplicate pairs
      const duplicatePairs = await this.findDuplicatePairs(allDocs);
      duplicatePairsFound = duplicatePairs.length;

      logger.debug('Duplicate pairs found', { count: duplicatePairsFound });

      // Process each duplicate pair
      const processedIds = new Set<string>();

      for (const pair of duplicatePairs) {
        // Skip if either memory was already processed
        if (processedIds.has(pair.memory1.id) || processedIds.has(pair.memory2.id)) {
          continue;
        }

        this.emit('duplicate-found', pair);

        try {
          switch (pair.action) {
            case 'merge': {
              const mergeResult = await this.mergeMemories(pair.memory1, pair.memory2);
              this.emit('memory-merged', mergeResult);
              memoriesMerged++;
              memoriesRemoved++;
              processedIds.add(mergeResult.removedId);
              break;
            }

            case 'remove_older': {
              const [older, newer] =
                pair.memory1.createdAt < pair.memory2.createdAt
                  ? [pair.memory1, pair.memory2]
                  : [pair.memory2, pair.memory1];

              await this.vectorStore!.delete(older.id);
              memoriesRemoved++;
              processedIds.add(older.id);

              logger.debug('Removed older duplicate', {
                removedId: older.id,
                keptId: newer.id,
              });
              break;
            }

            case 'keep_both': {
              this.emit('memory-preserved', pair.memory1, pair.reason);
              this.emit('memory-preserved', pair.memory2, pair.reason);
              memoriesPreserved += 2;
              processedIds.add(pair.memory1.id);
              processedIds.add(pair.memory2.id);
              break;
            }
          }
        } catch (error) {
          const errorMsg = `Failed to process pair (${pair.memory1.id}, ${pair.memory2.id}): ${(error as Error).message}`;
          errors.push(errorMsg);
          logger.error(errorMsg);
        }
      }

      const result: DeduplicationResult = {
        memoriesScanned,
        duplicatePairsFound,
        memoriesMerged,
        memoriesRemoved,
        memoriesPreserved,
        durationMs: Date.now() - startTime,
        timestamp: Date.now(),
        errors,
      };

      this.lastResult = result;
      this.emit('deduplication-completed', result);

      logger.info('Deduplication completed', {
        reason,
        memoriesScanned,
        duplicatePairsFound,
        memoriesMerged,
        memoriesRemoved,
        memoriesPreserved,
        durationMs: result.durationMs,
      });

      return result;
    } catch (error) {
      this.emit('error', error as Error);
      logger.error('Deduplication failed', { error: (error as Error).message });
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Find all duplicate pairs in the document set
   */
  private async findDuplicatePairs(documents: VectorDocument[]): Promise<DuplicatePair[]> {
    const duplicatePairs: DuplicatePair[] = [];
    const checkedPairs = new Set<string>();

    // Process in batches to avoid memory issues
    for (let i = 0; i < documents.length; i += this.config.batchSize) {
      const batch = documents.slice(i, i + this.config.batchSize);

      for (const doc1 of batch) {
        // Compare with all other documents
        for (const doc2 of documents) {
          // Skip same document
          if (doc1.id === doc2.id) continue;

          // Skip already checked pairs
          const pairKey = [doc1.id, doc2.id].sort().join(':');
          if (checkedPairs.has(pairKey)) continue;
          checkedPairs.add(pairKey);

          // Skip documents from different source types (usually different purposes)
          if (doc1.metadata.sourceType !== doc2.metadata.sourceType) continue;

          // Calculate similarity
          const similarity = this.embedder!.cosineSimilarity(doc1.vector, doc2.vector);

          if (similarity >= this.config.similarityThreshold) {
            const pair = this.analyzeDuplicatePair(doc1, doc2, similarity);
            duplicatePairs.push(pair);
          }
        }
      }
    }

    // Sort by similarity descending (process most similar first)
    duplicatePairs.sort((a, b) => b.similarity - a.similarity);

    return duplicatePairs;
  }

  /**
   * Analyze a duplicate pair and determine the recommended action
   */
  private analyzeDuplicatePair(
    memory1: VectorDocument,
    memory2: VectorDocument,
    similarity: number
  ): DuplicatePair {
    // Check if either memory is above the preservation threshold
    if (
      memory1.metadata.importance >= this.config.preserveImportanceThreshold &&
      memory2.metadata.importance >= this.config.preserveImportanceThreshold
    ) {
      return {
        memory1,
        memory2,
        similarity,
        action: 'keep_both',
        reason: 'Both memories have high importance',
      };
    }

    // Check content length variation
    const lengthRatio = Math.abs(memory1.content.length - memory2.content.length) /
      Math.max(memory1.content.length, memory2.content.length);

    if (lengthRatio > this.config.contentLengthVariationRatio) {
      return {
        memory1,
        memory2,
        similarity,
        action: 'keep_both',
        reason: `Significant content length variation (${(lengthRatio * 100).toFixed(1)}%)`,
      };
    }

    // Check age difference
    const ageDifference = Math.abs(memory1.createdAt - memory2.createdAt);
    if (ageDifference > this.config.maxAgeDifferenceMs) {
      return {
        memory1,
        memory2,
        similarity,
        action: 'keep_both',
        reason: 'Large time gap between memories',
      };
    }

    // Check importance difference
    const importanceDiff = Math.abs(memory1.metadata.importance - memory2.metadata.importance);
    if (importanceDiff > this.config.importanceDifferenceThreshold) {
      return {
        memory1,
        memory2,
        similarity,
        action: 'merge',
        reason: 'Keeping more important memory',
      };
    }

    // For very similar memories, prefer the newer one
    if (similarity > 0.95) {
      return {
        memory1,
        memory2,
        similarity,
        action: 'remove_older',
        reason: 'Near-identical content, keeping newer version',
      };
    }

    // Default: merge and keep the best version
    return {
      memory1,
      memory2,
      similarity,
      action: 'merge',
      reason: 'Merging semantically similar memories',
    };
  }

  /**
   * Merge two memories into one
   */
  private async mergeMemories(
    memory1: VectorDocument,
    memory2: VectorDocument
  ): Promise<MergeResult> {
    // Determine which memory to keep based on multiple factors
    const score1 = this.calculateMergeScore(memory1);
    const score2 = this.calculateMergeScore(memory2);

    const [keep, remove] = score1 >= score2 ? [memory1, memory2] : [memory2, memory1];

    let strategy: MergeResult['strategy'];
    let contentMerged = false;

    // Determine strategy
    if (keep.content.length > remove.content.length * 1.2) {
      strategy = 'keep_longer';
    } else if (keep.metadata.importance > remove.metadata.importance) {
      strategy = 'keep_important';
    } else if (keep.createdAt > remove.createdAt) {
      strategy = 'keep_newer';
    } else {
      // Try to merge content if they have complementary information
      const mergedContent = this.mergeContent(keep, remove);
      if (mergedContent !== keep.content) {
        contentMerged = true;
        strategy = 'merge_content';

        // Update the kept memory with merged content
        await this.vectorStore!.updateMetadata(keep.id, {
          ...keep.metadata,
          custom: {
            ...keep.metadata.custom,
            mergedFrom: remove.id,
            mergedAt: Date.now(),
          },
        });
      } else {
        strategy = 'keep_newer';
      }
    }

    // Update the kept memory's access count to combine both
    const combinedAccessCount =
      keep.metadata.accessCount + remove.metadata.accessCount;

    await this.vectorStore!.updateMetadata(keep.id, {
      ...keep.metadata,
      accessCount: combinedAccessCount,
      importance: Math.max(keep.metadata.importance, remove.metadata.importance),
    });

    // Remove the duplicate
    await this.vectorStore!.delete(remove.id);

    logger.debug('Memories merged', {
      keptId: keep.id,
      removedId: remove.id,
      strategy,
      contentMerged,
    });

    return {
      kept: keep,
      removedId: remove.id,
      contentMerged,
      strategy,
    };
  }

  /**
   * Calculate a merge score for a memory (higher = better to keep)
   */
  private calculateMergeScore(memory: VectorDocument): number {
    let score = 0;

    // Prefer longer content
    score += memory.content.length * 0.001;

    // Prefer higher importance
    score += memory.metadata.importance * 10;

    // Prefer more accessed
    score += Math.min(memory.metadata.accessCount, 100) * 0.1;

    // Prefer newer memories (slight preference)
    const ageInDays = (Date.now() - memory.createdAt) / (24 * 60 * 60 * 1000);
    score += Math.max(0, 30 - ageInDays) * 0.1;

    // Prefer non-summary original content
    if (!memory.metadata.isSummary) {
      score += 2;
    }

    return score;
  }

  /**
   * Attempt to merge content from two memories
   */
  private mergeContent(keep: VectorDocument, remove: VectorDocument): string {
    // If keep is already longer, just return it
    if (keep.content.length >= remove.content.length * 1.1) {
      return keep.content;
    }

    // Simple merge: check if remove has additional sentences
    const keepSentences = new Set(this.extractSentences(keep.content));
    const removeSentences = this.extractSentences(remove.content);

    const newSentences: string[] = [];
    for (const sentence of removeSentences) {
      // Check if this sentence adds new information
      let isNew = true;
      for (const existingSentence of keepSentences) {
        if (this.areSentencesSimilar(sentence, existingSentence)) {
          isNew = false;
          break;
        }
      }
      if (isNew && sentence.length > 10) {
        newSentences.push(sentence);
      }
    }

    // Only merge if there are meaningful additions
    if (newSentences.length > 0 && newSentences.length < 5) {
      return keep.content + ' ' + newSentences.join(' ');
    }

    return keep.content;
  }

  /**
   * Extract sentences from text
   */
  private extractSentences(text: string): string[] {
    return text
      .split(/[.!?]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  /**
   * Check if two sentences are similar (simple check)
   */
  private areSentencesSimilar(s1: string, s2: string): boolean {
    const normalize = (s: string) =>
      s
        .toLowerCase()
        .replace(/[^\w\s]/g, '')
        .trim();
    const n1 = normalize(s1);
    const n2 = normalize(s2);

    // Check for containment
    if (n1.includes(n2) || n2.includes(n1)) {
      return true;
    }

    // Check word overlap
    const words1 = new Set(n1.split(/\s+/));
    const words2 = new Set(n2.split(/\s+/));
    const intersection = new Set([...words1].filter((w) => words2.has(w)));

    const overlapRatio =
      (intersection.size * 2) / (words1.size + words2.size);
    return overlapRatio > 0.7;
  }

  /**
   * Find duplicates for a specific memory
   */
  async findDuplicatesFor(memoryId: string): Promise<DuplicatePair[]> {
    if (!this.vectorStore || !this.embedder) {
      throw new Error('Deduplicator not initialized');
    }

    const memory = await this.vectorStore.get(memoryId);
    if (!memory) {
      throw new Error(`Memory not found: ${memoryId}`);
    }

    const allDocs = this.vectorStore.getByRecency(this.config.maxMemoriesPerRun);
    const duplicates: DuplicatePair[] = [];

    for (const doc of allDocs) {
      if (doc.id === memoryId) continue;
      if (doc.metadata.sourceType !== memory.metadata.sourceType) continue;

      const similarity = this.embedder.cosineSimilarity(memory.vector, doc.vector);
      if (similarity >= this.config.similarityThreshold) {
        duplicates.push(this.analyzeDuplicatePair(memory, doc, similarity));
      }
    }

    return duplicates.sort((a, b) => b.similarity - a.similarity);
  }

  /**
   * Check if a new memory would be a duplicate
   */
  async checkForDuplicate(content: string): Promise<DuplicatePair | null> {
    if (!this.vectorStore || !this.embedder) {
      throw new Error('Deduplicator not initialized');
    }

    // Generate embedding for the new content
    const { vector } = await this.embedder.embed(content);

    // Search for similar memories
    const results = await this.vectorStore.searchByVector(vector, {
      limit: 5,
      minScore: this.config.similarityThreshold,
    });

    if (results.length === 0) {
      return null;
    }

    // Return the most similar match
    const bestMatch = results[0];
    const tempDoc: VectorDocument = {
      id: 'temp',
      vector,
      content,
      metadata: {
        sourceType: 'other',
        importance: 0.5,
        accessCount: 0,
      },
      createdAt: Date.now(),
      accessedAt: Date.now(),
    };

    return this.analyzeDuplicatePair(tempDoc, bestMatch.document, bestMatch.score);
  }

  /**
   * Get deduplication statistics
   */
  getStats(): {
    lastResult: DeduplicationResult | null;
    isRunning: boolean;
    config: DeduplicationConfig;
  } {
    return {
      lastResult: this.lastResult,
      isRunning: this.isRunning,
      config: this.config,
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<DeduplicationConfig>): void {
    const wasScheduled = this.config.enableScheduled && this.scheduledTimer !== null;

    this.config = { ...this.config, ...config };

    // Handle scheduled deduplication changes
    if (this.config.enableScheduled && !wasScheduled) {
      this.startScheduledDeduplication();
    } else if (!this.config.enableScheduled && wasScheduled) {
      this.stopScheduledDeduplication();
    } else if (wasScheduled && this.config.scheduledIntervalMs !== DEFAULT_CONFIG.scheduledIntervalMs) {
      // Restart with new interval
      this.stopScheduledDeduplication();
      this.startScheduledDeduplication();
    }

    logger.info('Deduplicator config updated', { config: this.config });
  }

  /**
   * Create empty result
   */
  private createEmptyResult(): DeduplicationResult {
    return {
      memoriesScanned: 0,
      duplicatePairsFound: 0,
      memoriesMerged: 0,
      memoriesRemoved: 0,
      memoriesPreserved: 0,
      durationMs: 0,
      timestamp: Date.now(),
      errors: [],
    };
  }

  /**
   * Force immediate deduplication
   */
  async forceDeduplication(): Promise<DeduplicationResult> {
    return this.runDeduplication('forced');
  }

  /**
   * Shutdown the deduplicator
   */
  shutdown(): void {
    this.stopScheduledDeduplication();
    this.removeAllListeners();
    logger.info('SemanticDeduplicator shutdown');
  }

  // Type-safe event emitter methods
  on<K extends keyof DeduplicatorEvents>(event: K, listener: DeduplicatorEvents[K]): this {
    return super.on(event, listener);
  }

  off<K extends keyof DeduplicatorEvents>(event: K, listener: DeduplicatorEvents[K]): this {
    return super.off(event, listener);
  }

  emit<K extends keyof DeduplicatorEvents>(
    event: K,
    ...args: Parameters<DeduplicatorEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }
}

// Singleton instance
let deduplicator: SemanticDeduplicator | null = null;

/**
 * Get or create the deduplicator instance
 */
export async function getSemanticDeduplicator(
  config?: Partial<DeduplicationConfig>
): Promise<SemanticDeduplicator> {
  if (!deduplicator) {
    deduplicator = new SemanticDeduplicator(config);
    await deduplicator.initialize();
  }
  return deduplicator;
}

/**
 * Run deduplication manually
 */
export async function runDeduplication(
  reason?: string
): Promise<DeduplicationResult> {
  const dup = await getSemanticDeduplicator();
  return dup.runDeduplication(reason);
}

/**
 * Check if content would be a duplicate
 */
export async function checkDuplicate(content: string): Promise<DuplicatePair | null> {
  const dup = await getSemanticDeduplicator();
  return dup.checkForDuplicate(content);
}

/**
 * Shutdown the deduplicator
 */
export function shutdownSemanticDeduplicator(): void {
  if (deduplicator) {
    deduplicator.shutdown();
    deduplicator = null;
  }
}

export default SemanticDeduplicator;
