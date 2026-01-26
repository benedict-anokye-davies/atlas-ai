/**
 * Multi-Tab Orchestration
 *
 * Manage multiple browser tabs simultaneously for complex workflows.
 * Enables parallel browsing, cross-tab data extraction, and coordinated actions.
 *
 * @module agent/browser-agent/multi-tab
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../../utils/logger';
import { BrowserState, IndexedElement } from './types';
import { DOMSerializer } from './dom-serializer';
import { ElementGrounding } from './element-grounding';

const logger = createModuleLogger('MultiTabOrchestration');

// ============================================================================
// Types
// ============================================================================

export interface TabInfo {
  id: string;
  url: string;
  title: string;
  active: boolean;
  createdAt: number;
  lastAccessedAt: number;
  state?: BrowserState;
  purpose?: string;
  group?: string;
}

export interface TabGroup {
  id: string;
  name: string;
  tabs: string[];
  purpose?: string;
  createdAt: number;
}

export interface TabAction {
  type: 'navigate' | 'click' | 'type' | 'scroll' | 'extract' | 'close' | 'custom';
  tabId: string;
  payload: any;
}

export interface ParallelActionResult {
  tabId: string;
  success: boolean;
  result?: any;
  error?: string;
  duration: number;
}

export interface CrossTabData {
  sourceTabId: string;
  targetTabId: string;
  data: any;
  dataType: 'text' | 'url' | 'element' | 'json' | 'custom';
  timestamp: number;
}

// ============================================================================
// Multi-Tab Manager
// ============================================================================

export class MultiTabManager extends EventEmitter {
  private browser: any;
  private tabs: Map<string, { page: any; info: TabInfo }> = new Map();
  private groups: Map<string, TabGroup> = new Map();
  private activeTabId: string | null = null;
  private maxTabs = 10;
  private serializers: Map<string, DOMSerializer> = new Map();
  private grounders: Map<string, ElementGrounding> = new Map();
  private dataClipboard: CrossTabData[] = [];

  constructor(browser: any, options?: { maxTabs?: number }) {
    super();
    this.browser = browser;
    if (options?.maxTabs) this.maxTabs = options.maxTabs;
  }

  /**
   * Initialize manager with existing tabs
   */
  async initialize(): Promise<void> {
    const pages = await this.browser.pages();
    
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const tabId = `tab_${i}_${Date.now()}`;
      
      await this.registerTab(page, tabId, i === 0);
    }
    
    logger.info('Multi-tab manager initialized', { tabCount: this.tabs.size });
  }

  /**
   * Register a page as a managed tab
   */
  private async registerTab(page: any, tabId: string, active = false): Promise<void> {
    const url = page.url();
    const title = await page.title().catch(() => 'Untitled');
    
    const info: TabInfo = {
      id: tabId,
      url,
      title,
      active,
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
    };
    
    this.tabs.set(tabId, { page, info });
    this.serializers.set(tabId, new DOMSerializer(page));
    this.grounders.set(tabId, new ElementGrounding(page));
    
    if (active) {
      this.activeTabId = tabId;
    }
    
    // Set up event listeners
    page.on('load', () => this.onTabLoad(tabId));
    page.on('close', () => this.onTabClose(tabId));
    page.on('framenavigated', () => this.onTabNavigated(tabId));
    
    this.emit('tab-registered', info);
  }

  /**
   * Create a new tab
   */
  async createTab(options?: {
    url?: string;
    purpose?: string;
    group?: string;
    makeActive?: boolean;
  }): Promise<TabInfo> {
    if (this.tabs.size >= this.maxTabs) {
      throw new Error(`Maximum tab limit (${this.maxTabs}) reached`);
    }
    
    const page = await this.browser.newPage();
    const tabId = `tab_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    
    if (options?.url) {
      await page.goto(options.url, { waitUntil: 'networkidle2' });
    }
    
    await this.registerTab(page, tabId, options?.makeActive ?? true);
    
    const tab = this.tabs.get(tabId)!;
    tab.info.purpose = options?.purpose;
    tab.info.group = options?.group;
    
    if (options?.group) {
      this.addTabToGroup(tabId, options.group);
    }
    
    logger.info('Created new tab', { tabId, url: options?.url, purpose: options?.purpose });
    
    return tab.info;
  }

  /**
   * Switch to a specific tab
   */
  async switchToTab(tabId: string): Promise<boolean> {
    const tab = this.tabs.get(tabId);
    if (!tab) {
      logger.warn('Tab not found', { tabId });
      return false;
    }
    
    // Update active states
    for (const [id, t] of this.tabs) {
      t.info.active = id === tabId;
    }
    
    this.activeTabId = tabId;
    tab.info.lastAccessedAt = Date.now();
    
    // Bring to front
    await tab.page.bringToFront();
    
    this.emit('tab-switched', tab.info);
    return true;
  }

  /**
   * Close a tab
   */
  async closeTab(tabId: string): Promise<boolean> {
    const tab = this.tabs.get(tabId);
    if (!tab) return false;
    
    await tab.page.close();
    this.tabs.delete(tabId);
    this.serializers.delete(tabId);
    this.grounders.delete(tabId);
    
    // Remove from groups
    for (const group of this.groups.values()) {
      const idx = group.tabs.indexOf(tabId);
      if (idx >= 0) group.tabs.splice(idx, 1);
    }
    
    // Update active tab if needed
    if (this.activeTabId === tabId) {
      const remaining = Array.from(this.tabs.keys());
      this.activeTabId = remaining.length > 0 ? remaining[0] : null;
      
      if (this.activeTabId) {
        this.tabs.get(this.activeTabId)!.info.active = true;
      }
    }
    
    this.emit('tab-closed', tabId);
    logger.info('Closed tab', { tabId });
    
    return true;
  }

  /**
   * Get all tabs
   */
  getTabs(): TabInfo[] {
    return Array.from(this.tabs.values()).map((t) => t.info);
  }

  /**
   * Get active tab info
   */
  getActiveTab(): TabInfo | null {
    if (!this.activeTabId) return null;
    return this.tabs.get(this.activeTabId)?.info || null;
  }

  /**
   * Get page object for a tab
   */
  getPage(tabId: string): any | null {
    return this.tabs.get(tabId)?.page || null;
  }

  /**
   * Get DOM serializer for a tab
   */
  getSerializer(tabId: string): DOMSerializer | null {
    return this.serializers.get(tabId) || null;
  }

  /**
   * Get element grounder for a tab
   */
  getGrounder(tabId: string): ElementGrounding | null {
    return this.grounders.get(tabId) || null;
  }

  // ============================================================================
  // Tab Groups
  // ============================================================================

  /**
   * Create a tab group
   */
  createGroup(name: string, purpose?: string): TabGroup {
    const groupId = `group_${Date.now()}`;
    const group: TabGroup = {
      id: groupId,
      name,
      tabs: [],
      purpose,
      createdAt: Date.now(),
    };
    
    this.groups.set(groupId, group);
    this.emit('group-created', group);
    
    return group;
  }

  /**
   * Add a tab to a group
   */
  addTabToGroup(tabId: string, groupIdOrName: string): boolean {
    let group = this.groups.get(groupIdOrName);
    
    // Try to find by name
    if (!group) {
      for (const g of this.groups.values()) {
        if (g.name === groupIdOrName) {
          group = g;
          break;
        }
      }
    }
    
    // Create group if it doesn't exist
    if (!group) {
      group = this.createGroup(groupIdOrName);
    }
    
    if (!group.tabs.includes(tabId)) {
      group.tabs.push(tabId);
      
      // Update tab info
      const tab = this.tabs.get(tabId);
      if (tab) {
        tab.info.group = group.id;
      }
      
      this.emit('tab-grouped', { tabId, groupId: group.id });
      return true;
    }
    
    return false;
  }

  /**
   * Get tabs in a group
   */
  getGroupTabs(groupIdOrName: string): TabInfo[] {
    let group = this.groups.get(groupIdOrName);
    
    if (!group) {
      for (const g of this.groups.values()) {
        if (g.name === groupIdOrName) {
          group = g;
          break;
        }
      }
    }
    
    if (!group) return [];
    
    return group.tabs
      .map((tabId) => this.tabs.get(tabId)?.info)
      .filter((info): info is TabInfo => !!info);
  }

  /**
   * Close all tabs in a group
   */
  async closeGroup(groupIdOrName: string): Promise<number> {
    const tabs = this.getGroupTabs(groupIdOrName);
    let closed = 0;
    
    for (const tab of tabs) {
      if (await this.closeTab(tab.id)) {
        closed++;
      }
    }
    
    // Remove group
    let groupId = groupIdOrName;
    if (!this.groups.has(groupId)) {
      for (const [id, g] of this.groups) {
        if (g.name === groupIdOrName) {
          groupId = id;
          break;
        }
      }
    }
    this.groups.delete(groupId);
    
    return closed;
  }

  // ============================================================================
  // Parallel Operations
  // ============================================================================

  /**
   * Execute actions in parallel across multiple tabs
   */
  async executeParallel(actions: TabAction[]): Promise<ParallelActionResult[]> {
    const results: ParallelActionResult[] = [];
    
    const promises = actions.map(async (action) => {
      const startTime = Date.now();
      const tab = this.tabs.get(action.tabId);
      
      if (!tab) {
        return {
          tabId: action.tabId,
          success: false,
          error: 'Tab not found',
          duration: 0,
        };
      }
      
      try {
        const result = await this.executeTabAction(tab.page, action);
        return {
          tabId: action.tabId,
          success: true,
          result,
          duration: Date.now() - startTime,
        };
      } catch (error) {
        return {
          tabId: action.tabId,
          success: false,
          error: error instanceof Error ? error.message : String(error),
          duration: Date.now() - startTime,
        };
      }
    });
    
    const parallelResults = await Promise.allSettled(promises);
    
    for (const result of parallelResults) {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        results.push({
          tabId: 'unknown',
          success: false,
          error: result.reason?.message || 'Unknown error',
          duration: 0,
        });
      }
    }
    
    this.emit('parallel-execution-complete', results);
    return results;
  }

  /**
   * Execute an action on a single tab
   */
  private async executeTabAction(page: any, action: TabAction): Promise<any> {
    switch (action.type) {
      case 'navigate':
        await page.goto(action.payload.url, {
          waitUntil: action.payload.waitUntil || 'networkidle2',
        });
        return { url: page.url(), title: await page.title() };
        
      case 'click':
        if (action.payload.selector) {
          await page.click(action.payload.selector);
        } else if (action.payload.x !== undefined && action.payload.y !== undefined) {
          await page.mouse.click(action.payload.x, action.payload.y);
        }
        return { clicked: true };
        
      case 'type':
        if (action.payload.selector) {
          await page.type(action.payload.selector, action.payload.text);
        } else {
          await page.keyboard.type(action.payload.text);
        }
        return { typed: action.payload.text.length };
        
      case 'scroll':
        await page.evaluate((deltaY: number) => {
          window.scrollBy(0, deltaY);
        }, action.payload.deltaY || 500);
        return { scrolled: true };
        
      case 'extract':
        if (action.payload.selector) {
          const element = await page.$(action.payload.selector);
          if (element) {
            return await element.evaluate((el: Element) => ({
              text: el.textContent,
              html: el.innerHTML,
            }));
          }
        } else {
          // Extract full page content
          return await page.evaluate(() => ({
            text: document.body.innerText,
            html: document.body.innerHTML,
          }));
        }
        return null;
        
      case 'close':
        await page.close();
        return { closed: true };
        
      case 'custom':
        if (typeof action.payload.script === 'function') {
          return await page.evaluate(action.payload.script, action.payload.args);
        } else if (typeof action.payload.script === 'string') {
          return await page.evaluate(action.payload.script);
        }
        return null;
        
      default:
        throw new Error(`Unknown action type: ${action.type}`);
    }
  }

  /**
   * Navigate multiple tabs to different URLs in parallel
   */
  async navigateAll(
    urlMappings: Array<{ tabId: string; url: string }>
  ): Promise<ParallelActionResult[]> {
    const actions: TabAction[] = urlMappings.map((mapping) => ({
      type: 'navigate',
      tabId: mapping.tabId,
      payload: { url: mapping.url },
    }));
    
    return this.executeParallel(actions);
  }

  /**
   * Extract data from multiple tabs in parallel
   */
  async extractFromAll(
    tabIds?: string[],
    selector?: string
  ): Promise<Map<string, any>> {
    const ids = tabIds || Array.from(this.tabs.keys());
    
    const actions: TabAction[] = ids.map((tabId) => ({
      type: 'extract',
      tabId,
      payload: { selector },
    }));
    
    const results = await this.executeParallel(actions);
    
    const dataMap = new Map<string, any>();
    for (const result of results) {
      if (result.success) {
        dataMap.set(result.tabId, result.result);
      }
    }
    
    return dataMap;
  }

  // ============================================================================
  // Cross-Tab Data Transfer
  // ============================================================================

  /**
   * Copy data from one tab to clipboard
   */
  async copyFromTab(tabId: string, selector?: string): Promise<CrossTabData | null> {
    const tab = this.tabs.get(tabId);
    if (!tab) return null;
    
    let data: any;
    let dataType: CrossTabData['dataType'] = 'text';
    
    if (selector) {
      data = await tab.page.evaluate((sel: string) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        
        if (el.tagName === 'A') {
          return { text: el.textContent, href: (el as HTMLAnchorElement).href };
        }
        if (el.tagName === 'INPUT') {
          return (el as HTMLInputElement).value;
        }
        return el.textContent;
      }, selector);
      
      if (data && typeof data === 'object' && data.href) {
        dataType = 'url';
      }
    } else {
      data = await tab.page.evaluate(() => ({
        url: window.location.href,
        title: document.title,
        text: document.body.innerText.slice(0, 10000),
      }));
      dataType = 'json';
    }
    
    const crossTabData: CrossTabData = {
      sourceTabId: tabId,
      targetTabId: '', // Set when pasting
      data,
      dataType,
      timestamp: Date.now(),
    };
    
    this.dataClipboard.push(crossTabData);
    
    // Keep clipboard size manageable
    if (this.dataClipboard.length > 100) {
      this.dataClipboard = this.dataClipboard.slice(-50);
    }
    
    return crossTabData;
  }

  /**
   * Paste data to another tab
   */
  async pasteToTab(
    tabId: string,
    selector: string,
    clipboardIndex = -1
  ): Promise<boolean> {
    const tab = this.tabs.get(tabId);
    if (!tab) return false;
    
    const data = this.dataClipboard[
      clipboardIndex < 0 ? this.dataClipboard.length + clipboardIndex : clipboardIndex
    ];
    if (!data) return false;
    
    data.targetTabId = tabId;
    
    let textToType = '';
    
    switch (data.dataType) {
      case 'text':
        textToType = String(data.data);
        break;
      case 'url':
        textToType = data.data.href || data.data.text;
        break;
      case 'json':
        textToType = data.data.text || JSON.stringify(data.data);
        break;
      default:
        textToType = String(data.data);
    }
    
    await tab.page.type(selector, textToType);
    
    this.emit('cross-tab-paste', {
      source: data.sourceTabId,
      target: tabId,
      dataType: data.dataType,
    });
    
    return true;
  }

  /**
   * Get clipboard history
   */
  getClipboard(): CrossTabData[] {
    return [...this.dataClipboard];
  }

  // ============================================================================
  // State Management
  // ============================================================================

  /**
   * Get browser state for all tabs
   */
  async getAllStates(): Promise<Map<string, BrowserState>> {
    const states = new Map<string, BrowserState>();
    
    for (const [tabId, tab] of this.tabs) {
      const serializer = this.serializers.get(tabId);
      if (serializer) {
        try {
          const state = await serializer.extractBrowserState();
          tab.info.state = state;
          states.set(tabId, state);
        } catch (error) {
          logger.warn('Failed to get state for tab', { tabId, error });
        }
      }
    }
    
    return states;
  }

  /**
   * Find tabs by URL pattern
   */
  findTabsByUrl(pattern: string | RegExp): TabInfo[] {
    const regex = typeof pattern === 'string' ? new RegExp(pattern, 'i') : pattern;
    
    return Array.from(this.tabs.values())
      .filter((t) => regex.test(t.info.url))
      .map((t) => t.info);
  }

  /**
   * Find tab by purpose
   */
  findTabByPurpose(purpose: string): TabInfo | null {
    for (const tab of this.tabs.values()) {
      if (tab.info.purpose?.toLowerCase().includes(purpose.toLowerCase())) {
        return tab.info;
      }
    }
    return null;
  }

  // ============================================================================
  // Event Handlers
  // ============================================================================

  private async onTabLoad(tabId: string): Promise<void> {
    const tab = this.tabs.get(tabId);
    if (!tab) return;
    
    tab.info.url = tab.page.url();
    tab.info.title = await tab.page.title().catch(() => tab.info.title);
    tab.info.lastAccessedAt = Date.now();
    
    this.emit('tab-loaded', tab.info);
  }

  private onTabClose(tabId: string): void {
    if (this.tabs.has(tabId)) {
      this.closeTab(tabId).catch((e) => logger.error('Error closing tab', e));
    }
  }

  private async onTabNavigated(tabId: string): Promise<void> {
    const tab = this.tabs.get(tabId);
    if (!tab) return;
    
    tab.info.url = tab.page.url();
    this.emit('tab-navigated', tab.info);
  }

  // ============================================================================
  // Cleanup
  // ============================================================================

  /**
   * Close all tabs
   */
  async closeAllTabs(): Promise<void> {
    const tabIds = Array.from(this.tabs.keys());
    
    for (const tabId of tabIds) {
      await this.closeTab(tabId);
    }
    
    this.groups.clear();
    this.dataClipboard = [];
  }

  /**
   * Dispose of the manager
   */
  async dispose(): Promise<void> {
    await this.closeAllTabs();
    this.removeAllListeners();
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a multi-tab manager for a Puppeteer browser
 */
export async function createMultiTabManager(
  browser: any,
  options?: { maxTabs?: number }
): Promise<MultiTabManager> {
  const manager = new MultiTabManager(browser, options);
  await manager.initialize();
  return manager;
}
