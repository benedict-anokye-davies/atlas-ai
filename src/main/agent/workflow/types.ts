/**
 * Workflow System Types
 * 
 * Type definitions for the agentic workflow execution system.
 * Supports multi-step autonomous task execution with rollback capability.
 * 
 * @module agent/workflow/types
 */

// ============================================================================
// Core Workflow Types
// ============================================================================

export type WorkflowStatus = 
  | 'pending'
  | 'planning'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'rolling-back';

export type StepStatus = 
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'rolled-back';

export type StepType = 
  | 'tool'           // Execute an agent tool
  | 'llm'            // LLM inference step
  | 'conditional'    // Branch based on condition
  | 'parallel'       // Execute steps in parallel
  | 'human-input'    // Wait for user input
  | 'checkpoint'     // Create a restore point
  | 'loop';          // Iterate over items

// ============================================================================
// Workflow Definition
// ============================================================================

export interface Workflow {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  updatedAt: number;
  status: WorkflowStatus;
  
  // User request that spawned this workflow
  originalRequest: string;
  
  // Execution plan
  steps: WorkflowStep[];
  currentStepIndex: number;
  
  // Context shared across steps
  context: WorkflowContext;
  
  // Results from each step
  results: StepResult[];
  
  // Error tracking
  error?: WorkflowError;
  
  // Timing
  startedAt?: number;
  completedAt?: number;
  
  // Rollback support
  checkpoints: Checkpoint[];
  canRollback: boolean;
}

export interface WorkflowStep {
  id: string;
  type: StepType;
  name: string;
  description: string;
  status: StepStatus;
  
  // Tool execution config
  tool?: {
    name: string;
    parameters: Record<string, unknown>;
  };
  
  // LLM config
  llm?: {
    prompt: string;
    systemPrompt?: string;
    outputKey: string;  // Key to store result in context
  };
  
  // Conditional config
  condition?: {
    expression: string;  // JavaScript expression
    thenSteps: string[]; // Step IDs to execute if true
    elseSteps: string[]; // Step IDs to execute if false
  };
  
  // Parallel config
  parallel?: {
    stepIds: string[];
    waitForAll: boolean;
  };
  
  // Loop config
  loop?: {
    itemsKey: string;    // Context key containing array
    itemKey: string;     // Key for current item
    bodySteps: string[]; // Steps to execute per item
  };
  
  // Human input config
  humanInput?: {
    prompt: string;
    inputType: 'text' | 'choice' | 'confirm';
    choices?: string[];
    outputKey: string;
  };
  
  // Dependencies (step IDs that must complete first)
  dependencies: string[];
  
  // Retry configuration
  retryConfig?: RetryConfig;
  
  // Rollback action if step fails
  rollbackAction?: RollbackAction;
  
  // Timing
  startedAt?: number;
  completedAt?: number;
  duration?: number;
}

export interface RetryConfig {
  maxAttempts: number;
  delayMs: number;
  backoffMultiplier: number;
  retryableErrors?: string[];
}

export interface RollbackAction {
  type: 'tool' | 'custom';
  tool?: {
    name: string;
    parameters: Record<string, unknown>;
  };
  customHandler?: string;  // Function name in rollback controller
}

// ============================================================================
// Workflow Context
// ============================================================================

export interface WorkflowContext {
  // User-provided variables
  userInput: Record<string, unknown>;
  
  // Step outputs (keyed by step ID or output key)
  stepOutputs: Record<string, unknown>;
  
  // Accumulated data
  files: FileContext[];
  codeChanges: CodeChange[];
  gitOperations: GitOperation[];
  
  // Environment
  workingDirectory: string;
  environment: Record<string, string>;
}

export interface FileContext {
  path: string;
  content?: string;
  language?: string;
  originalContent?: string;  // For rollback
}

export interface CodeChange {
  file: string;
  type: 'create' | 'modify' | 'delete' | 'rename';
  originalPath?: string;
  diff?: string;
  timestamp: number;
}

export interface GitOperation {
  type: 'commit' | 'branch' | 'push' | 'pull' | 'merge' | 'stash';
  details: Record<string, unknown>;
  timestamp: number;
  commitHash?: string;
}

// ============================================================================
// Step Results
// ============================================================================

export interface StepResult {
  stepId: string;
  status: StepStatus;
  output?: unknown;
  error?: StepError;
  duration: number;
  retryCount: number;
  logs: LogEntry[];
}

export interface StepError {
  code: string;
  message: string;
  stack?: string;
  recoverable: boolean;
  suggestedAction?: string;
}

export interface LogEntry {
  timestamp: number;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  data?: unknown;
}

// ============================================================================
// Checkpoints & Rollback
// ============================================================================

export interface Checkpoint {
  id: string;
  stepId: string;
  timestamp: number;
  context: WorkflowContext;
  fileSnapshots: FileSnapshot[];
  gitState?: GitState;
}

export interface FileSnapshot {
  path: string;
  content: string;
  exists: boolean;
}

export interface GitState {
  branch: string;
  commitHash: string;
  stashId?: string;
  hasUncommittedChanges: boolean;
}

// ============================================================================
// Workflow Error
// ============================================================================

export interface WorkflowError {
  stepId: string;
  code: string;
  message: string;
  stack?: string;
  timestamp: number;
  recoveryAttempted: boolean;
  recoverySucceeded?: boolean;
}

// ============================================================================
// Task Planning
// ============================================================================

export interface TaskPlan {
  id: string;
  originalRequest: string;
  interpretation: string;
  confidence: number;
  
  // Decomposed tasks
  tasks: PlannedTask[];
  
  // Identified requirements
  requirements: Requirement[];
  
  // Risk assessment
  risks: Risk[];
  
  // Estimated metrics
  estimatedDuration: number;
  estimatedSteps: number;
  complexity: 'simple' | 'moderate' | 'complex';
}

export interface PlannedTask {
  id: string;
  description: string;
  toolsRequired: string[];
  dependencies: string[];
  optional: boolean;
  estimatedDuration: number;
}

export interface Requirement {
  type: 'file' | 'api' | 'permission' | 'tool';
  description: string;
  satisfied: boolean;
  blocksExecution: boolean;
}

export interface Risk {
  type: 'data-loss' | 'side-effect' | 'performance' | 'security';
  description: string;
  severity: 'low' | 'medium' | 'high';
  mitigation?: string;
}

// ============================================================================
// Events
// ============================================================================

export type WorkflowEvent = 
  | { type: 'workflow:created'; workflow: Workflow }
  | { type: 'workflow:started'; workflowId: string }
  | { type: 'workflow:paused'; workflowId: string }
  | { type: 'workflow:resumed'; workflowId: string }
  | { type: 'workflow:completed'; workflowId: string; duration: number }
  | { type: 'workflow:failed'; workflowId: string; error: WorkflowError }
  | { type: 'workflow:cancelled'; workflowId: string }
  | { type: 'step:started'; workflowId: string; stepId: string }
  | { type: 'step:completed'; workflowId: string; stepId: string; result: StepResult }
  | { type: 'step:failed'; workflowId: string; stepId: string; error: StepError }
  | { type: 'step:retrying'; workflowId: string; stepId: string; attempt: number }
  | { type: 'checkpoint:created'; workflowId: string; checkpointId: string }
  | { type: 'rollback:started'; workflowId: string; toCheckpoint: string }
  | { type: 'rollback:completed'; workflowId: string }
  | { type: 'human-input:required'; workflowId: string; stepId: string; prompt: string };

// ============================================================================
// Configuration
// ============================================================================

export interface WorkflowConfig {
  // Execution limits
  maxSteps: number;
  maxDurationMs: number;
  maxParallelSteps: number;
  
  // Checkpoint configuration
  autoCheckpoint: boolean;
  checkpointInterval: number;  // Create checkpoint every N steps
  maxCheckpoints: number;
  
  // Retry defaults
  defaultRetryAttempts: number;
  defaultRetryDelayMs: number;
  
  // Safety
  requireConfirmationForDestructive: boolean;
  dryRunByDefault: boolean;
  
  // Logging
  verboseLogging: boolean;
  logRetention: number;  // Days
}

export const DEFAULT_WORKFLOW_CONFIG: WorkflowConfig = {
  maxSteps: 50,
  maxDurationMs: 300000,  // 5 minutes
  maxParallelSteps: 5,
  
  autoCheckpoint: true,
  checkpointInterval: 5,
  maxCheckpoints: 10,
  
  defaultRetryAttempts: 3,
  defaultRetryDelayMs: 1000,
  
  requireConfirmationForDestructive: true,
  dryRunByDefault: false,
  
  verboseLogging: false,
  logRetention: 7,
};
