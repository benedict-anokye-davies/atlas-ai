/**
 * Nova Desktop - LLM Manager
 *
 * Manages LLM providers with automatic fallback capability and shared conversation context.
 * Primary provider: Fireworks AI (optimized for function calling)
 * Fallback provider: OpenRouter (wide model selection)
 *
 * Features:
 * - Automatic provider switching on errors via circuit breaker pattern
 * - Shared conversation context across providers
 * - Streaming and non-streaming response modes
 * - Cost tracking for OpenRouter usage
 *
 * @module llm/manager
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import { CircuitBreaker, CircuitState } from '../utils/errors';
import {
  LLMProvider,
  LLMConfig,
  LLMStatus,
  LLMEvents,
  LLMResponse,
  LLMStreamChunk,
  ConversationContext,
  ChatOptions,
  createConversationContext,
  NOVA_SYSTEM_PROMPT,
  estimateTokenCount,
} from '../../shared/types/llm';
import { FireworksLLM, FireworksConfig } from './fireworks';
import { OpenRouterLLM, OpenRouterConfig, CostTracker } from './openrouter';
import {
  ConversationMemory,
  getConversationMemory,
  shutdownConversationMemory,
} from '../memory/conversation-memory';

const logger = createModuleLogger('LLMManager');

/**
 * LLM Manager configuration
 */
export interface LLMManagerConfig {
  /** Fireworks configuration */
  fireworks?: Partial<FireworksConfig>;
  /** OpenRouter configuration */
  openrouter?: Partial<OpenRouterConfig>;
  /** Prefer OpenRouter (use it first) */
  preferOpenRouter?: boolean;
  /** Auto-switch to fallback on errors */
  autoFallback?: boolean;
  /** Number of consecutive errors before switching */
  errorThreshold?: number;
  /** Time to wait before trying primary again (ms) */
  fallbackCooldown?: number;
  /** Share conversation context between providers */
  sharedContext?: boolean;
  /** Enable conversation memory integration */
  enableConversationMemory?: boolean;
  /** Maximum conversation context turns to include */
  maxContextTurns?: number;
}

/**
 * Default LLM Manager configuration
 */
const DEFAULT_LLM_MANAGER_CONFIG: Required<LLMManagerConfig> = {
  fireworks: {},
  openrouter: {},
  preferOpenRouter: false,
  autoFallback: true,
  errorThreshold: 3,
  fallbackCooldown: 60000, // 1 minute
  sharedContext: true,
  enableConversationMemory: true,
  maxContextTurns: 5,
};

/**
 * LLM Provider type
 */
export type LLMProviderType = 'fireworks' | 'openrouter';

/**
 * LLM Manager events
 */
export interface LLMManagerEvents extends LLMEvents {
  /** Provider switched */
  'provider-switch': (from: LLMProviderType | null, to: LLMProviderType, reason: string) => void;
  /** Fallback activated */
  'fallback-activated': (provider: LLMProviderType, reason: string) => void;
  /** Primary restored */
  'primary-restored': () => void;
  /** Cost update */
  'cost-update': (costs: CostTracker) => void;
}

/**
 * LLM Manager
 * Orchestrates LLM providers with automatic fallback and shared context
 */
export class LLMManager extends EventEmitter implements LLMProvider {
  readonly name = 'llm-manager';
  private config: Required<LLMManagerConfig>;

  // Providers
  private fireworksLLM: FireworksLLM | null = null;
  private openrouterLLM: OpenRouterLLM | null = null;
  private activeProvider: LLMProvider | null = null;
  private activeProviderType: LLMProviderType | null = null;

  // Circuit breaker for Fireworks
  private fireworksBreaker: CircuitBreaker;

  // State tracking
  private consecutiveErrors = 0;
  private lastFallbackTime = 0;
  private _status: LLMStatus = LLMStatus.IDLE;

  // Shared conversation context
  private sharedContext: ConversationContext | null = null;

  // Conversation memory for context-aware responses
  private conversationMemory: ConversationMemory | null = null;
  private conversationMemoryInitialized = false;

  constructor(config?: Partial<LLMManagerConfig>) {
    super();
    this.config = { ...DEFAULT_LLM_MANAGER_CONFIG, ...config } as Required<LLMManagerConfig>;

    // Initialize circuit breaker for Fireworks
    this.fireworksBreaker = new CircuitBreaker('fireworks', {
      failureThreshold: this.config.errorThreshold,
      timeout: this.config.fallbackCooldown,
      onStateChange: (_from, to) => {
        if (to === CircuitState.OPEN) {
          logger.warn('Fireworks circuit breaker opened - switching to fallback');
          this.switchToFallback('Circuit breaker opened');
        } else if (to === CircuitState.HALF_OPEN) {
          logger.info('Fireworks circuit breaker half-open - will retry primary');
        } else if (to === CircuitState.CLOSED) {
          logger.info('Fireworks circuit breaker closed - primary available');
        }
      },
    });

    // Initialize providers
    this.initializeProviders();

    // Initialize conversation memory if enabled
    if (this.config.enableConversationMemory) {
      this.initializeConversationMemory();
    }

    logger.info('LLMManager initialized', {
      preferOpenRouter: this.config.preferOpenRouter,
      autoFallback: this.config.autoFallback,
      conversationMemoryEnabled: this.config.enableConversationMemory,
    });
  }

  /**
   * Gets the current LLM status.
   *
   * @returns The current status: IDLE, GENERATING, ERROR, or CANCELLED
   */
  get status(): LLMStatus {
    return this._status;
  }

  /**
   * Set status and emit event
   */
  private setStatus(status: LLMStatus): void {
    if (this._status !== status) {
      this._status = status;
      this.emit('status', status);
    }
  }

  /**
   * Sends a message and receives a complete response (non-streaming).
   *
   * Automatically falls back to OpenRouter if Fireworks fails.
   *
   * @param message - The user message to send
   * @param context - Optional conversation context (uses shared context if not provided)
   * @param options - Optional chat options including tools for function calling
   * @returns The complete LLM response
   * @throws Error if no provider is available
   *
   * @example
   * ```typescript
   * const response = await llmManager.chat('What is the weather like?');
   * console.log(response.content);
   * ```
   */
  async chat(
    message: string,
    context?: ConversationContext,
    options?: ChatOptions
  ): Promise<LLMResponse> {
    if (!this.activeProvider) {
      throw new Error(
        'No LLM provider is available. Configure at least one of: Fireworks AI or OpenRouter with a valid API key.'
      );
    }

    // Use shared context if enabled and no context provided
    let useContext =
      context || (this.config.sharedContext ? (this.sharedContext ?? undefined) : undefined);

    // Enhance context with conversation memory if available
    if (this.config.enableConversationMemory && this.conversationMemoryInitialized) {
      const enhancedSystemPrompt = this.buildEnhancedSystemPrompt();
      if (!useContext) {
        useContext = createConversationContext(enhancedSystemPrompt);
      } else {
        // Update the system message with enhanced prompt
        useContext = {
          ...useContext,
          systemPrompt: enhancedSystemPrompt,
        };
      }
    }

    try {
      const response = await this.activeProvider.chat(message, useContext, options);

      // Record the conversation turn in memory
      if (this.config.enableConversationMemory && response.content) {
        this.recordConversationTurn(message, response.content);
      }

      return response;
    } catch (error) {
      // Try fallback on error
      if (
        this.config.autoFallback &&
        this.activeProviderType === 'fireworks' &&
        this.openrouterLLM
      ) {
        logger.info('Attempting fallback after chat error');
        await this.switchToFallback((error as Error).message);
        // Note: OpenRouter doesn't support tools yet, so we call without options
        const response = await this.openrouterLLM.chat(message, useContext);

        // Record the conversation turn in memory
        if (this.config.enableConversationMemory && response.content) {
          this.recordConversationTurn(message, response.content);
        }

        return response;
      }
      throw error;
    }
  }

  /**
   * Sends a message and streams the response as chunks.
   *
   * Automatically falls back to OpenRouter if Fireworks fails.
   *
   * @param message - The user message to send
   * @param context - Optional conversation context (uses shared context if not provided)
   * @param options - Optional chat options including tools for function calling
   * @yields LLMStreamChunk objects containing response deltas and accumulated text
   * @throws Error if no provider is available
   *
   * @example
   * ```typescript
   * for await (const chunk of llmManager.chatStream('Tell me a story')) {
   *   process.stdout.write(chunk.delta);
   *   if (chunk.isFinal) console.log('Done!');
   * }
   * ```
   */
  async *chatStream(
    message: string,
    context?: ConversationContext,
    options?: ChatOptions
  ): AsyncGenerator<LLMStreamChunk> {
    if (!this.activeProvider) {
      throw new Error(
        'No LLM provider is available. Configure at least one of: Fireworks AI or OpenRouter with a valid API key.'
      );
    }

    // Use shared context if enabled and no context provided
    let useContext =
      context || (this.config.sharedContext ? (this.sharedContext ?? undefined) : undefined);

    // Enhance context with conversation memory if available
    if (this.config.enableConversationMemory && this.conversationMemoryInitialized) {
      const enhancedSystemPrompt = this.buildEnhancedSystemPrompt();
      if (!useContext) {
        useContext = createConversationContext(enhancedSystemPrompt);
      } else {
        useContext = {
          ...useContext,
          systemPrompt: enhancedSystemPrompt,
        };
      }
    }

    // Track accumulated response for memory
    let accumulatedResponse = '';

    try {
      for await (const chunk of this.activeProvider.chatStream(message, useContext, options)) {
        accumulatedResponse = chunk.accumulated;
        yield chunk;

        // Record turn when stream completes
        if (chunk.isFinal && this.config.enableConversationMemory && accumulatedResponse) {
          this.recordConversationTurn(message, accumulatedResponse);
        }
      }
    } catch (error) {
      // Try fallback on error
      if (
        this.config.autoFallback &&
        this.activeProviderType === 'fireworks' &&
        this.openrouterLLM
      ) {
        logger.info('Attempting fallback after stream error');
        await this.switchToFallback((error as Error).message);
        // Note: OpenRouter doesn't support tools yet, so we call without options
        for await (const chunk of this.openrouterLLM.chatStream(message, useContext)) {
          accumulatedResponse = chunk.accumulated;
          yield chunk;

          // Record turn when stream completes
          if (chunk.isFinal && this.config.enableConversationMemory && accumulatedResponse) {
            this.recordConversationTurn(message, accumulatedResponse);
          }
        }
      } else {
        throw error;
      }
    }
  }

  /**
   * Initialize providers
   */
  private initializeProviders(): void {
    // Initialize Fireworks if API key provided
    if (this.config.fireworks.apiKey) {
      try {
        this.fireworksLLM = new FireworksLLM(this.config.fireworks);
        this.setupProviderListeners(this.fireworksLLM, 'fireworks');
        logger.info('Fireworks provider initialized');
      } catch (error) {
        logger.warn('Failed to initialize Fireworks', { error: (error as Error).message });
      }
    }

    // Initialize OpenRouter if API key provided
    if (this.config.openrouter.apiKey) {
      try {
        this.openrouterLLM = new OpenRouterLLM(this.config.openrouter);
        this.setupProviderListeners(this.openrouterLLM, 'openrouter');
        logger.info('OpenRouter provider initialized');
      } catch (error) {
        logger.warn('Failed to initialize OpenRouter', { error: (error as Error).message });
      }
    }

    // Select initial provider
    this.selectProvider();
  }

  /**
   * Initialize conversation memory for context-aware responses
   */
  private async initializeConversationMemory(): Promise<void> {
    try {
      this.conversationMemory = await getConversationMemory();
      this.conversationMemoryInitialized = true;
      logger.info('ConversationMemory initialized for LLM context');
    } catch (error) {
      logger.warn('Failed to initialize ConversationMemory', {
        error: (error as Error).message,
      });
    }
  }

  /**
   * Build enhanced system prompt with conversation context
   */
  private buildEnhancedSystemPrompt(): string {
    if (!this.conversationMemory || !this.conversationMemoryInitialized) {
      return NOVA_SYSTEM_PROMPT;
    }

    // Get conversation context from memory
    const memoryContext = this.conversationMemory.getContext({
      maxTurns: this.config.maxContextTurns,
      includeTopics: true,
      includePreferences: true,
      includeMemories: true,
      maxLength: 2000,
    });

    if (!memoryContext) {
      return NOVA_SYSTEM_PROMPT;
    }

    // Build enhanced prompt with context
    const enhancedPrompt = `${NOVA_SYSTEM_PROMPT}

## Conversation Context
${memoryContext}`;

    return enhancedPrompt;
  }

  /**
   * Record a conversation turn in memory
   */
  recordConversationTurn(userMessage: string, novaResponse: string): void {
    if (this.conversationMemory && this.conversationMemoryInitialized) {
      this.conversationMemory.addTurn(userMessage, novaResponse);
      logger.debug('Conversation turn recorded in memory');
    }
  }

  /**
   * Get the conversation memory instance
   */
  getConversationMemory(): ConversationMemory | null {
    return this.conversationMemory;
  }

  /**
   * Select the appropriate provider based on config and availability
   */
  private selectProvider(): void {
    if (this.config.preferOpenRouter && this.openrouterLLM) {
      this.activeProvider = this.openrouterLLM;
      this.activeProviderType = 'openrouter';
    } else if (this.fireworksLLM && this.fireworksBreaker.canAttempt()) {
      this.activeProvider = this.fireworksLLM;
      this.activeProviderType = 'fireworks';
    } else if (this.openrouterLLM) {
      this.activeProvider = this.openrouterLLM;
      this.activeProviderType = 'openrouter';
    } else if (this.fireworksLLM) {
      this.activeProvider = this.fireworksLLM;
      this.activeProviderType = 'fireworks';
    }

    if (this.activeProviderType) {
      logger.info('Selected LLM provider', { provider: this.activeProviderType });
    } else {
      logger.error('No LLM provider available');
    }
  }

  /**
   * Set up event listeners for a provider
   */
  private setupProviderListeners(provider: LLMProvider, type: LLMProviderType): void {
    provider.on('status', (status: LLMStatus) => {
      if (provider === this.activeProvider) {
        this.setStatus(status);
      }
    });

    provider.on('chunk', (chunk: LLMStreamChunk) => {
      if (provider === this.activeProvider) {
        this.emit('chunk', chunk);
      }
    });

    provider.on('response', (response: LLMResponse) => {
      if (provider === this.activeProvider) {
        this.consecutiveErrors = 0; // Reset on success
        if (type === 'fireworks') {
          this.fireworksBreaker.recordSuccess();
        }
        this.emit('response', response);

        // Emit cost update for OpenRouter
        if (type === 'openrouter' && this.openrouterLLM) {
          this.emit('cost-update', this.openrouterLLM.getCosts());
        }
      }
    });

    provider.on('error', (error: Error) => {
      if (provider === this.activeProvider) {
        this.handleProviderError(error, type);
      }
    });

    provider.on('contextUpdate', (context: ConversationContext) => {
      if (provider === this.activeProvider) {
        if (this.config.sharedContext) {
          this.sharedContext = context;
        }
        this.emit('contextUpdate', context);
      }
    });
  }

  /**
   * Handle provider error
   */
  private handleProviderError(error: Error, type: LLMProviderType): void {
    this.consecutiveErrors++;
    logger.error('Provider error', {
      provider: type,
      error: error.message,
      consecutiveErrors: this.consecutiveErrors,
    });

    this.emit('error', error);

    // Check if we should switch to fallback
    if (
      this.config.autoFallback &&
      type === 'fireworks' &&
      this.consecutiveErrors >= this.config.errorThreshold
    ) {
      this.fireworksBreaker.recordFailure();
    }
  }

  /**
   * Switch to fallback provider
   */
  private async switchToFallback(reason: string): Promise<void> {
    if (this.activeProviderType === 'openrouter') {
      logger.warn('Already using fallback provider');
      return;
    }

    if (!this.openrouterLLM) {
      logger.error('No fallback provider available');
      return;
    }

    logger.info('Switching to fallback provider', { reason });
    this.lastFallbackTime = Date.now();

    const previousType = this.activeProviderType;
    this.activeProvider = this.openrouterLLM;
    this.activeProviderType = 'openrouter';
    this.consecutiveErrors = 0;

    this.emit('fallback-activated', 'openrouter', reason);
    this.emit('provider-switch', previousType, 'openrouter', reason);
    logger.info('Switched to OpenRouter fallback');
  }

  /**
   * Try to restore primary provider
   */
  async tryRestorePrimary(): Promise<boolean> {
    if (this.activeProviderType === 'fireworks' || !this.fireworksLLM) {
      return false;
    }

    // Check if cooldown has passed
    if (Date.now() - this.lastFallbackTime < this.config.fallbackCooldown) {
      return false;
    }

    // Check circuit breaker
    if (!this.fireworksBreaker.canAttempt()) {
      return false;
    }

    logger.info('Restoring primary provider');

    this.activeProvider = this.fireworksLLM;
    this.activeProviderType = 'fireworks';
    this.consecutiveErrors = 0;

    this.emit('primary-restored');
    this.emit('provider-switch', 'openrouter', 'fireworks', 'Primary restored');
    logger.info('Primary provider restored');
    return true;
  }

  /**
   * Gets the type of the currently active LLM provider.
   *
   * @returns 'fireworks', 'openrouter', or null if no provider is active
   */
  getActiveProviderType(): LLMProviderType | null {
    return this.activeProviderType;
  }

  /**
   * Cancels any ongoing LLM generation.
   */
  cancel(): void {
    this.activeProvider?.cancel();
  }

  /**
   * Gets the configuration of the active provider.
   *
   * @returns The LLM configuration, or a default empty config if no provider is active
   */
  getConfig(): LLMConfig {
    return this.activeProvider?.getConfig() || { apiKey: '' };
  }

  /**
   * Estimates the token count for a given text.
   *
   * Uses the active provider's tokenizer if available, otherwise falls back to a heuristic.
   *
   * @param text - The text to estimate tokens for
   * @returns Estimated token count
   */
  estimateTokens(text: string): number {
    return this.activeProvider?.estimateTokens(text) || estimateTokenCount(text);
  }

  /**
   * Creates a new conversation context with the Nova system prompt.
   *
   * If shared context is enabled, the new context becomes the shared context.
   *
   * @param userName - Optional user name for personalization
   * @returns A new ConversationContext
   */
  createContext(userName?: string): ConversationContext {
    const context = createConversationContext(NOVA_SYSTEM_PROMPT, userName);
    if (this.config.sharedContext) {
      this.sharedContext = context;
    }
    return context;
  }

  /**
   * Gets the current shared conversation context.
   *
   * @returns The shared context, or null if not initialized
   */
  getCurrentContext(): ConversationContext | null {
    return this.sharedContext;
  }

  /**
   * Clears all conversation context from the manager and providers.
   */
  clearContext(): void {
    this.sharedContext = null;
    if (this.fireworksLLM) {
      (this.fireworksLLM as FireworksLLM).clearContext();
    }
    if (this.openrouterLLM) {
      this.openrouterLLM.clearContext();
    }
    // Clear conversation memory as well
    if (this.conversationMemory) {
      this.conversationMemory.clear();
    }
    logger.info('Conversation context and memory cleared');
  }

  /**
   * Manually switches to a specific LLM provider.
   *
   * @param type - The provider to switch to: 'fireworks' or 'openrouter'
   * @throws Error if the requested provider is not available
   *
   * @example
   * ```typescript
   * // Switch to OpenRouter for specific model access
   * llmManager.switchToProvider('openrouter');
   * ```
   */
  switchToProvider(type: LLMProviderType): void {
    const provider = type === 'fireworks' ? this.fireworksLLM : this.openrouterLLM;

    if (!provider) {
      throw new Error(
        `LLM provider "${type}" is not available. Check that the API key is configured.`
      );
    }

    const previousType = this.activeProviderType;
    this.activeProvider = provider;
    this.activeProviderType = type;
    this.consecutiveErrors = 0;

    this.emit('provider-switch', previousType, type, 'Manual switch');
    logger.info('Manually switched provider', { to: type });
  }

  /**
   * Gets cost tracking information from OpenRouter.
   *
   * @returns CostTracker object with usage stats, or null if OpenRouter is not configured
   */
  getCosts(): CostTracker | null {
    return this.openrouterLLM?.getCosts() || null;
  }

  /**
   * Resets the OpenRouter cost tracking to zero.
   */
  resetCosts(): void {
    this.openrouterLLM?.resetCosts();
  }

  /**
   * Checks if the manager is currently using the fallback provider.
   *
   * @returns True if using OpenRouter as fallback (not as preferred provider)
   */
  isUsingFallback(): boolean {
    return this.activeProviderType === 'openrouter' && !this.config.preferOpenRouter;
  }

  // Type-safe event emitter methods
  on<K extends keyof LLMManagerEvents>(event: K, listener: LLMManagerEvents[K]): this {
    return super.on(event, listener);
  }

  off<K extends keyof LLMManagerEvents>(event: K, listener: LLMManagerEvents[K]): this {
    return super.off(event, listener);
  }

  emit<K extends keyof LLMManagerEvents>(
    event: K,
    ...args: Parameters<LLMManagerEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }
}

// Singleton instance
let llmManager: LLMManager | null = null;

/**
 * Gets or creates the singleton LLMManager instance.
 *
 * @param config - Optional configuration (only used on first call)
 * @returns The LLMManager singleton instance
 *
 * @example
 * ```typescript
 * const llm = getLLMManager({ fireworks: { apiKey: 'key' } });
 * const response = await llm.chat('Hello');
 * ```
 */
export function getLLMManager(config?: Partial<LLMManagerConfig>): LLMManager {
  if (!llmManager) {
    llmManager = new LLMManager(config);
  }
  return llmManager;
}

/**
 * Shuts down the LLM manager and cancels any pending requests.
 */
export function shutdownLLMManager(): void {
  if (llmManager) {
    llmManager.cancel();
    llmManager = null;
  }
  // Also shutdown conversation memory
  shutdownConversationMemory();
}

export default LLMManager;
