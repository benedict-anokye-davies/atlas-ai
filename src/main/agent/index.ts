/**
 * Nova Desktop - Agent System
 *
 * Core agent implementation for the Nova AI assistant.
 * Manages tool registration, execution, and action planning.
 *
 * Features:
 * - Pluggable tool system with JSON schema parameters
 * - Timeout handling for tool execution
 * - Event-based tool lifecycle tracking
 * - OpenAI-compatible function calling format
 *
 * @module agent
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';

// Re-export types from shared to maintain backwards compatibility
export { ActionResult, AgentTool } from '../../shared/types/agent';
import type { ActionResult, AgentTool } from '../../shared/types/agent';

const logger = createModuleLogger('Agent');

/**
 * Agent capability categories
 */
export type AgentCapability =
  | 'conversation'
  | 'web_search'
  | 'file_system'
  | 'system_control'
  | 'code_execution'
  | 'memory'
  | 'scheduling';

/**
 * Agent configuration
 */
export interface AgentConfig {
  /** Agent name */
  name: string;
  /** Agent persona/personality description */
  persona: string;
  /** Enabled capabilities */
  capabilities: AgentCapability[];
  /** Maximum actions per turn */
  maxActionsPerTurn: number;
  /** Action timeout in ms */
  actionTimeout: number;
  /** Enable tool use */
  enableTools: boolean;
}

/**
 * Default agent configuration
 */
export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  name: 'Nova',
  persona: 'A helpful, friendly AI assistant focused on productivity and natural conversation.',
  capabilities: ['conversation', 'memory', 'file_system', 'code_execution'],
  maxActionsPerTurn: 5,
  actionTimeout: 30000,
  enableTools: true,
};

/**
 * Agent execution context
 */
export interface AgentContext {
  /** User identifier */
  userId: string;
  /** Session identifier */
  sessionId: string;
  /** Conversation history reference */
  conversationId: string;
  /** Current timestamp */
  timestamp: number;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Agent events
 */
export interface AgentEvents {
  /** Tool execution started */
  'tool-start': (toolName: string, params: Record<string, unknown>) => void;
  /** Tool execution completed */
  'tool-complete': (toolName: string, result: ActionResult) => void;
  /** Agent thinking/processing */
  thinking: (thought: string) => void;
  /** Agent action taken */
  action: (action: string, details: unknown) => void;
  /** Agent error */
  error: (error: Error) => void;
}

/**
 * Agent class - Core agent implementation
 * Manages tool execution and action planning
 */
export class Agent extends EventEmitter {
  private config: AgentConfig;
  private tools: Map<string, AgentTool> = new Map();
  private isExecuting = false;

  constructor(config?: Partial<AgentConfig>) {
    super();
    this.config = { ...DEFAULT_AGENT_CONFIG, ...config };
  }

  /**
   * Gets the agent's name.
   *
   * @returns The configured agent name
   */
  get name(): string {
    return this.config.name;
  }

  /**
   * Gets the agent's persona description.
   *
   * @returns The persona/personality description used for system prompts
   */
  get persona(): string {
    return this.config.persona;
  }

  /**
   * Gets the list of enabled agent capabilities.
   *
   * @returns Array of capability names like 'conversation', 'file_system', etc.
   */
  get capabilities(): AgentCapability[] {
    return [...this.config.capabilities];
  }

  /**
   * Checks if the agent has a specific capability.
   *
   * @param capability - The capability to check for
   * @returns True if the capability is enabled
   */
  hasCapability(capability: AgentCapability): boolean {
    return this.config.capabilities.includes(capability);
  }

  /**
   * Registers a tool with the agent.
   *
   * @param tool - The tool to register with name, description, parameters, and execute function
   * @throws Error if tools are disabled in the agent configuration
   *
   * @example
   * ```typescript
   * agent.registerTool({
   *   name: 'get_weather',
   *   description: 'Get current weather for a location',
   *   parameters: { type: 'object', properties: { city: { type: 'string' } } },
   *   execute: async (params) => ({ success: true, data: 'Sunny, 72°F' })
   * });
   * ```
   */
  registerTool(tool: AgentTool): void {
    if (!this.config.enableTools) {
      throw new Error(
        'Cannot register tool: Tools are disabled for this agent. Set enableTools: true in the agent configuration.'
      );
    }
    this.tools.set(tool.name, tool);
    logger.debug('Tool registered', { toolName: tool.name });
    this.emit('action', 'tool-registered', { toolName: tool.name });
  }

  /**
   * Registers multiple tools at once.
   *
   * @param tools - Array of tools to register
   */
  registerTools(tools: AgentTool[]): void {
    for (const tool of tools) {
      this.registerTool(tool);
    }
  }

  /**
   * Unregisters a tool by name.
   *
   * @param toolName - Name of the tool to remove
   * @returns True if the tool was found and removed
   */
  unregisterTool(toolName: string): boolean {
    return this.tools.delete(toolName);
  }

  /**
   * Gets all registered tools.
   *
   * @returns Array of all registered AgentTool objects
   */
  getTools(): AgentTool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Gets a tool by its name.
   *
   * @param name - The tool name to look up
   * @returns The AgentTool if found, undefined otherwise
   */
  getTool(name: string): AgentTool | undefined {
    return this.tools.get(name);
  }

  /**
   * Executes a tool by name with the provided parameters.
   *
   * Includes timeout handling based on the configured actionTimeout.
   * Emits 'tool-start' and 'tool-complete' events during execution.
   *
   * @param toolName - Name of the tool to execute
   * @param params - Parameters to pass to the tool
   * @param _context - Optional agent context (reserved for future use)
   * @returns ActionResult with success status and data or error message
   *
   * @example
   * ```typescript
   * const result = await agent.executeTool('read_file', { path: '/etc/hosts' });
   * if (result.success) {
   *   console.log(result.data);
   * } else {
   *   console.error(result.error);
   * }
   * ```
   */
  async executeTool(
    toolName: string,
    params: Record<string, unknown>,
    _context?: AgentContext
  ): Promise<ActionResult> {
    const tool = this.tools.get(toolName);
    if (!tool) {
      return {
        success: false,
        error: `Tool "${toolName}" was not found. Available tools: ${Array.from(this.tools.keys()).join(', ') || 'none'}`,
      };
    }

    if (this.isExecuting) {
      return {
        success: false,
        error: 'Agent is busy executing another action. Please wait for it to complete.',
      };
    }

    this.isExecuting = true;
    this.emit('tool-start', toolName, params);

    try {
      // Create timeout promise
      const timeoutPromise = new Promise<ActionResult>((_, reject) => {
        setTimeout(
          () =>
            reject(
              new Error(
                `Tool "${toolName}" timed out after ${this.config.actionTimeout / 1000} seconds`
              )
            ),
          this.config.actionTimeout
        );
      });

      // Execute with timeout
      const result = await Promise.race([tool.execute(params), timeoutPromise]);

      this.emit('tool-complete', toolName, result);
      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      // Only emit error if there are listeners (avoids unhandled error throws)
      if (this.listenerCount('error') > 0) {
        this.emit('error', err);
      }
      return {
        success: false,
        error: err.message,
      };
    } finally {
      this.isExecuting = false;
    }
  }

  /**
   * Gets tool definitions in OpenAI function calling format.
   *
   * Use this to pass available tools to an LLM that supports function calling.
   *
   * @returns Array of tool definitions with type, name, description, and parameters
   *
   * @example
   * ```typescript
   * const tools = agent.getToolDefinitions();
   * const response = await llm.chat('Read my config file', { tools });
   * ```
   */
  getToolDefinitions(): Array<{
    type: 'function';
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  }> {
    return Array.from(this.tools.values()).map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }

  /**
   * Updates the agent configuration at runtime.
   *
   * @param config - Partial configuration to merge with existing settings
   */
  updateConfig(config: Partial<AgentConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Gets a copy of the current agent configuration.
   *
   * @returns The current AgentConfig object
   */
  getConfig(): AgentConfig {
    return { ...this.config };
  }

  // Type-safe event emitter methods
  on<K extends keyof AgentEvents>(event: K, listener: AgentEvents[K]): this {
    return super.on(event, listener);
  }

  off<K extends keyof AgentEvents>(event: K, listener: AgentEvents[K]): this {
    return super.off(event, listener);
  }

  emit<K extends keyof AgentEvents>(event: K, ...args: Parameters<AgentEvents[K]>): boolean {
    return super.emit(event, ...args);
  }
}

// Singleton instance
let agentInstance: Agent | null = null;

/**
 * Gets or creates the singleton Agent instance.
 *
 * Note: This returns an agent without tools. Use initializeAgent() to get
 * a fully configured agent with all built-in tools registered.
 *
 * @param config - Optional configuration (only used on first call)
 * @returns The Agent singleton instance
 */
export function getAgent(config?: Partial<AgentConfig>): Agent {
  if (!agentInstance) {
    agentInstance = new Agent(config);
    logger.info('Agent instance created', { name: agentInstance.name });
  }
  return agentInstance;
}

/**
 * Initializes the agent with all built-in tools registered.
 *
 * This is the recommended way to get a fully functional agent instance.
 * It dynamically imports and registers filesystem, terminal, and other tools.
 *
 * @param config - Optional configuration for the agent
 * @returns A Promise resolving to the initialized Agent with all tools
 *
 * @example
 * ```typescript
 * const agent = await initializeAgent();
 * const tools = agent.getTools();
 * console.log(`Loaded ${tools.length} tools`);
 * ```
 */
export async function initializeAgent(config?: Partial<AgentConfig>): Promise<Agent> {
  const agent = getAgent(config);

  // Only register tools if enabled and not already registered
  if (agent.getConfig().enableTools && agent.getTools().length === 0) {
    // Dynamically import tools to avoid circular dependencies
    const { getBuiltInTools } = await import('./tools');
    const { getAllTools } = await import('./tools/index');

    // Register built-in tools
    agent.registerTools(getBuiltInTools());

    // Register filesystem and terminal tools
    agent.registerTools(getAllTools());

    logger.info('Agent tools registered', { toolCount: agent.getTools().length });
  }

  return agent;
}

/**
 * Shuts down the agent and cleans up resources.
 *
 * Removes all event listeners and clears the singleton instance.
 */
export function shutdownAgent(): void {
  if (agentInstance) {
    logger.info('Shutting down agent');
    agentInstance.removeAllListeners();
    agentInstance = null;
  }
}

export default Agent;
