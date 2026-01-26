/**
 * Atlas Desktop - VM Agent Predictive Engine
 *
 * Predicts next actions, anticipates user intent, and creates
 * task plans using ML patterns and historical data.
 *
 * Ported and enhanced from browser-agent/predictive-engine.ts
 *
 * @module vm-agent/learning/predictive-engine
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { createModuleLogger } from '../../utils/logger';
import { getEventBus, createEvent } from '../core/event-bus';
import { VMAction, ScreenState, UIElement } from '../types';
import { EnhancedUIElement, TaskPlan, PlannedStep } from '../core/types';
import { ScreenUnderstanding, ApplicationContext } from '../vision/enhanced-screen';

const logger = createModuleLogger('PredictiveEngine');

// =============================================================================
// Predictive Engine Constants
// =============================================================================

export const PREDICTIVE_CONSTANTS = {
  /** Minimum confidence for prediction */
  MIN_CONFIDENCE: 0.4,
  /** High confidence threshold */
  HIGH_CONFIDENCE: 0.75,
  /** Maximum predictions to return */
  MAX_PREDICTIONS: 5,
  /** Maximum action history to keep */
  MAX_ACTION_HISTORY: 500,
  /** Pattern minimum occurrences */
  MIN_PATTERN_OCCURRENCES: 3,
  /** Transition matrix decay factor */
  DECAY_FACTOR: 0.95,
  /** Storage file name */
  STORAGE_FILE: 'vm-predictive-engine.json',
} as const;

// =============================================================================
// Predictive Types
// =============================================================================

export interface ActionPrediction {
  /** Predicted action */
  action: VMAction;
  /** Target element (if applicable) */
  targetElement?: EnhancedUIElement;
  /** Confidence score */
  confidence: number;
  /** Reasoning behind prediction */
  reasoning: string;
  /** Source of prediction */
  source: 'pattern' | 'context' | 'intent' | 'history' | 'combined';
}

export interface ActionSequence {
  /** Sequence of actions */
  actions: VMAction[];
  /** Application context */
  application: string;
  /** Screen context */
  screen: string;
  /** Times this sequence occurred */
  occurrences: number;
  /** Average time between actions (ms) */
  avgTimeBetween: number;
  /** Last seen timestamp */
  lastSeen: number;
}

export interface TransitionMatrix {
  /** From action type to probability of next action type */
  transitions: Map<string, Map<string, number>>;
  /** Total observations per action type */
  totals: Map<string, number>;
}

export interface IntentPattern {
  /** Pattern ID */
  id: string;
  /** Intent description */
  intent: string;
  /** Trigger conditions */
  triggers: Array<{
    application?: string;
    screen?: string;
    hasElement?: { type?: string; text?: string };
    previousAction?: string;
  }>;
  /** Predicted action sequence */
  actions: VMAction[];
  /** Confidence */
  confidence: number;
  /** Times matched */
  matchCount: number;
}

export interface ActionHistoryEntry {
  /** Action performed */
  action: VMAction;
  /** Application context */
  application: string;
  /** Screen context */
  screen: string;
  /** Timestamp */
  timestamp: number;
  /** Was action successful */
  success: boolean;
  /** Element targeted */
  targetElement?: {
    type: string;
    text?: string;
  };
}

// =============================================================================
// Predictive Engine
// =============================================================================

/**
 * Predicts next actions based on patterns, context, and history
 *
 * @example
 * ```typescript
 * const engine = getPredictiveEngine();
 *
 * // Predict next actions
 * const predictions = await engine.predict(understanding, actionHistory);
 *
 * // Create a task plan
 * const plan = await engine.createTaskPlan('Login to email', understanding);
 *
 * // Record action for learning
 * engine.recordAction(action, understanding, true);
 * ```
 */
export class PredictiveEngine extends EventEmitter {
  private actionHistory: ActionHistoryEntry[] = [];
  private sequences: ActionSequence[] = [];
  private transitionMatrix: TransitionMatrix = {
    transitions: new Map(),
    totals: new Map(),
  };
  private intentPatterns: IntentPattern[] = [];
  private dataDir: string;
  private initialized: boolean = false;

  constructor() {
    super();
    this.dataDir = path.join(app.getPath('userData'), 'vm-agent');
    this.initializeDefaultPatterns();
  }

  /**
   * Initialize the engine
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      if (!fs.existsSync(this.dataDir)) {
        fs.mkdirSync(this.dataDir, { recursive: true });
      }

      await this.loadFromDisk();
      this.initialized = true;
      logger.info('Predictive engine initialized', {
        historySize: this.actionHistory.length,
        sequences: this.sequences.length,
        patterns: this.intentPatterns.length,
      });
    } catch (error) {
      logger.error('Failed to initialize predictive engine', { error });
      this.initialized = true;
    }
  }

  /**
   * Predict next actions based on current state
   */
  async predict(
    understanding: ScreenUnderstanding,
    recentActions?: VMAction[],
  ): Promise<ActionPrediction[]> {
    await this.ensureInitialized();

    const predictions: ActionPrediction[] = [];

    // 1. Pattern-based predictions
    const patternPredictions = this.predictFromPatterns(understanding);
    predictions.push(...patternPredictions);

    // 2. Transition matrix predictions
    if (recentActions && recentActions.length > 0) {
      const lastAction = recentActions[recentActions.length - 1];
      const transitionPredictions = this.predictFromTransitions(lastAction, understanding);
      predictions.push(...transitionPredictions);
    }

    // 3. Intent-based predictions
    const intentPredictions = this.predictFromIntent(understanding, recentActions);
    predictions.push(...intentPredictions);

    // 4. Context-based predictions
    const contextPredictions = this.predictFromContext(understanding);
    predictions.push(...contextPredictions);

    // Combine and deduplicate
    const combined = this.combinePredictions(predictions);

    // Sort by confidence
    combined.sort((a, b) => b.confidence - a.confidence);

    // Return top predictions
    return combined.slice(0, PREDICTIVE_CONSTANTS.MAX_PREDICTIONS);
  }

  /**
   * Create a task plan for a goal
   */
  async createTaskPlan(goal: string, understanding: ScreenUnderstanding): Promise<TaskPlan> {
    await this.ensureInitialized();

    const eventBus = getEventBus();
    eventBus.emitSync(
      createEvent('planning:started', { goal }, 'predictive-engine', { priority: 'normal' }),
    );

    const steps: PlannedStep[] = [];
    let confidence = 0.5;

    // Find matching intent patterns
    const matchingPatterns = this.findMatchingIntentPatterns(goal);

    if (matchingPatterns.length > 0) {
      // Use the best matching pattern
      const pattern = matchingPatterns[0];
      confidence = pattern.confidence;

      for (let i = 0; i < pattern.actions.length; i++) {
        steps.push({
          id: `step-${i + 1}`,
          action: pattern.actions[i],
          description: this.describeAction(pattern.actions[i]),
          expectedOutcome: `Complete step ${i + 1} of ${pattern.intent}`,
          estimatedDuration: 2000,
          confidence: pattern.confidence,
          dependencies: i > 0 ? [`step-${i}`] : [],
          fallback: undefined,
        });
      }
    } else {
      // Generate steps from goal analysis
      const generatedSteps = this.generateStepsFromGoal(goal, understanding);
      steps.push(...generatedSteps);
      confidence = 0.4;
    }

    const plan: TaskPlan = {
      id: `plan-${Date.now()}`,
      goal,
      steps,
      totalEstimatedDuration: steps.reduce((sum, s) => sum + s.estimatedDuration, 0),
      confidence,
      createdAt: Date.now(),
      context: {
        application: understanding.applicationContext.application,
        screen: understanding.applicationContext.screen,
      },
    };

    eventBus.emitSync(
      createEvent(
        'planning:completed',
        { planId: plan.id, steps: steps.length, confidence },
        'predictive-engine',
        { priority: 'normal' },
      ),
    );

    return plan;
  }

  /**
   * Record an action for learning
   */
  recordAction(
    action: VMAction,
    understanding: ScreenUnderstanding,
    success: boolean,
    targetElement?: UIElement,
  ): void {
    const entry: ActionHistoryEntry = {
      action,
      application: understanding.applicationContext.application,
      screen: understanding.applicationContext.screen,
      timestamp: Date.now(),
      success,
      targetElement: targetElement
        ? { type: targetElement.type, text: targetElement.text }
        : undefined,
    };

    this.actionHistory.push(entry);

    // Trim history
    if (this.actionHistory.length > PREDICTIVE_CONSTANTS.MAX_ACTION_HISTORY) {
      this.actionHistory = this.actionHistory.slice(-PREDICTIVE_CONSTANTS.MAX_ACTION_HISTORY);
    }

    // Update transition matrix
    if (this.actionHistory.length >= 2) {
      const prevEntry = this.actionHistory[this.actionHistory.length - 2];
      this.updateTransitionMatrix(prevEntry.action, action);
    }

    // Detect sequences
    this.detectSequences();

    this.scheduleSave();
  }

  /**
   * Learn from a completed task
   */
  learnFromTask(
    goal: string,
    actions: VMAction[],
    success: boolean,
    understanding: ScreenUnderstanding,
  ): void {
    if (!success || actions.length < 2) return;

    // Check if similar pattern exists
    const existingPattern = this.intentPatterns.find((p) =>
      p.intent.toLowerCase().includes(goal.toLowerCase()) ||
      goal.toLowerCase().includes(p.intent.toLowerCase()),
    );

    if (existingPattern) {
      // Update existing pattern
      existingPattern.matchCount++;
      existingPattern.confidence = Math.min(
        0.95,
        existingPattern.confidence + 0.05,
      );
    } else {
      // Create new pattern
      const newPattern: IntentPattern = {
        id: `pattern-${Date.now()}`,
        intent: goal,
        triggers: [
          {
            application: understanding.applicationContext.application,
            screen: understanding.applicationContext.screen,
          },
        ],
        actions,
        confidence: 0.6,
        matchCount: 1,
      };

      this.intentPatterns.push(newPattern);
    }

    this.scheduleSave();
  }

  /**
   * Get engine statistics
   */
  getStats(): {
    historySize: number;
    sequences: number;
    patterns: number;
    transitionTypes: number;
    topTransitions: Array<{ from: string; to: string; probability: number }>;
  } {
    const topTransitions: Array<{ from: string; to: string; probability: number }> = [];

    for (const [fromType, toMap] of this.transitionMatrix.transitions) {
      for (const [toType, count] of toMap) {
        const total = this.transitionMatrix.totals.get(fromType) || 1;
        topTransitions.push({
          from: fromType,
          to: toType,
          probability: count / total,
        });
      }
    }

    topTransitions.sort((a, b) => b.probability - a.probability);

    return {
      historySize: this.actionHistory.length,
      sequences: this.sequences.length,
      patterns: this.intentPatterns.length,
      transitionTypes: this.transitionMatrix.transitions.size,
      topTransitions: topTransitions.slice(0, 10),
    };
  }

  /**
   * Clear all learned data
   */
  clear(): void {
    this.actionHistory = [];
    this.sequences = [];
    this.transitionMatrix = { transitions: new Map(), totals: new Map() };
    this.intentPatterns = [];
    this.initializeDefaultPatterns();
    this.scheduleSave();
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  private initializeDefaultPatterns(): void {
    // Common patterns for VM operations
    this.intentPatterns = [
      {
        id: 'pattern-login',
        intent: 'login',
        triggers: [{ hasElement: { type: 'input', text: 'username' } }],
        actions: [
          { type: 'click', x: 0, y: 0 }, // Username field
          { type: 'type', text: '' }, // Username
          { type: 'click', x: 0, y: 0 }, // Password field
          { type: 'type', text: '' }, // Password
          { type: 'click', x: 0, y: 0 }, // Login button
        ],
        confidence: 0.7,
        matchCount: 0,
      },
      {
        id: 'pattern-search',
        intent: 'search',
        triggers: [{ hasElement: { type: 'input', text: 'search' } }],
        actions: [
          { type: 'click', x: 0, y: 0 }, // Search field
          { type: 'type', text: '' }, // Search term
          { type: 'keyPress', key: 'Enter' }, // Submit
        ],
        confidence: 0.7,
        matchCount: 0,
      },
      {
        id: 'pattern-file-open',
        intent: 'open file',
        triggers: [{ application: 'File Explorer' }],
        actions: [
          { type: 'doubleClick', x: 0, y: 0 }, // Double-click file
        ],
        confidence: 0.6,
        matchCount: 0,
      },
      {
        id: 'pattern-navigate',
        intent: 'navigate',
        triggers: [{ application: 'Browser' }],
        actions: [
          { type: 'click', x: 0, y: 0 }, // Address bar
          { type: 'hotkey', keys: ['Control', 'a'] }, // Select all
          { type: 'type', text: '' }, // URL
          { type: 'keyPress', key: 'Enter' }, // Go
        ],
        confidence: 0.7,
        matchCount: 0,
      },
      {
        id: 'pattern-save',
        intent: 'save',
        triggers: [],
        actions: [{ type: 'hotkey', keys: ['Control', 's'] }],
        confidence: 0.9,
        matchCount: 0,
      },
      {
        id: 'pattern-copy',
        intent: 'copy',
        triggers: [],
        actions: [{ type: 'hotkey', keys: ['Control', 'c'] }],
        confidence: 0.9,
        matchCount: 0,
      },
      {
        id: 'pattern-paste',
        intent: 'paste',
        triggers: [],
        actions: [{ type: 'hotkey', keys: ['Control', 'v'] }],
        confidence: 0.9,
        matchCount: 0,
      },
    ];
  }

  private predictFromPatterns(understanding: ScreenUnderstanding): ActionPrediction[] {
    const predictions: ActionPrediction[] = [];

    for (const pattern of this.intentPatterns) {
      if (this.matchesTriggers(pattern.triggers, understanding)) {
        if (pattern.actions.length > 0) {
          predictions.push({
            action: pattern.actions[0],
            confidence: pattern.confidence * 0.8,
            reasoning: `Matches pattern: ${pattern.intent}`,
            source: 'pattern',
          });
        }
      }
    }

    return predictions;
  }

  private predictFromTransitions(
    lastAction: VMAction,
    understanding: ScreenUnderstanding,
  ): ActionPrediction[] {
    const predictions: ActionPrediction[] = [];
    const actionType = lastAction.type;

    const transitions = this.transitionMatrix.transitions.get(actionType);
    const total = this.transitionMatrix.totals.get(actionType);

    if (!transitions || !total) return predictions;

    for (const [nextType, count] of transitions) {
      const probability = count / total;
      if (probability >= PREDICTIVE_CONSTANTS.MIN_CONFIDENCE) {
        // Create a generic action of the predicted type
        const action = this.createActionOfType(nextType, understanding);
        if (action) {
          predictions.push({
            action,
            confidence: probability * 0.7,
            reasoning: `${Math.round(probability * 100)}% likely after ${actionType}`,
            source: 'history',
          });
        }
      }
    }

    return predictions;
  }

  private predictFromIntent(
    understanding: ScreenUnderstanding,
    _recentActions?: VMAction[],
  ): ActionPrediction[] {
    const predictions: ActionPrediction[] = [];

    // Detect implicit intents from screen state
    const { interactionMap } = understanding;

    // If there's an input field, likely need to type
    if (interactionMap.inputs.length > 0) {
      const firstInput = interactionMap.inputs[0];
      predictions.push({
        action: { type: 'click', x: firstInput.bounds.x + 10, y: firstInput.bounds.y + 10 },
        targetElement: firstInput,
        confidence: 0.6,
        reasoning: 'Input field detected - likely needs input',
        source: 'intent',
      });
    }

    // If there's a primary button, might need to click it
    if (interactionMap.buttons.length > 0) {
      const primaryButton = interactionMap.buttons[0];
      if (primaryButton.purpose?.toLowerCase().includes('submit') ||
          primaryButton.purpose?.toLowerCase().includes('next') ||
          primaryButton.purpose?.toLowerCase().includes('ok')) {
        predictions.push({
          action: {
            type: 'click',
            x: primaryButton.bounds.x + primaryButton.bounds.width / 2,
            y: primaryButton.bounds.y + primaryButton.bounds.height / 2,
          },
          targetElement: primaryButton,
          confidence: 0.5,
          reasoning: `Primary button detected: ${primaryButton.text || primaryButton.purpose}`,
          source: 'intent',
        });
      }
    }

    return predictions;
  }

  private predictFromContext(understanding: ScreenUnderstanding): ActionPrediction[] {
    const predictions: ActionPrediction[] = [];
    const context = understanding.applicationContext;

    // Context-specific predictions
    switch (context.type) {
      case 'browser':
        // Predict scrolling if content is tall
        if (understanding.layout.main) {
          predictions.push({
            action: { type: 'scroll', x: 400, y: 400, deltaX: 0, deltaY: 300 },
            confidence: 0.4,
            reasoning: 'Browser - may need to scroll for content',
            source: 'context',
          });
        }
        break;

      case 'editor':
        // Predict save after typing
        predictions.push({
          action: { type: 'hotkey', keys: ['Control', 's'] },
          confidence: 0.3,
          reasoning: 'Editor - may want to save work',
          source: 'context',
        });
        break;

      case 'explorer':
        // Predict double-click to open
        if (understanding.interactionMap.content.length > 0) {
          const firstItem = understanding.interactionMap.content[0];
          predictions.push({
            action: {
              type: 'doubleClick',
              x: firstItem.bounds.x + 20,
              y: firstItem.bounds.y + 10,
            },
            targetElement: firstItem,
            confidence: 0.4,
            reasoning: 'File explorer - may want to open item',
            source: 'context',
          });
        }
        break;
    }

    return predictions;
  }

  private matchesTriggers(
    triggers: IntentPattern['triggers'],
    understanding: ScreenUnderstanding,
  ): boolean {
    if (triggers.length === 0) return false;

    for (const trigger of triggers) {
      let matches = true;

      if (trigger.application) {
        if (!understanding.applicationContext.application.toLowerCase()
            .includes(trigger.application.toLowerCase())) {
          matches = false;
        }
      }

      if (trigger.screen) {
        if (!understanding.applicationContext.screen.toLowerCase()
            .includes(trigger.screen.toLowerCase())) {
          matches = false;
        }
      }

      if (trigger.hasElement) {
        const found = understanding.enhancedElements.some((el) => {
          if (trigger.hasElement!.type && el.type !== trigger.hasElement!.type) {
            return false;
          }
          if (trigger.hasElement!.text && !el.text?.toLowerCase()
              .includes(trigger.hasElement!.text.toLowerCase())) {
            return false;
          }
          return true;
        });
        if (!found) matches = false;
      }

      if (matches) return true;
    }

    return false;
  }

  private findMatchingIntentPatterns(goal: string): IntentPattern[] {
    const goalLower = goal.toLowerCase();
    const matching = this.intentPatterns.filter((p) =>
      goalLower.includes(p.intent.toLowerCase()) ||
      p.intent.toLowerCase().includes(goalLower),
    );

    // Sort by confidence and match count
    matching.sort((a, b) => {
      const scoreA = a.confidence + a.matchCount * 0.1;
      const scoreB = b.confidence + b.matchCount * 0.1;
      return scoreB - scoreA;
    });

    return matching;
  }

  private generateStepsFromGoal(goal: string, understanding: ScreenUnderstanding): PlannedStep[] {
    const steps: PlannedStep[] = [];
    const goalLower = goal.toLowerCase();

    // Parse goal for common verbs
    if (goalLower.includes('click') || goalLower.includes('press')) {
      // Find mentioned element
      const element = this.findElementMentionedInGoal(goal, understanding);
      if (element) {
        steps.push({
          id: 'step-1',
          action: {
            type: 'click',
            x: element.bounds.x + element.bounds.width / 2,
            y: element.bounds.y + element.bounds.height / 2,
          },
          description: `Click ${element.text || element.type}`,
          expectedOutcome: 'Element clicked',
          estimatedDuration: 1000,
          confidence: 0.7,
          dependencies: [],
        });
      }
    }

    if (goalLower.includes('type') || goalLower.includes('enter') || goalLower.includes('input')) {
      // Extract text to type
      const textMatch = goal.match(/["']([^"']+)["']/);
      const text = textMatch ? textMatch[1] : '';

      // Find input field
      const input = understanding.interactionMap.inputs[0];
      if (input) {
        steps.push({
          id: `step-${steps.length + 1}`,
          action: {
            type: 'click',
            x: input.bounds.x + 10,
            y: input.bounds.y + 10,
          },
          description: 'Focus input field',
          expectedOutcome: 'Input focused',
          estimatedDuration: 500,
          confidence: 0.7,
          dependencies: steps.length > 0 ? [`step-${steps.length}`] : [],
        });

        steps.push({
          id: `step-${steps.length + 1}`,
          action: { type: 'type', text },
          description: `Type "${text}"`,
          expectedOutcome: 'Text entered',
          estimatedDuration: text.length * 100 + 500,
          confidence: 0.8,
          dependencies: [`step-${steps.length}`],
        });
      }
    }

    if (goalLower.includes('scroll')) {
      const direction = goalLower.includes('down') ? 1 : -1;
      steps.push({
        id: `step-${steps.length + 1}`,
        action: {
          type: 'scroll',
          x: understanding.screenState.dimensions.width / 2,
          y: understanding.screenState.dimensions.height / 2,
          deltaX: 0,
          deltaY: direction * 300,
        },
        description: `Scroll ${direction > 0 ? 'down' : 'up'}`,
        expectedOutcome: 'Page scrolled',
        estimatedDuration: 500,
        confidence: 0.8,
        dependencies: steps.length > 0 ? [`step-${steps.length}`] : [],
      });
    }

    // Default: if no steps generated, try clicking a relevant element
    if (steps.length === 0) {
      const relevantElement = this.findElementMentionedInGoal(goal, understanding);
      if (relevantElement) {
        steps.push({
          id: 'step-1',
          action: {
            type: 'click',
            x: relevantElement.bounds.x + relevantElement.bounds.width / 2,
            y: relevantElement.bounds.y + relevantElement.bounds.height / 2,
          },
          description: `Interact with ${relevantElement.text || relevantElement.type}`,
          expectedOutcome: 'Action completed',
          estimatedDuration: 2000,
          confidence: 0.5,
          dependencies: [],
        });
      }
    }

    return steps;
  }

  private findElementMentionedInGoal(
    goal: string,
    understanding: ScreenUnderstanding,
  ): EnhancedUIElement | undefined {
    const goalLower = goal.toLowerCase();

    // Try to find an element mentioned by text
    for (const el of understanding.enhancedElements) {
      if (el.text && goalLower.includes(el.text.toLowerCase())) {
        return el;
      }
      if (el.purpose && goalLower.includes(el.purpose.toLowerCase())) {
        return el;
      }
    }

    // Try by type
    if (goalLower.includes('button')) {
      return understanding.interactionMap.buttons[0];
    }
    if (goalLower.includes('input') || goalLower.includes('field')) {
      return understanding.interactionMap.inputs[0];
    }
    if (goalLower.includes('link')) {
      return understanding.interactionMap.links[0];
    }

    return undefined;
  }

  private combinePredictions(predictions: ActionPrediction[]): ActionPrediction[] {
    const combined: ActionPrediction[] = [];
    const seen = new Set<string>();

    for (const pred of predictions) {
      const key = this.getActionKey(pred.action);
      if (!seen.has(key)) {
        seen.add(key);
        combined.push(pred);
      } else {
        // Boost confidence of existing prediction
        const existing = combined.find((p) => this.getActionKey(p.action) === key);
        if (existing) {
          existing.confidence = Math.min(0.95, existing.confidence + pred.confidence * 0.2);
          existing.source = 'combined';
        }
      }
    }

    return combined;
  }

  private createActionOfType(
    actionType: string,
    understanding: ScreenUnderstanding,
  ): VMAction | null {
    const centerX = understanding.screenState.dimensions.width / 2;
    const centerY = understanding.screenState.dimensions.height / 2;

    switch (actionType) {
      case 'click':
        return { type: 'click', x: centerX, y: centerY };
      case 'doubleClick':
        return { type: 'doubleClick', x: centerX, y: centerY };
      case 'type':
        return { type: 'type', text: '' };
      case 'keyPress':
        return { type: 'keyPress', key: 'Enter' };
      case 'scroll':
        return { type: 'scroll', x: centerX, y: centerY, deltaX: 0, deltaY: 100 };
      case 'wait':
        return { type: 'wait', ms: 1000 };
      default:
        return null;
    }
  }

  private updateTransitionMatrix(fromAction: VMAction, toAction: VMAction): void {
    const fromType = fromAction.type;
    const toType = toAction.type;

    // Get or create transition map for fromType
    if (!this.transitionMatrix.transitions.has(fromType)) {
      this.transitionMatrix.transitions.set(fromType, new Map());
      this.transitionMatrix.totals.set(fromType, 0);
    }

    const transitions = this.transitionMatrix.transitions.get(fromType)!;
    const currentCount = transitions.get(toType) || 0;
    transitions.set(toType, currentCount + 1);

    const total = this.transitionMatrix.totals.get(fromType)!;
    this.transitionMatrix.totals.set(fromType, total + 1);

    // Apply decay to prevent stale data
    if (total > 100) {
      this.applyDecay();
    }
  }

  private applyDecay(): void {
    for (const [fromType, transitions] of this.transitionMatrix.transitions) {
      for (const [toType, count] of transitions) {
        transitions.set(toType, count * PREDICTIVE_CONSTANTS.DECAY_FACTOR);
      }
      const total = this.transitionMatrix.totals.get(fromType)!;
      this.transitionMatrix.totals.set(fromType, total * PREDICTIVE_CONSTANTS.DECAY_FACTOR);
    }
  }

  private detectSequences(): void {
    // Detect repeated action sequences
    if (this.actionHistory.length < 3) return;

    // Look for 2-5 action sequences
    for (let seqLen = 2; seqLen <= 5 && seqLen <= this.actionHistory.length / 2; seqLen++) {
      const recent = this.actionHistory.slice(-seqLen);
      const key = recent.map((e) => this.getActionKey(e.action)).join('|');

      // Check if this sequence occurred before
      let matches = 0;
      for (let i = 0; i <= this.actionHistory.length - seqLen * 2; i++) {
        const candidate = this.actionHistory.slice(i, i + seqLen);
        const candidateKey = candidate.map((e) => this.getActionKey(e.action)).join('|');
        if (candidateKey === key) {
          matches++;
        }
      }

      if (matches >= PREDICTIVE_CONSTANTS.MIN_PATTERN_OCCURRENCES) {
        // Found a sequence pattern
        const existingSeq = this.sequences.find(
          (s) => s.actions.map((a) => this.getActionKey(a)).join('|') === key,
        );

        if (existingSeq) {
          existingSeq.occurrences = matches;
          existingSeq.lastSeen = Date.now();
        } else {
          this.sequences.push({
            actions: recent.map((e) => e.action),
            application: recent[0].application,
            screen: recent[0].screen,
            occurrences: matches,
            avgTimeBetween: this.calculateAvgTimeBetween(recent),
            lastSeen: Date.now(),
          });
        }
      }
    }

    // Trim sequences list
    if (this.sequences.length > 50) {
      this.sequences.sort((a, b) => b.occurrences - a.occurrences);
      this.sequences = this.sequences.slice(0, 50);
    }
  }

  private calculateAvgTimeBetween(entries: ActionHistoryEntry[]): number {
    if (entries.length < 2) return 0;

    let totalTime = 0;
    for (let i = 1; i < entries.length; i++) {
      totalTime += entries[i].timestamp - entries[i - 1].timestamp;
    }

    return totalTime / (entries.length - 1);
  }

  private getActionKey(action: VMAction): string {
    switch (action.type) {
      case 'click':
      case 'doubleClick':
        return `${action.type}:${Math.round(action.x / 50)}:${Math.round(action.y / 50)}`;
      case 'type':
        return `type:${action.text?.slice(0, 10)}`;
      case 'keyPress':
        return `key:${action.key}`;
      case 'hotkey':
        return `hotkey:${action.keys.join('+')}`;
      case 'scroll':
        return `scroll:${action.deltaY > 0 ? 'down' : 'up'}`;
      default:
        return action.type;
    }
  }

  private describeAction(action: VMAction): string {
    switch (action.type) {
      case 'click':
        return `Click at (${action.x}, ${action.y})`;
      case 'doubleClick':
        return `Double-click at (${action.x}, ${action.y})`;
      case 'type':
        return `Type "${action.text}"`;
      case 'keyPress':
        return `Press ${action.key}`;
      case 'hotkey':
        return `Press ${action.keys.join('+')}`;
      case 'scroll':
        return `Scroll ${action.deltaY > 0 ? 'down' : 'up'}`;
      case 'drag':
        return `Drag from (${action.fromX}, ${action.fromY}) to (${action.toX}, ${action.toY})`;
      case 'wait':
        return `Wait ${action.ms}ms`;
      default:
        return action.type;
    }
  }

  private saveTimeout: NodeJS.Timeout | null = null;
  private scheduleSave(): void {
    if (this.saveTimeout) return;
    this.saveTimeout = setTimeout(() => {
      this.saveToDisk().catch((e) => logger.error('Failed to save predictive data', { error: e }));
      this.saveTimeout = null;
    }, 5000);
  }

  private async saveToDisk(): Promise<void> {
    const filePath = path.join(this.dataDir, PREDICTIVE_CONSTANTS.STORAGE_FILE);

    const data = {
      actionHistory: this.actionHistory.slice(-200), // Keep recent history
      sequences: this.sequences,
      transitionMatrix: {
        transitions: Array.from(this.transitionMatrix.transitions.entries()).map(
          ([k, v]) => [k, Array.from(v.entries())],
        ),
        totals: Array.from(this.transitionMatrix.totals.entries()),
      },
      intentPatterns: this.intentPatterns.filter((p) => p.matchCount > 0 || p.id.startsWith('pattern-')),
    };

    await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2));
    logger.debug('Predictive engine data saved');
  }

  private async loadFromDisk(): Promise<void> {
    const filePath = path.join(this.dataDir, PREDICTIVE_CONSTANTS.STORAGE_FILE);

    if (!fs.existsSync(filePath)) return;

    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const data = JSON.parse(content);

      this.actionHistory = data.actionHistory || [];
      this.sequences = data.sequences || [];

      if (data.transitionMatrix) {
        this.transitionMatrix = {
          transitions: new Map(
            (data.transitionMatrix.transitions || []).map(
              ([k, v]: [string, Array<[string, number]>]) => [k, new Map(v)],
            ),
          ),
          totals: new Map(data.transitionMatrix.totals || []),
        };
      }

      // Merge loaded patterns with defaults
      const loadedPatterns = data.intentPatterns || [];
      for (const loaded of loadedPatterns) {
        const existing = this.intentPatterns.find((p) => p.id === loaded.id);
        if (existing) {
          existing.matchCount = loaded.matchCount;
          existing.confidence = loaded.confidence;
        } else {
          this.intentPatterns.push(loaded);
        }
      }
    } catch (error) {
      logger.warn('Failed to load predictive data', { error });
    }
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let predictiveInstance: PredictiveEngine | null = null;

/**
 * Get the singleton predictive engine
 */
export function getPredictiveEngine(): PredictiveEngine {
  if (!predictiveInstance) {
    predictiveInstance = new PredictiveEngine();
  }
  return predictiveInstance;
}

/**
 * Reset predictive engine (for testing)
 */
export function resetPredictiveEngine(): void {
  if (predictiveInstance) {
    predictiveInstance.clear();
    predictiveInstance = null;
  }
}
