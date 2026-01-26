/**
 * Workflow Automation Detector
 *
 * Detects repeated patterns in user interactions and suggests/creates automations.
 * Uses sequence mining to find common action patterns.
 *
 * Patterns Detected:
 * 1. Command sequences - Same commands in same order
 * 2. Time-based patterns - Actions at specific times/days
 * 3. Context patterns - Actions triggered by context changes
 * 4. Tool chains - Tools used together frequently
 *
 * Expected Impact:
 * - Auto-suggest workflows for repeated tasks
 * - Reduce manual repetition by 40%
 * - Learn user habits and preferences
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('WorkflowDetector');

// =============================================================================
// Types
// =============================================================================

export interface UserAction {
  type: 'voice_command' | 'tool_call' | 'navigation' | 'text_input';
  action: string;
  timestamp: number;
  context?: {
    activeApp?: string;
    workingDirectory?: string;
    timeOfDay?: 'morning' | 'afternoon' | 'evening' | 'night';
    dayOfWeek?: number;
  };
  metadata?: Record<string, unknown>;
}

export interface ActionSequence {
  id: string;
  actions: string[];
  count: number;
  firstSeen: number;
  lastSeen: number;
  avgTimeBetween: number;
  contexts: string[];
}

export interface DetectedWorkflow {
  id: string;
  name: string;
  description: string;
  trigger: WorkflowTrigger;
  actions: WorkflowAction[];
  confidence: number;
  occurrences: number;
  lastTriggered: number;
  suggested: boolean;
  automated: boolean;
}

export interface WorkflowTrigger {
  type: 'voice' | 'time' | 'context' | 'manual';
  pattern?: string;
  schedule?: { hour: number; minute: number; days: number[] };
  context?: {
    app?: string;
    directory?: string;
    timeOfDay?: string;
  };
}

export interface WorkflowAction {
  type: 'voice_command' | 'tool_call' | 'wait';
  action: string;
  parameters?: Record<string, unknown>;
  delay?: number;
}

export interface WorkflowSuggestion {
  workflow: DetectedWorkflow;
  reason: string;
  estimatedTimeSaved: string;
}

export interface DetectorConfig {
  /** Minimum occurrences to detect a pattern */
  minOccurrences: number;
  /** Minimum confidence to suggest workflow */
  minConfidence: number;
  /** Max time between actions to consider same sequence (ms) */
  maxSequenceGap: number;
  /** Minimum sequence length */
  minSequenceLength: number;
  /** Maximum sequence length to track */
  maxSequenceLength: number;
  /** Time window for pattern detection (ms) */
  patternWindow: number;
  /** Auto-suggest workflows */
  autoSuggest: boolean;
}

// =============================================================================
// Default Configuration
// =============================================================================

const DEFAULT_CONFIG: DetectorConfig = {
  minOccurrences: 3,
  minConfidence: 0.7,
  maxSequenceGap: 60000, // 1 minute
  minSequenceLength: 2,
  maxSequenceLength: 10,
  patternWindow: 7 * 24 * 60 * 60 * 1000, // 1 week
  autoSuggest: true,
};

// =============================================================================
// Workflow Detector Class
// =============================================================================

export class WorkflowDetector extends EventEmitter {
  private config: DetectorConfig;
  private actionHistory: UserAction[] = [];
  private sequences: Map<string, ActionSequence> = new Map();
  private detectedWorkflows: Map<string, DetectedWorkflow> = new Map();
  private persistPath: string;
  private saveTimeout: NodeJS.Timeout | null = null;
  private readonly MAX_HISTORY = 1000;

  constructor(config: Partial<DetectorConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.persistPath = path.join(app.getPath('userData'), 'ml', 'workflow-patterns.json');
    this.loadState();
    logger.info('WorkflowDetector initialized', {
      minOccurrences: this.config.minOccurrences,
      minConfidence: this.config.minConfidence,
    });
  }

  /**
   * Record a user action
   */
  recordAction(action: UserAction): void {
    // Add context if not provided
    if (!action.context) {
      action.context = this.getCurrentContext();
    }
    action.timestamp = action.timestamp || Date.now();

    this.actionHistory.push(action);

    // Trim history
    if (this.actionHistory.length > this.MAX_HISTORY) {
      this.actionHistory = this.actionHistory.slice(-this.MAX_HISTORY);
    }

    // Detect sequences
    this.detectSequences();

    // Schedule save
    this.scheduleSave();

    logger.debug('Action recorded', { type: action.type, action: action.action });
  }

  /**
   * Get current context
   */
  private getCurrentContext(): UserAction['context'] {
    const now = new Date();
    const hour = now.getHours();
    let timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night';

    if (hour >= 5 && hour < 12) timeOfDay = 'morning';
    else if (hour >= 12 && hour < 17) timeOfDay = 'afternoon';
    else if (hour >= 17 && hour < 21) timeOfDay = 'evening';
    else timeOfDay = 'night';

    return {
      timeOfDay,
      dayOfWeek: now.getDay(),
    };
  }

  /**
   * Detect sequences in action history
   */
  private detectSequences(): void {
    const now = Date.now();
    const windowStart = now - this.config.patternWindow;

    // Filter to recent actions
    const recentActions = this.actionHistory.filter(a => a.timestamp >= windowStart);
    if (recentActions.length < this.config.minSequenceLength) return;

    // Extract sequences of various lengths
    for (let len = this.config.minSequenceLength; len <= this.config.maxSequenceLength; len++) {
      this.extractSequencesOfLength(recentActions, len);
    }

    // Analyze sequences for patterns
    this.analyzePatterns();
  }

  /**
   * Extract sequences of specific length
   */
  private extractSequencesOfLength(actions: UserAction[], length: number): void {
    for (let i = 0; i <= actions.length - length; i++) {
      const slice = actions.slice(i, i + length);

      // Check if actions are within time gap
      let validSequence = true;
      let totalGap = 0;
      for (let j = 1; j < slice.length; j++) {
        const gap = slice[j].timestamp - slice[j - 1].timestamp;
        if (gap > this.config.maxSequenceGap) {
          validSequence = false;
          break;
        }
        totalGap += gap;
      }

      if (!validSequence) continue;

      // Create sequence key
      const actionNames = slice.map(a => a.action);
      const key = actionNames.join('→');

      // Update or create sequence
      const existing = this.sequences.get(key);
      if (existing) {
        existing.count++;
        existing.lastSeen = slice[slice.length - 1].timestamp;
        existing.avgTimeBetween = (existing.avgTimeBetween + totalGap / (length - 1)) / 2;

        // Track contexts
        const contextKey = this.getContextKey(slice[0].context);
        if (contextKey && !existing.contexts.includes(contextKey)) {
          existing.contexts.push(contextKey);
        }
      } else {
        this.sequences.set(key, {
          id: this.generateId(),
          actions: actionNames,
          count: 1,
          firstSeen: slice[0].timestamp,
          lastSeen: slice[slice.length - 1].timestamp,
          avgTimeBetween: totalGap / (length - 1),
          contexts: slice[0].context ? [this.getContextKey(slice[0].context)!] : [],
        });
      }
    }
  }

  /**
   * Analyze patterns and create workflow suggestions
   */
  private analyzePatterns(): void {
    for (const [key, sequence] of this.sequences) {
      if (sequence.count < this.config.minOccurrences) continue;

      // Calculate confidence based on frequency and recency
      const ageMs = Date.now() - sequence.lastSeen;
      const ageFactor = Math.exp(-ageMs / (7 * 24 * 60 * 60 * 1000)); // Week decay
      const frequencyFactor = Math.min(1, sequence.count / 10);
      const confidence = frequencyFactor * 0.7 + ageFactor * 0.3;

      if (confidence < this.config.minConfidence) continue;

      // Check if workflow already exists
      if (this.detectedWorkflows.has(key)) {
        const existing = this.detectedWorkflows.get(key)!;
        existing.occurrences = sequence.count;
        existing.confidence = confidence;
        existing.lastTriggered = sequence.lastSeen;
        continue;
      }

      // Create new workflow
      const workflow = this.createWorkflow(sequence, confidence);
      this.detectedWorkflows.set(key, workflow);

      // Emit suggestion if auto-suggest enabled
      if (this.config.autoSuggest && !workflow.automated) {
        const suggestion = this.createSuggestion(workflow);
        this.emit('workflow-suggestion', suggestion);
        logger.info('Workflow suggested', {
          name: workflow.name,
          confidence: confidence.toFixed(2),
          occurrences: sequence.count,
        });
      }
    }
  }

  /**
   * Create workflow from sequence
   */
  private createWorkflow(sequence: ActionSequence, confidence: number): DetectedWorkflow {
    // Generate human-readable name
    const name = this.generateWorkflowName(sequence.actions);

    // Determine trigger type
    const trigger = this.inferTrigger(sequence);

    // Create workflow actions
    const actions: WorkflowAction[] = sequence.actions.map((action, i) => ({
      type: this.inferActionType(action),
      action,
      delay: i > 0 ? Math.round(sequence.avgTimeBetween) : undefined,
    }));

    return {
      id: sequence.id,
      name,
      description: `Automatically detected workflow: ${sequence.actions.join(' → ')}`,
      trigger,
      actions,
      confidence,
      occurrences: sequence.count,
      lastTriggered: sequence.lastSeen,
      suggested: false,
      automated: false,
    };
  }

  /**
   * Generate human-readable workflow name
   */
  private generateWorkflowName(actions: string[]): string {
    // Extract key verbs and nouns
    const first = actions[0].split(' ')[0];
    const last = actions[actions.length - 1].split(' ').slice(0, 2).join(' ');

    if (actions.length === 2) {
      return `${first} then ${last}`;
    }

    return `${first} → ${actions.length} steps → ${last}`;
  }

  /**
   * Infer trigger type from sequence context
   */
  private inferTrigger(sequence: ActionSequence): WorkflowTrigger {
    // Check for time pattern
    const timestamps = this.getSequenceTimestamps(sequence);
    const timePattern = this.detectTimePattern(timestamps);
    if (timePattern) {
      return {
        type: 'time',
        schedule: timePattern,
      };
    }

    // Check for context pattern
    if (sequence.contexts.length > 0) {
      const mostCommonContext = this.getMostCommon(sequence.contexts);
      if (mostCommonContext) {
        return {
          type: 'context',
          context: this.parseContextKey(mostCommonContext),
        };
      }
    }

    // Default to voice trigger
    return {
      type: 'voice',
      pattern: sequence.actions[0],
    };
  }

  /**
   * Detect time-based patterns
   */
  private detectTimePattern(
    timestamps: number[]
  ): { hour: number; minute: number; days: number[] } | null {
    if (timestamps.length < this.config.minOccurrences) return null;

    const times = timestamps.map(t => {
      const d = new Date(t);
      return { hour: d.getHours(), minute: d.getMinutes(), day: d.getDay() };
    });

    // Check if times cluster within 30-minute window
    const hours = times.map(t => t.hour);
    const avgHour = hours.reduce((s, h) => s + h, 0) / hours.length;
    const hourStdDev = Math.sqrt(
      hours.reduce((s, h) => s + Math.pow(h - avgHour, 2), 0) / hours.length
    );

    if (hourStdDev > 2) return null; // Too much variation

    const minutes = times.map(t => t.minute);
    const avgMinute = minutes.reduce((s, m) => s + m, 0) / minutes.length;

    // Get days this happens
    const days = [...new Set(times.map(t => t.day))];

    return {
      hour: Math.round(avgHour),
      minute: Math.round(avgMinute / 15) * 15, // Round to 15-minute intervals
      days,
    };
  }

  /**
   * Get timestamps for a sequence
   */
  private getSequenceTimestamps(sequence: ActionSequence): number[] {
    const first = sequence.actions[0];
    return this.actionHistory
      .filter(a => a.action === first)
      .map(a => a.timestamp);
  }

  /**
   * Infer action type from action string
   */
  private inferActionType(action: string): 'voice_command' | 'tool_call' | 'wait' {
    const toolPatterns = ['read_file', 'write_file', 'execute', 'git_', 'browser_'];
    if (toolPatterns.some(p => action.includes(p))) {
      return 'tool_call';
    }
    return 'voice_command';
  }

  /**
   * Create suggestion from workflow
   */
  private createSuggestion(workflow: DetectedWorkflow): WorkflowSuggestion {
    const avgTime = workflow.actions.reduce((s, a) => s + (a.delay || 5000), 0) / 1000;
    const totalTime = Math.round(avgTime * workflow.occurrences / 60);

    return {
      workflow,
      reason: `You've done this ${workflow.occurrences} times. Want me to automate it?`,
      estimatedTimeSaved: `~${totalTime} minutes saved over past occurrences`,
    };
  }

  /**
   * Get context key string
   */
  private getContextKey(context?: UserAction['context']): string | null {
    if (!context) return null;
    const parts: string[] = [];
    if (context.activeApp) parts.push(`app:${context.activeApp}`);
    if (context.timeOfDay) parts.push(`time:${context.timeOfDay}`);
    if (context.dayOfWeek !== undefined) parts.push(`day:${context.dayOfWeek}`);
    return parts.length > 0 ? parts.join('|') : null;
  }

  /**
   * Parse context key back to object
   */
  private parseContextKey(key: string): WorkflowTrigger['context'] {
    const context: WorkflowTrigger['context'] = {};
    const parts = key.split('|');
    for (const part of parts) {
      const [type, value] = part.split(':');
      if (type === 'app') context.app = value;
      if (type === 'time') context.timeOfDay = value;
    }
    return context;
  }

  /**
   * Get most common element in array
   */
  private getMostCommon<T>(arr: T[]): T | null {
    if (arr.length === 0) return null;
    const counts = new Map<T, number>();
    for (const item of arr) {
      counts.set(item, (counts.get(item) || 0) + 1);
    }
    let maxCount = 0;
    let maxItem: T | null = null;
    for (const [item, count] of counts) {
      if (count > maxCount) {
        maxCount = count;
        maxItem = item;
      }
    }
    return maxItem;
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `wf_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get all detected workflows
   */
  getWorkflows(): DetectedWorkflow[] {
    return [...this.detectedWorkflows.values()];
  }

  /**
   * Get workflow by ID
   */
  getWorkflow(id: string): DetectedWorkflow | undefined {
    return this.detectedWorkflows.get(id);
  }

  /**
   * Enable automation for a workflow
   */
  enableWorkflow(id: string): boolean {
    const workflow = this.detectedWorkflows.get(id);
    if (!workflow) return false;

    workflow.automated = true;
    workflow.suggested = true;
    this.scheduleSave();

    this.emit('workflow-enabled', workflow);
    logger.info('Workflow enabled', { id, name: workflow.name });

    return true;
  }

  /**
   * Disable automation for a workflow
   */
  disableWorkflow(id: string): boolean {
    const workflow = this.detectedWorkflows.get(id);
    if (!workflow) return false;

    workflow.automated = false;
    this.scheduleSave();

    this.emit('workflow-disabled', workflow);
    logger.info('Workflow disabled', { id, name: workflow.name });

    return true;
  }

  /**
   * Delete a workflow
   */
  deleteWorkflow(id: string): boolean {
    const deleted = this.detectedWorkflows.delete(id);
    if (deleted) {
      this.scheduleSave();
      logger.info('Workflow deleted', { id });
    }
    return deleted;
  }

  /**
   * Check if current action matches a workflow trigger
   */
  checkTriggers(action: UserAction): DetectedWorkflow | null {
    for (const workflow of this.detectedWorkflows.values()) {
      if (!workflow.automated) continue;

      // Check voice trigger
      if (workflow.trigger.type === 'voice' && workflow.trigger.pattern) {
        if (action.action.includes(workflow.trigger.pattern)) {
          return workflow;
        }
      }

      // Check context trigger
      if (workflow.trigger.type === 'context' && workflow.trigger.context) {
        const ctx = workflow.trigger.context;
        if (
          (!ctx.app || ctx.app === action.context?.activeApp) &&
          (!ctx.timeOfDay || ctx.timeOfDay === action.context?.timeOfDay)
        ) {
          // Context match - check if first action matches
          if (workflow.actions[0]?.action === action.action) {
            return workflow;
          }
        }
      }
    }

    return null;
  }

  /**
   * Get statistics
   */
  getStatistics(): {
    totalActions: number;
    totalSequences: number;
    totalWorkflows: number;
    automatedWorkflows: number;
    topSequences: Array<{ sequence: string; count: number }>;
  } {
    const sequences = [...this.sequences.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
      .map(s => ({ sequence: s.actions.join(' → '), count: s.count }));

    return {
      totalActions: this.actionHistory.length,
      totalSequences: this.sequences.size,
      totalWorkflows: this.detectedWorkflows.size,
      automatedWorkflows: [...this.detectedWorkflows.values()].filter(w => w.automated).length,
      topSequences: sequences,
    };
  }

  /**
   * Schedule save with debounce
   */
  private scheduleSave(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    this.saveTimeout = setTimeout(() => this.saveState(), 5000);
  }

  /**
   * Save state to disk
   */
  private saveState(): void {
    try {
      const dir = path.dirname(this.persistPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const state = {
        actionHistory: this.actionHistory.slice(-500), // Keep last 500 actions
        sequences: Object.fromEntries(this.sequences),
        workflows: Object.fromEntries(this.detectedWorkflows),
      };

      fs.writeFileSync(this.persistPath, JSON.stringify(state, null, 2));
      logger.debug('State saved');
    } catch (error) {
      logger.error('Failed to save state', error);
    }
  }

  /**
   * Load state from disk
   */
  private loadState(): void {
    try {
      if (fs.existsSync(this.persistPath)) {
        const data = fs.readFileSync(this.persistPath, 'utf-8');
        const state = JSON.parse(data);

        if (state.actionHistory) {
          this.actionHistory = state.actionHistory;
        }
        if (state.sequences) {
          this.sequences = new Map(Object.entries(state.sequences));
        }
        if (state.workflows) {
          this.detectedWorkflows = new Map(Object.entries(state.workflows));
        }

        logger.info('State loaded', {
          actions: this.actionHistory.length,
          sequences: this.sequences.size,
          workflows: this.detectedWorkflows.size,
        });
      }
    } catch (error) {
      logger.error('Failed to load state', error);
    }
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<DetectorConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('WorkflowDetector config updated', this.config);
  }

  /**
   * Get current configuration
   */
  getConfig(): DetectorConfig {
    return { ...this.config };
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let workflowDetectorInstance: WorkflowDetector | null = null;

export function getWorkflowDetector(): WorkflowDetector {
  if (!workflowDetectorInstance) {
    workflowDetectorInstance = new WorkflowDetector();
  }
  return workflowDetectorInstance;
}

export function createWorkflowDetector(config?: Partial<DetectorConfig>): WorkflowDetector {
  workflowDetectorInstance = new WorkflowDetector(config);
  return workflowDetectorInstance;
}
