/**
 * Nova TTS - Open Source Text-to-Speech Engine
 * Type definitions for the Nova TTS system
 *
 * Features:
 * - Multiple neural TTS backends (Coqui, XTTS, StyleTTS2, OpenVoice)
 * - Voice cloning with minimal audio samples
 * - Emotion and style control
 * - Real-time streaming synthesis
 * - Local model management
 */

import { EventEmitter } from 'events';

// ============================================================================
// VOICE & MODEL TYPES
// ============================================================================

/**
 * Supported TTS engines
 */
export type NovaTTSEngine =
  | 'coqui'        // Coqui TTS - Open source neural TTS
  | 'xtts'         // XTTS v2 - Voice cloning & multilingual
  | 'styletts2'    // StyleTTS2 - Style transfer TTS
  | 'openvoice'    // OpenVoice - Zero-shot voice cloning
  | 'bark'         // Bark - Suno's generative audio
  | 'tortoise'     // Tortoise TTS - High quality but slow
  | 'piper'        // Piper - Fast local inference
  | 'edge'         // Edge TTS - Microsoft's free API
  | 'vits'         // VITS - Fast neural TTS
  | 'silero';      // Silero TTS - Lightweight models

/**
 * Voice emotion/style presets
 */
export type VoiceEmotion =
  | 'neutral'
  | 'happy'
  | 'sad'
  | 'angry'
  | 'fearful'
  | 'surprised'
  | 'disgusted'
  | 'excited'
  | 'calm'
  | 'serious'
  | 'playful'
  | 'professional'
  | 'warm'
  | 'cold';

/**
 * Speaking style presets
 */
export type SpeakingStyle =
  | 'conversational'
  | 'newscast'
  | 'narration'
  | 'assistant'
  | 'customer-service'
  | 'whispering'
  | 'shouting'
  | 'singing'
  | 'poetry'
  | 'storytelling'
  | 'documentary'
  | 'advertisement';

/**
 * Voice characteristics for fine-grained control
 */
export interface VoiceCharacteristics {
  /** Pitch in Hz (typically 50-500 Hz, 0 = auto) */
  pitchHz: number;
  /** Pitch variation/prosody (0-1) */
  pitchVariation: number;
  /** Speaking rate in words per minute (80-300) */
  speakingRate: number;
  /** Voice energy/intensity (0-1) */
  energy: number;
  /** Voice breathiness (0-1) */
  breathiness: number;
  /** Voice roughness/gravelly quality (0-1) */
  roughness: number;
  /** Voice nasality (0-1) */
  nasality: number;
  /** Voice warmth/resonance (0-1) */
  warmth: number;
}

/**
 * Default voice characteristics
 */
export const DEFAULT_VOICE_CHARACTERISTICS: VoiceCharacteristics = {
  pitchHz: 0, // Auto-detect
  pitchVariation: 0.5,
  speakingRate: 150,
  energy: 0.5,
  breathiness: 0.1,
  roughness: 0.0,
  nasality: 0.2,
  warmth: 0.5,
};

/**
 * Voice model information
 */
export interface NovaTTSVoice {
  /** Unique voice ID */
  id: string;
  /** Display name */
  name: string;
  /** Description */
  description?: string;
  /** Language code (e.g., 'en-US', 'es-ES') */
  language: string;
  /** Gender */
  gender: 'male' | 'female' | 'neutral';
  /** Age category */
  age: 'child' | 'young' | 'adult' | 'senior';
  /** Engine this voice uses */
  engine: NovaTTSEngine;
  /** Voice quality tier */
  quality: 'low' | 'medium' | 'high' | 'ultra';
  /** Sample rate in Hz */
  sampleRate: number;
  /** Whether voice supports emotion control */
  supportsEmotion: boolean;
  /** Whether voice supports style control */
  supportsStyle: boolean;
  /** Whether this is a cloned voice */
  isCloned: boolean;
  /** Path to model file */
  modelPath?: string;
  /** Download URL for model */
  downloadUrl?: string;
  /** Model size in MB */
  sizeInMB: number;
  /** Reference audio for cloning (if applicable) */
  referenceAudio?: string;
  /** Preview audio URL */
  previewUrl?: string;
  /** Tags for searching */
  tags: string[];
  /** Creation timestamp */
  createdAt: number;
}

/**
 * Voice cloning configuration
 */
export interface VoiceCloneConfig {
  /** Name for the cloned voice */
  name: string;
  /** Description */
  description?: string;
  /** Reference audio file paths (supports multiple for better quality) */
  referenceAudioPaths: string[];
  /** Target engine for cloning */
  engine: 'xtts' | 'openvoice' | 'coqui' | 'tortoise';
  /** Language of the reference audio */
  language: string;
  /** Enable speaker embedding extraction */
  extractEmbedding: boolean;
  /** Fine-tune the model on the reference audio */
  fineTune: boolean;
  /** Number of fine-tuning epochs (if fineTune is true) */
  fineTuneEpochs?: number;
}

/**
 * Voice cloning result
 */
export interface VoiceCloneResult {
  /** Success status */
  success: boolean;
  /** Created voice (if successful) */
  voice?: NovaTTSVoice;
  /** Error message (if failed) */
  error?: string;
  /** Quality score (0-1) */
  qualityScore?: number;
  /** Time taken in ms */
  timeTaken: number;
}

// ============================================================================
// SYNTHESIS TYPES
// ============================================================================

/**
 * Text preprocessing options
 */
export interface TextPreprocessing {
  /** Normalize numbers to words */
  normalizeNumbers: boolean;
  /** Expand abbreviations */
  expandAbbreviations: boolean;
  /** Handle URLs/emails */
  handleSpecialTokens: boolean;
  /** Apply text cleaning */
  cleanText: boolean;
  /** Custom pronunciation dictionary */
  pronunciationDict?: Record<string, string>;
  /** SSML support */
  enableSSML: boolean;
}

/**
 * Default text preprocessing
 */
export const DEFAULT_TEXT_PREPROCESSING: TextPreprocessing = {
  normalizeNumbers: true,
  expandAbbreviations: true,
  handleSpecialTokens: true,
  cleanText: true,
  enableSSML: true,
};

/**
 * Audio output configuration
 */
export interface AudioOutputConfig {
  /** Output format */
  format: 'wav' | 'mp3' | 'ogg' | 'flac' | 'pcm';
  /** Sample rate (overrides voice default) */
  sampleRate?: number;
  /** Bit depth for PCM */
  bitDepth?: 16 | 24 | 32;
  /** MP3 bitrate (if format is mp3) */
  mp3Bitrate?: 64 | 128 | 192 | 256 | 320;
  /** Enable audio normalization */
  normalize: boolean;
  /** Target loudness in LUFS (if normalize is true) */
  targetLoudness?: number;
  /** Apply de-essing */
  deEss: boolean;
  /** Apply compression */
  compress: boolean;
  /** Remove silence at start/end */
  trimSilence: boolean;
}

/**
 * Default audio output config
 */
export const DEFAULT_AUDIO_OUTPUT_CONFIG: AudioOutputConfig = {
  format: 'pcm',
  bitDepth: 16,
  normalize: true,
  targetLoudness: -16,
  deEss: false,
  compress: false,
  trimSilence: true,
};

/**
 * Synthesis request options
 */
export interface SynthesisOptions {
  /** Voice ID to use */
  voiceId: string;
  /** Emotion preset */
  emotion?: VoiceEmotion;
  /** Speaking style */
  style?: SpeakingStyle;
  /** Custom voice characteristics */
  characteristics?: Partial<VoiceCharacteristics>;
  /** Text preprocessing options */
  preprocessing?: Partial<TextPreprocessing>;
  /** Audio output configuration */
  output?: Partial<AudioOutputConfig>;
  /** Enable streaming mode */
  streaming: boolean;
  /** Chunk size in characters for streaming */
  streamChunkSize?: number;
  /** Reference audio for style transfer (optional) */
  styleReferenceAudio?: string;
  /** Seed for reproducibility */
  seed?: number;
  /** Priority (higher = process first) */
  priority?: number;
  /** Timeout in ms */
  timeout?: number;
}

/**
 * Default synthesis options
 */
export const DEFAULT_SYNTHESIS_OPTIONS: Omit<SynthesisOptions, 'voiceId'> = {
  emotion: 'neutral',
  style: 'conversational',
  streaming: true,
  streamChunkSize: 100,
  priority: 0,
  timeout: 30000,
};

/**
 * Audio chunk from streaming synthesis
 */
export interface NovaTTSAudioChunk {
  /** Chunk ID */
  id: string;
  /** Sequence number */
  sequence: number;
  /** Raw audio data */
  data: Buffer;
  /** Audio format */
  format: string;
  /** Sample rate */
  sampleRate: number;
  /** Duration in ms */
  durationMs: number;
  /** Text that was synthesized */
  text: string;
  /** Is this the final chunk */
  isFinal: boolean;
  /** Timestamp when generated */
  timestamp: number;
}

/**
 * Full synthesis result
 */
export interface NovaTTSSynthesisResult {
  /** Unique synthesis ID */
  id: string;
  /** Full audio buffer */
  audio: Buffer;
  /** Audio format details */
  format: {
    type: string;
    sampleRate: number;
    channels: number;
    bitDepth: number;
  };
  /** Total duration in ms */
  durationMs: number;
  /** Character count */
  characterCount: number;
  /** Word count */
  wordCount: number;
  /** Time to first audio in ms */
  latencyMs: number;
  /** Total processing time in ms */
  processingTimeMs: number;
  /** Real-time factor (< 1 means faster than real-time) */
  rtf: number;
  /** Voice used */
  voiceId: string;
  /** Engine used */
  engine: NovaTTSEngine;
  /** Emotion applied */
  emotion?: VoiceEmotion;
  /** Style applied */
  style?: SpeakingStyle;
}

// ============================================================================
// PROVIDER TYPES
// ============================================================================

/**
 * Engine status
 */
export enum NovaTTSEngineStatus {
  UNINITIALIZED = 'uninitialized',
  LOADING = 'loading',
  READY = 'ready',
  BUSY = 'busy',
  ERROR = 'error',
  SHUTDOWN = 'shutdown',
}

/**
 * Model download progress
 */
export interface ModelDownloadProgress {
  /** Voice/model ID */
  voiceId: string;
  /** Total size in bytes */
  totalBytes: number;
  /** Downloaded bytes */
  downloadedBytes: number;
  /** Progress percentage */
  progress: number;
  /** Download speed in bytes/sec */
  speedBps: number;
  /** Estimated time remaining in seconds */
  etaSeconds: number;
  /** Current status */
  status: 'downloading' | 'extracting' | 'verifying' | 'complete' | 'error';
  /** Error message if status is error */
  error?: string;
}

/**
 * Engine information
 */
export interface EngineInfo {
  /** Engine type */
  engine: NovaTTSEngine;
  /** Display name */
  name: string;
  /** Description */
  description: string;
  /** Whether it's available/installed */
  available: boolean;
  /** Current status */
  status: NovaTTSEngineStatus;
  /** Supports streaming */
  supportsStreaming: boolean;
  /** Supports voice cloning */
  supportsCloning: boolean;
  /** Supports emotion control */
  supportsEmotion: boolean;
  /** Supports style transfer */
  supportsStyle: boolean;
  /** Supported languages */
  supportedLanguages: string[];
  /** Requires GPU */
  requiresGpu: boolean;
  /** Current GPU memory usage in MB */
  gpuMemoryMB?: number;
  /** Average latency in ms */
  averageLatencyMs?: number;
  /** Real-time factor */
  averageRtf?: number;
}

/**
 * Nova TTS events
 */
export interface NovaTTSEvents {
  /** Engine status changed */
  'engine-status': (engine: NovaTTSEngine, status: NovaTTSEngineStatus) => void;
  /** Synthesis started */
  'synthesis-start': (id: string, text: string, options: SynthesisOptions) => void;
  /** Audio chunk generated */
  'audio-chunk': (chunk: NovaTTSAudioChunk) => void;
  /** Synthesis completed */
  'synthesis-complete': (result: NovaTTSSynthesisResult) => void;
  /** Synthesis error */
  'synthesis-error': (id: string, error: Error) => void;
  /** Model download progress */
  'download-progress': (progress: ModelDownloadProgress) => void;
  /** Voice cloning progress */
  'clone-progress': (voiceId: string, stage: string, progress: number) => void;
  /** Voice cloning completed */
  'clone-complete': (result: VoiceCloneResult) => void;
  /** Playback started */
  'playback-start': () => void;
  /** Playback ended */
  'playback-end': () => void;
  /** Barge-in detected */
  'interrupted': () => void;
  /** Queue updated */
  'queue-update': (queue: SpeechQueueItem[]) => void;
}

/**
 * Speech queue item
 */
export interface SpeechQueueItem {
  /** Unique ID */
  id: string;
  /** Text to synthesize */
  text: string;
  /** Synthesis options */
  options: SynthesisOptions;
  /** Priority */
  priority: number;
  /** Status */
  status: 'pending' | 'processing' | 'complete' | 'cancelled' | 'error';
  /** Queued timestamp */
  queuedAt: number;
  /** Started timestamp */
  startedAt?: number;
  /** Completed timestamp */
  completedAt?: number;
  /** Error if any */
  error?: string;
}

/**
 * Nova TTS Provider interface
 */
export interface NovaTTSProvider extends EventEmitter {
  /** Provider name */
  readonly name: string;
  /** Current status */
  readonly status: NovaTTSEngineStatus;

  // Initialization
  initialize(): Promise<void>;
  shutdown(): Promise<void>;

  // Voice management
  getVoices(): NovaTTSVoice[];
  getVoice(voiceId: string): NovaTTSVoice | null;
  downloadVoice(voiceId: string): Promise<void>;
  deleteVoice(voiceId: string): Promise<void>;
  isVoiceDownloaded(voiceId: string): boolean;

  // Voice cloning
  cloneVoice(config: VoiceCloneConfig): Promise<VoiceCloneResult>;
  deleteClonedVoice(voiceId: string): Promise<void>;

  // Synthesis
  synthesize(text: string, options: SynthesisOptions): Promise<NovaTTSSynthesisResult>;
  synthesizeStream(text: string, options: SynthesisOptions): AsyncGenerator<NovaTTSAudioChunk>;

  // Playback control
  speak(text: string, options?: Partial<SynthesisOptions>): Promise<void>;
  stop(): void;
  pause(): void;
  resume(): void;
  isSpeaking(): boolean;

  // Queue management
  getQueue(): SpeechQueueItem[];
  clearQueue(): void;

  // Engine info
  getEngineInfo(): EngineInfo[];
  setActiveEngine(engine: NovaTTSEngine): Promise<void>;
  getActiveEngine(): NovaTTSEngine;
}

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Nova TTS configuration
 */
export interface NovaTTSConfig {
  /** Default voice ID */
  defaultVoiceId: string;
  /** Default engine */
  defaultEngine: NovaTTSEngine;
  /** Model storage path */
  modelsPath: string;
  /** Cache path for generated audio */
  cachePath: string;
  /** Enable caching */
  enableCache: boolean;
  /** Max cache size in MB */
  maxCacheSizeMB: number;
  /** GPU device ID (-1 for CPU) */
  gpuDeviceId: number;
  /** Max concurrent synthesis requests */
  maxConcurrent: number;
  /** Enable request queuing */
  enableQueue: boolean;
  /** Max queue size */
  maxQueueSize: number;
  /** Default synthesis options */
  defaultOptions: Omit<SynthesisOptions, 'voiceId'>;
  /** Python executable path (for ML engines) */
  pythonPath?: string;
  /** Enable telemetry */
  enableTelemetry: boolean;
}

/**
 * Default Nova TTS configuration
 */
export const DEFAULT_NOVA_TTS_CONFIG: NovaTTSConfig = {
  defaultVoiceId: 'nova-default',
  defaultEngine: 'piper',
  modelsPath: '',  // Set at runtime
  cachePath: '',   // Set at runtime
  enableCache: true,
  maxCacheSizeMB: 500,
  gpuDeviceId: 0,
  maxConcurrent: 2,
  enableQueue: true,
  maxQueueSize: 100,
  defaultOptions: DEFAULT_SYNTHESIS_OPTIONS,
  enableTelemetry: false,
};
