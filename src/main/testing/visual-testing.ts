/**
 * Atlas Desktop - Visual UI Testing
 * 
 * Automated visual regression testing:
 * - Takes screenshots of UI components
 * - Compares against baseline images
 * - Detects visual changes automatically
 * - Integrates with design systems
 * - Reports visual bugs
 * 
 * @module testing/visual-testing
 */

import { EventEmitter } from 'events';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as crypto from 'crypto';
import { createModuleLogger } from '../utils/logger';
import { sleep } from '../../shared/utils';
import { BrowserWindow, desktopCapturer } from 'electron';

const logger = createModuleLogger('VisualTesting');

// Lazy load sharp to avoid bundling issues with native modules
let sharpModule: typeof import('sharp') | null = null;
async function getSharp(): Promise<typeof import('sharp')> {
  if (!sharpModule) {
    try {
      sharpModule = (await import('sharp')).default as unknown as typeof import('sharp');
    } catch (error) {
      logger.warn('Sharp module not available, visual testing will be limited', { error: (error as Error).message });
      throw new Error('Sharp module required for visual testing but not available');
    }
  }
  return sharpModule;
}

// ============================================================================
// Types
// ============================================================================

export interface VisualTestConfig {
  /** Base directory for screenshots */
  baselineDir: string;
  
  /** Directory for actual screenshots */
  actualDir: string;
  
  /** Directory for diff images */
  diffDir: string;
  
  /** Threshold for pixel difference (0-1) */
  threshold: number;
  
  /** Fail if more than this percentage differs */
  failureThreshold: number;
  
  /** Screenshot format */
  format: 'png' | 'jpg';
  
  /** Whether to update baselines automatically */
  updateBaselines: boolean;
  
  /** Viewport sizes to test */
  viewports: Viewport[];
}

export interface Viewport {
  name: string;
  width: number;
  height: number;
}

export interface VisualTest {
  id: string;
  name: string;
  component: string;
  url?: string;
  selector?: string;
  viewport: Viewport;
  baseline?: string;
  status: 'pending' | 'passed' | 'failed' | 'new';
}

export interface VisualTestResult {
  test: VisualTest;
  passed: boolean;
  diffPercentage: number;
  baselinePath?: string;
  actualPath: string;
  diffPath?: string;
  error?: string;
  duration: number;
}

export interface DiffResult {
  diffPercentage: number;
  diffPixels: number;
  totalPixels: number;
  diffImageBuffer: Buffer;
}

export interface VisualTestSuite {
  name: string;
  tests: VisualTest[];
  results: VisualTestResult[];
  startTime: Date;
  endTime?: Date;
  passed: number;
  failed: number;
  skipped: number;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: VisualTestConfig = {
  baselineDir: path.join(process.cwd(), '.atlas', 'visual-tests', 'baselines'),
  actualDir: path.join(process.cwd(), '.atlas', 'visual-tests', 'actual'),
  diffDir: path.join(process.cwd(), '.atlas', 'visual-tests', 'diffs'),
  threshold: 0.1, // 10% pixel difference allowed
  failureThreshold: 0.5, // Fail if more than 0.5% of image differs
  format: 'png',
  updateBaselines: false,
  viewports: [
    { name: 'desktop', width: 1920, height: 1080 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'mobile', width: 375, height: 812 },
  ],
};

// ============================================================================
// Image Comparison
// ============================================================================

async function compareImages(
  baselineBuffer: Buffer,
  actualBuffer: Buffer,
  threshold: number
): Promise<DiffResult> {
  // Get sharp module (lazy loaded)
  const sharp = await getSharp();
  
  // Load images with sharp
  const baselineImg = sharp(baselineBuffer);
  const actualImg = sharp(actualBuffer);
  
  const [baselineMeta, actualMeta] = await Promise.all([
    baselineImg.metadata(),
    actualImg.metadata(),
  ]);
  
  // Ensure same dimensions
  if (baselineMeta.width !== actualMeta.width || baselineMeta.height !== actualMeta.height) {
    throw new Error('Image dimensions do not match');
  }
  
  const width = baselineMeta.width!;
  const height = baselineMeta.height!;
  const totalPixels = width * height;
  
  // Get raw pixel data
  const [baselineRaw, actualRaw] = await Promise.all([
    baselineImg.raw().toBuffer(),
    actualImg.raw().toBuffer(),
  ]);
  
  // Compare pixels
  let diffPixels = 0;
  const diffBuffer = Buffer.alloc(baselineRaw.length);
  
  const channels = baselineMeta.channels || 3;
  
  for (let i = 0; i < baselineRaw.length; i += channels) {
    const baselineR = baselineRaw[i];
    const baselineG = baselineRaw[i + 1];
    const baselineB = baselineRaw[i + 2];
    
    const actualR = actualRaw[i];
    const actualG = actualRaw[i + 1];
    const actualB = actualRaw[i + 2];
    
    // Calculate color difference
    const rDiff = Math.abs(baselineR - actualR) / 255;
    const gDiff = Math.abs(baselineG - actualG) / 255;
    const bDiff = Math.abs(baselineB - actualB) / 255;
    const avgDiff = (rDiff + gDiff + bDiff) / 3;
    
    if (avgDiff > threshold) {
      diffPixels++;
      // Mark diff pixel as red
      diffBuffer[i] = 255;
      diffBuffer[i + 1] = 0;
      diffBuffer[i + 2] = 0;
      if (channels === 4) diffBuffer[i + 3] = 255;
    } else {
      // Copy original pixel (grayscale for context)
      const gray = Math.round((actualR + actualG + actualB) / 3);
      diffBuffer[i] = gray;
      diffBuffer[i + 1] = gray;
      diffBuffer[i + 2] = gray;
      if (channels === 4) diffBuffer[i + 3] = actualRaw[i + 3];
    }
  }
  
  // Create diff image
  const diffImageBuffer = await sharp(diffBuffer, {
    raw: { width, height, channels },
  }).png().toBuffer();
  
  const diffPercentage = (diffPixels / totalPixels) * 100;
  
  return {
    diffPercentage,
    diffPixels,
    totalPixels,
    diffImageBuffer,
  };
}

// ============================================================================
// Visual Test Runner
// ============================================================================

export class VisualTestRunner extends EventEmitter {
  private config: VisualTestConfig;
  private activeSuite: VisualTestSuite | null = null;
  private testWindow: BrowserWindow | null = null;
  
  constructor(config?: Partial<VisualTestConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }
  
  // ==========================================================================
  // Setup
  // ==========================================================================
  
  async initialize(): Promise<void> {
    // Create directories
    await fs.mkdir(this.config.baselineDir, { recursive: true });
    await fs.mkdir(this.config.actualDir, { recursive: true });
    await fs.mkdir(this.config.diffDir, { recursive: true });
    
    logger.info('Visual Test Runner initialized');
    this.emit('initialized');
  }
  
  // ==========================================================================
  // Test Execution
  // ==========================================================================
  
  async runSuite(tests: VisualTest[]): Promise<VisualTestSuite> {
    const suite: VisualTestSuite = {
      name: `Visual Test Suite ${Date.now()}`,
      tests,
      results: [],
      startTime: new Date(),
      passed: 0,
      failed: 0,
      skipped: 0,
    };
    
    this.activeSuite = suite;
    this.emit('suiteStarted', suite);
    
    for (const test of tests) {
      const result = await this.runTest(test);
      suite.results.push(result);
      
      if (result.passed) {
        suite.passed++;
      } else {
        suite.failed++;
      }
      
      this.emit('testCompleted', result);
    }
    
    suite.endTime = new Date();
    this.activeSuite = null;
    
    this.emit('suiteCompleted', suite);
    
    // Generate report
    await this.generateReport(suite);
    
    return suite;
  }
  
  async runTest(test: VisualTest): Promise<VisualTestResult> {
    const startTime = Date.now();
    
    logger.info('Running visual test', { name: test.name, viewport: test.viewport.name });
    this.emit('testStarted', test);
    
    try {
      // Take screenshot
      const actualBuffer = await this.captureScreenshot(test);
      
      // Save actual screenshot
      const actualPath = this.getScreenshotPath('actual', test);
      await fs.writeFile(actualPath, actualBuffer);
      
      // Check for baseline
      const baselinePath = this.getScreenshotPath('baseline', test);
      let baselineExists = false;
      
      try {
        await fs.access(baselinePath);
        baselineExists = true;
      } catch {
        baselineExists = false;
      }
      
      if (!baselineExists) {
        // New test - save as baseline
        if (this.config.updateBaselines) {
          await fs.writeFile(baselinePath, actualBuffer);
          logger.info('Created new baseline', { test: test.name });
        }
        
        test.status = 'new';
        
        return {
          test,
          passed: true, // New tests pass by default
          diffPercentage: 0,
          actualPath,
          baselinePath: this.config.updateBaselines ? baselinePath : undefined,
          duration: Date.now() - startTime,
        };
      }
      
      // Compare with baseline
      const baselineBuffer = await fs.readFile(baselinePath);
      const diffResult = await compareImages(
        baselineBuffer,
        actualBuffer,
        this.config.threshold
      );
      
      const passed = diffResult.diffPercentage <= this.config.failureThreshold;
      test.status = passed ? 'passed' : 'failed';
      
      // Save diff image if there are differences
      let diffPath: string | undefined;
      if (diffResult.diffPercentage > 0) {
        diffPath = this.getScreenshotPath('diff', test);
        await fs.writeFile(diffPath, diffResult.diffImageBuffer);
      }
      
      // Update baseline if configured and test failed
      if (!passed && this.config.updateBaselines) {
        await fs.writeFile(baselinePath, actualBuffer);
        logger.info('Updated baseline', { test: test.name });
      }
      
      return {
        test,
        passed,
        diffPercentage: diffResult.diffPercentage,
        baselinePath,
        actualPath,
        diffPath,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      test.status = 'failed';
      
      return {
        test,
        passed: false,
        diffPercentage: 100,
        actualPath: '',
        error: (error as Error).message,
        duration: Date.now() - startTime,
      };
    }
  }
  
  // ==========================================================================
  // Screenshot Capture
  // ==========================================================================
  
  private async captureScreenshot(test: VisualTest): Promise<Buffer> {
    if (test.url) {
      return this.captureFromUrl(test);
    } else {
      return this.captureFromScreen(test);
    }
  }
  
  private async captureFromUrl(test: VisualTest): Promise<Buffer> {
    // Create hidden browser window
    if (!this.testWindow) {
      this.testWindow = new BrowserWindow({
        width: test.viewport.width,
        height: test.viewport.height,
        show: false,
        webPreferences: {
          offscreen: true,
        },
      });
    } else {
      this.testWindow.setSize(test.viewport.width, test.viewport.height);
    }
    
    // Load URL
    await this.testWindow.loadURL(test.url!);
    
    // Wait for content to load
    await sleep(1000);
    
    // Capture
    const image = await this.testWindow.webContents.capturePage();
    
    return image.toPNG();
  }
  
  private async captureFromScreen(test: VisualTest): Promise<Buffer> {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: test.viewport.width, height: test.viewport.height },
    });
    
    if (sources.length === 0) {
      throw new Error('No screen source available');
    }
    
    return sources[0].thumbnail.toPNG();
  }
  
  private getScreenshotPath(type: 'baseline' | 'actual' | 'diff', test: VisualTest): string {
    const dir = type === 'baseline'
      ? this.config.baselineDir
      : type === 'actual'
        ? this.config.actualDir
        : this.config.diffDir;
    
    const filename = `${test.component}_${test.name}_${test.viewport.name}.${this.config.format}`;
    const safeFilename = filename.replace(/[^a-zA-Z0-9_.-]/g, '_');
    
    return path.join(dir, safeFilename);
  }
  
  // ==========================================================================
  // Report Generation
  // ==========================================================================
  
  private async generateReport(suite: VisualTestSuite): Promise<void> {
    const reportPath = path.join(
      this.config.actualDir,
      '..',
      `report_${Date.now()}.html`
    );
    
    const html = this.generateHtmlReport(suite);
    await fs.writeFile(reportPath, html);
    
    logger.info('Report generated', { path: reportPath });
    this.emit('reportGenerated', reportPath);
  }
  
  private generateHtmlReport(suite: VisualTestSuite): string {
    const duration = suite.endTime
      ? (suite.endTime.getTime() - suite.startTime.getTime()) / 1000
      : 0;
    
    return `
<!DOCTYPE html>
<html>
<head>
  <title>Visual Test Report - ${suite.name}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
    .summary { background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .summary h1 { margin-top: 0; }
    .stats { display: flex; gap: 20px; }
    .stat { padding: 10px 20px; border-radius: 4px; }
    .stat.passed { background: #d4edda; color: #155724; }
    .stat.failed { background: #f8d7da; color: #721c24; }
    .stat.new { background: #fff3cd; color: #856404; }
    .tests { display: grid; gap: 20px; }
    .test { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .test.passed { border-left: 4px solid #28a745; }
    .test.failed { border-left: 4px solid #dc3545; }
    .test.new { border-left: 4px solid #ffc107; }
    .test h3 { margin-top: 0; }
    .images { display: flex; gap: 10px; flex-wrap: wrap; }
    .image-container { text-align: center; }
    .image-container img { max-width: 300px; border: 1px solid #ddd; }
    .image-container p { margin: 5px 0 0; font-size: 12px; color: #666; }
  </style>
</head>
<body>
  <div class="summary">
    <h1>Visual Test Report</h1>
    <p><strong>Suite:</strong> ${suite.name}</p>
    <p><strong>Duration:</strong> ${duration.toFixed(2)}s</p>
    <div class="stats">
      <div class="stat passed"><strong>${suite.passed}</strong> Passed</div>
      <div class="stat failed"><strong>${suite.failed}</strong> Failed</div>
    </div>
  </div>
  
  <div class="tests">
    ${suite.results.map(result => `
      <div class="test ${result.passed ? 'passed' : 'failed'}">
        <h3>${result.test.name} (${result.test.viewport.name})</h3>
        <p><strong>Component:</strong> ${result.test.component}</p>
        <p><strong>Status:</strong> ${result.passed ? '✅ Passed' : '❌ Failed'}</p>
        <p><strong>Diff:</strong> ${result.diffPercentage.toFixed(2)}%</p>
        <p><strong>Duration:</strong> ${result.duration}ms</p>
        ${result.error ? `<p><strong>Error:</strong> ${result.error}</p>` : ''}
        <div class="images">
          ${result.baselinePath ? `
            <div class="image-container">
              <img src="file://${result.baselinePath}" alt="Baseline">
              <p>Baseline</p>
            </div>
          ` : ''}
          <div class="image-container">
            <img src="file://${result.actualPath}" alt="Actual">
            <p>Actual</p>
          </div>
          ${result.diffPath ? `
            <div class="image-container">
              <img src="file://${result.diffPath}" alt="Diff">
              <p>Diff</p>
            </div>
          ` : ''}
        </div>
      </div>
    `).join('')}
  </div>
</body>
</html>
    `;
  }
  
  // ==========================================================================
  // Utilities
  // ==========================================================================
  
  async updateBaseline(test: VisualTest): Promise<void> {
    const actualPath = this.getScreenshotPath('actual', test);
    const baselinePath = this.getScreenshotPath('baseline', test);
    
    await fs.copyFile(actualPath, baselinePath);
    logger.info('Baseline updated', { test: test.name });
    this.emit('baselineUpdated', test);
  }
  
  async updateAllBaselines(suite: VisualTestSuite): Promise<void> {
    for (const result of suite.results) {
      if (!result.passed) {
        await this.updateBaseline(result.test);
      }
    }
  }
  
  setConfig(config: Partial<VisualTestConfig>): void {
    this.config = { ...this.config, ...config };
  }
  
  getConfig(): VisualTestConfig {
    return { ...this.config };
  }
  
  cleanup(): void {
    if (this.testWindow) {
      this.testWindow.close();
      this.testWindow = null;
    }
  }
}

// ============================================================================
// Test Builder
// ============================================================================

export class VisualTestBuilder {
  private tests: VisualTest[] = [];
  private component: string = '';
  private viewports: Viewport[] = DEFAULT_CONFIG.viewports;
  
  forComponent(component: string): this {
    this.component = component;
    return this;
  }
  
  withViewports(viewports: Viewport[]): this {
    this.viewports = viewports;
    return this;
  }
  
  addTest(name: string, options: { url?: string; selector?: string } = {}): this {
    for (const viewport of this.viewports) {
      this.tests.push({
        id: `${this.component}_${name}_${viewport.name}_${Date.now()}`,
        name,
        component: this.component,
        url: options.url,
        selector: options.selector,
        viewport,
        status: 'pending',
      });
    }
    return this;
  }
  
  build(): VisualTest[] {
    return this.tests;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: VisualTestRunner | null = null;

export function getVisualTestRunner(): VisualTestRunner {
  if (!instance) {
    instance = new VisualTestRunner();
  }
  return instance;
}

export async function initializeVisualTesting(
  config?: Partial<VisualTestConfig>
): Promise<VisualTestRunner> {
  if (instance) {
    instance.cleanup();
  }
  instance = new VisualTestRunner(config);
  await instance.initialize();
  return instance;
}

export default {
  VisualTestRunner,
  VisualTestBuilder,
  getVisualTestRunner,
  initializeVisualTesting,
};
