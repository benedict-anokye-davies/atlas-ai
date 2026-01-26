/**
 * GEPA Rollback System
 *
 * Manages safe rollback of applied optimizations.
 * Maintains version history and provides recovery options.
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import * as fs from 'fs/promises';
import * as path from 'path';
import { getConfig } from '../config';
import { isoDate } from '../../shared/utils';

const logger = createModuleLogger('GEPA-Rollback');

// ============================================================================
// Types
// ============================================================================

/**
 * Snapshot of a configuration state
 */
export interface ConfigSnapshot {
  id: string;
  timestamp: Date;
  target: string;
  description: string;
  data: Record<string, unknown>;
  hash: string;
}

/**
 * Rollback record
 */
export interface RollbackRecord {
  id: string;
  timestamp: Date;
  fromSnapshotId: string;
  toSnapshotId: string;
  reason: string;
  automatic: boolean;
  restoredTargets: string[];
}

/**
 * Rollback options
 */
export interface RollbackOptions {
  target?: string; // Specific target to rollback
  snapshotId?: string; // Specific snapshot to restore
  force?: boolean; // Skip confirmation
}

// ============================================================================
// Rollback Manager
// ============================================================================

export class RollbackManager extends EventEmitter {
  private dataDir: string;
  private snapshots: Map<string, ConfigSnapshot> = new Map();
  private rollbackHistory: RollbackRecord[] = [];
  private initialized = false;

  // Maximum snapshots per target
  private readonly MAX_SNAPSHOTS_PER_TARGET = 20;

  constructor() {
    super();
    this.setMaxListeners(20);
    this.dataDir = '';
  }

  // --------------------------------------------------------------------------
  // Initialization
  // --------------------------------------------------------------------------

  /**
   * Initialize the rollback manager
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      const appConfig = getConfig();
      const atlasDir = path.dirname(appConfig.logDir);
      this.dataDir = path.join(atlasDir, 'gepa', 'rollback');

      await fs.mkdir(path.join(this.dataDir, 'snapshots'), { recursive: true });
      await fs.mkdir(path.join(this.dataDir, 'history'), { recursive: true });

      // Load existing snapshots
      await this.loadSnapshots();

      // Load rollback history
      await this.loadHistory();

      this.initialized = true;
      logger.info('Rollback manager initialized', { dataDir: this.dataDir });
    } catch (error) {
      logger.error('Failed to initialize rollback manager:', error);
      throw error;
    }
  }

  // --------------------------------------------------------------------------
  // Snapshots
  // --------------------------------------------------------------------------

  /**
   * Create a snapshot of current configuration
   */
  async createSnapshot(
    target: string,
    data: Record<string, unknown>,
    description?: string
  ): Promise<ConfigSnapshot> {
    const snapshot: ConfigSnapshot = {
      id: `snap_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      timestamp: new Date(),
      target,
      description: description || `Snapshot of ${target}`,
      data,
      hash: this.hashData(data),
    };

    this.snapshots.set(snapshot.id, snapshot);

    // Save to disk
    await this.saveSnapshot(snapshot);

    // Prune old snapshots for this target
    await this.pruneSnapshots(target);

    logger.debug('Snapshot created', { id: snapshot.id, target });
    this.emit('snapshot:created', snapshot);

    return snapshot;
  }

  /**
   * Get snapshots for a target
   */
  getSnapshotsForTarget(target: string): ConfigSnapshot[] {
    return Array.from(this.snapshots.values())
      .filter((s) => s.target === target)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  /**
   * Get the latest snapshot for a target
   */
  getLatestSnapshot(target: string): ConfigSnapshot | null {
    const snapshots = this.getSnapshotsForTarget(target);
    return snapshots.length > 0 ? snapshots[0] : null;
  }

  /**
   * Get a specific snapshot
   */
  getSnapshot(id: string): ConfigSnapshot | null {
    return this.snapshots.get(id) || null;
  }

  /**
   * Check if current data matches a snapshot
   */
  matchesSnapshot(target: string, data: Record<string, unknown>): boolean {
    const latest = this.getLatestSnapshot(target);
    if (!latest) return false;

    return this.hashData(data) === latest.hash;
  }

  // --------------------------------------------------------------------------
  // Rollback Operations
  // --------------------------------------------------------------------------

  /**
   * Rollback to a previous snapshot
   */
  async rollback(options: RollbackOptions = {}): Promise<RollbackRecord> {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { target, snapshotId, force: _force } = options;

    let targetSnapshot: ConfigSnapshot | null = null;
    let currentSnapshotId = '';

    if (snapshotId) {
      // Rollback to specific snapshot
      targetSnapshot = this.getSnapshot(snapshotId);
      if (!targetSnapshot) {
        throw new Error(`Snapshot not found: ${snapshotId}`);
      }
    } else if (target) {
      // Rollback target to previous version
      const snapshots = this.getSnapshotsForTarget(target);
      if (snapshots.length < 2) {
        throw new Error(`No previous version available for ${target}`);
      }
      currentSnapshotId = snapshots[0].id;
      targetSnapshot = snapshots[1]; // Second most recent
    } else {
      throw new Error('Must specify either target or snapshotId');
    }

    // Get current snapshot ID if not already set
    if (!currentSnapshotId && targetSnapshot) {
      const currentSnapshots = this.getSnapshotsForTarget(targetSnapshot.target);
      currentSnapshotId = currentSnapshots[0]?.id || 'unknown';
    }

    // Perform rollback
    const restorePath = path.join(
      this.dataDir,
      '..',
      'optimizer',
      'config',
      `${targetSnapshot.target}.json`
    );
    await fs.writeFile(restorePath, JSON.stringify(targetSnapshot.data, null, 2), 'utf-8');

    // Create rollback record
    const record: RollbackRecord = {
      id: `rollback_${Date.now()}`,
      timestamp: new Date(),
      fromSnapshotId: currentSnapshotId,
      toSnapshotId: targetSnapshot.id,
      reason: options.force ? 'Manual rollback' : 'User-initiated rollback',
      automatic: false,
      restoredTargets: [targetSnapshot.target],
    };

    this.rollbackHistory.push(record);
    await this.saveRollbackRecord(record);

    logger.info('Rollback completed', {
      target: targetSnapshot.target,
      from: currentSnapshotId,
      to: targetSnapshot.id,
    });

    this.emit('rollback:completed', record);

    return record;
  }

  /**
   * Rollback all changes from today
   */
  async rollbackToday(): Promise<RollbackRecord[]> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const records: RollbackRecord[] = [];

    // Find all targets that were modified today
    const modifiedToday = new Map<string, ConfigSnapshot>();
    for (const snapshot of this.snapshots.values()) {
      if (snapshot.timestamp >= today) {
        const existing = modifiedToday.get(snapshot.target);
        if (!existing || snapshot.timestamp > existing.timestamp) {
          modifiedToday.set(snapshot.target, snapshot);
        }
      }
    }

    // Rollback each target
    for (const [target] of modifiedToday) {
      const snapshots = this.getSnapshotsForTarget(target);
      const beforeToday = snapshots.find((s) => s.timestamp < today);

      if (beforeToday) {
        const record = await this.rollback({
          snapshotId: beforeToday.id,
          force: true,
        });
        records.push(record);
      }
    }

    return records;
  }

  /**
   * Automatic rollback when performance degrades
   */
  async autoRollback(
    target: string,
    reason: string,
    degradationPercent: number
  ): Promise<RollbackRecord | null> {
    const snapshots = this.getSnapshotsForTarget(target);
    if (snapshots.length < 2) {
      logger.warn('Cannot auto-rollback: no previous version', { target });
      return null;
    }

    const targetSnapshot = snapshots[1];

    // Perform rollback
    const restorePath = path.join(this.dataDir, '..', 'optimizer', 'config', `${target}.json`);
    await fs.writeFile(restorePath, JSON.stringify(targetSnapshot.data, null, 2), 'utf-8');

    // Create record
    const record: RollbackRecord = {
      id: `rollback_${Date.now()}`,
      timestamp: new Date(),
      fromSnapshotId: snapshots[0].id,
      toSnapshotId: targetSnapshot.id,
      reason: `Auto-rollback: ${reason} (${degradationPercent.toFixed(1)}% degradation)`,
      automatic: true,
      restoredTargets: [target],
    };

    this.rollbackHistory.push(record);
    await this.saveRollbackRecord(record);

    logger.warn('Auto-rollback performed', {
      target,
      reason,
      degradationPercent,
    });

    this.emit('rollback:auto', record);

    return record;
  }

  // --------------------------------------------------------------------------
  // History
  // --------------------------------------------------------------------------

  /**
   * Get rollback history
   */
  getHistory(limit: number = 50): RollbackRecord[] {
    return this.rollbackHistory.slice(-limit);
  }

  /**
   * Get rollback history for a target
   */
  getHistoryForTarget(target: string): RollbackRecord[] {
    return this.rollbackHistory.filter((r) => r.restoredTargets.includes(target));
  }

  // --------------------------------------------------------------------------
  // Persistence
  // --------------------------------------------------------------------------

  private async saveSnapshot(snapshot: ConfigSnapshot): Promise<void> {
    const filePath = path.join(this.dataDir, 'snapshots', `${snapshot.id}.json`);
    await fs.writeFile(filePath, JSON.stringify(snapshot, null, 2), 'utf-8');
  }

  private async saveRollbackRecord(record: RollbackRecord): Promise<void> {
    const dateStr = isoDate(record.timestamp);
    const filePath = path.join(this.dataDir, 'history', `${dateStr}.jsonl`);
    await fs.appendFile(filePath, JSON.stringify(record) + '\n', 'utf-8');
  }

  private async loadSnapshots(): Promise<void> {
    try {
      const files = await fs.readdir(path.join(this.dataDir, 'snapshots'));
      for (const file of files) {
        if (file.endsWith('.json')) {
          const content = await fs.readFile(path.join(this.dataDir, 'snapshots', file), 'utf-8');
          const snapshot = JSON.parse(content) as ConfigSnapshot;
          snapshot.timestamp = new Date(snapshot.timestamp);
          this.snapshots.set(snapshot.id, snapshot);
        }
      }
      logger.debug('Loaded snapshots', { count: this.snapshots.size });
    } catch {
      // Directory doesn't exist
    }
  }

  private async loadHistory(): Promise<void> {
    try {
      const files = await fs.readdir(path.join(this.dataDir, 'history'));
      const recentFiles = files.sort().slice(-30); // Last 30 days

      for (const file of recentFiles) {
        const content = await fs.readFile(path.join(this.dataDir, 'history', file), 'utf-8');
        const lines = content.split('\n').filter((l) => l.trim());

        for (const line of lines) {
          try {
            const record = JSON.parse(line) as RollbackRecord;
            record.timestamp = new Date(record.timestamp);
            this.rollbackHistory.push(record);
          } catch {
            // Skip malformed lines
          }
        }
      }
      logger.debug('Loaded rollback history', { count: this.rollbackHistory.length });
    } catch {
      // Directory doesn't exist
    }
  }

  private async pruneSnapshots(target: string): Promise<void> {
    const snapshots = this.getSnapshotsForTarget(target);
    if (snapshots.length <= this.MAX_SNAPSHOTS_PER_TARGET) return;

    // Remove oldest snapshots
    const toRemove = snapshots.slice(this.MAX_SNAPSHOTS_PER_TARGET);
    for (const snapshot of toRemove) {
      this.snapshots.delete(snapshot.id);
      try {
        await fs.unlink(path.join(this.dataDir, 'snapshots', `${snapshot.id}.json`));
      } catch {
        // File might already be deleted
      }
    }

    logger.debug('Pruned old snapshots', { target, removed: toRemove.length });
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  private hashData(data: Record<string, unknown>): string {
    const str = JSON.stringify(data, Object.keys(data).sort());
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(16);
  }

  // --------------------------------------------------------------------------
  // Cleanup
  // --------------------------------------------------------------------------

  async cleanup(): Promise<void> {
    this.snapshots.clear();
    this.rollbackHistory = [];
    this.initialized = false;
    logger.info('Rollback manager cleaned up');
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

let rollbackInstance: RollbackManager | null = null;

export function getRollbackManager(): RollbackManager {
  if (!rollbackInstance) {
    rollbackInstance = new RollbackManager();
  }
  return rollbackInstance;
}

export default RollbackManager;
