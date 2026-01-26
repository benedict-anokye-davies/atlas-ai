/**
 * Vosk STT and STT Manager Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// Mock vosk-koffi
const mockRecognizer = {
  setWords: vi.fn(),
  setMaxAlternatives: vi.fn(),
  acceptWaveform: vi.fn().mockReturnValue(false),
  result: vi.fn().mockReturnValue('{"text": "hello world"}'),
  partialResult: vi.fn().mockReturnValue('{"partial": "hello"}'),
  finalResult: vi.fn().mockReturnValue('{"text": "hello world"}'),
  reset: vi.fn(),
  free: vi.fn(),
};

const mockModel = {
  free: vi.fn(),
};

vi.mock('vosk-koffi', () => ({
  setLogLevel: vi.fn(),
  Model: vi.fn().mockImplementation(() => mockModel),
  Recognizer: vi.fn().mockImplementation(() => mockRecognizer),
}));

// Mock fs operations
vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return {
    ...actual,
    promises: {
      stat: vi.fn().mockResolvedValue({ isDirectory: () => true }),
      unlink: vi.fn().mockResolvedValue(undefined),
    },
    existsSync: vi.fn().mockReturnValue(true),
    mkdirSync: vi.fn(),
    createWriteStream: vi.fn().mockReturnValue({
      on: vi.fn(),
      close: vi.fn(),
    }),
    unlinkSync: vi.fn(),
  };
});

// Mock adm-zip
vi.mock('adm-zip', () => ({
  default: vi.fn().mockImplementation(() => ({
    extractAllTo: vi.fn(),
  })),
}));

// Mock logger
vi.mock('../src/main/utils/logger', () => ({
  createModuleLogger: vi.fn().mockReturnValue({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
  PerformanceTimer: vi.fn().mockImplementation(() => ({
    start: vi.fn(),
    end: vi.fn(),
  })),
}));

// Mock errors
vi.mock('../src/main/utils/errors', () => ({
  APIError: class APIError extends Error {
    constructor(message: string) {
      super(message);
    }
  },
  withRetry: vi.fn().mockImplementation((fn) => fn()),
  CircuitBreaker: vi.fn().mockImplementation(() => ({
    canAttempt: vi.fn().mockReturnValue(true),
    recordSuccess: vi.fn(),
    recordFailure: vi.fn(),
  })),
}));

import { VoskSTT, VoskConfig, VOSK_MODELS, DEFAULT_VOSK_MODEL } from '../src/main/stt/vosk';
import { STTManager, STTManagerConfig } from '../src/main/stt/manager';
import { STTStatus } from '../src/shared/types/stt';

describe('VoskSTT', () => {
  let vosk: VoskSTT;

  beforeEach(() => {
    vi.clearAllMocks();
    vosk = new VoskSTT({
      modelName: 'vosk-model-small-en-us-0.15',
      autoDownload: false,
    });
  });

  afterEach(async () => {
    if (vosk) {
      await vosk.stop();
    }
  });

  describe('constructor', () => {
    it('should create instance with default config', () => {
      const instance = new VoskSTT();
      expect(instance).toBeInstanceOf(VoskSTT);
      expect(instance.name).toBe('vosk');
      expect(instance.status).toBe(STTStatus.IDLE);
    });

    it('should create instance with custom config', () => {
      const config: Partial<VoskConfig> = {
        modelName: 'vosk-model-en-us-0.22-lgraph',
        words: true,
        maxAlternatives: 3,
      };
      const instance = new VoskSTT(config);
      expect(instance).toBeInstanceOf(VoskSTT);
    });
  });

  describe('model constants', () => {
    it('should have available models defined', () => {
      expect(VOSK_MODELS).toBeDefined();
      expect(Object.keys(VOSK_MODELS).length).toBeGreaterThan(0);
    });

    it('should have default model defined', () => {
      expect(DEFAULT_VOSK_MODEL).toBeDefined();
      expect(VOSK_MODELS[DEFAULT_VOSK_MODEL]).toBeDefined();
    });

    it('should have model info for each model', () => {
      Object.values(VOSK_MODELS).forEach((model) => {
        expect(model.name).toBeDefined();
        expect(model.url).toBeDefined();
        expect(model.size).toBeDefined();
        expect(model.description).toBeDefined();
      });
    });
  });

  describe('static methods', () => {
    it('should list available models', () => {
      const models = VoskSTT.getAvailableModels();
      expect(Array.isArray(models)).toBe(true);
      expect(models.length).toBeGreaterThan(0);
    });
  });

  describe('start/stop', () => {
    it('should start successfully', async () => {
      const openHandler = vi.fn();
      vosk.on('open', openHandler);

      await vosk.start();

      expect(vosk.status).toBe(STTStatus.CONNECTED);
      expect(openHandler).toHaveBeenCalled();
    });

    it('should emit status events on start', async () => {
      const statusHandler = vi.fn();
      vosk.on('status', statusHandler);

      await vosk.start();

      expect(statusHandler).toHaveBeenCalledWith(STTStatus.CONNECTING);
      expect(statusHandler).toHaveBeenCalledWith(STTStatus.CONNECTED);
    });

    it('should stop successfully', async () => {
      await vosk.start();
      await vosk.stop();

      expect(vosk.status).toBe(STTStatus.CLOSED);
    });

    it('should emit close event on stop', async () => {
      const closeHandler = vi.fn();
      vosk.on('close', closeHandler);

      await vosk.start();
      await vosk.stop();

      expect(closeHandler).toHaveBeenCalled();
    });

    it('should not start twice', async () => {
      await vosk.start();
      await vosk.start(); // Should not throw

      expect(vosk.status).toBe(STTStatus.CONNECTED);
    });
  });

  describe('sendAudio', () => {
    beforeEach(async () => {
      await vosk.start();
    });

    it('should process audio buffer', () => {
      const audioData = Buffer.alloc(1024);
      vosk.sendAudio(audioData);

      expect(mockRecognizer.acceptWaveform).toHaveBeenCalled();
    });

    it('should process Int16Array', () => {
      const audioData = new Int16Array(512);
      vosk.sendAudio(audioData);

      expect(mockRecognizer.acceptWaveform).toHaveBeenCalled();
    });

    it('should emit interim results', () => {
      const interimHandler = vi.fn();
      vosk.on('interim', interimHandler);

      mockRecognizer.acceptWaveform.mockReturnValueOnce(false);
      mockRecognizer.partialResult.mockReturnValueOnce('{"partial": "test"}');

      const audioData = new Int16Array(512);
      vosk.sendAudio(audioData);

      expect(interimHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          text: 'test',
          isFinal: false,
        })
      );
    });

    it('should emit final results when utterance complete', () => {
      const finalHandler = vi.fn();
      vosk.on('final', finalHandler);

      mockRecognizer.acceptWaveform.mockReturnValueOnce(true);
      mockRecognizer.result.mockReturnValueOnce('{"text": "final test"}');

      const audioData = new Int16Array(512);
      vosk.sendAudio(audioData);

      expect(finalHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          text: 'final test',
          isFinal: true,
        })
      );
    });

    it('should not process audio when not ready', async () => {
      await vosk.stop();

      const audioData = new Int16Array(512);
      vosk.sendAudio(audioData);

      // Should not call acceptWaveform when stopped
      expect(mockRecognizer.acceptWaveform).not.toHaveBeenCalled();
    });
  });

  describe('flush', () => {
    beforeEach(async () => {
      await vosk.start();
    });

    it('should flush recognizer and return final result', () => {
      mockRecognizer.finalResult.mockReturnValueOnce('{"text": "flushed result"}');

      const result = vosk.flush();

      expect(result).toBeDefined();
      expect(result?.text).toBe('flushed result');
      expect(result?.isFinal).toBe(true);
    });

    it('should return null for empty flush', () => {
      mockRecognizer.finalResult.mockReturnValueOnce('{"text": ""}');

      const result = vosk.flush();

      expect(result).toBeNull();
    });
  });

  describe('reset', () => {
    beforeEach(async () => {
      await vosk.start();
    });

    it('should reset recognizer', () => {
      vosk.reset();

      expect(mockRecognizer.reset).toHaveBeenCalled();
    });
  });

  describe('isReady', () => {
    it('should return false when not started', () => {
      expect(vosk.isReady()).toBe(false);
    });

    it('should return true when connected', async () => {
      await vosk.start();
      expect(vosk.isReady()).toBe(true);
    });

    it('should return false after stop', async () => {
      await vosk.start();
      await vosk.stop();
      expect(vosk.isReady()).toBe(false);
    });
  });

  describe('configuration', () => {
    it('should return current config', () => {
      const config = vosk.getConfig();

      expect(config).toBeDefined();
      expect(config.sampleRate).toBeDefined();
    });

    it('should update config', () => {
      vosk.updateConfig({ sampleRate: 48000 });
      const config = vosk.getConfig();

      expect(config.sampleRate).toBe(48000);
    });
  });
});

describe('STTManager', () => {
  let manager: STTManager;

  // Mock Deepgram
  const mockDeepgram = new EventEmitter() as any;
  mockDeepgram.name = 'deepgram';
  mockDeepgram.start = vi.fn().mockResolvedValue(undefined);
  mockDeepgram.stop = vi.fn().mockResolvedValue(undefined);
  mockDeepgram.sendAudio = vi.fn();
  mockDeepgram.isReady = vi.fn().mockReturnValue(true);
  mockDeepgram.getConfig = vi.fn().mockReturnValue({ apiKey: 'test' });
  mockDeepgram.status = STTStatus.CONNECTED;

  // Mock Vosk
  const mockVosk = new EventEmitter() as any;
  mockVosk.name = 'vosk';
  mockVosk.start = vi.fn().mockResolvedValue(undefined);
  mockVosk.stop = vi.fn().mockResolvedValue(undefined);
  mockVosk.sendAudio = vi.fn();
  mockVosk.isReady = vi.fn().mockReturnValue(true);
  mockVosk.getConfig = vi.fn().mockReturnValue({});
  mockVosk.status = STTStatus.CONNECTED;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDeepgram.start.mockResolvedValue(undefined);
    mockVosk.start.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    if (manager) {
      await manager.stop();
    }
  });

  describe('constructor', () => {
    it('should create instance with default config', () => {
      manager = new STTManager();
      expect(manager).toBeInstanceOf(STTManager);
      expect(manager.name).toBe('stt-manager');
    });

    it('should create instance with custom config', () => {
      manager = new STTManager({
        preferOffline: true,
        errorThreshold: 5,
      });
      expect(manager).toBeInstanceOf(STTManager);
    });
  });

  describe('provider selection', () => {
    it('should report default provider after construction', () => {
      manager = new STTManager();
      // Manager pre-selects a default provider (vosk as fallback when no API keys)
      expect(manager.getActiveProviderType()).toBe('vosk');
    });

    it('should report offline mode status when preferOffline set', () => {
      manager = new STTManager({ preferOffline: true });
      // When preferOffline is set, isUsingOffline returns true immediately
      expect(manager.isUsingOffline()).toBe(true);
    });
  });

  describe('offline mode', () => {
    it('should allow setting offline mode', () => {
      manager = new STTManager();
      manager.setOfflineMode(true);
      // Mode is stored, will be used on next start
    });
  });

  describe('configuration', () => {
    it('should return empty config when no provider active', () => {
      manager = new STTManager();
      const config = manager.getConfig();
      expect(config).toBeDefined();
    });
  });

  describe('events', () => {
    it('should support typed event handlers', () => {
      manager = new STTManager();

      const switchHandler = vi.fn();
      manager.on('provider-switch', switchHandler);

      const fallbackHandler = vi.fn();
      manager.on('fallback-activated', fallbackHandler);

      // These should compile without errors
      expect(manager.off).toBeDefined();
      expect(manager.emit).toBeDefined();
    });
  });

  describe('sendAudio', () => {
    it('should not throw when no provider active', () => {
      manager = new STTManager();
      
      // Should not throw
      manager.sendAudio(Buffer.alloc(1024));
    });
  });

  describe('isReady', () => {
    it('should return false when not started', () => {
      manager = new STTManager();
      expect(manager.isReady()).toBe(false);
    });
  });
});

describe('STT Integration', () => {
  it('should have consistent interfaces between providers', () => {
    // Both providers should implement STTProvider interface
    const vosk = new VoskSTT();

    // Check interface compliance
    expect(vosk.name).toBeDefined();
    expect(typeof vosk.start).toBe('function');
    expect(typeof vosk.stop).toBe('function');
    expect(typeof vosk.sendAudio).toBe('function');
    expect(typeof vosk.isReady).toBe('function');
    expect(typeof vosk.getConfig).toBe('function');
  });

  it('should emit same event types', () => {
    const vosk = new VoskSTT();

    // All STT providers should emit these events
    const events = ['status', 'transcript', 'final', 'interim', 'error', 'open', 'close'];

    events.forEach((event) => {
      // Should not throw when adding listeners
      vosk.on(event as any, () => {});
    });
  });
});
