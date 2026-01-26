/**
 * Atlas Desktop - TTS Module
 * Text-to-Speech provider exports
 */

// ElevenLabs TTS Provider
export { ElevenLabsTTS, createElevenLabsTTS } from './elevenlabs';
export type { default as ElevenLabsTTSDefault } from './elevenlabs';

// Cartesia TTS Provider (Premium alternative)
export { CartesiaTTS, getCartesiaTTS } from './cartesia';
export type { CartesiaTTSConfig, CartesiaVoiceSettings } from './cartesia';

// Offline TTS Provider (Piper/espeak)
export {
  OfflineTTS,
  createOfflineTTS,
  PIPER_VOICES,
  DEFAULT_PIPER_VOICE,
} from './offline';
export type { OfflineTTSConfig, PiperVoice } from './offline';

// TTS Manager with fallback
export {
  TTSManager,
  getTTSManager,
  shutdownTTSManager,
} from './manager';
export type { TTSManagerConfig, TTSProviderType, TTSManagerEvents } from './manager';

// ============================================
// Nova TTS - Open Source ElevenLabs Alternative
// ============================================

// Main Provider
export {
  NovaTTS,
  getNovaTTS,
  shutdownNovaTTS,
} from './nova-tts';

// Engines
export {
  PiperEngine,
  EdgeEngine,
  XTTSEngine,
} from './nova-tts';

// Voice Library
export {
  ALL_VOICES as NOVA_ALL_VOICES,
  PIPER_VOICES as NOVA_PIPER_VOICES,
  EDGE_VOICES,
  XTTS_VOICES,
  STYLETTS2_VOICES,
  OPENVOICE_VOICES,
  BARK_VOICES,
  VITS_VOICES,
  SILERO_VOICES,
  NOVA_PREMIUM_VOICES,
  getVoicesByEngine,
  getVoicesByLanguage,
  getVoicesByQuality,
  getRecommendedVoices,
  getCloningCapableVoices,
  getFreeVoices,
  searchVoices,
} from './nova-tts';

// IPC & Preload
export {
  registerNovaTTSHandlers,
  exposeNovaTTSAPI,
  novaTTSAPI,
} from './nova-tts';

// Nova TTS Types
export {
  // Engine types
  NovaTTSEngine,
  NovaTTSEngineStatus,
  
  // Voice types
  NovaTTSVoice,
  VoiceEmotion,
  SpeakingStyle,
  VoiceCharacteristics,
  DEFAULT_VOICE_CHARACTERISTICS,
  
  // Cloning types
  VoiceCloneConfig,
  VoiceCloneResult,
  
  // Synthesis types
  SynthesisOptions,
  DEFAULT_SYNTHESIS_OPTIONS,
  TextPreprocessing,
  DEFAULT_TEXT_PREPROCESSING,
  AudioOutputConfig,
  DEFAULT_AUDIO_OUTPUT_CONFIG,
  NovaTTSAudioChunk,
  NovaTTSSynthesisResult,
  
  // Provider types
  EngineInfo,
  ModelDownloadProgress,
  NovaTTSEvents,
  NovaTTSProvider,
  SpeechQueueItem as NovaSpeechQueueItem,
  
  // Configuration
  NovaTTSConfig,
  DEFAULT_NOVA_TTS_CONFIG,
} from './nova-tts';

// Re-export types from shared
export {
  TTSConfig,
  TTSStatus,
  TTSEvents,
  TTSProvider,
  TTSAudioChunk,
  TTSSynthesisResult,
  SpeechQueueItem,
  DEFAULT_TTS_CONFIG,
  ELEVENLABS_VOICES,
} from '../../shared/types/tts';
