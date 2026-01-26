/**
 * Atlas Desktop - Audio Mocking Utilities for E2E Tests
 *
 * Provides comprehensive audio mocking infrastructure for testing the voice pipeline
 * without requiring actual audio hardware or external API calls.
 *
 * Features:
 * - Simulated audio stream generation
 * - Wake word trigger simulation
 * - Speech segment injection
 * - Audio buffer management
 * - Timing control for realistic interaction simulation
 *
 * @module tests/e2e/utils/audio-mock
 */

import { EventEmitter } from 'events';
import type { SpeechSegment, VoicePipelineState } from '../../../src/shared/types/voice';
import type { TranscriptionResult } from '../../../src/shared/types/stt';
import type { LLMStreamChunk, LLMResponse } from '../../../src/shared/types/llm';
// Use simplified types for mocking to avoid strict type constraints
// These match the essential interface without requiring Buffer types

/**
 * Simplified TTS audio chunk for testing
 */
interface MockTTSAudioChunk {
  data: Uint8Array;
  format: string;
  isFinal: boolean;
  timestamp?: number;
  index?: number;
  duration?: number;
}

/**
 * Simplified TTS synthesis result for testing
 */
interface MockTTSSynthesisResult {
  text?: string;
  duration: number;
  provider: string;
  audio?: Uint8Array;
  format?: string;
  characterCount?: number;
}

/**
 * Audio sample rate used throughout the pipeline
 */
export const SAMPLE_RATE = 16000;

/**
 * Standard frame sizes
 */
export const FRAME_SIZES = {
  PORCUPINE: 512,
  VAD: 1536,
  STT: 3200,
  STANDARD: 16000,
};

/**
 * Configuration for mock audio generation
 */
export interface MockAudioConfig {
  /** Sample rate (default: 16000) */
  sampleRate?: number;
  /** Duration in seconds */
  duration?: number;
  /** Amplitude (0-1) */
  amplitude?: number;
  /** Type of audio to generate */
  type?: 'silence' | 'sine' | 'noise' | 'speech';
  /** Frequency for sine wave */
  frequency?: number;
}

/**
 * Configuration for simulated voice interaction
 */
export interface SimulatedInteractionConfig {
  /** Text that will be "transcribed" */
  transcriptText: string;
  /** LLM response to return */
  llmResponse: string;
  /** Simulate streaming chunks (default: true) */
  streaming?: boolean;
  /** Number of LLM chunks (default: 5) */
  chunkCount?: number;
  /** Delay between chunks in ms (default: 50) */
  chunkDelay?: number;
  /** STT delay in ms (default: 100) */
  sttDelay?: number;
  /** TTS delay in ms (default: 100) */
  ttsDelay?: number;
  /** Whether to include tool calls */
  includeToolCalls?: boolean;
}

/**
 * Generates silent audio buffer
 */
export function generateSilence(samples: number = FRAME_SIZES.STANDARD): Float32Array {
  return new Float32Array(samples).fill(0);
}

/**
 * Generates sine wave audio buffer
 */
export function generateSineWave(
  frequency: number = 440,
  duration: number = 0.1,
  amplitude: number = 0.5,
  sampleRate: number = SAMPLE_RATE
): Float32Array {
  const samples = Math.floor(sampleRate * duration);
  const buffer = new Float32Array(samples);

  for (let i = 0; i < samples; i++) {
    const t = i / sampleRate;
    buffer[i] = Math.sin(2 * Math.PI * frequency * t) * amplitude;
  }

  return buffer;
}

/**
 * Generates white noise audio buffer
 */
export function generateNoise(
  samples: number = FRAME_SIZES.STANDARD,
  amplitude: number = 0.1
): Float32Array {
  const buffer = new Float32Array(samples);

  for (let i = 0; i < samples; i++) {
    buffer[i] = (Math.random() * 2 - 1) * amplitude;
  }

  return buffer;
}

/**
 * Generates speech-like audio (varying amplitude with harmonics)
 */
export function generateSpeechLikeAudio(
  duration: number = 1.0,
  sampleRate: number = SAMPLE_RATE
): Float32Array {
  const samples = Math.floor(sampleRate * duration);
  const buffer = new Float32Array(samples);

  for (let i = 0; i < samples; i++) {
    const t = i / sampleRate;
    // Amplitude envelope that varies like speech
    const envelope =
      Math.abs(Math.sin(2 * Math.PI * 3 * t)) * Math.abs(Math.sin(2 * Math.PI * 0.5 * t));
    // Base frequency with harmonics
    const baseFreq = 150;
    const signal =
      Math.sin(2 * Math.PI * baseFreq * t) * 0.5 +
      Math.sin(2 * Math.PI * baseFreq * 2 * t) * 0.3 +
      Math.sin(2 * Math.PI * baseFreq * 3 * t) * 0.2;

    buffer[i] = signal * envelope * 0.5;
  }

  return buffer;
}

/**
 * Generates audio based on configuration
 */
export function generateAudio(config: MockAudioConfig = {}): Float32Array {
  const {
    sampleRate = SAMPLE_RATE,
    duration = 1.0,
    amplitude = 0.5,
    type = 'speech',
    frequency = 440,
  } = config;

  const samples = Math.floor(sampleRate * duration);

  switch (type) {
    case 'silence':
      return generateSilence(samples);
    case 'sine':
      return generateSineWave(frequency, duration, amplitude, sampleRate);
    case 'noise':
      return generateNoise(samples, amplitude);
    case 'speech':
    default:
      return generateSpeechLikeAudio(duration, sampleRate);
  }
}

/**
 * Converts Float32Array to Int16Array (for STT)
 */
export function float32ToInt16(float32: Float32Array): Int16Array {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return int16;
}

/**
 * Converts Int16Array to Float32Array
 */
export function int16ToFloat32(int16: Int16Array): Float32Array {
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / (int16[i] < 0 ? 0x8000 : 0x7fff);
  }
  return float32;
}

/**
 * Creates a speech segment for pipeline injection
 */
export function createSpeechSegment(
  durationMs: number = 1000,
  sampleRate: number = SAMPLE_RATE
): SpeechSegment {
  const duration = durationMs / 1000;
  const audio = generateSpeechLikeAudio(duration, sampleRate);
  const now = Date.now();

  return {
    audio,
    startTime: now - durationMs,
    endTime: now,
    duration: durationMs,
    forcedEnd: false,
  };
}

/**
 * Mock Audio Pipeline for testing
 *
 * Simulates the AudioPipeline behavior without actual hardware
 */
export class MockAudioPipeline extends EventEmitter {
  private isRunning = false;
  private currentState: VoicePipelineState = 'idle';
  private onSpeechSegmentCallback: ((segment: SpeechSegment) => void) | null = null;
  private onBargeInCallback: (() => void) | null = null;

  constructor() {
    super();
  }

  /**
   * Starts the mock audio pipeline
   */
  async start(): Promise<void> {
    this.isRunning = true;
    this.setState('idle');
    this.emit('started');
  }

  /**
   * Stops the mock audio pipeline
   */
  async stop(): Promise<void> {
    this.isRunning = false;
    this.setState('idle');
    this.emit('stopped');
  }

  /**
   * Sets the pipeline state
   */
  setState(state: VoicePipelineState): void {
    const previousState = this.currentState;
    this.currentState = state;
    this.emit('state-change', state, previousState);
  }

  /**
   * Gets the current state
   */
  getState(): VoicePipelineState {
    return this.currentState;
  }

  /**
   * Simulates wake word detection
   */
  triggerWake(keyword: string = 'jarvis', confidence: number = 0.95): void {
    if (!this.isRunning) return;

    const event = {
      timestamp: Date.now(),
      keyword,
      confidence,
    };

    this.emit('wake-word', event);
    this.setState('listening');
  }

  /**
   * Simulates speech segment completion
   */
  injectSpeechSegment(segment: SpeechSegment): void {
    if (!this.isRunning) return;

    this.emit('speech-start');
    this.emit('speech-end', segment.duration);

    if (this.onSpeechSegmentCallback) {
      this.onSpeechSegmentCallback(segment);
    }
  }

  /**
   * Simulates audio level update
   */
  emitAudioLevel(level: number): void {
    this.emit('audio-level', level);
  }

  /**
   * Sets the speech segment callback
   */
  setOnSpeechSegment(callback: (segment: SpeechSegment) => void): void {
    this.onSpeechSegmentCallback = callback;
  }

  /**
   * Sets the barge-in callback
   */
  setOnBargeIn(callback: () => void): void {
    this.onBargeInCallback = callback;
  }

  /**
   * Simulates barge-in
   */
  triggerBargeIn(): void {
    if (!this.isRunning) return;

    if (this.onBargeInCallback) {
      this.onBargeInCallback();
    }
  }

  /**
   * Simulates listening timeout
   */
  triggerTimeout(): void {
    this.emit('listening-timeout');
    this.setState('idle');
  }

  /**
   * Indicates speaking has started
   */
  startSpeaking(): void {
    this.setState('speaking');
  }

  /**
   * Indicates speaking has finished
   */
  finishSpeaking(): void {
    this.setState('idle');
  }

  /**
   * Cancels current operation
   */
  cancel(): void {
    this.setState('idle');
  }

  /**
   * Updates configuration (no-op for mock)
   */
  updateConfig(_config: Record<string, unknown>): void {
    // No-op for mock
  }
}

/**
 * Mock STT Manager for testing
 */
export class MockSTTManager extends EventEmitter {
  private isRunning = false;
  private transcriptQueue: TranscriptionResult[] = [];
  private shouldFail = false;
  private failureError: Error | null = null;

  constructor() {
    super();
  }

  get status() {
    return this.isRunning ? 'connected' : 'idle';
  }

  async start(): Promise<void> {
    if (this.shouldFail && this.failureError) {
      throw this.failureError;
    }
    this.isRunning = true;
    this.emit('status', 'connected');
  }

  async stop(): Promise<void> {
    // Process any remaining transcripts before stopping
    while (this.transcriptQueue.length > 0) {
      const result = this.transcriptQueue.shift()!;
      if (result.isFinal) {
        this.emit('final', result);
      } else {
        this.emit('interim', result);
      }
    }

    this.isRunning = false;
    this.emit('status', 'closed');
  }

  sendAudio(_audioData: Buffer | Int16Array): void {
    // Process queued transcripts when audio is sent
    // Use setImmediate to allow listeners to be set up before emission
    if (this.transcriptQueue.length > 0) {
      const result = this.transcriptQueue.shift()!;
      setImmediate(() => {
        if (result.isFinal) {
          this.emit('final', result);
        } else {
          this.emit('interim', result);
        }
      });
    }
  }

  isReady(): boolean {
    return this.isRunning;
  }

  getConfig() {
    return { apiKey: 'mock-key' };
  }

  getActiveProviderType(): string {
    return 'mock';
  }

  /**
   * Queues a transcription result to be emitted
   */
  queueTranscript(text: string, isFinal: boolean = true, confidence: number = 0.95): void {
    this.transcriptQueue.push({
      text,
      isFinal,
      confidence,
      language: 'en',
      duration: text.split(' ').length * 300,
    });
  }

  /**
   * Immediately emits a transcription result
   */
  emitTranscript(text: string, isFinal: boolean = true, confidence: number = 0.95): void {
    const result: TranscriptionResult = {
      text,
      isFinal,
      confidence,
      language: 'en',
      duration: text.split(' ').length * 300,
    };

    if (isFinal) {
      this.emit('final', result);
    } else {
      this.emit('interim', result);
    }
  }

  /**
   * Configures the mock to fail on next start
   */
  setFailOnStart(error: Error): void {
    this.shouldFail = true;
    this.failureError = error;
  }

  /**
   * Clears failure configuration
   */
  clearFailure(): void {
    this.shouldFail = false;
    this.failureError = null;
  }

  /**
   * Emits an error event
   */
  emitError(error: Error): void {
    this.emit('error', error);
  }
}

/**
 * Mock LLM Manager for testing
 */
export class MockLLMManager extends EventEmitter {
  private responseQueue: Array<{ response: string; chunks: string[]; delay: number }> = [];
  private shouldFail = false;
  private failureError: Error | null = null;
  private isCancelled = false;

  constructor() {
    super();
  }

  get status() {
    return 'idle';
  }

  async chat(
    _message: string,
    _context?: unknown,
    _options?: unknown
  ): Promise<LLMResponse> {
    if (this.shouldFail && this.failureError) {
      throw this.failureError;
    }

    const queued = this.responseQueue.shift();
    const content = queued?.response ?? 'Mock response';

    return {
      content,
      model: 'mock-model',
      finishReason: 'stop',
      latency: 100,
    };
  }

  async *chatStream(
    _message: string,
    _context?: unknown,
    _options?: unknown
  ): AsyncGenerator<LLMStreamChunk> {
    if (this.shouldFail && this.failureError) {
      throw this.failureError;
    }

    this.isCancelled = false;
    const queued = this.responseQueue.shift();
    const chunks = queued?.chunks ?? ['Mock ', 'response ', 'text'];
    const delay = queued?.delay ?? 50;

    let accumulated = '';

    for (let i = 0; i < chunks.length; i++) {
      if (this.isCancelled) break;

      accumulated += chunks[i];
      const isFinal = i === chunks.length - 1;

      yield {
        delta: chunks[i],
        accumulated,
        isFinal,
        finishReason: isFinal ? 'stop' : undefined,
      };

      if (!isFinal && delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  cancel(): void {
    this.isCancelled = true;
  }

  getConfig() {
    return { apiKey: 'mock-key' };
  }

  getActiveProviderType(): string {
    return 'mock';
  }

  /**
   * Queues a response
   */
  queueResponse(response: string, chunkCount: number = 5, delay: number = 50): void {
    // Split response into chunks
    const words = response.split(' ');
    const chunkSize = Math.ceil(words.length / chunkCount);
    const chunks: string[] = [];

    for (let i = 0; i < words.length; i += chunkSize) {
      const chunk = words.slice(i, i + chunkSize).join(' ');
      chunks.push(chunk + (i + chunkSize < words.length ? ' ' : ''));
    }

    this.responseQueue.push({ response, chunks, delay });
  }

  /**
   * Configures the mock to fail
   */
  setFailOnCall(error: Error): void {
    this.shouldFail = true;
    this.failureError = error;
  }

  /**
   * Clears failure configuration
   */
  clearFailure(): void {
    this.shouldFail = false;
    this.failureError = null;
  }

  /**
   * Emits an error event
   */
  emitError(error: Error): void {
    this.emit('error', error);
  }
}

/**
 * Mock TTS Manager for testing
 */
export class MockTTSManager extends EventEmitter {
  private isSpeakingFlag = false;
  private shouldFail = false;
  private failureError: Error | null = null;
  private speakDelay = 100;

  constructor() {
    super();
  }

  isSpeaking(): boolean {
    return this.isSpeakingFlag;
  }

  async speakWithAudioStream(text: string): Promise<void> {
    if (this.shouldFail && this.failureError) {
      this.emit('error', this.failureError);
      throw this.failureError;
    }

    this.isSpeakingFlag = true;
    // Small delay to allow event listeners to be set up
    await new Promise((resolve) => setImmediate(resolve));
    this.emit('playbackStart');

    // Simulate chunks
    const chunkSize = 1024;
    const chunks = Math.ceil(text.length / 10);

    for (let i = 0; i < chunks; i++) {
      const chunk: MockTTSAudioChunk = {
        data: new Uint8Array(chunkSize),
        format: 'pcm_16000',
        isFinal: i === chunks - 1,
        timestamp: Date.now(),
        index: i,
      };
      this.emit('chunk', chunk);

      if (this.speakDelay > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.speakDelay / chunks));
      }
    }

    const result: MockTTSSynthesisResult = {
      text,
      duration: text.length * 50,
      provider: 'mock',
      format: 'pcm_16000',
      characterCount: text.length,
    };

    this.emit('synthesized', result);
    this.isSpeakingFlag = false;
    this.emit('playbackEnd');
  }

  async streamSentenceChunk(text: string): Promise<number> {
    if (this.shouldFail && this.failureError) {
      throw this.failureError;
    }

    const startTime = Date.now();

    // Simulate minimal TTS latency
    await new Promise((resolve) => setTimeout(resolve, 10));

    const chunk: MockTTSAudioChunk = {
      data: new Uint8Array(512),
      format: 'pcm_16000',
      isFinal: true,
      timestamp: Date.now(),
      index: 0,
    };
    this.emit('chunk', chunk);

    return Date.now() - startTime;
  }

  stop(): void {
    if (this.isSpeakingFlag) {
      this.isSpeakingFlag = false;
      this.emit('interrupted');
      this.emit('playbackEnd');
    }
  }

  /**
   * Configures the mock to fail
   */
  setFailOnCall(error: Error): void {
    this.shouldFail = true;
    this.failureError = error;
  }

  /**
   * Clears failure configuration
   */
  clearFailure(): void {
    this.shouldFail = false;
    this.failureError = null;
  }

  /**
   * Sets the simulated speak delay
   */
  setSpeakDelay(delay: number): void {
    this.speakDelay = delay;
  }
}

/**
 * Mock Memory Manager for testing
 */
export class MockMemoryManager extends EventEmitter {
  private messages: Array<{ role: string; content: string }> = [];
  private sessionId: string = 'mock-session-' + Date.now();

  constructor() {
    super();
  }

  startSession(_metadata?: Record<string, unknown>): void {
    this.sessionId = 'mock-session-' + Date.now();
    this.messages = [];
  }

  getCurrentSessionId(): string {
    return this.sessionId;
  }

  addMessage(message: { role: string; content: string }): void {
    this.messages.push(message);
  }

  getRecentMessages(count: number): Array<{ role: string; content: string }> {
    return this.messages.slice(-count);
  }

  async save(): Promise<void> {
    // No-op for mock
  }

  async clear(): Promise<void> {
    this.messages = [];
  }
}

/**
 * Timing utilities for E2E tests
 */
export const TimingUtils = {
  /**
   * Wait for a specified number of milliseconds
   */
  wait: (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms)),

  /**
   * Measure execution time of a function
   */
  measureTime: async <T>(fn: () => Promise<T>): Promise<{ result: T; duration: number }> => {
    const start = performance.now();
    const result = await fn();
    const duration = performance.now() - start;
    return { result, duration };
  },

  /**
   * Wait for a condition with timeout
   */
  waitFor: async (
    condition: () => boolean | Promise<boolean>,
    timeout: number = 5000,
    interval: number = 50
  ): Promise<void> => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (await condition()) return;
      await TimingUtils.wait(interval);
    }
    throw new Error(`Condition not met within ${timeout}ms`);
  },

  /**
   * Wait for an event to be emitted
   */
  waitForEvent: <T>(
    emitter: EventEmitter,
    event: string,
    timeout: number = 5000
  ): Promise<T> => {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Event '${event}' not emitted within ${timeout}ms`));
      }, timeout);

      emitter.once(event, (data: T) => {
        clearTimeout(timer);
        resolve(data);
      });
    });
  },

  /**
   * Collect multiple events
   */
  collectEvents: <T>(
    emitter: EventEmitter,
    event: string,
    count: number,
    timeout: number = 5000
  ): Promise<T[]> => {
    return new Promise((resolve, reject) => {
      const events: T[] = [];
      const timer = setTimeout(() => {
        reject(
          new Error(`Only ${events.length}/${count} '${event}' events emitted within ${timeout}ms`)
        );
      }, timeout);

      const handler = (data: T) => {
        events.push(data);
        if (events.length >= count) {
          clearTimeout(timer);
          emitter.off(event, handler);
          resolve(events);
        }
      };

      emitter.on(event, handler);
    });
  },
};

/**
 * State transition recorder for testing pipeline state machine
 */
export class StateTransitionRecorder {
  private transitions: Array<{
    from: VoicePipelineState | null;
    to: VoicePipelineState;
    timestamp: number;
  }> = [];

  record(from: VoicePipelineState | null, to: VoicePipelineState): void {
    this.transitions.push({
      from,
      to,
      timestamp: Date.now(),
    });
  }

  getTransitions(): Array<{
    from: VoicePipelineState | null;
    to: VoicePipelineState;
    timestamp: number;
  }> {
    return [...this.transitions];
  }

  getStateSequence(): VoicePipelineState[] {
    return this.transitions.map((t) => t.to);
  }

  hasTransition(from: VoicePipelineState, to: VoicePipelineState): boolean {
    return this.transitions.some((t) => t.from === from && t.to === to);
  }

  getTransitionTime(from: VoicePipelineState, to: VoicePipelineState): number {
    for (let i = 0; i < this.transitions.length - 1; i++) {
      if (this.transitions[i].to === from) {
        const next = this.transitions.find((t, j) => j > i && t.to === to);
        if (next) {
          return next.timestamp - this.transitions[i].timestamp;
        }
      }
    }
    return -1;
  }

  clear(): void {
    this.transitions = [];
  }
}

/**
 * Event collector for comprehensive pipeline event testing
 */
export class PipelineEventCollector {
  private events: Array<{ name: string; data: unknown; timestamp: number }> = [];

  constructor(emitter: EventEmitter, eventNames: string[]) {
    for (const name of eventNames) {
      emitter.on(name, (...args: unknown[]) => {
        this.events.push({
          name,
          data: args.length === 1 ? args[0] : args,
          timestamp: Date.now(),
        });
      });
    }
  }

  getEvents(): Array<{ name: string; data: unknown; timestamp: number }> {
    return [...this.events];
  }

  getEventsByName(name: string): Array<{ name: string; data: unknown; timestamp: number }> {
    return this.events.filter((e) => e.name === name);
  }

  hasEvent(name: string): boolean {
    return this.events.some((e) => e.name === name);
  }

  getEventCount(name: string): number {
    return this.events.filter((e) => e.name === name).length;
  }

  getEventSequence(): string[] {
    return this.events.map((e) => e.name);
  }

  clear(): void {
    this.events = [];
  }
}

/**
 * Latency metrics collector
 */
export class LatencyMetricsCollector {
  private metrics: Record<string, number[]> = {};

  record(metric: string, value: number): void {
    if (!this.metrics[metric]) {
      this.metrics[metric] = [];
    }
    this.metrics[metric].push(value);
  }

  getAverage(metric: string): number {
    const values = this.metrics[metric];
    if (!values || values.length === 0) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  getMin(metric: string): number {
    const values = this.metrics[metric];
    if (!values || values.length === 0) return 0;
    return Math.min(...values);
  }

  getMax(metric: string): number {
    const values = this.metrics[metric];
    if (!values || values.length === 0) return 0;
    return Math.max(...values);
  }

  getP95(metric: string): number {
    const values = this.metrics[metric];
    if (!values || values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.floor(sorted.length * 0.95);
    return sorted[index] || sorted[sorted.length - 1];
  }

  getAllMetrics(): Record<string, { avg: number; min: number; max: number; p95: number }> {
    const result: Record<string, { avg: number; min: number; max: number; p95: number }> = {};
    for (const metric of Object.keys(this.metrics)) {
      result[metric] = {
        avg: this.getAverage(metric),
        min: this.getMin(metric),
        max: this.getMax(metric),
        p95: this.getP95(metric),
      };
    }
    return result;
  }

  clear(): void {
    this.metrics = {};
  }
}

/**
 * Creates a complete mock voice pipeline test harness
 */
export function createMockPipelineHarness() {
  const audioPipeline = new MockAudioPipeline();
  const sttManager = new MockSTTManager();
  const llmManager = new MockLLMManager();
  const ttsManager = new MockTTSManager();
  const memoryManager = new MockMemoryManager();
  const stateRecorder = new StateTransitionRecorder();
  const latencyCollector = new LatencyMetricsCollector();

  return {
    audioPipeline,
    sttManager,
    llmManager,
    ttsManager,
    memoryManager,
    stateRecorder,
    latencyCollector,

    /**
     * Simulates a complete voice interaction
     */
    async simulateInteraction(config: SimulatedInteractionConfig): Promise<void> {
      const {
        transcriptText,
        llmResponse,
        streaming = true,
        chunkCount = 5,
        chunkDelay = 50,
        sttDelay = 100,
        ttsDelay = 100,
      } = config;

      // Queue the responses
      sttManager.queueTranscript(transcriptText);
      llmManager.queueResponse(llmResponse, chunkCount, chunkDelay);
      ttsManager.setSpeakDelay(ttsDelay);

      // Trigger wake word
      audioPipeline.triggerWake();

      // Wait for STT processing
      await TimingUtils.wait(sttDelay);

      // Inject speech segment
      const segment = createSpeechSegment(1000);
      audioPipeline.injectSpeechSegment(segment);
    },

    /**
     * Resets all mocks
     */
    reset(): void {
      stateRecorder.clear();
      latencyCollector.clear();
      sttManager.clearFailure();
      llmManager.clearFailure();
      ttsManager.clearFailure();
    },
  };
}

export default {
  generateSilence,
  generateSineWave,
  generateNoise,
  generateSpeechLikeAudio,
  generateAudio,
  float32ToInt16,
  int16ToFloat32,
  createSpeechSegment,
  MockAudioPipeline,
  MockSTTManager,
  MockLLMManager,
  MockTTSManager,
  MockMemoryManager,
  TimingUtils,
  StateTransitionRecorder,
  PipelineEventCollector,
  LatencyMetricsCollector,
  createMockPipelineHarness,
  SAMPLE_RATE,
  FRAME_SIZES,
};
