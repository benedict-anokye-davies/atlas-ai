/**
 * Atlas Desktop - Memory Leak Detection Tests
 *
 * Tests for the memory monitoring system, leak detection algorithms,
 * and alert mechanisms.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock Electron modules
vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
  app: {
    getPath: vi.fn(() => '/mock/path'),
  },
}));

// Mock v8 module
const mockHeapStats = {
  total_heap_size: 50 * 1024 * 1024, // 50MB
  total_heap_size_executable: 1 * 1024 * 1024,
  total_physical_size: 45 * 1024 * 1024,
  total_available_size: 500 * 1024 * 1024,
  used_heap_size: 30 * 1024 * 1024, // 30MB
  heap_size_limit: 512 * 1024 * 1024, // 512MB
  malloced_memory: 2 * 1024 * 1024,
  peak_malloced_memory: 3 * 1024 * 1024,
  external_memory: 1 * 1024 * 1024,
};

vi.mock('v8', () => ({
  getHeapStatistics: vi.fn(() => ({ ...mockHeapStats })),
  writeHeapSnapshot: vi.fn(() => '/mock/snapshot.heapsnapshot'),
}));

// Mock process.memoryUsage
const originalMemoryUsage = process.memoryUsage;
const mockMemoryUsage = vi.fn(() => ({
  rss: 100 * 1024 * 1024,
  heapTotal: 50 * 1024 * 1024,
  heapUsed: 30 * 1024 * 1024,
  external: 5 * 1024 * 1024,
  arrayBuffers: 1 * 1024 * 1024,
}));

// Import after mocks
import {
  MemoryMonitor,
  getMemoryMonitor,
  shutdownMemoryMonitor,
  createTrackedInterval,
  clearTrackedInterval,
  createTrackedTimeout,
  clearTrackedTimeout,
  type MemorySnapshot,
  type MemoryGrowthAnalysis,
  type MemoryAlert,
  type LeakPattern,
  type MemoryMonitorConfig,
} from '../../src/main/performance/memory-monitor';
import * as v8 from 'v8';

describe('MemoryMonitor', () => {
  let monitor: MemoryMonitor;

  beforeEach(() => {
    vi.useFakeTimers();
    process.memoryUsage = mockMemoryUsage as typeof process.memoryUsage;
    vi.mocked(v8.getHeapStatistics).mockReturnValue({ ...mockHeapStats });
    monitor = new MemoryMonitor({
      samplingIntervalMs: 1000,
      maxSamples: 100,
      warningThresholdMB: 100,
      criticalThresholdMB: 200,
      analysisWindowMinutes: 1,
    });
  });

  afterEach(() => {
    monitor.stop();
    shutdownMemoryMonitor();
    vi.useRealTimers();
    process.memoryUsage = originalMemoryUsage;
    vi.clearAllMocks();
  });

  describe('Lifecycle', () => {
    it('should start monitoring', () => {
      const startedHandler = vi.fn();
      monitor.on('started', startedHandler);

      monitor.start();

      expect(startedHandler).toHaveBeenCalledTimes(1);
      expect(monitor.getStatus().isRunning).toBe(true);
    });

    it('should stop monitoring', () => {
      const stoppedHandler = vi.fn();
      monitor.on('stopped', stoppedHandler);

      monitor.start();
      monitor.stop();

      expect(stoppedHandler).toHaveBeenCalledTimes(1);
      expect(monitor.getStatus().isRunning).toBe(false);
    });

    it('should not start twice', () => {
      const startedHandler = vi.fn();
      monitor.on('started', startedHandler);

      monitor.start();
      monitor.start();

      expect(startedHandler).toHaveBeenCalledTimes(1);
    });

    it('should emit sample events', () => {
      const sampleHandler = vi.fn();
      monitor.on('sample', sampleHandler);

      monitor.start();

      expect(sampleHandler).toHaveBeenCalledTimes(1);
      expect(sampleHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          processType: 'main',
          heapUsedMB: expect.any(Number),
        })
      );
    });

    it('should collect samples at intervals', () => {
      const sampleHandler = vi.fn();
      monitor.on('sample', sampleHandler);

      monitor.start();
      expect(sampleHandler).toHaveBeenCalledTimes(1); // Initial sample

      vi.advanceTimersByTime(1000);
      expect(sampleHandler).toHaveBeenCalledTimes(2);

      vi.advanceTimersByTime(1000);
      expect(sampleHandler).toHaveBeenCalledTimes(3);
    });
  });

  describe('Memory Snapshots', () => {
    it('should capture correct heap statistics', () => {
      const snapshot = monitor.takeSnapshot();

      expect(snapshot.processType).toBe('main');
      expect(snapshot.processId).toBe(process.pid);
      expect(snapshot.heap.usedHeapSize).toBe(30 * 1024 * 1024);
      expect(snapshot.heap.totalHeapSize).toBe(50 * 1024 * 1024);
      expect(snapshot.heap.heapSizeLimit).toBe(512 * 1024 * 1024);
    });

    it('should calculate MB values correctly', () => {
      const snapshot = monitor.takeSnapshot();

      expect(snapshot.heapUsedMB).toBeCloseTo(30, 0);
      expect(snapshot.heapTotalMB).toBeCloseTo(50, 0);
      expect(snapshot.rssMB).toBeCloseTo(100, 0);
    });

    it('should include timestamp', () => {
      const before = Date.now();
      const snapshot = monitor.takeSnapshot();
      const after = Date.now();

      expect(snapshot.timestamp).toBeGreaterThanOrEqual(before);
      expect(snapshot.timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe('Threshold Alerts', () => {
    it('should emit warning alert when warning threshold exceeded', () => {
      const alertHandler = vi.fn();
      monitor.on('alert', alertHandler);

      // Set heap to exceed warning threshold (100MB)
      vi.mocked(v8.getHeapStatistics).mockReturnValue({
        ...mockHeapStats,
        used_heap_size: 150 * 1024 * 1024, // 150MB
      });

      monitor.start();

      expect(alertHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'threshold-exceeded',
          severity: 'warning',
          processType: 'main',
        })
      );
    });

    it('should emit critical alert when critical threshold exceeded', () => {
      const alertHandler = vi.fn();
      monitor.on('alert', alertHandler);

      // Set heap to exceed critical threshold (200MB)
      vi.mocked(v8.getHeapStatistics).mockReturnValue({
        ...mockHeapStats,
        used_heap_size: 250 * 1024 * 1024, // 250MB
      });

      monitor.start();

      expect(alertHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'threshold-exceeded',
          severity: 'critical',
          processType: 'main',
        })
      );
    });

    it('should emit OOM risk alert at 90% heap usage', () => {
      const alertHandler = vi.fn();
      monitor.on('alert', alertHandler);

      // Set heap to 90%+ of limit
      vi.mocked(v8.getHeapStatistics).mockReturnValue({
        ...mockHeapStats,
        used_heap_size: 470 * 1024 * 1024, // ~92% of 512MB limit
        heap_size_limit: 512 * 1024 * 1024,
      });

      monitor.start();

      expect(alertHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'oom-risk',
          severity: 'critical',
        })
      );
    });

    it('should not emit alert when under thresholds', () => {
      const alertHandler = vi.fn();
      monitor.on('alert', alertHandler);

      // Keep heap at 30MB (under 100MB warning threshold)
      monitor.start();

      expect(alertHandler).not.toHaveBeenCalled();
    });
  });

  describe('Memory Growth Analysis', () => {
    it('should return stable analysis with insufficient samples', () => {
      const analysis = monitor.analyzeGrowth('main');

      expect(analysis.isLeaking).toBe(false);
      expect(analysis.sampleCount).toBe(0);
      expect(analysis.confidenceScore).toBe(0);
    });

    it('should detect stable memory when no growth', () => {
      monitor.start();

      // Collect multiple samples with same memory
      for (let i = 0; i < 10; i++) {
        vi.advanceTimersByTime(1000);
      }

      const analysis = monitor.analyzeGrowth('main');

      expect(analysis.trendDirection).toBe('stable');
      expect(analysis.isLeaking).toBe(false);
    });

    it('should detect increasing trend with memory growth', () => {
      let usedHeap = 30 * 1024 * 1024;

      monitor.start();

      // Simulate growing memory
      for (let i = 0; i < 30; i++) {
        usedHeap += 5 * 1024 * 1024; // Grow by 5MB each second
        vi.mocked(v8.getHeapStatistics).mockReturnValue({
          ...mockHeapStats,
          used_heap_size: usedHeap,
        });
        vi.advanceTimersByTime(1000);
      }

      const analysis = monitor.analyzeGrowth('main');

      expect(analysis.trendDirection).toBe('increasing');
      expect(analysis.growthRateMBPerMinute).toBeGreaterThan(0);
    });

    it('should detect memory leak with consistent high growth', () => {
      let usedHeap = 30 * 1024 * 1024;

      // Use larger growth rate to ensure leak detection
      const leakMonitor = new MemoryMonitor({
        samplingIntervalMs: 1000,
        analysisWindowMinutes: 1,
        leakGrowthRateMBPerMinute: 1.0,
        autoDetectLeaks: false, // We'll analyze manually
      });

      leakMonitor.start();

      // Simulate steady leak - 10MB per sample, 10 samples per minute = 100 MB/min growth
      for (let i = 0; i < 30; i++) {
        usedHeap += 10 * 1024 * 1024; // Grow by 10MB each second
        vi.mocked(v8.getHeapStatistics).mockReturnValue({
          ...mockHeapStats,
          used_heap_size: usedHeap,
        });
        vi.advanceTimersByTime(1000);
      }

      const analysis = leakMonitor.analyzeGrowth('main');

      expect(analysis.isLeaking).toBe(true);
      expect(analysis.growthRateMBPerMinute).toBeGreaterThan(1);
      expect(analysis.confidenceScore).toBeGreaterThan(0.5);

      leakMonitor.stop();
    });

    it('should calculate average and peak heap correctly', () => {
      let usedHeap = 30 * 1024 * 1024;
      const heapValues: number[] = [];

      monitor.start();

      for (let i = 0; i < 10; i++) {
        heapValues.push(usedHeap / (1024 * 1024));
        usedHeap += 5 * 1024 * 1024;
        vi.mocked(v8.getHeapStatistics).mockReturnValue({
          ...mockHeapStats,
          used_heap_size: usedHeap,
        });
        vi.advanceTimersByTime(1000);
      }

      const analysis = monitor.analyzeGrowth('main');

      expect(analysis.peakHeapUsedMB).toBeGreaterThanOrEqual(analysis.averageHeapUsedMB);
    });
  });

  describe('Leak Pattern Detection', () => {
    it('should detect event listener accumulation', () => {
      // Track many event listeners
      for (let i = 0; i < 150; i++) {
        monitor.trackEventListener('window', 'resize', 1);
      }

      const pattern = monitor.detectLeakPattern();

      expect(pattern.type).toBe('event-listener-accumulation');
      expect(pattern.severity).toBe('high');
    });

    it('should detect critical event listener accumulation', () => {
      // Track very many event listeners
      for (let i = 0; i < 600; i++) {
        monitor.trackEventListener('document', 'click', 1);
      }

      const pattern = monitor.detectLeakPattern();

      expect(pattern.type).toBe('event-listener-accumulation');
      expect(pattern.severity).toBe('critical');
    });

    it('should detect timer accumulation', () => {
      // Track many timers
      for (let i = 0; i < 60; i++) {
        monitor.trackTimer('interval');
      }

      const pattern = monitor.detectLeakPattern();

      expect(pattern.type).toBe('timer-accumulation');
    });

    it('should suggest unbounded cache for very fast growth', () => {
      let usedHeap = 50 * 1024 * 1024;

      monitor.start();

      // Very fast growth - 100MB per second
      for (let i = 0; i < 30; i++) {
        usedHeap += 100 * 1024 * 1024;
        vi.mocked(v8.getHeapStatistics).mockReturnValue({
          ...mockHeapStats,
          used_heap_size: usedHeap,
        });
        vi.advanceTimersByTime(1000);
      }

      const pattern = monitor.detectLeakPattern();

      // With such extreme growth, should suggest unbounded cache
      expect(['unbounded-cache', 'closure-retention', 'unknown']).toContain(pattern.type);
    });
  });

  describe('Event Listener Tracking', () => {
    it('should track event listeners', () => {
      monitor.trackEventListener('window', 'resize', 1);
      monitor.trackEventListener('window', 'scroll', 1);
      monitor.trackEventListener('document', 'click', 3);

      const stats = monitor.getEventListenerStats();

      expect(stats.total).toBe(5);
      expect(stats.byTarget['window']).toBe(2);
      expect(stats.byTarget['document']).toBe(3);
    });

    it('should untrack event listeners', () => {
      monitor.trackEventListener('window', 'resize', 5);
      monitor.trackEventListener('window', 'resize', -3);

      const stats = monitor.getEventListenerStats();

      expect(stats.total).toBe(2);
    });

    it('should remove entry when count reaches zero', () => {
      monitor.trackEventListener('window', 'resize', 2);
      monitor.trackEventListener('window', 'resize', -2);

      const stats = monitor.getEventListenerStats();

      expect(stats.total).toBe(0);
      expect(stats.byTarget['window']).toBeUndefined();
    });
  });

  describe('Timer Tracking', () => {
    it('should track timers', () => {
      monitor.trackTimer('interval');
      monitor.trackTimer('interval');
      monitor.trackTimer('timeout');

      const stats = monitor.getTimerStats();

      expect(stats.intervals).toBe(2);
      expect(stats.timeouts).toBe(1);
      expect(stats.total).toBe(3);
    });

    it('should untrack timers', () => {
      const id1 = monitor.trackTimer('interval');
      const id2 = monitor.trackTimer('interval');
      monitor.untrackTimer(id1);

      const stats = monitor.getTimerStats();

      expect(stats.intervals).toBe(1);
    });
  });

  describe('Configuration', () => {
    it('should use default configuration', () => {
      const defaultMonitor = new MemoryMonitor();
      const config = defaultMonitor.getConfig();

      expect(config.samplingIntervalMs).toBe(10000);
      expect(config.maxSamples).toBe(360);
      expect(config.warningThresholdMB).toBe(400);
      expect(config.criticalThresholdMB).toBe(500);
    });

    it('should merge custom configuration', () => {
      const config = monitor.getConfig();

      expect(config.samplingIntervalMs).toBe(1000);
      expect(config.warningThresholdMB).toBe(100);
    });

    it('should update configuration', () => {
      monitor.updateConfig({ warningThresholdMB: 150 });
      const config = monitor.getConfig();

      expect(config.warningThresholdMB).toBe(150);
    });
  });

  describe('Sample Management', () => {
    it('should limit samples to maxSamples', () => {
      const smallMonitor = new MemoryMonitor({
        samplingIntervalMs: 100,
        maxSamples: 5,
      });

      smallMonitor.start();

      // Collect more than maxSamples
      for (let i = 0; i < 10; i++) {
        vi.advanceTimersByTime(100);
      }

      expect(smallMonitor.getMainSamples().length).toBeLessThanOrEqual(5);
      smallMonitor.stop();
    });

    it('should clear all data', () => {
      monitor.start();
      vi.advanceTimersByTime(5000);
      monitor.trackEventListener('test', 'event', 5);
      monitor.trackTimer('interval');

      monitor.clear();

      expect(monitor.getMainSamples()).toHaveLength(0);
      expect(monitor.getAlerts()).toHaveLength(0);
    });
  });

  describe('Alerts', () => {
    it('should store and retrieve alerts', () => {
      const alertMonitor = new MemoryMonitor({
        samplingIntervalMs: 1000,
        warningThresholdMB: 10, // Very low to trigger alerts
      });

      alertMonitor.start();

      const alerts = alertMonitor.getAlerts();
      expect(alerts.length).toBeGreaterThan(0);

      alertMonitor.stop();
    });

    it('should limit stored alerts', () => {
      vi.mocked(v8.getHeapStatistics).mockReturnValue({
        ...mockHeapStats,
        used_heap_size: 150 * 1024 * 1024,
      });

      monitor.start();

      // Generate many alerts
      for (let i = 0; i < 150; i++) {
        vi.advanceTimersByTime(1000);
      }

      expect(monitor.getAlerts(200).length).toBeLessThanOrEqual(100);
    });

    it('should include alert details', () => {
      vi.mocked(v8.getHeapStatistics).mockReturnValue({
        ...mockHeapStats,
        used_heap_size: 250 * 1024 * 1024,
      });

      monitor.start();

      const alerts = monitor.getAlerts();
      const alert = alerts[0];

      expect(alert.id).toBeDefined();
      expect(alert.timestamp).toBeDefined();
      expect(alert.type).toBeDefined();
      expect(alert.severity).toBeDefined();
      expect(alert.message).toBeDefined();
      expect(alert.currentMemoryMB).toBeDefined();
    });
  });

  describe('Status', () => {
    it('should report correct status', () => {
      monitor.start();
      vi.advanceTimersByTime(5000);

      const status = monitor.getStatus();

      expect(status.isRunning).toBe(true);
      expect(status.mainSampleCount).toBeGreaterThan(0);
      expect(status.currentHeapMB).toBeGreaterThan(0);
    });

    it('should track peak heap', () => {
      let usedHeap = 30 * 1024 * 1024;

      monitor.start();

      // Increase then decrease memory
      for (let i = 0; i < 5; i++) {
        usedHeap += 10 * 1024 * 1024;
        vi.mocked(v8.getHeapStatistics).mockReturnValue({
          ...mockHeapStats,
          used_heap_size: usedHeap,
        });
        vi.advanceTimersByTime(1000);
      }

      const peakAfterIncrease = monitor.getStatus().peakHeapMB;

      // Now decrease
      for (let i = 0; i < 5; i++) {
        usedHeap -= 5 * 1024 * 1024;
        vi.mocked(v8.getHeapStatistics).mockReturnValue({
          ...mockHeapStats,
          used_heap_size: usedHeap,
        });
        vi.advanceTimersByTime(1000);
      }

      const peakAfterDecrease = monitor.getStatus().peakHeapMB;

      expect(peakAfterDecrease).toBe(peakAfterIncrease);
    });
  });

  describe('Report Generation', () => {
    it('should generate comprehensive report', () => {
      monitor.start();
      vi.advanceTimersByTime(5000);
      monitor.trackEventListener('test', 'event', 5);
      monitor.trackTimer('interval');

      const report = monitor.generateReport();

      expect(report.timestamp).toBeDefined();
      expect(report.status).toBeDefined();
      expect(report.eventListeners).toBeDefined();
      expect(report.timers).toBeDefined();
      expect(report.recentAlerts).toBeDefined();
      expect(report.recommendations).toBeDefined();
    });

    it('should include recommendations when issues detected', () => {
      vi.mocked(v8.getHeapStatistics).mockReturnValue({
        ...mockHeapStats,
        used_heap_size: 150 * 1024 * 1024,
      });

      monitor.start();
      vi.advanceTimersByTime(5000);

      const report = monitor.generateReport();

      expect(report.recommendations.length).toBeGreaterThan(0);
    });

    it('should include high event listener warning', () => {
      for (let i = 0; i < 60; i++) {
        monitor.trackEventListener('test', `event${i}`, 1);
      }

      const report = monitor.generateReport();

      expect(report.recommendations.some((r) => r.includes('event listener'))).toBe(true);
    });
  });
});

describe('Singleton Functions', () => {
  afterEach(() => {
    shutdownMemoryMonitor();
    vi.clearAllMocks();
  });

  it('should return same instance', () => {
    const instance1 = getMemoryMonitor();
    const instance2 = getMemoryMonitor();

    expect(instance1).toBe(instance2);
  });

  it('should apply config on first call', () => {
    const instance = getMemoryMonitor({ warningThresholdMB: 250 });

    expect(instance.getConfig().warningThresholdMB).toBe(250);
  });

  it('should update config on subsequent calls', () => {
    const instance1 = getMemoryMonitor({ warningThresholdMB: 250 });
    getMemoryMonitor({ warningThresholdMB: 300 });

    expect(instance1.getConfig().warningThresholdMB).toBe(300);
  });

  it('should shutdown monitor', () => {
    const instance = getMemoryMonitor();
    instance.start();

    shutdownMemoryMonitor();

    // Getting a new instance after shutdown
    const newInstance = getMemoryMonitor();
    expect(newInstance).not.toBe(instance);
  });
});

describe('Tracked Timer Utilities', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    shutdownMemoryMonitor();
    vi.useRealTimers();
  });

  it('should create and clear tracked interval', () => {
    const callback = vi.fn();
    const tracked = createTrackedInterval(callback, 100);

    const monitor = getMemoryMonitor();
    expect(monitor.getTimerStats().intervals).toBe(1);

    vi.advanceTimersByTime(250);
    expect(callback).toHaveBeenCalledTimes(2);

    clearTrackedInterval(tracked);
    expect(monitor.getTimerStats().intervals).toBe(0);

    vi.advanceTimersByTime(100);
    expect(callback).toHaveBeenCalledTimes(2); // No more calls
  });

  it('should create and clear tracked timeout', () => {
    const callback = vi.fn();
    const tracked = createTrackedTimeout(callback, 100);

    const monitor = getMemoryMonitor();
    expect(monitor.getTimerStats().timeouts).toBe(1);

    vi.advanceTimersByTime(100);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(monitor.getTimerStats().timeouts).toBe(0); // Auto-untracked

    clearTrackedTimeout(tracked); // Should be safe to call
    expect(monitor.getTimerStats().timeouts).toBe(0);
  });

  it('should allow early timeout cancellation', () => {
    const callback = vi.fn();
    const tracked = createTrackedTimeout(callback, 100);

    clearTrackedTimeout(tracked);

    const monitor = getMemoryMonitor();
    expect(monitor.getTimerStats().timeouts).toBe(0);

    vi.advanceTimersByTime(100);
    expect(callback).not.toHaveBeenCalled();
  });
});

describe('Linear Regression Analysis', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    shutdownMemoryMonitor();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('should detect perfect linear growth', () => {
    const monitor = new MemoryMonitor({
      samplingIntervalMs: 1000,
      analysisWindowMinutes: 1,
      leakGrowthRateMBPerMinute: 0.5,
    });

    let usedHeap = 10 * 1024 * 1024; // Start at 10MB

    monitor.start();

    // Perfect linear growth: +1MB every second
    for (let i = 0; i < 30; i++) {
      usedHeap += 1 * 1024 * 1024;
      vi.mocked(v8.getHeapStatistics).mockReturnValue({
        ...mockHeapStats,
        used_heap_size: usedHeap,
      });
      vi.advanceTimersByTime(1000);
    }

    const analysis = monitor.analyzeGrowth('main');

    // Growth should be ~60 MB/min (1MB/s * 60s)
    expect(analysis.growthRateMBPerMinute).toBeGreaterThan(30);
    expect(analysis.trendDirection).toBe('increasing');
    expect(analysis.confidenceScore).toBeGreaterThan(0.8); // High R-squared for linear data

    monitor.stop();
  });

  it('should detect stable memory with constant usage', () => {
    // Use exact same heap value for all samples - truly stable
    const stableHeap = 50 * 1024 * 1024;

    // Set mock BEFORE creating monitor (initial sample also uses this)
    vi.mocked(v8.getHeapStatistics).mockReturnValue({
      ...mockHeapStats,
      used_heap_size: stableHeap,
    });

    const monitor = new MemoryMonitor({
      samplingIntervalMs: 1000,
      analysisWindowMinutes: 1,
    });

    monitor.start();

    // All samples have exact same heap size
    for (let i = 0; i < 30; i++) {
      vi.advanceTimersByTime(1000);
    }

    const analysis = monitor.analyzeGrowth('main');

    // With constant values, growth should be essentially zero
    // The trend direction threshold is 0.1 MB/min for 'stable'
    expect(Math.abs(analysis.growthRateMBPerMinute)).toBeLessThan(0.5);
    expect(analysis.trendDirection).toBe('stable');

    monitor.stop();
  });

  it('should detect decreasing memory trend', () => {
    const monitor = new MemoryMonitor({
      samplingIntervalMs: 1000,
      analysisWindowMinutes: 1,
    });

    let usedHeap = 100 * 1024 * 1024; // Start high

    monitor.start();

    // Decreasing trend: -1MB every second
    for (let i = 0; i < 30; i++) {
      usedHeap -= 1 * 1024 * 1024;
      if (usedHeap < 10 * 1024 * 1024) usedHeap = 10 * 1024 * 1024;
      vi.mocked(v8.getHeapStatistics).mockReturnValue({
        ...mockHeapStats,
        used_heap_size: usedHeap,
      });
      vi.advanceTimersByTime(1000);
    }

    const analysis = monitor.analyzeGrowth('main');

    expect(analysis.growthRateMBPerMinute).toBeLessThan(0);
    expect(analysis.trendDirection).toBe('decreasing');

    monitor.stop();
  });
});

describe('Force GC', () => {
  afterEach(() => {
    shutdownMemoryMonitor();
    // Restore global.gc to undefined
    (global as Record<string, unknown>).gc = undefined;
  });

  it('should return false when gc not available', () => {
    const monitor = getMemoryMonitor();
    const result = monitor.forceGC();

    expect(result).toBe(false);
  });

  it('should call gc when available', () => {
    const mockGc = vi.fn();
    (global as Record<string, unknown>).gc = mockGc;

    const monitor = getMemoryMonitor();
    const result = monitor.forceGC();

    expect(result).toBe(true);
    expect(mockGc).toHaveBeenCalledTimes(1);
  });
});

describe('Heap Snapshot', () => {
  afterEach(() => {
    shutdownMemoryMonitor();
    vi.clearAllMocks();
  });

  it('should write heap snapshot', async () => {
    const monitor = getMemoryMonitor();
    const result = await monitor.writeHeapSnapshot();

    expect(v8.writeHeapSnapshot).toHaveBeenCalled();
    expect(result).toBe('/mock/snapshot.heapsnapshot');
  });

  it('should use custom file path', async () => {
    const monitor = getMemoryMonitor();
    await monitor.writeHeapSnapshot('/custom/path.heapsnapshot');

    expect(v8.writeHeapSnapshot).toHaveBeenCalledWith('/custom/path.heapsnapshot');
  });
});

describe('Edge Cases', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    shutdownMemoryMonitor();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('should handle empty samples in analysis', () => {
    const monitor = new MemoryMonitor();
    const analysis = monitor.analyzeGrowth('main');

    expect(analysis.isLeaking).toBe(false);
    expect(analysis.sampleCount).toBe(0);
  });

  it('should handle analysis with too few samples in window', () => {
    const monitor = new MemoryMonitor({
      samplingIntervalMs: 60000, // 1 minute
      analysisWindowMinutes: 1,
    });

    monitor.start();
    // Only one sample collected

    const analysis = monitor.analyzeGrowth('main');

    expect(analysis.sampleCount).toBeLessThan(3);
    expect(analysis.confidenceScore).toBe(0);

    monitor.stop();
  });

  it('should handle zero heap limit gracefully', () => {
    vi.mocked(v8.getHeapStatistics).mockReturnValue({
      ...mockHeapStats,
      heap_size_limit: 0,
    });

    const monitor = new MemoryMonitor({ warningThresholdMB: 1000 });
    const alertHandler = vi.fn();
    monitor.on('alert', alertHandler);

    // Should not crash
    monitor.start();

    // OOM check involves division by zero, which should be skipped
    // Verify no OOM risk alert was emitted
    const oomAlerts = alertHandler.mock.calls.filter(
      (call) => call[0]?.type === 'oom-risk'
    );
    expect(oomAlerts).toHaveLength(0);

    monitor.stop();
  });

  it('should handle renderer process without memory API', async () => {
    const { BrowserWindow } = await import('electron');
    const mockWindow = {
      isDestroyed: vi.fn(() => false),
      id: 1,
      webContents: {
        getProcessId: vi.fn(() => 123),
        executeJavaScript: vi.fn(() => Promise.resolve(null)),
      },
    };

    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([mockWindow as any]);

    const monitor = new MemoryMonitor({
      samplingIntervalMs: 1000,
      monitorRenderer: true,
    });

    // Should not throw
    monitor.start();
    vi.advanceTimersByTime(1000);

    // Renderer samples should be empty since API returned null
    expect(monitor.getRendererSamples(123)).toHaveLength(0);

    monitor.stop();
  });
});
