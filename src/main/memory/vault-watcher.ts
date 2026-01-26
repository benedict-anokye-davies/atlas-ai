/**
 * Atlas Desktop - Vault Watcher
 * Watch Obsidian vault for changes and trigger reindexing
 */

import * as path from 'path';
import { EventEmitter } from 'events';
import chokidar, { FSWatcher } from 'chokidar';
import { getVaultPath, VAULT_DIRECTORIES, VaultDirectory } from './obsidian-brain';
import { indexNote, getLanceSyncManager } from './lance-sync';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('VaultWatcher');

/**
 * Vault watcher events
 */
export interface VaultWatcherEvents {
  /** Note was added to vault */
  'note-added': (notePath: string) => void;
  /** Note was changed in vault */
  'note-changed': (notePath: string) => void;
  /** Note was deleted from vault */
  'note-deleted': (notePath: string) => void;
  /** Watcher started */
  started: () => void;
  /** Watcher stopped */
  stopped: () => void;
  /** Error occurred */
  error: (error: Error) => void;
}

/**
 * Watcher configuration
 */
export interface VaultWatcherConfig {
  /** Debounce delay in ms for rapid changes */
  debounceMs: number;
  /** Whether to auto-index on changes */
  autoIndex: boolean;
  /** Ignore patterns (relative to vault) */
  ignorePatterns: string[];
  /** Stability threshold for awaitWriteFinish */
  stabilityThreshold: number;
}

const DEFAULT_CONFIG: VaultWatcherConfig = {
  debounceMs: 500,
  autoIndex: true,
  ignorePatterns: [
    '.obsidian/**', // Obsidian config
    '_index.md', // MOC files
    '.DS_Store',
    'Thumbs.db',
    '*.tmp',
  ],
  stabilityThreshold: 1000,
};

/**
 * Vault Watcher
 * Monitors the Obsidian vault for changes and syncs with LanceDB
 */
export class VaultWatcher extends EventEmitter {
  private config: VaultWatcherConfig;
  private watcher: FSWatcher | null = null;
  private isWatching = false;
  private pendingChanges: Map<string, NodeJS.Timeout> = new Map();
  private recentlyProcessed: Set<string> = new Set();

  constructor(config?: Partial<VaultWatcherConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    logger.info('VaultWatcher created', { config: this.config });
  }

  /**
   * Start watching the vault
   */
  async startWatching(): Promise<void> {
    if (this.isWatching) {
      logger.warn('Watcher already running');
      return;
    }

    const vaultPath = getVaultPath();

    logger.info('Starting vault watcher', { path: vaultPath });

    try {
      // Create watcher with options
      this.watcher = chokidar.watch(vaultPath, {
        ignored: this.config.ignorePatterns.map((p) =>
          p.startsWith('/') ? p : path.join(vaultPath, p)
        ),
        persistent: true,
        ignoreInitial: true, // Don't emit events for existing files
        awaitWriteFinish: {
          stabilityThreshold: this.config.stabilityThreshold,
          pollInterval: 100,
        },
        // Only watch markdown files
        depth: 99,
      });

      // Set up event handlers
      this.watcher
        .on('add', (filePath) => this.handleFileEvent('add', filePath))
        .on('change', (filePath) => this.handleFileEvent('change', filePath))
        .on('unlink', (filePath) => this.handleFileEvent('unlink', filePath))
        .on('error', (error) => this.handleError(error as Error))
        .on('ready', () => {
          this.isWatching = true;
          this.emit('started');
          logger.info('Vault watcher ready');
        });
    } catch (error) {
      logger.error('Failed to start watcher', { error: (error as Error).message });
      throw error;
    }
  }

  /**
   * Stop watching the vault
   */
  async stopWatching(): Promise<void> {
    if (!this.isWatching || !this.watcher) {
      return;
    }

    logger.info('Stopping vault watcher');

    // Clear pending changes
    for (const timeout of this.pendingChanges.values()) {
      clearTimeout(timeout);
    }
    this.pendingChanges.clear();

    // Close watcher
    await this.watcher.close();
    this.watcher = null;
    this.isWatching = false;

    this.emit('stopped');
    logger.info('Vault watcher stopped');
  }

  /**
   * Handle file system events
   */
  private handleFileEvent(eventType: 'add' | 'change' | 'unlink', filePath: string): void {
    // Only process markdown files
    if (!filePath.endsWith('.md')) {
      return;
    }

    // Get relative path
    const vaultPath = getVaultPath();
    const relativePath = path.relative(vaultPath, filePath);

    // Skip non-vault directories and system files
    if (this.shouldIgnore(relativePath)) {
      return;
    }

    // Debounce rapid changes
    const existingTimeout = this.pendingChanges.get(relativePath);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    // Skip if recently processed (prevents duplicate events)
    if (this.recentlyProcessed.has(relativePath)) {
      return;
    }

    const timeout = setTimeout(() => {
      this.pendingChanges.delete(relativePath);
      this.processFileEvent(eventType, relativePath);
    }, this.config.debounceMs);

    this.pendingChanges.set(relativePath, timeout);
  }

  /**
   * Process a debounced file event
   */
  private async processFileEvent(
    eventType: 'add' | 'change' | 'unlink',
    relativePath: string
  ): Promise<void> {
    // Mark as recently processed to prevent duplicates
    this.recentlyProcessed.add(relativePath);
    setTimeout(() => {
      this.recentlyProcessed.delete(relativePath);
    }, 1000);

    logger.debug('Processing file event', { type: eventType, path: relativePath });

    switch (eventType) {
      case 'add':
        this.emit('note-added', relativePath);
        if (this.config.autoIndex) {
          await this.indexNoteWithRetry(relativePath);
        }
        break;

      case 'change':
        this.emit('note-changed', relativePath);
        if (this.config.autoIndex) {
          await this.indexNoteWithRetry(relativePath);
        }
        break;

      case 'unlink':
        this.emit('note-deleted', relativePath);
        if (this.config.autoIndex) {
          await this.removeFromIndex(relativePath);
        }
        break;
    }
  }

  /**
   * Index a note with retry logic
   */
  private async indexNoteWithRetry(notePath: string, retries: number = 3): Promise<void> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const status = await indexNote(notePath);
        if (status.indexed) {
          logger.info('Note indexed on change', { path: notePath });
          return;
        }
        if (status.error) {
          throw new Error(status.error);
        }
      } catch (error) {
        if (attempt === retries) {
          logger.error('Failed to index note after retries', {
            path: notePath,
            error: (error as Error).message,
          });
        } else {
          // Wait before retry
          await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
        }
      }
    }
  }

  /**
   * Remove a note from the index
   */
  private async removeFromIndex(notePath: string): Promise<void> {
    try {
      const manager = await getLanceSyncManager();
      await manager.removeFromIndex(notePath);
      logger.info('Note removed from index', { path: notePath });
    } catch (error) {
      logger.error('Failed to remove note from index', {
        path: notePath,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Check if a path should be ignored
   */
  private shouldIgnore(relativePath: string): boolean {
    // Ignore .obsidian directory
    if (relativePath.startsWith('.obsidian')) {
      return true;
    }

    // Ignore _index.md files
    if (relativePath.endsWith('_index.md')) {
      return true;
    }

    // Check if path is in a valid vault directory
    const firstDir = relativePath.split(path.sep)[0] as VaultDirectory;
    if (!VAULT_DIRECTORIES.includes(firstDir)) {
      return true;
    }

    return false;
  }

  /**
   * Handle watcher errors
   */
  private handleError(error: Error): void {
    logger.error('Watcher error', { error: error.message });
    this.emit('error', error);
  }

  /**
   * Check if watcher is running
   */
  isRunning(): boolean {
    return this.isWatching;
  }

  /**
   * Get pending change count
   */
  getPendingCount(): number {
    return this.pendingChanges.size;
  }

  /**
   * Force process all pending changes immediately
   */
  async flushPending(): Promise<void> {
    const pending = Array.from(this.pendingChanges.keys());

    // Clear timeouts
    for (const timeout of this.pendingChanges.values()) {
      clearTimeout(timeout);
    }
    this.pendingChanges.clear();

    // Process all pending
    for (const relativePath of pending) {
      await this.processFileEvent('change', relativePath);
    }
  }

  // Type-safe event emitter methods
  on<K extends keyof VaultWatcherEvents>(event: K, listener: VaultWatcherEvents[K]): this {
    return super.on(event, listener);
  }

  off<K extends keyof VaultWatcherEvents>(event: K, listener: VaultWatcherEvents[K]): this {
    return super.off(event, listener);
  }

  emit<K extends keyof VaultWatcherEvents>(
    event: K,
    ...args: Parameters<VaultWatcherEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }
}

// Singleton instance
let vaultWatcher: VaultWatcher | null = null;

/**
 * Get or create the vault watcher instance
 */
export function getVaultWatcher(config?: Partial<VaultWatcherConfig>): VaultWatcher {
  if (!vaultWatcher) {
    vaultWatcher = new VaultWatcher(config);
  }
  return vaultWatcher;
}

/**
 * Start watching the vault (convenience function)
 */
export async function startWatching(config?: Partial<VaultWatcherConfig>): Promise<VaultWatcher> {
  const watcher = getVaultWatcher(config);
  await watcher.startWatching();
  return watcher;
}

/**
 * Stop watching the vault (convenience function)
 */
export async function stopWatching(): Promise<void> {
  if (vaultWatcher) {
    await vaultWatcher.stopWatching();
    vaultWatcher = null;
  }
}
