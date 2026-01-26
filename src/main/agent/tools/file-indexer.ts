/**
 * Atlas Desktop - File Indexer
 *
 * Fast file indexing system for quick file searches across the system.
 * Uses fast-glob for directory traversal and maintains an in-memory cache
 * with automatic refresh capabilities.
 *
 * @module agent/tools/file-indexer
 *
 * Features:
 * - Index common directories (home, documents, downloads, projects)
 * - Automatic cache invalidation based on time
 * - Incremental updates for watched directories
 * - File metadata extraction (size, modified, type)
 *
 * @example
 * ```typescript
 * const indexer = FileIndexer.getInstance();
 * await indexer.indexDirectory('/home/user/projects');
 * const results = indexer.searchIndex('config.json');
 * ```
 */

import { homedir } from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { Stats } from 'fs';
import { createModuleLogger } from '../../utils/logger';

const logger = createModuleLogger('FileIndexer');

/**
 * Indexed file entry with metadata
 */
export interface IndexedFile {
  /** Full absolute path */
  path: string;
  /** File name without path */
  name: string;
  /** File name in lowercase for case-insensitive search */
  nameLower: string;
  /** File extension without dot */
  extension: string;
  /** File size in bytes */
  size: number;
  /** Last modified timestamp (ms since epoch) */
  modified: number;
  /** Is this a directory */
  isDirectory: boolean;
  /** Parent directory path */
  directory: string;
}

/**
 * Index statistics for a directory
 */
export interface IndexStats {
  /** Directory that was indexed */
  directory: string;
  /** Total files indexed */
  fileCount: number;
  /** Total directories indexed */
  directoryCount: number;
  /** Total size of all files */
  totalSize: number;
  /** When the index was created */
  indexedAt: number;
  /** Time taken to index (ms) */
  indexDuration: number;
}

/**
 * Index cache entry
 */
interface IndexCacheEntry {
  /** Files in this directory */
  files: IndexedFile[];
  /** Statistics for this directory */
  stats: IndexStats;
  /** When this cache entry expires */
  expiresAt: number;
}

/**
 * Configuration for the file indexer
 */
export interface FileIndexerConfig {
  /** Cache TTL in milliseconds (default: 5 minutes) */
  cacheTtlMs: number;
  /** Maximum files to index per directory (default: 50000) */
  maxFilesPerDir: number;
  /** Maximum depth for recursive indexing (default: 10) */
  maxDepth: number;
  /** Directories to exclude from indexing */
  excludePatterns: string[];
  /** File extensions to exclude */
  excludeExtensions: string[];
}

const DEFAULT_CONFIG: FileIndexerConfig = {
  cacheTtlMs: 5 * 60 * 1000, // 5 minutes
  maxFilesPerDir: 50000,
  maxDepth: 10,
  excludePatterns: [
    '**/node_modules/**',
    '**/.git/**',
    '**/dist/**',
    '**/build/**',
    '**/.cache/**',
    '**/AppData/Local/Temp/**',
    '**/Temp/**',
    '**/$Recycle.Bin/**',
    '**/System Volume Information/**',
    '**/.vscode-server/**',
  ],
  excludeExtensions: [
    'dll',
    'exe',
    'sys',
    'tmp',
    'cache',
    'log',
    'lock',
  ],
};

/**
 * Default directories to index based on platform
 */
export function getDefaultIndexDirectories(): string[] {
  const home = homedir();
  const dirs: string[] = [];

  if (process.platform === 'win32') {
    dirs.push(
      path.join(home, 'Documents'),
      path.join(home, 'Downloads'),
      path.join(home, 'Desktop'),
      path.join(home, 'OneDrive'),
      path.join(home, 'Projects'),
      path.join(home, 'Code'),
    );
  } else {
    dirs.push(
      path.join(home, 'Documents'),
      path.join(home, 'Downloads'),
      path.join(home, 'Desktop'),
      path.join(home, 'Projects'),
      path.join(home, 'Code'),
      path.join(home, 'src'),
    );
  }

  return dirs;
}

/**
 * File Indexer - Singleton class for managing file indexes
 *
 * Provides fast file search capabilities by maintaining an in-memory
 * index of files in configured directories.
 */
export class FileIndexer {
  private static instance: FileIndexer | null = null;
  private cache: Map<string, IndexCacheEntry> = new Map();
  private config: FileIndexerConfig;
  private indexing: Set<string> = new Set();

  private constructor(config: Partial<FileIndexerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Get the singleton instance
   */
  static getInstance(config?: Partial<FileIndexerConfig>): FileIndexer {
    if (!FileIndexer.instance) {
      FileIndexer.instance = new FileIndexer(config);
    }
    return FileIndexer.instance;
  }

  /**
   * Reset the singleton instance (for testing)
   */
  static resetInstance(): void {
    FileIndexer.instance = null;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<FileIndexerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): FileIndexerConfig {
    return { ...this.config };
  }

  /**
   * Index a directory and cache the results
   *
   * @param directory - Directory to index
   * @param force - Force re-index even if cache is valid
   * @returns Index statistics
   */
  async indexDirectory(directory: string, force = false): Promise<IndexStats> {
    const normalizedDir = path.normalize(directory);

    // Check if we're already indexing this directory
    if (this.indexing.has(normalizedDir)) {
      logger.debug('Directory already being indexed', { directory: normalizedDir });
      // Wait for existing indexing to complete
      while (this.indexing.has(normalizedDir)) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const cached = this.cache.get(normalizedDir);
      if (cached) {
        return cached.stats;
      }
    }

    // Check cache validity
    const cached = this.cache.get(normalizedDir);
    if (cached && !force && Date.now() < cached.expiresAt) {
      logger.debug('Using cached index', {
        directory: normalizedDir,
        fileCount: cached.stats.fileCount,
      });
      return cached.stats;
    }

    // Mark as indexing
    this.indexing.add(normalizedDir);
    const startTime = performance.now();

    try {
      // Check if directory exists
      try {
        const stat = await fs.stat(normalizedDir);
        if (!stat.isDirectory()) {
          throw new Error('Path is not a directory');
        }
      } catch (error) {
        const err = error as NodeJS.ErrnoException;
        if (err.code === 'ENOENT') {
          logger.warn('Directory does not exist', { directory: normalizedDir });
          throw new Error(`Directory not found: ${normalizedDir}`);
        }
        throw error;
      }

      // Use fast-glob for efficient file discovery
      const fg = await import('fast-glob');

      const entries = await fg.default(['**/*'], {
        cwd: normalizedDir,
        absolute: true,
        onlyFiles: false,
        stats: true,
        followSymbolicLinks: false,
        ignore: this.config.excludePatterns,
        deep: this.config.maxDepth,
        suppressErrors: true,
      });

      const files: IndexedFile[] = [];
      let totalSize = 0;
      let fileCount = 0;
      let directoryCount = 0;

      for (const entry of entries) {
        if (files.length >= this.config.maxFilesPerDir) {
          logger.warn('Max files per directory reached', {
            directory: normalizedDir,
            limit: this.config.maxFilesPerDir,
          });
          break;
        }

        const stats = entry.stats as Stats;
        if (!stats) continue;

        const ext = path.extname(entry.path).slice(1).toLowerCase();

        // Skip excluded extensions
        if (this.config.excludeExtensions.includes(ext)) {
          continue;
        }

        const fileName = path.basename(entry.path);
        const isDir = stats.isDirectory();

        const indexedFile: IndexedFile = {
          path: entry.path,
          name: fileName,
          nameLower: fileName.toLowerCase(),
          extension: isDir ? '' : ext,
          size: stats.size,
          modified: stats.mtime.getTime(),
          isDirectory: isDir,
          directory: path.dirname(entry.path),
        };

        files.push(indexedFile);

        if (isDir) {
          directoryCount++;
        } else {
          fileCount++;
          totalSize += stats.size;
        }
      }

      const duration = performance.now() - startTime;

      const indexStats: IndexStats = {
        directory: normalizedDir,
        fileCount,
        directoryCount,
        totalSize,
        indexedAt: Date.now(),
        indexDuration: Math.round(duration),
      };

      // Cache the results
      this.cache.set(normalizedDir, {
        files,
        stats: indexStats,
        expiresAt: Date.now() + this.config.cacheTtlMs,
      });

      logger.info('Directory indexed', {
        directory: normalizedDir,
        files: fileCount,
        directories: directoryCount,
        duration: `${duration.toFixed(0)}ms`,
      });

      return indexStats;
    } finally {
      this.indexing.delete(normalizedDir);
    }
  }

  /**
   * Index multiple directories in parallel
   *
   * @param directories - Directories to index
   * @param force - Force re-index
   * @returns Array of index statistics
   */
  async indexDirectories(
    directories: string[],
    force = false
  ): Promise<IndexStats[]> {
    const results = await Promise.allSettled(
      directories.map((dir) => this.indexDirectory(dir, force))
    );

    return results
      .filter((r): r is PromiseFulfilledResult<IndexStats> => r.status === 'fulfilled')
      .map((r) => r.value);
  }

  /**
   * Index default directories
   */
  async indexDefaultDirectories(force = false): Promise<IndexStats[]> {
    const dirs = getDefaultIndexDirectories();
    const existingDirs: string[] = [];

    // Only index directories that exist
    for (const dir of dirs) {
      try {
        await fs.access(dir);
        existingDirs.push(dir);
      } catch {
        // Directory doesn't exist, skip it
      }
    }

    return this.indexDirectories(existingDirs, force);
  }

  /**
   * Search the index by filename
   *
   * @param query - Search query (case-insensitive)
   * @param options - Search options
   * @returns Matching indexed files
   */
  searchIndex(
    query: string,
    options: {
      /** Maximum results to return */
      maxResults?: number;
      /** Only search in specific directories */
      directories?: string[];
      /** Filter by file extensions */
      extensions?: string[];
      /** Include directories in results */
      includeDirectories?: boolean;
      /** Filter by minimum file size */
      minSize?: number;
      /** Filter by maximum file size */
      maxSize?: number;
      /** Filter by modified after (timestamp) */
      modifiedAfter?: number;
      /** Filter by modified before (timestamp) */
      modifiedBefore?: number;
    } = {}
  ): IndexedFile[] {
    const {
      maxResults = 100,
      directories,
      extensions,
      includeDirectories = false,
      minSize,
      maxSize,
      modifiedAfter,
      modifiedBefore,
    } = options;

    const queryLower = query.toLowerCase();
    const results: IndexedFile[] = [];

    // Determine which caches to search
    const cachesToSearch = directories
      ? directories.map((d) => this.cache.get(path.normalize(d))).filter(Boolean)
      : Array.from(this.cache.values());

    for (const cached of cachesToSearch) {
      if (!cached) continue;
      if (results.length >= maxResults) break;

      for (const file of cached.files) {
        if (results.length >= maxResults) break;

        // Skip directories if not requested
        if (file.isDirectory && !includeDirectories) continue;

        // Check name match (contains query)
        if (!file.nameLower.includes(queryLower)) continue;

        // Filter by extension
        if (extensions && extensions.length > 0) {
          if (!extensions.includes(file.extension)) continue;
        }

        // Filter by size
        if (minSize !== undefined && file.size < minSize) continue;
        if (maxSize !== undefined && file.size > maxSize) continue;

        // Filter by modified time
        if (modifiedAfter !== undefined && file.modified < modifiedAfter) continue;
        if (modifiedBefore !== undefined && file.modified > modifiedBefore) continue;

        results.push(file);
      }
    }

    // Sort by relevance (exact matches first, then by how early the match occurs)
    results.sort((a, b) => {
      const aExact = a.nameLower === queryLower;
      const bExact = b.nameLower === queryLower;
      if (aExact && !bExact) return -1;
      if (!aExact && bExact) return 1;

      const aStarts = a.nameLower.startsWith(queryLower);
      const bStarts = b.nameLower.startsWith(queryLower);
      if (aStarts && !bStarts) return -1;
      if (!aStarts && bStarts) return 1;

      const aIndex = a.nameLower.indexOf(queryLower);
      const bIndex = b.nameLower.indexOf(queryLower);
      return aIndex - bIndex;
    });

    return results.slice(0, maxResults);
  }

  /**
   * Get all indexed files (use with caution - can be large)
   */
  getAllIndexedFiles(): IndexedFile[] {
    const files: IndexedFile[] = [];
    for (const cached of this.cache.values()) {
      files.push(...cached.files);
    }
    return files;
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    directories: number;
    totalFiles: number;
    totalSize: number;
    oldestIndex: number | null;
    newestIndex: number | null;
  } {
    let totalFiles = 0;
    let totalSize = 0;
    let oldestIndex: number | null = null;
    let newestIndex: number | null = null;

    for (const cached of this.cache.values()) {
      totalFiles += cached.stats.fileCount + cached.stats.directoryCount;
      totalSize += cached.stats.totalSize;

      if (oldestIndex === null || cached.stats.indexedAt < oldestIndex) {
        oldestIndex = cached.stats.indexedAt;
      }
      if (newestIndex === null || cached.stats.indexedAt > newestIndex) {
        newestIndex = cached.stats.indexedAt;
      }
    }

    return {
      directories: this.cache.size,
      totalFiles,
      totalSize,
      oldestIndex,
      newestIndex,
    };
  }

  /**
   * Clear the entire cache
   */
  clearCache(): void {
    this.cache.clear();
    logger.info('Index cache cleared');
  }

  /**
   * Clear cache for a specific directory
   */
  clearDirectoryCache(directory: string): boolean {
    const normalizedDir = path.normalize(directory);
    const deleted = this.cache.delete(normalizedDir);
    if (deleted) {
      logger.debug('Directory cache cleared', { directory: normalizedDir });
    }
    return deleted;
  }

  /**
   * Check if a directory is indexed and cache is valid
   */
  isIndexed(directory: string): boolean {
    const normalizedDir = path.normalize(directory);
    const cached = this.cache.get(normalizedDir);
    return cached !== undefined && Date.now() < cached.expiresAt;
  }

  /**
   * Get index stats for a directory
   */
  getIndexStats(directory: string): IndexStats | null {
    const normalizedDir = path.normalize(directory);
    const cached = this.cache.get(normalizedDir);
    return cached ? cached.stats : null;
  }
}

export default FileIndexer;
