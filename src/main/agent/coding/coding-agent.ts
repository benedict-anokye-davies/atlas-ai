/**
 * @file Coding Agent Core
 * @description The main agent class with tool loop, error recovery, and streaming responses
 *
 * This is the brain of Atlas's coding capabilities. It implements an agentic
 * tool-use loop similar to how advanced AI coding assistants work:
 *
 * 1. Receive user request
 * 2. Build context (project, files, errors)
 * 3. Send to LLM with tool definitions
 * 4. Execute tool calls from LLM response
 * 5. Feed results back to LLM
 * 6. Repeat until task is complete or max iterations
 * 7. Validate changes (typecheck, lint)
 * 8. Report results
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../../utils/logger';
import { getErrorMessage, sleep, isoDateTime, generateId } from '../../../shared/utils';
import { ContextBuilder, getContextBuilder } from './context-builder';
import { EditEngine, getEditEngine } from './edit-engine';
import { CODING_TOOLS, getToolByName, getToolDefinitions } from './code-tools';
import type {
  CodingAgentConfig,
  CodingAgentEvents,
  CodingContext,
  CodingRequest,
  CodingResponse,
  CodingResponseChunk,
  CodingSession,
  ConversationMessage,
  ToolCall,
  ToolCallWithResult,
  ToolResult,
  AgentState,
  DEFAULT_CODING_CONFIG,
  FileEdit,
} from './types';

const logger = createModuleLogger('CodingAgent');

// Default configuration
const DEFAULT_CONFIG: CodingAgentConfig = {
  maxIterations: 25,
  maxTokens: 8192,
  temperature: 0.1,
  model: 'accounts/fireworks/models/llama-v3p3-70b-instruct',
  streaming: true,
  autoFix: true,
  runTests: false,
  requireConfirmation: true,
  taskTimeout: 300000,
  enabledTools: [
    'read_file',
    'edit_file',
    'create_file',
    'delete_file',
    'list_directory',
    'grep_search',
    'find_symbol',
    'get_errors',
    'run_command',
    'git_status',
    'git_diff',
  ],
};

/**
 * System prompt for the coding agent
 */
const SYSTEM_PROMPT = `You are Atlas, an expert AI coding agent with deep knowledge of software development.
You can read, write, and modify code autonomously to complete programming tasks.

## Your Capabilities
- Read and understand codebases of any size
- Make precise, surgical edits to existing code
- Create new files and directories
- Search code semantically and by pattern
- Run terminal commands (build, test, git, etc.)
- Fix TypeScript/JavaScript errors
- Understand project structure and dependencies

## How You Work
1. First, gather context by reading relevant files and understanding the codebase
2. Plan your approach before making changes
3. Make changes incrementally, testing as you go
4. If something doesn't work, analyze the error and try again
5. Always verify your changes compile/work before finishing

## Important Rules
- ALWAYS use tools to interact with the filesystem - never just output code blocks
- When editing files, use the edit_file tool with EXACT text matching including whitespace
- Include 2-3 lines of context before and after when editing to ensure uniqueness
- If an edit fails because the text wasn't found, read the file first to understand the current state
- After making changes, use get_errors to verify the code compiles
- Be concise in your responses - focus on actions, not explanations
- If you're unsure about something, investigate by reading more files

## Tool Usage
You have access to these tools:

${getToolDefinitions()}

When you need to perform an action, call the appropriate tool. Wait for the result before proceeding.

## Response Format
When executing tasks:
1. Think briefly about what you need to do
2. Call the necessary tools
3. Analyze results and continue
4. When done, summarize what you accomplished

Do NOT output code blocks for the user to copy - use tools to make changes directly.
`;

/**
 * The Coding Agent - autonomous code modification system
 */
export class CodingAgent extends EventEmitter {
  private config: CodingAgentConfig;
  private contextBuilder: ContextBuilder;
  private editEngine: EditEngine;
  private currentSession: CodingSession | null = null;
  private abortController: AbortController | null = null;

  constructor(config?: Partial<CodingAgentConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.contextBuilder = getContextBuilder();
    this.editEngine = getEditEngine();
  }

  /**
   * Execute a coding task
   */
  async execute(request: CodingRequest): Promise<CodingResponse> {
    const startTime = Date.now();

    // Merge config
    const config = { ...this.config, ...request.config };

    // Create session
    const session = this.createSession(config, request.prompt);
    this.currentSession = session;

    this.emit('session-start', session);
    logger.info('Coding session started', { sessionId: session.id, prompt: request.prompt.substring(0, 100) });

    try {
      // Set timeout
      this.abortController = new AbortController();
      const timeout = setTimeout(() => {
        this.abortController?.abort();
      }, config.taskTimeout);

      // Build initial context
      this.updateState('thinking');
      const context = await this.contextBuilder.buildContext({
        userRequest: request.prompt,
        files: request.files,
        includeErrors: true,
        includeGit: true,
      });
      session.context = context;

      // Run the agent loop
      await this.runAgentLoop(session);

      clearTimeout(timeout);

      // Final validation
      if (config.autoFix && session.filesModified.length > 0) {
        await this.validateChanges(session);
      }

      // Build response
      const response = this.buildResponse(session, startTime);
      session.success = response.success;
      session.summary = response.summary;
      session.endTime = Date.now();

      this.emit('session-end', session);
      logger.info('Coding session complete', {
        sessionId: session.id,
        success: response.success,
        duration: response.duration,
        toolCalls: response.toolCallCount,
      });

      return response;
    } catch (error) {
      session.errors.push(getErrorMessage(error));
      session.endTime = Date.now();
      this.emit('error', error, session);

      return {
        success: false,
        sessionId: session.id,
        message: getErrorMessage(error),
        changes: [],
        errors: session.errors,
        toolCallCount: session.toolCalls.length,
        duration: Date.now() - startTime,
        summary: `Task failed: ${getErrorMessage(error)}`,
      };
    } finally {
      this.currentSession = null;
      this.abortController = null;
    }
  }

  /**
   * Stream execution results
   */
  async *executeStream(request: CodingRequest): AsyncGenerator<CodingResponseChunk> {
    const startTime = Date.now();
    const config = { ...this.config, ...request.config };
    const session = this.createSession(config, request.prompt);
    this.currentSession = session;

    try {
      yield { type: 'thinking', content: 'Analyzing request...', state: 'thinking', progress: 5 };

      // Build context
      const context = await this.contextBuilder.buildContext({
        userRequest: request.prompt,
        files: request.files,
        includeErrors: true,
        includeGit: true,
      });
      session.context = context;

      yield { type: 'thinking', content: 'Context gathered, planning approach...', progress: 15 };

      // Build initial messages
      const messages = this.buildMessages(session);
      let iteration = 0;
      let continueLoop = true;

      while (continueLoop && iteration < config.maxIterations) {
        iteration++;
        const progress = 15 + (iteration / config.maxIterations) * 70;

        yield { type: 'thinking', content: `Iteration ${iteration}...`, progress };

        // Call LLM
        const response = await this.callLLM(messages, config);

        if (response.content) {
          yield { type: 'text', content: response.content };

          // Add assistant message
          session.messages.push({
            role: 'assistant',
            content: response.content,
            timestamp: Date.now(),
            toolCalls: response.toolCalls,
          });
          messages.push({ role: 'assistant', content: response.content });
        }

        // Process tool calls
        if (response.toolCalls && response.toolCalls.length > 0) {
          for (const toolCall of response.toolCalls) {
            yield { type: 'tool-call', toolCall };

            const result = await this.executeTool(toolCall, session);

            yield { type: 'tool-result', toolResult: result };

            // Add tool result message
            const toolMessage = {
              role: 'tool' as const,
              content: result.output || result.error || 'No output',
              toolCallId: toolCall.id,
              timestamp: Date.now(),
            };
            session.messages.push(toolMessage);
            messages.push({
              role: 'tool',
              content: toolMessage.content,
              name: toolCall.name,
            });
          }
        } else {
          // No tool calls - task may be complete
          continueLoop = false;
        }

        // Check for abort
        if (this.abortController?.signal.aborted) {
          yield { type: 'error', content: 'Task was aborted' };
          break;
        }
      }

      // Final validation
      if (config.autoFix && session.filesModified.length > 0) {
        yield { type: 'thinking', content: 'Validating changes...', progress: 90 };
        await this.validateChanges(session);
      }

      yield {
        type: 'complete',
        content: `Completed in ${iteration} iterations`,
        state: 'complete',
        progress: 100,
      };

    } catch (error) {
      yield { type: 'error', content: getErrorMessage(error) };
    } finally {
      this.currentSession = null;
    }
  }

  /**
   * Run the main agent loop
   */
  private async runAgentLoop(session: CodingSession): Promise<void> {
    const messages = this.buildMessages(session);
    let iteration = 0;

    while (iteration < session.config.maxIterations) {
      iteration++;
      this.emit('progress', (iteration / session.config.maxIterations) * 100, `Iteration ${iteration}`);
      logger.debug('Agent loop iteration', { iteration, messageCount: messages.length });

      // Check abort
      if (this.abortController?.signal.aborted) {
        throw new Error('Task aborted');
      }

      // Call LLM
      this.updateState('thinking');
      const response = await this.callLLM(messages, session.config);

      // Handle text response
      if (response.content) {
        session.messages.push({
          role: 'assistant',
          content: response.content,
          timestamp: Date.now(),
          toolCalls: response.toolCalls,
        });
        this.emit('message', session.messages[session.messages.length - 1]);
        messages.push({ role: 'assistant', content: response.content });
      }

      // Handle tool calls
      if (response.toolCalls && response.toolCalls.length > 0) {
        this.updateState('executing');

        for (const toolCall of response.toolCalls) {
          this.emit('tool-call', toolCall);

          const result = await this.executeTool(toolCall, session);

          this.emit('tool-result', {
            ...toolCall,
            result,
            startTime: Date.now() - (result.duration || 0),
            endTime: Date.now(),
          });

          // Add tool result to messages
          const toolMessage: ConversationMessage = {
            role: 'tool',
            content: result.output || result.error || 'No output',
            toolCallId: toolCall.id,
            timestamp: Date.now(),
          };
          session.messages.push(toolMessage);
          messages.push({
            role: 'tool',
            content: toolMessage.content,
            name: toolCall.name,
          });
        }
      } else {
        // No tool calls - task is complete
        logger.info('Agent completed task', { iterations: iteration });
        break;
      }

      // Brief pause between iterations
      await sleep(100);
    }

    if (iteration >= session.config.maxIterations) {
      logger.warn('Agent reached max iterations');
      session.errors.push(`Reached maximum iterations (${session.config.maxIterations})`);
    }
  }

  /**
   * Build initial messages for the LLM
   */
  private buildMessages(session: CodingSession): Array<{ role: string; content: string; name?: string }> {
    const messages: Array<{ role: string; content: string; name?: string }> = [];

    // System prompt
    messages.push({
      role: 'system',
      content: SYSTEM_PROMPT,
    });

    // Context summary
    const contextSummary = this.contextBuilder.getContextSummary(session.context);
    messages.push({
      role: 'system',
      content: `## Current Project Context\n\n${contextSummary}`,
    });

    // User request
    messages.push({
      role: 'user',
      content: session.context.userRequest,
    });

    return messages;
  }

  /**
   * Call the LLM with messages
   */
  private async callLLM(
    messages: Array<{ role: string; content: string; name?: string }>,
    config: CodingAgentConfig
  ): Promise<{ content: string; toolCalls?: ToolCall[] }> {
    try {
      // Import the LLM manager
      const { getLLMManager } = await import('../../llm/manager');
      const llmManager = getLLMManager();

      // Format tools for the LLM
      const tools = CODING_TOOLS.filter(t => config.enabledTools.includes(t.name)).map(tool => ({
        type: 'function' as const,
        function: {
          name: tool.name,
          description: tool.description,
          parameters: {
            type: 'object' as const,
            properties: tool.parameters.reduce(
              (acc, param) => {
                acc[param.name] = {
                  type: param.type,
                  description: param.description,
                  ...(param.enum ? { enum: param.enum } : {}),
                };
                return acc;
              },
              {} as Record<string, unknown>
            ),
            required: tool.parameters.filter(p => p.required).map(p => p.name),
          },
        },
      }));

      // Call the LLM
      const response = await llmManager.complete({
        messages: messages.map(m => ({
          role: m.role as 'system' | 'user' | 'assistant' | 'tool',
          content: m.content,
          ...(m.name ? { name: m.name } : {}),
        })),
        tools,
        tool_choice: 'auto',
        temperature: config.temperature,
        max_tokens: config.maxTokens,
      });

      // Parse response
      const content = response.content || '';
      const toolCalls: ToolCall[] = [];

      // Extract tool calls from response
      if (response.tool_calls) {
        for (const tc of response.tool_calls) {
          toolCalls.push({
            id: tc.id || generateId(),
            name: tc.function?.name || '',
            arguments: typeof tc.function?.arguments === 'string'
              ? JSON.parse(tc.function.arguments)
              : tc.function?.arguments || {},
          });
        }
      }

      return { content, toolCalls };
    } catch (error) {
      logger.error('LLM call failed', { error: getErrorMessage(error) });
      throw error;
    }
  }

  /**
   * Execute a tool call
   */
  private async executeTool(toolCall: ToolCall, session: CodingSession): Promise<ToolResult> {
    const tool = getToolByName(toolCall.name);

    if (!tool) {
      return {
        success: false,
        error: `Unknown tool: ${toolCall.name}`,
      };
    }

    // Check if tool is enabled
    if (!session.config.enabledTools.includes(tool.name)) {
      return {
        success: false,
        error: `Tool not enabled: ${toolCall.name}`,
      };
    }

    const startTime = Date.now();
    logger.debug('Executing tool', { tool: toolCall.name, args: toolCall.arguments });

    try {
      // Execute with timeout
      const result = await Promise.race([
        tool.execute(toolCall.arguments),
        new Promise<ToolResult>((_, reject) =>
          setTimeout(() => reject(new Error('Tool timeout')), tool.timeout || 60000)
        ),
      ]);

      // Track file modifications
      if (result.filesAffected) {
        for (const file of result.filesAffected) {
          if (!session.filesModified.includes(file)) {
            session.filesModified.push(file);
            this.emit('file-change', {
              file,
              type: 'modify',
            } as FileEdit);
          }
        }
      }

      // Record tool call
      session.toolCalls.push({
        ...toolCall,
        result,
        startTime,
        endTime: Date.now(),
      });

      return result;
    } catch (error) {
      const errorResult: ToolResult = {
        success: false,
        error: getErrorMessage(error),
        duration: Date.now() - startTime,
      };

      session.toolCalls.push({
        ...toolCall,
        result: errorResult,
        startTime,
        endTime: Date.now(),
      });

      return errorResult;
    }
  }

  /**
   * Validate changes after modifications
   */
  private async validateChanges(session: CodingSession): Promise<void> {
    logger.info('Validating changes', { filesModified: session.filesModified.length });

    const errorsTool = getToolByName('get_errors');
    if (!errorsTool) return;

    const result = await errorsTool.execute({ path: process.cwd() });

    if (result.success && result.data) {
      const errors = (result.data as { errors: unknown[] }).errors || [];
      if (errors.length > 0) {
        logger.warn('Validation found errors', { count: errors.length });
        session.errors.push(`Validation found ${errors.length} errors`);
      }
    }
  }

  /**
   * Build the final response
   */
  private buildResponse(session: CodingSession, startTime: number): CodingResponse {
    const changes: FileEdit[] = [];

    // Collect file changes
    for (const file of session.filesModified) {
      changes.push({
        file,
        type: 'modify',
      });
    }

    // Determine success
    const hasErrors = session.errors.length > 0;
    const success = !hasErrors && session.toolCalls.some(tc => tc.result.success);

    // Build summary
    let summary = '';
    if (success) {
      summary = `Successfully completed task. Modified ${session.filesModified.length} files in ${session.toolCalls.length} tool calls.`;
    } else if (session.errors.length > 0) {
      summary = `Task completed with ${session.errors.length} errors: ${session.errors[0]}`;
    } else {
      summary = 'Task completed with no changes.';
    }

    // Get last assistant message for the response message
    const lastAssistantMessage = session.messages
      .filter(m => m.role === 'assistant')
      .pop();

    return {
      success,
      sessionId: session.id,
      message: lastAssistantMessage?.content || summary,
      changes,
      errors: session.errors,
      toolCallCount: session.toolCalls.length,
      duration: Date.now() - startTime,
      summary,
    };
  }

  /**
   * Create a new session
   */
  private createSession(config: CodingAgentConfig, prompt: string): CodingSession {
    return {
      id: generateId(),
      startTime: Date.now(),
      state: 'idle',
      config,
      context: {
        project: {
          root: process.cwd(),
          language: 'typescript',
          configFiles: [],
          sourceDirs: [],
          testDirs: [],
          outputDirs: [],
          ignorePatterns: [],
        },
        activeFiles: [],
        recentFiles: [],
        errors: [],
        userRequest: prompt,
        conversationHistory: [],
      },
      messages: [],
      toolCalls: [],
      filesModified: [],
      errors: [],
    };
  }

  /**
   * Update the agent state
   */
  private updateState(state: AgentState): void {
    if (this.currentSession) {
      this.currentSession.state = state;
      this.emit('state-change', state, this.currentSession);
    }
  }

  /**
   * Abort the current task
   */
  abort(): void {
    this.abortController?.abort();
    logger.info('Agent task aborted');
  }

  /**
   * Get the current session
   */
  getCurrentSession(): CodingSession | null {
    return this.currentSession;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<CodingAgentConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): CodingAgentConfig {
    return { ...this.config };
  }
}

// Singleton instance
let codingAgentInstance: CodingAgent | null = null;

/**
 * Get the coding agent instance
 */
export function getCodingAgent(): CodingAgent {
  if (!codingAgentInstance) {
    codingAgentInstance = new CodingAgent();
  }
  return codingAgentInstance;
}

export default CodingAgent;
