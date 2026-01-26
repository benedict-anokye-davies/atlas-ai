/**
 * Self-Healing Selectors
 *
 * Intelligent selector system that adapts when elements change.
 * Unlike brittle CSS selectors, these selectors learn and repair themselves.
 *
 * Key features:
 * - Multiple selector strategies (CSS, XPath, text, ARIA, visual)
 * - Automatic repair when selectors break
 * - ML-based element matching
 * - Cross-session selector persistence
 *
 * @module agent/browser-agent/self-healing-selectors
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../../utils/logger';
import { getLLMManager } from '../../llm/manager';
import { IndexedElement, ElementBounds } from './types';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

const logger = createModuleLogger('SelfHealingSelectors');

// ============================================================================
// Selector Types
// ============================================================================

export interface ResilientSelector {
  /** Unique identifier */
  id: string;
  /** Domain this selector belongs to */
  domain: string;
  /** Human description of the target element */
  description: string;
  /** Primary selector strategies ordered by preference */
  strategies: SelectorStrategy[];
  /** Element signature for fuzzy matching */
  signature: ElementSignature;
  /** Success/failure history */
  history: SelectorHistory[];
  /** Last successful match */
  lastMatch?: {
    timestamp: number;
    strategy: string;
    element: Partial<IndexedElement>;
  };
  /** Created timestamp */
  createdAt: number;
  /** Last updated */
  updatedAt: number;
}

export interface SelectorStrategy {
  /** Strategy type */
  type: 'css' | 'xpath' | 'text' | 'aria' | 'visual' | 'semantic';
  /** The actual selector/query */
  value: string;
  /** Priority (higher = tried first) */
  priority: number;
  /** Success rate (0-1) */
  successRate: number;
  /** Times used */
  uses: number;
  /** Is this the original/primary strategy */
  isPrimary: boolean;
}

export interface ElementSignature {
  /** Tag name */
  tag: string;
  /** Text content (normalized) */
  text: string;
  /** ARIA label */
  ariaLabel?: string;
  /** Role */
  role?: string;
  /** Relative position on page */
  relativePosition: 'top' | 'middle' | 'bottom';
  /** Key attributes */
  attributes: Record<string, string>;
  /** Parent context */
  parentContext?: {
    tag: string;
    id?: string;
    className?: string;
  };
  /** Sibling context */
  siblingContext?: string[];
  /** Visual characteristics */
  visual?: {
    approximateSize: 'small' | 'medium' | 'large';
    approximatePosition: { x: number; y: number };
    isAboveTheFold: boolean;
  };
}

export interface SelectorHistory {
  timestamp: number;
  strategy: string;
  success: boolean;
  url: string;
  /** Alternative selector found if original failed */
  repairedWith?: string;
}

export interface SelectorMatch {
  element: IndexedElement;
  confidence: number;
  usedStrategy: SelectorStrategy;
  wasRepaired: boolean;
}

// ============================================================================
// Self-Healing Selector Manager
// ============================================================================

export class SelfHealingSelectors extends EventEmitter {
  private selectors: Map<string, ResilientSelector> = new Map();
  private storageDir: string;
  private page: any;

  constructor(page: any) {
    super();
    this.page = page;
    this.storageDir = path.join(app.getPath('userData'), 'browser-agent', 'selectors');
    this.ensureStorageDir();
    this.loadSelectors();
  }

  /**
   * Create a resilient selector for an element
   */
  createSelector(
    element: IndexedElement,
    description: string
  ): ResilientSelector {
    const domain = new URL(this.page.url()).hostname;
    const id = `${domain}:${description.toLowerCase().replace(/\s+/g, '-')}`;

    const strategies: SelectorStrategy[] = [];

    // CSS selector strategy
    if (element.selector) {
      strategies.push({
        type: 'css',
        value: element.selector,
        priority: 10,
        successRate: 1.0,
        uses: 1,
        isPrimary: true,
      });
    }

    // XPath strategy
    if (element.xpath) {
      strategies.push({
        type: 'xpath',
        value: element.xpath,
        priority: 8,
        successRate: 1.0,
        uses: 1,
        isPrimary: false,
      });
    }

    // Text-based strategy
    if (element.text && element.text.length < 100) {
      strategies.push({
        type: 'text',
        value: element.text,
        priority: 7,
        successRate: 0.9,
        uses: 0,
        isPrimary: false,
      });
    }

    // ARIA strategy
    if (element.ariaLabel) {
      strategies.push({
        type: 'aria',
        value: element.ariaLabel,
        priority: 9,
        successRate: 0.95,
        uses: 0,
        isPrimary: false,
      });
    }

    // Semantic strategy (description-based)
    strategies.push({
      type: 'semantic',
      value: description,
      priority: 5,
      successRate: 0.7,
      uses: 0,
      isPrimary: false,
    });

    const selector: ResilientSelector = {
      id,
      domain,
      description,
      strategies,
      signature: this.createSignature(element),
      history: [],
      lastMatch: {
        timestamp: Date.now(),
        strategy: 'css',
        element: {
          index: element.index,
          tag: element.tag,
          text: element.text,
          bounds: element.bounds,
        },
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.selectors.set(id, selector);
    this.saveSelectors();

    return selector;
  }

  /**
   * Find an element using resilient selector
   */
  async findElement(
    selectorId: string,
    currentElements: IndexedElement[]
  ): Promise<SelectorMatch | null> {
    const selector = this.selectors.get(selectorId);
    if (!selector) {
      logger.warn('Selector not found', { selectorId });
      return null;
    }

    // Sort strategies by priority and success rate
    const sortedStrategies = [...selector.strategies].sort((a, b) => {
      const scoreA = a.priority * a.successRate;
      const scoreB = b.priority * b.successRate;
      return scoreB - scoreA;
    });

    // Try each strategy
    for (const strategy of sortedStrategies) {
      const match = await this.tryStrategy(strategy, currentElements, selector.signature);
      
      if (match) {
        // Update strategy success
        strategy.successRate = (strategy.successRate * strategy.uses + 1) / (strategy.uses + 1);
        strategy.uses++;
        
        // Record success
        this.recordHistory(selector, strategy.value, true);
        
        return {
          element: match,
          confidence: strategy.successRate,
          usedStrategy: strategy,
          wasRepaired: false,
        };
      }
    }

    // All strategies failed - attempt self-healing
    logger.info('All strategies failed, attempting self-healing', { selectorId });
    return await this.attemptRepair(selector, currentElements);
  }

  /**
   * Find element by description (no prior selector)
   */
  async findByDescription(
    description: string,
    currentElements: IndexedElement[]
  ): Promise<SelectorMatch | null> {
    // Check if we have a cached selector for this description
    const domain = new URL(this.page.url()).hostname;
    const selectorId = `${domain}:${description.toLowerCase().replace(/\s+/g, '-')}`;
    
    if (this.selectors.has(selectorId)) {
      return this.findElement(selectorId, currentElements);
    }

    // No cached selector - find using semantic matching
    const match = await this.semanticMatch(description, currentElements);
    
    if (match) {
      // Create selector for future use
      this.createSelector(match, description);
      
      return {
        element: match,
        confidence: 0.8,
        usedStrategy: { 
          type: 'semantic', 
          value: description, 
          priority: 5, 
          successRate: 0.8, 
          uses: 1,
          isPrimary: false,
        },
        wasRepaired: false,
      };
    }

    return null;
  }

  /**
   * Update selector after successful interaction
   */
  updateSelector(selectorId: string, element: IndexedElement): void {
    const selector = this.selectors.get(selectorId);
    if (!selector) return;

    // Update signature
    selector.signature = this.createSignature(element);

    // Update last match
    selector.lastMatch = {
      timestamp: Date.now(),
      strategy: selector.strategies[0]?.type || 'unknown',
      element: {
        index: element.index,
        tag: element.tag,
        text: element.text,
        bounds: element.bounds,
      },
    };

    selector.updatedAt = Date.now();
    this.saveSelectors();
  }

  /**
   * Get selector statistics
   */
  getSelectorStats(): {
    total: number;
    byDomain: Record<string, number>;
    avgSuccessRate: number;
    recentlyUsed: string[];
  } {
    const byDomain: Record<string, number> = {};
    let totalSuccessRate = 0;
    const recentlyUsed: Array<{ id: string; timestamp: number }> = [];

    for (const [id, selector] of this.selectors) {
      byDomain[selector.domain] = (byDomain[selector.domain] || 0) + 1;
      
      const avgRate = selector.strategies.reduce((sum, s) => sum + s.successRate, 0) / selector.strategies.length;
      totalSuccessRate += avgRate;

      if (selector.lastMatch) {
        recentlyUsed.push({ id, timestamp: selector.lastMatch.timestamp });
      }
    }

    return {
      total: this.selectors.size,
      byDomain,
      avgSuccessRate: this.selectors.size > 0 ? totalSuccessRate / this.selectors.size : 0,
      recentlyUsed: recentlyUsed
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 10)
        .map(r => r.id),
    };
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private async tryStrategy(
    strategy: SelectorStrategy,
    elements: IndexedElement[],
    signature: ElementSignature
  ): Promise<IndexedElement | null> {
    switch (strategy.type) {
      case 'css':
        return this.matchBySelector(strategy.value, elements);
      
      case 'xpath':
        return this.matchByXPath(strategy.value, elements);
      
      case 'text':
        return this.matchByText(strategy.value, elements);
      
      case 'aria':
        return this.matchByAria(strategy.value, elements);
      
      case 'visual':
        return this.matchByVisual(strategy.value, elements, signature);
      
      case 'semantic':
        return this.semanticMatch(strategy.value, elements);
      
      default:
        return null;
    }
  }

  private matchBySelector(selector: string, elements: IndexedElement[]): IndexedElement | null {
    return elements.find(e => e.selector === selector) || null;
  }

  private matchByXPath(xpath: string, elements: IndexedElement[]): IndexedElement | null {
    return elements.find(e => e.xpath === xpath) || null;
  }

  private matchByText(text: string, elements: IndexedElement[]): IndexedElement | null {
    const normalizedText = text.toLowerCase().trim();
    
    // Exact match
    let match = elements.find(e => 
      e.text?.toLowerCase().trim() === normalizedText
    );
    if (match) return match;

    // Fuzzy match
    match = elements.find(e => 
      e.text?.toLowerCase().includes(normalizedText) ||
      normalizedText.includes(e.text?.toLowerCase() || '')
    );
    
    return match || null;
  }

  private matchByAria(ariaLabel: string, elements: IndexedElement[]): IndexedElement | null {
    const normalizedLabel = ariaLabel.toLowerCase();
    return elements.find(e => 
      e.ariaLabel?.toLowerCase() === normalizedLabel
    ) || null;
  }

  private matchByVisual(
    _descriptor: string,
    elements: IndexedElement[],
    signature: ElementSignature
  ): IndexedElement | null {
    // Match by approximate position and size
    const targetBounds = signature.visual;
    if (!targetBounds) return null;

    const tolerance = 50; // pixels

    return elements.find(e => {
      if (!e.bounds) return false;
      
      const xDiff = Math.abs(e.bounds.x - targetBounds.approximatePosition.x);
      const yDiff = Math.abs(e.bounds.y - targetBounds.approximatePosition.y);
      
      return xDiff < tolerance && yDiff < tolerance;
    }) || null;
  }

  private async semanticMatch(
    description: string,
    elements: IndexedElement[]
  ): Promise<IndexedElement | null> {
    const descLower = description.toLowerCase();

    // Simple keyword matching first
    for (const element of elements) {
      const elementText = [
        element.text,
        element.ariaLabel,
        element.attributes.title,
        element.attributes.placeholder,
      ].filter(Boolean).join(' ').toLowerCase();

      // Check for keyword overlap
      const descWords = descLower.split(/\s+/).filter(w => w.length > 2);
      const matchCount = descWords.filter(w => elementText.includes(w)).length;
      
      if (matchCount >= Math.ceil(descWords.length * 0.5)) {
        return element;
      }
    }

    // Fall back to LLM-based matching for complex descriptions
    if (elements.length <= 50) {
      return this.llmSemanticMatch(description, elements);
    }

    return null;
  }

  private async llmSemanticMatch(
    description: string,
    elements: IndexedElement[]
  ): Promise<IndexedElement | null> {
    try {
      const llm = getLLMManager();

      const elementsStr = elements
        .filter(e => e.interactivity.isClickable || e.interactivity.isTypeable)
        .slice(0, 30)
        .map(e => `[${e.index}] ${e.tag} role="${e.role}" text="${e.text || ''}" aria="${e.ariaLabel || ''}"`)
        .join('\n');

      const prompt = `Find the element that best matches this description: "${description}"

Available elements:
${elementsStr}

Respond with only the index number of the best matching element, or "none" if no match.`;

      const response = await llm.generateWithTools(
        [{ role: 'user', content: prompt }],
        [],
        { model: 'accounts/fireworks/models/qwen3-235b-a22b', temperature: 0, maxTokens: 50 }
      );

      const indexMatch = response.content.match(/\[?(\d+)\]?/);
      if (indexMatch) {
        const index = parseInt(indexMatch[1], 10);
        return elements.find(e => e.index === index) || null;
      }

      return null;
    } catch (error) {
      logger.error('LLM semantic match failed', error);
      return null;
    }
  }

  private async attemptRepair(
    selector: ResilientSelector,
    currentElements: IndexedElement[]
  ): Promise<SelectorMatch | null> {
    logger.info('Attempting to repair selector', { id: selector.id });

    // Strategy 1: Fuzzy signature matching
    const signatureMatch = this.matchBySignature(selector.signature, currentElements);
    if (signatureMatch) {
      // Add new strategy based on the matched element
      const newStrategy: SelectorStrategy = {
        type: 'css',
        value: signatureMatch.selector,
        priority: 9,
        successRate: 0.8,
        uses: 1,
        isPrimary: false,
      };
      selector.strategies.push(newStrategy);
      
      this.recordHistory(selector, signatureMatch.selector, true, signatureMatch.selector);
      this.saveSelectors();

      this.emit('selector-repaired', { 
        selectorId: selector.id, 
        oldSelector: selector.strategies[0]?.value,
        newSelector: signatureMatch.selector,
      });

      return {
        element: signatureMatch,
        confidence: 0.7,
        usedStrategy: newStrategy,
        wasRepaired: true,
      };
    }

    // Strategy 2: Semantic re-matching
    const semanticMatch = await this.semanticMatch(selector.description, currentElements);
    if (semanticMatch) {
      // Update selector with new element info
      const newStrategy: SelectorStrategy = {
        type: 'css',
        value: semanticMatch.selector,
        priority: 8,
        successRate: 0.7,
        uses: 1,
        isPrimary: false,
      };
      selector.strategies.push(newStrategy);
      selector.signature = this.createSignature(semanticMatch);

      this.recordHistory(selector, semanticMatch.selector, true, semanticMatch.selector);
      this.saveSelectors();

      this.emit('selector-repaired', {
        selectorId: selector.id,
        oldSelector: selector.strategies[0]?.value,
        newSelector: semanticMatch.selector,
      });

      return {
        element: semanticMatch,
        confidence: 0.6,
        usedStrategy: newStrategy,
        wasRepaired: true,
      };
    }

    // All repair attempts failed
    this.recordHistory(selector, 'repair-failed', false);
    
    // Decrease success rates for all strategies
    for (const strategy of selector.strategies) {
      strategy.successRate = Math.max(0.1, strategy.successRate * 0.8);
    }
    
    this.saveSelectors();
    return null;
  }

  private matchBySignature(
    signature: ElementSignature,
    elements: IndexedElement[]
  ): IndexedElement | null {
    // Score each element against signature
    const scored = elements.map(element => ({
      element,
      score: this.calculateSignatureScore(element, signature),
    }));

    // Sort by score and get best match
    scored.sort((a, b) => b.score - a.score);

    // Require minimum score threshold
    if (scored[0] && scored[0].score > 0.5) {
      return scored[0].element;
    }

    return null;
  }

  private calculateSignatureScore(element: IndexedElement, signature: ElementSignature): number {
    let score = 0;
    let weights = 0;

    // Tag match (weight: 3)
    if (element.tag === signature.tag) {
      score += 3;
    }
    weights += 3;

    // Role match (weight: 2)
    if (element.role === signature.role) {
      score += 2;
    }
    weights += 2;

    // Text similarity (weight: 4)
    if (signature.text && element.text) {
      const similarity = this.textSimilarity(element.text, signature.text);
      score += similarity * 4;
    }
    weights += 4;

    // ARIA label match (weight: 3)
    if (signature.ariaLabel && element.ariaLabel) {
      if (element.ariaLabel.toLowerCase() === signature.ariaLabel.toLowerCase()) {
        score += 3;
      }
    }
    weights += 3;

    // Attribute matches (weight: 2)
    for (const [key, value] of Object.entries(signature.attributes)) {
      const elValue = (element.attributes as Record<string, string | undefined>)[key];
      if (elValue && elValue === value) {
        score += 2;
      }
      weights += 2;
    }

    return score / weights;
  }

  private textSimilarity(text1: string, text2: string): number {
    const t1 = text1.toLowerCase();
    const t2 = text2.toLowerCase();

    if (t1 === t2) return 1.0;
    if (t1.includes(t2) || t2.includes(t1)) return 0.8;

    // Word overlap
    const words1 = new Set(t1.split(/\s+/));
    const words2 = new Set(t2.split(/\s+/));
    const intersection = new Set([...words1].filter(w => words2.has(w)));
    const union = new Set([...words1, ...words2]);

    return intersection.size / union.size;
  }

  private createSignature(element: IndexedElement): ElementSignature {
    return {
      tag: element.tag,
      text: element.text || '',
      ariaLabel: element.ariaLabel,
      role: element.role,
      relativePosition: this.getRelativePosition(element.bounds),
      attributes: {
        id: element.attributes.id || '',
        name: element.attributes.name || '',
        type: element.attributes.type || '',
        className: (element.attributes.className || '').split(' ').slice(0, 3).join(' '),
      },
      parentContext: undefined, // Would need page context to fill
      visual: element.bounds ? {
        approximateSize: this.getApproximateSize(element.bounds),
        approximatePosition: { x: element.bounds.x, y: element.bounds.y },
        isAboveTheFold: element.bounds.y < 800,
      } : undefined,
    };
  }

  private getRelativePosition(bounds: ElementBounds): 'top' | 'middle' | 'bottom' {
    if (!bounds) return 'middle';
    if (bounds.y < 300) return 'top';
    if (bounds.y > 700) return 'bottom';
    return 'middle';
  }

  private getApproximateSize(bounds: ElementBounds): 'small' | 'medium' | 'large' {
    const area = bounds.width * bounds.height;
    if (area < 5000) return 'small';
    if (area < 50000) return 'medium';
    return 'large';
  }

  private recordHistory(
    selector: ResilientSelector,
    strategy: string,
    success: boolean,
    repairedWith?: string
  ): void {
    selector.history.push({
      timestamp: Date.now(),
      strategy,
      success,
      url: this.page.url(),
      repairedWith,
    });

    // Keep only last 50 history entries
    while (selector.history.length > 50) {
      selector.history.shift();
    }

    selector.updatedAt = Date.now();
  }

  private ensureStorageDir(): void {
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
  }

  private loadSelectors(): void {
    const filePath = path.join(this.storageDir, 'selectors.json');
    if (fs.existsSync(filePath)) {
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        for (const selector of data) {
          this.selectors.set(selector.id, selector);
        }
        logger.debug('Loaded selectors', { count: this.selectors.size });
      } catch (error) {
        logger.error('Failed to load selectors', error);
      }
    }
  }

  private saveSelectors(): void {
    const filePath = path.join(this.storageDir, 'selectors.json');
    try {
      const data = Array.from(this.selectors.values());
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch (error) {
      logger.error('Failed to save selectors', error);
    }
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

export function createSelfHealingSelectors(page: any): SelfHealingSelectors {
  return new SelfHealingSelectors(page);
}
