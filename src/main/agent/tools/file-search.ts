/**
 * Atlas Desktop - File Search Tool
 *
 * Fast file search across the system with fuzzy matching, content search,
 * and filtering capabilities. Integrates with the FileIndexer for speed.
 *
 * @module agent/tools/file-search
 *
 * Voice Commands Supported:
 * - "Find file named X"
 * - "Search for X in files"
 * - "Find files containing X"
 * - "Show me recent files"
 * - "Find all JSON files in Documents"
 *
 * @example
 * ```typescript
 * import { fileSearchTool, contentSearchTool, getFileSearchTools } from './file-search';
 *
 * // File name search
 * const result = await fileSearchTool.execute({ query: 'config.json' });
 *
 * // Content search
 * const contentResult = await contentSearchTool.execute({
 *   query: 'export function',
 *   directory: '/path/to/project',
 *   extensions: ['ts', 'js']
 * });
 * ```
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { shell } from 'electron';
import { createModuleLogger } from '../../utils/logger';
import { AgentTool, ActionResult, FileInfo } from '../../../shared/types/agent';
import {
  FileIndexer,
  IndexedFile,
  getDefaultIndexDirectories,
} from './file-indexer';

const logger = createModuleLogger('FileSearch');

// Configuration
const MAX_SEARCH_RESULTS = 100;
const MAX_CONTENT_RESULTS = 50;
const MAX_CONTEXT_LINES = 3;
const MAX_FILE_SIZE_FOR_CONTENT_SEARCH = 5 * 1024 * 1024; // 5MB
const CONTENT_SNIPPET_LENGTH = 200;

/**
 * Search result with relevance scoring
 */
export interface FileSearchResult {
  /** File path */
  path: string;
  /** File name */
  name: string;
  /** File extension */
  extension: string;
  /** File size in bytes */
  size: number;
  /** Last modified (ISO string) */
  modified: string;
  /** Is directory */
  isDirectory: boolean;
  /** Relevance score (higher is better) */
  score: number;
  /** Match type */
  matchType: 'exact' | 'startsWith' | 'contains' | 'fuzzy';
}

/**
 * Content search result with context
 */
export interface ContentSearchResult {
  /** File path */
  path: string;
  /** File name */
  name: string;
  /** Line number where match was found */
  lineNumber: number;
  /** The matching line */
  matchingLine: string;
  /** Context lines before the match */
  contextBefore: string[];
  /** Context lines after the match */
  contextAfter: string[];
  /** Column where match starts */
  column: number;
}

/**
 * Calculate fuzzy match score between query and target
 * Higher score = better match
 */
function fuzzyMatchScore(query: string, target: string): number {
  const queryLower = query.toLowerCase();
  const targetLower = target.toLowerCase();

  // Exact match
  if (targetLower === queryLower) {
    return 1000;
  }

  // Starts with query
  if (targetLower.startsWith(queryLower)) {
    return 800 + (queryLower.length / targetLower.length) * 100;
  }

  // Contains query as substring
  const containsIndex = targetLower.indexOf(queryLower);
  if (containsIndex !== -1) {
    return 500 + (queryLower.length / targetLower.length) * 100 - containsIndex;
  }

  // Fuzzy matching - check if all characters appear in order
  let queryIndex = 0;
  const matchPositions: number[] = [];

  for (let i = 0; i < targetLower.length && queryIndex < queryLower.length; i++) {
    if (targetLower[i] === queryLower[queryIndex]) {
      matchPositions.push(i);
      queryIndex++;
    }
  }

  // All query characters found in order
  if (queryIndex === queryLower.length) {
    // Score based on how compact the matches are
    const spread = matchPositions[matchPositions.length - 1] - matchPositions[0];
    const compactness = queryLower.length / (spread + 1);
    return 200 + compactness * 100;
  }

  // No match
  return 0;
}

/**
 * Get match type based on score
 */
function getMatchType(score: number): 'exact' | 'startsWith' | 'contains' | 'fuzzy' {
  if (score >= 1000) return 'exact';
  if (score >= 800) return 'startsWith';
  if (score >= 500) return 'contains';
  return 'fuzzy';
}

/**
 * Convert IndexedFile to FileSearchResult with scoring
 */
function toSearchResult(file: IndexedFile, query: string): FileSearchResult {
  const score = fuzzyMatchScore(query, file.name);
  return {
    path: file.path,
    name: file.name,
    extension: file.extension,
    size: file.size,
    modified: new Date(file.modified).toISOString(),
    isDirectory: file.isDirectory,
    score,
    matchType: getMatchType(score),
  };
}

/**
 * File name search tool
 *
 * Searches for files by name across indexed directories with fuzzy matching.
 */
export const fileSearchTool: AgentTool = {
  name: 'file_search',
  description:
    'Search for files by name across the system. Supports fuzzy matching, ' +
    'filtering by extension, size, and modification date. ' +
    'Use this for voice commands like "Find file named X" or "Search for X".',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'File name or partial name to search for',
      },
      directory: {
        type: 'string',
        description: 'Directory to search in (default: common directories)',
      },
      extensions: {
        type: 'array',
        description: 'Filter by file extensions (e.g., ["ts", "js", "json"])',
        items: { type: 'string' },
      },
      includeDirectories: {
        type: 'boolean',
        description: 'Include directories in results (default: false)',
      },
      maxResults: {
        type: 'number',
        description: 'Maximum number of results (default: 50)',
      },
      minSize: {
        type: 'number',
        description: 'Minimum file size in bytes',
      },
      maxSize: {
        type: 'number',
        description: 'Maximum file size in bytes',
      },
      modifiedWithinDays: {
        type: 'number',
        description: 'Only files modified within this many days',
      },
      fuzzyMatch: {
        type: 'boolean',
        description: 'Enable fuzzy matching (default: true)',
      },
    },
    required: ['query'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const query = params.query as string;
      const directory = params.directory as string | undefined;
      const extensions = params.extensions as string[] | undefined;
      const includeDirectories = params.includeDirectories === true;
      const maxResults = Math.min(
        (params.maxResults as number) || 50,
        MAX_SEARCH_RESULTS
      );
      const minSize = params.minSize as number | undefined;
      const maxSize = params.maxSize as number | undefined;
      const modifiedWithinDays = params.modifiedWithinDays as number | undefined;
      const fuzzyMatch = params.fuzzyMatch !== false;

      if (!query || query.trim().length === 0) {
        return { success: false, error: 'Query is required' };
      }

      const indexer = FileIndexer.getInstance();

      // Determine directories to search
      let searchDirs: string[];
      if (directory) {
        const resolvedDir = path.resolve(directory);
        searchDirs = [resolvedDir];

        // Index the directory if not already indexed
        if (!indexer.isIndexed(resolvedDir)) {
          await indexer.indexDirectory(resolvedDir);
        }
      } else {
        // Use default directories, ensuring they're indexed
        const defaultDirs = getDefaultIndexDirectories();
        searchDirs = [];

        for (const dir of defaultDirs) {
          try {
            await fs.access(dir);
            if (!indexer.isIndexed(dir)) {
              await indexer.indexDirectory(dir);
            }
            searchDirs.push(dir);
          } catch {
            // Directory doesn't exist, skip
          }
        }
      }

      // Calculate modified timestamp filter
      let modifiedAfter: number | undefined;
      if (modifiedWithinDays !== undefined) {
        modifiedAfter = Date.now() - modifiedWithinDays * 24 * 60 * 60 * 1000;
      }

      // Search the index
      const indexResults = indexer.searchIndex(query, {
        maxResults: fuzzyMatch ? maxResults * 3 : maxResults, // Get more for fuzzy scoring
        directories: searchDirs,
        extensions,
        includeDirectories,
        minSize,
        maxSize,
        modifiedAfter,
      });

      // Convert to search results with scoring
      let results: FileSearchResult[] = indexResults.map((f) =>
        toSearchResult(f, query)
      );

      // Filter by minimum score if fuzzy matching
      if (fuzzyMatch) {
        results = results.filter((r) => r.score > 0);
      } else {
        // Strict matching - only exact and contains
        results = results.filter(
          (r) => r.matchType === 'exact' || r.matchType === 'contains'
        );
      }

      // Sort by score (descending)
      results.sort((a, b) => b.score - a.score);

      // Limit results
      results = results.slice(0, maxResults);

      logger.debug('File search completed', {
        query,
        resultsCount: results.length,
        directories: searchDirs.length,
      });

      return {
        success: true,
        data: {
          query,
          results,
          totalResults: results.length,
          searchedDirectories: searchDirs,
        },
      };
    } catch (error) {
      const err = error as Error;
      logger.error('File search failed', { error: err.message });
      return { success: false, error: err.message };
    }
  },
};

/**
 * Content search tool
 *
 * Searches for text content within files, returning matching lines with context.
 */
export const contentSearchTool: AgentTool = {
  name: 'content_search',
  description:
    'Search for text content within files. Returns matching lines with context. ' +
    'Use this for voice commands like "Search for X in files" or "Find files containing X".',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Text to search for within files',
      },
      directory: {
        type: 'string',
        description: 'Directory to search in (default: current directory)',
      },
      extensions: {
        type: 'array',
        description: 'Only search files with these extensions (e.g., ["ts", "js"])',
        items: { type: 'string' },
      },
      caseSensitive: {
        type: 'boolean',
        description: 'Case-sensitive search (default: false)',
      },
      maxResults: {
        type: 'number',
        description: 'Maximum number of matching files (default: 20)',
      },
      contextLines: {
        type: 'number',
        description: 'Number of context lines before/after match (default: 2)',
      },
      regex: {
        type: 'boolean',
        description: 'Treat query as a regular expression (default: false)',
      },
    },
    required: ['query', 'directory'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const query = params.query as string;
      const directory = path.resolve((params.directory as string) || '.');
      const extensions = params.extensions as string[] | undefined;
      const caseSensitive = params.caseSensitive === true;
      const maxResults = Math.min(
        (params.maxResults as number) || 20,
        MAX_CONTENT_RESULTS
      );
      const contextLines = Math.min(
        (params.contextLines as number) || 2,
        MAX_CONTEXT_LINES
      );
      const useRegex = params.regex === true;

      if (!query || query.trim().length === 0) {
        return { success: false, error: 'Query is required' };
      }

      // Build the pattern
      let pattern: RegExp;
      try {
        if (useRegex) {
          pattern = new RegExp(query, caseSensitive ? 'g' : 'gi');
        } else {
          // Escape special regex characters for literal search
          const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          pattern = new RegExp(escaped, caseSensitive ? 'g' : 'gi');
        }
      } catch (regexError) {
        return { success: false, error: `Invalid regex pattern: ${(regexError as Error).message}` };
      }

      // Get files to search using fast-glob
      const fg = await import('fast-glob');

      // Build glob pattern
      let globPattern = '**/*';
      if (extensions && extensions.length > 0) {
        if (extensions.length === 1) {
          globPattern = `**/*.${extensions[0]}`;
        } else {
          globPattern = `**/*.{${extensions.join(',')}}`;
        }
      }

      const files = await fg.default([globPattern], {
        cwd: directory,
        absolute: true,
        onlyFiles: true,
        followSymbolicLinks: false,
        ignore: [
          '**/node_modules/**',
          '**/.git/**',
          '**/dist/**',
          '**/build/**',
          '**/*.min.js',
          '**/*.bundle.js',
        ],
        suppressErrors: true,
      });

      const results: ContentSearchResult[] = [];
      let filesSearched = 0;
      let filesWithMatches = 0;

      for (const filePath of files) {
        if (filesWithMatches >= maxResults) break;

        try {
          // Check file size
          const stat = await fs.stat(filePath);
          if (stat.size > MAX_FILE_SIZE_FOR_CONTENT_SEARCH) {
            continue;
          }

          // Read file content
          const content = await fs.readFile(filePath, 'utf-8');
          const lines = content.split('\n');

          filesSearched++;
          let fileHasMatch = false;

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            pattern.lastIndex = 0; // Reset regex state

            const match = pattern.exec(line);
            if (match) {
              if (!fileHasMatch) {
                fileHasMatch = true;
                filesWithMatches++;
              }

              // Get context lines
              const contextBefore: string[] = [];
              const contextAfter: string[] = [];

              for (let j = Math.max(0, i - contextLines); j < i; j++) {
                contextBefore.push(lines[j]);
              }

              for (let j = i + 1; j <= Math.min(lines.length - 1, i + contextLines); j++) {
                contextAfter.push(lines[j]);
              }

              results.push({
                path: filePath,
                name: path.basename(filePath),
                lineNumber: i + 1,
                matchingLine: line.slice(0, CONTENT_SNIPPET_LENGTH),
                contextBefore,
                contextAfter,
                column: match.index + 1,
              });

              // Limit results per file
              if (results.filter((r) => r.path === filePath).length >= 5) {
                break;
              }
            }
          }
        } catch {
          // Skip files we can't read (binary, permission denied, etc.)
          continue;
        }
      }

      logger.debug('Content search completed', {
        query,
        filesSearched,
        filesWithMatches,
        totalMatches: results.length,
      });

      return {
        success: true,
        data: {
          query,
          results,
          filesSearched,
          filesWithMatches,
          directory,
        },
      };
    } catch (error) {
      const err = error as Error;
      logger.error('Content search failed', { error: err.message });
      return { success: false, error: err.message };
    }
  },
};

/**
 * Recent files search tool
 *
 * Find recently modified files across indexed directories.
 */
export const recentFilesTool: AgentTool = {
  name: 'recent_files',
  description:
    'Find recently modified files. Use this for voice commands like ' +
    '"Show me recent files" or "What files did I change today?".',
  parameters: {
    type: 'object',
    properties: {
      directory: {
        type: 'string',
        description: 'Directory to search in (default: common directories)',
      },
      days: {
        type: 'number',
        description: 'Files modified within this many days (default: 7)',
      },
      extensions: {
        type: 'array',
        description: 'Filter by file extensions',
        items: { type: 'string' },
      },
      maxResults: {
        type: 'number',
        description: 'Maximum number of results (default: 30)',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const directory = params.directory as string | undefined;
      const days = (params.days as number) || 7;
      const extensions = params.extensions as string[] | undefined;
      const maxResults = Math.min((params.maxResults as number) || 30, MAX_SEARCH_RESULTS);

      const indexer = FileIndexer.getInstance();

      // Ensure directories are indexed
      let searchDirs: string[];
      if (directory) {
        const resolvedDir = path.resolve(directory);
        if (!indexer.isIndexed(resolvedDir)) {
          await indexer.indexDirectory(resolvedDir);
        }
        searchDirs = [resolvedDir];
      } else {
        await indexer.indexDefaultDirectories();
        searchDirs = getDefaultIndexDirectories();
      }

      // Get all indexed files
      const allFiles = indexer.getAllIndexedFiles();
      const cutoffTime = Date.now() - days * 24 * 60 * 60 * 1000;

      // Filter recent files
      let recentFiles = allFiles
        .filter((f) => !f.isDirectory)
        .filter((f) => f.modified >= cutoffTime)
        .filter((f) => {
          if (!extensions || extensions.length === 0) return true;
          return extensions.includes(f.extension);
        });

      // Sort by modification time (newest first)
      recentFiles.sort((a, b) => b.modified - a.modified);

      // Limit results
      recentFiles = recentFiles.slice(0, maxResults);

      // Convert to FileInfo format
      const results: FileInfo[] = recentFiles.map((f) => ({
        path: f.path,
        name: f.name,
        isDirectory: f.isDirectory,
        size: f.size,
        modified: new Date(f.modified).toISOString(),
        created: new Date(f.modified).toISOString(), // We don't track created time
        extension: f.extension,
      }));

      logger.debug('Recent files search completed', {
        days,
        resultsCount: results.length,
      });

      return {
        success: true,
        data: {
          results,
          days,
          totalResults: results.length,
          searchedDirectories: searchDirs,
        },
      };
    } catch (error) {
      const err = error as Error;
      logger.error('Recent files search failed', { error: err.message });
      return { success: false, error: err.message };
    }
  },
};

/**
 * Open file tool
 *
 * Opens a file with the system default application.
 */
export const openFileTool: AgentTool = {
  name: 'open_file',
  description:
    'Open a file with the system default application. ' +
    'Use this to open search results directly.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to the file to open',
      },
    },
    required: ['path'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const filePath = path.resolve(params.path as string);

      // Check file exists
      try {
        await fs.access(filePath);
      } catch {
        return { success: false, error: 'File not found' };
      }

      // Open with system default application
      const result = await shell.openPath(filePath);

      if (result) {
        // shell.openPath returns an error string on failure
        return { success: false, error: result };
      }

      logger.info('File opened', { path: filePath });

      return {
        success: true,
        data: { path: filePath, opened: true },
      };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to open file', { error: err.message });
      return { success: false, error: err.message };
    }
  },
};

/**
 * Reveal file in folder tool
 *
 * Shows a file in the system file explorer.
 */
export const revealFileTool: AgentTool = {
  name: 'reveal_file',
  description:
    'Show a file in the system file explorer (Finder/Explorer). ' +
    'Use this to navigate to search results in the file system.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to the file or folder to reveal',
      },
    },
    required: ['path'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const filePath = path.resolve(params.path as string);

      // Check path exists
      try {
        await fs.access(filePath);
      } catch {
        return { success: false, error: 'File or folder not found' };
      }

      // Show in explorer/finder
      shell.showItemInFolder(filePath);

      logger.info('File revealed', { path: filePath });

      return {
        success: true,
        data: { path: filePath, revealed: true },
      };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to reveal file', { error: err.message });
      return { success: false, error: err.message };
    }
  },
};

/**
 * Index directory tool
 *
 * Manually index a directory for faster future searches.
 */
export const indexDirectoryTool: AgentTool = {
  name: 'index_directory',
  description:
    'Index a directory for faster future file searches. ' +
    'Use this to add new directories to the search index.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Directory path to index',
      },
      force: {
        type: 'boolean',
        description: 'Force re-index even if already cached (default: false)',
      },
    },
    required: ['path'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const dirPath = path.resolve(params.path as string);
      const force = params.force === true;

      const indexer = FileIndexer.getInstance();
      const stats = await indexer.indexDirectory(dirPath, force);

      return {
        success: true,
        data: {
          directory: stats.directory,
          filesIndexed: stats.fileCount,
          directoriesIndexed: stats.directoryCount,
          totalSize: stats.totalSize,
          duration: stats.indexDuration,
        },
      };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to index directory', { error: err.message });
      return { success: false, error: err.message };
    }
  },
};

/**
 * Get all file search tools
 */
export function getFileSearchTools(): AgentTool[] {
  return [
    fileSearchTool,
    contentSearchTool,
    recentFilesTool,
    openFileTool,
    revealFileTool,
    indexDirectoryTool,
  ];
}

export default {
  fileSearchTool,
  contentSearchTool,
  recentFilesTool,
  openFileTool,
  revealFileTool,
  indexDirectoryTool,
  getFileSearchTools,
};
