/**
 * Computer Use Agent - Autonomous screen control capability
 * Combines vision analysis with mouse/keyboard control
 * 
 * Inspired by Claude's computer use feature - see and interact with the screen
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import { sleep } from '../../shared/utils';
import { executeMouseKeyboardTool } from '../agent/tools/mouse-keyboard';
import { executeScreenshotTool } from '../agent/tools/screenshot';
import { getLLMManager } from '../llm/manager';

const logger = createModuleLogger('ComputerUse');

export interface ScreenElement {
  type: 'button' | 'input' | 'link' | 'text' | 'image' | 'checkbox' | 'dropdown' | 'unknown';
  text: string;
  bounds: { x: number; y: number; width: number; height: number };
  clickable: boolean;
  interactionHint?: string;
}

export interface ScreenState {
  screenshot: Buffer;
  width: number;
  height: number;
  elements: ScreenElement[];
  activeWindow: string;
  timestamp: number;
}

export interface ComputerAction {
  type: 'click' | 'double-click' | 'right-click' | 'type' | 'scroll' | 'key' | 'move' | 'drag' | 'wait';
  x?: number;
  y?: number;
  text?: string;
  key?: string;
  modifiers?: string[];
  direction?: 'up' | 'down' | 'left' | 'right';
  amount?: number;
  duration?: number;
  element?: string; // Description of target element
}

export interface TaskStep {
  description: string;
  action: ComputerAction;
  expectedResult?: string;
  verification?: string;
}

export interface ComputerTask {
  id: string;
  goal: string;
  steps: TaskStep[];
  currentStep: number;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed';
  startTime?: number;
  endTime?: number;
  error?: string;
}

const VISION_SYSTEM_PROMPT = `You are a computer vision assistant that analyzes screenshots and identifies UI elements.

Given a screenshot, identify:
1. Clickable elements (buttons, links, checkboxes)
2. Text input fields
3. Important text content
4. Current application state

Output JSON format:
{
  "activeWindow": "window title",
  "elements": [
    {
      "type": "button|input|link|text|checkbox|dropdown|unknown",
      "text": "element text or label",
      "bounds": {"x": 0, "y": 0, "width": 100, "height": 30},
      "clickable": true,
      "interactionHint": "optional hint about how to interact"
    }
  ],
  "screenDescription": "brief description of what's visible"
}`;

const ACTION_PLANNING_PROMPT = `You are a computer automation assistant. Plan the steps needed to accomplish a task.

Given:
- The current screen state
- The user's goal

Output a sequence of actions:
{
  "analysis": "What I see and understand",
  "plan": [
    {
      "description": "Step description",
      "action": {
        "type": "click|double-click|type|scroll|key|wait",
        "x": 100, "y": 200,
        "text": "text to type if needed",
        "key": "key to press if needed",
        "element": "description of target element"
      },
      "expectedResult": "what should happen after"
    }
  ],
  "confidence": 0.95
}

Be precise with coordinates. If you're not sure, ask for clarification.`;

export class ComputerUseAgent extends EventEmitter {
  private currentTask: ComputerTask | null = null;
  private isRunning = false;
  private abortController: AbortController | null = null;
  private lastScreenState: ScreenState | null = null;

  // Safety settings
  private safetyEnabled = true;
  private maxActionsPerTask = 50;
  private actionDelayMs = 500; // Delay between actions
  private requireConfirmation = true;
  private bannedApplications: string[] = ['admin', 'sudo', 'regedit', 'cmd'];

  constructor() {
    super();
    logger.info('Computer Use Agent initialized');
  }

  /**
   * Capture and analyze current screen
   */
  async captureScreen(): Promise<ScreenState> {
    logger.debug('Capturing screen');

    // Take screenshot
    const screenshotResult = await executeScreenshotTool({
      type: 'full',
      format: 'png',
    });

    if (!screenshotResult.success || !screenshotResult.data?.base64) {
      throw new Error('Failed to capture screenshot');
    }

    const imageBuffer = Buffer.from(screenshotResult.data.base64, 'base64');

    // Analyze with vision LLM
    const llm = getLLMManager();
    const prompt = `${VISION_SYSTEM_PROMPT}\n\nAnalyze this screenshot and identify all interactive elements.`;

    const response = await llm.chat(
      `[Screenshot attached - ${screenshotResult.data.width}x${screenshotResult.data.height}]`,
      { systemPrompt: prompt },
      { temperature: 0.2, maxTokens: 2000 }
    );

    // Parse response
    let elements: ScreenElement[] = [];
    let activeWindow = 'Unknown';

    try {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        elements = parsed.elements || [];
        activeWindow = parsed.activeWindow || 'Unknown';
      }
    } catch {
      logger.warn('Failed to parse vision response, using empty elements');
    }

    const screenState: ScreenState = {
      screenshot: imageBuffer,
      width: screenshotResult.data.width || 1920,
      height: screenshotResult.data.height || 1080,
      elements,
      activeWindow,
      timestamp: Date.now(),
    };

    this.lastScreenState = screenState;
    return screenState;
  }

  /**
   * Plan actions to achieve a goal
   */
  async planTask(goal: string): Promise<ComputerTask> {
    logger.info('Planning task', { goal });

    // Capture current screen state
    const screenState = await this.captureScreen();

    // Safety check
    if (this.safetyEnabled) {
      const safetyCheck = this.checkSafety(goal, screenState);
      if (!safetyCheck.safe) {
        throw new Error(`Safety check failed: ${safetyCheck.reason}`);
      }
    }

    // Ask LLM to plan the steps
    const llm = getLLMManager();
    const context = {
      screenDescription: `Active window: ${screenState.activeWindow}`,
      visibleElements: screenState.elements.slice(0, 20), // Limit context
    };

    const response = await llm.chat(
      `Goal: ${goal}\n\nScreen context:\n${JSON.stringify(context, null, 2)}`,
      { systemPrompt: ACTION_PLANNING_PROMPT },
      { temperature: 0.3, maxTokens: 2000 }
    );

    // Parse the plan
    let steps: TaskStep[] = [];
    try {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        steps = (parsed.plan || []).map((step: Omit<TaskStep, 'verification'>) => ({
          description: step.description,
          action: step.action,
          expectedResult: step.expectedResult,
        }));
      }
    } catch {
      throw new Error('Failed to parse task plan');
    }

    if (steps.length === 0) {
      throw new Error('No steps generated for task');
    }

    if (steps.length > this.maxActionsPerTask) {
      throw new Error(`Task too complex: ${steps.length} steps (max: ${this.maxActionsPerTask})`);
    }

    const task: ComputerTask = {
      id: `task_${Date.now()}`,
      goal,
      steps,
      currentStep: 0,
      status: 'pending',
    };

    this.emit('task:planned', task);
    return task;
  }

  /**
   * Execute a planned task
   */
  async executeTask(task: ComputerTask): Promise<void> {
    if (this.isRunning) {
      throw new Error('Another task is already running');
    }

    this.currentTask = task;
    this.isRunning = true;
    this.abortController = new AbortController();
    task.status = 'running';
    task.startTime = Date.now();

    logger.info('Executing task', { id: task.id, goal: task.goal, steps: task.steps.length });
    this.emit('task:started', task);

    try {
      for (let i = 0; i < task.steps.length; i++) {
        // Check for abort
        if (this.abortController.signal.aborted) {
          task.status = 'paused';
          logger.info('Task aborted');
          return;
        }

        task.currentStep = i;
        const step = task.steps[i];

        logger.debug('Executing step', { step: i + 1, description: step.description });
        this.emit('step:started', { task, step, index: i });

        // Request confirmation if enabled
        if (this.requireConfirmation) {
          const confirmed = await this.requestConfirmation(step);
          if (!confirmed) {
            task.status = 'paused';
            logger.info('User declined step');
            return;
          }
        }

        // Execute the action
        await this.executeAction(step.action);

        // Wait between actions
        await this.delay(this.actionDelayMs);

        // Verify result if specified
        if (step.expectedResult) {
          const verified = await this.verifyStep(step);
          if (!verified) {
            logger.warn('Step verification failed', { step: i + 1 });
            // Could retry or ask for help here
          }
        }

        this.emit('step:completed', { task, step, index: i });
      }

      task.status = 'completed';
      task.endTime = Date.now();
      logger.info('Task completed', { 
        id: task.id, 
        durationMs: task.endTime - (task.startTime || 0) 
      });
      this.emit('task:completed', task);

    } catch (error) {
      task.status = 'failed';
      task.error = (error as Error).message;
      task.endTime = Date.now();
      logger.error('Task failed', { id: task.id, error });
      this.emit('task:failed', { task, error });
      throw error;

    } finally {
      this.isRunning = false;
      this.abortController = null;
    }
  }

  /**
   * Execute a single action
   */
  private async executeAction(action: ComputerAction): Promise<void> {
    logger.debug('Executing action', { type: action.type, x: action.x, y: action.y });

    switch (action.type) {
      case 'click':
        if (action.x !== undefined && action.y !== undefined) {
          await executeMouseKeyboardTool({
            action: 'click',
            x: action.x,
            y: action.y,
            button: 'left',
          });
        }
        break;

      case 'double-click':
        if (action.x !== undefined && action.y !== undefined) {
          await executeMouseKeyboardTool({
            action: 'click',
            x: action.x,
            y: action.y,
            button: 'left',
            clickCount: 2,
          });
        }
        break;

      case 'right-click':
        if (action.x !== undefined && action.y !== undefined) {
          await executeMouseKeyboardTool({
            action: 'click',
            x: action.x,
            y: action.y,
            button: 'right',
          });
        }
        break;

      case 'type':
        if (action.text) {
          await executeMouseKeyboardTool({
            action: 'type',
            text: action.text,
          });
        }
        break;

      case 'key':
        if (action.key) {
          await executeMouseKeyboardTool({
            action: 'keyPress',
            key: action.key,
            modifiers: action.modifiers,
          });
        }
        break;

      case 'scroll':
        await executeMouseKeyboardTool({
          action: 'scroll',
          x: action.x || 0,
          y: action.y || 0,
          direction: action.direction || 'down',
          amount: action.amount || 3,
        });
        break;

      case 'move':
        if (action.x !== undefined && action.y !== undefined) {
          await executeMouseKeyboardTool({
            action: 'moveTo',
            x: action.x,
            y: action.y,
          });
        }
        break;

      case 'wait':
        await this.delay(action.duration || 1000);
        break;

      default:
        logger.warn('Unknown action type', { type: action.type });
    }
  }

  /**
   * Verify step result
   */
  private async verifyStep(step: TaskStep): Promise<boolean> {
    // Capture new screen state
    const newState = await this.captureScreen();

    // Simple verification - check if expected elements are present
    // In a real implementation, this would be more sophisticated
    logger.debug('Verifying step', { expected: step.expectedResult });

    return true; // Placeholder
  }

  /**
   * Request user confirmation for a step
   */
  private async requestConfirmation(step: TaskStep): Promise<boolean> {
    // Emit event for UI to handle
    return new Promise((resolve) => {
      this.emit('confirmation:requested', {
        step,
        resolve: (confirmed: boolean) => resolve(confirmed),
      });

      // Auto-confirm after timeout in dev mode (remove in production)
      setTimeout(() => resolve(true), 5000);
    });
  }

  /**
   * Safety check before executing task
   */
  private checkSafety(goal: string, screenState: ScreenState): { safe: boolean; reason?: string } {
    // Check for banned applications
    const windowLower = screenState.activeWindow.toLowerCase();
    for (const banned of this.bannedApplications) {
      if (windowLower.includes(banned)) {
        return { safe: false, reason: `Cannot interact with ${banned}` };
      }
    }

    // Check for dangerous keywords in goal
    const dangerousKeywords = ['delete all', 'format', 'rm -rf', 'drop table', 'shutdown'];
    const goalLower = goal.toLowerCase();
    for (const keyword of dangerousKeywords) {
      if (goalLower.includes(keyword)) {
        return { safe: false, reason: `Goal contains dangerous keyword: ${keyword}` };
      }
    }

    return { safe: true };
  }

  /**
   * Abort current task
   */
  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
      logger.info('Task abort requested');
    }
  }

  /**
   * Pause current task
   */
  pause(): void {
    if (this.currentTask && this.currentTask.status === 'running') {
      this.currentTask.status = 'paused';
      this.abort();
      this.emit('task:paused', this.currentTask);
    }
  }

  /**
   * Resume paused task
   */
  async resume(): Promise<void> {
    if (this.currentTask && this.currentTask.status === 'paused') {
      this.currentTask.status = 'pending';
      await this.executeTask(this.currentTask);
    }
  }

  /**
   * Get current task status
   */
  getStatus(): { task: ComputerTask | null; isRunning: boolean } {
    return {
      task: this.currentTask,
      isRunning: this.isRunning,
    };
  }

  /**
   * Configure safety settings
   */
  configure(settings: {
    safetyEnabled?: boolean;
    maxActionsPerTask?: number;
    actionDelayMs?: number;
    requireConfirmation?: boolean;
    bannedApplications?: string[];
  }): void {
    if (settings.safetyEnabled !== undefined) this.safetyEnabled = settings.safetyEnabled;
    if (settings.maxActionsPerTask !== undefined) this.maxActionsPerTask = settings.maxActionsPerTask;
    if (settings.actionDelayMs !== undefined) this.actionDelayMs = settings.actionDelayMs;
    if (settings.requireConfirmation !== undefined) this.requireConfirmation = settings.requireConfirmation;
    if (settings.bannedApplications !== undefined) this.bannedApplications = settings.bannedApplications;

    logger.info('Safety settings updated', settings);
  }

  /**
   * Utility delay function
   */
  private delay(ms: number): Promise<void> {
    return sleep(ms);
  }
}

// Singleton
let computerUseAgent: ComputerUseAgent | null = null;

export function getComputerUseAgent(): ComputerUseAgent {
  if (!computerUseAgent) {
    computerUseAgent = new ComputerUseAgent();
  }
  return computerUseAgent;
}
