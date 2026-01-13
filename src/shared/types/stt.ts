/**
 * Nova Desktop - STT Types
 * Speech-to-Text type definitions
 */

import { EventEmitter } from 'events';

/**
 * Transcription result from STT provider
 */
export interface TranscriptionResult {
  /** The transcribed text */
  text: string;
  /** Whether this is a final result or interim */
  isFinal: boolean;
  /** Confidence score (0-1) */
  confidence: number;
  /** Duration of the audio in milliseconds */
  duration?: number;
  /** Start time of the utterance in milliseconds */
  startTime?: number;
  /** Detected language code (e.g., 'en', 'es') */
  language?: string;
  /** Individual word timings (if available) */
  words?: TranscriptionWord[];
  /** Raw response from the provider */
  raw?: unknown;
}

/**
 * Individual word with timing information
 */
export interface TranscriptionWord {
  word: string;
  start: number;
  end: number;
  confidence: number;
  punctuatedWord?: string;
}

/**
 * STT configuration options
 */
export interface STTConfig {
  /** API key for the STT service */
  apiKey: string;
  /** Model to use (e.g., 'nova-2', 'nova-3') */
  model?: string;
  /** Language code (e.g., 'en-US') */
  language?: string;
  /** Enable punctuation */
  punctuate?: boolean;
  /** Enable profanity filtering */
  profanityFilter?: boolean;
  /** Enable smart formatting (numbers, dates, etc.) */
  smartFormat?: boolean;
  /** Enable interim results */
  interimResults?: boolean;
  /** Sample rate of audio input */
  sampleRate?: number;
  /** Number of audio channels */
  channels?: number;
  /** Encoding format */
  encoding?: 'linear16' | 'mulaw' | 'flac' | 'opus' | 'mp3';
  /** Enable utterance detection */
  utteranceEndMs?: number;
  /** Enable voice activity detection */
  vad?: boolean;
}

/**
 * STT provider status
 */
export enum STTStatus {
  IDLE = 'idle',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  LISTENING = 'listening',
  PROCESSING = 'processing',
  ERROR = 'error',
  CLOSED = 'closed',
}

/**
 * STT events emitted by the provider
 */
export interface STTEvents {
  /** Emitted when status changes */
  status: (status: STTStatus) => void;
  /** Emitted on transcription result (interim or final) */
  transcript: (result: TranscriptionResult) => void;
  /** Emitted on final transcription */
  final: (result: TranscriptionResult) => void;
  /** Emitted on interim transcription */
  interim: (result: TranscriptionResult) => void;
  /** Emitted on error */
  error: (error: Error) => void;
  /** Emitted when connection opens */
  open: () => void;
  /** Emitted when connection closes */
  close: (code?: number, reason?: string) => void;
  /** Emitted when utterance ends (speech stopped) */
  utteranceEnd: () => void;
  /** Emitted when speech is detected */
  speechStarted: () => void;
}

/**
 * Base interface for STT providers
 */
export interface STTProvider extends EventEmitter {
  /** Provider name */
  readonly name: string;
  /** Current status */
  readonly status: STTStatus;
  
  /** Start the STT connection */
  start(): Promise<void>;
  /** Stop the STT connection */
  stop(): Promise<void>;
  /** Send audio data to the provider */
  sendAudio(audioData: Buffer | Int16Array): void;
  /** Check if provider is ready to receive audio */
  isReady(): boolean;
  /** Get provider configuration */
  getConfig(): STTConfig;
  
  // Event emitter methods with proper typing
  on<K extends keyof STTEvents>(event: K, listener: STTEvents[K]): this;
  off<K extends keyof STTEvents>(event: K, listener: STTEvents[K]): this;
  emit<K extends keyof STTEvents>(event: K, ...args: Parameters<STTEvents[K]>): boolean;
}

/**
 * Default STT configuration
 */
export const DEFAULT_STT_CONFIG: Partial<STTConfig> = {
  model: 'nova-2',
  language: 'en-US',
  punctuate: true,
  profanityFilter: false,
  smartFormat: true,
  interimResults: true,
  sampleRate: 16000,
  channels: 1,
  encoding: 'linear16',
  utteranceEndMs: 1000,
  vad: true,
};
