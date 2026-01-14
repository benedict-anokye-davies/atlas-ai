/**
 * Nova Desktop - LanceDB Vector Store Implementation
 * Provides vector storage using LanceDB embedded database
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { createModuleLogger } from '../../utils/logger';
import {
  VectorDocument,
  VectorMetadata,
  VectorSearchResult,
  VectorSearchOptions,
  VectorStoreConfig,
  VectorStoreStats,
  VectorStoreEvents,
  BatchOperationResult,
  DEFAULT_VECTOR_STORE_CONFIG,
} from './types';

const logger = createModuleLogger('LanceDBStore');

/**
 * LanceDB connection interface (for type safety)
 */
interface LanceDBConnection {
  openTable: (name: string) => Promise<LanceDBTable>;
  createTable: (name: string, data: unknown[]) => Promise<LanceDBTable>;
  tableNames: () => Promise<string[]>;
  dropTable: (name: string) => Promise<void>;
}

interface LanceDBTable {
  add: (data: unknown[]) => Promise<void>;
  search: (vector: number[]) => LanceDBSearchQuery;
  delete: (filter: string) => Promise<void>;
  update: (data: { where: string; values: Record<string, unknown> }) => Promise<void>;
  countRows: () => Promise<number>;
}

interface LanceDBSearchQuery {
  limit: (n: number) => LanceDBSearchQuery;
  where: (filter: string) => LanceDBSearchQuery;
  select: (columns: string[]) => LanceDBSearchQuery;
  execute: () => Promise<LanceDBSearchResult[]>;
}

interface LanceDBSearchResult {
  id: string;
  vector: number[];
  content: string;
  metadata: string;
  createdAt: number;
  accessedAt: number;
  _distance: number;
}

/**
 * LanceDB Vector Store
 * Production-ready vector storage with LanceDB backend
 */
export class LanceDBVectorStore extends EventEmitter {
  private config: VectorStoreConfig;
  private db: LanceDBConnection | null = null;
  private table: LanceDBTable | null = null;
  private isInitialized = false;
  private autoSaveTimer: NodeJS.Timeout | null = null;

  // In-memory index for fast lookups
  private index: Map<string, { importance: number; accessedAt: number }> = new Map();

  constructor(config?: Partial<VectorStoreConfig>) {
    super();
    this.config = { ...DEFAULT_VECTOR_STORE_CONFIG, ...config };

    if (!this.config.storageDir) {
      this.config.storageDir = path.join(
        process.env.HOME || process.env.USERPROFILE || '.',
        '.nova',
        'vectors'
      );
    }

    logger.info('LanceDBVectorStore created', {
      storageDir: this.config.storageDir,
      dimensions: this.config.dimensions,
      maxVectors: this.config.maxVectors,
    });
  }

  /**
   * Initialize the vector store
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      // Ensure storage directory exists
      await fs.promises.mkdir(this.config.storageDir, { recursive: true });

      // Try to load LanceDB dynamically
      let lancedb: { connect: (path: string) => Promise<LanceDBConnection> };
      try {
        lancedb = await import('lancedb');
      } catch (importError) {
        logger.warn('LanceDB not available, using fallback storage', {
          error: (importError as Error).message,
        });
        // LanceDB not installed - fallback will be handled by the memory system
        throw new Error('LanceDB not available');
      }

      // Connect to database
      const dbPath = path.join(this.config.storageDir, 'vectors.lance');
      this.db = await lancedb.connect(dbPath);

      // Open or create the vectors table
      const tableNames = await this.db.tableNames();
      if (tableNames.includes('vectors')) {
        this.table = await this.db.openTable('vectors');
        await this.rebuildIndex();
        logger.info('Opened existing vectors table');
      } else {
        // Create empty table with schema
        this.table = await this.db.createTable('vectors', [
          {
            id: '__schema__',
            vector: new Array(this.config.dimensions).fill(0),
            content: '',
            metadata: '{}',
            createdAt: Date.now(),
            accessedAt: Date.now(),
          },
        ]);
        // Delete the schema row
        await this.table.delete("id = '__schema__'");
        logger.info('Created new vectors table');
      }

      // Start auto-save timer
      if (this.config.enablePersistence && this.config.autoSaveInterval > 0) {
        this.startAutoSave();
      }

      this.isInitialized = true;
      this.emit('loaded');
      logger.info('LanceDBVectorStore initialized');
    } catch (error) {
      logger.error('Failed to initialize LanceDBVectorStore', {
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * Rebuild in-memory index from database
   */
  private async rebuildIndex(): Promise<void> {
    if (!this.table) return;

    // Search with a zero vector to get all documents
    // This is a workaround since LanceDB doesn't have a direct "scan all" API
    const zeroVector = new Array(this.config.dimensions).fill(0);
    const results = await this.table.search(zeroVector).limit(this.config.maxVectors).execute();

    this.index.clear();
    for (const row of results) {
      if (row.id === '__schema__') continue;
      const metadata = JSON.parse(row.metadata) as VectorMetadata;
      this.index.set(row.id, {
        importance: metadata.importance,
        accessedAt: row.accessedAt,
      });
    }

    logger.debug('Index rebuilt', { count: this.index.size });
  }

  /**
   * Start auto-save timer
   */
  private startAutoSave(): void {
    if (this.autoSaveTimer) return;
    this.autoSaveTimer = setInterval(() => {
      // LanceDB auto-persists, but we can emit events for monitoring
      this.emit('saved');
    }, this.config.autoSaveInterval);
  }

  /**
   * Stop auto-save timer
   */
  private stopAutoSave(): void {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
  }

  /**
   * Add a document to the vector store
   */
  async add(
    id: string,
    vector: number[],
    content: string,
    metadata: Partial<VectorMetadata> = {}
  ): Promise<VectorDocument> {
    if (!this.isInitialized || !this.table) {
      throw new Error('Vector store not initialized');
    }

    // Validate vector dimensions
    if (vector.length !== this.config.dimensions) {
      throw new Error(
        `Vector dimension mismatch: expected ${this.config.dimensions}, got ${vector.length}`
      );
    }

    const fullMetadata: VectorMetadata = {
      sourceType: metadata.sourceType || 'other',
      importance: metadata.importance ?? 0.5,
      accessCount: metadata.accessCount ?? 0,
      sessionId: metadata.sessionId,
      topics: metadata.topics,
      tags: metadata.tags,
      isSummary: metadata.isSummary ?? false,
      summarizedIds: metadata.summarizedIds,
      custom: metadata.custom,
    };

    const now = Date.now();
    const doc: VectorDocument = {
      id,
      vector,
      content,
      metadata: fullMetadata,
      createdAt: now,
      accessedAt: now,
    };

    // Add to LanceDB
    await this.table.add([
      {
        id: doc.id,
        vector: doc.vector,
        content: doc.content,
        metadata: JSON.stringify(doc.metadata),
        createdAt: doc.createdAt,
        accessedAt: doc.accessedAt,
      },
    ]);

    // Update index
    this.index.set(id, {
      importance: fullMetadata.importance,
      accessedAt: now,
    });

    this.emit('document-added', doc);
    logger.debug('Document added', { id, sourceType: fullMetadata.sourceType });

    return doc;
  }

  /**
   * Add multiple documents in batch
   */
  async addBatch(
    documents: Array<{
      id: string;
      vector: number[];
      content: string;
      metadata?: Partial<VectorMetadata>;
    }>
  ): Promise<BatchOperationResult> {
    const result: BatchOperationResult = {
      successful: 0,
      failed: 0,
      successIds: [],
      errors: {},
    };

    for (const doc of documents) {
      try {
        await this.add(doc.id, doc.vector, doc.content, doc.metadata);
        result.successful++;
        result.successIds.push(doc.id);
      } catch (error) {
        result.failed++;
        result.errors[doc.id] = (error as Error).message;
      }
    }

    return result;
  }

  /**
   * Search for similar vectors
   */
  async search(
    queryVector: number[],
    options: VectorSearchOptions = {}
  ): Promise<VectorSearchResult[]> {
    if (!this.isInitialized || !this.table) {
      throw new Error('Vector store not initialized');
    }

    const limit = options.limit ?? 10;
    const minScore = options.minScore ?? 0;

    // Build search query
    let query = this.table.search(queryVector).limit(limit * 2); // Over-fetch for filtering

    // Apply filters if possible
    const filters: string[] = [];
    if (options.sourceType) {
      // Note: LanceDB SQL-like filtering on JSON fields
      // This is a simplified approach - real implementation may need adjustment
      filters.push(`metadata LIKE '%"sourceType":"${options.sourceType}"%'`);
    }
    if (!options.includeSummaries) {
      filters.push(`metadata NOT LIKE '%"isSummary":true%'`);
    }

    if (filters.length > 0) {
      query = query.where(filters.join(' AND '));
    }

    const rawResults = await query.execute();

    // Convert and filter results
    const results: VectorSearchResult[] = [];
    const now = Date.now();

    for (const row of rawResults) {
      if (row.id === '__schema__') continue;

      const metadata = JSON.parse(row.metadata) as VectorMetadata;

      // Calculate similarity score from distance (cosine distance to similarity)
      const distance = row._distance;
      const score = this.config.distanceMetric === 'cosine' ? 1 - distance : 1 / (1 + distance);

      // Apply score threshold
      if (score < minScore) continue;

      // Apply metadata filters
      if (options.minImportance && metadata.importance < options.minImportance) continue;
      if (options.topics && options.topics.length > 0) {
        if (!metadata.topics || !options.topics.some((t) => metadata.topics?.includes(t))) continue;
      }
      if (options.tags && options.tags.length > 0) {
        if (!metadata.tags || !options.tags.some((t) => metadata.tags?.includes(t))) continue;
      }

      const doc: VectorDocument = {
        id: row.id,
        vector: row.vector,
        content: row.content,
        metadata,
        createdAt: row.createdAt,
        accessedAt: row.accessedAt,
      };

      results.push({ document: doc, score, distance });

      // Update access tracking
      metadata.accessCount = (metadata.accessCount || 0) + 1;
      this.index.set(row.id, {
        importance: metadata.importance,
        accessedAt: now,
      });

      if (results.length >= limit) break;
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);

    this.emit('search-performed', queryVector, results.length);
    logger.debug('Search performed', { results: results.length });

    return results;
  }

  /**
   * Get a document by ID
   */
  async get(id: string): Promise<VectorDocument | null> {
    if (!this.isInitialized || !this.table) {
      throw new Error('Vector store not initialized');
    }

    // Search with a zero vector and filter by ID
    const zeroVector = new Array(this.config.dimensions).fill(0);
    const results = await this.table.search(zeroVector).where(`id = '${id}'`).limit(1).execute();

    if (results.length === 0) return null;

    const row = results[0];
    const metadata = JSON.parse(row.metadata) as VectorMetadata;

    return {
      id: row.id,
      vector: row.vector,
      content: row.content,
      metadata,
      createdAt: row.createdAt,
      accessedAt: row.accessedAt,
    };
  }

  /**
   * Delete a document by ID
   */
  async delete(id: string): Promise<boolean> {
    if (!this.isInitialized || !this.table) {
      throw new Error('Vector store not initialized');
    }

    try {
      await this.table.delete(`id = '${id}'`);
      this.index.delete(id);
      this.emit('document-removed', id);
      logger.debug('Document deleted', { id });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Delete multiple documents
   */
  async deleteBatch(ids: string[]): Promise<BatchOperationResult> {
    const result: BatchOperationResult = {
      successful: 0,
      failed: 0,
      successIds: [],
      errors: {},
    };

    for (const id of ids) {
      const deleted = await this.delete(id);
      if (deleted) {
        result.successful++;
        result.successIds.push(id);
      } else {
        result.failed++;
        result.errors[id] = 'Failed to delete';
      }
    }

    return result;
  }

  /**
   * Update document metadata
   */
  async updateMetadata(id: string, metadata: Partial<VectorMetadata>): Promise<boolean> {
    if (!this.isInitialized || !this.table) {
      throw new Error('Vector store not initialized');
    }

    const doc = await this.get(id);
    if (!doc) return false;

    const updatedMetadata = { ...doc.metadata, ...metadata };

    try {
      await this.table.update({
        where: `id = '${id}'`,
        values: {
          metadata: JSON.stringify(updatedMetadata),
          accessedAt: Date.now(),
        },
      });

      // Update index
      this.index.set(id, {
        importance: updatedMetadata.importance,
        accessedAt: Date.now(),
      });

      this.emit('document-updated', { ...doc, metadata: updatedMetadata });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get vector store statistics
   */
  async getStats(): Promise<VectorStoreStats> {
    if (!this.isInitialized || !this.table) {
      return {
        totalVectors: 0,
        bySourceType: {
          conversation: 0,
          fact: 0,
          preference: 0,
          context: 0,
          task: 0,
          other: 0,
        },
        averageImportance: 0,
        summaryCount: 0,
        storageSizeBytes: 0,
        capacityUsed: 0,
      };
    }

    const totalVectors = this.index.size;
    const bySourceType: Record<VectorMetadata['sourceType'], number> = {
      conversation: 0,
      fact: 0,
      preference: 0,
      context: 0,
      task: 0,
      other: 0,
    };
    let totalImportance = 0;
    let summaryCount = 0;

    // This is a simplified stats calculation
    // Real implementation would scan the table
    for (const [, entry] of this.index) {
      totalImportance += entry.importance;
    }

    const averageImportance = totalVectors > 0 ? totalImportance / totalVectors : 0;

    // Estimate storage size (rough approximation)
    const avgVectorBytes = this.config.dimensions * 4; // 4 bytes per float
    const avgMetadataBytes = 200; // Rough estimate
    const storageSizeBytes = totalVectors * (avgVectorBytes + avgMetadataBytes);

    return {
      totalVectors,
      bySourceType,
      averageImportance,
      summaryCount,
      storageSizeBytes,
      capacityUsed: totalVectors / this.config.maxVectors,
    };
  }

  /**
   * Check if cleanup is needed
   */
  needsCleanup(): boolean {
    return this.index.size >= this.config.maxVectors * this.config.cleanupThreshold;
  }

  /**
   * Get documents that are candidates for cleanup
   */
  async getCleanupCandidates(limit: number): Promise<VectorDocument[]> {
    if (!this.isInitialized || !this.table) return [];

    // Get documents sorted by importance (lowest first) and access time (oldest first)
    const candidates: Array<{ id: string; score: number }> = [];

    for (const [id, entry] of this.index) {
      // Score combines importance and recency (lower score = better cleanup candidate)
      const ageHours = (Date.now() - entry.accessedAt) / (1000 * 60 * 60);
      const recencyScore = Math.max(0, 1 - ageHours / 168); // Decay over 1 week
      const score = entry.importance * 0.7 + recencyScore * 0.3;
      candidates.push({ id, score });
    }

    // Sort by score ascending (lowest scores are best candidates for cleanup)
    candidates.sort((a, b) => a.score - b.score);

    // Get full documents for top candidates
    const docs: VectorDocument[] = [];
    for (const candidate of candidates.slice(0, limit)) {
      const doc = await this.get(candidate.id);
      if (doc) docs.push(doc);
    }

    return docs;
  }

  /**
   * Clear all documents
   */
  async clear(): Promise<void> {
    if (!this.isInitialized || !this.db) return;

    try {
      await this.db.dropTable('vectors');
      this.table = await this.db.createTable('vectors', [
        {
          id: '__schema__',
          vector: new Array(this.config.dimensions).fill(0),
          content: '',
          metadata: '{}',
          createdAt: Date.now(),
          accessedAt: Date.now(),
        },
      ]);
      await this.table.delete("id = '__schema__'");
      this.index.clear();
      logger.info('Vector store cleared');
    } catch (error) {
      logger.error('Failed to clear vector store', { error: (error as Error).message });
      throw error;
    }
  }

  /**
   * Shutdown the vector store
   */
  async shutdown(): Promise<void> {
    this.stopAutoSave();
    this.removeAllListeners();
    this.db = null;
    this.table = null;
    this.isInitialized = false;
    logger.info('LanceDBVectorStore shutdown');
  }

  /**
   * Check if store is initialized
   */
  isReady(): boolean {
    return this.isInitialized;
  }

  // Type-safe event emitter methods
  on<K extends keyof VectorStoreEvents>(event: K, listener: VectorStoreEvents[K]): this {
    return super.on(event, listener);
  }

  off<K extends keyof VectorStoreEvents>(event: K, listener: VectorStoreEvents[K]): this {
    return super.off(event, listener);
  }

  emit<K extends keyof VectorStoreEvents>(
    event: K,
    ...args: Parameters<VectorStoreEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }
}

export default LanceDBVectorStore;
