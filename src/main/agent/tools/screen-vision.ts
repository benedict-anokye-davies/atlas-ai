/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Atlas Desktop - Screen Vision Tool
 * Comprehensive screen capture, OCR, and vision analysis
 *
 * Features:
 * - Screen and window capture using Electron desktopCapturer
 * - Local OCR using tesseract.js (no API required)
 * - LLM vision analysis (requires API key)
 * - Privacy blur for sensitive areas using sharp
 * - Region selection for targeted capture
 *
 * @module agent/tools/screen-vision
 */

import { AgentTool, ActionResult } from '../../../shared/types/agent';
import { createModuleLogger, PerformanceTimer } from '../../utils/logger';
import { desktopCapturer, screen } from 'electron';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';

const logger = createModuleLogger('ScreenVision');
const perfTimer = new PerformanceTimer('ScreenVision');

// =============================================================================
// Types and Interfaces
// =============================================================================

/**
 * OCR result interface
 */
export interface OCRResult {
  /** Extracted text */
  text: string;
  /** Confidence level (0-100) */
  confidence: number;
  /** Word-level details */
  words?: Array<{
    text: string;
    confidence: number;
    bbox: { x0: number; y0: number; x1: number; y1: number };
  }>;
  /** Processing time in ms */
  processingTime: number;
}

/**
 * Screen capture result
 */
export interface CaptureResult {
  /** Image buffer (PNG format) */
  buffer: Buffer;
  /** Image as base64 string */
  base64: string;
  /** Image width */
  width: number;
  /** Image height */
  height: number;
  /** Source name (screen or window) */
  source: string;
  /** Timestamp of capture */
  timestamp: string;
}

/**
 * Privacy region to blur
 */
export interface VisionPrivacyRegion {
  /** X coordinate in pixels */
  x: number;
  /** Y coordinate in pixels */
  y: number;
  /** Width in pixels */
  width: number;
  /** Height in pixels */
  height: number;
}

// =============================================================================
// Lazy Loading for Heavy Dependencies
// =============================================================================

import { getOCRWorkerPool, OCRWorkerPool } from '../../utils/ocr-worker-pool';

let ocrPool: OCRWorkerPool | null = null;
let sharpModule: any = null;

/**
 * Get or create OCR worker pool (shared singleton)
 * Returns the pool even if OCR is disabled - the pool handles returning empty results
 */
async function getOCRPool(): Promise<OCRWorkerPool> {
  if (ocrPool) {
    return ocrPool;
  }

  try {
    // Use shared OCR worker pool (prevents duplicate workers and log flooding)
    ocrPool = getOCRWorkerPool({
      maxWorkers: 1,
      enableProgressLogging: false, // Disable to prevent log flooding
    });
    await ocrPool.initialize();
    logger.info('OCR worker pool initialized for screen-vision', { available: ocrPool.isAvailable() });
    return ocrPool;
  } catch (error) {
    logger.warn('OCR initialization failed - OCR features will be unavailable', { error: (error as Error).message });
    // Return the pool anyway - it will return empty results when OCR is disabled
    if (!ocrPool) {
      ocrPool = getOCRWorkerPool({ maxWorkers: 1, enableProgressLogging: false });
    }
    return ocrPool;
  }
}

/**
 * Get sharp module
 */
async function getSharp(): Promise<any> {
  if (sharpModule) {
    return sharpModule;
  }

  try {
    sharpModule = (await import('sharp')).default;
    logger.info('Sharp image processing initialized');
    return sharpModule;
  } catch (error) {
    logger.error('Failed to initialize Sharp', { error: (error as Error).message });
    throw new Error('Sharp is not available. Install with: npm install sharp');
  }
}

// =============================================================================
// Core Functions
// =============================================================================

/**
 * Capture the entire screen or a specific display
 */
export async function captureScreen(displayIndex = 0): Promise<CaptureResult> {
  perfTimer.start('captureScreen');

  try {
    const displays = screen.getAllDisplays();
    if (displayIndex >= displays.length) {
      throw new Error(`Display ${displayIndex} not found. Available: 0-${displays.length - 1}`);
    }

    const display = displays[displayIndex];
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: display.bounds.width, height: display.bounds.height },
    });

    const screenSource = sources.find(
      (s) => s.display_id === display.id.toString() || s.name.includes('Screen')
    );

    if (!screenSource) {
      throw new Error('Could not find screen source');
    }

    const thumbnail = screenSource.thumbnail;
    const buffer = thumbnail.toPNG();
    const size = thumbnail.getSize();

    logger.debug('Screen captured', {
      display: displayIndex,
      size: buffer.length,
      dimensions: size,
    });

    perfTimer.end('captureScreen');

    return {
      buffer,
      base64: buffer.toString('base64'),
      width: size.width,
      height: size.height,
      source: screenSource.name,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    perfTimer.end('captureScreen');
    throw error;
  }
}

/**
 * Capture a specific window by name
 */
export async function captureWindow(windowName: string): Promise<CaptureResult> {
  perfTimer.start('captureWindow');

  try {
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: 1920, height: 1080 },
    });

    const windowSource = sources.find((s) =>
      s.name.toLowerCase().includes(windowName.toLowerCase())
    );

    if (!windowSource) {
      const availableWindows = sources.map((s) => s.name).join(', ');
      throw new Error(`Window "${windowName}" not found. Available: ${availableWindows}`);
    }

    const thumbnail = windowSource.thumbnail;
    const buffer = thumbnail.toPNG();
    const size = thumbnail.getSize();

    logger.debug('Window captured', {
      window: windowSource.name,
      size: buffer.length,
      dimensions: size,
    });

    perfTimer.end('captureWindow');

    return {
      buffer,
      base64: buffer.toString('base64'),
      width: size.width,
      height: size.height,
      source: windowSource.name,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    perfTimer.end('captureWindow');
    throw error;
  }
}

/**
 * List available capture sources (screens and windows)
 */
export async function listCaptureSources(): Promise<{
  displays: Array<{ index: number; id: number; bounds: Electron.Rectangle; isPrimary: boolean }>;
  windows: Array<{ id: string; name: string }>;
}> {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 0, height: 0 }, // We only need the names
  });

  const displays = screen.getAllDisplays().map((d, i) => ({
    index: i,
    id: d.id,
    bounds: d.bounds,
    isPrimary: d.bounds.x === 0 && d.bounds.y === 0,
  }));

  const windows = sources
    .filter((s) => s.id.startsWith('window:'))
    .map((s) => ({
      id: s.id,
      name: s.name,
    }));

  return { displays, windows };
}

/**
 * Perform OCR on an image buffer
 */
export async function performOCR(imageBuffer: Buffer): Promise<OCRResult> {
  perfTimer.start('performOCR');

  try {
    const pool = await getOCRPool();
    const startTime = Date.now();

    const result = await pool.recognize(imageBuffer);

    const processingTime = Date.now() - startTime;

    logger.info('OCR completed', {
      textLength: result.text.length,
      confidence: result.confidence,
      processingTime,
    });

    perfTimer.end('performOCR');

    return {
      text: result.data.text,
      confidence: result.data.confidence,
      words,
      processingTime,
    };
  } catch (error) {
    perfTimer.end('performOCR');
    throw error;
  }
}

/**
 * Apply privacy blur to specified regions
 */
export async function applyPrivacyBlur(
  imageBuffer: Buffer,
  regions: VisionPrivacyRegion[]
): Promise<Buffer> {
  if (regions.length === 0) {
    return imageBuffer;
  }

  perfTimer.start('applyPrivacyBlur');

  try {
    const sharp = await getSharp();

    // Get image dimensions
    const metadata = await sharp(imageBuffer).metadata();
    if (!metadata.width || !metadata.height) {
      throw new Error('Could not get image dimensions');
    }

    // Create composites for blurred regions
    const composites: any[] = [];

    for (const region of regions) {
      // Extract region
      const extractedRegion = await sharp(imageBuffer)
        .extract({
          left: Math.max(0, region.x),
          top: Math.max(0, region.y),
          width: Math.min(region.width, metadata.width - region.x),
          height: Math.min(region.height, metadata.height - region.y),
        })
        .blur(30) // Strong blur for privacy
        .toBuffer();

      composites.push({
        input: extractedRegion,
        left: region.x,
        top: region.y,
      });
    }

    // Composite blurred regions onto original
    const result = await sharp(imageBuffer).composite(composites).png().toBuffer();

    logger.info('Privacy blur applied', { regions: regions.length });
    perfTimer.end('applyPrivacyBlur');

    return result;
  } catch (error) {
    perfTimer.end('applyPrivacyBlur');
    throw error;
  }
}

/**
 * Save image to file
 */
export async function saveImage(imageBuffer: Buffer, filePath?: string): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const savePath =
    filePath || path.join(os.homedir(), '.atlas', 'screenshots', `capture_${timestamp}.png`);

  await fs.mkdir(path.dirname(savePath), { recursive: true });
  await fs.writeFile(savePath, imageBuffer);

  logger.info('Image saved', { path: savePath, size: imageBuffer.length });
  return savePath;
}

// =============================================================================
// Agent Tools
// =============================================================================

/**
 * Capture screen tool
 */
export const visionCaptureScreenTool: AgentTool = {
  name: 'vision_capture_screen',
  description:
    'Capture a screenshot of the entire screen or a specific display. Returns the image as base64.',
  parameters: {
    type: 'object',
    properties: {
      displayIndex: {
        type: 'number',
        description: 'Index of the display to capture (default: 0 for primary)',
      },
      savePath: {
        type: 'string',
        description: 'Optional path to save the screenshot',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const displayIndex = (params.displayIndex as number) || 0;
      const savePath = params.savePath as string | undefined;

      const result = await captureScreen(displayIndex);

      let savedPath: string | undefined;
      if (savePath) {
        savedPath = await saveImage(result.buffer, savePath);
      }

      return {
        success: true,
        data: {
          ...result,
          buffer: undefined, // Don't include buffer in response
          savedPath,
        },
      };
    } catch (error) {
      const err = error as Error;
      logger.error('Screen capture failed', { error: err.message });
      return { success: false, error: err.message };
    }
  },
};

/**
 * Capture window tool
 */
export const visionCaptureWindowTool: AgentTool = {
  name: 'vision_capture_window',
  description: 'Capture a screenshot of a specific window by name. Returns the image as base64.',
  parameters: {
    type: 'object',
    properties: {
      windowName: {
        type: 'string',
        description: 'Name or partial name of the window to capture',
      },
      savePath: {
        type: 'string',
        description: 'Optional path to save the screenshot',
      },
    },
    required: ['windowName'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const windowName = params.windowName as string;
      const savePath = params.savePath as string | undefined;

      const result = await captureWindow(windowName);

      let savedPath: string | undefined;
      if (savePath) {
        savedPath = await saveImage(result.buffer, savePath);
      }

      return {
        success: true,
        data: {
          ...result,
          buffer: undefined,
          savedPath,
        },
      };
    } catch (error) {
      const err = error as Error;
      logger.error('Window capture failed', { error: err.message });
      return { success: false, error: err.message };
    }
  },
};

/**
 * List capture sources tool
 */
export const visionListSourcesTool: AgentTool = {
  name: 'vision_list_sources',
  description: 'List all available screens and windows that can be captured.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (): Promise<ActionResult> => {
    try {
      const sources = await listCaptureSources();
      return {
        success: true,
        data: sources,
      };
    } catch (error) {
      const err = error as Error;
      logger.error('List sources failed', { error: err.message });
      return { success: false, error: err.message };
    }
  },
};

/**
 * OCR tool - extract text from screen
 */
export const ocrScreenTool: AgentTool = {
  name: 'vision_ocr_screen',
  description: 'Capture the screen and extract all text using OCR. Works offline without any API.',
  parameters: {
    type: 'object',
    properties: {
      displayIndex: {
        type: 'number',
        description: 'Index of the display to capture (default: 0)',
      },
      windowName: {
        type: 'string',
        description: 'Optional: capture a specific window instead of full screen',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const displayIndex = (params.displayIndex as number) || 0;
      const windowName = params.windowName as string | undefined;

      // Capture screen or window
      let capture: CaptureResult;
      if (windowName) {
        capture = await captureWindow(windowName);
      } else {
        capture = await captureScreen(displayIndex);
      }

      // Perform OCR
      const ocrResult = await performOCR(capture.buffer);

      return {
        success: true,
        data: {
          text: ocrResult.text,
          confidence: ocrResult.confidence,
          wordCount: ocrResult.words?.length ?? 0,
          processingTime: ocrResult.processingTime,
          source: capture.source,
          timestamp: capture.timestamp,
        },
      };
    } catch (error) {
      const err = error as Error;
      logger.error('OCR failed', { error: err.message });
      return { success: false, error: err.message };
    }
  },
};

/**
 * OCR tool for an existing image
 */
export const ocrImageTool: AgentTool = {
  name: 'vision_ocr_image',
  description: 'Extract text from an image file using OCR. Works offline without any API.',
  parameters: {
    type: 'object',
    properties: {
      imagePath: {
        type: 'string',
        description: 'Path to the image file',
      },
      base64: {
        type: 'string',
        description: 'Alternatively, provide image as base64 string',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      let imageBuffer: Buffer;

      if (params.imagePath) {
        imageBuffer = await fs.readFile(params.imagePath as string);
      } else if (params.base64) {
        imageBuffer = Buffer.from(params.base64 as string, 'base64');
      } else {
        return { success: false, error: 'Either imagePath or base64 is required' };
      }

      const ocrResult = await performOCR(imageBuffer);

      return {
        success: true,
        data: {
          text: ocrResult.text,
          confidence: ocrResult.confidence,
          wordCount: ocrResult.words?.length ?? 0,
          processingTime: ocrResult.processingTime,
        },
      };
    } catch (error) {
      const err = error as Error;
      logger.error('OCR image failed', { error: err.message });
      return { success: false, error: err.message };
    }
  },
};

/**
 * Apply privacy blur tool
 */
export const privacyBlurTool: AgentTool = {
  name: 'vision_privacy_blur',
  description: 'Apply blur to specific regions of a captured image for privacy protection.',
  parameters: {
    type: 'object',
    properties: {
      base64: {
        type: 'string',
        description: 'Image as base64 string',
      },
      regions: {
        type: 'array',
        description: 'Array of regions to blur: [{x, y, width, height}]',
      },
      savePath: {
        type: 'string',
        description: 'Optional path to save the result',
      },
    },
    required: ['base64', 'regions'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const base64 = params.base64 as string;
      const regions = params.regions as VisionPrivacyRegion[];
      const savePath = params.savePath as string | undefined;

      const imageBuffer = Buffer.from(base64, 'base64');
      const blurredBuffer = await applyPrivacyBlur(imageBuffer, regions);

      let savedPath: string | undefined;
      if (savePath) {
        savedPath = await saveImage(blurredBuffer, savePath);
      }

      return {
        success: true,
        data: {
          base64: blurredBuffer.toString('base64'),
          regionsBlurred: regions.length,
          savedPath,
        },
      };
    } catch (error) {
      const err = error as Error;
      logger.error('Privacy blur failed', { error: err.message });
      return { success: false, error: err.message };
    }
  },
};

/**
 * Get all screen vision tools
 */
export function getScreenVisionTools(): AgentTool[] {
  return [
    visionCaptureScreenTool,
    visionCaptureWindowTool,
    visionListSourcesTool,
    ocrScreenTool,
    ocrImageTool,
    privacyBlurTool,
  ];
}

/**
 * Cleanup function - release OCR pool reference
 */
export async function shutdownScreenVision(): Promise<void> {
  // Don't shutdown the shared pool, just release reference
  ocrPool = null;
  logger.info('Screen vision resources released');
}

export default {
  captureScreen,
  captureWindow,
  listCaptureSources,
  performOCR,
  applyPrivacyBlur,
  saveImage,
  getScreenVisionTools,
  shutdownScreenVision,
};
