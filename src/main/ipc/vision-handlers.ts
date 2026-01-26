/**
 * Vision IPC Handlers
 * IPC handlers for screen understanding and vision system
 */

import { ipcMain, IpcMainInvokeEvent, desktopCapturer } from 'electron';
import { createModuleLogger } from '../utils/logger';
import {
  getScreenAnalyzer,
  getAppDetector,
  getContextBuilder,
  initializeVision
} from '../vision';

const logger = createModuleLogger('VisionIPC');

/**
 * Register all vision IPC handlers
 */
export function registerVisionHandlers(): void {
  logger.info('Registering vision IPC handlers');

  // Initialize vision system
  ipcMain.handle('vision:initialize', async () => {
    try {
      await initializeVision();
      return { success: true };
    } catch (error) {
      logger.error('Failed to initialize vision', error);
      return { success: false, error: String(error) };
    }
  });

  // Get system status
  ipcMain.handle('vision:getStatus', async () => {
    try {
      const analyzer = getScreenAnalyzer();
      const detector = getAppDetector();
      const builder = getContextBuilder();
      
      return {
        success: true,
        data: {
          analyzer: analyzer.getStatus(),
          detector: detector.getStatus(),
          builder: builder.getStatus()
        }
      };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Analyze current screen
  ipcMain.handle('vision:analyzeScreen', async () => {
    try {
      const analyzer = getScreenAnalyzer();
      const result = await analyzer.analyzeCurrentScreen();
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Get current screen context
  ipcMain.handle('vision:getContext', async () => {
    try {
      const builder = getContextBuilder();
      const context = await builder.buildContext();
      return { success: true, data: context };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Get active application info
  ipcMain.handle('vision:getActiveApp', async () => {
    try {
      const detector = getAppDetector();
      const app = await detector.getCurrentApp();
      return { success: true, data: app };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Start continuous monitoring
  ipcMain.handle('vision:startMonitoring', async (
    _event: IpcMainInvokeEvent,
    interval?: number
  ) => {
    try {
      const analyzer = getScreenAnalyzer();
      analyzer.startMonitoring(interval);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Stop continuous monitoring
  ipcMain.handle('vision:stopMonitoring', async () => {
    try {
      const analyzer = getScreenAnalyzer();
      analyzer.stopMonitoring();
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Capture screenshot
  ipcMain.handle('vision:captureScreen', async () => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 1920, height: 1080 }
      });
      
      if (sources.length === 0) {
        return { success: false, error: 'No screen sources available' };
      }
      
      const thumbnail = sources[0].thumbnail.toDataURL();
      return { success: true, data: { dataUrl: thumbnail } };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Get recent analysis history
  ipcMain.handle('vision:getHistory', async (
    _event: IpcMainInvokeEvent,
    limit?: number
  ) => {
    try {
      const analyzer = getScreenAnalyzer();
      const history = analyzer.getHistory(limit);
      return { success: true, data: history };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Clear analysis history
  ipcMain.handle('vision:clearHistory', async () => {
    try {
      const analyzer = getScreenAnalyzer();
      analyzer.clearHistory();
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  logger.info('Vision IPC handlers registered');
}
