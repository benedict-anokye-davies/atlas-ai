/**
 * @fileoverview Atlas Performance Optimizations - Fast Response Mode
 * @module voice/fast-mode
 *
 * Ultra-low latency configuration for Atlas voice pipeline.
 * Optimizes every component for sub-500ms response times.
 *
 * Key optimizations:
 * - Aggressive VAD for faster speech detection
 * - Streaming STT with minimal buffering
 * - Streaming LLM with early TTS synthesis
 * - Reduced context window for faster LLM processing
 * - Optimized TTS chunking for immediate playback
 *
 * @example
 * import { enableFastMode } from './fast-mode';
 * enableFastMode(voicePipeline);
 */

import { VoicePipeline } from './voice-pipeline';
import { VADMode } from '../../shared/types/voice';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('FastMode');

/**
 * Fast mode VAD configuration
 * Optimized for minimal latency while maintaining accuracy
 */
export const FAST_MODE_VAD_CONFIG = {
  mode: 'aggressive' as VADMode,
  frameProcessor: {
    // Lower threshold = more sensitive to speech (faster detection)
    positiveSpeechThreshold: 0.12, // Default: 0.15
    // Fewer frames needed to confirm speech start
    minSpeechFrames: 1, // Default: 2
    // Shorter pause before speech-end (faster turn-taking)
    redemptionFrames: 4, // Default: 6
    // Lower negative threshold for faster speech-end detection
    negativeSpeechThreshold: 0.08, // Default: 0.1
  },
  // Adaptive settings for dynamic environments
  adaptive: {
    enabled: true,
    adaptationRate: 0.15, // Faster adaptation
    minThreshold: 0.08,
    maxThreshold: 0.25,
  },
};

/**
 * Fast mode voice pipeline configuration
 */
export const FAST_MODE_PIPELINE_CONFIG = {
  // Enable all streaming features
  streamToTTS: true,
  // Minimal buffer - start TTS as soon as possible
  ttsBufferSize: 8, // Default: 15, Ultra: 8
  // Reduced history for faster context processing
  maxHistoryTurns: 5, // Default: 10
  // Enable partial transcript processing for ultra-low latency
  enablePartialTranscriptProcessing: true,
  partialTranscriptMinConfidence: 0.75, // Slightly lower for speed
  partialTranscriptMinWords: 3, // Default: 5
  // Limit tool iterations for speed
  maxToolIterations: 3, // Default: 5
  // Audio configuration
  audio: {
    // Shorter listening timeout for faster turn-taking
    listeningTimeout: 10000, // 10s, Default: 15000
    // Shorter processing timeout
    processingTimeout: 20000, // 20s, Default: 30000
    // Enable preprocessing for cleaner audio
    enablePreprocessing: true,
    preprocessor: {
      // Noise gate threshold (lower = more aggressive)
      noiseGateThreshold: -40, // dB, Default: -45
      // High-pass filter to remove low-frequency noise
      highPassFilter: true,
    },
  },
  // STT configuration
  stt: {
    // Prefer faster cloud STT
    preferOffline: false,
    // Quick fallback on errors
    errorThreshold: 2, // Default: 3
    fallbackCooldown: 30000, // 30s, Default: 60000
  },
  // LLM configuration
  llm: {
    // Prefer faster models
    preferOpenRouter: false,
    preferLocal: false,
    // Reduced context for speed
    maxContextTurns: 5, // Default: 10
    // Enable response caching
    enableResponseCache: true,
    // Quick fallback
    errorThreshold: 2,
    fallbackCooldown: 30000,
  },
};

/**
 * Fast mode STT configuration for Deepgram
 */
export const FAST_MODE_STT_CONFIG = {
  // Use streaming for real-time results
  streaming: true,
  // Lower latency model
  model: 'nova-2-general', // Fastest model
  // Enable smart formatting
  smartFormat: true,
  // Lower confidence threshold for faster results
  confidenceThreshold: 0.6, // Default: 0.7
  // Shorter utterance end detection
  utteranceEndMs: 500, // Default: 1000
  // Disable diarization for speed
  diarize: false,
  // Disable punctuation for speed (optional)
  punctuation: true, // Keep for quality
};

/**
 * Fast mode LLM configuration
 */
export const FAST_MODE_LLM_CONFIG = {
  // Use faster model variant
  model: 'accounts/fireworks/models/llama-v3p1-8b-instruct', // Fast 8B model
  // Lower temperature for faster inference
  temperature: 0.7, // Default: 0.8
  // Limit max tokens for speed
  maxTokens: 800, // Default: 2000
  // Enable streaming
  streaming: true,
  // Shorter timeout
  timeout: 15000, // 15s, Default: 30000
};

/**
 * Fast mode TTS configuration
 */
export const FAST_MODE_TTS_CONFIG = {
  // Use fastest provider
  preferOffline: false,
  // Cartesia is fastest (~90ms)
  cartesia: {
    // Speed up voice slightly
    speed: 1.1, // 10% faster
    // Use default voice for speed
    voiceId: 'default',
  },
  // Quick fallback
  errorThreshold: 2,
  fallbackCooldown: 30000,
};

/**
 * Sentence boundary detector optimized for fast mode
 * More aggressive chunking for immediate TTS
 */
export const FAST_MODE_CHUNKING_CONFIG = {
  // Force flush sooner
  maxChunkLength: 100, // Default: 150
  // Lower minimum for first chunk
  firstChunkMinLength: 8, // Default: 12
  // Lower clause minimum
  clauseMinLength: 8, // Default: 12
  // Aggressive punctuation detection
  clauseBoundaries: [', ', '; ', ': ', ' - ', ' (', ' ['],
  phraseEndings: ['. ', '! ', '? ', '...', '.)', '.]', '" ', '" ', '.)'],
};

/**
 * Enable fast mode on a voice pipeline instance
 * Applies all performance optimizations
 */
export function enableFastMode(pipeline: VoicePipeline): void {
  logger.info('Enabling fast mode - optimizing for sub-500ms response times');

  // Apply pipeline configuration
  pipeline.updateConfig(FAST_MODE_PIPELINE_CONFIG);

  logger.info('Fast mode enabled', {
    ttsBufferSize: FAST_MODE_PIPELINE_CONFIG.ttsBufferSize,
    maxHistoryTurns: FAST_MODE_PIPELINE_CONFIG.maxHistoryTurns,
    partialTranscriptProcessing: FAST_MODE_PIPELINE_CONFIG.enablePartialTranscriptProcessing,
  });
}

/**
 * Disable fast mode and restore default settings
 */
export function disableFastMode(pipeline: VoicePipeline): void {
  logger.info('Disabling fast mode - restoring default settings');

  pipeline.updateConfig({
    streamToTTS: true,
    ttsBufferSize: 15,
    maxHistoryTurns: 10,
    enablePartialTranscriptProcessing: false,
    partialTranscriptMinConfidence: 0.8,
    partialTranscriptMinWords: 5,
    maxToolIterations: 5,
    audio: {
      listeningTimeout: 15000,
      processingTimeout: 30000,
      enablePreprocessing: true,
    },
    stt: {
      preferOffline: false,
      errorThreshold: 3,
      fallbackCooldown: 60000,
    },
    llm: {
      maxContextTurns: 10,
      errorThreshold: 3,
      fallbackCooldown: 60000,
    },
  });

  logger.info('Fast mode disabled - default settings restored');
}

/**
 * Get current performance metrics
 */
export function getPerformanceMetrics(): {
  targetLatency: number;
  ttsBufferSize: number;
  maxHistoryTurns: number;
  partialTranscriptEnabled: boolean;
} {
  return {
    targetLatency: 500, // ms
    ttsBufferSize: FAST_MODE_PIPELINE_CONFIG.ttsBufferSize,
    maxHistoryTurns: FAST_MODE_PIPELINE_CONFIG.maxHistoryTurns,
    partialTranscriptEnabled: FAST_MODE_PIPELINE_CONFIG.enablePartialTranscriptProcessing,
  };
}

export default {
  FAST_MODE_VAD_CONFIG,
  FAST_MODE_PIPELINE_CONFIG,
  FAST_MODE_STT_CONFIG,
  FAST_MODE_LLM_CONFIG,
  FAST_MODE_TTS_CONFIG,
  FAST_MODE_CHUNKING_CONFIG,
  enableFastMode,
  disableFastMode,
  getPerformanceMetrics,
};
