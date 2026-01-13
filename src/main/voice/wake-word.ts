/**
 * Nova Wake Word Detector
 * Uses Picovoice Porcupine for "Hey Nova" detection
 *
 * Note: Since "Nova" is not a built-in keyword, we use "Jarvis" as a placeholder
 * until a custom wake word model is trained via Picovoice Console.
 * For production, train a custom "Hey Nova" model at https://console.picovoice.ai/
 */

import { Porcupine, BuiltinKeyword } from '@picovoice/porcupine-node';
import { PvRecorder } from '@picovoice/pvrecorder-node';
import { EventEmitter } from 'events';
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
 * Wake Word Detector Events
 */
export interface WakeWordDetectorEvents {
  wake: (event: WakeWordEvent) => void;
  error: (error: Error) => void;
  started: () => void;
  stopped: () => void;
  'audio-level': (level: number) => void;
}

/**
 * WakeWordDetector class
 * Listens for wake word and emits events when detected
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

  constructor(config?: Partial<WakeWordConfig>) {
    super();
    const novaConfig = getConfig();

    this.accessKey = config?.accessKey || novaConfig.porcupineApiKey;
    // Default to "jarvis" as placeholder for "hey nova"
    this.keywords = config?.keywords || ['jarvis'];
    this.sensitivities =
      config?.sensitivities || this.keywords.map(() => novaConfig.wakeWordSensitivity);

    logger.info('WakeWordDetector initialized', {
      keywords: this.keywords,
      sensitivities: this.sensitivities,
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

      logger.info('Wake word detection started');
      this.emit('started');

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

        // Process frame through Porcupine
        const keywordIndex = this.porcupine.process(frame);

        if (keywordIndex >= 0) {
          const now = Date.now();

          // Check cooldown
          if (now - this.lastTriggerTime < this.cooldownMs) {
            logger.debug('Wake word detected but in cooldown period');
            continue;
          }

          this.lastTriggerTime = now;
          const keyword = this.keywords[keywordIndex];

          const event: WakeWordEvent = {
            timestamp: now,
            keyword,
            confidence: this.sensitivities[keywordIndex],
          };

          logger.info('Wake word detected!', { keyword, keywordIndex });
          this.emit('wake', event);
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
