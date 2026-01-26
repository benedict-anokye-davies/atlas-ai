/**
 * Atlas Desktop - File Guard
 * Secure file access control with permission management
 *
 * Features:
 * - Directory whitelisting with granular permissions
 * - User consent prompts for new directory access
 * - Path traversal attack prevention
 * - Sensitive path blocking
 * - File operation audit logging
 * - Operation timeouts
 *
 * @module security/file-guard
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync } from 'fs';
import { homedir, tmpdir, platform } from 'os';
import { app, dialog, BrowserWindow } from 'electron';
import { createModuleLogger } from '../utils/logger';
import { getAuditLogger, AuditLogger } from './audit-logger';
import { AtlasError } from '../utils/errors';
import {
  FileAccessPermission,
  FileGuardConfig,
  FileAccessResult,
  DirectoryPermission,
  FileOperationType,
  PathValidationResult,
  DEFAULT_FILE_GUARD_CONFIG,
  SYSTEM_BLOCKED_PATHS,
  SENSITIVE_FILE_PATTERNS,
} from '../../shared/types/security';

const logger = createModuleLogger('FileGuard');

/**
 * File Guard Error
 */
export class FileGuardError extends AtlasError {
  constructor(
    message: string,
    public operation: FileOperationType,
    public targetPath: string,
    context?: Record<string, unknown>
  ) {
    super(message, 'FILE_GUARD_ERROR', true, {
      operation,
      targetPath,
      ...context,
    });
    this.name = 'FileGuardError';
  }
}

/**
 * File Guard - Secure file access controller
 */
export class FileGuard {
  private config: FileGuardConfig;
  private auditLogger: AuditLogger;
  private whitelistedDirs: Map<string, DirectoryPermission> = new Map();
  private pendingPrompts: Map<string, Promise<boolean>> = new Map();
  private sessionId: string;

  constructor(config?: Partial<FileGuardConfig>) {
    this.config = { ...DEFAULT_FILE_GUARD_CONFIG, ...config };
    this.auditLogger = getAuditLogger();
    this.sessionId = config?.sessionId ?? 'default';

    // Initialize default whitelisted directories
    this.initializeDefaultWhitelist();

    logger.info('FileGuard initialized', {
      enablePrompts: this.config.enableUserPrompts,
      defaultDirs: this.whitelistedDirs.size,
    });
  }

  /**
   * Initialize default safe directories
   */
  private initializeDefaultWhitelist(): void {
    const home = homedir();
    const temp = tmpdir();
    const userDataPath = app?.getPath?.('userData') ?? path.join(home, '.atlas');

    // User home subdirectories (read-only by default)
    const readOnlyDirs = [
      path.join(home, 'Documents'),
      path.join(home, 'Downloads'),
      path.join(home, 'Desktop'),
      path.join(home, 'Pictures'),
      path.join(home, 'Music'),
      path.join(home, 'Videos'),
    ];

    for (const dir of readOnlyDirs) {
      this.whitelistedDirs.set(this.normalizePath(dir), {
        path: dir,
        permissions: ['read', 'list'],
        grantedAt: Date.now(),
        grantedBy: 'system',
        expiresAt: undefined, // Never expires
      });
    }

    // Atlas data directory (full access)
    this.whitelistedDirs.set(this.normalizePath(userDataPath), {
      path: userDataPath,
      permissions: ['read', 'write', 'create', 'delete', 'list'],
      grantedAt: Date.now(),
      grantedBy: 'system',
    });

    // Temp directory (full access)
    this.whitelistedDirs.set(this.normalizePath(temp), {
      path: temp,
      permissions: ['read', 'write', 'create', 'delete', 'list'],
      grantedAt: Date.now(),
      grantedBy: 'system',
    });

    // Current working directory (read-only)
    const cwd = process.cwd();
    this.whitelistedDirs.set(this.normalizePath(cwd), {
      path: cwd,
      permissions: ['read', 'list'],
      grantedAt: Date.now(),
      grantedBy: 'system',
    });
  }

  /**
   * Normalize a path for consistent comparison
   */
  private normalizePath(targetPath: string): string {
    let normalized = path.resolve(targetPath);

    // Handle Windows case-insensitivity
    if (platform() === 'win32') {
      normalized = normalized.toLowerCase();
    }

    // Remove trailing slash
    if (normalized.endsWith(path.sep) && normalized !== path.sep) {
      normalized = normalized.slice(0, -1);
    }

    return normalized;
  }

  /**
   * Validate a path for security issues
   */
  validatePath(targetPath: string): PathValidationResult {
    const issues: string[] = [];
    const normalizedPath = this.normalizePath(targetPath);

    // Check for path traversal attempts
    if (targetPath.includes('..')) {
      issues.push('Path contains traversal sequence (..)');
    }

    // Check for null bytes (poison null byte attack)
    if (targetPath.includes('\0')) {
      issues.push('Path contains null byte');
    }

    // Check for encoded traversal sequences
    const encodedPatterns = [
      '%2e%2e', // ..
      '%252e%252e', // double-encoded ..
      '..%2f', // ../
      '..%5c', // ..\
      '%c0%ae', // overlong UTF-8 encoding of .
      '%c1%9c', // overlong UTF-8 encoding of \
    ];

    const lowerPath = targetPath.toLowerCase();
    for (const pattern of encodedPatterns) {
      if (lowerPath.includes(pattern)) {
        issues.push(`Path contains encoded traversal sequence: ${pattern}`);
      }
    }

    // Check against system blocked paths
    for (const blockedPath of SYSTEM_BLOCKED_PATHS) {
      if (typeof blockedPath === 'string') {
        const normalizedBlocked = this.normalizePath(blockedPath);
        if (
          normalizedPath === normalizedBlocked ||
          normalizedPath.startsWith(normalizedBlocked + path.sep)
        ) {
          issues.push(`Path matches blocked system path: ${blockedPath}`);
        }
      } else if (blockedPath instanceof RegExp) {
        if (blockedPath.test(targetPath) || blockedPath.test(normalizedPath)) {
          issues.push(`Path matches blocked pattern: ${blockedPath.source}`);
        }
      }
    }

    // Check against sensitive file patterns
    for (const pattern of SENSITIVE_FILE_PATTERNS) {
      if (pattern.test(targetPath) || pattern.test(path.basename(targetPath))) {
        issues.push(`Path matches sensitive file pattern: ${pattern.source}`);
      }
    }

    // Check for overly long paths (potential DoS)
    if (targetPath.length > this.config.maxPathLength) {
      issues.push(`Path exceeds maximum length of ${this.config.maxPathLength}`);
    }

    // Check for unusual characters
    // eslint-disable-next-line no-control-regex
    const unusualChars = /[\x00-\x1f\x7f<>:"|?*]/;
    if (unusualChars.test(targetPath)) {
      issues.push('Path contains unusual or control characters');
    }

    return {
      valid: issues.length === 0,
      normalizedPath,
      issues,
      isBlocked: issues.some(
        (i) => i.includes('blocked') || i.includes('traversal') || i.includes('null')
      ),
    };
  }

  /**
   * Check if a directory is whitelisted for an operation
   */
  private isWhitelisted(targetPath: string, operation: FileOperationType): boolean {
    const normalizedTarget = this.normalizePath(targetPath);

    for (const [normalizedDir, permission] of this.whitelistedDirs) {
      // Check if path is within whitelisted directory
      if (
        normalizedTarget === normalizedDir ||
        normalizedTarget.startsWith(normalizedDir + path.sep)
      ) {
        // Check if permission includes operation
        if (permission.permissions.includes(operation)) {
          // Check expiration
          if (permission.expiresAt && Date.now() > permission.expiresAt) {
            this.whitelistedDirs.delete(normalizedDir);
            continue;
          }
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Get the parent directory that would need to be whitelisted
   */
  private getParentToWhitelist(targetPath: string): string {
    const normalizedTarget = this.normalizePath(targetPath);

    // Try to find the most specific parent that exists
    let current = normalizedTarget;
    while (current !== path.dirname(current)) {
      if (existsSync(current)) {
        // Check if it's a directory
        try {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const _stat = fs.stat(current);
          return current;
        } catch {
          // Continue up
        }
      }
      current = path.dirname(current);
    }

    return path.dirname(normalizedTarget);
  }

  /**
   * Prompt user for directory access
   */
  private async promptForAccess(
    targetPath: string,
    operation: FileOperationType,
    reason?: string
  ): Promise<boolean> {
    if (!this.config.enableUserPrompts) {
      return false;
    }

    const parentDir = this.getParentToWhitelist(targetPath);
    const promptKey = `${parentDir}:${operation}`;

    // Check if we're already prompting for this directory
    const existingPrompt = this.pendingPrompts.get(promptKey);
    if (existingPrompt) {
      return existingPrompt;
    }

    const promptPromise = this.showAccessPrompt(parentDir, operation, targetPath, reason);
    this.pendingPrompts.set(promptKey, promptPromise);

    try {
      const result = await promptPromise;
      return result;
    } finally {
      this.pendingPrompts.delete(promptKey);
    }
  }

  /**
   * Show the access prompt dialog
   */
  private async showAccessPrompt(
    directory: string,
    operation: FileOperationType,
    targetPath: string,
    reason?: string
  ): Promise<boolean> {
    const operationText = this.getOperationText(operation);
    const displayDir = directory.length > 50 ? '...' + directory.slice(-47) : directory;

    const message = reason
      ? `Atlas wants to ${operationText} in:\n\n${displayDir}\n\nReason: ${reason}`
      : `Atlas wants to ${operationText} in:\n\n${displayDir}`;

    const detail = `File: ${path.basename(targetPath)}\n\nGranting access will allow Atlas to ${operationText} files in this directory. You can revoke access later from the settings.`;

    try {
      const mainWindow = BrowserWindow.getAllWindows()[0];
      const result = await dialog.showMessageBox(mainWindow, {
        type: 'question',
        buttons: ['Allow', 'Allow Once', 'Deny'],
        defaultId: 2,
        cancelId: 2,
        title: 'File Access Request',
        message,
        detail,
        checkboxLabel: 'Remember this choice',
        checkboxChecked: false,
      });

      const allowed = result.response !== 2;

      if (allowed) {
        // Grant access
        const permissions: FileAccessPermission[] =
          operation === 'read' || operation === 'list'
            ? ['read', 'list']
            : ['read', 'write', 'create', 'delete', 'list'];

        const expiresAt =
          result.response === 1 // Allow Once
            ? Date.now() + 5 * 60 * 1000 // 5 minutes
            : result.checkboxChecked
              ? undefined // Permanent
              : Date.now() + 24 * 60 * 60 * 1000; // 24 hours default

        this.whitelistedDirs.set(this.normalizePath(directory), {
          path: directory,
          permissions,
          grantedAt: Date.now(),
          grantedBy: 'user',
          expiresAt,
        });

        logger.info('Directory access granted', {
          directory,
          operation,
          expiresAt,
          permanent: !expiresAt,
        });
      }

      // Log the decision
      this.auditLogger.logFileAccess(targetPath, operation, allowed, {
        source: 'user_prompt',
        sessionId: this.sessionId,
        reason: allowed ? 'User granted access' : 'User denied access',
      });

      return allowed;
    } catch (error) {
      logger.error('Failed to show access prompt', { error: (error as Error).message });
      return false;
    }
  }

  /**
   * Get human-readable operation text
   */
  private getOperationText(operation: FileOperationType): string {
    switch (operation) {
      case 'read':
        return 'read files';
      case 'write':
        return 'write/modify files';
      case 'create':
        return 'create new files';
      case 'delete':
        return 'delete files';
      case 'list':
        return 'list directory contents';
      default:
        return operation;
    }
  }

  /**
   * Check access for a file operation
   */
  async checkAccess(
    targetPath: string,
    operation: FileOperationType,
    options: {
      reason?: string;
      skipPrompt?: boolean;
      source?: string;
    } = {}
  ): Promise<FileAccessResult> {
    const { reason, skipPrompt = false, source = 'tool' } = options;

    // Validate path first
    const validation = this.validatePath(targetPath);

    if (!validation.valid) {
      const result: FileAccessResult = {
        allowed: false,
        path: targetPath,
        normalizedPath: validation.normalizedPath,
        operation,
        reason: `Path validation failed: ${validation.issues.join(', ')}`,
        isBlocked: validation.isBlocked,
      };

      this.auditLogger.logFileAccess(targetPath, operation, false, {
        source,
        sessionId: this.sessionId,
        reason: result.reason,
      });

      return result;
    }

    // Check whitelist
    if (this.isWhitelisted(validation.normalizedPath, operation)) {
      const result: FileAccessResult = {
        allowed: true,
        path: targetPath,
        normalizedPath: validation.normalizedPath,
        operation,
        reason: 'Directory is whitelisted',
      };

      this.auditLogger.logFileAccess(targetPath, operation, true, {
        source,
        sessionId: this.sessionId,
      });

      return result;
    }

    // Not whitelisted - try to prompt user
    if (!skipPrompt && this.config.enableUserPrompts) {
      const granted = await this.promptForAccess(targetPath, operation, reason);

      if (granted) {
        return {
          allowed: true,
          path: targetPath,
          normalizedPath: validation.normalizedPath,
          operation,
          reason: 'User granted access',
        };
      }
    }

    // Access denied
    const result: FileAccessResult = {
      allowed: false,
      path: targetPath,
      normalizedPath: validation.normalizedPath,
      operation,
      reason: 'Directory is not whitelisted and user did not grant access',
      requiresPrompt: !skipPrompt && this.config.enableUserPrompts,
    };

    this.auditLogger.logFileAccess(targetPath, operation, false, {
      source,
      sessionId: this.sessionId,
      reason: result.reason,
    });

    return result;
  }

  /**
   * Execute a file operation with timeout and access control
   */
  async executeOperation<T>(
    targetPath: string,
    operation: FileOperationType,
    executor: () => Promise<T>,
    options: {
      reason?: string;
      source?: string;
      timeout?: number;
    } = {}
  ): Promise<T> {
    const { reason, source = 'tool', timeout = this.config.defaultTimeout } = options;

    // Check access first
    const accessResult = await this.checkAccess(targetPath, operation, { reason, source });

    if (!accessResult.allowed) {
      throw new FileGuardError(accessResult.reason ?? 'Access denied', operation, targetPath, {
        isBlocked: accessResult.isBlocked,
        requiresPrompt: accessResult.requiresPrompt,
      });
    }

    // Execute with timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new FileGuardError('Operation timed out', operation, targetPath, { timeout }));
      }, timeout);
    });

    try {
      const result = await Promise.race([executor(), timeoutPromise]);
      return result;
    } catch (error) {
      if (error instanceof FileGuardError) {
        throw error;
      }

      const err = error as Error;
      throw new FileGuardError(`Operation failed: ${err.message}`, operation, targetPath, {
        originalError: err.message,
      });
    }
  }

  /**
   * Read file with security checks
   */
  async readFile(
    filePath: string,
    options: {
      encoding?: BufferEncoding;
      reason?: string;
      source?: string;
      maxSize?: number;
    } = {}
  ): Promise<string | Buffer> {
    const { encoding = 'utf-8', reason, source, maxSize = this.config.maxFileSize } = options;

    return this.executeOperation(
      filePath,
      'read',
      async () => {
        // Check file size first
        const stats = await fs.stat(filePath);
        if (stats.size > maxSize) {
          throw new FileGuardError(
            `File size ${stats.size} exceeds maximum allowed ${maxSize}`,
            'read',
            filePath
          );
        }

        if (encoding) {
          return fs.readFile(filePath, { encoding });
        }
        return fs.readFile(filePath);
      },
      { reason, source }
    );
  }

  /**
   * Write file with security checks
   */
  async writeFile(
    filePath: string,
    content: string | Buffer,
    options: {
      encoding?: BufferEncoding;
      reason?: string;
      source?: string;
      mode?: number;
    } = {}
  ): Promise<void> {
    const { encoding = 'utf-8', reason, source, mode } = options;

    // Check content size
    const contentSize = Buffer.byteLength(content);
    if (contentSize > this.config.maxFileSize) {
      throw new FileGuardError(
        `Content size ${contentSize} exceeds maximum allowed ${this.config.maxFileSize}`,
        'write',
        filePath
      );
    }

    // Determine operation type
    const operation = existsSync(filePath) ? 'write' : 'create';

    return this.executeOperation(
      filePath,
      operation,
      async () => {
        // Ensure parent directory exists
        const parentDir = path.dirname(filePath);
        await fs.mkdir(parentDir, { recursive: true });

        await fs.writeFile(filePath, content, { encoding, mode });
      },
      { reason, source }
    );
  }

  /**
   * Delete file with security checks
   */
  async deleteFile(
    filePath: string,
    options: {
      reason?: string;
      source?: string;
    } = {}
  ): Promise<void> {
    const { reason, source } = options;

    return this.executeOperation(
      filePath,
      'delete',
      async () => {
        await fs.unlink(filePath);
      },
      { reason, source }
    );
  }

  /**
   * List directory with security checks
   */
  async listDirectory(
    dirPath: string,
    options: {
      reason?: string;
      source?: string;
      recursive?: boolean;
      maxEntries?: number;
    } = {}
  ): Promise<string[]> {
    const { reason, source, recursive = false, maxEntries = 1000 } = options;

    return this.executeOperation(
      dirPath,
      'list',
      async () => {
        if (recursive) {
          const entries: string[] = [];
          await this.listRecursive(dirPath, entries, maxEntries);
          return entries;
        }

        const entries = await fs.readdir(dirPath);
        return entries.slice(0, maxEntries);
      },
      { reason, source }
    );
  }

  /**
   * Recursively list directory contents
   */
  private async listRecursive(
    dirPath: string,
    entries: string[],
    maxEntries: number
  ): Promise<void> {
    if (entries.length >= maxEntries) {
      return;
    }

    const items = await fs.readdir(dirPath, { withFileTypes: true });

    for (const item of items) {
      if (entries.length >= maxEntries) {
        break;
      }

      const fullPath = path.join(dirPath, item.name);
      entries.push(fullPath);

      if (item.isDirectory()) {
        await this.listRecursive(fullPath, entries, maxEntries);
      }
    }
  }

  /**
   * Add a directory to the whitelist
   */
  addToWhitelist(
    directory: string,
    permissions: FileAccessPermission[],
    options: {
      expiresAt?: number;
      grantedBy?: string;
    } = {}
  ): void {
    const { expiresAt, grantedBy = 'system' } = options;
    const normalizedDir = this.normalizePath(directory);

    this.whitelistedDirs.set(normalizedDir, {
      path: directory,
      permissions,
      grantedAt: Date.now(),
      grantedBy,
      expiresAt,
    });

    logger.info('Directory added to whitelist', {
      directory: normalizedDir,
      permissions,
      expiresAt,
    });
  }

  /**
   * Remove a directory from the whitelist
   */
  removeFromWhitelist(directory: string): boolean {
    const normalizedDir = this.normalizePath(directory);
    const removed = this.whitelistedDirs.delete(normalizedDir);

    if (removed) {
      logger.info('Directory removed from whitelist', { directory: normalizedDir });
    }

    return removed;
  }

  /**
   * Get all whitelisted directories
   */
  getWhitelistedDirectories(): DirectoryPermission[] {
    return Array.from(this.whitelistedDirs.values());
  }

  /**
   * Clear all user-granted permissions
   */
  clearUserPermissions(): void {
    for (const [key, permission] of this.whitelistedDirs) {
      if (permission.grantedBy === 'user') {
        this.whitelistedDirs.delete(key);
      }
    }
    logger.info('User-granted permissions cleared');
  }

  /**
   * Clear expired permissions
   */
  clearExpiredPermissions(): number {
    let cleared = 0;
    const now = Date.now();

    for (const [key, permission] of this.whitelistedDirs) {
      if (permission.expiresAt && now > permission.expiresAt) {
        this.whitelistedDirs.delete(key);
        cleared++;
      }
    }

    if (cleared > 0) {
      logger.info('Expired permissions cleared', { count: cleared });
    }

    return cleared;
  }

  /**
   * Check if a specific path is blocked (for external use)
   */
  isPathBlocked(targetPath: string): boolean {
    const validation = this.validatePath(targetPath);
    return validation.isBlocked ?? false;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<FileGuardConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('FileGuard config updated');
  }

  /**
   * Get current configuration
   */
  getConfig(): FileGuardConfig {
    return { ...this.config };
  }
}

// Singleton instance
let fileGuardInstance: FileGuard | null = null;

/**
 * Get or create the singleton FileGuard instance
 */
export function getFileGuard(config?: Partial<FileGuardConfig>): FileGuard {
  if (!fileGuardInstance) {
    fileGuardInstance = new FileGuard(config);
  }
  return fileGuardInstance;
}

/**
 * Shutdown the file guard
 */
export function shutdownFileGuard(): void {
  if (fileGuardInstance) {
    fileGuardInstance.clearExpiredPermissions();
    fileGuardInstance = null;
  }
}

export default FileGuard;
