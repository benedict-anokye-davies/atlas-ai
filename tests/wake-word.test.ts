/**
 * Wake Word Detector Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock Porcupine and PvRecorder before importing
vi.mock('@picovoice/porcupine-node', () => ({
  Porcupine: vi.fn().mockImplementation(() => ({
    frameLength: 512,
    sampleRate: 16000,
    version: '2.2.0',
    process: vi.fn().mockReturnValue(-1),
    release: vi.fn(),
  })),
  BuiltinKeyword: {
    ALEXA: 0,
    AMERICANO: 1,
    BLUEBERRY: 2,
    BUMBLEBEE: 3,
    COMPUTER: 4,
    GRAPEFRUIT: 5,
    GRASSHOPPER: 6,
    HEY_GOOGLE: 7,
    HEY_SIRI: 8,
    JARVIS: 9,
    OK_GOOGLE: 10,
    PICOVOICE: 11,
    PORCUPINE: 12,
    TERMINATOR: 13,
  },
}));

vi.mock('@picovoice/pvrecorder-node', () => ({
  PvRecorder: vi.fn().mockImplementation(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    release: vi.fn(),
    read: vi.fn().mockResolvedValue(new Int16Array(512).fill(0)),
  })),
}));

// Mock config
vi.mock('../src/main/config', () => ({
  getConfig: vi.fn().mockReturnValue({
    porcupineApiKey: 'test-api-key',
    wakeWordSensitivity: 0.5,
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

import { WakeWordDetector } from '../src/main/voice/wake-word';

describe('WakeWordDetector', () => {
  let detector: WakeWordDetector;

  beforeEach(() => {
    vi.clearAllMocks();
    detector = new WakeWordDetector({
      accessKey: 'test-key',
      keywords: ['jarvis'],
      sensitivities: [0.5],
    });
  });

  afterEach(async () => {
    if (detector && detector.running) {
      await detector.stop();
    }
  });

  describe('constructor', () => {
    it('should create instance with default config', () => {
      const defaultDetector = new WakeWordDetector();
      expect(defaultDetector).toBeInstanceOf(WakeWordDetector);
      expect(defaultDetector.running).toBe(false);
    });

    it('should create instance with custom config', () => {
      const customDetector = new WakeWordDetector({
        accessKey: 'custom-key',
        keywords: ['computer'],
        sensitivities: [0.7],
      });
      expect(customDetector).toBeInstanceOf(WakeWordDetector);
    });
  });

  describe('sensitivity', () => {
    it('should set sensitivity between 0 and 1', () => {
      expect(() => detector.setSensitivity(0.7)).not.toThrow();
      expect(() => detector.setSensitivity(0)).not.toThrow();
      expect(() => detector.setSensitivity(1)).not.toThrow();
    });

    it('should throw for invalid sensitivity values', () => {
      expect(() => detector.setSensitivity(-0.1)).toThrow('Sensitivity must be between 0 and 1');
      expect(() => detector.setSensitivity(1.1)).toThrow('Sensitivity must be between 0 and 1');
    });
  });

  describe('cooldown', () => {
    it('should set cooldown period', () => {
      expect(() => detector.setCooldown(3000)).not.toThrow();
    });
  });

  describe('start/stop', () => {
    it('should start detection', async () => {
      const startedHandler = vi.fn();
      detector.on('started', startedHandler);

      await detector.start();

      expect(detector.running).toBe(true);
      expect(startedHandler).toHaveBeenCalled();

      await detector.stop();
    });

    it('should stop detection', async () => {
      const stoppedHandler = vi.fn();
      detector.on('stopped', stoppedHandler);

      await detector.start();
      await detector.stop();

      expect(detector.running).toBe(false);
      expect(stoppedHandler).toHaveBeenCalled();
    });
  });

  describe('pause/resume', () => {
    it('should pause and resume detection', async () => {
      await detector.start();

      detector.pause();
      expect(detector.paused).toBe(true);

      detector.resume();
      expect(detector.paused).toBe(false);

      await detector.stop();
    });

    it('should not pause if not running', () => {
      detector.pause();
      expect(detector.paused).toBe(false);
    });
  });
});
