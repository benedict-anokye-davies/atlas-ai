/**
 * IPC Handlers for Life Coach features
 * Goals, habits, daily briefings, and progress tracking
 */

import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { createModuleLogger } from '../utils/logger';
import { getLifeCoach, Goal, Habit, LifeCoachConfig } from '../intelligence/life-coach';

const logger = createModuleLogger('LifeCoachIPC');

/**
 * Register all life coach IPC handlers
 */
export function registerLifeCoachHandlers(): void {
  logger.info('Registering life coach IPC handlers');

  // Initialize life coach
  ipcMain.handle('life-coach:initialize', async () => {
    try {
      const coach = getLifeCoach();
      await coach.initialize();
      return { success: true };
    } catch (error) {
      logger.error('Failed to initialize life coach', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Generate daily briefing
  ipcMain.handle('life-coach:get-briefing', async () => {
    try {
      const coach = getLifeCoach();
      const briefing = await coach.generateDailyBriefing();
      return { success: true, data: briefing };
    } catch (error) {
      logger.error('Failed to generate briefing', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Goals management
  ipcMain.handle('life-coach:add-goal', async (
    _event: IpcMainInvokeEvent,
    goal: Omit<Goal, 'id' | 'createdAt' | 'updatedAt' | 'milestones' | 'progress'>
  ) => {
    try {
      const coach = getLifeCoach();
      const newGoal = coach.addGoal(goal);
      return { success: true, data: newGoal };
    } catch (error) {
      logger.error('Failed to add goal', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('life-coach:get-goals', async () => {
    try {
      const coach = getLifeCoach();
      const goals = coach.getGoals();
      return { success: true, data: goals };
    } catch (error) {
      logger.error('Failed to get goals', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('life-coach:update-goal-progress', async (
    _event: IpcMainInvokeEvent,
    goalId: string,
    progress: number
  ) => {
    try {
      const coach = getLifeCoach();
      coach.updateGoalProgress(goalId, progress);
      return { success: true };
    } catch (error) {
      logger.error('Failed to update goal progress', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Habits management
  ipcMain.handle('life-coach:add-habit', async (
    _event: IpcMainInvokeEvent,
    habit: Omit<Habit, 'id' | 'createdAt' | 'currentStreak' | 'longestStreak' | 'completions' | 'active'>
  ) => {
    try {
      const coach = getLifeCoach();
      const newHabit = coach.addHabit(habit);
      return { success: true, data: newHabit };
    } catch (error) {
      logger.error('Failed to add habit', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('life-coach:get-habits', async () => {
    try {
      const coach = getLifeCoach();
      const habits = coach.getHabits();
      return { success: true, data: habits };
    } catch (error) {
      logger.error('Failed to get habits', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('life-coach:complete-habit', async (
    _event: IpcMainInvokeEvent,
    habitId: string,
    note?: string
  ) => {
    try {
      const coach = getLifeCoach();
      coach.completeHabit(habitId, note);
      return { success: true };
    } catch (error) {
      logger.error('Failed to complete habit', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Progress summary
  ipcMain.handle('life-coach:get-progress', async () => {
    try {
      const coach = getLifeCoach();
      const summary = coach.getProgressSummary();
      return { success: true, data: summary };
    } catch (error) {
      logger.error('Failed to get progress', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Configuration
  ipcMain.handle('life-coach:update-config', async (
    _event: IpcMainInvokeEvent,
    config: Partial<LifeCoachConfig>
  ) => {
    try {
      const coach = getLifeCoach();
      coach.updateConfig(config);
      return { success: true };
    } catch (error) {
      logger.error('Failed to update config', error);
      return { success: false, error: (error as Error).message };
    }
  });

  logger.info('Life coach IPC handlers registered');
}
