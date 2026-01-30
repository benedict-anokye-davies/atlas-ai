/**
 * Recovery System
 *
 * Enhanced error handling with retry strategies, CAPTCHA detection,
 * human escalation, and graceful degradation for browser automation.
 *
 * @module agent/browser-agent/recovery
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../../utils/logger';
import { BrowserAction } from './types';

const logger = createModuleLogger('RecoverySystem');

// ============================================================================
// Local Types for Recovery System
// ============================================================================

/** Error types for recovery classification */
export type ErrorType =
  | 'network'
  | 'timeout'
  | 'element_not_found'
  | 'navigation'
  | 'auth'
  | 'captcha'
  | 'rate_limit'
  | 'unknown';

/** Recovery strategy configuration */
export interface RecoveryStrategy {
  maxRetries: number;
  baseDelay: number;
  backoffMultiplier: number;
  maxDelay: number;
  actions: string[];
}

/** Browser error interface */
export interface BrowserError extends Error {
  type?: ErrorType;
  recoverable?: boolean;
}

/** Step result interface */
export interface StepResult {
  success: boolean;
  error?: string;
  recoveryAttempted?: boolean;
}

// ============================================================================
// Error Classification
// ============================================================================

/**
 * Patterns for detecting different error types
 */
const ERROR_PATTERNS = {
  captcha: [
    /captcha/i,
    /recaptcha/i,
    /hcaptcha/i,
    /challenge/i,
    /verify.*human/i,
    /robot/i,
    /security.*check/i,
    /cloudflare/i,
    /please verify/i,
    /are you a robot/i,
    /prove.*not.*bot/i,
  ],
  auth: [
    /unauthorized/i,
    /login.*required/i,
    /session.*expired/i,
    /authentication.*failed/i,
    /access.*denied/i,
    /forbidden/i,
    /sign.*in.*required/i,
    /please.*log.*in/i,
    /401/,
    /403/,
  ],
  network: [
    /net::err/i,
    /timeout/i,
    /connection.*refused/i,
    /dns.*failed/i,
    /network.*error/i,
    /fetch.*failed/i,
    /offline/i,
    /econnreset/i,
    /enotfound/i,
  ],
  navigation: [
    /navigation.*failed/i,
    /page.*not.*found/i,
    /404/,
    /500/,
    /502/,
    /503/,
    /server.*error/i,
    /bad.*gateway/i,
    /service.*unavailable/i,
  ],
  element: [
    /element.*not.*found/i,
    /no.*such.*element/i,
    /stale.*element/i,
    /element.*detached/i,
    /cannot.*find.*element/i,
    /selector.*not.*found/i,
  ],
  rateLimit: [
    /rate.*limit/i,
    /too.*many.*requests/i,
    /429/,
    /throttled/i,
    /slow.*down/i,
    /quota.*exceeded/i,
  ],
  content: [
    /content.*blocked/i,
    /access.*restricted/i,
    /geo.*blocked/i,
    /region.*not.*available/i,
    /vpn.*detected/i,
  ],
};

/**
 * CAPTCHA detection patterns in page content
 */
const CAPTCHA_DOM_PATTERNS = [
  'iframe[src*="recaptcha"]',
  'iframe[src*="hcaptcha"]',
  '.g-recaptcha',
  '.h-captcha',
  '#captcha',
  '[data-captcha]',
  '.cf-challenge-running',
  '.cf-browser-verification',
  '#challenge-form',
  '[data-ray]', // Cloudflare
  '.challenge-container',
];

// ============================================================================
// Recovery Strategies
// ============================================================================

/**
 * Default recovery strategies for each error type
 */
export const DEFAULT_RECOVERY_STRATEGIES: Record<ErrorType, RecoveryStrategy> = {
  network: {
    maxRetries: 3,
    baseDelay: 2000,
    backoffMultiplier: 2,
    maxDelay: 30000,
    actions: ['retry', 'refresh'],
  },
  timeout: {
    maxRetries: 2,
    baseDelay: 1000,
    backoffMultiplier: 1.5,
    maxDelay: 10000,
    actions: ['retry'],
  },
  element_not_found: {
    maxRetries: 3,
    baseDelay: 500,
    backoffMultiplier: 1.5,
    maxDelay: 5000,
    actions: ['retry', 'scroll', 'wait'],
  },
  navigation: {
    maxRetries: 2,
    baseDelay: 3000,
    backoffMultiplier: 2,
    maxDelay: 15000,
    actions: ['retry', 'refresh'],
  },
  auth: {
    maxRetries: 1,
    baseDelay: 0,
    backoffMultiplier: 1,
    maxDelay: 0,
    actions: ['human_intervention'],
  },
  captcha: {
    maxRetries: 0,
    baseDelay: 0,
    backoffMultiplier: 1,
    maxDelay: 0,
    actions: ['human_intervention'],
  },
  rate_limit: {
    maxRetries: 3,
    baseDelay: 60000,
    backoffMultiplier: 2,
    maxDelay: 300000,
    actions: ['wait', 'retry'],
  },
  unknown: {
    maxRetries: 1,
    baseDelay: 1000,
    backoffMultiplier: 1.5,
    maxDelay: 10000,
    actions: ['retry', 'abort'],
  },
};

// ============================================================================
// Recovery Context
// ============================================================================

export interface RecoveryContext {
  errorType: ErrorType;
  error: Error;
  action: BrowserAction;
  attemptNumber: number;
  totalAttempts: number;
  startTime: number;
  lastRetryTime?: number;
}

export interface RecoveryResult {
  success: boolean;
  shouldRetry: boolean;
  recoveryAction?: 'retry' | 'scroll' | 'wait' | 'refresh' | 'human_intervention' | 'abort';
  delay?: number;
  message?: string;
  humanInterventionRequired?: boolean;
  captchaDetected?: boolean;
}

// ============================================================================
// Recovery System
// ============================================================================

export class RecoverySystem extends EventEmitter {
  private page: any;
  private strategies: Record<ErrorType, RecoveryStrategy>;
  private recoveryAttempts: Map<string, RecoveryContext> = new Map();
  private humanInterventionCallback?: (context: RecoveryContext) => Promise<boolean>;

  constructor(page: any, strategies?: Partial<Record<ErrorType, RecoveryStrategy>>) {
    super();
    this.page = page;
    this.strategies = { ...DEFAULT_RECOVERY_STRATEGIES, ...strategies };
  }

  /**
   * Set callback for human intervention requests
   */
  setHumanInterventionCallback(callback: (context: RecoveryContext) => Promise<boolean>): void {
    this.humanInterventionCallback = callback;
  }

  /**
   * Classify an error into a type
   */
  classifyError(error: Error | string): ErrorType {
    const message = typeof error === 'string' ? error : error.message;

    for (const [type, patterns] of Object.entries(ERROR_PATTERNS)) {
      for (const pattern of patterns) {
        if (pattern.test(message)) {
          return type as ErrorType;
        }
      }
    }

    return 'unknown';
  }

  /**
   * Check if page contains CAPTCHA
   */
  async detectCaptcha(): Promise<boolean> {
    try {
      for (const selector of CAPTCHA_DOM_PATTERNS) {
        const element = await this.page.$(selector);
        if (element) {
          logger.info('CAPTCHA detected', { selector });
          return true;
        }
      }

      // Check page content for CAPTCHA-related text
      const bodyText = await this.page.evaluate(() => document.body?.innerText || '');
      for (const pattern of ERROR_PATTERNS.captcha) {
        if (pattern.test(bodyText)) {
          logger.info('CAPTCHA detected in page text');
          return true;
        }
      }

      return false;
    } catch (e) {
      logger.debug('CAPTCHA detection failed', {
        error: e instanceof Error ? e.message : String(e),
      });
      return false;
    }
  }

  /**
   * Check if authentication is required
   */
  async detectAuthRequired(): Promise<boolean> {
    try {
      // Check URL for login patterns
      const url = this.page.url();
      if (/login|signin|auth/i.test(url)) {
        return true;
      }

      // Check for login forms
      const loginForm = await this.page.$('form[action*="login"], form[action*="signin"]');
      if (loginForm) {
        return true;
      }

      // Check page content
      const bodyText = await this.page.evaluate(() => document.body?.innerText || '');
      for (const pattern of ERROR_PATTERNS.auth) {
        if (pattern.test(bodyText)) {
          return true;
        }
      }

      return false;
    } catch (e) {
      logger.debug('Auth detection failed', { error: e instanceof Error ? e.message : String(e) });
      return false;
    }
  }

  /**
   * Attempt recovery from an error
   */
  async attemptRecovery(
    error: Error,
    action: BrowserAction,
    actionKey: string
  ): Promise<RecoveryResult> {
    const errorType = this.classifyError(error);
    const strategy = this.strategies[errorType];

    // Get or create recovery context
    let context = this.recoveryAttempts.get(actionKey);
    if (!context) {
      context = {
        errorType,
        error,
        action,
        attemptNumber: 0,
        totalAttempts: 0,
        startTime: Date.now(),
      };
      this.recoveryAttempts.set(actionKey, context);
    }

    context.attemptNumber++;
    context.totalAttempts++;
    context.lastRetryTime = Date.now();

    logger.info('Attempting recovery', {
      errorType,
      attempt: context.attemptNumber,
      maxRetries: strategy.maxRetries,
      action: action.type,
    });

    // Check for CAPTCHA
    const hasCaptcha = await this.detectCaptcha();
    if (hasCaptcha) {
      logger.warn('CAPTCHA detected, requesting human intervention');
      this.emit('captcha-detected', context);

      return {
        success: false,
        shouldRetry: false,
        recoveryAction: 'human_intervention',
        humanInterventionRequired: true,
        captchaDetected: true,
        message: 'CAPTCHA detected. Human intervention required.',
      };
    }

    // Check if we've exceeded max retries
    if (context.attemptNumber > strategy.maxRetries) {
      logger.warn('Max retries exceeded', { errorType, attempts: context.attemptNumber });
      this.emit('max-retries-exceeded', context);

      // Check if human intervention is an option
      if (strategy.actions.includes('human_intervention')) {
        return await this.requestHumanIntervention(context);
      }

      return {
        success: false,
        shouldRetry: false,
        recoveryAction: 'abort',
        message: `Max retries (${strategy.maxRetries}) exceeded for ${errorType} error.`,
      };
    }

    // Calculate delay with exponential backoff
    const delay = Math.min(
      strategy.baseDelay * Math.pow(strategy.backoffMultiplier, context.attemptNumber - 1),
      strategy.maxDelay
    );

    // Determine recovery action
    const recoveryAction = await this.determineRecoveryAction(context, strategy);

    // Execute recovery action
    const result = await this.executeRecoveryAction(recoveryAction, delay);

    this.emit('recovery-attempted', {
      context,
      recoveryAction,
      result,
    });

    return result;
  }

  /**
   * Determine the best recovery action for the situation
   */
  private async determineRecoveryAction(
    context: RecoveryContext,
    strategy: RecoveryStrategy
  ): Promise<string> {
    const { actions } = strategy;

    // For element not found, try scrolling first
    if (context.errorType === 'element_not_found' && context.attemptNumber === 1) {
      if (actions.includes('scroll')) {
        return 'scroll';
      }
    }

    // For navigation errors, try refresh on second attempt
    if (context.errorType === 'navigation' && context.attemptNumber === 2) {
      if (actions.includes('refresh')) {
        return 'refresh';
      }
    }

    // Default to retry if available
    if (actions.includes('retry')) {
      return 'retry';
    }

    // Fall back to first available action
    return actions[0] || 'abort';
  }

  /**
   * Execute a recovery action
   */
  private async executeRecoveryAction(action: string, delay: number): Promise<RecoveryResult> {
    logger.debug('Executing recovery action', { action, delay });

    switch (action) {
      case 'retry':
        return {
          success: true,
          shouldRetry: true,
          recoveryAction: 'retry',
          delay,
          message: `Retrying after ${delay}ms delay.`,
        };

      case 'scroll':
        try {
          // Scroll the page to try to find the element
          await this.page.evaluate(() => {
            window.scrollBy(0, window.innerHeight * 0.5);
          });
          await this.delay(500);
          return {
            success: true,
            shouldRetry: true,
            recoveryAction: 'scroll',
            delay: 500,
            message: 'Scrolled page to find element.',
          };
        } catch (e) {
          return {
            success: false,
            shouldRetry: true,
            recoveryAction: 'retry',
            delay,
            message: 'Scroll failed, falling back to retry.',
          };
        }

      case 'wait':
        return {
          success: true,
          shouldRetry: true,
          recoveryAction: 'wait',
          delay: Math.max(delay, 2000),
          message: `Waiting ${delay}ms before retry.`,
        };

      case 'refresh':
        try {
          await this.page.reload({ waitUntil: 'networkidle0' });
          return {
            success: true,
            shouldRetry: true,
            recoveryAction: 'refresh',
            delay: 1000,
            message: 'Page refreshed.',
          };
        } catch (e) {
          return {
            success: false,
            shouldRetry: false,
            recoveryAction: 'abort',
            message: 'Page refresh failed.',
          };
        }

      case 'human_intervention':
        return {
          success: false,
          shouldRetry: false,
          recoveryAction: 'human_intervention',
          humanInterventionRequired: true,
          message: 'Human intervention required.',
        };

      case 'abort':
      default:
        return {
          success: false,
          shouldRetry: false,
          recoveryAction: 'abort',
          message: 'Recovery aborted.',
        };
    }
  }

  /**
   * Request human intervention
   */
  private async requestHumanIntervention(context: RecoveryContext): Promise<RecoveryResult> {
    logger.info('Requesting human intervention', {
      errorType: context.errorType,
      attempts: context.totalAttempts,
    });

    this.emit('human-intervention-needed', context);

    if (this.humanInterventionCallback) {
      const resolved = await this.humanInterventionCallback(context);
      if (resolved) {
        // Reset retry count and try again
        context.attemptNumber = 0;
        return {
          success: true,
          shouldRetry: true,
          recoveryAction: 'retry',
          delay: 500,
          message: 'Human intervention resolved the issue.',
        };
      }
    }

    return {
      success: false,
      shouldRetry: false,
      recoveryAction: 'human_intervention',
      humanInterventionRequired: true,
      message: 'Human intervention required to continue.',
    };
  }

  /**
   * Clear recovery state for an action
   */
  clearRecoveryState(actionKey: string): void {
    this.recoveryAttempts.delete(actionKey);
  }

  /**
   * Clear all recovery states
   */
  clearAllRecoveryStates(): void {
    this.recoveryAttempts.clear();
  }

  /**
   * Get recovery statistics
   */
  getRecoveryStats(): {
    totalAttempts: number;
    activeRecoveries: number;
    byErrorType: Record<ErrorType, number>;
  } {
    const byErrorType: Record<ErrorType, number> = {
      network: 0,
      timeout: 0,
      element_not_found: 0,
      navigation: 0,
      auth: 0,
      captcha: 0,
      rate_limit: 0,
      unknown: 0,
    };

    let totalAttempts = 0;

    for (const context of this.recoveryAttempts.values()) {
      totalAttempts += context.totalAttempts;
      byErrorType[context.errorType]++;
    }

    return {
      totalAttempts,
      activeRecoveries: this.recoveryAttempts.size,
      byErrorType,
    };
  }

  /**
   * Update recovery strategies
   */
  updateStrategies(strategies: Partial<Record<ErrorType, RecoveryStrategy>>): void {
    this.strategies = { ...this.strategies, ...strategies };
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a recovery system for a Puppeteer page
 */
export function createRecoverySystem(
  page: any,
  strategies?: Partial<Record<ErrorType, RecoveryStrategy>>
): RecoverySystem {
  return new RecoverySystem(page, strategies);
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Create a retry wrapper for browser operations
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: {
    maxRetries?: number;
    baseDelay?: number;
    backoffMultiplier?: number;
    onRetry?: (error: Error, attempt: number) => void;
  } = {}
): Promise<T> {
  const { maxRetries = 3, baseDelay = 1000, backoffMultiplier = 2, onRetry } = options;

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      const result = await operation();
      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt <= maxRetries) {
        const delay = baseDelay * Math.pow(backoffMultiplier, attempt - 1);
        logger.debug('Operation failed, retrying', {
          attempt,
          maxRetries,
          delay,
          error: lastError.message,
        });

        onRetry?.(lastError, attempt);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  throw lastError!;
}

/**
 * Wait for a condition with timeout
 */
export async function waitForCondition(
  condition: () => Promise<boolean>,
  options: {
    timeout?: number;
    interval?: number;
    timeoutMessage?: string;
  } = {}
): Promise<void> {
  const { timeout = 30000, interval = 500, timeoutMessage = 'Condition timeout' } = options;

  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    if (await condition()) {
      return;
    }
    await new Promise((r) => setTimeout(r, interval));
  }

  throw new Error(timeoutMessage);
}
