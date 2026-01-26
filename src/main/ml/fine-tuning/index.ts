/**
 * Atlas ML Fine-Tuning Module - Exports
 *
 * Colab automation, DeepSeek fine-tuning, and model deployment.
 *
 * @module ml/fine-tuning
 */

// Colab Automation (T5-306)
export {
  ColabAutomation,
  getColabAutomation,
  initializeColabAutomation,
  cleanupColabAutomation,
  // Types
  type TrainingJobStatus,
  type TrainingJobConfig,
  type TrainingJob,
  type ColabAutomationConfig,
  type ColabAutomationEvents,
  type NotebookTemplate,
  // Constants
  NOTEBOOK_TEMPLATES,
  DEFAULT_COLAB_CONFIG,
} from './colab-automation';

// DeepSeek Fine-Tuning (T5-307)
export {
  DeepSeekFineTuneManager,
  getDeepSeekFineTuneManager,
  initializeDeepSeekFineTuneManager,
  cleanupDeepSeekFineTuneManager,
  // Types
  type FineTuneStatus,
  type TrainingMessage,
  type TrainingExample,
  type FineTuneConfig,
  type FineTuneJob,
  type FineTuneManagerConfig,
  type FineTuneManagerEvents,
  // Constants
  BASE_MODELS,
  DEFAULT_FINETUNE_CONFIG,
} from './deepseek-finetuning';

// Deployment Pipeline (T5-308)
export {
  DeploymentPipeline,
  getDeploymentPipeline,
  initializeDeploymentPipeline,
  cleanupDeploymentPipeline,
  // Types
  type DeploymentStage,
  type DeploymentStatus,
  type ValidationResult,
  type DeploymentConfig,
  type Deployment,
  type PipelineConfig,
  type PipelineEvents,
  // Constants
  DEFAULT_PIPELINE_CONFIG,
} from './deployment-pipeline';
