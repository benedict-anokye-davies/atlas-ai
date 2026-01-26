/**
 * NovaVoice - Module Index
 * Ultra-low-latency unified voice engine
 * 
 * Target: <500ms end-to-end voice-to-voice latency
 * 
 * Features:
 * - Whisper Turbo STT (216x RTF, <100ms first token)
 * - Kokoro/Piper TTS (40-70ms TTFB)
 * - Silero VAD (87.7% TPR, 10-20ms latency)
 * - Streaming-first architecture
 * - Parallel processing pipeline
 * - Automatic voice activity detection
 * - Turn management and interruption
 * - Latency metrics tracking
 * 
 * Usage:
 * ```typescript
 * import { initializeNovaVoice, getNovaVoice } from './nova-voice';
 * 
 * // Initialize
 * const voice = await initializeNovaVoice({
 *   targetLatencyMs: 500,
 *   stt: { model: 'large-v3-turbo' },
 *   tts: { defaultVoiceId: 'kokoro-af' },
 * });
 * 
 * // Start listening
 * await voice.startListening();
 * 
 * // Process audio (from microphone)
 * voice.processAudioInput(audioChunk);
 * 
 * // Listen for transcription
 * voice.on('stt-final', (transcription) => {
 *   console.log('User said:', transcription.final);
 * });
 * 
 * // Speak response
 * await voice.speak('Hello! How can I help you?');
 * 
 * // Get latency metrics
 * const metrics = voice.getLatencyMetrics();
 * console.log('End-to-end latency:', metrics.endToEnd, 'ms');
 * ```
 */

// Main engine
export {
  NovaVoice,
  getNovaVoice,
  initializeNovaVoice,
  shutdownNovaVoice,
} from './nova-voice';

// Types
export {
  // Enums
  STTEngine,
  TTSEngine,
  VADEngine,
  ProcessingMode,
  PipelineState,
  AudioQuality,
  
  // Audio types
  AudioFormat,
  AudioChunk,
  AudioBufferConfig,
  AUDIO_FORMATS,
  DEFAULT_AUDIO_BUFFER_CONFIG,
  
  // VAD types
  VADConfig,
  VADResult,
  DEFAULT_VAD_CONFIG,
  
  // STT types
  STTConfig,
  StreamingTranscription,
  TranscriptionSegment,
  TranscriptionWord,
  DEFAULT_STT_CONFIG,
  
  // TTS types
  TTSConfig,
  TTSSynthesisOptions,
  TTSSynthesisResult,
  Voice,
  Emotion,
  SpeakingStyle,
  DEFAULT_TTS_CONFIG,
  DEFAULT_TTS_OPTIONS,
  
  // Pipeline types
  PipelineConfig,
  LatencyMetrics,
  DEFAULT_PIPELINE_CONFIG,
  
  // Presets
  ULTRA_LOW_LATENCY_PRESET,
  BALANCED_PRESET,
  HIGH_QUALITY_PRESET,
  EDGE_DEVICE_PRESET,
  
  // Events
  NovaVoiceEvents,
  NovaVoiceProvider,
} from './types';

// VAD engine
export {
  SileroVAD,
  WebRTCVAD,
  createVAD,
  type SileroVADConfig,
  DEFAULT_SILERO_CONFIG,
} from './vad-engine';

// STT engine
export {
  WhisperTurboEngine,
  createSTTEngine,
  WHISPER_MODELS,
  type WhisperTurboConfig,
  DEFAULT_WHISPER_CONFIG,
} from './stt-engine';

// TTS engine
export {
  KokoroTTSEngine,
  createTTSEngine,
  KOKORO_VOICES,
  PIPER_VOICES,
  type KokoroTTSConfig,
  DEFAULT_KOKORO_CONFIG,
} from './tts-engine';

// Audio utilities
export {
  AudioRingBuffer,
  ChunkedAudioBuffer,
  SlidingWindowBuffer,
  JitterBuffer,
  AudioResampler,
  calculateRMS,
  calculatePeak,
  dbToLinear,
  linearToDb,
  applyGain,
  mixAudio,
  float32ToInt16,
  int16ToFloat32,
  bufferToFloat32,
  float32ToBuffer,
  toFloat32Array,
  toBuffer,
  isBuffer,
  isFloat32Array,
} from './audio-buffer';

// ============================================
// Extended Features (50+ Improvements)
// ============================================

// Audio Enhancement Pipeline
export {
  NoiseSuppressionProcessor,
  AcousticEchoCanceller,
  AutomaticGainControl,
  AdaptiveVAD,
  AudioEnhancementPipeline,
  type AudioEnhancementConfig as EnhancementConfig,
  DEFAULT_ENHANCEMENT_CONFIG,
} from './audio-enhancement';

// Emotion & Prosody Control
export {
  EmotionController,
  TextEmotionParser,
  Emotion as EmotionType,
  SpeakingStyle as SpeakingStyleType,
  type ProsodyParams,
  EMOTION_PROSODY_MAP,
  STYLE_PROSODY_MAP,
} from './emotion-control';

// Custom Vocabulary & Hotwords
export {
  VocabularyManager,
  TECH_VOCABULARY,
  NOVA_VOCABULARY,
  type HotWord,
  type VocabularySet,
// VocabularyConfig removed - not exported from vocabulary module
} from './vocabulary';

// Latency Monitoring & Dashboard
export {
  LatencyTracker,
  LatencyDashboard,
  // generateAsciiDashboard removed - not exported from module
  type LatencyBreakdown,
  type LatencyStats,
  // LATENCY_TARGETS removed - not exported from module
} from './latency-monitor';

// WebSocket Server
export {
  NovaVoiceWebSocketServer,
  NovaVoiceClient,
  type WebSocketServerConfig,
  type NovaVoiceClientConfig,
  DEFAULT_WS_CONFIG,
  DEFAULT_CLIENT_CONFIG,
} from './websocket-server';

// Plugin System
export {
  PluginManager,
  BasePlugin,
  pluginManager,
  type Plugin,
  type PluginMetadata,
  type PluginType,
  type STTPlugin,
  type TTSPlugin,
  type VADPlugin,
  type AudioProcessorPlugin,
  type PostProcessorPlugin,
  type MiddlewarePlugin,
} from './plugin-system';

// Multi-language Support
export {
  LanguageDetector,
  Translator,
  MultilingualVoiceManager,
  SUPPORTED_LANGUAGES,
  getLanguageCode,
  getLanguageName,
  isRTL,
  type LanguageInfo,
  type LanguageDetectionResult,
  type TranslationResult,
  type MultilingualConfig,
} from './multilingual';

// Intent Classification & NLU
export {
  IntentClassifier,
  VoiceCommandHandler,
  intentClassifier,
  voiceCommandHandler,
  BUILT_IN_INTENTS,
  ENTITY_EXTRACTORS,
  type Intent,
  type IntentPattern,
  type SlotValue,
  type ClassificationResult,
  type Entity,
  type Sentiment,
} from './intent-classifier';

// Voice Cloning
export {
  VoiceCloneManager,
  voiceCloneManager,
  type ClonedVoice,
  type VoiceSample,
  type SampleQuality,
  type CloneProgress,
  type VoiceCloneConfig,
} from './voice-clone';

// Speaker Diarization
export {
  SpeakerDiarizer,
  speakerDiarizer,
  SPEAKER_COLORS,
  type Speaker,
  type SpeakerSegment,
  type DiarizationResult,
  type DiarizationConfig,
} from './speaker-diarization';

// Speculative Decoding & Caching
export {
  SpeculativeDecoder,
  ModelWarmup,
  NgramModel,
  LRUCache,
  speculativeDecoder,
  modelWarmup,
  type Prediction,
  type PredictionContext,
  type SpeculativeConfig,
} from './speculative-decoding';

// Conversation Memory
export {
  ConversationMemoryManager,
  TopicExtractor,
  EntityExtractor,
  SentimentAnalyzer,
  conversationMemory,
  // TOPIC_PATTERNS is locally declared but not exported
  type ConversationMemory,
  type Turn,
  type Topic,
  type UserContext,
  type MemoryConfig,
} from './conversation-memory';

// Wake Word Detection
export {
  WakeWordDetector,
  wakeWordDetector,
  type WakeWordConfig,
  type WakeWordDetection,
  type WakeWordModel,
} from './wake-word';

// Audio Streaming
export {
  AudioInputStream,
  AudioOutputStream,
  AudioTransformStream,
  ResamplerStream,
  ChannelMixerStream,
  AudioPipelineBuilder,
  ChunkedAudioStreamer,
  createPipeline,
  type StreamMetrics,
  type AudioStreamOptions,
} from './audio-streaming';

// Testing Utilities
export {
  AudioGenerator,
  MockSTTEngine,
  MockTTSEngine,
  TestRunner,
  BenchmarkRunner,
  AccuracyCalculator,
  type TestCase,
  type TestResult,
  type BenchmarkResult,
} from './testing-utils';

// =============================================================================
// NEXT-GEN ENGINES (Competitive with ElevenLabs & Deepgram)
// =============================================================================

// Parakeet TDT v2 - Ultra-fast STT (98% accuracy, 3380x RTF)
export {
  ParakeetTDTEngine,
  type ParakeetConfig,
  type UltraFastSTTOptions,
  type TranscriptionResult,
} from './next-gen-engines';

// Kyutai TTS 1.6B - Streaming in TEXT (the key differentiator!)
export {
  KyutaiTTSEngine,
  type KyutaiTTSConfig,
  type StreamingTTSOptions,
  type TTSChunk,
  type WordTimestamp,
} from './next-gen-engines';

// Cartesia Sonic 3 - Sub-90ms latency (State Space Models)
export {
  CartesiaSonicEngine,
  type CartesiaSonicConfig,
} from './next-gen-engines';

// F5-TTS - Zero-shot voice cloning (5-15 second samples)
export {
  F5TTSEngine,
  type F5TTSConfig,
  type VoiceCloningOptions,
  type VoiceEmbedding,
  type VoiceCloneResult,
} from './next-gen-engines';

// Moshi - End-to-end speech LLM (native speech-to-speech)
export {
  MoshiEngine,
  type MoshiConfig,
  type EndToEndSpeechOptions,
  type SpeechResponse,
  type ConversationTurn,
} from './next-gen-engines';

// Unified Next-Gen Pipeline
export {
  NextGenVoicePipeline,
  type NextGenPipelineConfig,
  type ProcessingResult,
  COMPETITIVE_COMPARISON,
} from './next-gen-engines';

// Common types
export {
  type EmotionStyle,
} from './next-gen-engines';

// Fish Audio Integration (1000+ voices, 70+ languages, emotion control)
export {
  FishAudioEngine,
  EMOTION_PRESETS,
  FISH_SUPPORTED_LANGUAGES,
  FISH_VS_ELEVENLABS,
  type FishAudioConfig,
  type FishVoice,
  type EmotionControlParams,
  type FishEmotion,
  type VoiceCloningRequest,
  type AudioSample,
  // AudioFormat already exported from ./types
} from './fish-audio';

// Parakeet Integration (98% accuracy, 3380x RTF, FREE)
export {
  ParakeetSTTEngine,
  PARAKEET_VS_DEEPGRAM,
  // ParakeetConfig already exported from next-gen-engines
  // ParakeetTranscriptionResult, ParakeetSegment, ParakeetWord not exported
} from './parakeet-integration';

// Kyutai Integration (Streaming-in-text, <100ms latency)
export {
  // KyutaiTTSEngine already exported from next-gen-engines
  KYUTAI_VS_ELEVENLABS,
  type KyutaiConfig,
  // KyutaiStreamingOptions, KyutaiVoice, KyutaiSynthesisResult not exported from module
} from './kyutai-integration';

// Cartesia Integration (Sub-90ms latency, SSM architecture)
export {
  // CartesiaSonicEngine already exported from next-gen-engines
  CARTESIA_VS_ELEVENLABS,
  CARTESIA_LANGUAGES,
  type CartesiaConfig,
  type CartesiaVoice,
  type CartesiaSynthesisOptions,
  // CartesiaStreamingOptions not exported from module
} from './cartesia-integration';

// Unified Engine (All engines + cloud fallbacks)
export {
  UnifiedVoiceEngine,
  type UnifiedEngineConfig,
  // UnifiedTranscriptionResult, UnifiedSynthesisResult, EngineSelection not exported
  type VoiceProcessingResult,
} from './unified-engine';

// Optimized Config for 6GB VRAM (RTX 3060, etc.)
export {
  Optimized6GBEngine,
  OPTIMIZED_6GB_CONFIG,
  FASTER_WHISPER_6GB_CONFIG,
  PIPER_6GB_CONFIG,
  WHISPER_MODEL_VRAM,
  RECOMMENDED_PIPER_VOICES,
  YOUR_6GB_SETUP_VS_CLOUD,
  type FasterWhisperConfig,
  type PiperConfig,
  // TranscriptionResult and SynthesisResult already exported or aliased
} from './optimized-6gb-config';

// Hybrid Optimal Engine (Local STT + Cloud TTS - Best of both worlds)
export {
  HybridOptimalEngine,
  ELEVENLABS_VOICES,
  COST_COMPARISON,
  type HybridEngineConfig,
} from './hybrid-optimal-engine';

// Streaming TTS - Speak while LLM is still generating (3x perceived speed)
export {
  StreamingTTSEngine,
  NovaStreamingPipeline,
  ElectronStreamingTTS,
  DEFAULT_STREAMING_CONFIG,
  type StreamingTTSConfig,
  type NovaStreamingPipelineConfig,
} from './streaming-tts';

// Streaming Integration - Ready-to-use with DeepSeek V3 + ElevenLabs
export {
  StreamingConversation,
  StreamingAudioPlayer,
  setupMainProcessStreaming,
  setupRendererProcessStreaming,
  LATENCY_COMPARISON,
} from './streaming-integration';
