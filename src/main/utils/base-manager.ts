/**
 * Atlas Desktop - Base Provider Manager
 * Abstract base class for managing providers with fallback capability
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import { CircuitBreaker, CircuitState } from '../utils/errors';

/**
 * Base configuration for provider managers
 */
export interface BaseManagerConfig {
  /** Prefer offline/fallback mode */
  preferOffline?: boolean;
  /** Auto-switch to fallback on errors */
  autoFallback?: boolean;
  /** Number of consecutive errors before switching */
  errorThreshold?: number;
  /** Time to wait before trying primary again (ms) */
  fallbackCooldown?: number;
}

/**
 * Default base configuration
 */
export const DEFAULT_BASE_CONFIG: Required<BaseManagerConfig> = {
  preferOffline: false,
  autoFallback: true,
  errorThreshold: 3,
  fallbackCooldown: 60000, // 1 minute
};

/**
 * Provider status enum
 */
export enum ProviderStatus {
  IDLE = 'idle',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  ACTIVE = 'active',
  ERROR = 'error',
  CLOSED = 'closed',
}

/**
 * Base provider interface that all providers must implement
 */
export interface BaseProvider {
  /** Provider name */
  readonly name: string;
}

/**
 * Abstract base class for provider managers
 * Provides common functionality for primary/fallback provider switching
 */
export abstract class BaseProviderManager extends EventEmitter {
  protected readonly logger: ReturnType<typeof createModuleLogger>;

  // Provider state
  protected primaryProvider: BaseProvider | null = null;
  protected fallbackProvider: BaseProvider | null = null;
  protected activeProvider: BaseProvider | null = null;
  protected activeProviderType: string | null = null;

  // Circuit breaker for primary provider
  protected primaryBreaker: CircuitBreaker;

  // State tracking
  protected consecutiveErrors = 0;
  protected lastFallbackTime = 0;
  protected _status: ProviderStatus = ProviderStatus.IDLE;
  protected isOfflineMode = false;

  // Configuration
  protected baseConfig: Required<BaseManagerConfig>;

  constructor(
    protected readonly managerName: string,
    protected readonly primaryProviderName: string,
    config?: Partial<BaseManagerConfig>
  ) {
    super();
    this.logger = createModuleLogger(managerName);
    this.baseConfig = { ...DEFAULT_BASE_CONFIG, ...config };

    // Initialize circuit breaker for primary provider
    this.primaryBreaker = new CircuitBreaker(primaryProviderName, {
      failureThreshold: this.baseConfig.errorThreshold,
      timeout: this.baseConfig.fallbackCooldown,
      onStateChange: (_from, to) => {
        this.handleCircuitBreakerStateChange(to);
      },
    });

    this.logger.info(`${managerName} initialized`, {
      preferOffline: this.baseConfig.preferOffline,
      autoFallback: this.baseConfig.autoFallback,
    });
  }

  /**
   * Get current status
   */
  get status(): ProviderStatus {
    return this._status;
  }

  /**
   * Set status and emit event
   */
  protected setStatus(status: ProviderStatus): void {
    if (this._status !== status) {
      this._status = status;
      this.emit('status', status);
    }
  }

  /**
   * Get active provider type
   */
  getActiveProviderType(): string | null {
    return this.activeProviderType;
  }

  /**
   * Check if using offline/fallback mode
   */
  isUsingFallback(): boolean {
    return this.isOfflineMode || this.activeProvider === this.fallbackProvider;
  }

  /**
   * Handle circuit breaker state changes
   */
  protected handleCircuitBreakerStateChange(newState: CircuitState): void {
    if (newState === CircuitState.OPEN) {
      this.logger.warn(
        `${this.primaryProviderName} circuit breaker opened - switching to fallback`
      );
      this.switchToFallback('Circuit breaker opened');
    } else if (newState === CircuitState.HALF_OPEN) {
      this.logger.info(
        `${this.primaryProviderName} circuit breaker half-open - will retry primary`
      );
    } else if (newState === CircuitState.CLOSED) {
      this.logger.info(`${this.primaryProviderName} circuit breaker closed - primary available`);
    }
  }

  /**
   * Record success for circuit breaker
   */
  protected recordSuccess(): void {
    this.primaryBreaker.recordSuccess();
    this.consecutiveErrors = 0;
  }

  /**
   * Record failure for circuit breaker
   */
  protected recordFailure(): void {
    this.primaryBreaker.recordFailure();
    this.consecutiveErrors++;
  }

  /**
   * Check if should try primary provider again
   */
  protected shouldTryPrimary(): boolean {
    if (!this.baseConfig.autoFallback) return true;
    if (this.baseConfig.preferOffline) return false;
    return this.primaryBreaker.canAttempt();
  }

  /**
   * Emit provider switch event
   */
  protected emitProviderSwitch(from: string | null, to: string, reason: string): void {
    this.emit('provider-switch', from, to, reason);
    this.logger.info('Provider switched', { from, to, reason });
  }

  /**
   * Switch to fallback provider - to be implemented by subclasses
   */
  protected abstract switchToFallback(reason: string): Promise<void> | void;

  /**
   * Switch to primary provider - to be implemented by subclasses
   */
  protected abstract switchToPrimary(): Promise<void> | void;

  /**
   * Initialize providers - to be implemented by subclasses
   */
  protected abstract initializeProviders(): Promise<void>;

  /**
   * Start the manager - to be implemented by subclasses
   */
  abstract start(): Promise<void>;

  /**
   * Stop the manager - to be implemented by subclasses
   */
  abstract stop(): Promise<void>;

  /**
   * Get base configuration
   */
  getBaseConfig(): Required<BaseManagerConfig> {
    return { ...this.baseConfig };
  }

  /**
   * Update base configuration
   */
  updateBaseConfig(config: Partial<BaseManagerConfig>): void {
    this.baseConfig = { ...this.baseConfig, ...config };
    this.logger.info('Base configuration updated', config);
  }
}
