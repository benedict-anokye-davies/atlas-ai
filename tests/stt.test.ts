/**
 * Nova Desktop - STT Tests
 * Tests for Deepgram Speech-to-Text module
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock Deepgram SDK
const mockLiveClient = {
  on: vi.fn(),
  send: vi.fn(),
  keepAlive: vi.fn(),
  requestClose: vi.fn(),
};

const mockDeepgramClient = {
  listen: {
    live: vi.fn(() => mockLiveClient),
  },
};

vi.mock('@deepgram/sdk', () => ({
  createClient: vi.fn(() => mockDeepgramClient),
  LiveTranscriptionEvents: {
    Open: 'open',
    Transcript: 'Results',
    Metadata: 'Metadata',
    SpeechStarted: 'SpeechStarted',
    UtteranceEnd: 'UtteranceEnd',
    Error: 'error',
    Close: 'close',
  },
}));

// Mock fs
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn(() => true),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    readFileSync: vi.fn(),
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

import { DeepgramSTT, createDeepgramSTT } from '../src/main/stt/deepgram';
import { STTStatus, DEFAULT_STT_CONFIG } from '../src/shared/types/stt';

describe('DeepgramSTT', () => {
  let stt: DeepgramSTT;
  let openHandler: (() => void) | undefined;
  let errorHandler: ((error: Error) => void) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Capture event handlers when they're registered
    mockLiveClient.on.mockImplementation((event: string, handler: unknown) => {
      if (event === 'open') {
        openHandler = handler as () => void;
      }
      if (event === 'error') {
        errorHandler = handler as (error: Error) => void;
      }
      return mockLiveClient;
    });

    stt = new DeepgramSTT({ apiKey: 'test-api-key' });
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  describe('Constructor', () => {
    it('should create instance with default config', () => {
      const instance = new DeepgramSTT({ apiKey: 'test-key' });
      expect(instance.name).toBe('deepgram');
      expect(instance.status).toBe(STTStatus.IDLE);
    });

    it('should throw without API key', () => {
      expect(() => new DeepgramSTT({})).toThrow('Deepgram API key is required');
    });

    it('should merge custom config with defaults', () => {
      const instance = new DeepgramSTT({
        apiKey: 'test-key',
        model: 'nova-3',
        language: 'es',
      });
      
      const config = instance.getConfig();
      expect(config.model).toBe('nova-3');
      expect(config.language).toBe('es');
      expect(config.punctuate).toBe(true); // Default
    });
  });

  describe('start()', () => {
    it('should transition to CONNECTING state', async () => {
      const statusChanges: STTStatus[] = [];
      stt.on('status', (status) => statusChanges.push(status));

      // Start connection but don't wait for it
      const startPromise = stt.start();
      
      // Should be in CONNECTING state
      expect(statusChanges).toContain(STTStatus.CONNECTING);
      
      // Simulate connection open
      if (openHandler) openHandler();
      
      await startPromise;
      expect(stt.status).toBe(STTStatus.CONNECTED);
    });

    it('should emit open event on successful connection', async () => {
      const openSpy = vi.fn();
      stt.on('open', openSpy);

      const startPromise = stt.start();
      
      // Simulate connection open
      if (openHandler) openHandler();
      
      await startPromise;
      expect(openSpy).toHaveBeenCalled();
    });

    it('should not start twice if already connected', async () => {
      // First connection
      const startPromise = stt.start();
      if (openHandler) openHandler();
      await startPromise;

      // Try to start again
      await stt.start();
      
      // Should only have called live() once
      expect(mockDeepgramClient.listen.live).toHaveBeenCalledTimes(1);
    });
  });

  describe('sendAudio()', () => {
    it('should send buffer to connection', async () => {
      const startPromise = stt.start();
      if (openHandler) openHandler();
      await startPromise;

      const audioData = Buffer.alloc(1024);
      stt.sendAudio(audioData);

      expect(mockLiveClient.send).toHaveBeenCalledWith(audioData);
    });

    it('should convert Int16Array to Buffer', async () => {
      const startPromise = stt.start();
      if (openHandler) openHandler();
      await startPromise;

      const audioData = new Int16Array(512);
      stt.sendAudio(audioData);

      expect(mockLiveClient.send).toHaveBeenCalledWith(expect.any(Buffer));
    });

    it('should not send if not ready', () => {
      const audioData = Buffer.alloc(1024);
      stt.sendAudio(audioData);

      expect(mockLiveClient.send).not.toHaveBeenCalled();
    });
  });

  describe('stop()', () => {
    it('should close connection and transition to CLOSED', async () => {
      const startPromise = stt.start();
      if (openHandler) openHandler();
      await startPromise;

      await stt.stop();

      expect(mockLiveClient.requestClose).toHaveBeenCalled();
      expect(stt.status).toBe(STTStatus.CLOSED);
    });

    it('should emit close event', async () => {
      const closeSpy = vi.fn();
      stt.on('close', closeSpy);

      const startPromise = stt.start();
      if (openHandler) openHandler();
      await startPromise;

      // Get the close handler
      const closeHandler = mockLiveClient.on.mock.calls.find(
        (call) => call[0] === 'close'
      )?.[1];

      await stt.stop();
      
      // Simulate close event from WebSocket
      if (closeHandler) {
        closeHandler({ code: 1000, reason: 'Normal closure' });
      }

      expect(closeSpy).toHaveBeenCalled();
    });
  });

  describe('isReady()', () => {
    it('should return false when not connected', () => {
      expect(stt.isReady()).toBe(false);
    });

    it('should return true when connected', async () => {
      const startPromise = stt.start();
      if (openHandler) openHandler();
      await startPromise;

      expect(stt.isReady()).toBe(true);
    });

    it('should return false after stop', async () => {
      const startPromise = stt.start();
      if (openHandler) openHandler();
      await startPromise;

      await stt.stop();

      expect(stt.isReady()).toBe(false);
    });
  });

  describe('Configuration', () => {
    it('should return config copy from getConfig()', () => {
      const config = stt.getConfig();
      expect(config.apiKey).toBe('test-api-key');
      
      // Modifying returned config shouldn't affect internal config
      config.apiKey = 'modified';
      expect(stt.getConfig().apiKey).toBe('test-api-key');
    });

    it('should update config with updateConfig()', () => {
      stt.updateConfig({ model: 'nova-3' });
      expect(stt.getConfig().model).toBe('nova-3');
    });
  });

  describe('Events', () => {
    it('should emit status events on state changes', async () => {
      const statusSpy = vi.fn();
      stt.on('status', statusSpy);

      const startPromise = stt.start();
      
      expect(statusSpy).toHaveBeenCalledWith(STTStatus.CONNECTING);

      if (openHandler) openHandler();
      await startPromise;

      expect(statusSpy).toHaveBeenCalledWith(STTStatus.CONNECTED);
    });

    it('should emit error events on failure', async () => {
      const errorSpy = vi.fn();
      stt.on('error', errorSpy);

      stt.start();
      
      // Simulate error
      if (errorHandler) {
        errorHandler(new Error('Connection failed'));
      }

      expect(errorSpy).toHaveBeenCalled();
    });
  });
});

describe('createDeepgramSTT', () => {
  it('should create instance with API key', () => {
    const instance = createDeepgramSTT('test-api-key');
    expect(instance).toBeInstanceOf(DeepgramSTT);
    expect(instance.getConfig().apiKey).toBe('test-api-key');
  });

  it('should accept additional config', () => {
    const instance = createDeepgramSTT('test-api-key', { model: 'nova-3' });
    expect(instance.getConfig().model).toBe('nova-3');
  });
});

describe('DEFAULT_STT_CONFIG', () => {
  it('should have sensible defaults', () => {
    expect(DEFAULT_STT_CONFIG.model).toBe('nova-2');
    expect(DEFAULT_STT_CONFIG.language).toBe('en-US');
    expect(DEFAULT_STT_CONFIG.punctuate).toBe(true);
    expect(DEFAULT_STT_CONFIG.sampleRate).toBe(16000);
    expect(DEFAULT_STT_CONFIG.interimResults).toBe(true);
  });
});
