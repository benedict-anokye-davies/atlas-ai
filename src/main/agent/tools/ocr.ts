/**
 * Atlas Desktop - OCR Tool using Tesseract.js
 * Local offline text extraction from images and screenshots
 *
 * Features:
 * - Extract text from images (PNG, JPEG, BMP, etc.)
 * - Extract text from screenshot buffers
 * - Support for multiple languages
 * - Word-level bounding boxes for automation
 * - Confidence scores for text recognition
 *
 * NOTE: OCR is currently DISABLED due to tesseract.js v5 Worker incompatibility
 * with Electron's main process. All OCR tools return empty results.
 * Will be re-enabled when using a worker thread solution.
 *
 * @module agent/tools/ocr
 */

import { AgentTool, ActionResult } from '../../../shared/types/agent';
import { createModuleLogger, PerformanceTimer } from '../../utils/logger';
// DISABLED: tesseract.js v5 Worker crashes in Electron main process
// import { createWorker, Worker, PSM, OEM } from 'tesseract.js';
import { desktopCapturer, screen, nativeImage } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

// OCR is disabled - tesseract.js v5 has compatibility issues with Electron main process
const OCR_ENABLED = false;

// Placeholder types since we're not importing tesseract.js
type Worker = unknown;
enum PSM {
  OSD_ONLY = 0,
  AUTO_OSD = 1,
  AUTO_ONLY = 2,
  AUTO = 3,
  SINGLE_COLUMN = 4,
  SINGLE_BLOCK_VERT_TEXT = 5,
  SINGLE_BLOCK = 6,
  SINGLE_LINE = 7,
  SINGLE_WORD = 8,
  CIRCLE_WORD = 9,
  SINGLE_CHAR = 10,
  SPARSE_TEXT = 11,
  SPARSE_TEXT_OSD = 12,
  RAW_LINE = 13,
}
enum OEM {
  TESSERACT_ONLY = 0,
  LSTM_ONLY = 1,
  TESSERACT_LSTM_COMBINED = 2,
  DEFAULT = 3,
}

const logger = createModuleLogger('OCR');
const perfTimer = new PerformanceTimer('OCR');

// =============================================================================
// Types and Interfaces
// =============================================================================

/**
 * Supported languages for OCR
 */
export type OCRLanguage =
  | 'eng' // English
  | 'spa' // Spanish
  | 'fra' // French
  | 'deu' // German
  | 'ita' // Italian
  | 'por' // Portuguese
  | 'nld' // Dutch
  | 'pol' // Polish
  | 'rus' // Russian
  | 'jpn' // Japanese
  | 'chi_sim' // Chinese Simplified
  | 'chi_tra' // Chinese Traditional
  | 'kor' // Korean
  | 'ara'; // Arabic

/**
 * OCR configuration options
 */
export interface OCRConfig {
  /** Language(s) for recognition */
  language?: OCRLanguage | OCRLanguage[];
  /** Page segmentation mode */
  pageSegMode?: PSM;
  /** OCR engine mode */
  ocrEngineMode?: OEM;
  /** Whether to include word-level data */
  includeWordData?: boolean;
  /** Whether to include line-level data */
  includeLineData?: boolean;
  /** Whether to include paragraph-level data */
  includeParagraphData?: boolean;
  /** Minimum confidence threshold (0-100) */
  minConfidence?: number;
  /** Cache directory for Tesseract data */
  cacheDir?: string;
}

/**
 * Word-level OCR result
 */
export interface OCRWord {
  /** Recognized text */
  text: string;
  /** Confidence score (0-100) */
  confidence: number;
  /** Bounding box */
  bbox: {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  };
  /** Baseline (for text alignment) */
  baseline?: {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  };
}

/**
 * Line-level OCR result
 */
export interface OCRLine {
  /** Line text */
  text: string;
  /** Confidence score */
  confidence: number;
  /** Bounding box */
  bbox: {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  };
  /** Words in this line */
  words?: OCRWord[];
}

/**
 * Paragraph-level OCR result
 */
export interface OCRParagraph {
  /** Paragraph text */
  text: string;
  /** Confidence score */
  confidence: number;
  /** Bounding box */
  bbox: {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  };
  /** Lines in this paragraph */
  lines?: OCRLine[];
}

/**
 * Full OCR result
 */
export interface OCRResult {
  /** Full extracted text */
  text: string;
  /** Overall confidence score */
  confidence: number;
  /** Image dimensions */
  dimensions: {
    width: number;
    height: number;
  };
  /** Processing time in ms */
  processingTime: number;
  /** Language used */
  language: string;
  /** Paragraphs (if requested) */
  paragraphs?: OCRParagraph[];
  /** Lines (if requested) */
  lines?: OCRLine[];
  /** Words (if requested) */
  words?: OCRWord[];
  /** Word count */
  wordCount: number;
  /** Line count */
  lineCount: number;
}

// =============================================================================
// Default Configuration
// =============================================================================

const DEFAULT_CONFIG: Required<OCRConfig> = {
  language: 'eng',
  pageSegMode: PSM.AUTO,
  ocrEngineMode: OEM.DEFAULT,
  includeWordData: false,
  includeLineData: false,
  includeParagraphData: false,
  minConfidence: 0,
  cacheDir: path.join(os.homedir(), '.atlas', 'tesseract'),
};

// =============================================================================
// OCR Manager Class
// =============================================================================

/**
 * OCR Manager - Handles text extraction using Tesseract.js
 * NOTE: Currently disabled due to tesseract.js v5 compatibility issues
 */
export class OCRManager {
  private worker: Worker | null = null;
  private config: Required<OCRConfig>;
  private initialized = false;
  private initializing = false;

  constructor(config: OCRConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Check if OCR is available
   */
  isAvailable(): boolean {
    return OCR_ENABLED;
  }

  /**
   * Initialize the Tesseract worker
   * Currently disabled - returns immediately without creating worker
   */
  async initialize(): Promise<void> {
    if (this.initialized || this.initializing) return;
    this.initializing = true;

    // OCR is disabled - just mark as initialized
    if (!OCR_ENABLED) {
      logger.info('OCR disabled - tesseract.js v5 has compatibility issues with Electron main process');
      this.initialized = true;
      this.initializing = false;
      return;
    }

    // OCR is disabled at compile time - this code will never run
    throw new Error('OCR is disabled. Set OCR_ENABLED = true to enable.');

    /*
    // DISABLED: tesseract.js v5 Worker crashes in Electron main process
    perfTimer.start('initialize');

    try {
      // Ensure cache directory exists
      await fs.mkdir(this.config.cacheDir, { recursive: true });

      // Dynamic import to avoid loading tesseract.js when disabled
      const { createWorker } = await import('tesseract.js');

      // Create worker with language
      const langs = Array.isArray(this.config.language)
        ? this.config.language.join('+')
        : this.config.language;

      this.worker = await createWorker(langs, this.config.ocrEngineMode, {
        cachePath: this.config.cacheDir,
        logger: (m: { status: string; progress?: number }) => {
          if (m.status === 'recognizing text') {
            // Only log significant progress
            if (m.progress && m.progress % 0.25 < 0.01) {
              logger.debug('OCR progress', { progress: Math.round(m.progress * 100) });
            }
          }
        },
      });

      // Set parameters - tesseract.js v5 uses PSM enum directly
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (this.worker as any).setParameters({
        tessedit_pageseg_mode: this.config.pageSegMode,
      });

      this.initialized = true;
      logger.info('OCR Manager initialized', { language: langs });

      perfTimer.end('initialize');
    } catch (error) {
      this.initializing = false;
      perfTimer.end('initialize');
      throw error;
    }
    */
  }

  /**
   * Ensure worker is ready
   * Returns null if OCR is disabled
   */
  private async ensureWorker(): Promise<Worker | null> {
    if (!OCR_ENABLED) {
      return null;
    }
    if (!this.initialized) {
      await this.initialize();
    }
    if (!this.worker) {
      throw new Error('OCR worker not initialized');
    }
    return this.worker;
  }

  /**
   * Extract text from an image buffer
   * Returns empty result if OCR is disabled
   */
  async extractFromBuffer(
    imageBuffer: Buffer,
    options: Partial<OCRConfig> = {}
  ): Promise<OCRResult> {
    // Return empty result if OCR is disabled
    if (!OCR_ENABLED) {
      return {
        text: '',
        confidence: 0,
        wordCount: 0,
        lineCount: 0,
        paragraphCount: 0,
        processingTime: 0,
        words: [],
        lines: [],
        paragraphs: [],
      };
    }

    perfTimer.start('extractFromBuffer');

    const startTime = Date.now();
    const worker = await this.ensureWorker();

    if (!worker) {
      return {
        text: '',
        confidence: 0,
        wordCount: 0,
        lineCount: 0,
        paragraphCount: 0,
        processingTime: 0,
        words: [],
        lines: [],
        paragraphs: [],
      };
    }

    const mergedConfig = { ...this.config, ...options };

    try {
      // Perform OCR
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (worker as any).recognize(imageBuffer);

      // Build result
      const ocrResult = this.buildResult(result, Date.now() - startTime, mergedConfig);

      logger.info('OCR completed', {
        wordCount: ocrResult.wordCount,
        confidence: ocrResult.confidence.toFixed(1),
        processingTime: ocrResult.processingTime,
      });

      perfTimer.end('extractFromBuffer');
      return ocrResult;
    } catch (error) {
      perfTimer.end('extractFromBuffer');
      throw error;
    }
  }

  /**
   * Extract text from an image file
   */
  async extractFromFile(filePath: string, options: Partial<OCRConfig> = {}): Promise<OCRResult> {
    perfTimer.start('extractFromFile');

    try {
      // Read file
      const imageBuffer = await fs.readFile(filePath);

      const result = await this.extractFromBuffer(imageBuffer, options);

      perfTimer.end('extractFromFile');
      return result;
    } catch (error) {
      perfTimer.end('extractFromFile');
      throw error;
    }
  }

  /**
   * Extract text from a base64 encoded image
   */
  async extractFromBase64(
    base64Data: string,
    options: Partial<OCRConfig> = {}
  ): Promise<OCRResult> {
    // Remove data URL prefix if present
    const cleanBase64 = base64Data.replace(/^data:image\/\w+;base64,/, '');
    const imageBuffer = Buffer.from(cleanBase64, 'base64');
    return this.extractFromBuffer(imageBuffer, options);
  }

  /**
   * Build OCR result from Tesseract output
   */
  private buildResult(
    result: Awaited<ReturnType<Worker['recognize']>>,
    processingTime: number,
    config: Required<OCRConfig>
  ): OCRResult {
    const { data } = result;

    // Filter by confidence if threshold set
    const minConf = config.minConfidence;

    // Build words if requested
    let words: OCRWord[] | undefined;
    if (config.includeWordData && data.words) {
      words = data.words
        .filter((w) => w.confidence >= minConf)
        .map((w) => ({
          text: w.text,
          confidence: w.confidence,
          bbox: {
            x0: w.bbox.x0,
            y0: w.bbox.y0,
            x1: w.bbox.x1,
            y1: w.bbox.y1,
          },
          baseline: w.baseline
            ? {
                x0: w.baseline.x0,
                y0: w.baseline.y0,
                x1: w.baseline.x1,
                y1: w.baseline.y1,
              }
            : undefined,
        }));
    }

    // Build lines if requested
    let lines: OCRLine[] | undefined;
    if (config.includeLineData && data.lines) {
      lines = data.lines
        .filter((l) => l.confidence >= minConf)
        .map((l) => ({
          text: l.text,
          confidence: l.confidence,
          bbox: {
            x0: l.bbox.x0,
            y0: l.bbox.y0,
            x1: l.bbox.x1,
            y1: l.bbox.y1,
          },
          words: config.includeWordData
            ? l.words
                ?.filter((w) => w.confidence >= minConf)
                .map((w) => ({
                  text: w.text,
                  confidence: w.confidence,
                  bbox: {
                    x0: w.bbox.x0,
                    y0: w.bbox.y0,
                    x1: w.bbox.x1,
                    y1: w.bbox.y1,
                  },
                }))
            : undefined,
        }));
    }

    // Build paragraphs if requested
    let paragraphs: OCRParagraph[] | undefined;
    if (config.includeParagraphData && data.paragraphs) {
      paragraphs = data.paragraphs
        .filter((p) => p.confidence >= minConf)
        .map((p) => ({
          text: p.text,
          confidence: p.confidence,
          bbox: {
            x0: p.bbox.x0,
            y0: p.bbox.y0,
            x1: p.bbox.x1,
            y1: p.bbox.y1,
          },
          lines: config.includeLineData
            ? p.lines
                ?.filter((l) => l.confidence >= minConf)
                .map((l) => ({
                  text: l.text,
                  confidence: l.confidence,
                  bbox: {
                    x0: l.bbox.x0,
                    y0: l.bbox.y0,
                    x1: l.bbox.x1,
                    y1: l.bbox.y1,
                  },
                }))
            : undefined,
        }));
    }

    return {
      text: data.text,
      confidence: data.confidence,
      dimensions: {
        // tesseract.js v5 may not expose image dimensions directly
        // Use bbox of first block/paragraph as approximation, or 0 if unavailable
        width:
          (data as unknown as { imageWidth?: number }).imageWidth ||
          data.blocks?.[0]?.bbox?.x1 ||
          0,
        height:
          (data as unknown as { imageHeight?: number }).imageHeight ||
          data.blocks?.[0]?.bbox?.y1 ||
          0,
      },
      processingTime,
      language: Array.isArray(config.language) ? config.language.join('+') : config.language,
      paragraphs,
      lines,
      words,
      wordCount: data.words?.length || 0,
      lineCount: data.lines?.length || 0,
    };
  }

  /**
   * Change the recognition language
   */
  async setLanguage(language: OCRLanguage | OCRLanguage[]): Promise<void> {
    if (!OCR_ENABLED) {
      this.config.language = language;
      return;
    }
    if (this.worker) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (this.worker as any).terminate();
      this.worker = null;
      this.initialized = false;
    }
    this.config.language = language;
    await this.initialize();
  }

  /**
   * Terminate the OCR worker
   */
  async terminate(): Promise<void> {
    if (!OCR_ENABLED) {
      this.initialized = false;
      return;
    }
    if (this.worker) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (this.worker as any).terminate();
      this.worker = null;
      this.initialized = false;
      logger.info('OCR worker terminated');
    }
  }

  /**
   * Check if worker is initialized
   */
  isReady(): boolean {
    return this.initialized;
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let ocrInstance: OCRManager | null = null;

/**
 * Get or create the singleton OCR manager
 */
export function getOCRManager(config?: OCRConfig): OCRManager {
  if (!ocrInstance) {
    ocrInstance = new OCRManager(config);
  }
  return ocrInstance;
}

/**
 * Shutdown the OCR manager
 */
export async function shutdownOCR(): Promise<void> {
  if (ocrInstance) {
    await ocrInstance.terminate();
    ocrInstance = null;
  }
}

// =============================================================================
// Agent Tools
// =============================================================================

/**
 * Extract text from image file tool
 */
export const extractTextFromImageTool: AgentTool = {
  name: 'extract_text_from_image',
  description:
    'Extract text from an image file using OCR. Supports PNG, JPEG, BMP, and other common formats. Works offline without API calls.',
  parameters: {
    type: 'object',
    properties: {
      imagePath: {
        type: 'string',
        description: 'Path to the image file',
      },
      language: {
        type: 'string',
        description:
          'Language code for OCR (default: "eng"). Use "+" for multiple, e.g., "eng+spa"',
      },
      includeWordData: {
        type: 'boolean',
        description: 'Include word-level bounding boxes (default: false)',
      },
      includeLineData: {
        type: 'boolean',
        description: 'Include line-level data (default: false)',
      },
      minConfidence: {
        type: 'number',
        description: 'Minimum confidence threshold 0-100 (default: 0)',
      },
    },
    required: ['imagePath'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const imagePath = params.imagePath as string;
      const language = (params.language as string) || 'eng';
      const includeWordData = params.includeWordData as boolean;
      const includeLineData = params.includeLineData as boolean;
      const minConfidence = params.minConfidence as number;

      // Verify file exists
      try {
        await fs.access(imagePath);
      } catch {
        return { success: false, error: `Image file not found: ${imagePath}` };
      }

      // Get OCR manager
      const ocr = getOCRManager();

      // Set language if different
      const langs = language.split('+') as OCRLanguage[];
      if (langs.length === 1) {
        await ocr.setLanguage(langs[0]);
      } else {
        await ocr.setLanguage(langs);
      }

      // Extract text
      const result = await ocr.extractFromFile(imagePath, {
        includeWordData,
        includeLineData,
        minConfidence,
      });

      logger.info('Text extracted from image', {
        path: imagePath,
        wordCount: result.wordCount,
        confidence: result.confidence.toFixed(1),
      });

      return { success: true, data: result };
    } catch (error) {
      const err = error as Error;
      logger.error('OCR extraction failed', { error: err.message });
      return { success: false, error: err.message };
    }
  },
};

/**
 * Extract text from screenshot buffer tool (for integration with screenshot tools)
 */
export const extractTextFromScreenshotTool: AgentTool = {
  name: 'extract_text_from_screenshot',
  description:
    'Extract text from a screenshot buffer (base64 encoded). Use this after capturing a screenshot with capture_screen or capture_window.',
  parameters: {
    type: 'object',
    properties: {
      base64Image: {
        type: 'string',
        description: 'Base64 encoded image data',
      },
      language: {
        type: 'string',
        description: 'Language code for OCR (default: "eng")',
      },
      includeWordData: {
        type: 'boolean',
        description: 'Include word-level bounding boxes for automation (default: false)',
      },
      minConfidence: {
        type: 'number',
        description: 'Minimum confidence threshold 0-100 (default: 0)',
      },
    },
    required: ['base64Image'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const base64Image = params.base64Image as string;
      const language = (params.language as string) || 'eng';
      const includeWordData = params.includeWordData as boolean;
      const minConfidence = params.minConfidence as number;

      // Get OCR manager
      const ocr = getOCRManager();

      // Set language
      const langs = language.split('+') as OCRLanguage[];
      if (langs.length === 1) {
        await ocr.setLanguage(langs[0]);
      } else {
        await ocr.setLanguage(langs);
      }

      // Extract text
      const result = await ocr.extractFromBase64(base64Image, {
        includeWordData,
        minConfidence,
      });

      logger.info('Text extracted from screenshot', {
        wordCount: result.wordCount,
        confidence: result.confidence.toFixed(1),
      });

      return { success: true, data: result };
    } catch (error) {
      const err = error as Error;
      logger.error('Screenshot OCR failed', { error: err.message });
      return { success: false, error: err.message };
    }
  },
};

/**
 * Find text location in image tool (for automation)
 */
export const findTextInImageTool: AgentTool = {
  name: 'find_text_in_image',
  description:
    'Find the location of specific text in an image. Returns bounding box coordinates for automation (clicking, etc.).',
  parameters: {
    type: 'object',
    properties: {
      imagePath: {
        type: 'string',
        description: 'Path to the image file (or use base64Image)',
      },
      base64Image: {
        type: 'string',
        description: 'Base64 encoded image data (alternative to imagePath)',
      },
      searchText: {
        type: 'string',
        description: 'Text to search for (case-insensitive)',
      },
      language: {
        type: 'string',
        description: 'Language code for OCR (default: "eng")',
      },
      exactMatch: {
        type: 'boolean',
        description: 'Require exact match (default: false, uses partial matching)',
      },
    },
    required: ['searchText'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const imagePath = params.imagePath as string | undefined;
      const base64Image = params.base64Image as string | undefined;
      const searchText = params.searchText as string;
      const language = (params.language as string) || 'eng';
      const exactMatch = params.exactMatch as boolean;

      if (!imagePath && !base64Image) {
        return { success: false, error: 'Either imagePath or base64Image is required' };
      }

      // Get OCR manager
      const ocr = getOCRManager();

      // Set language
      await ocr.setLanguage(language as OCRLanguage);

      // Extract with word data
      let result: OCRResult;
      if (imagePath) {
        result = await ocr.extractFromFile(imagePath, { includeWordData: true });
      } else {
        result = await ocr.extractFromBase64(base64Image!, { includeWordData: true });
      }

      // Search for text
      const searchLower = searchText.toLowerCase();
      const matches: Array<{ text: string; bbox: OCRWord['bbox']; confidence: number }> = [];

      if (result.words) {
        for (const word of result.words) {
          const wordLower = word.text.toLowerCase();
          if (exactMatch) {
            if (wordLower === searchLower) {
              matches.push({
                text: word.text,
                bbox: word.bbox,
                confidence: word.confidence,
              });
            }
          } else {
            if (wordLower.includes(searchLower) || searchLower.includes(wordLower)) {
              matches.push({
                text: word.text,
                bbox: word.bbox,
                confidence: word.confidence,
              });
            }
          }
        }
      }

      // Also check lines for multi-word matches
      if (result.lines && searchText.includes(' ')) {
        for (const line of result.lines) {
          const lineLower = line.text.toLowerCase();
          if (exactMatch) {
            if (lineLower.includes(searchLower)) {
              matches.push({
                text: line.text,
                bbox: line.bbox,
                confidence: line.confidence,
              });
            }
          } else {
            if (lineLower.includes(searchLower)) {
              matches.push({
                text: line.text,
                bbox: line.bbox,
                confidence: line.confidence,
              });
            }
          }
        }
      }

      logger.info('Text search completed', {
        searchText,
        matchCount: matches.length,
      });

      return {
        success: true,
        data: {
          found: matches.length > 0,
          matches,
          matchCount: matches.length,
          imageDimensions: result.dimensions,
        },
      };
    } catch (error) {
      const err = error as Error;
      logger.error('Text search failed', { error: err.message });
      return { success: false, error: err.message };
    }
  },
};

/**
 * Get available OCR languages tool
 */
export const listOCRLanguagesTool: AgentTool = {
  name: 'list_ocr_languages',
  description: 'List available languages for OCR text extraction.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (): Promise<ActionResult> => {
    const languages = {
      eng: 'English',
      spa: 'Spanish',
      fra: 'French',
      deu: 'German',
      ita: 'Italian',
      por: 'Portuguese',
      nld: 'Dutch',
      pol: 'Polish',
      rus: 'Russian',
      jpn: 'Japanese',
      chi_sim: 'Chinese (Simplified)',
      chi_tra: 'Chinese (Traditional)',
      kor: 'Korean',
      ara: 'Arabic',
    };

    return {
      success: true,
      data: {
        languages,
        note: 'Use language codes. Multiple languages can be combined with "+", e.g., "eng+spa"',
      },
    };
  },
};

// =============================================================================
// Screen Capture OCR Tools
// =============================================================================

/**
 * Helper function to capture screen as PNG buffer
 */
async function captureScreenBuffer(displayIndex = 0): Promise<Buffer> {
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

  return screenSource.thumbnail.toPNG();
}

/**
 * Helper function to crop image buffer to a region
 */
function cropImageBuffer(
  imageBuffer: Buffer,
  region: { x: number; y: number; width: number; height: number }
): Buffer {
  const image = nativeImage.createFromBuffer(imageBuffer);
  const cropped = image.crop(region);
  return cropped.toPNG();
}

/**
 * OCR extract text from current screen
 */
export const ocrExtractScreenTool: AgentTool = {
  name: 'ocr_extract_screen',
  description:
    'Capture the current screen and extract all text using local OCR (Tesseract). Works offline without API calls. Useful for reading on-screen content.',
  parameters: {
    type: 'object',
    properties: {
      displayIndex: {
        type: 'number',
        description: 'Index of the display to capture (default: 0 for primary)',
      },
      language: {
        type: 'string',
        description:
          'Language code for OCR (default: "eng"). Use "+" for multiple, e.g., "eng+spa"',
      },
      includeWordData: {
        type: 'boolean',
        description: 'Include word-level bounding boxes for automation (default: false)',
      },
      includeLineData: {
        type: 'boolean',
        description: 'Include line-level data (default: false)',
      },
      minConfidence: {
        type: 'number',
        description: 'Minimum confidence threshold 0-100 (default: 0)',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const displayIndex = (params.displayIndex as number) || 0;
      const language = (params.language as string) || 'eng';
      const includeWordData = (params.includeWordData as boolean) ?? false;
      const includeLineData = (params.includeLineData as boolean) ?? false;
      const minConfidence = (params.minConfidence as number) ?? 0;

      // Capture screen
      logger.info('Capturing screen for OCR', { displayIndex });
      const imageBuffer = await captureScreenBuffer(displayIndex);

      // Get OCR manager
      const ocr = getOCRManager();

      // Set language if different
      const langs = language.split('+') as OCRLanguage[];
      if (langs.length === 1) {
        await ocr.setLanguage(langs[0]);
      } else {
        await ocr.setLanguage(langs);
      }

      // Extract text
      const result = await ocr.extractFromBuffer(imageBuffer, {
        includeWordData,
        includeLineData,
        minConfidence,
      });

      logger.info('OCR screen extraction completed', {
        displayIndex,
        wordCount: result.wordCount,
        confidence: result.confidence.toFixed(1),
      });

      return { success: true, data: result };
    } catch (error) {
      const err = error as Error;
      logger.error('OCR screen extraction failed', { error: err.message });
      return { success: false, error: err.message };
    }
  },
};

/**
 * OCR extract text from screen region
 */
export const ocrExtractRegionTool: AgentTool = {
  name: 'ocr_extract_region',
  description:
    'Capture a specific region of the screen and extract text using local OCR (Tesseract). Specify x, y coordinates and width, height in pixels. Works offline.',
  parameters: {
    type: 'object',
    properties: {
      x: {
        type: 'number',
        description: 'X coordinate of the top-left corner of the region',
      },
      y: {
        type: 'number',
        description: 'Y coordinate of the top-left corner of the region',
      },
      width: {
        type: 'number',
        description: 'Width of the region in pixels',
      },
      height: {
        type: 'number',
        description: 'Height of the region in pixels',
      },
      displayIndex: {
        type: 'number',
        description: 'Index of the display to capture from (default: 0 for primary)',
      },
      language: {
        type: 'string',
        description:
          'Language code for OCR (default: "eng"). Use "+" for multiple, e.g., "eng+spa"',
      },
      includeWordData: {
        type: 'boolean',
        description: 'Include word-level bounding boxes for automation (default: false)',
      },
      minConfidence: {
        type: 'number',
        description: 'Minimum confidence threshold 0-100 (default: 0)',
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
      const language = (params.language as string) || 'eng';
      const includeWordData = (params.includeWordData as boolean) ?? false;
      const minConfidence = (params.minConfidence as number) ?? 0;

      // Validate region dimensions
      if (width <= 0 || height <= 0) {
        return { success: false, error: 'Width and height must be positive values' };
      }

      // Capture full screen first
      logger.info('Capturing screen region for OCR', { x, y, width, height, displayIndex });
      const fullScreenBuffer = await captureScreenBuffer(displayIndex);

      // Crop to region
      const croppedBuffer = cropImageBuffer(fullScreenBuffer, { x, y, width, height });

      // Get OCR manager
      const ocr = getOCRManager();

      // Set language
      const langs = language.split('+') as OCRLanguage[];
      if (langs.length === 1) {
        await ocr.setLanguage(langs[0]);
      } else {
        await ocr.setLanguage(langs);
      }

      // Extract text
      const result = await ocr.extractFromBuffer(croppedBuffer, {
        includeWordData,
        minConfidence,
      });

      logger.info('OCR region extraction completed', {
        region: { x, y, width, height },
        wordCount: result.wordCount,
        confidence: result.confidence.toFixed(1),
      });

      return {
        success: true,
        data: {
          ...result,
          region: { x, y, width, height },
        },
      };
    } catch (error) {
      const err = error as Error;
      logger.error('OCR region extraction failed', { error: err.message });
      return { success: false, error: err.message };
    }
  },
};

/**
 * OCR extract text (alias for extract_text_from_image for consistency)
 */
export const ocrExtractTextTool: AgentTool = {
  name: 'ocr_extract_text',
  description:
    'Extract text from an image file using local OCR (Tesseract). Supports PNG, JPEG, BMP formats. Works offline without API calls.',
  parameters: {
    type: 'object',
    properties: {
      imagePath: {
        type: 'string',
        description: 'Path to the image file',
      },
      language: {
        type: 'string',
        description:
          'Language code for OCR (default: "eng"). Use "+" for multiple, e.g., "eng+spa"',
      },
      includeWordData: {
        type: 'boolean',
        description: 'Include word-level bounding boxes (default: false)',
      },
      includeLineData: {
        type: 'boolean',
        description: 'Include line-level data (default: false)',
      },
      minConfidence: {
        type: 'number',
        description: 'Minimum confidence threshold 0-100 (default: 0)',
      },
    },
    required: ['imagePath'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    // Delegate to the existing extract_text_from_image tool
    return extractTextFromImageTool.execute(params);
  },
};

/**
 * Get all OCR tools
 */
export function getOCRTools(): AgentTool[] {
  return [
    extractTextFromImageTool,
    extractTextFromScreenshotTool,
    findTextInImageTool,
    listOCRLanguagesTool,
    ocrExtractScreenTool,
    ocrExtractRegionTool,
    ocrExtractTextTool,
  ];
}

export default {
  OCRManager,
  getOCRManager,
  shutdownOCR,
  getOCRTools,
  extractTextFromImageTool,
  extractTextFromScreenshotTool,
  findTextInImageTool,
  listOCRLanguagesTool,
  ocrExtractScreenTool,
  ocrExtractRegionTool,
  ocrExtractTextTool,
};
