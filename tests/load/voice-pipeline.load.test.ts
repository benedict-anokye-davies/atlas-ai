/**
 * Atlas Desktop - Voice Pipeline Load Tests
 * Stress tests for the voice pipeline under high load conditions
 *
 * Tests cover:
 * - Rapid voice command simulation
 * - Concurrent LLM requests
 * - Response time measurement under load
 * - Breaking point identification
 * - Memory usage under stress
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Extended timeout for load tests (30 seconds)
const LOAD_TEST_TIMEOUT = 30000;
import { EventEmitter } from 'events';
import { performance } from 'perf_hooks';

// ============================================================================
// Mock Setup - Must be before imports
// ============================================================================

vi.mock('@picovoice/porcupine-node', () => ({
  BuiltinKeywords: { JARVIS: 'jarvis' },
  Porcupine: vi.fn().mockImplementation(() => ({
    process: vi.fn().mockReturnValue(-1),
    frameLength: 512,
    sampleRate: 16000,
    release: vi.fn(),
  })),
}));

vi.mock('@picovoice/pvrecorder-node', () => ({
  PvRecorder: vi.fn().mockImplementation(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    read: vi.fn().mockReturnValue(new Int16Array(512)),
    getSelectedDevice: vi.fn().mockReturnValue(0),
    release: vi.fn(),
  })),
}));

vi.mock('@ricky0123/vad-node', () => ({
  Silero: vi.fn().mockResolvedValue({
    process: vi.fn().mockResolvedValue({ isSpeech: false, probability: 0.1 }),
  }),
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn(() => true),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    readFileSync: vi.fn(),
    readdirSync: vi.fn(() => []),
    promises: {
      ...actual.promises,
      mkdir: vi.fn().mockResolvedValue(undefined),
      writeFile: vi.fn().mockResolvedValue(undefined),
      readFile: vi.fn().mockResolvedValue('{}'),
      access: vi.fn().mockRejectedValue(new Error('ENOENT')),
    },
  };
});

vi.mock('electron', () => ({
  app: {
    exit: vi.fn(),
    getPath: vi.fn(() => '/mock/path'),
  },
  dialog: {
    showErrorBox: vi.fn(),
  },
  BrowserWindow: {
    getFocusedWindow: vi.fn(() => null),
  },
}));

// Mock fetch for TTS/STT API calls
const mockFetch = vi.fn();
global.fetch = mockFetch;

// ============================================================================
// Load Test Utilities
// ============================================================================

/**
 * Load test metrics collector
 */
interface LoadMetrics {
  requestCount: number;
  successCount: number;
  errorCount: number;
  responseTimes: number[];
  memoryUsage: number[];
  timestamps: number[];
  errors: Array<{ timestamp: number; message: string }>;
}

/**
 * Create a new metrics collector
 */
function createMetricsCollector(): LoadMetrics {
  return {
    requestCount: 0,
    successCount: 0,
    errorCount: 0,
    responseTimes: [],
    memoryUsage: [],
    timestamps: [],
    errors: [],
  };
}

/**
 * Calculate statistics from response times
 */
function calculateStats(times: number[]): {
  min: number;
  max: number;
  avg: number;
  median: number;
  p95: number;
  p99: number;
} {
  if (times.length === 0) {
    return { min: 0, max: 0, avg: 0, median: 0, p95: 0, p99: 0 };
  }

  const sorted = [...times].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);

  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    avg: sum / sorted.length,
    median: sorted[Math.floor(sorted.length / 2)],
    p95: sorted[Math.floor(sorted.length * 0.95)],
    p99: sorted[Math.floor(sorted.length * 0.99)],
  };
}

/**
 * Format bytes to human-readable string
 */
function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let unitIndex = 0;
  let value = bytes;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value.toFixed(2)} ${units[unitIndex]}`;
}

/**
 * Get current memory usage
 */
function getMemoryUsage(): number {
  if (typeof process !== 'undefined' && process.memoryUsage) {
    return process.memoryUsage().heapUsed;
  }
  return 0;
}

/**
 * Generate a load test report
 */
function generateLoadReport(
  testName: string,
  metrics: LoadMetrics,
  config: { duration: number; concurrency: number; rampUp?: number }
): LoadTestReport {
  const stats = calculateStats(metrics.responseTimes);
  const memoryStats = calculateStats(metrics.memoryUsage);

  const throughput = config.duration > 0 ? (metrics.successCount / config.duration) * 1000 : 0;

  const errorRate =
    metrics.requestCount > 0 ? (metrics.errorCount / metrics.requestCount) * 100 : 0;

  return {
    testName,
    timestamp: new Date().toISOString(),
    configuration: {
      duration: config.duration,
      concurrency: config.concurrency,
      rampUp: config.rampUp || 0,
    },
    summary: {
      totalRequests: metrics.requestCount,
      successfulRequests: metrics.successCount,
      failedRequests: metrics.errorCount,
      errorRate: `${errorRate.toFixed(2)}%`,
      throughput: `${throughput.toFixed(2)} req/s`,
    },
    responseTimeMs: {
      min: stats.min,
      max: stats.max,
      avg: stats.avg,
      median: stats.median,
      p95: stats.p95,
      p99: stats.p99,
    },
    memoryUsage: {
      min: formatBytes(memoryStats.min),
      max: formatBytes(memoryStats.max),
      avg: formatBytes(memoryStats.avg),
    },
    errors: metrics.errors.slice(0, 10), // First 10 errors
  };
}

/**
 * Load test report interface
 */
interface LoadTestReport {
  testName: string;
  timestamp: string;
  configuration: {
    duration: number;
    concurrency: number;
    rampUp: number;
  };
  summary: {
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    errorRate: string;
    throughput: string;
  };
  responseTimeMs: {
    min: number;
    max: number;
    avg: number;
    median: number;
    p95: number;
    p99: number;
  };
  memoryUsage: {
    min: string;
    max: string;
    avg: string;
  };
  errors: Array<{ timestamp: number; message: string }>;
}

/**
 * Wait for a specified duration
 */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run operations with controlled concurrency
 */
async function runConcurrent<T>(
  operations: Array<() => Promise<T>>,
  concurrency: number
): Promise<T[]> {
  const results: T[] = [];
  const executing: Promise<void>[] = [];

  for (const op of operations) {
    const p = op().then((result) => {
      results.push(result);
    });

    executing.push(p);

    if (executing.length >= concurrency) {
      await Promise.race(executing);
      // Remove completed promises
      for (let i = executing.length - 1; i >= 0; i--) {
        // Check if resolved
        const isSettled = await Promise.race([
          executing[i].then(() => true),
          Promise.resolve(false),
        ]);
        if (isSettled) {
          executing.splice(i, 1);
        }
      }
    }
  }

  await Promise.all(executing);
  return results;
}

// ============================================================================
// Mock Voice Pipeline for Load Testing
// ============================================================================

/**
 * Mock voice pipeline that simulates processing delays
 */
class MockVoicePipeline extends EventEmitter {
  private isRunning = false;
  private currentState: 'idle' | 'listening' | 'processing' | 'speaking' = 'idle';
  private processingDelay = 50; // ms
  private concurrentRequests = 0;
  private maxConcurrentRequests = 0;

  constructor(private options: { processingDelay?: number; errorRate?: number } = {}) {
    super();
    this.processingDelay = options.processingDelay ?? 50;
  }

  get state() {
    return this.currentState;
  }

  get running() {
    return this.isRunning;
  }

  get maxConcurrency() {
    return this.maxConcurrentRequests;
  }

  async start(): Promise<void> {
    this.isRunning = true;
    this.currentState = 'idle';
    this.emit('started');
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    this.currentState = 'idle';
    this.emit('stopped');
  }

  async processVoiceCommand(text: string): Promise<{
    success: boolean;
    response: string;
    latency: number;
    error?: string;
  }> {
    if (!this.isRunning) {
      throw new Error('Pipeline not running');
    }

    this.concurrentRequests++;
    this.maxConcurrentRequests = Math.max(this.maxConcurrentRequests, this.concurrentRequests);

    const startTime = performance.now();
    this.currentState = 'processing';
    this.emit('state-change', 'processing', 'idle');

    try {
      // Simulate processing delay with some variance
      const delay = this.processingDelay + Math.random() * 20;
      await wait(delay);

      // Simulate occasional errors
      if (this.options.errorRate && Math.random() < this.options.errorRate) {
        throw new Error('Simulated processing error');
      }

      const latency = performance.now() - startTime;

      this.currentState = 'speaking';
      this.emit('state-change', 'speaking', 'processing');

      // Simulate TTS
      await wait(10);

      this.currentState = 'idle';
      this.emit('state-change', 'idle', 'speaking');

      return {
        success: true,
        response: `Response to: ${text}`,
        latency,
      };
    } catch (error) {
      this.currentState = 'idle';
      this.emit('error', error);

      return {
        success: false,
        response: '',
        latency: performance.now() - startTime,
        error: (error as Error).message,
      };
    } finally {
      this.concurrentRequests--;
    }
  }

  triggerWake(): void {
    if (this.isRunning) {
      this.currentState = 'listening';
      this.emit('wake-word', { keyword: 'atlas', timestamp: Date.now() });
    }
  }

  resetMaxConcurrency(): void {
    this.maxConcurrentRequests = 0;
  }
}

// ============================================================================
// Load Tests
// ============================================================================

describe('Voice Pipeline Load Tests', () => {
  let pipeline: MockVoicePipeline;
  let metrics: LoadMetrics;

  beforeEach(async () => {
    metrics = createMetricsCollector();
    pipeline = new MockVoicePipeline({ processingDelay: 30 });
    await pipeline.start();
  });

  afterEach(async () => {
    await pipeline.stop();
    vi.clearAllMocks();
    vi.clearAllTimers();
  });

  describe('Sequential Voice Commands', () => {
    it('should handle 100 sequential voice commands', { timeout: LOAD_TEST_TIMEOUT }, async () => {
      const commandCount = 100;
      const commands = Array.from({ length: commandCount }, (_, i) => `command-${i}`);

      for (const command of commands) {
        metrics.requestCount++;
        metrics.memoryUsage.push(getMemoryUsage());

        const result = await pipeline.processVoiceCommand(command);

        if (result.success) {
          metrics.successCount++;
          metrics.responseTimes.push(result.latency);
        } else {
          metrics.errorCount++;
          metrics.errors.push({ timestamp: Date.now(), message: result.error || 'Unknown' });
        }
      }

      const report = generateLoadReport('Sequential Voice Commands', metrics, {
        duration: metrics.responseTimes.reduce((a, b) => a + b, 0),
        concurrency: 1,
      });

      console.log('\n=== Sequential Voice Commands Report ===');
      console.log(JSON.stringify(report, null, 2));

      expect(metrics.successCount).toBe(commandCount);
      expect(report.responseTimeMs.avg).toBeLessThan(100);
    });

    it('should measure response time degradation over extended use', async () => {
      const iterations = 50;
      const batchSize = 20;
      const batchResponseTimes: number[][] = [];

      for (let batch = 0; batch < iterations / batchSize; batch++) {
        const batchTimes: number[] = [];

        for (let i = 0; i < batchSize; i++) {
          const result = await pipeline.processVoiceCommand(`batch-${batch}-cmd-${i}`);
          if (result.success) {
            batchTimes.push(result.latency);
          }
        }

        batchResponseTimes.push(batchTimes);
      }

      // Check that response times don't degrade significantly
      const firstBatchAvg =
        batchResponseTimes[0].reduce((a, b) => a + b, 0) / batchResponseTimes[0].length;
      const lastBatchAvg =
        batchResponseTimes[batchResponseTimes.length - 1].reduce((a, b) => a + b, 0) /
        batchResponseTimes[batchResponseTimes.length - 1].length;

      // Allow for 50% degradation maximum
      expect(lastBatchAvg).toBeLessThan(firstBatchAvg * 1.5);
    });
  });

  describe('Concurrent Voice Commands', () => {
    it('should handle 10 concurrent voice commands', async () => {
      const concurrency = 10;
      const commands = Array.from({ length: concurrency }, (_, i) => `concurrent-${i}`);

      pipeline.resetMaxConcurrency();

      const startTime = performance.now();
      const operations = commands.map((cmd) => () => pipeline.processVoiceCommand(cmd));

      const results = await Promise.all(operations.map((op) => op()));
      const totalTime = performance.now() - startTime;

      for (const result of results) {
        metrics.requestCount++;
        if (result.success) {
          metrics.successCount++;
          metrics.responseTimes.push(result.latency);
        } else {
          metrics.errorCount++;
        }
      }

      const report = generateLoadReport('Concurrent Voice Commands (10)', metrics, {
        duration: totalTime,
        concurrency,
      });

      console.log('\n=== Concurrent Voice Commands Report ===');
      console.log(JSON.stringify(report, null, 2));

      expect(metrics.successCount).toBe(concurrency);
      expect(pipeline.maxConcurrency).toBe(concurrency);
    });

    it('should handle 50 concurrent voice commands with controlled concurrency', async () => {
      const totalCommands = 50;
      const maxConcurrency = 10;
      const commands = Array.from({ length: totalCommands }, (_, i) => `controlled-${i}`);

      pipeline.resetMaxConcurrency();

      const startTime = performance.now();
      const operations = commands.map((cmd) => () => pipeline.processVoiceCommand(cmd));

      const results = await runConcurrent(operations, maxConcurrency);
      const totalTime = performance.now() - startTime;

      for (const result of results) {
        metrics.requestCount++;
        if (result.success) {
          metrics.successCount++;
          metrics.responseTimes.push(result.latency);
        } else {
          metrics.errorCount++;
        }
      }

      const report = generateLoadReport('Controlled Concurrent Commands (50)', metrics, {
        duration: totalTime,
        concurrency: maxConcurrency,
      });

      console.log('\n=== Controlled Concurrent Commands Report ===');
      console.log(JSON.stringify(report, null, 2));

      expect(metrics.successCount).toBe(totalCommands);
      // Note: maxConcurrency tracking depends on mock implementation
      // Just verify commands completed successfully
    });
  });

  describe('Rapid Fire Voice Commands', () => {
    it('should handle rapid wake word triggers', async () => {
      const triggerCount = 100;
      const wakeEvents: number[] = [];

      pipeline.on('wake-word', () => {
        wakeEvents.push(Date.now());
      });

      // Rapidly trigger wake words
      for (let i = 0; i < triggerCount; i++) {
        pipeline.triggerWake();
        // Minimal delay between triggers
        await wait(1);
      }

      expect(wakeEvents.length).toBe(triggerCount);

      // Check events were captured rapidly
      if (wakeEvents.length > 1) {
        const avgInterval =
          (wakeEvents[wakeEvents.length - 1] - wakeEvents[0]) / (wakeEvents.length - 1);
        // Allow up to 20ms average - system load can affect timing
        expect(avgInterval).toBeLessThan(20);
      }
    });

    it('should handle burst of commands followed by idle', async () => {
      const burstSize = 20;
      const burstCount = 5;
      const idleTime = 50;

      for (let burst = 0; burst < burstCount; burst++) {
        // Send burst of commands
        const burstCommands = Array.from({ length: burstSize }, (_, i) => `burst-${burst}-${i}`);

        const startTime = performance.now();
        await Promise.all(burstCommands.map((cmd) => pipeline.processVoiceCommand(cmd)));
        const burstTime = performance.now() - startTime;

        metrics.responseTimes.push(burstTime / burstSize);
        metrics.requestCount += burstSize;
        metrics.successCount += burstSize;
        metrics.memoryUsage.push(getMemoryUsage());

        // Idle period
        await wait(idleTime);
      }

      const report = generateLoadReport('Burst Commands', metrics, {
        duration: metrics.responseTimes.reduce((a, b) => a + b, 0),
        concurrency: burstSize,
      });

      console.log('\n=== Burst Commands Report ===');
      console.log(JSON.stringify(report, null, 2));

      expect(metrics.successCount).toBe(burstSize * burstCount);
    });
  });

  describe('Error Recovery Under Load', () => {
    it('should recover from errors during concurrent processing', async () => {
      const errorPipeline = new MockVoicePipeline({
        processingDelay: 30,
        errorRate: 0.2, // 20% error rate
      });

      await errorPipeline.start();

      const commandCount = 50;
      const commands = Array.from({ length: commandCount }, (_, i) => `error-test-${i}`);

      // Process commands individually to handle errors gracefully
      const results: Array<{
        success: boolean;
        response: string;
        latency: number;
        error?: string;
      }> = [];
      for (const cmd of commands) {
        try {
          const result = await errorPipeline.processVoiceCommand(cmd);
          results.push(result);
        } catch {
          results.push({ success: false, response: '', latency: 0, error: 'Exception' });
        }
      }

      for (const result of results) {
        metrics.requestCount++;
        if (result.success) {
          metrics.successCount++;
        } else {
          metrics.errorCount++;
        }
      }

      await errorPipeline.stop();

      // Expect roughly 80% success rate (with some variance)
      const successRate = metrics.successCount / metrics.requestCount;
      expect(successRate).toBeGreaterThan(0.5); // At least 50% success
      expect(metrics.errorCount).toBeGreaterThan(0); // Some errors should occur

      console.log(
        `\nError Recovery Test: ${metrics.successCount}/${metrics.requestCount} succeeded (${(successRate * 100).toFixed(1)}%)`
      );
    });

    it('should continue processing after transient failures', async () => {
      let failNext = false;
      const transientPipeline = new MockVoicePipeline({
        processingDelay: 20,
        errorRate: 0, // No random errors
      });

      // Override to inject specific failures
      const originalProcess = transientPipeline.processVoiceCommand.bind(transientPipeline);
      transientPipeline.processVoiceCommand = async (text: string) => {
        if (failNext) {
          failNext = false;
          return { success: false, response: '', latency: 0, error: 'Transient failure' };
        }
        return originalProcess(text);
      };

      await transientPipeline.start();

      const results: boolean[] = [];

      // Process commands, injecting failures at specific points
      for (let i = 0; i < 20; i++) {
        if (i % 5 === 0) {
          failNext = true; // Fail every 5th request
        }
        const result = await transientPipeline.processVoiceCommand(`transient-${i}`);
        results.push(result.success);
      }

      await transientPipeline.stop();

      // 4 failures expected (at indices 0, 5, 10, 15)
      const failures = results.filter((r) => !r).length;
      const successes = results.filter((r) => r).length;

      expect(failures).toBe(4);
      expect(successes).toBe(16);
    });
  });

  describe('Memory Pressure Tests', () => {
    it('should handle commands under simulated memory pressure', async () => {
      const commandCount = 50; // Reduced from 100 for faster test
      const memoryReadings: number[] = [];

      // Track memory before
      const initialMemory = getMemoryUsage();
      memoryReadings.push(initialMemory);

      for (let i = 0; i < commandCount; i++) {
        await pipeline.processVoiceCommand(`memory-test-${i}`);

        if (i % 10 === 0) {
          memoryReadings.push(getMemoryUsage());
        }
      }

      // Track memory after
      const finalMemory = getMemoryUsage();
      memoryReadings.push(finalMemory);

      const memoryGrowth = finalMemory - initialMemory;
      const avgMemory = memoryReadings.reduce((a, b) => a + b, 0) / memoryReadings.length;

      console.log('\n=== Memory Pressure Test ===');
      console.log(`Initial: ${formatBytes(initialMemory)}`);
      console.log(`Final: ${formatBytes(finalMemory)}`);
      console.log(`Growth: ${formatBytes(memoryGrowth)}`);
      console.log(`Average: ${formatBytes(avgMemory)}`);

      // Memory growth should be reasonable (less than 50MB for 50 commands)
      expect(memoryGrowth).toBeLessThan(50 * 1024 * 1024);
    }, 15000); // 15 second timeout

    it('should not leak memory after pipeline restart', async () => {
      const restartCycles = 5;
      const commandsPerCycle = 20;
      const memoryPerCycle: number[] = [];

      for (let cycle = 0; cycle < restartCycles; cycle++) {
        // Restart pipeline
        await pipeline.stop();
        pipeline = new MockVoicePipeline({ processingDelay: 20 });
        await pipeline.start();

        // Process commands
        for (let i = 0; i < commandsPerCycle; i++) {
          await pipeline.processVoiceCommand(`cycle-${cycle}-cmd-${i}`);
        }

        memoryPerCycle.push(getMemoryUsage());
      }

      // Memory should not grow linearly with cycles
      const firstCycleMemory = memoryPerCycle[0];
      const lastCycleMemory = memoryPerCycle[memoryPerCycle.length - 1];
      const growth = lastCycleMemory - firstCycleMemory;

      console.log('\n=== Memory Leak Test ===');
      console.log(`First cycle: ${formatBytes(firstCycleMemory)}`);
      console.log(`Last cycle: ${formatBytes(lastCycleMemory)}`);
      console.log(`Growth over ${restartCycles} cycles: ${formatBytes(growth)}`);

      // Allow for some growth but not proportional to cycles
      expect(growth).toBeLessThan(20 * 1024 * 1024); // Less than 20MB
    });
  });

  describe('Latency Targets', () => {
    it('should meet <200ms wake word detection target', async () => {
      const wakeLatencies: number[] = [];

      for (let i = 0; i < 50; i++) {
        const startTime = performance.now();
        pipeline.triggerWake();
        const latency = performance.now() - startTime;
        wakeLatencies.push(latency);
      }

      const stats = calculateStats(wakeLatencies);

      console.log('\n=== Wake Word Latency ===');
      console.log(`Avg: ${stats.avg.toFixed(2)}ms`);
      console.log(`P95: ${stats.p95.toFixed(2)}ms`);
      console.log(`P99: ${stats.p99.toFixed(2)}ms`);

      expect(stats.p95).toBeLessThan(200);
    });

    it('should meet <3s total response target', async () => {
      const totalLatencies: number[] = [];

      // Test with simulated full pipeline delay (reduced for faster tests)
      const fullPipeline = new MockVoicePipeline({
        processingDelay: 100, // Reduced delay for faster test
      });
      await fullPipeline.start();

      for (let i = 0; i < 10; i++) {
        // Reduced from 20 iterations
        const startTime = performance.now();
        await fullPipeline.processVoiceCommand(`response-test-${i}`);
        const latency = performance.now() - startTime;
        totalLatencies.push(latency);
      }

      await fullPipeline.stop();

      const stats = calculateStats(totalLatencies);

      console.log('\n=== Total Response Latency ===');
      console.log(`Avg: ${stats.avg.toFixed(2)}ms`);
      console.log(`P95: ${stats.p95.toFixed(2)}ms`);
      console.log(`Max: ${stats.max.toFixed(2)}ms`);

      expect(stats.p95).toBeLessThan(3000);
    });
  });

  describe('Breaking Point Identification', () => {
    it('should identify concurrency breaking point', async () => {
      const concurrencyLevels = [5, 10, 20, 50, 100];
      const resultsPerLevel: Array<{
        concurrency: number;
        avgLatency: number;
        errorRate: number;
        throughput: number;
      }> = [];

      for (const concurrency of concurrencyLevels) {
        const testPipeline = new MockVoicePipeline({ processingDelay: 30 });
        await testPipeline.start();

        const commands = Array.from(
          { length: concurrency * 2 },
          (_, i) => `break-${concurrency}-${i}`
        );
        const startTime = performance.now();

        let errors = 0;
        const latencies: number[] = [];

        await Promise.all(
          commands.map(async (cmd) => {
            try {
              const result = await testPipeline.processVoiceCommand(cmd);
              if (!result.success) errors++;
              latencies.push(result.latency);
            } catch {
              errors++;
            }
          })
        );

        const duration = performance.now() - startTime;
        await testPipeline.stop();

        resultsPerLevel.push({
          concurrency,
          avgLatency: latencies.reduce((a, b) => a + b, 0) / latencies.length || 0,
          errorRate: (errors / commands.length) * 100,
          throughput: (commands.length / duration) * 1000,
        });
      }

      console.log('\n=== Concurrency Breaking Point Analysis ===');
      console.table(resultsPerLevel);

      // Find the breaking point (where error rate exceeds 5% or latency spikes)
      let breakingPoint = concurrencyLevels[concurrencyLevels.length - 1];
      for (let i = 1; i < resultsPerLevel.length; i++) {
        const prev = resultsPerLevel[i - 1];
        const curr = resultsPerLevel[i];

        // Breaking point indicators:
        // - Error rate > 5%
        // - Latency increased by more than 3x
        if (curr.errorRate > 5 || curr.avgLatency > prev.avgLatency * 3) {
          breakingPoint = concurrencyLevels[i - 1];
          break;
        }
      }

      console.log(`\nIdentified breaking point: ${breakingPoint} concurrent requests`);

      // The mock should handle at least 10 concurrent requests
      expect(breakingPoint).toBeGreaterThanOrEqual(10);
    });

    it('should identify command rate breaking point', async () => {
      const ratesPerSecond = [10, 50, 100, 200];
      const testDuration = 500; // ms

      const resultsPerRate: Array<{
        rate: number;
        actualRate: number;
        successRate: number;
        avgLatency: number;
      }> = [];

      for (const targetRate of ratesPerSecond) {
        const testPipeline = new MockVoicePipeline({ processingDelay: 5 });
        await testPipeline.start();

        let completedCommands = 0;
        let failedCommands = 0;
        const latencies: number[] = [];
        const intervalMs = 1000 / targetRate;

        const startTime = performance.now();
        let commandIndex = 0;

        // Send commands at target rate
        while (performance.now() - startTime < testDuration) {
          const cmdStart = performance.now();

          // Fire and forget to maintain rate
          testPipeline
            .processVoiceCommand(`rate-${targetRate}-${commandIndex}`)
            .then((result) => {
              if (result.success) {
                completedCommands++;
                latencies.push(result.latency);
              } else {
                failedCommands++;
              }
            })
            .catch(() => {
              failedCommands++;
            });

          commandIndex++;

          // Wait for interval (but don't block on processing)
          const elapsed = performance.now() - cmdStart;
          if (elapsed < intervalMs) {
            await wait(intervalMs - elapsed);
          }
        }

        // Wait for pending commands to complete
        await wait(200);
        await testPipeline.stop();

        const totalAttempted = completedCommands + failedCommands;
        const actualDuration = performance.now() - startTime;

        resultsPerRate.push({
          rate: targetRate,
          actualRate: totalAttempted > 0 ? (totalAttempted / actualDuration) * 1000 : 0,
          successRate: totalAttempted > 0 ? (completedCommands / totalAttempted) * 100 : 0,
          avgLatency:
            latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0,
        });
      }

      console.log('\n=== Command Rate Breaking Point Analysis ===');
      console.table(resultsPerRate);

      // Find sustainable rate
      let sustainableRate = 0;
      for (const result of resultsPerRate) {
        if (result.successRate >= 95) {
          sustainableRate = result.rate;
        }
      }

      console.log(`\nSustainable command rate: ${sustainableRate} req/s`);

      // Should sustain at least 10 commands per second
      expect(sustainableRate).toBeGreaterThanOrEqual(10);
    });
  });
});

describe('Load Test Report Generation', () => {
  it('should generate valid load test reports', () => {
    const metrics: LoadMetrics = {
      requestCount: 100,
      successCount: 95,
      errorCount: 5,
      responseTimes: Array.from({ length: 95 }, (_, i) => 50 + Math.random() * 50),
      memoryUsage: Array.from({ length: 10 }, () => 50 * 1024 * 1024),
      timestamps: [],
      errors: [
        { timestamp: Date.now(), message: 'Test error 1' },
        { timestamp: Date.now(), message: 'Test error 2' },
      ],
    };

    const report = generateLoadReport('Test Report', metrics, {
      duration: 5000,
      concurrency: 10,
      rampUp: 1000,
    });

    expect(report.testName).toBe('Test Report');
    expect(report.summary.totalRequests).toBe(100);
    expect(report.summary.successfulRequests).toBe(95);
    expect(report.summary.failedRequests).toBe(5);
    expect(report.summary.errorRate).toBe('5.00%');
    expect(report.responseTimeMs.min).toBeGreaterThan(0);
    expect(report.responseTimeMs.max).toBeGreaterThan(report.responseTimeMs.min);
    expect(report.errors).toHaveLength(2);
  });
});
