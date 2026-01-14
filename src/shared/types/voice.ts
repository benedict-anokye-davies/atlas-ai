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

/**
 * Extended Voice Pipeline Status (includes STT/LLM/TTS state)
 * Used for the full voice pipeline with AI integration
 */
export interface FullVoicePipelineStatus extends VoicePipelineStatus {
  /** Current STT provider name */
  sttProvider: string | null;
  /** Current LLM provider name */
  llmProvider: string | null;
  /** Whether TTS is currently speaking */
  isTTSSpeaking: boolean;
  /** Current transcript from STT */
  currentTranscript: string;
  /** Current response from LLM */
  currentResponse: string;
}

/**
 * Wake word feedback types for UI visualization
 */
export type WakeWordFeedbackType =
  | 'detected' // Wake word detected and validated
  | 'rejected' // Wake word detected but below confidence threshold
  | 'cooldown' // Wake word detected but in cooldown period
  | 'listening' // Actively listening for wake word
  | 'ready'; // Ready to detect wake word

/**
 * Wake word feedback event sent to UI
 */
export interface WakeWordFeedback {
  type: WakeWordFeedbackType;
  timestamp: number;
  keyword?: string;
  confidence?: number;
  threshold?: number;
  audioLevel?: number;
  message?: string;
}

/**
 * Confidence thresholding configuration for wake word detection
 */
export interface ConfidenceConfig {
  /** Minimum confidence threshold (0-1), detections below this are rejected */
  minThreshold: number;
  /** Require audio level above this to validate detection */
  minAudioLevel: number;
  /** Number of recent audio levels to track for ambient estimation */
  audioHistorySize: number;
  /** Multiplier for ambient noise to set dynamic threshold */
  ambientMultiplier: number;
  /** Enable adaptive thresholding based on ambient noise */
  adaptiveThreshold: boolean;
}

/**
 * Extended wake word event with confidence details
 */
export interface ExtendedWakeWordEvent extends WakeWordEvent {
  /** Raw detection confidence from Porcupine (based on sensitivity) */
  rawConfidence: number;
  /** Computed confidence based on audio analysis */
  computedConfidence: number;
  /** Whether detection passed threshold validation */
  passedThreshold: boolean;
  /** Audio level at time of detection */
  audioLevel: number;
  /** Ambient noise level estimate */
  ambientLevel: number;
}

/**
 * Detection statistics for monitoring wake word performance
 */
export interface DetectionStats {
  totalDetections: number;
  acceptedDetections: number;
  rejectedDetections: number;
  cooldownRejections: number;
  averageConfidence: number;
  lastDetectionTime: number;
  uptime: number;
}

/**
 * Listening state for VAD UI feedback
 */
export type ListeningState =
  | 'idle' // Not listening
  | 'listening' // Actively listening for speech
  | 'hearing' // Speech detected, capturing
  | 'still_listening' // Pause detected, waiting for more
  | 'processing'; // Speech complete, processing

/**
 * Still listening event - emitted when VAD detects a pause but expects more speech
 */
export interface StillListeningEvent {
  timestamp: number;
  pauseDuration: number;
  reason: 'incomplete_sentence' | 'short_pause' | 'thinking_pause';
  extendedTimeout: number;
}

/**
 * Adaptive silence configuration for VAD
 */
export interface AdaptiveSilenceConfig {
  /** Base silence duration (ms) before ending speech */
  baseSilenceMs: number;
  /** Extended silence for incomplete sentences (ms) */
  incompleteSilenceMs: number;
  /** Short pause threshold - pauses shorter trigger "still listening" */
  shortPauseMs: number;
  /** Maximum silence before forced end (ms) */
  maxSilenceMs: number;
  /** Enable sentence ending detection */
  detectSentenceEndings: boolean;
  /** Enable adaptive timeout based on transcript */
  adaptiveTimeout: boolean;
}
