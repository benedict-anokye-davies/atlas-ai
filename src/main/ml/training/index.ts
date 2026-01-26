/**
 * Atlas ML Training Module - Exports
 *
 * Training data collection, labeling, and dataset management.
 *
 * @module ml/training
 */

// Types (T5-302)
export {
  // Dataset Types
  type DatasetType,
  type ExportFormat,
  type DatasetStats,
  // Conversation Types
  type ConversationSample,
  type ToolCallRecord,
  type ConversationTrainingRow,
  // Voice Types
  type VoiceSample,
  // Trading Types
  type TradingDataPoint,
  type TechnicalIndicators,
  type TradingTrainingSample,
  // Labeling Types
  type LabelType,
  type LabelingTask,
  // Config Types
  type CollectionConfig,
  type ExportOptions,
  type ExportResult,
  type TrainingDataEvents,
  // Constants
  DEFAULT_COLLECTION_CONFIG,
} from './types';

// Data Collector (T5-301)
export {
  TrainingDataCollector,
  getTrainingDataCollector,
  initializeTrainingDataCollector,
  cleanupTrainingDataCollector,
} from './data-collector';

// Data Labeler (T5-302)
export {
  DataLabeler,
  getDataLabeler,
  initializeDataLabeler,
  cleanupDataLabeler,
  // Config
  type LabelerConfig,
  DEFAULT_LABELER_CONFIG,
  // Labels
  TOPIC_LABELS,
  QUALITY_LABELS,
  SENTIMENT_LABELS,
  INTENT_LABELS,
  type TopicLabel,
  type QualityLabel,
  type SentimentLabel,
  type IntentLabel,
} from './data-labeler';
