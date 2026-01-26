/**
 * GEPA Optimization Scheduler
 *
 * Schedules and runs optimization cycles, typically overnight.
 * Manages the timing of analysis, proposal generation, application,
 * and validation of improvements.
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import * as fs from 'fs/promises';
import * as path from 'path';
import { getConfig } from '../config';
import { getGEPAOptimizer, OptimizationReport } from './optimizer';
import { getEvaluationFramework } from './eval-framework';
import { getMetricsCollector } from './metrics-collector';
import { isoDate } from '../../shared/utils';

const logger = createModuleLogger('GEPA-Scheduler');

// ============================================================================
// Types
// ============================================================================

/**
 * Scheduled job types
 */
export type JobType =
  | 'nightly_optimization' // Full optimization cycle
  | 'validation' // Validate applied optimizations
  | 'metrics_collection' // Collect metrics snapshot
  | 'report_generation' // Generate user report
  | 'cleanup'; // Clean old data

/**
 * Scheduled job configuration
 */
export interface ScheduledJob {
  id: string;
  type: JobType;
  cronExpression?: string;
  hour: number; // Hour of day (0-23)
  minute: number; // Minute (0-59)
  enabled: boolean;
  lastRun?: Date;
  nextRun?: Date;
  lastResult?: 'success' | 'failure';
  lastError?: string;
}

/**
 * Job execution result
 */
export interface JobResult {
  jobId: string;
  type: JobType;
  startedAt: Date;
  completedAt: Date;
  success: boolean;
  error?: string;
  details?: Record<string, unknown>;
}

/**
 * Scheduler configuration
 */
export interface SchedulerConfig {
  enabled: boolean;
  timezone: string;
  nightlyHour: number; // Hour to run nightly optimization (default: 2 AM)
  validationInterval: number; // Hours between validation checks
  reportHour: number; // Hour to generate daily report
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_SCHEDULER_CONFIG: SchedulerConfig = {
  enabled: true,
  timezone: 'local',
  nightlyHour: 2, // 2 AM
  validationInterval: 6, // Every 6 hours
  reportHour: 7, // 7 AM
};

// ============================================================================
// Optimization Scheduler
// ============================================================================

export class OptimizationScheduler extends EventEmitter {
  private config: SchedulerConfig;
  private dataDir: string;
  private jobs: Map<string, ScheduledJob> = new Map();
  private timers: Map<string, NodeJS.Timeout> = new Map();
  private jobHistory: JobResult[] = [];
  private initialized = false;
  private running = false;

  // Maximum job history to keep in memory
  private readonly MAX_HISTORY = 100;

  constructor(config?: Partial<SchedulerConfig>) {
    super();
    this.setMaxListeners(20);
    this.config = { ...DEFAULT_SCHEDULER_CONFIG, ...config };
    this.dataDir = '';
  }

  // --------------------------------------------------------------------------
  // Initialization
  // --------------------------------------------------------------------------

  /**
   * Initialize the scheduler
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      const appConfig = getConfig();
      const atlasDir = path.dirname(appConfig.logDir);
      this.dataDir = path.join(atlasDir, 'gepa', 'scheduler');

      await fs.mkdir(path.join(this.dataDir, 'history'), { recursive: true });

      // Set up default jobs
      this.setupDefaultJobs();

      // Load job history
      await this.loadHistory();

      this.initialized = true;
      logger.info('Optimization scheduler initialized', { dataDir: this.dataDir });
    } catch (error) {
      logger.error('Failed to initialize scheduler:', error);
      throw error;
    }
  }

  /**
   * Start the scheduler
   */
  start(): void {
    if (this.running) return;
    if (!this.config.enabled) {
      logger.info('Scheduler is disabled');
      return;
    }

    this.running = true;
    this.scheduleAllJobs();
    logger.info('Optimization scheduler started');
    this.emit('scheduler:started');
  }

  /**
   * Stop the scheduler
   */
  stop(): void {
    if (!this.running) return;

    this.running = false;

    // Clear all timers
    for (const [, timer] of this.timers) {
      clearTimeout(timer);
    }
    this.timers.clear();

    logger.info('Optimization scheduler stopped');
    this.emit('scheduler:stopped');
  }

  // --------------------------------------------------------------------------
  // Job Setup
  // --------------------------------------------------------------------------

  /**
   * Set up default scheduled jobs
   */
  private setupDefaultJobs(): void {
    // Nightly optimization
    this.jobs.set('nightly_optimization', {
      id: 'nightly_optimization',
      type: 'nightly_optimization',
      hour: this.config.nightlyHour,
      minute: 0,
      enabled: true,
    });

    // Validation checks
    this.jobs.set('validation', {
      id: 'validation',
      type: 'validation',
      hour: 8, // Run at 8 AM
      minute: 0,
      enabled: true,
    });

    // Morning report
    this.jobs.set('report_generation', {
      id: 'report_generation',
      type: 'report_generation',
      hour: this.config.reportHour,
      minute: 30,
      enabled: true,
    });

    // Daily cleanup
    this.jobs.set('cleanup', {
      id: 'cleanup',
      type: 'cleanup',
      hour: 3, // 3 AM
      minute: 30,
      enabled: true,
    });

    logger.debug('Default jobs configured', { count: this.jobs.size });
  }

  /**
   * Schedule all enabled jobs
   */
  private scheduleAllJobs(): void {
    for (const [, job] of this.jobs) {
      if (job.enabled) {
        this.scheduleJob(job);
      }
    }
  }

  /**
   * Schedule a single job
   */
  private scheduleJob(job: ScheduledJob): void {
    // Calculate time until next run
    const now = new Date();
    const nextRun = new Date(now);
    nextRun.setHours(job.hour, job.minute, 0, 0);

    // If the time has passed today, schedule for tomorrow
    if (nextRun <= now) {
      nextRun.setDate(nextRun.getDate() + 1);
    }

    job.nextRun = nextRun;
    const msUntilRun = nextRun.getTime() - now.getTime();

    // Clear existing timer
    const existingTimer = this.timers.get(job.id);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Schedule the job
    const timer = setTimeout(async () => {
      await this.executeJob(job);

      // Reschedule for next day if still running
      if (this.running && job.enabled) {
        this.scheduleJob(job);
      }
    }, msUntilRun);

    this.timers.set(job.id, timer);

    logger.debug('Job scheduled', {
      id: job.id,
      nextRun: nextRun.toISOString(),
      msUntilRun,
    });
  }

  // --------------------------------------------------------------------------
  // Job Execution
  // --------------------------------------------------------------------------

  /**
   * Execute a job
   */
  private async executeJob(job: ScheduledJob): Promise<JobResult> {
    const startedAt = new Date();
    logger.info('Starting job', { id: job.id, type: job.type });
    this.emit('job:started', job);

    let success = true;
    let error: string | undefined;
    let details: Record<string, unknown> = {};

    try {
      switch (job.type) {
        case 'nightly_optimization':
          details = await this.runNightlyOptimization();
          break;
        case 'validation':
          details = await this.runValidation();
          break;
        case 'report_generation':
          details = await this.runReportGeneration();
          break;
        case 'cleanup':
          details = await this.runCleanup();
          break;
        default:
          throw new Error(`Unknown job type: ${job.type}`);
      }
    } catch (err) {
      success = false;
      error = err instanceof Error ? err.message : String(err);
      logger.error('Job failed', { id: job.id, error });
    }

    const result: JobResult = {
      jobId: job.id,
      type: job.type,
      startedAt,
      completedAt: new Date(),
      success,
      error,
      details,
    };

    // Update job state
    job.lastRun = startedAt;
    job.lastResult = success ? 'success' : 'failure';
    job.lastError = error;

    // Store result
    this.jobHistory.push(result);
    if (this.jobHistory.length > this.MAX_HISTORY) {
      this.jobHistory.shift();
    }

    // Persist result
    await this.saveJobResult(result);

    logger.info('Job completed', {
      id: job.id,
      success,
      durationMs: result.completedAt.getTime() - startedAt.getTime(),
    });

    this.emit('job:completed', result);

    return result;
  }

  /**
   * Run nightly optimization cycle
   */
  private async runNightlyOptimization(): Promise<Record<string, unknown>> {
    const optimizer = getGEPAOptimizer();
    await optimizer.initialize();

    // Step 1: Analyze performance
    logger.info('Nightly optimization: Analyzing performance');
    const analysis = await optimizer.analyzePerformance(7);

    // Step 2: Generate proposals
    logger.info('Nightly optimization: Generating proposals');
    const proposals = await optimizer.generateProposals();

    // Step 3: Auto-apply high-confidence, low-risk proposals
    let applied = 0;
    for (const proposal of proposals) {
      // Only auto-apply if configured and high confidence
      if (proposal.confidence >= 0.9 && proposal.priority !== 'critical') {
        try {
          await optimizer.applyOptimization(proposal.id);
          applied++;
        } catch (err) {
          logger.warn('Failed to auto-apply proposal', {
            id: proposal.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    // Step 4: Validate previously applied optimizations
    await optimizer.validateAppliedOptimizations();

    return {
      opportunities: analysis.opportunities.length,
      patterns: analysis.patterns.length,
      proposalsGenerated: proposals.length,
      proposalsApplied: applied,
    };
  }

  /**
   * Run validation check
   */
  private async runValidation(): Promise<Record<string, unknown>> {
    const optimizer = getGEPAOptimizer();
    await optimizer.initialize();

    // Validate all pending optimizations
    await optimizer.validateAppliedOptimizations();

    const applied = optimizer.getAppliedOptimizations();
    const validated = applied.filter((a) => a.status === 'validated').length;
    const rolledBack = applied.filter((a) => a.status === 'rolled_back').length;

    return { validated, rolledBack, pending: applied.length - validated - rolledBack };
  }

  /**
   * Run report generation
   */
  private async runReportGeneration(): Promise<Record<string, unknown>> {
    const optimizer = getGEPAOptimizer();
    await optimizer.initialize();

    const report = await optimizer.generateReport();

    return {
      reportId: report.id,
      successRate: report.metricsAnalysis.successRate,
      proposalsGenerated: report.proposalsGenerated,
      improvements: report.improvements.length,
    };
  }

  /**
   * Run cleanup of old data
   */
  private async runCleanup(): Promise<Record<string, unknown>> {
    const evalFramework = getEvaluationFramework();
    const metricsCollector = getMetricsCollector();

    // Flush pending writes
    await evalFramework.cleanup();
    await metricsCollector.cleanup();

    // Re-initialize for continued operation
    await evalFramework.initialize();
    await metricsCollector.initialize();

    // Clean old history files (keep 30 days)
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 30);

    let filesDeleted = 0;
    try {
      const historyFiles = await fs.readdir(path.join(this.dataDir, 'history'));
      for (const file of historyFiles) {
        const match = file.match(/^(\d{4}-\d{2}-\d{2})/);
        if (match) {
          const fileDate = new Date(match[1]);
          if (fileDate < cutoffDate) {
            await fs.unlink(path.join(this.dataDir, 'history', file));
            filesDeleted++;
          }
        }
      }
    } catch {
      // Directory might not exist
    }

    return { filesDeleted };
  }

  // --------------------------------------------------------------------------
  // Manual Execution
  // --------------------------------------------------------------------------

  /**
   * Run optimization now (manual trigger)
   */
  async runNow(): Promise<OptimizationReport> {
    const optimizer = getGEPAOptimizer();
    await optimizer.initialize();

    // Generate proposals
    await optimizer.generateProposals();

    // Generate and return report
    return optimizer.generateReport();
  }

  /**
   * Run a specific job manually
   */
  async runJobNow(jobId: string): Promise<JobResult | null> {
    const job = this.jobs.get(jobId);
    if (!job) {
      logger.warn('Job not found', { jobId });
      return null;
    }

    return this.executeJob(job);
  }

  // --------------------------------------------------------------------------
  // History
  // --------------------------------------------------------------------------

  /**
   * Get job history
   */
  getHistory(limit: number = 50): JobResult[] {
    return this.jobHistory.slice(-limit);
  }

  /**
   * Get last report
   */
  getLastReport(): OptimizationReport | null {
    const reportJobs = this.jobHistory.filter((j) => j.type === 'report_generation' && j.success);
    if (reportJobs.length === 0) return null;

    // Load the report from disk
    const lastJob = reportJobs[reportJobs.length - 1];
    const reportId = lastJob.details?.reportId as string | undefined;
    if (!reportId) return null;

    // Report loading would be async, so we return null here
    // In practice, you'd want to cache the last report
    return null;
  }

  /**
   * Save job result to disk
   */
  private async saveJobResult(result: JobResult): Promise<void> {
    const dateStr = isoDate(result.startedAt);
    const filePath = path.join(this.dataDir, 'history', `${dateStr}.jsonl`);

    const line = JSON.stringify(result) + '\n';
    await fs.appendFile(filePath, line, 'utf-8');
  }

  /**
   * Load job history from disk
   */
  private async loadHistory(): Promise<void> {
    try {
      const files = await fs.readdir(path.join(this.dataDir, 'history'));
      const recentFiles = files.sort().slice(-7); // Last 7 days

      for (const file of recentFiles) {
        const content = await fs.readFile(path.join(this.dataDir, 'history', file), 'utf-8');
        const lines = content.split('\n').filter((l) => l.trim());

        for (const line of lines) {
          try {
            const result = JSON.parse(line) as JobResult;
            result.startedAt = new Date(result.startedAt);
            result.completedAt = new Date(result.completedAt);
            this.jobHistory.push(result);
          } catch {
            // Skip malformed lines
          }
        }
      }

      // Trim to max
      while (this.jobHistory.length > this.MAX_HISTORY) {
        this.jobHistory.shift();
      }

      logger.debug('Loaded job history', { count: this.jobHistory.length });
    } catch {
      // Directory doesn't exist yet
    }
  }

  // --------------------------------------------------------------------------
  // Configuration
  // --------------------------------------------------------------------------

  /**
   * Update scheduler configuration
   */
  updateConfig(config: Partial<SchedulerConfig>): void {
    this.config = { ...this.config, ...config };

    // Reschedule jobs if running
    if (this.running) {
      this.stop();
      this.setupDefaultJobs();
      this.start();
    }
  }

  /**
   * Enable or disable a job
   */
  setJobEnabled(jobId: string, enabled: boolean): void {
    const job = this.jobs.get(jobId);
    if (!job) return;

    job.enabled = enabled;

    if (this.running) {
      if (enabled) {
        this.scheduleJob(job);
      } else {
        const timer = this.timers.get(jobId);
        if (timer) {
          clearTimeout(timer);
          this.timers.delete(jobId);
        }
      }
    }

    logger.info('Job enabled state changed', { jobId, enabled });
  }

  /**
   * Get all jobs
   */
  getJobs(): ScheduledJob[] {
    return Array.from(this.jobs.values());
  }

  // --------------------------------------------------------------------------
  // Cleanup
  // --------------------------------------------------------------------------

  /**
   * Cleanup scheduler
   */
  async cleanup(): Promise<void> {
    this.stop();
    this.jobs.clear();
    this.jobHistory = [];
    this.initialized = false;
    logger.info('Optimization scheduler cleaned up');
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

let schedulerInstance: OptimizationScheduler | null = null;

export function getOptimizationScheduler(): OptimizationScheduler {
  if (!schedulerInstance) {
    schedulerInstance = new OptimizationScheduler();
  }
  return schedulerInstance;
}

export default OptimizationScheduler;
