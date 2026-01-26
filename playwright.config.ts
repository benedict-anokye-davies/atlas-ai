/**
 * Atlas Desktop - Playwright Configuration for Visual Regression Testing
 *
 * Configures Playwright for screenshot comparison and visual regression tests
 * for the Electron application.
 */

import { defineConfig, devices } from '@playwright/test';
import path from 'path';

// Base directory for visual test artifacts
const VISUAL_TEST_DIR = path.join(__dirname, 'tests', 'visual');
const BASELINE_DIR = path.join(VISUAL_TEST_DIR, 'baselines');
const DIFF_DIR = path.join(VISUAL_TEST_DIR, 'diffs');
const REPORT_DIR = path.join(VISUAL_TEST_DIR, 'reports');

export default defineConfig({
  // Test directory
  testDir: VISUAL_TEST_DIR,

  // Test file pattern
  testMatch: '**/*.visual.ts',

  // Timeout for each test
  timeout: 60000,

  // Expect timeout for assertions
  expect: {
    timeout: 10000,
    // Visual comparison settings
    toHaveScreenshot: {
      // Maximum allowed pixel difference ratio
      maxDiffPixelRatio: 0.02,
      // Maximum allowed different pixels
      maxDiffPixels: 500,
      // Threshold for color comparison (0-1, lower = stricter)
      threshold: 0.2,
      // Animation handling
      animations: 'disabled',
    },
    toMatchSnapshot: {
      maxDiffPixelRatio: 0.02,
      threshold: 0.2,
    },
  },

  // Fully parallel execution
  fullyParallel: false,

  // Fail the build on CI if you accidentally left test.only
  forbidOnly: !!process.env.CI,

  // Retry on CI only
  retries: process.env.CI ? 2 : 0,

  // Opt out of parallel tests on CI (for consistent screenshots)
  workers: process.env.CI ? 1 : 1,

  // Reporter configuration
  reporter: [
    ['html', { outputFolder: REPORT_DIR, open: 'never' }],
    ['json', { outputFile: path.join(REPORT_DIR, 'results.json') }],
    ['list'],
  ],

  // Global setup and teardown
  globalSetup: path.join(VISUAL_TEST_DIR, 'setup', 'global-setup.ts'),
  globalTeardown: path.join(VISUAL_TEST_DIR, 'setup', 'global-teardown.ts'),

  // Output directory for test artifacts
  outputDir: DIFF_DIR,

  // Snapshot directory
  snapshotDir: BASELINE_DIR,

  // Update snapshots mode
  updateSnapshots: process.env.UPDATE_SNAPSHOTS ? 'all' : 'missing',

  // Use custom test fixtures
  use: {
    // Base URL for the Electron app
    baseURL: 'http://localhost:5173',

    // Collect trace when test fails
    trace: 'on-first-retry',

    // Screenshot on failure
    screenshot: 'only-on-failure',

    // Video recording
    video: process.env.CI ? 'on-first-retry' : 'off',

    // Viewport size matching Atlas window
    viewport: { width: 800, height: 600 },

    // Disable animations for consistent screenshots
    // Note: handled via CSS injection for 3D canvas
  },

  // Project configurations
  projects: [
    {
      name: 'visual-chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 800, height: 600 },
        // Launch options for Electron testing
        launchOptions: {
          args: ['--disable-gpu-sandbox'],
        },
      },
    },
    {
      name: 'visual-dark-theme',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 800, height: 600 },
        colorScheme: 'dark',
      },
    },
    {
      name: 'visual-light-theme',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 800, height: 600 },
        colorScheme: 'light',
      },
    },
    {
      name: 'visual-mobile',
      use: {
        ...devices['iPhone 13'],
        viewport: { width: 390, height: 844 },
      },
    },
  ],

  // Web server configuration for development
  webServer: {
    command: 'npm run dev:vite',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
