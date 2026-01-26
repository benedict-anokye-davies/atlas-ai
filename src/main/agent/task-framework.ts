/**
 * Atlas Desktop - Task Framework
 * Executes multi-step tasks with tool calls, LLM generation, and error handling
 */

import { EventEmitter } from 'events';
import type {
  Task,
  TaskStep,
  StepResult,
  StepConfig,
  ToolStepConfig,
  LLMStepConfig,
  WaitStepConfig,
  ConditionStepConfig,
  ParallelStepConfig,
  LoopStepConfig,
  DelayStepConfig,
  TaskContext,
} from '../../shared/types/task';
import { getTaskQueueManager, TaskQueueManager } from './task-queue';
import { executeToolCall } from './tool-registry';
import { agentLogger as logger } from '../utils/logger';
import { getErrorMessage } from '../../shared/utils';

/**
 * Task executor configuration
 */
export interface TaskExecutorConfig {
  /** Default step timeout in ms */
  defaultStepTimeout: number;
  /** Maximum retry delay in ms */
  maxRetryDelay: number;
  /** Base retry delay in ms */
  baseRetryDelay: number;
}

const DEFAULT_EXECUTOR_CONFIG: TaskExecutorConfig = {
  defaultStepTimeout: 60000, // 1 minute
  maxRetryDelay: 30000, // 30 seconds
  baseRetryDelay: 1000, // 1 second
};

/**
 * Task Executor
 * Handles the actual execution of task steps
 */
export class TaskExecutor extends EventEmitter {
  private config: TaskExecutorConfig;
  private queueManager: TaskQueueManager;
  private abortControllers: Map<string, AbortController> = new Map();
  private llmCallback?: (prompt: string, systemPrompt?: string) => Promise<string>;
  private userInputCallback?: (prompt: string, type: string, choices?: string[]) => Promise<string>;

  constructor(config: Partial<TaskExecutorConfig> = {}) {
    super();
    this.config = { ...DEFAULT_EXECUTOR_CONFIG, ...config };
    this.queueManager = getTaskQueueManager();

    // Listen for task:started events from queue
    this.queueManager.on('task:started', (task: Task) => {
      this.executeTask(task).catch((error) => {
        logger.error('[TaskExecutor] Task execution failed', {
          taskId: task.id,
          error: error.message,
        });
        this.queueManager.completeTask(task.id, 'failed', undefined, error.message);
      });
    });

    logger.info('[TaskExecutor] Initialized');
  }

  /**
   * Set the LLM callback for LLM steps
   */
  setLLMCallback(callback: (prompt: string, systemPrompt?: string) => Promise<string>): void {
    this.llmCallback = callback;
  }

  /**
   * Set the user input callback for wait steps
   */
  setUserInputCallback(
    callback: (prompt: string, type: string, choices?: string[]) => Promise<string>
  ): void {
    this.userInputCallback = callback;
  }

  /**
   * Execute a task
   */
  async executeTask(task: Task): Promise<void> {
    logger.info('[TaskExecutor] Starting task execution', {
      taskId: task.id,
      name: task.name,
      steps: task.steps.length,
    });

    const abortController = new AbortController();
    this.abortControllers.set(task.id, abortController);

    try {
      // Execute steps in order
      for (let i = 0; i < task.steps.length; i++) {
        // Check for abort
        if (abortController.signal.aborted) {
          logger.info('[TaskExecutor] Task aborted', { taskId: task.id });
          return;
        }

        // Check for pause
        if (task.status === 'paused') {
          logger.info('[TaskExecutor] Task paused, waiting...', { taskId: task.id });
          await this.waitForResume(task.id);
          // Re-check status after resume (could be cancelled)
          const currentTask = this.queueManager.getTask(task.id);
          if (!currentTask || currentTask.status === 'cancelled') {
            return;
          }
        }

        const step = task.steps[i];

        // Check dependencies
        const canExecute = await this.checkDependencies(task, step);
        if (!canExecute) {
          step.status = 'skipped';
          step.result = {
            stepId: step.id,
            status: 'skipped',
            duration: 0,
            completedAt: Date.now(),
          };
          continue;
        }

        // Execute the step
        const result = await this.executeStep(task, step, abortController.signal);

        // Update progress
        const progress = Math.round(((i + 1) / task.steps.length) * 100);
        this.queueManager.updateProgress(task.id, progress, step.id);

        // Handle step failure
        if (result.status === 'failed') {
          const shouldContinue = await this.handleStepFailure(task, step, result);
          if (!shouldContinue) {
            this.queueManager.completeTask(task.id, 'failed', undefined, result.error);
            return;
          }
        }

        // Store result in context
        if (task.context) {
          task.context.stepResults[step.id] = result;
        }
      }

      // All steps completed successfully
      const finalResult = this.aggregateResults(task);
      this.queueManager.completeTask(task.id, 'completed', finalResult);
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('[TaskExecutor] Task execution error', {
        taskId: task.id,
        error: errorMessage,
      });
      this.queueManager.completeTask(task.id, 'failed', undefined, errorMessage);
    } finally {
      this.abortControllers.delete(task.id);
    }
  }

  /**
   * Execute a single step
   */
  private async executeStep(task: Task, step: TaskStep, signal: AbortSignal): Promise<StepResult> {
    const startTime = Date.now();
    step.status = 'running';
    this.queueManager.updateStepStatus(task.id, step.id, 'running');

    logger.info('[TaskExecutor] Executing step', {
      taskId: task.id,
      stepId: step.id,
      stepName: step.name,
      stepType: step.type,
    });

    try {
      // Apply timeout
      const timeout = step.timeout || this.config.defaultStepTimeout;
      const result = await this.withTimeout(
        this.executeStepByType(task, step, signal),
        timeout,
        `Step "${step.name}" timed out after ${timeout}ms`
      );

      step.status = result.status;
      step.result = result;
      this.queueManager.updateStepStatus(task.id, step.id, result.status);

      return result;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      const result: StepResult = {
        stepId: step.id,
        status: 'failed',
        error: errorMessage,
        duration: Date.now() - startTime,
        completedAt: Date.now(),
      };

      step.status = 'failed';
      step.result = result;
      this.queueManager.updateStepStatus(task.id, step.id, 'failed');

      return result;
    }
  }

  /**
   * Execute step based on its type
   */
  private async executeStepByType(
    task: Task,
    step: TaskStep,
    signal: AbortSignal
  ): Promise<StepResult> {
    const startTime = Date.now();
    const config = step.config;

    switch (config.type) {
      case 'tool':
        return this.executeToolStep(task, step, config, startTime);

      case 'llm':
        return this.executeLLMStep(task, step, config, startTime);

      case 'wait':
        return this.executeWaitStep(task, step, config, startTime);

      case 'condition':
        return this.executeConditionStep(task, step, config, startTime);

      case 'parallel':
        return this.executeParallelStep(task, step, config, signal, startTime);

      case 'loop':
        return this.executeLoopStep(task, step, config, signal, startTime);

      case 'delay':
        return this.executeDelayStep(step, config, startTime);

      default:
        throw new Error(`Unknown step type: ${(config as StepConfig).type}`);
    }
  }

  /**
   * Execute a tool step
   */
  private async executeToolStep(
    task: Task,
    step: TaskStep,
    config: ToolStepConfig,
    startTime: number
  ): Promise<StepResult> {
    // Replace variables in parameters
    const params = this.interpolateVariables(config.parameters, task.context);

    logger.info('[TaskExecutor] Executing tool', {
      taskId: task.id,
      tool: config.toolName,
      params,
    });

    const toolResult = await executeToolCall({
      name: config.toolName,
      arguments: params,
    });

    return {
      stepId: step.id,
      status: toolResult.success ? 'completed' : 'failed',
      data: toolResult.result,
      error: toolResult.error,
      duration: Date.now() - startTime,
      completedAt: Date.now(),
    };
  }

  /**
   * Execute an LLM step
   */
  private async executeLLMStep(
    task: Task,
    step: TaskStep,
    config: LLMStepConfig,
    startTime: number
  ): Promise<StepResult> {
    if (!this.llmCallback) {
      throw new Error('LLM callback not configured');
    }

    // Interpolate prompt variables
    const prompt = this.interpolateVariables({ prompt: config.prompt }, task.context)
      .prompt as string;
    const systemPrompt = config.systemPrompt
      ? (this.interpolateVariables({ prompt: config.systemPrompt }, task.context).prompt as string)
      : undefined;

    logger.info('[TaskExecutor] Executing LLM step', {
      taskId: task.id,
      stepId: step.id,
      promptLength: prompt.length,
    });

    const response = await this.llmCallback(prompt, systemPrompt);

    // Store in context if outputVariable specified
    if (config.outputVariable && task.context) {
      task.context.variables[config.outputVariable] = response;
    }

    return {
      stepId: step.id,
      status: 'completed',
      data: response,
      duration: Date.now() - startTime,
      completedAt: Date.now(),
    };
  }

  /**
   * Execute a wait step (user input)
   */
  private async executeWaitStep(
    task: Task,
    step: TaskStep,
    config: WaitStepConfig,
    startTime: number
  ): Promise<StepResult> {
    if (!this.userInputCallback) {
      throw new Error('User input callback not configured');
    }

    const prompt = this.interpolateVariables({ prompt: config.prompt }, task.context)
      .prompt as string;

    logger.info('[TaskExecutor] Waiting for user input', {
      taskId: task.id,
      stepId: step.id,
      inputType: config.inputType,
    });

    const response = await this.userInputCallback(prompt, config.inputType, config.choices);

    // Store in context if outputVariable specified
    if (config.outputVariable && task.context) {
      task.context.variables[config.outputVariable] = response;
    }

    return {
      stepId: step.id,
      status: 'completed',
      data: response,
      duration: Date.now() - startTime,
      completedAt: Date.now(),
    };
  }

  /**
   * Execute a condition step
   */
  private async executeConditionStep(
    task: Task,
    step: TaskStep,
    config: ConditionStepConfig,
    startTime: number
  ): Promise<StepResult> {
    // Evaluate condition using context variables
    const conditionResult = this.evaluateCondition(config.condition, task.context);

    logger.info('[TaskExecutor] Condition evaluated', {
      taskId: task.id,
      stepId: step.id,
      condition: config.condition,
      result: conditionResult,
    });

    // Store which branch was taken
    const branchStepId = conditionResult ? config.thenStep : config.elseStep;

    return {
      stepId: step.id,
      status: 'completed',
      data: { conditionResult, nextStep: branchStepId },
      duration: Date.now() - startTime,
      completedAt: Date.now(),
    };
  }

  /**
   * Execute parallel steps
   */
  private async executeParallelStep(
    task: Task,
    step: TaskStep,
    config: ParallelStepConfig,
    signal: AbortSignal,
    startTime: number
  ): Promise<StepResult> {
    const substeps = task.steps.filter((s) => config.steps.includes(s.id));

    logger.info('[TaskExecutor] Executing parallel steps', {
      taskId: task.id,
      stepId: step.id,
      parallelSteps: config.steps.length,
    });

    const promises = substeps.map((substep) => this.executeStep(task, substep, signal));

    let results: StepResult[];
    if (config.waitFor === 'all') {
      results = await Promise.all(promises);
    } else {
      const first = await Promise.race(promises);
      results = [first];
    }

    const allSucceeded = results.every((r) => r.status === 'completed');

    return {
      stepId: step.id,
      status: allSucceeded ? 'completed' : 'failed',
      data: results,
      duration: Date.now() - startTime,
      completedAt: Date.now(),
    };
  }

  /**
   * Execute a loop step
   */
  private async executeLoopStep(
    task: Task,
    step: TaskStep,
    config: LoopStepConfig,
    signal: AbortSignal,
    startTime: number
  ): Promise<StepResult> {
    const items = task.context?.variables[config.itemsVariable] as unknown[];
    if (!Array.isArray(items)) {
      throw new Error(`Loop variable "${config.itemsVariable}" is not an array`);
    }

    const maxIterations = config.maxIterations || 100;
    const loopResults: StepResult[] = [];

    logger.info('[TaskExecutor] Starting loop', {
      taskId: task.id,
      stepId: step.id,
      itemCount: items.length,
    });

    for (let i = 0; i < Math.min(items.length, maxIterations); i++) {
      if (signal.aborted) break;

      // Set current item in context
      if (task.context) {
        task.context.variables[config.itemVariable] = items[i];
        task.context.variables['__loopIndex'] = i;
      }

      // Find and execute the loop step
      const loopStep = task.steps.find((s) => s.id === config.stepId);
      if (!loopStep) {
        throw new Error(`Loop step "${config.stepId}" not found`);
      }

      const result = await this.executeStep(task, loopStep, signal);
      loopResults.push(result);

      if (result.status === 'failed') {
        // Continue or break based on error strategy
        if (step.errorStrategy === 'fail') {
          break;
        }
      }
    }

    const allSucceeded = loopResults.every((r) => r.status === 'completed');

    return {
      stepId: step.id,
      status: allSucceeded ? 'completed' : 'failed',
      data: loopResults,
      duration: Date.now() - startTime,
      completedAt: Date.now(),
    };
  }

  /**
   * Execute a delay step
   */
  private async executeDelayStep(
    step: TaskStep,
    config: DelayStepConfig,
    startTime: number
  ): Promise<StepResult> {
    logger.info('[TaskExecutor] Delaying', {
      stepId: step.id,
      duration: config.durationMs,
      reason: config.reason,
    });

    await new Promise((resolve) => setTimeout(resolve, config.durationMs));

    return {
      stepId: step.id,
      status: 'completed',
      data: { delayed: config.durationMs },
      duration: Date.now() - startTime,
      completedAt: Date.now(),
    };
  }

  /**
   * Check if step dependencies are satisfied
   */
  private async checkDependencies(task: Task, step: TaskStep): Promise<boolean> {
    if (!step.dependsOn || step.dependsOn.length === 0) {
      return true;
    }

    for (const depId of step.dependsOn) {
      const depStep = task.steps.find((s) => s.id === depId);
      if (!depStep) {
        logger.warn('[TaskExecutor] Dependency not found', {
          stepId: step.id,
          dependencyId: depId,
        });
        return false;
      }

      if (depStep.status !== 'completed') {
        return false;
      }
    }

    return true;
  }

  /**
   * Handle step failure based on error strategy
   */
  private async handleStepFailure(
    task: Task,
    step: TaskStep,
    result: StepResult
  ): Promise<boolean> {
    logger.warn('[TaskExecutor] Step failed', {
      taskId: task.id,
      stepId: step.id,
      error: result.error,
      strategy: step.errorStrategy,
    });

    switch (step.errorStrategy) {
      case 'fail':
        return false;

      case 'skip':
        step.status = 'skipped';
        return true;

      case 'retry': {
        const maxRetries = step.maxRetries || 3;
        const attempts = result.attempts || 1;

        if (attempts < maxRetries) {
          // Calculate delay with exponential backoff
          const delay = Math.min(
            this.config.baseRetryDelay * Math.pow(2, attempts - 1),
            this.config.maxRetryDelay
          );

          logger.info('[TaskExecutor] Retrying step', {
            taskId: task.id,
            stepId: step.id,
            attempt: attempts + 1,
            maxRetries,
            delay,
          });

          await new Promise((resolve) => setTimeout(resolve, delay));

          // Re-execute the step
          const retryResult = await this.executeStep(
            task,
            step,
            this.abortControllers.get(task.id)?.signal || new AbortController().signal
          );
          retryResult.attempts = attempts + 1;

          if (retryResult.status === 'completed') {
            return true;
          }

          return this.handleStepFailure(task, step, retryResult);
        }
        return false;
      }

      case 'rollback':
        // Rollback is complex - for now, just fail
        logger.warn('[TaskExecutor] Rollback not implemented, failing task');
        return false;

      default:
        return false;
    }
  }

  /**
   * Interpolate variables in an object using {{variable}} syntax
   */
  private interpolateVariables(
    obj: Record<string, unknown>,
    context?: TaskContext
  ): Record<string, unknown> {
    if (!context) return obj;

    const interpolate = (value: unknown): unknown => {
      if (typeof value === 'string') {
        return value.replace(/\{\{(\w+)\}\}/g, (_, varName) => {
          const varValue = context.variables[varName];
          return varValue !== undefined ? String(varValue) : `{{${varName}}}`;
        });
      }
      if (Array.isArray(value)) {
        return value.map(interpolate);
      }
      if (value && typeof value === 'object') {
        return this.interpolateVariables(value as Record<string, unknown>, context);
      }
      return value;
    };

    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = interpolate(value);
    }
    return result;
  }

  /**
   * Evaluate a condition expression
   */
  private evaluateCondition(condition: string, context?: TaskContext): boolean {
    if (!context) return false;

    try {
      // Create a safe evaluation context
      const evalContext: Record<string, unknown> = { ...context.variables };

      // Add step results
      for (const [stepId, result] of Object.entries(context.stepResults)) {
        evalContext[`step_${stepId.replace(/-/g, '_')}_data`] = result.data;
        evalContext[`step_${stepId.replace(/-/g, '_')}_success`] = result.status === 'completed';
      }

      // Simple expression evaluation (for safety, only support basic comparisons)
      // Format: "variable == value" or "variable != value" or "variable"
      const parts = condition.split(/\s*(==|!=|>|<|>=|<=)\s*/);

      if (parts.length === 1) {
        // Boolean check
        return Boolean(evalContext[parts[0]]);
      } else if (parts.length === 3) {
        const [left, operator, right] = parts;
        const leftVal = evalContext[left] ?? left;
        const rightVal = evalContext[right] ?? right;

        switch (operator) {
          case '==':
            return leftVal == rightVal;
          case '!=':
            return leftVal != rightVal;
          case '>':
            return Number(leftVal) > Number(rightVal);
          case '<':
            return Number(leftVal) < Number(rightVal);
          case '>=':
            return Number(leftVal) >= Number(rightVal);
          case '<=':
            return Number(leftVal) <= Number(rightVal);
          default:
            return false;
        }
      }

      return false;
    } catch (error) {
      logger.error('[TaskExecutor] Condition evaluation failed', {
        condition,
        error: getErrorMessage(error),
      });
      return false;
    }
  }

  /**
   * Aggregate results from all steps
   */
  private aggregateResults(task: Task): unknown {
    // Return the last step's data by default
    const lastStep = task.steps[task.steps.length - 1];
    return lastStep?.result?.data;
  }

  /**
   * Wait for a task to be resumed
   */
  private async waitForResume(taskId: string): Promise<void> {
    return new Promise((resolve) => {
      const checkStatus = () => {
        const task = this.queueManager.getTask(taskId);
        if (!task || task.status !== 'paused') {
          resolve();
        } else {
          setTimeout(checkStatus, 100);
        }
      };
      checkStatus();
    });
  }

  /**
   * Add timeout to a promise
   */
  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    errorMessage: string
  ): Promise<T> {
    return Promise.race([
      promise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
      ),
    ]);
  }

  /**
   * Cancel a specific task
   */
  cancelTask(taskId: string): void {
    const controller = this.abortControllers.get(taskId);
    if (controller) {
      controller.abort();
    }
  }

  /**
   * Shutdown the executor
   */
  async shutdown(): Promise<void> {
    logger.info('[TaskExecutor] Shutting down...');

    // Abort all running tasks
    for (const [, controller] of this.abortControllers) {
      controller.abort();
    }
    this.abortControllers.clear();

    logger.info('[TaskExecutor] Shutdown complete');
  }
}

// Singleton instance
let taskExecutor: TaskExecutor | null = null;

/**
 * Get the task executor instance
 */
export function getTaskExecutor(): TaskExecutor {
  if (!taskExecutor) {
    taskExecutor = new TaskExecutor();
  }
  return taskExecutor;
}

/**
 * Initialize the task executor with custom config
 */
export function initializeTaskExecutor(config?: Partial<TaskExecutorConfig>): TaskExecutor {
  if (taskExecutor) {
    logger.warn('[TaskExecutor] Already initialized, returning existing instance');
    return taskExecutor;
  }
  taskExecutor = new TaskExecutor(config);
  return taskExecutor;
}

/**
 * Shutdown the task executor
 */
export async function shutdownTaskExecutor(): Promise<void> {
  if (taskExecutor) {
    await taskExecutor.shutdown();
    taskExecutor = null;
  }
}
