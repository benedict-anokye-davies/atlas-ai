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

// Mock electron BrowserWindow
vi.mock('electron', () => ({
  BrowserWindow: {
    getFocusedWindow: vi.fn().mockReturnValue(null),
    getAllWindows: vi.fn().mockReturnValue([]),
  },
}));

import { WakeWordDetector } from '../src/main/voice/wake-word';
import type {
  WakeWordFeedback,
  ConfidenceConfig,
  DetectionStats,
  ExtendedWakeWordEvent,
} from '../src/shared/types/voice';

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

    it('should create instance with custom confidence config', () => {
      const customDetector = new WakeWordDetector({
        accessKey: 'custom-key',
        keywords: ['jarvis'],
        confidence: {
          minThreshold: 0.8,
          adaptiveThreshold: false,
        },
      });
      expect(customDetector.confidenceSettings.minThreshold).toBe(0.8);
      expect(customDetector.confidenceSettings.adaptiveThreshold).toBe(false);
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

  describe('confidence threshold', () => {
    it('should set confidence threshold between 0 and 1', () => {
      expect(() => detector.setConfidenceThreshold(0.7)).not.toThrow();
      expect(() => detector.setConfidenceThreshold(0)).not.toThrow();
      expect(() => detector.setConfidenceThreshold(1)).not.toThrow();
    });

    it('should throw for invalid confidence threshold values', () => {
      expect(() => detector.setConfidenceThreshold(-0.1)).toThrow(
        'Confidence threshold must be between 0 and 1'
      );
      expect(() => detector.setConfidenceThreshold(1.1)).toThrow(
        'Confidence threshold must be between 0 and 1'
      );
    });

    it('should update confidence config', () => {
      detector.setConfidenceConfig({
        minThreshold: 0.75,
        minAudioLevel: 0.05,
        adaptiveThreshold: false,
      });

      const config = detector.confidenceSettings;
      expect(config.minThreshold).toBe(0.75);
      expect(config.minAudioLevel).toBe(0.05);
      expect(config.adaptiveThreshold).toBe(false);
    });

    it('should have default confidence config values', () => {
      const config = detector.confidenceSettings;
      expect(config.minThreshold).toBe(0.6);
      expect(config.minAudioLevel).toBe(0.02);
      expect(config.audioHistorySize).toBe(50);
      expect(config.ambientMultiplier).toBe(2.5);
      expect(config.adaptiveThreshold).toBe(true);
    });
  });

  describe('visual feedback', () => {
    it('should enable/disable visual feedback', () => {
      expect(() => detector.setVisualFeedback(true)).not.toThrow();
      expect(() => detector.setVisualFeedback(false)).not.toThrow();
    });

    it('should emit feedback event on start', async () => {
      const feedbackHandler = vi.fn();
      detector.on('feedback', feedbackHandler);

      await detector.start();

      expect(feedbackHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'ready',
          message: 'Wake word detection active',
        })
      );

      await detector.stop();
    });

    it('should emit feedback event on resume', async () => {
      const feedbackHandler = vi.fn();
      detector.on('feedback', feedbackHandler);

      await detector.start();
      feedbackHandler.mockClear();

      detector.pause();
      detector.resume();

      expect(feedbackHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'listening',
          message: 'Listening for wake word',
        })
      );

      await detector.stop();
    });
  });

  describe('detection statistics', () => {
    it('should return initial stats with zero values', () => {
      const stats = detector.getStats();
      expect(stats.totalDetections).toBe(0);
      expect(stats.acceptedDetections).toBe(0);
      expect(stats.rejectedDetections).toBe(0);
      expect(stats.cooldownRejections).toBe(0);
      expect(stats.averageConfidence).toBe(0);
      expect(stats.lastDetectionTime).toBe(0);
    });

    it('should reset stats', () => {
      // Manually set some stat values by accessing private property (for testing)
      // We'll just verify the reset doesn't throw and returns zeroed stats
      detector.resetStats();
      const stats = detector.getStats();
      expect(stats.totalDetections).toBe(0);
      expect(stats.acceptedDetections).toBe(0);
      expect(stats.rejectedDetections).toBe(0);
    });

    it('should track uptime when running', async () => {
      await detector.start();

      // Wait a short time
      await new Promise((resolve) => setTimeout(resolve, 50));

      const stats = detector.getStats();
      expect(stats.uptime).toBeGreaterThan(0);

      await detector.stop();
    });

    it('should return zero uptime when not running', () => {
      const stats = detector.getStats();
      expect(stats.uptime).toBe(0);
    });
  });

  describe('ambient noise level', () => {
    it('should return zero ambient level initially', () => {
      expect(detector.currentAmbientLevel).toBe(0);
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
