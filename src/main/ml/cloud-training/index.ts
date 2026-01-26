/**
 * Atlas ML - Cloud Training Module
 *
 * Unified interface for ML training across multiple cloud platforms:
 * - Kaggle Kernels (GPU/TPU)
 * - Google Colab (GPU)
 * - Fireworks AI (LLM fine-tuning)
 *
 * @module ml/cloud-training
 */

// Kaggle Integration
export {
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
} from './kaggle-automation';

// Unified Training Orchestrator
export {
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
} from './training-orchestrator';
