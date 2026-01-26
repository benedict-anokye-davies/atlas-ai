/**
 * Step Runner
 * 
 * Executes individual workflow steps with retry logic, timeout handling,
 * and result collection.
 * 
 * @module agent/workflow/step-runner
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../../utils/logger';
import { sleep } from '../../../shared/utils';
import { getToolRegistry } from '../tool-registry';
import { getLLMManager } from '../../llm';
import {
  WorkflowStep,
  StepResult,
  StepError,
  LogEntry,
  WorkflowContext,
  RetryConfig,
} from './types';

const logger = createModuleLogger('StepRunner');

// ============================================================================
// Default Configurations
// ============================================================================

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  delayMs: 1000,
  backoffMultiplier: 2,
};

const DEFAULT_TIMEOUT_MS = 60000; // 1 minute per step

// ============================================================================
// Step Runner Class
// ============================================================================

export class StepRunner extends EventEmitter {
  private abortControllers: Map<string, AbortController> = new Map();
  private humanInputHandlers: Map<string, (input: unknown) => void> = new Map();

  constructor() {
    super();
  }

  /**
   * Execute a single workflow step
   */
  async executeStep(
    step: WorkflowStep,
    context: WorkflowContext
  ): Promise<StepResult> {
    const startTime = Date.now();
    const logs: LogEntry[] = [];
    let retryCount = 0;

    const addLog = (level: LogEntry['level'], message: string, data?: unknown) => {
      logs.push({ timestamp: Date.now(), level, message, data });
      logger[level](`[${step.id}] ${message}`, data || '');
    };

    addLog('info', `Starting step: ${step.name}`);
    this.emit('step:started', { stepId: step.id, step });

    // Create abort controller for this step
    const abortController = new AbortController();
    this.abortControllers.set(step.id, abortController);

    const retryConfig = step.retryConfig || DEFAULT_RETRY_CONFIG;

    try {
      let output: unknown;
      let lastError: Error | null = null;

      // Retry loop
      while (retryCount < retryConfig.maxAttempts) {
        if (abortController.signal.aborted) {
          throw new Error('Step was cancelled');
        }

        try {
          output = await this.executeStepOnce(step, context, abortController.signal);
          lastError = null;
          break;
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          retryCount++;

          if (retryCount < retryConfig.maxAttempts) {
            const delay = retryConfig.delayMs * Math.pow(retryConfig.backoffMultiplier, retryCount - 1);
            addLog('warn', `Step failed, retrying in ${delay}ms (attempt ${retryCount}/${retryConfig.maxAttempts})`, {
              error: lastError.message,
            });
            this.emit('step:retrying', { stepId: step.id, attempt: retryCount, error: lastError });
            await this.sleep(delay);
          }
        }
      }

      if (lastError) {
        throw lastError;
      }

      const duration = Date.now() - startTime;
      addLog('info', `Step completed in ${duration}ms`);

      const result: StepResult = {
        stepId: step.id,
        status: 'completed',
        output,
        duration,
        retryCount,
        logs,
      };

      this.emit('step:completed', { stepId: step.id, result });
      return result;

    } catch (error) {
      const duration = Date.now() - startTime;
      const stepError = this.createStepError(error);
      
      addLog('error', `Step failed: ${stepError.message}`);

      const result: StepResult = {
        stepId: step.id,
        status: 'failed',
        error: stepError,
        duration,
        retryCount,
        logs,
      };

      this.emit('step:failed', { stepId: step.id, result, error: stepError });
      return result;

    } finally {
      this.abortControllers.delete(step.id);
    }
  }

  /**
   * Execute step once (without retry logic)
   */
  private async executeStepOnce(
    step: WorkflowStep,
    context: WorkflowContext,
    signal: AbortSignal
  ): Promise<unknown> {
    // Apply timeout
    const timeoutPromise = this.createTimeout(DEFAULT_TIMEOUT_MS, step.id);

    const executionPromise = (async () => {
      switch (step.type) {
        case 'tool':
          return this.executeToolStep(step, context, signal);
        
        case 'llm':
          return this.executeLLMStep(step, context, signal);
        
        case 'conditional':
          return this.executeConditionalStep(step, context);
        
        case 'parallel':
          return this.executeParallelStep(step, context);
        
        case 'loop':
          return this.executeLoopStep(step, context);
        
        case 'human-input':
          return this.executeHumanInputStep(step, context);
        
        case 'checkpoint':
          return this.executeCheckpointStep(step, context);
        
        default:
          throw new Error(`Unknown step type: ${step.type}`);
      }
    })();

    return Promise.race([executionPromise, timeoutPromise]);
  }

  /**
   * Execute a tool step
   */
  private async executeToolStep(
    step: WorkflowStep,
    context: WorkflowContext,
    _signal: AbortSignal
  ): Promise<unknown> {
    if (!step.tool) {
      throw new Error('Tool step missing tool configuration');
    }

    const registry = getToolRegistry();
    const tool = registry.getTool(step.tool.name);
    
    if (!tool) {
      throw new Error(`Tool not found: ${step.tool.name}`);
    }

    // Interpolate parameters with context values
    const parameters = this.interpolateParameters(step.tool.parameters, context);

    logger.debug(`Executing tool: ${step.tool.name}`, parameters);
    
    // Execute the tool
    const result = await tool.execute(parameters, {
      workingDirectory: context.workingDirectory,
      stepOutputs: context.stepOutputs,
    });

    return result;
  }

  /**
   * Execute an LLM step
   */
  private async executeLLMStep(
    step: WorkflowStep,
    context: WorkflowContext,
    _signal: AbortSignal
  ): Promise<unknown> {
    if (!step.llm) {
      throw new Error('LLM step missing llm configuration');
    }

    const llm = getLLMManager();
    
    // Interpolate prompt with context values
    const prompt = this.interpolateString(step.llm.prompt, context);
    const systemPrompt = step.llm.systemPrompt 
      ? this.interpolateString(step.llm.systemPrompt, context)
      : undefined;

    // Build context for the LLM call
    const llmContext = systemPrompt ? { systemPrompt } : undefined;

    const response = await llm.chat(prompt, llmContext, {
      temperature: 0.7,
      maxTokens: 2000,
    });

    // Store result in context with specified key
    const result = response.content;
    context.stepOutputs[step.llm.outputKey] = result;

    return result;
  }

  /**
   * Execute a conditional step
   */
  private async executeConditionalStep(
    step: WorkflowStep,
    context: WorkflowContext
  ): Promise<{ branch: 'then' | 'else'; steps: string[] }> {
    if (!step.condition) {
      throw new Error('Conditional step missing condition configuration');
    }

    // Evaluate the condition expression
    const expression = this.interpolateString(step.condition.expression, context);

    // Safe evaluation: use simple comparison operators only
    // Supports: ==, !=, ===, !==, <, >, <=, >=, &&, ||, !, true, false
    const result = this.safeEvaluateExpression(expression, context);

    if (result) {
      return { branch: 'then', steps: step.condition.thenSteps };
    } else {
      return { branch: 'else', steps: step.condition.elseSteps };
    }
  }

  /**
   * Execute steps in parallel
   */
  private async executeParallelStep(
    step: WorkflowStep,
    _context: WorkflowContext
  ): Promise<{ parallelSteps: string[] }> {
    if (!step.parallel) {
      throw new Error('Parallel step missing parallel configuration');
    }

    // Return the step IDs to execute in parallel
    // The workflow executor will handle the actual parallel execution
    return { parallelSteps: step.parallel.stepIds };
  }

  /**
   * Execute a loop step
   */
  private async executeLoopStep(
    step: WorkflowStep,
    context: WorkflowContext
  ): Promise<{ iterations: unknown[] }> {
    if (!step.loop) {
      throw new Error('Loop step missing loop configuration');
    }

    const items = context.stepOutputs[step.loop.itemsKey] as unknown[];
    if (!Array.isArray(items)) {
      throw new Error(`Loop items key "${step.loop.itemsKey}" is not an array`);
    }

    return { iterations: items };
  }

  /**
   * Wait for human input
   */
  private async executeHumanInputStep(
    step: WorkflowStep,
    context: WorkflowContext
  ): Promise<unknown> {
    if (!step.humanInput) {
      throw new Error('Human input step missing humanInput configuration');
    }

    const prompt = this.interpolateString(step.humanInput.prompt, context);
    
    // Emit event requesting human input
    this.emit('human-input:required', {
      stepId: step.id,
      prompt,
      inputType: step.humanInput.inputType,
      choices: step.humanInput.choices,
    });

    // Wait for input via promise
    return new Promise((resolve) => {
      this.humanInputHandlers.set(step.id, (input) => {
        context.stepOutputs[step.humanInput!.outputKey] = input;
        resolve(input);
      });
    });
  }

  /**
   * Provide human input for a waiting step
   */
  provideHumanInput(stepId: string, input: unknown): void {
    const handler = this.humanInputHandlers.get(stepId);
    if (handler) {
      handler(input);
      this.humanInputHandlers.delete(stepId);
    } else {
      logger.warn(`No human input handler found for step: ${stepId}`);
    }
  }

  /**
   * Execute a checkpoint step (creates a snapshot)
   */
  private async executeCheckpointStep(
    step: WorkflowStep,
    context: WorkflowContext
  ): Promise<{ checkpointId: string }> {
    // Emit event to create checkpoint - workflow executor handles actual creation
    const checkpointId = `cp_${step.id}_${Date.now()}`;
    this.emit('checkpoint:requested', { stepId: step.id, checkpointId, context });
    return { checkpointId };
  }

  /**
   * Cancel a running step
   */
  cancelStep(stepId: string): void {
    const controller = this.abortControllers.get(stepId);
    if (controller) {
      controller.abort();
      logger.info(`Step cancelled: ${stepId}`);
    }
  }

  /**
   * Interpolate template strings with context values
   */
  private interpolateString(template: string, context: WorkflowContext): string {
    return template.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_, path) => {
      const value = this.getNestedValue(context, path);
      return value !== undefined ? String(value) : `{{${path}}}`;
    });
  }

  /**
   * Interpolate object parameters with context values
   */
  private interpolateParameters(
    params: Record<string, unknown>,
    context: WorkflowContext
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === 'string') {
        result[key] = this.interpolateString(value, context);
      } else if (typeof value === 'object' && value !== null) {
        result[key] = this.interpolateParameters(value as Record<string, unknown>, context);
      } else {
        result[key] = value;
      }
    }
    
    return result;
  }

  /**
   * Safely evaluate a boolean expression without using eval or Function constructor
   * Supports simple comparisons and logical operators only
   */
  private safeEvaluateExpression(expression: string, context: WorkflowContext): boolean {
    // Remove whitespace
    const expr = expression.trim();

    // Handle boolean literals
    if (expr === 'true') return true;
    if (expr === 'false') return false;

    // Handle simple variable checks (e.g., "context.someVar")
    if (/^[a-zA-Z_$][a-zA-Z0-9_$.]*$/.test(expr)) {
      const value = this.getNestedValue(context, expr.replace(/^context\./, ''));
      return Boolean(value);
    }

    // For complex expressions, only allow safe operators
    // This is a simplified parser for basic boolean logic
    // Supports: ==, !=, ===, !==, <, >, <=, >=, &&, ||
    const safePattern =
      /^[a-zA-Z_$][a-zA-Z0-9_$.]*\s*(===|!==|==|!=|<=|>=|<|>)\s*("[^"]*"|'[^']*'|[0-9]+|true|false)$/;

    if (safePattern.test(expr)) {
      // Parse simple comparison
      const match = expr.match(
        /([a-zA-Z_$][a-zA-Z0-9_$.]*)\s*(===|!==|==|!=|<=|>=|<|>)\s*("[^"]*"|'[^']*'|[0-9]+|true|false)/
      );
      if (match) {
        const [, leftSide, operator, rightSide] = match;
        const leftValue = this.getNestedValue(context, leftSide.replace(/^context\./, ''));
        let rightValue: string | number | boolean = rightSide;

        // Parse right side
        if (rightSide === 'true') rightValue = true;
        else if (rightSide === 'false') rightValue = false;
        else if (rightSide.startsWith('"') || rightSide.startsWith("'"))
          rightValue = rightSide.slice(1, -1);
        else if (!isNaN(Number(rightSide))) rightValue = Number(rightSide);

        // Perform comparison
        switch (operator) {
          case '===':
            return leftValue === rightValue;
          case '!==':
            return leftValue !== rightValue;
          case '==':
            // eslint-disable-next-line eqeqeq
            return leftValue == rightValue;
          case '!=':
            // eslint-disable-next-line eqeqeq
            return leftValue != rightValue;
          case '<':
            return (leftValue as number) < (rightValue as number);
          case '>':
            return (leftValue as number) > (rightValue as number);
          case '<=':
            return (leftValue as number) <= (rightValue as number);
          case '>=':
            return (leftValue as number) >= (rightValue as number);
          default:
            throw new Error(`Unsupported operator: ${operator}`);
        }
      }
    }

    throw new Error(
      `Unsafe or unsupported expression: ${expr}. Only simple comparisons are allowed.`
    );
  }

  /**
   * Get nested value from object using dot notation
   */
  private getNestedValue(obj: unknown, path: string): unknown {
    const parts = path.split('.');
    let current = obj;
    
    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      current = (current as Record<string, unknown>)[part];
    }
    
    return current;
  }

  /**
   * Create a StepError from an unknown error
   */
  private createStepError(error: unknown): StepError {
    if (error instanceof Error) {
      return {
        code: error.name || 'STEP_ERROR',
        message: error.message,
        stack: error.stack,
        recoverable: this.isRecoverableError(error),
      };
    }
    
    return {
      code: 'UNKNOWN_ERROR',
      message: String(error),
      recoverable: false,
    };
  }

  /**
   * Check if an error is potentially recoverable
   */
  private isRecoverableError(error: Error): boolean {
    const recoverablePatterns = [
      /timeout/i,
      /network/i,
      /ECONNRESET/,
      /ETIMEDOUT/,
      /rate.?limit/i,
      /retry/i,
    ];
    
    const message = error.message || '';
    return recoverablePatterns.some(pattern => pattern.test(message));
  }

  /**
   * Create a timeout promise
   */
  private createTimeout(ms: number, stepId: string): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Step ${stepId} timed out after ${ms}ms`));
      }, ms);
    });
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return sleep(ms);
  }
}

// ============================================================================
// Singleton
// ============================================================================

let runnerInstance: StepRunner | null = null;

export function getStepRunner(): StepRunner {
  if (!runnerInstance) {
    runnerInstance = new StepRunner();
  }
  return runnerInstance;
}

export function resetStepRunner(): void {
  runnerInstance = null;
}
