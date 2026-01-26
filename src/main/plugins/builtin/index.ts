/**
 * Atlas Desktop - Builtin Plugins Index
 * 
 * Exports all built-in plugins that ship with Atlas.
 * These plugins provide core functionality extensions.
 * 
 * @module plugins/builtin
 */

// STT Plugins
export { WhisperSTT, createWhisperSTT, whisperSTTManifest } from './whisper-stt';
export type { WhisperConfig } from './whisper-stt';

// TTS Plugins
export { ElevenLabsTTSPlugin, createElevenLabsTTS, elevenLabsTTSManifest, VOICE_PRESETS } from './elevenlabs-tts';
export type { ElevenLabsPluginConfig } from './elevenlabs-tts';

/**
 * All builtin plugin manifests
 */
export const BUILTIN_MANIFESTS = [
  { module: './whisper-stt', name: '@atlas/whisper-stt' },
  { module: './elevenlabs-tts', name: '@atlas/elevenlabs-tts' },
];
