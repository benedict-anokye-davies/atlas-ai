/**
 * Atlas Desktop - VM Agent Self-Healing Selectors
 *
 * Resilient element selectors that automatically repair themselves
 * when UI elements change positions or attributes.
 *
 * Ported and enhanced from browser-agent/self-healing-selectors.ts
 *
 * @module vm-agent/vision/self-healing-selectors
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { createModuleLogger } from '../../utils/logger';
import { getEventBus, createEvent } from '../core/event-bus';
import { ScreenState, UIElement } from '../types';
import {
  EnhancedUIElement,
  ElementSelector,
  ElementSignature,
  SelectorStrategy,
  SelectorMatchResult,
  ElementHealing,
} from '../core/types';

const logger = createModuleLogger('SelfHealingSelectors');

// =============================================================================
// Self-Healing Constants
// =============================================================================

export const SELF_HEALING_CONSTANTS = {
  /** Minimum confidence for a match */
  MIN_MATCH_CONFIDENCE: 0.6,
  /** High confidence threshold */
  HIGH_CONFIDENCE_THRESHOLD: 0.85,
  /** Position tolerance (pixels) */
  POSITION_TOLERANCE: 50,
  /** Relative position tolerance (percentage) */
  RELATIVE_POSITION_TOLERANCE: 0.1,
  /** Text similarity threshold */
  TEXT_SIMILARITY_THRESHOLD: 0.7,
  /** Maximum selectors to store per element */
  MAX_SELECTORS_PER_ELEMENT: 5,
  /** Maximum healing history entries */
  MAX_HEALING_HISTORY: 1000,
  /** Storage file name */
  STORAGE_FILE: 'vm-self-healing-selectors.json',
} as const;

// =============================================================================
// Selector Types
// =============================================================================

export interface SelectorCandidate {
  selector: ElementSelector;
  confidence: number;
  strategy: SelectorStrategy;
  element?: EnhancedUIElement;
}

export interface HealingAttempt {
  originalSelector: ElementSelector;
  healedSelector: ElementSelector;
  timestamp: number;
  success: boolean;
  strategyUsed: SelectorStrategy;
  confidenceDelta: number;
}

export interface ElementProfile {
  /** Unique identifier for this element profile */
  id: string;
  /** Application context */
  application: string;
  /** Screen/page context */
  screenContext: string;
  /** Primary selector */
  primarySelector: ElementSelector;
  /** Alternative selectors */
  alternativeSelectors: ElementSelector[];
  /** Element signature for matching */
  signature: ElementSignature;
  /** Historical positions */
  positionHistory: Array<{ x: number; y: number; timestamp: number }>;
  /** Healing history */
  healingHistory: HealingAttempt[];
  /** Success rate */
  successRate: number;
  /** Last seen timestamp */
  lastSeen: number;
  /** Times this profile was used */
  usageCount: number;
}

// =============================================================================
// Self-Healing Selectors Manager
// =============================================================================

/**
 * Manages self-healing element selectors
 *
 * Features:
 * - Multiple selector strategies (position, text, visual, semantic)
 * - Automatic healing when selectors break
 * - Learning from successful matches
 * - Cross-session persistence
 *
 * @example
 * ```typescript
 * const selectors = getSelfHealingSelectors();
 *
 * // Create a selector for an element
 * const selector = await selectors.createSelector(element, screenState);
 *
 * // Find element later (auto-heals if needed)
 * const match = await selectors.findElement(selector, newScreenState);
 *
 * if (match.found) {
 *   console.log('Found element:', match.element);
 * }
 * ```
 */
export class SelfHealingSelectorsManager extends EventEmitter {
  private profiles: Map<string, ElementProfile> = new Map();
  private healingHistory: HealingAttempt[] = [];
  private dataDir: string;
  private initialized: boolean = false;

  /** Strategy priority order */
  private strategyPriority: SelectorStrategy[] = [
    'id',
    'aria',
    'text',
    'semantic',
    'position',
    'visual',
    'combined',
  ];

  constructor() {
    super();
    this.dataDir = path.join(app.getPath('userData'), 'vm-agent');
  }

  /**
   * Initialize the selector manager
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      if (!fs.existsSync(this.dataDir)) {
        fs.mkdirSync(this.dataDir, { recursive: true });
      }

      await this.loadFromDisk();
      this.initialized = true;
      logger.info('Self-healing selectors initialized', { profiles: this.profiles.size });
    } catch (error) {
      logger.error('Failed to initialize self-healing selectors', { error });
      this.initialized = true;
    }
  }

  /**
   * Create a selector for an element
   */
  async createSelector(
    element: UIElement | EnhancedUIElement,
    screenState: ScreenState,
    options?: {
      application?: string;
      screenContext?: string;
    },
  ): Promise<ElementSelector> {
    await this.ensureInitialized();

    const application = options?.application || 'unknown';
    const screenContext = options?.screenContext || screenState.title || 'unknown';

    // Generate signature
    const signature = this.generateSignature(element, screenState);

    // Create selector using best strategy
    const selector: ElementSelector = {
      id: `selector-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      strategies: [],
      signature,
      confidence: 0.9,
      lastUpdated: Date.now(),
      healingAttempts: 0,
    };

    // Add strategies in priority order
    for (const strategy of this.strategyPriority) {
      const strategySelector = this.createStrategySelector(strategy, element, screenState);
      if (strategySelector) {
        selector.strategies.push(strategySelector);
      }
    }

    // Create or update profile
    const profileId = this.generateProfileId(element, application, screenContext);
    const existingProfile = this.profiles.get(profileId);

    if (existingProfile) {
      // Update existing profile
      existingProfile.primarySelector = selector;
      existingProfile.signature = signature;
      existingProfile.lastSeen = Date.now();
      existingProfile.usageCount++;
      existingProfile.positionHistory.push({
        x: element.bounds.x,
        y: element.bounds.y,
        timestamp: Date.now(),
      });
      this.profiles.set(profileId, existingProfile);
    } else {
      // Create new profile
      const profile: ElementProfile = {
        id: profileId,
        application,
        screenContext,
        primarySelector: selector,
        alternativeSelectors: [],
        signature,
        positionHistory: [{ x: element.bounds.x, y: element.bounds.y, timestamp: Date.now() }],
        healingHistory: [],
        successRate: 1,
        lastSeen: Date.now(),
        usageCount: 1,
      };
      this.profiles.set(profileId, profile);
    }

    this.scheduleSave();

    logger.debug('Created selector', { selectorId: selector.id, strategies: selector.strategies.length });

    return selector;
  }

  /**
   * Find an element using a selector (with auto-healing)
   */
  async findElement(
    selector: ElementSelector,
    screenState: ScreenState,
    options?: {
      allowHealing?: boolean;
      maxHealingAttempts?: number;
    },
  ): Promise<SelectorMatchResult> {
    await this.ensureInitialized();

    const allowHealing = options?.allowHealing ?? true;
    const maxHealingAttempts = options?.maxHealingAttempts ?? 3;

    // Try each strategy in order
    for (const strategy of selector.strategies) {
      const candidates = this.findByStrategy(strategy.strategy, strategy, screenState);

      if (candidates.length > 0) {
        const best = candidates[0];
        if (best.confidence >= SELF_HEALING_CONSTANTS.MIN_MATCH_CONFIDENCE) {
          return {
            found: true,
            element: best.element!,
            confidence: best.confidence,
            strategy: strategy.strategy,
            healed: false,
          };
        }
      }
    }

    // No direct match - try healing
    if (allowHealing && selector.healingAttempts < maxHealingAttempts) {
      const healingResult = await this.attemptHealing(selector, screenState);
      if (healingResult.success) {
        return {
          found: true,
          element: healingResult.element!,
          confidence: healingResult.confidence,
          strategy: healingResult.strategy,
          healed: true,
          healedSelector: healingResult.healedSelector,
        };
      }
    }

    return {
      found: false,
      confidence: 0,
      strategy: 'combined',
      healed: false,
      error: 'Element not found after all strategies and healing attempts',
    };
  }

  /**
   * Attempt to heal a broken selector
   */
  async attemptHealing(
    selector: ElementSelector,
    screenState: ScreenState,
  ): Promise<ElementHealing> {
    logger.info('Attempting to heal selector', { selectorId: selector.id });

    const eventBus = getEventBus();
    eventBus.emitSync(
      createEvent('selector:healing-started', { selectorId: selector.id }, 'self-healing', {
        priority: 'normal',
      }),
    );

    selector.healingAttempts++;

    // Try signature-based matching
    const signatureMatch = this.findBySignature(selector.signature, screenState);
    if (signatureMatch) {
      const healedSelector = await this.createSelector(signatureMatch, screenState);

      this.recordHealingAttempt({
        originalSelector: selector,
        healedSelector,
        timestamp: Date.now(),
        success: true,
        strategyUsed: 'semantic',
        confidenceDelta: healedSelector.confidence - selector.confidence,
      });

      eventBus.emitSync(
        createEvent(
          'selector:healing-completed',
          { selectorId: selector.id, success: true },
          'self-healing',
          { priority: 'normal' },
        ),
      );

      return {
        success: true,
        element: this.toEnhancedElement(signatureMatch, screenState),
        confidence: 0.8,
        strategy: 'semantic',
        healedSelector,
        attempts: selector.healingAttempts,
      };
    }

    // Try position-based recovery
    const positionMatch = this.findNearPosition(selector.signature, screenState);
    if (positionMatch) {
      const healedSelector = await this.createSelector(positionMatch, screenState);

      this.recordHealingAttempt({
        originalSelector: selector,
        healedSelector,
        timestamp: Date.now(),
        success: true,
        strategyUsed: 'position',
        confidenceDelta: healedSelector.confidence - selector.confidence,
      });

      eventBus.emitSync(
        createEvent(
          'selector:healing-completed',
          { selectorId: selector.id, success: true },
          'self-healing',
          { priority: 'normal' },
        ),
      );

      return {
        success: true,
        element: this.toEnhancedElement(positionMatch, screenState),
        confidence: 0.65,
        strategy: 'position',
        healedSelector,
        attempts: selector.healingAttempts,
      };
    }

    // Try text-based recovery
    const textMatch = this.findByText(selector.signature, screenState);
    if (textMatch) {
      const healedSelector = await this.createSelector(textMatch, screenState);

      this.recordHealingAttempt({
        originalSelector: selector,
        healedSelector,
        timestamp: Date.now(),
        success: true,
        strategyUsed: 'text',
        confidenceDelta: healedSelector.confidence - selector.confidence,
      });

      eventBus.emitSync(
        createEvent(
          'selector:healing-completed',
          { selectorId: selector.id, success: true },
          'self-healing',
          { priority: 'normal' },
        ),
      );

      return {
        success: true,
        element: this.toEnhancedElement(textMatch, screenState),
        confidence: 0.7,
        strategy: 'text',
        healedSelector,
        attempts: selector.healingAttempts,
      };
    }

    // Healing failed
    this.recordHealingAttempt({
      originalSelector: selector,
      healedSelector: selector,
      timestamp: Date.now(),
      success: false,
      strategyUsed: 'combined',
      confidenceDelta: 0,
    });

    eventBus.emitSync(
      createEvent(
        'selector:healing-completed',
        { selectorId: selector.id, success: false },
        'self-healing',
        { priority: 'normal' },
      ),
    );

    return {
      success: false,
      confidence: 0,
      strategy: 'combined',
      attempts: selector.healingAttempts,
      error: 'All healing strategies failed',
    };
  }

  /**
   * Record a successful match to improve future matching
   */
  recordSuccessfulMatch(
    selector: ElementSelector,
    element: UIElement,
    screenState: ScreenState,
  ): void {
    const profile = this.findProfileBySelector(selector);
    if (profile) {
      profile.successRate = (profile.successRate * profile.usageCount + 1) / (profile.usageCount + 1);
      profile.usageCount++;
      profile.lastSeen = Date.now();
      profile.positionHistory.push({
        x: element.bounds.x,
        y: element.bounds.y,
        timestamp: Date.now(),
      });

      // Trim position history
      if (profile.positionHistory.length > 20) {
        profile.positionHistory = profile.positionHistory.slice(-20);
      }

      this.profiles.set(profile.id, profile);
      this.scheduleSave();
    }
  }

  /**
   * Get healing statistics
   */
  getStats(): {
    totalProfiles: number;
    totalHealingAttempts: number;
    successfulHealings: number;
    healingSuccessRate: number;
    byStrategy: Record<SelectorStrategy, { attempts: number; successes: number }>;
  } {
    const byStrategy: Record<string, { attempts: number; successes: number }> = {};

    for (const attempt of this.healingHistory) {
      if (!byStrategy[attempt.strategyUsed]) {
        byStrategy[attempt.strategyUsed] = { attempts: 0, successes: 0 };
      }
      byStrategy[attempt.strategyUsed].attempts++;
      if (attempt.success) {
        byStrategy[attempt.strategyUsed].successes++;
      }
    }

    const successful = this.healingHistory.filter((h) => h.success).length;

    return {
      totalProfiles: this.profiles.size,
      totalHealingAttempts: this.healingHistory.length,
      successfulHealings: successful,
      healingSuccessRate: this.healingHistory.length > 0 ? successful / this.healingHistory.length : 0,
      byStrategy: byStrategy as Record<SelectorStrategy, { attempts: number; successes: number }>,
    };
  }

  /**
   * Clear all data
   */
  clear(): void {
    this.profiles.clear();
    this.healingHistory = [];
    this.scheduleSave();
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  private generateSignature(element: UIElement, screenState: ScreenState): ElementSignature {
    const relativeX = element.bounds.x / screenState.dimensions.width;
    const relativeY = element.bounds.y / screenState.dimensions.height;
    const relativeWidth = element.bounds.width / screenState.dimensions.width;
    const relativeHeight = element.bounds.height / screenState.dimensions.height;

    // Find nearby elements for context
    const nearbyTypes: string[] = [];
    for (const other of screenState.elements) {
      if (other === element) continue;
      const distance = Math.sqrt(
        Math.pow(other.bounds.x - element.bounds.x, 2) +
          Math.pow(other.bounds.y - element.bounds.y, 2),
      );
      if (distance < 100) {
        nearbyTypes.push(other.type);
      }
    }

    // Generate visual hash (simplified)
    const visualHash = `${element.type}-${Math.round(relativeX * 100)}-${Math.round(relativeY * 100)}`;

    return {
      elementType: element.type,
      textContent: element.text,
      relativePosition: { x: relativeX, y: relativeY },
      relativeSize: { width: relativeWidth, height: relativeHeight },
      nearbyElements: nearbyTypes.slice(0, 5),
      visualHash,
      confidence: 0.9,
    };
  }

  private generateProfileId(
    element: UIElement,
    application: string,
    screenContext: string,
  ): string {
    const textPart = (element.text || '').slice(0, 20).replace(/[^a-zA-Z0-9]/g, '');
    return `${application}-${screenContext}-${element.type}-${textPart}`.toLowerCase();
  }

  private createStrategySelector(
    strategy: SelectorStrategy,
    element: UIElement,
    screenState: ScreenState,
  ): { strategy: SelectorStrategy; value: string; confidence: number } | null {
    switch (strategy) {
      case 'id':
        // For VM elements, we don't have DOM IDs, but we can use element index
        const index = screenState.elements.indexOf(element);
        if (index >= 0) {
          return { strategy: 'id', value: `index:${index}`, confidence: 0.7 };
        }
        return null;

      case 'text':
        if (element.text && element.text.length > 0) {
          return { strategy: 'text', value: element.text, confidence: 0.8 };
        }
        return null;

      case 'aria':
        // Check for aria-like attributes in text
        if (element.text?.includes('button') || element.text?.includes('link')) {
          return { strategy: 'aria', value: `role:${element.type}`, confidence: 0.75 };
        }
        return null;

      case 'position':
        return {
          strategy: 'position',
          value: `${element.bounds.x},${element.bounds.y}`,
          confidence: 0.6,
        };

      case 'semantic':
        const semantic = `${element.type}:${element.isInteractive ? 'interactive' : 'static'}`;
        return { strategy: 'semantic', value: semantic, confidence: 0.7 };

      case 'visual':
        const visual = `size:${element.bounds.width}x${element.bounds.height}`;
        return { strategy: 'visual', value: visual, confidence: 0.5 };

      case 'combined':
        return {
          strategy: 'combined',
          value: `${element.type}:${element.text?.slice(0, 10) || 'no-text'}`,
          confidence: 0.65,
        };

      default:
        return null;
    }
  }

  private findByStrategy(
    strategy: SelectorStrategy,
    selector: { strategy: SelectorStrategy; value: string; confidence: number },
    screenState: ScreenState,
  ): SelectorCandidate[] {
    const candidates: SelectorCandidate[] = [];

    switch (strategy) {
      case 'id':
        if (selector.value.startsWith('index:')) {
          const index = parseInt(selector.value.slice(6), 10);
          if (index >= 0 && index < screenState.elements.length) {
            candidates.push({
              selector: { id: '', strategies: [], confidence: 0.7, lastUpdated: Date.now(), healingAttempts: 0 },
              confidence: 0.7,
              strategy,
              element: this.toEnhancedElement(screenState.elements[index], screenState),
            });
          }
        }
        break;

      case 'text':
        for (const el of screenState.elements) {
          if (el.text === selector.value) {
            candidates.push({
              selector: { id: '', strategies: [], confidence: 0.9, lastUpdated: Date.now(), healingAttempts: 0 },
              confidence: 0.9,
              strategy,
              element: this.toEnhancedElement(el, screenState),
            });
          } else if (el.text && this.textSimilarity(el.text, selector.value) >= SELF_HEALING_CONSTANTS.TEXT_SIMILARITY_THRESHOLD) {
            candidates.push({
              selector: { id: '', strategies: [], confidence: 0.7, lastUpdated: Date.now(), healingAttempts: 0 },
              confidence: 0.7,
              strategy,
              element: this.toEnhancedElement(el, screenState),
            });
          }
        }
        break;

      case 'position':
        const [x, y] = selector.value.split(',').map(Number);
        for (const el of screenState.elements) {
          const distance = Math.sqrt(
            Math.pow(el.bounds.x - x, 2) + Math.pow(el.bounds.y - y, 2),
          );
          if (distance <= SELF_HEALING_CONSTANTS.POSITION_TOLERANCE) {
            const confidence = 1 - distance / SELF_HEALING_CONSTANTS.POSITION_TOLERANCE;
            candidates.push({
              selector: { id: '', strategies: [], confidence, lastUpdated: Date.now(), healingAttempts: 0 },
              confidence,
              strategy,
              element: this.toEnhancedElement(el, screenState),
            });
          }
        }
        break;

      case 'semantic':
        const [type, interactivity] = selector.value.split(':');
        for (const el of screenState.elements) {
          if (el.type === type) {
            const isInteractive = interactivity === 'interactive';
            if (el.isInteractive === isInteractive) {
              candidates.push({
                selector: { id: '', strategies: [], confidence: 0.7, lastUpdated: Date.now(), healingAttempts: 0 },
                confidence: 0.7,
                strategy,
                element: this.toEnhancedElement(el, screenState),
              });
            }
          }
        }
        break;
    }

    // Sort by confidence
    candidates.sort((a, b) => b.confidence - a.confidence);
    return candidates;
  }

  private findBySignature(signature: ElementSignature, screenState: ScreenState): UIElement | null {
    let bestMatch: UIElement | null = null;
    let bestScore = 0;

    for (const el of screenState.elements) {
      let score = 0;

      // Type match
      if (el.type === signature.elementType) {
        score += 0.3;
      }

      // Text match
      if (el.text === signature.textContent) {
        score += 0.3;
      } else if (el.text && signature.textContent) {
        score += 0.2 * this.textSimilarity(el.text, signature.textContent);
      }

      // Position match
      const relX = el.bounds.x / screenState.dimensions.width;
      const relY = el.bounds.y / screenState.dimensions.height;
      const posDistance = Math.sqrt(
        Math.pow(relX - signature.relativePosition.x, 2) +
          Math.pow(relY - signature.relativePosition.y, 2),
      );
      if (posDistance < SELF_HEALING_CONSTANTS.RELATIVE_POSITION_TOLERANCE) {
        score += 0.2 * (1 - posDistance / SELF_HEALING_CONSTANTS.RELATIVE_POSITION_TOLERANCE);
      }

      // Size match
      const relW = el.bounds.width / screenState.dimensions.width;
      const relH = el.bounds.height / screenState.dimensions.height;
      const sizeDistance = Math.sqrt(
        Math.pow(relW - signature.relativeSize.width, 2) +
          Math.pow(relH - signature.relativeSize.height, 2),
      );
      if (sizeDistance < 0.1) {
        score += 0.2 * (1 - sizeDistance / 0.1);
      }

      if (score > bestScore && score >= SELF_HEALING_CONSTANTS.MIN_MATCH_CONFIDENCE) {
        bestScore = score;
        bestMatch = el;
      }
    }

    return bestMatch;
  }

  private findNearPosition(signature: ElementSignature, screenState: ScreenState): UIElement | null {
    const targetX = signature.relativePosition.x * screenState.dimensions.width;
    const targetY = signature.relativePosition.y * screenState.dimensions.height;

    let closest: UIElement | null = null;
    let minDistance = Infinity;

    for (const el of screenState.elements) {
      if (el.type !== signature.elementType) continue;

      const distance = Math.sqrt(
        Math.pow(el.bounds.x - targetX, 2) + Math.pow(el.bounds.y - targetY, 2),
      );

      if (distance < minDistance && distance < SELF_HEALING_CONSTANTS.POSITION_TOLERANCE * 2) {
        minDistance = distance;
        closest = el;
      }
    }

    return closest;
  }

  private findByText(signature: ElementSignature, screenState: ScreenState): UIElement | null {
    if (!signature.textContent) return null;

    for (const el of screenState.elements) {
      if (el.text === signature.textContent) {
        return el;
      }
    }

    // Fuzzy match
    let bestMatch: UIElement | null = null;
    let bestSimilarity = 0;

    for (const el of screenState.elements) {
      if (!el.text) continue;

      const similarity = this.textSimilarity(el.text, signature.textContent);
      if (similarity > bestSimilarity && similarity >= SELF_HEALING_CONSTANTS.TEXT_SIMILARITY_THRESHOLD) {
        bestSimilarity = similarity;
        bestMatch = el;
      }
    }

    return bestMatch;
  }

  private textSimilarity(a: string, b: string): number {
    if (a === b) return 1;
    if (!a || !b) return 0;

    const aLower = a.toLowerCase();
    const bLower = b.toLowerCase();

    if (aLower === bLower) return 0.95;
    if (aLower.includes(bLower) || bLower.includes(aLower)) return 0.8;

    // Levenshtein-based similarity
    const maxLen = Math.max(a.length, b.length);
    if (maxLen === 0) return 1;

    const distance = this.levenshteinDistance(aLower, bLower);
    return 1 - distance / maxLen;
  }

  private levenshteinDistance(a: string, b: string): number {
    const matrix: number[][] = [];

    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1,
          );
        }
      }
    }

    return matrix[b.length][a.length];
  }

  private toEnhancedElement(element: UIElement, _screenState: ScreenState): EnhancedUIElement {
    return {
      ...element,
      id: `el-${Date.now()}`,
      semanticRole: element.type,
      purpose: element.text,
      relatedElements: [],
      interactions: element.isInteractive ? ['click'] : [],
      lastSeen: Date.now(),
      seenCount: 1,
    };
  }

  private findProfileBySelector(selector: ElementSelector): ElementProfile | undefined {
    for (const profile of this.profiles.values()) {
      if (profile.primarySelector.id === selector.id) {
        return profile;
      }
    }
    return undefined;
  }

  private recordHealingAttempt(attempt: HealingAttempt): void {
    this.healingHistory.push(attempt);

    // Trim history
    if (this.healingHistory.length > SELF_HEALING_CONSTANTS.MAX_HEALING_HISTORY) {
      this.healingHistory = this.healingHistory.slice(-SELF_HEALING_CONSTANTS.MAX_HEALING_HISTORY);
    }

    this.scheduleSave();
  }

  private saveTimeout: NodeJS.Timeout | null = null;
  private scheduleSave(): void {
    if (this.saveTimeout) return;
    this.saveTimeout = setTimeout(() => {
      this.saveToDisk().catch((e) => logger.error('Failed to save selectors', { error: e }));
      this.saveTimeout = null;
    }, 5000);
  }

  private async saveToDisk(): Promise<void> {
    const filePath = path.join(this.dataDir, SELF_HEALING_CONSTANTS.STORAGE_FILE);

    const data = {
      profiles: Array.from(this.profiles.entries()),
      healingHistory: this.healingHistory,
    };

    await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2));
    logger.debug('Self-healing selectors saved', { profiles: this.profiles.size });
  }

  private async loadFromDisk(): Promise<void> {
    const filePath = path.join(this.dataDir, SELF_HEALING_CONSTANTS.STORAGE_FILE);

    if (!fs.existsSync(filePath)) return;

    const content = await fs.promises.readFile(filePath, 'utf-8');
    const data = JSON.parse(content) as {
      profiles: Array<[string, ElementProfile]>;
      healingHistory: HealingAttempt[];
    };

    this.profiles = new Map(data.profiles);
    this.healingHistory = data.healingHistory || [];
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let selfHealingInstance: SelfHealingSelectorsManager | null = null;

/**
 * Get the singleton self-healing selectors instance
 */
export function getSelfHealingSelectors(): SelfHealingSelectorsManager {
  if (!selfHealingInstance) {
    selfHealingInstance = new SelfHealingSelectorsManager();
  }
  return selfHealingInstance;
}

/**
 * Reset self-healing selectors (for testing)
 */
export function resetSelfHealingSelectors(): void {
  if (selfHealingInstance) {
    selfHealingInstance.clear();
    selfHealingInstance = null;
  }
}
