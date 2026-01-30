/**
 * Trigger Engine
 * Executes automation triggers based on context changes
 */

import { EventEmitter } from 'events';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { createModuleLogger } from '../utils/logger';
import { getErrorMessage, sleep } from '../../shared/utils';
import { getContextMonitor } from './context-monitor';
import {
  AutomationTrigger,
  TriggerCondition,
  AutomationAction,
  AutomationContext,
  AutomationLog,
  ActionLog,
  ContextState
} from './types';

const execAsync = promisify(exec);
const logger = createModuleLogger('TriggerEngine');

interface TriggerEngineConfig {
  maxConcurrentTriggers: number;
  defaultCooldown: number;
  maxRetries: number;
}

const DEFAULT_CONFIG: TriggerEngineConfig = {
  maxConcurrentTriggers: 5,
  defaultCooldown: 5000, // 5 seconds
  maxRetries: 3
};

class TriggerEngine extends EventEmitter {
  private config: TriggerEngineConfig;
  private triggers: Map<string, AutomationTrigger> = new Map();
  private runningTriggers: Set<string> = new Set();
  private scheduledTimers: Map<string, NodeJS.Timeout> = new Map();
  private logs: AutomationLog[] = [];
  private initialized: boolean = false;

  constructor(config: Partial<TriggerEngineConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    logger.info('Initializing trigger engine');
    
    // Subscribe to context monitor events
    const contextMonitor = getContextMonitor();
    
    contextMonitor.on('application-focus', (app) => this.checkTriggers('application', { event: 'focus', name: app }));
    contextMonitor.on('application-blur', (app) => this.checkTriggers('application', { event: 'blur', name: app }));
    contextMonitor.on('application-change', (data) => this.checkTriggers('application', { event: 'change', ...data }));
    contextMonitor.on('system-lock', () => this.checkTriggers('system', { event: 'lock' }));
    contextMonitor.on('system-unlock', () => this.checkTriggers('system', { event: 'unlock' }));
    contextMonitor.on('system-idle', (time) => this.checkTriggers('system', { event: 'idle', idleTime: time }));
    contextMonitor.on('system-active', () => this.checkTriggers('system', { event: 'active' }));
    contextMonitor.on('network-connect', (data) => this.checkTriggers('network', { event: 'connect', ...data }));
    contextMonitor.on('network-disconnect', () => this.checkTriggers('network', { event: 'disconnect' }));
    contextMonitor.on('battery-low', (level) => this.checkTriggers('system', { event: 'battery_low', level }));
    contextMonitor.on('battery-charging', () => this.checkTriggers('system', { event: 'battery_charging' }));
    
    this.initialized = true;
    this.emit('initialized');
  }

  /**
   * Register a trigger
   */
  registerTrigger(trigger: AutomationTrigger): void {
    this.triggers.set(trigger.id, trigger);
    
    // Set up scheduled triggers
    if (trigger.type === 'time' && trigger.condition.schedule) {
      this.setupScheduledTrigger(trigger);
    }
    
    logger.info(`Trigger registered: ${trigger.name}`, { id: trigger.id, type: trigger.type });
    this.emit('trigger-registered', trigger);
  }

  /**
   * Unregister a trigger
   */
  unregisterTrigger(triggerId: string): void {
    const trigger = this.triggers.get(triggerId);
    if (!trigger) return;
    
    // Clear any scheduled timer
    const timer = this.scheduledTimers.get(triggerId);
    if (timer) {
      clearTimeout(timer);
      this.scheduledTimers.delete(triggerId);
    }
    
    this.triggers.delete(triggerId);
    logger.info(`Trigger unregistered: ${trigger.name}`);
    this.emit('trigger-unregistered', trigger);
  }

  /**
   * Enable/disable a trigger
   */
  setTriggerEnabled(triggerId: string, enabled: boolean): void {
    const trigger = this.triggers.get(triggerId);
    if (!trigger) return;
    
    trigger.enabled = enabled;
    trigger.updatedAt = new Date();
    
    if (trigger.type === 'time' && trigger.condition.schedule) {
      if (enabled) {
        this.setupScheduledTrigger(trigger);
      } else {
        const timer = this.scheduledTimers.get(triggerId);
        if (timer) {
          clearTimeout(timer);
          this.scheduledTimers.delete(triggerId);
        }
      }
    }
    
    this.emit('trigger-updated', trigger);
  }

  /**
   * Check triggers against event
   */
  private async checkTriggers(
    eventType: string,
    eventData: Record<string, unknown>
  ): Promise<void> {
    for (const trigger of this.triggers.values()) {
      if (!trigger.enabled) continue;
      if (trigger.type !== eventType) continue;
      if (this.runningTriggers.has(trigger.id)) continue;
      
      // Check cooldown
      if (trigger.lastTriggered) {
        const cooldown = trigger.cooldown ?? this.config.defaultCooldown;
        const elapsed = Date.now() - trigger.lastTriggered.getTime();
        if (elapsed < cooldown) continue;
      }
      
      // Check condition
      if (this.evaluateCondition(trigger.condition, eventData)) {
        this.executeTrigger(trigger, eventData);
      }
    }
  }

  /**
   * Evaluate trigger condition
   */
  private evaluateCondition(
    condition: TriggerCondition,
    eventData: Record<string, unknown>
  ): boolean {
    // Check combined conditions first
    if (condition.all) {
      return condition.all.every(c => this.evaluateCondition(c, eventData));
    }
    
    if (condition.any) {
      return condition.any.some(c => this.evaluateCondition(c, eventData));
    }
    
    if (condition.not) {
      return !this.evaluateCondition(condition.not, eventData);
    }
    
    // Check type-specific conditions
    switch (condition.type) {
      case 'application':
        return this.evaluateApplicationCondition(condition.application, eventData);
      case 'system':
        return this.evaluateSystemCondition(condition.system, eventData);
      case 'network':
        return this.evaluateNetworkCondition(condition.network, eventData);
      case 'voice':
        return this.evaluateVoiceCondition(condition.voice, eventData);
      default:
        return true;
    }
  }

  private evaluateApplicationCondition(
    condition: TriggerCondition['application'],
    eventData: Record<string, unknown>
  ): boolean {
    if (!condition) return true;
    
    if (condition.event && condition.event !== eventData.event) return false;
    if (condition.name && condition.name.toLowerCase() !== String(eventData.name).toLowerCase()) return false;
    if (condition.titleContains && !String(eventData.window || '').includes(condition.titleContains)) return false;
    
    return true;
  }

  private evaluateSystemCondition(
    condition: TriggerCondition['system'],
    eventData: Record<string, unknown>
  ): boolean {
    if (!condition) return true;
    
    if (condition.event !== eventData.event) return false;
    if (condition.idleTime && eventData.idleTime && Number(eventData.idleTime) < condition.idleTime) return false;
    if (condition.batteryLevel && eventData.level && Number(eventData.level) > condition.batteryLevel) return false;
    
    return true;
  }

  private evaluateNetworkCondition(
    condition: TriggerCondition['network'],
    eventData: Record<string, unknown>
  ): boolean {
    if (!condition) return true;
    
    if (condition.event !== eventData.event) return false;
    if (condition.ssid && condition.ssid !== eventData.ssid) return false;
    if (condition.type && condition.type !== eventData.type) return false;
    
    return true;
  }

  private evaluateVoiceCondition(
    condition: TriggerCondition['voice'],
    eventData: Record<string, unknown>
  ): boolean {
    if (!condition) return true;
    
    const transcript = String(eventData.transcript || '').toLowerCase();
    
    if (condition.phrase && !transcript.includes(condition.phrase.toLowerCase())) return false;
    if (condition.patterns) {
      const matches = condition.patterns.some(p => 
        new RegExp(p, 'i').test(transcript)
      );
      if (!matches) return false;
    }
    
    return true;
  }

  /**
   * Set up a time-based trigger
   */
  private setupScheduledTrigger(trigger: AutomationTrigger): void {
    const schedule = trigger.condition.schedule;
    if (!schedule) return;
    
    // Clear existing timer
    const existingTimer = this.scheduledTimers.get(trigger.id);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }
    
    const scheduleNext = () => {
      const now = new Date();
      let nextRun: Date;
      
      if (schedule.type === 'once' && schedule.date && schedule.time) {
        nextRun = new Date(`${schedule.date}T${schedule.time}`);
        if (nextRun <= now) return; // Already passed
      } else if (schedule.type === 'recurring') {
        nextRun = this.calculateNextRecurrence(schedule, now);
      } else {
        return;
      }
      
      const delay = nextRun.getTime() - now.getTime();
      
      const timer = setTimeout(() => {
        this.executeTrigger(trigger, { scheduledTime: nextRun });
        
        // Reschedule for recurring
        if (schedule.type === 'recurring') {
          scheduleNext();
        }
      }, delay);
      
      this.scheduledTimers.set(trigger.id, timer);
    };
    
    scheduleNext();
  }

  /**
   * Calculate next recurrence time
   */
  private calculateNextRecurrence(
    schedule: TriggerCondition['schedule'],
    now: Date
  ): Date {
    if (!schedule) return now;
    
    if (schedule.interval) {
      // Simple interval-based recurrence
      return new Date(now.getTime() + schedule.interval * 60 * 1000);
    }
    
    if (schedule.time) {
      const [hours, minutes] = schedule.time.split(':').map(Number);
      const next = new Date(now);
      next.setHours(hours, minutes, 0, 0);
      
      // If time has passed today, move to next valid day
      if (next <= now) {
        next.setDate(next.getDate() + 1);
      }
      
      // Check days of week if specified
      if (schedule.days && schedule.days.length > 0) {
        while (!schedule.days.includes(next.getDay())) {
          next.setDate(next.getDate() + 1);
        }
      }
      
      return next;
    }
    
    return now;
  }

  /**
   * Execute a trigger
   */
  private async executeTrigger(
    trigger: AutomationTrigger,
    triggerData: Record<string, unknown>
  ): Promise<void> {
    if (this.runningTriggers.size >= this.config.maxConcurrentTriggers) {
      logger.warn(`Max concurrent triggers reached, skipping: ${trigger.name}`);
      return;
    }
    
    this.runningTriggers.add(trigger.id);
    trigger.lastTriggered = new Date();
    
    const log: AutomationLog = {
      id: `log-${Date.now()}`,
      triggerId: trigger.id,
      triggerName: trigger.name,
      startTime: new Date(),
      success: true,
      actions: []
    };
    
    const context: AutomationContext = {
      trigger,
      triggerData,
      variables: new Map(),
      results: new Map(),
      startTime: new Date()
    };
    
    logger.info(`Executing trigger: ${trigger.name}`, { data: triggerData });
    this.emit('trigger-start', trigger, triggerData);
    
    try {
      // Execute actions in sequence
      for (const action of trigger.actions) {
        const actionLog = await this.executeAction(action, context);
        log.actions.push(actionLog);
        
        if (!actionLog.success) {
          log.success = false;
          break;
        }
      }
    } catch (error) {
      log.success = false;
      log.error = getErrorMessage(error, 'Unknown error');
      logger.error(`Trigger execution failed: ${trigger.name}`, error);
    } finally {
      log.endTime = new Date();
      this.runningTriggers.delete(trigger.id);
      this.logs.push(log);
      
      // Keep only last 100 logs
      if (this.logs.length > 100) {
        this.logs = this.logs.slice(-100);
      }
      
      this.emit('trigger-complete', trigger, log);
    }
  }

  /**
   * Execute a single action
   */
  private async executeAction(
    action: AutomationAction,
    context: AutomationContext
  ): Promise<ActionLog> {
    const log: ActionLog = {
      actionId: action.id,
      type: action.type,
      startTime: new Date(),
      success: true
    };
    
    // Apply delay if specified
    if (action.delay) {
      await sleep(action.delay);
    }
    
    // Check action condition
    if (action.condition && !this.evaluateActionCondition(action.condition, context)) {
      log.success = true;
      log.result = 'Skipped due to condition';
      log.endTime = new Date();
      return log;
    }
    
    try {
      const result = await this.performAction(action, context);
      log.result = result;
      context.results.set(action.id, result);
    } catch (error) {
      log.success = false;
      log.error = getErrorMessage(error, 'Unknown error');
      logger.error(`Action failed: ${action.type}`, error);
    }
    
    log.endTime = new Date();
    return log;
  }

  /**
   * Evaluate action condition
   */
  private evaluateActionCondition(
    condition: AutomationAction['condition'],
    context: AutomationContext
  ): boolean {
    if (!condition) return true;
    
    switch (condition.type) {
      case 'variable': {
        const value = context.variables.get(condition.variable || '');
        return this.compareValues(value, condition.operator, condition.value);
      }
      case 'result': {
        const result = context.results.get(condition.variable || '');
        return this.compareValues(result, condition.operator, condition.value);
      }
      case 'expression': {
        try {
          // Simple expression evaluation (be careful with this)
          return Boolean(condition.expression);
        } catch {
          return false;
        }
      }
      default:
        return true;
    }
  }

  private compareValues(
    actual: unknown,
    operator: string | undefined,
    expected: unknown
  ): boolean {
    switch (operator) {
      case 'eq': return actual === expected;
      case 'ne': return actual !== expected;
      case 'gt': return Number(actual) > Number(expected);
      case 'lt': return Number(actual) < Number(expected);
      case 'contains': return String(actual).includes(String(expected));
      default: return actual === expected;
    }
  }

  /**
   * Perform the actual action
   */
  private async performAction(
    action: AutomationAction,
    context: AutomationContext
  ): Promise<unknown> {
    const params = action.params;
    
    switch (action.type) {
      case 'run_command': {
        if (!params.command) throw new Error('No command specified');
        const { stdout } = await execAsync(params.command, { cwd: params.cwd });
        return stdout;
      }
      
      case 'open_application': {
        if (!params.application) throw new Error('No application specified');
        if (process.platform === 'win32') {
          spawn('cmd', ['/c', 'start', '', params.application], { detached: true });
        } else if (process.platform === 'darwin') {
          spawn('open', ['-a', params.application], { detached: true });
        } else {
          spawn(params.application, { detached: true });
        }
        return `Opened ${params.application}`;
      }
      
      case 'open_url': {
        if (!params.url) throw new Error('No URL specified');
        if (process.platform === 'win32') {
          spawn('cmd', ['/c', 'start', '', params.url], { detached: true });
        } else if (process.platform === 'darwin') {
          spawn('open', [params.url], { detached: true });
        } else {
          spawn('xdg-open', [params.url], { detached: true });
        }
        return `Opened ${params.url}`;
      }
      
      case 'send_notification': {
        const { Notification } = require('electron');
        new Notification({
          title: params.title || 'Atlas',
          body: params.body || ''
        }).show();
        return 'Notification sent';
      }
      
      case 'speak': {
        // Emit event for TTS system to handle
        this.emit('speak', params.text, params.voice);
        return `Speaking: ${params.text}`;
      }
      
      case 'set_variable': {
        if (!params.variable) throw new Error('No variable name specified');
        context.variables.set(params.variable, params.value);
        return `Set ${params.variable} = ${params.value}`;
      }
      
      case 'execute_tool': {
        // Emit event for tool system to handle
        this.emit('execute-tool', params.toolName, params.toolParams);
        return `Executed tool: ${params.toolName}`;
      }
      
      case 'clipboard': {
        const { clipboard } = require('electron');
        if (params.content) {
          clipboard.writeText(params.content);
          return 'Copied to clipboard';
        }
        return clipboard.readText();
      }
      
      default:
        throw new Error(`Unknown action type: ${action.type}`);
    }
  }

  /**
   * Manual trigger execution
   */
  async runTrigger(triggerId: string): Promise<void> {
    const trigger = this.triggers.get(triggerId);
    if (!trigger) throw new Error(`Trigger not found: ${triggerId}`);
    
    await this.executeTrigger(trigger, { manual: true });
  }

  /**
   * Handle voice command for triggers
   */
  handleVoiceCommand(transcript: string): void {
    this.checkTriggers('voice', { transcript, event: 'command' });
  }

  /**
   * Get all triggers
   */
  getTriggers(): AutomationTrigger[] {
    return Array.from(this.triggers.values());
  }

  /**
   * Get trigger by ID
   */
  getTrigger(triggerId: string): AutomationTrigger | undefined {
    return this.triggers.get(triggerId);
  }

  /**
   * Get execution logs
   */
  getLogs(limit?: number): AutomationLog[] {
    return limit ? this.logs.slice(-limit) : [...this.logs];
  }

  getStatus(): {
    initialized: boolean;
    triggerCount: number;
    runningCount: number;
    scheduledCount: number;
  } {
    return {
      initialized: this.initialized,
      triggerCount: this.triggers.size,
      runningCount: this.runningTriggers.size,
      scheduledCount: this.scheduledTimers.size
    };
  }
}

// Singleton instance
let triggerEngine: TriggerEngine | null = null;

export function getTriggerEngine(): TriggerEngine {
  if (!triggerEngine) {
    triggerEngine = new TriggerEngine();
  }
  return triggerEngine;
}

export { TriggerEngine };
