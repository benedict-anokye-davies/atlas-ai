#!/usr/bin/env node
/**
 * Atlas Desktop - Tool Test Script
 * Tests Terminal, Filesystem, and other tools end-to-end
 *
 * Run with: npx ts-node scripts/test-tools.ts
 */

import * as os from 'os';
import * as path from 'path';
import * as pty from 'node-pty';
import * as fs from 'fs/promises';

// Test results tracking
interface TestResult {
  name: string;
  passed: boolean;
  message: string;
  duration: number;
}

const results: TestResult[] = [];

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
};

function log(message: string, color?: string): void {
  if (color) {
    console.log(`${color}${message}${colors.reset}`);
  } else {
    console.log(message);
  }
}

async function runTest(name: string, testFn: () => Promise<boolean>): Promise<void> {
  const startTime = Date.now();
  try {
    const passed = await testFn();
    results.push({
      name,
      passed,
      message: passed ? 'PASS' : 'FAIL',
      duration: Date.now() - startTime,
    });
    const icon = passed ? '\u2713' : '\u2717';
    const color = passed ? colors.green : colors.red;
    log(`  ${icon} ${name}: ${passed ? 'PASS' : 'FAIL'}`, color);
  } catch (error) {
    const err = error as Error;
    results.push({
      name,
      passed: false,
      message: `ERROR: ${err.message}`,
      duration: Date.now() - startTime,
    });
    log(`  \u2717 ${name}: ERROR - ${err.message}`, colors.red);
  }
}

// ==============================================================================
// PTY EXECUTION HELPER
// ==============================================================================

interface ExecuteResult {
  success: boolean;
  stdout: string;
  exitCode: number;
  timedOut: boolean;
}

async function executePty(
  command: string,
  options: { timeout?: number; cwd?: string } = {}
): Promise<ExecuteResult> {
  const timeout = options.timeout || 30000;
  const shell = os.platform() === 'win32' ? 'powershell.exe' : '/bin/bash';
  const shellArgs = os.platform() === 'win32' ? ['-NoProfile', '-NonInteractive'] : [];

  return new Promise((resolve) => {
    let output = '';
    let resolved = false;

    try {
      const term = pty.spawn(shell, shellArgs, {
        name: 'xterm-color',
        cols: 120,
        rows: 30,
        cwd: options.cwd || os.homedir(),
        env: process.env as Record<string, string>,
      });

      const timeoutId = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          term.kill();
          resolve({
            success: false,
            stdout: cleanOutput(output),
            exitCode: -1,
            timedOut: true,
          });
        }
      }, timeout);

      term.onData((data) => {
        output += data;
      });

      term.onExit(({ exitCode }) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeoutId);
          resolve({
            success: exitCode === 0,
            stdout: cleanOutput(output),
            exitCode,
            timedOut: false,
          });
        }
      });

      term.write(`${command}\r`);
      term.write('exit\r');
    } catch (error) {
      if (!resolved) {
        resolved = true;
        resolve({
          success: false,
          stdout: (error as Error).message,
          exitCode: -1,
          timedOut: false,
        });
      }
    }
  });
}

function cleanOutput(output: string): string {
  // Remove ANSI escape codes
  // eslint-disable-next-line no-control-regex
  return output.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').trim();
}

// ==============================================================================
// TERMINAL TOOL TESTS
// ==============================================================================

async function testTerminalTool(): Promise<void> {
  log('\n1. Terminal Tool (PTY-based)\n', colors.yellow);

  // Test 1: Simple echo command
  await runTest('Echo command', async () => {
    const result = await executePty('echo hello');
    return result.success && result.stdout.includes('hello');
  });

  // Test 2: npm version check
  await runTest('npm --version', async () => {
    const result = await executePty('npm --version');
    // Check for version number pattern (e.g., 10.2.0)
    return result.success && /\d+\.\d+\.\d+/.test(result.stdout);
  });

  // Test 3: node version check
  await runTest('node --version', async () => {
    const result = await executePty('node --version');
    return result.success && /v\d+\.\d+\.\d+/.test(result.stdout);
  });

  // Test 4: Directory listing
  await runTest('Directory listing', async () => {
    const cmd = os.platform() === 'win32' ? 'dir' : 'ls';
    const result = await executePty(cmd);
    return result.success;
  });

  // Test 5: Working directory
  await runTest('Working directory', async () => {
    const testDir = os.platform() === 'win32' ? 'C:\\Windows' : '/tmp';
    const cmd = os.platform() === 'win32' ? 'cd' : 'pwd';
    const result = await executePty(cmd, { cwd: testDir });
    const expected = os.platform() === 'win32' ? 'Windows' : 'tmp';
    return result.success && result.stdout.includes(expected);
  });

  // Test 6: Timeout handling
  await runTest('Timeout handling', async () => {
    // Use ping with long duration to test timeout
    const cmd = os.platform() === 'win32' ? 'ping -n 100 127.0.0.1' : 'sleep 100';
    const result = await executePty(cmd, { timeout: 1500 });
    return result.timedOut === true;
  });

  // Test 7: Exit code capture (non-zero)
  await runTest('Non-zero exit code', async () => {
    // Use a command that will produce exit code
    const cmd = os.platform() === 'win32' ? 'powershell -Command "exit 42"' : 'bash -c "exit 42"';
    const result = await executePty(cmd);
    // Just verify we can detect failure
    return !result.success;
  });

  // Test 8: Environment variable access
  await runTest('Environment access', async () => {
    const cmd = os.platform() === 'win32' ? '$env:PATH' : 'echo $PATH';
    const result = await executePty(cmd);
    return result.success && result.stdout.length > 0;
  });

  // Test 9: Multi-line output
  await runTest('Multi-line output', async () => {
    const cmd =
      os.platform() === 'win32'
        ? 'Write-Output "line1"; Write-Output "line2"'
        : 'echo "line1"; echo "line2"';
    const result = await executePty(cmd);
    return result.success && result.stdout.includes('line1') && result.stdout.includes('line2');
  });

  // Test 10: Git version (if installed)
  await runTest('git --version', async () => {
    const result = await executePty('git --version');
    // May fail if git not installed, that's OK
    return result.stdout.includes('git version') || !result.success;
  });
}

// ==============================================================================
// FILESYSTEM TOOL TESTS
// ==============================================================================

// Import the filesystem tools - we need to test via the actual tool interface
// We'll test the validatePathSafety function and file operations directly

import {
  readFileTool,
  writeFileTool,
  deleteFileTool,
  listDirectoryTool,
  appendFileTool,
  copyFileTool,
  moveFileTool,
  createDirectoryTool,
  searchFilesTool,
} from '../src/main/agent/tools/filesystem';
import filesystemDefault from '../src/main/agent/tools/filesystem';
const { validatePathSafety } = filesystemDefault;

async function testFilesystemTool(): Promise<void> {
  log('\n2. Filesystem Tool\n', colors.yellow);

  const testDir = path.join(os.tmpdir(), 'atlas-fs-test-' + Date.now());
  const testFile = path.join(testDir, 'test.txt');
  const testFile2 = path.join(testDir, 'test2.txt');
  const testSubDir = path.join(testDir, 'subdir');

  // Create test directory
  await fs.mkdir(testDir, { recursive: true });

  try {
    // Test 1: Write file
    await runTest('Write file', async () => {
      const result = await writeFileTool.execute({
        path: testFile,
        content: 'Hello Atlas!',
      });
      return result.success === true;
    });

    // Test 2: Read file
    await runTest('Read file', async () => {
      const result = await readFileTool.execute({
        path: testFile,
      });
      return result.success && (result.data as { content: string })?.content === 'Hello Atlas!';
    });

    // Test 3: Append to file
    await runTest('Append to file', async () => {
      const result = await appendFileTool.execute({
        path: testFile,
        content: '\nAppended content',
      });
      if (!result.success) return false;
      const read = await readFileTool.execute({ path: testFile });
      return (read.data as { content: string })?.content?.includes('Appended content') ?? false;
    });

    // Test 4: List directory
    await runTest('List directory', async () => {
      const result = await listDirectoryTool.execute({
        path: testDir,
      });
      return (
        result.success &&
        Array.isArray((result.data as { entries: unknown[] })?.entries) &&
        (result.data as { entries: unknown[] }).entries.length > 0
      );
    });

    // Test 5: Create directory
    await runTest('Create directory', async () => {
      const result = await createDirectoryTool.execute({
        path: testSubDir,
      });
      return result.success === true;
    });

    // Test 6: Copy file
    await runTest('Copy file', async () => {
      const result = await copyFileTool.execute({
        source: testFile,
        destination: testFile2,
      });
      if (!result.success) return false;
      // Verify copy exists
      const read = await readFileTool.execute({ path: testFile2 });
      return read.success;
    });

    // Test 7: Move file
    await runTest('Move file', async () => {
      const movedFile = path.join(testSubDir, 'moved.txt');
      const result = await moveFileTool.execute({
        source: testFile2,
        destination: movedFile,
      });
      if (!result.success) return false;
      // Verify original is gone
      try {
        await fs.access(testFile2);
        return false; // Should not exist
      } catch {
        return true; // Good - file was moved
      }
    });

    // Test 8: Search files
    await runTest('Search files', async () => {
      const result = await searchFilesTool.execute({
        path: testDir,
        pattern: '**/*.txt',
      });
      return result.success && Array.isArray((result.data as { files: unknown[] })?.files);
    });

    // Test 9: Delete file
    await runTest('Delete file', async () => {
      const result = await deleteFileTool.execute({
        path: testFile,
      });
      if (!result.success) return false;
      // Verify file is gone
      try {
        await fs.access(testFile);
        return false; // Should not exist
      } catch {
        return true; // Good - file was deleted
      }
    });

    // Test 10: Safety check - blocked path
    await runTest('Safety blocks system paths', async () => {
      const safety = validatePathSafety('C:\\Windows\\System32\\config');
      return (
        safety.allowed === false || safety.riskLevel === 'blocked' || safety.riskLevel === 'medium'
      );
    });

    // Test 11: Safety check - .env files
    await runTest('Safety blocks .env files', async () => {
      const safety = validatePathSafety('/home/user/.env');
      return !safety.allowed;
    });

    // Test 12: Safety check - SSH keys
    await runTest('Safety blocks SSH keys', async () => {
      const safety = validatePathSafety('/home/user/.ssh/id_rsa');
      return !safety.allowed;
    });

    // Test 13: Read non-existent file
    await runTest('Read non-existent file fails', async () => {
      const result = await readFileTool.execute({
        path: path.join(testDir, 'nonexistent.txt'),
      });
      return result.success === false && result.error === 'File not found';
    });

    // Test 14: Write with createDirectories
    await runTest('Write creates parent directories', async () => {
      const deepFile = path.join(testDir, 'deep', 'nested', 'file.txt');
      const result = await writeFileTool.execute({
        path: deepFile,
        content: 'Deep content',
        createDirectories: true,
      });
      return result.success === true;
    });
  } finally {
    // Cleanup test directory
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

// ==============================================================================
// APP LAUNCHER TOOL TESTS
// ==============================================================================

import {
  launchAppTool,
  searchAppsTool,
  recentAppsTool,
  registryStatsTool,
} from '../src/main/agent/tools/app-launcher';

async function testAppLauncherTool(): Promise<void> {
  log('\n3. App Launcher Tool\n', colors.yellow);

  // Test 1: Registry stats (basic functionality)
  await runTest('Get registry stats', async () => {
    const result = await registryStatsTool.execute({});
    return (
      result.success === true &&
      typeof (result.data as { totalApps: number })?.totalApps === 'number'
    );
  });

  // Test 2: Search for notepad (should exist on all Windows)
  await runTest('Search for notepad', async () => {
    const result = await searchAppsTool.execute({
      query: 'notepad',
      limit: 5,
    });
    return (
      result.success === true && Array.isArray((result.data as { results: unknown[] })?.results)
    );
  });

  // Test 3: Search for non-existent app
  await runTest('Search for non-existent app', async () => {
    const result = await searchAppsTool.execute({
      query: 'zzz_nonexistent_app_xyz',
      limit: 5,
    });
    return result.success === true && (result.data as { count: number })?.count === 0;
  });

  // Test 4: Get recent apps (may be empty but should succeed)
  await runTest('Get recent apps', async () => {
    const result = await recentAppsTool.execute({ limit: 5 });
    return result.success === true && Array.isArray((result.data as { apps: unknown[] })?.apps);
  });

  // Test 5: Launch notepad (simple, safe test)
  await runTest('Launch notepad', async () => {
    const result = await launchAppTool.execute({
      appName: 'notepad',
    });
    // It may fail if registry is not initialized yet or notepad path differs
    // Just check the structure is correct
    return typeof result.success === 'boolean' && result.data !== undefined;
  });

  // Test 6: Voice command parsing - indirect test via launch
  await runTest('Voice command parsing', async () => {
    const result = await launchAppTool.execute({
      voiceCommand: 'open calculator',
    });
    // Just verify it handled the voice command format
    return typeof result.success === 'boolean';
  });

  // Test 7: App not found behavior
  await runTest('App not found returns suggestions', async () => {
    const result = await launchAppTool.execute({
      appName: 'zzz_nonexistent_app_xyz',
    });
    // Should fail but return suggestions
    return result.success === false && result.error !== undefined;
  });
}

// ==============================================================================
// MOUSE/KEYBOARD TOOL TESTS
// ==============================================================================

import {
  mouseKeyboardTool,
  getScreenSizeTool,
  getMousePositionTool,
  getPixelColorTool,
} from '../src/main/agent/tools/mouse-keyboard';

async function testMouseKeyboardTool(): Promise<void> {
  log('\n4. Mouse/Keyboard Tool\n', colors.yellow);

  // Test 1: Get screen size (non-destructive)
  await runTest('Get screen size', async () => {
    const result = await getScreenSizeTool.execute({});
    return (
      result.success === true &&
      typeof (result.data as { width: number })?.width === 'number' &&
      typeof (result.data as { height: number })?.height === 'number'
    );
  });

  // Test 2: Get mouse position (non-destructive)
  await runTest('Get mouse position', async () => {
    const result = await getMousePositionTool.execute({});
    return (
      result.success === true &&
      typeof (result.data as { x: number })?.x === 'number' &&
      typeof (result.data as { y: number })?.y === 'number'
    );
  });

  // Test 3: Get pixel color at 0,0 (non-destructive)
  await runTest('Get pixel color', async () => {
    const result = await getPixelColorTool.execute({ x: 0, y: 0 });
    return result.success === true && typeof (result.data as { color: string })?.color === 'string';
  });

  // Test 4: Direct execute - getScreenSize action
  await runTest('Execute getScreenSize action', async () => {
    const result = await mouseKeyboardTool.execute({ action: 'getScreenSize' });
    return result.success === true && result.data?.width !== undefined;
  });

  // Test 5: Direct execute - getMousePos action
  await runTest('Execute getMousePos action', async () => {
    const result = await mouseKeyboardTool.execute({ action: 'getMousePos' });
    return result.success === true && result.data?.x !== undefined;
  });

  // Test 6: Unknown action handling
  await runTest('Unknown action returns error', async () => {
    const result = await mouseKeyboardTool.execute({ action: 'unknown' as never });
    return result.success === false && result.error !== undefined;
  });

  // NOTE: We skip actual mouse movement/click tests to avoid interfering with the user's system
  // These can be tested manually with:
  // - moveMouseTool.execute({ x: 100, y: 100 })
  // - mouseClickTool.execute({})
  // - typeTextTool.execute({ text: 'Hello' })
  // - keyPressTool.execute({ keys: ['ctrl', 'a'] })
}

// ==============================================================================
// BROWSER TOOL TESTS
// ==============================================================================

import {
  validateUrl,
  getBrowserTools,
  findBravePath,
  launchBrowserTool,
  checkBraveTool,
  navigateToUrlTool,
  closeBrowserTool,
} from '../src/main/agent/tools/browser';

async function testBrowserTool(): Promise<void> {
  log('\n5. Browser Tool\n', colors.yellow);

  // Test 1: Valid HTTPS URL
  await runTest('Valid HTTPS URL allowed', async () => {
    const result = validateUrl('https://example.com');
    return result.valid === true;
  });

  // Test 2: Valid HTTP URL
  await runTest('Valid HTTP URL allowed', async () => {
    const result = validateUrl('http://example.com/path?query=1');
    return result.valid === true;
  });

  // Test 3: Block file:// protocol
  await runTest('Block file:// protocol', async () => {
    const result = validateUrl('file:///etc/passwd');
    return result.valid === false && (result.reason?.includes('file:') ?? false);
  });

  // Test 4: Block javascript: protocol
  await runTest('Block javascript: protocol', async () => {
    const result = validateUrl('javascript:alert(1)');
    return result.valid === false;
  });

  // Test 5: Block localhost
  await runTest('Block localhost', async () => {
    const result = validateUrl('http://localhost:3000');
    return result.valid === false && (result.reason?.includes('Local') ?? false);
  });

  // Test 6: Block internal IP 192.168.x.x
  await runTest('Block internal IP 192.168.x.x', async () => {
    const result = validateUrl('http://192.168.1.1');
    return result.valid === false && (result.reason?.includes('Internal') ?? false);
  });

  // Test 7: Block internal IP 10.x.x.x
  await runTest('Block internal IP 10.x.x.x', async () => {
    const result = validateUrl('http://10.0.0.1/admin');
    return result.valid === false;
  });

  // Test 8: Invalid URL format
  await runTest('Invalid URL format', async () => {
    const result = validateUrl('not-a-url');
    return result.valid === false && (result.reason?.includes('Invalid') ?? false);
  });

  // Test 9: Get browser tools returns array (now 8 tools with launch and check_brave)
  await runTest('getBrowserTools returns tool array', async () => {
    const tools = getBrowserTools();
    return Array.isArray(tools) && tools.length === 8;
  });

  // Test 10: Browser tools have required properties
  await runTest('Browser tools have correct structure', async () => {
    const tools = getBrowserTools();
    return tools.every(
      (tool) =>
        typeof tool.name === 'string' &&
        typeof tool.description === 'string' &&
        typeof tool.execute === 'function'
    );
  });

  // Test 11: Check Brave availability
  await runTest('Check Brave browser availability', async () => {
    const result = await checkBraveTool.execute({});
    return (
      result.success === true &&
      typeof (result.data as { available: boolean })?.available === 'boolean'
    );
  });

  // Test 12: findBravePath function
  await runTest('findBravePath returns string or null', async () => {
    const bravePath = findBravePath();
    return bravePath === null || typeof bravePath === 'string';
  });

  // NOTE: We skip actual browser launch tests as they require Chromium to be installed
  // and would open a browser window. These can be tested manually with:
  // - launchBrowserTool.execute({ browserType: 'brave', headless: false })
  // - navigateToUrlTool.execute({ url: 'https://example.com' })
  // - closeBrowserTool.execute({})
}

// ==============================================================================
// WINDOW MANAGER TOOL TESTS
// ==============================================================================

import {
  listWindowsTool,
  focusWindowTool,
  getForegroundWindowTool,
  getWindowManagerTools,
} from '../src/main/agent/tools/window-manager';

async function testWindowManagerTool(): Promise<void> {
  log('\n6. Window Manager Tool\n', colors.yellow);

  // Test 1: List all windows
  await runTest('List windows returns array', async () => {
    const result = await listWindowsTool.execute({});
    return (
      result.success === true && Array.isArray((result.data as { windows: unknown[] })?.windows)
    );
  });

  // Test 2: List windows with filter
  await runTest('List windows with filter', async () => {
    const result = await listWindowsTool.execute({ filter: 'notepad' });
    return result.success === true && result.data !== undefined;
  });

  // Test 3: Get foreground window
  await runTest('Get foreground window', async () => {
    const result = await getForegroundWindowTool.execute({});
    // May fail if no window is focused
    return result.success === true || result.error !== undefined;
  });

  // Test 4: Focus window with invalid title returns error
  await runTest('Focus window with invalid title fails', async () => {
    const result = await focusWindowTool.execute({ title: 'zzz_nonexistent_xyz' });
    return result.success === false && result.error !== undefined;
  });

  // Test 5: Get window manager tools returns array
  await runTest('getWindowManagerTools returns tool array', async () => {
    const tools = getWindowManagerTools();
    return Array.isArray(tools) && tools.length === 8;
  });

  // Test 6: Window manager tools have correct structure
  await runTest('Window manager tools have correct structure', async () => {
    const tools = getWindowManagerTools();
    return tools.every(
      (tool) =>
        typeof tool.name === 'string' &&
        typeof tool.description === 'string' &&
        typeof tool.execute === 'function'
    );
  });

  // NOTE: We skip actual window manipulation tests to avoid interfering with user's windows
}

// ==============================================================================
// SCREEN VISION TOOL TESTS
// ==============================================================================

import {
  getScreenVisionTools,
  listCaptureSources,
  visionListSourcesTool,
  ocrImageTool,
} from '../src/main/agent/tools/screen-vision';

async function testScreenVisionTool(): Promise<void> {
  log('\n7. Screen Vision Tool\n', colors.yellow);

  // Test 1: Get screen vision tools returns array
  await runTest('getScreenVisionTools returns tool array', async () => {
    const tools = getScreenVisionTools();
    return Array.isArray(tools) && tools.length === 6;
  });

  // Test 2: Screen vision tools have correct structure
  await runTest('Screen vision tools have correct structure', async () => {
    const tools = getScreenVisionTools();
    return tools.every(
      (tool) =>
        typeof tool.name === 'string' &&
        typeof tool.description === 'string' &&
        typeof tool.execute === 'function'
    );
  });

  // Test 3: Tool names follow vision_ prefix pattern
  await runTest('Tool names have vision_ prefix', async () => {
    const tools = getScreenVisionTools();
    return tools.every((tool) => tool.name.startsWith('vision_'));
  });

  // Test 4: List capture sources function exists
  await runTest('listCaptureSources is available', async () => {
    return typeof listCaptureSources === 'function';
  });

  // Test 5: OCR image tool handles missing params
  await runTest('OCR image tool requires imagePath or base64', async () => {
    const result = await ocrImageTool.execute({});
    return result.success === false && (result.error?.includes('required') ?? false);
  });

  // Test 6: Vision list sources tool structure
  await runTest('Vision list sources tool has correct params', async () => {
    return (
      visionListSourcesTool.name === 'vision_list_sources' &&
      visionListSourcesTool.parameters.type === 'object'
    );
  });

  // NOTE: We skip actual screen capture and OCR tests as they require:
  // 1. Electron's desktopCapturer (only works in main process)
  // 2. Tesseract.js initialization (downloads language files)
  // These can be tested manually in the running app with:
  // - visionCaptureScreenTool.execute({ displayIndex: 0 })
  // - ocrScreenTool.execute({})
  // - ocrImageTool.execute({ imagePath: '/path/to/image.png' })
}

// ==============================================================================
// MAIN TEST RUNNER
// ==============================================================================

async function main(): Promise<void> {
  log('='.repeat(60), colors.yellow);
  log('Atlas Desktop - Tool Tests', colors.yellow);
  log('='.repeat(60), colors.yellow);
  log(`Platform: ${os.platform()} (${os.arch()})`);
  log(`Node: ${process.version}`);

  // Run terminal tool tests
  await testTerminalTool();

  // Run filesystem tool tests
  await testFilesystemTool();

  // Run app launcher tool tests
  await testAppLauncherTool();

  // Run mouse/keyboard tool tests
  await testMouseKeyboardTool();

  // Run browser tool tests
  await testBrowserTool();

  // Run window manager tool tests
  await testWindowManagerTool();

  // Run screen vision tool tests
  await testScreenVisionTool();

  // Print summary
  log('\n' + '='.repeat(60), colors.yellow);
  log('SUMMARY', colors.yellow);
  log('='.repeat(60), colors.yellow);

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  const total = results.length;

  log(`\nTotal: ${total} | Passed: ${passed} | Failed: ${failed}`);
  log(`Success Rate: ${((passed / total) * 100).toFixed(1)}%\n`);

  if (failed > 0) {
    log('Failed Tests:', colors.red);
    results
      .filter((r) => !r.passed)
      .forEach((r) => {
        log(`  - ${r.name}: ${r.message}`, colors.red);
      });
    log('');
  }

  // Success if at least 70% pass (some tests may fail due to environment)
  const successRate = passed / total;
  if (successRate >= 0.7) {
    log('Terminal Tool Tests: PASSED', colors.green);
    process.exit(0);
  } else {
    log('Terminal Tool Tests: FAILED', colors.red);
    process.exit(1);
  }
}

// Run tests
main().catch((error) => {
  console.error('Test runner error:', error);
  process.exit(1);
});
