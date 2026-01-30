/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Atlas Desktop - Browser Automation Tools
 * Playwright-based browser automation for web interactions
 */

import * as fs from 'fs';
import { AgentTool, ActionResult } from '../../../shared/types/agent';
import { createModuleLogger } from '../../utils/logger';

const logger = createModuleLogger('BrowserTools');

// Browser instance management
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let browserInstance: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pageInstance: any = null;
let currentBrowserType: 'chromium' | 'brave' | 'chrome' = 'chromium';

/**
 * Common Brave paths on Windows
 */
const BRAVE_PATHS_WINDOWS = [
  'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
  'C:\\Program Files (x86)\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
  `${process.env.LOCALAPPDATA}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`,
];

/**
 * Find Brave executable path
 */
export function findBravePath(): string | null {
  if (process.platform === 'win32') {
    for (const path of BRAVE_PATHS_WINDOWS) {
      try {
        if (fs.existsSync(path)) {
          return path;
        }
      } catch {
        // Path doesn't exist, continue
      }
    }
  }
  return null;
}

/**
 * URL validation and safety check
 */
export function validateUrl(url: string): { valid: boolean; reason?: string } {
  try {
    const parsed = new URL(url);

    // Block dangerous protocols
    const blockedProtocols = ['file:', 'javascript:', 'data:', 'vbscript:'];
    if (blockedProtocols.includes(parsed.protocol)) {
      return { valid: false, reason: `Protocol ${parsed.protocol} is not allowed` };
    }

    // Block localhost/internal IPs in production
    const blockedHosts = ['localhost', '127.0.0.1', '0.0.0.0'];
    if (blockedHosts.includes(parsed.hostname)) {
      return { valid: false, reason: 'Local addresses are not allowed' };
    }

    // Block internal IP ranges
    const ipPattern = /^(\d{1,3}\.){3}\d{1,3}$/;
    if (ipPattern.test(parsed.hostname)) {
      const parts = parsed.hostname.split('.').map(Number);
      // Block 10.x.x.x, 172.16-31.x.x, 192.168.x.x
      if (
        parts[0] === 10 ||
        (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
        (parts[0] === 192 && parts[1] === 168)
      ) {
        return { valid: false, reason: 'Internal IP addresses are not allowed' };
      }
    }

    return { valid: true };
  } catch {
    return { valid: false, reason: 'Invalid URL format' };
  }
}

/**
 * Lazy load Playwright (optional dependency)
 */
async function getPlaywright(): Promise<any> {
  try {
    // Dynamic import to make Playwright optional
    const playwright = await import('playwright');
    return playwright;
  } catch {
    throw new Error(
      'Playwright is not installed. Run: npm install playwright && npx playwright install chromium'
    );
  }
}

/**
 * Browser launch options
 */
export interface BrowserLaunchOptions {
  /** Browser type: 'chromium', 'brave', or 'chrome' */
  browserType?: 'chromium' | 'brave' | 'chrome';
  /** Run in headless mode (default: true) */
  headless?: boolean;
  /** Slow down actions by this many ms (for debugging) */
  slowMo?: number;
}

/**
 * Get or create browser instance
 */
async function getBrowser(options?: BrowserLaunchOptions): Promise<any> {
  const browserType = options?.browserType || 'chromium';
  const headless = options?.headless ?? true;
  const slowMo = options?.slowMo;

  // If browser exists and type matches, return it
  if (browserInstance && currentBrowserType === browserType) {
    return browserInstance;
  }

  // Close existing browser if type changed
  if (browserInstance && currentBrowserType !== browserType) {
    await browserInstance.close();
    browserInstance = null;
    pageInstance = null;
  }

  const playwright = await getPlaywright();

  const launchOptions: Record<string, unknown> = {
    headless,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  };

  if (slowMo) {
    launchOptions.slowMo = slowMo;
  }

  // Handle Brave browser
  if (browserType === 'brave') {
    const bravePath = findBravePath();
    if (bravePath) {
      launchOptions.executablePath = bravePath;
      logger.info('Using Brave browser', { path: bravePath });
    } else {
      logger.warn('Brave not found, falling back to Chromium');
    }
  }

  browserInstance = await playwright.chromium.launch(launchOptions);
  currentBrowserType = browserType;

  logger.info('Browser instance created', { type: browserType, headless });
  return browserInstance;
}

/**
 * Get or create page instance
 */
async function getPage(): Promise<any> {
  if (pageInstance) {
    return pageInstance;
  }

  const browser = await getBrowser();
  pageInstance = await browser.newPage();

  // Set default viewport
  await pageInstance.setViewportSize({ width: 1280, height: 720 });

  // Set user agent
  await pageInstance.setExtraHTTPHeaders({
    'User-Agent': 'Nova-Desktop/1.0 (AI Assistant)',
  });

  logger.info('Page instance created');
  return pageInstance;
}

/**
 * Navigate to URL tool
 */
export const navigateToUrlTool: AgentTool = {
  name: 'puppeteer_navigate',
  description: 'Navigate to a URL in the browser. Returns page title and status.',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The URL to navigate to (must be http:// or https://)',
      },
      waitFor: {
        type: 'string',
        description: 'Wait condition: "load", "domcontentloaded", or "networkidle"',
      },
      timeout: {
        type: 'number',
        description: 'Navigation timeout in milliseconds (default: 30000)',
      },
    },
    required: ['url'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const url = params.url as string;
      const waitFor = (params.waitFor as string) || 'domcontentloaded';
      const timeout = (params.timeout as number) || 30000;

      // Validate URL
      const validation = validateUrl(url);
      if (!validation.valid) {
        return { success: false, error: validation.reason };
      }

      const page = await getPage();

      const response = await page.goto(url, {
        waitUntil: waitFor,
        timeout,
      });

      const title = await page.title();
      const currentUrl = page.url();
      const status = response?.status() || 0;

      logger.info('Navigated to URL', { url, status, title });

      return {
        success: true,
        data: {
          url: currentUrl,
          title,
          status,
          waitCondition: waitFor,
        },
      };
    } catch (error) {
      const err = error as Error;
      logger.error('Navigation failed', { error: err.message });
      return { success: false, error: err.message };
    }
  },
};

/**
 * Get page content tool
 */
export const getPageContentTool: AgentTool = {
  name: 'browser_get_content',
  description: 'Get the text content of the current page or a specific element.',
  parameters: {
    type: 'object',
    properties: {
      selector: {
        type: 'string',
        description: 'CSS selector to get content from (optional, defaults to body)',
      },
      maxLength: {
        type: 'number',
        description: 'Maximum content length to return (default: 10000)',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const selector = (params.selector as string) || 'body';
      const maxLength = (params.maxLength as number) || 10000;

      const page = await getPage();
      const currentUrl = page.url();

      if (!currentUrl || currentUrl === 'about:blank') {
        return { success: false, error: 'No page loaded. Use browser_navigate first.' };
      }

      const element = await page.$(selector);
      if (!element) {
        return { success: false, error: `Element not found: ${selector}` };
      }

      let content = await element.innerText();
      const truncated = content.length > maxLength;
      if (truncated) {
        content = content.substring(0, maxLength) + '...';
      }

      return {
        success: true,
        data: {
          content,
          selector,
          url: currentUrl,
          length: content.length,
          truncated,
        },
      };
    } catch (error) {
      const err = error as Error;
      logger.error('Get content failed', { error: err.message });
      return { success: false, error: err.message };
    }
  },
};

/**
 * Click element tool
 */
export const clickElementTool: AgentTool = {
  name: 'puppeteer_click',
  description: 'Click on an element in the current page.',
  parameters: {
    type: 'object',
    properties: {
      selector: {
        type: 'string',
        description: 'CSS selector of the element to click',
      },
      timeout: {
        type: 'number',
        description: 'Timeout for finding element in milliseconds (default: 5000)',
      },
    },
    required: ['selector'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const selector = params.selector as string;
      const timeout = (params.timeout as number) || 5000;

      const page = await getPage();

      await page.waitForSelector(selector, { timeout });
      await page.click(selector);

      logger.info('Clicked element', { selector });

      return {
        success: true,
        data: {
          selector,
          clicked: true,
          url: page.url(),
        },
      };
    } catch (error) {
      const err = error as Error;
      logger.error('Click failed', { error: err.message });
      return { success: false, error: err.message };
    }
  },
};

/**
 * Type text tool
 */
export const typeTextTool: AgentTool = {
  name: 'puppeteer_type',
  description: 'Type text into an input field.',
  parameters: {
    type: 'object',
    properties: {
      selector: {
        type: 'string',
        description: 'CSS selector of the input element',
      },
      text: {
        type: 'string',
        description: 'Text to type',
      },
      clear: {
        type: 'boolean',
        description: 'Clear the field before typing (default: true)',
      },
      delay: {
        type: 'number',
        description: 'Delay between keystrokes in ms (default: 50)',
      },
    },
    required: ['selector', 'text'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const selector = params.selector as string;
      const text = params.text as string;
      const clear = params.clear !== false;
      const delay = (params.delay as number) || 50;

      const page = await getPage();

      await page.waitForSelector(selector, { timeout: 5000 });

      if (clear) {
        await page.fill(selector, '');
      }

      await page.type(selector, text, { delay });

      logger.info('Typed text', { selector, length: text.length });

      return {
        success: true,
        data: {
          selector,
          textLength: text.length,
          cleared: clear,
        },
      };
    } catch (error) {
      const err = error as Error;
      logger.error('Type failed', { error: err.message });
      return { success: false, error: err.message };
    }
  },
};

/**
 * Take screenshot tool
 */
export const browserScreenshotTool: AgentTool = {
  name: 'puppeteer_screenshot',
  description: 'Take a screenshot of the current page.',
  parameters: {
    type: 'object',
    properties: {
      selector: {
        type: 'string',
        description: 'CSS selector to screenshot (optional, defaults to full page)',
      },
      fullPage: {
        type: 'boolean',
        description: 'Capture full scrollable page (default: false)',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const selector = params.selector as string | undefined;
      const fullPage = params.fullPage === true;

      const page = await getPage();
      const currentUrl = page.url();

      if (!currentUrl || currentUrl === 'about:blank') {
        return { success: false, error: 'No page loaded. Use browser_navigate first.' };
      }

      let screenshot: Buffer;

      if (selector) {
        const element = await page.$(selector);
        if (!element) {
          return { success: false, error: `Element not found: ${selector}` };
        }
        screenshot = await element.screenshot();
      } else {
        screenshot = await page.screenshot({ fullPage });
      }

      // Return as base64
      const base64 = screenshot.toString('base64');

      logger.info('Screenshot taken', { url: currentUrl, selector, fullPage });

      return {
        success: true,
        data: {
          url: currentUrl,
          selector: selector || 'viewport',
          fullPage,
          format: 'png',
          base64,
          size: screenshot.length,
        },
      };
    } catch (error) {
      const err = error as Error;
      logger.error('Screenshot failed', { error: err.message });
      return { success: false, error: err.message };
    }
  },
};

/**
 * Close browser tool
 */
export const closeBrowserTool: AgentTool = {
  name: 'puppeteer_close',
  description: 'Close the browser instance and clean up resources.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (): Promise<ActionResult> => {
    try {
      if (pageInstance) {
        await pageInstance.close();
        pageInstance = null;
      }

      if (browserInstance) {
        await browserInstance.close();
        browserInstance = null;
      }

      logger.info('Browser closed');

      return {
        success: true,
        data: { closed: true },
      };
    } catch (error) {
      const err = error as Error;
      logger.error('Browser close failed', { error: err.message });
      return { success: false, error: err.message };
    }
  },
};

/**
 * Launch browser tool - allows launching with specific browser type
 */
export const launchBrowserTool: AgentTool = {
  name: 'browser_launch',
  description:
    'Launch a browser instance. Supports Chromium, Brave, or Chrome. Use this before navigation if you want to use a specific browser.',
  parameters: {
    type: 'object',
    properties: {
      browserType: {
        type: 'string',
        description: 'Browser to use: "chromium" (default), "brave", or "chrome"',
      },
      headless: {
        type: 'boolean',
        description: 'Run in headless mode without visible window (default: true)',
      },
      slowMo: {
        type: 'number',
        description: 'Slow down actions by this many milliseconds (for debugging)',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const browserType = (params.browserType as 'chromium' | 'brave' | 'chrome') || 'chromium';
      const headless = params.headless !== false;
      const slowMo = params.slowMo as number | undefined;

      const browser = await getBrowser({ browserType, headless, slowMo });

      logger.info('Browser launched', { browserType, headless });

      return {
        success: true,
        data: {
          browserType: currentBrowserType,
          headless,
          connected: !!browser,
        },
      };
    } catch (error) {
      const err = error as Error;
      logger.error('Browser launch failed', { error: err.message });
      return { success: false, error: err.message };
    }
  },
};

/**
 * Check if Brave browser is available
 */
export const checkBraveTool: AgentTool = {
  name: 'browser_check_brave',
  description: 'Check if Brave browser is installed and available.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (): Promise<ActionResult> => {
    try {
      const bravePath = findBravePath();

      return {
        success: true,
        data: {
          available: !!bravePath,
          path: bravePath,
        },
      };
    } catch (error) {
      const err = error as Error;
      return { success: false, error: err.message };
    }
  },
};

/**
 * Get all browser tools
 */
export function getBrowserTools(): AgentTool[] {
  return [
    launchBrowserTool,
    checkBraveTool,
    navigateToUrlTool,
    getPageContentTool,
    clickElementTool,
    typeTextTool,
    browserScreenshotTool,
    closeBrowserTool,
  ];
}

export default {
  validateUrl,
  findBravePath,
  getBrowserTools,
  launchBrowserTool,
  checkBraveTool,
  navigateToUrlTool,
  getPageContentTool,
  clickElementTool,
  typeTextTool,
  browserScreenshotTool,
  closeBrowserTool,
};
