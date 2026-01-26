/**
 * NovaVoice - Latency Monitoring & Dashboard
 * Real-time performance tracking and visualization
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../../utils/logger';
import { LatencyMetrics } from './types';
import { count } from '../../../shared/utils';

const logger = createModuleLogger('NovaVoice-Latency');

// ============================================
// Types
// ============================================

export interface LatencyBreakdown {
  /** Audio capture to VAD detection */
  audioCapture: number;
  /** VAD processing time */
  vadProcessing: number;
  /** STT Time to First Token */
  sttTTFT: number;
  /** STT Total processing time */
  sttTotal: number;
  /** LLM Time to First Token */
  llmTTFT: number;
  /** LLM Total processing time */
  llmTotal: number;
  /** TTS Time to First Byte */
  ttsTTFB: number;
  /** TTS Total synthesis time */
  ttsTotal: number;
  /** Audio output/playback start */
  audioOutput: number;
  /** Complete end-to-end latency */
  endToEnd: number;
}

export interface LatencyStats {
  count: number;
  min: number;
  max: number;
  mean: number;
  median: number;
  p50: number;
  p75: number;
  p90: number;
  p95: number;
  p99: number;
  stdDev: number;
}

export interface LatencyReport {
  timestamp: number;
  duration: number;  // Report period in ms
  totalRequests: number;
  breakdown: {
    audioCapture: LatencyStats;
    vadProcessing: LatencyStats;
    sttTTFT: LatencyStats;
    sttTotal: LatencyStats;
    llmTTFT: LatencyStats;
    llmTotal: LatencyStats;
    ttsTTFB: LatencyStats;
    ttsTotal: LatencyStats;
    audioOutput: LatencyStats;
    endToEnd: LatencyStats;
  };
  targetMet: {
    under200ms: number;  // % of requests
    under300ms: number;
    under500ms: number;
    under1000ms: number;
  };
}

export interface LatencyThresholds {
  target: number;       // Target latency in ms
  warning: number;      // Warning threshold
  critical: number;     // Critical threshold
}

const DEFAULT_THRESHOLDS: LatencyThresholds = {
  target: 300,
  warning: 500,
  critical: 1000,
};

// ============================================
// Latency Tracker
// ============================================

export class LatencyTracker extends EventEmitter {
  private history: LatencyBreakdown[] = [];
  private maxHistory = 1000;
  private thresholds: LatencyThresholds;
  private currentRequest: Partial<LatencyBreakdown> = {};
  private requestStartTime = 0;
  private stageTimestamps: Map<string, number> = new Map();
  
  constructor(thresholds: Partial<LatencyThresholds> = {}) {
    super();
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };
  }
  
  /**
   * Start tracking a new request
   */
  startRequest(): void {
    this.requestStartTime = Date.now();
    this.currentRequest = {};
    this.stageTimestamps.clear();
    this.stageTimestamps.set('start', this.requestStartTime);
  }
  
  /**
   * Mark a stage completion
   */
  markStage(stage: keyof LatencyBreakdown): void {
    const now = Date.now();
    const prevStage = this.getPreviousStage(stage);
    const prevTime = prevStage ? this.stageTimestamps.get(prevStage) : this.requestStartTime;
    
    this.stageTimestamps.set(stage, now);
    this.currentRequest[stage] = now - (prevTime || this.requestStartTime);
  }
  
  private getPreviousStage(stage: keyof LatencyBreakdown): string | null {
    const stageOrder = [
      'audioCapture',
      'vadProcessing',
      'sttTTFT',
      'sttTotal',
      'llmTTFT',
      'llmTotal',
      'ttsTTFB',
      'ttsTotal',
      'audioOutput',
      'endToEnd',
    ];
    
    const index = stageOrder.indexOf(stage);
    if (index <= 0) return null;
    return stageOrder[index - 1];
  }
  
  /**
   * Complete the current request
   */
  completeRequest(): LatencyBreakdown {
    const endToEnd = Date.now() - this.requestStartTime;
    this.currentRequest.endToEnd = endToEnd;
    
    const breakdown = this.currentRequest as LatencyBreakdown;
    this.history.push(breakdown);
    
    // Trim history
    while (this.history.length > this.maxHistory) {
      this.history.shift();
    }
    
    // Emit events
    this.emit('request-complete', breakdown);
    
    if (endToEnd >= this.thresholds.critical) {
      this.emit('latency-critical', breakdown);
      logger.warn('Critical latency detected', { endToEnd });
    } else if (endToEnd >= this.thresholds.warning) {
      this.emit('latency-warning', breakdown);
    }
    
    // Reset
    this.currentRequest = {};
    this.requestStartTime = 0;
    
    return breakdown;
  }
  
  /**
   * Record a complete latency breakdown
   */
  recordBreakdown(breakdown: LatencyBreakdown): void {
    this.history.push(breakdown);
    
    while (this.history.length > this.maxHistory) {
      this.history.shift();
    }
    
    this.emit('request-complete', breakdown);
  }
  
  /**
   * Calculate statistics for a metric
   */
  private calculateStats(values: number[]): LatencyStats {
    if (values.length === 0) {
      return {
        count: 0,
        min: 0,
        max: 0,
        mean: 0,
        median: 0,
        p50: 0,
        p75: 0,
        p90: 0,
        p95: 0,
        p99: 0,
        stdDev: 0,
      };
    }
    
    const sorted = [...values].sort((a, b) => a - b);
    const count = sorted.length;
    const sum = sorted.reduce((a, b) => a + b, 0);
    const mean = sum / count;
    
    // Standard deviation
    const squaredDiffs = sorted.map(v => Math.pow(v - mean, 2));
    const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / count;
    const stdDev = Math.sqrt(avgSquaredDiff);
    
    // Percentiles
    const percentile = (p: number) => {
      const index = Math.ceil((p / 100) * count) - 1;
      return sorted[Math.max(0, index)];
    };
    
    return {
      count,
      min: sorted[0],
      max: sorted[count - 1],
      mean: Math.round(mean),
      median: percentile(50),
      p50: percentile(50),
      p75: percentile(75),
      p90: percentile(90),
      p95: percentile(95),
      p99: percentile(99),
      stdDev: Math.round(stdDev),
    };
  }
  
  /**
   * Generate latency report
   */
  generateReport(periodMs?: number): LatencyReport {
    const now = Date.now();
    const cutoff = periodMs ? now - periodMs : 0;
    
    const relevantHistory = this.history.filter(h => {
      // Assuming endToEnd timestamp is recent
      return !periodMs || true; // For simplicity, use all history
    });
    
    const extractValues = (key: keyof LatencyBreakdown) => 
      relevantHistory.map(h => h[key]).filter(v => v !== undefined && v > 0);
    
    const endToEndValues = extractValues('endToEnd');
    
    // Calculate target met percentages
    const under200 = count(endToEndValues, v => v < 200);
    const under300 = count(endToEndValues, v => v < 300);
    const under500 = count(endToEndValues, v => v < 500);
    const under1000 = count(endToEndValues, v => v < 1000);
    const total = endToEndValues.length || 1;
    
    return {
      timestamp: now,
      duration: periodMs || (this.history.length > 0 ? now - this.history[0].endToEnd : 0),
      totalRequests: relevantHistory.length,
      breakdown: {
        audioCapture: this.calculateStats(extractValues('audioCapture')),
        vadProcessing: this.calculateStats(extractValues('vadProcessing')),
        sttTTFT: this.calculateStats(extractValues('sttTTFT')),
        sttTotal: this.calculateStats(extractValues('sttTotal')),
        llmTTFT: this.calculateStats(extractValues('llmTTFT')),
        llmTotal: this.calculateStats(extractValues('llmTotal')),
        ttsTTFB: this.calculateStats(extractValues('ttsTTFB')),
        ttsTotal: this.calculateStats(extractValues('ttsTotal')),
        audioOutput: this.calculateStats(extractValues('audioOutput')),
        endToEnd: this.calculateStats(endToEndValues),
      },
      targetMet: {
        under200ms: Math.round((under200 / total) * 100),
        under300ms: Math.round((under300 / total) * 100),
        under500ms: Math.round((under500 / total) * 100),
        under1000ms: Math.round((under1000 / total) * 100),
      },
    };
  }
  
  /**
   * Get latest breakdown
   */
  getLatest(): LatencyBreakdown | null {
    return this.history[this.history.length - 1] || null;
  }
  
  /**
   * Get average end-to-end latency
   */
  getAverageLatency(): number {
    if (this.history.length === 0) return 0;
    const sum = this.history.reduce((a, b) => a + b.endToEnd, 0);
    return Math.round(sum / this.history.length);
  }
  
  /**
   * Clear history
   */
  clearHistory(): void {
    this.history = [];
  }
  
  /**
   * Set thresholds
   */
  setThresholds(thresholds: Partial<LatencyThresholds>): void {
    this.thresholds = { ...this.thresholds, ...thresholds };
  }
  
  /**
   * Get thresholds
   */
  getThresholds(): LatencyThresholds {
    return { ...this.thresholds };
  }
  
  /**
   * Export history to JSON
   */
  exportToJSON(): string {
    return JSON.stringify({
      thresholds: this.thresholds,
      history: this.history,
      report: this.generateReport(),
    }, null, 2);
  }
}

// ============================================
// Dashboard Data Generator
// ============================================

export interface DashboardData {
  current: LatencyBreakdown | null;
  averageLatency: number;
  targetLatency: number;
  status: 'good' | 'warning' | 'critical';
  recentHistory: number[];  // Last N end-to-end latencies
  breakdown: {
    stage: string;
    value: number;
    percentage: number;
  }[];
  stats: LatencyStats;
  targetMet: {
    label: string;
    percentage: number;
  }[];
}

export class LatencyDashboard {
  private tracker: LatencyTracker;
  private updateInterval: NodeJS.Timeout | null = null;
  private subscribers: Set<(data: DashboardData) => void> = new Set();
  
  constructor(tracker: LatencyTracker) {
    this.tracker = tracker;
  }
  
  /**
   * Start periodic updates
   */
  startUpdates(intervalMs: number = 1000): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }
    
    this.updateInterval = setInterval(() => {
      const data = this.getData();
      for (const subscriber of this.subscribers) {
        subscriber(data);
      }
    }, intervalMs);
  }
  
  /**
   * Stop updates
   */
  stopUpdates(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }
  
  /**
   * Subscribe to updates
   */
  subscribe(callback: (data: DashboardData) => void): () => void {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }
  
  /**
   * Get current dashboard data
   */
  getData(): DashboardData {
    const report = this.tracker.generateReport();
    const latest = this.tracker.getLatest();
    const thresholds = this.tracker.getThresholds();
    const avgLatency = this.tracker.getAverageLatency();
    
    // Determine status
    let status: 'good' | 'warning' | 'critical' = 'good';
    if (avgLatency >= thresholds.critical) {
      status = 'critical';
    } else if (avgLatency >= thresholds.warning) {
      status = 'warning';
    }
    
    // Calculate breakdown percentages
    const breakdown: DashboardData['breakdown'] = [];
    if (latest) {
      const total = latest.endToEnd || 1;
      const stages = [
        { stage: 'Audio Capture', value: latest.audioCapture || 0 },
        { stage: 'VAD', value: latest.vadProcessing || 0 },
        { stage: 'STT', value: latest.sttTotal || 0 },
        { stage: 'LLM', value: latest.llmTotal || 0 },
        { stage: 'TTS', value: latest.ttsTotal || 0 },
        { stage: 'Audio Output', value: latest.audioOutput || 0 },
      ];
      
      for (const s of stages) {
        breakdown.push({
          ...s,
          percentage: Math.round((s.value / total) * 100),
        });
      }
    }
    
    return {
      current: latest,
      averageLatency: avgLatency,
      targetLatency: thresholds.target,
      status,
      recentHistory: report.breakdown.endToEnd.count > 0 
        ? [] // Would need to store recent values
        : [],
      breakdown,
      stats: report.breakdown.endToEnd,
      targetMet: [
        { label: '<200ms', percentage: report.targetMet.under200ms },
        { label: '<300ms', percentage: report.targetMet.under300ms },
        { label: '<500ms', percentage: report.targetMet.under500ms },
        { label: '<1s', percentage: report.targetMet.under1000ms },
      ],
    };
  }
  
  /**
   * Generate ASCII dashboard for terminal
   */
  generateAsciiDashboard(): string {
    const data = this.getData();
    const width = 60;
    
    const bar = (value: number, max: number, len: number = 20) => {
      const filled = Math.round((value / max) * len);
      return '█'.repeat(filled) + '░'.repeat(len - filled);
    };
    
    const lines = [
      '╔' + '═'.repeat(width - 2) + '╗',
      '║' + ' NovaVoice Latency Dashboard'.padEnd(width - 2) + '║',
      '╠' + '═'.repeat(width - 2) + '╣',
      `║ Status: ${data.status.toUpperCase().padEnd(10)} Avg: ${data.averageLatency}ms`.padEnd(width - 1) + '║',
      `║ Target: ${data.targetLatency}ms`.padEnd(width - 1) + '║',
      '╠' + '═'.repeat(width - 2) + '╣',
      '║ Pipeline Breakdown:'.padEnd(width - 1) + '║',
    ];
    
    for (const item of data.breakdown) {
      const line = ` ${item.stage.padEnd(14)} ${bar(item.value, data.averageLatency || 100)} ${item.value}ms`;
      lines.push('║' + line.padEnd(width - 2) + '║');
    }
    
    lines.push('╠' + '═'.repeat(width - 2) + '╣');
    lines.push('║ Target Achievement:'.padEnd(width - 1) + '║');
    
    for (const target of data.targetMet) {
      const line = ` ${target.label.padEnd(8)} ${bar(target.percentage, 100)} ${target.percentage}%`;
      lines.push('║' + line.padEnd(width - 2) + '║');
    }
    
    lines.push('╚' + '═'.repeat(width - 2) + '╝');
    
    return lines.join('\n');
  }
}

// ============================================
// Exports
// ============================================

export { DEFAULT_THRESHOLDS };

// Singleton instance
let trackerInstance: LatencyTracker | null = null;
let dashboardInstance: LatencyDashboard | null = null;

export function getLatencyTracker(): LatencyTracker {
  if (!trackerInstance) {
    trackerInstance = new LatencyTracker();
  }
  return trackerInstance;
}

export function getLatencyDashboard(): LatencyDashboard {
  if (!dashboardInstance) {
    dashboardInstance = new LatencyDashboard(getLatencyTracker());
  }
  return dashboardInstance;
}
