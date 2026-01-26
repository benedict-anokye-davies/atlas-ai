#!/usr/bin/env npx ts-node

/**
 * Atlas Desktop - Test Coverage Report Generator
 *
 * Generates coverage reports, tracks coverage trends over time,
 * and provides per-module coverage breakdown with threshold enforcement.
 *
 * Usage:
 *   npx ts-node scripts/coverage-report.ts              # Generate full report
 *   npx ts-node scripts/coverage-report.ts --ci         # CI mode with threshold gates
 *   npx ts-node scripts/coverage-report.ts --trend      # Show coverage trends
 *   npx ts-node scripts/coverage-report.ts --badge      # Generate coverage badges
 *   npx ts-node scripts/coverage-report.ts --help       # Show help
 *
 * @module scripts/coverage-report
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join, dirname, relative, basename } from 'path';

// ============================================================================
// Types
// ============================================================================

interface CoverageSummary {
  lines: CoverageMetric;
  statements: CoverageMetric;
  functions: CoverageMetric;
  branches: CoverageMetric;
}

interface CoverageMetric {
  total: number;
  covered: number;
  skipped: number;
  pct: number;
}

interface FileCoverage {
  path: string;
  relativePath: string;
  module: string;
  lines: CoverageMetric;
  statements: CoverageMetric;
  functions: CoverageMetric;
  branches: CoverageMetric;
}

interface ModuleCoverage {
  name: string;
  files: FileCoverage[];
  summary: CoverageSummary;
}

interface CoverageTrendEntry {
  date: string;
  commit: string;
  branch: string;
  summary: CoverageSummary;
  modules: Record<string, CoverageSummary>;
}

interface CoverageReport {
  timestamp: string;
  commit: string;
  branch: string;
  summary: CoverageSummary;
  modules: ModuleCoverage[];
  uncoveredPaths: UncoveredPath[];
  thresholdStatus: ThresholdStatus;
}

interface UncoveredPath {
  file: string;
  type: 'function' | 'branch' | 'line';
  location: string;
  description: string;
}

interface ThresholdStatus {
  passed: boolean;
  lines: ThresholdCheck;
  statements: ThresholdCheck;
  functions: ThresholdCheck;
  branches: ThresholdCheck;
}

interface ThresholdCheck {
  target: number;
  actual: number;
  passed: boolean;
  delta: number;
}

interface CoverageConfig {
  ciMode: boolean;
  showTrend: boolean;
  generateBadge: boolean;
  verbose: boolean;
  outputFormat: 'console' | 'json' | 'html';
  thresholds: CoverageThresholds;
}

interface CoverageThresholds {
  lines: number;
  statements: number;
  functions: number;
  branches: number;
}

interface V8CoverageData {
  [filePath: string]: {
    path: string;
    statementMap: Record<string, StatementLocation>;
    fnMap: Record<string, FunctionMapping>;
    branchMap: Record<string, BranchMapping>;
    s: Record<string, number>;
    f: Record<string, number>;
    b: Record<string, number[]>;
  };
}

interface StatementLocation {
  start: { line: number; column: number };
  end: { line: number; column: number };
}

interface FunctionMapping {
  name: string;
  decl: StatementLocation;
  loc: StatementLocation;
}

interface BranchMapping {
  type: string;
  loc: StatementLocation;
  locations: StatementLocation[];
}

// ============================================================================
// Constants
// ============================================================================

const ROOT_DIR = join(__dirname, '..');
const COVERAGE_DIR = join(ROOT_DIR, 'coverage');
const COVERAGE_JSON_PATH = join(COVERAGE_DIR, 'coverage-final.json');
const COVERAGE_SUMMARY_PATH = join(COVERAGE_DIR, 'coverage-summary.json');
const TREND_FILE_PATH = join(COVERAGE_DIR, 'coverage-trend.json');
const BADGE_DIR = join(ROOT_DIR, 'badges');

// Default coverage thresholds (80% target as specified)
const DEFAULT_THRESHOLDS: CoverageThresholds = {
  lines: 80,
  statements: 80,
  functions: 80,
  branches: 70, // Branches typically have lower coverage
};

// Module definitions for per-module breakdown
const MODULE_PATTERNS: Record<string, string[]> = {
  'main/voice': ['src/main/voice/**/*.ts'],
  'main/stt': ['src/main/stt/**/*.ts'],
  'main/tts': ['src/main/tts/**/*.ts'],
  'main/llm': ['src/main/llm/**/*.ts'],
  'main/agent': ['src/main/agent/**/*.ts'],
  'main/memory': ['src/main/memory/**/*.ts'],
  'main/security': ['src/main/security/**/*.ts'],
  'main/ipc': ['src/main/ipc/**/*.ts'],
  'main/utils': ['src/main/utils/**/*.ts'],
  'main/config': ['src/main/config/**/*.ts'],
  'main/tray': ['src/main/tray/**/*.ts'],
  'main/services': ['src/main/services/**/*.ts'],
  'main/providers': ['src/main/providers/**/*.ts'],
  'main/shortcuts': ['src/main/shortcuts/**/*.ts'],
  'main/updater': ['src/main/updater/**/*.ts'],
  'main/performance': ['src/main/performance/**/*.ts'],
  'main/telemetry': ['src/main/telemetry/**/*.ts'],
  'main/notifications': ['src/main/notifications/**/*.ts'],
  'main/system': ['src/main/system/**/*.ts'],
  'renderer/components': ['src/renderer/components/**/*.ts', 'src/renderer/components/**/*.tsx'],
  'renderer/hooks': ['src/renderer/hooks/**/*.ts'],
  'renderer/stores': ['src/renderer/stores/**/*.ts'],
  'renderer/utils': ['src/renderer/utils/**/*.ts'],
  'shared/types': ['src/shared/types/**/*.ts'],
};

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Execute a shell command synchronously
 */
function exec(command: string, options?: { cwd?: string; silent?: boolean }): string {
  const opts = { cwd: options?.cwd || ROOT_DIR, encoding: 'utf-8' as const };
  try {
    const result = execSync(command, opts);
    return result.toString().trim();
  } catch (error) {
    if (options?.silent) return '';
    throw error;
  }
}

/**
 * Log with formatting
 */
function log(message: string, type: 'info' | 'success' | 'warn' | 'error' = 'info'): void {
  const prefixes = {
    info: '[INFO]',
    success: '[OK]',
    warn: '[WARN]',
    error: '[ERROR]',
  };
  console.log(`${prefixes[type]} ${message}`);
}

/**
 * Format percentage with color coding
 */
function formatPct(pct: number, threshold: number): string {
  const formatted = pct.toFixed(2) + '%';
  if (pct >= threshold) return `${formatted} (PASS)`;
  if (pct >= threshold - 10) return `${formatted} (NEAR)`;
  return `${formatted} (FAIL)`;
}

/**
 * Get current git commit hash
 */
function getGitCommit(): string {
  try {
    return exec('git rev-parse --short HEAD', { silent: true }) || 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Get current git branch
 */
function getGitBranch(): string {
  try {
    return exec('git branch --show-current', { silent: true }) || 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Match file path to module
 */
function getModuleForFile(filePath: string): string {
  const relativePath = relative(ROOT_DIR, filePath).replace(/\\/g, '/');

  for (const [moduleName, patterns] of Object.entries(MODULE_PATTERNS)) {
    for (const pattern of patterns) {
      const regexPattern = pattern
        .replace(/\*\*/g, '.*')
        .replace(/\*/g, '[^/]*')
        .replace(/\//g, '\\/');
      const regex = new RegExp(`^${regexPattern}$`);
      if (regex.test(relativePath)) {
        return moduleName;
      }
    }
  }

  // Default module based on path
  if (relativePath.startsWith('src/main/')) {
    return 'main/other';
  }
  if (relativePath.startsWith('src/renderer/')) {
    return 'renderer/other';
  }
  if (relativePath.startsWith('src/shared/')) {
    return 'shared/other';
  }

  return 'other';
}

/**
 * Calculate coverage summary from metrics
 */
function calculateSummary(files: FileCoverage[]): CoverageSummary {
  const totals = {
    lines: { total: 0, covered: 0 },
    statements: { total: 0, covered: 0 },
    functions: { total: 0, covered: 0 },
    branches: { total: 0, covered: 0 },
  };

  for (const file of files) {
    totals.lines.total += file.lines.total;
    totals.lines.covered += file.lines.covered;
    totals.statements.total += file.statements.total;
    totals.statements.covered += file.statements.covered;
    totals.functions.total += file.functions.total;
    totals.functions.covered += file.functions.covered;
    totals.branches.total += file.branches.total;
    totals.branches.covered += file.branches.covered;
  }

  return {
    lines: {
      total: totals.lines.total,
      covered: totals.lines.covered,
      skipped: 0,
      pct: totals.lines.total > 0 ? (totals.lines.covered / totals.lines.total) * 100 : 0,
    },
    statements: {
      total: totals.statements.total,
      covered: totals.statements.covered,
      skipped: 0,
      pct: totals.statements.total > 0 ? (totals.statements.covered / totals.statements.total) * 100 : 0,
    },
    functions: {
      total: totals.functions.total,
      covered: totals.functions.covered,
      skipped: 0,
      pct: totals.functions.total > 0 ? (totals.functions.covered / totals.functions.total) * 100 : 0,
    },
    branches: {
      total: totals.branches.total,
      covered: totals.branches.covered,
      skipped: 0,
      pct: totals.branches.total > 0 ? (totals.branches.covered / totals.branches.total) * 100 : 0,
    },
  };
}

// ============================================================================
// Coverage Data Functions
// ============================================================================

/**
 * Run Vitest with coverage
 */
function runCoverageTests(): void {
  log('Running tests with coverage...', 'info');

  // Ensure coverage directory exists
  if (!existsSync(COVERAGE_DIR)) {
    mkdirSync(COVERAGE_DIR, { recursive: true });
  }

  try {
    exec('npm run test:coverage', { cwd: ROOT_DIR });
    log('Coverage tests completed', 'success');
  } catch (error) {
    log('Coverage tests failed - generating report from existing data', 'warn');
  }
}

/**
 * Parse V8 coverage data from JSON
 */
function parseCoverageData(): FileCoverage[] {
  if (!existsSync(COVERAGE_JSON_PATH)) {
    throw new Error(`Coverage data not found at ${COVERAGE_JSON_PATH}. Run tests first.`);
  }

  const rawData = readFileSync(COVERAGE_JSON_PATH, 'utf-8');
  const coverageData: V8CoverageData = JSON.parse(rawData);

  const files: FileCoverage[] = [];

  for (const [filePath, fileData] of Object.entries(coverageData)) {
    const relativePath = relative(ROOT_DIR, filePath).replace(/\\/g, '/');

    // Skip test files and config files
    if (
      relativePath.includes('/tests/') ||
      relativePath.includes('.test.') ||
      relativePath.includes('.config.') ||
      relativePath.includes('/node_modules/')
    ) {
      continue;
    }

    // Calculate statement coverage
    const stmtTotal = Object.keys(fileData.s || {}).length;
    const stmtCovered = Object.values(fileData.s || {}).filter((v) => v > 0).length;

    // Calculate function coverage
    const fnTotal = Object.keys(fileData.f || {}).length;
    const fnCovered = Object.values(fileData.f || {}).filter((v) => v > 0).length;

    // Calculate branch coverage
    const branches = fileData.b || {};
    let branchTotal = 0;
    let branchCovered = 0;
    for (const branchHits of Object.values(branches)) {
      branchTotal += branchHits.length;
      branchCovered += branchHits.filter((v) => v > 0).length;
    }

    // Estimate line coverage from statements (approximation)
    const lineTotal = stmtTotal;
    const lineCovered = stmtCovered;

    files.push({
      path: filePath,
      relativePath,
      module: getModuleForFile(filePath),
      lines: {
        total: lineTotal,
        covered: lineCovered,
        skipped: 0,
        pct: lineTotal > 0 ? (lineCovered / lineTotal) * 100 : 0,
      },
      statements: {
        total: stmtTotal,
        covered: stmtCovered,
        skipped: 0,
        pct: stmtTotal > 0 ? (stmtCovered / stmtTotal) * 100 : 0,
      },
      functions: {
        total: fnTotal,
        covered: fnCovered,
        skipped: 0,
        pct: fnTotal > 0 ? (fnCovered / fnTotal) * 100 : 0,
      },
      branches: {
        total: branchTotal,
        covered: branchCovered,
        skipped: 0,
        pct: branchTotal > 0 ? (branchCovered / branchTotal) * 100 : 0,
      },
    });
  }

  return files;
}

/**
 * Group files by module
 */
function groupByModule(files: FileCoverage[]): ModuleCoverage[] {
  const moduleMap = new Map<string, FileCoverage[]>();

  for (const file of files) {
    const existing = moduleMap.get(file.module) || [];
    existing.push(file);
    moduleMap.set(file.module, existing);
  }

  const modules: ModuleCoverage[] = [];

  moduleMap.forEach((moduleFiles, name) => {
    modules.push({
      name,
      files: moduleFiles,
      summary: calculateSummary(moduleFiles),
    });
  });

  // Sort by module name
  modules.sort((a, b) => a.name.localeCompare(b.name));

  return modules;
}

/**
 * Find uncovered code paths
 */
function findUncoveredPaths(files: FileCoverage[]): UncoveredPath[] {
  const uncovered: UncoveredPath[] = [];

  if (!existsSync(COVERAGE_JSON_PATH)) {
    return uncovered;
  }

  const rawData = readFileSync(COVERAGE_JSON_PATH, 'utf-8');
  const coverageData: V8CoverageData = JSON.parse(rawData);

  for (const [filePath, fileData] of Object.entries(coverageData)) {
    const relativePath = relative(ROOT_DIR, filePath).replace(/\\/g, '/');

    // Skip test files
    if (relativePath.includes('/tests/') || relativePath.includes('.test.')) {
      continue;
    }

    // Find uncovered functions
    const fnMap = fileData.fnMap || {};
    const fnHits = fileData.f || {};
    for (const [fnId, fnData] of Object.entries(fnMap)) {
      if (fnHits[fnId] === 0) {
        uncovered.push({
          file: relativePath,
          type: 'function',
          location: `line ${fnData.loc.start.line}`,
          description: `Function '${fnData.name}' is not covered`,
        });
      }
    }

    // Find uncovered branches
    const branchMap = fileData.branchMap || {};
    const branchHits = fileData.b || {};
    for (const [branchId, branchData] of Object.entries(branchMap)) {
      const hits = branchHits[branchId] || [];
      hits.forEach((hit, idx) => {
        if (hit === 0) {
          uncovered.push({
            file: relativePath,
            type: 'branch',
            location: `line ${branchData.loc.start.line}`,
            description: `${branchData.type} branch ${idx + 1} is not covered`,
          });
        }
      });
    }
  }

  // Limit to top 50 most important uncovered paths
  return uncovered.slice(0, 50);
}

/**
 * Check coverage against thresholds
 */
function checkThresholds(summary: CoverageSummary, thresholds: CoverageThresholds): ThresholdStatus {
  const status: ThresholdStatus = {
    passed: true,
    lines: {
      target: thresholds.lines,
      actual: summary.lines.pct,
      passed: summary.lines.pct >= thresholds.lines,
      delta: summary.lines.pct - thresholds.lines,
    },
    statements: {
      target: thresholds.statements,
      actual: summary.statements.pct,
      passed: summary.statements.pct >= thresholds.statements,
      delta: summary.statements.pct - thresholds.statements,
    },
    functions: {
      target: thresholds.functions,
      actual: summary.functions.pct,
      passed: summary.functions.pct >= thresholds.functions,
      delta: summary.functions.pct - thresholds.functions,
    },
    branches: {
      target: thresholds.branches,
      actual: summary.branches.pct,
      passed: summary.branches.pct >= thresholds.branches,
      delta: summary.branches.pct - thresholds.branches,
    },
  };

  status.passed =
    status.lines.passed && status.statements.passed && status.functions.passed && status.branches.passed;

  return status;
}

// ============================================================================
// Trend Tracking
// ============================================================================

/**
 * Load coverage trend history
 */
function loadTrendHistory(): CoverageTrendEntry[] {
  if (!existsSync(TREND_FILE_PATH)) {
    return [];
  }

  try {
    const data = readFileSync(TREND_FILE_PATH, 'utf-8');
    return JSON.parse(data) as CoverageTrendEntry[];
  } catch {
    return [];
  }
}

/**
 * Save coverage trend entry
 */
function saveTrendEntry(report: CoverageReport): void {
  const history = loadTrendHistory();

  const entry: CoverageTrendEntry = {
    date: report.timestamp,
    commit: report.commit,
    branch: report.branch,
    summary: report.summary,
    modules: {},
  };

  for (const module of report.modules) {
    entry.modules[module.name] = module.summary;
  }

  // Keep last 100 entries
  history.push(entry);
  if (history.length > 100) {
    history.splice(0, history.length - 100);
  }

  writeFileSync(TREND_FILE_PATH, JSON.stringify(history, null, 2), 'utf-8');
  log(`Saved trend entry for commit ${report.commit}`, 'success');
}

/**
 * Display coverage trend
 */
function displayTrend(): void {
  const history = loadTrendHistory();

  if (history.length === 0) {
    log('No coverage history found. Run coverage report first.', 'warn');
    return;
  }

  console.log('\n=== Coverage Trend (Last 10 Entries) ===\n');
  console.log('Date                 | Commit  | Lines    | Stmts    | Funcs    | Branch');
  console.log('-'.repeat(80));

  const recentEntries = history.slice(-10);
  for (const entry of recentEntries) {
    const date = entry.date.slice(0, 19).replace('T', ' ');
    const lines = entry.summary.lines.pct.toFixed(1).padStart(6) + '%';
    const stmts = entry.summary.statements.pct.toFixed(1).padStart(6) + '%';
    const funcs = entry.summary.functions.pct.toFixed(1).padStart(6) + '%';
    const branch = entry.summary.branches.pct.toFixed(1).padStart(6) + '%';

    console.log(`${date} | ${entry.commit.padEnd(7)} | ${lines} | ${stmts} | ${funcs} | ${branch}`);
  }

  // Show trend direction
  if (history.length >= 2) {
    const prev = history[history.length - 2];
    const curr = history[history.length - 1];

    console.log('\n--- Trend vs Previous ---');
    const linesDelta = curr.summary.lines.pct - prev.summary.lines.pct;
    const stmtsDelta = curr.summary.statements.pct - prev.summary.statements.pct;
    const funcsDelta = curr.summary.functions.pct - prev.summary.functions.pct;
    const branchDelta = curr.summary.branches.pct - prev.summary.branches.pct;

    const arrow = (delta: number) => (delta >= 0 ? '+' : '') + delta.toFixed(2) + '%';

    console.log(`Lines: ${arrow(linesDelta)} | Statements: ${arrow(stmtsDelta)} | Functions: ${arrow(funcsDelta)} | Branches: ${arrow(branchDelta)}`);
  }

  console.log('');
}

// ============================================================================
// Badge Generation
// ============================================================================

/**
 * Get badge color based on coverage percentage
 */
function getBadgeColor(pct: number): string {
  if (pct >= 80) return 'brightgreen';
  if (pct >= 70) return 'green';
  if (pct >= 60) return 'yellowgreen';
  if (pct >= 50) return 'yellow';
  if (pct >= 40) return 'orange';
  return 'red';
}

/**
 * Generate SVG coverage badge
 */
function generateBadgeSVG(label: string, value: string, color: string): string {
  const labelWidth = label.length * 6.5 + 10;
  const valueWidth = value.length * 6.5 + 10;
  const totalWidth = labelWidth + valueWidth;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20">
  <linearGradient id="b" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="a">
    <rect width="${totalWidth}" height="20" rx="3" fill="#fff"/>
  </clipPath>
  <g clip-path="url(#a)">
    <path fill="#555" d="M0 0h${labelWidth}v20H0z"/>
    <path fill="${color}" d="M${labelWidth} 0h${valueWidth}v20H${labelWidth}z"/>
    <path fill="url(#b)" d="M0 0h${totalWidth}v20H0z"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="11">
    <text x="${labelWidth / 2}" y="15" fill="#010101" fill-opacity=".3">${label}</text>
    <text x="${labelWidth / 2}" y="14">${label}</text>
    <text x="${labelWidth + valueWidth / 2}" y="15" fill="#010101" fill-opacity=".3">${value}</text>
    <text x="${labelWidth + valueWidth / 2}" y="14">${value}</text>
  </g>
</svg>`;
}

/**
 * Generate coverage badges
 */
function generateBadges(summary: CoverageSummary): void {
  if (!existsSync(BADGE_DIR)) {
    mkdirSync(BADGE_DIR, { recursive: true });
  }

  const badges = [
    { name: 'coverage', label: 'coverage', value: `${summary.lines.pct.toFixed(1)}%`, color: getBadgeColor(summary.lines.pct) },
    { name: 'lines', label: 'lines', value: `${summary.lines.pct.toFixed(1)}%`, color: getBadgeColor(summary.lines.pct) },
    { name: 'statements', label: 'statements', value: `${summary.statements.pct.toFixed(1)}%`, color: getBadgeColor(summary.statements.pct) },
    { name: 'functions', label: 'functions', value: `${summary.functions.pct.toFixed(1)}%`, color: getBadgeColor(summary.functions.pct) },
    { name: 'branches', label: 'branches', value: `${summary.branches.pct.toFixed(1)}%`, color: getBadgeColor(summary.branches.pct) },
  ];

  for (const badge of badges) {
    const svg = generateBadgeSVG(badge.label, badge.value, badge.color);
    const path = join(BADGE_DIR, `${badge.name}.svg`);
    writeFileSync(path, svg, 'utf-8');
  }

  log(`Generated ${badges.length} coverage badges in ${BADGE_DIR}`, 'success');

  // Generate shields.io compatible JSON
  const shieldsData = {
    schemaVersion: 1,
    label: 'coverage',
    message: `${summary.lines.pct.toFixed(1)}%`,
    color: getBadgeColor(summary.lines.pct),
  };
  writeFileSync(join(BADGE_DIR, 'shields.json'), JSON.stringify(shieldsData, null, 2), 'utf-8');
}

// ============================================================================
// Report Generation
// ============================================================================

/**
 * Generate full coverage report
 */
function generateReport(config: CoverageConfig): CoverageReport {
  // Parse coverage data
  const files = parseCoverageData();
  const modules = groupByModule(files);
  const summary = calculateSummary(files);
  const uncoveredPaths = findUncoveredPaths(files);
  const thresholdStatus = checkThresholds(summary, config.thresholds);

  const report: CoverageReport = {
    timestamp: new Date().toISOString(),
    commit: getGitCommit(),
    branch: getGitBranch(),
    summary,
    modules,
    uncoveredPaths,
    thresholdStatus,
  };

  return report;
}

/**
 * Display report to console
 */
function displayReport(report: CoverageReport, config: CoverageConfig): void {
  console.log('\n' + '='.repeat(80));
  console.log('                    ATLAS DESKTOP - COVERAGE REPORT');
  console.log('='.repeat(80));
  console.log(`Timestamp: ${report.timestamp}`);
  console.log(`Commit: ${report.commit} | Branch: ${report.branch}`);
  console.log('');

  // Overall Summary
  console.log('--- Overall Coverage Summary ---');
  console.log(`  Lines:      ${formatPct(report.summary.lines.pct, config.thresholds.lines)} (${report.summary.lines.covered}/${report.summary.lines.total})`);
  console.log(`  Statements: ${formatPct(report.summary.statements.pct, config.thresholds.statements)} (${report.summary.statements.covered}/${report.summary.statements.total})`);
  console.log(`  Functions:  ${formatPct(report.summary.functions.pct, config.thresholds.functions)} (${report.summary.functions.covered}/${report.summary.functions.total})`);
  console.log(`  Branches:   ${formatPct(report.summary.branches.pct, config.thresholds.branches)} (${report.summary.branches.covered}/${report.summary.branches.total})`);
  console.log('');

  // Threshold Status
  console.log('--- Threshold Status ---');
  const thresholdEmoji = report.thresholdStatus.passed ? 'PASS' : 'FAIL';
  console.log(`  Overall: ${thresholdEmoji}`);
  console.log(`  Lines:      ${report.thresholdStatus.lines.passed ? 'PASS' : 'FAIL'} (target: ${config.thresholds.lines}%, actual: ${report.thresholdStatus.lines.actual.toFixed(2)}%, delta: ${report.thresholdStatus.lines.delta >= 0 ? '+' : ''}${report.thresholdStatus.lines.delta.toFixed(2)}%)`);
  console.log(`  Statements: ${report.thresholdStatus.statements.passed ? 'PASS' : 'FAIL'} (target: ${config.thresholds.statements}%, actual: ${report.thresholdStatus.statements.actual.toFixed(2)}%, delta: ${report.thresholdStatus.statements.delta >= 0 ? '+' : ''}${report.thresholdStatus.statements.delta.toFixed(2)}%)`);
  console.log(`  Functions:  ${report.thresholdStatus.functions.passed ? 'PASS' : 'FAIL'} (target: ${config.thresholds.functions}%, actual: ${report.thresholdStatus.functions.actual.toFixed(2)}%, delta: ${report.thresholdStatus.functions.delta >= 0 ? '+' : ''}${report.thresholdStatus.functions.delta.toFixed(2)}%)`);
  console.log(`  Branches:   ${report.thresholdStatus.branches.passed ? 'PASS' : 'FAIL'} (target: ${config.thresholds.branches}%, actual: ${report.thresholdStatus.branches.actual.toFixed(2)}%, delta: ${report.thresholdStatus.branches.delta >= 0 ? '+' : ''}${report.thresholdStatus.branches.delta.toFixed(2)}%)`);
  console.log('');

  // Per-Module Breakdown
  console.log('--- Per-Module Coverage ---');
  console.log('Module                          | Lines    | Stmts    | Funcs    | Branch');
  console.log('-'.repeat(80));

  for (const module of report.modules) {
    const name = module.name.padEnd(30);
    const lines = module.summary.lines.pct.toFixed(1).padStart(6) + '%';
    const stmts = module.summary.statements.pct.toFixed(1).padStart(6) + '%';
    const funcs = module.summary.functions.pct.toFixed(1).padStart(6) + '%';
    const branch = module.summary.branches.pct.toFixed(1).padStart(6) + '%';

    console.log(`${name} | ${lines} | ${stmts} | ${funcs} | ${branch}`);
  }
  console.log('');

  // Uncovered Paths (if verbose)
  if (config.verbose && report.uncoveredPaths.length > 0) {
    console.log('--- Uncovered Code Paths (Top 20) ---');
    for (const path of report.uncoveredPaths.slice(0, 20)) {
      console.log(`  [${path.type}] ${path.file}:${path.location}`);
      console.log(`         ${path.description}`);
    }
    console.log('');
  }

  // Low coverage files
  const lowCoverageFiles = report.modules
    .flatMap((m) => m.files)
    .filter((f) => f.lines.pct < 50 && f.lines.total > 5)
    .sort((a, b) => a.lines.pct - b.lines.pct)
    .slice(0, 10);

  if (lowCoverageFiles.length > 0) {
    console.log('--- Files Needing Attention (< 50% Coverage) ---');
    for (const file of lowCoverageFiles) {
      console.log(`  ${file.relativePath}: ${file.lines.pct.toFixed(1)}% (${file.lines.covered}/${file.lines.total} lines)`);
    }
    console.log('');
  }

  console.log('='.repeat(80));
  console.log('');
}

/**
 * Save report as JSON
 */
function saveReportJSON(report: CoverageReport): void {
  const outputPath = join(COVERAGE_DIR, 'coverage-report.json');
  writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf-8');
  log(`Saved coverage report to ${outputPath}`, 'success');
}

// ============================================================================
// CLI
// ============================================================================

/**
 * Parse command line arguments
 */
function parseArgs(): CoverageConfig {
  const args = process.argv.slice(2);
  const config: CoverageConfig = {
    ciMode: false,
    showTrend: false,
    generateBadge: false,
    verbose: false,
    outputFormat: 'console',
    thresholds: { ...DEFAULT_THRESHOLDS },
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--ci':
        config.ciMode = true;
        break;
      case '--trend':
        config.showTrend = true;
        break;
      case '--badge':
      case '--badges':
        config.generateBadge = true;
        break;
      case '--verbose':
      case '-v':
        config.verbose = true;
        break;
      case '--json':
        config.outputFormat = 'json';
        break;
      case '--threshold-lines':
        config.thresholds.lines = parseFloat(args[++i]);
        break;
      case '--threshold-statements':
        config.thresholds.statements = parseFloat(args[++i]);
        break;
      case '--threshold-functions':
        config.thresholds.functions = parseFloat(args[++i]);
        break;
      case '--threshold-branches':
        config.thresholds.branches = parseFloat(args[++i]);
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
      default:
        if (!arg.startsWith('-')) {
          log(`Unknown argument: ${arg}`, 'error');
          printHelp();
          process.exit(1);
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
Atlas Desktop - Coverage Report Generator

Usage:
  npx ts-node scripts/coverage-report.ts [options]

Options:
  --ci                     CI mode with threshold gates (exit code 1 if fail)
  --trend                  Show coverage trends over time
  --badge, --badges        Generate coverage badges (SVG)
  -v, --verbose            Show detailed output including uncovered paths
  --json                   Output report as JSON
  --threshold-lines N      Set line coverage threshold (default: 80)
  --threshold-statements N Set statement coverage threshold (default: 80)
  --threshold-functions N  Set function coverage threshold (default: 80)
  --threshold-branches N   Set branch coverage threshold (default: 70)
  -h, --help               Show this help message

Examples:
  npx ts-node scripts/coverage-report.ts                    # Generate full report
  npx ts-node scripts/coverage-report.ts --ci               # CI mode with thresholds
  npx ts-node scripts/coverage-report.ts --trend            # Show coverage trends
  npx ts-node scripts/coverage-report.ts --badge --verbose  # Generate badges with details
  npx ts-node scripts/coverage-report.ts --threshold-lines 90  # Custom threshold

Coverage Thresholds (Default):
  Lines:      80%
  Statements: 80%
  Functions:  80%
  Branches:   70%

Output Files:
  coverage/coverage-report.json   - Full coverage report
  coverage/coverage-trend.json    - Historical trend data
  badges/coverage.svg             - Coverage badge for README
  badges/shields.json             - shields.io compatible JSON
`);
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const config = parseArgs();

  log('Atlas Desktop Coverage Report Generator', 'info');
  log(`Thresholds: Lines=${config.thresholds.lines}%, Stmts=${config.thresholds.statements}%, Funcs=${config.thresholds.functions}%, Branch=${config.thresholds.branches}%`, 'info');

  // Show trend and exit if requested
  if (config.showTrend) {
    displayTrend();
    return;
  }

  // Run coverage tests if data doesn't exist
  if (!existsSync(COVERAGE_JSON_PATH)) {
    runCoverageTests();
  }

  // Generate report
  let report: CoverageReport;
  try {
    report = generateReport(config);
  } catch (error) {
    log(`Failed to generate report: ${error}`, 'error');
    process.exit(1);
  }

  // Display or output report
  if (config.outputFormat === 'json') {
    console.log(JSON.stringify(report, null, 2));
  } else {
    displayReport(report, config);
  }

  // Save report JSON
  saveReportJSON(report);

  // Save trend entry
  saveTrendEntry(report);

  // Generate badges if requested
  if (config.generateBadge) {
    generateBadges(report.summary);
  }

  // CI mode - exit with error if thresholds not met
  if (config.ciMode) {
    if (!report.thresholdStatus.passed) {
      log('Coverage thresholds not met!', 'error');
      process.exit(1);
    } else {
      log('All coverage thresholds passed!', 'success');
    }
  }
}

// Run main
main().catch((error) => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
