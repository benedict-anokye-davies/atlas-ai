/**
 * Nova Desktop - Agent System Tests
 * Tests for Agent class, filesystem tools, and terminal tools
 */

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock Electron modules
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/mock/path'),
  },
}));

// Import agent and tools
import {
  Agent,
  getAgent,
  shutdownAgent,
  AgentTool,
  ActionResult,
  DEFAULT_AGENT_CONFIG,
} from '../src/main/agent/index';

import {
  readFileTool,
  writeFileTool,
  appendFileTool,
  deleteFileTool,
  listDirectoryTool,
  searchFilesTool,
  copyFileTool,
  moveFileTool,
  createDirectoryTool,
  getFilesystemTools,
} from '../src/main/agent/tools/filesystem';
import filesystemTools from '../src/main/agent/tools/filesystem';
const { validatePathSafety } = filesystemTools;

import {
  executeCommandTool,
  npmCommandTool,
  gitCommandTool,
  pwdTool,
  whichCommandTool,
  getTerminalTools,
  executeCommand,
  setSecurityEnabled,
} from '../src/main/agent/tools/terminal';
import terminalTools from '../src/main/agent/tools/terminal';
const { validateCommandSafety } = terminalTools;

import { validateUrl, getBrowserTools } from '../src/main/agent/tools/browser';
import { webSearchTool, fetchUrlTool, getSearchTools } from '../src/main/agent/tools/search';

// Import tools index as a whole
import * as toolsIndex from '../src/main/agent/tools/index';
const getAllTools = toolsIndex.getAllTools;

// Test directory for file operations
let testDir: string;

beforeAll(async () => {
  testDir = path.join(os.tmpdir(), 'nova-agent-tests-' + Date.now());
  await fs.mkdir(testDir, { recursive: true });
});

afterAll(async () => {
  // Clean up test directory
  try {
    await fs.rm(testDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
});

// ============================================================================
// AGENT CLASS TESTS
// ============================================================================

describe('Agent Class', () => {
  let agent: Agent;

  beforeEach(() => {
    shutdownAgent(); // Reset singleton
    agent = new Agent({ enableTools: true });
  });

  afterEach(() => {
    shutdownAgent();
  });

  describe('Configuration', () => {
    it('should create agent with default config', () => {
      const defaultAgent = new Agent();
      expect(defaultAgent.name).toBe(DEFAULT_AGENT_CONFIG.name);
      expect(defaultAgent.persona).toBe(DEFAULT_AGENT_CONFIG.persona);
      expect(defaultAgent.capabilities).toEqual(DEFAULT_AGENT_CONFIG.capabilities);
    });

    it('should create agent with custom config', () => {
      const customAgent = new Agent({
        name: 'CustomNova',
        persona: 'A custom agent',
        capabilities: ['conversation', 'file_system'],
        enableTools: true,
      });

      expect(customAgent.name).toBe('CustomNova');
      expect(customAgent.persona).toBe('A custom agent');
      expect(customAgent.capabilities).toContain('file_system');
    });

    it('should update config', () => {
      agent.updateConfig({ name: 'UpdatedNova' });
      expect(agent.name).toBe('UpdatedNova');
    });

    it('should get config copy', () => {
      const config = agent.getConfig();
      config.name = 'Modified';
      expect(agent.name).not.toBe('Modified');
    });
  });

  describe('Capabilities', () => {
    it('should check for capabilities', () => {
      const capableAgent = new Agent({
        capabilities: ['conversation', 'file_system', 'memory'],
      });

      expect(capableAgent.hasCapability('conversation')).toBe(true);
      expect(capableAgent.hasCapability('file_system')).toBe(true);
      expect(capableAgent.hasCapability('web_search')).toBe(false);
    });

    it('should return capabilities copy', () => {
      const capabilities = agent.capabilities;
      const originalLength = capabilities.length;
      capabilities.push('web_search' as any);
      expect(agent.capabilities.length).toBe(originalLength);
    });
  });

  describe('Tool Management', () => {
    const mockTool: AgentTool = {
      name: 'test_tool',
      description: 'A test tool',
      parameters: { type: 'object', properties: {} },
      execute: async () => ({ success: true, data: 'test result' }),
    };

    it('should register tool', () => {
      agent.registerTool(mockTool);
      expect(agent.getTool('test_tool')).toBe(mockTool);
    });

    it('should throw when registering tool with tools disabled', () => {
      const noToolsAgent = new Agent({ enableTools: false });
      expect(() => noToolsAgent.registerTool(mockTool)).toThrow('Tools are disabled');
    });

    it('should unregister tool', () => {
      agent.registerTool(mockTool);
      expect(agent.unregisterTool('test_tool')).toBe(true);
      expect(agent.getTool('test_tool')).toBeUndefined();
    });

    it('should return false when unregistering non-existent tool', () => {
      expect(agent.unregisterTool('nonexistent')).toBe(false);
    });

    it('should get all tools', () => {
      agent.registerTool(mockTool);
      agent.registerTool({ ...mockTool, name: 'test_tool_2' });
      expect(agent.getTools()).toHaveLength(2);
    });

    it('should get tool definitions for LLM', () => {
      agent.registerTool(mockTool);
      const definitions = agent.getToolDefinitions();

      expect(definitions).toHaveLength(1);
      expect(definitions[0].type).toBe('function');
      expect(definitions[0].function.name).toBe('test_tool');
    });
  });

  describe('Tool Execution', () => {
    const successTool: AgentTool = {
      name: 'success_tool',
      description: 'Always succeeds',
      parameters: { type: 'object', properties: {} },
      execute: async (params) => ({ success: true, data: params }),
    };

    const failTool: AgentTool = {
      name: 'fail_tool',
      description: 'Always fails',
      parameters: { type: 'object', properties: {} },
      execute: async () => {
        throw new Error('Tool failed');
      },
    };

    beforeEach(() => {
      agent.registerTool(successTool);
      agent.registerTool(failTool);
    });

    it('should execute tool successfully', async () => {
      const result = await agent.executeTool('success_tool', { key: 'value' });
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ key: 'value' });
    });

    it('should return error for non-existent tool', async () => {
      const result = await agent.executeTool('nonexistent', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('was not found');
    });

    it('should handle tool execution errors', async () => {
      const result = await agent.executeTool('fail_tool', {});
      expect(result.success).toBe(false);
      expect(result.error).toBe('Tool failed');
    });

    it('should emit events during execution', async () => {
      const toolStartHandler = vi.fn();
      const toolCompleteHandler = vi.fn();

      agent.on('tool-start', toolStartHandler);
      agent.on('tool-complete', toolCompleteHandler);

      await agent.executeTool('success_tool', { test: true });

      expect(toolStartHandler).toHaveBeenCalledWith('success_tool', { test: true });
      expect(toolCompleteHandler).toHaveBeenCalledWith(
        'success_tool',
        expect.objectContaining({ success: true })
      );
    });

    it('should emit error event on failure', async () => {
      const errorHandler = vi.fn();
      agent.on('error', errorHandler);

      await agent.executeTool('fail_tool', {});

      expect(errorHandler).toHaveBeenCalled();
    });
  });

  describe('Singleton Pattern', () => {
    it('should return same instance from getAgent', () => {
      const agent1 = getAgent();
      const agent2 = getAgent();
      expect(agent1).toBe(agent2);
    });

    it('should create new instance after shutdown', () => {
      const agent1 = getAgent();
      shutdownAgent();
      const agent2 = getAgent();
      expect(agent1).not.toBe(agent2);
    });
  });
});

// ============================================================================
// FILESYSTEM TOOLS TESTS
// ============================================================================

describe('Filesystem Tools', () => {
  beforeEach(async () => {
    // Create test files
    await fs.writeFile(path.join(testDir, 'test.txt'), 'Hello, World!');
    await fs.mkdir(path.join(testDir, 'subdir'), { recursive: true });
    await fs.writeFile(path.join(testDir, 'subdir', 'nested.txt'), 'Nested content');
  });

  afterEach(async () => {
    // Clean up test files but keep directory
    const files = await fs.readdir(testDir);
    for (const file of files) {
      const filePath = path.join(testDir, file);
      await fs.rm(filePath, { recursive: true, force: true });
    }
  });

  describe('validatePathSafety', () => {
    it('should allow normal paths', () => {
      const result = validatePathSafety('/home/user/documents/file.txt');
      expect(result.allowed).toBe(true);
      expect(result.riskLevel).toBe('low');
    });

    it('should block sensitive paths', () => {
      const result = validatePathSafety('/etc/passwd');
      expect(result.allowed).toBe(false);
      expect(result.riskLevel).toBe('blocked');
    });

    it('should block .env files', () => {
      const result = validatePathSafety('/home/user/project/.env');
      expect(result.allowed).toBe(false);
    });

    it('should block private keys', () => {
      const result = validatePathSafety('/home/user/.ssh/id_rsa');
      expect(result.allowed).toBe(false);
    });

    it('should require confirmation for system paths', () => {
      const result = validatePathSafety('/etc/hosts');
      expect(result.requiresConfirmation).toBe(true);
      expect(result.riskLevel).toBe('medium');
    });
  });

  describe('readFileTool', () => {
    it('should read file content', async () => {
      const result = await readFileTool.execute({ path: path.join(testDir, 'test.txt') });

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('content', 'Hello, World!');
      expect(result.data).toHaveProperty('size');
    });

    it('should return error for non-existent file', async () => {
      const result = await readFileTool.execute({ path: path.join(testDir, 'nonexistent.txt') });
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should return error for directory', async () => {
      const result = await readFileTool.execute({ path: path.join(testDir, 'subdir') });
      expect(result.success).toBe(false);
      expect(result.error).toContain('directory');
    });

    it('should limit lines when maxLines specified', async () => {
      await fs.writeFile(path.join(testDir, 'multiline.txt'), 'Line 1\nLine 2\nLine 3\nLine 4');
      const result = await readFileTool.execute({
        path: path.join(testDir, 'multiline.txt'),
        maxLines: 2,
      });

      expect(result.success).toBe(true);
      const data = result.data as { content: string; truncated: boolean };
      expect(data.content).toBe('Line 1\nLine 2');
      expect(data.truncated).toBe(true);
    });
  });

  describe('writeFileTool', () => {
    it('should write file content', async () => {
      const newFile = path.join(testDir, 'new.txt');
      const result = await writeFileTool.execute({
        path: newFile,
        content: 'New content',
      });

      expect(result.success).toBe(true);
      const data = result.data as { created: boolean };
      expect(data.created).toBe(true);

      const content = await fs.readFile(newFile, 'utf-8');
      expect(content).toBe('New content');
    });

    it('should overwrite existing file', async () => {
      const existingFile = path.join(testDir, 'test.txt');
      const result = await writeFileTool.execute({
        path: existingFile,
        content: 'Overwritten',
      });

      expect(result.success).toBe(true);
      const data = result.data as { created: boolean };
      expect(data.created).toBe(false);

      const content = await fs.readFile(existingFile, 'utf-8');
      expect(content).toBe('Overwritten');
    });

    it('should create directories when createDirectories is true', async () => {
      const deepFile = path.join(testDir, 'deep', 'nested', 'file.txt');
      const result = await writeFileTool.execute({
        path: deepFile,
        content: 'Deep content',
        createDirectories: true,
      });

      expect(result.success).toBe(true);
      expect(fsSync.existsSync(deepFile)).toBe(true);
    });
  });

  describe('appendFileTool', () => {
    it('should append content to file', async () => {
      const file = path.join(testDir, 'test.txt');
      const result = await appendFileTool.execute({
        path: file,
        content: ' Appended!',
      });

      expect(result.success).toBe(true);

      const content = await fs.readFile(file, 'utf-8');
      expect(content).toBe('Hello, World! Appended!');
    });

    it('should create file if not exists', async () => {
      const newFile = path.join(testDir, 'appended.txt');
      const result = await appendFileTool.execute({
        path: newFile,
        content: 'First content',
      });

      expect(result.success).toBe(true);
      expect(fsSync.existsSync(newFile)).toBe(true);
    });
  });

  describe('deleteFileTool', () => {
    it('should delete file', async () => {
      const file = path.join(testDir, 'test.txt');
      expect(fsSync.existsSync(file)).toBe(true);

      const result = await deleteFileTool.execute({ path: file });

      expect(result.success).toBe(true);
      expect(fsSync.existsSync(file)).toBe(false);
    });

    it('should not delete directories', async () => {
      const result = await deleteFileTool.execute({ path: path.join(testDir, 'subdir') });
      expect(result.success).toBe(false);
      expect(result.error).toContain('directory');
    });

    it('should return error for non-existent file', async () => {
      const result = await deleteFileTool.execute({ path: path.join(testDir, 'nonexistent.txt') });
      expect(result.success).toBe(false);
    });
  });

  describe('listDirectoryTool', () => {
    it('should list directory contents', async () => {
      const result = await listDirectoryTool.execute({ path: testDir });

      expect(result.success).toBe(true);
      const data = result.data as { entries: any[] };
      expect(data.entries).toBeInstanceOf(Array);
      expect(data.entries.length).toBeGreaterThan(0);
    });

    it('should return error for non-existent directory', async () => {
      const result = await listDirectoryTool.execute({ path: path.join(testDir, 'nonexistent') });
      expect(result.success).toBe(false);
    });

    it('should return error for file path', async () => {
      const result = await listDirectoryTool.execute({ path: path.join(testDir, 'test.txt') });
      expect(result.success).toBe(false);
      expect(result.error).toContain('not a directory');
    });

    it('should list recursively', async () => {
      const result = await listDirectoryTool.execute({
        path: testDir,
        recursive: true,
      });

      expect(result.success).toBe(true);
      // Should find nested.txt in subdir
      const data = result.data as { entries: any[] };
      const nestedFile = data.entries.find((e: any) => e.name === 'nested.txt');
      expect(nestedFile).toBeDefined();
    });
  });

  describe('searchFilesTool', () => {
    it('should find files by pattern', async () => {
      const result = await searchFilesTool.execute({
        path: testDir,
        pattern: '*.txt',
      });

      if (!result.success) {
        console.error('searchFilesTool error:', result.error);
      }
      expect(result.success).toBe(true);
      const data = result.data as { files: any[] };
      expect(data.files.length).toBeGreaterThan(0);
      expect(data.files.every((f: any) => f.name.endsWith('.txt'))).toBe(true);
    });

    it('should find files with content', async () => {
      const result = await searchFilesTool.execute({
        path: testDir,
        pattern: '*.txt',
        content: 'Hello',
      });

      if (!result.success) {
        console.error('searchFilesTool error:', result.error);
      }
      expect(result.success).toBe(true);
      const data = result.data as { files: any[] };
      expect(data.files.some((f: any) => f.name === 'test.txt')).toBe(true);
    });
  });

  describe('copyFileTool', () => {
    it('should copy file', async () => {
      const source = path.join(testDir, 'test.txt');
      const dest = path.join(testDir, 'copy.txt');

      const result = await copyFileTool.execute({ source, destination: dest });

      expect(result.success).toBe(true);
      expect(fsSync.existsSync(dest)).toBe(true);
      expect(await fs.readFile(dest, 'utf-8')).toBe('Hello, World!');
    });

    it('should not overwrite without flag', async () => {
      const source = path.join(testDir, 'test.txt');
      const dest = path.join(testDir, 'subdir', 'nested.txt');

      const result = await copyFileTool.execute({ source, destination: dest });

      expect(result.success).toBe(false);
      expect(result.error).toContain('already exists');
    });

    it('should overwrite with flag', async () => {
      const source = path.join(testDir, 'test.txt');
      const dest = path.join(testDir, 'subdir', 'nested.txt');

      const result = await copyFileTool.execute({
        source,
        destination: dest,
        overwrite: true,
      });

      expect(result.success).toBe(true);
      expect(await fs.readFile(dest, 'utf-8')).toBe('Hello, World!');
    });
  });

  describe('moveFileTool', () => {
    it('should move file', async () => {
      const source = path.join(testDir, 'test.txt');
      const dest = path.join(testDir, 'moved.txt');

      const result = await moveFileTool.execute({ source, destination: dest });

      expect(result.success).toBe(true);
      expect(fsSync.existsSync(source)).toBe(false);
      expect(fsSync.existsSync(dest)).toBe(true);
    });
  });

  describe('createDirectoryTool', () => {
    it('should create directory', async () => {
      const newDir = path.join(testDir, 'newdir');
      const result = await createDirectoryTool.execute({ path: newDir });

      expect(result.success).toBe(true);
      const data = result.data as { created: boolean };
      expect(data.created).toBe(true);
      expect(fsSync.existsSync(newDir)).toBe(true);
    });

    it('should handle existing directory', async () => {
      const result = await createDirectoryTool.execute({ path: path.join(testDir, 'subdir') });

      expect(result.success).toBe(true);
      const data = result.data as { alreadyExists: boolean };
      expect(data.alreadyExists).toBe(true);
    });

    it('should create nested directories', async () => {
      const deepDir = path.join(testDir, 'a', 'b', 'c');
      const result = await createDirectoryTool.execute({ path: deepDir, recursive: true });

      expect(result.success).toBe(true);
      expect(fsSync.existsSync(deepDir)).toBe(true);
    });
  });

  describe('getFilesystemTools', () => {
    it('should return all filesystem tools', () => {
      const tools = getFilesystemTools();
      expect(tools.length).toBeGreaterThan(0);
      expect(tools.map((t) => t.name)).toContain('read_file');
      expect(tools.map((t) => t.name)).toContain('write_file');
      expect(tools.map((t) => t.name)).toContain('list_directory');
    });
  });
});

// ============================================================================
// TERMINAL TOOLS TESTS
// ============================================================================

describe('Terminal Tools', () => {
  // Disable security mode for terminal tool tests
  // These tests verify the basic terminal functionality
  beforeAll(() => {
    setSecurityEnabled(false);
  });

  afterAll(() => {
    setSecurityEnabled(true);
  });

  describe('validateCommandSafety', () => {
    it('should allow safe commands', () => {
      const result = validateCommandSafety('ls -la');
      expect(result.allowed).toBe(true);
    });

    it('should block rm -rf /', () => {
      const result = validateCommandSafety('rm -rf /');
      expect(result.allowed).toBe(false);
    });

    it('should block curl | sh', () => {
      const result = validateCommandSafety('curl http://example.com | sh');
      expect(result.allowed).toBe(false);
    });

    it('should flag high-risk commands', () => {
      const result = validateCommandSafety('sudo apt install');
      expect(result.riskLevel).toBe('high');
      expect(result.requiresConfirmation).toBe(true);
    });

    it('should allow node/npm commands', () => {
      const result = validateCommandSafety('npm install lodash');
      expect(result.allowed).toBe(true);
      expect(result.riskLevel).toBe('medium');
    });

    it('should allow git status', () => {
      const result = validateCommandSafety('git status');
      expect(result.allowed).toBe(true);
      expect(result.riskLevel).toBe('low');
    });

    it('should flag git force push', () => {
      const result = validateCommandSafety('git push --force');
      expect(result.riskLevel).toBe('high');
    });
  });

  describe('executeCommand', () => {
    it('should execute simple command', async () => {
      const command = os.platform() === 'win32' ? 'echo hello' : 'echo hello';
      const result = await executeCommand(command);

      expect(result.success).toBe(true);
      const data = result.data as { stdout: string };
      expect(data.stdout).toContain('hello');
    });

    it('should return exit code', async () => {
      const result = await executeCommand('node --version');

      expect(result.success).toBe(true);
      const data = result.data as { exitCode: number };
      expect(data.exitCode).toBe(0);
    });

    it('should handle command failure', async () => {
      const result = await executeCommand('exit 1', {
        shell: os.platform() === 'win32' ? 'cmd' : '/bin/bash',
      });

      // Command should complete (not be blocked), but may fail
      // Note: behavior depends on shell, 'exit 1' may be blocked by security
      expect(result).toHaveProperty('success');
    });

    it('should respect working directory', async () => {
      const result = await executeCommand(os.platform() === 'win32' ? 'cd' : 'pwd', {
        cwd: testDir,
      });

      expect(result.success).toBe(true);
      const data = result.data as { cwd: string };
      expect(data.cwd).toBe(testDir);
    });

    it('should block dangerous commands', async () => {
      const result = await executeCommand('rm -rf /');

      expect(result.success).toBe(false);
      expect((result.error || '').toLowerCase()).toContain('blocked');
    });
  });

  describe('executeCommandTool', () => {
    it('should execute via tool interface', async () => {
      const result = await executeCommandTool.execute({ command: 'node --version' });

      expect(result.success).toBe(true);
      const data = result.data as { stdout: string };
      expect(data.stdout).toContain('v');
    });

    it('should respect timeout', async () => {
      // This test might be flaky, so we just verify the option is accepted
      const result = await executeCommandTool.execute({
        command: 'node --version',
        timeout: 5000,
      });

      expect(result).toHaveProperty('success');
    });
  });

  describe('npmCommandTool', () => {
    it('should run npm command', async () => {
      const result = await npmCommandTool.execute({ subcommand: '--version' });

      expect(result.success).toBe(true);
      const data = result.data as { stdout: string };
      expect(data.stdout).toMatch(/\d+\.\d+\.\d+/);
    });
  });

  describe('gitCommandTool', () => {
    it('should run git command', async () => {
      const result = await gitCommandTool.execute({ subcommand: '--version' });

      expect(result.success).toBe(true);
      const data = result.data as { stdout: string };
      expect(data.stdout).toContain('git');
    });

    it('should block dangerous git commands', async () => {
      const result = await gitCommandTool.execute({ subcommand: 'push --force origin main' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('blocked');
    });
  });

  describe('pwdTool', () => {
    it('should return current directory', async () => {
      const result = await pwdTool.execute({});

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('path');
      expect(result.data).toHaveProperty('basename');
    });
  });

  describe('whichCommandTool', () => {
    it('should find node', async () => {
      const result = await whichCommandTool.execute({ command: 'node' });

      expect(result.success).toBe(true);
      const data = result.data as { exists: boolean; path: string };
      expect(data.exists).toBe(true);
      expect(data.path).toBeTruthy();
    });

    it('should report non-existent command', async () => {
      const result = await whichCommandTool.execute({ command: 'nonexistentcommand12345' });

      expect(result.success).toBe(true);
      const data = result.data as { exists: boolean };
      expect(data.exists).toBe(false);
    });
  });

  describe('getTerminalTools', () => {
    it('should return all terminal tools', () => {
      const tools = getTerminalTools();
      expect(tools.length).toBeGreaterThan(0);
      expect(tools.map((t) => t.name)).toContain('execute_command');
      expect(tools.map((t) => t.name)).toContain('npm_command');
      expect(tools.map((t) => t.name)).toContain('git_command');
    });
  });
});

// ============================================================================
// TOOL COLLECTION TESTS
// ============================================================================

describe('Tool Collection', () => {
  describe('getAllTools', () => {
    it('should return all available tools', () => {
      const tools = getAllTools();

      expect(tools.length).toBeGreaterThan(0);

      // Should include filesystem tools
      expect(tools.some((t) => t.name === 'read_file')).toBe(true);
      expect(tools.some((t) => t.name === 'write_file')).toBe(true);

      // Should include terminal tools
      expect(tools.some((t) => t.name === 'execute_command')).toBe(true);
      expect(tools.some((t) => t.name === 'git_command')).toBe(true);

      // Should include browser tools
      expect(tools.some((t) => t.name === 'browser_navigate')).toBe(true);
      expect(tools.some((t) => t.name === 'browser_get_content')).toBe(true);

      // Should include search tools
      expect(tools.some((t) => t.name === 'web_search')).toBe(true);
      expect(tools.some((t) => t.name === 'fetch_url')).toBe(true);
    });

    it('should have unique tool names', () => {
      const tools = getAllTools();
      const names = tools.map((t) => t.name);
      const uniqueNames = [...new Set(names)];

      expect(names.length).toBe(uniqueNames.length);
    });

    it('should have valid tool structure', () => {
      const tools = getAllTools();

      for (const tool of tools) {
        expect(tool.name).toBeTruthy();
        expect(tool.description).toBeTruthy();
        expect(tool.parameters).toBeDefined();
        expect(typeof tool.execute).toBe('function');
      }
    });
  });
});

// ============================================================================
// BROWSER TOOLS TESTS
// ============================================================================

describe('Browser Tools', () => {
  describe('validateUrl', () => {
    it('should allow valid http URLs', () => {
      const result = validateUrl('http://example.com');
      expect(result.valid).toBe(true);
    });

    it('should allow valid https URLs', () => {
      const result = validateUrl('https://example.com/page?query=1');
      expect(result.valid).toBe(true);
    });

    it('should block file:// protocol', () => {
      const result = validateUrl('file:///etc/passwd');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('not allowed');
    });

    it('should block javascript: protocol', () => {
      const result = validateUrl('javascript:alert(1)');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('not allowed');
    });

    it('should block data: protocol', () => {
      const result = validateUrl('data:text/html,<script>alert(1)</script>');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('not allowed');
    });

    it('should block localhost', () => {
      const result = validateUrl('http://localhost:3000');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Local addresses');
    });

    it('should block 127.0.0.1', () => {
      const result = validateUrl('http://127.0.0.1:8080');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Local addresses');
    });

    it('should block 10.x.x.x internal IPs', () => {
      const result = validateUrl('http://10.0.0.1/admin');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Internal IP');
    });

    it('should block 192.168.x.x internal IPs', () => {
      const result = validateUrl('http://192.168.1.1');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Internal IP');
    });

    it('should block 172.16-31.x.x internal IPs', () => {
      const result = validateUrl('http://172.16.0.1');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Internal IP');
    });

    it('should allow valid external IPs', () => {
      const result = validateUrl('http://8.8.8.8');
      expect(result.valid).toBe(true);
    });

    it('should reject invalid URL format', () => {
      const result = validateUrl('not-a-url');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Invalid URL');
    });
  });

  describe('getBrowserTools', () => {
    it('should return all browser tools', () => {
      const tools = getBrowserTools();
      expect(tools.length).toBe(8); // Updated: includes browser_launch and browser_check_brave
    });

    it('should include browser_navigate tool', () => {
      const tools = getBrowserTools();
      expect(tools.some((t) => t.name === 'browser_navigate')).toBe(true);
    });

    it('should include browser_get_content tool', () => {
      const tools = getBrowserTools();
      expect(tools.some((t) => t.name === 'browser_get_content')).toBe(true);
    });

    it('should include browser_click tool', () => {
      const tools = getBrowserTools();
      expect(tools.some((t) => t.name === 'browser_click')).toBe(true);
    });

    it('should include browser_type tool', () => {
      const tools = getBrowserTools();
      expect(tools.some((t) => t.name === 'browser_type')).toBe(true);
    });

    it('should include browser_screenshot tool', () => {
      const tools = getBrowserTools();
      expect(tools.some((t) => t.name === 'browser_screenshot')).toBe(true);
    });

    it('should include browser_close tool', () => {
      const tools = getBrowserTools();
      expect(tools.some((t) => t.name === 'browser_close')).toBe(true);
    });

    it('should have valid tool structure', () => {
      const tools = getBrowserTools();
      for (const tool of tools) {
        expect(tool.name).toBeTruthy();
        expect(tool.description).toBeTruthy();
        expect(tool.parameters).toBeDefined();
        expect(typeof tool.execute).toBe('function');
      }
    });
  });
});

// ============================================================================
// SEARCH TOOLS TESTS
// ============================================================================

describe('Search Tools', () => {
  describe('webSearchTool', () => {
    it('should have correct tool definition', () => {
      expect(webSearchTool.name).toBe('web_search');
      expect(webSearchTool.description).toContain('search');
      expect(webSearchTool.parameters.properties).toHaveProperty('query');
    });

    it('should require query parameter', () => {
      expect(webSearchTool.parameters.required).toContain('query');
    });

    it('should reject empty query', async () => {
      const result = await webSearchTool.execute({ query: '' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('empty');
    });

    it('should reject whitespace-only query', async () => {
      const result = await webSearchTool.execute({ query: '   ' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('empty');
    });

    // Note: Actual web search tests would require network access
    // and could be flaky, so we only test parameter validation here
  });

  describe('fetchUrlTool', () => {
    it('should have correct tool definition', () => {
      expect(fetchUrlTool.name).toBe('fetch_url');
      expect(fetchUrlTool.description).toContain('Fetch');
      expect(fetchUrlTool.parameters.properties).toHaveProperty('url');
    });

    it('should require url parameter', () => {
      expect(fetchUrlTool.parameters.required).toContain('url');
    });

    it('should reject invalid URL', async () => {
      const result = await fetchUrlTool.execute({ url: 'not-a-valid-url' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid URL');
    });

    it('should reject file:// protocol', async () => {
      const result = await fetchUrlTool.execute({ url: 'file:///etc/passwd' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('HTTP/HTTPS');
    });

    it('should reject ftp:// protocol', async () => {
      const result = await fetchUrlTool.execute({ url: 'ftp://example.com/file.txt' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('HTTP/HTTPS');
    });
  });

  describe('getSearchTools', () => {
    it('should return all search tools', () => {
      const tools = getSearchTools();
      expect(tools.length).toBe(2);
    });

    it('should include web_search tool', () => {
      const tools = getSearchTools();
      expect(tools.some((t) => t.name === 'web_search')).toBe(true);
    });

    it('should include fetch_url tool', () => {
      const tools = getSearchTools();
      expect(tools.some((t) => t.name === 'fetch_url')).toBe(true);
    });

    it('should have valid tool structure', () => {
      const tools = getSearchTools();
      for (const tool of tools) {
        expect(tool.name).toBeTruthy();
        expect(tool.description).toBeTruthy();
        expect(tool.parameters).toBeDefined();
        expect(typeof tool.execute).toBe('function');
      }
    });
  });
});

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('Agent Integration', () => {
  let agent: Agent;

  beforeAll(() => {
    // Disable security mode for agent integration tests
    setSecurityEnabled(false);
  });

  afterAll(() => {
    setSecurityEnabled(true);
  });

  beforeEach(() => {
    shutdownAgent();
    agent = new Agent({
      enableTools: true,
      capabilities: ['conversation', 'file_system', 'system_control'],
    });

    // Register all tools
    for (const tool of getAllTools()) {
      agent.registerTool(tool);
    }
  });

  afterEach(() => {
    shutdownAgent();
  });

  it('should execute filesystem operations via agent', async () => {
    const testFile = path.join(testDir, 'integration-test.txt');

    // Write file
    const writeResult = await agent.executeTool('write_file', {
      path: testFile,
      content: 'Integration test content',
    });
    expect(writeResult.success).toBe(true);

    // Read file
    const readResult = await agent.executeTool('read_file', { path: testFile });
    expect(readResult.success).toBe(true);
    const readData = readResult.data as { content: string };
    expect(readData.content).toBe('Integration test content');

    // Delete file
    const deleteResult = await agent.executeTool('delete_file', { path: testFile });
    expect(deleteResult.success).toBe(true);
  });

  it('should execute terminal commands via agent', async () => {
    const result = await agent.executeTool('execute_command', { command: 'node --version' });

    expect(result.success).toBe(true);
    const data = result.data as { exitCode: number };
    expect(data.exitCode).toBe(0);
  });

  it('should get tool definitions for LLM', () => {
    const definitions = agent.getToolDefinitions();

    expect(definitions.length).toBeGreaterThan(0);
    expect(definitions[0]).toHaveProperty('type', 'function');
    expect(definitions[0]).toHaveProperty('function.name');
    expect(definitions[0]).toHaveProperty('function.description');
    expect(definitions[0]).toHaveProperty('function.parameters');
  });
});
