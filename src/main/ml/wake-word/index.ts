/**
 * Atlas ML Wake Word Module - Exports
 *
 * Custom wake word training for Porcupine.
 *
 * @module ml/wake-word
 */

// Custom Wake Word Trainer (T5-303)
export {
  CustomWakeWordTrainer,
  getCustomWakeWordTrainer,
  initializeCustomWakeWordTrainer,
  cleanupCustomWakeWordTrainer,
  // Types
  type WakeWordSample,
  type WakeWordDataset,
  type WakeWordTrainingConfig,
  type WakeWordTrainerEvents,
  // Constants
  DEFAULT_WAKE_WORD_CONFIG,
} from './custom-wake-word';
