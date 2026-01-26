/**
 * Nova Desktop - Voice Pipeline Tests
 * Tests for the integrated voice pipeline
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// Mock all external dependencies
vi.mock('@picovoice/porcupine-node', () => ({
  BuiltinKeywords: { JARVIS: 'jarvis' },
  Porcupine: vi.fn().mockImplementation(() => ({
    process: vi.fn().mockReturnValue(-1),
    frameLength: 512,
    sampleRate: 16000,
    release: vi.fn(),
  })),
}));

vi.mock('@picovoice/pvrecorder-node', () => ({
  PvRecorder: vi.fn().mockImplementation(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    read: vi.fn().mockReturnValue(new Int16Array(512)),
    getSelectedDevice: vi.fn().mockReturnValue(0),
    release: vi.fn(),
  })),
}));

vi.mock('@ricky0123/vad-node', () => ({
  Silero: vi.fn().mockResolvedValue({
    process: vi.fn().mockResolvedValue({ isSpeech: false, probability: 0.1 }),
  }),
}));

// Mock fetch for TTS
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock fs
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn(() => true),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    readFileSync: vi.fn(),
    readdirSync: vi.fn(() => []),
  };
});

// Mock electron
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

// Mock OpenAI for LLM
vi.mock('openai', () => ({
  default: vi.fn(() => ({
    chat: {
      completions: {
        create: vi.fn(),
      },
    },
  })),
}));

import {
  VoicePipeline,
  VoicePipelineConfig,
  float32ToInt16,
  int16ToFloat32,
  bufferToInt16,
  int16ToBuffer,
  getVoicePipeline,
  shutdownVoicePipeline,
} from '../src/main/voice/voice-pipeline';

describe('VoicePipeline', () => {
  let pipeline: VoicePipeline;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    pipeline = new VoicePipeline({
      audio: { enableWakeWord: false, enableVAD: false },
    });
  });

  afterEach(async () => {
    await pipeline.stop();
    vi.clearAllTimers();
  });

  describe('Constructor', () => {
    it('should create instance with default config', () => {
      const instance = new VoicePipeline();
      expect(instance.state).toBe('idle');
      expect(instance.running).toBe(false);
    });

    it('should merge custom config with defaults', () => {
      const instance = new VoicePipeline({
        userName: 'TestUser',
        enableHistory: false,
        ttsBufferSize: 100,
      });

      const config = instance.getConfig();
      expect(config.userName).toBe('TestUser');
      expect(config.enableHistory).toBe(false);
      expect(config.ttsBufferSize).toBe(100);
      expect(config.streamToTTS).toBe(true); // Default
    });
  });

  describe('getStatus()', () => {
    it('should return initial status', () => {
      const status = pipeline.getStatus();
      expect(status.state).toBe('idle');
      expect(status.isListening).toBe(false);
      expect(status.isSpeaking).toBe(false);
      expect(status.currentTranscript).toBe('');
      expect(status.currentResponse).toBe('');
    });
  });

  describe('Configuration', () => {
    it('should update config', () => {
      pipeline.updateConfig({ userName: 'NewUser' });
      const config = pipeline.getConfig();
      expect(config.userName).toBe('NewUser');
    });

    it('should not mutate original config', () => {
      const config1 = pipeline.getConfig();
      config1.userName = 'Modified';
      const config2 = pipeline.getConfig();
      expect(config2.userName).not.toBe('Modified');
    });
  });

  describe('Conversation Context', () => {
    it('should have no context initially without history', () => {
      const instance = new VoicePipeline({ enableHistory: false });
      expect(instance.getConversationContext()).toBeNull();
    });

    it('should clear conversation history', () => {
      const instance = new VoicePipeline({ enableHistory: true });
      // Force initialize context
      (instance as unknown as { conversationContext: object }).conversationContext = {
        messages: [{ role: 'user', content: 'test' }],
      };

      instance.clearHistory();
      // Context should be reset
    });
  });

  describe('Metrics', () => {
    it('should return empty metrics initially', () => {
      const metrics = pipeline.getMetrics();
      expect(metrics).toEqual({});
    });
  });

  describe('Event Emitter', () => {
    it('should support on() for state-change events', () => {
      const listener = vi.fn();
      pipeline.on('state-change', listener);

      // Manually trigger state change for testing
      (pipeline as unknown as { setState: (s: string) => void }).setState('listening');

      expect(listener).toHaveBeenCalledWith('listening', 'idle');
    });

    it('should support off() to remove listeners', () => {
      const listener = vi.fn();
      pipeline.on('state-change', listener);
      pipeline.off('state-change', listener);

      (pipeline as unknown as { setState: (s: string) => void }).setState('listening');

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('triggerWake()', () => {
    it('should not trigger wake when not running', () => {
      // Pipeline not started
      pipeline.triggerWake();
      // Should log warning, not crash
      expect(pipeline.state).toBe('idle');
    });
  });
});

describe('Audio Format Conversion', () => {
  describe('float32ToInt16()', () => {
    it('should convert Float32Array to Int16Array', () => {
      const float32 = new Float32Array([0, 0.5, 1.0, -0.5, -1.0]);
      const int16 = float32ToInt16(float32);

      expect(int16).toBeInstanceOf(Int16Array);
      expect(int16.length).toBe(5);
      expect(int16[0]).toBe(0);
      expect(int16[2]).toBe(32767); // Max positive
      expect(int16[4]).toBe(-32768); // Max negative
    });

    it('should clamp values outside -1 to 1 range', () => {
      const float32 = new Float32Array([1.5, -1.5, 2.0, -2.0]);
      const int16 = float32ToInt16(float32);

      expect(int16[0]).toBe(32767);
      expect(int16[1]).toBe(-32768);
      expect(int16[2]).toBe(32767);
      expect(int16[3]).toBe(-32768);
    });

    it('should handle empty array', () => {
      const float32 = new Float32Array([]);
      const int16 = float32ToInt16(float32);
      expect(int16.length).toBe(0);
    });
  });

  describe('int16ToFloat32()', () => {
    it('should convert Int16Array to Float32Array', () => {
      const int16 = new Int16Array([0, 16383, 32767, -16384, -32768]);
      const float32 = int16ToFloat32(int16);

      expect(float32).toBeInstanceOf(Float32Array);
      expect(float32.length).toBe(5);
      expect(float32[0]).toBeCloseTo(0, 5);
      expect(float32[2]).toBeCloseTo(1.0, 5);
      expect(float32[4]).toBeCloseTo(-1.0, 5);
    });

    it('should handle empty array', () => {
      const int16 = new Int16Array([]);
      const float32 = int16ToFloat32(int16);
      expect(float32.length).toBe(0);
    });
  });

  describe('Round-trip conversion', () => {
    it('should approximately preserve values through round-trip', () => {
      const original = new Float32Array([0, 0.25, 0.5, 0.75, 1.0, -0.25, -0.5, -0.75, -1.0]);
      const int16 = float32ToInt16(original);
      const backToFloat = int16ToFloat32(int16);

      for (let i = 0; i < original.length; i++) {
        expect(backToFloat[i]).toBeCloseTo(original[i], 3);
      }
    });
  });

  describe('bufferToInt16()', () => {
    it('should convert Buffer to Int16Array', () => {
      // Create buffer with known values
      const buffer = Buffer.alloc(8);
      buffer.writeInt16LE(0, 0);
      buffer.writeInt16LE(1000, 2);
      buffer.writeInt16LE(-1000, 4);
      buffer.writeInt16LE(32767, 6);

      const int16 = bufferToInt16(buffer);

      expect(int16).toBeInstanceOf(Int16Array);
      expect(int16.length).toBe(4);
      expect(int16[0]).toBe(0);
      expect(int16[1]).toBe(1000);
      expect(int16[2]).toBe(-1000);
      expect(int16[3]).toBe(32767);
    });
  });

  describe('int16ToBuffer()', () => {
    it('should convert Int16Array to Buffer', () => {
      const int16 = new Int16Array([0, 1000, -1000, 32767]);
      const buffer = int16ToBuffer(int16);

      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBe(8);
      expect(buffer.readInt16LE(0)).toBe(0);
      expect(buffer.readInt16LE(2)).toBe(1000);
      expect(buffer.readInt16LE(4)).toBe(-1000);
      expect(buffer.readInt16LE(6)).toBe(32767);
    });
  });
});

describe('Singleton Functions', () => {
  afterEach(async () => {
    await shutdownVoicePipeline();
  });

  describe('getVoicePipeline()', () => {
    it('should return a VoicePipeline instance', () => {
      const instance = getVoicePipeline();
      expect(instance).toBeInstanceOf(VoicePipeline);
    });

    it('should return same instance on multiple calls', () => {
      const instance1 = getVoicePipeline();
      const instance2 = getVoicePipeline();
      expect(instance1).toBe(instance2);
    });

    it('should accept config on first call', () => {
      const instance = getVoicePipeline({ userName: 'SingletonUser' });
      expect(instance.getConfig().userName).toBe('SingletonUser');
    });
  });

  describe('shutdownVoicePipeline()', () => {
    it('should shutdown the singleton instance', async () => {
      const instance = getVoicePipeline();
      await shutdownVoicePipeline();

      // Next call should create new instance
      const newInstance = getVoicePipeline();
      expect(newInstance).not.toBe(instance);
    });

    it('should handle multiple shutdown calls', async () => {
      await shutdownVoicePipeline();
      await shutdownVoicePipeline(); // Should not throw
    });
  });
});

describe('VoicePipelineConfig', () => {
  it('should have expected default values', () => {
    const pipeline = new VoicePipeline();
    const config = pipeline.getConfig();

    expect(config.streamToTTS).toBe(true);
    expect(config.ttsBufferSize).toBe(15); // Ultra-low latency default
    expect(config.enableHistory).toBe(true);
    expect(config.maxHistoryTurns).toBe(10);
  });
});
