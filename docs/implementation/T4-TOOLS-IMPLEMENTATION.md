# T4-TOOLS: Agent Tools + Testing Implementation Guide

## Terminal 4 Overview

This terminal handles all agent tools for desktop automation and comprehensive testing infrastructure.

**Responsibilities:**
- Agent tools (file system, browser, terminal, web search, etc.)
- Tool permission system and sandboxing
- Playwright browser automation
- Desktop automation (Windows UI Automation)
- Testing infrastructure (unit, integration, E2E)
- CI/CD pipeline configuration

---

## Directory Structure

```
src/main/
├── agent/
│   ├── tools/
│   │   ├── index.ts              # Tool registry
│   │   ├── base.ts               # Base tool class
│   │   ├── file-system.ts        # File operations
│   │   ├── browser.ts            # Browser automation
│   │   ├── terminal.ts           # Command execution
│   │   ├── web-search.ts         # Web search tool
│   │   ├── screenshot.ts         # Screen capture
│   │   ├── clipboard.ts          # Clipboard access
│   │   ├── git.ts                # Git operations
│   │   ├── system-info.ts        # System information
│   │   └── notification.ts       # Desktop notifications
│   ├── executor.ts               # Tool execution engine
│   ├── permission-manager.ts     # Permission handling
│   ├── sandbox.ts                # Sandboxed execution
│   └── llm-tools.ts              # LLM tool definitions
├── automation/
│   ├── playwright-manager.ts     # Playwright browser control
│   ├── desktop-automation.ts     # Windows UI Automation
│   ├── input-simulator.ts        # Mouse/keyboard simulation
│   └── ocr.ts                    # Screen text recognition
└── security/
    ├── path-validator.ts         # Path security
    ├── command-validator.ts      # Command whitelist
    └── credentials.ts            # Credential storage

tests/
├── unit/
│   ├── tools/
│   │   ├── file-system.test.ts
│   │   ├── browser.test.ts
│   │   └── terminal.test.ts
│   ├── voice/
│   │   ├── wake-word.test.ts
│   │   ├── vad.test.ts
│   │   └── pipeline.test.ts
│   └── memory/
│       └── manager.test.ts
├── integration/
│   ├── voice-pipeline.test.ts
│   ├── llm-integration.test.ts
│   └── workflow-execution.test.ts
├── e2e/
│   ├── voice-interaction.test.ts
│   ├── panel-navigation.test.ts
│   └── workflow-creation.test.ts
├── fixtures/
│   ├── audio-samples/
│   └── mock-data/
├── helpers/
│   ├── test-utils.ts
│   ├── mock-factories.ts
│   └── electron-test-helper.ts
└── setup.ts
```

---

## Core Components

### 1. Base Tool Class (`src/main/agent/tools/base.ts`)

```typescript
import { EventEmitter } from 'events';
import { logger } from '../../utils/logger';

// ============================================================================
// Types
// ============================================================================

export interface ToolParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  required: boolean;
  default?: unknown;
  enum?: string[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  category: 'file' | 'browser' | 'terminal' | 'search' | 'system' | 'communication';
  parameters: ToolParameter[];
  requiresPermission: boolean;
  riskLevel: 'low' | 'medium' | 'high';
}

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  executionTimeMs: number;
}

export interface ToolContext {
  conversationId: string;
  userId: string;
  workingDirectory: string;
  permissions: Set<string>;
}

// ============================================================================
// Base Tool
// ============================================================================

export abstract class BaseTool extends EventEmitter {
  abstract readonly definition: ToolDefinition;

  protected context: ToolContext | null = null;

  setContext(context: ToolContext): void {
    this.context = context;
  }

  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const startTime = Date.now();

    try {
      // Validate parameters
      this.validateParameters(params);

      // Check permission if required
      if (this.definition.requiresPermission) {
        const permitted = await this.checkPermission(params);
        if (!permitted) {
          throw new Error('Permission denied for this operation');
        }
      }

      // Execute tool
      const result = await this.run(params);

      const executionTime = Date.now() - startTime;
      logger.info(`Tool executed: ${this.definition.name}`, {
        executionTimeMs: executionTime,
        success: true,
      });

      return {
        success: true,
        data: result,
        executionTimeMs: executionTime,
      };

    } catch (error) {
      const executionTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error(`Tool failed: ${this.definition.name}`, {
        error: errorMessage,
        executionTimeMs: executionTime,
      });

      return {
        success: false,
        error: errorMessage,
        executionTimeMs: executionTime,
      };
    }
  }

  protected abstract run(params: Record<string, unknown>): Promise<unknown>;

  protected validateParameters(params: Record<string, unknown>): void {
    for (const param of this.definition.parameters) {
      const value = params[param.name];

      // Check required
      if (param.required && value === undefined) {
        throw new Error(`Missing required parameter: ${param.name}`);
      }

      // Check type if provided
      if (value !== undefined) {
        const actualType = Array.isArray(value) ? 'array' : typeof value;
        if (actualType !== param.type) {
          throw new Error(`Invalid type for ${param.name}: expected ${param.type}, got ${actualType}`);
        }

        // Check enum
        if (param.enum && !param.enum.includes(value as string)) {
          throw new Error(`Invalid value for ${param.name}: must be one of ${param.enum.join(', ')}`);
        }
      }
    }
  }

  protected async checkPermission(params: Record<string, unknown>): Promise<boolean> {
    // Override in subclasses for specific permission checks
    return this.context?.permissions.has(this.definition.name) ?? false;
  }

  toJSON(): ToolDefinition {
    return this.definition;
  }
}
```

---

### 2. File System Tool (`src/main/agent/tools/file-system.ts`)

```typescript
import fs from 'fs/promises';
import path from 'path';
import { BaseTool, ToolDefinition } from './base';
import { PathValidator } from '../../security/path-validator';

export class FileSystemTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'file_system',
    description: 'Read, write, and manage files on the local file system',
    category: 'file',
    parameters: [
      {
        name: 'operation',
        type: 'string',
        description: 'The operation to perform',
        required: true,
        enum: ['read', 'write', 'append', 'delete', 'list', 'exists', 'mkdir', 'info'],
      },
      {
        name: 'path',
        type: 'string',
        description: 'The file or directory path',
        required: true,
      },
      {
        name: 'content',
        type: 'string',
        description: 'Content to write (for write/append operations)',
        required: false,
      },
      {
        name: 'encoding',
        type: 'string',
        description: 'File encoding (default: utf-8)',
        required: false,
        default: 'utf-8',
      },
    ],
    requiresPermission: true,
    riskLevel: 'high',
  };

  private pathValidator: PathValidator;

  constructor() {
    super();
    this.pathValidator = new PathValidator();
  }

  protected async run(params: Record<string, unknown>): Promise<unknown> {
    const operation = params.operation as string;
    const filePath = params.path as string;
    const content = params.content as string | undefined;
    const encoding = (params.encoding as BufferEncoding) || 'utf-8';

    // Validate and resolve path
    const resolvedPath = await this.resolvePath(filePath);

    switch (operation) {
      case 'read':
        return this.readFile(resolvedPath, encoding);

      case 'write':
        if (content === undefined) {
          throw new Error('Content is required for write operation');
        }
        return this.writeFile(resolvedPath, content, encoding);

      case 'append':
        if (content === undefined) {
          throw new Error('Content is required for append operation');
        }
        return this.appendFile(resolvedPath, content, encoding);

      case 'delete':
        return this.deleteFile(resolvedPath);

      case 'list':
        return this.listDirectory(resolvedPath);

      case 'exists':
        return this.fileExists(resolvedPath);

      case 'mkdir':
        return this.createDirectory(resolvedPath);

      case 'info':
        return this.getFileInfo(resolvedPath);

      default:
        throw new Error(`Unknown operation: ${operation}`);
    }
  }

  private async resolvePath(filePath: string): Promise<string> {
    const workingDir = this.context?.workingDirectory || process.cwd();

    // Resolve relative paths
    const resolved = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(workingDir, filePath);

    // Validate path security
    if (!this.pathValidator.isAllowed(resolved)) {
      throw new Error('Access to this path is not allowed');
    }

    return resolved;
  }

  private async readFile(filePath: string, encoding: BufferEncoding): Promise<string> {
    const content = await fs.readFile(filePath, { encoding });
    return content;
  }

  private async writeFile(filePath: string, content: string, encoding: BufferEncoding): Promise<{ success: true; bytesWritten: number }> {
    // Ensure directory exists
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    await fs.writeFile(filePath, content, { encoding });

    return {
      success: true,
      bytesWritten: Buffer.byteLength(content, encoding),
    };
  }

  private async appendFile(filePath: string, content: string, encoding: BufferEncoding): Promise<{ success: true }> {
    await fs.appendFile(filePath, content, { encoding });
    return { success: true };
  }

  private async deleteFile(filePath: string): Promise<{ success: true }> {
    const stat = await fs.stat(filePath);

    if (stat.isDirectory()) {
      await fs.rm(filePath, { recursive: true });
    } else {
      await fs.unlink(filePath);
    }

    return { success: true };
  }

  private async listDirectory(dirPath: string): Promise<{ files: FileInfo[] }> {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    const files = await Promise.all(
      entries.map(async (entry) => {
        const fullPath = path.join(dirPath, entry.name);
        const stat = await fs.stat(fullPath);

        return {
          name: entry.name,
          path: fullPath,
          isDirectory: entry.isDirectory(),
          size: stat.size,
          modified: stat.mtime.toISOString(),
        };
      })
    );

    return { files };
  }

  private async fileExists(filePath: string): Promise<{ exists: boolean }> {
    try {
      await fs.access(filePath);
      return { exists: true };
    } catch {
      return { exists: false };
    }
  }

  private async createDirectory(dirPath: string): Promise<{ success: true }> {
    await fs.mkdir(dirPath, { recursive: true });
    return { success: true };
  }

  private async getFileInfo(filePath: string): Promise<FileInfo> {
    const stat = await fs.stat(filePath);

    return {
      name: path.basename(filePath),
      path: filePath,
      isDirectory: stat.isDirectory(),
      size: stat.size,
      modified: stat.mtime.toISOString(),
      created: stat.birthtime.toISOString(),
      permissions: stat.mode.toString(8),
    };
  }
}

interface FileInfo {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modified: string;
  created?: string;
  permissions?: string;
}
```

---

### 3. Browser Tool (`src/main/agent/tools/browser.ts`)

```typescript
import { BaseTool, ToolDefinition } from './base';
import { PlaywrightManager } from '../../automation/playwright-manager';

export class BrowserTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'browser',
    description: 'Automate web browser actions including navigation, clicking, typing, and screenshots',
    category: 'browser',
    parameters: [
      {
        name: 'action',
        type: 'string',
        description: 'The browser action to perform',
        required: true,
        enum: ['navigate', 'click', 'type', 'screenshot', 'get_text', 'wait', 'scroll', 'close'],
      },
      {
        name: 'url',
        type: 'string',
        description: 'URL to navigate to (for navigate action)',
        required: false,
      },
      {
        name: 'selector',
        type: 'string',
        description: 'CSS selector for element interaction',
        required: false,
      },
      {
        name: 'text',
        type: 'string',
        description: 'Text to type (for type action)',
        required: false,
      },
      {
        name: 'waitMs',
        type: 'number',
        description: 'Time to wait in milliseconds',
        required: false,
      },
    ],
    requiresPermission: true,
    riskLevel: 'medium',
  };

  private playwright: PlaywrightManager;

  constructor() {
    super();
    this.playwright = new PlaywrightManager();
  }

  protected async run(params: Record<string, unknown>): Promise<unknown> {
    const action = params.action as string;

    // Ensure browser is initialized
    await this.playwright.ensureInitialized();

    switch (action) {
      case 'navigate':
        return this.navigate(params.url as string);

      case 'click':
        return this.click(params.selector as string);

      case 'type':
        return this.type(params.selector as string, params.text as string);

      case 'screenshot':
        return this.screenshot();

      case 'get_text':
        return this.getText(params.selector as string);

      case 'wait':
        return this.wait(params.waitMs as number);

      case 'scroll':
        return this.scroll(params.selector as string);

      case 'close':
        return this.close();

      default:
        throw new Error(`Unknown browser action: ${action}`);
    }
  }

  private async navigate(url: string): Promise<{ success: true; title: string }> {
    if (!url) {
      throw new Error('URL is required for navigate action');
    }

    const page = await this.playwright.getPage();
    await page.goto(url, { waitUntil: 'domcontentloaded' });

    return {
      success: true,
      title: await page.title(),
    };
  }

  private async click(selector: string): Promise<{ success: true }> {
    if (!selector) {
      throw new Error('Selector is required for click action');
    }

    const page = await this.playwright.getPage();
    await page.click(selector);

    return { success: true };
  }

  private async type(selector: string, text: string): Promise<{ success: true }> {
    if (!selector || !text) {
      throw new Error('Selector and text are required for type action');
    }

    const page = await this.playwright.getPage();
    await page.fill(selector, text);

    return { success: true };
  }

  private async screenshot(): Promise<{ success: true; path: string }> {
    const page = await this.playwright.getPage();
    const screenshotPath = await this.playwright.takeScreenshot();

    return {
      success: true,
      path: screenshotPath,
    };
  }

  private async getText(selector?: string): Promise<{ text: string }> {
    const page = await this.playwright.getPage();

    if (selector) {
      const element = await page.$(selector);
      if (!element) {
        throw new Error(`Element not found: ${selector}`);
      }
      const text = await element.textContent();
      return { text: text || '' };
    }

    // Get all visible text
    const text = await page.evaluate(() => document.body.innerText);
    return { text };
  }

  private async wait(ms: number): Promise<{ success: true }> {
    const page = await this.playwright.getPage();
    await page.waitForTimeout(ms || 1000);
    return { success: true };
  }

  private async scroll(selector?: string): Promise<{ success: true }> {
    const page = await this.playwright.getPage();

    if (selector) {
      await page.evaluate((sel) => {
        const element = document.querySelector(sel);
        element?.scrollIntoView({ behavior: 'smooth' });
      }, selector);
    } else {
      await page.evaluate(() => {
        window.scrollBy({ top: 500, behavior: 'smooth' });
      });
    }

    return { success: true };
  }

  private async close(): Promise<{ success: true }> {
    await this.playwright.close();
    return { success: true };
  }
}
```

---

### 4. Terminal Tool (`src/main/agent/tools/terminal.ts`)

```typescript
import { spawn, SpawnOptions } from 'child_process';
import { BaseTool, ToolDefinition } from './base';
import { CommandValidator } from '../../security/command-validator';
import { logger } from '../../utils/logger';

export class TerminalTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'terminal',
    description: 'Execute shell commands in a controlled environment',
    category: 'terminal',
    parameters: [
      {
        name: 'command',
        type: 'string',
        description: 'The command to execute',
        required: true,
      },
      {
        name: 'cwd',
        type: 'string',
        description: 'Working directory for command execution',
        required: false,
      },
      {
        name: 'timeout',
        type: 'number',
        description: 'Timeout in milliseconds (default: 30000)',
        required: false,
        default: 30000,
      },
    ],
    requiresPermission: true,
    riskLevel: 'high',
  };

  private commandValidator: CommandValidator;

  constructor() {
    super();
    this.commandValidator = new CommandValidator();
  }

  protected async run(params: Record<string, unknown>): Promise<unknown> {
    const command = params.command as string;
    const cwd = (params.cwd as string) || this.context?.workingDirectory || process.cwd();
    const timeout = (params.timeout as number) || 30000;

    // Validate command
    const validation = this.commandValidator.validate(command);
    if (!validation.allowed) {
      throw new Error(`Command not allowed: ${validation.reason}`);
    }

    return this.executeCommand(command, cwd, timeout);
  }

  private executeCommand(command: string, cwd: string, timeout: number): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      const isWindows = process.platform === 'win32';
      const shell = isWindows ? 'cmd.exe' : '/bin/bash';
      const shellArgs = isWindows ? ['/c', command] : ['-c', command];

      const options: SpawnOptions = {
        cwd,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          // Add safe environment
          TERM: 'dumb',
        },
      };

      const proc = spawn(shell, shellArgs, options);

      let stdout = '';
      let stderr = '';
      let killed = false;

      // Set timeout
      const timeoutId = setTimeout(() => {
        killed = true;
        proc.kill('SIGTERM');
        setTimeout(() => proc.kill('SIGKILL'), 1000);
      }, timeout);

      proc.stdout?.on('data', (data) => {
        stdout += data.toString();
        // Limit output size
        if (stdout.length > 100000) {
          stdout = stdout.slice(-100000);
        }
      });

      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
        if (stderr.length > 100000) {
          stderr = stderr.slice(-100000);
        }
      });

      proc.on('error', (error) => {
        clearTimeout(timeoutId);
        reject(error);
      });

      proc.on('close', (code) => {
        clearTimeout(timeoutId);

        if (killed) {
          resolve({
            exitCode: -1,
            stdout,
            stderr,
            timedOut: true,
          });
        } else {
          resolve({
            exitCode: code ?? 0,
            stdout,
            stderr,
            timedOut: false,
          });
        }
      });
    });
  }
}

interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}
```

---

### 5. Web Search Tool (`src/main/agent/tools/web-search.ts`)

```typescript
import { BaseTool, ToolDefinition } from './base';

export class WebSearchTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'web_search',
    description: 'Search the web for information',
    category: 'search',
    parameters: [
      {
        name: 'query',
        type: 'string',
        description: 'Search query',
        required: true,
      },
      {
        name: 'maxResults',
        type: 'number',
        description: 'Maximum number of results (default: 5)',
        required: false,
        default: 5,
      },
      {
        name: 'searchType',
        type: 'string',
        description: 'Type of search',
        required: false,
        enum: ['web', 'news', 'images'],
        default: 'web',
      },
    ],
    requiresPermission: false,
    riskLevel: 'low',
  };

  private searchApiKey: string | null = null;

  constructor() {
    super();
    this.searchApiKey = process.env.SEARCH_API_KEY || null;
  }

  protected async run(params: Record<string, unknown>): Promise<unknown> {
    const query = params.query as string;
    const maxResults = (params.maxResults as number) || 5;
    const searchType = (params.searchType as string) || 'web';

    // Use DuckDuckGo (no API key required) or fallback
    return this.searchDuckDuckGo(query, maxResults);
  }

  private async searchDuckDuckGo(query: string, maxResults: number): Promise<SearchResults> {
    // DuckDuckGo instant answer API
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Search failed: ${response.status}`);
    }

    const data = await response.json();

    const results: SearchResult[] = [];

    // Abstract (main answer)
    if (data.Abstract) {
      results.push({
        title: data.Heading || query,
        snippet: data.Abstract,
        url: data.AbstractURL,
        source: data.AbstractSource,
      });
    }

    // Related topics
    if (data.RelatedTopics) {
      for (const topic of data.RelatedTopics.slice(0, maxResults - 1)) {
        if (topic.Text && topic.FirstURL) {
          results.push({
            title: topic.Text.split(' - ')[0] || 'Related',
            snippet: topic.Text,
            url: topic.FirstURL,
          });
        }
      }
    }

    return {
      query,
      results: results.slice(0, maxResults),
      totalResults: results.length,
    };
  }
}

interface SearchResult {
  title: string;
  snippet: string;
  url: string;
  source?: string;
}

interface SearchResults {
  query: string;
  results: SearchResult[];
  totalResults: number;
}
```

---

### 6. Git Tool (`src/main/agent/tools/git.ts`)

```typescript
import { BaseTool, ToolDefinition } from './base';
import { spawn } from 'child_process';
import path from 'path';

export class GitTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'git',
    description: 'Perform Git version control operations',
    category: 'file',
    parameters: [
      {
        name: 'operation',
        type: 'string',
        description: 'Git operation to perform',
        required: true,
        enum: ['status', 'log', 'diff', 'add', 'commit', 'push', 'pull', 'branch', 'checkout', 'clone'],
      },
      {
        name: 'args',
        type: 'array',
        description: 'Additional arguments for the git command',
        required: false,
      },
      {
        name: 'message',
        type: 'string',
        description: 'Commit message (for commit operation)',
        required: false,
      },
      {
        name: 'path',
        type: 'string',
        description: 'Repository path or file path',
        required: false,
      },
    ],
    requiresPermission: true,
    riskLevel: 'medium',
  };

  protected async run(params: Record<string, unknown>): Promise<unknown> {
    const operation = params.operation as string;
    const args = (params.args as string[]) || [];
    const message = params.message as string | undefined;
    const repoPath = (params.path as string) || this.context?.workingDirectory || process.cwd();

    switch (operation) {
      case 'status':
        return this.gitCommand(repoPath, ['status', '--porcelain', '-b']);

      case 'log':
        return this.gitCommand(repoPath, [
          'log',
          '--oneline',
          '-n',
          '10',
          '--pretty=format:%h %s (%cr) <%an>',
          ...args,
        ]);

      case 'diff':
        return this.gitCommand(repoPath, ['diff', ...args]);

      case 'add':
        const addPath = args[0] || '.';
        return this.gitCommand(repoPath, ['add', addPath]);

      case 'commit':
        if (!message) {
          throw new Error('Commit message is required');
        }
        return this.gitCommand(repoPath, ['commit', '-m', message]);

      case 'push':
        return this.gitCommand(repoPath, ['push', ...args]);

      case 'pull':
        return this.gitCommand(repoPath, ['pull', ...args]);

      case 'branch':
        return this.gitCommand(repoPath, ['branch', '-a', ...args]);

      case 'checkout':
        if (args.length === 0) {
          throw new Error('Branch name is required for checkout');
        }
        return this.gitCommand(repoPath, ['checkout', ...args]);

      case 'clone':
        if (args.length === 0) {
          throw new Error('Repository URL is required for clone');
        }
        return this.gitCommand(process.cwd(), ['clone', ...args]);

      default:
        throw new Error(`Unknown git operation: ${operation}`);
    }
  }

  private gitCommand(cwd: string, args: string[]): Promise<GitResult> {
    return new Promise((resolve, reject) => {
      const proc = spawn('git', args, {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('error', (error) => {
        reject(new Error(`Git command failed: ${error.message}`));
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve({
            success: true,
            output: stdout.trim(),
          });
        } else {
          resolve({
            success: false,
            output: stdout.trim(),
            error: stderr.trim(),
          });
        }
      });
    });
  }
}

interface GitResult {
  success: boolean;
  output: string;
  error?: string;
}
```

---

### 7. Tool Registry (`src/main/agent/tools/index.ts`)

```typescript
import { BaseTool, ToolDefinition } from './base';
import { FileSystemTool } from './file-system';
import { BrowserTool } from './browser';
import { TerminalTool } from './terminal';
import { WebSearchTool } from './web-search';
import { GitTool } from './git';
import { ScreenshotTool } from './screenshot';
import { ClipboardTool } from './clipboard';
import { NotificationTool } from './notification';
import { SystemInfoTool } from './system-info';
import { logger } from '../../utils/logger';

export class ToolRegistry {
  private tools: Map<string, BaseTool> = new Map();

  constructor() {
    this.registerDefaultTools();
  }

  private registerDefaultTools(): void {
    this.register(new FileSystemTool());
    this.register(new BrowserTool());
    this.register(new TerminalTool());
    this.register(new WebSearchTool());
    this.register(new GitTool());
    this.register(new ScreenshotTool());
    this.register(new ClipboardTool());
    this.register(new NotificationTool());
    this.register(new SystemInfoTool());

    logger.info(`Registered ${this.tools.size} tools`);
  }

  register(tool: BaseTool): void {
    this.tools.set(tool.definition.name, tool);
    logger.debug(`Registered tool: ${tool.definition.name}`);
  }

  get(name: string): BaseTool | undefined {
    return this.tools.get(name);
  }

  getAll(): BaseTool[] {
    return Array.from(this.tools.values());
  }

  getDefinitions(): ToolDefinition[] {
    return this.getAll().map(tool => tool.definition);
  }

  getForLLM(): LLMToolDefinition[] {
    return this.getDefinitions().map(def => ({
      type: 'function' as const,
      function: {
        name: def.name,
        description: def.description,
        parameters: {
          type: 'object',
          properties: def.parameters.reduce((acc, param) => {
            acc[param.name] = {
              type: param.type,
              description: param.description,
              ...(param.enum ? { enum: param.enum } : {}),
            };
            return acc;
          }, {} as Record<string, unknown>),
          required: def.parameters.filter(p => p.required).map(p => p.name),
        },
      },
    }));
  }
}

interface LLMToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required: string[];
    };
  };
}

export const toolRegistry = new ToolRegistry();
```

---

### 8. Playwright Manager (`src/main/automation/playwright-manager.ts`)

```typescript
import { chromium, Browser, BrowserContext, Page } from 'playwright';
import path from 'path';
import { app } from 'electron';
import { logger } from '../utils/logger';

export class PlaywrightManager {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private isInitializing = false;

  async ensureInitialized(): Promise<void> {
    if (this.browser && this.page) return;
    if (this.isInitializing) {
      await this.waitForInitialization();
      return;
    }

    this.isInitializing = true;

    try {
      // Launch browser with stealth settings
      this.browser = await chromium.launch({
        headless: false, // Show browser for debugging
        args: [
          '--disable-blink-features=AutomationControlled',
          '--disable-features=IsolateOrigins,site-per-process',
          '--disable-web-security',
          '--no-sandbox',
        ],
      });

      // Create context with realistic settings
      this.context = await this.browser.newContext({
        viewport: { width: 1920, height: 1080 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        locale: 'en-US',
        timezoneId: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });

      // Apply stealth scripts
      await this.applyStealthScripts();

      this.page = await this.context.newPage();

      logger.info('Playwright browser initialized');

    } catch (error) {
      logger.error('Failed to initialize Playwright', { error });
      throw error;

    } finally {
      this.isInitializing = false;
    }
  }

  private async waitForInitialization(): Promise<void> {
    while (this.isInitializing) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  private async applyStealthScripts(): Promise<void> {
    if (!this.context) return;

    // Hide webdriver property
    await this.context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      });

      // Hide automation indicators
      // @ts-ignore
      delete window.cdc_adoQpoasnfa76pfcZLmcfl_Array;
      // @ts-ignore
      delete window.cdc_adoQpoasnfa76pfcZLmcfl_Promise;
      // @ts-ignore
      delete window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol;

      // Override permissions
      const originalQuery = window.navigator.permissions.query;
      // @ts-ignore
      window.navigator.permissions.query = (parameters: any) =>
        parameters.name === 'notifications'
          ? Promise.resolve({ state: 'denied' } as PermissionStatus)
          : originalQuery(parameters);
    });
  }

  async getPage(): Promise<Page> {
    await this.ensureInitialized();
    if (!this.page) {
      throw new Error('Page not initialized');
    }
    return this.page;
  }

  async takeScreenshot(): Promise<string> {
    const page = await this.getPage();
    const screenshotDir = path.join(app.getPath('userData'), 'screenshots');
    const filename = `screenshot-${Date.now()}.png`;
    const filepath = path.join(screenshotDir, filename);

    await page.screenshot({ path: filepath, fullPage: false });

    return filepath;
  }

  async close(): Promise<void> {
    if (this.page) {
      await this.page.close();
      this.page = null;
    }
    if (this.context) {
      await this.context.close();
      this.context = null;
    }
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }

    logger.info('Playwright browser closed');
  }

  async navigateTo(url: string): Promise<void> {
    const page = await this.getPage();
    await page.goto(url, { waitUntil: 'domcontentloaded' });
  }

  async waitForSelector(selector: string, timeout = 30000): Promise<void> {
    const page = await this.getPage();
    await page.waitForSelector(selector, { timeout });
  }

  async click(selector: string): Promise<void> {
    const page = await this.getPage();
    await page.click(selector);
  }

  async type(selector: string, text: string, delay = 50): Promise<void> {
    const page = await this.getPage();
    await page.type(selector, text, { delay });
  }

  async evaluate<T>(fn: () => T): Promise<T> {
    const page = await this.getPage();
    return page.evaluate(fn);
  }
}
```

---

### 9. Permission Manager (`src/main/agent/permission-manager.ts`)

```typescript
import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { DatabaseService } from '../db/service';

export interface ToolPermission {
  id: string;
  toolName: string;
  action: string;
  pathPattern?: string;
  allowed: boolean;
  createdAt: number;
  expiresAt?: number;
}

export class PermissionManager extends EventEmitter {
  private permissions: Map<string, ToolPermission> = new Map();
  private db: DatabaseService;
  private pendingRequests: Map<string, {
    resolve: (allowed: boolean) => void;
    reject: (error: Error) => void;
  }> = new Map();

  constructor(db: DatabaseService) {
    super();
    this.db = db;
  }

  async initialize(): Promise<void> {
    // Load saved permissions
    const saved = await this.db.getToolPermissions();

    for (const permission of saved) {
      // Skip expired
      if (permission.expiresAt && permission.expiresAt < Date.now()) {
        continue;
      }

      const key = this.makeKey(permission.toolName, permission.action, permission.pathPattern);
      this.permissions.set(key, permission);
    }

    logger.info(`Loaded ${this.permissions.size} tool permissions`);
  }

  private makeKey(toolName: string, action: string, pathPattern?: string): string {
    return `${toolName}:${action}:${pathPattern || '*'}`;
  }

  async checkPermission(
    toolName: string,
    action: string,
    context?: { path?: string }
  ): Promise<boolean> {
    // Check exact match
    const exactKey = this.makeKey(toolName, action, context?.path);
    const exactPermission = this.permissions.get(exactKey);
    if (exactPermission) {
      return exactPermission.allowed;
    }

    // Check wildcard
    const wildcardKey = this.makeKey(toolName, action);
    const wildcardPermission = this.permissions.get(wildcardKey);
    if (wildcardPermission) {
      return wildcardPermission.allowed;
    }

    // No stored permission, need to ask user
    return this.requestPermission(toolName, action, context);
  }

  async requestPermission(
    toolName: string,
    action: string,
    context?: { path?: string }
  ): Promise<boolean> {
    const requestId = crypto.randomUUID();

    // Emit event for UI to show permission dialog
    this.emit('permission:requested', {
      requestId,
      toolName,
      action,
      context,
    });

    // Wait for response
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(requestId, { resolve, reject });

      // Timeout after 60 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId);
          reject(new Error('Permission request timed out'));
        }
      }, 60000);
    });
  }

  async handlePermissionResponse(
    requestId: string,
    allowed: boolean,
    remember: boolean,
    duration?: 'session' | 'forever'
  ): Promise<void> {
    const pending = this.pendingRequests.get(requestId);
    if (!pending) {
      logger.warn('Permission response for unknown request', { requestId });
      return;
    }

    this.pendingRequests.delete(requestId);

    // Save permission if remember is true
    if (remember) {
      // Note: This would need the original request context
      // In a real implementation, store context with pending request
    }

    pending.resolve(allowed);
  }

  async grantPermission(
    toolName: string,
    action: string,
    options: {
      pathPattern?: string;
      duration?: 'session' | 'forever';
    } = {}
  ): Promise<void> {
    const permission: ToolPermission = {
      id: crypto.randomUUID(),
      toolName,
      action,
      pathPattern: options.pathPattern,
      allowed: true,
      createdAt: Date.now(),
      expiresAt: options.duration === 'session' ? undefined : undefined,
    };

    const key = this.makeKey(toolName, action, options.pathPattern);
    this.permissions.set(key, permission);

    await this.db.saveToolPermission(permission);

    logger.info(`Granted permission: ${toolName}:${action}`, {
      pathPattern: options.pathPattern,
    });
  }

  async revokePermission(toolName: string, action: string, pathPattern?: string): Promise<void> {
    const key = this.makeKey(toolName, action, pathPattern);
    this.permissions.delete(key);

    await this.db.deleteToolPermission(toolName, action, pathPattern);

    logger.info(`Revoked permission: ${toolName}:${action}`);
  }

  getPermissions(): ToolPermission[] {
    return Array.from(this.permissions.values());
  }

  clearSessionPermissions(): void {
    // Clear permissions that don't have expiresAt set
    for (const [key, permission] of this.permissions) {
      if (!permission.expiresAt) {
        this.permissions.delete(key);
      }
    }
  }
}
```

---

## Testing Infrastructure

### 10. Test Setup (`tests/setup.ts`)

```typescript
import { vi, beforeAll, afterAll, beforeEach } from 'vitest';

// Mock Electron
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => {
      const paths: Record<string, string> = {
        userData: '/tmp/atlas-test',
        temp: '/tmp',
        home: '/home/test',
      };
      return paths[name] || '/tmp';
    }),
    getName: vi.fn(() => 'atlas-test'),
    getVersion: vi.fn(() => '0.0.1'),
    isPackaged: false,
  },
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
    removeHandler: vi.fn(),
  },
  ipcRenderer: {
    invoke: vi.fn(),
    on: vi.fn(),
    send: vi.fn(),
  },
  BrowserWindow: vi.fn().mockImplementation(() => ({
    loadURL: vi.fn(),
    webContents: {
      send: vi.fn(),
      on: vi.fn(),
    },
    on: vi.fn(),
    show: vi.fn(),
    hide: vi.fn(),
    close: vi.fn(),
  })),
  Notification: vi.fn().mockImplementation(() => ({
    show: vi.fn(),
    on: vi.fn(),
  })),
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((s: string) => Buffer.from(s)),
    decryptString: vi.fn((b: Buffer) => b.toString()),
  },
}));

// Mock native modules
vi.mock('@picovoice/porcupine-node', () => ({
  Porcupine: vi.fn().mockImplementation(() => ({
    process: vi.fn(() => -1),
    frameLength: 512,
    sampleRate: 16000,
    release: vi.fn(),
  })),
}));

vi.mock('@ricky0123/vad-node', () => ({
  Silero: vi.fn().mockImplementation(() => ({
    predict: vi.fn(() => ({ speech: false, speechProbability: 0 })),
  })),
}));

// Global test utilities
beforeAll(async () => {
  // Create temp directories
  const fs = await import('fs/promises');
  await fs.mkdir('/tmp/atlas-test', { recursive: true });
});

afterAll(async () => {
  // Cleanup
  const fs = await import('fs/promises');
  await fs.rm('/tmp/atlas-test', { recursive: true, force: true });
});

beforeEach(() => {
  vi.clearAllMocks();
});

// Custom matchers
expect.extend({
  toBeWithinRange(received: number, floor: number, ceiling: number) {
    const pass = received >= floor && received <= ceiling;
    if (pass) {
      return {
        message: () => `expected ${received} not to be within range ${floor} - ${ceiling}`,
        pass: true,
      };
    } else {
      return {
        message: () => `expected ${received} to be within range ${floor} - ${ceiling}`,
        pass: false,
      };
    }
  },
});
```

### 11. Unit Tests - File System Tool (`tests/unit/tools/file-system.test.ts`)

```typescript
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { FileSystemTool } from '../../../src/main/agent/tools/file-system';
import fs from 'fs/promises';
import path from 'path';

describe('FileSystemTool', () => {
  let tool: FileSystemTool;
  const testDir = '/tmp/atlas-test/fs';

  beforeEach(async () => {
    tool = new FileSystemTool();
    tool.setContext({
      conversationId: 'test-convo',
      userId: 'test-user',
      workingDirectory: testDir,
      permissions: new Set(['file_system']),
    });

    // Create test directory
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('read operation', () => {
    it('should read file contents', async () => {
      const testFile = path.join(testDir, 'test.txt');
      await fs.writeFile(testFile, 'Hello, World!');

      const result = await tool.execute({
        operation: 'read',
        path: testFile,
      });

      expect(result.success).toBe(true);
      expect(result.data).toBe('Hello, World!');
    });

    it('should fail for non-existent file', async () => {
      const result = await tool.execute({
        operation: 'read',
        path: path.join(testDir, 'nonexistent.txt'),
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('ENOENT');
    });
  });

  describe('write operation', () => {
    it('should write file contents', async () => {
      const testFile = path.join(testDir, 'output.txt');

      const result = await tool.execute({
        operation: 'write',
        path: testFile,
        content: 'Test content',
      });

      expect(result.success).toBe(true);

      const content = await fs.readFile(testFile, 'utf-8');
      expect(content).toBe('Test content');
    });

    it('should create parent directories', async () => {
      const testFile = path.join(testDir, 'nested', 'deep', 'file.txt');

      const result = await tool.execute({
        operation: 'write',
        path: testFile,
        content: 'Nested content',
      });

      expect(result.success).toBe(true);

      const content = await fs.readFile(testFile, 'utf-8');
      expect(content).toBe('Nested content');
    });
  });

  describe('list operation', () => {
    it('should list directory contents', async () => {
      await fs.writeFile(path.join(testDir, 'file1.txt'), 'a');
      await fs.writeFile(path.join(testDir, 'file2.txt'), 'b');
      await fs.mkdir(path.join(testDir, 'subdir'));

      const result = await tool.execute({
        operation: 'list',
        path: testDir,
      });

      expect(result.success).toBe(true);
      const data = result.data as { files: { name: string }[] };
      expect(data.files).toHaveLength(3);
      expect(data.files.map(f => f.name)).toContain('file1.txt');
      expect(data.files.map(f => f.name)).toContain('subdir');
    });
  });

  describe('security', () => {
    it('should block access to sensitive paths', async () => {
      // Attempt to access outside allowed paths
      const result = await tool.execute({
        operation: 'read',
        path: '/etc/passwd',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not allowed');
    });
  });
});
```

### 12. Integration Tests (`tests/integration/voice-pipeline.test.ts`)

```typescript
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { VoicePipeline } from '../../src/main/voice/voice-pipeline';

describe('Voice Pipeline Integration', () => {
  let pipeline: VoicePipeline;

  beforeAll(async () => {
    pipeline = new VoicePipeline();
    // Note: In real tests, would need mock audio providers
  });

  afterAll(async () => {
    await pipeline.shutdown();
  });

  describe('state transitions', () => {
    it('should start in idle state', () => {
      expect(pipeline.getState()).toBe('idle');
    });

    it('should transition to listening on activation', async () => {
      const stateChange = vi.fn();
      pipeline.on('state:changed', stateChange);

      pipeline.activate();

      expect(stateChange).toHaveBeenCalledWith('listening');
    });

    it('should return to idle after timeout', async () => {
      pipeline.activate();

      // Simulate silence timeout
      await new Promise(resolve => setTimeout(resolve, 5000));

      expect(pipeline.getState()).toBe('idle');
    }, 10000);
  });

  describe('audio processing', () => {
    it('should detect voice activity', async () => {
      const vadEvent = vi.fn();
      pipeline.on('vad:speech-start', vadEvent);

      pipeline.activate();

      // Feed mock audio with speech
      const speechAudio = createMockSpeechAudio();
      pipeline.processAudio(speechAudio);

      expect(vadEvent).toHaveBeenCalled();
    });

    it('should transcribe speech', async () => {
      const transcriptEvent = vi.fn();
      pipeline.on('stt:transcript', transcriptEvent);

      pipeline.activate();

      // Feed mock audio
      const speechAudio = createMockSpeechAudio();
      pipeline.processAudio(speechAudio);

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 1000));

      expect(transcriptEvent).toHaveBeenCalled();
    });
  });
});

function createMockSpeechAudio(): Int16Array {
  // Generate simple sine wave at 440Hz (speech-like)
  const sampleRate = 16000;
  const duration = 1; // 1 second
  const samples = new Int16Array(sampleRate * duration);

  for (let i = 0; i < samples.length; i++) {
    const t = i / sampleRate;
    samples[i] = Math.sin(2 * Math.PI * 440 * t) * 0x7fff * 0.3;
  }

  return samples;
}
```

### 13. E2E Tests (`tests/e2e/voice-interaction.test.ts`)

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { _electron as electron, ElectronApplication, Page } from 'playwright';
import path from 'path';

describe('Voice Interaction E2E', () => {
  let app: ElectronApplication;
  let page: Page;

  beforeAll(async () => {
    // Launch Electron app
    app = await electron.launch({
      args: [path.join(__dirname, '../../dist/main/index.js')],
      env: {
        ...process.env,
        NODE_ENV: 'test',
      },
    });

    page = await app.firstWindow();

    // Wait for app to be ready
    await page.waitForSelector('.app-container');
  });

  afterAll(async () => {
    await app.close();
  });

  describe('orb interaction', () => {
    it('should display the orb', async () => {
      const canvas = await page.$('canvas');
      expect(canvas).not.toBeNull();
    });

    it('should respond to click activation', async () => {
      const canvas = await page.$('canvas');
      await canvas?.click();

      // Check for listening state indicator
      const stateIndicator = await page.getAttribute('[data-state]', 'data-state');
      expect(stateIndicator).toBe('listening');
    });
  });

  describe('panel navigation', () => {
    it('should open chat panel', async () => {
      await page.click('[data-panel="chat"]');

      const panel = await page.waitForSelector('.panel-container');
      expect(panel).not.toBeNull();
    });

    it('should close panel on escape', async () => {
      await page.click('[data-panel="chat"]');
      await page.waitForSelector('.panel-container');

      await page.keyboard.press('Escape');

      const panel = await page.$('.panel-container');
      expect(panel).toBeNull();
    });
  });

  describe('settings panel', () => {
    it('should persist settings changes', async () => {
      // Open settings
      await page.click('[data-panel="settings"]');
      await page.waitForSelector('.settings-panel');

      // Change wake word sensitivity
      const slider = await page.$('[data-setting="wake-word-sensitivity"] input');
      await slider?.fill('0.8');

      // Close and reopen
      await page.keyboard.press('Escape');
      await page.click('[data-panel="settings"]');

      // Verify value persisted
      const value = await page.$eval(
        '[data-setting="wake-word-sensitivity"] input',
        (el) => (el as HTMLInputElement).value
      );
      expect(value).toBe('0.8');
    });
  });
});
```

---

### 14. Mock Factories (`tests/helpers/mock-factories.ts`)

```typescript
import { vi } from 'vitest';
import { ToolContext, ToolResult } from '../../src/main/agent/tools/base';
import { WorkflowDefinition, WorkflowRun } from '../../src/main/workflow/engine';

export function createMockToolContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    conversationId: 'test-conversation',
    userId: 'test-user',
    workingDirectory: '/tmp/atlas-test',
    permissions: new Set(['file_system', 'browser', 'terminal']),
    ...overrides,
  };
}

export function createMockToolResult(overrides: Partial<ToolResult> = {}): ToolResult {
  return {
    success: true,
    data: {},
    executionTimeMs: 100,
    ...overrides,
  };
}

export function createMockWorkflow(overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  return {
    id: 'test-workflow',
    name: 'Test Workflow',
    description: 'A test workflow',
    version: 1,
    triggers: [{ type: 'manual', config: {} }],
    actions: [{
      id: 'action1',
      type: 'delay',
      name: 'Test Action',
      config: { delayMs: 10 },
    }],
    entryActionId: 'action1',
    variables: {},
    enabled: true,
    maxConcurrentRuns: 1,
    timeoutMs: 30000,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    runCount: 0,
    successCount: 0,
    errorCount: 0,
    ...overrides,
  };
}

export function createMockWorkflowRun(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: 'test-run',
    workflowId: 'test-workflow',
    status: 'running',
    triggeredBy: 'manual',
    completedActions: [],
    actionResults: new Map(),
    variables: {},
    startedAt: Date.now(),
    ...overrides,
  };
}

export function createMockLLMResponse(content: string = 'Test response') {
  return {
    id: 'test-response',
    model: 'test-model',
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content,
      },
      finish_reason: 'stop',
    }],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
    },
  };
}

export function createMockAudioBuffer(durationMs: number = 1000): Int16Array {
  const sampleRate = 16000;
  const samples = Math.floor(sampleRate * durationMs / 1000);
  return new Int16Array(samples);
}

export function mockElectronIPC() {
  return {
    invoke: vi.fn(),
    on: vi.fn(),
    send: vi.fn(),
    removeListener: vi.fn(),
  };
}
```

---

### 15. Vitest Configuration (`vitest.config.ts`)

```typescript
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.d.ts',
        'src/**/types.ts',
        'src/main/preload.ts',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
      },
    },
    testTimeout: 10000,
    hookTimeout: 10000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@main': path.resolve(__dirname, './src/main'),
      '@renderer': path.resolve(__dirname, './src/renderer'),
      '@shared': path.resolve(__dirname, './src/shared'),
    },
  },
});
```

---

## CI/CD Pipeline

### GitHub Actions (`/.github/workflows/ci.yml`)

```yaml
name: CI

on:
  push:
    branches: [main, develop, orchestrator]
  pull_request:
    branches: [main, develop]

jobs:
  lint-and-typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run ESLint
        run: npm run lint

      - name: Run TypeScript check
        run: npm run typecheck

  test-unit:
    runs-on: ubuntu-latest
    needs: lint-and-typecheck
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run unit tests
        run: npm run test -- --coverage

      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./coverage/lcov.info

  test-e2e:
    runs-on: windows-latest
    needs: test-unit
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Install Playwright
        run: npx playwright install --with-deps chromium

      - name: Build app
        run: npm run build:electron

      - name: Run E2E tests
        run: npm run test:e2e

  build:
    runs-on: ${{ matrix.os }}
    needs: [test-unit]
    strategy:
      matrix:
        os: [windows-latest, macos-latest, ubuntu-latest]

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Build
        run: npm run build

      - name: Upload artifacts
        uses: actions/upload-artifact@v4
        with:
          name: dist-${{ matrix.os }}
          path: release/
          retention-days: 7
```

---

## Security Components

### Path Validator (`src/main/security/path-validator.ts`)

```typescript
import path from 'path';
import os from 'os';

export class PathValidator {
  private allowedRoots: string[];
  private blockedPaths: string[];

  constructor() {
    const home = os.homedir();

    // Allowed roots - user can access these
    this.allowedRoots = [
      home,
      path.join(home, 'Documents'),
      path.join(home, 'Desktop'),
      path.join(home, 'Downloads'),
      process.cwd(),
    ];

    // Blocked paths - never allow access
    this.blockedPaths = [
      path.join(home, '.ssh'),
      path.join(home, '.gnupg'),
      path.join(home, '.aws'),
      path.join(home, '.config', 'gcloud'),
      '/etc',
      '/var',
      '/usr',
      'C:\\Windows',
      'C:\\Program Files',
    ];
  }

  isAllowed(targetPath: string): boolean {
    const normalized = path.normalize(targetPath);
    const resolved = path.resolve(normalized);

    // Check blocked paths first
    for (const blocked of this.blockedPaths) {
      if (resolved.startsWith(blocked)) {
        return false;
      }
    }

    // Check if within allowed roots
    for (const root of this.allowedRoots) {
      if (resolved.startsWith(root)) {
        return true;
      }
    }

    return false;
  }

  addAllowedRoot(rootPath: string): void {
    const normalized = path.normalize(rootPath);
    if (!this.allowedRoots.includes(normalized)) {
      this.allowedRoots.push(normalized);
    }
  }

  removeAllowedRoot(rootPath: string): void {
    const normalized = path.normalize(rootPath);
    const index = this.allowedRoots.indexOf(normalized);
    if (index !== -1) {
      this.allowedRoots.splice(index, 1);
    }
  }
}
```

### Command Validator (`src/main/security/command-validator.ts`)

```typescript
export interface ValidationResult {
  allowed: boolean;
  reason?: string;
}

export class CommandValidator {
  // Commands that are always allowed
  private allowlist: Set<string> = new Set([
    'ls', 'dir', 'pwd', 'cd', 'cat', 'head', 'tail', 'less', 'more',
    'grep', 'find', 'which', 'whereis', 'echo', 'date', 'cal',
    'git', 'node', 'npm', 'npx', 'yarn', 'pnpm',
    'python', 'python3', 'pip', 'pip3',
    'code', 'vim', 'nano',
    'curl', 'wget',
    'docker', 'docker-compose',
  ]);

  // Commands that are never allowed
  private blocklist: Set<string> = new Set([
    'rm -rf /',
    'dd',
    'mkfs',
    'fdisk',
    'format',
    ':(){:|:&};:',  // Fork bomb
    'chmod 777',
    'chown',
    'sudo',
    'su',
    'passwd',
    'shutdown',
    'reboot',
    'halt',
    'poweroff',
  ]);

  // Dangerous patterns
  private dangerousPatterns: RegExp[] = [
    /rm\s+-rf\s+[\/\\]/,          // rm -rf / or similar
    />\s*\/dev\/sd[a-z]/,          // Write to disk devices
    /curl.*\|\s*(ba)?sh/,          // Curl pipe to shell
    /wget.*\|\s*(ba)?sh/,          // Wget pipe to shell
    /eval\s+/,                      // Eval command
    /\$\(.*\)/,                     // Command substitution (can be dangerous)
    /`.*`/,                         // Backtick command substitution
    /;\s*rm\s/,                     // Command injection attempt
    /&&\s*rm\s/,                    // Command injection attempt
    /\|\s*rm\s/,                    // Pipe to rm
  ];

  validate(command: string): ValidationResult {
    const trimmed = command.trim().toLowerCase();

    // Check blocklist
    for (const blocked of this.blocklist) {
      if (trimmed.includes(blocked.toLowerCase())) {
        return {
          allowed: false,
          reason: `Command contains blocked pattern: ${blocked}`,
        };
      }
    }

    // Check dangerous patterns
    for (const pattern of this.dangerousPatterns) {
      if (pattern.test(command)) {
        return {
          allowed: false,
          reason: `Command matches dangerous pattern`,
        };
      }
    }

    // Extract base command
    const baseCommand = this.extractBaseCommand(command);

    // Check allowlist
    if (this.allowlist.has(baseCommand)) {
      return { allowed: true };
    }

    // For unknown commands, require explicit permission
    return {
      allowed: false,
      reason: `Command '${baseCommand}' requires explicit permission`,
    };
  }

  private extractBaseCommand(command: string): string {
    // Remove leading environment variables
    let cmd = command.replace(/^\s*\w+=/g, '');

    // Get first word
    const match = cmd.match(/^\s*(\S+)/);
    return match ? match[1].toLowerCase() : '';
  }

  addToAllowlist(command: string): void {
    this.allowlist.add(command.toLowerCase());
  }

  removeFromAllowlist(command: string): void {
    this.allowlist.delete(command.toLowerCase());
  }
}
```

---

## Performance Targets

| Metric | Target |
|--------|--------|
| Tool execution overhead | <50ms |
| File read (small file) | <10ms |
| Browser launch | <3s |
| Browser action | <500ms |
| Command execution | <100ms + command time |
| Permission check | <5ms |
| Test suite (unit) | <30s |
| Test suite (e2e) | <5 minutes |

---

## Dependencies

```json
{
  "dependencies": {
    "playwright": "^1.40.0"
  },
  "devDependencies": {
    "@playwright/test": "^1.40.0",
    "@vitest/coverage-v8": "^1.6.1",
    "vitest": "^1.1.0"
  }
}
```

---

**Last Updated**: 2026-01-15
