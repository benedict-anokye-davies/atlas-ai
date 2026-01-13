/**
 * Nova Desktop - TTS Manager
 * Manages TTS providers with automatic fallback
 * Primary: ElevenLabs, Fallback: Piper/espeak (Offline)
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import { CircuitBreaker, CircuitState } from '../utils/errors';
import {
  TTSProvider,
  TTSConfig,
  TTSStatus,
  TTSEvents,
  TTSAudioChunk,
  TTSSynthesisResult,
  SpeechQueueItem,
} from '../../shared/types/tts';
import { ElevenLabsTTS } from './elevenlabs';
import { OfflineTTS, OfflineTTSConfig } from './offline';

const logger = createModuleLogger('TTSManager');

/**
 * TTS Manager configuration
 */
export interface TTSManagerConfig {
  /** ElevenLabs configuration */
  elevenlabs?: Partial<TTSConfig>;
  /** Offline TTS configuration */
  offline?: Partial<OfflineTTSConfig>;
  /** Prefer offline (use it first) */
  preferOffline?: boolean;
  /** Auto-switch to fallback on errors */
  autoFallback?: boolean;
  /** Number of consecutive errors before switching */
  errorThreshold?: number;
  /** Time to wait before trying primary again (ms) */
  fallbackCooldown?: number;
}

/**
 * Default TTS Manager configuration
 */
const DEFAULT_TTS_MANAGER_CONFIG: Required<TTSManagerConfig> = {
  elevenlabs: {},
  offline: {},
  preferOffline: false,
  autoFallback: true,
  errorThreshold: 3,
  fallbackCooldown: 60000, // 1 minute
};

/**
 * TTS Provider type
 */
export type TTSProviderType = 'elevenlabs' | 'offline';

/**
 * TTS Manager events
 */
export interface TTSManagerEvents extends TTSEvents {
  /** Provider switched */
  'provider-switch': (from: TTSProviderType | null, to: TTSProviderType, reason: string) => void;
  /** Fallback activated */
  'fallback-activated': (provider: TTSProviderType, reason: string) => void;
  /** Primary restored */
  'primary-restored': () => void;
}

/**
 * TTS Manager
 * Orchestrates TTS providers with automatic fallback
 */
export class TTSManager extends EventEmitter implements TTSProvider {
  readonly name = 'tts-manager';
  private config: Required<TTSManagerConfig>;

  // Providers
  private elevenlabsTTS: ElevenLabsTTS | null = null;
  private offlineTTS: OfflineTTS | null = null;
  private activeProvider: TTSProvider | null = null;
  private activeProviderType: TTSProviderType | null = null;

  // Circuit breaker for ElevenLabs
  private elevenlabsBreaker: CircuitBreaker;

  // State tracking
  private consecutiveErrors = 0;
  private lastFallbackTime = 0;
  private _status: TTSStatus = TTSStatus.IDLE;

  constructor(config?: Partial<TTSManagerConfig>) {
    super();
    this.config = { ...DEFAULT_TTS_MANAGER_CONFIG, ...config } as Required<TTSManagerConfig>;

    // Initialize circuit breaker for ElevenLabs
    this.elevenlabsBreaker = new CircuitBreaker('elevenlabs', {
      failureThreshold: this.config.errorThreshold,
      timeout: this.config.fallbackCooldown,
      onStateChange: (_from, to) => {
        if (to === CircuitState.OPEN) {
          logger.warn('ElevenLabs circuit breaker opened - switching to fallback');
          this.switchToFallback('Circuit breaker opened');
        } else if (to === CircuitState.HALF_OPEN) {
          logger.info('ElevenLabs circuit breaker half-open - will retry primary');
        } else if (to === CircuitState.CLOSED) {
          logger.info('ElevenLabs circuit breaker closed - primary available');
        }
      },
    });

    // Initialize providers
    this.initializeProviders();

    logger.info('TTSManager initialized', {
      preferOffline: this.config.preferOffline,
      autoFallback: this.config.autoFallback,
    });
  }

  /**
   * Get current status
   */
  get status(): TTSStatus {
    return this._status;
  }

  /**
   * Set status and emit event
   */
  private setStatus(status: TTSStatus): void {
    if (this._status !== status) {
      this._status = status;
      this.emit('status', status);
    }
  }

  /**
   * Get active provider type
   */
  getActiveProviderType(): TTSProviderType | null {
    return this.activeProviderType;
  }

  /**
   * Initialize providers
   */
  private initializeProviders(): void {
    // Initialize ElevenLabs if API key provided
    if (this.config.elevenlabs.apiKey) {
      try {
        this.elevenlabsTTS = new ElevenLabsTTS(this.config.elevenlabs);
        this.setupProviderListeners(this.elevenlabsTTS, 'elevenlabs');
        logger.info('ElevenLabs provider initialized');
      } catch (error) {
        logger.warn('Failed to initialize ElevenLabs', { error: (error as Error).message });
      }
    }

    // Always initialize offline TTS as fallback
    try {
      this.offlineTTS = new OfflineTTS(this.config.offline);
      this.setupProviderListeners(this.offlineTTS, 'offline');
      logger.info('Offline provider initialized');
    } catch (error) {
      logger.warn('Failed to initialize offline TTS', { error: (error as Error).message });
    }

    // Select initial provider
    this.selectProvider();
  }

  /**
   * Select the appropriate provider based on config and availability
   */
  private selectProvider(): void {
    if (this.config.preferOffline && this.offlineTTS) {
      this.activeProvider = this.offlineTTS;
      this.activeProviderType = 'offline';
    } else if (this.elevenlabsTTS && this.elevenlabsBreaker.canAttempt()) {
      this.activeProvider = this.elevenlabsTTS;
      this.activeProviderType = 'elevenlabs';
    } else if (this.offlineTTS) {
      this.activeProvider = this.offlineTTS;
      this.activeProviderType = 'offline';
    } else if (this.elevenlabsTTS) {
      this.activeProvider = this.elevenlabsTTS;
      this.activeProviderType = 'elevenlabs';
    }

    if (this.activeProviderType) {
      logger.info('Selected TTS provider', { provider: this.activeProviderType });
    } else {
      logger.error('No TTS provider available');
    }
  }

  /**
   * Set up event listeners for a provider
   */
  private setupProviderListeners(provider: TTSProvider, type: TTSProviderType): void {
    provider.on('status', (status: TTSStatus) => {
      if (provider === this.activeProvider) {
        this.setStatus(status);
      }
    });

    provider.on('chunk', (chunk: TTSAudioChunk) => {
      if (provider === this.activeProvider) {
        this.emit('chunk', chunk);
      }
    });

    provider.on('synthesized', (result: TTSSynthesisResult) => {
      if (provider === this.activeProvider) {
        this.consecutiveErrors = 0;
        if (type === 'elevenlabs') {
          this.elevenlabsBreaker.recordSuccess();
        }
        this.emit('synthesized', result);
      }
    });

    provider.on('playbackStart', () => {
      if (provider === this.activeProvider) {
        this.emit('playbackStart');
      }
    });

    provider.on('playbackEnd', () => {
      if (provider === this.activeProvider) {
        this.emit('playbackEnd');
      }
    });

    provider.on('error', (error: Error) => {
      if (provider === this.activeProvider) {
        this.handleProviderError(error, type);
      }
    });

    provider.on('queueUpdate', (queue: SpeechQueueItem[]) => {
      if (provider === this.activeProvider) {
        this.emit('queueUpdate', queue);
      }
    });

    provider.on('interrupted', () => {
      if (provider === this.activeProvider) {
        this.emit('interrupted');
      }
    });
  }

  /**
   * Handle provider error
   */
  private handleProviderError(error: Error, type: TTSProviderType): void {
    this.consecutiveErrors++;
    logger.error('Provider error', {
      provider: type,
      error: error.message,
      consecutiveErrors: this.consecutiveErrors,
    });

    this.emit('error', error);

    // Check if we should switch to fallback
    if (
      this.config.autoFallback &&
      type === 'elevenlabs' &&
      this.consecutiveErrors >= this.config.errorThreshold
    ) {
      this.elevenlabsBreaker.recordFailure();
    }
  }

  /**
   * Switch to fallback provider
   */
  private switchToFallback(reason: string): void {
    if (this.activeProviderType === 'offline') {
      logger.warn('Already using fallback provider');
      return;
    }

    if (!this.offlineTTS) {
      logger.error('No fallback provider available');
      return;
    }

    logger.info('Switching to fallback provider', { reason });
    this.lastFallbackTime = Date.now();

    const previousType = this.activeProviderType;
    this.activeProvider = this.offlineTTS;
    this.activeProviderType = 'offline';
    this.consecutiveErrors = 0;

    this.emit('fallback-activated', 'offline', reason);
    this.emit('provider-switch', previousType, 'offline', reason);
    logger.info('Switched to offline fallback');
  }

  /**
   * Try to restore primary provider
   */
  async tryRestorePrimary(): Promise<boolean> {
    if (this.activeProviderType === 'elevenlabs' || !this.elevenlabsTTS) {
      return false;
    }

    // Check if cooldown has passed
    if (Date.now() - this.lastFallbackTime < this.config.fallbackCooldown) {
      return false;
    }

    // Check circuit breaker
    if (!this.elevenlabsBreaker.canAttempt()) {
      return false;
    }

    logger.info('Restoring primary provider');

    this.activeProvider = this.elevenlabsTTS;
    this.activeProviderType = 'elevenlabs';
    this.consecutiveErrors = 0;

    this.emit('primary-restored');
    this.emit('provider-switch', 'offline', 'elevenlabs', 'Primary restored');
    logger.info('Primary provider restored');
    return true;
  }

  /**
   * Synthesize text to speech
   */
  async synthesize(text: string): Promise<TTSSynthesisResult> {
    if (!this.activeProvider) {
      throw new Error('No TTS provider available');
    }

    try {
      return await this.activeProvider.synthesize(text);
    } catch (error) {
      // Try fallback on error
      if (this.config.autoFallback && this.activeProviderType === 'elevenlabs' && this.offlineTTS) {
        logger.info('Attempting fallback after synthesis error');
        this.switchToFallback((error as Error).message);
        return await this.offlineTTS.synthesize(text);
      }
      throw error;
    }
  }

  /**
   * Synthesize text with streaming
   */
  async *synthesizeStream(text: string): AsyncGenerator<TTSAudioChunk> {
    if (!this.activeProvider) {
      throw new Error('No TTS provider available');
    }

    try {
      yield* this.activeProvider.synthesizeStream(text);
    } catch (error) {
      // Try fallback on error
      if (this.config.autoFallback && this.activeProviderType === 'elevenlabs' && this.offlineTTS) {
        logger.info('Attempting fallback after stream error');
        this.switchToFallback((error as Error).message);
        yield* this.offlineTTS.synthesizeStream(text);
      } else {
        throw error;
      }
    }
  }

  /**
   * Speak text
   */
  async speak(text: string, priority = 0): Promise<void> {
    if (!this.activeProvider) {
      throw new Error('No TTS provider available');
    }

    try {
      await this.activeProvider.speak(text, priority);
    } catch (error) {
      // Try fallback on error
      if (this.config.autoFallback && this.activeProviderType === 'elevenlabs' && this.offlineTTS) {
        logger.info('Attempting fallback after speak error');
        this.switchToFallback((error as Error).message);
        await this.offlineTTS.speak(text, priority);
      } else {
        throw error;
      }
    }
  }

  /**
   * Stop current speech and clear queue
   */
  stop(): void {
    this.activeProvider?.stop();
  }

  /**
   * Pause playback
   */
  pause(): void {
    this.activeProvider?.pause();
  }

  /**
   * Resume playback
   */
  resume(): void {
    this.activeProvider?.resume();
  }

  /**
   * Check if currently speaking
   */
  isSpeaking(): boolean {
    return this.activeProvider?.isSpeaking() || false;
  }

  /**
   * Get speech queue
   */
  getQueue(): SpeechQueueItem[] {
    return this.activeProvider?.getQueue() || [];
  }

  /**
   * Clear speech queue
   */
  clearQueue(): void {
    this.activeProvider?.clearQueue();
  }

  /**
   * Get current configuration
   */
  getConfig(): TTSConfig {
    return this.activeProvider?.getConfig() || { apiKey: '' };
  }

  /**
   * Force switch to specific provider
   */
  switchToProvider(type: TTSProviderType): void {
    const provider = type === 'elevenlabs' ? this.elevenlabsTTS : this.offlineTTS;

    if (!provider) {
      throw new Error(`Provider ${type} not available`);
    }

    const previousType = this.activeProviderType;
    this.activeProvider = provider;
    this.activeProviderType = type;
    this.consecutiveErrors = 0;

    this.emit('provider-switch', previousType, type, 'Manual switch');
    logger.info('Manually switched provider', { to: type });
  }

  /**
   * Check if fallback is active
   */
  isUsingFallback(): boolean {
    return this.activeProviderType === 'offline' && !this.config.preferOffline;
  }

  /**
   * Check if offline mode is available
   */
  async isOfflineAvailable(): Promise<boolean> {
    if (!this.offlineTTS) return false;

    const piperOk = await this.offlineTTS.isPiperAvailable();
    if (piperOk && this.offlineTTS.isModelDownloaded()) {
      return true;
    }

    const espeakOk = await this.offlineTTS.isEspeakAvailable();
    return espeakOk;
  }

  /**
   * Download offline model for voice
   */
  async downloadOfflineModel(voiceId?: string): Promise<void> {
    if (!this.offlineTTS) {
      throw new Error('Offline TTS not initialized');
    }
    await this.offlineTTS.downloadModel(voiceId);
  }

  // Type-safe event emitter methods
  on<K extends keyof TTSManagerEvents>(event: K, listener: TTSManagerEvents[K]): this {
    return super.on(event, listener);
  }

  off<K extends keyof TTSManagerEvents>(event: K, listener: TTSManagerEvents[K]): this {
    return super.off(event, listener);
  }

  emit<K extends keyof TTSManagerEvents>(
    event: K,
    ...args: Parameters<TTSManagerEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }
}

// Singleton instance
let ttsManager: TTSManager | null = null;

/**
 * Get or create TTS manager instance
 */
export function getTTSManager(config?: Partial<TTSManagerConfig>): TTSManager {
  if (!ttsManager) {
    ttsManager = new TTSManager(config);
  }
  return ttsManager;
}

/**
 * Shutdown TTS manager
 */
export function shutdownTTSManager(): void {
  if (ttsManager) {
    ttsManager.stop();
    ttsManager = null;
  }
}

export default TTSManager;
