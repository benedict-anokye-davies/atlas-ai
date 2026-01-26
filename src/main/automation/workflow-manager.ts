/**
 * Atlas Desktop - Workflow Manager
 * Handles saving, loading, and executing visual workflows
 */

import * as fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import { app } from 'electron';
import { createModuleLogger } from '../utils/logger';
import type {
  Workflow,
  WorkflowNode,
  WorkflowEdge,
  WorkflowExecutionResult,
  WorkflowExecutionStatus,
  NodeExecutionResult,
  WorkflowTriggerEvent,
} from '../../shared/types/workflow';

const logger = createModuleLogger('WorkflowManager');

/**
 * Workflow manager configuration
 */
export interface WorkflowManagerConfig {
  /** Directory to store workflows */
  storageDir: string;
  /** Maximum concurrent workflow executions */
  maxConcurrentExecutions: number;
  /** Default timeout for node execution (ms) */
  defaultNodeTimeout: number;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: WorkflowManagerConfig = {
  storageDir: path.join(app.getPath('userData'), 'workflows'),
  maxConcurrentExecutions: 5,
  defaultNodeTimeout: 30000,
};

/**
 * Workflow Manager
 * Manages workflow persistence and execution
 */
export class WorkflowManager extends EventEmitter {
  private config: WorkflowManagerConfig;
  private workflows: Map<string, Workflow> = new Map();
  private runningExecutions: Map<string, WorkflowExecutionResult> = new Map();
  private initialized = false;

  constructor(config?: Partial<WorkflowManagerConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize the workflow manager
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Ensure storage directory exists
    if (!existsSync(this.config.storageDir)) {
      mkdirSync(this.config.storageDir, { recursive: true });
      logger.info('Created workflow storage directory', { path: this.config.storageDir });
    }

    // Load existing workflows
    await this.loadAllWorkflows();
    this.initialized = true;
    logger.info('WorkflowManager initialized', { workflowCount: this.workflows.size });
  }

  /**
   * Load all workflows from disk
   */
  private async loadAllWorkflows(): Promise<void> {
    try {
      const files = await fs.readdir(this.config.storageDir);
      const jsonFiles = files.filter((f) => f.endsWith('.json'));

      for (const file of jsonFiles) {
        try {
          const filePath = path.join(this.config.storageDir, file);
          const content = await fs.readFile(filePath, 'utf-8');
          const workflow = JSON.parse(content) as Workflow;
          this.workflows.set(workflow.id, workflow);
        } catch (err) {
          logger.warn('Failed to load workflow file', { file, error: err });
        }
      }
    } catch (err) {
      logger.error('Failed to load workflows', { error: err });
    }
  }

  /**
   * Save a workflow
   */
  async saveWorkflow(workflow: Omit<Workflow, 'id' | 'createdAt' | 'updatedAt' | 'runCount'>): Promise<Workflow> {
    const now = new Date().toISOString();
    const id = `wf_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    const fullWorkflow: Workflow = {
      ...workflow,
      id,
      createdAt: now,
      updatedAt: now,
      runCount: 0,
      enabled: workflow.enabled ?? true,
    };

    // Save to memory
    this.workflows.set(id, fullWorkflow);

    // Save to disk
    const filePath = path.join(this.config.storageDir, `${id}.json`);
    await fs.writeFile(filePath, JSON.stringify(fullWorkflow, null, 2));

    logger.info('Workflow saved', { id, name: fullWorkflow.name });
    this.emit('workflow-saved', fullWorkflow);

    return fullWorkflow;
  }

  /**
   * Update an existing workflow
   */
  async updateWorkflow(id: string, updates: Partial<Omit<Workflow, 'id' | 'createdAt'>>): Promise<Workflow | null> {
    const existing = this.workflows.get(id);
    if (!existing) {
      logger.warn('Workflow not found for update', { id });
      return null;
    }

    const updated: Workflow = {
      ...existing,
      ...updates,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };

    this.workflows.set(id, updated);

    // Save to disk
    const filePath = path.join(this.config.storageDir, `${id}.json`);
    await fs.writeFile(filePath, JSON.stringify(updated, null, 2));

    logger.info('Workflow updated', { id, name: updated.name });
    this.emit('workflow-updated', updated);

    return updated;
  }

  /**
   * Delete a workflow
   */
  async deleteWorkflow(id: string): Promise<boolean> {
    const workflow = this.workflows.get(id);
    if (!workflow) {
      logger.warn('Workflow not found for deletion', { id });
      return false;
    }

    this.workflows.delete(id);

    // Delete from disk
    const filePath = path.join(this.config.storageDir, `${id}.json`);
    try {
      await fs.unlink(filePath);
    } catch (err) {
      logger.warn('Failed to delete workflow file', { id, error: err });
    }

    logger.info('Workflow deleted', { id, name: workflow.name });
    this.emit('workflow-deleted', id);

    return true;
  }

  /**
   * Get a workflow by ID
   */
  getWorkflow(id: string): Workflow | undefined {
    return this.workflows.get(id);
  }

  /**
   * Get all workflows
   */
  getAllWorkflows(): Workflow[] {
    return Array.from(this.workflows.values());
  }

  /**
   * Execute a workflow
   */
  async executeWorkflow(id: string, triggerEvent?: WorkflowTriggerEvent): Promise<WorkflowExecutionResult> {
    const workflow = this.workflows.get(id);
    if (!workflow) {
      throw new Error(`Workflow not found: ${id}`);
    }

    if (!workflow.enabled) {
      throw new Error(`Workflow is disabled: ${id}`);
    }

    if (this.runningExecutions.size >= this.config.maxConcurrentExecutions) {
      throw new Error('Maximum concurrent executions reached');
    }

    const executionId = `exec_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const execution: WorkflowExecutionResult = {
      workflowId: id,
      executionId,
      status: 'running',
      startedAt: new Date().toISOString(),
      nodeResults: {},
    };

    this.runningExecutions.set(executionId, execution);
    this.emit('execution-started', execution);

    try {
      // Find trigger nodes
      const triggerNodes = workflow.nodes.filter((n) => n.type === 'trigger');
      if (triggerNodes.length === 0) {
        throw new Error('Workflow has no trigger nodes');
      }

      // Execute from trigger nodes
      await this.executeNodes(workflow, triggerNodes, execution, triggerEvent?.payload);

      execution.status = 'completed';
      execution.completedAt = new Date().toISOString();

      // Update workflow stats
      await this.updateWorkflow(id, {
        lastRunAt: execution.completedAt,
        runCount: workflow.runCount + 1,
      });

    } catch (err) {
      execution.status = 'failed';
      execution.error = err instanceof Error ? err.message : String(err);
      execution.completedAt = new Date().toISOString();
      logger.error('Workflow execution failed', { id, executionId, error: err });
    }

    this.runningExecutions.delete(executionId);
    this.emit('execution-completed', execution);

    return execution;
  }

  /**
   * Execute nodes in sequence following edges
   */
  private async executeNodes(
    workflow: Workflow,
    nodes: WorkflowNode[],
    execution: WorkflowExecutionResult,
    context?: Record<string, unknown>
  ): Promise<void> {
    for (const node of nodes) {
      const nodeResult = await this.executeNode(node, context);
      execution.nodeResults[node.id] = nodeResult;

      if (nodeResult.status === 'failed') {
        throw new Error(`Node ${node.id} failed: ${nodeResult.error}`);
      }

      // Find connected nodes
      const outgoingEdges = workflow.edges.filter((e) => e.source === node.id);
      const nextNodes = outgoingEdges
        .map((e) => workflow.nodes.find((n) => n.id === e.target))
        .filter((n): n is WorkflowNode => n !== undefined);

      if (nextNodes.length > 0) {
        // Pass output as context to next nodes
        const nextContext = { ...context, [node.id]: nodeResult.output };
        await this.executeNodes(workflow, nextNodes, execution, nextContext);
      }
    }
  }

  /**
   * Execute a single node
   */
  private async executeNode(
    node: WorkflowNode,
    context?: Record<string, unknown>
  ): Promise<NodeExecutionResult> {
    const result: NodeExecutionResult = {
      nodeId: node.id,
      status: 'running',
      startedAt: new Date().toISOString(),
    };

    try {
      // Execute based on node type and config
      const output = await this.executeNodeAction(node, context);
      result.status = 'completed';
      result.output = output;
      result.completedAt = new Date().toISOString();
    } catch (err) {
      result.status = 'failed';
      result.error = err instanceof Error ? err.message : String(err);
      result.completedAt = new Date().toISOString();
    }

    return result;
  }

  /**
   * Execute the actual node action
   */
  private async executeNodeAction(
    node: WorkflowNode,
    context?: Record<string, unknown>
  ): Promise<unknown> {
    const { data } = node;
    const config = data.config || {};

    switch (data.label) {
      case 'Run Terminal': {
        const command = config.command as string;
        if (!command) throw new Error('No command specified');
        // Use existing terminal tool
        const { executeCommand } = await import('../agent/tools/terminal');
        return executeCommand(command);
      }

      case 'Notify': {
        const { Notification } = await import('electron');
        const title = config.title as string || 'Atlas Workflow';
        const body = config.body as string || 'Workflow notification';
        new Notification({ title, body }).show();
        return { notified: true };
      }

      case 'HTTP Request': {
        const url = config.url as string;
        const method = (config.method as string) || 'GET';
        if (!url) throw new Error('No URL specified');
        const response = await fetch(url, { method });
        return { status: response.status, ok: response.ok };
      }

      case 'AI Chat': {
        const prompt = config.prompt as string;
        if (!prompt) throw new Error('No prompt specified');
        // Use LLM manager
        const { getLLMManager } = await import('../llm/manager');
        const llm = getLLMManager();
        const response = await llm.chat(prompt);
        return { response: response.content };
      }

      case 'Write File': {
        const filePath = config.path as string;
        const content = config.content as string;
        if (!filePath || content === undefined) throw new Error('Missing path or content');
        await fs.writeFile(filePath, content);
        return { written: true, path: filePath };
      }

      case 'Voice Command':
      case 'Schedule':
      case 'Webhook':
      case 'File Change':
      case 'Email':
      case 'Price Alert':
        // Trigger nodes just pass through
        return { triggered: true, context };

      case 'If/Else':
      case 'Contains':
      case 'Compare':
      case 'File Exists': {
        // Condition nodes evaluate and return boolean
        const condition = config.condition as string;
        // Simple evaluation for now
        return { result: Boolean(condition), context };
      }

      case 'Log':
      case 'Store Memory':
      case 'Set Variable':
        // Output nodes
        return { logged: true, data: context };

      default:
        logger.warn('Unknown node action', { label: data.label });
        return { executed: true };
    }
  }

  /**
   * Cancel a running execution
   */
  cancelExecution(executionId: string): boolean {
    const execution = this.runningExecutions.get(executionId);
    if (!execution) return false;

    execution.status = 'cancelled';
    execution.completedAt = new Date().toISOString();
    this.runningExecutions.delete(executionId);
    this.emit('execution-cancelled', execution);

    return true;
  }

  /**
   * Get running executions
   */
  getRunningExecutions(): WorkflowExecutionResult[] {
    return Array.from(this.runningExecutions.values());
  }

  /**
   * Shutdown the manager
   */
  async shutdown(): Promise<void> {
    // Cancel all running executions
    for (const [id] of this.runningExecutions) {
      this.cancelExecution(id);
    }
    this.workflows.clear();
    this.initialized = false;
    logger.info('WorkflowManager shutdown');
  }
}

// Singleton instance
let workflowManagerInstance: WorkflowManager | null = null;

/**
 * Get the workflow manager instance
 */
export function getWorkflowManager(): WorkflowManager {
  if (!workflowManagerInstance) {
    workflowManagerInstance = new WorkflowManager();
  }
  return workflowManagerInstance;
}

/**
 * Initialize the workflow manager
 */
export async function initializeWorkflowManager(): Promise<WorkflowManager> {
  const manager = getWorkflowManager();
  await manager.initialize();
  return manager;
}

/**
 * Shutdown the workflow manager
 */
export async function shutdownWorkflowManager(): Promise<void> {
  if (workflowManagerInstance) {
    await workflowManagerInstance.shutdown();
    workflowManagerInstance = null;
  }
}
