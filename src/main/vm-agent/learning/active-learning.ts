/**
 * Atlas Desktop - VM Agent Active Learning
 *
 * Improves the agent through interaction and feedback.
 * Identifies uncertainty and requests human guidance when needed.
 *
 * @module vm-agent/learning/active-learning
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { createModuleLogger } from '../../utils/logger';
import { getEventBus, createEvent } from '../core/event-bus';
import { VMAction, ScreenState } from '../types';
import { EnhancedUIElement, TaskPlan, PlannedStep } from '../core/types';
import { ScreenUnderstanding } from '../vision/enhanced-screen';

const logger = createModuleLogger('ActiveLearning');

// =============================================================================
// Active Learning Constants
// =============================================================================

export const ACTIVE_LEARNING_CONSTANTS = {
  /** Uncertainty threshold to request help */
  UNCERTAINTY_THRESHOLD: 0.4,
  /** Minimum feedback samples before adjusting */
  MIN_FEEDBACK_SAMPLES: 5,
  /** Maximum query queue size */
  MAX_QUERY_QUEUE: 20,
  /** Feedback decay factor (older feedback counts less) */
  FEEDBACK_DECAY: 0.95,
  /** Storage file name */
  STORAGE_FILE: 'vm-active-learning.json',
} as const;

// =============================================================================
// Active Learning Types
// =============================================================================

export type QueryType =
  | 'element_selection'
  | 'action_choice'
  | 'parameter_value'
  | 'task_interpretation'
  | 'error_resolution'
  | 'confirmation';

export interface ActiveQuery {
  /** Query ID */
  id: string;
  /** Query type */
  type: QueryType;
  /** Question to ask */
  question: string;
  /** Available options */
  options: QueryOption[];
  /** Current context */
  context: QueryContext;
  /** Confidence in current best choice */
  confidence: number;
  /** Created timestamp */
  createdAt: number;
  /** Expires at */
  expiresAt: number;
  /** Priority */
  priority: 'low' | 'normal' | 'high' | 'critical';
  /** Whether this blocks execution */
  blocking: boolean;
}

export interface QueryOption {
  /** Option ID */
  id: string;
  /** Option label */
  label: string;
  /** Option description */
  description?: string;
  /** Associated action */
  action?: VMAction;
  /** Associated element */
  element?: EnhancedUIElement;
  /** Confidence in this option */
  confidence: number;
  /** Visual preview (base64) */
  preview?: string;
}

export interface QueryContext {
  /** Current task */
  task?: string;
  /** Step number */
  stepNumber?: number;
  /** Current screen state */
  screenState?: ScreenState;
  /** Recent actions */
  recentActions: VMAction[];
  /** Error message if any */
  errorMessage?: string;
}

export interface QueryResponse {
  /** Query ID */
  queryId: string;
  /** Selected option ID */
  selectedOptionId: string;
  /** Additional feedback */
  feedback?: string;
  /** Response timestamp */
  timestamp: number;
  /** Was this the expected answer */
  wasExpected?: boolean;
}

export interface FeedbackRecord {
  /** Record ID */
  id: string;
  /** Query type */
  queryType: QueryType;
  /** Situation description */
  situation: string;
  /** Selected action/option */
  selectedAction: string;
  /** Was outcome successful */
  successful: boolean;
  /** Timestamp */
  timestamp: number;
  /** Decay-weighted value */
  weight: number;
}

export interface LearningAdjustment {
  /** Adjustment type */
  type: 'confidence_boost' | 'confidence_penalty' | 'preference_update' | 'avoidance';
  /** Target (element type, action type, etc.) */
  target: string;
  /** Adjustment magnitude */
  magnitude: number;
  /** Context pattern */
  contextPattern?: string;
}

// =============================================================================
// Active Learning Manager
// =============================================================================

/**
 * Manages active learning through human feedback
 *
 * @example
 * ```typescript
 * const learner = getActiveLearner();
 *
 * // When uncertain, create a query
 * if (confidence < 0.5) {
 *   const query = learner.createQuery('element_selection', 'Which button to click?', [
 *     { id: '1', label: 'Submit', confidence: 0.4 },
 *     { id: '2', label: 'Cancel', confidence: 0.3 }
 *   ], context);
 *
 *   // Wait for response
 *   const response = await learner.waitForResponse(query.id);
 *
 *   // Learn from response
 *   learner.recordFeedback(query, response, true);
 * }
 * ```
 */
export class ActiveLearner extends EventEmitter {
  private pendingQueries: Map<string, ActiveQuery> = new Map();
  private feedbackHistory: FeedbackRecord[] = [];
  private adjustments: Map<string, LearningAdjustment[]> = new Map();
  private responseResolvers: Map<string, (response: QueryResponse) => void> = new Map();
  private dataDir: string;
  private initialized: boolean = false;

  constructor() {
    super();
    this.dataDir = path.join(app.getPath('userData'), 'vm-agent');
  }

  /**
   * Initialize the active learner
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      if (!fs.existsSync(this.dataDir)) {
        fs.mkdirSync(this.dataDir, { recursive: true });
      }

      await this.loadFromDisk();
      this.initialized = true;
      logger.info('Active learner initialized', {
        feedbackRecords: this.feedbackHistory.length,
        adjustments: this.adjustments.size,
      });
    } catch (error) {
      logger.error('Failed to initialize active learner', { error });
      this.initialized = true;
    }
  }

  /**
   * Check if agent should ask for help
   */
  shouldAskForHelp(confidence: number, context: QueryContext): boolean {
    // Base uncertainty check
    if (confidence < ACTIVE_LEARNING_CONSTANTS.UNCERTAINTY_THRESHOLD) {
      return true;
    }

    // Check if this situation has caused problems before
    const similarIssues = this.findSimilarIssues(context);
    if (similarIssues.some((issue) => !issue.successful)) {
      return true;
    }

    return false;
  }

  /**
   * Create an active query
   */
  createQuery(
    type: QueryType,
    question: string,
    options: QueryOption[],
    context: QueryContext,
    opts?: {
      priority?: ActiveQuery['priority'];
      blocking?: boolean;
      expiresIn?: number;
    },
  ): ActiveQuery {
    const query: ActiveQuery = {
      id: `query-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type,
      question,
      options,
      context,
      confidence: options.length > 0 ? Math.max(...options.map((o) => o.confidence)) : 0,
      createdAt: Date.now(),
      expiresAt: Date.now() + (opts?.expiresIn || 60000),
      priority: opts?.priority || 'normal',
      blocking: opts?.blocking ?? true,
    };

    this.pendingQueries.set(query.id, query);

    // Clean up old queries
    this.cleanupExpiredQueries();

    // Emit event
    const eventBus = getEventBus();
    eventBus.emitSync(
      createEvent(
        'learning:query-created',
        { queryId: query.id, type, question },
        'active-learning',
        { priority: query.priority === 'critical' ? 'high' : 'normal' },
      ),
    );

    this.emit('query-created', query);

    logger.info('Active query created', { queryId: query.id, type, options: options.length });

    return query;
  }

  /**
   * Wait for a query response
   */
  async waitForResponse(queryId: string, timeout?: number): Promise<QueryResponse | null> {
    const query = this.pendingQueries.get(queryId);
    if (!query) return null;

    const effectiveTimeout = timeout || query.expiresAt - Date.now();

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.responseResolvers.delete(queryId);
        resolve(null);
      }, effectiveTimeout);

      this.responseResolvers.set(queryId, (response) => {
        clearTimeout(timer);
        this.responseResolvers.delete(queryId);
        resolve(response);
      });
    });
  }

  /**
   * Provide a response to a query
   */
  provideResponse(queryId: string, optionId: string, feedback?: string): void {
    const query = this.pendingQueries.get(queryId);
    if (!query) {
      logger.warn('Query not found for response', { queryId });
      return;
    }

    const selectedOption = query.options.find((o) => o.id === optionId);
    const wasExpected = selectedOption
      ? query.options.indexOf(selectedOption) === 0
      : false;

    const response: QueryResponse = {
      queryId,
      selectedOptionId: optionId,
      feedback,
      timestamp: Date.now(),
      wasExpected,
    };

    // Resolve any waiting promises
    const resolver = this.responseResolvers.get(queryId);
    if (resolver) {
      resolver(response);
    }

    this.pendingQueries.delete(queryId);

    // Emit event
    const eventBus = getEventBus();
    eventBus.emitSync(
      createEvent(
        'learning:query-responded',
        { queryId, optionId, wasExpected },
        'active-learning',
        { priority: 'normal' },
      ),
    );

    this.emit('query-responded', { query, response });

    logger.info('Query response received', { queryId, optionId, wasExpected });
  }

  /**
   * Record feedback from execution result
   */
  recordFeedback(query: ActiveQuery, response: QueryResponse, successful: boolean): void {
    const selectedOption = query.options.find((o) => o.id === response.selectedOptionId);

    const record: FeedbackRecord = {
      id: `feedback-${Date.now()}`,
      queryType: query.type,
      situation: this.describeSituation(query.context),
      selectedAction: selectedOption?.label || response.selectedOptionId,
      successful,
      timestamp: Date.now(),
      weight: 1.0,
    };

    this.feedbackHistory.push(record);

    // Apply decay to older records
    this.applyFeedbackDecay();

    // Generate adjustments from feedback
    this.generateAdjustments(record, query, response);

    this.scheduleSave();

    logger.info('Feedback recorded', {
      queryType: query.type,
      successful,
      totalFeedback: this.feedbackHistory.length,
    });
  }

  /**
   * Get confidence adjustment for a situation
   */
  getConfidenceAdjustment(target: string, context?: QueryContext): number {
    const adjustments = this.adjustments.get(target) || [];
    let totalAdjustment = 0;

    for (const adj of adjustments) {
      if (adj.contextPattern && context) {
        const situation = this.describeSituation(context);
        if (!situation.includes(adj.contextPattern)) {
          continue;
        }
      }

      switch (adj.type) {
        case 'confidence_boost':
          totalAdjustment += adj.magnitude;
          break;
        case 'confidence_penalty':
        case 'avoidance':
          totalAdjustment -= adj.magnitude;
          break;
      }
    }

    return Math.max(-0.5, Math.min(0.5, totalAdjustment));
  }

  /**
   * Get pending queries
   */
  getPendingQueries(): ActiveQuery[] {
    this.cleanupExpiredQueries();
    return Array.from(this.pendingQueries.values());
  }

  /**
   * Get query by ID
   */
  getQuery(queryId: string): ActiveQuery | undefined {
    return this.pendingQueries.get(queryId);
  }

  /**
   * Cancel a query
   */
  cancelQuery(queryId: string): void {
    this.pendingQueries.delete(queryId);

    const resolver = this.responseResolvers.get(queryId);
    if (resolver) {
      resolver({
        queryId,
        selectedOptionId: '',
        timestamp: Date.now(),
      });
      this.responseResolvers.delete(queryId);
    }
  }

  /**
   * Create element selection query
   */
  createElementSelectionQuery(
    elements: EnhancedUIElement[],
    taskDescription: string,
    context: QueryContext,
  ): ActiveQuery {
    const options: QueryOption[] = elements.map((el, idx) => ({
      id: `el-${idx}`,
      label: el.text || el.type,
      description: this.describeElement(el),
      element: el,
      confidence: el.confidence,
    }));

    return this.createQuery(
      'element_selection',
      `Which element to interact with for: ${taskDescription}?`,
      options,
      context,
    );
  }

  /**
   * Create action choice query
   */
  createActionChoiceQuery(
    actions: Array<{ action: VMAction; confidence: number; description: string }>,
    context: QueryContext,
  ): ActiveQuery {
    const options: QueryOption[] = actions.map((a, idx) => ({
      id: `action-${idx}`,
      label: this.describeAction(a.action),
      description: a.description,
      action: a.action,
      confidence: a.confidence,
    }));

    return this.createQuery(
      'action_choice',
      'Which action should be taken?',
      options,
      context,
    );
  }

  /**
   * Create confirmation query
   */
  createConfirmationQuery(
    action: VMAction,
    description: string,
    context: QueryContext,
  ): ActiveQuery {
    return this.createQuery(
      'confirmation',
      description,
      [
        { id: 'yes', label: 'Yes, proceed', confidence: 0.5, action },
        { id: 'no', label: 'No, cancel', confidence: 0.5 },
      ],
      context,
      { priority: 'high' },
    );
  }

  /**
   * Create error resolution query
   */
  createErrorResolutionQuery(
    errorMessage: string,
    possibleResolutions: Array<{ id: string; label: string; action?: VMAction }>,
    context: QueryContext,
  ): ActiveQuery {
    return this.createQuery(
      'error_resolution',
      `Error occurred: ${errorMessage}. How should we proceed?`,
      possibleResolutions.map((r) => ({
        ...r,
        confidence: 0.3,
      })),
      { ...context, errorMessage },
      { priority: 'high', blocking: true },
    );
  }

  /**
   * Get learning statistics
   */
  getStats(): {
    totalFeedback: number;
    successRate: number;
    queryTypeBreakdown: Record<QueryType, { count: number; successRate: number }>;
    recentAdjustments: LearningAdjustment[];
  } {
    const totalFeedback = this.feedbackHistory.length;
    const successCount = this.feedbackHistory.filter((f) => f.successful).length;
    const successRate = totalFeedback > 0 ? successCount / totalFeedback : 0;

    const queryTypes: QueryType[] = [
      'element_selection',
      'action_choice',
      'parameter_value',
      'task_interpretation',
      'error_resolution',
      'confirmation',
    ];

    const queryTypeBreakdown: Record<QueryType, { count: number; successRate: number }> =
      {} as Record<QueryType, { count: number; successRate: number }>;

    for (const qt of queryTypes) {
      const records = this.feedbackHistory.filter((f) => f.queryType === qt);
      const successes = records.filter((f) => f.successful).length;
      queryTypeBreakdown[qt] = {
        count: records.length,
        successRate: records.length > 0 ? successes / records.length : 0,
      };
    }

    const recentAdjustments: LearningAdjustment[] = [];
    for (const adjs of this.adjustments.values()) {
      recentAdjustments.push(...adjs.slice(-3));
    }

    return {
      totalFeedback,
      successRate,
      queryTypeBreakdown,
      recentAdjustments: recentAdjustments.slice(-10),
    };
  }

  /**
   * Clear all learning data
   */
  clear(): void {
    this.pendingQueries.clear();
    this.feedbackHistory = [];
    this.adjustments.clear();
    this.scheduleSave();
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  private findSimilarIssues(context: QueryContext): FeedbackRecord[] {
    const situation = this.describeSituation(context);
    return this.feedbackHistory.filter(
      (f) =>
        this.calculateSituationSimilarity(f.situation, situation) > 0.6 ||
        (context.task && f.situation.includes(context.task)),
    );
  }

  private describeSituation(context: QueryContext): string {
    const parts: string[] = [];

    if (context.task) {
      parts.push(`task:${context.task}`);
    }
    if (context.stepNumber !== undefined) {
      parts.push(`step:${context.stepNumber}`);
    }
    if (context.errorMessage) {
      parts.push(`error:${context.errorMessage.slice(0, 50)}`);
    }
    if (context.recentActions.length > 0) {
      parts.push(`lastAction:${context.recentActions[context.recentActions.length - 1]?.type}`);
    }

    return parts.join('|');
  }

  private calculateSituationSimilarity(a: string, b: string): number {
    if (a === b) return 1;

    const partsA = new Set(a.split('|'));
    const partsB = new Set(b.split('|'));
    const intersection = [...partsA].filter((p) => partsB.has(p));
    const union = new Set([...partsA, ...partsB]);

    return intersection.length / union.size;
  }

  private applyFeedbackDecay(): void {
    for (const record of this.feedbackHistory) {
      const age = Date.now() - record.timestamp;
      const days = age / (24 * 60 * 60 * 1000);
      record.weight = Math.pow(ACTIVE_LEARNING_CONSTANTS.FEEDBACK_DECAY, days);
    }

    // Remove very old feedback with negligible weight
    this.feedbackHistory = this.feedbackHistory.filter((f) => f.weight > 0.1);
  }

  private generateAdjustments(
    record: FeedbackRecord,
    query: ActiveQuery,
    response: QueryResponse,
  ): void {
    const selectedOption = query.options.find((o) => o.id === response.selectedOptionId);
    if (!selectedOption) return;

    const target = selectedOption.label;
    if (!this.adjustments.has(target)) {
      this.adjustments.set(target, []);
    }

    const adjustments = this.adjustments.get(target)!;

    if (record.successful) {
      adjustments.push({
        type: 'confidence_boost',
        target,
        magnitude: 0.1,
        contextPattern: query.context.task,
      });
    } else {
      adjustments.push({
        type: 'confidence_penalty',
        target,
        magnitude: 0.15,
        contextPattern: query.context.task,
      });
    }

    // Keep only recent adjustments
    if (adjustments.length > 20) {
      adjustments.shift();
    }
  }

  private describeElement(element: EnhancedUIElement): string {
    const parts: string[] = [];
    parts.push(element.type);
    if (element.text) {
      parts.push(`"${element.text.slice(0, 30)}${element.text.length > 30 ? '...' : ''}"`);
    }
    if (element.semanticRole) {
      parts.push(`role: ${element.semanticRole}`);
    }
    parts.push(`at (${element.bounds.x}, ${element.bounds.y})`);
    return parts.join(' - ');
  }

  private describeAction(action: VMAction): string {
    switch (action.type) {
      case 'click':
        return `Click at (${action.x}, ${action.y})`;
      case 'doubleClick':
        return `Double-click at (${action.x}, ${action.y})`;
      case 'type':
        return `Type "${action.text?.slice(0, 20)}..."`;
      case 'keyPress':
        return `Press ${action.key}`;
      case 'hotkey':
        return `Press ${action.keys.join('+')}`;
      case 'scroll':
        return `Scroll ${action.deltaY > 0 ? 'down' : 'up'}`;
      case 'wait':
        return `Wait ${action.ms}ms`;
      case 'drag':
        return `Drag from (${action.fromX}, ${action.fromY}) to (${action.toX}, ${action.toY})`;
      default:
        return action.type;
    }
  }

  private cleanupExpiredQueries(): void {
    const now = Date.now();
    for (const [id, query] of this.pendingQueries) {
      if (query.expiresAt < now) {
        this.pendingQueries.delete(id);
        logger.debug('Query expired', { queryId: id });
      }
    }
  }

  private saveTimeout: NodeJS.Timeout | null = null;
  private scheduleSave(): void {
    if (this.saveTimeout) return;
    this.saveTimeout = setTimeout(() => {
      this.saveToDisk().catch((e) => logger.error('Failed to save active learning data', { error: e }));
      this.saveTimeout = null;
    }, 5000);
  }

  private async saveToDisk(): Promise<void> {
    const filePath = path.join(this.dataDir, ACTIVE_LEARNING_CONSTANTS.STORAGE_FILE);

    const data = {
      feedbackHistory: this.feedbackHistory,
      adjustments: Array.from(this.adjustments.entries()),
    };

    await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2));
    logger.debug('Active learning data saved', {
      feedback: this.feedbackHistory.length,
      adjustments: this.adjustments.size,
    });
  }

  private async loadFromDisk(): Promise<void> {
    const filePath = path.join(this.dataDir, ACTIVE_LEARNING_CONSTANTS.STORAGE_FILE);

    if (!fs.existsSync(filePath)) return;

    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const data = JSON.parse(content);

      this.feedbackHistory = data.feedbackHistory || [];
      this.adjustments = new Map(data.adjustments || []);
    } catch (error) {
      logger.warn('Failed to load active learning data', { error });
    }
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let activeLearnerInstance: ActiveLearner | null = null;

/**
 * Get the singleton active learner
 */
export function getActiveLearner(): ActiveLearner {
  if (!activeLearnerInstance) {
    activeLearnerInstance = new ActiveLearner();
  }
  return activeLearnerInstance;
}

/**
 * Reset active learner (for testing)
 */
export function resetActiveLearner(): void {
  if (activeLearnerInstance) {
    activeLearnerInstance.clear();
    activeLearnerInstance = null;
  }
}
