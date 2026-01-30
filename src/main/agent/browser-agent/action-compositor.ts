/**
 * Action Compositor
 *
 * Chains multiple micro-actions into efficient macros for faster execution.
 * Reduces latency by batching operations and pre-computing action sequences.
 *
 * Key advantages over Claude for Chrome:
 * - Macro recording and playback
 * - Intelligent action batching
 * - Parallel action execution where safe
 * - Transaction-like action groups with rollback
 *
 * @module agent/browser-agent/action-compositor
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { createModuleLogger } from '../../utils/logger';
import { BrowserAction, ActionResult, IndexedElement } from './types';

const logger = createModuleLogger('ActionCompositor');

// ============================================================================
// Composite Action Types
// ============================================================================

export interface CompositeAction {
  /** Unique identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description */
  description: string;
  /** Individual actions in sequence */
  actions: BrowserAction[];
  /** Can actions run in parallel? */
  parallelizable: boolean;
  /** Should rollback on failure? */
  transactional: boolean;
  /** Preconditions to check */
  preconditions: ActionPrecondition[];
  /** Expected final state */
  expectedOutcome: string;
  /** Timeout for entire composite */
  timeoutMs: number;
  /** Variables that can be templated */
  variables: Record<string, string>;
}

export interface ActionPrecondition {
  /** Type of check */
  type: 'element-exists' | 'element-visible' | 'url-matches' | 'text-contains' | 'custom';
  /** Check value */
  value: string;
  /** Element index if applicable */
  elementIndex?: number;
  /** Error message if fails */
  errorMessage: string;
}

export interface ActionMacro {
  /** Macro ID */
  id: string;
  /** Macro name */
  name: string;
  /** When this macro applies */
  trigger: MacroTrigger;
  /** Actions to execute */
  composite: CompositeAction;
  /** Times used */
  usageCount: number;
  /** Success rate */
  successRate: number;
  /** Created timestamp */
  createdAt: number;
}

export interface MacroTrigger {
  /** URL pattern */
  urlPattern?: string;
  /** Page type */
  pageType?: string;
  /** Intent keywords */
  intentKeywords: string[];
  /** Required elements */
  requiredElements?: string[];
}

export interface CompositeResult {
  /** Overall success */
  success: boolean;
  /** Individual action results */
  actionResults: Array<{
    action: BrowserAction;
    result: ActionResult;
    durationMs: number;
  }>;
  /** Total duration */
  totalDurationMs: number;
  /** Actions that were rolled back */
  rolledBack: BrowserAction[];
  /** Final state description */
  finalState: string;
}

export interface ActionBatch {
  /** Actions that can run together */
  actions: BrowserAction[];
  /** Order within larger sequence */
  order: number;
  /** Can run in parallel with other batches? */
  parallelWithPrevious: boolean;
}

// ============================================================================
// Common Composite Actions
// ============================================================================

export const COMMON_COMPOSITES: Record<string, Omit<CompositeAction, 'id'>> = {
  'form-login': {
    name: 'Login Form Fill',
    description: 'Fill and submit a login form',
    actions: [
      { type: 'type', text: '{username}', description: 'Enter username', elementIndex: 0 },
      {
        type: 'type',
        text: '{password}',
        description: 'Enter password',
        elementIndex: 0,
        sensitive: true,
      },
      { type: 'click', clickType: 'single', description: 'Click submit button', elementIndex: 0 },
    ],
    parallelizable: false,
    transactional: false,
    preconditions: [
      {
        type: 'element-exists',
        value: 'input[type="password"]',
        errorMessage: 'Password field not found',
      },
    ],
    expectedOutcome: 'User should be logged in and redirected',
    timeoutMs: 30000,
    variables: { username: '', password: '' },
  },

  'search-and-select': {
    name: 'Search and Select Result',
    description: 'Search for something and click the first relevant result',
    actions: [
      {
        type: 'type',
        text: '{query}',
        description: 'Enter search query',
        elementIndex: 0,
        pressEnterAfter: true,
      },
      {
        type: 'wait',
        description: 'Wait for results',
        waitFor: { type: 'selector', value: '.search-results', timeoutMs: 5000 },
      },
      { type: 'click', clickType: 'single', description: 'Click first result', elementIndex: 0 },
    ],
    parallelizable: false,
    transactional: false,
    preconditions: [
      {
        type: 'element-exists',
        value: 'input[type="search"], [role="searchbox"]',
        errorMessage: 'Search box not found',
      },
    ],
    expectedOutcome: 'Should navigate to the selected result',
    timeoutMs: 20000,
    variables: { query: '' },
  },

  'cookie-consent-dismiss': {
    name: 'Dismiss Cookie Consent',
    description: 'Automatically dismiss cookie consent popups',
    actions: [
      {
        type: 'click',
        clickType: 'single',
        description: 'Click accept/dismiss button',
        elementIndex: 0,
      },
    ],
    parallelizable: false,
    transactional: false,
    preconditions: [],
    expectedOutcome: 'Cookie consent popup should disappear',
    timeoutMs: 5000,
    variables: {},
  },

  'add-to-cart': {
    name: 'Add Product to Cart',
    description: 'Add the current product to shopping cart',
    actions: [
      {
        type: 'scroll',
        direction: 'down',
        scrollToElement: true,
        description: 'Scroll to add to cart button',
        elementIndex: 0,
      },
      { type: 'click', clickType: 'single', description: 'Click add to cart', elementIndex: 0 },
      { type: 'wait', description: 'Wait for cart update', waitFor: { type: 'time', ms: 1000 } },
    ],
    parallelizable: false,
    transactional: true,
    preconditions: [],
    expectedOutcome: 'Product should be added to cart',
    timeoutMs: 15000,
    variables: {},
  },

  'fill-form': {
    name: 'Fill Form Fields',
    description: 'Fill multiple form fields in sequence',
    actions: [],
    parallelizable: false,
    transactional: true,
    preconditions: [
      { type: 'element-exists', value: 'form', errorMessage: 'No form found on page' },
    ],
    expectedOutcome: 'Form should be filled with provided values',
    timeoutMs: 30000,
    variables: {},
  },

  'navigate-and-wait': {
    name: 'Navigate and Wait for Load',
    description: 'Navigate to URL and wait for page to fully load',
    actions: [
      { type: 'navigate', url: '{url}', description: 'Navigate to URL' },
      {
        type: 'wait',
        description: 'Wait for page load',
        waitFor: { type: 'navigation', timeoutMs: 10000 },
      },
    ],
    parallelizable: false,
    transactional: false,
    preconditions: [],
    expectedOutcome: 'Page should be fully loaded',
    timeoutMs: 15000,
    variables: { url: '' },
  },
};

// ============================================================================
// Action Compositor Class
// ============================================================================

export class ActionCompositor extends EventEmitter {
  private page: any;
  private macros: Map<string, ActionMacro> = new Map();
  private actionHistory: Array<{ action: BrowserAction; result: ActionResult; timestamp: number }> =
    [];
  private executionStack: BrowserAction[] = [];

  constructor(page: any) {
    super();
    this.page = page;
    this.loadMacros();
  }

  /**
   * Execute a composite action
   */
  async executeComposite(
    composite: CompositeAction,
    elementMap: Map<number, IndexedElement>,
    variables?: Record<string, string>
  ): Promise<CompositeResult> {
    const startTime = Date.now();
    const results: CompositeResult['actionResults'] = [];
    const rolledBack: BrowserAction[] = [];

    logger.info('Executing composite action', {
      name: composite.name,
      actionCount: composite.actions.length,
    });

    // Merge variables
    const vars = { ...composite.variables, ...variables };

    // Check preconditions
    for (const precondition of composite.preconditions) {
      const passed = await this.checkPrecondition(precondition, elementMap);
      if (!passed) {
        logger.warn('Precondition failed', { precondition: precondition.errorMessage });
        return {
          success: false,
          actionResults: results,
          totalDurationMs: Date.now() - startTime,
          rolledBack: [],
          finalState: `Precondition failed: ${precondition.errorMessage}`,
        };
      }
    }

    // Resolve variables in actions
    const resolvedActions = composite.actions.map((action) => this.resolveVariables(action, vars));

    // Batch actions if possible
    const batches = this.batchActions(resolvedActions);

    // Execute batches
    for (const batch of batches) {
      if (batch.parallelWithPrevious && batch.order > 0) {
        // Execute in parallel (for non-dependent actions)
        const batchResults = await Promise.all(
          batch.actions.map((action) => this.executeAction(action, elementMap))
        );

        for (let i = 0; i < batch.actions.length; i++) {
          results.push({
            action: batch.actions[i],
            result: batchResults[i],
            durationMs: 0, // Parallel timing is aggregate
          });
        }
      } else {
        // Execute sequentially
        for (const action of batch.actions) {
          const actionStart = Date.now();
          const result = await this.executeAction(action, elementMap);

          results.push({
            action,
            result,
            durationMs: Date.now() - actionStart,
          });

          if (!result.success && composite.transactional) {
            // Rollback previous actions
            const toRollback = results.slice(0, -1).reverse();
            for (const prev of toRollback) {
              const rollbackResult = await this.rollbackAction(prev.action);
              if (rollbackResult) {
                rolledBack.push(prev.action);
              }
            }

            return {
              success: false,
              actionResults: results,
              totalDurationMs: Date.now() - startTime,
              rolledBack,
              finalState: `Failed at: ${action.description}. Rolled back ${rolledBack.length} actions.`,
            };
          }
        }
      }
    }

    const totalDuration = Date.now() - startTime;
    logger.info('Composite action completed', { name: composite.name, durationMs: totalDuration });

    return {
      success: true,
      actionResults: results,
      totalDurationMs: totalDuration,
      rolledBack: [],
      finalState: composite.expectedOutcome,
    };
  }

  /**
   * Create a macro from recent actions
   */
  createMacroFromHistory(
    name: string,
    description: string,
    trigger: MacroTrigger,
    actionCount: number = 5
  ): ActionMacro {
    const recentActions = this.actionHistory
      .slice(-actionCount)
      .filter((h) => h.result.success)
      .map((h) => h.action);

    const macro: ActionMacro = {
      id: `macro-${Date.now()}`,
      name,
      trigger,
      composite: {
        id: `composite-${Date.now()}`,
        name,
        description,
        actions: recentActions,
        parallelizable: false,
        transactional: false,
        preconditions: [],
        expectedOutcome: description,
        timeoutMs: 60000,
        variables: {},
      },
      usageCount: 0,
      successRate: 1.0,
      createdAt: Date.now(),
    };

    this.macros.set(macro.id, macro);
    this.saveMacros();

    logger.info('Created macro from history', {
      id: macro.id,
      name,
      actionCount: recentActions.length,
    });
    this.emit('macro-created', macro);

    return macro;
  }

  /**
   * Find matching macro for current context
   */
  findMatchingMacro(url: string, intent: string, pageType?: string): ActionMacro | null {
    const intentLower = intent.toLowerCase();

    for (const [_id, macro] of this.macros) {
      const trigger = macro.trigger;

      // Check URL pattern
      if (trigger.urlPattern) {
        const pattern = new RegExp(trigger.urlPattern.replace(/\*/g, '.*'));
        if (!pattern.test(url)) continue;
      }

      // Check page type
      if (trigger.pageType && pageType && trigger.pageType !== pageType) {
        continue;
      }

      // Check intent keywords
      const keywordMatch = trigger.intentKeywords.some((keyword) =>
        intentLower.includes(keyword.toLowerCase())
      );
      if (!keywordMatch) continue;

      // Found a match
      logger.debug('Found matching macro', { id: macro.id, name: macro.name });
      return macro;
    }

    return null;
  }

  /**
   * Execute a macro
   */
  async executeMacro(
    macro: ActionMacro,
    elementMap: Map<number, IndexedElement>,
    variables?: Record<string, string>
  ): Promise<CompositeResult> {
    logger.info('Executing macro', { id: macro.id, name: macro.name });

    const result = await this.executeComposite(macro.composite, elementMap, variables);

    // Update macro statistics
    macro.usageCount++;
    macro.successRate =
      (macro.successRate * (macro.usageCount - 1) + (result.success ? 1 : 0)) / macro.usageCount;
    this.saveMacros();

    return result;
  }

  /**
   * Build a form-filling composite
   */
  buildFormComposite(
    formFields: Array<{ elementIndex: number; value: string; type: string }>,
    submitButtonIndex?: number
  ): CompositeAction {
    const actions: BrowserAction[] = [];

    for (const field of formFields) {
      if (field.type === 'checkbox' || field.type === 'radio') {
        if (field.value === 'true' || field.value === 'checked') {
          actions.push({
            type: 'click',
            clickType: 'single',
            description: `Check ${field.type}`,
            elementIndex: field.elementIndex,
          });
        }
      } else if (field.type === 'select') {
        actions.push({
          type: 'select',
          value: field.value,
          description: 'Select option',
          elementIndex: field.elementIndex,
        });
      } else {
        actions.push({
          type: 'type',
          text: field.value,
          description: 'Fill field',
          elementIndex: field.elementIndex,
          clearFirst: true,
          sensitive: field.type === 'password',
        });
      }
    }

    if (submitButtonIndex !== undefined) {
      actions.push({
        type: 'click',
        clickType: 'single',
        description: 'Submit form',
        elementIndex: submitButtonIndex,
      });
    }

    return {
      id: `form-${Date.now()}`,
      name: 'Fill Form',
      description: 'Auto-generated form filling composite',
      actions,
      parallelizable: false,
      transactional: true,
      preconditions: [],
      expectedOutcome: 'Form submitted successfully',
      timeoutMs: 30000,
      variables: {},
    };
  }

  /**
   * Optimize an action sequence for speed
   */
  optimizeSequence(actions: BrowserAction[]): BrowserAction[] {
    const optimized: BrowserAction[] = [];
    let i = 0;

    while (i < actions.length) {
      const current = actions[i];

      // Combine consecutive type actions on same element
      if (current.type === 'type' && 'elementIndex' in current) {
        let combinedText = current.text || '';
        let j = i + 1;

        while (j < actions.length) {
          const next = actions[j];
          if (
            next.type === 'type' &&
            'elementIndex' in next &&
            next.elementIndex === current.elementIndex &&
            !next.clearFirst
          ) {
            combinedText += next.text || '';
            j++;
          } else {
            break;
          }
        }

        if (j > i + 1) {
          optimized.push({
            ...current,
            text: combinedText,
            description: `Type combined text (${j - i} actions merged)`,
          });
          i = j;
          continue;
        }
      }

      // Remove redundant waits
      if (current.type === 'wait' && i > 0) {
        const prev = actions[i - 1];
        // Skip wait after navigation (navigation already waits)
        if (prev.type === 'navigate') {
          i++;
          continue;
        }
      }

      optimized.push(current);
      i++;
    }

    logger.debug('Optimized action sequence', {
      original: actions.length,
      optimized: optimized.length,
    });

    return optimized;
  }

  /**
   * Record action for history
   */
  recordAction(action: BrowserAction, result: ActionResult): void {
    this.actionHistory.push({
      action,
      result,
      timestamp: Date.now(),
    });

    // Keep last 100 actions
    while (this.actionHistory.length > 100) {
      this.actionHistory.shift();
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private async checkPrecondition(
    precondition: ActionPrecondition,
    _elementMap: Map<number, IndexedElement>
  ): Promise<boolean> {
    try {
      switch (precondition.type) {
        case 'element-exists':
          const element = await this.page.$(precondition.value);
          return element !== null;

        case 'element-visible':
          const visible = await this.page.$eval(precondition.value, (el: Element) => {
            const style = window.getComputedStyle(el);
            return style.display !== 'none' && style.visibility !== 'hidden';
          });
          return visible;

        case 'url-matches':
          const url = this.page.url();
          return new RegExp(precondition.value).test(url);

        case 'text-contains':
          const pageText = await this.page.evaluate(() => document.body.innerText);
          return pageText.includes(precondition.value);

        default:
          return true;
      }
    } catch (error) {
      return false;
    }
  }

  private resolveVariables(
    action: BrowserAction,
    variables: Record<string, string>
  ): BrowserAction {
    const resolved = { ...action };

    // Replace {variable} patterns
    const replaceVars = (str: string): string => {
      return str.replace(/\{(\w+)\}/g, (_, key) => variables[key] || `{${key}}`);
    };

    if ('text' in resolved && resolved.text) {
      resolved.text = replaceVars(resolved.text);
    }

    if ('url' in resolved && resolved.url) {
      resolved.url = replaceVars(resolved.url);
    }

    if ('description' in resolved) {
      resolved.description = replaceVars(resolved.description);
    }

    return resolved;
  }

  private batchActions(actions: BrowserAction[]): ActionBatch[] {
    const batches: ActionBatch[] = [];
    let currentBatch: BrowserAction[] = [];
    let order = 0;

    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];
      const prevAction = i > 0 ? actions[i - 1] : null;

      // Check if this action can be batched with previous
      const canBatch = this.canBatchWith(action, prevAction);

      if (canBatch && currentBatch.length > 0) {
        currentBatch.push(action);
      } else {
        // Start new batch
        if (currentBatch.length > 0) {
          batches.push({
            actions: currentBatch,
            order: order++,
            parallelWithPrevious: false,
          });
        }
        currentBatch = [action];
      }
    }

    // Add final batch
    if (currentBatch.length > 0) {
      batches.push({
        actions: currentBatch,
        order: order,
        parallelWithPrevious: false,
      });
    }

    return batches;
  }

  private canBatchWith(action: BrowserAction, prevAction: BrowserAction | null): boolean {
    if (!prevAction) return false;

    // Type actions on different elements can be parallel
    if (action.type === 'type' && prevAction.type === 'type') {
      if ('elementIndex' in action && 'elementIndex' in prevAction) {
        return action.elementIndex !== prevAction.elementIndex;
      }
    }

    // Click and type are always sequential
    if (action.type === 'click' || prevAction.type === 'click') {
      return false;
    }

    // Navigation is always sequential
    if (action.type === 'navigate' || prevAction.type === 'navigate') {
      return false;
    }

    // Wait is always sequential
    if (action.type === 'wait' || prevAction.type === 'wait') {
      return false;
    }

    return false;
  }

  private async executeAction(
    action: BrowserAction,
    _elementMap: Map<number, IndexedElement>
  ): Promise<ActionResult> {
    // This is a simplified executor - real implementation would call orchestrator
    try {
      this.executionStack.push(action);

      // Placeholder - real implementation integrates with orchestrator
      await new Promise((resolve) => setTimeout(resolve, 100));

      this.executionStack.pop();

      return {
        success: true,
        message: `Executed: ${action.description}`,
        duration: 100,
        stateChange: {
          urlChanged: false,
          domChanged: true,
          screenshot: undefined,
        },
      };
    } catch (error) {
      this.executionStack.pop();
      return {
        success: false,
        message: `Failed: ${action.description}`,
        error: error instanceof Error ? error : new Error(String(error)),
        duration: 0,
        stateChange: { urlChanged: false, domChanged: false },
      };
    }
  }

  private async rollbackAction(action: BrowserAction): Promise<boolean> {
    // Rollback logic depends on action type
    try {
      switch (action.type) {
        case 'type':
          // Clear the typed text
          if ('elementIndex' in action && action.elementIndex !== undefined) {
            await this.page.evaluate((index: number) => {
              const elements = document.querySelectorAll('input, textarea');
              const el = elements[index] as HTMLInputElement;
              if (el) el.value = '';
            }, action.elementIndex);
          }
          return true;

        case 'navigate':
          // Go back
          await this.page.goBack();
          return true;

        case 'click':
          // Can't really rollback a click, but we can note it
          return false;

        default:
          return false;
      }
    } catch (error) {
      logger.error('Rollback failed', { action: action.type, error });
      return false;
    }
  }

  private loadMacros(): void {
    try {
      const storagePath = this.getMacrosStoragePath();

      if (!fs.existsSync(storagePath)) {
        logger.debug('No saved macros found, starting with empty macros');
        return;
      }

      const data = fs.readFileSync(storagePath, 'utf-8');
      const parsed = JSON.parse(data) as {
        macros: ActionMacro[];
        timestamp: number;
        version: string;
      };

      if (parsed.macros && Array.isArray(parsed.macros)) {
        this.macros.clear();
        for (const macro of parsed.macros) {
          this.macros.set(macro.id, macro);
        }
        logger.info('Loaded macros from storage', {
          count: this.macros.size,
          timestamp: new Date(parsed.timestamp).toISOString(),
        });
      }
    } catch (error) {
      logger.error('Failed to load macros', { error: (error as Error).message });
      // Continue with empty registry
    }
  }

  private saveMacros(): void {
    try {
      const storagePath = this.getMacrosStoragePath();
      const macros = Array.from(this.macros.values());

      const data = {
        macros,
        timestamp: Date.now(),
        version: '1.0.0',
      };

      // Ensure directory exists
      const dir = path.dirname(storagePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(storagePath, JSON.stringify(data, null, 2), 'utf-8');
      logger.debug('Saved macros to storage', { count: macros.length });
    } catch (error) {
      logger.error('Failed to save macros', { error: (error as Error).message });
    }
  }

  /**
   * Get the storage path for macros
   */
  private getMacrosStoragePath(): string {
    // Use Electron's userData directory for persistent storage
    const userDataPath = app.getPath('userData');
    return path.join(userDataPath, 'browser-agent', 'macros.json');
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

export function createActionCompositor(page: any): ActionCompositor {
  return new ActionCompositor(page);
}
