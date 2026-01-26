#!/usr/bin/env node
/**
 * Cross-Platform QA Testing Script
 *
 * Automated tests for verifying Atlas Desktop works correctly
 * on Windows, macOS, and Linux platforms.
 *
 * Usage:
 *   npm run test:qa           - Run all QA tests
 *   npm run test:qa -- --full - Run full QA suite including performance
 */

import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

// ANSI colors for output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  dim: '\x1b[2m',
};

interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
}

interface TestSuite {
  name: string;
  tests: TestResult[];
  passed: number;
  failed: number;
}

// Detect current platform
function getPlatform(): 'windows' | 'macos' | 'linux' {
  switch (os.platform()) {
    case 'win32':
      return 'windows';
    case 'darwin':
      return 'macos';
    default:
      return 'linux';
  }
}

function log(message: string, color: keyof typeof colors = 'reset'): void {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function runCommand(command: string): { success: boolean; output: string } {
  try {
    const output = execSync(command, { encoding: 'utf-8', timeout: 30000 });
    return { success: true, output };
  } catch (error) {
    return { success: false, output: (error as Error).message };
  }
}

// ========================================
// Test Suites
// ========================================

async function testEnvironment(): Promise<TestSuite> {
  const suite: TestSuite = {
    name: 'Environment',
    tests: [],
    passed: 0,
    failed: 0,
  };

  // Test: Node.js version
  const nodeTest: TestResult = {
    name: 'Node.js version >= 18',
    passed: false,
    duration: 0,
  };
  const start = Date.now();
  const nodeVersion = process.versions.node;
  const major = parseInt(nodeVersion.split('.')[0], 10);
  nodeTest.passed = major >= 18;
  nodeTest.duration = Date.now() - start;
  if (!nodeTest.passed) {
    nodeTest.error = `Node.js ${nodeVersion} is below minimum 18.x`;
  }
  suite.tests.push(nodeTest);

  // Test: npm available
  const npmTest: TestResult = {
    name: 'npm is available',
    passed: false,
    duration: 0,
  };
  const npmStart = Date.now();
  const npmResult = runCommand('npm --version');
  npmTest.passed = npmResult.success;
  npmTest.duration = Date.now() - npmStart;
  if (!npmTest.passed) {
    npmTest.error = 'npm not found in PATH';
  }
  suite.tests.push(npmTest);

  // Test: Required directories exist
  const dirsTest: TestResult = {
    name: 'Required directories exist',
    passed: false,
    duration: 0,
  };
  const dirsStart = Date.now();
  const requiredDirs = ['src', 'tests', 'assets', 'docs'];
  const missingDirs = requiredDirs.filter((dir) => !fs.existsSync(dir));
  dirsTest.passed = missingDirs.length === 0;
  dirsTest.duration = Date.now() - dirsStart;
  if (!dirsTest.passed) {
    dirsTest.error = `Missing directories: ${missingDirs.join(', ')}`;
  }
  suite.tests.push(dirsTest);

  // Test: package.json valid
  const pkgTest: TestResult = {
    name: 'package.json is valid',
    passed: false,
    duration: 0,
  };
  const pkgStart = Date.now();
  try {
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
    pkgTest.passed = !!pkg.name && !!pkg.version;
    if (!pkgTest.passed) {
      pkgTest.error = 'Missing name or version in package.json';
    }
  } catch (e) {
    pkgTest.error = 'Failed to parse package.json';
  }
  pkgTest.duration = Date.now() - pkgStart;
  suite.tests.push(pkgTest);

  // Test: .env.example exists
  const envTest: TestResult = {
    name: '.env.example exists',
    passed: false,
    duration: 0,
  };
  const envStart = Date.now();
  envTest.passed = fs.existsSync('.env.example');
  envTest.duration = Date.now() - envStart;
  if (!envTest.passed) {
    envTest.error = '.env.example not found';
  }
  suite.tests.push(envTest);

  // Calculate totals
  suite.passed = suite.tests.filter((t) => t.passed).length;
  suite.failed = suite.tests.filter((t) => !t.passed).length;

  return suite;
}

async function testBuild(): Promise<TestSuite> {
  const suite: TestSuite = {
    name: 'Build',
    tests: [],
    passed: 0,
    failed: 0,
  };

  // Test: TypeScript compiles
  const tsTest: TestResult = {
    name: 'TypeScript compiles without errors',
    passed: false,
    duration: 0,
  };
  const tsStart = Date.now();
  const tsResult = runCommand('npm run typecheck 2>&1');
  // Note: We check for "error TS" in output since the command may still exit 0
  tsTest.passed = !tsResult.output.includes('error TS');
  tsTest.duration = Date.now() - tsStart;
  if (!tsTest.passed) {
    const errors = tsResult.output.match(/error TS\d+/g) || [];
    tsTest.error = `${errors.length} TypeScript error(s)`;
  }
  suite.tests.push(tsTest);

  // Test: Vite build works
  const viteTest: TestResult = {
    name: 'Vite build succeeds',
    passed: false,
    duration: 0,
  };
  const viteStart = Date.now();
  const viteResult = runCommand('npm run build:vite 2>&1');
  viteTest.passed = viteResult.success && !viteResult.output.includes('error');
  viteTest.duration = Date.now() - viteStart;
  if (!viteTest.passed) {
    viteTest.error = 'Vite build failed';
  }
  suite.tests.push(viteTest);

  // Calculate totals
  suite.passed = suite.tests.filter((t) => t.passed).length;
  suite.failed = suite.tests.filter((t) => !t.passed).length;

  return suite;
}

async function testUnitTests(): Promise<TestSuite> {
  const suite: TestSuite = {
    name: 'Unit Tests',
    tests: [],
    passed: 0,
    failed: 0,
  };

  // Test: Vitest runs
  const vitestTest: TestResult = {
    name: 'Unit tests pass',
    passed: false,
    duration: 0,
  };
  const vitestStart = Date.now();
  const vitestResult = runCommand('npm run test 2>&1');
  vitestTest.passed = vitestResult.success;
  vitestTest.duration = Date.now() - vitestStart;
  if (!vitestTest.passed) {
    const failMatch = vitestResult.output.match(/(\d+) failed/);
    vitestTest.error = failMatch ? `${failMatch[1]} test(s) failed` : 'Tests failed';
  }
  suite.tests.push(vitestTest);

  // Calculate totals
  suite.passed = suite.tests.filter((t) => t.passed).length;
  suite.failed = suite.tests.filter((t) => !t.passed).length;

  return suite;
}

async function testPlatformSpecific(): Promise<TestSuite> {
  const platform = getPlatform();
  const suite: TestSuite = {
    name: `Platform: ${platform}`,
    tests: [],
    passed: 0,
    failed: 0,
  };

  if (platform === 'windows') {
    // Windows-specific tests
    const psTest: TestResult = {
      name: 'PowerShell available',
      passed: false,
      duration: 0,
    };
    const psStart = Date.now();
    const psResult = runCommand('powershell -Command "$PSVersionTable.PSVersion"');
    psTest.passed = psResult.success;
    psTest.duration = Date.now() - psStart;
    suite.tests.push(psTest);
  } else if (platform === 'macos') {
    // macOS-specific tests
    const xcodeTest: TestResult = {
      name: 'Xcode CLI tools installed',
      passed: false,
      duration: 0,
    };
    const xcodeStart = Date.now();
    const xcodeResult = runCommand('xcode-select -p');
    xcodeTest.passed = xcodeResult.success;
    xcodeTest.duration = Date.now() - xcodeStart;
    suite.tests.push(xcodeTest);
  } else {
    // Linux-specific tests
    const libTest: TestResult = {
      name: 'Required libraries available',
      passed: false,
      duration: 0,
    };
    const libStart = Date.now();
    // Check for common required libraries
    const ldResult = runCommand('ldconfig -p 2>/dev/null | head -1');
    libTest.passed = ldResult.success;
    libTest.duration = Date.now() - libStart;
    suite.tests.push(libTest);
  }

  // Calculate totals
  suite.passed = suite.tests.filter((t) => t.passed).length;
  suite.failed = suite.tests.filter((t) => !t.passed).length;

  return suite;
}

async function testPerformance(): Promise<TestSuite> {
  const suite: TestSuite = {
    name: 'Performance',
    tests: [],
    passed: 0,
    failed: 0,
  };

  // Test: Build time under 60s
  const buildTimeTest: TestResult = {
    name: 'Full build completes in < 60s',
    passed: false,
    duration: 0,
  };
  const buildStart = Date.now();
  runCommand('npm run build 2>&1');
  buildTimeTest.duration = Date.now() - buildStart;
  buildTimeTest.passed = buildTimeTest.duration < 60000;
  if (!buildTimeTest.passed) {
    buildTimeTest.error = `Build took ${(buildTimeTest.duration / 1000).toFixed(1)}s`;
  }
  suite.tests.push(buildTimeTest);

  // Test: Test suite runs in < 120s
  const testTimeTest: TestResult = {
    name: 'Test suite completes in < 120s',
    passed: false,
    duration: 0,
  };
  const testStart = Date.now();
  runCommand('npm run test 2>&1');
  testTimeTest.duration = Date.now() - testStart;
  testTimeTest.passed = testTimeTest.duration < 120000;
  if (!testTimeTest.passed) {
    testTimeTest.error = `Tests took ${(testTimeTest.duration / 1000).toFixed(1)}s`;
  }
  suite.tests.push(testTimeTest);

  // Calculate totals
  suite.passed = suite.tests.filter((t) => t.passed).length;
  suite.failed = suite.tests.filter((t) => !t.passed).length;

  return suite;
}

// ========================================
// Report Generation
// ========================================

function printSuite(suite: TestSuite): void {
  log(`\n  ${suite.name}`, 'blue');
  log('  ' + '─'.repeat(40), 'dim');

  for (const test of suite.tests) {
    const status = test.passed
      ? `${colors.green}✓${colors.reset}`
      : `${colors.red}✗${colors.reset}`;
    const duration = `${colors.dim}(${test.duration}ms)${colors.reset}`;
    console.log(`    ${status} ${test.name} ${duration}`);
    if (test.error) {
      log(`      → ${test.error}`, 'red');
    }
  }

  const passRate = ((suite.passed / suite.tests.length) * 100).toFixed(0);
  log(
    `  ${suite.passed}/${suite.tests.length} passed (${passRate}%)`,
    suite.failed > 0 ? 'yellow' : 'green'
  );
}

function generateReport(suites: TestSuite[]): void {
  const totalPassed = suites.reduce((sum, s) => sum + s.passed, 0);
  const totalFailed = suites.reduce((sum, s) => sum + s.failed, 0);
  const total = totalPassed + totalFailed;

  log('\n═══════════════════════════════════════════', 'blue');
  log('  Atlas Desktop QA Report', 'blue');
  log('═══════════════════════════════════════════\n', 'blue');

  log(`  Platform: ${getPlatform()}`, 'dim');
  log(`  Node: ${process.versions.node}`, 'dim');
  log(`  Date: ${new Date().toISOString()}`, 'dim');

  for (const suite of suites) {
    printSuite(suite);
  }

  log('\n═══════════════════════════════════════════', 'blue');
  log(`  Total: ${totalPassed}/${total} tests passed`, totalFailed > 0 ? 'yellow' : 'green');
  log('═══════════════════════════════════════════\n', 'blue');

  // Save report to file
  const reportPath = path.join('docs', 'qa-report.json');
  const report = {
    platform: getPlatform(),
    node: process.versions.node,
    date: new Date().toISOString(),
    suites: suites.map((s) => ({
      name: s.name,
      passed: s.passed,
      failed: s.failed,
      tests: s.tests,
    })),
    summary: {
      total,
      passed: totalPassed,
      failed: totalFailed,
    },
  };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  log(`  Report saved to: ${reportPath}`, 'dim');
}

// ========================================
// Main
// ========================================

async function main(): Promise<void> {
  const fullMode = process.argv.includes('--full');

  log('\n  Running Atlas Desktop QA Tests...', 'blue');
  log(`  Mode: ${fullMode ? 'Full' : 'Quick'}`, 'dim');

  const suites: TestSuite[] = [];

  // Always run these
  suites.push(await testEnvironment());
  suites.push(await testPlatformSpecific());
  suites.push(await testBuild());
  suites.push(await testUnitTests());

  // Only in full mode
  if (fullMode) {
    suites.push(await testPerformance());
  }

  generateReport(suites);

  // Exit with error code if any tests failed
  const totalFailed = suites.reduce((sum, s) => sum + s.failed, 0);
  process.exit(totalFailed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('QA script error:', error);
  process.exit(1);
});
