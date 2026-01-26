/**
 * GEPA Evaluation Framework
 *
 * Tracks all user interactions for self-improvement analysis.
 * Records success/failure outcomes, user corrections, and satisfaction signals.
 *
 * GEPA = Generate, Evaluate, Propose, Apply
 * - Generate: LLM produces responses
 * - Evaluate: This framework tracks outcomes
 * - Propose: Optimizer suggests improvements
 * - Apply: Scheduler applies changes
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import * as fs from 'fs/promises';
import * as path from 'path';
import { getConfig } from '../config';
import { isoDate } from '../../shared/utils';

const logger = createModuleLogger('GEPA-Eval');

// ============================================================================
// Types
// ============================================================================

/**
 * Interaction outcome types
 */
export type InteractionOutcome =
  | 'success' // User accepted the response
  | 'failure' // User rejected or task failed
  | 'correction' // User corrected the response
  | 'partial' // Partially successful
  | 'abandoned' // User abandoned mid-interaction
  | 'unknown'; // No explicit feedback

/**
 * Satisfaction signal sources
 */
export type SatisfactionSignal =
  | 'explicit_positive' // User said "thanks", "good", etc.
  | 'explicit_negative' // User said "no", "wrong", etc.
  | 'retry' // User retried the same request
  | 'correction' // User provided correction
  | 'follow_up' // User asked follow-up (positive engagement)
  | 'abandonment' // User left without completion
  | 'task_completed' // Tool execution completed successfully
  | 'task_failed'; // Tool execution failed

/**
 * Recorded interaction
 */
export interface Interaction {
  id: string;
  timestamp: Date;
  sessionId: string;

  // Request context
  userInput: string;
  intent?: string;
  entities?: Record<string, string>;

  // Response
  assistantResponse: string;
  toolsUsed?: string[];
  tokensUsed?: number;
  latencyMs?: number;

  // Outcome tracking
  outcome: InteractionOutcome;
  satisfactionSignals: SatisfactionSignal[];
  userCorrection?: string;
  errorMessage?: string;

  // Metadata
  promptVersion?: string;
  modelUsed?: string;
  temperature?: number;
}

/**
 * Aggregated metrics for a time period
 */
export interface PeriodMetrics {
  periodStart: Date;
  periodEnd: Date;
  totalInteractions: number;
  successRate: number;
  failureRate: number;
  correctionRate: number;
  avgLatencyMs: number;
  avgTokensUsed: number;

  // By intent
  intentBreakdown: Record<
    string,
    {
      count: number;
      successRate: number;
    }
  >;

  // By tool
  toolBreakdown: Record<
    string,
    {
      count: number;
      successRate: number;
    }
  >;

  // Satisfaction
  satisfactionScore: number; // 0-1 based on signals
}

/**
 * Evaluation framework events
 */
export interface EvalEvents {
  'interaction:recorded': (interaction: Interaction) => void;
  'interaction:updated': (interaction: Interaction) => void;
  'metrics:computed': (metrics: PeriodMetrics) => void;
  error: (error: Error) => void;
}

// ============================================================================
// Evaluation Framework
// ============================================================================

export class EvaluationFramework extends EventEmitter {
  private interactions: Map<string, Interaction> = new Map();
  private dataDir: string;
  private currentSessionId: string;
  private initialized = false;

  // Buffers for batch writing
  private pendingWrites: Interaction[] = [];
  private writeTimer: NodeJS.Timeout | null = null;
  private readonly WRITE_INTERVAL = 30000; // 30 seconds
  private readonly MAX_BUFFER_SIZE = 100;

  constructor() {
    super();
    this.setMaxListeners(20);
    this.dataDir = '';
    this.currentSessionId = this.generateSessionId();
  }

  // --------------------------------------------------------------------------
  // Initialization
  // --------------------------------------------------------------------------

  /**
   * Initialize the evaluation framework
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      const config = getConfig();
      // Use logDir parent as data directory base (e.g., ~/.atlas)
      const atlasDir = path.dirname(config.logDir);
      this.dataDir = path.join(atlasDir, 'gepa', 'interactions');

      // Create data directory
      await fs.mkdir(this.dataDir, { recursive: true });

      // Start periodic write timer
      this.writeTimer = setInterval(() => this.flushPendingWrites(), this.WRITE_INTERVAL);

      this.initialized = true;
      logger.info('Evaluation framework initialized', { dataDir: this.dataDir });
    } catch (error) {
      logger.error('Failed to initialize evaluation framework:', error);
      throw error;
    }
  }

  /**
   * Start a new session
   */
  startSession(): string {
    this.currentSessionId = this.generateSessionId();
    logger.debug('New evaluation session started', { sessionId: this.currentSessionId });
    return this.currentSessionId;
  }

  // --------------------------------------------------------------------------
  // Interaction Recording
  // --------------------------------------------------------------------------

  /**
   * Record a new interaction
   */
  recordInteraction(data: Omit<Interaction, 'id' | 'timestamp' | 'sessionId'>): Interaction {
    const interaction: Interaction = {
      id: this.generateInteractionId(),
      timestamp: new Date(),
      sessionId: this.currentSessionId,
      ...data,
    };

    this.interactions.set(interaction.id, interaction);
    this.pendingWrites.push(interaction);

    // Flush if buffer is full
    if (this.pendingWrites.length >= this.MAX_BUFFER_SIZE) {
      this.flushPendingWrites();
    }

    this.emit('interaction:recorded', interaction);
    logger.debug('Interaction recorded', {
      id: interaction.id,
      outcome: interaction.outcome,
      intent: interaction.intent,
    });

    return interaction;
  }

  /**
   * Update an existing interaction (e.g., add outcome after response)
   */
  updateInteraction(id: string, updates: Partial<Interaction>): Interaction | null {
    const interaction = this.interactions.get(id);
    if (!interaction) {
      logger.warn('Interaction not found for update', { id });
      return null;
    }

    const updated = { ...interaction, ...updates };
    this.interactions.set(id, updated);
    this.pendingWrites.push(updated);

    this.emit('interaction:updated', updated);
    logger.debug('Interaction updated', { id, outcome: updated.outcome });

    return updated;
  }

  /**
   * Add a satisfaction signal to an interaction
   */
  addSatisfactionSignal(id: string, signal: SatisfactionSignal): void {
    const interaction = this.interactions.get(id);
    if (!interaction) {
      logger.warn('Interaction not found for signal', { id });
      return;
    }

    if (!interaction.satisfactionSignals.includes(signal)) {
      interaction.satisfactionSignals.push(signal);
      this.updateInteraction(id, { satisfactionSignals: interaction.satisfactionSignals });
    }
  }

  /**
   * Mark interaction as corrected
   */
  markCorrected(id: string, correction: string): void {
    this.updateInteraction(id, {
      outcome: 'correction',
      userCorrection: correction,
      satisfactionSignals: [
        ...(this.interactions.get(id)?.satisfactionSignals || []),
        'correction',
      ],
    });
  }

  /**
   * Mark interaction as successful
   */
  markSuccess(id: string): void {
    this.updateInteraction(id, { outcome: 'success' });
  }

  /**
   * Mark interaction as failed
   */
  markFailure(id: string, errorMessage?: string): void {
    this.updateInteraction(id, {
      outcome: 'failure',
      errorMessage,
      satisfactionSignals: [
        ...(this.interactions.get(id)?.satisfactionSignals || []),
        'task_failed',
      ],
    });
  }

  // --------------------------------------------------------------------------
  // Metrics Computation
  // --------------------------------------------------------------------------

  /**
   * Compute metrics for a time period
   */
  async computeMetrics(startDate: Date, endDate: Date): Promise<PeriodMetrics> {
    const interactions = this.getInteractionsInRange(startDate, endDate);

    if (interactions.length === 0) {
      return this.emptyMetrics(startDate, endDate);
    }

    // Calculate basic rates
    const successCount = interactions.filter((i) => i.outcome === 'success').length;
    const failureCount = interactions.filter((i) => i.outcome === 'failure').length;
    const correctionCount = interactions.filter((i) => i.outcome === 'correction').length;

    // Calculate averages
    const latencies = interactions.filter((i) => i.latencyMs).map((i) => i.latencyMs!);
    const tokens = interactions.filter((i) => i.tokensUsed).map((i) => i.tokensUsed!);

    // Intent breakdown
    const intentBreakdown: Record<string, { count: number; successRate: number }> = {};
    const intentGroups = this.groupBy(interactions, (i) => i.intent || 'unknown');
    for (const [intent, group] of Object.entries(intentGroups)) {
      const intentSuccesses = group.filter((i) => i.outcome === 'success').length;
      intentBreakdown[intent] = {
        count: group.length,
        successRate: group.length > 0 ? intentSuccesses / group.length : 0,
      };
    }

    // Tool breakdown
    const toolBreakdown: Record<string, { count: number; successRate: number }> = {};
    const toolUsage = new Map<string, Interaction[]>();
    for (const interaction of interactions) {
      for (const tool of interaction.toolsUsed || []) {
        if (!toolUsage.has(tool)) {
          toolUsage.set(tool, []);
        }
        toolUsage.get(tool)!.push(interaction);
      }
    }
    for (const [tool, group] of toolUsage) {
      const toolSuccesses = group.filter((i) => i.outcome === 'success').length;
      toolBreakdown[tool] = {
        count: group.length,
        successRate: group.length > 0 ? toolSuccesses / group.length : 0,
      };
    }

    // Satisfaction score
    const satisfactionScore = this.computeSatisfactionScore(interactions);

    const metrics: PeriodMetrics = {
      periodStart: startDate,
      periodEnd: endDate,
      totalInteractions: interactions.length,
      successRate: interactions.length > 0 ? successCount / interactions.length : 0,
      failureRate: interactions.length > 0 ? failureCount / interactions.length : 0,
      correctionRate: interactions.length > 0 ? correctionCount / interactions.length : 0,
      avgLatencyMs:
        latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0,
      avgTokensUsed: tokens.length > 0 ? tokens.reduce((a, b) => a + b, 0) / tokens.length : 0,
      intentBreakdown,
      toolBreakdown,
      satisfactionScore,
    };

    this.emit('metrics:computed', metrics);
    return metrics;
  }

  /**
   * Compute satisfaction score from signals
   */
  private computeSatisfactionScore(interactions: Interaction[]): number {
    if (interactions.length === 0) return 0;

    const weights: Record<SatisfactionSignal, number> = {
      explicit_positive: 1.0,
      task_completed: 0.8,
      follow_up: 0.6,
      explicit_negative: -1.0,
      task_failed: -0.8,
      retry: -0.4,
      correction: -0.3,
      abandonment: -0.6,
    };

    let totalScore = 0;
    let signalCount = 0;

    for (const interaction of interactions) {
      for (const signal of interaction.satisfactionSignals) {
        totalScore += weights[signal] || 0;
        signalCount++;
      }
    }

    // Normalize to 0-1 range
    if (signalCount === 0) return 0.5; // Neutral if no signals
    const rawScore = totalScore / signalCount;
    return Math.max(0, Math.min(1, (rawScore + 1) / 2)); // Map -1..1 to 0..1
  }

  /**
   * Get daily metrics for the past N days
   */
  async getDailyMetrics(days: number): Promise<PeriodMetrics[]> {
    const metrics: PeriodMetrics[] = [];
    const now = new Date();

    for (let i = 0; i < days; i++) {
      const endDate = new Date(now);
      endDate.setDate(endDate.getDate() - i);
      endDate.setHours(23, 59, 59, 999);

      const startDate = new Date(endDate);
      startDate.setHours(0, 0, 0, 0);

      metrics.push(await this.computeMetrics(startDate, endDate));
    }

    return metrics;
  }

  // --------------------------------------------------------------------------
  // Persistence
  // --------------------------------------------------------------------------

  /**
   * Flush pending writes to disk
   */
  private async flushPendingWrites(): Promise<void> {
    if (this.pendingWrites.length === 0) return;

    const toWrite = [...this.pendingWrites];
    this.pendingWrites = [];

    try {
      // Group by date for file organization
      const byDate = this.groupBy(toWrite, (i) => isoDate(i.timestamp));

      for (const [date, interactions] of Object.entries(byDate)) {
        const filePath = path.join(this.dataDir, `${date}.jsonl`);

        // Append to file (JSONL format)
        const lines = interactions.map((i) => JSON.stringify(i)).join('\n') + '\n';
        await fs.appendFile(filePath, lines, 'utf-8');
      }

      logger.debug('Flushed interactions to disk', { count: toWrite.length });
    } catch (error) {
      logger.error('Failed to flush interactions:', error);
      // Re-add to pending writes
      this.pendingWrites.push(...toWrite);
    }
  }

  /**
   * Load interactions from disk for a date range
   */
  async loadInteractions(startDate: Date, endDate: Date): Promise<Interaction[]> {
    const interactions: Interaction[] = [];
    const current = new Date(startDate);

    while (current <= endDate) {
      const dateStr = isoDate(current);
      const filePath = path.join(this.dataDir, `${dateStr}.jsonl`);

      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const lines = content.split('\n').filter((l) => l.trim());

        for (const line of lines) {
          try {
            const interaction = JSON.parse(line) as Interaction;
            interaction.timestamp = new Date(interaction.timestamp);
            interactions.push(interaction);
          } catch {
            // Skip malformed lines
          }
        }
      } catch {
        // File doesn't exist for this date
      }

      current.setDate(current.getDate() + 1);
    }

    return interactions;
  }

  // --------------------------------------------------------------------------
  // Problematic Pattern Detection
  // --------------------------------------------------------------------------

  /**
   * Find interactions with problems (high correction/failure rate)
   */
  findProblematicPatterns(interactions: Interaction[]): Array<{
    pattern: string;
    type: 'intent' | 'tool' | 'input_pattern';
    failureRate: number;
    examples: Interaction[];
  }> {
    const patterns: Array<{
      pattern: string;
      type: 'intent' | 'tool' | 'input_pattern';
      failureRate: number;
      examples: Interaction[];
    }> = [];

    // Group by intent
    const intentGroups = this.groupBy(
      interactions.filter((i) => i.intent),
      (i) => i.intent!
    );
    for (const [intent, group] of Object.entries(intentGroups)) {
      const failures = group.filter((i) => i.outcome === 'failure' || i.outcome === 'correction');
      const failureRate = failures.length / group.length;

      if (failureRate > 0.3 && group.length >= 5) {
        patterns.push({
          pattern: intent,
          type: 'intent',
          failureRate,
          examples: failures.slice(0, 5),
        });
      }
    }

    // Group by tool
    const toolGroups = new Map<string, Interaction[]>();
    for (const interaction of interactions) {
      for (const tool of interaction.toolsUsed || []) {
        if (!toolGroups.has(tool)) {
          toolGroups.set(tool, []);
        }
        toolGroups.get(tool)!.push(interaction);
      }
    }
    for (const [tool, group] of toolGroups) {
      const failures = group.filter((i) => i.outcome === 'failure');
      const failureRate = failures.length / group.length;

      if (failureRate > 0.3 && group.length >= 5) {
        patterns.push({
          pattern: tool,
          type: 'tool',
          failureRate,
          examples: failures.slice(0, 5),
        });
      }
    }

    // Find common input patterns in failures
    const failedInputs = interactions
      .filter((i) => i.outcome === 'failure' || i.outcome === 'correction')
      .map((i) => i.userInput.toLowerCase());

    const wordFreq = new Map<string, number>();
    for (const input of failedInputs) {
      const words = input.split(/\s+/).filter((w) => w.length > 3);
      for (const word of words) {
        wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
      }
    }

    // Find words that appear in >30% of failures
    const threshold = failedInputs.length * 0.3;
    for (const [word, count] of wordFreq) {
      if (count >= threshold && count >= 3) {
        const matchingInteractions = interactions.filter(
          (i) =>
            (i.outcome === 'failure' || i.outcome === 'correction') &&
            i.userInput.toLowerCase().includes(word)
        );
        patterns.push({
          pattern: word,
          type: 'input_pattern',
          failureRate: count / failedInputs.length,
          examples: matchingInteractions.slice(0, 5),
        });
      }
    }

    return patterns.sort((a, b) => b.failureRate - a.failureRate);
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  private getInteractionsInRange(startDate: Date, endDate: Date): Interaction[] {
    return Array.from(this.interactions.values()).filter(
      (i) => i.timestamp >= startDate && i.timestamp <= endDate
    );
  }

  private groupBy<T>(items: T[], keyFn: (item: T) => string): Record<string, T[]> {
    const groups: Record<string, T[]> = {};
    for (const item of items) {
      const key = keyFn(item);
      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(item);
    }
    return groups;
  }

  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  }

  private generateInteractionId(): string {
    return `int_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  }

  private emptyMetrics(startDate: Date, endDate: Date): PeriodMetrics {
    return {
      periodStart: startDate,
      periodEnd: endDate,
      totalInteractions: 0,
      successRate: 0,
      failureRate: 0,
      correctionRate: 0,
      avgLatencyMs: 0,
      avgTokensUsed: 0,
      intentBreakdown: {},
      toolBreakdown: {},
      satisfactionScore: 0.5,
    };
  }

  // --------------------------------------------------------------------------
  // Cleanup
  // --------------------------------------------------------------------------

  /**
   * Cleanup and flush all pending data
   */
  async cleanup(): Promise<void> {
    if (this.writeTimer) {
      clearInterval(this.writeTimer);
      this.writeTimer = null;
    }

    await this.flushPendingWrites();

    this.interactions.clear();
    this.initialized = false;

    logger.info('Evaluation framework cleaned up');
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

let evalFrameworkInstance: EvaluationFramework | null = null;

export function getEvaluationFramework(): EvaluationFramework {
  if (!evalFrameworkInstance) {
    evalFrameworkInstance = new EvaluationFramework();
  }
  return evalFrameworkInstance;
}

export default EvaluationFramework;
