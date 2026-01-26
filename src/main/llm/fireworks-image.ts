/**
 * Atlas Desktop - Fireworks Image Generator
 *
 * Image generation using Fireworks AI models.
 * Supports FLUX, Stable Diffusion XL, and Playground models.
 *
 * Models available (Jan 2026):
 * - FLUX.1 Schnell FP8: Fast, cheap ($0.00035/step)
 * - FLUX.1 Dev FP8: Higher quality ($0.0005/step)
 * - Stable Diffusion XL: Classic, very cheap ($0.00013/step)
 * - Playground v2.5: Good quality ($0.00013/step)
 *
 * @module llm/fireworks-image
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import { getConfig } from '../config';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

const logger = createModuleLogger('FireworksImage');

/**
 * Image generation models
 */
export const IMAGE_MODELS = {
  FLUX_SCHNELL: 'accounts/fireworks/models/flux-1-schnell-fp8',
  FLUX_DEV: 'accounts/fireworks/models/flux-1-dev-fp8',
  SDXL: 'accounts/fireworks/models/stable-diffusion-xl',
  PLAYGROUND: 'accounts/fireworks/models/playground-v2.5-1024',
} as const;

/**
 * Image generation options
 */
export interface ImageGenerationOptions {
  /** Model to use */
  model?: string;
  /** Image width */
  width?: number;
  /** Image height */
  height?: number;
  /** Number of inference steps */
  steps?: number;
  /** Guidance scale (CFG) */
  guidanceScale?: number;
  /** Random seed for reproducibility */
  seed?: number;
  /** Number of images to generate */
  numImages?: number;
  /** Negative prompt (what to avoid) */
  negativePrompt?: string;
}

/**
 * Generated image result
 */
export interface GeneratedImage {
  /** Base64-encoded image data */
  base64: string;
  /** Image format */
  format: 'png' | 'jpeg' | 'webp';
  /** Generation seed used */
  seed: number;
  /** Model used */
  model: string;
  /** Generation latency in ms */
  latency: number;
  /** Saved file path (if saved) */
  filePath?: string;
}

/**
 * Default generation configuration
 */
const DEFAULT_CONFIG: Required<Omit<ImageGenerationOptions, 'seed' | 'negativePrompt'>> = {
  model: IMAGE_MODELS.FLUX_SCHNELL,
  width: 1024,
  height: 1024,
  steps: 20,
  guidanceScale: 7.5,
  numImages: 1,
};

/**
 * Fireworks Image Generator
 *
 * Generates images using Fireworks AI diffusion models.
 */
export class FireworksImageGenerator extends EventEmitter {
  private apiKey: string;
  private config: typeof DEFAULT_CONFIG;
  private outputDir: string;

  constructor(config?: Partial<ImageGenerationOptions>) {
    super();

    const appConfig = getConfig();
    if (!appConfig.fireworksApiKey) {
      throw new Error('Fireworks API key is required for image generation');
    }

    this.apiKey = appConfig.fireworksApiKey;
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Set up output directory
    this.outputDir = path.join(app.getPath('userData'), 'generated-images');
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }

    logger.info('FireworksImageGenerator initialized', { model: this.config.model });
  }

  /**
   * Generate an image from a text prompt
   */
  async generate(
    prompt: string,
    options?: Partial<ImageGenerationOptions>
  ): Promise<GeneratedImage[]> {
    const startTime = Date.now();
    const opts = { ...this.config, ...options };

    logger.info('Generating image', { prompt: prompt.slice(0, 100), model: opts.model });

    const requestBody: Record<string, unknown> = {
      prompt,
      width: opts.width,
      height: opts.height,
      steps: opts.steps,
      guidance_scale: opts.guidanceScale,
      num_images: opts.numImages,
    };

    if (options?.seed !== undefined) {
      requestBody.seed = options.seed;
    }

    if (options?.negativePrompt) {
      requestBody.negative_prompt = options.negativePrompt;
    }

    try {
      const response = await fetch(
        `https://api.fireworks.ai/inference/v1/image_generation/${opts.model}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(requestBody),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Fireworks API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json() as {
        images: Array<{ base64: string; seed: number }>;
      };

      const latency = Date.now() - startTime;

      const results: GeneratedImage[] = data.images.map((img) => ({
        base64: img.base64,
        format: 'png' as const,
        seed: img.seed,
        model: opts.model,
        latency,
      }));

      logger.info('Image generation complete', {
        count: results.length,
        latency,
      });

      this.emit('generation-complete', results);
      return results;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Image generation failed', { error: errorMessage });
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Generate and save image to disk
   */
  async generateAndSave(
    prompt: string,
    filename?: string,
    options?: Partial<ImageGenerationOptions>
  ): Promise<GeneratedImage[]> {
    const results = await this.generate(prompt, options);

    const savedResults = await Promise.all(
      results.map(async (result, index) => {
        const name = filename
          ? `${filename}${results.length > 1 ? `-${index + 1}` : ''}.png`
          : `image-${Date.now()}-${index + 1}.png`;

        const filePath = path.join(this.outputDir, name);
        const buffer = Buffer.from(result.base64, 'base64');

        await fs.promises.writeFile(filePath, buffer);
        logger.debug('Image saved', { filePath });

        return { ...result, filePath };
      })
    );

    return savedResults;
  }

  /**
   * Generate image variations with different seeds
   */
  async generateVariations(
    prompt: string,
    count: number = 4,
    options?: Partial<ImageGenerationOptions>
  ): Promise<GeneratedImage[]> {
    const allResults: GeneratedImage[] = [];

    for (let i = 0; i < count; i++) {
      const results = await this.generate(prompt, {
        ...options,
        numImages: 1,
        seed: Math.floor(Math.random() * 1000000),
      });
      allResults.push(...results);
    }

    return allResults;
  }

  /**
   * Get available models
   */
  getAvailableModels(): typeof IMAGE_MODELS {
    return IMAGE_MODELS;
  }

  /**
   * Get output directory
   */
  getOutputDirectory(): string {
    return this.outputDir;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<ImageGenerationOptions>): void {
    this.config = { ...this.config, ...config } as typeof DEFAULT_CONFIG;
    logger.info('Image generator config updated', this.config);
  }
}

// Singleton instance
let imageGenInstance: FireworksImageGenerator | null = null;

/**
 * Get the singleton FireworksImageGenerator instance
 */
export function getFireworksImageGenerator(
  config?: Partial<ImageGenerationOptions>
): FireworksImageGenerator {
  if (!imageGenInstance) {
    imageGenInstance = new FireworksImageGenerator(config);
  }
  return imageGenInstance;
}

/**
 * Shutdown the image generator
 */
export function shutdownFireworksImageGenerator(): void {
  if (imageGenInstance) {
    imageGenInstance.removeAllListeners();
    imageGenInstance = null;
    logger.info('FireworksImageGenerator shut down');
  }
}

export default FireworksImageGenerator;
