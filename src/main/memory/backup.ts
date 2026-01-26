/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Atlas Desktop - Backup System
 * Real-time backup and rotation for the Obsidian vault
 */

import * as fse from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import { format, subDays, isAfter, parseISO, startOfDay } from 'date-fns';
import { EventEmitter } from 'events';
import { getVaultPath, VAULT_DIRECTORIES } from './obsidian-brain';
import { getVaultWatcher, VaultWatcher } from './vault-watcher';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('BackupSystem');

/**
 * Backup configuration
 */
export interface BackupConfig {
  /** Number of daily backups to keep */
  retentionDays: number;
  /** Backup directory path */
  backupPath: string;
  /** Enable real-time incremental backups */
  enableRealTime: boolean;
  /** Hour to create daily snapshot (0-23) */
  dailySnapshotHour: number;
}

const DEFAULT_CONFIG: BackupConfig = {
  retentionDays: 7,
  backupPath: path.join(os.homedir(), '.atlas', 'backups', 'brain'),
  enableRealTime: true,
  dailySnapshotHour: 0, // Midnight
};

/**
 * Backup events
 */
export interface BackupEvents {
  /** Note was backed up */
  'note-backed-up': (notePath: string, backupPath: string) => void;
  /** Daily snapshot created */
  'daily-snapshot-created': (snapshotPath: string) => void;
  /** Old backups pruned */
  'backups-pruned': (count: number) => void;
  /** Backup system initialized */
  initialized: () => void;
  /** Error occurred */
  error: (error: Error) => void;
}

/**
 * Backup manager for the Obsidian vault
 */
export class BackupManager extends EventEmitter {
  private config: BackupConfig;
  private vaultWatcher: VaultWatcher | null = null;
  private dailySnapshotTimer: NodeJS.Timeout | null = null;
  private isInitialized = false;

  constructor(config?: Partial<BackupConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    logger.info('BackupManager created', { config: this.config });
  }

  /**
   * Initialize the backup system
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      logger.warn('Backup system already initialized');
      return;
    }

    logger.info('Initializing backup system');

    try {
      // Ensure backup directory exists
      await fse.ensureDir(this.config.backupPath);

      // Create incremental backup directory
      const incrementalPath = this.getIncrementalPath();
      await fse.ensureDir(incrementalPath);

      // Set up real-time backup if enabled
      if (this.config.enableRealTime) {
        await this.setupRealTimeBackup();
      }

      // Schedule daily snapshot
      this.scheduleDailySnapshot();

      this.isInitialized = true;
      this.emit('initialized');
      logger.info('Backup system initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize backup system', {
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * Shutdown the backup system
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down backup system');

    // Clear daily snapshot timer
    if (this.dailySnapshotTimer) {
      clearTimeout(this.dailySnapshotTimer);
      this.dailySnapshotTimer = null;
    }

    // Remove watcher listeners
    if (this.vaultWatcher) {
      this.vaultWatcher.off('note-added', this.handleNoteChange);
      this.vaultWatcher.off('note-changed', this.handleNoteChange);
      this.vaultWatcher = null;
    }

    this.isInitialized = false;
    logger.info('Backup system shutdown complete');
  }

  /**
   * Get the path for incremental backups (today's changes)
   */
  private getIncrementalPath(): string {
    const today = format(new Date(), 'yyyy-MM-dd');
    return path.join(this.config.backupPath, 'incremental', today);
  }

  /**
   * Get the path for daily snapshots
   */
  private getDailySnapshotPath(date?: Date): string {
    const dateStr = format(date || new Date(), 'yyyy-MM-dd');
    return path.join(this.config.backupPath, 'daily', dateStr);
  }

  /**
   * Set up real-time backup using vault watcher
   */
  private async setupRealTimeBackup(): Promise<void> {
    this.vaultWatcher = getVaultWatcher();

    // Listen for note changes
    this.vaultWatcher.on('note-added', this.handleNoteChange);
    this.vaultWatcher.on('note-changed', this.handleNoteChange);

    logger.info('Real-time backup enabled');
  }

  /**
   * Handle note change event (bound method)
   */
  private handleNoteChange = async (notePath: string): Promise<void> => {
    try {
      await this.backupNote(notePath);
    } catch (error) {
      logger.error('Failed to backup note on change', {
        path: notePath,
        error: (error as Error).message,
      });
      this.emit('error', error as Error);
    }
  };

  /**
   * Backup a single note to the incremental backup location
   */
  async backupNote(notePath: string): Promise<string> {
    const vaultPath = getVaultPath();
    const sourcePath = path.join(vaultPath, notePath);

    // Check source exists
    if (!(await fse.pathExists(sourcePath))) {
      logger.warn('Source note does not exist for backup', { path: notePath });
      throw new Error(`Source note does not exist: ${notePath}`);
    }

    // Create timestamped backup
    const timestamp = format(new Date(), 'HHmmss');
    const backupDir = this.getIncrementalPath();
    const noteDir = path.dirname(notePath);
    const noteName = path.basename(notePath, '.md');

    // Ensure backup subdirectory exists
    const backupSubDir = path.join(backupDir, noteDir);
    await fse.ensureDir(backupSubDir);

    // Create backup filename with timestamp
    const backupFilename = `${noteName}_${timestamp}.md`;
    const backupPath = path.join(backupSubDir, backupFilename);

    // Copy the file
    await fse.copy(sourcePath, backupPath);

    logger.debug('Note backed up', { source: notePath, backup: backupPath });
    this.emit('note-backed-up', notePath, backupPath);

    return backupPath;
  }

  /**
   * Create a full daily snapshot of the vault
   */
  async createDailySnapshot(date?: Date): Promise<string> {
    const snapshotPath = this.getDailySnapshotPath(date);
    const vaultPath = getVaultPath();

    logger.info('Creating daily snapshot', { path: snapshotPath });

    try {
      // Remove existing snapshot for today if exists
      if (await fse.pathExists(snapshotPath)) {
        await fse.remove(snapshotPath);
      }

      // Create snapshot directory
      await fse.ensureDir(snapshotPath);

      // Copy all vault directories
      for (const dir of VAULT_DIRECTORIES) {
        const sourceDir = path.join(vaultPath, dir);
        const destDir = path.join(snapshotPath, dir);

        if (await fse.pathExists(sourceDir)) {
          await fse.copy(sourceDir, destDir, {
            filter: (src) => {
              // Exclude _index.md files from backup
              return !src.endsWith('_index.md');
            },
          });
        }
      }

      // Create a manifest file with backup info
      const manifest = {
        created: new Date().toISOString(),
        vaultPath,
        directories: VAULT_DIRECTORIES,
        type: 'daily-snapshot',
      };
      await fse.writeFile(
        path.join(snapshotPath, '_manifest.json'),
        JSON.stringify(manifest, null, 2),
        'utf-8'
      );

      logger.info('Daily snapshot created successfully', { path: snapshotPath });
      this.emit('daily-snapshot-created', snapshotPath);

      // Prune old backups after creating new snapshot
      await this.pruneOldBackups();

      return snapshotPath;
    } catch (error) {
      logger.error('Failed to create daily snapshot', {
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * Prune backups older than retention period
   */
  async pruneOldBackups(): Promise<number> {
    const dailyBackupPath = path.join(this.config.backupPath, 'daily');
    const incrementalPath = path.join(this.config.backupPath, 'incremental');

    let prunedCount = 0;

    // Calculate cutoff date
    const cutoffDate = startOfDay(subDays(new Date(), this.config.retentionDays));

    logger.info('Pruning old backups', {
      cutoffDate: cutoffDate.toISOString(),
      retentionDays: this.config.retentionDays,
    });

    // Prune daily snapshots
    if (await fse.pathExists(dailyBackupPath)) {
      prunedCount += await this.pruneDirectory(dailyBackupPath, cutoffDate);
    }

    // Prune incremental backups
    if (await fse.pathExists(incrementalPath)) {
      prunedCount += await this.pruneDirectory(incrementalPath, cutoffDate);
    }

    if (prunedCount > 0) {
      logger.info('Pruned old backups', { count: prunedCount });
      this.emit('backups-pruned', prunedCount);
    }

    return prunedCount;
  }

  /**
   * Prune a backup directory based on folder dates
   */
  private async pruneDirectory(dirPath: string, cutoffDate: Date): Promise<number> {
    let prunedCount = 0;

    try {
      const entries = await fse.readdir(dirPath);

      for (const entry of entries) {
        // Parse date from folder name (YYYY-MM-DD format)
        const dateMatch = entry.match(/^(\d{4}-\d{2}-\d{2})$/);
        if (!dateMatch) continue;

        try {
          const folderDate = parseISO(dateMatch[1]);

          // Delete if older than cutoff
          if (!isAfter(folderDate, cutoffDate)) {
            const folderPath = path.join(dirPath, entry);
            await fse.remove(folderPath);
            prunedCount++;
            logger.debug('Pruned backup folder', { path: folderPath });
          }
        } catch {
          // Skip folders with invalid date names
          continue;
        }
      }
    } catch (error) {
      logger.error('Error pruning directory', {
        path: dirPath,
        error: (error as Error).message,
      });
    }

    return prunedCount;
  }

  /**
   * Schedule daily snapshot at configured hour
   */
  private scheduleDailySnapshot(): void {
    const scheduleNext = () => {
      const now = new Date();
      const nextRun = new Date(now);

      // Set to the configured hour
      nextRun.setHours(this.config.dailySnapshotHour, 0, 0, 0);

      // If we've passed that hour today, schedule for tomorrow
      if (nextRun <= now) {
        nextRun.setDate(nextRun.getDate() + 1);
      }

      const msUntilNext = nextRun.getTime() - now.getTime();

      logger.info('Scheduled next daily snapshot', {
        nextRun: nextRun.toISOString(),
        msUntilNext,
      });

      this.dailySnapshotTimer = setTimeout(async () => {
        try {
          await this.createDailySnapshot();
        } catch (error) {
          logger.error('Daily snapshot failed', {
            error: (error as Error).message,
          });
        }

        // Schedule next run
        scheduleNext();
      }, msUntilNext);
    };

    scheduleNext();
  }

  /**
   * Get list of available backups
   */
  async getAvailableBackups(): Promise<{
    daily: string[];
    incremental: string[];
  }> {
    const dailyPath = path.join(this.config.backupPath, 'daily');
    const incrementalPath = path.join(this.config.backupPath, 'incremental');

    const daily: string[] = [];
    const incremental: string[] = [];

    if (await fse.pathExists(dailyPath)) {
      const entries = await fse.readdir(dailyPath);
      daily.push(
        ...entries
          .filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e))
          .sort()
          .reverse()
      );
    }

    if (await fse.pathExists(incrementalPath)) {
      const entries = await fse.readdir(incrementalPath);
      incremental.push(
        ...entries
          .filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e))
          .sort()
          .reverse()
      );
    }

    return { daily, incremental };
  }

  /**
   * Restore a note from backup
   */
  async restoreNote(backupPath: string, overwrite: boolean = false): Promise<string> {
    const vaultPath = getVaultPath();

    // Validate backup path is within backup directory
    const absoluteBackupPath = path.resolve(backupPath);
    if (!absoluteBackupPath.startsWith(path.resolve(this.config.backupPath))) {
      throw new Error('Invalid backup path: outside backup directory');
    }

    // Check backup exists
    if (!(await fse.pathExists(absoluteBackupPath))) {
      throw new Error(`Backup file not found: ${backupPath}`);
    }

    // Determine original note path
    // Backup format: {backupDir}/{date}/{directory}/{filename}_{timestamp}.md
    // or daily: {backupDir}/daily/{date}/{directory}/{filename}.md
    const parts = absoluteBackupPath.split(path.sep);
    const backupBaseIndex = parts.indexOf('backups');
    if (backupBaseIndex === -1) {
      throw new Error('Cannot determine original note path');
    }

    // Find the vault directory (people, concepts, etc.)
    let vaultDir: string | null = null;
    let filename: string | null = null;

    for (let i = backupBaseIndex + 3; i < parts.length; i++) {
      const part = parts[i];
      if (VAULT_DIRECTORIES.includes(part as any)) {
        vaultDir = part;
        const remaining = parts.slice(i + 1).join(path.sep);
        // Remove timestamp suffix if present (e.g., "note_123456.md" -> "note.md")
        filename = remaining.replace(/_\d{6}\.md$/, '.md');
        break;
      }
    }

    if (!vaultDir || !filename) {
      throw new Error('Cannot determine original note location from backup path');
    }

    const restorePath = path.join(vaultPath, vaultDir, filename);

    // Check if target exists
    if ((await fse.pathExists(restorePath)) && !overwrite) {
      throw new Error(`Note already exists at ${restorePath}. Use overwrite=true to replace.`);
    }

    // Ensure directory exists
    await fse.ensureDir(path.dirname(restorePath));

    // Copy backup to vault
    await fse.copy(absoluteBackupPath, restorePath);

    logger.info('Note restored from backup', {
      backup: absoluteBackupPath,
      restored: restorePath,
    });

    return restorePath;
  }

  /**
   * Get backup statistics
   */
  async getStats(): Promise<{
    dailyBackups: number;
    incrementalBackups: number;
    totalSizeBytes: number;
    oldestBackup: string | null;
    newestBackup: string | null;
  }> {
    const { daily, incremental } = await this.getAvailableBackups();

    let totalSize = 0;

    // Calculate total size of daily backups
    for (const d of daily) {
      const dirPath = path.join(this.config.backupPath, 'daily', d);
      totalSize += await this.getDirectorySize(dirPath);
    }

    // Calculate total size of incremental backups
    for (const i of incremental) {
      const dirPath = path.join(this.config.backupPath, 'incremental', i);
      totalSize += await this.getDirectorySize(dirPath);
    }

    const allDates = [...daily, ...incremental].sort();

    return {
      dailyBackups: daily.length,
      incrementalBackups: incremental.length,
      totalSizeBytes: totalSize,
      oldestBackup: allDates[0] || null,
      newestBackup: allDates[allDates.length - 1] || null,
    };
  }

  /**
   * Get total size of a directory in bytes
   */
  private async getDirectorySize(dirPath: string): Promise<number> {
    let totalSize = 0;

    try {
      const entries = await fse.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const entryPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
          totalSize += await this.getDirectorySize(entryPath);
        } else {
          const stats = await fse.stat(entryPath);
          totalSize += stats.size;
        }
      }
    } catch {
      // Directory may not exist
    }

    return totalSize;
  }

  // Type-safe event emitter methods
  on<K extends keyof BackupEvents>(event: K, listener: BackupEvents[K]): this {
    return super.on(event, listener);
  }

  off<K extends keyof BackupEvents>(event: K, listener: BackupEvents[K]): this {
    return super.off(event, listener);
  }

  emit<K extends keyof BackupEvents>(event: K, ...args: Parameters<BackupEvents[K]>): boolean {
    return super.emit(event, ...args);
  }
}

// Singleton instance
let backupManager: BackupManager | null = null;

/**
 * Get or create the backup manager instance
 */
export function getBackupManager(config?: Partial<BackupConfig>): BackupManager {
  if (!backupManager) {
    backupManager = new BackupManager(config);
  }
  return backupManager;
}

/**
 * Initialize the backup system (convenience function)
 */
export async function initBackupSystem(config?: Partial<BackupConfig>): Promise<BackupManager> {
  const manager = getBackupManager(config);
  await manager.initialize();
  return manager;
}

/**
 * Shutdown the backup system (convenience function)
 */
export async function shutdownBackupSystem(): Promise<void> {
  if (backupManager) {
    await backupManager.shutdown();
    backupManager = null;
  }
}

/**
 * Backup a single note (convenience function)
 */
export async function backupNote(notePath: string): Promise<string> {
  const manager = getBackupManager();
  return manager.backupNote(notePath);
}

/**
 * Create a daily backup (convenience function)
 */
export async function createDailyBackup(): Promise<string> {
  const manager = getBackupManager();
  return manager.createDailySnapshot();
}

/**
 * Prune old backups (convenience function)
 */
export async function pruneOldBackups(): Promise<number> {
  const manager = getBackupManager();
  return manager.pruneOldBackups();
}
