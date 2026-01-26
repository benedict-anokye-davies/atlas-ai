/**
 * Atlas Desktop - Command Macros System
 * Create multi-step command sequences and routines
 *
 * Features:
 * - Define macros like "Good morning" → calendar + weather + news
 * - Conditional execution based on time/context
 * - Variable substitution
 * - Scheduled macro execution
 *
 * @module agent/command-macros
 */

import { EventEmitter } from 'events';
import * as fs from 'fs-extra';
import * as path from 'path';
import { app } from 'electron';
import { createModuleLogger } from '../utils/logger';
import { getErrorMessage } from '../../shared/utils';
import { v4 as uuidv4 } from 'uuid';

const logger = createModuleLogger('CommandMacros');

// ============================================================================
// Types
// ============================================================================

export type MacroConditionType = 'time' | 'day' | 'date' | 'context' | 'always';

export interface MacroCondition {
  type: MacroConditionType;
  operator: 'equals' | 'between' | 'contains' | 'matches';
  value: string | number | [string | number, string | number];
}

export interface MacroStep {
  id: string;
  type: 'command' | 'tool' | 'speak' | 'wait' | 'conditional';
  action: string;
  parameters?: Record<string, unknown>;
  continueOnError?: boolean;
  timeout?: number; // ms
  condition?: MacroCondition;
}

export interface MacroDefinition {
  id: string;
  name: string;
  description?: string;
  triggers: string[]; // Phrases that trigger this macro
  steps: MacroStep[];
  conditions?: MacroCondition[];
  variables?: Record<string, string>;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  lastRun?: number;
  runCount: number;
  tags?: string[];
}

export interface MacroExecutionResult {
  macroId: string;
  success: boolean;
  startTime: number;
  endTime: number;
  stepsCompleted: number;
  totalSteps: number;
  errors: Array<{ stepId: string; error: string }>;
  outputs: Array<{ stepId: string; output: unknown }>;
}

export interface MacroManagerEvents {
  'macro-created': (macro: MacroDefinition) => void;
  'macro-updated': (macro: MacroDefinition) => void;
  'macro-deleted': (macroId: string) => void;
  'macro-started': (macroId: string) => void;
  'macro-step': (macroId: string, step: MacroStep, index: number) => void;
  'macro-completed': (result: MacroExecutionResult) => void;
  'macro-failed': (macroId: string, error: string) => void;
  error: (error: Error) => void;
}

// ============================================================================
// Built-in Macros
// ============================================================================

const BUILT_IN_MACROS: Omit<MacroDefinition, 'id' | 'createdAt' | 'updatedAt' | 'runCount'>[] = [
  {
    name: 'Good Morning',
    description: 'Morning briefing with calendar, weather, and news',
    triggers: ['good morning', 'morning briefing', 'start my day'],
    steps: [
      {
        id: 'greet',
        type: 'speak',
        action: 'Good morning! Let me get your day started.',
      },
      {
        id: 'weather',
        type: 'tool',
        action: 'get_weather',
        parameters: { location: 'current' },
      },
      {
        id: 'calendar',
        type: 'tool',
        action: 'get_calendar_events',
        parameters: { timeframe: 'today' },
      },
      {
        id: 'summary',
        type: 'speak',
        action: '{{weatherSummary}}. You have {{eventCount}} events today. {{firstEvent}}',
      },
    ],
    conditions: [
      {
        type: 'time',
        operator: 'between',
        value: ['05:00', '12:00'],
      },
    ],
    enabled: true,
  },
  {
    name: 'Focus Mode',
    description: 'Enable focus mode - silence notifications, start timer',
    triggers: ['focus mode', 'start focus', 'deep work', 'do not disturb'],
    steps: [
      {
        id: 'notify',
        type: 'speak',
        action: 'Enabling focus mode. Silencing notifications.',
      },
      {
        id: 'dnd',
        type: 'command',
        action: 'system:enable-dnd',
      },
      {
        id: 'timer',
        type: 'tool',
        action: 'start_timer',
        parameters: { duration: 25, label: 'Focus Session' },
      },
      {
        id: 'spotify',
        type: 'tool',
        action: 'spotify_play',
        parameters: { playlist: 'focus' },
        continueOnError: true,
      },
    ],
    enabled: true,
  },
  {
    name: 'End of Day',
    description: 'End of day summary and tomorrow preparation',
    triggers: ['end my day', 'good night', 'daily summary', 'wrap up'],
    steps: [
      {
        id: 'summary',
        type: 'speak',
        action: "Let's wrap up your day.",
      },
      {
        id: 'tasks',
        type: 'tool',
        action: 'get_tasks',
        parameters: { status: 'completed', timeframe: 'today' },
      },
      {
        id: 'tomorrow',
        type: 'tool',
        action: 'get_calendar_events',
        parameters: { timeframe: 'tomorrow' },
      },
      {
        id: 'report',
        type: 'speak',
        action: 'You completed {{completedTasks}} tasks today. Tomorrow you have {{tomorrowEvents}} scheduled.',
      },
    ],
    conditions: [
      {
        type: 'time',
        operator: 'between',
        value: ['17:00', '23:59'],
      },
    ],
    enabled: true,
  },
  {
    name: 'Quick Break',
    description: 'Take a short break with stretching reminder',
    triggers: ['take a break', 'break time', 'stretch break', 'rest eyes'],
    steps: [
      {
        id: 'pause',
        type: 'tool',
        action: 'spotify_pause',
        continueOnError: true,
      },
      {
        id: 'notify',
        type: 'speak',
        action: "Time for a quick break. Stand up, stretch, and look away from your screen for 20 seconds.",
      },
      {
        id: 'timer',
        type: 'tool',
        action: 'start_timer',
        parameters: { duration: 5, label: 'Break' },
      },
    ],
    enabled: true,
  },
];

// ============================================================================
// Command Macro Manager
// ============================================================================

export class CommandMacroManager extends EventEmitter {
  private macros: Map<string, MacroDefinition> = new Map();
  private storagePath: string;
  private isExecuting: boolean = false;
  private currentExecution: string | null = null;
  private executionHistory: MacroExecutionResult[] = [];
  private toolExecutor?: (toolName: string, params: Record<string, unknown>) => Promise<unknown>;
  private commandExecutor?: (command: string) => Promise<void>;
  private speakFunction?: (text: string) => Promise<void>;

  constructor() {
    super();
    this.storagePath = path.join(app.getPath('userData'), 'macros.json');
    this.initialize();
  }

  private async initialize(): Promise<void> {
    try {
      await this.loadMacros();
      await this.ensureBuiltInMacros();
      logger.info('CommandMacroManager initialized', { macroCount: this.macros.size });
    } catch (error) {
      logger.error('Failed to initialize macro manager', { error });
      this.emit('error', error as Error);
    }
  }

  private async loadMacros(): Promise<void> {
    try {
      if (await fs.pathExists(this.storagePath)) {
        const data = await fs.readJson(this.storagePath);
        for (const macro of data.macros || []) {
          this.macros.set(macro.id, macro);
        }
      }
    } catch (error) {
      logger.warn('Failed to load macros, starting fresh', { error });
    }
  }

  private async saveMacros(): Promise<void> {
    const data = {
      version: 1,
      macros: Array.from(this.macros.values()),
    };
    await fs.writeJson(this.storagePath, data, { spaces: 2 });
  }

  private async ensureBuiltInMacros(): Promise<void> {
    for (const builtIn of BUILT_IN_MACROS) {
      const existingByName = Array.from(this.macros.values()).find((m) => m.name === builtIn.name);
      if (!existingByName) {
        const macro: MacroDefinition = {
          ...builtIn,
          id: uuidv4(),
          createdAt: Date.now(),
          updatedAt: Date.now(),
          runCount: 0,
        };
        this.macros.set(macro.id, macro);
      }
    }
    await this.saveMacros();
  }

  // ============================================================================
  // Executor Registration
  // ============================================================================

  /**
   * Register tool executor function
   */
  setToolExecutor(executor: (toolName: string, params: Record<string, unknown>) => Promise<unknown>): void {
    this.toolExecutor = executor;
  }

  /**
   * Register command executor function
   */
  setCommandExecutor(executor: (command: string) => Promise<void>): void {
    this.commandExecutor = executor;
  }

  /**
   * Register speak function
   */
  setSpeakFunction(speak: (text: string) => Promise<void>): void {
    this.speakFunction = speak;
  }

  // ============================================================================
  // Macro CRUD
  // ============================================================================

  /**
   * Create a new macro
   */
  async createMacro(definition: Omit<MacroDefinition, 'id' | 'createdAt' | 'updatedAt' | 'runCount'>): Promise<MacroDefinition> {
    const macro: MacroDefinition = {
      ...definition,
      id: uuidv4(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      runCount: 0,
    };

    this.macros.set(macro.id, macro);
    await this.saveMacros();

    this.emit('macro-created', macro);
    logger.info('Macro created', { id: macro.id, name: macro.name });

    return macro;
  }

  /**
   * Update an existing macro
   */
  async updateMacro(id: string, updates: Partial<MacroDefinition>): Promise<MacroDefinition | null> {
    const macro = this.macros.get(id);
    if (!macro) return null;

    const updated: MacroDefinition = {
      ...macro,
      ...updates,
      id, // Preserve ID
      updatedAt: Date.now(),
    };

    this.macros.set(id, updated);
    await this.saveMacros();

    this.emit('macro-updated', updated);
    logger.info('Macro updated', { id, name: updated.name });

    return updated;
  }

  /**
   * Delete a macro
   */
  async deleteMacro(id: string): Promise<boolean> {
    if (!this.macros.has(id)) return false;

    this.macros.delete(id);
    await this.saveMacros();

    this.emit('macro-deleted', id);
    logger.info('Macro deleted', { id });

    return true;
  }

  /**
   * Get macro by ID
   */
  getMacro(id: string): MacroDefinition | undefined {
    return this.macros.get(id);
  }

  /**
   * List all macros
   */
  listMacros(): MacroDefinition[] {
    return Array.from(this.macros.values());
  }

  // ============================================================================
  // Trigger Matching
  // ============================================================================

  /**
   * Find macro matching a trigger phrase
   */
  findMatchingMacro(input: string): MacroDefinition | null {
    const inputLower = input.toLowerCase().trim();

    for (const macro of this.macros.values()) {
      if (!macro.enabled) continue;

      for (const trigger of macro.triggers) {
        if (inputLower.includes(trigger.toLowerCase())) {
          // Check conditions
          if (this.checkConditions(macro.conditions)) {
            return macro;
          }
        }
      }
    }

    return null;
  }

  /**
   * Check if conditions are met
   */
  private checkConditions(conditions?: MacroCondition[]): boolean {
    if (!conditions || conditions.length === 0) return true;

    for (const condition of conditions) {
      if (!this.evaluateCondition(condition)) {
        return false;
      }
    }

    return true;
  }

  private evaluateCondition(condition: MacroCondition): boolean {
    const now = new Date();

    switch (condition.type) {
      case 'always':
        return true;

      case 'time': {
        const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
        if (condition.operator === 'between' && Array.isArray(condition.value)) {
          return currentTime >= condition.value[0] && currentTime <= condition.value[1];
        }
        if (condition.operator === 'equals') {
          return currentTime === condition.value;
        }
        return true;
      }

      case 'day': {
        const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        const currentDay = days[now.getDay()];
        if (condition.operator === 'equals') {
          return currentDay === (condition.value as string).toLowerCase();
        }
        if (condition.operator === 'contains' && typeof condition.value === 'string') {
          return condition.value.toLowerCase().includes(currentDay);
        }
        return true;
      }

      default:
        return true;
    }
  }

  // ============================================================================
  // Macro Execution
  // ============================================================================

  /**
   * Execute a macro by ID
   */
  async executeMacro(macroId: string, variables?: Record<string, string>): Promise<MacroExecutionResult> {
    const macro = this.macros.get(macroId);
    if (!macro) {
      throw new Error(`Macro not found: ${macroId}`);
    }

    if (this.isExecuting) {
      throw new Error('Another macro is currently executing');
    }

    this.isExecuting = true;
    this.currentExecution = macroId;

    const result: MacroExecutionResult = {
      macroId,
      success: true,
      startTime: Date.now(),
      endTime: 0,
      stepsCompleted: 0,
      totalSteps: macro.steps.length,
      errors: [],
      outputs: [],
    };

    const context: Record<string, unknown> = {
      ...macro.variables,
      ...variables,
    };

    this.emit('macro-started', macroId);
    logger.info('Macro execution started', { macroId, name: macro.name });

    try {
      for (let i = 0; i < macro.steps.length; i++) {
        const step = macro.steps[i];

        // Check step condition
        if (step.condition && !this.evaluateCondition(step.condition)) {
          logger.debug('Skipping step due to condition', { stepId: step.id });
          continue;
        }

        this.emit('macro-step', macroId, step, i);

        try {
          const output = await this.executeStep(step, context);
          result.outputs.push({ stepId: step.id, output });
          result.stepsCompleted++;

          // Store output in context for variable substitution
          if (output && typeof output === 'object') {
            Object.assign(context, output);
          }
        } catch (error) {
          const errorMsg = getErrorMessage(error);
          result.errors.push({ stepId: step.id, error: errorMsg });

          if (!step.continueOnError) {
            result.success = false;
            break;
          }
        }
      }
    } finally {
      result.endTime = Date.now();
      this.isExecuting = false;
      this.currentExecution = null;

      // Update macro stats
      macro.lastRun = result.startTime;
      macro.runCount++;
      await this.saveMacros();

      // Store in history
      this.executionHistory.push(result);
      if (this.executionHistory.length > 100) {
        this.executionHistory.shift();
      }

      this.emit('macro-completed', result);
      logger.info('Macro execution completed', {
        macroId,
        success: result.success,
        duration: result.endTime - result.startTime,
        stepsCompleted: result.stepsCompleted,
      });
    }

    return result;
  }

  /**
   * Execute a single step
   */
  private async executeStep(step: MacroStep, context: Record<string, unknown>): Promise<unknown> {
    const timeout = step.timeout || 30000;

    const executeWithTimeout = async (): Promise<unknown> => {
      switch (step.type) {
        case 'speak': {
          if (!this.speakFunction) {
            logger.warn('Speak function not registered');
            return null;
          }
          const text = this.substituteVariables(step.action, context);
          await this.speakFunction(text);
          return { spoken: text };
        }

        case 'tool': {
          if (!this.toolExecutor) {
            throw new Error('Tool executor not registered');
          }
          const params = step.parameters ? this.substituteVariablesInObject(step.parameters, context) : {};
          return await this.toolExecutor(step.action, params as Record<string, unknown>);
        }

        case 'command': {
          if (!this.commandExecutor) {
            throw new Error('Command executor not registered');
          }
          await this.commandExecutor(step.action);
          return { command: step.action };
        }

        case 'wait': {
          const duration = parseInt(step.action, 10) || 1000;
          await new Promise((resolve) => setTimeout(resolve, duration));
          return { waited: duration };
        }

        case 'conditional': {
          // Conditional steps are handled by checkConditions
          return { skipped: false };
        }

        default:
          throw new Error(`Unknown step type: ${step.type}`);
      }
    };

    return Promise.race([
      executeWithTimeout(),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`Step timeout: ${step.id}`)), timeout)),
    ]);
  }

  /**
   * Substitute {{variables}} in text
   */
  private substituteVariables(text: string, context: Record<string, unknown>): string {
    return text.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      const value = context[key];
      return value !== undefined ? String(value) : `{{${key}}}`;
    });
  }

  /**
   * Substitute variables in object values
   */
  private substituteVariablesInObject(obj: Record<string, unknown>, context: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string') {
        result[key] = this.substituteVariables(value, context);
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  // ============================================================================
  // Utility
  // ============================================================================

  /**
   * Get execution history
   */
  getExecutionHistory(): MacroExecutionResult[] {
    return [...this.executionHistory];
  }

  /**
   * Check if macro is currently executing
   */
  isCurrentlyExecuting(): boolean {
    return this.isExecuting;
  }

  /**
   * Get currently executing macro ID
   */
  getCurrentExecution(): string | null {
    return this.currentExecution;
  }

  /**
   * Cancel current execution
   */
  cancelExecution(): boolean {
    if (!this.isExecuting) return false;

    this.isExecuting = false;
    const macroId = this.currentExecution;
    this.currentExecution = null;

    if (macroId) {
      this.emit('macro-failed', macroId, 'Execution cancelled');
    }

    return true;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let macroManager: CommandMacroManager | null = null;

export function getCommandMacroManager(): CommandMacroManager {
  if (!macroManager) {
    macroManager = new CommandMacroManager();
  }
  return macroManager;
}
