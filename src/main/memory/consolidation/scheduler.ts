/**
 * Atlas Desktop - Consolidation Scheduler
 * Manages automatic memory consolidation and cleanup
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../../utils/logger';
import { getVectorStore, VectorDocument, CleanupResult } from '../vector-store';
import { getImportanceScorer, ScoredMemory } from '../importance-scorer';
import { getMemorySummarizer } from './summarizer';

const logger = createModuleLogger('ConsolidationScheduler');

/**
 * Scheduler configuration
 */
export interface SchedulerConfig {
  /** Consolidation interval in ms (default: 1 hour) */
  consolidationIntervalMs: number;
  /** Idle time before triggering consolidation (ms) */
  idleConsolidationMs: number;
  /** Daily consolidation hour (0-23, -1 to disable) */
  dailyConsolidationHour: number;
  /** Maximum memories to process per consolidation run */
  maxMemoriesPerRun: number;
  /** Minimum importance threshold for keeping original */
  minImportanceToKeep: number;
  /** Enable automatic consolidation */
  enableAutoConsolidation: boolean;
  /** Enable automatic cleanup */
  enableAutoCleanup: boolean;
}

const DEFAULT_CONFIG: SchedulerConfig = {
  consolidationIntervalMs: 3600000, // 1 hour
  idleConsolidationMs: 300000, // 5 minutes idle
  dailyConsolidationHour: 3, // 3 AM
  maxMemoriesPerRun: 100,
  minImportanceToKeep: 0.6,
  enableAutoConsolidation: true,
  enableAutoCleanup: true,
};

/**
 * Consolidation result
 */
export interface ConsolidationResult {
  /** Memories scored */
  memoriesScored: number;
  /** Memories summarized */
  memoriesSummarized: number;
  /** Summaries created */
  summariesCreated: number;
  /** Memories removed */
  memoriesRemoved: number;
  /** Duration in ms */
  durationMs: number;
  /** Timestamp */
  timestamp: number;
}

/**
 * Scheduler events
 */
export interface SchedulerEvents {
  'consolidation-started': (reason: string) => void;
  'consolidation-completed': (result: ConsolidationResult) => void;
  'cleanup-completed': (result: CleanupResult) => void;
  'idle-detected': () => void;
  error: (error: Error) => void;
}

/**
 * Consolidation Scheduler
 * Manages automatic memory consolidation
 */
export class ConsolidationScheduler extends EventEmitter {
  private config: SchedulerConfig;
  private consolidationTimer: NodeJS.Timeout | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private dailyTimer: NodeJS.Timeout | null = null;
  private lastActivityTime = Date.now();
  private isRunning = false;
  private lastConsolidation: ConsolidationResult | null = null;

  constructor(config?: Partial<SchedulerConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    logger.info('ConsolidationScheduler created', { config: this.config });
  }

  /**
   * Start the scheduler
   */
  start(): void {
    if (this.consolidationTimer) {
      logger.warn('Scheduler already running');
      return;
    }

    // Start periodic consolidation timer
    if (this.config.enableAutoConsolidation) {
      this.consolidationTimer = setInterval(
        () => this.runConsolidation('periodic'),
        this.config.consolidationIntervalMs
      );
    }

    // Schedule daily consolidation
    if (this.config.dailyConsolidationHour >= 0) {
      this.scheduleDailyConsolidation();
    }

    // Start idle detection
    this.resetIdleTimer();

    logger.info('ConsolidationScheduler started');
  }

  /**
   * Stop the scheduler
   */
  stop(): void {
    if (this.consolidationTimer) {
      clearInterval(this.consolidationTimer);
      this.consolidationTimer = null;
    }
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.dailyTimer) {
      clearTimeout(this.dailyTimer);
      this.dailyTimer = null;
    }

    logger.info('ConsolidationScheduler stopped');
  }

  /**
   * Record activity (resets idle timer)
   */
  recordActivity(): void {
    this.lastActivityTime = Date.now();
    this.resetIdleTimer();
  }

  /**
   * Reset idle timer
   */
  private resetIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }

    if (this.config.enableAutoConsolidation) {
      this.idleTimer = setTimeout(() => {
        this.emit('idle-detected');
        this.runConsolidation('idle');
      }, this.config.idleConsolidationMs);
    }
  }

  /**
   * Schedule daily consolidation
   */
  private scheduleDailyConsolidation(): void {
    const now = new Date();
    const target = new Date();
    target.setHours(this.config.dailyConsolidationHour, 0, 0, 0);

    // If target time has passed today, schedule for tomorrow
    if (target.getTime() <= now.getTime()) {
      target.setDate(target.getDate() + 1);
    }

    const delay = target.getTime() - now.getTime();

    this.dailyTimer = setTimeout(() => {
      this.runConsolidation('daily');
      // Reschedule for next day
      this.scheduleDailyConsolidation();
    }, delay);

    logger.debug('Daily consolidation scheduled', {
      targetTime: target.toISOString(),
      delayMs: delay,
    });
  }

  /**
   * Run consolidation process
   */
  async runConsolidation(reason: string): Promise<ConsolidationResult> {
    if (this.isRunning) {
      logger.warn('Consolidation already in progress');
      return this.lastConsolidation || this.createEmptyResult();
    }

    this.isRunning = true;
    this.emit('consolidation-started', reason);
    const startTime = Date.now();

    try {
      const vectorStore = await getVectorStore();
      const scorer = getImportanceScorer();
      const summarizer = getMemorySummarizer();

      let memoriesScored = 0;
      let memoriesSummarized = 0;
      let summariesCreated = 0;
      let memoriesRemoved = 0;

      // Get documents to process
      const allDocs = vectorStore.getByRecency(this.config.maxMemoriesPerRun);

      // Score all memories
      const scoredMemories: Array<{ doc: VectorDocument; scored: ScoredMemory }> = [];
      for (const doc of allDocs) {
        const entry = {
          id: doc.id,
          type: 'context' as const,
          content: doc.content,
          createdAt: doc.createdAt,
          accessedAt: doc.accessedAt,
          importance: doc.metadata.importance,
        };
        const scored = scorer.scoreMemory(entry);
        scoredMemories.push({ doc, scored });
        memoriesScored++;
      }

      // Group low-importance memories by topic for summarization
      const lowImportanceByTopic: Map<string, VectorDocument[]> = new Map();

      for (const { doc, scored } of scoredMemories) {
        if (scored.finalScore < this.config.minImportanceToKeep && !doc.metadata.isSummary) {
          const topics = doc.metadata.topics || ['general'];
          for (const topic of topics) {
            if (!lowImportanceByTopic.has(topic)) {
              lowImportanceByTopic.set(topic, []);
            }
            lowImportanceByTopic.get(topic)!.push(doc);
          }
        }
      }

      // Summarize topic groups
      for (const [topic, docs] of lowImportanceByTopic) {
        if (docs.length < 2) continue; // Need at least 2 to summarize

        const result = summarizer.summarizeGroup(docs);
        memoriesSummarized += docs.length;

        // Create summary document
        const summaryMetadata = summarizer.createSummaryMetadata(result);
        await vectorStore.add(result.summary, summaryMetadata);
        summariesCreated++;

        // Remove original documents
        for (const doc of docs) {
          await vectorStore.delete(doc.id);
          memoriesRemoved++;
        }

        logger.debug('Topic summarized', {
          topic,
          documentsProcessed: docs.length,
          compressionRatio: result.compressionRatio.toFixed(2),
        });
      }

      // Run cleanup if enabled
      if (this.config.enableAutoCleanup) {
        const stats = await vectorStore.getStats();
        if (stats.capacityUsed > 0.8) {
          const cleanupResult = await vectorStore.runCleanup();
          this.emit('cleanup-completed', cleanupResult);
          memoriesRemoved += cleanupResult.removed;
        }
      }

      const result: ConsolidationResult = {
        memoriesScored,
        memoriesSummarized,
        summariesCreated,
        memoriesRemoved,
        durationMs: Date.now() - startTime,
        timestamp: Date.now(),
      };

      this.lastConsolidation = result;
      this.emit('consolidation-completed', result);

      logger.info('Consolidation completed', {
        reason,
        ...result,
      });

      return result;
    } catch (error) {
      this.emit('error', error as Error);
      logger.error('Consolidation failed', { error: (error as Error).message });
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Force immediate consolidation
   */
  async forceConsolidation(): Promise<ConsolidationResult> {
    return this.runConsolidation('forced');
  }

  /**
   * Get scheduler status
   */
  getStatus(): {
    isRunning: boolean;
    lastConsolidation: ConsolidationResult | null;
    timeSinceLastActivity: number;
    nextDailyConsolidation: number | null;
  } {
    let nextDaily: number | null = null;
    if (this.config.dailyConsolidationHour >= 0) {
      const now = new Date();
      const target = new Date();
      target.setHours(this.config.dailyConsolidationHour, 0, 0, 0);
      if (target.getTime() <= now.getTime()) {
        target.setDate(target.getDate() + 1);
      }
      nextDaily = target.getTime();
    }

    return {
      isRunning: this.isRunning,
      lastConsolidation: this.lastConsolidation,
      timeSinceLastActivity: Date.now() - this.lastActivityTime,
      nextDailyConsolidation: nextDaily,
    };
  }

  /**
   * Create empty result
   */
  private createEmptyResult(): ConsolidationResult {
    return {
      memoriesScored: 0,
      memoriesSummarized: 0,
      summariesCreated: 0,
      memoriesRemoved: 0,
      durationMs: 0,
      timestamp: Date.now(),
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<SchedulerConfig>): void {
    const wasRunning = !!this.consolidationTimer;
    if (wasRunning) {
      this.stop();
    }

    this.config = { ...this.config, ...config };
    logger.info('Scheduler config updated', { config: this.config });

    if (wasRunning) {
      this.start();
    }
  }

  // Type-safe event emitter methods
  on<K extends keyof SchedulerEvents>(event: K, listener: SchedulerEvents[K]): this {
    return super.on(event, listener);
  }

  off<K extends keyof SchedulerEvents>(event: K, listener: SchedulerEvents[K]): this {
    return super.off(event, listener);
  }

  emit<K extends keyof SchedulerEvents>(
    event: K,
    ...args: Parameters<SchedulerEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }
}

// Singleton instance
let scheduler: ConsolidationScheduler | null = null;

/**
 * Get or create the scheduler instance
 */
export function getConsolidationScheduler(
  config?: Partial<SchedulerConfig>
): ConsolidationScheduler {
  if (!scheduler) {
    scheduler = new ConsolidationScheduler(config);
  }
  return scheduler;
}

/**
 * Start the consolidation scheduler
 */
export function startConsolidationScheduler(config?: Partial<SchedulerConfig>): void {
  const sched = getConsolidationScheduler(config);
  sched.start();
}

/**
 * Stop the consolidation scheduler
 */
export function stopConsolidationScheduler(): void {
  if (scheduler) {
    scheduler.stop();
  }
}

export default ConsolidationScheduler;
