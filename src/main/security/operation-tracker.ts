/**
 * Atlas Desktop - Operation Tracker
 * Tracks operations with rollback capability (044-C)
 *
 * Features:
 * - Track file operations with before/after state
 * - Support rollback of recent operations
 * - Operation history with timestamps
 * - Automatic backup creation for destructive operations
 * - Batch rollback support
 * - Integration with RollbackManager for git-aware rollbacks
 *
 * @module security/operation-tracker
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { existsSync, writeFileSync, copyFileSync, unlinkSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { createHash } from 'crypto';
import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import { getErrorMessage } from '../../shared/utils';
import { getAuditLogger } from './audit-logger';
import type { RollbackManager as RollbackManagerType } from '../agent/rollback-manager';

const logger = createModuleLogger('OperationTracker');


/**
 * Operation types that can be tracked
 */
export type TrackedOperationType =
  | 'file_create'
  | 'file_modify'
  | 'file_delete'
  | 'file_rename'
  | 'file_copy'
  | 'directory_create'
  | 'directory_delete'
  | 'settings_change'
  | 'config_change'
  | 'custom';

/**
 * Tracked operation record
 */
export interface TrackedOperation {
  id: string;
  type: TrackedOperationType;
  timestamp: number;
  description: string;
  resource: string;
  beforeState?: {
    path?: string;
    content?: string;
    contentHash?: string;
    backupPath?: string;
    metadata?: Record<string, unknown>;
  };
  afterState?: {
    path?: string;
    content?: string;
    contentHash?: string;
    metadata?: Record<string, unknown>;
  };
  rollbackable: boolean;
  rolledBack: boolean;
  relatedOperations?: string[];
  source: string;
  sessionId?: string;
}

/**
 * Rollback result
 */
export interface RollbackResult {
  success: boolean;
  operationId: string;
  message: string;
  rolledBackState?: TrackedOperation['beforeState'];
}

/**
 * Operation tracker configuration
 */
export interface OperationTrackerConfig {
  /** Maximum number of operations to keep in history */
  maxHistory: number;

  /** Maximum time to keep operations (ms) */
  maxAge: number;

  /** Directory for backup files */
  backupDir: string;

  /** Maximum backup size per file (bytes) */
  maxBackupSize: number;

  /** Enable automatic backups for modifications */
  autoBackup: boolean;

  /** File extensions to always backup */
  backupExtensions: string[];
}

/**
 * Default configuration
 */
export const DEFAULT_OPERATION_TRACKER_CONFIG: OperationTrackerConfig = {
  maxHistory: 1000,
  maxAge: 24 * 60 * 60 * 1000, // 24 hours
  backupDir: path.join(homedir(), '.atlas', 'backups'),
  maxBackupSize: 10 * 1024 * 1024, // 10MB
  autoBackup: true,
  backupExtensions: [
    '.ts',
    '.tsx',
    '.js',
    '.jsx',
    '.json',
    '.md',
    '.yaml',
    '.yml',
    '.toml',
    '.env',
  ],
};

/**
 * Operation Tracker
 * Tracks operations with rollback capability
 * Enhanced with RollbackManager integration for git-aware rollbacks
 */
export class OperationTracker extends EventEmitter {
  private config: OperationTrackerConfig;
  private operations: Map<string, TrackedOperation> = new Map();
  private auditLogger = getAuditLogger();
  private rollbackManager: RollbackManagerType | null = null;
  private rollbackManagerLoaded = false;

  constructor(config?: Partial<OperationTrackerConfig>) {
    super();

    this.config = { ...DEFAULT_OPERATION_TRACKER_CONFIG, ...config };

    // Ensure backup directory exists
    this.ensureBackupDir();
    
    // Lazy load rollback manager
    this.loadRollbackManager();

    logger.info('OperationTracker initialized', {
      maxHistory: this.config.maxHistory,
      backupDir: this.config.backupDir,
    });
  }
  
  /**
   * Lazy load the RollbackManager for enhanced rollback capabilities
   */
  private async loadRollbackManager(): Promise<void> {
    if (this.rollbackManagerLoaded) return;
    
    try {
      const { getRollbackManager } = await import('../agent/rollback-manager');
      this.rollbackManager = getRollbackManager();
      this.rollbackManagerLoaded = true;
      logger.debug('RollbackManager integration enabled');
    } catch (error) {
      logger.warn('RollbackManager not available, using fallback rollback', {
        error: getErrorMessage(error),
      });
      this.rollbackManagerLoaded = true;
    }
  }

  /**
   * Track a file creation
   */
  async trackFileCreate(
    filePath: string,
    options: {
      content?: string;
      source?: string;
      sessionId?: string;
    } = {}
  ): Promise<TrackedOperation> {
    const operation = await this.createOperation('file_create', {
      resource: filePath,
      description: `Created file: ${path.basename(filePath)}`,
      source: options.source || 'unknown',
      sessionId: options.sessionId,
      afterState: {
        path: filePath,
        content: options.content,
        contentHash: options.content ? this.hashContent(options.content) : undefined,
      },
      rollbackable: true,
    });

    return operation;
  }

  /**
   * Track a file modification
   */
  async trackFileModify(
    filePath: string,
    options: {
      beforeContent?: string;
      afterContent?: string;
      source?: string;
      sessionId?: string;
      createBackup?: boolean;
    } = {}
  ): Promise<TrackedOperation> {
    let backupPath: string | undefined;

    // Create backup if enabled
    if ((options.createBackup ?? this.config.autoBackup) && this.shouldBackup(filePath)) {
      backupPath = await this.createBackup(filePath, options.beforeContent);
    }

    const operation = await this.createOperation('file_modify', {
      resource: filePath,
      description: `Modified file: ${path.basename(filePath)}`,
      source: options.source || 'unknown',
      sessionId: options.sessionId,
      beforeState: {
        path: filePath,
        content: options.beforeContent,
        contentHash: options.beforeContent ? this.hashContent(options.beforeContent) : undefined,
        backupPath,
      },
      afterState: {
        path: filePath,
        content: options.afterContent,
        contentHash: options.afterContent ? this.hashContent(options.afterContent) : undefined,
      },
      rollbackable: !!options.beforeContent || !!backupPath,
    });

    return operation;
  }

  /**
   * Track a file deletion
   */
  async trackFileDelete(
    filePath: string,
    options: {
      beforeContent?: string;
      source?: string;
      sessionId?: string;
      createBackup?: boolean;
    } = {}
  ): Promise<TrackedOperation> {
    let backupPath: string | undefined;
    let beforeContent = options.beforeContent;

    // Read file content if not provided
    if (!beforeContent && existsSync(filePath)) {
      try {
        const stats = await fs.stat(filePath);
        if (stats.size <= this.config.maxBackupSize) {
          beforeContent = await fs.readFile(filePath, 'utf-8');
        }
      } catch {
        // Ignore read errors
      }
    }

    // Create backup if enabled
    if ((options.createBackup ?? this.config.autoBackup) && this.shouldBackup(filePath)) {
      backupPath = await this.createBackup(filePath, beforeContent);
    }

    const operation = await this.createOperation('file_delete', {
      resource: filePath,
      description: `Deleted file: ${path.basename(filePath)}`,
      source: options.source || 'unknown',
      sessionId: options.sessionId,
      beforeState: {
        path: filePath,
        content: beforeContent,
        contentHash: beforeContent ? this.hashContent(beforeContent) : undefined,
        backupPath,
      },
      rollbackable: !!beforeContent || !!backupPath,
    });

    return operation;
  }

  /**
   * Track a file rename
   */
  async trackFileRename(
    oldPath: string,
    newPath: string,
    options: {
      source?: string;
      sessionId?: string;
    } = {}
  ): Promise<TrackedOperation> {
    const operation = await this.createOperation('file_rename', {
      resource: newPath,
      description: `Renamed: ${path.basename(oldPath)} → ${path.basename(newPath)}`,
      source: options.source || 'unknown',
      sessionId: options.sessionId,
      beforeState: {
        path: oldPath,
      },
      afterState: {
        path: newPath,
      },
      rollbackable: true,
    });

    return operation;
  }

  /**
   * Track a settings change
   */
  async trackSettingsChange(
    settingKey: string,
    options: {
      beforeValue?: unknown;
      afterValue?: unknown;
      source?: string;
      sessionId?: string;
    } = {}
  ): Promise<TrackedOperation> {
    const operation = await this.createOperation('settings_change', {
      resource: settingKey,
      description: `Changed setting: ${settingKey}`,
      source: options.source || 'unknown',
      sessionId: options.sessionId,
      beforeState: {
        metadata: { value: options.beforeValue },
      },
      afterState: {
        metadata: { value: options.afterValue },
      },
      rollbackable: options.beforeValue !== undefined,
    });

    return operation;
  }

  /**
   * Track a custom operation
   */
  async trackCustomOperation(
    description: string,
    options: {
      resource?: string;
      beforeState?: TrackedOperation['beforeState'];
      afterState?: TrackedOperation['afterState'];
      rollbackable?: boolean;
      source?: string;
      sessionId?: string;
    } = {}
  ): Promise<TrackedOperation> {
    const operation = await this.createOperation('custom', {
      resource: options.resource || 'custom',
      description,
      source: options.source || 'unknown',
      sessionId: options.sessionId,
      beforeState: options.beforeState,
      afterState: options.afterState,
      rollbackable: options.rollbackable ?? false,
    });

    return operation;
  }

  /**
   * Rollback a specific operation
   * Enhanced with RollbackManager integration for git-aware rollbacks
   */
  async rollback(operationId: string, options?: { useGitRollback?: boolean }): Promise<RollbackResult> {
    const operation = this.operations.get(operationId);

    if (!operation) {
      return {
        success: false,
        operationId,
        message: 'Operation not found',
      };
    }

    if (operation.rolledBack) {
      return {
        success: false,
        operationId,
        message: 'Operation already rolled back',
      };
    }

    if (!operation.rollbackable) {
      return {
        success: false,
        operationId,
        message: 'Operation is not rollbackable',
      };
    }

    try {
      // Try git-based rollback via RollbackManager if available and preferred
      if (options?.useGitRollback && this.rollbackManager) {
        const gitResult = await this.tryGitRollback(operation);
        if (gitResult) {
          return gitResult;
        }
        // Fall through to standard rollback if git rollback not applicable
      }
      
      switch (operation.type) {
        case 'file_create':
          return await this.rollbackFileCreate(operation);

        case 'file_modify':
          return await this.rollbackFileModify(operation);

        case 'file_delete':
          return await this.rollbackFileDelete(operation);

        case 'file_rename':
          return await this.rollbackFileRename(operation);

        case 'settings_change':
          return await this.rollbackSettingsChange(operation);

        default:
          return {
            success: false,
            operationId,
            message: `Rollback not implemented for type: ${operation.type}`,
          };
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));

      logger.error('Rollback failed', { operationId, error: err.message });

      return {
        success: false,
        operationId,
        message: `Rollback failed: ${err.message}`,
      };
    }
  }

  /**
   * Try git-based rollback using RollbackManager
   * Returns null if git rollback is not applicable
   */
  private async tryGitRollback(operation: TrackedOperation): Promise<RollbackResult | null> {
    if (!this.rollbackManager) {
      return null;
    }
    
    // Only file operations can use git rollback
    if (!['file_create', 'file_modify', 'file_delete'].includes(operation.type)) {
      return null;
    }
    
    const filePath = operation.beforeState?.path || operation.afterState?.path || operation.resource;
    
    if (!filePath) {
      return null;
    }
    
    try {
      // Check if file is in a git repository
      const dirPath = path.dirname(filePath);
      const snapshots = await this.rollbackManager.listSnapshots();
      
      // Look for a snapshot created around the same time as this operation
      const operationTime = operation.timestamp;
      const matchingSnapshot = snapshots.find(s => {
        const snapshotTime = s.timestamp.getTime();
        // Match if snapshot was created within 5 seconds of operation
        return Math.abs(snapshotTime - operationTime) < 5000 &&
               s.operationId === operation.id;
      });
      
      if (matchingSnapshot) {
        logger.info('Found matching git snapshot for operation', { 
          operationId: operation.id,
          snapshotId: matchingSnapshot.id,
        });
        
        const result = await this.rollbackManager.rollback(matchingSnapshot.id);
        
        if (result.success) {
          operation.rolledBack = true;
          this.emit('operation:rolledBack', operation);
          
          this.auditLogger.log({
            action: 'operation_rollback_git',
            resource: filePath,
            outcome: 'success',
            details: {
              operationId: operation.id,
              snapshotId: matchingSnapshot.id,
              type: matchingSnapshot.type,
            },
          });
          
          return {
            success: true,
            operationId: operation.id,
            message: `Rolled back via git snapshot: ${matchingSnapshot.reason}`,
            rolledBackState: operation.beforeState,
          };
        }
      }
      
      // No matching snapshot, try to create a rollback using git restore
      if (operation.type === 'file_modify' || operation.type === 'file_delete') {
        // Use git to restore file from HEAD
        const snapshot = await this.rollbackManager.createSnapshot(
          `Rollback operation ${operation.id}`,
          { filePaths: [filePath], preferGit: true }
        );
        
        if (snapshot.type === 'git-stash' || snapshot.type === 'git-commit') {
          logger.info('Created git snapshot for rollback', {
            operationId: operation.id,
            snapshotId: snapshot.id,
          });
        }
      }
      
      return null; // Fall through to standard rollback
    } catch (error) {
      logger.warn('Git rollback attempt failed, falling back to standard rollback', {
        operationId: operation.id,
        error: getErrorMessage(error),
      });
      return null;
    }
  }

  /**
   * Create a snapshot before a tracked operation for enhanced rollback
   */
  async createSnapshotForOperation(
    operation: TrackedOperation,
    filePaths?: string[]
  ): Promise<string | null> {
    if (!this.rollbackManager) {
      await this.loadRollbackManager();
    }
    
    if (!this.rollbackManager) {
      return null;
    }
    
    try {
      const paths = filePaths || (operation.resource ? [operation.resource] : []);
      
      if (paths.length === 0) {
        return null;
      }
      
      const snapshot = await this.rollbackManager.createSnapshot(
        `Before operation: ${operation.description}`,
        {
          operationId: operation.id,
          filePaths: paths,
          preferGit: true,
        }
      );
      
      logger.debug('Created snapshot for operation', {
        operationId: operation.id,
        snapshotId: snapshot.id,
        type: snapshot.type,
      });
      
      return snapshot.id;
    } catch (error) {
      logger.warn('Failed to create snapshot for operation', {
        operationId: operation.id,
        error: getErrorMessage(error),
      });
      return null;
    }
  }

  /**
   * Rollback multiple operations (in reverse order)
   */
  async rollbackBatch(operationIds: string[], options?: { useGitRollback?: boolean }): Promise<RollbackResult[]> {
    const results: RollbackResult[] = [];

    // Rollback in reverse order
    for (const id of operationIds.reverse()) {
      const result = await this.rollback(id, options);
      results.push(result);

      if (!result.success) {
        logger.warn('Batch rollback stopped due to failure', { operationId: id });
        break;
      }
    }

    return results;
  }

  /**
   * Get operation history
   */
  getHistory(filters?: {
    type?: TrackedOperationType;
    source?: string;
    since?: number;
    limit?: number;
    rollbackable?: boolean;
  }): TrackedOperation[] {
    let operations = Array.from(this.operations.values());

    if (filters?.type) {
      operations = operations.filter((op) => op.type === filters.type);
    }

    if (filters?.source) {
      operations = operations.filter((op) => op.source === filters.source);
    }

    if (filters?.since) {
      operations = operations.filter((op) => op.timestamp >= filters.since);
    }

    if (filters?.rollbackable !== undefined) {
      operations = operations.filter(
        (op) => op.rollbackable === filters.rollbackable && !op.rolledBack
      );
    }

    // Sort by timestamp descending
    operations.sort((a, b) => b.timestamp - a.timestamp);

    if (filters?.limit) {
      operations = operations.slice(0, filters.limit);
    }

    return operations;
  }

  /**
   * Get a specific operation
   */
  getOperation(operationId: string): TrackedOperation | undefined {
    return this.operations.get(operationId);
  }

  /**
   * Get rollbackable operations
   */
  getRollbackableOperations(): TrackedOperation[] {
    return this.getHistory({ rollbackable: true });
  }

  /**
   * Clean up old operations
   */
  async cleanup(): Promise<number> {
    const now = Date.now();
    const cutoff = now - this.config.maxAge;
    let removed = 0;

    for (const [id, op] of this.operations.entries()) {
      if (op.timestamp < cutoff) {
        // Delete backup file if exists
        if (op.beforeState?.backupPath && existsSync(op.beforeState.backupPath)) {
          try {
            unlinkSync(op.beforeState.backupPath);
          } catch {
            // Ignore cleanup errors
          }
        }

        this.operations.delete(id);
        removed++;
      }
    }

    // Enforce max history limit
    if (this.operations.size > this.config.maxHistory) {
      const ops = Array.from(this.operations.entries())
        .sort(([, a], [, b]) => b.timestamp - a.timestamp)
        .slice(this.config.maxHistory);

      for (const [id, op] of ops) {
        if (op.beforeState?.backupPath && existsSync(op.beforeState.backupPath)) {
          try {
            unlinkSync(op.beforeState.backupPath);
          } catch {
            // Ignore cleanup errors
          }
        }

        this.operations.delete(id);
        removed++;
      }
    }

    if (removed > 0) {
      logger.info('Cleaned up old operations', { count: removed });
    }

    return removed;
  }

  /**
   * Create a tracked operation
   */
  private async createOperation(
    type: TrackedOperationType,
    details: Omit<TrackedOperation, 'id' | 'type' | 'timestamp' | 'rolledBack'>
  ): Promise<TrackedOperation> {
    const id = `op-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const operation: TrackedOperation = {
      id,
      type,
      timestamp: Date.now(),
      rolledBack: false,
      ...details,
    };

    this.operations.set(id, operation);

    // Log to audit logger
    this.auditLogger.log('operation_tracked', 'info', `Tracked ${type}: ${details.description}`, {
      action: `${type}:${details.resource}`,
      allowed: true,
      source: details.source,
      sessionId: details.sessionId,
      context: {
        operationId: id,
        type,
        resource: details.resource,
        rollbackable: details.rollbackable,
      },
    });

    this.emit('operation-tracked', operation);

    logger.debug('Operation tracked', { id, type, resource: details.resource });

    return operation;
  }

  /**
   * Rollback file creation
   */
  private async rollbackFileCreate(operation: TrackedOperation): Promise<RollbackResult> {
    const filePath = operation.afterState?.path || operation.resource;

    if (!existsSync(filePath)) {
      operation.rolledBack = true;
      return {
        success: true,
        operationId: operation.id,
        message: 'File already deleted',
      };
    }

    await fs.unlink(filePath);
    operation.rolledBack = true;

    this.logRollback(operation, true);

    return {
      success: true,
      operationId: operation.id,
      message: `Deleted created file: ${path.basename(filePath)}`,
    };
  }

  /**
   * Rollback file modification
   */
  private async rollbackFileModify(operation: TrackedOperation): Promise<RollbackResult> {
    const filePath = operation.resource;

    // Try to restore from backup first
    if (operation.beforeState?.backupPath && existsSync(operation.beforeState.backupPath)) {
      copyFileSync(operation.beforeState.backupPath, filePath);
      operation.rolledBack = true;

      this.logRollback(operation, true);

      return {
        success: true,
        operationId: operation.id,
        message: `Restored from backup: ${path.basename(filePath)}`,
        rolledBackState: operation.beforeState,
      };
    }

    // Try to restore from stored content
    if (operation.beforeState?.content) {
      writeFileSync(filePath, operation.beforeState.content, 'utf-8');
      operation.rolledBack = true;

      this.logRollback(operation, true);

      return {
        success: true,
        operationId: operation.id,
        message: `Restored content: ${path.basename(filePath)}`,
        rolledBackState: operation.beforeState,
      };
    }

    return {
      success: false,
      operationId: operation.id,
      message: 'No backup or content available for rollback',
    };
  }

  /**
   * Rollback file deletion
   */
  private async rollbackFileDelete(operation: TrackedOperation): Promise<RollbackResult> {
    const filePath = operation.resource;

    // Try to restore from backup first
    if (operation.beforeState?.backupPath && existsSync(operation.beforeState.backupPath)) {
      const dir = path.dirname(filePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      copyFileSync(operation.beforeState.backupPath, filePath);
      operation.rolledBack = true;

      this.logRollback(operation, true);

      return {
        success: true,
        operationId: operation.id,
        message: `Restored deleted file from backup: ${path.basename(filePath)}`,
        rolledBackState: operation.beforeState,
      };
    }

    // Try to restore from stored content
    if (operation.beforeState?.content) {
      const dir = path.dirname(filePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      writeFileSync(filePath, operation.beforeState.content, 'utf-8');
      operation.rolledBack = true;

      this.logRollback(operation, true);

      return {
        success: true,
        operationId: operation.id,
        message: `Restored deleted file: ${path.basename(filePath)}`,
        rolledBackState: operation.beforeState,
      };
    }

    return {
      success: false,
      operationId: operation.id,
      message: 'No backup or content available for rollback',
    };
  }

  /**
   * Rollback file rename
   */
  private async rollbackFileRename(operation: TrackedOperation): Promise<RollbackResult> {
    const oldPath = operation.beforeState?.path;
    const newPath = operation.afterState?.path || operation.resource;

    if (!oldPath) {
      return {
        success: false,
        operationId: operation.id,
        message: 'Original path not available',
      };
    }

    if (!existsSync(newPath)) {
      return {
        success: false,
        operationId: operation.id,
        message: 'Current file not found',
      };
    }

    await fs.rename(newPath, oldPath);
    operation.rolledBack = true;

    this.logRollback(operation, true);

    return {
      success: true,
      operationId: operation.id,
      message: `Renamed back: ${path.basename(newPath)} → ${path.basename(oldPath)}`,
      rolledBackState: operation.beforeState,
    };
  }

  /**
   * Rollback settings change
   */
  private async rollbackSettingsChange(operation: TrackedOperation): Promise<RollbackResult> {
    // Emit event for settings manager to handle
    this.emit('settings-rollback', {
      operationId: operation.id,
      settingKey: operation.resource,
      beforeValue: operation.beforeState?.metadata?.value,
    });

    operation.rolledBack = true;

    this.logRollback(operation, true);

    return {
      success: true,
      operationId: operation.id,
      message: `Settings rollback requested: ${operation.resource}`,
      rolledBackState: operation.beforeState,
    };
  }

  /**
   * Create a backup of a file
   */
  private async createBackup(filePath: string, content?: string): Promise<string | undefined> {
    try {
      const fileName = path.basename(filePath);
      const timestamp = Date.now();
      const backupName = `${fileName}.${timestamp}.bak`;
      const backupPath = path.join(this.config.backupDir, backupName);

      if (content) {
        writeFileSync(backupPath, content, 'utf-8');
      } else if (existsSync(filePath)) {
        copyFileSync(filePath, backupPath);
      } else {
        return undefined;
      }

      logger.debug('Created backup', { original: filePath, backup: backupPath });

      return backupPath;
    } catch (error) {
      logger.warn('Failed to create backup', { filePath, error });
      return undefined;
    }
  }

  /**
   * Check if a file should be backed up
   */
  private shouldBackup(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return this.config.backupExtensions.includes(ext);
  }

  /**
   * Hash content for comparison
   */
  private hashContent(content: string): string {
    return createHash('sha256').update(content).digest('hex').slice(0, 16);
  }

  /**
   * Ensure backup directory exists
   */
  private ensureBackupDir(): void {
    if (!existsSync(this.config.backupDir)) {
      mkdirSync(this.config.backupDir, { recursive: true });
    }
  }

  /**
   * Log rollback to audit logger
   */
  private logRollback(operation: TrackedOperation, success: boolean): void {
    this.auditLogger.log(
      'operation_rollback',
      success ? 'info' : 'warning',
      `Rolled back ${operation.type}: ${operation.description}`,
      {
        action: `rollback:${operation.type}:${operation.resource}`,
        allowed: true,
        source: 'operation_tracker',
        context: {
          operationId: operation.id,
          type: operation.type,
          resource: operation.resource,
          success,
        },
      }
    );

    this.emit('operation-rolledback', { operation, success });
  }

  /**
   * Shutdown the operation tracker
   */
  shutdown(): void {
    this.removeAllListeners();
    logger.info('OperationTracker shutdown complete');
  }
}

// Singleton instance
let operationTrackerInstance: OperationTracker | null = null;

/**
 * Get or create the singleton OperationTracker instance
 */
export function getOperationTracker(config?: Partial<OperationTrackerConfig>): OperationTracker {
  if (!operationTrackerInstance) {
    operationTrackerInstance = new OperationTracker(config);
  }
  return operationTrackerInstance;
}

/**
 * Shutdown the operation tracker
 */
export function shutdownOperationTracker(): void {
  if (operationTrackerInstance) {
    operationTrackerInstance.shutdown();
    operationTrackerInstance = null;
  }
}

export default OperationTracker;
