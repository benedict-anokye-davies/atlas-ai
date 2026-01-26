/**
 * Atlas Desktop - Clipboard Tool
 * Read and write to the system clipboard
 */

import { AgentTool, ActionResult } from '../../../shared/types/agent';
import { createModuleLogger } from '../../utils/logger';
import { clipboard, nativeImage } from 'electron';

const logger = createModuleLogger('ClipboardTool');

// Safety limits
const MAX_CLIPBOARD_TEXT_LENGTH = 1024 * 1024; // 1MB
const MAX_CLIPBOARD_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * Read clipboard text tool
 */
export const readClipboardTextTool: AgentTool = {
  name: 'clipboard_read_text',
  description: 'Read text content from the system clipboard',
  parameters: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        description: 'Type of text to read: "text" (plain text) or "html" (HTML format)',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const type = (params.type as string) || 'text';

    try {
      let content: string;

      if (type === 'html') {
        content = clipboard.readHTML();
      } else {
        content = clipboard.readText();
      }

      // Check for sensitive content patterns
      const sensitivePatterns = [
        /\b\d{16}\b/, // Credit card numbers
        /\b\d{3}-\d{2}-\d{4}\b/, // SSN
        /-----BEGIN [A-Z]+ PRIVATE KEY-----/, // Private keys
      ];

      const containsSensitive = sensitivePatterns.some((p) => p.test(content));
      if (containsSensitive) {
        logger.warn('Clipboard may contain sensitive data');
      }

      // Truncate if too long
      const truncated = content.length > MAX_CLIPBOARD_TEXT_LENGTH;
      if (truncated) {
        content = content.slice(0, MAX_CLIPBOARD_TEXT_LENGTH);
      }

      logger.debug('Clipboard text read', { type, length: content.length, truncated });

      return {
        success: true,
        data: {
          content,
          type,
          length: content.length,
          truncated,
          containsSensitive,
        },
      };
    } catch (error) {
      logger.error('Failed to read clipboard', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  },
};

/**
 * Write clipboard text tool
 */
export const writeClipboardTextTool: AgentTool = {
  name: 'clipboard_write_text',
  description: 'Write text content to the system clipboard',
  parameters: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: 'The text to write to the clipboard',
      },
      type: {
        type: 'string',
        description: 'Type of text: "text" (plain text) or "html" (HTML format)',
      },
    },
    required: ['text'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const text = params.text as string;
    const type = (params.type as string) || 'text';

    if (!text) {
      return { success: false, error: 'Text content is required' };
    }

    if (text.length > MAX_CLIPBOARD_TEXT_LENGTH) {
      return {
        success: false,
        error: `Text exceeds maximum length (${MAX_CLIPBOARD_TEXT_LENGTH} bytes)`,
      };
    }

    try {
      if (type === 'html') {
        clipboard.writeHTML(text);
      } else {
        clipboard.writeText(text);
      }

      logger.info('Clipboard text written', { type, length: text.length });

      return {
        success: true,
        data: {
          written: true,
          type,
          length: text.length,
        },
      };
    } catch (error) {
      logger.error('Failed to write clipboard', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  },
};

/**
 * Read clipboard image tool
 */
export const readClipboardImageTool: AgentTool = {
  name: 'clipboard_read_image',
  description: 'Read an image from the system clipboard',
  parameters: {
    type: 'object',
    properties: {
      format: {
        type: 'string',
        description: 'Output format: "png" or "jpeg" (default: "png")',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const format = (params.format as string) || 'png';

    try {
      const image = clipboard.readImage();

      if (image.isEmpty()) {
        return {
          success: true,
          data: {
            hasImage: false,
            message: 'No image in clipboard',
          },
        };
      }

      const size = image.getSize();
      let buffer: Buffer;

      if (format === 'jpeg') {
        buffer = image.toJPEG(85);
      } else {
        buffer = image.toPNG();
      }

      if (buffer.length > MAX_CLIPBOARD_IMAGE_SIZE) {
        return { success: false, error: 'Clipboard image exceeds maximum size' };
      }

      logger.debug('Clipboard image read', { format, size, bytes: buffer.length });

      return {
        success: true,
        data: {
          hasImage: true,
          format,
          width: size.width,
          height: size.height,
          size: buffer.length,
          base64: buffer.toString('base64'),
        },
      };
    } catch (error) {
      logger.error('Failed to read clipboard image', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  },
};

/**
 * Write clipboard image tool
 */
export const writeClipboardImageTool: AgentTool = {
  name: 'clipboard_write_image',
  description: 'Write an image to the system clipboard from base64 or file path',
  parameters: {
    type: 'object',
    properties: {
      base64: {
        type: 'string',
        description: 'Base64 encoded image data',
      },
      filePath: {
        type: 'string',
        description: 'Path to an image file',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const base64 = params.base64 as string | undefined;
    const filePath = params.filePath as string | undefined;

    if (!base64 && !filePath) {
      return { success: false, error: 'Either base64 or filePath is required' };
    }

    try {
      let image: Electron.NativeImage;

      if (base64) {
        const buffer = Buffer.from(base64, 'base64');
        if (buffer.length > MAX_CLIPBOARD_IMAGE_SIZE) {
          return { success: false, error: 'Image exceeds maximum size' };
        }
        image = nativeImage.createFromBuffer(buffer);
      } else if (filePath) {
        image = nativeImage.createFromPath(filePath);
      } else {
        return { success: false, error: 'No image source provided' };
      }

      if (image.isEmpty()) {
        return { success: false, error: 'Failed to create image (invalid data or path)' };
      }

      clipboard.writeImage(image);

      const size = image.getSize();
      logger.info('Clipboard image written', { width: size.width, height: size.height });

      return {
        success: true,
        data: {
          written: true,
          width: size.width,
          height: size.height,
        },
      };
    } catch (error) {
      logger.error('Failed to write clipboard image', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  },
};

/**
 * Clear clipboard tool
 */
export const clearClipboardTool: AgentTool = {
  name: 'clipboard_clear',
  description: 'Clear the system clipboard',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (): Promise<ActionResult> => {
    try {
      clipboard.clear();
      logger.info('Clipboard cleared');

      return {
        success: true,
        data: { cleared: true },
      };
    } catch (error) {
      logger.error('Failed to clear clipboard', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  },
};

/**
 * Get available clipboard formats tool
 */
export const getClipboardFormatsTool: AgentTool = {
  name: 'clipboard_formats',
  description: 'Get the available formats in the clipboard',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (): Promise<ActionResult> => {
    try {
      const formats = clipboard.availableFormats();
      const hasText = clipboard.readText().length > 0;
      const hasHTML = clipboard.readHTML().length > 0;
      const hasImage = !clipboard.readImage().isEmpty();

      logger.debug('Clipboard formats checked', { formats });

      return {
        success: true,
        data: {
          formats,
          hasText,
          hasHTML,
          hasImage,
        },
      };
    } catch (error) {
      logger.error('Failed to get clipboard formats', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  },
};

/**
 * Get all clipboard tools
 */
export function getClipboardTools(): AgentTool[] {
  return [
    readClipboardTextTool,
    writeClipboardTextTool,
    readClipboardImageTool,
    writeClipboardImageTool,
    clearClipboardTool,
    getClipboardFormatsTool,
  ];
}

export default {
  readClipboardTextTool,
  writeClipboardTextTool,
  readClipboardImageTool,
  writeClipboardImageTool,
  clearClipboardTool,
  getClipboardFormatsTool,
  getClipboardTools,
};
