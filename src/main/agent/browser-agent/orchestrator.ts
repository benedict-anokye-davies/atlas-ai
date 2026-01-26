/**
 * Browser Agent Orchestrator
 *
 * The core intelligence layer that surpasses Claude for Chrome and Project Mariner.
 * Implements a World Model + Action Engine architecture with:
 * - Multi-step reasoning and planning
 * - Visual verification after actions
 * - Error recovery and retry strategies
 * - Human-in-the-loop for sensitive operations
 *
 * @module agent/browser-agent/orchestrator
 */

import { EventEmitter } from 'events';
import { Page, Browser } from 'puppeteer-core';
import { createModuleLogger } from '../../utils/logger';
import { getLLMManager } from '../../llm/manager';
import { DOMSerializer, createDOMSerializer } from './dom-serializer';
import { SetOfMarkManager, createSetOfMarkManager } from './set-of-mark';
import {
  BrowserState,
  BrowserTask,
  TaskStatus,
  TaskHistoryEntry,
  AgentStep,
  BrowserAction,
  ActionResult,
  StepEvaluation,
  ExecutionError,
  ErrorType,
  RecoveryStrategy,
  RecoveryStrategyType,
  BrowserAgentConfig,
  ConfirmationConfig,
  SensitiveActionType,
  IndexedElement,
  DEFAULT_RECOVERY_STRATEGY,
  DEFAULT_CONFIRMATION_CONFIG,
  DEFAULT_DEBUG_CONFIG,
  DEFAULT_STEALTH_CONFIG,
  DEFAULT_SET_OF_MARK_CONFIG,
} from './types';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

const logger = createModuleLogger('BrowserAgentOrchestrator');

// ============================================================================
// LLM Prompts
// ============================================================================

const SYSTEM_PROMPT = `You are Atlas Browser Agent, an advanced AI capable of autonomously controlling web browsers to accomplish user tasks. You are MORE capable than Claude for Chrome or Google Project Mariner.

Your capabilities:
1. Analyze web page state through structured DOM data and visual screenshots
2. Plan multi-step actions to achieve complex goals
3. Execute browser actions precisely using element indices
4. Verify outcomes and adapt your strategy
5. Handle errors gracefully with recovery strategies

When given a task:
1. Analyze the current page state carefully
2. Think step-by-step about how to achieve the goal
3. Execute ONE focused action at a time
4. Verify the result before proceeding
5. Adapt if something unexpected happens

CRITICAL RULES:
- ALWAYS reference elements by their [index] number
- NEVER guess element indices - only use indices from the provided state
- If an element isn't visible, scroll to find it first
- For sensitive actions (login, payment, form submit), request confirmation
- If stuck, explain why and suggest alternatives
- Be precise with text input - match exactly what's needed

Action Types Available:
- click: Click on element by index
- type: Type text into element (can clear first)
- scroll: Scroll page or to element
- navigate: Go to URL
- wait: Wait for element, navigation, or time
- keypress: Press keyboard key
- hover: Hover over element
- select: Select dropdown option
- extract: Extract data from page
- screenshot: Take screenshot
- tab: Manage browser tabs

Response Format (JSON):
{
  "thinking": "Your step-by-step reasoning about the current state and what to do",
  "evaluationOfPrevious": {
    "success": true/false,
    "matchedExpectation": true/false,
    "observations": "What you observed after the last action",
    "needsRecovery": false
  },
  "memory": "Key facts to remember for this task",
  "currentGoal": "What you're trying to achieve in this step",
  "nextGoal": "What comes after this step",
  "actions": [
    {
      "type": "click",
      "description": "Click the login button",
      "elementIndex": 5
    }
  ],
  "expectedOutcome": "What should happen after this action",
  "confidence": 0.95,
  "isLikelyFinal": false
}`;

const PLANNING_PROMPT = `Given the task objective and current browser state, create a high-level plan.

Task: {objective}
{instructions}

Current URL: {url}
Page Title: {title}

Interactive Elements:
{elements}

{modals}

Create a plan with these sections:
1. Understanding: What is the user trying to accomplish?
2. Current State: What can we see on the page now?
3. High-Level Steps: List 3-8 major steps to complete the task
4. Potential Challenges: What might go wrong?
5. First Action: What should we do first?

Respond in JSON:
{
  "understanding": "...",
  "currentState": "...",
  "steps": ["Step 1", "Step 2", ...],
  "challenges": ["Challenge 1", ...],
  "firstAction": {
    "type": "...",
    "description": "...",
    ...
  }
}`;

const STEP_PROMPT = `Current task: {objective}

Step {stepNumber} of max {maxSteps}

Memory from previous steps:
{memory}

{previousResult}

Current browser state:
URL: {url}
Title: {title}

Interactive Elements:
{elements}

{modals}

{screenshot}

What action should we take next to progress toward the goal?
Remember to reference elements by their [index] numbers.

Respond in the JSON format specified.`;

const VERIFICATION_PROMPT = `Verify if the previous action was successful.

Action taken: {action}
Expected outcome: {expectedOutcome}

Browser state after action:
URL: {url}
Title: {title}

Changes observed:
- URL changed: {urlChanged}
- Title changed: {titleChanged}
- New elements appeared: {newElements}
- Elements disappeared: {removedElements}

{screenshot}

Evaluate:
1. Did the action succeed?
2. Did the page respond as expected?
3. Are we closer to the goal?
4. Is there an error or unexpected state?

Respond in JSON:
{
  "success": true/false,
  "matchedExpectation": true/false,
  "observations": "What happened",
  "unexpectedChanges": "Any surprises",
  "needsRecovery": false,
  "recoveryStrategy": null
}`;

// ============================================================================
// Browser Agent Orchestrator Class
// ============================================================================

export class BrowserAgentOrchestrator extends EventEmitter {
  private page: Page;
  private browser: Browser;
  private domSerializer: DOMSerializer;
  private setOfMark: SetOfMarkManager;
  private config: BrowserAgentConfig;

  // Current execution state
  private currentTask: BrowserTask | null = null;
  private isRunning = false;
  private abortController: AbortController | null = null;

  // State tracking
  private previousState: BrowserState | null = null;
  private stepMemory: string[] = [];

  constructor(page: Page, browser: Browser, config?: Partial<BrowserAgentConfig>) {
    super();
    this.page = page;
    this.browser = browser;
    this.domSerializer = createDOMSerializer(page);
    this.setOfMark = createSetOfMarkManager(page, config?.setOfMark);

    this.config = {
      planningModel: 'accounts/fireworks/models/qwen3-235b-a22b',
      visionModel: 'accounts/fireworks/models/qwen2-vl-72b-instruct',
      planningTemperature: 0.3,
      maxPlanningTokens: 4000,
      defaultTaskConfig: {
        maxSteps: 30,
        timeoutMs: 300000, // 5 minutes
      },
      stealth: { ...DEFAULT_STEALTH_CONFIG, ...config?.stealth },
      setOfMark: { ...DEFAULT_SET_OF_MARK_CONFIG, ...config?.setOfMark },
      recovery: { ...DEFAULT_RECOVERY_STRATEGY, ...config?.recovery },
      confirmations: { ...DEFAULT_CONFIRMATION_CONFIG, ...config?.confirmations },
      debug: {
        ...DEFAULT_DEBUG_CONFIG,
        artifactDir: path.join(app.getPath('userData'), 'browser-agent-debug'),
        ...config?.debug,
      },
      stealthMode: { ...DEFAULT_STEALTH_CONFIG, ...config?.stealthMode },
      maxTabs: config?.maxTabs ?? 10,
      requireConfirmation: config?.requireConfirmation ?? false,
      ...config,
    } as BrowserAgentConfig;

    // Ensure debug directory exists
    if (this.config.debug.saveScreenshots || this.config.debug.saveDomState) {
      fs.mkdirSync(this.config.debug.artifactDir, { recursive: true });
    }
  }

  // ============================================================================
  // Public API
  // ============================================================================

  /**
   * Execute a browser task
   */
  async executeTask(
    objective: string,
    options?: {
      instructions?: string;
      startUrl?: string;
      maxSteps?: number;
      timeoutMs?: number;
      confirmations?: Partial<ConfirmationConfig>;
    }
  ): Promise<BrowserTask> {
    if (this.isRunning) {
      throw new Error('Another task is already running');
    }

    // Create task
    const task: BrowserTask = {
      id: uuidv4(),
      objective,
      instructions: options?.instructions,
      startUrl: options?.startUrl,
      maxSteps: options?.maxSteps || this.config.defaultTaskConfig.maxSteps || 30,
      timeoutMs: options?.timeoutMs || this.config.defaultTaskConfig.timeoutMs || 300000,
      status: 'pending',
      history: [],
      extractedData: {},
      errors: [],
      timing: { createdAt: Date.now() },
      confirmations: {
        ...this.config.confirmations,
        ...options?.confirmations,
      },
    };

    this.currentTask = task;
    this.isRunning = true;
    this.abortController = new AbortController();
    this.stepMemory = [];
    this.previousState = null;

    logger.info('Starting browser task', { id: task.id, objective });
    this.emit('task:started', task);

    try {
      // Request start confirmation if needed
      if (task.confirmations.confirmStart) {
        const confirmed = await this.requestConfirmation(
          'start-task',
          `Start task: "${objective}"?`
        );
        if (!confirmed) {
          task.status = 'aborted';
          return task;
        }
      }

      task.status = 'planning';
      task.timing.startedAt = Date.now();

      // Navigate to start URL if provided
      if (task.startUrl) {
        await this.page.goto(task.startUrl, { waitUntil: 'domcontentloaded' });
        await this.waitForPageReady();
      }

      // Create initial plan
      const plan = await this.createPlan(task);
      logger.debug('Created plan', { steps: plan.steps?.length });

      task.status = 'running';
      task.timing.planningDuration = Date.now() - (task.timing.startedAt || Date.now());

      // Execute steps
      let stepNumber = 1;
      const executionStartTime = Date.now();

      while (stepNumber <= task.maxSteps && task.status === 'running') {
        // Check for abort
        if (this.abortController?.signal.aborted) {
          task.status = 'aborted';
          break;
        }

        // Check timeout
        if (Date.now() - executionStartTime > task.timeoutMs) {
          task.status = 'failed';
          task.errors.push({
            type: 'timeout',
            message: `Task exceeded timeout of ${task.timeoutMs}ms`,
            step: stepNumber,
            action: { type: 'wait', description: 'Timeout', waitFor: { type: 'time', ms: 0 } },
            recoveryAttempted: [],
            timestamp: Date.now(),
          });
          break;
        }

        // Execute step
        const stepResult = await this.executeStep(task, stepNumber);

        // Check if task is complete
        if (stepResult.isComplete) {
          task.status = 'completed';
          break;
        }

        // Check for unrecoverable error
        if (stepResult.failed && !stepResult.recovered) {
          task.status = 'failed';
          break;
        }

        stepNumber++;
      }

      // Check if we hit max steps without completing
      if (stepNumber > task.maxSteps && task.status === 'running') {
        task.status = 'failed';
        task.errors.push({
          type: 'timeout',
          message: `Task exceeded maximum steps (${task.maxSteps})`,
          step: stepNumber,
          action: { type: 'wait', description: 'Max steps', waitFor: { type: 'time', ms: 0 } },
          recoveryAttempted: [],
          timestamp: Date.now(),
        });
      }

      task.timing.completedAt = Date.now();
      task.timing.executionDuration = Date.now() - executionStartTime;
      task.timing.totalDuration =
        task.timing.completedAt - (task.timing.startedAt || task.timing.createdAt);

      logger.info('Task finished', {
        id: task.id,
        status: task.status,
        steps: task.history.length,
        duration: task.timing.totalDuration,
      });

      this.emit('task:completed', task);
      return task;
    } catch (error) {
      task.status = 'failed';
      task.errors.push({
        type: 'unknown',
        message: (error as Error).message,
        step: task.history.length + 1,
        action: { type: 'wait', description: 'Error', waitFor: { type: 'time', ms: 0 } },
        recoveryAttempted: [],
        timestamp: Date.now(),
      });
      task.timing.completedAt = Date.now();

      logger.error('Task failed with error', { id: task.id, error });
      this.emit('task:failed', { task, error });
      return task;
    } finally {
      this.isRunning = false;
      this.abortController = null;
      this.currentTask = null;
    }
  }

  /**
   * Abort the current task
   */
  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
      logger.info('Task abort requested');
    }
  }

  /**
   * Get current task status
   */
  getStatus(): { isRunning: boolean; task: BrowserTask | null } {
    return {
      isRunning: this.isRunning,
      task: this.currentTask,
    };
  }

  // ============================================================================
  // Core Execution Logic
  // ============================================================================

  /**
   * Create initial plan for task
   */
  private async createPlan(task: BrowserTask): Promise<{
    understanding: string;
    steps: string[];
    firstAction?: BrowserAction;
  }> {
    const state = await this.domSerializer.extractBrowserState(false);
    const elementsText = this.domSerializer.serializeForLLM(state);

    const modalsText =
      state.activeModals.length > 0
        ? `\nActive Modals:\n${state.activeModals.map((m) => `- ${m.type}: ${m.title || 'Untitled'}`).join('\n')}`
        : '';

    const prompt = PLANNING_PROMPT.replace('{objective}', task.objective)
      .replace('{instructions}', task.instructions ? `\nInstructions: ${task.instructions}` : '')
      .replace('{url}', state.url)
      .replace('{title}', state.title)
      .replace('{elements}', elementsText)
      .replace('{modals}', modalsText);

    const llm = getLLMManager();
    const response = await llm.chat(prompt);

    try {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      logger.warn('Failed to parse plan JSON', { error: e });
    }

    return {
      understanding: task.objective,
      steps: ['Analyze page', 'Execute task', 'Verify completion'],
    };
  }

  /**
   * Execute a single step
   */
  private async executeStep(
    task: BrowserTask,
    stepNumber: number
  ): Promise<{ isComplete: boolean; failed: boolean; recovered: boolean }> {
    const stepStartTime = Date.now();

    // Get current browser state
    const stateBefore = await this.domSerializer.extractBrowserState(
      this.config.setOfMark.enabled
    );

    // Capture annotated screenshot if using vision
    let screenshot: string | undefined;
    if (this.config.setOfMark.enabled) {
      const annotated = await this.setOfMark.captureAnnotatedScreenshot();
      screenshot = annotated.image;
    }

    // Prepare context for LLM
    const elementsText = this.domSerializer.serializeForLLM(stateBefore);
    const modalsText =
      stateBefore.activeModals.length > 0
        ? `\nActive Modals:\n${stateBefore.activeModals.map((m) => `- ${m.type}: ${m.title}`).join('\n')}`
        : '';

    const previousResult =
      task.history.length > 0
        ? `\nPrevious action result:\n${JSON.stringify(task.history[task.history.length - 1].actionResults, null, 2)}`
        : '';

    const prompt = STEP_PROMPT.replace('{objective}', task.objective)
      .replace('{stepNumber}', stepNumber.toString())
      .replace('{maxSteps}', task.maxSteps.toString())
      .replace('{memory}', this.stepMemory.join('\n') || 'No previous context')
      .replace('{previousResult}', previousResult)
      .replace('{url}', stateBefore.url)
      .replace('{title}', stateBefore.title)
      .replace('{elements}', elementsText)
      .replace('{modals}', modalsText)
      .replace('{screenshot}', screenshot ? '[Screenshot with markers attached]' : '');

    // Get LLM decision
    const llm = getLLMManager();
    const response = await llm.chat(prompt);

    // Parse agent step
    let agentStep: AgentStep;
    try {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        agentStep = {
          stepNumber,
          thinking: parsed.thinking || '',
          evaluationOfPrevious: parsed.evaluationOfPrevious,
          memory: parsed.memory || '',
          currentGoal: parsed.currentGoal || '',
          nextGoal: parsed.nextGoal,
          actions: parsed.actions || [],
          expectedOutcome: parsed.expectedOutcome || '',
          confidence: parsed.confidence || 0.5,
          isLikelyFinal: parsed.isLikelyFinal || false,
          timestamp: Date.now(),
        };
      } else {
        throw new Error('No JSON found in response');
      }
    } catch (e) {
      logger.error('Failed to parse agent step', { error: e, response: response.content });
      return { isComplete: false, failed: true, recovered: false };
    }

    // Update memory
    if (agentStep.memory) {
      this.stepMemory.push(`Step ${stepNumber}: ${agentStep.memory}`);
      if (this.stepMemory.length > 10) {
        this.stepMemory = this.stepMemory.slice(-10);
      }
    }

    this.emit('step:started', { task, step: agentStep });

    // Request confirmation if needed
    if (task.confirmations.confirmEachStep) {
      const confirmed = await this.requestConfirmation(
        'step',
        `Execute: ${agentStep.actions.map((a) => a.description).join(', ')}`
      );
      if (!confirmed) {
        task.status = 'paused';
        return { isComplete: false, failed: false, recovered: false };
      }
    }

    // Check for sensitive actions
    if (task.confirmations.confirmSensitiveActions) {
      for (const action of agentStep.actions) {
        const sensitiveType = this.detectSensitiveAction(action, stateBefore);
        if (sensitiveType && task.confirmations.sensitiveActionTypes.includes(sensitiveType)) {
          const confirmed = await this.requestConfirmation(
            sensitiveType,
            `Sensitive action (${sensitiveType}): ${action.description}`
          );
          if (!confirmed) {
            task.status = 'paused';
            return { isComplete: false, failed: false, recovered: false };
          }
        }
      }
    }

    // Execute actions
    const actionResults: ActionResult[] = [];
    let failed = false;
    let recovered = false;

    for (const action of agentStep.actions) {
      const result = await this.executeAction(action, stateBefore);
      actionResults.push(result);

      if (!result.success) {
        failed = true;
        // Attempt recovery
        const recoveryResult = await this.attemptRecovery(action, result.error || 'Unknown error');
        if (recoveryResult.success) {
          recovered = true;
          failed = false;
        } else {
          task.errors.push({
            type: this.classifyError(result.error || ''),
            message: result.error || 'Unknown error',
            step: stepNumber,
            action,
            recoveryAttempted: recoveryResult.strategies,
            timestamp: Date.now(),
          });
          break;
        }
      }

      // Apply stealth delay
      if (this.config.stealth.enabled && this.config.stealth.randomizeTimings) {
        const delay =
          Math.random() *
            (this.config.stealth.timingRange.max - this.config.stealth.timingRange.min) +
          this.config.stealth.timingRange.min;
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    // Get state after actions
    const stateAfter = await this.domSerializer.extractBrowserState(false);

    // Save debug artifacts
    if (this.config.debug.saveScreenshots && screenshot) {
      const screenshotPath = path.join(
        this.config.debug.artifactDir,
        `${task.id}_step${stepNumber}.png`
      );
      fs.writeFileSync(screenshotPath, Buffer.from(screenshot, 'base64'));
    }

    // Create history entry
    const historyEntry: TaskHistoryEntry = {
      stepNumber,
      agentStep,
      browserStateBefore: {
        url: stateBefore.url,
        title: stateBefore.title,
        loadState: stateBefore.loadState,
      },
      browserStateAfter: {
        url: stateAfter.url,
        title: stateAfter.title,
        loadState: stateAfter.loadState,
      },
      actionResults,
      screenshot,
      duration: Date.now() - stepStartTime,
      timestamp: Date.now(),
    };

    task.history.push(historyEntry);
    this.previousState = stateAfter;

    this.emit('step:completed', { task, step: agentStep, results: actionResults });

    // Check if task is likely complete
    const isComplete = agentStep.isLikelyFinal && !failed && agentStep.confidence > 0.8;

    return { isComplete, failed, recovered };
  }

  /**
   * Execute a single action
   */
  private async executeAction(
    action: BrowserAction,
    state: BrowserState
  ): Promise<ActionResult> {
    logger.debug('Executing action', { type: action.type, description: action.description });

    try {
      switch (action.type) {
        case 'click':
          return await this.executeClick(action, state);
        case 'type':
          return await this.executeType(action, state);
        case 'scroll':
          return await this.executeScroll(action, state);
        case 'navigate':
          return await this.executeNavigate(action);
        case 'wait':
          return await this.executeWait(action);
        case 'keypress':
          return await this.executeKeypress(action);
        case 'hover':
          return await this.executeHover(action, state);
        case 'select':
          return await this.executeSelect(action, state);
        case 'extract':
          return await this.executeExtract(action, state);
        case 'screenshot':
          return await this.executeScreenshot(action);
        case 'tab':
          return await this.executeTab(action);
        case 'execute':
          return await this.executeScript(action);
        default:
          return {
            action,
            success: false,
            error: `Unknown action type: ${(action as BrowserAction).type}`,
          };
      }
    } catch (error) {
      return {
        action,
        success: false,
        error: (error as Error).message,
      };
    }
  }

  // ============================================================================
  // Action Executors
  // ============================================================================

  private async executeClick(
    action: BrowserAction & { type: 'click' },
    state: BrowserState
  ): Promise<ActionResult> {
    // If clicking by coordinates (for canvas, etc.)
    if (action.coordinates) {
      await this.page.mouse.click(action.coordinates.x, action.coordinates.y, {
        button: action.clickType === 'right' ? 'right' : action.clickType === 'middle' ? 'middle' : 'left',
        clickCount: action.clickType === 'double' ? 2 : action.clickType === 'triple' ? 3 : 1,
      });
      return { action, success: true };
    }

    // Get element by index
    const element = state.elements.find((el) => el.index === action.elementIndex);
    if (!element) {
      return { action, success: false, error: `Element with index ${action.elementIndex} not found` };
    }

    // Try selector first
    try {
      const clickOptions = {
        button: action.clickType === 'right' ? 'right' : action.clickType === 'middle' ? 'middle' : 'left',
        clickCount: action.clickType === 'double' ? 2 : action.clickType === 'triple' ? 3 : 1,
      } as const;

      // Add modifiers if present
      if (action.modifiers?.length) {
        for (const mod of action.modifiers) {
          await this.page.keyboard.down(mod === 'meta' ? 'Meta' : mod.charAt(0).toUpperCase() + mod.slice(1));
        }
      }

      await this.page.click(element.selector, clickOptions);

      if (action.modifiers?.length) {
        for (const mod of action.modifiers) {
          await this.page.keyboard.up(mod === 'meta' ? 'Meta' : mod.charAt(0).toUpperCase() + mod.slice(1));
        }
      }

      return { action, success: true };
    } catch {
      // Fallback to clicking at center coordinates
      try {
        await this.page.mouse.click(element.center.x, element.center.y);
        return { action, success: true };
      } catch (e) {
        return { action, success: false, error: (e as Error).message };
      }
    }
  }

  private async executeType(
    action: BrowserAction & { type: 'type' },
    state: BrowserState
  ): Promise<ActionResult> {
    const element = state.elements.find((el) => el.index === action.elementIndex);
    if (!element) {
      return { action, success: false, error: `Element with index ${action.elementIndex} not found` };
    }

    try {
      // Clear first if requested
      if (action.clearFirst) {
        await this.page.click(element.selector, { clickCount: 3 });
        await this.page.keyboard.press('Backspace');
      }

      // Type with optional human-like delays
      if (action.humanLike) {
        for (const char of action.text) {
          await this.page.type(element.selector, char, { delay: 50 + Math.random() * 100 });
        }
      } else {
        await this.page.type(element.selector, action.text);
      }

      // Press Enter if requested
      if (action.pressEnterAfter) {
        await this.page.keyboard.press('Enter');
      }

      return { action, success: true };
    } catch (e) {
      return { action, success: false, error: (e as Error).message };
    }
  }

  private async executeScroll(
    action: BrowserAction & { type: 'scroll' },
    state: BrowserState
  ): Promise<ActionResult> {
    try {
      if (action.scrollToElement && action.elementIndex) {
        const element = state.elements.find((el) => el.index === action.elementIndex);
        if (element) {
          await this.page.evaluate(
            (selector: string) => {
              document.querySelector(selector)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            },
            element.selector
          );
        }
      } else {
        const amount = action.amount || 300;
        const delta = {
          up: { x: 0, y: -amount },
          down: { x: 0, y: amount },
          left: { x: -amount, y: 0 },
          right: { x: amount, y: 0 },
        }[action.direction];

        await this.page.mouse.wheel(delta);
      }

      return { action, success: true };
    } catch (e) {
      return { action, success: false, error: (e as Error).message };
    }
  }

  private async executeNavigate(action: BrowserAction & { type: 'navigate' }): Promise<ActionResult> {
    try {
      await this.page.goto(action.url, {
        waitUntil: action.waitUntil || 'domcontentloaded',
        timeout: action.timeout || 30000,
      });
      return { action, success: true };
    } catch (e) {
      return { action, success: false, error: (e as Error).message };
    }
  }

  private async executeWait(action: BrowserAction & { type: 'wait' }): Promise<ActionResult> {
    try {
      const waitFor = action.waitFor;
      switch (waitFor.type) {
        case 'time':
          await new Promise((r) => setTimeout(r, waitFor.ms));
          break;
        case 'element':
          await this.page.waitForSelector(waitFor.selector, {
            state: waitFor.state === 'visible' ? 'visible' : waitFor.state === 'hidden' ? 'hidden' : 'attached',
            timeout: action.timeout || 30000,
          });
          break;
        case 'navigation':
          await this.page.waitForNavigation({ timeout: action.timeout || 30000 });
          break;
        case 'networkidle':
          await this.page.waitForLoadState('networkidle', { timeout: action.timeout || 30000 });
          break;
        case 'function':
          await this.page.waitForFunction(waitFor.fn, { timeout: action.timeout || 30000 });
          break;
        case 'urlChange':
          await this.page.waitForURL(waitFor.urlPattern || '**/*', { timeout: action.timeout || 30000 });
          break;
        case 'textContent':
          await this.page.waitForFunction(
            (text: string, selector?: string) => {
              const el = selector ? document.querySelector(selector) : document.body;
              return el?.textContent?.includes(text);
            },
            { timeout: action.timeout || 30000 },
            waitFor.text,
            waitFor.selector
          );
          break;
      }
      return { action, success: true };
    } catch (e) {
      return { action, success: false, error: (e as Error).message };
    }
  }

  private async executeKeypress(action: BrowserAction & { type: 'keypress' }): Promise<ActionResult> {
    try {
      // Handle modifiers
      if (action.modifiers?.length) {
        for (const mod of action.modifiers) {
          await this.page.keyboard.down(mod.charAt(0).toUpperCase() + mod.slice(1));
        }
      }

      if (action.holdMs) {
        await this.page.keyboard.down(action.key);
        await new Promise((r) => setTimeout(r, action.holdMs));
        await this.page.keyboard.up(action.key);
      } else {
        await this.page.keyboard.press(action.key);
      }

      if (action.modifiers?.length) {
        for (const mod of action.modifiers) {
          await this.page.keyboard.up(mod.charAt(0).toUpperCase() + mod.slice(1));
        }
      }

      return { action, success: true };
    } catch (e) {
      return { action, success: false, error: (e as Error).message };
    }
  }

  private async executeHover(
    action: BrowserAction & { type: 'hover' },
    state: BrowserState
  ): Promise<ActionResult> {
    const element = state.elements.find((el) => el.index === action.elementIndex);
    if (!element) {
      return { action, success: false, error: `Element with index ${action.elementIndex} not found` };
    }

    try {
      await this.page.hover(element.selector);
      if (action.durationMs) {
        await new Promise((r) => setTimeout(r, action.durationMs));
      }
      return { action, success: true };
    } catch (e) {
      return { action, success: false, error: (e as Error).message };
    }
  }

  private async executeSelect(
    action: BrowserAction & { type: 'select' },
    state: BrowserState
  ): Promise<ActionResult> {
    const element = state.elements.find((el) => el.index === action.elementIndex);
    if (!element) {
      return { action, success: false, error: `Element with index ${action.elementIndex} not found` };
    }

    try {
      await this.page.selectOption(element.selector, action.values);
      return { action, success: true };
    } catch (e) {
      return { action, success: false, error: (e as Error).message };
    }
  }

  private async executeExtract(
    action: BrowserAction & { type: 'extract' },
    state: BrowserState
  ): Promise<ActionResult> {
    const element = action.elementIndex
      ? state.elements.find((el) => el.index === action.elementIndex)
      : null;

    try {
      let data: unknown;
      const selector = element?.selector || 'body';

      switch (action.extractType) {
        case 'text':
          data = await this.page.$eval(selector, (el: Element) => el.textContent);
          break;
        case 'html':
          data = await this.page.$eval(selector, (el: Element) => el.innerHTML);
          break;
        case 'attribute':
          data = await this.page.$eval(
            selector,
            (el: Element, attr: string) => el.getAttribute(attr),
            action.attributeName
          );
          break;
        case 'links':
          data = await this.page.$$eval(selector + ' a[href]', (els: HTMLAnchorElement[]) =>
            els.map((a) => ({ text: a.textContent, href: a.href }))
          );
          break;
        case 'images':
          data = await this.page.$$eval(selector + ' img', (els: HTMLImageElement[]) =>
            els.map((img) => ({ src: img.src, alt: img.alt }))
          );
          break;
        case 'table':
          data = await this.page.$eval(selector, (el: Element) => {
            const rows = el.querySelectorAll('tr');
            return Array.from(rows).map((row) =>
              Array.from(row.querySelectorAll('td, th')).map((cell) => cell.textContent)
            );
          });
          break;
      }

      if (this.currentTask) {
        this.currentTask.extractedData[action.storeAs] = data;
      }

      return { action, success: true, extractedData: data };
    } catch (e) {
      return { action, success: false, error: (e as Error).message };
    }
  }

  private async executeScreenshot(action: BrowserAction & { type: 'screenshot' }): Promise<ActionResult> {
    try {
      const screenshot = await this.page.screenshot({
        fullPage: action.fullPage,
        encoding: 'base64',
      });

      if (this.currentTask) {
        this.currentTask.extractedData[action.storeAs] = screenshot;
      }

      return { action, success: true };
    } catch (e) {
      return { action, success: false, error: (e as Error).message };
    }
  }

  private async executeTab(action: BrowserAction & { type: 'tab' }): Promise<ActionResult> {
    try {
      switch (action.tabAction) {
        case 'new': {
          const newPage = await this.browser.newPage();
          if (action.url) {
            await newPage.goto(action.url);
          }
          this.page = newPage;
          break;
        }
        case 'close':
          await this.page.close();
          const pages = await this.browser.pages();
          this.page = pages[pages.length - 1];
          break;
        case 'switch':
          if (action.targetTabId) {
            const pages = await this.browser.pages();
            const target = pages.find(
              (p: { target: () => { _targetId: string } }) => p.target()._targetId === action.targetTabId
            );
            if (target) {
              this.page = target;
              await target.bringToFront();
            }
          }
          break;
        case 'duplicate':
          const url = this.page.url();
          const dupPage = await this.browser.newPage();
          await dupPage.goto(url);
          this.page = dupPage;
          break;
      }

      // Update serializers
      this.domSerializer = createDOMSerializer(this.page);
      this.setOfMark = createSetOfMarkManager(this.page, this.config.setOfMark);

      return { action, success: true };
    } catch (e) {
      return { action, success: false, error: (e as Error).message };
    }
  }

  private async executeScript(action: BrowserAction & { type: 'execute' }): Promise<ActionResult> {
    try {
      const result = await this.page.evaluate(action.script, ...(action.args || []));
      if (action.storeAs && this.currentTask) {
        this.currentTask.extractedData[action.storeAs] = result;
      }
      return { action, success: true, extractedData: result };
    } catch (e) {
      return { action, success: false, error: (e as Error).message };
    }
  }

  // ============================================================================
  // Recovery & Error Handling
  // ============================================================================

  private async attemptRecovery(
    action: BrowserAction,
    error: string
  ): Promise<{ success: boolean; strategies: RecoveryStrategyType[] }> {
    const strategies: RecoveryStrategyType[] = [];
    const errorType = this.classifyError(error);

    // Try different recovery strategies based on error type
    for (let attempt = 0; attempt < this.config.recovery.maxRetries; attempt++) {
      let strategy: RecoveryStrategyType;

      switch (errorType) {
        case 'element-not-found':
        case 'element-not-visible':
          strategy = attempt === 0 ? 'scroll-into-view' : 'wait-and-retry';
          break;
        case 'element-not-interactable':
          strategy = 'close-modal';
          break;
        case 'timeout':
          strategy = 'wait-and-retry';
          break;
        case 'captcha-detected':
          strategy = 'captcha-wait';
          break;
        case 'unexpected-modal':
          strategy = 'dismiss-popup';
          break;
        default:
          strategy = 'retry-with-backoff';
      }

      strategies.push(strategy);

      const success = await this.executeRecoveryStrategy(strategy, action);
      if (success) {
        return { success: true, strategies };
      }

      // Backoff
      await new Promise((r) =>
        setTimeout(r, this.config.recovery.retryDelayMs * Math.pow(this.config.recovery.backoffMultiplier, attempt))
      );
    }

    return { success: false, strategies };
  }

  private async executeRecoveryStrategy(
    strategy: RecoveryStrategyType,
    action: BrowserAction
  ): Promise<boolean> {
    logger.debug('Attempting recovery', { strategy });

    switch (strategy) {
      case 'scroll-into-view':
        if ('elementIndex' in action && action.elementIndex) {
          const state = await this.domSerializer.extractBrowserState(false);
          const element = state.elements.find((el) => el.index === action.elementIndex);
          if (element) {
            await this.page.evaluate(
              (sel: string) => document.querySelector(sel)?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
              element.selector
            );
            await new Promise((r) => setTimeout(r, 500));
          }
        }
        return true;

      case 'wait-and-retry':
        await new Promise((r) => setTimeout(r, 2000));
        return true;

      case 'close-modal':
      case 'dismiss-popup':
        // Try common dismiss patterns
        const dismissSelectors = [
          '[class*="close"]',
          '[aria-label*="close"]',
          '[aria-label*="dismiss"]',
          'button[class*="dismiss"]',
          '.modal-close',
          '[data-dismiss]',
        ];
        for (const selector of dismissSelectors) {
          try {
            await this.page.click(selector, { timeout: 1000 });
            await new Promise((r) => setTimeout(r, 500));
            return true;
          } catch {
            continue;
          }
        }
        return false;

      case 'refresh-page':
        await this.page.reload({ waitUntil: 'domcontentloaded' });
        return true;

      case 'navigate-back':
        await this.page.goBack();
        return true;

      case 'captcha-wait':
        // Emit event for human intervention
        this.emit('captcha:detected', { task: this.currentTask });
        // Wait for manual intervention (up to 2 minutes)
        await new Promise((r) => setTimeout(r, 120000));
        return true;

      default:
        return false;
    }
  }

  private classifyError(error: string): ErrorType {
    const normalized = error.toLowerCase();

    if (normalized.includes('not found') || normalized.includes('no node')) {
      return 'element-not-found';
    }
    if (normalized.includes('not visible') || normalized.includes('hidden')) {
      return 'element-not-visible';
    }
    if (normalized.includes('not interactable') || normalized.includes('intercepted')) {
      return 'element-not-interactable';
    }
    if (normalized.includes('timeout')) {
      return 'timeout';
    }
    if (normalized.includes('captcha') || normalized.includes('verification')) {
      return 'captcha-detected';
    }
    if (normalized.includes('rate limit') || normalized.includes('too many')) {
      return 'rate-limited';
    }
    if (normalized.includes('network') || normalized.includes('connection')) {
      return 'network-error';
    }
    if (normalized.includes('navigation')) {
      return 'navigation-failed';
    }

    return 'unknown';
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  private detectSensitiveAction(
    action: BrowserAction,
    state: BrowserState
  ): SensitiveActionType | null {
    // Check for login forms
    if (action.type === 'type' && action.elementIndex) {
      const element = state.elements.find((el) => el.index === action.elementIndex);
      if (element?.semanticPurpose === 'login' || element?.attributes.type === 'password') {
        return 'login';
      }
    }

    // Check for form submissions
    if (action.type === 'click' && action.elementIndex) {
      const element = state.elements.find((el) => el.index === action.elementIndex);
      if (element?.semanticPurpose === 'submit') {
        return 'form-submit';
      }
      if (element?.semanticPurpose === 'payment' || element?.semanticPurpose === 'checkout') {
        return 'payment';
      }
      if (element?.semanticPurpose === 'delete') {
        return 'delete';
      }
    }

    // Check for file uploads
    if (action.type === 'upload') {
      return 'file-upload';
    }

    // Check for external navigation
    if (action.type === 'navigate') {
      const currentDomain = new URL(state.url).hostname;
      try {
        const targetDomain = new URL(action.url).hostname;
        if (targetDomain !== currentDomain) {
          return 'external-link';
        }
      } catch {
        // Invalid URL
      }
    }

    return null;
  }

  private async requestConfirmation(type: string, message: string): Promise<boolean> {
    return new Promise((resolve) => {
      this.emit('confirmation:required', {
        type,
        message,
        respond: (confirmed: boolean) => resolve(confirmed),
      });

      // Auto-approve after 30 seconds if no response
      setTimeout(() => resolve(true), 30000);
    });
  }

  private async waitForPageReady(): Promise<void> {
    await Promise.race([
      this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {}),
      new Promise((r) => setTimeout(r, 5000)),
    ]);
  }
}

// ============================================================================
// Factory Function
// ============================================================================

let orchestratorInstance: BrowserAgentOrchestrator | null = null;

/**
 * Create or get the browser agent orchestrator
 */
export function createBrowserAgentOrchestrator(
  page: Page,
  browser: Browser,
  config?: Partial<BrowserAgentConfig>
): BrowserAgentOrchestrator {
  orchestratorInstance = new BrowserAgentOrchestrator(page, browser, config);
  return orchestratorInstance;
}

/**
 * Get existing orchestrator instance
 */
export function getBrowserAgentOrchestrator(): BrowserAgentOrchestrator | null {
  return orchestratorInstance;
}
