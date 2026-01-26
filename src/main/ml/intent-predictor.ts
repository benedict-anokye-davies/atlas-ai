/**
 * Atlas Desktop - Intent Pre-loader & Predictor
 * Predict user intent and pre-warm LLM responses for reduced latency
 *
 * Features:
 * - Learn from command history patterns
 * - Predict top-N likely next commands
 * - Pre-warm LLM with speculative prompts
 * - Time/context aware predictions
 * - Adaptive learning from corrections
 *
 * @module ml/intent-predictor
 */

import { EventEmitter } from 'events';
import * as fs from 'fs-extra';
import * as path from 'path';
import { app } from 'electron';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('IntentPredictor');

// ============================================================================
// Types
// ============================================================================

export interface CommandRecord {
  command: string;
  category: string;
  timestamp: number;
  context: {
    hour: number;
    dayOfWeek: number;
    previousCommand?: string;
    activeApp?: string;
  };
  success: boolean;
}

export interface IntentPrediction {
  command: string;
  probability: number;
  category: string;
  reasoning: string;
}

export interface PredictionContext {
  hour?: number;
  dayOfWeek?: number;
  previousCommand?: string;
  activeApp?: string;
  partialInput?: string;
}

export interface TransitionMatrix {
  [fromCommand: string]: {
    [toCommand: string]: number;
  };
}

export interface IntentPredictorEvents {
  'prediction-made': (predictions: IntentPrediction[]) => void;
  'pre-warm-started': (command: string) => void;
  'pre-warm-completed': (command: string, latency: number) => void;
  'pattern-learned': (pattern: string) => void;
  error: (error: Error) => void;
}

// ============================================================================
// Command Categories
// ============================================================================

const COMMAND_CATEGORIES: Record<string, string[]> = {
  file: ['read', 'write', 'create', 'delete', 'search', 'list', 'open', 'save'],
  git: ['commit', 'push', 'pull', 'status', 'branch', 'merge', 'diff', 'log'],
  terminal: ['run', 'execute', 'npm', 'build', 'test', 'install'],
  browser: ['open', 'navigate', 'search', 'click', 'screenshot'],
  system: ['settings', 'volume', 'brightness', 'wifi', 'bluetooth'],
  productivity: ['calendar', 'reminder', 'timer', 'note', 'todo'],
  media: ['play', 'pause', 'skip', 'volume', 'spotify'],
  communication: ['email', 'message', 'call', 'slack', 'discord'],
  code: ['debug', 'format', 'lint', 'refactor', 'explain'],
  general: ['help', 'what', 'how', 'why', 'show'],
};

// ============================================================================
// Intent Predictor
// ============================================================================

export class IntentPredictor extends EventEmitter {
  private commandHistory: CommandRecord[] = [];
  private transitionMatrix: TransitionMatrix = {};
  private categoryPatterns: Map<string, Map<string, number>> = new Map();
  private timePatterns: Map<number, Map<string, number>> = new Map();
  private preWarmCache: Map<string, { response: string; timestamp: number }> = new Map();
  private storagePath: string;

  // Configuration
  private maxHistorySize = 10000;
  private predictionCount = 5;
  private preWarmThreshold = 0.3; // Pre-warm if probability > 30%

  constructor() {
    super();
    this.storagePath = path.join(app.getPath('userData'), 'intent-predictor.json');
    this.initialize();
  }

  private async initialize(): Promise<void> {
    await this.loadState();
    logger.info('IntentPredictor initialized', {
      historySize: this.commandHistory.length,
      transitionCount: Object.keys(this.transitionMatrix).length,
    });
  }

  private async loadState(): Promise<void> {
    try {
      if (await fs.pathExists(this.storagePath)) {
        const data = await fs.readJson(this.storagePath);
        if (data.commandHistory) {
          this.commandHistory = data.commandHistory.slice(-this.maxHistorySize);
        }
        if (data.transitionMatrix) {
          this.transitionMatrix = data.transitionMatrix;
        }
        this.rebuildPatterns();
      }
    } catch (error) {
      logger.warn('Failed to load predictor state', { error });
    }
  }

  private async saveState(): Promise<void> {
    try {
      await fs.writeJson(
        this.storagePath,
        {
          commandHistory: this.commandHistory.slice(-this.maxHistorySize),
          transitionMatrix: this.transitionMatrix,
          savedAt: Date.now(),
        },
        { spaces: 2 }
      );
    } catch (error) {
      logger.error('Failed to save predictor state', { error });
    }
  }

  // ============================================================================
  // Learning
  // ============================================================================

  /**
   * Record a command execution
   */
  recordCommand(command: string, context?: Partial<PredictionContext>, success = true): void {
    const now = new Date();
    const category = this.categorizeCommand(command);
    const previousCommand = this.commandHistory.length > 0 ? this.commandHistory[this.commandHistory.length - 1].command : undefined;

    const record: CommandRecord = {
      command,
      category,
      timestamp: Date.now(),
      context: {
        hour: now.getHours(),
        dayOfWeek: now.getDay(),
        previousCommand,
        activeApp: context?.activeApp,
      },
      success,
    };

    this.commandHistory.push(record);

    // Update transition matrix
    if (previousCommand) {
      if (!this.transitionMatrix[previousCommand]) {
        this.transitionMatrix[previousCommand] = {};
      }
      this.transitionMatrix[previousCommand][command] = (this.transitionMatrix[previousCommand][command] || 0) + 1;
    }

    // Update time patterns
    const hour = now.getHours();
    if (!this.timePatterns.has(hour)) {
      this.timePatterns.set(hour, new Map());
    }
    const hourPatterns = this.timePatterns.get(hour)!;
    hourPatterns.set(command, (hourPatterns.get(command) || 0) + 1);

    // Update category patterns
    if (!this.categoryPatterns.has(category)) {
      this.categoryPatterns.set(category, new Map());
    }
    const catPatterns = this.categoryPatterns.get(category)!;
    catPatterns.set(command, (catPatterns.get(command) || 0) + 1);

    // Trim history if needed
    if (this.commandHistory.length > this.maxHistorySize) {
      this.commandHistory = this.commandHistory.slice(-this.maxHistorySize);
    }

    // Save periodically
    if (this.commandHistory.length % 50 === 0) {
      this.saveState();
    }

    this.emit('pattern-learned', `${previousCommand || 'start'} -> ${command}`);
  }

  /**
   * Categorize a command
   */
  private categorizeCommand(command: string): string {
    const commandLower = command.toLowerCase();

    for (const [category, keywords] of Object.entries(COMMAND_CATEGORIES)) {
      for (const keyword of keywords) {
        if (commandLower.includes(keyword)) {
          return category;
        }
      }
    }

    return 'general';
  }

  /**
   * Rebuild pattern caches from history
   */
  private rebuildPatterns(): void {
    this.timePatterns.clear();
    this.categoryPatterns.clear();

    for (const record of this.commandHistory) {
      // Time patterns
      const hour = record.context.hour;
      if (!this.timePatterns.has(hour)) {
        this.timePatterns.set(hour, new Map());
      }
      const hourPatterns = this.timePatterns.get(hour)!;
      hourPatterns.set(record.command, (hourPatterns.get(record.command) || 0) + 1);

      // Category patterns
      if (!this.categoryPatterns.has(record.category)) {
        this.categoryPatterns.set(record.category, new Map());
      }
      const catPatterns = this.categoryPatterns.get(record.category)!;
      catPatterns.set(record.command, (catPatterns.get(record.command) || 0) + 1);
    }
  }

  // ============================================================================
  // Prediction
  // ============================================================================

  /**
   * Predict likely next commands
   */
  predict(context?: PredictionContext): IntentPrediction[] {
    const predictions: Map<string, { score: number; reasons: string[] }> = new Map();

    const currentHour = context?.hour ?? new Date().getHours();
    const previousCommand = context?.previousCommand ?? (this.commandHistory.length > 0 ? this.commandHistory[this.commandHistory.length - 1].command : undefined);

    // Factor 1: Transition probabilities (highest weight)
    if (previousCommand && this.transitionMatrix[previousCommand]) {
      const transitions = this.transitionMatrix[previousCommand];
      const total = Object.values(transitions).reduce((a, b) => a + b, 0);

      for (const [cmd, count] of Object.entries(transitions)) {
        const prob = count / total;
        const existing = predictions.get(cmd) || { score: 0, reasons: [] };
        existing.score += prob * 0.5; // 50% weight
        existing.reasons.push(`Often follows "${previousCommand}" (${(prob * 100).toFixed(0)}%)`);
        predictions.set(cmd, existing);
      }
    }

    // Factor 2: Time-based patterns
    const hourPatterns = this.timePatterns.get(currentHour);
    if (hourPatterns) {
      const total = Array.from(hourPatterns.values()).reduce((a, b) => a + b, 0);

      for (const [cmd, count] of hourPatterns) {
        const prob = count / total;
        const existing = predictions.get(cmd) || { score: 0, reasons: [] };
        existing.score += prob * 0.3; // 30% weight
        existing.reasons.push(`Common at ${currentHour}:00 (${(prob * 100).toFixed(0)}%)`);
        predictions.set(cmd, existing);
      }
    }

    // Factor 3: Partial input matching
    if (context?.partialInput) {
      const partial = context.partialInput.toLowerCase();
      for (const record of this.commandHistory) {
        if (record.command.toLowerCase().startsWith(partial)) {
          const existing = predictions.get(record.command) || { score: 0, reasons: [] };
          existing.score += 0.4; // Boost for prefix match
          existing.reasons.push('Matches partial input');
          predictions.set(record.command, existing);
        }
      }
    }

    // Factor 4: Recent frequency (recency bias)
    const recentCommands = this.commandHistory.slice(-100);
    const recentCounts = new Map<string, number>();
    for (const record of recentCommands) {
      recentCounts.set(record.command, (recentCounts.get(record.command) || 0) + 1);
    }
    const recentTotal = recentCommands.length;

    for (const [cmd, count] of recentCounts) {
      const prob = count / recentTotal;
      const existing = predictions.get(cmd) || { score: 0, reasons: [] };
      existing.score += prob * 0.2; // 20% weight
      existing.reasons.push(`Recently used ${count} times`);
      predictions.set(cmd, existing);
    }

    // Convert to array and sort
    const results: IntentPrediction[] = Array.from(predictions.entries())
      .map(([command, data]) => ({
        command,
        probability: Math.min(data.score, 1),
        category: this.categorizeCommand(command),
        reasoning: data.reasons.join('; '),
      }))
      .sort((a, b) => b.probability - a.probability)
      .slice(0, this.predictionCount);

    this.emit('prediction-made', results);

    return results;
  }

  /**
   * Predict with pre-warming
   */
  async predictAndPreWarm(
    context?: PredictionContext,
    preWarmFn?: (command: string) => Promise<string>
  ): Promise<IntentPrediction[]> {
    const predictions = this.predict(context);

    // Pre-warm high probability predictions
    if (preWarmFn) {
      for (const prediction of predictions) {
        if (prediction.probability >= this.preWarmThreshold) {
          this.preWarm(prediction.command, preWarmFn);
        }
      }
    }

    return predictions;
  }

  /**
   * Pre-warm a command
   */
  private async preWarm(command: string, preWarmFn: (command: string) => Promise<string>): Promise<void> {
    // Check if already pre-warmed recently
    const cached = this.preWarmCache.get(command);
    if (cached && Date.now() - cached.timestamp < 60000) {
      return; // Skip if pre-warmed in last minute
    }

    this.emit('pre-warm-started', command);
    const startTime = Date.now();

    try {
      const response = await preWarmFn(command);
      const latency = Date.now() - startTime;

      this.preWarmCache.set(command, {
        response,
        timestamp: Date.now(),
      });

      this.emit('pre-warm-completed', command, latency);
      logger.debug('Pre-warmed command', { command, latency });
    } catch (error) {
      logger.warn('Pre-warm failed', { command, error });
    }
  }

  /**
   * Get pre-warmed response if available
   */
  getPreWarmedResponse(command: string): string | null {
    const cached = this.preWarmCache.get(command);
    if (cached && Date.now() - cached.timestamp < 120000) {
      // Valid for 2 minutes
      return cached.response;
    }
    return null;
  }

  // ============================================================================
  // Analysis
  // ============================================================================

  /**
   * Get most frequent commands
   */
  getMostFrequentCommands(limit = 10): Array<{ command: string; count: number }> {
    const counts = new Map<string, number>();

    for (const record of this.commandHistory) {
      counts.set(record.command, (counts.get(record.command) || 0) + 1);
    }

    return Array.from(counts.entries())
      .map(([command, count]) => ({ command, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  /**
   * Get command patterns by time of day
   */
  getTimePatterns(): Map<number, string[]> {
    const result = new Map<number, string[]>();

    for (const [hour, patterns] of this.timePatterns) {
      const sorted = Array.from(patterns.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([cmd]) => cmd);
      result.set(hour, sorted);
    }

    return result;
  }

  /**
   * Get transition probabilities from a command
   */
  getTransitionsFrom(command: string): Array<{ command: string; probability: number }> {
    const transitions = this.transitionMatrix[command];
    if (!transitions) return [];

    const total = Object.values(transitions).reduce((a, b) => a + b, 0);

    return Object.entries(transitions)
      .map(([cmd, count]) => ({
        command: cmd,
        probability: count / total,
      }))
      .sort((a, b) => b.probability - a.probability);
  }

  /**
   * Get predictor statistics
   */
  getStats(): {
    historySize: number;
    uniqueCommands: number;
    transitionPairs: number;
    preWarmCacheSize: number;
  } {
    const uniqueCommands = new Set(this.commandHistory.map((r) => r.command)).size;
    const transitionPairs = Object.values(this.transitionMatrix).reduce(
      (total, transitions) => total + Object.keys(transitions).length,
      0
    );

    return {
      historySize: this.commandHistory.length,
      uniqueCommands,
      transitionPairs,
      preWarmCacheSize: this.preWarmCache.size,
    };
  }

  /**
   * Clear all data
   */
  clear(): void {
    this.commandHistory = [];
    this.transitionMatrix = {};
    this.timePatterns.clear();
    this.categoryPatterns.clear();
    this.preWarmCache.clear();
    this.saveState();
    logger.info('IntentPredictor cleared');
  }
}

// ============================================================================
// Singleton
// ============================================================================

let intentPredictor: IntentPredictor | null = null;

export function getIntentPredictor(): IntentPredictor {
  if (!intentPredictor) {
    intentPredictor = new IntentPredictor();
  }
  return intentPredictor;
}
