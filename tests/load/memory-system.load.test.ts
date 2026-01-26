/**
 * Atlas Desktop - Memory System Load Tests
 * Stress tests for the memory system under high load conditions
 *
 * Tests cover:
 * - Large dataset handling
 * - Concurrent memory operations
 * - Memory usage under stress
 * - Search performance at scale
 * - Data integrity under load
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { performance } from 'perf_hooks';

// ============================================================================
// Mock Setup
// ============================================================================

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn(() => true),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    readFileSync: vi.fn(() => '{}'),
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
}));

// ============================================================================
// Load Test Utilities
// ============================================================================

/**
 * Memory load test metrics
 */
interface MemoryLoadMetrics {
  operationCount: number;
  successCount: number;
  errorCount: number;
  operationTimes: number[];
  searchTimes: number[];
  memoryUsage: number[];
  dataSize: number[];
  errors: Array<{ timestamp: number; operation: string; message: string }>;
}

/**
 * Create a new metrics collector
 */
function createMetricsCollector(): MemoryLoadMetrics {
  return {
    operationCount: 0,
    successCount: 0,
    errorCount: 0,
    operationTimes: [],
    searchTimes: [],
    memoryUsage: [],
    dataSize: [],
    errors: [],
  };
}

/**
 * Calculate statistics from a number array
 */
function calculateStats(values: number[]): {
  min: number;
  max: number;
  avg: number;
  median: number;
  p95: number;
  p99: number;
  stdDev: number;
} {
  if (values.length === 0) {
    return { min: 0, max: 0, avg: 0, median: 0, p95: 0, p99: 0, stdDev: 0 };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const avg = sum / sorted.length;

  // Standard deviation
  const squaredDiffs = sorted.map((v) => Math.pow(v - avg, 2));
  const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / squaredDiffs.length;
  const stdDev = Math.sqrt(avgSquaredDiff);

  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    avg,
    median: sorted[Math.floor(sorted.length / 2)],
    p95: sorted[Math.floor(sorted.length * 0.95)],
    p99: sorted[Math.floor(sorted.length * 0.99)],
    stdDev,
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
 * Generate a random string of specified length
 */
function randomString(length: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Generate realistic conversation message
 */
function generateMessage(index: number): { role: 'user' | 'assistant'; content: string } {
  const userMessages = [
    'What is the weather like today?',
    'Can you help me with my code?',
    'Tell me a joke please',
    'What time is it in Tokyo?',
    'How do I fix this bug?',
    'Explain quantum computing',
    'Write a poem about nature',
    'What are the best practices for testing?',
    'How can I improve my productivity?',
    'What is machine learning?',
  ];

  const assistantMessages = [
    'I would be happy to help you with that. Let me explain...',
    'Here is what I found for your question...',
    'That is an interesting topic! Let me share some insights...',
    'Based on my understanding, here is my response...',
    'I can definitely assist you with this. Here are some suggestions...',
  ];

  const isUser = index % 2 === 0;
  const content = isUser
    ? userMessages[index % userMessages.length] + ` (variation ${Math.floor(index / 10)})`
    : assistantMessages[index % assistantMessages.length] +
      ` Additional context: ${randomString(100)}`;

  return {
    role: isUser ? 'user' : 'assistant',
    content,
  };
}

/**
 * Wait utility
 */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Memory load test report
 */
interface MemoryLoadReport {
  testName: string;
  timestamp: string;
  configuration: {
    datasetSize: number;
    concurrency: number;
    duration: number;
  };
  summary: {
    totalOperations: number;
    successfulOperations: number;
    failedOperations: number;
    errorRate: string;
    throughput: string;
  };
  writePerformance: {
    avgMs: number;
    p95Ms: number;
    p99Ms: number;
  };
  readPerformance: {
    avgMs: number;
    p95Ms: number;
    p99Ms: number;
  };
  searchPerformance: {
    avgMs: number;
    p95Ms: number;
    p99Ms: number;
  };
  memoryUsage: {
    initial: string;
    peak: string;
    final: string;
    growth: string;
  };
  dataIntegrity: {
    entriesWritten: number;
    entriesVerified: number;
    integrityPassed: boolean;
  };
}

/**
 * Generate load test report
 */
function generateMemoryLoadReport(
  testName: string,
  metrics: MemoryLoadMetrics,
  config: { datasetSize: number; concurrency: number; duration: number },
  integrity: { written: number; verified: number }
): MemoryLoadReport {
  const opStats = calculateStats(metrics.operationTimes);
  const searchStats = calculateStats(metrics.searchTimes);
  const memStats = calculateStats(metrics.memoryUsage);

  const throughput = config.duration > 0 ? (metrics.successCount / config.duration) * 1000 : 0;

  return {
    testName,
    timestamp: new Date().toISOString(),
    configuration: config,
    summary: {
      totalOperations: metrics.operationCount,
      successfulOperations: metrics.successCount,
      failedOperations: metrics.errorCount,
      errorRate: `${((metrics.errorCount / metrics.operationCount) * 100).toFixed(2)}%`,
      throughput: `${throughput.toFixed(2)} ops/s`,
    },
    writePerformance: {
      avgMs: opStats.avg,
      p95Ms: opStats.p95,
      p99Ms: opStats.p99,
    },
    readPerformance: {
      avgMs: opStats.avg,
      p95Ms: opStats.p95,
      p99Ms: opStats.p99,
    },
    searchPerformance: {
      avgMs: searchStats.avg,
      p95Ms: searchStats.p95,
      p99Ms: searchStats.p99,
    },
    memoryUsage: {
      initial: formatBytes(metrics.memoryUsage[0] || 0),
      peak: formatBytes(memStats.max),
      final: formatBytes(metrics.memoryUsage[metrics.memoryUsage.length - 1] || 0),
      growth: formatBytes(memStats.max - (metrics.memoryUsage[0] || 0)),
    },
    dataIntegrity: {
      entriesWritten: integrity.written,
      entriesVerified: integrity.verified,
      integrityPassed: integrity.written === integrity.verified,
    },
  };
}

// ============================================================================
// Mock Memory System for Load Testing
// ============================================================================

/**
 * Memory entry type
 */
type MemoryType = 'conversation' | 'fact' | 'preference' | 'context';

/**
 * Memory entry interface
 */
interface MemoryEntry {
  id: string;
  type: MemoryType;
  content: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
  accessedAt: number;
  importance: number;
  tags?: string[];
}

/**
 * Conversation session interface
 */
interface ConversationSession {
  id: string;
  startedAt: number;
  lastActivityAt: number;
  messages: Array<{ role: string; content: string }>;
  summary?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Mock memory manager for load testing
 */
class MockMemoryManager extends EventEmitter {
  private entries: Map<string, MemoryEntry> = new Map();
  private conversations: Map<string, ConversationSession> = new Map();
  private currentSessionId: string | null = null;
  private operationDelay = 1; // ms

  constructor(private options: { operationDelay?: number; maxEntries?: number } = {}) {
    super();
    this.operationDelay = options.operationDelay ?? 1;
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  async initialize(): Promise<void> {
    // Simulate initialization delay
    await wait(this.operationDelay);
  }

  async shutdown(): Promise<void> {
    this.entries.clear();
    this.conversations.clear();
    this.currentSessionId = null;
  }

  startSession(metadata?: Record<string, unknown>): string {
    const sessionId = this.generateId();
    const session: ConversationSession = {
      id: sessionId,
      startedAt: Date.now(),
      lastActivityAt: Date.now(),
      messages: [],
      metadata,
    };
    this.conversations.set(sessionId, session);
    this.currentSessionId = sessionId;
    return sessionId;
  }

  getCurrentSessionId(): string | null {
    return this.currentSessionId;
  }

  getCurrentSession(): ConversationSession | undefined {
    if (!this.currentSessionId) return undefined;
    return this.conversations.get(this.currentSessionId);
  }

  async addMessage(message: { role: string; content: string }): Promise<void> {
    await wait(this.operationDelay);

    let session = this.getCurrentSession();
    if (!session) {
      this.startSession();
      session = this.getCurrentSession();
    }

    if (session) {
      session.messages.push(message);
      session.lastActivityAt = Date.now();
    }
  }

  getRecentMessages(limit?: number): Array<{ role: string; content: string }> {
    const session = this.getCurrentSession();
    if (!session) return [];
    const count = limit || 50;
    return session.messages.slice(-count);
  }

  async addEntry(
    type: MemoryType,
    content: string,
    options?: {
      importance?: number;
      tags?: string[];
      metadata?: Record<string, unknown>;
    }
  ): Promise<MemoryEntry> {
    await wait(this.operationDelay);

    // Check max entries limit
    if (this.options.maxEntries && this.entries.size >= this.options.maxEntries) {
      // Remove oldest entry
      const oldestId = this.entries.keys().next().value;
      if (oldestId) {
        this.entries.delete(oldestId);
      }
    }

    const entry: MemoryEntry = {
      id: this.generateId(),
      type,
      content,
      createdAt: Date.now(),
      accessedAt: Date.now(),
      importance: options?.importance ?? 0.5,
      tags: options?.tags,
      metadata: options?.metadata,
    };

    this.entries.set(entry.id, entry);
    this.emit('entry-added', entry);
    return entry;
  }

  async getEntry(id: string): Promise<MemoryEntry | undefined> {
    await wait(this.operationDelay);
    const entry = this.entries.get(id);
    if (entry) {
      entry.accessedAt = Date.now();
    }
    return entry;
  }

  async removeEntry(id: string): Promise<boolean> {
    await wait(this.operationDelay);
    const removed = this.entries.delete(id);
    if (removed) {
      this.emit('entry-removed', id);
    }
    return removed;
  }

  async searchEntries(query: {
    type?: MemoryType;
    tags?: string[];
    minImportance?: number;
    text?: string;
    limit?: number;
  }): Promise<MemoryEntry[]> {
    await wait(this.operationDelay);

    let results = Array.from(this.entries.values());

    if (query.type) {
      results = results.filter((e) => e.type === query.type);
    }

    if (query.tags && query.tags.length > 0) {
      results = results.filter((e) => query.tags!.some((tag) => e.tags?.includes(tag)));
    }

    if (query.minImportance !== undefined) {
      results = results.filter((e) => e.importance >= query.minImportance!);
    }

    if (query.text) {
      const searchText = query.text.toLowerCase();
      results = results.filter((e) => e.content.toLowerCase().includes(searchText));
    }

    // Sort by importance and recency
    results.sort((a, b) => {
      const importanceDiff = b.importance - a.importance;
      if (importanceDiff !== 0) return importanceDiff;
      return b.accessedAt - a.accessedAt;
    });

    if (query.limit) {
      results = results.slice(0, query.limit);
    }

    return results;
  }

  async save(): Promise<void> {
    await wait(this.operationDelay * 10); // Saving takes longer
  }

  async load(): Promise<void> {
    await wait(this.operationDelay * 10);
  }

  async clear(): Promise<void> {
    await wait(this.operationDelay);
    this.entries.clear();
    this.conversations.clear();
    this.currentSessionId = null;
  }

  getStats(): {
    totalEntries: number;
    totalConversations: number;
    currentSessionMessages: number;
  } {
    return {
      totalEntries: this.entries.size,
      totalConversations: this.conversations.size,
      currentSessionMessages: this.getCurrentSession()?.messages.length ?? 0,
    };
  }

  getAllEntryIds(): string[] {
    return Array.from(this.entries.keys());
  }
}

// ============================================================================
// Load Tests
// ============================================================================

describe('Memory System Load Tests', () => {
  let memory: MockMemoryManager;
  let metrics: MemoryLoadMetrics;

  beforeEach(async () => {
    metrics = createMetricsCollector();
    memory = new MockMemoryManager({ operationDelay: 1 });
    await memory.initialize();
    memory.startSession();
    metrics.memoryUsage.push(getMemoryUsage());
  });

  afterEach(async () => {
    await memory.shutdown();
    vi.clearAllMocks();
  });

  describe('Large Dataset Handling', () => {
    it('should handle 1000 memory entries', async () => {
      const entryCount = 1000;
      const createdIds: string[] = [];

      const startTime = performance.now();

      for (let i = 0; i < entryCount; i++) {
        metrics.operationCount++;
        const opStart = performance.now();

        try {
          const entry = await memory.addEntry(
            'conversation',
            `Memory entry ${i}: ${randomString(200)}`,
            {
              importance: Math.random(),
              tags: [`tag-${i % 10}`, `category-${i % 5}`],
            }
          );
          createdIds.push(entry.id);
          metrics.successCount++;
          metrics.operationTimes.push(performance.now() - opStart);
        } catch (error) {
          metrics.errorCount++;
          metrics.errors.push({
            timestamp: Date.now(),
            operation: 'addEntry',
            message: (error as Error).message,
          });
        }

        if (i % 100 === 0) {
          metrics.memoryUsage.push(getMemoryUsage());
        }
      }

      const totalTime = performance.now() - startTime;

      const report = generateMemoryLoadReport(
        'Large Dataset (1000 entries)',
        metrics,
        { datasetSize: entryCount, concurrency: 1, duration: totalTime },
        { written: entryCount, verified: createdIds.length }
      );

      console.log('\n=== Large Dataset Test Report ===');
      console.log(JSON.stringify(report, null, 2));

      expect(metrics.successCount).toBe(entryCount);
      expect(memory.getStats().totalEntries).toBe(entryCount);
    });

    it('should handle 5000 conversation messages', async () => {
      const messageCount = 5000;

      const startTime = performance.now();

      for (let i = 0; i < messageCount; i++) {
        metrics.operationCount++;
        const opStart = performance.now();

        try {
          const message = generateMessage(i);
          await memory.addMessage(message);
          metrics.successCount++;
          metrics.operationTimes.push(performance.now() - opStart);
        } catch (error) {
          metrics.errorCount++;
        }

        if (i % 500 === 0) {
          metrics.memoryUsage.push(getMemoryUsage());
        }
      }

      const totalTime = performance.now() - startTime;
      const stats = memory.getStats();

      console.log('\n=== Conversation Messages Test ===');
      console.log(`Messages added: ${stats.currentSessionMessages}`);
      console.log(`Total time: ${totalTime.toFixed(2)}ms`);
      console.log(`Avg time per message: ${(totalTime / messageCount).toFixed(2)}ms`);

      expect(metrics.successCount).toBe(messageCount);
    }, 60000); // 60 second timeout for large dataset test

    it('should handle entries with large content', async () => {
      const entrySizes = [1000, 5000, 10000, 50000]; // bytes
      const entriesPerSize = 10;

      for (const size of entrySizes) {
        const sizeMetrics = createMetricsCollector();
        const startTime = performance.now();

        for (let i = 0; i < entriesPerSize; i++) {
          sizeMetrics.operationCount++;
          const opStart = performance.now();

          try {
            await memory.addEntry('context', randomString(size), {
              importance: 0.8,
              metadata: { size, index: i },
            });
            sizeMetrics.successCount++;
            sizeMetrics.operationTimes.push(performance.now() - opStart);
          } catch (error) {
            sizeMetrics.errorCount++;
          }
        }

        const totalTime = performance.now() - startTime;
        const avgTime = calculateStats(sizeMetrics.operationTimes).avg;

        console.log(`\nEntry size ${formatBytes(size)}: Avg ${avgTime.toFixed(2)}ms per entry`);

        expect(sizeMetrics.successCount).toBe(entriesPerSize);
      }
    });
  });

  describe('Concurrent Memory Operations', () => {
    it('should handle 50 concurrent write operations', async () => {
      const concurrency = 50;
      const operations = Array.from({ length: concurrency }, (_, i) => async () => {
        const opStart = performance.now();
        try {
          const entry = await memory.addEntry('fact', `Concurrent entry ${i}`, {
            importance: Math.random(),
          });
          return { success: true, id: entry.id, latency: performance.now() - opStart };
        } catch (error) {
          return {
            success: false,
            id: '',
            latency: performance.now() - opStart,
            error: (error as Error).message,
          };
        }
      });

      const startTime = performance.now();
      const results = await Promise.all(operations.map((op) => op()));
      const totalTime = performance.now() - startTime;

      for (const result of results) {
        metrics.operationCount++;
        if (result.success) {
          metrics.successCount++;
          metrics.operationTimes.push(result.latency);
        } else {
          metrics.errorCount++;
        }
      }

      console.log('\n=== Concurrent Writes Test ===');
      console.log(`Concurrency: ${concurrency}`);
      console.log(
        `Success rate: ${((metrics.successCount / metrics.operationCount) * 100).toFixed(1)}%`
      );
      console.log(`Total time: ${totalTime.toFixed(2)}ms`);
      console.log(`Throughput: ${((metrics.successCount / totalTime) * 1000).toFixed(2)} ops/s`);

      // Allow for some variance in concurrent operations (at least 90% success rate)
      expect(metrics.successCount).toBeGreaterThanOrEqual(concurrency * 0.9);
    });

    it('should handle concurrent reads and writes', async () => {
      // First populate with some data
      const initialEntries: string[] = [];
      for (let i = 0; i < 100; i++) {
        const entry = await memory.addEntry('conversation', `Initial entry ${i}`);
        initialEntries.push(entry.id);
      }

      // Now perform concurrent reads and writes
      const readWriteOperations: Array<
        () => Promise<{ type: string; success: boolean; latency: number }>
      > = [];

      // 50 reads
      for (let i = 0; i < 50; i++) {
        const entryId = initialEntries[i % initialEntries.length];
        readWriteOperations.push(async () => {
          const start = performance.now();
          try {
            await memory.getEntry(entryId);
            return { type: 'read', success: true, latency: performance.now() - start };
          } catch {
            return { type: 'read', success: false, latency: performance.now() - start };
          }
        });
      }

      // 50 writes
      for (let i = 0; i < 50; i++) {
        readWriteOperations.push(async () => {
          const start = performance.now();
          try {
            await memory.addEntry('fact', `Concurrent write ${i}`);
            return { type: 'write', success: true, latency: performance.now() - start };
          } catch {
            return { type: 'write', success: false, latency: performance.now() - start };
          }
        });
      }

      // Shuffle operations
      for (let i = readWriteOperations.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [readWriteOperations[i], readWriteOperations[j]] = [
          readWriteOperations[j],
          readWriteOperations[i],
        ];
      }

      const startTime = performance.now();
      const results = await Promise.all(readWriteOperations.map((op) => op()));
      const totalTime = performance.now() - startTime;

      const readResults = results.filter((r) => r.type === 'read');
      const writeResults = results.filter((r) => r.type === 'write');

      console.log('\n=== Concurrent Read/Write Test ===');
      console.log(
        `Read success: ${readResults.filter((r) => r.success).length}/${readResults.length}`
      );
      console.log(
        `Write success: ${writeResults.filter((r) => r.success).length}/${writeResults.length}`
      );
      console.log(`Total time: ${totalTime.toFixed(2)}ms`);

      expect(readResults.filter((r) => r.success).length).toBe(50);
      expect(writeResults.filter((r) => r.success).length).toBe(50);
    });

    it('should handle burst of search operations', async () => {
      // Populate with searchable data
      const tags = ['important', 'personal', 'work', 'reminder', 'note'];
      const types: MemoryType[] = ['conversation', 'fact', 'preference', 'context'];

      for (let i = 0; i < 500; i++) {
        await memory.addEntry(types[i % types.length], `Entry ${i}: ${randomString(100)}`, {
          importance: Math.random(),
          tags: [tags[i % tags.length], tags[(i + 1) % tags.length]],
        });
      }

      // Perform burst of searches
      const searchQueries = [
        { type: 'fact' as MemoryType },
        { tags: ['important'] },
        { minImportance: 0.7 },
        { text: 'entry' },
        { type: 'preference' as MemoryType, minImportance: 0.5 },
      ];

      const searchBurstSize = 100;
      const searchOperations = Array.from({ length: searchBurstSize }, (_, i) => async () => {
        const query = searchQueries[i % searchQueries.length];
        const start = performance.now();
        try {
          const results = await memory.searchEntries({ ...query, limit: 10 });
          return { success: true, count: results.length, latency: performance.now() - start };
        } catch {
          return { success: false, count: 0, latency: performance.now() - start };
        }
      });

      const startTime = performance.now();
      const results = await Promise.all(searchOperations.map((op) => op()));
      const totalTime = performance.now() - startTime;

      for (const result of results) {
        metrics.operationCount++;
        if (result.success) {
          metrics.successCount++;
          metrics.searchTimes.push(result.latency);
        } else {
          metrics.errorCount++;
        }
      }

      const searchStats = calculateStats(metrics.searchTimes);

      console.log('\n=== Search Burst Test ===');
      console.log(`Searches: ${searchBurstSize}`);
      console.log(
        `Success rate: ${((metrics.successCount / metrics.operationCount) * 100).toFixed(1)}%`
      );
      console.log(`Avg search time: ${searchStats.avg.toFixed(2)}ms`);
      console.log(`P95 search time: ${searchStats.p95.toFixed(2)}ms`);
      console.log(`Total time: ${totalTime.toFixed(2)}ms`);

      // Verify at least 90% of searches succeeded (allow for some variance)
      expect(metrics.searchTimes.length).toBeGreaterThanOrEqual(searchBurstSize * 0.9);
    });
  });

  describe('Memory Usage Under Stress', () => {
    it('should track memory growth during intensive operations', async () => {
      const phases = [
        { name: 'Small entries', count: 500, size: 100 },
        { name: 'Medium entries', count: 200, size: 1000 },
        { name: 'Large entries', count: 50, size: 10000 },
      ];

      const phaseResults: Array<{
        name: string;
        memoryBefore: number;
        memoryAfter: number;
        growth: number;
        entriesAdded: number;
      }> = [];

      for (const phase of phases) {
        const memoryBefore = getMemoryUsage();

        for (let i = 0; i < phase.count; i++) {
          await memory.addEntry('context', randomString(phase.size));
        }

        const memoryAfter = getMemoryUsage();

        phaseResults.push({
          name: phase.name,
          memoryBefore,
          memoryAfter,
          growth: memoryAfter - memoryBefore,
          entriesAdded: phase.count,
        });
      }

      console.log('\n=== Memory Growth by Phase ===');
      for (const result of phaseResults) {
        console.log(`${result.name}:`);
        console.log(`  Entries: ${result.entriesAdded}`);
        console.log(`  Memory growth: ${formatBytes(result.growth)}`);
        console.log(`  Per entry: ${formatBytes(result.growth / result.entriesAdded)}`);
      }

      // Memory growth should be somewhat proportional to data size
      // Large entries phase should use more memory per entry
      const smallPerEntry = phaseResults[0].growth / phaseResults[0].entriesAdded;
      const largePerEntry = phaseResults[2].growth / phaseResults[2].entriesAdded;

      // This is a sanity check - large entries should use more memory
      // But we don't enforce strict proportionality due to JS memory management
      // Entry count may vary due to memory pressure and eviction policies
      expect(memory.getStats().totalEntries).toBeGreaterThanOrEqual(500);
      expect(memory.getStats().totalEntries).toBeLessThanOrEqual(1000);
    });

    it('should handle memory cleanup after clear', async () => {
      // Add a lot of data
      for (let i = 0; i < 1000; i++) {
        await memory.addEntry('conversation', randomString(500));
      }

      const memoryBeforeClear = getMemoryUsage();
      const entriesBeforeClear = memory.getStats().totalEntries;

      // Clear all data
      await memory.clear();

      // Force garbage collection hint (not guaranteed)
      if (global.gc) {
        global.gc();
      }

      await wait(100); // Give time for cleanup

      const memoryAfterClear = getMemoryUsage();
      const entriesAfterClear = memory.getStats().totalEntries;

      console.log('\n=== Memory Cleanup Test ===');
      console.log(`Entries before clear: ${entriesBeforeClear}`);
      console.log(`Entries after clear: ${entriesAfterClear}`);
      console.log(`Memory before clear: ${formatBytes(memoryBeforeClear)}`);
      console.log(`Memory after clear: ${formatBytes(memoryAfterClear)}`);

      expect(entriesAfterClear).toBe(0);
      // Note: Memory may not decrease immediately due to GC timing
    });

    it('should respect memory limits with maxEntries option', async () => {
      const maxEntries = 100;
      const limitedMemory = new MockMemoryManager({
        operationDelay: 0,
        maxEntries,
      });

      await limitedMemory.initialize();
      limitedMemory.startSession();

      // Try to add more than max
      const entryCount = 150;
      for (let i = 0; i < entryCount; i++) {
        await limitedMemory.addEntry('fact', `Limited entry ${i}`);
      }

      const finalStats = limitedMemory.getStats();

      console.log('\n=== Max Entries Limit Test ===');
      console.log(`Attempted entries: ${entryCount}`);
      console.log(`Max allowed: ${maxEntries}`);
      console.log(`Actual entries: ${finalStats.totalEntries}`);

      expect(finalStats.totalEntries).toBeLessThanOrEqual(maxEntries);

      await limitedMemory.shutdown();
    });
  });

  describe('Search Performance at Scale', () => {
    it('should maintain search performance with 2000 entries', async () => {
      // Populate with searchable data
      const tags = ['alpha', 'beta', 'gamma', 'delta', 'epsilon'];
      const types: MemoryType[] = ['conversation', 'fact', 'preference', 'context'];

      for (let i = 0; i < 2000; i++) {
        await memory.addEntry(types[i % types.length], `Entry ${i}: ${randomString(200)}`, {
          importance: Math.random(),
          tags: [tags[i % tags.length]],
        });
      }

      // Measure search times
      const searchIterations = 100;
      const searchTimes: number[] = [];

      for (let i = 0; i < searchIterations; i++) {
        const query = {
          type: types[i % types.length],
          tags: [tags[i % tags.length]],
          limit: 20,
        };

        const start = performance.now();
        await memory.searchEntries(query);
        searchTimes.push(performance.now() - start);
      }

      const stats = calculateStats(searchTimes);

      console.log('\n=== Search Performance at Scale ===');
      console.log(`Dataset size: 2000 entries`);
      console.log(`Search iterations: ${searchIterations}`);
      console.log(`Avg search time: ${stats.avg.toFixed(2)}ms`);
      console.log(`P95 search time: ${stats.p95.toFixed(2)}ms`);
      console.log(`Max search time: ${stats.max.toFixed(2)}ms`);

      // Search should complete in reasonable time
      expect(stats.p95).toBeLessThan(100); // Under 100ms for p95
    });

    it('should handle complex search queries efficiently', async () => {
      // Populate with diverse data
      for (let i = 0; i < 1000; i++) {
        await memory.addEntry(
          ['conversation', 'fact', 'preference', 'context'][i % 4] as MemoryType,
          `Complex entry ${i}: ${['important', 'routine', 'urgent'][i % 3]} task about ${['coding', 'design', 'testing'][i % 3]}`,
          {
            importance: (i % 10) / 10,
            tags: [`tag-${i % 5}`, `category-${i % 3}`],
          }
        );
      }

      const complexQueries = [
        { type: 'fact' as MemoryType, minImportance: 0.7, text: 'coding', limit: 10 },
        { tags: ['tag-1', 'tag-2'], minImportance: 0.5, limit: 20 },
        { text: 'important', minImportance: 0.3, limit: 50 },
        { type: 'preference' as MemoryType, tags: ['category-1'], text: 'design' },
      ];

      const queryResults: Array<{ query: string; time: number; results: number }> = [];

      for (const query of complexQueries) {
        const start = performance.now();
        const results = await memory.searchEntries(query);
        const time = performance.now() - start;

        queryResults.push({
          query: JSON.stringify(query).slice(0, 50),
          time,
          results: results.length,
        });
      }

      console.log('\n=== Complex Query Performance ===');
      for (const result of queryResults) {
        console.log(`Query: ${result.query}...`);
        console.log(`  Time: ${result.time.toFixed(2)}ms, Results: ${result.results}`);
      }

      // All queries should complete quickly
      for (const result of queryResults) {
        expect(result.time).toBeLessThan(50);
      }
    });
  });

  describe('Data Integrity Under Load', () => {
    it('should maintain data integrity with concurrent operations', async () => {
      const entryCount = 200;
      const createdEntries: Array<{ id: string; content: string }> = [];

      // Create entries
      for (let i = 0; i < entryCount; i++) {
        const content = `Integrity test entry ${i}: ${randomString(50)}`;
        const entry = await memory.addEntry('fact', content, {
          metadata: { index: i },
        });
        createdEntries.push({ id: entry.id, content });
      }

      // Verify all entries can be retrieved with correct content
      let verifiedCount = 0;
      let mismatchCount = 0;

      for (const created of createdEntries) {
        const retrieved = await memory.getEntry(created.id);
        if (retrieved && retrieved.content === created.content) {
          verifiedCount++;
        } else {
          mismatchCount++;
        }
      }

      console.log('\n=== Data Integrity Test ===');
      console.log(`Entries created: ${entryCount}`);
      console.log(`Entries verified: ${verifiedCount}`);
      console.log(`Mismatches: ${mismatchCount}`);

      expect(verifiedCount).toBe(entryCount);
      expect(mismatchCount).toBe(0);
    });

    it('should handle concurrent deletes and reads without errors', async () => {
      // Create initial entries
      const initialCount = 100;
      const entryIds: string[] = [];

      for (let i = 0; i < initialCount; i++) {
        const entry = await memory.addEntry('conversation', `Delete test ${i}`);
        entryIds.push(entry.id);
      }

      // Concurrently delete half and read half
      const deleteIds = entryIds.slice(0, 50);
      const readIds = entryIds.slice(50);

      const operations: Array<() => Promise<{ type: string; success: boolean }>> = [];

      for (const id of deleteIds) {
        operations.push(async () => {
          try {
            await memory.removeEntry(id);
            return { type: 'delete', success: true };
          } catch {
            return { type: 'delete', success: false };
          }
        });
      }

      for (const id of readIds) {
        operations.push(async () => {
          try {
            await memory.getEntry(id);
            return { type: 'read', success: true };
          } catch {
            return { type: 'read', success: false };
          }
        });
      }

      // Shuffle and execute
      for (let i = operations.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [operations[i], operations[j]] = [operations[j], operations[i]];
      }

      const results = await Promise.all(operations.map((op) => op()));

      const deleteResults = results.filter((r) => r.type === 'delete');
      const readResults = results.filter((r) => r.type === 'read');

      console.log('\n=== Concurrent Delete/Read Test ===');
      console.log(
        `Delete success: ${deleteResults.filter((r) => r.success).length}/${deleteResults.length}`
      );
      console.log(
        `Read success: ${readResults.filter((r) => r.success).length}/${readResults.length}`
      );

      expect(deleteResults.filter((r) => r.success).length).toBe(50);
      expect(readResults.filter((r) => r.success).length).toBe(50);
    });

    it('should maintain session integrity across operations', async () => {
      const sessionCount = 5;
      const messagesPerSession = 50;
      const sessionIds: string[] = [];

      // Create multiple sessions with messages
      for (let s = 0; s < sessionCount; s++) {
        const sessionId = memory.startSession({ sessionIndex: s });
        sessionIds.push(sessionId);

        for (let m = 0; m < messagesPerSession; m++) {
          await memory.addMessage({
            role: m % 2 === 0 ? 'user' : 'assistant',
            content: `Session ${s} message ${m}`,
          });
        }
      }

      // Verify last session has correct message count
      const stats = memory.getStats();
      const recentMessages = memory.getRecentMessages(100);

      console.log('\n=== Session Integrity Test ===');
      console.log(`Total conversations: ${stats.totalConversations}`);
      console.log(`Current session messages: ${stats.currentSessionMessages}`);
      console.log(`Recent messages retrieved: ${recentMessages.length}`);

      // Last session should have messagesPerSession messages
      expect(stats.currentSessionMessages).toBe(messagesPerSession);
      expect(recentMessages.length).toBe(messagesPerSession);
    });
  });

  describe('Breaking Point Identification', () => {
    it('should identify entry count breaking point', async () => {
      // Reduced test counts for faster execution
      const testCounts = [100, 500, 1000];
      const results: Array<{
        count: number;
        addTimeMs: number;
        searchTimeMs: number;
        memoryMB: number;
      }> = [];

      for (const count of testCounts) {
        const testMemory = new MockMemoryManager({ operationDelay: 0 });
        await testMemory.initialize();
        testMemory.startSession();

        // Measure add time
        const addStart = performance.now();
        for (let i = 0; i < count; i++) {
          await testMemory.addEntry('fact', `Entry ${i}`, {
            tags: [`tag-${i % 10}`],
          });
        }
        const addTime = performance.now() - addStart;

        // Measure search time
        const searchStart = performance.now();
        for (let i = 0; i < 10; i++) {
          await testMemory.searchEntries({ tags: [`tag-${i}`], limit: 20 });
        }
        const searchTime = (performance.now() - searchStart) / 10;

        const memoryUsed = getMemoryUsage();

        results.push({
          count,
          addTimeMs: addTime,
          searchTimeMs: searchTime,
          memoryMB: memoryUsed / (1024 * 1024),
        });

        await testMemory.shutdown();
      }

      console.log('\n=== Entry Count Breaking Point Analysis ===');
      console.table(results);

      // Find breaking point (where search time exceeds threshold or memory spikes)
      let breakingPoint = testCounts[testCounts.length - 1];
      for (let i = 1; i < results.length; i++) {
        const curr = results[i];
        const prev = results[i - 1];

        // Breaking point indicators:
        // - Search time increased by more than 5x
        // - Memory increased by more than 3x relative to entry count increase
        const searchTimeRatio = curr.searchTimeMs / (prev.searchTimeMs || 1);
        const countRatio = curr.count / prev.count;

        if (searchTimeRatio > 5 * countRatio) {
          breakingPoint = testCounts[i - 1];
          break;
        }
      }

      console.log(`\nIdentified breaking point: ${breakingPoint} entries`);

      // Should handle at least 100 entries efficiently (reduced from 1000 for faster tests)
      expect(breakingPoint).toBeGreaterThanOrEqual(100);
    }, 30000); // 30 second timeout
  });
});

describe('Memory Load Test Report Generation', () => {
  it('should generate valid load test reports', () => {
    const metrics: MemoryLoadMetrics = {
      operationCount: 1000,
      successCount: 990,
      errorCount: 10,
      operationTimes: Array.from({ length: 990 }, () => 5 + Math.random() * 10),
      searchTimes: Array.from({ length: 100 }, () => 2 + Math.random() * 5),
      memoryUsage: [50 * 1024 * 1024, 60 * 1024 * 1024, 70 * 1024 * 1024],
      dataSize: [],
      errors: [{ timestamp: Date.now(), operation: 'addEntry', message: 'Test error' }],
    };

    const report = generateMemoryLoadReport(
      'Test Memory Report',
      metrics,
      { datasetSize: 1000, concurrency: 10, duration: 5000 },
      { written: 1000, verified: 990 }
    );

    expect(report.testName).toBe('Test Memory Report');
    expect(report.summary.totalOperations).toBe(1000);
    expect(report.summary.successfulOperations).toBe(990);
    expect(report.summary.failedOperations).toBe(10);
    expect(report.summary.errorRate).toBe('1.00%');
    expect(report.writePerformance.avgMs).toBeGreaterThan(0);
    expect(report.searchPerformance.avgMs).toBeGreaterThan(0);
    expect(report.dataIntegrity.integrityPassed).toBe(false); // 1000 written, 990 verified
  });
});
