/**
 * IPC Handlers - Study System
 *
 * Bridges the Study System with the renderer process
 */

import { ipcMain } from 'electron';
import { getStudySystem, Course, Module, Flashcard } from '../study/study-system';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('StudyIPC');

export function registerStudyHandlers(): void {
  // Course Management
  ipcMain.handle('study:createCourse', async (_, course: { name: string; code: string; term: 'autumn' | 'spring' | 'summer'; year: number }) => {
    try {
      const system = getStudySystem();
      return { success: true, data: system.createCourse(course.name, course.code, course.term, course.year) };
    } catch (error) {
      logger.error('Failed to create course', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('study:getCourses', async () => {
    try {
      const system = getStudySystem();
      return { success: true, data: system.getAllCourses() };
    } catch (error) {
      logger.error('Failed to get courses', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // Module Management
  ipcMain.handle('study:addModule', async (_, courseId: string, module: { name: string; weekNumber?: number }) => {
    try {
      const system = getStudySystem();
      return { success: true, data: system.createModule(courseId, module.name, module.weekNumber) };
    } catch (error) {
      logger.error('Failed to add module', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // PDF Ingestion
  ipcMain.handle('study:ingestPDF', async (_, pdfPath: string, moduleId: string) => {
    try {
      const system = getStudySystem();
      const result = await system.ingestLecturePDF(pdfPath, moduleId);
      return { success: true, data: result };
    } catch (error) {
      logger.error('Failed to ingest PDF', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // Flashcards
  ipcMain.handle('study:getDueFlashcards', async (_, moduleId?: string) => {
    try {
      const system = getStudySystem();
      return { success: true, data: system.getDueFlashcards(moduleId) };
    } catch (error) {
      logger.error('Failed to get due flashcards', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('study:reviewFlashcard', async (_, flashcardId: string, quality: number) => {
    try {
      const system = getStudySystem();
      system.reviewFlashcard(flashcardId, quality);
      return { success: true };
    } catch (error) {
      logger.error('Failed to review flashcard', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('study:createFlashcard', async (_, moduleId: string, flashcard: { front: string; back: string; conceptId?: string }) => {
    try {
      const system = getStudySystem();
      return { success: true, data: system.createFlashcard(moduleId, flashcard.conceptId, flashcard.front, flashcard.back) };
    } catch (error) {
      logger.error('Failed to create flashcard', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // Study Sessions
  ipcMain.handle('study:startSession', async (_, moduleId: string) => {
    try {
      const system = getStudySystem();
      return { success: true, data: system.startStudySession(moduleId) };
    } catch (error) {
      logger.error('Failed to start study session', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('study:endSession', async () => {
    try {
      const system = getStudySystem();
      const session = system.endStudySession();
      return { success: true, data: session };
    } catch (error) {
      logger.error('Failed to end study session', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // Statistics
  ipcMain.handle('study:getStats', async () => {
    try {
      const system = getStudySystem();
      return { success: true, data: system.getStudyStats() };
    } catch (error) {
      logger.error('Failed to get stats', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  logger.info('Study IPC handlers registered');
}
