/**
 * Atlas Desktop - OpenRouter LLM Provider
 * LLM fallback using OpenRouter (OpenAI-compatible API)
 * Provides access to multiple models: Claude, GPT-4, Llama, etc.
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
  ATLAS_SYSTEM_PROMPT,
  createConversationContext,
  estimateTokenCount,
} from '../../shared/types/llm';

const logger = createModuleLogger('OpenRouterLLM');
const perfTimer = new PerformanceTimer('OpenRouterLLM');

/**
 * OpenRouter model information
 */
export interface OpenRouterModel {
  id: string;
  name: string;
  contextLength: number;
  pricing: {
    prompt: number;    // $ per 1M tokens
    completion: number; // $ per 1M tokens
  };
  description: string;
}

/**
 * Available OpenRouter models
 */
export const OPENROUTER_MODELS: Record<string, OpenRouterModel> = {
  // Claude models
  'anthropic/claude-3.5-sonnet': {
    id: 'anthropic/claude-3.5-sonnet',
    name: 'Claude 3.5 Sonnet',
    contextLength: 200000,
    pricing: { prompt: 3, completion: 15 },
    description: 'Best balance of intelligence and speed',
  },
  'anthropic/claude-3-opus': {
    id: 'anthropic/claude-3-opus',
    name: 'Claude 3 Opus',
    contextLength: 200000,
    pricing: { prompt: 15, completion: 75 },
    description: 'Most capable Claude model',
  },
  'anthropic/claude-3-haiku': {
    id: 'anthropic/claude-3-haiku',
    name: 'Claude 3 Haiku',
    contextLength: 200000,
    pricing: { prompt: 0.25, completion: 1.25 },
    description: 'Fastest, most affordable Claude',
  },
  
  // OpenAI models
  'openai/gpt-4-turbo': {
    id: 'openai/gpt-4-turbo',
    name: 'GPT-4 Turbo',
    contextLength: 128000,
    pricing: { prompt: 10, completion: 30 },
    description: 'OpenAI flagship model',
  },
  'openai/gpt-4o': {
    id: 'openai/gpt-4o',
    name: 'GPT-4o',
    contextLength: 128000,
    pricing: { prompt: 5, completion: 15 },
    description: 'OpenAI optimized GPT-4',
  },
  'openai/gpt-4o-mini': {
    id: 'openai/gpt-4o-mini',
    name: 'GPT-4o Mini',
    contextLength: 128000,
    pricing: { prompt: 0.15, completion: 0.6 },
    description: 'Fast and affordable GPT-4',
  },
  
  // Open source models
  'meta-llama/llama-3.1-70b-instruct': {
    id: 'meta-llama/llama-3.1-70b-instruct',
    name: 'Llama 3.1 70B',
    contextLength: 131072,
    pricing: { prompt: 0.52, completion: 0.75 },
    description: 'Meta open source model',
  },
  'mistralai/mistral-large': {
    id: 'mistralai/mistral-large',
    name: 'Mistral Large',
    contextLength: 128000,
    pricing: { prompt: 2, completion: 6 },
    description: 'Mistral flagship model',
  },
  
  // DeepSeek
  'deepseek/deepseek-chat': {
    id: 'deepseek/deepseek-chat',
    name: 'DeepSeek Chat',
    contextLength: 64000,
    pricing: { prompt: 0.14, completion: 0.28 },
    description: 'DeepSeek v2.5 - excellent value',
  },
};

/**
 * Default OpenRouter model
 */
export const DEFAULT_OPENROUTER_MODEL = 'anthropic/claude-3.5-sonnet';

/**
 * OpenRouter-specific configuration options
 */
export interface OpenRouterConfig extends LLMConfig {
  /** OpenRouter model ID */
  model?: string;
  /** Site name for OpenRouter dashboard */
  siteName?: string;
  /** Site URL for OpenRouter dashboard */
  siteUrl?: string;
  /** Enable cost tracking */
  trackCosts?: boolean;
}

/**
 * Default OpenRouter configuration
 */
const DEFAULT_OPENROUTER_CONFIG: Partial<OpenRouterConfig> = {
  ...DEFAULT_LLM_CONFIG,
  baseURL: 'https://openrouter.ai/api/v1',
  model: DEFAULT_OPENROUTER_MODEL,
  maxTokens: 2048,
  temperature: 0.7,
  siteName: 'Atlas Desktop',
  siteUrl: 'https://github.com/atlas-desktop',
  trackCosts: true,
};

/**
 * Cost tracking for OpenRouter usage
 */
export interface CostTracker {
  totalCost: number;
  promptTokens: number;
  completionTokens: number;
  requests: number;
  byModel: Record<string, {
    cost: number;
    promptTokens: number;
    completionTokens: number;
    requests: number;
  }>;
}

/**
 * OpenRouter LLM Provider
 * Implements streaming chat completions with cost tracking
 */
export class OpenRouterLLM extends EventEmitter implements LLMProvider {
  readonly name = 'openrouter';
  private _status: LLMStatus = LLMStatus.IDLE;
  private config: OpenRouterConfig;
  private client: OpenAI;
  private abortController: AbortController | null = null;
  private currentContext: ConversationContext | null = null;
  private costs: CostTracker = {
    totalCost: 0,
    promptTokens: 0,
    completionTokens: 0,
    requests: 0,
    byModel: {},
  };

  constructor(config: Partial<OpenRouterConfig> = {}) {
    super();
    this.config = { ...DEFAULT_OPENROUTER_CONFIG, ...config } as OpenRouterConfig;

    if (!this.config.apiKey) {
      throw new Error('OpenRouter API key is required');
    }

    // Initialize OpenAI client with OpenRouter endpoint
    this.client = new OpenAI({
      apiKey: this.config.apiKey,
      baseURL: this.config.baseURL,
      timeout: this.config.timeout,
      defaultHeaders: {
        'HTTP-Referer': this.config.siteUrl || 'https://github.com/atlas-desktop',
        'X-Title': this.config.siteName || 'Atlas Desktop',
      },
    });

    logger.info('OpenRouterLLM initialized', { model: this.config.model });
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
    const template = context?.systemPrompt || ATLAS_SYSTEM_PROMPT;
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
   * Track costs for a request
   */
  private trackCost(model: string, promptTokens: number, completionTokens: number): number {
    if (!this.config.trackCosts) return 0;

    const modelInfo = OPENROUTER_MODELS[model];
    if (!modelInfo) {
      logger.warn('Unknown model for cost tracking', { model });
      return 0;
    }

    const promptCost = (promptTokens / 1_000_000) * modelInfo.pricing.prompt;
    const completionCost = (completionTokens / 1_000_000) * modelInfo.pricing.completion;
    const totalCost = promptCost + completionCost;

    // Update totals
    this.costs.totalCost += totalCost;
    this.costs.promptTokens += promptTokens;
    this.costs.completionTokens += completionTokens;
    this.costs.requests++;

    // Update per-model stats
    if (!this.costs.byModel[model]) {
      this.costs.byModel[model] = {
        cost: 0,
        promptTokens: 0,
        completionTokens: 0,
        requests: 0,
      };
    }
    this.costs.byModel[model].cost += totalCost;
    this.costs.byModel[model].promptTokens += promptTokens;
    this.costs.byModel[model].completionTokens += completionTokens;
    this.costs.byModel[model].requests++;

    logger.debug('Cost tracked', {
      model,
      cost: totalCost.toFixed(6),
      totalCost: this.costs.totalCost.toFixed(6),
    });

    return totalCost;
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

      // Track costs
      const cost = response.usage
        ? this.trackCost(
            response.model,
            response.usage.prompt_tokens,
            response.usage.completion_tokens
          )
        : 0;

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
        raw: { ...response, cost },
      };

      // Update context if provided
      if (context) {
        this.updateContext(context, message, content, result.usage?.totalTokens);
      }

      logger.info('Chat response received', {
        latency,
        tokens: result.usage?.totalTokens,
        cost: cost.toFixed(6),
        finishReason,
      });

      this.setStatus(LLMStatus.IDLE);
      this.emit('response', result);
      return result;
    } catch (error) {
      perfTimer.end('chat');
      this.setStatus(LLMStatus.ERROR);

      const apiError = new APIError(
        `OpenRouter chat failed: ${(error as Error).message}`,
        'openrouter',
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

      // Estimate tokens and track costs
      const promptTokens = estimateTokenCount(messages.map((m) => m.content).join(''));
      const completionTokens = estimateTokenCount(accumulated);
      const cost = this.trackCost(this.config.model!, promptTokens, completionTokens);

      // Update context if provided
      if (context) {
        this.updateContext(context, message, accumulated, promptTokens + completionTokens);
      }

      // Emit final response
      const response: LLMResponse = {
        content: accumulated,
        model: this.config.model!,
        finishReason: 'stop',
        latency,
        usage: {
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
        },
        raw: { cost },
      };

      logger.info('Streaming complete', {
        latency,
        tokens: response.usage?.totalTokens,
        cost: cost.toFixed(6),
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
        `OpenRouter streaming failed: ${(error as Error).message}`,
        'openrouter',
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
  updateConfig(config: Partial<OpenRouterConfig>): void {
    this.config = { ...this.config, ...config };

    // Recreate client if baseURL or apiKey changed
    if (config.baseURL || config.apiKey) {
      this.client = new OpenAI({
        apiKey: this.config.apiKey,
        baseURL: this.config.baseURL,
        timeout: this.config.timeout,
        defaultHeaders: {
          'HTTP-Referer': this.config.siteUrl || 'https://github.com/atlas-desktop',
          'X-Title': this.config.siteName || 'Atlas Desktop',
        },
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

  /**
   * Get cost tracking statistics
   */
  getCosts(): CostTracker {
    return { ...this.costs };
  }

  /**
   * Reset cost tracking
   */
  resetCosts(): void {
    this.costs = {
      totalCost: 0,
      promptTokens: 0,
      completionTokens: 0,
      requests: 0,
      byModel: {},
    };
    logger.info('Cost tracking reset');
  }

  /**
   * Get available models
   */
  static getAvailableModels(): OpenRouterModel[] {
    return Object.values(OPENROUTER_MODELS);
  }

  /**
   * Get model information
   */
  static getModelInfo(modelId: string): OpenRouterModel | undefined {
    return OPENROUTER_MODELS[modelId];
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
 * Create an OpenRouterLLM instance with API key
 */
export function createOpenRouterLLM(
  apiKey: string,
  config?: Partial<OpenRouterConfig>
): OpenRouterLLM {
  return new OpenRouterLLM({ apiKey, ...config });
}

export default OpenRouterLLM;
