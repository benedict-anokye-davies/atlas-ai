/**
 * Atlas Desktop - Tool Registry
 *
 * Central registry for all agent tools with LLM function calling definitions.
 * Provides OpenAI-compatible tool definitions for use with LLMs.
 *
 * @module agent/tool-registry
 */

import { AgentTool } from '../../shared/types/agent';
import { createModuleLogger } from '../utils/logger';
import {
  getAllTools,
  getToolByName,
  getToolsByCategory,
  toolCategories,
  ToolCategoryName,
} from './tools/index';

const logger = createModuleLogger('ToolRegistry');

// =============================================================================
// Types
// =============================================================================

/**
 * OpenAI-compatible function definition for LLM tool calling
 */
export interface LLMToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/**
 * Tool execution request from LLM
 */
export interface ToolExecutionRequest {
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * Tool execution result
 */
export interface ToolExecutionResult {
  success: boolean;
  toolName: string;
  result?: unknown;
  error?: string;
  duration: number;
}

// =============================================================================
// Tool Registry Class
// =============================================================================

/**
 * Tool Registry
 * Manages tool registration, lookup, and execution with LLM integration.
 */
export class ToolRegistry {
  private tools: Map<string, AgentTool> = new Map();
  private toolDefinitions: LLMToolDefinition[] = [];
  private initialized = false;

  constructor() {
    this.initialize();
  }

  /**
   * Initialize the registry with all available tools
   */
  private initialize(): void {
    if (this.initialized) return;

    const allTools = getAllTools();

    for (const tool of allTools) {
      this.tools.set(tool.name, tool);
      this.toolDefinitions.push(this.convertToLLMDefinition(tool));
    }

    this.initialized = true;
    logger.info('Tool registry initialized', { toolCount: this.tools.size });
  }

  /**
   * Convert an AgentTool to OpenAI-compatible LLM tool definition
   */
  private convertToLLMDefinition(tool: AgentTool): LLMToolDefinition {
    return {
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters || {
          type: 'object',
          properties: {},
          required: [],
        },
      },
    };
  }

  /**
   * Get all LLM-compatible tool definitions
   */
  getToolDefinitions(): LLMToolDefinition[] {
    return this.toolDefinitions;
  }

  /**
   * Get tool definitions for specific categories
   */
  getToolDefinitionsByCategory(categories: ToolCategoryName[]): LLMToolDefinition[] {
    const categoryTools = new Set<string>();

    for (const category of categories) {
      const tools = getToolsByCategory(category);
      for (const tool of tools) {
        categoryTools.add(tool.name);
      }
    }

    return this.toolDefinitions.filter((def) => categoryTools.has(def.function.name));
  }

  /**
   * Get a subset of tool definitions by name
   */
  getToolDefinitionsByName(names: string[]): LLMToolDefinition[] {
    const nameSet = new Set(names);
    return this.toolDefinitions.filter((def) => nameSet.has(def.function.name));
  }

  /**
   * Get a single tool by name
   */
  getTool(name: string): AgentTool | undefined {
    return this.tools.get(name) || getToolByName(name);
  }

  /**
   * Check if a tool exists
   */
  hasTool(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Get all tool names
   */
  getToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Get tool count
   */
  getToolCount(): number {
    return this.tools.size;
  }

  /**
   * Execute a tool by name with arguments
   */
  async executeTool(name: string, args: Record<string, unknown>): Promise<ToolExecutionResult> {
    const startTime = Date.now();

    try {
      const tool = this.getTool(name);

      if (!tool) {
        logger.warn('Tool not found', { name });
        return {
          success: false,
          toolName: name,
          error: `Tool not found: ${name}`,
          duration: Date.now() - startTime,
        };
      }

      logger.debug('Executing tool', { name, args });

      const result = await tool.execute(args);

      const duration = Date.now() - startTime;

      logger.info('Tool executed', {
        name,
        success: result.success,
        duration,
      });

      return {
        success: result.success,
        toolName: name,
        result: result.success ? result.data : undefined,
        error: result.error,
        duration,
      };
    } catch (error) {
      const err = error as Error;
      const duration = Date.now() - startTime;

      logger.error('Tool execution failed', {
        name,
        error: err.message,
        duration,
      });

      return {
        success: false,
        toolName: name,
        error: err.message,
        duration,
      };
    }
  }

  /**
   * Execute multiple tool calls in sequence
   */
  async executeToolCalls(calls: ToolExecutionRequest[]): Promise<ToolExecutionResult[]> {
    const results: ToolExecutionResult[] = [];

    for (const call of calls) {
      const result = await this.executeTool(call.name, call.arguments);
      results.push(result);
    }

    return results;
  }

  /**
   * Execute multiple tool calls in parallel
   */
  async executeToolCallsParallel(calls: ToolExecutionRequest[]): Promise<ToolExecutionResult[]> {
    const promises = calls.map((call) => this.executeTool(call.name, call.arguments));

    return Promise.all(promises);
  }

  /**
   * Get tools grouped by category for display
   */
  getToolsByCategoryMap(): Record<string, LLMToolDefinition[]> {
    const result: Record<string, LLMToolDefinition[]> = {};

    for (const categoryName of Object.keys(toolCategories) as ToolCategoryName[]) {
      const categoryTools = toolCategories[categoryName];
      const toolNames = new Set(categoryTools.map((t: AgentTool) => t.name));
      result[categoryName] = this.toolDefinitions.filter((def) => toolNames.has(def.function.name));
    }

    return result;
  }

  /**
   * Get a summary of available tools
   */
  getSummary(): {
    totalTools: number;
    categories: Record<string, number>;
    toolNames: string[];
  } {
    const categories: Record<string, number> = {};

    for (const categoryName of Object.keys(toolCategories) as ToolCategoryName[]) {
      const categoryTools = toolCategories[categoryName];
      categories[categoryName] = categoryTools.length;
    }

    return {
      totalTools: this.tools.size,
      categories,
      toolNames: this.getToolNames(),
    };
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let registryInstance: ToolRegistry | null = null;

/**
 * Get the singleton tool registry instance
 */
export function getToolRegistry(): ToolRegistry {
  if (!registryInstance) {
    registryInstance = new ToolRegistry();
  }
  return registryInstance;
}

/**
 * Reset the tool registry (for testing)
 */
export function resetToolRegistry(): void {
  registryInstance = null;
}

// =============================================================================
// Convenience Functions
// =============================================================================

/**
 * Get all LLM tool definitions (convenience function)
 */
export function getLLMToolDefinitions(): LLMToolDefinition[] {
  return getToolRegistry().getToolDefinitions();
}

/**
 * Execute a tool by name (convenience function)
 */
export async function executeTool(
  name: string,
  args: Record<string, unknown>
): Promise<ToolExecutionResult> {
  return getToolRegistry().executeTool(name, args);
}

/**
 * Execute a tool call from LLM response (convenience function)
 */
export async function executeToolCall(call: ToolExecutionRequest): Promise<ToolExecutionResult> {
  return getToolRegistry().executeTool(call.name, call.arguments);
}

/**
 * Check if a tool exists (convenience function)
 */
export function hasToolByName(name: string): boolean {
  return getToolRegistry().hasTool(name);
}

// =============================================================================
// Exports
// =============================================================================

export default {
  ToolRegistry,
  getToolRegistry,
  resetToolRegistry,
  getLLMToolDefinitions,
  executeTool,
  executeToolCall,
  hasToolByName,
};
