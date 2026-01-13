/**
 * Nova Desktop - TTS Module
 * Text-to-Speech provider exports
 */

// ElevenLabs TTS Provider
export { ElevenLabsTTS, createElevenLabsTTS } from './elevenlabs';
export type { default as ElevenLabsTTSDefault } from './elevenlabs';

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
