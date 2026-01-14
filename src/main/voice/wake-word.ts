/**
 * Nova Wake Word Detector
 * Uses Picovoice Porcupine for "Hey Nova" detection
 *
 * Features:
 * - Confidence thresholding to reduce false positives
 * - Visual feedback events for UI synchronization
 * - Multiple wake phrase support
 * - Audio level normalization and history tracking
 * - Adaptive sensitivity based on ambient noise
 *
 * Note: Since "Nova" is not a built-in keyword, we use "Jarvis" as a placeholder
 * until a custom wake word model is trained via Picovoice Console.
 * For production, train a custom "Hey Nova" model at https://console.picovoice.ai/
 */

import { Porcupine, BuiltinKeyword } from '@picovoice/porcupine-node';
import { PvRecorder } from '@picovoice/pvrecorder-node';
import { EventEmitter } from 'events';
import { BrowserWindow } from 'electron';
import {
  WakeWordEvent,
  WakeWordConfig,
  AudioDevice,
  BuiltInKeyword,
} from '../../shared/types/voice';
import { createModuleLogger } from '../utils/logger';
import { getConfig } from '../config';

const logger = createModuleLogger('WakeWord');

/**
 * Map our keyword type to Porcupine's BuiltinKeyword enum
 */
function toBuiltinKeyword(keyword: BuiltInKeyword): BuiltinKeyword {
  const keywordMap: Record<BuiltInKeyword, BuiltinKeyword> = {
    alexa: BuiltinKeyword.ALEXA,
    americano: BuiltinKeyword.AMERICANO,
    blueberry: BuiltinKeyword.BLUEBERRY,
    bumblebee: BuiltinKeyword.BUMBLEBEE,
    computer: BuiltinKeyword.COMPUTER,
    grapefruit: BuiltinKeyword.GRAPEFRUIT,
    grasshopper: BuiltinKeyword.GRASSHOPPER,
    'hey google': BuiltinKeyword.HEY_GOOGLE,
    'hey siri': BuiltinKeyword.HEY_SIRI,
    jarvis: BuiltinKeyword.JARVIS,
    'ok google': BuiltinKeyword.OK_GOOGLE,
    picovoice: BuiltinKeyword.PICOVOICE,
    porcupine: BuiltinKeyword.PORCUPINE,
    terminator: BuiltinKeyword.TERMINATOR,
  };
  return keywordMap[keyword];
}

/**
 * Wake word detection feedback types
 */
export type WakeWordFeedbackType =
  | 'detected' // Wake word detected and validated
  | 'rejected' // Wake word detected but below confidence threshold
  | 'cooldown' // Wake word detected but in cooldown period
  | 'listening' // Actively listening for wake word
  | 'ready'; // Ready to detect wake word

/**
 * Wake word feedback event for UI
 */
export interface WakeWordFeedback {
  type: WakeWordFeedbackType;
  timestamp: number;
  keyword?: string;
  confidence?: number;
  threshold?: number;
  audioLevel?: number;
  message?: string;
}

/**
 * Detection statistics for monitoring
 */
export interface DetectionStats {
  totalDetections: number;
  acceptedDetections: number;
  rejectedDetections: number;
  cooldownRejections: number;
  averageConfidence: number;
  lastDetectionTime: number;
  uptime: number;
}

/**
 * Extended wake word event with confidence details
 */
export interface ExtendedWakeWordEvent extends WakeWordEvent {
  /** Raw detection confidence from Porcupine (based on sensitivity) */
  rawConfidence: number;
  /** Computed confidence based on audio analysis */
  computedConfidence: number;
  /** Whether detection passed threshold validation */
  passedThreshold: boolean;
  /** Audio level at time of detection */
  audioLevel: number;
  /** Ambient noise level estimate */
  ambientLevel: number;
}

/**
 * Wake Word Detector Events
 */
export interface WakeWordDetectorEvents {
  wake: (event: ExtendedWakeWordEvent) => void;
  error: (error: Error) => void;
  started: () => void;
  stopped: () => void;
  'audio-level': (level: number) => void;
  feedback: (feedback: WakeWordFeedback) => void;
  'detection-stats': (stats: DetectionStats) => void;
}

/**
 * Confidence thresholding configuration
 */
export interface ConfidenceConfig {
  /** Minimum confidence threshold (0-1), detections below this are rejected */
  minThreshold: number;
  /** Require audio level above this to validate detection */
  minAudioLevel: number;
  /** Number of recent audio levels to track for ambient estimation */
  audioHistorySize: number;
  /** Multiplier for ambient noise to set dynamic threshold */
  ambientMultiplier: number;
  /** Enable adaptive thresholding based on ambient noise */
  adaptiveThreshold: boolean;
}

/**
 * Default confidence configuration
 */
const DEFAULT_CONFIDENCE_CONFIG: ConfidenceConfig = {
  minThreshold: 0.6,
  minAudioLevel: 0.02,
  audioHistorySize: 50,
  ambientMultiplier: 2.5,
  adaptiveThreshold: true,
};

/**
 * WakeWordDetector class
 * Listens for wake word and emits events when detected
 * Includes confidence thresholding and visual feedback
 */
export class WakeWordDetector extends EventEmitter {
  private porcupine: Porcupine | null = null;
  private recorder: PvRecorder | null = null;
  private isRunning: boolean = false;
  private isPaused: boolean = false;
  private keywords: BuiltInKeyword[];
  private sensitivities: number[];
  private accessKey: string;
  private cooldownMs: number = 2000; // 2 second cooldown between triggers
  private lastTriggerTime: number = 0;
  private deviceIndex: number = -1; // -1 = default device
  private startTime: number = 0;

  // Confidence thresholding
  private confidenceConfig: ConfidenceConfig;
  private audioLevelHistory: number[] = [];
  private ambientNoiseLevel: number = 0;

  // Detection statistics
  private stats: DetectionStats = {
    totalDetections: 0,
    acceptedDetections: 0,
    rejectedDetections: 0,
    cooldownRejections: 0,
    averageConfidence: 0,
    lastDetectionTime: 0,
    uptime: 0,
  };
  private confidenceSum: number = 0;

  // Visual feedback
  private sendVisualFeedback: boolean = true;

  constructor(config?: Partial<WakeWordConfig & { confidence?: Partial<ConfidenceConfig> }>) {
    super();
    const novaConfig = getConfig();

    this.accessKey = config?.accessKey || novaConfig.porcupineApiKey;
    // Default to "jarvis" as placeholder for "hey nova"
    this.keywords = config?.keywords || ['jarvis'];
    this.sensitivities =
      config?.sensitivities || this.keywords.map(() => novaConfig.wakeWordSensitivity);

    // Initialize confidence config
    this.confidenceConfig = {
      ...DEFAULT_CONFIDENCE_CONFIG,
      ...config?.confidence,
    };

    logger.info('WakeWordDetector initialized', {
      keywords: this.keywords,
      sensitivities: this.sensitivities,
      confidenceThreshold: this.confidenceConfig.minThreshold,
      adaptiveThreshold: this.confidenceConfig.adaptiveThreshold,
    });
  }

  /**
   * Get available audio input devices
   */
  static getAudioDevices(): AudioDevice[] {
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
   * Set the audio input device
   */
  setAudioDevice(deviceIndex: number): void {
    this.deviceIndex = deviceIndex;
    logger.info('Audio device set', { deviceIndex });
  }

  /**
   * Set wake word sensitivity (0.0 - 1.0)
   */
  setSensitivity(sensitivity: number): void {
    if (sensitivity < 0 || sensitivity > 1) {
      throw new Error('Sensitivity must be between 0 and 1');
    }
    this.sensitivities = this.keywords.map(() => sensitivity);
    logger.info('Sensitivity updated', { sensitivity });

    // If running, restart with new sensitivity
    if (this.isRunning) {
      this.restart();
    }
  }

  /**
   * Set cooldown period between wake word triggers
   */
  setCooldown(ms: number): void {
    this.cooldownMs = ms;
    logger.info('Cooldown updated', { cooldownMs: ms });
  }

  /**
   * Set confidence threshold (0.0 - 1.0)
   */
  setConfidenceThreshold(threshold: number): void {
    if (threshold < 0 || threshold > 1) {
      throw new Error('Confidence threshold must be between 0 and 1');
    }
    this.confidenceConfig.minThreshold = threshold;
    logger.info('Confidence threshold updated', { threshold });
  }

  /**
   * Enable or disable visual feedback events
   */
  setVisualFeedback(enabled: boolean): void {
    this.sendVisualFeedback = enabled;
    logger.info('Visual feedback', { enabled });
  }

  /**
   * Update confidence configuration
   */
  setConfidenceConfig(config: Partial<ConfidenceConfig>): void {
    this.confidenceConfig = { ...this.confidenceConfig, ...config };
    logger.info('Confidence config updated', config);
  }

  /**
   * Get current detection statistics
   */
  getStats(): DetectionStats {
    return {
      ...this.stats,
      uptime: this.isRunning ? Date.now() - this.startTime : 0,
    };
  }

  /**
   * Reset detection statistics
   */
  resetStats(): void {
    this.stats = {
      totalDetections: 0,
      acceptedDetections: 0,
      rejectedDetections: 0,
      cooldownRejections: 0,
      averageConfidence: 0,
      lastDetectionTime: 0,
      uptime: 0,
    };
    this.confidenceSum = 0;
    logger.info('Detection stats reset');
  }

  /**
   * Initialize Porcupine and recorder
   */
  private async initialize(): Promise<void> {
    try {
      logger.debug('Initializing Porcupine...');

      // Create Porcupine instance
      this.porcupine = new Porcupine(
        this.accessKey,
        this.keywords.map(toBuiltinKeyword),
        this.sensitivities
      );

      // Create recorder with Porcupine's required frame length
      this.recorder = new PvRecorder(this.porcupine.frameLength, this.deviceIndex);

      logger.info('Porcupine initialized', {
        sampleRate: this.porcupine.sampleRate,
        frameLength: this.porcupine.frameLength,
        version: this.porcupine.version,
      });
    } catch (error) {
      logger.error('Failed to initialize Porcupine', { error });
      throw error;
    }
  }

  /**
   * Start listening for wake word
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('WakeWordDetector already running');
      return;
    }

    try {
      await this.initialize();

      if (!this.recorder || !this.porcupine) {
        throw new Error('Failed to initialize audio components');
      }

      this.recorder.start();
      this.isRunning = true;
      this.isPaused = false;
      this.startTime = Date.now();
      this.audioLevelHistory = [];
      this.ambientNoiseLevel = 0;

      logger.info('Wake word detection started');
      this.emit('started');

      // Send visual feedback
      this.emitFeedback({
        type: 'ready',
        timestamp: Date.now(),
        message: 'Wake word detection active',
      });

      // Start processing loop
      this.processAudio();
    } catch (error) {
      this.isRunning = false;
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('Failed to start wake word detection', { error: err.message });
      this.emit('error', err);
      throw err;
    }
  }

  /**
   * Stop listening for wake word
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;

    try {
      if (this.recorder) {
        this.recorder.stop();
        this.recorder.release();
        this.recorder = null;
      }

      if (this.porcupine) {
        this.porcupine.release();
        this.porcupine = null;
      }

      logger.info('Wake word detection stopped');
      this.emit('stopped');
    } catch (error) {
      logger.error('Error stopping wake word detection', { error });
    }
  }

  /**
   * Pause wake word detection (keeps resources initialized)
   */
  pause(): void {
    if (!this.isRunning || this.isPaused) {
      return;
    }
    this.isPaused = true;
    logger.debug('Wake word detection paused');
  }

  /**
   * Resume wake word detection
   */
  resume(): void {
    if (!this.isRunning || !this.isPaused) {
      return;
    }
    this.isPaused = false;
    logger.debug('Wake word detection resumed');

    // Send visual feedback
    this.emitFeedback({
      type: 'listening',
      timestamp: Date.now(),
      message: 'Listening for wake word',
    });
  }

  /**
   * Restart with current settings
   */
  private async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  /**
   * Process audio frames in a loop
   */
  private async processAudio(): Promise<void> {
    while (this.isRunning) {
      try {
        if (this.isPaused || !this.recorder || !this.porcupine) {
          await this.sleep(100);
          continue;
        }

        // Read audio frame
        const frame = await this.recorder.read();

        // Calculate audio level for visualization
        const audioLevel = this.calculateAudioLevel(frame);
        this.emit('audio-level', audioLevel);

        // Track audio level history for ambient noise estimation
        this.updateAudioHistory(audioLevel);

        // Process frame through Porcupine
        const keywordIndex = this.porcupine.process(frame);

        if (keywordIndex >= 0) {
          await this.handleDetection(keywordIndex, audioLevel);
        }
      } catch (error) {
        if (this.isRunning) {
          const err = error instanceof Error ? error : new Error(String(error));
          logger.error('Error processing audio', { error: err.message });
          this.emit('error', err);
        }
        // Small delay before retrying
        await this.sleep(100);
      }
    }
  }

  /**
   * Handle wake word detection with confidence thresholding
   */
  private async handleDetection(keywordIndex: number, audioLevel: number): Promise<void> {
    const now = Date.now();
    const keyword = this.keywords[keywordIndex];
    const rawSensitivity = this.sensitivities[keywordIndex];

    // Update stats
    this.stats.totalDetections++;
    this.stats.lastDetectionTime = now;

    // Calculate computed confidence based on audio analysis
    const computedConfidence = this.computeConfidence(audioLevel, rawSensitivity);

    // Update average confidence
    this.confidenceSum += computedConfidence;
    this.stats.averageConfidence = this.confidenceSum / this.stats.totalDetections;

    // Determine effective threshold (static or adaptive)
    const effectiveThreshold = this.getEffectiveThreshold();

    // Check cooldown
    if (now - this.lastTriggerTime < this.cooldownMs) {
      this.stats.cooldownRejections++;
      logger.debug('Wake word detected but in cooldown period', {
        keyword,
        confidence: computedConfidence,
        timeSinceLastTrigger: now - this.lastTriggerTime,
      });

      this.emitFeedback({
        type: 'cooldown',
        timestamp: now,
        keyword,
        confidence: computedConfidence,
        message: `Detection rejected: cooldown (${Math.ceil((this.cooldownMs - (now - this.lastTriggerTime)) / 1000)}s remaining)`,
      });
      return;
    }

    // Check confidence threshold
    const passedThreshold = computedConfidence >= effectiveThreshold;

    if (!passedThreshold) {
      this.stats.rejectedDetections++;
      logger.debug('Wake word detected but below confidence threshold', {
        keyword,
        confidence: computedConfidence,
        threshold: effectiveThreshold,
        audioLevel,
        ambientLevel: this.ambientNoiseLevel,
      });

      this.emitFeedback({
        type: 'rejected',
        timestamp: now,
        keyword,
        confidence: computedConfidence,
        threshold: effectiveThreshold,
        audioLevel,
        message: `Detection rejected: confidence ${(computedConfidence * 100).toFixed(1)}% < threshold ${(effectiveThreshold * 100).toFixed(1)}%`,
      });
      return;
    }

    // Check minimum audio level
    if (audioLevel < this.confidenceConfig.minAudioLevel) {
      this.stats.rejectedDetections++;
      logger.debug('Wake word detected but audio level too low', {
        keyword,
        audioLevel,
        minAudioLevel: this.confidenceConfig.minAudioLevel,
      });

      this.emitFeedback({
        type: 'rejected',
        timestamp: now,
        keyword,
        confidence: computedConfidence,
        audioLevel,
        message: `Detection rejected: audio level too low (${(audioLevel * 100).toFixed(1)}%)`,
      });
      return;
    }

    // Detection accepted!
    this.stats.acceptedDetections++;
    this.lastTriggerTime = now;

    const event: ExtendedWakeWordEvent = {
      timestamp: now,
      keyword,
      confidence: computedConfidence,
      rawConfidence: rawSensitivity,
      computedConfidence,
      passedThreshold: true,
      audioLevel,
      ambientLevel: this.ambientNoiseLevel,
    };

    logger.info('Wake word detected and validated!', {
      keyword,
      confidence: computedConfidence,
      threshold: effectiveThreshold,
      audioLevel,
      acceptRate: `${this.stats.acceptedDetections}/${this.stats.totalDetections}`,
    });

    // Send visual feedback first (for immediate UI response)
    this.emitFeedback({
      type: 'detected',
      timestamp: now,
      keyword,
      confidence: computedConfidence,
      threshold: effectiveThreshold,
      audioLevel,
      message: `Wake word "${keyword}" detected!`,
    });

    // Emit the wake event
    this.emit('wake', event);

    // Emit updated stats
    this.emit('detection-stats', this.getStats());
  }

  /**
   * Compute confidence score based on audio analysis
   */
  private computeConfidence(audioLevel: number, sensitivity: number): number {
    // Base confidence from sensitivity setting
    let confidence = sensitivity;

    // Boost confidence if audio level is significantly above ambient
    if (this.ambientNoiseLevel > 0 && audioLevel > this.ambientNoiseLevel) {
      const audioBoost = Math.min(
        0.2,
        ((audioLevel - this.ambientNoiseLevel) / this.ambientNoiseLevel) * 0.1
      );
      confidence = Math.min(1.0, confidence + audioBoost);
    }

    // Reduce confidence if audio level is near ambient (might be noise)
    if (this.ambientNoiseLevel > 0 && audioLevel < this.ambientNoiseLevel * 1.5) {
      const noisePenalty = 0.1;
      confidence = Math.max(0, confidence - noisePenalty);
    }

    return confidence;
  }

  /**
   * Get effective threshold (static or adaptive)
   */
  private getEffectiveThreshold(): number {
    if (!this.confidenceConfig.adaptiveThreshold || this.ambientNoiseLevel === 0) {
      return this.confidenceConfig.minThreshold;
    }

    // Adaptive threshold: increase threshold in noisy environments
    const noiseAdjustment = Math.min(
      0.2,
      this.ambientNoiseLevel * this.confidenceConfig.ambientMultiplier
    );

    return Math.min(0.95, this.confidenceConfig.minThreshold + noiseAdjustment);
  }

  /**
   * Update audio level history and ambient noise estimation
   */
  private updateAudioHistory(audioLevel: number): void {
    this.audioLevelHistory.push(audioLevel);

    // Keep only recent history
    if (this.audioLevelHistory.length > this.confidenceConfig.audioHistorySize) {
      this.audioLevelHistory.shift();
    }

    // Update ambient noise estimate (use lower percentile to exclude speech)
    if (this.audioLevelHistory.length >= 10) {
      const sorted = [...this.audioLevelHistory].sort((a, b) => a - b);
      // Use 25th percentile as ambient noise estimate
      const percentileIndex = Math.floor(sorted.length * 0.25);
      this.ambientNoiseLevel = sorted[percentileIndex];
    }
  }

  /**
   * Calculate RMS audio level from frame
   */
  private calculateAudioLevel(frame: Int16Array): number {
    let sum = 0;
    for (let i = 0; i < frame.length; i++) {
      sum += frame[i] * frame[i];
    }
    const rms = Math.sqrt(sum / frame.length);
    // Normalize to 0-1 range (16-bit audio max is 32767)
    return Math.min(1, rms / 32767);
  }

  /**
   * Emit visual feedback event to UI
   */
  private emitFeedback(feedback: WakeWordFeedback): void {
    if (!this.sendVisualFeedback) {
      return;
    }

    // Emit local event
    this.emit('feedback', feedback);

    // Send to renderer process via IPC
    this.sendFeedbackToRenderer(feedback);
  }

  /**
   * Send feedback to renderer process
   */
  private sendFeedbackToRenderer(feedback: WakeWordFeedback): void {
    try {
      const mainWindow = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('nova:wake-feedback', feedback);
      }
    } catch (error) {
      // Ignore errors when sending to renderer (window might not exist yet)
      logger.debug('Could not send feedback to renderer', { error });
    }
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Check if detector is running
   */
  get running(): boolean {
    return this.isRunning;
  }

  /**
   * Check if detector is paused
   */
  get paused(): boolean {
    return this.isPaused;
  }

  /**
   * Get current confidence configuration
   */
  get confidenceSettings(): ConfidenceConfig {
    return { ...this.confidenceConfig };
  }

  /**
   * Get current ambient noise level estimate
   */
  get currentAmbientLevel(): number {
    return this.ambientNoiseLevel;
  }
}

// Singleton instance for easy access
let wakeWordDetector: WakeWordDetector | null = null;

/**
 * Get or create the wake word detector instance
 */
export function getWakeWordDetector(): WakeWordDetector {
  if (!wakeWordDetector) {
    wakeWordDetector = new WakeWordDetector();
  }
  return wakeWordDetector;
}

/**
 * Shutdown the wake word detector
 */
export async function shutdownWakeWordDetector(): Promise<void> {
  if (wakeWordDetector) {
    await wakeWordDetector.stop();
    wakeWordDetector = null;
  }
}

export default WakeWordDetector;
