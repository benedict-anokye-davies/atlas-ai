/**
 * Atlas Desktop - Vector Store Types
 * Type definitions for the vector storage system
 */

/**
 * Vector document - a stored vector with its metadata
 */
export interface VectorDocument {
  /** Unique document ID */
  id: string;
  /** Vector embedding */
  vector: number[];
  /** Original text content */
  content: string;
  /** Document metadata */
  metadata: VectorMetadata;
  /** Creation timestamp */
  createdAt: number;
  /** Last accessed timestamp */
  accessedAt: number;
}

/**
 * Vector metadata attached to each document
 */
export interface VectorMetadata {
  /** Source type (conversation, fact, preference, etc.) */
  sourceType: 'conversation' | 'fact' | 'preference' | 'context' | 'task' | 'other';
  /** Importance score (0-1) */
  importance: number;
  /** Access count for popularity tracking */
  accessCount: number;
  /** Session ID if from a conversation */
  sessionId?: string;
  /** Associated topics */
  topics?: string[];
  /** User-defined tags */
  tags?: string[];
  /** Whether this is a summary of other documents */
  isSummary?: boolean;
  /** IDs of documents this summarizes (if isSummary) */
  summarizedIds?: string[];
  /** Custom metadata */
  custom?: Record<string, unknown>;
}

/**
 * Vector search result
 */
export interface VectorSearchResult {
  /** The matching document */
  document: VectorDocument;
  /** Similarity score (0-1, higher is more similar) */
  score: number;
  /** Distance metric value (lower is more similar) */
  distance: number;
}

/**
 * Vector search options
 */
export interface VectorSearchOptions {
  /** Number of results to return */
  limit?: number;
  /** Minimum similarity score threshold (0-1) */
  minScore?: number;
  /** Filter by source type */
  sourceType?: VectorMetadata['sourceType'];
  /** Filter by minimum importance */
  minImportance?: number;
  /** Filter by topics (any match) */
  topics?: string[];
  /** Filter by tags (any match) */
  tags?: string[];
  /** Include summary documents */
  includeSummaries?: boolean;
}

/**
 * Vector store configuration
 */
export interface VectorStoreConfig {
  /** Storage directory for persistent data */
  storageDir: string;
  /** Vector dimension size */
  dimensions: number;
  /** Distance metric for similarity */
  distanceMetric: 'cosine' | 'euclidean' | 'dot';
  /** Maximum number of vectors to store */
  maxVectors: number;
  /** Soft limit to trigger cleanup (percentage of maxVectors) */
  cleanupThreshold: number;
  /** Enable persistence to disk */
  enablePersistence: boolean;
  /** Auto-save interval in ms */
  autoSaveInterval: number;
}

/**
 * Default vector store configuration
 */
export const DEFAULT_VECTOR_STORE_CONFIG: VectorStoreConfig = {
  storageDir: '', // Will be set at runtime
  dimensions: 384, // Compatible with many small embedding models
  distanceMetric: 'cosine',
  maxVectors: 100000,
  cleanupThreshold: 0.8, // Cleanup at 80% capacity
  enablePersistence: true,
  autoSaveInterval: 60000, // 1 minute
};

/**
 * Vector store statistics
 */
export interface VectorStoreStats {
  /** Total number of stored vectors */
  totalVectors: number;
  /** Vectors by source type */
  bySourceType: Record<VectorMetadata['sourceType'], number>;
  /** Average importance score */
  averageImportance: number;
  /** Total summary documents */
  summaryCount: number;
  /** Storage size estimate in bytes */
  storageSizeBytes: number;
  /** Percentage of capacity used */
  capacityUsed: number;
}

/**
 * Vector index entry for fast lookup
 */
export interface VectorIndexEntry {
  /** Document ID */
  id: string;
  /** Importance score for prioritized retrieval */
  importance: number;
  /** Last access time for LRU tracking */
  lastAccess: number;
  /** Access count for popularity */
  accessCount: number;
  /** Source type for filtering */
  sourceType: VectorMetadata['sourceType'];
}

/**
 * Batch operation result
 */
export interface BatchOperationResult {
  /** Number of successful operations */
  successful: number;
  /** Number of failed operations */
  failed: number;
  /** IDs of successfully processed documents */
  successIds: string[];
  /** Errors by document ID */
  errors: Record<string, string>;
}

/**
 * Cleanup result
 */
export interface CleanupResult {
  /** Number of documents removed */
  removed: number;
  /** Number of documents summarized */
  summarized: number;
  /** Space freed in bytes (estimate) */
  freedBytes: number;
  /** IDs of removed documents */
  removedIds: string[];
  /** Duration of cleanup in ms */
  durationMs: number;
}

/**
 * Vector store event types
 */
export interface VectorStoreEvents {
  /** Document added */
  'document-added': (doc: VectorDocument) => void;
  /** Document removed */
  'document-removed': (id: string) => void;
  /** Document updated */
  'document-updated': (doc: VectorDocument) => void;
  /** Search performed */
  'search-performed': (query: number[], results: number) => void;
  /** Cleanup triggered */
  'cleanup-started': (reason: string) => void;
  /** Cleanup completed */
  'cleanup-completed': (result: CleanupResult) => void;
  /** Store saved to disk */
  'saved': () => void;
  /** Store loaded from disk */
  'loaded': () => void;
  /** Error occurred */
  'error': (error: Error) => void;
}
