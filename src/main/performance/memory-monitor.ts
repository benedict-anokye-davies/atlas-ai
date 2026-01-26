/**
 * Atlas Desktop - Memory Leak Detection and Monitoring
 *
 * Monitors heap usage in main and renderer processes, detects memory growth
 * patterns indicating leaks, and provides memory snapshots and alerts.
 */

import { EventEmitter } from 'events';
import { BrowserWindow } from 'electron';
import * as v8 from 'v8';
import { createModuleLogger } from '../utils/logger';

const memoryLogger = createModuleLogger('MemoryMonitor');

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * V8 heap statistics
 */
export interface HeapStatistics {
  totalHeapSize: number;
  totalHeapSizeExecutable: number;
  totalPhysicalSize: number;
  totalAvailableSize: number;
  usedHeapSize: number;
  heapSizeLimit: number;
  mallocedMemory: number;
  peakMallocedMemory: number;
  externalMemory: number;
}

/**
 * Memory snapshot for a process
 */
export interface MemorySnapshot {
  timestamp: number;
  processId: number;
  processType: 'main' | 'renderer';
  heap: HeapStatistics;
  rss: number; // Resident Set Size from process.memoryUsage()
  heapUsedMB: number;
  heapTotalMB: number;
  rssMB: number;
  externalMB: number;
}

/**
 * Memory growth analysis result
 */
export interface MemoryGrowthAnalysis {
  isLeaking: boolean;
  growthRateMBPerMinute: number;
  averageHeapUsedMB: number;
  peakHeapUsedMB: number;
  trendDirection: 'increasing' | 'stable' | 'decreasing';
  confidenceScore: number; // 0-1, how confident we are in the leak detection
  analysisWindowMinutes: number;
  sampleCount: number;
}

/**
 * Common leak pattern detected
 */
export interface LeakPattern {
  type:
    | 'event-listener-accumulation'
    | 'closure-retention'
    | 'unbounded-cache'
    | 'timer-accumulation'
    | 'dom-detached-nodes'
    | 'unknown';
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  suggestedFix: string;
}

/**
 * Memory alert
 */
export interface MemoryAlert {
  id: string;
  timestamp: number;
  type: 'threshold-exceeded' | 'leak-detected' | 'oom-risk';
  severity: 'warning' | 'critical';
  message: string;
  currentMemoryMB: number;
  thresholdMB?: number;
  processType: 'main' | 'renderer';
  leakPattern?: LeakPattern;
}

/**
 * Memory monitor configuration
 */
export interface MemoryMonitorConfig {
  /** Sampling interval in milliseconds */
  samplingIntervalMs: number;
  /** Maximum samples to retain for analysis */
  maxSamples: number;
  /** Memory threshold for warning alert (MB) */
  warningThresholdMB: number;
  /** Memory threshold for critical alert (MB) */
  criticalThresholdMB: number;
  /** Minimum growth rate to consider as leak (MB/min) */
  leakGrowthRateMBPerMinute: number;
  /** Analysis window duration in minutes */
  analysisWindowMinutes: number;
  /** Enable automatic leak detection */
  autoDetectLeaks: boolean;
  /** Enable renderer process monitoring */
  monitorRenderer: boolean;
}

/**
 * Event listener tracking entry
 */
interface EventListenerEntry {
  target: string;
  event: string;
  count: number;
  timestamp: number;
}

/**
 * Timer tracking entry
 */
interface TimerEntry {
  type: 'interval' | 'timeout';
  id: number;
  createdAt: number;
  stackTrace?: string;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: MemoryMonitorConfig = {
  samplingIntervalMs: 10000, // 10 seconds
  maxSamples: 360, // 1 hour at 10-second intervals
  warningThresholdMB: 400,
  criticalThresholdMB: 500,
  leakGrowthRateMBPerMinute: 1.0,
  analysisWindowMinutes: 5,
  autoDetectLeaks: true,
  monitorRenderer: true,
};

// ============================================================================
// Memory Monitor Class
// ============================================================================

export class MemoryMonitor extends EventEmitter {
  private config: MemoryMonitorConfig;
  private mainProcessSamples: MemorySnapshot[] = [];
  private rendererSamples: Map<number, MemorySnapshot[]> = new Map();
  private samplingInterval: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;
  private alerts: MemoryAlert[] = [];
  private eventListenerCounts: Map<string, EventListenerEntry> = new Map();
  private activeTimers: Map<number, TimerEntry> = new Map();
  private timerIdCounter = 0;

  constructor(config: Partial<MemoryMonitorConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Start memory monitoring
   */
  start(): void {
    if (this.isRunning) {
      memoryLogger.warn('Memory monitor already running');
      return;
    }

    memoryLogger.info('Starting memory monitor', {
      intervalMs: this.config.samplingIntervalMs,
      warningThresholdMB: this.config.warningThresholdMB,
      criticalThresholdMB: this.config.criticalThresholdMB,
    });

    this.isRunning = true;
    this.collectSample(); // Collect initial sample

    this.samplingInterval = setInterval(() => {
      this.collectSample();
    }, this.config.samplingIntervalMs);

    this.emit('started');
  }

  /**
   * Stop memory monitoring
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    if (this.samplingInterval) {
      clearInterval(this.samplingInterval);
      this.samplingInterval = null;
    }

    this.isRunning = false;
    memoryLogger.info('Memory monitor stopped');
    this.emit('stopped');
  }

  /**
   * Collect a memory sample from main process
   */
  private collectSample(): void {
    try {
      // Collect main process sample
      const mainSnapshot = this.captureMainProcessSnapshot();
      this.mainProcessSamples.push(mainSnapshot);

      // Trim samples if over limit
      if (this.mainProcessSamples.length > this.config.maxSamples) {
        this.mainProcessSamples.shift();
      }

      this.emit('sample', mainSnapshot);

      // Check thresholds
      this.checkThresholds(mainSnapshot);

      // Collect renderer process samples if enabled
      if (this.config.monitorRenderer) {
        this.collectRendererSamples();
      }

      // Run leak detection periodically
      if (this.config.autoDetectLeaks && this.mainProcessSamples.length > 10) {
        this.analyzeForLeaks();
      }
    } catch (error) {
      memoryLogger.error('Failed to collect memory sample', {
        error: (error as Error).message,
      });
    }
  }

  /**
   * Capture memory snapshot for main process
   */
  private captureMainProcessSnapshot(): MemorySnapshot {
    const heapStats = v8.getHeapStatistics();
    const memUsage = process.memoryUsage();

    return {
      timestamp: Date.now(),
      processId: process.pid,
      processType: 'main',
      heap: {
        totalHeapSize: heapStats.total_heap_size,
        totalHeapSizeExecutable: heapStats.total_heap_size_executable,
        totalPhysicalSize: heapStats.total_physical_size,
        totalAvailableSize: heapStats.total_available_size,
        usedHeapSize: heapStats.used_heap_size,
        heapSizeLimit: heapStats.heap_size_limit,
        mallocedMemory: heapStats.malloced_memory,
        peakMallocedMemory: heapStats.peak_malloced_memory,
        externalMemory: heapStats.external_memory,
      },
      rss: memUsage.rss,
      heapUsedMB: heapStats.used_heap_size / (1024 * 1024),
      heapTotalMB: heapStats.total_heap_size / (1024 * 1024),
      rssMB: memUsage.rss / (1024 * 1024),
      externalMB: memUsage.external / (1024 * 1024),
    };
  }

  /**
   * Collect memory samples from renderer processes
   */
  private async collectRendererSamples(): Promise<void> {
    try {
      const windows = BrowserWindow.getAllWindows();

      for (const win of windows) {
        if (win.isDestroyed()) continue;

        try {
          // Get renderer process metrics
          const metrics = await win.webContents.executeJavaScript(`
            (function() {
              const perf = performance;
              const mem = perf.memory ? {
                usedJSHeapSize: perf.memory.usedJSHeapSize,
                totalJSHeapSize: perf.memory.totalJSHeapSize,
                jsHeapSizeLimit: perf.memory.jsHeapSizeLimit
              } : null;
              return mem;
            })()
          `);

          if (metrics) {
            const snapshot: MemorySnapshot = {
              timestamp: Date.now(),
              processId: win.webContents.getProcessId(),
              processType: 'renderer',
              heap: {
                totalHeapSize: metrics.totalJSHeapSize || 0,
                totalHeapSizeExecutable: 0,
                totalPhysicalSize: 0,
                totalAvailableSize: 0,
                usedHeapSize: metrics.usedJSHeapSize || 0,
                heapSizeLimit: metrics.jsHeapSizeLimit || 0,
                mallocedMemory: 0,
                peakMallocedMemory: 0,
                externalMemory: 0,
              },
              rss: 0,
              heapUsedMB: (metrics.usedJSHeapSize || 0) / (1024 * 1024),
              heapTotalMB: (metrics.totalJSHeapSize || 0) / (1024 * 1024),
              rssMB: 0,
              externalMB: 0,
            };

            const processId = win.webContents.getProcessId();
            let samples = this.rendererSamples.get(processId);
            if (!samples) {
              samples = [];
              this.rendererSamples.set(processId, samples);
            }
            samples.push(snapshot);

            // Trim samples
            if (samples.length > this.config.maxSamples) {
              samples.shift();
            }

            // Check thresholds for renderer
            this.checkThresholds(snapshot);
          }
        } catch (rendererError) {
          // Renderer might not support performance.memory
          memoryLogger.debug('Could not collect renderer memory', {
            windowId: win.id,
          });
        }
      }
    } catch (error) {
      memoryLogger.debug('Failed to collect renderer samples', {
        error: (error as Error).message,
      });
    }
  }

  /**
   * Check memory thresholds and emit alerts
   */
  private checkThresholds(snapshot: MemorySnapshot): void {
    const heapUsedMB = snapshot.heapUsedMB;

    if (heapUsedMB >= this.config.criticalThresholdMB) {
      this.emitAlert({
        type: 'threshold-exceeded',
        severity: 'critical',
        message: `Critical memory threshold exceeded: ${heapUsedMB.toFixed(2)}MB >= ${this.config.criticalThresholdMB}MB`,
        currentMemoryMB: heapUsedMB,
        thresholdMB: this.config.criticalThresholdMB,
        processType: snapshot.processType,
      });
    } else if (heapUsedMB >= this.config.warningThresholdMB) {
      this.emitAlert({
        type: 'threshold-exceeded',
        severity: 'warning',
        message: `Memory threshold warning: ${heapUsedMB.toFixed(2)}MB >= ${this.config.warningThresholdMB}MB`,
        currentMemoryMB: heapUsedMB,
        thresholdMB: this.config.warningThresholdMB,
        processType: snapshot.processType,
      });
    }

    // Check for OOM risk (90% of heap limit)
    // Guard against division by zero when heap limit is not available
    if (snapshot.heap.heapSizeLimit > 0) {
      const heapUsagePercent = (snapshot.heap.usedHeapSize / snapshot.heap.heapSizeLimit) * 100;
      if (heapUsagePercent >= 90 && Number.isFinite(heapUsagePercent)) {
        this.emitAlert({
          type: 'oom-risk',
          severity: 'critical',
          message: `Out of memory risk: Heap usage at ${heapUsagePercent.toFixed(1)}% of limit`,
          currentMemoryMB: heapUsedMB,
          processType: snapshot.processType,
        });
      }
    }
  }

  /**
   * Emit a memory alert
   */
  private emitAlert(alertData: Omit<MemoryAlert, 'id' | 'timestamp'>): void {
    const alert: MemoryAlert = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      ...alertData,
    };

    this.alerts.push(alert);

    // Keep only last 100 alerts
    if (this.alerts.length > 100) {
      this.alerts.shift();
    }

    memoryLogger.warn('Memory alert', {
      type: alert.type,
      severity: alert.severity,
      memoryMB: alert.currentMemoryMB.toFixed(2),
    });

    this.emit('alert', alert);
  }

  /**
   * Analyze memory samples for leak patterns
   */
  private analyzeForLeaks(): void {
    const analysis = this.analyzeGrowth('main');

    if (analysis.isLeaking && analysis.confidenceScore > 0.7) {
      const pattern = this.detectLeakPattern();

      this.emitAlert({
        type: 'leak-detected',
        severity: analysis.growthRateMBPerMinute > 5 ? 'critical' : 'warning',
        message: `Memory leak detected: Growing at ${analysis.growthRateMBPerMinute.toFixed(2)} MB/min`,
        currentMemoryMB: analysis.averageHeapUsedMB,
        processType: 'main',
        leakPattern: pattern,
      });

      memoryLogger.warn('Memory leak detected', {
        growthRate: analysis.growthRateMBPerMinute,
        confidence: analysis.confidenceScore,
        pattern: pattern.type,
      });
    }
  }

  /**
   * Analyze memory growth for a specific process type
   */
  analyzeGrowth(processType: 'main' | 'renderer', processId?: number): MemoryGrowthAnalysis {
    let samples: MemorySnapshot[];

    if (processType === 'main') {
      samples = this.mainProcessSamples;
    } else {
      samples = processId ? this.rendererSamples.get(processId) || [] : [];
    }

    if (samples.length < 3) {
      return {
        isLeaking: false,
        growthRateMBPerMinute: 0,
        averageHeapUsedMB: 0,
        peakHeapUsedMB: 0,
        trendDirection: 'stable',
        confidenceScore: 0,
        analysisWindowMinutes: 0,
        sampleCount: samples.length,
      };
    }

    // Filter samples to analysis window
    const windowMs = this.config.analysisWindowMinutes * 60 * 1000;
    const cutoff = Date.now() - windowMs;
    const recentSamples = samples.filter((s) => s.timestamp >= cutoff);

    if (recentSamples.length < 3) {
      return {
        isLeaking: false,
        growthRateMBPerMinute: 0,
        averageHeapUsedMB: samples[samples.length - 1]?.heapUsedMB || 0,
        peakHeapUsedMB: Math.max(...samples.map((s) => s.heapUsedMB)),
        trendDirection: 'stable',
        confidenceScore: 0,
        analysisWindowMinutes: this.config.analysisWindowMinutes,
        sampleCount: recentSamples.length,
      };
    }

    // Calculate statistics
    const heapValues = recentSamples.map((s) => s.heapUsedMB);
    const timestamps = recentSamples.map((s) => s.timestamp);

    const averageHeap = heapValues.reduce((a, b) => a + b, 0) / heapValues.length;
    const peakHeap = Math.max(...heapValues);

    // Linear regression for trend analysis
    const { slope, rSquared } = this.linearRegression(timestamps, heapValues);

    // Convert slope from MB/ms to MB/min
    const growthRateMBPerMinute = slope * 60 * 1000;

    // Determine trend direction
    let trendDirection: 'increasing' | 'stable' | 'decreasing';
    if (Math.abs(growthRateMBPerMinute) < 0.1) {
      trendDirection = 'stable';
    } else if (growthRateMBPerMinute > 0) {
      trendDirection = 'increasing';
    } else {
      trendDirection = 'decreasing';
    }

    // Determine if leaking based on growth rate and R-squared (fit quality)
    const isLeaking =
      trendDirection === 'increasing' &&
      growthRateMBPerMinute >= this.config.leakGrowthRateMBPerMinute &&
      rSquared > 0.5; // Good linear fit suggests consistent growth

    return {
      isLeaking,
      growthRateMBPerMinute,
      averageHeapUsedMB: averageHeap,
      peakHeapUsedMB: peakHeap,
      trendDirection,
      confidenceScore: rSquared,
      analysisWindowMinutes: this.config.analysisWindowMinutes,
      sampleCount: recentSamples.length,
    };
  }

  /**
   * Perform linear regression on data points
   */
  private linearRegression(
    x: number[],
    y: number[]
  ): { slope: number; intercept: number; rSquared: number } {
    const n = x.length;
    if (n === 0) return { slope: 0, intercept: 0, rSquared: 0 };

    // Normalize x values to avoid large number issues
    const xMin = Math.min(...x);
    const xNorm = x.map((v) => v - xMin);

    const sumX = xNorm.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = xNorm.reduce((acc, xi, i) => acc + xi * y[i], 0);
    const sumXX = xNorm.reduce((acc, xi) => acc + xi * xi, 0);

    const denominator = n * sumXX - sumX * sumX;
    if (denominator === 0) return { slope: 0, intercept: y[0] || 0, rSquared: 0 };

    const slope = (n * sumXY - sumX * sumY) / denominator;
    const intercept = (sumY - slope * sumX) / n;

    // Calculate R-squared
    const yMean = sumY / n;
    const ssTotal = y.reduce((acc, yi) => acc + Math.pow(yi - yMean, 2), 0);
    const ssResidual = y.reduce((acc, yi, i) => {
      const yPred = slope * xNorm[i] + intercept;
      return acc + Math.pow(yi - yPred, 2);
    }, 0);

    const rSquared = ssTotal === 0 ? 0 : 1 - ssResidual / ssTotal;

    return { slope, intercept, rSquared: Math.max(0, Math.min(1, rSquared)) };
  }

  /**
   * Detect common leak patterns based on heuristics
   */
  detectLeakPattern(): LeakPattern {
    const analysis = this.analyzeGrowth('main');

    // Check event listener counts (if tracked)
    const totalListeners = Array.from(this.eventListenerCounts.values()).reduce(
      (sum, entry) => sum + entry.count,
      0
    );

    if (totalListeners > 100) {
      return {
        type: 'event-listener-accumulation',
        description: `High event listener count detected: ${totalListeners} listeners`,
        severity: totalListeners > 500 ? 'critical' : 'high',
        suggestedFix:
          'Ensure event listeners are removed when components unmount. Use removeEventListener() or AbortController.',
      };
    }

    // Check timer counts
    if (this.activeTimers.size > 50) {
      return {
        type: 'timer-accumulation',
        description: `Too many active timers: ${this.activeTimers.size}`,
        severity: this.activeTimers.size > 100 ? 'critical' : 'high',
        suggestedFix:
          'Clear intervals/timeouts when no longer needed using clearInterval/clearTimeout.',
      };
    }

    // Fast growth often indicates unbounded cache
    if (analysis.growthRateMBPerMinute > 10) {
      return {
        type: 'unbounded-cache',
        description: `Very fast memory growth: ${analysis.growthRateMBPerMinute.toFixed(2)} MB/min`,
        severity: 'critical',
        suggestedFix:
          'Check for unbounded arrays, maps, or caches. Implement LRU eviction or size limits.',
      };
    }

    // Moderate growth might be closure retention
    if (analysis.growthRateMBPerMinute > 2) {
      return {
        type: 'closure-retention',
        description: 'Moderate consistent growth may indicate closure retention',
        severity: 'medium',
        suggestedFix:
          'Check for closures capturing large objects. Avoid storing references in long-lived scopes.',
      };
    }

    return {
      type: 'unknown',
      description: 'Memory leak pattern not identified',
      severity: 'low',
      suggestedFix:
        'Use Chrome DevTools Memory panel to take heap snapshots and compare allocations.',
    };
  }

  /**
   * Take a memory snapshot on demand
   */
  takeSnapshot(): MemorySnapshot {
    return this.captureMainProcessSnapshot();
  }

  /**
   * Force garbage collection (if exposed)
   */
  forceGC(): boolean {
    if (global.gc) {
      memoryLogger.info('Forcing garbage collection');
      global.gc();
      return true;
    }
    memoryLogger.warn('Garbage collection not available. Run with --expose-gc flag.');
    return false;
  }

  /**
   * Get current memory status
   */
  getStatus(): {
    isRunning: boolean;
    mainSampleCount: number;
    rendererProcesses: number;
    currentHeapMB: number;
    peakHeapMB: number;
    alertCount: number;
    lastAnalysis: MemoryGrowthAnalysis | null;
  } {
    const analysis = this.mainProcessSamples.length >= 3 ? this.analyzeGrowth('main') : null;

    return {
      isRunning: this.isRunning,
      mainSampleCount: this.mainProcessSamples.length,
      rendererProcesses: this.rendererSamples.size,
      currentHeapMB: this.mainProcessSamples[this.mainProcessSamples.length - 1]?.heapUsedMB || 0,
      peakHeapMB: Math.max(...this.mainProcessSamples.map((s) => s.heapUsedMB), 0),
      alertCount: this.alerts.length,
      lastAnalysis: analysis,
    };
  }

  /**
   * Get all samples for main process
   */
  getMainSamples(): MemorySnapshot[] {
    return [...this.mainProcessSamples];
  }

  /**
   * Get samples for a renderer process
   */
  getRendererSamples(processId: number): MemorySnapshot[] {
    return [...(this.rendererSamples.get(processId) || [])];
  }

  /**
   * Get recent alerts
   */
  getAlerts(count: number = 20): MemoryAlert[] {
    return this.alerts.slice(-count);
  }

  /**
   * Clear all samples and alerts
   */
  clear(): void {
    this.mainProcessSamples = [];
    this.rendererSamples.clear();
    this.alerts = [];
    memoryLogger.info('Memory monitor data cleared');
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<MemoryMonitorConfig>): void {
    this.config = { ...this.config, ...config };
    memoryLogger.info('Memory monitor config updated', config);
  }

  /**
   * Get current configuration
   */
  getConfig(): MemoryMonitorConfig {
    return { ...this.config };
  }

  /**
   * Track an event listener (for leak detection)
   */
  trackEventListener(target: string, event: string, delta: number = 1): void {
    const key = `${target}:${event}`;
    const existing = this.eventListenerCounts.get(key);

    if (existing) {
      existing.count += delta;
      if (existing.count <= 0) {
        this.eventListenerCounts.delete(key);
      } else {
        existing.timestamp = Date.now();
      }
    } else if (delta > 0) {
      this.eventListenerCounts.set(key, {
        target,
        event,
        count: delta,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Track a timer (for leak detection)
   */
  trackTimer(type: 'interval' | 'timeout'): number {
    const id = ++this.timerIdCounter;
    this.activeTimers.set(id, {
      type,
      id,
      createdAt: Date.now(),
    });
    return id;
  }

  /**
   * Untrack a timer
   */
  untrackTimer(id: number): void {
    this.activeTimers.delete(id);
  }

  /**
   * Get event listener statistics
   */
  getEventListenerStats(): { total: number; byTarget: Record<string, number> } {
    const byTarget: Record<string, number> = {};
    let total = 0;

    for (const entry of this.eventListenerCounts.values()) {
      total += entry.count;
      byTarget[entry.target] = (byTarget[entry.target] || 0) + entry.count;
    }

    return { total, byTarget };
  }

  /**
   * Get timer statistics
   */
  getTimerStats(): { intervals: number; timeouts: number; total: number } {
    let intervals = 0;
    let timeouts = 0;

    for (const timer of this.activeTimers.values()) {
      if (timer.type === 'interval') {
        intervals++;
      } else {
        timeouts++;
      }
    }

    return { intervals, timeouts, total: this.activeTimers.size };
  }

  /**
   * Write a heap snapshot to file (requires --expose-gc)
   */
  async writeHeapSnapshot(filePath?: string): Promise<string | null> {
    try {
      const snapshotPath = filePath || `atlas-heap-${Date.now()}.heapsnapshot`;

      const writeSnapshot = v8.writeHeapSnapshot;
      if (!writeSnapshot) {
        memoryLogger.warn('v8.writeHeapSnapshot not available');
        return null;
      }

      const actualPath = writeSnapshot(snapshotPath);
      memoryLogger.info('Heap snapshot written', { path: actualPath });
      return actualPath;
    } catch (error) {
      memoryLogger.error('Failed to write heap snapshot', {
        error: (error as Error).message,
      });
      return null;
    }
  }

  /**
   * Generate a memory report
   */
  generateReport(): {
    timestamp: number;
    status: ReturnType<typeof this.getStatus>;
    analysis: MemoryGrowthAnalysis | null;
    leakPattern: LeakPattern | null;
    eventListeners: ReturnType<typeof this.getEventListenerStats>;
    timers: ReturnType<typeof this.getTimerStats>;
    recentAlerts: MemoryAlert[];
    recommendations: string[];
  } {
    const status = this.getStatus();
    const analysis = this.mainProcessSamples.length >= 3 ? this.analyzeGrowth('main') : null;
    const pattern = analysis?.isLeaking ? this.detectLeakPattern() : null;

    const recommendations: string[] = [];

    if (status.currentHeapMB > this.config.warningThresholdMB) {
      recommendations.push(
        `Memory usage (${status.currentHeapMB.toFixed(2)}MB) is above warning threshold. Consider investigating.`
      );
    }

    if (analysis?.isLeaking) {
      recommendations.push(
        `Memory leak detected with ${analysis.growthRateMBPerMinute.toFixed(2)} MB/min growth rate.`
      );
      if (pattern) {
        recommendations.push(pattern.suggestedFix);
      }
    }

    const eventStats = this.getEventListenerStats();
    if (eventStats.total > 50) {
      recommendations.push(
        `High event listener count (${eventStats.total}). Review listener cleanup.`
      );
    }

    const timerStats = this.getTimerStats();
    if (timerStats.intervals > 20) {
      recommendations.push(
        `Many active intervals (${timerStats.intervals}). Ensure proper cleanup.`
      );
    }

    return {
      timestamp: Date.now(),
      status,
      analysis,
      leakPattern: pattern,
      eventListeners: eventStats,
      timers: timerStats,
      recentAlerts: this.getAlerts(10),
      recommendations,
    };
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let memoryMonitorInstance: MemoryMonitor | null = null;

/**
 * Get the memory monitor singleton
 */
export function getMemoryMonitor(config?: Partial<MemoryMonitorConfig>): MemoryMonitor {
  if (!memoryMonitorInstance) {
    memoryMonitorInstance = new MemoryMonitor(config);
  } else if (config) {
    memoryMonitorInstance.updateConfig(config);
  }
  return memoryMonitorInstance;
}

/**
 * Shutdown the memory monitor
 */
export function shutdownMemoryMonitor(): void {
  if (memoryMonitorInstance) {
    memoryMonitorInstance.stop();
    memoryMonitorInstance = null;
  }
}

// ============================================================================
// Utility Functions for Tracking
// ============================================================================

/**
 * Create a tracked setInterval that auto-registers with memory monitor
 */
export function createTrackedInterval(
  callback: () => void,
  ms: number
): { id: ReturnType<typeof setInterval>; trackId: number } {
  const monitor = getMemoryMonitor();
  const trackId = monitor.trackTimer('interval');
  const id = setInterval(callback, ms);

  return { id, trackId };
}

/**
 * Clear a tracked interval
 */
export function clearTrackedInterval(tracked: {
  id: ReturnType<typeof setInterval>;
  trackId: number;
}): void {
  clearInterval(tracked.id);
  getMemoryMonitor().untrackTimer(tracked.trackId);
}

/**
 * Create a tracked setTimeout that auto-registers with memory monitor
 */
export function createTrackedTimeout(
  callback: () => void,
  ms: number
): { id: ReturnType<typeof setTimeout>; trackId: number } {
  const monitor = getMemoryMonitor();
  const trackId = monitor.trackTimer('timeout');
  const id = setTimeout(() => {
    callback();
    monitor.untrackTimer(trackId);
  }, ms);

  return { id, trackId };
}

/**
 * Clear a tracked timeout
 */
export function clearTrackedTimeout(tracked: {
  id: ReturnType<typeof setTimeout>;
  trackId: number;
}): void {
  clearTimeout(tracked.id);
  getMemoryMonitor().untrackTimer(tracked.trackId);
}

export default MemoryMonitor;
