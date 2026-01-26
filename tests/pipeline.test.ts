/**
 * Audio Pipeline Manager Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Create mocks inside factory to avoid hoisting issues
vi.mock('../src/main/voice/wake-word', () => {
  const mock = {
    on: vi.fn(),
    off: vi.fn(),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
    resume: vi.fn(),
    setAudioDevice: vi.fn(),
    setAtlasSpeaking: vi.fn(),
    running: false,
    paused: false,
  };

  return {
    WakeWordDetector: vi.fn().mockImplementation(() => mock),
    getWakeWordDetector: vi.fn(() => mock),
    shutdownWakeWordDetector: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('../src/main/voice/vad', () => {
  const mock = {
    on: vi.fn(),
    off: vi.fn(),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    reset: vi.fn(),
    processAudio: vi.fn().mockResolvedValue(undefined),
    running: false,
  };

  return {
    VADManager: vi.fn().mockImplementation(() => mock),
    getVADManager: vi.fn(() => mock),
    shutdownVADManager: vi.fn().mockResolvedValue(undefined),
  };
});

// Mock config
vi.mock('../src/main/config', () => ({
  getConfig: vi.fn().mockReturnValue({
    porcupineApiKey: 'test-key',
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

// Import after mocks are set up
import { AudioPipeline } from '../src/main/voice/pipeline';
import { getWakeWordDetector } from '../src/main/voice/wake-word';
import { getVADManager } from '../src/main/voice/vad';

describe('AudioPipeline', () => {
  let pipeline: AudioPipeline;

  beforeEach(() => {
    vi.clearAllMocks();
    pipeline = new AudioPipeline({
      enableWakeWord: true,
      enableVAD: true,
      enableBargeIn: true,
    });
  });

  afterEach(async () => {
    if (pipeline && pipeline.running) {
      await pipeline.stop();
    }
  });

  describe('constructor', () => {
    it('should create instance with default config', () => {
      const defaultPipeline = new AudioPipeline();
      expect(defaultPipeline).toBeInstanceOf(AudioPipeline);
      expect(defaultPipeline.getState()).toBe('idle');
    });

    it('should create instance with custom config', () => {
      const customPipeline = new AudioPipeline({
        enableWakeWord: false,
        enableVAD: true,
        listeningTimeout: 20000,
      });
      expect(customPipeline).toBeInstanceOf(AudioPipeline);
    });
  });

  describe('start/stop', () => {
    it('should start the pipeline', async () => {
      const startedHandler = vi.fn();
      pipeline.on('started', startedHandler);

      await pipeline.start();

      expect(pipeline.running).toBe(true);
      expect(pipeline.getState()).toBe('idle');
      expect(startedHandler).toHaveBeenCalled();
    });

    it('should stop the pipeline', async () => {
      const stoppedHandler = vi.fn();
      pipeline.on('stopped', stoppedHandler);

      await pipeline.start();
      await pipeline.stop();

      expect(pipeline.running).toBe(false);
      expect(stoppedHandler).toHaveBeenCalled();
    });

    it('should not start if already running', async () => {
      await pipeline.start();
      await pipeline.start(); // Should not throw

      expect(pipeline.running).toBe(true);
    });
  });

  describe('state machine', () => {
    beforeEach(async () => {
      await pipeline.start();
    });

    it('should start in idle state', () => {
      expect(pipeline.getState()).toBe('idle');
    });

    it('should transition to listening on manual wake', () => {
      const stateChangeHandler = vi.fn();
      pipeline.on('state-change', stateChangeHandler);

      pipeline.triggerWake();

      expect(pipeline.getState()).toBe('listening');
      expect(stateChangeHandler).toHaveBeenCalledWith('listening', 'idle');
    });

    it('should transition to speaking from processing', () => {
      pipeline.triggerWake();
      // Manually set to processing for testing
      (pipeline as any).setState('processing');

      pipeline.startSpeaking();

      expect(pipeline.getState()).toBe('speaking');
    });

    it('should transition to idle after speaking', () => {
      pipeline.triggerWake();
      (pipeline as any).setState('processing');
      pipeline.startSpeaking();

      pipeline.finishSpeaking();

      expect(pipeline.getState()).toBe('idle');
    });
  });

  describe('manual wake', () => {
    beforeEach(async () => {
      await pipeline.start();
    });

    it('should emit wake-word event on manual trigger', () => {
      const wakeHandler = vi.fn();
      pipeline.on('wake-word', wakeHandler);

      pipeline.triggerWake();

      expect(wakeHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          keyword: 'manual',
          confidence: 1.0,
          timestamp: expect.any(Number),
        })
      );
    });

    it('should not trigger wake if not in idle state', () => {
      pipeline.triggerWake(); // Now in listening
      const wakeHandler = vi.fn();
      pipeline.on('wake-word', wakeHandler);

      pipeline.triggerWake(); // Should be ignored

      expect(wakeHandler).not.toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    beforeEach(async () => {
      await pipeline.start();
    });

    it('should cancel and return to idle', () => {
      pipeline.triggerWake();
      expect(pipeline.getState()).toBe('listening');

      pipeline.cancel();

      expect(pipeline.getState()).toBe('idle');
    });
  });

  describe('pause/resume', () => {
    beforeEach(async () => {
      await pipeline.start();
    });

    it('should pause the pipeline', () => {
      const mockWakeWord = getWakeWordDetector();
      pipeline.pause();
      expect(mockWakeWord.pause).toHaveBeenCalled();
    });

    it('should resume the pipeline', () => {
      const mockWakeWord = getWakeWordDetector();
      pipeline.pause();
      pipeline.resume();
      expect(mockWakeWord.resume).toHaveBeenCalled();
    });
  });

  describe('device selection', () => {
    beforeEach(async () => {
      await pipeline.start();
    });

    it('should set input device', () => {
      const mockWakeWord = getWakeWordDetector();
      pipeline.setInputDevice(1);
      expect(mockWakeWord.setAudioDevice).toHaveBeenCalledWith(1);
    });

    it('should set output device', () => {
      // Output device is stored in config
      pipeline.setOutputDevice(2);
      expect(pipeline.getConfig().outputDeviceIndex).toBe(2);
    });
  });

  describe('status', () => {
    beforeEach(async () => {
      await pipeline.start();
    });

    it('should return correct status when idle', () => {
      const status = pipeline.getStatus();

      expect(status.state).toBe('idle');
      expect(status.isListening).toBe(false);
      expect(status.isSpeaking).toBe(false);
    });

    it('should return correct status when listening', () => {
      pipeline.triggerWake();
      const status = pipeline.getStatus();

      expect(status.state).toBe('listening');
      expect(status.isListening).toBe(true);
      expect(status.isSpeaking).toBe(false);
    });

    it('should return correct status when speaking', () => {
      pipeline.triggerWake();
      (pipeline as any).setState('processing');
      pipeline.startSpeaking();
      const status = pipeline.getStatus();

      expect(status.state).toBe('speaking');
      expect(status.isListening).toBe(false);
      expect(status.isSpeaking).toBe(true);
    });
  });

  describe('configuration', () => {
    it('should update configuration', () => {
      pipeline.updateConfig({ listeningTimeout: 25000 });
      const config = pipeline.getConfig();

      expect(config.listeningTimeout).toBe(25000);
    });

    it('should return current configuration', () => {
      const config = pipeline.getConfig();

      expect(config).toHaveProperty('enableWakeWord');
      expect(config).toHaveProperty('enableVAD');
      expect(config).toHaveProperty('enableBargeIn');
    });
  });

  describe('handlers', () => {
    beforeEach(async () => {
      await pipeline.start();
    });

    it('should allow setting speech segment handler', () => {
      const handler = vi.fn();
      pipeline.setOnSpeechSegment(handler);

      // The handler is stored internally
      expect((pipeline as any).onSpeechSegmentHandler).toBe(handler);
    });

    it('should allow setting barge-in handler', () => {
      const handler = vi.fn();
      pipeline.setOnBargeIn(handler);

      expect((pipeline as any).onBargeInHandler).toBe(handler);
    });
  });

  describe('audio processing', () => {
    beforeEach(async () => {
      await pipeline.start();
    });

    it('should not process audio when idle', async () => {
      const mockVAD = getVADManager();
      const audio = new Float32Array(512).fill(0.1);
      await pipeline.processAudioFrame(audio);

      expect(mockVAD.processAudio).not.toHaveBeenCalled();
    });

    it('should process audio when listening', async () => {
      const mockVAD = getVADManager();
      pipeline.triggerWake();

      const audio = new Float32Array(512).fill(0.1);
      await pipeline.processAudioFrame(audio);

      // Verify processAudio was called with a Float32Array of the right length
      expect(mockVAD.processAudio).toHaveBeenCalled();
      const calledArg = (mockVAD.processAudio as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(calledArg).toBeInstanceOf(Float32Array);
      expect(calledArg.length).toBe(512);
    });
  });
});
