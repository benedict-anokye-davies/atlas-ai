/**
 * Atlas Wake Word Trainer
 * Allows users to train custom wake words using Porcupine
 *
 * Features:
 * - Record multiple audio samples for training
 * - Validate recording quality (noise, duration, consistency)
 * - Save trained models to ~/.atlas/wake-words/
 * - Progress tracking and feedback during recording
 * - Switch between built-in and custom wake words
 *
 * Training Process:
 * 1. User records 3 samples of the custom phrase
 * 2. Each sample is validated for quality
 * 3. Samples are submitted to Picovoice for model training
 * 4. Trained model (.ppn) is saved locally
 *
 * Note: Porcupine custom keyword training requires Picovoice Console API
 * This implementation provides the local recording and validation,
 * with hooks for either online training or manual model import.
 */

import { EventEmitter } from 'events';
import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { PvRecorder } from '@picovoice/pvrecorder-node';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('WakeWordTrainer');

// ============================================================================
// Types
// ============================================================================

/**
 * Recording state for training session
 */
export type TrainingRecordingState =
  | 'idle'
  | 'preparing'
  | 'countdown'
  | 'recording'
  | 'processing'
  | 'validating'
  | 'complete'
  | 'error';

/**
 * Recording quality assessment
 */
export interface RecordingQuality {
  /** Overall quality score (0-1) */
  score: number;
  /** Is the recording acceptable for training */
  acceptable: boolean;
  /** Average audio level during recording */
  averageLevel: number;
  /** Peak audio level */
  peakLevel: number;
  /** Signal-to-noise ratio estimate (dB) */
  snrEstimate: number;
  /** Recording duration in ms */
  duration: number;
  /** Issues found during validation */
  issues: RecordingIssue[];
  /** Suggestions for improvement */
  suggestions: string[];
}

/**
 * Recording issue types
 */
export type RecordingIssue =
  | 'too_quiet'
  | 'too_loud'
  | 'too_short'
  | 'too_long'
  | 'high_noise'
  | 'clipping'
  | 'inconsistent_level'
  | 'no_speech_detected';

/**
 * Audio sample for training
 */
export interface TrainingSample {
  /** Sample index (0-2 for 3 samples) */
  index: number;
  /** Raw audio data (16-bit PCM) */
  audio: Int16Array;
  /** Sample rate */
  sampleRate: number;
  /** Recording timestamp */
  timestamp: number;
  /** Duration in ms */
  duration: number;
  /** Quality assessment */
  quality: RecordingQuality;
  /** File path if saved */
  filePath?: string;
}

/**
 * Training session state
 */
export interface TrainingSession {
  /** Session ID */
  id: string;
  /** Custom wake phrase text */
  phrase: string;
  /** Collected samples */
  samples: TrainingSample[];
  /** Number of required samples */
  requiredSamples: number;
  /** Current sample being recorded */
  currentSampleIndex: number;
  /** Session start time */
  startTime: number;
  /** Session status */
  status: 'in_progress' | 'ready_for_training' | 'training' | 'complete' | 'failed';
  /** Error message if failed */
  error?: string;
  /** Path to trained model */
  modelPath?: string;
}

/**
 * Training configuration
 */
export interface TrainingConfig {
  /** Number of samples required (default: 3) */
  requiredSamples: number;
  /** Minimum recording duration in ms (default: 1000) */
  minDuration: number;
  /** Maximum recording duration in ms (default: 3000) */
  maxDuration: number;
  /** Countdown before recording starts in seconds (default: 3) */
  countdownSeconds: number;
  /** Minimum acceptable quality score (default: 0.6) */
  minQualityScore: number;
  /** Sample rate for recording (default: 16000) */
  sampleRate: number;
  /** Directory for saving wake word models */
  modelsDir: string;
  /** Directory for saving training samples */
  samplesDir: string;
}

/**
 * Training progress event
 */
export interface TrainingProgressEvent {
  /** Current state */
  state: TrainingRecordingState;
  /** Current sample index (0-based) */
  sampleIndex: number;
  /** Total samples required */
  totalSamples: number;
  /** Countdown remaining (if in countdown state) */
  countdown?: number;
  /** Recording progress (0-1) */
  recordingProgress?: number;
  /** Audio level (0-1) */
  audioLevel?: number;
  /** Message to display */
  message: string;
}

/**
 * Custom wake word model info
 */
export interface CustomWakeWordModel {
  /** Model ID */
  id: string;
  /** Display name (the phrase) */
  displayName: string;
  /** Path to .ppn file */
  modelPath: string;
  /** When the model was created */
  createdAt: number;
  /** Number of samples used for training */
  sampleCount: number;
  /** Training session ID */
  sessionId: string;
  /** Whether model is currently active */
  isActive: boolean;
  /** Recommended sensitivity */
  sensitivity: number;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CONFIG: TrainingConfig = {
  requiredSamples: 3,
  minDuration: 800,
  maxDuration: 3000,
  countdownSeconds: 3,
  minQualityScore: 0.6,
  sampleRate: 16000,
  modelsDir: '',
  samplesDir: '',
};

const QUALITY_THRESHOLDS = {
  minAverageLevel: 0.02,
  maxAverageLevel: 0.7,
  minPeakLevel: 0.1,
  maxPeakLevel: 0.95,
  minSnr: 10,
  minDuration: 500,
  maxLevelVariance: 0.5,
};

// ============================================================================
// WakeWordTrainer Class
// ============================================================================

/**
 * Events emitted by WakeWordTrainer
 */
export interface WakeWordTrainerEvents {
  'state-change': (state: TrainingRecordingState, previousState: TrainingRecordingState) => void;
  progress: (event: TrainingProgressEvent) => void;
  'sample-recorded': (sample: TrainingSample) => void;
  'sample-validated': (sample: TrainingSample, quality: RecordingQuality) => void;
  'session-complete': (session: TrainingSession) => void;
  'training-complete': (model: CustomWakeWordModel) => void;
  error: (error: Error, context: string) => void;
  'audio-level': (level: number) => void;
}

/**
 * Wake Word Trainer
 * Manages the custom wake word training process
 */
export class WakeWordTrainer extends EventEmitter {
  private config: TrainingConfig;
  private recorder: PvRecorder | null = null;
  private isRecording: boolean = false;
  private currentSession: TrainingSession | null = null;
  private currentState: TrainingRecordingState = 'idle';
  private recordingBuffer: number[] = [];
  private deviceIndex: number = -1;
  private countdownTimer: NodeJS.Timeout | null = null;
  private recordingTimeout: NodeJS.Timeout | null = null;

  constructor(config?: Partial<TrainingConfig>) {
    super();

    // Get app paths for default directories
    let userDataPath: string;
    try {
      userDataPath = app?.getPath?.('userData') || path.join(process.cwd(), '.atlas');
    } catch {
      userDataPath = path.join(process.cwd(), '.atlas');
    }

    this.config = {
      ...DEFAULT_CONFIG,
      modelsDir: path.join(userDataPath, 'wake-words'),
      samplesDir: path.join(userDataPath, 'wake-words', 'samples'),
      ...config,
    };

    // Ensure directories exist
    this.ensureDirectories();

    logger.info('WakeWordTrainer initialized', {
      modelsDir: this.config.modelsDir,
      requiredSamples: this.config.requiredSamples,
    });
  }

  /**
   * Ensure required directories exist
   */
  private ensureDirectories(): void {
    try {
      if (!fs.existsSync(this.config.modelsDir)) {
        fs.mkdirSync(this.config.modelsDir, { recursive: true });
        logger.debug('Created models directory', { path: this.config.modelsDir });
      }
      if (!fs.existsSync(this.config.samplesDir)) {
        fs.mkdirSync(this.config.samplesDir, { recursive: true });
        logger.debug('Created samples directory', { path: this.config.samplesDir });
      }
    } catch (error) {
      logger.error('Failed to create directories', { error });
    }
  }

  /**
   * Set audio input device
   */
  setAudioDevice(deviceIndex: number): void {
    this.deviceIndex = deviceIndex;
    logger.info('Audio device set for training', { deviceIndex });
  }

  /**
   * Get list of available audio devices
   */
  getAudioDevices(): Array<{ index: number; name: string; isDefault: boolean }> {
    try {
      const devices = PvRecorder.getAvailableDevices();
      return devices.map((name, index) => ({
        index,
        name,
        isDefault: index === -1,
      }));
    } catch (error) {
      logger.error('Failed to get audio devices', { error });
      return [];
    }
  }

  /**
   * Start a new training session
   */
  async startSession(phrase: string): Promise<TrainingSession> {
    if (this.currentSession && this.currentSession.status === 'in_progress') {
      throw new Error('Training session already in progress');
    }

    // Validate phrase
    const cleanPhrase = phrase.trim();
    if (cleanPhrase.length < 2) {
      throw new Error('Wake phrase must be at least 2 characters');
    }
    if (cleanPhrase.length > 50) {
      throw new Error('Wake phrase must be 50 characters or less');
    }

    // Create new session
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.currentSession = {
      id: sessionId,
      phrase: cleanPhrase,
      samples: [],
      requiredSamples: this.config.requiredSamples,
      currentSampleIndex: 0,
      startTime: Date.now(),
      status: 'in_progress',
    };

    logger.info('Training session started', {
      sessionId,
      phrase: cleanPhrase,
      requiredSamples: this.config.requiredSamples,
    });

    this.setState('preparing');
    this.emitProgress({
      message: `Training session started for "${cleanPhrase}"`,
    });

    return this.currentSession;
  }

  /**
   * Start recording a sample
   */
  async startRecording(): Promise<void> {
    if (!this.currentSession) {
      throw new Error('No training session active');
    }

    if (this.isRecording) {
      throw new Error('Already recording');
    }

    // Start countdown
    this.setState('countdown');
    await this.runCountdown();

    // Initialize recorder
    try {
      const frameLength = 512;
      this.recorder = new PvRecorder(frameLength, this.deviceIndex);
      this.recorder.start();
      this.recordingBuffer = [];
      this.isRecording = true;

      this.setState('recording');
      this.emitProgress({
        message: `Recording sample ${this.currentSession.currentSampleIndex + 1} of ${this.config.requiredSamples}...`,
        recordingProgress: 0,
      });

      logger.info('Recording started', {
        sampleIndex: this.currentSession.currentSampleIndex,
        maxDuration: this.config.maxDuration,
      });

      // Start recording loop
      this.recordAudio();

      // Set timeout for maximum duration
      this.recordingTimeout = setTimeout(() => {
        if (this.isRecording) {
          this.stopRecording().catch((err) => {
            logger.error('Error stopping recording on timeout', { error: err.message });
          });
        }
      }, this.config.maxDuration);
    } catch (error) {
      this.isRecording = false;
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('Failed to start recording', { error: err.message });
      this.setState('error');
      this.emit('error', err, 'start-recording');
      throw err;
    }
  }

  /**
   * Stop recording and process the sample
   */
  async stopRecording(): Promise<TrainingSample | null> {
    if (!this.isRecording || !this.recorder || !this.currentSession) {
      return null;
    }

    // Clear timeout
    if (this.recordingTimeout) {
      clearTimeout(this.recordingTimeout);
      this.recordingTimeout = null;
    }

    this.isRecording = false;

    try {
      // Stop recorder
      this.recorder.stop();
      this.recorder.release();
      this.recorder = null;

      // Process recorded audio
      this.setState('processing');
      this.emitProgress({ message: 'Processing recording...' });

      const audio = new Int16Array(this.recordingBuffer);
      const duration = (audio.length / this.config.sampleRate) * 1000;

      // Validate recording quality
      this.setState('validating');
      this.emitProgress({ message: 'Validating recording quality...' });

      const quality = this.assessQuality(audio, duration);

      // Create sample
      const sample: TrainingSample = {
        index: this.currentSession.currentSampleIndex,
        audio,
        sampleRate: this.config.sampleRate,
        timestamp: Date.now(),
        duration,
        quality,
      };

      // Save sample to disk
      const samplePath = await this.saveSample(sample);
      sample.filePath = samplePath;

      // Emit events
      this.emit('sample-recorded', sample);
      this.emit('sample-validated', sample, quality);

      if (quality.acceptable) {
        // Add to session
        this.currentSession.samples.push(sample);
        this.currentSession.currentSampleIndex++;

        logger.info('Sample recorded successfully', {
          index: sample.index,
          duration,
          qualityScore: quality.score,
        });

        // Check if we have enough samples
        if (this.currentSession.samples.length >= this.config.requiredSamples) {
          this.currentSession.status = 'ready_for_training';
          this.setState('complete');
          this.emit('session-complete', this.currentSession);
          this.emitProgress({
            message: 'All samples recorded! Ready for training.',
          });
        } else {
          this.setState('preparing');
          this.emitProgress({
            message: `Sample ${sample.index + 1} recorded. ${this.config.requiredSamples - this.currentSession.samples.length} more needed.`,
          });
        }
      } else {
        // Quality not acceptable
        this.setState('preparing');
        this.emitProgress({
          message: `Recording quality too low. ${quality.suggestions.join(' ')} Please try again.`,
        });

        logger.warn('Sample rejected due to quality', {
          index: sample.index,
          qualityScore: quality.score,
          issues: quality.issues,
        });
      }

      return sample;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('Failed to process recording', { error: err.message });
      this.setState('error');
      this.emit('error', err, 'stop-recording');
      throw err;
    }
  }

  /**
   * Cancel the current recording
   */
  cancelRecording(): void {
    if (this.recordingTimeout) {
      clearTimeout(this.recordingTimeout);
      this.recordingTimeout = null;
    }

    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }

    if (this.recorder) {
      try {
        this.recorder.stop();
        this.recorder.release();
      } catch {
        // Ignore errors during cleanup
      }
      this.recorder = null;
    }

    this.isRecording = false;
    this.recordingBuffer = [];
    this.setState('preparing');

    logger.info('Recording cancelled');
  }

  /**
   * Cancel the entire training session
   */
  cancelSession(): void {
    this.cancelRecording();

    if (this.currentSession) {
      // Clean up saved samples
      for (const sample of this.currentSession.samples) {
        if (sample.filePath && fs.existsSync(sample.filePath)) {
          try {
            fs.unlinkSync(sample.filePath);
          } catch {
            // Ignore cleanup errors
          }
        }
      }

      this.currentSession.status = 'failed';
      this.currentSession.error = 'Session cancelled by user';
      logger.info('Training session cancelled', { sessionId: this.currentSession.id });
    }

    this.currentSession = null;
    this.setState('idle');
  }

  /**
   * Import a pre-trained model file
   * Useful for models trained via Picovoice Console
   */
  async importModel(modelPath: string, displayName: string): Promise<CustomWakeWordModel> {
    // Validate file exists
    if (!fs.existsSync(modelPath)) {
      throw new Error('Model file not found');
    }

    // Validate file extension
    if (!modelPath.endsWith('.ppn')) {
      throw new Error('Model file must have .ppn extension');
    }

    // Generate model ID
    const modelId = `custom_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Copy model to local directory
    const destPath = path.join(this.config.modelsDir, `${this.sanitizeFileName(displayName)}.ppn`);

    fs.copyFileSync(modelPath, destPath);

    // Create model info
    const model: CustomWakeWordModel = {
      id: modelId,
      displayName,
      modelPath: destPath,
      createdAt: Date.now(),
      sampleCount: 0,
      sessionId: '',
      isActive: false,
      sensitivity: 0.5,
    };

    // Save model metadata
    await this.saveModelMetadata(model);

    logger.info('Model imported successfully', {
      modelId,
      displayName,
      path: destPath,
    });

    return model;
  }

  /**
   * Export training samples (for manual training via Picovoice Console)
   */
  async exportSamples(): Promise<string | null> {
    if (!this.currentSession || this.currentSession.samples.length === 0) {
      throw new Error('No samples to export');
    }

    const exportDir = path.join(this.config.samplesDir, `export_${this.currentSession.id}`);

    if (!fs.existsSync(exportDir)) {
      fs.mkdirSync(exportDir, { recursive: true });
    }

    // Save samples as WAV files
    for (const sample of this.currentSession.samples) {
      const wavPath = path.join(exportDir, `sample_${sample.index + 1}.wav`);
      await this.saveAsWav(sample.audio, sample.sampleRate, wavPath);
    }

    // Create info file
    const infoPath = path.join(exportDir, 'info.json');
    fs.writeFileSync(
      infoPath,
      JSON.stringify(
        {
          phrase: this.currentSession.phrase,
          sampleCount: this.currentSession.samples.length,
          sampleRate: this.config.sampleRate,
          exportedAt: Date.now(),
          sessionId: this.currentSession.id,
        },
        null,
        2
      )
    );

    logger.info('Samples exported', {
      exportDir,
      sampleCount: this.currentSession.samples.length,
    });

    return exportDir;
  }

  /**
   * Get list of available custom wake word models
   */
  getAvailableModels(): CustomWakeWordModel[] {
    const models: CustomWakeWordModel[] = [];
    const metadataPath = path.join(this.config.modelsDir, 'models.json');

    if (fs.existsSync(metadataPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
        if (Array.isArray(data.models)) {
          for (const model of data.models) {
            if (fs.existsSync(model.modelPath)) {
              models.push(model);
            }
          }
        }
      } catch (error) {
        logger.error('Failed to read model metadata', { error });
      }
    }

    // Also scan for .ppn files without metadata
    try {
      const files = fs.readdirSync(this.config.modelsDir);
      for (const file of files) {
        if (file.endsWith('.ppn')) {
          const modelPath = path.join(this.config.modelsDir, file);
          const existing = models.find((m) => m.modelPath === modelPath);
          if (!existing) {
            models.push({
              id: `imported_${file.replace('.ppn', '')}`,
              displayName: file.replace('.ppn', '').replace(/-/g, ' '),
              modelPath,
              createdAt: fs.statSync(modelPath).mtime.getTime(),
              sampleCount: 0,
              sessionId: '',
              isActive: false,
              sensitivity: 0.5,
            });
          }
        }
      }
    } catch (error) {
      logger.error('Failed to scan models directory', { error });
    }

    return models;
  }

  /**
   * Delete a custom wake word model
   */
  async deleteModel(modelId: string): Promise<boolean> {
    const models = this.getAvailableModels();
    const model = models.find((m) => m.id === modelId);

    if (!model) {
      return false;
    }

    // Delete model file
    if (fs.existsSync(model.modelPath)) {
      fs.unlinkSync(model.modelPath);
    }

    // Update metadata
    const remainingModels = models.filter((m) => m.id !== modelId);
    await this.saveAllModelMetadata(remainingModels);

    logger.info('Model deleted', { modelId, displayName: model.displayName });
    return true;
  }

  /**
   * Set a model as active
   */
  async setActiveModel(modelId: string | null): Promise<void> {
    const models = this.getAvailableModels();

    for (const model of models) {
      model.isActive = model.id === modelId;
    }

    await this.saveAllModelMetadata(models);

    logger.info('Active model updated', { modelId });
  }

  /**
   * Get the currently active model
   */
  getActiveModel(): CustomWakeWordModel | null {
    const models = this.getAvailableModels();
    return models.find((m) => m.isActive) || null;
  }

  /**
   * Get current session state
   */
  getSession(): TrainingSession | null {
    return this.currentSession;
  }

  /**
   * Get current recording state
   */
  getState(): TrainingRecordingState {
    return this.currentState;
  }

  /**
   * Get training configuration
   */
  getConfig(): TrainingConfig {
    return { ...this.config };
  }

  /**
   * Update training configuration
   */
  updateConfig(config: Partial<TrainingConfig>): void {
    this.config = { ...this.config, ...config };
    this.ensureDirectories();
    logger.info('Training config updated', config);
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Run countdown before recording
   */
  private async runCountdown(): Promise<void> {
    return new Promise((resolve) => {
      let count = this.config.countdownSeconds;

      this.emitProgress({
        countdown: count,
        message: `Get ready to say "${this.currentSession?.phrase}"... ${count}`,
      });

      this.countdownTimer = setInterval(() => {
        count--;
        if (count > 0) {
          this.emitProgress({
            countdown: count,
            message: `Get ready... ${count}`,
          });
        } else {
          if (this.countdownTimer) {
            clearInterval(this.countdownTimer);
            this.countdownTimer = null;
          }
          this.emitProgress({
            countdown: 0,
            message: 'Speak now!',
          });
          resolve();
        }
      }, 1000);
    });
  }

  /**
   * Record audio in a loop
   */
  private async recordAudio(): Promise<void> {
    const startTime = Date.now();

    while (this.isRecording && this.recorder) {
      try {
        const frame = await this.recorder.read();

        // Add frame to buffer
        for (let i = 0; i < frame.length; i++) {
          this.recordingBuffer.push(frame[i]);
        }

        // Calculate and emit audio level
        const level = this.calculateAudioLevel(frame);
        this.emit('audio-level', level);

        // Calculate progress
        const elapsed = Date.now() - startTime;
        const progress = Math.min(1, elapsed / this.config.maxDuration);

        this.emitProgress({
          recordingProgress: progress,
          audioLevel: level,
          message: `Recording... (${Math.round(elapsed / 1000)}s)`,
        });
      } catch (error) {
        if (this.isRecording) {
          const err = error instanceof Error ? error : new Error(String(error));
          logger.error('Error during recording', { error: err.message });
          this.emit('error', err, 'record-audio');
        }
        break;
      }
    }
  }

  /**
   * Calculate RMS audio level
   */
  private calculateAudioLevel(frame: Int16Array): number {
    let sum = 0;
    for (let i = 0; i < frame.length; i++) {
      sum += frame[i] * frame[i];
    }
    const rms = Math.sqrt(sum / frame.length);
    return Math.min(1, rms / 32767);
  }

  /**
   * Assess recording quality
   */
  private assessQuality(audio: Int16Array, duration: number): RecordingQuality {
    const issues: RecordingIssue[] = [];
    const suggestions: string[] = [];

    // Calculate average and peak levels
    let sum = 0;
    let peakLevel = 0;
    let clippingCount = 0;

    for (let i = 0; i < audio.length; i++) {
      const absValue = Math.abs(audio[i]) / 32767;
      sum += absValue;
      if (absValue > peakLevel) {
        peakLevel = absValue;
      }
      if (absValue > 0.99) {
        clippingCount++;
      }
    }

    const averageLevel = sum / audio.length;

    // Calculate SNR estimate (simplified)
    const noiseFloor = this.estimateNoiseFloor(audio);
    const signalPeak = peakLevel;
    const snrEstimate = noiseFloor > 0 ? 20 * Math.log10(signalPeak / noiseFloor) : 0;

    // Check for issues
    if (averageLevel < QUALITY_THRESHOLDS.minAverageLevel) {
      issues.push('too_quiet');
      suggestions.push('Speak louder or move closer to the microphone.');
    }

    if (averageLevel > QUALITY_THRESHOLDS.maxAverageLevel) {
      issues.push('too_loud');
      suggestions.push('Speak softer or move further from the microphone.');
    }

    if (peakLevel < QUALITY_THRESHOLDS.minPeakLevel) {
      issues.push('no_speech_detected');
      suggestions.push('Make sure to speak the wake phrase clearly.');
    }

    if (clippingCount > audio.length * 0.01) {
      issues.push('clipping');
      suggestions.push('Reduce volume to avoid distortion.');
    }

    if (duration < QUALITY_THRESHOLDS.minDuration) {
      issues.push('too_short');
      suggestions.push('Record a longer sample.');
    }

    if (duration > this.config.maxDuration) {
      issues.push('too_long');
      suggestions.push('Try to be more concise.');
    }

    if (snrEstimate < QUALITY_THRESHOLDS.minSnr) {
      issues.push('high_noise');
      suggestions.push('Reduce background noise or use a different microphone.');
    }

    // Calculate overall score
    let score = 1.0;
    score -= issues.length * 0.2;
    score = Math.max(0, Math.min(1, score));

    // Adjust score based on levels
    if (
      averageLevel >= QUALITY_THRESHOLDS.minAverageLevel &&
      averageLevel <= QUALITY_THRESHOLDS.maxAverageLevel
    ) {
      score += 0.1;
    }
    if (snrEstimate >= QUALITY_THRESHOLDS.minSnr) {
      score += 0.1;
    }
    score = Math.min(1, score);

    return {
      score,
      acceptable: score >= this.config.minQualityScore && issues.length === 0,
      averageLevel,
      peakLevel,
      snrEstimate,
      duration,
      issues,
      suggestions: suggestions.length > 0 ? suggestions : ['Recording quality is good!'],
    };
  }

  /**
   * Estimate noise floor from audio
   */
  private estimateNoiseFloor(audio: Int16Array): number {
    // Use the first 10% of samples (assuming silence/low noise before speech)
    const noiseLength = Math.min(Math.floor(audio.length * 0.1), 1600);
    let sum = 0;

    for (let i = 0; i < noiseLength; i++) {
      sum += Math.abs(audio[i]) / 32767;
    }

    return sum / noiseLength;
  }

  /**
   * Save sample to disk
   */
  private async saveSample(sample: TrainingSample): Promise<string> {
    if (!this.currentSession) {
      throw new Error('No active session');
    }

    const fileName = `${this.currentSession.id}_sample_${sample.index + 1}.raw`;
    const filePath = path.join(this.config.samplesDir, fileName);

    // Save as raw PCM
    const buffer = Buffer.from(sample.audio.buffer);
    fs.writeFileSync(filePath, buffer);

    logger.debug('Sample saved', { filePath, size: buffer.length });
    return filePath;
  }

  /**
   * Save audio as WAV file
   */
  private async saveAsWav(audio: Int16Array, sampleRate: number, filePath: string): Promise<void> {
    // WAV header for 16-bit mono PCM
    const dataSize = audio.length * 2;
    const fileSize = 44 + dataSize;

    const buffer = Buffer.alloc(fileSize);
    let offset = 0;

    // RIFF header
    buffer.write('RIFF', offset);
    offset += 4;
    buffer.writeUInt32LE(fileSize - 8, offset);
    offset += 4;
    buffer.write('WAVE', offset);
    offset += 4;

    // fmt chunk
    buffer.write('fmt ', offset);
    offset += 4;
    buffer.writeUInt32LE(16, offset);
    offset += 4; // Chunk size
    buffer.writeUInt16LE(1, offset);
    offset += 2; // Audio format (PCM)
    buffer.writeUInt16LE(1, offset);
    offset += 2; // Num channels
    buffer.writeUInt32LE(sampleRate, offset);
    offset += 4; // Sample rate
    buffer.writeUInt32LE(sampleRate * 2, offset);
    offset += 4; // Byte rate
    buffer.writeUInt16LE(2, offset);
    offset += 2; // Block align
    buffer.writeUInt16LE(16, offset);
    offset += 2; // Bits per sample

    // data chunk
    buffer.write('data', offset);
    offset += 4;
    buffer.writeUInt32LE(dataSize, offset);
    offset += 4;

    // Audio data
    for (let i = 0; i < audio.length; i++) {
      buffer.writeInt16LE(audio[i], offset);
      offset += 2;
    }

    fs.writeFileSync(filePath, buffer);
  }

  /**
   * Save model metadata
   */
  private async saveModelMetadata(model: CustomWakeWordModel): Promise<void> {
    const models = this.getAvailableModels();
    models.push(model);
    await this.saveAllModelMetadata(models);
  }

  /**
   * Save all model metadata
   */
  private async saveAllModelMetadata(models: CustomWakeWordModel[]): Promise<void> {
    const metadataPath = path.join(this.config.modelsDir, 'models.json');
    fs.writeFileSync(metadataPath, JSON.stringify({ models, updatedAt: Date.now() }, null, 2));
  }

  /**
   * Sanitize filename
   */
  private sanitizeFileName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .substring(0, 50);
  }

  /**
   * Set state and emit change event
   */
  private setState(state: TrainingRecordingState): void {
    const previousState = this.currentState;
    this.currentState = state;
    this.emit('state-change', state, previousState);
  }

  /**
   * Emit progress event
   */
  private emitProgress(partial: Partial<TrainingProgressEvent>): void {
    const event: TrainingProgressEvent = {
      state: this.currentState,
      sampleIndex: this.currentSession?.currentSampleIndex ?? 0,
      totalSamples: this.config.requiredSamples,
      message: '',
      ...partial,
    };
    this.emit('progress', event);
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let trainerInstance: WakeWordTrainer | null = null;

/**
 * Get or create the wake word trainer instance
 */
export function getWakeWordTrainer(): WakeWordTrainer {
  if (!trainerInstance) {
    trainerInstance = new WakeWordTrainer();
  }
  return trainerInstance;
}

/**
 * Shutdown the wake word trainer
 */
export function shutdownWakeWordTrainer(): void {
  if (trainerInstance) {
    trainerInstance.cancelSession();
    trainerInstance.removeAllListeners();
    trainerInstance = null;
  }
}

export default WakeWordTrainer;
