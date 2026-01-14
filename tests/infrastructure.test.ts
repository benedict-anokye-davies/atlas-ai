/**
 * Test Infrastructure Verification
 * Ensures mocks, fixtures, and helpers are working correctly
 */

import { describe, it, expect, vi } from 'vitest';

// Test mock utilities
import {
  createMockDeepgramClient,
  createMockTranscript,
} from './mocks/deepgram';
import {
  createMockAudioBuffer,
  createMockAudioStream,
  createMockElevenLabsResponse,
} from './mocks/elevenlabs';
import {
  createMockFireworksClient,
  createMockChatCompletion,
  setupMockNonStreamingResponse,
} from './mocks/fireworks';
import {
  createMockOpenRouterClient,
  createMockOpenRouterCompletion,
} from './mocks/openrouter';
import {
  createMockPorcupine,
  createMockPvRecorder,
  simulateWakeWordDetection,
} from './mocks/porcupine';
import { createElectronMock } from './mocks/electron';

// Test fixtures
import {
  createSilentAudio,
  createSineWave,
  createSpeechLikeAudio,
  createVADTestAudio,
  createAudioChunks,
  AUDIO_FRAME_SIZES,
} from './fixtures/audio';
import {
  GREETING_TRANSCRIPTS,
  QUESTION_TRANSCRIPTS,
  createTranscriptResult,
  createInterimTranscriptSequence,
} from './fixtures/transcripts';
import {
  SIMPLE_CONVERSATION,
  MULTI_TURN_CONVERSATION,
  createConversation,
  createLLMResponse,
  createStreamingChunks,
} from './fixtures/conversations';

// Test helpers
import { wait, waitFor, waitForEvent, measureTime, retry } from './helpers/async';
import {
  createTimestampedSpy,
  createMockEventEmitter,
  createStateRecorder,
  createEventSequenceValidator,
} from './helpers/events';
import {
  createMockWakeWordDetector,
  createMockVADManager,
  createMockSTTClient,
  createMockLLMClient,
  createMockTTSClient,
  createMockVoicePipeline,
} from './helpers/pipeline';

describe('Test Infrastructure', () => {
  describe('Mock Utilities', () => {
    describe('Deepgram Mocks', () => {
      it('should create mock Deepgram client', () => {
        const client = createMockDeepgramClient();
        expect(client.listen.live).toBeDefined();
        expect(client._liveClient).toBeDefined();
      });

      it('should create mock transcript', () => {
        const transcript = createMockTranscript('hello world');
        expect(transcript.channel.alternatives[0].transcript).toBe('hello world');
        expect(transcript.is_final).toBe(true);
      });
    });

    describe('ElevenLabs Mocks', () => {
      it('should create mock audio buffer', () => {
        const buffer = createMockAudioBuffer(2048);
        expect(buffer.byteLength).toBe(2048);
      });

      it('should create mock audio stream', () => {
        const chunks = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6])];
        const stream = createMockAudioStream(chunks);
        expect(stream).toBeInstanceOf(ReadableStream);
      });

      it('should create mock response', () => {
        const response = createMockElevenLabsResponse({ ok: true, status: 200 });
        expect(response.ok).toBe(true);
        expect(response.status).toBe(200);
      });
    });

    describe('Fireworks Mocks', () => {
      it('should create mock client', () => {
        const client = createMockFireworksClient();
        expect(client.chat.completions.create).toBeDefined();
      });

      it('should create mock completion', () => {
        const completion = createMockChatCompletion('Hello!');
        expect(completion.choices[0].message.content).toBe('Hello!');
        expect(completion.choices[0].finish_reason).toBe('stop');
      });

      it('should setup non-streaming response', () => {
        const client = createMockFireworksClient();
        setupMockNonStreamingResponse(client, 'Test response');
        expect(client._mockCreate).toHaveBeenCalledTimes(0);
      });
    });

    describe('OpenRouter Mocks', () => {
      it('should create mock client', () => {
        const client = createMockOpenRouterClient();
        expect(client.chat.completions.create).toBeDefined();
      });

      it('should create mock completion with model', () => {
        const completion = createMockOpenRouterCompletion('Response', 'openai/gpt-4');
        expect(completion.model).toBe('openai/gpt-4');
      });
    });

    describe('Porcupine Mocks', () => {
      it('should create mock Porcupine', () => {
        const porcupine = createMockPorcupine();
        expect(porcupine.frameLength).toBe(512);
        expect(porcupine.sampleRate).toBe(16000);
        expect(porcupine.process).toBeDefined();
      });

      it('should create mock PvRecorder', () => {
        const recorder = createMockPvRecorder();
        expect(recorder.start).toBeDefined();
        expect(recorder.stop).toBeDefined();
        expect(recorder.read).toBeDefined();
      });

      it('should simulate wake word detection', () => {
        const porcupine = createMockPorcupine();
        expect(porcupine.process()).toBe(-1); // No detection
        simulateWakeWordDetection(porcupine, 0);
        expect(porcupine.process()).toBe(0); // Detection
      });
    });

    describe('Electron Mocks', () => {
      it('should create complete electron mock', () => {
        const electron = createElectronMock();
        expect(electron.app).toBeDefined();
        expect(electron.BrowserWindow).toBeDefined();
        expect(electron.ipcMain).toBeDefined();
        expect(electron.dialog).toBeDefined();
      });
    });
  });

  describe('Fixtures', () => {
    describe('Audio Fixtures', () => {
      it('should create silent audio', () => {
        const audio = createSilentAudio(512);
        expect(audio.length).toBe(512);
        expect(audio.every((v) => v === 0)).toBe(true);
      });

      it('should create sine wave', () => {
        const audio = createSineWave(440, 16000, 0.1);
        expect(audio.length).toBe(1600); // 16000 * 0.1
        expect(Math.max(...audio)).toBeGreaterThan(0);
      });

      it('should create speech-like audio', () => {
        const audio = createSpeechLikeAudio(16000, 1.0);
        expect(audio.length).toBe(16000);
      });

      it('should create VAD test audio', () => {
        const audio = createVADTestAudio(16000, 0.5, 1.0, 0.5);
        expect(audio.length).toBe(32000); // 16000 * 2
      });

      it('should create audio chunks', () => {
        const chunks = createAudioChunks(1.0, 0.1, 16000);
        expect(chunks.length).toBe(10); // 1.0 / 0.1
      });

      it('should have correct frame sizes', () => {
        expect(AUDIO_FRAME_SIZES.PORCUPINE).toBe(512);
        expect(AUDIO_FRAME_SIZES.VAD).toBe(1536);
      });
    });

    describe('Transcript Fixtures', () => {
      it('should have greeting transcripts', () => {
        expect(GREETING_TRANSCRIPTS.length).toBeGreaterThan(0);
        expect(GREETING_TRANSCRIPTS).toContain('hello');
      });

      it('should have question transcripts', () => {
        expect(QUESTION_TRANSCRIPTS.length).toBeGreaterThan(0);
      });

      it('should create transcript result', () => {
        const result = createTranscriptResult('test message', { confidence: 0.9 });
        expect(result.channel.alternatives[0].transcript).toBe('test message');
        expect(result.channel.alternatives[0].confidence).toBe(0.9);
      });

      it('should create interim transcript sequence', () => {
        const sequence = createInterimTranscriptSequence('hello world');
        expect(sequence.length).toBe(2);
        expect(sequence[sequence.length - 1].is_final).toBe(true);
      });
    });

    describe('Conversation Fixtures', () => {
      it('should have simple conversation', () => {
        expect(SIMPLE_CONVERSATION.length).toBe(2);
        expect(SIMPLE_CONVERSATION[0].role).toBe('user');
        expect(SIMPLE_CONVERSATION[1].role).toBe('assistant');
      });

      it('should have multi-turn conversation', () => {
        expect(MULTI_TURN_CONVERSATION.length).toBeGreaterThan(2);
      });

      it('should create conversation', () => {
        const conv = createConversation({ userName: 'Alice' });
        expect(conv.userName).toBe('Alice');
        expect(conv.id).toMatch(/^conv_/);
      });

      it('should create LLM response', () => {
        const response = createLLMResponse('Hello!');
        expect(response.content).toBe('Hello!');
        expect(response.finishReason).toBe('stop');
      });

      it('should create streaming chunks', () => {
        const chunks = createStreamingChunks('one two three four five six');
        expect(chunks.length).toBeGreaterThan(1);
      });
    });
  });

  describe('Helpers', () => {
    describe('Async Helpers', () => {
      it('should wait for specified time', async () => {
        const start = Date.now();
        await wait(50);
        const elapsed = Date.now() - start;
        expect(elapsed).toBeGreaterThanOrEqual(45);
      });

      it('should wait for condition', async () => {
        let flag = false;
        setTimeout(() => {
          flag = true;
        }, 50);
        await waitFor(() => flag, { timeout: 1000 });
        expect(flag).toBe(true);
      });

      it('should measure time', async () => {
        const { result, duration } = await measureTime(async () => {
          await wait(50);
          return 'done';
        });
        expect(result).toBe('done');
        expect(duration).toBeGreaterThanOrEqual(45);
      });

      it('should retry on failure', async () => {
        let attempts = 0;
        const result = await retry(
          async () => {
            attempts++;
            if (attempts < 3) throw new Error('Fail');
            return 'success';
          },
          { maxRetries: 5, delay: 10 }
        );
        expect(result).toBe('success');
        expect(attempts).toBe(3);
      });
    });

    describe('Event Helpers', () => {
      it('should create timestamped spy', () => {
        const { spy, calls, getCallAt } = createTimestampedSpy();
        spy('arg1');
        spy('arg2');
        expect(calls.length).toBe(2);
        expect(getCallAt(0)?.args).toEqual(['arg1']);
      });

      it('should create mock event emitter', () => {
        const emitter = createMockEventEmitter();
        const handler = vi.fn();
        emitter.on('test', handler);
        emitter.emit('test', 'data');
        expect(handler).toHaveBeenCalledWith('data');
      });

      it('should create state recorder', () => {
        const recorder = createStateRecorder<string>();
        recorder.record('idle');
        recorder.record('running');
        recorder.record('stopped');
        expect(recorder.current).toBe('stopped');
        expect(recorder.hasTransitioned('idle', 'running')).toBe(true);
      });

      it('should validate event sequences', () => {
        const validator = createEventSequenceValidator(['start', 'process', 'end']);
        validator.record('start');
        validator.record('process');
        validator.record('end');
        expect(validator.isValid()).toBe(true);
      });
    });

    describe('Pipeline Helpers', () => {
      it('should create mock wake word detector', () => {
        const detector = createMockWakeWordDetector();
        expect(detector.running).toBe(false);
        detector.start();
        expect(detector.running).toBe(true);
      });

      it('should create mock VAD manager', () => {
        const vad = createMockVADManager();
        expect(vad.running).toBe(false);
      });

      it('should create mock STT client', () => {
        const stt = createMockSTTClient();
        expect(stt.name).toBe('mock-stt');
        expect(stt.isReady()).toBe(false);
      });

      it('should create mock LLM client', () => {
        const llm = createMockLLMClient();
        expect(llm.name).toBe('mock-llm');
      });

      it('should create mock TTS client', () => {
        const tts = createMockTTSClient();
        expect(tts.name).toBe('mock-tts');
        expect(tts.isSpeaking()).toBe(false);
      });

      it('should create mock voice pipeline', () => {
        const pipeline = createMockVoicePipeline();
        expect(pipeline.wakeWord).toBeDefined();
        expect(pipeline.vad).toBeDefined();
        expect(pipeline.stt).toBeDefined();
        expect(pipeline.llm).toBeDefined();
        expect(pipeline.tts).toBeDefined();
      });
    });
  });
});
