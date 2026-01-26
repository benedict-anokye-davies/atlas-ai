/**
 * Atlas Desktop - Task Framework Types
 * Type definitions for multi-step task execution
 */

import type { ToolResult } from './agent';

/**
 * Task priority levels
 */
export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';

/**
 * Task status
 */
export type TaskStatus =
  | 'pending' // Waiting to start
  | 'queued' // In queue, not yet executing
  | 'running' // Currently executing
  | 'paused' // Paused by user or system
  | 'completed' // Successfully completed
  | 'failed' // Failed with error
  | 'cancelled'; // Cancelled by user

/**
 * Step status
 */
export type StepStatus =
  | 'pending' // Waiting to execute
  | 'running' // Currently executing
  | 'completed' // Successfully completed
  | 'failed' // Failed with error
  | 'skipped' // Skipped (due to condition or error handling)
  | 'cancelled'; // Cancelled

/**
 * Step type - what kind of operation this step performs
 */
export type StepType =
  | 'tool' // Execute a tool
  | 'llm' // LLM generation/reasoning
  | 'wait' // Wait for user input
  | 'condition' // Conditional branching
  | 'parallel' // Execute multiple steps in parallel
  | 'loop' // Loop over items
  | 'delay'; // Wait for a specified time

/**
 * Error handling strategy for steps
 */
export type ErrorStrategy =
  | 'fail' // Fail the entire task
  | 'skip' // Skip this step and continue
  | 'retry' // Retry the step
  | 'rollback'; // Rollback to previous state

/**
 * Task step result
 */
export interface StepResult<T = unknown> {
  /** Step ID that produced this result */
  stepId: string;
  /** Step status after execution */
  status: StepStatus;
  /** Result data if successful */
  data?: T;
  /** Error message if failed */
  error?: string;
  /** Duration in milliseconds */
  duration: number;
  /** Timestamp when step completed */
  completedAt: number;
  /** If retried, how many attempts */
  attempts?: number;
  /** If this was a tool step, the tool result */
  toolResult?: ToolResult;
}

/**
 * Task step definition
 */
export interface TaskStep {
  /** Unique step identifier */
  id: string;
  /** Human-readable step name */
  name: string;
  /** Step description */
  description?: string;
  /** Type of step */
  type: StepType;
  /** Step status */
  status: StepStatus;
  /** Error handling strategy */
  errorStrategy: ErrorStrategy;
  /** Maximum retry attempts (if errorStrategy is 'retry') */
  maxRetries?: number;
  /** Timeout in milliseconds (0 = no timeout) */
  timeout?: number;
  /** Dependencies - step IDs that must complete first */
  dependsOn?: string[];
  /** Step-specific configuration */
  config: StepConfig;
  /** Step result after execution */
  result?: StepResult;
  /** Progress (0-100) for long-running steps */
  progress?: number;
  /** Substeps for parallel/loop steps */
  substeps?: TaskStep[];
}

/**
 * Step configuration based on step type
 */
export type StepConfig =
  | ToolStepConfig
  | LLMStepConfig
  | WaitStepConfig
  | ConditionStepConfig
  | ParallelStepConfig
  | LoopStepConfig
  | DelayStepConfig;

/**
 * Tool step configuration
 */
export interface ToolStepConfig {
  type: 'tool';
  /** Tool name to execute */
  toolName: string;
  /** Tool parameters */
  parameters: Record<string, unknown>;
  /** Whether to skip confirmation */
  skipConfirmation?: boolean;
}

/**
 * LLM step configuration
 */
export interface LLMStepConfig {
  type: 'llm';
  /** Prompt template (can use {{variable}} syntax) */
  prompt: string;
  /** System prompt override */
  systemPrompt?: string;
  /** Maximum tokens */
  maxTokens?: number;
  /** Temperature */
  temperature?: number;
  /** Whether to stream response */
  stream?: boolean;
  /** Output variable name to store result */
  outputVariable?: string;
}

/**
 * Wait for user input step configuration
 */
export interface WaitStepConfig {
  type: 'wait';
  /** Prompt to show user */
  prompt: string;
  /** Type of input expected */
  inputType: 'text' | 'confirmation' | 'choice';
  /** Choices if inputType is 'choice' */
  choices?: string[];
  /** Default value */
  defaultValue?: string;
  /** Output variable name */
  outputVariable?: string;
}

/**
 * Condition step configuration
 */
export interface ConditionStepConfig {
  type: 'condition';
  /** Condition expression (evaluated with task context) */
  condition: string;
  /** Step ID to execute if true */
  thenStep: string;
  /** Step ID to execute if false */
  elseStep?: string;
}

/**
 * Parallel execution step configuration
 */
export interface ParallelStepConfig {
  type: 'parallel';
  /** Step IDs to execute in parallel */
  steps: string[];
  /** Whether to wait for all or just first to complete */
  waitFor: 'all' | 'first';
  /** Maximum concurrent executions */
  maxConcurrency?: number;
}

/**
 * Loop step configuration
 */
export interface LoopStepConfig {
  type: 'loop';
  /** Variable name containing items to iterate */
  itemsVariable: string;
  /** Current item variable name */
  itemVariable: string;
  /** Step ID to execute for each item */
  stepId: string;
  /** Maximum iterations (safety limit) */
  maxIterations?: number;
}

/**
 * Delay step configuration
 */
export interface DelayStepConfig {
  type: 'delay';
  /** Delay in milliseconds */
  durationMs: number;
  /** Reason for delay (for logging) */
  reason?: string;
}

/**
 * Task context - variables and state available during execution
 */
export interface TaskContext {
  /** Task-level variables */
  variables: Record<string, unknown>;
  /** Results from completed steps */
  stepResults: Record<string, StepResult>;
  /** User preferences affecting execution */
  userPreferences?: Record<string, unknown>;
  /** Session ID */
  sessionId: string;
  /** Start timestamp */
  startedAt: number;
}

/**
 * Task result after completion
 */
export interface TaskResult {
  /** Task ID */
  taskId: string;
  /** Final status */
  status: TaskStatus;
  /** Result data (from final step or aggregated) */
  data?: unknown;
  /** Error message if failed */
  error?: string;
  /** Total duration in milliseconds */
  duration: number;
  /** Completed steps count */
  completedSteps: number;
  /** Total steps count */
  totalSteps: number;
  /** Individual step results */
  stepResults: StepResult[];
  /** Final task context */
  context: TaskContext;
  /** Timestamp when task completed */
  completedAt: number;
}

/**
 * Task definition
 */
export interface Task {
  /** Unique task identifier */
  id: string;
  /** Human-readable task name */
  name: string;
  /** Task description */
  description?: string;
  /** Task priority */
  priority: TaskPriority;
  /** Task status */
  status: TaskStatus;
  /** Task steps */
  steps: TaskStep[];
  /** Initial context variables */
  initialContext?: Record<string, unknown>;
  /** Task context (populated during execution) */
  context?: TaskContext;
  /** Task result (populated after completion) */
  result?: TaskResult;
  /** Progress (0-100) */
  progress: number;
  /** Current step being executed */
  currentStepId?: string;
  /** Created timestamp */
  createdAt: number;
  /** Started timestamp */
  startedAt?: number;
  /** Completed timestamp */
  completedAt?: number;
  /** Error message if failed */
  error?: string;
  /** Tags for categorization */
  tags?: string[];
  /** Source of the task (voice, scheduled, trigger) */
  source: TaskSource;
  /** Retry count */
  retryCount: number;
  /** Maximum retries */
  maxRetries: number;
}

/**
 * Task source - where the task originated from
 */
export type TaskSource =
  | 'voice' // From voice command
  | 'scheduled' // From scheduler
  | 'trigger' // From event trigger
  | 'api' // From external API
  | 'internal'; // Internal system task

/**
 * Task creation options
 */
export interface CreateTaskOptions {
  /** Task name */
  name: string;
  /** Task description */
  description?: string;
  /** Priority */
  priority?: TaskPriority;
  /** Steps to execute */
  steps: Omit<TaskStep, 'id' | 'status' | 'result'>[];
  /** Initial context variables */
  context?: Record<string, unknown>;
  /** Task tags */
  tags?: string[];
  /** Task source */
  source?: TaskSource;
  /** Max retries */
  maxRetries?: number;
}

/**
 * Task queue entry
 */
export interface QueuedTask {
  /** Task reference */
  task: Task;
  /** Queue position */
  position: number;
  /** Estimated wait time in ms */
  estimatedWaitMs: number;
  /** When added to queue */
  queuedAt: number;
}

/**
 * Task progress event
 */
export interface TaskProgressEvent {
  /** Task ID */
  taskId: string;
  /** Current step ID */
  stepId?: string;
  /** Overall progress (0-100) */
  progress: number;
  /** Current step name */
  currentStep?: string;
  /** Status message */
  message?: string;
  /** Task status */
  status: TaskStatus;
  /** Completed steps */
  completedSteps: number;
  /** Total steps */
  totalSteps: number;
}

/**
 * Task completion event
 */
export interface TaskCompletionEvent {
  /** Task ID */
  taskId: string;
  /** Final status */
  status: TaskStatus;
  /** Result data */
  result?: TaskResult;
  /** Error if failed */
  error?: string;
  /** Duration */
  duration: number;
}

/**
 * Task queue statistics
 */
export interface TaskQueueStats {
  /** Number of pending tasks */
  pending: number;
  /** Number of running tasks */
  running: number;
  /** Number of completed tasks */
  completed: number;
  /** Number of failed tasks */
  failed: number;
  /** Average execution time in ms */
  avgExecutionTime: number;
  /** Total tasks processed */
  totalProcessed: number;
  /** Queue utilization (0-1) */
  utilization: number;
}

/**
 * Task framework events
 */
export interface TaskFrameworkEvents {
  /** Task added to queue */
  'task:queued': (task: Task) => void;
  /** Task started executing */
  'task:started': (task: Task) => void;
  /** Task progress update */
  'task:progress': (event: TaskProgressEvent) => void;
  /** Task step started */
  'task:step-started': (taskId: string, step: TaskStep) => void;
  /** Task step completed */
  'task:step-completed': (taskId: string, step: TaskStep, result: StepResult) => void;
  /** Task completed (success or failure) */
  'task:completed': (event: TaskCompletionEvent) => void;
  /** Task cancelled */
  'task:cancelled': (taskId: string, reason?: string) => void;
  /** Task paused */
  'task:paused': (taskId: string) => void;
  /** Task resumed */
  'task:resumed': (taskId: string) => void;
  /** Task error */
  'task:error': (taskId: string, error: Error, stepId?: string) => void;
}
