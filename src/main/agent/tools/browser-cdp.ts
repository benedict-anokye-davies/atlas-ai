/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Atlas Desktop - Browser CDP Tools
 * Chrome DevTools Protocol-based browser automation for Brave/Chrome
 *
 * This provides direct CDP control over the browser, allowing:
 * - Launching Brave with remote debugging
 * - Connecting to existing browser instances
 * - Full page manipulation via CDP
 *
 * @module agent/tools/browser-cdp
 */

import { AgentTool, ActionResult } from '../../../shared/types/agent';
import { createModuleLogger } from '../../utils/logger';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

const logger = createModuleLogger('BrowserCDP');

// =============================================================================
// Types and Interfaces
// =============================================================================

/**
 * Tab/page information
 */
export interface TabInfo {
  id: string;
  title: string;
  url: string;
  type: string;
  active?: boolean;
}

/**
 * CDP connection state
 */
export interface CDPState {
  connected: boolean;
  port: number;
  browserPid?: number;
  currentTabId?: string;
}

/**
 * Browser launch options for CDP
 */
export interface CDPLaunchOptions {
  /** Remote debugging port (default: 9222) */
  port?: number;
  /** Browser executable path (auto-detected if not provided) */
  executablePath?: string;
  /** Start with specific URL */
  startUrl?: string;
  /** Additional browser arguments */
  args?: string[];
  /** Use existing user profile (default: true) */
  useProfile?: boolean;
  /** Headless mode (default: false for Brave) */
  headless?: boolean;
}

// =============================================================================
// Module State
// =============================================================================

let browserProcess: ChildProcess | null = null;
let puppeteerBrowser: any = null;
let currentPage: any = null;
let cdpState: CDPState = {
  connected: false,
  port: 9222,
};

// =============================================================================
// Brave Path Detection
// =============================================================================

/**
 * Common Brave paths on Windows
 */
const BRAVE_PATHS_WINDOWS = [
  path.join(
    process.env.LOCALAPPDATA || '',
    'BraveSoftware',
    'Brave-Browser',
    'Application',
    'brave.exe'
  ),
  'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
  'C:\\Program Files (x86)\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
];

/**
 * Common Chrome paths on Windows (fallback)
 */
const CHROME_PATHS_WINDOWS = [
  path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

/**
 * Find Brave browser executable for CDP
 */
export function findBravePathCDP(): string | null {
  if (process.platform === 'win32') {
    for (const browserPath of BRAVE_PATHS_WINDOWS) {
      try {
        if (fs.existsSync(browserPath)) {
          logger.debug('Found Brave at', { path: browserPath });
          return browserPath;
        }
      } catch {
        // Continue to next path
      }
    }
  }
  return null;
}

/**
 * Find Chrome browser executable (fallback) for CDP
 */
export function findChromePathCDP(): string | null {
  if (process.platform === 'win32') {
    for (const browserPath of CHROME_PATHS_WINDOWS) {
      try {
        if (fs.existsSync(browserPath)) {
          logger.debug('Found Chrome at', { path: browserPath });
          return browserPath;
        }
      } catch {
        // Continue to next path
      }
    }
  }
  return null;
}

/**
 * Find any available Chromium-based browser
 */
export function findBrowserPathCDP(): { path: string; type: 'brave' | 'chrome' } | null {
  const bravePath = findBravePathCDP();
  if (bravePath) {
    return { path: bravePath, type: 'brave' };
  }

  const chromePath = findChromePathCDP();
  if (chromePath) {
    return { path: chromePath, type: 'chrome' };
  }

  return null;
}

// =============================================================================
// Core CDP Functions
// =============================================================================

/**
 * Launch browser with remote debugging enabled
 */
export async function launchBrowserWithDebugging(
  options: CDPLaunchOptions = {}
): Promise<{ success: boolean; port: number; pid?: number; error?: string }> {
  const port = options.port || 9222;
  const headless = options.headless ?? false;
  const useProfile = options.useProfile ?? true;

  // Find browser executable
  let executablePath = options.executablePath;
  let browserType: 'brave' | 'chrome' = 'brave';

  if (!executablePath) {
    const found = findBrowserPathCDP();
    if (!found) {
      return {
        success: false,
        port,
        error: 'No Chromium-based browser found. Please install Brave or Chrome.',
      };
    }
    executablePath = found.path;
    browserType = found.type;
  }

  // Check if port is already in use (browser might already be running with debugging)
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`);
    if (response.ok) {
      logger.info('Browser already running with debugging on port', { port });
      cdpState = { connected: true, port };
      return { success: true, port };
    }
  } catch {
    // Port not in use, proceed with launch
  }

  // Build browser arguments
  const args: string[] = [
    `--remote-debugging-port=${port}`,
    '--remote-allow-origins=*',
    '--no-first-run',
    '--no-default-browser-check',
    ...(options.args || []),
  ];

  if (headless) {
    args.push('--headless=new');
  }

  // Use a separate user data directory to avoid profile lock issues
  if (!useProfile) {
    const tempDir = path.join(os.tmpdir(), `atlas-browser-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    args.push(`--user-data-dir=${tempDir}`);
  }

  // Add start URL if provided
  if (options.startUrl) {
    args.push(options.startUrl);
  }

  logger.info('Launching browser with debugging', {
    executable: executablePath,
    port,
    headless,
    browserType,
  });

  // Launch the browser process
  try {
    browserProcess = spawn(executablePath, args, {
      detached: false,
      stdio: 'ignore',
    });

    browserProcess.on('error', (err) => {
      logger.error('Browser process error', { error: err.message });
    });

    browserProcess.on('exit', (code) => {
      logger.info('Browser process exited', { code });
      browserProcess = null;
      cdpState.connected = false;
    });

    // Wait for browser to start and debugging port to be available
    const maxWaitTime = 10000;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/version`);
        if (response.ok) {
          logger.info('Browser debugging port ready', { port });
          cdpState = {
            connected: true,
            port,
            browserPid: browserProcess?.pid,
          };
          return {
            success: true,
            port,
            pid: browserProcess?.pid,
          };
        }
      } catch {
        // Not ready yet, wait and retry
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }

    return {
      success: false,
      port,
      error: 'Browser started but debugging port not available after 10s',
    };
  } catch (error) {
    const err = error as Error;
    return {
      success: false,
      port,
      error: `Failed to launch browser: ${err.message}`,
    };
  }
}

/**
 * Connect to browser via Puppeteer
 */
export async function connectToBrowser(
  port: number = 9222
): Promise<{ success: boolean; error?: string }> {
  try {
    // Dynamic import for puppeteer-core
    const puppeteer = await import('puppeteer-core');

    // Get the WebSocket debugger URL
    const response = await fetch(`http://127.0.0.1:${port}/json/version`);
    if (!response.ok) {
      return {
        success: false,
        error: `Browser not running on port ${port}. Launch it first with launchBrowserWithDebugging().`,
      };
    }

    const versionInfo = await response.json();
    const wsEndpoint = versionInfo.webSocketDebuggerUrl;

    if (!wsEndpoint) {
      return { success: false, error: 'Could not get WebSocket debugger URL' };
    }

    // Connect puppeteer
    puppeteerBrowser = await puppeteer.default.connect({
      browserWSEndpoint: wsEndpoint,
      defaultViewport: null,
    });

    // Get the first page or create one
    const pages = await puppeteerBrowser.pages();
    currentPage = pages.length > 0 ? pages[0] : await puppeteerBrowser.newPage();

    cdpState.connected = true;
    cdpState.port = port;
    cdpState.currentTabId = currentPage.target()._targetId;

    logger.info('Connected to browser via Puppeteer', {
      port,
      pageCount: pages.length,
    });

    return { success: true };
  } catch (error) {
    const err = error as Error;
    logger.error('Failed to connect to browser', { error: err.message });
    return { success: false, error: err.message };
  }
}

/**
 * Ensure we have a connection to the browser
 */
async function ensureConnection(): Promise<{ success: boolean; error?: string }> {
  if (puppeteerBrowser && currentPage) {
    try {
      // Verify connection is still alive
      await currentPage.evaluate(() => true);
      return { success: true };
    } catch {
      // Connection lost, reset
      puppeteerBrowser = null;
      currentPage = null;
    }
  }

  // Try to connect
  return await connectToBrowser(cdpState.port);
}

/**
 * Get list of all open tabs
 */
export async function getTabList(): Promise<TabInfo[]> {
  try {
    const response = await fetch(`http://127.0.0.1:${cdpState.port}/json`);
    if (!response.ok) {
      return [];
    }

    const targets = await response.json();
    return targets
      .filter((t: any) => t.type === 'page')
      .map((t: any) => ({
        id: t.id,
        title: t.title,
        url: t.url,
        type: t.type,
        active: t.id === cdpState.currentTabId,
      }));
  } catch {
    return [];
  }
}

/**
 * Navigate to URL
 */
export async function navigateTo(
  url: string,
  options: {
    waitUntil?: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2';
    timeout?: number;
  } = {}
): Promise<{ success: boolean; title?: string; error?: string }> {
  const connection = await ensureConnection();
  if (!connection.success) {
    return connection;
  }

  try {
    await currentPage.goto(url, {
      waitUntil: options.waitUntil || 'domcontentloaded',
      timeout: options.timeout || 30000,
    });

    const title = await currentPage.title();
    logger.info('Navigated to URL', { url, title });

    return { success: true, title };
  } catch (error) {
    const err = error as Error;
    return { success: false, error: err.message };
  }
}

/**
 * Get CDP state
 */
export function getCDPState(): CDPState {
  return { ...cdpState };
}

/**
 * Close browser connection (not the browser itself)
 */
export async function disconnect(): Promise<void> {
  if (puppeteerBrowser) {
    await puppeteerBrowser.disconnect();
    puppeteerBrowser = null;
    currentPage = null;
  }
  cdpState.connected = false;
  logger.info('Disconnected from browser');
}

/**
 * Close browser entirely
 */
export async function closeBrowser(): Promise<void> {
  await disconnect();

  if (browserProcess) {
    browserProcess.kill();
    browserProcess = null;
  }

  cdpState = { connected: false, port: 9222 };
  logger.info('Browser closed');
}

// =============================================================================
// T2-103: Navigation Controls
// =============================================================================

/**
 * Go back in browser history
 */
export async function goBack(): Promise<{ success: boolean; error?: string }> {
  const connection = await ensureConnection();
  if (!connection.success) return connection;

  try {
    await currentPage.goBack({ waitUntil: 'domcontentloaded' });
    return { success: true };
  } catch (error) {
    const err = error as Error;
    return { success: false, error: err.message };
  }
}

/**
 * Go forward in browser history
 */
export async function goForward(): Promise<{ success: boolean; error?: string }> {
  const connection = await ensureConnection();
  if (!connection.success) return connection;

  try {
    await currentPage.goForward({ waitUntil: 'domcontentloaded' });
    return { success: true };
  } catch (error) {
    const err = error as Error;
    return { success: false, error: err.message };
  }
}

/**
 * Reload the current page
 */
export async function reload(): Promise<{ success: boolean; error?: string }> {
  const connection = await ensureConnection();
  if (!connection.success) return connection;

  try {
    await currentPage.reload({ waitUntil: 'domcontentloaded' });
    return { success: true };
  } catch (error) {
    const err = error as Error;
    return { success: false, error: err.message };
  }
}

// =============================================================================
// T2-104: Element Interaction
// =============================================================================

/**
 * Click on an element
 */
export async function clickElement(
  selector: string,
  options: { button?: 'left' | 'right' | 'middle'; clickCount?: number; delay?: number } = {}
): Promise<{ success: boolean; error?: string }> {
  const connection = await ensureConnection();
  if (!connection.success) return connection;

  try {
    await currentPage.click(selector, {
      button: options.button || 'left',
      clickCount: options.clickCount || 1,
      delay: options.delay || 0,
    });
    logger.debug('Clicked element', { selector });
    return { success: true };
  } catch (error) {
    const err = error as Error;
    return { success: false, error: `Failed to click "${selector}": ${err.message}` };
  }
}

/**
 * Click on element containing specific text
 */
export async function clickByText(
  text: string,
  options: { exact?: boolean; tag?: string } = {}
): Promise<{ success: boolean; error?: string }> {
  const connection = await ensureConnection();
  if (!connection.success) return connection;

  try {
    const tag = options.tag || '*';
    const xpath = options.exact
      ? `//${tag}[text()="${text}"]`
      : `//${tag}[contains(text(), "${text}")]`;

    const elements = await currentPage.$x(xpath);
    if (elements.length === 0) {
      return { success: false, error: `No element found with text: "${text}"` };
    }

    await elements[0].click();
    logger.debug('Clicked element by text', { text });
    return { success: true };
  } catch (error) {
    const err = error as Error;
    return { success: false, error: err.message };
  }
}

/**
 * Hover over an element
 */
export async function hoverElement(
  selector: string
): Promise<{ success: boolean; error?: string }> {
  const connection = await ensureConnection();
  if (!connection.success) return connection;

  try {
    await currentPage.hover(selector);
    logger.debug('Hovered element', { selector });
    return { success: true };
  } catch (error) {
    const err = error as Error;
    return { success: false, error: `Failed to hover "${selector}": ${err.message}` };
  }
}

/**
 * Click at specific coordinates
 */
export async function clickAtPosition(
  x: number,
  y: number,
  options: { button?: 'left' | 'right' | 'middle' } = {}
): Promise<{ success: boolean; error?: string }> {
  const connection = await ensureConnection();
  if (!connection.success) return connection;

  try {
    await currentPage.mouse.click(x, y, { button: options.button || 'left' });
    logger.debug('Clicked at position', { x, y });
    return { success: true };
  } catch (error) {
    const err = error as Error;
    return { success: false, error: err.message };
  }
}

// =============================================================================
// T2-105: Form Input
// =============================================================================

/**
 * Type text into an element
 */
export async function typeText(
  selector: string,
  text: string,
  options: { delay?: number; clear?: boolean } = {}
): Promise<{ success: boolean; error?: string }> {
  const connection = await ensureConnection();
  if (!connection.success) return connection;

  try {
    if (options.clear) {
      await currentPage.click(selector, { clickCount: 3 }); // Select all
      await currentPage.keyboard.press('Backspace');
    }

    await currentPage.type(selector, text, { delay: options.delay || 0 });
    logger.debug('Typed text into element', { selector, textLength: text.length });
    return { success: true };
  } catch (error) {
    const err = error as Error;
    return { success: false, error: `Failed to type in "${selector}": ${err.message}` };
  }
}

/**
 * Select option from dropdown
 */
export async function selectOption(
  selector: string,
  value: string | string[]
): Promise<{ success: boolean; selected?: string[]; error?: string }> {
  const connection = await ensureConnection();
  if (!connection.success) return connection;

  try {
    const values = Array.isArray(value) ? value : [value];
    const selected = await currentPage.select(selector, ...values);
    logger.debug('Selected option', { selector, values });
    return { success: true, selected };
  } catch (error) {
    const err = error as Error;
    return { success: false, error: `Failed to select in "${selector}": ${err.message}` };
  }
}

/**
 * Check or uncheck a checkbox
 */
export async function setCheckbox(
  selector: string,
  checked: boolean
): Promise<{ success: boolean; error?: string }> {
  const connection = await ensureConnection();
  if (!connection.success) return connection;

  try {
    const isChecked = await currentPage.$eval(selector, (el: HTMLInputElement) => el.checked);
    if (isChecked !== checked) {
      await currentPage.click(selector);
    }
    return { success: true };
  } catch (error) {
    const err = error as Error;
    return { success: false, error: err.message };
  }
}

/**
 * Press a keyboard key
 */
export async function pressKey(key: string): Promise<{ success: boolean; error?: string }> {
  const connection = await ensureConnection();
  if (!connection.success) return connection;

  try {
    await currentPage.keyboard.press(key);
    logger.debug('Pressed key', { key });
    return { success: true };
  } catch (error) {
    const err = error as Error;
    return { success: false, error: err.message };
  }
}

// =============================================================================
// T2-106: Content Extraction
// =============================================================================

/**
 * Get page content
 */
export async function getPageContent(
  options: { selector?: string; format?: 'text' | 'html' | 'innerText' } = {}
): Promise<{ success: boolean; content?: string; error?: string }> {
  const connection = await ensureConnection();
  if (!connection.success) return connection;

  try {
    let content: string;

    if (options.selector) {
      const format = options.format || 'text';
      if (format === 'html') {
        content = await currentPage.$eval(options.selector, (el: Element) => el.innerHTML);
      } else if (format === 'innerText') {
        content = await currentPage.$eval(options.selector, (el: HTMLElement) => el.innerText);
      } else {
        content = await currentPage.$eval(options.selector, (el: Element) => el.textContent || '');
      }
    } else {
      const format = options.format || 'text';
      if (format === 'html') {
        content = await currentPage.content();
      } else {
        content = await currentPage.evaluate(() => document.body.innerText);
      }
    }

    return { success: true, content };
  } catch (error) {
    const err = error as Error;
    return { success: false, error: err.message };
  }
}

/**
 * Get page title and URL
 */
export async function getPageInfo(): Promise<{
  success: boolean;
  title?: string;
  url?: string;
  error?: string;
}> {
  const connection = await ensureConnection();
  if (!connection.success) return connection;

  try {
    const title = await currentPage.title();
    const url = currentPage.url();
    return { success: true, title, url };
  } catch (error) {
    const err = error as Error;
    return { success: false, error: err.message };
  }
}

/**
 * Get element attribute or property
 */
export async function getElementAttribute(
  selector: string,
  attribute: string
): Promise<{ success: boolean; value?: string | null; error?: string }> {
  const connection = await ensureConnection();
  if (!connection.success) return connection;

  try {
    const value = await currentPage.$eval(
      selector,
      (el: Element, attr: string) => el.getAttribute(attr),
      attribute
    );
    return { success: true, value };
  } catch (error) {
    const err = error as Error;
    return { success: false, error: err.message };
  }
}

/**
 * Query elements and get their info
 */
export async function queryElements(selector: string): Promise<{
  success: boolean;
  elements?: Array<{ tag: string; text: string; id?: string; class?: string }>;
  error?: string;
}> {
  const connection = await ensureConnection();
  if (!connection.success) return connection;

  try {
    const elements = await currentPage.$$eval(selector, (els: Element[]) =>
      els.map((el) => ({
        tag: el.tagName.toLowerCase(),
        text: (el.textContent || '').slice(0, 100),
        id: el.id || undefined,
        class: el.className || undefined,
      }))
    );
    return { success: true, elements };
  } catch (error) {
    const err = error as Error;
    return { success: false, error: err.message };
  }
}

// =============================================================================
// T2-107: Tab Management
// =============================================================================

/**
 * Open a new tab
 */
export async function openNewTab(
  url?: string
): Promise<{ success: boolean; tabId?: string; error?: string }> {
  const connection = await ensureConnection();
  if (!connection.success) return connection;

  try {
    const newPage = await puppeteerBrowser.newPage();
    if (url) {
      await newPage.goto(url, { waitUntil: 'domcontentloaded' });
    }
    currentPage = newPage;
    cdpState.currentTabId = newPage.target()._targetId;
    logger.info('Opened new tab', { url });
    return { success: true, tabId: cdpState.currentTabId };
  } catch (error) {
    const err = error as Error;
    return { success: false, error: err.message };
  }
}

/**
 * Switch to a specific tab
 */
export async function switchToTab(tabId: string): Promise<{ success: boolean; error?: string }> {
  const connection = await ensureConnection();
  if (!connection.success) return connection;

  try {
    const pages = await puppeteerBrowser.pages();
    const targetPage = pages.find(
      (p: { target: () => { _targetId: string } }) => p.target()._targetId === tabId
    );

    if (!targetPage) {
      return { success: false, error: `Tab not found: ${tabId}` };
    }

    await targetPage.bringToFront();
    currentPage = targetPage;
    cdpState.currentTabId = tabId;
    logger.info('Switched to tab', { tabId });
    return { success: true };
  } catch (error) {
    const err = error as Error;
    return { success: false, error: err.message };
  }
}

/**
 * Close a tab
 */
export async function closeTab(tabId?: string): Promise<{ success: boolean; error?: string }> {
  const connection = await ensureConnection();
  if (!connection.success) return connection;

  try {
    if (tabId) {
      const pages = await puppeteerBrowser.pages();
      const targetPage = pages.find(
        (p: { target: () => { _targetId: string } }) => p.target()._targetId === tabId
      );
      if (targetPage) {
        await targetPage.close();
      }
    } else if (currentPage) {
      await currentPage.close();
      const pages = await puppeteerBrowser.pages();
      currentPage = pages.length > 0 ? pages[0] : null;
      cdpState.currentTabId = currentPage?.target()?._targetId;
    }
    logger.info('Closed tab', { tabId });
    return { success: true };
  } catch (error) {
    const err = error as Error;
    return { success: false, error: err.message };
  }
}

// =============================================================================
// T2-108: Authentication / Cookies
// =============================================================================

/**
 * Get all cookies
 */
export async function getCookies(urls?: string[]): Promise<{
  success: boolean;
  cookies?: Array<{ name: string; value: string; domain: string }>;
  error?: string;
}> {
  const connection = await ensureConnection();
  if (!connection.success) return connection;

  try {
    const cookies = urls ? await currentPage.cookies(...urls) : await currentPage.cookies();
    return { success: true, cookies };
  } catch (error) {
    const err = error as Error;
    return { success: false, error: err.message };
  }
}

/**
 * Set cookies
 */
export async function setCookies(
  cookies: Array<{
    name: string;
    value: string;
    domain?: string;
    path?: string;
    expires?: number;
    httpOnly?: boolean;
    secure?: boolean;
  }>
): Promise<{ success: boolean; error?: string }> {
  const connection = await ensureConnection();
  if (!connection.success) return connection;

  try {
    await currentPage.setCookie(...cookies);
    logger.info('Set cookies', { count: cookies.length });
    return { success: true };
  } catch (error) {
    const err = error as Error;
    return { success: false, error: err.message };
  }
}

/**
 * Delete cookies
 */
export async function deleteCookies(
  cookies?: Array<{ name: string; domain?: string }>
): Promise<{ success: boolean; error?: string }> {
  const connection = await ensureConnection();
  if (!connection.success) return connection;

  try {
    if (cookies) {
      await currentPage.deleteCookie(...cookies);
    } else {
      // Delete all cookies for current page
      const allCookies = await currentPage.cookies();
      if (allCookies.length > 0) {
        await currentPage.deleteCookie(...allCookies);
      }
    }
    logger.info('Deleted cookies');
    return { success: true };
  } catch (error) {
    const err = error as Error;
    return { success: false, error: err.message };
  }
}

// =============================================================================
// T2-109: Element Screenshots
// =============================================================================

/**
 * Take a screenshot
 */
export async function takeScreenshot(
  options: { selector?: string; fullPage?: boolean; path?: string; format?: 'png' | 'jpeg' } = {}
): Promise<{ success: boolean; data?: string; path?: string; error?: string }> {
  const connection = await ensureConnection();
  if (!connection.success) return connection;

  try {
    let screenshotBuffer: Buffer;

    if (options.selector) {
      const element = await currentPage.$(options.selector);
      if (!element) {
        return { success: false, error: `Element not found: ${options.selector}` };
      }
      screenshotBuffer = await element.screenshot({
        type: options.format || 'png',
        path: options.path,
      });
    } else {
      screenshotBuffer = await currentPage.screenshot({
        fullPage: options.fullPage ?? false,
        type: options.format || 'png',
        path: options.path,
      });
    }

    logger.info('Took screenshot', { selector: options.selector, fullPage: options.fullPage });

    return {
      success: true,
      data: screenshotBuffer.toString('base64'),
      path: options.path,
    };
  } catch (error) {
    const err = error as Error;
    return { success: false, error: err.message };
  }
}

// =============================================================================
// T2-110: Wait Strategies
// =============================================================================

/**
 * Wait for element to appear
 */
export async function waitForElement(
  selector: string,
  options: { visible?: boolean; hidden?: boolean; timeout?: number } = {}
): Promise<{ success: boolean; error?: string }> {
  const connection = await ensureConnection();
  if (!connection.success) return connection;

  try {
    await currentPage.waitForSelector(selector, {
      visible: options.visible,
      hidden: options.hidden,
      timeout: options.timeout || 30000,
    });
    return { success: true };
  } catch (error) {
    const err = error as Error;
    return { success: false, error: `Timeout waiting for "${selector}": ${err.message}` };
  }
}

/**
 * Wait for navigation
 */
export async function waitForNavigation(
  options: {
    waitUntil?: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2';
    timeout?: number;
  } = {}
): Promise<{ success: boolean; error?: string }> {
  const connection = await ensureConnection();
  if (!connection.success) return connection;

  try {
    await currentPage.waitForNavigation({
      waitUntil: options.waitUntil || 'domcontentloaded',
      timeout: options.timeout || 30000,
    });
    return { success: true };
  } catch (error) {
    const err = error as Error;
    return { success: false, error: err.message };
  }
}

/**
 * Wait for network to be idle
 */
export async function waitForNetworkIdle(
  options: { idleTime?: number; timeout?: number } = {}
): Promise<{ success: boolean; error?: string }> {
  const connection = await ensureConnection();
  if (!connection.success) return connection;

  try {
    await currentPage.waitForNetworkIdle({
      idleTime: options.idleTime || 500,
      timeout: options.timeout || 30000,
    });
    return { success: true };
  } catch (error) {
    const err = error as Error;
    return { success: false, error: err.message };
  }
}

/**
 * Wait for a specific amount of time
 */
export async function waitForTimeout(ms: number): Promise<{ success: boolean }> {
  await new Promise((resolve) => setTimeout(resolve, ms));
  return { success: true };
}

/**
 * Wait for a function to return true
 */
export async function waitForFunction(
  fn: string,
  options: { timeout?: number; polling?: number } = {}
): Promise<{ success: boolean; error?: string }> {
  const connection = await ensureConnection();
  if (!connection.success) return connection;

  try {
    await currentPage.waitForFunction(fn, {
      timeout: options.timeout || 30000,
      polling: options.polling || 100,
    });
    return { success: true };
  } catch (error) {
    const err = error as Error;
    return { success: false, error: err.message };
  }
}

// =============================================================================
// Agent Tools
// =============================================================================

/**
 * Launch Brave with debugging tool
 */
export const launchBraveDebugTool: AgentTool = {
  name: 'cdp_launch_brave',
  description:
    'Launch Brave browser with remote debugging enabled. This allows full control over the browser via CDP.',
  parameters: {
    type: 'object',
    properties: {
      port: {
        type: 'number',
        description: 'Remote debugging port (default: 9222)',
      },
      startUrl: {
        type: 'string',
        description: 'URL to open on launch',
      },
      headless: {
        type: 'boolean',
        description: 'Run in headless mode (default: false)',
      },
      useProfile: {
        type: 'boolean',
        description: 'Use existing user profile with bookmarks, etc (default: true)',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const result = await launchBrowserWithDebugging({
        port: params.port as number,
        startUrl: params.startUrl as string,
        headless: params.headless as boolean,
        useProfile: params.useProfile as boolean,
      });

      if (!result.success) {
        return { success: false, error: result.error };
      }

      // Connect to the browser
      const connection = await connectToBrowser(result.port);
      if (!connection.success) {
        return { success: false, error: connection.error };
      }

      return {
        success: true,
        data: {
          port: result.port,
          pid: result.pid,
          connected: true,
        },
      };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to launch Brave', { error: err.message });
      return { success: false, error: err.message };
    }
  },
};

/**
 * Connect to existing browser tool
 */
export const connectBrowserTool: AgentTool = {
  name: 'cdp_connect',
  description:
    'Connect to an already running browser with remote debugging enabled. Use this if Brave is already running with --remote-debugging-port.',
  parameters: {
    type: 'object',
    properties: {
      port: {
        type: 'number',
        description: 'Remote debugging port (default: 9222)',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const port = (params.port as number) || 9222;
      const result = await connectToBrowser(port);

      if (!result.success) {
        return { success: false, error: result.error };
      }

      const tabs = await getTabList();

      return {
        success: true,
        data: {
          connected: true,
          port,
          tabCount: tabs.length,
        },
      };
    } catch (error) {
      const err = error as Error;
      return { success: false, error: err.message };
    }
  },
};

/**
 * Navigate to URL tool
 */
export const cdpNavigateTool: AgentTool = {
  name: 'cdp_navigate',
  description: 'Navigate the browser to a URL.',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'URL to navigate to',
      },
      waitUntil: {
        type: 'string',
        description: 'Wait condition: "load", "domcontentloaded", "networkidle0", "networkidle2"',
      },
      timeout: {
        type: 'number',
        description: 'Navigation timeout in ms (default: 30000)',
      },
    },
    required: ['url'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const result = await navigateTo(params.url as string, {
        waitUntil: params.waitUntil as any,
        timeout: params.timeout as number,
      });

      if (!result.success) {
        return { success: false, error: result.error };
      }

      return {
        success: true,
        data: {
          url: params.url,
          title: result.title,
        },
      };
    } catch (error) {
      const err = error as Error;
      return { success: false, error: err.message };
    }
  },
};

/**
 * Get browser status tool
 */
export const cdpStatusTool: AgentTool = {
  name: 'cdp_status',
  description: 'Get current CDP browser connection status and open tabs.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (): Promise<ActionResult> => {
    try {
      const state = getCDPState();
      const tabs = state.connected ? await getTabList() : [];

      return {
        success: true,
        data: {
          ...state,
          tabs,
        },
      };
    } catch (error) {
      const err = error as Error;
      return { success: false, error: err.message };
    }
  },
};

/**
 * Close browser tool
 */
export const cdpCloseTool: AgentTool = {
  name: 'cdp_close',
  description: 'Close the CDP browser connection and optionally the browser itself.',
  parameters: {
    type: 'object',
    properties: {
      closeBrowser: {
        type: 'boolean',
        description: 'Also close the browser process (default: false, just disconnect)',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      if (params.closeBrowser) {
        await closeBrowser();
      } else {
        await disconnect();
      }

      return {
        success: true,
        data: { closed: true },
      };
    } catch (error) {
      const err = error as Error;
      return { success: false, error: err.message };
    }
  },
};

// =============================================================================
// T2-103: Navigation Control Tools
// =============================================================================

export const cdpGoBackTool: AgentTool = {
  name: 'cdp_go_back',
  description: 'Go back to the previous page in browser history.',
  parameters: { type: 'object', properties: {}, required: [] },
  execute: async (): Promise<ActionResult> => {
    const result = await goBack();
    return result.success ? { success: true, data: { navigated: 'back' } } : result;
  },
};

export const cdpGoForwardTool: AgentTool = {
  name: 'cdp_go_forward',
  description: 'Go forward to the next page in browser history.',
  parameters: { type: 'object', properties: {}, required: [] },
  execute: async (): Promise<ActionResult> => {
    const result = await goForward();
    return result.success ? { success: true, data: { navigated: 'forward' } } : result;
  },
};

export const cdpReloadTool: AgentTool = {
  name: 'cdp_reload',
  description: 'Reload the current page.',
  parameters: { type: 'object', properties: {}, required: [] },
  execute: async (): Promise<ActionResult> => {
    const result = await reload();
    return result.success ? { success: true, data: { reloaded: true } } : result;
  },
};

// =============================================================================
// T2-104: Element Interaction Tools
// =============================================================================

export const cdpClickTool: AgentTool = {
  name: 'cdp_click',
  description: 'Click on an element by CSS selector.',
  parameters: {
    type: 'object',
    properties: {
      selector: { type: 'string', description: 'CSS selector of element to click' },
      button: { type: 'string', description: 'Mouse button: "left", "right", or "middle"' },
      clickCount: { type: 'number', description: 'Number of clicks (default: 1)' },
    },
    required: ['selector'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const result = await clickElement(params.selector as string, {
      button: params.button as 'left' | 'right' | 'middle',
      clickCount: params.clickCount as number,
    });
    return result.success ? { success: true, data: { clicked: params.selector } } : result;
  },
};

export const cdpClickTextTool: AgentTool = {
  name: 'cdp_click_text',
  description: 'Click on an element containing specific text.',
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Text content to find and click' },
      exact: { type: 'boolean', description: 'Match exact text only (default: false)' },
      tag: { type: 'string', description: 'HTML tag to search within (default: any)' },
    },
    required: ['text'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const result = await clickByText(params.text as string, {
      exact: params.exact as boolean,
      tag: params.tag as string,
    });
    return result.success ? { success: true, data: { clickedText: params.text } } : result;
  },
};

export const cdpHoverTool: AgentTool = {
  name: 'cdp_hover',
  description: 'Hover over an element by CSS selector.',
  parameters: {
    type: 'object',
    properties: {
      selector: { type: 'string', description: 'CSS selector of element to hover' },
    },
    required: ['selector'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const result = await hoverElement(params.selector as string);
    return result.success ? { success: true, data: { hovered: params.selector } } : result;
  },
};

// =============================================================================
// T2-105: Form Input Tools
// =============================================================================

export const cdpTypeTool: AgentTool = {
  name: 'cdp_type',
  description: 'Type text into an input element.',
  parameters: {
    type: 'object',
    properties: {
      selector: { type: 'string', description: 'CSS selector of input element' },
      text: { type: 'string', description: 'Text to type' },
      clear: { type: 'boolean', description: 'Clear existing text first (default: false)' },
      delay: { type: 'number', description: 'Delay between keystrokes in ms' },
    },
    required: ['selector', 'text'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const result = await typeText(params.selector as string, params.text as string, {
      clear: params.clear as boolean,
      delay: params.delay as number,
    });
    return result.success ? { success: true, data: { typed: true } } : result;
  },
};

export const cdpSelectTool: AgentTool = {
  name: 'cdp_select',
  description: 'Select an option from a dropdown/select element.',
  parameters: {
    type: 'object',
    properties: {
      selector: { type: 'string', description: 'CSS selector of select element' },
      value: { type: 'string', description: 'Value to select' },
    },
    required: ['selector', 'value'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const result = await selectOption(params.selector as string, params.value as string);
    return result.success ? { success: true, data: { selected: result.selected } } : result;
  },
};

export const cdpPressKeyTool: AgentTool = {
  name: 'cdp_press_key',
  description: 'Press a keyboard key (e.g., "Enter", "Tab", "Escape", "ArrowDown").',
  parameters: {
    type: 'object',
    properties: {
      key: { type: 'string', description: 'Key to press (e.g., "Enter", "Tab", "Escape")' },
    },
    required: ['key'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const result = await pressKey(params.key as string);
    return result.success ? { success: true, data: { pressed: params.key } } : result;
  },
};

// =============================================================================
// T2-106: Content Extraction Tools
// =============================================================================

export const cdpGetContentTool: AgentTool = {
  name: 'cdp_get_content',
  description: 'Get page or element content as text or HTML.',
  parameters: {
    type: 'object',
    properties: {
      selector: {
        type: 'string',
        description: 'CSS selector (optional, gets full page if not provided)',
      },
      format: { type: 'string', description: 'Output format: "text", "html", or "innerText"' },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const result = await getPageContent({
      selector: params.selector as string,
      format: params.format as 'text' | 'html' | 'innerText',
    });
    return result.success ? { success: true, data: { content: result.content } } : result;
  },
};

export const cdpGetPageInfoTool: AgentTool = {
  name: 'cdp_get_page_info',
  description: 'Get current page title and URL.',
  parameters: { type: 'object', properties: {}, required: [] },
  execute: async (): Promise<ActionResult> => {
    const result = await getPageInfo();
    return result.success
      ? { success: true, data: { title: result.title, url: result.url } }
      : result;
  },
};

export const cdpQueryElementsTool: AgentTool = {
  name: 'cdp_query_elements',
  description: 'Query elements matching a CSS selector and get their basic info.',
  parameters: {
    type: 'object',
    properties: {
      selector: { type: 'string', description: 'CSS selector to query' },
    },
    required: ['selector'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const result = await queryElements(params.selector as string);
    return result.success ? { success: true, data: { elements: result.elements } } : result;
  },
};

// =============================================================================
// T2-107: Tab Management Tools
// =============================================================================

export const cdpNewTabTool: AgentTool = {
  name: 'cdp_new_tab',
  description: 'Open a new browser tab.',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'URL to open in new tab (optional)' },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const result = await openNewTab(params.url as string);
    return result.success ? { success: true, data: { tabId: result.tabId } } : result;
  },
};

export const cdpSwitchTabTool: AgentTool = {
  name: 'cdp_switch_tab',
  description: 'Switch to a specific tab by ID. Use cdp_status to get tab IDs.',
  parameters: {
    type: 'object',
    properties: {
      tabId: { type: 'string', description: 'Tab ID to switch to' },
    },
    required: ['tabId'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const result = await switchToTab(params.tabId as string);
    return result.success ? { success: true, data: { switched: params.tabId } } : result;
  },
};

export const cdpCloseTabTool: AgentTool = {
  name: 'cdp_close_tab',
  description: 'Close a browser tab.',
  parameters: {
    type: 'object',
    properties: {
      tabId: {
        type: 'string',
        description: 'Tab ID to close (closes current tab if not provided)',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const result = await closeTab(params.tabId as string);
    return result.success ? { success: true, data: { closed: true } } : result;
  },
};

// =============================================================================
// T2-108: Authentication/Cookie Tools
// =============================================================================

export const cdpGetCookiesTool: AgentTool = {
  name: 'cdp_get_cookies',
  description: 'Get all cookies for the current page or specified URLs.',
  parameters: {
    type: 'object',
    properties: {
      urls: {
        type: 'array',
        items: { type: 'string' },
        description: 'URLs to get cookies for (optional)',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const result = await getCookies(params.urls as string[]);
    return result.success ? { success: true, data: { cookies: result.cookies } } : result;
  },
};

export const cdpSetCookiesTool: AgentTool = {
  name: 'cdp_set_cookies',
  description: 'Set browser cookies.',
  parameters: {
    type: 'object',
    properties: {
      cookies: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            value: { type: 'string' },
            domain: { type: 'string' },
            path: { type: 'string' },
          },
        },
        description: 'Array of cookies to set',
      },
    },
    required: ['cookies'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const result = await setCookies(
      params.cookies as Array<{ name: string; value: string; domain?: string }>
    );
    return result.success ? { success: true, data: { set: true } } : result;
  },
};

// =============================================================================
// T2-109: Screenshot Tool
// =============================================================================

export const cdpScreenshotTool: AgentTool = {
  name: 'cdp_screenshot',
  description: 'Take a screenshot of the page or a specific element.',
  parameters: {
    type: 'object',
    properties: {
      selector: {
        type: 'string',
        description: 'CSS selector to screenshot (optional, screenshots page if not provided)',
      },
      fullPage: { type: 'boolean', description: 'Capture full scrollable page (default: false)' },
      path: { type: 'string', description: 'File path to save screenshot (optional)' },
      format: { type: 'string', description: 'Image format: "png" or "jpeg"' },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const result = await takeScreenshot({
      selector: params.selector as string,
      fullPage: params.fullPage as boolean,
      path: params.path as string,
      format: params.format as 'png' | 'jpeg',
    });
    return result.success
      ? {
          success: true,
          data: { screenshot: result.data?.slice(0, 100) + '...', path: result.path },
        }
      : result;
  },
};

// =============================================================================
// T2-110: Wait Strategy Tools
// =============================================================================

export const cdpWaitForElementTool: AgentTool = {
  name: 'cdp_wait_for_element',
  description: 'Wait for an element to appear on the page.',
  parameters: {
    type: 'object',
    properties: {
      selector: { type: 'string', description: 'CSS selector to wait for' },
      visible: { type: 'boolean', description: 'Wait for element to be visible' },
      hidden: { type: 'boolean', description: 'Wait for element to be hidden' },
      timeout: { type: 'number', description: 'Timeout in ms (default: 30000)' },
    },
    required: ['selector'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const result = await waitForElement(params.selector as string, {
      visible: params.visible as boolean,
      hidden: params.hidden as boolean,
      timeout: params.timeout as number,
    });
    return result.success ? { success: true, data: { found: params.selector } } : result;
  },
};

export const cdpWaitForNavigationTool: AgentTool = {
  name: 'cdp_wait_for_navigation',
  description: 'Wait for page navigation to complete.',
  parameters: {
    type: 'object',
    properties: {
      waitUntil: {
        type: 'string',
        description: 'Wait condition: "load", "domcontentloaded", "networkidle0", "networkidle2"',
      },
      timeout: { type: 'number', description: 'Timeout in ms (default: 30000)' },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const result = await waitForNavigation({
      waitUntil: params.waitUntil as 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2',
      timeout: params.timeout as number,
    });
    return result.success ? { success: true, data: { navigationComplete: true } } : result;
  },
};

export const cdpWaitTool: AgentTool = {
  name: 'cdp_wait',
  description: 'Wait for a specific amount of time.',
  parameters: {
    type: 'object',
    properties: {
      ms: { type: 'number', description: 'Time to wait in milliseconds' },
    },
    required: ['ms'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    await waitForTimeout(params.ms as number);
    return { success: true, data: { waited: params.ms } };
  },
};

/**
 * Get all CDP browser tools
 */
export function getCDPBrowserTools(): AgentTool[] {
  return [
    // Core tools (T2-101, T2-102)
    launchBraveDebugTool,
    connectBrowserTool,
    cdpStatusTool,
    cdpCloseTool,
    // Navigation tools (T2-103)
    cdpNavigateTool,
    cdpGoBackTool,
    cdpGoForwardTool,
    cdpReloadTool,
    // Element interaction tools (T2-104)
    cdpClickTool,
    cdpClickTextTool,
    cdpHoverTool,
    // Form input tools (T2-105)
    cdpTypeTool,
    cdpSelectTool,
    cdpPressKeyTool,
    // Content extraction tools (T2-106)
    cdpGetContentTool,
    cdpGetPageInfoTool,
    cdpQueryElementsTool,
    // Tab management tools (T2-107)
    cdpNewTabTool,
    cdpSwitchTabTool,
    cdpCloseTabTool,
    // Cookie tools (T2-108)
    cdpGetCookiesTool,
    cdpSetCookiesTool,
    // Screenshot tool (T2-109)
    cdpScreenshotTool,
    // Wait tools (T2-110)
    cdpWaitForElementTool,
    cdpWaitForNavigationTool,
    cdpWaitTool,
  ];
}

export default {
  // Core functions
  launchBrowserWithDebugging,
  connectToBrowser,
  navigateTo,
  getTabList,
  getCDPState,
  disconnect,
  closeBrowser,
  findBravePathCDP,
  findChromePathCDP,
  // Navigation
  goBack,
  goForward,
  reload,
  // Element interaction
  clickElement,
  clickByText,
  hoverElement,
  clickAtPosition,
  // Form input
  typeText,
  selectOption,
  setCheckbox,
  pressKey,
  // Content extraction
  getPageContent,
  getPageInfo,
  getElementAttribute,
  queryElements,
  // Tab management
  openNewTab,
  switchToTab,
  closeTab,
  // Cookies
  getCookies,
  setCookies,
  deleteCookies,
  // Screenshots
  takeScreenshot,
  // Wait strategies
  waitForElement,
  waitForNavigation,
  waitForNetworkIdle,
  waitForTimeout,
  waitForFunction,
  // Tool collection
  getCDPBrowserTools,
};
