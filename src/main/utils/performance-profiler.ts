/**
 * Performance Profiler
 *
 * Provides instrumentation for measuring pipeline stage latencies.
 * Tracks performance metrics against defined targets.
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from './logger';

const logger = createModuleLogger('performance-profiler');

/**
 * Performance targets from CLAUDE.md
 */
export const PERFORMANCE_TARGETS = {
  WAKE_WORD_DETECTION: 200, // ms
  STT_LATENCY: 300, // ms
  LLM_FIRST_TOKEN: 2000, // ms
  TTS_FIRST_AUDIO: 500, // ms
  TOTAL_RESPONSE: 3000, // ms
  STARTUP_COLD: 3000, // ms
  STARTUP_WARM: 1000, // ms
  MEMORY_MAX: 500, // MB
} as const;

/**
 * Pipeline stages that can be profiled
 */
export type PipelineStage =
  | 'wake-word'
  | 'vad'
  | 'stt'
  | 'llm'
  | 'tts'
  | 'total';

/**
 * Single performance measurement
 */
export interface PerformanceMeasurement {
  stage: PipelineStage;
  startTime: number;
  endTime: number;
  duration: number;
  metadata?: Record<string, unknown>;
}

/**
 * Aggregated statistics for a stage
 */
export interface StageStatistics {
  stage: PipelineStage;
  count: number;
  min: number;
  max: number;
  avg: number;
  p50: number;
  p95: number;
  p99: number;
  target: number;
  targetMet: boolean;
}

/**
 * Performance report
 */
export interface PerformanceReport {
  timestamp: number;
  uptime: number;
  stages: Record<PipelineStage, StageStatistics>;
  bottlenecks: string[];
  recommendations: string[];
}

/**
 * Performance Profiler class
 */
export class PerformanceProfiler extends EventEmitter {
  private measurements: Map<PipelineStage, PerformanceMeasurement[]> = new Map();
  private activeMeasurements: Map<string, { stage: PipelineStage; startTime: number }> =
    new Map();
  private startTime: number;
  private maxMeasurements = 1000; // Per stage

  constructor() {
    super();
    this.startTime = Date.now();
    this.initializeStages();
  }

  private initializeStages(): void {
    const stages: PipelineStage[] = ['wake-word', 'vad', 'stt', 'llm', 'tts', 'total'];
    stages.forEach((stage) => {
      this.measurements.set(stage, []);
    });
  }

  /**
   * Start measuring a pipeline stage
   */
  startMeasure(stage: PipelineStage, id?: string): string {
    const measureId = id || `${stage}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.activeMeasurements.set(measureId, {
      stage,
      startTime: performance.now(),
    });
    return measureId;
  }

  /**
   * End measuring a pipeline stage
   */
  endMeasure(id: string, metadata?: Record<string, unknown>): PerformanceMeasurement | null {
    const active = this.activeMeasurements.get(id);
    if (!active) {
      logger.warn(`No active measurement found for id: ${id}`);
      return null;
    }

    const endTime = performance.now();
    const duration = endTime - active.startTime;

    const measurement: PerformanceMeasurement = {
      stage: active.stage,
      startTime: active.startTime,
      endTime,
      duration,
      metadata,
    };

    // Store measurement
    const stageMeasurements = this.measurements.get(active.stage) || [];
    stageMeasurements.push(measurement);

    // Trim to max measurements
    if (stageMeasurements.length > this.maxMeasurements) {
      stageMeasurements.shift();
    }

    this.measurements.set(active.stage, stageMeasurements);
    this.activeMeasurements.delete(id);

    // Emit measurement event
    this.emit('measurement', measurement);

    // Check against target
    const target = this.getTarget(active.stage);
    if (target && duration > target) {
      logger.warn(`${active.stage} exceeded target: ${duration.toFixed(2)}ms > ${target}ms`);
      this.emit('target-exceeded', { stage: active.stage, duration, target });
    }

    return measurement;
  }

  /**
   * Convenience method to measure an async operation
   */
  async measure<T>(
    stage: PipelineStage,
    operation: () => Promise<T>,
    metadata?: Record<string, unknown>
  ): Promise<T> {
    const id = this.startMeasure(stage);
    try {
      const result = await operation();
      this.endMeasure(id, metadata);
      return result;
    } catch (error) {
      this.endMeasure(id, { ...metadata, error: true });
      throw error;
    }
  }

  /**
   * Get target for a stage
   */
  private getTarget(stage: PipelineStage): number | null {
    const targetMap: Record<PipelineStage, number | null> = {
      'wake-word': PERFORMANCE_TARGETS.WAKE_WORD_DETECTION,
      vad: null, // No specific target
      stt: PERFORMANCE_TARGETS.STT_LATENCY,
      llm: PERFORMANCE_TARGETS.LLM_FIRST_TOKEN,
      tts: PERFORMANCE_TARGETS.TTS_FIRST_AUDIO,
      total: PERFORMANCE_TARGETS.TOTAL_RESPONSE,
    };
    return targetMap[stage];
  }

  /**
   * Calculate statistics for a stage
   */
  getStageStats(stage: PipelineStage): StageStatistics | null {
    const measurements = this.measurements.get(stage);
    if (!measurements || measurements.length === 0) {
      return null;
    }

    const durations = measurements.map((m) => m.duration).sort((a, b) => a - b);
    const count = durations.length;
    const min = durations[0];
    const max = durations[count - 1];
    const avg = durations.reduce((a, b) => a + b, 0) / count;
    const p50 = durations[Math.floor(count * 0.5)];
    const p95 = durations[Math.floor(count * 0.95)];
    const p99 = durations[Math.floor(count * 0.99)];
    const target = this.getTarget(stage) || 0;
    const targetMet = p95 <= target || target === 0;

    return {
      stage,
      count,
      min,
      max,
      avg,
      p50,
      p95,
      p99,
      target,
      targetMet,
    };
  }

  /**
   * Generate a full performance report
   */
  generateReport(): PerformanceReport {
    const stages: PipelineStage[] = ['wake-word', 'vad', 'stt', 'llm', 'tts', 'total'];
    const stageStats: Record<PipelineStage, StageStatistics> = {} as any;
    const bottlenecks: string[] = [];
    const recommendations: string[] = [];

    for (const stage of stages) {
      const stats = this.getStageStats(stage);
      if (stats) {
        stageStats[stage] = stats;

        // Identify bottlenecks
        if (stats.target > 0 && !stats.targetMet) {
          bottlenecks.push(
            `${stage}: p95 (${stats.p95.toFixed(0)}ms) exceeds target (${stats.target}ms)`
          );
        }

        // Add recommendations
        if (stats.p95 > stats.avg * 2) {
          recommendations.push(
            `${stage}: High variance detected. Consider connection pooling or caching.`
          );
        }
      }
    }

    // Add general recommendations
    if (bottlenecks.length > 0) {
      recommendations.push('Consider pre-warming connections on app startup.');
      recommendations.push('Review network latency and API endpoint locations.');
    }

    return {
      timestamp: Date.now(),
      uptime: Date.now() - this.startTime,
      stages: stageStats,
      bottlenecks,
      recommendations,
    };
  }

  /**
   * Get recent measurements for a stage
   */
  getRecentMeasurements(stage: PipelineStage, count = 10): PerformanceMeasurement[] {
    const measurements = this.measurements.get(stage) || [];
    return measurements.slice(-count);
  }

  /**
   * Clear all measurements
   */
  clearMeasurements(): void {
    this.initializeStages();
    this.activeMeasurements.clear();
    logger.info('Performance measurements cleared');
  }

  /**
   * Log a summary to the console/logger
   */
  logSummary(): void {
    const report = this.generateReport();

    logger.info('=== Performance Report ===');
    logger.info(`Uptime: ${(report.uptime / 1000).toFixed(1)}s`);

    for (const [stage, stats] of Object.entries(report.stages)) {
      if (stats.count > 0) {
        const status = stats.targetMet ? '✓' : '✗';
        logger.info(
          `${status} ${stage}: avg=${stats.avg.toFixed(0)}ms, p95=${stats.p95.toFixed(0)}ms, target=${stats.target}ms`
        );
      }
    }

    if (report.bottlenecks.length > 0) {
      logger.warn('Bottlenecks:');
      report.bottlenecks.forEach((b) => logger.warn(`  - ${b}`));
    }

    if (report.recommendations.length > 0) {
      logger.info('Recommendations:');
      report.recommendations.forEach((r) => logger.info(`  - ${r}`));
    }
  }
}

// Singleton instance
let profilerInstance: PerformanceProfiler | null = null;

/**
 * Get the global profiler instance
 */
export function getProfiler(): PerformanceProfiler {
  if (!profilerInstance) {
    profilerInstance = new PerformanceProfiler();
  }
  return profilerInstance;
}

/**
 * Create a scoped profiler for testing
 */
export function createProfiler(): PerformanceProfiler {
  return new PerformanceProfiler();
}

/**
 * Convenience decorator for measuring method execution
 */
export function profileMethod(stage: PipelineStage) {
  return function (
    _target: any,
    _propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const profiler = getProfiler();
      const id = profiler.startMeasure(stage);
      try {
        const result = await originalMethod.apply(this, args);
        profiler.endMeasure(id);
        return result;
      } catch (error) {
        profiler.endMeasure(id, { error: true });
        throw error;
      }
    };

    return descriptor;
  };
}
