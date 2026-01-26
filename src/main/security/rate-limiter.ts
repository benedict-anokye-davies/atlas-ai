/**
 * Atlas Desktop - Rate Limiter
 * Token bucket algorithm implementation for API rate limiting
 *
 * Features:
 * - Per-service rate limiting (LLM, STT, TTS)
 * - Token bucket algorithm with configurable limits
 * - Graceful degradation when limits are hit
 * - User notifications on rate limit
 * - Retry with exponential backoff
 * - Usage statistics tracking
 *
 * @module security/rate-limiter
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import { notifyWarning, notifyError, sleep } from '../utils/errors';
import { RateLimitConfig, RateLimitStatus } from '../../shared/types/security';

const logger = createModuleLogger('RateLimiter');

// ============================================================================
// Types & Interfaces
// ============================================================================

/**
 * Service types that can be rate limited
 */
export type RateLimitedService = 'llm' | 'stt' | 'tts' | 'llm-fallback' | 'stt-fallback' | 'tts-fallback';

/**
 * Extended rate limit configuration with service-specific options
 */
export interface ServiceRateLimitConfig extends RateLimitConfig {
  /** Service identifier */
  service: RateLimitedService;
  /** Whether to enable burst mode for short spikes */
  enableBurst?: boolean;
  /** Cooldown period after hitting limit (ms) */
  cooldownMs?: number;
  /** Whether to notify user when rate limited */
  notifyUser?: boolean;
  /** Maximum retries before giving up */
  maxRetries?: number;
  /** Base delay for exponential backoff (ms) */
  baseRetryDelayMs?: number;
}

/**
 * Token bucket state for a service
 */
interface TokenBucket {
  /** Current token count */
  tokens: number;
  /** Last time tokens were refilled */
  lastRefill: number;
  /** Whether the bucket is in cooldown (rate limit hit) */
  inCooldown: boolean;
  /** When cooldown ends */
  cooldownEndsAt: number;
}

/**
 * Usage statistics for a service
 */
export interface ServiceUsageStats {
  /** Service identifier */
  service: RateLimitedService;
  /** Total requests made */
  totalRequests: number;
  /** Requests allowed */
  allowedRequests: number;
  /** Requests denied (rate limited) */
  deniedRequests: number;
  /** Current window start time */
  windowStartTime: number;
  /** Requests in current window */
  requestsInWindow: number;
  /** Rate limit hits (times limit was reached) */
  rateLimitHits: number;
  /** Average requests per minute */
  avgRequestsPerMinute: number;
  /** Peak requests per minute */
  peakRequestsPerMinute: number;
  /** Last request timestamp */
  lastRequestTime: number;
  /** Retry count for current operation */
  retryCount: number;
}

/**
 * Rate limiter events
 */
export interface RateLimiterEvents {
  /** Emitted when a request is allowed */
  allowed: (service: RateLimitedService, remaining: number) => void;
  /** Emitted when a request is denied */
  denied: (service: RateLimitedService, resetIn: number) => void;
  /** Emitted when rate limit is hit */
  rateLimitHit: (service: RateLimitedService, cooldownMs: number) => void;
  /** Emitted when cooldown ends */
  cooldownEnded: (service: RateLimitedService) => void;
  /** Emitted when retrying after rate limit */
  retrying: (service: RateLimitedService, attempt: number, delayMs: number) => void;
  /** Emitted when usage stats are updated */
  statsUpdate: (stats: Map<RateLimitedService, ServiceUsageStats>) => void;
}

/**
 * Result of a rate limit check
 */
export interface RateLimitCheckResult extends RateLimitStatus {
  /** Whether the request should proceed */
  proceed: boolean;
  /** Suggested wait time before retrying (ms) */
  waitTime: number;
  /** Whether this hit the rate limit for the first time in this window */
  isNewRateLimitHit: boolean;
}

/**
 * Options for executing a rate-limited operation
 */
export interface RateLimitedOperationOptions<T> {
  /** The operation to execute */
  operation: () => Promise<T>;
  /** Service being rate limited */
  service: RateLimitedService;
  /** Fallback operation if rate limited */
  fallback?: () => Promise<T>;
  /** Whether to retry on rate limit */
  retry?: boolean;
  /** Callback on rate limit hit */
  onRateLimited?: (status: RateLimitStatus) => void;
  /** Callback on retry */
  onRetry?: (attempt: number, delayMs: number) => void;
}

// ============================================================================
// Default Configurations
// ============================================================================

/**
 * Default rate limit configurations per service
 * These are conservative defaults that should work for most API providers
 */
export const DEFAULT_SERVICE_CONFIGS: Record<RateLimitedService, ServiceRateLimitConfig> = {
  // LLM Services (Fireworks AI)
  llm: {
    service: 'llm',
    maxRequests: 60,          // 60 requests per minute
    windowMs: 60000,          // 1 minute window
    burstLimit: 10,           // Allow 10 extra requests in bursts
    enableBurst: true,
    cooldownMs: 5000,         // 5 second cooldown after limit
    notifyUser: true,
    maxRetries: 3,
    baseRetryDelayMs: 1000,
  },

  // LLM Fallback (OpenRouter)
  'llm-fallback': {
    service: 'llm-fallback',
    maxRequests: 50,          // Slightly lower for fallback
    windowMs: 60000,
    burstLimit: 5,
    enableBurst: true,
    cooldownMs: 5000,
    notifyUser: true,
    maxRetries: 2,
    baseRetryDelayMs: 1500,
  },

  // STT Service (Deepgram)
  stt: {
    service: 'stt',
    maxRequests: 100,         // Higher limit for STT (real-time audio)
    windowMs: 60000,
    burstLimit: 20,
    enableBurst: true,
    cooldownMs: 3000,
    notifyUser: true,
    maxRetries: 3,
    baseRetryDelayMs: 500,
  },

  // STT Fallback (Vosk - offline, no real limit needed)
  'stt-fallback': {
    service: 'stt-fallback',
    maxRequests: 1000,        // Very high limit (offline)
    windowMs: 60000,
    burstLimit: 100,
    enableBurst: true,
    cooldownMs: 0,
    notifyUser: false,
    maxRetries: 1,
    baseRetryDelayMs: 100,
  },

  // TTS Service (ElevenLabs)
  tts: {
    service: 'tts',
    maxRequests: 30,          // Lower limit (more expensive)
    windowMs: 60000,
    burstLimit: 5,
    enableBurst: true,
    cooldownMs: 10000,        // Longer cooldown for TTS
    notifyUser: true,
    maxRetries: 2,
    baseRetryDelayMs: 2000,
  },

  // TTS Fallback (system voice - offline)
  'tts-fallback': {
    service: 'tts-fallback',
    maxRequests: 500,         // High limit (offline)
    windowMs: 60000,
    burstLimit: 50,
    enableBurst: true,
    cooldownMs: 0,
    notifyUser: false,
    maxRetries: 1,
    baseRetryDelayMs: 100,
  },
};

// ============================================================================
// Rate Limiter Implementation
// ============================================================================

/**
 * Rate Limiter using Token Bucket Algorithm
 *
 * The token bucket algorithm works as follows:
 * - Each service has a "bucket" that holds tokens
 * - Tokens are added to the bucket at a fixed rate (refill rate)
 * - Each request consumes one token
 * - If no tokens are available, the request is denied
 * - Burst mode allows temporary exceeding of the limit
 */
export class RateLimiter extends EventEmitter {
  private configs: Map<RateLimitedService, ServiceRateLimitConfig> = new Map();
  private buckets: Map<RateLimitedService, TokenBucket> = new Map();
  private stats: Map<RateLimitedService, ServiceUsageStats> = new Map();
  private refillInterval: NodeJS.Timeout | null = null;
  private statsUpdateInterval: NodeJS.Timeout | null = null;

  constructor(customConfigs?: Partial<Record<RateLimitedService, Partial<ServiceRateLimitConfig>>>) {
    super();

    // Initialize with default configs, optionally overridden
    for (const [service, defaultConfig] of Object.entries(DEFAULT_SERVICE_CONFIGS)) {
      const customConfig = customConfigs?.[service as RateLimitedService];
      const config = { ...defaultConfig, ...customConfig };
      this.configs.set(service as RateLimitedService, config);
      this.initializeBucket(service as RateLimitedService, config);
      this.initializeStats(service as RateLimitedService);
    }

    // Start background refill process
    this.startRefillProcess();

    // Start stats update process
    this.startStatsUpdateProcess();

    logger.info('RateLimiter initialized', {
      services: Array.from(this.configs.keys()),
    });
  }

  /**
   * Initialize a token bucket for a service
   */
  private initializeBucket(service: RateLimitedService, config: ServiceRateLimitConfig): void {
    const totalTokens = config.maxRequests + (config.burstLimit || 0);
    this.buckets.set(service, {
      tokens: totalTokens,
      lastRefill: Date.now(),
      inCooldown: false,
      cooldownEndsAt: 0,
    });
  }

  /**
   * Initialize usage statistics for a service
   */
  private initializeStats(service: RateLimitedService): void {
    this.stats.set(service, {
      service,
      totalRequests: 0,
      allowedRequests: 0,
      deniedRequests: 0,
      windowStartTime: Date.now(),
      requestsInWindow: 0,
      rateLimitHits: 0,
      avgRequestsPerMinute: 0,
      peakRequestsPerMinute: 0,
      lastRequestTime: 0,
      retryCount: 0,
    });
  }

  /**
   * Start the background token refill process
   */
  private startRefillProcess(): void {
    // Refill tokens every second
    this.refillInterval = setInterval(() => {
      this.refillAllBuckets();
    }, 1000);
  }

  /**
   * Start the stats update broadcast process
   */
  private startStatsUpdateProcess(): void {
    // Broadcast stats every 10 seconds
    this.statsUpdateInterval = setInterval(() => {
      this.emit('statsUpdate', new Map(this.stats));
    }, 10000);
  }

  /**
   * Refill tokens for all buckets based on elapsed time
   */
  private refillAllBuckets(): void {
    const now = Date.now();

    for (const [service, bucket] of this.buckets) {
      const config = this.configs.get(service)!;

      // Check if cooldown has ended
      if (bucket.inCooldown && now >= bucket.cooldownEndsAt) {
        bucket.inCooldown = false;
        logger.debug('Cooldown ended', { service });
        this.emit('cooldownEnded', service);
      }

      // Calculate tokens to add based on elapsed time
      const elapsedMs = now - bucket.lastRefill;
      const tokensPerMs = config.maxRequests / config.windowMs;
      const tokensToAdd = elapsedMs * tokensPerMs;

      // Add tokens up to max capacity
      const maxTokens = config.maxRequests + (config.enableBurst ? (config.burstLimit || 0) : 0);
      bucket.tokens = Math.min(maxTokens, bucket.tokens + tokensToAdd);
      bucket.lastRefill = now;
    }
  }

  /**
   * Check if a request can proceed for a service
   */
  checkLimit(service: RateLimitedService): RateLimitCheckResult {
    const config = this.configs.get(service);
    const bucket = this.buckets.get(service);
    const stats = this.stats.get(service);

    if (!config || !bucket || !stats) {
      logger.warn('Unknown service', { service });
      return {
        allowed: false,
        proceed: false,
        remaining: 0,
        resetIn: 0,
        currentCount: 0,
        waitTime: 0,
        isNewRateLimitHit: false,
      };
    }

    const now = Date.now();

    // Update stats
    stats.totalRequests++;
    stats.lastRequestTime = now;

    // Check if in cooldown
    if (bucket.inCooldown) {
      const resetIn = bucket.cooldownEndsAt - now;
      stats.deniedRequests++;

      return {
        allowed: false,
        proceed: false,
        remaining: 0,
        resetIn: Math.max(0, resetIn),
        currentCount: config.maxRequests - Math.floor(bucket.tokens),
        waitTime: Math.max(0, resetIn),
        isNewRateLimitHit: false,
      };
    }

    // Check if we have tokens
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      stats.allowedRequests++;
      stats.requestsInWindow++;

      // Update peak requests per minute
      const windowDurationMinutes = (now - stats.windowStartTime) / 60000;
      if (windowDurationMinutes > 0) {
        const currentRate = stats.requestsInWindow / windowDurationMinutes;
        stats.peakRequestsPerMinute = Math.max(stats.peakRequestsPerMinute, currentRate);
        stats.avgRequestsPerMinute = stats.requestsInWindow / windowDurationMinutes;
      }

      // Reset window if needed
      if (now - stats.windowStartTime >= config.windowMs) {
        stats.windowStartTime = now;
        stats.requestsInWindow = 1;
      }

      const remaining = Math.floor(bucket.tokens);
      this.emit('allowed', service, remaining);

      return {
        allowed: true,
        proceed: true,
        remaining,
        resetIn: 0,
        currentCount: config.maxRequests - remaining,
        waitTime: 0,
        isNewRateLimitHit: false,
      };
    }

    // Rate limit hit - enter cooldown
    stats.deniedRequests++;
    stats.rateLimitHits++;
    bucket.inCooldown = true;
    bucket.cooldownEndsAt = now + (config.cooldownMs || 5000);

    const resetIn = config.cooldownMs || 5000;

    // Notify user if configured
    if (config.notifyUser) {
      notifyWarning(
        'Rate Limit Reached',
        `${this.getServiceDisplayName(service)} is temporarily unavailable. Please wait ${Math.ceil(resetIn / 1000)} seconds.`
      );
    }

    logger.warn('Rate limit hit', {
      service,
      cooldownMs: resetIn,
      totalHits: stats.rateLimitHits,
    });

    this.emit('rateLimitHit', service, resetIn);
    this.emit('denied', service, resetIn);

    return {
      allowed: false,
      proceed: false,
      remaining: 0,
      resetIn,
      currentCount: config.maxRequests,
      waitTime: resetIn,
      isNewRateLimitHit: true,
    };
  }

  /**
   * Consume a token for a service (call after successful request)
   * This is useful when you want to manually track usage
   */
  consume(service: RateLimitedService): boolean {
    const result = this.checkLimit(service);
    return result.allowed;
  }

  /**
   * Execute an operation with rate limiting and automatic retry
   */
  async execute<T>(options: RateLimitedOperationOptions<T>): Promise<T> {
    const { service, operation, fallback, retry = true, onRateLimited, onRetry } = options;
    const config = this.configs.get(service)!;
    const stats = this.stats.get(service)!;

    let attempt = 0;
    const maxRetries = retry ? (config.maxRetries || 3) : 0;
    let lastError: Error | null = null;

    while (attempt <= maxRetries) {
      // Check rate limit
      const limitStatus = this.checkLimit(service);

      if (limitStatus.proceed) {
        try {
          // Execute the operation
          const result = await operation();
          stats.retryCount = 0; // Reset retry count on success
          return result;
        } catch (error) {
          lastError = error as Error;

          // Check if error is a rate limit error from the API
          if (this.isRateLimitError(error as Error)) {
            logger.warn('API returned rate limit error', { service, attempt });

            // Force cooldown
            const bucket = this.buckets.get(service)!;
            bucket.inCooldown = true;
            bucket.cooldownEndsAt = Date.now() + (config.cooldownMs || 5000);
            bucket.tokens = 0;

            limitStatus.proceed = false;
            limitStatus.waitTime = config.cooldownMs || 5000;
            limitStatus.isNewRateLimitHit = true;
          } else {
            // Not a rate limit error, re-throw
            throw error;
          }
        }
      }

      // Rate limited
      if (onRateLimited) {
        onRateLimited(limitStatus);
      }

      // Check if we should retry
      if (attempt < maxRetries && retry) {
        attempt++;
        stats.retryCount = attempt;

        // Calculate delay with exponential backoff and jitter
        const baseDelay = config.baseRetryDelayMs || 1000;
        const exponentialDelay = baseDelay * Math.pow(2, attempt - 1);
        const jitter = Math.random() * 1000;
        const delay = Math.min(exponentialDelay + jitter, 30000); // Cap at 30 seconds

        logger.info('Retrying after rate limit', {
          service,
          attempt,
          delayMs: delay,
        });

        if (onRetry) {
          onRetry(attempt, delay);
        }

        this.emit('retrying', service, attempt, delay);

        // Wait before retrying
        await sleep(delay);
      } else {
        break;
      }
    }

    // All retries exhausted - try fallback if available
    if (fallback) {
      logger.info('Using fallback after rate limit', { service });
      try {
        return await fallback();
      } catch (fallbackError) {
        logger.error('Fallback also failed', {
          service,
          error: (fallbackError as Error).message,
        });
        throw fallbackError;
      }
    }

    // No fallback - throw the last error or a rate limit error
    const error = lastError || new Error(`Rate limit exceeded for ${service}`);
    notifyError(
      'Service Unavailable',
      `${this.getServiceDisplayName(service)} is unavailable due to rate limiting. Please try again later.`
    );
    throw error;
  }

  /**
   * Check if an error is a rate limit error
   */
  private isRateLimitError(error: Error): boolean {
    const message = error.message.toLowerCase();
    return (
      message.includes('rate limit') ||
      message.includes('too many requests') ||
      message.includes('429') ||
      message.includes('quota exceeded') ||
      message.includes('throttled')
    );
  }

  /**
   * Get human-readable service name
   */
  private getServiceDisplayName(service: RateLimitedService): string {
    const names: Record<RateLimitedService, string> = {
      llm: 'AI Assistant',
      'llm-fallback': 'AI Assistant (Backup)',
      stt: 'Speech Recognition',
      'stt-fallback': 'Speech Recognition (Offline)',
      tts: 'Text-to-Speech',
      'tts-fallback': 'Text-to-Speech (Offline)',
    };
    return names[service] || service;
  }

  /**
   * Get current status for a service
   */
  getStatus(service: RateLimitedService): RateLimitStatus | null {
    const config = this.configs.get(service);
    const bucket = this.buckets.get(service);

    if (!config || !bucket) {
      return null;
    }

    const now = Date.now();
    const remaining = Math.floor(bucket.tokens);
    const resetIn = bucket.inCooldown ? Math.max(0, bucket.cooldownEndsAt - now) : 0;

    return {
      allowed: !bucket.inCooldown && bucket.tokens >= 1,
      remaining,
      resetIn,
      currentCount: config.maxRequests - remaining,
    };
  }

  /**
   * Get usage statistics for a service
   */
  getStats(service: RateLimitedService): ServiceUsageStats | null {
    return this.stats.get(service) || null;
  }

  /**
   * Get all usage statistics
   */
  getAllStats(): Map<RateLimitedService, ServiceUsageStats> {
    return new Map(this.stats);
  }

  /**
   * Get configuration for a service
   */
  getConfig(service: RateLimitedService): ServiceRateLimitConfig | null {
    return this.configs.get(service) || null;
  }

  /**
   * Update configuration for a service
   */
  updateConfig(service: RateLimitedService, config: Partial<ServiceRateLimitConfig>): void {
    const existingConfig = this.configs.get(service);
    if (!existingConfig) {
      logger.warn('Cannot update config for unknown service', { service });
      return;
    }

    const newConfig = { ...existingConfig, ...config };
    this.configs.set(service, newConfig);

    // Reinitialize bucket if limits changed
    if (config.maxRequests !== undefined || config.burstLimit !== undefined) {
      this.initializeBucket(service, newConfig);
    }

    logger.info('Rate limit config updated', { service, config: newConfig });
  }

  /**
   * Reset rate limit for a service (clears cooldown and refills tokens)
   */
  reset(service: RateLimitedService): void {
    const config = this.configs.get(service);
    if (!config) {
      return;
    }

    this.initializeBucket(service, config);
    this.initializeStats(service);

    logger.info('Rate limiter reset', { service });
  }

  /**
   * Reset all rate limits
   */
  resetAll(): void {
    for (const service of this.configs.keys()) {
      this.reset(service);
    }
    logger.info('All rate limiters reset');
  }

  /**
   * Check if a service is currently in cooldown
   */
  isInCooldown(service: RateLimitedService): boolean {
    const bucket = this.buckets.get(service);
    return bucket?.inCooldown || false;
  }

  /**
   * Get time until cooldown ends for a service
   */
  getCooldownRemaining(service: RateLimitedService): number {
    const bucket = this.buckets.get(service);
    if (!bucket || !bucket.inCooldown) {
      return 0;
    }
    return Math.max(0, bucket.cooldownEndsAt - Date.now());
  }

  /**
   * Manually end cooldown for a service
   */
  endCooldown(service: RateLimitedService): void {
    const bucket = this.buckets.get(service);
    if (bucket && bucket.inCooldown) {
      bucket.inCooldown = false;
      bucket.cooldownEndsAt = 0;
      logger.info('Cooldown manually ended', { service });
      this.emit('cooldownEnded', service);
    }
  }

  /**
   * Stop the rate limiter (cleanup)
   */
  stop(): void {
    if (this.refillInterval) {
      clearInterval(this.refillInterval);
      this.refillInterval = null;
    }
    if (this.statsUpdateInterval) {
      clearInterval(this.statsUpdateInterval);
      this.statsUpdateInterval = null;
    }
    logger.info('RateLimiter stopped');
  }

  /**
   * Create a rate-limited wrapper for a function
   */
  wrap<T, Args extends unknown[]>(
    service: RateLimitedService,
    fn: (...args: Args) => Promise<T>,
    fallback?: (...args: Args) => Promise<T>
  ): (...args: Args) => Promise<T> {
    return async (...args: Args): Promise<T> => {
      return this.execute({
        service,
        operation: () => fn(...args),
        fallback: fallback ? () => fallback(...args) : undefined,
        retry: true,
      });
    };
  }

  // Type-safe event emitter methods
  on<K extends keyof RateLimiterEvents>(event: K, listener: RateLimiterEvents[K]): this {
    return super.on(event, listener);
  }

  off<K extends keyof RateLimiterEvents>(event: K, listener: RateLimiterEvents[K]): this {
    return super.off(event, listener);
  }

  emit<K extends keyof RateLimiterEvents>(event: K, ...args: Parameters<RateLimiterEvents[K]>): boolean {
    return super.emit(event, ...args);
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let rateLimiterInstance: RateLimiter | null = null;

/**
 * Get the singleton rate limiter instance
 */
export function getRateLimiter(
  customConfigs?: Partial<Record<RateLimitedService, Partial<ServiceRateLimitConfig>>>
): RateLimiter {
  if (!rateLimiterInstance) {
    rateLimiterInstance = new RateLimiter(customConfigs);
  }
  return rateLimiterInstance;
}

/**
 * Create a new rate limiter instance (for testing or custom use)
 */
export function createRateLimiter(
  customConfigs?: Partial<Record<RateLimitedService, Partial<ServiceRateLimitConfig>>>
): RateLimiter {
  return new RateLimiter(customConfigs);
}

/**
 * Reset the singleton rate limiter
 */
export function resetRateLimiter(): void {
  if (rateLimiterInstance) {
    rateLimiterInstance.stop();
    rateLimiterInstance = null;
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Check if a request can proceed for a service (convenience function)
 */
export function checkRateLimit(service: RateLimitedService): RateLimitCheckResult {
  return getRateLimiter().checkLimit(service);
}

/**
 * Execute a rate-limited operation (convenience function)
 */
export async function withRateLimit<T>(
  service: RateLimitedService,
  operation: () => Promise<T>,
  fallback?: () => Promise<T>
): Promise<T> {
  return getRateLimiter().execute({
    service,
    operation,
    fallback,
    retry: true,
  });
}

/**
 * Get current rate limit status for a service (convenience function)
 */
export function getRateLimitStatus(service: RateLimitedService): RateLimitStatus | null {
  return getRateLimiter().getStatus(service);
}

/**
 * Get usage statistics for a service (convenience function)
 */
export function getRateLimitStats(service: RateLimitedService): ServiceUsageStats | null {
  return getRateLimiter().getStats(service);
}

export default RateLimiter;
