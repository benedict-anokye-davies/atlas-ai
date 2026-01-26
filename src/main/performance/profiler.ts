/**
 * Atlas Desktop - Performance Profiler
 * Real-time performance monitoring and profiling system
 *
 * Tracks:
 * - FPS and frame timing
 * - Memory usage (heap, RSS)
 * - CPU utilization
 * - IPC message latency
 * - Voice pipeline timing breakdown
 * - Render performance metrics
 */

import { EventEmitter } from 'events';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir, cpus } from 'os';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('Profiler');

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Performance metric categories
 */
export type MetricCategory =
  | 'fps'
  | 'memory'
  | 'cpu'
  | 'ipc'
  | 'voice'
  | 'render'
  | 'custom';

/**
 * Time series data point
 */
export interface DataPoint {
  timestamp: number;
  value: number;
  metadata?: Record<string, unknown>;
}

/**
 * Performance metric with history
 */
export interface PerformanceMetric {
  name: string;
  category: MetricCategory;
  current: number;
  min: number;
  max: number;
  avg: number;
  history: DataPoint[];
  unit: string;
}

/**
 * Memory metrics
 */
export interface MemoryMetrics {
  heapUsed: number;
  heapTotal: number;
  external: number;
  rss: number;
  arrayBuffers: number;
  percentUsed: number;
}

/**
 * CPU metrics
 */
export interface CPUMetrics {
  usage: number;
  userTime: number;
  systemTime: number;
  cores: number;
  loadAverage: number[];
}

/**
 * IPC timing record
 */
export interface IPCTimingRecord {
  channel: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  success: boolean;
  error?: string;
}

/**
 * Voice pipeline timing breakdown
 */
export interface VoicePipelineTimings {
  wakeWordDetection: number;
  vadProcessing: number;
  sttLatency: number;
  llmFirstToken: number;
  llmTotalTime: number;
  ttsFirstAudio: number;
  ttsTotalTime: number;
  totalResponseTime: number;
}

/**
 * Render metrics from the renderer process
 */
export interface RenderMetrics {
  fps: number;
  avgFps: number;
  frameTime: number;
  particleCount: number;
  drawCalls: number;
  triangles: number;
  gpuMemory?: number;
}

/**
 * Performance snapshot
 */
export interface PerformanceSnapshot {
  timestamp: number;
  memory: MemoryMetrics;
  cpu: CPUMetrics;
  ipc: {
    avgLatency: number;
    maxLatency: number;
    messageCount: number;
    errorCount: number;
  };
  voice?: VoicePipelineTimings;
  render?: RenderMetrics;
  bottlenecks: PerformanceBottleneck[];
}

/**
 * Performance bottleneck detection
 */
export interface PerformanceBottleneck {
  type: 'memory' | 'cpu' | 'ipc' | 'fps' | 'latency';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  value: number;
  threshold: number;
  recommendation: string;
}

/**
 * Performance report
 */
export interface PerformanceReport {
  generatedAt: string;
  duration: number;
  summary: {
    avgFps: number;
    avgMemory: number;
    avgCpu: number;
    avgIpcLatency: number;
    bottleneckCount: number;
  };
  snapshots: PerformanceSnapshot[];
  metrics: Record<string, PerformanceMetric>;
  recommendations: string[];
}

/**
 * Profiler configuration
 */
export interface ProfilerConfig {
  enabled: boolean;
  sampleInterval: number;
  historySize: number;
  metricsDir: string;
  thresholds: PerformanceThresholds;
  autoExport: boolean;
  exportInterval: number;
}

/**
 * Performance thresholds for bottleneck detection
 */
export interface PerformanceThresholds {
  fps: { warning: number; critical: number };
  memory: { warning: number; critical: number }; // percentage
  cpu: { warning: number; critical: number }; // percentage
  ipcLatency: { warning: number; critical: number }; // ms
  frameTime: { warning: number; critical: number }; // ms
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_THRESHOLDS: PerformanceThresholds = {
  fps: { warning: 45, critical: 30 },
  memory: { warning: 70, critical: 90 },
  cpu: { warning: 70, critical: 90 },
  ipcLatency: { warning: 50, critical: 100 },
  frameTime: { warning: 22, critical: 33 },
};

const DEFAULT_CONFIG: ProfilerConfig = {
  enabled: true,
  sampleInterval: 1000, // 1 second
  historySize: 300, // 5 minutes at 1 sample/second
  metricsDir: join(homedir(), '.atlas', 'performance'),
  thresholds: DEFAULT_THRESHOLDS,
  autoExport: false,
  exportInterval: 300000, // 5 minutes
};

// ============================================================================
// Performance Profiler Class
// ============================================================================

/**
 * PerformanceProfiler - Real-time performance monitoring and profiling
 */
export class PerformanceProfiler extends EventEmitter {
  private config: ProfilerConfig;
  private metrics: Map<string, PerformanceMetric> = new Map();
  private ipcTimings: Map<string, IPCTimingRecord> = new Map();
  private snapshots: PerformanceSnapshot[] = [];
  private voiceTimings: Partial<VoicePipelineTimings> = {};
  private renderMetrics: RenderMetrics | null = null;
  private sampleTimer: NodeJS.Timeout | null = null;
  private exportTimer: NodeJS.Timeout | null = null;
  private lastCpuUsage: NodeJS.CpuUsage | null = null;
  private lastCpuTime: number = 0;
  private startTime: number;
  private isRunning: boolean = false;

  constructor(config: Partial<ProfilerConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.startTime = Date.now();

    // Ensure metrics directory exists
    if (this.config.enabled && !existsSync(this.config.metricsDir)) {
      mkdirSync(this.config.metricsDir, { recursive: true });
    }

    // Initialize core metrics
    this.initializeMetrics();
  }

  /**
   * Initialize core performance metrics
   */
  private initializeMetrics(): void {
    // FPS metrics
    this.createMetric('fps', 'fps', 60, 'fps');
    this.createMetric('frameTime', 'fps', 16.67, 'ms');
    this.createMetric('avgFps', 'fps', 60, 'fps');

    // Memory metrics
    this.createMetric('heapUsed', 'memory', 0, 'MB');
    this.createMetric('heapTotal', 'memory', 0, 'MB');
    this.createMetric('rss', 'memory', 0, 'MB');
    this.createMetric('memoryPercent', 'memory', 0, '%');

    // CPU metrics
    this.createMetric('cpuUsage', 'cpu', 0, '%');
    this.createMetric('cpuUser', 'cpu', 0, 'ms');
    this.createMetric('cpuSystem', 'cpu', 0, 'ms');

    // IPC metrics
    this.createMetric('ipcLatency', 'ipc', 0, 'ms');
    this.createMetric('ipcMessages', 'ipc', 0, 'count');
    this.createMetric('ipcErrors', 'ipc', 0, 'count');

    // Voice pipeline metrics
    this.createMetric('wakeWordLatency', 'voice', 0, 'ms');
    this.createMetric('sttLatency', 'voice', 0, 'ms');
    this.createMetric('llmLatency', 'voice', 0, 'ms');
    this.createMetric('ttsLatency', 'voice', 0, 'ms');
    this.createMetric('totalResponseTime', 'voice', 0, 'ms');

    // Render metrics
    this.createMetric('particleCount', 'render', 0, 'count');
    this.createMetric('drawCalls', 'render', 0, 'count');
    this.createMetric('triangles', 'render', 0, 'count');
  }

  /**
   * Create a new metric tracker
   */
  private createMetric(name: string, category: MetricCategory, initial: number, unit: string): void {
    this.metrics.set(name, {
      name,
      category,
      current: initial,
      min: initial,
      max: initial,
      avg: initial,
      history: [],
      unit,
    });
  }

  /**
   * Record a metric value
   */
  recordMetric(name: string, value: number, metadata?: Record<string, unknown>): void {
    if (!this.config.enabled) return;

    const metric = this.metrics.get(name);
    if (!metric) {
      logger.warn(`Unknown metric: ${name}`);
      return;
    }

    const dataPoint: DataPoint = {
      timestamp: Date.now(),
      value,
      metadata,
    };

    // Update current value
    metric.current = value;

    // Update min/max
    metric.min = Math.min(metric.min, value);
    metric.max = Math.max(metric.max, value);

    // Add to history
    metric.history.push(dataPoint);

    // Trim history to max size
    if (metric.history.length > this.config.historySize) {
      metric.history.shift();
    }

    // Recalculate average
    const sum = metric.history.reduce((acc, dp) => acc + dp.value, 0);
    metric.avg = sum / metric.history.length;

    this.emit('metric', name, value, metric);
  }

  /**
   * Start IPC timing
   */
  startIPCTiming(channel: string, requestId: string): void {
    if (!this.config.enabled) return;

    const key = `${channel}:${requestId}`;
    this.ipcTimings.set(key, {
      channel,
      startTime: performance.now(),
      success: false,
    });
  }

  /**
   * End IPC timing
   */
  endIPCTiming(channel: string, requestId: string, success: boolean = true, error?: string): number {
    if (!this.config.enabled) return 0;

    const key = `${channel}:${requestId}`;
    const timing = this.ipcTimings.get(key);

    if (!timing) {
      logger.warn(`No IPC timing found for ${key}`);
      return 0;
    }

    const endTime = performance.now();
    timing.endTime = endTime;
    timing.duration = endTime - timing.startTime;
    timing.success = success;
    timing.error = error;

    // Record the latency
    this.recordMetric('ipcLatency', timing.duration, { channel, success });

    // Update message count
    const messagesMetric = this.metrics.get('ipcMessages');
    if (messagesMetric) {
      this.recordMetric('ipcMessages', messagesMetric.current + 1);
    }

    // Update error count if failed
    if (!success) {
      const errorsMetric = this.metrics.get('ipcErrors');
      if (errorsMetric) {
        this.recordMetric('ipcErrors', errorsMetric.current + 1);
      }
    }

    // Clean up
    this.ipcTimings.delete(key);

    this.emit('ipc-complete', channel, timing.duration, success);
    return timing.duration;
  }

  /**
   * Record voice pipeline timing
   */
  recordVoiceTiming(stage: keyof VoicePipelineTimings, duration: number): void {
    if (!this.config.enabled) return;

    this.voiceTimings[stage] = duration;

    // Map to metric names
    const metricMap: Partial<Record<keyof VoicePipelineTimings, string>> = {
      wakeWordDetection: 'wakeWordLatency',
      sttLatency: 'sttLatency',
      llmFirstToken: 'llmLatency',
      ttsFirstAudio: 'ttsLatency',
      totalResponseTime: 'totalResponseTime',
    };

    const metricName = metricMap[stage];
    if (metricName) {
      this.recordMetric(metricName, duration);
    }

    this.emit('voice-timing', stage, duration);
  }

  /**
   * Update render metrics from renderer process
   */
  updateRenderMetrics(metrics: RenderMetrics): void {
    if (!this.config.enabled) return;

    this.renderMetrics = metrics;

    // Record individual metrics
    this.recordMetric('fps', metrics.fps);
    this.recordMetric('avgFps', metrics.avgFps);
    this.recordMetric('frameTime', metrics.frameTime);
    this.recordMetric('particleCount', metrics.particleCount);
    this.recordMetric('drawCalls', metrics.drawCalls);
    this.recordMetric('triangles', metrics.triangles);

    this.emit('render-metrics', metrics);
  }

  /**
   * Get memory metrics
   */
  private getMemoryMetrics(): MemoryMetrics {
    const mem = process.memoryUsage();
    const heapPercent = (mem.heapUsed / mem.heapTotal) * 100;

    return {
      heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
      external: Math.round(mem.external / 1024 / 1024),
      rss: Math.round(mem.rss / 1024 / 1024),
      arrayBuffers: Math.round(mem.arrayBuffers / 1024 / 1024),
      percentUsed: Math.round(heapPercent * 100) / 100,
    };
  }

  /**
   * Get CPU metrics
   */
  private getCPUMetrics(): CPUMetrics {
    const cpuUsage = process.cpuUsage(this.lastCpuUsage ?? undefined);
    const currentTime = Date.now();
    const timeDiff = currentTime - this.lastCpuTime || 1000;

    // Calculate CPU percentage
    const userPercent = (cpuUsage.user / 1000 / timeDiff) * 100;
    const systemPercent = (cpuUsage.system / 1000 / timeDiff) * 100;
    const totalPercent = Math.min(100, userPercent + systemPercent);

    this.lastCpuUsage = process.cpuUsage();
    this.lastCpuTime = currentTime;

    return {
      usage: Math.round(totalPercent * 100) / 100,
      userTime: cpuUsage.user / 1000,
      systemTime: cpuUsage.system / 1000,
      cores: cpus().length,
      loadAverage: [], // Not available on Windows
    };
  }

  /**
   * Detect performance bottlenecks
   */
  private detectBottlenecks(): PerformanceBottleneck[] {
    const bottlenecks: PerformanceBottleneck[] = [];
    const { thresholds } = this.config;

    // Check FPS
    const fpsMetric = this.metrics.get('avgFps');
    if (fpsMetric) {
      if (fpsMetric.current < thresholds.fps.critical) {
        bottlenecks.push({
          type: 'fps',
          severity: 'critical',
          description: 'FPS critically low',
          value: fpsMetric.current,
          threshold: thresholds.fps.critical,
          recommendation: 'Reduce particle count or disable post-processing effects',
        });
      } else if (fpsMetric.current < thresholds.fps.warning) {
        bottlenecks.push({
          type: 'fps',
          severity: 'medium',
          description: 'FPS below target',
          value: fpsMetric.current,
          threshold: thresholds.fps.warning,
          recommendation: 'Consider reducing visual quality settings',
        });
      }
    }

    // Check memory
    const memPercent = this.metrics.get('memoryPercent');
    if (memPercent) {
      if (memPercent.current > thresholds.memory.critical) {
        bottlenecks.push({
          type: 'memory',
          severity: 'critical',
          description: 'Memory usage critical',
          value: memPercent.current,
          threshold: thresholds.memory.critical,
          recommendation: 'Reduce memory usage or restart application',
        });
      } else if (memPercent.current > thresholds.memory.warning) {
        bottlenecks.push({
          type: 'memory',
          severity: 'medium',
          description: 'High memory usage',
          value: memPercent.current,
          threshold: thresholds.memory.warning,
          recommendation: 'Clear conversation history or reduce cache size',
        });
      }
    }

    // Check CPU
    const cpuUsage = this.metrics.get('cpuUsage');
    if (cpuUsage) {
      if (cpuUsage.current > thresholds.cpu.critical) {
        bottlenecks.push({
          type: 'cpu',
          severity: 'high',
          description: 'High CPU usage',
          value: cpuUsage.current,
          threshold: thresholds.cpu.critical,
          recommendation: 'Reduce background processing or particle simulations',
        });
      } else if (cpuUsage.current > thresholds.cpu.warning) {
        bottlenecks.push({
          type: 'cpu',
          severity: 'low',
          description: 'Elevated CPU usage',
          value: cpuUsage.current,
          threshold: thresholds.cpu.warning,
          recommendation: 'Monitor CPU usage pattern',
        });
      }
    }

    // Check IPC latency
    const ipcLatency = this.metrics.get('ipcLatency');
    if (ipcLatency && ipcLatency.current > 0) {
      if (ipcLatency.avg > thresholds.ipcLatency.critical) {
        bottlenecks.push({
          type: 'ipc',
          severity: 'high',
          description: 'High IPC latency',
          value: ipcLatency.avg,
          threshold: thresholds.ipcLatency.critical,
          recommendation: 'Reduce IPC message frequency or batch operations',
        });
      } else if (ipcLatency.avg > thresholds.ipcLatency.warning) {
        bottlenecks.push({
          type: 'latency',
          severity: 'medium',
          description: 'Elevated IPC latency',
          value: ipcLatency.avg,
          threshold: thresholds.ipcLatency.warning,
          recommendation: 'Consider optimizing IPC payloads',
        });
      }
    }

    return bottlenecks;
  }

  /**
   * Take a performance snapshot
   */
  takeSnapshot(): PerformanceSnapshot {
    const memory = this.getMemoryMetrics();
    const cpu = this.getCPUMetrics();

    // Record memory metrics
    this.recordMetric('heapUsed', memory.heapUsed);
    this.recordMetric('heapTotal', memory.heapTotal);
    this.recordMetric('rss', memory.rss);
    this.recordMetric('memoryPercent', memory.percentUsed);

    // Record CPU metrics
    this.recordMetric('cpuUsage', cpu.usage);
    this.recordMetric('cpuUser', cpu.userTime);
    this.recordMetric('cpuSystem', cpu.systemTime);

    // Calculate IPC stats
    const ipcLatencyMetric = this.metrics.get('ipcLatency');
    const ipcMessagesMetric = this.metrics.get('ipcMessages');
    const ipcErrorsMetric = this.metrics.get('ipcErrors');

    const snapshot: PerformanceSnapshot = {
      timestamp: Date.now(),
      memory,
      cpu,
      ipc: {
        avgLatency: ipcLatencyMetric?.avg ?? 0,
        maxLatency: ipcLatencyMetric?.max ?? 0,
        messageCount: ipcMessagesMetric?.current ?? 0,
        errorCount: ipcErrorsMetric?.current ?? 0,
      },
      voice: this.voiceTimings as VoicePipelineTimings,
      render: this.renderMetrics ?? undefined,
      bottlenecks: this.detectBottlenecks(),
    };

    // Store snapshot
    this.snapshots.push(snapshot);

    // Trim snapshots
    if (this.snapshots.length > this.config.historySize) {
      this.snapshots.shift();
    }

    this.emit('snapshot', snapshot);
    return snapshot;
  }

  /**
   * Start continuous sampling
   */
  start(): void {
    if (this.isRunning || !this.config.enabled) return;

    logger.info('Starting performance profiler');
    this.isRunning = true;

    // Initialize CPU tracking
    this.lastCpuUsage = process.cpuUsage();
    this.lastCpuTime = Date.now();

    // Start sampling timer
    this.sampleTimer = setInterval(() => {
      this.takeSnapshot();
    }, this.config.sampleInterval);

    // Start auto-export timer if enabled
    if (this.config.autoExport) {
      this.exportTimer = setInterval(() => {
        this.exportReport();
      }, this.config.exportInterval);
    }

    this.emit('started');
  }

  /**
   * Stop continuous sampling
   */
  stop(): void {
    if (!this.isRunning) return;

    logger.info('Stopping performance profiler');

    if (this.sampleTimer) {
      clearInterval(this.sampleTimer);
      this.sampleTimer = null;
    }

    if (this.exportTimer) {
      clearInterval(this.exportTimer);
      this.exportTimer = null;
    }

    this.isRunning = false;
    this.emit('stopped');
  }

  /**
   * Get current metrics summary
   */
  getMetricsSummary(): Record<string, { current: number; avg: number; min: number; max: number; unit: string }> {
    const summary: Record<string, { current: number; avg: number; min: number; max: number; unit: string }> = {};

    for (const [name, metric] of this.metrics) {
      summary[name] = {
        current: metric.current,
        avg: Math.round(metric.avg * 100) / 100,
        min: Math.round(metric.min * 100) / 100,
        max: Math.round(metric.max * 100) / 100,
        unit: metric.unit,
      };
    }

    return summary;
  }

  /**
   * Get metric history for a specific metric
   */
  getMetricHistory(name: string, limit?: number): DataPoint[] {
    const metric = this.metrics.get(name);
    if (!metric) return [];

    const history = [...metric.history];
    if (limit && limit > 0) {
      return history.slice(-limit);
    }
    return history;
  }

  /**
   * Get all snapshots
   */
  getSnapshots(limit?: number): PerformanceSnapshot[] {
    if (limit && limit > 0) {
      return this.snapshots.slice(-limit);
    }
    return [...this.snapshots];
  }

  /**
   * Generate performance report
   */
  generateReport(): PerformanceReport {
    const duration = Date.now() - this.startTime;

    // Calculate summary averages
    const fpsMetric = this.metrics.get('avgFps');
    const memoryMetric = this.metrics.get('heapUsed');
    const cpuMetric = this.metrics.get('cpuUsage');
    const ipcMetric = this.metrics.get('ipcLatency');

    const bottleneckCount = this.snapshots.reduce(
      (count, snapshot) => count + snapshot.bottlenecks.length,
      0
    );

    const recommendations: string[] = [];

    // Generate recommendations based on metrics
    if (fpsMetric && fpsMetric.avg < 55) {
      recommendations.push(`Average FPS (${fpsMetric.avg.toFixed(1)}) is below target. Consider reducing particle count or disabling effects.`);
    }

    if (memoryMetric && memoryMetric.max > 400) {
      recommendations.push(`Peak memory usage (${memoryMetric.max}MB) is high. Monitor for memory leaks.`);
    }

    if (cpuMetric && cpuMetric.avg > 50) {
      recommendations.push(`Average CPU usage (${cpuMetric.avg.toFixed(1)}%) is elevated. Review active processes.`);
    }

    if (ipcMetric && ipcMetric.avg > 20) {
      recommendations.push(`IPC latency (${ipcMetric.avg.toFixed(1)}ms avg) could be optimized. Consider batching operations.`);
    }

    // Convert metrics map to object
    const metricsObj: Record<string, PerformanceMetric> = {};
    for (const [name, metric] of this.metrics) {
      metricsObj[name] = { ...metric };
    }

    return {
      generatedAt: new Date().toISOString(),
      duration,
      summary: {
        avgFps: fpsMetric?.avg ?? 60,
        avgMemory: memoryMetric?.avg ?? 0,
        avgCpu: cpuMetric?.avg ?? 0,
        avgIpcLatency: ipcMetric?.avg ?? 0,
        bottleneckCount,
      },
      snapshots: this.snapshots,
      metrics: metricsObj,
      recommendations,
    };
  }

  /**
   * Export performance report to file
   */
  exportReport(filename?: string): string {
    const report = this.generateReport();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filepath = filename || join(this.config.metricsDir, `perf-report-${timestamp}.json`);

    try {
      writeFileSync(filepath, JSON.stringify(report, null, 2));
      logger.info('Performance report exported', { filepath });
      this.emit('report-exported', filepath);
      return filepath;
    } catch (error) {
      logger.error('Failed to export performance report', { error: (error as Error).message });
      throw error;
    }
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.metrics.clear();
    this.ipcTimings.clear();
    this.snapshots = [];
    this.voiceTimings = {};
    this.renderMetrics = null;
    this.startTime = Date.now();

    this.initializeMetrics();
    this.emit('reset');
  }

  /**
   * Get profiler status
   */
  getStatus(): {
    enabled: boolean;
    running: boolean;
    uptime: number;
    snapshotCount: number;
    metricCount: number;
  } {
    return {
      enabled: this.config.enabled,
      running: this.isRunning,
      uptime: Date.now() - this.startTime,
      snapshotCount: this.snapshots.length,
      metricCount: this.metrics.size,
    };
  }

  /**
   * Update profiler configuration
   */
  updateConfig(config: Partial<ProfilerConfig>): void {
    this.config = { ...this.config, ...config };

    // Restart if running to apply new interval
    if (this.isRunning) {
      this.stop();
      this.start();
    }

    this.emit('config-updated', this.config);
  }

  /**
   * Get current configuration
   */
  getConfig(): ProfilerConfig {
    return { ...this.config };
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let profilerInstance: PerformanceProfiler | null = null;

/**
 * Get the performance profiler instance
 */
export function getPerformanceProfiler(config?: Partial<ProfilerConfig>): PerformanceProfiler {
  if (!profilerInstance) {
    profilerInstance = new PerformanceProfiler(config);
  }
  return profilerInstance;
}

/**
 * Shutdown the performance profiler
 */
export function shutdownPerformanceProfiler(): void {
  if (profilerInstance) {
    profilerInstance.stop();
    profilerInstance = null;
  }
}

/**
 * Timing decorator for functions
 */
export function measureTime<T extends (...args: unknown[]) => unknown>(
  category: MetricCategory,
  name: string,
  fn: T
): T {
  return ((...args: unknown[]) => {
    const start = performance.now();
    const result = fn(...args);

    if (result instanceof Promise) {
      return result.finally(() => {
        const duration = performance.now() - start;
        getPerformanceProfiler().recordMetric(name, duration, { category });
      });
    }

    const duration = performance.now() - start;
    getPerformanceProfiler().recordMetric(name, duration, { category });
    return result;
  }) as T;
}

/**
 * IPC timing wrapper
 */
export function withIPCTiming<T>(
  channel: string,
  requestId: string,
  fn: () => Promise<T>
): Promise<T> {
  const profiler = getPerformanceProfiler();
  profiler.startIPCTiming(channel, requestId);

  return fn()
    .then((result) => {
      profiler.endIPCTiming(channel, requestId, true);
      return result;
    })
    .catch((error) => {
      profiler.endIPCTiming(channel, requestId, false, (error as Error).message);
      throw error;
    });
}

export default PerformanceProfiler;
