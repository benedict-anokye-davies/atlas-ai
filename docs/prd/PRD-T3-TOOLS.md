# PRD-T3: Desktop Tools

Terminal: T3
Role: Desktop Tools Engineer
Status: NOT_STARTED

## Objective

Implement fully functional desktop automation tools for Atlas:

- Terminal execution (run commands, capture output)
- File system operations (read, write, delete, search)
- Application control (launch, close, focus)
- Mouse and keyboard automation
- Browser control (Brave via CDP)
- Screen capture and vision analysis
- Window management

Every tool must ACTUALLY WORK. No placeholder implementations.

## File Ownership

You own these files exclusively. No other terminal will modify them.

```
src/main/agent/tools/
src/main/agent/tool-registry.ts
scripts/test-tools.ts
```

## Architecture

```
                    TOOL SYSTEM

+--------------------------------------------------+
|                  Tool Registry                    |
|  - Tool definitions for LLM                       |
|  - executeTool(name, params) dispatcher           |
+--------------------------------------------------+
         |
         v
+--------+--------+--------+--------+--------+
|Terminal|  Files | Apps   | Mouse  | Browser|
|  Tool  |  Tool  | Tool   | Tool   |  Tool  |
+--------+--------+--------+--------+--------+
    |        |        |        |        |
    v        v        v        v        v
 node-pty  fs-extra  PowerShell nut.js  Puppeteer
```

## Tasks

### Phase 1: Terminal Tool (PRIORITY)

This is the foundation. Complete it first.

#### T3-001: Install node-pty

```bash
npm install node-pty
npm install --save-dev electron-rebuild
npx electron-rebuild
```

Note: node-pty is a native module. It requires rebuilding for Electron.

If rebuild fails:

1. Install Visual Studio Build Tools
2. Run: npm config set msvs_version 2022
3. Retry rebuild

#### T3-002: Implement TerminalTool

File: `src/main/agent/tools/terminal.ts`

```typescript
import * as pty from 'node-pty';
import * as os from 'os';

interface TerminalInput {
  command: string;
  workingDirectory?: string;
  timeout?: number;
}

interface TerminalOutput {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  duration: number;
}

export class TerminalTool {
  private shell: string;
  private shellArgs: string[];

  constructor() {
    if (os.platform() === 'win32') {
      this.shell = 'powershell.exe';
      this.shellArgs = ['-NoProfile', '-NonInteractive'];
    } else {
      this.shell = '/bin/bash';
      this.shellArgs = [];
    }
  }

  async execute(input: TerminalInput): Promise<TerminalOutput> {
    const startTime = Date.now();
    const timeout = input.timeout || 30000;

    return new Promise((resolve) => {
      let output = '';

      const term = pty.spawn(this.shell, this.shellArgs, {
        name: 'xterm-color',
        cols: 120,
        rows: 30,
        cwd: input.workingDirectory || os.homedir(),
        env: process.env as Record<string, string>,
      });

      const timeoutId = setTimeout(() => {
        term.kill();
        resolve({
          success: false,
          stdout: output,
          stderr: 'Command timed out',
          exitCode: -1,
          duration: Date.now() - startTime,
        });
      }, timeout);

      term.onData((data) => {
        output += data;
      });

      term.onExit(({ exitCode }) => {
        clearTimeout(timeoutId);
        resolve({
          success: exitCode === 0,
          stdout: this.cleanOutput(output),
          stderr: '',
          exitCode,
          duration: Date.now() - startTime,
        });
      });

      term.write(input.command + '\r');
      term.write('exit\r');
    });
  }

  private cleanOutput(output: string): string {
    // Remove ANSI escape codes
    return output.replace(/\x1b\[[0-9;]*m/g, '').trim();
  }
}

export const terminalTool = new TerminalTool();
```

#### T3-003: Test Terminal Tool

Create: `scripts/test-terminal.ts`

```typescript
import { terminalTool } from '../src/main/agent/tools/terminal';

async function test() {
  console.log('Testing Terminal Tool\n');

  // Test 1: Simple echo
  console.log('Test 1: echo command');
  const r1 = await terminalTool.execute({ command: 'echo hello' });
  console.log('  Result:', r1.stdout.includes('hello') ? 'PASS' : 'FAIL');

  // Test 2: npm version
  console.log('Test 2: npm --version');
  const r2 = await terminalTool.execute({ command: 'npm --version' });
  console.log('  Result:', r2.success ? 'PASS' : 'FAIL');
  console.log('  Version:', r2.stdout.trim());

  // Test 3: Directory listing
  console.log('Test 3: directory listing');
  const r3 = await terminalTool.execute({ command: 'dir' });
  console.log('  Result:', r3.success ? 'PASS' : 'FAIL');

  // Test 4: Working directory
  console.log('Test 4: working directory');
  const r4 = await terminalTool.execute({
    command: 'cd',
    workingDirectory: 'C:\\Windows',
  });
  console.log('  Result:', r4.stdout.includes('Windows') ? 'PASS' : 'FAIL');

  // Test 5: Failed command
  console.log('Test 5: failed command');
  const r5 = await terminalTool.execute({ command: 'nonexistentcommand' });
  console.log('  Result:', !r5.success ? 'PASS (expected failure)' : 'FAIL');

  console.log('\nTerminal Tool Tests Complete');
}

test().catch(console.error);
```

Run with: `npx ts-node scripts/test-terminal.ts`

All tests must pass before proceeding.

### Phase 2: File System Tool

#### T3-004: Implement FileSystemTool

File: `src/main/agent/tools/filesystem.ts`

```typescript
import * as fs from 'fs-extra';
import * as path from 'path';
import { glob } from 'glob';
import { exec } from 'child_process';

interface FileInput {
  action: 'read' | 'write' | 'delete' | 'list' | 'search' | 'exists' | 'open';
  path: string;
  content?: string;
  pattern?: string;
}

interface FileOutput {
  success: boolean;
  data?: string | string[] | boolean | object[];
  error?: string;
}

export class FileSystemTool {
  // Directories that cannot be deleted
  private readonly protectedPaths = [
    'c:\\windows',
    'c:\\program files',
    'c:\\program files (x86)',
    'c:\\users\\default',
    '/usr',
    '/bin',
    '/etc',
    '/var',
  ];

  async execute(input: FileInput): Promise<FileOutput> {
    try {
      switch (input.action) {
        case 'read':
          return this.readFile(input.path);
        case 'write':
          return this.writeFile(input.path, input.content || '');
        case 'delete':
          return this.deleteFile(input.path);
        case 'list':
          return this.listDirectory(input.path);
        case 'search':
          return this.searchFiles(input.path, input.pattern || '*');
        case 'exists':
          return { success: true, data: await fs.pathExists(input.path) };
        case 'open':
          return this.openFile(input.path);
        default:
          return { success: false, error: 'Unknown action' };
      }
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  private async readFile(filePath: string): Promise<FileOutput> {
    const content = await fs.readFile(filePath, 'utf-8');
    return { success: true, data: content };
  }

  private async writeFile(filePath: string, content: string): Promise<FileOutput> {
    await fs.ensureDir(path.dirname(filePath));
    await fs.writeFile(filePath, content, 'utf-8');
    return { success: true, data: 'File written' };
  }

  private async deleteFile(filePath: string): Promise<FileOutput> {
    const normalized = path.normalize(filePath).toLowerCase();

    for (const protected of this.protectedPaths) {
      if (normalized.startsWith(protected)) {
        return { success: false, error: 'Cannot delete protected system path' };
      }
    }

    await fs.remove(filePath);
    return { success: true, data: 'File deleted' };
  }

  private async listDirectory(dirPath: string): Promise<FileOutput> {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const files = entries.map((e) => ({
      name: e.name,
      type: e.isDirectory() ? 'directory' : 'file',
      path: path.join(dirPath, e.name),
    }));
    return { success: true, data: files };
  }

  private async searchFiles(basePath: string, pattern: string): Promise<FileOutput> {
    const matches = await glob(pattern, { cwd: basePath, absolute: true });
    return { success: true, data: matches };
  }

  private openFile(filePath: string): Promise<FileOutput> {
    return new Promise((resolve) => {
      const cmd = process.platform === 'win32' ? `start "" "${filePath}"` : `open "${filePath}"`;

      exec(cmd, (error) => {
        if (error) {
          resolve({ success: false, error: error.message });
        } else {
          resolve({ success: true, data: 'File opened' });
        }
      });
    });
  }
}

export const fileSystemTool = new FileSystemTool();
```

#### T3-005: Safety Checks

Ensure the protectedPaths list includes all system directories.

Test that attempting to delete C:\Windows returns an error, not a crash.

#### T3-006: Test File System Tool

Add to test script:

```typescript
// Create file
const writeResult = await fileSystemTool.execute({
  action: 'write',
  path: 'C:\\temp\\atlas-test.txt',
  content: 'Hello Atlas',
});
console.log('Write:', writeResult.success ? 'PASS' : 'FAIL');

// Read file
const readResult = await fileSystemTool.execute({
  action: 'read',
  path: 'C:\\temp\\atlas-test.txt',
});
console.log('Read:', readResult.data === 'Hello Atlas' ? 'PASS' : 'FAIL');

// Delete file
const deleteResult = await fileSystemTool.execute({
  action: 'delete',
  path: 'C:\\temp\\atlas-test.txt',
});
console.log('Delete:', deleteResult.success ? 'PASS' : 'FAIL');

// Try to delete system file (should fail)
const protectedResult = await fileSystemTool.execute({
  action: 'delete',
  path: 'C:\\Windows\\System32',
});
console.log('Protected:', !protectedResult.success ? 'PASS (blocked)' : 'FAIL');
```

### Phase 3: App Launcher Tool

#### T3-007: Implement AppLauncherTool

File: `src/main/agent/tools/app-launcher.ts`

See docs/DESKTOP-TOOLS-SPEC.md for full implementation.

Key requirements:

- Map common app names to executable paths
- Launch apps detached from parent process
- Find running processes by name
- Focus existing windows
- Close applications gracefully

#### T3-008: Common Windows App Paths

```typescript
const APP_PATHS: Record<string, string> = {
  brave: 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
  chrome: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  firefox: 'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
  vscode: '%LOCALAPPDATA%\\Programs\\Microsoft VS Code\\Code.exe',
  spotify: '%APPDATA%\\Spotify\\Spotify.exe',
  discord: '%LOCALAPPDATA%\\Discord\\Update.exe --processStart Discord.exe',
  slack: '%LOCALAPPDATA%\\slack\\slack.exe',
  notepad: 'notepad.exe',
  calculator: 'calc.exe',
  explorer: 'explorer.exe',
  powershell: 'powershell.exe',
  terminal: 'wt.exe',
};
```

#### T3-009: Test App Launcher

```typescript
// Launch notepad
await appLauncherTool.execute({ action: 'launch', appName: 'notepad' });
// Wait 2 seconds
await new Promise((r) => setTimeout(r, 2000));

// Check if running
const running = await appLauncherTool.execute({ action: 'isRunning', appName: 'notepad' });
console.log('Notepad running:', running.data ? 'PASS' : 'FAIL');

// Close notepad
await appLauncherTool.execute({ action: 'close', appName: 'notepad' });
```

### Phase 4: Mouse and Keyboard Tool

#### T3-010: Install nut.js

```bash
npm install @nut-tree/nut-js
```

Note: nut.js may require additional setup on Windows.

#### T3-011: Implement MouseKeyboardTool

File: `src/main/agent/tools/mouse-keyboard.ts`

See docs/DESKTOP-TOOLS-SPEC.md for full implementation.

Key requirements:

- Move mouse to absolute coordinates
- Click (left, right, double)
- Type text with configurable delay
- Press keyboard shortcuts (Ctrl+C, Alt+Tab, etc.)
- Find UI elements by image template

#### T3-012: Test Mouse and Keyboard

```typescript
// Move mouse to center of screen
await mouseKeyboardTool.execute({ action: 'move', x: 960, y: 540 });

// Type text
await mouseKeyboardTool.execute({ action: 'type', text: 'Hello from Atlas' });

// Keyboard shortcut
await mouseKeyboardTool.execute({ action: 'keyPress', keys: ['control', 'a'] });
```

### Phase 5: Browser Tool

#### T3-013: Install puppeteer-core

```bash
npm install puppeteer-core
```

Note: puppeteer-core does not download Chromium. We use the system Brave.

#### T3-014: Implement BrowserTool

File: `src/main/agent/tools/browser.ts`

See docs/DESKTOP-TOOLS-SPEC.md for full implementation.

Key requirements:

- Launch Brave with remote debugging
- Navigate to URLs
- Click elements by selector
- Type in input fields
- Extract page content
- Take screenshots
- Manage tabs

#### T3-015: Test Browser Tool

```typescript
// Launch browser
await browserTool.execute({ action: 'launch' });

// Navigate
await browserTool.execute({ action: 'goto', url: 'https://example.com' });

// Extract title
const title = await browserTool.execute({
  action: 'extract',
  selector: 'h1',
  extractType: 'text',
});
console.log('Title:', title.data);

// Close
await browserTool.execute({ action: 'close' });
```

### Phase 6: Screen Vision Tool

#### T3-016: Install Dependencies

```bash
npm install screenshot-desktop tesseract.js
```

#### T3-017: Implement ScreenVisionTool

File: `src/main/agent/tools/screen-vision.ts`

See docs/DESKTOP-TOOLS-SPEC.md for full implementation.

Key requirements:

- Capture full screen or region
- Send to Llama 4 Maverick for analysis
- OCR with Tesseract.js
- Find UI elements by description

#### T3-018: Test Screen Vision

```typescript
// Capture screenshot
const capture = await screenVisionTool.execute({ action: 'capture' });
console.log('Screenshot saved:', capture.imagePath);

// OCR
const ocr = await screenVisionTool.execute({ action: 'ocr' });
console.log('OCR text length:', ocr.text?.length);

// Analyze (requires Fireworks API key)
const analysis = await screenVisionTool.execute({
  action: 'analyze',
  query: 'What applications are visible on this screen?',
});
console.log('Analysis:', analysis.analysis);
```

### Phase 7: Window Manager Tool

#### T3-019: Implement WindowManagerTool

File: `src/main/agent/tools/window-manager.ts`

See docs/DESKTOP-TOOLS-SPEC.md for full implementation.

Uses PowerShell for Windows window management.

#### T3-020: Test Window Manager

```typescript
// List windows
const windows = await windowManagerTool.listWindows();
console.log('Open windows:', windows.length);

// Focus a window
await windowManagerTool.focusWindow('Notepad');
```

### Phase 8: Tool Registry

#### T3-021: Create Tool Registry

File: `src/main/agent/tool-registry.ts`

```typescript
import { terminalTool } from './tools/terminal';
import { fileSystemTool } from './tools/filesystem';
import { appLauncherTool } from './tools/app-launcher';
import { mouseKeyboardTool } from './tools/mouse-keyboard';
import { browserTool } from './tools/browser';
import { screenVisionTool } from './tools/screen-vision';
import { windowManagerTool } from './tools/window-manager';

export const toolDefinitions = [
  {
    name: 'terminal',
    description: 'Execute commands in PowerShell. Use for CLI operations.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Command to execute' },
        workingDirectory: { type: 'string', description: 'Working directory' },
      },
      required: ['command'],
    },
  },
  // ... add all other tools
];

export async function executeTool(name: string, params: any): Promise<any> {
  switch (name) {
    case 'terminal':
      return terminalTool.execute(params);
    case 'files':
      return fileSystemTool.execute(params);
    case 'app':
      return appLauncherTool.execute(params);
    case 'mouse_keyboard':
      return mouseKeyboardTool.execute(params);
    case 'browser':
      return browserTool.execute(params);
    case 'screen':
      return screenVisionTool.execute(params);
    case 'windows':
      return windowManagerTool.execute(params);
    default:
      return { success: false, error: 'Unknown tool' };
  }
}
```

#### T3-022: Create IPC Handlers

File: `src/main/ipc/tool-handlers.ts`

```typescript
import { ipcMain } from 'electron';
import { executeTool, toolDefinitions } from '../agent/tool-registry';

export function registerToolHandlers(): void {
  ipcMain.handle('tools:list', () => {
    return toolDefinitions;
  });

  ipcMain.handle('tools:execute', async (_, name: string, params: any) => {
    return executeTool(name, params);
  });
}
```

## Dependencies

```
node-pty           - Terminal emulation
fs-extra           - File system operations
glob               - File pattern matching
@nut-tree/nut-js   - Mouse/keyboard automation
puppeteer-core     - Browser control
screenshot-desktop - Screen capture
tesseract.js       - OCR
```

## Quality Checklist

Before marking any task DONE:

- [ ] Tool executes without throwing
- [ ] Success cases work correctly
- [ ] Error cases return error, not throw
- [ ] Timeout handling works
- [ ] No hardcoded paths (use environment variables)
- [ ] TypeScript compiles
- [ ] Manual test passes

## Verification Tests

Run before any commit:

```bash
npx ts-node scripts/test-tools.ts
```

All tools must pass their verification tests.

## Notes

- All tools run on main process, not renderer
- Use IPC for renderer communication
- Log all tool executions for debugging
- Handle native module rebuild for Electron
- Test on Windows 11 specifically
