/**
 * Workflow Executor
 * 
 * Main orchestrator for executing multi-step autonomous workflows.
 * Handles step sequencing, parallel execution, checkpoints, and rollback.
 * 
 * @module agent/workflow/workflow-executor
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { createModuleLogger } from '../../utils/logger';
import { getErrorMessage } from '../../../shared/utils';
import { getTaskPlanner } from './task-planner';
import { getStepRunner, StepRunner } from './step-runner';
import { getRollbackController, RollbackController } from './rollback-controller';
import {
  Workflow,
  WorkflowStatus,
  WorkflowStep,
  WorkflowContext,
  WorkflowEvent,
  WorkflowConfig,
  WorkflowError,
  StepResult,
  Checkpoint,
  DEFAULT_WORKFLOW_CONFIG,
} from './types';

const logger = createModuleLogger('WorkflowExecutor');

// ============================================================================
// Workflow Executor Class
// ============================================================================

export class WorkflowExecutor extends EventEmitter {
  private config: WorkflowConfig;
  private stepRunner: StepRunner;
  private rollbackController: RollbackController;
  
  // Active workflows
  private workflows: Map<string, Workflow> = new Map();
  private runningWorkflows: Set<string> = new Set();
  
  // Persistence
  private workflowsDir: string;

  constructor(config?: Partial<WorkflowConfig>) {
    super();
    this.config = { ...DEFAULT_WORKFLOW_CONFIG, ...config };
    this.stepRunner = getStepRunner();
    this.rollbackController = getRollbackController();
    this.workflowsDir = path.join(app.getPath('userData'), 'workflows');
    
    this.ensureDir(this.workflowsDir);
    this.setupEventForwarding();
  }

  /**
   * Create and execute a workflow from a natural language request
   */
  async executeRequest(
    request: string,
    options?: {
      workingDirectory?: string;
      dryRun?: boolean;
      userContext?: Record<string, unknown>;
    }
  ): Promise<Workflow> {
    logger.info('Executing request:', request.substring(0, 100));

    // Create workflow from request
    const planner = getTaskPlanner();
    const workflow = await planner.createWorkflow(
      request,
      options?.workingDirectory
    );

    // Apply user context
    if (options?.userContext) {
      workflow.context.userInput = { ...workflow.context.userInput, ...options.userContext };
    }

    // Store workflow
    this.workflows.set(workflow.id, workflow);
    await this.saveWorkflow(workflow);

    // Emit creation event
    this.emitEvent({ type: 'workflow:created', workflow });

    // Execute unless dry run
    if (!options?.dryRun) {
      await this.executeWorkflow(workflow.id);
    }

    return workflow;
  }

  /**
   * Execute an existing workflow
   */
  async executeWorkflow(workflowId: string): Promise<Workflow> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    if (this.runningWorkflows.has(workflowId)) {
      throw new Error(`Workflow already running: ${workflowId}`);
    }

    logger.info(`Starting workflow execution: ${workflowId}`);
    this.runningWorkflows.add(workflowId);

    try {
      workflow.status = 'running';
      workflow.startedAt = Date.now();
      this.emitEvent({ type: 'workflow:started', workflowId });

      // Execute steps
      await this.executeSteps(workflow);

      // Mark completed
      workflow.status = 'completed';
      workflow.completedAt = Date.now();
      const duration = workflow.completedAt - (workflow.startedAt || 0);
      
      this.emitEvent({ type: 'workflow:completed', workflowId, duration });
      logger.info(`Workflow completed: ${workflowId} in ${duration}ms`);

    } catch (error) {
      const workflowError = this.createWorkflowError(error, workflow);
      workflow.error = workflowError;
      workflow.status = 'failed';
      
      this.emitEvent({ type: 'workflow:failed', workflowId, error: workflowError });
      logger.error(`Workflow failed: ${workflowId}`, error);

      // Attempt recovery if possible
      if (workflow.canRollback && workflow.checkpoints.length > 0) {
        await this.attemptRecovery(workflow);
      }

    } finally {
      this.runningWorkflows.delete(workflowId);
      workflow.updatedAt = Date.now();
      await this.saveWorkflow(workflow);
    }

    return workflow;
  }

  /**
   * Execute workflow steps in order
   */
  private async executeSteps(workflow: Workflow): Promise<void> {
    const startTime = Date.now();
    const completedSteps = new Set<string>();
    const pendingSteps = new Map<string, WorkflowStep>();

    // Initialize pending steps
    for (const step of workflow.steps) {
      pendingSteps.set(step.id, step);
    }

    // Process steps until all complete or error
    while (pendingSteps.size > 0) {
      // Check timeout
      if (Date.now() - startTime > this.config.maxDurationMs) {
        throw new Error(`Workflow timeout after ${this.config.maxDurationMs}ms`);
      }

      // Check for pause/cancel
      if (workflow.status === 'paused' || workflow.status === 'cancelled') {
        break;
      }

      // Find steps ready to execute (all dependencies satisfied)
      const readySteps = Array.from(pendingSteps.values()).filter(step =>
        step.dependencies.every(dep => completedSteps.has(dep))
      );

      if (readySteps.length === 0) {
        if (pendingSteps.size > 0) {
          throw new Error('Deadlock detected: no steps ready but steps remain');
        }
        break;
      }

      // Execute ready steps (up to max parallel)
      const stepsToExecute = readySteps.slice(0, this.config.maxParallelSteps);
      
      if (stepsToExecute.length === 1) {
        // Single step - execute directly
        await this.executeSingleStep(workflow, stepsToExecute[0], completedSteps, pendingSteps);
      } else {
        // Multiple steps - execute in parallel
        await Promise.all(
          stepsToExecute.map(step => 
            this.executeSingleStep(workflow, step, completedSteps, pendingSteps)
          )
        );
      }
    }
  }

  /**
   * Execute a single step
   */
  private async executeSingleStep(
    workflow: Workflow,
    step: WorkflowStep,
    completedSteps: Set<string>,
    pendingSteps: Map<string, WorkflowStep>
  ): Promise<void> {
    logger.debug(`Executing step: ${step.id} (${step.name})`);
    
    step.status = 'running';
    step.startedAt = Date.now();
    workflow.currentStepIndex = workflow.steps.indexOf(step);

    this.emitEvent({ type: 'step:started', workflowId: workflow.id, stepId: step.id });

    try {
      // Auto-checkpoint if configured
      if (this.config.autoCheckpoint && 
          workflow.results.length > 0 && 
          workflow.results.length % this.config.checkpointInterval === 0) {
        await this.createCheckpoint(workflow, step.id);
      }

      // Execute the step
      const result = await this.stepRunner.executeStep(step, workflow.context);

      // Handle step result
      step.status = result.status;
      step.completedAt = Date.now();
      step.duration = result.duration;

      // Store result
      workflow.results.push(result);
      
      // Store output in context
      if (result.output !== undefined) {
        workflow.context.stepOutputs[step.id] = result.output;
      }

      if (result.status === 'completed') {
        this.emitEvent({ type: 'step:completed', workflowId: workflow.id, stepId: step.id, result });
        
        // Handle special step types
        await this.handleStepOutput(workflow, step, result, pendingSteps);
        
        completedSteps.add(step.id);
        pendingSteps.delete(step.id);
        
      } else if (result.status === 'failed') {
        this.emitEvent({ 
          type: 'step:failed', 
          workflowId: workflow.id, 
          stepId: step.id, 
          error: result.error! 
        });
        
        // Execute rollback action if available
        if (step.rollbackAction) {
          await this.rollbackController.executeRollbackAction(
            step.rollbackAction,
            step,
            workflow.context
          );
        }
        
        throw new Error(`Step ${step.id} failed: ${result.error?.message}`);
      }

    } catch (error) {
      step.status = 'failed';
      step.completedAt = Date.now();
      throw error;
    }
  }

  /**
   * Handle special step outputs (conditionals, loops, etc.)
   */
  private async handleStepOutput(
    workflow: Workflow,
    step: WorkflowStep,
    result: StepResult,
    pendingSteps: Map<string, WorkflowStep>
  ): Promise<void> {
    const output = result.output as Record<string, unknown> | undefined;

    switch (step.type) {
      case 'conditional': {
        // Add conditional branch steps to pending
        const branch = output?.branch as 'then' | 'else';
        const branchSteps = output?.steps as string[] || [];
        
        // Mark steps not in branch as skipped
        const allConditionalSteps = [
          ...(step.condition?.thenSteps || []),
          ...(step.condition?.elseSteps || []),
        ];
        
        for (const stepId of allConditionalSteps) {
          if (!branchSteps.includes(stepId)) {
            const skippedStep = workflow.steps.find(s => s.id === stepId);
            if (skippedStep) {
              skippedStep.status = 'skipped';
              pendingSteps.delete(stepId);
            }
          }
        }
        break;
      }

      case 'checkpoint': {
        const checkpointId = output?.checkpointId as string;
        if (checkpointId) {
          await this.createCheckpoint(workflow, step.id);
        }
        break;
      }

      case 'human-input': {
        // Input already stored in context by step runner
        break;
      }
    }
  }

  /**
   * Create a checkpoint for the workflow
   */
  private async createCheckpoint(workflow: Workflow, stepId: string): Promise<Checkpoint> {
    if (workflow.checkpoints.length >= this.config.maxCheckpoints) {
      // Remove oldest checkpoint
      workflow.checkpoints.shift();
    }

    const checkpoint = await this.rollbackController.createCheckpoint(
      workflow.id,
      stepId,
      workflow.context
    );

    workflow.checkpoints.push(checkpoint);
    this.emitEvent({ type: 'checkpoint:created', workflowId: workflow.id, checkpointId: checkpoint.id });

    return checkpoint;
  }

  /**
   * Attempt to recover from a failed workflow
   */
  private async attemptRecovery(workflow: Workflow): Promise<void> {
    if (workflow.checkpoints.length === 0) {
      logger.info(`No checkpoints available for recovery: ${workflow.id}`);
      return;
    }

    const lastCheckpoint = workflow.checkpoints[workflow.checkpoints.length - 1];
    logger.info(`Attempting recovery to checkpoint: ${lastCheckpoint.id}`);

    workflow.status = 'rolling-back';
    this.emitEvent({ type: 'rollback:started', workflowId: workflow.id, toCheckpoint: lastCheckpoint.id });

    try {
      await this.rollbackController.rollbackToCheckpoint(
        workflow.id,
        lastCheckpoint,
        workflow.context
      );

      // Mark error as recovery attempted
      if (workflow.error) {
        workflow.error.recoveryAttempted = true;
        workflow.error.recoverySucceeded = true;
      }

      this.emitEvent({ type: 'rollback:completed', workflowId: workflow.id });
      logger.info(`Recovery completed for workflow: ${workflow.id}`);

    } catch (error) {
      logger.error(`Recovery failed for workflow ${workflow.id}:`, error);
      if (workflow.error) {
        workflow.error.recoveryAttempted = true;
        workflow.error.recoverySucceeded = false;
      }
    }
  }

  /**
   * Pause a running workflow
   */
  async pauseWorkflow(workflowId: string): Promise<void> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    if (workflow.status !== 'running') {
      throw new Error(`Cannot pause workflow in status: ${workflow.status}`);
    }

    workflow.status = 'paused';
    workflow.updatedAt = Date.now();
    
    this.emitEvent({ type: 'workflow:paused', workflowId });
    logger.info(`Workflow paused: ${workflowId}`);
    
    await this.saveWorkflow(workflow);
  }

  /**
   * Resume a paused workflow
   */
  async resumeWorkflow(workflowId: string): Promise<Workflow> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    if (workflow.status !== 'paused') {
      throw new Error(`Cannot resume workflow in status: ${workflow.status}`);
    }

    this.emitEvent({ type: 'workflow:resumed', workflowId });
    logger.info(`Workflow resumed: ${workflowId}`);

    return this.executeWorkflow(workflowId);
  }

  /**
   * Cancel a workflow
   */
  async cancelWorkflow(workflowId: string): Promise<void> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    workflow.status = 'cancelled';
    workflow.updatedAt = Date.now();
    
    // Cancel any running steps
    for (const step of workflow.steps) {
      if (step.status === 'running') {
        this.stepRunner.cancelStep(step.id);
      }
    }

    this.emitEvent({ type: 'workflow:cancelled', workflowId });
    logger.info(`Workflow cancelled: ${workflowId}`);
    
    await this.saveWorkflow(workflow);
  }

  /**
   * Provide human input for a waiting step
   */
  provideInput(workflowId: string, stepId: string, input: unknown): void {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    this.stepRunner.provideHumanInput(stepId, input);
  }

  /**
   * Get a workflow by ID
   */
  getWorkflow(workflowId: string): Workflow | undefined {
    return this.workflows.get(workflowId);
  }

  /**
   * List all workflows
   */
  listWorkflows(options?: { status?: WorkflowStatus }): Workflow[] {
    let workflows = Array.from(this.workflows.values());
    
    if (options?.status) {
      workflows = workflows.filter(w => w.status === options.status);
    }
    
    return workflows.sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Load workflows from disk
   */
  async loadWorkflows(): Promise<void> {
    try {
      const files = fs.readdirSync(this.workflowsDir)
        .filter(f => f.endsWith('.json'));

      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(this.workflowsDir, file), 'utf-8');
          const workflow = JSON.parse(content) as Workflow;
          this.workflows.set(workflow.id, workflow);
        } catch (error) {
          logger.warn(`Failed to load workflow ${file}:`, error);
        }
      }

      logger.info(`Loaded ${this.workflows.size} workflows`);
    } catch (error) {
      logger.error('Failed to load workflows:', error);
    }
  }

  /**
   * Save a workflow to disk
   */
  private async saveWorkflow(workflow: Workflow): Promise<void> {
    const filePath = path.join(this.workflowsDir, `${workflow.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(workflow, null, 2), 'utf-8');
  }

  /**
   * Delete a workflow
   */
  async deleteWorkflow(workflowId: string): Promise<void> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      return;
    }

    if (this.runningWorkflows.has(workflowId)) {
      await this.cancelWorkflow(workflowId);
    }

    // Delete checkpoints
    await this.rollbackController.deleteWorkflowCheckpoints(workflowId);

    // Delete workflow file
    const filePath = path.join(this.workflowsDir, `${workflowId}.json`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    this.workflows.delete(workflowId);
    logger.info(`Workflow deleted: ${workflowId}`);
  }

  /**
   * Create WorkflowError from unknown error
   */
  private createWorkflowError(error: unknown, workflow: Workflow): WorkflowError {
    const currentStep = workflow.steps[workflow.currentStepIndex];
    
    return {
      stepId: currentStep?.id || 'unknown',
      code: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
      message: getErrorMessage(error),
      stack: error instanceof Error ? error.stack : undefined,
      timestamp: Date.now(),
      recoveryAttempted: false,
    };
  }

  /**
   * Setup event forwarding from child components
   */
  private setupEventForwarding(): void {
    // Forward step runner events
    this.stepRunner.on('human-input:required', (data) => {
      this.emitEvent({
        type: 'human-input:required',
        workflowId: '', // Will be set by the workflow context
        stepId: data.stepId,
        prompt: data.prompt,
      });
    });

    this.stepRunner.on('checkpoint:requested', async (data) => {
      // Find the workflow that owns this step
      for (const workflow of this.workflows.values()) {
        if (workflow.steps.some(s => s.id === data.stepId)) {
          await this.createCheckpoint(workflow, data.stepId);
          break;
        }
      }
    });
  }

  /**
   * Emit a typed workflow event
   */
  private emitEvent(event: WorkflowEvent): void {
    this.emit(event.type, event);
    this.emit('workflow:event', event);
  }

  /**
   * Ensure directory exists
   */
  private ensureDir(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }
}

// ============================================================================
// Singleton
// ============================================================================

let executorInstance: WorkflowExecutor | null = null;

export function getWorkflowExecutor(config?: Partial<WorkflowConfig>): WorkflowExecutor {
  if (!executorInstance) {
    executorInstance = new WorkflowExecutor(config);
  }
  return executorInstance;
}

export function resetWorkflowExecutor(): void {
  executorInstance = null;
}
