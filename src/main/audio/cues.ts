/**
 * Atlas Desktop - Audio Cues System
 * Subtle audio feedback for JARVIS-like interaction.
 * Provides non-verbal confirmation sounds.
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import * as path from 'path';
import { app } from 'electron';

const logger = createModuleLogger('AudioCues');

/**
 * Types of audio cues
 */
export type AudioCueType =
  | 'wake'          // Wake word detected
  | 'listening'     // Started listening
  | 'processing'    // Processing request
  | 'success'       // Task completed successfully
  | 'error'         // Something went wrong
  | 'attention'     // Need user attention
  | 'dismiss'       // Interaction ending
  | 'notification'; // General notification

/**
 * Audio cue configuration
 */
export interface AudioCueConfig {
  /** Enable audio cues */
  enabled: boolean;
  /** Master volume (0-1) */
  volume: number;
  /** Individual cue settings */
  cues: Record<AudioCueType, { enabled: boolean; volume: number }>;
}

/**
 * Default configuration - subtle and unobtrusive
 */
const DEFAULT_CONFIG: AudioCueConfig = {
  enabled: true,
  volume: 0.3, // Subtle by default
  cues: {
    wake: { enabled: true, volume: 0.4 },
    listening: { enabled: true, volume: 0.25 },
    processing: { enabled: false, volume: 0.2 }, // Disabled - can be annoying
    success: { enabled: true, volume: 0.3 },
    error: { enabled: true, volume: 0.4 },
    attention: { enabled: true, volume: 0.5 },
    dismiss: { enabled: true, volume: 0.2 },
    notification: { enabled: true, volume: 0.35 },
  },
};

/**
 * Audio cue file mappings
 */
const CUE_FILES: Record<AudioCueType, string> = {
  wake: 'wake.mp3',
  listening: 'listening.mp3',
  processing: 'processing.mp3',
  success: 'success.mp3',
  error: 'error.mp3',
  attention: 'attention.mp3',
  dismiss: 'dismiss.mp3',
  notification: 'notification.mp3',
};

/**
 * Audio cue events
 */
export interface AudioCueEvents {
  'cue-played': (type: AudioCueType) => void;
  'cue-skipped': (type: AudioCueType, reason: string) => void;
  'volume-changed': (volume: number) => void;
}

/**
 * Audio Cues Manager
 * Handles subtle audio feedback for interactions
 */
export class AudioCues extends EventEmitter {
  private config: AudioCueConfig;
  private audioContext: AudioContext | null = null;
  private audioBuffers: Map<AudioCueType, AudioBuffer> = new Map();
  private isInitialized = false;
  private assetsPath: string;
  private lastCuePlayed: Map<AudioCueType, number> = new Map();
  private minCueInterval = 200; // Minimum ms between same cue

  constructor(config?: Partial<AudioCueConfig>) {
    super();
    this.config = this.mergeConfig(DEFAULT_CONFIG, config);
    
    // Determine assets path based on environment
    try {
      const appPath = app?.getAppPath() || process.cwd();
      this.assetsPath = path.join(appPath, 'assets', 'audio-cues');
    } catch {
      this.assetsPath = path.join(process.cwd(), 'assets', 'audio-cues');
    }
    
    logger.info('AudioCues initialized', { 
      enabled: this.config.enabled,
      volume: this.config.volume,
    });
  }

  /**
   * Merge configuration with defaults
   */
  private mergeConfig(base: AudioCueConfig, overrides?: Partial<AudioCueConfig>): AudioCueConfig {
    if (!overrides) return { ...base };
    
    return {
      ...base,
      ...overrides,
      cues: {
        ...base.cues,
        ...(overrides.cues || {}),
      },
    };
  }

  /**
   * Initialize audio context (must be called after user interaction)
   */
  public async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      // Create audio context
      this.audioContext = new AudioContext();
      
      // Preload audio files
      await this.preloadCues();
      
      this.isInitialized = true;
      logger.info('AudioCues initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize AudioCues', { error: (error as Error).message });
    }
  }

  /**
   * Preload audio cue files
   */
  private async preloadCues(): Promise<void> {
    if (!this.audioContext) return;

    const loadPromises = Object.entries(CUE_FILES).map(async ([type, filename]) => {
      try {
        const filePath = path.join(this.assetsPath, filename);
        const response = await fetch(`file://${filePath}`);
        
        if (!response.ok) {
          // File doesn't exist yet - that's okay, we'll generate them
          logger.debug(`Audio cue file not found: ${filename}`);
          return;
        }
        
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await this.audioContext!.decodeAudioData(arrayBuffer);
        this.audioBuffers.set(type as AudioCueType, audioBuffer);
        logger.debug(`Loaded audio cue: ${type}`);
      } catch (error) {
        logger.debug(`Could not load audio cue: ${type}`, { error: (error as Error).message });
      }
    });

    await Promise.allSettled(loadPromises);
  }

  /**
   * Play an audio cue
   */
  public async play(type: AudioCueType): Promise<void> {
    if (!this.config.enabled) {
      this.emit('cue-skipped', type, 'disabled');
      return;
    }

    const cueConfig = this.config.cues[type];
    if (!cueConfig.enabled) {
      this.emit('cue-skipped', type, 'cue disabled');
      return;
    }

    // Rate limiting - don't play same cue too frequently
    const lastPlayed = this.lastCuePlayed.get(type);
    if (lastPlayed && Date.now() - lastPlayed < this.minCueInterval) {
      this.emit('cue-skipped', type, 'rate limited');
      return;
    }

    // Try playing with preloaded buffer
    const buffer = this.audioBuffers.get(type);
    if (buffer && this.audioContext) {
      await this.playBuffer(buffer, cueConfig.volume * this.config.volume);
      this.lastCuePlayed.set(type, Date.now());
      this.emit('cue-played', type);
      return;
    }

    // Fallback to synthesized cue
    await this.playSynthesizedCue(type, cueConfig.volume * this.config.volume);
    this.lastCuePlayed.set(type, Date.now());
    this.emit('cue-played', type);
  }

  /**
   * Play an audio buffer
   */
  private async playBuffer(buffer: AudioBuffer, volume: number): Promise<void> {
    if (!this.audioContext) return;

    const source = this.audioContext.createBufferSource();
    const gainNode = this.audioContext.createGain();
    
    source.buffer = buffer;
    gainNode.gain.value = volume;
    
    source.connect(gainNode);
    gainNode.connect(this.audioContext.destination);
    
    source.start(0);
  }

  /**
   * Play a synthesized cue (fallback when no audio file)
   * Creates simple tones for each cue type
   */
  private async playSynthesizedCue(type: AudioCueType, volume: number): Promise<void> {
    if (!this.audioContext) {
      // Create temporary audio context if not initialized
      this.audioContext = new AudioContext();
    }

    const ctx = this.audioContext;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    // Configure based on cue type
    switch (type) {
      case 'wake':
        // Rising tone - "I'm here"
        osc.frequency.setValueAtTime(440, ctx.currentTime);
        osc.frequency.linearRampToValueAtTime(660, ctx.currentTime + 0.1);
        gain.gain.setValueAtTime(volume, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.15);
        break;
        
      case 'listening':
        // Soft ping - "I'm listening"
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        gain.gain.setValueAtTime(volume * 0.5, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.1);
        break;
        
      case 'processing':
        // Soft pulse - "Working on it"
        osc.frequency.setValueAtTime(330, ctx.currentTime);
        gain.gain.setValueAtTime(volume * 0.3, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.08);
        break;
        
      case 'success':
        // Rising double tone - "Done!"
        osc.frequency.setValueAtTime(523, ctx.currentTime);
        osc.frequency.setValueAtTime(659, ctx.currentTime + 0.1);
        gain.gain.setValueAtTime(volume, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.2);
        break;
        
      case 'error':
        // Descending tone - "Oops"
        osc.frequency.setValueAtTime(440, ctx.currentTime);
        osc.frequency.linearRampToValueAtTime(220, ctx.currentTime + 0.2);
        gain.gain.setValueAtTime(volume, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.25);
        break;
        
      case 'attention':
        // Double ping - "Hey, look"
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.setValueAtTime(880, ctx.currentTime + 0.15);
        gain.gain.setValueAtTime(volume, ctx.currentTime);
        gain.gain.setValueAtTime(0, ctx.currentTime + 0.1);
        gain.gain.setValueAtTime(volume, ctx.currentTime + 0.15);
        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.25);
        break;
        
      case 'dismiss':
        // Falling soft tone - "Bye"
        osc.frequency.setValueAtTime(440, ctx.currentTime);
        osc.frequency.linearRampToValueAtTime(330, ctx.currentTime + 0.15);
        gain.gain.setValueAtTime(volume * 0.5, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.15);
        break;
        
      case 'notification':
        // Soft chime
        osc.frequency.setValueAtTime(659, ctx.currentTime);
        gain.gain.setValueAtTime(volume * 0.6, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.15);
        break;
    }
    
    osc.type = 'sine';
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.3);
  }

  /**
   * Set master volume
   */
  public setVolume(volume: number): void {
    this.config.volume = Math.max(0, Math.min(1, volume));
    this.emit('volume-changed', this.config.volume);
    logger.info('AudioCues volume changed', { volume: this.config.volume });
  }

  /**
   * Enable/disable a specific cue type
   */
  public setCueEnabled(type: AudioCueType, enabled: boolean): void {
    this.config.cues[type].enabled = enabled;
    logger.info('AudioCue type toggled', { type, enabled });
  }

  /**
   * Enable/disable all cues
   */
  public setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
    logger.info('AudioCues enabled', { enabled });
  }

  /**
   * Get current configuration
   */
  public getConfig(): AudioCueConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  public updateConfig(config: Partial<AudioCueConfig>): void {
    this.config = this.mergeConfig(this.config, config);
    logger.info('AudioCues config updated');
  }

  /**
   * Cleanup
   */
  public dispose(): void {
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    this.audioBuffers.clear();
    this.removeAllListeners();
    this.isInitialized = false;
    logger.info('AudioCues disposed');
  }
}

// Singleton instance
let audioCues: AudioCues | null = null;

/**
 * Get or create the AudioCues singleton
 */
export function getAudioCues(config?: Partial<AudioCueConfig>): AudioCues {
  if (!audioCues) {
    audioCues = new AudioCues(config);
  }
  return audioCues;
}

/**
 * Reset the singleton (for testing)
 */
export function resetAudioCues(): void {
  if (audioCues) {
    audioCues.dispose();
    audioCues = null;
  }
}
