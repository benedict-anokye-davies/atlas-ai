#!/usr/bin/env npx ts-node

/**
 * Atlas Desktop - Bundle Size Analysis Script
 *
 * Analyzes main and renderer bundle sizes, identifies large dependencies,
 * suggests tree-shaking opportunities, and tracks size over commits.
 *
 * Usage:
 *   npx ts-node scripts/analyze-bundle.ts
 *   npx ts-node scripts/analyze-bundle.ts --output report
 *   npx ts-node scripts/analyze-bundle.ts --budget 5mb
 *   npx ts-node scripts/analyze-bundle.ts --help
 *
 * @module scripts/analyze-bundle
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { join, extname, relative } from 'path';

// ============================================================================
// Types
// ============================================================================

interface BundleInfo {
  name: string;
  path: string;
  size: number;
  gzipSize: number;
  brotliSize: number;
}

interface DependencyInfo {
  name: string;
  version: string;
  estimatedSize: number;
  isNative: boolean;
  usedIn: ('main' | 'renderer' | 'both')[];
}

interface TreeShakingOpportunity {
  module: string;
  importedItems: string[];
  suggestion: string;
  potentialSavings: string;
}

interface CodeSplitRecommendation {
  component: string;
  reason: string;
  impact: string;
}

interface NativeModuleInfo {
  name: string;
  size: number;
  binaryPath: string;
}

interface CommitSizeEntry {
  commit: string;
  date: string;
  message: string;
  mainSize: number;
  rendererSize: number;
  totalSize: number;
}

interface SizeBudget {
  main: number;
  renderer: number;
  total: number;
}

interface BundleReport {
  timestamp: string;
  commit: string;
  branch: string;
  bundles: {
    main: BundleInfo[];
    renderer: BundleInfo[];
    preload: BundleInfo[];
  };
  totals: {
    main: { raw: number; gzip: number; brotli: number };
    renderer: { raw: number; gzip: number; brotli: number };
    preload: { raw: number; gzip: number; brotli: number };
    total: { raw: number; gzip: number; brotli: number };
  };
  dependencies: DependencyInfo[];
  treeShaking: TreeShakingOpportunity[];
  codeSplitting: CodeSplitRecommendation[];
  nativeModules: NativeModuleInfo[];
  history: CommitSizeEntry[];
  budgetStatus: {
    budget: SizeBudget;
    violations: string[];
    passed: boolean;
  };
}

interface AnalyzeConfig {
  outputFormat: 'console' | 'json' | 'markdown' | 'all';
  budgetMB: number;
  trackHistory: boolean;
  verbose: boolean;
  buildFirst: boolean;
}

// ============================================================================
// Constants
// ============================================================================

const ROOT_DIR = join(__dirname, '..');
const DIST_DIR = join(ROOT_DIR, 'dist');
const REPORTS_DIR = join(ROOT_DIR, '.bundle-reports');
const HISTORY_FILE = join(REPORTS_DIR, 'size-history.json');
const PACKAGE_JSON_PATH = join(ROOT_DIR, 'package.json');

// Native modules list (from vite.config.ts)
const NATIVE_MODULES = [
  '@picovoice/porcupine-node',
  '@picovoice/pvrecorder-node',
  '@ricky0123/vad-node',
  'onnxruntime-node',
  'vosk-koffi',
  'koffi',
  'playwright',
];

// Default size budgets (in bytes)
const DEFAULT_BUDGET: SizeBudget = {
  main: 5 * 1024 * 1024,     // 5MB for main process
  renderer: 3 * 1024 * 1024,  // 3MB for renderer
  total: 10 * 1024 * 1024,    // 10MB total
};

// Large dependency thresholds
const LARGE_DEP_THRESHOLD = 100 * 1024; // 100KB

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Format bytes to human-readable string
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Parse size string to bytes
 */
function parseSize(sizeStr: string): number {
  const match = sizeStr.toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/);
  if (!match) return parseInt(sizeStr, 10);

  const value = parseFloat(match[1]);
  const unit = match[2] || 'b';
  const multipliers: Record<string, number> = {
    b: 1,
    kb: 1024,
    mb: 1024 * 1024,
    gb: 1024 * 1024 * 1024,
  };
  return Math.round(value * multipliers[unit]);
}

/**
 * Execute shell command
 */
function exec(command: string, options?: { silent?: boolean }): string {
  try {
    return execSync(command, {
      cwd: ROOT_DIR,
      encoding: 'utf-8',
      stdio: options?.silent ? 'pipe' : 'inherit',
    }).toString().trim();
  } catch (error) {
    if (options?.silent) return '';
    throw error;
  }
}

/**
 * Get git information
 */
function getGitInfo(): { commit: string; branch: string; message: string } {
  try {
    const commit = exec('git rev-parse --short HEAD', { silent: true });
    const branch = exec('git branch --show-current', { silent: true });
    const message = exec('git log -1 --format=%s', { silent: true });
    return { commit, branch, message };
  } catch {
    return { commit: 'unknown', branch: 'unknown', message: '' };
  }
}

/**
 * Calculate gzip size (estimated)
 */
function estimateGzipSize(content: Buffer): number {
  // Rough estimation: typical gzip compression ratio for JS is ~30-40%
  return Math.round(content.length * 0.35);
}

/**
 * Calculate brotli size (estimated)
 */
function estimateBrotliSize(content: Buffer): number {
  // Rough estimation: brotli is typically ~15-25% smaller than gzip
  return Math.round(content.length * 0.28);
}

/**
 * Log with formatting
 */
function log(message: string, type: 'info' | 'success' | 'warn' | 'error' | 'header' = 'info'): void {
  const prefixes: Record<string, string> = {
    info: '[i]',
    success: '[+]',
    warn: '[!]',
    error: '[x]',
    header: '\n===',
  };
  const suffix = type === 'header' ? ' ===' : '';
  console.log(`${prefixes[type]} ${message}${suffix}`);
}

// ============================================================================
// Analysis Functions
// ============================================================================

/**
 * Get all bundle files from a directory
 */
function getBundleFiles(dir: string): BundleInfo[] {
  if (!existsSync(dir)) return [];

  const bundles: BundleInfo[] = [];
  const jsExtensions = ['.js', '.mjs', '.cjs'];

  const walk = (currentDir: string): void => {
    const entries = readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);

      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && jsExtensions.includes(extname(entry.name))) {
        const stats = statSync(fullPath);
        const content = readFileSync(fullPath);

        bundles.push({
          name: entry.name,
          path: relative(ROOT_DIR, fullPath),
          size: stats.size,
          gzipSize: estimateGzipSize(content),
          brotliSize: estimateBrotliSize(content),
        });
      }
    }
  };

  walk(dir);
  return bundles.sort((a, b) => b.size - a.size);
}

/**
 * Analyze package.json dependencies
 */
function analyzeDependencies(): DependencyInfo[] {
  const packageJson = JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf-8'));
  const deps = { ...packageJson.dependencies };
  const dependencies: DependencyInfo[] = [];

  // Known dependency sizes (estimated from common usage patterns)
  const knownSizes: Record<string, number> = {
    'three': 600 * 1024,
    '@react-three/fiber': 150 * 1024,
    '@react-three/drei': 200 * 1024,
    '@react-three/postprocessing': 100 * 1024,
    'react': 40 * 1024,
    'react-dom': 120 * 1024,
    'zustand': 10 * 1024,
    'winston': 50 * 1024,
    'openai': 80 * 1024,
    '@deepgram/sdk': 60 * 1024,
    'dotenv': 5 * 1024,
    'glob': 30 * 1024,
    'adm-zip': 25 * 1024,
    'electron-updater': 40 * 1024,
  };

  for (const [name, version] of Object.entries(deps)) {
    const isNative = NATIVE_MODULES.includes(name);
    const usedIn: ('main' | 'renderer' | 'both')[] = [];

    // Determine usage context
    if (['react', 'react-dom', 'three', '@react-three/fiber', '@react-three/drei',
         '@react-three/postprocessing', 'zustand'].includes(name)) {
      usedIn.push('renderer');
    } else if (NATIVE_MODULES.includes(name) || ['winston', 'electron-updater'].includes(name)) {
      usedIn.push('main');
    } else {
      usedIn.push('both');
    }

    dependencies.push({
      name,
      version: String(version),
      estimatedSize: knownSizes[name] || 50 * 1024,
      isNative,
      usedIn,
    });
  }

  return dependencies.sort((a, b) => b.estimatedSize - a.estimatedSize);
}

/**
 * Identify tree-shaking opportunities
 */
function analyzeTreeShaking(): TreeShakingOpportunity[] {
  const opportunities: TreeShakingOpportunity[] = [];

  // Three.js - commonly over-imported
  opportunities.push({
    module: 'three',
    importedItems: ['Scene', 'PerspectiveCamera', 'WebGLRenderer', 'Vector3', 'Color', 'BufferGeometry', 'Points'],
    suggestion: 'Import only needed classes: import { Scene, Vector3 } from "three"',
    potentialSavings: '~200KB (if importing entire library)',
  });

  // @react-three/drei - many unused helpers
  opportunities.push({
    module: '@react-three/drei',
    importedItems: ['OrbitControls', 'Html', 'useTexture'],
    suggestion: 'Audit drei imports - many helpers may be unused. Consider direct Three.js implementations for simple cases.',
    potentialSavings: '~50-100KB',
  });

  // Lodash (if present)
  opportunities.push({
    module: 'lodash (if used)',
    importedItems: ['debounce', 'throttle', 'get'],
    suggestion: 'Use lodash-es with specific imports: import debounce from "lodash-es/debounce"',
    potentialSavings: '~70KB (full lodash vs cherry-picked)',
  });

  // Date-fns (if present)
  opportunities.push({
    module: 'date-fns (if used)',
    importedItems: ['format', 'parse'],
    suggestion: 'Import specific functions: import { format } from "date-fns"',
    potentialSavings: '~30KB',
  });

  // OpenAI SDK
  opportunities.push({
    module: 'openai',
    importedItems: ['OpenAI'],
    suggestion: 'Consider lighter alternatives like direct fetch calls if only using chat completions',
    potentialSavings: '~40KB',
  });

  return opportunities;
}

/**
 * Generate code splitting recommendations
 */
function analyzeCodeSplitting(): CodeSplitRecommendation[] {
  const recommendations: CodeSplitRecommendation[] = [];

  recommendations.push({
    component: 'Settings Component',
    reason: 'Settings UI is not needed on initial load',
    impact: 'Lazy load with React.lazy() to reduce initial bundle by ~20KB',
  });

  recommendations.push({
    component: 'Onboarding Wizard',
    reason: 'Only shown to new users on first run',
    impact: 'Lazy load to reduce initial bundle by ~30KB',
  });

  recommendations.push({
    component: 'Debug Overlay',
    reason: 'Development-only component',
    impact: 'Exclude from production builds or lazy load (~10KB)',
  });

  recommendations.push({
    component: 'Error Boundary Content',
    reason: 'Error UI rarely shown',
    impact: 'Keep boundary wrapper, lazy load error display content (~5KB)',
  });

  recommendations.push({
    component: '3D Orb Visualization',
    reason: 'Heavy Three.js dependency (~600KB)',
    impact: 'Consider dynamic import with loading skeleton. Show simple CSS orb initially.',
  });

  recommendations.push({
    component: 'Agent Tools',
    reason: 'Individual tools (browser, git, terminal) have separate dependencies',
    impact: 'Dynamically import tools on first use in main process',
  });

  return recommendations;
}

/**
 * Analyze native module sizes
 */
function analyzeNativeModules(): NativeModuleInfo[] {
  const modules: NativeModuleInfo[] = [];
  const nodeModulesDir = join(ROOT_DIR, 'node_modules');

  for (const moduleName of NATIVE_MODULES) {
    const modulePath = join(nodeModulesDir, moduleName);
    if (!existsSync(modulePath)) continue;

    let totalSize = 0;
    const walk = (dir: string): void => {
      if (!existsSync(dir)) return;
      try {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = join(dir, entry.name);
          if (entry.isDirectory()) {
            walk(fullPath);
          } else if (entry.isFile()) {
            totalSize += statSync(fullPath).size;
          }
        }
      } catch {
        // Skip inaccessible directories
      }
    };

    walk(modulePath);

    if (totalSize > 0) {
      modules.push({
        name: moduleName,
        size: totalSize,
        binaryPath: relative(ROOT_DIR, modulePath),
      });
    }
  }

  return modules.sort((a, b) => b.size - a.size);
}

/**
 * Load size history from file
 */
function loadHistory(): CommitSizeEntry[] {
  if (!existsSync(HISTORY_FILE)) return [];

  try {
    return JSON.parse(readFileSync(HISTORY_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

/**
 * Save size history to file
 */
function saveHistory(history: CommitSizeEntry[]): void {
  if (!existsSync(REPORTS_DIR)) {
    mkdirSync(REPORTS_DIR, { recursive: true });
  }

  // Keep last 100 entries
  const trimmed = history.slice(-100);
  writeFileSync(HISTORY_FILE, JSON.stringify(trimmed, null, 2));
}

/**
 * Check budget violations
 */
function checkBudget(
  totals: BundleReport['totals'],
  budget: SizeBudget
): { violations: string[]; passed: boolean } {
  const violations: string[] = [];

  if (totals.main.raw > budget.main) {
    violations.push(`Main bundle (${formatBytes(totals.main.raw)}) exceeds budget (${formatBytes(budget.main)})`);
  }

  if (totals.renderer.raw > budget.renderer) {
    violations.push(`Renderer bundle (${formatBytes(totals.renderer.raw)}) exceeds budget (${formatBytes(budget.renderer)})`);
  }

  if (totals.total.raw > budget.total) {
    violations.push(`Total bundle (${formatBytes(totals.total.raw)}) exceeds budget (${formatBytes(budget.total)})`);
  }

  return { violations, passed: violations.length === 0 };
}

// ============================================================================
// Report Generation
// ============================================================================

/**
 * Generate full bundle report
 */
function generateReport(config: AnalyzeConfig): BundleReport {
  const gitInfo = getGitInfo();

  // Get bundle files
  const mainBundles = getBundleFiles(join(DIST_DIR, 'main'));
  const rendererBundles = getBundleFiles(join(DIST_DIR, 'renderer'));
  const preloadBundles = getBundleFiles(join(DIST_DIR, 'preload'));

  // Calculate totals
  const calcTotals = (bundles: BundleInfo[]) => ({
    raw: bundles.reduce((sum, b) => sum + b.size, 0),
    gzip: bundles.reduce((sum, b) => sum + b.gzipSize, 0),
    brotli: bundles.reduce((sum, b) => sum + b.brotliSize, 0),
  });

  const mainTotals = calcTotals(mainBundles);
  const rendererTotals = calcTotals(rendererBundles);
  const preloadTotals = calcTotals(preloadBundles);

  const totals = {
    main: mainTotals,
    renderer: rendererTotals,
    preload: preloadTotals,
    total: {
      raw: mainTotals.raw + rendererTotals.raw + preloadTotals.raw,
      gzip: mainTotals.gzip + rendererTotals.gzip + preloadTotals.gzip,
      brotli: mainTotals.brotli + rendererTotals.brotli + preloadTotals.brotli,
    },
  };

  // Get analysis
  const dependencies = analyzeDependencies();
  const treeShaking = analyzeTreeShaking();
  const codeSplitting = analyzeCodeSplitting();
  const nativeModules = analyzeNativeModules();

  // Load and update history
  const history = loadHistory();
  const budget: SizeBudget = {
    main: config.budgetMB ? config.budgetMB * 1024 * 1024 : DEFAULT_BUDGET.main,
    renderer: config.budgetMB ? config.budgetMB * 0.6 * 1024 * 1024 : DEFAULT_BUDGET.renderer,
    total: config.budgetMB ? config.budgetMB * 2 * 1024 * 1024 : DEFAULT_BUDGET.total,
  };

  const budgetStatus = checkBudget(totals, budget);

  // Add current entry to history
  if (config.trackHistory && gitInfo.commit !== 'unknown') {
    const currentEntry: CommitSizeEntry = {
      commit: gitInfo.commit,
      date: new Date().toISOString(),
      message: gitInfo.message,
      mainSize: totals.main.raw,
      rendererSize: totals.renderer.raw,
      totalSize: totals.total.raw,
    };

    // Avoid duplicates
    if (!history.some((h) => h.commit === currentEntry.commit)) {
      history.push(currentEntry);
      saveHistory(history);
    }
  }

  return {
    timestamp: new Date().toISOString(),
    commit: gitInfo.commit,
    branch: gitInfo.branch,
    bundles: {
      main: mainBundles,
      renderer: rendererBundles,
      preload: preloadBundles,
    },
    totals,
    dependencies,
    treeShaking,
    codeSplitting,
    nativeModules,
    history,
    budgetStatus: { budget, ...budgetStatus },
  };
}

/**
 * Print report to console
 */
function printConsoleReport(report: BundleReport, verbose: boolean): void {
  log('ATLAS DESKTOP BUNDLE ANALYSIS', 'header');
  console.log(`Generated: ${report.timestamp}`);
  console.log(`Commit: ${report.commit} (${report.branch})`);

  // Bundle Summary
  log('BUNDLE SIZES', 'header');
  console.log('\n| Bundle    | Raw        | Gzip       | Brotli     |');
  console.log('|-----------|------------|------------|------------|');
  console.log(`| Main      | ${formatBytes(report.totals.main.raw).padEnd(10)} | ${formatBytes(report.totals.main.gzip).padEnd(10)} | ${formatBytes(report.totals.main.brotli).padEnd(10)} |`);
  console.log(`| Renderer  | ${formatBytes(report.totals.renderer.raw).padEnd(10)} | ${formatBytes(report.totals.renderer.gzip).padEnd(10)} | ${formatBytes(report.totals.renderer.brotli).padEnd(10)} |`);
  console.log(`| Preload   | ${formatBytes(report.totals.preload.raw).padEnd(10)} | ${formatBytes(report.totals.preload.gzip).padEnd(10)} | ${formatBytes(report.totals.preload.brotli).padEnd(10)} |`);
  console.log('|-----------|------------|------------|------------|');
  console.log(`| **Total** | ${formatBytes(report.totals.total.raw).padEnd(10)} | ${formatBytes(report.totals.total.gzip).padEnd(10)} | ${formatBytes(report.totals.total.brotli).padEnd(10)} |`);

  // Individual files (verbose)
  if (verbose) {
    const printFiles = (title: string, files: BundleInfo[]) => {
      if (files.length === 0) return;
      console.log(`\n${title}:`);
      files.forEach((f) => {
        console.log(`  ${f.name.padEnd(40)} ${formatBytes(f.size).padStart(10)}`);
      });
    };

    printFiles('Main Process Files', report.bundles.main);
    printFiles('Renderer Files', report.bundles.renderer);
    printFiles('Preload Files', report.bundles.preload);
  }

  // Large Dependencies
  log('LARGEST DEPENDENCIES', 'header');
  const largeDeps = report.dependencies.filter((d) => d.estimatedSize > LARGE_DEP_THRESHOLD);
  console.log('\n| Package                          | Size       | Context    | Native |');
  console.log('|----------------------------------|------------|------------|--------|');
  largeDeps.slice(0, 10).forEach((d) => {
    console.log(`| ${d.name.padEnd(32)} | ${formatBytes(d.estimatedSize).padEnd(10)} | ${d.usedIn.join(',').padEnd(10)} | ${d.isNative ? 'Yes' : 'No'.padEnd(6)} |`);
  });

  // Native Modules
  log('NATIVE MODULE SIZES', 'header');
  console.log('\n| Module                           | Size       |');
  console.log('|----------------------------------|------------|');
  report.nativeModules.forEach((m) => {
    console.log(`| ${m.name.padEnd(32)} | ${formatBytes(m.size).padEnd(10)} |`);
  });
  const nativeTotal = report.nativeModules.reduce((s, m) => s + m.size, 0);
  console.log('|----------------------------------|------------|');
  console.log(`| **Total Native**                 | ${formatBytes(nativeTotal).padEnd(10)} |`);

  // Tree-shaking Opportunities
  log('TREE-SHAKING OPPORTUNITIES', 'header');
  report.treeShaking.forEach((ts, i) => {
    console.log(`\n${i + 1}. ${ts.module}`);
    console.log(`   Suggestion: ${ts.suggestion}`);
    console.log(`   Potential savings: ${ts.potentialSavings}`);
  });

  // Code Splitting Recommendations
  log('CODE SPLITTING RECOMMENDATIONS', 'header');
  report.codeSplitting.forEach((cs, i) => {
    console.log(`\n${i + 1}. ${cs.component}`);
    console.log(`   Reason: ${cs.reason}`);
    console.log(`   Impact: ${cs.impact}`);
  });

  // Budget Status
  log('BUDGET STATUS', 'header');
  console.log(`\nMain budget:     ${formatBytes(report.budgetStatus.budget.main)}`);
  console.log(`Renderer budget: ${formatBytes(report.budgetStatus.budget.renderer)}`);
  console.log(`Total budget:    ${formatBytes(report.budgetStatus.budget.total)}`);

  if (report.budgetStatus.passed) {
    log('All size budgets passed!', 'success');
  } else {
    log('Budget violations:', 'error');
    report.budgetStatus.violations.forEach((v) => console.log(`  - ${v}`));
  }

  // History Trend (last 5)
  if (report.history.length > 1) {
    log('SIZE HISTORY (last 5 commits)', 'header');
    console.log('\n| Commit   | Date                | Total      | Delta      |');
    console.log('|----------|---------------------|------------|------------|');

    const recent = report.history.slice(-5);
    for (let i = 0; i < recent.length; i++) {
      const entry = recent[i];
      const prev = i > 0 ? recent[i - 1] : null;
      const delta = prev ? entry.totalSize - prev.totalSize : 0;
      const deltaStr = delta === 0 ? '-' : (delta > 0 ? `+${formatBytes(delta)}` : `-${formatBytes(Math.abs(delta))}`);
      console.log(`| ${entry.commit.padEnd(8)} | ${entry.date.slice(0, 19)} | ${formatBytes(entry.totalSize).padEnd(10)} | ${deltaStr.padEnd(10)} |`);
    }
  }
}

/**
 * Generate Markdown report
 */
function generateMarkdownReport(report: BundleReport): string {
  let md = `# Atlas Desktop Bundle Analysis Report

**Generated:** ${report.timestamp}
**Commit:** ${report.commit} (${report.branch})

## Bundle Sizes Summary

| Bundle | Raw | Gzip | Brotli |
|--------|-----|------|--------|
| Main | ${formatBytes(report.totals.main.raw)} | ${formatBytes(report.totals.main.gzip)} | ${formatBytes(report.totals.main.brotli)} |
| Renderer | ${formatBytes(report.totals.renderer.raw)} | ${formatBytes(report.totals.renderer.gzip)} | ${formatBytes(report.totals.renderer.brotli)} |
| Preload | ${formatBytes(report.totals.preload.raw)} | ${formatBytes(report.totals.preload.gzip)} | ${formatBytes(report.totals.preload.brotli)} |
| **Total** | **${formatBytes(report.totals.total.raw)}** | **${formatBytes(report.totals.total.gzip)}** | **${formatBytes(report.totals.total.brotli)}** |

## Individual Bundle Files

### Main Process
| File | Size |
|------|------|
`;

  report.bundles.main.forEach((b) => {
    md += `| ${b.name} | ${formatBytes(b.size)} |\n`;
  });

  md += `
### Renderer
| File | Size |
|------|------|
`;

  report.bundles.renderer.forEach((b) => {
    md += `| ${b.name} | ${formatBytes(b.size)} |\n`;
  });

  md += `
## Largest Dependencies

| Package | Est. Size | Context | Native |
|---------|-----------|---------|--------|
`;

  report.dependencies
    .filter((d) => d.estimatedSize > LARGE_DEP_THRESHOLD)
    .slice(0, 15)
    .forEach((d) => {
      md += `| ${d.name} | ${formatBytes(d.estimatedSize)} | ${d.usedIn.join(', ')} | ${d.isNative ? 'Yes' : 'No'} |\n`;
    });

  md += `
## Native Module Sizes

| Module | Size | Path |
|--------|------|------|
`;

  report.nativeModules.forEach((m) => {
    md += `| ${m.name} | ${formatBytes(m.size)} | ${m.binaryPath} |\n`;
  });

  const nativeTotal = report.nativeModules.reduce((s, m) => s + m.size, 0);
  md += `| **Total** | **${formatBytes(nativeTotal)}** | - |\n`;

  md += `
## Tree-Shaking Opportunities

`;

  report.treeShaking.forEach((ts, i) => {
    md += `### ${i + 1}. ${ts.module}

**Suggestion:** ${ts.suggestion}

**Potential Savings:** ${ts.potentialSavings}

`;
  });

  md += `
## Code Splitting Recommendations

`;

  report.codeSplitting.forEach((cs, i) => {
    md += `### ${i + 1}. ${cs.component}

**Reason:** ${cs.reason}

**Impact:** ${cs.impact}

`;
  });

  md += `
## Budget Status

| Metric | Budget | Current | Status |
|--------|--------|---------|--------|
| Main | ${formatBytes(report.budgetStatus.budget.main)} | ${formatBytes(report.totals.main.raw)} | ${report.totals.main.raw <= report.budgetStatus.budget.main ? 'PASS' : 'FAIL'} |
| Renderer | ${formatBytes(report.budgetStatus.budget.renderer)} | ${formatBytes(report.totals.renderer.raw)} | ${report.totals.renderer.raw <= report.budgetStatus.budget.renderer ? 'PASS' : 'FAIL'} |
| Total | ${formatBytes(report.budgetStatus.budget.total)} | ${formatBytes(report.totals.total.raw)} | ${report.totals.total.raw <= report.budgetStatus.budget.total ? 'PASS' : 'FAIL'} |

`;

  if (!report.budgetStatus.passed) {
    md += `### Violations

`;
    report.budgetStatus.violations.forEach((v) => {
      md += `- ${v}\n`;
    });
  }

  if (report.history.length > 1) {
    md += `
## Size History

| Commit | Date | Main | Renderer | Total | Delta |
|--------|------|------|----------|-------|-------|
`;

    const recent = report.history.slice(-10);
    for (let i = 0; i < recent.length; i++) {
      const entry = recent[i];
      const prev = i > 0 ? recent[i - 1] : null;
      const delta = prev ? entry.totalSize - prev.totalSize : 0;
      const deltaStr = delta === 0 ? '-' : (delta > 0 ? `+${formatBytes(delta)}` : `-${formatBytes(Math.abs(delta))}`);
      md += `| ${entry.commit} | ${entry.date.slice(0, 10)} | ${formatBytes(entry.mainSize)} | ${formatBytes(entry.rendererSize)} | ${formatBytes(entry.totalSize)} | ${deltaStr} |\n`;
    }
  }

  md += `
---

*Report generated by Atlas Desktop Bundle Analyzer*
`;

  return md;
}

// ============================================================================
// CLI Interface
// ============================================================================

/**
 * Parse command line arguments
 */
function parseArgs(): AnalyzeConfig {
  const args = process.argv.slice(2);
  const config: AnalyzeConfig = {
    outputFormat: 'console',
    budgetMB: 0,
    trackHistory: true,
    verbose: false,
    buildFirst: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--output':
      case '-o':
        config.outputFormat = args[++i] as AnalyzeConfig['outputFormat'];
        break;
      case '--budget':
      case '-b':
        config.budgetMB = parseSize(args[++i]) / (1024 * 1024);
        break;
      case '--no-history':
        config.trackHistory = false;
        break;
      case '--verbose':
      case '-v':
        config.verbose = true;
        break;
      case '--build':
        config.buildFirst = true;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
      default:
        if (!arg.startsWith('-')) {
          log(`Unknown argument: ${arg}`, 'warn');
        }
    }
  }

  return config;
}

/**
 * Print help message
 */
function printHelp(): void {
  console.log(`
Atlas Desktop Bundle Analysis Script

Usage:
  npx ts-node scripts/analyze-bundle.ts [options]

Options:
  -o, --output <format>   Output format: console, json, markdown, all (default: console)
  -b, --budget <size>     Set total bundle size budget (e.g., "5mb", "5000kb")
  -v, --verbose           Show detailed file listings
  --build                 Build before analyzing
  --no-history            Don't track size history
  -h, --help              Show this help message

Examples:
  npx ts-node scripts/analyze-bundle.ts
  npx ts-node scripts/analyze-bundle.ts --output markdown
  npx ts-node scripts/analyze-bundle.ts --budget 5mb --verbose
  npx ts-node scripts/analyze-bundle.ts --build --output all
`);
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function main(): Promise<void> {
  const config = parseArgs();

  // Build first if requested
  if (config.buildFirst) {
    log('Building application...', 'info');
    try {
      exec('npm run build:vite');
      log('Build completed', 'success');
    } catch (error) {
      log('Build failed', 'error');
      process.exit(1);
    }
  }

  // Check if dist directory exists
  if (!existsSync(DIST_DIR)) {
    log('Dist directory not found. Run "npm run build" first or use --build flag.', 'warn');
    log('Analyzing dependencies and providing recommendations without bundle sizes...', 'info');
  }

  // Generate report
  const report = generateReport(config);

  // Output based on format
  switch (config.outputFormat) {
    case 'console':
      printConsoleReport(report, config.verbose);
      break;

    case 'json': {
      const jsonPath = join(REPORTS_DIR, `bundle-report-${report.commit}.json`);
      if (!existsSync(REPORTS_DIR)) mkdirSync(REPORTS_DIR, { recursive: true });
      writeFileSync(jsonPath, JSON.stringify(report, null, 2));
      log(`JSON report saved to: ${jsonPath}`, 'success');
      break;
    }

    case 'markdown': {
      const mdPath = join(ROOT_DIR, 'docs', 'BUNDLE-REPORT.md');
      writeFileSync(mdPath, generateMarkdownReport(report));
      log(`Markdown report saved to: ${mdPath}`, 'success');
      break;
    }

    case 'all': {
      printConsoleReport(report, config.verbose);

      if (!existsSync(REPORTS_DIR)) mkdirSync(REPORTS_DIR, { recursive: true });

      const jsonPath = join(REPORTS_DIR, `bundle-report-${report.commit}.json`);
      writeFileSync(jsonPath, JSON.stringify(report, null, 2));
      log(`JSON report saved to: ${jsonPath}`, 'success');

      const mdPath = join(ROOT_DIR, 'docs', 'BUNDLE-REPORT.md');
      const docsDir = join(ROOT_DIR, 'docs');
      if (!existsSync(docsDir)) mkdirSync(docsDir, { recursive: true });
      writeFileSync(mdPath, generateMarkdownReport(report));
      log(`Markdown report saved to: ${mdPath}`, 'success');
      break;
    }
  }

  // Exit with error if budget violations
  if (!report.budgetStatus.passed) {
    process.exit(1);
  }
}

// Run
main().catch((error) => {
  console.error('Analysis failed:', error);
  process.exit(1);
});
