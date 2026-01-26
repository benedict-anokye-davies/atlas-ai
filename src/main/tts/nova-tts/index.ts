/**
 * Nova TTS - Main Module Index
 * Open-source text-to-speech system for Nova Desktop
 * 
 * Features:
 * - Multiple neural TTS backends (Piper, Edge, XTTS, StyleTTS2)
 * - Voice cloning with minimal audio samples  
 * - Emotion and style control
 * - Real-time streaming synthesis
 * - Local model management
 * 
 * Usage:
 * ```typescript
 * import { getNovaTTS } from './nova-tts';
 * 
 * const tts = getNovaTTS();
 * await tts.initialize();
 * 
 * // List available voices
 * const voices = tts.getVoices();
 * 
 * // Synthesize speech
 * const result = await tts.synthesize('Hello world', { voiceId: 'nova-atlas' });
 * 
 * // Clone a voice
 * const cloned = await tts.cloneVoice({
 *   name: 'My Voice',
 *   referenceAudioPaths: ['./my-voice-sample.wav'],
 *   engine: 'xtts',
 *   language: 'en-US',
 * });
 * ```
 */

// Main provider
export { NovaTTS, getNovaTTS, shutdownNovaTTS } from './provider';

// Types
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
  SpeechQueueItem,
  
  // Configuration
  NovaTTSConfig,
  DEFAULT_NOVA_TTS_CONFIG,
} from './types';

// Voice library
export {
  ALL_VOICES,
  PIPER_VOICES,
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
} from './voices';

// Individual engines (for advanced usage)
export { PiperEngine, type PiperEngineConfig } from './engines/piper-engine';
export { EdgeEngine, type EdgeEngineConfig } from './engines/edge-engine';
export { XTTSEngine, type XTTSEngineConfig } from './engines/xtts-engine';

// IPC Handlers (for Electron main process)
export { registerNovaTTSHandlers } from './ipc-handlers';

// Preload API (for Electron preload script)
export { exposeNovaTTSAPI, novaTTSAPI } from './preload-api';
