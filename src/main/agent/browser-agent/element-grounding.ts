/**
 * Element Grounding
 *
 * Natural language to element mapping using accessibility tree + vision hybrid.
 * Enables finding elements by semantic descriptions rather than CSS selectors.
 *
 * @module agent/browser-agent/element-grounding
 */

import { createModuleLogger } from '../../utils/logger';
import { getLLMManager } from '../../llm/manager';
import { IndexedElement, BrowserState, SetOfMarkConfig, ElementBounds, ElementAttributes, ElementInteractivity, ElementVisualState } from './types';

const logger = createModuleLogger('ElementGrounding');

// ============================================================================
// Local Types for Element Grounding
// ============================================================================

/** Simplified element for grounding results */
interface GroundedElement {
  index: number;
  tag: string;
  role: string;
  text: string;
  selector?: string;
  xpath: string;
  bounds: { x: number; y: number; width: number; height: number };
  center: { x: number; y: number };
  isInteractive: boolean;
}

// ============================================================================
// Accessibility Tree Extraction
// ============================================================================

/**
 * Script to extract the accessibility tree from the page
 */
const ACCESSIBILITY_TREE_SCRIPT = `
(() => {
  function buildAccessibilityTree(node, depth = 0, maxDepth = 10) {
    if (depth > maxDepth) return null;
    if (!node) return null;
    
    const computedStyle = window.getComputedStyle(node);
    const isVisible = computedStyle.display !== 'none' &&
                      computedStyle.visibility !== 'hidden' &&
                      computedStyle.opacity !== '0';
    
    if (!isVisible) return null;
    
    const rect = node.getBoundingClientRect();
    const isInViewport = rect.width > 0 && rect.height > 0;
    
    const role = node.getAttribute('role') ||
                 node.tagName.toLowerCase();
    
    const treeNode = {
      role,
      name: getAccessibleName(node),
      description: node.getAttribute('aria-description') || '',
      value: getAccessibleValue(node),
      states: getAccessibleStates(node),
      bounds: isInViewport ? {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      } : null,
      interactive: isInteractive(node),
      children: [],
    };
    
    // Process children
    for (const child of node.children) {
      const childTree = buildAccessibilityTree(child, depth + 1, maxDepth);
      if (childTree) {
        treeNode.children.push(childTree);
      }
    }
    
    // Skip nodes with no meaningful content
    if (!treeNode.name && !treeNode.value && treeNode.children.length === 0) {
      return null;
    }
    
    return treeNode;
  }
  
  function getAccessibleName(node) {
    // Priority: aria-label > aria-labelledby > alt > title > innerText (truncated)
    if (node.getAttribute('aria-label')) {
      return node.getAttribute('aria-label');
    }
    
    const labelledBy = node.getAttribute('aria-labelledby');
    if (labelledBy) {
      const labels = labelledBy.split(' ').map(id => {
        const el = document.getElementById(id);
        return el ? el.textContent : '';
      }).filter(Boolean);
      if (labels.length) return labels.join(' ');
    }
    
    if (node.alt) return node.alt;
    if (node.title) return node.title;
    if (node.placeholder) return node.placeholder;
    
    // For buttons and links, use text content
    if (['button', 'a', 'label'].includes(node.tagName.toLowerCase())) {
      const text = node.textContent?.trim();
      if (text && text.length < 100) return text;
    }
    
    return '';
  }
  
  function getAccessibleValue(node) {
    if (node.value !== undefined && node.value !== '') {
      return String(node.value).slice(0, 100);
    }
    if (node.getAttribute('aria-valuenow')) {
      return node.getAttribute('aria-valuenow');
    }
    return '';
  }
  
  function getAccessibleStates(node) {
    const states = [];
    
    if (node.disabled) states.push('disabled');
    if (node.checked) states.push('checked');
    if (node.selected) states.push('selected');
    if (node.getAttribute('aria-expanded') === 'true') states.push('expanded');
    if (node.getAttribute('aria-hidden') === 'true') states.push('hidden');
    if (node.getAttribute('aria-pressed') === 'true') states.push('pressed');
    if (node.required) states.push('required');
    if (node.readOnly) states.push('readonly');
    
    return states;
  }
  
  function isInteractive(node) {
    const interactiveRoles = ['button', 'link', 'textbox', 'checkbox', 'radio',
                              'combobox', 'listbox', 'menuitem', 'tab', 'switch'];
    const interactiveTags = ['a', 'button', 'input', 'select', 'textarea'];
    
    const role = node.getAttribute('role');
    const tag = node.tagName.toLowerCase();
    
    if (interactiveRoles.includes(role) || interactiveTags.includes(tag)) {
      return true;
    }
    
    // Check for click handlers
    if (node.onclick || node.getAttribute('onclick')) return true;
    if (node.getAttribute('tabindex') === '0') return true;
    
    return false;
  }
  
  return buildAccessibilityTree(document.body);
})()
`;

/**
 * Script to find elements matching a description
 */
const ELEMENT_SEARCH_SCRIPT = (query: string) => `
(() => {
  const results = [];
  const query = ${JSON.stringify(query.toLowerCase())};
  
  function scoreMatch(text, query) {
    if (!text) return 0;
    text = text.toLowerCase();
    
    // Exact match
    if (text === query) return 1.0;
    
    // Contains exact query
    if (text.includes(query)) return 0.8;
    
    // Query contains text
    if (query.includes(text)) return 0.6;
    
    // Word overlap
    const textWords = text.split(/\\s+/);
    const queryWords = query.split(/\\s+/);
    const overlap = textWords.filter(w => queryWords.includes(w)).length;
    if (overlap > 0) return 0.4 + (overlap / Math.max(textWords.length, queryWords.length)) * 0.3;
    
    return 0;
  }
  
  function findMatchingElements(node) {
    if (!node || node.nodeType !== 1) return;
    
    const computedStyle = window.getComputedStyle(node);
    const isVisible = computedStyle.display !== 'none' &&
                      computedStyle.visibility !== 'hidden' &&
                      parseFloat(computedStyle.opacity) > 0;
    
    if (!isVisible) return;
    
    const rect = node.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    
    // Calculate match score
    let maxScore = 0;
    let matchReason = '';
    
    // Check aria-label
    const ariaLabel = node.getAttribute('aria-label');
    if (ariaLabel) {
      const score = scoreMatch(ariaLabel, query);
      if (score > maxScore) {
        maxScore = score;
        matchReason = 'aria-label: ' + ariaLabel;
      }
    }
    
    // Check text content
    const textContent = node.textContent?.trim().slice(0, 200);
    if (textContent) {
      const score = scoreMatch(textContent, query);
      if (score > maxScore) {
        maxScore = score;
        matchReason = 'text: ' + textContent.slice(0, 50);
      }
    }
    
    // Check placeholder
    const placeholder = node.placeholder;
    if (placeholder) {
      const score = scoreMatch(placeholder, query);
      if (score > maxScore) {
        maxScore = score;
        matchReason = 'placeholder: ' + placeholder;
      }
    }
    
    // Check alt text
    const alt = node.alt;
    if (alt) {
      const score = scoreMatch(alt, query);
      if (score > maxScore) {
        maxScore = score;
        matchReason = 'alt: ' + alt;
      }
    }
    
    // Check title
    const title = node.title;
    if (title) {
      const score = scoreMatch(title, query);
      if (score > maxScore) {
        maxScore = score;
        matchReason = 'title: ' + title;
      }
    }
    
    // Check id and class names
    const id = node.id;
    if (id) {
      const score = scoreMatch(id.replace(/[-_]/g, ' '), query);
      if (score > maxScore) {
        maxScore = score;
        matchReason = 'id: ' + id;
      }
    }
    
    // Check name attribute
    const name = node.getAttribute('name');
    if (name) {
      const score = scoreMatch(name.replace(/[-_]/g, ' '), query);
      if (score > maxScore) {
        maxScore = score;
        matchReason = 'name: ' + name;
      }
    }
    
    if (maxScore > 0.3) {
      results.push({
        score: maxScore,
        reason: matchReason,
        tag: node.tagName.toLowerCase(),
        bounds: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
        center: {
          x: Math.round(rect.x + rect.width / 2),
          y: Math.round(rect.y + rect.height / 2),
        },
        text: textContent?.slice(0, 100) || '',
        attributes: {
          id: id || undefined,
          name: name || undefined,
          ariaLabel: ariaLabel || undefined,
          placeholder: placeholder || undefined,
        },
        interactive: isInteractive(node),
        xpath: getXPath(node),
      });
    }
    
    // Recurse into children
    for (const child of node.children) {
      findMatchingElements(child);
    }
  }
  
  function isInteractive(node) {
    const interactiveTags = ['a', 'button', 'input', 'select', 'textarea'];
    const tag = node.tagName.toLowerCase();
    
    if (interactiveTags.includes(tag)) return true;
    if (node.onclick || node.getAttribute('onclick')) return true;
    if (node.getAttribute('role') === 'button') return true;
    if (node.getAttribute('tabindex') === '0') return true;
    
    return false;
  }
  
  function getXPath(node) {
    if (!node) return '';
    if (node.id) return '//*[@id="' + node.id + '"]';
    
    const parts = [];
    while (node && node.nodeType === 1) {
      let index = 1;
      for (let sibling = node.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
        if (sibling.tagName === node.tagName) index++;
      }
      const tagName = node.tagName.toLowerCase();
      const part = tagName + '[' + index + ']';
      parts.unshift(part);
      node = node.parentElement;
    }
    return '/' + parts.join('/');
  }
  
  findMatchingElements(document.body);
  
  // Sort by score descending
  results.sort((a, b) => b.score - a.score);
  
  return results.slice(0, 20);
})()
`;

// ============================================================================
// LLM-based Grounding Prompts
// ============================================================================

const ELEMENT_GROUNDING_PROMPT = `You are an expert at understanding web pages and locating elements.

Given a user's natural language description of an element and the available elements on the page, identify which element best matches the description.

RULES:
1. Consider semantic meaning, not just text matching
2. "Submit button" could match a button with text "Submit", "Go", "Send", etc.
3. "Search box" could match an input with placeholder "Search...", aria-label "Search", etc.
4. Consider context - a "login button" near a password field is likely the right one
5. If multiple elements match, prefer the most interactive/prominent one
6. Return the index of the best matching element, or -1 if no match

CONTEXT:
{context}

AVAILABLE ELEMENTS:
{elements}

USER DESCRIPTION: {description}

Respond with a JSON object:
{
  "matchIndex": <index of best match or -1>,
  "confidence": <0-1>,
  "reasoning": "<brief explanation>"
}`;

// ============================================================================
// Element Grounding Class
// ============================================================================

export interface GroundingResult {
  success: boolean;
  element?: GroundedElement;
  confidence: number;
  reasoning: string;
  alternatives?: GroundedElement[];
}

export interface AccessibilityNode {
  role: string;
  name: string;
  description: string;
  value: string;
  states: string[];
  bounds: { x: number; y: number; width: number; height: number } | null;
  interactive: boolean;
  children: AccessibilityNode[];
}

export interface ElementMatch {
  score: number;
  reason: string;
  tag: string;
  bounds: { x: number; y: number; width: number; height: number };
  center: { x: number; y: number };
  text: string;
  attributes: {
    id?: string;
    name?: string;
    ariaLabel?: string;
    placeholder?: string;
  };
  interactive: boolean;
  xpath: string;
}

export class ElementGrounding {
  private page: any;
  private cachedElements: IndexedElement[] = [];
  private accessibilityTree: AccessibilityNode | null = null;
  private lastCacheTime = 0;
  private cacheValidityMs = 5000; // Cache valid for 5 seconds

  constructor(page: any) {
    this.page = page;
  }

  /**
   * Ground a natural language description to a specific element
   */
  async groundElement(
    description: string,
    elements?: IndexedElement[],
    options: {
      useLLM?: boolean;
      contextHint?: string;
      requireInteractive?: boolean;
    } = {}
  ): Promise<GroundingResult> {
    const { useLLM = true, contextHint, requireInteractive = false } = options;
    
    logger.debug('Grounding element', { description, useLLM, requireInteractive });
    
    // Step 1: Get candidate elements from page search
    const candidates = await this.searchElements(description);
    
    if (candidates.length === 0) {
      return {
        success: false,
        confidence: 0,
        reasoning: `No elements found matching "${description}"`,
      };
    }
    
    // Filter by interactivity if required
    const filteredCandidates = requireInteractive
      ? candidates.filter((c) => c.interactive)
      : candidates;
    
    if (filteredCandidates.length === 0) {
      return {
        success: false,
        confidence: 0,
        reasoning: `Found elements matching "${description}" but none are interactive`,
        alternatives: candidates.slice(0, 3).map((c) => this.matchToIndexedElement(c, 0)),
      };
    }
    
    // If we have a high-confidence match without LLM, use it
    if (filteredCandidates[0].score >= 0.9 && !useLLM) {
      const element = this.matchToIndexedElement(filteredCandidates[0], 0);
      return {
        success: true,
        element,
        confidence: filteredCandidates[0].score,
        reasoning: `High confidence match: ${filteredCandidates[0].reason}`,
        alternatives: filteredCandidates.slice(1, 4).map((c, i) => 
          this.matchToIndexedElement(c, i + 1)
        ),
      };
    }
    
    // Step 2: Use LLM for disambiguation if enabled
    if (useLLM && filteredCandidates.length > 1) {
      const llmResult = await this.llmGrounding(
        description,
        filteredCandidates,
        contextHint,
        elements || []
      );
      
      if (llmResult.success) {
        return llmResult;
      }
    }
    
    // Fall back to highest-scoring candidate
    const bestMatch = filteredCandidates[0];
    const element = this.matchToIndexedElement(bestMatch, 0);
    
    return {
      success: true,
      element,
      confidence: bestMatch.score,
      reasoning: `Best match: ${bestMatch.reason}`,
      alternatives: filteredCandidates.slice(1, 4).map((c, i) => 
        this.matchToIndexedElement(c, i + 1)
      ),
    };
  }

  /**
   * Search for elements matching a description
   */
  async searchElements(query: string): Promise<ElementMatch[]> {
    try {
      const results = await this.page.evaluate(ELEMENT_SEARCH_SCRIPT(query));
      return results || [];
    } catch (error) {
      logger.error('Element search failed', { error: error instanceof Error ? error.message : String(error) });
      return [];
    }
  }

  /**
   * Get the accessibility tree
   */
  async getAccessibilityTree(): Promise<AccessibilityNode | null> {
    const now = Date.now();
    if (this.accessibilityTree && now - this.lastCacheTime < this.cacheValidityMs) {
      return this.accessibilityTree;
    }
    
    try {
      this.accessibilityTree = await this.page.evaluate(ACCESSIBILITY_TREE_SCRIPT);
      this.lastCacheTime = now;
      return this.accessibilityTree;
    } catch (error) {
      logger.error('Failed to extract accessibility tree', { error: error instanceof Error ? error.message : String(error) });
      return null;
    }
  }

  /**
   * Find an element by various criteria
   */
  async findElement(criteria: {
    text?: string;
    role?: string;
    label?: string;
    placeholder?: string;
    nearElement?: GroundedElement;
    index?: number;
  }): Promise<GroundingResult> {
    // Build a description from criteria
    const parts: string[] = [];
    
    if (criteria.role) parts.push(criteria.role);
    if (criteria.label) parts.push(`labeled "${criteria.label}"`);
    if (criteria.text) parts.push(`with text "${criteria.text}"`);
    if (criteria.placeholder) parts.push(`with placeholder "${criteria.placeholder}"`);
    if (criteria.nearElement) {
      parts.push(`near the ${criteria.nearElement.role} "${criteria.nearElement.text}"`);
    }
    
    const description = parts.join(' ') || 'element';
    
    return this.groundElement(description, undefined, {
      useLLM: true,
      requireInteractive: ['button', 'link', 'input', 'textbox', 'checkbox'].includes(
        criteria.role || ''
      ),
    });
  }

  /**
   * Ground an element using LLM
   */
  private async llmGrounding(
    description: string,
    candidates: ElementMatch[],
    contextHint?: string,
    existingElements?: IndexedElement[]
  ): Promise<GroundingResult> {
    try {
      const llmManager = getLLMManager();
      
      // Format elements for LLM
      const elementsText = candidates
        .slice(0, 10)
        .map((c, i) => {
          const attrs = Object.entries(c.attributes)
            .filter(([_, v]) => v)
            .map(([k, v]) => `${k}="${v}"`)
            .join(' ');
          return `[${i}] <${c.tag}${attrs ? ' ' + attrs : ''}> "${c.text.slice(0, 50)}" (score: ${c.score.toFixed(2)}, ${c.interactive ? 'interactive' : 'static'})`;
        })
        .join('\n');
      
      const prompt = ELEMENT_GROUNDING_PROMPT
        .replace('{context}', contextHint || 'General web page')
        .replace('{elements}', elementsText)
        .replace('{description}', description);
      
      const response = await llmManager.chat(prompt);
      
      // Parse response
      const jsonMatch = response.content.match(/\\{[\\s\\S]*\\}/);
      if (!jsonMatch) {
        logger.warn('LLM grounding did not return valid JSON');
        return { success: false, confidence: 0, reasoning: 'LLM response parsing failed' };
      }
      
      const result = JSON.parse(jsonMatch[0]);
      
      if (result.matchIndex === -1 || result.matchIndex >= candidates.length) {
        return {
          success: false,
          confidence: result.confidence || 0,
          reasoning: result.reasoning || 'No matching element found',
        };
      }
      
      const matchedCandidate = candidates[result.matchIndex];
      const element = this.matchToIndexedElement(matchedCandidate, result.matchIndex);
      
      return {
        success: true,
        element,
        confidence: result.confidence || matchedCandidate.score,
        reasoning: result.reasoning || `LLM selected element at index ${result.matchIndex}`,
        alternatives: candidates
          .filter((_, i) => i !== result.matchIndex)
          .slice(0, 3)
          .map((c, i) => this.matchToIndexedElement(c, i)),
      };
    } catch (error) {
      logger.error('LLM grounding failed', { error: error instanceof Error ? error.message : String(error) });
      return { success: false, confidence: 0, reasoning: 'LLM grounding error' };
    }
  }

  /**
   * Convert ElementMatch to GroundedElement
   */
  private matchToIndexedElement(match: ElementMatch, index: number): GroundedElement {
    return {
      index,
      tag: match.tag,
      role: this.inferElementRole(match.tag, match.attributes),
      text: match.text,
      bounds: match.bounds,
      center: match.center,
      isInteractive: match.interactive,
      xpath: match.xpath,
    };
  }

  /**
   * Infer element role from tag and attributes
   */
  private inferElementRole(
    tag: string,
    attrs: ElementMatch['attributes']
  ): string {
    if (tag === 'a') return 'link';
    if (tag === 'button') return 'button';
    if (tag === 'input') return 'input';
    if (tag === 'select') return 'select';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'img') return 'image';
    if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'span', 'div'].includes(tag)) {
      return 'text';
    }
    return 'generic';
  }

  /**
   * Update cache validity duration
   */
  setCacheValidity(ms: number): void {
    this.cacheValidityMs = ms;
  }

  /**
   * Clear cached data
   */
  clearCache(): void {
    this.cachedElements = [];
    this.accessibilityTree = null;
    this.lastCacheTime = 0;
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create an element grounding instance for a Puppeteer page
 */
export function createElementGrounding(page: any): ElementGrounding {
  return new ElementGrounding(page);
}
