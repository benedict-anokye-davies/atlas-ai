# Desktop Tools Implementation Specification

## Core Principle

**Every tool must actually work.** No placeholder implementations. No "TODO" comments. Each tool must:

1. Execute the action on the real system
2. Return meaningful output/feedback
3. Handle errors gracefully
4. Be tested end-to-end before marking complete

## Tool Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      ATLAS TOOL SYSTEM                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐ │
│  │  Terminal  │  │   Files    │  │    Apps    │  │   Mouse/   │ │
│  │    Tool    │  │    Tool    │  │    Tool    │  │  Keyboard  │ │
│  └─────┬──────┘  └─────┬──────┘  └─────┬──────┘  └─────┬──────┘ │
│        │               │               │               │        │
│  ┌─────▼──────┐  ┌─────▼──────┐  ┌─────▼──────┐  ┌─────▼──────┐ │
│  │  node-pty  │  │  fs-extra  │  │ PowerShell │  │   nut.js   │ │
│  │            │  │            │  │   + WMI    │  │            │ │
│  └────────────┘  └────────────┘  └────────────┘  └────────────┘ │
│                                                                  │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐                 │
│  │  Browser   │  │   Screen   │  │   Window   │                 │
│  │    Tool    │  │   Vision   │  │  Manager   │                 │
│  └─────┬──────┘  └─────┬──────┘  └─────┬──────┘                 │
│        │               │               │                        │
│  ┌─────▼──────┐  ┌─────▼──────┐  ┌─────▼──────┐                 │
│  │ Puppeteer  │  │ screenshot │  │   node-    │                 │
│  │   + CDP    │  │  -desktop  │  │  window-   │                 │
│  │            │  │  + Llama4  │  │  manager   │                 │
│  └────────────┘  └────────────┘  └────────────┘                 │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Tool 1: Terminal Tool

Execute commands in PowerShell/cmd and capture output.

### Interface

```typescript
interface TerminalToolInput {
  command: string;
  workingDirectory?: string;
  timeout?: number; // ms, default 30000
  shell?: 'powershell' | 'cmd' | 'bash';
}

interface TerminalToolOutput {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  duration: number; // ms
}
```

### Implementation

```typescript
// src/main/agent/tools/terminal.ts

import * as pty from 'node-pty';
import * as os from 'os';

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

  async execute(input: TerminalToolInput): Promise<TerminalToolOutput> {
    const startTime = Date.now();

    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';

      const term = pty.spawn(this.shell, this.shellArgs, {
        name: 'xterm-color',
        cols: 120,
        rows: 30,
        cwd: input.workingDirectory || os.homedir(),
        env: process.env as Record<string, string>,
      });

      // Timeout handler
      const timeout = setTimeout(() => {
        term.kill();
        resolve({
          success: false,
          stdout,
          stderr: 'Command timed out',
          exitCode: -1,
          duration: Date.now() - startTime,
        });
      }, input.timeout || 30000);

      term.onData((data) => {
        stdout += data;
      });

      term.onExit(({ exitCode }) => {
        clearTimeout(timeout);
        resolve({
          success: exitCode === 0,
          stdout: this.cleanOutput(stdout),
          stderr,
          exitCode,
          duration: Date.now() - startTime,
        });
      });

      // Write command and exit
      term.write(`${input.command}\r`);
      term.write('exit\r');
    });
  }

  private cleanOutput(output: string): string {
    // Remove ANSI escape codes
    return output.replace(/\x1b\[[0-9;]*m/g, '').trim();
  }

  // For long-running processes with streaming output
  async executeStreaming(
    input: TerminalToolInput,
    onOutput: (data: string) => void
  ): Promise<TerminalToolOutput> {
    const startTime = Date.now();
    let fullOutput = '';

    return new Promise((resolve) => {
      const term = pty.spawn(this.shell, this.shellArgs, {
        name: 'xterm-color',
        cols: 120,
        rows: 30,
        cwd: input.workingDirectory || os.homedir(),
        env: process.env as Record<string, string>,
      });

      term.onData((data) => {
        fullOutput += data;
        onOutput(data); // Stream to caller
      });

      term.onExit(({ exitCode }) => {
        resolve({
          success: exitCode === 0,
          stdout: this.cleanOutput(fullOutput),
          stderr: '',
          exitCode,
          duration: Date.now() - startTime,
        });
      });

      term.write(`${input.command}\r`);
      term.write('exit\r');
    });
  }
}

// Singleton
export const terminalTool = new TerminalTool();
```

### Usage Examples

```typescript
// Simple command
const result = await terminalTool.execute({
  command: 'npm --version',
});
console.log(result.stdout); // "10.2.0"

// With working directory
const result = await terminalTool.execute({
  command: 'git status',
  workingDirectory: 'C:\\Users\\Nxiss\\projects\\my-app',
});

// Streaming for long processes
await terminalTool.executeStreaming(
  { command: 'npm install' },
  (output) => console.log(output) // Real-time output
);
```

### Test Cases

```typescript
describe('TerminalTool', () => {
  it('should execute simple command', async () => {
    const result = await terminalTool.execute({ command: 'echo hello' });
    expect(result.success).toBe(true);
    expect(result.stdout).toContain('hello');
  });

  it('should capture exit code on failure', async () => {
    const result = await terminalTool.execute({ command: 'exit 1' });
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
  });

  it('should respect working directory', async () => {
    const result = await terminalTool.execute({
      command: 'cd',
      workingDirectory: 'C:\\Windows',
    });
    expect(result.stdout).toContain('Windows');
  });

  it('should timeout long commands', async () => {
    const result = await terminalTool.execute({
      command: 'ping -n 100 localhost',
      timeout: 1000,
    });
    expect(result.success).toBe(false);
    expect(result.stderr).toContain('timed out');
  });
});
```

---

## Tool 2: File System Tool

Read, write, and manage files on the system.

### Interface

```typescript
interface FileToolInput {
  action: 'read' | 'write' | 'delete' | 'list' | 'search' | 'exists' | 'open';
  path: string;
  content?: string;
  pattern?: string; // For search
  recursive?: boolean;
}

interface FileToolOutput {
  success: boolean;
  data?: string | string[] | boolean;
  error?: string;
}
```

### Implementation

```typescript
// src/main/agent/tools/filesystem.ts

import * as fs from 'fs-extra';
import * as path from 'path';
import { glob } from 'glob';
import { exec } from 'child_process';

export class FileSystemTool {
  async execute(input: FileToolInput): Promise<FileToolOutput> {
    try {
      switch (input.action) {
        case 'read':
          return await this.readFile(input.path);
        case 'write':
          return await this.writeFile(input.path, input.content || '');
        case 'delete':
          return await this.deleteFile(input.path);
        case 'list':
          return await this.listDirectory(input.path);
        case 'search':
          return await this.searchFiles(input.path, input.pattern || '*');
        case 'exists':
          return { success: true, data: await fs.pathExists(input.path) };
        case 'open':
          return await this.openFile(input.path);
        default:
          return { success: false, error: `Unknown action: ${input.action}` };
      }
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  private async readFile(filePath: string): Promise<FileToolOutput> {
    const content = await fs.readFile(filePath, 'utf-8');
    return { success: true, data: content };
  }

  private async writeFile(filePath: string, content: string): Promise<FileToolOutput> {
    // Ensure directory exists
    await fs.ensureDir(path.dirname(filePath));
    await fs.writeFile(filePath, content, 'utf-8');
    return { success: true, data: `Written to ${filePath}` };
  }

  private async deleteFile(filePath: string): Promise<FileToolOutput> {
    // Safety: Don't allow deleting system directories
    const normalized = path.normalize(filePath).toLowerCase();
    const forbidden = ['c:\\windows', 'c:\\program files', '/usr', '/bin', '/etc'];

    if (forbidden.some((f) => normalized.startsWith(f))) {
      return { success: false, error: 'Cannot delete system files' };
    }

    await fs.remove(filePath);
    return { success: true, data: `Deleted ${filePath}` };
  }

  private async listDirectory(dirPath: string): Promise<FileToolOutput> {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const files = entries.map((e) => ({
      name: e.name,
      type: e.isDirectory() ? 'directory' : 'file',
      path: path.join(dirPath, e.name),
    }));
    return { success: true, data: files as any };
  }

  private async searchFiles(basePath: string, pattern: string): Promise<FileToolOutput> {
    const matches = await glob(pattern, {
      cwd: basePath,
      absolute: true,
    });
    return { success: true, data: matches };
  }

  private async openFile(filePath: string): Promise<FileToolOutput> {
    return new Promise((resolve) => {
      // Windows: use 'start', Mac: use 'open', Linux: use 'xdg-open'
      const command =
        process.platform === 'win32'
          ? `start "" "${filePath}"`
          : process.platform === 'darwin'
            ? `open "${filePath}"`
            : `xdg-open "${filePath}"`;

      exec(command, (error) => {
        if (error) {
          resolve({ success: false, error: error.message });
        } else {
          resolve({ success: true, data: `Opened ${filePath}` });
        }
      });
    });
  }
}

export const fileSystemTool = new FileSystemTool();
```

### Test Cases

```typescript
describe('FileSystemTool', () => {
  const testDir = path.join(os.tmpdir(), 'atlas-test');

  beforeAll(async () => {
    await fs.ensureDir(testDir);
  });

  afterAll(async () => {
    await fs.remove(testDir);
  });

  it('should write and read a file', async () => {
    const testFile = path.join(testDir, 'test.txt');

    await fileSystemTool.execute({
      action: 'write',
      path: testFile,
      content: 'Hello World',
    });

    const result = await fileSystemTool.execute({
      action: 'read',
      path: testFile,
    });

    expect(result.data).toBe('Hello World');
  });

  it('should prevent deleting system files', async () => {
    const result = await fileSystemTool.execute({
      action: 'delete',
      path: 'C:\\Windows\\System32',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('system files');
  });
});
```

---

## Tool 3: App Launcher Tool

Launch, focus, and close applications.

### Interface

```typescript
interface AppToolInput {
  action: 'launch' | 'close' | 'focus' | 'isRunning' | 'list';
  appName?: string;
  appPath?: string;
}

interface AppToolOutput {
  success: boolean;
  data?: boolean | ProcessInfo[];
  error?: string;
}

interface ProcessInfo {
  name: string;
  pid: number;
  windowTitle?: string;
}
```

### Implementation

```typescript
// src/main/agent/tools/app-launcher.ts

import { exec, spawn } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Common app paths on Windows
const APP_PATHS: Record<string, string> = {
  brave: 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
  chrome: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  vscode: 'C:\\Users\\%USERNAME%\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe',
  spotify: 'C:\\Users\\%USERNAME%\\AppData\\Roaming\\Spotify\\Spotify.exe',
  discord: 'C:\\Users\\%USERNAME%\\AppData\\Local\\Discord\\Update.exe --processStart Discord.exe',
  notepad: 'notepad.exe',
  explorer: 'explorer.exe',
  powershell: 'powershell.exe',
  cmd: 'cmd.exe',
  terminal: 'wt.exe', // Windows Terminal
};

export class AppLauncherTool {
  async execute(input: AppToolInput): Promise<AppToolOutput> {
    try {
      switch (input.action) {
        case 'launch':
          return await this.launchApp(input.appName || '', input.appPath);
        case 'close':
          return await this.closeApp(input.appName || '');
        case 'focus':
          return await this.focusApp(input.appName || '');
        case 'isRunning':
          return await this.isAppRunning(input.appName || '');
        case 'list':
          return await this.listRunningApps();
        default:
          return { success: false, error: `Unknown action: ${input.action}` };
      }
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  private async launchApp(appName: string, appPath?: string): Promise<AppToolOutput> {
    const path = appPath || APP_PATHS[appName.toLowerCase()];

    if (!path) {
      // Try to find it via Windows search
      const searchResult = await this.findAppPath(appName);
      if (!searchResult) {
        return { success: false, error: `App not found: ${appName}` };
      }
      appPath = searchResult;
    }

    // Expand environment variables
    const expandedPath = path.replace(/%(\w+)%/g, (_, varName) => process.env[varName] || '');

    // Launch the app (detached)
    spawn(expandedPath, [], {
      detached: true,
      stdio: 'ignore',
      shell: true,
    }).unref();

    return { success: true, data: true };
  }

  private async closeApp(appName: string): Promise<AppToolOutput> {
    // Use taskkill on Windows
    const processName = this.getProcessName(appName);

    try {
      await execAsync(`taskkill /IM "${processName}" /F`);
      return { success: true, data: true };
    } catch (error: any) {
      if (error.message.includes('not found')) {
        return { success: false, error: `Process not found: ${processName}` };
      }
      throw error;
    }
  }

  private async focusApp(appName: string): Promise<AppToolOutput> {
    // Use PowerShell to bring window to front
    const script = `
      Add-Type @"
        using System;
        using System.Runtime.InteropServices;
        public class Win32 {
          [DllImport("user32.dll")]
          public static extern bool SetForegroundWindow(IntPtr hWnd);
        }
"@
      $process = Get-Process -Name "${appName}" -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($process) {
        [Win32]::SetForegroundWindow($process.MainWindowHandle)
        Write-Output "focused"
      } else {
        Write-Output "not_found"
      }
    `;

    const { stdout } = await execAsync(`powershell -Command "${script.replace(/"/g, '\\"')}"`);

    if (stdout.includes('focused')) {
      return { success: true, data: true };
    } else {
      return { success: false, error: `Window not found: ${appName}` };
    }
  }

  private async isAppRunning(appName: string): Promise<AppToolOutput> {
    const processName = this.getProcessName(appName);

    try {
      const { stdout } = await execAsync(`tasklist /FI "IMAGENAME eq ${processName}"`);
      const isRunning = stdout.toLowerCase().includes(processName.toLowerCase());
      return { success: true, data: isRunning };
    } catch {
      return { success: true, data: false };
    }
  }

  private async listRunningApps(): Promise<AppToolOutput> {
    const { stdout } = await execAsync('tasklist /FO CSV /NH');

    const processes: ProcessInfo[] = stdout
      .trim()
      .split('\n')
      .map((line) => {
        const parts = line.split('","');
        return {
          name: parts[0]?.replace(/"/g, '') || '',
          pid: parseInt(parts[1]?.replace(/"/g, '') || '0', 10),
        };
      })
      .filter((p) => p.name && p.pid);

    return { success: true, data: processes };
  }

  private async findAppPath(appName: string): Promise<string | null> {
    try {
      const { stdout } = await execAsync(`where ${appName}`);
      return stdout.trim().split('\n')[0];
    } catch {
      return null;
    }
  }

  private getProcessName(appName: string): string {
    const mapping: Record<string, string> = {
      brave: 'brave.exe',
      chrome: 'chrome.exe',
      vscode: 'Code.exe',
      spotify: 'Spotify.exe',
      discord: 'Discord.exe',
      notepad: 'notepad.exe',
    };

    return mapping[appName.toLowerCase()] || `${appName}.exe`;
  }
}

export const appLauncherTool = new AppLauncherTool();
```

---

## Tool 4: Mouse & Keyboard Tool (nut.js)

Control mouse and keyboard for UI automation.

### Interface

```typescript
interface MouseKeyboardInput {
  action: 'move' | 'click' | 'doubleClick' | 'rightClick' | 'type' | 'keyPress' | 'findImage';
  x?: number;
  y?: number;
  text?: string;
  keys?: string[]; // e.g., ['control', 'c']
  imagePath?: string; // For findImage
}

interface MouseKeyboardOutput {
  success: boolean;
  data?: { x: number; y: number } | boolean;
  error?: string;
}
```

### Implementation

```typescript
// src/main/agent/tools/mouse-keyboard.ts

import { mouse, keyboard, screen, straightTo, centerOf, Button, Key } from '@nut-tree/nut-js';
import { imageResource } from '@nut-tree/nut-js';

// Configure nut.js
keyboard.config.autoDelayMs = 50;
mouse.config.autoDelayMs = 100;
mouse.config.mouseSpeed = 1500;

export class MouseKeyboardTool {
  async execute(input: MouseKeyboardInput): Promise<MouseKeyboardOutput> {
    try {
      switch (input.action) {
        case 'move':
          return await this.moveMouse(input.x!, input.y!);
        case 'click':
          return await this.click(input.x, input.y);
        case 'doubleClick':
          return await this.doubleClick(input.x, input.y);
        case 'rightClick':
          return await this.rightClick(input.x, input.y);
        case 'type':
          return await this.typeText(input.text!);
        case 'keyPress':
          return await this.pressKeys(input.keys!);
        case 'findImage':
          return await this.findImage(input.imagePath!);
        default:
          return { success: false, error: `Unknown action: ${input.action}` };
      }
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  private async moveMouse(x: number, y: number): Promise<MouseKeyboardOutput> {
    await mouse.move(straightTo({ x, y }));
    return { success: true, data: { x, y } };
  }

  private async click(x?: number, y?: number): Promise<MouseKeyboardOutput> {
    if (x !== undefined && y !== undefined) {
      await mouse.move(straightTo({ x, y }));
    }
    await mouse.click(Button.LEFT);
    const pos = await mouse.getPosition();
    return { success: true, data: { x: pos.x, y: pos.y } };
  }

  private async doubleClick(x?: number, y?: number): Promise<MouseKeyboardOutput> {
    if (x !== undefined && y !== undefined) {
      await mouse.move(straightTo({ x, y }));
    }
    await mouse.doubleClick(Button.LEFT);
    const pos = await mouse.getPosition();
    return { success: true, data: { x: pos.x, y: pos.y } };
  }

  private async rightClick(x?: number, y?: number): Promise<MouseKeyboardOutput> {
    if (x !== undefined && y !== undefined) {
      await mouse.move(straightTo({ x, y }));
    }
    await mouse.click(Button.RIGHT);
    const pos = await mouse.getPosition();
    return { success: true, data: { x: pos.x, y: pos.y } };
  }

  private async typeText(text: string): Promise<MouseKeyboardOutput> {
    await keyboard.type(text);
    return { success: true, data: true };
  }

  private async pressKeys(keys: string[]): Promise<MouseKeyboardOutput> {
    // Map string keys to Key enum
    const keyMap: Record<string, Key> = {
      control: Key.LeftControl,
      ctrl: Key.LeftControl,
      alt: Key.LeftAlt,
      shift: Key.LeftShift,
      enter: Key.Enter,
      return: Key.Enter,
      tab: Key.Tab,
      escape: Key.Escape,
      esc: Key.Escape,
      backspace: Key.Backspace,
      delete: Key.Delete,
      up: Key.Up,
      down: Key.Down,
      left: Key.Left,
      right: Key.Right,
      home: Key.Home,
      end: Key.End,
      pageup: Key.PageUp,
      pagedown: Key.PageDown,
      f1: Key.F1,
      f2: Key.F2,
      f3: Key.F3,
      f4: Key.F4,
      f5: Key.F5,
      f6: Key.F6,
      f7: Key.F7,
      f8: Key.F8,
      f9: Key.F9,
      f10: Key.F10,
      f11: Key.F11,
      f12: Key.F12,
      a: Key.A,
      b: Key.B,
      c: Key.C,
      d: Key.D,
      e: Key.E,
      f: Key.F,
      g: Key.G,
      h: Key.H,
      i: Key.I,
      j: Key.J,
      k: Key.K,
      l: Key.L,
      m: Key.M,
      n: Key.N,
      o: Key.O,
      p: Key.P,
      q: Key.Q,
      r: Key.R,
      s: Key.S,
      t: Key.T,
      u: Key.U,
      v: Key.V,
      w: Key.W,
      x: Key.X,
      y: Key.Y,
      z: Key.Z,
      s: Key.S,
      v: Key.V,
      c: Key.C,
      x: Key.X,
    };

    const mappedKeys = keys.map((k) => keyMap[k.toLowerCase()] || k);

    // Press all keys together (for shortcuts like Ctrl+C)
    if (mappedKeys.length > 1) {
      await keyboard.pressKey(...mappedKeys);
      await keyboard.releaseKey(...mappedKeys.reverse());
    } else {
      await keyboard.type(keys[0]);
    }

    return { success: true, data: true };
  }

  private async findImage(imagePath: string): Promise<MouseKeyboardOutput> {
    try {
      const image = await imageResource(imagePath);
      const location = await screen.find(image);
      const center = await centerOf(location);
      return { success: true, data: { x: center.x, y: center.y } };
    } catch {
      return { success: false, error: 'Image not found on screen' };
    }
  }

  // High-level helpers
  async clickOnImage(imagePath: string): Promise<MouseKeyboardOutput> {
    const found = await this.findImage(imagePath);
    if (!found.success || !found.data) {
      return found;
    }
    return await this.click(found.data.x, found.data.y);
  }

  async copyToClipboard(): Promise<MouseKeyboardOutput> {
    return await this.pressKeys(['control', 'c']);
  }

  async pasteFromClipboard(): Promise<MouseKeyboardOutput> {
    return await this.pressKeys(['control', 'v']);
  }

  async saveFile(): Promise<MouseKeyboardOutput> {
    return await this.pressKeys(['control', 's']);
  }

  async switchWindow(): Promise<MouseKeyboardOutput> {
    return await this.pressKeys(['alt', 'tab']);
  }
}

export const mouseKeyboardTool = new MouseKeyboardTool();
```

---

## Tool 5: Screen Vision Tool

Capture screenshots and analyze them with Llama 4 Maverick.

### Interface

```typescript
interface ScreenVisionInput {
  action: 'capture' | 'analyze' | 'ocr' | 'findElement';
  region?: { x: number; y: number; width: number; height: number };
  query?: string; // For analyze: "What buttons are on screen?"
  targetDescription?: string; // For findElement: "the submit button"
}

interface ScreenVisionOutput {
  success: boolean;
  imagePath?: string;
  analysis?: string;
  text?: string; // OCR result
  elementLocation?: { x: number; y: number };
  error?: string;
}
```

### Implementation

```typescript
// src/main/agent/tools/screen-vision.ts

import screenshot from 'screenshot-desktop';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import Tesseract from 'tesseract.js';

const FIREWORKS_API_KEY = process.env.FIREWORKS_API_KEY;
const VISION_MODEL = 'accounts/fireworks/models/llama-v4-maverick-instruct-basic';

export class ScreenVisionTool {
  private screenshotDir: string;

  constructor() {
    this.screenshotDir = path.join(os.tmpdir(), 'atlas-screenshots');
    fs.ensureDirSync(this.screenshotDir);
  }

  async execute(input: ScreenVisionInput): Promise<ScreenVisionOutput> {
    try {
      switch (input.action) {
        case 'capture':
          return await this.captureScreen(input.region);
        case 'analyze':
          return await this.analyzeScreen(input.query || 'Describe what you see on this screen.');
        case 'ocr':
          return await this.performOCR(input.region);
        case 'findElement':
          return await this.findElement(input.targetDescription || '');
        default:
          return { success: false, error: `Unknown action: ${input.action}` };
      }
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  private async captureScreen(region?: any): Promise<ScreenVisionOutput> {
    const filename = `screenshot-${Date.now()}.png`;
    const filepath = path.join(this.screenshotDir, filename);

    const imgBuffer = await screenshot({ format: 'png' });
    await fs.writeFile(filepath, imgBuffer);

    // If region specified, crop (would need sharp or jimp)
    // For now, capture full screen

    return { success: true, imagePath: filepath };
  }

  private async analyzeScreen(query: string): Promise<ScreenVisionOutput> {
    // First capture
    const capture = await this.captureScreen();
    if (!capture.success || !capture.imagePath) {
      return capture;
    }

    // Read and encode image
    const imageBuffer = await fs.readFile(capture.imagePath);
    const base64Image = imageBuffer.toString('base64');

    // Send to Llama 4 Maverick
    const response = await fetch('https://api.fireworks.ai/inference/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${FIREWORKS_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: VISION_MODEL,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: query },
              {
                type: 'image_url',
                image_url: { url: `data:image/png;base64,${base64Image}` },
              },
            ],
          },
        ],
        max_tokens: 1024,
      }),
    });

    const data = await response.json();
    const analysis = data.choices[0]?.message?.content || 'No analysis available';

    return {
      success: true,
      imagePath: capture.imagePath,
      analysis,
    };
  }

  private async performOCR(region?: any): Promise<ScreenVisionOutput> {
    const capture = await this.captureScreen(region);
    if (!capture.success || !capture.imagePath) {
      return capture;
    }

    const {
      data: { text },
    } = await Tesseract.recognize(capture.imagePath, 'eng');

    return {
      success: true,
      imagePath: capture.imagePath,
      text,
    };
  }

  private async findElement(description: string): Promise<ScreenVisionOutput> {
    const query = `
      I need to find the UI element described as: "${description}"
      
      Please analyze the screenshot and provide:
      1. Whether you can see this element
      2. Its approximate location as x,y coordinates (center of element)
      3. Use screen coordinates where (0,0) is top-left
      
      Respond in JSON format:
      {"found": true/false, "x": number, "y": number, "confidence": "high/medium/low"}
    `;

    const result = await this.analyzeScreen(query);
    if (!result.success || !result.analysis) {
      return result;
    }

    try {
      // Parse JSON from response
      const jsonMatch = result.analysis.match(/\{[^}]+\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.found) {
          return {
            success: true,
            elementLocation: { x: parsed.x, y: parsed.y },
            analysis: result.analysis,
          };
        }
      }
      return { success: false, error: 'Element not found', analysis: result.analysis };
    } catch {
      return {
        success: false,
        error: 'Could not parse element location',
        analysis: result.analysis,
      };
    }
  }
}

export const screenVisionTool = new ScreenVisionTool();
```

---

## Tool 6: Browser Tool (Puppeteer + CDP)

Control Brave browser via Chrome DevTools Protocol.

### Interface

```typescript
interface BrowserToolInput {
  action:
    | 'launch'
    | 'goto'
    | 'click'
    | 'type'
    | 'extract'
    | 'screenshot'
    | 'close'
    | 'newTab'
    | 'closeTab';
  url?: string;
  selector?: string;
  text?: string;
  extractType?: 'text' | 'html' | 'attribute';
  attribute?: string;
}

interface BrowserToolOutput {
  success: boolean;
  data?: string | any;
  error?: string;
}
```

### Implementation

```typescript
// src/main/agent/tools/browser.ts

import puppeteer, { Browser, Page } from 'puppeteer-core';
import * as path from 'path';

const BRAVE_PATHS = {
  win32: 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
  darwin: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  linux: '/usr/bin/brave-browser',
};

export class BrowserTool {
  private browser: Browser | null = null;
  private page: Page | null = null;

  async execute(input: BrowserToolInput): Promise<BrowserToolOutput> {
    try {
      switch (input.action) {
        case 'launch':
          return await this.launchBrowser();
        case 'goto':
          return await this.navigate(input.url!);
        case 'click':
          return await this.clickElement(input.selector!);
        case 'type':
          return await this.typeInElement(input.selector!, input.text!);
        case 'extract':
          return await this.extractContent(
            input.selector!,
            input.extractType || 'text',
            input.attribute
          );
        case 'screenshot':
          return await this.takeScreenshot();
        case 'close':
          return await this.closeBrowser();
        case 'newTab':
          return await this.newTab(input.url);
        case 'closeTab':
          return await this.closeTab();
        default:
          return { success: false, error: `Unknown action: ${input.action}` };
      }
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  private async launchBrowser(): Promise<BrowserToolOutput> {
    if (this.browser) {
      return { success: true, data: 'Browser already running' };
    }

    const executablePath = BRAVE_PATHS[process.platform as keyof typeof BRAVE_PATHS];

    this.browser = await puppeteer.launch({
      executablePath,
      headless: false,
      defaultViewport: null,
      args: ['--remote-debugging-port=9222', '--no-first-run', '--start-maximized'],
    });

    const pages = await this.browser.pages();
    this.page = pages[0] || (await this.browser.newPage());

    return { success: true, data: 'Browser launched' };
  }

  private async ensureBrowser(): Promise<void> {
    if (!this.browser || !this.page) {
      await this.launchBrowser();
    }
  }

  private async navigate(url: string): Promise<BrowserToolOutput> {
    await this.ensureBrowser();

    // Add protocol if missing
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }

    await this.page!.goto(url, { waitUntil: 'networkidle2' });
    return { success: true, data: `Navigated to ${url}` };
  }

  private async clickElement(selector: string): Promise<BrowserToolOutput> {
    await this.ensureBrowser();

    // Wait for element to be visible
    await this.page!.waitForSelector(selector, { visible: true, timeout: 5000 });
    await this.page!.click(selector);

    return { success: true, data: `Clicked ${selector}` };
  }

  private async typeInElement(selector: string, text: string): Promise<BrowserToolOutput> {
    await this.ensureBrowser();

    await this.page!.waitForSelector(selector, { visible: true, timeout: 5000 });
    await this.page!.type(selector, text);

    return { success: true, data: `Typed in ${selector}` };
  }

  private async extractContent(
    selector: string,
    extractType: string,
    attribute?: string
  ): Promise<BrowserToolOutput> {
    await this.ensureBrowser();

    await this.page!.waitForSelector(selector, { timeout: 5000 });

    let data: string;

    switch (extractType) {
      case 'text':
        data = await this.page!.$eval(selector, (el) => el.textContent || '');
        break;
      case 'html':
        data = await this.page!.$eval(selector, (el) => el.innerHTML);
        break;
      case 'attribute':
        data = await this.page!.$eval(
          selector,
          (el, attr) => el.getAttribute(attr) || '',
          attribute!
        );
        break;
      default:
        return { success: false, error: `Unknown extract type: ${extractType}` };
    }

    return { success: true, data };
  }

  private async takeScreenshot(): Promise<BrowserToolOutput> {
    await this.ensureBrowser();

    const screenshotPath = path.join(
      require('os').tmpdir(),
      `browser-screenshot-${Date.now()}.png`
    );

    await this.page!.screenshot({ path: screenshotPath, fullPage: true });

    return { success: true, data: screenshotPath };
  }

  private async newTab(url?: string): Promise<BrowserToolOutput> {
    await this.ensureBrowser();

    this.page = await this.browser!.newPage();

    if (url) {
      await this.navigate(url);
    }

    return { success: true, data: 'New tab opened' };
  }

  private async closeTab(): Promise<BrowserToolOutput> {
    if (this.page) {
      await this.page.close();

      const pages = await this.browser!.pages();
      this.page = pages[pages.length - 1] || null;
    }

    return { success: true, data: 'Tab closed' };
  }

  private async closeBrowser(): Promise<BrowserToolOutput> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }

    return { success: true, data: 'Browser closed' };
  }

  // High-level helpers
  async searchGoogle(query: string): Promise<BrowserToolOutput> {
    await this.navigate('https://www.google.com');
    await this.typeInElement('textarea[name="q"]', query);
    await this.page!.keyboard.press('Enter');
    await this.page!.waitForNavigation({ waitUntil: 'networkidle2' });

    return { success: true, data: `Searched for: ${query}` };
  }

  async getPageTitle(): Promise<BrowserToolOutput> {
    await this.ensureBrowser();
    const title = await this.page!.title();
    return { success: true, data: title };
  }

  async getPageUrl(): Promise<BrowserToolOutput> {
    await this.ensureBrowser();
    const url = this.page!.url();
    return { success: true, data: url };
  }
}

export const browserTool = new BrowserTool();
```

---

## Tool 7: Window Manager Tool

Manage application windows.

### Implementation

```typescript
// src/main/agent/tools/window-manager.ts

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface WindowInfo {
  title: string;
  processName: string;
  handle: string;
}

export class WindowManagerTool {
  async listWindows(): Promise<WindowInfo[]> {
    const script = `
      Get-Process | Where-Object {$_.MainWindowTitle -ne ""} | Select-Object ProcessName, MainWindowTitle, MainWindowHandle | ConvertTo-Json
    `;

    const { stdout } = await execAsync(`powershell -Command "${script}"`);
    const windows = JSON.parse(stdout);

    return (Array.isArray(windows) ? windows : [windows]).map((w: any) => ({
      title: w.MainWindowTitle,
      processName: w.ProcessName,
      handle: w.MainWindowHandle.toString(),
    }));
  }

  async focusWindow(titleOrProcess: string): Promise<boolean> {
    const script = `
      Add-Type @"
        using System;
        using System.Runtime.InteropServices;
        public class Win32 {
          [DllImport("user32.dll")]
          public static extern bool SetForegroundWindow(IntPtr hWnd);
          [DllImport("user32.dll")]
          public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
        }
"@
      $proc = Get-Process | Where-Object {$_.MainWindowTitle -like "*${titleOrProcess}*" -or $_.ProcessName -like "*${titleOrProcess}*"} | Select-Object -First 1
      if ($proc) {
        [Win32]::ShowWindow($proc.MainWindowHandle, 9)
        [Win32]::SetForegroundWindow($proc.MainWindowHandle)
        Write-Output "success"
      } else {
        Write-Output "not_found"
      }
    `;

    const { stdout } = await execAsync(`powershell -Command "${script.replace(/"/g, '\\"')}"`);
    return stdout.includes('success');
  }

  async minimizeWindow(titleOrProcess: string): Promise<boolean> {
    const script = `
      Add-Type @"
        using System;
        using System.Runtime.InteropServices;
        public class Win32 {
          [DllImport("user32.dll")]
          public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
        }
"@
      $proc = Get-Process | Where-Object {$_.MainWindowTitle -like "*${titleOrProcess}*" -or $_.ProcessName -like "*${titleOrProcess}*"} | Select-Object -First 1
      if ($proc) {
        [Win32]::ShowWindow($proc.MainWindowHandle, 6)
        Write-Output "success"
      }
    `;

    const { stdout } = await execAsync(`powershell -Command "${script.replace(/"/g, '\\"')}"`);
    return stdout.includes('success');
  }

  async maximizeWindow(titleOrProcess: string): Promise<boolean> {
    const script = `
      Add-Type @"
        using System;
        using System.Runtime.InteropServices;
        public class Win32 {
          [DllImport("user32.dll")]
          public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
        }
"@
      $proc = Get-Process | Where-Object {$_.MainWindowTitle -like "*${titleOrProcess}*" -or $_.ProcessName -like "*${titleOrProcess}*"} | Select-Object -First 1
      if ($proc) {
        [Win32]::ShowWindow($proc.MainWindowHandle, 3)
        Write-Output "success"
      }
    `;

    const { stdout } = await execAsync(`powershell -Command "${script.replace(/"/g, '\\"')}"`);
    return stdout.includes('success');
  }

  async arrangeWindows(layout: 'side-by-side' | 'cascade' | 'stack'): Promise<boolean> {
    // Use Windows built-in window arrangement
    const commands: Record<string, string> = {
      'side-by-side': '(New-Object -ComObject Shell.Application).TileHorizontally()',
      cascade: '(New-Object -ComObject Shell.Application).CascadeWindows()',
      stack: '(New-Object -ComObject Shell.Application).TileVertically()',
    };

    await execAsync(`powershell -Command "${commands[layout]}"`);
    return true;
  }
}

export const windowManagerTool = new WindowManagerTool();
```

---

## Dependencies

```json
{
  "dependencies": {
    "@nut-tree/nut-js": "^3.1.0",
    "node-pty": "^1.0.0",
    "puppeteer-core": "^21.0.0",
    "screenshot-desktop": "^1.15.0",
    "tesseract.js": "^5.0.0",
    "fs-extra": "^11.2.0",
    "glob": "^10.3.0"
  }
}
```

## Tool Registration

All tools are registered with the LLM so it can invoke them:

```typescript
// src/main/agent/tool-registry.ts

import { terminalTool } from './tools/terminal';
import { fileSystemTool } from './tools/filesystem';
import { appLauncherTool } from './tools/app-launcher';
import { mouseKeyboardTool } from './tools/mouse-keyboard';
import { screenVisionTool } from './tools/screen-vision';
import { browserTool } from './tools/browser';
import { windowManagerTool } from './tools/window-manager';

export const toolDefinitions = [
  {
    name: 'terminal',
    description:
      'Execute commands in PowerShell/terminal. Use for running CLI commands, npm, git, etc.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The command to execute' },
        workingDirectory: { type: 'string', description: 'Working directory (optional)' },
      },
      required: ['command'],
    },
  },
  {
    name: 'files',
    description: 'Read, write, delete, and search files on the system.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['read', 'write', 'delete', 'list', 'search', 'exists', 'open'],
        },
        path: { type: 'string', description: 'File or directory path' },
        content: { type: 'string', description: 'Content to write (for write action)' },
        pattern: { type: 'string', description: 'Search pattern (for search action)' },
      },
      required: ['action', 'path'],
    },
  },
  {
    name: 'app',
    description: 'Launch, close, or focus applications.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['launch', 'close', 'focus', 'isRunning', 'list'] },
        appName: {
          type: 'string',
          description: 'Application name (e.g., "brave", "spotify", "vscode")',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'mouse_keyboard',
    description: 'Control mouse and keyboard for UI automation.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['move', 'click', 'doubleClick', 'rightClick', 'type', 'keyPress'],
        },
        x: { type: 'number', description: 'X coordinate' },
        y: { type: 'number', description: 'Y coordinate' },
        text: { type: 'string', description: 'Text to type' },
        keys: {
          type: 'array',
          items: { type: 'string' },
          description: 'Keys to press (e.g., ["control", "c"])',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'screen',
    description: 'Capture and analyze screenshots, find UI elements.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['capture', 'analyze', 'ocr', 'findElement'] },
        query: { type: 'string', description: 'Question about the screen (for analyze)' },
        targetDescription: { type: 'string', description: 'Element to find (for findElement)' },
      },
      required: ['action'],
    },
  },
  {
    name: 'browser',
    description: 'Control Brave browser - navigate, click, type, extract content.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['launch', 'goto', 'click', 'type', 'extract', 'screenshot', 'close'],
        },
        url: { type: 'string', description: 'URL to navigate to' },
        selector: { type: 'string', description: 'CSS selector for element' },
        text: { type: 'string', description: 'Text to type' },
      },
      required: ['action'],
    },
  },
  {
    name: 'windows',
    description: 'Manage application windows - focus, minimize, maximize, arrange.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'focus', 'minimize', 'maximize', 'arrange'] },
        target: { type: 'string', description: 'Window title or process name' },
        layout: { type: 'string', enum: ['side-by-side', 'cascade', 'stack'] },
      },
      required: ['action'],
    },
  },
];

export async function executeTool(name: string, params: any): Promise<any> {
  switch (name) {
    case 'terminal':
      return await terminalTool.execute(params);
    case 'files':
      return await fileSystemTool.execute(params);
    case 'app':
      return await appLauncherTool.execute(params);
    case 'mouse_keyboard':
      return await mouseKeyboardTool.execute(params);
    case 'screen':
      return await screenVisionTool.execute(params);
    case 'browser':
      return await browserTool.execute(params);
    case 'windows':
      // Map to appropriate method
      const wm = windowManagerTool;
      if (params.action === 'list') return await wm.listWindows();
      if (params.action === 'focus') return await wm.focusWindow(params.target);
      if (params.action === 'minimize') return await wm.minimizeWindow(params.target);
      if (params.action === 'maximize') return await wm.maximizeWindow(params.target);
      if (params.action === 'arrange') return await wm.arrangeWindows(params.layout);
      break;
    default:
      return { success: false, error: `Unknown tool: ${name}` };
  }
}
```

## Test Script

Run this to verify all tools work:

```typescript
// scripts/test-tools.ts

import { terminalTool } from '../src/main/agent/tools/terminal';
import { fileSystemTool } from '../src/main/agent/tools/filesystem';
import { appLauncherTool } from '../src/main/agent/tools/app-launcher';
import { mouseKeyboardTool } from '../src/main/agent/tools/mouse-keyboard';
import { browserTool } from '../src/main/agent/tools/browser';

async function testAllTools() {
  console.log('Testing Atlas Tools...\n');

  // Terminal
  console.log('1. Terminal Tool');
  const termResult = await terminalTool.execute({ command: 'echo Hello from Atlas' });
  console.log(`   ✓ Command executed: ${termResult.stdout.includes('Hello')}`);

  // File System
  console.log('2. File System Tool');
  const testFile = 'C:\\temp\\atlas-test.txt';
  await fileSystemTool.execute({ action: 'write', path: testFile, content: 'Test' });
  const readResult = await fileSystemTool.execute({ action: 'read', path: testFile });
  console.log(`   ✓ File read/write: ${readResult.data === 'Test'}`);
  await fileSystemTool.execute({ action: 'delete', path: testFile });

  // App Launcher
  console.log('3. App Launcher Tool');
  const isNotepadRunning = await appLauncherTool.execute({
    action: 'isRunning',
    appName: 'notepad',
  });
  console.log(`   ✓ App check: ${isNotepadRunning.success}`);

  // Mouse/Keyboard
  console.log('4. Mouse/Keyboard Tool');
  const moveResult = await mouseKeyboardTool.execute({ action: 'move', x: 500, y: 500 });
  console.log(`   ✓ Mouse move: ${moveResult.success}`);

  // Browser
  console.log('5. Browser Tool');
  await browserTool.execute({ action: 'launch' });
  await browserTool.execute({ action: 'goto', url: 'https://example.com' });
  const title = await browserTool.getPageTitle();
  console.log(`   ✓ Browser navigation: ${title.data?.includes('Example')}`);
  await browserTool.execute({ action: 'close' });

  console.log('\n[DONE] All tools tested successfully!');
}

testAllTools().catch(console.error);
```
