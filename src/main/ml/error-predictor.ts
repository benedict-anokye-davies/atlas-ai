/**
 * Atlas Desktop - Error Predictor
 * Predict and prevent errors before they occur
 *
 * Features:
 * - Pattern-based error prediction
 * - Pre-emptive warnings
 * - Root cause analysis
 * - Auto-recovery suggestions
 * - Error correlation
 *
 * @module ml/error-predictor
 */

import { EventEmitter } from 'events';
import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('ErrorPredictor');

// ============================================================================
// Types
// ============================================================================

export interface ErrorSignature {
  id: string;
  name: string;
  patterns: string[];
  category: ErrorCategory;
  severity: 'low' | 'medium' | 'high' | 'critical';
  precursors: string[];
  frequency: number;
  lastOccurrence: number;
  recoveryActions: string[];
}

export type ErrorCategory =
  | 'network'
  | 'memory'
  | 'api'
  | 'filesystem'
  | 'audio'
  | 'llm'
  | 'user-input'
  | 'system'
  | 'unknown';

export interface ErrorEvent {
  id: string;
  timestamp: number;
  signature?: string;
  message: string;
  stack?: string;
  category: ErrorCategory;
  severity: 'low' | 'medium' | 'high' | 'critical';
  context: Record<string, unknown>;
  precursorEvents: string[];
  recovered: boolean;
  recoveryMethod?: string;
}

export interface ErrorPrediction {
  signatureId: string;
  probability: number;
  timeframe: number; // ms until predicted occurrence
  precursorsDetected: string[];
  preventionActions: string[];
  severity: ErrorSignature['severity'];
}

export interface ErrorCorrelation {
  errorA: string;
  errorB: string;
  correlation: number; // -1 to 1
  coOccurrenceCount: number;
  avgTimeDelta: number;
}

export interface RootCauseAnalysis {
  errorId: string;
  possibleCauses: {
    cause: string;
    probability: number;
    evidence: string[];
  }[];
  suggestedFixes: string[];
  similarErrors: string[];
}

export interface ErrorPredictorConfig {
  predictionWindow: number; // ms
  minOccurrencesForPattern: number;
  correlationThreshold: number;
  precursorWindow: number; // ms to look for precursors
  maxHistorySize: number;
}

// ============================================================================
// Pattern Detector
// ============================================================================

class PatternDetector {
  private errorSequences: Map<string, number[]> = new Map();
  private precursorMap: Map<string, Map<string, number>> = new Map();

  /**
   * Record error for pattern detection
   */
  recordError(signature: string, timestamp: number): void {
    const sequence = this.errorSequences.get(signature) || [];
    sequence.push(timestamp);

    // Keep only recent occurrences
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000; // 30 days
    const filtered = sequence.filter((t) => t > cutoff);
    this.errorSequences.set(signature, filtered);
  }

  /**
   * Record precursor relationship
   */
  recordPrecursor(precursor: string, error: string): void {
    if (!this.precursorMap.has(error)) {
      this.precursorMap.set(error, new Map());
    }
    const precursors = this.precursorMap.get(error)!;
    precursors.set(precursor, (precursors.get(precursor) || 0) + 1);
  }

  /**
   * Calculate error frequency
   */
  calculateFrequency(signature: string, windowDays: number): number {
    const sequence = this.errorSequences.get(signature) || [];
    const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
    const recentCount = sequence.filter((t) => t > cutoff).length;
    return recentCount / windowDays;
  }

  /**
   * Detect time-based patterns
   */
  detectTimePatterns(signature: string): {
    hourlyPattern: number[];
    weeklyPattern: number[];
    periodicity?: number;
  } {
    const sequence = this.errorSequences.get(signature) || [];
    const hourlyPattern = new Array(24).fill(0);
    const weeklyPattern = new Array(7).fill(0);

    for (const timestamp of sequence) {
      const date = new Date(timestamp);
      hourlyPattern[date.getHours()]++;
      weeklyPattern[date.getDay()]++;
    }

    // Normalize
    const total = sequence.length || 1;
    for (let i = 0; i < 24; i++) hourlyPattern[i] /= total;
    for (let i = 0; i < 7; i++) weeklyPattern[i] /= total;

    // Detect periodicity
    const periodicity = this.detectPeriodicity(sequence);

    return { hourlyPattern, weeklyPattern, periodicity };
  }

  /**
   * Detect periodicity in error sequence
   */
  private detectPeriodicity(timestamps: number[]): number | undefined {
    if (timestamps.length < 5) return undefined;

    const sorted = [...timestamps].sort((a, b) => a - b);
    const intervals: number[] = [];

    for (let i = 1; i < sorted.length; i++) {
      intervals.push(sorted[i] - sorted[i - 1]);
    }

    // Find most common interval
    const intervalCounts = new Map<number, number>();
    const bucketSize = 60000; // 1 minute buckets

    for (const interval of intervals) {
      const bucket = Math.round(interval / bucketSize) * bucketSize;
      intervalCounts.set(bucket, (intervalCounts.get(bucket) || 0) + 1);
    }

    let maxCount = 0;
    let dominantInterval: number | undefined;

    for (const [interval, count] of intervalCounts) {
      if (count > maxCount && count >= 3) {
        maxCount = count;
        dominantInterval = interval;
      }
    }

    return dominantInterval;
  }

  /**
   * Get likely precursors for an error
   */
  getLikelyPrecursors(error: string, minOccurrences: number): string[] {
    const precursors = this.precursorMap.get(error);
    if (!precursors) return [];

    return Array.from(precursors.entries())
      .filter(([, count]) => count >= minOccurrences)
      .sort((a, b) => b[1] - a[1])
      .map(([precursor]) => precursor);
  }
}

// ============================================================================
// Correlation Analyzer
// ============================================================================

class CorrelationAnalyzer {
  private coOccurrences: Map<string, Map<string, { count: number; timeDelta: number[] }>> = new Map();

  /**
   * Record co-occurrence
   */
  recordCoOccurrence(errorA: string, errorB: string, timeDelta: number): void {
    const key = [errorA, errorB].sort().join('|');

    if (!this.coOccurrences.has(key)) {
      this.coOccurrences.set(key, new Map());
    }

    const pairData = this.coOccurrences.get(key)!;
    const existing = pairData.get(key) || { count: 0, timeDelta: [] };
    existing.count++;
    existing.timeDelta.push(timeDelta);

    // Keep only last 100 occurrences
    if (existing.timeDelta.length > 100) {
      existing.timeDelta = existing.timeDelta.slice(-100);
    }

    pairData.set(key, existing);
  }

  /**
   * Get correlations for an error
   */
  getCorrelations(errorSignature: string): ErrorCorrelation[] {
    const correlations: ErrorCorrelation[] = [];

    for (const [key, data] of this.coOccurrences) {
      if (key.includes(errorSignature)) {
        const [errorA, errorB] = key.split('|');
        const pairData = data.get(key);
        if (!pairData) continue;

        // Calculate correlation score based on co-occurrence frequency
        const correlation = Math.min(pairData.count / 10, 1);
        const avgTimeDelta =
          pairData.timeDelta.reduce((a, b) => a + b, 0) / pairData.timeDelta.length;

        correlations.push({
          errorA,
          errorB,
          correlation,
          coOccurrenceCount: pairData.count,
          avgTimeDelta,
        });
      }
    }

    return correlations.sort((a, b) => b.correlation - a.correlation);
  }
}

// ============================================================================
// Error Predictor
// ============================================================================

export class ErrorPredictor extends EventEmitter {
  private config: ErrorPredictorConfig;
  private signatures: Map<string, ErrorSignature> = new Map();
  private errorHistory: ErrorEvent[] = [];
  private patternDetector: PatternDetector;
  private correlationAnalyzer: CorrelationAnalyzer;
  private recentPrecursors: Map<string, number> = new Map();
  private dataPath: string;

  // Stats
  private stats = {
    errorsRecorded: 0,
    predictionsGenerated: 0,
    accuratePredictions: 0,
    preventedErrors: 0,
    avgPredictionAccuracy: 0,
  };

  constructor(config?: Partial<ErrorPredictorConfig>) {
    super();
    this.config = {
      predictionWindow: 5 * 60 * 1000, // 5 minutes
      minOccurrencesForPattern: 3,
      correlationThreshold: 0.5,
      precursorWindow: 60 * 1000, // 1 minute
      maxHistorySize: 1000,
      ...config,
    };

    this.patternDetector = new PatternDetector();
    this.correlationAnalyzer = new CorrelationAnalyzer();
    this.dataPath = path.join(app.getPath('userData'), 'error-predictor.json');

    this.initializeCommonSignatures();
    this.loadData();

    logger.info('ErrorPredictor initialized', { config: this.config });
  }

  // ============================================================================
  // Initialization
  // ============================================================================

  private initializeCommonSignatures(): void {
    const commonSignatures: ErrorSignature[] = [
      {
        id: 'network-timeout',
        name: 'Network Timeout',
        patterns: ['ETIMEDOUT', 'ECONNREFUSED', 'timeout', 'network error'],
        category: 'network',
        severity: 'medium',
        precursors: ['high-latency', 'dns-failure'],
        frequency: 0,
        lastOccurrence: 0,
        recoveryActions: ['retry', 'switch-provider', 'enable-offline-mode'],
      },
      {
        id: 'memory-pressure',
        name: 'Memory Pressure',
        patterns: ['heap out of memory', 'allocation failed', 'OOM', 'memory'],
        category: 'memory',
        severity: 'high',
        precursors: ['high-memory-usage', 'memory-leak-detected'],
        frequency: 0,
        lastOccurrence: 0,
        recoveryActions: ['clear-cache', 'gc', 'reduce-quality', 'restart'],
      },
      {
        id: 'api-rate-limit',
        name: 'API Rate Limit',
        patterns: ['rate limit', '429', 'too many requests', 'quota exceeded'],
        category: 'api',
        severity: 'medium',
        precursors: ['high-api-volume', 'burst-requests'],
        frequency: 0,
        lastOccurrence: 0,
        recoveryActions: ['backoff', 'queue-requests', 'use-cache'],
      },
      {
        id: 'audio-device-error',
        name: 'Audio Device Error',
        patterns: ['audio device', 'microphone', 'speaker', 'no audio'],
        category: 'audio',
        severity: 'medium',
        precursors: ['device-disconnected', 'driver-error'],
        frequency: 0,
        lastOccurrence: 0,
        recoveryActions: ['reinitialize-audio', 'switch-device', 'notify-user'],
      },
      {
        id: 'llm-context-overflow',
        name: 'LLM Context Overflow',
        patterns: ['context length', 'token limit', 'max_tokens', 'context window'],
        category: 'llm',
        severity: 'low',
        precursors: ['long-conversation', 'large-context'],
        frequency: 0,
        lastOccurrence: 0,
        recoveryActions: ['truncate-context', 'summarize', 'start-new-conversation'],
      },
      {
        id: 'filesystem-permission',
        name: 'Filesystem Permission Error',
        patterns: ['EACCES', 'permission denied', 'EPERM', 'access denied'],
        category: 'filesystem',
        severity: 'medium',
        precursors: [],
        frequency: 0,
        lastOccurrence: 0,
        recoveryActions: ['use-alternate-path', 'request-permission', 'notify-user'],
      },
    ];

    for (const signature of commonSignatures) {
      this.signatures.set(signature.id, signature);
    }
  }

  // ============================================================================
  // Data Persistence
  // ============================================================================

  private loadData(): void {
    try {
      if (fs.existsSync(this.dataPath)) {
        const data = JSON.parse(fs.readFileSync(this.dataPath, 'utf-8'));

        for (const signature of data.signatures || []) {
          if (!this.signatures.has(signature.id)) {
            this.signatures.set(signature.id, signature);
          } else {
            // Merge learned data
            const existing = this.signatures.get(signature.id)!;
            existing.frequency = signature.frequency;
            existing.lastOccurrence = signature.lastOccurrence;
          }
        }

        this.errorHistory = data.errorHistory || [];
        if (data.stats) {
          this.stats = data.stats;
        }

        logger.info('Loaded error predictor data', {
          signatures: this.signatures.size,
          history: this.errorHistory.length,
        });
      }
    } catch (error) {
      logger.warn('Failed to load error predictor data', { error });
    }
  }

  private saveData(): void {
    try {
      const data = {
        signatures: Array.from(this.signatures.values()),
        errorHistory: this.errorHistory.slice(-this.config.maxHistorySize),
        stats: this.stats,
        savedAt: Date.now(),
      };
      fs.writeFileSync(this.dataPath, JSON.stringify(data, null, 2));
    } catch (error) {
      logger.warn('Failed to save error predictor data', { error });
    }
  }

  // ============================================================================
  // Error Recording
  // ============================================================================

  /**
   * Record an error event
   */
  recordError(
    error: Error | string,
    context: Record<string, unknown> = {}
  ): ErrorEvent {
    const message = typeof error === 'string' ? error : error.message;
    const stack = typeof error === 'object' ? error.stack : undefined;

    // Match to signature
    const signature = this.matchSignature(message);

    // Find precursor events
    const precursorEvents = this.findPrecursors();

    const event: ErrorEvent = {
      id: this.generateId('error'),
      timestamp: Date.now(),
      signature: signature?.id,
      message,
      stack,
      category: signature?.category || this.categorizeError(message),
      severity: signature?.severity || 'medium',
      context,
      precursorEvents,
      recovered: false,
    };

    this.errorHistory.push(event);
    if (this.errorHistory.length > this.config.maxHistorySize) {
      this.errorHistory.shift();
    }

    // Update signature
    if (signature) {
      signature.frequency = this.patternDetector.calculateFrequency(signature.id, 7);
      signature.lastOccurrence = event.timestamp;
      this.patternDetector.recordError(signature.id, event.timestamp);

      // Record precursor relationships
      for (const precursor of precursorEvents) {
        this.patternDetector.recordPrecursor(precursor, signature.id);
      }
    }

    // Update correlations with recent errors
    const recentErrors = this.errorHistory.slice(-10);
    for (const recent of recentErrors) {
      if (recent.id !== event.id && recent.signature && event.signature) {
        const timeDelta = event.timestamp - recent.timestamp;
        if (timeDelta < this.config.precursorWindow * 2) {
          this.correlationAnalyzer.recordCoOccurrence(recent.signature, event.signature, timeDelta);
        }
      }
    }

    this.stats.errorsRecorded++;
    this.emit('error-recorded', event);
    this.saveData();

    return event;
  }

  /**
   * Record precursor event
   */
  recordPrecursor(name: string): void {
    this.recentPrecursors.set(name, Date.now());

    // Clean old precursors
    const cutoff = Date.now() - this.config.precursorWindow;
    for (const [key, timestamp] of this.recentPrecursors) {
      if (timestamp < cutoff) {
        this.recentPrecursors.delete(key);
      }
    }
  }

  /**
   * Mark error as recovered
   */
  markRecovered(errorId: string, method?: string): void {
    const event = this.errorHistory.find((e) => e.id === errorId);
    if (event) {
      event.recovered = true;
      event.recoveryMethod = method;
      this.saveData();
    }
  }

  // ============================================================================
  // Prediction
  // ============================================================================

  /**
   * Get current predictions
   */
  getPredictions(): ErrorPrediction[] {
    const predictions: ErrorPrediction[] = [];

    for (const signature of this.signatures.values()) {
      const prediction = this.predictError(signature);
      if (prediction && prediction.probability > 0.3) {
        predictions.push(prediction);
      }
    }

    this.stats.predictionsGenerated += predictions.length;
    return predictions.sort((a, b) => b.probability - a.probability);
  }

  /**
   * Predict specific error
   */
  private predictError(signature: ErrorSignature): ErrorPrediction | null {
    // Check for precursors
    const detectedPrecursors = signature.precursors.filter((p) =>
      this.recentPrecursors.has(p)
    );

    // Get time patterns
    const patterns = this.patternDetector.detectTimePatterns(signature.id);

    // Calculate probability
    let probability = 0;

    // Precursor factor
    if (detectedPrecursors.length > 0) {
      probability += (detectedPrecursors.length / signature.precursors.length) * 0.4;
    }

    // Frequency factor
    if (signature.frequency > 1) {
      probability += Math.min(signature.frequency / 10, 0.3);
    }

    // Time pattern factor
    const now = new Date();
    const hourlyScore = patterns.hourlyPattern[now.getHours()];
    const weeklyScore = patterns.weeklyPattern[now.getDay()];
    probability += (hourlyScore + weeklyScore) * 0.15;

    // Recency factor
    const hoursSinceLast = (Date.now() - signature.lastOccurrence) / (60 * 60 * 1000);
    if (hoursSinceLast < 24) {
      probability += 0.1;
    }

    if (probability < 0.1) return null;

    // Calculate timeframe
    let timeframe = this.config.predictionWindow;
    if (patterns.periodicity) {
      const timeSinceLast = Date.now() - signature.lastOccurrence;
      timeframe = Math.max(0, patterns.periodicity - timeSinceLast);
    }

    return {
      signatureId: signature.id,
      probability: Math.min(probability, 0.95),
      timeframe,
      precursorsDetected: detectedPrecursors,
      preventionActions: this.getPreventionActions(signature),
      severity: signature.severity,
    };
  }

  /**
   * Get prevention actions
   */
  private getPreventionActions(signature: ErrorSignature): string[] {
    const actions: string[] = [];

    // Add signature-specific recovery actions as prevention
    for (const action of signature.recoveryActions) {
      actions.push(`Pre-emptive: ${action}`);
    }

    // Add category-specific actions
    switch (signature.category) {
      case 'network':
        actions.push('Check connectivity', 'Enable offline fallback');
        break;
      case 'memory':
        actions.push('Clear caches', 'Reduce resource usage');
        break;
      case 'api':
        actions.push('Implement rate limiting', 'Use cached responses');
        break;
    }

    return actions;
  }

  // ============================================================================
  // Root Cause Analysis
  // ============================================================================

  /**
   * Analyze root cause of an error
   */
  analyzeRootCause(errorId: string): RootCauseAnalysis | null {
    const error = this.errorHistory.find((e) => e.id === errorId);
    if (!error) return null;

    const possibleCauses: RootCauseAnalysis['possibleCauses'] = [];

    // Check precursors
    for (const precursor of error.precursorEvents) {
      possibleCauses.push({
        cause: `Preceded by: ${precursor}`,
        probability: 0.7,
        evidence: [`Precursor "${precursor}" detected ${this.config.precursorWindow / 1000}s before error`],
      });
    }

    // Check correlations
    if (error.signature) {
      const correlations = this.correlationAnalyzer.getCorrelations(error.signature);
      for (const corr of correlations.slice(0, 3)) {
        const otherError = corr.errorA === error.signature ? corr.errorB : corr.errorA;
        possibleCauses.push({
          cause: `Correlated with: ${otherError}`,
          probability: corr.correlation,
          evidence: [
            `Co-occurred ${corr.coOccurrenceCount} times`,
            `Average time delta: ${Math.round(corr.avgTimeDelta / 1000)}s`,
          ],
        });
      }
    }

    // Check context
    if (error.context) {
      for (const [key, value] of Object.entries(error.context)) {
        if (typeof value === 'string' && value.toLowerCase().includes('error')) {
          possibleCauses.push({
            cause: `Context: ${key}`,
            probability: 0.5,
            evidence: [`Context indicates: ${value}`],
          });
        }
      }
    }

    // Find similar errors
    const similarErrors = this.errorHistory
      .filter(
        (e) =>
          e.id !== errorId &&
          (e.signature === error.signature ||
            e.category === error.category ||
            this.similarMessage(e.message, error.message))
      )
      .slice(-5)
      .map((e) => e.id);

    // Get suggested fixes
    const signature = error.signature ? this.signatures.get(error.signature) : null;
    const suggestedFixes = signature?.recoveryActions || this.getGenericFixes(error.category);

    return {
      errorId,
      possibleCauses: possibleCauses.sort((a, b) => b.probability - a.probability),
      suggestedFixes,
      similarErrors,
    };
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  private matchSignature(message: string): ErrorSignature | null {
    const lowerMessage = message.toLowerCase();

    for (const signature of this.signatures.values()) {
      for (const pattern of signature.patterns) {
        if (lowerMessage.includes(pattern.toLowerCase())) {
          return signature;
        }
      }
    }

    return null;
  }

  private categorizeError(message: string): ErrorCategory {
    const lower = message.toLowerCase();

    if (lower.includes('network') || lower.includes('connection') || lower.includes('timeout')) {
      return 'network';
    }
    if (lower.includes('memory') || lower.includes('heap') || lower.includes('oom')) {
      return 'memory';
    }
    if (lower.includes('api') || lower.includes('request') || lower.includes('response')) {
      return 'api';
    }
    if (lower.includes('file') || lower.includes('directory') || lower.includes('path')) {
      return 'filesystem';
    }
    if (lower.includes('audio') || lower.includes('microphone') || lower.includes('speaker')) {
      return 'audio';
    }
    if (lower.includes('llm') || lower.includes('model') || lower.includes('token')) {
      return 'llm';
    }

    return 'unknown';
  }

  private findPrecursors(): string[] {
    const cutoff = Date.now() - this.config.precursorWindow;
    return Array.from(this.recentPrecursors.entries())
      .filter(([, timestamp]) => timestamp > cutoff)
      .map(([name]) => name);
  }

  private similarMessage(a: string, b: string): boolean {
    const wordsA = new Set(a.toLowerCase().split(/\s+/));
    const wordsB = new Set(b.toLowerCase().split(/\s+/));

    let overlap = 0;
    for (const word of wordsA) {
      if (wordsB.has(word)) overlap++;
    }

    const union = new Set([...wordsA, ...wordsB]).size;
    return overlap / union > 0.5;
  }

  private getGenericFixes(category: ErrorCategory): string[] {
    const fixes: Record<ErrorCategory, string[]> = {
      network: ['Check internet connection', 'Retry request', 'Switch to offline mode'],
      memory: ['Clear cache', 'Restart application', 'Reduce quality settings'],
      api: ['Retry with backoff', 'Check API status', 'Use cached data'],
      filesystem: ['Check file permissions', 'Use alternative path', 'Create directory'],
      audio: ['Reinitialize audio', 'Check device connections', 'Select different device'],
      llm: ['Truncate context', 'Start new conversation', 'Switch model'],
      'user-input': ['Validate input', 'Show error message', 'Provide guidance'],
      system: ['Restart application', 'Check system resources', 'Update software'],
      unknown: ['Review logs', 'Retry operation', 'Contact support'],
    };

    return fixes[category];
  }

  private generateId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // ============================================================================
  // Query Methods
  // ============================================================================

  /**
   * Get signature by ID
   */
  getSignature(id: string): ErrorSignature | undefined {
    return this.signatures.get(id);
  }

  /**
   * Get all signatures
   */
  getAllSignatures(): ErrorSignature[] {
    return Array.from(this.signatures.values());
  }

  /**
   * Get error history
   */
  getErrorHistory(limit?: number): ErrorEvent[] {
    const history = [...this.errorHistory].reverse();
    return limit ? history.slice(0, limit) : history;
  }

  /**
   * Get errors by category
   */
  getErrorsByCategory(category: ErrorCategory): ErrorEvent[] {
    return this.errorHistory.filter((e) => e.category === category);
  }

  /**
   * Add custom signature
   */
  addSignature(signature: ErrorSignature): void {
    this.signatures.set(signature.id, signature);
    this.saveData();
  }

  /**
   * Get statistics
   */
  getStats(): typeof this.stats & { signatureCount: number; predictionAccuracy: number } {
    const accuracy =
      this.stats.predictionsGenerated > 0
        ? this.stats.accuratePredictions / this.stats.predictionsGenerated
        : 0;

    return {
      ...this.stats,
      signatureCount: this.signatures.size,
      predictionAccuracy: accuracy,
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<ErrorPredictorConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('Config updated', { config: this.config });
  }
}

// ============================================================================
// Singleton
// ============================================================================

let errorPredictor: ErrorPredictor | null = null;

export function getErrorPredictor(): ErrorPredictor {
  if (!errorPredictor) {
    errorPredictor = new ErrorPredictor();
  }
  return errorPredictor;
}
