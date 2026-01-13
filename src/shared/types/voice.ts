/**
 * Nova Voice Pipeline Types
 */

/**
 * Wake word detection events
 */
export interface WakeWordEvent {
  timestamp: number;
  keyword: string;
  confidence: number;
}

/**
 * Wake word detector configuration
 */
export interface WakeWordConfig {
  accessKey: string;
  keywords: BuiltInKeyword[];
  sensitivities?: number[];
  modelPath?: string;
}

/**
 * Built-in Porcupine keywords
 */
export type BuiltInKeyword =
  | 'alexa'
  | 'americano'
  | 'blueberry'
  | 'bumblebee'
  | 'computer'
  | 'grapefruit'
  | 'grasshopper'
  | 'hey google'
  | 'hey siri'
  | 'jarvis'
  | 'ok google'
  | 'picovoice'
  | 'porcupine'
  | 'terminator';

/**
 * Audio input device info
 */
export interface AudioDevice {
  index: number;
  name: string;
  isDefault: boolean;
}

/**
 * Audio input configuration
 */
export interface AudioInputConfig {
  deviceIndex?: number;
  sampleRate: number;
  frameLength: number;
}

/**
 * Voice pipeline states
 */
export type VoicePipelineState =
  | 'idle' // Waiting for wake word
  | 'listening' // Capturing user speech
  | 'processing' // STT/LLM processing
  | 'speaking' // TTS playback
  | 'error'; // Error state

/**
 * Voice pipeline status
 */
export interface VoicePipelineStatus {
  state: VoicePipelineState;
  isListening: boolean;
  isSpeaking: boolean;
  audioLevel: number;
  lastWakeWord?: WakeWordEvent;
  error?: string;
}

/**
 * Voice activity detection event
 */
export interface VADEvent {
  type: 'speech-start' | 'speech-end';
  timestamp: number;
  duration?: number; // Only for speech-end
}

/**
 * Audio chunk for processing
 */
export interface AudioChunk {
  samples: Int16Array;
  timestamp: number;
  sampleRate: number;
}

/**
 * Transcript from STT
 */
export interface Transcript {
  text: string;
  isFinal: boolean;
  confidence: number;
  timestamp: number;
}

/**
 * VAD configuration options
 */
export interface VADConfig {
  /** Speech probability threshold (0-1), default 0.5 */
  threshold?: number;
  /** Minimum speech duration in ms before triggering, default 250 */
  minSpeechDuration?: number;
  /** Silence duration in ms to end speech segment, default 1500 */
  silenceDuration?: number;
  /** Maximum speech duration in ms before forced end, default 30000 */
  maxSpeechDuration?: number;
  /** Sample rate, default 16000 */
  sampleRate?: number;
  /** Frame size in samples, default 512 */
  frameSize?: number;
}

/**
 * Default VAD configuration
 */
export const DEFAULT_VAD_CONFIG: Required<VADConfig> = {
  threshold: 0.5,
  minSpeechDuration: 250,
  silenceDuration: 1500,
  maxSpeechDuration: 30000,
  sampleRate: 16000,
  frameSize: 512,
};

/**
 * Speech segment from VAD
 */
export interface SpeechSegment {
  /** Audio samples for the speech segment */
  audio: Float32Array;
  /** Start timestamp in ms */
  startTime: number;
  /** End timestamp in ms */
  endTime: number;
  /** Duration in ms */
  duration: number;
  /** Whether segment was force-ended due to max duration */
  forcedEnd: boolean;
}

/**
 * VAD status
 */
export interface VADStatus {
  /** Is VAD currently running */
  isRunning: boolean;
  /** Is speech currently detected */
  isSpeaking: boolean;
  /** Current speech probability (0-1) */
  probability: number;
  /** Duration of current speech segment in ms */
  speechDuration: number;
}
