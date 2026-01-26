/**
 * Atlas Desktop - Rollback Manager
 *
 * Provides rollback capabilities via git and file snapshots for safe operations.
 * Supports voice-activated undo ("Atlas, undo that") and automatic snapshots
 * before risky operations.
 *
 * @module agent/rollback-manager
 */

import { spawn, SpawnOptions } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('RollbackManager');

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Snapshot types supported by the rollback manager
 */
export type SnapshotType = 'git-stash' | 'git-commit' | 'file-snapshot';

/**
 * A file within a snapshot
 */
export interface SnapshotFile {
  /** Absolute file path */
  path: string;
  /** File content at time of snapshot */
  content: string;
  /** Whether the file existed at time of snapshot (false = file didn't exist) */
  exists: boolean;
}

/**
 * File-based snapshot containing copies of files before modification
 */
export interface FileSnapshot {
  /** Unique identifier */
  id: string;
  /** Files included in the snapshot */
  files: SnapshotFile[];
  /** When the snapshot was created */
  timestamp: Date;
}

/**
 * A rollback point (either git-based or file-based)
 */
export interface Snapshot {
  /** Unique identifier */
  id: string;
  /** Human-readable reason for the snapshot */
  reason: string;
  /** Type of snapshot */
  type: SnapshotType;
  /** When the snapshot was created */
  timestamp: Date;
  /** Git reference (for git-based snapshots) */
  gitRef?: string;
  /** File snapshot data (for file-based snapshots) */
  fileSnapshot?: FileSnapshot;
  /** ID of the operation that triggered this snapshot */
  operationId?: string;
  /** Working directory at time of snapshot */
  workingDirectory?: string;
}

/**
 * Git stash information
 */
export interface GitStash {
  /** Stash index (0 = most recent) */
  index: number;
  /** Stash message */
  message: string;
  /** Branch the stash was created from */
  branch: string;
  /** When the stash was created */
  timestamp: Date;
}

/**
 * Result of a rollback operation
 */
export interface RollbackResult {
  /** Whether the rollback succeeded */
  success: boolean;
  /** The snapshot that was used for rollback */
  snapshot: Snapshot;
  /** Human-readable message describing what happened */
  message: string;
  /** List of files that were restored (if applicable) */
  filesRestored?: string[];
}

/**
 * Snapshot index stored on disk
 */
interface SnapshotIndex {
  snapshots: Snapshot[];
  lastCleanup: string;
}

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_TIMEOUT = 30000; // 30 seconds
const MAX_OUTPUT_SIZE = 512 * 1024; // 512KB
const MAX_SNAPSHOTS = 50; // Keep last 50 file snapshots
const SNAPSHOT_DIR_NAME = 'snapshots';
const INDEX_FILE_NAME = 'index.json';

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get the Atlas data directory
 */
function getAtlasDataDir(): string {
  return path.join(os.homedir(), '.atlas');
}

/**
 * Get the snapshots directory
 */
function getSnapshotsDir(): string {
  return path.join(getAtlasDataDir(), SNAPSHOT_DIR_NAME);
}

/**
 * Get the snapshot index file path
 */
function getIndexFilePath(): string {
  return path.join(getSnapshotsDir(), INDEX_FILE_NAME);
}

/**
 * Ensure the snapshots directory exists
 */
function ensureSnapshotsDir(): void {
  const dir = getSnapshotsDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    logger.debug('Created snapshots directory', { path: dir });
  }
}

/**
 * Generate a unique snapshot ID
 */
function generateSnapshotId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `snap_${timestamp}_${random}`;
}

/**
 * Execute a git command and return the result
 */
async function executeGitCommand(
  args: string[],
  cwd?: string
): Promise<{ success: boolean; stdout: string; stderr: string; exitCode: number }> {
  const workingDir = cwd ? path.resolve(cwd) : process.cwd();

  return new Promise((resolve) => {
    const spawnOptions: SpawnOptions = {
      cwd: workingDir,
      shell: os.platform() === 'win32',
      windowsHide: true,
    };

    const proc = spawn('git', args, spawnOptions);
    let stdout = '';
    let stderr = '';

    const timeout = setTimeout(() => {
      proc.kill('SIGTERM');
      resolve({
        success: false,
        stdout,
        stderr: 'Command timed out',
        exitCode: -1,
      });
    }, DEFAULT_TIMEOUT);

    proc.stdout?.on('data', (data: Buffer) => {
      if (stdout.length + data.length <= MAX_OUTPUT_SIZE) {
        stdout += data.toString();
      }
    });

    proc.stderr?.on('data', (data: Buffer) => {
      if (stderr.length + data.length <= MAX_OUTPUT_SIZE) {
        stderr += data.toString();
      }
    });

    proc.on('close', (exitCode) => {
      clearTimeout(timeout);
      resolve({
        success: exitCode === 0,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: exitCode ?? -1,
      });
    });

    proc.on('error', (error) => {
      clearTimeout(timeout);
      resolve({
        success: false,
        stdout: '',
        stderr: error.message,
        exitCode: -1,
      });
    });
  });
}

/**
 * Check if directory is a git repository
 */
async function isGitRepository(cwd?: string): Promise<boolean> {
  const result = await executeGitCommand(['rev-parse', '--is-inside-work-tree'], cwd);
  return result.success && result.stdout === 'true';
}

/**
 * Get repository root path
 * @todo Use in enhanced rollback features
 */
async function _getRepoRoot(cwd?: string): Promise<string | null> {
  const result = await executeGitCommand(['rev-parse', '--show-toplevel'], cwd);
  return result.success ? result.stdout : null;
}

// ============================================================================
// RollbackManager Class
// ============================================================================

/**
 * RollbackManager provides safe rollback capabilities for Atlas operations.
 *
 * Features:
 * - Git-based rollback (stash, reset, revert)
 * - File-based snapshots for non-git directories
 * - Automatic snapshot creation before risky operations
 * - Voice-activated undo support
 * - History tracking with automatic cleanup
 */
export class RollbackManager {
  private snapshots: Snapshot[] = [];
  private initialized = false;
  private currentWorkingDir: string = process.cwd();

  constructor() {
    this.loadIndex();
  }

  /**
   * Initialize the rollback manager
   */
  private loadIndex(): void {
    try {
      ensureSnapshotsDir();
      const indexPath = getIndexFilePath();

      if (fs.existsSync(indexPath)) {
        const data = fs.readFileSync(indexPath, 'utf-8');
        const index: SnapshotIndex = JSON.parse(data);

        // Convert date strings back to Date objects
        this.snapshots = index.snapshots.map((s) => ({
          ...s,
          timestamp: new Date(s.timestamp),
          fileSnapshot: s.fileSnapshot
            ? {
                ...s.fileSnapshot,
                timestamp: new Date(s.fileSnapshot.timestamp),
              }
            : undefined,
        }));

        logger.debug('Loaded snapshot index', { count: this.snapshots.length });
      }

      this.initialized = true;
    } catch (error) {
      logger.error('Failed to load snapshot index', { error: (error as Error).message });
      this.snapshots = [];
      this.initialized = true;
    }
  }

  /**
   * Save the snapshot index to disk
   */
  private saveIndex(): void {
    try {
      ensureSnapshotsDir();
      const indexPath = getIndexFilePath();

      const index: SnapshotIndex = {
        snapshots: this.snapshots,
        lastCleanup: new Date().toISOString(),
      };

      fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf-8');
      logger.debug('Saved snapshot index', { count: this.snapshots.length });
    } catch (error) {
      logger.error('Failed to save snapshot index', { error: (error as Error).message });
    }
  }

  /**
   * Cleanup old snapshots to stay under the maximum limit
   */
  private cleanupOldSnapshots(): void {
    // Only cleanup file snapshots, not git references
    const fileSnapshots = this.snapshots.filter((s) => s.type === 'file-snapshot');

    if (fileSnapshots.length > MAX_SNAPSHOTS) {
      // Sort by timestamp, oldest first
      const sorted = fileSnapshots.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

      // Remove oldest snapshots
      const toRemove = sorted.slice(0, fileSnapshots.length - MAX_SNAPSHOTS);

      for (const snapshot of toRemove) {
        // Remove snapshot data file if it exists
        if (snapshot.fileSnapshot) {
          const dataPath = path.join(getSnapshotsDir(), `${snapshot.id}.json`);
          if (fs.existsSync(dataPath)) {
            try {
              fs.unlinkSync(dataPath);
            } catch {
              // Ignore cleanup errors
            }
          }
        }

        // Remove from list
        const index = this.snapshots.findIndex((s) => s.id === snapshot.id);
        if (index !== -1) {
          this.snapshots.splice(index, 1);
        }
      }

      logger.debug('Cleaned up old snapshots', { removed: toRemove.length });
      this.saveIndex();
    }
  }

  /**
   * Set the current working directory for operations
   */
  setWorkingDirectory(dir: string): void {
    this.currentWorkingDir = path.resolve(dir);
  }

  /**
   * Get the current working directory
   */
  getWorkingDirectory(): string {
    return this.currentWorkingDir;
  }

  // ==========================================================================
  // Snapshot Creation
  // ==========================================================================

  /**
   * Create a snapshot before an operation.
   * Automatically chooses between git stash or file snapshot based on context.
   *
   * @param reason - Human-readable reason for the snapshot
   * @param options - Additional options
   * @returns The created snapshot
   */
  async createSnapshot(
    reason: string,
    options: {
      operationId?: string;
      filePaths?: string[];
      preferGit?: boolean;
      workingDirectory?: string;
    } = {}
  ): Promise<Snapshot> {
    const cwd = options.workingDirectory || this.currentWorkingDir;
    const isGitRepo = await isGitRepository(cwd);

    // If it's a git repo and we have uncommitted changes, prefer git stash
    if (isGitRepo && options.preferGit !== false) {
      const statusResult = await executeGitCommand(['status', '--porcelain'], cwd);
      const hasChanges = statusResult.stdout.trim().length > 0;

      if (hasChanges) {
        try {
          const stashRef = await this.gitStash(`Atlas auto-snapshot: ${reason}`);
          const snapshot: Snapshot = {
            id: generateSnapshotId(),
            reason,
            type: 'git-stash',
            timestamp: new Date(),
            gitRef: stashRef,
            operationId: options.operationId,
            workingDirectory: cwd,
          };

          this.snapshots.push(snapshot);
          this.cleanupOldSnapshots();
          this.saveIndex();

          logger.info('Created git stash snapshot', { id: snapshot.id, reason });
          return snapshot;
        } catch (error) {
          logger.warn('Failed to create git stash, falling back to file snapshot', {
            error: (error as Error).message,
          });
        }
      }
    }

    // Fall back to file snapshot
    if (options.filePaths && options.filePaths.length > 0) {
      const fileSnapshot = await this.fileSnapshot(options.filePaths);
      const snapshot: Snapshot = {
        id: generateSnapshotId(),
        reason,
        type: 'file-snapshot',
        timestamp: new Date(),
        fileSnapshot,
        operationId: options.operationId,
        workingDirectory: cwd,
      };

      this.snapshots.push(snapshot);
      this.cleanupOldSnapshots();
      this.saveIndex();

      logger.info('Created file snapshot', {
        id: snapshot.id,
        reason,
        fileCount: fileSnapshot.files.length,
      });
      return snapshot;
    }

    // If no files specified and no git changes, create an empty reference snapshot
    const snapshot: Snapshot = {
      id: generateSnapshotId(),
      reason,
      type: 'git-commit',
      timestamp: new Date(),
      gitRef: isGitRepo ? (await this.getCurrentCommitHash(cwd)) || undefined : undefined,
      operationId: options.operationId,
      workingDirectory: cwd,
    };

    this.snapshots.push(snapshot);
    this.saveIndex();

    logger.info('Created reference snapshot', { id: snapshot.id, reason });
    return snapshot;
  }

  /**
   * Get the current HEAD commit hash
   */
  private async getCurrentCommitHash(cwd?: string): Promise<string | null> {
    const result = await executeGitCommand(['rev-parse', 'HEAD'], cwd);
    return result.success ? result.stdout : null;
  }

  // ==========================================================================
  // Git-based Rollback Operations
  // ==========================================================================

  /**
   * Rollback to a specific commit by creating a revert commit
   *
   * @param commitHash - The commit hash to revert to
   */
  async gitRollback(commitHash: string): Promise<void> {
    const cwd = this.currentWorkingDir;

    if (!(await isGitRepository(cwd))) {
      throw new Error('Not a git repository');
    }

    // Create a revert commit
    const result = await executeGitCommand(['revert', '--no-commit', commitHash], cwd);

    if (!result.success) {
      throw new Error(`Failed to revert: ${result.stderr}`);
    }

    // Commit the revert
    const commitResult = await executeGitCommand(
      ['commit', '-m', `Revert to ${commitHash.substring(0, 7)}`],
      cwd
    );

    if (!commitResult.success) {
      // Abort the revert if commit fails
      await executeGitCommand(['revert', '--abort'], cwd);
      throw new Error(`Failed to commit revert: ${commitResult.stderr}`);
    }

    logger.info('Git rollback completed', { commitHash });
  }

  /**
   * Stash current changes
   *
   * @param message - Optional stash message
   * @returns The stash reference
   */
  async gitStash(message?: string): Promise<string> {
    const cwd = this.currentWorkingDir;

    if (!(await isGitRepository(cwd))) {
      throw new Error('Not a git repository');
    }

    const args = ['stash', 'push', '--include-untracked'];
    if (message) {
      args.push('-m', message);
    }

    const result = await executeGitCommand(args, cwd);

    if (!result.success) {
      throw new Error(`Failed to stash: ${result.stderr}`);
    }

    // Get the stash reference
    const listResult = await executeGitCommand(['stash', 'list', '-1'], cwd);
    const stashRef = listResult.stdout.match(/stash@\{\d+\}/)?.[0] || 'stash@{0}';

    logger.info('Git stash created', { ref: stashRef, message });
    return stashRef;
  }

  /**
   * Pop a stash and restore changes
   *
   * @param stashId - The stash reference (e.g., "stash@{0}")
   */
  async gitStashPop(stashId: string): Promise<void> {
    const cwd = this.currentWorkingDir;

    if (!(await isGitRepository(cwd))) {
      throw new Error('Not a git repository');
    }

    const result = await executeGitCommand(['stash', 'pop', stashId], cwd);

    if (!result.success) {
      throw new Error(`Failed to pop stash: ${result.stderr}`);
    }

    logger.info('Git stash popped', { stashId });
  }

  /**
   * Apply a stash without removing it
   *
   * @param stashId - The stash reference
   */
  async gitStashApply(stashId: string): Promise<void> {
    const cwd = this.currentWorkingDir;

    if (!(await isGitRepository(cwd))) {
      throw new Error('Not a git repository');
    }

    const result = await executeGitCommand(['stash', 'apply', stashId], cwd);

    if (!result.success) {
      throw new Error(`Failed to apply stash: ${result.stderr}`);
    }

    logger.info('Git stash applied', { stashId });
  }

  /**
   * Reset the repository to a specific state
   *
   * @param mode - Reset mode: 'soft', 'mixed', or 'hard'
   * @param target - Target commit (default: HEAD)
   */
  async gitReset(mode: 'soft' | 'mixed' | 'hard', target: string = 'HEAD'): Promise<void> {
    const cwd = this.currentWorkingDir;

    if (!(await isGitRepository(cwd))) {
      throw new Error('Not a git repository');
    }

    // Safety check for hard reset
    if (mode === 'hard') {
      logger.warn('Performing hard reset - uncommitted changes will be lost', { target });
    }

    const result = await executeGitCommand(['reset', `--${mode}`, target], cwd);

    if (!result.success) {
      throw new Error(`Failed to reset: ${result.stderr}`);
    }

    logger.info('Git reset completed', { mode, target });
  }

  // ==========================================================================
  // File-based Snapshot Operations
  // ==========================================================================

  /**
   * Create a file-based snapshot of specific files
   *
   * @param paths - Array of file paths to snapshot
   * @returns The created file snapshot
   */
  async fileSnapshot(paths: string[]): Promise<FileSnapshot> {
    const files: SnapshotFile[] = [];

    for (const filePath of paths) {
      const absolutePath = path.isAbsolute(filePath)
        ? filePath
        : path.resolve(this.currentWorkingDir, filePath);

      try {
        if (fs.existsSync(absolutePath)) {
          const content = fs.readFileSync(absolutePath, 'utf-8');
          files.push({
            path: absolutePath,
            content,
            exists: true,
          });
        } else {
          // Record that the file didn't exist (for deletion rollback)
          files.push({
            path: absolutePath,
            content: '',
            exists: false,
          });
        }
      } catch (error) {
        logger.warn('Failed to snapshot file', {
          path: absolutePath,
          error: (error as Error).message,
        });
      }
    }

    const snapshot: FileSnapshot = {
      id: generateSnapshotId(),
      files,
      timestamp: new Date(),
    };

    // Save snapshot data to disk
    ensureSnapshotsDir();
    const dataPath = path.join(getSnapshotsDir(), `${snapshot.id}.json`);
    fs.writeFileSync(dataPath, JSON.stringify(snapshot, null, 2), 'utf-8');

    logger.debug('File snapshot created', { id: snapshot.id, fileCount: files.length });
    return snapshot;
  }

  /**
   * Restore files from a file snapshot
   *
   * @param snapshot - The file snapshot to restore from
   */
  async restoreSnapshot(snapshot: FileSnapshot): Promise<string[]> {
    const restoredFiles: string[] = [];

    for (const file of snapshot.files) {
      try {
        if (file.exists) {
          // Ensure directory exists
          const dir = path.dirname(file.path);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }

          // Restore file content
          fs.writeFileSync(file.path, file.content, 'utf-8');
          restoredFiles.push(file.path);
          logger.debug('Restored file', { path: file.path });
        } else {
          // File didn't exist before - delete it if it exists now
          if (fs.existsSync(file.path)) {
            fs.unlinkSync(file.path);
            restoredFiles.push(file.path);
            logger.debug('Deleted file (did not exist in snapshot)', { path: file.path });
          }
        }
      } catch (error) {
        logger.error('Failed to restore file', {
          path: file.path,
          error: (error as Error).message,
        });
      }
    }

    logger.info('Snapshot restored', {
      snapshotId: snapshot.id,
      filesRestored: restoredFiles.length,
    });
    return restoredFiles;
  }

  // ==========================================================================
  // Query Operations
  // ==========================================================================

  /**
   * List all available snapshots
   */
  listSnapshots(): Snapshot[] {
    return [...this.snapshots].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  /**
   * Get a specific snapshot by ID
   */
  getSnapshot(id: string): Snapshot | undefined {
    return this.snapshots.find((s) => s.id === id);
  }

  /**
   * Get the most recent snapshot
   */
  getLatestSnapshot(): Snapshot | undefined {
    if (this.snapshots.length === 0) return undefined;
    return this.listSnapshots()[0];
  }

  /**
   * List all git stashes in the current repository
   */
  async listGitStashes(): Promise<GitStash[]> {
    const cwd = this.currentWorkingDir;

    if (!(await isGitRepository(cwd))) {
      return [];
    }

    const result = await executeGitCommand(['stash', 'list', '--format=%gd|%gs|%ci'], cwd);

    if (!result.success || !result.stdout.trim()) {
      return [];
    }

    const stashes: GitStash[] = [];
    const lines = result.stdout.split('\n').filter((l) => l.trim());

    for (const line of lines) {
      const [ref, message, dateStr] = line.split('|');
      const indexMatch = ref.match(/stash@\{(\d+)\}/);
      const branchMatch = message?.match(/On ([^:]+):/);

      if (indexMatch) {
        stashes.push({
          index: parseInt(indexMatch[1], 10),
          message: message || '',
          branch: branchMatch?.[1] || 'unknown',
          timestamp: dateStr ? new Date(dateStr) : new Date(),
        });
      }
    }

    return stashes;
  }

  /**
   * Check if rollback is possible
   */
  async canRollback(): Promise<{ possible: boolean; reason?: string }> {
    const latestSnapshot = this.getLatestSnapshot();

    if (!latestSnapshot) {
      return { possible: false, reason: 'No snapshots available' };
    }

    // Check based on snapshot type
    switch (latestSnapshot.type) {
      case 'git-stash':
        if (latestSnapshot.gitRef) {
          const stashes = await this.listGitStashes();
          const exists = stashes.some((s) => `stash@{${s.index}}` === latestSnapshot.gitRef);
          if (!exists) {
            return { possible: false, reason: 'Git stash no longer exists' };
          }
        }
        break;

      case 'file-snapshot':
        if (!latestSnapshot.fileSnapshot) {
          return { possible: false, reason: 'File snapshot data is missing' };
        }
        break;

      case 'git-commit':
        if (latestSnapshot.gitRef) {
          const cwd = latestSnapshot.workingDirectory || this.currentWorkingDir;
          const result = await executeGitCommand(['cat-file', '-t', latestSnapshot.gitRef], cwd);
          if (!result.success) {
            return { possible: false, reason: 'Git commit no longer exists' };
          }
        }
        break;
    }

    return { possible: true };
  }

  // ==========================================================================
  // Voice Command Support
  // ==========================================================================

  /**
   * Undo the last operation by restoring from the most recent snapshot.
   * Supports voice command: "Atlas, undo that"
   *
   * @returns Result of the rollback operation
   */
  async undoLastOperation(): Promise<RollbackResult> {
    const latestSnapshot = this.getLatestSnapshot();

    if (!latestSnapshot) {
      return {
        success: false,
        snapshot: {
          id: '',
          reason: '',
          type: 'file-snapshot',
          timestamp: new Date(),
        },
        message: 'No operations to undo. No snapshots are available.',
      };
    }

    logger.info('Attempting to undo last operation', {
      snapshotId: latestSnapshot.id,
      type: latestSnapshot.type,
      reason: latestSnapshot.reason,
    });

    try {
      let filesRestored: string[] | undefined;

      switch (latestSnapshot.type) {
        case 'git-stash':
          if (latestSnapshot.gitRef) {
            // Set working directory if specified
            if (latestSnapshot.workingDirectory) {
              this.setWorkingDirectory(latestSnapshot.workingDirectory);
            }
            await this.gitStashPop(latestSnapshot.gitRef);
          }
          break;

        case 'file-snapshot':
          if (latestSnapshot.fileSnapshot) {
            filesRestored = await this.restoreSnapshot(latestSnapshot.fileSnapshot);
          }
          break;

        case 'git-commit':
          if (latestSnapshot.gitRef) {
            // Set working directory if specified
            if (latestSnapshot.workingDirectory) {
              this.setWorkingDirectory(latestSnapshot.workingDirectory);
            }
            // Reset to the saved commit
            await this.gitReset('hard', latestSnapshot.gitRef);
          }
          break;
      }

      // Remove the used snapshot from the list
      const index = this.snapshots.findIndex((s) => s.id === latestSnapshot.id);
      if (index !== -1) {
        this.snapshots.splice(index, 1);
        this.saveIndex();
      }

      const message = this.buildUndoMessage(latestSnapshot, filesRestored);

      logger.info('Undo operation completed', {
        snapshotId: latestSnapshot.id,
        filesRestored: filesRestored?.length || 0,
      });

      return {
        success: true,
        snapshot: latestSnapshot,
        message,
        filesRestored,
      };
    } catch (error) {
      const errorMessage = (error as Error).message;
      logger.error('Undo operation failed', {
        snapshotId: latestSnapshot.id,
        error: errorMessage,
      });

      return {
        success: false,
        snapshot: latestSnapshot,
        message: `Failed to undo: ${errorMessage}`,
      };
    }
  }

  /**
   * Build a human-readable message describing the undo operation
   */
  private buildUndoMessage(snapshot: Snapshot, filesRestored?: string[]): string {
    switch (snapshot.type) {
      case 'git-stash':
        return `Restored stashed changes from "${snapshot.reason}"`;

      case 'file-snapshot':
        if (filesRestored && filesRestored.length > 0) {
          if (filesRestored.length === 1) {
            return `Restored file: ${path.basename(filesRestored[0])}`;
          }
          return `Restored ${filesRestored.length} files from snapshot "${snapshot.reason}"`;
        }
        return `Restored snapshot "${snapshot.reason}"`;

      case 'git-commit':
        return `Reset to commit ${snapshot.gitRef?.substring(0, 7) || 'unknown'}`;

      default:
        return `Undid operation: ${snapshot.reason}`;
    }
  }

  // ==========================================================================
  // Utility Methods
  // ==========================================================================

  /**
   * Delete a specific snapshot
   */
  deleteSnapshot(id: string): boolean {
    const index = this.snapshots.findIndex((s) => s.id === id);
    if (index === -1) return false;

    const snapshot = this.snapshots[index];

    // Clean up file snapshot data
    if (snapshot.type === 'file-snapshot' && snapshot.fileSnapshot) {
      const dataPath = path.join(getSnapshotsDir(), `${snapshot.fileSnapshot.id}.json`);
      if (fs.existsSync(dataPath)) {
        try {
          fs.unlinkSync(dataPath);
        } catch {
          // Ignore cleanup errors
        }
      }
    }

    this.snapshots.splice(index, 1);
    this.saveIndex();

    logger.debug('Deleted snapshot', { id });
    return true;
  }

  /**
   * Clear all snapshots
   */
  clearAllSnapshots(): void {
    // Clean up all snapshot files
    for (const snapshot of this.snapshots) {
      if (snapshot.type === 'file-snapshot' && snapshot.fileSnapshot) {
        const dataPath = path.join(getSnapshotsDir(), `${snapshot.fileSnapshot.id}.json`);
        if (fs.existsSync(dataPath)) {
          try {
            fs.unlinkSync(dataPath);
          } catch {
            // Ignore cleanup errors
          }
        }
      }
    }

    this.snapshots = [];
    this.saveIndex();

    logger.info('Cleared all snapshots');
  }

  /**
   * Get snapshot statistics
   */
  getStats(): {
    totalSnapshots: number;
    gitStashes: number;
    fileSnapshots: number;
    gitCommits: number;
    oldestSnapshot?: Date;
    newestSnapshot?: Date;
  } {
    const gitStashes = this.snapshots.filter((s) => s.type === 'git-stash').length;
    const fileSnapshots = this.snapshots.filter((s) => s.type === 'file-snapshot').length;
    const gitCommits = this.snapshots.filter((s) => s.type === 'git-commit').length;

    const sorted = this.listSnapshots();

    return {
      totalSnapshots: this.snapshots.length,
      gitStashes,
      fileSnapshots,
      gitCommits,
      oldestSnapshot: sorted.length > 0 ? sorted[sorted.length - 1].timestamp : undefined,
      newestSnapshot: sorted.length > 0 ? sorted[0].timestamp : undefined,
    };
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

let instance: RollbackManager | null = null;

/**
 * Get the singleton RollbackManager instance
 */
export function getRollbackManager(): RollbackManager {
  if (!instance) {
    instance = new RollbackManager();
  }
  return instance;
}

/**
 * Reset the singleton instance (for testing)
 */
export function resetRollbackManager(): void {
  instance = null;
}

export default {
  RollbackManager,
  getRollbackManager,
  resetRollbackManager,
};
