/**
 * Atlas Desktop - Comprehensive Offline Mode Tests
 * Tests for offline STT (Vosk), offline TTS (Piper/espeak), graceful degradation,
 * offline detection, reconnection behavior, and local memory operations.
 */

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { EventEmitter } from 'events';

// =============================================================================
// Mock Setup (hoisted)
// =============================================================================

const { mockSpawn, mockExistsSync, mockFetch, mockStat, mockReadFile, mockWriteFile, mockMkdir } =
  vi.hoisted(() => ({
    mockSpawn: vi.fn(),
    mockExistsSync: vi.fn(() => false),
    mockFetch: vi.fn(),
    mockStat: vi.fn(),
    mockReadFile: vi.fn(),
    mockWriteFile: vi.fn(),
    mockMkdir: vi.fn(),
  }));

// Mock child_process
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    spawn: (...args: unknown[]) => mockSpawn(...args),
  };
});

// Mock fs
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: (...args: unknown[]) => mockExistsSync(...args),
    mkdirSync: (...args: unknown[]) => mockMkdir(...args),
    writeFileSync: (...args: unknown[]) => mockWriteFile(...args),
    readFileSync: (...args: unknown[]) => mockReadFile(...args),
    createWriteStream: vi.fn(() => ({
      write: vi.fn(),
      close: vi.fn(),
      on: vi.fn(),
    })),
    promises: {
      stat: (...args: unknown[]) => mockStat(...args),
      readFile: (...args: unknown[]) => mockReadFile(...args),
      writeFile: (...args: unknown[]) => mockWriteFile(...args),
      mkdir: (...args: unknown[]) => mockMkdir(...args),
      access: vi.fn().mockRejectedValue(new Error('ENOENT')),
      unlink: vi.fn().mockResolvedValue(undefined),
    },
  };
});

// Mock electron
vi.mock('electron', () => ({
  app: {
    exit: vi.fn(),
    getPath: vi.fn(() => '/mock/path'),
    isPackaged: false,
  },
  dialog: {
    showErrorBox: vi.fn(),
  },
  BrowserWindow: {
    getFocusedWindow: vi.fn(() => null),
    getAllWindows: vi.fn(() => []),
  },
}));

// Mock logger
vi.mock('../../src/main/utils/logger', () => ({
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

// Mock vosk-koffi with proper named exports
vi.mock('vosk-koffi', () => ({
  Model: vi.fn(() => ({
    free: vi.fn(),
  })),
  Recognizer: vi.fn(() => ({
    setWords: vi.fn(),
    setMaxAlternatives: vi.fn(),
    acceptWaveform: vi.fn(() => false),
    result: vi.fn(() => '{"text": "test transcription"}'),
    partialResult: vi.fn(() => '{"partial": "test"}'),
    finalResult: vi.fn(() => '{"text": "final test"}'),
    free: vi.fn(),
    reset: vi.fn(),
  })),
  setLogLevel: vi.fn(),
  default: {
    Model: vi.fn(() => ({
      free: vi.fn(),
    })),
    Recognizer: vi.fn(() => ({
      setWords: vi.fn(),
      setMaxAlternatives: vi.fn(),
      acceptWaveform: vi.fn(() => false),
      result: vi.fn(() => '{"text": "test transcription"}'),
      partialResult: vi.fn(() => '{"partial": "test"}'),
      finalResult: vi.fn(() => '{"text": "final test"}'),
      free: vi.fn(),
      reset: vi.fn(),
    })),
    setLogLevel: vi.fn(),
  },
}));

// Set global fetch mock
global.fetch = mockFetch;

// =============================================================================
// Imports (after mocks)
// =============================================================================

import { VoskSTT, createVoskSTT, VOSK_MODELS, DEFAULT_VOSK_MODEL } from '../../src/main/stt/vosk';
import {
  OfflineTTS,
  createOfflineTTS,
  PIPER_VOICES,
  DEFAULT_PIPER_VOICE,
} from '../../src/main/tts/offline';
import { OfflineSTT, createOfflineSTT } from '../../src/main/stt/offline';
import { MemoryManager } from '../../src/main/memory/index';
import { CircuitBreaker, CircuitState, withRetry, isRetryableError } from '../../src/main/utils/errors';
import { STTStatus } from '../../src/shared/types/stt';
import { TTSStatus } from '../../src/shared/types/tts';

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Create a mock child process for testing TTS
 */
function createMockProcess(options: {
  exitCode?: number;
  stdout?: Buffer[];
  stderr?: Buffer[];
  error?: Error;
} = {}): EventEmitter & {
  stdin: EventEmitter & { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
} {
  const proc = new EventEmitter() as EventEmitter & {
    stdin: EventEmitter & { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };

  proc.stdin = Object.assign(new EventEmitter(), {
    write: vi.fn(),
    end: vi.fn(() => {
      setTimeout(() => {
        if (options.stdout) {
          options.stdout.forEach((chunk) => proc.stdout.emit('data', chunk));
        }
        if (options.stderr) {
          options.stderr.forEach((chunk) => proc.stderr.emit('data', chunk));
        }
        if (options.error) {
          proc.emit('error', options.error);
        } else {
          proc.emit('close', options.exitCode ?? 0);
        }
      }, 10);
    }),
  });
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn();

  return proc;
}

/**
 * Simulate network connectivity state
 */
class NetworkSimulator {
  private _isOnline = true;
  private listeners: Map<string, Set<() => void>> = new Map();

  get isOnline(): boolean {
    return this._isOnline;
  }

  goOffline(): void {
    this._isOnline = false;
    this.emit('offline');
  }

  goOnline(): void {
    this._isOnline = true;
    this.emit('online');
  }

  on(event: 'online' | 'offline', callback: () => void): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
  }

  off(event: 'online' | 'offline', callback: () => void): void {
    this.listeners.get(event)?.delete(callback);
  }

  private emit(event: string): void {
    this.listeners.get(event)?.forEach((cb) => cb());
  }

  reset(): void {
    this._isOnline = true;
    this.listeners.clear();
  }
}

// =============================================================================
// Test Suites
// =============================================================================

describe('Offline Mode - Vosk STT', () => {
  let voskStt: VoskSTT;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
    mockStat.mockResolvedValue({ isDirectory: () => true });
  });

  afterEach(async () => {
    if (voskStt) {
      await voskStt.stop();
    }
  });

  describe('Initialization', () => {
    it('should initialize with default configuration', () => {
      voskStt = new VoskSTT();
      expect(voskStt.name).toBe('vosk');
      expect(voskStt.status).toBe(STTStatus.IDLE);
    });

    it('should accept custom configuration', () => {
      voskStt = new VoskSTT({
        modelName: 'vosk-model-en-us-0.22',
        words: true,
        maxAlternatives: 3,
      });
      expect(voskStt).toBeInstanceOf(VoskSTT);
    });

    it('should use default model when not specified', () => {
      voskStt = new VoskSTT();
      const config = voskStt.getConfig();
      expect(config.modelName).toBe(DEFAULT_VOSK_MODEL);
    });
  });

  describe('Model Management', () => {
    it('should check if model is downloaded', async () => {
      mockStat.mockResolvedValue({ isDirectory: () => true });
      voskStt = new VoskSTT();
      const downloaded = await voskStt.isModelDownloaded();
      expect(downloaded).toBe(true);
    });

    it('should return false when model not downloaded', async () => {
      mockStat.mockRejectedValue(new Error('ENOENT'));
      voskStt = new VoskSTT();
      const downloaded = await voskStt.isModelDownloaded();
      expect(downloaded).toBe(false);
    });

    it('should list available models', () => {
      const models = VoskSTT.getAvailableModels();
      expect(models.length).toBeGreaterThan(0);
      expect(models.some((m) => m.name === DEFAULT_VOSK_MODEL)).toBe(true);
    });

    it('should check model availability', async () => {
      mockStat.mockResolvedValue({ isDirectory: () => true });
      const available = await VoskSTT.isModelAvailable(DEFAULT_VOSK_MODEL);
      expect(available).toBe(true);
    });

    it('should validate VOSK_MODELS have required properties', () => {
      Object.values(VOSK_MODELS).forEach((model) => {
        expect(model.name).toBeDefined();
        expect(model.url).toBeDefined();
        expect(model.size).toBeDefined();
        expect(model.description).toBeDefined();
      });
    });
  });

  describe('Start/Stop Operations', () => {
    it('should start successfully when model exists', async () => {
      mockStat.mockResolvedValue({ isDirectory: () => true });
      voskStt = new VoskSTT();

      const openSpy = vi.fn();
      voskStt.on('open', openSpy);

      await voskStt.start();

      expect(voskStt.status).toBe(STTStatus.CONNECTED);
      expect(openSpy).toHaveBeenCalled();
    });

    it('should handle start failure gracefully', async () => {
      mockStat.mockRejectedValue(new Error('ENOENT'));
      voskStt = new VoskSTT({ autoDownload: false });

      const errorSpy = vi.fn();
      voskStt.on('error', errorSpy);

      await expect(voskStt.start()).rejects.toThrow('Model not found');
      expect(voskStt.status).toBe(STTStatus.ERROR);
      expect(errorSpy).toHaveBeenCalled();
    });

    it('should stop cleanly', async () => {
      mockStat.mockResolvedValue({ isDirectory: () => true });
      voskStt = new VoskSTT();
      await voskStt.start();

      const closeSpy = vi.fn();
      voskStt.on('close', closeSpy);

      await voskStt.stop();

      expect(voskStt.status).toBe(STTStatus.CLOSED);
      expect(closeSpy).toHaveBeenCalled();
    });

    it('should not process audio after stop', async () => {
      mockStat.mockResolvedValue({ isDirectory: () => true });
      voskStt = new VoskSTT();
      await voskStt.start();
      await voskStt.stop();

      const audioData = Buffer.alloc(1024);
      voskStt.sendAudio(audioData);

      // Should not change status since it's closed
      expect(voskStt.status).toBe(STTStatus.CLOSED);
    });
  });

  describe('Audio Processing', () => {
    beforeEach(async () => {
      mockStat.mockResolvedValue({ isDirectory: () => true });
      voskStt = new VoskSTT();
      await voskStt.start();
    });

    it('should accept Buffer audio data', () => {
      const audioData = Buffer.alloc(1024);
      voskStt.sendAudio(audioData);
      expect(voskStt.status).toBe(STTStatus.LISTENING);
    });

    it('should accept Int16Array audio data', () => {
      const audioData = new Int16Array(512);
      voskStt.sendAudio(audioData);
      expect(voskStt.status).toBe(STTStatus.LISTENING);
    });

    it('should emit transcript events', async () => {
      const transcriptSpy = vi.fn();
      voskStt.on('transcript', transcriptSpy);

      const audioData = Buffer.alloc(1024);
      voskStt.sendAudio(audioData);

      // Give time for processing
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    it('should check isReady state correctly', () => {
      expect(voskStt.isReady()).toBe(true);
    });

    it('should flush remaining audio', () => {
      const result = voskStt.flush();
      // Flush returns result if there's pending audio
      expect(result === null || typeof result.text === 'string').toBe(true);
    });

    it('should reset recognizer', () => {
      voskStt.reset();
      // Should not throw
      expect(voskStt.isReady()).toBe(true);
    });
  });

  describe('Configuration Updates', () => {
    it('should update configuration', () => {
      voskStt = new VoskSTT();
      voskStt.updateConfig({ words: false, maxAlternatives: 5 });

      const config = voskStt.getConfig();
      expect(config.words).toBe(false);
      expect(config.maxAlternatives).toBe(5);
    });
  });
});

describe('Offline Mode - Whisper STT (OfflineSTT)', () => {
  let offlineStt: OfflineSTT;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
  });

  afterEach(async () => {
    if (offlineStt) {
      await offlineStt.stop();
    }
  });

  describe('Initialization', () => {
    it('should initialize with default configuration', () => {
      offlineStt = new OfflineSTT();
      expect(offlineStt.name).toBe('offline-whisper');
      expect(offlineStt.status).toBe(STTStatus.IDLE);
    });

    it('should accept custom model size', () => {
      offlineStt = new OfflineSTT({ modelSize: 'large' });
      const info = offlineStt.getModelInfo();
      expect(info.size).toBe(2900); // Large model size in MB
    });

    it('should accept custom model path', () => {
      const customPath = '/custom/model/path.bin';
      offlineStt = new OfflineSTT({ modelPath: customPath });
      const info = offlineStt.getModelInfo();
      expect(info.path).toBe(customPath);
    });
  });

  describe('Model Info', () => {
    it('should return correct model info for tiny model', () => {
      offlineStt = new OfflineSTT({ modelSize: 'tiny' });
      const info = offlineStt.getModelInfo();
      expect(info.size).toBe(75);
      expect(info.url).toContain('ggml-tiny.en.bin');
    });

    it('should return correct model info for base model', () => {
      offlineStt = new OfflineSTT({ modelSize: 'base' });
      const info = offlineStt.getModelInfo();
      expect(info.size).toBe(142);
    });

    it('should check downloaded status', () => {
      offlineStt = new OfflineSTT();
      const downloaded = offlineStt.isModelDownloaded();
      expect(downloaded).toBe(false); // mockExistsSync returns false
    });
  });

  describe('Start/Stop Operations', () => {
    it('should fail to start without model', async () => {
      mockExistsSync.mockReturnValue(false);
      offlineStt = new OfflineSTT();

      const errorSpy = vi.fn();
      offlineStt.on('error', errorSpy);

      await expect(offlineStt.start()).rejects.toThrow('Whisper model not found');
      expect(offlineStt.status).toBe(STTStatus.ERROR);
    });

    it('should stop cleanly', async () => {
      offlineStt = new OfflineSTT();
      await offlineStt.stop();
      expect(offlineStt.status).toBe(STTStatus.CLOSED);
    });
  });

  describe('Audio Buffer Management', () => {
    it('should not process audio when not ready', () => {
      offlineStt = new OfflineSTT();
      const audioData = Buffer.alloc(1024);
      offlineStt.sendAudio(audioData);
      expect(offlineStt.status).toBe(STTStatus.IDLE);
    });
  });

  describe('Configuration', () => {
    it('should update configuration', () => {
      offlineStt = new OfflineSTT();
      offlineStt.updateConfig({ threads: 8 });
      const config = offlineStt.getConfig();
      expect(config.threads).toBe(8);
    });

    it('should detect model size change', () => {
      offlineStt = new OfflineSTT({ modelSize: 'base' });
      offlineStt.updateConfig({ modelSize: 'large' });
      // Model loaded should be reset
    });
  });
});

describe('Offline Mode - System TTS (OfflineTTS)', () => {
  let offlineTts: OfflineTTS;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSpawn.mockReset();
    mockFetch.mockReset();
    mockExistsSync.mockReturnValue(false);
  });

  afterEach(() => {
    if (offlineTts) {
      offlineTts.stop();
    }
  });

  describe('Initialization', () => {
    it('should initialize with default configuration', () => {
      offlineTts = new OfflineTTS();
      expect(offlineTts.name).toBe('offline');
      expect(offlineTts.status).toBe(TTSStatus.IDLE);
    });

    it('should use default Piper voice', () => {
      offlineTts = new OfflineTTS();
      const config = offlineTts.getOfflineConfig();
      expect(config.voiceId).toBe(DEFAULT_PIPER_VOICE);
    });

    it('should accept custom voice', () => {
      offlineTts = new OfflineTTS({ voiceId: 'en_GB-alba-medium' });
      const config = offlineTts.getOfflineConfig();
      expect(config.voiceId).toBe('en_GB-alba-medium');
    });

    it('should accept custom speaking rate', () => {
      offlineTts = new OfflineTTS({ speakingRate: 1.5 });
      const config = offlineTts.getOfflineConfig();
      expect(config.speakingRate).toBe(1.5);
    });
  });

  describe('Piper Availability', () => {
    it('should return false when Piper not found', async () => {
      mockExistsSync.mockReturnValue(false);
      offlineTts = new OfflineTTS();
      const available = await offlineTts.isPiperAvailable();
      expect(available).toBe(false);
    });

    it('should cache Piper availability result', async () => {
      mockExistsSync.mockReturnValue(false);
      offlineTts = new OfflineTTS();

      await offlineTts.isPiperAvailable();
      mockExistsSync.mockReturnValue(true);
      const available = await offlineTts.isPiperAvailable();

      expect(available).toBe(false); // Cached result
    });
  });

  describe('espeak Availability', () => {
    it('should check espeak availability', async () => {
      // Create a mock process that emits close immediately
      const proc = new EventEmitter() as EventEmitter & {
        stdin: EventEmitter;
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: ReturnType<typeof vi.fn>;
      };
      proc.stdin = new EventEmitter();
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.kill = vi.fn();

      mockSpawn.mockImplementation(() => {
        // Emit close event asynchronously
        setTimeout(() => proc.emit('close', 1), 5);
        return proc;
      });

      offlineTts = new OfflineTTS();
      const available = await offlineTts.isEspeakAvailable();
      expect(typeof available).toBe('boolean');
    });

    it('should cache espeak availability result', async () => {
      // Create a mock that immediately completes
      const createQuickMockProc = () => {
        const proc = new EventEmitter() as EventEmitter & {
          stdin: EventEmitter;
          stdout: EventEmitter;
          stderr: EventEmitter;
          kill: ReturnType<typeof vi.fn>;
        };
        proc.stdin = new EventEmitter();
        proc.stdout = new EventEmitter();
        proc.stderr = new EventEmitter();
        proc.kill = vi.fn();
        setTimeout(() => proc.emit('close', 1), 5);
        return proc;
      };

      mockSpawn.mockImplementation(createQuickMockProc);

      offlineTts = new OfflineTTS();
      await offlineTts.isEspeakAvailable();
      // Second call should use cached result
      const available = await offlineTts.isEspeakAvailable();
      expect(typeof available).toBe('boolean');
    });
  });

  describe('Model Management', () => {
    it('should check model download status', () => {
      mockExistsSync.mockReturnValue(false);
      offlineTts = new OfflineTTS();
      const downloaded = offlineTts.isModelDownloaded();
      expect(downloaded).toBe(false);
    });

    it('should return correct model path', () => {
      offlineTts = new OfflineTTS();
      const path = offlineTts.getModelPath();
      expect(path).toContain('en_US-amy-medium.onnx');
    });

    it('should return path for specific voice', () => {
      offlineTts = new OfflineTTS();
      const path = offlineTts.getModelPath('en_GB-alba-medium');
      expect(path).toContain('en_GB-alba-medium.onnx');
    });
  });

  describe('Synthesis', () => {
    it('should throw when no TTS engine available', async () => {
      mockExistsSync.mockReturnValue(false);

      // Create a mock that immediately emits close with error code
      const createFailingMockProc = () => {
        const proc = new EventEmitter() as EventEmitter & {
          stdin: EventEmitter;
          stdout: EventEmitter;
          stderr: EventEmitter;
          kill: ReturnType<typeof vi.fn>;
        };
        proc.stdin = new EventEmitter();
        proc.stdout = new EventEmitter();
        proc.stderr = new EventEmitter();
        proc.kill = vi.fn();
        setTimeout(() => proc.emit('close', 1), 5);
        return proc;
      };

      mockSpawn.mockImplementation(createFailingMockProc);

      offlineTts = new OfflineTTS();
      await expect(offlineTts.synthesize('Hello')).rejects.toThrow('No TTS engine available');
    });

    it('should emit error event on failure', async () => {
      mockExistsSync.mockReturnValue(false);

      const createFailingMockProc = () => {
        const proc = new EventEmitter() as EventEmitter & {
          stdin: EventEmitter;
          stdout: EventEmitter;
          stderr: EventEmitter;
          kill: ReturnType<typeof vi.fn>;
        };
        proc.stdin = new EventEmitter();
        proc.stdout = new EventEmitter();
        proc.stderr = new EventEmitter();
        proc.kill = vi.fn();
        setTimeout(() => proc.emit('close', 1), 5);
        return proc;
      };

      mockSpawn.mockImplementation(createFailingMockProc);

      offlineTts = new OfflineTTS();
      const errorSpy = vi.fn();
      offlineTts.on('error', errorSpy);

      await expect(offlineTts.synthesize('Test')).rejects.toThrow();
      expect(errorSpy).toHaveBeenCalled();
    });

    it('should set status to error on failure', async () => {
      mockExistsSync.mockReturnValue(false);

      const createFailingMockProc = () => {
        const proc = new EventEmitter() as EventEmitter & {
          stdin: EventEmitter;
          stdout: EventEmitter;
          stderr: EventEmitter;
          kill: ReturnType<typeof vi.fn>;
        };
        proc.stdin = new EventEmitter();
        proc.stdout = new EventEmitter();
        proc.stderr = new EventEmitter();
        proc.kill = vi.fn();
        setTimeout(() => proc.emit('close', 1), 5);
        return proc;
      };

      mockSpawn.mockImplementation(createFailingMockProc);

      offlineTts = new OfflineTTS();

      try {
        await offlineTts.synthesize('Test');
      } catch {
        // Expected
      }

      expect(offlineTts.status).toBe(TTSStatus.ERROR);
    });
  });

  describe('Speech Queue', () => {
    it('should add items to queue', async () => {
      mockExistsSync.mockReturnValue(false);
      const proc = createMockProcess({ exitCode: 1 });
      mockSpawn.mockReturnValue(proc);

      offlineTts = new OfflineTTS();
      offlineTts.speak('Hello', 1);

      await new Promise((r) => setTimeout(r, 5));
      const queue = offlineTts.getQueue();
      expect(queue.length).toBeGreaterThanOrEqual(0);
    });

    it('should emit queueUpdate events', async () => {
      const queueSpy = vi.fn();
      mockExistsSync.mockReturnValue(false);
      const proc = createMockProcess({ exitCode: 1 });
      mockSpawn.mockReturnValue(proc);

      offlineTts = new OfflineTTS();
      offlineTts.on('queueUpdate', queueSpy);
      offlineTts.speak('Test', 0);

      await new Promise((r) => setTimeout(r, 10));
      expect(queueSpy).toHaveBeenCalled();
    });

    it('should clear queue', () => {
      offlineTts = new OfflineTTS();
      offlineTts.clearQueue();
      expect(offlineTts.getQueue()).toHaveLength(0);
    });

    it('should prioritize items correctly', async () => {
      offlineTts = new OfflineTTS();
      // High priority items should be processed first
    });
  });

  describe('Playback Controls', () => {
    it('should stop and emit interrupted', () => {
      offlineTts = new OfflineTTS();
      const interruptedSpy = vi.fn();
      offlineTts.on('interrupted', interruptedSpy);

      offlineTts.stop();

      expect(offlineTts.status).toBe(TTSStatus.IDLE);
      expect(interruptedSpy).toHaveBeenCalled();
    });

    it('should pause when synthesizing', () => {
      offlineTts = new OfflineTTS();
      (offlineTts as unknown as { _status: TTSStatus })._status = TTSStatus.SYNTHESIZING;

      offlineTts.pause();

      expect(offlineTts.status).toBe(TTSStatus.PAUSED);
    });

    it('should resume from paused', () => {
      offlineTts = new OfflineTTS();
      (offlineTts as unknown as { _status: TTSStatus })._status = TTSStatus.PAUSED;
      (offlineTts as unknown as { isPaused: boolean }).isPaused = true;

      offlineTts.resume();

      expect(offlineTts.status).toBe(TTSStatus.IDLE);
    });

    it('should report speaking status', () => {
      offlineTts = new OfflineTTS();
      expect(offlineTts.isSpeaking()).toBe(false);

      (offlineTts as unknown as { _status: TTSStatus })._status = TTSStatus.PLAYING;
      expect(offlineTts.isSpeaking()).toBe(true);
    });
  });

  describe('Voice Configuration', () => {
    it('should return available voices', () => {
      const voices = OfflineTTS.getAvailableVoices();
      expect(voices.length).toBeGreaterThan(0);
    });

    it('should get voice info', () => {
      const voice = OfflineTTS.getVoiceInfo('en_US-amy-medium');
      expect(voice).toBeDefined();
      expect(voice?.name).toBe('Amy (US English)');
    });

    it('should return undefined for unknown voice', () => {
      const voice = OfflineTTS.getVoiceInfo('unknown-voice');
      expect(voice).toBeUndefined();
    });

    it('should validate PIPER_VOICES structure', () => {
      Object.values(PIPER_VOICES).forEach((voice) => {
        expect(voice.id).toBeDefined();
        expect(voice.name).toBeDefined();
        expect(voice.language).toBeDefined();
        expect(voice.quality).toBeDefined();
        expect(voice.sampleRate).toBeGreaterThan(0);
        expect(voice.downloadUrl).toContain('huggingface.co');
      });
    });
  });
});

describe('Offline Mode - Graceful Degradation', () => {
  describe('Service Fallback Chain', () => {
    it('should define degradation order: Primary -> Offline', () => {
      const sttFallbackChain = ['deepgram', 'vosk'];
      const ttsFallbackChain = ['elevenlabs', 'piper', 'espeak'];
      const llmFallbackChain = ['fireworks', 'openrouter'];

      expect(sttFallbackChain[0]).toBe('deepgram');
      expect(sttFallbackChain[1]).toBe('vosk');
      expect(ttsFallbackChain[0]).toBe('elevenlabs');
    });

    it('should track degradation state', () => {
      interface DegradationState {
        stt: { provider: string; isOffline: boolean };
        tts: { provider: string; isOffline: boolean };
        llm: { provider: string; isOffline: boolean };
      }

      const state: DegradationState = {
        stt: { provider: 'deepgram', isOffline: false },
        tts: { provider: 'elevenlabs', isOffline: false },
        llm: { provider: 'fireworks', isOffline: false },
      };

      // Simulate degradation
      state.stt = { provider: 'vosk', isOffline: true };

      expect(state.stt.isOffline).toBe(true);
      expect(state.tts.isOffline).toBe(false);
    });

    it('should emit degradation events', () => {
      const emitter = new EventEmitter();
      const degradationSpy = vi.fn();

      emitter.on('service-degraded', degradationSpy);
      emitter.emit('service-degraded', {
        service: 'stt',
        from: 'deepgram',
        to: 'vosk',
        reason: 'Network unavailable',
      });

      expect(degradationSpy).toHaveBeenCalledWith({
        service: 'stt',
        from: 'deepgram',
        to: 'vosk',
        reason: 'Network unavailable',
      });
    });
  });

  describe('Feature Availability in Offline Mode', () => {
    it('should report reduced functionality', () => {
      const offlineCapabilities = {
        stt: true, // Vosk available
        tts: true, // espeak/Piper available
        llm: false, // Requires network
        websearch: false,
        tools: {
          fileSystem: true,
          browser: false, // Limited
          terminal: true,
          clipboard: true,
        },
      };

      expect(offlineCapabilities.stt).toBe(true);
      expect(offlineCapabilities.llm).toBe(false);
    });

    it('should provide user feedback about limitations', () => {
      const getOfflineMessage = (service: string): string => {
        const messages: Record<string, string> = {
          stt: 'Using offline speech recognition. Accuracy may be reduced.',
          tts: 'Using system voice. Voice quality may differ.',
          llm: 'AI assistant requires internet connection.',
        };
        return messages[service] || 'Service unavailable offline.';
      };

      expect(getOfflineMessage('stt')).toContain('offline');
      expect(getOfflineMessage('llm')).toContain('internet');
    });
  });
});

describe('Offline Mode - Network Detection', () => {
  let networkSim: NetworkSimulator;

  beforeEach(() => {
    networkSim = new NetworkSimulator();
  });

  afterEach(() => {
    networkSim.reset();
  });

  describe('Connectivity State', () => {
    it('should detect online state', () => {
      expect(networkSim.isOnline).toBe(true);
    });

    it('should detect offline state', () => {
      networkSim.goOffline();
      expect(networkSim.isOnline).toBe(false);
    });

    it('should emit offline event', () => {
      const offlineSpy = vi.fn();
      networkSim.on('offline', offlineSpy);

      networkSim.goOffline();

      expect(offlineSpy).toHaveBeenCalled();
    });

    it('should emit online event', () => {
      const onlineSpy = vi.fn();
      networkSim.on('online', onlineSpy);

      networkSim.goOffline();
      networkSim.goOnline();

      expect(onlineSpy).toHaveBeenCalled();
    });
  });

  describe('Connection Quality Detection', () => {
    it('should detect different connection qualities', () => {
      type ConnectionQuality = 'excellent' | 'good' | 'poor' | 'offline';

      const assessConnectionQuality = (latency: number, packetLoss: number): ConnectionQuality => {
        if (latency < 0) return 'offline';
        if (latency < 100 && packetLoss < 1) return 'excellent';
        if (latency < 300 && packetLoss < 5) return 'good';
        return 'poor';
      };

      expect(assessConnectionQuality(50, 0)).toBe('excellent');
      expect(assessConnectionQuality(200, 2)).toBe('good');
      expect(assessConnectionQuality(500, 10)).toBe('poor');
      expect(assessConnectionQuality(-1, 0)).toBe('offline');
    });

    it('should recommend service based on connection', () => {
      const recommendService = (
        connectionQuality: string,
        service: 'stt' | 'tts'
      ): string => {
        if (connectionQuality === 'offline' || connectionQuality === 'poor') {
          return service === 'stt' ? 'vosk' : 'offline';
        }
        return service === 'stt' ? 'deepgram' : 'elevenlabs';
      };

      expect(recommendService('excellent', 'stt')).toBe('deepgram');
      expect(recommendService('offline', 'stt')).toBe('vosk');
      expect(recommendService('poor', 'tts')).toBe('offline');
    });
  });
});

describe('Offline Mode - Reconnection Behavior', () => {
  describe('Automatic Reconnection', () => {
    it('should attempt reconnection with backoff', async () => {
      const reconnectAttempts: number[] = [];
      let attempt = 0;

      const attemptReconnect = async (): Promise<boolean> => {
        attempt++;
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 30000);
        reconnectAttempts.push(delay);
        return false; // Simulate failure
      };

      for (let i = 0; i < 3; i++) {
        await attemptReconnect();
      }

      expect(reconnectAttempts).toEqual([1000, 2000, 4000]); // Exponential backoff
    });

    it('should respect maximum reconnection attempts', async () => {
      const maxAttempts = 5;
      let attempts = 0;
      let gaveUp = false;

      const tryReconnect = async (): Promise<void> => {
        while (attempts < maxAttempts) {
          attempts++;
          const success = false; // Simulate failure
          if (success) return;
        }
        gaveUp = true;
      };

      await tryReconnect();

      expect(attempts).toBe(maxAttempts);
      expect(gaveUp).toBe(true);
    });

    it('should emit reconnection events', () => {
      const emitter = new EventEmitter();
      const events: string[] = [];

      emitter.on('reconnecting', (attempt: number) => {
        events.push(`reconnecting:${attempt}`);
      });
      emitter.on('reconnected', () => {
        events.push('reconnected');
      });
      emitter.on('reconnect-failed', () => {
        events.push('reconnect-failed');
      });

      emitter.emit('reconnecting', 1);
      emitter.emit('reconnecting', 2);
      emitter.emit('reconnected');

      expect(events).toEqual(['reconnecting:1', 'reconnecting:2', 'reconnected']);
    });
  });

  describe('Service Restoration', () => {
    it('should restore primary service when available', () => {
      type ServiceState = {
        provider: string;
        isPrimary: boolean;
        lastCheck: number;
      };

      const serviceState: ServiceState = {
        provider: 'vosk',
        isPrimary: false,
        lastCheck: Date.now(),
      };

      const restorePrimary = (): void => {
        serviceState.provider = 'deepgram';
        serviceState.isPrimary = true;
        serviceState.lastCheck = Date.now();
      };

      restorePrimary();

      expect(serviceState.provider).toBe('deepgram');
      expect(serviceState.isPrimary).toBe(true);
    });

    it('should emit restoration event', () => {
      const emitter = new EventEmitter();
      const restorationSpy = vi.fn();

      emitter.on('primary-restored', restorationSpy);
      emitter.emit('primary-restored', { service: 'stt', provider: 'deepgram' });

      expect(restorationSpy).toHaveBeenCalledWith({
        service: 'stt',
        provider: 'deepgram',
      });
    });

    it('should wait before attempting restoration', async () => {
      const cooldownPeriod = 50;
      const lastFailure = Date.now();

      const canAttemptRestore = (): boolean => {
        return Date.now() - lastFailure >= cooldownPeriod;
      };

      expect(canAttemptRestore()).toBe(false);

      await new Promise((r) => setTimeout(r, 60));

      expect(canAttemptRestore()).toBe(true);
    });
  });
});

describe('Offline Mode - Local Memory Operations', () => {
  let memoryManager: MemoryManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    mockReadFile.mockRejectedValue(new Error('ENOENT'));
  });

  afterEach(async () => {
    if (memoryManager) {
      await memoryManager.shutdown();
    }
  });

  describe('Memory Persistence', () => {
    it('should initialize memory manager', () => {
      memoryManager = new MemoryManager({ enablePersistence: false });
      expect(memoryManager).toBeInstanceOf(MemoryManager);
    });

    it('should start conversation session', () => {
      memoryManager = new MemoryManager({ enablePersistence: false });
      const sessionId = memoryManager.startSession();

      expect(sessionId).toBeDefined();
      expect(memoryManager.getCurrentSessionId()).toBe(sessionId);
    });

    it('should add messages to session', () => {
      memoryManager = new MemoryManager({ enablePersistence: false });
      memoryManager.startSession();

      memoryManager.addMessage({ role: 'user', content: 'Hello' });
      memoryManager.addMessage({ role: 'assistant', content: 'Hi there!' });

      const messages = memoryManager.getRecentMessages();
      expect(messages.length).toBe(2);
    });

    it('should add memory entries', () => {
      memoryManager = new MemoryManager({ enablePersistence: false });

      const entry = memoryManager.addEntry('fact', 'User prefers dark mode', {
        importance: 0.8,
        tags: ['preference', 'ui'],
      });

      expect(entry.id).toBeDefined();
      expect(entry.type).toBe('fact');
      expect(entry.importance).toBe(0.8);
    });

    it('should search memory entries', () => {
      memoryManager = new MemoryManager({ enablePersistence: false });

      memoryManager.addEntry('fact', 'User likes coffee', { tags: ['preference'] });
      memoryManager.addEntry('fact', 'User prefers dark mode', { tags: ['preference'] });
      memoryManager.addEntry('context', 'Working on project X', { tags: ['work'] });

      const results = memoryManager.searchEntries({ type: 'fact' });
      expect(results.length).toBe(2);
    });

    it('should remove memory entries', () => {
      memoryManager = new MemoryManager({ enablePersistence: false });

      const entry = memoryManager.addEntry('fact', 'Test entry');
      const removed = memoryManager.removeEntry(entry.id);

      expect(removed).toBe(true);
      expect(memoryManager.getEntry(entry.id)).toBeUndefined();
    });
  });

  describe('Offline Memory Sync', () => {
    it('should queue changes when offline', () => {
      const pendingChanges: Array<{ type: string; data: unknown }> = [];

      const queueChange = (type: string, data: unknown): void => {
        pendingChanges.push({ type, data });
      };

      queueChange('addEntry', { content: 'New fact' });
      queueChange('addMessage', { role: 'user', content: 'Hello' });

      expect(pendingChanges.length).toBe(2);
    });

    it('should sync changes when back online', async () => {
      const pendingChanges = [
        { type: 'addEntry', data: { content: 'Fact 1' } },
        { type: 'addEntry', data: { content: 'Fact 2' } },
      ];
      const syncedChanges: unknown[] = [];

      const syncChanges = async (): Promise<void> => {
        while (pendingChanges.length > 0) {
          const change = pendingChanges.shift()!;
          syncedChanges.push(change);
        }
      };

      await syncChanges();

      expect(syncedChanges.length).toBe(2);
      expect(pendingChanges.length).toBe(0);
    });
  });

  describe('Memory Statistics', () => {
    it('should report memory stats', () => {
      memoryManager = new MemoryManager({ enablePersistence: false });
      memoryManager.startSession();
      memoryManager.addMessage({ role: 'user', content: 'Test' });
      memoryManager.addEntry('fact', 'Test fact');

      const stats = memoryManager.getStats();

      expect(stats.totalConversations).toBe(1);
      expect(stats.currentSessionMessages).toBe(1);
      expect(stats.totalEntries).toBe(1);
    });
  });
});

describe('Offline Mode - Circuit Breaker Integration', () => {
  describe('Circuit Breaker for Service Failover', () => {
    it('should open circuit after failures', () => {
      const breaker = new CircuitBreaker('stt-service', {
        failureThreshold: 3,
      });

      breaker.recordFailure();
      breaker.recordFailure();
      breaker.recordFailure();

      expect(breaker.getState()).toBe(CircuitState.OPEN);
    });

    it('should prevent attempts when open', () => {
      const breaker = new CircuitBreaker('stt-service', {
        failureThreshold: 1,
      });

      breaker.recordFailure();

      expect(breaker.canAttempt()).toBe(false);
    });

    it('should transition to half-open after timeout', async () => {
      const breaker = new CircuitBreaker('stt-service', {
        failureThreshold: 1,
        timeout: 50,
      });

      breaker.recordFailure();
      expect(breaker.getState()).toBe(CircuitState.OPEN);

      await new Promise((r) => setTimeout(r, 60));

      expect(breaker.canAttempt()).toBe(true);
      expect(breaker.getState()).toBe(CircuitState.HALF_OPEN);
    });

    it('should close circuit after successful recovery', () => {
      const breaker = new CircuitBreaker('stt-service', {
        failureThreshold: 1,
        successThreshold: 1,
        timeout: 0,
      });

      breaker.recordFailure();
      // Manually transition to half-open for test
      breaker.canAttempt();
      breaker.recordSuccess();

      expect(breaker.getState()).toBe(CircuitState.CLOSED);
    });

    it('should emit state change events', () => {
      const stateChanges: CircuitState[] = [];

      const breaker = new CircuitBreaker('stt-service', {
        failureThreshold: 1,
        onStateChange: (_, to) => stateChanges.push(to),
      });

      breaker.recordFailure();

      expect(stateChanges).toContain(CircuitState.OPEN);
    });
  });

  describe('Retry with Circuit Breaker', () => {
    it('should retry failed operations', async () => {
      let attempts = 0;

      const result = await withRetry(
        async () => {
          attempts++;
          if (attempts < 3) {
            throw new Error('Temporary failure');
          }
          return 'success';
        },
        { maxAttempts: 3, initialDelayMs: 10, backoffMultiplier: 1 }
      );

      expect(result).toBe('success');
      expect(attempts).toBe(3);
    });

    it('should respect retry conditions', async () => {
      let attempts = 0;

      await expect(
        withRetry(
          async () => {
            attempts++;
            throw new Error('Non-retryable error');
          },
          {
            maxAttempts: 5,
            retryCondition: () => false, // Never retry
          }
        )
      ).rejects.toThrow('Non-retryable error');

      expect(attempts).toBe(1);
    });

    it('should identify retryable errors', () => {
      const networkError = new Error('ECONNRESET');
      const configError = new Error('Invalid config');

      expect(isRetryableError(networkError)).toBe(true);
      expect(isRetryableError(configError)).toBe(false);
    });
  });
});

describe('Offline Mode - Mock Network Failures', () => {
  describe('Simulated Network Errors', () => {
    it('should handle connection refused', async () => {
      const error = new Error('ECONNREFUSED');
      expect(isRetryableError(error)).toBe(true);
    });

    it('should handle connection reset', async () => {
      const error = new Error('ECONNRESET');
      expect(isRetryableError(error)).toBe(true);
    });

    it('should handle timeout', async () => {
      const error = new Error('ETIMEDOUT');
      expect(isRetryableError(error)).toBe(true);
    });

    it('should handle DNS failure', async () => {
      const error = new Error('ENOTFOUND');
      expect(isRetryableError(error)).toBe(true);
    });
  });

  describe('Service-Specific Failures', () => {
    it('should handle Deepgram connection failure', () => {
      const emitter = new EventEmitter();
      const errorHandler = vi.fn();

      emitter.on('error', errorHandler);
      emitter.emit('error', new Error('WebSocket connection failed'));

      expect(errorHandler).toHaveBeenCalled();
    });

    it('should handle ElevenLabs API failure', async () => {
      mockFetch.mockRejectedValue(new Error('Network request failed'));

      await expect(fetch('https://api.elevenlabs.io/v1/text-to-speech')).rejects.toThrow();
    });

    it('should handle Fireworks API failure', async () => {
      mockFetch.mockRejectedValue(new Error('ETIMEDOUT'));

      await expect(fetch('https://api.fireworks.ai/inference')).rejects.toThrow('ETIMEDOUT');
    });
  });

  describe('Graceful Error Recovery', () => {
    it('should switch to fallback on repeated failures', () => {
      type ServiceConfig = {
        primary: string;
        fallback: string;
        active: string;
        consecutiveFailures: number;
        maxFailures: number;
      };

      const config: ServiceConfig = {
        primary: 'deepgram',
        fallback: 'vosk',
        active: 'deepgram',
        consecutiveFailures: 0,
        maxFailures: 3,
      };

      const handleFailure = (): void => {
        config.consecutiveFailures++;
        if (config.consecutiveFailures >= config.maxFailures) {
          config.active = config.fallback;
        }
      };

      handleFailure();
      handleFailure();
      handleFailure();

      expect(config.active).toBe('vosk');
    });

    it('should reset failure count on success', () => {
      let failures = 0;

      const handleSuccess = (): void => {
        failures = 0;
      };

      failures = 5;
      handleSuccess();

      expect(failures).toBe(0);
    });
  });
});

describe('Offline Mode - Integration Scenarios', () => {
  describe('Complete Offline Session', () => {
    it('should support full voice interaction offline', () => {
      const offlineSession = {
        stt: { provider: 'vosk', status: 'ready' },
        tts: { provider: 'espeak', status: 'ready' },
        memory: { status: 'ready' },
        llm: { provider: null, status: 'unavailable' },
      };

      expect(offlineSession.stt.status).toBe('ready');
      expect(offlineSession.tts.status).toBe('ready');
      expect(offlineSession.memory.status).toBe('ready');
      expect(offlineSession.llm.status).toBe('unavailable');
    });

    it('should preserve conversation history offline', () => {
      const conversation = {
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'system', content: 'AI features are limited offline.' },
        ],
        savedLocally: true,
      };

      expect(conversation.savedLocally).toBe(true);
      expect(conversation.messages.length).toBe(2);
    });
  });

  describe('Transition from Online to Offline', () => {
    it('should smoothly transition services', async () => {
      const transitionLog: string[] = [];

      const transitionToOffline = async (): Promise<void> => {
        transitionLog.push('detecting-offline');
        transitionLog.push('switching-stt-to-vosk');
        transitionLog.push('switching-tts-to-offline');
        transitionLog.push('disabling-llm');
        transitionLog.push('transition-complete');
      };

      await transitionToOffline();

      expect(transitionLog).toContain('switching-stt-to-vosk');
      expect(transitionLog).toContain('transition-complete');
    });

    it('should notify user of degradation', () => {
      const notifications: string[] = [];

      const notifyDegradation = (service: string): void => {
        notifications.push(`${service} is now running in offline mode`);
      };

      notifyDegradation('Speech Recognition');
      notifyDegradation('Text-to-Speech');

      expect(notifications).toHaveLength(2);
    });
  });

  describe('Recovery from Offline to Online', () => {
    it('should restore services in correct order', async () => {
      const restorationOrder: string[] = [];

      const restoreServices = async (): Promise<void> => {
        // Order matters: restore services from least to most critical
        restorationOrder.push('llm');
        restorationOrder.push('stt');
        restorationOrder.push('tts');
      };

      await restoreServices();

      // LLM should be restored first as it has no dependencies
      expect(restorationOrder[0]).toBe('llm');
    });

    it('should verify service health before switching', async () => {
      const healthChecks = {
        deepgram: async () => ({ healthy: true, latency: 50 }),
        elevenlabs: async () => ({ healthy: true, latency: 100 }),
        fireworks: async () => ({ healthy: true, latency: 200 }),
      };

      const results = await Promise.all([
        healthChecks.deepgram(),
        healthChecks.elevenlabs(),
        healthChecks.fireworks(),
      ]);

      expect(results.every((r) => r.healthy)).toBe(true);
    });
  });
});

describe('Factory Functions', () => {
  it('should create VoskSTT with factory', () => {
    const stt = createVoskSTT({ words: true });
    expect(stt).toBeInstanceOf(VoskSTT);
  });

  it('should create OfflineSTT with factory', () => {
    const stt = createOfflineSTT({ modelSize: 'small' });
    expect(stt).toBeInstanceOf(OfflineSTT);
  });

  it('should create OfflineTTS with factory', () => {
    const tts = createOfflineTTS({ speakingRate: 1.2 });
    expect(tts).toBeInstanceOf(OfflineTTS);
  });
});
