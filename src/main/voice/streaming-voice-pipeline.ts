/**
 * Real-time Streaming Voice Pipeline
 * Inspired by RealtimeSTT patterns for ultra-low latency voice interaction
 * 
 * Key features:
 * - Continuous audio capture with VAD-based segmentation
 * - Streaming transcription (words appear as spoken)
 * - Sentence-level early processing
 * - <200ms perceived latency
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('StreamingVoice');

export interface StreamingConfig {
  // VAD settings
  vadSilenceThreshold: number;      // 0.0-1.0, default 0.5
  vadSpeechPadMs: number;           // Padding around speech, default 300ms
  minSpeechDurationMs: number;      // Minimum speech to process, default 100ms
  maxSpeechDurationMs: number;      // Force process after this, default 30000ms
  
  // Streaming settings
  enablePartialResults: boolean;    // Stream partial transcriptions
  sentenceEndPunctuations: string[];// Trigger early processing on these
  earlyProcessingDelay: number;     // Ms to wait after sentence end
  
  // Audio settings
  sampleRate: number;               // 16000 for most STT
  channels: number;                 // 1 for mono
}

export interface TranscriptionChunk {
  text: string;
  isFinal: boolean;
  confidence: number;
  words?: Array<{
    word: string;
    start: number;
    end: number;
    confidence: number;
  }>;
  timestamp: number;
}

type StreamingVoiceEvents = {
  // Audio events
  'vad:speech-start': () => void;
  'vad:speech-end': (durationMs: number) => void;
  
  // Transcription events
  'transcription:partial': (chunk: TranscriptionChunk) => void;
  'transcription:sentence': (text: string) => void;
  'transcription:final': (chunk: TranscriptionChunk) => void;
  
  // Processing events
  'processing:start': (text: string) => void;
  'processing:response': (response: string) => void;
  
  // State events
  'state:change': (state: StreamingVoiceState) => void;
  'error': (error: Error) => void;
};

export type StreamingVoiceState = 
  | 'idle'
  | 'listening'
  | 'transcribing'
  | 'processing'
  | 'responding';

export class StreamingVoicePipeline extends EventEmitter {
  private config: StreamingConfig;
  private state: StreamingVoiceState = 'idle';

  // Audio buffers with size limit to prevent memory leaks
  private static readonly MAX_AUDIO_BUFFER_SIZE = 500; // ~8 seconds at 16kHz
  private audioBuffer: Int16Array[] = [];
  private speechStartTime: number = 0;
  private lastSpeechTime: number = 0;
  
  // Transcription state
  private partialTranscript = '';
  private fullTranscript = '';
  private sentenceBuffer = '';
  
  // Processing state
  private processingPromise: Promise<void> | null = null;
  private earlyProcessingTimeout: NodeJS.Timeout | null = null;

  constructor(config?: Partial<StreamingConfig>) {
    super();
    
    this.config = {
      vadSilenceThreshold: 0.5,
      vadSpeechPadMs: 300,
      minSpeechDurationMs: 100,
      maxSpeechDurationMs: 30000,
      enablePartialResults: true,
      sentenceEndPunctuations: ['.', '!', '?', '。', '！', '？'],
      earlyProcessingDelay: 500,
      sampleRate: 16000,
      channels: 1,
      ...config,
    };
  }

  /**
   * Emit typed events
   */
  emit<K extends keyof StreamingVoiceEvents>(
    event: K,
    ...args: Parameters<StreamingVoiceEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }

  on<K extends keyof StreamingVoiceEvents>(
    event: K,
    listener: StreamingVoiceEvents[K]
  ): this {
    return super.on(event, listener);
  }

  /**
   * Get current state
   */
  getState(): StreamingVoiceState {
    return this.state;
  }

  /**
   * Set state and emit event
   */
  private setState(newState: StreamingVoiceState): void {
    if (this.state !== newState) {
      const oldState = this.state;
      this.state = newState;
      logger.debug('State change', { from: oldState, to: newState });
      this.emit('state:change', newState);
    }
  }

  /**
   * Process incoming audio chunk from microphone
   * Called by audio capture system
   */
  async processAudioChunk(
    audioData: Int16Array,
    vadResult: { isSpeech: boolean; probability: number }
  ): Promise<void> {
    const now = Date.now();

    if (vadResult.isSpeech) {
      // Speech detected
      if (this.state === 'idle') {
        // Start of new utterance
        this.speechStartTime = now;
        this.audioBuffer = [];
        this.partialTranscript = '';
        this.setState('listening');
        this.emit('vad:speech-start');
        logger.debug('Speech started');
      }

      this.lastSpeechTime = now;

      // Add to buffer with size limit to prevent unbounded memory growth
      if (this.audioBuffer.length >= StreamingVoicePipeline.MAX_AUDIO_BUFFER_SIZE) {
        // Remove oldest chunk when buffer is full
        this.audioBuffer.shift();
        logger.warn('Audio buffer limit reached, dropping oldest chunk');
      }
      this.audioBuffer.push(audioData);

      // Check max duration
      const duration = now - this.speechStartTime;
      if (duration >= this.config.maxSpeechDurationMs) {
        logger.debug('Max speech duration reached, processing');
        await this.processSpeechSegment();
      }

    } else {
      // Silence detected
      if (this.state === 'listening') {
        const silenceDuration = now - this.lastSpeechTime;
        
        if (silenceDuration >= this.config.vadSpeechPadMs) {
          // End of utterance
          const speechDuration = this.lastSpeechTime - this.speechStartTime;
          this.emit('vad:speech-end', speechDuration);
          
          if (speechDuration >= this.config.minSpeechDurationMs) {
            await this.processSpeechSegment();
          } else {
            // Too short - discard
            this.audioBuffer = [];
            this.setState('idle');
          }
        }
      }
    }
  }

  /**
   * Handle partial transcription result (streaming)
   */
  handlePartialTranscription(chunk: TranscriptionChunk): void {
    this.partialTranscript = chunk.text;
    
    if (this.config.enablePartialResults) {
      this.emit('transcription:partial', chunk);
    }

    // Check for sentence boundaries for early processing
    const text = chunk.text.trim();
    if (text.length > 0) {
      const lastChar = text[text.length - 1];
      
      if (this.config.sentenceEndPunctuations.includes(lastChar)) {
        // Found sentence end - schedule early processing
        this.scheduleSentenceProcessing(text);
      }
    }
  }

  /**
   * Handle final transcription result
   */
  handleFinalTranscription(chunk: TranscriptionChunk): void {
    this.fullTranscript = chunk.text;
    this.emit('transcription:final', chunk);
    logger.info('Final transcription', { text: chunk.text.substring(0, 50) });

    // Cancel any pending sentence processing
    if (this.earlyProcessingTimeout) {
      clearTimeout(this.earlyProcessingTimeout);
      this.earlyProcessingTimeout = null;
    }

    // Process the full utterance
    this.processUtterance(chunk.text);
  }

  /**
   * Schedule early processing at sentence boundary
   */
  private scheduleSentenceProcessing(sentence: string): void {
    // Cancel previous timeout
    if (this.earlyProcessingTimeout) {
      clearTimeout(this.earlyProcessingTimeout);
    }

    // Avoid re-processing the same sentence
    if (sentence === this.sentenceBuffer) {
      return;
    }

    this.earlyProcessingTimeout = setTimeout(() => {
      if (this.state === 'transcribing' || this.state === 'listening') {
        // Only emit sentence if it's different from last
        if (sentence !== this.sentenceBuffer) {
          this.sentenceBuffer = sentence;
          this.emit('transcription:sentence', sentence);
          logger.debug('Sentence boundary detected', { sentence: sentence.substring(0, 30) });
        }
      }
    }, this.config.earlyProcessingDelay);
  }

  /**
   * Process speech segment (send to STT)
   */
  private async processSpeechSegment(): Promise<void> {
    if (this.audioBuffer.length === 0) {
      this.setState('idle');
      return;
    }

    this.setState('transcribing');

    // Combine audio chunks
    const totalLength = this.audioBuffer.reduce((sum, buf) => sum + buf.length, 0);
    const combinedAudio = new Int16Array(totalLength);
    let offset = 0;
    for (const chunk of this.audioBuffer) {
      combinedAudio.set(chunk, offset);
      offset += chunk.length;
    }

    this.audioBuffer = [];

    // Convert to buffer for STT
    const audioBytes = Buffer.from(combinedAudio.buffer);

    try {
      // The actual STT call would go here
      // For now, emit a placeholder event
      logger.debug('Audio segment ready for STT', { bytes: audioBytes.length });
      
      // In real implementation:
      // const transcript = await this.sttManager.transcribe(audioBytes);
      // this.handleFinalTranscription(transcript);
      
    } catch (error) {
      logger.error('STT processing failed', error);
      this.emit('error', error as Error);
      this.setState('idle');
    }
  }

  /**
   * Process complete utterance (send to LLM)
   */
  private async processUtterance(text: string): Promise<void> {
    if (!text.trim()) {
      this.setState('idle');
      return;
    }

    this.setState('processing');
    this.emit('processing:start', text);

    try {
      // In real implementation, this would call the LLM
      // const response = await this.llmManager.chat(text);
      // this.emit('processing:response', response.content);
      
      logger.debug('Utterance ready for processing', { text: text.substring(0, 50) });
      
    } catch (error) {
      logger.error('LLM processing failed', error);
      this.emit('error', error as Error);
    } finally {
      this.setState('idle');
    }
  }

  /**
   * Interrupt current processing (for barge-in)
   */
  interrupt(): void {
    logger.debug('Interrupting current processing');
    
    if (this.earlyProcessingTimeout) {
      clearTimeout(this.earlyProcessingTimeout);
      this.earlyProcessingTimeout = null;
    }

    this.audioBuffer = [];
    this.partialTranscript = '';
    this.sentenceBuffer = '';
    this.setState('idle');
  }

  /**
   * Reset pipeline state
   */
  reset(): void {
    this.interrupt();
    this.fullTranscript = '';
    logger.info('Pipeline reset');
  }

  /**
   * Get configuration
   */
  getConfig(): StreamingConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<StreamingConfig>): void {
    this.config = { ...this.config, ...updates };
    logger.info('Config updated', { updates });
  }
}

// Singleton instance
let streamingPipeline: StreamingVoicePipeline | null = null;

export function getStreamingVoicePipeline(): StreamingVoicePipeline {
  if (!streamingPipeline) {
    streamingPipeline = new StreamingVoicePipeline();
  }
  return streamingPipeline;
}
