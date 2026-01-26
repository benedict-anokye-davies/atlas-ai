/**
 * Atlas Desktop - UI Template Matching Tool
 * Find UI elements on screen using template matching
 *
 * Features:
 * - Match template images against screenshots
 * - Find all occurrences of a template
 * - Return click coordinates for automation
 * - Support for multi-scale matching
 * - Confidence threshold filtering
 *
 * Uses normalized cross-correlation (NCC) for matching and sharp for image processing
 *
 * @module agent/tools/template-matching
 */

import { AgentTool, ActionResult } from '../../../shared/types/agent';
import { createModuleLogger, PerformanceTimer } from '../../utils/logger';
import { desktopCapturer, screen, nativeImage } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import robot from '@jitsi/robotjs';

const logger = createModuleLogger('TemplateMatching');
const perfTimer = new PerformanceTimer('TemplateMatching');

// =============================================================================
// Types and Interfaces
// =============================================================================

/**
 * Match result for a template
 */
export interface TemplateMatch {
  /** X coordinate of match (top-left corner) */
  x: number;
  /** Y coordinate of match (top-left corner) */
  y: number;
  /** Width of the matched region */
  width: number;
  /** Height of the matched region */
  height: number;
  /** Center X coordinate (for clicking) */
  centerX: number;
  /** Center Y coordinate (for clicking) */
  centerY: number;
  /** Confidence score (0-1) */
  confidence: number;
  /** Scale at which match was found (1.0 = original) */
  scale: number;
}

/**
 * Simple match result for findOnScreen
 */
export interface SimpleMatch {
  x: number;
  y: number;
  confidence: number;
}

/**
 * Template matching options
 */
export interface TemplateMatchOptions {
  /** Minimum confidence threshold (0-1, default: 0.8) */
  threshold?: number;
  /** Search in grayscale (faster, default: true) */
  grayscale?: boolean;
  /** Scales to search at (default: [1.0]) */
  scales?: number[];
  /** Maximum number of matches to return (default: 10) */
  maxMatches?: number;
  /** Minimum distance between matches in pixels (default: 10) */
  minDistance?: number;
}

// =============================================================================
// Lazy Loading for Sharp
// =============================================================================

let sharpModule: typeof import('sharp') | null = null;

async function getSharp(): Promise<typeof import('sharp')> {
  if (sharpModule) {
    return sharpModule;
  }

  try {
    sharpModule = (await import('sharp')).default;
    logger.info('Sharp image processing initialized for template matching');
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
 * Capture the screen as a buffer
 */
async function captureScreenBuffer(displayIndex = 0): Promise<{
  buffer: Buffer;
  width: number;
  height: number;
}> {
  const displays = screen.getAllDisplays();
  if (displayIndex >= displays.length) {
    throw new Error(`Display ${displayIndex} not found`);
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
  const size = thumbnail.getSize();

  return {
    buffer: thumbnail.toPNG(),
    width: size.width,
    height: size.height,
  };
}

/**
 * Load template image from file or base64
 */
async function loadTemplate(
  templatePath?: string,
  templateBase64?: string
): Promise<{ buffer: Buffer; width: number; height: number }> {
  let buffer: Buffer;

  if (templatePath) {
    buffer = await fs.readFile(templatePath);
  } else if (templateBase64) {
    // Remove data URL prefix if present
    const cleanBase64 = templateBase64.replace(/^data:image\/\w+;base64,/, '');
    buffer = Buffer.from(cleanBase64, 'base64');
  } else {
    throw new Error('Either templatePath or templateBase64 is required');
  }

  const img = nativeImage.createFromBuffer(buffer);
  const size = img.getSize();

  return { buffer, width: size.width, height: size.height };
}

/**
 * Convert image to raw pixel data
 */
async function getPixelData(
  imageBuffer: Buffer,
  grayscale: boolean
): Promise<{ data: Buffer; width: number; height: number; channels: number }> {
  const sharp = await getSharp();

  let pipeline = sharp(imageBuffer);

  if (grayscale) {
    pipeline = pipeline.grayscale();
  }

  const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });

  return {
    data,
    width: info.width,
    height: info.height,
    channels: info.channels,
  };
}

/**
 * Compute normalized cross-correlation at a specific position
 */
function computeNCC(
  sourceData: Buffer,
  templateData: Buffer,
  sourceWidth: number,
  templateWidth: number,
  templateHeight: number,
  channels: number,
  startX: number,
  startY: number
): number {
  let sumSource = 0;
  let sumTemplate = 0;
  let sumSourceSq = 0;
  let sumTemplateSq = 0;
  let sumProduct = 0;
  let count = 0;

  for (let ty = 0; ty < templateHeight; ty++) {
    for (let tx = 0; tx < templateWidth; tx++) {
      const sourceX = startX + tx;
      const sourceY = startY + ty;

      const sourceIdx = (sourceY * sourceWidth + sourceX) * channels;
      const templateIdx = (ty * templateWidth + tx) * channels;

      // Average across channels
      let sourceVal = 0;
      let templateVal = 0;
      for (let c = 0; c < channels; c++) {
        sourceVal += sourceData[sourceIdx + c] || 0;
        templateVal += templateData[templateIdx + c] || 0;
      }
      sourceVal /= channels;
      templateVal /= channels;

      sumSource += sourceVal;
      sumTemplate += templateVal;
      sumSourceSq += sourceVal * sourceVal;
      sumTemplateSq += templateVal * templateVal;
      sumProduct += sourceVal * templateVal;
      count++;
    }
  }

  if (count === 0) return 0;

  const meanSource = sumSource / count;
  const meanTemplate = sumTemplate / count;

  const varSource = sumSourceSq / count - meanSource * meanSource;
  const varTemplate = sumTemplateSq / count - meanTemplate * meanTemplate;

  if (varSource <= 0 || varTemplate <= 0) return 0;

  const covariance = sumProduct / count - meanSource * meanTemplate;
  const correlation = covariance / Math.sqrt(varSource * varTemplate);

  return Math.max(0, Math.min(1, (correlation + 1) / 2)); // Normalize to 0-1
}

/**
 * Find template matches in source image
 */
async function findMatches(
  sourceBuffer: Buffer,
  templateBuffer: Buffer,
  options: Required<TemplateMatchOptions>
): Promise<TemplateMatch[]> {
  perfTimer.start('findMatches');

  const matches: TemplateMatch[] = [];
  const sharp = await getSharp();

  // Get source image data
  const source = await getPixelData(sourceBuffer, options.grayscale);

  for (const scale of options.scales) {
    // Scale template if needed
    let scaledTemplateBuffer = templateBuffer;
    if (scale !== 1.0) {
      const templateMeta = await sharp(templateBuffer).metadata();
      if (templateMeta.width && templateMeta.height) {
        scaledTemplateBuffer = await sharp(templateBuffer)
          .resize(Math.round(templateMeta.width * scale), Math.round(templateMeta.height * scale))
          .toBuffer();
      }
    }

    const template = await getPixelData(scaledTemplateBuffer, options.grayscale);

    // Skip if template is larger than source
    if (template.width > source.width || template.height > source.height) {
      continue;
    }

    // Sliding window search
    const stepX = Math.max(1, Math.floor(template.width / 4));
    const stepY = Math.max(1, Math.floor(template.height / 4));

    for (let y = 0; y <= source.height - template.height; y += stepY) {
      for (let x = 0; x <= source.width - template.width; x += stepX) {
        const confidence = computeNCC(
          source.data,
          template.data,
          source.width,
          template.width,
          template.height,
          source.channels,
          x,
          y
        );

        if (confidence >= options.threshold) {
          // Refine position with smaller steps
          let bestX = x;
          let bestY = y;
          let bestConf = confidence;

          for (
            let ry = Math.max(0, y - stepY);
            ry <= Math.min(source.height - template.height, y + stepY);
            ry++
          ) {
            for (
              let rx = Math.max(0, x - stepX);
              rx <= Math.min(source.width - template.width, x + stepX);
              rx++
            ) {
              const refineConf = computeNCC(
                source.data,
                template.data,
                source.width,
                template.width,
                template.height,
                source.channels,
                rx,
                ry
              );
              if (refineConf > bestConf) {
                bestConf = refineConf;
                bestX = rx;
                bestY = ry;
              }
            }
          }

          // Check if this match is far enough from existing matches
          const isTooClose = matches.some((m) => {
            const dx = Math.abs(m.x - bestX);
            const dy = Math.abs(m.y - bestY);
            return dx < options.minDistance && dy < options.minDistance;
          });

          if (!isTooClose) {
            matches.push({
              x: bestX,
              y: bestY,
              width: template.width,
              height: template.height,
              centerX: bestX + Math.floor(template.width / 2),
              centerY: bestY + Math.floor(template.height / 2),
              confidence: bestConf,
              scale,
            });
          }
        }
      }
    }
  }

  // Sort by confidence and limit results
  matches.sort((a, b) => b.confidence - a.confidence);
  const result = matches.slice(0, options.maxMatches);

  perfTimer.end('findMatches');
  logger.info('Template matching completed', {
    matchesFound: result.length,
    scales: options.scales,
  });

  return result;
}

/**
 * Save a template from the current screen
 */
async function saveTemplate(
  region: { x: number; y: number; width: number; height: number },
  savePath: string,
  displayIndex = 0
): Promise<string> {
  const sharp = await getSharp();
  const { buffer } = await captureScreenBuffer(displayIndex);

  // Extract region
  const templateBuffer = await sharp(buffer)
    .extract({
      left: region.x,
      top: region.y,
      width: region.width,
      height: region.height,
    })
    .png()
    .toBuffer();

  // Ensure directory exists
  await fs.mkdir(path.dirname(savePath), { recursive: true });
  await fs.writeFile(savePath, templateBuffer);

  logger.info('Template saved', { path: savePath, region });
  return savePath;
}

// =============================================================================
// Template Matching Manager Class
// =============================================================================

/**
 * TemplateMatchingManager - Main class for UI element detection
 *
 * Provides a simple API for finding UI elements on screen using template matching.
 * Uses normalized cross-correlation (NCC) algorithm for accurate matching.
 *
 * @example
 * ```typescript
 * const manager = new TemplateMatchingManager();
 *
 * // Find a single element
 * const result = await manager.findOnScreen('./button.png');
 * if (result) {
 *   console.log(`Found at (${result.x}, ${result.y}) with confidence ${result.confidence}`);
 * }
 *
 * // Find all occurrences
 * const allMatches = await manager.findAllOnScreen('./icon.png', { threshold: 0.7 });
 * console.log(`Found ${allMatches.length} matches`);
 * ```
 */
export class TemplateMatchingManager {
  private defaultThreshold: number;
  private defaultScales: number[];

  constructor(options?: { threshold?: number; scales?: number[] }) {
    this.defaultThreshold = options?.threshold ?? 0.8;
    this.defaultScales = options?.scales ?? [1.0];
    logger.info('TemplateMatchingManager initialized', {
      threshold: this.defaultThreshold,
      scales: this.defaultScales,
    });
  }

  /**
   * Find a single UI element on screen by matching a template image.
   * Returns the best match (highest confidence) or null if not found.
   *
   * @param templatePath - Path to the template image file
   * @param options - Optional matching parameters
   * @returns Match coordinates and confidence, or null if not found
   *
   * @example
   * ```typescript
   * const match = await manager.findOnScreen('C:/templates/submit-button.png');
   * if (match) {
   *   robot.moveMouse(match.x, match.y);
   *   robot.mouseClick();
   * }
   * ```
   */
  async findOnScreen(
    templatePath: string,
    options?: {
      threshold?: number;
      displayIndex?: number;
      scales?: number[];
    }
  ): Promise<SimpleMatch | null> {
    try {
      const threshold = options?.threshold ?? this.defaultThreshold;
      const displayIndex = options?.displayIndex ?? 0;
      const scales = options?.scales ?? this.defaultScales;

      // Load template
      const template = await loadTemplate(templatePath);

      // Capture screen
      const screenCapture = await captureScreenBuffer(displayIndex);

      // Find matches
      const matches = await findMatches(screenCapture.buffer, template.buffer, {
        threshold,
        grayscale: true,
        scales,
        maxMatches: 1,
        minDistance: 10,
      });

      if (matches.length === 0) {
        logger.debug('No match found for template', { templatePath, threshold });
        return null;
      }

      const best = matches[0];
      return {
        x: best.centerX,
        y: best.centerY,
        confidence: best.confidence,
      };
    } catch (error) {
      logger.error('findOnScreen failed', { templatePath, error: (error as Error).message });
      throw error;
    }
  }

  /**
   * Find all occurrences of a UI element on screen.
   * Returns all matches above the confidence threshold, sorted by confidence.
   *
   * @param templatePath - Path to the template image file
   * @param options - Optional matching parameters
   * @returns Array of match coordinates and confidences
   *
   * @example
   * ```typescript
   * // Find all checkboxes on screen
   * const checkboxes = await manager.findAllOnScreen('C:/templates/checkbox.png', {
   *   threshold: 0.75,
   *   maxMatches: 20
   * });
   * console.log(`Found ${checkboxes.length} checkboxes`);
   * ```
   */
  async findAllOnScreen(
    templatePath: string,
    options?: {
      threshold?: number;
      displayIndex?: number;
      scales?: number[];
      maxMatches?: number;
    }
  ): Promise<Array<SimpleMatch>> {
    try {
      const threshold = options?.threshold ?? this.defaultThreshold;
      const displayIndex = options?.displayIndex ?? 0;
      const scales = options?.scales ?? this.defaultScales;
      const maxMatches = options?.maxMatches ?? 10;

      // Load template
      const template = await loadTemplate(templatePath);

      // Capture screen
      const screenCapture = await captureScreenBuffer(displayIndex);

      // Find all matches
      const matches = await findMatches(screenCapture.buffer, template.buffer, {
        threshold,
        grayscale: true,
        scales,
        maxMatches,
        minDistance: 10,
      });

      return matches.map((m) => ({
        x: m.centerX,
        y: m.centerY,
        confidence: m.confidence,
      }));
    } catch (error) {
      logger.error('findAllOnScreen failed', { templatePath, error: (error as Error).message });
      throw error;
    }
  }

  /**
   * Find and click a UI element in one operation.
   * Combines findOnScreen with mouse click.
   *
   * @param templatePath - Path to the template image file
   * @param options - Optional parameters
   * @returns Whether the element was found and clicked
   */
  async findAndClick(
    templatePath: string,
    options?: {
      threshold?: number;
      displayIndex?: number;
      button?: 'left' | 'right' | 'double';
      offsetX?: number;
      offsetY?: number;
    }
  ): Promise<{ clicked: boolean; x?: number; y?: number; confidence?: number }> {
    const match = await this.findOnScreen(templatePath, {
      threshold: options?.threshold,
      displayIndex: options?.displayIndex,
    });

    if (!match) {
      return { clicked: false };
    }

    const clickX = match.x + (options?.offsetX ?? 0);
    const clickY = match.y + (options?.offsetY ?? 0);

    robot.moveMouse(clickX, clickY);

    const button = options?.button ?? 'left';
    if (button === 'double') {
      robot.mouseClick('left', true);
    } else {
      robot.mouseClick(button);
    }

    logger.info('Found and clicked element', { templatePath, x: clickX, y: clickY });
    return {
      clicked: true,
      x: clickX,
      y: clickY,
      confidence: match.confidence,
    };
  }

  /**
   * Wait for a UI element to appear on screen.
   *
   * @param templatePath - Path to the template image file
   * @param options - Wait options
   * @returns Match result or null if timeout
   */
  async waitForElement(
    templatePath: string,
    options?: {
      timeout?: number;
      interval?: number;
      threshold?: number;
      displayIndex?: number;
    }
  ): Promise<SimpleMatch | null> {
    const timeout = options?.timeout ?? 10000;
    const interval = options?.interval ?? 500;
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const match = await this.findOnScreen(templatePath, {
        threshold: options?.threshold,
        displayIndex: options?.displayIndex,
      });

      if (match) {
        return match;
      }

      await new Promise((resolve) => setTimeout(resolve, interval));
    }

    return null;
  }

  /**
   * Check if a UI element exists on screen (quick check without waiting).
   */
  async elementExists(
    templatePath: string,
    options?: {
      threshold?: number;
      displayIndex?: number;
    }
  ): Promise<boolean> {
    const match = await this.findOnScreen(templatePath, options);
    return match !== null;
  }
}

// Create singleton instance
let templateMatchingManagerInstance: TemplateMatchingManager | null = null;

/**
 * Get the singleton TemplateMatchingManager instance
 */
export function getTemplateMatchingManager(): TemplateMatchingManager {
  if (!templateMatchingManagerInstance) {
    templateMatchingManagerInstance = new TemplateMatchingManager();
  }
  return templateMatchingManagerInstance;
}

// =============================================================================
// Agent Tools
// =============================================================================

/**
 * Find UI element on screen using template matching
 */
export const uiFindElementTool: AgentTool = {
  name: 'ui_find_element',
  description:
    'Find a UI element on screen by matching a template image. Returns click coordinates for automation. Use this to locate buttons, icons, or any visual element.',
  parameters: {
    type: 'object',
    properties: {
      templatePath: {
        type: 'string',
        description: 'Path to the template image file',
      },
      templateBase64: {
        type: 'string',
        description: 'Template image as base64 (alternative to templatePath)',
      },
      displayIndex: {
        type: 'number',
        description: 'Display index to search on (default: 0)',
      },
      threshold: {
        type: 'number',
        description: 'Minimum confidence threshold 0-1 (default: 0.8)',
      },
      maxMatches: {
        type: 'number',
        description: 'Maximum number of matches to return (default: 10)',
      },
      scales: {
        type: 'array',
        description: 'Scales to search at, e.g., [0.8, 1.0, 1.2] (default: [1.0])',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const templatePath = params.templatePath as string | undefined;
      const templateBase64 = params.templateBase64 as string | undefined;
      const displayIndex = (params.displayIndex as number) || 0;
      const threshold = (params.threshold as number) || 0.8;
      const maxMatches = (params.maxMatches as number) || 10;
      const scales = (params.scales as number[]) || [1.0];

      if (!templatePath && !templateBase64) {
        return { success: false, error: 'Either templatePath or templateBase64 is required' };
      }

      // Load template
      const template = await loadTemplate(templatePath, templateBase64);

      // Capture screen
      const screenCapture = await captureScreenBuffer(displayIndex);

      // Find matches
      const matches = await findMatches(screenCapture.buffer, template.buffer, {
        threshold,
        grayscale: true,
        scales,
        maxMatches,
        minDistance: 10,
      });

      return {
        success: true,
        data: {
          found: matches.length > 0,
          matches,
          matchCount: matches.length,
          screenSize: { width: screenCapture.width, height: screenCapture.height },
          templateSize: { width: template.width, height: template.height },
        },
        metadata: {
          voiceResponse:
            matches.length > 0
              ? `Found ${matches.length} match${matches.length > 1 ? 'es' : ''}`
              : 'Element not found on screen',
        },
      };
    } catch (error) {
      const err = error as Error;
      logger.error('Find UI element failed', { error: err.message });
      return { success: false, error: err.message };
    }
  },
};

// Keep the old name as an alias for backwards compatibility
export const findUIElementTool = uiFindElementTool;

/**
 * Find and click a UI element in one operation.
 * Combines template matching with mouse click.
 */
export const uiClickElementTool: AgentTool = {
  name: 'ui_click_element',
  description:
    'Find a UI element on screen by template image and click it. Combines finding and clicking into one operation. Useful for clicking buttons, icons, links, etc.',
  parameters: {
    type: 'object',
    properties: {
      templatePath: {
        type: 'string',
        description: 'Path to the template image file',
      },
      templateBase64: {
        type: 'string',
        description: 'Template image as base64 (alternative to templatePath)',
      },
      displayIndex: {
        type: 'number',
        description: 'Display index to search on (default: 0)',
      },
      threshold: {
        type: 'number',
        description: 'Minimum confidence threshold 0-1 (default: 0.8)',
      },
      button: {
        type: 'string',
        description: 'Mouse button to click: "left" (default), "right", or "double"',
      },
      offsetX: {
        type: 'number',
        description: 'X offset from center of matched element (default: 0)',
      },
      offsetY: {
        type: 'number',
        description: 'Y offset from center of matched element (default: 0)',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const templatePath = params.templatePath as string | undefined;
      const templateBase64 = params.templateBase64 as string | undefined;
      const displayIndex = (params.displayIndex as number) || 0;
      const threshold = (params.threshold as number) || 0.8;
      const button = (params.button as 'left' | 'right' | 'double') || 'left';
      const offsetX = (params.offsetX as number) || 0;
      const offsetY = (params.offsetY as number) || 0;

      if (!templatePath && !templateBase64) {
        return { success: false, error: 'Either templatePath or templateBase64 is required' };
      }

      // Load template
      const template = await loadTemplate(templatePath, templateBase64);

      // Capture screen
      const screenCapture = await captureScreenBuffer(displayIndex);

      // Find matches
      const matches = await findMatches(screenCapture.buffer, template.buffer, {
        threshold,
        grayscale: true,
        scales: [1.0],
        maxMatches: 1,
        minDistance: 10,
      });

      if (matches.length === 0) {
        return {
          success: true,
          data: {
            clicked: false,
            found: false,
            error: 'Element not found on screen',
          },
          metadata: {
            voiceResponse: 'Element not found on screen',
          },
        };
      }

      const match = matches[0];
      const clickX = match.centerX + offsetX;
      const clickY = match.centerY + offsetY;

      // Move mouse and click
      robot.moveMouse(clickX, clickY);

      if (button === 'double') {
        robot.mouseClick('left', true);
      } else {
        robot.mouseClick(button);
      }

      logger.info('UI element found and clicked', {
        x: clickX,
        y: clickY,
        confidence: match.confidence,
        button,
      });

      return {
        success: true,
        data: {
          clicked: true,
          found: true,
          x: clickX,
          y: clickY,
          confidence: match.confidence,
          match,
        },
        metadata: {
          voiceResponse: `Clicked element at ${clickX}, ${clickY}`,
        },
      };
    } catch (error) {
      const err = error as Error;
      logger.error('UI click element failed', { error: err.message });
      return { success: false, error: err.message };
    }
  },
};

/**
 * Wait for UI element to appear on screen
 */
export const uiWaitForElementTool: AgentTool = {
  name: 'ui_wait_for_element',
  description:
    'Wait for a UI element to appear on screen. Repeatedly checks until found or timeout. Useful for waiting for dialogs, loading states, etc.',
  parameters: {
    type: 'object',
    properties: {
      templatePath: {
        type: 'string',
        description: 'Path to the template image file',
      },
      templateBase64: {
        type: 'string',
        description: 'Template image as base64 (alternative to templatePath)',
      },
      timeout: {
        type: 'number',
        description: 'Maximum time to wait in milliseconds (default: 10000)',
      },
      interval: {
        type: 'number',
        description: 'Check interval in milliseconds (default: 500)',
      },
      displayIndex: {
        type: 'number',
        description: 'Display index to search on (default: 0)',
      },
      threshold: {
        type: 'number',
        description: 'Minimum confidence threshold 0-1 (default: 0.8)',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const templatePath = params.templatePath as string | undefined;
      const templateBase64 = params.templateBase64 as string | undefined;
      const timeout = (params.timeout as number) || 10000;
      const interval = (params.interval as number) || 500;
      const displayIndex = (params.displayIndex as number) || 0;
      const threshold = (params.threshold as number) || 0.8;

      if (!templatePath && !templateBase64) {
        return { success: false, error: 'Either templatePath or templateBase64 is required' };
      }

      // Load template once
      const template = await loadTemplate(templatePath, templateBase64);

      const startTime = Date.now();
      let lastError: string | null = null;

      while (Date.now() - startTime < timeout) {
        try {
          // Capture screen
          const screenCapture = await captureScreenBuffer(displayIndex);

          // Find matches
          const matches = await findMatches(screenCapture.buffer, template.buffer, {
            threshold,
            grayscale: true,
            scales: [1.0],
            maxMatches: 1,
            minDistance: 10,
          });

          if (matches.length > 0) {
            return {
              success: true,
              data: {
                found: true,
                match: matches[0],
                waitTime: Date.now() - startTime,
              },
            };
          }
        } catch (e) {
          lastError = (e as Error).message;
        }

        // Wait before next check
        await new Promise((resolve) => setTimeout(resolve, interval));
      }

      return {
        success: true,
        data: {
          found: false,
          waitTime: timeout,
          error: lastError || 'Element not found within timeout',
        },
      };
    } catch (error) {
      const err = error as Error;
      logger.error('Wait for UI element failed', { error: err.message });
      return { success: false, error: err.message };
    }
  },
};

/**
 * Save a region of the screen as a template
 */
export const saveUITemplateTool: AgentTool = {
  name: 'save_ui_template',
  description:
    'Save a region of the current screen as a template image for later matching. Useful for creating templates of buttons, icons, etc.',
  parameters: {
    type: 'object',
    properties: {
      x: {
        type: 'number',
        description: 'X coordinate of the region (top-left)',
      },
      y: {
        type: 'number',
        description: 'Y coordinate of the region (top-left)',
      },
      width: {
        type: 'number',
        description: 'Width of the region',
      },
      height: {
        type: 'number',
        description: 'Height of the region',
      },
      savePath: {
        type: 'string',
        description:
          'Path to save the template (default: ~/.atlas/templates/template_<timestamp>.png)',
      },
      displayIndex: {
        type: 'number',
        description: 'Display index to capture from (default: 0)',
      },
    },
    required: ['x', 'y', 'width', 'height'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const x = params.x as number;
      const y = params.y as number;
      const width = params.width as number;
      const height = params.height as number;
      const displayIndex = (params.displayIndex as number) || 0;

      // Generate default save path if not provided
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const savePath =
        (params.savePath as string) ||
        path.join(os.homedir(), '.atlas', 'templates', `template_${timestamp}.png`);

      const savedPath = await saveTemplate({ x, y, width, height }, savePath, displayIndex);

      return {
        success: true,
        data: {
          savedPath,
          region: { x, y, width, height },
        },
      };
    } catch (error) {
      const err = error as Error;
      logger.error('Save template failed', { error: err.message });
      return { success: false, error: err.message };
    }
  },
};

/**
 * Check if UI element exists on screen
 */
export const checkUIElementExistsTool: AgentTool = {
  name: 'check_ui_element_exists',
  description:
    'Quickly check if a UI element exists on screen without waiting. Returns true/false.',
  parameters: {
    type: 'object',
    properties: {
      templatePath: {
        type: 'string',
        description: 'Path to the template image file',
      },
      templateBase64: {
        type: 'string',
        description: 'Template image as base64 (alternative to templatePath)',
      },
      displayIndex: {
        type: 'number',
        description: 'Display index to search on (default: 0)',
      },
      threshold: {
        type: 'number',
        description: 'Minimum confidence threshold 0-1 (default: 0.8)',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const templatePath = params.templatePath as string | undefined;
      const templateBase64 = params.templateBase64 as string | undefined;
      const displayIndex = (params.displayIndex as number) || 0;
      const threshold = (params.threshold as number) || 0.8;

      if (!templatePath && !templateBase64) {
        return { success: false, error: 'Either templatePath or templateBase64 is required' };
      }

      // Load template
      const template = await loadTemplate(templatePath, templateBase64);

      // Capture screen
      const screenCapture = await captureScreenBuffer(displayIndex);

      // Find matches (just need to know if any exist)
      const matches = await findMatches(screenCapture.buffer, template.buffer, {
        threshold,
        grayscale: true,
        scales: [1.0],
        maxMatches: 1,
        minDistance: 10,
      });

      return {
        success: true,
        data: {
          exists: matches.length > 0,
          confidence: matches.length > 0 ? matches[0].confidence : 0,
          location: matches.length > 0 ? { x: matches[0].centerX, y: matches[0].centerY } : null,
        },
      };
    } catch (error) {
      const err = error as Error;
      logger.error('Check UI element failed', { error: err.message });
      return { success: false, error: err.message };
    }
  },
};

/**
 * Get all template matching tools
 */
export function getTemplateMatchingTools(): AgentTool[] {
  return [
    uiFindElementTool,
    uiClickElementTool,
    uiWaitForElementTool,
    saveUITemplateTool,
    checkUIElementExistsTool,
  ];
}

// Backwards compatibility aliases
export const waitForUIElementTool = uiWaitForElementTool;

export default {
  // Manager class
  TemplateMatchingManager,
  getTemplateMatchingManager,
  // Primary tools (new naming)
  uiFindElementTool,
  uiClickElementTool,
  uiWaitForElementTool,
  saveUITemplateTool,
  checkUIElementExistsTool,
  // Backwards compatibility aliases
  findUIElementTool,
  waitForUIElementTool,
  // Tool getter
  getTemplateMatchingTools,
};
