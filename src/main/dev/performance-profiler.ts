/* eslint-disable no-console */
/**
 * Atlas Desktop - Performance Profiler
 * Memory and CPU profiling for development mode (048-C)
 *
 * Features:
 * - Memory usage tracking
 * - CPU profiling snapshots
 * - Event loop lag monitoring
 * - Heap snapshots
 * - Performance metrics collection
 *
 * @module dev/performance-profiler
 */

import { EventEmitter } from 'events';
import * as v8 from 'v8';
import * as os from 'os';

/**
 * Memory statistics
 */
export interface MemoryStats {
  heapUsed: number;
  heapTotal: number;
  external: number;
  arrayBuffers: number;
  rss: number;
  heapUsedMB: number;
  heapTotalMB: number;
  rssMB: number;
  percentUsed: number;
}

/**
 * CPU statistics
 */
export interface CPUStats {
  user: number;
  system: number;
  idle: number;
  usage: number;
  cores: number;
}

/**
 * Event loop statistics
 */
export interface EventLoopStats {
  lag: number;
  lagMs: number;
  timestamp: number;
}

/**
 * Performance snapshot
 */
export interface PerformanceSnapshot {
  timestamp: number;
  memory: MemoryStats;
  cpu: CPUStats;
  eventLoop: EventLoopStats;
  uptime: number;
  pid: number;
}

/**
 * Profiling session
 */
export interface ProfilingSession {
  id: string;
  startTime: number;
  endTime?: number;
  snapshots: PerformanceSnapshot[];
  averageMemory: number;
  peakMemory: number;
  averageCPU: number;
  peakCPU: number;
}

/**
 * Performance Profiler class
 */
export class PerformanceProfiler extends EventEmitter {
  private monitoringInterval: NodeJS.Timeout | null = null;
  private lastCPUUsage: os.CpuInfo[] | null = null;
  private lastCPUTime: number = 0;
  private snapshots: PerformanceSnapshot[] = [];
  private maxSnapshots: number = 1000;
  private sessions: Map<string, ProfilingSession> = new Map();
  private eventLoopLag: number = 0;
  private eventLoopMonitor: NodeJS.Timeout | null = null;

  /**
   * Get current memory statistics
   */
  getMemoryStats(): MemoryStats {
    const mem = process.memoryUsage();
    const heapStats = v8.getHeapStatistics();

    return {
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
      external: mem.external,
      arrayBuffers: mem.arrayBuffers,
      rss: mem.rss,
      heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
      rssMB: Math.round(mem.rss / 1024 / 1024),
      percentUsed: Math.round((heapStats.used_heap_size / heapStats.heap_size_limit) * 100),
    };
  }

  /**
   * Get current CPU statistics
   */
  getCPUStats(): CPUStats {
    const cpus = os.cpus();
    const numCores = cpus.length;

    let totalUser = 0;
    let totalSystem = 0;
    let totalIdle = 0;

    for (const cpu of cpus) {
      totalUser += cpu.times.user;
      totalSystem += cpu.times.sys;
      totalIdle += cpu.times.idle;
    }

    const total = totalUser + totalSystem + totalIdle;
    const usage = total > 0 ? ((totalUser + totalSystem) / total) * 100 : 0;

    // Calculate delta from last measurement
    let deltaUsage = usage;
    if (this.lastCPUUsage) {
      const now = Date.now();
      const elapsed = now - this.lastCPUTime;
      if (elapsed > 0) {
        let lastTotal = 0;
        let lastActive = 0;
        for (const cpu of this.lastCPUUsage) {
          lastTotal += cpu.times.user + cpu.times.sys + cpu.times.idle;
          lastActive += cpu.times.user + cpu.times.sys;
        }
        const currentTotal = totalUser + totalSystem + totalIdle;
        const currentActive = totalUser + totalSystem;
        const deltaTotal = currentTotal - lastTotal;
        const deltaActive = currentActive - lastActive;
        if (deltaTotal > 0) {
          deltaUsage = (deltaActive / deltaTotal) * 100;
        }
      }
    }

    this.lastCPUUsage = cpus;
    this.lastCPUTime = Date.now();

    return {
      user: totalUser,
      system: totalSystem,
      idle: totalIdle,
      usage: Math.round(deltaUsage * 10) / 10,
      cores: numCores,
    };
  }

  /**
   * Get event loop statistics
   */
  getEventLoopStats(): EventLoopStats {
    return {
      lag: this.eventLoopLag,
      lagMs: Math.round(this.eventLoopLag * 10) / 10,
      timestamp: Date.now(),
    };
  }

  /**
   * Take a performance snapshot
   */
  takeSnapshot(): PerformanceSnapshot {
    const snapshot: PerformanceSnapshot = {
      timestamp: Date.now(),
      memory: this.getMemoryStats(),
      cpu: this.getCPUStats(),
      eventLoop: this.getEventLoopStats(),
      uptime: process.uptime(),
      pid: process.pid,
    };

    // Store snapshot
    this.snapshots.push(snapshot);
    if (this.snapshots.length > this.maxSnapshots) {
      this.snapshots.shift();
    }

    this.emit('snapshot', snapshot);
    return snapshot;
  }

  /**
   * Start monitoring
   */
  startMonitoring(intervalMs: number = 1000): void {
    if (this.monitoringInterval) {
      return;
    }

    // Start event loop monitoring
    this.startEventLoopMonitoring();

    // Take snapshots at regular intervals
    this.monitoringInterval = setInterval(() => {
      const snapshot = this.takeSnapshot();

      // Emit warnings for high usage
      if (snapshot.memory.percentUsed > 80) {
        this.emit('memory-warning', snapshot.memory);
      }
      if (snapshot.cpu.usage > 90) {
        this.emit('cpu-warning', snapshot.cpu);
      }
      if (snapshot.eventLoop.lagMs > 100) {
        this.emit('eventloop-warning', snapshot.eventLoop);
      }
    }, intervalMs);

    console.log(`[PerformanceProfiler] Started monitoring (interval: ${intervalMs}ms)`);
  }

  /**
   * Stop monitoring
   */
  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    if (this.eventLoopMonitor) {
      clearInterval(this.eventLoopMonitor);
      this.eventLoopMonitor = null;
    }
    console.log('[PerformanceProfiler] Stopped monitoring');
  }

  /**
   * Start event loop lag monitoring
   */
  private startEventLoopMonitoring(): void {
    let lastTime = Date.now();
    const checkInterval = 100;

    this.eventLoopMonitor = setInterval(() => {
      const now = Date.now();
      const elapsed = now - lastTime;
      this.eventLoopLag = elapsed - checkInterval;
      lastTime = now;
    }, checkInterval);
  }

  /**
   * Start a profiling session
   */
  startSession(name?: string): string {
    const id = name || `session-${Date.now()}`;
    const session: ProfilingSession = {
      id,
      startTime: Date.now(),
      snapshots: [],
      averageMemory: 0,
      peakMemory: 0,
      averageCPU: 0,
      peakCPU: 0,
    };
    this.sessions.set(id, session);
    console.log(`[PerformanceProfiler] Started session: ${id}`);
    return id;
  }

  /**
   * End a profiling session
   */
  endSession(id: string): ProfilingSession | null {
    const session = this.sessions.get(id);
    if (!session) {
      return null;
    }

    session.endTime = Date.now();

    // Get snapshots during this session
    session.snapshots = this.snapshots.filter(
      (s) => s.timestamp >= session.startTime && s.timestamp <= (session.endTime || Date.now())
    );

    // Calculate statistics
    if (session.snapshots.length > 0) {
      let totalMemory = 0;
      let totalCPU = 0;
      let peakMemory = 0;
      let peakCPU = 0;

      for (const snapshot of session.snapshots) {
        totalMemory += snapshot.memory.heapUsedMB;
        totalCPU += snapshot.cpu.usage;
        if (snapshot.memory.heapUsedMB > peakMemory) {
          peakMemory = snapshot.memory.heapUsedMB;
        }
        if (snapshot.cpu.usage > peakCPU) {
          peakCPU = snapshot.cpu.usage;
        }
      }

      session.averageMemory = Math.round(totalMemory / session.snapshots.length);
      session.peakMemory = peakMemory;
      session.averageCPU = Math.round((totalCPU / session.snapshots.length) * 10) / 10;
      session.peakCPU = peakCPU;
    }

    console.log(`[PerformanceProfiler] Ended session: ${id}`);
    return session;
  }

  /**
   * Get heap snapshot info
   */
  getHeapSnapshotInfo(): v8.HeapInfo {
    return v8.getHeapStatistics();
  }

  /**
   * Force garbage collection (requires --expose-gc flag)
   */
  forceGC(): boolean {
    if (global.gc) {
      global.gc();
      console.log('[PerformanceProfiler] Forced garbage collection');
      return true;
    }
    console.warn('[PerformanceProfiler] GC not exposed. Run with --expose-gc flag.');
    return false;
  }

  /**
   * Get recent snapshots
   */
  getRecentSnapshots(count: number = 60): PerformanceSnapshot[] {
    return this.snapshots.slice(-count);
  }

  /**
   * Get all sessions
   */
  getSessions(): ProfilingSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Clear snapshots and sessions
   */
  clear(): void {
    this.snapshots = [];
    this.sessions.clear();
    console.log('[PerformanceProfiler] Cleared all data');
  }

  /**
   * Get summary statistics
   */
  getSummary(): {
    uptimeMinutes: number;
    snapshotCount: number;
    sessionCount: number;
    currentMemory: MemoryStats;
    currentCPU: CPUStats;
    averageEventLoopLag: number;
  } {
    const recentSnapshots = this.getRecentSnapshots(60);
    let totalLag = 0;
    for (const s of recentSnapshots) {
      totalLag += s.eventLoop.lagMs;
    }

    return {
      uptimeMinutes: Math.round(process.uptime() / 60),
      snapshotCount: this.snapshots.length,
      sessionCount: this.sessions.size,
      currentMemory: this.getMemoryStats(),
      currentCPU: this.getCPUStats(),
      averageEventLoopLag:
        recentSnapshots.length > 0 ? Math.round((totalLag / recentSnapshots.length) * 10) / 10 : 0,
    };
  }
}

// Singleton instance
let profiler: PerformanceProfiler | null = null;

/**
 * Get the singleton PerformanceProfiler instance
 */
export function getPerformanceProfiler(): PerformanceProfiler {
  if (!profiler) {
    profiler = new PerformanceProfiler();
  }
  return profiler;
}

/**
 * Shutdown the profiler
 */
export function shutdownPerformanceProfiler(): void {
  if (profiler) {
    profiler.stopMonitoring();
    profiler.removeAllListeners();
    profiler = null;
  }
}

export default PerformanceProfiler;
