/**
 * Atlas Desktop - Visual Test Utilities
 *
 * Helper functions and fixtures for visual regression testing.
 */

import { test as base, expect, Page, Locator } from '@playwright/test';

// ============================================================================
// Types
// ============================================================================

export type OrbState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error';
export type Theme = 'dark' | 'light' | 'system';

export interface ScreenshotOptions {
  /** Name for the screenshot (used in baseline filename) */
  name: string;
  /** Clip region for partial screenshot */
  clip?: { x: number; y: number; width: number; height: number };
  /** Wait for animations to settle */
  waitForAnimations?: boolean;
  /** Maximum allowed pixel difference ratio (0-1) */
  maxDiffPixelRatio?: number;
  /** Maximum allowed different pixels */
  maxDiffPixels?: number;
  /** Threshold for color comparison (0-1) */
  threshold?: number;
  /** Mask specific elements */
  mask?: Locator[];
  /** Full page screenshot */
  fullPage?: boolean;
}

export interface VisualTestContext {
  page: Page;
  /** Set the orb state for testing */
  setOrbState: (state: OrbState) => Promise<void>;
  /** Set the audio level (0-1) */
  setAudioLevel: (level: number) => Promise<void>;
  /** Set the theme */
  setTheme: (theme: Theme) => Promise<void>;
  /** Open settings panel */
  openSettings: () => Promise<void>;
  /** Close settings panel */
  closeSettings: () => Promise<void>;
  /** Wait for orb to render */
  waitForOrb: () => Promise<void>;
  /** Wait for stable frame rate */
  waitForStableFramerate: () => Promise<void>;
  /** Take a visual comparison screenshot */
  visualCompare: (options: ScreenshotOptions) => Promise<void>;
  /** Inject test data into the store */
  injectStoreState: (state: Record<string, unknown>) => Promise<void>;
}

// ============================================================================
// CSS Injection for Animation Control
// ============================================================================

const DISABLE_ANIMATIONS_CSS = `
  /* Disable all CSS animations and transitions for consistent screenshots */
  *, *::before, *::after {
    animation-duration: 0s !important;
    animation-delay: 0s !important;
    transition-duration: 0s !important;
    transition-delay: 0s !important;
  }

  /* Disable WebGL/Canvas animations via attribute */
  canvas[data-visual-test="true"] {
    animation: none !important;
  }
`;

const PAUSE_3D_ANIMATIONS_SCRIPT = `
  // Pause Three.js animation loops for visual testing
  window.__VISUAL_TEST_MODE__ = true;

  // Store original requestAnimationFrame
  if (!window.__ORIGINAL_RAF__) {
    window.__ORIGINAL_RAF__ = window.requestAnimationFrame;
  }

  // Override to control animation frames
  let frameCount = 0;
  let isPaused = false;

  window.__pauseAnimations = () => {
    isPaused = true;
  };

  window.__resumeAnimations = () => {
    isPaused = false;
  };

  window.__renderSingleFrame = () => {
    return new Promise((resolve) => {
      isPaused = false;
      const originalCallback = window.__ORIGINAL_RAF__;
      window.requestAnimationFrame = (cb) => {
        isPaused = true;
        cb(performance.now());
        resolve();
        return frameCount++;
      };
    });
  };
`;

// ============================================================================
// Test Fixtures
// ============================================================================

export const test = base.extend<{ visualTest: VisualTestContext }>({
  visualTest: async ({ page }, use) => {
    // Navigate to app
    await page.goto('/');

    // Inject animation control CSS
    await page.addStyleTag({ content: DISABLE_ANIMATIONS_CSS });

    // Inject 3D animation control script
    await page.addScriptTag({ content: PAUSE_3D_ANIMATIONS_SCRIPT });

    // Wait for initial render
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    // Create context with helper methods
    const context: VisualTestContext = {
      page,

      async setOrbState(state: OrbState) {
        await page.evaluate((s) => {
          // Access Zustand store directly
          const store = (window as unknown as { __ATLAS_STORE__?: { setState: (state: { state: OrbState }) => void } }).__ATLAS_STORE__;
          if (store) {
            store.setState({ state: s });
          }
          // Fallback: dispatch custom event
          window.dispatchEvent(
            new CustomEvent('atlas:test:setState', { detail: { state: s } })
          );
        }, state);
        // Wait for re-render
        await page.waitForTimeout(100);
      },

      async setAudioLevel(level: number) {
        await page.evaluate((l) => {
          window.dispatchEvent(
            new CustomEvent('atlas:test:setAudioLevel', { detail: { level: l } })
          );
        }, level);
        await page.waitForTimeout(50);
      },

      async setTheme(theme: Theme) {
        await page.evaluate((t) => {
          document.documentElement.setAttribute('data-theme', t);
          window.dispatchEvent(
            new CustomEvent('atlas:test:setTheme', { detail: { theme: t } })
          );
        }, theme);
        await page.waitForTimeout(100);
      },

      async openSettings() {
        // Click settings button in footer
        const settingsButton = page.locator('.footer-button[aria-label="Settings"]');
        await settingsButton.click();
        // Wait for panel to open
        await page.waitForSelector('.settings-panel', { state: 'visible' });
        await page.waitForTimeout(300);
      },

      async closeSettings() {
        const closeButton = page.locator('.settings-close');
        await closeButton.click();
        await page.waitForSelector('.settings-panel', { state: 'detached' });
        await page.waitForTimeout(100);
      },

      async waitForOrb() {
        // Wait for canvas to be rendered
        await page.waitForSelector('canvas', { state: 'attached' });
        // Wait for WebGL context
        await page.waitForFunction(() => {
          const canvas = document.querySelector('canvas');
          if (!canvas) return false;
          const gl = canvas.getContext('webgl') || canvas.getContext('webgl2');
          return gl !== null;
        });
        // Wait for particle system to initialize
        await page.waitForTimeout(1000);
      },

      async waitForStableFramerate() {
        // Render a few frames to stabilize
        for (let i = 0; i < 5; i++) {
          await page.evaluate(() => {
            return new Promise<void>((resolve) => {
              requestAnimationFrame(() => resolve());
            });
          });
        }
        await page.waitForTimeout(100);
      },

      async visualCompare(options: ScreenshotOptions) {
        const {
          name,
          clip,
          waitForAnimations = true,
          maxDiffPixelRatio = 0.02,
          maxDiffPixels = 500,
          threshold = 0.2,
          mask = [],
          fullPage = false,
        } = options;

        // Wait for animations to settle
        if (waitForAnimations) {
          await context.waitForStableFramerate();
        }

        // Take screenshot and compare
        await expect(page).toHaveScreenshot(`${name}.png`, {
          clip,
          maxDiffPixelRatio,
          maxDiffPixels,
          threshold,
          mask,
          fullPage,
          animations: 'disabled',
        });
      },

      async injectStoreState(state: Record<string, unknown>) {
        await page.evaluate((s) => {
          const store = (window as unknown as { __ATLAS_STORE__?: { setState: (state: Record<string, unknown>) => void } }).__ATLAS_STORE__;
          if (store) {
            store.setState(s);
          }
        }, state);
        await page.waitForTimeout(100);
      },
    };

    await use(context);
  },
});

// Re-export expect for convenience
export { expect };

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Wait for a specific number of animation frames
 */
export async function waitForFrames(page: Page, frameCount: number): Promise<void> {
  for (let i = 0; i < frameCount; i++) {
    await page.evaluate(() => {
      return new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });
    });
  }
}

/**
 * Get the current FPS from the page
 */
export async function getCurrentFPS(page: Page): Promise<number> {
  return page.evaluate(() => {
    return new Promise<number>((resolve) => {
      const times: number[] = [];
      let lastTime = performance.now();

      const measure = () => {
        const now = performance.now();
        times.push(now - lastTime);
        lastTime = now;

        if (times.length < 60) {
          requestAnimationFrame(measure);
        } else {
          const avgFrameTime = times.reduce((a, b) => a + b, 0) / times.length;
          resolve(1000 / avgFrameTime);
        }
      };

      requestAnimationFrame(measure);
    });
  });
}

/**
 * Capture canvas content as data URL
 */
export async function captureCanvas(page: Page): Promise<string> {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return '';
    return canvas.toDataURL('image/png');
  });
}

/**
 * Compare two canvas states
 */
export async function compareCanvasStates(
  page: Page,
  state1: string,
  state2: string
): Promise<boolean> {
  // Basic comparison - in real implementation would use pixel comparison
  return state1 !== state2;
}

/**
 * Get the bounding box of the orb container
 */
export async function getOrbBounds(
  page: Page
): Promise<{ x: number; y: number; width: number; height: number } | null> {
  return page.evaluate(() => {
    const orb = document.querySelector('.atlas-orb-container');
    if (!orb) return null;
    const rect = orb.getBoundingClientRect();
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    };
  });
}

/**
 * Simulate mouse hover over the orb
 */
export async function hoverOrb(page: Page): Promise<void> {
  const bounds = await getOrbBounds(page);
  if (bounds) {
    await page.mouse.move(
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2
    );
  }
}

/**
 * Simulate click on the orb
 */
export async function clickOrb(page: Page): Promise<void> {
  const orb = page.locator('.atlas-orb-container');
  await orb.click();
}

/**
 * Get visible UI elements for component testing
 */
export async function getVisibleElements(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const elements: string[] = [];
    const selectors = [
      '.atlas-orb-container',
      '.atlas-status',
      '.atlas-conversation',
      '.atlas-footer',
      '.settings-panel',
      '.debug-overlay',
      '.error-toast',
    ];

    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el && getComputedStyle(el).display !== 'none') {
        elements.push(selector);
      }
    }

    return elements;
  });
}

/**
 * Mask dynamic content for stable screenshots
 */
export function getMaskLocators(page: Page): Locator[] {
  return [
    // Mask any timestamps
    page.locator('[data-testid="timestamp"]'),
    // Mask loading spinners
    page.locator('.loading-indicator'),
    // Mask dynamic text content
    page.locator('.conversation-text'),
  ];
}

/**
 * Set viewport for consistent screenshots
 */
export async function setStandardViewport(page: Page): Promise<void> {
  await page.setViewportSize({ width: 800, height: 600 });
}

/**
 * Create a test snapshot name with metadata
 */
export function createSnapshotName(
  testName: string,
  variant?: string,
  suffix?: string
): string {
  const parts = [testName];
  if (variant) parts.push(variant);
  if (suffix) parts.push(suffix);
  return parts.join('-').toLowerCase().replace(/\s+/g, '-');
}
