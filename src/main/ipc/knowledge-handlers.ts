/**
 * Knowledge IPC Handlers
 * IPC handlers for personal knowledge management
 */

import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { createModuleLogger } from '../utils/logger';
import {
  getAutoJournaling,
  getInsightExtractor,
  getSpacedReview,
  initializeKnowledge,
  getDailyDigest,
  getKnowledgeStatus
} from '../knowledge';
import { JournalType, MoodLevel, InsightType, KnowledgeType } from '../knowledge/types';

const logger = createModuleLogger('KnowledgeIPC');

/**
 * Register all knowledge IPC handlers
 */
export function registerKnowledgeHandlers(): void {
  logger.info('Registering knowledge IPC handlers');

  // Initialize knowledge system
  ipcMain.handle('knowledge:initialize', async () => {
    try {
      await initializeKnowledge();
      return { success: true };
    } catch (error) {
      logger.error('Failed to initialize knowledge', error);
      return { success: false, error: String(error) };
    }
  });

  // Get system status
  ipcMain.handle('knowledge:getStatus', async () => {
    try {
      const status = getKnowledgeStatus();
      return { success: true, data: status };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Get daily digest
  ipcMain.handle('knowledge:getDailyDigest', async () => {
    try {
      const digest = getDailyDigest();
      return { success: true, data: digest };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // ============ Journaling Handlers ============

  ipcMain.handle('knowledge:journal:create', async (
    _event: IpcMainInvokeEvent,
    type: JournalType,
    content: string,
    options?: { tags?: string[]; mood?: MoodLevel }
  ) => {
    try {
      const journaling = getAutoJournaling();
      const entry = await journaling.createEntry(type, content, options);
      return { success: true, data: entry };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('knowledge:journal:getAll', async () => {
    try {
      const journaling = getAutoJournaling();
      const entries = journaling.getAllEntries();
      return { success: true, data: entries };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('knowledge:journal:getByDateRange', async (
    _event: IpcMainInvokeEvent,
    start: string,
    end: string
  ) => {
    try {
      const journaling = getAutoJournaling();
      const entries = journaling.getEntriesByDateRange(
        new Date(start),
        new Date(end)
      );
      return { success: true, data: entries };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('knowledge:journal:search', async (
    _event: IpcMainInvokeEvent,
    query: string
  ) => {
    try {
      const journaling = getAutoJournaling();
      const entries = journaling.searchEntries(query);
      return { success: true, data: entries };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('knowledge:journal:delete', async (
    _event: IpcMainInvokeEvent,
    id: string
  ) => {
    try {
      const journaling = getAutoJournaling();
      const success = journaling.deleteEntry(id);
      return { success };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('knowledge:journal:generateDaily', async () => {
    try {
      const journaling = getAutoJournaling();
      const entry = await journaling.generateDailyEntry();
      return { success: true, data: entry };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // ============ Insight Handlers ============

  ipcMain.handle('knowledge:insight:getAll', async (
    _event: IpcMainInvokeEvent,
    includeDismissed?: boolean
  ) => {
    try {
      const extractor = getInsightExtractor();
      const insights = extractor.getAllInsights(includeDismissed);
      return { success: true, data: insights };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('knowledge:insight:getActionable', async () => {
    try {
      const extractor = getInsightExtractor();
      const insights = extractor.getActionableInsights();
      return { success: true, data: insights };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('knowledge:insight:getByType', async (
    _event: IpcMainInvokeEvent,
    type: InsightType
  ) => {
    try {
      const extractor = getInsightExtractor();
      const insights = extractor.getInsightsByType(type);
      return { success: true, data: insights };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('knowledge:insight:create', async (
    _event: IpcMainInvokeEvent,
    type: InsightType,
    title: string,
    content: string,
    options?: { tags?: string[]; actionable?: boolean; suggestedActions?: string[] }
  ) => {
    try {
      const extractor = getInsightExtractor();
      const insight = extractor.createInsight(type, title, content, options);
      return { success: true, data: insight };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('knowledge:insight:review', async (
    _event: IpcMainInvokeEvent,
    id: string
  ) => {
    try {
      const extractor = getInsightExtractor();
      const success = extractor.reviewInsight(id);
      return { success };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('knowledge:insight:dismiss', async (
    _event: IpcMainInvokeEvent,
    id: string
  ) => {
    try {
      const extractor = getInsightExtractor();
      const success = extractor.dismissInsight(id);
      return { success };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('knowledge:insight:search', async (
    _event: IpcMainInvokeEvent,
    query: string
  ) => {
    try {
      const extractor = getInsightExtractor();
      const insights = extractor.searchInsights(query);
      return { success: true, data: insights };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // ============ Spaced Review Handlers ============

  ipcMain.handle('knowledge:review:addItem', async (
    _event: IpcMainInvokeEvent,
    type: KnowledgeType,
    title: string,
    content: string,
    options?: {
      summary?: string;
      source?: string;
      tags?: string[];
      relatedItems?: string[];
      initialDifficulty?: number;
    }
  ) => {
    try {
      const review = getSpacedReview();
      const item = review.addItem(type, title, content, options);
      return { success: true, data: item };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('knowledge:review:getAllItems', async () => {
    try {
      const review = getSpacedReview();
      const items = review.getAllItems();
      return { success: true, data: items };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('knowledge:review:getDueItems', async (
    _event: IpcMainInvokeEvent,
    limit?: number
  ) => {
    try {
      const review = getSpacedReview();
      const items = review.getDueItems(limit);
      return { success: true, data: items };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('knowledge:review:getItemsByType', async (
    _event: IpcMainInvokeEvent,
    type: KnowledgeType
  ) => {
    try {
      const review = getSpacedReview();
      const items = review.getItemsByType(type);
      return { success: true, data: items };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('knowledge:review:searchItems', async (
    _event: IpcMainInvokeEvent,
    query: string
  ) => {
    try {
      const review = getSpacedReview();
      const items = review.searchItems(query);
      return { success: true, data: items };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('knowledge:review:startSession', async (
    _event: IpcMainInvokeEvent,
    itemCount?: number
  ) => {
    try {
      const review = getSpacedReview();
      const session = review.startSession(itemCount);
      return { success: true, data: session };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('knowledge:review:getNextItem', async () => {
    try {
      const review = getSpacedReview();
      const item = review.getNextReviewItem();
      return { success: true, data: item };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('knowledge:review:recordReview', async (
    _event: IpcMainInvokeEvent,
    itemId: string,
    recalled: boolean,
    difficulty: 'easy' | 'medium' | 'hard',
    responseTime?: number
  ) => {
    try {
      const review = getSpacedReview();
      review.recordReview(itemId, recalled, difficulty, responseTime);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('knowledge:review:completeSession', async () => {
    try {
      const review = getSpacedReview();
      const session = review.completeSession();
      return { success: true, data: session };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('knowledge:review:getStats', async () => {
    try {
      const review = getSpacedReview();
      const stats = review.getStatistics();
      return { success: true, data: stats };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('knowledge:review:getRecentSessions', async (
    _event: IpcMainInvokeEvent,
    limit?: number
  ) => {
    try {
      const review = getSpacedReview();
      const sessions = review.getRecentSessions(limit);
      return { success: true, data: sessions };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('knowledge:review:updateItem', async (
    _event: IpcMainInvokeEvent,
    id: string,
    updates: { title?: string; content?: string; summary?: string; tags?: string[] }
  ) => {
    try {
      const review = getSpacedReview();
      const item = review.updateItem(id, updates);
      return { success: true, data: item };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('knowledge:review:deleteItem', async (
    _event: IpcMainInvokeEvent,
    id: string
  ) => {
    try {
      const review = getSpacedReview();
      const success = review.deleteItem(id);
      return { success };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  logger.info('Knowledge IPC handlers registered');
}
