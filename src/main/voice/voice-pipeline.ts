/**
 * Nova Desktop - Voice Pipeline Integration
 * Complete voice interaction orchestrator that connects:
 * AudioPipeline (Wake Word + VAD) → STT → LLM → TTS
 *
 * Provides a unified interface for voice interactions with:
 * - Streaming transcription
 * - Streaming LLM responses
 * - Streaming TTS playback
 * - Barge-in support
 * - Conversation context management
 */

import { EventEmitter } from 'events';
import { createModuleLogger, PerformanceTimer } from '../utils/logger';
import { AudioPipeline, getAudioPipeline, shutdownAudioPipeline, PipelineConfig } from './pipeline';
import { STTManager, STTManagerConfig, STTProviderType } from '../stt/manager';
import { LLMManager, LLMManagerConfig, LLMProviderType } from '../llm/manager';
import { ElevenLabsTTS } from '../tts/elevenlabs';
import { getConfig } from '../config';
import {
  VoicePipelineState,
  VoicePipelineStatus,
  WakeWordEvent,
  SpeechSegment,
} from '../../shared/types/voice';
import { TranscriptionResult, STTStatus } from '../../shared/types/stt';
import {
  LLMResponse,
  LLMStreamChunk,
  ConversationContext,
  createConversationContext,
  NOVA_SYSTEM_PROMPT,
} from '../../shared/types/llm';
import { TTSAudioChunk, TTSSynthesisResult } from '../../shared/types/tts';

const logger = createModuleLogger('VoicePipeline');
const perfTimer = new PerformanceTimer('VoicePipeline');

/**
 * Voice Pipeline configuration
 */
export interface VoicePipelineConfig {
  /** Audio pipeline config */
  audio?: Partial<PipelineConfig>;
  /** STT manager config */
  stt?: Partial<STTManagerConfig>;
  /** LLM manager config */
  llm?: Partial<LLMManagerConfig>;
  /** Enable streaming LLM responses to TTS */
  streamToTTS?: boolean;
  /** Minimum characters before sending to TTS (for streaming) */
  ttsBufferSize?: number;
  /** User name for conversation context */
  userName?: string;
  /** Enable conversation history */
  enableHistory?: boolean;
  /** Maximum conversation turns to keep */
  maxHistoryTurns?: number;
}

/**
 * Default Voice Pipeline configuration
 */
const DEFAULT_VOICE_PIPELINE_CONFIG: Required<VoicePipelineConfig> = {
  audio: {},
  stt: {},
  llm: {},
  streamToTTS: true,
  ttsBufferSize: 50, // ~1 sentence
  userName: 'User',
  enableHistory: true,
  maxHistoryTurns: 10,
};

/**
 * Voice Pipeline events
 */
export interface VoicePipelineEvents {
  /** Pipeline state changed */
  'state-change': (state: VoicePipelineState, previousState: VoicePipelineState) => void;
  /** Wake word detected */
  'wake-word': (event: WakeWordEvent) => void;
  /** Speech started */
  'speech-start': () => void;
  /** Speech ended */
  'speech-end': (duration: number) => void;
  /** Interim transcription */
  'transcript-interim': (text: string) => void;
  /** Final transcription */
  'transcript-final': (result: TranscriptionResult) => void;
  /** LLM response started */
  'response-start': () => void;
  /** LLM response chunk */
  'response-chunk': (chunk: LLMStreamChunk) => void;
  /** LLM response complete */
  'response-complete': (response: LLMResponse) => void;
  /** TTS audio chunk */
  'audio-chunk': (chunk: TTSAudioChunk) => void;
  /** TTS synthesis complete */
  'synthesis-complete': (result: TTSSynthesisResult) => void;
  /** Speaking started */
  'speaking-start': () => void;
  /** Speaking ended */
  'speaking-end': () => void;
  /** Barge-in detected */
  'barge-in': () => void;
  /** Audio level update */
  'audio-level': (level: number) => void;
  /** Error occurred */
  error: (error: Error, component: string) => void;
  /** Pipeline started */
  started: () => void;
  /** Pipeline stopped */
  stopped: () => void;
  /** Provider changed */
  'provider-change': (type: 'stt' | 'llm', provider: string) => void;
}

/**
 * Interaction metrics
 */
export interface InteractionMetrics {
  /** Total interaction time (ms) */
  totalTime: number;
  /** Time from wake word to STT start */
  wakeToSttTime: number;
  /** STT processing time */
  sttTime: number;
  /** LLM response time (first token) */
  llmFirstTokenTime: number;
  /** LLM total response time */
  llmTotalTime: number;
  /** TTS first audio time */
  ttsFirstAudioTime: number;
  /** Total words transcribed */
  wordsTranscribed: number;
  /** Total response words */
  responseWords: number;
}

/**
 * Voice Pipeline
 * Complete voice interaction orchestrator
 */
export class VoicePipeline extends EventEmitter {
  private config: Required<VoicePipelineConfig>;

  // Components
  private audioPipeline: AudioPipeline | null = null;
  private sttManager: STTManager | null = null;
  private llmManager: LLMManager | null = null;
  private tts: ElevenLabsTTS | null = null;

  // State
  private isRunning = false;
  private currentState: VoicePipelineState = 'idle';
  private conversationContext: ConversationContext | null = null;

  // Current interaction tracking
  private currentTranscript = '';
  private currentResponse = '';
  private ttsBuffer = '';
  private interactionStartTime = 0;
  private metrics: Partial<InteractionMetrics> = {};

  constructor(config?: Partial<VoicePipelineConfig>) {
    super();
    this.config = { ...DEFAULT_VOICE_PIPELINE_CONFIG, ...config } as Required<VoicePipelineConfig>;

    logger.info('VoicePipeline created', {
      streamToTTS: this.config.streamToTTS,
      enableHistory: this.config.enableHistory,
    });
  }

  /**
   * Get current state
   */
  get state(): VoicePipelineState {
    return this.currentState;
  }

  /**
   * Get full status
   */
  getStatus(): VoicePipelineStatus & {
    sttProvider: STTProviderType | null;
    llmProvider: LLMProviderType | null;
    isTTSSpeaking: boolean;
    currentTranscript: string;
    currentResponse: string;
  } {
    return {
      state: this.currentState,
      isListening: this.currentState === 'listening',
      isSpeaking: this.currentState === 'speaking',
      audioLevel: 0, // Updated via events
      sttProvider: this.sttManager?.getActiveProviderType() ?? null,
      llmProvider: this.llmManager?.getActiveProviderType() ?? null,
      isTTSSpeaking: this.tts?.isSpeaking() ?? false,
      currentTranscript: this.currentTranscript,
      currentResponse: this.currentResponse,
    };
  }

  /**
   * Check if pipeline is running
   */
  get running(): boolean {
    return this.isRunning;
  }

  /**
   * Set state and emit event
   */
  private setState(newState: VoicePipelineState): void {
    if (this.currentState === newState) return;

    const previousState = this.currentState;
    this.currentState = newState;

    logger.info('Voice pipeline state changed', { from: previousState, to: newState });
    this.emit('state-change', newState, previousState);
  }

  /**
   * Initialize all components
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Voice pipeline already running');
      return;
    }

    try {
      logger.info('Starting voice pipeline...');
      perfTimer.start('startup');

      const appConfig = getConfig();

      // Initialize Audio Pipeline (Wake Word + VAD)
      this.audioPipeline = getAudioPipeline();
      this.audioPipeline.updateConfig(this.config.audio);
      this.setupAudioPipelineHandlers();

      // Initialize STT Manager
      this.sttManager = new STTManager({
        ...this.config.stt,
        deepgram: {
          apiKey: appConfig.deepgramApiKey,
          ...this.config.stt?.deepgram,
        },
      });
      this.setupSTTHandlers();

      // Initialize LLM Manager
      this.llmManager = new LLMManager({
        ...this.config.llm,
        fireworks: {
          apiKey: appConfig.fireworksApiKey,
          ...this.config.llm?.fireworks,
        },
        openrouter: {
          apiKey: appConfig.openrouterApiKey,
          ...this.config.llm?.openrouter,
        },
      });
      this.setupLLMHandlers();

      // Initialize TTS
      if (appConfig.elevenlabsApiKey) {
        this.tts = new ElevenLabsTTS({
          apiKey: appConfig.elevenlabsApiKey,
          voiceId: appConfig.elevenlabsVoiceId,
        });
        this.setupTTSHandlers();
      } else {
        logger.warn('ElevenLabs API key not configured - TTS disabled');
      }

      // Initialize conversation context
      if (this.config.enableHistory) {
        this.conversationContext = createConversationContext(
          NOVA_SYSTEM_PROMPT,
          this.config.userName
        );
      }

      // Connect audio pipeline to STT
      this.audioPipeline.setOnSpeechSegment((segment) => this.handleSpeechSegment(segment));
      this.audioPipeline.setOnBargeIn(() => this.handleBargeIn());

      // Start audio pipeline
      await this.audioPipeline.start();

      this.isRunning = true;
      this.setState('idle');

      const startupTime = perfTimer.end('startup');
      logger.info('Voice pipeline started', { startupTime });
      this.emit('started');
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('Failed to start voice pipeline', { error: err.message });
      this.emit('error', err, 'startup');
      throw err;
    }
  }

  /**
   * Stop the pipeline
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;

    logger.info('Stopping voice pipeline...');

    // Stop TTS
    if (this.tts) {
      this.tts.stop();
      this.tts.removeAllListeners();
      this.tts = null;
    }

    // Stop LLM
    if (this.llmManager) {
      this.llmManager.cancel();
      this.llmManager.removeAllListeners();
      this.llmManager = null;
    }

    // Stop STT
    if (this.sttManager) {
      await this.sttManager.stop();
      this.sttManager.removeAllListeners();
      this.sttManager = null;
    }

    // Stop audio pipeline
    await shutdownAudioPipeline();
    this.audioPipeline = null;

    this.isRunning = false;
    this.setState('idle');

    logger.info('Voice pipeline stopped');
    this.emit('stopped');
  }

  /**
   * Set up audio pipeline event handlers
   */
  private setupAudioPipelineHandlers(): void {
    if (!this.audioPipeline) return;

    this.audioPipeline.on('state-change', (state, _prev) => {
      // Sync state (but we manage our own state machine)
      if (state === 'listening') {
        this.startInteraction();
      }
    });

    this.audioPipeline.on('wake-word', (event) => {
      logger.info('Wake word detected', { keyword: event.keyword });
      this.emit('wake-word', event);
    });

    this.audioPipeline.on('speech-start', () => {
      this.emit('speech-start');
    });

    this.audioPipeline.on('audio-level', (level) => {
      this.emit('audio-level', level);
    });

    this.audioPipeline.on('error', (error) => {
      logger.error('Audio pipeline error', { error: error.message });
      this.emit('error', error, 'audio');
    });

    this.audioPipeline.on('listening-timeout', () => {
      logger.warn('Listening timeout - resetting');
      this.resetInteraction();
    });
  }

  /**
   * Set up STT event handlers
   */
  private setupSTTHandlers(): void {
    if (!this.sttManager) return;

    this.sttManager.on('interim', (result: TranscriptionResult) => {
      this.currentTranscript = result.text;
      this.emit('transcript-interim', result.text);
    });

    this.sttManager.on('final', (result: TranscriptionResult) => {
      this.currentTranscript = result.text;
      this.metrics.sttTime = Date.now() - this.interactionStartTime;
      this.metrics.wordsTranscribed = result.text.split(/\s+/).length;

      logger.info('Final transcription', {
        text: result.text,
        confidence: result.confidence,
        sttTime: this.metrics.sttTime,
      });

      this.emit('transcript-final', result);
      this.emit('speech-end', result.duration || 0);

      // Send to LLM
      this.processWithLLM(result.text);
    });

    this.sttManager.on('error', (error: Error) => {
      logger.error('STT error', { error: error.message });
      this.emit('error', error, 'stt');
    });

    this.sttManager.on('provider-switch', (from, to, reason) => {
      logger.info('STT provider switched', { from, to, reason });
      this.emit('provider-change', 'stt', to);
    });
  }

  /**
   * Set up LLM event handlers
   */
  private setupLLMHandlers(): void {
    if (!this.llmManager) return;

    this.llmManager.on('provider-switch', (from, to, reason) => {
      logger.info('LLM provider switched', { from, to, reason });
      this.emit('provider-change', 'llm', to);
    });

    this.llmManager.on('error', (error: Error) => {
      logger.error('LLM error', { error: error.message });
      this.emit('error', error, 'llm');
    });
  }

  /**
   * Set up TTS event handlers
   */
  private setupTTSHandlers(): void {
    if (!this.tts) return;

    this.tts.on('chunk', (chunk: TTSAudioChunk) => {
      if (!this.metrics.ttsFirstAudioTime && chunk.data.length > 0) {
        this.metrics.ttsFirstAudioTime = Date.now() - this.interactionStartTime;
      }
      this.emit('audio-chunk', chunk);
    });

    this.tts.on('playbackStart', () => {
      this.setState('speaking');
      this.audioPipeline?.startSpeaking();
      this.emit('speaking-start');
    });

    this.tts.on('playbackEnd', () => {
      this.finishSpeaking();
    });

    this.tts.on('synthesized', (result: TTSSynthesisResult) => {
      this.emit('synthesis-complete', result);
    });

    this.tts.on('interrupted', () => {
      logger.info('TTS interrupted');
    });

    this.tts.on('error', (error: Error) => {
      logger.error('TTS error', { error: error.message });
      this.emit('error', error, 'tts');
    });
  }

  /**
   * Handle speech segment from audio pipeline
   */
  private async handleSpeechSegment(segment: SpeechSegment): Promise<void> {
    logger.info('Processing speech segment', {
      duration: segment.duration,
      samples: segment.audio.length,
    });

    this.setState('processing');
    perfTimer.start('stt');

    try {
      // Convert Float32Array to Int16Array for STT
      const pcm16 = float32ToInt16(segment.audio);

      // Start STT if not already running
      if (this.sttManager && this.sttManager.status === STTStatus.IDLE) {
        await this.sttManager.start();
      }

      // Send audio to STT
      if (this.sttManager) {
        this.sttManager.sendAudio(pcm16);

        // Signal end of audio
        await this.sttManager.stop();
      }
    } catch (error) {
      perfTimer.end('stt');
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('Speech segment processing failed', { error: err.message });
      this.emit('error', err, 'stt');
      this.resetInteraction();
    }
  }

  /**
   * Process transcribed text with LLM
   */
  private async processWithLLM(text: string): Promise<void> {
    if (!text.trim()) {
      logger.warn('Empty transcription - skipping LLM');
      this.resetInteraction();
      return;
    }

    if (!this.llmManager) {
      logger.error('LLM manager not initialized');
      this.resetInteraction();
      return;
    }

    logger.info('Processing with LLM', { text });
    perfTimer.start('llm');
    this.emit('response-start');

    try {
      this.currentResponse = '';
      this.ttsBuffer = '';
      let firstChunk = true;

      // Stream LLM response
      for await (const chunk of this.llmManager.chatStream(
        text,
        this.conversationContext ?? undefined
      )) {
        if (this.currentState !== 'processing') {
          // Interrupted (barge-in)
          this.llmManager.cancel();
          break;
        }

        if (firstChunk) {
          this.metrics.llmFirstTokenTime = Date.now() - this.interactionStartTime;
          firstChunk = false;
        }

        this.currentResponse = chunk.accumulated;
        this.emit('response-chunk', chunk);

        // Stream to TTS if enabled
        if (this.config.streamToTTS && this.tts) {
          this.ttsBuffer += chunk.delta;

          // Send to TTS when we have enough text (sentence boundary)
          if (this.shouldFlushTTSBuffer(this.ttsBuffer)) {
            const textToSpeak = this.ttsBuffer.trim();
            this.ttsBuffer = '';

            if (textToSpeak) {
              this.tts.speak(textToSpeak);
            }
          }
        }

        if (chunk.isFinal) {
          break;
        }
      }

      this.metrics.llmTotalTime = Date.now() - this.interactionStartTime;
      this.metrics.responseWords = this.currentResponse.split(/\s+/).length;

      const llmTime = perfTimer.end('llm');
      logger.info('LLM response complete', {
        responseLength: this.currentResponse.length,
        llmTime,
      });

      // Create response object
      const response: LLMResponse = {
        content: this.currentResponse,
        model: 'stream',
        finishReason: 'stop',
        latency: llmTime,
      };

      this.emit('response-complete', response);

      // Flush remaining TTS buffer
      if (this.tts && this.ttsBuffer.trim()) {
        this.tts.speak(this.ttsBuffer.trim());
        this.ttsBuffer = '';
      }

      // If TTS is disabled, go straight to idle
      if (!this.tts) {
        this.finishInteraction();
      }
    } catch (error) {
      perfTimer.end('llm');
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('LLM processing failed', { error: err.message });
      this.emit('error', err, 'llm');
      this.resetInteraction();
    }
  }

  /**
   * Check if TTS buffer should be flushed (sentence boundary)
   */
  private shouldFlushTTSBuffer(text: string): boolean {
    if (text.length < this.config.ttsBufferSize) {
      return false;
    }

    // Check for sentence endings
    const sentenceEndings = /[.!?]\s*$/;
    return sentenceEndings.test(text);
  }

  /**
   * Handle barge-in (user interrupts TTS)
   */
  private handleBargeIn(): void {
    logger.info('Barge-in detected');

    // Stop TTS
    if (this.tts) {
      this.tts.stop();
    }

    // Cancel LLM if still generating
    if (this.llmManager && this.currentState === 'processing') {
      this.llmManager.cancel();
    }

    this.emit('barge-in');

    // Return to listening state
    this.setState('listening');
    this.startInteraction();
  }

  /**
   * Start a new interaction
   */
  private startInteraction(): void {
    this.interactionStartTime = Date.now();
    this.currentTranscript = '';
    this.currentResponse = '';
    this.ttsBuffer = '';
    this.metrics = {};

    this.setState('listening');
    this.metrics.wakeToSttTime = 0;
  }

  /**
   * Finish speaking and complete interaction
   */
  private finishSpeaking(): void {
    this.audioPipeline?.finishSpeaking();
    this.emit('speaking-end');
    this.finishInteraction();
  }

  /**
   * Complete the interaction
   */
  private finishInteraction(): void {
    this.metrics.totalTime = Date.now() - this.interactionStartTime;

    logger.info('Interaction complete', { metrics: this.metrics });

    this.setState('idle');
  }

  /**
   * Reset interaction (on error or timeout)
   */
  private resetInteraction(): void {
    logger.info('Resetting interaction');

    if (this.tts) {
      this.tts.stop();
    }

    if (this.llmManager) {
      this.llmManager.cancel();
    }

    this.audioPipeline?.cancel();
    this.setState('idle');
  }

  /**
   * Trigger wake manually (push-to-talk)
   */
  triggerWake(): void {
    if (!this.isRunning) {
      logger.warn('Cannot trigger wake - pipeline not running');
      return;
    }

    this.audioPipeline?.triggerWake();
  }

  /**
   * Send text directly to LLM (bypass STT)
   */
  async sendText(text: string): Promise<void> {
    if (!this.isRunning) {
      throw new Error('Voice pipeline not running');
    }

    this.startInteraction();
    this.setState('processing');
    this.currentTranscript = text;

    this.emit('transcript-final', {
      text,
      isFinal: true,
      confidence: 1.0,
    } as TranscriptionResult);

    await this.processWithLLM(text);
  }

  /**
   * Get conversation context
   */
  getConversationContext(): ConversationContext | null {
    return this.conversationContext;
  }

  /**
   * Clear conversation history
   */
  clearHistory(): void {
    if (this.conversationContext) {
      this.conversationContext = createConversationContext(
        NOVA_SYSTEM_PROMPT,
        this.config.userName
      );
      logger.info('Conversation history cleared');
    }
  }

  /**
   * Get last interaction metrics
   */
  getMetrics(): Partial<InteractionMetrics> {
    return { ...this.metrics };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<VoicePipelineConfig>): void {
    this.config = { ...this.config, ...config } as Required<VoicePipelineConfig>;

    if (this.audioPipeline && config.audio) {
      this.audioPipeline.updateConfig(config.audio);
    }

    logger.info('Voice pipeline config updated');
  }

  /**
   * Get current configuration
   */
  getConfig(): VoicePipelineConfig {
    return { ...this.config };
  }

  // Type-safe event emitter methods
  on<K extends keyof VoicePipelineEvents>(event: K, listener: VoicePipelineEvents[K]): this {
    return super.on(event, listener);
  }

  off<K extends keyof VoicePipelineEvents>(event: K, listener: VoicePipelineEvents[K]): this {
    return super.off(event, listener);
  }

  emit<K extends keyof VoicePipelineEvents>(
    event: K,
    ...args: Parameters<VoicePipelineEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }
}

/**
 * Convert Float32Array audio to Int16Array (PCM16)
 * VAD outputs Float32 (-1 to 1), STT expects Int16 (-32768 to 32767)
 */
export function float32ToInt16(float32: Float32Array): Int16Array {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    // Clamp to -1 to 1 range
    const s = Math.max(-1, Math.min(1, float32[i]));
    // Convert to Int16
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return int16;
}

/**
 * Convert Int16Array audio to Float32Array
 */
export function int16ToFloat32(int16: Int16Array): Float32Array {
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / (int16[i] < 0 ? 0x8000 : 0x7fff);
  }
  return float32;
}

/**
 * Convert Buffer to Int16Array
 */
export function bufferToInt16(buffer: Buffer): Int16Array {
  return new Int16Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 2);
}

/**
 * Convert Int16Array to Buffer
 */
export function int16ToBuffer(int16: Int16Array): Buffer {
  return Buffer.from(int16.buffer, int16.byteOffset, int16.byteLength);
}

// Singleton instance
let voicePipeline: VoicePipeline | null = null;

/**
 * Get or create the voice pipeline instance
 */
export function getVoicePipeline(config?: Partial<VoicePipelineConfig>): VoicePipeline {
  if (!voicePipeline) {
    voicePipeline = new VoicePipeline(config);
  }
  return voicePipeline;
}

/**
 * Shutdown the voice pipeline
 */
export async function shutdownVoicePipeline(): Promise<void> {
  if (voicePipeline) {
    await voicePipeline.stop();
    voicePipeline = null;
  }
}

export default VoicePipeline;
