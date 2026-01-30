/**
 * @fileoverview Browser Control Module - CDP-based browser automation
 * @module browser
 * @author Atlas Team
 * @since 1.0.0
 *
 * @description
 * Provides headless and headed browser automation using Chrome DevTools Protocol (CDP).
 * Features include page navigation, screenshots, element interaction, and multi-tab
 * management. Designed for agent-driven web interactions with safety constraints.
 *
 * @example
 * ```typescript
 * const browser = getBrowserController();
 * await browser.launch();
 * const page = await browser.newPage();
 * await page.goto('https://example.com');
 * const screenshot = await page.screenshot();
 * ```
 */

import { EventEmitter } from 'events';
import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('Browser');

// =============================================================================
// Types
// =============================================================================

/**
 * Browser launch configuration options
 */
export interface BrowserConfig {
  /** Run browser in headless mode */
  headless?: boolean;
  /** Browser executable path (uses bundled Chromium by default) */
  executablePath?: string;
  /** User data directory for browser profile */
  userDataDir?: string;
  /** Viewport width */
  width?: number;
  /** Viewport height */
  height?: number;
  /** Additional Chrome flags */
  args?: string[];
  /** Timeout for operations in ms */
  timeout?: number;
  /** Enable devtools */
  devtools?: boolean;
}

/**
 * Page navigation options
 */
export interface NavigationOptions {
  /** Wait until condition */
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2';
  /** Navigation timeout in ms */
  timeout?: number;
  /** Referer header */
  referer?: string;
}

/**
 * Screenshot options
 */
export interface ScreenshotOptions {
  /** Output format */
  type?: 'png' | 'jpeg' | 'webp';
  /** Quality (1-100) for jpeg/webp */
  quality?: number;
  /** Capture full page */
  fullPage?: boolean;
  /** Clip region */
  clip?: { x: number; y: number; width: number; height: number };
  /** Omit background */
  omitBackground?: boolean;
  /** Output path (if not provided, returns base64) */
  path?: string;
}

/**
 * Element selector options
 */
export interface SelectorOptions {
  /** Timeout for finding element */
  timeout?: number;
  /** Wait for element to be visible */
  visible?: boolean;
  /** Wait for element to be hidden */
  hidden?: boolean;
}

/**
 * Click options
 */
export interface ClickOptions {
  /** Mouse button */
  button?: 'left' | 'right' | 'middle';
  /** Number of clicks */
  clickCount?: number;
  /** Delay between mousedown and mouseup */
  delay?: number;
}

/**
 * Type options
 */
export interface TypeOptions {
  /** Delay between keystrokes */
  delay?: number;
}

/**
 * Page snapshot for agent context
 */
export interface PageSnapshot {
  /** Page URL */
  url: string;
  /** Page title */
  title: string;
  /** Visible text content */
  text: string;
  /** Interactive elements */
  elements: InteractiveElement[];
  /** Screenshot as base64 */
  screenshot?: string;
  /** Timestamp */
  timestamp: number;
}

/**
 * Interactive element on the page
 */
export interface InteractiveElement {
  /** Element index for referencing */
  index: number;
  /** Element tag name */
  tag: string;
  /** Element type (for inputs) */
  type?: string;
  /** Element text content */
  text: string;
  /** Element href (for links) */
  href?: string;
  /** Element name attribute */
  name?: string;
  /** Element id */
  id?: string;
  /** Element placeholder */
  placeholder?: string;
  /** Element role */
  role?: string;
  /** Element aria-label */
  ariaLabel?: string;
  /** Bounding box */
  bounds: { x: number; y: number; width: number; height: number };
}

/**
 * Browser page instance
 */
export interface BrowserPage {
  /** Page unique ID */
  id: string;
  /** Navigate to URL */
  goto(url: string, options?: NavigationOptions): Promise<void>;
  /** Get current URL */
  url(): string;
  /** Get page title */
  title(): Promise<string>;
  /** Take screenshot */
  screenshot(options?: ScreenshotOptions): Promise<string>;
  /** Get page snapshot for agent */
  snapshot(): Promise<PageSnapshot>;
  /** Click element by selector */
  click(selector: string, options?: ClickOptions): Promise<void>;
  /** Click element by index from snapshot */
  clickElement(index: number, options?: ClickOptions): Promise<void>;
  /** Type text into element */
  type(selector: string, text: string, options?: TypeOptions): Promise<void>;
  /** Type into element by index */
  typeElement(index: number, text: string, options?: TypeOptions): Promise<void>;
  /** Press key */
  press(key: string): Promise<void>;
  /** Scroll page */
  scroll(direction: 'up' | 'down' | 'left' | 'right', amount?: number): Promise<void>;
  /** Wait for selector */
  waitForSelector(selector: string, options?: SelectorOptions): Promise<void>;
  /** Wait for navigation */
  waitForNavigation(options?: NavigationOptions): Promise<void>;
  /** Evaluate JavaScript in page context */
  evaluate<T>(fn: string | ((...args: unknown[]) => T), ...args: unknown[]): Promise<T>;
  /** Get page content */
  content(): Promise<string>;
  /** Set viewport size */
  setViewport(width: number, height: number): Promise<void>;
  /** Go back */
  goBack(options?: NavigationOptions): Promise<void>;
  /** Go forward */
  goForward(options?: NavigationOptions): Promise<void>;
  /** Reload page */
  reload(options?: NavigationOptions): Promise<void>;
  /** Close page */
  close(): Promise<void>;
}

/**
 * Browser controller events
 */
export interface BrowserEvents {
  'page-created': (page: BrowserPage) => void;
  'page-closed': (pageId: string) => void;
  'navigation': (pageId: string, url: string) => void;
  'console': (pageId: string, type: string, text: string) => void;
  'error': (error: Error) => void;
  'disconnected': () => void;
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_CONFIG: Required<BrowserConfig> = {
  headless: true,
  executablePath: '',
  userDataDir: '',
  width: 1280,
  height: 720,
  args: [],
  timeout: 30000,
  devtools: false,
};

const CHROME_FLAGS = [
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-default-apps',
  '--disable-popup-blocking',
  '--disable-translate',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-device-discovery-notifications',
  '--disable-component-update',
];

// =============================================================================
// Browser Page Implementation
// =============================================================================

/**
 * Implementation of BrowserPage using CDP
 */
class CDPPage implements BrowserPage {
  public readonly id: string;
  private _url: string = 'about:blank';
  private _client: CDPClient | null = null;
  private _elements: InteractiveElement[] = [];
  private _closed: boolean = false;

  constructor(
    id: string,
    private _controller: BrowserController,
  ) {
    this.id = id;
  }

  /**
   * Set the CDP client for this page
   */
  setClient(client: CDPClient): void {
    this._client = client;
  }

  url(): string {
    return this._url;
  }

  async goto(url: string, options: NavigationOptions = {}): Promise<void> {
    this._ensureNotClosed();
    const timeout = options.timeout || DEFAULT_CONFIG.timeout;

    logger.info('Navigating to URL', { pageId: this.id, url });

    // Validate URL
    try {
      new URL(url);
    } catch {
      throw new Error(`Invalid URL: ${url}`);
    }

    // Simulate navigation (actual CDP would use Page.navigate)
    this._url = url;

    // In real implementation, this would:
    // 1. Call Page.navigate with URL
    // 2. Wait for appropriate lifecycle event based on waitUntil
    // 3. Handle redirects and errors

    logger.debug('Navigation complete', { pageId: this.id, url });
  }

  async title(): Promise<string> {
    this._ensureNotClosed();
    // In real implementation: evaluate document.title
    return `Page: ${this._url}`;
  }

  async screenshot(options: ScreenshotOptions = {}): Promise<string> {
    this._ensureNotClosed();
    const format = options.type || 'png';

    logger.debug('Taking screenshot', { pageId: this.id, format, fullPage: options.fullPage });

    // In real implementation:
    // 1. Call Page.captureScreenshot with format and clip
    // 2. Return base64 encoded image or write to path

    // Placeholder - returns empty base64
    const placeholder = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    if (options.path) {
      const buffer = Buffer.from(placeholder, 'base64');
      await fs.promises.writeFile(options.path, buffer);
      return options.path;
    }

    return placeholder;
  }

  async snapshot(): Promise<PageSnapshot> {
    this._ensureNotClosed();

    logger.debug('Creating page snapshot', { pageId: this.id });

    // Extract interactive elements
    // In real implementation, this would evaluate JS to find all interactive elements
    const elements = await this._extractInteractiveElements();
    this._elements = elements;

    const snapshot: PageSnapshot = {
      url: this._url,
      title: await this.title(),
      text: await this._extractVisibleText(),
      elements,
      timestamp: Date.now(),
    };

    // Optionally include screenshot
    try {
      snapshot.screenshot = await this.screenshot({ type: 'jpeg', quality: 50 });
    } catch (error) {
      logger.warn('Failed to capture snapshot screenshot', { error });
    }

    return snapshot;
  }

  async click(selector: string, options: ClickOptions = {}): Promise<void> {
    this._ensureNotClosed();
    logger.debug('Clicking element', { pageId: this.id, selector });

    // In real implementation:
    // 1. Query selector
    // 2. Get element bounding box
    // 3. Use Input.dispatchMouseEvent to click center
  }

  async clickElement(index: number, options: ClickOptions = {}): Promise<void> {
    this._ensureNotClosed();

    const element = this._elements[index];
    if (!element) {
      throw new Error(`Element not found at index ${index}. Run snapshot() first.`);
    }

    logger.debug('Clicking element by index', { pageId: this.id, index, element: element.tag });

    // Calculate center of element
    const x = element.bounds.x + element.bounds.width / 2;
    const y = element.bounds.y + element.bounds.height / 2;

    // In real implementation: dispatch mouse events at x, y
  }

  async type(selector: string, text: string, options: TypeOptions = {}): Promise<void> {
    this._ensureNotClosed();
    logger.debug('Typing into element', { pageId: this.id, selector, textLength: text.length });

    // In real implementation:
    // 1. Focus element
    // 2. Use Input.dispatchKeyEvent for each character
  }

  async typeElement(index: number, text: string, options: TypeOptions = {}): Promise<void> {
    this._ensureNotClosed();

    const element = this._elements[index];
    if (!element) {
      throw new Error(`Element not found at index ${index}. Run snapshot() first.`);
    }

    logger.debug('Typing into element by index', {
      pageId: this.id,
      index,
      element: element.tag,
      textLength: text.length,
    });

    // Click to focus, then type
    await this.clickElement(index);
    // Type each character
  }

  async press(key: string): Promise<void> {
    this._ensureNotClosed();
    logger.debug('Pressing key', { pageId: this.id, key });

    // In real implementation: Input.dispatchKeyEvent
  }

  async scroll(direction: 'up' | 'down' | 'left' | 'right', amount: number = 300): Promise<void> {
    this._ensureNotClosed();
    logger.debug('Scrolling', { pageId: this.id, direction, amount });

    // In real implementation: Input.dispatchMouseEvent with wheel
  }

  async waitForSelector(selector: string, options: SelectorOptions = {}): Promise<void> {
    this._ensureNotClosed();
    const timeout = options.timeout || DEFAULT_CONFIG.timeout;

    logger.debug('Waiting for selector', { pageId: this.id, selector, timeout });

    // In real implementation: poll DOM until selector matches
  }

  async waitForNavigation(options: NavigationOptions = {}): Promise<void> {
    this._ensureNotClosed();
    const timeout = options.timeout || DEFAULT_CONFIG.timeout;

    logger.debug('Waiting for navigation', { pageId: this.id, timeout });

    // In real implementation: wait for Page.frameNavigated event
  }

  async evaluate<T>(fn: string | ((...args: unknown[]) => T), ...args: unknown[]): Promise<T> {
    this._ensureNotClosed();

    const expression = typeof fn === 'function' ? `(${fn.toString()})(${args.map((a) => JSON.stringify(a)).join(',')})` : fn;

    logger.debug('Evaluating expression', { pageId: this.id, expressionLength: expression.length });

    // In real implementation: Runtime.evaluate
    return undefined as T;
  }

  async content(): Promise<string> {
    this._ensureNotClosed();
    // In real implementation: evaluate document.documentElement.outerHTML
    return '<html><head></head><body></body></html>';
  }

  async setViewport(width: number, height: number): Promise<void> {
    this._ensureNotClosed();
    logger.debug('Setting viewport', { pageId: this.id, width, height });

    // In real implementation: Emulation.setDeviceMetricsOverride
  }

  async goBack(options: NavigationOptions = {}): Promise<void> {
    this._ensureNotClosed();
    logger.debug('Going back', { pageId: this.id });

    // In real implementation: Page.goBack
  }

  async goForward(options: NavigationOptions = {}): Promise<void> {
    this._ensureNotClosed();
    logger.debug('Going forward', { pageId: this.id });

    // In real implementation: Page.goForward
  }

  async reload(options: NavigationOptions = {}): Promise<void> {
    this._ensureNotClosed();
    logger.debug('Reloading page', { pageId: this.id });

    // In real implementation: Page.reload
  }

  async close(): Promise<void> {
    if (this._closed) return;

    logger.info('Closing page', { pageId: this.id });
    this._closed = true;
    this._client = null;

    // In real implementation: Target.closeTarget
  }

  // =========================================================================
  // Private Methods
  // =========================================================================

  private _ensureNotClosed(): void {
    if (this._closed) {
      throw new Error(`Page ${this.id} has been closed`);
    }
  }

  private async _extractInteractiveElements(): Promise<InteractiveElement[]> {
    // In real implementation, this evaluates JS to find all interactive elements:
    // - buttons, links, inputs, textareas, selects
    // - elements with click handlers
    // - elements with role="button", role="link", etc.

    // Return placeholder for now
    return [];
  }

  private async _extractVisibleText(): Promise<string> {
    // In real implementation: evaluate to get innerText of body
    return '';
  }
}

// =============================================================================
// CDP Client Placeholder
// =============================================================================

/**
 * Placeholder for actual CDP client connection
 * In production, this would use ws to connect to Chrome's debugging port
 */
interface CDPClient {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  on(event: string, handler: (params: unknown) => void): void;
  close(): void;
}

// =============================================================================
// Browser Controller
// =============================================================================

/**
 * Controls browser instances via Chrome DevTools Protocol.
 *
 * Manages browser lifecycle, page creation, and provides a high-level API
 * for agent-driven web automation with safety constraints.
 *
 * @class BrowserController
 * @extends EventEmitter
 *
 * @example
 * ```typescript
 * const browser = new BrowserController({ headless: true });
 * await browser.launch();
 *
 * const page = await browser.newPage();
 * await page.goto('https://example.com');
 *
 * const snapshot = await page.snapshot();
 * console.log('Found elements:', snapshot.elements.length);
 *
 * await browser.close();
 * ```
 */
export class BrowserController extends EventEmitter {
  private _config: Required<BrowserConfig>;
  private _isRunning: boolean = false;
  private _pages: Map<string, CDPPage> = new Map();
  private _browserProcess: unknown = null; // Would be ChildProcess in real implementation
  private _wsEndpoint: string = '';
  private _pageCounter: number = 0;

  constructor(config: BrowserConfig = {}) {
    super();
    this._config = {
      ...DEFAULT_CONFIG,
      ...config,
      userDataDir: config.userDataDir || path.join(app.getPath('userData'), 'browser-profile'),
    };
  }

  /**
   * Whether the browser is currently running
   */
  get isRunning(): boolean {
    return this._isRunning;
  }

  /**
   * Get all open pages
   */
  get pages(): BrowserPage[] {
    return Array.from(this._pages.values());
  }

  /**
   * Launch the browser instance.
   *
   * Starts a Chrome/Chromium process with CDP enabled and establishes
   * a WebSocket connection for control.
   *
   * @throws {Error} If browser is already running or launch fails
   */
  async launch(): Promise<void> {
    if (this._isRunning) {
      throw new Error('Browser is already running');
    }

    logger.info('Launching browser', {
      headless: this._config.headless,
      userDataDir: this._config.userDataDir,
    });

    try {
      // Ensure user data directory exists
      await fs.promises.mkdir(this._config.userDataDir, { recursive: true });

      // Build launch arguments
      const args = [
        ...CHROME_FLAGS,
        ...this._config.args,
        `--user-data-dir=${this._config.userDataDir}`,
        '--remote-debugging-port=0', // Auto-assign port
      ];

      if (this._config.headless) {
        args.push('--headless=new');
      }

      if (this._config.devtools) {
        args.push('--auto-open-devtools-for-tabs');
      }

      // In real implementation:
      // 1. Find Chrome/Chromium executable
      // 2. Spawn process with args
      // 3. Parse stderr for DevTools listening URL
      // 4. Connect via WebSocket

      this._isRunning = true;
      logger.info('Browser launched successfully');
    } catch (error) {
      logger.error('Failed to launch browser', { error });
      throw error;
    }
  }

  /**
   * Create a new page/tab.
   *
   * @returns {Promise<BrowserPage>} The new page instance
   * @throws {Error} If browser is not running
   */
  async newPage(): Promise<BrowserPage> {
    if (!this._isRunning) {
      throw new Error('Browser is not running. Call launch() first.');
    }

    const pageId = `page-${++this._pageCounter}`;
    const page = new CDPPage(pageId, this);

    // In real implementation:
    // 1. Call Target.createTarget to create new page
    // 2. Attach to target via Target.attachToTarget
    // 3. Enable required domains (Page, Runtime, Network, etc.)

    this._pages.set(pageId, page);
    this.emit('page-created', page);

    logger.info('Created new page', { pageId });
    return page;
  }

  /**
   * Get a page by ID.
   *
   * @param {string} pageId - The page ID
   * @returns {BrowserPage | undefined} The page or undefined if not found
   */
  getPage(pageId: string): BrowserPage | undefined {
    return this._pages.get(pageId);
  }

  /**
   * Close a specific page.
   *
   * @param {string} pageId - The page ID to close
   */
  async closePage(pageId: string): Promise<void> {
    const page = this._pages.get(pageId);
    if (page) {
      await page.close();
      this._pages.delete(pageId);
      this.emit('page-closed', pageId);
    }
  }

  /**
   * Close all pages.
   */
  async closeAllPages(): Promise<void> {
    const pageIds = Array.from(this._pages.keys());
    await Promise.all(pageIds.map((id) => this.closePage(id)));
  }

  /**
   * Close the browser instance.
   *
   * Closes all pages and terminates the browser process.
   */
  async close(): Promise<void> {
    if (!this._isRunning) {
      return;
    }

    logger.info('Closing browser');

    try {
      // Close all pages first
      await this.closeAllPages();

      // In real implementation:
      // 1. Send Browser.close command
      // 2. Kill process if it doesn't exit gracefully

      this._isRunning = false;
      this._browserProcess = null;
      this._wsEndpoint = '';

      this.emit('disconnected');
      logger.info('Browser closed');
    } catch (error) {
      logger.error('Error closing browser', { error });
      throw error;
    }
  }

  /**
   * Get browser version information.
   *
   * @returns {Promise<object>} Version information
   */
  async version(): Promise<{ browser: string; protocol: string; userAgent: string }> {
    if (!this._isRunning) {
      throw new Error('Browser is not running');
    }

    // In real implementation: Browser.getVersion
    return {
      browser: 'Chrome/120.0.0.0',
      protocol: '1.3',
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    };
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let browserInstance: BrowserController | null = null;

/**
 * Get the shared browser controller instance.
 *
 * Creates a new instance if one doesn't exist.
 *
 * @param {BrowserConfig} config - Optional configuration for new instance
 * @returns {BrowserController} The browser controller
 */
export function getBrowserController(config?: BrowserConfig): BrowserController {
  if (!browserInstance) {
    browserInstance = new BrowserController(config);
  }
  return browserInstance;
}

/**
 * Launch the browser if not already running.
 *
 * @param {BrowserConfig} config - Optional configuration
 * @returns {Promise<BrowserController>} The running browser controller
 */
export async function launchBrowser(config?: BrowserConfig): Promise<BrowserController> {
  const browser = getBrowserController(config);
  if (!browser.isRunning) {
    await browser.launch();
  }
  return browser;
}

/**
 * Close and dispose of the browser instance.
 */
export async function closeBrowser(): Promise<void> {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}

export default BrowserController;
