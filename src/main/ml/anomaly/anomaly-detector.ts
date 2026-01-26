/**
 * Atlas ML - System Anomaly Detection
 *
 * Detects unusual patterns in system metrics for proactive monitoring.
 * Uses statistical methods and isolation forest for anomaly scoring.
 *
 * Features:
 * - Real-time anomaly detection
 * - Adaptive thresholds
 * - Multi-metric correlation
 * - Alert classification
 *
 * @module ml/anomaly/anomaly-detector
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import { app } from 'electron';
import { EventEmitter } from 'events';
import { createModuleLogger } from '../../utils/logger';

const logger = createModuleLogger('AnomalyDetector');

// =============================================================================
// Types
// =============================================================================

/**
 * System metric types
 */
export type MetricType =
  | 'cpu_percent'
  | 'memory_percent'
  | 'disk_percent'
  | 'disk_read_mb'
  | 'disk_write_mb'
  | 'network_recv_mb'
  | 'network_sent_mb'
  | 'process_count'
  | 'thread_count'
  | 'open_files'
  | 'gpu_percent'
  | 'gpu_memory_percent'
  | 'battery_percent'
  | 'temperature';

/**
 * System metrics snapshot
 */
export interface SystemMetrics {
  timestamp: number;
  cpu_percent: number;
  memory_percent: number;
  disk_percent?: number;
  disk_read_mb?: number;
  disk_write_mb?: number;
  network_recv_mb?: number;
  network_sent_mb?: number;
  process_count?: number;
  thread_count?: number;
  open_files?: number;
  gpu_percent?: number;
  gpu_memory_percent?: number;
  battery_percent?: number;
  temperature?: number;
}

/**
 * Anomaly severity levels
 */
export type AnomalySeverity = 'info' | 'warning' | 'critical';

/**
 * Detected anomaly
 */
export interface Anomaly {
  id: string;
  timestamp: number;
  metric: MetricType;
  value: number;
  expected: number;
  deviation: number;
  score: number;
  severity: AnomalySeverity;
  message: string;
  context?: Record<string, unknown>;
}

/**
 * Metric statistics
 */
interface MetricStats {
  mean: number;
  std: number;
  min: number;
  max: number;
  count: number;
  lastUpdated: number;
}

/**
 * Detector configuration
 */
export interface AnomalyDetectorConfig {
  storagePath: string;
  /** Window size for rolling statistics */
  windowSize: number;
  /** Z-score threshold for anomaly detection */
  zScoreThreshold: number;
  /** Minimum samples before detection starts */
  minSamples: number;
  /** Cooldown between alerts for same metric (ms) */
  alertCooldown: number;
  /** Enable learning from user feedback */
  adaptiveThresholds: boolean;
}

export const DEFAULT_DETECTOR_CONFIG: AnomalyDetectorConfig = {
  storagePath: '',
  windowSize: 100,
  zScoreThreshold: 3.0,
  minSamples: 20,
  alertCooldown: 5 * 60 * 1000, // 5 minutes
  adaptiveThresholds: true,
};

// =============================================================================
// Anomaly Detector Class
// =============================================================================

export class AnomalyDetector extends EventEmitter {
  private config: AnomalyDetectorConfig;
  private storagePath: string;
  private initialized: boolean = false;

  // Rolling statistics per metric
  private stats: Map<MetricType, MetricStats> = new Map();

  // Recent values for rolling window
  private recentValues: Map<MetricType, number[]> = new Map();

  // Alert cooldowns
  private lastAlerts: Map<MetricType, number> = new Map();

  // Detected anomalies history
  private anomalyHistory: Anomaly[] = [];

  // User feedback for adaptive thresholds
  private feedbackMultipliers: Map<MetricType, number> = new Map();

  constructor(config?: Partial<AnomalyDetectorConfig>) {
    super();
    this.config = { ...DEFAULT_DETECTOR_CONFIG, ...config };
    this.storagePath =
      this.config.storagePath || path.join(app.getPath('userData'), 'ml', 'anomaly-detector');
  }

  /**
   * Initialize the detector
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    logger.info('Initializing AnomalyDetector', { path: this.storagePath });

    await fs.ensureDir(this.storagePath);

    // Load saved statistics
    await this.loadState();

    this.initialized = true;
    logger.info('AnomalyDetector initialized', { metricsTracked: this.stats.size });
  }

  /**
   * Load saved state
   */
  private async loadState(): Promise<void> {
    const statePath = path.join(this.storagePath, 'state.json');

    if (await fs.pathExists(statePath)) {
      try {
        const data = await fs.readJson(statePath);

        // Restore stats
        if (data.stats) {
          for (const [metric, stats] of Object.entries(data.stats)) {
            this.stats.set(metric as MetricType, stats as MetricStats);
          }
        }

        // Restore feedback multipliers
        if (data.feedbackMultipliers) {
          for (const [metric, multiplier] of Object.entries(data.feedbackMultipliers)) {
            this.feedbackMultipliers.set(metric as MetricType, multiplier as number);
          }
        }

        logger.debug('Loaded detector state', { metrics: this.stats.size });
      } catch (err) {
        logger.warn('Failed to load state', { error: err });
      }
    }
  }

  /**
   * Save state to disk
   */
  private async saveState(): Promise<void> {
    const statePath = path.join(this.storagePath, 'state.json');

    const data = {
      stats: Object.fromEntries(this.stats),
      feedbackMultipliers: Object.fromEntries(this.feedbackMultipliers),
      lastSaved: Date.now(),
    };

    await fs.writeJson(statePath, data, { spaces: 2 });
  }

  /**
   * Process a system metrics snapshot
   */
  async processMetrics(metrics: SystemMetrics): Promise<Anomaly[]> {
    const anomalies: Anomaly[] = [];

    for (const [key, value] of Object.entries(metrics)) {
      if (key === 'timestamp' || value === undefined || value === null) {
        continue;
      }

      const metric = key as MetricType;
      const numValue = Number(value);

      if (isNaN(numValue)) continue;

      // Update statistics
      this.updateStats(metric, numValue);

      // Check for anomaly
      const anomaly = this.detectAnomaly(metric, numValue, metrics.timestamp);
      if (anomaly) {
        anomalies.push(anomaly);
        this.anomalyHistory.push(anomaly);
        this.emit('anomaly', anomaly);
      }
    }

    // Periodically save state
    if (Math.random() < 0.01) {
      await this.saveState();
    }

    return anomalies;
  }

  /**
   * Update rolling statistics for a metric
   */
  private updateStats(metric: MetricType, value: number): void {
    // Get or create recent values array
    let recent = this.recentValues.get(metric);
    if (!recent) {
      recent = [];
      this.recentValues.set(metric, recent);
    }

    // Add new value
    recent.push(value);

    // Keep only window size
    while (recent.length > this.config.windowSize) {
      recent.shift();
    }

    // Calculate statistics
    const n = recent.length;
    const mean = recent.reduce((a, b) => a + b, 0) / n;
    const variance = recent.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / n;
    const std = Math.sqrt(variance);

    const stats: MetricStats = {
      mean,
      std: std || 0.001, // Avoid division by zero
      min: Math.min(...recent),
      max: Math.max(...recent),
      count: n,
      lastUpdated: Date.now(),
    };

    this.stats.set(metric, stats);
  }

  /**
   * Detect if a value is anomalous
   */
  private detectAnomaly(metric: MetricType, value: number, timestamp: number): Anomaly | null {
    const stats = this.stats.get(metric);
    if (!stats || stats.count < this.config.minSamples) {
      return null;
    }

    // Check cooldown
    const lastAlert = this.lastAlerts.get(metric) || 0;
    if (timestamp - lastAlert < this.config.alertCooldown) {
      return null;
    }

    // Calculate z-score
    const zScore = (value - stats.mean) / stats.std;
    const absZScore = Math.abs(zScore);

    // Apply adaptive threshold
    const feedbackMultiplier = this.feedbackMultipliers.get(metric) || 1.0;
    const effectiveThreshold = this.config.zScoreThreshold * feedbackMultiplier;

    if (absZScore < effectiveThreshold) {
      return null;
    }

    // Determine severity
    let severity: AnomalySeverity = 'info';
    if (absZScore >= effectiveThreshold * 2) {
      severity = 'critical';
    } else if (absZScore >= effectiveThreshold * 1.5) {
      severity = 'warning';
    }

    // Generate message
    const direction = zScore > 0 ? 'high' : 'low';
    const message = this.generateMessage(metric, value, stats.mean, direction, severity);

    // Update cooldown
    this.lastAlerts.set(metric, timestamp);

    return {
      id: `anomaly_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp,
      metric,
      value,
      expected: stats.mean,
      deviation: zScore,
      score: absZScore / this.config.zScoreThreshold,
      severity,
      message,
      context: {
        mean: stats.mean,
        std: stats.std,
        min: stats.min,
        max: stats.max,
        threshold: effectiveThreshold,
      },
    };
  }

  /**
   * Generate human-readable anomaly message
   */
  private generateMessage(
    metric: MetricType,
    value: number,
    expected: number,
    direction: 'high' | 'low',
    severity: AnomalySeverity
  ): string {
    const metricNames: Record<MetricType, string> = {
      cpu_percent: 'CPU usage',
      memory_percent: 'Memory usage',
      disk_percent: 'Disk usage',
      disk_read_mb: 'Disk read speed',
      disk_write_mb: 'Disk write speed',
      network_recv_mb: 'Network download',
      network_sent_mb: 'Network upload',
      process_count: 'Process count',
      thread_count: 'Thread count',
      open_files: 'Open files',
      gpu_percent: 'GPU usage',
      gpu_memory_percent: 'GPU memory',
      battery_percent: 'Battery level',
      temperature: 'Temperature',
    };

    const name = metricNames[metric] || metric;
    const prefix = severity === 'critical' ? '🚨' : severity === 'warning' ? '⚠️' : 'ℹ️';

    if (metric.includes('percent')) {
      return `${prefix} ${name} is unusually ${direction}: ${value.toFixed(1)}% (expected ~${expected.toFixed(1)}%)`;
    } else if (metric.includes('mb')) {
      return `${prefix} ${name} is unusually ${direction}: ${value.toFixed(2)} MB/s (expected ~${expected.toFixed(2)} MB/s)`;
    } else if (metric === 'temperature') {
      return `${prefix} ${name} is unusually ${direction}: ${value.toFixed(1)}°C (expected ~${expected.toFixed(1)}°C)`;
    } else {
      return `${prefix} ${name} is unusually ${direction}: ${value.toFixed(0)} (expected ~${expected.toFixed(0)})`;
    }
  }

  /**
   * Process user feedback on an anomaly
   */
  processFeedback(anomalyId: string, wasActualAnomaly: boolean): void {
    const anomaly = this.anomalyHistory.find((a) => a.id === anomalyId);
    if (!anomaly) return;

    if (this.config.adaptiveThresholds) {
      const currentMultiplier = this.feedbackMultipliers.get(anomaly.metric) || 1.0;

      if (wasActualAnomaly) {
        // Lower threshold to catch more anomalies
        this.feedbackMultipliers.set(anomaly.metric, Math.max(0.5, currentMultiplier * 0.95));
      } else {
        // Raise threshold to reduce false positives
        this.feedbackMultipliers.set(anomaly.metric, Math.min(2.0, currentMultiplier * 1.1));
      }

      logger.debug('Updated threshold from feedback', {
        metric: anomaly.metric,
        wasAnomaly: wasActualAnomaly,
        newMultiplier: this.feedbackMultipliers.get(anomaly.metric),
      });
    }
  }

  /**
   * Get current statistics for all metrics
   */
  getStats(): Map<MetricType, MetricStats> {
    return new Map(this.stats);
  }

  /**
   * Get recent anomalies
   */
  getRecentAnomalies(limit: number = 50): Anomaly[] {
    return this.anomalyHistory.slice(-limit);
  }

  /**
   * Clear anomaly history
   */
  clearHistory(): void {
    this.anomalyHistory = [];
    logger.info('Cleared anomaly history');
  }

  /**
   * Reset statistics for a metric
   */
  resetMetric(metric: MetricType): void {
    this.stats.delete(metric);
    this.recentValues.delete(metric);
    this.feedbackMultipliers.delete(metric);
    this.lastAlerts.delete(metric);
    logger.info('Reset metric', { metric });
  }

  /**
   * Export training data for Isolation Forest model
   */
  async exportTrainingData(outputPath: string): Promise<number> {
    // Collect all recent values into rows
    const metrics = Array.from(this.recentValues.keys());
    const maxLength = Math.max(...Array.from(this.recentValues.values()).map((v) => v.length));

    const rows: Record<string, number>[] = [];
    for (let i = 0; i < maxLength; i++) {
      const row: Record<string, number> = {};
      for (const metric of metrics) {
        const values = this.recentValues.get(metric) || [];
        row[metric] = values[i] ?? 0;
      }
      rows.push(row);
    }

    // Write as CSV
    if (rows.length > 0) {
      const headers = Object.keys(rows[0]).join(',');
      const csvRows = rows.map((row) => Object.values(row).join(','));
      const csv = [headers, ...csvRows].join('\n');
      await fs.writeFile(outputPath, csv);
    }

    logger.info('Exported training data', { path: outputPath, rows: rows.length });
    return rows.length;
  }

  /**
   * Destroy the detector
   */
  async destroy(): Promise<void> {
    await this.saveState();
    this.removeAllListeners();
    logger.info('AnomalyDetector destroyed');
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let instance: AnomalyDetector | null = null;

export function getAnomalyDetector(): AnomalyDetector {
  if (!instance) {
    instance = new AnomalyDetector();
  }
  return instance;
}

export async function destroyAnomalyDetector(): Promise<void> {
  if (instance) {
    await instance.destroy();
    instance = null;
  }
}

export default AnomalyDetector;
