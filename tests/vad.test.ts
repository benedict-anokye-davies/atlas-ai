/**
 * VAD Manager Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock onnxruntime-node
vi.mock('onnxruntime-node', () => ({
  InferenceSession: {
    create: vi.fn().mockResolvedValue({
      run: vi.fn().mockResolvedValue({
        hn: { data: new Float32Array(128) },
        cn: { data: new Float32Array(128) },
        output: { data: new Float32Array([0.1]) },
      }),
    }),
  },
  Tensor: vi.fn().mockImplementation((type, data, shape) => ({
    type,
    data,
    dims: shape,
  })),
}));

// Mock FrameProcessor with a simpler approach
const mockFrameProcessor = {
  resume: vi.fn(),
  reset: vi.fn(),
  process: vi.fn().mockResolvedValue({
    probs: { isSpeech: 0.3, notSpeech: 0.7 },
  }),
  endSegment: vi.fn().mockReturnValue({}),
};

vi.mock('@ricky0123/vad-node', () => ({
  FrameProcessor: vi.fn().mockImplementation(() => mockFrameProcessor),
  Message: {
    SpeechStart: 0,
    SpeechEnd: 1,
    VADMisfire: 2,
  },
}));

// Mock fs with importOriginal pattern
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(true),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
  };
});

// Mock config
vi.mock('../src/main/config', () => ({
  getConfig: vi.fn().mockReturnValue({
    vadThreshold: 0.5,
    vadSilenceDuration: 1500,
  }),
}));

// Mock logger
vi.mock('../src/main/utils/logger', () => ({
  createModuleLogger: vi.fn().mockReturnValue({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { VADManager } from '../src/main/voice/vad';
import { Message } from '@ricky0123/vad-node';

describe('VADManager', () => {
  let vad: VADManager;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mock implementations
    mockFrameProcessor.process.mockResolvedValue({
      probs: { isSpeech: 0.3, notSpeech: 0.7 },
    });
    vad = new VADManager({
      threshold: 0.5,
      silenceDuration: 1500,
    });
  });

  afterEach(async () => {
    if (vad && vad.running) {
      await vad.stop();
    }
  });

  describe('constructor', () => {
    it('should create instance with default config', () => {
      const defaultVad = new VADManager();
      expect(defaultVad).toBeInstanceOf(VADManager);
      expect(defaultVad.running).toBe(false);
    });

    it('should create instance with custom config', () => {
      const customVad = new VADManager({
        threshold: 0.7,
        silenceDuration: 2000,
      });
      expect(customVad).toBeInstanceOf(VADManager);
    });
  });

  describe('start/stop', () => {
    it('should start VAD', async () => {
      const startedHandler = vi.fn();
      vad.on('started', startedHandler);

      await vad.start();

      expect(vad.running).toBe(true);
      expect(startedHandler).toHaveBeenCalled();
    });

    it('should stop VAD', async () => {
      const stoppedHandler = vi.fn();
      vad.on('stopped', stoppedHandler);

      await vad.start();
      await vad.stop();

      expect(vad.running).toBe(false);
      expect(stoppedHandler).toHaveBeenCalled();
    });

    it('should not start if already running', async () => {
      await vad.start();
      await vad.start(); // Should log warning but not throw

      expect(vad.running).toBe(true);
    });
  });

  describe('processAudio', () => {
    it('should emit vad-probability events', async () => {
      const probabilityHandler = vi.fn();
      vad.on('vad-probability', probabilityHandler);

      await vad.start();

      const audio = new Float32Array(1536).fill(0.1);
      await vad.processAudio(audio);

      expect(probabilityHandler).toHaveBeenCalledWith(0.3);
    });

    it('should not process audio when stopped', async () => {
      const probabilityHandler = vi.fn();
      vad.on('vad-probability', probabilityHandler);

      const audio = new Float32Array(1536).fill(0.1);
      await vad.processAudio(audio);

      expect(probabilityHandler).not.toHaveBeenCalled();
    });
  });

  describe('speech events', () => {
    it('should emit speech-start when speech detected', async () => {
      const speechStartHandler = vi.fn();
      vad.on('speech-start', speechStartHandler);

      // Mock frame processor to return speech start
      mockFrameProcessor.process.mockResolvedValueOnce({
        probs: { isSpeech: 0.8, notSpeech: 0.2 },
        msg: Message.SpeechStart,
      });

      await vad.start();

      const audio = new Float32Array(1536).fill(0.5);
      await vad.processAudio(audio);

      expect(speechStartHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'speech-start',
          timestamp: expect.any(Number),
        })
      );
    });

    it('should emit speech-end when speech ends', async () => {
      const speechEndHandler = vi.fn();
      vad.on('speech-end', speechEndHandler);

      // First return speech start, then speech end
      mockFrameProcessor.process
        .mockResolvedValueOnce({
          probs: { isSpeech: 0.8, notSpeech: 0.2 },
          msg: Message.SpeechStart,
        })
        .mockResolvedValueOnce({
          probs: { isSpeech: 0.1, notSpeech: 0.9 },
          msg: Message.SpeechEnd,
          audio: new Float32Array(4096),
        });

      await vad.start();

      const audio = new Float32Array(1536).fill(0.5);
      await vad.processAudio(audio);
      await vad.processAudio(audio);

      expect(speechEndHandler).toHaveBeenCalled();
    });
  });

  describe('status', () => {
    it('should return correct status when idle', () => {
      const status = vad.getStatus();
      expect(status.isRunning).toBe(false);
      expect(status.isSpeaking).toBe(false);
      expect(status.probability).toBe(0);
    });

    it('should return correct status when running', async () => {
      await vad.start();
      const status = vad.getStatus();
      expect(status.isRunning).toBe(true);
      expect(status.isSpeaking).toBe(false);
    });
  });

  describe('reset', () => {
    it('should reset VAD state', async () => {
      await vad.start();
      vad.reset();

      const status = vad.getStatus();
      expect(status.isSpeaking).toBe(false);
      expect(status.probability).toBe(0);
    });
  });

  describe('updateConfig', () => {
    it('should update config values', () => {
      vad.updateConfig({ threshold: 0.8 });
      // Config is internal, so we just verify no error is thrown
    });
  });
});
