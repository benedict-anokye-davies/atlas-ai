/**
 * Atlas Desktop - LanceDB Vector Store Implementation
 * Provides vector storage using LanceDB embedded database with advanced indexing
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

// ============================================================================
// INDEX TYPES AND INTERFACES
// ============================================================================

/**
 * Index type enumeration for LanceDB
 */
export type IndexType = 'IVF_PQ' | 'IVF_FLAT' | 'HNSW' | 'BTREE' | 'BITMAP';

/**
 * Index configuration for vector indexes
 */
export interface VectorIndexConfig {
  /** Index type */
  type: 'IVF_PQ' | 'IVF_FLAT' | 'HNSW';
  /** Column to index (usually 'vector') */
  column: string;
  /** Distance metric */
  metric: 'L2' | 'cosine' | 'dot';
  /** Number of partitions for IVF indexes */
  numPartitions?: number;
  /** Number of sub-quantizers for IVF_PQ */
  numSubVectors?: number;
  /** Maximum connections per node for HNSW */
  maxConnections?: number;
  /** Size of dynamic candidate list for HNSW */
  efConstruction?: number;
}

/**
 * Index configuration for scalar/metadata indexes
 */
export interface ScalarIndexConfig {
  /** Index type */
  type: 'BTREE' | 'BITMAP';
  /** Column to index */
  column: string;
}

/**
 * Compound index configuration
 */
export interface CompoundIndexConfig {
  /** Index name */
  name: string;
  /** Columns included in the index */
  columns: string[];
  /** Primary index type */
  type: 'BTREE';
}

/**
 * Index definition (unified)
 */
export interface IndexDefinition {
  /** Index name */
  name: string;
  /** Index configuration */
  config: VectorIndexConfig | ScalarIndexConfig | CompoundIndexConfig;
  /** Whether the index is currently built */
  isBuilt: boolean;
  /** When the index was last built */
  lastBuiltAt?: number;
  /** Number of rows when index was built */
  rowCountAtBuild?: number;
  /** Index build duration in ms */
  buildDurationMs?: number;
}

/**
 * Index statistics
 */
export interface IndexStats {
  /** Index name */
  name: string;
  /** Index type */
  type: IndexType;
  /** Column(s) indexed */
  columns: string[];
  /** Whether index is built */
  isBuilt: boolean;
  /** Last build timestamp */
  lastBuiltAt?: number;
  /** Row count when built */
  rowCountAtBuild?: number;
  /** Estimated index size in bytes */
  estimatedSizeBytes?: number;
  /** Average query speedup factor */
  querySpeedupFactor?: number;
  /** Build duration in ms */
  buildDurationMs?: number;
  /** Usage count since creation */
  usageCount: number;
  /** Last used timestamp */
  lastUsedAt?: number;
}

/**
 * Index suggestion based on query patterns
 */
export interface IndexSuggestion {
  /** Suggested index configuration */
  config: VectorIndexConfig | ScalarIndexConfig | CompoundIndexConfig;
  /** Reason for suggestion */
  reason: string;
  /** Priority (1-10, higher is more important) */
  priority: number;
  /** Estimated query improvement factor */
  estimatedImprovement: number;
  /** Columns affected */
  affectedColumns: string[];
  /** Frequency of queries that would benefit */
  queryFrequency: number;
}

/**
 * Query pattern tracking for index suggestions
 */
interface QueryPattern {
  /** Filter columns used */
  filterColumns: string[];
  /** Whether vector search was performed */
  usesVectorSearch: boolean;
  /** Execution count */
  count: number;
  /** Total execution time in ms */
  totalTimeMs: number;
  /** Last execution timestamp */
  lastUsedAt: number;
}

/**
 * Index maintenance result
 */
export interface IndexMaintenanceResult {
  /** Indexes rebuilt */
  rebuiltIndexes: string[];
  /** Indexes created */
  createdIndexes: string[];
  /** Indexes dropped */
  droppedIndexes: string[];
  /** Total duration in ms */
  durationMs: number;
  /** Any errors encountered */
  errors: Record<string, string>;
}

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
  createIndex: (config: LanceDBIndexConfig) => Promise<void>;
  listIndices?: () => Promise<LanceDBIndexInfo[]>;
}

interface LanceDBIndexConfig {
  type: string;
  column: string;
  metric?: string;
  num_partitions?: number;
  num_sub_vectors?: number;
  max_connections?: number;
  ef_construction?: number;
}

interface LanceDBIndexInfo {
  name: string;
  columns: string[];
  index_type: string;
}

interface LanceDBSearchQuery {
  limit: (n: number) => LanceDBSearchQuery;
  where: (filter: string) => LanceDBSearchQuery;
  select: (columns: string[]) => LanceDBSearchQuery;
  nprobes?: (n: number) => LanceDBSearchQuery;
  refineFactor?: (n: number) => LanceDBSearchQuery;
  execute: () => Promise<LanceDBSearchResult[]>;
}

interface LanceDBSearchResult {
  id: string;
  vector: number[];
  content: string;
  metadata: string;
  sourceType: string;
  importance: number;
  createdAt: number;
  accessedAt: number;
  _distance: number;
}

// ============================================================================
// DEFAULT INDEX CONFIGURATIONS
// ============================================================================

/**
 * Default vector index configuration (IVF_PQ for large datasets)
 */
const DEFAULT_VECTOR_INDEX_CONFIG: VectorIndexConfig = {
  type: 'IVF_PQ',
  column: 'vector',
  metric: 'cosine',
  numPartitions: 256,
  numSubVectors: 16,
};

/**
 * HNSW index configuration (better recall, higher memory)
 * Exported for external use when HNSW is preferred over IVF_PQ
 */
export const HNSW_VECTOR_INDEX_CONFIG: VectorIndexConfig = {
  type: 'HNSW',
  column: 'vector',
  metric: 'cosine',
  maxConnections: 16,
  efConstruction: 128,
};

/**
 * Default scalar indexes for common filters
 */
const DEFAULT_SCALAR_INDEXES: ScalarIndexConfig[] = [
  { type: 'BTREE', column: 'sourceType' },
  { type: 'BTREE', column: 'importance' },
  { type: 'BTREE', column: 'createdAt' },
  { type: 'BTREE', column: 'accessedAt' },
];

/**
 * Threshold for automatic index creation (minimum rows)
 */
const INDEX_CREATION_THRESHOLD = 1000;

/**
 * Threshold for index rebuild (percentage of new rows since last build)
 */
const INDEX_REBUILD_THRESHOLD = 0.2;

/**
 * LanceDB Vector Store
 * Production-ready vector storage with LanceDB backend and advanced indexing
 */
export class LanceDBVectorStore extends EventEmitter {
  private config: VectorStoreConfig;
  private db: LanceDBConnection | null = null;
  private table: LanceDBTable | null = null;
  private isInitialized = false;
  private autoSaveTimer: NodeJS.Timeout | null = null;

  // In-memory index for fast lookups
  private index: Map<string, { importance: number; accessedAt: number }> = new Map();

  // Index management
  private indexes: Map<string, IndexDefinition> = new Map();
  private indexStats: Map<string, IndexStats> = new Map();
  private queryPatterns: Map<string, QueryPattern> = new Map();
  private indexMaintenanceTimer: NodeJS.Timeout | null = null;

  // Performance tracking
  private queryExecutionTimes: number[] = [];
  private lastRowCount = 0;

  constructor(config?: Partial<VectorStoreConfig>) {
    super();
    this.config = { ...DEFAULT_VECTOR_STORE_CONFIG, ...config };

    if (!this.config.storageDir) {
      this.config.storageDir = path.join(
        process.env.HOME || process.env.USERPROFILE || '.',
        '.atlas',
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
        await this.loadIndexMetadata();
        logger.info('Opened existing vectors table');
      } else {
        // Create empty table with schema including denormalized metadata columns
        this.table = await this.db.createTable('vectors', [
          {
            id: '__schema__',
            vector: new Array(this.config.dimensions).fill(0),
            content: '',
            metadata: '{}',
            sourceType: 'other',
            importance: 0,
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

      // Start index maintenance timer (check every 5 minutes)
      this.startIndexMaintenance();

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

  // ============================================================================
  // INDEX MANAGEMENT METHODS
  // ============================================================================

  /**
   * Create a vector index for similarity search
   */
  async createVectorIndex(
    config: VectorIndexConfig = DEFAULT_VECTOR_INDEX_CONFIG
  ): Promise<void> {
    if (!this.isInitialized || !this.table) {
      throw new Error('Vector store not initialized');
    }

    const indexName = `idx_vector_${config.type.toLowerCase()}`;
    const startTime = Date.now();

    try {
      // Build LanceDB index configuration
      const lanceConfig: LanceDBIndexConfig = {
        type: config.type,
        column: config.column,
        metric: config.metric.toLowerCase(),
      };

      // Add type-specific options
      if (config.type === 'IVF_PQ' || config.type === 'IVF_FLAT') {
        if (config.numPartitions) {
          lanceConfig.num_partitions = config.numPartitions;
        }
        if (config.type === 'IVF_PQ' && config.numSubVectors) {
          lanceConfig.num_sub_vectors = config.numSubVectors;
        }
      } else if (config.type === 'HNSW') {
        if (config.maxConnections) {
          lanceConfig.max_connections = config.maxConnections;
        }
        if (config.efConstruction) {
          lanceConfig.ef_construction = config.efConstruction;
        }
      }

      await this.table.createIndex(lanceConfig);

      const buildDuration = Date.now() - startTime;
      const rowCount = await this.table.countRows();

      // Store index definition
      const indexDef: IndexDefinition = {
        name: indexName,
        config,
        isBuilt: true,
        lastBuiltAt: Date.now(),
        rowCountAtBuild: rowCount,
        buildDurationMs: buildDuration,
      };
      this.indexes.set(indexName, indexDef);

      // Initialize stats
      this.indexStats.set(indexName, {
        name: indexName,
        type: config.type,
        columns: [config.column],
        isBuilt: true,
        lastBuiltAt: Date.now(),
        rowCountAtBuild: rowCount,
        buildDurationMs: buildDuration,
        usageCount: 0,
      });

      await this.saveIndexMetadata();

      logger.info('Vector index created', {
        name: indexName,
        type: config.type,
        buildDurationMs: buildDuration,
        rowCount,
      });
    } catch (error) {
      logger.error('Failed to create vector index', {
        name: indexName,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * Create a scalar index for metadata filtering
   */
  async createScalarIndex(config: ScalarIndexConfig): Promise<void> {
    if (!this.isInitialized || !this.table) {
      throw new Error('Vector store not initialized');
    }

    const indexName = `idx_${config.column}_${config.type.toLowerCase()}`;
    const startTime = Date.now();

    try {
      const lanceConfig: LanceDBIndexConfig = {
        type: config.type,
        column: config.column,
      };

      await this.table.createIndex(lanceConfig);

      const buildDuration = Date.now() - startTime;
      const rowCount = await this.table.countRows();

      // Store index definition
      const indexDef: IndexDefinition = {
        name: indexName,
        config,
        isBuilt: true,
        lastBuiltAt: Date.now(),
        rowCountAtBuild: rowCount,
        buildDurationMs: buildDuration,
      };
      this.indexes.set(indexName, indexDef);

      // Initialize stats
      this.indexStats.set(indexName, {
        name: indexName,
        type: config.type,
        columns: [config.column],
        isBuilt: true,
        lastBuiltAt: Date.now(),
        rowCountAtBuild: rowCount,
        buildDurationMs: buildDuration,
        usageCount: 0,
      });

      await this.saveIndexMetadata();

      logger.info('Scalar index created', {
        name: indexName,
        column: config.column,
        type: config.type,
        buildDurationMs: buildDuration,
      });
    } catch (error) {
      logger.error('Failed to create scalar index', {
        name: indexName,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * Create default indexes for optimal query performance
   */
  async createDefaultIndexes(): Promise<IndexMaintenanceResult> {
    const result: IndexMaintenanceResult = {
      rebuiltIndexes: [],
      createdIndexes: [],
      droppedIndexes: [],
      durationMs: 0,
      errors: {},
    };

    const startTime = Date.now();

    try {
      // Check if we have enough data for indexes
      const rowCount = await this.table?.countRows();
      if (!rowCount || rowCount < INDEX_CREATION_THRESHOLD) {
        logger.info('Skipping index creation - not enough data', { rowCount });
        result.durationMs = Date.now() - startTime;
        return result;
      }

      // Create vector index if not exists
      if (!this.indexes.has('idx_vector_ivf_pq')) {
        try {
          await this.createVectorIndex(DEFAULT_VECTOR_INDEX_CONFIG);
          result.createdIndexes.push('idx_vector_ivf_pq');
        } catch (error) {
          result.errors['idx_vector_ivf_pq'] = (error as Error).message;
        }
      }

      // Create scalar indexes
      for (const scalarConfig of DEFAULT_SCALAR_INDEXES) {
        const indexName = `idx_${scalarConfig.column}_${scalarConfig.type.toLowerCase()}`;
        if (!this.indexes.has(indexName)) {
          try {
            await this.createScalarIndex(scalarConfig);
            result.createdIndexes.push(indexName);
          } catch (error) {
            result.errors[indexName] = (error as Error).message;
          }
        }
      }

      result.durationMs = Date.now() - startTime;

      logger.info('Default indexes created', {
        created: result.createdIndexes.length,
        errors: Object.keys(result.errors).length,
        durationMs: result.durationMs,
      });
    } catch (error) {
      logger.error('Failed to create default indexes', {
        error: (error as Error).message,
      });
    }

    return result;
  }

  /**
   * Rebuild a specific index
   */
  async rebuildIndexByName(indexName: string): Promise<void> {
    const indexDef = this.indexes.get(indexName);
    if (!indexDef) {
      throw new Error(`Index ${indexName} not found`);
    }

    const startTime = Date.now();

    try {
      // Recreate the index based on its configuration
      if ('metric' in indexDef.config) {
        await this.createVectorIndex(indexDef.config as VectorIndexConfig);
      } else if ('column' in indexDef.config && !('columns' in indexDef.config)) {
        await this.createScalarIndex(indexDef.config as ScalarIndexConfig);
      }

      const buildDuration = Date.now() - startTime;

      // Update stats
      const stats = this.indexStats.get(indexName);
      if (stats) {
        stats.lastBuiltAt = Date.now();
        stats.buildDurationMs = buildDuration;
        stats.rowCountAtBuild = await this.table?.countRows();
      }

      logger.info('Index rebuilt', { name: indexName, buildDurationMs: buildDuration });
    } catch (error) {
      logger.error('Failed to rebuild index', {
        name: indexName,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * Run index maintenance - rebuild stale indexes
   */
  async runIndexMaintenance(): Promise<IndexMaintenanceResult> {
    const result: IndexMaintenanceResult = {
      rebuiltIndexes: [],
      createdIndexes: [],
      droppedIndexes: [],
      durationMs: 0,
      errors: {},
    };

    const startTime = Date.now();

    try {
      const currentRowCount = (await this.table?.countRows()) || 0;

      // Check each index for staleness
      for (const [indexName, indexDef] of this.indexes) {
        if (!indexDef.isBuilt || !indexDef.rowCountAtBuild) continue;

        const rowsSinceLastBuild = currentRowCount - indexDef.rowCountAtBuild;
        const rebuildRatio = rowsSinceLastBuild / indexDef.rowCountAtBuild;

        if (rebuildRatio >= INDEX_REBUILD_THRESHOLD) {
          try {
            await this.rebuildIndexByName(indexName);
            result.rebuiltIndexes.push(indexName);
          } catch (error) {
            result.errors[indexName] = (error as Error).message;
          }
        }
      }

      // Check if we should create default indexes
      if (currentRowCount >= INDEX_CREATION_THRESHOLD && this.indexes.size === 0) {
        const createResult = await this.createDefaultIndexes();
        result.createdIndexes.push(...createResult.createdIndexes);
        Object.assign(result.errors, createResult.errors);
      }

      // Apply automatic index suggestions
      const suggestions = await this.getIndexSuggestions();
      for (const suggestion of suggestions.filter((s) => s.priority >= 8)) {
        const config = suggestion.config;
        let indexName: string;

        if ('metric' in config) {
          indexName = `idx_vector_${config.type.toLowerCase()}`;
        } else if ('columns' in config) {
          indexName = (config as CompoundIndexConfig).name;
        } else {
          indexName = `idx_${(config as ScalarIndexConfig).column}_${config.type.toLowerCase()}`;
        }

        if (!this.indexes.has(indexName)) {
          try {
            if ('metric' in config) {
              await this.createVectorIndex(config as VectorIndexConfig);
            } else if (!('columns' in config)) {
              await this.createScalarIndex(config as ScalarIndexConfig);
            }
            result.createdIndexes.push(indexName);
          } catch (error) {
            result.errors[indexName] = (error as Error).message;
          }
        }
      }

      this.lastRowCount = currentRowCount;
      result.durationMs = Date.now() - startTime;

      logger.info('Index maintenance completed', {
        rebuilt: result.rebuiltIndexes.length,
        created: result.createdIndexes.length,
        errors: Object.keys(result.errors).length,
        durationMs: result.durationMs,
      });
    } catch (error) {
      logger.error('Index maintenance failed', { error: (error as Error).message });
    }

    return result;
  }

  /**
   * Get statistics for all indexes
   */
  getIndexStats(): IndexStats[] {
    return Array.from(this.indexStats.values());
  }

  /**
   * Get statistics for a specific index
   */
  getIndexStatsByName(indexName: string): IndexStats | null {
    return this.indexStats.get(indexName) || null;
  }

  /**
   * Get index suggestions based on query patterns
   */
  async getIndexSuggestions(): Promise<IndexSuggestion[]> {
    const suggestions: IndexSuggestion[] = [];

    // Analyze query patterns
    const sortedPatterns = Array.from(this.queryPatterns.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);

    for (const pattern of sortedPatterns) {
      // Suggest vector index if heavy vector search usage
      if (pattern.usesVectorSearch && !this.indexes.has('idx_vector_ivf_pq')) {
        const avgTimeMs = pattern.totalTimeMs / pattern.count;
        if (avgTimeMs > 100) {
          suggestions.push({
            config: DEFAULT_VECTOR_INDEX_CONFIG,
            reason: `Heavy vector search usage (${pattern.count} queries, avg ${avgTimeMs.toFixed(0)}ms)`,
            priority: Math.min(10, Math.floor(pattern.count / 10) + 5),
            estimatedImprovement: 3.0,
            affectedColumns: ['vector'],
            queryFrequency: pattern.count,
          });
        }
      }

      // Suggest scalar indexes for frequently filtered columns
      for (const column of pattern.filterColumns) {
        const indexName = `idx_${column}_btree`;
        if (!this.indexes.has(indexName)) {
          suggestions.push({
            config: { type: 'BTREE', column },
            reason: `Frequently filtered column (${pattern.count} queries)`,
            priority: Math.min(10, Math.floor(pattern.count / 20) + 3),
            estimatedImprovement: 2.0,
            affectedColumns: [column],
            queryFrequency: pattern.count,
          });
        }
      }

      // Suggest BITMAP for low-cardinality columns
      if (
        pattern.filterColumns.includes('sourceType') &&
        !this.indexes.has('idx_sourceType_bitmap')
      ) {
        suggestions.push({
          config: { type: 'BITMAP', column: 'sourceType' },
          reason: 'Low-cardinality column with frequent filtering',
          priority: 6,
          estimatedImprovement: 2.5,
          affectedColumns: ['sourceType'],
          queryFrequency: pattern.count,
        });
      }
    }

    // Deduplicate suggestions by affected columns
    const seen = new Set<string>();
    const uniqueSuggestions: IndexSuggestion[] = [];
    for (const suggestion of suggestions.sort((a, b) => b.priority - a.priority)) {
      const key = suggestion.affectedColumns.sort().join(',');
      if (!seen.has(key)) {
        seen.add(key);
        uniqueSuggestions.push(suggestion);
      }
    }

    return uniqueSuggestions;
  }

  /**
   * Track query pattern for index suggestions
   */
  private trackQueryPattern(
    filterColumns: string[],
    usesVectorSearch: boolean,
    executionTimeMs: number
  ): void {
    const key = [...filterColumns.sort(), usesVectorSearch ? 'vector' : ''].join('|');

    const existing = this.queryPatterns.get(key);
    if (existing) {
      existing.count++;
      existing.totalTimeMs += executionTimeMs;
      existing.lastUsedAt = Date.now();
    } else {
      this.queryPatterns.set(key, {
        filterColumns,
        usesVectorSearch,
        count: 1,
        totalTimeMs: executionTimeMs,
        lastUsedAt: Date.now(),
      });
    }

    // Track execution time for performance monitoring
    this.queryExecutionTimes.push(executionTimeMs);
    if (this.queryExecutionTimes.length > 1000) {
      this.queryExecutionTimes = this.queryExecutionTimes.slice(-500);
    }
  }

  /**
   * Update index usage statistics
   */
  private updateIndexUsage(indexNames: string[]): void {
    for (const name of indexNames) {
      const stats = this.indexStats.get(name);
      if (stats) {
        stats.usageCount++;
        stats.lastUsedAt = Date.now();
      }
    }
  }

  /**
   * Start index maintenance timer
   */
  private startIndexMaintenance(): void {
    if (this.indexMaintenanceTimer) return;

    // Run maintenance every 5 minutes
    this.indexMaintenanceTimer = setInterval(
      () => {
        this.runIndexMaintenance().catch((error) => {
          logger.error('Index maintenance error', { error: (error as Error).message });
        });
      },
      5 * 60 * 1000
    );

    // Also run immediately after a delay to allow data to accumulate
    setTimeout(() => {
      this.runIndexMaintenance().catch((error) => {
        logger.error('Initial index maintenance error', { error: (error as Error).message });
      });
    }, 30000);
  }

  /**
   * Stop index maintenance timer
   */
  private stopIndexMaintenance(): void {
    if (this.indexMaintenanceTimer) {
      clearInterval(this.indexMaintenanceTimer);
      this.indexMaintenanceTimer = null;
    }
  }

  /**
   * Save index metadata to disk
   */
  private async saveIndexMetadata(): Promise<void> {
    try {
      const metadataPath = path.join(this.config.storageDir, 'index-metadata.json');
      const metadata = {
        indexes: Array.from(this.indexes.entries()),
        stats: Array.from(this.indexStats.entries()),
        queryPatterns: Array.from(this.queryPatterns.entries()),
        lastRowCount: this.lastRowCount,
        savedAt: Date.now(),
      };
      await fs.promises.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
    } catch (error) {
      logger.warn('Failed to save index metadata', { error: (error as Error).message });
    }
  }

  /**
   * Load index metadata from disk
   */
  private async loadIndexMetadata(): Promise<void> {
    try {
      const metadataPath = path.join(this.config.storageDir, 'index-metadata.json');
      const data = await fs.promises.readFile(metadataPath, 'utf-8');
      const metadata = JSON.parse(data);

      this.indexes = new Map(metadata.indexes || []);
      this.indexStats = new Map(metadata.stats || []);
      this.queryPatterns = new Map(metadata.queryPatterns || []);
      this.lastRowCount = metadata.lastRowCount || 0;

      logger.info('Index metadata loaded', {
        indexes: this.indexes.size,
        patterns: this.queryPatterns.size,
      });
    } catch {
      // File doesn't exist or is corrupted - start fresh
      logger.debug('No existing index metadata found');
    }
  }

  /**
   * Get optimal search parameters based on indexes
   */
  private getOptimalSearchParams(options: VectorSearchOptions): {
    nprobes?: number;
    refineFactor?: number;
    useIndex: boolean;
    indexHints: string[];
  } {
    const result = {
      nprobes: undefined as number | undefined,
      refineFactor: undefined as number | undefined,
      useIndex: false,
      indexHints: [] as string[],
    };

    // Check for vector index
    const vectorIndex = this.indexes.get('idx_vector_ivf_pq');
    if (vectorIndex?.isBuilt) {
      result.useIndex = true;
      result.indexHints.push('idx_vector_ivf_pq');

      // Adjust nprobes based on limit (more probes for higher recall)
      const limit = options.limit || 10;
      result.nprobes = Math.min(32, Math.max(8, Math.ceil(limit / 2)));

      // Use refine factor for better accuracy
      result.refineFactor = 2;
    }

    // Check for HNSW index
    const hnswIndex = this.indexes.get('idx_vector_hnsw');
    if (hnswIndex?.isBuilt && !result.useIndex) {
      result.useIndex = true;
      result.indexHints.push('idx_vector_hnsw');
    }

    // Check for scalar indexes that match filters
    if (options.sourceType) {
      const sourceTypeIdx = this.indexes.get('idx_sourceType_btree');
      if (sourceTypeIdx?.isBuilt) {
        result.indexHints.push('idx_sourceType_btree');
      }
    }

    if (options.minImportance !== undefined) {
      const importanceIdx = this.indexes.get('idx_importance_btree');
      if (importanceIdx?.isBuilt) {
        result.indexHints.push('idx_importance_btree');
      }
    }

    return result;
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

    // Add to LanceDB with denormalized columns for efficient indexing
    await this.table.add([
      {
        id: doc.id,
        vector: doc.vector,
        content: doc.content,
        metadata: JSON.stringify(doc.metadata),
        // Denormalized columns for index efficiency
        sourceType: fullMetadata.sourceType,
        importance: fullMetadata.importance,
        createdAt: doc.createdAt,
        accessedAt: doc.accessedAt,
      },
    ]);

    // Update in-memory index
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
   * Search for similar vectors with index-optimized query execution
   */
  async search(
    queryVector: number[],
    options: VectorSearchOptions = {}
  ): Promise<VectorSearchResult[]> {
    if (!this.isInitialized || !this.table) {
      throw new Error('Vector store not initialized');
    }

    const startTime = Date.now();
    const limit = options.limit ?? 10;
    const minScore = options.minScore ?? 0;

    // Get optimal search parameters based on available indexes
    const searchParams = this.getOptimalSearchParams(options);

    // Build search query with index hints
    let query = this.table.search(queryVector).limit(limit * 2); // Over-fetch for filtering

    // Apply index-specific optimizations
    if (searchParams.nprobes && query.nprobes) {
      query = query.nprobes(searchParams.nprobes);
    }
    if (searchParams.refineFactor && query.refineFactor) {
      query = query.refineFactor(searchParams.refineFactor);
    }

    // Build optimized filters using denormalized columns
    const filters: string[] = [];
    const filterColumns: string[] = [];

    if (options.sourceType) {
      // Use denormalized column for efficient filtering
      filters.push(`sourceType = '${options.sourceType}'`);
      filterColumns.push('sourceType');
    }

    if (options.minImportance !== undefined) {
      // Use denormalized column for efficient range filtering
      filters.push(`importance >= ${options.minImportance}`);
      filterColumns.push('importance');
    }

    if (!options.includeSummaries) {
      filters.push(`metadata NOT LIKE '%"isSummary":true%'`);
    }

    if (filters.length > 0) {
      query = query.where(filters.join(' AND '));
    }

    const rawResults = await query.execute();

    // Calculate execution time for pattern tracking
    const executionTime = Date.now() - startTime;

    // Track query pattern for index suggestions
    this.trackQueryPattern(filterColumns, true, executionTime);

    // Update index usage statistics
    if (searchParams.indexHints.length > 0) {
      this.updateIndexUsage(searchParams.indexHints);
    }

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

      // Apply additional metadata filters (topics/tags not in denormalized columns)
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

      // Update access tracking in memory
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
    logger.debug('Search performed', {
      results: results.length,
      executionTimeMs: executionTime,
      usedIndexes: searchParams.indexHints,
    });

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
    const summaryCount = 0;

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
   * Clear all documents and reset indexes
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
          sourceType: 'other',
          importance: 0,
          createdAt: Date.now(),
          accessedAt: Date.now(),
        },
      ]);
      await this.table.delete("id = '__schema__'");

      // Clear all in-memory state
      this.index.clear();
      this.indexes.clear();
      this.indexStats.clear();
      this.queryPatterns.clear();
      this.queryExecutionTimes = [];
      this.lastRowCount = 0;

      // Save cleared metadata
      await this.saveIndexMetadata();

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
    // Stop all timers
    this.stopAutoSave();
    this.stopIndexMaintenance();

    // Save index metadata before shutdown
    await this.saveIndexMetadata();

    // Clean up resources
    this.removeAllListeners();
    this.db = null;
    this.table = null;
    this.isInitialized = false;

    logger.info('LanceDBVectorStore shutdown');
  }

  // ============================================================================
  // ADDITIONAL INDEX MONITORING METHODS
  // ============================================================================

  /**
   * Get query performance statistics
   */
  getQueryPerformanceStats(): {
    averageTimeMs: number;
    p50TimeMs: number;
    p95TimeMs: number;
    p99TimeMs: number;
    totalQueries: number;
  } {
    if (this.queryExecutionTimes.length === 0) {
      return {
        averageTimeMs: 0,
        p50TimeMs: 0,
        p95TimeMs: 0,
        p99TimeMs: 0,
        totalQueries: 0,
      };
    }

    const sorted = [...this.queryExecutionTimes].sort((a, b) => a - b);
    const len = sorted.length;

    return {
      averageTimeMs: sorted.reduce((a, b) => a + b, 0) / len,
      p50TimeMs: sorted[Math.floor(len * 0.5)] || 0,
      p95TimeMs: sorted[Math.floor(len * 0.95)] || 0,
      p99TimeMs: sorted[Math.floor(len * 0.99)] || 0,
      totalQueries: len,
    };
  }

  /**
   * Get comprehensive index health report
   */
  async getIndexHealthReport(): Promise<{
    totalIndexes: number;
    builtIndexes: number;
    staleIndexes: string[];
    suggestedIndexes: IndexSuggestion[];
    queryPerformance: {
      averageTimeMs: number;
      p50TimeMs: number;
      p95TimeMs: number;
      p99TimeMs: number;
      totalQueries: number;
    };
    maintenanceRecommendations: string[];
  }> {
    const currentRowCount = (await this.table?.countRows()) || 0;
    const staleIndexes: string[] = [];
    const recommendations: string[] = [];

    // Check for stale indexes
    for (const [indexName, indexDef] of this.indexes) {
      if (!indexDef.isBuilt || !indexDef.rowCountAtBuild) continue;

      const rowsSinceLastBuild = currentRowCount - indexDef.rowCountAtBuild;
      const rebuildRatio = rowsSinceLastBuild / indexDef.rowCountAtBuild;

      if (rebuildRatio >= INDEX_REBUILD_THRESHOLD) {
        staleIndexes.push(indexName);
      }
    }

    // Generate recommendations
    if (staleIndexes.length > 0) {
      recommendations.push(
        `${staleIndexes.length} index(es) are stale and should be rebuilt: ${staleIndexes.join(', ')}`
      );
    }

    if (currentRowCount >= INDEX_CREATION_THRESHOLD && this.indexes.size === 0) {
      recommendations.push(
        'Dataset is large enough for indexes but none exist. Run createDefaultIndexes().'
      );
    }

    const suggestions = await this.getIndexSuggestions();
    const highPrioritySuggestions = suggestions.filter((s) => s.priority >= 7);
    if (highPrioritySuggestions.length > 0) {
      recommendations.push(
        `${highPrioritySuggestions.length} high-priority index suggestion(s) available.`
      );
    }

    const queryPerf = this.getQueryPerformanceStats();
    if (queryPerf.p95TimeMs > 500) {
      recommendations.push(
        'P95 query latency is high (>500ms). Consider creating vector index.'
      );
    }

    return {
      totalIndexes: this.indexes.size,
      builtIndexes: Array.from(this.indexes.values()).filter((i) => i.isBuilt).length,
      staleIndexes,
      suggestedIndexes: suggestions,
      queryPerformance: queryPerf,
      maintenanceRecommendations: recommendations,
    };
  }

  /**
   * Force rebuild all indexes
   */
  async rebuildAllIndexes(): Promise<IndexMaintenanceResult> {
    const result: IndexMaintenanceResult = {
      rebuiltIndexes: [],
      createdIndexes: [],
      droppedIndexes: [],
      durationMs: 0,
      errors: {},
    };

    const startTime = Date.now();

    for (const [indexName] of this.indexes) {
      try {
        await this.rebuildIndexByName(indexName);
        result.rebuiltIndexes.push(indexName);
      } catch (error) {
        result.errors[indexName] = (error as Error).message;
      }
    }

    result.durationMs = Date.now() - startTime;

    logger.info('All indexes rebuilt', {
      rebuilt: result.rebuiltIndexes.length,
      errors: Object.keys(result.errors).length,
      durationMs: result.durationMs,
    });

    return result;
  }

  /**
   * Drop a specific index
   */
  async dropIndex(indexName: string): Promise<boolean> {
    if (!this.indexes.has(indexName)) {
      return false;
    }

    // Note: LanceDB may not support dropping indexes directly
    // This removes our tracking of the index
    this.indexes.delete(indexName);
    this.indexStats.delete(indexName);
    await this.saveIndexMetadata();

    logger.info('Index dropped', { name: indexName });
    return true;
  }

  /**
   * List all indexes
   */
  listIndexes(): IndexDefinition[] {
    return Array.from(this.indexes.values());
  }

  /**
   * Check if a specific index exists and is built
   */
  hasIndex(indexName: string): boolean {
    const index = this.indexes.get(indexName);
    return index?.isBuilt === true;
  }

  /**
   * Get the most frequently used query patterns
   */
  getTopQueryPatterns(limit = 10): Array<QueryPattern & { key: string }> {
    return Array.from(this.queryPatterns.entries())
      .map(([key, pattern]) => ({ ...pattern, key }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
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
