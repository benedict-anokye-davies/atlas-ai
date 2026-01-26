/**
 * Atlas Desktop - Screenshot Tools
 * Capture screenshots of the desktop and windows
 */

import { AgentTool, ActionResult } from '../../../shared/types/agent';
import { createModuleLogger } from '../../utils/logger';
import { desktopCapturer, screen } from 'electron';
import * as path from 'path';
import * as fs from 'fs/promises';

const logger = createModuleLogger('ScreenshotTools');

/**
 * Screenshot result interface
 */
export interface ScreenshotResult {
  path?: string;
  base64?: string;
  width: number;
  height: number;
  format: 'png' | 'jpeg';
  size: number;
  timestamp: string;
  source: string;
}

/**
 * Get available screen sources
 */
async function getScreenSources(): Promise<Electron.DesktopCapturerSource[]> {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 1920, height: 1080 },
  });
  return sources;
}

/**
 * Capture entire screen
 */
export const captureScreenTool: AgentTool = {
  name: 'capture_screen',
  description: 'Capture a screenshot of the entire screen or a specific display.',
  parameters: {
    type: 'object',
    properties: {
      displayIndex: {
        type: 'number',
        description: 'Index of the display to capture (default: 0 for primary)',
      },
      format: {
        type: 'string',
        description: 'Image format: "png" or "jpeg" (default: "png")',
      },
      savePath: {
        type: 'string',
        description: 'Path to save the screenshot (optional, returns base64 if not specified)',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const displayIndex = (params.displayIndex as number) || 0;
      const format = ((params.format as string) || 'png') as 'png' | 'jpeg';
      const savePath = params.savePath as string | undefined;

      // Get all displays
      const displays = screen.getAllDisplays();
      if (displayIndex >= displays.length) {
        return {
          success: false,
          error: `Display ${displayIndex} not found. Available: 0-${displays.length - 1}`,
        };
      }

      const display = displays[displayIndex];

      // Get screen sources
      const sources = await getScreenSources();
      const screenSource = sources.find(
        (s) => s.display_id === display.id.toString() || s.name.includes('Screen')
      );

      if (!screenSource) {
        return { success: false, error: 'Could not find screen source' };
      }

      // Get thumbnail as NativeImage
      const thumbnail = screenSource.thumbnail;
      const imageBuffer = format === 'png' ? thumbnail.toPNG() : thumbnail.toJPEG(90);

      const size = thumbnail.getSize();

      let resultPath: string | undefined;
      let base64: string | undefined;

      if (savePath) {
        // Ensure directory exists
        await fs.mkdir(path.dirname(savePath), { recursive: true });
        await fs.writeFile(savePath, imageBuffer);
        resultPath = savePath;
        logger.info('Screenshot saved', { path: savePath });
      } else {
        base64 = imageBuffer.toString('base64');
      }

      const result: ScreenshotResult = {
        path: resultPath,
        base64,
        width: size.width,
        height: size.height,
        format,
        size: imageBuffer.length,
        timestamp: new Date().toISOString(),
        source: screenSource.name,
      };

      return { success: true, data: result };
    } catch (error) {
      const err = error as Error;
      logger.error('Screen capture failed', { error: err.message });
      return { success: false, error: err.message };
    }
  },
};

/**
 * Capture specific window
 */
export const captureWindowTool: AgentTool = {
  name: 'capture_window',
  description: 'Capture a screenshot of a specific window by name.',
  parameters: {
    type: 'object',
    properties: {
      windowName: {
        type: 'string',
        description: 'Name or partial name of the window to capture',
      },
      format: {
        type: 'string',
        description: 'Image format: "png" or "jpeg" (default: "png")',
      },
      savePath: {
        type: 'string',
        description: 'Path to save the screenshot (optional, returns base64 if not specified)',
      },
    },
    required: ['windowName'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const windowName = params.windowName as string;
      const format = ((params.format as string) || 'png') as 'png' | 'jpeg';
      const savePath = params.savePath as string | undefined;

      // Get window sources
      const sources = await getScreenSources();
      const windowSource = sources.find((s) =>
        s.name.toLowerCase().includes(windowName.toLowerCase())
      );

      if (!windowSource) {
        const availableWindows = sources.map((s) => s.name).join(', ');
        return {
          success: false,
          error: `Window "${windowName}" not found. Available: ${availableWindows}`,
        };
      }

      // Get thumbnail as NativeImage
      const thumbnail = windowSource.thumbnail;
      const imageBuffer = format === 'png' ? thumbnail.toPNG() : thumbnail.toJPEG(90);

      const size = thumbnail.getSize();

      let resultPath: string | undefined;
      let base64: string | undefined;

      if (savePath) {
        await fs.mkdir(path.dirname(savePath), { recursive: true });
        await fs.writeFile(savePath, imageBuffer);
        resultPath = savePath;
        logger.info('Window screenshot saved', { path: savePath, window: windowSource.name });
      } else {
        base64 = imageBuffer.toString('base64');
      }

      const result: ScreenshotResult = {
        path: resultPath,
        base64,
        width: size.width,
        height: size.height,
        format,
        size: imageBuffer.length,
        timestamp: new Date().toISOString(),
        source: windowSource.name,
      };

      return { success: true, data: result };
    } catch (error) {
      const err = error as Error;
      logger.error('Window capture failed', { error: err.message });
      return { success: false, error: err.message };
    }
  },
};

/**
 * List available capture sources
 */
export const listCaptureSourcesTool: AgentTool = {
  name: 'list_capture_sources',
  description: 'List all available screens and windows that can be captured.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (): Promise<ActionResult> => {
    try {
      const sources = await getScreenSources();
      const displays = screen.getAllDisplays();

      const screenSources = sources
        .filter((s) => s.id.startsWith('screen:'))
        .map((s, _i) => ({
          type: 'screen',
          name: s.name,
          id: s.id,
          displayId: s.display_id,
        }));

      const windowSources = sources
        .filter((s) => s.id.startsWith('window:'))
        .map((s) => ({
          type: 'window',
          name: s.name,
          id: s.id,
        }));

      const displayInfo = displays.map((d, i) => ({
        index: i,
        id: d.id,
        bounds: d.bounds,
        workArea: d.workArea,
        scaleFactor: d.scaleFactor,
        isPrimary: d.bounds.x === 0 && d.bounds.y === 0,
      }));

      logger.info('Listed capture sources', {
        screens: screenSources.length,
        windows: windowSources.length,
      });

      return {
        success: true,
        data: {
          displays: displayInfo,
          screens: screenSources,
          windows: windowSources,
        },
      };
    } catch (error) {
      const err = error as Error;
      logger.error('List sources failed', { error: err.message });
      return { success: false, error: err.message };
    }
  },
};

/**
 * Get all screenshot tools
 */
export function getScreenshotTools(): AgentTool[] {
  return [captureScreenTool, captureWindowTool, listCaptureSourcesTool];
}

export default {
  getScreenshotTools,
  captureScreenTool,
  captureWindowTool,
  listCaptureSourcesTool,
};
