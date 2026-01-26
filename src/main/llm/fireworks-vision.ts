/**
 * Atlas Desktop - Fireworks Vision Provider
 *
 * Vision-language model integration using Fireworks AI.
 * Supports image analysis, screen understanding, and visual reasoning.
 *
 * Models available (Jan 2026):
 * - Qwen3 VL 235B Thinking: Best quality, reasoning mode ($0.22/$0.88 per M)
 * - Qwen3 VL 235B Instruct: Fast, high quality ($0.22/$0.88 per M)
 * - Llama 4 Maverick: Good balance, 1M context ($0.22/$0.88 per M)
 * - Qwen2.5-VL 7B: Budget option, fast ($0.05/$0.15 per M)
 *
 * @module llm/fireworks-vision
 */

import { EventEmitter } from 'events';
import OpenAI from 'openai';
import { createModuleLogger } from '../utils/logger';
import { getConfig } from '../config';
import { FIREWORKS_MODELS } from './smart-router';

const logger = createModuleLogger('FireworksVision');

/**
 * Vision analysis options
 */
export interface VisionAnalysisOptions {
  /** Model to use for analysis */
  model?: string;
  /** Maximum tokens for response */
  maxTokens?: number;
  /** Temperature for generation */
  temperature?: number;
  /** Enable thinking mode for complex reasoning */
  thinkingMode?: boolean;
  /** Detail level for image analysis */
  detail?: 'low' | 'high' | 'auto';
}

/**
 * Vision analysis result
 */
export interface VisionAnalysisResult {
  content: string;
  model: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  latency: number;
}

/**
 * Image input for vision analysis
 */
export interface ImageInput {
  /** Base64-encoded image data */
  base64?: string;
  /** URL of the image */
  url?: string;
  /** Media type (e.g., 'image/png', 'image/jpeg') */
  mediaType?: string;
}

/**
 * Default vision configuration
 */
const DEFAULT_VISION_CONFIG: Required<VisionAnalysisOptions> = {
  model: FIREWORKS_MODELS.VISION_THINKING,
  maxTokens: 4096,
  temperature: 0.5,
  thinkingMode: true,
  detail: 'auto',
};

/**
 * Fireworks Vision Provider
 *
 * Provides vision-language model capabilities for Atlas.
 * Used for screen understanding, image analysis, and visual QA.
 */
export class FireworksVision extends EventEmitter {
  private client: OpenAI;
  private config: Required<VisionAnalysisOptions>;

  constructor(config?: Partial<VisionAnalysisOptions>) {
    super();

    const appConfig = getConfig();
    if (!appConfig.fireworksApiKey) {
      throw new Error('Fireworks API key is required for vision analysis');
    }

    this.client = new OpenAI({
      apiKey: appConfig.fireworksApiKey,
      baseURL: 'https://api.fireworks.ai/inference/v1',
    });

    this.config = { ...DEFAULT_VISION_CONFIG, ...config };
    logger.info('FireworksVision initialized', { model: this.config.model });
  }

  /**
   * Analyze an image with a text prompt
   */
  async analyzeImage(
    image: ImageInput,
    prompt: string,
    options?: Partial<VisionAnalysisOptions>
  ): Promise<VisionAnalysisResult> {
    const startTime = Date.now();
    const opts = { ...this.config, ...options };

    // Select model based on thinking mode
    const model = opts.thinkingMode
      ? FIREWORKS_MODELS.VISION_THINKING
      : opts.model;

    // Build image content
    let imageUrl: string;
    if (image.base64) {
      const mediaType = image.mediaType || 'image/png';
      imageUrl = `data:${mediaType};base64,${image.base64}`;
    } else if (image.url) {
      imageUrl = image.url;
    } else {
      throw new Error('Either base64 or url must be provided for image analysis');
    }

    logger.debug('Analyzing image', { model, promptLength: prompt.length });

    try {
      const response = await this.client.chat.completions.create({
        model,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: {
                  url: imageUrl,
                  detail: opts.detail,
                },
              },
              {
                type: 'text',
                text: prompt,
              },
            ],
          },
        ],
        max_tokens: opts.maxTokens,
        temperature: opts.temperature,
      });

      const latency = Date.now() - startTime;
      const content = response.choices[0]?.message?.content || '';

      const result: VisionAnalysisResult = {
        content,
        model: response.model,
        usage: response.usage
          ? {
              promptTokens: response.usage.prompt_tokens,
              completionTokens: response.usage.completion_tokens,
              totalTokens: response.usage.total_tokens,
            }
          : undefined,
        latency,
      };

      logger.info('Vision analysis complete', {
        latency,
        tokens: result.usage?.totalTokens,
      });

      this.emit('analysis-complete', result);
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Vision analysis failed', { error: errorMessage });
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Analyze a screenshot (convenience method)
   */
  async analyzeScreenshot(
    screenshotBase64: string,
    question?: string
  ): Promise<VisionAnalysisResult> {
    const defaultPrompt = `Analyze this screenshot and describe:
1. What application or content is shown
2. Key UI elements visible
3. Any text content that's readable
4. What the user appears to be doing

Be concise but thorough.`;

    return this.analyzeImage(
      { base64: screenshotBase64, mediaType: 'image/png' },
      question || defaultPrompt,
      { thinkingMode: true }
    );
  }

  /**
   * Extract text from an image (OCR-like functionality)
   */
  async extractText(image: ImageInput): Promise<string> {
    const result = await this.analyzeImage(
      image,
      'Extract and transcribe all visible text from this image. Return only the extracted text, preserving the layout as much as possible.',
      { thinkingMode: false, model: FIREWORKS_MODELS.VISION_INSTRUCT }
    );
    return result.content;
  }

  /**
   * Describe UI elements for automation
   */
  async describeUIElements(screenshotBase64: string): Promise<VisionAnalysisResult> {
    return this.analyzeImage(
      { base64: screenshotBase64, mediaType: 'image/png' },
      `Identify all interactive UI elements in this screenshot. For each element, provide:
1. Type (button, input, link, menu, etc.)
2. Label or text content
3. Approximate position (top-left, center, bottom-right, etc.)
4. Visual state (enabled, disabled, selected, etc.)

Format as a structured list.`,
      { thinkingMode: true }
    );
  }

  /**
   * Compare two images
   */
  async compareImages(
    image1: ImageInput,
    image2: ImageInput,
    question?: string
  ): Promise<VisionAnalysisResult> {
    const startTime = Date.now();

    // Build image URLs
    const imageUrl1 = image1.base64
      ? `data:${image1.mediaType || 'image/png'};base64,${image1.base64}`
      : image1.url!;
    const imageUrl2 = image2.base64
      ? `data:${image2.mediaType || 'image/png'};base64,${image2.base64}`
      : image2.url!;

    const prompt = question || 'Compare these two images and describe the differences between them.';

    try {
      const response = await this.client.chat.completions.create({
        model: FIREWORKS_MODELS.VISION_THINKING,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: { url: imageUrl1, detail: 'high' },
              },
              {
                type: 'image_url',
                image_url: { url: imageUrl2, detail: 'high' },
              },
              {
                type: 'text',
                text: prompt,
              },
            ],
          },
        ],
        max_tokens: this.config.maxTokens,
        temperature: 0.3,
      });

      const latency = Date.now() - startTime;

      return {
        content: response.choices[0]?.message?.content || '',
        model: response.model,
        usage: response.usage
          ? {
              promptTokens: response.usage.prompt_tokens,
              completionTokens: response.usage.completion_tokens,
              totalTokens: response.usage.total_tokens,
            }
          : undefined,
        latency,
      };
    } catch (error) {
      logger.error('Image comparison failed', { error });
      throw error;
    }
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<VisionAnalysisOptions>): void {
    this.config = { ...this.config, ...config };
    logger.info('Vision config updated', this.config);
  }
}

// Singleton instance
let visionInstance: FireworksVision | null = null;

/**
 * Get the singleton FireworksVision instance
 */
export function getFireworksVision(config?: Partial<VisionAnalysisOptions>): FireworksVision {
  if (!visionInstance) {
    visionInstance = new FireworksVision(config);
  }
  return visionInstance;
}

/**
 * Shutdown the vision provider
 */
export function shutdownFireworksVision(): void {
  if (visionInstance) {
    visionInstance.removeAllListeners();
    visionInstance = null;
    logger.info('FireworksVision shut down');
  }
}

export default FireworksVision;
