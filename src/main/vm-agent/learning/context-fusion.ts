/**
 * Atlas Desktop - VM Agent Context Fusion Engine
 *
 * Combines multiple context sources (vision, memory, predictions, feedback)
 * into unified decision-making context for optimal agent actions.
 *
 * @module vm-agent/learning/context-fusion
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../../utils/logger';
import { getEventBus, createEvent } from '../core/event-bus';
import { VMAction, ScreenState } from '../types';
import { EnhancedUIElement, TaskPlan, PlannedStep } from '../core/types';
import { ScreenUnderstanding, ApplicationContext } from '../vision/enhanced-screen';
import { ActionPrediction, PredictionContext } from './predictive-engine';
import { LearningAdjustment, QueryContext } from './active-learning';

const logger = createModuleLogger('ContextFusion');

// =============================================================================
// Context Fusion Constants
// =============================================================================

export const CONTEXT_FUSION_CONSTANTS = {
  /** Weight for visual context */
  VISUAL_WEIGHT: 0.35,
  /** Weight for memory context */
  MEMORY_WEIGHT: 0.25,
  /** Weight for prediction context */
  PREDICTION_WEIGHT: 0.25,
  /** Weight for feedback context */
  FEEDBACK_WEIGHT: 0.15,
  /** Minimum confidence to include element */
  MIN_ELEMENT_CONFIDENCE: 0.3,
  /** Maximum context elements */
  MAX_CONTEXT_ELEMENTS: 20,
  /** Context cache TTL */
  CONTEXT_CACHE_TTL_MS: 5000,
} as const;

// =============================================================================
// Context Fusion Types
// =============================================================================

export interface FusedContext {
  /** Context ID */
  id: string;
  /** Current screen understanding */
  screen: ScreenUnderstanding;
  /** Ranked elements for interaction */
  rankedElements: RankedElement[];
  /** Recommended actions */
  recommendedActions: RecommendedAction[];
  /** Active task context */
  taskContext?: TaskContext;
  /** User preferences context */
  userPreferences: UserPreferences;
  /** Risk assessment */
  riskAssessment: RiskAssessment;
  /** Contextual insights */
  insights: ContextInsight[];
  /** Overall confidence */
  confidence: number;
  /** Timestamp */
  timestamp: number;
}

export interface RankedElement {
  /** Element */
  element: EnhancedUIElement;
  /** Combined relevance score */
  relevanceScore: number;
  /** Score breakdown */
  scoreBreakdown: {
    visual: number;
    memory: number;
    prediction: number;
    feedback: number;
  };
  /** Why this element is ranked high */
  reasoning: string[];
  /** Suggested action for this element */
  suggestedAction?: VMAction;
}

export interface RecommendedAction {
  /** Action */
  action: VMAction;
  /** Confidence in recommendation */
  confidence: number;
  /** Reasoning */
  reasoning: string;
  /** Source of recommendation */
  source: 'prediction' | 'memory' | 'task' | 'visual' | 'fusion';
  /** Target element if applicable */
  targetElement?: EnhancedUIElement;
  /** Risk level */
  riskLevel: 'low' | 'medium' | 'high';
}

export interface TaskContext {
  /** Current task */
  taskName: string;
  /** Task description */
  description: string;
  /** Current step */
  currentStep: number;
  /** Total steps */
  totalSteps: number;
  /** Completed actions */
  completedActions: VMAction[];
  /** Expected next action */
  expectedNextAction?: VMAction;
  /** Progress percentage */
  progress: number;
}

export interface UserPreferences {
  /** Preferred interaction speed */
  interactionSpeed: 'slow' | 'normal' | 'fast';
  /** Confirmation preference */
  confirmationLevel: 'all' | 'important' | 'none';
  /** Learning from mistakes enabled */
  learnFromMistakes: boolean;
  /** Proactive suggestions enabled */
  proactiveSuggestions: boolean;
  /** Custom element preferences */
  elementPreferences: Map<string, number>;
}

export interface RiskAssessment {
  /** Overall risk level */
  overallRisk: 'low' | 'medium' | 'high' | 'critical';
  /** Risk factors */
  factors: RiskFactor[];
  /** Whether confirmation is required */
  requiresConfirmation: boolean;
  /** Suggested mitigations */
  mitigations: string[];
}

export interface RiskFactor {
  /** Factor type */
  type: 'destructive_action' | 'sensitive_data' | 'system_modification' | 'external_communication' | 'financial' | 'unknown_state';
  /** Description */
  description: string;
  /** Severity */
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export interface ContextInsight {
  /** Insight type */
  type: 'suggestion' | 'warning' | 'info' | 'optimization';
  /** Message */
  message: string;
  /** Actionable */
  actionable: boolean;
  /** Suggested action */
  suggestedAction?: VMAction;
  /** Confidence */
  confidence: number;
}

export interface FusionInput {
  /** Screen understanding */
  screen: ScreenUnderstanding;
  /** Predictions */
  predictions?: ActionPrediction[];
  /** Learning adjustments */
  adjustments?: Map<string, LearningAdjustment[]>;
  /** Current task plan */
  taskPlan?: TaskPlan;
  /** Recent actions */
  recentActions?: VMAction[];
  /** Current goal */
  currentGoal?: string;
}

// =============================================================================
// Context Fusion Engine
// =============================================================================

/**
 * Fuses multiple context sources for optimal decision-making
 *
 * @example
 * ```typescript
 * const fusion = getContextFusionEngine();
 *
 * const context = await fusion.fuse({
 *   screen: currentUnderstanding,
 *   predictions: predictedActions,
 *   taskPlan: currentPlan,
 *   recentActions: history
 * });
 *
 * // Use fused context for decisions
 * const bestElement = context.rankedElements[0];
 * const recommendedAction = context.recommendedActions[0];
 * ```
 */
export class ContextFusionEngine extends EventEmitter {
  private userPreferences: UserPreferences;
  private contextCache: Map<string, { context: FusedContext; expiresAt: number }> = new Map();
  private recentInsights: ContextInsight[] = [];

  constructor() {
    super();
    this.userPreferences = this.getDefaultPreferences();
  }

  /**
   * Fuse multiple context sources
   */
  async fuse(input: FusionInput): Promise<FusedContext> {
    const startTime = Date.now();

    // Check cache
    const cacheKey = this.createCacheKey(input);
    const cached = this.contextCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.context;
    }

    // Rank elements
    const rankedElements = this.rankElements(input);

    // Generate recommended actions
    const recommendedActions = this.generateRecommendedActions(input, rankedElements);

    // Build task context
    const taskContext = input.taskPlan ? this.buildTaskContext(input.taskPlan, input.recentActions) : undefined;

    // Assess risk
    const riskAssessment = this.assessRisk(recommendedActions, input);

    // Generate insights
    const insights = this.generateInsights(input, rankedElements, recommendedActions);

    // Calculate overall confidence
    const confidence = this.calculateOverallConfidence(rankedElements, recommendedActions, taskContext);

    const fusedContext: FusedContext = {
      id: `ctx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      screen: input.screen,
      rankedElements: rankedElements.slice(0, CONTEXT_FUSION_CONSTANTS.MAX_CONTEXT_ELEMENTS),
      recommendedActions,
      taskContext,
      userPreferences: this.userPreferences,
      riskAssessment,
      insights,
      confidence,
      timestamp: Date.now(),
    };

    // Cache result
    this.contextCache.set(cacheKey, {
      context: fusedContext,
      expiresAt: Date.now() + CONTEXT_FUSION_CONSTANTS.CONTEXT_CACHE_TTL_MS,
    });

    // Emit event
    const eventBus = getEventBus();
    eventBus.emitSync(
      createEvent(
        'learning:context-fused',
        {
          elements: rankedElements.length,
          actions: recommendedActions.length,
          confidence,
          duration: Date.now() - startTime,
        },
        'context-fusion',
        { priority: 'normal' },
      ),
    );

    logger.debug('Context fused', {
      elements: rankedElements.length,
      actions: recommendedActions.length,
      confidence,
      duration: Date.now() - startTime,
    });

    return fusedContext;
  }

  /**
   * Quick decision for an action
   */
  async quickDecide(input: FusionInput, goal?: string): Promise<RecommendedAction | null> {
    const context = await this.fuse({ ...input, currentGoal: goal });

    if (context.recommendedActions.length === 0) {
      return null;
    }

    // Return highest confidence action
    return context.recommendedActions[0];
  }

  /**
   * Update user preferences
   */
  setPreferences(preferences: Partial<UserPreferences>): void {
    this.userPreferences = { ...this.userPreferences, ...preferences };
    logger.info('User preferences updated', { preferences });
  }

  /**
   * Get current preferences
   */
  getPreferences(): UserPreferences {
    return { ...this.userPreferences };
  }

  /**
   * Add element preference
   */
  addElementPreference(elementPattern: string, weight: number): void {
    this.userPreferences.elementPreferences.set(elementPattern, weight);
  }

  /**
   * Clear context cache
   */
  clearCache(): void {
    this.contextCache.clear();
  }

  /**
   * Get recent insights
   */
  getRecentInsights(): ContextInsight[] {
    return [...this.recentInsights];
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  private getDefaultPreferences(): UserPreferences {
    return {
      interactionSpeed: 'normal',
      confirmationLevel: 'important',
      learnFromMistakes: true,
      proactiveSuggestions: true,
      elementPreferences: new Map(),
    };
  }

  private createCacheKey(input: FusionInput): string {
    return `${input.screen.screenState.timestamp}-${input.currentGoal || ''}-${input.recentActions?.length || 0}`;
  }

  private rankElements(input: FusionInput): RankedElement[] {
    const ranked: RankedElement[] = [];

    for (const element of input.screen.enhancedElements) {
      if (element.confidence < CONTEXT_FUSION_CONSTANTS.MIN_ELEMENT_CONFIDENCE) {
        continue;
      }

      const visualScore = this.calculateVisualScore(element, input.screen);
      const memoryScore = this.calculateMemoryScore(element, input.screen);
      const predictionScore = this.calculatePredictionScore(element, input.predictions);
      const feedbackScore = this.calculateFeedbackScore(element, input.adjustments);

      const relevanceScore =
        visualScore * CONTEXT_FUSION_CONSTANTS.VISUAL_WEIGHT +
        memoryScore * CONTEXT_FUSION_CONSTANTS.MEMORY_WEIGHT +
        predictionScore * CONTEXT_FUSION_CONSTANTS.PREDICTION_WEIGHT +
        feedbackScore * CONTEXT_FUSION_CONSTANTS.FEEDBACK_WEIGHT;

      const reasoning = this.generateElementReasoning(element, {
        visual: visualScore,
        memory: memoryScore,
        prediction: predictionScore,
        feedback: feedbackScore,
      });

      ranked.push({
        element,
        relevanceScore,
        scoreBreakdown: {
          visual: visualScore,
          memory: memoryScore,
          prediction: predictionScore,
          feedback: feedbackScore,
        },
        reasoning,
        suggestedAction: this.suggestActionForElement(element),
      });
    }

    // Sort by relevance
    ranked.sort((a, b) => b.relevanceScore - a.relevanceScore);

    return ranked;
  }

  private calculateVisualScore(element: EnhancedUIElement, screen: ScreenUnderstanding): number {
    let score = element.confidence;

    // Boost interactive elements
    if (element.isInteractive) {
      score += 0.2;
    }

    // Boost elements in focus areas
    const centerX = screen.screenState.dimensions.width / 2;
    const centerY = screen.screenState.dimensions.height / 2;
    const distanceFromCenter = Math.sqrt(
      Math.pow(element.bounds.x + element.bounds.width / 2 - centerX, 2) +
        Math.pow(element.bounds.y + element.bounds.height / 2 - centerY, 2),
    );
    const maxDistance = Math.sqrt(centerX * centerX + centerY * centerY);
    score += (1 - distanceFromCenter / maxDistance) * 0.1;

    // Boost elements with text
    if (element.text && element.text.length > 0) {
      score += 0.1;
    }

    return Math.min(1, score);
  }

  private calculateMemoryScore(element: EnhancedUIElement, screen: ScreenUnderstanding): number {
    let score = 0.5;

    // Check if this element type was used before
    const appContext = screen.applicationContext;
    if (appContext) {
      // Known good elements get boost
      if (element.semanticRole === 'button' || element.semanticRole === 'link') {
        score += 0.2;
      }
    }

    // Check user preferences
    const preferenceBoost = this.userPreferences.elementPreferences.get(element.type) || 0;
    score += preferenceBoost;

    return Math.min(1, Math.max(0, score));
  }

  private calculatePredictionScore(
    element: EnhancedUIElement,
    predictions?: ActionPrediction[],
  ): number {
    if (!predictions || predictions.length === 0) {
      return 0.5;
    }

    // Check if any prediction targets this element
    for (const prediction of predictions) {
      if (
        prediction.action.type === 'click' ||
        prediction.action.type === 'doubleClick'
      ) {
        const action = prediction.action as { x: number; y: number };
        const bounds = element.bounds;

        if (
          action.x >= bounds.x &&
          action.x <= bounds.x + bounds.width &&
          action.y >= bounds.y &&
          action.y <= bounds.y + bounds.height
        ) {
          return prediction.confidence;
        }
      }
    }

    return 0.3;
  }

  private calculateFeedbackScore(
    element: EnhancedUIElement,
    adjustments?: Map<string, LearningAdjustment[]>,
  ): number {
    if (!adjustments) {
      return 0.5;
    }

    // Check for adjustments matching this element
    const elementKey = element.text || element.type;
    const elementAdjustments = adjustments.get(elementKey);

    if (!elementAdjustments || elementAdjustments.length === 0) {
      return 0.5;
    }

    let score = 0.5;
    for (const adj of elementAdjustments) {
      switch (adj.type) {
        case 'confidence_boost':
          score += adj.magnitude;
          break;
        case 'confidence_penalty':
        case 'avoidance':
          score -= adj.magnitude;
          break;
      }
    }

    return Math.min(1, Math.max(0, score));
  }

  private generateElementReasoning(
    element: EnhancedUIElement,
    scores: { visual: number; memory: number; prediction: number; feedback: number },
  ): string[] {
    const reasoning: string[] = [];

    if (scores.visual > 0.7) {
      reasoning.push('Highly visible and prominent');
    }
    if (scores.memory > 0.7) {
      reasoning.push('Previously successful interactions');
    }
    if (scores.prediction > 0.7) {
      reasoning.push('Matches predicted action target');
    }
    if (scores.feedback > 0.7) {
      reasoning.push('Positive feedback history');
    }
    if (element.isInteractive) {
      reasoning.push('Interactive element');
    }
    if (element.text) {
      reasoning.push(`Contains text: "${element.text.slice(0, 20)}..."`);
    }

    return reasoning;
  }

  private suggestActionForElement(element: EnhancedUIElement): VMAction | undefined {
    const x = element.bounds.x + element.bounds.width / 2;
    const y = element.bounds.y + element.bounds.height / 2;

    if (element.type === 'button' || element.type === 'link') {
      return { type: 'click', x, y };
    }
    if (element.type === 'input') {
      return { type: 'click', x, y };
    }
    if (element.type === 'menu') {
      return { type: 'click', x, y };
    }

    return undefined;
  }

  private generateRecommendedActions(
    input: FusionInput,
    rankedElements: RankedElement[],
  ): RecommendedAction[] {
    const actions: RecommendedAction[] = [];

    // Add predictions
    if (input.predictions) {
      for (const pred of input.predictions.slice(0, 3)) {
        actions.push({
          action: pred.action,
          confidence: pred.confidence,
          reasoning: pred.reasoning,
          source: 'prediction',
          riskLevel: this.assessActionRisk(pred.action),
        });
      }
    }

    // Add task-based recommendations
    if (input.taskPlan && input.recentActions) {
      const nextStep = this.getNextTaskStep(input.taskPlan, input.recentActions);
      if (nextStep) {
        actions.push({
          action: nextStep.action,
          confidence: nextStep.confidence,
          reasoning: `Next step in task plan: ${nextStep.description}`,
          source: 'task',
          riskLevel: this.assessActionRisk(nextStep.action),
        });
      }
    }

    // Add element-based recommendations
    for (const ranked of rankedElements.slice(0, 3)) {
      if (ranked.suggestedAction && ranked.relevanceScore > 0.6) {
        actions.push({
          action: ranked.suggestedAction,
          confidence: ranked.relevanceScore,
          reasoning: ranked.reasoning.join('; '),
          source: 'fusion',
          targetElement: ranked.element,
          riskLevel: this.assessActionRisk(ranked.suggestedAction),
        });
      }
    }

    // Sort by confidence and deduplicate
    actions.sort((a, b) => b.confidence - a.confidence);

    // Remove duplicates
    const seen = new Set<string>();
    return actions.filter((a) => {
      const key = JSON.stringify(a.action);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private getNextTaskStep(
    taskPlan: TaskPlan,
    recentActions: VMAction[],
  ): PlannedStep | undefined {
    const completedCount = recentActions.length;
    if (completedCount >= taskPlan.steps.length) {
      return undefined;
    }
    return taskPlan.steps[completedCount];
  }

  private buildTaskContext(
    taskPlan: TaskPlan,
    recentActions?: VMAction[],
  ): TaskContext {
    const completedActions = recentActions || [];
    const currentStep = completedActions.length;
    const totalSteps = taskPlan.steps.length;
    const progress = totalSteps > 0 ? (currentStep / totalSteps) * 100 : 0;

    const expectedNextAction =
      currentStep < totalSteps ? taskPlan.steps[currentStep]?.action : undefined;

    return {
      taskName: taskPlan.goal,
      description: taskPlan.goal,
      currentStep,
      totalSteps,
      completedActions,
      expectedNextAction,
      progress,
    };
  }

  private assessRisk(actions: RecommendedAction[], input: FusionInput): RiskAssessment {
    const factors: RiskFactor[] = [];

    // Check for risky actions
    for (const action of actions) {
      if (action.action.type === 'type') {
        const text = action.action.text?.toLowerCase() || '';
        if (text.includes('password') || text.includes('secret') || text.includes('key')) {
          factors.push({
            type: 'sensitive_data',
            description: 'Typing potentially sensitive data',
            severity: 'high',
          });
        }
      }

      if (action.action.type === 'hotkey') {
        const keys = action.action.keys.map((k) => k.toLowerCase());
        if (keys.includes('delete') || keys.includes('ctrl+a')) {
          factors.push({
            type: 'destructive_action',
            description: 'Potentially destructive keyboard shortcut',
            severity: 'medium',
          });
        }
      }
    }

    // Check application context
    const appContext = input.screen.applicationContext;
    if (appContext?.type === 'browser') {
      // Banking or payment sites
      const url = appContext.metadata?.url?.toLowerCase() || '';
      if (url.includes('bank') || url.includes('payment') || url.includes('checkout')) {
        factors.push({
          type: 'financial',
          description: 'Operating on financial website',
          severity: 'high',
        });
      }
    }

    // Determine overall risk
    const severityOrder: RiskFactor['severity'][] = ['low', 'medium', 'high', 'critical'];
    const maxSeverity = factors.reduce(
      (max, f) => (severityOrder.indexOf(f.severity) > severityOrder.indexOf(max) ? f.severity : max),
      'low' as RiskFactor['severity'],
    );

    const requiresConfirmation =
      this.userPreferences.confirmationLevel === 'all' ||
      (this.userPreferences.confirmationLevel === 'important' && maxSeverity !== 'low');

    const mitigations: string[] = [];
    if (factors.some((f) => f.type === 'destructive_action')) {
      mitigations.push('Create checkpoint before executing');
    }
    if (factors.some((f) => f.type === 'financial')) {
      mitigations.push('Request user confirmation');
      mitigations.push('Double-check amounts');
    }

    return {
      overallRisk: maxSeverity,
      factors,
      requiresConfirmation,
      mitigations,
    };
  }

  private assessActionRisk(action: VMAction): 'low' | 'medium' | 'high' {
    switch (action.type) {
      case 'click':
      case 'scroll':
      case 'wait':
        return 'low';
      case 'type':
      case 'keyPress':
        return 'medium';
      case 'hotkey':
      case 'drag':
        return 'medium';
      default:
        return 'medium';
    }
  }

  private generateInsights(
    input: FusionInput,
    rankedElements: RankedElement[],
    recommendedActions: RecommendedAction[],
  ): ContextInsight[] {
    const insights: ContextInsight[] = [];

    // Low confidence warning
    if (recommendedActions.length > 0 && recommendedActions[0].confidence < 0.5) {
      insights.push({
        type: 'warning',
        message: 'Low confidence in recommended action. Consider requesting confirmation.',
        actionable: true,
        confidence: 0.9,
      });
    }

    // No interactive elements
    if (rankedElements.filter((e) => e.element.isInteractive).length === 0) {
      insights.push({
        type: 'warning',
        message: 'No interactive elements detected on screen.',
        actionable: false,
        confidence: 0.95,
      });
    }

    // Optimization suggestion
    if (input.recentActions && input.recentActions.length > 5) {
      const lastActions = input.recentActions.slice(-5);
      const hasRepeats = lastActions.some(
        (a, i) => i > 0 && JSON.stringify(a) === JSON.stringify(lastActions[i - 1]),
      );
      if (hasRepeats) {
        insights.push({
          type: 'optimization',
          message: 'Detected repeated actions. Consider creating a macro.',
          actionable: true,
          confidence: 0.7,
        });
      }
    }

    // Task progress
    if (input.taskPlan) {
      const progress = input.recentActions
        ? (input.recentActions.length / input.taskPlan.steps.length) * 100
        : 0;
      if (progress >= 80 && progress < 100) {
        insights.push({
          type: 'info',
          message: `Task nearly complete: ${Math.round(progress)}%`,
          actionable: false,
          confidence: 1,
        });
      }
    }

    // Store recent insights
    this.recentInsights = [...insights, ...this.recentInsights].slice(0, 20);

    return insights;
  }

  private calculateOverallConfidence(
    rankedElements: RankedElement[],
    recommendedActions: RecommendedAction[],
    taskContext?: TaskContext,
  ): number {
    let confidence = 0.5;

    // Element confidence
    if (rankedElements.length > 0) {
      const avgElementConfidence =
        rankedElements.reduce((sum, e) => sum + e.relevanceScore, 0) / rankedElements.length;
      confidence += avgElementConfidence * 0.2;
    }

    // Action confidence
    if (recommendedActions.length > 0) {
      confidence += recommendedActions[0].confidence * 0.2;
    }

    // Task context confidence
    if (taskContext) {
      confidence += 0.1; // Having a task plan increases confidence
      if (taskContext.expectedNextAction) {
        confidence += 0.05;
      }
    }

    return Math.min(1, confidence);
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let contextFusionInstance: ContextFusionEngine | null = null;

/**
 * Get the singleton context fusion engine
 */
export function getContextFusionEngine(): ContextFusionEngine {
  if (!contextFusionInstance) {
    contextFusionInstance = new ContextFusionEngine();
  }
  return contextFusionInstance;
}

/**
 * Reset context fusion engine (for testing)
 */
export function resetContextFusionEngine(): void {
  if (contextFusionInstance) {
    contextFusionInstance.clearCache();
    contextFusionInstance = null;
  }
}
