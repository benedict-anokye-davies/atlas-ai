/**
 * Predictive Engine
 *
 * Anticipates user intent and pre-computes likely actions before they're needed.
 * This is a key differentiator from Claude for Chrome which only reacts step-by-step.
 *
 * Features:
 * - Action prediction based on task context
 * - Speculative execution for likely next steps
 * - Page structure analysis for optimal paths
 * - Pattern learning from successful task completions
 *
 * @module agent/browser-agent/predictive-engine
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { createModuleLogger } from '../../utils/logger';
import { getLLMManager } from '../../llm/manager';
import { BrowserState, BrowserAction, IndexedElement, BrowserTask, SemanticPurpose } from './types';

const logger = createModuleLogger('PredictiveEngine');

// ============================================================================
// Prediction Types
// ============================================================================

export interface ActionPrediction {
  /** Predicted action */
  action: BrowserAction;
  /** Confidence score 0-1 */
  confidence: number;
  /** Why this action was predicted */
  reasoning: string;
  /** Predicted outcome */
  expectedOutcome: string;
  /** Pre-computed element info if available */
  targetElement?: IndexedElement;
  /** Whether this has been speculatively verified */
  verified: boolean;
}

export interface TaskPlan {
  /** High-level plan steps */
  steps: PlanStep[];
  /** Estimated total actions */
  estimatedActions: number;
  /** Predicted success probability */
  successProbability: number;
  /** Potential blockers identified */
  potentialBlockers: string[];
  /** Alternative approaches if primary fails */
  fallbackStrategies: string[];
}

export interface PlanStep {
  /** Step description */
  description: string;
  /** Type of interaction required */
  interactionType: 'navigate' | 'form-fill' | 'click-sequence' | 'search' | 'extract' | 'wait';
  /** Estimated actions for this step */
  estimatedActions: number;
  /** Required elements (if known) */
  requiredElements?: SemanticPurpose[];
  /** Dependencies on previous steps */
  dependsOn: number[];
}

export interface PagePattern {
  /** URL pattern (regex or glob) */
  urlPattern: string;
  /** Domain */
  domain: string;
  /** Recognized page type */
  pageType: PageType;
  /** Known interaction patterns */
  interactionPatterns: InteractionPattern[];
  /** Common form fields */
  formFields?: FormFieldPattern[];
  /** Last updated */
  lastUpdated: number;
  /** Times encountered */
  encounters: number;
}

export type PageType =
  | 'login'
  | 'signup'
  | 'search-results'
  | 'product-listing'
  | 'product-detail'
  | 'checkout'
  | 'cart'
  | 'form'
  | 'article'
  | 'dashboard'
  | 'settings'
  | 'profile'
  | 'landing'
  | 'error'
  | 'unknown';

export interface InteractionPattern {
  /** Pattern name */
  name: string;
  /** Selector or description for trigger element */
  triggerSelector: string;
  /** What happens after interaction */
  outcome: string;
  /** Success rate from past attempts */
  successRate: number;
  /** Average time to complete */
  avgDurationMs: number;
}

export interface FormFieldPattern {
  /** Field semantic type */
  fieldType: 'email' | 'password' | 'username' | 'name' | 'address' | 'phone' | 'search' | 'other';
  /** Common selectors for this field */
  selectors: string[];
  /** Value source (user data, generated, etc.) */
  valueSource: 'user-data' | 'context' | 'generated';
}

// ============================================================================
// Prediction Prompts
// ============================================================================

const PREDICTION_PROMPT = `You are an expert at predicting user actions on web pages.

Given the current task, browser state, and history, predict the NEXT 3 most likely actions the user will need to take.

Task: {objective}
Current Step Goal: {currentGoal}
Steps Completed: {stepsCompleted}

Current Page:
URL: {url}
Title: {title}

Available Interactive Elements:
{elements}

Previous Actions:
{history}

For each predicted action, provide:
1. The exact action type and parameters
2. Your confidence (0-1)
3. Why you predict this action
4. What should happen after

Respond in JSON:
{
  "predictions": [
    {
      "action": { "type": "click", "elementIndex": 5, "description": "Click search button" },
      "confidence": 0.9,
      "reasoning": "After typing a query, the next step is usually to submit the search",
      "expectedOutcome": "Search results will appear"
    }
  ],
  "pageAnalysis": {
    "pageType": "search-results",
    "primaryCTA": 5,
    "potentialBlockers": ["cookie consent popup"],
    "formFields": []
  }
}`;

const PLAN_DECOMPOSITION_PROMPT = `Decompose this task into a detailed execution plan.

Task: {objective}
{instructions}

Starting Page:
URL: {url}
Page Type: {pageType}

Consider:
1. What major steps are needed?
2. What could go wrong at each step?
3. What's the optimal order of operations?
4. Are there any authentication requirements?
5. What data needs to be extracted or entered?

Respond in JSON:
{
  "steps": [
    {
      "description": "Navigate to login page",
      "interactionType": "navigate",
      "estimatedActions": 1,
      "requiredElements": ["login"],
      "dependsOn": []
    }
  ],
  "estimatedActions": 10,
  "successProbability": 0.85,
  "potentialBlockers": ["CAPTCHA on login", "Two-factor authentication"],
  "fallbackStrategies": ["Use saved session", "Try alternative login method"]
}`;

// ============================================================================
// Predictive Engine
// ============================================================================

export class PredictiveEngine extends EventEmitter {
  private pagePatterns: Map<string, PagePattern> = new Map();
  private actionHistory: BrowserAction[] = [];
  private predictionCache: Map<string, ActionPrediction[]> = new Map();
  private successfulSequences: BrowserAction[][] = [];

  constructor() {
    super();
    this.loadPatterns();
  }

  /**
   * Generate predictions for next actions
   */
  async predictNextActions(
    task: BrowserTask,
    state: BrowserState,
    currentGoal: string,
    stepsCompleted: number
  ): Promise<ActionPrediction[]> {
    // Check cache first
    const cacheKey = this.getCacheKey(state, currentGoal);
    const cached = this.predictionCache.get(cacheKey);
    if (cached) {
      logger.debug('Using cached predictions');
      return cached;
    }

    // Use pattern matching for known pages
    const pagePattern = this.matchPagePattern(state.url);
    if (pagePattern) {
      const patternPredictions = this.predictFromPattern(pagePattern, state, currentGoal);
      if (patternPredictions.length > 0) {
        logger.debug('Using pattern-based predictions', { pattern: pagePattern.pageType });
        this.predictionCache.set(cacheKey, patternPredictions);
        return patternPredictions;
      }
    }

    // Fall back to LLM prediction
    const predictions = await this.predictWithLLM(task, state, currentGoal, stepsCompleted);
    this.predictionCache.set(cacheKey, predictions);

    return predictions;
  }

  /**
   * Create a task execution plan
   */
  async createTaskPlan(
    objective: string,
    instructions: string | undefined,
    state: BrowserState
  ): Promise<TaskPlan> {
    const pageType = this.inferPageType(state);

    try {
      const llm = getLLMManager();
      const prompt = PLAN_DECOMPOSITION_PROMPT.replace('{objective}', objective)
        .replace('{instructions}', instructions || '')
        .replace('{url}', state.url)
        .replace('{pageType}', pageType);

      const response = await llm.generateWithTools([{ role: 'user', content: prompt }], [], {
        model: 'accounts/fireworks/models/qwen3-235b-a22b',
        temperature: 0.2,
        maxTokens: 2000,
      });

      const plan = this.parsePlanResponse(response.content);
      logger.info('Created task plan', {
        steps: plan.steps.length,
        estimatedActions: plan.estimatedActions,
        successProbability: plan.successProbability,
      });

      return plan;
    } catch (error) {
      logger.error('Failed to create task plan', error);
      return this.createDefaultPlan(objective);
    }
  }

  /**
   * Pre-compute likely element targets before they're needed
   */
  async speculativeGrounding(
    predictions: ActionPrediction[],
    state: BrowserState
  ): Promise<ActionPrediction[]> {
    const enhanced: ActionPrediction[] = [];

    for (const prediction of predictions) {
      if (prediction.action.type === 'click' && 'elementIndex' in prediction.action) {
        const elementIndex = prediction.action.elementIndex;
        const element = state.elements.find((e) => e.index === elementIndex);

        if (element) {
          enhanced.push({
            ...prediction,
            targetElement: element,
            verified: element.interactivity.isClickable,
          });
        } else {
          // Try to find element by description
          const matchedElement = this.findElementByDescription(
            prediction.action.description || '',
            state.elements
          );

          if (matchedElement) {
            enhanced.push({
              ...prediction,
              action: {
                ...prediction.action,
                elementIndex: matchedElement.index,
              },
              targetElement: matchedElement,
              verified: true,
            });
          } else {
            enhanced.push({ ...prediction, verified: false });
          }
        }
      } else {
        enhanced.push({ ...prediction, verified: true });
      }
    }

    return enhanced;
  }

  /**
   * Learn from successful action sequences
   */
  recordSuccess(actions: BrowserAction[]): void {
    if (actions.length >= 2) {
      this.successfulSequences.push([...actions]);
      // Keep only last 100 sequences
      if (this.successfulSequences.length > 100) {
        this.successfulSequences.shift();
      }
    }
  }

  /**
   * Learn page patterns from interactions
   */
  learnPagePattern(url: string, state: BrowserState, successfulActions: BrowserAction[]): void {
    const domain = new URL(url).hostname;
    const pageType = this.inferPageType(state);
    const patternKey = `${domain}:${pageType}`;

    const existing = this.pagePatterns.get(patternKey);

    if (existing) {
      existing.encounters++;
      existing.lastUpdated = Date.now();

      // Add new interaction patterns
      for (const action of successfulActions) {
        const existingPattern = existing.interactionPatterns.find(
          (p) => p.name === action.description
        );
        if (existingPattern) {
          existingPattern.successRate = existingPattern.successRate * 0.9 + 0.1; // Weighted average
        } else {
          existing.interactionPatterns.push({
            name: action.description,
            triggerSelector:
              'elementIndex' in action && action.elementIndex
                ? state.elements.find((e) => e.index === action.elementIndex)?.selector || ''
                : '',
            outcome: '',
            successRate: 1.0,
            avgDurationMs: 0,
          });
        }
      }
    } else {
      this.pagePatterns.set(patternKey, {
        urlPattern: this.createUrlPattern(url),
        domain,
        pageType,
        interactionPatterns: successfulActions.map((action) => ({
          name: action.description,
          triggerSelector: '',
          outcome: '',
          successRate: 1.0,
          avgDurationMs: 0,
        })),
        lastUpdated: Date.now(),
        encounters: 1,
      });
    }

    this.savePatterns();
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private async predictWithLLM(
    task: BrowserTask,
    state: BrowserState,
    currentGoal: string,
    stepsCompleted: number
  ): Promise<ActionPrediction[]> {
    try {
      const llm = getLLMManager();

      const elementsStr = state.elements
        .filter((e) => e.interactivity.isClickable || e.interactivity.isTypeable)
        .slice(0, 50)
        .map(
          (e) =>
            `[${e.index}] ${e.role}: "${e.text || e.ariaLabel || e.attributes.placeholder || ''}"`
        )
        .join('\n');

      const historyStr = this.actionHistory
        .slice(-5)
        .map((a, i) => `${i + 1}. ${a.type}: ${a.description}`)
        .join('\n');

      const prompt = PREDICTION_PROMPT.replace('{objective}', task.objective)
        .replace('{currentGoal}', currentGoal)
        .replace('{stepsCompleted}', String(stepsCompleted))
        .replace('{url}', state.url)
        .replace('{title}', state.title)
        .replace('{elements}', elementsStr)
        .replace('{history}', historyStr || 'None yet');

      const response = await llm.generateWithTools([{ role: 'user', content: prompt }], [], {
        model: 'accounts/fireworks/models/qwen3-235b-a22b',
        temperature: 0.3,
        maxTokens: 1500,
      });

      return this.parsePredictionResponse(response.content);
    } catch (error) {
      logger.error('LLM prediction failed', error);
      return [];
    }
  }

  private predictFromPattern(
    pattern: PagePattern,
    state: BrowserState,
    currentGoal: string
  ): ActionPrediction[] {
    const predictions: ActionPrediction[] = [];
    const goalLower = currentGoal.toLowerCase();

    // Match goal to known interaction patterns
    for (const interaction of pattern.interactionPatterns) {
      if (goalLower.includes(interaction.name.toLowerCase())) {
        const element = state.elements.find(
          (e) =>
            e.selector === interaction.triggerSelector ||
            e.text?.toLowerCase().includes(interaction.name.toLowerCase())
        );

        if (element) {
          predictions.push({
            action: {
              type: 'click',
              clickType: 'single',
              description: interaction.name,
              elementIndex: element.index,
            },
            confidence: Math.min(0.9, interaction.successRate),
            reasoning: `Pattern match from ${pattern.encounters} previous encounters`,
            expectedOutcome: interaction.outcome || 'Action completed',
            targetElement: element,
            verified: true,
          });
        }
      }
    }

    // Handle common page types
    if (pattern.pageType === 'login' && goalLower.includes('login')) {
      const usernameField = state.elements.find(
        (e) =>
          e.semanticPurpose === 'login' && (e.role === 'textbox' || e.attributes.type === 'email')
      );
      const passwordField = state.elements.find((e) => e.attributes.type === 'password');
      const submitBtn = state.elements.find(
        (e) =>
          e.semanticPurpose === 'submit' ||
          e.text?.toLowerCase().includes('log in') ||
          e.text?.toLowerCase().includes('sign in')
      );

      if (usernameField) {
        predictions.push({
          action: {
            type: 'type',
            text: '', // Will be filled by orchestrator
            description: 'Enter username/email',
            elementIndex: usernameField.index,
          },
          confidence: 0.95,
          reasoning: 'Login form detected - enter credentials',
          expectedOutcome: 'Username field populated',
          targetElement: usernameField,
          verified: true,
        });
      }

      if (passwordField) {
        predictions.push({
          action: {
            type: 'type',
            text: '',
            description: 'Enter password',
            elementIndex: passwordField.index,
            sensitive: true,
          },
          confidence: 0.95,
          reasoning: 'Password field detected',
          expectedOutcome: 'Password field populated',
          targetElement: passwordField,
          verified: true,
        });
      }

      if (submitBtn) {
        predictions.push({
          action: {
            type: 'click',
            clickType: 'single',
            description: 'Submit login form',
            elementIndex: submitBtn.index,
          },
          confidence: 0.9,
          reasoning: 'Submit button for login form',
          expectedOutcome: 'User logged in, redirected to dashboard',
          targetElement: submitBtn,
          verified: true,
        });
      }
    }

    return predictions.slice(0, 3);
  }

  private inferPageType(state: BrowserState): PageType {
    const url = state.url.toLowerCase();
    const title = state.title.toLowerCase();

    // URL-based detection
    if (/login|signin|sign-in/i.test(url)) return 'login';
    if (/signup|register|sign-up/i.test(url)) return 'signup';
    if (/search|results|query/i.test(url)) return 'search-results';
    if (/cart|basket/i.test(url)) return 'cart';
    if (/checkout|payment/i.test(url)) return 'checkout';
    if (/product|item|detail/i.test(url)) return 'product-detail';
    if (/settings|preferences/i.test(url)) return 'settings';
    if (/profile|account/i.test(url)) return 'profile';
    if (/dashboard|admin/i.test(url)) return 'dashboard';
    if (/404|error|not.found/i.test(url)) return 'error';

    // Element-based detection
    const hasPasswordField = state.elements.some((e) => e.attributes.type === 'password');
    const hasSearchField = state.elements.some(
      (e) => e.role === 'searchbox' || e.semanticPurpose === 'search'
    );
    const hasProductCards =
      state.elements.filter((e) => /product|item|card/i.test(e.attributes.className || '')).length >
      3;

    if (hasPasswordField && state.elements.length < 20) return 'login';
    if (hasSearchField && hasProductCards) return 'search-results';
    if (hasProductCards) return 'product-listing';

    return 'unknown';
  }

  private matchPagePattern(url: string): PagePattern | null {
    const domain = new URL(url).hostname;

    for (const [key, pattern] of this.pagePatterns) {
      if (key.startsWith(domain)) {
        // Check if URL matches pattern
        const regex = new RegExp(pattern.urlPattern.replace(/\*/g, '.*'));
        if (regex.test(url)) {
          return pattern;
        }
      }
    }

    return null;
  }

  private createUrlPattern(url: string): string {
    try {
      const parsed = new URL(url);
      // Replace IDs with wildcards
      const path = parsed.pathname.replace(/\/\d+/g, '/*').replace(/\/[a-f0-9-]{36}/gi, '/*'); // UUIDs
      return `${parsed.hostname}${path}`;
    } catch {
      return url;
    }
  }

  private findElementByDescription(
    description: string,
    elements: IndexedElement[]
  ): IndexedElement | null {
    const descLower = description.toLowerCase();

    // Exact text match
    let match = elements.find(
      (e) => e.text?.toLowerCase() === descLower || e.ariaLabel?.toLowerCase() === descLower
    );
    if (match) return match;

    // Partial text match
    match = elements.find(
      (e) =>
        e.text?.toLowerCase().includes(descLower) || descLower.includes(e.text?.toLowerCase() || '')
    );
    if (match) return match;

    // Role + text match
    const roleMatch = descLower.match(/^(click|type|select)\s+(the\s+)?(.+)$/i);
    if (roleMatch) {
      const target = roleMatch[3];
      match = elements.find(
        (e) => e.text?.toLowerCase().includes(target) || e.ariaLabel?.toLowerCase().includes(target)
      );
    }

    return match || null;
  }

  private getCacheKey(state: BrowserState, goal: string): string {
    return `${state.url}:${goal}:${state.elements.length}`;
  }

  private parsePredictionResponse(content: string): ActionPrediction[] {
    try {
      // Extract JSON from response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return [];

      const parsed = JSON.parse(jsonMatch[0]);
      const predictions = parsed.predictions || [];

      return predictions.map((p: any) => ({
        action: p.action,
        confidence: p.confidence || 0.5,
        reasoning: p.reasoning || '',
        expectedOutcome: p.expectedOutcome || '',
        verified: false,
      }));
    } catch (error) {
      logger.error('Failed to parse prediction response', error);
      return [];
    }
  }

  private parsePlanResponse(content: string): TaskPlan {
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return this.createDefaultPlan('Unknown');

      const parsed = JSON.parse(jsonMatch[0]);

      return {
        steps: (parsed.steps || []).map((s: any, i: number) => ({
          description: s.description || `Step ${i + 1}`,
          interactionType: s.interactionType || 'click-sequence',
          estimatedActions: s.estimatedActions || 1,
          requiredElements: s.requiredElements || [],
          dependsOn: s.dependsOn || [],
        })),
        estimatedActions: parsed.estimatedActions || 10,
        successProbability: parsed.successProbability || 0.7,
        potentialBlockers: parsed.potentialBlockers || [],
        fallbackStrategies: parsed.fallbackStrategies || [],
      };
    } catch (error) {
      logger.error('Failed to parse plan response', error);
      return this.createDefaultPlan('Unknown');
    }
  }

  private createDefaultPlan(objective: string): TaskPlan {
    return {
      steps: [
        {
          description: `Complete: ${objective}`,
          interactionType: 'click-sequence',
          estimatedActions: 5,
          dependsOn: [],
        },
      ],
      estimatedActions: 10,
      successProbability: 0.6,
      potentialBlockers: ['Unknown page structure'],
      fallbackStrategies: ['Try alternative approach'],
    };
  }

  private loadPatterns(): void {
    try {
      const storagePath = this.getPatternsStoragePath();

      if (!fs.existsSync(storagePath)) {
        logger.debug('No saved patterns found, starting with empty patterns');
        return;
      }

      const data = fs.readFileSync(storagePath, 'utf-8');
      const parsed = JSON.parse(data) as { patterns: PagePattern[]; timestamp: number };

      if (parsed.patterns && Array.isArray(parsed.patterns)) {
        this.pagePatterns.clear();
        for (const pattern of parsed.patterns) {
          this.pagePatterns.set(pattern.urlPattern, pattern);
        }
        logger.info('Loaded page patterns from storage', {
          count: this.pagePatterns.size,
          timestamp: new Date(parsed.timestamp).toISOString(),
        });
      }
    } catch (error) {
      logger.error('Failed to load page patterns', { error: (error as Error).message });
      // Continue with empty patterns
    }
  }

  private savePatterns(): void {
    try {
      const storagePath = this.getPatternsStoragePath();
      const patterns = Array.from(this.pagePatterns.values());

      const data = {
        patterns,
        timestamp: Date.now(),
        version: '1.0.0',
      };

      // Ensure directory exists
      const dir = path.dirname(storagePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(storagePath, JSON.stringify(data, null, 2), 'utf-8');
      logger.debug('Saved page patterns to storage', { count: patterns.length });
    } catch (error) {
      logger.error('Failed to save page patterns', { error: (error as Error).message });
    }
  }

  /**
   * Get the storage path for page patterns
   */
  private getPatternsStoragePath(): string {
    // Use Electron's userData directory for persistent storage
    const userDataPath = app.getPath('userData');
    return path.join(userDataPath, 'browser-agent', 'page-patterns.json');
  }
}

// ============================================================================
// Singleton Factory
// ============================================================================

let predictiveEngineInstance: PredictiveEngine | null = null;

export function getPredictiveEngine(): PredictiveEngine {
  if (!predictiveEngineInstance) {
    predictiveEngineInstance = new PredictiveEngine();
  }
  return predictiveEngineInstance;
}

export function createPredictiveEngine(): PredictiveEngine {
  return new PredictiveEngine();
}
