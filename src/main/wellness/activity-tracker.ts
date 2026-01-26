/**
 * Activity Tracker
 * 
 * Tracks developer activity patterns including screen time, typing patterns,
 * application usage, and break patterns for wellness monitoring.
 * 
 * @module wellness/activity-tracker
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { createModuleLogger } from '../utils/logger';
import { getAppDetector } from '../vision/app-detector';
import { isoDate } from '../../shared/utils';

const logger = createModuleLogger('ActivityTracker');

// ============================================================================
// Types
// ============================================================================

export interface ActivitySession {
  id: string;
  startTime: number;
  endTime?: number;
  duration: number;
  
  // Activity metrics
  activeTime: number;      // Time actually interacting
  idleTime: number;        // Time idle but session active
  
  // Application usage
  appUsage: Map<string, number>;
  
  // Typing metrics
  keystrokes: number;
  typingBursts: TypingBurst[];
  
  // Break tracking
  breaks: Break[];
  longestStretch: number;  // Longest time without break (ms)
}

export interface TypingBurst {
  startTime: number;
  endTime: number;
  keystrokes: number;
  wordsPerMinute: number;
}

export interface Break {
  startTime: number;
  endTime: number;
  duration: number;
  type: 'micro' | 'short' | 'long';  // <1min, 1-5min, >5min
}

export interface DailyStats {
  date: string;  // YYYY-MM-DD
  
  // Time metrics
  totalScreenTime: number;
  totalActiveTime: number;
  totalIdleTime: number;
  
  // Sessions
  sessions: number;
  averageSessionLength: number;
  longestSession: number;
  
  // Breaks
  totalBreaks: number;
  totalBreakTime: number;
  averageBreakInterval: number;
  longestWorkStretch: number;
  
  // Productivity indicators
  focusSessions: number;       // Sessions > 25 min
  deepWorkTime: number;        // Time in focus sessions
  
  // Health metrics
  breakScore: number;          // 0-100, higher is better
  paceScore: number;           // 0-100, sustainability score
}

export interface ActivityTrackerConfig {
  // Detection thresholds
  idleThresholdMs: number;      // Time before considered idle
  breakThresholdMs: number;     // Min time to count as break
  focusThresholdMs: number;     // Min session for focus work
  
  // Tracking intervals
  trackingIntervalMs: number;   // How often to sample activity
  
  // Storage
  retentionDays: number;        // Days to keep historical data
  
  // Break recommendations
  recommendedBreakInterval: number;  // ms between breaks
  recommendedBreakDuration: number;  // ms for break
}

const DEFAULT_CONFIG: ActivityTrackerConfig = {
  idleThresholdMs: 60000,        // 1 minute
  breakThresholdMs: 60000,       // 1 minute
  focusThresholdMs: 1500000,     // 25 minutes (Pomodoro)
  trackingIntervalMs: 10000,     // 10 seconds
  retentionDays: 30,
  recommendedBreakInterval: 3600000,  // 1 hour
  recommendedBreakDuration: 300000,   // 5 minutes
};

// ============================================================================
// Activity Tracker Class
// ============================================================================

export class ActivityTracker extends EventEmitter {
  private config: ActivityTrackerConfig;
  private dataDir: string;
  
  // Current session
  private currentSession: ActivitySession | null = null;
  private trackingInterval: NodeJS.Timeout | null = null;
  
  // Activity detection
  private lastActivityTime: number = Date.now();
  private isIdle: boolean = false;
  private currentApp: string = '';
  
  // Typing tracking
  private keystrokeBuffer: number[] = [];
  private currentBurstStart: number = 0;
  private currentBurstKeystrokes: number = 0;
  
  // Daily stats
  private todayStats: DailyStats | null = null;

  constructor(config?: Partial<ActivityTrackerConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.dataDir = path.join(app.getPath('userData'), 'wellness');
    this.ensureDir(this.dataDir);
  }

  /**
   * Start activity tracking
   */
  start(): void {
    if (this.trackingInterval) {
      logger.warn('Activity tracker already running');
      return;
    }

    logger.info('Starting activity tracker');
    
    // Initialize session
    this.startNewSession();
    
    // Load today's stats
    this.todayStats = this.loadDailyStats(this.getTodayDate());
    
    // Start tracking loop
    this.trackingInterval = setInterval(() => {
      this.trackActivity();
    }, this.config.trackingIntervalMs);
  }

  /**
   * Stop activity tracking
   */
  stop(): void {
    if (this.trackingInterval) {
      clearInterval(this.trackingInterval);
      this.trackingInterval = null;
    }
    
    if (this.currentSession) {
      this.endCurrentSession();
    }
    
    // Clean up event listeners to prevent memory leaks
    this.removeAllListeners();
    
    logger.info('Activity tracker stopped');
  }

  /**
   * Record a keystroke event
   */
  recordKeystroke(): void {
    const now = Date.now();
    this.lastActivityTime = now;
    
    if (this.currentSession) {
      this.currentSession.keystrokes++;
      
      // Track typing burst
      if (now - this.currentBurstStart > 5000) {
        // New burst
        if (this.currentBurstKeystrokes > 10) {
          this.finishTypingBurst();
        }
        this.currentBurstStart = now;
        this.currentBurstKeystrokes = 1;
      } else {
        this.currentBurstKeystrokes++;
      }
    }
  }

  /**
   * Record mouse/interaction activity
   */
  recordActivity(): void {
    this.lastActivityTime = Date.now();
    
    if (this.isIdle) {
      this.isIdle = false;
      this.emit('activity:resumed');
    }
  }

  /**
   * Get current session info
   */
  getCurrentSession(): ActivitySession | null {
    return this.currentSession;
  }

  /**
   * Get today's statistics
   */
  getTodayStats(): DailyStats | null {
    return this.todayStats;
  }

  /**
   * Get statistics for a date range
   */
  getStatsForRange(startDate: string, endDate: string): DailyStats[] {
    const stats: DailyStats[] = [];
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    for (let d = start; d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = this.formatDate(d);
      const dayStats = this.loadDailyStats(dateStr);
      if (dayStats) {
        stats.push(dayStats);
      }
    }
    
    return stats;
  }

  /**
   * Get time since last break
   */
  getTimeSinceBreak(): number {
    if (!this.currentSession || this.currentSession.breaks.length === 0) {
      return this.currentSession ? Date.now() - this.currentSession.startTime : 0;
    }
    
    const lastBreak = this.currentSession.breaks[this.currentSession.breaks.length - 1];
    return Date.now() - lastBreak.endTime;
  }

  /**
   * Check if a break is recommended
   */
  shouldTakeBreak(): { recommended: boolean; urgency: 'low' | 'medium' | 'high'; reason: string } {
    const timeSinceBreak = this.getTimeSinceBreak();
    
    if (timeSinceBreak > this.config.recommendedBreakInterval * 1.5) {
      return {
        recommended: true,
        urgency: 'high',
        reason: `You've been working for ${Math.round(timeSinceBreak / 60000)} minutes without a break`,
      };
    }
    
    if (timeSinceBreak > this.config.recommendedBreakInterval) {
      return {
        recommended: true,
        urgency: 'medium',
        reason: `Consider taking a 5-minute break`,
      };
    }
    
    if (timeSinceBreak > this.config.recommendedBreakInterval * 0.75) {
      return {
        recommended: true,
        urgency: 'low',
        reason: `A break in the next 15 minutes would be good`,
      };
    }
    
    return {
      recommended: false,
      urgency: 'low',
      reason: 'Keep up the good work!',
    };
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Start a new activity session
   */
  private startNewSession(): void {
    this.currentSession = {
      id: `session_${Date.now()}`,
      startTime: Date.now(),
      duration: 0,
      activeTime: 0,
      idleTime: 0,
      appUsage: new Map(),
      keystrokes: 0,
      typingBursts: [],
      breaks: [],
      longestStretch: 0,
    };
    
    this.lastActivityTime = Date.now();
    this.isIdle = false;
    
    logger.info('New activity session started');
    this.emit('session:started', this.currentSession);
  }

  /**
   * End the current session
   */
  private endCurrentSession(): void {
    if (!this.currentSession) return;
    
    // Finish any ongoing typing burst
    if (this.currentBurstKeystrokes > 10) {
      this.finishTypingBurst();
    }
    
    this.currentSession.endTime = Date.now();
    this.currentSession.duration = this.currentSession.endTime - this.currentSession.startTime;
    
    // Update daily stats
    this.updateDailyStats(this.currentSession);
    
    logger.info('Activity session ended', {
      duration: Math.round(this.currentSession.duration / 60000),
      keystrokes: this.currentSession.keystrokes,
      breaks: this.currentSession.breaks.length,
    });
    
    this.emit('session:ended', this.currentSession);
    this.currentSession = null;
  }

  /**
   * Track activity in the interval
   */
  private async trackActivity(): Promise<void> {
    if (!this.currentSession) return;
    
    const now = Date.now();
    const intervalMs = this.config.trackingIntervalMs;
    
    // Check for idle
    const timeSinceActivity = now - this.lastActivityTime;
    const wasIdle = this.isIdle;
    this.isIdle = timeSinceActivity > this.config.idleThresholdMs;
    
    // Track active/idle time
    if (this.isIdle) {
      this.currentSession.idleTime += intervalMs;
      
      // Detect break
      if (!wasIdle && timeSinceActivity >= this.config.breakThresholdMs) {
        this.startBreak(this.lastActivityTime);
      }
    } else {
      this.currentSession.activeTime += intervalMs;
      
      // End break if we were on one
      if (wasIdle) {
        this.endBreak(now);
      }
    }
    
    // Update duration
    this.currentSession.duration = now - this.currentSession.startTime;
    
    // Track app usage
    await this.trackAppUsage(intervalMs);
    
    // Update longest stretch without break
    const timeSinceBreak = this.getTimeSinceBreak();
    if (timeSinceBreak > this.currentSession.longestStretch) {
      this.currentSession.longestStretch = timeSinceBreak;
    }
    
    // Check if break recommended
    const breakCheck = this.shouldTakeBreak();
    if (breakCheck.recommended && breakCheck.urgency === 'high') {
      this.emit('break:recommended', breakCheck);
    }
    
    // Emit periodic update
    this.emit('activity:update', {
      session: this.currentSession,
      isIdle: this.isIdle,
      timeSinceBreak,
      breakRecommendation: breakCheck,
    });
  }

  /**
   * Track application usage
   */
  private async trackAppUsage(intervalMs: number): Promise<void> {
    try {
      const appDetector = getAppDetector();
      const activeApp = await appDetector.getActiveApp();
      
      if (activeApp && this.currentSession) {
        const appName = activeApp.name;
        const currentUsage = this.currentSession.appUsage.get(appName) || 0;
        this.currentSession.appUsage.set(appName, currentUsage + intervalMs);
        this.currentApp = appName;
      }
    } catch (error) {
      // Ignore errors in app detection
    }
  }

  /**
   * Start a break period
   */
  private startBreak(startTime: number): void {
    if (!this.currentSession) return;
    
    // The break already happened, we're detecting it retroactively
    logger.debug('Break started at', new Date(startTime).toISOString());
  }

  /**
   * End a break period
   */
  private endBreak(endTime: number): void {
    if (!this.currentSession) return;
    
    const breakDuration = endTime - this.lastActivityTime;
    
    if (breakDuration >= this.config.breakThresholdMs) {
      const breakType = breakDuration < 60000 ? 'micro' :
                       breakDuration < 300000 ? 'short' : 'long';
      
      const breakRecord: Break = {
        startTime: this.lastActivityTime,
        endTime,
        duration: breakDuration,
        type: breakType,
      };
      
      this.currentSession.breaks.push(breakRecord);
      
      logger.info(`Break ended: ${breakType} (${Math.round(breakDuration / 1000)}s)`);
      this.emit('break:ended', breakRecord);
    }
  }

  /**
   * Finish current typing burst
   */
  private finishTypingBurst(): void {
    if (!this.currentSession || this.currentBurstKeystrokes < 10) return;
    
    const burstDuration = Date.now() - this.currentBurstStart;
    const wpm = (this.currentBurstKeystrokes / 5) / (burstDuration / 60000);
    
    this.currentSession.typingBursts.push({
      startTime: this.currentBurstStart,
      endTime: Date.now(),
      keystrokes: this.currentBurstKeystrokes,
      wordsPerMinute: Math.round(wpm),
    });
    
    this.currentBurstKeystrokes = 0;
  }

  /**
   * Update daily statistics
   */
  private updateDailyStats(session: ActivitySession): void {
    const today = this.getTodayDate();
    
    if (!this.todayStats || this.todayStats.date !== today) {
      this.todayStats = this.loadDailyStats(today) || this.createEmptyDailyStats(today);
    }
    
    // Update totals
    this.todayStats.totalScreenTime += session.duration;
    this.todayStats.totalActiveTime += session.activeTime;
    this.todayStats.totalIdleTime += session.idleTime;
    this.todayStats.sessions++;
    
    // Update averages
    this.todayStats.averageSessionLength = 
      this.todayStats.totalScreenTime / this.todayStats.sessions;
    
    if (session.duration > this.todayStats.longestSession) {
      this.todayStats.longestSession = session.duration;
    }
    
    // Update break stats
    this.todayStats.totalBreaks += session.breaks.length;
    this.todayStats.totalBreakTime += session.breaks.reduce((sum, b) => sum + b.duration, 0);
    
    if (session.longestStretch > this.todayStats.longestWorkStretch) {
      this.todayStats.longestWorkStretch = session.longestStretch;
    }
    
    // Update focus metrics
    if (session.activeTime >= this.config.focusThresholdMs) {
      this.todayStats.focusSessions++;
      this.todayStats.deepWorkTime += session.activeTime;
    }
    
    // Calculate scores
    this.todayStats.breakScore = this.calculateBreakScore(this.todayStats);
    this.todayStats.paceScore = this.calculatePaceScore(this.todayStats);
    
    // Save stats
    this.saveDailyStats(this.todayStats);
  }

  /**
   * Calculate break score (0-100)
   */
  private calculateBreakScore(stats: DailyStats): number {
    if (stats.totalScreenTime === 0) return 100;
    
    // Ideal: break every hour
    const expectedBreaks = stats.totalScreenTime / this.config.recommendedBreakInterval;
    const breakRatio = stats.totalBreaks / Math.max(expectedBreaks, 1);
    
    // Penalize very long work stretches
    const stretchPenalty = Math.min(stats.longestWorkStretch / (this.config.recommendedBreakInterval * 2), 0.5);
    
    const score = Math.min(100, Math.round(breakRatio * 100 * (1 - stretchPenalty)));
    return Math.max(0, score);
  }

  /**
   * Calculate pace score (0-100)
   */
  private calculatePaceScore(stats: DailyStats): number {
    if (stats.totalScreenTime === 0) return 100;
    
    // Factors:
    // 1. Active time ratio (not too high, not too low)
    const activeRatio = stats.totalActiveTime / stats.totalScreenTime;
    const optimalActiveRatio = 0.8; // 80% active is optimal
    const activeScore = 100 - Math.abs(activeRatio - optimalActiveRatio) * 100;
    
    // 2. Break regularity
    const breakScore = stats.breakScore;
    
    // 3. Session length (avoid very long sessions)
    const avgSessionHours = stats.averageSessionLength / 3600000;
    const sessionScore = avgSessionHours <= 2 ? 100 : Math.max(0, 100 - (avgSessionHours - 2) * 25);
    
    return Math.round((activeScore + breakScore + sessionScore) / 3);
  }

  /**
   * Load daily stats from disk
   */
  private loadDailyStats(date: string): DailyStats | null {
    const filePath = path.join(this.dataDir, `stats_${date}.json`);
    
    try {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(content);
      }
    } catch (error) {
      logger.warn(`Failed to load stats for ${date}:`, error);
    }
    
    return null;
  }

  /**
   * Save daily stats to disk
   */
  private saveDailyStats(stats: DailyStats): void {
    const filePath = path.join(this.dataDir, `stats_${stats.date}.json`);
    
    try {
      fs.writeFileSync(filePath, JSON.stringify(stats, null, 2));
    } catch (error) {
      logger.error('Failed to save daily stats:', error);
    }
  }

  /**
   * Create empty daily stats
   */
  private createEmptyDailyStats(date: string): DailyStats {
    return {
      date,
      totalScreenTime: 0,
      totalActiveTime: 0,
      totalIdleTime: 0,
      sessions: 0,
      averageSessionLength: 0,
      longestSession: 0,
      totalBreaks: 0,
      totalBreakTime: 0,
      averageBreakInterval: 0,
      longestWorkStretch: 0,
      focusSessions: 0,
      deepWorkTime: 0,
      breakScore: 100,
      paceScore: 100,
    };
  }

  /**
   * Get today's date string
   */
  private getTodayDate(): string {
    return this.formatDate(new Date());
  }

  /**
   * Format date as YYYY-MM-DD
   */
  private formatDate(date: Date): string {
    return isoDate(date);
  }

  /**
   * Ensure directory exists
   */
  private ensureDir(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }
}

// ============================================================================
// Singleton
// ============================================================================

let trackerInstance: ActivityTracker | null = null;

export function getActivityTracker(config?: Partial<ActivityTrackerConfig>): ActivityTracker {
  if (!trackerInstance) {
    trackerInstance = new ActivityTracker(config);
  }
  return trackerInstance;
}

export function resetActivityTracker(): void {
  if (trackerInstance) {
    trackerInstance.stop();
  }
  trackerInstance = null;
}
