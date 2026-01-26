/**
 * Atlas ML - Custom Wake Word Training
 *
 * T5-303: Custom Wake Word training using Picovoice Porcupine Console
 *
 * Porcupine requires training custom wake words through their console:
 * https://console.picovoice.ai/
 *
 * This module handles:
 * - Voice sample collection for custom wake words
 * - Sample validation and quality checking
 * - Export for Picovoice Console upload
 * - Model deployment after training
 *
 * @module ml/wake-word/custom-wake-word
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import { app } from 'electron';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { createModuleLogger } from '../../utils/logger';
import { getModelRegistry } from '../models';

const logger = createModuleLogger('CustomWakeWord');

// =============================================================================
// Types
// =============================================================================

/**
 * Wake word sample for training
 */
export interface WakeWordSample {
  id: string;
  wakeWord: string;
  audioPath: string;
  speakerId?: string;
  duration: number;
  sampleRate: number;
  channels: number;
  quality: 'good' | 'fair' | 'poor';
  createdAt: number;
  metadata?: {
    noiseLevel?: number;
    snr?: number; // Signal-to-noise ratio
    peakAmplitude?: number;
    environment?: string;
  };
}

/**
 * Wake word training dataset
 */
export interface WakeWordDataset {
  id: string;
  wakeWord: string;
  samples: WakeWordSample[];
  createdAt: number;
  updatedAt: number;
  status: 'collecting' | 'ready' | 'exported' | 'training' | 'deployed';
  exportPath?: string;
  modelPath?: string;
}

/**
 * Configuration for wake word training
 */
export interface WakeWordTrainingConfig {
  /** Minimum samples required for training */
  minSamples: number;
  /** Target samples for good accuracy */
  targetSamples: number;
  /** Required sample rate */
  sampleRate: number;
  /** Minimum audio duration in seconds */
  minDuration: number;
  /** Maximum audio duration in seconds */
  maxDuration: number;
  /** Minimum SNR for good quality */
  minSnr: number;
  /** Storage path */
  storagePath: string;
}

export const DEFAULT_WAKE_WORD_CONFIG: WakeWordTrainingConfig = {
  minSamples: 3,
  targetSamples: 20,
  sampleRate: 16000,
  minDuration: 0.5,
  maxDuration: 2.0,
  minSnr: 10,
  storagePath: '',
};

/**
 * Wake word trainer events
 */
export interface WakeWordTrainerEvents {
  'sample-added': (sample: WakeWordSample) => void;
  'sample-rejected': (reason: string) => void;
  'dataset-ready': (dataset: WakeWordDataset) => void;
  'export-complete': (exportPath: string) => void;
  'model-deployed': (modelPath: string) => void;
  error: (error: Error) => void;
}

// =============================================================================
// Custom Wake Word Trainer
// =============================================================================

export class CustomWakeWordTrainer extends EventEmitter {
  private config: WakeWordTrainingConfig;
  private storagePath: string;
  private datasets: Map<string, WakeWordDataset> = new Map();
  private initialized: boolean = false;

  constructor(config?: Partial<WakeWordTrainingConfig>) {
    super();
    this.config = { ...DEFAULT_WAKE_WORD_CONFIG, ...config };
    this.storagePath =
      this.config.storagePath || path.join(app.getPath('userData'), 'ml', 'wake-words');
  }

  /**
   * Initialize the trainer
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    logger.info('Initializing CustomWakeWordTrainer', { path: this.storagePath });

    await fs.ensureDir(this.storagePath);
    await fs.ensureDir(path.join(this.storagePath, 'samples'));
    await fs.ensureDir(path.join(this.storagePath, 'exports'));
    await fs.ensureDir(path.join(this.storagePath, 'models'));

    await this.loadDatasets();

    this.initialized = true;
    logger.info('CustomWakeWordTrainer initialized', { datasets: this.datasets.size });
  }

  /**
   * Load existing datasets
   */
  private async loadDatasets(): Promise<void> {
    const indexPath = path.join(this.storagePath, 'datasets.json');
    if (await fs.pathExists(indexPath)) {
      try {
        const data = await fs.readJson(indexPath);
        this.datasets = new Map(Object.entries(data));
      } catch (err) {
        logger.error('Failed to load datasets', { error: err });
      }
    }
  }

  /**
   * Save datasets index
   */
  private async saveDatasets(): Promise<void> {
    const indexPath = path.join(this.storagePath, 'datasets.json');
    await fs.writeJson(indexPath, Object.fromEntries(this.datasets), { spaces: 2 });
  }

  // ===========================================================================
  // Dataset Management
  // ===========================================================================

  /**
   * Create a new wake word dataset
   */
  async createDataset(wakeWord: string): Promise<WakeWordDataset> {
    const normalized = this.normalizeWakeWord(wakeWord);
    const id = `ww_${normalized}_${Date.now()}`;

    const dataset: WakeWordDataset = {
      id,
      wakeWord,
      samples: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: 'collecting',
    };

    this.datasets.set(id, dataset);
    await this.saveDatasets();

    logger.info('Created wake word dataset', { id, wakeWord });
    return dataset;
  }

  /**
   * Get dataset by ID
   */
  getDataset(datasetId: string): WakeWordDataset | null {
    return this.datasets.get(datasetId) || null;
  }

  /**
   * Get all datasets
   */
  getAllDatasets(): WakeWordDataset[] {
    return Array.from(this.datasets.values());
  }

  /**
   * Get datasets by wake word
   */
  getDatasetsByWakeWord(wakeWord: string): WakeWordDataset[] {
    const normalized = this.normalizeWakeWord(wakeWord);
    return this.getAllDatasets().filter((d) => this.normalizeWakeWord(d.wakeWord) === normalized);
  }

  /**
   * Normalize wake word for comparison
   */
  private normalizeWakeWord(wakeWord: string): string {
    return wakeWord
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_]/g, '');
  }

  // ===========================================================================
  // Sample Collection
  // ===========================================================================

  /**
   * Add a voice sample to a dataset
   */
  async addSample(
    datasetId: string,
    audioBuffer: Buffer,
    options?: {
      speakerId?: string;
      sampleRate?: number;
      channels?: number;
    }
  ): Promise<WakeWordSample | null> {
    const dataset = this.datasets.get(datasetId);
    if (!dataset) {
      throw new Error(`Dataset not found: ${datasetId}`);
    }

    const sampleRate = options?.sampleRate || this.config.sampleRate;
    const channels = options?.channels || 1;

    // Validate audio quality
    const validation = this.validateSample(audioBuffer, sampleRate, channels);
    if (!validation.valid) {
      this.emit('sample-rejected', validation.reason);
      logger.warn('Sample rejected', { datasetId, reason: validation.reason });
      return null;
    }

    // Save sample to disk
    const sampleId = uuidv4();
    const samplePath = path.join(this.storagePath, 'samples', datasetId, `${sampleId}.wav`);

    await fs.ensureDir(path.dirname(samplePath));
    await this.saveAsWav(audioBuffer, samplePath, sampleRate, channels);

    const sample: WakeWordSample = {
      id: sampleId,
      wakeWord: dataset.wakeWord,
      audioPath: samplePath,
      speakerId: options?.speakerId,
      duration: validation.duration!,
      sampleRate,
      channels,
      quality: validation.quality!,
      createdAt: Date.now(),
      metadata: {
        snr: validation.snr,
        peakAmplitude: validation.peakAmplitude,
      },
    };

    dataset.samples.push(sample);
    dataset.updatedAt = Date.now();

    // Check if dataset is ready
    if (dataset.samples.length >= this.config.minSamples) {
      dataset.status = 'ready';
      this.emit('dataset-ready', dataset);
    }

    await this.saveDatasets();
    this.emit('sample-added', sample);

    logger.info('Added sample', {
      datasetId,
      sampleId,
      quality: sample.quality,
      total: dataset.samples.length,
    });

    return sample;
  }

  /**
   * Validate audio sample quality
   */
  private validateSample(
    audioBuffer: Buffer,
    sampleRate: number,
    channels: number
  ): {
    valid: boolean;
    reason?: string;
    duration?: number;
    quality?: 'good' | 'fair' | 'poor';
    snr?: number;
    peakAmplitude?: number;
  } {
    // Calculate duration
    const bytesPerSample = 2; // 16-bit audio
    const duration = audioBuffer.length / (sampleRate * channels * bytesPerSample);

    // Check duration
    if (duration < this.config.minDuration) {
      return {
        valid: false,
        reason: `Too short: ${duration.toFixed(2)}s < ${this.config.minDuration}s`,
      };
    }
    if (duration > this.config.maxDuration) {
      return {
        valid: false,
        reason: `Too long: ${duration.toFixed(2)}s > ${this.config.maxDuration}s`,
      };
    }

    // Analyze audio quality
    const samples = new Int16Array(
      audioBuffer.buffer,
      audioBuffer.byteOffset,
      audioBuffer.length / 2
    );

    // Calculate peak amplitude
    let maxAmp = 0;
    let sumSquares = 0;
    for (let i = 0; i < samples.length; i++) {
      const abs = Math.abs(samples[i]);
      if (abs > maxAmp) maxAmp = abs;
      sumSquares += samples[i] * samples[i];
    }
    const peakAmplitude = maxAmp / 32768;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _rms = Math.sqrt(sumSquares / samples.length);

    // Check for clipping or silence
    if (peakAmplitude > 0.99) {
      return { valid: false, reason: 'Audio is clipped' };
    }
    if (peakAmplitude < 0.01) {
      return { valid: false, reason: 'Audio is too quiet' };
    }

    // Estimate SNR (simplified)
    // In reality, would need noise floor estimation
    const snr = 20 * Math.log10(peakAmplitude / 0.001); // Approximate

    // Determine quality
    let quality: 'good' | 'fair' | 'poor';
    if (snr >= this.config.minSnr && peakAmplitude >= 0.1 && peakAmplitude <= 0.9) {
      quality = 'good';
    } else if (snr >= this.config.minSnr / 2) {
      quality = 'fair';
    } else {
      quality = 'poor';
    }

    return {
      valid: true,
      duration,
      quality,
      snr,
      peakAmplitude,
    };
  }

  /**
   * Save audio buffer as WAV file
   */
  private async saveAsWav(
    audioBuffer: Buffer,
    filePath: string,
    sampleRate: number,
    channels: number
  ): Promise<void> {
    const bytesPerSample = 2;
    const dataSize = audioBuffer.length;
    const fileSize = 44 + dataSize;

    const wav = Buffer.alloc(fileSize);
    let offset = 0;

    // RIFF header
    wav.write('RIFF', offset);
    offset += 4;
    wav.writeUInt32LE(fileSize - 8, offset);
    offset += 4;
    wav.write('WAVE', offset);
    offset += 4;

    // fmt chunk
    wav.write('fmt ', offset);
    offset += 4;
    wav.writeUInt32LE(16, offset); // Chunk size
    offset += 4;
    wav.writeUInt16LE(1, offset); // Audio format (PCM)
    offset += 2;
    wav.writeUInt16LE(channels, offset);
    offset += 2;
    wav.writeUInt32LE(sampleRate, offset);
    offset += 4;
    wav.writeUInt32LE(sampleRate * channels * bytesPerSample, offset); // Byte rate
    offset += 4;
    wav.writeUInt16LE(channels * bytesPerSample, offset); // Block align
    offset += 2;
    wav.writeUInt16LE(16, offset); // Bits per sample
    offset += 2;

    // data chunk
    wav.write('data', offset);
    offset += 4;
    wav.writeUInt32LE(dataSize, offset);
    offset += 4;

    // Copy audio data
    audioBuffer.copy(wav, offset);

    await fs.writeFile(filePath, wav);
  }

  /**
   * Remove a sample from a dataset
   */
  async removeSample(datasetId: string, sampleId: string): Promise<void> {
    const dataset = this.datasets.get(datasetId);
    if (!dataset) {
      throw new Error(`Dataset not found: ${datasetId}`);
    }

    const sampleIndex = dataset.samples.findIndex((s) => s.id === sampleId);
    if (sampleIndex === -1) {
      throw new Error(`Sample not found: ${sampleId}`);
    }

    const sample = dataset.samples[sampleIndex];

    // Remove audio file
    if (await fs.pathExists(sample.audioPath)) {
      await fs.remove(sample.audioPath);
    }

    dataset.samples.splice(sampleIndex, 1);
    dataset.updatedAt = Date.now();

    // Update status if needed
    if (dataset.samples.length < this.config.minSamples && dataset.status === 'ready') {
      dataset.status = 'collecting';
    }

    await this.saveDatasets();
    logger.info('Removed sample', { datasetId, sampleId });
  }

  // ===========================================================================
  // Export for Training
  // ===========================================================================

  /**
   * Export dataset for Picovoice Console upload
   *
   * Creates a ZIP archive with samples organized as required by Picovoice:
   * - All WAV files should be 16kHz mono
   * - Minimum 3 samples (20+ recommended)
   * - Various speakers recommended for robustness
   */
  async exportForTraining(datasetId: string): Promise<string> {
    const dataset = this.datasets.get(datasetId);
    if (!dataset) {
      throw new Error(`Dataset not found: ${datasetId}`);
    }

    if (dataset.samples.length < this.config.minSamples) {
      throw new Error(`Not enough samples: ${dataset.samples.length}/${this.config.minSamples}`);
    }

    const exportDir = path.join(
      this.storagePath,
      'exports',
      `${this.normalizeWakeWord(dataset.wakeWord)}_${Date.now()}`
    );

    await fs.ensureDir(exportDir);

    // Copy samples to export directory
    for (let i = 0; i < dataset.samples.length; i++) {
      const sample = dataset.samples[i];
      const destPath = path.join(exportDir, `sample_${i + 1}.wav`);
      await fs.copy(sample.audioPath, destPath);
    }

    // Create metadata file
    const metadata = {
      wakeWord: dataset.wakeWord,
      sampleCount: dataset.samples.length,
      uniqueSpeakers: new Set(dataset.samples.map((s) => s.speakerId).filter(Boolean)).size,
      qualityDistribution: {
        good: dataset.samples.filter((s) => s.quality === 'good').length,
        fair: dataset.samples.filter((s) => s.quality === 'fair').length,
        poor: dataset.samples.filter((s) => s.quality === 'poor').length,
      },
      exportedAt: new Date().toISOString(),
      instructions: [
        '1. Go to https://console.picovoice.ai/',
        '2. Create a new custom wake word project',
        `3. Enter the wake word: "${dataset.wakeWord}"`,
        '4. Upload all WAV files from this folder',
        '5. Train the model',
        '6. Download the .ppn file for your platform',
        '7. Place the .ppn file in the models directory',
      ],
    };

    await fs.writeJson(path.join(exportDir, 'metadata.json'), metadata, { spaces: 2 });

    // Create README
    const readme = `# Custom Wake Word Training Data

## Wake Word: "${dataset.wakeWord}"

### Statistics
- Total samples: ${dataset.samples.length}
- Unique speakers: ${metadata.uniqueSpeakers}
- Quality: ${metadata.qualityDistribution.good} good, ${metadata.qualityDistribution.fair} fair, ${metadata.qualityDistribution.poor} poor

### Instructions
${metadata.instructions.join('\n')}

### Notes
- Picovoice recommends at least 20 samples for good accuracy
- Include samples from different speakers for robustness
- Record in various environments (quiet room, with background noise, etc.)
- Speak naturally at different volumes and speeds
`;

    await fs.writeFile(path.join(exportDir, 'README.md'), readme);

    dataset.status = 'exported';
    dataset.exportPath = exportDir;
    dataset.updatedAt = Date.now();
    await this.saveDatasets();

    this.emit('export-complete', exportDir);
    logger.info('Exported dataset for training', {
      datasetId,
      exportDir,
      samples: dataset.samples.length,
    });

    return exportDir;
  }

  // ===========================================================================
  // Model Deployment
  // ===========================================================================

  /**
   * Deploy a trained wake word model
   */
  async deployModel(
    datasetId: string,
    modelFile: string,
    options?: {
      platform?: 'windows' | 'mac' | 'linux';
      makeActive?: boolean;
    }
  ): Promise<void> {
    const dataset = this.datasets.get(datasetId);
    if (!dataset) {
      throw new Error(`Dataset not found: ${datasetId}`);
    }

    if (!(await fs.pathExists(modelFile))) {
      throw new Error(`Model file not found: ${modelFile}`);
    }

    const platform = options?.platform || process.platform;
    const modelDir = path.join(this.storagePath, 'models');
    const destPath = path.join(
      modelDir,
      `${this.normalizeWakeWord(dataset.wakeWord)}_${platform}.ppn`
    );

    await fs.copy(modelFile, destPath);

    dataset.status = 'deployed';
    dataset.modelPath = destPath;
    dataset.updatedAt = Date.now();
    await this.saveDatasets();

    // Register in model registry
    const registry = getModelRegistry();
    await registry.initialize();

    const model = await registry.registerModel(dataset.wakeWord, 'wake-word', `1.0.${Date.now()}`, {
      description: `Custom wake word: ${dataset.wakeWord}`,
      path: path.relative(path.join(app.getPath('userData'), 'models'), destPath),
      config: {
        platform,
        sampleCount: dataset.samples.length,
      },
      tags: ['custom', 'wake-word', platform],
    });

    if (options?.makeActive) {
      await registry.activateModel(model.id);
    }

    this.emit('model-deployed', destPath);
    logger.info('Deployed wake word model', { datasetId, modelPath: destPath });
  }

  /**
   * Get training status and recommendations
   */
  getTrainingStatus(datasetId: string): {
    ready: boolean;
    progress: number;
    recommendations: string[];
    stats: {
      total: number;
      good: number;
      fair: number;
      poor: number;
      speakers: number;
    };
  } {
    const dataset = this.datasets.get(datasetId);
    if (!dataset) {
      throw new Error(`Dataset not found: ${datasetId}`);
    }

    const samples = dataset.samples;
    const good = samples.filter((s) => s.quality === 'good').length;
    const fair = samples.filter((s) => s.quality === 'fair').length;
    const poor = samples.filter((s) => s.quality === 'poor').length;
    const speakers = new Set(samples.map((s) => s.speakerId).filter(Boolean)).size;

    const progress = Math.min(100, (samples.length / this.config.targetSamples) * 100);
    const ready = samples.length >= this.config.minSamples;

    const recommendations: string[] = [];

    if (samples.length < this.config.minSamples) {
      recommendations.push(`Need at least ${this.config.minSamples - samples.length} more samples`);
    }

    if (samples.length < this.config.targetSamples) {
      recommendations.push(
        `Recommended: ${this.config.targetSamples - samples.length} more samples for better accuracy`
      );
    }

    if (speakers < 3 && samples.length >= 10) {
      recommendations.push('Consider adding samples from different speakers');
    }

    if (poor > samples.length * 0.3) {
      recommendations.push(
        'Too many poor quality samples - try recording in a quieter environment'
      );
    }

    return {
      ready,
      progress,
      recommendations,
      stats: {
        total: samples.length,
        good,
        fair,
        poor,
        speakers,
      },
    };
  }

  /**
   * Delete a dataset
   */
  async deleteDataset(datasetId: string): Promise<void> {
    const dataset = this.datasets.get(datasetId);
    if (!dataset) {
      throw new Error(`Dataset not found: ${datasetId}`);
    }

    // Delete sample files
    const samplesDir = path.join(this.storagePath, 'samples', datasetId);
    if (await fs.pathExists(samplesDir)) {
      await fs.remove(samplesDir);
    }

    // Delete export if exists
    if (dataset.exportPath && (await fs.pathExists(dataset.exportPath))) {
      await fs.remove(dataset.exportPath);
    }

    this.datasets.delete(datasetId);
    await this.saveDatasets();

    logger.info('Deleted dataset', { datasetId });
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    await this.saveDatasets();
    this.datasets.clear();
    this.initialized = false;
    logger.info('CustomWakeWordTrainer cleaned up');
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let instance: CustomWakeWordTrainer | null = null;

/**
 * Get the CustomWakeWordTrainer singleton
 */
export function getCustomWakeWordTrainer(): CustomWakeWordTrainer {
  if (!instance) {
    instance = new CustomWakeWordTrainer();
  }
  return instance;
}

/**
 * Initialize the CustomWakeWordTrainer
 */
export async function initializeCustomWakeWordTrainer(
  config?: Partial<WakeWordTrainingConfig>
): Promise<CustomWakeWordTrainer> {
  if (!instance) {
    instance = new CustomWakeWordTrainer(config);
  }
  await instance.initialize();
  return instance;
}

/**
 * Cleanup the CustomWakeWordTrainer
 */
export async function cleanupCustomWakeWordTrainer(): Promise<void> {
  if (instance) {
    await instance.cleanup();
    instance = null;
  }
}
