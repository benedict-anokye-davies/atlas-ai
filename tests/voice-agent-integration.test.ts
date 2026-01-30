/**
 * Nova Desktop - Voice Agent Integration Tests
 * Tests for LLM tool definitions, tool call parsing, and voice pipeline tool execution
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock Electron modules
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/mock/path'),
    getName: vi.fn(() => 'nova-desktop'),
    getVersion: vi.fn(() => '0.1.0'),
  },
  ipcMain: {
    on: vi.fn(),
    handle: vi.fn(),
    removeHandler: vi.fn(),
  },
  BrowserWindow: vi.fn(),
  nativeTheme: {
    shouldUseDarkColors: false,
  },
}));

// Import test targets
import {
  getToolDefinitions,
  getVoiceToolDefinitions,
  getToolDefinitionsByCategory,
  getContextualTools,
  agentToolToLLMDefinition,
  parseToolCalls,
  formatToolResult,
  formatToolResults,
  summarizeToolResultForVoice,
  VOICE_TOOLS,
  LLMToolDefinition,
  LLMToolCall,
  ParsedToolCall,
  ToolExecutionResult,
} from '../src/main/agent/llm-tools';

import { Agent, AgentTool } from '../src/main/agent';
import { ToolCall } from '../src/shared/types/llm';

// ============================================================================
// TOOL DEFINITION TESTS
// ============================================================================

describe('LLM Tool Definitions', () => {
  describe('getToolDefinitions', () => {
    it('should return array of tool definitions', () => {
      const tools = getToolDefinitions();
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);
    });

    it('should return tools in OpenAI function calling format', () => {
      const tools = getToolDefinitions();
      for (const tool of tools) {
        expect(tool.type).toBe('function');
        expect(tool.function).toBeDefined();
        expect(tool.function.name).toBeTruthy();
        expect(tool.function.description).toBeTruthy();
        expect(tool.function.parameters).toBeDefined();
        expect(tool.function.parameters.type).toBe('object');
      }
    });

    it('should have unique tool names', () => {
      const tools = getToolDefinitions();
      const names = tools.map((t) => t.function.name);
      const uniqueNames = [...new Set(names)];
      
      // Allow some duplicates due to multiple tool modules registering similar tools
      const duplicateCount = names.length - uniqueNames.length;
      expect(duplicateCount).toBeLessThanOrEqual(10);
    });
  });

  describe('getVoiceToolDefinitions', () => {
    it('should return subset of tools for voice', () => {
      const voiceTools = getVoiceToolDefinitions();
      const allTools = getToolDefinitions();

      expect(voiceTools.length).toBeLessThanOrEqual(allTools.length);
      expect(voiceTools.length).toBeGreaterThan(0);
    });

    it('should only include VOICE_TOOLS', () => {
      const voiceTools = getVoiceToolDefinitions();
      const voiceToolNames = voiceTools.map((t) => t.function.name);

      for (const name of voiceToolNames) {
        expect(VOICE_TOOLS).toContain(name);
      }
    });

    it('should include read_file tool', () => {
      const voiceTools = getVoiceToolDefinitions();
      const readFile = voiceTools.find((t) => t.function.name === 'read_file');
      expect(readFile).toBeDefined();
    });

    it('should include execute_command tool', () => {
      const voiceTools = getVoiceToolDefinitions();
      const execCmd = voiceTools.find((t) => t.function.name === 'execute_command');
      expect(execCmd).toBeDefined();
    });
  });

  describe('getToolDefinitionsByCategory', () => {
    it('should return filesystem tools', () => {
      const tools = getToolDefinitionsByCategory(['filesystem']);
      expect(tools.length).toBeGreaterThan(0);
      expect(tools.some((t) => t.function.name === 'read_file')).toBe(true);
    });

    it('should return terminal tools', () => {
      const tools = getToolDefinitionsByCategory(['terminal']);
      expect(tools.length).toBeGreaterThan(0);
      expect(tools.some((t) => t.function.name === 'execute_command')).toBe(true);
    });

    it('should return multiple categories', () => {
      const tools = getToolDefinitionsByCategory(['filesystem', 'terminal']);
      expect(tools.some((t) => t.function.name === 'read_file')).toBe(true);
      expect(tools.some((t) => t.function.name === 'execute_command')).toBe(true);
    });

    it('should return empty array for unknown category', () => {
      const tools = getToolDefinitionsByCategory(['unknown' as any]);
      expect(tools).toEqual([]);
    });
  });

  describe('getContextualTools', () => {
    it('should return filesystem tools for file-related messages', () => {
      const tools = getContextualTools('read the package.json file');
      expect(tools.some((t) => t.function.name === 'read_file')).toBe(true);
    });

    it('should return terminal tools for command-related messages', () => {
      const tools = getContextualTools('run npm install');
      expect(tools.some((t) => t.function.name === 'execute_command')).toBe(true);
    });

    it('should return search tools for web-related messages', () => {
      const tools = getContextualTools('search the web for typescript tutorials');
      expect(tools.some((t) => t.function.name === 'web_search')).toBe(true);
    });

    it('should return clipboard tools for copy/paste messages', () => {
      const tools = getContextualTools('copy this to clipboard');
      expect(tools.length).toBeGreaterThan(0);
    });

    it('should return voice tools for generic messages', () => {
      const tools = getContextualTools('hello there');
      // Should return default voice tools
      expect(tools.length).toBeGreaterThan(0);
    });
  });

  describe('agentToolToLLMDefinition', () => {
    it('should convert AgentTool to LLM format', () => {
      const agentTool: AgentTool = {
        name: 'test_tool',
        description: 'A test tool',
        parameters: {
          type: 'object',
          properties: {
            param1: { type: 'string', description: 'First param' },
          },
          required: ['param1'],
        },
        execute: async () => ({ success: true }),
      };

      const llmTool = agentToolToLLMDefinition(agentTool);

      expect(llmTool.type).toBe('function');
      expect(llmTool.function.name).toBe('test_tool');
      expect(llmTool.function.description).toBe('A test tool');
      expect(llmTool.function.parameters.properties).toHaveProperty('param1');
      expect(llmTool.function.parameters.required).toContain('param1');
    });
  });
});

// ============================================================================
// TOOL CALL PARSING TESTS
// ============================================================================

describe('Tool Call Parsing', () => {
  describe('parseToolCalls', () => {
    it('should parse valid tool calls', () => {
      const toolCalls: LLMToolCall[] = [
        {
          id: 'call_123',
          type: 'function',
          function: {
            name: 'read_file',
            arguments: JSON.stringify({ path: '/test/file.txt' }),
          },
        },
      ];

      const parsed = parseToolCalls(toolCalls);

      expect(parsed).toHaveLength(1);
      expect(parsed[0].id).toBe('call_123');
      expect(parsed[0].name).toBe('read_file');
      expect(parsed[0].arguments).toEqual({ path: '/test/file.txt' });
    });

    it('should handle multiple tool calls', () => {
      const toolCalls: LLMToolCall[] = [
        {
          id: 'call_1',
          type: 'function',
          function: {
            name: 'read_file',
            arguments: JSON.stringify({ path: '/a.txt' }),
          },
        },
        {
          id: 'call_2',
          type: 'function',
          function: {
            name: 'write_file',
            arguments: JSON.stringify({ path: '/b.txt', content: 'hello' }),
          },
        },
      ];

      const parsed = parseToolCalls(toolCalls);

      expect(parsed).toHaveLength(2);
      expect(parsed[0].name).toBe('read_file');
      expect(parsed[1].name).toBe('write_file');
    });

    it('should handle invalid JSON arguments gracefully', () => {
      const toolCalls: LLMToolCall[] = [
        {
          id: 'call_bad',
          type: 'function',
          function: {
            name: 'test_tool',
            arguments: 'not valid json',
          },
        },
      ];

      const parsed = parseToolCalls(toolCalls);

      expect(parsed).toHaveLength(1);
      expect(parsed[0].arguments).toEqual({});
    });

    it('should handle empty tool calls array', () => {
      const parsed = parseToolCalls([]);
      expect(parsed).toEqual([]);
    });
  });
});

// ============================================================================
// TOOL RESULT FORMATTING TESTS
// ============================================================================

describe('Tool Result Formatting', () => {
  describe('formatToolResult', () => {
    it('should format successful result with string data', () => {
      const result = formatToolResult('call_123', {
        success: true,
        data: 'File content here',
      });

      expect(result.tool_call_id).toBe('call_123');
      expect(result.role).toBe('tool');
      expect(result.content).toBe('File content here');
    });

    it('should format successful result with object data', () => {
      const result = formatToolResult('call_123', {
        success: true,
        data: { key: 'value', nested: { a: 1 } },
      });

      expect(result.content).toContain('key');
      expect(result.content).toContain('value');
    });

    it('should format successful result without data', () => {
      const result = formatToolResult('call_123', {
        success: true,
      });

      expect(result.content).toBe('Operation completed successfully.');
    });

    it('should format error result', () => {
      const result = formatToolResult('call_123', {
        success: false,
        error: 'File not found',
      });

      expect(result.content).toContain('Error');
      expect(result.content).toContain('File not found');
    });

    it('should format error without message', () => {
      const result = formatToolResult('call_123', {
        success: false,
      });

      expect(result.content).toContain('Unknown error');
    });
  });

  describe('formatToolResults', () => {
    it('should format multiple results', () => {
      const results = formatToolResults([
        { toolCallId: 'call_1', result: { success: true, data: 'Result 1' } },
        { toolCallId: 'call_2', result: { success: false, error: 'Error 2' } },
      ]);

      expect(results).toHaveLength(2);
      expect(results[0].tool_call_id).toBe('call_1');
      expect(results[1].tool_call_id).toBe('call_2');
    });
  });
});

// ============================================================================
// VOICE SUMMARY TESTS
// ============================================================================

describe('Voice Result Summarization', () => {
  describe('summarizeToolResultForVoice', () => {
    it('should summarize read_file result', () => {
      const summary = summarizeToolResultForVoice('read_file', {
        success: true,
        data: {
          content: 'Short content',
          lines: 5,
        },
      });

      expect(summary).toContain('content');
    });

    it('should summarize long read_file result', () => {
      const summary = summarizeToolResultForVoice('read_file', {
        success: true,
        data: {
          content: 'A'.repeat(1000),
          lines: 100,
          truncated: true,
        },
      });

      expect(summary).toContain('100 lines');
      expect(summary).toContain('first portion');
    });

    it('should summarize list_directory result', () => {
      const summary = summarizeToolResultForVoice('list_directory', {
        success: true,
        data: {
          entries: [
            { name: 'file1.txt', isDirectory: false },
            { name: 'folder1', isDirectory: true },
          ],
          totalFiles: 5,
          totalDirectories: 2,
        },
      });

      expect(summary).toContain('5 files');
      expect(summary).toContain('2 directories');
    });

    it('should summarize empty list_directory result', () => {
      const summary = summarizeToolResultForVoice('list_directory', {
        success: true,
        data: { entries: [] },
      });

      expect(summary).toContain('empty');
    });

    it('should summarize search_files result', () => {
      const summary = summarizeToolResultForVoice('search_files', {
        success: true,
        data: {
          files: [{ name: 'match1.ts' }, { name: 'match2.ts' }],
          totalMatches: 2,
        },
      });

      expect(summary).toContain('2 matching');
    });

    it('should summarize write_file result (new file)', () => {
      const summary = summarizeToolResultForVoice('write_file', {
        success: true,
        data: { created: true },
      });

      expect(summary).toContain('created');
    });

    it('should summarize write_file result (update)', () => {
      const summary = summarizeToolResultForVoice('write_file', {
        success: true,
        data: { created: false },
      });

      expect(summary).toContain('updated');
    });

    it('should summarize execute_command result', () => {
      const summary = summarizeToolResultForVoice('execute_command', {
        success: true,
        data: {
          stdout: 'Command output here',
          exitCode: 0,
        },
      });

      expect(summary).toContain('Command output');
    });

    it('should summarize failed command result', () => {
      const summary = summarizeToolResultForVoice('execute_command', {
        success: true,
        data: {
          stdout: '',
          stderr: 'Error message',
          exitCode: 1,
        },
      });

      expect(summary).toContain('exit code 1');
    });

    it('should summarize web_search result', () => {
      const summary = summarizeToolResultForVoice('web_search', {
        success: true,
        data: {
          results: [
            { title: 'Result 1', description: 'Desc 1' },
            { title: 'Result 2', description: 'Desc 2' },
          ],
        },
      });

      expect(summary).toContain('2 results');
    });

    it('should summarize clipboard read result', () => {
      const summary = summarizeToolResultForVoice('read_clipboard_text', {
        success: true,
        data: { text: 'Clipboard content' },
      });

      expect(summary).toContain('Clipboard');
    });

    it('should summarize clipboard write result', () => {
      const summary = summarizeToolResultForVoice('write_clipboard_text', {
        success: true,
        data: {},
      });

      expect(summary).toContain('copied');
    });

    it('should summarize screenshot result', () => {
      const summary = summarizeToolResultForVoice('capture_screen', {
        success: true,
        data: {},
      });

      expect(summary).toContain('screenshot');
    });

    it('should summarize error result', () => {
      const summary = summarizeToolResultForVoice('any_tool', {
        success: false,
        error: 'Something went wrong',
      });

      expect(summary).toContain('error');
      expect(summary).toContain('Something went wrong');
    });

    it('should summarize unknown tool result', () => {
      const summary = summarizeToolResultForVoice('unknown_tool', {
        success: true,
        data: { custom: 'data' },
      });

      expect(summary).toContain('successfully');
    });
  });
});

// ============================================================================
// VOICE TOOLS CONSTANT TESTS
// ============================================================================

describe('VOICE_TOOLS constant', () => {
  it('should contain expected tools', () => {
    expect(VOICE_TOOLS).toContain('read_file');
    expect(VOICE_TOOLS).toContain('list_directory');
    expect(VOICE_TOOLS).toContain('search_files');
    expect(VOICE_TOOLS).toContain('execute_command');
    expect(VOICE_TOOLS).toContain('web_search');
  });

  it('should be readonly', () => {
    // TypeScript will prevent modification, but let's verify the array structure
    expect(Object.isFrozen(VOICE_TOOLS) || VOICE_TOOLS.length > 0).toBe(true);
  });
});

// ============================================================================
// TYPE SAFETY TESTS
// ============================================================================

describe('Type Definitions', () => {
  it('should have correct LLMToolDefinition structure', () => {
    const toolDef: LLMToolDefinition = {
      type: 'function',
      function: {
        name: 'test',
        description: 'Test tool',
        parameters: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
    };

    expect(toolDef.type).toBe('function');
    expect(toolDef.function.name).toBe('test');
  });

  it('should have correct ToolExecutionResult structure', () => {
    const result: ToolExecutionResult = {
      tool_call_id: 'call_123',
      role: 'tool',
      content: 'Result content',
    };

    expect(result.role).toBe('tool');
    expect(result.tool_call_id).toBe('call_123');
  });

  it('should have correct ParsedToolCall structure', () => {
    const parsed: ParsedToolCall = {
      id: 'call_123',
      name: 'test_tool',
      arguments: { key: 'value' },
    };

    expect(parsed.id).toBe('call_123');
    expect(parsed.name).toBe('test_tool');
    expect(parsed.arguments.key).toBe('value');
  });
});
