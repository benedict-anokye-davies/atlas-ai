/**
 * Nova Desktop - Fireworks AI LLM Provider
 * LLM integration using Fireworks AI (OpenAI-compatible API)
 */

import { EventEmitter } from 'events';
import OpenAI from 'openai';
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
  DEFAULT_LLM_CONFIG,
  NOVA_SYSTEM_PROMPT,
  createConversationContext,
  estimateTokenCount,
} from '../../shared/types/llm';

const logger = createModuleLogger('FireworksLLM');
const perfTimer = new PerformanceTimer('FireworksLLM');

/**
 * Fireworks-specific configuration options
 */
export interface FireworksConfig extends LLMConfig {
  /** Fireworks model ID */
  model?: string;
}

/**
 * Default Fireworks configuration
 */
const DEFAULT_FIREWORKS_CONFIG: Partial<FireworksConfig> = {
  ...DEFAULT_LLM_CONFIG,
  baseURL: 'https://api.fireworks.ai/inference/v1',
  model: 'accounts/fireworks/models/deepseek-r1',
  maxTokens: 2048,
  temperature: 0.7,
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
    this.config = { ...DEFAULT_FIREWORKS_CONFIG, ...config } as FireworksConfig;

    if (!this.config.apiKey) {
      throw new Error('Fireworks API key is required');
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
   * Build system prompt with variables
   */
  private buildSystemPrompt(context?: ConversationContext): string {
    const template = context?.systemPrompt || NOVA_SYSTEM_PROMPT;
    const userName = context?.userName || 'User';
    const timestamp = new Date().toLocaleString();

    return template.replace('{timestamp}', timestamp).replace('{userName}', userName);
  }

  /**
   * Build messages array for API call
   */
  private buildMessages(
    userMessage: string,
    context?: ConversationContext
  ): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];

    // Add system prompt
    messages.push({
      role: 'system',
      content: this.buildSystemPrompt(context),
    });

    // Add conversation history
    if (context?.messages) {
      for (const msg of context.messages) {
        messages.push({
          role: msg.role as 'user' | 'assistant',
          content: msg.content,
        });
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
  async chat(message: string, context?: ConversationContext): Promise<LLMResponse> {
    this.setStatus(LLMStatus.CONNECTING);
    perfTimer.start('chat');

    const startTime = Date.now();

    try {
      const messages = this.buildMessages(message, context);

      logger.debug('Sending chat request', {
        model: this.config.model,
        messageCount: messages.length,
      });

      this.setStatus(LLMStatus.GENERATING);

      const response = await withRetry(
        async () => {
          this.abortController = new AbortController();

          return this.client.chat.completions.create(
            {
              model: this.config.model!,
              messages,
              max_tokens: this.config.maxTokens,
              temperature: this.config.temperature,
              top_p: this.config.topP,
              frequency_penalty: this.config.frequencyPenalty,
              presence_penalty: this.config.presencePenalty,
              stop: this.config.stop,
              stream: false,
            },
            { signal: this.abortController.signal }
          );
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
      };

      // Update context if provided
      if (context) {
        this.updateContext(context, message, content, result.usage?.totalTokens);
      }

      logger.info('Chat response received', {
        latency,
        tokens: result.usage?.totalTokens,
        finishReason,
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
    context?: ConversationContext
  ): AsyncGenerator<LLMStreamChunk> {
    this.setStatus(LLMStatus.CONNECTING);
    perfTimer.start('chatStream');

    const startTime = Date.now();
    let accumulated = '';
    let firstChunkReceived = false;

    try {
      const messages = this.buildMessages(message, context);

      logger.debug('Starting streaming chat', {
        model: this.config.model,
        messageCount: messages.length,
      });

      this.abortController = new AbortController();

      const stream = await this.client.chat.completions.create(
        {
          model: this.config.model!,
          messages,
          max_tokens: this.config.maxTokens,
          temperature: this.config.temperature,
          top_p: this.config.topP,
          frequency_penalty: this.config.frequencyPenalty,
          presence_penalty: this.config.presencePenalty,
          stop: this.config.stop,
          stream: true,
        },
        { signal: this.abortController.signal }
      );

      this.setStatus(LLMStatus.STREAMING);

      for await (const chunk of stream) {
        if (!firstChunkReceived) {
          firstChunkReceived = true;
          const timeToFirstChunk = Date.now() - startTime;
          logger.info('First chunk received', { timeToFirstChunk });
        }

        const delta = chunk.choices[0]?.delta?.content || '';
        const finishReason = chunk.choices[0]?.finish_reason as LLMStreamChunk['finishReason'];

        if (delta) {
          accumulated += delta;
        }

        const streamChunk: LLMStreamChunk = {
          delta,
          accumulated,
          isFinal: finishReason !== null && finishReason !== undefined,
          finishReason,
        };

        this.emit('chunk', streamChunk);
        yield streamChunk;

        if (streamChunk.isFinal) {
          break;
        }
      }

      const latency = Date.now() - startTime;
      perfTimer.end('chatStream');

      // Update context if provided
      if (context) {
        const estimatedTokens = estimateTokenCount(message + accumulated);
        this.updateContext(context, message, accumulated, estimatedTokens);
      }

      // Emit final response
      const response: LLMResponse = {
        content: accumulated,
        model: this.config.model!,
        finishReason: 'stop',
        latency,
        usage: {
          promptTokens: estimateTokenCount(messages.map((m) => m.content).join('')),
          completionTokens: estimateTokenCount(accumulated),
          totalTokens: estimateTokenCount(messages.map((m) => m.content).join('') + accumulated),
        },
      };

      logger.info('Streaming complete', {
        latency,
        tokens: response.usage?.totalTokens,
        length: accumulated.length,
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
    const context = createConversationContext(NOVA_SYSTEM_PROMPT, userName);
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
