/**
 * Emotion Detection Module - Exports
 * T5-207, T5-208: Emotion detection and response adjustment
 */

export {
  EmotionDetector,
  getEmotionDetector,
  cleanupEmotionDetector,
  getEmotionResponseAdjustment,
  type EmotionCategory,
  type EmotionResult,
  type EmotionHistoryEntry,
  type EmotionDetectorConfig,
  type EmotionDetectorEvents,
  type EmotionResponseAdjustment,
  DEFAULT_EMOTION_CONFIG,
} from './hubert';
