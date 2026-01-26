/**
 * AutomationRoutines.ts
 * 
 * JARVIS-style automated routines that run based on time, context, and user behavior.
 * Includes morning briefings, evening wind-down, work mode, and adaptive scenes.
 */

import { EventEmitter } from 'events';
import { BrowserWindow, powerMonitor, screen } from 'electron';
import { sleep } from '../../shared/utils';

export type RoutineType = 
  | 'morning_briefing'
  | 'evening_winddown'
  | 'work_mode'
  | 'break_reminder'
  | 'meeting_prep'
  | 'focus_mode'
  | 'sleep_mode'
  | 'away_mode'
  | 'return_greeting'
  | 'custom';

export type DayOfWeek = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';

export interface RoutineSchedule {
  enabled: boolean;
  time?: string; // HH:MM format
  days?: DayOfWeek[];
  trigger?: 'time' | 'event' | 'condition';
  eventType?: string;
  condition?: () => boolean;
}

export interface RoutineAction {
  type: 'speak' | 'notification' | 'theme_change' | 'system_command' | 'app_launch' | 'volume_adjust' | 'brightness_adjust';
  payload: Record<string, unknown>;
  delay?: number; // ms delay before action
}

export interface AutomationRoutine {
  id: string;
  name: string;
  type: RoutineType;
  description: string;
  schedule: RoutineSchedule;
  actions: RoutineAction[];
  priority: number; // Higher = more important
  cooldown?: number; // Minimum ms between executions
  lastExecuted?: number;
  enabled: boolean;
}

export interface SystemContext {
  hour: number;
  minute: number;
  dayOfWeek: DayOfWeek;
  isWeekend: boolean;
  isWorkHours: boolean;
  screenBrightness?: number;
  batteryLevel?: number;
  isOnBattery?: boolean;
  isLocked?: boolean;
  idleTime: number; // seconds
  activeWindow?: string;
  runningApps?: string[];
}

export interface AutomationConfig {
  enabled: boolean;
  workStartHour: number;
  workEndHour: number;
  breakIntervalMinutes: number;
  voiceEnabled: boolean;
  notificationsEnabled: boolean;
  adaptiveBrightness: boolean;
  userName?: string;
}

/**
 * JARVIS-style automation routines manager
 */
export class AutomationRoutinesManager extends EventEmitter {
  private routines: Map<string, AutomationRoutine> = new Map();
  private config: AutomationConfig;
  private checkInterval: NodeJS.Timeout | null = null;
  private lastBreakReminder: number = 0;
  private sessionStartTime: number = Date.now();
  private isUserAway: boolean = false;
  private awayStartTime: number = 0;
  
  constructor(config?: Partial<AutomationConfig>) {
    super();
    
    this.config = {
      enabled: true,
      workStartHour: 9,
      workEndHour: 17,
      breakIntervalMinutes: 45,
      voiceEnabled: true,
      notificationsEnabled: true,
      adaptiveBrightness: true,
      userName: 'Sir',
      ...config,
    };
    
    this.initializeDefaultRoutines();
    this.setupSystemMonitoring();
  }
  
  /**
   * Initialize default JARVIS-style routines
   */
  private initializeDefaultRoutines(): void {
    // Morning Briefing
    this.addRoutine({
      id: 'morning_briefing',
      name: 'Morning Briefing',
      type: 'morning_briefing',
      description: 'Good morning greeting with weather, calendar, and news summary',
      schedule: {
        enabled: true,
        time: '08:00',
        days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
        trigger: 'time',
      },
      actions: [
        {
          type: 'speak',
          payload: {
            template: 'morning_greeting',
            includeWeather: true,
            includeCalendar: true,
            includeNews: false,
          },
        },
        {
          type: 'theme_change',
          payload: { theme: 'jarvis', brightness: 0.8 },
          delay: 2000,
        },
      ],
      priority: 10,
      cooldown: 3600000, // 1 hour
      enabled: true,
    });
    
    // Weekend Morning (later, more relaxed)
    this.addRoutine({
      id: 'weekend_morning',
      name: 'Weekend Morning',
      type: 'morning_briefing',
      description: 'Relaxed weekend morning greeting',
      schedule: {
        enabled: true,
        time: '10:00',
        days: ['saturday', 'sunday'],
        trigger: 'time',
      },
      actions: [
        {
          type: 'speak',
          payload: {
            template: 'weekend_greeting',
            includeWeather: true,
          },
        },
      ],
      priority: 8,
      cooldown: 3600000,
      enabled: true,
    });
    
    // Work Mode Activation
    this.addRoutine({
      id: 'work_mode_start',
      name: 'Work Mode Start',
      type: 'work_mode',
      description: 'Activates focus mode during work hours',
      schedule: {
        enabled: true,
        time: '09:00',
        days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
        trigger: 'time',
      },
      actions: [
        {
          type: 'speak',
          payload: {
            text: `Activating work mode, ${this.config.userName}. I'll minimize distractions and monitor your productivity.`,
          },
        },
        {
          type: 'system_command',
          payload: { command: 'enable_focus_mode' },
        },
      ],
      priority: 9,
      cooldown: 28800000, // 8 hours
      enabled: true,
    });
    
    // Break Reminders
    this.addRoutine({
      id: 'break_reminder',
      name: 'Break Reminder',
      type: 'break_reminder',
      description: 'Reminds user to take regular breaks',
      schedule: {
        enabled: true,
        trigger: 'condition',
        condition: () => this.shouldRemindBreak(),
      },
      actions: [
        {
          type: 'speak',
          payload: {
            template: 'break_reminder',
          },
        },
        {
          type: 'notification',
          payload: {
            title: 'Break Time',
            body: 'You\'ve been working for a while. Consider taking a short break.',
            icon: 'break',
          },
        },
      ],
      priority: 7,
      cooldown: this.config.breakIntervalMinutes * 60000,
      enabled: true,
    });
    
    // Evening Wind-Down
    this.addRoutine({
      id: 'evening_winddown',
      name: 'Evening Wind-Down',
      type: 'evening_winddown',
      description: 'Transitions to evening mode with warmer colors',
      schedule: {
        enabled: true,
        time: '18:00',
        days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
        trigger: 'time',
      },
      actions: [
        {
          type: 'speak',
          payload: {
            template: 'evening_greeting',
          },
        },
        {
          type: 'theme_change',
          payload: { theme: 'sunset', brightness: 0.6 },
          delay: 1000,
        },
        {
          type: 'system_command',
          payload: { command: 'disable_focus_mode' },
        },
      ],
      priority: 8,
      cooldown: 3600000,
      enabled: true,
    });
    
    // Sleep Mode
    this.addRoutine({
      id: 'sleep_mode',
      name: 'Sleep Mode',
      type: 'sleep_mode',
      description: 'Late night mode with minimal interface',
      schedule: {
        enabled: true,
        time: '23:00',
        days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
        trigger: 'time',
      },
      actions: [
        {
          type: 'speak',
          payload: {
            text: `It's getting late, ${this.config.userName}. I'll dim the interface. Let me know if you need anything.`,
          },
        },
        {
          type: 'theme_change',
          payload: { theme: 'monochrome', brightness: 0.3 },
        },
        {
          type: 'volume_adjust',
          payload: { level: 0.3 },
        },
      ],
      priority: 6,
      cooldown: 28800000, // 8 hours
      enabled: true,
    });
    
    // Return Greeting (when user returns from being away)
    this.addRoutine({
      id: 'return_greeting',
      name: 'Return Greeting',
      type: 'return_greeting',
      description: 'Welcomes user back after being away',
      schedule: {
        enabled: true,
        trigger: 'event',
        eventType: 'user_return',
      },
      actions: [
        {
          type: 'speak',
          payload: {
            template: 'return_greeting',
          },
        },
      ],
      priority: 9,
      cooldown: 300000, // 5 minutes
      enabled: true,
    });
    
    // Focus Mode (user triggered)
    this.addRoutine({
      id: 'focus_mode',
      name: 'Focus Mode',
      type: 'focus_mode',
      description: 'Deep work mode with all distractions blocked',
      schedule: {
        enabled: true,
        trigger: 'event',
        eventType: 'focus_mode_requested',
      },
      actions: [
        {
          type: 'speak',
          payload: {
            text: `Entering focus mode. I'll hold all non-critical notifications and monitor your environment.`,
          },
        },
        {
          type: 'theme_change',
          payload: { theme: 'cosmic', brightness: 0.7 },
        },
        {
          type: 'system_command',
          payload: { command: 'enable_dnd' },
        },
      ],
      priority: 10,
      enabled: true,
    });
  }
  
  /**
   * Setup system monitoring for context-aware automation
   */
  private setupSystemMonitoring(): void {
    // Monitor system lock/unlock
    powerMonitor.on('lock-screen', () => {
      this.isUserAway = true;
      this.awayStartTime = Date.now();
      this.emit('user_away');
    });
    
    powerMonitor.on('unlock-screen', () => {
      const wasAway = this.isUserAway;
      const awayDuration = Date.now() - this.awayStartTime;
      
      this.isUserAway = false;
      
      // Only trigger return greeting if away for more than 5 minutes
      if (wasAway && awayDuration > 300000) {
        this.triggerEvent('user_return');
      }
    });
    
    // Monitor system suspend/resume
    powerMonitor.on('suspend', () => {
      this.isUserAway = true;
      this.awayStartTime = Date.now();
    });
    
    powerMonitor.on('resume', () => {
      const wasAway = this.isUserAway;
      const awayDuration = Date.now() - this.awayStartTime;
      
      this.isUserAway = false;
      
      if (wasAway && awayDuration > 300000) {
        this.triggerEvent('user_return');
      }
    });
    
    // Start periodic check
    this.startPeriodicCheck();
  }
  
  /**
   * Start periodic routine checking
   */
  private startPeriodicCheck(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }
    
    // Check every minute
    this.checkInterval = setInterval(() => {
      if (this.config.enabled) {
        this.checkScheduledRoutines();
        this.checkConditionalRoutines();
      }
    }, 60000);
    
    // Initial check
    this.checkScheduledRoutines();
  }
  
  /**
   * Check and execute scheduled routines
   */
  private checkScheduledRoutines(): void {
    const context = this.getSystemContext();
    const now = Date.now();
    const currentTime = `${String(context.hour).padStart(2, '0')}:${String(context.minute).padStart(2, '0')}`;
    
    for (const routine of this.routines.values()) {
      if (!routine.enabled || !routine.schedule.enabled) continue;
      if (routine.schedule.trigger !== 'time') continue;
      
      // Check time match
      if (routine.schedule.time !== currentTime) continue;
      
      // Check day match
      if (routine.schedule.days && !routine.schedule.days.includes(context.dayOfWeek)) continue;
      
      // Check cooldown
      if (routine.cooldown && routine.lastExecuted) {
        if (now - routine.lastExecuted < routine.cooldown) continue;
      }
      
      this.executeRoutine(routine);
    }
  }
  
  /**
   * Check and execute conditional routines
   */
  private checkConditionalRoutines(): void {
    const now = Date.now();
    
    for (const routine of this.routines.values()) {
      if (!routine.enabled || !routine.schedule.enabled) continue;
      if (routine.schedule.trigger !== 'condition') continue;
      if (!routine.schedule.condition) continue;
      
      // Check cooldown
      if (routine.cooldown && routine.lastExecuted) {
        if (now - routine.lastExecuted < routine.cooldown) continue;
      }
      
      // Check condition
      if (routine.schedule.condition()) {
        this.executeRoutine(routine);
      }
    }
  }
  
  /**
   * Trigger an event-based routine
   */
  triggerEvent(eventType: string): void {
    const now = Date.now();
    
    for (const routine of this.routines.values()) {
      if (!routine.enabled || !routine.schedule.enabled) continue;
      if (routine.schedule.trigger !== 'event') continue;
      if (routine.schedule.eventType !== eventType) continue;
      
      // Check cooldown
      if (routine.cooldown && routine.lastExecuted) {
        if (now - routine.lastExecuted < routine.cooldown) continue;
      }
      
      this.executeRoutine(routine);
    }
  }
  
  /**
   * Execute a routine's actions
   */
  private async executeRoutine(routine: AutomationRoutine): Promise<void> {
    console.log(`[AutomationRoutines] Executing routine: ${routine.name}`);
    
    routine.lastExecuted = Date.now();
    
    for (const action of routine.actions) {
      if (action.delay) {
        await this.delay(action.delay);
      }
      
      await this.executeAction(action, routine);
    }
    
    this.emit('routine_executed', { routine });
  }
  
  /**
   * Execute a single action
   */
  private async executeAction(action: RoutineAction, routine: AutomationRoutine): Promise<void> {
    const context = this.getSystemContext();
    
    switch (action.type) {
      case 'speak':
        if (this.config.voiceEnabled) {
          const text = this.processTemplate(action.payload, context);
          this.emit('speak', { text, routine });
        }
        break;
        
      case 'notification':
        if (this.config.notificationsEnabled) {
          this.emit('notification', { ...action.payload, routine });
        }
        break;
        
      case 'theme_change':
        this.emit('theme_change', action.payload);
        break;
        
      case 'system_command':
        this.emit('system_command', action.payload);
        break;
        
      case 'app_launch':
        this.emit('app_launch', action.payload);
        break;
        
      case 'volume_adjust':
        this.emit('volume_adjust', action.payload);
        break;
        
      case 'brightness_adjust':
        this.emit('brightness_adjust', action.payload);
        break;
    }
  }
  
  /**
   * Process a speech template with context
   */
  private processTemplate(payload: Record<string, unknown>, context: SystemContext): string {
    const template = payload.template as string | undefined;
    const text = payload.text as string | undefined;
    
    if (text) return text;
    
    switch (template) {
      case 'morning_greeting':
        return this.getMorningGreeting(context);
      case 'weekend_greeting':
        return this.getWeekendGreeting(context);
      case 'evening_greeting':
        return this.getEveningGreeting(context);
      case 'break_reminder':
        return this.getBreakReminder(context);
      case 'return_greeting':
        return this.getReturnGreeting(context);
      default:
        return `Routine activated, ${this.config.userName}.`;
    }
  }
  
  /**
   * Generate morning greeting
   */
  private getMorningGreeting(context: SystemContext): string {
    const greetings = [
      `Good morning, ${this.config.userName}. All systems are operational. Shall I brief you on today's schedule?`,
      `Good morning. The time is ${context.hour}:${String(context.minute).padStart(2, '0')}. Ready to begin your day, ${this.config.userName}?`,
      `Rise and shine, ${this.config.userName}. I've prepared your morning briefing whenever you're ready.`,
    ];
    return greetings[Math.floor(Math.random() * greetings.length)];
  }
  
  /**
   * Generate weekend greeting
   */
  private getWeekendGreeting(context: SystemContext): string {
    const day = context.dayOfWeek.charAt(0).toUpperCase() + context.dayOfWeek.slice(1);
    const greetings = [
      `Good morning, ${this.config.userName}. Happy ${day}. No pressing appointments detected. How may I assist you today?`,
      `Good morning. I hope you're enjoying your ${day}. Systems standing by, ${this.config.userName}.`,
    ];
    return greetings[Math.floor(Math.random() * greetings.length)];
  }
  
  /**
   * Generate evening greeting
   */
  private getEveningGreeting(context: SystemContext): string {
    const greetings = [
      `Good evening, ${this.config.userName}. Transitioning to evening mode. You've had a productive day.`,
      `The sun is setting, ${this.config.userName}. Shall I dim the interface and prepare for evening activities?`,
      `Evening, ${this.config.userName}. Work hours have concluded. Adjusting ambient settings.`,
    ];
    return greetings[Math.floor(Math.random() * greetings.length)];
  }
  
  /**
   * Generate break reminder
   */
  private getBreakReminder(context: SystemContext): string {
    const elapsed = Math.round((Date.now() - this.lastBreakReminder) / 60000);
    const reminders = [
      `${this.config.userName}, you've been working for ${elapsed} minutes. Perhaps a short break would be beneficial?`,
      `May I suggest a brief respite, ${this.config.userName}? Extended screen time can be taxing.`,
      `${this.config.userName}, a moment of rest often improves cognitive performance. Just a suggestion.`,
    ];
    return reminders[Math.floor(Math.random() * reminders.length)];
  }
  
  /**
   * Generate return greeting
   */
  private getReturnGreeting(context: SystemContext): string {
    const awayMinutes = Math.round((Date.now() - this.awayStartTime) / 60000);
    
    if (awayMinutes < 30) {
      return `Welcome back, ${this.config.userName}. You were away for ${awayMinutes} minutes. All systems nominal.`;
    } else if (awayMinutes < 120) {
      return `Welcome back, ${this.config.userName}. I've kept watch. Shall I summarize any notifications?`;
    } else {
      const hours = Math.round(awayMinutes / 60);
      return `Good to see you again, ${this.config.userName}. You've been away for ${hours} hours. Ready to resume?`;
    }
  }
  
  /**
   * Check if break reminder should trigger
   */
  private shouldRemindBreak(): boolean {
    const context = this.getSystemContext();
    
    // Only during work hours
    if (!context.isWorkHours) return false;
    
    // Only if user is active (not idle)
    if (context.idleTime > 300) return false;
    
    // Check time since last break
    const timeSinceBreak = Date.now() - this.lastBreakReminder;
    const breakInterval = this.config.breakIntervalMinutes * 60000;
    
    if (timeSinceBreak >= breakInterval) {
      this.lastBreakReminder = Date.now();
      return true;
    }
    
    return false;
  }
  
  /**
   * Get current system context
   */
  getSystemContext(): SystemContext {
    const now = new Date();
    const days: DayOfWeek[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const dayOfWeek = days[now.getDay()];
    const hour = now.getHours();
    
    return {
      hour,
      minute: now.getMinutes(),
      dayOfWeek,
      isWeekend: dayOfWeek === 'saturday' || dayOfWeek === 'sunday',
      isWorkHours: hour >= this.config.workStartHour && hour < this.config.workEndHour,
      idleTime: powerMonitor.getSystemIdleTime(),
      isLocked: false, // Would need native module to detect
    };
  }
  
  /**
   * Add a routine
   */
  addRoutine(routine: AutomationRoutine): void {
    this.routines.set(routine.id, routine);
    this.emit('routine_added', { routine });
  }
  
  /**
   * Remove a routine
   */
  removeRoutine(id: string): boolean {
    const deleted = this.routines.delete(id);
    if (deleted) {
      this.emit('routine_removed', { id });
    }
    return deleted;
  }
  
  /**
   * Enable/disable a routine
   */
  setRoutineEnabled(id: string, enabled: boolean): void {
    const routine = this.routines.get(id);
    if (routine) {
      routine.enabled = enabled;
      this.emit('routine_updated', { routine });
    }
  }
  
  /**
   * Get all routines
   */
  getRoutines(): AutomationRoutine[] {
    return Array.from(this.routines.values());
  }
  
  /**
   * Get a specific routine
   */
  getRoutine(id: string): AutomationRoutine | undefined {
    return this.routines.get(id);
  }
  
  /**
   * Update configuration
   */
  updateConfig(config: Partial<AutomationConfig>): void {
    this.config = { ...this.config, ...config };
    this.emit('config_updated', { config: this.config });
  }
  
  /**
   * Get current configuration
   */
  getConfig(): AutomationConfig {
    return { ...this.config };
  }
  
  /**
   * Manually trigger a routine by ID
   */
  async triggerRoutine(id: string): Promise<boolean> {
    const routine = this.routines.get(id);
    if (routine && routine.enabled) {
      await this.executeRoutine(routine);
      return true;
    }
    return false;
  }
  
  /**
   * Stop all monitoring
   */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }
  
  /**
   * Utility: delay execution
   */
  private delay(ms: number): Promise<void> {
    return sleep(ms);
  }
}

// Singleton instance
let automationManager: AutomationRoutinesManager | null = null;

export function getAutomationManager(config?: Partial<AutomationConfig>): AutomationRoutinesManager {
  if (!automationManager) {
    automationManager = new AutomationRoutinesManager(config);
  }
  return automationManager;
}

export default AutomationRoutinesManager;
