/**
 * Memory Optimizer - Aggressive memory management for low-RAM systems
 * Target: Run efficiently on systems with limited RAM (3-4GB free)
 */

import { app } from 'electron';
import { createModuleLogger } from './logger';
import { sleep } from '../../shared/utils';

const logger = createModuleLogger('MemoryOptimizer');

interface MemoryStats {
  heapUsed: number;
  heapTotal: number;
  external: number;
  rss: number;
  arrayBuffers: number;
}

interface MemoryThresholds {
  warning: number;  // MB - start cleanup
  critical: number; // MB - aggressive cleanup
  emergency: number; // MB - emergency measures
}

type CleanupCallback = () => Promise<void> | void;

class MemoryOptimizer {
  private static instance: MemoryOptimizer;
  private cleanupCallbacks: Map<string, CleanupCallback> = new Map();
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;
  private lastCleanup = 0;
  private cleanupCooldown = 30000; // 30s between cleanups

  private thresholds: MemoryThresholds = {
    warning: 400,   // Start cleanup at 400MB
    critical: 600,  // Aggressive cleanup at 600MB
    emergency: 800, // Emergency at 800MB
  };

  private constructor() {}

  static getInstance(): MemoryOptimizer {
    if (!MemoryOptimizer.instance) {
      MemoryOptimizer.instance = new MemoryOptimizer();
    }
    return MemoryOptimizer.instance;
  }

  /**
   * Start memory monitoring
   */
  start(intervalMs = 10000): void {
    if (this.isRunning) return;

    logger.info('Starting memory optimizer', { 
      intervalMs,
      thresholds: this.thresholds 
    });

    this.isRunning = true;
    this.intervalId = setInterval(() => this.checkMemory(), intervalMs);

    // Initial check
    this.checkMemory();
  }

  /**
   * Stop memory monitoring
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    logger.info('Memory optimizer stopped');
  }

  /**
   * Register a cleanup callback
   */
  registerCleanup(name: string, callback: CleanupCallback): void {
    this.cleanupCallbacks.set(name, callback);
    logger.debug('Registered cleanup callback', { name });
  }

  /**
   * Unregister a cleanup callback
   */
  unregisterCleanup(name: string): void {
    this.cleanupCallbacks.delete(name);
  }

  /**
   * Get current memory stats
   */
  getStats(): MemoryStats {
    const mem = process.memoryUsage();
    return {
      heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
      external: Math.round(mem.external / 1024 / 1024),
      rss: Math.round(mem.rss / 1024 / 1024),
      arrayBuffers: Math.round(mem.arrayBuffers / 1024 / 1024),
    };
  }

  /**
   * Check memory and trigger cleanup if needed
   */
  private async checkMemory(): Promise<void> {
    const stats = this.getStats();
    const heapMB = stats.heapUsed;

    if (heapMB >= this.thresholds.emergency) {
      logger.warn('Emergency memory cleanup triggered', { heapMB });
      await this.emergencyCleanup();
    } else if (heapMB >= this.thresholds.critical) {
      logger.warn('Critical memory cleanup triggered', { heapMB });
      await this.aggressiveCleanup();
    } else if (heapMB >= this.thresholds.warning) {
      await this.standardCleanup();
    }
  }

  /**
   * Standard cleanup - run registered callbacks + GC
   */
  private async standardCleanup(): Promise<void> {
    const now = Date.now();
    if (now - this.lastCleanup < this.cleanupCooldown) return;
    this.lastCleanup = now;

    logger.debug('Running standard cleanup');
    
    // Run registered cleanup callbacks
    for (const [name, callback] of this.cleanupCallbacks) {
      try {
        await callback();
      } catch (error) {
        logger.error(`Cleanup callback ${name} failed`, error);
      }
    }

    // Request GC if available
    this.requestGC();
  }

  /**
   * Aggressive cleanup - clear caches, drop references
   */
  private async aggressiveCleanup(): Promise<void> {
    logger.info('Running aggressive memory cleanup');

    // Clear module caches where safe
    this.clearModuleCaches();

    // Run all registered cleanups
    await this.standardCleanup();

    // Force GC multiple times
    for (let i = 0; i < 3; i++) {
      this.requestGC();
      await sleep(100);
    }
  }

  /**
   * Emergency cleanup - last resort measures
   */
  private async emergencyCleanup(): Promise<void> {
    logger.warn('Running EMERGENCY memory cleanup');

    // Aggressive cleanup first
    await this.aggressiveCleanup();

    // Clear all caches
    this.clearAllCaches();

    // Multiple GC cycles
    for (let i = 0; i < 5; i++) {
      this.requestGC();
      await sleep(200);
    }

    const afterStats = this.getStats();
    logger.info('Emergency cleanup complete', { heapMB: afterStats.heapUsed });
  }

  /**
   * Request garbage collection
   */
  private requestGC(): void {
    if (global.gc) {
      try {
        global.gc();
      } catch {
        // GC not exposed - ignore
      }
    }
  }

  /**
   * Clear module caches
   */
  private clearModuleCaches(): void {
    // Clear require cache for non-essential modules
    const safeToClear = [
      'marked',
      'highlight.js',
      'prettier',
    ];

    for (const key of Object.keys(require.cache)) {
      if (safeToClear.some(mod => key.includes(mod))) {
        delete require.cache[key];
      }
    }
  }

  /**
   * Clear all application caches
   */
  private clearAllCaches(): void {
    // Clear HTTP cache
    try {
      const session = require('electron').session;
      session.defaultSession?.clearCache();
    } catch {
      // Session may not be available
    }

    // Clear storage data
    try {
      const session = require('electron').session;
      session.defaultSession?.clearStorageData({
        storages: ['cachestorage', 'shadercache'],
      });
    } catch {
      // May fail - ignore
    }
  }

  /**
   * Force immediate cleanup
   */
  async forceCleanup(): Promise<void> {
    this.lastCleanup = 0; // Reset cooldown
    await this.aggressiveCleanup();
  }

  /**
   * Set custom thresholds
   */
  setThresholds(thresholds: Partial<MemoryThresholds>): void {
    this.thresholds = { ...this.thresholds, ...thresholds };
    logger.info('Memory thresholds updated', { thresholds: this.thresholds });
  }
}

// Export singleton getter
export function getMemoryOptimizer(): MemoryOptimizer {
  return MemoryOptimizer.getInstance();
}

// Export types
export type { MemoryStats, MemoryThresholds };
