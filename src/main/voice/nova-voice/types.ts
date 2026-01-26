/**
 * NovaVoice - Unified Voice Engine Types
 * Ultra-low-latency STT + TTS + VAD for Nova Desktop
 * 
 * Target: <500ms end-to-end voice-to-voice latency
 * Architecture: Streaming-first, parallel processing
 */

// ============================================
// Core Enums
// ============================================

/**
 * Speech-to-Text engine options
 * Ranked by latency (fastest first)
 */
export enum STTEngine {
  // Ultra-fast local (24-100ms first token)
  WHISPER_TURBO = 'whisper-turbo',      // 216x RTF, best balance
  WHISPER_CPP = 'whisper-cpp',          // Vulkan GPU, 12x improvement
  FASTER_WHISPER = 'faster-whisper',    // CTranslate2, 4x speedup
  DISTIL_WHISPER = 'distil-whisper',    // 6.3x faster, English only
  
  // Specialized streaming
  NEMOTRON = 'nemotron',                // <100ms, cache-aware, NVIDIA
  PARAKEET_TDT = 'parakeet-tdt',        // 2728x RTF, ultra-fast
  
  // High accuracy
  CANARY_QWEN = 'canary-qwen',          // 5.63% WER, best accuracy
  
  // Lightweight/Edge
  VOSK = 'vosk',                        // CPU-friendly, offline
  SILERO_STT = 'silero-stt',            // Lightweight
  
  // Cloud (fallback)
  DEEPGRAM = 'deepgram',                // Cloud streaming
  ASSEMBLY_AI = 'assembly-ai',          // Cloud streaming
  GOOGLE_STT = 'google-stt',            // Cloud streaming
}

/**
 * Text-to-Speech engine options
 * Ranked by TTFB (fastest first)
 */
export enum TTSEngine {
  // Ultra-fast local (40-100ms TTFB)
  KOKORO = 'kokoro',                    // 40-70ms, 82M params, best
  PIPER = 'piper',                      // <100ms, proven
  MELO_TTS = 'melo-tts',                // <100ms, consistent
  
  // Fast streaming
  XTTS_V2 = 'xtts-v2',                  // <200ms, voice cloning
  COSYVOICE_2 = 'cosyvoice-2',          // 150ms streaming
  
  // High quality
  STYLETTS2 = 'styletts2',              // High quality, slower
  BARK = 'bark',                        // Expressive, slower
  
  // Cloud (fallback)
  EDGE_TTS = 'edge-tts',                // Free, 200-300ms
  ELEVENLABS = 'elevenlabs',            // 135ms+ TTFB
  RIME_AI = 'rime-ai',                  // <200ms
  CARTESIA = 'cartesia',                // <200ms
}

/**
 * Voice Activity Detection engine options
 */
export enum VADEngine {
  SILERO = 'silero',                    // 87.7% TPR, 10-20ms
  COBRA = 'cobra',                      // 98.9% TPR, proprietary
  WEBRTC = 'webrtc',                    // 50% TPR, ultra-light
  PHOENIX = 'phoenix',                  // Semantic endpoint detection
}

/**
 * Pipeline processing mode
 */
export enum ProcessingMode {
  STREAMING = 'streaming',              // Real-time, lowest latency
  BATCH = 'batch',                      // Higher quality, higher latency
  HYBRID = 'hybrid',                    // Stream with batch refinement
}

/**
 * Voice pipeline state
 */
export enum PipelineState {
  IDLE = 'idle',
  LISTENING = 'listening',
  PROCESSING_STT = 'processing-stt',
  PROCESSING_LLM = 'processing-llm',
  SYNTHESIZING = 'synthesizing',
  SPEAKING = 'speaking',
  ERROR = 'error',
}

/**
 * Audio quality presets
 */
export enum AudioQuality {
  ULTRA_LOW_LATENCY = 'ultra-low-latency',  // Fastest, some quality loss
  BALANCED = 'balanced',                     // Good balance
  HIGH_QUALITY = 'high-quality',             // Best quality, higher latency
}

// ============================================
// Audio Types
// ============================================

/**
 * Audio format specification
 */
export interface AudioFormat {
  sampleRate: number;           // 16000, 22050, 24000, 44100, 48000
  channels: number;             // 1 (mono) or 2 (stereo)
  bitDepth: number;             // 16 or 32
  encoding: 'pcm' | 'float32' | 'mp3' | 'opus' | 'wav';
}

/**
 * Default audio formats
 */
export const AUDIO_FORMATS = {
  STT_INPUT: {
    sampleRate: 16000,
    channels: 1,
    bitDepth: 16,
    encoding: 'pcm',
  } as AudioFormat,
  
  TTS_OUTPUT: {
    sampleRate: 24000,
    channels: 1,
    bitDepth: 16,
    encoding: 'pcm',
  } as AudioFormat,
  
  HIGH_QUALITY: {
    sampleRate: 48000,
    channels: 2,
    bitDepth: 32,
    encoding: 'float32',
  } as AudioFormat,
};

/**
 * Audio chunk for streaming
 */
export interface AudioChunk {
  data: Buffer | Float32Array;
  timestamp: number;
  duration: number;             // ms
  format: AudioFormat;
  isFinal?: boolean;
  metadata?: Record<string, unknown>;
}

/**
 * Audio buffer configuration
 */
export interface AudioBufferConfig {
  /** Buffer size in ms (100-250ms optimal for STT) */
  bufferSizeMs: number;
  /** Overlap between buffers in ms */
  overlapMs: number;
  /** Maximum buffer queue size */
  maxQueueSize: number;
  /** Use lock-free ring buffer */
  useLockFreeBuffer: boolean;
}

export const DEFAULT_AUDIO_BUFFER_CONFIG: AudioBufferConfig = {
  bufferSizeMs: 100,            // Optimal for streaming STT
  overlapMs: 25,
  maxQueueSize: 50,
  useLockFreeBuffer: true,
};

// ============================================
// VAD Types
// ============================================

/**
 * VAD detection result
 */
export interface VADResult {
  /** Is speech detected */
  isSpeech: boolean;
  /** Confidence 0-1 */
  confidence: number;
  /** Start timestamp if speech started */
  speechStart?: number;
  /** End timestamp if speech ended (endpoint detected) */
  speechEnd?: number;
  /** Is this a semantic endpoint (user finished speaking) */
  isEndpoint?: boolean;
  /** Latency of this detection in ms */
  latencyMs: number;
}

/**
 * VAD configuration
 */
export interface VADConfig {
  engine: VADEngine;
  /** Minimum speech duration to trigger (ms) */
  minSpeechDurationMs: number;
  /** Silence duration to detect endpoint (ms) */
  silenceThresholdMs: number;
  /** Speech probability threshold (0-1) */
  speechThreshold: number;
  /** Use semantic endpoint detection if available */
  useSemanticEndpoint: boolean;
  /** Frame size in ms */
  frameSizeMs: number;
}

export const DEFAULT_VAD_CONFIG: VADConfig = {
  engine: VADEngine.SILERO,
  minSpeechDurationMs: 100,
  silenceThresholdMs: 500,
  speechThreshold: 0.5,
  useSemanticEndpoint: true,
  frameSizeMs: 30,
};

// ============================================
// STT Types
// ============================================

/**
 * Transcription segment
 */
export interface TranscriptionSegment {
  text: string;
  start: number;               // Start time in seconds
  end: number;                 // End time in seconds
  confidence: number;          // 0-1
  words?: TranscriptionWord[];
  language?: string;
  isFinal: boolean;
}

/**
 * Word-level transcription
 */
export interface TranscriptionWord {
  word: string;
  start: number;
  end: number;
  confidence: number;
}

/**
 * Streaming transcription result
 */
export interface StreamingTranscription {
  /** Partial (interim) text */
  partial: string;
  /** Final confirmed text */
  final: string;
  /** All segments */
  segments: TranscriptionSegment[];
  /** Time to first token (ms) */
  ttft: number;
  /** Total processing time (ms) */
  totalLatency: number;
  /** Detected language */
  language?: string;
  /** Is transcription complete */
  isComplete: boolean;
}

/**
 * STT configuration
 */
export interface STTConfig {
  engine: STTEngine;
  /** Model variant (e.g., 'large-v3-turbo', 'base', 'small') */
  model: string;
  /** Target language (e.g., 'en', 'auto') */
  language: string;
  /** Enable streaming transcription */
  streaming: boolean;
  /** Enable word-level timestamps */
  wordTimestamps: boolean;
  /** Use GPU acceleration */
  useGPU: boolean;
  /** GPU device ID (-1 for CPU) */
  gpuDevice: number;
  /** Beam size for decoding (1 = greedy, faster) */
  beamSize: number;
  /** Temperature for sampling */
  temperature: number;
  /** VAD filter (pre-filter silence) */
  vadFilter: boolean;
  /** Compute type (float16, int8, etc.) */
  computeType: 'float32' | 'float16' | 'int8' | 'int8_float16';
}

export const DEFAULT_STT_CONFIG: STTConfig = {
  engine: STTEngine.WHISPER_TURBO,
  model: 'large-v3-turbo',
  language: 'en',
  streaming: true,
  wordTimestamps: false,        // Disable for speed
  useGPU: true,
  gpuDevice: 0,
  beamSize: 1,                  // Greedy decoding for speed
  temperature: 0,
  vadFilter: true,
  computeType: 'float16',
};

// ============================================
// TTS Types
// ============================================

/**
 * Voice definition
 */
export interface Voice {
  id: string;
  name: string;
  engine: TTSEngine;
  language: string;
  gender: 'male' | 'female' | 'neutral';
  style?: string;
  description?: string;
  sampleUrl?: string;
  /** Average TTFB for this voice (ms) */
  avgTTFB?: number;
  /** Supports streaming */
  supportsStreaming: boolean;
  /** Supports emotion */
  supportsEmotion: boolean;
  /** Model path for local voices */
  modelPath?: string;
}

/**
 * Emotion for TTS
 */
export type Emotion = 
  | 'neutral'
  | 'happy'
  | 'sad'
  | 'angry'
  | 'excited'
  | 'calm'
  | 'serious'
  | 'playful'
  | 'warm'
  | 'professional'
  | 'empathetic'
  | 'confident'
  | 'curious'
  | 'surprised';

/**
 * Speaking style
 */
export type SpeakingStyle =
  | 'conversational'
  | 'narration'
  | 'newscast'
  | 'assistant'
  | 'storytelling'
  | 'documentary'
  | 'whispering'
  | 'shouting'
  | 'cheerful'
  | 'sad'
  | 'angry'
  | 'fearful';

/**
 * TTS synthesis options
 */
export interface TTSSynthesisOptions {
  voiceId: string;
  text: string;
  /** Emotion to express */
  emotion?: Emotion;
  /** Speaking style */
  style?: SpeakingStyle;
  /** Speed multiplier (0.5-2.0) */
  speed: number;
  /** Pitch adjustment (-1 to 1) */
  pitch: number;
  /** Volume (0-1) */
  volume: number;
  /** Enable streaming synthesis */
  streaming: boolean;
  /** Output audio format */
  outputFormat: AudioFormat;
  /** Sentence-level or word-level streaming */
  streamGranularity: 'sentence' | 'word' | 'chunk';
}

export const DEFAULT_TTS_OPTIONS: Omit<TTSSynthesisOptions, 'voiceId' | 'text'> = {
  speed: 1.0,
  pitch: 0,
  volume: 1.0,
  streaming: true,
  outputFormat: AUDIO_FORMATS.TTS_OUTPUT,
  streamGranularity: 'sentence',
};

/**
 * TTS configuration
 */
export interface TTSConfig {
  engine: TTSEngine;
  /** Default voice ID */
  defaultVoiceId: string;
  /** Model path for local TTS */
  modelPath?: string;
  /** Use GPU acceleration */
  useGPU: boolean;
  /** GPU device ID */
  gpuDevice: number;
  /** Maximum concurrent synthesis */
  maxConcurrent: number;
  /** Audio chunk size for streaming (ms) */
  chunkSizeMs: number;
  /** Pre-buffer duration before playback (ms) */
  preBufferMs: number;
}

export const DEFAULT_TTS_CONFIG: TTSConfig = {
  engine: TTSEngine.KOKORO,
  defaultVoiceId: 'kokoro-en-us-default',
  useGPU: true,
  gpuDevice: 0,
  maxConcurrent: 2,
  chunkSizeMs: 50,
  preBufferMs: 100,
};

/**
 * TTS synthesis result
 */
export interface TTSSynthesisResult {
  audio: Buffer;
  format: AudioFormat;
  duration: number;             // Total duration in ms
  ttfb: number;                 // Time to first byte
  totalLatency: number;         // Total synthesis time
  voiceId: string;
  textLength: number;
}

// ============================================
// Pipeline Types
// ============================================

/**
 * Pipeline latency metrics
 */
export interface LatencyMetrics {
  /** Audio capture to STT start */
  captureToSTT: number;
  /** STT time to first token */
  sttTTFT: number;
  /** STT total time */
  sttTotal: number;
  /** VAD detection time */
  vadLatency: number;
  /** LLM time to first token */
  llmTTFT: number;
  /** LLM total time */
  llmTotal: number;
  /** TTS time to first byte */
  ttsTTFB: number;
  /** TTS total time */
  ttsTotal: number;
  /** Audio output latency */
  audioOutput: number;
  /** End-to-end latency */
  endToEnd: number;
  /** Timestamp */
  timestamp: number;
}

/**
 * Pipeline configuration
 */
export interface PipelineConfig {
  /** Processing mode */
  mode: ProcessingMode;
  /** Audio quality preset */
  quality: AudioQuality;
  /** STT configuration */
  stt: STTConfig;
  /** TTS configuration */
  tts: TTSConfig;
  /** VAD configuration */
  vad: VADConfig;
  /** Audio buffer configuration */
  audioBuffer: AudioBufferConfig;
  /** Target end-to-end latency (ms) */
  targetLatencyMs: number;
  /** Enable speculative execution */
  speculativeExecution: boolean;
  /** Enable parallel processing */
  parallelProcessing: boolean;
  /** Auto-interrupt on user speech */
  autoInterrupt: boolean;
  /** Enable echo cancellation */
  echoCancellation: boolean;
  /** Noise suppression level */
  noiseSuppression: 'off' | 'low' | 'medium' | 'high';
}

export const DEFAULT_PIPELINE_CONFIG: PipelineConfig = {
  mode: ProcessingMode.STREAMING,
  quality: AudioQuality.BALANCED,
  stt: DEFAULT_STT_CONFIG,
  tts: DEFAULT_TTS_CONFIG,
  vad: DEFAULT_VAD_CONFIG,
  audioBuffer: DEFAULT_AUDIO_BUFFER_CONFIG,
  targetLatencyMs: 500,
  speculativeExecution: true,
  parallelProcessing: true,
  autoInterrupt: true,
  echoCancellation: true,
  noiseSuppression: 'medium',
};

// ============================================
// Event Types
// ============================================

/**
 * NovaVoice events
 */
export interface NovaVoiceEvents {
  // Lifecycle
  'ready': () => void;
  'error': (error: Error) => void;
  'shutdown': () => void;
  
  // State changes
  'state-change': (state: PipelineState, prevState: PipelineState) => void;
  
  // VAD events
  'vad-speech-start': () => void;
  'vad-speech-end': () => void;
  'vad-result': (result: VADResult) => void;
  
  // STT events
  'stt-partial': (text: string) => void;
  'stt-final': (transcription: StreamingTranscription) => void;
  'stt-error': (error: Error) => void;
  
  // TTS events
  'tts-start': (text: string, voiceId: string) => void;
  'tts-chunk': (chunk: AudioChunk) => void;
  'tts-complete': (result: TTSSynthesisResult) => void;
  'tts-error': (error: Error) => void;
  
  // Audio events
  'audio-input': (chunk: AudioChunk) => void;
  'audio-output': (chunk: AudioChunk) => void;
  'audio-level': (level: number) => void;
  
  // Latency tracking
  'latency-metrics': (metrics: LatencyMetrics) => void;
  
  // User interaction
  'user-interrupt': () => void;
  'turn-start': (isUser: boolean) => void;
  'turn-end': (isUser: boolean) => void;
}

// ============================================
// Provider Interface
// ============================================

/**
 * NovaVoice provider interface
 */
export interface NovaVoiceProvider {
  // Lifecycle
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  
  // State
  getState(): PipelineState;
  getConfig(): PipelineConfig;
  updateConfig(config: Partial<PipelineConfig>): void;
  
  // Voice activity
  startListening(): Promise<void>;
  stopListening(): void;
  isListening(): boolean;
  
  // Speech-to-Text
  transcribe(audio: Buffer | AudioChunk[]): Promise<StreamingTranscription>;
  transcribeStream(audioStream: AsyncIterable<AudioChunk>): AsyncIterable<StreamingTranscription>;
  
  // Text-to-Speech
  speak(text: string, options?: Partial<TTSSynthesisOptions>): Promise<TTSSynthesisResult>;
  speakStream(text: string, options?: Partial<TTSSynthesisOptions>): AsyncIterable<AudioChunk>;
  
  // Voice management
  getVoices(): Voice[];
  setVoice(voiceId: string): void;
  getCurrentVoice(): Voice | null;
  
  // Playback control
  stop(): void;
  pause(): void;
  resume(): void;
  isSpeaking(): boolean;
  
  // Metrics
  getLatencyMetrics(): LatencyMetrics | null;
  getAverageLatency(): number;
  
  // Events
  on<K extends keyof NovaVoiceEvents>(event: K, listener: NovaVoiceEvents[K]): void;
  off<K extends keyof NovaVoiceEvents>(event: K, listener: NovaVoiceEvents[K]): void;
  once<K extends keyof NovaVoiceEvents>(event: K, listener: NovaVoiceEvents[K]): void;
}

// ============================================
// Presets
// ============================================

/**
 * Ultra-low latency preset (400-600ms target)
 */
export const ULTRA_LOW_LATENCY_PRESET: Partial<PipelineConfig> = {
  mode: ProcessingMode.STREAMING,
  quality: AudioQuality.ULTRA_LOW_LATENCY,
  targetLatencyMs: 400,
  stt: {
    ...DEFAULT_STT_CONFIG,
    engine: STTEngine.WHISPER_TURBO,
    beamSize: 1,
    wordTimestamps: false,
  },
  tts: {
    ...DEFAULT_TTS_CONFIG,
    engine: TTSEngine.KOKORO,
    chunkSizeMs: 30,
    preBufferMs: 50,
  },
  vad: {
    ...DEFAULT_VAD_CONFIG,
    silenceThresholdMs: 400,
    frameSizeMs: 20,
  },
  speculativeExecution: true,
  parallelProcessing: true,
};

/**
 * Balanced preset (500-700ms target)
 */
export const BALANCED_PRESET: Partial<PipelineConfig> = {
  mode: ProcessingMode.STREAMING,
  quality: AudioQuality.BALANCED,
  targetLatencyMs: 500,
  stt: DEFAULT_STT_CONFIG,
  tts: DEFAULT_TTS_CONFIG,
  vad: DEFAULT_VAD_CONFIG,
  speculativeExecution: true,
  parallelProcessing: true,
};

/**
 * High quality preset (700-1000ms target)
 */
export const HIGH_QUALITY_PRESET: Partial<PipelineConfig> = {
  mode: ProcessingMode.HYBRID,
  quality: AudioQuality.HIGH_QUALITY,
  targetLatencyMs: 800,
  stt: {
    ...DEFAULT_STT_CONFIG,
    engine: STTEngine.CANARY_QWEN,
    beamSize: 5,
    wordTimestamps: true,
  },
  tts: {
    ...DEFAULT_TTS_CONFIG,
    engine: TTSEngine.XTTS_V2,
    chunkSizeMs: 100,
    preBufferMs: 200,
  },
  vad: {
    ...DEFAULT_VAD_CONFIG,
    silenceThresholdMs: 700,
    useSemanticEndpoint: true,
  },
  speculativeExecution: false,
  parallelProcessing: true,
};

/**
 * Edge device preset (2-5s latency, minimal resources)
 */
export const EDGE_DEVICE_PRESET: Partial<PipelineConfig> = {
  mode: ProcessingMode.BATCH,
  quality: AudioQuality.BALANCED,
  targetLatencyMs: 2000,
  stt: {
    ...DEFAULT_STT_CONFIG,
    engine: STTEngine.VOSK,
    model: 'small',
    useGPU: false,
    computeType: 'int8',
  },
  tts: {
    ...DEFAULT_TTS_CONFIG,
    engine: TTSEngine.PIPER,
    useGPU: false,
  },
  vad: {
    ...DEFAULT_VAD_CONFIG,
    engine: VADEngine.WEBRTC,
  },
  speculativeExecution: false,
  parallelProcessing: false,
};
