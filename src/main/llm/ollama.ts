/**
 * Atlas Desktop - Ollama LLM Provider
 * Local LLM integration using Ollama (OpenAI-compatible API)
 *
 * Ollama provides local inference for running LLMs on-device.
 * This provider enables fully offline operation when combined with
 * Vosk (STT) and system TTS.
 *
 * @module llm/ollama
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

const logger = createModuleLogger('OllamaLLM');
const perfTimer = new PerformanceTimer('OllamaLLM');

/**
 * Ollama-specific configuration options
 */
export interface OllamaConfig extends LLMConfig {
  /** Ollama model name (e.g., 'llama3.2', 'mistral', 'phi3') */
  model?: string;
  /** Keep model loaded in memory between requests */
  keepAlive?: string;
  /** Number of threads to use (0 = auto) */
  numThread?: number;
  /** Number of GPU layers to offload (-1 = all) */
  numGpu?: number;
  /** Context window size */
  numCtx?: number;
}

/**
 * Default Ollama configuration
 */
const DEFAULT_OLLAMA_CONFIG: Partial<OllamaConfig> = {
  ...DEFAULT_LLM_CONFIG,
  baseURL: 'http://localhost:11434/v1',
  model: 'llama3.2',
  maxTokens: 2048,
  temperature: 0.7,
  timeout: 120000, // 2 minutes for local inference
  keepAlive: '5m', // Keep model loaded for 5 minutes
};

/**
 * Ollama availability status
 */
export interface OllamaStatus {
  available: boolean;
  version?: string;
  models?: string[];
  error?: string;
}

/**
 * Ollama LLM Provider
 * Implements chat completions using Ollama's OpenAI-compatible API
 */
export class OllamaLLM extends EventEmitter implements LLMProvider {
  readonly name = 'ollama';
  private _status: LLMStatus = LLMStatus.IDLE;
  private config: OllamaConfig;
  private client: OpenAI;
  private abortController: AbortController | null = null;
  private currentContext: ConversationContext | null = null;
  private isAvailable: boolean = false;

  constructor(config: Partial<OllamaConfig> = {}) {
    super();
    this.config = { ...DEFAULT_OLLAMA_CONFIG, ...config } as OllamaConfig;

    // Initialize OpenAI client with Ollama endpoint
    // Note: Ollama doesn't require an API key
    this.client = new OpenAI({
      apiKey: 'ollama', // Placeholder - Ollama doesn't require auth
      baseURL: this.config.baseURL,
      timeout: this.config.timeout,
    });

    logger.info('OllamaLLM initialized', {
      model: this.config.model,
      baseURL: this.config.baseURL,
    });
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
   * Check if Ollama is available and running
   */
  async checkAvailability(): Promise<OllamaStatus> {
    try {
      // Extract base URL without /v1 for the root endpoint
      const baseUrl = this.config.baseURL?.replace(/\/v1\/?$/, '') || 'http://localhost:11434';

      // Check Ollama root endpoint
      const response = await fetch(baseUrl, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });

      if (response.ok) {
        const text = await response.text();
        this.isAvailable = true;

        // Try to get available models
        const modelsResponse = await fetch(`${baseUrl}/api/tags`, {
          method: 'GET',
          signal: AbortSignal.timeout(5000),
        });

        let models: string[] = [];
        if (modelsResponse.ok) {
          const modelsData = await modelsResponse.json();
          models = modelsData.models?.map((m: { name: string }) => m.name) || [];
        }

        logger.info('Ollama is available', { models: models.length });
        return {
          available: true,
          version: text.includes('Ollama') ? text : undefined,
          models,
        };
      }

      this.isAvailable = false;
      return {
        available: false,
        error: `Ollama returned status ${response.status}`,
      };
    } catch (error) {
      this.isAvailable = false;
      const errorMessage = (error as Error).message;
      logger.warn('Ollama not available', { error: errorMessage });
      return {
        available: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Check if the configured model is available
   */
  async isModelAvailable(): Promise<boolean> {
    const status = await this.checkAvailability();
    if (!status.available || !status.models) {
      return false;
    }
    return status.models.some(
      (m) => m === this.config.model || m.startsWith(`${this.config.model}:`)
    );
  }

  /**
   * Pull a model if not available
   */
  async pullModel(modelName?: string): Promise<boolean> {
    const model = modelName || this.config.model;
    if (!model) {
      return false;
    }

    try {
      const baseUrl = this.config.baseURL?.replace(/\/v1\/?$/, '') || 'http://localhost:11434';

      logger.info('Pulling model', { model });

      const response = await fetch(`${baseUrl}/api/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: model, stream: false }),
        signal: AbortSignal.timeout(600000), // 10 minute timeout for model download
      });

      if (response.ok) {
        logger.info('Model pulled successfully', { model });
        return true;
      }

      logger.error('Failed to pull model', { model, status: response.status });
      return false;
    } catch (error) {
      logger.error('Error pulling model', { model, error: (error as Error).message });
      return false;
    }
  }

  /**
   * Build system prompt with variables
   */
  private buildSystemPrompt(context?: ConversationContext): string {
    const template = context?.systemPrompt || ATLAS_SYSTEM_PROMPT;
    const userName = context?.userName || 'User';
    const timestamp = new Date().toLocaleString();

    // Add local-only context to system prompt
    const localContext = `\n\nNote: You are running locally via Ollama. All processing is happening on-device.`;

    return template.replace('{timestamp}', timestamp).replace('{userName}', userName) + localContext;
  }

  /**
   * Build messages array for API call
   */
  private buildMessages(
    userMessage: string,
    context?: ConversationContext
  ): ChatCompletionMessageParam[] {
    const messages: ChatCompletionMessageParam[] = [];

    // Add system prompt
    messages.push({
      role: 'system',
      content: this.buildSystemPrompt(context),
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
          // Assistant message, possibly with tool calls
          const assistantMsg: ChatCompletionMessageParam = {
            role: 'assistant',
            content: msg.content,
          };
          if (msg.tool_calls && msg.tool_calls.length > 0) {
            (
              assistantMsg as {
                role: 'assistant';
                content: string;
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
   */
  async chat(
    message: string,
    context?: ConversationContext,
    options?: ChatOptions
  ): Promise<LLMResponse> {
    // Check availability first
    if (!this.isAvailable) {
      const status = await this.checkAvailability();
      if (!status.available) {
        throw new Error(`Ollama is not available: ${status.error}`);
      }
    }

    this.setStatus(LLMStatus.CONNECTING);
    perfTimer.start('chat');

    const startTime = Date.now();

    try {
      const messages = this.buildMessages(message, context);

      logger.debug('Sending chat request', {
        model: this.config.model,
        messageCount: messages.length,
        hasTools: !!options?.tools?.length,
      });

      this.setStatus(LLMStatus.GENERATING);

      // Build request parameters
      const requestParams: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
        model: this.config.model!,
        messages,
        max_tokens: this.config.maxTokens,
        temperature: this.config.temperature,
        top_p: this.config.topP,
        frequency_penalty: this.config.frequencyPenalty,
        presence_penalty: this.config.presencePenalty,
        stop: this.config.stop,
        stream: false,
      };

      // Add tools if provided (note: not all Ollama models support tools)
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
          maxAttempts: 2, // Fewer retries for local inference
          initialDelayMs: 500,
          onRetry: (attempt, error) => {
            logger.warn(`Chat attempt ${attempt} failed`, { error: error.message });
          },
        }
      );

      const latency = Date.now() - startTime;
      perfTimer.end('chat');

      const content = response.choices[0]?.message?.content || '';
      const finishReason = response.choices[0]?.finish_reason as LLMResponse['finishReason'];

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
      };

      // Update context if provided (and no tool calls)
      if (context && !toolCalls?.length) {
        this.updateContext(context, message, content, result.usage?.totalTokens);
      }

      logger.info('Chat response received', {
        latency,
        tokens: result.usage?.totalTokens,
        finishReason,
        toolCallsCount: toolCalls?.length || 0,
      });

      this.setStatus(LLMStatus.IDLE);
      this.emit('response', result);
      return result;
    } catch (error) {
      perfTimer.end('chat');
      this.setStatus(LLMStatus.ERROR);

      const apiError = new APIError(
        `Ollama chat failed: ${(error as Error).message}`,
        'ollama',
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
    // Check availability first
    if (!this.isAvailable) {
      const status = await this.checkAvailability();
      if (!status.available) {
        throw new Error(`Ollama is not available: ${status.error}`);
      }
    }

    this.setStatus(LLMStatus.CONNECTING);
    perfTimer.start('chatStream');

    const startTime = Date.now();
    let accumulated = '';
    let firstChunkReceived = false;

    // Track tool calls during streaming
    const toolCallsInProgress: Map<number, { id: string; name: string; arguments: string }> =
      new Map();

    try {
      const messages = this.buildMessages(message, context);

      logger.debug('Starting streaming chat', {
        model: this.config.model,
        messageCount: messages.length,
        hasTools: !!options?.tools?.length,
      });

      this.abortController = new AbortController();

      // Build request parameters
      const requestParams: OpenAI.Chat.ChatCompletionCreateParamsStreaming = {
        model: this.config.model!,
        messages,
        max_tokens: this.config.maxTokens,
        temperature: this.config.temperature,
        top_p: this.config.topP,
        frequency_penalty: this.config.frequencyPenalty,
        presence_penalty: this.config.presencePenalty,
        stop: this.config.stop,
        stream: true,
      };

      // Add tools if provided
      if (options?.tools && options.tools.length > 0) {
        requestParams.tools = options.tools as ChatCompletionTool[];
        if (options.tool_choice) {
          requestParams.tool_choice = options.tool_choice;
        }
      }

      // Create stream
      const stream = await this.client.chat.completions.create(requestParams, {
        signal: this.abortController.signal,
      });

      this.setStatus(LLMStatus.STREAMING);

      for await (const chunk of stream) {
        if (!firstChunkReceived) {
          firstChunkReceived = true;
          const timeToFirstChunk = Date.now() - startTime;
          logger.info('First chunk received', { timeToFirstChunk });
        }

        const delta = chunk.choices[0]?.delta?.content || '';
        const finishReason = chunk.choices[0]?.finish_reason as LLMStreamChunk['finishReason'];

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

      // Update context if provided (and no tool calls)
      if (context && finalToolCalls.length === 0) {
        const estimatedTokens = estimateTokenCount(message + accumulated);
        this.updateContext(context, message, accumulated, estimatedTokens);
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
        `Ollama streaming failed: ${(error as Error).message}`,
        'ollama',
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
   */
  private updateContext(
    context: ConversationContext,
    userMessage: string,
    assistantResponse: string,
    tokens?: number
  ): void {
    // Add user message
    context.messages.push({
      role: 'user',
      content: userMessage,
      timestamp: Date.now(),
      tokens: estimateTokenCount(userMessage),
    });

    // Add assistant response
    context.messages.push({
      role: 'assistant',
      content: assistantResponse,
      timestamp: Date.now(),
      tokens: estimateTokenCount(assistantResponse),
    });

    // Update metadata
    context.updatedAt = Date.now();
    if (tokens) {
      context.totalTokens += tokens;
    }

    // Trim old messages if context is too large (keep ~4000 tokens for local models)
    const maxContextTokens = 4000;
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
  updateConfig(config: Partial<OllamaConfig>): void {
    this.config = { ...this.config, ...config };

    // Recreate client if baseURL changed
    if (config.baseURL) {
      this.client = new OpenAI({
        apiKey: 'ollama',
        baseURL: this.config.baseURL,
        timeout: this.config.timeout,
      });
      // Reset availability check
      this.isAvailable = false;
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

// Singleton instance
let ollamaInstance: OllamaLLM | null = null;

/**
 * Get or create the Ollama LLM instance
 */
export function getOllamaLLM(config?: Partial<OllamaConfig>): OllamaLLM {
  if (!ollamaInstance) {
    ollamaInstance = new OllamaLLM(config);
  }
  return ollamaInstance;
}

/**
 * Shutdown the Ollama LLM instance
 */
export function shutdownOllamaLLM(): void {
  if (ollamaInstance) {
    ollamaInstance.cancel();
    ollamaInstance = null;
  }
}

/**
 * Check if Ollama is available on the system
 */
export async function checkOllamaAvailable(
  baseUrl: string = 'http://localhost:11434'
): Promise<OllamaStatus> {
  const temp = new OllamaLLM({ baseURL: `${baseUrl}/v1` });
  return temp.checkAvailability();
}

/**
 * Create an OllamaLLM instance
 */
export function createOllamaLLM(config?: Partial<OllamaConfig>): OllamaLLM {
  return new OllamaLLM(config);
}

export default OllamaLLM;
