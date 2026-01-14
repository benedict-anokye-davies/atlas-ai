/**
 * Nova Desktop - Vector Store Cleanup
 * Automatic cleanup and maintenance of the vector store
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../../utils/logger';
import { VectorDocument, VectorMetadata, CleanupResult } from './types';

const logger = createModuleLogger('VectorCleanup');

/**
 * Cleanup configuration
 */
export interface CleanupConfig {
  /** Maximum vectors before cleanup triggers */
  maxVectors: number;
  /** Target capacity after cleanup (as percentage of max) */
  targetCapacity: number;
  /** Minimum importance to preserve (0-1) */
  minImportanceToPreserve: number;
  /** Maximum age in days before eligible for cleanup */
  maxAgeDays: number;
  /** Minimum access count to preserve */
  minAccessCountToPreserve: number;
  /** Enable summarization of removed documents */
  enableSummarization: boolean;
  /** Batch size for cleanup operations */
  batchSize: number;
}

const DEFAULT_CONFIG: CleanupConfig = {
  maxVectors: 100000,
  targetCapacity: 0.7, // Clean to 70% capacity
  minImportanceToPreserve: 0.7,
  maxAgeDays: 30,
  minAccessCountToPreserve: 5,
  enableSummarization: true,
  batchSize: 100,
};

/**
 * Cleanup events
 */
export interface CleanupEvents {
  'cleanup-started': (reason: string) => void;
  'cleanup-progress': (progress: number, total: number) => void;
  'cleanup-completed': (result: CleanupResult) => void;
  'document-marked': (id: string, reason: string) => void;
  error: (error: Error) => void;
}

/**
 * Cleanup candidate
 */
export interface CleanupCandidate {
  document: VectorDocument;
  score: number;
  reasons: string[];
}

/**
 * Vector Store Cleanup Manager
 * Handles automatic cleanup and maintenance
 */
export class VectorCleanupManager extends EventEmitter {
  private config: CleanupConfig;
  private isRunning = false;
  private lastCleanupTime = 0;

  constructor(config?: Partial<CleanupConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    logger.info('VectorCleanupManager initialized', { config: this.config });
  }

  /**
   * Check if cleanup is needed based on current count
   */
  needsCleanup(currentCount: number): boolean {
    return currentCount >= this.config.maxVectors * 0.8; // 80% threshold
  }

  /**
   * Calculate cleanup score for a document
   * Lower score = better candidate for cleanup
   */
  calculateCleanupScore(doc: VectorDocument): { score: number; reasons: string[] } {
    const reasons: string[] = [];
    let score = 0;

    // Factor 1: Importance (0-0.4)
    // Lower importance = lower score = better cleanup candidate
    const importanceScore = doc.metadata.importance * 0.4;
    score += importanceScore;
    if (doc.metadata.importance < 0.3) {
      reasons.push('Low importance');
    }

    // Factor 2: Recency (0-0.3)
    const ageMs = Date.now() - doc.accessedAt;
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    const recencyScore = Math.max(0, 1 - ageDays / this.config.maxAgeDays) * 0.3;
    score += recencyScore;
    if (ageDays > this.config.maxAgeDays) {
      reasons.push('Old and unused');
    }

    // Factor 3: Access count (0-0.2)
    const accessScore = Math.min(1, doc.metadata.accessCount / 10) * 0.2;
    score += accessScore;
    if (doc.metadata.accessCount < 2) {
      reasons.push('Rarely accessed');
    }

    // Factor 4: Content type (0-0.1)
    // Some types are more valuable to keep
    const typeWeights: Record<VectorMetadata['sourceType'], number> = {
      fact: 0.1, // Facts are most important
      preference: 0.09,
      task: 0.08,
      context: 0.05,
      conversation: 0.03,
      other: 0.02,
    };
    score += typeWeights[doc.metadata.sourceType] || 0.02;

    // Bonus: Summaries are more valuable (they represent multiple documents)
    if (doc.metadata.isSummary) {
      score += 0.2;
      reasons.length = 0; // Clear reasons - don't clean summaries easily
      reasons.push('Summary document - preserve');
    }

    return { score, reasons };
  }

  /**
   * Get cleanup candidates from a list of documents
   */
  getCleanupCandidates(
    documents: VectorDocument[],
    targetRemoval: number
  ): CleanupCandidate[] {
    const candidates: CleanupCandidate[] = [];

    for (const doc of documents) {
      const { score, reasons } = this.calculateCleanupScore(doc);
      candidates.push({ document: doc, score, reasons });
    }

    // Sort by score ascending (lowest scores first = best cleanup candidates)
    candidates.sort((a, b) => a.score - b.score);

    // Filter out protected documents
    const filteredCandidates = candidates.filter((c) => {
      // Don't clean high-importance documents
      if (c.document.metadata.importance >= this.config.minImportanceToPreserve) {
        return false;
      }
      // Don't clean frequently accessed documents
      if (c.document.metadata.accessCount >= this.config.minAccessCountToPreserve) {
        return false;
      }
      // Don't clean summaries
      if (c.document.metadata.isSummary) {
        return false;
      }
      return true;
    });

    return filteredCandidates.slice(0, targetRemoval);
  }

  /**
   * Group documents by topic for potential summarization
   */
  groupByTopic(documents: VectorDocument[]): Map<string, VectorDocument[]> {
    const groups: Map<string, VectorDocument[]> = new Map();

    for (const doc of documents) {
      if (doc.metadata.topics) {
        for (const topic of doc.metadata.topics) {
          if (!groups.has(topic)) {
            groups.set(topic, []);
          }
          groups.get(topic)!.push(doc);
        }
      }
    }

    return groups;
  }

  /**
   * Calculate how many documents to remove to reach target capacity
   */
  calculateTargetRemoval(currentCount: number): number {
    const targetCount = Math.floor(this.config.maxVectors * this.config.targetCapacity);
    return Math.max(0, currentCount - targetCount);
  }

  /**
   * Run cleanup process
   * Returns candidates for removal (actual deletion handled by caller)
   */
  async runCleanup(
    documents: VectorDocument[],
    currentCount: number
  ): Promise<{
    candidates: CleanupCandidate[];
    summaryGroups: Map<string, VectorDocument[]>;
  }> {
    if (this.isRunning) {
      throw new Error('Cleanup already in progress');
    }

    this.isRunning = true;
    this.emit('cleanup-started', 'Capacity threshold reached');

    const startTime = Date.now();

    try {
      const targetRemoval = this.calculateTargetRemoval(currentCount);
      logger.info('Starting cleanup', {
        currentCount,
        targetRemoval,
        targetCapacity: this.config.targetCapacity,
      });

      // Get cleanup candidates
      const candidates = this.getCleanupCandidates(documents, targetRemoval);

      // Group candidates by topic for potential summarization
      const summaryGroups = this.config.enableSummarization
        ? this.groupByTopic(candidates.map((c) => c.document))
        : new Map<string, VectorDocument[]>();

      // Emit progress
      for (let i = 0; i < candidates.length; i++) {
        this.emit('document-marked', candidates[i].document.id, candidates[i].reasons.join(', '));
        if (i % 100 === 0) {
          this.emit('cleanup-progress', i, candidates.length);
        }
      }

      const result: CleanupResult = {
        removed: candidates.length,
        summarized: summaryGroups.size,
        freedBytes: candidates.reduce((acc, c) => {
          // Estimate bytes per document
          const vectorBytes = c.document.vector.length * 4;
          const contentBytes = c.document.content.length;
          return acc + vectorBytes + contentBytes + 200; // 200 for metadata overhead
        }, 0),
        removedIds: candidates.map((c) => c.document.id),
        durationMs: Date.now() - startTime,
      };

      this.lastCleanupTime = Date.now();
      this.emit('cleanup-completed', result);

      logger.info('Cleanup completed', {
        removed: result.removed,
        summarized: result.summarized,
        freedBytes: result.freedBytes,
        durationMs: result.durationMs,
      });

      return { candidates, summaryGroups };
    } catch (error) {
      this.emit('error', error as Error);
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Get cleanup statistics
   */
  getStats(): {
    isRunning: boolean;
    lastCleanupTime: number;
    timeSinceLastCleanup: number;
  } {
    return {
      isRunning: this.isRunning,
      lastCleanupTime: this.lastCleanupTime,
      timeSinceLastCleanup: this.lastCleanupTime > 0 ? Date.now() - this.lastCleanupTime : -1,
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<CleanupConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('Cleanup config updated', { config: this.config });
  }

  // Type-safe event emitter methods
  on<K extends keyof CleanupEvents>(event: K, listener: CleanupEvents[K]): this {
    return super.on(event, listener);
  }

  off<K extends keyof CleanupEvents>(event: K, listener: CleanupEvents[K]): this {
    return super.off(event, listener);
  }

  emit<K extends keyof CleanupEvents>(
    event: K,
    ...args: Parameters<CleanupEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }
}

export default VectorCleanupManager;
