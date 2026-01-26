/**
 * Atlas Desktop - Task Execution Engine
 * T2-305: Execute multi-step tasks with error handling and rollback
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import { getErrorMessage } from '../../shared/utils';
import { getTaskQueueManager, TaskQueueManager } from './task-queue';
import { executeToolCall } from './tool-registry';
import type {
  Task,
  TaskStep,
  StepResult,
  TaskContext,
  TaskResult,
  ToolStepConfig,
  LLMStepConfig,
  WaitStepConfig,
  ConditionStepConfig,
  ParallelStepConfig,
  LoopStepConfig,
  DelayStepConfig,
} from '../../shared/types/task';

const logger = createModuleLogger('task-executor');

/**
 * Pending user input request
 */
interface PendingInput {
  taskId: string;
  stepId: string;
  prompt: string;
  inputType: 'text' | 'confirmation' | 'choice';
  choices?: string[];
  resolve: (value: string) => void;
  reject: (error: Error) => void;
}

/**
 * Task Execution Engine
 * Executes multi-step tasks with support for various step types
 */
export class TaskExecutionEngine extends EventEmitter {
  private queueManager: TaskQueueManager;
  private isRunning: boolean = false;
  private pendingInputs: Map<string, PendingInput> = new Map();
  private abortControllers: Map<string, AbortController> = new Map();
  private llmCallback?: (prompt: string, systemPrompt?: string) => Promise<string>;
  private taskStartedHandler?: (task: Task) => void;

  constructor(queueManager?: TaskQueueManager) {
    super();
    this.queueManager = queueManager || getTaskQueueManager();
    logger.info('TaskExecutionEngine initialized');
  }

  /**
   * Set the LLM callback for LLM steps
   */
  setLLMCallback(callback: (prompt: string, systemPrompt?: string) => Promise<string>): void {
    this.llmCallback = callback;
    logger.info('LLM callback set');
  }

  /**
   * Start the execution engine
   */
  start(): void {
    if (this.isRunning) {
      logger.warn('Execution engine already running');
      return;
    }

    this.isRunning = true;
    this.subscribeToQueue();

    logger.info('Execution engine started');
  }

  /**
   * Stop the execution engine
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;

    // Unsubscribe from queue events
    if (this.taskStartedHandler) {
      this.queueManager.off('task:started', this.taskStartedHandler);
      this.taskStartedHandler = undefined;
    }

    logger.info('Execution engine stopped');
  }

  /**
   * Subscribe to queue events for task execution
   */
  private subscribeToQueue(): void {
    this.taskStartedHandler = (task: Task) => {
      this.executeTask(task).catch((error) => {
        logger.error('Task execution failed', { taskId: task.id, error });
      });
    };
    this.queueManager.on('task:started', this.taskStartedHandler);
  }

  /**
   * Execute a task
   */
  async executeTask(task: Task): Promise<TaskResult> {
    logger.info('Executing task', { taskId: task.id, name: task.name });

    // Create abort controller for this task
    const abortController = new AbortController();
    this.abortControllers.set(task.id, abortController);

    // Initialize task context
    const context: TaskContext = {
      variables: { ...task.initialContext },
      stepResults: {},
      sessionId: `session_${Date.now()}`,
      startedAt: Date.now(),
    };
    task.context = context;

    const stepResults: StepResult[] = [];
    let currentStepIndex = 0;

    try {
      // Execute steps sequentially (respecting dependencies)
      while (currentStepIndex < task.steps.length) {
        // Check for abort
        if (abortController.signal.aborted) {
          throw new Error('Task cancelled');
        }

        // Check for pause
        if (task.status === 'paused') {
          await this.waitForResume(task.id, abortController.signal);
        }

        const step = task.steps[currentStepIndex];

        // Check dependencies
        if (step.dependsOn && step.dependsOn.length > 0) {
          const allDependenciesMet = step.dependsOn.every((depId) => {
            const depStep = task.steps.find((s) => s.id === depId);
            return depStep?.status === 'completed';
          });

          if (!allDependenciesMet) {
            // Skip for now, will be executed later
            currentStepIndex++;
            continue;
          }
        }

        // Execute step
        task.currentStepId = step.id;
        this.queueManager.emit('task:step-started', task.id, step);

        const result = await this.executeStep(step, context, abortController.signal);
        stepResults.push(result);
        context.stepResults[step.id] = result;

        this.queueManager.emit('task:step-completed', task.id, step, result);

        // Handle step result
        if (result.status === 'failed') {
          if (step.errorStrategy === 'fail') {
            throw new Error(result.error || 'Step failed');
          } else if (
            step.errorStrategy === 'retry' &&
            (step.maxRetries || 3) > (result.attempts || 1)
          ) {
            // Retry this step
            continue;
          }
          // Otherwise skip
        }

        // Update progress
        const progress = Math.round(((currentStepIndex + 1) / task.steps.length) * 100);
        this.queueManager.updateProgress(task.id, progress, step.id);

        currentStepIndex++;
      }

      // All steps completed
      const taskResult: TaskResult = {
        taskId: task.id,
        status: 'completed',
        data: this.aggregateResults(stepResults),
        duration: Date.now() - context.startedAt,
        completedSteps: stepResults.filter((r) => r.status === 'completed').length,
        totalSteps: task.steps.length,
        stepResults,
        context,
        completedAt: Date.now(),
      };

      task.result = taskResult;
      this.queueManager.completeTask(task.id, 'completed', taskResult.data);

      return taskResult;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Task execution error', { taskId: task.id, error: errorMessage });

      const taskResult: TaskResult = {
        taskId: task.id,
        status: 'failed',
        error: errorMessage,
        duration: Date.now() - context.startedAt,
        completedSteps: stepResults.filter((r) => r.status === 'completed').length,
        totalSteps: task.steps.length,
        stepResults,
        context,
        completedAt: Date.now(),
      };

      task.result = taskResult;
      this.queueManager.completeTask(task.id, 'failed', undefined, errorMessage);

      return taskResult;
    } finally {
      this.abortControllers.delete(task.id);
    }
  }

  /**
   * Execute a single step
   */
  private async executeStep(
    step: TaskStep,
    context: TaskContext,
    signal: AbortSignal
  ): Promise<StepResult> {
    const startTime = Date.now();
    step.status = 'running';

    try {
      let data: unknown;

      switch (step.config.type) {
        case 'tool':
          data = await this.executeToolStep(step.config, context, signal);
          break;
        case 'llm':
          data = await this.executeLLMStep(step.config, context);
          break;
        case 'wait':
          data = await this.executeWaitStep(step, step.config);
          break;
        case 'condition':
          data = await this.executeConditionStep(step.config, context);
          break;
        case 'parallel':
          data = await this.executeParallelStep(step, step.config, context, signal);
          break;
        case 'loop':
          data = await this.executeLoopStep(step, step.config, context, signal);
          break;
        case 'delay':
          data = await this.executeDelayStep(step.config, signal);
          break;
        default:
          throw new Error(`Unknown step type: ${(step.config as { type: string }).type}`);
      }

      step.status = 'completed';
      return {
        stepId: step.id,
        status: 'completed',
        data,
        duration: Date.now() - startTime,
        completedAt: Date.now(),
      };
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      step.status = 'failed';

      return {
        stepId: step.id,
        status: 'failed',
        error: errorMessage,
        duration: Date.now() - startTime,
        completedAt: Date.now(),
      };
    }
  }

  /**
   * Execute a tool step
   */
  private async executeToolStep(
    config: ToolStepConfig,
    context: TaskContext,
    _signal: AbortSignal
  ): Promise<unknown> {
    // Interpolate variables in parameters
    const params = this.interpolateVariables(config.parameters, context);

    logger.debug('Executing tool step', { tool: config.toolName, params });

    const result = await executeToolCall({
      name: config.toolName,
      arguments: params,
    });

    if (!result.success) {
      throw new Error(result.error || 'Tool execution failed');
    }

    return result.result;
  }

  /**
   * Execute an LLM step
   */
  private async executeLLMStep(config: LLMStepConfig, context: TaskContext): Promise<string> {
    if (!this.llmCallback) {
      throw new Error('LLM callback not configured');
    }

    // Interpolate variables in prompt
    const prompt = this.interpolateString(config.prompt, context);
    const systemPrompt = config.systemPrompt
      ? this.interpolateString(config.systemPrompt, context)
      : undefined;

    logger.debug('Executing LLM step', { promptLength: prompt.length });

    const result = await this.llmCallback(prompt, systemPrompt);

    // Store in variable if specified
    if (config.outputVariable) {
      context.variables[config.outputVariable] = result;
    }

    return result;
  }

  /**
   * Execute a wait for user input step
   */
  private async executeWaitStep(step: TaskStep, config: WaitStepConfig): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const pendingInput: PendingInput = {
        taskId: step.id,
        stepId: step.id,
        prompt: config.prompt,
        inputType: config.inputType,
        choices: config.choices,
        resolve,
        reject,
      };

      this.pendingInputs.set(step.id, pendingInput);
      this.emit('input-required', pendingInput);

      // Handle default timeout (5 minutes)
      setTimeout(
        () => {
          if (this.pendingInputs.has(step.id)) {
            this.pendingInputs.delete(step.id);
            if (config.defaultValue !== undefined) {
              resolve(config.defaultValue);
            } else {
              reject(new Error('User input timeout'));
            }
          }
        },
        5 * 60 * 1000
      );
    });
  }

  /**
   * Execute a condition step
   */
  private async executeConditionStep(
    config: ConditionStepConfig,
    context: TaskContext
  ): Promise<{ branch: 'then' | 'else'; nextStep: string }> {
    // Evaluate condition (simple expression evaluation)
    const result = this.evaluateCondition(config.condition, context);

    return {
      branch: result ? 'then' : 'else',
      nextStep: result ? config.thenStep : config.elseStep || '',
    };
  }

  /**
   * Execute parallel steps
   */
  private async executeParallelStep(
    step: TaskStep,
    config: ParallelStepConfig,
    context: TaskContext,
    signal: AbortSignal
  ): Promise<StepResult[]> {
    if (!step.substeps) {
      throw new Error('Parallel step has no substeps');
    }

    const stepsToExecute = step.substeps.filter((s) => config.steps.includes(s.id));

    // Limit concurrency
    const maxConcurrency = config.maxConcurrency || stepsToExecute.length;
    const results: StepResult[] = [];

    for (let i = 0; i < stepsToExecute.length; i += maxConcurrency) {
      const batch = stepsToExecute.slice(i, i + maxConcurrency);
      const batchResults = await Promise.all(
        batch.map((s) => this.executeStep(s, context, signal))
      );
      results.push(...batchResults);

      // If waitFor is 'first', return after first batch
      if (config.waitFor === 'first' && results.some((r) => r.status === 'completed')) {
        break;
      }
    }

    return results;
  }

  /**
   * Execute a loop step
   */
  private async executeLoopStep(
    step: TaskStep,
    config: LoopStepConfig,
    context: TaskContext,
    signal: AbortSignal
  ): Promise<StepResult[]> {
    const items = context.variables[config.itemsVariable] as unknown[];
    if (!Array.isArray(items)) {
      throw new Error(`Loop items variable "${config.itemsVariable}" is not an array`);
    }

    const results: StepResult[] = [];
    const maxIterations = config.maxIterations || 1000;

    for (let i = 0; i < Math.min(items.length, maxIterations); i++) {
      if (signal.aborted) {
        break;
      }

      context.variables[config.itemVariable] = items[i];

      const loopStep = step.substeps?.find((s) => s.id === config.stepId);
      if (!loopStep) {
        throw new Error(`Loop step "${config.stepId}" not found`);
      }

      const result = await this.executeStep(loopStep, context, signal);
      results.push(result);
    }

    return results;
  }

  /**
   * Execute a delay step
   */
  private async executeDelayStep(config: DelayStepConfig, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(resolve, config.durationMs);

      signal.addEventListener('abort', () => {
        clearTimeout(timeout);
        reject(new Error('Delay cancelled'));
      });
    });
  }

  /**
   * Wait for a paused task to resume
   */
  private async waitForResume(taskId: string, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const handler = (resumedTaskId: string) => {
        if (resumedTaskId === taskId) {
          this.queueManager.off('task:resumed', handler);
          resolve();
        }
      };

      this.queueManager.on('task:resumed', handler);

      signal.addEventListener('abort', () => {
        this.queueManager.off('task:resumed', handler);
        reject(new Error('Task cancelled while paused'));
      });
    });
  }

  /**
   * Provide user input for a pending step
   */
  provideInput(stepId: string, value: string): boolean {
    const pending = this.pendingInputs.get(stepId);
    if (!pending) {
      return false;
    }

    this.pendingInputs.delete(stepId);
    pending.resolve(value);
    return true;
  }

  /**
   * Cancel a running task
   */
  cancelTask(taskId: string): boolean {
    const controller = this.abortControllers.get(taskId);
    if (controller) {
      controller.abort();
      return true;
    }
    return this.queueManager.cancelTask(taskId);
  }

  /**
   * Interpolate variables in an object
   */
  private interpolateVariables(
    obj: Record<string, unknown>,
    context: TaskContext
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string') {
        result[key] = this.interpolateString(value, context);
      } else if (typeof value === 'object' && value !== null) {
        result[key] = this.interpolateVariables(value as Record<string, unknown>, context);
      } else {
        result[key] = value;
      }
    }

    return result;
  }

  /**
   * Interpolate variables in a string ({{variable}} syntax)
   */
  private interpolateString(str: string, context: TaskContext): string {
    return str.replace(/\{\{(\w+)\}\}/g, (_, varName) => {
      const value = context.variables[varName];
      return value !== undefined ? String(value) : `{{${varName}}}`;
    });
  }

  /**
   * Evaluate a simple condition expression
   */
  private evaluateCondition(condition: string, context: TaskContext): boolean {
    // Simple expression evaluation - supports basic comparisons
    // For security, we use a simple parser instead of eval
    const match = condition.match(/(\w+)\s*(==|!=|>|<|>=|<=)\s*(.+)/);
    if (!match) {
      // Just check if variable is truthy
      return !!context.variables[condition];
    }

    const [, varName, operator, valueStr] = match;
    const varValue = context.variables[varName];
    let compareValue: unknown = valueStr.trim();

    // Parse compare value
    if (compareValue === 'true') compareValue = true;
    else if (compareValue === 'false') compareValue = false;
    else if (compareValue === 'null') compareValue = null;
    else if (!isNaN(Number(compareValue))) compareValue = Number(compareValue);
    else if (
      typeof compareValue === 'string' &&
      (compareValue.startsWith('"') || compareValue.startsWith("'"))
    ) {
      compareValue = compareValue.slice(1, -1);
    }

    switch (operator) {
      case '==':
        return varValue == compareValue;
      case '!=':
        return varValue != compareValue;
      case '>':
        return Number(varValue) > Number(compareValue);
      case '<':
        return Number(varValue) < Number(compareValue);
      case '>=':
        return Number(varValue) >= Number(compareValue);
      case '<=':
        return Number(varValue) <= Number(compareValue);
      default:
        return false;
    }
  }

  /**
   * Aggregate results from all steps
   */
  private aggregateResults(results: StepResult[]): unknown {
    // Return the last successful result's data
    for (let i = results.length - 1; i >= 0; i--) {
      if (results[i].status === 'completed' && results[i].data !== undefined) {
        return results[i].data;
      }
    }
    return undefined;
  }

  /**
   * Get pending input requests
   */
  getPendingInputs(): PendingInput[] {
    return Array.from(this.pendingInputs.values());
  }

  /**
   * Check if engine is running
   */
  isEngineRunning(): boolean {
    return this.isRunning;
  }
}

// Singleton instance
let executionEngine: TaskExecutionEngine | null = null;

/**
 * Get or create the task execution engine instance
 */
export function getTaskExecutionEngine(): TaskExecutionEngine {
  if (!executionEngine) {
    executionEngine = new TaskExecutionEngine();
  }
  return executionEngine;
}

/**
 * Reset the task execution engine (for testing)
 */
export function resetTaskExecutionEngine(): void {
  if (executionEngine) {
    executionEngine.stop();
  }
  executionEngine = null;
}
