/**
 * Nova Desktop - TTS Module
 * Text-to-Speech provider exports
 */

// ElevenLabs TTS Provider
export { ElevenLabsTTS, createElevenLabsTTS } from './elevenlabs';
export type { default as ElevenLabsTTSDefault } from './elevenlabs';

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
