/**
 * Context Fusion Engine
 *
 * The brain that combines ALL sources of intelligence:
 * - Visual memory (what the page looks like)
 * - Website knowledge (what we know about this site)
 * - User preferences (how they usually work)
 * - Task context (what they're trying to do)
 * - Conversation history (what they've said)
 * - Predictive signals (what they'll do next)
 *
 * This fusion approach enables Atlas to make decisions that
 * consider ALL available context, unlike single-signal agents.
 *
 * @module agent/browser-agent/context-fusion
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../../utils/logger';
import { BrowserAction, BrowserState, IndexedElement, BrowserTask } from './types';
import { getVisualMemory, VisualSnapshot, PageStateClassification } from './visual-memory';
import { getWebsiteKnowledgeBase, WebsiteProfile, WorkflowPattern } from './website-knowledge';
import { getPredictiveEngine, ActionPrediction, TaskPlan } from './predictive-engine';
import { getParallelSpeculationEngine, SpeculationBranch } from './parallel-speculation';
import { getLLMManager } from '../../llm/manager';

const logger = createModuleLogger('ContextFusion');

// ============================================================================
// Types
// ============================================================================

export interface FusedContext {
  /** Context ID */
  id: string;
  /** Timestamp */
  timestamp: number;

  // Current state
  /** Current browser state */
  browserState: BrowserState;
  /** Visual classification */
  visualClassification: PageStateClassification | null;
  /** Site profile */
  siteProfile: WebsiteProfile | null;

  // Predictions
  /** Predicted next actions */
  predictedActions: ActionPrediction[];
  /** Task plan if available */
  taskPlan: TaskPlan | null;
  /** Speculation branches */
  speculationBranches: SpeculationBranch[];

  // Historical
  /** Recent actions */
  recentActions: BrowserAction[];
  /** Recent visual states */
  recentVisuals: VisualSnapshot[];
  /** Known workflows for this site */
  knownWorkflows: WorkflowPattern[];

  // User context
  /** User preferences */
  userPreferences: UserPreferences;
  /** Conversation context */
  conversationContext: ConversationContext;

  // Computed insights
  /** Confidence in understanding */
  confidence: number;
  /** Recommended action */
  recommendedAction: BrowserAction | null;
  /** Alternative actions */
  alternativeActions: BrowserAction[];
  /** Risk assessment */
  riskAssessment: RiskAssessment;
  /** Insights */
  insights: ContextInsight[];
}

export interface UserPreferences {
  /** Preferred interaction speed */
  interactionSpeed: 'slow' | 'normal' | 'fast';
  /** Prefers confirmation dialogs */
  prefersConfirmation: boolean;
  /** Commonly used sites */
  frequentSites: string[];
  /** Default form data */
  formDefaults: Record<string, string>;
  /** Accessibility needs */
  accessibilityNeeds: string[];
}

export interface ConversationContext {
  /** Current task description */
  currentTask: string | null;
  /** Recent user messages */
  recentMessages: string[];
  /** Extracted entities */
  entities: Record<string, string>;
  /** Sentiment */
  sentiment: 'positive' | 'neutral' | 'negative' | 'frustrated';
  /** Urgency level */
  urgency: 'low' | 'medium' | 'high';
}

export interface RiskAssessment {
  /** Overall risk level */
  level: 'low' | 'medium' | 'high' | 'critical';
  /** Risk factors */
  factors: RiskFactor[];
  /** Mitigations */
  mitigations: string[];
  /** Requires confirmation? */
  requiresConfirmation: boolean;
}

export interface RiskFactor {
  type: 'financial' | 'privacy' | 'security' | 'irreversible' | 'external' | 'timing';
  description: string;
  severity: number; // 1-10
}

export interface ContextInsight {
  type: 'opportunity' | 'warning' | 'suggestion' | 'pattern';
  message: string;
  confidence: number;
  actionable: boolean;
  suggestedAction?: BrowserAction;
}

export interface FusionConfig {
  /** Enable visual memory */
  enableVisualMemory: boolean;
  /** Enable site knowledge */
  enableSiteKnowledge: boolean;
  /** Enable prediction */
  enablePrediction: boolean;
  /** Enable speculation */
  enableSpeculation: boolean;
  /** Max history items */
  maxHistoryItems: number;
  /** LLM model for fusion reasoning */
  fusionModel: string;
  /** Risk threshold for auto-confirmation */
  riskThreshold: number;
}

// ============================================================================
// Default Config
// ============================================================================

const DEFAULT_FUSION_CONFIG: FusionConfig = {
  enableVisualMemory: true,
  enableSiteKnowledge: true,
  enablePrediction: true,
  enableSpeculation: true,
  maxHistoryItems: 10,
  fusionModel: 'accounts/fireworks/models/qwen3-235b-a22b',
  riskThreshold: 0.6,
};

// ============================================================================
// Context Fusion Engine
// ============================================================================

export class ContextFusionEngine extends EventEmitter {
  private config: FusionConfig;
  private visualMemory = getVisualMemory();
  private siteKnowledge = getWebsiteKnowledgeBase();
  private predictiveEngine = getPredictiveEngine();
  private speculationEngine = getParallelSpeculationEngine();
  private llmManager = getLLMManager();

  private actionHistory: BrowserAction[] = [];
  private userPreferences: UserPreferences = {
    interactionSpeed: 'normal',
    prefersConfirmation: true,
    frequentSites: [],
    formDefaults: {},
    accessibilityNeeds: [],
  };
  private conversationContext: ConversationContext = {
    currentTask: null,
    recentMessages: [],
    entities: {},
    sentiment: 'neutral',
    urgency: 'medium',
  };

  constructor(config: Partial<FusionConfig> = {}) {
    super();
    this.config = { ...DEFAULT_FUSION_CONFIG, ...config };
  }

  /**
   * Generate a fused context from current state
   */
  async fuse(
    state: BrowserState,
    currentTask?: BrowserTask
  ): Promise<FusedContext> {
    const startTime = Date.now();

    // Gather all context sources in parallel
    const [
      visualClassification,
      siteProfile,
      predictions,
      speculationBranches,
      recentVisuals,
    ] = await Promise.all([
      this.config.enableVisualMemory
        ? this.visualMemory.classifyPageState(state)
        : Promise.resolve(null),
      this.config.enableSiteKnowledge
        ? Promise.resolve(this.siteKnowledge.getProfile(state.url))
        : Promise.resolve(null),
      this.config.enablePrediction && this.actionHistory.length > 0
        ? this.predictiveEngine.predictNextActions(state, this.actionHistory)
        : Promise.resolve([]),
      this.config.enableSpeculation && this.actionHistory.length > 0
        ? Promise.resolve(this.speculationEngine.getActiveBranches())
        : Promise.resolve([]),
      this.config.enableVisualMemory
        ? Promise.resolve(this.visualMemory.getRecentSnapshots(5))
        : Promise.resolve([]),
    ]);

    // Get known workflows for this site
    const knownWorkflows = siteProfile?.workflows || [];

    // Compute recommended action
    const { recommendedAction, alternativeActions, confidence } = await this.computeRecommendedAction(
      state,
      predictions,
      speculationBranches,
      knownWorkflows,
      currentTask
    );

    // Assess risk
    const riskAssessment = this.assessRisk(state, recommendedAction);

    // Generate insights
    const insights = await this.generateInsights(
      state,
      visualClassification,
      siteProfile,
      predictions,
      riskAssessment
    );

    const fusedContext: FusedContext = {
      id: `context-${Date.now()}`,
      timestamp: Date.now(),
      browserState: state,
      visualClassification,
      siteProfile,
      predictedActions: predictions,
      taskPlan: currentTask ? await this.predictiveEngine.createTaskPlan(currentTask.goal, state) : null,
      speculationBranches,
      recentActions: this.actionHistory.slice(-this.config.maxHistoryItems),
      recentVisuals,
      knownWorkflows,
      userPreferences: this.userPreferences,
      conversationContext: this.conversationContext,
      confidence,
      recommendedAction,
      alternativeActions,
      riskAssessment,
      insights,
    };

    const fusionTime = Date.now() - startTime;
    logger.debug('Context fused', { fusionTimeMs: fusionTime, confidence });

    this.emit('context-fused', fusedContext);
    return fusedContext;
  }

  /**
   * Record an action
   */
  recordAction(action: BrowserAction): void {
    this.actionHistory.push(action);
    if (this.actionHistory.length > 100) {
      this.actionHistory.shift();
    }
  }

  /**
   * Update conversation context
   */
  updateConversation(update: Partial<ConversationContext>): void {
    this.conversationContext = { ...this.conversationContext, ...update };
  }

  /**
   * Update user preferences
   */
  updatePreferences(update: Partial<UserPreferences>): void {
    this.userPreferences = { ...this.userPreferences, ...update };
  }

  /**
   * Get quick decision without full fusion
   */
  async quickDecide(
    state: BrowserState,
    intent: string
  ): Promise<{ action: BrowserAction; confidence: number }> {
    // Check speculation cache first
    const lastAction = this.actionHistory[this.actionHistory.length - 1];
    if (lastAction) {
      const branch = this.speculationEngine.findMatchingBranch(state, lastAction);
      if (branch && branch.probability > 0.7) {
        return { action: branch.action, confidence: branch.probability };
      }
    }

    // Check known workflows
    const workflow = this.siteKnowledge.getWorkflowForIntent(state.url, intent);
    if (workflow && workflow.successRate > 0.8 && workflow.actions.length > 0) {
      const firstAction = workflow.actions[0];
      return {
        action: {
          type: firstAction.type as any,
          description: firstAction.targetDescription,
        },
        confidence: workflow.successRate,
      };
    }

    // Fall back to prediction
    const predictions = await this.predictiveEngine.predictNextActions(state, this.actionHistory);
    if (predictions.length > 0) {
      return {
        action: predictions[0].action,
        confidence: predictions[0].confidence,
      };
    }

    // No quick decision available
    return {
      action: { type: 'wait', condition: 'load', description: 'Waiting for more context' },
      confidence: 0.3,
    };
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private async computeRecommendedAction(
    state: BrowserState,
    predictions: ActionPrediction[],
    speculationBranches: SpeculationBranch[],
    workflows: WorkflowPattern[],
    task?: BrowserTask
  ): Promise<{
    recommendedAction: BrowserAction | null;
    alternativeActions: BrowserAction[];
    confidence: number;
  }> {
    const candidates: Array<{
      action: BrowserAction;
      source: string;
      confidence: number;
    }> = [];

    // Add predictions
    for (const pred of predictions) {
      candidates.push({
        action: pred.action,
        source: 'prediction',
        confidence: pred.confidence * 0.8,
      });
    }

    // Add speculation branches
    for (const branch of speculationBranches) {
      if (branch.status === 'ready') {
        candidates.push({
          action: branch.action,
          source: 'speculation',
          confidence: branch.probability * 0.9,
        });
      }
    }

    // Add workflow suggestions
    if (task && this.conversationContext.currentTask) {
      const matchingWorkflow = workflows.find(w =>
        this.conversationContext.currentTask?.toLowerCase().includes(w.triggerIntent)
      );
      if (matchingWorkflow && matchingWorkflow.actions.length > 0) {
        candidates.push({
          action: {
            type: matchingWorkflow.actions[0].type as any,
            description: matchingWorkflow.actions[0].targetDescription,
          },
          source: 'workflow',
          confidence: matchingWorkflow.successRate,
        });
      }
    }

    // Sort by confidence
    candidates.sort((a, b) => b.confidence - a.confidence);

    if (candidates.length === 0) {
      return {
        recommendedAction: null,
        alternativeActions: [],
        confidence: 0,
      };
    }

    return {
      recommendedAction: candidates[0].action,
      alternativeActions: candidates.slice(1, 4).map(c => c.action),
      confidence: candidates[0].confidence,
    };
  }

  private assessRisk(state: BrowserState, action: BrowserAction | null): RiskAssessment {
    const factors: RiskFactor[] = [];
    let maxSeverity = 0;

    // Check URL for sensitive pages
    const url = state.url.toLowerCase();

    if (url.includes('checkout') || url.includes('payment')) {
      factors.push({
        type: 'financial',
        description: 'On a payment page',
        severity: 8,
      });
      maxSeverity = Math.max(maxSeverity, 8);
    }

    if (url.includes('login') || url.includes('signin')) {
      factors.push({
        type: 'security',
        description: 'On authentication page',
        severity: 6,
      });
      maxSeverity = Math.max(maxSeverity, 6);
    }

    if (url.includes('delete') || url.includes('remove')) {
      factors.push({
        type: 'irreversible',
        description: 'Potentially destructive action',
        severity: 7,
      });
      maxSeverity = Math.max(maxSeverity, 7);
    }

    // Check action risk
    if (action) {
      if (action.type === 'click' && action.description?.toLowerCase().includes('submit')) {
        factors.push({
          type: 'irreversible',
          description: 'Form submission',
          severity: 5,
        });
        maxSeverity = Math.max(maxSeverity, 5);
      }

      if (action.type === 'click' && action.description?.toLowerCase().includes('buy')) {
        factors.push({
          type: 'financial',
          description: 'Purchase action',
          severity: 9,
        });
        maxSeverity = Math.max(maxSeverity, 9);
      }
    }

    // Check for sensitive elements on page
    const hasSensitiveInput = state.elements.some(e =>
      e.attributes?.type === 'password' ||
      e.attributes?.autocomplete === 'cc-number'
    );
    if (hasSensitiveInput) {
      factors.push({
        type: 'privacy',
        description: 'Sensitive input fields present',
        severity: 5,
      });
      maxSeverity = Math.max(maxSeverity, 5);
    }

    // Determine risk level
    let level: RiskAssessment['level'] = 'low';
    if (maxSeverity >= 8) level = 'critical';
    else if (maxSeverity >= 6) level = 'high';
    else if (maxSeverity >= 4) level = 'medium';

    // Generate mitigations
    const mitigations: string[] = [];
    if (level !== 'low') {
      mitigations.push('Request user confirmation');
      if (factors.some(f => f.type === 'financial')) {
        mitigations.push('Verify payment details');
      }
      if (factors.some(f => f.type === 'irreversible')) {
        mitigations.push('Create recovery checkpoint');
      }
    }

    return {
      level,
      factors,
      mitigations,
      requiresConfirmation: maxSeverity / 10 > this.config.riskThreshold,
    };
  }

  private async generateInsights(
    state: BrowserState,
    visual: PageStateClassification | null,
    profile: WebsiteProfile | null,
    predictions: ActionPrediction[],
    risk: RiskAssessment
  ): Promise<ContextInsight[]> {
    const insights: ContextInsight[] = [];

    // Visual state insights
    if (visual) {
      if (visual.isSuccessState) {
        insights.push({
          type: 'pattern',
          message: 'Page shows success indicators',
          confidence: visual.confidence,
          actionable: false,
        });
      }
      if (visual.hasError) {
        insights.push({
          type: 'warning',
          message: `Error detected: ${visual.errorMessage || 'Unknown error'}`,
          confidence: visual.confidence,
          actionable: true,
          suggestedAction: { type: 'screenshot', description: 'Capture error for analysis' },
        });
      }
      if (visual.hasForm && visual.formProgress && visual.formProgress < 1) {
        insights.push({
          type: 'opportunity',
          message: `Form is ${Math.round(visual.formProgress * 100)}% complete`,
          confidence: 0.9,
          actionable: true,
        });
      }
    }

    // Site knowledge insights
    if (profile) {
      if (profile.metrics.antiBotAggression > 7) {
        insights.push({
          type: 'warning',
          message: 'This site has aggressive anti-bot detection',
          confidence: 0.95,
          actionable: true,
        });
      }
      if (profile.quirks.length > 0) {
        insights.push({
          type: 'suggestion',
          message: `Known quirk: ${profile.quirks[0].description}`,
          confidence: 0.8,
          actionable: profile.quirks[0].workaround !== undefined,
        });
      }
      if (profile.auth.hasLogin && !profile.auth.loginSelectors) {
        insights.push({
          type: 'opportunity',
          message: 'Login pattern not yet learned for this site',
          confidence: 0.7,
          actionable: false,
        });
      }
    }

    // Prediction insights
    if (predictions.length > 0) {
      const topPrediction = predictions[0];
      if (topPrediction.confidence > 0.8) {
        insights.push({
          type: 'suggestion',
          message: `High confidence next action: ${topPrediction.action.description || topPrediction.action.type}`,
          confidence: topPrediction.confidence,
          actionable: true,
          suggestedAction: topPrediction.action,
        });
      }
    }

    // Risk insights
    for (const factor of risk.factors) {
      if (factor.severity >= 7) {
        insights.push({
          type: 'warning',
          message: factor.description,
          confidence: 0.95,
          actionable: true,
        });
      }
    }

    return insights;
  }
}

// ============================================================================
// Singleton Factory
// ============================================================================

let fusionEngineInstance: ContextFusionEngine | null = null;

export function getContextFusionEngine(): ContextFusionEngine {
  if (!fusionEngineInstance) {
    fusionEngineInstance = new ContextFusionEngine();
  }
  return fusionEngineInstance;
}

export function createContextFusionEngine(config?: Partial<FusionConfig>): ContextFusionEngine {
  return new ContextFusionEngine(config);
}
