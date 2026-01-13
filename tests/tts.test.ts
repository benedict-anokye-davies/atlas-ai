/**
 * Nova Desktop - TTS Tests
 * Tests for ElevenLabs TTS module
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock fetch globally
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

import { ElevenLabsTTS, createElevenLabsTTS } from '../src/main/tts/elevenlabs';
import { TTSStatus, DEFAULT_TTS_CONFIG, ELEVENLABS_VOICES } from '../src/shared/types/tts';

/**
 * Create a mock ReadableStream with chunks
 */
function createMockStream(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(chunks[index]);
        index++;
      } else {
        controller.close();
      }
    },
  });
}

/**
 * Create a mock Response object
 */
function createMockResponse(options: {
  ok?: boolean;
  status?: number;
  body?: ReadableStream<Uint8Array> | null;
  arrayBuffer?: ArrayBuffer;
  text?: string;
  json?: Record<string, unknown>;
}): Response {
  const { ok = true, status = 200, body = null, arrayBuffer, text, json } = options;

  return {
    ok,
    status,
    body,
    arrayBuffer: vi.fn().mockResolvedValue(arrayBuffer || new ArrayBuffer(0)),
    text: vi.fn().mockResolvedValue(text || ''),
    json: vi.fn().mockResolvedValue(json || {}),
    headers: new Headers(),
    redirected: false,
    statusText: 'OK',
    type: 'basic',
    url: '',
    clone: vi.fn(),
    bodyUsed: false,
    formData: vi.fn(),
    blob: vi.fn(),
  } as unknown as Response;
}

describe('ElevenLabsTTS', () => {
  let tts: ElevenLabsTTS;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    tts = new ElevenLabsTTS({ apiKey: 'test-api-key' });
  });

  afterEach(() => {
    vi.clearAllTimers();
    tts.stop();
  });

  describe('Constructor', () => {
    it('should create instance with default config', () => {
      const instance = new ElevenLabsTTS({ apiKey: 'test-key' });
      expect(instance.name).toBe('elevenlabs');
      expect(instance.status).toBe(TTSStatus.IDLE);
    });

    it('should throw without API key', () => {
      expect(() => new ElevenLabsTTS({})).toThrow('ElevenLabs API key is required');
    });

    it('should merge custom config with defaults', () => {
      const instance = new ElevenLabsTTS({
        apiKey: 'test-key',
        voiceId: ELEVENLABS_VOICES.nova,
        stability: 0.7,
      });

      const config = instance.getConfig();
      expect(config.voiceId).toBe(ELEVENLABS_VOICES.nova);
      expect(config.stability).toBe(0.7);
      expect(config.modelId).toBe(DEFAULT_TTS_CONFIG.modelId); // Default
    });

    it('should use default voice settings', () => {
      const config = tts.getConfig();
      expect(config.modelId).toBe('eleven_turbo_v2_5');
      expect(config.stability).toBe(0.5);
      expect(config.similarityBoost).toBe(0.75);
    });
  });

  describe('createElevenLabsTTS()', () => {
    it('should create instance with factory function', () => {
      const instance = createElevenLabsTTS('test-key', { voiceId: ELEVENLABS_VOICES.rachel });
      expect(instance).toBeInstanceOf(ElevenLabsTTS);
      expect(instance.getConfig().voiceId).toBe(ELEVENLABS_VOICES.rachel);
    });
  });

  describe('synthesize()', () => {
    it('should synthesize text and return audio buffer', async () => {
      const mockAudio = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00]); // Fake MP3 header

      mockFetch.mockResolvedValue(
        createMockResponse({
          ok: true,
          arrayBuffer: mockAudio.buffer,
        })
      );

      const result = await tts.synthesize('Hello world');

      expect(result.audio).toBeInstanceOf(Buffer);
      expect(result.format).toBe(DEFAULT_TTS_CONFIG.outputFormat);
      expect(result.characterCount).toBe(11);
      expect(result.latency).toBeGreaterThan(0);
    });

    it('should transition through status states', async () => {
      const statusChanges: TTSStatus[] = [];
      tts.on('status', (status) => statusChanges.push(status));

      mockFetch.mockResolvedValue(
        createMockResponse({
          ok: true,
          arrayBuffer: new ArrayBuffer(100),
        })
      );

      await tts.synthesize('Test');

      expect(statusChanges).toContain(TTSStatus.SYNTHESIZING);
      expect(statusChanges).toContain(TTSStatus.IDLE);
    });

    it('should emit synthesized event', async () => {
      const synthesizedSpy = vi.fn();
      tts.on('synthesized', synthesizedSpy);

      mockFetch.mockResolvedValue(
        createMockResponse({
          ok: true,
          arrayBuffer: new ArrayBuffer(100),
        })
      );

      await tts.synthesize('Test');

      expect(synthesizedSpy).toHaveBeenCalledOnce();
      expect(synthesizedSpy.mock.calls[0][0]).toHaveProperty('audio');
      expect(synthesizedSpy.mock.calls[0][0]).toHaveProperty('format');
    });

    it('should handle API errors', async () => {
      mockFetch.mockResolvedValue(
        createMockResponse({
          ok: false,
          status: 401,
          text: 'Unauthorized',
        })
      );

      await expect(tts.synthesize('Test')).rejects.toThrow('ElevenLabs synthesis failed');
      expect(tts.status).toBe(TTSStatus.ERROR);
    });

    it('should emit error event on failure', async () => {
      const errorSpy = vi.fn();
      tts.on('error', errorSpy);

      mockFetch.mockResolvedValue(
        createMockResponse({
          ok: false,
          status: 500,
          text: 'Internal Server Error',
        })
      );

      await expect(tts.synthesize('Test')).rejects.toThrow();
      expect(errorSpy).toHaveBeenCalledOnce();
    });

    it('should retry on transient failures', async () => {
      let callCount = 0;
      mockFetch.mockImplementation(() => {
        callCount++;
        if (callCount < 3) {
          return Promise.resolve(
            createMockResponse({
              ok: false,
              status: 503,
              text: 'Service Unavailable',
            })
          );
        }
        return Promise.resolve(
          createMockResponse({
            ok: true,
            arrayBuffer: new ArrayBuffer(100),
          })
        );
      });

      const result = await tts.synthesize('Test');
      expect(result.audio).toBeInstanceOf(Buffer);
      expect(callCount).toBe(3);
    });
  });

  describe('synthesizeStream()', () => {
    it('should stream audio chunks', async () => {
      const chunk1 = new Uint8Array([1, 2, 3, 4]);
      const chunk2 = new Uint8Array([5, 6, 7, 8]);
      const mockStream = createMockStream([chunk1, chunk2]);

      mockFetch.mockResolvedValue(
        createMockResponse({
          ok: true,
          body: mockStream,
        })
      );

      const chunks: Buffer[] = [];
      for await (const chunk of tts.synthesizeStream('Hello')) {
        if (chunk.data.length > 0) {
          chunks.push(chunk.data);
        }
      }

      expect(chunks).toHaveLength(2);
      expect(chunks[0]).toEqual(Buffer.from(chunk1));
      expect(chunks[1]).toEqual(Buffer.from(chunk2));
    });

    it('should emit chunk events', async () => {
      const chunkSpy = vi.fn();
      tts.on('chunk', chunkSpy);

      const mockStream = createMockStream([new Uint8Array([1, 2, 3])]);

      mockFetch.mockResolvedValue(
        createMockResponse({
          ok: true,
          body: mockStream,
        })
      );

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of tts.synthesizeStream('Test')) {
        // Consume stream
      }

      expect(chunkSpy).toHaveBeenCalled();
    });

    it('should mark final chunk', async () => {
      const mockStream = createMockStream([new Uint8Array([1, 2])]);

      mockFetch.mockResolvedValue(
        createMockResponse({
          ok: true,
          body: mockStream,
        })
      );

      const chunks: Array<{ isFinal: boolean }> = [];
      for await (const chunk of tts.synthesizeStream('Test')) {
        chunks.push(chunk);
      }

      const finalChunk = chunks[chunks.length - 1];
      expect(finalChunk.isFinal).toBe(true);
    });

    it('should handle streaming errors', async () => {
      mockFetch.mockResolvedValue(
        createMockResponse({
          ok: false,
          status: 400,
          text: 'Bad Request',
        })
      );

      const generator = tts.synthesizeStream('Test');

      await expect(generator.next()).rejects.toThrow('ElevenLabs streaming failed');
    });
  });

  describe('Speech Queue', () => {
    it('should add items to speech queue', async () => {
      // Don't let the queue process
      mockFetch.mockImplementation(() => new Promise(() => {})); // Never resolves

      // Use speak but don't await (it will hang)
      tts.speak('Hello', 1);

      // Give it a moment to add to queue
      await new Promise((r) => setTimeout(r, 10));

      const queue = tts.getQueue();
      expect(queue.length).toBeGreaterThanOrEqual(1);
    });

    it('should emit queueUpdate events', async () => {
      const queueUpdateSpy = vi.fn();
      tts.on('queueUpdate', queueUpdateSpy);

      mockFetch.mockImplementation(() => new Promise(() => {}));

      tts.speak('Test', 0);
      await new Promise((r) => setTimeout(r, 10));

      expect(queueUpdateSpy).toHaveBeenCalled();
    });

    it('should prioritize higher priority items', async () => {
      mockFetch.mockImplementation(() => new Promise(() => {}));

      tts.speak('Low priority', 0);
      await new Promise((r) => setTimeout(r, 5));

      tts.speak('High priority', 10);
      await new Promise((r) => setTimeout(r, 5));

      const queue = tts.getQueue();

      // High priority should be at the front or near front
      const highPriorityItem = queue.find((q) => q.text === 'High priority');
      const lowPriorityItem = queue.find((q) => q.text === 'Low priority');

      if (highPriorityItem && lowPriorityItem) {
        const highIndex = queue.indexOf(highPriorityItem);
        const lowIndex = queue.indexOf(lowPriorityItem);
        expect(highIndex).toBeLessThanOrEqual(lowIndex);
      }
    });

    it('should clear queue', async () => {
      mockFetch.mockImplementation(() => new Promise(() => {}));

      tts.speak('Item 1', 0);
      tts.speak('Item 2', 0);
      await new Promise((r) => setTimeout(r, 10));

      tts.clearQueue();

      // Only currently speaking item should remain
      const queue = tts.getQueue();
      expect(queue.filter((q) => q.status === 'pending')).toHaveLength(0);
    });
  });

  describe('stop()', () => {
    it('should stop current speech', () => {
      tts.stop();
      expect(tts.status).toBe(TTSStatus.IDLE);
    });

    it('should emit interrupted event', () => {
      const interruptedSpy = vi.fn();
      tts.on('interrupted', interruptedSpy);

      tts.stop();

      expect(interruptedSpy).toHaveBeenCalledOnce();
    });

    it('should clear queue on stop', async () => {
      mockFetch.mockImplementation(() => new Promise(() => {}));

      tts.speak('Test 1', 0);
      tts.speak('Test 2', 0);
      await new Promise((r) => setTimeout(r, 10));

      tts.stop();

      expect(tts.getQueue()).toHaveLength(0);
    });
  });

  describe('pause() and resume()', () => {
    it('should pause playback when playing', async () => {
      // Set status to PLAYING to test pause
      (tts as unknown as { _status: TTSStatus })._status = TTSStatus.PLAYING;

      tts.pause();
      expect(tts.status).toBe(TTSStatus.PAUSED);
    });

    it('should pause playback when synthesizing', async () => {
      // Set status to SYNTHESIZING to test pause
      (tts as unknown as { _status: TTSStatus })._status = TTSStatus.SYNTHESIZING;

      tts.pause();
      expect(tts.status).toBe(TTSStatus.PAUSED);
    });

    it('should not pause when idle', () => {
      expect(tts.status).toBe(TTSStatus.IDLE);
      tts.pause();
      // Should remain IDLE since we're not playing
      expect(tts.status).toBe(TTSStatus.IDLE);
    });

    it('should resume from paused state', () => {
      // Manually set to paused state
      (tts as unknown as { _status: TTSStatus })._status = TTSStatus.PAUSED;
      (tts as unknown as { isPaused: boolean }).isPaused = true;

      tts.resume();

      expect(tts.status).toBe(TTSStatus.IDLE);
    });
  });

  describe('isSpeaking()', () => {
    it('should return false when idle', () => {
      expect(tts.isSpeaking()).toBe(false);
    });

    it('should return true when synthesizing', async () => {
      mockFetch.mockImplementation(() => new Promise(() => {}));

      tts.speak('Test');
      await new Promise((r) => setTimeout(r, 50));

      expect(tts.isSpeaking()).toBe(true);

      tts.stop();
    });
  });

  describe('Configuration', () => {
    it('should return current config', () => {
      const config = tts.getConfig();
      expect(config.apiKey).toBe('test-api-key');
      expect(config.voiceId).toBeDefined();
    });

    it('should update config', () => {
      tts.updateConfig({ voiceId: ELEVENLABS_VOICES.rachel });
      const config = tts.getConfig();
      expect(config.voiceId).toBe(ELEVENLABS_VOICES.rachel);
    });

    it('should not mutate original config', () => {
      const config1 = tts.getConfig();
      config1.voiceId = 'modified';
      const config2 = tts.getConfig();
      expect(config2.voiceId).not.toBe('modified');
    });
  });

  describe('getVoices()', () => {
    it('should fetch available voices', async () => {
      mockFetch.mockResolvedValue(
        createMockResponse({
          ok: true,
          json: {
            voices: [
              { voice_id: 'voice1', name: 'Rachel', category: 'premade' },
              { voice_id: 'voice2', name: 'Custom Voice', category: 'cloned' },
            ],
          },
        })
      );

      const voices = await tts.getVoices();

      expect(voices).toHaveLength(2);
      expect(voices[0]).toEqual({
        voiceId: 'voice1',
        name: 'Rachel',
        category: 'premade',
      });
    });

    it('should handle API errors when fetching voices', async () => {
      mockFetch.mockResolvedValue(
        createMockResponse({
          ok: false,
          status: 401,
        })
      );

      await expect(tts.getVoices()).rejects.toThrow('Failed to fetch voices');
    });
  });

  describe('getSubscriptionInfo()', () => {
    it('should fetch subscription info', async () => {
      mockFetch.mockResolvedValue(
        createMockResponse({
          ok: true,
          json: {
            character_count: 5000,
            character_limit: 10000,
            tier: 'starter',
          },
        })
      );

      const info = await tts.getSubscriptionInfo();

      expect(info.characterCount).toBe(5000);
      expect(info.characterLimit).toBe(10000);
      expect(info.tier).toBe('starter');
    });

    it('should handle API errors when fetching subscription', async () => {
      mockFetch.mockResolvedValue(
        createMockResponse({
          ok: false,
          status: 403,
        })
      );

      await expect(tts.getSubscriptionInfo()).rejects.toThrow('Failed to fetch subscription');
    });
  });

  describe('Event Emitter', () => {
    it('should support on() for status events', () => {
      const listener = vi.fn();
      tts.on('status', listener);
      tts.emit('status', TTSStatus.SYNTHESIZING);
      expect(listener).toHaveBeenCalledWith(TTSStatus.SYNTHESIZING);
    });

    it('should support off() to remove listeners', () => {
      const listener = vi.fn();
      tts.on('status', listener);
      tts.off('status', listener);
      tts.emit('status', TTSStatus.IDLE);
      expect(listener).not.toHaveBeenCalled();
    });

    it('should support multiple event types', () => {
      const statusListener = vi.fn();
      const errorListener = vi.fn();

      tts.on('status', statusListener);
      tts.on('error', errorListener);

      tts.emit('status', TTSStatus.ERROR);
      tts.emit('error', new Error('Test error'));

      expect(statusListener).toHaveBeenCalledWith(TTSStatus.ERROR);
      expect(errorListener).toHaveBeenCalledWith(expect.any(Error));
    });
  });
});

describe('ELEVENLABS_VOICES', () => {
  it('should have voice IDs as strings', () => {
    expect(typeof ELEVENLABS_VOICES.rachel).toBe('string');
    expect(typeof ELEVENLABS_VOICES.nova).toBe('string');
    expect(typeof ELEVENLABS_VOICES.onyx).toBe('string');
  });

  it('should have predefined assistant voices', () => {
    expect(ELEVENLABS_VOICES.onyx).toBeDefined();
    expect(ELEVENLABS_VOICES.nova).toBeDefined();
  });
});

describe('DEFAULT_TTS_CONFIG', () => {
  it('should have sensible defaults', () => {
    expect(DEFAULT_TTS_CONFIG.modelId).toBe('eleven_turbo_v2_5');
    expect(DEFAULT_TTS_CONFIG.stability).toBe(0.5);
    expect(DEFAULT_TTS_CONFIG.similarityBoost).toBe(0.75);
    expect(DEFAULT_TTS_CONFIG.outputFormat).toBe('mp3_44100_128');
    expect(DEFAULT_TTS_CONFIG.timeout).toBe(30000);
  });

  it('should use onyx as default voice', () => {
    expect(DEFAULT_TTS_CONFIG.voiceId).toBe(ELEVENLABS_VOICES.onyx);
  });
});
