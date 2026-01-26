/**
 * Atlas Wake Word Detector
 * Uses Picovoice Porcupine for "Hey Atlas" detection
 *
 * Features:
 * - Confidence thresholding to reduce false positives
 * - Visual feedback events for UI synchronization
 * - Multiple wake phrase support
 * - Audio level normalization and history tracking
 * - Adaptive sensitivity based on ambient noise
 * - Support for custom trained wake word models (.ppn files)
 *
 * Custom Wake Word Training:
 * To train a custom "Hey Atlas" wake word model:
 * 1. Go to https://console.picovoice.ai/
 * 2. Create a new Porcupine project
 * 3. Add phrase "Hey Atlas" (or your preferred wake phrase)
 * 4. Download the trained model (.ppn file)
 * 5. Place the model in the assets/wake-words/ directory
 * 6. Set ATLAS_CUSTOM_WAKE_WORD_PATH environment variable or configure in settings
 *
 * The detector will automatically use the custom model if available,
 * otherwise falls back to built-in "Jarvis" keyword.
 */

import { Porcupine, BuiltinKeyword } from '@picovoice/porcupine-node';
import { PvRecorder } from '@picovoice/pvrecorder-node';
import { EventEmitter } from 'events';
import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { sendToMainWindow } from '../utils/main-window';
import {
  WakeWordEvent,
  WakeWordConfig,
  AudioDevice,
  BuiltInKeyword,
  WakePhraseConfig,
  WakePhraseSettings,
  WAKE_PHRASE_PRESETS,
} from '../../shared/types/voice';
import { createModuleLogger } from '../utils/logger';
import { getConfig } from '../config';
import { clamp01 } from '../../shared/utils';

const logger = createModuleLogger('WakeWord');

/**
 * Custom wake word model configuration
 */
export interface CustomWakeWordModel {
  /** Path to the .ppn model file */
  modelPath: string;
  /** Display name for the wake word */
  displayName: string;
  /** Sensitivity for this model (0-1) */
  sensitivity: number;
}

/**
 * Default paths for custom wake word models
 */
const CUSTOM_MODEL_PATHS = {
  /** Environment variable for custom model path */
  envVar: 'ATLAS_CUSTOM_WAKE_WORD_PATH',
  /** Default directory for wake word models */
  defaultDir: 'assets/wake-words',
  /** Default model filename */
  defaultModel: 'hey-atlas.ppn',
  /** User data directory name for custom models */
  userDirName: 'wake-words',
};

/**
 * Check if a custom wake word model exists
 * @param modelPath Optional specific path to check
 * @returns Path to the model if found, null otherwise
 */
export function findCustomWakeWordModel(modelPath?: string): string | null {
  // Check explicit path first
  if (modelPath && fs.existsSync(modelPath)) {
    logger.info('Custom wake word model found at explicit path', { modelPath });
    return modelPath;
  }

  // Check environment variable
  const envPath = process.env[CUSTOM_MODEL_PATHS.envVar];
  if (envPath && fs.existsSync(envPath)) {
    logger.info('Custom wake word model found via environment variable', { path: envPath });
    return envPath;
  }

  // Check default locations (guard against test environments where app may not be available)
  let appPath: string;
  let userDataPath: string;
  try {
    appPath = app?.getAppPath?.() || process.cwd();
    userDataPath = app?.getPath?.('userData') || path.join(process.cwd(), '.atlas');
  } catch {
    // In test environments, app methods may not be available
    appPath = process.cwd();
    userDataPath = path.join(process.cwd(), '.atlas');
  }

  const possiblePaths = [
    // Development paths
    path.join(appPath, CUSTOM_MODEL_PATHS.defaultDir, CUSTOM_MODEL_PATHS.defaultModel),
    path.join(process.cwd(), CUSTOM_MODEL_PATHS.defaultDir, CUSTOM_MODEL_PATHS.defaultModel),
    // User data directory
    path.join(userDataPath, 'wake-words', CUSTOM_MODEL_PATHS.defaultModel),
    // Resources directory (for packaged app)
    path.join(process.resourcesPath || appPath, 'wake-words', CUSTOM_MODEL_PATHS.defaultModel),
  ];

  for (const possiblePath of possiblePaths) {
    if (fs.existsSync(possiblePath)) {
      logger.info('Custom wake word model found at default path', { path: possiblePath });
      return possiblePath;
    }
  }

  logger.debug('No custom wake word model found, will use built-in keyword');
  return null;
}

/**
 * Validate a custom wake word model file
 * @param modelPath Path to the .ppn file
 * @returns Validation result
 */
export function validateCustomModel(modelPath: string): {
  valid: boolean;
  error?: string;
  fileSize?: number;
} {
  try {
    if (!fs.existsSync(modelPath)) {
      return { valid: false, error: 'Model file does not exist' };
    }

    const stats = fs.statSync(modelPath);
    if (!stats.isFile()) {
      return { valid: false, error: 'Path is not a file' };
    }

    if (!modelPath.endsWith('.ppn')) {
      return { valid: false, error: 'Model file must have .ppn extension' };
    }

    // Check minimum file size (valid .ppn files are typically > 1KB)
    if (stats.size < 1024) {
      return { valid: false, error: 'Model file appears to be corrupt (too small)' };
    }

    return { valid: true, fileSize: stats.size };
  } catch (error) {
    return {
      valid: false,
      error: `Failed to validate model: ${(error as Error).message}`,
    };
  }
}

/**
 * Get information about available wake word options
 */
export function getWakeWordInfo(): {
  customModelAvailable: boolean;
  customModelPath: string | null;
  builtInKeywords: BuiltInKeyword[];
  currentMode: 'custom' | 'builtin';
} {
  const customPath = findCustomWakeWordModel();
  return {
    customModelAvailable: customPath !== null,
    customModelPath: customPath,
    builtInKeywords: [
      'alexa',
      'americano',
      'blueberry',
      'bumblebee',
      'computer',
      'grapefruit',
      'grasshopper',
      'hey google',
      'hey siri',
      'jarvis',
      'ok google',
      'picovoice',
      'porcupine',
      'terminator',
    ],
    currentMode: customPath ? 'custom' : 'builtin',
  };
}

/**
 * Custom wake word model information
 */
export interface CustomWakeWordInfo {
  /** Model ID */
  id: string;
  /** Display name for the wake word */
  displayName: string;
  /** Path to the .ppn file */
  modelPath: string;
  /** When the model was created */
  createdAt: number;
  /** Whether this model is currently active */
  isActive: boolean;
  /** Recommended sensitivity */
  sensitivity: number;
}

/**
 * List all available custom wake word models from user data directory
 * This scans ~/.atlas/wake-words/ for .ppn files and their metadata
 */
export function listCustomWakeWordModels(): CustomWakeWordInfo[] {
  const models: CustomWakeWordInfo[] = [];

  // Get user data path
  let userDataPath: string;
  try {
    userDataPath = app?.getPath?.('userData') || path.join(process.cwd(), '.atlas');
  } catch {
    userDataPath = path.join(process.cwd(), '.atlas');
  }

  const wakeWordsDir = path.join(userDataPath, CUSTOM_MODEL_PATHS.userDirName);

  // Check if directory exists
  if (!fs.existsSync(wakeWordsDir)) {
    logger.debug('Wake words directory does not exist', { path: wakeWordsDir });
    return models;
  }

  // Load metadata file if it exists
  const metadataPath = path.join(wakeWordsDir, 'models.json');
  let metadata: { models?: CustomWakeWordInfo[]; activeModelId?: string } = {};

  if (fs.existsSync(metadataPath)) {
    try {
      metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
    } catch (error) {
      logger.error('Failed to parse wake word metadata', { error });
    }
  }

  // Scan directory for .ppn files
  try {
    const files = fs.readdirSync(wakeWordsDir);

    for (const file of files) {
      if (file.endsWith('.ppn')) {
        const modelPath = path.join(wakeWordsDir, file);
        const stats = fs.statSync(modelPath);

        // Check if we have metadata for this model
        const existingMeta = metadata.models?.find((m) => m.modelPath === modelPath);

        if (existingMeta) {
          models.push({
            ...existingMeta,
            isActive: existingMeta.isActive || false,
          });
        } else {
          // Create basic info for model without metadata
          const displayName = file.replace('.ppn', '').replace(/-/g, ' ');
          models.push({
            id: `model_${file.replace('.ppn', '')}`,
            displayName: displayName.charAt(0).toUpperCase() + displayName.slice(1),
            modelPath,
            createdAt: stats.mtime.getTime(),
            isActive: false,
            sensitivity: 0.5,
          });
        }
      }
    }
  } catch (error) {
    logger.error('Failed to scan wake words directory', { error });
  }

  return models;
}

/**
 * Get the currently active custom wake word model
 */
export function getActiveCustomWakeWord(): CustomWakeWordInfo | null {
  const models = listCustomWakeWordModels();
  return models.find((m) => m.isActive) || null;
}

/**
 * Set a custom wake word model as active
 * @param modelId The ID of the model to activate, or null to deactivate all
 */
export async function setActiveCustomWakeWord(modelId: string | null): Promise<boolean> {
  let userDataPath: string;
  try {
    userDataPath = app?.getPath?.('userData') || path.join(process.cwd(), '.atlas');
  } catch {
    userDataPath = path.join(process.cwd(), '.atlas');
  }

  const wakeWordsDir = path.join(userDataPath, CUSTOM_MODEL_PATHS.userDirName);
  const metadataPath = path.join(wakeWordsDir, 'models.json');

  const models = listCustomWakeWordModels();

  // Update active status
  for (const model of models) {
    model.isActive = model.id === modelId;
  }

  // Save metadata
  try {
    if (!fs.existsSync(wakeWordsDir)) {
      fs.mkdirSync(wakeWordsDir, { recursive: true });
    }

    fs.writeFileSync(
      metadataPath,
      JSON.stringify({ models, updatedAt: Date.now() }, null, 2)
    );

    logger.info('Active wake word model updated', { modelId });
    return true;
  } catch (error) {
    logger.error('Failed to save wake word metadata', { error });
    return false;
  }
}

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
  'audio-frame': (frame: Int16Array) => void;
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
  minThreshold: 0.4, // Lowered for better wake word detection
  minAudioLevel: 0.0001, // Very low to accept quiet microphones
  audioHistorySize: 50,
  ambientMultiplier: 2.5,
  adaptiveThreshold: true,
};

/**
 * Extended wake word configuration with custom model support
 */
export interface ExtendedWakeWordConfig extends Partial<WakeWordConfig> {
  /** Custom wake word model path (.ppn file) */
  customModelPath?: string;
  /** Whether to prefer custom model over built-in keywords */
  preferCustomModel?: boolean;
  /** Display name for custom wake word */
  customWakeWordName?: string;
  /** Confidence configuration */
  confidence?: Partial<ConfidenceConfig>;
}

/**
 * WakeWordDetector class
 * Listens for wake word and emits events when detected
 * Includes confidence thresholding and visual feedback
 * Supports both built-in keywords and custom trained models
 */
export class WakeWordDetector extends EventEmitter {
  private porcupine: Porcupine | null = null;
  private recorder: PvRecorder | null = null;
  private isRunning: boolean = false;
  private isPaused: boolean = false;
  private keywords: BuiltInKeyword[] = [];
  private keywordNames: string[] = []; // Display names for keywords
  private sensitivities: number[] = [];
  private accessKey: string;
  private cooldownMs: number = 2000; // 2 second cooldown between triggers
  private lastTriggerTime: number = 0;
  private deviceIndex: number = -1; // -1 = default device
  private startTime: number = 0;

  // Custom model support
  private customModelPath: string | null = null;
  private useCustomModel: boolean = false;

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

  // Atlas speaking state - suppress wake word during speech
  private atlasIsSpeaking: boolean = false;
  private suppressionCount: number = 0;

  constructor(config?: ExtendedWakeWordConfig) {
    super();
    this.setMaxListeners(20); // Prevent memory leak warnings
    const atlasConfig = getConfig();

    this.accessKey = config?.accessKey || atlasConfig.porcupineApiKey;

    // Check for custom model support
    const preferCustom = config?.preferCustomModel !== false; // Default to true
    if (preferCustom) {
      const customPath = findCustomWakeWordModel(config?.customModelPath);
      if (customPath) {
        const validation = validateCustomModel(customPath);
        if (validation.valid) {
          this.customModelPath = customPath;
          this.useCustomModel = true;
          this.keywordNames = [config?.customWakeWordName || 'Hey Atlas'];
          this.sensitivities = [config?.sensitivities?.[0] ?? atlasConfig.wakeWordSensitivity];
          logger.info('Using custom wake word model', {
            path: customPath,
            name: this.keywordNames[0],
          });
        } else {
          logger.warn('Custom wake word model validation failed', {
            path: customPath,
            error: validation.error,
          });
        }
      }
    }

    // Fall back to built-in keywords if no custom model
    if (!this.useCustomModel) {
      this.keywords = config?.keywords || ['jarvis'];
      this.keywordNames = this.keywords;
      this.sensitivities =
        config?.sensitivities || this.keywords.map(() => atlasConfig.wakeWordSensitivity);
      logger.info('Using built-in wake word', { keywords: this.keywords });
    } else {
      // Set empty keywords array when using custom model
      this.keywords = [];
    }

    // Initialize confidence config
    this.confidenceConfig = {
      ...DEFAULT_CONFIDENCE_CONFIG,
      ...config?.confidence,
    };

    logger.info('WakeWordDetector initialized', {
      mode: this.useCustomModel ? 'custom' : 'builtin',
      keywords: this.keywordNames,
      sensitivities: this.sensitivities,
      confidenceThreshold: this.confidenceConfig.minThreshold,
      adaptiveThreshold: this.confidenceConfig.adaptiveThreshold,
    });
  }

  /**
   * Check if using custom wake word model
   */
  get isUsingCustomModel(): boolean {
    return this.useCustomModel;
  }

  /**
   * Get the current wake word display name
   */
  get wakeWordName(): string {
    return this.keywordNames[0] || 'Unknown';
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
    this.sensitivities = this.keywordNames.map(() => sensitivity);
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
   * Set Atlas speaking state to suppress wake word detection
   * This prevents the wake word from being triggered by Atlas's own voice
   */
  setAtlasSpeaking(speaking: boolean): void {
    const wasSpeaking = this.atlasIsSpeaking;
    this.atlasIsSpeaking = speaking;

    if (speaking && !wasSpeaking) {
      logger.debug('Wake word detection suppressed - Atlas is speaking');
    } else if (!speaking && wasSpeaking) {
      logger.debug('Wake word detection resumed - Atlas finished speaking', {
        suppressionCount: this.suppressionCount,
      });
    }
  }

  /**
   * Check if Atlas is currently speaking
   */
  isAtlasSpeaking(): boolean {
    return this.atlasIsSpeaking;
  }

  /**
   * Get count of detections suppressed during speech
   */
  getSuppressionCount(): number {
    return this.suppressionCount;
  }

  /**
   * Reset suppression counter
   */
  resetSuppressionCount(): void {
    this.suppressionCount = 0;
  }

  /**
   * Configure multiple wake phrases from settings
   * This allows users to enable multiple wake phrases like "Hey Atlas", "Computer", etc.
   *
   * @param settings Wake phrase settings from user configuration
   */
  async configureWakePhrases(settings: WakePhraseSettings): Promise<void> {
    const enabledPhrases = settings.phrases.filter((p) => p.enabled);

    if (enabledPhrases.length === 0) {
      logger.warn('No wake phrases enabled, using default');
      return;
    }

    // Collect built-in keywords and their sensitivities
    const builtInKeywords: BuiltInKeyword[] = [];
    const customModelPaths: string[] = [];
    const keywordNames: string[] = [];
    const sensitivities: number[] = [];

    for (const phrase of enabledPhrases) {
      const sensitivity = phrase.sensitivity * settings.globalSensitivity;

      if (phrase.isCustomModel) {
        // Custom model (.ppn file)
        const validation = validateCustomModel(phrase.keyword);
        if (validation.valid) {
          customModelPaths.push(phrase.keyword);
          keywordNames.push(phrase.displayName);
          sensitivities.push(clamp01(sensitivity));
        } else {
          logger.warn('Custom wake word model validation failed', {
            displayName: phrase.displayName,
            path: phrase.keyword,
            error: validation.error,
          });
        }
      } else {
        // Built-in keyword
        builtInKeywords.push(phrase.keyword as BuiltInKeyword);
        keywordNames.push(phrase.displayName);
        sensitivities.push(clamp01(sensitivity));
      }
    }

    // Update internal state
    const wasRunning = this.isRunning;

    if (wasRunning) {
      await this.stop();
    }

    // Update keywords based on what we found
    if (customModelPaths.length > 0) {
      // Use first custom model (Porcupine limitation)
      this.customModelPath = customModelPaths[0];
      this.useCustomModel = true;
      this.keywords = [];
    } else if (builtInKeywords.length > 0) {
      this.keywords = builtInKeywords;
      this.useCustomModel = false;
      this.customModelPath = null;
    }

    this.keywordNames = keywordNames;
    this.sensitivities = sensitivities;
    this.cooldownMs = settings.cooldownMs;

    logger.info('Wake phrases configured', {
      phrases: keywordNames,
      sensitivities,
      useCustomModel: this.useCustomModel,
    });

    // Restart if was running
    if (wasRunning) {
      await this.start();
    }
  }

  /**
   * Get currently configured wake phrases
   */
  getConfiguredPhrases(): { displayName: string; keyword: string; sensitivity: number }[] {
    return this.keywordNames.map((name, i) => ({
      displayName: name,
      keyword: this.useCustomModel && this.customModelPath
        ? this.customModelPath
        : (this.keywords[i] || 'unknown'),
      sensitivity: this.sensitivities[i] || 0.5,
    }));
  }

  /**
   * Add a single wake phrase
   */
  async addWakePhrase(phrase: WakePhraseConfig): Promise<boolean> {
    if (!phrase.enabled) {
      return false;
    }

    // Check if already exists
    const existing = this.keywordNames.find(
      (name) => name.toLowerCase() === phrase.displayName.toLowerCase()
    );
    if (existing) {
      logger.warn('Wake phrase already exists', { displayName: phrase.displayName });
      return false;
    }

    if (phrase.isCustomModel) {
      const validation = validateCustomModel(phrase.keyword);
      if (!validation.valid) {
        logger.warn('Custom model validation failed', { error: validation.error });
        return false;
      }
      // Can only have one custom model at a time
      this.customModelPath = phrase.keyword;
      this.useCustomModel = true;
      this.keywords = [];
    } else {
      // Add built-in keyword
      if (this.useCustomModel) {
        logger.warn('Cannot mix custom model with built-in keywords');
        return false;
      }
      this.keywords.push(phrase.keyword as BuiltInKeyword);
    }

    this.keywordNames.push(phrase.displayName);
    this.sensitivities.push(phrase.sensitivity);

    logger.info('Wake phrase added', { displayName: phrase.displayName });

    // Restart to apply changes
    if (this.isRunning) {
      await this.restart();
    }

    return true;
  }

  /**
   * Remove a wake phrase by display name
   */
  async removeWakePhrase(displayName: string): Promise<boolean> {
    const index = this.keywordNames.findIndex(
      (name) => name.toLowerCase() === displayName.toLowerCase()
    );

    if (index === -1) {
      return false;
    }

    // Don't allow removing the last phrase
    if (this.keywordNames.length <= 1) {
      logger.warn('Cannot remove last wake phrase');
      return false;
    }

    this.keywordNames.splice(index, 1);
    this.sensitivities.splice(index, 1);

    if (!this.useCustomModel) {
      this.keywords.splice(index, 1);
    }

    logger.info('Wake phrase removed', { displayName });

    // Restart to apply changes
    if (this.isRunning) {
      await this.restart();
    }

    return true;
  }

  /**
   * Get available built-in wake phrases
   */
  static getAvailableBuiltInPhrases(): WakePhraseConfig[] {
    return WAKE_PHRASE_PRESETS.map((preset) => ({ ...preset }));
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
      logger.debug('Initializing Porcupine...', {
        mode: this.useCustomModel ? 'custom' : 'builtin',
      });

      // Create Porcupine instance
      if (this.useCustomModel && this.customModelPath) {
        // Use custom wake word model (.ppn file)
        logger.info('Loading custom wake word model', { path: this.customModelPath });
        this.porcupine = new Porcupine(
          this.accessKey,
          [this.customModelPath], // Pass file path for custom model
          this.sensitivities
        );
      } else {
        // Use built-in keywords
        this.porcupine = new Porcupine(
          this.accessKey,
          this.keywords.map(toBuiltinKeyword),
          this.sensitivities
        );
      }

      // Create recorder with Porcupine's required frame length
      this.recorder = new PvRecorder(this.porcupine.frameLength, this.deviceIndex);

      logger.info('Porcupine initialized', {
        mode: this.useCustomModel ? 'custom' : 'builtin',
        wakeWord: this.keywordNames[0],
        sampleRate: this.porcupine.sampleRate,
        frameLength: this.porcupine.frameLength,
        version: this.porcupine.version,
      });
    } catch (error) {
      logger.error('Failed to initialize Porcupine', {
        error,
        mode: this.useCustomModel ? 'custom' : 'builtin',
        customModelPath: this.customModelPath,
      });
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
    let frameCount = 0;
    let lastLogTime = Date.now();
    const LOG_INTERVAL_MS = 5000; // Log every 5 seconds
    
    logger.info('[WakeWord] processAudio loop STARTED', { isRunning: this.isRunning });
    
    while (this.isRunning) {
      try {
        if (!this.recorder || !this.porcupine) {
          logger.debug('[WakeWord] Waiting for recorder/porcupine', { hasRecorder: !!this.recorder, hasPorcupine: !!this.porcupine });
          await this.sleep(100);
          continue;
        }

        // Log every 100 frames to show loop is running
        if (frameCount === 0 || frameCount % 100 === 0) {
          logger.debug('[WakeWord] About to read frame', { frameCount });
        }

        // Read audio frame - always read even when paused to feed VAD
        const frame = await this.recorder.read();
        frameCount++;

        // Calculate audio level for visualization
        const audioLevel = this.calculateAudioLevel(frame);
        this.emit('audio-level', audioLevel);

        // Emit raw frame for audio spectrum analysis (orb visualization)
        // This is also used by VAD when pipeline is in listening state
        this.emit('audio-frame', frame);

        // Skip wake word processing if paused (but audio frames are still emitted above)
        if (this.isPaused) {
          continue;
        }

        // Periodic debug log to confirm processing is running
        const now = Date.now();
        if (now - lastLogTime >= LOG_INTERVAL_MS) {
          logger.debug('Wake word processing active', {
            frameCount,
            audioLevel: audioLevel.toFixed(3),
            paused: this.isPaused,
            sensitivity: this.sensitivities[0],
          });
          lastLogTime = now;
        }

        // Log high audio levels (potential speech)
        if (audioLevel > 0.1) {
          logger.debug('Wake word high audio level detected', {
            audioLevel: audioLevel.toFixed(3),
            threshold: 0.1,
          });
        }

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
    const keyword = this.keywordNames[keywordIndex] || this.keywordNames[0] || 'Unknown';
    const rawSensitivity = this.sensitivities[keywordIndex] ?? this.sensitivities[0];

    // Check if Atlas is speaking - suppress detection to avoid false triggers
    if (this.atlasIsSpeaking) {
      this.suppressionCount++;
      logger.debug('Wake word detection suppressed - Atlas is speaking', {
        keyword,
        suppressionCount: this.suppressionCount,
      });

      this.emitFeedback({
        type: 'rejected',
        timestamp: now,
        keyword,
        audioLevel,
        message: 'Detection suppressed: Atlas is speaking',
      });
      return;
    }

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
      sendToMainWindow('atlas:wake-feedback', feedback);
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
