/**
 * Image Processor
 * Processes images for understanding and analysis
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { createModuleLogger } from '../utils/logger';
import {
  ImageAnalysisResult,
  DetectedObject,
  ExtractedText,
  ColorInfo,
  ImageMetadata,
  AnalysisOptions
} from './types';

const logger = createModuleLogger('ImageProcessor');

interface ImageProcessorConfig {
  ocrEnabled: boolean;
  maxImageSize: number;
  supportedFormats: string[];
  visionModel?: string;
}

const DEFAULT_CONFIG: ImageProcessorConfig = {
  ocrEnabled: true,
  maxImageSize: 10 * 1024 * 1024, // 10MB
  supportedFormats: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'],
  visionModel: 'gpt-4-vision-preview'
};

class ImageProcessor extends EventEmitter {
  private config: ImageProcessorConfig;
  private initialized: boolean = false;

  constructor(config: Partial<ImageProcessorConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    logger.info('Initializing image processor');
    this.initialized = true;
    this.emit('initialized');
  }

  /**
   * Analyze an image file or buffer
   */
  async analyzeImage(
    input: string | Buffer,
    options: AnalysisOptions = {}
  ): Promise<ImageAnalysisResult> {
    const startTime = Date.now();
    
    try {
      let imageBuffer: Buffer;
      let metadata: ImageMetadata;

      if (typeof input === 'string') {
        // File path
        if (!fs.existsSync(input)) {
          throw new Error(`Image file not found: ${input}`);
        }
        imageBuffer = fs.readFileSync(input);
        metadata = await this.extractMetadata(input, imageBuffer);
      } else {
        imageBuffer = input;
        metadata = await this.extractMetadataFromBuffer(imageBuffer);
      }

      // Validate image
      this.validateImage(imageBuffer, metadata);

      // Parallel analysis
      const [objects, text, colors] = await Promise.all([
        this.detectObjects(imageBuffer, metadata),
        options.extractText !== false ? this.extractText(imageBuffer, metadata) : [],
        this.analyzeColors(imageBuffer)
      ]);

      // Generate description using vision model
      const description = await this.generateDescription(imageBuffer, {
        objects,
        text,
        colors
      });

      const result: ImageAnalysisResult = {
        description,
        objects,
        text,
        colors,
        metadata,
        confidence: this.calculateOverallConfidence(objects, text)
      };

      logger.info(`Image analysis completed in ${Date.now() - startTime}ms`);
      this.emit('analysis-complete', result);

      return result;
    } catch (error) {
      logger.error('Image analysis failed', error);
      throw error;
    }
  }

  /**
   * Extract metadata from image file
   */
  private async extractMetadata(filePath: string, buffer: Buffer): Promise<ImageMetadata> {
    const stats = fs.statSync(filePath);
    const ext = path.extname(filePath).toLowerCase().slice(1);
    
    // Basic metadata extraction from buffer headers
    const dimensions = this.getImageDimensions(buffer);
    
    return {
      width: dimensions.width,
      height: dimensions.height,
      format: ext,
      size: stats.size,
      hasAlpha: this.hasAlphaChannel(buffer, ext)
    };
  }

  /**
   * Extract metadata from buffer only
   */
  private async extractMetadataFromBuffer(buffer: Buffer): Promise<ImageMetadata> {
    const format = this.detectFormat(buffer);
    const dimensions = this.getImageDimensions(buffer);
    
    return {
      width: dimensions.width,
      height: dimensions.height,
      format,
      size: buffer.length,
      hasAlpha: this.hasAlphaChannel(buffer, format)
    };
  }

  /**
   * Detect image format from buffer magic bytes
   */
  private detectFormat(buffer: Buffer): string {
    if (buffer.length < 4) return 'unknown';
    
    // PNG: 89 50 4E 47
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
      return 'png';
    }
    // JPEG: FF D8 FF
    if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
      return 'jpg';
    }
    // GIF: 47 49 46 38
    if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) {
      return 'gif';
    }
    // WebP: RIFF....WEBP
    if (buffer.length > 12 && 
        buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
        buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
      return 'webp';
    }
    // BMP: 42 4D
    if (buffer[0] === 0x42 && buffer[1] === 0x4D) {
      return 'bmp';
    }
    
    return 'unknown';
  }

  /**
   * Get image dimensions from buffer
   */
  private getImageDimensions(buffer: Buffer): { width: number; height: number } {
    const format = this.detectFormat(buffer);
    
    try {
      switch (format) {
        case 'png':
          // PNG IHDR chunk starts at byte 16
          if (buffer.length >= 24) {
            return {
              width: buffer.readUInt32BE(16),
              height: buffer.readUInt32BE(20)
            };
          }
          break;
          
        case 'jpg':
          // JPEG requires scanning for SOF0 marker
          return this.getJpegDimensions(buffer);
          
        case 'gif':
          // GIF dimensions at bytes 6-9
          if (buffer.length >= 10) {
            return {
              width: buffer.readUInt16LE(6),
              height: buffer.readUInt16LE(8)
            };
          }
          break;
          
        case 'bmp':
          // BMP dimensions at bytes 18-25
          if (buffer.length >= 26) {
            return {
              width: buffer.readUInt32LE(18),
              height: Math.abs(buffer.readInt32LE(22))
            };
          }
          break;
      }
    } catch {
      // Ignore parsing errors
    }
    
    return { width: 0, height: 0 };
  }

  /**
   * Get JPEG dimensions by scanning for SOF marker
   */
  private getJpegDimensions(buffer: Buffer): { width: number; height: number } {
    let offset = 2;
    
    while (offset < buffer.length - 8) {
      if (buffer[offset] !== 0xFF) {
        offset++;
        continue;
      }
      
      const marker = buffer[offset + 1];
      
      // SOF0, SOF1, SOF2 markers contain dimensions
      if (marker >= 0xC0 && marker <= 0xC2) {
        return {
          height: buffer.readUInt16BE(offset + 5),
          width: buffer.readUInt16BE(offset + 7)
        };
      }
      
      // Skip to next marker
      const length = buffer.readUInt16BE(offset + 2);
      offset += 2 + length;
    }
    
    return { width: 0, height: 0 };
  }

  /**
   * Check if image has alpha channel
   */
  private hasAlphaChannel(buffer: Buffer, format: string): boolean {
    if (format === 'png') {
      // PNG color type at byte 25
      if (buffer.length >= 26) {
        const colorType = buffer[25];
        return colorType === 4 || colorType === 6; // Grayscale+Alpha or RGBA
      }
    }
    if (format === 'webp') {
      // WebP VP8L or VP8X can have alpha
      return buffer.length > 20 && (buffer[15] === 0x4C || buffer[12] === 0x58);
    }
    return false;
  }

  /**
   * Validate image against config limits
   */
  private validateImage(buffer: Buffer, metadata: ImageMetadata): void {
    if (buffer.length > this.config.maxImageSize) {
      throw new Error(`Image too large: ${buffer.length} bytes (max: ${this.config.maxImageSize})`);
    }
    
    if (!this.config.supportedFormats.includes(metadata.format)) {
      throw new Error(`Unsupported format: ${metadata.format}`);
    }
  }

  /**
   * Detect objects in image using vision model
   */
  private async detectObjects(
    buffer: Buffer,
    _metadata: ImageMetadata
  ): Promise<DetectedObject[]> {
    // Use vision API for object detection
    const base64 = buffer.toString('base64');
    
    try {
      // This would integrate with a vision model API
      // For now, return placeholder that will be filled by actual API
      const prompt = `Analyze this image and list all objects you can identify. 
        For each object, provide:
        - label: what the object is
        - confidence: how confident you are (0-1)
        Return as JSON array.`;
      
      // Placeholder - actual implementation would call vision API
      logger.debug('Object detection requested', { imageSize: base64.length });
      
      return [];
    } catch (error) {
      logger.warn('Object detection failed', error);
      return [];
    }
  }

  /**
   * Extract text from image using OCR
   */
  private async extractText(
    buffer: Buffer,
    _metadata: ImageMetadata
  ): Promise<ExtractedText[]> {
    if (!this.config.ocrEnabled) {
      return [];
    }
    
    try {
      // This would integrate with OCR service (Tesseract, Cloud Vision, etc.)
      const base64 = buffer.toString('base64');
      
      logger.debug('OCR requested', { imageSize: base64.length });
      
      // Placeholder for OCR integration
      return [];
    } catch (error) {
      logger.warn('OCR extraction failed', error);
      return [];
    }
  }

  /**
   * Analyze dominant colors in image
   */
  private async analyzeColors(buffer: Buffer): Promise<ColorInfo[]> {
    try {
      // Simple color extraction from raw pixel data
      // More sophisticated implementation would use k-means clustering
      const colors: Map<string, number> = new Map();
      const format = this.detectFormat(buffer);
      
      // For PNG, we can sample pixels from the raw data
      // This is a simplified version - real implementation would decode properly
      if (format === 'png' || format === 'bmp') {
        const step = Math.max(1, Math.floor(buffer.length / 1000));
        
        for (let i = 0; i < buffer.length - 3; i += step) {
          const r = buffer[i] & 0xF0;
          const g = buffer[i + 1] & 0xF0;
          const b = buffer[i + 2] & 0xF0;
          const hex = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
          colors.set(hex, (colors.get(hex) || 0) + 1);
        }
      }
      
      // Sort by frequency and take top 5
      const sorted = Array.from(colors.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
      
      const total = sorted.reduce((sum, [, count]) => sum + count, 0);
      
      return sorted.map(([hex, count]) => {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        
        return {
          hex,
          rgb: { r, g, b },
          percentage: Math.round((count / total) * 100),
          name: this.getColorName(r, g, b)
        };
      });
    } catch (error) {
      logger.warn('Color analysis failed', error);
      return [];
    }
  }

  /**
   * Get approximate color name
   */
  private getColorName(r: number, g: number, b: number): string {
    const colors: Record<string, [number, number, number]> = {
      'red': [255, 0, 0],
      'green': [0, 255, 0],
      'blue': [0, 0, 255],
      'yellow': [255, 255, 0],
      'cyan': [0, 255, 255],
      'magenta': [255, 0, 255],
      'white': [255, 255, 255],
      'black': [0, 0, 0],
      'gray': [128, 128, 128],
      'orange': [255, 165, 0],
      'purple': [128, 0, 128],
      'pink': [255, 192, 203],
      'brown': [139, 69, 19]
    };
    
    let closestColor = 'unknown';
    let minDistance = Infinity;
    
    for (const [name, [cr, cg, cb]] of Object.entries(colors)) {
      const distance = Math.sqrt(
        Math.pow(r - cr, 2) + Math.pow(g - cg, 2) + Math.pow(b - cb, 2)
      );
      if (distance < minDistance) {
        minDistance = distance;
        closestColor = name;
      }
    }
    
    return closestColor;
  }

  /**
   * Generate natural language description of image
   */
  private async generateDescription(
    buffer: Buffer,
    analysis: {
      objects: DetectedObject[];
      text: ExtractedText[];
      colors: ColorInfo[];
    }
  ): Promise<string> {
    try {
      const base64 = buffer.toString('base64');
      
      // This would call a vision-language model
      // For now, generate description from available analysis
      const parts: string[] = [];
      
      if (analysis.objects.length > 0) {
        const objectNames = analysis.objects.map(o => o.label).join(', ');
        parts.push(`Contains: ${objectNames}`);
      }
      
      if (analysis.text.length > 0) {
        const textContent = analysis.text.map(t => t.text).join(' ');
        if (textContent.length > 100) {
          parts.push(`Text: "${textContent.slice(0, 100)}..."`);
        } else if (textContent.length > 0) {
          parts.push(`Text: "${textContent}"`);
        }
      }
      
      if (analysis.colors.length > 0) {
        const dominantColor = analysis.colors[0].name;
        parts.push(`Dominant color: ${dominantColor}`);
      }
      
      logger.debug('Description generated', { base64Length: base64.length });
      
      return parts.join('. ') || 'Image analysis completed';
    } catch (error) {
      logger.warn('Description generation failed', error);
      return 'Unable to generate description';
    }
  }

  /**
   * Calculate overall confidence score
   */
  private calculateOverallConfidence(
    objects: DetectedObject[],
    text: ExtractedText[]
  ): number {
    const scores: number[] = [];
    
    objects.forEach(o => scores.push(o.confidence));
    text.forEach(t => scores.push(t.confidence));
    
    if (scores.length === 0) return 0.5;
    
    return scores.reduce((a, b) => a + b, 0) / scores.length;
  }

  /**
   * Convert image to base64 for API calls
   */
  async toBase64(input: string | Buffer): Promise<string> {
    const buffer = typeof input === 'string' 
      ? fs.readFileSync(input) 
      : input;
    
    const format = this.detectFormat(buffer);
    const mimeType = `image/${format === 'jpg' ? 'jpeg' : format}`;
    
    return `data:${mimeType};base64,${buffer.toString('base64')}`;
  }

  /**
   * Resize image for processing
   */
  async resize(
    input: string | Buffer,
    maxDimension: number
  ): Promise<Buffer> {
    // This would use sharp or similar library for actual resizing
    // For now, return original buffer
    const buffer = typeof input === 'string' 
      ? fs.readFileSync(input) 
      : input;
    
    logger.debug('Resize requested', { maxDimension });
    
    return buffer;
  }

  getStatus(): { initialized: boolean; config: ImageProcessorConfig } {
    return {
      initialized: this.initialized,
      config: this.config
    };
  }
}

// Singleton instance
let imageProcessor: ImageProcessor | null = null;

export function getImageProcessor(): ImageProcessor {
  if (!imageProcessor) {
    imageProcessor = new ImageProcessor();
  }
  return imageProcessor;
}

export { ImageProcessor };
