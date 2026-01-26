/**
 * Atlas Desktop - Image Generation Tool
 *
 * Agent tool for generating images using Fireworks AI diffusion models.
 * Supports FLUX.1, Stable Diffusion XL, and Playground models.
 *
 * @module agent/tools/image-generation
 */

import { AgentTool, ActionResult } from '../../../shared/types/agent';
import { createModuleLogger } from '../../utils/logger';
import { getFireworksImageGenerator, IMAGE_MODELS } from '../../llm/fireworks-image';
import { shell } from 'electron';

const logger = createModuleLogger('ImageGenerationTool');

/**
 * Image Generation Tool Definition
 */
export const imageGenerationTool: AgentTool = {
  name: 'generate_image',
  description: `Generate images from text descriptions using AI.
Uses FLUX.1 Schnell for fast, high-quality image generation.
Returns the file path to the generated image.

Examples:
- "A futuristic cityscape at sunset"
- "A cute robot assistant with glowing eyes"
- "A serene mountain landscape with a lake"`,
  parameters: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: 'Detailed description of the image to generate',
      },
      negativePrompt: {
        type: 'string',
        description: 'What to avoid in the image (optional)',
      },
      width: {
        type: 'number',
        description: 'Image width in pixels (default: 1024, max: 1024)',
      },
      height: {
        type: 'number',
        description: 'Image height in pixels (default: 1024, max: 1024)',
      },
      model: {
        type: 'string',
        enum: ['flux-schnell', 'flux-dev', 'sdxl', 'playground'],
        description: 'Model to use (default: flux-schnell)',
      },
      openAfterGeneration: {
        type: 'boolean',
        description: 'Open the image after generation (default: true)',
      },
    },
    required: ['prompt'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const prompt = params.prompt as string;
    const negativePrompt = params.negativePrompt as string | undefined;
    const width = (params.width as number) || 1024;
    const height = (params.height as number) || 1024;
    const modelChoice = params.model as string | undefined;
    const openAfter = params.openAfterGeneration !== false;

    if (!prompt) {
      return {
        success: false,
        error: 'Image prompt is required',
      };
    }

    // Map model choice to model ID
    const modelMap: Record<string, string> = {
      'flux-schnell': IMAGE_MODELS.FLUX_SCHNELL,
      'flux-dev': IMAGE_MODELS.FLUX_DEV,
      'sdxl': IMAGE_MODELS.SDXL,
      'playground': IMAGE_MODELS.PLAYGROUND,
    };

    const model = modelChoice ? modelMap[modelChoice] : IMAGE_MODELS.FLUX_SCHNELL;

    try {
      logger.info('Generating image', { prompt: prompt.slice(0, 100), model });

      const generator = getFireworksImageGenerator();
      const results = await generator.generateAndSave(prompt, undefined, {
        model,
        width: Math.min(width, 1024),
        height: Math.min(height, 1024),
        negativePrompt,
      });

      const result = results[0];

      if (openAfter && result.filePath) {
        await shell.openPath(result.filePath);
      }

      return {
        success: true,
        data: `Image generated successfully and saved to: ${result.filePath}`,
        metadata: {
          filePath: result.filePath,
          model: result.model,
          seed: result.seed,
          latency: result.latency,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Image generation failed', { error: errorMessage });

      return {
        success: false,
        error: `Image generation failed: ${errorMessage}`,
      };
    }
  },
};

/**
 * Get image generation tools
 */
export function getImageGenerationTools(): AgentTool[] {
  return [imageGenerationTool];
}

export default imageGenerationTool;
