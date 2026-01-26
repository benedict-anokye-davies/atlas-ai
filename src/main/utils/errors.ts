/**
 * Atlas Desktop - Error Handling Utilities
 * Global error handler, retry utilities, circuit breaker, and recovery
 */

import { app, dialog, BrowserWindow } from 'electron';
import { createModuleLogger } from './logger';
import { existsSync } from 'fs';
import { writeFile, readFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { sleep } from '../../shared/utils';

const errorLogger = createModuleLogger('Error');

// ============================================================================
// Custom Error Types
// ============================================================================

export class AtlasError extends Error {
  constructor(
    message: string,
    public code: string,
    public recoverable: boolean = true,
    public context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'AtlasError';
    Error.captureStackTrace(this, AtlasError);
  }
}

export class APIError extends AtlasError {
  constructor(
    message: string,
    public service: string,
    public statusCode?: number,
    context?: Record<string, unknown>
  ) {
    super(message, `API_${service.toUpperCase()}_ERROR`, true, context);
    this.name = 'APIError';
  }
}

export class AudioError extends AtlasError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'AUDIO_ERROR', true, context);
    this.name = 'AudioError';
  }
}

export class ConfigError extends AtlasError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'CONFIG_ERROR', false, context);
    this.name = 'ConfigError';
  }
}

// ============================================================================
// Global Error Handler
// ============================================================================

interface GlobalErrorHandlerOptions {
  exitOnCritical?: boolean;
  showDialog?: boolean;
  saveState?: () => Promise<void>;
}

let globalErrorHandlerInstalled = false;
let globalOptions: GlobalErrorHandlerOptions = {};
let lastErrorDialogTime = 0;
const ERROR_DIALOG_COOLDOWN_MS = 5000; // Only show one error dialog per 5 seconds
const isDev = process.env.NODE_ENV === 'development';

/**
 * Install global error handlers for the main process
 */
export function installGlobalErrorHandler(options: GlobalErrorHandlerOptions = {}): void {
  if (globalErrorHandlerInstalled) {
    errorLogger.warn('Global error handler already installed');
    return;
  }

  globalOptions = {
    exitOnCritical: !isDev, // Don't exit in dev mode
    showDialog: !isDev, // Don't spam dialogs in dev mode
    ...options,
  };

  // Handle uncaught exceptions
  process.on('uncaughtException', async (error: Error) => {
    errorLogger.error('Uncaught Exception', {
      message: error.message,
      stack: error.stack,
      name: error.name,
    });

    await handleCriticalError(error);
  });

  // Handle unhandled promise rejections
  process.on('unhandledRejection', async (reason: unknown) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));

    errorLogger.error('Unhandled Promise Rejection', {
      message: error.message,
      stack: error.stack,
      reason: String(reason),
    });

    // Only treat as critical if it's a fatal error
    if (error.message.includes('FATAL') || error.message.includes('CRITICAL')) {
      await handleCriticalError(error);
    }
  });

  // Handle warnings
  process.on('warning', (warning: Error) => {
    errorLogger.warn('Process Warning', {
      message: warning.message,
      stack: warning.stack,
      name: warning.name,
    });
  });

  globalErrorHandlerInstalled = true;
  errorLogger.info('Global error handler installed');
}

/**
 * Handle critical errors that may require app restart
 */
async function handleCriticalError(error: Error): Promise<void> {
  // Try to save state before exiting
  if (globalOptions.saveState) {
    try {
      await globalOptions.saveState();
      errorLogger.info('State saved before crash');
    } catch (saveError) {
      errorLogger.error('Failed to save state before crash', {
        message: (saveError as Error).message,
      });
    }
  }

  // Show error dialog with rate limiting to prevent spam
  const now = Date.now();
  if (globalOptions.showDialog && (now - lastErrorDialogTime) > ERROR_DIALOG_COOLDOWN_MS) {
    lastErrorDialogTime = now;
    dialog.showErrorBox(
      'Atlas Error',
      `An unexpected error occurred:\n\n${error.message}\n\nThe application may need to restart.`
    );
  } else if (isDev) {
    // In dev mode, just log to console instead of showing dialogs
    errorLogger.error('Critical error (dialog suppressed in dev mode)', { message: error.message });
  }

  // Exit if critical (disabled in dev mode by default)
  if (globalOptions.exitOnCritical) {
    errorLogger.error('Exiting due to critical error');
    app.exit(1);
  }
}

// ============================================================================
// Retry Utilities with Exponential Backoff
// ============================================================================

export interface RetryOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  retryCondition?: (error: Error) => boolean;
  onRetry?: (attempt: number, error: Error, delayMs: number) => void;
}

const DEFAULT_RETRY_OPTIONS: Required<Omit<RetryOptions, 'retryCondition' | 'onRetry'>> = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
};

/**
 * Execute a function with retry logic and exponential backoff
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let lastError: Error | null = null;
  let delayMs = opts.initialDelayMs;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      // Check if we should retry
      if (opts.retryCondition && !opts.retryCondition(lastError)) {
        throw lastError;
      }

      // Check if we've exhausted attempts
      if (attempt === opts.maxAttempts) {
        errorLogger.error(`All ${opts.maxAttempts} retry attempts failed`, {
          error: lastError.message,
        });
        throw lastError;
      }

      // Log retry
      errorLogger.warn(`Attempt ${attempt} failed, retrying in ${delayMs}ms`, {
        error: lastError.message,
        attempt,
        maxAttempts: opts.maxAttempts,
        delayMs,
      });

      // Callback
      if (opts.onRetry) {
        opts.onRetry(attempt, lastError, delayMs);
      }

      // Wait before retry
      await sleep(delayMs);

      // Increase delay for next attempt
      delayMs = Math.min(delayMs * opts.backoffMultiplier, opts.maxDelayMs);
    }
  }

  // Should never reach here, but TypeScript needs this
  throw lastError;
}

/**
 * Create a retry-wrapped version of an async function
 */
export function createRetryable<T, Args extends unknown[]>(
  fn: (...args: Args) => Promise<T>,
  options: RetryOptions = {}
): (...args: Args) => Promise<T> {
  return (...args: Args) => withRetry(() => fn(...args), options);
}

// ============================================================================
// Circuit Breaker
// ============================================================================

export enum CircuitState {
  CLOSED = 'CLOSED', // Normal operation
  OPEN = 'OPEN', // Failing, reject all calls
  HALF_OPEN = 'HALF_OPEN', // Testing if service recovered
}

export interface CircuitBreakerOptions {
  failureThreshold?: number; // Number of failures before opening
  successThreshold?: number; // Number of successes in half-open before closing
  timeout?: number; // Time in ms before trying again (half-open)
  onStateChange?: (from: CircuitState, to: CircuitState) => void;
}

const DEFAULT_CIRCUIT_OPTIONS: Required<Omit<CircuitBreakerOptions, 'onStateChange'>> = {
  failureThreshold: 5,
  successThreshold: 2,
  timeout: 30000,
};

export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failures: number = 0;
  private successes: number = 0;
  private lastFailureTime: number = 0;
  private options: Required<Omit<CircuitBreakerOptions, 'onStateChange'>> &
    Pick<CircuitBreakerOptions, 'onStateChange'>;
  private logger = createModuleLogger('CircuitBreaker');

  constructor(
    private name: string,
    options: CircuitBreakerOptions = {}
  ) {
    this.options = { ...DEFAULT_CIRCUIT_OPTIONS, ...options };
  }

  /**
   * Execute a function through the circuit breaker
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Check if we should transition from OPEN to HALF_OPEN
    if (this.state === CircuitState.OPEN) {
      if (Date.now() - this.lastFailureTime >= this.options.timeout) {
        this.transitionTo(CircuitState.HALF_OPEN);
      } else {
        throw new AtlasError(`Circuit breaker '${this.name}' is OPEN`, 'CIRCUIT_OPEN', true, {
          name: this.name,
          state: this.state,
        });
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.failures = 0;

    if (this.state === CircuitState.HALF_OPEN) {
      this.successes++;
      if (this.successes >= this.options.successThreshold) {
        this.transitionTo(CircuitState.CLOSED);
      }
    }
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();
    this.successes = 0;

    if (this.state === CircuitState.HALF_OPEN) {
      this.transitionTo(CircuitState.OPEN);
    } else if (this.failures >= this.options.failureThreshold) {
      this.transitionTo(CircuitState.OPEN);
    }
  }

  private transitionTo(newState: CircuitState): void {
    if (this.state === newState) return;

    const oldState = this.state;
    this.state = newState;

    this.logger.info(`Circuit '${this.name}' state changed`, {
      from: oldState,
      to: newState,
    });

    if (this.options.onStateChange) {
      this.options.onStateChange(oldState, newState);
    }

    // Reset counters on state change
    if (newState === CircuitState.CLOSED) {
      this.failures = 0;
      this.successes = 0;
    } else if (newState === CircuitState.HALF_OPEN) {
      this.successes = 0;
    }
  }

  /**
   * Get current circuit state
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Get circuit statistics
   */
  getStats(): { state: CircuitState; failures: number; successes: number } {
    return {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
    };
  }

  /**
   * Manually reset the circuit breaker
   */
  reset(): void {
    this.transitionTo(CircuitState.CLOSED);
  }

  /**
   * Check if an attempt can be made (for manual circuit breaker usage)
   */
  canAttempt(): boolean {
    // Check if we should transition from OPEN to HALF_OPEN
    if (this.state === CircuitState.OPEN) {
      if (Date.now() - this.lastFailureTime >= this.options.timeout) {
        this.transitionTo(CircuitState.HALF_OPEN);
        return true;
      }
      return false;
    }
    return true;
  }

  /**
   * Record a successful attempt (for manual circuit breaker usage)
   */
  recordSuccess(): void {
    this.onSuccess();
  }

  /**
   * Record a failed attempt (for manual circuit breaker usage)
   */
  recordFailure(): void {
    this.onFailure();
  }
}

// ============================================================================
// Crash Recovery
// ============================================================================

const STATE_FILE = join(homedir(), '.atlas', 'state', 'recovery.json');

export interface RecoveryState {
  timestamp: number;
  conversationId?: string;
  lastUserMessage?: string;
  pipelineState?: string;
  customData?: Record<string, unknown>;
}

/**
 * Save application state for crash recovery
 */
export async function saveRecoveryState(state: Partial<RecoveryState>): Promise<void> {
  try {
    const dir = dirname(STATE_FILE);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }

    const fullState: RecoveryState = {
      timestamp: Date.now(),
      ...state,
    };

    await writeFile(STATE_FILE, JSON.stringify(fullState, null, 2));
    errorLogger.debug('Recovery state saved', { timestamp: fullState.timestamp });
  } catch (error) {
    errorLogger.error('Failed to save recovery state', {
      error: (error as Error).message,
    });
  }
}

/**
 * Load recovery state from previous session
 */
export async function loadRecoveryState(): Promise<RecoveryState | null> {
  try {
    if (!existsSync(STATE_FILE)) {
      return null;
    }

    const data = await readFile(STATE_FILE, 'utf-8');
    const state: RecoveryState = JSON.parse(data);

    // Check if state is too old (more than 1 hour)
    const maxAge = 60 * 60 * 1000;
    if (Date.now() - state.timestamp > maxAge) {
      errorLogger.info('Recovery state too old, ignoring');
      return null;
    }

    errorLogger.info('Recovery state loaded', {
      timestamp: state.timestamp,
      age: Date.now() - state.timestamp,
    });

    return state;
  } catch (error) {
    errorLogger.error('Failed to load recovery state', {
      error: (error as Error).message,
    });
    return null;
  }
}

/**
 * Clear recovery state
 */
export async function clearRecoveryState(): Promise<void> {
  try {
    if (existsSync(STATE_FILE)) {
      await writeFile(STATE_FILE, JSON.stringify({ timestamp: 0 }));
    }
  } catch (error) {
    // Log but don't throw - clearing state is best-effort
    errorLogger.debug('Failed to clear recovery state', { error: (error as Error).message });
  }
}

// ============================================================================
// Error Notification System
// ============================================================================

export interface ErrorNotification {
  id: string;
  type: 'error' | 'warning' | 'info';
  title: string;
  message: string;
  timestamp: number;
  recoverable: boolean;
  actions?: ErrorAction[];
}

export interface ErrorAction {
  label: string;
  action: string;
}

type NotificationHandler = (notification: ErrorNotification) => void;

class ErrorNotificationManager {
  private handlers: Set<NotificationHandler> = new Set();
  private notifications: ErrorNotification[] = [];
  private logger = createModuleLogger('Notifications');

  /**
   * Register a handler for error notifications
   */
  onNotification(handler: NotificationHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  /**
   * Send an error notification
   */
  notify(notification: Omit<ErrorNotification, 'id' | 'timestamp'>): void {
    const fullNotification: ErrorNotification = {
      ...notification,
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
    };

    this.notifications.push(fullNotification);

    // Keep only last 100 notifications
    if (this.notifications.length > 100) {
      this.notifications = this.notifications.slice(-100);
    }

    this.logger.debug('Error notification', {
      type: fullNotification.type,
      title: fullNotification.title,
    });

    // Send to renderer via IPC
    this.sendToRenderer(fullNotification);

    // Notify all handlers
    for (const handler of this.handlers) {
      try {
        handler(fullNotification);
      } catch (error) {
        this.logger.error('Notification handler error', {
          error: (error as Error).message,
        });
      }
    }
  }

  /**
   * Send notification to renderer process
   */
  private sendToRenderer(notification: ErrorNotification): void {
    try {
      const windows = BrowserWindow.getAllWindows();
      for (const win of windows) {
        if (!win.isDestroyed()) {
          win.webContents.send('atlas:error-notification', notification);
        }
      }
    } catch (error) {
      this.logger.debug('Failed to send notification to renderer', {
        error: (error as Error).message,
      });
    }
  }

  /**
   * Get recent notifications
   */
  getRecent(count: number = 10): ErrorNotification[] {
    return this.notifications.slice(-count);
  }

  /**
   * Clear all notifications
   */
  clear(): void {
    this.notifications = [];
  }
}

// Singleton instance
export const errorNotifications = new ErrorNotificationManager();

/**
 * Helper to create and send error notification
 */
export function notifyError(
  title: string,
  message: string,
  recoverable: boolean = true,
  actions?: ErrorAction[]
): void {
  errorNotifications.notify({
    type: 'error',
    title,
    message,
    recoverable,
    actions,
  });
}

/**
 * Helper to create and send warning notification
 */
export function notifyWarning(title: string, message: string): void {
  errorNotifications.notify({
    type: 'warning',
    title,
    message,
    recoverable: true,
  });
}

// ============================================================================
// Utilities
// ============================================================================

// Re-export sleep from shared utils for backward compatibility
export { sleep } from '../../shared/utils';

/**
 * Check if an error is retryable
 */
export function isRetryableError(error: Error): boolean {
  // Network errors
  if (
    error.message.includes('ECONNRESET') ||
    error.message.includes('ETIMEDOUT') ||
    error.message.includes('ECONNREFUSED') ||
    error.message.includes('ENOTFOUND')
  ) {
    return true;
  }

  // HTTP 5xx errors
  if (error instanceof APIError && error.statusCode && error.statusCode >= 500) {
    return true;
  }

  // Rate limiting
  if (error instanceof APIError && error.statusCode === 429) {
    return true;
  }

  return false;
}

// Export error logger for external use
export { errorLogger };
