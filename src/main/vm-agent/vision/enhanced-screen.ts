/**
 * Atlas Desktop - VM Agent Enhanced Screen Understanding
 *
 * Combines all vision capabilities into a unified screen understanding
 * system that provides comprehensive screen analysis.
 *
 * @module vm-agent/vision/enhanced-screen
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../../utils/logger';
import { getEventBus, createEvent } from '../core/event-bus';
import { ScreenState, UIElement } from '../types';
import { EnhancedUIElement, ElementSelector } from '../core/types';
import { getVLMAnalyzer, VLMAnalyzer, ScreenAnalysis } from './vlm-analyzer';
import { getVisualMemory, VisualMemoryManager } from './visual-memory';
import { getSelfHealingSelectors, SelfHealingSelectorsManager } from './self-healing-selectors';

const logger = createModuleLogger('EnhancedScreen');

// =============================================================================
// Enhanced Screen Constants
// =============================================================================

export const ENHANCED_SCREEN_CONSTANTS = {
  /** Cache duration for full analysis (ms) */
  FULL_ANALYSIS_CACHE_MS: 5000,
  /** Minimum elements for interaction map */
  MIN_ELEMENTS_FOR_MAP: 5,
  /** OCR confidence threshold */
  OCR_CONFIDENCE_THRESHOLD: 0.7,
  /** Element clustering distance */
  CLUSTERING_DISTANCE: 100,
} as const;

// =============================================================================
// Enhanced Screen Types
// =============================================================================

export interface ScreenUnderstanding {
  /** Original screen state */
  screenState: ScreenState;
  /** Enhanced elements with semantic information */
  enhancedElements: EnhancedUIElement[];
  /** VLM analysis result */
  vlmAnalysis?: ScreenAnalysis;
  /** Visual memory match info */
  memoryMatch?: {
    similar: boolean;
    confidence: number;
    previousState?: string;
  };
  /** Detected application context */
  applicationContext: ApplicationContext;
  /** Interaction map */
  interactionMap: InteractionMap;
  /** Screen layout */
  layout: ScreenLayout;
  /** Confidence in understanding */
  confidence: number;
  /** Timestamp */
  timestamp: number;
}

export interface ApplicationContext {
  /** Detected application name */
  application: string;
  /** Application type */
  type: 'browser' | 'editor' | 'terminal' | 'explorer' | 'office' | 'media' | 'game' | 'system' | 'unknown';
  /** Current screen/view */
  screen: string;
  /** Active task context */
  taskContext?: string;
  /** Detected workflow */
  workflow?: string;
}

export interface InteractionMap {
  /** Primary interactive elements */
  primary: EnhancedUIElement[];
  /** Secondary interactive elements */
  secondary: EnhancedUIElement[];
  /** Input fields */
  inputs: EnhancedUIElement[];
  /** Buttons */
  buttons: EnhancedUIElement[];
  /** Links */
  links: EnhancedUIElement[];
  /** Navigation elements */
  navigation: EnhancedUIElement[];
  /** Content areas */
  content: EnhancedUIElement[];
}

export interface ScreenLayout {
  /** Header region */
  header?: ScreenRegion;
  /** Sidebar region(s) */
  sidebars: ScreenRegion[];
  /** Main content region */
  main?: ScreenRegion;
  /** Footer region */
  footer?: ScreenRegion;
  /** Modal/dialog if present */
  modal?: ScreenRegion;
  /** Layout type */
  type: 'single-column' | 'two-column' | 'three-column' | 'grid' | 'tabbed' | 'modal' | 'unknown';
}

export interface ScreenRegion {
  /** Region bounds */
  bounds: { x: number; y: number; width: number; height: number };
  /** Elements in this region */
  elements: EnhancedUIElement[];
  /** Region purpose */
  purpose: string;
  /** Confidence */
  confidence: number;
}

export interface ElementQuery {
  /** Query by text content */
  text?: string;
  /** Query by element type */
  type?: string;
  /** Query by semantic role */
  role?: string;
  /** Query by purpose */
  purpose?: string;
  /** Query by natural language */
  natural?: string;
  /** Near another element */
  near?: { element: EnhancedUIElement; maxDistance: number };
  /** In a region */
  inRegion?: 'header' | 'sidebar' | 'main' | 'footer' | 'modal';
  /** Is interactive */
  interactive?: boolean;
}

// =============================================================================
// Enhanced Screen Understanding Manager
// =============================================================================

/**
 * Comprehensive screen understanding by combining all vision capabilities
 *
 * @example
 * ```typescript
 * const screen = getEnhancedScreen();
 *
 * // Get full understanding
 * const understanding = await screen.understand(screenState);
 *
 * // Query for elements
 * const submitBtn = await screen.findElement(understanding, {
 *   natural: 'the submit button'
 * });
 *
 * // Get suggested actions
 * const actions = screen.getSuggestedActions(understanding);
 * ```
 */
export class EnhancedScreenManager extends EventEmitter {
  private vlmAnalyzer: VLMAnalyzer;
  private visualMemory: VisualMemoryManager;
  private selfHealing: SelfHealingSelectorsManager;
  private cache: Map<string, { understanding: ScreenUnderstanding; timestamp: number }> = new Map();

  constructor() {
    super();
    this.vlmAnalyzer = getVLMAnalyzer();
    this.visualMemory = getVisualMemory();
    this.selfHealing = getSelfHealingSelectors();
  }

  /**
   * Get comprehensive screen understanding
   */
  async understand(
    screenState: ScreenState,
    options?: {
      useVLM?: boolean;
      useMemory?: boolean;
      deepAnalysis?: boolean;
    },
  ): Promise<ScreenUnderstanding> {
    const useVLM = options?.useVLM ?? true;
    const useMemory = options?.useMemory ?? true;
    const deepAnalysis = options?.deepAnalysis ?? false;

    const cacheKey = this.getCacheKey(screenState);
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < ENHANCED_SCREEN_CONSTANTS.FULL_ANALYSIS_CACHE_MS) {
      return cached.understanding;
    }

    const eventBus = getEventBus();
    const screenTitle = screenState.activeWindow?.title || 'Unknown';
    
    eventBus.emitSync(
      createEvent('screen:analyzed', { title: screenTitle }, 'enhanced-screen', {
        priority: 'normal',
      }),
    );

    logger.info('Starting screen understanding', { title: screenTitle });

    // 1. Enhance elements
    const enhancedElements = this.enhanceElements(screenState);

    // 2. Detect application context
    const applicationContext = this.detectApplicationContext(screenState, enhancedElements);

    // 3. Build interaction map
    const interactionMap = this.buildInteractionMap(enhancedElements);

    // 4. Analyze layout
    const layout = this.analyzeLayout(screenState, enhancedElements);

    // 5. VLM analysis (if enabled)
    let vlmAnalysis: ScreenAnalysis | undefined;
    if (useVLM && screenState.screenshot) {
      try {
        // analyzeScreen takes ScreenState, not screenshot string
        vlmAnalysis = await this.vlmAnalyzer.analyzeScreen(screenState, {
          detailed: deepAnalysis,
        });
      } catch (error) {
        logger.warn('VLM analysis failed', { error });
      }
    }

    // 6. Visual memory check (if enabled)
    // Note: Visual memory integration is simplified - findSimilar not available
    let memoryMatch: ScreenUnderstanding['memoryMatch'];
    if (useMemory) {
      try {
        const snapshot = await this.visualMemory.captureSnapshot(screenState);
        // Just record the snapshot, similarity checking would need different API
        memoryMatch = {
          similar: false,
          confidence: 0,
        };
      } catch (error) {
        logger.debug('Visual memory capture skipped', { error });
      }
    }

    // 7. Deep analysis if requested
    if (deepAnalysis && vlmAnalysis) {
      // Merge VLM insights with element analysis
      this.mergeVLMInsights(enhancedElements, vlmAnalysis);
    }

    // Calculate overall confidence
    let confidence = 0.7;
    if (vlmAnalysis?.confidence) {
      confidence = (confidence + vlmAnalysis.confidence) / 2;
    }
    if (memoryMatch?.similar) {
      confidence = Math.min(1, confidence + 0.1);
    }

    const understanding: ScreenUnderstanding = {
      screenState,
      enhancedElements,
      vlmAnalysis,
      memoryMatch,
      applicationContext,
      interactionMap,
      layout,
      confidence,
      timestamp: Date.now(),
    };

    // Cache result
    this.cache.set(cacheKey, { understanding, timestamp: Date.now() });

    eventBus.emitSync(
      createEvent(
        'screen:analyzed',
        { title: screenState.activeWindow?.title || 'Unknown', confidence },
        'enhanced-screen',
        { priority: 'normal' },
      ),
    );

    return understanding;
  }

  /**
   * Find element(s) matching query
   */
  async findElement(
    understanding: ScreenUnderstanding,
    query: ElementQuery,
  ): Promise<EnhancedUIElement | null> {
    // Natural language query - use VLM description if available
    // Note: queryElement method doesn't exist, use text-based matching instead
    if (query.natural) {
      const naturalLower = query.natural.toLowerCase();
      const matched = understanding.enhancedElements.find((el) => {
        const elText = el.text?.toLowerCase() || '';
        return elText.includes(naturalLower) || naturalLower.includes(elText);
      });
      if (matched) {
        return matched;
      }
    }

    // Direct property matching
    const candidates = understanding.enhancedElements.filter((el) => {
      if (query.text && !el.text?.toLowerCase().includes(query.text.toLowerCase())) {
        return false;
      }
      if (query.type && el.type !== query.type) {
        return false;
      }
      // Note: role and purpose not available on EnhancedUIElement, skip those filters
      if (query.interactive !== undefined && el.isInteractive !== query.interactive) {
        return false;
      }
      if (query.near) {
        const distance = Math.sqrt(
          Math.pow(el.bounds.x - query.near.element.bounds.x, 2) +
            Math.pow(el.bounds.y - query.near.element.bounds.y, 2),
        );
        if (distance > query.near.maxDistance) {
          return false;
        }
      }
      if (query.inRegion) {
        const region = this.getRegion(understanding.layout, query.inRegion);
        if (region && !this.isInRegion(el, region)) {
          return false;
        }
      }
      return true;
    });

    return candidates[0] || null;
  }

  /**
   * Find all elements matching query
   */
  async findElements(
    understanding: ScreenUnderstanding,
    query: ElementQuery,
  ): Promise<EnhancedUIElement[]> {
    const candidates = understanding.enhancedElements.filter((el) => {
      if (query.text && !el.text?.toLowerCase().includes(query.text.toLowerCase())) {
        return false;
      }
      if (query.type && el.type !== query.type) {
        return false;
      }
      // Note: role not available on EnhancedUIElement, skip that filter
      if (query.interactive !== undefined && el.isInteractive !== query.interactive) {
        return false;
      }
      return true;
    });

    return candidates;
  }

  /**
   * Create a tracked selector for an element
   */
  async createTrackedSelector(
    element: EnhancedUIElement,
    understanding: ScreenUnderstanding,
  ): Promise<ElementSelector> {
    return this.selfHealing.createSelector(element, understanding.screenState, {
      application: understanding.applicationContext.application,
      screenContext: understanding.applicationContext.screen,
    });
  }

  /**
   * Find element using tracked selector
   */
  async findBySelector(
    selector: ElementSelector,
    screenState: ScreenState,
  ): Promise<EnhancedUIElement | null> {
    const result = await this.selfHealing.findElement(selector, screenState);
    return result.found ? result.element : null;
  }

  /**
   * Get suggested next actions based on understanding
   */
  getSuggestedActions(understanding: ScreenUnderstanding): Array<{
    action: 'click' | 'type' | 'scroll' | 'wait';
    element?: EnhancedUIElement;
    description: string;
    confidence: number;
  }> {
    const suggestions: Array<{
      action: 'click' | 'type' | 'scroll' | 'wait';
      element?: EnhancedUIElement;
      description: string;
      confidence: number;
    }> = [];

    // Primary buttons are likely next actions
    for (const btn of understanding.interactionMap.buttons.slice(0, 3)) {
      suggestions.push({
        action: 'click',
        element: btn,
        description: `Click "${btn.text || 'button'}"`,
        confidence: 0.7,
      });
    }

    // Input fields may need filling
    for (const input of understanding.interactionMap.inputs) {
      suggestions.push({
        action: 'type',
        element: input,
        description: `Fill "${input.text || 'input'}"`,
        confidence: 0.6,
      });
    }

    // VLM suggestions - use suggestedActions (not suggestedNextSteps)
    if (understanding.vlmAnalysis?.suggestedActions) {
      for (const suggestedAction of understanding.vlmAnalysis.suggestedActions.slice(0, 2)) {
        suggestions.push({
          action: 'click',
          description: suggestedAction.action,
          confidence: suggestedAction.confidence || 0.5,
        });
      }
    }

    // Sort by confidence
    suggestions.sort((a, b) => b.confidence - a.confidence);

    return suggestions.slice(0, 5);
  }

  /**
   * Check if current screen matches expected state
   */
  async verifyState(
    understanding: ScreenUnderstanding,
    expected: {
      application?: string;
      screen?: string;
      hasElement?: ElementQuery;
      notHasElement?: ElementQuery;
    },
  ): Promise<{ matches: boolean; confidence: number; details: string[] }> {
    const details: string[] = [];
    let matches = true;
    let totalChecks = 0;
    let passedChecks = 0;

    if (expected.application) {
      totalChecks++;
      if (understanding.applicationContext.application.toLowerCase().includes(expected.application.toLowerCase())) {
        passedChecks++;
        details.push(`✓ Application matches: ${expected.application}`);
      } else {
        matches = false;
        details.push(`✗ Application mismatch: expected ${expected.application}, got ${understanding.applicationContext.application}`);
      }
    }

    if (expected.screen) {
      totalChecks++;
      if (understanding.applicationContext.screen.toLowerCase().includes(expected.screen.toLowerCase())) {
        passedChecks++;
        details.push(`✓ Screen matches: ${expected.screen}`);
      } else {
        matches = false;
        details.push(`✗ Screen mismatch: expected ${expected.screen}, got ${understanding.applicationContext.screen}`);
      }
    }

    if (expected.hasElement) {
      totalChecks++;
      const found = await this.findElement(understanding, expected.hasElement);
      if (found) {
        passedChecks++;
        details.push(`✓ Element found: ${JSON.stringify(expected.hasElement)}`);
      } else {
        matches = false;
        details.push(`✗ Element not found: ${JSON.stringify(expected.hasElement)}`);
      }
    }

    if (expected.notHasElement) {
      totalChecks++;
      const found = await this.findElement(understanding, expected.notHasElement);
      if (!found) {
        passedChecks++;
        details.push(`✓ Element correctly absent: ${JSON.stringify(expected.notHasElement)}`);
      } else {
        matches = false;
        details.push(`✗ Unexpected element found: ${JSON.stringify(expected.notHasElement)}`);
      }
    }

    const confidence = totalChecks > 0 ? passedChecks / totalChecks : 1;

    return { matches, confidence, details };
  }

  /**
   * Get statistics
   */
  getStats(): {
    cacheSize: number;
    vlmStats: ReturnType<VLMAnalyzer['getStats']>;
    memoryStats: ReturnType<VisualMemoryManager['getStats']>;
    selectorStats: ReturnType<SelfHealingSelectorsManager['getStats']>;
  } {
    return {
      cacheSize: this.cache.size,
      vlmStats: this.vlmAnalyzer.getStats(),
      memoryStats: this.visualMemory.getStats(),
      selectorStats: this.selfHealing.getStats(),
    };
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  private getCacheKey(screenState: ScreenState): string {
    const title = screenState.activeWindow?.title || 'unknown';
    const { width, height } = screenState.resolution;
    return `${title}-${width}x${height}-${screenState.elements.length}`;
  }

  private enhanceElements(screenState: ScreenState): EnhancedUIElement[] {
    return screenState.elements.map((el, index) => {
      // EnhancedUIElement extends UIElement - just add required properties
      const enhanced: EnhancedUIElement = {
        ...el,
        id: `el-${index}`,
        center: {
          x: el.bounds.x + el.bounds.width / 2,
          y: el.bounds.y + el.bounds.height / 2,
        },
        detectionSource: 'ocr' as const,
        selectors: [],
        signature: {
          size: this.getSizeCategory(el.bounds),
          normalizedText: el.text?.toLowerCase().trim(),
          relativePosition: {
            horizontal: this.getHorizontalPosition(el.bounds, screenState.resolution.width),
            vertical: this.getVerticalPosition(el.bounds, screenState.resolution.height),
          },
        },
        lastVerified: Date.now(),
        verificationCount: 1,
      };

      return enhanced;
    });
  }

  private getSizeCategory(bounds: { width: number; height: number }): 'tiny' | 'small' | 'medium' | 'large' | 'huge' {
    const area = bounds.width * bounds.height;
    if (area < 500) return 'tiny';
    if (area < 2000) return 'small';
    if (area < 10000) return 'medium';
    if (area < 50000) return 'large';
    return 'huge';
  }

  private getHorizontalPosition(bounds: { x: number; width: number }, screenWidth: number): 'left' | 'center' | 'right' {
    const center = bounds.x + bounds.width / 2;
    if (center < screenWidth * 0.33) return 'left';
    if (center > screenWidth * 0.66) return 'right';
    return 'center';
  }

  private getVerticalPosition(bounds: { y: number; height: number }, screenHeight: number): 'top' | 'middle' | 'bottom' {
    const center = bounds.y + bounds.height / 2;
    if (center < screenHeight * 0.33) return 'top';
    if (center > screenHeight * 0.66) return 'bottom';
    return 'middle';
  }

  private inferSemanticRole(element: UIElement): string {
    const text = (element.text || '').toLowerCase();
    const type = element.type;

    if (type === 'button' || text.includes('submit') || text.includes('click')) {
      return 'button';
    }
    if (type === 'textbox' || text.includes('enter') || text.includes('type')) {
      return 'input';
    }
    if (type === 'link' || text.includes('http') || text.includes('click here')) {
      return 'link';
    }
    if (text.includes('menu') || text.includes('navigation')) {
      return 'navigation';
    }
    if (text.includes('search')) {
      return 'search';
    }
    if (type === 'text' && !element.isInteractive) {
      return 'content';
    }

    return element.type;
  }

  private inferPurpose(element: UIElement): string {
    const text = (element.text || '').toLowerCase();

    // Common button purposes
    if (text.includes('submit')) return 'Submit form';
    if (text.includes('cancel')) return 'Cancel action';
    if (text.includes('ok') || text.includes('okay')) return 'Confirm';
    if (text.includes('close')) return 'Close dialog';
    if (text.includes('save')) return 'Save changes';
    if (text.includes('delete') || text.includes('remove')) return 'Delete item';
    if (text.includes('add') || text.includes('new') || text.includes('create')) return 'Create new';
    if (text.includes('edit')) return 'Edit item';
    if (text.includes('search')) return 'Search';
    if (text.includes('login') || text.includes('sign in')) return 'Login';
    if (text.includes('logout') || text.includes('sign out')) return 'Logout';
    if (text.includes('next')) return 'Go to next';
    if (text.includes('back') || text.includes('previous')) return 'Go back';

    return element.text || element.type;
  }

  private inferInteractions(element: UIElement): string[] {
    const interactions: string[] = [];

    if (element.isInteractive) {
      if (element.type === 'button') {
        interactions.push('click');
      } else if (element.type === 'textbox') {
        interactions.push('click', 'type');
      } else if (element.type === 'link') {
        interactions.push('click');
      } else {
        interactions.push('click');
      }
    }

    return interactions;
  }

  private detectApplicationContext(
    screenState: ScreenState,
    _elements: EnhancedUIElement[],
  ): ApplicationContext {
    const windowTitle = screenState.activeWindow?.title || '';
    const title = windowTitle.toLowerCase();
    // Get text from textRegions if available
    const text = screenState.textRegions?.map(r => r.text).join(' ').toLowerCase() || '';

    // Detect application type
    let appType: ApplicationContext['type'] = 'unknown';
    let application = 'Unknown';
    let screen = 'Main';

    // Browser detection
    if (title.includes('chrome') || title.includes('firefox') || title.includes('edge') ||
        title.includes('brave') || title.includes('safari')) {
      appType = 'browser';
      application = 'Browser';
      // Try to extract page title
      const parts = windowTitle.split(' - ');
      if (parts.length > 1) {
        screen = parts[0].trim();
      }
    }
    // Code editor detection
    else if (title.includes('code') || title.includes('visual studio') ||
             title.includes('sublime') || title.includes('atom') ||
             title.includes('notepad') || title.includes('vim') || title.includes('emacs')) {
      appType = 'editor';
      application = 'Code Editor';
      // Extract file name
      const fileMatch = windowTitle.match(/([^\\/]+\.[a-z]+)/i);
      if (fileMatch) {
        screen = fileMatch[1];
      }
    }
    // Terminal detection
    else if (title.includes('terminal') || title.includes('cmd') ||
             title.includes('powershell') || title.includes('bash') ||
             title.includes('command prompt')) {
      appType = 'terminal';
      application = 'Terminal';
    }
    // File explorer detection
    else if (title.includes('explorer') || title.includes('finder') ||
             title.includes('files') || text.includes('documents') ||
             text.includes('downloads')) {
      appType = 'explorer';
      application = 'File Explorer';
      screen = windowTitle;
    }
    // Office detection
    else if (title.includes('word') || title.includes('excel') ||
             title.includes('powerpoint') || title.includes('outlook') ||
             title.includes('docs') || title.includes('sheets')) {
      appType = 'office';
      application = 'Office';
      screen = windowTitle;
    }
    // Media detection
    else if (title.includes('spotify') || title.includes('youtube') ||
             title.includes('vlc') || title.includes('netflix') ||
             title.includes('media player')) {
      appType = 'media';
      application = 'Media';
    }
    // Game detection
    else if (title.includes('game') || title.includes('steam') ||
             text.includes('play') && text.includes('score')) {
      appType = 'game';
      application = 'Game';
    }
    // System detection
    else if (title.includes('settings') || title.includes('control panel') ||
             title.includes('preferences') || title.includes('system')) {
      appType = 'system';
      application = 'System Settings';
    }
    else {
      // Use title as application
      application = windowTitle.split(' - ')[0].trim() || 'Unknown';
    }

    return {
      application,
      type: appType,
      screen,
    };
  }

  private buildInteractionMap(elements: EnhancedUIElement[]): InteractionMap {
    const map: InteractionMap = {
      primary: [],
      secondary: [],
      inputs: [],
      buttons: [],
      links: [],
      navigation: [],
      content: [],
    };

    for (const el of elements) {
      // Use element type for categorization (semanticRole doesn't exist on EnhancedUIElement)
      if (el.type === 'textbox' || el.type === 'checkbox' || el.type === 'dropdown') {
        map.inputs.push(el);
      } else if (el.type === 'button') {
        map.buttons.push(el);
      } else if (el.type === 'link') {
        map.links.push(el);
      } else if (el.type === 'menu') {
        map.navigation.push(el);
      } else if (!el.isInteractive) {
        map.content.push(el);
      }

      if (el.isInteractive) {
        // Determine if primary or secondary based on size and position
        const area = el.bounds.width * el.bounds.height;
        if (area > 2000 || el.confidence > 0.8) {
          map.primary.push(el);
        } else {
          map.secondary.push(el);
        }
      }
    }

    return map;
  }

  private analyzeLayout(screenState: ScreenState, elements: EnhancedUIElement[]): ScreenLayout {
    const { width, height } = screenState.resolution;
    const layout: ScreenLayout = {
      sidebars: [],
      type: 'unknown',
    };

    // Define regions
    const headerThreshold = height * 0.15;
    const footerThreshold = height * 0.85;
    const sidebarThreshold = width * 0.25;

    const headerElements: EnhancedUIElement[] = [];
    const footerElements: EnhancedUIElement[] = [];
    const leftSidebarElements: EnhancedUIElement[] = [];
    const rightSidebarElements: EnhancedUIElement[] = [];
    const mainElements: EnhancedUIElement[] = [];
    const modalElements: EnhancedUIElement[] = [];

    // Check for modal (centered element covering most of screen)
    const possibleModal = elements.find(
      (el) =>
        el.bounds.x > width * 0.1 &&
        el.bounds.x + el.bounds.width < width * 0.9 &&
        el.bounds.y > height * 0.1 &&
        el.bounds.y + el.bounds.height < height * 0.9 &&
        el.bounds.width > width * 0.3 &&
        el.bounds.height > height * 0.3,
    );

    if (possibleModal) {
      layout.type = 'modal';
      layout.modal = {
        bounds: possibleModal.bounds,
        elements: elements.filter(
          (el) =>
            el.bounds.x >= possibleModal.bounds.x &&
            el.bounds.y >= possibleModal.bounds.y &&
            el.bounds.x + el.bounds.width <= possibleModal.bounds.x + possibleModal.bounds.width &&
            el.bounds.y + el.bounds.height <= possibleModal.bounds.y + possibleModal.bounds.height,
        ),
        purpose: 'dialog',
        confidence: 0.8,
      };
      return layout;
    }

    // Categorize elements by region
    for (const el of elements) {
      const centerX = el.bounds.x + el.bounds.width / 2;
      const centerY = el.bounds.y + el.bounds.height / 2;

      if (centerY < headerThreshold) {
        headerElements.push(el);
      } else if (centerY > footerThreshold) {
        footerElements.push(el);
      } else if (centerX < sidebarThreshold) {
        leftSidebarElements.push(el);
      } else if (centerX > width - sidebarThreshold) {
        rightSidebarElements.push(el);
      } else {
        mainElements.push(el);
      }
    }

    // Build regions
    if (headerElements.length > 0) {
      layout.header = {
        bounds: { x: 0, y: 0, width, height: headerThreshold },
        elements: headerElements,
        purpose: 'header',
        confidence: 0.8,
      };
    }

    if (footerElements.length > 0) {
      layout.footer = {
        bounds: { x: 0, y: footerThreshold, width, height: height - footerThreshold },
        elements: footerElements,
        purpose: 'footer',
        confidence: 0.8,
      };
    }

    if (leftSidebarElements.length >= ENHANCED_SCREEN_CONSTANTS.MIN_ELEMENTS_FOR_MAP) {
      layout.sidebars.push({
        bounds: { x: 0, y: headerThreshold, width: sidebarThreshold, height: footerThreshold - headerThreshold },
        elements: leftSidebarElements,
        purpose: 'navigation',
        confidence: 0.7,
      });
    }

    if (rightSidebarElements.length >= ENHANCED_SCREEN_CONSTANTS.MIN_ELEMENTS_FOR_MAP) {
      layout.sidebars.push({
        bounds: {
          x: width - sidebarThreshold,
          y: headerThreshold,
          width: sidebarThreshold,
          height: footerThreshold - headerThreshold,
        },
        elements: rightSidebarElements,
        purpose: 'sidebar',
        confidence: 0.7,
      });
    }

    if (mainElements.length > 0) {
      const mainX = leftSidebarElements.length >= ENHANCED_SCREEN_CONSTANTS.MIN_ELEMENTS_FOR_MAP ? sidebarThreshold : 0;
      const mainWidth =
        width -
        mainX -
        (rightSidebarElements.length >= ENHANCED_SCREEN_CONSTANTS.MIN_ELEMENTS_FOR_MAP ? sidebarThreshold : 0);

      layout.main = {
        bounds: { x: mainX, y: headerThreshold, width: mainWidth, height: footerThreshold - headerThreshold },
        elements: mainElements,
        purpose: 'content',
        confidence: 0.8,
      };
    }

    // Determine layout type
    if (layout.sidebars.length === 0) {
      layout.type = 'single-column';
    } else if (layout.sidebars.length === 1) {
      layout.type = 'two-column';
    } else {
      layout.type = 'three-column';
    }

    return layout;
  }

  private mergeVLMInsights(elements: EnhancedUIElement[], vlmAnalysis: ScreenAnalysis): void {
    // Merge VLM-detected elements with our elements
    // ScreenAnalysis.elements contains VLMElement type
    if (vlmAnalysis.elements) {
      for (const vlmEl of vlmAnalysis.elements) {
        // VLMElement has: type, description, bounds, interactionHint, confidence
        // Find matching element by position
        const matching = elements.find(
          (el) =>
            Math.abs(el.bounds.x - vlmEl.bounds.x) < 20 &&
            Math.abs(el.bounds.y - vlmEl.bounds.y) < 20,
        );

        if (matching && vlmEl.confidence) {
          // Enhance confidence with VLM info
          matching.confidence = Math.max(matching.confidence, vlmEl.confidence);
        }
      }
    }
  }

  private getRegion(layout: ScreenLayout, regionName: string): ScreenRegion | undefined {
    switch (regionName) {
      case 'header':
        return layout.header;
      case 'footer':
        return layout.footer;
      case 'main':
        return layout.main;
      case 'modal':
        return layout.modal;
      case 'sidebar':
        return layout.sidebars[0];
      default:
        return undefined;
    }
  }

  private isInRegion(element: EnhancedUIElement, region: ScreenRegion): boolean {
    return (
      element.bounds.x >= region.bounds.x &&
      element.bounds.y >= region.bounds.y &&
      element.bounds.x + element.bounds.width <= region.bounds.x + region.bounds.width &&
      element.bounds.y + element.bounds.height <= region.bounds.y + region.bounds.height
    );
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let enhancedScreenInstance: EnhancedScreenManager | null = null;

/**
 * Get the singleton enhanced screen manager
 */
export function getEnhancedScreen(): EnhancedScreenManager {
  if (!enhancedScreenInstance) {
    enhancedScreenInstance = new EnhancedScreenManager();
  }
  return enhancedScreenInstance;
}

/**
 * Get current screen understanding.
 * This is a convenience function that creates a minimal screen state
 * and returns the understanding. For VM operations, use getEnhancedScreen().understand()
 * with a proper ScreenState from the VM connector.
 * 
 * @returns Promise resolving to current screen understanding
 */
export async function getScreenUnderstanding(): Promise<ScreenUnderstanding> {
  const manager = getEnhancedScreen();
  
  // Create a minimal screen state for desktop analysis
  // In actual VM usage, this would come from the VM connector
  const minimalState: ScreenState = {
    timestamp: Date.now(),
    screenshot: '',  // Empty base64 string
    resolution: { width: 1920, height: 1080 },
    elements: [],
    textRegions: [],
    activeWindow: {
      title: 'Desktop',
      application: 'Desktop',
    },
    cursorPosition: { x: 0, y: 0 },
    stateHash: 'desktop-minimal',
  };
  
  return manager.understand(minimalState);
}

/**
 * Reset enhanced screen manager (for testing)
 */
export function resetEnhancedScreen(): void {
  if (enhancedScreenInstance) {
    enhancedScreenInstance.clearCache();
    enhancedScreenInstance = null;
  }
}

// Aliases for backwards compatibility
export { EnhancedScreenManager as EnhancedScreenUnderstanding };
export { getEnhancedScreen as getEnhancedScreenUnderstanding };
