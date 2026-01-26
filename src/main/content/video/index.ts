/**
 * Video Module Exports
 * Phase 9: Video content creation and assembly
 */

// Script Generator (T5-103)
export {
  ScriptGenerator,
  getScriptGenerator,
  generateVideoScript,
  generateVideoHooks,
  DEFAULT_STYLES,
} from './script-generator';

// Voiceover Generator (T5-104)
export {
  VoiceoverGenerator,
  getVoiceoverGenerator,
  generateVoiceover,
  generateVoiceoverFromText,
  type VoiceoverConfig,
  type VoiceoverResult,
} from './voiceover';

// Stock Footage Manager (T5-105)
export { StockFootageManager, getStockFootageManager } from './stock-footage';

// Video Assembler (T5-106)
export {
  VideoAssembler,
  getVideoAssembler,
  assembleVideo,
  createVideoWithVoiceover,
  RESOLUTION_PRESETS,
  type AssemblyResult,
  type ProgressCallback,
  type AssemblerConfig,
} from './video-assembler';

// Caption Generator (T5-107)
export {
  CaptionGenerator,
  getCaptionGenerator,
  generateCaptions,
  burnCaptionsIntoVideo,
  CAPTION_STYLE_PRESETS,
  type CaptionEntry,
  type WordTiming,
  type CaptionOptions,
} from './captions';
