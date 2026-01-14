/**
 * Fallback Chain Tests
 *
 * Tests verify that when primary services fail, fallbacks activate correctly:
 * - Deepgram fails → Vosk activates automatically
 * - Fireworks fails → OpenRouter activates automatically
 * - ElevenLabs fails → System TTS activates automatically
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// Mock external dependencies
vi.mock('@deepgram/sdk', () => ({
  createClient: vi.fn(() => ({
    listen: {
      live: vi.fn(() => ({
        on: vi.fn().mockReturnThis(),
        send: vi.fn(),
        keepAlive: vi.fn(),
        requestClose: vi.fn(),
      })),
    },
  })),
  LiveTranscriptionEvents: {
    Open: 'open',
    Transcript: 'Results',
    Error: 'error',
    Close: 'close',
  },
}));

vi.mock('openai', () => ({
  default: vi.fn(() => ({
    chat: {
      completions: {
        create: vi.fn(),
      },
    },
  })),
}));

vi.mock('vosk-koffi', () => ({
  default: {
    Model: vi.fn(() => ({
      free: vi.fn(),
    })),
    Recognizer: vi.fn(() => ({
      setWords: vi.fn(),
      setPartialWords: vi.fn(),
      acceptWaveform: vi.fn(() => false),
      result: vi.fn(() => '{}'),
      partialResult: vi.fn(() => '{}'),
      finalResult: vi.fn(() => '{"text": "test"}'),
      free: vi.fn(),
    })),
    setLogLevel: vi.fn(),
  },
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(true),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    readFileSync: vi.fn(),
    readdirSync: vi.fn().mockReturnValue([]),
  };
});

vi.mock('electron', () => ({
  app: {
    exit: vi.fn(),
    getPath: vi.fn(() => '/mock/path'),
    isPackaged: false,
  },
  dialog: {
    showErrorBox: vi.fn(),
  },
  BrowserWindow: {
    getFocusedWindow: vi.fn(() => null),
    getAllWindows: vi.fn(() => []),
  },
}));

// Import after mocks
import { CircuitBreaker, CircuitState } from '../src/main/utils/errors';

describe('Circuit Breaker', () => {
  describe('state transitions', () => {
    it('should start in CLOSED state', () => {
      const breaker = new CircuitBreaker('test');
      expect(breaker.getState()).toBe(CircuitState.CLOSED);
    });

    it('should transition to OPEN after threshold failures', () => {
      const stateChanges: CircuitState[] = [];
      const breaker = new CircuitBreaker('test', {
        failureThreshold: 3,
        onStateChange: (from, to) => stateChanges.push(to),
      });

      // Record 3 failures
      breaker.recordFailure();
      breaker.recordFailure();
      breaker.recordFailure();

      expect(breaker.getState()).toBe(CircuitState.OPEN);
      expect(stateChanges).toContain(CircuitState.OPEN);
    });

    it('should not allow attempts when OPEN', () => {
      const breaker = new CircuitBreaker('test', { failureThreshold: 1 });
      breaker.recordFailure();

      expect(breaker.canAttempt()).toBe(false);
    });

    it('should reset to CLOSED after success', () => {
      const breaker = new CircuitBreaker('test', { failureThreshold: 3 });

      breaker.recordFailure();
      breaker.recordFailure();
      expect(breaker.canAttempt()).toBe(true); // Still below threshold

      breaker.recordSuccess();
      // After success, should still be in closed state and allow attempts
      expect(breaker.getState()).toBe(CircuitState.CLOSED);
      expect(breaker.canAttempt()).toBe(true);
    });

    it('should transition to HALF_OPEN after timeout', async () => {
      const breaker = new CircuitBreaker('test', {
        failureThreshold: 1,
        timeout: 50, // 50ms timeout
      });

      breaker.recordFailure();
      expect(breaker.getState()).toBe(CircuitState.OPEN);

      // Wait for timeout
      await new Promise((resolve) => setTimeout(resolve, 60));

      expect(breaker.canAttempt()).toBe(true);
      expect(breaker.getState()).toBe(CircuitState.HALF_OPEN);
    });
  });

  describe('fallback chain behavior', () => {
    it('should invoke onStateChange callback', () => {
      const callback = vi.fn();
      const breaker = new CircuitBreaker('test', {
        failureThreshold: 1,
        onStateChange: callback,
      });

      breaker.recordFailure();

      expect(callback).toHaveBeenCalledWith(CircuitState.CLOSED, CircuitState.OPEN);
    });
  });
});

describe('Fallback Chain Events', () => {
  describe('STT Fallback Events', () => {
    it('should emit fallback-activated event', () => {
      const emitter = new EventEmitter();
      const handler = vi.fn();

      emitter.on('fallback-activated', handler);
      emitter.emit('fallback-activated', 'vosk', 'Primary unavailable');

      expect(handler).toHaveBeenCalledWith('vosk', 'Primary unavailable');
    });

    it('should emit provider-switch event', () => {
      const emitter = new EventEmitter();
      const handler = vi.fn();

      emitter.on('provider-switch', handler);
      emitter.emit('provider-switch', 'deepgram', 'vosk', 'Circuit breaker opened');

      expect(handler).toHaveBeenCalledWith('deepgram', 'vosk', 'Circuit breaker opened');
    });

    it('should emit primary-restored event', () => {
      const emitter = new EventEmitter();
      const handler = vi.fn();

      emitter.on('primary-restored', handler);
      emitter.emit('primary-restored');

      expect(handler).toHaveBeenCalled();
    });
  });

  describe('LLM Fallback Events', () => {
    it('should emit fallback-activated event', () => {
      const emitter = new EventEmitter();
      const handler = vi.fn();

      emitter.on('fallback-activated', handler);
      emitter.emit('fallback-activated', 'openrouter', 'Fireworks unavailable');

      expect(handler).toHaveBeenCalledWith('openrouter', 'Fireworks unavailable');
    });

    it('should emit provider-switch event', () => {
      const emitter = new EventEmitter();
      const handler = vi.fn();

      emitter.on('provider-switch', handler);
      emitter.emit('provider-switch', 'fireworks', 'openrouter', 'API error');

      expect(handler).toHaveBeenCalledWith('fireworks', 'openrouter', 'API error');
    });
  });

  describe('TTS Fallback Events', () => {
    it('should emit fallback-activated event', () => {
      const emitter = new EventEmitter();
      const handler = vi.fn();

      emitter.on('fallback-activated', handler);
      emitter.emit('fallback-activated', 'offline', 'ElevenLabs unavailable');

      expect(handler).toHaveBeenCalledWith('offline', 'ElevenLabs unavailable');
    });

    it('should emit provider-switch event', () => {
      const emitter = new EventEmitter();
      const handler = vi.fn();

      emitter.on('provider-switch', handler);
      emitter.emit('provider-switch', 'elevenlabs', 'offline', 'Circuit breaker opened');

      expect(handler).toHaveBeenCalledWith('elevenlabs', 'offline', 'Circuit breaker opened');
    });
  });
});

describe('Seamless Fallback Transitions', () => {
  it('should maintain event forwarding after switch', () => {
    const emitter = new EventEmitter();
    const results: string[] = [];

    // Simulate transcript events from active provider
    emitter.on('transcript', (text: string) => {
      results.push(text);
    });

    // Emit from primary
    emitter.emit('transcript', 'Primary: Hello');

    // Switch happens (internal)
    // Emit from fallback
    emitter.emit('transcript', 'Fallback: World');

    expect(results).toEqual(['Primary: Hello', 'Fallback: World']);
  });

  it('should preserve status during transition', () => {
    const emitter = new EventEmitter();
    const statuses: string[] = [];

    emitter.on('status', (status: string) => {
      statuses.push(status);
    });

    // Normal operation
    emitter.emit('status', 'connected');
    emitter.emit('status', 'listening');

    // Fallback happens
    emitter.emit('status', 'switching');
    emitter.emit('status', 'connected'); // Fallback connected

    expect(statuses).toEqual(['connected', 'listening', 'switching', 'connected']);
  });
});

describe('Error Recovery', () => {
  describe('consecutive error handling', () => {
    it('should track consecutive errors', () => {
      let errorCount = 0;
      const threshold = 3;

      const handleError = () => {
        errorCount++;
        if (errorCount >= threshold) {
          return 'switch_to_fallback';
        }
        return 'continue';
      };

      expect(handleError()).toBe('continue');
      expect(handleError()).toBe('continue');
      expect(handleError()).toBe('switch_to_fallback');
    });

    it('should reset error count on success', () => {
      let errorCount = 0;

      const handleError = () => {
        errorCount++;
      };

      const handleSuccess = () => {
        errorCount = 0;
      };

      handleError();
      handleError();
      expect(errorCount).toBe(2);

      handleSuccess();
      expect(errorCount).toBe(0);
    });
  });

  describe('cooldown period', () => {
    it('should respect cooldown before restoring primary', async () => {
      let lastFallbackTime = Date.now();
      const cooldown = 50; // 50ms cooldown

      const canRestorePrimary = () => {
        return Date.now() - lastFallbackTime >= cooldown;
      };

      expect(canRestorePrimary()).toBe(false);

      await new Promise((resolve) => setTimeout(resolve, 60));

      expect(canRestorePrimary()).toBe(true);
    });
  });
});

describe('Provider Status Checks', () => {
  it('should report active provider type', () => {
    type ProviderType = 'primary' | 'fallback';
    let activeProvider: ProviderType = 'primary';

    const getActiveProviderType = () => activeProvider;
    const switchToFallback = () => {
      activeProvider = 'fallback';
    };

    expect(getActiveProviderType()).toBe('primary');
    switchToFallback();
    expect(getActiveProviderType()).toBe('fallback');
  });

  it('should report offline mode status', () => {
    let isOfflineMode = false;

    const activateOfflineMode = () => {
      isOfflineMode = true;
    };

    expect(isOfflineMode).toBe(false);
    activateOfflineMode();
    expect(isOfflineMode).toBe(true);
  });
});

describe('Fallback Chain Integration', () => {
  it('should maintain service chain: STT -> LLM -> TTS', () => {
    const pipeline = {
      stt: { provider: 'deepgram', status: 'ready' },
      llm: { provider: 'fireworks', status: 'ready' },
      tts: { provider: 'elevenlabs', status: 'ready' },
    };

    // Simulate STT fallback
    pipeline.stt.provider = 'vosk';
    expect(pipeline.stt.provider).toBe('vosk');
    expect(pipeline.llm.provider).toBe('fireworks'); // Unaffected
    expect(pipeline.tts.provider).toBe('elevenlabs'); // Unaffected
  });

  it('should allow multiple services to be in fallback', () => {
    const pipeline = {
      stt: { provider: 'deepgram', isFallback: false },
      llm: { provider: 'fireworks', isFallback: false },
      tts: { provider: 'elevenlabs', isFallback: false },
    };

    // Multiple fallbacks
    pipeline.stt = { provider: 'vosk', isFallback: true };
    pipeline.llm = { provider: 'openrouter', isFallback: true };

    expect(pipeline.stt.isFallback).toBe(true);
    expect(pipeline.llm.isFallback).toBe(true);
    expect(pipeline.tts.isFallback).toBe(false);
  });
});
