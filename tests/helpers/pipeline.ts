/**
 * Pipeline Testing Helpers
 * Utilities for testing the voice pipeline components
 */

import { vi } from 'vitest';
import { createMockEventEmitter } from './events';
import { createSilentAudio, createSpeechLikeAudio } from '../fixtures/audio';

/**
 * Creates a mock wake word detector for testing
 */
export function createMockWakeWordDetector() {
  const emitter = createMockEventEmitter();
  const state = { running: false, paused: false };

  return {
    ...emitter,
    get running() { return state.running; },
    get paused() { return state.paused; },
    async start() {
      state.running = true;
      emitter.emit('started');
      emitter.emit('feedback', { type: 'ready', message: 'Wake word detection active' });
    },
    async stop() {
      state.running = false;
      emitter.emit('stopped');
    },
    pause() {
      if (state.running) {
        state.paused = true;
      }
    },
    resume() {
      if (state.running && state.paused) {
        state.paused = false;
        emitter.emit('feedback', { type: 'listening', message: 'Listening for wake word' });
      }
    },
    simulateDetection(keyword = 'jarvis', confidence = 0.95) {
      if (state.running && !state.paused) {
        emitter.emit('detected', {
          keyword,
          keywordIndex: 0,
          timestamp: Date.now(),
          confidence,
        });
      }
    },
    setSensitivity: vi.fn(),
    setCooldown: vi.fn(),
    setConfidenceThreshold: vi.fn(),
    getStats: vi.fn().mockReturnValue({
      totalDetections: 0,
      acceptedDetections: 0,
      rejectedDetections: 0,
      cooldownRejections: 0,
      averageConfidence: 0,
      lastDetectionTime: 0,
      uptime: 0,
    }),
  };
}

/**
 * Creates a mock VAD manager for testing
 */
export function createMockVADManager() {
  const emitter = createMockEventEmitter();
  const state = { running: false, speaking: false };

  return {
    ...emitter,
    get running() { return state.running; },
    async start() {
      state.running = true;
      emitter.emit('started');
    },
    async stop() {
      state.running = false;
      emitter.emit('stopped');
    },
    async processAudio(audio: Float32Array) {
      if (!state.running) return;
      const avgAmplitude = audio.reduce((sum, v) => sum + Math.abs(v), 0) / audio.length;
      emitter.emit('vad-probability', avgAmplitude > 0.01 ? 0.8 : 0.1);
    },
    simulateSpeechStart() {
      if (state.running) {
        state.speaking = true;
        emitter.emit('speech-start', {
          type: 'speech-start',
          timestamp: Date.now(),
        });
      }
    },
    simulateSpeechEnd(audio?: Int16Array) {
      if (state.running && state.speaking) {
        state.speaking = false;
        emitter.emit('speech-end', {
          type: 'speech-end',
          timestamp: Date.now(),
          audio: audio || createSpeechLikeAudio(),
        });
      }
    },
    reset: vi.fn(),
    getStatus: () => ({
      isRunning: state.running,
      isSpeaking: state.speaking,
      probability: 0,
    }),
  };
}

/**
 * Creates a mock STT client for testing
 */
export function createMockSTTClient() {
  const emitter = createMockEventEmitter();
  let connected = false;

  return {
    ...emitter,
    name: 'mock-stt',
    status: 'idle',
    async start() {
      connected = true;
      emitter.emit('status', 'connecting');
      emitter.emit('open');
      emitter.emit('status', 'connected');
    },
    async stop() {
      connected = false;
      emitter.emit('close');
      emitter.emit('status', 'closed');
    },
    sendAudio(audio: Buffer | Int16Array) {
      if (!connected) return;
      // Simulate receiving a transcript after sending audio
    },
    simulateTranscript(text: string, isFinal = true) {
      if (connected) {
        emitter.emit('transcript', {
          text,
          isFinal,
          confidence: 0.95,
          timestamp: Date.now(),
        });
      }
    },
    isReady: () => connected,
    getConfig: vi.fn().mockReturnValue({
      apiKey: 'mock-key',
      model: 'nova-2',
      language: 'en-US',
    }),
    updateConfig: vi.fn(),
  };
}

/**
 * Creates a mock LLM client for testing
 */
export function createMockLLMClient() {
  const emitter = createMockEventEmitter();

  return {
    ...emitter,
    name: 'mock-llm',
    status: 'idle',
    async chat(message: string, context?: unknown) {
      emitter.emit('status', 'connecting');
      emitter.emit('status', 'generating');
      const response = {
        content: `Response to: ${message}`,
        finishReason: 'stop',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      };
      emitter.emit('response', response);
      emitter.emit('status', 'idle');
      return response;
    },
    async *chatStream(message: string, context?: unknown) {
      emitter.emit('status', 'connecting');
      emitter.emit('status', 'generating');

      const chunks = ['Hello', ', how', ' can', ' I', ' help', '?'];
      let accumulated = '';

      for (let i = 0; i < chunks.length; i++) {
        accumulated += chunks[i];
        const chunk = {
          delta: chunks[i],
          accumulated,
          isFinal: i === chunks.length - 1,
        };
        emitter.emit('chunk', chunk);
        yield chunk;
      }

      emitter.emit('status', 'idle');
    },
    cancel: vi.fn(),
    createContext: vi.fn().mockReturnValue({
      id: `conv_${Date.now()}`,
      userName: 'TestUser',
      messages: [],
      totalTokens: 0,
    }),
    clearContext: vi.fn(),
    getCurrentContext: vi.fn().mockReturnValue(null),
    getConfig: vi.fn().mockReturnValue({
      apiKey: 'mock-key',
      model: 'mock-model',
      temperature: 0.7,
    }),
    updateConfig: vi.fn(),
  };
}

/**
 * Creates a mock TTS client for testing
 */
export function createMockTTSClient() {
  const emitter = createMockEventEmitter();
  let speaking = false;

  return {
    ...emitter,
    name: 'mock-tts',
    status: 'idle',
    async synthesize(text: string) {
      emitter.emit('status', 'synthesizing');
      const result = {
        audio: Buffer.from([0x49, 0x44, 0x33, 0x04]), // Fake MP3 header
        format: 'mp3_44100_128',
        characterCount: text.length,
        latency: 100,
      };
      emitter.emit('synthesized', result);
      emitter.emit('status', 'idle');
      return result;
    },
    async *synthesizeStream(text: string) {
      emitter.emit('status', 'synthesizing');

      const chunks = [
        { data: Buffer.from([1, 2, 3, 4]), isFinal: false },
        { data: Buffer.from([5, 6, 7, 8]), isFinal: false },
        { data: Buffer.from([]), isFinal: true },
      ];

      for (const chunk of chunks) {
        emitter.emit('chunk', chunk);
        yield chunk;
      }

      emitter.emit('status', 'idle');
    },
    speak: vi.fn().mockImplementation(async (text: string) => {
      speaking = true;
      emitter.emit('status', 'playing');
      await new Promise((r) => setTimeout(r, 100));
      speaking = false;
      emitter.emit('status', 'idle');
    }),
    stop() {
      speaking = false;
      emitter.emit('interrupted');
      emitter.emit('status', 'idle');
    },
    pause: vi.fn(),
    resume: vi.fn(),
    isSpeaking: () => speaking,
    getQueue: vi.fn().mockReturnValue([]),
    clearQueue: vi.fn(),
    getConfig: vi.fn().mockReturnValue({
      apiKey: 'mock-key',
      voiceId: 'mock-voice',
    }),
    updateConfig: vi.fn(),
  };
}

/**
 * Creates a complete mock voice pipeline for testing
 */
export function createMockVoicePipeline() {
  const wakeWord = createMockWakeWordDetector();
  const vad = createMockVADManager();
  const stt = createMockSTTClient();
  const llm = createMockLLMClient();
  const tts = createMockTTSClient();
  const emitter = createMockEventEmitter();

  return {
    wakeWord,
    vad,
    stt,
    llm,
    tts,
    emitter,
    async initialize() {
      await wakeWord.start();
      await vad.start();
    },
    async shutdown() {
      await wakeWord.stop();
      await vad.stop();
      await stt.stop();
      tts.stop();
    },
    simulateFullInteraction(userSpeech: string, assistantResponse: string) {
      // 1. Wake word detected
      wakeWord.simulateDetection();

      // 2. Speech starts
      vad.simulateSpeechStart();

      // 3. Speech ends with audio
      vad.simulateSpeechEnd();

      // 4. Transcript received
      stt.simulateTranscript(userSpeech);

      // 5. LLM response (would be generated)
      emitter.emit('response', assistantResponse);
    },
  };
}
