/**
 * Atlas Desktop - Workflow Learner
 * Learn and automate repetitive workflows
 *
 * Features:
 * - Action sequence recording
 * - Pattern detection in workflows
 * - Workflow suggestion
 * - Automated workflow execution
 * - Workflow optimization
 *
 * @module ml/workflow-learner
 */

import { EventEmitter } from 'events';
import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('WorkflowLearner');

// ============================================================================
// Types
// ============================================================================

export interface WorkflowAction {
  id: string;
  type: string;
  command: string;
  parameters: Record<string, unknown>;
  timestamp: number;
  duration?: number;
  result?: 'success' | 'failure';
  context?: Record<string, unknown>;
}

export interface LearnedWorkflow {
  id: string;
  name: string;
  description?: string;
  actions: WorkflowAction[];
  frequency: number;
  avgDuration: number;
  successRate: number;
  triggers: WorkflowTrigger[];
  variables: WorkflowVariable[];
  createdAt: number;
  lastExecuted: number;
  confidence: number;
}

export interface WorkflowTrigger {
  type: 'manual' | 'time' | 'context' | 'action';
  condition: string;
  parameters?: Record<string, unknown>;
}

export interface WorkflowVariable {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  defaultValue?: unknown;
  source?: 'input' | 'context' | 'previous_action';
}

export interface WorkflowSuggestion {
  workflow: LearnedWorkflow;
  confidence: number;
  reason: string;
  matchedTrigger?: WorkflowTrigger;
}

export interface WorkflowExecution {
  id: string;
  workflowId: string;
  startTime: number;
  endTime?: number;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  currentStep: number;
  results: Array<{ actionId: string; success: boolean; output?: unknown }>;
  variables: Record<string, unknown>;
}

export interface WorkflowLearnerConfig {
  minActionsForPattern: number;
  patternSimilarityThreshold: number;
  maxWorkflows: number;
  recordingTimeout: number; // ms
  suggestionThreshold: number;
}

export interface WorkflowLearnerEvents {
  'workflow-learned': (workflow: LearnedWorkflow) => void;
  'workflow-suggested': (suggestion: WorkflowSuggestion) => void;
  'workflow-started': (execution: WorkflowExecution) => void;
  'workflow-completed': (execution: WorkflowExecution) => void;
  'workflow-step': (execution: WorkflowExecution, action: WorkflowAction) => void;
  error: (error: Error) => void;
}

// ============================================================================
// Workflow Learner
// ============================================================================

export class WorkflowLearner extends EventEmitter {
  private config: WorkflowLearnerConfig;
  private workflows: Map<string, LearnedWorkflow> = new Map();
  private actionHistory: WorkflowAction[] = [];
  private recordingSession: WorkflowAction[] = [];
  private isRecording = false;
  private activeExecutions: Map<string, WorkflowExecution> = new Map();
  private dataPath: string;

  // Pattern detection
  private actionSequences: Map<string, number> = new Map(); // sequence hash -> count

  // Stats
  private stats = {
    actionsRecorded: 0,
    workflowsLearned: 0,
    workflowsExecuted: 0,
    suggestionsProvided: 0,
  };

  constructor(config?: Partial<WorkflowLearnerConfig>) {
    super();
    this.config = {
      minActionsForPattern: 3,
      patternSimilarityThreshold: 0.8,
      maxWorkflows: 100,
      recordingTimeout: 300000, // 5 minutes
      suggestionThreshold: 0.6,
      ...config,
    };

    this.dataPath = path.join(app.getPath('userData'), 'workflows.json');
    this.loadData();

    logger.info('WorkflowLearner initialized', { config: this.config });
  }

  // ============================================================================
  // Data Persistence
  // ============================================================================

  private loadData(): void {
    try {
      if (fs.existsSync(this.dataPath)) {
        const data = JSON.parse(fs.readFileSync(this.dataPath, 'utf-8'));

        for (const workflow of data.workflows || []) {
          this.workflows.set(workflow.id, workflow);
        }

        this.actionHistory = (data.actionHistory || []).slice(-1000);

        logger.info('Loaded workflows', { count: this.workflows.size });
      }
    } catch (error) {
      logger.warn('Failed to load workflow data', { error });
    }
  }

  private saveData(): void {
    try {
      const data = {
        workflows: Array.from(this.workflows.values()),
        actionHistory: this.actionHistory.slice(-1000),
        savedAt: Date.now(),
      };
      fs.writeFileSync(this.dataPath, JSON.stringify(data, null, 2));
    } catch (error) {
      logger.warn('Failed to save workflow data', { error });
    }
  }

  // ============================================================================
  // Action Recording
  // ============================================================================

  /**
   * Record an action
   */
  recordAction(action: Omit<WorkflowAction, 'id' | 'timestamp'>): void {
    const fullAction: WorkflowAction = {
      ...action,
      id: this.generateId('action'),
      timestamp: Date.now(),
    };

    this.actionHistory.push(fullAction);
    this.stats.actionsRecorded++;

    // Add to recording session if active
    if (this.isRecording) {
      this.recordingSession.push(fullAction);
    }

    // Detect patterns
    this.detectPatterns();

    // Check for workflow suggestions
    this.checkSuggestions(fullAction);

    // Trim history
    if (this.actionHistory.length > 5000) {
      this.actionHistory = this.actionHistory.slice(-5000);
    }
  }

  /**
   * Start recording a workflow
   */
  startRecording(): void {
    this.isRecording = true;
    this.recordingSession = [];

    // Auto-stop after timeout
    setTimeout(() => {
      if (this.isRecording) {
        this.stopRecording('Timeout');
      }
    }, this.config.recordingTimeout);

    logger.info('Started workflow recording');
  }

  /**
   * Stop recording and optionally save workflow
   */
  stopRecording(name?: string): LearnedWorkflow | null {
    this.isRecording = false;

    if (this.recordingSession.length < this.config.minActionsForPattern) {
      logger.info('Recording stopped - not enough actions', {
        count: this.recordingSession.length,
      });
      return null;
    }

    const workflow = this.createWorkflow(this.recordingSession, name || 'Recorded Workflow');
    this.workflows.set(workflow.id, workflow);
    this.stats.workflowsLearned++;

    this.emit('workflow-learned', workflow);
    this.saveData();

    logger.info('Workflow recorded', { id: workflow.id, actions: workflow.actions.length });

    this.recordingSession = [];
    return workflow;
  }

  // ============================================================================
  // Pattern Detection
  // ============================================================================

  /**
   * Detect patterns in action history
   */
  private detectPatterns(): void {
    if (this.actionHistory.length < this.config.minActionsForPattern) return;

    // Look for repeated sequences
    const windowSizes = [3, 4, 5, 6, 7];

    for (const windowSize of windowSizes) {
      for (let i = 0; i <= this.actionHistory.length - windowSize; i++) {
        const sequence = this.actionHistory.slice(i, i + windowSize);
        const hash = this.hashSequence(sequence);

        const count = (this.actionSequences.get(hash) || 0) + 1;
        this.actionSequences.set(hash, count);

        // Check if this pattern is significant
        if (count >= 3 && !this.hasMatchingWorkflow(sequence)) {
          const workflow = this.createWorkflow(sequence, `Auto-learned pattern ${this.workflows.size + 1}`);
          workflow.confidence = Math.min(count * 0.2, 1);

          this.workflows.set(workflow.id, workflow);
          this.stats.workflowsLearned++;

          this.emit('workflow-learned', workflow);
          logger.info('Pattern detected and learned', {
            id: workflow.id,
            count,
            actions: sequence.length,
          });
        }
      }
    }
  }

  /**
   * Hash action sequence for comparison
   */
  private hashSequence(actions: WorkflowAction[]): string {
    return actions.map((a) => `${a.type}:${a.command}`).join('->');
  }

  /**
   * Check if workflow matches a sequence
   */
  private hasMatchingWorkflow(sequence: WorkflowAction[]): boolean {
    const hash = this.hashSequence(sequence);

    for (const workflow of this.workflows.values()) {
      const workflowHash = this.hashSequence(workflow.actions);
      if (workflowHash === hash) return true;
    }

    return false;
  }

  // ============================================================================
  // Workflow Creation
  // ============================================================================

  /**
   * Create a workflow from actions
   */
  private createWorkflow(actions: WorkflowAction[], name: string): LearnedWorkflow {
    // Extract variables from actions
    const variables = this.extractVariables(actions);

    // Calculate statistics
    const avgDuration = actions.reduce((sum, a) => sum + (a.duration || 0), 0) / actions.length;
    const successCount = actions.filter((a) => a.result === 'success').length;
    const successRate = actions.length > 0 ? successCount / actions.length : 1;

    // Detect triggers
    const triggers = this.detectTriggers(actions);

    return {
      id: this.generateId('workflow'),
      name,
      description: this.generateDescription(actions),
      actions: actions.map((a) => ({
        ...a,
        id: this.generateId('action'),
      })),
      frequency: 1,
      avgDuration,
      successRate,
      triggers,
      variables,
      createdAt: Date.now(),
      lastExecuted: 0,
      confidence: 0.5,
    };
  }

  /**
   * Extract variables from actions
   */
  private extractVariables(actions: WorkflowAction[]): WorkflowVariable[] {
    const variables: WorkflowVariable[] = [];
    const seenParams = new Set<string>();

    for (const action of actions) {
      for (const [key, value] of Object.entries(action.parameters)) {
        if (!seenParams.has(key)) {
          seenParams.add(key);
          variables.push({
            name: key,
            type: this.inferType(value),
            defaultValue: value,
            source: 'input',
          });
        }
      }
    }

    return variables;
  }

  /**
   * Infer variable type
   */
  private inferType(value: unknown): WorkflowVariable['type'] {
    if (typeof value === 'string') return 'string';
    if (typeof value === 'number') return 'number';
    if (typeof value === 'boolean') return 'boolean';
    if (Array.isArray(value)) return 'array';
    return 'object';
  }

  /**
   * Detect potential triggers
   */
  private detectTriggers(actions: WorkflowAction[]): WorkflowTrigger[] {
    const triggers: WorkflowTrigger[] = [];

    // Manual trigger always available
    triggers.push({ type: 'manual', condition: 'user_initiated' });

    // First action as trigger
    if (actions.length > 0) {
      const firstAction = actions[0];
      triggers.push({
        type: 'action',
        condition: `after:${firstAction.type}:${firstAction.command}`,
        parameters: { actionType: firstAction.type, command: firstAction.command },
      });
    }

    // Context-based trigger
    const contexts = actions.filter((a) => a.context).map((a) => a.context);
    if (contexts.length > 0) {
      const commonContext = this.findCommonContext(contexts as Record<string, unknown>[]);
      if (Object.keys(commonContext).length > 0) {
        triggers.push({
          type: 'context',
          condition: JSON.stringify(commonContext),
          parameters: commonContext,
        });
      }
    }

    return triggers;
  }

  /**
   * Find common context across actions
   */
  private findCommonContext(contexts: Record<string, unknown>[]): Record<string, unknown> {
    if (contexts.length === 0) return {};

    const common: Record<string, unknown> = {};
    const first = contexts[0];

    for (const [key, value] of Object.entries(first)) {
      const allMatch = contexts.every((c) => JSON.stringify(c[key]) === JSON.stringify(value));
      if (allMatch) {
        common[key] = value;
      }
    }

    return common;
  }

  /**
   * Generate workflow description
   */
  private generateDescription(actions: WorkflowAction[]): string {
    const actionTypes = [...new Set(actions.map((a) => a.type))];
    const commands = actions.map((a) => a.command).slice(0, 3);

    return `Workflow with ${actions.length} actions: ${commands.join(', ')}${actions.length > 3 ? '...' : ''}`;
  }

  // ============================================================================
  // Suggestions
  // ============================================================================

  /**
   * Check for workflow suggestions
   */
  private checkSuggestions(action: WorkflowAction): void {
    const suggestions: WorkflowSuggestion[] = [];

    for (const workflow of this.workflows.values()) {
      // Check action trigger
      for (const trigger of workflow.triggers) {
        if (trigger.type === 'action') {
          const triggerAction = trigger.parameters;
          if (
            triggerAction &&
            triggerAction.actionType === action.type &&
            triggerAction.command === action.command
          ) {
            const confidence = workflow.confidence * workflow.successRate;
            if (confidence >= this.config.suggestionThreshold) {
              suggestions.push({
                workflow,
                confidence,
                reason: `Triggered by action: ${action.type}:${action.command}`,
                matchedTrigger: trigger,
              });
            }
          }
        }

        // Check context trigger
        if (trigger.type === 'context' && action.context) {
          const contextMatch = this.matchContext(
            action.context,
            trigger.parameters || {}
          );
          if (contextMatch > 0.7) {
            suggestions.push({
              workflow,
              confidence: workflow.confidence * contextMatch,
              reason: 'Context matches workflow trigger',
              matchedTrigger: trigger,
            });
          }
        }
      }

      // Check sequence match
      const recentActions = this.actionHistory.slice(-workflow.actions.length);
      const similarity = this.calculateSequenceSimilarity(recentActions, workflow.actions);
      if (similarity >= this.config.patternSimilarityThreshold) {
        suggestions.push({
          workflow,
          confidence: similarity * workflow.confidence,
          reason: 'Recent actions match workflow pattern',
        });
      }
    }

    // Emit top suggestion
    if (suggestions.length > 0) {
      suggestions.sort((a, b) => b.confidence - a.confidence);
      const topSuggestion = suggestions[0];

      if (topSuggestion.confidence >= this.config.suggestionThreshold) {
        this.stats.suggestionsProvided++;
        this.emit('workflow-suggested', topSuggestion);
      }
    }
  }

  /**
   * Match context similarity
   */
  private matchContext(context: Record<string, unknown>, pattern: Record<string, unknown>): number {
    const patternKeys = Object.keys(pattern);
    if (patternKeys.length === 0) return 0;

    let matches = 0;
    for (const key of patternKeys) {
      if (JSON.stringify(context[key]) === JSON.stringify(pattern[key])) {
        matches++;
      }
    }

    return matches / patternKeys.length;
  }

  /**
   * Calculate sequence similarity
   */
  private calculateSequenceSimilarity(seq1: WorkflowAction[], seq2: WorkflowAction[]): number {
    if (seq1.length === 0 || seq2.length === 0) return 0;

    const minLen = Math.min(seq1.length, seq2.length);
    let matches = 0;

    for (let i = 0; i < minLen; i++) {
      if (seq1[i].type === seq2[i].type && seq1[i].command === seq2[i].command) {
        matches++;
      }
    }

    return matches / Math.max(seq1.length, seq2.length);
  }

  // ============================================================================
  // Workflow Execution
  // ============================================================================

  /**
   * Execute a workflow
   */
  async executeWorkflow(
    workflowId: string,
    variables: Record<string, unknown> = {},
    actionExecutor: (action: WorkflowAction, vars: Record<string, unknown>) => Promise<unknown>
  ): Promise<WorkflowExecution> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    const execution: WorkflowExecution = {
      id: this.generateId('execution'),
      workflowId,
      startTime: Date.now(),
      status: 'running',
      currentStep: 0,
      results: [],
      variables: { ...variables },
    };

    this.activeExecutions.set(execution.id, execution);
    this.emit('workflow-started', execution);

    try {
      for (let i = 0; i < workflow.actions.length; i++) {
        const action = workflow.actions[i];
        execution.currentStep = i;

        this.emit('workflow-step', execution, action);

        try {
          const output = await actionExecutor(action, execution.variables);
          execution.results.push({ actionId: action.id, success: true, output });

          // Store output as variable
          execution.variables[`step_${i}_result`] = output;
        } catch (error) {
          execution.results.push({ actionId: action.id, success: false });
          throw error;
        }
      }

      execution.status = 'completed';
      execution.endTime = Date.now();

      // Update workflow statistics
      workflow.frequency++;
      workflow.lastExecuted = Date.now();
      const duration = execution.endTime - execution.startTime;
      workflow.avgDuration = (workflow.avgDuration * (workflow.frequency - 1) + duration) / workflow.frequency;

      this.stats.workflowsExecuted++;
      this.saveData();
    } catch (error) {
      execution.status = 'failed';
      execution.endTime = Date.now();
      this.emit('error', error as Error);
    }

    this.emit('workflow-completed', execution);
    this.activeExecutions.delete(execution.id);

    return execution;
  }

  /**
   * Cancel workflow execution
   */
  cancelExecution(executionId: string): boolean {
    const execution = this.activeExecutions.get(executionId);
    if (!execution || execution.status !== 'running') {
      return false;
    }

    execution.status = 'cancelled';
    execution.endTime = Date.now();
    this.activeExecutions.delete(executionId);

    return true;
  }

  // ============================================================================
  // Utilities
  // ============================================================================

  private generateId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get workflow by ID
   */
  getWorkflow(workflowId: string): LearnedWorkflow | undefined {
    return this.workflows.get(workflowId);
  }

  /**
   * Get all workflows
   */
  getAllWorkflows(): LearnedWorkflow[] {
    return Array.from(this.workflows.values());
  }

  /**
   * Delete workflow
   */
  deleteWorkflow(workflowId: string): boolean {
    const deleted = this.workflows.delete(workflowId);
    if (deleted) {
      this.saveData();
    }
    return deleted;
  }

  /**
   * Update workflow name/description
   */
  updateWorkflow(workflowId: string, updates: Partial<Pick<LearnedWorkflow, 'name' | 'description'>>): void {
    const workflow = this.workflows.get(workflowId);
    if (workflow) {
      if (updates.name) workflow.name = updates.name;
      if (updates.description) workflow.description = updates.description;
      this.saveData();
    }
  }

  /**
   * Get statistics
   */
  getStats(): {
    actionsRecorded: number;
    workflowsLearned: number;
    workflowsExecuted: number;
    suggestionsProvided: number;
    totalWorkflows: number;
    activeExecutions: number;
  } {
    return {
      ...this.stats,
      totalWorkflows: this.workflows.size,
      activeExecutions: this.activeExecutions.size,
    };
  }

  /**
   * Is currently recording
   */
  isCurrentlyRecording(): boolean {
    return this.isRecording;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let workflowLearner: WorkflowLearner | null = null;

export function getWorkflowLearner(): WorkflowLearner {
  if (!workflowLearner) {
    workflowLearner = new WorkflowLearner();
  }
  return workflowLearner;
}
