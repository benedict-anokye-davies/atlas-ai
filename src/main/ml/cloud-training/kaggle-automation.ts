/**
 * Atlas ML - Kaggle Automation
 *
 * Integration with Kaggle Kernels API for cloud GPU training.
 * Supports:
 * - Dataset uploads to Kaggle
 * - Kernel creation and execution
 * - GPU/TPU runtime allocation
 * - Model artifact downloads
 *
 * @module ml/cloud-training/kaggle-automation
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import { app } from 'electron';
import { EventEmitter } from 'events';
import { createModuleLogger } from '../../utils/logger';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { isoDate } from '../../../shared/utils';

const execAsync = promisify(exec);
const logger = createModuleLogger('KaggleAutomation');

// =============================================================================
// Types
// =============================================================================

export type KaggleJobStatus =
  | 'pending'
  | 'uploading-dataset'
  | 'creating-kernel'
  | 'queued'
  | 'running'
  | 'complete'
  | 'error'
  | 'cancelled';

export type KaggleAccelerator = 'none' | 'gpu' | 'gpu-t4x2' | 'gpu-p100' | 'tpu-v3-8';

export interface KaggleKernelConfig {
  /** Kernel title */
  title: string;
  /** Kernel slug (auto-generated from title if not provided) */
  slug?: string;
  /** Python code to execute */
  code: string;
  /** Language (python) */
  language: 'python';
  /** Kernel type */
  kernelType: 'script' | 'notebook';
  /** GPU/TPU accelerator */
  accelerator: KaggleAccelerator;
  /** Datasets to mount */
  datasets: string[];
  /** Competition data sources */
  competitions?: string[];
  /** Enable internet access */
  enableInternet: boolean;
  /** Enable GPU */
  enableGpu: boolean;
  /** Docker image (optional) */
  dockerImage?: string;
}

export interface KaggleDatasetConfig {
  /** Dataset title */
  title: string;
  /** Dataset slug (username/dataset-slug format) */
  slug?: string;
  /** License */
  license: 'CC0-1.0' | 'CC-BY-SA-4.0' | 'GPL-2' | 'ODbL-1.0' | 'DbCL-1.0' | 'other';
  /** Source path to upload */
  sourcePath: string;
  /** Description */
  description?: string;
  /** Is public */
  isPublic: boolean;
}

export interface KaggleJob {
  id: string;
  type: 'lstm' | 'intent' | 'emotion' | 'speaker-id' | 'llm-adapter' | 'custom';
  status: KaggleJobStatus;
  kernelConfig: KaggleKernelConfig;
  datasetSlug?: string;
  kernelSlug?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  progress?: {
    currentPhase: string;
    percentComplete: number;
    logs: string[];
  };
  outputPath?: string;
  error?: string;
  logs: string[];
}

export interface KaggleAutomationConfig {
  /** Kaggle username */
  username: string;
  /** Storage path for jobs */
  storagePath: string;
  /** Poll interval for job status (ms) */
  pollInterval: number;
  /** Max concurrent jobs */
  maxConcurrentJobs: number;
  /** Default accelerator */
  defaultAccelerator: KaggleAccelerator;
}

export const DEFAULT_KAGGLE_CONFIG: KaggleAutomationConfig = {
  username: '',
  storagePath: '',
  pollInterval: 60000, // 1 minute
  maxConcurrentJobs: 2,
  defaultAccelerator: 'gpu',
};

// =============================================================================
// Kaggle Automation Class
// =============================================================================

export class KaggleAutomation extends EventEmitter {
  private config: KaggleAutomationConfig;
  private storagePath: string;
  private jobs: Map<string, KaggleJob> = new Map();
  private pollTimers: Map<string, NodeJS.Timeout> = new Map();
  private initialized: boolean = false;
  private kaggleAvailable: boolean = false;

  constructor(config?: Partial<KaggleAutomationConfig>) {
    super();
    this.config = { ...DEFAULT_KAGGLE_CONFIG, ...config };
    this.storagePath =
      this.config.storagePath || path.join(app.getPath('userData'), 'ml', 'kaggle-jobs');
  }

  /**
   * Initialize Kaggle automation
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    logger.info('Initializing KaggleAutomation', { path: this.storagePath });

    await fs.ensureDir(this.storagePath);
    await fs.ensureDir(path.join(this.storagePath, 'datasets'));
    await fs.ensureDir(path.join(this.storagePath, 'kernels'));
    await fs.ensureDir(path.join(this.storagePath, 'outputs'));

    // Check if Kaggle CLI is available
    await this.checkKaggleCLI();

    // Load existing jobs
    await this.loadJobs();

    this.initialized = true;
    logger.info('KaggleAutomation initialized', {
      jobCount: this.jobs.size,
      kaggleAvailable: this.kaggleAvailable,
    });
  }

  /**
   * Check if Kaggle CLI is installed and configured
   */
  private async checkKaggleCLI(): Promise<boolean> {
    try {
      const { stdout } = await execAsync('kaggle --version');
      logger.info('Kaggle CLI found', { version: stdout.trim() });

      // Check authentication by listing datasets
      await execAsync('kaggle datasets list -m');
      this.kaggleAvailable = true;

      // Get username from config
      try {
        const kaggleJson = path.join(
          process.env.HOME || process.env.USERPROFILE || '',
          '.kaggle',
          'kaggle.json'
        );
        if (await fs.pathExists(kaggleJson)) {
          const creds = await fs.readJson(kaggleJson);
          this.config.username = creds.username || this.config.username;
        }
      } catch {
        // Ignore
      }

      return true;
    } catch (err) {
      logger.warn('Kaggle CLI not available - install with: pip install kaggle', { error: err });
      this.kaggleAvailable = false;
      return false;
    }
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
          this.jobs.set(id, job as KaggleJob);
        }
      } catch (err) {
        logger.error('Failed to load jobs', { error: err });
      }
    }
  }

  /**
   * Save jobs
   */
  private async saveJobs(): Promise<void> {
    const indexPath = path.join(this.storagePath, 'jobs.json');
    await fs.writeJson(indexPath, Object.fromEntries(this.jobs), { spaces: 2 });
  }

  // ===========================================================================
  // Dataset Management
  // ===========================================================================

  /**
   * Upload a dataset to Kaggle
   */
  async uploadDataset(config: KaggleDatasetConfig): Promise<string> {
    if (!this.kaggleAvailable) {
      throw new Error('Kaggle CLI not available');
    }

    const slug = config.slug || `${this.config.username}/${this.slugify(config.title)}`;
    const datasetDir = path.join(this.storagePath, 'datasets', this.slugify(config.title));

    logger.info('Uploading dataset to Kaggle', { title: config.title, slug });

    // Create dataset directory
    await fs.ensureDir(datasetDir);

    // Copy source data
    const sourceStat = await fs.stat(config.sourcePath);
    if (sourceStat.isDirectory()) {
      await fs.copy(config.sourcePath, datasetDir);
    } else {
      await fs.copy(config.sourcePath, path.join(datasetDir, path.basename(config.sourcePath)));
    }

    // Create dataset-metadata.json
    const metadata = {
      title: config.title,
      id: slug,
      licenses: [{ name: config.license }],
      description: config.description || `Training data for Atlas ML - ${config.title}`,
      isPrivate: !config.isPublic,
    };

    await fs.writeJson(path.join(datasetDir, 'dataset-metadata.json'), metadata, { spaces: 2 });

    // Upload or create dataset
    try {
      // Try to create new dataset
      await execAsync(`kaggle datasets create -p "${datasetDir}"`, {
        maxBuffer: 50 * 1024 * 1024,
      });
      logger.info('Created new dataset', { slug });
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      // If dataset exists, update it
      if (errorMessage.includes('already exists')) {
        await execAsync(`kaggle datasets version -p "${datasetDir}" -m "Atlas ML update"`, {
          maxBuffer: 50 * 1024 * 1024,
        });
        logger.info('Updated existing dataset', { slug });
      } else {
        throw err;
      }
    }

    return slug;
  }

  // ===========================================================================
  // Kernel Management
  // ===========================================================================

  /**
   * Create and push a kernel to Kaggle
   */
  async createKernel(config: KaggleKernelConfig): Promise<string> {
    if (!this.kaggleAvailable) {
      throw new Error('Kaggle CLI not available');
    }

    const slug =
      config.slug ||
      `${this.config.username}/${this.slugify(config.title)}-${Date.now().toString(36)}`;
    const kernelDir = path.join(this.storagePath, 'kernels', this.slugify(config.title));

    logger.info('Creating Kaggle kernel', { title: config.title, slug });

    await fs.ensureDir(kernelDir);

    // Write kernel code
    const codeFile =
      config.kernelType === 'notebook'
        ? path.join(kernelDir, 'kernel.ipynb')
        : path.join(kernelDir, 'kernel.py');

    if (config.kernelType === 'notebook') {
      // Convert code to notebook format
      const notebook = this.codeToNotebook(config.code);
      await fs.writeJson(codeFile, notebook, { spaces: 2 });
    } else {
      await fs.writeFile(codeFile, config.code);
    }

    // Create kernel-metadata.json
    const metadata = {
      id: slug,
      title: config.title,
      code_file: path.basename(codeFile),
      language: config.language,
      kernel_type: config.kernelType,
      is_private: true,
      enable_gpu: config.enableGpu || config.accelerator !== 'none',
      enable_tpu: config.accelerator.startsWith('tpu'),
      enable_internet: config.enableInternet,
      dataset_sources: config.datasets,
      competition_sources: config.competitions || [],
      kernel_sources: [],
      model_sources: [],
    };

    await fs.writeJson(path.join(kernelDir, 'kernel-metadata.json'), metadata, { spaces: 2 });

    // Push kernel
    await execAsync(`kaggle kernels push -p "${kernelDir}"`, {
      maxBuffer: 50 * 1024 * 1024,
    });

    logger.info('Kernel created and pushed', { slug });
    return slug;
  }

  /**
   * Convert Python code to Jupyter notebook format
   */
  private codeToNotebook(code: string): object {
    const cells = code.split(/\n# %%\n/).map((cellCode, index) => ({
      cell_type: 'code',
      execution_count: null,
      metadata: {},
      outputs: [],
      source: cellCode.split('\n').map((line, i, arr) => (i < arr.length - 1 ? line + '\n' : line)),
    }));

    return {
      metadata: {
        kernelspec: {
          display_name: 'Python 3',
          language: 'python',
          name: 'python3',
        },
        language_info: {
          name: 'python',
          version: '3.10.0',
        },
      },
      nbformat: 4,
      nbformat_minor: 4,
      cells,
    };
  }

  /**
   * Get kernel status
   */
  async getKernelStatus(slug: string): Promise<{ status: string; failureMessage?: string }> {
    if (!this.kaggleAvailable) {
      throw new Error('Kaggle CLI not available');
    }

    try {
      const { stdout } = await execAsync(`kaggle kernels status "${slug}"`);
      const status = stdout.trim().toLowerCase();

      if (status.includes('complete')) {
        return { status: 'complete' };
      } else if (status.includes('running')) {
        return { status: 'running' };
      } else if (status.includes('error') || status.includes('failed')) {
        return { status: 'error', failureMessage: stdout };
      } else if (status.includes('queued')) {
        return { status: 'queued' };
      }

      return { status: 'unknown' };
    } catch (err) {
      logger.error('Failed to get kernel status', { slug, error: err });
      throw err;
    }
  }

  /**
   * Download kernel output
   */
  async downloadKernelOutput(slug: string, outputDir: string): Promise<string[]> {
    if (!this.kaggleAvailable) {
      throw new Error('Kaggle CLI not available');
    }

    await fs.ensureDir(outputDir);

    try {
      await execAsync(`kaggle kernels output "${slug}" -p "${outputDir}"`, {
        maxBuffer: 100 * 1024 * 1024,
      });

      const files = await fs.readdir(outputDir);
      logger.info('Downloaded kernel output', { slug, files });
      return files;
    } catch (err) {
      logger.error('Failed to download kernel output', { slug, error: err });
      throw err;
    }
  }

  // ===========================================================================
  // Job Management
  // ===========================================================================

  /**
   * Create a training job
   */
  async createJob(
    type: KaggleJob['type'],
    datasetPath: string,
    trainingCode: string,
    options: Partial<KaggleKernelConfig> = {}
  ): Promise<KaggleJob> {
    const id = `kaggle_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const kernelConfig: KaggleKernelConfig = {
      title: `Atlas ML - ${type} Training - ${isoDate()}`,
      code: trainingCode,
      language: 'python',
      kernelType: 'script',
      accelerator: options.accelerator || this.config.defaultAccelerator,
      datasets: [],
      enableInternet: true,
      enableGpu: true,
      ...options,
    };

    const job: KaggleJob = {
      id,
      type,
      status: 'pending',
      kernelConfig,
      createdAt: Date.now(),
      logs: [],
    };

    this.jobs.set(id, job);
    await this.saveJobs();

    this.emit('job-created', job);
    logger.info('Created Kaggle job', { id, type });

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

    try {
      // Step 1: Upload dataset if provided
      if (job.kernelConfig.datasets.length === 0) {
        job.status = 'uploading-dataset';
        job.logs.push(`[${new Date().toISOString()}] Uploading training dataset...`);
        await this.saveJobs();
        this.emit('job-progress', job);

        // Note: In practice, you'd upload the actual dataset here
        // For now, we expect datasets to be pre-uploaded or specified in config
      }

      // Step 2: Create and push kernel
      job.status = 'creating-kernel';
      job.logs.push(`[${new Date().toISOString()}] Creating training kernel...`);
      await this.saveJobs();
      this.emit('job-progress', job);

      const kernelSlug = await this.createKernel(job.kernelConfig);
      job.kernelSlug = kernelSlug;

      // Step 3: Start polling for status
      job.status = 'queued';
      job.startedAt = Date.now();
      job.logs.push(`[${new Date().toISOString()}] Kernel queued for execution: ${kernelSlug}`);
      await this.saveJobs();
      this.emit('job-started', job);

      // Start polling
      this.startPolling(jobId);
    } catch (err) {
      job.status = 'error';
      job.error = (err as Error).message;
      job.logs.push(`[${new Date().toISOString()}] ERROR: ${job.error}`);
      await this.saveJobs();
      this.emit('job-failed', job);
      throw err;
    }
  }

  /**
   * Start polling for job status
   */
  private startPolling(jobId: string): void {
    const timer = setInterval(async () => {
      const job = this.jobs.get(jobId);
      if (!job || !job.kernelSlug) {
        this.stopPolling(jobId);
        return;
      }

      try {
        const status = await this.getKernelStatus(job.kernelSlug);

        if (status.status === 'running' && job.status !== 'running') {
          job.status = 'running';
          job.logs.push(`[${new Date().toISOString()}] Training in progress...`);
          await this.saveJobs();
          this.emit('job-progress', job);
        } else if (status.status === 'complete') {
          job.status = 'complete';
          job.completedAt = Date.now();
          job.logs.push(`[${new Date().toISOString()}] Training completed!`);

          // Download output
          const outputDir = path.join(this.storagePath, 'outputs', job.id);
          await this.downloadKernelOutput(job.kernelSlug, outputDir);
          job.outputPath = outputDir;

          await this.saveJobs();
          this.stopPolling(jobId);
          this.emit('job-completed', job);
        } else if (status.status === 'error') {
          job.status = 'error';
          job.error = status.failureMessage || 'Unknown error';
          job.logs.push(`[${new Date().toISOString()}] ERROR: ${job.error}`);
          await this.saveJobs();
          this.stopPolling(jobId);
          this.emit('job-failed', job);
        }
      } catch (err) {
        logger.error('Error polling job status', { jobId, error: err });
      }
    }, this.config.pollInterval);

    this.pollTimers.set(jobId, timer);
  }

  /**
   * Stop polling for job status
   */
  private stopPolling(jobId: string): void {
    const timer = this.pollTimers.get(jobId);
    if (timer) {
      clearInterval(timer);
      this.pollTimers.delete(jobId);
    }
  }

  /**
   * Cancel a job
   */
  async cancelJob(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }

    this.stopPolling(jobId);
    job.status = 'cancelled';
    job.logs.push(`[${new Date().toISOString()}] Job cancelled`);
    await this.saveJobs();

    // Note: Kaggle doesn't support cancelling running kernels via API
    logger.info('Job cancelled', { jobId });
  }

  /**
   * Get all jobs
   */
  getJobs(): KaggleJob[] {
    return Array.from(this.jobs.values());
  }

  /**
   * Get a specific job
   */
  getJob(jobId: string): KaggleJob | undefined {
    return this.jobs.get(jobId);
  }

  /**
   * Cleanup old jobs
   */
  async cleanupOldJobs(maxAgeMs: number = 7 * 24 * 60 * 60 * 1000): Promise<number> {
    const now = Date.now();
    let cleaned = 0;

    for (const [id, job] of this.jobs.entries()) {
      if (
        now - job.createdAt > maxAgeMs &&
        (job.status === 'complete' || job.status === 'error' || job.status === 'cancelled')
      ) {
        this.jobs.delete(id);

        // Delete output files
        if (job.outputPath && (await fs.pathExists(job.outputPath))) {
          await fs.remove(job.outputPath);
        }

        cleaned++;
      }
    }

    if (cleaned > 0) {
      await this.saveJobs();
      logger.info('Cleaned up old jobs', { count: cleaned });
    }

    return cleaned;
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  /**
   * Convert string to URL-safe slug
   */
  private slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  /**
   * Check if Kaggle is available
   */
  isAvailable(): boolean {
    return this.kaggleAvailable;
  }

  /**
   * Get Kaggle username
   */
  getUsername(): string {
    return this.config.username;
  }

  /**
   * Destroy the automation instance
   */
  destroy(): void {
    for (const timer of this.pollTimers.values()) {
      clearInterval(timer);
    }
    this.pollTimers.clear();
    this.removeAllListeners();
    logger.info('KaggleAutomation destroyed');
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let instance: KaggleAutomation | null = null;

export function getKaggleAutomation(): KaggleAutomation {
  if (!instance) {
    instance = new KaggleAutomation();
  }
  return instance;
}

export function destroyKaggleAutomation(): void {
  if (instance) {
    instance.destroy();
    instance = null;
  }
}

export default KaggleAutomation;
