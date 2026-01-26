/**
 * GEPA Metrics Collector
 *
 * Collects and aggregates performance metrics for the GEPA system.
 * Tracks latency, token usage, error rates, and other KPIs.
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import * as fs from 'fs/promises';
import * as path from 'path';
import { getConfig } from '../config';
import { isoDate } from '../../shared/utils';

const logger = createModuleLogger('GEPA-Metrics');

// ============================================================================
// Types
// ============================================================================

/**
 * Metric types we track
 */
export type MetricType =
  | 'latency' // Response time in ms
  | 'tokens_input' // Input tokens used
  | 'tokens_output' // Output tokens used
  | 'tokens_total' // Total tokens
  | 'error_rate' // Error percentage
  | 'success_rate' // Success percentage
  | 'tool_execution_time' // Tool execution time in ms
  | 'stt_latency' // Speech-to-text latency
  | 'tts_latency' // Text-to-speech latency
  | 'llm_latency' // LLM response latency
  | 'memory_usage' // Memory usage in bytes
  | 'cpu_usage'; // CPU usage percentage

/**
 * A single metric data point
 */
export interface MetricDataPoint {
  timestamp: Date;
  type: MetricType;
  value: number;
  labels?: Record<string, string>;
}

/**
 * Aggregated metric for a time window
 */
export interface AggregatedMetric {
  type: MetricType;
  windowStart: Date;
  windowEnd: Date;
  count: number;
  sum: number;
  min: number;
  max: number;
  avg: number;
  p50: number;
  p95: number;
  p99: number;
}

/**
 * System health snapshot
 */
export interface HealthSnapshot {
  timestamp: Date;
  memoryUsedMB: number;
  memoryTotalMB: number;
  cpuPercent: number;
  uptimeSeconds: number;
  activeConnections: number;
  pendingRequests: number;
}

/**
 * Performance report for a period
 */
export interface PerformanceReport {
  periodStart: Date;
  periodEnd: Date;
  metrics: AggregatedMetric[];
  healthSnapshots: HealthSnapshot[];
  alerts: PerformanceAlert[];
}

/**
 * Performance alert
 */
export interface PerformanceAlert {
  timestamp: Date;
  type: 'warning' | 'critical';
  metric: MetricType;
  message: string;
  value: number;
  threshold: number;
}

/**
 * Metric thresholds for alerting
 */
export interface MetricThresholds {
  latency_warning: number;
  latency_critical: number;
  error_rate_warning: number;
  error_rate_critical: number;
  memory_warning: number;
  memory_critical: number;
}

// ============================================================================
// Default Thresholds
// ============================================================================

const DEFAULT_THRESHOLDS: MetricThresholds = {
  latency_warning: 3000, // 3 seconds
  latency_critical: 10000, // 10 seconds
  error_rate_warning: 0.1, // 10%
  error_rate_critical: 0.3, // 30%
  memory_warning: 0.8, // 80% of available
  memory_critical: 0.95, // 95% of available
};

// ============================================================================
// Metrics Collector
// ============================================================================

export class MetricsCollector extends EventEmitter {
  private dataPoints: MetricDataPoint[] = [];
  private healthSnapshots: HealthSnapshot[] = [];
  private alerts: PerformanceAlert[] = [];
  private thresholds: MetricThresholds;
  private dataDir: string;
  private initialized = false;

  // Circular buffer settings
  private readonly MAX_DATA_POINTS = 10000;
  private readonly MAX_HEALTH_SNAPSHOTS = 1440; // 24 hours at 1/minute
  private readonly MAX_ALERTS = 500;

  // Timers
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private persistTimer: NodeJS.Timeout | null = null;
  private readonly HEALTH_CHECK_INTERVAL = 60000; // 1 minute
  private readonly PERSIST_INTERVAL = 300000; // 5 minutes

  constructor(thresholds?: Partial<MetricThresholds>) {
    super();
    this.setMaxListeners(20);
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };
    this.dataDir = '';
  }

  // --------------------------------------------------------------------------
  // Initialization
  // --------------------------------------------------------------------------

  /**
   * Initialize the metrics collector
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      const config = getConfig();
      const atlasDir = path.dirname(config.logDir);
      this.dataDir = path.join(atlasDir, 'gepa', 'metrics');

      await fs.mkdir(this.dataDir, { recursive: true });

      // Start health check timer
      this.healthCheckTimer = setInterval(
        () => this.collectHealthSnapshot(),
        this.HEALTH_CHECK_INTERVAL
      );

      // Start persist timer
      this.persistTimer = setInterval(() => this.persistMetrics(), this.PERSIST_INTERVAL);

      // Initial health snapshot
      await this.collectHealthSnapshot();

      this.initialized = true;
      logger.info('Metrics collector initialized', { dataDir: this.dataDir });
    } catch (error) {
      logger.error('Failed to initialize metrics collector:', error);
      throw error;
    }
  }

  // --------------------------------------------------------------------------
  // Recording Metrics
  // --------------------------------------------------------------------------

  /**
   * Record a metric data point
   */
  record(type: MetricType, value: number, labels?: Record<string, string>): void {
    const dataPoint: MetricDataPoint = {
      timestamp: new Date(),
      type,
      value,
      labels,
    };

    this.dataPoints.push(dataPoint);

    // Circular buffer - remove oldest if over limit
    if (this.dataPoints.length > this.MAX_DATA_POINTS) {
      this.dataPoints.shift();
    }

    // Check thresholds
    this.checkThresholds(dataPoint);

    logger.debug('Metric recorded', { type, value, labels });
  }

  /**
   * Record latency measurement
   */
  recordLatency(component: string, durationMs: number): void {
    this.record('latency', durationMs, { component });

    // Also record component-specific latency
    if (component === 'stt') {
      this.record('stt_latency', durationMs);
    } else if (component === 'tts') {
      this.record('tts_latency', durationMs);
    } else if (component === 'llm') {
      this.record('llm_latency', durationMs);
    }
  }

  /**
   * Record token usage
   */
  recordTokens(inputTokens: number, outputTokens: number, model?: string): void {
    this.record('tokens_input', inputTokens, { model: model || 'unknown' });
    this.record('tokens_output', outputTokens, { model: model || 'unknown' });
    this.record('tokens_total', inputTokens + outputTokens, { model: model || 'unknown' });
  }

  /**
   * Record tool execution
   */
  recordToolExecution(toolName: string, durationMs: number, success: boolean): void {
    this.record('tool_execution_time', durationMs, { tool: toolName, success: String(success) });

    if (success) {
      this.record('success_rate', 1, { tool: toolName });
    } else {
      this.record('error_rate', 1, { tool: toolName });
    }
  }

  /**
   * Create a timer for measuring duration
   */
  startTimer(): () => number {
    const start = performance.now();
    return () => {
      const duration = performance.now() - start;
      return Math.round(duration);
    };
  }

  // --------------------------------------------------------------------------
  // Health Monitoring
  // --------------------------------------------------------------------------

  /**
   * Collect a health snapshot
   */
  private async collectHealthSnapshot(): Promise<void> {
    try {
      const memoryUsage = process.memoryUsage();
      const cpuUsage = process.cpuUsage();

      const snapshot: HealthSnapshot = {
        timestamp: new Date(),
        memoryUsedMB: Math.round(memoryUsage.heapUsed / 1024 / 1024),
        memoryTotalMB: Math.round(memoryUsage.heapTotal / 1024 / 1024),
        cpuPercent: Math.round((cpuUsage.user + cpuUsage.system) / 1000000), // Rough estimate
        uptimeSeconds: Math.round(process.uptime()),
        activeConnections: 0, // Would need to track these
        pendingRequests: 0, // Would need to track these
      };

      this.healthSnapshots.push(snapshot);

      // Circular buffer
      if (this.healthSnapshots.length > this.MAX_HEALTH_SNAPSHOTS) {
        this.healthSnapshots.shift();
      }

      // Check memory thresholds
      const memoryRatio = snapshot.memoryUsedMB / snapshot.memoryTotalMB;
      if (memoryRatio >= this.thresholds.memory_critical) {
        this.addAlert('critical', 'memory_usage', memoryRatio, this.thresholds.memory_critical);
      } else if (memoryRatio >= this.thresholds.memory_warning) {
        this.addAlert('warning', 'memory_usage', memoryRatio, this.thresholds.memory_warning);
      }

      this.record('memory_usage', memoryUsage.heapUsed);
    } catch (error) {
      logger.error('Failed to collect health snapshot:', error);
    }
  }

  // --------------------------------------------------------------------------
  // Threshold Checking
  // --------------------------------------------------------------------------

  /**
   * Check if a metric exceeds thresholds
   */
  private checkThresholds(dataPoint: MetricDataPoint): void {
    if (dataPoint.type === 'latency') {
      if (dataPoint.value >= this.thresholds.latency_critical) {
        this.addAlert('critical', 'latency', dataPoint.value, this.thresholds.latency_critical);
      } else if (dataPoint.value >= this.thresholds.latency_warning) {
        this.addAlert('warning', 'latency', dataPoint.value, this.thresholds.latency_warning);
      }
    }
  }

  /**
   * Add a performance alert
   */
  private addAlert(
    type: 'warning' | 'critical',
    metric: MetricType,
    value: number,
    threshold: number
  ): void {
    const alert: PerformanceAlert = {
      timestamp: new Date(),
      type,
      metric,
      message: `${metric} ${type}: ${value.toFixed(2)} exceeds threshold ${threshold}`,
      value,
      threshold,
    };

    this.alerts.push(alert);

    // Circular buffer
    if (this.alerts.length > this.MAX_ALERTS) {
      this.alerts.shift();
    }

    this.emit('alert', alert);
    logger.warn('Performance alert', { alert: JSON.stringify(alert) });
  }

  // --------------------------------------------------------------------------
  // Aggregation
  // --------------------------------------------------------------------------

  /**
   * Aggregate metrics for a time window
   */
  aggregate(type: MetricType, windowStart: Date, windowEnd: Date): AggregatedMetric {
    const points = this.dataPoints.filter(
      (p) => p.type === type && p.timestamp >= windowStart && p.timestamp <= windowEnd
    );

    if (points.length === 0) {
      return {
        type,
        windowStart,
        windowEnd,
        count: 0,
        sum: 0,
        min: 0,
        max: 0,
        avg: 0,
        p50: 0,
        p95: 0,
        p99: 0,
      };
    }

    const values = points.map((p) => p.value).sort((a, b) => a - b);
    const sum = values.reduce((a, b) => a + b, 0);

    return {
      type,
      windowStart,
      windowEnd,
      count: values.length,
      sum,
      min: values[0],
      max: values[values.length - 1],
      avg: sum / values.length,
      p50: this.percentile(values, 0.5),
      p95: this.percentile(values, 0.95),
      p99: this.percentile(values, 0.99),
    };
  }

  /**
   * Calculate percentile from sorted values
   */
  private percentile(sortedValues: number[], p: number): number {
    if (sortedValues.length === 0) return 0;
    const index = Math.ceil(sortedValues.length * p) - 1;
    return sortedValues[Math.max(0, Math.min(index, sortedValues.length - 1))];
  }

  // --------------------------------------------------------------------------
  // Reporting
  // --------------------------------------------------------------------------

  /**
   * Generate a performance report for a period
   */
  generateReport(periodStart: Date, periodEnd: Date): PerformanceReport {
    const metricTypes: MetricType[] = [
      'latency',
      'tokens_total',
      'stt_latency',
      'tts_latency',
      'llm_latency',
      'tool_execution_time',
      'memory_usage',
    ];

    const metrics = metricTypes.map((type) => this.aggregate(type, periodStart, periodEnd));

    const healthSnapshots = this.healthSnapshots.filter(
      (s) => s.timestamp >= periodStart && s.timestamp <= periodEnd
    );

    const alerts = this.alerts.filter(
      (a) => a.timestamp >= periodStart && a.timestamp <= periodEnd
    );

    return {
      periodStart,
      periodEnd,
      metrics,
      healthSnapshots,
      alerts,
    };
  }

  /**
   * Get recent metrics summary
   */
  getRecentSummary(
    minutes: number = 60
  ): Record<MetricType, { avg: number; p95: number; count: number }> {
    const windowEnd = new Date();
    const windowStart = new Date(windowEnd.getTime() - minutes * 60 * 1000);

    const summary: Record<MetricType, { avg: number; p95: number; count: number }> = {} as Record<
      MetricType,
      { avg: number; p95: number; count: number }
    >;

    const metricTypes: MetricType[] = [
      'latency',
      'tokens_total',
      'stt_latency',
      'tts_latency',
      'llm_latency',
      'tool_execution_time',
    ];

    for (const type of metricTypes) {
      const agg = this.aggregate(type, windowStart, windowEnd);
      summary[type] = {
        avg: agg.avg,
        p95: agg.p95,
        count: agg.count,
      };
    }

    return summary;
  }

  /**
   * Get recent alerts
   */
  getRecentAlerts(count: number = 20): PerformanceAlert[] {
    return this.alerts.slice(-count);
  }

  // --------------------------------------------------------------------------
  // Persistence
  // --------------------------------------------------------------------------

  /**
   * Persist metrics to disk
   */
  private async persistMetrics(): Promise<void> {
    if (!this.initialized || this.dataPoints.length === 0) return;

    try {
      const now = new Date();
      const dateStr = isoDate(now);
      const hourStr = now.getHours().toString().padStart(2, '0');
      const fileName = `metrics-${dateStr}-${hourStr}.jsonl`;
      const filePath = path.join(this.dataDir, fileName);

      // Get metrics from last persist interval
      const cutoff = new Date(now.getTime() - this.PERSIST_INTERVAL);
      const recentMetrics = this.dataPoints.filter((p) => p.timestamp >= cutoff);

      if (recentMetrics.length === 0) return;

      const lines = recentMetrics.map((p) => JSON.stringify(p)).join('\n') + '\n';
      await fs.appendFile(filePath, lines, 'utf-8');

      logger.debug('Metrics persisted', { count: recentMetrics.length, file: fileName });
    } catch (error) {
      logger.error('Failed to persist metrics:', error);
    }
  }

  /**
   * Load historical metrics from disk
   */
  async loadHistoricalMetrics(date: Date): Promise<MetricDataPoint[]> {
    const dateStr = isoDate(date);
    const metrics: MetricDataPoint[] = [];

    try {
      const files = await fs.readdir(this.dataDir);
      const matchingFiles = files.filter((f) => f.startsWith(`metrics-${dateStr}`));

      for (const file of matchingFiles) {
        const content = await fs.readFile(path.join(this.dataDir, file), 'utf-8');
        const lines = content.split('\n').filter((l) => l.trim());

        for (const line of lines) {
          try {
            const point = JSON.parse(line) as MetricDataPoint;
            point.timestamp = new Date(point.timestamp);
            metrics.push(point);
          } catch {
            // Skip malformed lines
          }
        }
      }
    } catch {
      // Directory or files don't exist
    }

    return metrics;
  }

  // --------------------------------------------------------------------------
  // Cleanup
  // --------------------------------------------------------------------------

  /**
   * Cleanup and persist remaining data
   */
  async cleanup(): Promise<void> {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }

    if (this.persistTimer) {
      clearInterval(this.persistTimer);
      this.persistTimer = null;
    }

    await this.persistMetrics();

    this.dataPoints = [];
    this.healthSnapshots = [];
    this.alerts = [];
    this.initialized = false;

    logger.info('Metrics collector cleaned up');
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

let metricsCollectorInstance: MetricsCollector | null = null;

export function getMetricsCollector(): MetricsCollector {
  if (!metricsCollectorInstance) {
    metricsCollectorInstance = new MetricsCollector();
  }
  return metricsCollectorInstance;
}

export default MetricsCollector;
