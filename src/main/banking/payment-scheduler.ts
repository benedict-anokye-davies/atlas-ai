/**
 * Atlas Banking - Payment Scheduler
 *
 * Schedule future payments and recurring transfers.
 * Supports one-time and recurring schedules with reminders.
 *
 * @module banking/payment-scheduler
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import { app } from 'electron';
import { join } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';

const logger = createModuleLogger('PaymentScheduler');

/**
 * Scheduled payment frequency
 */
export type ScheduleFrequency = 'once' | 'weekly' | 'fortnightly' | 'monthly' | 'quarterly' | 'yearly';

/**
 * Scheduled payment status
 */
export type ScheduleStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';

/**
 * Scheduled payment
 */
export interface ScheduledPayment {
  id: string;
  recipientName: string;
  recipientSortCode: string;
  recipientAccountNumber: string;
  amount: number;
  currency: string;
  reference: string;
  frequency: ScheduleFrequency;
  nextPaymentDate: number;
  lastPaymentDate?: number;
  endDate?: number;
  totalPayments?: number;
  paymentsCompleted: number;
  status: ScheduleStatus;
  reminderDays: number; // Days before payment to remind
  createdAt: number;
  updatedAt: number;
  notes?: string;
  history: Array<{
    date: number;
    status: 'completed' | 'failed';
    error?: string;
  }>;
}

/**
 * Payment reminder
 */
export interface PaymentReminder {
  id: string;
  paymentId: string;
  recipientName: string;
  amount: number;
  paymentDate: number;
  daysUntil: number;
  acknowledged: boolean;
  createdAt: number;
}

/**
 * Payment Scheduler
 */
export class PaymentScheduler extends EventEmitter {
  private schedules: Map<string, ScheduledPayment> = new Map();
  private reminders: PaymentReminder[] = [];
  private dataPath: string;
  private checkInterval: NodeJS.Timeout | null = null;

  constructor() {
    super();
    this.dataPath = join(app.getPath('userData'), 'banking');
    this.loadData();
  }

  /**
   * Load scheduler data
   */
  private loadData(): void {
    try {
      const filePath = join(this.dataPath, 'scheduled-payments.json');
      if (existsSync(filePath)) {
        const data = JSON.parse(readFileSync(filePath, 'utf-8'));
        this.schedules = new Map(Object.entries(data.schedules || {}));
        this.reminders = data.reminders || [];
        logger.info('Loaded scheduled payments', { count: this.schedules.size });
      }
    } catch (error) {
      logger.warn('Failed to load scheduled payments', { error: (error as Error).message });
    }
  }

  /**
   * Save scheduler data
   */
  private saveData(): void {
    try {
      if (!existsSync(this.dataPath)) {
        mkdirSync(this.dataPath, { recursive: true });
      }
      const filePath = join(this.dataPath, 'scheduled-payments.json');
      const data = {
        schedules: Object.fromEntries(this.schedules),
        reminders: this.reminders.slice(-100),
      };
      writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch (error) {
      logger.error('Failed to save scheduled payments', { error: (error as Error).message });
    }
  }

  /**
   * Schedule a new payment
   */
  schedulePayment(options: {
    recipientName: string;
    recipientSortCode: string;
    recipientAccountNumber: string;
    amount: number;
    currency?: string;
    reference: string;
    frequency: ScheduleFrequency;
    firstPaymentDate: Date | number;
    endDate?: Date | number;
    totalPayments?: number;
    reminderDays?: number;
    notes?: string;
  }): ScheduledPayment {
    const firstDate =
      typeof options.firstPaymentDate === 'number'
        ? options.firstPaymentDate
        : options.firstPaymentDate.getTime();

    const schedule: ScheduledPayment = {
      id: `sched_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      recipientName: options.recipientName,
      recipientSortCode: options.recipientSortCode.replace(/[^0-9]/g, ''),
      recipientAccountNumber: options.recipientAccountNumber.replace(/[^0-9]/g, ''),
      amount: options.amount,
      currency: options.currency || 'GBP',
      reference: options.reference,
      frequency: options.frequency,
      nextPaymentDate: firstDate,
      endDate: options.endDate
        ? typeof options.endDate === 'number'
          ? options.endDate
          : options.endDate.getTime()
        : undefined,
      totalPayments: options.totalPayments,
      paymentsCompleted: 0,
      status: 'pending',
      reminderDays: options.reminderDays ?? 3,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      notes: options.notes,
      history: [],
    };

    this.schedules.set(schedule.id, schedule);
    this.saveData();

    logger.info('Scheduled payment', {
      id: schedule.id,
      recipient: schedule.recipientName,
      amount: schedule.amount,
      frequency: schedule.frequency,
    });

    this.emit('scheduled', schedule);
    return schedule;
  }

  /**
   * Update a scheduled payment
   */
  updateSchedule(
    id: string,
    updates: Partial<Omit<ScheduledPayment, 'id' | 'createdAt' | 'history'>>
  ): ScheduledPayment | null {
    const schedule = this.schedules.get(id);
    if (!schedule) return null;

    Object.assign(schedule, updates, { updatedAt: Date.now() });
    this.schedules.set(id, schedule);
    this.saveData();

    this.emit('updated', schedule);
    return schedule;
  }

  /**
   * Cancel a scheduled payment
   */
  cancelSchedule(id: string): boolean {
    const schedule = this.schedules.get(id);
    if (!schedule) return false;

    schedule.status = 'cancelled';
    schedule.updatedAt = Date.now();
    this.saveData();

    this.emit('cancelled', schedule);
    return true;
  }

  /**
   * Delete a scheduled payment
   */
  deleteSchedule(id: string): boolean {
    const deleted = this.schedules.delete(id);
    if (deleted) {
      this.saveData();
      this.emit('deleted', id);
    }
    return deleted;
  }

  /**
   * Get a scheduled payment
   */
  getSchedule(id: string): ScheduledPayment | undefined {
    return this.schedules.get(id);
  }

  /**
   * Get all scheduled payments
   */
  getSchedules(options?: {
    status?: ScheduleStatus;
    frequency?: ScheduleFrequency;
    upcoming?: boolean;
  }): ScheduledPayment[] {
    let schedules = Array.from(this.schedules.values());

    if (options?.status) {
      schedules = schedules.filter((s) => s.status === options.status);
    }
    if (options?.frequency) {
      schedules = schedules.filter((s) => s.frequency === options.frequency);
    }
    if (options?.upcoming) {
      const now = Date.now();
      schedules = schedules.filter(
        (s) => s.status === 'pending' && s.nextPaymentDate > now
      );
    }

    return schedules.sort((a, b) => a.nextPaymentDate - b.nextPaymentDate);
  }

  /**
   * Get payments due soon
   */
  getDuePayments(withinDays: number = 7): ScheduledPayment[] {
    const now = Date.now();
    const cutoff = now + withinDays * 24 * 60 * 60 * 1000;

    return this.getSchedules({ status: 'pending' }).filter(
      (s) => s.nextPaymentDate <= cutoff
    );
  }

  /**
   * Calculate next payment date based on frequency
   */
  private calculateNextDate(current: number, frequency: ScheduleFrequency): number {
    const date = new Date(current);

    switch (frequency) {
      case 'once':
        return 0; // No next payment
      case 'weekly':
        date.setDate(date.getDate() + 7);
        break;
      case 'fortnightly':
        date.setDate(date.getDate() + 14);
        break;
      case 'monthly':
        date.setMonth(date.getMonth() + 1);
        break;
      case 'quarterly':
        date.setMonth(date.getMonth() + 3);
        break;
      case 'yearly':
        date.setFullYear(date.getFullYear() + 1);
        break;
    }

    return date.getTime();
  }

  /**
   * Process due payments (call this with your payment execution function)
   */
  async processDuePayments(
    executePaymentFn: (schedule: ScheduledPayment) => Promise<{ success: boolean; error?: string }>
  ): Promise<{
    processed: number;
    successful: number;
    failed: number;
    results: Array<{ scheduleId: string; success: boolean; error?: string }>;
  }> {
    const now = Date.now();
    const duePayments = this.getSchedules({ status: 'pending' }).filter(
      (s) => s.nextPaymentDate <= now
    );

    const results: Array<{ scheduleId: string; success: boolean; error?: string }> = [];
    let successful = 0;
    let failed = 0;

    for (const schedule of duePayments) {
      schedule.status = 'processing';
      this.emit('processing', schedule);

      try {
        const result = await executePaymentFn(schedule);

        schedule.history.push({
          date: Date.now(),
          status: result.success ? 'completed' : 'failed',
          error: result.error,
        });

        if (result.success) {
          successful++;
          schedule.paymentsCompleted++;
          schedule.lastPaymentDate = Date.now();

          // Check if schedule should continue
          const shouldContinue = this.shouldContinueSchedule(schedule);

          if (shouldContinue) {
            schedule.nextPaymentDate = this.calculateNextDate(
              schedule.nextPaymentDate,
              schedule.frequency
            );
            schedule.status = 'pending';
          } else {
            schedule.status = 'completed';
          }

          this.emit('paymentCompleted', schedule);
        } else {
          failed++;
          schedule.status = 'failed';
          this.emit('paymentFailed', { schedule, error: result.error });
        }

        results.push({
          scheduleId: schedule.id,
          success: result.success,
          error: result.error,
        });
      } catch (error) {
        failed++;
        schedule.status = 'failed';
        schedule.history.push({
          date: Date.now(),
          status: 'failed',
          error: (error as Error).message,
        });
        results.push({
          scheduleId: schedule.id,
          success: false,
          error: (error as Error).message,
        });
        this.emit('paymentFailed', { schedule, error: (error as Error).message });
      }

      schedule.updatedAt = Date.now();
    }

    this.saveData();

    return {
      processed: duePayments.length,
      successful,
      failed,
      results,
    };
  }

  /**
   * Check if schedule should continue
   */
  private shouldContinueSchedule(schedule: ScheduledPayment): boolean {
    // One-time payment
    if (schedule.frequency === 'once') return false;

    // Check end date
    if (schedule.endDate && schedule.nextPaymentDate >= schedule.endDate) {
      return false;
    }

    // Check total payments
    if (
      schedule.totalPayments !== undefined &&
      schedule.paymentsCompleted >= schedule.totalPayments
    ) {
      return false;
    }

    return true;
  }

  /**
   * Check for reminders and generate them
   */
  checkReminders(): PaymentReminder[] {
    const newReminders: PaymentReminder[] = [];
    const now = Date.now();

    for (const schedule of this.schedules.values()) {
      if (schedule.status !== 'pending') continue;
      if (schedule.reminderDays === 0) continue;

      const reminderTime = schedule.nextPaymentDate - schedule.reminderDays * 24 * 60 * 60 * 1000;
      const daysUntil = Math.ceil(
        (schedule.nextPaymentDate - now) / (24 * 60 * 60 * 1000)
      );

      // Check if reminder should be sent
      if (now >= reminderTime && daysUntil > 0) {
        // Check for existing reminder
        const existing = this.reminders.find(
          (r) =>
            r.paymentId === schedule.id &&
            Math.abs(r.paymentDate - schedule.nextPaymentDate) < 1000 &&
            !r.acknowledged
        );

        if (!existing) {
          const reminder: PaymentReminder = {
            id: `rem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            paymentId: schedule.id,
            recipientName: schedule.recipientName,
            amount: schedule.amount,
            paymentDate: schedule.nextPaymentDate,
            daysUntil,
            acknowledged: false,
            createdAt: Date.now(),
          };

          this.reminders.push(reminder);
          newReminders.push(reminder);
          this.emit('reminder', reminder);
        }
      }
    }

    if (newReminders.length > 0) {
      this.saveData();
    }

    return newReminders;
  }

  /**
   * Get pending reminders
   */
  getPendingReminders(): PaymentReminder[] {
    return this.reminders.filter((r) => !r.acknowledged);
  }

  /**
   * Acknowledge reminder
   */
  acknowledgeReminder(reminderId: string): boolean {
    const reminder = this.reminders.find((r) => r.id === reminderId);
    if (reminder) {
      reminder.acknowledged = true;
      this.saveData();
      return true;
    }
    return false;
  }

  /**
   * Start automatic checking
   */
  startScheduler(
    executePaymentFn?: (
      schedule: ScheduledPayment
    ) => Promise<{ success: boolean; error?: string }>,
    intervalMs: number = 60 * 60 * 1000 // Check every hour
  ): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }

    this.checkInterval = setInterval(async () => {
      // Check reminders
      this.checkReminders();

      // Process due payments if executor provided
      if (executePaymentFn) {
        try {
          await this.processDuePayments(executePaymentFn);
        } catch (error) {
          logger.error('Error processing scheduled payments', {
            error: (error as Error).message,
          });
        }
      }
    }, intervalMs);

    logger.info('Started payment scheduler', { intervalMs });
  }

  /**
   * Stop automatic checking
   */
  stopScheduler(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
      logger.info('Stopped payment scheduler');
    }
  }

  /**
   * Get summary of scheduled payments
   */
  getSummary(): {
    totalScheduled: number;
    pending: number;
    completed: number;
    failed: number;
    monthlyCommitted: number;
    upcomingTotal: number;
    nextPaymentDate: number | null;
  } {
    const schedules = Array.from(this.schedules.values());
    const pending = schedules.filter((s) => s.status === 'pending');

    // Calculate monthly committed
    let monthlyCommitted = 0;
    for (const schedule of pending) {
      let monthlyAmount = schedule.amount;
      switch (schedule.frequency) {
        case 'weekly':
          monthlyAmount *= 4.33;
          break;
        case 'fortnightly':
          monthlyAmount *= 2.17;
          break;
        case 'quarterly':
          monthlyAmount /= 3;
          break;
        case 'yearly':
          monthlyAmount /= 12;
          break;
      }
      monthlyCommitted += monthlyAmount;
    }

    // Calculate upcoming total (next 30 days)
    const thirtyDays = Date.now() + 30 * 24 * 60 * 60 * 1000;
    const upcomingTotal = pending
      .filter((s) => s.nextPaymentDate <= thirtyDays)
      .reduce((sum, s) => sum + s.amount, 0);

    // Find next payment date
    const nextPayment = pending.sort((a, b) => a.nextPaymentDate - b.nextPaymentDate)[0];

    return {
      totalScheduled: schedules.length,
      pending: pending.length,
      completed: schedules.filter((s) => s.status === 'completed').length,
      failed: schedules.filter((s) => s.status === 'failed').length,
      monthlyCommitted,
      upcomingTotal,
      nextPaymentDate: nextPayment?.nextPaymentDate || null,
    };
  }

  /**
   * Quick schedule for common recurring payments
   */
  scheduleRecurring(
    recipientName: string,
    sortCode: string,
    accountNumber: string,
    amount: number,
    reference: string,
    dayOfMonth: number = 1
  ): ScheduledPayment {
    const now = new Date();
    let firstPayment = new Date(now.getFullYear(), now.getMonth(), dayOfMonth);

    // If day has passed this month, schedule for next month
    if (firstPayment.getTime() < now.getTime()) {
      firstPayment.setMonth(firstPayment.getMonth() + 1);
    }

    return this.schedulePayment({
      recipientName,
      recipientSortCode: sortCode,
      recipientAccountNumber: accountNumber,
      amount,
      reference,
      frequency: 'monthly',
      firstPaymentDate: firstPayment,
      reminderDays: 3,
    });
  }
}

// Singleton instance
let scheduler: PaymentScheduler | null = null;

export function getPaymentScheduler(): PaymentScheduler {
  if (!scheduler) {
    scheduler = new PaymentScheduler();
  }
  return scheduler;
}
