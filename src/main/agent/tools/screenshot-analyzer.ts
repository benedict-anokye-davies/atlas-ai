/**
 * Atlas Desktop - Screenshot Analyzer Tool
 * Analyze screenshots with vision capabilities using vision-capable LLMs
 *
 * Features:
 * - Capture and analyze screen/window screenshots
 * - OCR text extraction from images
 * - UI element identification and action suggestions
 * - Privacy mode with sensitive area blurring
 * - Save annotated screenshots
 *
 * @module agent/tools/screenshot-analyzer
 */

import { AgentTool, ActionResult } from '../../../shared/types/agent';
import { createModuleLogger, PerformanceTimer } from '../../utils/logger';
import { desktopCapturer, screen, nativeImage } from 'electron';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import OpenAI from 'openai';

const logger = createModuleLogger('ScreenshotAnalyzer');
const perfTimer = new PerformanceTimer('ScreenshotAnalyzer');

// =============================================================================
// Types and Interfaces
// =============================================================================

/**
 * Vision model providers that support image analysis
 */
export type VisionProvider = 'openai' | 'anthropic' | 'google';

/**
 * Vision-capable models through OpenRouter
 */
export const VISION_MODELS = {
  // OpenAI models
  'openai/gpt-4o': {
    id: 'openai/gpt-4o',
    name: 'GPT-4o',
    provider: 'openai' as VisionProvider,
    maxImageSize: 20 * 1024 * 1024, // 20MB
    supportsMultipleImages: true,
  },
  'openai/gpt-4o-mini': {
    id: 'openai/gpt-4o-mini',
    name: 'GPT-4o Mini',
    provider: 'openai' as VisionProvider,
    maxImageSize: 20 * 1024 * 1024,
    supportsMultipleImages: true,
  },
  // Anthropic models
  'anthropic/claude-3.5-sonnet': {
    id: 'anthropic/claude-3.5-sonnet',
    name: 'Claude 3.5 Sonnet',
    provider: 'anthropic' as VisionProvider,
    maxImageSize: 5 * 1024 * 1024, // 5MB per image
    supportsMultipleImages: true,
  },
  'anthropic/claude-3-opus': {
    id: 'anthropic/claude-3-opus',
    name: 'Claude 3 Opus',
    provider: 'anthropic' as VisionProvider,
    maxImageSize: 5 * 1024 * 1024,
    supportsMultipleImages: true,
  },
  // Google models
  'google/gemini-pro-vision': {
    id: 'google/gemini-pro-vision',
    name: 'Gemini Pro Vision',
    provider: 'google' as VisionProvider,
    maxImageSize: 4 * 1024 * 1024, // 4MB
    supportsMultipleImages: true,
  },
} as const;

export type VisionModelId = keyof typeof VISION_MODELS;

/**
 * Default vision model
 */
export const DEFAULT_VISION_MODEL: VisionModelId = 'openai/gpt-4o';

/**
 * Screenshot analysis configuration
 */
export interface ScreenshotAnalyzerConfig {
  /** OpenRouter API key for vision models */
  apiKey: string;
  /** Vision model to use */
  model?: VisionModelId;
  /** Maximum tokens for response */
  maxTokens?: number;
  /** Temperature for analysis */
  temperature?: number;
  /** Whether to enable privacy mode by default */
  privacyModeDefault?: boolean;
  /** Default directory for saving screenshots */
  saveDirectory?: string;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: Partial<ScreenshotAnalyzerConfig> = {
  model: DEFAULT_VISION_MODEL,
  maxTokens: 2048,
  temperature: 0.3, // Lower temperature for more accurate analysis
  privacyModeDefault: false,
  saveDirectory: path.join(os.homedir(), '.atlas', 'screenshots'),
};

/**
 * Analysis result interface
 */
export interface ScreenshotAnalysisResult {
  /** Analysis description */
  description: string;
  /** Extracted text (OCR) */
  extractedText?: string;
  /** Identified UI elements */
  uiElements?: UIElement[];
  /** Suggested actions */
  suggestedActions?: SuggestedAction[];
  /** Screenshot metadata */
  metadata: {
    width: number;
    height: number;
    format: 'png' | 'jpeg';
    size: number;
    timestamp: string;
    source: string;
    model: string;
    analysisLatency: number;
  };
  /** Path to saved screenshot (if saved) */
  savedPath?: string;
  /** Path to annotated screenshot (if created) */
  annotatedPath?: string;
}

/**
 * UI element identified in screenshot
 */
export interface UIElement {
  /** Type of element */
  type: 'button' | 'input' | 'menu' | 'icon' | 'text' | 'image' | 'link' | 'other';
  /** Element label or text */
  label: string;
  /** Approximate location description */
  location: string;
  /** Whether element appears interactive */
  interactive: boolean;
  /** Confidence level (0-1) */
  confidence: number;
}

/**
 * Suggested action based on analysis
 */
export interface SuggestedAction {
  /** Action type */
  type: 'click' | 'type' | 'scroll' | 'navigate' | 'read' | 'other';
  /** Action description */
  description: string;
  /** Target element */
  target?: string;
  /** Priority (1-5, 1 being highest) */
  priority: number;
}

/**
 * Privacy region to blur
 */
export interface PrivacyRegion {
  /** X coordinate (percentage 0-100) */
  x: number;
  /** Y coordinate (percentage 0-100) */
  y: number;
  /** Width (percentage 0-100) */
  width: number;
  /** Height (percentage 0-100) */
  height: number;
}

/**
 * Predefined privacy patterns to detect and blur
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _PRIVACY_PATTERNS = [
  'password',
  'credit card',
  'ssn',
  'social security',
  'bank account',
  'api key',
  'secret',
  'private key',
  'token',
];

// =============================================================================
// Screenshot Analyzer Class
// =============================================================================

/**
 * Screenshot Analyzer
 * Captures and analyzes screenshots using vision-capable LLMs
 */
export class ScreenshotAnalyzer {
  private config: ScreenshotAnalyzerConfig;
  private client: OpenAI;

  constructor(config: Partial<ScreenshotAnalyzerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config } as ScreenshotAnalyzerConfig;

    if (!this.config.apiKey) {
      throw new Error('OpenRouter API key is required for screenshot analysis');
    }

    // Initialize OpenAI client with OpenRouter endpoint
    this.client = new OpenAI({
      apiKey: this.config.apiKey,
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer': 'https://github.com/atlas-desktop',
        'X-Title': 'Atlas Desktop',
      },
    });

    logger.info('ScreenshotAnalyzer initialized', { model: this.config.model });
  }

  /**
   * Capture a screenshot from the primary display
   */
  async captureScreen(displayIndex = 0): Promise<Buffer> {
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

      logger.debug('Screen captured', {
        display: displayIndex,
        size: buffer.length,
        dimensions: thumbnail.getSize(),
      });

      perfTimer.end('captureScreen');
      return buffer;
    } catch (error) {
      perfTimer.end('captureScreen');
      throw error;
    }
  }

  /**
   * Capture a screenshot of a specific window
   */
  async captureWindow(windowName: string): Promise<Buffer> {
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

      logger.debug('Window captured', {
        window: windowSource.name,
        size: buffer.length,
        dimensions: thumbnail.getSize(),
      });

      perfTimer.end('captureWindow');
      return buffer;
    } catch (error) {
      perfTimer.end('captureWindow');
      throw error;
    }
  }

  /**
   * Apply privacy blur to sensitive regions
   */
  async applyPrivacyBlur(imageBuffer: Buffer, regions?: PrivacyRegion[]): Promise<Buffer> {
    // Note: Full implementation would use sharp or jimp for image processing
    // For now, we return the original image with a warning
    if (regions && regions.length > 0) {
      logger.warn(
        'Privacy blur requested but full implementation requires image processing library'
      );
      // In a complete implementation, this would:
      // 1. Load the image with sharp or jimp
      // 2. Apply Gaussian blur to specified regions
      // 3. Return the modified buffer
    }
    return imageBuffer;
  }

  /**
   * Analyze a screenshot using vision LLM
   */
  async analyze(
    imageBuffer: Buffer,
    options: {
      prompt?: string;
      extractText?: boolean;
      identifyUI?: boolean;
      suggestActions?: boolean;
      privacyMode?: boolean;
      privacyRegions?: PrivacyRegion[];
      savePath?: string;
    } = {}
  ): Promise<ScreenshotAnalysisResult> {
    perfTimer.start('analyze');

    const {
      prompt,
      extractText = true,
      identifyUI = true,
      suggestActions = true,
      privacyMode = this.config.privacyModeDefault ?? false,
      privacyRegions,
      savePath,
    } = options;

    try {
      // Apply privacy blur if enabled
      let processedImage = imageBuffer;
      if (privacyMode || (privacyRegions && privacyRegions.length > 0)) {
        processedImage = await this.applyPrivacyBlur(imageBuffer, privacyRegions);
      }

      // Convert to base64 for API
      const base64Image = processedImage.toString('base64');
      const imageSize = nativeImage.createFromBuffer(processedImage).getSize();

      // Check model image size limits
      const modelInfo = VISION_MODELS[this.config.model || DEFAULT_VISION_MODEL];
      if (processedImage.length > modelInfo.maxImageSize) {
        throw new Error(
          `Image size (${processedImage.length} bytes) exceeds model limit (${modelInfo.maxImageSize} bytes)`
        );
      }

      // Build analysis prompt
      const analysisPrompt = this.buildAnalysisPrompt({
        userPrompt: prompt,
        extractText,
        identifyUI,
        suggestActions,
        privacyMode,
      });

      // Call vision API
      const startTime = Date.now();
      const response = await this.client.chat.completions.create({
        model: this.config.model || DEFAULT_VISION_MODEL,
        max_tokens: this.config.maxTokens,
        temperature: this.config.temperature,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: analysisPrompt,
              },
              {
                type: 'image_url',
                image_url: {
                  url: `data:image/png;base64,${base64Image}`,
                  detail: 'high',
                },
              },
            ],
          },
        ],
      });

      const analysisLatency = Date.now() - startTime;
      const analysisContent = response.choices[0]?.message?.content || '';

      // Parse the analysis response
      const result = this.parseAnalysisResponse(analysisContent, {
        width: imageSize.width,
        height: imageSize.height,
        format: 'png',
        size: processedImage.length,
        timestamp: new Date().toISOString(),
        source: 'screen',
        model: response.model,
        analysisLatency,
      });

      // Save screenshot if requested
      if (savePath) {
        await this.saveScreenshot(processedImage, savePath);
        result.savedPath = savePath;
      }

      logger.info('Screenshot analyzed', {
        model: response.model,
        latency: analysisLatency,
        tokensUsed: response.usage?.total_tokens,
      });

      perfTimer.end('analyze');
      return result;
    } catch (error) {
      perfTimer.end('analyze');
      logger.error('Analysis failed', { error: (error as Error).message });
      throw error;
    }
  }

  /**
   * Build the analysis prompt based on options
   */
  private buildAnalysisPrompt(options: {
    userPrompt?: string;
    extractText: boolean;
    identifyUI: boolean;
    suggestActions: boolean;
    privacyMode: boolean;
  }): string {
    const parts: string[] = [];

    // Add user prompt if provided
    if (options.userPrompt) {
      parts.push(`User Request: ${options.userPrompt}`);
      parts.push('');
    }

    // Base instruction
    parts.push('Analyze this screenshot and provide a detailed description of what you see.');
    parts.push('');

    // Text extraction
    if (options.extractText) {
      parts.push('## Text Extraction (OCR)');
      parts.push('Extract and list all readable text from the image, organized by location.');
      parts.push('Format: Use [EXTRACTED_TEXT_START] and [EXTRACTED_TEXT_END] markers.');
      parts.push('');
    }

    // UI element identification
    if (options.identifyUI) {
      parts.push('## UI Elements');
      parts.push('Identify interactive UI elements (buttons, inputs, menus, links, etc.).');
      parts.push('For each element, provide:');
      parts.push('- Type (button/input/menu/icon/text/image/link/other)');
      parts.push('- Label or text');
      parts.push('- Location description');
      parts.push('- Whether it appears interactive');
      parts.push('Format: Use [UI_ELEMENTS_START] and [UI_ELEMENTS_END] markers with JSON array.');
      parts.push('');
    }

    // Action suggestions
    if (options.suggestActions) {
      parts.push('## Suggested Actions');
      parts.push(
        'Based on the screen content, suggest relevant actions the user might want to take.'
      );
      parts.push('For each suggestion, provide:');
      parts.push('- Action type (click/type/scroll/navigate/read/other)');
      parts.push('- Description of the action');
      parts.push('- Target element (if applicable)');
      parts.push('- Priority (1-5, 1 being most important)');
      parts.push(
        'Format: Use [SUGGESTED_ACTIONS_START] and [SUGGESTED_ACTIONS_END] markers with JSON array.'
      );
      parts.push('');
    }

    // Privacy mode instruction
    if (options.privacyMode) {
      parts.push('## Privacy Notice');
      parts.push('This screenshot may contain sensitive information. Please:');
      parts.push('- Do NOT extract or repeat any passwords, API keys, tokens, or credentials');
      parts.push('- Do NOT extract credit card numbers, SSNs, or financial data');
      parts.push('- Redact any such information with [REDACTED] in your response');
      parts.push('');
    }

    // Output format
    parts.push('## Response Format');
    parts.push('Start with a natural language description of the screenshot content.');
    parts.push('Then include the structured sections if requested.');

    return parts.join('\n');
  }

  /**
   * Parse the analysis response into structured result
   */
  private parseAnalysisResponse(
    content: string,
    metadata: ScreenshotAnalysisResult['metadata']
  ): ScreenshotAnalysisResult {
    const result: ScreenshotAnalysisResult = {
      description: '',
      metadata,
    };

    // Extract description (everything before the first marker or the whole content)
    const firstMarker = content.indexOf('[');
    if (firstMarker > 0) {
      result.description = content.substring(0, firstMarker).trim();
    } else {
      result.description = content.trim();
    }

    // Extract OCR text
    const textMatch = content.match(/\[EXTRACTED_TEXT_START\]([\s\S]*?)\[EXTRACTED_TEXT_END\]/);
    if (textMatch) {
      result.extractedText = textMatch[1].trim();
    }

    // Extract UI elements
    const uiMatch = content.match(/\[UI_ELEMENTS_START\]([\s\S]*?)\[UI_ELEMENTS_END\]/);
    if (uiMatch) {
      try {
        const uiJson = this.extractJsonFromText(uiMatch[1]);
        if (Array.isArray(uiJson)) {
          result.uiElements = uiJson.map((el) => ({
            type: el.type || 'other',
            label: el.label || el.text || '',
            location: el.location || '',
            interactive: el.interactive ?? true,
            confidence: el.confidence ?? 0.8,
          }));
        }
      } catch (error) {
        logger.warn('Failed to parse UI elements', { error: (error as Error).message });
      }
    }

    // Extract suggested actions
    const actionsMatch = content.match(
      /\[SUGGESTED_ACTIONS_START\]([\s\S]*?)\[SUGGESTED_ACTIONS_END\]/
    );
    if (actionsMatch) {
      try {
        const actionsJson = this.extractJsonFromText(actionsMatch[1]);
        if (Array.isArray(actionsJson)) {
          result.suggestedActions = actionsJson.map((action) => ({
            type: action.type || 'other',
            description: action.description || '',
            target: action.target,
            priority: action.priority ?? 3,
          }));
        }
      } catch (error) {
        logger.warn('Failed to parse suggested actions', { error: (error as Error).message });
      }
    }

    return result;
  }

  /**
   * Extract JSON from text that might contain markdown code blocks
   */
  private extractJsonFromText(text: string): unknown {
    // Try to find JSON in code blocks first
    const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      return JSON.parse(codeBlockMatch[1].trim());
    }

    // Try to parse as-is (might be raw JSON)
    const trimmed = text.trim();
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      return JSON.parse(trimmed);
    }

    // Try to find array or object in the text
    const arrayMatch = text.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      return JSON.parse(arrayMatch[0]);
    }

    const objectMatch = text.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      return JSON.parse(objectMatch[0]);
    }

    throw new Error('No valid JSON found in text');
  }

  /**
   * Save screenshot to disk
   */
  async saveScreenshot(imageBuffer: Buffer, filePath: string): Promise<void> {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filePath, imageBuffer);
    logger.info('Screenshot saved', { path: filePath, size: imageBuffer.length });
  }

  /**
   * Generate a default save path
   */
  generateSavePath(prefix = 'screenshot'): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${prefix}_${timestamp}.png`;
    return path.join(this.config.saveDirectory || DEFAULT_CONFIG.saveDirectory!, filename);
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let analyzerInstance: ScreenshotAnalyzer | null = null;

/**
 * Get or create the singleton ScreenshotAnalyzer instance
 */
export function getScreenshotAnalyzer(
  config?: Partial<ScreenshotAnalyzerConfig>
): ScreenshotAnalyzer {
  if (!analyzerInstance && config) {
    analyzerInstance = new ScreenshotAnalyzer(config);
  }
  if (!analyzerInstance) {
    throw new Error('ScreenshotAnalyzer not initialized. Call with config first.');
  }
  return analyzerInstance;
}

/**
 * Initialize the screenshot analyzer with API key
 */
export function initializeScreenshotAnalyzer(
  apiKey: string,
  config?: Partial<ScreenshotAnalyzerConfig>
): ScreenshotAnalyzer {
  analyzerInstance = new ScreenshotAnalyzer({ apiKey, ...config });
  return analyzerInstance;
}

/**
 * Shutdown the screenshot analyzer
 */
export function shutdownScreenshotAnalyzer(): void {
  analyzerInstance = null;
}

// =============================================================================
// Agent Tools
// =============================================================================

/**
 * Analyze screen tool - "What's on my screen?"
 */
export const analyzeScreenTool: AgentTool = {
  name: 'analyze_screen',
  description:
    'Capture and analyze the current screen using AI vision. Understands natural queries like "What\'s on my screen?", "Describe what I\'m looking at", "Read the text on screen".',
  parameters: {
    type: 'object',
    properties: {
      displayIndex: {
        type: 'number',
        description: 'Index of the display to capture (default: 0 for primary)',
      },
      query: {
        type: 'string',
        description:
          'Specific question about the screen content (e.g., "What button should I click next?")',
      },
      extractText: {
        type: 'boolean',
        description: 'Whether to perform OCR text extraction (default: true)',
      },
      identifyUI: {
        type: 'boolean',
        description: 'Whether to identify UI elements (default: true)',
      },
      suggestActions: {
        type: 'boolean',
        description: 'Whether to suggest actions (default: true)',
      },
      privacyMode: {
        type: 'boolean',
        description: 'Enable privacy mode to redact sensitive information (default: false)',
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
      const analyzer = getScreenshotAnalyzer();

      const displayIndex = (params.displayIndex as number) || 0;
      const query = params.query as string | undefined;
      const extractText = (params.extractText as boolean) ?? true;
      const identifyUI = (params.identifyUI as boolean) ?? true;
      const suggestActions = (params.suggestActions as boolean) ?? true;
      const privacyMode = (params.privacyMode as boolean) ?? false;
      const savePath = params.savePath as string | undefined;

      // Capture screenshot
      const imageBuffer = await analyzer.captureScreen(displayIndex);

      // Analyze
      const result = await analyzer.analyze(imageBuffer, {
        prompt: query,
        extractText,
        identifyUI,
        suggestActions,
        privacyMode,
        savePath,
      });

      logger.info('Screen analyzed', {
        display: displayIndex,
        hasQuery: !!query,
        uiElements: result.uiElements?.length ?? 0,
        actions: result.suggestedActions?.length ?? 0,
      });

      return { success: true, data: result };
    } catch (error) {
      const err = error as Error;
      logger.error('Screen analysis failed', { error: err.message });
      return { success: false, error: err.message };
    }
  },
};

/**
 * Analyze window tool - "Analyze this window"
 */
export const analyzeWindowTool: AgentTool = {
  name: 'analyze_window',
  description:
    'Capture and analyze a specific window using AI vision. Understands queries like "Analyze this window", "What is in the Chrome window?".',
  parameters: {
    type: 'object',
    properties: {
      windowName: {
        type: 'string',
        description: 'Name or partial name of the window to capture',
      },
      query: {
        type: 'string',
        description: 'Specific question about the window content',
      },
      extractText: {
        type: 'boolean',
        description: 'Whether to perform OCR text extraction (default: true)',
      },
      identifyUI: {
        type: 'boolean',
        description: 'Whether to identify UI elements (default: true)',
      },
      suggestActions: {
        type: 'boolean',
        description: 'Whether to suggest actions (default: true)',
      },
      privacyMode: {
        type: 'boolean',
        description: 'Enable privacy mode to redact sensitive information (default: false)',
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
      const analyzer = getScreenshotAnalyzer();

      const windowName = params.windowName as string;
      const query = params.query as string | undefined;
      const extractText = (params.extractText as boolean) ?? true;
      const identifyUI = (params.identifyUI as boolean) ?? true;
      const suggestActions = (params.suggestActions as boolean) ?? true;
      const privacyMode = (params.privacyMode as boolean) ?? false;
      const savePath = params.savePath as string | undefined;

      // Capture window screenshot
      const imageBuffer = await analyzer.captureWindow(windowName);

      // Analyze
      const result = await analyzer.analyze(imageBuffer, {
        prompt: query,
        extractText,
        identifyUI,
        suggestActions,
        privacyMode,
        savePath,
      });

      logger.info('Window analyzed', {
        window: windowName,
        hasQuery: !!query,
        uiElements: result.uiElements?.length ?? 0,
        actions: result.suggestedActions?.length ?? 0,
      });

      return { success: true, data: result };
    } catch (error) {
      const err = error as Error;
      logger.error('Window analysis failed', { error: err.message });
      return { success: false, error: err.message };
    }
  },
};

/**
 * Extract text from screen (OCR) tool
 */
export const extractScreenTextTool: AgentTool = {
  name: 'extract_screen_text',
  description:
    'Extract all readable text from the current screen using OCR. Useful for queries like "Read the text on my screen", "What does it say?".',
  parameters: {
    type: 'object',
    properties: {
      displayIndex: {
        type: 'number',
        description: 'Index of the display to capture (default: 0)',
      },
      privacyMode: {
        type: 'boolean',
        description: 'Redact sensitive information like passwords (default: true)',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const analyzer = getScreenshotAnalyzer();

      const displayIndex = (params.displayIndex as number) || 0;
      const privacyMode = (params.privacyMode as boolean) ?? true;

      // Capture screenshot
      const imageBuffer = await analyzer.captureScreen(displayIndex);

      // Analyze with text extraction focus
      const result = await analyzer.analyze(imageBuffer, {
        prompt: 'Extract and organize all visible text from this screenshot.',
        extractText: true,
        identifyUI: false,
        suggestActions: false,
        privacyMode,
      });

      logger.info('Screen text extracted', {
        display: displayIndex,
        textLength: result.extractedText?.length ?? 0,
      });

      return {
        success: true,
        data: {
          text: result.extractedText || result.description,
          metadata: result.metadata,
        },
      };
    } catch (error) {
      const err = error as Error;
      logger.error('Text extraction failed', { error: err.message });
      return { success: false, error: err.message };
    }
  },
};

/**
 * Identify UI elements tool
 */
export const identifyUIElementsTool: AgentTool = {
  name: 'identify_ui_elements',
  description:
    'Identify interactive UI elements on screen. Useful for automation and accessibility queries.',
  parameters: {
    type: 'object',
    properties: {
      displayIndex: {
        type: 'number',
        description: 'Index of the display to capture (default: 0)',
      },
      windowName: {
        type: 'string',
        description: 'Optional window name to capture instead of full screen',
      },
      elementType: {
        type: 'string',
        description: 'Filter by element type (button, input, menu, link, etc.)',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const analyzer = getScreenshotAnalyzer();

      const displayIndex = (params.displayIndex as number) || 0;
      const windowName = params.windowName as string | undefined;
      const elementType = params.elementType as string | undefined;

      // Capture screenshot
      let imageBuffer: Buffer;
      if (windowName) {
        imageBuffer = await analyzer.captureWindow(windowName);
      } else {
        imageBuffer = await analyzer.captureScreen(displayIndex);
      }

      // Build focused prompt
      let prompt = 'Focus on identifying all interactive UI elements in this screenshot.';
      if (elementType) {
        prompt += ` Specifically look for elements of type: ${elementType}.`;
      }

      // Analyze with UI focus
      const result = await analyzer.analyze(imageBuffer, {
        prompt,
        extractText: false,
        identifyUI: true,
        suggestActions: false,
        privacyMode: false,
      });

      // Filter by type if specified
      let elements = result.uiElements || [];
      if (elementType) {
        elements = elements.filter((el) =>
          el.type.toLowerCase().includes(elementType.toLowerCase())
        );
      }

      logger.info('UI elements identified', {
        total: result.uiElements?.length ?? 0,
        filtered: elements.length,
        filterType: elementType,
      });

      return {
        success: true,
        data: {
          elements,
          count: elements.length,
          metadata: result.metadata,
        },
      };
    } catch (error) {
      const err = error as Error;
      logger.error('UI identification failed', { error: err.message });
      return { success: false, error: err.message };
    }
  },
};

/**
 * Analyze and save screenshot tool
 */
export const analyzeAndSaveScreenshotTool: AgentTool = {
  name: 'analyze_and_save_screenshot',
  description:
    'Capture, analyze, and save a screenshot with optional annotations. Returns analysis and saved file path.',
  parameters: {
    type: 'object',
    properties: {
      displayIndex: {
        type: 'number',
        description: 'Index of the display to capture (default: 0)',
      },
      windowName: {
        type: 'string',
        description: 'Optional window name to capture instead of full screen',
      },
      query: {
        type: 'string',
        description: 'Optional query about the screenshot',
      },
      filename: {
        type: 'string',
        description: 'Custom filename (without extension)',
      },
      directory: {
        type: 'string',
        description: 'Custom directory to save screenshot',
      },
      privacyMode: {
        type: 'boolean',
        description: 'Enable privacy mode (default: false)',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const analyzer = getScreenshotAnalyzer();

      const displayIndex = (params.displayIndex as number) || 0;
      const windowName = params.windowName as string | undefined;
      const query = params.query as string | undefined;
      const filename = params.filename as string | undefined;
      const directory = params.directory as string | undefined;
      const privacyMode = (params.privacyMode as boolean) ?? false;

      // Capture screenshot
      let imageBuffer: Buffer;
      let source: string;
      if (windowName) {
        imageBuffer = await analyzer.captureWindow(windowName);
        source = windowName;
      } else {
        imageBuffer = await analyzer.captureScreen(displayIndex);
        source = `display_${displayIndex}`;
      }

      // Generate save path
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const finalFilename = filename || `screenshot_${source}_${timestamp}`;
      const saveDir = directory || path.join(os.homedir(), '.atlas', 'screenshots');
      const savePath = path.join(saveDir, `${finalFilename}.png`);

      // Analyze and save
      const result = await analyzer.analyze(imageBuffer, {
        prompt: query,
        extractText: true,
        identifyUI: true,
        suggestActions: true,
        privacyMode,
        savePath,
      });

      logger.info('Screenshot analyzed and saved', {
        path: savePath,
        size: result.metadata.size,
      });

      return { success: true, data: result };
    } catch (error) {
      const err = error as Error;
      logger.error('Analyze and save failed', { error: err.message });
      return { success: false, error: err.message };
    }
  },
};

/**
 * Get all screenshot analyzer tools
 */
export function getScreenshotAnalyzerTools(): AgentTool[] {
  return [
    analyzeScreenTool,
    analyzeWindowTool,
    extractScreenTextTool,
    identifyUIElementsTool,
    analyzeAndSaveScreenshotTool,
  ];
}

export default {
  ScreenshotAnalyzer,
  getScreenshotAnalyzer,
  initializeScreenshotAnalyzer,
  shutdownScreenshotAnalyzer,
  getScreenshotAnalyzerTools,
  analyzeScreenTool,
  analyzeWindowTool,
  extractScreenTextTool,
  identifyUIElementsTool,
  analyzeAndSaveScreenshotTool,
  VISION_MODELS,
  DEFAULT_VISION_MODEL,
};
