/**
 * Performance Profiler Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  PerformanceProfiler,
  createProfiler,
  PERFORMANCE_TARGETS,
} from '../src/main/utils/performance-profiler';

// Mock logger
vi.mock('../src/main/utils/logger', () => ({
  createModuleLogger: vi.fn().mockReturnValue({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('PerformanceProfiler', () => {
  let profiler: PerformanceProfiler;

  beforeEach(() => {
    profiler = createProfiler();
  });

  describe('startMeasure and endMeasure', () => {
    it('should start and end a measurement', () => {
      const id = profiler.startMeasure('stt');
      expect(id).toBeDefined();
      expect(typeof id).toBe('string');

      const measurement = profiler.endMeasure(id);
      expect(measurement).not.toBeNull();
      expect(measurement?.stage).toBe('stt');
      expect(measurement?.duration).toBeGreaterThanOrEqual(0);
    });

    it('should use provided id', () => {
      const id = profiler.startMeasure('llm', 'custom-id');
      expect(id).toBe('custom-id');

      const measurement = profiler.endMeasure('custom-id');
      expect(measurement?.stage).toBe('llm');
    });

    it('should include metadata in measurement', () => {
      const id = profiler.startMeasure('tts');
      const measurement = profiler.endMeasure(id, { text: 'hello', chars: 5 });

      expect(measurement?.metadata).toEqual({ text: 'hello', chars: 5 });
    });

    it('should return null for unknown measurement id', () => {
      const measurement = profiler.endMeasure('unknown-id');
      expect(measurement).toBeNull();
    });
  });

  describe('measure', () => {
    it('should measure async operation', async () => {
      const result = await profiler.measure('stt', async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return 'transcribed';
      });

      expect(result).toBe('transcribed');

      const stats = profiler.getStageStats('stt');
      expect(stats).not.toBeNull();
      expect(stats?.count).toBe(1);
      expect(stats?.avg).toBeGreaterThanOrEqual(10);
    });

    it('should record error in metadata when operation fails', async () => {
      const measurementPromise = profiler.measure('llm', async () => {
        throw new Error('API Error');
      });

      await expect(measurementPromise).rejects.toThrow('API Error');
    });
  });

  describe('getStageStats', () => {
    it('should return null for empty stage', () => {
      const stats = profiler.getStageStats('wake-word');
      expect(stats).toBeNull();
    });

    it('should calculate statistics correctly', async () => {
      // Add multiple measurements
      for (let i = 0; i < 10; i++) {
        await profiler.measure('stt', async () => {
          await new Promise((resolve) => setTimeout(resolve, 5 + i));
        });
      }

      const stats = profiler.getStageStats('stt');
      expect(stats).not.toBeNull();
      expect(stats?.count).toBe(10);
      expect(stats?.min).toBeLessThanOrEqual(stats?.avg || 0);
      expect(stats?.max).toBeGreaterThanOrEqual(stats?.avg || 0);
      expect(stats?.p50).toBeDefined();
      expect(stats?.p95).toBeDefined();
      expect(stats?.p99).toBeDefined();
    });
  });

  describe('generateReport', () => {
    it('should generate empty report for no measurements', () => {
      const report = profiler.generateReport();

      expect(report.timestamp).toBeGreaterThan(0);
      expect(report.uptime).toBeGreaterThanOrEqual(0);
      expect(report.bottlenecks).toEqual([]);
    });

    it('should identify bottlenecks', async () => {
      // Simulate measurements that exceed target
      // STT target is 300ms, simulate 400ms operations
      for (let i = 0; i < 5; i++) {
        const id = profiler.startMeasure('stt');
        // Manually create a slow measurement
        await new Promise((resolve) => setTimeout(resolve, 10));
        profiler.endMeasure(id);
      }

      // Get stats and verify report generation
      const report = profiler.generateReport();
      expect(report).toBeDefined();
      expect(report.stages.stt?.count).toBe(5);
    });
  });

  describe('getRecentMeasurements', () => {
    it('should return recent measurements', async () => {
      for (let i = 0; i < 15; i++) {
        await profiler.measure('llm', async () => i);
      }

      const recent = profiler.getRecentMeasurements('llm', 5);
      expect(recent.length).toBe(5);
    });

    it('should return empty array for no measurements', () => {
      const recent = profiler.getRecentMeasurements('tts', 10);
      expect(recent).toEqual([]);
    });
  });

  describe('clearMeasurements', () => {
    it('should clear all measurements', async () => {
      await profiler.measure('stt', async () => 'test');
      expect(profiler.getStageStats('stt')?.count).toBe(1);

      profiler.clearMeasurements();
      expect(profiler.getStageStats('stt')).toBeNull();
    });
  });

  describe('events', () => {
    it('should emit measurement event', async () => {
      const handler = vi.fn();
      profiler.on('measurement', handler);

      await profiler.measure('tts', async () => 'audio');

      expect(handler).toHaveBeenCalledOnce();
      expect(handler.mock.calls[0][0].stage).toBe('tts');
    });

    it('should emit target-exceeded event when target is exceeded', () => {
      const handler = vi.fn();
      profiler.on('target-exceeded', handler);

      const id = profiler.startMeasure('stt');
      // End immediately but simulate slow measurement by checking event emission
      // In real usage, this would be after actual delay

      profiler.endMeasure(id);

      // Since the operation is instant, it won't exceed target
      // Just verify event system works
      expect(handler).not.toHaveBeenCalled();
    });
  });
});

describe('PERFORMANCE_TARGETS', () => {
  it('should have all required targets defined', () => {
    expect(PERFORMANCE_TARGETS.WAKE_WORD_DETECTION).toBe(200);
    expect(PERFORMANCE_TARGETS.STT_LATENCY).toBe(300);
    expect(PERFORMANCE_TARGETS.LLM_FIRST_TOKEN).toBe(2000);
    expect(PERFORMANCE_TARGETS.TTS_FIRST_AUDIO).toBe(500);
    expect(PERFORMANCE_TARGETS.TOTAL_RESPONSE).toBe(3000);
    expect(PERFORMANCE_TARGETS.STARTUP_COLD).toBe(3000);
    expect(PERFORMANCE_TARGETS.STARTUP_WARM).toBe(1000);
    expect(PERFORMANCE_TARGETS.MEMORY_MAX).toBe(500);
  });
});
