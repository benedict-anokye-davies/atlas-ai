/**
 * Atlas Desktop - Vision Analysis Tool
 *
 * Agent tool for analyzing images and screenshots using Fireworks AI vision models.
 * Uses Qwen3 VL 235B Thinking for complex visual reasoning.
 *
 * @module agent/tools/vision-analysis
 */

import { AgentTool, ActionResult } from '../../../shared/types/agent';
import { createModuleLogger } from '../../utils/logger';
import { getFireworksVision } from '../../llm/fireworks-vision';
import { desktopCapturer, screen } from 'electron';
import * as fs from 'fs';

const logger = createModuleLogger('VisionAnalysisTool');

/**
 * Capture screen as base64
 */
async function captureScreenBase64(): Promise<string> {
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 1920, height: 1080 },
  });

  if (sources.length === 0) {
    throw new Error('No screen sources found');
  }

  const thumbnail = sources[0].thumbnail;
  const buffer = thumbnail.toPNG();
  return buffer.toString('base64');
}

/**
 * Capture window by title as base64
 */
async function captureWindowBase64(title: string): Promise<string> {
  const sources = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: { width: 1920, height: 1080 },
  });

  const windowSource = sources.find((s) =>
    s.name.toLowerCase().includes(title.toLowerCase())
  );

  if (!windowSource) {
    throw new Error(`Window with title "${title}" not found`);
  }

  const buffer = windowSource.thumbnail.toPNG();
  return buffer.toString('base64');
}

/**
 * Analyze Image Tool Definition
 */
export const analyzeImageTool: AgentTool = {
  name: 'analyze_image',
  description: `Analyze an image file using AI vision capabilities.
Can identify objects, read text, describe scenes, and answer questions about images.
Uses Qwen3 VL 235B with thinking mode for complex visual reasoning.`,
  parameters: {
    type: 'object',
    properties: {
      imagePath: {
        type: 'string',
        description: 'Path to the image file to analyze',
      },
      question: {
        type: 'string',
        description: 'Question to answer about the image (optional - defaults to general description)',
      },
      thinkingMode: {
        type: 'boolean',
        description: 'Enable thinking mode for complex reasoning (default: true)',
      },
    },
    required: ['imagePath'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const imagePath = params.imagePath as string;
    const question = params.question as string | undefined;
    const thinkingMode = params.thinkingMode !== false;

    if (!imagePath) {
      return {
        success: false,
        error: 'Image path is required',
      };
    }

    if (!fs.existsSync(imagePath)) {
      return {
        success: false,
        error: `Image file not found: ${imagePath}`,
      };
    }

    try {
      logger.info('Analyzing image', { imagePath, hasQuestion: !!question });

      const imageBuffer = await fs.promises.readFile(imagePath);
      const base64 = imageBuffer.toString('base64');

      // Detect media type from extension
      const ext = imagePath.toLowerCase().split('.').pop();
      const mediaTypeMap: Record<string, string> = {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        gif: 'image/gif',
        webp: 'image/webp',
      };
      const mediaType = mediaTypeMap[ext || 'png'] || 'image/png';

      const vision = getFireworksVision();
      const result = await vision.analyzeImage(
        { base64, mediaType },
        question || 'Describe this image in detail, including any text, objects, people, and notable features.',
        { thinkingMode }
      );

      return {
        success: true,
        data: result.content,
        metadata: {
          model: result.model,
          tokens: result.usage?.totalTokens,
          latency: result.latency,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Image analysis failed', { error: errorMessage });

      return {
        success: false,
        error: `Image analysis failed: ${errorMessage}`,
      };
    }
  },
};

/**
 * Analyze Screenshot Tool Definition
 */
export const analyzeScreenshotTool: AgentTool = {
  name: 'analyze_screenshot',
  description: `Take a screenshot and analyze it using AI vision.
Can identify UI elements, read text, describe what's on screen.
Useful for understanding the current state of the user's screen.`,
  parameters: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description: 'Specific question about the screenshot (optional)',
      },
      windowTitle: {
        type: 'string',
        description: 'Capture specific window by title (optional - captures full screen if not specified)',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const question = params.question as string | undefined;
    const windowTitle = params.windowTitle as string | undefined;

    try {
      logger.info('Capturing and analyzing screenshot', { windowTitle });

      // Capture screenshot
      let screenshotBase64: string;
      if (windowTitle) {
        screenshotBase64 = await captureWindowBase64(windowTitle);
      } else {
        screenshotBase64 = await captureScreenBase64();
      }

      const vision = getFireworksVision();
      const result = await vision.analyzeScreenshot(screenshotBase64, question);

      return {
        success: true,
        data: result.content,
        metadata: {
          model: result.model,
          tokens: result.usage?.totalTokens,
          latency: result.latency,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Screenshot analysis failed', { error: errorMessage });

      return {
        success: false,
        error: `Screenshot analysis failed: ${errorMessage}`,
      };
    }
  },
};

/**
 * Extract Text from Image Tool Definition
 */
export const extractTextFromImageVisionTool: AgentTool = {
  name: 'extract_text_vision',
  description: `Extract all text from an image using AI vision (more accurate than OCR for complex layouts).
Uses vision model to understand context and extract text intelligently.`,
  parameters: {
    type: 'object',
    properties: {
      imagePath: {
        type: 'string',
        description: 'Path to the image file',
      },
    },
    required: ['imagePath'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const imagePath = params.imagePath as string;

    if (!imagePath) {
      return {
        success: false,
        error: 'Image path is required',
      };
    }

    if (!fs.existsSync(imagePath)) {
      return {
        success: false,
        error: `Image file not found: ${imagePath}`,
      };
    }

    try {
      const imageBuffer = await fs.promises.readFile(imagePath);
      const base64 = imageBuffer.toString('base64');

      const vision = getFireworksVision();
      const text = await vision.extractText({ base64, mediaType: 'image/png' });

      return {
        success: true,
        data: text,
        metadata: {
          imagePath,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Text extraction failed', { error: errorMessage });

      return {
        success: false,
        error: `Text extraction failed: ${errorMessage}`,
      };
    }
  },
};

/**
 * Describe UI Elements Tool Definition
 */
export const describeUIElementsTool: AgentTool = {
  name: 'describe_ui_elements',
  description: `Analyze a screenshot and identify all interactive UI elements.
Returns a structured list of buttons, inputs, links, and other UI components.
Useful for UI automation and accessibility analysis.`,
  parameters: {
    type: 'object',
    properties: {
      windowTitle: {
        type: 'string',
        description: 'Capture specific window by title (optional)',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const windowTitle = params.windowTitle as string | undefined;

    try {
      // Capture screenshot
      let screenshotBase64: string;
      if (windowTitle) {
        screenshotBase64 = await captureWindowBase64(windowTitle);
      } else {
        screenshotBase64 = await captureScreenBase64();
      }

      const vision = getFireworksVision();
      const result = await vision.describeUIElements(screenshotBase64);

      return {
        success: true,
        data: result.content,
        metadata: {
          model: result.model,
          tokens: result.usage?.totalTokens,
          latency: result.latency,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('UI analysis failed', { error: errorMessage });

      return {
        success: false,
        error: `UI analysis failed: ${errorMessage}`,
      };
    }
  },
};

/**
 * Get all vision analysis tools
 */
export function getVisionAnalysisTools(): AgentTool[] {
  return [
    analyzeImageTool,
    analyzeScreenshotTool,
    extractTextFromImageVisionTool,
    describeUIElementsTool,
  ];
}

export default getVisionAnalysisTools;
