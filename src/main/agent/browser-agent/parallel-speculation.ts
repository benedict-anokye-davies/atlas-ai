/**
 * Parallel Speculation Engine
 *
 * Pre-computes likely next actions while current action executes.
 * This gives Atlas massive latency advantages over sequential agents.
 *
 * Architecture:
 * - Main thread executes current action
 * - Speculation worker prepares next probable actions in parallel
 * - When action completes, speculated results are ready immediately
 * - Cache hits mean instant responses instead of LLM round-trips
 *
 * @module agent/browser-agent/parallel-speculation
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../../utils/logger';
import { ActionIntent, BrowserAction, BrowserState, IndexedElement } from './types';

const logger = createModuleLogger('ParallelSpeculation');

// ============================================================================
// Types
// ============================================================================

export interface SpeculationBranch {
  /** Branch ID */
  id: string;
  /** Triggering condition */
  condition: SpeculationCondition;
  /** Pre-computed action intent */
  action: ActionIntent;
  /** Pre-computed element match */
  elementMatch?: PrecomputedMatch;
  /** Pre-rendered prompt (for LLM) */
  preRenderedPrompt?: string;
  /** Probability this branch is taken */
  probability: number;
  /** Status */
  status: 'pending' | 'computing' | 'ready' | 'invalidated';
  /** Created at */
  createdAt: number;
  /** Ready at */
  readyAt?: number;
}

export interface SpeculationCondition {
  /** Type of condition */
  type: 'action-complete' | 'page-load' | 'element-visible' | 'url-match' | 'text-match';
  /** Action type that triggers this */
  afterAction?: string;
  /** URL pattern */
  urlPattern?: string;
  /** Element selector to watch */
  elementSelector?: string;
  /** Text to match */
  textPattern?: string;
}

export interface PrecomputedMatch {
  /** Element index */
  elementIndex: number;
  /** Selector */
  selector: string;
  /** Confidence */
  confidence: number;
  /** Alternative matches */
  alternatives: Array<{ index: number; confidence: number }>;
}

export interface SpeculationResult {
  /** Branch ID */
  branchId: string;
  /** Was this branch used? */
  used: boolean;
  /** Time saved by speculation (ms) */
  timeSavedMs: number;
  /** Was the speculation correct? */
  correct: boolean;
}

export interface SpeculationConfig {
  /** Max concurrent branches */
  maxBranches: number;
  /** Max speculation depth */
  maxDepth: number;
  /** Min probability to speculate */
  minProbability: number;
  /** Branch TTL (ms) */
  branchTtlMs: number;
  /** Enable pre-rendering LLM prompts */
  preRenderPrompts: boolean;
  /** Enable element pre-matching */
  preMatchElements: boolean;
}

export interface SpeculationStats {
  /** Total branches created */
  totalBranches: number;
  /** Branches used */
  branchesUsed: number;
  /** Hit rate */
  hitRate: number;
  /** Total time saved */
  totalTimeSavedMs: number;
  /** Average time saved per hit */
  avgTimeSavedMs: number;
}

// ============================================================================
// Default Config
// ============================================================================

const DEFAULT_CONFIG: SpeculationConfig = {
  maxBranches: 5,
  maxDepth: 3,
  minProbability: 0.3,
  branchTtlMs: 30000,
  preRenderPrompts: true,
  preMatchElements: true,
};

// ============================================================================
// Parallel Speculation Engine
// ============================================================================

export class ParallelSpeculationEngine extends EventEmitter {
  private config: SpeculationConfig;
  private branches: Map<string, SpeculationBranch> = new Map();
  private stats: SpeculationStats = {
    totalBranches: 0,
    branchesUsed: 0,
    hitRate: 0,
    totalTimeSavedMs: 0,
    avgTimeSavedMs: 0,
  };
  private cleanupInterval: NodeJS.Timeout | null = null;
  private currentSpeculationDepth: number = 0;

  constructor(config: Partial<SpeculationConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.startCleanupTimer();
  }

  /**
   * Start speculation based on current state and action
   */
  async speculate(
    state: BrowserState,
    currentAction: BrowserAction,
    actionHistory: BrowserAction[],
    onBranchReady?: (branch: SpeculationBranch) => void
  ): Promise<SpeculationBranch[]> {
    if (this.currentSpeculationDepth >= this.config.maxDepth) {
      return [];
    }

    this.currentSpeculationDepth++;

    try {
      // Predict likely next actions
      const predictions = await this.predictNextActions(state, currentAction, actionHistory);

      // Filter by probability threshold
      const likelyActions = predictions.filter(p => p.probability >= this.config.minProbability);

      // Create speculation branches (up to max)
      const branches: SpeculationBranch[] = [];
      const branchesToCreate = likelyActions.slice(0, this.config.maxBranches - this.branches.size);

      for (const prediction of branchesToCreate) {
        const branch = await this.createBranch(prediction, state, currentAction);
        branches.push(branch);
        this.branches.set(branch.id, branch);
        this.stats.totalBranches++;

        if (onBranchReady) {
          // Start computing the branch
          this.computeBranch(branch, state).then(() => {
            onBranchReady(branch);
          });
        }
      }

      return branches;
    } finally {
      this.currentSpeculationDepth--;
    }
  }

  /**
   * Check if a speculated branch matches current state
   */
  findMatchingBranch(state: BrowserState, lastAction: BrowserAction): SpeculationBranch | null {
    for (const branch of this.branches.values()) {
      if (branch.status !== 'ready') continue;

      if (this.conditionMatches(branch.condition, state, lastAction)) {
        return branch;
      }
    }
    return null;
  }

  /**
   * Use a speculated branch
   */
  useBranch(branchId: string, actualTimeSavedMs: number): SpeculationResult {
    const branch = this.branches.get(branchId);
    
    if (!branch) {
      return {
        branchId,
        used: false,
        timeSavedMs: 0,
        correct: false,
      };
    }

    this.stats.branchesUsed++;
    this.stats.totalTimeSavedMs += actualTimeSavedMs;
    this.stats.hitRate = this.stats.branchesUsed / this.stats.totalBranches;
    this.stats.avgTimeSavedMs = this.stats.totalTimeSavedMs / this.stats.branchesUsed;

    // Remove used branch
    this.branches.delete(branchId);

    // Emit success event
    this.emit('branch-used', { branchId, timeSavedMs: actualTimeSavedMs });

    return {
      branchId,
      used: true,
      timeSavedMs: actualTimeSavedMs,
      correct: true,
    };
  }

  /**
   * Invalidate speculation branches
   */
  invalidate(reason: 'page-change' | 'action-failed' | 'state-change' | 'timeout'): void {
    let invalidated = 0;

    for (const [id, branch] of this.branches) {
      if (branch.status === 'ready' || branch.status === 'computing') {
        branch.status = 'invalidated';
        this.branches.delete(id);
        invalidated++;
      }
    }

    if (invalidated > 0) {
      logger.debug('Invalidated branches', { reason, count: invalidated });
    }
  }

  /**
   * Get current speculation stats
   */
  getStats(): SpeculationStats {
    return { ...this.stats };
  }

  /**
   * Get active branches
   */
  getActiveBranches(): SpeculationBranch[] {
    return Array.from(this.branches.values()).filter(b => b.status !== 'invalidated');
  }

  // ============================================================================
  // Prediction Logic
  // ============================================================================

  private async predictNextActions(
    state: BrowserState,
    currentAction: BrowserAction,
    actionHistory: BrowserAction[]
  ): Promise<Array<{ action: BrowserAction; probability: number; condition: SpeculationCondition }>> {
    const predictions: Array<{
      action: BrowserAction;
      probability: number;
      condition: SpeculationCondition;
    }> = [];

    // Pattern-based predictions
    const patternPredictions = this.predictFromPatterns(state, currentAction, actionHistory);
    predictions.push(...patternPredictions);

    // Context-based predictions
    const contextPredictions = this.predictFromContext(state, currentAction);
    predictions.push(...contextPredictions);

    // Sort by probability and dedupe
    predictions.sort((a, b) => b.probability - a.probability);
    
    return this.deduplicatePredictions(predictions);
  }

  private predictFromPatterns(
    state: BrowserState,
    currentAction: BrowserAction,
    actionHistory: BrowserAction[]
  ): Array<{ action: BrowserAction; probability: number; condition: SpeculationCondition }> {
    const predictions: Array<{
      action: BrowserAction;
      probability: number;
      condition: SpeculationCondition;
    }> = [];

    // Common patterns
    const patterns = this.getCommonPatterns();

    for (const pattern of patterns) {
      if (pattern.trigger(currentAction, actionHistory)) {
        predictions.push({
          action: pattern.nextAction(state),
          probability: pattern.probability,
          condition: pattern.condition,
        });
      }
    }

    return predictions;
  }

  private predictFromContext(
    state: BrowserState,
    currentAction: BrowserAction
  ): Array<{ action: BrowserAction; probability: number; condition: SpeculationCondition }> {
    const predictions: Array<{
      action: BrowserAction;
      probability: number;
      condition: SpeculationCondition;
    }> = [];

    const url = state.url.toLowerCase();

    // Login page - after typing password, likely to click submit
    if (currentAction.type === 'type' && url.includes('login')) {
      const submitBtn = state.elements.find(e =>
        e.tagName === 'button' && e.semanticPurpose === 'submit-button'
      );

      if (submitBtn) {
        predictions.push({
          action: {
            type: 'click',
            elementIndex: submitBtn.index,
            description: 'Click login button',
          },
          probability: 0.8,
          condition: { type: 'action-complete', afterAction: 'type' },
        });
      }
    }

    // Search page - after clicking result, likely to extract data
    if (currentAction.type === 'click' && url.includes('search')) {
      predictions.push({
        action: {
          type: 'extract',
          description: 'Extract page content',
        },
        probability: 0.6,
        condition: { type: 'page-load' },
      });
    }

    // E-commerce - after add to cart, likely to view cart or continue shopping
    if (currentAction.type === 'click' && currentAction.description?.toLowerCase().includes('cart')) {
      predictions.push({
        action: {
          type: 'navigate',
          url: '/cart',
          description: 'Go to cart',
        },
        probability: 0.5,
        condition: { type: 'action-complete', afterAction: 'click' },
      });
    }

    // After navigation, likely to wait for load
    if (currentAction.type === 'navigate') {
      predictions.push({
        action: {
          type: 'wait',
          condition: 'load',
          description: 'Wait for page load',
        },
        probability: 0.9,
        condition: { type: 'action-complete', afterAction: 'navigate' },
      });
    }

    return predictions;
  }

  private getCommonPatterns(): Array<{
    trigger: (current: BrowserAction, history: BrowserAction[]) => boolean;
    nextAction: (state: BrowserState) => BrowserAction;
    probability: number;
    condition: SpeculationCondition;
  }> {
    return [
      // After search, click first result
      {
        trigger: (current) => current.type === 'type' && current.description?.includes('search'),
        nextAction: (state) => {
          const result = state.elements.find(e =>
            e.tagName === 'a' && e.semanticPurpose === 'content-link'
          );
          return {
            type: 'click',
            elementIndex: result?.index || 0,
            description: 'Click first search result',
          };
        },
        probability: 0.7,
        condition: { type: 'action-complete', afterAction: 'type' },
      },

      // After form submission, wait for response
      {
        trigger: (current) => current.type === 'click' && current.description?.includes('submit'),
        nextAction: () => ({
          type: 'wait',
          condition: 'network',
          description: 'Wait for form response',
        }),
        probability: 0.85,
        condition: { type: 'action-complete', afterAction: 'click' },
      },

      // After scroll, extract visible content
      {
        trigger: (current) => current.type === 'scroll',
        nextAction: () => ({
          type: 'extract',
          description: 'Extract newly visible content',
        }),
        probability: 0.4,
        condition: { type: 'action-complete', afterAction: 'scroll' },
      },
    ];
  }

  // ============================================================================
  // Branch Management
  // ============================================================================

  private async createBranch(
    prediction: { action: BrowserAction; probability: number; condition: SpeculationCondition },
    state: BrowserState,
    triggerAction: BrowserAction
  ): Promise<SpeculationBranch> {
    const branch: SpeculationBranch = {
      id: `branch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      condition: prediction.condition,
      action: prediction.action,
      probability: prediction.probability,
      status: 'pending',
      createdAt: Date.now(),
    };

    return branch;
  }

  private async computeBranch(branch: SpeculationBranch, state: BrowserState): Promise<void> {
    branch.status = 'computing';

    try {
      // Pre-match element if action targets one
      if (this.config.preMatchElements && 'elementIndex' in branch.action) {
        branch.elementMatch = await this.precomputeElementMatch(branch.action, state);
      }

      // Pre-render LLM prompt if enabled
      if (this.config.preRenderPrompts) {
        branch.preRenderedPrompt = this.preRenderPrompt(branch.action, state);
      }

      branch.status = 'ready';
      branch.readyAt = Date.now();

      logger.debug('Branch ready', {
        id: branch.id,
        action: branch.action.type,
        computeTimeMs: branch.readyAt - branch.createdAt,
      });
    } catch (error) {
      branch.status = 'invalidated';
      logger.error('Branch computation failed', { id: branch.id, error });
    }
  }

  private async precomputeElementMatch(
    action: BrowserAction,
    state: BrowserState
  ): Promise<PrecomputedMatch | undefined> {
    if (!('elementIndex' in action) || action.elementIndex === undefined) {
      return undefined;
    }

    const targetElement = state.elements.find(e => e.index === action.elementIndex);
    if (!targetElement) return undefined;

    // Find similar elements as alternatives
    const alternatives = state.elements
      .filter(e => e.index !== action.elementIndex && e.tagName === targetElement.tagName)
      .map(e => ({
        index: e.index,
        confidence: this.calculateElementSimilarity(targetElement, e),
      }))
      .filter(a => a.confidence > 0.5)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 3);

    return {
      elementIndex: action.elementIndex,
      selector: targetElement.selector || '',
      confidence: 1.0,
      alternatives,
    };
  }

  private calculateElementSimilarity(a: IndexedElement, b: IndexedElement): number {
    let score = 0;

    if (a.tagName === b.tagName) score += 0.3;
    if (a.role === b.role) score += 0.2;
    if (a.semanticPurpose === b.semanticPurpose) score += 0.3;
    if (a.text?.slice(0, 20) === b.text?.slice(0, 20)) score += 0.2;

    return score;
  }

  private preRenderPrompt(action: BrowserAction, state: BrowserState): string {
    // Create a prompt template that can be quickly filled in
    const actionDescription = action.description || action.type;

    return `
Action: ${action.type}
Description: ${actionDescription}
Current URL: ${state.url}
Page Title: ${state.title}
Elements Available: ${state.elements.length}

Based on the current page state, ${actionDescription.toLowerCase()}.
`.trim();
  }

  // ============================================================================
  // Condition Matching
  // ============================================================================

  private conditionMatches(
    condition: SpeculationCondition,
    state: BrowserState,
    lastAction: BrowserAction
  ): boolean {
    switch (condition.type) {
      case 'action-complete':
        return lastAction.type === condition.afterAction;

      case 'page-load':
        return true; // Assume page has loaded

      case 'url-match':
        return condition.urlPattern
          ? new RegExp(condition.urlPattern).test(state.url)
          : false;

      case 'element-visible':
        return condition.elementSelector
          ? state.elements.some(e => e.selector === condition.elementSelector)
          : false;

      case 'text-match':
        return condition.textPattern
          ? state.elements.some(e => e.text?.includes(condition.textPattern || ''))
          : false;

      default:
        return false;
    }
  }

  // ============================================================================
  // Utilities
  // ============================================================================

  private deduplicatePredictions(
    predictions: Array<{ action: BrowserAction; probability: number; condition: SpeculationCondition }>
  ): Array<{ action: BrowserAction; probability: number; condition: SpeculationCondition }> {
    const seen = new Set<string>();
    return predictions.filter(p => {
      const key = `${p.action.type}:${p.action.description || ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private startCleanupTimer(): void {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [id, branch] of this.branches) {
        if (now - branch.createdAt > this.config.branchTtlMs) {
          branch.status = 'invalidated';
          this.branches.delete(id);
        }
      }
    }, 5000);
  }

  /**
   * Cleanup
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.branches.clear();
  }
}

// ============================================================================
// Singleton Factory
// ============================================================================

let speculationEngineInstance: ParallelSpeculationEngine | null = null;

export function getParallelSpeculationEngine(): ParallelSpeculationEngine {
  if (!speculationEngineInstance) {
    speculationEngineInstance = new ParallelSpeculationEngine();
  }
  return speculationEngineInstance;
}

export function createParallelSpeculationEngine(
  config?: Partial<SpeculationConfig>
): ParallelSpeculationEngine {
  return new ParallelSpeculationEngine(config);
}
