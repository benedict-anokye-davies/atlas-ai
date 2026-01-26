# T2-FLOW: Workflows + Integrations Implementation Guide

## Terminal 2 Overview

This terminal handles all workflow automation and external service integrations for Atlas.

**Responsibilities:**
- Workflow engine with visual builder support
- Background service for 24/7 operation
- OAuth/API integrations (Google, Discord, etc.)
- Event system and trigger management
- Webhook receiver and scheduler

---

## Directory Structure

```
src/main/
├── workflow/
│   ├── engine.ts              # Workflow execution engine
│   ├── scheduler.ts           # Cron/time-based scheduling
│   ├── trigger-manager.ts     # Event/webhook triggers
│   ├── action-executor.ts     # Action step executor
│   ├── state-machine.ts       # Workflow state management
│   ├── templates/             # Built-in workflow templates
│   │   ├── morning-briefing.ts
│   │   ├── email-digest.ts
│   │   └── crypto-alerts.ts
│   └── types.ts               # Workflow type definitions
├── integrations/
│   ├── manager.ts             # Integration lifecycle manager
│   ├── oauth/
│   │   ├── handler.ts         # OAuth flow handler
│   │   ├── google.ts          # Google OAuth provider
│   │   ├── microsoft.ts       # Microsoft OAuth provider
│   │   └── discord.ts         # Discord OAuth provider
│   ├── providers/
│   │   ├── base.ts            # Base integration class
│   │   ├── gmail.ts           # Gmail integration
│   │   ├── calendar.ts        # Google Calendar integration
│   │   ├── discord.ts         # Discord bot integration
│   │   ├── binance.ts         # Binance crypto integration
│   │   ├── notion.ts          # Notion integration
│   │   └── spotify.ts         # Spotify integration
│   └── mcp/
│       ├── server.ts          # MCP server implementation
│       ├── client.ts          # MCP client for external tools
│       └── registry.ts        # MCP tool registry
├── background/
│   ├── service.ts             # Background service manager
│   ├── health-check.ts        # Service health monitoring
│   └── recovery.ts            # Crash recovery handler
└── events/
    ├── bus.ts                 # Event bus implementation
    ├── webhook-server.ts      # Webhook receiver
    └── system-events.ts       # OS-level event handlers
```

---

## Core Components

### 1. Workflow Engine (`src/main/workflow/engine.ts`)

```typescript
import { EventEmitter } from 'events';
import { v4 as uuid } from 'uuid';
import { logger } from '../utils/logger';
import { DatabaseService } from '../db/service';

// ============================================================================
// Types
// ============================================================================

export type WorkflowStatus = 'idle' | 'running' | 'paused' | 'error' | 'completed';
export type TriggerType = 'manual' | 'schedule' | 'webhook' | 'event' | 'voice';
export type ActionType =
  | 'llm_query'
  | 'send_notification'
  | 'api_call'
  | 'integration_action'
  | 'file_operation'
  | 'conditional'
  | 'loop'
  | 'delay'
  | 'voice_speak';

export interface WorkflowTrigger {
  type: TriggerType;
  config: {
    // Schedule trigger
    cron?: string;
    timezone?: string;

    // Webhook trigger
    webhookPath?: string;
    webhookSecret?: string;

    // Event trigger
    eventType?: string;
    eventFilter?: Record<string, unknown>;

    // Voice trigger
    voicePhrase?: string;
  };
}

export interface WorkflowAction {
  id: string;
  type: ActionType;
  name: string;
  config: Record<string, unknown>;

  // Conditional branching
  onSuccess?: string;  // Next action ID
  onFailure?: string;  // Fallback action ID

  // Retry configuration
  retryCount?: number;
  retryDelayMs?: number;

  // Timeout
  timeoutMs?: number;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  version: number;

  // Triggers
  triggers: WorkflowTrigger[];

  // Actions (DAG structure)
  actions: WorkflowAction[];
  entryActionId: string;

  // Variables
  variables: Record<string, unknown>;

  // Settings
  enabled: boolean;
  maxConcurrentRuns: number;
  timeoutMs: number;

  // Metadata
  createdAt: number;
  updatedAt: number;
  lastRunAt?: number;
  runCount: number;
  successCount: number;
  errorCount: number;
}

export interface WorkflowRun {
  id: string;
  workflowId: string;
  status: WorkflowStatus;

  // Trigger info
  triggeredBy: TriggerType;
  triggerData?: Record<string, unknown>;

  // Execution state
  currentActionId?: string;
  completedActions: string[];
  actionResults: Map<string, ActionResult>;

  // Variables (runtime state)
  variables: Record<string, unknown>;

  // Timing
  startedAt: number;
  completedAt?: number;

  // Error info
  error?: {
    actionId: string;
    message: string;
    stack?: string;
  };
}

export interface ActionResult {
  actionId: string;
  status: 'success' | 'error' | 'skipped';
  output?: unknown;
  error?: string;
  startedAt: number;
  completedAt: number;
  durationMs: number;
}

export interface WorkflowEngineEvents {
  'workflow:started': (run: WorkflowRun) => void;
  'workflow:completed': (run: WorkflowRun) => void;
  'workflow:error': (run: WorkflowRun, error: Error) => void;
  'workflow:paused': (run: WorkflowRun) => void;
  'action:started': (run: WorkflowRun, action: WorkflowAction) => void;
  'action:completed': (run: WorkflowRun, action: WorkflowAction, result: ActionResult) => void;
  'action:error': (run: WorkflowRun, action: WorkflowAction, error: Error) => void;
}

// ============================================================================
// Workflow Engine
// ============================================================================

export class WorkflowEngine extends EventEmitter {
  private workflows: Map<string, WorkflowDefinition> = new Map();
  private activeRuns: Map<string, WorkflowRun> = new Map();
  private actionExecutor: ActionExecutor;
  private db: DatabaseService;

  constructor(db: DatabaseService) {
    super();
    this.db = db;
    this.actionExecutor = new ActionExecutor(this);
  }

  // --------------------------------------------------------------------------
  // Workflow Management
  // --------------------------------------------------------------------------

  async loadWorkflows(): Promise<void> {
    const workflows = await this.db.getWorkflows();

    for (const workflow of workflows) {
      this.workflows.set(workflow.id, workflow);
      logger.info(`Loaded workflow: ${workflow.name}`, { id: workflow.id });
    }

    logger.info(`Loaded ${workflows.length} workflows`);
  }

  async createWorkflow(definition: Omit<WorkflowDefinition, 'id' | 'createdAt' | 'updatedAt' | 'runCount' | 'successCount' | 'errorCount'>): Promise<WorkflowDefinition> {
    const workflow: WorkflowDefinition = {
      ...definition,
      id: uuid(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      runCount: 0,
      successCount: 0,
      errorCount: 0,
    };

    // Validate workflow
    this.validateWorkflow(workflow);

    // Save to database
    await this.db.saveWorkflow(workflow);

    // Add to memory
    this.workflows.set(workflow.id, workflow);

    logger.info(`Created workflow: ${workflow.name}`, { id: workflow.id });
    return workflow;
  }

  async updateWorkflow(id: string, updates: Partial<WorkflowDefinition>): Promise<WorkflowDefinition> {
    const existing = this.workflows.get(id);
    if (!existing) {
      throw new Error(`Workflow not found: ${id}`);
    }

    const updated: WorkflowDefinition = {
      ...existing,
      ...updates,
      id, // Prevent ID change
      version: existing.version + 1,
      updatedAt: Date.now(),
    };

    this.validateWorkflow(updated);
    await this.db.saveWorkflow(updated);
    this.workflows.set(id, updated);

    logger.info(`Updated workflow: ${updated.name}`, { id });
    return updated;
  }

  async deleteWorkflow(id: string): Promise<void> {
    // Stop any active runs
    const activeRuns = Array.from(this.activeRuns.values())
      .filter(run => run.workflowId === id);

    for (const run of activeRuns) {
      await this.cancelRun(run.id);
    }

    await this.db.deleteWorkflow(id);
    this.workflows.delete(id);

    logger.info(`Deleted workflow`, { id });
  }

  getWorkflow(id: string): WorkflowDefinition | undefined {
    return this.workflows.get(id);
  }

  getAllWorkflows(): WorkflowDefinition[] {
    return Array.from(this.workflows.values());
  }

  // --------------------------------------------------------------------------
  // Workflow Execution
  // --------------------------------------------------------------------------

  async executeWorkflow(
    workflowId: string,
    triggeredBy: TriggerType = 'manual',
    triggerData?: Record<string, unknown>
  ): Promise<WorkflowRun> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    if (!workflow.enabled) {
      throw new Error(`Workflow is disabled: ${workflow.name}`);
    }

    // Check concurrent run limit
    const currentRuns = Array.from(this.activeRuns.values())
      .filter(run => run.workflowId === workflowId && run.status === 'running');

    if (currentRuns.length >= workflow.maxConcurrentRuns) {
      throw new Error(`Maximum concurrent runs reached for workflow: ${workflow.name}`);
    }

    // Create run instance
    const run: WorkflowRun = {
      id: uuid(),
      workflowId,
      status: 'running',
      triggeredBy,
      triggerData,
      completedActions: [],
      actionResults: new Map(),
      variables: { ...workflow.variables },
      startedAt: Date.now(),
    };

    this.activeRuns.set(run.id, run);
    this.emit('workflow:started', run);

    logger.info(`Started workflow: ${workflow.name}`, {
      runId: run.id,
      triggeredBy
    });

    // Execute asynchronously
    this.runWorkflow(workflow, run).catch(error => {
      logger.error(`Workflow execution failed: ${workflow.name}`, {
        runId: run.id,
        error
      });
    });

    return run;
  }

  private async runWorkflow(workflow: WorkflowDefinition, run: WorkflowRun): Promise<void> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Workflow timeout')), workflow.timeoutMs);
    });

    try {
      await Promise.race([
        this.executeActions(workflow, run),
        timeoutPromise,
      ]);

      // Success
      run.status = 'completed';
      run.completedAt = Date.now();

      // Update stats
      workflow.runCount++;
      workflow.successCount++;
      workflow.lastRunAt = Date.now();
      await this.db.saveWorkflow(workflow);

      // Save run history
      await this.db.saveWorkflowRun(run);

      this.emit('workflow:completed', run);
      logger.info(`Workflow completed: ${workflow.name}`, { runId: run.id });

    } catch (error) {
      run.status = 'error';
      run.completedAt = Date.now();
      run.error = {
        actionId: run.currentActionId || 'unknown',
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      };

      // Update stats
      workflow.runCount++;
      workflow.errorCount++;
      workflow.lastRunAt = Date.now();
      await this.db.saveWorkflow(workflow);

      // Save run history
      await this.db.saveWorkflowRun(run);

      this.emit('workflow:error', run, error instanceof Error ? error : new Error(String(error)));
      logger.error(`Workflow failed: ${workflow.name}`, {
        runId: run.id,
        error: run.error
      });

    } finally {
      this.activeRuns.delete(run.id);
    }
  }

  private async executeActions(workflow: WorkflowDefinition, run: WorkflowRun): Promise<void> {
    // Build action map
    const actionMap = new Map<string, WorkflowAction>();
    for (const action of workflow.actions) {
      actionMap.set(action.id, action);
    }

    // Start from entry action
    let currentActionId: string | undefined = workflow.entryActionId;

    while (currentActionId && run.status === 'running') {
      const action = actionMap.get(currentActionId);
      if (!action) {
        throw new Error(`Action not found: ${currentActionId}`);
      }

      run.currentActionId = currentActionId;
      this.emit('action:started', run, action);

      const startTime = Date.now();

      try {
        // Execute action with timeout
        const result = await this.executeAction(action, run);

        const actionResult: ActionResult = {
          actionId: action.id,
          status: 'success',
          output: result,
          startedAt: startTime,
          completedAt: Date.now(),
          durationMs: Date.now() - startTime,
        };

        run.actionResults.set(action.id, actionResult);
        run.completedActions.push(action.id);

        // Store result in variables for next actions
        run.variables[`${action.id}_result`] = result;

        this.emit('action:completed', run, action, actionResult);

        // Move to next action
        currentActionId = action.onSuccess;

      } catch (error) {
        const actionResult: ActionResult = {
          actionId: action.id,
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
          startedAt: startTime,
          completedAt: Date.now(),
          durationMs: Date.now() - startTime,
        };

        run.actionResults.set(action.id, actionResult);

        this.emit('action:error', run, action, error instanceof Error ? error : new Error(String(error)));

        // Check for fallback action
        if (action.onFailure) {
          logger.warn(`Action failed, using fallback: ${action.name}`, {
            actionId: action.id,
            fallback: action.onFailure
          });
          currentActionId = action.onFailure;
        } else {
          throw error;
        }
      }
    }
  }

  private async executeAction(action: WorkflowAction, run: WorkflowRun): Promise<unknown> {
    // Apply timeout
    const timeout = action.timeoutMs || 30000;

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Action timeout: ${action.name}`)), timeout);
    });

    // Execute with retries
    let lastError: Error | undefined;
    const retryCount = action.retryCount || 0;

    for (let attempt = 0; attempt <= retryCount; attempt++) {
      try {
        return await Promise.race([
          this.actionExecutor.execute(action, run),
          timeoutPromise,
        ]);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt < retryCount) {
          const delay = action.retryDelayMs || 1000;
          logger.warn(`Action failed, retrying in ${delay}ms`, {
            actionId: action.id,
            attempt: attempt + 1,
            maxAttempts: retryCount + 1,
          });
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError;
  }

  // --------------------------------------------------------------------------
  // Run Management
  // --------------------------------------------------------------------------

  async pauseRun(runId: string): Promise<void> {
    const run = this.activeRuns.get(runId);
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }

    run.status = 'paused';
    this.emit('workflow:paused', run);
    logger.info(`Paused workflow run`, { runId });
  }

  async resumeRun(runId: string): Promise<void> {
    const run = this.activeRuns.get(runId);
    if (!run || run.status !== 'paused') {
      throw new Error(`Run not found or not paused: ${runId}`);
    }

    run.status = 'running';

    const workflow = this.workflows.get(run.workflowId);
    if (!workflow) {
      throw new Error(`Workflow not found: ${run.workflowId}`);
    }

    // Continue execution
    this.runWorkflow(workflow, run).catch(error => {
      logger.error(`Workflow resume failed`, { runId, error });
    });

    logger.info(`Resumed workflow run`, { runId });
  }

  async cancelRun(runId: string): Promise<void> {
    const run = this.activeRuns.get(runId);
    if (!run) {
      return; // Already completed or cancelled
    }

    run.status = 'error';
    run.completedAt = Date.now();
    run.error = {
      actionId: run.currentActionId || 'unknown',
      message: 'Workflow cancelled by user',
    };

    await this.db.saveWorkflowRun(run);
    this.activeRuns.delete(runId);

    logger.info(`Cancelled workflow run`, { runId });
  }

  getActiveRuns(): WorkflowRun[] {
    return Array.from(this.activeRuns.values());
  }

  getRun(runId: string): WorkflowRun | undefined {
    return this.activeRuns.get(runId);
  }

  // --------------------------------------------------------------------------
  // Validation
  // --------------------------------------------------------------------------

  private validateWorkflow(workflow: WorkflowDefinition): void {
    // Check for entry action
    if (!workflow.entryActionId) {
      throw new Error('Workflow must have an entry action');
    }

    // Check entry action exists
    const actionIds = new Set(workflow.actions.map(a => a.id));
    if (!actionIds.has(workflow.entryActionId)) {
      throw new Error(`Entry action not found: ${workflow.entryActionId}`);
    }

    // Validate action references
    for (const action of workflow.actions) {
      if (action.onSuccess && !actionIds.has(action.onSuccess)) {
        throw new Error(`Invalid onSuccess reference in action ${action.id}: ${action.onSuccess}`);
      }
      if (action.onFailure && !actionIds.has(action.onFailure)) {
        throw new Error(`Invalid onFailure reference in action ${action.id}: ${action.onFailure}`);
      }
    }

    // Check for at least one trigger
    if (workflow.triggers.length === 0) {
      throw new Error('Workflow must have at least one trigger');
    }
  }
}

// ============================================================================
// Action Executor
// ============================================================================

export class ActionExecutor {
  private engine: WorkflowEngine;

  constructor(engine: WorkflowEngine) {
    this.engine = engine;
  }

  async execute(action: WorkflowAction, run: WorkflowRun): Promise<unknown> {
    logger.debug(`Executing action: ${action.name}`, {
      type: action.type,
      actionId: action.id
    });

    // Interpolate variables in config
    const config = this.interpolateConfig(action.config, run.variables);

    switch (action.type) {
      case 'llm_query':
        return this.executeLLMQuery(config, run);

      case 'send_notification':
        return this.executeSendNotification(config);

      case 'api_call':
        return this.executeAPICall(config);

      case 'integration_action':
        return this.executeIntegrationAction(config);

      case 'file_operation':
        return this.executeFileOperation(config);

      case 'conditional':
        return this.executeConditional(config, run);

      case 'loop':
        return this.executeLoop(config, run);

      case 'delay':
        return this.executeDelay(config);

      case 'voice_speak':
        return this.executeVoiceSpeak(config);

      default:
        throw new Error(`Unknown action type: ${action.type}`);
    }
  }

  private interpolateConfig(config: Record<string, unknown>, variables: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(config)) {
      if (typeof value === 'string') {
        // Replace {{variable}} patterns
        result[key] = value.replace(/\{\{(\w+)\}\}/g, (_, varName) => {
          return String(variables[varName] ?? '');
        });
      } else if (typeof value === 'object' && value !== null) {
        result[key] = this.interpolateConfig(value as Record<string, unknown>, variables);
      } else {
        result[key] = value;
      }
    }

    return result;
  }

  private async executeLLMQuery(config: Record<string, unknown>, run: WorkflowRun): Promise<unknown> {
    const { llmManager } = await import('../llm/manager');

    const prompt = config.prompt as string;
    const systemPrompt = config.systemPrompt as string | undefined;

    const response = await llmManager.generateResponse({
      messages: [
        ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
        { role: 'user' as const, content: prompt },
      ],
      stream: false,
    });

    return response.content;
  }

  private async executeSendNotification(config: Record<string, unknown>): Promise<void> {
    const { Notification } = await import('electron');

    const notification = new Notification({
      title: config.title as string,
      body: config.body as string,
      icon: config.icon as string | undefined,
      silent: config.silent as boolean | undefined,
    });

    notification.show();
  }

  private async executeAPICall(config: Record<string, unknown>): Promise<unknown> {
    const url = config.url as string;
    const method = (config.method as string) || 'GET';
    const headers = (config.headers as Record<string, string>) || {};
    const body = config.body;

    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      throw new Error(`API call failed: ${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type');
    if (contentType?.includes('application/json')) {
      return response.json();
    }
    return response.text();
  }

  private async executeIntegrationAction(config: Record<string, unknown>): Promise<unknown> {
    const { integrationManager } = await import('../integrations/manager');

    const integrationId = config.integrationId as string;
    const action = config.action as string;
    const params = config.params as Record<string, unknown>;

    return integrationManager.executeAction(integrationId, action, params);
  }

  private async executeFileOperation(config: Record<string, unknown>): Promise<unknown> {
    const fs = await import('fs/promises');
    const operation = config.operation as string;
    const path = config.path as string;

    switch (operation) {
      case 'read':
        return fs.readFile(path, 'utf-8');
      case 'write':
        await fs.writeFile(path, config.content as string);
        return { success: true };
      case 'exists':
        try {
          await fs.access(path);
          return true;
        } catch {
          return false;
        }
      default:
        throw new Error(`Unknown file operation: ${operation}`);
    }
  }

  private async executeConditional(config: Record<string, unknown>, run: WorkflowRun): Promise<unknown> {
    const condition = config.condition as string;
    const variables = run.variables;

    // Simple expression evaluation (in production, use a safe expression parser)
    // This is a basic implementation - should use a proper expression evaluator
    const result = this.evaluateCondition(condition, variables);

    return { conditionMet: result };
  }

  private evaluateCondition(condition: string, variables: Record<string, unknown>): boolean {
    // Basic variable replacement and evaluation
    // In production, use a safe expression parser like expr-eval
    let expr = condition;

    for (const [key, value] of Object.entries(variables)) {
      const pattern = new RegExp(`\\b${key}\\b`, 'g');
      expr = expr.replace(pattern, JSON.stringify(value));
    }

    try {
      // eslint-disable-next-line no-new-func
      return Boolean(new Function(`return ${expr}`)());
    } catch {
      logger.warn(`Failed to evaluate condition: ${condition}`);
      return false;
    }
  }

  private async executeLoop(config: Record<string, unknown>, run: WorkflowRun): Promise<unknown> {
    const items = config.items as unknown[];
    const variableName = config.variableName as string;
    const results: unknown[] = [];

    for (const item of items) {
      run.variables[variableName] = item;
      results.push(item);
    }

    return { processedCount: results.length };
  }

  private async executeDelay(config: Record<string, unknown>): Promise<void> {
    const delayMs = config.delayMs as number;
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }

  private async executeVoiceSpeak(config: Record<string, unknown>): Promise<void> {
    const { ttsManager } = await import('../tts/manager');

    const text = config.text as string;
    const voice = config.voice as string | undefined;

    await ttsManager.speak(text, { voice });
  }
}

export const workflowEngine = new WorkflowEngine(null as any); // Will be initialized with DB
```

---

### 2. Workflow Scheduler (`src/main/workflow/scheduler.ts`)

```typescript
import { CronJob } from 'cron';
import { logger } from '../utils/logger';
import { WorkflowEngine, WorkflowDefinition, WorkflowTrigger } from './engine';

interface ScheduledJob {
  workflowId: string;
  triggerId: number;
  cronJob: CronJob;
}

export class WorkflowScheduler {
  private engine: WorkflowEngine;
  private scheduledJobs: Map<string, ScheduledJob[]> = new Map();
  private isRunning = false;

  constructor(engine: WorkflowEngine) {
    this.engine = engine;
  }

  async start(): Promise<void> {
    if (this.isRunning) return;

    this.isRunning = true;

    // Load and schedule all enabled workflows
    const workflows = this.engine.getAllWorkflows();

    for (const workflow of workflows) {
      if (workflow.enabled) {
        this.scheduleWorkflow(workflow);
      }
    }

    logger.info('Workflow scheduler started', {
      scheduledWorkflows: this.scheduledJobs.size
    });
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;

    // Stop all cron jobs
    for (const jobs of this.scheduledJobs.values()) {
      for (const job of jobs) {
        job.cronJob.stop();
      }
    }

    this.scheduledJobs.clear();
    this.isRunning = false;

    logger.info('Workflow scheduler stopped');
  }

  scheduleWorkflow(workflow: WorkflowDefinition): void {
    // Remove existing schedules
    this.unscheduleWorkflow(workflow.id);

    const jobs: ScheduledJob[] = [];

    // Process schedule triggers
    workflow.triggers.forEach((trigger, index) => {
      if (trigger.type === 'schedule' && trigger.config.cron) {
        try {
          const cronJob = new CronJob(
            trigger.config.cron,
            async () => {
              try {
                logger.info(`Scheduled trigger fired for workflow: ${workflow.name}`, {
                  workflowId: workflow.id,
                  cron: trigger.config.cron,
                });

                await this.engine.executeWorkflow(workflow.id, 'schedule', {
                  triggeredAt: Date.now(),
                  cron: trigger.config.cron,
                });
              } catch (error) {
                logger.error(`Failed to execute scheduled workflow: ${workflow.name}`, {
                  workflowId: workflow.id,
                  error,
                });
              }
            },
            null, // onComplete
            true, // start immediately
            trigger.config.timezone || 'UTC'
          );

          jobs.push({
            workflowId: workflow.id,
            triggerId: index,
            cronJob,
          });

          logger.debug(`Scheduled workflow: ${workflow.name}`, {
            cron: trigger.config.cron,
            timezone: trigger.config.timezone || 'UTC',
            nextRun: cronJob.nextDate().toISO(),
          });

        } catch (error) {
          logger.error(`Invalid cron expression for workflow: ${workflow.name}`, {
            cron: trigger.config.cron,
            error,
          });
        }
      }
    });

    if (jobs.length > 0) {
      this.scheduledJobs.set(workflow.id, jobs);
    }
  }

  unscheduleWorkflow(workflowId: string): void {
    const jobs = this.scheduledJobs.get(workflowId);
    if (jobs) {
      for (const job of jobs) {
        job.cronJob.stop();
      }
      this.scheduledJobs.delete(workflowId);
    }
  }

  getNextRunTime(workflowId: string): Date | null {
    const jobs = this.scheduledJobs.get(workflowId);
    if (!jobs || jobs.length === 0) return null;

    // Find earliest next run across all triggers
    let earliest: Date | null = null;

    for (const job of jobs) {
      const nextDate = job.cronJob.nextDate().toJSDate();
      if (!earliest || nextDate < earliest) {
        earliest = nextDate;
      }
    }

    return earliest;
  }

  getScheduledWorkflows(): { workflowId: string; nextRun: Date }[] {
    const result: { workflowId: string; nextRun: Date }[] = [];

    for (const [workflowId, jobs] of this.scheduledJobs) {
      const nextRun = this.getNextRunTime(workflowId);
      if (nextRun) {
        result.push({ workflowId, nextRun });
      }
    }

    return result.sort((a, b) => a.nextRun.getTime() - b.nextRun.getTime());
  }
}
```

---

### 3. Integration Manager (`src/main/integrations/manager.ts`)

```typescript
import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { DatabaseService } from '../db/service';
import { CredentialStore } from '../security/credentials';

// ============================================================================
// Types
// ============================================================================

export type IntegrationStatus = 'disconnected' | 'connecting' | 'connected' | 'error' | 'expired';
export type IntegrationType =
  | 'gmail'
  | 'calendar'
  | 'discord'
  | 'notion'
  | 'spotify'
  | 'binance'
  | 'github'
  | 'slack'
  | 'custom';

export interface IntegrationConfig {
  id: string;
  type: IntegrationType;
  name: string;
  description?: string;
  config: Record<string, unknown>;
  oauthProvider?: string;
  oauthScopes?: string[];
  status: IntegrationStatus;
  lastSyncAt?: number;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
  capabilities: string[];
}

export interface IntegrationProvider {
  type: IntegrationType;
  name: string;
  description: string;
  icon: string;
  capabilities: string[];
  oauthConfig?: {
    provider: string;
    scopes: string[];
    additionalParams?: Record<string, string>;
  };

  // Lifecycle
  connect(config: IntegrationConfig): Promise<void>;
  disconnect(config: IntegrationConfig): Promise<void>;
  healthCheck(config: IntegrationConfig): Promise<boolean>;

  // Actions
  executeAction(config: IntegrationConfig, action: string, params: Record<string, unknown>): Promise<unknown>;
  getAvailableActions(): IntegrationAction[];
}

export interface IntegrationAction {
  id: string;
  name: string;
  description: string;
  parameters: {
    name: string;
    type: 'string' | 'number' | 'boolean' | 'array' | 'object';
    required: boolean;
    description: string;
  }[];
}

// ============================================================================
// Integration Manager
// ============================================================================

export class IntegrationManager extends EventEmitter {
  private providers: Map<IntegrationType, IntegrationProvider> = new Map();
  private integrations: Map<string, IntegrationConfig> = new Map();
  private db: DatabaseService;
  private credentials: CredentialStore;
  private healthCheckInterval?: NodeJS.Timeout;

  constructor(db: DatabaseService, credentials: CredentialStore) {
    super();
    this.db = db;
    this.credentials = credentials;
  }

  // --------------------------------------------------------------------------
  // Initialization
  // --------------------------------------------------------------------------

  async initialize(): Promise<void> {
    // Register built-in providers
    this.registerBuiltInProviders();

    // Load saved integrations
    const integrations = await this.db.getIntegrations();
    for (const integration of integrations) {
      this.integrations.set(integration.id, integration);
    }

    // Reconnect active integrations
    for (const integration of this.integrations.values()) {
      if (integration.status === 'connected') {
        await this.reconnect(integration.id);
      }
    }

    // Start health check loop
    this.startHealthCheck();

    logger.info('Integration manager initialized', {
      providers: this.providers.size,
      integrations: this.integrations.size,
    });
  }

  async shutdown(): Promise<void> {
    // Stop health checks
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    // Disconnect all integrations
    for (const integration of this.integrations.values()) {
      if (integration.status === 'connected') {
        try {
          await this.disconnect(integration.id);
        } catch (error) {
          logger.error(`Error disconnecting integration: ${integration.name}`, { error });
        }
      }
    }

    logger.info('Integration manager shutdown');
  }

  private registerBuiltInProviders(): void {
    // Register providers (implementations shown below)
    // this.registerProvider(new GmailProvider());
    // this.registerProvider(new CalendarProvider());
    // this.registerProvider(new DiscordProvider());
    // this.registerProvider(new NotionProvider());
    // this.registerProvider(new SpotifyProvider());
    // this.registerProvider(new BinanceProvider());
  }

  registerProvider(provider: IntegrationProvider): void {
    this.providers.set(provider.type, provider);
    logger.debug(`Registered integration provider: ${provider.name}`);
  }

  // --------------------------------------------------------------------------
  // Connection Management
  // --------------------------------------------------------------------------

  async connect(type: IntegrationType, name: string, config: Record<string, unknown> = {}): Promise<IntegrationConfig> {
    const provider = this.providers.get(type);
    if (!provider) {
      throw new Error(`Unknown integration type: ${type}`);
    }

    const integration: IntegrationConfig = {
      id: crypto.randomUUID(),
      type,
      name,
      config,
      oauthProvider: provider.oauthConfig?.provider,
      oauthScopes: provider.oauthConfig?.scopes,
      status: 'connecting',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      capabilities: provider.capabilities,
    };

    try {
      await provider.connect(integration);
      integration.status = 'connected';
      integration.lastSyncAt = Date.now();

      this.integrations.set(integration.id, integration);
      await this.db.saveIntegration(integration);

      this.emit('integration:connected', integration);
      logger.info(`Connected integration: ${name}`, { type, id: integration.id });

      return integration;

    } catch (error) {
      integration.status = 'error';
      integration.lastError = error instanceof Error ? error.message : String(error);

      this.emit('integration:error', integration, error);
      logger.error(`Failed to connect integration: ${name}`, { type, error });

      throw error;
    }
  }

  async disconnect(integrationId: string): Promise<void> {
    const integration = this.integrations.get(integrationId);
    if (!integration) {
      throw new Error(`Integration not found: ${integrationId}`);
    }

    const provider = this.providers.get(integration.type);
    if (!provider) {
      throw new Error(`Provider not found: ${integration.type}`);
    }

    try {
      await provider.disconnect(integration);

      integration.status = 'disconnected';
      integration.updatedAt = Date.now();

      await this.db.saveIntegration(integration);

      // Clear credentials
      await this.credentials.delete(`integration:${integrationId}`);

      this.emit('integration:disconnected', integration);
      logger.info(`Disconnected integration: ${integration.name}`, { id: integrationId });

    } catch (error) {
      logger.error(`Error disconnecting integration: ${integration.name}`, { error });
      throw error;
    }
  }

  async reconnect(integrationId: string): Promise<void> {
    const integration = this.integrations.get(integrationId);
    if (!integration) {
      throw new Error(`Integration not found: ${integrationId}`);
    }

    const provider = this.providers.get(integration.type);
    if (!provider) {
      throw new Error(`Provider not found: ${integration.type}`);
    }

    try {
      integration.status = 'connecting';
      await provider.connect(integration);

      integration.status = 'connected';
      integration.lastSyncAt = Date.now();
      integration.updatedAt = Date.now();

      await this.db.saveIntegration(integration);

      this.emit('integration:reconnected', integration);
      logger.info(`Reconnected integration: ${integration.name}`);

    } catch (error) {
      integration.status = 'error';
      integration.lastError = error instanceof Error ? error.message : String(error);
      integration.updatedAt = Date.now();

      await this.db.saveIntegration(integration);

      this.emit('integration:error', integration, error);
      logger.error(`Failed to reconnect integration: ${integration.name}`, { error });
    }
  }

  // --------------------------------------------------------------------------
  // Action Execution
  // --------------------------------------------------------------------------

  async executeAction(integrationId: string, action: string, params: Record<string, unknown>): Promise<unknown> {
    const integration = this.integrations.get(integrationId);
    if (!integration) {
      throw new Error(`Integration not found: ${integrationId}`);
    }

    if (integration.status !== 'connected') {
      throw new Error(`Integration not connected: ${integration.name}`);
    }

    const provider = this.providers.get(integration.type);
    if (!provider) {
      throw new Error(`Provider not found: ${integration.type}`);
    }

    logger.debug(`Executing integration action: ${action}`, {
      integration: integration.name,
      params,
    });

    try {
      const result = await provider.executeAction(integration, action, params);

      integration.lastSyncAt = Date.now();
      integration.updatedAt = Date.now();
      await this.db.saveIntegration(integration);

      return result;

    } catch (error) {
      logger.error(`Integration action failed: ${action}`, {
        integration: integration.name,
        error,
      });
      throw error;
    }
  }

  // --------------------------------------------------------------------------
  // Health Check
  // --------------------------------------------------------------------------

  private startHealthCheck(): void {
    // Check every 5 minutes
    this.healthCheckInterval = setInterval(async () => {
      for (const integration of this.integrations.values()) {
        if (integration.status === 'connected') {
          await this.checkHealth(integration.id);
        }
      }
    }, 5 * 60 * 1000);
  }

  async checkHealth(integrationId: string): Promise<boolean> {
    const integration = this.integrations.get(integrationId);
    if (!integration) return false;

    const provider = this.providers.get(integration.type);
    if (!provider) return false;

    try {
      const healthy = await provider.healthCheck(integration);

      if (!healthy && integration.status === 'connected') {
        integration.status = 'error';
        integration.lastError = 'Health check failed';
        integration.updatedAt = Date.now();

        await this.db.saveIntegration(integration);
        this.emit('integration:unhealthy', integration);
      }

      return healthy;

    } catch (error) {
      logger.warn(`Health check failed for integration: ${integration.name}`, { error });
      return false;
    }
  }

  // --------------------------------------------------------------------------
  // Getters
  // --------------------------------------------------------------------------

  getIntegration(id: string): IntegrationConfig | undefined {
    return this.integrations.get(id);
  }

  getAllIntegrations(): IntegrationConfig[] {
    return Array.from(this.integrations.values());
  }

  getIntegrationsByType(type: IntegrationType): IntegrationConfig[] {
    return Array.from(this.integrations.values()).filter(i => i.type === type);
  }

  getConnectedIntegrations(): IntegrationConfig[] {
    return Array.from(this.integrations.values()).filter(i => i.status === 'connected');
  }

  getAvailableProviders(): { type: IntegrationType; name: string; description: string }[] {
    return Array.from(this.providers.values()).map(p => ({
      type: p.type,
      name: p.name,
      description: p.description,
    }));
  }

  getProviderActions(type: IntegrationType): IntegrationAction[] {
    const provider = this.providers.get(type);
    return provider ? provider.getAvailableActions() : [];
  }
}

export const integrationManager = new IntegrationManager(null as any, null as any);
```

---

### 4. Gmail Provider (`src/main/integrations/providers/gmail.ts`)

```typescript
import { google, gmail_v1 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { logger } from '../../utils/logger';
import { IntegrationProvider, IntegrationConfig, IntegrationAction } from '../manager';
import { CredentialStore } from '../../security/credentials';

export class GmailProvider implements IntegrationProvider {
  type = 'gmail' as const;
  name = 'Gmail';
  description = 'Send and receive emails through Gmail';
  icon = 'mail';
  capabilities = ['send_email', 'read_email', 'search_email', 'labels', 'drafts'];

  oauthConfig = {
    provider: 'google',
    scopes: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.labels',
    ],
  };

  private clients: Map<string, gmail_v1.Gmail> = new Map();
  private credentials: CredentialStore;

  constructor(credentials: CredentialStore) {
    this.credentials = credentials;
  }

  async connect(config: IntegrationConfig): Promise<void> {
    // Get OAuth tokens
    const tokens = await this.credentials.get(`oauth:google:${config.id}`);
    if (!tokens) {
      throw new Error('OAuth tokens not found. Please authenticate first.');
    }

    const oauthClient = new OAuth2Client();
    oauthClient.setCredentials(JSON.parse(tokens));

    // Handle token refresh
    oauthClient.on('tokens', async (newTokens) => {
      const currentTokens = JSON.parse(tokens);
      const updatedTokens = { ...currentTokens, ...newTokens };
      await this.credentials.set(`oauth:google:${config.id}`, JSON.stringify(updatedTokens));
    });

    const gmail = google.gmail({ version: 'v1', auth: oauthClient });

    // Verify connection
    await gmail.users.getProfile({ userId: 'me' });

    this.clients.set(config.id, gmail);
    logger.info('Gmail connected', { integrationId: config.id });
  }

  async disconnect(config: IntegrationConfig): Promise<void> {
    this.clients.delete(config.id);
    logger.info('Gmail disconnected', { integrationId: config.id });
  }

  async healthCheck(config: IntegrationConfig): Promise<boolean> {
    const gmail = this.clients.get(config.id);
    if (!gmail) return false;

    try {
      await gmail.users.getProfile({ userId: 'me' });
      return true;
    } catch {
      return false;
    }
  }

  async executeAction(config: IntegrationConfig, action: string, params: Record<string, unknown>): Promise<unknown> {
    const gmail = this.clients.get(config.id);
    if (!gmail) {
      throw new Error('Gmail not connected');
    }

    switch (action) {
      case 'send_email':
        return this.sendEmail(gmail, params);

      case 'read_email':
        return this.readEmail(gmail, params);

      case 'search_email':
        return this.searchEmail(gmail, params);

      case 'get_labels':
        return this.getLabels(gmail);

      case 'get_unread_count':
        return this.getUnreadCount(gmail);

      default:
        throw new Error(`Unknown Gmail action: ${action}`);
    }
  }

  private async sendEmail(gmail: gmail_v1.Gmail, params: Record<string, unknown>): Promise<{ messageId: string }> {
    const { to, subject, body, cc, bcc } = params as {
      to: string | string[];
      subject: string;
      body: string;
      cc?: string | string[];
      bcc?: string | string[];
    };

    // Build email
    const toAddresses = Array.isArray(to) ? to.join(', ') : to;
    const ccAddresses = cc ? (Array.isArray(cc) ? cc.join(', ') : cc) : undefined;
    const bccAddresses = bcc ? (Array.isArray(bcc) ? bcc.join(', ') : bcc) : undefined;

    const emailLines = [
      `To: ${toAddresses}`,
      ...(ccAddresses ? [`Cc: ${ccAddresses}`] : []),
      ...(bccAddresses ? [`Bcc: ${bccAddresses}`] : []),
      `Subject: ${subject}`,
      'Content-Type: text/html; charset=utf-8',
      '',
      body,
    ];

    const rawEmail = Buffer.from(emailLines.join('\r\n'))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const response = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw: rawEmail },
    });

    return { messageId: response.data.id! };
  }

  private async readEmail(gmail: gmail_v1.Gmail, params: Record<string, unknown>): Promise<unknown> {
    const { messageId } = params as { messageId: string };

    const response = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full',
    });

    const message = response.data;
    const headers = message.payload?.headers || [];

    const getHeader = (name: string) =>
      headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value;

    // Extract body
    let body = '';
    if (message.payload?.body?.data) {
      body = Buffer.from(message.payload.body.data, 'base64').toString('utf-8');
    } else if (message.payload?.parts) {
      const textPart = message.payload.parts.find(p => p.mimeType === 'text/plain');
      if (textPart?.body?.data) {
        body = Buffer.from(textPart.body.data, 'base64').toString('utf-8');
      }
    }

    return {
      id: message.id,
      threadId: message.threadId,
      from: getHeader('From'),
      to: getHeader('To'),
      subject: getHeader('Subject'),
      date: getHeader('Date'),
      body,
      snippet: message.snippet,
      labels: message.labelIds,
    };
  }

  private async searchEmail(gmail: gmail_v1.Gmail, params: Record<string, unknown>): Promise<unknown> {
    const { query, maxResults = 10 } = params as { query: string; maxResults?: number };

    const response = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults,
    });

    const messages = response.data.messages || [];

    // Get snippet for each message
    const results = await Promise.all(
      messages.map(async (msg) => {
        const detail = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id!,
          format: 'metadata',
          metadataHeaders: ['From', 'Subject', 'Date'],
        });

        const headers = detail.data.payload?.headers || [];
        const getHeader = (name: string) =>
          headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value;

        return {
          id: msg.id,
          threadId: msg.threadId,
          from: getHeader('From'),
          subject: getHeader('Subject'),
          date: getHeader('Date'),
          snippet: detail.data.snippet,
        };
      })
    );

    return { messages: results, total: response.data.resultSizeEstimate };
  }

  private async getLabels(gmail: gmail_v1.Gmail): Promise<unknown> {
    const response = await gmail.users.labels.list({ userId: 'me' });
    return response.data.labels || [];
  }

  private async getUnreadCount(gmail: gmail_v1.Gmail): Promise<{ count: number }> {
    const response = await gmail.users.messages.list({
      userId: 'me',
      q: 'is:unread',
      maxResults: 1,
    });

    return { count: response.data.resultSizeEstimate || 0 };
  }

  getAvailableActions(): IntegrationAction[] {
    return [
      {
        id: 'send_email',
        name: 'Send Email',
        description: 'Send an email message',
        parameters: [
          { name: 'to', type: 'string', required: true, description: 'Recipient email address(es)' },
          { name: 'subject', type: 'string', required: true, description: 'Email subject' },
          { name: 'body', type: 'string', required: true, description: 'Email body (HTML supported)' },
          { name: 'cc', type: 'string', required: false, description: 'CC recipients' },
          { name: 'bcc', type: 'string', required: false, description: 'BCC recipients' },
        ],
      },
      {
        id: 'read_email',
        name: 'Read Email',
        description: 'Read a specific email by ID',
        parameters: [
          { name: 'messageId', type: 'string', required: true, description: 'Gmail message ID' },
        ],
      },
      {
        id: 'search_email',
        name: 'Search Emails',
        description: 'Search emails using Gmail query syntax',
        parameters: [
          { name: 'query', type: 'string', required: true, description: 'Search query (Gmail syntax)' },
          { name: 'maxResults', type: 'number', required: false, description: 'Maximum results (default: 10)' },
        ],
      },
      {
        id: 'get_labels',
        name: 'Get Labels',
        description: 'Get all Gmail labels',
        parameters: [],
      },
      {
        id: 'get_unread_count',
        name: 'Get Unread Count',
        description: 'Get the count of unread emails',
        parameters: [],
      },
    ];
  }
}
```

---

### 5. OAuth Handler (`src/main/integrations/oauth/handler.ts`)

```typescript
import { BrowserWindow, session } from 'electron';
import { createServer, Server, IncomingMessage, ServerResponse } from 'http';
import { parse as parseUrl } from 'url';
import crypto from 'crypto';
import { logger } from '../../utils/logger';
import { CredentialStore } from '../../security/credentials';

// ============================================================================
// Types
// ============================================================================

export interface OAuthConfig {
  provider: string;
  clientId: string;
  authorizationUrl: string;
  tokenUrl: string;
  scopes: string[];
  redirectUri?: string;
  additionalParams?: Record<string, string>;
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  tokenType: string;
  scope?: string;
}

// ============================================================================
// PKCE Helper
// ============================================================================

function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

// ============================================================================
// OAuth Handler
// ============================================================================

export class OAuthHandler {
  private credentials: CredentialStore;
  private localServer?: Server;
  private pendingAuth?: {
    resolve: (tokens: OAuthTokens) => void;
    reject: (error: Error) => void;
    codeVerifier: string;
    config: OAuthConfig;
  };

  // Default OAuth configurations
  private providerConfigs: Record<string, Partial<OAuthConfig>> = {
    google: {
      authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
    },
    microsoft: {
      authorizationUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
      tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    },
    discord: {
      authorizationUrl: 'https://discord.com/api/oauth2/authorize',
      tokenUrl: 'https://discord.com/api/oauth2/token',
    },
    spotify: {
      authorizationUrl: 'https://accounts.spotify.com/authorize',
      tokenUrl: 'https://accounts.spotify.com/api/token',
    },
    notion: {
      authorizationUrl: 'https://api.notion.com/v1/oauth/authorize',
      tokenUrl: 'https://api.notion.com/v1/oauth/token',
    },
    github: {
      authorizationUrl: 'https://github.com/login/oauth/authorize',
      tokenUrl: 'https://github.com/login/oauth/access_token',
    },
  };

  constructor(credentials: CredentialStore) {
    this.credentials = credentials;
  }

  // --------------------------------------------------------------------------
  // Main OAuth Flow
  // --------------------------------------------------------------------------

  async authenticate(config: OAuthConfig): Promise<OAuthTokens> {
    // Merge with provider defaults
    const providerDefaults = this.providerConfigs[config.provider] || {};
    const fullConfig: OAuthConfig = { ...providerDefaults, ...config };

    // Generate PKCE values
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);

    // Start local server for redirect
    const port = await this.startLocalServer();
    const redirectUri = fullConfig.redirectUri || `http://localhost:${port}/callback`;

    // Build authorization URL
    const authUrl = this.buildAuthorizationUrl(fullConfig, redirectUri, codeChallenge);

    // Open auth window
    const authWindow = this.createAuthWindow(authUrl);

    return new Promise<OAuthTokens>((resolve, reject) => {
      this.pendingAuth = {
        resolve,
        reject,
        codeVerifier,
        config: { ...fullConfig, redirectUri },
      };

      // Handle window close
      authWindow.on('closed', () => {
        if (this.pendingAuth) {
          this.pendingAuth.reject(new Error('Authentication cancelled'));
          this.pendingAuth = undefined;
          this.stopLocalServer();
        }
      });

      // Set timeout
      setTimeout(() => {
        if (this.pendingAuth) {
          this.pendingAuth.reject(new Error('Authentication timeout'));
          this.pendingAuth = undefined;
          this.stopLocalServer();
          if (!authWindow.isDestroyed()) {
            authWindow.close();
          }
        }
      }, 5 * 60 * 1000); // 5 minute timeout
    });
  }

  private buildAuthorizationUrl(config: OAuthConfig, redirectUri: string, codeChallenge: string): string {
    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: config.scopes.join(' '),
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      ...config.additionalParams,
    });

    return `${config.authorizationUrl}?${params.toString()}`;
  }

  private createAuthWindow(url: string): BrowserWindow {
    const window = new BrowserWindow({
      width: 600,
      height: 700,
      show: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
      title: 'Atlas - Sign In',
    });

    // Clear existing session data for clean login
    session.defaultSession.clearStorageData({
      storages: ['cookies'],
    });

    window.loadURL(url);

    // Handle navigation for redirect detection
    window.webContents.on('will-redirect', (event, redirectUrl) => {
      if (redirectUrl.startsWith('http://localhost')) {
        // Let the local server handle it
        logger.debug('OAuth redirect detected', { url: redirectUrl });
      }
    });

    return window;
  }

  // --------------------------------------------------------------------------
  // Local Server for Redirect
  // --------------------------------------------------------------------------

  private startLocalServer(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.localServer = createServer(this.handleCallback.bind(this));

      // Find available port
      this.localServer.listen(0, '127.0.0.1', () => {
        const address = this.localServer!.address();
        if (typeof address === 'object' && address) {
          logger.debug('OAuth callback server started', { port: address.port });
          resolve(address.port);
        } else {
          reject(new Error('Failed to start callback server'));
        }
      });

      this.localServer.on('error', reject);
    });
  }

  private stopLocalServer(): void {
    if (this.localServer) {
      this.localServer.close();
      this.localServer = undefined;
    }
  }

  private async handleCallback(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.pendingAuth) {
      res.writeHead(400);
      res.end('No pending authentication');
      return;
    }

    const url = parseUrl(req.url || '', true);

    if (url.pathname !== '/callback') {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const { code, error, error_description } = url.query;

    if (error) {
      const errorMessage = `OAuth error: ${error} - ${error_description}`;
      logger.error(errorMessage);

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(this.getErrorHtml(errorMessage));

      this.pendingAuth.reject(new Error(errorMessage));
      this.pendingAuth = undefined;
      this.stopLocalServer();
      return;
    }

    if (!code || typeof code !== 'string') {
      const errorMessage = 'No authorization code received';
      logger.error(errorMessage);

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(this.getErrorHtml(errorMessage));

      this.pendingAuth.reject(new Error(errorMessage));
      this.pendingAuth = undefined;
      this.stopLocalServer();
      return;
    }

    try {
      // Exchange code for tokens
      const tokens = await this.exchangeCodeForTokens(
        this.pendingAuth.config,
        code,
        this.pendingAuth.codeVerifier
      );

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(this.getSuccessHtml());

      this.pendingAuth.resolve(tokens);
      this.pendingAuth = undefined;

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Token exchange failed';
      logger.error('Token exchange failed', { error: err });

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(this.getErrorHtml(errorMessage));

      this.pendingAuth.reject(err instanceof Error ? err : new Error(errorMessage));
      this.pendingAuth = undefined;

    } finally {
      this.stopLocalServer();
    }
  }

  private async exchangeCodeForTokens(
    config: OAuthConfig,
    code: string,
    codeVerifier: string
  ): Promise<OAuthTokens> {
    const clientSecret = await this.credentials.get(`oauth:${config.provider}:client_secret`);

    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.redirectUri!,
      client_id: config.clientId,
      code_verifier: codeVerifier,
    });

    // Some providers require client secret even with PKCE
    if (clientSecret) {
      params.append('client_secret', clientSecret);
    }

    const response = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Token exchange failed: ${response.status} - ${errorText}`);
    }

    const data = await response.json();

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: data.expires_in ? Date.now() + (data.expires_in * 1000) : undefined,
      tokenType: data.token_type || 'Bearer',
      scope: data.scope,
    };
  }

  // --------------------------------------------------------------------------
  // Token Refresh
  // --------------------------------------------------------------------------

  async refreshToken(provider: string, refreshToken: string): Promise<OAuthTokens> {
    const providerConfig = this.providerConfigs[provider];
    if (!providerConfig?.tokenUrl) {
      throw new Error(`Unknown OAuth provider: ${provider}`);
    }

    const clientId = await this.credentials.get(`oauth:${provider}:client_id`);
    const clientSecret = await this.credentials.get(`oauth:${provider}:client_secret`);

    if (!clientId) {
      throw new Error(`Client ID not configured for provider: ${provider}`);
    }

    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
    });

    if (clientSecret) {
      params.append('client_secret', clientSecret);
    }

    const response = await fetch(providerConfig.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Token refresh failed: ${response.status} - ${errorText}`);
    }

    const data = await response.json();

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || refreshToken, // Some providers don't return new refresh token
      expiresAt: data.expires_in ? Date.now() + (data.expires_in * 1000) : undefined,
      tokenType: data.token_type || 'Bearer',
      scope: data.scope,
    };
  }

  // --------------------------------------------------------------------------
  // HTML Templates
  // --------------------------------------------------------------------------

  private getSuccessHtml(): string {
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Atlas - Authentication Successful</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              background: #1a1a2e;
              color: #eee;
              display: flex;
              justify-content: center;
              align-items: center;
              height: 100vh;
              margin: 0;
            }
            .container {
              text-align: center;
              padding: 40px;
            }
            .icon {
              font-size: 64px;
              margin-bottom: 20px;
            }
            h1 {
              color: #4ade80;
              margin-bottom: 10px;
            }
            p {
              color: #888;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="icon">✓</div>
            <h1>Authentication Successful</h1>
            <p>You can close this window and return to Atlas.</p>
          </div>
          <script>setTimeout(() => window.close(), 3000);</script>
        </body>
      </html>
    `;
  }

  private getErrorHtml(error: string): string {
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Atlas - Authentication Failed</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              background: #1a1a2e;
              color: #eee;
              display: flex;
              justify-content: center;
              align-items: center;
              height: 100vh;
              margin: 0;
            }
            .container {
              text-align: center;
              padding: 40px;
            }
            .icon {
              font-size: 64px;
              margin-bottom: 20px;
            }
            h1 {
              color: #f87171;
              margin-bottom: 10px;
            }
            p {
              color: #888;
            }
            .error {
              background: #2a1a1a;
              padding: 10px 20px;
              border-radius: 8px;
              margin-top: 20px;
              font-family: monospace;
              font-size: 12px;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="icon">✕</div>
            <h1>Authentication Failed</h1>
            <p>Please try again or contact support.</p>
            <div class="error">${error}</div>
          </div>
        </body>
      </html>
    `;
  }
}
```

---

### 6. Background Service (`src/main/background/service.ts`)

```typescript
import { app, Tray, Menu, nativeImage, BrowserWindow } from 'electron';
import { EventEmitter } from 'events';
import path from 'path';
import { logger } from '../utils/logger';
import { WorkflowEngine } from '../workflow/engine';
import { WorkflowScheduler } from '../workflow/scheduler';
import { IntegrationManager } from '../integrations/manager';

// ============================================================================
// Background Service
// ============================================================================

export class BackgroundService extends EventEmitter {
  private tray: Tray | null = null;
  private hiddenWindow: BrowserWindow | null = null;
  private workflowEngine: WorkflowEngine;
  private scheduler: WorkflowScheduler;
  private integrationManager: IntegrationManager;
  private isRunning = false;

  constructor(
    workflowEngine: WorkflowEngine,
    scheduler: WorkflowScheduler,
    integrationManager: IntegrationManager
  ) {
    super();
    this.workflowEngine = workflowEngine;
    this.scheduler = scheduler;
    this.integrationManager = integrationManager;
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  async start(): Promise<void> {
    if (this.isRunning) return;

    logger.info('Starting background service...');

    // Create hidden window for background processing
    this.createHiddenWindow();

    // Create system tray
    this.createTray();

    // Start workflow scheduler
    await this.scheduler.start();

    // Initialize integrations
    await this.integrationManager.initialize();

    // Set up event listeners
    this.setupEventListeners();

    // Prevent app from quitting when main window closes
    app.on('window-all-closed', (e: Event) => {
      e.preventDefault();
    });

    this.isRunning = true;
    this.emit('started');

    logger.info('Background service started');
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;

    logger.info('Stopping background service...');

    // Stop scheduler
    await this.scheduler.stop();

    // Shutdown integrations
    await this.integrationManager.shutdown();

    // Destroy tray
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }

    // Close hidden window
    if (this.hiddenWindow) {
      this.hiddenWindow.destroy();
      this.hiddenWindow = null;
    }

    this.isRunning = false;
    this.emit('stopped');

    logger.info('Background service stopped');
  }

  // --------------------------------------------------------------------------
  // Hidden Window
  // --------------------------------------------------------------------------

  private createHiddenWindow(): void {
    this.hiddenWindow = new BrowserWindow({
      show: false,
      width: 1,
      height: 1,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    // Keep alive - reload if crashed
    this.hiddenWindow.webContents.on('crashed', () => {
      logger.error('Hidden window crashed, restarting...');
      this.hiddenWindow?.reload();
    });

    // Load minimal HTML
    this.hiddenWindow.loadURL('data:text/html,<html><body>Atlas Background Service</body></html>');
  }

  // --------------------------------------------------------------------------
  // System Tray
  // --------------------------------------------------------------------------

  private createTray(): void {
    const iconPath = path.join(__dirname, '../../assets/tray-icon.png');
    const icon = nativeImage.createFromPath(iconPath);

    this.tray = new Tray(icon.resize({ width: 16, height: 16 }));
    this.tray.setToolTip('Atlas AI Assistant');

    this.updateTrayMenu();

    // Double-click to open main window
    this.tray.on('double-click', () => {
      this.emit('open-main-window');
    });
  }

  private updateTrayMenu(): void {
    if (!this.tray) return;

    const activeWorkflows = this.workflowEngine.getActiveRuns().length;
    const connectedIntegrations = this.integrationManager.getConnectedIntegrations().length;
    const scheduledWorkflows = this.scheduler.getScheduledWorkflows();
    const nextRun = scheduledWorkflows[0];

    const menu = Menu.buildFromTemplate([
      {
        label: 'Atlas AI Assistant',
        enabled: false,
      },
      { type: 'separator' },
      {
        label: 'Open Atlas',
        click: () => this.emit('open-main-window'),
      },
      {
        label: 'Quick Actions',
        submenu: [
          {
            label: 'Voice Input',
            accelerator: 'CommandOrControl+Shift+Space',
            click: () => this.emit('activate-voice'),
          },
          {
            label: 'New Conversation',
            click: () => this.emit('new-conversation'),
          },
        ],
      },
      { type: 'separator' },
      {
        label: `Workflows (${activeWorkflows} running)`,
        submenu: [
          {
            label: 'View All Workflows',
            click: () => this.emit('open-workflows'),
          },
          { type: 'separator' },
          ...(nextRun ? [{
            label: `Next: ${this.formatNextRun(nextRun.nextRun)}`,
            enabled: false,
          }] : []),
        ],
      },
      {
        label: `Integrations (${connectedIntegrations} connected)`,
        click: () => this.emit('open-integrations'),
      },
      { type: 'separator' },
      {
        label: 'Settings',
        click: () => this.emit('open-settings'),
      },
      { type: 'separator' },
      {
        label: 'Quit Atlas',
        click: () => {
          this.stop().then(() => app.quit());
        },
      },
    ]);

    this.tray.setContextMenu(menu);
  }

  private formatNextRun(date: Date): string {
    const now = new Date();
    const diff = date.getTime() - now.getTime();

    if (diff < 60000) return 'in less than a minute';
    if (diff < 3600000) return `in ${Math.round(diff / 60000)} minutes`;
    if (diff < 86400000) return `in ${Math.round(diff / 3600000)} hours`;
    return date.toLocaleDateString();
  }

  // --------------------------------------------------------------------------
  // Event Listeners
  // --------------------------------------------------------------------------

  private setupEventListeners(): void {
    // Update tray when workflows change
    this.workflowEngine.on('workflow:started', () => this.updateTrayMenu());
    this.workflowEngine.on('workflow:completed', () => this.updateTrayMenu());
    this.workflowEngine.on('workflow:error', () => this.updateTrayMenu());

    // Update tray when integrations change
    this.integrationManager.on('integration:connected', () => this.updateTrayMenu());
    this.integrationManager.on('integration:disconnected', () => this.updateTrayMenu());

    // Handle app activation (macOS)
    app.on('activate', () => {
      this.emit('open-main-window');
    });

    // Handle second instance
    app.on('second-instance', () => {
      this.emit('open-main-window');
    });
  }

  // --------------------------------------------------------------------------
  // Status
  // --------------------------------------------------------------------------

  getStatus(): {
    isRunning: boolean;
    activeWorkflows: number;
    connectedIntegrations: number;
    scheduledCount: number;
    nextScheduledRun?: Date;
  } {
    const scheduledWorkflows = this.scheduler.getScheduledWorkflows();

    return {
      isRunning: this.isRunning,
      activeWorkflows: this.workflowEngine.getActiveRuns().length,
      connectedIntegrations: this.integrationManager.getConnectedIntegrations().length,
      scheduledCount: scheduledWorkflows.length,
      nextScheduledRun: scheduledWorkflows[0]?.nextRun,
    };
  }
}
```

---

### 7. MCP Server (`src/main/integrations/mcp/server.ts`)

```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { logger } from '../../utils/logger';

// ============================================================================
// Atlas MCP Server
// ============================================================================

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description: string;
      enum?: string[];
    }>;
    required?: string[];
  };
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

export class AtlasMCPServer {
  private server: Server;
  private tools: Map<string, MCPTool> = new Map();

  constructor() {
    this.server = new Server(
      {
        name: 'atlas-mcp-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
  }

  private setupHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools: Tool[] = Array.from(this.tools.values()).map(tool => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      }));

      return { tools };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      const tool = this.tools.get(name);
      if (!tool) {
        throw new Error(`Unknown tool: ${name}`);
      }

      logger.debug(`MCP tool call: ${name}`, { args });

      try {
        const result = await tool.handler(args || {});

        return {
          content: [
            {
              type: 'text',
              text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        logger.error(`MCP tool error: ${name}`, { error });
        throw error;
      }
    });
  }

  registerTool(tool: MCPTool): void {
    this.tools.set(tool.name, tool);
    logger.debug(`Registered MCP tool: ${tool.name}`);
  }

  registerTools(tools: MCPTool[]): void {
    for (const tool of tools) {
      this.registerTool(tool);
    }
  }

  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    logger.info('Atlas MCP server started');
  }

  async stop(): Promise<void> {
    await this.server.close();
    logger.info('Atlas MCP server stopped');
  }
}

// ============================================================================
// Default Atlas Tools for MCP
// ============================================================================

export function createAtlasMCPTools(): MCPTool[] {
  return [
    {
      name: 'atlas_memory_search',
      description: 'Search Atlas memory for relevant information',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query',
          },
          limit: {
            type: 'number',
            description: 'Maximum results to return',
          },
        },
        required: ['query'],
      },
      handler: async (args) => {
        const { memoryManager } = await import('../../memory/manager');
        const results = await memoryManager.search(
          args.query as string,
          { limit: (args.limit as number) || 10 }
        );
        return results;
      },
    },
    {
      name: 'atlas_get_user_facts',
      description: 'Get known facts about the user',
      inputSchema: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            description: 'Category of facts to retrieve',
            enum: ['personal', 'preference', 'work', 'relationship', 'all'],
          },
        },
      },
      handler: async (args) => {
        const { memoryManager } = await import('../../memory/manager');
        const category = args.category as string;
        const facts = await memoryManager.getUserFacts(
          category === 'all' ? undefined : category
        );
        return facts;
      },
    },
    {
      name: 'atlas_execute_workflow',
      description: 'Execute an Atlas workflow',
      inputSchema: {
        type: 'object',
        properties: {
          workflowId: {
            type: 'string',
            description: 'ID of the workflow to execute',
          },
          variables: {
            type: 'object',
            description: 'Variables to pass to the workflow',
          },
        },
        required: ['workflowId'],
      },
      handler: async (args) => {
        const { workflowEngine } = await import('../../workflow/engine');
        const run = await workflowEngine.executeWorkflow(
          args.workflowId as string,
          'manual',
          args.variables as Record<string, unknown>
        );
        return { runId: run.id, status: run.status };
      },
    },
    {
      name: 'atlas_integration_action',
      description: 'Execute an action on a connected integration',
      inputSchema: {
        type: 'object',
        properties: {
          integrationId: {
            type: 'string',
            description: 'ID of the integration',
          },
          action: {
            type: 'string',
            description: 'Action to execute',
          },
          params: {
            type: 'object',
            description: 'Parameters for the action',
          },
        },
        required: ['integrationId', 'action'],
      },
      handler: async (args) => {
        const { integrationManager } = await import('../../integrations/manager');
        return integrationManager.executeAction(
          args.integrationId as string,
          args.action as string,
          (args.params as Record<string, unknown>) || {}
        );
      },
    },
    {
      name: 'atlas_speak',
      description: 'Make Atlas speak text aloud',
      inputSchema: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: 'Text to speak',
          },
        },
        required: ['text'],
      },
      handler: async (args) => {
        const { ttsManager } = await import('../../tts/manager');
        await ttsManager.speak(args.text as string);
        return { success: true };
      },
    },
  ];
}
```

---

## Workflow Templates

### Morning Briefing (`src/main/workflow/templates/morning-briefing.ts`)

```typescript
import { WorkflowDefinition } from '../engine';

export const morningBriefingTemplate: Omit<WorkflowDefinition, 'id' | 'createdAt' | 'updatedAt' | 'runCount' | 'successCount' | 'errorCount'> = {
  name: 'Morning Briefing',
  description: 'Start your day with a personalized briefing including weather, calendar, and news',
  version: 1,
  enabled: true,
  maxConcurrentRuns: 1,
  timeoutMs: 60000,

  triggers: [
    {
      type: 'schedule',
      config: {
        cron: '0 7 * * 1-5', // 7 AM on weekdays
        timezone: 'local',
      },
    },
    {
      type: 'voice',
      config: {
        voicePhrase: 'morning briefing',
      },
    },
  ],

  variables: {
    location: '{{user.location}}',
    newsTopics: ['technology', 'business'],
  },

  actions: [
    {
      id: 'get_weather',
      type: 'api_call',
      name: 'Get Weather',
      config: {
        url: 'https://api.weatherapi.com/v1/forecast.json?key={{env.WEATHER_API_KEY}}&q={{location}}&days=1',
        method: 'GET',
      },
      onSuccess: 'get_calendar',
      timeoutMs: 10000,
    },
    {
      id: 'get_calendar',
      type: 'integration_action',
      name: 'Get Today Calendar',
      config: {
        integrationId: '{{integrations.calendar}}',
        action: 'get_events',
        params: {
          date: 'today',
        },
      },
      onSuccess: 'get_unread_emails',
      timeoutMs: 10000,
    },
    {
      id: 'get_unread_emails',
      type: 'integration_action',
      name: 'Check Unread Emails',
      config: {
        integrationId: '{{integrations.gmail}}',
        action: 'get_unread_count',
        params: {},
      },
      onSuccess: 'generate_briefing',
      timeoutMs: 10000,
    },
    {
      id: 'generate_briefing',
      type: 'llm_query',
      name: 'Generate Briefing',
      config: {
        systemPrompt: 'You are Atlas, a friendly AI assistant. Generate a concise, friendly morning briefing.',
        prompt: `Create a morning briefing based on:
- Weather: {{get_weather_result}}
- Calendar: {{get_calendar_result}}
- Unread emails: {{get_unread_emails_result}}

Keep it conversational and under 200 words.`,
      },
      onSuccess: 'speak_briefing',
      timeoutMs: 30000,
    },
    {
      id: 'speak_briefing',
      type: 'voice_speak',
      name: 'Speak Briefing',
      config: {
        text: '{{generate_briefing_result}}',
      },
      timeoutMs: 60000,
    },
  ],

  entryActionId: 'get_weather',
};
```

---

## IPC Handlers for T2

### Workflow IPC (`src/main/ipc/workflow-handlers.ts`)

```typescript
import { ipcMain } from 'electron';
import { workflowEngine, WorkflowDefinition } from '../workflow/engine';
import { logger } from '../utils/logger';

export function registerWorkflowHandlers(): void {
  // List workflows
  ipcMain.handle('workflow:list', async () => {
    return workflowEngine.getAllWorkflows();
  });

  // Get single workflow
  ipcMain.handle('workflow:get', async (_, workflowId: string) => {
    return workflowEngine.getWorkflow(workflowId);
  });

  // Create workflow
  ipcMain.handle('workflow:create', async (_, definition: Omit<WorkflowDefinition, 'id' | 'createdAt' | 'updatedAt' | 'runCount' | 'successCount' | 'errorCount'>) => {
    return workflowEngine.createWorkflow(definition);
  });

  // Update workflow
  ipcMain.handle('workflow:update', async (_, workflowId: string, updates: Partial<WorkflowDefinition>) => {
    return workflowEngine.updateWorkflow(workflowId, updates);
  });

  // Delete workflow
  ipcMain.handle('workflow:delete', async (_, workflowId: string) => {
    await workflowEngine.deleteWorkflow(workflowId);
    return { success: true };
  });

  // Execute workflow
  ipcMain.handle('workflow:execute', async (_, workflowId: string, triggerData?: Record<string, unknown>) => {
    const run = await workflowEngine.executeWorkflow(workflowId, 'manual', triggerData);
    return run;
  });

  // Get active runs
  ipcMain.handle('workflow:active-runs', async () => {
    return workflowEngine.getActiveRuns();
  });

  // Cancel run
  ipcMain.handle('workflow:cancel-run', async (_, runId: string) => {
    await workflowEngine.cancelRun(runId);
    return { success: true };
  });

  // Pause run
  ipcMain.handle('workflow:pause-run', async (_, runId: string) => {
    await workflowEngine.pauseRun(runId);
    return { success: true };
  });

  // Resume run
  ipcMain.handle('workflow:resume-run', async (_, runId: string) => {
    await workflowEngine.resumeRun(runId);
    return { success: true };
  });

  logger.debug('Workflow IPC handlers registered');
}
```

### Integration IPC (`src/main/ipc/integration-handlers.ts`)

```typescript
import { ipcMain } from 'electron';
import { integrationManager, IntegrationType } from '../integrations/manager';
import { OAuthHandler } from '../integrations/oauth/handler';
import { logger } from '../utils/logger';

export function registerIntegrationHandlers(oauthHandler: OAuthHandler): void {
  // List integrations
  ipcMain.handle('integration:list', async () => {
    return integrationManager.getAllIntegrations();
  });

  // Get integration
  ipcMain.handle('integration:get', async (_, integrationId: string) => {
    return integrationManager.getIntegration(integrationId);
  });

  // Get available providers
  ipcMain.handle('integration:providers', async () => {
    return integrationManager.getAvailableProviders();
  });

  // Get provider actions
  ipcMain.handle('integration:provider-actions', async (_, type: IntegrationType) => {
    return integrationManager.getProviderActions(type);
  });

  // Connect integration (initiates OAuth if needed)
  ipcMain.handle('integration:connect', async (_, type: IntegrationType, name: string, config?: Record<string, unknown>) => {
    return integrationManager.connect(type, name, config);
  });

  // Disconnect integration
  ipcMain.handle('integration:disconnect', async (_, integrationId: string) => {
    await integrationManager.disconnect(integrationId);
    return { success: true };
  });

  // Execute integration action
  ipcMain.handle('integration:execute-action', async (_, integrationId: string, action: string, params: Record<string, unknown>) => {
    return integrationManager.executeAction(integrationId, action, params);
  });

  // Check health
  ipcMain.handle('integration:health-check', async (_, integrationId: string) => {
    return integrationManager.checkHealth(integrationId);
  });

  // OAuth flow
  ipcMain.handle('integration:oauth-start', async (_, provider: string, clientId: string, scopes: string[]) => {
    const tokens = await oauthHandler.authenticate({
      provider,
      clientId,
      scopes,
      authorizationUrl: '', // Will be filled from provider config
      tokenUrl: '',
    });
    return tokens;
  });

  logger.debug('Integration IPC handlers registered');
}
```

---

## Testing

### Workflow Engine Tests (`tests/workflow-engine.test.ts`)

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WorkflowEngine, WorkflowDefinition } from '../src/main/workflow/engine';

describe('WorkflowEngine', () => {
  let engine: WorkflowEngine;
  let mockDb: any;

  beforeEach(() => {
    mockDb = {
      getWorkflows: vi.fn().mockResolvedValue([]),
      saveWorkflow: vi.fn().mockResolvedValue(undefined),
      deleteWorkflow: vi.fn().mockResolvedValue(undefined),
      saveWorkflowRun: vi.fn().mockResolvedValue(undefined),
    };

    engine = new WorkflowEngine(mockDb);
  });

  describe('createWorkflow', () => {
    it('should create a valid workflow', async () => {
      const definition = {
        name: 'Test Workflow',
        description: 'A test workflow',
        version: 1,
        triggers: [{ type: 'manual' as const, config: {} }],
        actions: [{
          id: 'action1',
          type: 'delay' as const,
          name: 'Wait',
          config: { delayMs: 100 },
        }],
        entryActionId: 'action1',
        variables: {},
        enabled: true,
        maxConcurrentRuns: 1,
        timeoutMs: 30000,
      };

      const workflow = await engine.createWorkflow(definition);

      expect(workflow.id).toBeDefined();
      expect(workflow.name).toBe('Test Workflow');
      expect(mockDb.saveWorkflow).toHaveBeenCalled();
    });

    it('should reject workflow without entry action', async () => {
      const definition = {
        name: 'Invalid Workflow',
        description: '',
        version: 1,
        triggers: [{ type: 'manual' as const, config: {} }],
        actions: [],
        entryActionId: '',
        variables: {},
        enabled: true,
        maxConcurrentRuns: 1,
        timeoutMs: 30000,
      };

      await expect(engine.createWorkflow(definition)).rejects.toThrow('entry action');
    });
  });

  describe('executeWorkflow', () => {
    it('should execute a simple workflow', async () => {
      const workflow: WorkflowDefinition = {
        id: 'test-id',
        name: 'Simple Workflow',
        description: '',
        version: 1,
        triggers: [{ type: 'manual', config: {} }],
        actions: [{
          id: 'delay1',
          type: 'delay',
          name: 'Short Delay',
          config: { delayMs: 10 },
        }],
        entryActionId: 'delay1',
        variables: {},
        enabled: true,
        maxConcurrentRuns: 1,
        timeoutMs: 30000,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        runCount: 0,
        successCount: 0,
        errorCount: 0,
      };

      await engine.createWorkflow(workflow);

      const run = await engine.executeWorkflow('test-id', 'manual');

      expect(run.id).toBeDefined();
      expect(run.status).toBe('running');

      // Wait for completion
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    it('should respect concurrent run limits', async () => {
      const workflow = {
        id: 'limited-workflow',
        name: 'Limited Workflow',
        description: '',
        version: 1,
        triggers: [{ type: 'manual' as const, config: {} }],
        actions: [{
          id: 'long-delay',
          type: 'delay' as const,
          name: 'Long Delay',
          config: { delayMs: 10000 },
        }],
        entryActionId: 'long-delay',
        variables: {},
        enabled: true,
        maxConcurrentRuns: 1,
        timeoutMs: 30000,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        runCount: 0,
        successCount: 0,
        errorCount: 0,
      };

      await engine.createWorkflow(workflow);

      // Start first run
      await engine.executeWorkflow('limited-workflow');

      // Second run should fail
      await expect(engine.executeWorkflow('limited-workflow')).rejects.toThrow('Maximum concurrent runs');
    });
  });
});
```

---

## Performance Targets

| Metric | Target |
|--------|--------|
| Workflow start latency | <100ms |
| Action execution overhead | <10ms |
| OAuth flow completion | <30s |
| Integration health check | <5s |
| Background service memory | <50MB |
| Scheduler precision | ±1 minute |

---

## Dependencies to Add

```json
{
  "dependencies": {
    "cron": "^3.1.7",
    "googleapis": "^140.0.0",
    "@modelcontextprotocol/sdk": "^1.0.0"
  }
}
```

---

**Last Updated**: 2026-01-15
