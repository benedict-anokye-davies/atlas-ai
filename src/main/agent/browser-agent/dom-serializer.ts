/**
 * DOM Serializer
 *
 * Extracts interactive elements from the page with semantic understanding.
 * Creates a structured representation for LLM context that surpasses
 * basic DOM scraping by including accessibility info, semantic purpose,
 * and interaction capabilities.
 *
 * @module agent/browser-agent/dom-serializer
 */

import { createModuleLogger } from '../../utils/logger';
import {
  BrowserState,
  IndexedElement,
  ElementBounds,
  ElementAttributes,
  ElementInteractivity,
  ElementVisualState,
  ElementRole,
  SemanticPurpose,
  AccessibilityNode,
  DetectedFramework,
  ModalInfo,
  ModalType,
  TabState,
} from './types';

const logger = createModuleLogger('DOMSerializer');

// ============================================================================
// DOM Extraction Scripts (injected into page)
// ============================================================================

/**
 * Script injected into page to extract interactive elements
 */
const DOM_EXTRACTION_SCRIPT = `
(function() {
  const MAX_ELEMENTS = 150;
  const MAX_TEXT_LENGTH = 200;
  
  // Interactable element selectors
  const INTERACTIVE_SELECTORS = [
    'a[href]',
    'button',
    'input',
    'select',
    'textarea',
    '[role="button"]',
    '[role="link"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="switch"]',
    '[role="tab"]',
    '[role="menuitem"]',
    '[role="option"]',
    '[role="treeitem"]',
    '[role="combobox"]',
    '[role="textbox"]',
    '[role="searchbox"]',
    '[role="slider"]',
    '[role="spinbutton"]',
    '[onclick]',
    '[tabindex]',
    '[contenteditable="true"]',
    'label[for]',
    'summary',
    'details',
    '[data-action]',
    '[data-click]',
  ].join(', ');
  
  // Get computed styles and visibility
  function getVisibility(el) {
    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    
    return {
      isVisible: style.display !== 'none' && 
                 style.visibility !== 'hidden' && 
                 style.opacity !== '0' &&
                 rect.width > 0 && 
                 rect.height > 0,
      isInViewport: rect.top < window.innerHeight && 
                    rect.bottom > 0 && 
                    rect.left < window.innerWidth && 
                    rect.right > 0,
      opacity: parseFloat(style.opacity),
      zIndex: parseInt(style.zIndex) || 0,
    };
  }
  
  // Get element's accessible name
  function getAccessibleName(el) {
    // Priority: aria-label > aria-labelledby > explicit label > title > text content
    if (el.getAttribute('aria-label')) return el.getAttribute('aria-label');
    
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const labelEl = document.getElementById(labelledBy);
      if (labelEl) return labelEl.textContent?.trim();
    }
    
    // Check for associated label
    if (el.id) {
      const label = document.querySelector('label[for="' + el.id + '"]');
      if (label) return label.textContent?.trim();
    }
    
    if (el.getAttribute('title')) return el.getAttribute('title');
    if (el.getAttribute('placeholder')) return el.getAttribute('placeholder');
    
    // For buttons and links, get text content
    if (['BUTTON', 'A'].includes(el.tagName) || el.getAttribute('role') === 'button') {
      const text = el.textContent?.trim();
      if (text && text.length <= MAX_TEXT_LENGTH) return text;
    }
    
    return null;
  }
  
  // Infer semantic role from element
  function inferRole(el) {
    const tag = el.tagName.toLowerCase();
    const type = el.getAttribute('type')?.toLowerCase();
    const role = el.getAttribute('role');
    
    // Explicit ARIA role takes precedence
    if (role) return role;
    
    // Infer from tag and type
    switch (tag) {
      case 'button': return 'button';
      case 'a': return 'link';
      case 'input':
        switch (type) {
          case 'button':
          case 'submit':
          case 'reset': return 'button';
          case 'checkbox': return 'checkbox';
          case 'radio': return 'radio';
          case 'range': return 'slider';
          case 'number': return 'spinbutton';
          case 'search': return 'searchbox';
          default: return 'textbox';
        }
      case 'select': return 'combobox';
      case 'textarea': return 'textbox';
      case 'nav': return 'navigation';
      case 'main': return 'main';
      case 'header': return 'header';
      case 'footer': return 'footer';
      case 'article': return 'article';
      case 'section': return 'section';
      case 'form': return 'form';
      case 'img': return 'image';
      case 'table': return 'table';
      case 'ul':
      case 'ol': return 'list';
      case 'li': return 'listitem';
      case 'option': return 'option';
      case 'h1':
      case 'h2':
      case 'h3':
      case 'h4':
      case 'h5':
      case 'h6': return 'heading';
      case 'p': return 'paragraph';
      default: return 'generic';
    }
  }
  
  // Infer semantic purpose from element context
  function inferSemanticPurpose(el, text) {
    const normalizedText = (text || '').toLowerCase();
    const id = (el.id || '').toLowerCase();
    const className = (el.className || '').toLowerCase();
    const name = (el.name || '').toLowerCase();
    const type = (el.type || '').toLowerCase();
    const href = (el.href || '').toLowerCase();
    
    // Login/auth detection
    if (type === 'password' || 
        /log.?in|sign.?in|auth/i.test(normalizedText + id + className + name)) {
      return 'login';
    }
    
    if (/sign.?up|register|create.?account/i.test(normalizedText + id + className)) {
      return 'signup';
    }
    
    if (/log.?out|sign.?out/i.test(normalizedText + id + className)) {
      return 'logout';
    }
    
    // Search
    if (type === 'search' || /search/i.test(normalizedText + id + className + name)) {
      return 'search';
    }
    
    // Cart/checkout
    if (/cart|basket/i.test(normalizedText + id + className + href)) {
      return 'cart';
    }
    
    if (/checkout|pay|purchase|buy/i.test(normalizedText + id + className)) {
      return 'checkout';
    }
    
    if (/payment|credit.?card|billing/i.test(normalizedText + id + className)) {
      return 'payment';
    }
    
    // Common actions
    if (/submit|send/i.test(normalizedText) || type === 'submit') {
      return 'submit';
    }
    
    if (/cancel|close|dismiss/i.test(normalizedText)) {
      return 'close';
    }
    
    if (/delete|remove|trash/i.test(normalizedText + id + className)) {
      return 'delete';
    }
    
    if (/edit|modify/i.test(normalizedText + id + className)) {
      return 'edit';
    }
    
    if (/save/i.test(normalizedText)) {
      return 'save';
    }
    
    if (/download/i.test(normalizedText + id + className)) {
      return 'download';
    }
    
    if (/upload/i.test(normalizedText + id + className) || type === 'file') {
      return 'upload';
    }
    
    // Cookie consent
    if (/cookie|consent|gdpr|privacy/i.test(id + className)) {
      return 'cookie-consent';
    }
    
    // Newsletter
    if (/newsletter|subscribe|email.?list/i.test(id + className)) {
      return 'newsletter';
    }
    
    // Navigation
    if (el.tagName === 'NAV' || /nav|menu/i.test(id + className)) {
      return 'navigation';
    }
    
    // Settings/profile
    if (/setting|preference|config/i.test(normalizedText + id + className)) {
      return 'settings';
    }
    
    if (/profile|account/i.test(normalizedText + id + className)) {
      return 'profile';
    }
    
    return 'unknown';
  }
  
  // Get unique CSS selector for element
  function getUniqueSelector(el) {
    if (el.id) return '#' + CSS.escape(el.id);
    
    // Try to build a unique selector
    let selector = el.tagName.toLowerCase();
    
    // Add distinguishing class
    if (el.className && typeof el.className === 'string') {
      const classes = el.className.trim().split(/\\s+/)
        .filter(c => c && !c.match(/^(ng-|_|css-|sc-)/))
        .slice(0, 2);
      if (classes.length) {
        selector += '.' + classes.map(c => CSS.escape(c)).join('.');
      }
    }
    
    // Add type for inputs
    if (el.type) selector += '[type="' + el.type + '"]';
    
    // Add name attribute
    if (el.name) selector += '[name="' + CSS.escape(el.name) + '"]';
    
    // Check if unique
    const matches = document.querySelectorAll(selector);
    if (matches.length === 1) return selector;
    
    // Add nth-child if needed
    let parent = el.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children);
      const index = siblings.indexOf(el) + 1;
      selector += ':nth-child(' + index + ')';
    }
    
    return selector;
  }
  
  // Get XPath for element
  function getXPath(el) {
    if (el.id) return '//*[@id="' + el.id + '"]';
    
    const parts = [];
    let current = el;
    
    while (current && current.nodeType === Node.ELEMENT_NODE) {
      let index = 1;
      let sibling = current.previousElementSibling;
      
      while (sibling) {
        if (sibling.tagName === current.tagName) index++;
        sibling = sibling.previousElementSibling;
      }
      
      const tagName = current.tagName.toLowerCase();
      parts.unshift(tagName + '[' + index + ']');
      current = current.parentElement;
    }
    
    return '/' + parts.join('/');
  }
  
  // Extract data attributes
  function getDataAttributes(el) {
    const data = {};
    for (const attr of el.attributes) {
      if (attr.name.startsWith('data-')) {
        data[attr.name] = attr.value;
      }
    }
    return Object.keys(data).length > 0 ? data : undefined;
  }
  
  // Main extraction
  const elements = [];
  const allElements = document.querySelectorAll(INTERACTIVE_SELECTORS);
  
  let index = 1;
  for (const el of allElements) {
    if (index > MAX_ELEMENTS) break;
    
    const visibility = getVisibility(el);
    if (!visibility.isVisible) continue;
    
    const rect = el.getBoundingClientRect();
    const text = getAccessibleName(el) || el.textContent?.trim().substring(0, MAX_TEXT_LENGTH) || '';
    
    // Skip empty elements (unless they're inputs)
    if (!text && !['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)) {
      // Check for meaningful attributes
      if (!el.getAttribute('aria-label') && !el.getAttribute('title')) {
        continue;
      }
    }
    
    const role = inferRole(el);
    const semanticPurpose = inferSemanticPurpose(el, text);
    
    elements.push({
      index: index,
      tag: el.tagName.toLowerCase(),
      role: role,
      text: text,
      value: el.value || undefined,
      placeholder: el.placeholder || undefined,
      ariaLabel: el.getAttribute('aria-label') || undefined,
      selector: getUniqueSelector(el),
      xpath: getXPath(el),
      bounds: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        isInViewport: visibility.isInViewport,
        isVisible: visibility.isVisible,
      },
      center: {
        x: Math.round(rect.x + rect.width / 2),
        y: Math.round(rect.y + rect.height / 2),
      },
      attributes: {
        id: el.id || undefined,
        className: el.className || undefined,
        name: el.name || undefined,
        type: el.type || undefined,
        href: el.href || undefined,
        src: el.src || undefined,
        alt: el.alt || undefined,
        title: el.title || undefined,
        disabled: el.disabled || undefined,
        readonly: el.readOnly || undefined,
        required: el.required || undefined,
        checked: el.checked || undefined,
        selected: el.selected || undefined,
        dataAttributes: getDataAttributes(el),
      },
      interactivity: {
        isClickable: true,
        isTypeable: ['INPUT', 'TEXTAREA'].includes(el.tagName) || el.contentEditable === 'true',
        isScrollable: el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth,
        isDraggable: el.draggable || false,
        isSelectable: el.tagName === 'SELECT',
        isExpandable: el.tagName === 'DETAILS' || el.getAttribute('aria-expanded') !== null,
        isCheckable: el.type === 'checkbox' || el.type === 'radio' || role === 'checkbox' || role === 'radio',
        hasFocus: document.activeElement === el,
        isHovered: false,
      },
      visualState: {
        isVisible: visibility.isVisible,
        isEnabled: !el.disabled,
        isSelected: el.selected || el.getAttribute('aria-selected') === 'true',
        isExpanded: el.open || el.getAttribute('aria-expanded') === 'true',
        isLoading: el.getAttribute('aria-busy') === 'true',
        opacity: visibility.opacity,
        zIndex: visibility.zIndex,
      },
      semanticPurpose: semanticPurpose !== 'unknown' ? semanticPurpose : undefined,
      depth: getDepth(el),
    });
    
    index++;
  }
  
  function getDepth(el) {
    let depth = 0;
    let current = el;
    while (current.parentElement) {
      depth++;
      current = current.parentElement;
    }
    return depth;
  }
  
  return elements;
})()
`;

/**
 * Script to detect JavaScript framework
 */
const FRAMEWORK_DETECTION_SCRIPT = `
(function() {
  // React detection
  if (window.__REACT_DEVTOOLS_GLOBAL_HOOK__ || 
      document.querySelector('[data-reactroot]') || 
      document.querySelector('[data-reactid]')) {
    const isNext = !!window.__NEXT_DATA__ || !!document.querySelector('#__next');
    return { name: 'react', isNextJs: isNext };
  }
  
  // Vue detection
  if (window.__VUE__ || window.Vue || document.querySelector('[data-v-]')) {
    const isNuxt = !!window.__NUXT__ || !!document.querySelector('#__nuxt');
    return { name: 'vue', isNuxt: isNuxt };
  }
  
  // Angular detection
  if (window.ng || document.querySelector('[ng-app]') || document.querySelector('[ng-version]')) {
    const version = document.querySelector('[ng-version]')?.getAttribute('ng-version');
    return { name: 'angular', version: version };
  }
  
  // Svelte detection
  if (document.querySelector('[class*="svelte-"]')) {
    const isSvelteKit = !!document.querySelector('#svelte');
    return { name: 'svelte', isSvelteKit: isSvelteKit };
  }
  
  // jQuery detection
  if (window.jQuery || window.$) {
    return { name: 'jquery', version: window.jQuery?.fn?.jquery };
  }
  
  return { name: 'vanilla' };
})()
`;

/**
 * Script to detect modals and popups
 */
const MODAL_DETECTION_SCRIPT = `
(function() {
  const modals = [];
  
  // Common modal selectors
  const modalSelectors = [
    '[role="dialog"]',
    '[role="alertdialog"]',
    '[aria-modal="true"]',
    '.modal',
    '.popup',
    '.overlay',
    '[class*="modal"]',
    '[class*="popup"]',
    '[class*="dialog"]',
    '[class*="overlay"]',
    '[class*="cookie"]',
    '[class*="consent"]',
    '[class*="gdpr"]',
    '[class*="newsletter"]',
    '[id*="modal"]',
    '[id*="popup"]',
    '[id*="cookie"]',
  ];
  
  const elements = document.querySelectorAll(modalSelectors.join(', '));
  
  for (const el of elements) {
    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    
    // Skip hidden elements
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      continue;
    }
    
    // Skip very small elements
    if (rect.width < 100 || rect.height < 50) continue;
    
    // Determine modal type
    let type = 'unknown';
    const text = (el.textContent || '').toLowerCase();
    const className = (el.className || '').toLowerCase();
    const id = (el.id || '').toLowerCase();
    
    if (/cookie|consent|gdpr/i.test(className + id + text)) type = 'cookie-consent';
    else if (/newsletter|subscribe|email/i.test(className + id + text)) type = 'newsletter-popup';
    else if (/login|sign.?in/i.test(className + id + text)) type = 'login-modal';
    else if (/pay|subscribe|premium/i.test(text)) type = 'paywall';
    else if (el.getAttribute('role') === 'alertdialog') type = 'alert';
    else if (el.getAttribute('role') === 'dialog') type = 'dialog';
    
    // Find action buttons
    const buttons = el.querySelectorAll('button, [role="button"], a.btn, input[type="submit"]');
    let primaryIndex = null;
    let dismissIndex = null;
    
    for (const btn of buttons) {
      const btnText = (btn.textContent || '').toLowerCase();
      if (/accept|agree|ok|yes|continue|got it/i.test(btnText)) {
        // This would need to map to our element index - placeholder
        primaryIndex = 'primary';
      }
      if (/close|dismiss|no|cancel|reject|x/i.test(btnText) || btn.className.includes('close')) {
        dismissIndex = 'dismiss';
      }
    }
    
    modals.push({
      type: type,
      title: el.querySelector('h1, h2, h3, [class*="title"]')?.textContent?.trim(),
      content: text.substring(0, 200),
      bounds: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        isInViewport: true,
        isVisible: true,
      },
      isBlocking: style.position === 'fixed' || style.position === 'absolute',
    });
  }
  
  return modals;
})()
`;

/**
 * Script to get accessibility tree (simplified)
 */
const ACCESSIBILITY_TREE_SCRIPT = `
(function() {
  const tree = [];
  const MAX_NODES = 100;
  
  function processNode(node, depth = 0) {
    if (tree.length >= MAX_NODES) return;
    if (depth > 10) return;
    
    const role = node.getAttribute?.('role') || getImplicitRole(node);
    if (!role || role === 'none' || role === 'presentation') return;
    
    const name = node.getAttribute?.('aria-label') || 
                 node.getAttribute?.('title') || 
                 (node.textContent?.trim().substring(0, 100));
    
    if (!name && !['navigation', 'main', 'header', 'footer', 'form'].includes(role)) return;
    
    const rect = node.getBoundingClientRect?.();
    
    tree.push({
      nodeId: 'ax-' + tree.length,
      role: role,
      name: name,
      value: node.value,
      properties: [
        { name: 'focusable', value: node.tabIndex >= 0 },
        { name: 'disabled', value: !!node.disabled },
      ],
      bounds: rect ? {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      } : undefined,
    });
    
    if (node.children) {
      for (const child of node.children) {
        processNode(child, depth + 1);
      }
    }
  }
  
  function getImplicitRole(el) {
    if (!el.tagName) return null;
    const tag = el.tagName.toLowerCase();
    switch (tag) {
      case 'button': return 'button';
      case 'a': return el.href ? 'link' : null;
      case 'input': return 'textbox';
      case 'nav': return 'navigation';
      case 'main': return 'main';
      case 'header': return 'banner';
      case 'footer': return 'contentinfo';
      case 'form': return 'form';
      default: return null;
    }
  }
  
  processNode(document.body);
  return tree;
})()
`;

// ============================================================================
// DOM Serializer Class
// ============================================================================

export class DOMSerializer {
  private page: any; // Puppeteer page

  constructor(page: any) {
    this.page = page;
  }

  /**
   * Extract complete browser state for LLM context
   */
  async extractBrowserState(includeScreenshot = false): Promise<BrowserState> {
    const startTime = Date.now();

    try {
      // Execute all extraction scripts in parallel
      const [elements, framework, modals, accessibilityTree, pageInfo, scrollInfo] =
        await Promise.all([
          this.page.evaluate(DOM_EXTRACTION_SCRIPT),
          this.page.evaluate(FRAMEWORK_DETECTION_SCRIPT),
          this.page.evaluate(MODAL_DETECTION_SCRIPT),
          this.page.evaluate(ACCESSIBILITY_TREE_SCRIPT),
          this.getPageInfo(),
          this.getScrollInfo(),
        ]);

      // Get focused element
      const focusedIndex = await this.page.evaluate(() => {
        const focused = document.activeElement;
        if (!focused || focused === document.body) return null;
        // Would need to match to our indexed elements
        return null;
      });

      // Optional screenshot
      let screenshot: string | undefined;
      if (includeScreenshot) {
        const buffer = await this.page.screenshot({ encoding: 'base64' });
        screenshot = buffer as string;
      }

      // Get tab info
      const tabInfo = await this.getTabInfo();

      const state: BrowserState = {
        url: pageInfo.url,
        title: pageInfo.title,
        viewport: pageInfo.viewport,
        screenshot,
        elements: elements as IndexedElement[],
        accessibilityTree: accessibilityTree as AccessibilityNode[],
        loadState: (await this.page.evaluate(
          () => document.readyState
        )) as BrowserState['loadState'],
        detectedFramework: framework as DetectedFramework,
        activeModals: modals as ModalInfo[],
        scrollPosition: scrollInfo.position,
        scrollDimensions: scrollInfo.dimensions,
        focusedElementIndex: focusedIndex,
        tabInfo,
        timestamp: Date.now(),
      };

      logger.debug('Extracted browser state', {
        elementCount: elements.length,
        modalCount: modals.length,
        framework: framework?.name,
        durationMs: Date.now() - startTime,
      });

      return state;
    } catch (error) {
      logger.error('Failed to extract browser state', { error });
      throw error;
    }
  }

  /**
   * Get element by index
   */
  async getElementByIndex(index: number): Promise<IndexedElement | null> {
    const state = await this.extractBrowserState(false);
    return state.elements.find((el) => el.index === index) || null;
  }

  /**
   * Find element by natural language description
   */
  async findElementByDescription(description: string): Promise<IndexedElement | null> {
    const state = await this.extractBrowserState(false);
    const normalizedDesc = description.toLowerCase();

    // Score each element based on match quality
    let bestMatch: IndexedElement | null = null;
    let bestScore = 0;

    for (const element of state.elements) {
      let score = 0;

      // Check text match
      if (element.text?.toLowerCase().includes(normalizedDesc)) {
        score += 10;
      }

      // Check aria-label match
      if (element.ariaLabel?.toLowerCase().includes(normalizedDesc)) {
        score += 8;
      }

      // Check placeholder match
      if (element.placeholder?.toLowerCase().includes(normalizedDesc)) {
        score += 6;
      }

      // Check semantic purpose match
      if (element.semanticPurpose && normalizedDesc.includes(element.semanticPurpose)) {
        score += 5;
      }

      // Check role match
      if (normalizedDesc.includes(element.role)) {
        score += 3;
      }

      // Boost visible and in-viewport elements
      if (element.bounds.isInViewport) {
        score += 2;
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = element;
      }
    }

    return bestMatch;
  }

  /**
   * Get elements filtered by role
   */
  async getElementsByRole(role: ElementRole): Promise<IndexedElement[]> {
    const state = await this.extractBrowserState(false);
    return state.elements.filter((el) => el.role === role);
  }

  /**
   * Get elements filtered by semantic purpose
   */
  async getElementsByPurpose(purpose: SemanticPurpose): Promise<IndexedElement[]> {
    const state = await this.extractBrowserState(false);
    return state.elements.filter((el) => el.semanticPurpose === purpose);
  }

  /**
   * Serialize state for LLM context (compact format)
   */
  serializeForLLM(state: BrowserState): string {
    const lines: string[] = [];

    lines.push(`# Page: ${state.title}`);
    lines.push(`URL: ${state.url}`);
    lines.push(`Viewport: ${state.viewport.width}x${state.viewport.height}`);
    lines.push(`Load state: ${state.loadState}`);

    if (state.detectedFramework) {
      lines.push(`Framework: ${state.detectedFramework.name}`);
    }

    if (state.activeModals.length > 0) {
      lines.push(`\n## Active Modals (${state.activeModals.length})`);
      for (const modal of state.activeModals) {
        lines.push(`- ${modal.type}: "${modal.title || 'Untitled'}"`);
      }
    }

    lines.push(`\n## Interactive Elements (${state.elements.length})`);
    lines.push('Format: [index] role "text" (semantic purpose)');
    lines.push('');

    for (const el of state.elements) {
      const inViewport = el.bounds.isInViewport ? '' : ' [offscreen]';
      const purpose = el.semanticPurpose ? ` (${el.semanticPurpose})` : '';
      const value = el.value ? ` value="${el.value}"` : '';
      const placeholder = el.placeholder ? ` placeholder="${el.placeholder}"` : '';

      lines.push(
        `[${el.index}] ${el.role} "${el.text?.substring(0, 50) || ''}"${value}${placeholder}${purpose}${inViewport}`
      );
    }

    return lines.join('\n');
  }

  /**
   * Get compact element reference for action
   */
  getElementReference(element: IndexedElement): string {
    return `[${element.index}] ${element.role} "${element.text?.substring(0, 30) || ''}"`;
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  private async getPageInfo(): Promise<{
    url: string;
    title: string;
    viewport: { width: number; height: number };
  }> {
    const [url, title, viewport] = await Promise.all([
      this.page.url(),
      this.page.title(),
      this.page.evaluate(() => ({
        width: window.innerWidth,
        height: window.innerHeight,
      })),
    ]);

    return { url, title, viewport };
  }

  private async getScrollInfo(): Promise<{
    position: { x: number; y: number };
    dimensions: { width: number; height: number };
  }> {
    return this.page.evaluate(() => ({
      position: {
        x: window.scrollX,
        y: window.scrollY,
      },
      dimensions: {
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
      },
    }));
  }

  private async getTabInfo(): Promise<TabState> {
    try {
      const target = this.page.target();
      return {
        tabId: target._targetId || 'unknown',
        index: 0,
        isActive: true,
        isPinned: false,
        isAudible: false,
        isMuted: false,
      };
    } catch {
      return {
        tabId: 'unknown',
        index: 0,
        isActive: true,
        isPinned: false,
        isAudible: false,
        isMuted: false,
      };
    }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a DOM serializer for a Puppeteer page
 */
export function createDOMSerializer(page: any): DOMSerializer {
  return new DOMSerializer(page);
}
