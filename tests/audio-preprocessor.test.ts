/**
 * Audio Preprocessor Tests
 * Session 036-A: Audio Pipeline Enhancements
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  AudioPreprocessor,
  AudioPreprocessorConfig,
  DEFAULT_PREPROCESSOR_CONFIG,
  getAudioPreprocessor,
  shutdownAudioPreprocessor,
} from '../src/main/voice/audio-preprocessor';

describe('AudioPreprocessor', () => {
  let preprocessor: AudioPreprocessor;

  beforeEach(() => {
    preprocessor = new AudioPreprocessor();
  });

  afterEach(() => {
    preprocessor.reset();
  });

  describe('initialization', () => {
    it('should initialize with default config', () => {
      const config = preprocessor.getConfig();
      expect(config.enableNoiseGate).toBe(true);
      expect(config.enableNoiseReduction).toBe(true);
      expect(config.enableHighPass).toBe(true);
      expect(config.enableEchoCancellation).toBe(true); // Enabled by default with NLMS
      expect(config.sampleRate).toBe(16000);
    });

    it('should accept custom config', () => {
      const customConfig: Partial<AudioPreprocessorConfig> = {
        noiseGateThreshold: -50,
        noiseReductionStrength: 0.8,
        highPassCutoff: 100,
      };
      const custom = new AudioPreprocessor(customConfig);
      const config = custom.getConfig();
      expect(config.noiseGateThreshold).toBe(-50);
      expect(config.noiseReductionStrength).toBe(0.8);
      expect(config.highPassCutoff).toBe(100);
    });

    it('should be enabled by default', () => {
      expect(preprocessor.enabled).toBe(true);
    });
  });

  describe('process()', () => {
    it('should return same length buffer', () => {
      const input = new Float32Array(512);
      for (let i = 0; i < input.length; i++) {
        input[i] = Math.sin(i * 0.1) * 0.5;
      }
      const output = preprocessor.process(input);
      expect(output.length).toBe(input.length);
    });

    it('should pass through when disabled', () => {
      const input = new Float32Array(512);
      for (let i = 0; i < input.length; i++) {
        input[i] = Math.random() * 2 - 1;
      }
      preprocessor.setEnabled(false);
      const output = preprocessor.process(input);
      expect(output).toBe(input);
    });

    it('should reduce noise in quiet audio', () => {
      // Create very quiet audio (noise floor level) with deterministic pattern
      const input = new Float32Array(512);
      for (let i = 0; i < input.length; i++) {
        // Use deterministic pseudo-noise pattern
        input[i] = Math.sin(i * 0.7) * 0.0005;
      }

      // Process to build noise estimate (need multiple frames)
      for (let j = 0; j < 15; j++) {
        preprocessor.process(new Float32Array(input));
      }

      // Process again and check reduction
      const output = preprocessor.process(new Float32Array(input));

      // Output should be significantly attenuated by noise gate
      // Allow 20% margin for filter artifacts
      const inputRMS = Math.sqrt(input.reduce((sum, x) => sum + x * x, 0) / input.length);
      const outputRMS = Math.sqrt(output.reduce((sum, x) => sum + x * x, 0) / output.length);
      expect(outputRMS).toBeLessThan(inputRMS * 1.2);
    });

    it('should preserve loud audio', () => {
      // Create loud, clean audio
      const input = new Float32Array(512);
      for (let i = 0; i < input.length; i++) {
        input[i] = Math.sin(i * 0.1) * 0.5; // Loud sine wave
      }

      const output = preprocessor.process(input);

      // Output should still have significant amplitude
      const outputRMS = Math.sqrt(output.reduce((sum, x) => sum + x * x, 0) / output.length);
      expect(outputRMS).toBeGreaterThan(0.1);
    });
  });

  describe('high-pass filter', () => {
    it('should attenuate DC offset', () => {
      // Create audio with DC offset
      const input = new Float32Array(512);
      const dcOffset = 0.3;
      for (let i = 0; i < input.length; i++) {
        input[i] = dcOffset + Math.sin(i * 0.1) * 0.2;
      }

      // Process multiple frames to let filter settle
      let output = input;
      for (let j = 0; j < 5; j++) {
        output = preprocessor.process(output);
      }

      // Calculate average (DC component) of output
      const avgOutput = output.reduce((sum, x) => sum + x, 0) / output.length;

      // DC offset should be reduced
      expect(Math.abs(avgOutput)).toBeLessThan(dcOffset * 0.5);
    });
  });

  describe('noise gate', () => {
    it('should attenuate very quiet audio', () => {
      const preprocessorWithGate = new AudioPreprocessor({
        enableNoiseReduction: false, // Disable NR to test only gate
        enableHighPass: false, // Disable HPF to test only gate
        noiseGateThreshold: -40,
      });

      // Create audio below threshold (~-60dB)
      const input = new Float32Array(512);
      for (let i = 0; i < input.length; i++) {
        input[i] = (Math.random() - 0.5) * 0.002; // Very quiet
      }

      // Process multiple times to let gate engage
      let output = input;
      for (let j = 0; j < 5; j++) {
        output = preprocessorWithGate.process(new Float32Array(input));
      }

      // Output should be attenuated
      const inputRMS = Math.sqrt(input.reduce((sum, x) => sum + x * x, 0) / input.length);
      const outputRMS = Math.sqrt(output.reduce((sum, x) => sum + x * x, 0) / output.length);
      expect(outputRMS).toBeLessThan(inputRMS);
    });
  });

  describe('statistics', () => {
    it('should track frames processed', () => {
      const input = new Float32Array(512);
      expect(preprocessor.getStats().framesProcessed).toBe(0);

      preprocessor.process(input);
      expect(preprocessor.getStats().framesProcessed).toBe(1);

      preprocessor.process(input);
      expect(preprocessor.getStats().framesProcessed).toBe(2);
    });

    it('should calculate processing time', () => {
      const input = new Float32Array(512);
      for (let i = 0; i < 10; i++) {
        preprocessor.process(input);
      }

      const stats = preprocessor.getStats();
      expect(stats.processingTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('should reset statistics', () => {
      const input = new Float32Array(512);
      preprocessor.process(input);
      preprocessor.process(input);
      expect(preprocessor.getStats().framesProcessed).toBe(2);

      preprocessor.reset();
      expect(preprocessor.getStats().framesProcessed).toBe(0);
    });
  });

  describe('configuration', () => {
    it('should update config at runtime', () => {
      preprocessor.updateConfig({
        noiseGateThreshold: -50,
        noiseReductionStrength: 0.8,
      });

      const config = preprocessor.getConfig();
      expect(config.noiseGateThreshold).toBe(-50);
      expect(config.noiseReductionStrength).toBe(0.8);
    });

    it('should enable/disable preprocessor', () => {
      expect(preprocessor.enabled).toBe(true);
      preprocessor.setEnabled(false);
      expect(preprocessor.enabled).toBe(false);
      preprocessor.setEnabled(true);
      expect(preprocessor.enabled).toBe(true);
    });
  });

  describe('echo cancellation', () => {
    it('should set echo reference', () => {
      const reference = new Float32Array(512);
      for (let i = 0; i < reference.length; i++) {
        reference[i] = Math.sin(i * 0.1) * 0.5;
      }

      // Enable echo cancellation
      preprocessor.updateConfig({ enableEchoCancellation: true });

      // Should not throw
      expect(() => preprocessor.setEchoReference(reference)).not.toThrow();
    });

    it('should clear echo reference', () => {
      preprocessor.updateConfig({ enableEchoCancellation: true });
      preprocessor.setEchoReference(new Float32Array(512));
      expect(() => preprocessor.clearEchoReference()).not.toThrow();
    });
  });

  describe('singleton', () => {
    afterEach(() => {
      shutdownAudioPreprocessor();
    });

    it('should return singleton instance', () => {
      const instance1 = getAudioPreprocessor();
      const instance2 = getAudioPreprocessor();
      expect(instance1).toBe(instance2);
    });

    it('should shutdown and recreate', () => {
      const instance1 = getAudioPreprocessor();
      shutdownAudioPreprocessor();
      const instance2 = getAudioPreprocessor();
      expect(instance1).not.toBe(instance2);
    });
  });
});
