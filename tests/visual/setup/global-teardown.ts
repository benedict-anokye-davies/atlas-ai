/**
 * Atlas Desktop - Visual Testing Global Teardown
 *
 * Runs once after all visual tests to clean up and generate reports.
 */

import { FullConfig } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const VISUAL_DIR = path.join(__dirname, '..');
const DIFF_DIR = path.join(VISUAL_DIR, 'diffs');
const REPORT_DIR = path.join(VISUAL_DIR, 'reports');

interface TestResult {
  testName: string;
  passed: boolean;
  diffPixels?: number;
  diffPercentage?: number;
  baselineImage?: string;
  actualImage?: string;
  diffImage?: string;
}

interface VisualReport {
  timestamp: string;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  results: TestResult[];
}

async function globalTeardown(_config: FullConfig): Promise<void> {
  console.log('[Visual Tests] Starting global teardown...');

  // Generate visual diff report
  const report = await generateVisualReport();

  // Write report summary
  const reportPath = path.join(REPORT_DIR, 'visual-summary.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log('[Visual Tests] Visual report written to:', reportPath);

  // Generate HTML summary
  const htmlReport = generateHTMLReport(report);
  const htmlPath = path.join(REPORT_DIR, 'visual-summary.html');
  fs.writeFileSync(htmlPath, htmlReport);
  console.log('[Visual Tests] HTML report written to:', htmlPath);

  // Log summary
  console.log('[Visual Tests] ================================');
  console.log(`[Visual Tests] Total Tests: ${report.totalTests}`);
  console.log(`[Visual Tests] Passed: ${report.passedTests}`);
  console.log(`[Visual Tests] Failed: ${report.failedTests}`);
  console.log('[Visual Tests] ================================');

  console.log('[Visual Tests] Global teardown complete');
}

async function generateVisualReport(): Promise<VisualReport> {
  const results: TestResult[] = [];

  // Check for diff images in the diff directory
  if (fs.existsSync(DIFF_DIR)) {
    const files = fs.readdirSync(DIFF_DIR, { recursive: true }) as string[];
    const diffFiles = files.filter(
      (f) => typeof f === 'string' && f.endsWith('-diff.png')
    );

    for (const diffFile of diffFiles) {
      const testName = path.basename(diffFile, '-diff.png');
      results.push({
        testName,
        passed: false,
        diffImage: path.join(DIFF_DIR, diffFile),
        // Actual diff metrics would be populated by test framework
      });
    }
  }

  // Read Playwright's JSON results if available
  const resultsPath = path.join(REPORT_DIR, 'results.json');
  if (fs.existsSync(resultsPath)) {
    try {
      const playwrightResults = JSON.parse(fs.readFileSync(resultsPath, 'utf-8'));

      // Process suites recursively
      const processResults = (suites: unknown[]): void => {
        for (const suite of suites) {
          const typedSuite = suite as {
            title?: string;
            specs?: Array<{
              title: string;
              ok: boolean;
              tests?: Array<{ status: string }>;
            }>;
            suites?: unknown[];
          };

          if (typedSuite.specs) {
            for (const spec of typedSuite.specs) {
              const existingResult = results.find((r) => r.testName === spec.title);
              if (existingResult) {
                existingResult.passed = spec.ok;
              } else {
                results.push({
                  testName: spec.title,
                  passed: spec.ok,
                });
              }
            }
          }
          if (typedSuite.suites) {
            processResults(typedSuite.suites);
          }
        }
      };

      if (playwrightResults.suites) {
        processResults(playwrightResults.suites);
      }
    } catch {
      // Results file might not exist or be malformed on first run
    }
  }

  const passedTests = results.filter((r) => r.passed).length;

  return {
    timestamp: new Date().toISOString(),
    totalTests: results.length,
    passedTests,
    failedTests: results.length - passedTests,
    results,
  };
}

function generateHTMLReport(report: VisualReport): string {
  const failedResults = report.results.filter((r) => !r.passed);
  const passedResults = report.results.filter((r) => r.passed);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Atlas Visual Regression Report</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      margin: 0;
      padding: 20px;
      background: #0a0a0f;
      color: #e0e0e0;
    }
    .header {
      text-align: center;
      margin-bottom: 40px;
      padding: 20px;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      border-radius: 12px;
      border: 1px solid #333;
    }
    h1 {
      margin: 0 0 10px;
      color: #00d4ff;
    }
    .timestamp {
      color: #888;
      font-size: 0.9rem;
    }
    .summary {
      display: flex;
      gap: 20px;
      justify-content: center;
      margin: 20px 0;
    }
    .stat {
      padding: 15px 30px;
      background: #1a1a2e;
      border-radius: 8px;
      text-align: center;
    }
    .stat-value {
      font-size: 2rem;
      font-weight: bold;
    }
    .stat-label {
      font-size: 0.8rem;
      color: #888;
      text-transform: uppercase;
    }
    .stat.passed .stat-value { color: #22c55e; }
    .stat.failed .stat-value { color: #ef4444; }
    .stat.total .stat-value { color: #00d4ff; }
    .section {
      margin: 30px 0;
    }
    .section-title {
      font-size: 1.2rem;
      margin-bottom: 15px;
      color: #00d4ff;
      border-bottom: 1px solid #333;
      padding-bottom: 10px;
    }
    .test-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 20px;
    }
    .test-card {
      background: #1a1a2e;
      border-radius: 8px;
      overflow: hidden;
      border: 1px solid #333;
    }
    .test-card.failed {
      border-color: #ef4444;
    }
    .test-card.passed {
      border-color: #22c55e;
    }
    .test-header {
      padding: 12px 15px;
      background: rgba(0, 0, 0, 0.3);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .test-name {
      font-weight: 500;
      font-size: 0.9rem;
    }
    .test-status {
      padding: 4px 12px;
      border-radius: 4px;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
    }
    .test-status.passed {
      background: rgba(34, 197, 94, 0.2);
      color: #22c55e;
    }
    .test-status.failed {
      background: rgba(239, 68, 68, 0.2);
      color: #ef4444;
    }
    .test-images {
      display: flex;
      gap: 10px;
      padding: 15px;
      overflow-x: auto;
    }
    .test-image {
      flex: 0 0 auto;
    }
    .test-image img {
      max-width: 200px;
      border-radius: 4px;
      border: 1px solid #333;
    }
    .test-image-label {
      font-size: 0.75rem;
      color: #888;
      margin-top: 5px;
      text-align: center;
    }
    .no-tests {
      text-align: center;
      padding: 40px;
      color: #888;
    }
    .diff-info {
      padding: 10px 15px;
      font-size: 0.8rem;
      color: #888;
      border-top: 1px solid #333;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Atlas Visual Regression Report</h1>
    <div class="timestamp">Generated: ${new Date(report.timestamp).toLocaleString()}</div>
    <div class="summary">
      <div class="stat total">
        <div class="stat-value">${report.totalTests}</div>
        <div class="stat-label">Total Tests</div>
      </div>
      <div class="stat passed">
        <div class="stat-value">${report.passedTests}</div>
        <div class="stat-label">Passed</div>
      </div>
      <div class="stat failed">
        <div class="stat-value">${report.failedTests}</div>
        <div class="stat-label">Failed</div>
      </div>
    </div>
  </div>

  ${
    failedResults.length > 0
      ? `
  <div class="section">
    <h2 class="section-title">Failed Tests</h2>
    <div class="test-grid">
      ${failedResults
        .map(
          (result) => `
        <div class="test-card failed">
          <div class="test-header">
            <span class="test-name">${result.testName}</span>
            <span class="test-status failed">Failed</span>
          </div>
          ${
            result.diffImage || result.baselineImage || result.actualImage
              ? `
          <div class="test-images">
            ${
              result.baselineImage
                ? `
              <div class="test-image">
                <img src="${result.baselineImage}" alt="Baseline">
                <div class="test-image-label">Baseline</div>
              </div>
            `
                : ''
            }
            ${
              result.actualImage
                ? `
              <div class="test-image">
                <img src="${result.actualImage}" alt="Actual">
                <div class="test-image-label">Actual</div>
              </div>
            `
                : ''
            }
            ${
              result.diffImage
                ? `
              <div class="test-image">
                <img src="${result.diffImage}" alt="Diff">
                <div class="test-image-label">Diff</div>
              </div>
            `
                : ''
            }
          </div>
          `
              : ''
          }
          ${
            result.diffPixels !== undefined || result.diffPercentage !== undefined
              ? `
          <div class="diff-info">
            ${result.diffPixels !== undefined ? `Different pixels: ${result.diffPixels}` : ''}
            ${result.diffPercentage !== undefined ? ` (${result.diffPercentage.toFixed(2)}%)` : ''}
          </div>
          `
              : ''
          }
        </div>
      `
        )
        .join('')}
    </div>
  </div>
  `
      : ''
  }

  ${
    passedResults.length > 0
      ? `
  <div class="section">
    <h2 class="section-title">Passed Tests</h2>
    <div class="test-grid">
      ${passedResults
        .map(
          (result) => `
        <div class="test-card passed">
          <div class="test-header">
            <span class="test-name">${result.testName}</span>
            <span class="test-status passed">Passed</span>
          </div>
        </div>
      `
        )
        .join('')}
    </div>
  </div>
  `
      : ''
  }

  ${
    report.results.length === 0
      ? `
  <div class="no-tests">
    No visual tests have been run yet. Run <code>npm run test:visual</code> to generate results.
  </div>
  `
      : ''
  }
</body>
</html>`;
}

export default globalTeardown;
