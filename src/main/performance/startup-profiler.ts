/**
 * Atlas Desktop - Startup Profiler
 * Comprehensive profiling and optimization for application startup time.
 *
 * Target Performance:
 * - Cold start: <3s
 * - Warm start: <1s
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('StartupProfiler');

/**
 * Startup phase identifiers
 */
export type StartupPhase =
  | 'process-start'
  | 'electron-init'
  | 'app-ready'
  | 'config-load'
  | 'logger-init'
  | 'window-create'
  | 'window-ready'
  | 'preload-execute'
  | 'renderer-init'
  | 'ipc-register'
  | 'tray-init'
  | 'warmup-start'
  | 'warmup-complete'
  | 'connectivity-init'
  | 'provider-init'
  | 'voice-pipeline-init'
  | 'first-paint'
  | 'interactive'
  | 'fully-loaded';

/**
 * Phase timing record
 */
export interface PhaseRecord {
  phase: StartupPhase;
  startTime: bigint;
  endTime?: bigint;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Module load timing
 */
export interface ModuleLoadRecord {
  modulePath: string;
  loadTimeMs: number;
  size?: number;
  dependencies?: string[];
}

/**
 * Startup metric record
 */
export interface StartupMetric {
  timestamp: string;
  sessionId: string;
  isWarmStart: boolean;
  totalDurationMs: number;
  phases: PhaseTimingSummary[];
  slowModules: ModuleLoadRecord[];
  memoryUsage: MemoryUsageSnapshot;
  recommendations: string[];
}

/**
 * Phase timing summary for reports
 */
export interface PhaseTimingSummary {
  phase: StartupPhase;
  durationMs: number;
  percentOfTotal: number;
  status: 'fast' | 'acceptable' | 'slow' | 'critical';
}

/**
 * Memory usage snapshot
 */
export interface MemoryUsageSnapshot {
  heapUsed: number;
  heapTotal: number;
  external: number;
  rss: number;
}

/**
 * Profiler configuration
 */
export interface ProfilerConfig {
  enabled: boolean;
  metricsDir: string;
  maxHistoryEntries: number;
  slowThresholds: Record<StartupPhase, number>;
  moduleTracking: boolean;
  autoReport: boolean;
}

/**
 * Startup timeline event
 */
export interface TimelineEvent {
  phase: StartupPhase;
  timestamp: number;
  type: 'start' | 'end';
  metadata?: Record<string, unknown>;
}

/**
 * Default slow thresholds per phase (in milliseconds)
 */
const DEFAULT_SLOW_THRESHOLDS: Record<StartupPhase, number> = {
  'process-start': 50,
  'electron-init': 500,
  'app-ready': 1000,
  'config-load': 50,
  'logger-init': 100,
  'window-create': 200,
  'window-ready': 500,
  'preload-execute': 100,
  'renderer-init': 300,
  'ipc-register': 50,
  'tray-init': 200,
  'warmup-start': 50,
  'warmup-complete': 2000,
  'connectivity-init': 100,
  'provider-init': 100,
  'voice-pipeline-init': 500,
  'first-paint': 1000,
  'interactive': 2000,
  'fully-loaded': 3000,
};

/**
 * Default profiler configuration
 */
const DEFAULT_CONFIG: ProfilerConfig = {
  enabled: true,
  metricsDir: join(homedir(), '.atlas', 'metrics'),
  maxHistoryEntries: 100,
  slowThresholds: DEFAULT_SLOW_THRESHOLDS,
  moduleTracking: true,
  autoReport: true,
};

/**
 * StartupProfiler - Comprehensive startup performance profiling
 */
export class StartupProfiler extends EventEmitter {
  private config: ProfilerConfig;
  private phases: Map<StartupPhase, PhaseRecord> = new Map();
  private moduleLoads: ModuleLoadRecord[] = [];
  private timeline: TimelineEvent[] = [];
  private sessionId: string;
  private processStartTime: bigint;
  private isWarmStart: boolean = false;
  private startupComplete: boolean = false;

  constructor(config: Partial<ProfilerConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.sessionId = this.generateSessionId();
    this.processStartTime = process.hrtime.bigint();

    // Ensure metrics directory exists
    if (this.config.enabled && !existsSync(this.config.metricsDir)) {
      mkdirSync(this.config.metricsDir, { recursive: true });
    }

    // Check for warm start indicator
    this.isWarmStart = this.checkWarmStart();

    // Record process start
    this.recordPhaseStart('process-start');
    this.recordPhaseEnd('process-start');
  }

  /**
   * Generate unique session ID
   */
  private generateSessionId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `atlas-${timestamp}-${random}`;
  }

  /**
   * Check if this is a warm start (app was recently run)
   */
  private checkWarmStart(): boolean {
    const warmStartFile = join(this.config.metricsDir, '.warm-start');
    try {
      if (existsSync(warmStartFile)) {
        const content = readFileSync(warmStartFile, 'utf-8');
        const lastRun = parseInt(content, 10);
        const timeSinceLastRun = Date.now() - lastRun;
        // Warm start if last run was within 5 minutes
        return timeSinceLastRun < 5 * 60 * 1000;
      }
    } catch {
      // Ignore errors
    }
    return false;
  }

  /**
   * Update warm start indicator
   */
  private updateWarmStartIndicator(): void {
    const warmStartFile = join(this.config.metricsDir, '.warm-start');
    try {
      writeFileSync(warmStartFile, Date.now().toString());
    } catch {
      // Ignore errors
    }
  }

  /**
   * Convert hrtime bigint to milliseconds
   */
  private hrtimeToMs(hrtime: bigint): number {
    return Number(hrtime) / 1_000_000;
  }

  /**
   * Get elapsed time since process start in ms
   */
  private getElapsedMs(): number {
    return this.hrtimeToMs(process.hrtime.bigint() - this.processStartTime);
  }

  /**
   * Record the start of a startup phase
   */
  recordPhaseStart(phase: StartupPhase, metadata?: Record<string, unknown>): void {
    if (!this.config.enabled) return;

    const now = process.hrtime.bigint();
    this.phases.set(phase, {
      phase,
      startTime: now,
      metadata,
    });

    this.timeline.push({
      phase,
      timestamp: this.getElapsedMs(),
      type: 'start',
      metadata,
    });

    this.emit('phase-start', phase, this.getElapsedMs());
  }

  /**
   * Record the end of a startup phase
   */
  recordPhaseEnd(phase: StartupPhase, metadata?: Record<string, unknown>): number {
    if (!this.config.enabled) return 0;

    const record = this.phases.get(phase);
    if (!record) {
      logger.warn(`Phase '${phase}' was not started`);
      return 0;
    }

    const now = process.hrtime.bigint();
    record.endTime = now;
    record.durationMs = this.hrtimeToMs(now - record.startTime);

    if (metadata) {
      record.metadata = { ...record.metadata, ...metadata };
    }

    this.timeline.push({
      phase,
      timestamp: this.getElapsedMs(),
      type: 'end',
      metadata,
    });

    this.emit('phase-end', phase, record.durationMs);

    // Check for slow phases
    const threshold = this.config.slowThresholds[phase];
    if (record.durationMs > threshold) {
      this.emit('slow-phase', phase, record.durationMs, threshold);
    }

    return record.durationMs;
  }

  /**
   * Record module load time
   */
  recordModuleLoad(modulePath: string, loadTimeMs: number, metadata?: { size?: number; dependencies?: string[] }): void {
    if (!this.config.enabled || !this.config.moduleTracking) return;

    this.moduleLoads.push({
      modulePath,
      loadTimeMs,
      ...metadata,
    });

    // Sort by load time descending
    this.moduleLoads.sort((a, b) => b.loadTimeMs - a.loadTimeMs);

    // Keep only top 50 slowest modules
    if (this.moduleLoads.length > 50) {
      this.moduleLoads = this.moduleLoads.slice(0, 50);
    }
  }

  /**
   * Wrap a module require to measure load time
   */
  measureRequire<T>(modulePath: string, requireFn: () => T): T {
    if (!this.config.enabled || !this.config.moduleTracking) {
      return requireFn();
    }

    const start = process.hrtime.bigint();
    const result = requireFn();
    const loadTimeMs = this.hrtimeToMs(process.hrtime.bigint() - start);

    this.recordModuleLoad(modulePath, loadTimeMs);
    return result;
  }

  /**
   * Wrap an async operation for timing
   */
  async measureAsync<T>(phase: StartupPhase, fn: () => Promise<T>, metadata?: Record<string, unknown>): Promise<T> {
    this.recordPhaseStart(phase, metadata);
    try {
      const result = await fn();
      this.recordPhaseEnd(phase);
      return result;
    } catch (error) {
      this.recordPhaseEnd(phase, { error: (error as Error).message });
      throw error;
    }
  }

  /**
   * Mark startup as complete
   */
  markStartupComplete(): void {
    if (!this.config.enabled || this.startupComplete) return;

    this.recordPhaseEnd('fully-loaded');
    this.startupComplete = true;
    this.updateWarmStartIndicator();

    if (this.config.autoReport) {
      this.saveMetrics();
    }

    this.emit('startup-complete', this.getStartupSummary());
  }

  /**
   * Get memory usage snapshot
   */
  getMemoryUsage(): MemoryUsageSnapshot {
    const mem = process.memoryUsage();
    return {
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
      external: mem.external,
      rss: mem.rss,
    };
  }

  /**
   * Get duration status classification
   */
  private getPhaseStatus(phase: StartupPhase, durationMs: number): 'fast' | 'acceptable' | 'slow' | 'critical' {
    const threshold = this.config.slowThresholds[phase];
    if (durationMs < threshold * 0.5) return 'fast';
    if (durationMs < threshold) return 'acceptable';
    if (durationMs < threshold * 2) return 'slow';
    return 'critical';
  }

  /**
   * Generate optimization recommendations
   */
  generateRecommendations(): string[] {
    const recommendations: string[] = [];
    const totalMs = this.getTotalDuration();

    // Check cold/warm start targets
    if (this.isWarmStart && totalMs > 1000) {
      recommendations.push(`Warm start exceeded 1s target (${totalMs.toFixed(0)}ms). Consider optimizing cached resources.`);
    } else if (!this.isWarmStart && totalMs > 3000) {
      recommendations.push(`Cold start exceeded 3s target (${totalMs.toFixed(0)}ms). Review slow phases below.`);
    }

    // Analyze phases
    Array.from(this.phases.entries()).forEach(([phase, record]) => {
      if (!record.durationMs) return;

      const status = this.getPhaseStatus(phase, record.durationMs);
      if (status === 'slow' || status === 'critical') {
        recommendations.push(this.getPhaseRecommendation(phase, record.durationMs));
      }
    });

    // Analyze slow modules
    const slowModules = this.moduleLoads.filter(m => m.loadTimeMs > 100);
    if (slowModules.length > 0) {
      recommendations.push(
        `${slowModules.length} module(s) took >100ms to load. Consider lazy loading: ${
          slowModules.slice(0, 3).map(m => m.modulePath).join(', ')
        }`
      );
    }

    // Memory recommendations
    const mem = this.getMemoryUsage();
    if (mem.heapUsed > 200 * 1024 * 1024) {
      recommendations.push(
        `High initial memory usage (${(mem.heapUsed / 1024 / 1024).toFixed(1)}MB). Review imported dependencies.`
      );
    }

    return recommendations;
  }

  /**
   * Get phase-specific recommendation
   */
  private getPhaseRecommendation(phase: StartupPhase, durationMs: number): string {
    const recommendations: Record<StartupPhase, string> = {
      'process-start': 'Optimize process initialization scripts.',
      'electron-init': 'Review Electron app.whenReady() blocking operations.',
      'app-ready': `App ready took ${durationMs.toFixed(0)}ms. Defer non-critical initialization.`,
      'config-load': 'Config load is slow. Cache configuration or simplify validation.',
      'logger-init': 'Logger initialization slow. Defer file transport setup.',
      'window-create': 'Window creation slow. Review BrowserWindow options.',
      'window-ready': 'Window ready slow. Optimize preload script and initial HTML.',
      'preload-execute': 'Preload script slow. Minimize IPC bridge setup.',
      'renderer-init': 'Renderer init slow. Code-split initial bundle.',
      'ipc-register': 'IPC registration slow. Batch handler registrations.',
      'tray-init': 'Tray initialization slow. Defer to after window ready.',
      'warmup-start': 'Warmup start delay detected.',
      'warmup-complete': 'Connection warmup slow. Run in background with timeout.',
      'connectivity-init': 'Connectivity monitoring init slow.',
      'provider-init': 'Provider initialization slow. Initialize on-demand.',
      'voice-pipeline-init': 'Voice pipeline init slow. Lazy-load voice components.',
      'first-paint': `First paint took ${durationMs.toFixed(0)}ms. Optimize critical render path.`,
      'interactive': `Time to interactive: ${durationMs.toFixed(0)}ms. Defer non-critical JS.`,
      'fully-loaded': `Full load: ${durationMs.toFixed(0)}ms. Review startup sequence.`,
    };
    return recommendations[phase];
  }

  /**
   * Get total startup duration
   */
  getTotalDuration(): number {
    const fullyLoaded = this.phases.get('fully-loaded');
    if (fullyLoaded?.durationMs) {
      // Sum all phases up to fully-loaded
      let total = 0;
      Array.from(this.phases.values()).forEach((record) => {
        if (record.durationMs) {
          total = Math.max(total, this.hrtimeToMs(record.endTime! - this.processStartTime));
        }
      });
      return total;
    }
    return this.getElapsedMs();
  }

  /**
   * Get startup summary
   */
  getStartupSummary(): StartupMetric {
    const totalMs = this.getTotalDuration();
    const phases: PhaseTimingSummary[] = [];

    Array.from(this.phases.entries()).forEach(([phase, record]) => {
      if (record.durationMs !== undefined) {
        phases.push({
          phase,
          durationMs: record.durationMs,
          percentOfTotal: totalMs > 0 ? (record.durationMs / totalMs) * 100 : 0,
          status: this.getPhaseStatus(phase, record.durationMs),
        });
      }
    });

    // Sort by duration descending
    phases.sort((a, b) => b.durationMs - a.durationMs);

    return {
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      isWarmStart: this.isWarmStart,
      totalDurationMs: totalMs,
      phases,
      slowModules: this.moduleLoads.slice(0, 10),
      memoryUsage: this.getMemoryUsage(),
      recommendations: this.generateRecommendations(),
    };
  }

  /**
   * Get phase timing for a specific phase
   */
  getPhaseTime(phase: StartupPhase): number | undefined {
    return this.phases.get(phase)?.durationMs;
  }

  /**
   * Get timeline events
   */
  getTimeline(): TimelineEvent[] {
    return [...this.timeline];
  }

  /**
   * Generate ASCII timeline visualization
   */
  generateTimelineVisualization(): string {
    const totalMs = this.getTotalDuration();
    const width = 60;
    const lines: string[] = [];

    lines.push('='.repeat(70));
    lines.push(`Atlas Startup Timeline (${this.isWarmStart ? 'Warm' : 'Cold'} Start)`);
    lines.push('='.repeat(70));
    lines.push(`Total: ${totalMs.toFixed(0)}ms | Target: ${this.isWarmStart ? '1000' : '3000'}ms`);
    lines.push('-'.repeat(70));
    lines.push('');

    // Group phases by type for visualization
    const completedPhases = Array.from(this.phases.entries())
      .filter(([, record]) => record.durationMs !== undefined)
      .sort((a, b) => {
        const aStart = Number(a[1].startTime - this.processStartTime);
        const bStart = Number(b[1].startTime - this.processStartTime);
        return aStart - bStart;
      });

    for (const [phase, record] of completedPhases) {
      const startOffset = this.hrtimeToMs(record.startTime - this.processStartTime);
      const duration = record.durationMs!;
      const startPos = Math.floor((startOffset / totalMs) * width);
      const barLength = Math.max(1, Math.floor((duration / totalMs) * width));
      const status = this.getPhaseStatus(phase, duration);

      const statusChar = status === 'fast' ? '.' :
                         status === 'acceptable' ? '=' :
                         status === 'slow' ? '#' : '!';

      const bar = ' '.repeat(startPos) + statusChar.repeat(barLength);
      const phaseName = phase.padEnd(20);
      const timing = `${duration.toFixed(0)}ms`.padStart(8);

      lines.push(`${phaseName} |${bar.padEnd(width)}| ${timing}`);
    }

    lines.push('');
    lines.push('-'.repeat(70));
    lines.push('Legend: . = fast, = = acceptable, # = slow, ! = critical');
    lines.push('='.repeat(70));

    return lines.join('\n');
  }

  /**
   * Generate JSON timeline for visualization tools
   */
  generateJsonTimeline(): object {
    return {
      sessionId: this.sessionId,
      isWarmStart: this.isWarmStart,
      totalDurationMs: this.getTotalDuration(),
      processStartTime: this.processStartTime.toString(),
      events: this.timeline,
      phases: Array.from(this.phases.entries()).map(([phase, record]) => ({
        phase,
        startMs: this.hrtimeToMs(record.startTime - this.processStartTime),
        durationMs: record.durationMs,
        metadata: record.metadata,
      })),
      modules: this.moduleLoads,
      memory: this.getMemoryUsage(),
    };
  }

  /**
   * Save metrics to file
   */
  saveMetrics(): void {
    if (!this.config.enabled) return;

    try {
      const metricsFile = join(this.config.metricsDir, 'startup-metrics.json');
      let history: StartupMetric[] = [];

      // Load existing history
      if (existsSync(metricsFile)) {
        try {
          const content = readFileSync(metricsFile, 'utf-8');
          history = JSON.parse(content);
        } catch {
          history = [];
        }
      }

      // Add current metrics
      const currentMetrics = this.getStartupSummary();
      history.push(currentMetrics);

      // Trim to max entries
      if (history.length > this.config.maxHistoryEntries) {
        history = history.slice(-this.config.maxHistoryEntries);
      }

      // Save
      writeFileSync(metricsFile, JSON.stringify(history, null, 2));

      // Also save timeline visualization
      const timelineFile = join(this.config.metricsDir, `timeline-${this.sessionId}.txt`);
      writeFileSync(timelineFile, this.generateTimelineVisualization());

      // Save JSON timeline
      const jsonTimelineFile = join(this.config.metricsDir, `timeline-${this.sessionId}.json`);
      writeFileSync(jsonTimelineFile, JSON.stringify(this.generateJsonTimeline(), null, 2));

      this.emit('metrics-saved', metricsFile);
    } catch (error) {
      logger.error('Failed to save metrics', { error: (error as Error).message });
    }
  }

  /**
   * Load historical metrics
   */
  loadHistoricalMetrics(): StartupMetric[] {
    const metricsFile = join(this.config.metricsDir, 'startup-metrics.json');
    try {
      if (existsSync(metricsFile)) {
        const content = readFileSync(metricsFile, 'utf-8');
        return JSON.parse(content);
      }
    } catch {
      // Ignore errors
    }
    return [];
  }

  /**
   * Get average startup times from history
   */
  getHistoricalAverages(): { cold: number; warm: number; overall: number } {
    const history = this.loadHistoricalMetrics();

    const coldStarts = history.filter(m => !m.isWarmStart);
    const warmStarts = history.filter(m => m.isWarmStart);

    const avg = (arr: StartupMetric[]): number => {
      if (arr.length === 0) return 0;
      return arr.reduce((sum, m) => sum + m.totalDurationMs, 0) / arr.length;
    };

    return {
      cold: avg(coldStarts),
      warm: avg(warmStarts),
      overall: avg(history),
    };
  }

  /**
   * Compare current startup with historical data
   */
  compareWithHistory(): { trend: 'improving' | 'stable' | 'degrading'; percentChange: number } {
    const history = this.loadHistoricalMetrics();
    const currentTotal = this.getTotalDuration();

    if (history.length < 5) {
      return { trend: 'stable', percentChange: 0 };
    }

    // Get last 5 entries of same type (warm/cold)
    const sameTypeHistory = history
      .filter(m => m.isWarmStart === this.isWarmStart)
      .slice(-5);

    if (sameTypeHistory.length === 0) {
      return { trend: 'stable', percentChange: 0 };
    }

    const avgHistorical = sameTypeHistory.reduce((sum, m) => sum + m.totalDurationMs, 0) / sameTypeHistory.length;
    const percentChange = ((currentTotal - avgHistorical) / avgHistorical) * 100;

    let trend: 'improving' | 'stable' | 'degrading';
    if (percentChange < -10) {
      trend = 'improving';
    } else if (percentChange > 10) {
      trend = 'degrading';
    } else {
      trend = 'stable';
    }

    return { trend, percentChange };
  }

  /**
   * Check if startup meets targets
   */
  meetsTargets(): { coldMet: boolean; warmMet: boolean; current: boolean } {
    const currentTotal = this.getTotalDuration();
    const coldTarget = 3000;
    const warmTarget = 1000;

    return {
      coldMet: currentTotal <= coldTarget,
      warmMet: currentTotal <= warmTarget,
      current: this.isWarmStart ? currentTotal <= warmTarget : currentTotal <= coldTarget,
    };
  }

  /**
   * Get profiler status
   */
  getStatus(): {
    enabled: boolean;
    sessionId: string;
    isWarmStart: boolean;
    startupComplete: boolean;
    currentPhaseCount: number;
    elapsedMs: number;
  } {
    return {
      enabled: this.config.enabled,
      sessionId: this.sessionId,
      isWarmStart: this.isWarmStart,
      startupComplete: this.startupComplete,
      currentPhaseCount: this.phases.size,
      elapsedMs: this.getElapsedMs(),
    };
  }

  /**
   * Reset profiler for new session
   */
  reset(): void {
    this.phases.clear();
    this.moduleLoads = [];
    this.timeline = [];
    this.sessionId = this.generateSessionId();
    this.processStartTime = process.hrtime.bigint();
    this.startupComplete = false;
    this.isWarmStart = this.checkWarmStart();

    this.recordPhaseStart('process-start');
    this.recordPhaseEnd('process-start');
  }
}

// Singleton instance
let profilerInstance: StartupProfiler | null = null;

/**
 * Get the startup profiler instance
 */
export function getStartupProfiler(config?: Partial<ProfilerConfig>): StartupProfiler {
  if (!profilerInstance) {
    profilerInstance = new StartupProfiler(config);
  }
  return profilerInstance;
}

/**
 * Shutdown the startup profiler
 */
export function shutdownStartupProfiler(): void {
  if (profilerInstance) {
    if (!profilerInstance.getStatus().startupComplete) {
      profilerInstance.markStartupComplete();
    }
    profilerInstance = null;
  }
}

/**
 * Quick measurement helper
 */
export function measurePhase<T>(
  phase: StartupPhase,
  fn: () => T,
  metadata?: Record<string, unknown>
): T {
  const profiler = getStartupProfiler();
  profiler.recordPhaseStart(phase, metadata);
  try {
    const result = fn();
    profiler.recordPhaseEnd(phase);
    return result;
  } catch (error) {
    profiler.recordPhaseEnd(phase, { error: (error as Error).message });
    throw error;
  }
}

/**
 * Async measurement helper
 */
export async function measurePhaseAsync<T>(
  phase: StartupPhase,
  fn: () => Promise<T>,
  metadata?: Record<string, unknown>
): Promise<T> {
  const profiler = getStartupProfiler();
  return profiler.measureAsync(phase, fn, metadata);
}

export default StartupProfiler;
