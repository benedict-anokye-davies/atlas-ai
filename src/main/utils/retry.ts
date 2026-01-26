/**
 * Retry Utility - Exponential backoff retry logic
 * Provides configurable retry behavior for async operations
 */

import { createModuleLogger } from './logger';
import { TIMEOUTS, LIMITS } from '../../shared/constants';

const logger = createModuleLogger('RetryUtil');

/**
 * Retry configuration options
 */
export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxAttempts?: number;
  /** Initial delay in ms (default: 1000) */
  initialDelay?: number;
  /** Maximum delay in ms (default: 30000) */
  maxDelay?: number;
  /** Backoff multiplier (default: 2 for exponential) */
  backoffMultiplier?: number;
  /** Function to determine if error is retryable (default: retry all) */
  isRetryable?: (error: Error) => boolean;
  /** Callback for each retry attempt */
  onRetry?: (attempt: number, delay: number, error: Error) => void;
}

/**
 * Default retry configuration
 */
const DEFAULT_RETRY_OPTIONS: Required<Omit<RetryOptions, 'onRetry' | 'isRetryable'>> = {
  maxAttempts: LIMITS.MAX_RETRY_ATTEMPTS,
  initialDelay: TIMEOUTS.RETRY_DELAY,
  maxDelay: TIMEOUTS.MAX_RETRY_DELAY,
  backoffMultiplier: 2,
};

/**
 * Execute an async operation with exponential backoff retry
 *
 * @example
 * ```typescript
 * const result = await retryWithBackoff(
 *   async () => await fetchData(),
 *   {
 *     maxAttempts: 5,
 *     initialDelay: 1000,
 *     isRetryable: (error) => error.message.includes('timeout')
 *   }
 * );
 * ```
 */
export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const config = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if error is retryable
      if (options.isRetryable && !options.isRetryable(lastError)) {
        throw lastError;
      }

      // Don't retry after last attempt
      if (attempt === config.maxAttempts) {
        throw lastError;
      }

      // Calculate delay with exponential backoff
      const delay = Math.min(
        config.initialDelay * Math.pow(config.backoffMultiplier, attempt - 1),
        config.maxDelay
      );

      logger.warn(`Operation failed (attempt ${attempt}/${config.maxAttempts})`, {
        error: lastError.message,
        retryDelay: delay,
      });

      // Call retry callback if provided
      if (options.onRetry) {
        options.onRetry(attempt, delay, lastError);
      }

      // Wait before retrying
      await sleep(delay);
    }
  }

  // Should never reach here, but TypeScript needs it
  throw lastError || new Error('Operation failed with unknown error');
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Common retryable error patterns
 */
export const RetryableErrors = {
  /** Network errors (timeout, connection refused, etc.) */
  isNetworkError: (error: Error): boolean => {
    const message = error.message.toLowerCase();
    return (
      message.includes('timeout') ||
      message.includes('econnrefused') ||
      message.includes('enotfound') ||
      message.includes('network') ||
      message.includes('fetch failed')
    );
  },

  /** Rate limit errors */
  isRateLimitError: (error: Error): boolean => {
    const message = error.message.toLowerCase();
    return message.includes('rate limit') || message.includes('429') || message.includes('too many');
  },

  /** Server errors (5xx) */
  isServerError: (error: Error): boolean => {
    const message = error.message.toLowerCase();
    return (
      message.includes('500') ||
      message.includes('502') ||
      message.includes('503') ||
      message.includes('504') ||
      message.includes('internal server error')
    );
  },

  /** Combined: any transient error that should be retried */
  isTransientError: (error: Error): boolean => {
    return (
      RetryableErrors.isNetworkError(error) ||
      RetryableErrors.isRateLimitError(error) ||
      RetryableErrors.isServerError(error)
    );
  },
};

/**
 * Decorator to add retry logic to a method
 *
 * @example
 * ```typescript
 * class MyService {
 *   @withRetry({ maxAttempts: 3 })
 *   async fetchData() {
 *     // Method implementation
 *   }
 * }
 * ```
 */
export function withRetry(options: RetryOptions = {}) {
  return function (
    _target: unknown,
    _propertyKey: string,
    descriptor: PropertyDescriptor
  ): PropertyDescriptor {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: unknown[]) {
      return retryWithBackoff(() => originalMethod.apply(this, args), options);
    };

    return descriptor;
  };
}
