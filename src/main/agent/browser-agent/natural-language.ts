/**
 * Natural Language Understanding for Browser Actions
 *
 * Translates natural language commands into precise browser actions
 * with disambiguation, context awareness, and confirmation.
 *
 * Unlike Claude for Chrome which requires explicit instructions,
 * Atlas understands implicit commands like:
 * - "Buy that" (knows what "that" refers to from context)
 * - "Go back to the search" (remembers navigation history)
 * - "Fill this out with my info" (knows user profile)
 *
 * @module agent/browser-agent/natural-language
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../../utils/logger';
import { BrowserAction, BrowserState, IndexedElement, SemanticPurpose } from './types';
import { getLLMManager } from '../../llm/manager';

const logger = createModuleLogger('NaturalLanguage');

// ============================================================================
// Types
// ============================================================================

export interface NLUResult {
  /** Original input */
  input: string;
  /** Interpreted intent */
  intent: BrowserIntent;
  /** Extracted entities */
  entities: ExtractedEntity[];
  /** Resolved references */
  resolvedReferences: ResolvedReference[];
  /** Generated actions */
  actions: BrowserAction[];
  /** Confidence in interpretation */
  confidence: number;
  /** Disambiguation needed? */
  needsDisambiguation: boolean;
  /** Disambiguation options */
  disambiguationOptions?: DisambiguationOption[];
  /** Confirmation required? */
  needsConfirmation: boolean;
  /** Confirmation message */
  confirmationMessage?: string;
}

export interface BrowserIntent {
  /** Primary intent */
  primary: IntentType;
  /** Sub-intent */
  subIntent?: string;
  /** Target description */
  target?: string;
  /** Data to use */
  data?: Record<string, string>;
}

export type IntentType =
  | 'navigate'
  | 'click'
  | 'type'
  | 'extract'
  | 'scroll'
  | 'search'
  | 'fill-form'
  | 'submit'
  | 'login'
  | 'logout'
  | 'purchase'
  | 'download'
  | 'go-back'
  | 'go-forward'
  | 'refresh'
  | 'screenshot'
  | 'wait'
  | 'close'
  | 'multi-step'
  | 'unknown';

export interface ExtractedEntity {
  /** Entity type */
  type: 'element' | 'url' | 'text' | 'number' | 'date' | 'time' | 'file' | 'pronoun' | 'reference';
  /** Original text */
  text: string;
  /** Resolved value */
  value: string;
  /** Start position */
  start: number;
  /** End position */
  end: number;
  /** Confidence */
  confidence: number;
}

export interface ResolvedReference {
  /** Reference type */
  type: 'this' | 'that' | 'it' | 'there' | 'previous' | 'last' | 'first' | 'next';
  /** What it refers to */
  referent: 'element' | 'page' | 'action' | 'result' | 'search';
  /** Resolved element/value */
  resolved?: IndexedElement | string;
  /** Confidence */
  confidence: number;
}

export interface DisambiguationOption {
  /** Option ID */
  id: string;
  /** Display text */
  text: string;
  /** Element if applicable */
  element?: IndexedElement;
  /** Confidence */
  confidence: number;
}

export interface ConversationContext {
  /** Recent utterances */
  recentUtterances: Array<{ text: string; timestamp: number }>;
  /** Last mentioned elements */
  lastMentionedElements: IndexedElement[];
  /** Last search query */
  lastSearchQuery?: string;
  /** Last navigation target */
  lastNavigationTarget?: string;
  /** Last action performed */
  lastAction?: BrowserAction;
  /** Current focus element */
  focusElement?: IndexedElement;
  /** Selected text */
  selectedText?: string;
}

// ============================================================================
// Intent Patterns
// ============================================================================

const INTENT_PATTERNS: Array<{
  intent: IntentType;
  patterns: RegExp[];
  extractor?: (match: RegExpMatchArray, input: string) => Partial<BrowserIntent>;
}> = [
  {
    intent: 'navigate',
    patterns: [
      /^go\s+to\s+(.+)$/i,
      /^open\s+(.+)$/i,
      /^visit\s+(.+)$/i,
      /^navigate\s+to\s+(.+)$/i,
      /^take\s+me\s+to\s+(.+)$/i,
    ],
    extractor: (match) => ({ target: match[1] }),
  },
  {
    intent: 'click',
    patterns: [
      /^click\s+(?:on\s+)?(.+)$/i,
      /^tap\s+(?:on\s+)?(.+)$/i,
      /^press\s+(?:the\s+)?(.+)\s+button$/i,
      /^select\s+(.+)$/i,
    ],
    extractor: (match) => ({ target: match[1] }),
  },
  {
    intent: 'type',
    patterns: [
      /^type\s+['""]?(.+?)['""]?(?:\s+in(?:to)?\s+(.+))?$/i,
      /^enter\s+['""]?(.+?)['""]?(?:\s+in(?:to)?\s+(.+))?$/i,
      /^write\s+['""]?(.+?)['""]?(?:\s+in(?:to)?\s+(.+))?$/i,
    ],
    extractor: (match) => ({
      target: match[2],
      data: { text: match[1] },
    }),
  },
  {
    intent: 'search',
    patterns: [
      /^search\s+(?:for\s+)?(.+)$/i,
      /^find\s+(.+)$/i,
      /^look\s+(?:up|for)\s+(.+)$/i,
    ],
    extractor: (match) => ({ data: { query: match[1] } }),
  },
  {
    intent: 'extract',
    patterns: [
      /^(?:get|extract|grab|copy)\s+(?:the\s+)?(.+)$/i,
      /^what(?:'s| is)\s+(?:the\s+)?(.+)$/i,
      /^show\s+(?:me\s+)?(.+)$/i,
    ],
    extractor: (match) => ({ target: match[1] }),
  },
  {
    intent: 'scroll',
    patterns: [
      /^scroll\s+(up|down|left|right)$/i,
      /^scroll\s+to\s+(?:the\s+)?(top|bottom)$/i,
      /^go\s+(up|down)$/i,
    ],
    extractor: (match) => ({ subIntent: match[1].toLowerCase() }),
  },
  {
    intent: 'fill-form',
    patterns: [
      /^fill\s+(?:out|in)\s+(?:the\s+)?(?:form|this)(?:\s+with\s+(.+))?$/i,
      /^complete\s+(?:the\s+)?(?:form|this)$/i,
    ],
    extractor: (match) => ({ data: match[1] ? { source: match[1] } : undefined }),
  },
  {
    intent: 'submit',
    patterns: [
      /^submit(?:\s+(?:the\s+)?form)?$/i,
      /^send\s+(?:it|this)$/i,
      /^confirm$/i,
    ],
  },
  {
    intent: 'login',
    patterns: [
      /^log\s*in(?:\s+(?:to|with)\s+(.+))?$/i,
      /^sign\s*in(?:\s+(?:to|with)\s+(.+))?$/i,
    ],
    extractor: (match) => ({ target: match[1] }),
  },
  {
    intent: 'logout',
    patterns: [
      /^log\s*out$/i,
      /^sign\s*out$/i,
    ],
  },
  {
    intent: 'purchase',
    patterns: [
      /^buy\s+(.+)$/i,
      /^purchase\s+(.+)$/i,
      /^add\s+(.+)\s+to\s+cart$/i,
      /^order\s+(.+)$/i,
    ],
    extractor: (match) => ({ target: match[1] }),
  },
  {
    intent: 'go-back',
    patterns: [
      /^go\s+back$/i,
      /^back$/i,
      /^previous\s+page$/i,
    ],
  },
  {
    intent: 'go-forward',
    patterns: [
      /^go\s+forward$/i,
      /^forward$/i,
      /^next\s+page$/i,
    ],
  },
  {
    intent: 'refresh',
    patterns: [
      /^refresh$/i,
      /^reload$/i,
    ],
  },
  {
    intent: 'screenshot',
    patterns: [
      /^(?:take\s+(?:a\s+)?)?screenshot$/i,
      /^capture\s+(?:the\s+)?(?:screen|page)$/i,
    ],
  },
  {
    intent: 'wait',
    patterns: [
      /^wait(?:\s+(?:for\s+)?(.+))?$/i,
      /^pause$/i,
    ],
    extractor: (match) => ({ target: match[1] }),
  },
  {
    intent: 'download',
    patterns: [
      /^download\s+(.+)$/i,
      /^save\s+(.+)$/i,
    ],
    extractor: (match) => ({ target: match[1] }),
  },
  {
    intent: 'close',
    patterns: [
      /^close(?:\s+(?:the\s+)?(.+))?$/i,
      /^exit$/i,
    ],
    extractor: (match) => ({ target: match[1] }),
  },
];

// ============================================================================
// Reference Patterns
// ============================================================================

const REFERENCE_PATTERNS: Array<{
  pattern: RegExp;
  type: ResolvedReference['type'];
  referent: ResolvedReference['referent'];
}> = [
  { pattern: /\bthis\b/i, type: 'this', referent: 'element' },
  { pattern: /\bthat\b/i, type: 'that', referent: 'element' },
  { pattern: /\bit\b/i, type: 'it', referent: 'element' },
  { pattern: /\bthere\b/i, type: 'there', referent: 'page' },
  { pattern: /\bprevious\b/i, type: 'previous', referent: 'action' },
  { pattern: /\blast\b/i, type: 'last', referent: 'result' },
  { pattern: /\bfirst\b/i, type: 'first', referent: 'result' },
  { pattern: /\bnext\b/i, type: 'next', referent: 'element' },
];

// ============================================================================
// Natural Language Understanding Engine
// ============================================================================

export class NaturalLanguageEngine extends EventEmitter {
  private context: ConversationContext = {
    recentUtterances: [],
    lastMentionedElements: [],
  };
  private llmManager = getLLMManager();

  constructor() {
    super();
  }

  /**
   * Process natural language input
   */
  async process(
    input: string,
    state: BrowserState,
    userContext?: Record<string, unknown>
  ): Promise<NLUResult> {
    // Add to recent utterances
    this.context.recentUtterances.push({
      text: input,
      timestamp: Date.now(),
    });

    // Trim old utterances
    if (this.context.recentUtterances.length > 10) {
      this.context.recentUtterances.shift();
    }

    // Extract entities
    const entities = this.extractEntities(input);

    // Resolve references
    const resolvedReferences = this.resolveReferences(input, state);

    // Detect intent
    const intent = await this.detectIntent(input, entities, resolvedReferences, state);

    // Generate actions
    const { actions, needsDisambiguation, disambiguationOptions } = await this.generateActions(
      intent,
      entities,
      resolvedReferences,
      state,
      userContext
    );

    // Check if confirmation needed
    const { needsConfirmation, confirmationMessage } = this.checkConfirmation(intent, actions, state);

    // Calculate overall confidence
    const confidence = this.calculateConfidence(intent, entities, resolvedReferences, actions);

    return {
      input,
      intent,
      entities,
      resolvedReferences,
      actions,
      confidence,
      needsDisambiguation,
      disambiguationOptions,
      needsConfirmation,
      confirmationMessage,
    };
  }

  /**
   * Update conversation context
   */
  updateContext(update: Partial<ConversationContext>): void {
    this.context = { ...this.context, ...update };
  }

  /**
   * Resolve a disambiguation choice
   */
  resolveDisambiguation(result: NLUResult, choiceId: string): NLUResult {
    const choice = result.disambiguationOptions?.find(o => o.id === choiceId);
    if (!choice) return result;

    // Update the actions based on choice
    const updatedActions = result.actions.map(action => {
      if (action.type === 'click' && choice.element) {
        return { ...action, elementIndex: choice.element.index };
      }
      return action;
    });

    return {
      ...result,
      actions: updatedActions,
      needsDisambiguation: false,
      disambiguationOptions: undefined,
      confidence: result.confidence + 0.2,
    };
  }

  // ============================================================================
  // Entity Extraction
  // ============================================================================

  private extractEntities(input: string): ExtractedEntity[] {
    const entities: ExtractedEntity[] = [];

    // Extract URLs
    const urlPattern = /https?:\/\/[^\s]+/gi;
    let match;
    while ((match = urlPattern.exec(input)) !== null) {
      entities.push({
        type: 'url',
        text: match[0],
        value: match[0],
        start: match.index,
        end: match.index + match[0].length,
        confidence: 1.0,
      });
    }

    // Extract quoted text
    const quotedPattern = /["'"']([^"'"']+)["'"']/g;
    while ((match = quotedPattern.exec(input)) !== null) {
      entities.push({
        type: 'text',
        text: match[0],
        value: match[1],
        start: match.index,
        end: match.index + match[0].length,
        confidence: 1.0,
      });
    }

    // Extract numbers
    const numberPattern = /\b\d+(?:\.\d+)?\b/g;
    while ((match = numberPattern.exec(input)) !== null) {
      entities.push({
        type: 'number',
        text: match[0],
        value: match[0],
        start: match.index,
        end: match.index + match[0].length,
        confidence: 0.9,
      });
    }

    // Extract pronouns/references
    for (const refPattern of REFERENCE_PATTERNS) {
      const regex = new RegExp(refPattern.pattern, 'gi');
      while ((match = regex.exec(input)) !== null) {
        entities.push({
          type: 'pronoun',
          text: match[0],
          value: refPattern.type,
          start: match.index,
          end: match.index + match[0].length,
          confidence: 0.8,
        });
      }
    }

    return entities;
  }

  // ============================================================================
  // Reference Resolution
  // ============================================================================

  private resolveReferences(input: string, state: BrowserState): ResolvedReference[] {
    const references: ResolvedReference[] = [];

    for (const refPattern of REFERENCE_PATTERNS) {
      if (refPattern.pattern.test(input)) {
        const resolved = this.resolveReference(refPattern.type, refPattern.referent, state);
        references.push(resolved);
      }
    }

    return references;
  }

  private resolveReference(
    type: ResolvedReference['type'],
    referent: ResolvedReference['referent'],
    state: BrowserState
  ): ResolvedReference {
    let resolved: IndexedElement | string | undefined;
    let confidence = 0.5;

    switch (type) {
      case 'this':
      case 'it':
        // Refers to focus element or last mentioned
        if (this.context.focusElement) {
          resolved = this.context.focusElement;
          confidence = 0.9;
        } else if (this.context.lastMentionedElements.length > 0) {
          resolved = this.context.lastMentionedElements[0];
          confidence = 0.7;
        }
        break;

      case 'that':
        // Refers to second most recent element
        if (this.context.lastMentionedElements.length > 1) {
          resolved = this.context.lastMentionedElements[1];
          confidence = 0.7;
        } else if (this.context.lastMentionedElements.length > 0) {
          resolved = this.context.lastMentionedElements[0];
          confidence = 0.6;
        }
        break;

      case 'previous':
        // Previous page or action
        if (referent === 'action' && this.context.lastAction) {
          resolved = JSON.stringify(this.context.lastAction);
          confidence = 0.8;
        } else if (this.context.lastNavigationTarget) {
          resolved = this.context.lastNavigationTarget;
          confidence = 0.7;
        }
        break;

      case 'last':
      case 'first':
        // First/last search result
        if (this.context.lastSearchQuery && state.elements.length > 0) {
          const results = state.elements.filter(e =>
            e.semanticPurpose === 'content-link' || e.tagName === 'a'
          );
          resolved = type === 'first' ? results[0] : results[results.length - 1];
          confidence = resolved ? 0.7 : 0.3;
        }
        break;

      case 'next':
        // Next element after focus
        if (this.context.focusElement) {
          const nextIndex = this.context.focusElement.index + 1;
          resolved = state.elements.find(e => e.index === nextIndex);
          confidence = resolved ? 0.8 : 0.3;
        }
        break;

      case 'there':
        // A location - usually the last navigation target
        if (this.context.lastNavigationTarget) {
          resolved = this.context.lastNavigationTarget;
          confidence = 0.7;
        }
        break;
    }

    return { type, referent, resolved, confidence };
  }

  // ============================================================================
  // Intent Detection
  // ============================================================================

  private async detectIntent(
    input: string,
    entities: ExtractedEntity[],
    references: ResolvedReference[],
    state: BrowserState
  ): Promise<BrowserIntent> {
    // Try pattern matching first
    for (const pattern of INTENT_PATTERNS) {
      for (const regex of pattern.patterns) {
        const match = input.match(regex);
        if (match) {
          const intent: BrowserIntent = {
            primary: pattern.intent,
          };
          if (pattern.extractor) {
            Object.assign(intent, pattern.extractor(match, input));
          }
          return intent;
        }
      }
    }

    // Fallback to LLM for complex inputs
    return this.detectIntentWithLLM(input, entities, references, state);
  }

  private async detectIntentWithLLM(
    input: string,
    entities: ExtractedEntity[],
    references: ResolvedReference[],
    state: BrowserState
  ): Promise<BrowserIntent> {
    const prompt = `
You are a browser action intent classifier. Given the user's command and page context, determine the intent.

User command: "${input}"

Current page: ${state.url}
Page title: ${state.title}

Extracted entities: ${JSON.stringify(entities)}
References found: ${JSON.stringify(references.map(r => ({ type: r.type, referent: r.referent })))}

Available intents: navigate, click, type, extract, scroll, search, fill-form, submit, login, logout, purchase, download, go-back, go-forward, refresh, screenshot, wait, close, multi-step

Respond with JSON only:
{
  "primary": "<intent>",
  "subIntent": "<optional sub-intent>",
  "target": "<what to act on>",
  "data": { "<key>": "<value>" }
}`;

    try {
      const response = await this.llmManager.generateWithProvider('fireworks', prompt, {
        maxTokens: 200,
        temperature: 0.1,
      });

      const jsonMatch = response.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]) as BrowserIntent;
      }
    } catch (error) {
      logger.error('LLM intent detection failed', error);
    }

    return { primary: 'unknown' };
  }

  // ============================================================================
  // Action Generation
  // ============================================================================

  private async generateActions(
    intent: BrowserIntent,
    entities: ExtractedEntity[],
    references: ResolvedReference[],
    state: BrowserState,
    userContext?: Record<string, unknown>
  ): Promise<{
    actions: BrowserAction[];
    needsDisambiguation: boolean;
    disambiguationOptions?: DisambiguationOption[];
  }> {
    const actions: BrowserAction[] = [];
    let needsDisambiguation = false;
    let disambiguationOptions: DisambiguationOption[] | undefined;

    switch (intent.primary) {
      case 'navigate': {
        const url = this.resolveUrl(intent.target || '', state);
        actions.push({
          type: 'navigate',
          url,
          description: `Navigate to ${url}`,
        });
        break;
      }

      case 'click': {
        const { element, options } = this.findElementByDescription(
          intent.target || '',
          state,
          references
        );
        if (element) {
          actions.push({
            type: 'click',
            elementIndex: element.index,
            description: `Click ${element.text || element.ariaLabel || 'element'}`,
          });
        } else if (options && options.length > 1) {
          needsDisambiguation = true;
          disambiguationOptions = options;
          // Default to first option
          actions.push({
            type: 'click',
            elementIndex: options[0].element?.index || 0,
            description: `Click ${options[0].text}`,
          });
        }
        break;
      }

      case 'type': {
        const text = intent.data?.text || entities.find(e => e.type === 'text')?.value || '';
        const { element } = this.findElementByDescription(
          intent.target || 'input',
          state,
          references
        );
        if (element) {
          actions.push({
            type: 'type',
            elementIndex: element.index,
            text,
            description: `Type "${text.slice(0, 30)}..."`,
          });
        }
        break;
      }

      case 'search': {
        const query = intent.data?.query || '';
        // Find search input
        const searchInput = state.elements.find(e =>
          e.semanticPurpose === 'search-input' ||
          e.attributes?.type === 'search' ||
          e.attributes?.name?.includes('search')
        );
        if (searchInput) {
          actions.push({
            type: 'click',
            elementIndex: searchInput.index,
            description: 'Click search input',
          });
          actions.push({
            type: 'type',
            elementIndex: searchInput.index,
            text: query,
            pressEnter: true,
            description: `Search for "${query}"`,
          });
        }
        this.context.lastSearchQuery = query;
        break;
      }

      case 'fill-form': {
        actions.push({
          type: 'evaluate',
          script: 'FILL_FORM',
          description: 'Fill form with user data',
        });
        break;
      }

      case 'submit': {
        const submitBtn = state.elements.find(e =>
          e.semanticPurpose === 'submit-button' ||
          e.attributes?.type === 'submit'
        );
        if (submitBtn) {
          actions.push({
            type: 'click',
            elementIndex: submitBtn.index,
            description: 'Submit form',
          });
        }
        break;
      }

      case 'scroll': {
        const direction = (intent.subIntent || 'down') as 'up' | 'down' | 'left' | 'right';
        actions.push({
          type: 'scroll',
          direction,
          description: `Scroll ${direction}`,
        });
        break;
      }

      case 'go-back':
        actions.push({ type: 'goBack', description: 'Go back' });
        break;

      case 'go-forward':
        actions.push({ type: 'goForward', description: 'Go forward' });
        break;

      case 'refresh':
        actions.push({ type: 'refresh', description: 'Refresh page' });
        break;

      case 'screenshot':
        actions.push({ type: 'screenshot', description: 'Take screenshot' });
        break;

      case 'extract': {
        actions.push({
          type: 'extract',
          dataType: intent.target,
          description: `Extract ${intent.target || 'page content'}`,
        });
        break;
      }

      case 'wait': {
        actions.push({
          type: 'wait',
          condition: 'load',
          timeout: 5000,
          description: `Wait for ${intent.target || 'page load'}`,
        });
        break;
      }

      case 'login': {
        actions.push(
          { type: 'evaluate', script: 'LOGIN_FLOW', description: 'Perform login flow' }
        );
        break;
      }

      case 'purchase': {
        const { element } = this.findElementByDescription(
          intent.target || 'add to cart',
          state,
          references
        );
        if (element) {
          actions.push({
            type: 'click',
            elementIndex: element.index,
            description: `Add ${intent.target} to cart`,
          });
        }
        break;
      }

      default:
        logger.warn('Unknown intent', { intent });
    }

    // Update context
    if (actions.length > 0) {
      this.context.lastAction = actions[0];
    }

    return { actions, needsDisambiguation, disambiguationOptions };
  }

  // ============================================================================
  // Element Finding
  // ============================================================================

  private findElementByDescription(
    description: string,
    state: BrowserState,
    references: ResolvedReference[]
  ): { element?: IndexedElement; options?: DisambiguationOption[] } {
    // Check references first
    for (const ref of references) {
      if (ref.resolved && typeof ref.resolved !== 'string') {
        return { element: ref.resolved };
      }
    }

    const descLower = description.toLowerCase();

    // Score all elements
    const scored = state.elements
      .filter(e => e.isInteractive)
      .map(e => ({
        element: e,
        score: this.scoreElementMatch(e, descLower),
      }))
      .filter(s => s.score > 0.3)
      .sort((a, b) => b.score - a.score);

    if (scored.length === 0) {
      return {};
    }

    // If top match is much better, return it
    if (scored.length === 1 || scored[0].score > scored[1].score + 0.2) {
      this.context.lastMentionedElements = [scored[0].element];
      return { element: scored[0].element };
    }

    // Otherwise, return disambiguation options
    const options: DisambiguationOption[] = scored.slice(0, 5).map((s, i) => ({
      id: `option-${i}`,
      text: s.element.text || s.element.ariaLabel || `Element ${s.element.index}`,
      element: s.element,
      confidence: s.score,
    }));

    return { element: scored[0].element, options };
  }

  private scoreElementMatch(element: IndexedElement, description: string): number {
    let score = 0;

    // Text match
    const textLower = (element.text || '').toLowerCase();
    if (textLower === description) {
      score += 1.0;
    } else if (textLower.includes(description)) {
      score += 0.7;
    } else if (description.includes(textLower) && textLower.length > 2) {
      score += 0.5;
    }

    // Aria label match
    const ariaLower = (element.ariaLabel || '').toLowerCase();
    if (ariaLower === description) {
      score += 0.9;
    } else if (ariaLower.includes(description)) {
      score += 0.6;
    }

    // Role/tag match
    if (description.includes('button') && (element.tagName === 'button' || element.role === 'button')) {
      score += 0.3;
    }
    if (description.includes('link') && element.tagName === 'a') {
      score += 0.3;
    }
    if (description.includes('input') && element.tagName === 'input') {
      score += 0.3;
    }

    // Semantic purpose match
    if (element.semanticPurpose && description.includes(element.semanticPurpose.replace(/-/g, ' '))) {
      score += 0.4;
    }

    return Math.min(score, 1.0);
  }

  // ============================================================================
  // URL Resolution
  // ============================================================================

  private resolveUrl(target: string, state: BrowserState): string {
    // Already a URL
    if (target.startsWith('http://') || target.startsWith('https://')) {
      return target;
    }

    // Common shortcuts
    const shortcuts: Record<string, string> = {
      google: 'https://www.google.com',
      youtube: 'https://www.youtube.com',
      github: 'https://github.com',
      twitter: 'https://twitter.com',
      facebook: 'https://www.facebook.com',
      amazon: 'https://www.amazon.com',
      gmail: 'https://mail.google.com',
    };

    const shortcutKey = target.toLowerCase();
    if (shortcuts[shortcutKey]) {
      return shortcuts[shortcutKey];
    }

    // Relative URL
    if (target.startsWith('/')) {
      const base = new URL(state.url);
      return `${base.origin}${target}`;
    }

    // Looks like a domain
    if (target.includes('.') && !target.includes(' ')) {
      return `https://${target}`;
    }

    // Treat as search
    return `https://www.google.com/search?q=${encodeURIComponent(target)}`;
  }

  // ============================================================================
  // Confirmation Logic
  // ============================================================================

  private checkConfirmation(
    intent: BrowserIntent,
    actions: BrowserAction[],
    state: BrowserState
  ): { needsConfirmation: boolean; confirmationMessage?: string } {
    // Sensitive actions that need confirmation
    const sensitiveIntents: IntentType[] = ['purchase', 'submit', 'login'];

    if (sensitiveIntents.includes(intent.primary)) {
      return {
        needsConfirmation: true,
        confirmationMessage: this.generateConfirmationMessage(intent, actions, state),
      };
    }

    // Check if on sensitive page
    const url = state.url.toLowerCase();
    if (url.includes('checkout') || url.includes('payment') || url.includes('confirm')) {
      return {
        needsConfirmation: true,
        confirmationMessage: `You're about to ${intent.primary} on a sensitive page. Continue?`,
      };
    }

    return { needsConfirmation: false };
  }

  private generateConfirmationMessage(
    intent: BrowserIntent,
    actions: BrowserAction[],
    state: BrowserState
  ): string {
    switch (intent.primary) {
      case 'purchase':
        return `Ready to ${intent.target ? `add ${intent.target} to cart` : 'make a purchase'}. Proceed?`;
      case 'submit':
        return 'Ready to submit the form. All information correct?';
      case 'login':
        return `Ready to log in${intent.target ? ` to ${intent.target}` : ''}. Continue?`;
      default:
        return `Execute ${actions.length} action(s)?`;
    }
  }

  // ============================================================================
  // Confidence Calculation
  // ============================================================================

  private calculateConfidence(
    intent: BrowserIntent,
    entities: ExtractedEntity[],
    references: ResolvedReference[],
    actions: BrowserAction[]
  ): number {
    let confidence = 0.5;

    // Intent confidence
    if (intent.primary !== 'unknown') {
      confidence += 0.2;
    }

    // Entity confidence
    const avgEntityConfidence = entities.length > 0
      ? entities.reduce((sum, e) => sum + e.confidence, 0) / entities.length
      : 0.5;
    confidence += avgEntityConfidence * 0.15;

    // Reference confidence
    const avgRefConfidence = references.length > 0
      ? references.reduce((sum, r) => sum + r.confidence, 0) / references.length
      : 0.5;
    confidence += avgRefConfidence * 0.15;

    // Actions generated
    if (actions.length > 0) {
      confidence += 0.1;
    }

    return Math.min(confidence, 1.0);
  }
}

// ============================================================================
// Singleton Factory
// ============================================================================

let nluInstance: NaturalLanguageEngine | null = null;

export function getNaturalLanguageEngine(): NaturalLanguageEngine {
  if (!nluInstance) {
    nluInstance = new NaturalLanguageEngine();
  }
  return nluInstance;
}

export function createNaturalLanguageEngine(): NaturalLanguageEngine {
  return new NaturalLanguageEngine();
}
