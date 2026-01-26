/**
 * Playbook Engine
 * Executes automated workflows based on triggers
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { createModuleLogger } from '../../utils/logger';
import {
  Playbook,
  PlaybookExecution,
  Trigger,
  Action,
  ActionResult,
  ExecutionStatus,
  PlaybookConfig,
  DEFAULT_PLAYBOOK_CONFIG,
  TriggerType,
  TimeTrigger,
  EventTrigger,
  ConditionTrigger,
  EntityChangeTrigger,
  PatternTrigger,
  AlertTrigger,
  VoiceTrigger,
  ActionType,
} from './types';

const logger = createModuleLogger('PlaybookEngine');

// ============================================================================
// PLAYBOOK ENGINE
// ============================================================================

export class PlaybookEngine extends EventEmitter {
  private playbooks: Map<string, Playbook> = new Map();
  private executions: Map<string, PlaybookExecution> = new Map();
  private executionHistory: PlaybookExecution[] = [];
  private config: PlaybookConfig;
  
  // Scheduling
  private schedulerInterval: NodeJS.Timeout | null = null;
  private conditionCheckInterval: NodeJS.Timeout | null = null;
  private cronJobs: Map<string, NodeJS.Timeout> = new Map();
  
  // Action handlers
  private actionHandlers: Map<ActionType, (action: Action, context: ExecutionContext) => Promise<unknown>> = new Map();
  
  constructor(config: Partial<PlaybookConfig> = {}) {
    super();
    this.config = { ...DEFAULT_PLAYBOOK_CONFIG, ...config };
    this.registerDefaultActionHandlers();
  }

  // --------------------------------------------------------------------------
  // INITIALIZATION
  // --------------------------------------------------------------------------

  async initialize(): Promise<void> {
    logger.info('Initializing playbook engine...');
    
    // Load playbooks from storage
    await this.loadPlaybooks();
    
    // Start scheduler
    this.startScheduler();
    
    // Start condition checker
    this.startConditionChecker();
    
    logger.info(`Playbook engine initialized with ${this.playbooks.size} playbooks`);
  }

  async shutdown(): Promise<void> {
    // Stop scheduler
    if (this.schedulerInterval) {
      clearInterval(this.schedulerInterval);
      this.schedulerInterval = null;
    }
    
    // Stop condition checker
    if (this.conditionCheckInterval) {
      clearInterval(this.conditionCheckInterval);
      this.conditionCheckInterval = null;
    }
    
    // Cancel cron jobs
    for (const job of this.cronJobs.values()) {
      clearTimeout(job);
    }
    this.cronJobs.clear();
    
    // Cancel running executions
    for (const execution of this.executions.values()) {
      if (execution.status === 'running') {
        execution.status = 'cancelled';
        execution.completedAt = new Date();
      }
    }
    
    logger.info('Playbook engine shut down');
  }

  // --------------------------------------------------------------------------
  // PLAYBOOK MANAGEMENT
  // --------------------------------------------------------------------------

  async createPlaybook(data: Omit<Playbook, 'id' | 'createdAt' | 'updatedAt' | 'runCount' | 'successCount' | 'errorCount' | 'averageRunTimeMs'>): Promise<Playbook> {
    const now = new Date();
    const playbook: Playbook = {
      ...data,
      id: uuidv4(),
      createdAt: now,
      updatedAt: now,
      runCount: 0,
      successCount: 0,
      errorCount: 0,
      averageRunTimeMs: 0,
    };
    
    this.playbooks.set(playbook.id, playbook);
    await this.savePlaybook(playbook);
    
    // Set up triggers
    this.setupTriggers(playbook);
    
    this.emit('playbook-created', playbook);
    logger.info(`Created playbook: ${playbook.name} (${playbook.id})`);
    
    return playbook;
  }

  async updatePlaybook(id: string, updates: Partial<Playbook>): Promise<Playbook | null> {
    const playbook = this.playbooks.get(id);
    if (!playbook) {
      return null;
    }
    
    // Clear old triggers
    this.clearTriggers(playbook);
    
    // Apply updates
    Object.assign(playbook, updates, { updatedAt: new Date() });
    await this.savePlaybook(playbook);
    
    // Set up new triggers
    if (playbook.status === 'active') {
      this.setupTriggers(playbook);
    }
    
    this.emit('playbook-updated', playbook);
    logger.info(`Updated playbook: ${playbook.name} (${playbook.id})`);
    
    return playbook;
  }

  async deletePlaybook(id: string): Promise<boolean> {
    const playbook = this.playbooks.get(id);
    if (!playbook) {
      return false;
    }
    
    this.clearTriggers(playbook);
    this.playbooks.delete(id);
    
    this.emit('playbook-deleted', playbook);
    logger.info(`Deleted playbook: ${playbook.name} (${playbook.id})`);
    
    return true;
  }

  getPlaybook(id: string): Playbook | undefined {
    return this.playbooks.get(id);
  }

  getAllPlaybooks(): Playbook[] {
    return Array.from(this.playbooks.values());
  }

  getActivePlaybooks(): Playbook[] {
    return this.getAllPlaybooks().filter(p => p.status === 'active');
  }

  // --------------------------------------------------------------------------
  // TRIGGER SETUP
  // --------------------------------------------------------------------------

  private setupTriggers(playbook: Playbook): void {
    if (playbook.status !== 'active') {
      return;
    }
    
    for (const trigger of playbook.triggers) {
      if (!trigger.enabled) {
        continue;
      }
      
      switch (trigger.type) {
        case 'time':
          this.setupTimeTrigger(playbook, trigger as TimeTrigger);
          break;
        case 'event':
          // Events are handled via handleEvent()
          break;
        case 'condition':
          // Conditions are checked by conditionChecker
          break;
        // Pattern, alert, voice, entity_change handled by external systems
      }
    }
  }

  private clearTriggers(playbook: Playbook): void {
    for (const trigger of playbook.triggers) {
      const jobKey = `${playbook.id}:${trigger.id}`;
      const job = this.cronJobs.get(jobKey);
      if (job) {
        clearTimeout(job);
        this.cronJobs.delete(jobKey);
      }
    }
  }

  private setupTimeTrigger(playbook: Playbook, trigger: TimeTrigger): void {
    const jobKey = `${playbook.id}:${trigger.id}`;
    
    switch (trigger.schedule.type) {
      case 'interval':
        this.scheduleInterval(jobKey, trigger.schedule.value as number, () => {
          this.triggerPlaybook(playbook.id, trigger);
        });
        break;
        
      case 'daily':
        this.scheduleDailyJob(jobKey, trigger.schedule.value as string, () => {
          this.triggerPlaybook(playbook.id, trigger);
        });
        break;
        
      case 'cron':
        // Simplified cron - would need a cron parser library for full support
        logger.warn(`Cron scheduling not fully implemented for ${trigger.id}`);
        break;
    }
  }

  private scheduleInterval(key: string, ms: number, callback: () => void): void {
    const job = setInterval(callback, ms);
    this.cronJobs.set(key, job as unknown as NodeJS.Timeout);
  }

  private scheduleDailyJob(key: string, time: string, callback: () => void): void {
    const [hours, minutes] = time.split(':').map(Number);
    const now = new Date();
    const nextRun = new Date(now);
    nextRun.setHours(hours, minutes, 0, 0);
    
    if (nextRun <= now) {
      nextRun.setDate(nextRun.getDate() + 1);
    }
    
    const delay = nextRun.getTime() - now.getTime();
    
    const job = setTimeout(() => {
      callback();
      // Reschedule for next day
      this.scheduleDailyJob(key, time, callback);
    }, delay);
    
    this.cronJobs.set(key, job);
  }

  // --------------------------------------------------------------------------
  // SCHEDULER
  // --------------------------------------------------------------------------

  private startScheduler(): void {
    this.schedulerInterval = setInterval(
      () => this.checkScheduledTriggers(),
      this.config.schedulerIntervalMs
    );
  }

  private startConditionChecker(): void {
    this.conditionCheckInterval = setInterval(
      () => this.checkConditions(),
      this.config.conditionCheckIntervalMs
    );
  }

  private checkScheduledTriggers(): void {
    // Interval-based triggers are handled by setInterval
    // This handles any additional scheduling logic
  }

  private async checkConditions(): Promise<void> {
    for (const playbook of this.getActivePlaybooks()) {
      for (const trigger of playbook.triggers) {
        if (trigger.type !== 'condition' || !trigger.enabled) {
          continue;
        }
        
        const condTrigger = trigger as ConditionTrigger;
        try {
          const result = await this.evaluateCondition(condTrigger.condition);
          if (result) {
            this.triggerPlaybook(playbook.id, trigger);
          }
        } catch (error) {
          logger.error(`Error checking condition for ${playbook.id}:`, error as Record<string, unknown>);
        }
      }
    }
  }

  private async evaluateCondition(condition: { type: string; value: string }): Promise<boolean> {
    // Simple expression evaluation - in production, use a proper expression parser
    if (condition.type === 'expression') {
      try {
        // Very basic eval - should be sandboxed in production
        return Boolean(eval(condition.value));
      } catch {
        return false;
      }
    }
    return false;
  }

  // --------------------------------------------------------------------------
  // EXTERNAL TRIGGER HANDLERS
  // --------------------------------------------------------------------------

  /**
   * Handle an external event
   */
  handleEvent(eventName: string, data?: unknown): void {
    for (const playbook of this.getActivePlaybooks()) {
      for (const trigger of playbook.triggers) {
        if (trigger.type !== 'event' || !trigger.enabled) {
          continue;
        }
        
        const eventTrigger = trigger as EventTrigger;
        if (eventTrigger.eventName === eventName) {
          // Check filters
          if (eventTrigger.eventFilters && data) {
            const matches = this.matchesFilters(data, eventTrigger.eventFilters);
            if (!matches) {
              continue;
            }
          }
          
          this.triggerPlaybook(playbook.id, trigger, data);
        }
      }
    }
  }

  /**
   * Handle entity change
   */
  handleEntityChange(
    entityType: string,
    changeType: 'created' | 'updated' | 'deleted',
    entity: unknown
  ): void {
    for (const playbook of this.getActivePlaybooks()) {
      for (const trigger of playbook.triggers) {
        if (trigger.type !== 'entity_change' || !trigger.enabled) {
          continue;
        }
        
        const entityTrigger = trigger as EntityChangeTrigger;
        if (
          entityTrigger.entityType === entityType &&
          entityTrigger.changeType.includes(changeType)
        ) {
          this.triggerPlaybook(playbook.id, trigger, { changeType, entity });
        }
      }
    }
  }

  /**
   * Handle pattern detected
   */
  handlePatternDetected(patternType: string, confidence: number, data: unknown): void {
    for (const playbook of this.getActivePlaybooks()) {
      for (const trigger of playbook.triggers) {
        if (trigger.type !== 'pattern' || !trigger.enabled) {
          continue;
        }
        
        const patternTrigger = trigger as PatternTrigger;
        if (
          patternTrigger.patternType === patternType &&
          confidence >= patternTrigger.minConfidence
        ) {
          this.triggerPlaybook(playbook.id, trigger, { confidence, ...data as object });
        }
      }
    }
  }

  /**
   * Handle alert raised
   */
  handleAlertRaised(alertType: string, agentId: string, priority: number, data: unknown): void {
    for (const playbook of this.getActivePlaybooks()) {
      for (const trigger of playbook.triggers) {
        if (trigger.type !== 'alert' || !trigger.enabled) {
          continue;
        }
        
        const alertTrigger = trigger as AlertTrigger;
        if (
          alertTrigger.alertTypes.includes(alertType) &&
          (!alertTrigger.agentIds || alertTrigger.agentIds.includes(agentId as any)) &&
          (!alertTrigger.minPriority || priority >= alertTrigger.minPriority)
        ) {
          this.triggerPlaybook(playbook.id, trigger, data);
        }
      }
    }
  }

  /**
   * Handle voice command
   */
  handleVoiceCommand(text: string): Playbook | null {
    const normalizedText = text.toLowerCase().trim();
    
    for (const playbook of this.getActivePlaybooks()) {
      for (const trigger of playbook.triggers) {
        if (trigger.type !== 'voice' || !trigger.enabled) {
          continue;
        }
        
        const voiceTrigger = trigger as VoiceTrigger;
        for (const phrase of voiceTrigger.phrases) {
          const normalizedPhrase = phrase.toLowerCase().trim();
          const matches = voiceTrigger.requireExactMatch
            ? normalizedText === normalizedPhrase
            : normalizedText.includes(normalizedPhrase);
          
          if (matches) {
            this.triggerPlaybook(playbook.id, trigger, { text });
            return playbook;
          }
        }
      }
    }
    
    return null;
  }

  /**
   * Manually trigger a playbook
   */
  manualTrigger(playbookId: string, data?: unknown): string | null {
    const playbook = this.playbooks.get(playbookId);
    if (!playbook) {
      return null;
    }
    
    const manualTrigger = playbook.triggers.find(t => t.type === 'manual');
    if (manualTrigger) {
      return this.triggerPlaybook(playbookId, manualTrigger, data);
    }
    
    // Create ad-hoc trigger
    const trigger: Trigger = {
      id: 'manual-adhoc',
      type: 'manual',
      enabled: true,
    };
    
    return this.triggerPlaybook(playbookId, trigger, data);
  }

  private matchesFilters(data: unknown, filters: Record<string, unknown>): boolean {
    if (typeof data !== 'object' || data === null) {
      return false;
    }
    
    const dataObj = data as Record<string, unknown>;
    for (const [key, value] of Object.entries(filters)) {
      if (dataObj[key] !== value) {
        return false;
      }
    }
    
    return true;
  }

  // --------------------------------------------------------------------------
  // EXECUTION
  // --------------------------------------------------------------------------

  private triggerPlaybook(playbookId: string, trigger: Trigger, data?: unknown): string | null {
    const playbook = this.playbooks.get(playbookId);
    if (!playbook || playbook.status !== 'active') {
      return null;
    }
    
    // Check run limits
    if (playbook.runLimit) {
      const recentRuns = this.executionHistory.filter(
        e => e.playbookId === playbookId &&
          e.startedAt.getTime() > Date.now() - playbook.runLimit!.periodMs
      );
      if (recentRuns.length >= playbook.runLimit.maxRuns) {
        logger.debug(`Playbook ${playbookId} hit run limit`);
        return null;
      }
    }
    
    // Check cooldown
    if (playbook.cooldownMs && playbook.lastRunAt) {
      const timeSinceLastRun = Date.now() - playbook.lastRunAt.getTime();
      if (timeSinceLastRun < playbook.cooldownMs) {
        logger.debug(`Playbook ${playbookId} in cooldown`);
        return null;
      }
    }
    
    // Check concurrent execution limit
    const runningCount = Array.from(this.executions.values()).filter(
      e => e.status === 'running'
    ).length;
    if (runningCount >= this.config.maxConcurrentExecutions) {
      logger.warn('Max concurrent executions reached');
      return null;
    }
    
    // Create execution
    const execution: PlaybookExecution = {
      id: uuidv4(),
      playbookId,
      playbookName: playbook.name,
      triggerId: trigger.id,
      triggerType: trigger.type,
      triggerData: data,
      status: 'pending',
      startedAt: new Date(),
      variables: { ...playbook.variables, _trigger: data },
      actionResults: [],
      currentActionIndex: 0,
    };
    
    this.executions.set(execution.id, execution);
    this.emit('execution-started', execution);
    
    // Check if confirmation required
    if (playbook.requiresConfirmation) {
      execution.status = 'waiting';
      this.emit('execution-waiting-confirmation', execution);
      return execution.id;
    }
    
    // Run execution
    this.runExecution(execution);
    
    return execution.id;
  }

  async confirmExecution(executionId: string): Promise<boolean> {
    const execution = this.executions.get(executionId);
    if (!execution || execution.status !== 'waiting') {
      return false;
    }
    
    this.runExecution(execution);
    return true;
  }

  async cancelExecution(executionId: string): Promise<boolean> {
    const execution = this.executions.get(executionId);
    if (!execution) {
      return false;
    }
    
    if (execution.status === 'running' || execution.status === 'waiting') {
      execution.status = 'cancelled';
      execution.completedAt = new Date();
      this.finalizeExecution(execution);
      return true;
    }
    
    return false;
  }

  private async runExecution(execution: PlaybookExecution): Promise<void> {
    const playbook = this.playbooks.get(execution.playbookId);
    if (!playbook) {
      execution.status = 'failed';
      execution.error = 'Playbook not found';
      this.finalizeExecution(execution);
      return;
    }
    
    execution.status = 'running';
    const context: ExecutionContext = {
      execution,
      playbook,
      variables: execution.variables,
    };
    
    try {
      for (let i = 0; i < playbook.actionOrder.length; i++) {
        execution.currentActionIndex = i;
        const actionId = playbook.actionOrder[i];
        const action = playbook.actions.find(a => a.id === actionId);
        
        if (!action) {
          throw new Error(`Action ${actionId} not found`);
        }
        
        // Check if cancelled
        if (execution.status === 'cancelled') {
          break;
        }
        
        await this.executeAction(action, context);
      }
      
      execution.status = 'completed';
    } catch (error) {
      execution.status = 'failed';
      execution.error = (error as Error).message;
      logger.error(`Execution ${execution.id} failed:`, error as Record<string, unknown>);
    }
    
    execution.completedAt = new Date();
    this.finalizeExecution(execution);
  }

  private async executeAction(action: Action, context: ExecutionContext): Promise<void> {
    const result: ActionResult = {
      actionId: action.id,
      status: 'running',
      startedAt: new Date(),
      retryCount: 0,
    };
    
    context.execution.actionResults.push(result);
    
    const handler = this.actionHandlers.get(action.type);
    if (!handler) {
      result.status = 'failed';
      result.error = `No handler for action type: ${action.type}`;
      result.completedAt = new Date();
      
      if (!action.continueOnError) {
        throw new Error(result.error);
      }
      return;
    }
    
    const maxRetries = action.retryCount ?? this.config.maxRetries;
    const retryDelay = action.retryDelayMs ?? this.config.retryDelayMs;
    const timeout = action.timeoutMs ?? this.config.defaultTimeoutMs;
    
    while (result.retryCount <= maxRetries) {
      try {
        const actionPromise = handler(action, context);
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Action timed out')), timeout);
        });
        
        result.result = await Promise.race([actionPromise, timeoutPromise]);
        result.status = 'completed';
        result.completedAt = new Date();
        
        // Store result in variables if specified
        const configWithStore = action as Action & { config?: { storeResultAs?: string } };
        if (configWithStore.config?.storeResultAs) {
          context.variables[configWithStore.config.storeResultAs] = result.result;
        }
        
        return;
      } catch (error) {
        result.retryCount++;
        
        if (result.retryCount > maxRetries) {
          result.status = 'failed';
          result.error = (error as Error).message;
          result.completedAt = new Date();
          
          if (!action.continueOnError) {
            throw error;
          }
          return;
        }
        
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    }
  }

  private finalizeExecution(execution: PlaybookExecution): void {
    const playbook = this.playbooks.get(execution.playbookId);
    if (playbook) {
      playbook.runCount++;
      playbook.lastRunAt = new Date();
      
      if (execution.status === 'completed') {
        playbook.successCount++;
      } else if (execution.status === 'failed') {
        playbook.errorCount++;
      }
      
      const runTime = execution.completedAt!.getTime() - execution.startedAt.getTime();
      playbook.averageRunTimeMs = 
        (playbook.averageRunTimeMs * (playbook.runCount - 1) + runTime) / playbook.runCount;
    }
    
    // Move to history
    this.executions.delete(execution.id);
    this.executionHistory.push(execution);
    
    // Trim history
    while (this.executionHistory.length > this.config.maxExecutionHistory) {
      this.executionHistory.shift();
    }
    
    this.emit('execution-completed', execution);
  }

  // --------------------------------------------------------------------------
  // ACTION HANDLERS
  // --------------------------------------------------------------------------

  private registerDefaultActionHandlers(): void {
    this.actionHandlers.set('notify', async (action, context) => {
      const config = (action as any).config;
      logger.info(`[NOTIFY] ${config.title}: ${config.body}`);
      // In production, integrate with notification system
      return { sent: true };
    });
    
    this.actionHandlers.set('voice', async (action, context) => {
      const config = (action as any).config;
      logger.info(`[VOICE] ${config.text}`);
      // In production, integrate with TTS
      return { spoken: true };
    });
    
    this.actionHandlers.set('wait', async (action, context) => {
      const config = (action as any).config;
      await new Promise(resolve => setTimeout(resolve, config.durationMs));
      return { waited: config.durationMs };
    });
    
    this.actionHandlers.set('run_tool', async (action, context) => {
      const config = (action as any).config;
      logger.info(`[RUN_TOOL] ${config.toolName}`, config.params);
      // In production, call tool via agent
      return { toolRun: true };
    });
    
    this.actionHandlers.set('webhook', async (action, context) => {
      const config = (action as any).config;
      // In production, make actual HTTP request
      logger.info(`[WEBHOOK] ${config.method} ${config.url}`);
      return { called: true };
    });
    
    this.actionHandlers.set('branch', async (action, context) => {
      const config = (action as any).config;
      const result = eval(config.condition);
      // Branch execution handled by orchestrator
      return { branch: result ? 'then' : 'else' };
    });
    
    this.actionHandlers.set('set_context', async (action, context) => {
      const config = (action as any).config;
      logger.info(`[SET_CONTEXT] ${config.contextType}:${config.contextName}`);
      // In production, integrate with COP
      return { contextSet: true };
    });
  }

  registerActionHandler(
    type: ActionType,
    handler: (action: Action, context: ExecutionContext) => Promise<unknown>
  ): void {
    this.actionHandlers.set(type, handler);
  }

  // --------------------------------------------------------------------------
  // PERSISTENCE
  // --------------------------------------------------------------------------

  private async loadPlaybooks(): Promise<void> {
    // In production, load from database
    logger.debug('Loading playbooks from storage...');
  }

  private async savePlaybook(playbook: Playbook): Promise<void> {
    // In production, save to database
    logger.debug(`Saving playbook ${playbook.id}...`);
  }

  // --------------------------------------------------------------------------
  // QUERIES
  // --------------------------------------------------------------------------

  getExecution(id: string): PlaybookExecution | undefined {
    return this.executions.get(id) || this.executionHistory.find(e => e.id === id);
  }

  getRunningExecutions(): PlaybookExecution[] {
    return Array.from(this.executions.values()).filter(e => e.status === 'running');
  }

  getExecutionHistory(playbookId?: string, limit = 100): PlaybookExecution[] {
    let history = [...this.executionHistory].reverse();
    
    if (playbookId) {
      history = history.filter(e => e.playbookId === playbookId);
    }
    
    return history.slice(0, limit);
  }

  getPlaybookStats(playbookId: string) {
    const playbook = this.playbooks.get(playbookId);
    if (!playbook) {
      return null;
    }
    
    const history = this.executionHistory.filter(e => e.playbookId === playbookId);
    const last24h = history.filter(e => e.startedAt.getTime() > Date.now() - 86400000);
    
    return {
      totalRuns: playbook.runCount,
      successRate: playbook.runCount > 0 ? playbook.successCount / playbook.runCount : 0,
      errorRate: playbook.runCount > 0 ? playbook.errorCount / playbook.runCount : 0,
      averageRunTimeMs: playbook.averageRunTimeMs,
      runsLast24h: last24h.length,
      lastRunAt: playbook.lastRunAt,
    };
  }
}

// ============================================================================
// TYPES
// ============================================================================

interface ExecutionContext {
  execution: PlaybookExecution;
  playbook: Playbook;
  variables: Record<string, unknown>;
}

// ============================================================================
// SINGLETON
// ============================================================================

let instance: PlaybookEngine | null = null;

export function getPlaybookEngine(): PlaybookEngine {
  if (!instance) {
    instance = new PlaybookEngine();
  }
  return instance;
}
