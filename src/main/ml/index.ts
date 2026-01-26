/**
 * ML Module - Main Exports
 * Provides machine learning capabilities for Atlas
 *
 * Phase 10: Speaker ID, Emotion Detection
 * Phase 11: Custom ML Models
 */

// Speaker Identification (T5-201 to T5-205)
export {
  PyannoteBridge,
  getPyannoteBridge,
  type SpeakerResult,
  type DiarizationSegment,
  type VoiceEmbedding,
  type EnrolledSpeaker,
  type PyannoteEvents,
} from './speaker-id';

// Speaker IPC Handlers (T5-205)
export {
  registerSpeakerHandlers,
  cleanupSpeakerHandlers,
  setMainWindowForSpeaker,
} from './speaker-ipc';

// Emotion Detection (T5-207, T5-208)
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
} from './emotion';

// Emotion IPC Handlers (T5-207, T5-208)
export {
  registerEmotionHandlers,
  cleanupEmotionHandlers,
  setMainWindowForEmotion,
} from './emotion-ipc';

// Unknown Voice Handler (T5-209)
export {
  UnknownVoiceHandler,
  getUnknownVoiceHandler,
  cleanupUnknownVoiceHandler,
  type EnrollmentPhrase,
  type UnknownVoiceSessionState,
  type UnknownVoiceSession,
  type UnknownVoiceConfig,
  type UnknownVoiceEvents,
  ENROLLMENT_PHRASES,
  DEFAULT_UNKNOWN_VOICE_CONFIG,
} from './unknown-voice';

// Training Infrastructure (T5-301, T5-302)
export {
  // Data Collector
  TrainingDataCollector,
  getTrainingDataCollector,
  initializeTrainingDataCollector,
  cleanupTrainingDataCollector,
  // Data Labeler
  DataLabeler,
  getDataLabeler,
  initializeDataLabeler,
  cleanupDataLabeler,
  // Types
  type DatasetType,
  type ExportFormat,
  type DatasetStats,
  type ConversationSample,
  type VoiceSample,
  type TradingDataPoint,
  type CollectionConfig,
  type ExportOptions,
  type ExportResult,
  type LabelerConfig,
  type TopicLabel,
  type QualityLabel,
  type SentimentLabel,
  type IntentLabel,
  // Constants
  DEFAULT_COLLECTION_CONFIG,
  DEFAULT_LABELER_CONFIG,
  TOPIC_LABELS,
  QUALITY_LABELS,
  SENTIMENT_LABELS,
  INTENT_LABELS,
} from './training';

// Model Registry (T5-305)
export {
  ModelRegistry,
  getModelRegistry,
  initializeModelRegistry,
  cleanupModelRegistry,
  type ModelType,
  type ModelStatus,
  type ModelMetadata,
  type ModelMetrics,
  type TrainingMetadata,
  type ModelRegistryConfig,
  DEFAULT_REGISTRY_CONFIG,
} from './models';

// Custom Wake Words (T5-303)
export {
  CustomWakeWordTrainer,
  getCustomWakeWordTrainer,
  initializeCustomWakeWordTrainer,
  cleanupCustomWakeWordTrainer,
  type WakeWordSample,
  type WakeWordDataset,
  type WakeWordTrainingConfig,
  type WakeWordTrainerEvents,
  DEFAULT_WAKE_WORD_CONFIG,
} from './wake-word';

// LSTM Trading Predictor (T5-304)
export {
  LSTMPredictor,
  getLSTMPredictor,
  initializeLSTMPredictor,
  cleanupLSTMPredictor,
  type OHLCVData,
  type TechnicalIndicators as TradingIndicators,
  type Prediction,
  type LSTMModelConfig,
  type LSTMPredictorConfig,
  DEFAULT_PREDICTOR_CONFIG,
} from './trading';

// Fine-Tuning & Deployment (T5-306, T5-307, T5-308)
export {
  // Colab Automation
  ColabAutomation,
  getColabAutomation,
  initializeColabAutomation,
  cleanupColabAutomation,
  type TrainingJobStatus,
  type TrainingJobConfig,
  type TrainingJob,
  NOTEBOOK_TEMPLATES,
  DEFAULT_COLAB_CONFIG,
  // DeepSeek Fine-Tuning
  DeepSeekFineTuneManager,
  getDeepSeekFineTuneManager,
  initializeDeepSeekFineTuneManager,
  cleanupDeepSeekFineTuneManager,
  type FineTuneStatus,
  type TrainingMessage,
  type TrainingExample,
  type FineTuneConfig,
  type FineTuneJob,
  BASE_MODELS,
  DEFAULT_FINETUNE_CONFIG,
  // Deployment Pipeline
  DeploymentPipeline,
  getDeploymentPipeline,
  initializeDeploymentPipeline,
  cleanupDeploymentPipeline,
  type DeploymentStage,
  type DeploymentStatus,
  type ValidationResult,
  type DeploymentConfig,
  type Deployment,
  DEFAULT_PIPELINE_CONFIG,
} from './fine-tuning';

// Cloud Training (Kaggle, Colab, Fireworks Orchestration)
export {
  // Kaggle Automation
  KaggleAutomation,
  getKaggleAutomation,
  destroyKaggleAutomation,
  type KaggleJob,
  type KaggleJobStatus,
  type KaggleAccelerator,
  type KaggleKernelConfig,
  type KaggleDatasetConfig,
  type KaggleAutomationConfig,
  DEFAULT_KAGGLE_CONFIG,
  // Training Orchestrator
  TrainingOrchestrator,
  getTrainingOrchestrator,
  destroyTrainingOrchestrator,
  type TrainingPlatform,
  type ModelTrainingType,
  type UnifiedJobStatus,
  type TrainingConfig,
  type UnifiedTrainingJob,
  type OrchestratorConfig,
  DEFAULT_ORCHESTRATOR_CONFIG,
  TRAINING_TEMPLATES,
} from './cloud-training';

// Intent Classification
export {
  IntentClassifier,
  getIntentClassifier,
  destroyIntentClassifier,
  INTENT_LABELS as INTENT_CLASSIFIER_LABELS,
  type IntentLabel as IntentClassifierLabel,
  type IntentClassification,
  type IntentClassifierConfig,
  DEFAULT_CLASSIFIER_CONFIG,
} from './intent';

// System Anomaly Detection
export {
  AnomalyDetector,
  getAnomalyDetector,
  destroyAnomalyDetector,
  type MetricType,
  type SystemMetrics,
  type AnomalySeverity,
  type Anomaly,
  type AnomalyDetectorConfig,
  DEFAULT_DETECTOR_CONFIG,
} from './anomaly';

// ============================================================================
// Advanced ML Features (Phase 2+)
// ============================================================================

// Semantic Caching
export { SemanticCache, getSemanticCache, type CacheEntry, type SemanticCacheConfig } from './semantic-cache';

// Intent Prediction
export { IntentPredictor, getIntentPredictor, type IntentPattern, type PredictedIntent, type IntentPredictorConfig } from './intent-predictor';

// Speculative Execution
export { SpeculativeExecutor, getSpeculativeExecutor, type SpeculativeTask, type SpeculativeResult, type SpeculativeExecutorConfig } from './speculative-executor';

// Speaker Diarization
export { SpeakerDiarization, getSpeakerDiarization, type SpeakerProfile, type DiarizationResult, type SpeakerDiarizationConfig } from './speaker-diarization';

// Voice Embeddings
export { VoiceEmbeddingsExtractor, getVoiceEmbeddingsExtractor, type VoiceEmbeddingsConfig } from './voice-embeddings';

// Conversation Summarization
export { ConversationSummarizer, getConversationSummarizer, type ConversationSummary, type SummarySegment, type ConversationSummarizerConfig } from './conversation-summarizer';

// Behavior Prediction
export { BehaviorPredictor, getBehaviorPredictor, type BehaviorPattern, type ActivityEvent, type BehaviorPrediction, type BehaviorPredictorConfig } from './behavior-predictor';

// Acoustic Scene Classification
export { AcousticSceneClassifier, getAcousticSceneClassifier, type AcousticScene, type AudioEvent, type AcousticSceneClassifierConfig } from './acoustic-scene-classifier';

// Query Autocomplete
export { QueryAutocomplete, getQueryAutocomplete, type AutocompleteSuggestion, type QueryAutocompleteConfig } from './query-autocomplete';

// Code Style Learning
export { CodeStyleLearner, getCodeStyleLearner, type CodeStyleProfile, type StyleAnalysis, type CodeStyleLearnerConfig } from './code-style-learner';

// Advanced Anomaly Detection
export { AnomalyDetector as AdvancedAnomalyDetector, getAnomalyDetector as getAdvancedAnomalyDetector, type AnomalyEvent, type AnomalyDetectorConfig as AdvancedAnomalyDetectorConfig } from './anomaly-detector';

// Knowledge Graph
export { KnowledgeGraph, getKnowledgeGraph, type KnowledgeEntity, type KnowledgeRelation, type KnowledgeGraphConfig } from './knowledge-graph';

// Workflow Learning
export { WorkflowLearner, getWorkflowLearner, type Workflow, type WorkflowStep, type WorkflowExecution, type WorkflowLearnerConfig } from './workflow-learner';

// Smart Scheduling
export { SmartScheduler, getSmartScheduler, type ScheduledTask, type ScheduleSuggestion, type ProductivityPattern, type SmartSchedulerConfig } from './smart-scheduler';

// Document Intelligence
export { DocumentIntelligence, getDocumentIntelligence, type DocumentInsight, type ExtractedEntity, type ExtractedTable, type DocumentIntelligenceConfig } from './document-intelligence';

// Communication Adaptation
export { CommunicationAdapter, getCommunicationAdapter, type CommunicationStyle, type ContextSignal, type AdaptedResponse, type CommunicationAdapterConfig } from './communication-adapter';

// Meeting Intelligence
export { MeetingIntelligence, getMeetingIntelligence, type Meeting, type ActionItem, type Decision, type MeetingAnalysis, type MeetingIntelligenceConfig } from './meeting-intelligence';

// Relationship Tracking
export { RelationshipTracker, getRelationshipTracker, type Contact, type Interaction, type RelationshipMetrics, type RelationshipInsight, type RelationshipTrackerConfig } from './relationship-tracker';

// Resource Optimization
export { ResourceOptimizer, getResourceOptimizer, type SystemMetrics as ResourceSystemMetrics, type OptimizationProfile, type ResourceThreshold, type ResourceOptimizerConfig } from './resource-optimizer';

// Error Prediction
export { ErrorPredictor, getErrorPredictor, type ErrorSignature, type ErrorEvent, type ErrorPrediction, type RootCauseAnalysis, type ErrorPredictorConfig } from './error-predictor';

// Model Optimization
export { ModelOptimizer, getModelOptimizer, type ModelConfig, type ModelState, type InferenceStats, type OptimizationSuggestion, type ModelOptimizerConfig } from './model-optimizer';
