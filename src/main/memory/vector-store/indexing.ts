/**
 * Atlas Desktop - Vector Indexing
 * Manages vector indices for efficient retrieval
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../../utils/logger';
import { VectorDocument, VectorMetadata, VectorIndexEntry } from './types';

const logger = createModuleLogger('VectorIndexing');

/**
 * Index configuration
 */
export interface IndexConfig {
  /** Maximum entries in the importance index */
  maxImportanceEntries: number;
  /** Maximum entries in the recency index */
  maxRecencyEntries: number;
  /** Maximum entries per topic */
  maxEntriesPerTopic: number;
  /** Enable topic indexing */
  enableTopicIndex: boolean;
}

const DEFAULT_CONFIG: IndexConfig = {
  maxImportanceEntries: 10000,
  maxRecencyEntries: 10000,
  maxEntriesPerTopic: 1000,
  enableTopicIndex: true,
};

/**
 * Index events
 */
export interface IndexEvents {
  'entry-added': (id: string) => void;
  'entry-removed': (id: string) => void;
  'index-rebuilt': () => void;
}

/**
 * Vector Index Manager
 * Maintains indices for fast vector retrieval by various criteria
 */
export class VectorIndexManager extends EventEmitter {
  private config: IndexConfig;

  // Primary index: ID -> entry
  private mainIndex: Map<string, VectorIndexEntry> = new Map();

  // Secondary indices
  private importanceIndex: Array<{ id: string; importance: number }> = [];
  private recencyIndex: Array<{ id: string; lastAccess: number }> = [];
  private topicIndex: Map<string, Set<string>> = new Map();
  private sourceTypeIndex: Map<VectorMetadata['sourceType'], Set<string>> = new Map();

  // Dirty flags for lazy rebuilding
  private importanceDirty = false;
  private recencyDirty = false;

  constructor(config?: Partial<IndexConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Initialize source type index
    const sourceTypes: VectorMetadata['sourceType'][] = [
      'conversation',
      'fact',
      'preference',
      'context',
      'task',
      'other',
    ];
    for (const type of sourceTypes) {
      this.sourceTypeIndex.set(type, new Set());
    }

    logger.info('VectorIndexManager initialized', { config: this.config });
  }

  /**
   * Add or update an entry in the index
   */
  addEntry(doc: VectorDocument): void {
    const entry: VectorIndexEntry = {
      id: doc.id,
      importance: doc.metadata.importance,
      lastAccess: doc.accessedAt,
      accessCount: doc.metadata.accessCount,
      sourceType: doc.metadata.sourceType,
    };

    const isUpdate = this.mainIndex.has(doc.id);

    // Update main index
    this.mainIndex.set(doc.id, entry);

    // Update source type index
    if (isUpdate) {
      // Remove from old source type if changed
      for (const [, ids] of this.sourceTypeIndex) {
        ids.delete(doc.id);
      }
    }
    this.sourceTypeIndex.get(doc.metadata.sourceType)?.add(doc.id);

    // Update topic index
    if (this.config.enableTopicIndex && doc.metadata.topics) {
      // Remove from old topics first
      if (isUpdate) {
        for (const [, ids] of this.topicIndex) {
          ids.delete(doc.id);
        }
      }
      // Add to new topics
      for (const topic of doc.metadata.topics) {
        if (!this.topicIndex.has(topic)) {
          this.topicIndex.set(topic, new Set());
        }
        const topicSet = this.topicIndex.get(topic)!;
        topicSet.add(doc.id);

        // Limit entries per topic
        if (topicSet.size > this.config.maxEntriesPerTopic) {
          // Remove oldest entry (first in set)
          const first = topicSet.values().next().value;
          if (first) topicSet.delete(first);
        }
      }
    }

    // Mark secondary indices as dirty
    this.importanceDirty = true;
    this.recencyDirty = true;

    this.emit('entry-added', doc.id);
    logger.debug('Index entry added', { id: doc.id, isUpdate });
  }

  /**
   * Remove an entry from the index
   */
  removeEntry(id: string): boolean {
    const entry = this.mainIndex.get(id);
    if (!entry) return false;

    // Remove from main index
    this.mainIndex.delete(id);

    // Remove from source type index
    this.sourceTypeIndex.get(entry.sourceType)?.delete(id);

    // Remove from topic index
    for (const [, ids] of this.topicIndex) {
      ids.delete(id);
    }

    // Mark secondary indices as dirty
    this.importanceDirty = true;
    this.recencyDirty = true;

    this.emit('entry-removed', id);
    logger.debug('Index entry removed', { id });
    return true;
  }

  /**
   * Get entry by ID
   */
  getEntry(id: string): VectorIndexEntry | undefined {
    return this.mainIndex.get(id);
  }

  /**
   * Update access time for an entry
   */
  updateAccess(id: string): void {
    const entry = this.mainIndex.get(id);
    if (entry) {
      entry.lastAccess = Date.now();
      entry.accessCount++;
      this.recencyDirty = true;
    }
  }

  /**
   * Update importance for an entry
   */
  updateImportance(id: string, importance: number): void {
    const entry = this.mainIndex.get(id);
    if (entry) {
      entry.importance = importance;
      this.importanceDirty = true;
    }
  }

  /**
   * Get IDs sorted by importance (most important first)
   */
  getByImportance(limit?: number): string[] {
    this.rebuildImportanceIndexIfDirty();
    const ids = this.importanceIndex.map((e) => e.id);
    return limit ? ids.slice(0, limit) : ids;
  }

  /**
   * Get IDs sorted by recency (most recent first)
   */
  getByRecency(limit?: number): string[] {
    this.rebuildRecencyIndexIfDirty();
    const ids = this.recencyIndex.map((e) => e.id);
    return limit ? ids.slice(0, limit) : ids;
  }

  /**
   * Get IDs by topic
   */
  getByTopic(topic: string): string[] {
    const ids = this.topicIndex.get(topic);
    return ids ? Array.from(ids) : [];
  }

  /**
   * Get IDs by source type
   */
  getBySourceType(sourceType: VectorMetadata['sourceType']): string[] {
    const ids = this.sourceTypeIndex.get(sourceType);
    return ids ? Array.from(ids) : [];
  }

  /**
   * Get low importance IDs for cleanup (least important first)
   */
  getLowestImportance(limit: number): string[] {
    this.rebuildImportanceIndexIfDirty();
    return this.importanceIndex.slice(-limit).map((e) => e.id);
  }

  /**
   * Get oldest accessed IDs for cleanup
   */
  getOldestAccessed(limit: number): string[] {
    this.rebuildRecencyIndexIfDirty();
    return this.recencyIndex.slice(-limit).map((e) => e.id);
  }

  /**
   * Get cleanup candidates (combining importance and recency)
   */
  getCleanupCandidates(limit: number): string[] {
    this.rebuildImportanceIndexIfDirty();
    this.rebuildRecencyIndexIfDirty();

    // Score each entry: lower score = better cleanup candidate
    const scores: Array<{ id: string; score: number }> = [];

    for (const [id, entry] of this.mainIndex) {
      // Combine importance and recency
      const ageHours = (Date.now() - entry.lastAccess) / (1000 * 60 * 60);
      const recencyScore = Math.max(0, 1 - ageHours / 168); // Decay over 1 week
      const accessScore = Math.min(1, entry.accessCount / 10); // Cap at 10 accesses

      // Lower score = better cleanup candidate
      const score = entry.importance * 0.5 + recencyScore * 0.3 + accessScore * 0.2;
      scores.push({ id, score });
    }

    // Sort by score ascending (lowest first)
    scores.sort((a, b) => a.score - b.score);

    return scores.slice(0, limit).map((e) => e.id);
  }

  /**
   * Rebuild importance index
   */
  private rebuildImportanceIndexIfDirty(): void {
    if (!this.importanceDirty) return;

    this.importanceIndex = Array.from(this.mainIndex.values())
      .map((e) => ({ id: e.id, importance: e.importance }))
      .sort((a, b) => b.importance - a.importance)
      .slice(0, this.config.maxImportanceEntries);

    this.importanceDirty = false;
  }

  /**
   * Rebuild recency index
   */
  private rebuildRecencyIndexIfDirty(): void {
    if (!this.recencyDirty) return;

    this.recencyIndex = Array.from(this.mainIndex.values())
      .map((e) => ({ id: e.id, lastAccess: e.lastAccess }))
      .sort((a, b) => b.lastAccess - a.lastAccess)
      .slice(0, this.config.maxRecencyEntries);

    this.recencyDirty = false;
  }

  /**
   * Rebuild all indices from a list of documents
   */
  rebuildFromDocuments(documents: VectorDocument[]): void {
    this.clear();

    for (const doc of documents) {
      this.addEntry(doc);
    }

    this.rebuildImportanceIndexIfDirty();
    this.rebuildRecencyIndexIfDirty();

    this.emit('index-rebuilt');
    logger.info('Index rebuilt', { documents: documents.length });
  }

  /**
   * Get all topics
   */
  getAllTopics(): string[] {
    return Array.from(this.topicIndex.keys());
  }

  /**
   * Get topic statistics
   */
  getTopicStats(): Array<{ topic: string; count: number }> {
    return Array.from(this.topicIndex.entries())
      .map(([topic, ids]) => ({ topic, count: ids.size }))
      .sort((a, b) => b.count - a.count);
  }

  /**
   * Get index statistics
   */
  getStats(): {
    totalEntries: number;
    bySourceType: Record<VectorMetadata['sourceType'], number>;
    topicCount: number;
    averageImportance: number;
  } {
    const bySourceType: Record<VectorMetadata['sourceType'], number> = {
      conversation: 0,
      fact: 0,
      preference: 0,
      context: 0,
      task: 0,
      other: 0,
    };

    let totalImportance = 0;

    for (const [, entry] of this.mainIndex) {
      bySourceType[entry.sourceType]++;
      totalImportance += entry.importance;
    }

    return {
      totalEntries: this.mainIndex.size,
      bySourceType,
      topicCount: this.topicIndex.size,
      averageImportance: this.mainIndex.size > 0 ? totalImportance / this.mainIndex.size : 0,
    };
  }

  /**
   * Clear all indices
   */
  clear(): void {
    this.mainIndex.clear();
    this.importanceIndex = [];
    this.recencyIndex = [];
    this.topicIndex.clear();

    for (const [, ids] of this.sourceTypeIndex) {
      ids.clear();
    }

    this.importanceDirty = false;
    this.recencyDirty = false;

    logger.info('Index cleared');
  }

  /**
   * Get total entry count
   */
  get size(): number {
    return this.mainIndex.size;
  }

  // Type-safe event emitter methods
  on<K extends keyof IndexEvents>(event: K, listener: IndexEvents[K]): this {
    return super.on(event, listener);
  }

  off<K extends keyof IndexEvents>(event: K, listener: IndexEvents[K]): this {
    return super.off(event, listener);
  }

  emit<K extends keyof IndexEvents>(event: K, ...args: Parameters<IndexEvents[K]>): boolean {
    return super.emit(event, ...args);
  }
}

export default VectorIndexManager;
