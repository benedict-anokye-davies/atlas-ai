/**
 * Atlas Desktop - Pattern Detector
 * Detects repetitive patterns in Ben's workflow and suggests automations
 */

import { EventEmitter } from 'events';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createModuleLogger } from '../utils/logger';
import { getErrorMessage } from '../../shared/utils';

const logger = createModuleLogger('PatternDetector');

// ============================================================================
// Types
// ============================================================================

/**
 * User action types
 */
export type ActionType = 'command' | 'file-edit' | 'search' | 'navigation' | 'voice';

/**
 * Pattern types
 */
export type PatternType = 'repetitive-command' | 'workflow' | 'time-based' | 'context-triggered';

/**
 * User action tracked by the system
 */
export interface UserAction {
  type: ActionType;
  action: string;
  details?: Record<string, unknown>;
  timestamp: Date;
  context?: string;
}

/**
 * Internal stored action (serializable)
 */
interface StoredAction {
  type: ActionType;
  action: string;
  details?: Record<string, unknown>;
  timestamp: string;
  context?: string;
}

/**
 * Detected pattern
 */
export interface DetectedPattern {
  id: string;
  type: PatternType;
  description: string;
  occurrences: number;
  lastOccurrence: Date;
  actions: UserAction[];
  confidence: number;
  suggestedAutomation?: string;
  acknowledged: boolean;
}

/**
 * Internal stored pattern (serializable)
 */
interface StoredPattern {
  id: string;
  type: PatternType;
  description: string;
  occurrences: number;
  lastOccurrence: string;
  actions: StoredAction[];
  confidence: number;
  suggestedAutomation?: string;
  acknowledged: boolean;
}

/**
 * Automation trigger
 */
export interface AutomationTrigger {
  type: 'voice' | 'time' | 'context' | 'file-change';
  condition: string;
}

/**
 * Automation action
 */
export interface AutomationAction {
  type: 'command' | 'file-edit' | 'notification';
  action: string;
}

/**
 * Automation created from pattern
 */
export interface Automation {
  id: string;
  name: string;
  trigger: AutomationTrigger;
  actions: AutomationAction[];
  enabled: boolean;
  createdAt: Date;
  patternId: string;
}

/**
 * Internal stored automation (serializable)
 */
interface StoredAutomation {
  id: string;
  name: string;
  trigger: AutomationTrigger;
  actions: AutomationAction[];
  enabled: boolean;
  createdAt: string;
  patternId: string;
}

/**
 * Pattern detector configuration
 */
export interface PatternDetectorConfig {
  enabled: boolean;
  detectionIntervalMs: number;
  minOccurrencesForPattern: number;
  minConfidenceThreshold: number;
  actionHistoryDays: number;
  maxStoredActions: number;
}

/**
 * Pattern detector interface
 */
export interface IPatternDetector {
  trackAction(action: UserAction): void;
  detectPatterns(): DetectedPattern[];
  generateSuggestion(pattern: DetectedPattern): string;
  getPatterns(): DetectedPattern[];
  acknowledgePattern(patternId: string): void;
  createAutomation(pattern: DetectedPattern): Automation | null;
}

// ============================================================================
// Constants
// ============================================================================

const ATLAS_DIR = join(homedir(), '.atlas');
const BRAIN_DIR = join(ATLAS_DIR, 'brain', 'self');
const ACTION_HISTORY_FILE = join(BRAIN_DIR, 'action-history.json');
const PATTERNS_FILE = join(BRAIN_DIR, 'patterns.json');
const AUTOMATIONS_FILE = join(BRAIN_DIR, 'automations.json');

const DEFAULT_CONFIG: PatternDetectorConfig = {
  enabled: true,
  detectionIntervalMs: 30 * 60 * 1000, // 30 minutes
  minOccurrencesForPattern: 3,
  minConfidenceThreshold: 0.6,
  actionHistoryDays: 7,
  maxStoredActions: 10000,
};

// Sensitive keywords to filter from tracking
const SENSITIVE_KEYWORDS = [
  'password',
  'secret',
  'token',
  'api_key',
  'apikey',
  'credential',
  'private',
  'auth',
  '.env',
  'ssh',
  'pgp',
  'gpg',
];

// ============================================================================
// Pattern Detector Implementation
// ============================================================================

/**
 * PatternDetector - Detects repetitive patterns and suggests automations
 */
export class PatternDetector extends EventEmitter implements IPatternDetector {
  private config: PatternDetectorConfig;
  private actions: UserAction[] = [];
  private patterns: Map<string, DetectedPattern> = new Map();
  private automations: Map<string, Automation> = new Map();
  private detectionInterval: NodeJS.Timeout | null = null;

  constructor(config?: Partial<PatternDetectorConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.ensureDirectoryExists();
    this.loadFromDisk();
    logger.info('PatternDetector initialized');
  }

  /**
   * Start periodic pattern detection
   */
  start(): void {
    if (!this.config.enabled) {
      logger.info('Pattern detector is disabled');
      return;
    }

    if (this.detectionInterval) {
      return; // Already running
    }

    this.detectionInterval = setInterval(() => {
      this.detectPatterns();
    }, this.config.detectionIntervalMs);

    logger.info('Pattern detector started', {
      intervalMs: this.config.detectionIntervalMs,
    });
  }

  /**
   * Stop periodic pattern detection
   */
  stop(): void {
    if (this.detectionInterval) {
      clearInterval(this.detectionInterval);
      this.detectionInterval = null;
    }
    this.saveToDisk();
    logger.info('Pattern detector stopped');
  }

  /**
   * Update configuration
   */
  setConfig(config: Partial<PatternDetectorConfig>): void {
    this.config = { ...this.config, ...config };

    if (!this.config.enabled) {
      this.stop();
    } else if (!this.detectionInterval) {
      this.start();
    }

    logger.info('Configuration updated', { enabled: this.config.enabled });
  }

  /**
   * Track a user action
   */
  trackAction(action: UserAction): void {
    if (!this.config.enabled) return;

    // Filter sensitive content
    if (this.containsSensitiveContent(action)) {
      logger.debug('Action contains sensitive content, skipping tracking');
      return;
    }

    // Ensure timestamp is a Date object
    const trackedAction: UserAction = {
      ...action,
      timestamp: action.timestamp instanceof Date ? action.timestamp : new Date(action.timestamp),
    };

    this.actions.push(trackedAction);

    // Trim old actions
    this.pruneOldActions();

    // Save to disk periodically (every 10 actions)
    if (this.actions.length % 10 === 0) {
      this.saveToDisk();
    }

    logger.debug('Action tracked', {
      type: action.type,
      action: action.action,
      context: action.context,
    });

    this.emit('action-tracked', trackedAction);
  }

  /**
   * Detect patterns in tracked actions
   */
  detectPatterns(): DetectedPattern[] {
    const detectedPatterns: DetectedPattern[] = [];

    // Detect repetitive commands
    const repetitivePatterns = this.detectRepetitiveCommands();
    detectedPatterns.push(...repetitivePatterns);

    // Detect workflow patterns
    const workflowPatterns = this.detectWorkflowPatterns();
    detectedPatterns.push(...workflowPatterns);

    // Detect time-based patterns
    const timePatterns = this.detectTimeBasedPatterns();
    detectedPatterns.push(...timePatterns);

    // Detect context-triggered patterns
    const contextPatterns = this.detectContextTriggeredPatterns();
    detectedPatterns.push(...contextPatterns);

    // Update stored patterns
    for (const pattern of detectedPatterns) {
      const existing = this.patterns.get(pattern.id);
      if (existing) {
        // Update existing pattern
        pattern.acknowledged = existing.acknowledged;
        if (!existing.acknowledged) {
          this.patterns.set(pattern.id, pattern);
        }
      } else {
        // New pattern detected
        this.patterns.set(pattern.id, pattern);
        this.emit('pattern-detected', pattern);
        logger.info('New pattern detected', {
          id: pattern.id,
          type: pattern.type,
          description: pattern.description,
          confidence: pattern.confidence,
        });
      }
    }

    this.saveToDisk();

    return detectedPatterns.filter(
      (p) => !p.acknowledged && p.confidence >= this.config.minConfidenceThreshold
    );
  }

  /**
   * Generate a natural language suggestion for a pattern
   */
  generateSuggestion(pattern: DetectedPattern): string {
    switch (pattern.type) {
      case 'repetitive-command':
        return this.generateRepetitiveSuggestion(pattern);
      case 'workflow':
        return this.generateWorkflowSuggestion(pattern);
      case 'time-based':
        return this.generateTimeSuggestion(pattern);
      case 'context-triggered':
        return this.generateContextSuggestion(pattern);
      default:
        return `I noticed a pattern: ${pattern.description}. Want me to automate this?`;
    }
  }

  /**
   * Get all detected patterns
   */
  getPatterns(): DetectedPattern[] {
    return Array.from(this.patterns.values());
  }

  /**
   * Get unacknowledged patterns above confidence threshold
   */
  getActiveSuggestions(): DetectedPattern[] {
    return this.getPatterns().filter(
      (p) => !p.acknowledged && p.confidence >= this.config.minConfidenceThreshold
    );
  }

  /**
   * Mark a pattern as acknowledged
   */
  acknowledgePattern(patternId: string): void {
    const pattern = this.patterns.get(patternId);
    if (pattern) {
      pattern.acknowledged = true;
      this.patterns.set(patternId, pattern);
      this.saveToDisk();
      logger.info('Pattern acknowledged', { patternId });
      this.emit('pattern-acknowledged', pattern);
    }
  }

  /**
   * Create an automation from a detected pattern
   */
  createAutomation(pattern: DetectedPattern): Automation | null {
    if (!pattern.suggestedAutomation) {
      logger.warn('Pattern has no suggested automation', { patternId: pattern.id });
      return null;
    }

    const trigger = this.inferTrigger(pattern);
    const actions = this.inferActions(pattern);

    if (!trigger || actions.length === 0) {
      logger.warn('Could not infer trigger or actions from pattern', { patternId: pattern.id });
      return null;
    }

    const automation: Automation = {
      id: this.generateId('auto'),
      name: this.generateAutomationName(pattern),
      trigger,
      actions,
      enabled: true,
      createdAt: new Date(),
      patternId: pattern.id,
    };

    this.automations.set(automation.id, automation);
    this.acknowledgePattern(pattern.id);
    this.saveToDisk();

    logger.info('Automation created', {
      automationId: automation.id,
      patternId: pattern.id,
      name: automation.name,
    });

    this.emit('automation-created', automation);
    return automation;
  }

  /**
   * Get all automations
   */
  getAutomations(): Automation[] {
    return Array.from(this.automations.values());
  }

  /**
   * Enable or disable an automation
   */
  setAutomationEnabled(automationId: string, enabled: boolean): void {
    const automation = this.automations.get(automationId);
    if (automation) {
      automation.enabled = enabled;
      this.automations.set(automationId, automation);
      this.saveToDisk();
      logger.info('Automation toggled', { automationId, enabled });
    }
  }

  /**
   * Delete an automation
   */
  deleteAutomation(automationId: string): boolean {
    const deleted = this.automations.delete(automationId);
    if (deleted) {
      this.saveToDisk();
      logger.info('Automation deleted', { automationId });
    }
    return deleted;
  }

  /**
   * Clear action history
   */
  clearHistory(): void {
    this.actions = [];
    this.saveToDisk();
    logger.info('Action history cleared');
  }

  /**
   * Clear all patterns
   */
  clearPatterns(): void {
    this.patterns.clear();
    this.saveToDisk();
    logger.info('Patterns cleared');
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalActions: number;
    totalPatterns: number;
    activePatterns: number;
    acknowledgedPatterns: number;
    totalAutomations: number;
    enabledAutomations: number;
  } {
    const patterns = this.getPatterns();
    const automations = this.getAutomations();

    return {
      totalActions: this.actions.length,
      totalPatterns: patterns.length,
      activePatterns: patterns.filter((p) => !p.acknowledged).length,
      acknowledgedPatterns: patterns.filter((p) => p.acknowledged).length,
      totalAutomations: automations.length,
      enabledAutomations: automations.filter((a) => a.enabled).length,
    };
  }

  // ============================================================================
  // Pattern Detection Algorithms
  // ============================================================================

  /**
   * Detect repetitive commands (same command run multiple times)
   */
  private detectRepetitiveCommands(): DetectedPattern[] {
    const patterns: DetectedPattern[] = [];
    const commandCounts = new Map<string, UserAction[]>();

    // Group actions by type and action
    for (const action of this.actions) {
      if (action.type === 'command' || action.type === 'voice') {
        const key = `${action.type}:${action.action}`;
        const existing = commandCounts.get(key) || [];
        existing.push(action);
        commandCounts.set(key, existing);
      }
    }

    // Find repetitive patterns
    for (const [key, actions] of commandCounts) {
      if (actions.length >= this.config.minOccurrencesForPattern) {
        const [type, command] = key.split(':');
        const recentActions = this.getRecentActions(actions, 24 * 60 * 60 * 1000); // Last 24 hours

        if (recentActions.length >= 3) {
          const pattern: DetectedPattern = {
            id: this.generatePatternId('repetitive', command),
            type: 'repetitive-command',
            description: `Running "${command}" repeatedly`,
            occurrences: actions.length,
            lastOccurrence: new Date(
              Math.max(...actions.map((a) => new Date(a.timestamp).getTime()))
            ),
            actions: recentActions.slice(-5),
            confidence: this.calculateRepetitiveConfidence(actions),
            suggestedAutomation: this.suggestRepetitiveAutomation(command, type as ActionType),
            acknowledged: false,
          };
          patterns.push(pattern);
        }
      }
    }

    return patterns;
  }

  /**
   * Detect workflow patterns (sequences of actions that repeat)
   */
  private detectWorkflowPatterns(): DetectedPattern[] {
    const patterns: DetectedPattern[] = [];
    const sequences = this.findRepeatingSequences(this.actions, 2, 5);

    for (const sequence of sequences) {
      if (sequence.occurrences >= this.config.minOccurrencesForPattern) {
        const description = sequence.actions.map((a) => a.action).join(' -> ');
        const pattern: DetectedPattern = {
          id: this.generatePatternId('workflow', description),
          type: 'workflow',
          description: `Workflow: ${description}`,
          occurrences: sequence.occurrences,
          lastOccurrence: sequence.lastOccurrence,
          actions: sequence.actions,
          confidence: this.calculateWorkflowConfidence(
            sequence.occurrences,
            sequence.actions.length
          ),
          suggestedAutomation: this.suggestWorkflowAutomation(sequence.actions),
          acknowledged: false,
        };
        patterns.push(pattern);
      }
    }

    return patterns;
  }

  /**
   * Detect time-based patterns (actions at similar times)
   */
  private detectTimeBasedPatterns(): DetectedPattern[] {
    const patterns: DetectedPattern[] = [];
    const timeGroups = new Map<string, UserAction[]>();

    // Group actions by hour of day and action
    for (const action of this.actions) {
      const date = new Date(action.timestamp);
      const hour = date.getHours();
      const key = `${hour}:${action.action}`;
      const existing = timeGroups.get(key) || [];
      existing.push(action);
      timeGroups.set(key, existing);
    }

    // Find patterns with consistent timing
    for (const [key, actions] of timeGroups) {
      if (actions.length >= this.config.minOccurrencesForPattern) {
        const [hourStr, ...actionParts] = key.split(':');
        const hour = parseInt(hourStr, 10);
        const actionName = actionParts.join(':');

        // Check if actions occur on different days (true time pattern)
        const uniqueDays = new Set(actions.map((a) => new Date(a.timestamp).toDateString()));

        if (uniqueDays.size >= this.config.minOccurrencesForPattern) {
          const pattern: DetectedPattern = {
            id: this.generatePatternId('time', `${hour}-${actionName}`),
            type: 'time-based',
            description: `"${actionName}" around ${this.formatHour(hour)}`,
            occurrences: actions.length,
            lastOccurrence: new Date(
              Math.max(...actions.map((a) => new Date(a.timestamp).getTime()))
            ),
            actions: actions.slice(-5),
            confidence: this.calculateTimeConfidence(actions, hour),
            suggestedAutomation: this.suggestTimeAutomation(actionName, hour),
            acknowledged: false,
          };
          patterns.push(pattern);
        }
      }
    }

    return patterns;
  }

  /**
   * Detect context-triggered patterns (action A always follows action B)
   */
  private detectContextTriggeredPatterns(): DetectedPattern[] {
    const patterns: DetectedPattern[] = [];
    const followPatterns = new Map<
      string,
      { trigger: UserAction; followUp: UserAction; count: number }[]
    >();

    // Look for pairs of actions within 5 minutes of each other
    const sortedActions = [...this.actions].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    for (let i = 0; i < sortedActions.length - 1; i++) {
      const current = sortedActions[i];
      const next = sortedActions[i + 1];

      const timeDiff = new Date(next.timestamp).getTime() - new Date(current.timestamp).getTime();

      // Within 5 minutes
      if (timeDiff <= 5 * 60 * 1000 && timeDiff > 0) {
        const key = `${current.action}->${next.action}`;
        const existing = followPatterns.get(key) || [];
        existing.push({ trigger: current, followUp: next, count: 1 });
        followPatterns.set(key, existing);
      }
    }

    // Find consistent follow patterns
    for (const [key, instances] of followPatterns) {
      if (instances.length >= this.config.minOccurrencesForPattern) {
        const [trigger, followUp] = key.split('->');
        const pattern: DetectedPattern = {
          id: this.generatePatternId('context', key),
          type: 'context-triggered',
          description: `"${followUp}" after "${trigger}"`,
          occurrences: instances.length,
          lastOccurrence: new Date(
            Math.max(...instances.map((i) => new Date(i.followUp.timestamp).getTime()))
          ),
          actions: instances.slice(-3).flatMap((i) => [i.trigger, i.followUp]),
          confidence: this.calculateContextConfidence(instances.length, trigger),
          suggestedAutomation: this.suggestContextAutomation(trigger, followUp),
          acknowledged: false,
        };
        patterns.push(pattern);
      }
    }

    return patterns;
  }

  // ============================================================================
  // Suggestion Generation
  // ============================================================================

  private generateRepetitiveSuggestion(pattern: DetectedPattern): string {
    const action = pattern.actions[0]?.action || 'that';
    const count = pattern.occurrences;
    const timeframe = this.getTimeframeDescription(pattern);

    const suggestions = [
      `Ben, I noticed you've run '${action}' ${count} times ${timeframe}. Want me to auto-run it when you save a file?`,
      `I see you're running '${action}' frequently. Should I set up a shortcut or trigger for this?`,
      `You've used '${action}' ${count} times ${timeframe}. Want me to handle that automatically?`,
    ];

    return suggestions[Math.floor(Math.random() * suggestions.length)];
  }

  private generateWorkflowSuggestion(pattern: DetectedPattern): string {
    const steps = pattern.actions.map((a) => a.action).join("' then '");

    const suggestions = [
      `I noticed you always run '${steps}' in sequence. Want me to do that automatically when you say good morning?`,
      `I've detected a workflow pattern: you usually '${steps}'. Should I handle that with a single command?`,
      `You seem to follow a pattern: '${steps}'. Want me to create an automation for this?`,
    ];

    return suggestions[Math.floor(Math.random() * suggestions.length)];
  }

  private generateTimeSuggestion(pattern: DetectedPattern): string {
    const action = pattern.actions[0]?.action || 'that';
    const timeMatch = pattern.description.match(/around (\d{1,2}(?::\d{2})?\s*(?:AM|PM)?)/i);
    const time = timeMatch ? timeMatch[1] : 'this time';

    const suggestions = [
      `You ${action} around ${time} each day. Want me to take care of it for you?`,
      `I noticed you typically ${action} at ${time}. Should I automate this?`,
      `Ben, you seem to ${action} daily around ${time}. Want me to handle that automatically?`,
    ];

    return suggestions[Math.floor(Math.random() * suggestions.length)];
  }

  private generateContextSuggestion(pattern: DetectedPattern): string {
    const parts = pattern.description.match(/"([^"]+)" after "([^"]+)"/);
    const followUp = parts?.[1] || pattern.actions[1]?.action || 'the follow-up';
    const trigger = parts?.[2] || pattern.actions[0]?.action || 'that';

    const suggestions = [
      `Every time you ${trigger}, you then ${followUp}. Should I auto-run '${followUp}' after '${trigger}'?`,
      `I noticed whenever you '${trigger}', you always '${followUp}' next. Want me to automate that?`,
      `Ben, you consistently run '${followUp}' after '${trigger}'. Should I handle that automatically?`,
    ];

    return suggestions[Math.floor(Math.random() * suggestions.length)];
  }

  // ============================================================================
  // Automation Helpers
  // ============================================================================

  private suggestRepetitiveAutomation(command: string, _type: ActionType): string {
    if (command.includes('test')) {
      return 'Run tests automatically when files change';
    }
    if (command.includes('build')) {
      return 'Auto-build on save';
    }
    if (command.includes('lint') || command.includes('format')) {
      return 'Auto-lint/format on save';
    }
    return `Auto-run '${command}' based on trigger`;
  }

  private suggestWorkflowAutomation(actions: UserAction[]): string {
    const steps = actions.map((a) => a.action).join(', ');
    return `Run workflow: ${steps}`;
  }

  private suggestTimeAutomation(action: string, hour: number): string {
    return `Automatically ${action} at ${this.formatHour(hour)}`;
  }

  private suggestContextAutomation(trigger: string, followUp: string): string {
    return `Auto-run '${followUp}' after '${trigger}'`;
  }

  private inferTrigger(pattern: DetectedPattern): AutomationTrigger | null {
    switch (pattern.type) {
      case 'repetitive-command':
        return {
          type: 'file-change',
          condition: '*',
        };
      case 'workflow':
        return {
          type: 'voice',
          condition: 'start my workflow',
        };
      case 'time-based': {
        const timeMatch = pattern.description.match(/around (\d{1,2})/);
        const hour = timeMatch ? parseInt(timeMatch[1], 10) : 9;
        return {
          type: 'time',
          condition: `${hour}:00`,
        };
      }
      case 'context-triggered': {
        const triggerMatch = pattern.description.match(/after "([^"]+)"/);
        return {
          type: 'context',
          condition: triggerMatch?.[1] || 'trigger',
        };
      }
      default:
        return null;
    }
  }

  private inferActions(pattern: DetectedPattern): AutomationAction[] {
    return pattern.actions.slice(-3).map((action) => ({
      type: action.type === 'command' ? 'command' : 'notification',
      action: action.action,
    }));
  }

  private generateAutomationName(pattern: DetectedPattern): string {
    switch (pattern.type) {
      case 'repetitive-command':
        return `Auto ${pattern.actions[0]?.action || 'command'}`;
      case 'workflow':
        return 'Workflow automation';
      case 'time-based':
        return `Daily ${pattern.actions[0]?.action || 'task'}`;
      case 'context-triggered':
        return `Auto follow-up`;
      default:
        return 'Automation';
    }
  }

  // ============================================================================
  // Confidence Calculations
  // ============================================================================

  private calculateRepetitiveConfidence(actions: UserAction[]): number {
    // Base confidence on frequency and recency
    const recentCount = this.getRecentActions(actions, 24 * 60 * 60 * 1000).length;
    const frequencyScore = Math.min(recentCount / 10, 1);

    // Check consistency of action
    const uniqueActions = new Set(actions.map((a) => a.action)).size;
    const consistencyScore = uniqueActions === 1 ? 1 : 0.5;

    return frequencyScore * 0.7 + consistencyScore * 0.3;
  }

  private calculateWorkflowConfidence(occurrences: number, sequenceLength: number): number {
    // Longer sequences with more occurrences = higher confidence
    const occurrenceScore = Math.min(occurrences / 5, 1);
    const lengthScore = Math.min(sequenceLength / 4, 1);

    return occurrenceScore * 0.6 + lengthScore * 0.4;
  }

  private calculateTimeConfidence(actions: UserAction[], targetHour: number): number {
    // Check how consistently actions occur near the target hour
    let totalDeviation = 0;

    for (const action of actions) {
      const hour = new Date(action.timestamp).getHours();
      const deviation = Math.abs(hour - targetHour);
      totalDeviation += Math.min(deviation, 12); // Max 12 hour deviation
    }

    const avgDeviation = totalDeviation / actions.length;
    const consistencyScore = Math.max(0, 1 - avgDeviation / 3);

    // More occurrences = higher confidence
    const occurrenceScore = Math.min(actions.length / 7, 1);

    return consistencyScore * 0.6 + occurrenceScore * 0.4;
  }

  private calculateContextConfidence(occurrences: number, trigger: string): number {
    // More consistent follow-ups = higher confidence
    const occurrenceScore = Math.min(occurrences / 5, 1);

    // Boost confidence for common development triggers
    const commonTriggers = ['git pull', 'npm install', 'cd ', 'open '];
    const triggerBoost = commonTriggers.some((t) => trigger.includes(t)) ? 0.1 : 0;

    return Math.min(occurrenceScore + triggerBoost, 1);
  }

  // ============================================================================
  // Utility Functions
  // ============================================================================

  private findRepeatingSequences(
    actions: UserAction[],
    minLength: number,
    maxLength: number
  ): { actions: UserAction[]; occurrences: number; lastOccurrence: Date }[] {
    const sequences: Map<
      string,
      { actions: UserAction[]; occurrences: number; lastOccurrence: Date }
    > = new Map();

    for (let length = minLength; length <= maxLength; length++) {
      for (let i = 0; i <= actions.length - length; i++) {
        const sequence = actions.slice(i, i + length);
        const key = sequence.map((a) => a.action).join('|');

        const existing = sequences.get(key);
        if (existing) {
          existing.occurrences++;
          const lastTime = new Date(sequence[sequence.length - 1].timestamp);
          if (lastTime > existing.lastOccurrence) {
            existing.lastOccurrence = lastTime;
            existing.actions = sequence;
          }
        } else {
          sequences.set(key, {
            actions: sequence,
            occurrences: 1,
            lastOccurrence: new Date(sequence[sequence.length - 1].timestamp),
          });
        }
      }
    }

    return Array.from(sequences.values());
  }

  private getRecentActions(actions: UserAction[], withinMs: number): UserAction[] {
    const cutoff = Date.now() - withinMs;
    return actions.filter((a) => new Date(a.timestamp).getTime() > cutoff);
  }

  private getTimeframeDescription(pattern: DetectedPattern): string {
    const oldestAction = pattern.actions[0];
    const newestAction = pattern.actions[pattern.actions.length - 1];

    if (!oldestAction || !newestAction) return 'recently';

    const oldestTime = new Date(oldestAction.timestamp).getTime();
    const newestTime = new Date(newestAction.timestamp).getTime();
    const spanMs = newestTime - oldestTime;

    if (spanMs < 60 * 60 * 1000) return 'in the last hour';
    if (spanMs < 24 * 60 * 60 * 1000) return 'today';
    if (spanMs < 7 * 24 * 60 * 60 * 1000) return 'this week';
    return 'recently';
  }

  private formatHour(hour: number): string {
    const suffix = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    return `${displayHour}${suffix}`;
  }

  private containsSensitiveContent(action: UserAction): boolean {
    const contentToCheck = [action.action, action.context, JSON.stringify(action.details || {})]
      .join(' ')
      .toLowerCase();

    return SENSITIVE_KEYWORDS.some((keyword) => contentToCheck.includes(keyword));
  }

  private pruneOldActions(): void {
    const cutoff = Date.now() - this.config.actionHistoryDays * 24 * 60 * 60 * 1000;
    this.actions = this.actions.filter((a) => new Date(a.timestamp).getTime() > cutoff);

    // Also limit total actions
    if (this.actions.length > this.config.maxStoredActions) {
      this.actions = this.actions.slice(-this.config.maxStoredActions);
    }
  }

  private generateId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  private generatePatternId(type: string, identifier: string): string {
    // Create a stable ID based on pattern type and identifier
    const hash = identifier
      .split('')
      .reduce((acc, char) => ((acc << 5) - acc + char.charCodeAt(0)) | 0, 0);
    return `pattern-${type}-${Math.abs(hash).toString(36)}`;
  }

  // ============================================================================
  // Persistence
  // ============================================================================

  private ensureDirectoryExists(): void {
    if (!existsSync(BRAIN_DIR)) {
      mkdirSync(BRAIN_DIR, { recursive: true });
    }
  }

  private loadFromDisk(): void {
    try {
      // Load actions
      if (existsSync(ACTION_HISTORY_FILE)) {
        const data = readFileSync(ACTION_HISTORY_FILE, 'utf-8');
        const storedActions: StoredAction[] = JSON.parse(data);
        this.actions = storedActions.map((a) => ({
          ...a,
          timestamp: new Date(a.timestamp),
        }));
        this.pruneOldActions();
        logger.debug('Loaded action history', { count: this.actions.length });
      }

      // Load patterns
      if (existsSync(PATTERNS_FILE)) {
        const data = readFileSync(PATTERNS_FILE, 'utf-8');
        const storedPatterns: StoredPattern[] = JSON.parse(data);
        for (const sp of storedPatterns) {
          const pattern: DetectedPattern = {
            ...sp,
            lastOccurrence: new Date(sp.lastOccurrence),
            actions: sp.actions.map((a) => ({
              ...a,
              timestamp: new Date(a.timestamp),
            })),
          };
          this.patterns.set(pattern.id, pattern);
        }
        logger.debug('Loaded patterns', { count: this.patterns.size });
      }

      // Load automations
      if (existsSync(AUTOMATIONS_FILE)) {
        const data = readFileSync(AUTOMATIONS_FILE, 'utf-8');
        const storedAutomations: StoredAutomation[] = JSON.parse(data);
        for (const sa of storedAutomations) {
          const automation: Automation = {
            ...sa,
            createdAt: new Date(sa.createdAt),
          };
          this.automations.set(automation.id, automation);
        }
        logger.debug('Loaded automations', { count: this.automations.size });
      }
    } catch (error) {
      logger.error('Failed to load from disk', {
        error: getErrorMessage(error),
      });
    }
  }

  private saveToDisk(): void {
    try {
      // Save actions
      const storedActions: StoredAction[] = this.actions.map((a) => ({
        ...a,
        timestamp: a.timestamp instanceof Date ? a.timestamp.toISOString() : a.timestamp,
      }));
      writeFileSync(ACTION_HISTORY_FILE, JSON.stringify(storedActions, null, 2));

      // Save patterns
      const storedPatterns: StoredPattern[] = Array.from(this.patterns.values()).map((p) => ({
        ...p,
        lastOccurrence:
          p.lastOccurrence instanceof Date ? p.lastOccurrence.toISOString() : p.lastOccurrence,
        actions: p.actions.map((a) => ({
          ...a,
          timestamp: a.timestamp instanceof Date ? a.timestamp.toISOString() : a.timestamp,
        })),
      }));
      writeFileSync(PATTERNS_FILE, JSON.stringify(storedPatterns, null, 2));

      // Save automations
      const storedAutomations: StoredAutomation[] = Array.from(this.automations.values()).map(
        (a) => ({
          ...a,
          createdAt: a.createdAt instanceof Date ? a.createdAt.toISOString() : a.createdAt,
        })
      );
      writeFileSync(AUTOMATIONS_FILE, JSON.stringify(storedAutomations, null, 2));

      logger.debug('Saved to disk', {
        actions: this.actions.length,
        patterns: this.patterns.size,
        automations: this.automations.size,
      });
    } catch (error) {
      logger.error('Failed to save to disk', {
        error: getErrorMessage(error),
      });
    }
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let patternDetector: PatternDetector | null = null;

/**
 * Get or create the pattern detector singleton
 */
export function getPatternDetector(): PatternDetector {
  if (!patternDetector) {
    patternDetector = new PatternDetector();
  }
  return patternDetector;
}

/**
 * Initialize the pattern detector with custom config
 */
export function initializePatternDetector(
  config?: Partial<PatternDetectorConfig>
): PatternDetector {
  if (patternDetector) {
    patternDetector.stop();
  }
  patternDetector = new PatternDetector(config);
  return patternDetector;
}

/**
 * Shutdown the pattern detector
 */
export function shutdownPatternDetector(): void {
  if (patternDetector) {
    patternDetector.stop();
    patternDetector = null;
  }
  logger.info('Pattern detector shutdown complete');
}

/**
 * Reset the pattern detector (for testing)
 */
export function resetPatternDetector(): void {
  if (patternDetector) {
    patternDetector.stop();
    patternDetector = null;
  }
}

export default PatternDetector;
