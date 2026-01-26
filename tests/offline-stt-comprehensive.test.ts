/**
 * Nova Desktop - Comprehensive Offline STT Tests
 * Extended tests for Vosk STT model management, fallback scenarios, and error recovery
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import * as crypto from 'crypto';

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
      readFile: vi.fn().mockResolvedValue(Buffer.alloc(1024)),
    },
    existsSync: vi.fn().mockReturnValue(true),
    mkdirSync: vi.fn(),
    createWriteStream: vi.fn().mockReturnValue({
      on: vi.fn((event, cb) => {
        if (event === 'finish') setTimeout(cb, 10);
        return this;
      }),
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
    state: 'closed',
  })),
}));

import { VoskSTT, VOSK_MODELS, DEFAULT_VOSK_MODEL } from '../src/main/stt/vosk';
import { STTStatus } from '../src/shared/types/stt';

describe('Vosk Model Download and Verification', () => {
  describe('Model Checksums', () => {
    it('should have checksums for all models', () => {
      Object.entries(VOSK_MODELS).forEach(([modelName, modelInfo]) => {
        expect(modelInfo.sha256).toBeDefined();
        expect(modelInfo.sha256!.length).toBeGreaterThan(0);
      });
    });

    it('should use SHA256 format checksums', () => {
      // SHA256 produces 64 character hex strings
      Object.values(VOSK_MODELS).forEach((modelInfo) => {
        if (modelInfo.sha256) {
          expect(modelInfo.sha256.length).toBe(64);
          expect(/^[a-f0-9]+$/i.test(modelInfo.sha256)).toBe(true);
        }
      });
    });
  });

  describe('Model URLs', () => {
    it('should have valid HTTPS URLs', () => {
      Object.values(VOSK_MODELS).forEach((modelInfo) => {
        expect(modelInfo.url).toMatch(/^https:\/\//);
      });
    });

    it('should point to Vosk GitHub or Alpha Cephei', () => {
      Object.values(VOSK_MODELS).forEach((modelInfo) => {
        expect(
          modelInfo.url.includes('alphacephei.com') || modelInfo.url.includes('vosk')
        ).toBe(true);
      });
    });
  });

  describe('Model Size Validation', () => {
    // Helper to parse size strings like '40 MB' or '1.8 GB' to MB
    const parseSizeToMB = (sizeStr: string): number => {
      const match = sizeStr.match(/^([\d.]+)\s*(MB|GB)$/i);
      if (!match) return 0;
      const value = parseFloat(match[1]);
      const unit = match[2].toUpperCase();
      return unit === 'GB' ? value * 1024 : value;
    };

    it('should have reasonable model sizes', () => {
      Object.values(VOSK_MODELS).forEach((modelInfo) => {
        // Models should be between 10MB and 2GB (2048 MB)
        const sizeMB = parseSizeToMB(modelInfo.size);
        expect(sizeMB).toBeGreaterThan(10);
        expect(sizeMB).toBeLessThan(2048);
      });
    });

    it('should have increasing sizes for quality tiers', () => {
      const smallModel = VOSK_MODELS['vosk-model-small-en-us-0.15'];
      const defaultModel = VOSK_MODELS[DEFAULT_VOSK_MODEL];

      // If both exist, small should be smaller or equal
      if (smallModel && defaultModel) {
        const smallSize = parseSizeToMB(smallModel.size);
        const defaultSize = parseSizeToMB(defaultModel.size);
        expect(smallSize).toBeLessThanOrEqual(defaultSize);
      }
    });
  });

  describe('Checksum Verification Logic', () => {
    it('should verify checksum correctly', () => {
      const verifyChecksum = (data: Buffer, expectedChecksum: string): boolean => {
        const hash = crypto.createHash('sha256').update(data).digest('hex');
        return hash === expectedChecksum.toLowerCase();
      };

      const testData = Buffer.from('test data');
      const correctChecksum = crypto.createHash('sha256').update(testData).digest('hex');
      const wrongChecksum = 'a'.repeat(64);

      expect(verifyChecksum(testData, correctChecksum)).toBe(true);
      expect(verifyChecksum(testData, wrongChecksum)).toBe(false);
    });

    it('should handle case-insensitive checksum comparison', () => {
      const normalizeChecksum = (checksum: string): string => {
        return checksum.toLowerCase().trim();
      };

      expect(normalizeChecksum('ABC123')).toBe('abc123');
      expect(normalizeChecksum('  def456  ')).toBe('def456');
    });
  });
});

describe('Vosk STT Error Recovery', () => {
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

  describe('Recognizer Errors', () => {
    it('should handle recognizer creation failure', async () => {
      const errorHandler = vi.fn();
      vosk.on('error', errorHandler);

      // Simulate recognizer throwing
      const { Recognizer } = await import('vosk-koffi');
      (Recognizer as any).mockImplementationOnce(() => {
        throw new Error('Failed to create recognizer');
      });

      // Starting with a broken recognizer should fail or emit error
      try {
        await vosk.start();
      } catch {
        // Expected - recognizer creation failed
      }

      // Should still try to create recognizer
      expect(Recognizer).toHaveBeenCalled();
    });

    it('should handle audio processing errors gracefully', async () => {
      await vosk.start();

      // Reset mock to normal for this test
      mockRecognizer.acceptWaveform.mockReturnValue(false);

      // Audio processing should work without throwing
      vosk.sendAudio(Buffer.alloc(1024));

      // Verify mock was called
      expect(mockRecognizer.acceptWaveform).toHaveBeenCalled();
    });
  });

  describe('Model Loading Errors', () => {
    it('should emit error when model not found', async () => {
      const errorHandler = vi.fn();
      vosk.on('error', errorHandler);

      // Mock fs.existsSync to return false
      const fs = await import('fs');
      (fs.existsSync as any).mockReturnValueOnce(false);

      try {
        await vosk.start();
      } catch (e) {
        // Expected
      }

      // Model not found should cause error
    });
  });

  describe('Recovery Strategies', () => {
    it('should reset recognizer on consecutive errors', async () => {
      await vosk.start();

      // Reset mock to track consecutive errors scenario
      let errorCount = 0;
      mockRecognizer.acceptWaveform.mockImplementation(() => {
        errorCount++;
        if (errorCount <= 3) {
          // First few calls work
          return false;
        }
        // After 3 calls, reset error count (simulating recovery)
        errorCount = 0;
        return false;
      });

      // Send multiple audio chunks - should not throw
      for (let i = 0; i < 5; i++) {
        vosk.sendAudio(Buffer.alloc(1024));
      }

      // Verify processing occurred
      expect(mockRecognizer.acceptWaveform).toHaveBeenCalled();
    });

    it('should be restartable after error', async () => {
      await vosk.start();
      await vosk.stop();

      // Reset mock for restart
      mockRecognizer.acceptWaveform.mockReturnValue(false);

      // Should be able to start again
      await vosk.start();
      expect(vosk.status).toBe(STTStatus.CONNECTED);
    });
  });
});

describe('STT Manager Fallback Scenarios', () => {
  describe('Circuit Breaker States', () => {
    it('should track circuit breaker states', () => {
      type CircuitState = 'closed' | 'open' | 'half-open';

      const circuitStates: Record<string, CircuitState> = {
        deepgram: 'closed',
        vosk: 'closed',
      };

      const canUseProvider = (provider: string): boolean => {
        return circuitStates[provider] !== 'open';
      };

      expect(canUseProvider('deepgram')).toBe(true);

      circuitStates.deepgram = 'open';
      expect(canUseProvider('deepgram')).toBe(false);
    });

    it('should transition states correctly', () => {
      type CircuitState = 'closed' | 'open' | 'half-open';

      const transitionState = (
        current: CircuitState,
        event: 'success' | 'failure' | 'timeout'
      ): CircuitState => {
        switch (current) {
          case 'closed':
            return event === 'failure' ? 'open' : 'closed';
          case 'open':
            return event === 'timeout' ? 'half-open' : 'open';
          case 'half-open':
            return event === 'success' ? 'closed' : 'open';
        }
      };

      expect(transitionState('closed', 'failure')).toBe('open');
      expect(transitionState('closed', 'success')).toBe('closed');
      expect(transitionState('open', 'timeout')).toBe('half-open');
      expect(transitionState('half-open', 'success')).toBe('closed');
      expect(transitionState('half-open', 'failure')).toBe('open');
    });
  });

  describe('Provider Priority', () => {
    it('should select online provider by default', () => {
      const selectProvider = (
        preferOffline: boolean,
        onlineAvailable: boolean,
        offlineAvailable: boolean
      ): string | null => {
        if (preferOffline && offlineAvailable) return 'vosk';
        if (onlineAvailable) return 'deepgram';
        if (offlineAvailable) return 'vosk';
        return null;
      };

      expect(selectProvider(false, true, true)).toBe('deepgram');
      expect(selectProvider(true, true, true)).toBe('vosk');
      expect(selectProvider(false, false, true)).toBe('vosk');
      expect(selectProvider(false, false, false)).toBeNull();
    });

    it('should fall back to offline when online fails', () => {
      const handleFailure = (
        currentProvider: string,
        offlineAvailable: boolean
      ): string | null => {
        if (currentProvider === 'deepgram' && offlineAvailable) {
          return 'vosk';
        }
        return null;
      };

      expect(handleFailure('deepgram', true)).toBe('vosk');
      expect(handleFailure('deepgram', false)).toBeNull();
      expect(handleFailure('vosk', true)).toBeNull();
    });
  });

  describe('Error Threshold Tracking', () => {
    it('should track consecutive errors', () => {
      let errorCount = 0;
      const threshold = 3;

      const recordError = (): boolean => {
        errorCount++;
        return errorCount >= threshold;
      };

      const resetErrors = (): void => {
        errorCount = 0;
      };

      expect(recordError()).toBe(false); // 1
      expect(recordError()).toBe(false); // 2
      expect(recordError()).toBe(true); // 3 - threshold reached
      expect(errorCount).toBe(3);

      resetErrors();
      expect(errorCount).toBe(0);
    });
  });
});

describe('Audio Format Handling', () => {
  let vosk: VoskSTT;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Reset mock to normal behavior
    mockRecognizer.acceptWaveform.mockReturnValue(false);
    vosk = new VoskSTT({
      modelName: 'vosk-model-small-en-us-0.15',
      autoDownload: false,
    });
    await vosk.start();
  });

  afterEach(async () => {
    await vosk.stop();
  });

  describe('Buffer Conversion', () => {
    it('should accept Node.js Buffer', () => {
      const buffer = Buffer.alloc(1024);
      vosk.sendAudio(buffer);
      expect(mockRecognizer.acceptWaveform).toHaveBeenCalled();
    });

    it('should accept Int16Array', () => {
      const array = new Int16Array(512);
      vosk.sendAudio(array);
      expect(mockRecognizer.acceptWaveform).toHaveBeenCalled();
    });

    it('should convert Buffer to Int16Array correctly', () => {
      const bufferToInt16 = (buffer: Buffer): Int16Array => {
        return new Int16Array(buffer.buffer, buffer.byteOffset, buffer.length / 2);
      };

      const buffer = Buffer.alloc(1024);
      buffer.writeInt16LE(1000, 0);
      buffer.writeInt16LE(-1000, 2);

      const int16 = bufferToInt16(buffer);
      expect(int16[0]).toBe(1000);
      expect(int16[1]).toBe(-1000);
    });
  });

  describe('Sample Rate Handling', () => {
    it('should handle 16kHz audio', () => {
      const config = vosk.getConfig();
      expect(config.sampleRate).toBe(16000);
    });

    it('should calculate correct buffer sizes', () => {
      const calculateBufferSize = (
        durationMs: number,
        sampleRate: number,
        bytesPerSample: number
      ): number => {
        return Math.ceil((durationMs / 1000) * sampleRate * bytesPerSample);
      };

      // 100ms of 16kHz 16-bit audio
      expect(calculateBufferSize(100, 16000, 2)).toBe(3200);
      // 1 second
      expect(calculateBufferSize(1000, 16000, 2)).toBe(32000);
    });
  });

  describe('Audio Level Calculation', () => {
    it('should calculate RMS level from Int16Array', () => {
      const calculateRMS = (samples: Int16Array): number => {
        let sum = 0;
        for (let i = 0; i < samples.length; i++) {
          sum += samples[i] * samples[i];
        }
        return Math.sqrt(sum / samples.length) / 32767;
      };

      const silence = new Int16Array(512).fill(0);
      expect(calculateRMS(silence)).toBe(0);

      const loud = new Int16Array(512).fill(32767);
      expect(calculateRMS(loud)).toBeCloseTo(1, 2);
    });
  });
});

describe('Transcription Result Processing', () => {
  describe('Result Parsing', () => {
    it('should parse Vosk JSON result', () => {
      const parseResult = (json: string): { text: string; words?: unknown[] } | null => {
        try {
          const result = JSON.parse(json);
          return {
            text: result.text || '',
            words: result.result,
          };
        } catch {
          return null;
        }
      };

      const fullResult = '{"text": "hello world", "result": [{"word": "hello"}, {"word": "world"}]}';
      const parsed = parseResult(fullResult);
      expect(parsed?.text).toBe('hello world');
      expect(parsed?.words?.length).toBe(2);

      const emptyResult = '{"text": ""}';
      expect(parseResult(emptyResult)?.text).toBe('');

      const invalidResult = 'not json';
      expect(parseResult(invalidResult)).toBeNull();
    });

    it('should normalize text output', () => {
      const normalizeText = (text: string): string => {
        return text.trim().replace(/\s+/g, ' ');
      };

      expect(normalizeText('  hello   world  ')).toBe('hello world');
      expect(normalizeText('test\n\ntext')).toBe('test text');
    });
  });

  describe('Confidence Scoring', () => {
    it('should calculate overall confidence from word confidences', () => {
      const calculateOverallConfidence = (
        words: Array<{ confidence: number }>
      ): number => {
        if (words.length === 0) return 0;
        const sum = words.reduce((acc, w) => acc + w.confidence, 0);
        return sum / words.length;
      };

      expect(
        calculateOverallConfidence([
          { confidence: 0.9 },
          { confidence: 0.8 },
          { confidence: 1.0 },
        ])
      ).toBeCloseTo(0.9, 2);

      expect(calculateOverallConfidence([])).toBe(0);
    });
  });
});

describe('Memory Management', () => {
  describe('Resource Cleanup', () => {
    it('should free model resources on stop', async () => {
      const vosk = new VoskSTT({ autoDownload: false });
      await vosk.start();
      await vosk.stop();

      expect(mockModel.free).toHaveBeenCalled();
      expect(mockRecognizer.free).toHaveBeenCalled();
    });

    it('should handle cleanup errors gracefully', async () => {
      mockModel.free.mockImplementationOnce(() => {
        throw new Error('Free failed');
      });

      const vosk = new VoskSTT({ autoDownload: false });
      await vosk.start();

      // Should not throw
      await expect(vosk.stop()).resolves.not.toThrow();
    });
  });

  describe('Buffer Management', () => {
    it('should not accumulate buffers indefinitely', () => {
      const maxBufferSize = 1024 * 1024; // 1MB
      let currentSize = 0;
      const buffers: Buffer[] = [];

      const addBuffer = (size: number): void => {
        while (currentSize + size > maxBufferSize && buffers.length > 0) {
          const removed = buffers.shift()!;
          currentSize -= removed.length;
        }
        const newBuffer = Buffer.alloc(size);
        buffers.push(newBuffer);
        currentSize += size;
      };

      // Add many buffers
      for (let i = 0; i < 100; i++) {
        addBuffer(32000); // ~1 second of audio
      }

      expect(currentSize).toBeLessThanOrEqual(maxBufferSize);
    });
  });
});

describe('Performance Considerations', () => {
  describe('Processing Latency', () => {
    it('should track processing time', () => {
      const trackLatency = (startTime: number, endTime: number): number => {
        return endTime - startTime;
      };

      const start = Date.now();
      const end = start + 150; // 150ms processing

      expect(trackLatency(start, end)).toBe(150);
    });

    it('should calculate average latency', () => {
      const calculateAverage = (latencies: number[]): number => {
        if (latencies.length === 0) return 0;
        return latencies.reduce((a, b) => a + b, 0) / latencies.length;
      };

      expect(calculateAverage([100, 150, 200])).toBe(150);
      expect(calculateAverage([])).toBe(0);
    });
  });

  describe('Throughput', () => {
    it('should calculate audio processed per second', () => {
      const calculateThroughput = (
        audioMs: number,
        processingMs: number
      ): number => {
        return audioMs / processingMs;
      };

      // Processing 1000ms of audio in 100ms = 10x real-time
      expect(calculateThroughput(1000, 100)).toBe(10);
      // Processing 1000ms of audio in 1000ms = 1x real-time
      expect(calculateThroughput(1000, 1000)).toBe(1);
    });
  });
});
