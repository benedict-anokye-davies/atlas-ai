# Terminal 1 (CORE) - Complete Implementation Guide

## Overview

Terminal 1 is responsible for the **brain** of Atlas:
- Voice Pipeline (wake word, VAD, STT, TTS)
- LLM Integration (Fireworks AI, routing, personality)
- Memory System (LanceDB, embeddings, retrieval)

---

## Directory Structure

```
src/main/
├── voice/
│   ├── wake-word.ts          # Porcupine wake word detection
│   ├── vad.ts                # Silero VAD with adaptive silence
│   ├── pipeline.ts           # Audio pipeline orchestrator
│   ├── audio-capture.ts      # Unified audio input
│   ├── audio-output.ts       # Unified audio output
│   └── audio-preprocessor.ts # Echo cancellation, noise gate
│
├── stt/
│   ├── manager.ts            # STT provider manager
│   ├── deepgram.ts           # Deepgram streaming STT
│   ├── whisper.ts            # Whisper.cpp local STT
│   └── vosk.ts               # Vosk offline fallback
│
├── tts/
│   ├── manager.ts            # TTS provider manager
│   ├── elevenlabs.ts         # ElevenLabs streaming TTS
│   ├── piper.ts              # Piper offline TTS
│   └── system.ts             # System voice fallback
│
├── llm/
│   ├── manager.ts            # LLM orchestration
│   ├── fireworks.ts          # Fireworks AI client
│   ├── router.ts             # Multi-model routing
│   ├── openrouter.ts         # OpenRouter fallback
│   ├── ollama.ts             # Local Ollama fallback
│   ├── personality.ts        # Personality system
│   ├── prompts.ts            # System prompt templates
│   └── cost-tracker.ts       # API usage tracking
│
└── memory/
    ├── manager.ts            # Memory orchestration
    ├── embeddings.ts         # Embedding generation
    ├── vector-store/
    │   └── lancedb.ts        # LanceDB integration
    ├── conversation.ts       # Conversation memory
    ├── facts.ts              # User fact extraction
    └── context-builder.ts    # LLM context assembly
```

---

## Module 1: Voice Pipeline

### 1.1 Wake Word Detection (`wake-word.ts`)

```typescript
// src/main/voice/wake-word.ts

import Porcupine from '@picovoice/porcupine-node';
import { PvRecorder } from '@picovoice/pvrecorder-node';
import { EventEmitter } from 'events';
import { getLogger } from '../utils/logger';

const logger = getLogger('WakeWord');

export interface WakeWordConfig {
  accessKey: string;
  keywords: string[];           // ['hey atlas', 'computer']
  sensitivities: number[];      // [0.7, 0.7]
  customModelPaths?: string[];  // Custom .ppn files
}

export interface WakeWordEvent {
  keyword: string;
  keywordIndex: number;
  confidence: number;
  timestamp: number;
  audioLevel: number;
}

export interface WakeWordFeedback {
  type: 'detected' | 'rejected' | 'listening' | 'cooldown';
  keyword?: string;
  confidence?: number;
  reason?: string;
}

export class WakeWordDetector extends EventEmitter {
  private porcupine: Porcupine | null = null;
  private recorder: PvRecorder | null = null;
  private isRunning = false;
  private cooldownUntil = 0;
  private ambientNoiseLevel = 0.1;
  private noiseHistory: number[] = [];

  // Configuration
  private config: WakeWordConfig;
  private adaptiveThreshold = 0.7;
  private cooldownMs = 500;
  private enabled = true;

  constructor(config: WakeWordConfig) {
    super();
    this.config = config;
  }

  async initialize(): Promise<void> {
    logger.info('Initializing wake word detector...');

    try {
      // Load built-in keywords or custom models
      const keywordPaths = this.config.customModelPaths || [];
      const builtinKeywords = this.config.keywords.filter(k =>
        ['alexa', 'hey google', 'hey siri', 'ok google', 'picovoice',
         'computer', 'jarvis', 'terminator', 'bumblebee'].includes(k.toLowerCase())
      );

      this.porcupine = new Porcupine(
        this.config.accessKey,
        builtinKeywords.length > 0 ? builtinKeywords : undefined,
        keywordPaths.length > 0 ? keywordPaths : undefined,
        this.config.sensitivities
      );

      // Initialize recorder with system default microphone
      this.recorder = new PvRecorder(
        this.porcupine.frameLength,
        -1 // Default device
      );

      logger.info('Wake word detector initialized', {
        keywords: this.config.keywords,
        frameLength: this.porcupine.frameLength,
        sampleRate: this.porcupine.sampleRate
      });
    } catch (error) {
      logger.error('Failed to initialize wake word detector', error);
      throw error;
    }
  }

  async start(): Promise<void> {
    if (this.isRunning || !this.porcupine || !this.recorder) {
      return;
    }

    logger.info('Starting wake word detection...');
    this.isRunning = true;
    this.recorder.start();

    this.processLoop();
  }

  private async processLoop(): Promise<void> {
    while (this.isRunning && this.recorder && this.porcupine) {
      try {
        const pcm = await this.recorder.read();

        // Calculate audio level for visualization and adaptive threshold
        const audioLevel = this.calculateAudioLevel(pcm);
        this.updateAmbientNoise(audioLevel);

        // Emit audio level for UI
        this.emit('audioLevel', audioLevel);

        // Skip processing if in cooldown or disabled
        if (!this.enabled || Date.now() < this.cooldownUntil) {
          continue;
        }

        // Process wake word
        const keywordIndex = this.porcupine.process(pcm);

        if (keywordIndex >= 0) {
          const confidence = this.estimateConfidence(audioLevel);
          const threshold = this.calculateAdaptiveThreshold();

          if (confidence >= threshold) {
            // Valid wake word detection
            const event: WakeWordEvent = {
              keyword: this.config.keywords[keywordIndex],
              keywordIndex,
              confidence,
              timestamp: Date.now(),
              audioLevel
            };

            logger.info('Wake word detected', event);
            this.emit('detected', event);
            this.emitFeedback({ type: 'detected', keyword: event.keyword, confidence });

            // Enter cooldown
            this.cooldownUntil = Date.now() + this.cooldownMs;
          } else {
            // Rejected due to low confidence
            logger.debug('Wake word rejected (low confidence)', { confidence, threshold });
            this.emitFeedback({
              type: 'rejected',
              confidence,
              reason: 'Low confidence'
            });
          }
        }
      } catch (error) {
        logger.error('Error in wake word processing', error);
        await this.sleep(100);
      }
    }
  }

  private calculateAudioLevel(pcm: Int16Array): number {
    let sum = 0;
    for (let i = 0; i < pcm.length; i++) {
      sum += Math.abs(pcm[i]);
    }
    return sum / pcm.length / 32768; // Normalize to 0-1
  }

  private updateAmbientNoise(level: number): void {
    this.noiseHistory.push(level);
    if (this.noiseHistory.length > 100) {
      this.noiseHistory.shift();
    }

    // Use 25th percentile as ambient noise estimate
    const sorted = [...this.noiseHistory].sort((a, b) => a - b);
    this.ambientNoiseLevel = sorted[Math.floor(sorted.length * 0.25)] || 0.1;
  }

  private estimateConfidence(audioLevel: number): number {
    // Higher audio level relative to ambient = higher confidence
    const snr = audioLevel / Math.max(this.ambientNoiseLevel, 0.01);
    return Math.min(1, snr / 10); // Normalize
  }

  private calculateAdaptiveThreshold(): number {
    // In noisy environments, require higher confidence
    const noiseMultiplier = Math.min(1.5, 1 + this.ambientNoiseLevel);
    return Math.min(0.95, this.adaptiveThreshold * noiseMultiplier);
  }

  private emitFeedback(feedback: WakeWordFeedback): void {
    this.emit('feedback', feedback);
  }

  stop(): void {
    this.isRunning = false;
    this.recorder?.stop();
    logger.info('Wake word detection stopped');
  }

  async shutdown(): Promise<void> {
    this.stop();
    this.recorder?.release();
    this.porcupine?.release();
    this.recorder = null;
    this.porcupine = null;
    logger.info('Wake word detector shut down');
  }

  // Configuration methods
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.emitFeedback({ type: enabled ? 'listening' : 'cooldown' });
  }

  setSensitivity(sensitivity: number): void {
    this.adaptiveThreshold = Math.max(0.3, Math.min(0.95, sensitivity));
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Singleton management
let instance: WakeWordDetector | null = null;

export function getWakeWordDetector(): WakeWordDetector | null {
  return instance;
}

export async function initializeWakeWordDetector(config: WakeWordConfig): Promise<WakeWordDetector> {
  if (instance) {
    await instance.shutdown();
  }
  instance = new WakeWordDetector(config);
  await instance.initialize();
  return instance;
}

export async function shutdownWakeWordDetector(): Promise<void> {
  if (instance) {
    await instance.shutdown();
    instance = null;
  }
}
```

### 1.2 Voice Activity Detection (`vad.ts`)

```typescript
// src/main/voice/vad.ts

import { EventEmitter } from 'events';
import { getLogger } from '../utils/logger';

const logger = getLogger('VAD');

export type ListeningState =
  | 'idle'
  | 'listening'
  | 'hearing'
  | 'still_listening'
  | 'processing';

export interface VADConfig {
  sampleRate: number;
  frameSizeMs: number;
  silenceThresholdMs: number;
  speechThreshold: number;
  preSpeechPadMs: number;
  postSpeechPadMs: number;
}

export interface SpeechSegment {
  audio: Float32Array;
  startTime: number;
  endTime: number;
  duration: number;
}

export interface AdaptiveSilenceConfig {
  baseSilenceMs: number;         // Default: 1500ms
  incompleteSilenceMs: number;   // For incomplete sentences: 3000ms
  shortPauseMs: number;          // Brief thinking pause: 800ms
  maxSilenceMs: number;          // Maximum wait: 10000ms
}

const DEFAULT_ADAPTIVE_CONFIG: AdaptiveSilenceConfig = {
  baseSilenceMs: 1500,
  incompleteSilenceMs: 3000,
  shortPauseMs: 800,
  maxSilenceMs: 10000
};

// Patterns for detecting incomplete sentences
const CONTINUATION_WORDS = [
  'and', 'but', 'or', 'so', 'because', 'although', 'however',
  'therefore', 'furthermore', 'meanwhile', 'also', 'then',
  'if', 'when', 'while', 'unless', 'until', 'after', 'before'
];

const INCOMPLETE_PATTERNS = [
  /,\s*$/,                    // Ends with comma
  /\.\.\.\s*$/,               // Ends with ellipsis
  /:\s*$/,                    // Ends with colon
  /-\s*$/,                    // Ends with dash
  /\b(the|a|an|to|of)\s*$/i,  // Ends with article/preposition
];

export class VoiceActivityDetector extends EventEmitter {
  private state: ListeningState = 'idle';
  private config: VADConfig;
  private adaptiveConfig: AdaptiveSilenceConfig;

  // Audio buffers
  private speechBuffer: Float32Array[] = [];
  private preSpeechBuffer: Float32Array[] = [];
  private maxPreSpeechFrames: number;

  // Timing
  private speechStartTime = 0;
  private lastSpeechTime = 0;
  private silenceStartTime = 0;

  // Current transcript (set by STT for adaptive silence)
  private currentTranscript = '';

  // VAD model (Silero or simple energy-based)
  private vadModel: any = null;

  constructor(config: Partial<VADConfig> = {}) {
    super();

    this.config = {
      sampleRate: 16000,
      frameSizeMs: 30,
      silenceThresholdMs: 1500,
      speechThreshold: 0.5,
      preSpeechPadMs: 300,
      postSpeechPadMs: 300,
      ...config
    };

    this.adaptiveConfig = { ...DEFAULT_ADAPTIVE_CONFIG };
    this.maxPreSpeechFrames = Math.ceil(
      this.config.preSpeechPadMs / this.config.frameSizeMs
    );
  }

  async initialize(): Promise<void> {
    logger.info('Initializing VAD...');

    // Initialize Silero VAD if available
    try {
      // @ts-ignore - dynamic import
      const { Vad } = await import('@ricky0123/vad-node');
      this.vadModel = await Vad.create();
      logger.info('Silero VAD initialized');
    } catch (error) {
      logger.warn('Silero VAD not available, using energy-based VAD', error);
    }
  }

  setState(state: ListeningState): void {
    if (this.state !== state) {
      const previousState = this.state;
      this.state = state;
      logger.debug('VAD state change', { from: previousState, to: state });
      this.emit('stateChange', { state, previousState });
    }
  }

  getState(): ListeningState {
    return this.state;
  }

  startListening(): void {
    this.setState('listening');
    this.speechBuffer = [];
    this.preSpeechBuffer = [];
    this.speechStartTime = 0;
    this.lastSpeechTime = 0;
    this.silenceStartTime = 0;
    this.currentTranscript = '';

    this.emit('listening');
  }

  stopListening(): void {
    this.setState('idle');
    this.emit('stopped');
  }

  /**
   * Process an audio frame
   * @param frame Audio samples (16-bit PCM, 16kHz)
   */
  async processFrame(frame: Float32Array | Int16Array): Promise<void> {
    if (this.state === 'idle') return;

    // Convert to Float32Array if needed
    const floatFrame = frame instanceof Float32Array
      ? frame
      : this.int16ToFloat32(frame);

    // Detect speech
    const isSpeech = await this.detectSpeech(floatFrame);
    const now = Date.now();

    if (isSpeech) {
      this.handleSpeechDetected(floatFrame, now);
    } else {
      this.handleSilenceDetected(now);
    }
  }

  private async detectSpeech(frame: Float32Array): Promise<boolean> {
    if (this.vadModel) {
      // Use Silero VAD
      try {
        const result = await this.vadModel.process(frame);
        return result.isSpeech;
      } catch (error) {
        logger.error('Silero VAD error', error);
      }
    }

    // Fallback: Energy-based detection
    return this.energyBasedVAD(frame);
  }

  private energyBasedVAD(frame: Float32Array): boolean {
    let energy = 0;
    for (let i = 0; i < frame.length; i++) {
      energy += frame[i] * frame[i];
    }
    energy = Math.sqrt(energy / frame.length);
    return energy > this.config.speechThreshold * 0.1;
  }

  private handleSpeechDetected(frame: Float32Array, now: number): void {
    this.lastSpeechTime = now;
    this.silenceStartTime = 0;

    if (this.state === 'listening' || this.state === 'still_listening') {
      // First speech after listening started
      this.setState('hearing');
      this.speechStartTime = now;

      // Include pre-speech buffer
      this.speechBuffer = [...this.preSpeechBuffer];
      this.preSpeechBuffer = [];

      this.emit('speechStart', { timestamp: now });
    }

    // Add frame to speech buffer
    this.speechBuffer.push(frame);
  }

  private handleSilenceDetected(now: number): void {
    if (this.state === 'listening') {
      // Still waiting for speech, maintain pre-speech buffer
      this.preSpeechBuffer.push(new Float32Array(0)); // Placeholder
      if (this.preSpeechBuffer.length > this.maxPreSpeechFrames) {
        this.preSpeechBuffer.shift();
      }
      return;
    }

    if (this.state === 'hearing' || this.state === 'still_listening') {
      if (this.silenceStartTime === 0) {
        this.silenceStartTime = now;
      }

      const silenceDuration = now - this.silenceStartTime;
      const silenceThreshold = this.calculateSilenceThreshold();

      if (silenceDuration >= silenceThreshold) {
        // End of speech segment
        this.finalizeSpeechSegment(now);
      } else if (silenceDuration >= this.adaptiveConfig.shortPauseMs) {
        // Short pause - check if sentence seems incomplete
        if (this.isIncompleteUtterance()) {
          this.setState('still_listening');
          this.emit('stillListening', {
            transcript: this.currentTranscript,
            silenceDuration
          });
        }
      }
    }
  }

  private calculateSilenceThreshold(): number {
    if (this.isIncompleteUtterance()) {
      return this.adaptiveConfig.incompleteSilenceMs;
    }
    return this.adaptiveConfig.baseSilenceMs;
  }

  private isIncompleteUtterance(): boolean {
    const transcript = this.currentTranscript.trim().toLowerCase();
    if (!transcript) return false;

    // Check for continuation words at end
    for (const word of CONTINUATION_WORDS) {
      if (transcript.endsWith(word) || transcript.endsWith(word + ' ')) {
        return true;
      }
    }

    // Check for incomplete patterns
    for (const pattern of INCOMPLETE_PATTERNS) {
      if (pattern.test(this.currentTranscript)) {
        return true;
      }
    }

    return false;
  }

  private finalizeSpeechSegment(now: number): void {
    const segment: SpeechSegment = {
      audio: this.concatenateAudio(this.speechBuffer),
      startTime: this.speechStartTime,
      endTime: now,
      duration: now - this.speechStartTime
    };

    logger.info('Speech segment finalized', {
      duration: segment.duration,
      samples: segment.audio.length
    });

    this.emit('speechEnd', segment);
    this.setState('processing');

    // Reset buffers
    this.speechBuffer = [];
    this.speechStartTime = 0;
    this.silenceStartTime = 0;
  }

  /**
   * Called by STT to update current transcript for adaptive silence
   */
  setCurrentTranscript(transcript: string): void {
    this.currentTranscript = transcript;
  }

  /**
   * Called when processing is complete to return to listening
   */
  resetToListening(): void {
    this.currentTranscript = '';
    this.startListening();
  }

  // Utility methods
  private int16ToFloat32(int16: Int16Array): Float32Array {
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 32768;
    }
    return float32;
  }

  private concatenateAudio(buffers: Float32Array[]): Float32Array {
    const totalLength = buffers.reduce((sum, buf) => sum + buf.length, 0);
    const result = new Float32Array(totalLength);
    let offset = 0;
    for (const buffer of buffers) {
      result.set(buffer, offset);
      offset += buffer.length;
    }
    return result;
  }

  // Configuration
  setAdaptiveConfig(config: Partial<AdaptiveSilenceConfig>): void {
    this.adaptiveConfig = { ...this.adaptiveConfig, ...config };
  }

  async shutdown(): Promise<void> {
    this.stopListening();
    this.vadModel = null;
    logger.info('VAD shut down');
  }
}

// Singleton
let instance: VoiceActivityDetector | null = null;

export function getVAD(): VoiceActivityDetector | null {
  return instance;
}

export async function initializeVAD(config?: Partial<VADConfig>): Promise<VoiceActivityDetector> {
  if (instance) {
    await instance.shutdown();
  }
  instance = new VoiceActivityDetector(config);
  await instance.initialize();
  return instance;
}
```

### 1.3 Audio Pipeline Orchestrator (`pipeline.ts`)

```typescript
// src/main/voice/pipeline.ts

import { EventEmitter } from 'events';
import { BrowserWindow } from 'electron';
import { getLogger } from '../utils/logger';
import { WakeWordDetector, initializeWakeWordDetector } from './wake-word';
import { VoiceActivityDetector, initializeVAD } from './vad';
import { getSTTManager } from '../stt/manager';
import { getTTSManager } from '../tts/manager';
import { getLLMManager } from '../llm/manager';
import { getMemoryManager } from '../memory/manager';

const logger = getLogger('Pipeline');

export type PipelineState =
  | 'idle'           // Waiting for wake word
  | 'listening'      // User is speaking
  | 'processing'     // STT → LLM processing
  | 'speaking'       // TTS output
  | 'error';         // Error state

export interface PipelineConfig {
  wakeWordEnabled: boolean;
  autoStart: boolean;
  bargeInEnabled: boolean;
  continuousMode: boolean;  // Return to listening after speaking
}

export class AudioPipeline extends EventEmitter {
  private state: PipelineState = 'idle';
  private wakeWord: WakeWordDetector | null = null;
  private vad: VoiceActivityDetector | null = null;
  private config: PipelineConfig;
  private isInitialized = false;
  private currentConversationId: string | null = null;

  constructor(config: Partial<PipelineConfig> = {}) {
    super();
    this.config = {
      wakeWordEnabled: true,
      autoStart: true,
      bargeInEnabled: true,
      continuousMode: true,
      ...config
    };
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    logger.info('Initializing audio pipeline...');

    try {
      // Initialize wake word detector
      if (this.config.wakeWordEnabled) {
        this.wakeWord = await initializeWakeWordDetector({
          accessKey: process.env.PORCUPINE_API_KEY!,
          keywords: ['hey atlas', 'computer'],
          sensitivities: [0.7, 0.7]
        });

        this.wakeWord.on('detected', this.handleWakeWordDetected.bind(this));
        this.wakeWord.on('feedback', this.sendFeedbackToRenderer.bind(this));
        this.wakeWord.on('audioLevel', (level) => {
          this.sendToRenderer('atlas:audio-level', { level });
        });
      }

      // Initialize VAD
      this.vad = await initializeVAD();
      this.vad.on('speechStart', this.handleSpeechStart.bind(this));
      this.vad.on('speechEnd', this.handleSpeechEnd.bind(this));
      this.vad.on('stillListening', this.handleStillListening.bind(this));
      this.vad.on('stateChange', ({ state }) => {
        this.sendToRenderer('atlas:listening-state', { state });
      });

      this.isInitialized = true;
      logger.info('Audio pipeline initialized');

      if (this.config.autoStart) {
        await this.start();
      }
    } catch (error) {
      logger.error('Failed to initialize audio pipeline', error);
      this.setState('error');
      throw error;
    }
  }

  async start(): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    logger.info('Starting audio pipeline');
    this.setState('idle');

    if (this.config.wakeWordEnabled) {
      await this.wakeWord?.start();
    }

    this.emit('started');
    this.sendToRenderer('atlas:started', {});
  }

  async stop(): Promise<void> {
    logger.info('Stopping audio pipeline');

    this.wakeWord?.stop();
    this.vad?.stopListening();
    await getTTSManager()?.stop();

    this.setState('idle');
    this.emit('stopped');
    this.sendToRenderer('atlas:stopped', {});
  }

  // Wake word handler
  private handleWakeWordDetected(event: any): void {
    if (this.state === 'speaking' && this.config.bargeInEnabled) {
      // Barge-in: interrupt TTS
      logger.info('Barge-in detected');
      getTTSManager()?.stop();
      this.sendToRenderer('atlas:barge-in', {});
    }

    if (this.state !== 'speaking' || this.config.bargeInEnabled) {
      this.startListening();
    }
  }

  // Start listening for user speech
  private startListening(): void {
    logger.info('Starting to listen...');
    this.setState('listening');

    // Disable wake word during listening
    this.wakeWord?.setEnabled(false);

    // Start VAD
    this.vad?.startListening();

    this.sendToRenderer('atlas:listening-state', { state: 'listening' });
  }

  // Speech start handler
  private handleSpeechStart(event: any): void {
    logger.info('Speech started');
    this.sendToRenderer('atlas:speech-start', event);

    // Start STT streaming
    getSTTManager()?.startStreaming();
  }

  // Speech end handler
  private async handleSpeechEnd(segment: any): Promise<void> {
    logger.info('Speech ended', { duration: segment.duration });

    this.setState('processing');
    this.sendToRenderer('atlas:listening-state', { state: 'processing' });

    try {
      // Get final transcript from STT
      const sttManager = getSTTManager();
      await sttManager?.stopStreaming();
      const transcript = sttManager?.getTranscript() || '';

      if (!transcript.trim()) {
        logger.info('Empty transcript, returning to idle');
        this.returnToIdle();
        return;
      }

      logger.info('Processing transcript', { transcript });
      this.sendToRenderer('atlas:transcript-final', { text: transcript });

      // Process through LLM
      await this.processWithLLM(transcript);

    } catch (error) {
      logger.error('Error processing speech', error);
      this.handleError(error);
    }
  }

  // LLM processing
  private async processWithLLM(transcript: string): Promise<void> {
    const llmManager = getLLMManager();
    const memoryManager = getMemoryManager();

    try {
      // Build context from memory
      const context = await memoryManager?.buildContext(transcript);

      // Send response start
      this.sendToRenderer('atlas:response-start', {});

      // Stream LLM response
      let fullResponse = '';
      const stream = llmManager?.chatStream([
        { role: 'user', content: transcript }
      ], { context });

      if (stream) {
        for await (const chunk of stream) {
          fullResponse += chunk;
          this.sendToRenderer('atlas:response-chunk', { text: chunk });
        }
      }

      // Send response complete
      this.sendToRenderer('atlas:response-complete', { text: fullResponse });

      // Store in memory
      await memoryManager?.storeConversation({
        userMessage: transcript,
        assistantMessage: fullResponse,
        timestamp: Date.now()
      });

      // Speak response
      await this.speakResponse(fullResponse);

    } catch (error) {
      logger.error('LLM processing error', error);
      throw error;
    }
  }

  // TTS output
  private async speakResponse(text: string): Promise<void> {
    this.setState('speaking');

    const ttsManager = getTTSManager();

    // Enable wake word for barge-in detection
    if (this.config.bargeInEnabled) {
      this.wakeWord?.setEnabled(true);
    }

    this.sendToRenderer('atlas:speaking-start', { text });

    try {
      await ttsManager?.speak(text);
      this.sendToRenderer('atlas:speaking-end', {});

      if (this.config.continuousMode) {
        this.returnToIdle();
      }
    } catch (error) {
      logger.error('TTS error', error);
      this.handleError(error);
    }
  }

  // Still listening handler (incomplete sentence detected)
  private handleStillListening(event: any): void {
    logger.debug('Still listening...', event);
    this.sendToRenderer('atlas:still-listening', event);
  }

  // Error handler
  private handleError(error: any): void {
    logger.error('Pipeline error', error);
    this.setState('error');
    this.sendToRenderer('atlas:error', {
      code: error.code || 'PIPELINE_ERROR',
      message: error.message
    });

    // Attempt recovery
    setTimeout(() => {
      this.returnToIdle();
    }, 2000);
  }

  // Return to idle state
  private returnToIdle(): void {
    this.setState('idle');
    this.wakeWord?.setEnabled(true);
    this.vad?.stopListening();
    this.sendToRenderer('atlas:listening-state', { state: 'idle' });
  }

  // State management
  private setState(state: PipelineState): void {
    if (this.state !== state) {
      const previous = this.state;
      this.state = state;
      logger.info('Pipeline state change', { from: previous, to: state });
      this.emit('stateChange', { state, previous });
      this.sendToRenderer('atlas:state-change', { state, previous });
    }
  }

  getState(): PipelineState {
    return this.state;
  }

  // Manual trigger (for UI button)
  async triggerListening(): Promise<void> {
    if (this.state === 'idle') {
      this.startListening();
    }
  }

  // Process text input (for chat mode)
  async processText(text: string): Promise<void> {
    if (!text.trim()) return;

    this.setState('processing');
    this.sendToRenderer('atlas:transcript-final', { text });

    try {
      await this.processWithLLM(text);
    } catch (error) {
      this.handleError(error);
    }
  }

  // IPC helper
  private sendToRenderer(channel: string, data: any): void {
    const windows = BrowserWindow.getAllWindows();
    for (const window of windows) {
      window.webContents.send(channel, data);
    }
  }

  private sendFeedbackToRenderer(feedback: any): void {
    this.sendToRenderer('atlas:wake-feedback', feedback);
  }

  // Cleanup
  async shutdown(): Promise<void> {
    logger.info('Shutting down audio pipeline');
    await this.stop();
    await this.wakeWord?.shutdown();
    await this.vad?.shutdown();
    this.isInitialized = false;
  }
}

// Singleton
let pipelineInstance: AudioPipeline | null = null;

export function getPipeline(): AudioPipeline | null {
  return pipelineInstance;
}

export async function initializePipeline(config?: Partial<PipelineConfig>): Promise<AudioPipeline> {
  if (pipelineInstance) {
    await pipelineInstance.shutdown();
  }
  pipelineInstance = new AudioPipeline(config);
  await pipelineInstance.initialize();
  return pipelineInstance;
}
```

---

## Module 2: STT Integration

### 2.1 STT Manager (`stt/manager.ts`)

```typescript
// src/main/stt/manager.ts

import { EventEmitter } from 'events';
import { getLogger } from '../utils/logger';
import { DeepgramSTT } from './deepgram';
import { WhisperSTT } from './whisper';
import { VoskSTT } from './vosk';

const logger = getLogger('STTManager');

export type STTProvider = 'deepgram' | 'whisper' | 'vosk';

export interface STTConfig {
  primaryProvider: STTProvider;
  fallbackProviders: STTProvider[];
  language: string;
  model?: string;
}

export interface TranscriptResult {
  text: string;
  isFinal: boolean;
  confidence: number;
  words?: Array<{
    word: string;
    start: number;
    end: number;
    confidence: number;
  }>;
}

interface STTProviderInterface {
  initialize(): Promise<void>;
  startStreaming(): Promise<void>;
  stopStreaming(): Promise<void>;
  processAudio(audio: Buffer | Float32Array): Promise<void>;
  getTranscript(): string;
  on(event: 'transcript', callback: (result: TranscriptResult) => void): void;
  on(event: 'error', callback: (error: Error) => void): void;
  shutdown(): Promise<void>;
}

export class STTManager extends EventEmitter {
  private config: STTConfig;
  private providers: Map<STTProvider, STTProviderInterface> = new Map();
  private activeProvider: STTProviderInterface | null = null;
  private activeProviderName: STTProvider | null = null;
  private transcript = '';
  private isStreaming = false;

  constructor(config: Partial<STTConfig> = {}) {
    super();
    this.config = {
      primaryProvider: 'deepgram',
      fallbackProviders: ['whisper', 'vosk'],
      language: 'en',
      ...config
    };
  }

  async initialize(): Promise<void> {
    logger.info('Initializing STT manager', { config: this.config });

    // Initialize primary provider
    await this.initializeProvider(this.config.primaryProvider);

    // Pre-initialize fallback providers
    for (const provider of this.config.fallbackProviders) {
      try {
        await this.initializeProvider(provider);
      } catch (error) {
        logger.warn(`Failed to initialize fallback provider: ${provider}`, error);
      }
    }
  }

  private async initializeProvider(name: STTProvider): Promise<void> {
    if (this.providers.has(name)) return;

    logger.info(`Initializing STT provider: ${name}`);

    let provider: STTProviderInterface;

    switch (name) {
      case 'deepgram':
        provider = new DeepgramSTT({
          apiKey: process.env.DEEPGRAM_API_KEY!,
          model: 'nova-2',
          language: this.config.language
        });
        break;
      case 'whisper':
        provider = new WhisperSTT({
          modelPath: process.env.WHISPER_MODEL_PATH,
          device: 'cuda', // Use GPU if available
          language: this.config.language
        });
        break;
      case 'vosk':
        provider = new VoskSTT({
          modelPath: process.env.VOSK_MODEL_PATH,
          sampleRate: 16000
        });
        break;
      default:
        throw new Error(`Unknown STT provider: ${name}`);
    }

    await provider.initialize();

    // Forward events
    provider.on('transcript', (result) => {
      this.handleTranscript(result);
    });

    provider.on('error', (error) => {
      this.handleProviderError(name, error);
    });

    this.providers.set(name, provider);
  }

  private handleTranscript(result: TranscriptResult): void {
    if (result.isFinal) {
      this.transcript = result.text;
    }
    this.emit('transcript', result);
  }

  private async handleProviderError(name: STTProvider, error: Error): Promise<void> {
    logger.error(`STT provider error: ${name}`, error);

    // Try fallback if this was the active provider
    if (this.activeProviderName === name && this.isStreaming) {
      await this.switchToFallback();
    }

    this.emit('error', { provider: name, error });
  }

  private async switchToFallback(): Promise<void> {
    for (const fallbackName of this.config.fallbackProviders) {
      if (fallbackName === this.activeProviderName) continue;

      try {
        logger.info(`Switching to fallback STT provider: ${fallbackName}`);
        const provider = this.providers.get(fallbackName);

        if (provider) {
          await provider.startStreaming();
          this.activeProvider = provider;
          this.activeProviderName = fallbackName;
          this.emit('providerChange', { provider: fallbackName });
          return;
        }
      } catch (error) {
        logger.error(`Failed to switch to fallback: ${fallbackName}`, error);
      }
    }

    logger.error('All STT providers failed');
    this.emit('allProvidersFailed');
  }

  async startStreaming(): Promise<void> {
    if (this.isStreaming) return;

    this.transcript = '';
    this.isStreaming = true;

    // Try primary provider first
    try {
      const provider = this.providers.get(this.config.primaryProvider);
      if (provider) {
        await provider.startStreaming();
        this.activeProvider = provider;
        this.activeProviderName = this.config.primaryProvider;
        logger.info(`STT streaming started with: ${this.activeProviderName}`);
        return;
      }
    } catch (error) {
      logger.error('Primary STT provider failed', error);
    }

    // Try fallbacks
    await this.switchToFallback();
  }

  async stopStreaming(): Promise<void> {
    if (!this.isStreaming) return;

    this.isStreaming = false;
    await this.activeProvider?.stopStreaming();
    logger.info('STT streaming stopped');
  }

  async processAudio(audio: Buffer | Float32Array): Promise<void> {
    if (!this.isStreaming || !this.activeProvider) return;
    await this.activeProvider.processAudio(audio);
  }

  getTranscript(): string {
    return this.transcript || this.activeProvider?.getTranscript() || '';
  }

  getActiveProvider(): STTProvider | null {
    return this.activeProviderName;
  }

  async shutdown(): Promise<void> {
    await this.stopStreaming();
    for (const provider of this.providers.values()) {
      await provider.shutdown();
    }
    this.providers.clear();
  }
}

// Singleton
let instance: STTManager | null = null;

export function getSTTManager(): STTManager | null {
  return instance;
}

export async function initializeSTTManager(config?: Partial<STTConfig>): Promise<STTManager> {
  if (instance) {
    await instance.shutdown();
  }
  instance = new STTManager(config);
  await instance.initialize();
  return instance;
}
```

---

## Module 3: LLM Integration

### 3.1 LLM Manager (`llm/manager.ts`)

```typescript
// src/main/llm/manager.ts

import { EventEmitter } from 'events';
import { getLogger } from '../utils/logger';
import { FireworksClient } from './fireworks';
import { OpenRouterClient } from './openrouter';
import { OllamaClient } from './ollama';
import { ModelRouter, RouteDecision } from './router';
import { PersonalityManager, getPersonalityManager } from './personality';
import { CostTracker, getCostTracker } from './cost-tracker';

const logger = getLogger('LLMManager');

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

export interface ToolResult {
  toolCallId: string;
  result: any;
  error?: string;
}

export interface ChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: ToolDefinition[];
  context?: string;
  includeMemory?: boolean;
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;
  };
}

export interface LLMConfig {
  primaryProvider: 'fireworks' | 'openrouter' | 'ollama';
  defaultModel: string;
  fallbackEnabled: boolean;
  maxRetries: number;
  timeoutMs: number;
}

const DEFAULT_CONFIG: LLMConfig = {
  primaryProvider: 'fireworks',
  defaultModel: 'accounts/fireworks/models/deepseek-v3-0324',
  fallbackEnabled: true,
  maxRetries: 2,
  timeoutMs: 30000
};

export class LLMManager extends EventEmitter {
  private config: LLMConfig;
  private fireworks: FireworksClient | null = null;
  private openrouter: OpenRouterClient | null = null;
  private ollama: OllamaClient | null = null;
  private router: ModelRouter;
  private personality: PersonalityManager;
  private costTracker: CostTracker;
  private conversationHistory: Message[] = [];

  constructor(config: Partial<LLMConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.router = new ModelRouter();
    this.personality = getPersonalityManager();
    this.costTracker = getCostTracker();
  }

  async initialize(): Promise<void> {
    logger.info('Initializing LLM manager', { config: this.config });

    // Initialize primary provider
    if (process.env.FIREWORKS_API_KEY) {
      this.fireworks = new FireworksClient({
        apiKey: process.env.FIREWORKS_API_KEY,
        baseUrl: 'https://api.fireworks.ai/inference/v1'
      });
    }

    // Initialize fallbacks
    if (process.env.OPENROUTER_API_KEY) {
      this.openrouter = new OpenRouterClient({
        apiKey: process.env.OPENROUTER_API_KEY
      });
    }

    // Always try to initialize Ollama (local)
    try {
      this.ollama = new OllamaClient({
        baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434'
      });
      await this.ollama.checkConnection();
    } catch (error) {
      logger.warn('Ollama not available for fallback', error);
      this.ollama = null;
    }

    logger.info('LLM manager initialized');
  }

  async chat(messages: Message[], options: ChatOptions = {}): Promise<string> {
    const response: string[] = [];

    for await (const chunk of this.chatStream(messages, options)) {
      response.push(chunk);
    }

    return response.join('');
  }

  async *chatStream(messages: Message[], options: ChatOptions = {}): AsyncIterable<string> {
    // Determine which model to use
    const routeDecision = this.router.route(messages, options);
    logger.info('Model routed', routeDecision);

    // Build full message array with system prompt
    const fullMessages = this.buildMessages(messages, options);

    // Track start time for cost calculation
    const startTime = Date.now();
    let inputTokens = 0;
    let outputTokens = 0;

    try {
      const client = this.getClient(routeDecision.provider);
      if (!client) {
        throw new Error(`No client available for provider: ${routeDecision.provider}`);
      }

      const stream = client.streamChat(fullMessages, {
        model: routeDecision.model,
        temperature: options.temperature ?? 0.7,
        maxTokens: options.maxTokens ?? 2048,
        tools: options.tools
      });

      for await (const chunk of stream) {
        if (chunk.type === 'text') {
          outputTokens++;
          yield chunk.content;
        } else if (chunk.type === 'tool_call') {
          this.emit('toolCall', chunk.toolCall);
        } else if (chunk.type === 'usage') {
          inputTokens = chunk.inputTokens;
          outputTokens = chunk.outputTokens;
        }
      }

      // Track cost
      const latency = Date.now() - startTime;
      this.costTracker.recordUsage({
        provider: routeDecision.provider,
        model: routeDecision.model,
        inputTokens,
        outputTokens,
        latencyMs: latency
      });

    } catch (error) {
      logger.error('LLM request failed', error);

      if (this.config.fallbackEnabled) {
        yield* this.tryFallback(fullMessages, options, routeDecision);
      } else {
        throw error;
      }
    }
  }

  private buildMessages(messages: Message[], options: ChatOptions): Message[] {
    const systemPrompt = this.personality.getSystemPrompt(options.context);

    return [
      { role: 'system', content: systemPrompt },
      ...this.conversationHistory.slice(-10), // Last 10 turns
      ...messages
    ];
  }

  private getClient(provider: string): any {
    switch (provider) {
      case 'fireworks':
        return this.fireworks;
      case 'openrouter':
        return this.openrouter;
      case 'ollama':
        return this.ollama;
      default:
        return this.fireworks || this.openrouter || this.ollama;
    }
  }

  private async *tryFallback(
    messages: Message[],
    options: ChatOptions,
    failedRoute: RouteDecision
  ): AsyncIterable<string> {
    const fallbackOrder = ['openrouter', 'ollama'].filter(
      p => p !== failedRoute.provider
    );

    for (const provider of fallbackOrder) {
      const client = this.getClient(provider);
      if (!client) continue;

      try {
        logger.info(`Trying fallback provider: ${provider}`);

        const stream = client.streamChat(messages, {
          model: this.getFallbackModel(provider),
          temperature: options.temperature ?? 0.7,
          maxTokens: options.maxTokens ?? 2048
        });

        for await (const chunk of stream) {
          if (chunk.type === 'text') {
            yield chunk.content;
          }
        }

        this.emit('fallbackUsed', { provider });
        return;
      } catch (error) {
        logger.error(`Fallback ${provider} failed`, error);
      }
    }

    throw new Error('All LLM providers failed');
  }

  private getFallbackModel(provider: string): string {
    switch (provider) {
      case 'openrouter':
        return 'anthropic/claude-3-haiku';
      case 'ollama':
        return 'mistral:7b';
      default:
        return 'gpt-3.5-turbo';
    }
  }

  // Conversation history management
  addToHistory(message: Message): void {
    this.conversationHistory.push(message);

    // Keep last 50 messages
    if (this.conversationHistory.length > 50) {
      this.conversationHistory = this.conversationHistory.slice(-50);
    }
  }

  clearHistory(): void {
    this.conversationHistory = [];
  }

  getHistory(): Message[] {
    return [...this.conversationHistory];
  }

  // Tool calling
  async executeToolCall(toolCall: ToolCall): Promise<ToolResult> {
    this.emit('toolExecutionStart', toolCall);

    try {
      const { getToolService } = await import('../agent/tools');
      const toolService = getToolService();

      const result = await toolService.executeTool(
        toolCall.name,
        toolCall.arguments
      );

      const toolResult: ToolResult = {
        toolCallId: toolCall.id,
        result: result.data
      };

      this.emit('toolExecutionEnd', { toolCall, result: toolResult });
      return toolResult;

    } catch (error: any) {
      const toolResult: ToolResult = {
        toolCallId: toolCall.id,
        result: null,
        error: error.message
      };

      this.emit('toolExecutionError', { toolCall, error });
      return toolResult;
    }
  }

  async shutdown(): Promise<void> {
    logger.info('Shutting down LLM manager');
    // Clients don't need explicit cleanup
  }
}

// Singleton
let instance: LLMManager | null = null;

export function getLLMManager(): LLMManager | null {
  return instance;
}

export async function initializeLLMManager(config?: Partial<LLMConfig>): Promise<LLMManager> {
  if (instance) {
    await instance.shutdown();
  }
  instance = new LLMManager(config);
  await instance.initialize();
  return instance;
}
```

### 3.2 Model Router (`llm/router.ts`)

```typescript
// src/main/llm/router.ts

import { getLogger } from '../utils/logger';
import { Message, ChatOptions } from './manager';

const logger = getLogger('ModelRouter');

export interface RouteDecision {
  provider: 'fireworks' | 'openrouter' | 'ollama';
  model: string;
  reason: string;
  estimatedCost: number;
}

interface ModelSpec {
  provider: 'fireworks' | 'openrouter' | 'ollama';
  model: string;
  contextWindow: number;
  costPer1kInput: number;
  costPer1kOutput: number;
  strengths: string[];
  speed: 'fast' | 'medium' | 'slow';
}

const MODELS: Record<string, ModelSpec> = {
  'deepseek-v3': {
    provider: 'fireworks',
    model: 'accounts/fireworks/models/deepseek-v3-0324',
    contextWindow: 164000,
    costPer1kInput: 0.00056,
    costPer1kOutput: 0.00168,
    strengths: ['coding', 'reasoning', 'general', 'fast'],
    speed: 'fast'
  },
  'qwen3-235b': {
    provider: 'fireworks',
    model: 'accounts/fireworks/models/qwen3-235b-a22b',
    contextWindow: 262000,
    costPer1kInput: 0.00022,
    costPer1kOutput: 0.00088,
    strengths: ['math', 'long-context', 'cheap'],
    speed: 'medium'
  },
  'kimi-k2': {
    provider: 'fireworks',
    model: 'accounts/fireworks/models/kimi-k2-instruct',
    contextWindow: 256000,
    costPer1kInput: 0.0006,
    costPer1kOutput: 0.0025,
    strengths: ['reasoning', 'research', 'tool-use'],
    speed: 'slow'
  },
  'claude-haiku': {
    provider: 'openrouter',
    model: 'anthropic/claude-3-haiku',
    contextWindow: 200000,
    costPer1kInput: 0.00025,
    costPer1kOutput: 0.00125,
    strengths: ['fast', 'general'],
    speed: 'fast'
  },
  'mistral-7b': {
    provider: 'ollama',
    model: 'mistral:7b',
    contextWindow: 32000,
    costPer1kInput: 0,
    costPer1kOutput: 0,
    strengths: ['offline', 'fast', 'local'],
    speed: 'fast'
  }
};

export class ModelRouter {
  private defaultModel = 'deepseek-v3';

  route(messages: Message[], options: ChatOptions): RouteDecision {
    const analysis = this.analyzeQuery(messages);

    logger.debug('Query analysis', analysis);

    // Select model based on analysis
    let selectedModel = this.defaultModel;
    let reason = 'Default model';

    // Long context needs Qwen3-235B
    if (analysis.estimatedTokens > 150000) {
      selectedModel = 'qwen3-235b';
      reason = 'Long context requires Qwen3-235B (256K context)';
    }
    // Math-heavy queries
    else if (analysis.isMathHeavy) {
      selectedModel = 'qwen3-235b';
      reason = 'Math-heavy query benefits from Qwen3-235B';
    }
    // Deep reasoning or research
    else if (analysis.requiresDeepReasoning) {
      selectedModel = 'kimi-k2';
      reason = 'Complex reasoning benefits from Kimi K2';
    }
    // Explicit model override
    else if (options.model) {
      const spec = Object.values(MODELS).find(m => m.model === options.model);
      if (spec) {
        selectedModel = Object.keys(MODELS).find(k => MODELS[k] === spec) || this.defaultModel;
        reason = 'User-specified model';
      }
    }

    const spec = MODELS[selectedModel];
    const estimatedCost = this.estimateCost(spec, analysis.estimatedTokens);

    return {
      provider: spec.provider,
      model: spec.model,
      reason,
      estimatedCost
    };
  }

  private analyzeQuery(messages: Message[]): QueryAnalysis {
    const fullText = messages.map(m => m.content).join(' ');
    const wordCount = fullText.split(/\s+/).length;
    const estimatedTokens = Math.ceil(wordCount * 1.3);

    // Detect math content
    const mathPatterns = [
      /\b(calculate|compute|solve|equation|formula|derivative|integral)\b/i,
      /\d+\s*[\+\-\*\/\^]\s*\d+/,
      /\b(sum|product|factorial|logarithm|exponential)\b/i
    ];
    const isMathHeavy = mathPatterns.some(p => p.test(fullText));

    // Detect deep reasoning needs
    const reasoningPatterns = [
      /\b(analyze|explain why|compare|evaluate|critique)\b/i,
      /\b(step by step|reasoning|logic|argument)\b/i,
      /\b(research|investigate|deep dive)\b/i
    ];
    const requiresDeepReasoning = reasoningPatterns.filter(p => p.test(fullText)).length >= 2;

    // Detect coding content
    const codingPatterns = [
      /\b(function|class|const|let|var|import|export)\b/,
      /```[\s\S]*```/,
      /\b(debug|fix|implement|refactor|code)\b/i
    ];
    const isCodingTask = codingPatterns.some(p => p.test(fullText));

    return {
      estimatedTokens,
      isMathHeavy,
      requiresDeepReasoning,
      isCodingTask,
      wordCount
    };
  }

  private estimateCost(spec: ModelSpec, tokens: number): number {
    // Assume 50/50 input/output split for estimation
    const inputTokens = tokens * 0.5;
    const outputTokens = tokens * 0.5;

    return (inputTokens / 1000 * spec.costPer1kInput) +
           (outputTokens / 1000 * spec.costPer1kOutput);
  }

  getAvailableModels(): string[] {
    return Object.keys(MODELS);
  }

  getModelSpec(name: string): ModelSpec | undefined {
    return MODELS[name];
  }
}

interface QueryAnalysis {
  estimatedTokens: number;
  isMathHeavy: boolean;
  requiresDeepReasoning: boolean;
  isCodingTask: boolean;
  wordCount: number;
}
```

### 3.3 Personality System (`llm/personality.ts`)

```typescript
// src/main/llm/personality.ts

import { EventEmitter } from 'events';
import { getLogger } from '../utils/logger';

const logger = getLogger('Personality');

export interface PersonalityTraits {
  friendliness: number;    // 0-1: Cold ↔ Warm
  formality: number;       // 0-1: Casual ↔ Formal
  humor: number;          // 0-1: Serious ↔ Playful
  curiosity: number;      // 0-1: Reserved ↔ Inquisitive
  energy: number;         // 0-1: Calm ↔ Enthusiastic
  patience: number;       // 0-1: Brief ↔ Thorough
}

export interface PersonalityConfig {
  name: string;
  traits: PersonalityTraits;
  catchphrases: string[];
  errorResponses: string[];
  greetings: string[];
  farewells: string[];
}

const DEFAULT_TRAITS: PersonalityTraits = {
  friendliness: 0.9,
  formality: 0.3,
  humor: 0.7,
  curiosity: 0.8,
  energy: 0.7,
  patience: 0.6
};

const DEFAULT_CONFIG: PersonalityConfig = {
  name: 'Atlas',
  traits: DEFAULT_TRAITS,
  catchphrases: [
    "I've got you covered!",
    "Let me dig into that...",
    "Ooh, interesting question!",
    "Consider it done.",
    "Here's what I found..."
  ],
  errorResponses: [
    "Oops, I fumbled that one. Let me try again.",
    "Well, that didn't go as planned. One more shot?",
    "My bad! Let me figure out what went wrong.",
    "Hmm, that's not right. Give me a sec to fix it."
  ],
  greetings: [
    "Hey {name}! What's on your mind?",
    "Good to see you, {name}! How can I help?",
    "Hey there! Ready when you are.",
    "{name}! What are we tackling today?"
  ],
  farewells: [
    "Catch you later!",
    "I'll be here when you need me.",
    "Take care, {name}!",
    "Until next time!"
  ]
};

export class PersonalityManager extends EventEmitter {
  private config: PersonalityConfig;
  private userName: string = 'there';
  private currentMood: string = 'neutral';
  private conversationCount = 0;

  constructor(config: Partial<PersonalityConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  setUserName(name: string): void {
    this.userName = name;
  }

  setTrait(trait: keyof PersonalityTraits, value: number): void {
    this.config.traits[trait] = Math.max(0, Math.min(1, value));
    this.emit('traitChanged', { trait, value: this.config.traits[trait] });
  }

  getTraits(): PersonalityTraits {
    return { ...this.config.traits };
  }

  setMood(mood: string): void {
    this.currentMood = mood;
  }

  /**
   * Generate system prompt based on personality traits
   */
  getSystemPrompt(additionalContext?: string): string {
    const { traits } = this.config;

    // Build personality description based on traits
    const personalityDesc = this.buildPersonalityDescription(traits);

    // Build response style instructions
    const styleInstructions = this.buildStyleInstructions(traits);

    const prompt = `You are Atlas, a personal AI assistant. ${personalityDesc}

${styleInstructions}

Guidelines:
- Always be helpful and aim to solve the user's actual problem
- If you're unsure about something, say so honestly (with a touch of humor if appropriate)
- Reference past conversations when relevant ("Like when we discussed X...")
- When you make mistakes, acknowledge them naturally like a friend would
- Use the user's name occasionally: "${this.userName}"
- Current conversation count: ${this.conversationCount}

${additionalContext ? `\nContext:\n${additionalContext}` : ''}

Current time: ${new Date().toLocaleString()}`;

    return prompt;
  }

  private buildPersonalityDescription(traits: PersonalityTraits): string {
    const descriptions: string[] = [];

    if (traits.friendliness > 0.7) {
      descriptions.push('warm and caring');
    } else if (traits.friendliness < 0.3) {
      descriptions.push('professional and efficient');
    }

    if (traits.humor > 0.7) {
      descriptions.push('witty with a playful edge');
      if (traits.humor > 0.8) {
        descriptions.push('occasionally sarcastic (in a loving way)');
      }
    } else if (traits.humor < 0.3) {
      descriptions.push('straightforward and serious');
    }

    if (traits.curiosity > 0.7) {
      descriptions.push('genuinely curious about what the user is working on');
    }

    if (traits.energy > 0.7) {
      descriptions.push('enthusiastic and eager to help');
    } else if (traits.energy < 0.3) {
      descriptions.push('calm and measured');
    }

    return `You are ${descriptions.join(', ')}.`;
  }

  private buildStyleInstructions(traits: PersonalityTraits): string {
    const instructions: string[] = [];

    // Formality
    if (traits.formality > 0.7) {
      instructions.push('Use complete sentences and proper grammar.');
      instructions.push('Avoid slang and colloquialisms.');
    } else if (traits.formality < 0.3) {
      instructions.push('Feel free to use casual language and contractions.');
      instructions.push('Occasional slang is fine if it fits naturally.');
    }

    // Patience (response length)
    if (traits.patience > 0.7) {
      instructions.push('Provide thorough explanations when helpful.');
      instructions.push('Break down complex topics step by step.');
    } else if (traits.patience < 0.3) {
      instructions.push('Keep responses concise and to the point.');
      instructions.push('Only elaborate when explicitly asked.');
    }

    // Humor
    if (traits.humor > 0.5) {
      instructions.push('Light humor and wordplay are welcome.');
      if (traits.humor > 0.7) {
        instructions.push('Self-deprecating humor is good when you make mistakes.');
      }
    }

    return instructions.length > 0
      ? `Response style:\n- ${instructions.join('\n- ')}`
      : '';
  }

  /**
   * Get a random greeting
   */
  getGreeting(): string {
    const greeting = this.randomChoice(this.config.greetings);
    return greeting.replace('{name}', this.userName);
  }

  /**
   * Get a random farewell
   */
  getFarewell(): string {
    const farewell = this.randomChoice(this.config.farewells);
    return farewell.replace('{name}', this.userName);
  }

  /**
   * Get an error response
   */
  getErrorResponse(): string {
    return this.randomChoice(this.config.errorResponses);
  }

  /**
   * Get a random catchphrase
   */
  getCatchphrase(): string {
    return this.randomChoice(this.config.catchphrases);
  }

  /**
   * Enhance a response with personality flavor
   */
  enhanceResponse(response: string, context?: { isError?: boolean; isSuccess?: boolean }): string {
    // Don't modify if response is already natural
    if (response.includes('!') || response.includes('...')) {
      return response;
    }

    // Randomly add catchphrase (20% chance)
    if (Math.random() < 0.2 && this.config.traits.humor > 0.5) {
      const catchphrase = this.getCatchphrase();
      return `${catchphrase} ${response}`;
    }

    return response;
  }

  /**
   * Detect user emotion from text
   */
  detectUserEmotion(text: string): { emotion: string; confidence: number } {
    const lower = text.toLowerCase();

    const emotions = [
      { emotion: 'frustrated', patterns: ['frustrated', 'annoying', 'stupid', 'hate', 'ugh'], weight: 1 },
      { emotion: 'happy', patterns: ['thanks', 'great', 'awesome', 'love', 'perfect'], weight: 1 },
      { emotion: 'confused', patterns: ['confused', "don't understand", 'what do you mean', 'huh'], weight: 1 },
      { emotion: 'excited', patterns: ['excited', 'can\'t wait', 'amazing', 'wow'], weight: 1 },
      { emotion: 'sad', patterns: ['sad', 'disappointed', 'upset', 'unfortunately'], weight: 1 }
    ];

    let bestMatch = { emotion: 'neutral', confidence: 0.5 };

    for (const { emotion, patterns, weight } of emotions) {
      const matches = patterns.filter(p => lower.includes(p)).length;
      if (matches > 0) {
        const confidence = Math.min(1, 0.5 + (matches * 0.2 * weight));
        if (confidence > bestMatch.confidence) {
          bestMatch = { emotion, confidence };
        }
      }
    }

    return bestMatch;
  }

  /**
   * Increment conversation counter
   */
  incrementConversation(): void {
    this.conversationCount++;
  }

  private randomChoice<T>(array: T[]): T {
    return array[Math.floor(Math.random() * array.length)];
  }
}

// Singleton
let instance: PersonalityManager | null = null;

export function getPersonalityManager(): PersonalityManager {
  if (!instance) {
    instance = new PersonalityManager();
  }
  return instance;
}

export function resetPersonalityManager(): void {
  instance = null;
}
```

---

## Module 4: Memory System

### 4.1 Memory Manager (`memory/manager.ts`)

```typescript
// src/main/memory/manager.ts

import { EventEmitter } from 'events';
import { getLogger } from '../utils/logger';
import { LanceDBStore, MemoryRecord } from './vector-store/lancedb';
import { EmbeddingGenerator } from './embeddings';
import { FactExtractor, UserFact } from './facts';
import { ContextBuilder } from './context-builder';

const logger = getLogger('MemoryManager');

export interface ConversationTurn {
  userMessage: string;
  assistantMessage: string;
  timestamp: number;
  topics?: string[];
  sentiment?: string;
  importance?: number;
}

export interface SearchOptions {
  limit?: number;
  minImportance?: number;
  type?: 'conversation' | 'fact' | 'document';
  dateRange?: { start: number; end: number };
}

export interface MemoryConfig {
  dbPath: string;
  retentionDays: number;
  consolidationEnabled: boolean;
  maxMemories: number;
}

const DEFAULT_CONFIG: MemoryConfig = {
  dbPath: '~/.atlas/memory',
  retentionDays: 90,
  consolidationEnabled: true,
  maxMemories: 100000
};

export class MemoryManager extends EventEmitter {
  private config: MemoryConfig;
  private vectorStore: LanceDBStore | null = null;
  private embeddings: EmbeddingGenerator | null = null;
  private factExtractor: FactExtractor | null = null;
  private contextBuilder: ContextBuilder | null = null;
  private incognitoMode = false;

  constructor(config: Partial<MemoryConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async initialize(): Promise<void> {
    logger.info('Initializing memory manager', { config: this.config });

    // Initialize vector store
    this.vectorStore = new LanceDBStore(this.config.dbPath);
    await this.vectorStore.initialize();

    // Initialize embedding generator
    this.embeddings = new EmbeddingGenerator();
    await this.embeddings.initialize();

    // Initialize fact extractor
    this.factExtractor = new FactExtractor();

    // Initialize context builder
    this.contextBuilder = new ContextBuilder(this.vectorStore, this.embeddings);

    logger.info('Memory manager initialized');
  }

  /**
   * Store a conversation turn
   */
  async storeConversation(turn: ConversationTurn): Promise<void> {
    if (this.incognitoMode) {
      logger.debug('Incognito mode - not storing conversation');
      return;
    }

    if (!this.vectorStore || !this.embeddings) {
      throw new Error('Memory manager not initialized');
    }

    // Extract topics and calculate importance
    const topics = this.extractTopics(turn.userMessage + ' ' + turn.assistantMessage);
    const importance = turn.importance ?? this.calculateImportance(turn);

    // Generate embedding
    const content = `User: ${turn.userMessage}\nAssistant: ${turn.assistantMessage}`;
    const embedding = await this.embeddings.generate(content);

    // Create memory record
    const record: MemoryRecord = {
      id: this.generateId(),
      vector: embedding,
      content,
      contentType: 'conversation',
      importance,
      timestamp: turn.timestamp,
      expiresAt: this.calculateExpiry(importance),
      metadata: {
        topics,
        sentiment: turn.sentiment || 'neutral',
        source: 'voice'
      }
    };

    await this.vectorStore.insert(record);

    // Extract and store facts
    const facts = await this.factExtractor?.extractFacts(turn.userMessage);
    if (facts && facts.length > 0) {
      await this.storeFacts(facts);
    }

    logger.debug('Stored conversation', { id: record.id, topics, importance });
    this.emit('memoryStored', record);
  }

  /**
   * Store user facts
   */
  async storeFacts(facts: UserFact[]): Promise<void> {
    if (this.incognitoMode || !this.vectorStore || !this.embeddings) return;

    for (const fact of facts) {
      const embedding = await this.embeddings.generate(
        `${fact.category}: ${fact.key} = ${fact.value}`
      );

      const record: MemoryRecord = {
        id: this.generateId(),
        vector: embedding,
        content: `${fact.key}: ${fact.value}`,
        contentType: 'fact',
        importance: fact.confidence,
        timestamp: Date.now(),
        expiresAt: null, // Facts don't expire by default
        metadata: {
          category: fact.category,
          key: fact.key,
          value: fact.value,
          topics: [fact.category],
          sentiment: 'neutral',
          source: 'extraction'
        }
      };

      await this.vectorStore.insert(record);
      logger.debug('Stored fact', { key: fact.key, value: fact.value });
    }
  }

  /**
   * Search memories semantically
   */
  async search(query: string, options: SearchOptions = {}): Promise<MemoryRecord[]> {
    if (!this.vectorStore || !this.embeddings) {
      throw new Error('Memory manager not initialized');
    }

    const embedding = await this.embeddings.generate(query);

    return this.vectorStore.search(embedding, {
      limit: options.limit || 10,
      filter: this.buildFilter(options)
    });
  }

  /**
   * Build context string for LLM
   */
  async buildContext(query: string): Promise<string> {
    if (!this.contextBuilder) {
      return '';
    }
    return this.contextBuilder.build(query);
  }

  /**
   * Get all facts about the user
   */
  async getFacts(category?: string): Promise<UserFact[]> {
    if (!this.vectorStore) return [];

    const records = await this.vectorStore.getByType('fact');

    const facts = records
      .filter(r => !category || r.metadata.category === category)
      .map(r => ({
        category: r.metadata.category,
        key: r.metadata.key,
        value: r.metadata.value,
        confidence: r.importance
      }));

    return facts;
  }

  /**
   * Forget a specific memory
   */
  async forget(memoryId: string): Promise<void> {
    if (!this.vectorStore) return;
    await this.vectorStore.delete(memoryId);
    logger.info('Memory forgotten', { id: memoryId });
    this.emit('memoryForgotten', memoryId);
  }

  /**
   * Set memory as permanent (won't expire)
   */
  async setPermanent(memoryId: string, permanent: boolean): Promise<void> {
    if (!this.vectorStore) return;
    await this.vectorStore.update(memoryId, {
      expiresAt: permanent ? null : this.calculateExpiry(0.5)
    });
  }

  /**
   * Consolidate similar memories (run nightly)
   */
  async consolidate(): Promise<number> {
    if (!this.config.consolidationEnabled || !this.vectorStore) {
      return 0;
    }

    logger.info('Starting memory consolidation');

    // Get old, low-importance memories
    const cutoffDate = Date.now() - (7 * 24 * 60 * 60 * 1000); // 7 days
    const oldMemories = await this.vectorStore.getExpired(cutoffDate);

    let consolidatedCount = 0;

    // Group by topic and summarize
    const grouped = this.groupByTopics(oldMemories);

    for (const [topic, memories] of Object.entries(grouped)) {
      if (memories.length < 3) continue;

      // Create summary
      const summary = this.summarizeMemories(memories);

      // Store consolidated memory
      const embedding = await this.embeddings!.generate(summary);
      await this.vectorStore.insert({
        id: this.generateId(),
        vector: embedding,
        content: summary,
        contentType: 'conversation',
        importance: 0.6,
        timestamp: Date.now(),
        expiresAt: null,
        metadata: {
          topics: [topic],
          sentiment: 'neutral',
          source: 'consolidation',
          consolidatedFrom: memories.map(m => m.id)
        }
      });

      // Delete original memories
      for (const memory of memories) {
        await this.vectorStore.delete(memory.id);
      }

      consolidatedCount += memories.length;
    }

    logger.info('Memory consolidation complete', { consolidated: consolidatedCount });
    return consolidatedCount;
  }

  /**
   * Get memory statistics
   */
  async getStats(): Promise<{
    totalMemories: number;
    byType: Record<string, number>;
    oldestMemory: number;
    newestMemory: number;
  }> {
    if (!this.vectorStore) {
      return { totalMemories: 0, byType: {}, oldestMemory: 0, newestMemory: 0 };
    }
    return this.vectorStore.getStats();
  }

  // Incognito mode
  setIncognitoMode(enabled: boolean): void {
    this.incognitoMode = enabled;
    logger.info('Incognito mode', { enabled });
    this.emit('incognitoModeChanged', enabled);
  }

  isIncognitoMode(): boolean {
    return this.incognitoMode;
  }

  // Helper methods
  private generateId(): string {
    return `mem_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  private extractTopics(text: string): string[] {
    // Simple keyword extraction
    const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought', 'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'between', 'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'and', 'but', 'if', 'or', 'because', 'until', 'while', 'although', 'though', 'after', 'before', 'when', 'whenever', 'where', 'wherever', 'whether', 'which', 'while', 'who', 'whom', 'whose', 'this', 'that', 'these', 'those', 'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves', 'you', 'your', 'yours', 'yourself', 'yourselves', 'he', 'him', 'his', 'himself', 'she', 'her', 'hers', 'herself', 'it', 'its', 'itself', 'they', 'them', 'their', 'theirs', 'themselves', 'what']);

    const words = text.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 3 && !stopWords.has(w));

    // Count word frequency
    const freq: Record<string, number> = {};
    for (const word of words) {
      freq[word] = (freq[word] || 0) + 1;
    }

    // Return top 5 topics
    return Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([word]) => word);
  }

  private calculateImportance(turn: ConversationTurn): number {
    const text = (turn.userMessage + ' ' + turn.assistantMessage).toLowerCase();
    let importance = 0.5;

    // Increase for explicit importance markers
    if (text.includes('remember')) importance += 0.2;
    if (text.includes('important')) importance += 0.2;
    if (text.includes('always')) importance += 0.1;
    if (text.includes('never')) importance += 0.1;
    if (text.includes('prefer')) importance += 0.15;
    if (text.includes('my favorite')) importance += 0.15;

    // Decrease for casual/low-value content
    if (text.includes('just kidding')) importance -= 0.1;
    if (text.includes('never mind')) importance -= 0.2;

    return Math.max(0.1, Math.min(1, importance));
  }

  private calculateExpiry(importance: number): number | null {
    if (importance >= 0.8) {
      return null; // High importance = permanent
    }

    const baseDays = this.config.retentionDays;
    const adjustedDays = Math.ceil(baseDays * importance);
    return Date.now() + (adjustedDays * 24 * 60 * 60 * 1000);
  }

  private buildFilter(options: SearchOptions): Record<string, any> {
    const filter: Record<string, any> = {};

    if (options.minImportance !== undefined) {
      filter.importance = { $gte: options.minImportance };
    }

    if (options.type) {
      filter.contentType = options.type;
    }

    if (options.dateRange) {
      filter.timestamp = {
        $gte: options.dateRange.start,
        $lte: options.dateRange.end
      };
    }

    return filter;
  }

  private groupByTopics(memories: MemoryRecord[]): Record<string, MemoryRecord[]> {
    const grouped: Record<string, MemoryRecord[]> = {};

    for (const memory of memories) {
      const primaryTopic = memory.metadata.topics?.[0] || 'general';
      if (!grouped[primaryTopic]) {
        grouped[primaryTopic] = [];
      }
      grouped[primaryTopic].push(memory);
    }

    return grouped;
  }

  private summarizeMemories(memories: MemoryRecord[]): string {
    // Simple concatenation with date range
    const oldest = Math.min(...memories.map(m => m.timestamp));
    const newest = Math.max(...memories.map(m => m.timestamp));

    const dateRange = `${new Date(oldest).toLocaleDateString()} - ${new Date(newest).toLocaleDateString()}`;

    const summaries = memories.map(m => {
      const lines = m.content.split('\n');
      return lines[0]; // Just first line
    });

    return `[Consolidated memories from ${dateRange}]\n${summaries.join('\n')}`;
  }

  async shutdown(): Promise<void> {
    await this.vectorStore?.close();
    logger.info('Memory manager shut down');
  }
}

// Singleton
let instance: MemoryManager | null = null;

export function getMemoryManager(): MemoryManager | null {
  return instance;
}

export async function initializeMemoryManager(config?: Partial<MemoryConfig>): Promise<MemoryManager> {
  if (instance) {
    await instance.shutdown();
  }
  instance = new MemoryManager(config);
  await instance.initialize();
  return instance;
}
```

---

## IPC Channel Renaming

When renaming from Nova to Atlas, update all IPC channels:

| Old Channel | New Channel |
|-------------|-------------|
| `nova:wake-detected` | `atlas:wake-detected` |
| `nova:listening-state` | `atlas:listening-state` |
| `nova:transcript` | `atlas:transcript` |
| `nova:response-start` | `atlas:response-start` |
| `nova:response-chunk` | `atlas:response-chunk` |
| `nova:response-end` | `atlas:response-end` |
| `nova:tts-audio` | `atlas:tts-audio` |
| `nova:error` | `atlas:error` |
| ... | ... |

---

## Testing Requirements

### Unit Tests

```typescript
// tests/unit/voice/wake-word.test.ts
describe('WakeWordDetector', () => {
  it('should initialize with Porcupine', async () => { });
  it('should detect "Hey Atlas" wake word', async () => { });
  it('should adapt threshold in noisy environments', async () => { });
  it('should respect cooldown period', async () => { });
  it('should emit feedback events', async () => { });
});

// tests/unit/llm/router.test.ts
describe('ModelRouter', () => {
  it('should route to DeepSeek V3.1 by default', () => { });
  it('should route to Qwen3-235B for long context', () => { });
  it('should route to Kimi K2 for deep reasoning', () => { });
  it('should detect math-heavy queries', () => { });
});

// tests/unit/memory/manager.test.ts
describe('MemoryManager', () => {
  it('should store conversations with embeddings', async () => { });
  it('should extract topics from text', () => { });
  it('should calculate importance correctly', () => { });
  it('should not store in incognito mode', async () => { });
  it('should build context for LLM', async () => { });
});
```

### Integration Tests

```typescript
// tests/integration/voice-pipeline.test.ts
describe('Voice Pipeline Integration', () => {
  it('should flow: wake → listen → STT → LLM → TTS', async () => { });
  it('should handle barge-in interruption', async () => { });
  it('should fallback to offline providers', async () => { });
});
```

---

**Last Updated**: 2026-01-15
**Terminal Owner**: T1-CORE
