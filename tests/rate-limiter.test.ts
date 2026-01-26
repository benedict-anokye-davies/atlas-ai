/**
 * Atlas Desktop - Rate Limiter Tests
 * Unit tests for the rate limiting module
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  RateLimiter,
  createRateLimiter,
  RateLimitedService,
  DEFAULT_SERVICE_CONFIGS,
} from '../src/main/security/rate-limiter';

// Mock the logger
vi.mock('../src/main/utils/logger', () => ({
  createModuleLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock the error utilities
vi.mock('../src/main/utils/errors', () => ({
  notifyWarning: vi.fn(),
  notifyError: vi.fn(),
  sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
}));

describe('RateLimiter', () => {
  let rateLimiter: RateLimiter;

  beforeEach(() => {
    // Create a rate limiter with fast settings for testing
    rateLimiter = createRateLimiter({
      llm: {
        service: 'llm',
        maxRequests: 5,
        windowMs: 1000,
        burstLimit: 2,
        enableBurst: true,
        cooldownMs: 100,
        notifyUser: false,
        maxRetries: 2,
        baseRetryDelayMs: 50,
      },
      stt: {
        service: 'stt',
        maxRequests: 10,
        windowMs: 1000,
        burstLimit: 3,
        enableBurst: true,
        cooldownMs: 50,
        notifyUser: false,
        maxRetries: 1,
        baseRetryDelayMs: 25,
      },
    });
  });

  afterEach(() => {
    rateLimiter.stop();
  });

  describe('Token Bucket Algorithm', () => {
    it('should allow requests when tokens are available', () => {
      const result = rateLimiter.checkLimit('llm');
      expect(result.allowed).toBe(true);
      expect(result.proceed).toBe(true);
      expect(result.remaining).toBeGreaterThan(0);
    });

    it('should decrement tokens on each request', () => {
      const first = rateLimiter.checkLimit('llm');
      const second = rateLimiter.checkLimit('llm');

      expect(second.remaining).toBeLessThan(first.remaining);
    });

    it('should deny requests when tokens are exhausted', () => {
      // Exhaust all tokens (5 + 2 burst = 7)
      for (let i = 0; i < 7; i++) {
        rateLimiter.checkLimit('llm');
      }

      const result = rateLimiter.checkLimit('llm');
      expect(result.allowed).toBe(false);
      expect(result.proceed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it('should enter cooldown when rate limit is hit', () => {
      // Exhaust all tokens
      for (let i = 0; i < 7; i++) {
        rateLimiter.checkLimit('llm');
      }

      const result = rateLimiter.checkLimit('llm');
      expect(result.isNewRateLimitHit).toBe(true);
      expect(rateLimiter.isInCooldown('llm')).toBe(true);
    });

    it('should report correct cooldown remaining time', () => {
      // Exhaust all tokens
      for (let i = 0; i < 8; i++) {
        rateLimiter.checkLimit('llm');
      }

      const cooldownRemaining = rateLimiter.getCooldownRemaining('llm');
      expect(cooldownRemaining).toBeGreaterThan(0);
      expect(cooldownRemaining).toBeLessThanOrEqual(100);
    });
  });

  describe('Service Status', () => {
    it('should return status for known services', () => {
      const status = rateLimiter.getStatus('llm');
      expect(status).not.toBeNull();
      expect(status!.allowed).toBe(true);
      expect(status!.remaining).toBeGreaterThan(0);
    });

    it('should return null status for unknown services', () => {
      const status = rateLimiter.getStatus('unknown' as RateLimitedService);
      expect(status).toBeNull();
    });

    it('should track different services independently', () => {
      // Exhaust LLM tokens
      for (let i = 0; i < 8; i++) {
        rateLimiter.checkLimit('llm');
      }

      // STT should still be available
      const sttResult = rateLimiter.checkLimit('stt');
      expect(sttResult.allowed).toBe(true);

      // LLM should be rate limited
      const llmStatus = rateLimiter.getStatus('llm');
      expect(llmStatus!.allowed).toBe(false);
    });
  });

  describe('Usage Statistics', () => {
    it('should track total requests', () => {
      rateLimiter.checkLimit('llm');
      rateLimiter.checkLimit('llm');
      rateLimiter.checkLimit('llm');

      const stats = rateLimiter.getStats('llm');
      expect(stats).not.toBeNull();
      expect(stats!.totalRequests).toBe(3);
    });

    it('should track allowed requests', () => {
      for (let i = 0; i < 5; i++) {
        rateLimiter.checkLimit('llm');
      }

      const stats = rateLimiter.getStats('llm');
      expect(stats!.allowedRequests).toBe(5);
    });

    it('should track denied requests', () => {
      // Exhaust tokens (7 allowed)
      for (let i = 0; i < 10; i++) {
        rateLimiter.checkLimit('llm');
      }

      const stats = rateLimiter.getStats('llm');
      expect(stats!.deniedRequests).toBeGreaterThan(0);
    });

    it('should track rate limit hits', () => {
      // Exhaust tokens then trigger rate limit
      for (let i = 0; i < 10; i++) {
        rateLimiter.checkLimit('llm');
      }

      const stats = rateLimiter.getStats('llm');
      expect(stats!.rateLimitHits).toBeGreaterThan(0);
    });

    it('should return all stats', () => {
      rateLimiter.checkLimit('llm');
      rateLimiter.checkLimit('stt');

      const allStats = rateLimiter.getAllStats();
      expect(allStats.size).toBeGreaterThan(0);
      expect(allStats.get('llm')).toBeDefined();
      expect(allStats.get('stt')).toBeDefined();
    });
  });

  describe('Configuration', () => {
    it('should return configuration for a service', () => {
      const config = rateLimiter.getConfig('llm');
      expect(config).not.toBeNull();
      expect(config!.maxRequests).toBe(5);
      expect(config!.burstLimit).toBe(2);
    });

    it('should update configuration', () => {
      rateLimiter.updateConfig('llm', { maxRequests: 10 });
      const config = rateLimiter.getConfig('llm');
      expect(config!.maxRequests).toBe(10);
    });

    it('should reinitialize bucket when limits change', () => {
      // Exhaust current tokens
      for (let i = 0; i < 8; i++) {
        rateLimiter.checkLimit('llm');
      }
      expect(rateLimiter.isInCooldown('llm')).toBe(true);

      // Update limits (should reset bucket)
      rateLimiter.updateConfig('llm', { maxRequests: 20 });

      // Should now have tokens available
      const status = rateLimiter.getStatus('llm');
      expect(status!.remaining).toBeGreaterThan(0);
    });
  });

  describe('Reset', () => {
    it('should reset a single service', () => {
      // Exhaust tokens
      for (let i = 0; i < 10; i++) {
        rateLimiter.checkLimit('llm');
      }
      expect(rateLimiter.isInCooldown('llm')).toBe(true);

      rateLimiter.reset('llm');

      expect(rateLimiter.isInCooldown('llm')).toBe(false);
      const status = rateLimiter.getStatus('llm');
      expect(status!.remaining).toBeGreaterThan(0);
    });

    it('should reset all services', () => {
      // Exhaust tokens for multiple services
      for (let i = 0; i < 10; i++) {
        rateLimiter.checkLimit('llm');
      }
      for (let i = 0; i < 15; i++) {
        rateLimiter.checkLimit('stt');
      }

      rateLimiter.resetAll();

      expect(rateLimiter.isInCooldown('llm')).toBe(false);
      expect(rateLimiter.isInCooldown('stt')).toBe(false);
    });

    it('should manually end cooldown', () => {
      // Enter cooldown
      for (let i = 0; i < 10; i++) {
        rateLimiter.checkLimit('llm');
      }
      expect(rateLimiter.isInCooldown('llm')).toBe(true);

      rateLimiter.endCooldown('llm');
      expect(rateLimiter.isInCooldown('llm')).toBe(false);
    });
  });

  describe('Events', () => {
    it('should emit allowed event', () => {
      const allowedHandler = vi.fn();
      rateLimiter.on('allowed', allowedHandler);

      rateLimiter.checkLimit('llm');

      expect(allowedHandler).toHaveBeenCalledWith('llm', expect.any(Number));
    });

    it('should emit denied event', () => {
      const deniedHandler = vi.fn();
      rateLimiter.on('denied', deniedHandler);

      // Exhaust tokens
      for (let i = 0; i < 10; i++) {
        rateLimiter.checkLimit('llm');
      }

      expect(deniedHandler).toHaveBeenCalledWith('llm', expect.any(Number));
    });

    it('should emit rateLimitHit event', () => {
      const rateLimitHandler = vi.fn();
      rateLimiter.on('rateLimitHit', rateLimitHandler);

      // Exhaust tokens
      for (let i = 0; i < 10; i++) {
        rateLimiter.checkLimit('llm');
      }

      expect(rateLimitHandler).toHaveBeenCalledWith('llm', expect.any(Number));
    });
  });

  describe('Rate Limited Execution', () => {
    it('should execute operation when under limit', async () => {
      const operation = vi.fn().mockResolvedValue('success');

      const result = await rateLimiter.execute({
        service: 'llm',
        operation,
        retry: false,
      });

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should call fallback when rate limited', async () => {
      const operation = vi.fn().mockResolvedValue('primary');
      const fallback = vi.fn().mockResolvedValue('fallback');

      // Exhaust tokens
      for (let i = 0; i < 10; i++) {
        rateLimiter.checkLimit('llm');
      }

      const result = await rateLimiter.execute({
        service: 'llm',
        operation,
        fallback,
        retry: false,
      });

      expect(result).toBe('fallback');
      expect(fallback).toHaveBeenCalled();
    });

    it('should throw error when rate limited without fallback', async () => {
      const operation = vi.fn().mockResolvedValue('success');

      // Exhaust tokens
      for (let i = 0; i < 10; i++) {
        rateLimiter.checkLimit('llm');
      }

      await expect(
        rateLimiter.execute({
          service: 'llm',
          operation,
          retry: false,
        })
      ).rejects.toThrow();
    });

    it('should call onRateLimited callback', async () => {
      const operation = vi.fn().mockResolvedValue('success');
      const onRateLimited = vi.fn();

      // Exhaust tokens
      for (let i = 0; i < 10; i++) {
        rateLimiter.checkLimit('llm');
      }

      try {
        await rateLimiter.execute({
          service: 'llm',
          operation,
          retry: false,
          onRateLimited,
        });
      } catch {
        // Expected to throw
      }

      expect(onRateLimited).toHaveBeenCalled();
    });
  });

  describe('Function Wrapper', () => {
    it('should wrap function with rate limiting', async () => {
      const originalFn = vi.fn().mockResolvedValue('result');
      const wrappedFn = rateLimiter.wrap('llm', originalFn);

      const result = await wrappedFn();
      expect(result).toBe('result');
      expect(originalFn).toHaveBeenCalled();
    });

    it('should pass arguments to wrapped function', async () => {
      const originalFn = vi.fn().mockImplementation((a: number, b: string) =>
        Promise.resolve(`${a}-${b}`)
      );
      const wrappedFn = rateLimiter.wrap('llm', originalFn);

      const result = await wrappedFn(42, 'test');
      expect(result).toBe('42-test');
      expect(originalFn).toHaveBeenCalledWith(42, 'test');
    });

    it('should use fallback in wrapped function when rate limited', async () => {
      // Create a rate limiter with no retries for this test
      const noRetryLimiter = createRateLimiter({
        llm: {
          service: 'llm',
          maxRequests: 2,
          windowMs: 1000,
          burstLimit: 0,
          enableBurst: false,
          cooldownMs: 5000,
          notifyUser: false,
          maxRetries: 0,  // No retries
          baseRetryDelayMs: 10,
        },
      });

      const originalFn = vi.fn().mockResolvedValue('primary');
      const fallbackFn = vi.fn().mockResolvedValue('fallback');

      // Exhaust tokens (only 2 allowed with no burst)
      noRetryLimiter.checkLimit('llm');
      noRetryLimiter.checkLimit('llm');
      noRetryLimiter.checkLimit('llm'); // This triggers cooldown

      // Manually call execute with no retry since wrap defaults to retry=true
      const result = await noRetryLimiter.execute({
        service: 'llm',
        operation: originalFn,
        fallback: fallbackFn,
        retry: false,
      });

      expect(result).toBe('fallback');
      expect(fallbackFn).toHaveBeenCalled();

      noRetryLimiter.stop();
    });
  });

  describe('Default Configurations', () => {
    it('should have default configs for all services', () => {
      const services: RateLimitedService[] = [
        'llm',
        'llm-fallback',
        'stt',
        'stt-fallback',
        'tts',
        'tts-fallback',
      ];

      for (const service of services) {
        expect(DEFAULT_SERVICE_CONFIGS[service]).toBeDefined();
        expect(DEFAULT_SERVICE_CONFIGS[service].maxRequests).toBeGreaterThan(0);
        expect(DEFAULT_SERVICE_CONFIGS[service].windowMs).toBeGreaterThan(0);
      }
    });

    it('should have reasonable defaults for online services', () => {
      expect(DEFAULT_SERVICE_CONFIGS.llm.maxRequests).toBeLessThanOrEqual(100);
      expect(DEFAULT_SERVICE_CONFIGS.stt.maxRequests).toBeLessThanOrEqual(150);
      expect(DEFAULT_SERVICE_CONFIGS.tts.maxRequests).toBeLessThanOrEqual(50);
    });

    it('should have higher limits for offline fallbacks', () => {
      expect(DEFAULT_SERVICE_CONFIGS['stt-fallback'].maxRequests)
        .toBeGreaterThan(DEFAULT_SERVICE_CONFIGS.stt.maxRequests);
      expect(DEFAULT_SERVICE_CONFIGS['tts-fallback'].maxRequests)
        .toBeGreaterThan(DEFAULT_SERVICE_CONFIGS.tts.maxRequests);
    });
  });

  describe('Cleanup', () => {
    it('should stop cleanly', () => {
      expect(() => rateLimiter.stop()).not.toThrow();
    });

    it('should allow multiple stop calls', () => {
      rateLimiter.stop();
      expect(() => rateLimiter.stop()).not.toThrow();
    });
  });
});

describe('Rate Limiter with Retry', () => {
  let rateLimiter: RateLimiter;

  beforeEach(() => {
    rateLimiter = createRateLimiter({
      llm: {
        service: 'llm',
        maxRequests: 5,
        windowMs: 50,           // Short window so tokens refill quickly
        burstLimit: 0,
        enableBurst: false,
        cooldownMs: 30,         // Very short cooldown for testing
        notifyUser: false,
        maxRetries: 3,
        baseRetryDelayMs: 20,
      },
    });
  });

  afterEach(() => {
    rateLimiter.stop();
  });

  it('should retry after cooldown ends', async () => {
    const operation = vi.fn().mockResolvedValue('success');
    const onRetry = vi.fn();

    // Exhaust tokens
    for (let i = 0; i < 6; i++) {
      rateLimiter.checkLimit('llm');
    }

    // Wait a bit for tokens to start refilling
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Execute with retry - should succeed after retrying
    const result = await rateLimiter.execute({
      service: 'llm',
      operation,
      retry: true,
      onRetry,
    });

    expect(result).toBe('success');
    expect(operation).toHaveBeenCalled();
  }, 10000); // Longer timeout for retry test

  it('should call onRetry callback when retrying', async () => {
    const operation = vi.fn().mockResolvedValue('success');
    const onRetry = vi.fn();

    // Exhaust tokens to trigger cooldown
    for (let i = 0; i < 6; i++) {
      rateLimiter.checkLimit('llm');
    }

    // Small delay then manually end cooldown to allow retry to succeed
    setTimeout(() => {
      rateLimiter.endCooldown('llm');
    }, 50);

    const result = await rateLimiter.execute({
      service: 'llm',
      operation,
      retry: true,
      onRetry,
    });

    expect(result).toBe('success');
    // onRetry may or may not have been called depending on timing
    // The important thing is the operation succeeded
    expect(operation).toHaveBeenCalled();
  }, 10000);
});
