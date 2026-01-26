/**
 * Atlas Desktop - Fireworks AI LLM Provider
 * LLM integration using Fireworks AI (OpenAI-compatible API)
 *
 * Supports smart model routing:
 * - GLM-4.7 Thinking: Complex reasoning ($0.60/$2.20 per M)
 * - GLM-4.7 FlashX: Simple queries ($0.07/$0.40 per M)
 */

import { EventEmitter } from 'events';
import OpenAI from 'openai';
import { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';
import { createModuleLogger, PerformanceTimer } from '../utils/logger';
import { APIError, withRetry } from '../utils/errors';
import {
  LLMProvider,
  LLMConfig,
  LLMStatus,
  LLMEvents,
  LLMResponse,
  LLMStreamChunk,
  ConversationContext,
  ChatOptions,
  ToolCall,
  DEFAULT_LLM_CONFIG,
  ATLAS_SYSTEM_PROMPT,
  createConversationContext,
  estimateTokenCount,
} from '../../shared/types/llm';
import { getSmartRouter, FIREWORKS_MODELS } from './smart-router';

const logger = createModuleLogger('FireworksLLM');
const perfTimer = new PerformanceTimer('FireworksLLM');

/**
 * Reasoning effort level for GLM-4.7's thinking mode
 * Controls the depth and thoroughness of the model's reasoning process
 */
export type ReasoningEffort = 'low' | 'medium' | 'high';

/**
 * Reasoning history mode for multi-turn conversations
 * - 'disabled': No reasoning context preserved (fastest)
 * - 'interleaved': Reasoning preserved within a turn (tool calls) - GLM-4.7's killer feature
 * - 'preserved': Reasoning preserved across ALL turns (most coherent multi-turn)
 */
export type ReasoningHistory = 'disabled' | 'interleaved' | 'preserved';

/**
 * Fireworks-specific configuration options
 */
export interface FireworksConfig extends LLMConfig {
  /** Fireworks model ID */
  model?: string;
  /**
   * Enable low-latency streaming mode
   * When true, optimizes for faster first token delivery
   */
  lowLatencyStreaming?: boolean;
  /**
   * Enable smart model routing
   * Routes simple queries to FlashX, complex to Thinking
   */
  enableSmartRouting?: boolean;
  /**
   * Force budget mode (always use FlashX)
   */
  budgetMode?: boolean;
  /**
   * GLM-4.7 Reasoning Configuration
   * Controls the model's "thinking" behavior for complex tasks
   */
  reasoning?: {
    /**
     * Effort level for reasoning (default: 'medium')
     * - 'low': Quick thinking, minimal reasoning tokens
     * - 'medium': Balanced thinking (recommended)
     * - 'high': Deep thinking, extensive reasoning for complex problems
     */
    effort: ReasoningEffort;
    /**
     * How reasoning history is handled across turns (default: 'interleaved')
     * - 'disabled': No reasoning preserved (fastest, but loses thinking context)
     * - 'interleaved': GLM-4.7's killer feature - model thinks BEFORE each tool call
     * - 'preserved': Full reasoning preserved across user turns (best for complex multi-turn)
     */
    history: ReasoningHistory;
    /**
     * Auto-adjust reasoning based on task complexity (default: true)
     * When true, overrides effort/history based on detected task type
     */
    autoAdjust: boolean;
  };
}

/**
 * Default Fireworks configuration
 */
const DEFAULT_FIREWORKS_CONFIG: Partial<FireworksConfig> = {
  ...DEFAULT_LLM_CONFIG,
  baseURL: 'https://api.fireworks.ai/inference/v1',
  // Using GLM-4.7 Thinking - #1 ranked open-source LLM (Jan 2026)
  // 95% AIME 2025, 89% LiveCodeBench, best-in-class reasoning
  // "Thinking" mode enables step-by-step problem decomposition
  model: FIREWORKS_MODELS.TEXT_THINKING,
  maxTokens: 8000, // Allow extended thinking for complex reasoning
  temperature: 0.7, // Optimal for reasoning tasks
  lowLatencyStreaming: true, // Enable low-latency mode by default
  enableSmartRouting: true, // Enable smart routing by default
  budgetMode: false,
  // GLM-4.7 Reasoning: Enable interleaved thinking by default
  // This is what makes GLM-4.7 superior for agentic workflows
  reasoning: {
    effort: 'medium',           // Balanced reasoning depth
    history: 'interleaved',     // Think before EACH tool call (killer feature)
    autoAdjust: true,           // Auto-adjust based on task complexity
  },
};

/**
 * Fireworks AI LLM Provider
 * Implements streaming chat completions using the OpenAI-compatible API
 */
export class FireworksLLM extends EventEmitter implements LLMProvider {
  readonly name = 'fireworks';
  private _status: LLMStatus = LLMStatus.IDLE;
  private config: FireworksConfig;
  private client: OpenAI;
  private abortController: AbortController | null = null;
  private currentContext: ConversationContext | null = null;

  constructor(config: Partial<FireworksConfig> = {}) {
    super();
    this.setMaxListeners(20); // Prevent memory leak warnings
    this.config = { ...DEFAULT_FIREWORKS_CONFIG, ...config } as FireworksConfig;

    if (!this.config.apiKey) {
      throw new Error(
        'Fireworks API key is required. Set FIREWORKS_API_KEY in your environment or pass it in the configuration.'
      );
    }

    // Initialize OpenAI client with Fireworks endpoint
    this.client = new OpenAI({
      apiKey: this.config.apiKey,
      baseURL: this.config.baseURL,
      timeout: this.config.timeout,
    });

    logger.info('FireworksLLM initialized', { model: this.config.model });
  }

  /**
   * Get current status
   */
  get status(): LLMStatus {
    return this._status;
  }

  /**
   * Set status and emit event
   */
  private setStatus(status: LLMStatus): void {
    if (this._status !== status) {
      const previousStatus = this._status;
      this._status = status;
      logger.debug('Status changed', { from: previousStatus, to: status });
      this.emit('status', status);
    }
  }

  /**
   * Get reasoning configuration based on task complexity
   * GLM-4.7's Interleaved Thinking: Model reasons BEFORE each tool call
   * 
   * Strategy:
   * - Complex tasks + tools → High effort + Interleaved (max reasoning)
   * - Complex tasks (no tools) → High effort + Preserved (carry reasoning across turns)
   * - Medium tasks + tools → Medium effort + Interleaved
   * - Simple tasks → Low effort + Disabled (fast responses)
   * 
   * @param taskType The detected task type (coding, analysis, etc.)
   * @param complexityScore 0-1 complexity score
   * @param hasTools Whether tools are available for this request
   * @returns Reasoning configuration for the API request
   */
  private getReasoningConfig(
    taskType: string,
    complexityScore: number,
    hasTools: boolean
  ): { enabled: boolean; effort: ReasoningEffort; history: ReasoningHistory } {
    const config = this.config.reasoning;
    
    // If auto-adjust is disabled, use configured values directly
    if (!config?.autoAdjust) {
      return {
        enabled: config?.effort !== undefined,
        effort: config?.effort || 'medium',
        history: config?.history || 'interleaved',
      };
    }

    // Complex reasoning tasks (coding, analysis, debugging, research)
    const complexTasks = ['coding', 'analysis', 'debugging', 'research', 'factual'];
    const isComplexTask = complexTasks.includes(taskType) || complexityScore >= 0.7;
    
    // High complexity + tools = maximum reasoning (interleaved thinking)
    if (isComplexTask && hasTools) {
      return {
        enabled: true,
        effort: 'high',
        history: 'interleaved', // GLM-4.7's killer feature: think before EACH tool call
      };
    }
    
    // High complexity, no tools = preserved thinking across turns
    if (isComplexTask) {
      return {
        enabled: true,
        effort: complexityScore >= 0.8 ? 'high' : 'medium',
        history: 'preserved', // Carry reasoning context across user turns
      };
    }
    
    // Medium complexity with tools = interleaved but medium effort
    if (hasTools && complexityScore >= 0.4) {
      return {
        enabled: true,
        effort: 'medium',
        history: 'interleaved',
      };
    }
    
    // Simple tasks = low effort or disabled for speed
    if (complexityScore < 0.3) {
      return {
        enabled: false,
        effort: 'low',
        history: 'disabled',
      };
    }
    
    // Default: medium effort, interleaved for tool support
    return {
      enabled: true,
      effort: 'medium',
      history: hasTools ? 'interleaved' : 'preserved',
    };
  }

  /**
   * Build system prompt with variables and optional task-aware modifier
   */
  private buildSystemPrompt(context?: ConversationContext, taskModifier?: string): string {
    const template = context?.systemPrompt || ATLAS_SYSTEM_PROMPT;
    const userName = context?.userName || 'User';
    const timestamp = new Date().toLocaleString();

    let systemPrompt = template.replace('{timestamp}', timestamp).replace('{userName}', userName);

    // Append task-aware modifier if provided (anti-hallucination instructions)
    if (taskModifier) {
      systemPrompt += `\n\n## Current Task Configuration\n${taskModifier}`;
    }

    return systemPrompt;
  }

  /**
   * Build messages array for API call
   * Now supports task-aware system modifier for anti-hallucination
   */
  private buildMessages(
    userMessage: string,
    context?: ConversationContext,
    taskModifier?: string
  ): ChatCompletionMessageParam[] {
    const messages: ChatCompletionMessageParam[] = [];

    // Add system prompt with task-aware modifier
    messages.push({
      role: 'system',
      content: this.buildSystemPrompt(context, taskModifier),
    });

    // Add conversation history
    if (context?.messages) {
      for (const msg of context.messages) {
        if (msg.role === 'tool' && msg.tool_call_id) {
          // Tool response message
          messages.push({
            role: 'tool',
            content: msg.content,
            tool_call_id: msg.tool_call_id,
          });
        } else if (msg.role === 'assistant') {
          // Assistant message, possibly with tool calls AND reasoning_content
          // GLM-4.7 Interleaved Thinking: reasoning_content must be preserved
          // for the model to maintain its thinking context across tool calls
          const assistantMsg: ChatCompletionMessageParam & { reasoning_content?: string } = {
            role: 'assistant',
            content: msg.content,
          };
          
          // Include reasoning_content if present (GLM-4.7 interleaved/preserved thinking)
          // This is critical for maintaining reasoning context across turns
          if (msg.reasoning_content) {
            assistantMsg.reasoning_content = msg.reasoning_content;
          }
          
          if (msg.tool_calls && msg.tool_calls.length > 0) {
            (
              assistantMsg as {
                role: 'assistant';
                content: string;
                reasoning_content?: string;
                tool_calls?: OpenAI.Chat.ChatCompletionMessageToolCall[];
              }
            ).tool_calls = msg.tool_calls.map((tc) => ({
              id: tc.id,
              type: 'function' as const,
              function: {
                name: tc.function.name,
                arguments: tc.function.arguments,
              },
            }));
          }
          messages.push(assistantMsg);
        } else if (msg.role === 'user') {
          messages.push({
            role: 'user',
            content: msg.content,
          });
        }
      }
    }

    // Add new user message
    messages.push({
      role: 'user',
      content: userMessage,
    });

    return messages;
  }

  /**
   * Send a message and get response (non-streaming)
   * Now uses task-aware configuration for optimal parameters
   */
  async chat(
    message: string,
    context?: ConversationContext,
    options?: ChatOptions
  ): Promise<LLMResponse> {
    this.setStatus(LLMStatus.CONNECTING);
    perfTimer.start('chat');

    const startTime = Date.now();

    try {
      // Smart model routing with task-aware parameters
      let selectedModel = this.config.model!;
      let selectedMaxTokens = this.config.maxTokens!;
      let selectedTemperature = this.config.temperature!;
      let selectedTopP = this.config.topP!;
      let selectedFrequencyPenalty = this.config.frequencyPenalty!;
      let selectedPresencePenalty = this.config.presencePenalty!;
      let systemModifier = '';
      let taskType = 'general';
      let complexityScore = 0.5;

      if (this.config.enableSmartRouting) {
        const router = getSmartRouter({ budgetMode: this.config.budgetMode });
        
        // Use task-aware params for comprehensive optimization
        const taskAwareParams = router.getTaskAwareParams(message, {
          toolsRequired: !!options?.tools?.length,
          conversationLength: context?.messages?.length,
        });

        selectedModel = taskAwareParams.model;
        selectedMaxTokens = taskAwareParams.maxTokens;
        selectedTemperature = taskAwareParams.temperature;
        selectedTopP = taskAwareParams.topP;
        selectedFrequencyPenalty = taskAwareParams.frequencyPenalty;
        selectedPresencePenalty = taskAwareParams.presencePenalty;
        systemModifier = taskAwareParams.systemModifier;
        taskType = taskAwareParams.taskType;
        complexityScore = taskAwareParams.complexity.score;

        logger.debug('Task-aware routing selected parameters', {
          originalModel: this.config.model,
          selectedModel,
          taskType: taskAwareParams.taskType,
          complexity: taskAwareParams.complexity.score,
          category: taskAwareParams.complexity.category,
          temperature: selectedTemperature,
          reason: taskAwareParams.complexity.reasoning,
        });
      }

      // Build messages with task-aware system modifier
      const messages = this.buildMessages(message, context, systemModifier);

      // Determine reasoning parameters based on task complexity
      // GLM-4.7's killer feature: interleaved thinking (reasons before EACH tool call)
      const reasoningConfig = this.getReasoningConfig(taskType, complexityScore, !!options?.tools?.length);

      logger.debug('Sending chat request', {
        model: selectedModel,
        messageCount: messages.length,
        hasTools: !!options?.tools?.length,
        temperature: selectedTemperature,
        reasoning: reasoningConfig,
      });

      this.setStatus(LLMStatus.GENERATING);

      // Build request parameters with task-aware settings
      // Using type assertion for Fireworks-specific parameters (reasoning_effort, reasoning_history)
      const requestParams = {
        model: selectedModel,
        messages,
        max_tokens: selectedMaxTokens,
        temperature: selectedTemperature,
        top_p: selectedTopP,
        frequency_penalty: selectedFrequencyPenalty,
        presence_penalty: selectedPresencePenalty,
        stop: this.config.stop,
        stream: false,
        // GLM-4.7 Reasoning Parameters (Fireworks-specific)
        // These enable the model's advanced thinking capabilities
        ...(reasoningConfig.enabled && {
          reasoning_effort: reasoningConfig.effort,
          reasoning_history: reasoningConfig.history,
        }),
      } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming;

      // Add tools if provided
      if (options?.tools && options.tools.length > 0) {
        requestParams.tools = options.tools as ChatCompletionTool[];
        if (options.tool_choice) {
          requestParams.tool_choice = options.tool_choice;
        }
      }

      const response = await withRetry(
        async () => {
          this.abortController = new AbortController();
          return this.client.chat.completions.create(requestParams, {
            signal: this.abortController.signal,
          });
        },
        {
          maxAttempts: 3,
          initialDelayMs: 1000,
          onRetry: (attempt, error) => {
            logger.warn(`Chat attempt ${attempt} failed`, { error: error.message });
          },
        }
      );

      const latency = Date.now() - startTime;
      perfTimer.end('chat');

      const content = response.choices[0]?.message?.content || '';
      const finishReason = response.choices[0]?.finish_reason as LLMResponse['finishReason'];
      
      // Extract reasoning_content from GLM-4.7 response (Fireworks-specific field)
      // This contains the model's internal reasoning/thinking process
      const responseMessage = response.choices[0]?.message as {
        content: string | null;
        role: string;
        tool_calls?: unknown[];
        reasoning_content?: string;
      };
      const reasoningContent = responseMessage?.reasoning_content;

      // Extract tool calls if present
      const rawToolCalls = response.choices[0]?.message?.tool_calls;
      const toolCalls = rawToolCalls
        ?.map((tc) => {
          if (tc.type === 'function') {
            return {
              id: tc.id,
              type: 'function' as const,
              function: {
                name: tc.function.name,
                arguments: tc.function.arguments,
              },
            };
          }
          return null;
        })
        .filter((tc): tc is ToolCall => tc !== null);

      const result: LLMResponse = {
        content,
        model: response.model,
        finishReason,
        usage: response.usage
          ? {
              promptTokens: response.usage.prompt_tokens,
              completionTokens: response.usage.completion_tokens,
              totalTokens: response.usage.total_tokens,
            }
          : undefined,
        latency,
        raw: response,
        toolCalls,
        // Include reasoning_content for preserved/interleaved thinking
        reasoningContent,
      };

      // Update context if provided (and no tool calls - tool results should be added separately)
      if (context && !toolCalls?.length) {
        this.updateContext(context, message, content, result.usage?.totalTokens, reasoningContent);
      }

      logger.info('Chat response received', {
        latency,
        tokens: result.usage?.totalTokens,
        finishReason,
        toolCallsCount: toolCalls?.length || 0,
        hasReasoning: !!reasoningContent,
      });

      this.setStatus(LLMStatus.IDLE);
      this.emit('response', result);
      return result;
    } catch (error) {
      perfTimer.end('chat');
      this.setStatus(LLMStatus.ERROR);

      const apiError = new APIError(
        `Fireworks chat failed: ${(error as Error).message}`,
        'fireworks',
        undefined,
        { error: (error as Error).message }
      );

      logger.error('Chat failed', { error: (error as Error).message });
      this.emit('error', apiError);
      throw apiError;
    } finally {
      this.abortController = null;
    }
  }

  /**
   * Send a message with streaming response
   */
  async *chatStream(
    message: string,
    context?: ConversationContext,
    options?: ChatOptions
  ): AsyncGenerator<LLMStreamChunk> {
    this.setStatus(LLMStatus.CONNECTING);
    perfTimer.start('chatStream');

    const startTime = Date.now();
    let accumulated = '';
    let firstChunkReceived = false;

    // Track tool calls during streaming
    const toolCallsInProgress: Map<number, { id: string; name: string; arguments: string }> =
      new Map();

    try {
      // Smart model routing with task-aware parameters
      let selectedModel = this.config.model!;
      let selectedMaxTokens = this.config.maxTokens!;
      let selectedTemperature = this.config.temperature!;
      let selectedTopP = this.config.topP!;
      let selectedFrequencyPenalty = this.config.frequencyPenalty!;
      let selectedPresencePenalty = this.config.presencePenalty!;
      let systemModifier = '';
      let taskType = 'general';
      let complexityScore = 0.5;

      if (this.config.enableSmartRouting) {
        const router = getSmartRouter({ budgetMode: this.config.budgetMode });
        
        // Use task-aware params for comprehensive optimization
        const taskAwareParams = router.getTaskAwareParams(message, {
          toolsRequired: !!options?.tools?.length,
          conversationLength: context?.messages?.length,
        });

        selectedModel = taskAwareParams.model;
        selectedMaxTokens = taskAwareParams.maxTokens;
        selectedTemperature = taskAwareParams.temperature;
        selectedTopP = taskAwareParams.topP;
        selectedFrequencyPenalty = taskAwareParams.frequencyPenalty;
        selectedPresencePenalty = taskAwareParams.presencePenalty;
        systemModifier = taskAwareParams.systemModifier;
        taskType = taskAwareParams.taskType;
        complexityScore = taskAwareParams.complexity.score;

        logger.debug('Task-aware routing (stream) selected parameters', {
          originalModel: this.config.model,
          selectedModel,
          taskType: taskAwareParams.taskType,
          complexity: taskAwareParams.complexity.score,
          category: taskAwareParams.complexity.category,
          temperature: selectedTemperature,
        });
      }

      // Build messages with task-aware system modifier
      const messages = this.buildMessages(message, context, systemModifier);

      // Determine reasoning parameters based on task complexity
      // GLM-4.7's killer feature: interleaved thinking (reasons before EACH tool call)
      const reasoningConfig = this.getReasoningConfig(taskType, complexityScore, !!options?.tools?.length);

      logger.debug('Starting streaming chat', {
        model: selectedModel,
        messageCount: messages.length,
        hasTools: !!options?.tools?.length,
        temperature: selectedTemperature,
        reasoning: reasoningConfig,
      });

      this.abortController = new AbortController();

      // Build request parameters with task-aware settings and streaming optimizations
      // Using type assertion for Fireworks-specific parameters (reasoning_effort, reasoning_history)
      const requestParams = {
        model: selectedModel,
        messages,
        max_tokens: selectedMaxTokens,
        temperature: selectedTemperature,
        top_p: selectedTopP,
        frequency_penalty: selectedFrequencyPenalty,
        presence_penalty: selectedPresencePenalty,
        stop: this.config.stop,
        stream: true,
        // Enable streaming options for lower latency
        stream_options: this.config.lowLatencyStreaming
          ? { include_usage: false } // Skip usage stats in stream for faster delivery
          : undefined,
        // GLM-4.7 Reasoning Parameters (Fireworks-specific)
        // These enable the model's advanced thinking capabilities
        ...(reasoningConfig.enabled && {
          reasoning_effort: reasoningConfig.effort,
          reasoning_history: reasoningConfig.history,
        }),
      } as OpenAI.Chat.ChatCompletionCreateParamsStreaming;

      // Add tools if provided
      if (options?.tools && options.tools.length > 0) {
        requestParams.tools = options.tools as ChatCompletionTool[];
        if (options.tool_choice) {
          requestParams.tool_choice = options.tool_choice;
        }
      }

      // Create stream with optimized fetch settings
      const stream = await this.client.chat.completions.create(requestParams, {
        signal: this.abortController.signal,
      });

      this.setStatus(LLMStatus.STREAMING);

      // Track accumulated reasoning content during streaming
      let accumulatedReasoning = '';

      for await (const chunk of stream) {
        if (!firstChunkReceived) {
          firstChunkReceived = true;
          const timeToFirstChunk = Date.now() - startTime;
          logger.info('First chunk received', { timeToFirstChunk });
        }

        const delta = chunk.choices[0]?.delta?.content || '';
        const finishReason = chunk.choices[0]?.finish_reason as LLMStreamChunk['finishReason'];

        // Extract reasoning_content delta from GLM-4.7 streaming response (Fireworks-specific)
        const chunkDelta = chunk.choices[0]?.delta as {
          content?: string;
          tool_calls?: unknown[];
          reasoning_content?: string;
        };
        const reasoningDelta = chunkDelta?.reasoning_content || '';
        if (reasoningDelta) {
          accumulatedReasoning += reasoningDelta;
        }

        // Track tool calls during streaming
        const toolCallDeltas = chunk.choices[0]?.delta?.tool_calls;
        if (toolCallDeltas) {
          for (const tc of toolCallDeltas) {
            const index = tc.index;
            if (!toolCallsInProgress.has(index)) {
              toolCallsInProgress.set(index, {
                id: tc.id || '',
                name: tc.function?.name || '',
                arguments: '',
              });
            }
            const existing = toolCallsInProgress.get(index)!;
            if (tc.id) existing.id = tc.id;
            if (tc.function?.name) existing.name = tc.function.name;
            if (tc.function?.arguments) existing.arguments += tc.function.arguments;
          }
        }

        if (delta) {
          accumulated += delta;
        }

        // Build accumulated tool calls
        const accumulatedToolCalls: ToolCall[] = Array.from(toolCallsInProgress.values()).map(
          (tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.name,
              arguments: tc.arguments,
            },
          })
        );

        const streamChunk: LLMStreamChunk = {
          delta,
          accumulated,
          isFinal: finishReason !== null && finishReason !== undefined,
          finishReason,
          toolCalls: accumulatedToolCalls.length > 0 ? accumulatedToolCalls : undefined,
          // Include reasoning content for GLM-4.7 interleaved thinking
          reasoningDelta: reasoningDelta || undefined,
          reasoningAccumulated: accumulatedReasoning || undefined,
        };

        this.emit('chunk', streamChunk);
        yield streamChunk;

        if (streamChunk.isFinal) {
          break;
        }
      }

      const latency = Date.now() - startTime;
      perfTimer.end('chatStream');

      // Build final tool calls
      const finalToolCalls: ToolCall[] = Array.from(toolCallsInProgress.values()).map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: {
          name: tc.name,
          arguments: tc.arguments,
        },
      }));

      // Update context if provided (and no tool calls - tool results should be added separately)
      // Include accumulated reasoning_content for preserved thinking
      if (context && finalToolCalls.length === 0) {
        const estimatedTokens = estimateTokenCount(message + accumulated);
        this.updateContext(context, message, accumulated, estimatedTokens, accumulatedReasoning || undefined);
      }

      // Determine finish reason
      const finalFinishReason = finalToolCalls.length > 0 ? 'tool_calls' : 'stop';

      // Emit final response
      const response: LLMResponse = {
        content: accumulated,
        model: this.config.model!,
        finishReason: finalFinishReason,
        latency,
        usage: {
          promptTokens: estimateTokenCount(
            messages.map((m) => (m as { content?: string }).content || '').join('')
          ),
          completionTokens: estimateTokenCount(accumulated),
          totalTokens: estimateTokenCount(
            messages.map((m) => (m as { content?: string }).content || '').join('') + accumulated
          ),
        },
        toolCalls: finalToolCalls.length > 0 ? finalToolCalls : undefined,
      };

      logger.info('Streaming complete', {
        latency,
        tokens: response.usage?.totalTokens,
        length: accumulated.length,
        toolCallsCount: finalToolCalls.length,
      });

      this.setStatus(LLMStatus.IDLE);
      this.emit('response', response);
    } catch (error) {
      perfTimer.end('chatStream');

      // Check if it was cancelled
      if ((error as Error).name === 'AbortError') {
        logger.info('Streaming cancelled');
        this.setStatus(LLMStatus.IDLE);
        return;
      }

      this.setStatus(LLMStatus.ERROR);

      const apiError = new APIError(
        `Fireworks streaming failed: ${(error as Error).message}`,
        'fireworks',
        undefined,
        { error: (error as Error).message }
      );

      logger.error('Streaming failed', { error: (error as Error).message });
      this.emit('error', apiError);
      throw apiError;
    } finally {
      this.abortController = null;
    }
  }

  /**
   * Update conversation context with new messages
   * @param reasoningContent GLM-4.7 reasoning content to preserve for interleaved/preserved thinking
   */
  private updateContext(
    context: ConversationContext,
    userMessage: string,
    assistantResponse: string,
    tokens?: number,
    reasoningContent?: string
  ): void {
    // Add user message
    context.messages.push({
      role: 'user',
      content: userMessage,
      timestamp: Date.now(),
      tokens: estimateTokenCount(userMessage),
    });

    // Add assistant response with reasoning_content for GLM-4.7 preserved thinking
    context.messages.push({
      role: 'assistant',
      content: assistantResponse,
      timestamp: Date.now(),
      tokens: estimateTokenCount(assistantResponse),
      // Include reasoning_content for preserved/interleaved thinking across turns
      // This is critical for GLM-4.7 to maintain its reasoning context
      reasoning_content: reasoningContent,
    });

    // Update metadata
    context.updatedAt = Date.now();
    if (tokens) {
      context.totalTokens += tokens;
    }

    // Trim old messages if context is too large (keep ~8000 tokens)
    const maxContextTokens = 8000;
    while (context.totalTokens > maxContextTokens && context.messages.length > 2) {
      const removed = context.messages.shift();
      if (removed?.tokens) {
        context.totalTokens -= removed.tokens;
      }
    }

    this.currentContext = context;
    this.emit('contextUpdate', context);
  }

  /**
   * Cancel ongoing generation
   */
  cancel(): void {
    if (this.abortController) {
      logger.info('Cancelling generation');
      this.abortController.abort();
      this.abortController = null;
      this.setStatus(LLMStatus.IDLE);
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): LLMConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<FireworksConfig>): void {
    this.config = { ...this.config, ...config };

    // Recreate client if baseURL or apiKey changed
    if (config.baseURL || config.apiKey) {
      this.client = new OpenAI({
        apiKey: this.config.apiKey,
        baseURL: this.config.baseURL,
        timeout: this.config.timeout,
      });
    }

    logger.info('Configuration updated', { model: this.config.model });
  }

  /**
   * Estimate tokens for text
   */
  estimateTokens(text: string): number {
    return estimateTokenCount(text);
  }

  /**
   * Get current conversation context
   */
  getCurrentContext(): ConversationContext | null {
    return this.currentContext;
  }

  /**
   * Create a new conversation context
   */
  createContext(userName?: string): ConversationContext {
    const context = createConversationContext(ATLAS_SYSTEM_PROMPT, userName);
    this.currentContext = context;
    return context;
  }

  /**
   * Clear conversation context
   */
  clearContext(): void {
    this.currentContext = null;
    logger.info('Conversation context cleared');
  }

  // Type-safe event emitter methods
  on<K extends keyof LLMEvents>(event: K, listener: LLMEvents[K]): this {
    return super.on(event, listener);
  }

  off<K extends keyof LLMEvents>(event: K, listener: LLMEvents[K]): this {
    return super.off(event, listener);
  }

  emit<K extends keyof LLMEvents>(event: K, ...args: Parameters<LLMEvents[K]>): boolean {
    return super.emit(event, ...args);
  }
}

/**
 * Create a FireworksLLM instance with API key
 */
export function createFireworksLLM(
  apiKey: string,
  config?: Partial<FireworksConfig>
): FireworksLLM {
  return new FireworksLLM({ apiKey, ...config });
}

export default FireworksLLM;
