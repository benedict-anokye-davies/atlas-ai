/**
 * Nova Desktop - Offline STT Tests
 * Basic tests for Whisper-based offline Speech-to-Text module
 *
 * Note: This module is a stub implementation. Full testing will require
 * actual Whisper integration.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

import { OfflineSTT, createOfflineSTT, OfflineSTTConfig } from '../src/main/stt/offline';
import { STTStatus } from '../src/shared/types/stt';

describe('OfflineSTT', () => {
  let stt: OfflineSTT;

  beforeEach(() => {
    vi.clearAllMocks();
    stt = new OfflineSTT();
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  describe('Constructor', () => {
    it('should create instance with default config', () => {
      const instance = new OfflineSTT();
      expect(instance.name).toBe('offline-whisper');
      expect(instance.status).toBe(STTStatus.IDLE);
    });

    it('should accept custom config', () => {
      const instance = new OfflineSTT({
        modelSize: 'small',
        threads: 8,
        useGPU: true,
      });
      expect(instance).toBeInstanceOf(OfflineSTT);
    });

    it('should merge custom config with defaults', () => {
      const instance = new OfflineSTT({
        modelSize: 'large',
      });
      const config = instance.getConfig() as OfflineSTTConfig;
      expect(config.modelSize).toBe('large');
      expect(config.sampleRate).toBe(16000); // Default
    });
  });

  describe('Model Management', () => {
    it('should return model info', () => {
      const info = stt.getModelInfo();
      expect(info).toHaveProperty('size');
      expect(info).toHaveProperty('url');
      expect(info).toHaveProperty('path');
      expect(info).toHaveProperty('downloaded');
      expect(info.url).toContain('huggingface.co');
    });

    it('should return correct model info for different sizes', () => {
      const tinyStt = new OfflineSTT({ modelSize: 'tiny' });
      const tinyInfo = tinyStt.getModelInfo();
      expect(tinyInfo.size).toBe(75);

      const largeStt = new OfflineSTT({ modelSize: 'large' });
      const largeInfo = largeStt.getModelInfo();
      expect(largeInfo.size).toBe(2900);
    });

    it('should use custom model path if provided', () => {
      const customPath = '/custom/model/path.bin';
      const instance = new OfflineSTT({ modelPath: customPath });
      const info = instance.getModelInfo();
      expect(info.path).toBe(customPath);
    });
  });

  describe('start() without model', () => {
    it('should fail if model not downloaded', async () => {
      const errorSpy = vi.fn();
      stt.on('error', errorSpy);

      // Model won't exist, so it should throw
      await expect(stt.start()).rejects.toThrow('Whisper model not found');
      expect(stt.status).toBe(STTStatus.ERROR);
      expect(errorSpy).toHaveBeenCalled();
    });
  });

  describe('sendAudio() when not ready', () => {
    it('should not process audio if not ready', () => {
      const audioData = Buffer.alloc(1024);
      stt.sendAudio(audioData);

      // Should not throw, but also should not process
      expect(stt.status).toBe(STTStatus.IDLE);
    });
  });

  describe('stop()', () => {
    it('should be safe to call when not started', async () => {
      await expect(stt.stop()).resolves.not.toThrow();
    });
  });

  describe('isReady()', () => {
    it('should return false when not connected', () => {
      expect(stt.isReady()).toBe(false);
    });
  });

  describe('Configuration', () => {
    it('should return config copy from getConfig()', () => {
      const config = stt.getConfig() as OfflineSTTConfig;
      expect(config.modelSize).toBe('base');

      // Modifying returned config shouldn't affect internal config
      config.modelSize = 'large';
      expect((stt.getConfig() as OfflineSTTConfig).modelSize).toBe('base');
    });

    it('should update config with updateConfig()', () => {
      stt.updateConfig({ threads: 8 });
      expect((stt.getConfig() as OfflineSTTConfig).threads).toBe(8);
    });
  });

  describe('Events', () => {
    it('should emit error events on failure', async () => {
      const errorSpy = vi.fn();
      stt.on('error', errorSpy);

      try {
        await stt.start();
      } catch {
        // Expected to throw
      }

      expect(errorSpy).toHaveBeenCalled();
    });
  });
});

describe('createOfflineSTT', () => {
  it('should create instance with default config', () => {
    const instance = createOfflineSTT();
    expect(instance).toBeInstanceOf(OfflineSTT);
  });

  it('should create instance with custom config', () => {
    const instance = createOfflineSTT({ modelSize: 'large', threads: 8 });
    expect((instance.getConfig() as OfflineSTTConfig).modelSize).toBe('large');
    expect((instance.getConfig() as OfflineSTTConfig).threads).toBe(8);
  });
});
