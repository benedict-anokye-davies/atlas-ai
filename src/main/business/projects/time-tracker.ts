/**
 * Atlas Desktop - Time Tracker
 * Voice-activated time logging and timer management
 *
 * @module business/projects/time-tracker
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { homedir } from 'os';
import { createModuleLogger } from '../../utils/logger';
import { TimeEntry, ActiveTimer } from '../types';

const logger = createModuleLogger('TimeTracker');

/**
 * Time Tracker Events
 */
export interface TimeTrackerEvents {
  'timer-started': (timer: ActiveTimer) => void;
  'timer-stopped': (entry: TimeEntry) => void;
  'timer-tick': (timer: ActiveTimer, elapsedMinutes: number) => void;
  'entry-created': (entry: TimeEntry) => void;
  'entry-updated': (entry: TimeEntry) => void;
}

/**
 * Time entry filters
 */
export interface TimeEntryFilters {
  projectId?: string;
  clientId?: string;
  startDate?: Date;
  endDate?: Date;
  billable?: boolean;
  invoiced?: boolean;
}

/**
 * Time Tracker
 * Handles time logging and active timers for AtlasAgency
 */
export class TimeTracker extends EventEmitter {
  private entries: Map<string, TimeEntry> = new Map();
  private activeTimer: ActiveTimer | null = null;
  private timerInterval: NodeJS.Timeout | null = null;
  private dataDir: string;
  private initialized = false;

  constructor() {
    super();
    this.dataDir = path.join(homedir(), '.atlas', 'business');
  }

  /**
   * Initialize the time tracker
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      await fs.mkdir(this.dataDir, { recursive: true });
      await this.loadData();
      this.initialized = true;
      logger.info('TimeTracker initialized', { entryCount: this.entries.size });
    } catch (error) {
      logger.error('Failed to initialize TimeTracker', { error: (error as Error).message });
      throw error;
    }
  }

  /**
   * Load data from disk
   */
  private async loadData(): Promise<void> {
    const entriesPath = path.join(this.dataDir, 'time-entries.json');
    const timerPath = path.join(this.dataDir, 'active-timer.json');

    try {
      const entriesData = await fs.readFile(entriesPath, 'utf-8');
      const entries = JSON.parse(entriesData) as TimeEntry[];
      for (const entry of entries) {
        entry.date = new Date(entry.date);
        if (entry.startTime) entry.startTime = new Date(entry.startTime);
        if (entry.endTime) entry.endTime = new Date(entry.endTime);
        this.entries.set(entry.id, entry);
      }
    } catch {
      // File doesn't exist, start fresh
    }

    try {
      const timerData = await fs.readFile(timerPath, 'utf-8');
      const timer = JSON.parse(timerData) as ActiveTimer;
      if (timer && timer.startedAt) {
        timer.startedAt = new Date(timer.startedAt);
        this.activeTimer = timer;
        this.startTimerInterval();
        logger.info('Restored active timer', { projectId: timer.projectId });
      }
    } catch {
      // No active timer
    }
  }

  /**
   * Save data to disk
   */
  private async saveData(): Promise<void> {
    const entriesPath = path.join(this.dataDir, 'time-entries.json');
    const timerPath = path.join(this.dataDir, 'active-timer.json');

    await fs.writeFile(entriesPath, JSON.stringify([...this.entries.values()], null, 2));
    
    if (this.activeTimer) {
      await fs.writeFile(timerPath, JSON.stringify(this.activeTimer, null, 2));
    } else {
      try {
        await fs.unlink(timerPath);
      } catch {
        // File doesn't exist
      }
    }
  }

  // ============================================================
  // Timer Management
  // ============================================================

  /**
   * Start a timer for a project
   */
  async startTimer(data: {
    projectId: string;
    clientId: string;
    description?: string;
    billable?: boolean;
  }): Promise<ActiveTimer> {
    // Stop any existing timer first
    if (this.activeTimer) {
      await this.stopTimer();
    }

    this.activeTimer = {
      projectId: data.projectId,
      clientId: data.clientId,
      description: data.description || '',
      startedAt: new Date(),
      billable: data.billable ?? true,
    };

    this.startTimerInterval();
    await this.saveData();

    this.emit('timer-started', this.activeTimer);
    logger.info('Timer started', { projectId: data.projectId });

    return this.activeTimer;
  }

  /**
   * Stop the active timer and create a time entry
   */
  async stopTimer(description?: string): Promise<TimeEntry | null> {
    if (!this.activeTimer) return null;

    const timer = this.activeTimer;
    const endTime = new Date();
    const durationMs = endTime.getTime() - new Date(timer.startedAt).getTime();
    const hours = durationMs / (1000 * 60 * 60);

    // Create time entry
    const entry: TimeEntry = {
      id: randomUUID(),
      projectId: timer.projectId,
      clientId: timer.clientId,
      description: description || timer.description,
      date: new Date(timer.startedAt),
      hours: Math.round(hours * 100) / 100, // Round to 2 decimal places
      startTime: timer.startedAt,
      endTime,
      billable: timer.billable,
      invoiced: false,
    };

    this.entries.set(entry.id, entry);
    this.stopTimerInterval();
    this.activeTimer = null;

    await this.saveData();

    this.emit('timer-stopped', entry);
    this.emit('entry-created', entry);
    logger.info('Timer stopped', { entryId: entry.id, hours: entry.hours });

    return entry;
  }

  /**
   * Get the active timer
   */
  getActiveTimer(): ActiveTimer | null {
    return this.activeTimer;
  }

  /**
   * Get elapsed time for active timer in minutes
   */
  getElapsedMinutes(): number {
    if (!this.activeTimer) return 0;
    const now = new Date();
    const start = new Date(this.activeTimer.startedAt);
    return Math.floor((now.getTime() - start.getTime()) / (1000 * 60));
  }

  /**
   * Get elapsed time formatted as HH:MM:SS
   */
  getElapsedFormatted(): string {
    if (!this.activeTimer) return '00:00:00';
    
    const now = new Date();
    const start = new Date(this.activeTimer.startedAt);
    const elapsed = Math.floor((now.getTime() - start.getTime()) / 1000);
    
    const hours = Math.floor(elapsed / 3600);
    const minutes = Math.floor((elapsed % 3600) / 60);
    const seconds = elapsed % 60;
    
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }

  /**
   * Check if a timer is running
   */
  isTimerRunning(): boolean {
    return this.activeTimer !== null;
  }

  /**
   * Update timer description while running
   */
  async updateTimerDescription(description: string): Promise<void> {
    if (this.activeTimer) {
      this.activeTimer.description = description;
      await this.saveData();
    }
  }

  private startTimerInterval(): void {
    this.stopTimerInterval();
    this.timerInterval = setInterval(() => {
      if (this.activeTimer) {
        const minutes = this.getElapsedMinutes();
        this.emit('timer-tick', this.activeTimer, minutes);
      }
    }, 60000); // Tick every minute
  }

  private stopTimerInterval(): void {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  // ============================================================
  // Manual Time Entry
  // ============================================================

  /**
   * Create a manual time entry
   */
  async createEntry(data: {
    projectId: string;
    clientId: string;
    description: string;
    date: Date;
    hours: number;
    billable?: boolean;
  }): Promise<TimeEntry> {
    const entry: TimeEntry = {
      id: randomUUID(),
      projectId: data.projectId,
      clientId: data.clientId,
      description: data.description,
      date: data.date,
      hours: data.hours,
      billable: data.billable ?? true,
      invoiced: false,
    };

    this.entries.set(entry.id, entry);
    await this.saveData();

    this.emit('entry-created', entry);
    logger.info('Time entry created', { entryId: entry.id, hours: entry.hours });

    return entry;
  }

  /**
   * Update a time entry
   */
  async updateEntry(entryId: string, updates: Partial<Omit<TimeEntry, 'id'>>): Promise<TimeEntry | undefined> {
    const entry = this.entries.get(entryId);
    if (!entry) return undefined;

    const updatedEntry = { ...entry, ...updates };
    this.entries.set(entryId, updatedEntry);
    await this.saveData();

    this.emit('entry-updated', updatedEntry);
    return updatedEntry;
  }

  /**
   * Delete a time entry
   */
  async deleteEntry(entryId: string): Promise<boolean> {
    const deleted = this.entries.delete(entryId);
    if (deleted) {
      await this.saveData();
      logger.info('Time entry deleted', { entryId });
    }
    return deleted;
  }

  /**
   * Mark entries as invoiced
   */
  async markAsInvoiced(entryIds: string[], invoiceId: string): Promise<number> {
    let count = 0;
    for (const id of entryIds) {
      const entry = this.entries.get(id);
      if (entry) {
        entry.invoiced = true;
        entry.invoiceId = invoiceId;
        count++;
      }
    }
    await this.saveData();
    logger.info('Entries marked as invoiced', { count, invoiceId });
    return count;
  }

  // ============================================================
  // Queries
  // ============================================================

  /**
   * Get all time entries
   */
  getAllEntries(): TimeEntry[] {
    return [...this.entries.values()].sort((a, b) => 
      new Date(b.date).getTime() - new Date(a.date).getTime()
    );
  }

  /**
   * Get entries with filters
   */
  getEntries(filters: TimeEntryFilters): TimeEntry[] {
    let results = [...this.entries.values()];

    if (filters.projectId) {
      results = results.filter(e => e.projectId === filters.projectId);
    }

    if (filters.clientId) {
      results = results.filter(e => e.clientId === filters.clientId);
    }

    if (filters.startDate) {
      results = results.filter(e => new Date(e.date) >= filters.startDate!);
    }

    if (filters.endDate) {
      results = results.filter(e => new Date(e.date) <= filters.endDate!);
    }

    if (filters.billable !== undefined) {
      results = results.filter(e => e.billable === filters.billable);
    }

    if (filters.invoiced !== undefined) {
      results = results.filter(e => e.invoiced === filters.invoiced);
    }

    return results.sort((a, b) => 
      new Date(b.date).getTime() - new Date(a.date).getTime()
    );
  }

  /**
   * Get entries for a project
   */
  getProjectEntries(projectId: string): TimeEntry[] {
    return this.getEntries({ projectId });
  }

  /**
   * Get entries for a client
   */
  getClientEntries(clientId: string): TimeEntry[] {
    return this.getEntries({ clientId });
  }

  /**
   * Get unbilled entries (billable but not invoiced)
   */
  getUnbilledEntries(clientId?: string): TimeEntry[] {
    const filters: TimeEntryFilters = { billable: true, invoiced: false };
    if (clientId) filters.clientId = clientId;
    return this.getEntries(filters);
  }

  /**
   * Get entries for a date range
   */
  getEntriesForDateRange(startDate: Date, endDate: Date): TimeEntry[] {
    return this.getEntries({ startDate, endDate });
  }

  /**
   * Get today's entries
   */
  getTodayEntries(): TimeEntry[] {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return this.getEntriesForDateRange(today, tomorrow);
  }

  /**
   * Get this week's entries
   */
  getThisWeekEntries(): TimeEntry[] {
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);
    return this.getEntriesForDateRange(startOfWeek, now);
  }

  // ============================================================
  // Statistics
  // ============================================================

  /**
   * Get total hours for filters
   */
  getTotalHours(filters?: TimeEntryFilters): number {
    const entries = filters ? this.getEntries(filters) : this.getAllEntries();
    return entries.reduce((sum, e) => sum + e.hours, 0);
  }

  /**
   * Get billable hours for filters
   */
  getBillableHours(filters?: TimeEntryFilters): number {
    const baseFilters = { ...filters, billable: true };
    return this.getTotalHours(baseFilters);
  }

  /**
   * Get today's hours
   */
  getTodayHours(): number {
    return this.getTodayEntries().reduce((sum, e) => sum + e.hours, 0);
  }

  /**
   * Get this week's hours
   */
  getThisWeekHours(): number {
    return this.getThisWeekEntries().reduce((sum, e) => sum + e.hours, 0);
  }

  /**
   * Get unbilled amount for a client
   */
  getUnbilledAmount(clientId: string, hourlyRate: number): number {
    const entries = this.getUnbilledEntries(clientId);
    const hours = entries.reduce((sum, e) => sum + e.hours, 0);
    return hours * hourlyRate;
  }

  /**
   * Get time statistics
   */
  getStats(): {
    totalEntries: number;
    totalHours: number;
    billableHours: number;
    unbilledHours: number;
    todayHours: number;
    weekHours: number;
    timerRunning: boolean;
    timerElapsed: string;
  } {
    const allEntries = this.getAllEntries();
    const totalHours = allEntries.reduce((sum, e) => sum + e.hours, 0);
    const billableHours = allEntries.filter(e => e.billable).reduce((sum, e) => sum + e.hours, 0);
    const unbilledHours = allEntries.filter(e => e.billable && !e.invoiced).reduce((sum, e) => sum + e.hours, 0);

    return {
      totalEntries: allEntries.length,
      totalHours,
      billableHours,
      unbilledHours,
      todayHours: this.getTodayHours(),
      weekHours: this.getThisWeekHours(),
      timerRunning: this.isTimerRunning(),
      timerElapsed: this.getElapsedFormatted(),
    };
  }
}

// Singleton instance
let instance: TimeTracker | null = null;

/**
 * Get the singleton Time Tracker instance
 */
export function getTimeTracker(): TimeTracker {
  if (!instance) {
    instance = new TimeTracker();
  }
  return instance;
}

/**
 * Initialize the Time Tracker (call on app startup)
 */
export async function initializeTimeTracker(): Promise<TimeTracker> {
  const tracker = getTimeTracker();
  await tracker.initialize();
  return tracker;
}
