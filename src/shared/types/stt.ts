/**
 * Atlas Desktop - STT Types
 * Speech-to-Text type definitions with multi-language support
 */

import { EventEmitter } from 'events';

/**
 * Supported languages for speech-to-text
 * ISO 639-1 language codes with optional regional variants
 */
export type SupportedLanguage = 'en' | 'es' | 'fr' | 'de' | 'ja' | 'zh';

/**
 * Full language codes with regional variants
 * Maps to provider-specific language codes
 */
export type LanguageCode =
  | 'en-US'
  | 'en-GB'
  | 'en-AU'
  | 'es-ES'
  | 'es-MX'
  | 'es-AR'
  | 'fr-FR'
  | 'fr-CA'
  | 'de-DE'
  | 'de-AT'
  | 'ja-JP'
  | 'zh-CN'
  | 'zh-TW';

/**
 * Language metadata with display names and model info
 */
export interface LanguageInfo {
  /** ISO 639-1 code (e.g., 'en') */
  code: SupportedLanguage;
  /** Full language code with region (e.g., 'en-US') */
  fullCode: LanguageCode;
  /** Display name in English */
  name: string;
  /** Display name in native language */
  nativeName: string;
  /** Deepgram language code */
  deepgramCode: string;
  /** Vosk model name for offline support */
  voskModel: string;
  /** Whether Vosk model is available */
  voskAvailable: boolean;
  /** RTL (right-to-left) language */
  rtl?: boolean;
}

/**
 * Supported languages configuration
 * Maps language codes to their metadata
 */
export const SUPPORTED_LANGUAGES: Record<SupportedLanguage, LanguageInfo> = {
  en: {
    code: 'en',
    fullCode: 'en-US',
    name: 'English',
    nativeName: 'English',
    deepgramCode: 'en-US',
    voskModel: 'vosk-model-small-en-us-0.15',
    voskAvailable: true,
  },
  es: {
    code: 'es',
    fullCode: 'es-ES',
    name: 'Spanish',
    nativeName: 'Espanol',
    deepgramCode: 'es',
    voskModel: 'vosk-model-small-es-0.42',
    voskAvailable: true,
  },
  fr: {
    code: 'fr',
    fullCode: 'fr-FR',
    name: 'French',
    nativeName: 'Francais',
    deepgramCode: 'fr',
    voskModel: 'vosk-model-small-fr-0.22',
    voskAvailable: true,
  },
  de: {
    code: 'de',
    fullCode: 'de-DE',
    name: 'German',
    nativeName: 'Deutsch',
    deepgramCode: 'de',
    voskModel: 'vosk-model-small-de-0.15',
    voskAvailable: true,
  },
  ja: {
    code: 'ja',
    fullCode: 'ja-JP',
    name: 'Japanese',
    nativeName: 'Nihongo',
    deepgramCode: 'ja',
    voskModel: 'vosk-model-small-ja-0.22',
    voskAvailable: true,
  },
  zh: {
    code: 'zh',
    fullCode: 'zh-CN',
    name: 'Chinese',
    nativeName: 'Zhongwen',
    deepgramCode: 'zh-CN',
    voskModel: 'vosk-model-small-cn-0.22',
    voskAvailable: true,
  },
};

/**
 * Language detection result
 */
export interface LanguageDetectionResult {
  /** Detected language code */
  language: SupportedLanguage;
  /** Confidence score (0-1) */
  confidence: number;
  /** Alternative language candidates */
  alternatives?: Array<{
    language: SupportedLanguage;
    confidence: number;
  }>;
}

/**
 * Language preference configuration
 */
export interface LanguagePreference {
  /** Primary language for STT */
  primary: SupportedLanguage;
  /** Enable automatic language detection */
  autoDetect: boolean;
  /** Languages to consider for auto-detection (empty = all) */
  detectLanguages?: SupportedLanguage[];
  /** Minimum confidence for auto-detection switch */
  detectionThreshold?: number;
  /** Store detected language as new primary */
  persistDetection?: boolean;
}

/**
 * Default language preference
 */
export const DEFAULT_LANGUAGE_PREFERENCE: LanguagePreference = {
  primary: 'en',
  autoDetect: false,
  detectLanguages: ['en', 'es', 'fr', 'de', 'ja', 'zh'],
  detectionThreshold: 0.7,
  persistDetection: false,
};

/**
 * Voice command patterns for language switching
 */
export const LANGUAGE_SWITCH_COMMANDS: Record<SupportedLanguage, string[]> = {
  en: ['switch to english', 'speak english', 'english please', 'use english'],
  es: ['cambiar a espanol', 'habla espanol', 'espanol por favor', 'usa espanol'],
  fr: ['passer au francais', 'parle francais', 'francais s\'il vous plait', 'utilise francais'],
  de: ['wechsle zu deutsch', 'sprich deutsch', 'deutsch bitte', 'benutze deutsch'],
  ja: ['nihongo ni shite', 'nihongo de hanashite', 'nihongo onegaishimasu'],
  zh: ['qie huan dao zhong wen', 'shuo zhong wen', 'qing yong zhong wen'],
};

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
