/**
 * Nova Desktop - LLM Manager
 * Manages LLM providers with automatic fallback
 * Primary: Fireworks AI, Fallback: OpenRouter
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
  createConversationContext,
  NOVA_SYSTEM_PROMPT,
  estimateTokenCount,
} from '../../shared/types/llm';
import { FireworksLLM, FireworksConfig } from './fireworks';
import { OpenRouterLLM, OpenRouterConfig, CostTracker } from './openrouter';

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

    logger.info('LLMManager initialized', {
      preferOpenRouter: this.config.preferOpenRouter,
      autoFallback: this.config.autoFallback,
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
      this._status = status;
      this.emit('status', status);
    }
  }

  /**
   * Get active provider type
   */
  getActiveProviderType(): LLMProviderType | null {
    return this.activeProviderType;
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
   * Send a message and get response (non-streaming)
   */
  async chat(message: string, context?: ConversationContext): Promise<LLMResponse> {
    if (!this.activeProvider) {
      throw new Error('No LLM provider available');
    }

    // Use shared context if enabled and no context provided
    const useContext =
      context || (this.config.sharedContext ? (this.sharedContext ?? undefined) : undefined);

    try {
      return await this.activeProvider.chat(message, useContext);
    } catch (error) {
      // Try fallback on error
      if (
        this.config.autoFallback &&
        this.activeProviderType === 'fireworks' &&
        this.openrouterLLM
      ) {
        logger.info('Attempting fallback after chat error');
        await this.switchToFallback((error as Error).message);
        return await this.openrouterLLM.chat(message, useContext);
      }
      throw error;
    }
  }

  /**
   * Send a message with streaming response
   */
  async *chatStream(
    message: string,
    context?: ConversationContext
  ): AsyncGenerator<LLMStreamChunk> {
    if (!this.activeProvider) {
      throw new Error('No LLM provider available');
    }

    // Use shared context if enabled and no context provided
    const useContext =
      context || (this.config.sharedContext ? (this.sharedContext ?? undefined) : undefined);

    try {
      yield* this.activeProvider.chatStream(message, useContext);
    } catch (error) {
      // Try fallback on error
      if (
        this.config.autoFallback &&
        this.activeProviderType === 'fireworks' &&
        this.openrouterLLM
      ) {
        logger.info('Attempting fallback after stream error');
        await this.switchToFallback((error as Error).message);
        yield* this.openrouterLLM.chatStream(message, useContext);
      } else {
        throw error;
      }
    }
  }

  /**
   * Cancel ongoing generation
   */
  cancel(): void {
    this.activeProvider?.cancel();
  }

  /**
   * Get current configuration
   */
  getConfig(): LLMConfig {
    return this.activeProvider?.getConfig() || { apiKey: '' };
  }

  /**
   * Estimate tokens for text
   */
  estimateTokens(text: string): number {
    return this.activeProvider?.estimateTokens(text) || estimateTokenCount(text);
  }

  /**
   * Create a new conversation context
   */
  createContext(userName?: string): ConversationContext {
    const context = createConversationContext(NOVA_SYSTEM_PROMPT, userName);
    if (this.config.sharedContext) {
      this.sharedContext = context;
    }
    return context;
  }

  /**
   * Get current conversation context
   */
  getCurrentContext(): ConversationContext | null {
    return this.sharedContext;
  }

  /**
   * Clear conversation context
   */
  clearContext(): void {
    this.sharedContext = null;
    if (this.fireworksLLM) {
      (this.fireworksLLM as FireworksLLM).clearContext();
    }
    if (this.openrouterLLM) {
      this.openrouterLLM.clearContext();
    }
    logger.info('Conversation context cleared');
  }

  /**
   * Force switch to specific provider
   */
  switchToProvider(type: LLMProviderType): void {
    const provider = type === 'fireworks' ? this.fireworksLLM : this.openrouterLLM;

    if (!provider) {
      throw new Error(`Provider ${type} not available`);
    }

    const previousType = this.activeProviderType;
    this.activeProvider = provider;
    this.activeProviderType = type;
    this.consecutiveErrors = 0;

    this.emit('provider-switch', previousType, type, 'Manual switch');
    logger.info('Manually switched provider', { to: type });
  }

  /**
   * Get cost tracking (OpenRouter only)
   */
  getCosts(): CostTracker | null {
    return this.openrouterLLM?.getCosts() || null;
  }

  /**
   * Reset cost tracking
   */
  resetCosts(): void {
    this.openrouterLLM?.resetCosts();
  }

  /**
   * Check if fallback is active
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
 * Get or create LLM manager instance
 */
export function getLLMManager(config?: Partial<LLMManagerConfig>): LLMManager {
  if (!llmManager) {
    llmManager = new LLMManager(config);
  }
  return llmManager;
}

/**
 * Shutdown LLM manager
 */
export function shutdownLLMManager(): void {
  if (llmManager) {
    llmManager.cancel();
    llmManager = null;
  }
}

export default LLMManager;
