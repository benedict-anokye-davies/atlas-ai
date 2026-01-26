/**
 * Atlas Desktop - Smart Scheduler
 * Optimize task scheduling based on patterns
 *
 * Features:
 * - Optimal time slot detection
 * - Productivity pattern learning
 * - Task priority optimization
 * - Calendar integration
 * - Focus time protection
 *
 * @module ml/smart-scheduler
 */

import { EventEmitter } from 'events';
import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('SmartScheduler');

// ============================================================================
// Types
// ============================================================================

export interface ScheduledTask {
  id: string;
  title: string;
  description?: string;
  priority: 'high' | 'medium' | 'low';
  estimatedDuration: number; // minutes
  deadline?: number;
  category: string;
  scheduledTime?: number;
  completedAt?: number;
  status: 'pending' | 'scheduled' | 'in-progress' | 'completed' | 'missed';
  tags: string[];
  context?: Record<string, unknown>;
}

export interface TimeSlot {
  start: number;
  end: number;
  score: number;
  type: 'focus' | 'meetings' | 'breaks' | 'flexible';
  available: boolean;
}

export interface ProductivityPattern {
  hourlyScores: number[]; // 24 hours
  weekdayScores: number[]; // 7 days
  categoryPatterns: Map<string, number[]>; // category -> hourly scores
  focusHours: number[];
  breakPatterns: number[];
  averageTaskDuration: Map<string, number>;
}

export interface ScheduleSuggestion {
  task: ScheduledTask;
  suggestedTime: number;
  score: number;
  reason: string;
  alternativeTimes: number[];
}

export interface SmartSchedulerConfig {
  workdayStart: number; // hour (0-23)
  workdayEnd: number;
  focusBlockDuration: number; // minutes
  breakDuration: number;
  minProductivityThreshold: number;
  lookAheadDays: number;
}

export interface SmartSchedulerEvents {
  'schedule-suggested': (suggestion: ScheduleSuggestion) => void;
  'task-scheduled': (task: ScheduledTask) => void;
  'task-reminder': (task: ScheduledTask) => void;
  'productivity-updated': (pattern: ProductivityPattern) => void;
  error: (error: Error) => void;
}

// ============================================================================
// Smart Scheduler
// ============================================================================

export class SmartScheduler extends EventEmitter {
  private config: SmartSchedulerConfig;
  private tasks: Map<string, ScheduledTask> = new Map();
  private productivityPattern: ProductivityPattern;
  private blockedSlots: TimeSlot[] = [];
  private dataPath: string;

  // Stats
  private stats = {
    tasksScheduled: 0,
    tasksCompleted: 0,
    tasksMissed: 0,
    suggestionsAccepted: 0,
    avgAccuracy: 0,
  };

  constructor(config?: Partial<SmartSchedulerConfig>) {
    super();
    this.config = {
      workdayStart: 9,
      workdayEnd: 18,
      focusBlockDuration: 90,
      breakDuration: 15,
      minProductivityThreshold: 0.5,
      lookAheadDays: 7,
      ...config,
    };

    this.productivityPattern = this.createDefaultPattern();
    this.dataPath = path.join(app.getPath('userData'), 'scheduler-data.json');
    this.loadData();

    // Set up reminder check
    setInterval(() => this.checkReminders(), 60000);

    logger.info('SmartScheduler initialized', { config: this.config });
  }

  // ============================================================================
  // Data Persistence
  // ============================================================================

  private loadData(): void {
    try {
      if (fs.existsSync(this.dataPath)) {
        const data = JSON.parse(fs.readFileSync(this.dataPath, 'utf-8'));

        for (const task of data.tasks || []) {
          this.tasks.set(task.id, task);
        }

        if (data.productivityPattern) {
          this.productivityPattern = {
            ...data.productivityPattern,
            categoryPatterns: new Map(Object.entries(data.productivityPattern.categoryPatterns || {})),
            averageTaskDuration: new Map(Object.entries(data.productivityPattern.averageTaskDuration || {})),
          };
        }

        this.blockedSlots = data.blockedSlots || [];

        logger.info('Loaded scheduler data', { tasks: this.tasks.size });
      }
    } catch (error) {
      logger.warn('Failed to load scheduler data', { error });
    }
  }

  private saveData(): void {
    try {
      const data = {
        tasks: Array.from(this.tasks.values()),
        productivityPattern: {
          ...this.productivityPattern,
          categoryPatterns: Object.fromEntries(this.productivityPattern.categoryPatterns),
          averageTaskDuration: Object.fromEntries(this.productivityPattern.averageTaskDuration),
        },
        blockedSlots: this.blockedSlots,
        savedAt: Date.now(),
      };
      fs.writeFileSync(this.dataPath, JSON.stringify(data, null, 2));
    } catch (error) {
      logger.warn('Failed to save scheduler data', { error });
    }
  }

  /**
   * Create default productivity pattern
   */
  private createDefaultPattern(): ProductivityPattern {
    // Default pattern: higher productivity in morning, dip after lunch, recovery in afternoon
    const hourlyScores = [
      0.1, 0.1, 0.1, 0.1, 0.1, 0.2, 0.4, 0.6, // 0-7
      0.8, 0.9, 0.95, 0.9, 0.7, 0.6, 0.7, 0.8, // 8-15
      0.75, 0.6, 0.4, 0.3, 0.2, 0.15, 0.1, 0.1, // 16-23
    ];

    // Weekday pattern: lower on weekends
    const weekdayScores = [0.3, 0.9, 0.95, 1.0, 0.95, 0.85, 0.3];

    return {
      hourlyScores,
      weekdayScores,
      categoryPatterns: new Map(),
      focusHours: [9, 10, 11, 14, 15, 16],
      breakPatterns: [12, 13, 17],
      averageTaskDuration: new Map(),
    };
  }

  // ============================================================================
  // Task Management
  // ============================================================================

  /**
   * Add a task
   */
  addTask(task: Omit<ScheduledTask, 'id' | 'status'>): ScheduledTask {
    const fullTask: ScheduledTask = {
      ...task,
      id: this.generateId('task'),
      status: 'pending',
    };

    this.tasks.set(fullTask.id, fullTask);
    this.saveData();

    // Auto-schedule if no time specified
    if (!fullTask.scheduledTime) {
      const suggestion = this.suggestTimeSlot(fullTask);
      if (suggestion) {
        this.emit('schedule-suggested', suggestion);
      }
    }

    return fullTask;
  }

  /**
   * Update a task
   */
  updateTask(taskId: string, updates: Partial<ScheduledTask>): ScheduledTask | null {
    const task = this.tasks.get(taskId);
    if (!task) return null;

    Object.assign(task, updates);
    this.saveData();

    return task;
  }

  /**
   * Complete a task
   */
  completeTask(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    task.status = 'completed';
    task.completedAt = Date.now();

    // Update productivity patterns
    this.updateProductivityFromCompletion(task);

    this.stats.tasksCompleted++;
    this.saveData();
  }

  /**
   * Delete a task
   */
  deleteTask(taskId: string): boolean {
    const deleted = this.tasks.delete(taskId);
    if (deleted) {
      this.saveData();
    }
    return deleted;
  }

  /**
   * Schedule a task
   */
  scheduleTask(taskId: string, time: number): ScheduledTask | null {
    const task = this.tasks.get(taskId);
    if (!task) return null;

    task.scheduledTime = time;
    task.status = 'scheduled';

    this.stats.tasksScheduled++;
    this.emit('task-scheduled', task);
    this.saveData();

    return task;
  }

  // ============================================================================
  // Time Slot Suggestion
  // ============================================================================

  /**
   * Suggest optimal time slot for a task
   */
  suggestTimeSlot(task: ScheduledTask): ScheduleSuggestion | null {
    const slots = this.getAvailableSlots(task.estimatedDuration, this.config.lookAheadDays);
    if (slots.length === 0) return null;

    // Score each slot
    const scoredSlots = slots.map((slot) => ({
      slot,
      score: this.scoreSlot(slot, task),
    }));

    scoredSlots.sort((a, b) => b.score - a.score);

    const best = scoredSlots[0];
    const alternatives = scoredSlots.slice(1, 4).map((s) => s.slot.start);

    return {
      task,
      suggestedTime: best.slot.start,
      score: best.score,
      reason: this.generateReason(best.slot, task),
      alternativeTimes: alternatives,
    };
  }

  /**
   * Get available time slots
   */
  getAvailableSlots(durationMinutes: number, daysAhead: number): TimeSlot[] {
    const slots: TimeSlot[] = [];
    const now = Date.now();
    const endTime = now + daysAhead * 24 * 60 * 60 * 1000;

    // Generate potential slots
    let currentTime = this.roundToNextHour(now);

    while (currentTime < endTime) {
      const date = new Date(currentTime);
      const hour = date.getHours();
      const day = date.getDay();

      // Check if within work hours
      if (hour >= this.config.workdayStart && hour < this.config.workdayEnd) {
        const slotEnd = currentTime + durationMinutes * 60 * 1000;

        // Check if slot is available
        const isBlocked = this.isTimeBlocked(currentTime, slotEnd);
        const isConflicting = this.hasConflictingTask(currentTime, slotEnd);

        if (!isBlocked && !isConflicting) {
          const productivityScore =
            this.productivityPattern.hourlyScores[hour] * this.productivityPattern.weekdayScores[day];

          const isFocusTime = this.productivityPattern.focusHours.includes(hour);
          const isBreakTime = this.productivityPattern.breakPatterns.includes(hour);

          slots.push({
            start: currentTime,
            end: slotEnd,
            score: productivityScore,
            type: isFocusTime ? 'focus' : isBreakTime ? 'breaks' : 'flexible',
            available: true,
          });
        }
      }

      // Move to next slot (30-minute intervals)
      currentTime += 30 * 60 * 1000;
    }

    return slots;
  }

  /**
   * Score a time slot for a specific task
   */
  private scoreSlot(slot: TimeSlot, task: ScheduledTask): number {
    let score = slot.score;
    const date = new Date(slot.start);
    const hour = date.getHours();

    // Priority multiplier
    const priorityMultipliers = { high: 1.2, medium: 1.0, low: 0.8 };
    score *= priorityMultipliers[task.priority];

    // Category-specific patterns
    const categoryScores = this.productivityPattern.categoryPatterns.get(task.category);
    if (categoryScores) {
      score *= categoryScores[hour];
    }

    // Focus time bonus for complex tasks
    if (task.estimatedDuration > 60 && slot.type === 'focus') {
      score *= 1.3;
    }

    // Deadline proximity bonus
    if (task.deadline) {
      const timeToDeadline = task.deadline - slot.start;
      const daysToDeadline = timeToDeadline / (24 * 60 * 60 * 1000);

      if (daysToDeadline < 1) {
        score *= 1.5; // Urgent
      } else if (daysToDeadline < 3) {
        score *= 1.2; // Soon
      }
    }

    // Prefer earlier times for similar scores
    const hoursFromNow = (slot.start - Date.now()) / (60 * 60 * 1000);
    score *= 1 - hoursFromNow * 0.001;

    return score;
  }

  /**
   * Generate reason for suggestion
   */
  private generateReason(slot: TimeSlot, task: ScheduledTask): string {
    const date = new Date(slot.start);
    const hour = date.getHours();
    const reasons: string[] = [];

    if (slot.type === 'focus') {
      reasons.push('During your peak focus time');
    }

    if (this.productivityPattern.hourlyScores[hour] > 0.8) {
      reasons.push('High productivity period');
    }

    if (task.deadline) {
      const daysToDeadline = (task.deadline - slot.start) / (24 * 60 * 60 * 1000);
      if (daysToDeadline < 2) {
        reasons.push('Before deadline');
      }
    }

    const categoryScores = this.productivityPattern.categoryPatterns.get(task.category);
    if (categoryScores && categoryScores[hour] > 0.8) {
      reasons.push(`Good time for ${task.category} tasks`);
    }

    return reasons.length > 0 ? reasons.join('. ') : 'Based on your schedule';
  }

  // ============================================================================
  // Productivity Learning
  // ============================================================================

  /**
   * Update productivity patterns from task completion
   */
  private updateProductivityFromCompletion(task: ScheduledTask): void {
    if (!task.scheduledTime || !task.completedAt) return;

    const scheduledDate = new Date(task.scheduledTime);
    const hour = scheduledDate.getHours();
    const day = scheduledDate.getDay();

    // Calculate completion metrics
    const actualDuration = task.completedAt - task.scheduledTime;
    const expectedDuration = task.estimatedDuration * 60 * 1000;
    const efficiency = Math.min(expectedDuration / actualDuration, 1.5);

    // Update hourly scores with exponential moving average
    const lr = 0.1;
    this.productivityPattern.hourlyScores[hour] =
      this.productivityPattern.hourlyScores[hour] * (1 - lr) + efficiency * lr;

    // Update weekday scores
    this.productivityPattern.weekdayScores[day] =
      this.productivityPattern.weekdayScores[day] * (1 - lr) + efficiency * lr;

    // Update category patterns
    if (!this.productivityPattern.categoryPatterns.has(task.category)) {
      this.productivityPattern.categoryPatterns.set(task.category, new Array(24).fill(0.5));
    }
    const categoryScores = this.productivityPattern.categoryPatterns.get(task.category)!;
    categoryScores[hour] = categoryScores[hour] * (1 - lr) + efficiency * lr;

    // Update average task duration
    const currentAvg = this.productivityPattern.averageTaskDuration.get(task.category) || task.estimatedDuration;
    this.productivityPattern.averageTaskDuration.set(
      task.category,
      currentAvg * (1 - lr) + (actualDuration / 60000) * lr
    );

    // Update accuracy stats
    const accuracy = Math.abs(efficiency - 1);
    this.stats.avgAccuracy = this.stats.avgAccuracy * 0.9 + (1 - accuracy) * 0.1;

    this.emit('productivity-updated', this.productivityPattern);
    this.saveData();
  }

  /**
   * Record productivity observation
   */
  recordProductivityObservation(
    hour: number,
    score: number,
    category?: string
  ): void {
    const lr = 0.05;

    this.productivityPattern.hourlyScores[hour] =
      this.productivityPattern.hourlyScores[hour] * (1 - lr) + score * lr;

    if (category) {
      if (!this.productivityPattern.categoryPatterns.has(category)) {
        this.productivityPattern.categoryPatterns.set(category, new Array(24).fill(0.5));
      }
      const categoryScores = this.productivityPattern.categoryPatterns.get(category)!;
      categoryScores[hour] = categoryScores[hour] * (1 - lr) + score * lr;
    }

    this.saveData();
  }

  // ============================================================================
  // Calendar Integration
  // ============================================================================

  /**
   * Block time slot
   */
  blockTimeSlot(start: number, end: number, type: TimeSlot['type'] = 'meetings'): void {
    this.blockedSlots.push({
      start,
      end,
      score: 0,
      type,
      available: false,
    });

    // Remove overlapping blocks
    this.blockedSlots = this.mergeOverlappingSlots(this.blockedSlots);
    this.saveData();
  }

  /**
   * Unblock time slot
   */
  unblockTimeSlot(start: number, end: number): void {
    this.blockedSlots = this.blockedSlots.filter(
      (slot) => !(slot.start >= start && slot.end <= end)
    );
    this.saveData();
  }

  /**
   * Check if time is blocked
   */
  private isTimeBlocked(start: number, end: number): boolean {
    return this.blockedSlots.some(
      (slot) => (start >= slot.start && start < slot.end) || (end > slot.start && end <= slot.end)
    );
  }

  /**
   * Check for conflicting tasks
   */
  private hasConflictingTask(start: number, end: number): boolean {
    for (const task of this.tasks.values()) {
      if (task.status !== 'scheduled' || !task.scheduledTime) continue;

      const taskEnd = task.scheduledTime + task.estimatedDuration * 60 * 1000;
      if (
        (start >= task.scheduledTime && start < taskEnd) ||
        (end > task.scheduledTime && end <= taskEnd)
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Merge overlapping time slots
   */
  private mergeOverlappingSlots(slots: TimeSlot[]): TimeSlot[] {
    if (slots.length <= 1) return slots;

    slots.sort((a, b) => a.start - b.start);
    const merged: TimeSlot[] = [slots[0]];

    for (let i = 1; i < slots.length; i++) {
      const current = slots[i];
      const last = merged[merged.length - 1];

      if (current.start <= last.end) {
        last.end = Math.max(last.end, current.end);
      } else {
        merged.push(current);
      }
    }

    return merged;
  }

  // ============================================================================
  // Reminders
  // ============================================================================

  /**
   * Check for upcoming task reminders
   */
  private checkReminders(): void {
    const now = Date.now();
    const reminderWindow = 15 * 60 * 1000; // 15 minutes

    for (const task of this.tasks.values()) {
      if (task.status !== 'scheduled' || !task.scheduledTime) continue;

      const timeUntil = task.scheduledTime - now;
      if (timeUntil > 0 && timeUntil <= reminderWindow) {
        this.emit('task-reminder', task);
        task.status = 'in-progress';
        this.saveData();
      } else if (timeUntil < -reminderWindow && task.status === 'scheduled') {
        task.status = 'missed';
        this.stats.tasksMissed++;
        this.saveData();
      }
    }
  }

  // ============================================================================
  // Utilities
  // ============================================================================

  private generateId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private roundToNextHour(timestamp: number): number {
    const date = new Date(timestamp);
    date.setMinutes(0, 0, 0);
    date.setHours(date.getHours() + 1);
    return date.getTime();
  }

  /**
   * Get task by ID
   */
  getTask(taskId: string): ScheduledTask | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * Get all tasks
   */
  getAllTasks(): ScheduledTask[] {
    return Array.from(this.tasks.values());
  }

  /**
   * Get tasks for date
   */
  getTasksForDate(date: Date): ScheduledTask[] {
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setHours(23, 59, 59, 999);

    return Array.from(this.tasks.values()).filter(
      (task) =>
        task.scheduledTime && task.scheduledTime >= dayStart.getTime() && task.scheduledTime <= dayEnd.getTime()
    );
  }

  /**
   * Get productivity pattern
   */
  getProductivityPattern(): ProductivityPattern {
    return this.productivityPattern;
  }

  /**
   * Get statistics
   */
  getStats(): {
    tasksScheduled: number;
    tasksCompleted: number;
    tasksMissed: number;
    suggestionsAccepted: number;
    avgAccuracy: number;
    totalTasks: number;
    completionRate: number;
  } {
    const total = this.stats.tasksCompleted + this.stats.tasksMissed;
    return {
      ...this.stats,
      totalTasks: this.tasks.size,
      completionRate: total > 0 ? this.stats.tasksCompleted / total : 0,
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<SmartSchedulerConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('Config updated', { config: this.config });
  }
}

// ============================================================================
// Singleton
// ============================================================================

let smartScheduler: SmartScheduler | null = null;

export function getSmartScheduler(): SmartScheduler {
  if (!smartScheduler) {
    smartScheduler = new SmartScheduler();
  }
  return smartScheduler;
}
