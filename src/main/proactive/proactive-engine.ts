/**
 * Atlas Proactive Engine
 *
 * Makes JARVIS proactive - initiates conversations based on:
 * - Time-based triggers (morning briefing, study reminders)
 * - Context-based triggers (unusual activity, opportunities)
 * - Pattern-based triggers (learned behaviors)
 * - Event-based triggers (market moves, deadlines)
 *
 * @module proactive/proactive-engine
 */

import { createModuleLogger } from '../utils/logger';
import { sleep } from '../../shared/utils';
import { EventEmitter } from 'events';
import { getJarvisBrain } from '../cognitive';
import { getDiscordService } from '../integrations/discord';
import { getTTSManager } from '../tts/manager';

const logger = createModuleLogger('ProactiveEngine');

// ============================================================================
// Types
// ============================================================================

export interface ProactiveTrigger {
  id: string;
  type: 'time' | 'context' | 'pattern' | 'event';
  name: string;
  description: string;
  condition: TriggerCondition;
  action: ProactiveAction;
  enabled: boolean;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  cooldown: number; // Minimum ms between triggers
  lastTriggered?: number;
}

export type TriggerCondition = 
  | TimeCondition
  | ContextCondition
  | PatternCondition
  | EventCondition;

export interface TimeCondition {
  type: 'time';
  schedule: {
    hour: number;
    minute: number;
    days?: number[]; // 0-6, Sunday=0
  };
  tolerance: number; // Minutes
}

export interface ContextCondition {
  type: 'context';
  rules: Array<{
    variable: string;
    operator: 'eq' | 'gt' | 'lt' | 'contains' | 'exists';
    value: unknown;
  }>;
  allRequired: boolean;
}

export interface PatternCondition {
  type: 'pattern';
  patternId: string;
  confidence: number; // Minimum confidence 0-1
}

export interface EventCondition {
  type: 'event';
  eventName: string;
  filter?: Record<string, unknown>;
}

export interface ProactiveAction {
  type: 'speak' | 'notify' | 'suggest' | 'alert' | 'execute';
  message: string;
  data?: Record<string, unknown>;
  followUp?: ProactiveAction;
}

export interface ProactiveContext {
  time: Date;
  dayOfWeek: number;
  hour: number;
  minute: number;
  isWeekend: boolean;
  
  // User context
  lastInteraction?: number;
  currentActivity?: string;
  focusMode?: boolean;
  
  // System context
  tradingBotActive: boolean;
  studySessionActive: boolean;
  pendingNotifications: number;
  
  // Dynamic context
  customVariables: Record<string, unknown>;
}

export interface ProactiveMessage {
  triggerId: string;
  triggerName: string;
  priority: ProactiveTrigger['priority'];
  action: ProactiveAction;
  timestamp: number;
  context: ProactiveContext;
}

// ============================================================================
// Default Triggers
// ============================================================================

const DEFAULT_TRIGGERS: Omit<ProactiveTrigger, 'id'>[] = [
  // Morning Briefing
  {
    type: 'time',
    name: 'Morning Briefing',
    description: 'Daily morning briefing with schedule and priorities',
    condition: {
      type: 'time',
      schedule: { hour: 8, minute: 0 },
      tolerance: 30,
    },
    action: {
      type: 'speak',
      message: 'Good morning! Let me give you today\'s briefing.',
      data: { briefingType: 'morning' },
    },
    enabled: true,
    priority: 'medium',
    cooldown: 6 * 60 * 60 * 1000, // 6 hours
  },

  // Study Reminder
  {
    type: 'time',
    name: 'Study Reminder',
    description: 'Remind to review flashcards',
    condition: {
      type: 'time',
      schedule: { hour: 14, minute: 0 },
      tolerance: 60,
    },
    action: {
      type: 'notify',
      message: 'You have flashcards due for review. Shall we start a study session?',
      data: { action: 'startStudy' },
    },
    enabled: true,
    priority: 'medium',
    cooldown: 4 * 60 * 60 * 1000, // 4 hours
  },

  // Evening Review
  {
    type: 'time',
    name: 'Evening Review',
    description: 'Daily summary and reflection',
    condition: {
      type: 'time',
      schedule: { hour: 21, minute: 0 },
      tolerance: 60,
    },
    action: {
      type: 'speak',
      message: 'Time for our evening review. Let\'s see what we accomplished today.',
      data: { briefingType: 'evening' },
    },
    enabled: true,
    priority: 'low',
    cooldown: 12 * 60 * 60 * 1000, // 12 hours
  },

  // Long Inactivity Check
  {
    type: 'context',
    name: 'Check-In',
    description: 'Check in after long inactivity',
    condition: {
      type: 'context',
      rules: [
        { variable: 'lastInteraction', operator: 'lt', value: Date.now() - 4 * 60 * 60 * 1000 },
        { variable: 'focusMode', operator: 'eq', value: false },
      ],
      allRequired: true,
    },
    action: {
      type: 'speak',
      message: 'Hey! Just checking in. Need any help with anything?',
    },
    enabled: true,
    priority: 'low',
    cooldown: 4 * 60 * 60 * 1000,
  },

  // Trading Opportunity
  {
    type: 'event',
    name: 'Trading Opportunity',
    description: 'Alert on significant trading opportunities',
    condition: {
      type: 'event',
      eventName: 'trading:opportunity',
      filter: { confidence: { $gt: 0.7 } },
    },
    action: {
      type: 'alert',
      message: 'I spotted a potential trading opportunity.',
      data: { showDetails: true },
    },
    enabled: true,
    priority: 'high',
    cooldown: 15 * 60 * 1000, // 15 minutes
  },

  // Large Market Move
  {
    type: 'event',
    name: 'Market Alert',
    description: 'Alert on significant market movements',
    condition: {
      type: 'event',
      eventName: 'market:significant_move',
    },
    action: {
      type: 'alert',
      message: 'Significant market movement detected!',
      data: { urgent: true },
    },
    enabled: true,
    priority: 'urgent',
    cooldown: 5 * 60 * 1000, // 5 minutes
  },

  // Weekend Planning
  {
    type: 'time',
    name: 'Weekend Planning',
    description: 'Friday evening planning session',
    condition: {
      type: 'time',
      schedule: { hour: 18, minute: 0, days: [5] }, // Friday
      tolerance: 60,
    },
    action: {
      type: 'suggest',
      message: 'It\'s Friday! Let\'s plan your weekend and set some goals.',
      data: { action: 'weekendPlanning' },
    },
    enabled: true,
    priority: 'medium',
    cooldown: 7 * 24 * 60 * 60 * 1000, // 1 week
  },

  // Break Reminder
  {
    type: 'context',
    name: 'Break Reminder',
    description: 'Remind to take breaks during long sessions',
    condition: {
      type: 'context',
      rules: [
        { variable: 'sessionDuration', operator: 'gt', value: 90 * 60 * 1000 }, // 90 minutes
        { variable: 'lastBreak', operator: 'lt', value: Date.now() - 60 * 60 * 1000 },
      ],
      allRequired: true,
    },
    action: {
      type: 'notify',
      message: 'You\'ve been working for a while. Time for a short break?',
    },
    enabled: true,
    priority: 'medium',
    cooldown: 60 * 60 * 1000, // 1 hour
  },
];

// ============================================================================
// Proactive Engine
// ============================================================================

export class ProactiveEngine extends EventEmitter {
  private triggers: Map<string, ProactiveTrigger> = new Map();
  private context: ProactiveContext;
  private checkInterval: NodeJS.Timeout | null = null;
  private eventListeners: Map<string, ((data: unknown) => void)[]> = new Map();
  private messageQueue: ProactiveMessage[] = [];
  private isProcessing: boolean = false;
  private enabled: boolean = true;

  constructor() {
    super();
    
    this.context = this.createInitialContext();
    this.loadDefaultTriggers();
    
    logger.info('ProactiveEngine initialized', { triggers: this.triggers.size });
  }

  private createInitialContext(): ProactiveContext {
    const now = new Date();
    return {
      time: now,
      dayOfWeek: now.getDay(),
      hour: now.getHours(),
      minute: now.getMinutes(),
      isWeekend: now.getDay() === 0 || now.getDay() === 6,
      tradingBotActive: false,
      studySessionActive: false,
      pendingNotifications: 0,
      customVariables: {},
    };
  }

  private loadDefaultTriggers(): void {
    for (const trigger of DEFAULT_TRIGGERS) {
      this.addTrigger(trigger);
    }
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  start(): void {
    if (this.checkInterval) {
      logger.warn('ProactiveEngine already running');
      return;
    }

    // Check triggers every minute
    this.checkInterval = setInterval(() => {
      this.checkTriggers();
    }, 60 * 1000);

    // Initial check
    this.checkTriggers();

    logger.info('ProactiveEngine started');
    this.emit('started');
  }

  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    logger.info('ProactiveEngine stopped');
    this.emit('stopped');
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    logger.info('ProactiveEngine enabled state changed', { enabled });
  }

  // ==========================================================================
  // Trigger Management
  // ==========================================================================

  addTrigger(trigger: Omit<ProactiveTrigger, 'id'>): ProactiveTrigger {
    const newTrigger: ProactiveTrigger = {
      ...trigger,
      id: `trigger-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    };

    this.triggers.set(newTrigger.id, newTrigger);
    
    // If it's an event trigger, set up listener
    if (trigger.condition.type === 'event') {
      this.setupEventListener(newTrigger);
    }

    logger.debug('Trigger added', { id: newTrigger.id, name: newTrigger.name });
    return newTrigger;
  }

  removeTrigger(id: string): void {
    this.triggers.delete(id);
    logger.debug('Trigger removed', { id });
  }

  enableTrigger(id: string, enabled: boolean): void {
    const trigger = this.triggers.get(id);
    if (trigger) {
      trigger.enabled = enabled;
      logger.debug('Trigger enabled state changed', { id, enabled });
    }
  }

  getTriggers(): ProactiveTrigger[] {
    return Array.from(this.triggers.values());
  }

  // ==========================================================================
  // Context Management
  // ==========================================================================

  updateContext(updates: Partial<ProactiveContext>): void {
    this.context = { ...this.context, ...updates };
  }

  setContextVariable(key: string, value: unknown): void {
    this.context.customVariables[key] = value;
  }

  getContext(): ProactiveContext {
    return { ...this.context };
  }

  recordInteraction(): void {
    this.context.lastInteraction = Date.now();
  }

  // ==========================================================================
  // Trigger Checking
  // ==========================================================================

  private async checkTriggers(): Promise<void> {
    if (!this.enabled) return;

    // Update time context
    const now = new Date();
    this.context.time = now;
    this.context.dayOfWeek = now.getDay();
    this.context.hour = now.getHours();
    this.context.minute = now.getMinutes();
    this.context.isWeekend = now.getDay() === 0 || now.getDay() === 6;

    for (const trigger of this.triggers.values()) {
      if (!trigger.enabled) continue;
      
      // Check cooldown
      if (trigger.lastTriggered && 
          Date.now() - trigger.lastTriggered < trigger.cooldown) {
        continue;
      }

      // Skip event triggers (handled separately)
      if (trigger.condition.type === 'event') continue;

      if (await this.evaluateCondition(trigger.condition)) {
        this.fireTrigger(trigger);
      }
    }
  }

  private async evaluateCondition(condition: TriggerCondition): Promise<boolean> {
    switch (condition.type) {
      case 'time':
        return this.evaluateTimeCondition(condition);
      case 'context':
        return this.evaluateContextCondition(condition);
      case 'pattern':
        return await this.evaluatePatternCondition(condition);
      default:
        return false;
    }
  }

  private evaluateTimeCondition(condition: TimeCondition): boolean {
    const { schedule, tolerance } = condition;
    
    // Check day of week if specified
    if (schedule.days && !schedule.days.includes(this.context.dayOfWeek)) {
      return false;
    }

    // Check time within tolerance
    const scheduledMinutes = schedule.hour * 60 + schedule.minute;
    const currentMinutes = this.context.hour * 60 + this.context.minute;
    const diff = Math.abs(scheduledMinutes - currentMinutes);

    return diff <= tolerance;
  }

  private evaluateContextCondition(condition: ContextCondition): boolean {
    const results = condition.rules.map(rule => {
      const value = this.getContextValue(rule.variable);
      return this.evaluateRule(value, rule.operator, rule.value);
    });

    return condition.allRequired 
      ? results.every(r => r)
      : results.some(r => r);
  }

  private getContextValue(variable: string): unknown {
    if (variable in this.context) {
      return (this.context as unknown as Record<string, unknown>)[variable];
    }
    return this.context.customVariables[variable];
  }

  private evaluateRule(value: unknown, operator: string, expected: unknown): boolean {
    switch (operator) {
      case 'eq':
        return value === expected;
      case 'gt':
        return typeof value === 'number' && typeof expected === 'number' && value > expected;
      case 'lt':
        return typeof value === 'number' && typeof expected === 'number' && value < expected;
      case 'contains':
        return typeof value === 'string' && typeof expected === 'string' && value.includes(expected);
      case 'exists':
        return value !== undefined && value !== null;
      default:
        return false;
    }
  }

  private async evaluatePatternCondition(condition: PatternCondition): Promise<boolean> {
    const brain = getJarvisBrain();
    if (!brain) return false;

    // Query brain for pattern recognition
    // This is a placeholder - actual implementation would query the brain
    const result = await brain.recall(condition.patternId);
    return result.facts.length > 0;
  }

  private setupEventListener(trigger: ProactiveTrigger): void {
    if (trigger.condition.type !== 'event') return;

    const eventName = trigger.condition.eventName;
    const listener = (data: unknown) => {
      // Check filter if specified
      const condition = trigger.condition as EventCondition;
      if (condition.filter && !this.matchesFilter(data, condition.filter)) {
        return;
      }

      // Check cooldown
      if (trigger.lastTriggered && 
          Date.now() - trigger.lastTriggered < trigger.cooldown) {
        return;
      }

      this.fireTrigger(trigger, data);
    };

    // Store listener for cleanup
    if (!this.eventListeners.has(eventName)) {
      this.eventListeners.set(eventName, []);
    }
    this.eventListeners.get(eventName)!.push(listener);

    // Subscribe to event
    this.on(eventName, listener);
  }

  private matchesFilter(data: unknown, filter: Record<string, unknown>): boolean {
    if (typeof data !== 'object' || data === null) return false;
    
    const dataObj = data as Record<string, unknown>;
    
    for (const [key, expectedValue] of Object.entries(filter)) {
      if (typeof expectedValue === 'object' && expectedValue !== null) {
        // Handle operators like $gt, $lt
        const ops = expectedValue as Record<string, unknown>;
        const actualValue = dataObj[key];
        
        if ('$gt' in ops && !(typeof actualValue === 'number' && actualValue > (ops.$gt as number))) {
          return false;
        }
        if ('$lt' in ops && !(typeof actualValue === 'number' && actualValue < (ops.$lt as number))) {
          return false;
        }
      } else if (dataObj[key] !== expectedValue) {
        return false;
      }
    }
    
    return true;
  }

  // ==========================================================================
  // Trigger Firing
  // ==========================================================================

  private fireTrigger(trigger: ProactiveTrigger, eventData?: unknown): void {
    trigger.lastTriggered = Date.now();

    const message: ProactiveMessage = {
      triggerId: trigger.id,
      triggerName: trigger.name,
      priority: trigger.priority,
      action: {
        ...trigger.action,
        data: { ...trigger.action.data, eventData },
      },
      timestamp: Date.now(),
      context: { ...this.context },
    };

    this.messageQueue.push(message);
    
    // Sort by priority
    this.messageQueue.sort((a, b) => {
      const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });

    // Learn to brain
    const brain = getJarvisBrain();
    if (brain) {
      brain.learn({
        subject: 'Proactive trigger',
        predicate: 'fired',
        object: trigger.name,
        confidence: trigger.priority === 'urgent' ? 0.9 : 0.5,
        source: 'proactive-engine',
      });
    }

    this.processQueue();
    logger.info('Trigger fired', { name: trigger.name, priority: trigger.priority });
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.messageQueue.length === 0) return;

    this.isProcessing = true;

    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift()!;
      await this.executeAction(message);
      
      // Small delay between actions
      await sleep(500);
    }

    this.isProcessing = false;
  }

  private async executeAction(message: ProactiveMessage): Promise<void> {
    const { action, triggerName, priority } = message;

    logger.debug('Executing proactive action', { 
      type: action.type, 
      trigger: triggerName 
    });

    switch (action.type) {
      case 'speak':
        // Actually speak via TTS
        try {
          const tts = getTTSManager();
          tts.speak(action.message, priority === 'urgent' ? 10 : priority === 'high' ? 5 : 1);
        } catch (err) {
          logger.error('Failed to speak proactive message', { error: (err as Error).message });
        }
        this.emit('speak', {
          text: action.message,
          priority,
          data: action.data,
        });
        break;

      case 'notify':
        // Speak the notification via TTS
        try {
          const tts = getTTSManager();
          tts.speak(action.message, priority === 'urgent' ? 10 : priority === 'high' ? 5 : 1);
        } catch (err) {
          logger.error('Failed to speak notification', { error: (err as Error).message });
        }
        // Send to Discord if connected
        const discord = getDiscordService();
        if (discord.getStatus().connected) {
          await discord.sendNotification({
            type: 'reminder',
            title: triggerName,
            message: action.message,
            urgent: priority === 'urgent',
          });
        }
        this.emit('notify', {
          title: triggerName,
          message: action.message,
          priority,
          data: action.data,
        });
        break;

      case 'suggest':
        // Speak the suggestion via TTS
        try {
          const tts = getTTSManager();
          tts.speak(action.message, 1);
        } catch (err) {
          logger.error('Failed to speak suggestion', { error: (err as Error).message });
        }
        this.emit('suggest', {
          text: action.message,
          data: action.data,
        });
        break;

      case 'alert':
        // Speak the alert via TTS with high priority
        try {
          const tts = getTTSManager();
          tts.speak(action.message, 10);
        } catch (err) {
          logger.error('Failed to speak alert', { error: (err as Error).message });
        }
        // Urgent notification
        const alertDiscord = getDiscordService();
        if (alertDiscord.getStatus().connected) {
          await alertDiscord.sendNotification({
            type: 'alert',
            title: `⚠️ ${triggerName}`,
            message: action.message,
            urgent: true,
          });
        }
        this.emit('alert', {
          title: triggerName,
          message: action.message,
          data: action.data,
        });
        break;

      case 'execute':
        this.emit('execute', action.data);
        break;
    }

    // Handle follow-up if exists
    if (action.followUp) {
      await sleep(2000);
      await this.executeAction({
        ...message,
        action: action.followUp,
      });
    }
  }

  // ==========================================================================
  // Event Emission (for external events)
  // ==========================================================================

  emitEvent(eventName: string, data?: unknown): void {
    this.emit(eventName, data);
    logger.debug('Event emitted', { eventName });
  }

  // ==========================================================================
  // Briefing Generation
  // ==========================================================================

  async generateBriefing(type: 'morning' | 'evening'): Promise<{
    greeting: string;
    summary: string;
    items: Array<{ category: string; content: string }>;
    suggestions: string[];
  }> {
    const hour = new Date().getHours();
    const greeting = type === 'morning' 
      ? hour < 12 ? 'Good morning!' : 'Good afternoon!'
      : 'Good evening!';

    const items: Array<{ category: string; content: string }> = [];
    const suggestions: string[] = [];

    // Get data from brain
    const brain = getJarvisBrain();
    
    if (type === 'morning') {
      // Morning briefing
      items.push({ 
        category: '📅 Schedule', 
        content: 'No lectures today' // Would integrate with calendar
      });
      
      items.push({ 
        category: '📚 Study', 
        content: 'You have flashcards due for review'
      });
      
      items.push({ 
        category: '📈 Markets', 
        content: 'Markets are open. Trading bot is monitoring.'
      });

      suggestions.push('Start with your most important task');
      suggestions.push('Review flashcards during lunch');
      
    } else {
      // Evening briefing
      items.push({ 
        category: '✅ Completed', 
        content: 'Tasks completed today will be listed here'
      });
      
      items.push({ 
        category: '📊 Trading', 
        content: 'Daily P/L summary'
      });

      suggestions.push('Plan tomorrow\'s priorities');
      suggestions.push('Get some rest!');
    }

    if (brain) {
      const recentResult = await brain.recall('recent learning');
      if (recentResult.facts.length > 0) {
        items.push({
          category: '🧠 Recent Learning',
          content: recentResult.facts[0].label,
        });
      }
    }

    const summary = type === 'morning'
      ? 'Here\'s what\'s on your radar today.'
      : 'Here\'s a summary of your day.';

    return { greeting, summary, items, suggestions };
  }
}

// ============================================================================
// Singleton
// ============================================================================

let proactiveEngineInstance: ProactiveEngine | null = null;

export function getProactiveEngine(): ProactiveEngine {
  if (!proactiveEngineInstance) {
    proactiveEngineInstance = new ProactiveEngine();
  }
  return proactiveEngineInstance;
}

export function initializeProactiveEngine(): ProactiveEngine {
  proactiveEngineInstance = new ProactiveEngine();
  return proactiveEngineInstance;
}
