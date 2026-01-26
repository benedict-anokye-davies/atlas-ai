/**
 * Atlas ML - Colab Automation
 *
 * T5-306: Google Colab automation for model training
 *
 * Automates the process of:
 * - Uploading training data to Google Drive
 * - Triggering Colab notebooks via API
 * - Monitoring training progress
 * - Downloading trained models
 *
 * @module ml/fine-tuning/colab-automation
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import { app } from 'electron';
import { EventEmitter } from 'events';
import { createModuleLogger } from '../../utils/logger';

const logger = createModuleLogger('ColabAutomation');

// =============================================================================
// Types
// =============================================================================

/**
 * Training job status
 */
export type TrainingJobStatus =
  | 'pending'
  | 'uploading'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

/**
 * Training job configuration
 */
export interface TrainingJobConfig {
  /** Job name */
  name: string;
  /** Type of training */
  type: 'lstm' | 'speaker-id' | 'emotion' | 'llm-adapter';
  /** Path to training data */
  datasetPath: string;
  /** Notebook template to use */
  notebookTemplate: string;
  /** Training hyperparameters */
  hyperparameters: {
    epochs?: number;
    batchSize?: number;
    learningRate?: number;
    warmupSteps?: number;
    [key: string]: unknown;
  };
  /** GPU runtime type */
  runtime: 'cpu' | 'gpu' | 'tpu';
  /** Maximum training time in hours */
  maxHours?: number;
}

/**
 * Training job
 */
export interface TrainingJob {
  id: string;
  config: TrainingJobConfig;
  status: TrainingJobStatus;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  progress?: {
    epoch: number;
    totalEpochs: number;
    loss: number;
    validationLoss?: number;
    metrics?: Record<string, number>;
  };
  outputPath?: string;
  error?: string;
  logs: string[];
}

/**
 * Colab automation configuration
 */
export interface ColabAutomationConfig {
  /** Storage path for jobs and models */
  storagePath: string;
  /** Google Drive folder ID for uploads */
  driveFolderId?: string;
  /** Polling interval for job status (ms) */
  pollInterval: number;
  /** Maximum concurrent jobs */
  maxConcurrentJobs: number;
}

export const DEFAULT_COLAB_CONFIG: ColabAutomationConfig = {
  storagePath: '',
  pollInterval: 30000, // 30 seconds
  maxConcurrentJobs: 1,
};

/**
 * Colab automation events
 */
export interface ColabAutomationEvents {
  'job-created': (job: TrainingJob) => void;
  'job-started': (job: TrainingJob) => void;
  'job-progress': (job: TrainingJob) => void;
  'job-completed': (job: TrainingJob) => void;
  'job-failed': (job: TrainingJob) => void;
  'model-downloaded': (jobId: string, modelPath: string) => void;
  error: (error: Error) => void;
}

// =============================================================================
// Notebook Templates
// =============================================================================

/**
 * Available notebook templates
 */
export const NOTEBOOK_TEMPLATES = {
  'lstm-trading': {
    name: 'LSTM Trading Predictor',
    description: 'Train LSTM model for price prediction',
    requiredData: ['ohlcv'],
    estimatedTime: '1-2 hours',
    gpu: true,
  },
  'speaker-embedding': {
    name: 'Speaker Embedding',
    description: 'Fine-tune speaker identification model',
    requiredData: ['voice-samples'],
    estimatedTime: '2-4 hours',
    gpu: true,
  },
  'emotion-hubert': {
    name: 'Emotion Detection (HuBERT)',
    description: 'Fine-tune HuBERT for emotion detection',
    requiredData: ['emotion-labeled-audio'],
    estimatedTime: '4-8 hours',
    gpu: true,
  },
  'deepseek-lora': {
    name: 'DeepSeek LoRA Adapter',
    description: 'Train LoRA adapter for DeepSeek',
    requiredData: ['conversations-jsonl'],
    estimatedTime: '2-6 hours',
    gpu: true,
  },
} as const;

export type NotebookTemplate = keyof typeof NOTEBOOK_TEMPLATES;

// =============================================================================
// Colab Automation
// =============================================================================

export class ColabAutomation extends EventEmitter {
  private config: ColabAutomationConfig;
  private storagePath: string;
  private jobs: Map<string, TrainingJob> = new Map();
  private pollTimers: Map<string, NodeJS.Timeout> = new Map();
  private initialized: boolean = false;

  constructor(config?: Partial<ColabAutomationConfig>) {
    super();
    this.config = { ...DEFAULT_COLAB_CONFIG, ...config };
    this.storagePath =
      this.config.storagePath || path.join(app.getPath('userData'), 'ml', 'training-jobs');
  }

  /**
   * Initialize the automation system
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    logger.info('Initializing ColabAutomation', { path: this.storagePath });

    await fs.ensureDir(this.storagePath);
    await fs.ensureDir(path.join(this.storagePath, 'uploads'));
    await fs.ensureDir(path.join(this.storagePath, 'downloads'));
    await fs.ensureDir(path.join(this.storagePath, 'logs'));

    await this.loadJobs();

    this.initialized = true;
    logger.info('ColabAutomation initialized', { jobCount: this.jobs.size });
  }

  /**
   * Load existing jobs
   */
  private async loadJobs(): Promise<void> {
    const indexPath = path.join(this.storagePath, 'jobs.json');
    if (await fs.pathExists(indexPath)) {
      try {
        const data = await fs.readJson(indexPath);
        for (const [id, job] of Object.entries(data)) {
          this.jobs.set(id, job as TrainingJob);
        }
      } catch (err) {
        logger.error('Failed to load jobs', { error: err });
      }
    }
  }

  /**
   * Save jobs index
   */
  private async saveJobs(): Promise<void> {
    const indexPath = path.join(this.storagePath, 'jobs.json');
    await fs.writeJson(indexPath, Object.fromEntries(this.jobs), { spaces: 2 });
  }

  // ===========================================================================
  // Job Management
  // ===========================================================================

  /**
   * Create a new training job
   */
  async createJob(config: TrainingJobConfig): Promise<TrainingJob> {
    const id = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const job: TrainingJob = {
      id,
      config,
      status: 'pending',
      createdAt: Date.now(),
      logs: [],
    };

    this.jobs.set(id, job);
    await this.saveJobs();

    this.emit('job-created', job);
    logger.info('Created training job', { id, name: config.name, type: config.type });

    return job;
  }

  /**
   * Start a training job
   */
  async startJob(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }

    if (job.status !== 'pending') {
      throw new Error(`Job is not pending: ${job.status}`);
    }

    // Check concurrent job limit
    const runningJobs = Array.from(this.jobs.values()).filter(
      (j) => j.status === 'running' || j.status === 'uploading' || j.status === 'queued'
    );
    if (runningJobs.length >= this.config.maxConcurrentJobs) {
      throw new Error(
        `Max concurrent jobs reached: ${runningJobs.length}/${this.config.maxConcurrentJobs}`
      );
    }

    try {
      // Step 1: Upload dataset
      job.status = 'uploading';
      job.logs.push(`[${new Date().toISOString()}] Uploading dataset...`);
      await this.saveJobs();

      await this.uploadDataset(job);

      // Step 2: Queue for execution
      job.status = 'queued';
      job.logs.push(`[${new Date().toISOString()}] Dataset uploaded, job queued`);
      await this.saveJobs();

      // In a full implementation, this would:
      // 1. Create/update a Colab notebook from template
      // 2. Use Colab API or automation to execute it
      // 3. Monitor progress via callbacks or polling

      // For now, simulate the process
      await this.simulateColabExecution(job);
    } catch (err) {
      job.status = 'failed';
      job.error = (err as Error).message;
      job.logs.push(`[${new Date().toISOString()}] ERROR: ${job.error}`);
      await this.saveJobs();
      this.emit('job-failed', job);
      throw err;
    }
  }

  /**
   * Upload dataset to Google Drive
   */
  private async uploadDataset(job: TrainingJob): Promise<void> {
    // In a full implementation, this would use Google Drive API
    // to upload the dataset to the specified folder

    const datasetPath = job.config.datasetPath;
    if (!(await fs.pathExists(datasetPath))) {
      throw new Error(`Dataset not found: ${datasetPath}`);
    }

    // Copy to uploads folder for tracking
    const uploadPath = path.join(this.storagePath, 'uploads', job.id);
    await fs.ensureDir(uploadPath);

    const stats = await fs.stat(datasetPath);
    if (stats.isDirectory()) {
      await fs.copy(datasetPath, uploadPath);
    } else {
      await fs.copy(datasetPath, path.join(uploadPath, path.basename(datasetPath)));
    }

    job.logs.push(
      `[${new Date().toISOString()}] Dataset copied to ${uploadPath} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`
    );
  }

  /**
   * Simulate Colab execution (for development/testing)
   */
  private async simulateColabExecution(job: TrainingJob): Promise<void> {
    job.status = 'running';
    job.startedAt = Date.now();
    job.logs.push(`[${new Date().toISOString()}] Training started`);
    await this.saveJobs();

    this.emit('job-started', job);

    const totalEpochs = job.config.hyperparameters.epochs || 10;

    // Simulate training progress
    for (let epoch = 1; epoch <= totalEpochs; epoch++) {
      await new Promise((resolve) => setTimeout(resolve, 1000)); // 1 second per epoch

      job.progress = {
        epoch,
        totalEpochs,
        loss: Math.max(0.1, 1.0 - epoch * 0.08 + Math.random() * 0.05),
        validationLoss: Math.max(0.15, 1.1 - epoch * 0.07 + Math.random() * 0.08),
      };

      job.logs.push(
        `[${new Date().toISOString()}] Epoch ${epoch}/${totalEpochs} - Loss: ${job.progress.loss.toFixed(4)}, Val Loss: ${(job.progress.validationLoss ?? 0).toFixed(4)}`
      );

      await this.saveJobs();
      this.emit('job-progress', job);
    }

    // Complete the job
    job.status = 'completed';
    job.completedAt = Date.now();
    job.outputPath = path.join(this.storagePath, 'downloads', job.id);
    job.logs.push(`[${new Date().toISOString()}] Training completed`);

    // Create mock model output
    await fs.ensureDir(job.outputPath);
    await fs.writeJson(
      path.join(job.outputPath, 'model_info.json'),
      {
        jobId: job.id,
        type: job.config.type,
        finalLoss: job.progress?.loss,
        trainedAt: new Date().toISOString(),
      },
      { spaces: 2 }
    );

    await this.saveJobs();
    this.emit('job-completed', job);
    this.emit('model-downloaded', job.id, job.outputPath);

    logger.info('Training job completed', {
      id: job.id,
      duration: job.completedAt - (job.startedAt || job.createdAt),
      finalLoss: job.progress?.loss,
    });
  }

  /**
   * Cancel a training job
   */
  async cancelJob(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }

    if (job.status === 'completed' || job.status === 'cancelled') {
      throw new Error(`Job already ${job.status}`);
    }

    // Stop polling
    const timer = this.pollTimers.get(jobId);
    if (timer) {
      clearInterval(timer);
      this.pollTimers.delete(jobId);
    }

    job.status = 'cancelled';
    job.logs.push(`[${new Date().toISOString()}] Job cancelled by user`);
    await this.saveJobs();

    logger.info('Cancelled training job', { id: jobId });
  }

  /**
   * Get a job by ID
   */
  getJob(jobId: string): TrainingJob | null {
    return this.jobs.get(jobId) || null;
  }

  /**
   * Get all jobs
   */
  getAllJobs(): TrainingJob[] {
    return Array.from(this.jobs.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Get jobs by status
   */
  getJobsByStatus(status: TrainingJobStatus): TrainingJob[] {
    return this.getAllJobs().filter((j) => j.status === status);
  }

  /**
   * Get job logs
   */
  getJobLogs(jobId: string): string[] {
    const job = this.jobs.get(jobId);
    return job?.logs || [];
  }

  /**
   * Delete a job and its artifacts
   */
  async deleteJob(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }

    if (job.status === 'running') {
      await this.cancelJob(jobId);
    }

    // Delete artifacts
    const uploadPath = path.join(this.storagePath, 'uploads', jobId);
    if (await fs.pathExists(uploadPath)) {
      await fs.remove(uploadPath);
    }

    if (job.outputPath && (await fs.pathExists(job.outputPath))) {
      await fs.remove(job.outputPath);
    }

    this.jobs.delete(jobId);
    await this.saveJobs();

    logger.info('Deleted training job', { id: jobId });
  }

  // ===========================================================================
  // Utility Methods
  // ===========================================================================

  /**
   * Get available notebook templates
   */
  getTemplates(): typeof NOTEBOOK_TEMPLATES {
    return NOTEBOOK_TEMPLATES;
  }

  /**
   * Estimate training time
   */
  estimateTrainingTime(config: TrainingJobConfig): string {
    const template = NOTEBOOK_TEMPLATES[config.notebookTemplate as NotebookTemplate];
    return template?.estimatedTime || 'Unknown';
  }

  /**
   * Validate job configuration
   */
  validateConfig(config: TrainingJobConfig): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!config.name) {
      errors.push('Job name is required');
    }

    if (!config.datasetPath) {
      errors.push('Dataset path is required');
    }

    if (!config.notebookTemplate) {
      errors.push('Notebook template is required');
    } else if (!NOTEBOOK_TEMPLATES[config.notebookTemplate as NotebookTemplate]) {
      errors.push(`Unknown template: ${config.notebookTemplate}`);
    }

    if (config.hyperparameters.epochs && config.hyperparameters.epochs > 100) {
      errors.push('Epochs should not exceed 100');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    // Stop all polling
    for (const timer of this.pollTimers.values()) {
      clearInterval(timer);
    }
    this.pollTimers.clear();

    await this.saveJobs();
    this.jobs.clear();
    this.initialized = false;

    logger.info('ColabAutomation cleaned up');
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let instance: ColabAutomation | null = null;

/**
 * Get the ColabAutomation singleton
 */
export function getColabAutomation(): ColabAutomation {
  if (!instance) {
    instance = new ColabAutomation();
  }
  return instance;
}

/**
 * Initialize the ColabAutomation
 */
export async function initializeColabAutomation(
  config?: Partial<ColabAutomationConfig>
): Promise<ColabAutomation> {
  if (!instance) {
    instance = new ColabAutomation(config);
  }
  await instance.initialize();
  return instance;
}

/**
 * Cleanup the ColabAutomation
 */
export async function cleanupColabAutomation(): Promise<void> {
  if (instance) {
    await instance.cleanup();
    instance = null;
  }
}
