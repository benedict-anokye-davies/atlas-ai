/**
 * NovaVoice - Unified Voice Pipeline
 * Ultra-low-latency STT + TTS + VAD orchestration
 * 
 * Target: <500ms end-to-end voice-to-voice latency
 * Architecture: Streaming-first, parallel processing
 */

import { EventEmitter } from 'events';
import { app } from 'electron';
import { createModuleLogger } from '../../utils/logger';
import { sleep } from '../../../shared/utils';
import {
  PipelineConfig,
  PipelineState,
  DEFAULT_PIPELINE_CONFIG,
  NovaVoiceProvider,
  NovaVoiceEvents,
  LatencyMetrics,
  AudioChunk,
  Voice,
  TTSSynthesisOptions,
  TTSSynthesisResult,
  StreamingTranscription,
  DEFAULT_TTS_OPTIONS,
  AUDIO_FORMATS,
  ProcessingMode,
} from './types';
import { SileroVAD, WebRTCVAD, createVAD } from './vad-engine';
import { WhisperTurboEngine, createSTTEngine } from './stt-engine';
import { KokoroTTSEngine, createTTSEngine } from './tts-engine';
import {
  AudioRingBuffer,
  JitterBuffer,
  bufferToFloat32,
  float32ToBuffer,
  toBuffer,
  toFloat32Array,
  calculateRMS,
} from './audio-buffer';

const logger = createModuleLogger('NovaVoice');

/**
 * NovaVoice - Unified Voice Engine
 * Combines STT + TTS + VAD for ultra-low-latency voice interaction
 */
export class NovaVoice extends EventEmitter implements NovaVoiceProvider {
  private config: PipelineConfig;
  
  // Engines
  private vad: SileroVAD | WebRTCVAD | null = null;
  private stt: WhisperTurboEngine | null = null;
  private tts: KokoroTTSEngine | null = null;
  
  // State
  private state: PipelineState = PipelineState.IDLE;
  private isInitialized: boolean = false;
  private isListeningActive: boolean = false;
  
  // Audio buffers
  private inputBuffer: AudioRingBuffer;
  private outputBuffer: JitterBuffer;
  
  // Latency tracking
  private latencyMetrics: LatencyMetrics[] = [];
  private currentMetrics: Partial<LatencyMetrics> = {};
  private maxMetricsHistory: number = 100;
  
  // Turn management
  private speechStartTime: number = 0;
  private lastSpeechEndTime: number = 0;
  private isUserSpeaking: boolean = false;
  private isAssistantSpeaking: boolean = false;
  
  // Audio capture
  private audioInputHandler: ((chunk: AudioChunk) => void) | null = null;
  
  constructor(config?: Partial<PipelineConfig>) {
    super();
    this.config = { ...DEFAULT_PIPELINE_CONFIG, ...config };
    
    // Initialize buffers
    this.inputBuffer = new AudioRingBuffer(
      AUDIO_FORMATS.STT_INPUT.sampleRate * 30 // 30 seconds
    );
    this.outputBuffer = new JitterBuffer(
      this.config.tts.preBufferMs,
      this.config.tts.preBufferMs * 4,
      AUDIO_FORMATS.TTS_OUTPUT.sampleRate
    );
    
    logger.info('NovaVoice created', {
      mode: this.config.mode,
      targetLatency: this.config.targetLatencyMs,
    });
  }
  
  // ============================================
  // Lifecycle
  // ============================================
  
  /**
   * Initialize all engines
   */
  async initialize(): Promise<void> {
    logger.info('Initializing NovaVoice...');
    
    try {
      // Initialize VAD
      this.vad = createVAD(this.config.vad);
      await this.vad.initialize();
      this.setupVADHandlers();
      
      // Initialize STT
      this.stt = createSTTEngine(this.config.stt);
      await this.stt.initialize();
      this.setupSTTHandlers();
      
      // Initialize TTS
      this.tts = createTTSEngine(this.config.tts);
      await this.tts.initialize();
      this.setupTTSHandlers();
      
      this.isInitialized = true;
      this.setState(PipelineState.IDLE);
      
      this.emit('ready');
      logger.info('NovaVoice initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize NovaVoice', { error: (error as Error).message });
      this.emit('error', error as Error);
      throw error;
    }
  }
  
  /**
   * Shutdown all engines
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down NovaVoice...');
    
    this.stopListening();
    
    if (this.vad) {
      await this.vad.shutdown();
      this.vad = null;
    }
    
    if (this.stt) {
      await this.stt.shutdown();
      this.stt = null;
    }
    
    if (this.tts) {
      await this.tts.shutdown();
      this.tts = null;
    }
    
    this.isInitialized = false;
    this.setState(PipelineState.IDLE);
    
    this.emit('shutdown');
    logger.info('NovaVoice shutdown complete');
  }
  
  // ============================================
  // Event Handlers
  // ============================================
  
  private setupVADHandlers(): void {
    if (!this.vad) return;
    
    this.vad.on('speech-start', (timestamp: number) => {
      this.speechStartTime = timestamp;
      this.isUserSpeaking = true;
      
      // Auto-interrupt assistant if configured
      if (this.config.autoInterrupt && this.isAssistantSpeaking) {
        this.stop();
        this.emit('user-interrupt');
      }
      
      this.emit('vad-speech-start');
      this.emit('turn-start', true);
      this.setState(PipelineState.LISTENING);
    });
    
    this.vad.on('speech-end', (timestamp: number, duration: number) => {
      this.lastSpeechEndTime = timestamp;
      this.isUserSpeaking = false;
      
      this.emit('vad-speech-end');
      this.emit('turn-end', true);
      
      // Trigger transcription
      this.processUserSpeech();
    });
    
    this.vad.on('speech-probability', (probability: number) => {
      this.emit('audio-level', probability);
    });
  }
  
  private setupSTTHandlers(): void {
    if (!this.stt) return;
    
    this.stt.on('partial', (text: string) => {
      this.emit('stt-partial', text);
      
      // Track TTFT
      if (!this.currentMetrics.sttTTFT) {
        this.currentMetrics.sttTTFT = Date.now() - this.speechStartTime;
      }
    });
    
    this.stt.on('final', (transcription: StreamingTranscription) => {
      this.currentMetrics.sttTotal = transcription.totalLatency;
      this.emit('stt-final', transcription);
    });
    
    this.stt.on('error', (error: Error) => {
      this.emit('stt-error', error);
    });
  }
  
  private setupTTSHandlers(): void {
    if (!this.tts) return;
    
    this.tts.on('start', (text: string) => {
      this.isAssistantSpeaking = true;
      this.emit('tts-start', text, this.tts!.getCurrentVoice()?.id || 'unknown');
      this.emit('turn-start', false);
      this.setState(PipelineState.SPEAKING);
    });
    
    this.tts.on('chunk', (chunk: AudioChunk) => {
      // Track TTFB
      if (!this.currentMetrics.ttsTTFB) {
        this.currentMetrics.ttsTTFB = Date.now() - (this.currentMetrics.timestamp || Date.now());
      }
      
      this.emit('tts-chunk', chunk);
      this.emit('audio-output', chunk);
    });
    
    this.tts.on('complete', (result: TTSSynthesisResult) => {
      this.currentMetrics.ttsTotal = result.totalLatency;
      this.isAssistantSpeaking = false;
      
      this.emit('tts-complete', result);
      this.emit('turn-end', false);
      
      // Record complete metrics
      this.recordMetrics();
      
      this.setState(PipelineState.IDLE);
    });
    
    this.tts.on('error', (error: Error) => {
      this.isAssistantSpeaking = false;
      this.emit('tts-error', error);
    });
  }
  
  // ============================================
  // State Management
  // ============================================
  
  private setState(newState: PipelineState): void {
    if (this.state !== newState) {
      const prevState = this.state;
      this.state = newState;
      this.emit('state-change', newState, prevState);
    }
  }
  
  getState(): PipelineState {
    return this.state;
  }
  
  getConfig(): PipelineConfig {
    return { ...this.config };
  }
  
  updateConfig(config: Partial<PipelineConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('Config updated', { config: this.config });
  }
  
  /**
   * Alias for updateConfig
   */
  setConfig(config: Partial<PipelineConfig>): void {
    this.updateConfig(config);
  }
  
  // ============================================
  // Voice Activity
  // ============================================
  
  /**
   * Start listening for voice input
   */
  async startListening(): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('NovaVoice not initialized');
    }
    
    this.isListeningActive = true;
    this.setState(PipelineState.LISTENING);
    
    logger.info('Started listening');
  }
  
  /**
   * Stop listening
   */
  stopListening(): void {
    this.isListeningActive = false;
    
    if (this.vad) {
      this.vad.reset();
    }
    
    if (this.stt) {
      this.stt.clearBuffer();
    }
    
    this.inputBuffer.clear();
    
    logger.info('Stopped listening');
  }
  
  /**
   * Check if listening
   */
  isListening(): boolean {
    return this.isListeningActive;
  }
  
  /**
   * Process incoming audio input
   */
  async processAudioInput(chunk: AudioChunk): Promise<void> {
    if (!this.isListeningActive || !this.vad) return;
    
    // Emit for external processing
    this.emit('audio-input', chunk);
    
    // Run VAD - use type-safe conversion
    const vadResult = await this.vad.processFrame(toBuffer(chunk.data));
    
    this.emit('vad-result', vadResult);
    
    // Buffer audio during speech - use type-safe conversion
    if (vadResult.isSpeech || this.isUserSpeaking) {
      const samples = toFloat32Array(chunk.data);
      this.inputBuffer.write(samples);
    }
  }
  
  /**
   * Process accumulated user speech
   */
  private async processUserSpeech(): Promise<void> {
    if (!this.stt || this.inputBuffer.length === 0) return;
    
    this.setState(PipelineState.PROCESSING_STT);
    this.currentMetrics.timestamp = Date.now();
    this.currentMetrics.captureToSTT = Date.now() - this.speechStartTime;
    
    try {
      // Get audio from buffer
      const audio = this.inputBuffer.read(this.inputBuffer.length);
      const audioBuffer = float32ToBuffer(audio);
      
      // Clear buffer for next speech
      this.inputBuffer.clear();
      
      // Transcribe
      const transcription = await this.stt.transcribe(audioBuffer);
      
      this.currentMetrics.sttTotal = transcription.totalLatency;
      this.currentMetrics.sttTTFT = transcription.ttft;
      
      this.emit('stt-final', transcription);
      
      // Return transcription for further processing
      return;
    } catch (error) {
      logger.error('STT processing failed', { error: (error as Error).message });
      this.emit('stt-error', error as Error);
      this.setState(PipelineState.IDLE);
    }
  }
  
  // ============================================
  // Speech-to-Text
  // ============================================
  
  /**
   * Transcribe audio
   */
  async transcribe(audio: Buffer | AudioChunk[]): Promise<StreamingTranscription> {
    if (!this.stt) {
      throw new Error('STT engine not initialized');
    }
    
    return this.stt.transcribe(audio);
  }
  
  /**
   * Streaming transcription
   */
  async *transcribeStream(audioStream: AsyncIterable<AudioChunk>): AsyncIterable<StreamingTranscription> {
    if (!this.stt) {
      throw new Error('STT engine not initialized');
    }
    
    for await (const chunk of audioStream) {
      await this.stt.processChunk(chunk);
      
      // Emit partial results
      // This would need more sophisticated streaming implementation
    }
    
    // Final result
    yield await this.stt.finalize();
  }
  
  // ============================================
  // Text-to-Speech
  // ============================================
  
  /**
   * Synthesize and play speech
   */
  async speak(text: string, options?: Partial<TTSSynthesisOptions>): Promise<TTSSynthesisResult> {
    if (!this.tts) {
      throw new Error('TTS engine not initialized');
    }
    
    this.setState(PipelineState.SYNTHESIZING);
    this.currentMetrics.timestamp = Date.now();
    
    return this.tts.speak(text, options);
  }
  
  /**
   * Streaming speech synthesis
   */
  async *speakStream(text: string, options?: Partial<TTSSynthesisOptions>): AsyncIterable<AudioChunk> {
    if (!this.tts) {
      throw new Error('TTS engine not initialized');
    }
    
    // Start synthesis
    const synthesisPromise = this.tts.speak(text, { ...options, streaming: true });
    
    // Stream chunks via events
    const chunks: AudioChunk[] = [];
    let complete = false;
    
    const chunkHandler = (chunk: AudioChunk) => {
      chunks.push(chunk);
    };
    
    const completeHandler = () => {
      complete = true;
    };
    
    this.tts.on('chunk', chunkHandler);
    this.tts.on('complete', completeHandler);
    
    try {
      while (!complete || chunks.length > 0) {
        if (chunks.length > 0) {
          yield chunks.shift()!;
        } else {
          await sleep(10);
        }
      }
      
      await synthesisPromise;
    } finally {
      this.tts.off('chunk', chunkHandler);
      this.tts.off('complete', completeHandler);
    }
  }
  
  // ============================================
  // Voice Management
  // ============================================
  
  /**
   * Get available voices
   */
  getVoices(): Voice[] {
    return this.tts?.getVoices() || [];
  }
  
  /**
   * Set current voice
   */
  setVoice(voiceId: string): void {
    this.tts?.setVoice(voiceId);
  }
  
  /**
   * Get current voice
   */
  getCurrentVoice(): Voice | null {
    return this.tts?.getCurrentVoice() || null;
  }
  
  // ============================================
  // Playback Control
  // ============================================
  
  /**
   * Stop all playback
   */
  stop(): void {
    this.tts?.stop();
    this.outputBuffer.clear();
    this.isAssistantSpeaking = false;
    this.emit('user-interrupt');
    this.setState(PipelineState.IDLE);
  }
  
  /**
   * Interrupt current operation (stop speaking/listening)
   */
  interrupt(): void {
    this.stop();
    this.isUserSpeaking = false;
    this.inputBuffer.clear();
    logger.debug('Interrupted');
  }
  
  /**
   * Stop speaking (alias for stop)
   */
  stopSpeaking(): void {
    this.stop();
  }
  
  /**
   * Speak SSML - parses SSML tags and applies voice modifications
   */
  async speakSSML(ssml: string, options?: Partial<TTSSynthesisOptions>): Promise<TTSSynthesisResult> {
    // Parse SSML and extract speech commands
    const parsed = this.parseSSML(ssml);
    
    // Apply SSML modifications to synthesis options
    const ssmlOptions: Partial<TTSSynthesisOptions> = {
      ...options,
      ...parsed.voiceOptions,
    };
    
    return this.speak(parsed.text, ssmlOptions);
  }

  /**
   * Parse SSML markup and extract text with voice parameters
   */
  private parseSSML(ssml: string): { text: string; voiceOptions: Partial<TTSSynthesisOptions> } {
    const voiceOptions: Partial<TTSSynthesisOptions> = {};
    let text = ssml;

    // Extract prosody attributes (rate, pitch, volume)
    const prosodyMatch = text.match(/<prosody([^>]*)>([\s\S]*?)<\/prosody>/i);
    if (prosodyMatch) {
      const attrs = prosodyMatch[1];
      const innerText = prosodyMatch[2];
      
      // Parse rate (e.g., rate="slow", rate="fast", rate="+10%")
      const rateMatch = attrs.match(/rate="([^"]+)"/i);
      if (rateMatch) {
        const rateValue = rateMatch[1].toLowerCase();
        if (rateValue === 'x-slow') voiceOptions.rate = 0.5;
        else if (rateValue === 'slow') voiceOptions.rate = 0.75;
        else if (rateValue === 'medium') voiceOptions.rate = 1.0;
        else if (rateValue === 'fast') voiceOptions.rate = 1.25;
        else if (rateValue === 'x-fast') voiceOptions.rate = 1.5;
        else if (rateValue.includes('%')) {
          const percent = parseFloat(rateValue);
          voiceOptions.rate = 1 + percent / 100;
        }
      }

      // Parse pitch (e.g., pitch="high", pitch="+20%")
      const pitchMatch = attrs.match(/pitch="([^"]+)"/i);
      if (pitchMatch) {
        const pitchValue = pitchMatch[1].toLowerCase();
        if (pitchValue === 'x-low') voiceOptions.pitch = -0.5;
        else if (pitchValue === 'low') voiceOptions.pitch = -0.25;
        else if (pitchValue === 'medium') voiceOptions.pitch = 0;
        else if (pitchValue === 'high') voiceOptions.pitch = 0.25;
        else if (pitchValue === 'x-high') voiceOptions.pitch = 0.5;
        else if (pitchValue.includes('%')) {
          const percent = parseFloat(pitchValue);
          voiceOptions.pitch = percent / 100;
        }
      }

      // Parse volume (e.g., volume="soft", volume="+6dB")
      const volumeMatch = attrs.match(/volume="([^"]+)"/i);
      if (volumeMatch) {
        const volumeValue = volumeMatch[1].toLowerCase();
        if (volumeValue === 'silent') voiceOptions.volume = 0;
        else if (volumeValue === 'x-soft') voiceOptions.volume = 0.25;
        else if (volumeValue === 'soft') voiceOptions.volume = 0.5;
        else if (volumeValue === 'medium') voiceOptions.volume = 0.75;
        else if (volumeValue === 'loud') voiceOptions.volume = 1.0;
        else if (volumeValue === 'x-loud') voiceOptions.volume = 1.25;
      }

      text = text.replace(prosodyMatch[0], innerText);
    }

    // Extract voice name
    const voiceMatch = text.match(/<voice\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/voice>/i);
    if (voiceMatch) {
      voiceOptions.voice = voiceMatch[1];
      text = text.replace(voiceMatch[0], voiceMatch[2]);
    }

    // Handle emphasis
    text = text.replace(/<emphasis\s+level="([^"]+)"[^>]*>([\s\S]*?)<\/emphasis>/gi, (_, level, content) => {
      // Add emphasis markers that some TTS engines can interpret
      if (level === 'strong') return `*${content}*`;
      if (level === 'moderate') return content;
      if (level === 'reduced') return content;
      return content;
    });

    // Handle break/pause tags
    text = text.replace(/<break\s+time="(\d+)(ms|s)"[^>]*\/?>/gi, (_, time, unit) => {
      const ms = unit === 's' ? parseInt(time) * 1000 : parseInt(time);
      // Insert pause markers (comma for short, period for longer)
      if (ms < 300) return ', ';
      if (ms < 1000) return '. ';
      return '. . ';
    });
    text = text.replace(/<break\s+strength="([^"]+)"[^>]*\/?>/gi, (_, strength) => {
      if (strength === 'none') return '';
      if (strength === 'x-weak') return ' ';
      if (strength === 'weak') return ', ';
      if (strength === 'medium') return '. ';
      if (strength === 'strong') return '. . ';
      if (strength === 'x-strong') return '. . . ';
      return ' ';
    });

    // Handle say-as (interpret-as)
    text = text.replace(/<say-as\s+interpret-as="([^"]+)"[^>]*>([\s\S]*?)<\/say-as>/gi, (_, type, content) => {
      // Handle different interpret-as types
      switch (type.toLowerCase()) {
        case 'spell-out':
        case 'characters':
          return content.split('').join(' ');
        case 'ordinal':
          return this.numberToOrdinal(content);
        case 'cardinal':
        case 'number':
          return content;
        case 'telephone':
          return content.replace(/(\d)/g, '$1 ');
        case 'date':
          return content;
        case 'time':
          return content;
        default:
          return content;
      }
    });

    // Handle sub (substitution)
    text = text.replace(/<sub\s+alias="([^"]+)"[^>]*>([\s\S]*?)<\/sub>/gi, (_, alias) => alias);

    // Handle audio tag (placeholder - just remove it)
    text = text.replace(/<audio[^>]*>[\s\S]*?<\/audio>/gi, '');
    text = text.replace(/<audio[^>]*\/>/gi, '');

    // Handle phoneme (just extract the content)
    text = text.replace(/<phoneme[^>]*>([\s\S]*?)<\/phoneme>/gi, '$1');

    // Handle lang tag
    text = text.replace(/<lang\s+xml:lang="([^"]+)"[^>]*>([\s\S]*?)<\/lang>/gi, (_, lang, content) => {
      // Could set language option here if needed
      return content;
    });

    // Remove speak tags
    text = text.replace(/<\/?speak[^>]*>/gi, '');

    // Remove any remaining XML tags
    text = text.replace(/<[^>]+>/g, '');

    // Clean up whitespace
    text = text.replace(/\s+/g, ' ').trim();

    return { text, voiceOptions };
  }

  /**
   * Convert number to ordinal string
   */
  private numberToOrdinal(num: string): string {
    const n = parseInt(num, 10);
    if (isNaN(n)) return num;
    
    const suffixes = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (suffixes[(v - 20) % 10] || suffixes[v] || suffixes[0]);
  }
  
  /**
   * Pause playback
   */
  pause(): void {
    // Would need audio output control
    logger.warn('Pause not fully implemented');
  }
  
  /**
   * Resume playback
   */
  resume(): void {
    // Would need audio output control
    logger.warn('Resume not fully implemented');
  }
  
  /**
   * Check if speaking
   */
  isSpeaking(): boolean {
    return this.isAssistantSpeaking;
  }
  
  // ============================================
  // Metrics
  // ============================================
  
  /**
   * Record current metrics
   */
  private recordMetrics(): void {
    const metrics: LatencyMetrics = {
      captureToSTT: this.currentMetrics.captureToSTT || 0,
      sttTTFT: this.currentMetrics.sttTTFT || 0,
      sttTotal: this.currentMetrics.sttTotal || 0,
      vadLatency: this.currentMetrics.vadLatency || 0,
      llmTTFT: this.currentMetrics.llmTTFT || 0,
      llmTotal: this.currentMetrics.llmTotal || 0,
      ttsTTFB: this.currentMetrics.ttsTTFB || 0,
      ttsTotal: this.currentMetrics.ttsTotal || 0,
      audioOutput: this.currentMetrics.audioOutput || 0,
      endToEnd: Date.now() - (this.currentMetrics.timestamp || Date.now()),
      timestamp: Date.now(),
    };
    
    this.latencyMetrics.push(metrics);
    
    // Trim history
    while (this.latencyMetrics.length > this.maxMetricsHistory) {
      this.latencyMetrics.shift();
    }
    
    this.emit('latency-metrics', metrics);
    
    // Reset current metrics
    this.currentMetrics = {};
    
    logger.debug('Metrics recorded', {
      endToEnd: metrics.endToEnd,
      sttTotal: metrics.sttTotal,
      ttsTotal: metrics.ttsTotal,
    });
  }
  
  /**
   * Get latest latency metrics
   */
  getLatencyMetrics(): LatencyMetrics | null {
    return this.latencyMetrics[this.latencyMetrics.length - 1] || null;
  }
  
  /**
   * Get average end-to-end latency
   */
  getAverageLatency(): number {
    if (this.latencyMetrics.length === 0) return 0;
    
    const sum = this.latencyMetrics.reduce((acc, m) => acc + m.endToEnd, 0);
    return sum / this.latencyMetrics.length;
  }
  
  /**
   * Get latency percentiles
   */
  getLatencyPercentiles(): { p50: number; p95: number; p99: number } {
    if (this.latencyMetrics.length === 0) {
      return { p50: 0, p95: 0, p99: 0 };
    }
    
    const sorted = [...this.latencyMetrics].sort((a, b) => a.endToEnd - b.endToEnd);
    
    const p50Index = Math.floor(sorted.length * 0.5);
    const p95Index = Math.floor(sorted.length * 0.95);
    const p99Index = Math.floor(sorted.length * 0.99);
    
    return {
      p50: sorted[p50Index]?.endToEnd || 0,
      p95: sorted[p95Index]?.endToEnd || 0,
      p99: sorted[p99Index]?.endToEnd || 0,
    };
  }
  
  // ============================================
  // Event Emitter Overrides
  // ============================================
  
  on<K extends keyof NovaVoiceEvents>(event: K, listener: NovaVoiceEvents[K]): this {
    return super.on(event, listener as (...args: any[]) => void);
  }
  
  off<K extends keyof NovaVoiceEvents>(event: K, listener: NovaVoiceEvents[K]): this {
    return super.off(event, listener as (...args: any[]) => void);
  }
  
  once<K extends keyof NovaVoiceEvents>(event: K, listener: NovaVoiceEvents[K]): this {
    return super.once(event, listener as (...args: any[]) => void);
  }
}

// ============================================
// Singleton
// ============================================

let novaVoiceInstance: NovaVoice | null = null;

/**
 * Get or create NovaVoice instance
 */
export function getNovaVoice(config?: Partial<PipelineConfig>): NovaVoice {
  if (!novaVoiceInstance) {
    novaVoiceInstance = new NovaVoice(config);
  }
  return novaVoiceInstance;
}

/**
 * Initialize NovaVoice (convenience function)
 */
export async function initializeNovaVoice(config?: Partial<PipelineConfig>): Promise<NovaVoice> {
  const instance = getNovaVoice(config);
  await instance.initialize();
  return instance;
}

/**
 * Shutdown NovaVoice
 */
export async function shutdownNovaVoice(): Promise<void> {
  if (novaVoiceInstance) {
    await novaVoiceInstance.shutdown();
    novaVoiceInstance = null;
  }
}
