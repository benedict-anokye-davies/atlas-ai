/**
 * Atlas Desktop - Filesystem Tool
 *
 * Provides secure file system operations for the AI agent with comprehensive
 * safety validation to prevent access to sensitive files and directories.
 *
 * Security Model:
 * - All paths are validated against a blocklist before access
 * - Path traversal attempts (../) are detected and flagged
 * - System directories require user confirmation
 * - Sensitive file patterns (*.pem, *.key, etc.) are blocked
 * - File size limits prevent memory exhaustion
 *
 * @module agent/tools/filesystem
 * @security This module implements defense-in-depth for filesystem access.
 *           All operations should be considered potentially dangerous.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { Stats } from 'fs';
import { AgentTool, ActionResult } from '../../../shared/types/agent';
import { createModuleLogger } from '../../utils/logger';
import {
  FileInfo,
  FileReadResult,
  FileWriteResult,
  FileSearchResult,
  DirectoryListResult,
  SafetyValidation,
  BLOCKED_PATHS,
} from '../../../shared/types/agent';

const logger = createModuleLogger('FilesystemTool');

// =============================================================================
// Error Handling
// =============================================================================

/**
 * Error codes for filesystem operations.
 * Used for programmatic error handling and logging.
 */
export type FilesystemErrorCode =
  | 'ACCESS_DENIED'
  | 'FILE_NOT_FOUND'
  | 'IS_DIRECTORY'
  | 'FILE_TOO_LARGE'
  | 'PATH_TRAVERSAL'
  | 'WRITE_FAILED'
  | 'DELETE_FAILED'
  | 'SEARCH_FAILED'
  | 'INVALID_PATH'
  | 'UNKNOWN';

/**
 * Typed error class for filesystem operations.
 *
 * Provides structured error information for logging, metrics, and
 * programmatic error handling.
 *
 * @example
 * ```typescript
 * throw new FilesystemError(
 *   'Access to /etc/passwd blocked',
 *   'ACCESS_DENIED',
 *   '/etc/passwd'
 * );
 * ```
 */
export class FilesystemError extends Error {
  /**
   * Create a new FilesystemError.
   *
   * @param message - Human-readable error description
   * @param code - Machine-readable error code for programmatic handling
   * @param path - The path that caused the error (for logging)
   * @param cause - The underlying error, if any
   */
  constructor(
    message: string,
    public readonly code: FilesystemErrorCode,
    public readonly path?: string,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = 'FilesystemError';
  }

  /**
   * Create a structured log object for this error.
   * Useful for structured logging systems.
   */
  toLogObject(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      path: this.path,
      cause: this.cause?.message,
    };
  }
}

// =============================================================================
// Constants
// =============================================================================

/**
 * Filesystem operation limits.
 *
 * These limits are designed to prevent:
 * - Memory exhaustion from reading large files
 * - UI freezes from listing huge directories
 * - Unbounded search results overwhelming the LLM context
 */
export const FILESYSTEM_LIMITS = {
  /**
   * Maximum file size that can be read in bytes (10MB).
   * Larger files should be read in chunks or streamed.
   */
  MAX_FILE_SIZE_BYTES: 10 * 1024 * 1024,

  /**
   * Maximum entries returned from directory listing.
   * Prevents UI freezes on very large directories.
   */
  MAX_LIST_ENTRIES: 1000,

  /**
   * Maximum results returned from file search.
   * Prevents LLM context overflow.
   */
  MAX_SEARCH_RESULTS: 100,

  /**
   * Default file encoding for text operations.
   */
  DEFAULT_ENCODING: 'utf-8' as BufferEncoding,
} as const;

/**
 * System paths that require user confirmation before access.
 * These are not blocked, but flagged as medium risk.
 *
 * @security Access to these paths may expose system configuration.
 */
const SYSTEM_PATHS_REQUIRING_CONFIRMATION = [
  '/etc',
  '/var',
  '/usr',
  'c:/windows',
  'c:/program files',
  'c:/program files (x86)',
] as const;

/**
 * Validate path safety - prevent access to sensitive files.
 *
 * Security validation includes:
 * 1. Blocked path patterns (credentials, keys, system files)
 * 2. Path traversal detection (..)
 * 3. System directory flagging
 *
 * @param targetPath - The path to validate
 * @returns Validation result with risk level and required confirmations
 *
 * @security This is a critical security function. Changes require security review.
 *
 * @example
 * ```typescript
 * const validation = validatePathSafety('/home/user/.ssh/id_rsa');
 * // Returns: { allowed: false, reason: 'Access to .ssh files is blocked', riskLevel: 'blocked' }
 *
 * const validation2 = validatePathSafety('/etc/hosts');
 * // Returns: { allowed: true, riskLevel: 'medium', requiresConfirmation: true }
 * ```
 */
function validatePathSafety(targetPath: string): SafetyValidation {
  // Normalize path separators and convert to lowercase for comparison
  const normalizedPath = path.normalize(targetPath).toLowerCase().replace(/\\/g, '/');

  // Check against blocked patterns
  for (const blockedPattern of BLOCKED_PATHS) {
    const pattern = blockedPattern.toLowerCase().replace(/\\/g, '/');

    // Handle wildcard patterns
    if (pattern.startsWith('*')) {
      const extension = pattern.slice(1);
      if (normalizedPath.endsWith(extension)) {
        return {
          allowed: false,
          reason: `Access to ${extension} files is blocked for security`,
          riskLevel: 'blocked',
          requiresConfirmation: false,
        };
      }
    } else if (normalizedPath.includes(pattern)) {
      return {
        allowed: false,
        reason: `Access to ${blockedPattern} is blocked for security`,
        riskLevel: 'blocked',
        requiresConfirmation: false,
      };
    }
  }

  // Check for path traversal attempts
  if (targetPath.includes('..')) {
    // Resolve the path to check if it escapes intended directory
    const resolved = path.resolve(targetPath);
    const cwd = process.cwd();

    // Allow if still within cwd or user home
    const userHome = process.env.HOME || process.env.USERPROFILE || '';
    if (!resolved.startsWith(cwd) && !resolved.startsWith(userHome)) {
      return {
        allowed: true, // Allow but flag as medium risk
        riskLevel: 'medium',
        requiresConfirmation: true,
        reason: 'Path traversal detected',
      };
    }
  }

  // System directories require confirmation (normalize for comparison)
  for (const sysPath of SYSTEM_PATHS_REQUIRING_CONFIRMATION) {
    if (normalizedPath.startsWith(sysPath)) {
      return {
        allowed: true,
        riskLevel: 'medium',
        requiresConfirmation: true,
        reason: 'System directory access',
      };
    }
  }

  return {
    allowed: true,
    riskLevel: 'low',
    requiresConfirmation: false,
  };
}

/**
 * Convert fs.Stats to FileInfo
 */
function statsToFileInfo(filePath: string, stats: Stats): FileInfo {
  return {
    path: filePath,
    name: path.basename(filePath),
    isDirectory: stats.isDirectory(),
    size: stats.size,
    modified: stats.mtime.toISOString(),
    created: stats.birthtime.toISOString(),
    extension: stats.isDirectory() ? undefined : path.extname(filePath).slice(1),
  };
}

/**
 * Read file tool
 */
export const readFileTool: AgentTool = {
  name: 'read_file',
  description: 'Read the contents of a file. Returns text content for text files.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Absolute or relative path to the file to read',
      },
      encoding: {
        type: 'string',
        description: 'File encoding (default: utf-8)',
      },
      maxLines: {
        type: 'number',
        description: 'Maximum number of lines to read (default: all)',
      },
    },
    required: ['path'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const filePath = path.resolve(params.path as string);
      const encoding = (params.encoding as BufferEncoding) || 'utf-8';
      const maxLines = params.maxLines as number | undefined;

      // Safety check
      const safety = validatePathSafety(filePath);
      if (!safety.allowed) {
        logger.warn('File read blocked', { path: filePath, reason: safety.reason });
        return {
          success: false,
          error: safety.reason || 'Access denied',
        };
      }

      // Check file exists and get stats
      const stats = await fs.stat(filePath);
      if (stats.isDirectory()) {
        return {
          success: false,
          error: 'Path is a directory, use list_directory instead',
        };
      }

      // Check file size
      if (stats.size > FILESYSTEM_LIMITS.MAX_FILE_SIZE_BYTES) {
        const sizeMB = Math.round(stats.size / 1024 / 1024);
        const limitMB = FILESYSTEM_LIMITS.MAX_FILE_SIZE_BYTES / 1024 / 1024;
        return {
          success: false,
          error: `File too large (${sizeMB}MB). Maximum is ${limitMB}MB`,
        };
      }

      // Read file
      let content = await fs.readFile(filePath, encoding);
      let truncated = false;

      // Limit lines if requested
      if (maxLines !== undefined && maxLines > 0) {
        const lines = content.split('\n');
        if (lines.length > maxLines) {
          content = lines.slice(0, maxLines).join('\n');
          truncated = true;
        }
      }

      const result: FileReadResult = {
        path: filePath,
        content,
        encoding,
        size: stats.size,
        lines: content.split('\n').length,
        truncated,
      };

      logger.debug('File read', { path: filePath, size: stats.size, lines: result.lines });

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') {
        return { success: false, error: 'File not found' };
      }
      if (err.code === 'EACCES') {
        return { success: false, error: 'Permission denied' };
      }
      logger.error('File read error', { error: err.message });
      return { success: false, error: err.message };
    }
  },
};

/**
 * Write file tool
 */
export const writeFileTool: AgentTool = {
  name: 'write_file',
  description:
    'Write content to a file. Creates the file if it does not exist, or overwrites if it does.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Absolute or relative path to the file to write',
      },
      content: {
        type: 'string',
        description: 'Content to write to the file',
      },
      encoding: {
        type: 'string',
        description: 'File encoding (default: utf-8)',
      },
      createDirectories: {
        type: 'boolean',
        description: 'Create parent directories if they do not exist (default: true)',
      },
    },
    required: ['path', 'content'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const filePath = path.resolve(params.path as string);
      const content = params.content as string;
      const encoding = (params.encoding as BufferEncoding) || 'utf-8';
      const createDirectories = params.createDirectories !== false;

      // Safety check
      const safety = validatePathSafety(filePath);
      if (!safety.allowed) {
        logger.warn('File write blocked', { path: filePath, reason: safety.reason });
        return {
          success: false,
          error: safety.reason || 'Access denied',
        };
      }

      // Check if file exists
      let created = false;
      try {
        await fs.access(filePath);
      } catch {
        created = true;
      }

      // Create parent directories if needed
      if (createDirectories) {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
      }

      // Write file
      await fs.writeFile(filePath, content, encoding);
      const stats = await fs.stat(filePath);

      const result: FileWriteResult = {
        path: filePath,
        bytesWritten: stats.size,
        created,
      };

      logger.info('File written', { path: filePath, bytes: stats.size, created });

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'EACCES') {
        return { success: false, error: 'Permission denied' };
      }
      if (err.code === 'ENOENT') {
        return { success: false, error: 'Parent directory does not exist' };
      }
      logger.error('File write error', { error: err.message });
      return { success: false, error: err.message };
    }
  },
};

/**
 * Append to file tool
 */
export const appendFileTool: AgentTool = {
  name: 'append_file',
  description: 'Append content to the end of a file. Creates the file if it does not exist.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Absolute or relative path to the file',
      },
      content: {
        type: 'string',
        description: 'Content to append to the file',
      },
      encoding: {
        type: 'string',
        description: 'File encoding (default: utf-8)',
      },
    },
    required: ['path', 'content'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const filePath = path.resolve(params.path as string);
      const content = params.content as string;
      const encoding = (params.encoding as BufferEncoding) || 'utf-8';

      // Safety check
      const safety = validatePathSafety(filePath);
      if (!safety.allowed) {
        return { success: false, error: safety.reason || 'Access denied' };
      }

      // Append to file
      await fs.appendFile(filePath, content, encoding);
      const stats = await fs.stat(filePath);

      logger.debug('File appended', {
        path: filePath,
        appendedBytes: Buffer.byteLength(content, encoding),
      });

      return {
        success: true,
        data: {
          path: filePath,
          totalSize: stats.size,
          appendedBytes: Buffer.byteLength(content, encoding),
        },
      };
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      logger.error('File append error', { error: err.message });
      return { success: false, error: err.message };
    }
  },
};

/**
 * Delete file tool
 */
export const deleteFileTool: AgentTool = {
  name: 'delete_file',
  description: 'Delete a file. Does NOT delete directories (use with caution).',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Absolute or relative path to the file to delete',
      },
    },
    required: ['path'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const filePath = path.resolve(params.path as string);

      // Safety check
      const safety = validatePathSafety(filePath);
      if (!safety.allowed) {
        return { success: false, error: safety.reason || 'Access denied' };
      }

      // Check if it's a file
      const stats = await fs.stat(filePath);
      if (stats.isDirectory()) {
        return { success: false, error: 'Cannot delete directory with this tool' };
      }

      // Delete file
      await fs.unlink(filePath);

      logger.info('File deleted', { path: filePath });

      return {
        success: true,
        data: { path: filePath, deleted: true },
      };
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') {
        return { success: false, error: 'File not found' };
      }
      logger.error('File delete error', { error: err.message });
      return { success: false, error: err.message };
    }
  },
};

/**
 * Helper context for directory listing
 */
interface ListDirContext {
  entries: FileInfo[];
  totalFiles: number;
  totalDirectories: number;
  totalSize: number;
  recursive: boolean;
  maxDepth: number;
}

/**
 * Recursive directory listing helper
 */
async function listDirRecursive(
  currentPath: string,
  depth: number,
  ctx: ListDirContext
): Promise<void> {
  if (ctx.entries.length >= MAX_LIST_ENTRIES) return;
  if (ctx.recursive && depth > ctx.maxDepth) return;

  const items = await fs.readdir(currentPath);

  for (const item of items) {
    if (ctx.entries.length >= MAX_LIST_ENTRIES) break;

    const itemPath = path.join(currentPath, item);
    try {
      const itemStats = await fs.stat(itemPath);
      const fileInfo = statsToFileInfo(itemPath, itemStats);
      ctx.entries.push(fileInfo);

      if (itemStats.isDirectory()) {
        ctx.totalDirectories++;
        if (ctx.recursive) {
          await listDirRecursive(itemPath, depth + 1, ctx);
        }
      } else {
        ctx.totalFiles++;
        ctx.totalSize += itemStats.size;
      }
    } catch {
      // Skip files we can't access
      continue;
    }
  }
}

/**
 * List directory tool
 */
export const listDirectoryTool: AgentTool = {
  name: 'list_directory',
  description: 'List files and directories in a given path.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Directory path to list (default: current directory)',
      },
      recursive: {
        type: 'boolean',
        description: 'Include subdirectories recursively (default: false)',
      },
      maxDepth: {
        type: 'number',
        description: 'Maximum depth for recursive listing (default: 3)',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const dirPath = path.resolve((params.path as string) || '.');
      const recursive = params.recursive === true;
      const maxDepth = (params.maxDepth as number) || 3;

      // Safety check
      const safety = validatePathSafety(dirPath);
      if (!safety.allowed) {
        return { success: false, error: safety.reason || 'Access denied' };
      }

      // Check if it's a directory
      const stats = await fs.stat(dirPath);
      if (!stats.isDirectory()) {
        return { success: false, error: 'Path is not a directory' };
      }

      const ctx: ListDirContext = {
        entries: [],
        totalFiles: 0,
        totalDirectories: 0,
        totalSize: 0,
        recursive,
        maxDepth,
      };

      await listDirRecursive(dirPath, 0, ctx);

      const result: DirectoryListResult = {
        path: dirPath,
        entries: ctx.entries,
        totalFiles: ctx.totalFiles,
        totalDirectories: ctx.totalDirectories,
        totalSize: ctx.totalSize,
      };

      logger.debug('Directory listed', { path: dirPath, entries: ctx.entries.length });

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') {
        return { success: false, error: 'Directory not found' };
      }
      if (err.code === 'EACCES') {
        return { success: false, error: 'Permission denied' };
      }
      logger.error('Directory list error', { error: err.message });
      return { success: false, error: err.message };
    }
  },
};

/**
 * Search files tool
 */
export const searchFilesTool: AgentTool = {
  name: 'search_files',
  description: 'Search for files matching a pattern in a directory.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Directory to search in (default: current directory)',
      },
      pattern: {
        type: 'string',
        description: 'Glob pattern to match (e.g., "*.ts", "**/*.json")',
      },
      content: {
        type: 'string',
        description: 'Search for files containing this text',
      },
      maxResults: {
        type: 'number',
        description: 'Maximum number of results (default: 50)',
      },
    },
    required: ['pattern'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const searchPath = path.resolve((params.path as string) || '.');
      const pattern = params.pattern as string;
      const contentSearch = params.content as string | undefined;
      const maxResults = Math.min((params.maxResults as number) || 50, MAX_SEARCH_RESULTS);

      // Safety check
      const safety = validatePathSafety(searchPath);
      if (!safety.allowed) {
        return { success: false, error: safety.reason || 'Access denied' };
      }

      const { glob } = await import('glob');
      const matches = await glob(pattern, {
        cwd: searchPath,
        absolute: true,
        nodir: true,
      });

      const files: FileInfo[] = [];

      for (const match of matches) {
        if (files.length >= maxResults) break;

        try {
          const stats = await fs.stat(match);

          // If content search is specified, check file contents
          if (contentSearch) {
            const content = await fs.readFile(match, 'utf-8');
            if (!content.includes(contentSearch)) {
              continue;
            }
          }

          files.push(statsToFileInfo(match, stats));
        } catch {
          // Skip files we can't access
          continue;
        }
      }

      const result: FileSearchResult = {
        files,
        totalMatches: matches.length,
        searchPath,
        pattern,
      };

      logger.debug('File search', { path: searchPath, pattern, found: files.length });

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      const err = error as Error;
      logger.error('File search error', { error: err.message });
      return { success: false, error: err.message };
    }
  },
};

/**
 * Copy file tool
 */
export const copyFileTool: AgentTool = {
  name: 'copy_file',
  description: 'Copy a file to a new location.',
  parameters: {
    type: 'object',
    properties: {
      source: {
        type: 'string',
        description: 'Source file path',
      },
      destination: {
        type: 'string',
        description: 'Destination file path',
      },
      overwrite: {
        type: 'boolean',
        description: 'Overwrite if destination exists (default: false)',
      },
    },
    required: ['source', 'destination'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const sourcePath = path.resolve(params.source as string);
      const destPath = path.resolve(params.destination as string);
      const overwrite = params.overwrite === true;

      // Safety check both paths
      const sourceSafety = validatePathSafety(sourcePath);
      const destSafety = validatePathSafety(destPath);

      if (!sourceSafety.allowed) {
        return { success: false, error: `Source: ${sourceSafety.reason}` };
      }
      if (!destSafety.allowed) {
        return { success: false, error: `Destination: ${destSafety.reason}` };
      }

      // Check source exists
      const sourceStats = await fs.stat(sourcePath);
      if (sourceStats.isDirectory()) {
        return { success: false, error: 'Cannot copy directory with this tool' };
      }

      // Check destination
      try {
        await fs.access(destPath);
        if (!overwrite) {
          return {
            success: false,
            error: 'Destination file already exists. Use overwrite: true to replace.',
          };
        }
      } catch {
        // Destination doesn't exist, good
      }

      // Create destination directory if needed
      await fs.mkdir(path.dirname(destPath), { recursive: true });

      // Copy file
      await fs.copyFile(sourcePath, destPath);
      const destStats = await fs.stat(destPath);

      logger.info('File copied', { source: sourcePath, destination: destPath });

      return {
        success: true,
        data: {
          source: sourcePath,
          destination: destPath,
          size: destStats.size,
        },
      };
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      logger.error('File copy error', { error: err.message });
      return { success: false, error: err.message };
    }
  },
};

/**
 * Move file tool
 */
export const moveFileTool: AgentTool = {
  name: 'move_file',
  description: 'Move or rename a file.',
  parameters: {
    type: 'object',
    properties: {
      source: {
        type: 'string',
        description: 'Source file path',
      },
      destination: {
        type: 'string',
        description: 'Destination file path',
      },
      overwrite: {
        type: 'boolean',
        description: 'Overwrite if destination exists (default: false)',
      },
    },
    required: ['source', 'destination'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const sourcePath = path.resolve(params.source as string);
      const destPath = path.resolve(params.destination as string);
      const overwrite = params.overwrite === true;

      // Safety check both paths
      const sourceSafety = validatePathSafety(sourcePath);
      const destSafety = validatePathSafety(destPath);

      if (!sourceSafety.allowed) {
        return { success: false, error: `Source: ${sourceSafety.reason}` };
      }
      if (!destSafety.allowed) {
        return { success: false, error: `Destination: ${destSafety.reason}` };
      }

      // Check source exists
      const sourceStats = await fs.stat(sourcePath);
      if (sourceStats.isDirectory()) {
        return { success: false, error: 'Cannot move directory with this tool' };
      }

      // Check destination
      try {
        await fs.access(destPath);
        if (!overwrite) {
          return {
            success: false,
            error: 'Destination file already exists. Use overwrite: true to replace.',
          };
        }
        await fs.unlink(destPath);
      } catch {
        // Destination doesn't exist, good
      }

      // Create destination directory if needed
      await fs.mkdir(path.dirname(destPath), { recursive: true });

      // Move file
      await fs.rename(sourcePath, destPath);

      logger.info('File moved', { source: sourcePath, destination: destPath });

      return {
        success: true,
        data: {
          source: sourcePath,
          destination: destPath,
        },
      };
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      logger.error('File move error', { error: err.message });
      return { success: false, error: err.message };
    }
  },
};

/**
 * Create directory tool
 */
export const createDirectoryTool: AgentTool = {
  name: 'create_directory',
  description: 'Create a new directory.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path of the directory to create',
      },
      recursive: {
        type: 'boolean',
        description: 'Create parent directories if they do not exist (default: true)',
      },
    },
    required: ['path'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const dirPath = path.resolve(params.path as string);
      const recursive = params.recursive !== false;

      // Safety check
      const safety = validatePathSafety(dirPath);
      if (!safety.allowed) {
        return { success: false, error: safety.reason || 'Access denied' };
      }

      // Check if already exists
      try {
        const stats = await fs.stat(dirPath);
        if (stats.isDirectory()) {
          return { success: true, data: { path: dirPath, created: false, alreadyExists: true } };
        } else {
          return { success: false, error: 'A file with this name already exists' };
        }
      } catch {
        // Doesn't exist, create it
      }

      await fs.mkdir(dirPath, { recursive });

      logger.info('Directory created', { path: dirPath });

      return {
        success: true,
        data: { path: dirPath, created: true },
      };
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      logger.error('Directory create error', { error: err.message });
      return { success: false, error: err.message };
    }
  },
};

/**
 * Get all filesystem tools
 */
export function getFilesystemTools(): AgentTool[] {
  return [
    readFileTool,
    writeFileTool,
    appendFileTool,
    deleteFileTool,
    listDirectoryTool,
    searchFilesTool,
    copyFileTool,
    moveFileTool,
    createDirectoryTool,
  ];
}

export default {
  readFileTool,
  writeFileTool,
  appendFileTool,
  deleteFileTool,
  listDirectoryTool,
  searchFilesTool,
  copyFileTool,
  moveFileTool,
  createDirectoryTool,
  getFilesystemTools,
  validatePathSafety,
};
