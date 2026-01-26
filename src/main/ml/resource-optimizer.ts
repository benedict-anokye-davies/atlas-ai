/**
 * Atlas Desktop - Resource Optimizer
 * Dynamically optimize resource usage based on system state
 *
 * Features:
 * - CPU/Memory/GPU monitoring
 * - Adaptive quality settings
 * - Battery-aware optimization
 * - Thermal management
 * - Process priority adjustment
 *
 * @module ml/resource-optimizer
 */

import { EventEmitter } from 'events';
import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('ResourceOptimizer');

// ============================================================================
// Types
// ============================================================================

export interface SystemMetrics {
  timestamp: number;
  cpu: {
    usage: number; // 0-100
    cores: number;
    speed: number; // MHz
    temperature?: number;
  };
  memory: {
    total: number; // bytes
    used: number;
    free: number;
    usagePercent: number;
  };
  gpu?: {
    usage: number;
    memoryUsed: number;
    memoryTotal: number;
    temperature?: number;
  };
  battery?: {
    level: number; // 0-100
    charging: boolean;
    timeRemaining?: number; // minutes
  };
  network: {
    latency: number;
    bandwidth?: number;
  };
}

export interface OptimizationProfile {
  name: string;
  priority: 'performance' | 'balanced' | 'efficiency';
  maxCpuUsage: number;
  maxMemoryUsage: number;
  particleCount: number;
  animationFrameRate: number;
  audioQuality: 'high' | 'medium' | 'low';
  llmBatchSize: number;
  cacheSize: number;
  backgroundTasksEnabled: boolean;
}

export interface ResourceThreshold {
  metric: 'cpu' | 'memory' | 'gpu' | 'battery' | 'temperature';
  warningLevel: number;
  criticalLevel: number;
  action: ThresholdAction;
}

export type ThresholdAction =
  | 'reduce-quality'
  | 'pause-background'
  | 'clear-cache'
  | 'notify-user'
  | 'throttle-requests';

export interface OptimizationEvent {
  timestamp: number;
  trigger: string;
  action: string;
  profileBefore: string;
  profileAfter: string;
  metrics: Partial<SystemMetrics>;
}

export interface ResourceOptimizerConfig {
  pollingInterval: number; // ms
  historySize: number;
  autoOptimize: boolean;
  respectBattery: boolean;
  thermalThrottle: boolean;
}

// ============================================================================
// Predefined Profiles
// ============================================================================

const OPTIMIZATION_PROFILES: Record<string, OptimizationProfile> = {
  performance: {
    name: 'Performance',
    priority: 'performance',
    maxCpuUsage: 90,
    maxMemoryUsage: 80,
    particleCount: 50000,
    animationFrameRate: 60,
    audioQuality: 'high',
    llmBatchSize: 8,
    cacheSize: 500 * 1024 * 1024, // 500MB
    backgroundTasksEnabled: true,
  },
  balanced: {
    name: 'Balanced',
    priority: 'balanced',
    maxCpuUsage: 70,
    maxMemoryUsage: 60,
    particleCount: 30000,
    animationFrameRate: 45,
    audioQuality: 'medium',
    llmBatchSize: 4,
    cacheSize: 200 * 1024 * 1024, // 200MB
    backgroundTasksEnabled: true,
  },
  efficiency: {
    name: 'Power Saver',
    priority: 'efficiency',
    maxCpuUsage: 50,
    maxMemoryUsage: 40,
    particleCount: 15000,
    animationFrameRate: 30,
    audioQuality: 'low',
    llmBatchSize: 2,
    cacheSize: 100 * 1024 * 1024, // 100MB
    backgroundTasksEnabled: false,
  },
  minimal: {
    name: 'Minimal',
    priority: 'efficiency',
    maxCpuUsage: 30,
    maxMemoryUsage: 30,
    particleCount: 5000,
    animationFrameRate: 15,
    audioQuality: 'low',
    llmBatchSize: 1,
    cacheSize: 50 * 1024 * 1024, // 50MB
    backgroundTasksEnabled: false,
  },
};

// ============================================================================
// Metrics Collector
// ============================================================================

class MetricsCollector {
  private cpuHistory: number[] = [];
  private historySize: number;

  constructor(historySize: number) {
    this.historySize = historySize;
  }

  /**
   * Collect current system metrics
   */
  async collect(): Promise<SystemMetrics> {
    const cpuUsage = await this.getCpuUsage();
    const memInfo = this.getMemoryInfo();

    return {
      timestamp: Date.now(),
      cpu: {
        usage: cpuUsage,
        cores: os.cpus().length,
        speed: os.cpus()[0]?.speed || 0,
      },
      memory: memInfo,
      network: {
        latency: await this.measureLatency(),
      },
      // Battery info would require native module or system API
    };
  }

  /**
   * Get CPU usage percentage
   */
  private async getCpuUsage(): Promise<number> {
    const cpus = os.cpus();
    const startIdle = cpus.reduce((acc, cpu) => acc + cpu.times.idle, 0);
    const startTotal = cpus.reduce(
      (acc, cpu) => acc + cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq,
      0
    );

    await new Promise((resolve) => setTimeout(resolve, 100));

    const endCpus = os.cpus();
    const endIdle = endCpus.reduce((acc, cpu) => acc + cpu.times.idle, 0);
    const endTotal = endCpus.reduce(
      (acc, cpu) => acc + cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq,
      0
    );

    const idleDiff = endIdle - startIdle;
    const totalDiff = endTotal - startTotal;

    const usage = totalDiff > 0 ? (1 - idleDiff / totalDiff) * 100 : 0;

    this.cpuHistory.push(usage);
    if (this.cpuHistory.length > this.historySize) {
      this.cpuHistory.shift();
    }

    return usage;
  }

  /**
   * Get memory information
   */
  private getMemoryInfo(): SystemMetrics['memory'] {
    const total = os.totalmem();
    const free = os.freemem();
    const used = total - free;

    return {
      total,
      used,
      free,
      usagePercent: (used / total) * 100,
    };
  }

  /**
   * Measure network latency (simple ping)
   */
  private async measureLatency(): Promise<number> {
    const start = Date.now();
    try {
      // Simple latency check - in production would ping actual server
      await new Promise((resolve) => setTimeout(resolve, 1));
      return Date.now() - start;
    } catch {
      return -1;
    }
  }

  /**
   * Get average CPU usage
   */
  getAverageCpuUsage(): number {
    if (this.cpuHistory.length === 0) return 0;
    return this.cpuHistory.reduce((a, b) => a + b, 0) / this.cpuHistory.length;
  }

  /**
   * Get CPU usage trend
   */
  getCpuTrend(): 'increasing' | 'stable' | 'decreasing' {
    if (this.cpuHistory.length < 5) return 'stable';

    const recent = this.cpuHistory.slice(-5);
    const older = this.cpuHistory.slice(-10, -5);

    if (older.length === 0) return 'stable';

    const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;

    const diff = recentAvg - olderAvg;
    if (diff > 10) return 'increasing';
    if (diff < -10) return 'decreasing';
    return 'stable';
  }
}

// ============================================================================
// Resource Optimizer
// ============================================================================

export class ResourceOptimizer extends EventEmitter {
  private config: ResourceOptimizerConfig;
  private currentProfile: OptimizationProfile;
  private metricsCollector: MetricsCollector;
  private metricsHistory: SystemMetrics[] = [];
  private eventHistory: OptimizationEvent[] = [];
  private thresholds: ResourceThreshold[] = [];
  private pollingTimer: NodeJS.Timeout | null = null;
  private dataPath: string;

  // Stats
  private stats = {
    optimizationsApplied: 0,
    profileChanges: 0,
    thresholdBreaches: 0,
    uptime: 0,
  };

  constructor(config?: Partial<ResourceOptimizerConfig>) {
    super();
    this.config = {
      pollingInterval: 5000,
      historySize: 100,
      autoOptimize: true,
      respectBattery: true,
      thermalThrottle: true,
      ...config,
    };

    this.currentProfile = OPTIMIZATION_PROFILES.balanced;
    this.metricsCollector = new MetricsCollector(this.config.historySize);
    this.dataPath = path.join(app.getPath('userData'), 'resource-optimizer.json');

    this.initializeThresholds();
    this.loadData();

    if (this.config.autoOptimize) {
      this.startMonitoring();
    }

    logger.info('ResourceOptimizer initialized', {
      profile: this.currentProfile.name,
      config: this.config,
    });
  }

  // ============================================================================
  // Initialization
  // ============================================================================

  private initializeThresholds(): void {
    this.thresholds = [
      { metric: 'cpu', warningLevel: 70, criticalLevel: 90, action: 'reduce-quality' },
      { metric: 'memory', warningLevel: 75, criticalLevel: 90, action: 'clear-cache' },
      { metric: 'battery', warningLevel: 30, criticalLevel: 15, action: 'reduce-quality' },
      { metric: 'temperature', warningLevel: 80, criticalLevel: 95, action: 'throttle-requests' },
    ];
  }

  // ============================================================================
  // Data Persistence
  // ============================================================================

  private loadData(): void {
    try {
      if (fs.existsSync(this.dataPath)) {
        const data = JSON.parse(fs.readFileSync(this.dataPath, 'utf-8'));

        if (data.currentProfile && OPTIMIZATION_PROFILES[data.currentProfile]) {
          this.currentProfile = OPTIMIZATION_PROFILES[data.currentProfile];
        }

        if (data.stats) {
          this.stats = { ...this.stats, ...data.stats };
        }

        logger.info('Loaded optimizer data', { profile: this.currentProfile.name });
      }
    } catch (error) {
      logger.warn('Failed to load optimizer data', { error });
    }
  }

  private saveData(): void {
    try {
      const data = {
        currentProfile: this.currentProfile.name.toLowerCase().replace(' ', '-'),
        stats: this.stats,
        eventHistory: this.eventHistory.slice(-50),
        savedAt: Date.now(),
      };
      fs.writeFileSync(this.dataPath, JSON.stringify(data, null, 2));
    } catch (error) {
      logger.warn('Failed to save optimizer data', { error });
    }
  }

  // ============================================================================
  // Monitoring
  // ============================================================================

  /**
   * Start resource monitoring
   */
  startMonitoring(): void {
    if (this.pollingTimer) return;

    this.pollingTimer = setInterval(async () => {
      await this.collectAndOptimize();
    }, this.config.pollingInterval);

    logger.info('Resource monitoring started');
  }

  /**
   * Stop resource monitoring
   */
  stopMonitoring(): void {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }

    logger.info('Resource monitoring stopped');
  }

  /**
   * Collect metrics and optimize
   */
  private async collectAndOptimize(): Promise<void> {
    try {
      const metrics = await this.metricsCollector.collect();
      this.metricsHistory.push(metrics);

      if (this.metricsHistory.length > this.config.historySize) {
        this.metricsHistory.shift();
      }

      this.emit('metrics-collected', metrics);

      if (this.config.autoOptimize) {
        this.checkThresholds(metrics);
        this.optimizeProfile(metrics);
      }
    } catch (error) {
      logger.error('Error collecting metrics', { error });
    }
  }

  /**
   * Check threshold violations
   */
  private checkThresholds(metrics: SystemMetrics): void {
    for (const threshold of this.thresholds) {
      let value: number | undefined;

      switch (threshold.metric) {
        case 'cpu':
          value = metrics.cpu.usage;
          break;
        case 'memory':
          value = metrics.memory.usagePercent;
          break;
        case 'gpu':
          value = metrics.gpu?.usage;
          break;
        case 'battery':
          value = metrics.battery ? 100 - metrics.battery.level : undefined;
          break;
        case 'temperature':
          value = metrics.cpu.temperature;
          break;
      }

      if (value === undefined) continue;

      if (value >= threshold.criticalLevel) {
        this.handleThresholdBreach(threshold, value, 'critical');
      } else if (value >= threshold.warningLevel) {
        this.handleThresholdBreach(threshold, value, 'warning');
      }
    }
  }

  /**
   * Handle threshold breach
   */
  private handleThresholdBreach(
    threshold: ResourceThreshold,
    value: number,
    severity: 'warning' | 'critical'
  ): void {
    this.stats.thresholdBreaches++;

    this.emit('threshold-breach', {
      threshold,
      value,
      severity,
    });

    // Take action based on threshold configuration
    switch (threshold.action) {
      case 'reduce-quality':
        this.reduceQuality();
        break;
      case 'pause-background':
        this.pauseBackgroundTasks();
        break;
      case 'clear-cache':
        this.emit('clear-cache-requested');
        break;
      case 'notify-user':
        this.emit('user-notification', {
          message: `${threshold.metric} usage is ${severity}: ${value.toFixed(1)}%`,
          severity,
        });
        break;
      case 'throttle-requests':
        this.emit('throttle-requested', { severity });
        break;
    }

    logger.warn('Threshold breach', {
      metric: threshold.metric,
      value,
      severity,
      action: threshold.action,
    });
  }

  // ============================================================================
  // Optimization
  // ============================================================================

  /**
   * Optimize profile based on current metrics
   */
  private optimizeProfile(metrics: SystemMetrics): void {
    const cpuTrend = this.metricsCollector.getCpuTrend();
    const avgCpu = this.metricsCollector.getAverageCpuUsage();
    const memUsage = metrics.memory.usagePercent;

    let targetProfile: string;

    // Battery-aware optimization
    if (this.config.respectBattery && metrics.battery && !metrics.battery.charging) {
      if (metrics.battery.level < 15) {
        targetProfile = 'minimal';
      } else if (metrics.battery.level < 30) {
        targetProfile = 'efficiency';
      } else {
        targetProfile = 'balanced';
      }
    } else {
      // Performance-based optimization
      if (avgCpu > 80 || memUsage > 80) {
        targetProfile = cpuTrend === 'increasing' ? 'efficiency' : 'balanced';
      } else if (avgCpu < 40 && memUsage < 50) {
        targetProfile = 'performance';
      } else {
        targetProfile = 'balanced';
      }
    }

    if (targetProfile !== this.currentProfile.name.toLowerCase().replace(' ', '-')) {
      this.setProfile(targetProfile);
    }
  }

  /**
   * Set optimization profile
   */
  setProfile(profileName: string): void {
    const normalizedName = profileName.toLowerCase().replace(' ', '-');
    const profile = Object.values(OPTIMIZATION_PROFILES).find(
      (p) => p.name.toLowerCase().replace(' ', '-') === normalizedName
    );

    if (!profile) {
      logger.warn('Unknown profile', { profileName });
      return;
    }

    const previousProfile = this.currentProfile;
    this.currentProfile = profile;
    this.stats.profileChanges++;
    this.stats.optimizationsApplied++;

    const event: OptimizationEvent = {
      timestamp: Date.now(),
      trigger: 'profile-change',
      action: `Changed to ${profile.name}`,
      profileBefore: previousProfile.name,
      profileAfter: profile.name,
      metrics: this.metricsHistory.length > 0 ? this.metricsHistory[this.metricsHistory.length - 1] : {},
    };

    this.eventHistory.push(event);
    this.emit('profile-changed', profile, previousProfile);
    this.saveData();

    logger.info('Profile changed', {
      from: previousProfile.name,
      to: profile.name,
    });
  }

  /**
   * Reduce quality settings
   */
  private reduceQuality(): void {
    const profiles = ['performance', 'balanced', 'efficiency', 'minimal'];
    const currentIdx = profiles.indexOf(
      this.currentProfile.name.toLowerCase().replace(' ', '-')
    );

    if (currentIdx < profiles.length - 1) {
      this.setProfile(profiles[currentIdx + 1]);
    }
  }

  /**
   * Pause background tasks
   */
  private pauseBackgroundTasks(): void {
    this.emit('pause-background-tasks');
    logger.info('Background tasks paused');
  }

  // ============================================================================
  // Query Methods
  // ============================================================================

  /**
   * Get current profile
   */
  getCurrentProfile(): OptimizationProfile {
    return { ...this.currentProfile };
  }

  /**
   * Get available profiles
   */
  getAvailableProfiles(): OptimizationProfile[] {
    return Object.values(OPTIMIZATION_PROFILES);
  }

  /**
   * Get current metrics
   */
  async getCurrentMetrics(): Promise<SystemMetrics> {
    return this.metricsCollector.collect();
  }

  /**
   * Get metrics history
   */
  getMetricsHistory(): SystemMetrics[] {
    return [...this.metricsHistory];
  }

  /**
   * Get optimization events
   */
  getEventHistory(): OptimizationEvent[] {
    return [...this.eventHistory];
  }

  /**
   * Get statistics
   */
  getStats(): typeof this.stats {
    return {
      ...this.stats,
      uptime: process.uptime() * 1000,
    };
  }

  /**
   * Get thresholds
   */
  getThresholds(): ResourceThreshold[] {
    return [...this.thresholds];
  }

  /**
   * Update threshold
   */
  updateThreshold(
    metric: ResourceThreshold['metric'],
    updates: Partial<ResourceThreshold>
  ): void {
    const threshold = this.thresholds.find((t) => t.metric === metric);
    if (threshold) {
      Object.assign(threshold, updates);
      logger.info('Threshold updated', { metric, updates });
    }
  }

  /**
   * Add custom threshold
   */
  addThreshold(threshold: ResourceThreshold): void {
    this.thresholds.push(threshold);
  }

  /**
   * Get resource recommendation
   */
  getRecommendation(): {
    action: string;
    reason: string;
    targetProfile: string;
  } {
    if (this.metricsHistory.length === 0) {
      return {
        action: 'none',
        reason: 'Insufficient data',
        targetProfile: this.currentProfile.name,
      };
    }

    const recent = this.metricsHistory[this.metricsHistory.length - 1];
    const avgCpu = this.metricsCollector.getAverageCpuUsage();
    const trend = this.metricsCollector.getCpuTrend();

    if (avgCpu > 80 || recent.memory.usagePercent > 80) {
      return {
        action: 'reduce-load',
        reason: 'High resource usage detected',
        targetProfile: 'efficiency',
      };
    }

    if (avgCpu < 30 && recent.memory.usagePercent < 40 && trend === 'stable') {
      return {
        action: 'increase-performance',
        reason: 'Resources are underutilized',
        targetProfile: 'performance',
      };
    }

    return {
      action: 'maintain',
      reason: 'Current settings are optimal',
      targetProfile: this.currentProfile.name,
    };
  }

  /**
   * Force garbage collection (if exposed)
   */
  requestGC(): void {
    if (global.gc) {
      global.gc();
      logger.info('Garbage collection requested');
    }
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<ResourceOptimizerConfig>): void {
    const wasMonitoring = this.pollingTimer !== null;

    if (wasMonitoring) {
      this.stopMonitoring();
    }

    this.config = { ...this.config, ...config };

    if (wasMonitoring && this.config.autoOptimize) {
      this.startMonitoring();
    }

    logger.info('Config updated', { config: this.config });
  }

  /**
   * Cleanup
   */
  dispose(): void {
    this.stopMonitoring();
    this.saveData();
  }
}

// ============================================================================
// Singleton
// ============================================================================

let resourceOptimizer: ResourceOptimizer | null = null;

export function getResourceOptimizer(): ResourceOptimizer {
  if (!resourceOptimizer) {
    resourceOptimizer = new ResourceOptimizer();
  }
  return resourceOptimizer;
}
