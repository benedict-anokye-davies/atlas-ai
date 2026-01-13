/**
 * Nova Desktop - Error Handling Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock Electron modules before importing errors module
vi.mock('electron', () => ({
  app: {
    exit: vi.fn(),
    getPath: vi.fn(() => '/mock/path'),
  },
  dialog: {
    showErrorBox: vi.fn(),
  },
  BrowserWindow: {
    getFocusedWindow: vi.fn(() => null),
  },
}));

// Mock fs module with default export
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn(() => false),
    writeFileSync: vi.fn(),
    readFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  };
});

// Import after mocks
import {
  NovaError,
  APIError,
  AudioError,
  ConfigError,
  withRetry,
  createRetryable,
  CircuitBreaker,
  CircuitState,
  sleep,
  isRetryableError,
} from '../src/main/utils/errors';

describe('Error Classes', () => {
  it('should create NovaError with correct properties', () => {
    const error = new NovaError('Test error', 'TEST_CODE', true, { key: 'value' });
    
    expect(error.message).toBe('Test error');
    expect(error.code).toBe('TEST_CODE');
    expect(error.recoverable).toBe(true);
    expect(error.context).toEqual({ key: 'value' });
    expect(error.name).toBe('NovaError');
  });

  it('should create APIError with service info', () => {
    const error = new APIError('API failed', 'deepgram', 500, { endpoint: '/v1/listen' });
    
    expect(error.message).toBe('API failed');
    expect(error.service).toBe('deepgram');
    expect(error.statusCode).toBe(500);
    expect(error.code).toBe('API_DEEPGRAM_ERROR');
    expect(error.name).toBe('APIError');
  });

  it('should create AudioError', () => {
    const error = new AudioError('Microphone not found');
    
    expect(error.code).toBe('AUDIO_ERROR');
    expect(error.recoverable).toBe(true);
  });

  it('should create ConfigError as non-recoverable', () => {
    const error = new ConfigError('Missing API key');
    
    expect(error.code).toBe('CONFIG_ERROR');
    expect(error.recoverable).toBe(false);
  });
});

describe('Retry Utilities', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should succeed on first attempt', async () => {
    const fn = vi.fn().mockResolvedValue('success');
    
    const promise = withRetry(fn, { maxAttempts: 3 });
    await vi.runAllTimersAsync();
    const result = await promise;
    
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should retry on failure and succeed', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockResolvedValue('success');
    
    const promise = withRetry(fn, { 
      maxAttempts: 3, 
      initialDelayMs: 100,
    });
    
    // Run timers to allow retries
    await vi.runAllTimersAsync();
    const result = await promise;
    
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('should throw after max attempts', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always fails'));
    
    let caughtError: Error | null = null;
    const promise = withRetry(fn, { 
      maxAttempts: 3, 
      initialDelayMs: 100,
    }).catch((e) => { caughtError = e; });
    
    await vi.runAllTimersAsync();
    await promise;
    
    expect(caughtError).not.toBeNull();
    expect(caughtError!.message).toBe('always fails');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('should respect retryCondition', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('non-retryable'));
    
    const promise = withRetry(fn, {
      maxAttempts: 3,
      retryCondition: () => false, // Never retry
    });
    
    await expect(promise).rejects.toThrow('non-retryable');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should call onRetry callback', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValue('success');
    const onRetry = vi.fn();
    
    const promise = withRetry(fn, {
      maxAttempts: 3,
      initialDelayMs: 100,
      onRetry,
    });
    
    await vi.runAllTimersAsync();
    await promise;
    
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error), 100);
  });

  it('should create retryable function', async () => {
    let attempts = 0;
    const fn = async (x: number): Promise<number> => {
      attempts++;
      if (attempts < 2) throw new Error('not yet');
      return x * 2;
    };
    
    const retryableFn = createRetryable(fn, { 
      maxAttempts: 3, 
      initialDelayMs: 50,
    });
    
    const promise = retryableFn(5);
    await vi.runAllTimersAsync();
    const result = await promise;
    
    expect(result).toBe(10);
    expect(attempts).toBe(2);
  });
});

describe('Circuit Breaker', () => {
  it('should start in CLOSED state', () => {
    const breaker = new CircuitBreaker('test');
    expect(breaker.getState()).toBe(CircuitState.CLOSED);
  });

  it('should remain CLOSED on success', async () => {
    const breaker = new CircuitBreaker('test');
    const fn = vi.fn().mockResolvedValue('ok');
    
    await breaker.execute(fn);
    
    expect(breaker.getState()).toBe(CircuitState.CLOSED);
    expect(breaker.getStats().failures).toBe(0);
  });

  it('should open after failure threshold', async () => {
    const breaker = new CircuitBreaker('test', { failureThreshold: 3 });
    const fn = vi.fn().mockRejectedValue(new Error('fail'));
    
    // Fail 3 times
    for (let i = 0; i < 3; i++) {
      try {
        await breaker.execute(fn);
      } catch {
        // Expected
      }
    }
    
    expect(breaker.getState()).toBe(CircuitState.OPEN);
  });

  it('should reject calls when OPEN', async () => {
    const breaker = new CircuitBreaker('test', { failureThreshold: 1, timeout: 10000 });
    const fn = vi.fn().mockRejectedValue(new Error('fail'));
    
    // Trigger open
    try {
      await breaker.execute(fn);
    } catch {
      // Expected
    }
    
    // Should reject without calling fn
    await expect(breaker.execute(fn)).rejects.toThrow("Circuit breaker 'test' is OPEN");
  });

  it('should reset failures on success', async () => {
    const breaker = new CircuitBreaker('test', { failureThreshold: 3 });
    const failFn = vi.fn().mockRejectedValue(new Error('fail'));
    const successFn = vi.fn().mockResolvedValue('ok');
    
    // Fail twice
    try { await breaker.execute(failFn); } catch {}
    try { await breaker.execute(failFn); } catch {}
    
    expect(breaker.getStats().failures).toBe(2);
    
    // Success should reset
    await breaker.execute(successFn);
    
    expect(breaker.getStats().failures).toBe(0);
    expect(breaker.getState()).toBe(CircuitState.CLOSED);
  });

  it('should call onStateChange callback', async () => {
    const onStateChange = vi.fn();
    const breaker = new CircuitBreaker('test', { 
      failureThreshold: 1,
      onStateChange,
    });
    const fn = vi.fn().mockRejectedValue(new Error('fail'));
    
    try {
      await breaker.execute(fn);
    } catch {
      // Expected
    }
    
    expect(onStateChange).toHaveBeenCalledWith(CircuitState.CLOSED, CircuitState.OPEN);
  });

  it('should reset via manual reset()', async () => {
    const breaker = new CircuitBreaker('test', { failureThreshold: 1 });
    const fn = vi.fn().mockRejectedValue(new Error('fail'));
    
    try {
      await breaker.execute(fn);
    } catch {}
    
    expect(breaker.getState()).toBe(CircuitState.OPEN);
    
    breaker.reset();
    
    expect(breaker.getState()).toBe(CircuitState.CLOSED);
    expect(breaker.getStats().failures).toBe(0);
  });
});

describe('Utility Functions', () => {
  it('sleep should delay execution', async () => {
    vi.useFakeTimers();
    
    let resolved = false;
    const promise = sleep(1000).then(() => { resolved = true; });
    
    expect(resolved).toBe(false);
    
    await vi.advanceTimersByTimeAsync(1000);
    await promise;
    
    expect(resolved).toBe(true);
    
    vi.useRealTimers();
  });

  it('isRetryableError should detect network errors', () => {
    expect(isRetryableError(new Error('ECONNRESET'))).toBe(true);
    expect(isRetryableError(new Error('ETIMEDOUT'))).toBe(true);
    expect(isRetryableError(new Error('ECONNREFUSED'))).toBe(true);
    expect(isRetryableError(new Error('ENOTFOUND'))).toBe(true);
    expect(isRetryableError(new Error('Some other error'))).toBe(false);
  });

  it('isRetryableError should detect 5xx errors', () => {
    const error500 = new APIError('Server error', 'test', 500);
    const error502 = new APIError('Bad gateway', 'test', 502);
    const error400 = new APIError('Bad request', 'test', 400);
    
    expect(isRetryableError(error500)).toBe(true);
    expect(isRetryableError(error502)).toBe(true);
    expect(isRetryableError(error400)).toBe(false);
  });

  it('isRetryableError should detect rate limiting', () => {
    const error429 = new APIError('Rate limited', 'test', 429);
    
    expect(isRetryableError(error429)).toBe(true);
  });
});
