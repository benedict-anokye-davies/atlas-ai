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
