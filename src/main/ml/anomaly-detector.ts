/**
 * Atlas Desktop - Anomaly Detector
 * Detect unusual patterns in user behavior
 *
 * Features:
 * - Statistical anomaly detection
 * - Time-series analysis
 * - Behavioral baseline learning
 * - Real-time anomaly alerts
 * - Pattern deviation scoring
 *
 * @module ml/anomaly-detector
 */

import { EventEmitter } from 'events';
import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('AnomalyDetector');

// ============================================================================
// Types
// ============================================================================

export interface DataPoint {
  timestamp: number;
  metric: string;
  value: number;
  context?: Record<string, unknown>;
}

export interface Anomaly {
  id: string;
  metric: string;
  value: number;
  expected: number;
  deviation: number;
  score: number; // 0-1, higher = more anomalous
  timestamp: number;
  type: 'spike' | 'drop' | 'trend' | 'pattern' | 'outlier';
  context?: Record<string, unknown>;
}

export interface MetricBaseline {
  metric: string;
  mean: number;
  stdDev: number;
  min: number;
  max: number;
  sampleCount: number;
  hourlyMeans: number[];
  weekdayMeans: number[];
  lastUpdated: number;
}

export interface AnomalyDetectorConfig {
  windowSize: number;
  zScoreThreshold: number;
  minSamplesForBaseline: number;
  adaptiveLearningRate: number;
  seasonalityPeriod: number; // hours
}

export interface AnomalyDetectorEvents {
  'anomaly-detected': (anomaly: Anomaly) => void;
  'baseline-updated': (baseline: MetricBaseline) => void;
  'trend-detected': (metric: string, direction: 'up' | 'down', magnitude: number) => void;
  error: (error: Error) => void;
}

// ============================================================================
// Anomaly Detector
// ============================================================================

export class AnomalyDetector extends EventEmitter {
  private config: AnomalyDetectorConfig;
  private baselines: Map<string, MetricBaseline> = new Map();
  private recentData: Map<string, DataPoint[]> = new Map();
  private anomalyHistory: Anomaly[] = [];
  private dataPath: string;

  // Stats
  private stats = {
    dataPointsProcessed: 0,
    anomaliesDetected: 0,
    falsePositives: 0,
    trendsDetected: 0,
  };

  constructor(config?: Partial<AnomalyDetectorConfig>) {
    super();
    this.config = {
      windowSize: 100,
      zScoreThreshold: 2.5,
      minSamplesForBaseline: 30,
      adaptiveLearningRate: 0.1,
      seasonalityPeriod: 24,
      ...config,
    };

    this.dataPath = path.join(app.getPath('userData'), 'anomaly-baselines.json');
    this.loadData();

    logger.info('AnomalyDetector initialized', { config: this.config });
  }

  // ============================================================================
  // Data Persistence
  // ============================================================================

  private loadData(): void {
    try {
      if (fs.existsSync(this.dataPath)) {
        const data = JSON.parse(fs.readFileSync(this.dataPath, 'utf-8'));

        for (const baseline of data.baselines || []) {
          this.baselines.set(baseline.metric, baseline);
        }

        logger.info('Loaded anomaly baselines', { count: this.baselines.size });
      }
    } catch (error) {
      logger.warn('Failed to load anomaly data', { error });
    }
  }

  private saveData(): void {
    try {
      const data = {
        baselines: Array.from(this.baselines.values()),
        savedAt: Date.now(),
      };
      fs.writeFileSync(this.dataPath, JSON.stringify(data, null, 2));
    } catch (error) {
      logger.warn('Failed to save anomaly data', { error });
    }
  }

  // ============================================================================
  // Data Processing
  // ============================================================================

  /**
   * Process a data point and check for anomalies
   */
  process(dataPoint: DataPoint): Anomaly | null {
    this.stats.dataPointsProcessed++;

    // Store in recent data
    const recent = this.recentData.get(dataPoint.metric) || [];
    recent.push(dataPoint);
    if (recent.length > this.config.windowSize) {
      recent.shift();
    }
    this.recentData.set(dataPoint.metric, recent);

    // Update baseline
    this.updateBaseline(dataPoint);

    // Check for anomaly
    const anomaly = this.detectAnomaly(dataPoint);

    if (anomaly) {
      this.anomalyHistory.push(anomaly);
      if (this.anomalyHistory.length > 1000) {
        this.anomalyHistory.shift();
      }

      this.stats.anomaliesDetected++;
      this.emit('anomaly-detected', anomaly);

      logger.info('Anomaly detected', {
        metric: anomaly.metric,
        type: anomaly.type,
        score: anomaly.score.toFixed(3),
      });
    }

    // Check for trends
    if (recent.length >= 10) {
      this.detectTrend(dataPoint.metric, recent);
    }

    // Save periodically
    if (this.stats.dataPointsProcessed % 100 === 0) {
      this.saveData();
    }

    return anomaly;
  }

  /**
   * Process multiple data points
   */
  processBatch(dataPoints: DataPoint[]): Anomaly[] {
    const anomalies: Anomaly[] = [];

    for (const point of dataPoints) {
      const anomaly = this.process(point);
      if (anomaly) {
        anomalies.push(anomaly);
      }
    }

    return anomalies;
  }

  // ============================================================================
  // Baseline Management
  // ============================================================================

  /**
   * Update baseline for a metric
   */
  private updateBaseline(dataPoint: DataPoint): void {
    let baseline = this.baselines.get(dataPoint.metric);

    if (!baseline) {
      baseline = this.createBaseline(dataPoint.metric);
      this.baselines.set(dataPoint.metric, baseline);
    }

    const hour = new Date(dataPoint.timestamp).getHours();
    const weekday = new Date(dataPoint.timestamp).getDay();

    // Adaptive update using exponential moving average
    const lr = this.config.adaptiveLearningRate;
    const oldMean = baseline.mean;

    baseline.mean = baseline.mean * (1 - lr) + dataPoint.value * lr;

    // Update variance
    const diff = dataPoint.value - oldMean;
    const newDiff = dataPoint.value - baseline.mean;
    const oldVariance = baseline.stdDev * baseline.stdDev;
    const newVariance = oldVariance * (1 - lr) + diff * newDiff * lr;
    baseline.stdDev = Math.sqrt(Math.max(newVariance, 0.001));

    // Update min/max
    baseline.min = Math.min(baseline.min, dataPoint.value);
    baseline.max = Math.max(baseline.max, dataPoint.value);

    // Update hourly pattern
    baseline.hourlyMeans[hour] = baseline.hourlyMeans[hour] * (1 - lr) + dataPoint.value * lr;

    // Update weekday pattern
    baseline.weekdayMeans[weekday] = baseline.weekdayMeans[weekday] * (1 - lr) + dataPoint.value * lr;

    baseline.sampleCount++;
    baseline.lastUpdated = Date.now();

    this.emit('baseline-updated', baseline);
  }

  /**
   * Create new baseline
   */
  private createBaseline(metric: string): MetricBaseline {
    return {
      metric,
      mean: 0,
      stdDev: 1,
      min: Infinity,
      max: -Infinity,
      sampleCount: 0,
      hourlyMeans: new Array(24).fill(0),
      weekdayMeans: new Array(7).fill(0),
      lastUpdated: Date.now(),
    };
  }

  // ============================================================================
  // Anomaly Detection
  // ============================================================================

  /**
   * Detect anomaly in data point
   */
  private detectAnomaly(dataPoint: DataPoint): Anomaly | null {
    const baseline = this.baselines.get(dataPoint.metric);

    if (!baseline || baseline.sampleCount < this.config.minSamplesForBaseline) {
      return null;
    }

    // Calculate expected value considering seasonality
    const hour = new Date(dataPoint.timestamp).getHours();
    const weekday = new Date(dataPoint.timestamp).getDay();

    const hourlyAdjustment = baseline.hourlyMeans[hour] - baseline.mean;
    const weekdayAdjustment = baseline.weekdayMeans[weekday] - baseline.mean;
    const expected = baseline.mean + (hourlyAdjustment + weekdayAdjustment) / 2;

    // Calculate z-score
    const zScore = baseline.stdDev > 0 ? (dataPoint.value - expected) / baseline.stdDev : 0;

    // Check if anomalous
    if (Math.abs(zScore) < this.config.zScoreThreshold) {
      return null;
    }

    // Determine anomaly type
    let type: Anomaly['type'] = 'outlier';
    if (zScore > 0 && zScore > this.config.zScoreThreshold * 2) {
      type = 'spike';
    } else if (zScore < 0 && zScore < -this.config.zScoreThreshold * 2) {
      type = 'drop';
    }

    // Calculate anomaly score (0-1)
    const score = Math.min(Math.abs(zScore) / (this.config.zScoreThreshold * 3), 1);

    return {
      id: `anomaly_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      metric: dataPoint.metric,
      value: dataPoint.value,
      expected,
      deviation: dataPoint.value - expected,
      score,
      timestamp: dataPoint.timestamp,
      type,
      context: dataPoint.context,
    };
  }

  /**
   * Detect trends in recent data
   */
  private detectTrend(metric: string, recentData: DataPoint[]): void {
    if (recentData.length < 10) return;

    // Simple linear regression
    const n = recentData.length;
    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumX2 = 0;

    for (let i = 0; i < n; i++) {
      sumX += i;
      sumY += recentData[i].value;
      sumXY += i * recentData[i].value;
      sumX2 += i * i;
    }

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const mean = sumY / n;

    // Normalize slope by mean
    const normalizedSlope = mean !== 0 ? slope / mean : slope;

    // Check if trend is significant
    if (Math.abs(normalizedSlope) > 0.05) {
      const direction = normalizedSlope > 0 ? 'up' : 'down';
      this.stats.trendsDetected++;

      this.emit('trend-detected', metric, direction, Math.abs(normalizedSlope));

      logger.debug('Trend detected', { metric, direction, magnitude: normalizedSlope });
    }
  }

  // ============================================================================
  // Additional Detection Methods
  // ============================================================================

  /**
   * Detect pattern anomalies using isolation forest-like approach
   */
  detectPatternAnomaly(dataPoints: DataPoint[]): Anomaly[] {
    if (dataPoints.length < 2) return [];

    const anomalies: Anomaly[] = [];

    // Calculate pairwise distances
    const values = dataPoints.map((d) => d.value);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const std = Math.sqrt(values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length);

    for (let i = 0; i < dataPoints.length; i++) {
      // Calculate isolation score
      let isolationScore = 0;
      for (let j = 0; j < dataPoints.length; j++) {
        if (i !== j) {
          const distance = Math.abs(values[i] - values[j]);
          isolationScore += distance;
        }
      }
      isolationScore /= dataPoints.length - 1;

      // Normalize by standard deviation
      const normalizedScore = std > 0 ? isolationScore / std : 0;

      if (normalizedScore > this.config.zScoreThreshold) {
        anomalies.push({
          id: `pattern_anomaly_${Date.now()}_${i}`,
          metric: dataPoints[i].metric,
          value: dataPoints[i].value,
          expected: mean,
          deviation: dataPoints[i].value - mean,
          score: Math.min(normalizedScore / (this.config.zScoreThreshold * 2), 1),
          timestamp: dataPoints[i].timestamp,
          type: 'pattern',
          context: dataPoints[i].context,
        });
      }
    }

    return anomalies;
  }

  /**
   * Detect seasonal anomalies
   */
  detectSeasonalAnomaly(metric: string): Anomaly | null {
    const baseline = this.baselines.get(metric);
    const recent = this.recentData.get(metric);

    if (!baseline || !recent || recent.length === 0) return null;

    const latest = recent[recent.length - 1];
    const hour = new Date(latest.timestamp).getHours();

    const expectedForHour = baseline.hourlyMeans[hour];
    const deviation = latest.value - expectedForHour;
    const score = baseline.stdDev > 0 ? Math.abs(deviation) / baseline.stdDev : 0;

    if (score > this.config.zScoreThreshold * 1.5) {
      return {
        id: `seasonal_anomaly_${Date.now()}`,
        metric,
        value: latest.value,
        expected: expectedForHour,
        deviation,
        score: Math.min(score / (this.config.zScoreThreshold * 3), 1),
        timestamp: latest.timestamp,
        type: 'pattern',
        context: { expectedForHour, hour },
      };
    }

    return null;
  }

  // ============================================================================
  // Feedback
  // ============================================================================

  /**
   * Mark anomaly as false positive
   */
  markFalsePositive(anomalyId: string): void {
    const anomaly = this.anomalyHistory.find((a) => a.id === anomalyId);
    if (anomaly) {
      this.stats.falsePositives++;

      // Adjust baseline to be more tolerant
      const baseline = this.baselines.get(anomaly.metric);
      if (baseline) {
        baseline.stdDev *= 1.1; // Increase tolerance
        this.saveData();
      }

      logger.debug('Marked as false positive', { anomalyId });
    }
  }

  /**
   * Confirm anomaly
   */
  confirmAnomaly(anomalyId: string): void {
    const anomaly = this.anomalyHistory.find((a) => a.id === anomalyId);
    if (anomaly) {
      // Decrease tolerance for more sensitivity
      const baseline = this.baselines.get(anomaly.metric);
      if (baseline) {
        baseline.stdDev *= 0.95;
        this.saveData();
      }

      logger.debug('Anomaly confirmed', { anomalyId });
    }
  }

  // ============================================================================
  // Utilities
  // ============================================================================

  /**
   * Get baseline for metric
   */
  getBaseline(metric: string): MetricBaseline | undefined {
    return this.baselines.get(metric);
  }

  /**
   * Get all baselines
   */
  getAllBaselines(): MetricBaseline[] {
    return Array.from(this.baselines.values());
  }

  /**
   * Get recent anomalies
   */
  getRecentAnomalies(limit = 50): Anomaly[] {
    return this.anomalyHistory.slice(-limit);
  }

  /**
   * Get anomalies for metric
   */
  getAnomaliesForMetric(metric: string, limit = 20): Anomaly[] {
    return this.anomalyHistory.filter((a) => a.metric === metric).slice(-limit);
  }

  /**
   * Reset baseline for metric
   */
  resetBaseline(metric: string): void {
    this.baselines.delete(metric);
    this.recentData.delete(metric);
    this.saveData();
    logger.info('Baseline reset', { metric });
  }

  /**
   * Get statistics
   */
  getStats(): {
    dataPointsProcessed: number;
    anomaliesDetected: number;
    falsePositives: number;
    trendsDetected: number;
    metricsTracked: number;
    falsePositiveRate: number;
  } {
    return {
      ...this.stats,
      metricsTracked: this.baselines.size,
      falsePositiveRate:
        this.stats.anomaliesDetected > 0 ? this.stats.falsePositives / this.stats.anomaliesDetected : 0,
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<AnomalyDetectorConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('Config updated', { config: this.config });
  }
}

// ============================================================================
// Singleton
// ============================================================================

let anomalyDetector: AnomalyDetector | null = null;

export function getAnomalyDetector(): AnomalyDetector {
  if (!anomalyDetector) {
    anomalyDetector = new AnomalyDetector();
  }
  return anomalyDetector;
}
