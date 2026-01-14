/**
 * Nova Desktop - Vector Store Index
 * Main entry point for the vector storage system
 */

// Export all types
export * from './types';

// Export embeddings
export * from './embeddings';

// Export indexing
export * from './indexing';

// Export cleanup
export * from './cleanup';

// Export LanceDB store (may throw if not available)
export { LanceDBVectorStore } from './lancedb';

import { EventEmitter } from 'events';
import * as path from 'path';
import * as fs from 'fs';
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
  CleanupResult,
  DEFAULT_VECTOR_STORE_CONFIG,
} from './types';
import { EmbeddingGenerator, getEmbeddingGenerator } from './embeddings';
import { VectorIndexManager } from './indexing';
import { VectorCleanupManager } from './cleanup';

const logger = createModuleLogger('VectorStore');

/**
 * Unified Vector Store
 * Provides a high-level API for vector storage with automatic
 * embedding generation, indexing, and cleanup
 */
export class UnifiedVectorStore extends EventEmitter {
  private config: VectorStoreConfig;
  private embedder: EmbeddingGenerator | null = null;
  private indexManager: VectorIndexManager;
  private cleanupManager: VectorCleanupManager;

  // In-memory storage (fallback when LanceDB unavailable)
  private documents: Map<string, VectorDocument> = new Map();
  private isInitialized = false;
  private autoSaveTimer: NodeJS.Timeout | null = null;
  private isDirty = false;

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

    this.indexManager = new VectorIndexManager();
    this.cleanupManager = new VectorCleanupManager({
      maxVectors: this.config.maxVectors,
    });

    logger.info('UnifiedVectorStore created', {
      storageDir: this.config.storageDir,
      dimensions: this.config.dimensions,
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

      // Initialize embedder
      this.embedder = await getEmbeddingGenerator({
        dimensions: this.config.dimensions,
      });

      // Load persisted data
      if (this.config.enablePersistence) {
        await this.load();
      }

      // Start auto-save
      if (this.config.enablePersistence && this.config.autoSaveInterval > 0) {
        this.startAutoSave();
      }

      this.isInitialized = true;
      this.emit('loaded');
      logger.info('UnifiedVectorStore initialized', {
        documents: this.documents.size,
        provider: this.embedder.getProvider(),
      });
    } catch (error) {
      logger.error('Failed to initialize UnifiedVectorStore', {
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * Start auto-save timer
   */
  private startAutoSave(): void {
    if (this.autoSaveTimer) return;
    this.autoSaveTimer = setInterval(async () => {
      if (this.isDirty) {
        await this.save();
      }
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
   * Generate unique ID
   */
  private generateId(): string {
    return `vec-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Add a document with automatic embedding generation
   */
  async add(
    content: string,
    metadata: Partial<VectorMetadata> = {},
    id?: string
  ): Promise<VectorDocument> {
    if (!this.isInitialized || !this.embedder) {
      throw new Error('Vector store not initialized');
    }

    // Generate embedding
    const { vector } = await this.embedder.embed(content);

    const docId = id || this.generateId();
    const now = Date.now();

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

    const doc: VectorDocument = {
      id: docId,
      vector,
      content,
      metadata: fullMetadata,
      createdAt: now,
      accessedAt: now,
    };

    // Store document
    this.documents.set(docId, doc);
    this.indexManager.addEntry(doc);
    this.isDirty = true;

    // Check if cleanup needed
    if (this.cleanupManager.needsCleanup(this.documents.size)) {
      await this.runCleanup();
    }

    this.emit('document-added', doc);
    logger.debug('Document added', { id: docId, sourceType: fullMetadata.sourceType });

    return doc;
  }

  /**
   * Add a document with a pre-computed vector
   */
  async addWithVector(
    content: string,
    vector: number[],
    metadata: Partial<VectorMetadata> = {},
    id?: string
  ): Promise<VectorDocument> {
    if (!this.isInitialized) {
      throw new Error('Vector store not initialized');
    }

    if (vector.length !== this.config.dimensions) {
      throw new Error(
        `Vector dimension mismatch: expected ${this.config.dimensions}, got ${vector.length}`
      );
    }

    const docId = id || this.generateId();
    const now = Date.now();

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

    const doc: VectorDocument = {
      id: docId,
      vector,
      content,
      metadata: fullMetadata,
      createdAt: now,
      accessedAt: now,
    };

    this.documents.set(docId, doc);
    this.indexManager.addEntry(doc);
    this.isDirty = true;

    this.emit('document-added', doc);
    return doc;
  }

  /**
   * Search for similar documents
   */
  async search(query: string, options: VectorSearchOptions = {}): Promise<VectorSearchResult[]> {
    if (!this.isInitialized || !this.embedder) {
      throw new Error('Vector store not initialized');
    }

    // Generate embedding for query
    const { vector: queryVector } = await this.embedder.embed(query);

    return this.searchByVector(queryVector, options);
  }

  /**
   * Search by vector directly
   */
  async searchByVector(
    queryVector: number[],
    options: VectorSearchOptions = {}
  ): Promise<VectorSearchResult[]> {
    if (!this.isInitialized || !this.embedder) {
      throw new Error('Vector store not initialized');
    }

    const limit = options.limit ?? 10;
    const minScore = options.minScore ?? 0;

    const results: VectorSearchResult[] = [];

    for (const doc of this.documents.values()) {
      // Apply filters
      if (options.sourceType && doc.metadata.sourceType !== options.sourceType) continue;
      if (options.minImportance && doc.metadata.importance < options.minImportance) continue;
      if (!options.includeSummaries && doc.metadata.isSummary) continue;
      if (options.topics && options.topics.length > 0) {
        if (!doc.metadata.topics || !options.topics.some((t) => doc.metadata.topics?.includes(t)))
          continue;
      }
      if (options.tags && options.tags.length > 0) {
        if (!doc.metadata.tags || !options.tags.some((t) => doc.metadata.tags?.includes(t)))
          continue;
      }

      // Calculate similarity
      const similarity = this.embedder.cosineSimilarity(queryVector, doc.vector);
      if (similarity < minScore) continue;

      results.push({
        document: doc,
        score: similarity,
        distance: 1 - similarity,
      });

      // Update access tracking
      doc.accessedAt = Date.now();
      doc.metadata.accessCount++;
      this.indexManager.updateAccess(doc.id);
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);

    this.emit('search-performed', queryVector, results.length);
    logger.debug('Search performed', { results: results.length });

    return results.slice(0, limit);
  }

  /**
   * Get a document by ID
   */
  async get(id: string): Promise<VectorDocument | null> {
    return this.documents.get(id) || null;
  }

  /**
   * Delete a document
   */
  async delete(id: string): Promise<boolean> {
    const deleted = this.documents.delete(id);
    if (deleted) {
      this.indexManager.removeEntry(id);
      this.isDirty = true;
      this.emit('document-removed', id);
    }
    return deleted;
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
        result.errors[id] = 'Document not found';
      }
    }

    return result;
  }

  /**
   * Update document metadata
   */
  async updateMetadata(id: string, metadata: Partial<VectorMetadata>): Promise<boolean> {
    const doc = this.documents.get(id);
    if (!doc) return false;

    doc.metadata = { ...doc.metadata, ...metadata };
    doc.accessedAt = Date.now();
    this.indexManager.updateImportance(id, doc.metadata.importance);
    this.isDirty = true;

    this.emit('document-updated', doc);
    return true;
  }

  /**
   * Run cleanup process
   */
  async runCleanup(): Promise<CleanupResult> {
    const documents = Array.from(this.documents.values());
    const { candidates } = await this.cleanupManager.runCleanup(documents, this.documents.size);

    // Delete cleanup candidates
    const removedIds: string[] = [];
    for (const candidate of candidates) {
      await this.delete(candidate.document.id);
      removedIds.push(candidate.document.id);
    }

    const result: CleanupResult = {
      removed: removedIds.length,
      summarized: 0, // Would be filled by summarization
      freedBytes: 0, // Would need actual calculation
      removedIds,
      durationMs: 0,
    };

    await this.save();
    return result;
  }

  /**
   * Get store statistics
   */
  async getStats(): Promise<VectorStoreStats> {
    const indexStats = this.indexManager.getStats();

    // Calculate storage size estimate
    let storageSizeBytes = 0;
    for (const doc of this.documents.values()) {
      storageSizeBytes += doc.vector.length * 4; // 4 bytes per float
      storageSizeBytes += doc.content.length;
      storageSizeBytes += 200; // Metadata overhead
    }

    return {
      totalVectors: this.documents.size,
      bySourceType: indexStats.bySourceType,
      averageImportance: indexStats.averageImportance,
      summaryCount: Array.from(this.documents.values()).filter((d) => d.metadata.isSummary).length,
      storageSizeBytes,
      capacityUsed: this.documents.size / this.config.maxVectors,
    };
  }

  /**
   * Get documents by importance
   */
  getByImportance(limit?: number): VectorDocument[] {
    const ids = this.indexManager.getByImportance(limit);
    return ids.map((id) => this.documents.get(id)!).filter(Boolean);
  }

  /**
   * Get documents by recency
   */
  getByRecency(limit?: number): VectorDocument[] {
    const ids = this.indexManager.getByRecency(limit);
    return ids.map((id) => this.documents.get(id)!).filter(Boolean);
  }

  /**
   * Save to disk
   */
  async save(): Promise<void> {
    if (!this.config.enablePersistence) return;

    try {
      const data = {
        documents: Array.from(this.documents.entries()),
        savedAt: Date.now(),
        version: 1,
      };

      const filePath = path.join(this.config.storageDir, 'vectors.json');
      await fs.promises.writeFile(filePath, JSON.stringify(data));

      this.isDirty = false;
      this.emit('saved');
      logger.info('Vector store saved', { documents: this.documents.size });
    } catch (error) {
      logger.error('Failed to save vector store', { error: (error as Error).message });
      this.emit('error', error as Error);
    }
  }

  /**
   * Load from disk
   */
  async load(): Promise<void> {
    const filePath = path.join(this.config.storageDir, 'vectors.json');

    try {
      const exists = await fs.promises
        .access(filePath)
        .then(() => true)
        .catch(() => false);

      if (!exists) {
        logger.info('No existing vector store file found');
        return;
      }

      const content = await fs.promises.readFile(filePath, 'utf-8');
      const data = JSON.parse(content) as {
        documents: Array<[string, VectorDocument]>;
        version: number;
      };

      this.documents = new Map(data.documents);

      // Rebuild index
      this.indexManager.rebuildFromDocuments(Array.from(this.documents.values()));

      logger.info('Vector store loaded', { documents: this.documents.size });
    } catch (error) {
      logger.error('Failed to load vector store', { error: (error as Error).message });
    }
  }

  /**
   * Clear all documents
   */
  async clear(): Promise<void> {
    this.documents.clear();
    this.indexManager.clear();
    this.isDirty = true;
    await this.save();
    logger.info('Vector store cleared');
  }

  /**
   * Shutdown
   */
  async shutdown(): Promise<void> {
    this.stopAutoSave();
    if (this.isDirty) {
      await this.save();
    }
    this.removeAllListeners();
    this.isInitialized = false;
    logger.info('UnifiedVectorStore shutdown');
  }

  /**
   * Check if store is ready
   */
  isReady(): boolean {
    return this.isInitialized;
  }

  /**
   * Get document count
   */
  get size(): number {
    return this.documents.size;
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

// Singleton instance
let vectorStore: UnifiedVectorStore | null = null;

/**
 * Get or create the vector store instance
 */
export async function getVectorStore(
  config?: Partial<VectorStoreConfig>
): Promise<UnifiedVectorStore> {
  if (!vectorStore) {
    vectorStore = new UnifiedVectorStore(config);
    await vectorStore.initialize();
  }
  return vectorStore;
}

/**
 * Shutdown the vector store
 */
export async function shutdownVectorStore(): Promise<void> {
  if (vectorStore) {
    await vectorStore.shutdown();
    vectorStore = null;
  }
}

export default UnifiedVectorStore;
