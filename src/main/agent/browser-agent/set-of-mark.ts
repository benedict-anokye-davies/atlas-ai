/**
 * Set-of-Mark Visual Prompting System
 *
 * Overlays numbered visual markers on interactive elements and captures
 * annotated screenshots for multimodal LLM understanding.
 * Inspired by the SoM technique used in WebVoyager and other browser agents.
 *
 * @module agent/browser-agent/set-of-mark
 */

import { createModuleLogger } from '../../utils/logger';
import {
  IndexedElement,
  AnnotatedScreenshot,
  RenderedMarker,
  SetOfMarkConfig,
  MarkerStyle,
  DEFAULT_SET_OF_MARK_CONFIG,
  ElementRole,
} from './types';
import { DOMSerializer } from './dom-serializer';

const logger = createModuleLogger('SetOfMark');

// ============================================================================
// Marker Injection Script
// ============================================================================

/**
 * Script to inject visual markers onto the page
 */
const createMarkerInjectionScript = (
  elements: IndexedElement[],
  style: MarkerStyle
) => `
(function() {
  // Remove any existing markers
  const existing = document.querySelectorAll('.atlas-som-marker');
  existing.forEach(el => el.remove());
  
  const elements = ${JSON.stringify(elements)};
  const style = ${JSON.stringify(style)};
  
  // Create marker container
  const container = document.createElement('div');
  container.id = 'atlas-som-container';
  container.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: ' + style.zIndex + ';';
  document.body.appendChild(container);
  
  const markers = [];
  
  for (const el of elements) {
    // Only mark elements in viewport
    if (!el.bounds.isInViewport) continue;
    
    // Create marker element
    const marker = document.createElement('div');
    marker.className = 'atlas-som-marker';
    marker.textContent = el.index.toString();
    marker.style.cssText = [
      'position: fixed',
      'background-color: ' + style.backgroundColor,
      'color: ' + style.textColor,
      'font-size: ' + style.fontSize + 'px',
      'font-weight: bold',
      'font-family: Arial, sans-serif',
      'padding: ' + style.padding + 'px ' + (style.padding + 2) + 'px',
      'border-radius: ' + style.borderRadius + 'px',
      'opacity: ' + style.opacity,
      'z-index: ' + style.zIndex,
      'pointer-events: none',
      'white-space: nowrap',
      'box-shadow: 0 2px 4px rgba(0,0,0,0.3)',
      'border: 1px solid rgba(255,255,255,0.3)',
    ].join('; ');
    
    // Position marker at top-left corner of element
    let markerX = el.bounds.x;
    let markerY = el.bounds.y;
    
    // Ensure marker stays in viewport
    const markerWidth = 24; // Approximate
    const markerHeight = 20;
    
    if (markerX + markerWidth > window.innerWidth) {
      markerX = el.bounds.x + el.bounds.width - markerWidth;
    }
    if (markerY < 0) {
      markerY = el.bounds.y + el.bounds.height;
    }
    if (markerY + markerHeight > window.innerHeight) {
      markerY = el.bounds.y - markerHeight;
    }
    
    // Clamp to viewport
    markerX = Math.max(0, Math.min(markerX, window.innerWidth - markerWidth));
    markerY = Math.max(0, Math.min(markerY, window.innerHeight - markerHeight));
    
    marker.style.left = markerX + 'px';
    marker.style.top = markerY + 'px';
    
    container.appendChild(marker);
    
    markers.push({
      index: el.index,
      position: { x: markerX, y: markerY },
      elementBounds: el.bounds,
      wasClipped: markerX !== el.bounds.x || markerY !== el.bounds.y,
    });
    
    // Also add a subtle highlight on the element
    const highlight = document.createElement('div');
    highlight.className = 'atlas-som-marker atlas-som-highlight';
    highlight.style.cssText = [
      'position: fixed',
      'left: ' + el.bounds.x + 'px',
      'top: ' + el.bounds.y + 'px',
      'width: ' + el.bounds.width + 'px',
      'height: ' + el.bounds.height + 'px',
      'border: 2px solid ' + style.backgroundColor,
      'border-radius: 3px',
      'pointer-events: none',
      'z-index: ' + (style.zIndex - 1),
      'opacity: 0.5',
    ].join('; ');
    
    container.appendChild(highlight);
  }
  
  return markers;
})()
`;

/**
 * Script to remove all markers
 */
const REMOVE_MARKERS_SCRIPT = `
(function() {
  const container = document.getElementById('atlas-som-container');
  if (container) container.remove();
  
  const markers = document.querySelectorAll('.atlas-som-marker');
  markers.forEach(el => el.remove());
})()
`;

// ============================================================================
// Set-of-Mark Manager Class
// ============================================================================

export class SetOfMarkManager {
  private page: any;
  private config: SetOfMarkConfig;
  private domSerializer: DOMSerializer;
  private lastMarkers: RenderedMarker[] = [];

  constructor(page: any, config?: Partial<SetOfMarkConfig>) {
    this.page = page;
    this.config = { ...DEFAULT_SET_OF_MARK_CONFIG, ...config };
    this.domSerializer = new DOMSerializer(page);
  }

  /**
   * Capture annotated screenshot with visual markers
   */
  async captureAnnotatedScreenshot(): Promise<AnnotatedScreenshot> {
    const startTime = Date.now();

    try {
      // First, get the current browser state
      const state = await this.domSerializer.extractBrowserState(false);

      // Filter elements to mark
      const elementsToMark = this.filterElementsForMarking(state.elements);

      // Inject markers onto the page
      const markers = await this.injectMarkers(elementsToMark);
      this.lastMarkers = markers;

      // Take screenshot with markers
      const screenshotBuffer = await this.page.screenshot({
        encoding: 'base64',
        fullPage: false, // Viewport only for SoM
      });

      // Remove markers immediately
      await this.removeMarkers();

      // Get viewport dimensions
      const viewport = await this.page.evaluate(() => ({
        width: window.innerWidth,
        height: window.innerHeight,
      }));

      // Create element map
      const elementMap = new Map<number, IndexedElement>();
      for (const el of elementsToMark) {
        elementMap.set(el.index, el);
      }

      const result: AnnotatedScreenshot = {
        image: screenshotBuffer as string,
        width: viewport.width,
        height: viewport.height,
        elementMap,
        renderedMarkers: markers,
        timestamp: Date.now(),
      };

      logger.debug('Captured annotated screenshot', {
        markerCount: markers.length,
        totalElements: state.elements.length,
        durationMs: Date.now() - startTime,
      });

      return result;
    } catch (error) {
      // Ensure markers are cleaned up on error
      await this.removeMarkers().catch(() => {});
      logger.error('Failed to capture annotated screenshot', { error });
      throw error;
    }
  }

  /**
   * Inject markers without taking screenshot (for interactive viewing)
   */
  async showMarkers(): Promise<RenderedMarker[]> {
    const state = await this.domSerializer.extractBrowserState(false);
    const elementsToMark = this.filterElementsForMarking(state.elements);
    const markers = await this.injectMarkers(elementsToMark);
    this.lastMarkers = markers;
    return markers;
  }

  /**
   * Remove all markers from the page
   */
  async removeMarkers(): Promise<void> {
    await this.page.evaluate(REMOVE_MARKERS_SCRIPT);
    this.lastMarkers = [];
  }

  /**
   * Update marker style configuration
   */
  updateConfig(config: Partial<SetOfMarkConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get currently rendered markers
   */
  getLastMarkers(): RenderedMarker[] {
    return this.lastMarkers;
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  /**
   * Filter elements suitable for marking
   */
  private filterElementsForMarking(elements: IndexedElement[]): IndexedElement[] {
    let filtered = elements;

    // Only visible elements
    if (this.config.visibleOnly) {
      filtered = filtered.filter((el) => el.bounds.isInViewport && el.bounds.isVisible);
    }

    // Minimum size filter
    filtered = filtered.filter(
      (el) =>
        el.bounds.width >= this.config.minElementSize.width &&
        el.bounds.height >= this.config.minElementSize.height
    );

    // Role filter
    if (this.config.markableRoles.length > 0) {
      filtered = filtered.filter((el) =>
        this.config.markableRoles.includes(el.role as ElementRole)
      );
    }

    // Limit count
    if (filtered.length > this.config.maxMarkers) {
      // Prioritize certain elements
      filtered = this.prioritizeElements(filtered).slice(0, this.config.maxMarkers);
    }

    return filtered;
  }

  /**
   * Prioritize elements for marking (most important first)
   */
  private prioritizeElements(elements: IndexedElement[]): IndexedElement[] {
    return elements.sort((a, b) => {
      // Prioritize by semantic purpose (known purposes first)
      const purposeScore = (el: IndexedElement) => (el.semanticPurpose ? 10 : 0);

      // Prioritize by role (buttons and links first)
      const roleScore = (el: IndexedElement) => {
        switch (el.role) {
          case 'button':
            return 8;
          case 'link':
            return 7;
          case 'textbox':
          case 'searchbox':
            return 6;
          case 'checkbox':
          case 'radio':
            return 5;
          case 'combobox':
          case 'listbox':
            return 4;
          default:
            return 0;
        }
      };

      // Prioritize elements higher on page
      const positionScore = (el: IndexedElement) => 1000 - el.bounds.y;

      const scoreA = purposeScore(a) + roleScore(a) + positionScore(a) / 100;
      const scoreB = purposeScore(b) + roleScore(b) + positionScore(b) / 100;

      return scoreB - scoreA;
    });
  }

  /**
   * Inject markers onto the page
   */
  private async injectMarkers(elements: IndexedElement[]): Promise<RenderedMarker[]> {
    const script = createMarkerInjectionScript(elements, this.config.markerStyle);
    const markers = await this.page.evaluate(script);
    return markers as RenderedMarker[];
  }
}

// ============================================================================
// Visual Marker Styles Presets
// ============================================================================

export const MARKER_STYLE_PRESETS: Record<string, MarkerStyle> = {
  default: {
    backgroundColor: '#FF5722',
    textColor: '#FFFFFF',
    fontSize: 12,
    padding: 4,
    borderRadius: 4,
    opacity: 0.9,
    zIndex: 999999,
  },
  highContrast: {
    backgroundColor: '#000000',
    textColor: '#FFFF00',
    fontSize: 14,
    padding: 5,
    borderRadius: 0,
    opacity: 1,
    zIndex: 999999,
  },
  subtle: {
    backgroundColor: '#1976D2',
    textColor: '#FFFFFF',
    fontSize: 10,
    padding: 3,
    borderRadius: 8,
    opacity: 0.7,
    zIndex: 999999,
  },
  neon: {
    backgroundColor: '#00FF00',
    textColor: '#000000',
    fontSize: 12,
    padding: 4,
    borderRadius: 4,
    opacity: 0.95,
    zIndex: 999999,
  },
};

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a Set-of-Mark manager for a Puppeteer page
 */
export function createSetOfMarkManager(
  page: any,
  config?: Partial<SetOfMarkConfig>
): SetOfMarkManager {
  return new SetOfMarkManager(page, config);
}
