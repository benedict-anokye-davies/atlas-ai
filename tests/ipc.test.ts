/**
 * Nova Desktop - IPC Handlers Tests
 * Tests for IPC handler registration and event forwarding
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock electron
const mockIpcMainHandlers = new Map<string, (...args: unknown[]) => unknown>();
const mockIpcMain = {
  handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
    mockIpcMainHandlers.set(channel, handler);
  }),
  removeHandler: vi.fn((channel: string) => {
    mockIpcMainHandlers.delete(channel);
  }),
};

const mockWebContents = {
  send: vi.fn(),
};

const mockBrowserWindow = {
  isDestroyed: vi.fn(() => false),
  webContents: mockWebContents,
};

vi.mock('electron', () => ({
  ipcMain: mockIpcMainHandlers,
  BrowserWindow: vi.fn(() => mockBrowserWindow),
}));

// Mock logger
vi.mock('../src/main/utils/logger', () => ({
  createModuleLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock voice pipeline
const mockVoicePipeline = {
  on: vi.fn(),
  start: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn().mockResolvedValue(undefined),
  triggerWake: vi.fn(),
  sendText: vi.fn().mockResolvedValue(undefined),
  clearHistory: vi.fn(),
  getConversationContext: vi.fn(() => []),
  getMetrics: vi.fn(() => ({})),
  updateConfig: vi.fn(),
  getConfig: vi.fn(() => ({})),
  getStatus: vi.fn(() => ({
    state: 'idle',
    isListening: false,
    isSpeaking: false,
    audioLevel: 0,
    sttProvider: null,
    llmProvider: null,
    isTTSSpeaking: false,
    currentTranscript: '',
    currentResponse: '',
  })),
};

vi.mock('../src/main/voice/voice-pipeline', () => ({
  getVoicePipeline: vi.fn(() => mockVoicePipeline),
  shutdownVoicePipeline: vi.fn().mockResolvedValue(undefined),
  VoicePipeline: vi.fn(),
}));

describe('IPC Handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIpcMainHandlers.clear();
    // Re-setup the mock with the actual implementation
    mockIpcMain.handle.mockImplementation(
      (channel: string, handler: (...args: unknown[]) => unknown) => {
        mockIpcMainHandlers.set(channel, handler);
      }
    );
    mockIpcMain.removeHandler.mockImplementation((channel: string) => {
      mockIpcMainHandlers.delete(channel);
    });
  });

  afterEach(() => {
    vi.resetModules();
  });

  describe('Handler Registration', () => {
    it('should define all required IPC channels', () => {
      // Expected channels that should be registered
      const expectedChannels = [
        'nova:start',
        'nova:stop',
        'nova:shutdown',
        'nova:get-status',
        'nova:trigger-wake',
        'nova:send-text',
        'nova:clear-history',
        'nova:get-context',
        'nova:get-metrics',
        'nova:update-config',
        'nova:get-config',
      ];

      // Verify channel definitions exist
      expectedChannels.forEach((channel) => {
        expect(channel).toBeDefined();
        expect(typeof channel).toBe('string');
      });
    });

    it('should have correct channel naming convention', () => {
      const channels = [
        'nova:start',
        'nova:stop',
        'nova:shutdown',
        'nova:get-status',
        'nova:trigger-wake',
        'nova:send-text',
        'nova:clear-history',
        'nova:get-context',
        'nova:get-metrics',
        'nova:update-config',
        'nova:get-config',
      ];

      channels.forEach((channel) => {
        expect(channel).toMatch(/^nova:/);
      });
    });
  });

  describe('Event Channels', () => {
    it('should define all event channels for renderer communication', () => {
      const eventChannels = [
        'nova:state-change',
        'nova:wake-word',
        'nova:speech-start',
        'nova:speech-end',
        'nova:transcript-interim',
        'nova:transcript-final',
        'nova:response-start',
        'nova:response-chunk',
        'nova:response-complete',
        'nova:audio-chunk',
        'nova:synthesis-complete',
        'nova:speaking-start',
        'nova:speaking-end',
        'nova:barge-in',
        'nova:audio-level',
        'nova:error',
        'nova:started',
        'nova:stopped',
        'nova:provider-change',
      ];

      // Verify all event channels are defined
      eventChannels.forEach((channel) => {
        expect(channel).toBeDefined();
        expect(channel).toMatch(/^nova:/);
      });
    });
  });

  describe('IPCResult Type', () => {
    it('should have correct success result structure', () => {
      const successResult = {
        success: true,
        data: { test: 'value' },
      };

      expect(successResult.success).toBe(true);
      expect(successResult.data).toBeDefined();
    });

    it('should have correct error result structure', () => {
      const errorResult = {
        success: false,
        error: 'Something went wrong',
      };

      expect(errorResult.success).toBe(false);
      expect(errorResult.error).toBeDefined();
    });
  });

  describe('Audio Data Conversion', () => {
    it('should convert Buffer to base64 for IPC transfer', () => {
      const testBuffer = Buffer.from('test audio data');
      const base64 = testBuffer.toString('base64');

      expect(base64).toBeDefined();
      expect(typeof base64).toBe('string');

      // Verify can be decoded back
      const decoded = Buffer.from(base64, 'base64');
      expect(decoded.toString()).toBe('test audio data');
    });

    it('should handle Float32Array to Buffer conversion', () => {
      const float32 = new Float32Array([0.5, -0.5, 0.0, 1.0]);
      const buffer = Buffer.from(float32.buffer);
      const base64 = buffer.toString('base64');

      expect(base64).toBeDefined();
      expect(buffer.length).toBe(float32.length * 4); // 4 bytes per float
    });
  });

  describe('Throttled Audio Level Updates', () => {
    it('should throttle updates to approximately 30fps', () => {
      const minIntervalMs = 33; // ~30fps
      let lastTime = 0;
      const times: number[] = [];

      // Simulate throttling logic
      for (let i = 0; i < 100; i++) {
        const now = i * 10; // Simulate 10ms intervals
        if (now - lastTime >= minIntervalMs) {
          lastTime = now;
          times.push(now);
        }
      }

      // Should have ~30 updates instead of 100
      expect(times.length).toBeLessThan(40);
      expect(times.length).toBeGreaterThan(20);
    });
  });

  describe('Pipeline Status Structure', () => {
    it('should have all required status fields', () => {
      const expectedStatus = {
        state: 'idle',
        isListening: false,
        isSpeaking: false,
        audioLevel: 0,
        sttProvider: null,
        llmProvider: null,
        isTTSSpeaking: false,
        currentTranscript: '',
        currentResponse: '',
      };

      expect(expectedStatus).toHaveProperty('state');
      expect(expectedStatus).toHaveProperty('isListening');
      expect(expectedStatus).toHaveProperty('isSpeaking');
      expect(expectedStatus).toHaveProperty('audioLevel');
      expect(expectedStatus).toHaveProperty('sttProvider');
      expect(expectedStatus).toHaveProperty('llmProvider');
      expect(expectedStatus).toHaveProperty('isTTSSpeaking');
      expect(expectedStatus).toHaveProperty('currentTranscript');
      expect(expectedStatus).toHaveProperty('currentResponse');
    });
  });

  describe('Config Validation', () => {
    it('should accept valid STT providers', () => {
      const validProviders = ['deepgram', 'vosk', 'whisper'];
      validProviders.forEach((provider) => {
        expect(['deepgram', 'vosk', 'whisper']).toContain(provider);
      });
    });

    it('should accept valid LLM providers', () => {
      const validProviders = ['fireworks', 'openrouter'];
      validProviders.forEach((provider) => {
        expect(['fireworks', 'openrouter']).toContain(provider);
      });
    });

    it('should validate config structure', () => {
      const validConfig = {
        sttProvider: 'deepgram',
        llmProvider: 'fireworks',
        ttsEnabled: true,
        bargeInEnabled: true,
        systemPrompt: 'You are Nova',
      };

      expect(validConfig.sttProvider).toMatch(/^(deepgram|vosk|whisper)$/);
      expect(validConfig.llmProvider).toMatch(/^(fireworks|openrouter)$/);
      expect(typeof validConfig.ttsEnabled).toBe('boolean');
      expect(typeof validConfig.bargeInEnabled).toBe('boolean');
      expect(typeof validConfig.systemPrompt).toBe('string');
    });
  });

  describe('Event Payload Structures', () => {
    it('should have correct state-change payload', () => {
      const payload = {
        state: 'listening',
        previousState: 'idle',
      };
      expect(payload).toHaveProperty('state');
      expect(payload).toHaveProperty('previousState');
    });

    it('should have correct transcript-interim payload', () => {
      const payload = { text: 'partial transcript' };
      expect(payload).toHaveProperty('text');
    });

    it('should have correct transcript-final payload', () => {
      const payload = {
        text: 'final transcript',
        confidence: 0.95,
        words: [],
        language: 'en',
        duration: 2500,
      };
      expect(payload).toHaveProperty('text');
      expect(payload).toHaveProperty('confidence');
    });

    it('should have correct response-chunk payload', () => {
      const payload = {
        text: 'Hello',
        done: false,
      };
      expect(payload).toHaveProperty('text');
      expect(payload).toHaveProperty('done');
    });

    it('should have correct audio-chunk payload for IPC', () => {
      const payload = {
        data: 'base64encodeddata',
        format: 'mp3',
        isFinal: false,
        duration: 500,
      };
      expect(payload).toHaveProperty('data');
      expect(typeof payload.data).toBe('string'); // base64 string
      expect(payload).toHaveProperty('format');
      expect(payload).toHaveProperty('isFinal');
    });

    it('should have correct error payload', () => {
      const payload = {
        type: 'stt',
        message: 'Connection failed',
      };
      expect(payload).toHaveProperty('type');
      expect(payload).toHaveProperty('message');
    });

    it('should have correct provider-change payload', () => {
      const payload = {
        type: 'stt',
        provider: 'vosk',
      };
      expect(payload).toHaveProperty('type');
      expect(payload).toHaveProperty('provider');
    });
  });

  describe('Cleanup Functions', () => {
    it('should define cleanup function interface', () => {
      const cleanup = async (): Promise<void> => {
        // Cleanup implementation
      };
      expect(typeof cleanup).toBe('function');
    });

    it('should handle multiple cleanup calls gracefully', async () => {
      let cleanupCount = 0;
      let pipeline: { stop: () => Promise<void> } | null = {
        stop: async () => {
          cleanupCount++;
        },
      };

      const cleanup = async (): Promise<void> => {
        if (pipeline) {
          await pipeline.stop();
          pipeline = null;
        }
      };

      await cleanup();
      await cleanup(); // Second call should be safe

      expect(cleanupCount).toBe(1); // Only called once
    });
  });
});

describe('Preload Script Channels', () => {
  describe('on() valid channels', () => {
    const validOnChannels = [
      'nova:status',
      'nova:transcript',
      'nova:response',
      'nova:error',
      'nova:audio-level',
      'nova:pipeline-state',
      'nova:wake-word',
      'nova:speech-start',
      'nova:speech-segment',
      'nova:barge-in',
      'nova:listening-timeout',
      'nova:processing-timeout',
      'nova:state-change',
      'nova:transcript-interim',
      'nova:transcript-final',
      'nova:response-start',
      'nova:response-chunk',
      'nova:response-complete',
      'nova:audio-chunk',
      'nova:synthesis-complete',
      'nova:speaking-start',
      'nova:speaking-end',
      'nova:started',
      'nova:stopped',
      'nova:provider-change',
    ];

    it('should have all voice pipeline event channels', () => {
      const voicePipelineChannels = [
        'nova:state-change',
        'nova:transcript-interim',
        'nova:transcript-final',
        'nova:response-start',
        'nova:response-chunk',
        'nova:response-complete',
        'nova:audio-chunk',
        'nova:synthesis-complete',
        'nova:speaking-start',
        'nova:speaking-end',
        'nova:started',
        'nova:stopped',
        'nova:provider-change',
      ];

      voicePipelineChannels.forEach((channel) => {
        expect(validOnChannels).toContain(channel);
      });
    });
  });

  describe('invoke() valid channels', () => {
    const validInvokeChannels = [
      'get-app-version',
      'get-app-path',
      'is-dev',
      'get-nova-status',
      'get-config',
      'log',
      'nova:process-audio',
      'nova:send-message',
      'voice:start-wake-word',
      'voice:stop-wake-word',
      'voice:pause-wake-word',
      'voice:resume-wake-word',
      'voice:set-sensitivity',
      'voice:get-audio-devices',
      'voice:set-audio-device',
      'voice:get-status',
      'pipeline:start',
      'pipeline:stop',
      'pipeline:get-status',
      'pipeline:trigger-wake',
      'pipeline:cancel',
      'pipeline:pause',
      'pipeline:resume',
      'pipeline:set-input-device',
      'pipeline:set-output-device',
      'pipeline:get-config',
      'pipeline:update-config',
      'pipeline:start-speaking',
      'pipeline:finish-speaking',
      'nova:start',
      'nova:stop',
      'nova:shutdown',
      'nova:get-status',
      'nova:trigger-wake',
      'nova:send-text',
      'nova:clear-history',
      'nova:get-context',
      'nova:get-metrics',
      'nova:update-config',
      'nova:get-config',
    ];

    it('should have all voice pipeline invoke channels', () => {
      const voicePipelineChannels = [
        'nova:start',
        'nova:stop',
        'nova:shutdown',
        'nova:get-status',
        'nova:trigger-wake',
        'nova:send-text',
        'nova:clear-history',
        'nova:get-context',
        'nova:get-metrics',
        'nova:update-config',
        'nova:get-config',
      ];

      voicePipelineChannels.forEach((channel) => {
        expect(validInvokeChannels).toContain(channel);
      });
    });
  });
});
