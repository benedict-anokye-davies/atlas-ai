/**
 * IPC Handlers - Career System
 *
 * Bridges the Career System with the renderer process
 */

import { ipcMain } from 'electron';
import { getCareerSystem } from '../career/career-system';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('CareerIPC');

export function registerCareerHandlers(): void {
  // Profile Management
  ipcMain.handle('career:initProfile', async (_, userId: string) => {
    try {
      const system = getCareerSystem();
      return { success: true, data: system.initializeProfile(userId) };
    } catch (error) {
      logger.error('Failed to initialize profile', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('career:getProfile', async () => {
    try {
      const system = getCareerSystem();
      return { success: true, data: system.getProfile() };
    } catch (error) {
      logger.error('Failed to get profile', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // Discovery
  ipcMain.handle('career:startDiscovery', async () => {
    try {
      const system = getCareerSystem();
      return { success: true, data: system.startDiscoverySession() };
    } catch (error) {
      logger.error('Failed to start discovery', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('career:getNextQuestion', async () => {
    try {
      const system = getCareerSystem();
      return { success: true, data: system.getNextQuestion() };
    } catch (error) {
      logger.error('Failed to get next question', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('career:answerQuestion', async (_, questionId: string, answer: unknown) => {
    try {
      const system = getCareerSystem();
      system.answerQuestion(questionId, answer as string | number | string[]);
      return { success: true };
    } catch (error) {
      logger.error('Failed to answer question', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('career:getResults', async () => {
    try {
      const system = getCareerSystem();
      return { success: true, data: system.getDiscoveryResults() };
    } catch (error) {
      logger.error('Failed to get results', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // Skills
  ipcMain.handle('career:analyzeSkillGaps', async () => {
    try {
      const system = getCareerSystem();
      return { success: true, data: system.analyzeSkillGaps() };
    } catch (error) {
      logger.error('Failed to analyze skill gaps', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // Projects
  ipcMain.handle('career:addProject', async (_, project: unknown) => {
    try {
      const system = getCareerSystem();
      return { success: true, data: system.addProject(project as never) };
    } catch (error) {
      logger.error('Failed to add project', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('career:getPortfolio', async () => {
    try {
      const system = getCareerSystem();
      return { success: true, data: system.getPortfolioProjects() };
    } catch (error) {
      logger.error('Failed to get portfolio', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // Goals
  ipcMain.handle('career:addGoal', async (_, goal: { title: string; description: string; priority: string; deadline?: number }, isLongTerm: boolean) => {
    try {
      const system = getCareerSystem();
      return { success: true, data: system.addGoal(goal as never, isLongTerm) };
    } catch (error) {
      logger.error('Failed to add goal', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('career:updateGoalStatus', async (_, goalId: string, status: string) => {
    try {
      const system = getCareerSystem();
      system.updateGoalStatus(goalId, status as never);
      return { success: true };
    } catch (error) {
      logger.error('Failed to update goal status', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // Stats
  ipcMain.handle('career:getStats', async () => {
    try {
      const system = getCareerSystem();
      return { success: true, data: system.getCareerStats() };
    } catch (error) {
      logger.error('Failed to get stats', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  logger.info('Career IPC handlers registered');
}
