/**
 * Atlas Desktop - Visual Testing Global Setup
 *
 * Runs once before all visual tests to prepare the environment.
 */

import { chromium, FullConfig } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const VISUAL_DIR = path.join(__dirname, '..');
const BASELINE_DIR = path.join(VISUAL_DIR, 'baselines');

async function globalSetup(config: FullConfig): Promise<void> {
  console.log('[Visual Tests] Starting global setup...');

  // Ensure baseline directory exists
  if (!fs.existsSync(BASELINE_DIR)) {
    fs.mkdirSync(BASELINE_DIR, { recursive: true });
    console.log('[Visual Tests] Created baseline directory:', BASELINE_DIR);
  }

  // Check if we're running in update mode
  if (process.env.UPDATE_SNAPSHOTS) {
    console.log('[Visual Tests] Running in UPDATE_SNAPSHOTS mode - new baselines will be captured');
  }

  // Pre-warm the browser to ensure consistent first-test timing
  const browser = await chromium.launch();
  const page = await browser.newPage();

  try {
    // Wait for dev server to be ready
    const baseURL = config.projects[0]?.use?.baseURL || 'http://localhost:5173';
    console.log('[Visual Tests] Waiting for dev server at:', baseURL);

    let retries = 30;
    while (retries > 0) {
      try {
        await page.goto(baseURL, { timeout: 5000 });
        console.log('[Visual Tests] Dev server is ready');
        break;
      } catch {
        retries--;
        if (retries === 0) {
          throw new Error('Dev server did not start in time');
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    // Wait for initial render
    await page.waitForTimeout(2000);
  } finally {
    await browser.close();
  }

  console.log('[Visual Tests] Global setup complete');
}

export default globalSetup;
