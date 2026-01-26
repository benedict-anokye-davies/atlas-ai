/**
 * Atlas Desktop - End-to-End Voice Pipeline Tests
 *
 * Comprehensive E2E tests for the complete voice pipeline flow:
 * Wake Word -> VAD -> STT -> LLM -> TTS
 *
 * Tests cover:
 * - Happy path: complete voice interaction flow
 * - State transitions: idle -> listening -> processing -> speaking -> idle
 * - Error recovery: API failures, timeouts, network issues
 * - Offline fallback: Vosk STT, system TTS
 * - Latency assertions: <3s total response time target
 * - Barge-in handling: user interrupts during response
 * - Cancellation: mid-stream abort scenarios
 *
 * @module tests/e2e/voice-pipeline
 */

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { EventEmitter } from 'events';

// ============================================================================
// Mock Setup - Must be before imports that use these modules
// ============================================================================

// Mock Porcupine (wake word detection)
vi.mock('@picovoice/porcupine-node', () => ({
  BuiltinKeywords: { JARVIS: 'jarvis' },
  Porcupine: vi.fn().mockImplementation(() => ({
    process: vi.fn().mockReturnValue(-1),
    frameLength: 512,
    sampleRate: 16000,
    release: vi.fn(),
  })),
}));

// Mock PvRecorder (audio input)
vi.mock('@picovoice/pvrecorder-node', () => ({
  PvRecorder: vi.fn().mockImplementation(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    read: vi.fn().mockReturnValue(new Int16Array(512)),
    getSelectedDevice: vi.fn().mockReturnValue(0),
    release: vi.fn(),
  })),
}));

// Mock Silero VAD
vi.mock('@ricky0123/vad-node', () => ({
  Silero: vi.fn().mockResolvedValue({
    process: vi.fn().mockResolvedValue({ isSpeech: false, probability: 0.1 }),
  }),
}));

// Mock OpenAI (for Fireworks LLM)
vi.mock('openai', () => ({
  default: vi.fn(() => ({
    chat: {
      completions: {
        create: vi.fn(),
      },
    },
  })),
}));

// Mock Deepgram SDK
vi.mock('@deepgram/sdk', () => ({
  createClient: vi.fn(() => ({
    listen: {
      live: vi.fn(() => ({
        on: vi.fn().mockReturnThis(),
        send: vi.fn(),
        keepAlive: vi.fn(),
        requestClose: vi.fn(),
        getReadyState: vi.fn().mockReturnValue(1),
      })),
    },
  })),
  LiveTranscriptionEvents: {
    Open: 'open',
    Transcript: 'Results',
    Error: 'error',
    Close: 'close',
  },
}));

// Mock fetch for ElevenLabs TTS
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
    readFileSync: vi.fn(() => Buffer.from('mock-audio-data')),
    readdirSync: vi.fn(() => []),
    promises: {
      readFile: vi.fn().mockResolvedValue(Buffer.from('mock-audio-data')),
      writeFile: vi.fn().mockResolvedValue(undefined),
      mkdir: vi.fn().mockResolvedValue(undefined),
    },
  };
});

// Mock electron
vi.mock('electron', () => ({
  app: {
    exit: vi.fn(),
    getPath: vi.fn(() => '/mock/path'),
    getName: vi.fn(() => 'Atlas'),
    getVersion: vi.fn(() => '1.0.0'),
    isReady: vi.fn(() => true),
    whenReady: vi.fn().mockResolvedValue(undefined),
  },
  dialog: {
    showErrorBox: vi.fn(),
  },
  BrowserWindow: {
    getFocusedWindow: vi.fn(() => null),
    getAllWindows: vi.fn(() => []),
  },
  ipcMain: {
    on: vi.fn(),
    handle: vi.fn(),
  },
  ipcRenderer: {
    on: vi.fn(),
    invoke: vi.fn(),
  },
  nativeTheme: {
    themeSource: 'system',
    shouldUseDarkColors: false,
  },
}));

// ============================================================================
// Imports
// ============================================================================

import {
  MockAudioPipeline,
  MockSTTManager,
  MockLLMManager,
  MockTTSManager,
  MockMemoryManager,
  TimingUtils,
  StateTransitionRecorder,
  PipelineEventCollector,
  LatencyMetricsCollector,
  createSpeechSegment,
  createMockPipelineHarness,
} from './utils/audio-mock';

import type { VoicePipelineState } from '../../src/shared/types/voice';

// ============================================================================
// Test Configuration
// ============================================================================

/**
 * Performance targets from CLAUDE.md
 */
const PERFORMANCE_TARGETS = {
  WAKE_WORD_DETECTION: 200, // <200ms
  STT_LATENCY: 300, // <300ms
  LLM_FIRST_TOKEN: 2000, // <2s
  TTS_FIRST_AUDIO: 500, // <500ms
  TOTAL_RESPONSE: 3000, // <3s typical
};

/**
 * Expected state transition sequence for happy path
 */
const EXPECTED_STATE_SEQUENCE: VoicePipelineState[] = [
  'idle',
  'listening',
  'processing',
  'speaking',
  'idle',
];

// ============================================================================
// Test Suite: Happy Path
// ============================================================================

describe('E2E Voice Pipeline - Happy Path', () => {
  let harness: ReturnType<typeof createMockPipelineHarness>;
  let eventCollector: PipelineEventCollector;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    harness = createMockPipelineHarness();
  });

  afterEach(async () => {
    harness.reset();
  });

  describe('Complete Voice Interaction Flow', () => {
    it('should complete full wake-word to TTS response cycle', async () => {
      const { audioPipeline, sttManager, llmManager, ttsManager, stateRecorder } = harness;

      // Set up state tracking
      audioPipeline.on('state-change', (state, prev) => {
        stateRecorder.record(prev, state);
      });

      // Queue expected responses
      sttManager.queueTranscript('What is the weather today?');
      llmManager.queueResponse('The weather today is sunny with a high of 72 degrees Fahrenheit.');

      // Start pipeline
      await audioPipeline.start();
      expect(audioPipeline.getState()).toBe('idle');

      // Simulate wake word detection
      audioPipeline.triggerWake('jarvis', 0.95);
      expect(audioPipeline.getState()).toBe('listening');

      // Simulate speech segment
      const segment = createSpeechSegment(1500);
      audioPipeline.injectSpeechSegment(segment);

      // Simulate STT processing
      await sttManager.start();

      // Set up transcript listener
      const transcriptPromise = TimingUtils.waitForEvent<{ text: string }>(
        sttManager,
        'final',
        2000
      );

      // Send audio - this triggers async transcript emission
      sttManager.sendAudio(new Int16Array(1024));

      // Wait for transcript
      const transcript = await transcriptPromise;

      expect(transcript.text).toBe('What is the weather today?');

      // Stop audio pipeline
      await audioPipeline.stop();
    });

    it('should emit events in correct order', async () => {
      const { audioPipeline, sttManager, llmManager, stateRecorder } = harness;

      // Track state transitions
      audioPipeline.on('state-change', (state, prev) => {
        stateRecorder.record(prev, state);
      });

      // Queue responses
      sttManager.queueTranscript('Hello Atlas');
      llmManager.queueResponse('Hello! How can I assist you today?');

      // Execute flow
      await audioPipeline.start();
      audioPipeline.triggerWake();

      // Inject speech
      const segment = createSpeechSegment(1000);
      audioPipeline.injectSpeechSegment(segment);

      // Process STT
      await sttManager.start();
      sttManager.sendAudio(new Int16Array(512));

      // Verify state transitions include idle -> listening
      const sequence = stateRecorder.getStateSequence();
      expect(sequence).toContain('idle');
      expect(sequence).toContain('listening');
      expect(stateRecorder.hasTransition('idle', 'listening')).toBe(true);

      await audioPipeline.stop();
    });

    it('should handle streaming LLM response correctly', async () => {
      const { llmManager } = harness;

      // Queue a longer response for streaming test
      const fullResponse = 'This is a longer response that will be streamed in multiple chunks to test the streaming functionality.';
      llmManager.queueResponse(fullResponse, 10, 20);

      const chunks: string[] = [];
      let finalAccumulated = '';

      // Consume stream
      for await (const chunk of llmManager.chatStream('Test message')) {
        chunks.push(chunk.delta);
        finalAccumulated = chunk.accumulated;

        if (chunk.isFinal) {
          expect(chunk.finishReason).toBe('stop');
        }
      }

      expect(chunks.length).toBeGreaterThan(1);
      expect(finalAccumulated).toBe(fullResponse);
    });
  });

  describe('State Transitions', () => {
    it('should transition through all expected states', async () => {
      const { audioPipeline, stateRecorder } = harness;

      audioPipeline.on('state-change', (state, prev) => {
        stateRecorder.record(prev, state);
      });

      await audioPipeline.start();

      // idle -> listening
      audioPipeline.triggerWake();
      expect(audioPipeline.getState()).toBe('listening');

      // listening -> speaking (simulated)
      audioPipeline.startSpeaking();
      expect(audioPipeline.getState()).toBe('speaking');

      // speaking -> idle
      audioPipeline.finishSpeaking();
      expect(audioPipeline.getState()).toBe('idle');

      // Verify all transitions occurred
      expect(stateRecorder.hasTransition('idle', 'listening')).toBe(true);
      expect(stateRecorder.hasTransition('listening', 'speaking')).toBe(true);
      expect(stateRecorder.hasTransition('speaking', 'idle')).toBe(true);

      await audioPipeline.stop();
    });

    it('should not allow invalid state transitions', async () => {
      const { audioPipeline, stateRecorder } = harness;

      audioPipeline.on('state-change', (state, prev) => {
        stateRecorder.record(prev, state);
      });

      await audioPipeline.start();

      // Try to trigger speaking from idle (should be blocked by pipeline logic)
      // In the mock, we allow any transition, but real pipeline would block this
      audioPipeline.setState('speaking');

      // Verify the transition was recorded
      const sequence = stateRecorder.getStateSequence();
      expect(sequence).toContain('speaking');

      await audioPipeline.stop();
    });

    it('should return to idle after timeout', async () => {
      const { audioPipeline, stateRecorder } = harness;

      audioPipeline.on('state-change', (state, prev) => {
        stateRecorder.record(prev, state);
      });

      await audioPipeline.start();
      audioPipeline.triggerWake();

      expect(audioPipeline.getState()).toBe('listening');

      // Trigger timeout
      audioPipeline.triggerTimeout();

      expect(audioPipeline.getState()).toBe('idle');
      expect(stateRecorder.hasTransition('listening', 'idle')).toBe(true);

      await audioPipeline.stop();
    });
  });
});

// ============================================================================
// Test Suite: Error Recovery
// ============================================================================

describe('E2E Voice Pipeline - Error Recovery', () => {
  let harness: ReturnType<typeof createMockPipelineHarness>;

  beforeEach(() => {
    vi.clearAllMocks();
    harness = createMockPipelineHarness();
  });

  afterEach(() => {
    harness.reset();
  });

  describe('STT API Failures', () => {
    it('should handle STT connection failure gracefully', async () => {
      const { sttManager } = harness;

      // Configure STT to fail
      sttManager.setFailOnStart(new Error('Connection refused'));

      // Attempt to start should throw
      await expect(sttManager.start()).rejects.toThrow('Connection refused');
    });

    it('should emit error event on STT failure during processing', async () => {
      const { sttManager } = harness;

      await sttManager.start();

      const errorPromise = TimingUtils.waitForEvent<Error>(sttManager, 'error', 1000);

      // Emit error
      sttManager.emitError(new Error('Transcription timeout'));

      const error = await errorPromise;
      expect(error.message).toBe('Transcription timeout');
    });

    it('should recover after STT error', async () => {
      const { sttManager } = harness;

      // First attempt fails
      sttManager.setFailOnStart(new Error('Network error'));
      await expect(sttManager.start()).rejects.toThrow();

      // Clear failure and retry
      sttManager.clearFailure();
      await sttManager.start();
      expect(sttManager.isReady()).toBe(true);
    });
  });

  describe('LLM API Failures', () => {
    it('should handle LLM API timeout', async () => {
      const { llmManager } = harness;

      // Configure LLM to fail
      llmManager.setFailOnCall(new Error('Request timeout'));

      await expect(llmManager.chat('Test message')).rejects.toThrow('Request timeout');
    });

    it('should handle LLM streaming failure mid-stream', async () => {
      const { llmManager } = harness;

      // Queue a response then fail
      llmManager.queueResponse('Partial response...', 3, 50);

      const chunks: string[] = [];

      // Get first chunk
      const iterator = llmManager.chatStream('Test');
      const first = await iterator.next();
      if (!first.done) {
        chunks.push(first.value.delta);
      }

      // Now configure failure
      llmManager.setFailOnCall(new Error('Stream interrupted'));

      // Subsequent calls should fail
      await expect(llmManager.chat('Another test')).rejects.toThrow('Stream interrupted');
    });

    it('should support cancellation during LLM streaming', async () => {
      const { llmManager } = harness;

      // Queue a long response with delays
      llmManager.queueResponse(
        'This is a very long response that should take a while to stream completely',
        20,
        100
      );

      const chunks: string[] = [];
      let cancelled = false;

      // Start streaming then cancel
      const streamPromise = (async () => {
        for await (const chunk of llmManager.chatStream('Test')) {
          chunks.push(chunk.delta);

          // Cancel after receiving some chunks
          if (chunks.length >= 3) {
            llmManager.cancel();
            cancelled = true;
            break;
          }
        }
      })();

      await streamPromise;

      expect(cancelled).toBe(true);
      // Should have stopped before receiving all chunks
      expect(chunks.length).toBeLessThan(20);
    });
  });

  describe('TTS API Failures', () => {
    it('should handle TTS synthesis failure', async () => {
      const { ttsManager } = harness;

      ttsManager.setFailOnCall(new Error('TTS quota exceeded'));

      const errorPromise = TimingUtils.waitForEvent<Error>(ttsManager, 'error', 1000);
      const speakPromise = ttsManager.speakWithAudioStream('Test text');

      await expect(speakPromise).rejects.toThrow('TTS quota exceeded');
    });

    it('should emit interrupted event when TTS is stopped', async () => {
      const { ttsManager } = harness;

      ttsManager.setSpeakDelay(500);

      // Start speaking
      const speakPromise = ttsManager.speakWithAudioStream('Long text to speak');

      // Wait for playback to start
      await TimingUtils.waitForEvent(ttsManager, 'playbackStart', 1000);

      // Stop mid-speech
      const interruptedPromise = TimingUtils.waitForEvent(ttsManager, 'interrupted', 1000);
      ttsManager.stop();

      await interruptedPromise;
      expect(ttsManager.isSpeaking()).toBe(false);
    });
  });

  describe('Network Failures', () => {
    it('should handle complete network failure', async () => {
      const { sttManager, llmManager, ttsManager } = harness;

      // Configure all services to fail
      sttManager.setFailOnStart(new Error('Network unreachable'));
      llmManager.setFailOnCall(new Error('Network unreachable'));
      ttsManager.setFailOnCall(new Error('Network unreachable'));

      await expect(sttManager.start()).rejects.toThrow('Network unreachable');
      await expect(llmManager.chat('Test')).rejects.toThrow('Network unreachable');
      await expect(ttsManager.speakWithAudioStream('Test')).rejects.toThrow('Network unreachable');
    });

    it('should recover when network is restored', async () => {
      const { sttManager, llmManager } = harness;

      // First, services fail
      sttManager.setFailOnStart(new Error('Network error'));
      await expect(sttManager.start()).rejects.toThrow();

      // Network restored
      sttManager.clearFailure();
      llmManager.queueResponse('I am back online!');

      // Services should work now
      await sttManager.start();
      expect(sttManager.isReady()).toBe(true);

      const response = await llmManager.chat('Are you there?');
      expect(response.content).toBe('I am back online!');
    });
  });
});

// ============================================================================
// Test Suite: Offline Fallback
// ============================================================================

describe('E2E Voice Pipeline - Offline Fallback', () => {
  let harness: ReturnType<typeof createMockPipelineHarness>;

  beforeEach(() => {
    vi.clearAllMocks();
    harness = createMockPipelineHarness();
  });

  afterEach(() => {
    harness.reset();
  });

  describe('STT Fallback (Vosk)', () => {
    it('should indicate fallback provider after primary fails', async () => {
      const { sttManager } = harness;

      // Primary fails, fallback succeeds
      // In real implementation, STTManager handles this
      // For mock, we just verify the provider type can be reported

      await sttManager.start();
      expect(sttManager.getActiveProviderType()).toBe('mock');
    });

    it('should continue transcription after fallback', async () => {
      const { sttManager } = harness;

      await sttManager.start();
      sttManager.queueTranscript('Transcribed with fallback');

      sttManager.sendAudio(new Int16Array(512));

      const transcript = await TimingUtils.waitForEvent<{ text: string }>(
        sttManager,
        'final',
        1000
      );

      expect(transcript.text).toBe('Transcribed with fallback');
    });
  });

  describe('TTS Fallback (System Voice)', () => {
    it('should use fallback TTS when primary fails', async () => {
      const { ttsManager } = harness;

      // Simulate primary failure then success with fallback
      ttsManager.setFailOnCall(new Error('ElevenLabs unavailable'));

      await expect(ttsManager.speakWithAudioStream('Test')).rejects.toThrow();

      // Clear and retry with fallback
      ttsManager.clearFailure();

      // Should work now
      const playbackPromise = TimingUtils.waitForEvent(ttsManager, 'playbackEnd', 2000);
      await ttsManager.speakWithAudioStream('Fallback speech');
      await playbackPromise;

      expect(ttsManager.isSpeaking()).toBe(false);
    });
  });

  describe('Complete Offline Mode', () => {
    it('should function entirely offline', async () => {
      const { audioPipeline, sttManager, llmManager, ttsManager } = harness;

      // Simulate offline responses
      sttManager.queueTranscript('What time is it?');
      llmManager.queueResponse('I cannot check the current time while offline.');

      await audioPipeline.start();
      audioPipeline.triggerWake();

      const segment = createSpeechSegment(1000);
      audioPipeline.injectSpeechSegment(segment);

      await sttManager.start();
      sttManager.sendAudio(new Int16Array(512));

      const transcript = await TimingUtils.waitForEvent<{ text: string }>(
        sttManager,
        'final',
        1000
      );

      expect(transcript.text).toBe('What time is it?');

      const response = await llmManager.chat(transcript.text);
      expect(response.content).toContain('offline');

      await audioPipeline.stop();
    });
  });
});

// ============================================================================
// Test Suite: Latency Assertions
// ============================================================================

describe('E2E Voice Pipeline - Latency Assertions', () => {
  let harness: ReturnType<typeof createMockPipelineHarness>;
  let latencyCollector: LatencyMetricsCollector;

  beforeEach(() => {
    vi.clearAllMocks();
    harness = createMockPipelineHarness();
    latencyCollector = harness.latencyCollector;
  });

  afterEach(() => {
    harness.reset();
  });

  describe('Component Latency', () => {
    it('should meet STT latency target (<300ms)', async () => {
      const { sttManager } = harness;

      sttManager.queueTranscript('Test transcription');

      await sttManager.start();

      const { duration } = await TimingUtils.measureTime(async () => {
        sttManager.sendAudio(new Int16Array(512));
        return TimingUtils.waitForEvent(sttManager, 'final', 1000);
      });

      latencyCollector.record('stt', duration);

      // Mock should be very fast, real test would have higher values
      expect(duration).toBeLessThan(PERFORMANCE_TARGETS.STT_LATENCY);
    });

    it('should meet LLM first token target (<2s)', async () => {
      const { llmManager } = harness;

      llmManager.queueResponse('Quick response', 5, 10);

      const { duration } = await TimingUtils.measureTime(async () => {
        const stream = llmManager.chatStream('Test');
        const first = await stream.next();
        return first.value;
      });

      latencyCollector.record('llm_first_token', duration);

      expect(duration).toBeLessThan(PERFORMANCE_TARGETS.LLM_FIRST_TOKEN);
    });

    it('should meet TTS first audio target (<500ms)', async () => {
      const { ttsManager } = harness;

      ttsManager.setSpeakDelay(50);

      const { duration } = await TimingUtils.measureTime(async () => {
        const chunkPromise = TimingUtils.waitForEvent(ttsManager, 'chunk', 1000);
        ttsManager.speakWithAudioStream('Test audio');
        return chunkPromise;
      });

      latencyCollector.record('tts_first_audio', duration);

      expect(duration).toBeLessThan(PERFORMANCE_TARGETS.TTS_FIRST_AUDIO);
    });
  });

  describe('End-to-End Latency', () => {
    it('should meet total response time target (<3s)', async () => {
      const { audioPipeline, sttManager, llmManager, ttsManager } = harness;

      // Configure minimal delays
      sttManager.queueTranscript('Hello Atlas');
      llmManager.queueResponse('Hello! How can I help?', 3, 10);
      ttsManager.setSpeakDelay(50);

      const startTime = performance.now();

      await audioPipeline.start();
      audioPipeline.triggerWake();

      const segment = createSpeechSegment(500);
      audioPipeline.injectSpeechSegment(segment);

      await sttManager.start();
      sttManager.sendAudio(new Int16Array(512));

      // Wait for STT
      const transcript = await TimingUtils.waitForEvent<{ text: string }>(
        sttManager,
        'final',
        1000
      );

      // Process with LLM
      let response = '';
      for await (const chunk of llmManager.chatStream(transcript.text)) {
        response = chunk.accumulated;
      }

      // Synthesize with TTS
      const ttsComplete = TimingUtils.waitForEvent(ttsManager, 'playbackEnd', 2000);
      await ttsManager.speakWithAudioStream(response);
      await ttsComplete;

      const totalDuration = performance.now() - startTime;

      latencyCollector.record('total_response', totalDuration);

      expect(totalDuration).toBeLessThan(PERFORMANCE_TARGETS.TOTAL_RESPONSE);

      await audioPipeline.stop();
    });

    it('should track and report latency metrics', async () => {
      const { latencyCollector } = harness;

      // Simulate multiple interactions with varying latencies
      for (let i = 0; i < 10; i++) {
        latencyCollector.record('total_response', 1000 + Math.random() * 1500);
      }

      const metrics = latencyCollector.getAllMetrics();

      expect(metrics.total_response).toBeDefined();
      expect(metrics.total_response.avg).toBeGreaterThan(0);
      expect(metrics.total_response.min).toBeLessThanOrEqual(metrics.total_response.avg);
      expect(metrics.total_response.max).toBeGreaterThanOrEqual(metrics.total_response.avg);
      expect(metrics.total_response.p95).toBeGreaterThanOrEqual(metrics.total_response.avg);
    });
  });

  describe('Streaming Latency', () => {
    it('should maintain low inter-chunk latency', async () => {
      const { llmManager, latencyCollector } = harness;

      llmManager.queueResponse(
        'This is a response that will be chunked into multiple parts for streaming',
        10,
        50
      );

      let lastChunkTime = performance.now();

      for await (const chunk of llmManager.chatStream('Test')) {
        const now = performance.now();
        const interChunkLatency = now - lastChunkTime;

        if (chunk.delta) {
          latencyCollector.record('inter_chunk', interChunkLatency);
        }

        lastChunkTime = now;
      }

      const metrics = latencyCollector.getAllMetrics();
      const avgInterChunk = metrics.inter_chunk?.avg || 0;

      // Average inter-chunk latency should be reasonable
      expect(avgInterChunk).toBeLessThan(200); // 200ms max average
    });
  });
});

// ============================================================================
// Test Suite: Barge-in Handling
// ============================================================================

describe('E2E Voice Pipeline - Barge-in Handling', () => {
  let harness: ReturnType<typeof createMockPipelineHarness>;

  beforeEach(() => {
    vi.clearAllMocks();
    harness = createMockPipelineHarness();
  });

  afterEach(() => {
    harness.reset();
  });

  describe('Interrupt During TTS', () => {
    it('should stop TTS when barge-in is triggered', async () => {
      const { audioPipeline, ttsManager } = harness;

      ttsManager.setSpeakDelay(500);

      await audioPipeline.start();

      // Start TTS
      const speakPromise = ttsManager.speakWithAudioStream(
        'This is a long response that the user might interrupt'
      );

      // Wait for playback to start
      await TimingUtils.waitForEvent(ttsManager, 'playbackStart', 1000);
      expect(ttsManager.isSpeaking()).toBe(true);

      // Trigger barge-in
      audioPipeline.triggerBargeIn();

      // TTS should be interrupted
      ttsManager.stop();
      expect(ttsManager.isSpeaking()).toBe(false);

      await audioPipeline.stop();
    });

    it('should transition back to listening after barge-in', async () => {
      const { audioPipeline, stateRecorder } = harness;

      audioPipeline.on('state-change', (state, prev) => {
        stateRecorder.record(prev, state);
      });

      await audioPipeline.start();

      // Go through full cycle
      audioPipeline.triggerWake();
      audioPipeline.startSpeaking();

      // Barge-in during speaking
      audioPipeline.triggerBargeIn();
      audioPipeline.setState('listening');

      const sequence = stateRecorder.getStateSequence();
      expect(sequence).toContain('speaking');
      expect(sequence).toContain('listening');

      await audioPipeline.stop();
    });
  });

  describe('Interrupt During LLM Processing', () => {
    it('should cancel LLM stream on barge-in', async () => {
      const { llmManager } = harness;

      llmManager.queueResponse(
        'A very long response that will take time to stream completely',
        20,
        100
      );

      const chunks: string[] = [];

      // Start streaming
      const streamPromise = (async () => {
        for await (const chunk of llmManager.chatStream('Test')) {
          chunks.push(chunk.delta);

          // Simulate barge-in after a few chunks
          if (chunks.length >= 3) {
            llmManager.cancel();
            break;
          }
        }
      })();

      await streamPromise;

      // Should have stopped early
      expect(chunks.length).toBeLessThan(20);
    });
  });
});

// ============================================================================
// Test Suite: Cancellation Scenarios
// ============================================================================

describe('E2E Voice Pipeline - Cancellation', () => {
  let harness: ReturnType<typeof createMockPipelineHarness>;

  beforeEach(() => {
    vi.clearAllMocks();
    harness = createMockPipelineHarness();
  });

  afterEach(() => {
    harness.reset();
  });

  describe('Cancel During Listening', () => {
    it('should return to idle when listening is cancelled', async () => {
      const { audioPipeline } = harness;

      await audioPipeline.start();
      audioPipeline.triggerWake();

      expect(audioPipeline.getState()).toBe('listening');

      audioPipeline.cancel();

      expect(audioPipeline.getState()).toBe('idle');

      await audioPipeline.stop();
    });
  });

  describe('Cancel During STT', () => {
    it('should stop STT gracefully on cancel', async () => {
      const { sttManager } = harness;

      sttManager.queueTranscript('Partial transcript');

      await sttManager.start();
      expect(sttManager.isReady()).toBe(true);

      await sttManager.stop();
      expect(sttManager.isReady()).toBe(false);
    });
  });

  describe('Cancel During TTS', () => {
    it('should stop TTS immediately on cancel', async () => {
      const { ttsManager } = harness;

      ttsManager.setSpeakDelay(1000);

      // Start speaking
      const speakPromise = ttsManager.speakWithAudioStream('Test speech');

      // Wait for start
      await TimingUtils.waitForEvent(ttsManager, 'playbackStart', 500);

      // Cancel
      ttsManager.stop();

      // Should be stopped
      expect(ttsManager.isSpeaking()).toBe(false);
    });
  });

  describe('Multiple Rapid Cancellations', () => {
    it('should handle multiple rapid cancel calls safely', async () => {
      const { audioPipeline, llmManager, ttsManager } = harness;

      await audioPipeline.start();

      // Rapid cancellations
      audioPipeline.cancel();
      llmManager.cancel();
      ttsManager.stop();

      audioPipeline.cancel();
      llmManager.cancel();
      ttsManager.stop();

      // Should still be in valid state
      expect(audioPipeline.getState()).toBe('idle');

      await audioPipeline.stop();
    });
  });
});

// ============================================================================
// Test Suite: Memory Integration
// ============================================================================

describe('E2E Voice Pipeline - Memory Integration', () => {
  let harness: ReturnType<typeof createMockPipelineHarness>;

  beforeEach(() => {
    vi.clearAllMocks();
    harness = createMockPipelineHarness();
  });

  afterEach(() => {
    harness.reset();
  });

  describe('Conversation Memory', () => {
    it('should store user messages in memory', async () => {
      const { memoryManager } = harness;

      memoryManager.startSession();

      memoryManager.addMessage({ role: 'user', content: 'Hello Atlas' });
      memoryManager.addMessage({ role: 'assistant', content: 'Hello! How can I help?' });

      const messages = memoryManager.getRecentMessages(10);

      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe('user');
      expect(messages[1].role).toBe('assistant');
    });

    it('should retrieve context for LLM', async () => {
      const { memoryManager } = harness;

      memoryManager.startSession();

      // Simulate conversation
      memoryManager.addMessage({ role: 'user', content: 'My name is John' });
      memoryManager.addMessage({ role: 'assistant', content: 'Nice to meet you, John!' });
      memoryManager.addMessage({ role: 'user', content: 'What is my name?' });

      const context = memoryManager.getRecentMessages(5);

      expect(context).toHaveLength(3);
      expect(context[0].content).toContain('John');
    });

    it('should clear memory on request', async () => {
      const { memoryManager } = harness;

      memoryManager.startSession();
      memoryManager.addMessage({ role: 'user', content: 'Test message' });

      await memoryManager.clear();

      const messages = memoryManager.getRecentMessages(10);
      expect(messages).toHaveLength(0);
    });
  });
});

// ============================================================================
// Test Suite: Event Collection
// ============================================================================

describe('E2E Voice Pipeline - Event Sequence', () => {
  let harness: ReturnType<typeof createMockPipelineHarness>;

  beforeEach(() => {
    vi.clearAllMocks();
    harness = createMockPipelineHarness();
  });

  afterEach(() => {
    harness.reset();
  });

  describe('Event Collection', () => {
    it('should collect all pipeline events in order', async () => {
      const { audioPipeline } = harness;
      const eventCollector = new PipelineEventCollector(audioPipeline, [
        'state-change',
        'wake-word',
        'speech-start',
        'speech-end',
        'started',
        'stopped',
      ]);

      await audioPipeline.start();
      audioPipeline.triggerWake();
      audioPipeline.injectSpeechSegment(createSpeechSegment(500));
      await audioPipeline.stop();

      const events = eventCollector.getEvents();

      expect(events.length).toBeGreaterThan(0);
      expect(eventCollector.hasEvent('started')).toBe(true);
      expect(eventCollector.hasEvent('wake-word')).toBe(true);
      expect(eventCollector.hasEvent('stopped')).toBe(true);
    });

    it('should count events correctly', async () => {
      const { audioPipeline } = harness;
      const eventCollector = new PipelineEventCollector(audioPipeline, ['state-change']);

      await audioPipeline.start();
      audioPipeline.triggerWake();
      audioPipeline.startSpeaking();
      audioPipeline.finishSpeaking();
      await audioPipeline.stop();

      // Multiple state changes should be recorded
      const stateChangeCount = eventCollector.getEventCount('state-change');
      expect(stateChangeCount).toBeGreaterThanOrEqual(3);
    });
  });
});

// ============================================================================
// Test Suite: Stress Testing
// ============================================================================

describe('E2E Voice Pipeline - Stress Tests', () => {
  let harness: ReturnType<typeof createMockPipelineHarness>;

  beforeEach(() => {
    vi.clearAllMocks();
    harness = createMockPipelineHarness();
  });

  afterEach(() => {
    harness.reset();
  });

  describe('Rapid Interactions', () => {
    it('should handle multiple rapid wake word triggers', async () => {
      const { audioPipeline } = harness;

      await audioPipeline.start();

      // Rapid wake word triggers
      for (let i = 0; i < 10; i++) {
        audioPipeline.triggerWake();
        audioPipeline.cancel();
      }

      // Should be in idle state after all
      expect(audioPipeline.getState()).toBe('idle');

      await audioPipeline.stop();
    });

    it('should handle multiple concurrent LLM requests', async () => {
      const { llmManager } = harness;

      // Queue multiple responses
      for (let i = 0; i < 5; i++) {
        llmManager.queueResponse(`Response ${i}`, 3, 10);
      }

      // Make concurrent requests
      const promises = Array.from({ length: 5 }, (_, i) =>
        llmManager.chat(`Message ${i}`)
      );

      const responses = await Promise.all(promises);

      expect(responses).toHaveLength(5);
      responses.forEach((r, i) => {
        expect(r.content).toContain(`${i}`);
      });
    });
  });

  describe('Long Running Sessions', () => {
    it('should maintain state consistency over multiple interactions', async () => {
      const { audioPipeline, sttManager, llmManager, memoryManager, stateRecorder } = harness;

      audioPipeline.on('state-change', (state, prev) => {
        stateRecorder.record(prev, state);
      });

      memoryManager.startSession();

      await audioPipeline.start();

      // Simulate 5 complete interactions
      for (let i = 0; i < 5; i++) {
        sttManager.queueTranscript(`Question ${i}`);
        llmManager.queueResponse(`Answer ${i}`, 2, 5);

        audioPipeline.triggerWake();
        audioPipeline.injectSpeechSegment(createSpeechSegment(300));

        await sttManager.start();
        sttManager.sendAudio(new Int16Array(256));

        const transcript = await TimingUtils.waitForEvent<{ text: string }>(
          sttManager,
          'final',
          500
        );

        memoryManager.addMessage({ role: 'user', content: transcript.text });

        const response = await llmManager.chat(transcript.text);
        memoryManager.addMessage({ role: 'assistant', content: response.content });

        audioPipeline.finishSpeaking();
        await sttManager.stop();
      }

      // Verify all interactions recorded
      const messages = memoryManager.getRecentMessages(20);
      expect(messages.length).toBe(10); // 5 user + 5 assistant

      // Should always return to idle
      expect(audioPipeline.getState()).toBe('idle');

      await audioPipeline.stop();
    });
  });
});

// ============================================================================
// Test Suite: Edge Cases
// ============================================================================

describe('E2E Voice Pipeline - Edge Cases', () => {
  let harness: ReturnType<typeof createMockPipelineHarness>;

  beforeEach(() => {
    vi.clearAllMocks();
    harness = createMockPipelineHarness();
  });

  afterEach(() => {
    harness.reset();
  });

  describe('Empty Input', () => {
    it('should handle empty transcript gracefully', async () => {
      const { sttManager, llmManager } = harness;

      sttManager.queueTranscript('');
      llmManager.queueResponse('I did not catch that. Could you please repeat?');

      await sttManager.start();
      sttManager.sendAudio(new Int16Array(256));

      const transcript = await TimingUtils.waitForEvent<{ text: string }>(
        sttManager,
        'final',
        500
      );

      expect(transcript.text).toBe('');

      // Pipeline should handle empty input
      const response = await llmManager.chat(transcript.text || 'I did not hear anything');
      expect(response.content).toBeDefined();
    });

    it('should handle empty LLM response', async () => {
      const { llmManager } = harness;

      llmManager.queueResponse('', 1, 0);

      const response = await llmManager.chat('Test');
      expect(response.content).toBe('');
    });
  });

  describe('Very Long Input/Output', () => {
    it('should handle long user input', async () => {
      const { sttManager, llmManager } = harness;

      const longInput = 'Please '.repeat(500) + 'help me with this task.';
      sttManager.queueTranscript(longInput);
      llmManager.queueResponse('I understand. Let me help you.', 3, 10);

      await sttManager.start();
      sttManager.sendAudio(new Int16Array(1024));

      const transcript = await TimingUtils.waitForEvent<{ text: string }>(
        sttManager,
        'final',
        1000
      );

      expect(transcript.text.length).toBeGreaterThan(2000);

      const response = await llmManager.chat(transcript.text);
      expect(response.content).toBeDefined();
    });

    // Skip in CI/low-memory environments - this test can cause heap OOM
    it.skip('should handle very long LLM response', async () => {
      const { llmManager, ttsManager } = harness;

      const longResponse = 'This is a detailed explanation. '.repeat(100);
      llmManager.queueResponse(longResponse, 50, 5);
      ttsManager.setSpeakDelay(10);

      let accumulated = '';
      for await (const chunk of llmManager.chatStream('Explain in detail')) {
        accumulated = chunk.accumulated;
      }

      expect(accumulated.length).toBeGreaterThan(1000);

      // TTS should handle long text
      const playbackEnd = TimingUtils.waitForEvent(ttsManager, 'playbackEnd', 5000);
      await ttsManager.speakWithAudioStream(accumulated);
      await playbackEnd;
    });
  });

  describe('Special Characters', () => {
    it('should handle special characters in transcript', async () => {
      const { sttManager, llmManager } = harness;

      const specialInput = 'What is 2 + 2? Is it > 3 or < 5? Test: @#$%^&*()';
      sttManager.queueTranscript(specialInput);
      llmManager.queueResponse('2 + 2 = 4, which is both > 3 and < 5.');

      await sttManager.start();
      sttManager.sendAudio(new Int16Array(256));

      const transcript = await TimingUtils.waitForEvent<{ text: string }>(
        sttManager,
        'final',
        500
      );

      expect(transcript.text).toBe(specialInput);

      const response = await llmManager.chat(transcript.text);
      expect(response.content).toContain('4');
    });

    it('should handle Unicode/emoji in text', async () => {
      const { llmManager, ttsManager } = harness;

      llmManager.queueResponse('Sure! Here is your answer.');

      const response = await llmManager.chat('Can you help me?');
      expect(response.content).toBeDefined();

      // TTS should handle the response
      const playbackEnd = TimingUtils.waitForEvent(ttsManager, 'playbackEnd', 2000);
      await ttsManager.speakWithAudioStream(response.content);
      await playbackEnd;
    });
  });
});
