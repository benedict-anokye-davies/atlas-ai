/**
 * Atlas Desktop - Screen Understanding
 *
 * Vision system for understanding VM screen content.
 * Uses OCR, UI element detection, and LLM vision for comprehension.
 *
 * @module vm-agent/screen-understanding
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import {
  ScreenState,
  UIElement,
  ScreenChange,
} from './types';
import * as crypto from 'crypto';

const logger = createModuleLogger('ScreenUnderstanding');

// =============================================================================
// Constants
// =============================================================================

/**
 * Common UI patterns for detection
 */
const UI_PATTERNS = {
  button: {
    shapes: ['rectangle', 'rounded-rectangle'],
    hasText: true,
    colors: ['blue', 'green', 'red', 'gray'],
    minWidth: 40,
    maxWidth: 300,
    minHeight: 20,
    maxHeight: 60,
  },
  textbox: {
    shapes: ['rectangle'],
    hasBorder: true,
    backgroundColor: 'white',
    minWidth: 100,
  },
  checkbox: {
    shapes: ['square'],
    minWidth: 12,
    maxWidth: 30,
    aspectRatio: 1,
  },
  icon: {
    shapes: ['square', 'circle'],
    minWidth: 16,
    maxWidth: 64,
    aspectRatio: 1,
  },
};

/**
 * WorldBox-specific UI knowledge
 */
const WORLDBOX_UI = {
  toolbarTop: { y: 0, height: 50 },
  toolbarBottom: { y: -100, height: 100 }, // Negative = from bottom
  sidePanel: { x: 0, width: 60 },
  categories: [
    'creatures', 'nature', 'powers', 'kingdoms', 'world',
    'disasters', 'other', 'debug',
  ],
  commonTools: [
    'spawn', 'inspect', 'eraser', 'brush', 'finger',
    'lightning', 'fire', 'earthquake', 'nuke',
  ],
};

// =============================================================================
// Screen Understanding Class
// =============================================================================

/**
 * Analyzes and understands VM screen content
 */
export class ScreenUnderstanding extends EventEmitter {
  private ocrEnabled: boolean = true;
  private uiDetectionEnabled: boolean = true;
  private lastState: ScreenState | null = null;
  private stateHistory: ScreenState[] = [];
  private maxHistorySize: number = 10;

  constructor() {
    super();
  }

  /**
   * Analyze a screenshot and extract understanding
   */
  async analyzeScreen(screenshotBuffer: Buffer): Promise<ScreenState> {
    const timestamp = Date.now();
    const screenshot = screenshotBuffer.toString('base64');
    const stateHash = this.computeHash(screenshotBuffer);

    // Get image dimensions
    const dimensions = await this.getImageDimensions(screenshotBuffer);

    // Run analysis in parallel
    const [elements, textRegions] = await Promise.all([
      this.uiDetectionEnabled ? this.detectUIElements(screenshotBuffer) : [],
      this.ocrEnabled ? this.extractText(screenshotBuffer) : [],
    ]);

    // Detect active window from text and UI
    const activeWindow = this.detectActiveWindow(elements, textRegions);

    const state: ScreenState = {
      timestamp,
      screenshot,
      resolution: dimensions,
      elements,
      textRegions,
      activeWindow,
      stateHash,
    };

    // Check for changes
    if (this.lastState) {
      const change = this.detectChanges(this.lastState, state);
      if (change.changePercentage > 0.01) {
        this.emit('screenChange', change);
      }
    }

    // Update history
    this.lastState = state;
    this.stateHistory.push(state);
    if (this.stateHistory.length > this.maxHistorySize) {
      this.stateHistory.shift();
    }

    return state;
  }

  /**
   * Find a UI element by description
   */
  findElement(state: ScreenState, description: string): UIElement | null {
    const descLower = description.toLowerCase();

    // First, try exact text match
    for (const element of state.elements) {
      if (element.text?.toLowerCase() === descLower) {
        return element;
      }
    }

    // Then try partial text match
    for (const element of state.elements) {
      if (element.text?.toLowerCase().includes(descLower)) {
        return element;
      }
    }

    // Try matching by type + text
    const typeMatches: Record<string, string[]> = {
      button: ['click', 'press', 'button', 'btn'],
      textbox: ['type', 'input', 'text', 'field', 'box'],
      checkbox: ['check', 'checkbox', 'toggle'],
      link: ['link', 'url', 'href'],
      menu: ['menu', 'dropdown'],
    };

    for (const [type, keywords] of Object.entries(typeMatches)) {
      if (keywords.some(k => descLower.includes(k))) {
        const typeElements = state.elements.filter(e => e.type === type);
        if (typeElements.length === 1) {
          return typeElements[0];
        }
        // If multiple, try to find one with matching text
        for (const el of typeElements) {
          if (el.text && descLower.includes(el.text.toLowerCase())) {
            return el;
          }
        }
      }
    }

    // Look in text regions if no element found
    for (const region of state.textRegions) {
      if (region.text.toLowerCase().includes(descLower)) {
        // Create a pseudo-element for the text region
        return {
          id: `text_${region.bounds.x}_${region.bounds.y}`,
          type: 'text',
          bounds: region.bounds,
          center: {
            x: region.bounds.x + region.bounds.width / 2,
            y: region.bounds.y + region.bounds.height / 2,
          },
          text: region.text,
          confidence: region.confidence,
          isInteractive: false,
        };
      }
    }

    return null;
  }

  /**
   * Find all clickable elements
   */
  findClickableElements(state: ScreenState): UIElement[] {
    return state.elements.filter(e => e.isInteractive);
  }

  /**
   * Find element at coordinates
   */
  findElementAt(state: ScreenState, x: number, y: number): UIElement | null {
    for (const element of state.elements) {
      if (
        x >= element.bounds.x &&
        x <= element.bounds.x + element.bounds.width &&
        y >= element.bounds.y &&
        y <= element.bounds.y + element.bounds.height
      ) {
        return element;
      }
    }
    return null;
  }

  /**
   * Get screen summary for LLM
   */
  getScreenSummary(state: ScreenState): string {
    const parts: string[] = [];

    if (state.activeWindow) {
      parts.push(`Active Window: ${state.activeWindow.title} (${state.activeWindow.application})`);
    }

    parts.push(`Resolution: ${state.resolution.width}x${state.resolution.height}`);
    parts.push(`UI Elements: ${state.elements.length}`);

    // Group elements by type
    const byType: Record<string, UIElement[]> = {};
    for (const el of state.elements) {
      if (!byType[el.type]) byType[el.type] = [];
      byType[el.type].push(el);
    }

    for (const [type, elements] of Object.entries(byType)) {
      const withText = elements.filter(e => e.text);
      if (withText.length > 0) {
        const textList = withText.slice(0, 5).map(e => `"${e.text}"`).join(', ');
        parts.push(`${type}s: ${textList}${withText.length > 5 ? '...' : ''}`);
      } else {
        parts.push(`${type}s: ${elements.length}`);
      }
    }

    // Include visible text
    if (state.textRegions.length > 0) {
      const allText = state.textRegions.map(r => r.text).join(' ').slice(0, 500);
      parts.push(`\nVisible text: ${allText}${allText.length === 500 ? '...' : ''}`);
    }

    return parts.join('\n');
  }

  /**
   * Detect if this is WorldBox
   */
  isWorldBox(state: ScreenState): boolean {
    const titleMatch = state.activeWindow?.title.toLowerCase().includes('worldbox');
    const textMatch = state.textRegions.some(r => 
      r.text.toLowerCase().includes('worldbox') ||
      r.text.toLowerCase().includes('god simulator')
    );
    return titleMatch || textMatch;
  }

  /**
   * Get WorldBox-specific understanding
   */
  getWorldBoxState(state: ScreenState): {
    selectedTool?: string;
    activeCategory?: string;
    menuOpen: boolean;
  } {
    const result = {
      menuOpen: false,
      selectedTool: undefined as string | undefined,
      activeCategory: undefined as string | undefined,
    };

    // Check for menu/settings text
    if (state.textRegions.some(r => ['settings', 'options', 'save', 'load'].some(t => 
      r.text.toLowerCase().includes(t) && r.bounds.x > state.resolution.width / 3
    ))) {
      result.menuOpen = true;
    }

    // Look for tool categories in the left panel
    for (const category of WORLDBOX_UI.categories) {
      if (state.textRegions.some(r => 
        r.text.toLowerCase().includes(category) && 
        r.bounds.x < 100
      )) {
        result.activeCategory = category;
        break;
      }
    }

    // Look for tool names
    for (const tool of WORLDBOX_UI.commonTools) {
      if (state.textRegions.some(r => r.text.toLowerCase() === tool)) {
        result.selectedTool = tool;
        break;
      }
    }

    return result;
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Detect UI elements in screenshot
   */
  private async detectUIElements(screenshot: Buffer): Promise<UIElement[]> {
    const elements: UIElement[] = [];

    try {
      // Try to use sharp for image analysis
      const sharp = await this.getSharp();
      if (!sharp) return elements;

      const image = sharp(screenshot);
      const metadata = await image.metadata();
      const width = metadata.width || 1920;
      const height = metadata.height || 1080;

      // Get raw pixel data for edge detection
      const { data, info } = await image
        .raw()
        .toBuffer({ resolveWithObject: true });

      // Simple edge detection to find rectangles
      const edges = this.detectEdges(data, info.width, info.height, info.channels);

      // Find rectangular regions (potential buttons, textboxes, etc.)
      const rectangles = this.findRectangles(edges, info.width, info.height);

      // Classify each rectangle
      let elementId = 0;
      for (const rect of rectangles) {
        const element = this.classifyRectangle(rect, elementId++, data, info);
        if (element) {
          elements.push(element);
        }
      }

    } catch (error) {
      logger.debug('UI detection error', { error: (error as Error).message });
    }

    return elements;
  }

  /**
   * Extract text from screenshot using OCR
   */
  private async extractText(screenshot: Buffer): Promise<Array<{
    text: string;
    bounds: { x: number; y: number; width: number; height: number };
    confidence: number;
  }>> {
    const regions: Array<{
      text: string;
      bounds: { x: number; y: number; width: number; height: number };
      confidence: number;
    }> = [];

    try {
      // Try to use Tesseract.js or built-in OCR
      const { getOCRManager } = await import('../agent/tools/ocr');
      const ocrManager = getOCRManager();

      // Initialize if needed
      await ocrManager.initialize();
      
      const result = await ocrManager.extractFromBuffer(screenshot);

      if (result.text) {
        // Parse OCR result into regions
        const lines = result.text.split('\n');
        let y = 0;
        for (const line of lines) {
          if (line.trim()) {
            regions.push({
              text: line.trim(),
              bounds: { x: 0, y, width: 500, height: 20 },
              confidence: result.confidence || 0.8,
            });
          }
          y += 20;
        }
      }
    } catch (error) {
      logger.debug('OCR not available', { error: (error as Error).message });
    }

    return regions;
  }

  /**
   * Detect active window from screen content
   */
  private detectActiveWindow(
    elements: UIElement[],
    textRegions: Array<{ text: string; bounds: { x: number; y: number; width: number; height: number } }>
  ): { title: string; application: string } | undefined {
    // Look for title bar text (usually at the top of screen)
    const topText = textRegions
      .filter(r => r.bounds.y < 50)
      .sort((a, b) => a.bounds.y - b.bounds.y);

    if (topText.length > 0) {
      const titleText = topText[0].text;

      // Try to identify application
      let application = 'Unknown';
      if (titleText.toLowerCase().includes('worldbox')) application = 'WorldBox';
      else if (titleText.toLowerCase().includes('chrome')) application = 'Chrome';
      else if (titleText.toLowerCase().includes('firefox')) application = 'Firefox';
      else if (titleText.toLowerCase().includes('explorer')) application = 'Explorer';
      else if (titleText.toLowerCase().includes('code')) application = 'VS Code';
      else if (titleText.toLowerCase().includes('notepad')) application = 'Notepad';

      return { title: titleText, application };
    }

    return undefined;
  }

  /**
   * Detect changes between two screen states
   */
  private detectChanges(previous: ScreenState, current: ScreenState): ScreenChange {
    let changedPixels = 0;
    const totalPixels = current.resolution.width * current.resolution.height;

    // Simple hash comparison for now
    const hashMatch = previous.stateHash === current.stateHash;

    return {
      previousHash: previous.stateHash,
      newHash: current.stateHash,
      changedRegions: [], // Would need proper image diff
      changePercentage: hashMatch ? 0 : 0.5, // Assume 50% if hashes differ
      timeSinceLastMs: current.timestamp - previous.timestamp,
    };
  }

  /**
   * Compute hash of screenshot for change detection
   */
  private computeHash(buffer: Buffer): string {
    // Use a sampling approach for faster hashing
    const sample = Buffer.alloc(1000);
    const step = Math.floor(buffer.length / 1000);
    for (let i = 0; i < 1000; i++) {
      sample[i] = buffer[i * step] || 0;
    }
    return crypto.createHash('md5').update(sample).digest('hex');
  }

  /**
   * Get image dimensions
   */
  private async getImageDimensions(buffer: Buffer): Promise<{ width: number; height: number }> {
    try {
      const sharp = await this.getSharp();
      if (sharp) {
        const metadata = await sharp(buffer).metadata();
        return {
          width: metadata.width || 1920,
          height: metadata.height || 1080,
        };
      }
    } catch {
      // Fallback
    }
    return { width: 1920, height: 1080 };
  }

  /**
   * Simple edge detection (Sobel-like)
   */
  private detectEdges(data: Buffer, width: number, height: number, channels: number): Uint8Array {
    const edges = new Uint8Array(width * height);

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = (y * width + x) * channels;

        // Get grayscale values of neighbors
        const getGray = (dx: number, dy: number) => {
          const i = ((y + dy) * width + (x + dx)) * channels;
          return (data[i] + data[i + 1] + data[i + 2]) / 3;
        };

        // Sobel operators
        const gx = 
          -1 * getGray(-1, -1) + 1 * getGray(1, -1) +
          -2 * getGray(-1, 0) + 2 * getGray(1, 0) +
          -1 * getGray(-1, 1) + 1 * getGray(1, 1);

        const gy = 
          -1 * getGray(-1, -1) - 2 * getGray(0, -1) - 1 * getGray(1, -1) +
          1 * getGray(-1, 1) + 2 * getGray(0, 1) + 1 * getGray(1, 1);

        edges[y * width + x] = Math.min(255, Math.sqrt(gx * gx + gy * gy));
      }
    }

    return edges;
  }

  /**
   * Find rectangular regions from edge data
   */
  private findRectangles(
    edges: Uint8Array,
    width: number,
    height: number
  ): Array<{ x: number; y: number; width: number; height: number }> {
    const rectangles: Array<{ x: number; y: number; width: number; height: number }> = [];

    // Simplified: Look for horizontal and vertical lines
    // Real implementation would use proper contour detection
    const threshold = 50;
    const visited = new Uint8Array(width * height);

    for (let y = 0; y < height; y += 10) {
      for (let x = 0; x < width; x += 10) {
        if (edges[y * width + x] > threshold && !visited[y * width + x]) {
          // Found an edge, try to trace a rectangle
          const rect = this.traceRectangle(edges, visited, x, y, width, height, threshold);
          if (rect && rect.width > 20 && rect.height > 10) {
            rectangles.push(rect);
          }
        }
      }
    }

    return rectangles;
  }

  /**
   * Trace a rectangle from a starting edge point
   */
  private traceRectangle(
    edges: Uint8Array,
    visited: Uint8Array,
    startX: number,
    startY: number,
    width: number,
    height: number,
    threshold: number
  ): { x: number; y: number; width: number; height: number } | null {
    let minX = startX, maxX = startX;
    let minY = startY, maxY = startY;

    // Simple flood fill to find connected edge pixels
    const stack = [[startX, startY]];
    let pixels = 0;
    const maxPixels = 10000;

    while (stack.length > 0 && pixels < maxPixels) {
      const [x, y] = stack.pop()!;
      const idx = y * width + x;

      if (x < 0 || x >= width || y < 0 || y >= height) continue;
      if (visited[idx] || edges[idx] < threshold) continue;

      visited[idx] = 1;
      pixels++;

      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);

      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }

    if (pixels < 40) return null;

    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    };
  }

  /**
   * Classify a rectangle as a UI element type
   */
  private classifyRectangle(
    rect: { x: number; y: number; width: number; height: number },
    id: number,
    data: Buffer,
    info: { width: number; height: number; channels: number }
  ): UIElement | null {
    const aspectRatio = rect.width / rect.height;

    let type: UIElement['type'] = 'unknown';
    let isInteractive = false;

    // Button-like
    if (rect.width >= 40 && rect.width <= 300 && rect.height >= 20 && rect.height <= 60) {
      type = 'button';
      isInteractive = true;
    }
    // Checkbox-like
    else if (Math.abs(aspectRatio - 1) < 0.2 && rect.width >= 12 && rect.width <= 30) {
      type = 'checkbox';
      isInteractive = true;
    }
    // Icon-like
    else if (Math.abs(aspectRatio - 1) < 0.3 && rect.width >= 16 && rect.width <= 64) {
      type = 'icon';
      isInteractive = true;
    }
    // Textbox-like
    else if (rect.width >= 100 && rect.height >= 20 && rect.height <= 40) {
      type = 'textbox';
      isInteractive = true;
    }
    // Window-like
    else if (rect.width > 200 && rect.height > 100) {
      type = 'window';
      isInteractive = false;
    }

    return {
      id: `element_${id}`,
      type,
      bounds: rect,
      center: {
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2,
      },
      confidence: 0.7,
      isInteractive,
    };
  }

  /**
   * Lazy load sharp
   */
  private async getSharp(): Promise<typeof import('sharp') | null> {
    try {
      const sharp = (await import('sharp')).default;
      return sharp;
    } catch {
      return null;
    }
  }
}

// =============================================================================
// Singleton & Exports
// =============================================================================

let understandingInstance: ScreenUnderstanding | null = null;

/**
 * Get the screen understanding singleton
 */
export function getScreenUnderstanding(): ScreenUnderstanding {
  if (!understandingInstance) {
    understandingInstance = new ScreenUnderstanding();
  }
  return understandingInstance;
}

export default ScreenUnderstanding;
