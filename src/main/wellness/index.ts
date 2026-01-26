/**
 * Wellness System Index
 * 
 * Exports all wellness-related modules for developer health tracking
 * and break management.
 * 
 * @module wellness
 */

// Activity Tracker
export {
  ActivityTracker,
  getActivityTracker,
  resetActivityTracker,
  type ActivitySession,
  type TypingBurst,
  type Break,
  type DailyStats,
  type ActivityTrackerConfig,
} from './activity-tracker';

// Break Reminder
export {
  BreakReminderManager,
  getBreakReminder,
  resetBreakReminder,
  type BreakReminderConfig,
  type BreakReminder,
  type BreakSuggestion,
  type BreakReminderStatus,
} from './break-reminder';

// ============================================================================
// Convenience Functions
// ============================================================================

import { getActivityTracker } from './activity-tracker';
import { getBreakReminder } from './break-reminder';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('WellnessSystem');

/**
 * Initialize the complete wellness system
 */
export function initializeWellnessSystem(): void {
  logger.info('Initializing wellness system');
  
  // Start activity tracking
  const activityTracker = getActivityTracker();
  activityTracker.start();
  
  // Start break reminders
  const breakReminder = getBreakReminder();
  breakReminder.start();
  
  logger.info('Wellness system initialized');
}

/**
 * Shutdown the wellness system
 */
export function shutdownWellnessSystem(): void {
  logger.info('Shutting down wellness system');
  
  const activityTracker = getActivityTracker();
  activityTracker.stop();
  
  const breakReminder = getBreakReminder();
  breakReminder.stop();
  
  logger.info('Wellness system shut down');
}

/**
 * Get a comprehensive wellness summary
 */
export function getWellnessSummary(): {
  session: {
    duration: number;
    activeTime: number;
    keystrokes: number;
    breaks: number;
  } | null;
  today: {
    screenTime: number;
    focusTime: number;
    breaks: number;
    breakScore: number;
    paceScore: number;
  } | null;
  breakStatus: {
    status: string;
    nextBreak: { type: string; in: number } | null;
    shouldTakeBreak: boolean;
    urgency: string;
  };
} {
  const activityTracker = getActivityTracker();
  const breakReminder = getBreakReminder();
  
  const currentSession = activityTracker.getCurrentSession();
  const todayStats = activityTracker.getTodayStats();
  const upcomingBreaks = breakReminder.getUpcomingBreaks();
  const breakRecommendation = activityTracker.shouldTakeBreak();
  
  return {
    session: currentSession ? {
      duration: currentSession.duration,
      activeTime: currentSession.activeTime,
      keystrokes: currentSession.keystrokes,
      breaks: currentSession.breaks.length,
    } : null,
    
    today: todayStats ? {
      screenTime: todayStats.totalScreenTime,
      focusTime: todayStats.deepWorkTime,
      breaks: todayStats.totalBreaks,
      breakScore: todayStats.breakScore,
      paceScore: todayStats.paceScore,
    } : null,
    
    breakStatus: {
      status: breakReminder.getStatus(),
      nextBreak: upcomingBreaks.length > 0 ? {
        type: upcomingBreaks[0].type,
        in: upcomingBreaks[0].in,
      } : null,
      shouldTakeBreak: breakRecommendation.recommended,
      urgency: breakRecommendation.urgency,
    },
  };
}
