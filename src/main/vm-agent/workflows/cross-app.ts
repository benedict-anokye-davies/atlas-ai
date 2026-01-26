/**
 * Atlas Desktop - VM Agent Cross-App Workflows
 *
 * Orchestrates complex workflows that span multiple applications.
 * Handles data transfer, state synchronization, and flow control.
 *
 * @module vm-agent/workflows/cross-app
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { createModuleLogger } from '../../utils/logger';
import { getEventBus, createEvent } from '../core/event-bus';
import { getStateMachine } from '../core/state-machine';
import { getActionExecutor } from '../core/action-executor';
import { getCheckpointManager } from '../core/checkpoint-manager';
import { VMAction, ScreenState } from '../types';
import { TaskPlan, PlannedStep, CrossAppWorkflow } from '../core/types';
import { getScreenUnderstanding, ApplicationContext } from '../vision/enhanced-screen';
import { getContextFusionEngine } from '../learning/context-fusion';

const logger = createModuleLogger('CrossAppWorkflows');

// =============================================================================
// Cross-App Workflow Constants
// =============================================================================

export const CROSS_APP_CONSTANTS = {
  /** Maximum apps in a workflow */
  MAX_APPS: 10,
  /** App switch timeout */
  APP_SWITCH_TIMEOUT_MS: 5000,
  /** Data transfer timeout */
  DATA_TRANSFER_TIMEOUT_MS: 10000,
  /** Retry count for app switching */
  APP_SWITCH_RETRIES: 3,
  /** Storage file */
  STORAGE_FILE: 'vm-cross-app-workflows.json',
} as const;

// =============================================================================
// Cross-App Workflow Types
// =============================================================================

export type WorkflowStepType =
  | 'switch_app'
  | 'extract_data'
  | 'input_data'
  | 'execute_action'
  | 'verify_state'
  | 'wait_condition'
  | 'branch'
  | 'loop';

export interface WorkflowDefinition {
  /** Workflow ID */
  id: string;
  /** Workflow name */
  name: string;
  /** Description */
  description: string;
  /** Required applications */
  requiredApps: string[];
  /** Workflow steps */
  steps: WorkflowStep[];
  /** Input parameters */
  inputs: WorkflowInput[];
  /** Output parameters */
  outputs: WorkflowOutput[];
  /** Estimated duration */
  estimatedDuration: number;
  /** Created at */
  createdAt: number;
  /** Last modified */
  lastModified: number;
  /** Version */
  version: number;
}

export interface WorkflowStep {
  /** Step ID */
  id: string;
  /** Step type */
  type: WorkflowStepType;
  /** Step name */
  name: string;
  /** Target application */
  targetApp?: string;
  /** Action to execute */
  action?: VMAction;
  /** Data extraction config */
  extractConfig?: DataExtractionConfig;
  /** Data input config */
  inputConfig?: DataInputConfig;
  /** Verification config */
  verifyConfig?: VerificationConfig;
  /** Wait config */
  waitConfig?: WaitConditionConfig;
  /** Branch config */
  branchConfig?: BranchConfig;
  /** Loop config */
  loopConfig?: LoopConfig;
  /** Dependencies (step IDs) */
  dependencies: string[];
  /** Timeout for this step */
  timeout: number;
  /** Retry config */
  retry?: RetryConfig;
}

export interface DataExtractionConfig {
  /** Element selector/description */
  elementSelector: string;
  /** Data type to extract */
  dataType: 'text' | 'image' | 'list' | 'table' | 'form';
  /** Output variable name */
  outputVariable: string;
  /** Transform function */
  transform?: 'uppercase' | 'lowercase' | 'trim' | 'number' | 'date';
}

export interface DataInputConfig {
  /** Target element selector */
  elementSelector: string;
  /** Source variable */
  sourceVariable: string;
  /** Input method */
  inputMethod: 'type' | 'paste' | 'select';
  /** Clear existing */
  clearExisting?: boolean;
}

export interface VerificationConfig {
  /** What to verify */
  verifyType: 'element_exists' | 'text_contains' | 'app_active' | 'state_match';
  /** Expected value */
  expected: string;
  /** Element selector (if applicable) */
  elementSelector?: string;
}

export interface WaitConditionConfig {
  /** Condition type */
  conditionType: 'element_appears' | 'element_disappears' | 'app_ready' | 'time';
  /** Element selector (if applicable) */
  elementSelector?: string;
  /** Duration (for time wait) */
  duration?: number;
}

export interface BranchConfig {
  /** Condition to evaluate */
  condition: string;
  /** Steps if true */
  trueSteps: string[];
  /** Steps if false */
  falseSteps: string[];
}

export interface LoopConfig {
  /** Loop type */
  loopType: 'count' | 'while' | 'for_each';
  /** Count (for count loop) */
  count?: number;
  /** Condition (for while loop) */
  condition?: string;
  /** Items variable (for for_each) */
  itemsVariable?: string;
  /** Loop variable name */
  loopVariable?: string;
  /** Steps to repeat */
  loopSteps: string[];
}

export interface RetryConfig {
  /** Max retries */
  maxRetries: number;
  /** Delay between retries */
  retryDelay: number;
  /** Backoff multiplier */
  backoffMultiplier?: number;
}

export interface WorkflowInput {
  /** Input name */
  name: string;
  /** Input type */
  type: 'string' | 'number' | 'boolean' | 'file' | 'list';
  /** Description */
  description: string;
  /** Is required */
  required: boolean;
  /** Default value */
  defaultValue?: string | number | boolean;
}

export interface WorkflowOutput {
  /** Output name */
  name: string;
  /** Output type */
  type: 'string' | 'number' | 'boolean' | 'file' | 'list' | 'object';
  /** Description */
  description: string;
}

export interface WorkflowExecution {
  /** Execution ID */
  id: string;
  /** Workflow ID */
  workflowId: string;
  /** Status */
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  /** Current step ID */
  currentStepId?: string;
  /** Completed steps */
  completedSteps: string[];
  /** Input values */
  inputs: Record<string, unknown>;
  /** Variables (extracted data, loop counters, etc.) */
  variables: Record<string, unknown>;
  /** Output values */
  outputs: Record<string, unknown>;
  /** Errors */
  errors: Array<{ stepId: string; error: string; timestamp: number }>;
  /** Started at */
  startedAt: number;
  /** Completed at */
  completedAt?: number;
  /** Checkpoints */
  checkpointIds: string[];
}

// =============================================================================
// Cross-App Workflow Manager
// =============================================================================

/**
 * Manages cross-application workflows
 *
 * @example
 * ```typescript
 * const manager = getCrossAppWorkflowManager();
 *
 * // Define a workflow
 * const workflow = manager.createWorkflow({
 *   name: 'Copy data from Excel to Email',
 *   requiredApps: ['excel', 'outlook'],
 *   steps: [
 *     { type: 'switch_app', targetApp: 'excel', ... },
 *     { type: 'extract_data', extractConfig: { ... }, ... },
 *     { type: 'switch_app', targetApp: 'outlook', ... },
 *     { type: 'input_data', inputConfig: { ... }, ... }
 *   ]
 * });
 *
 * // Execute workflow
 * const execution = await manager.executeWorkflow(workflow.id, {
 *   inputData: 'Sheet1!A1:B10'
 * });
 * ```
 */
export class CrossAppWorkflowManager extends EventEmitter {
  private workflows: Map<string, WorkflowDefinition> = new Map();
  private executions: Map<string, WorkflowExecution> = new Map();
  private dataDir: string;
  private initialized: boolean = false;

  constructor() {
    super();
    this.dataDir = path.join(app.getPath('userData'), 'vm-agent');
  }

  /**
   * Initialize the manager
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      if (!fs.existsSync(this.dataDir)) {
        fs.mkdirSync(this.dataDir, { recursive: true });
      }

      await this.loadFromDisk();
      this.initialized = true;
      logger.info('Cross-app workflow manager initialized', {
        workflows: this.workflows.size,
      });
    } catch (error) {
      logger.error('Failed to initialize cross-app workflow manager', { error });
      this.initialized = true;
    }
  }

  /**
   * Create a new workflow
   */
  createWorkflow(definition: Omit<WorkflowDefinition, 'id' | 'createdAt' | 'lastModified' | 'version'>): WorkflowDefinition {
    const workflow: WorkflowDefinition = {
      ...definition,
      id: `workflow-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: Date.now(),
      lastModified: Date.now(),
      version: 1,
    };

    this.workflows.set(workflow.id, workflow);
    this.scheduleSave();

    const eventBus = getEventBus();
    eventBus.emitSync(
      createEvent(
        'workflow:created',
        { workflowId: workflow.id, name: workflow.name },
        'cross-app-workflows',
        { priority: 'normal' },
      ),
    );

    logger.info('Workflow created', { workflowId: workflow.id, name: workflow.name });

    return workflow;
  }

  /**
   * Execute a workflow
   */
  async executeWorkflow(
    workflowId: string,
    inputs: Record<string, unknown>,
  ): Promise<WorkflowExecution> {
    await this.ensureInitialized();

    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    // Validate inputs
    this.validateInputs(workflow, inputs);

    // Create execution
    const execution: WorkflowExecution = {
      id: `exec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      workflowId,
      status: 'pending',
      completedSteps: [],
      inputs,
      variables: { ...inputs },
      outputs: {},
      errors: [],
      startedAt: Date.now(),
      checkpointIds: [],
    };

    this.executions.set(execution.id, execution);

    const eventBus = getEventBus();
    eventBus.emitSync(
      createEvent(
        'workflow:execution-started',
        { executionId: execution.id, workflowId },
        'cross-app-workflows',
        { priority: 'normal' },
      ),
    );

    // Execute asynchronously
    this.runExecution(execution, workflow).catch((error) => {
      logger.error('Workflow execution failed', { executionId: execution.id, error });
    });

    return execution;
  }

  /**
   * Get execution status
   */
  getExecution(executionId: string): WorkflowExecution | undefined {
    return this.executions.get(executionId);
  }

  /**
   * Pause execution
   */
  async pauseExecution(executionId: string): Promise<void> {
    const execution = this.executions.get(executionId);
    if (!execution) throw new Error(`Execution not found: ${executionId}`);

    if (execution.status === 'running') {
      execution.status = 'paused';

      // Create checkpoint
      const checkpoint = await getCheckpointManager().createCheckpoint(
        'manual',
        `Workflow paused: ${executionId}`,
        { workflowExecution: execution },
      );
      execution.checkpointIds.push(checkpoint.id);

      this.emit('execution-paused', execution);
      logger.info('Execution paused', { executionId });
    }
  }

  /**
   * Resume execution
   */
  async resumeExecution(executionId: string): Promise<void> {
    const execution = this.executions.get(executionId);
    if (!execution) throw new Error(`Execution not found: ${executionId}`);

    if (execution.status === 'paused') {
      execution.status = 'running';

      const workflow = this.workflows.get(execution.workflowId)!;
      this.runExecution(execution, workflow).catch((error) => {
        logger.error('Workflow resume failed', { executionId, error });
      });

      this.emit('execution-resumed', execution);
      logger.info('Execution resumed', { executionId });
    }
  }

  /**
   * Cancel execution
   */
  cancelExecution(executionId: string): void {
    const execution = this.executions.get(executionId);
    if (!execution) return;

    execution.status = 'cancelled';
    execution.completedAt = Date.now();

    this.emit('execution-cancelled', execution);
    logger.info('Execution cancelled', { executionId });
  }

  /**
   * Get workflow by ID
   */
  getWorkflow(workflowId: string): WorkflowDefinition | undefined {
    return this.workflows.get(workflowId);
  }

  /**
   * List all workflows
   */
  listWorkflows(): WorkflowDefinition[] {
    return Array.from(this.workflows.values());
  }

  /**
   * Update workflow
   */
  updateWorkflow(workflowId: string, updates: Partial<WorkflowDefinition>): WorkflowDefinition {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) throw new Error(`Workflow not found: ${workflowId}`);

    const updated: WorkflowDefinition = {
      ...workflow,
      ...updates,
      id: workflowId,
      lastModified: Date.now(),
      version: workflow.version + 1,
    };

    this.workflows.set(workflowId, updated);
    this.scheduleSave();

    return updated;
  }

  /**
   * Delete workflow
   */
  deleteWorkflow(workflowId: string): boolean {
    const deleted = this.workflows.delete(workflowId);
    if (deleted) {
      this.scheduleSave();
    }
    return deleted;
  }

  /**
   * Create workflow from recording
   */
  createFromRecording(
    name: string,
    actions: VMAction[],
    appContexts: ApplicationContext[],
  ): WorkflowDefinition {
    const steps: WorkflowStep[] = [];
    const apps = new Set<string>();
    let currentApp = '';

    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];
      const appContext = appContexts[i];
      const appName = appContext?.name || 'unknown';

      apps.add(appName);

      // Add app switch step if needed
      if (appName !== currentApp) {
        steps.push({
          id: `step-${steps.length + 1}`,
          type: 'switch_app',
          name: `Switch to ${appName}`,
          targetApp: appName,
          dependencies: steps.length > 0 ? [steps[steps.length - 1].id] : [],
          timeout: CROSS_APP_CONSTANTS.APP_SWITCH_TIMEOUT_MS,
        });
        currentApp = appName;
      }

      // Add action step
      steps.push({
        id: `step-${steps.length + 1}`,
        type: 'execute_action',
        name: this.describeAction(action),
        action,
        dependencies: steps.length > 0 ? [steps[steps.length - 1].id] : [],
        timeout: 5000,
      });
    }

    return this.createWorkflow({
      name,
      description: `Auto-generated from ${actions.length} recorded actions`,
      requiredApps: Array.from(apps),
      steps,
      inputs: [],
      outputs: [],
      estimatedDuration: actions.length * 2000,
    });
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  private validateInputs(workflow: WorkflowDefinition, inputs: Record<string, unknown>): void {
    for (const input of workflow.inputs) {
      if (input.required && !(input.name in inputs)) {
        throw new Error(`Missing required input: ${input.name}`);
      }
    }
  }

  private async runExecution(
    execution: WorkflowExecution,
    workflow: WorkflowDefinition,
  ): Promise<void> {
    execution.status = 'running';

    try {
      // Create initial checkpoint
      const checkpoint = await getCheckpointManager().createCheckpoint(
        'auto',
        `Workflow started: ${workflow.name}`,
        { workflowExecution: execution },
      );
      execution.checkpointIds.push(checkpoint.id);

      // Execute steps in order
      for (const step of workflow.steps) {
        // Check if paused or cancelled
        if (execution.status !== 'running') {
          return;
        }

        // Check dependencies
        const depsCompleted = step.dependencies.every((dep) =>
          execution.completedSteps.includes(dep),
        );
        if (!depsCompleted) {
          continue; // Skip for now, will be handled in dependency order
        }

        execution.currentStepId = step.id;

        try {
          await this.executeStep(execution, step, workflow);
          execution.completedSteps.push(step.id);
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          execution.errors.push({
            stepId: step.id,
            error: errorMsg,
            timestamp: Date.now(),
          });

          // Retry if configured
          if (step.retry && step.retry.maxRetries > 0) {
            const retried = await this.retryStep(execution, step, workflow);
            if (retried) {
              execution.completedSteps.push(step.id);
              continue;
            }
          }

          // Fail execution
          execution.status = 'failed';
          execution.completedAt = Date.now();

          const eventBus = getEventBus();
          eventBus.emitSync(
            createEvent(
              'workflow:execution-failed',
              { executionId: execution.id, stepId: step.id, error: errorMsg },
              'cross-app-workflows',
              { priority: 'high' },
            ),
          );

          this.emit('execution-failed', { execution, step, error });
          return;
        }
      }

      // Completed successfully
      execution.status = 'completed';
      execution.completedAt = Date.now();

      const eventBus = getEventBus();
      eventBus.emitSync(
        createEvent(
          'workflow:execution-completed',
          { executionId: execution.id, outputs: execution.outputs },
          'cross-app-workflows',
          { priority: 'normal' },
        ),
      );

      this.emit('execution-completed', execution);
      logger.info('Workflow execution completed', { executionId: execution.id });
    } catch (error) {
      execution.status = 'failed';
      execution.completedAt = Date.now();
      logger.error('Workflow execution error', { executionId: execution.id, error });
    }
  }

  private async executeStep(
    execution: WorkflowExecution,
    step: WorkflowStep,
    _workflow: WorkflowDefinition,
  ): Promise<void> {
    const eventBus = getEventBus();
    eventBus.emitSync(
      createEvent(
        'workflow:step-started',
        { executionId: execution.id, stepId: step.id, stepType: step.type },
        'cross-app-workflows',
        { priority: 'normal' },
      ),
    );

    logger.debug('Executing step', { stepId: step.id, type: step.type });

    switch (step.type) {
      case 'switch_app':
        await this.executeSwitchApp(execution, step);
        break;

      case 'extract_data':
        await this.executeExtractData(execution, step);
        break;

      case 'input_data':
        await this.executeInputData(execution, step);
        break;

      case 'execute_action':
        await this.executeAction(execution, step);
        break;

      case 'verify_state':
        await this.executeVerifyState(execution, step);
        break;

      case 'wait_condition':
        await this.executeWaitCondition(execution, step);
        break;

      case 'branch':
        await this.executeBranch(execution, step);
        break;

      case 'loop':
        await this.executeLoop(execution, step);
        break;
    }

    eventBus.emitSync(
      createEvent(
        'workflow:step-completed',
        { executionId: execution.id, stepId: step.id },
        'cross-app-workflows',
        { priority: 'normal' },
      ),
    );
  }

  private async executeSwitchApp(execution: WorkflowExecution, step: WorkflowStep): Promise<void> {
    if (!step.targetApp) {
      throw new Error('Target app not specified');
    }

    const stateMachine = getStateMachine();

    // Try to switch to the app
    for (let attempt = 0; attempt < CROSS_APP_CONSTANTS.APP_SWITCH_RETRIES; attempt++) {
      // Use hotkey to switch apps (Alt+Tab or app-specific method)
      const actionExecutor = getActionExecutor();

      // First try to find the app in taskbar or use system methods
      await actionExecutor.execute({
        type: 'hotkey',
        keys: ['Alt', 'Tab'],
      });

      // Wait for app switch
      await this.sleep(500);

      // Verify app is active
      const understanding = await getScreenUnderstanding();
      const appContext = understanding.applicationContext;

      if (appContext?.name?.toLowerCase().includes(step.targetApp.toLowerCase())) {
        return;
      }

      // If not found, try Windows search
      if (attempt === CROSS_APP_CONSTANTS.APP_SWITCH_RETRIES - 2) {
        await actionExecutor.execute({ type: 'hotkey', keys: ['Meta'] });
        await this.sleep(300);
        await actionExecutor.execute({ type: 'type', text: step.targetApp });
        await this.sleep(500);
        await actionExecutor.execute({ type: 'keyPress', key: 'Enter' });
        await this.sleep(1000);
      }
    }

    throw new Error(`Failed to switch to app: ${step.targetApp}`);
  }

  private async executeExtractData(execution: WorkflowExecution, step: WorkflowStep): Promise<void> {
    if (!step.extractConfig) {
      throw new Error('Extract config not specified');
    }

    const understanding = await getScreenUnderstanding();

    // Find element matching selector
    const element = understanding.enhancedElements.find(
      (el) =>
        el.text?.includes(step.extractConfig!.elementSelector) ||
        el.type === step.extractConfig!.elementSelector,
    );

    if (!element) {
      throw new Error(`Element not found: ${step.extractConfig.elementSelector}`);
    }

    let extractedData: string | string[] = '';

    switch (step.extractConfig.dataType) {
      case 'text':
        extractedData = element.text || '';
        break;

      case 'list':
        // Find all similar elements
        const listElements = understanding.enhancedElements.filter(
          (el) => el.type === element.type && el.text,
        );
        extractedData = listElements.map((el) => el.text!);
        break;

      default:
        extractedData = element.text || '';
    }

    // Apply transform
    if (step.extractConfig.transform && typeof extractedData === 'string') {
      switch (step.extractConfig.transform) {
        case 'uppercase':
          extractedData = extractedData.toUpperCase();
          break;
        case 'lowercase':
          extractedData = extractedData.toLowerCase();
          break;
        case 'trim':
          extractedData = extractedData.trim();
          break;
        case 'number':
          extractedData = parseFloat(extractedData.replace(/[^0-9.-]/g, '')).toString();
          break;
      }
    }

    execution.variables[step.extractConfig.outputVariable] = extractedData;
    logger.debug('Data extracted', {
      variable: step.extractConfig.outputVariable,
      value: extractedData,
    });
  }

  private async executeInputData(execution: WorkflowExecution, step: WorkflowStep): Promise<void> {
    if (!step.inputConfig) {
      throw new Error('Input config not specified');
    }

    const sourceValue = execution.variables[step.inputConfig.sourceVariable];
    if (sourceValue === undefined) {
      throw new Error(`Variable not found: ${step.inputConfig.sourceVariable}`);
    }

    const understanding = await getScreenUnderstanding();

    // Find target element
    const element = understanding.enhancedElements.find(
      (el) =>
        el.text?.includes(step.inputConfig!.elementSelector) ||
        el.type === step.inputConfig!.elementSelector,
    );

    if (!element) {
      throw new Error(`Element not found: ${step.inputConfig.elementSelector}`);
    }

    const actionExecutor = getActionExecutor();
    const x = element.bounds.x + element.bounds.width / 2;
    const y = element.bounds.y + element.bounds.height / 2;

    // Click to focus
    await actionExecutor.execute({ type: 'click', x, y });
    await this.sleep(200);

    // Clear if needed
    if (step.inputConfig.clearExisting) {
      await actionExecutor.execute({ type: 'hotkey', keys: ['Ctrl', 'a'] });
      await this.sleep(100);
    }

    // Input data
    const text = String(sourceValue);
    switch (step.inputConfig.inputMethod) {
      case 'type':
        await actionExecutor.execute({ type: 'type', text });
        break;

      case 'paste':
        // Copy to clipboard and paste
        await actionExecutor.execute({ type: 'hotkey', keys: ['Ctrl', 'v'] });
        break;

      case 'select':
        // For dropdowns
        await actionExecutor.execute({ type: 'type', text });
        await this.sleep(200);
        await actionExecutor.execute({ type: 'keyPress', key: 'Enter' });
        break;
    }
  }

  private async executeAction(execution: WorkflowExecution, step: WorkflowStep): Promise<void> {
    if (!step.action) {
      throw new Error('Action not specified');
    }

    const actionExecutor = getActionExecutor();
    await actionExecutor.execute(step.action);
  }

  private async executeVerifyState(execution: WorkflowExecution, step: WorkflowStep): Promise<void> {
    if (!step.verifyConfig) {
      throw new Error('Verify config not specified');
    }

    const understanding = await getScreenUnderstanding();

    switch (step.verifyConfig.verifyType) {
      case 'element_exists':
        const exists = understanding.enhancedElements.some(
          (el) => el.text?.includes(step.verifyConfig!.expected),
        );
        if (!exists) {
          throw new Error(`Element not found: ${step.verifyConfig.expected}`);
        }
        break;

      case 'text_contains':
        const hasText = understanding.enhancedElements.some(
          (el) => el.text?.includes(step.verifyConfig!.expected),
        );
        if (!hasText) {
          throw new Error(`Text not found: ${step.verifyConfig.expected}`);
        }
        break;

      case 'app_active':
        if (!understanding.applicationContext?.name?.toLowerCase().includes(step.verifyConfig.expected.toLowerCase())) {
          throw new Error(`App not active: ${step.verifyConfig.expected}`);
        }
        break;
    }
  }

  private async executeWaitCondition(execution: WorkflowExecution, step: WorkflowStep): Promise<void> {
    if (!step.waitConfig) {
      throw new Error('Wait config not specified');
    }

    const startTime = Date.now();
    const timeout = step.timeout || 30000;

    while (Date.now() - startTime < timeout) {
      switch (step.waitConfig.conditionType) {
        case 'element_appears':
          const understanding = await getScreenUnderstanding();
          const found = understanding.enhancedElements.some(
            (el) => el.text?.includes(step.waitConfig!.elementSelector || ''),
          );
          if (found) return;
          break;

        case 'element_disappears':
          const understanding2 = await getScreenUnderstanding();
          const stillExists = understanding2.enhancedElements.some(
            (el) => el.text?.includes(step.waitConfig!.elementSelector || ''),
          );
          if (!stillExists) return;
          break;

        case 'time':
          if (step.waitConfig.duration) {
            await this.sleep(step.waitConfig.duration);
            return;
          }
          break;

        case 'app_ready':
          // Check if app is responding
          const understanding3 = await getScreenUnderstanding();
          if (understanding3.applicationContext?.isReady !== false) {
            return;
          }
          break;
      }

      await this.sleep(500);
    }

    throw new Error(`Wait condition timed out: ${step.waitConfig.conditionType}`);
  }

  private async executeBranch(execution: WorkflowExecution, step: WorkflowStep): Promise<void> {
    // Branch execution is handled in the main execution loop
    // This just evaluates the condition and marks which branch to take
    if (!step.branchConfig) {
      throw new Error('Branch config not specified');
    }

    const conditionResult = this.evaluateCondition(step.branchConfig.condition, execution.variables);
    const branchSteps = conditionResult
      ? step.branchConfig.trueSteps
      : step.branchConfig.falseSteps;

    execution.variables['__branch_steps'] = branchSteps;
  }

  private async executeLoop(execution: WorkflowExecution, step: WorkflowStep): Promise<void> {
    // Loop execution is handled in the main execution loop
    if (!step.loopConfig) {
      throw new Error('Loop config not specified');
    }

    // Initialize loop counter
    execution.variables[step.loopConfig.loopVariable || '__loop_i'] = 0;
    execution.variables['__loop_steps'] = step.loopConfig.loopSteps;
    execution.variables['__loop_max'] = step.loopConfig.count || 0;
  }

  private evaluateCondition(condition: string, variables: Record<string, unknown>): boolean {
    // Simple condition evaluation
    // Format: "variableName == value" or "variableName != value"
    const parts = condition.split(/\s*(==|!=|>|<|>=|<=)\s*/);
    if (parts.length !== 3) {
      return false;
    }

    const [varName, operator, value] = parts;
    const varValue = variables[varName];

    switch (operator) {
      case '==':
        return String(varValue) === value;
      case '!=':
        return String(varValue) !== value;
      case '>':
        return Number(varValue) > Number(value);
      case '<':
        return Number(varValue) < Number(value);
      case '>=':
        return Number(varValue) >= Number(value);
      case '<=':
        return Number(varValue) <= Number(value);
      default:
        return false;
    }
  }

  private async retryStep(
    execution: WorkflowExecution,
    step: WorkflowStep,
    workflow: WorkflowDefinition,
  ): Promise<boolean> {
    if (!step.retry) return false;

    let delay = step.retry.retryDelay;

    for (let i = 0; i < step.retry.maxRetries; i++) {
      await this.sleep(delay);

      try {
        await this.executeStep(execution, step, workflow);
        return true;
      } catch (error) {
        logger.warn(`Step retry ${i + 1} failed`, { stepId: step.id, error });
        if (step.retry.backoffMultiplier) {
          delay *= step.retry.backoffMultiplier;
        }
      }
    }

    return false;
  }

  private describeAction(action: VMAction): string {
    switch (action.type) {
      case 'click':
        return `Click at (${action.x}, ${action.y})`;
      case 'type':
        return `Type "${action.text?.slice(0, 20)}..."`;
      case 'keyPress':
        return `Press ${action.key}`;
      case 'hotkey':
        return `Hotkey ${action.keys.join('+')}`;
      default:
        return action.type;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private saveTimeout: NodeJS.Timeout | null = null;
  private scheduleSave(): void {
    if (this.saveTimeout) return;
    this.saveTimeout = setTimeout(() => {
      this.saveToDisk().catch((e) => logger.error('Failed to save workflows', { error: e }));
      this.saveTimeout = null;
    }, 5000);
  }

  private async saveToDisk(): Promise<void> {
    const filePath = path.join(this.dataDir, CROSS_APP_CONSTANTS.STORAGE_FILE);

    const data = {
      workflows: Array.from(this.workflows.entries()),
    };

    await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2));
    logger.debug('Workflows saved', { count: this.workflows.size });
  }

  private async loadFromDisk(): Promise<void> {
    const filePath = path.join(this.dataDir, CROSS_APP_CONSTANTS.STORAGE_FILE);

    if (!fs.existsSync(filePath)) return;

    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const data = JSON.parse(content);

      this.workflows = new Map(data.workflows || []);
    } catch (error) {
      logger.warn('Failed to load workflows', { error });
    }
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let crossAppInstance: CrossAppWorkflowManager | null = null;

/**
 * Get the singleton cross-app workflow manager
 */
export function getCrossAppWorkflowManager(): CrossAppWorkflowManager {
  if (!crossAppInstance) {
    crossAppInstance = new CrossAppWorkflowManager();
  }
  return crossAppInstance;
}

/**
 * Reset cross-app workflow manager (for testing)
 */
export function resetCrossAppWorkflowManager(): void {
  crossAppInstance = null;
}
