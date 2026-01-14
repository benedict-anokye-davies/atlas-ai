/**
 * Nova Desktop - LLM Tool Definitions
 * OpenAI-compatible tool definitions for function calling
 *
 * These definitions allow the LLM to understand and request tool execution
 * during voice interactions. The format follows the OpenAI function calling spec.
 */

import { AgentTool } from './index';
import { getAllTools, toolCategories } from './tools/index';

/**
 * OpenAI function calling tool definition
 */
export interface LLMToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
}

/**
 * Tool call from LLM response
 */
export interface LLMToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

/**
 * Parsed tool call with deserialized arguments
 */
export interface ParsedToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * Tool execution result for sending back to LLM
 */
export interface ToolExecutionResult {
  tool_call_id: string;
  role: 'tool';
  content: string;
}

/**
 * Voice-optimized tool subset
 * These tools are most useful for voice interactions
 */
export const VOICE_TOOLS = [
  // Filesystem - reading and searching are most common voice requests
  'read_file',
  'list_directory',
  'search_files',
  'write_file',
  // Terminal - running commands via voice
  'execute_command',
  'npm_command',
  'git_command',
  // Search - web searches via voice
  'web_search',
  'fetch_url',
  // Clipboard - voice-driven copy/paste
  'read_clipboard_text',
  'write_clipboard_text',
  // Screenshot - capture screen via voice
  'capture_screen',
] as const;

/**
 * Convert AgentTool to OpenAI function calling format
 */
export function agentToolToLLMDefinition(tool: AgentTool): LLMToolDefinition {
  const params = tool.parameters as {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
  };

  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: 'object',
        properties: params.properties || {},
        required: params.required || [],
      },
    },
  };
}

/**
 * Get all tool definitions in OpenAI format
 */
export function getToolDefinitions(): LLMToolDefinition[] {
  const tools = getAllTools();
  return tools.map(agentToolToLLMDefinition);
}

/**
 * Get voice-optimized tool definitions
 * Returns a subset of tools most useful for voice interactions
 */
export function getVoiceToolDefinitions(): LLMToolDefinition[] {
  const allTools = getAllTools();
  const voiceTools = allTools.filter((tool) =>
    VOICE_TOOLS.includes(tool.name as (typeof VOICE_TOOLS)[number])
  );
  return voiceTools.map(agentToolToLLMDefinition);
}

/**
 * Get tool definitions by category
 */
export function getToolDefinitionsByCategory(
  categories: Array<'filesystem' | 'terminal' | 'browser' | 'screenshot' | 'clipboard' | 'search'>
): LLMToolDefinition[] {
  const tools: AgentTool[] = [];

  for (const category of categories) {
    if (toolCategories[category]) {
      tools.push(...toolCategories[category]);
    }
  }

  return tools.map(agentToolToLLMDefinition);
}

/**
 * Parse tool calls from LLM response
 */
export function parseToolCalls(toolCalls: LLMToolCall[]): ParsedToolCall[] {
  return toolCalls.map((call) => {
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(call.function.arguments);
    } catch {
      // If parsing fails, treat as empty args
      args = {};
    }

    return {
      id: call.id,
      name: call.function.name,
      arguments: args,
    };
  });
}

/**
 * Format tool result for sending back to LLM
 */
export function formatToolResult(
  toolCallId: string,
  result: { success: boolean; data?: unknown; error?: string }
): ToolExecutionResult {
  let content: string;

  if (result.success) {
    if (typeof result.data === 'string') {
      content = result.data;
    } else if (result.data !== undefined) {
      // Format data in a readable way for the LLM
      content = JSON.stringify(result.data, null, 2);
    } else {
      content = 'Operation completed successfully.';
    }
  } else {
    content = `Error: ${result.error || 'Unknown error occurred'}`;
  }

  return {
    tool_call_id: toolCallId,
    role: 'tool',
    content,
  };
}

/**
 * Format multiple tool results for conversation history
 */
export function formatToolResults(
  results: Array<{
    toolCallId: string;
    result: { success: boolean; data?: unknown; error?: string };
  }>
): ToolExecutionResult[] {
  return results.map(({ toolCallId, result }) => formatToolResult(toolCallId, result));
}

/**
 * Summarize tool results for voice response
 * Creates a natural language summary suitable for TTS
 */
export function summarizeToolResultForVoice(
  toolName: string,
  result: { success: boolean; data?: unknown; error?: string }
): string {
  if (!result.success) {
    return `I encountered an error: ${result.error || 'Something went wrong'}`;
  }

  const data = result.data as Record<string, unknown>;

  switch (toolName) {
    case 'read_file': {
      const content = (data?.content as string) || '';
      const lines = (data?.lines as number) || content.split('\n').length;
      const truncated = data?.truncated === true;
      if (lines > 20) {
        return `I read the file. It has ${lines} lines.${truncated ? ' I only read the first portion.' : ''} Here's what I found: ${content.slice(0, 500)}${content.length > 500 ? '...' : ''}`;
      }
      return `Here's the content of the file: ${content}`;
    }

    case 'list_directory': {
      const entries = (data?.entries as Array<{ name: string; isDirectory: boolean }>) || [];
      const totalFiles = (data?.totalFiles as number) || 0;
      const totalDirs = (data?.totalDirectories as number) || 0;

      if (entries.length === 0) {
        return 'The directory is empty.';
      }

      const summary = entries
        .slice(0, 10)
        .map((e) => e.name)
        .join(', ');
      return `I found ${totalFiles} files and ${totalDirs} directories. Here are some: ${summary}${entries.length > 10 ? ` and ${entries.length - 10} more` : ''}.`;
    }

    case 'search_files': {
      const files = (data?.files as Array<{ name: string }>) || [];
      const total = (data?.totalMatches as number) || 0;

      if (files.length === 0) {
        return 'No files matched your search.';
      }

      const names = files
        .slice(0, 5)
        .map((f) => f.name)
        .join(', ');
      return `I found ${total} matching files: ${names}${files.length > 5 ? ` and ${total - 5} more` : ''}.`;
    }

    case 'write_file': {
      const created = data?.created === true;
      return created ? 'I created the file successfully.' : 'I updated the file successfully.';
    }

    case 'execute_command':
    case 'npm_command':
    case 'git_command': {
      const stdout = (data?.stdout as string) || '';
      const exitCode = data?.exitCode as number;

      if (exitCode !== 0) {
        const stderr = (data?.stderr as string) || '';
        return `The command completed with exit code ${exitCode}. ${stderr.slice(0, 200)}`;
      }

      if (stdout.length > 300) {
        return `Command completed successfully. Here's a summary: ${stdout.slice(0, 300)}...`;
      }
      return stdout || 'Command completed successfully.';
    }

    case 'web_search': {
      const results = (data?.results as Array<{ title: string; description: string }>) || [];
      if (results.length === 0) {
        return 'No search results found.';
      }

      const topResults = results
        .slice(0, 3)
        .map((r) => r.title)
        .join(', ');
      return `I found ${results.length} results. Top results: ${topResults}.`;
    }

    case 'fetch_url': {
      const content = (data?.content as string) || '';
      const title = (data?.title as string) || '';
      return title
        ? `I fetched the page: "${title}". ${content.slice(0, 200)}...`
        : `I fetched the URL. Here's what I found: ${content.slice(0, 300)}...`;
    }

    case 'read_clipboard_text': {
      const text = (data?.text as string) || '';
      return text
        ? `Clipboard contains: ${text.slice(0, 200)}${text.length > 200 ? '...' : ''}`
        : 'The clipboard is empty.';
    }

    case 'write_clipboard_text':
      return 'I copied the text to your clipboard.';

    case 'capture_screen':
      return 'I captured a screenshot.';

    default:
      return typeof data === 'string' ? data : 'Operation completed successfully.';
  }
}

/**
 * Get a subset of tools based on conversation context
 * This can be used to dynamically select relevant tools
 */
export function getContextualTools(userMessage: string): LLMToolDefinition[] {
  const lowerMessage = userMessage.toLowerCase();

  // Determine relevant categories based on the message
  const categories: Array<
    'filesystem' | 'terminal' | 'browser' | 'screenshot' | 'clipboard' | 'search'
  > = [];

  if (
    lowerMessage.includes('file') ||
    lowerMessage.includes('read') ||
    lowerMessage.includes('write') ||
    lowerMessage.includes('directory') ||
    lowerMessage.includes('folder') ||
    lowerMessage.includes('search') ||
    lowerMessage.includes('find')
  ) {
    categories.push('filesystem');
  }

  if (
    lowerMessage.includes('run') ||
    lowerMessage.includes('execute') ||
    lowerMessage.includes('command') ||
    lowerMessage.includes('npm') ||
    lowerMessage.includes('git') ||
    lowerMessage.includes('terminal')
  ) {
    categories.push('terminal');
  }

  if (
    lowerMessage.includes('browser') ||
    lowerMessage.includes('web') ||
    lowerMessage.includes('website') ||
    lowerMessage.includes('url') ||
    lowerMessage.includes('page')
  ) {
    categories.push('browser');
    categories.push('search');
  }

  if (
    lowerMessage.includes('screenshot') ||
    lowerMessage.includes('capture') ||
    lowerMessage.includes('screen')
  ) {
    categories.push('screenshot');
  }

  if (
    lowerMessage.includes('clipboard') ||
    lowerMessage.includes('copy') ||
    lowerMessage.includes('paste')
  ) {
    categories.push('clipboard');
  }

  if (
    lowerMessage.includes('search') ||
    lowerMessage.includes('google') ||
    lowerMessage.includes('look up')
  ) {
    categories.push('search');
  }

  // Default to voice tools if no specific context detected
  if (categories.length === 0) {
    return getVoiceToolDefinitions();
  }

  return getToolDefinitionsByCategory(categories);
}

export default {
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
};
