/**
 * Nova Desktop - STT Manager
 * Manages speech-to-text providers with automatic fallback
 * Primary: Deepgram (online), Fallback: Vosk (offline)
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import { CircuitBreaker, CircuitState } from '../utils/errors';
import {
  STTProvider,
  STTConfig,
  STTStatus,
  STTEvents,
  TranscriptionResult,
} from '../../shared/types/stt';
import { DeepgramSTT, DeepgramConfig } from './deepgram';
import { VoskSTT, VoskConfig } from './vosk';

const logger = createModuleLogger('STTManager');

/**
 * STT Manager configuration
 */
export interface STTManagerConfig {
  /** Deepgram configuration */
  deepgram?: Partial<DeepgramConfig>;
  /** Vosk configuration */
  vosk?: Partial<VoskConfig>;
  /** Prefer offline mode (use Vosk first) */
  preferOffline?: boolean;
  /** Auto-switch to fallback on errors */
  autoFallback?: boolean;
  /** Number of consecutive errors before switching */
  errorThreshold?: number;
  /** Time to wait before trying primary again (ms) */
  fallbackCooldown?: number;
}

/**
 * Default STT Manager configuration
 */
const DEFAULT_STT_MANAGER_CONFIG: Required<STTManagerConfig> = {
  deepgram: {},
  vosk: {},
  preferOffline: false,
  autoFallback: true,
  errorThreshold: 3,
  fallbackCooldown: 60000, // 1 minute
};

/**
 * STT Provider type
 */
export type STTProviderType = 'deepgram' | 'vosk';

/**
 * STT Manager events
 */
export interface STTManagerEvents extends STTEvents {
  /** Provider switched */
  'provider-switch': (from: STTProviderType | null, to: STTProviderType, reason: string) => void;
  /** Fallback activated */
  'fallback-activated': (provider: STTProviderType, reason: string) => void;
  /** Primary restored */
  'primary-restored': () => void;
}

/**
 * STT Manager
 * Orchestrates STT providers with automatic fallback
 */
export class STTManager extends EventEmitter implements STTProvider {
  readonly name = 'stt-manager';
  private config: Required<STTManagerConfig>;

  // Providers
  private deepgramSTT: DeepgramSTT | null = null;
  private voskSTT: VoskSTT | null = null;
  private activeProvider: STTProvider | null = null;
  private activeProviderType: STTProviderType | null = null;

  // Circuit breaker for Deepgram
  private deepgramBreaker: CircuitBreaker;

  // State tracking
  private consecutiveErrors = 0;
  private lastFallbackTime = 0;
  private _status: STTStatus = STTStatus.IDLE;
  private isOfflineMode = false;

  constructor(config?: Partial<STTManagerConfig>) {
    super();
    this.config = { ...DEFAULT_STT_MANAGER_CONFIG, ...config } as Required<STTManagerConfig>;

    // Initialize circuit breaker for Deepgram
    this.deepgramBreaker = new CircuitBreaker('deepgram', {
      failureThreshold: this.config.errorThreshold,
      timeout: this.config.fallbackCooldown,
      onStateChange: (from, to) => {
        if (to === CircuitState.OPEN) {
          logger.warn('Deepgram circuit breaker opened - switching to fallback');
          this.switchToFallback('Circuit breaker opened');
        } else if (to === CircuitState.HALF_OPEN) {
          logger.info('Deepgram circuit breaker half-open - will retry primary');
        } else if (to === CircuitState.CLOSED) {
          logger.info('Deepgram circuit breaker closed - primary available');
        }
      },
    });

    logger.info('STTManager initialized', {
      preferOffline: this.config.preferOffline,
      autoFallback: this.config.autoFallback,
    });
  }

  /**
   * Get current status
   */
  get status(): STTStatus {
    return this._status;
  }

  /**
   * Set status and emit event
   */
  private setStatus(status: STTStatus): void {
    if (this._status !== status) {
      this._status = status;
      this.emit('status', status);
    }
  }

  /**
   * Get active provider type
   */
  getActiveProviderType(): STTProviderType | null {
    return this.activeProviderType;
  }

  /**
   * Check if using offline mode
   */
  isUsingOffline(): boolean {
    return this.isOfflineMode || this.activeProviderType === 'vosk';
  }

  /**
   * Initialize providers
   */
  private async initializeProviders(): Promise<void> {
    // Initialize Deepgram if API key provided
    if (this.config.deepgram.apiKey) {
      try {
        this.deepgramSTT = new DeepgramSTT(this.config.deepgram);
        this.setupProviderListeners(this.deepgramSTT, 'deepgram');
        logger.info('Deepgram provider initialized');
      } catch (error) {
        logger.warn('Failed to initialize Deepgram', { error: (error as Error).message });
      }
    }

    // Initialize Vosk (always available as fallback)
    try {
      this.voskSTT = new VoskSTT(this.config.vosk);
      this.setupProviderListeners(this.voskSTT, 'vosk');
      logger.info('Vosk provider initialized');
    } catch (error) {
      logger.warn('Failed to initialize Vosk', { error: (error as Error).message });
    }
  }

  /**
   * Set up event listeners for a provider
   */
  private setupProviderListeners(provider: STTProvider, type: STTProviderType): void {
    provider.on('transcript', (result: TranscriptionResult) => {
      if (provider === this.activeProvider) {
        this.emit('transcript', result);
      }
    });

    provider.on('final', (result: TranscriptionResult) => {
      if (provider === this.activeProvider) {
        this.consecutiveErrors = 0; // Reset on successful transcription
        this.emit('final', result);
      }
    });

    provider.on('interim', (result: TranscriptionResult) => {
      if (provider === this.activeProvider) {
        this.emit('interim', result);
      }
    });

    provider.on('error', (error: Error) => {
      if (provider === this.activeProvider) {
        this.handleProviderError(error, type);
      }
    });

    provider.on('status', (status: STTStatus) => {
      if (provider === this.activeProvider) {
        this.setStatus(status);
      }
    });

    provider.on('utteranceEnd', () => {
      if (provider === this.activeProvider) {
        this.emit('utteranceEnd');
      }
    });

    provider.on('speechStarted', () => {
      if (provider === this.activeProvider) {
        this.emit('speechStarted');
      }
    });

    provider.on('open', () => {
      if (provider === this.activeProvider) {
        this.emit('open');
      }
    });

    provider.on('close', (code?: number, reason?: string) => {
      if (provider === this.activeProvider) {
        this.emit('close', code, reason);
      }
    });
  }

  /**
   * Handle provider error
   */
  private handleProviderError(error: Error, type: STTProviderType): void {
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
      type === 'deepgram' &&
      this.consecutiveErrors >= this.config.errorThreshold
    ) {
      this.deepgramBreaker.recordFailure();
    }
  }

  /**
   * Switch to fallback provider
   */
  private async switchToFallback(reason: string): Promise<void> {
    if (this.activeProviderType === 'vosk') {
      logger.warn('Already using fallback provider');
      return;
    }

    logger.info('Switching to fallback provider', { reason });
    this.lastFallbackTime = Date.now();

    const previousType = this.activeProviderType;

    // Stop current provider
    if (this.activeProvider) {
      await this.activeProvider.stop();
    }

    // Switch to Vosk
    if (this.voskSTT) {
      try {
        await this.voskSTT.start();
        this.activeProvider = this.voskSTT;
        this.activeProviderType = 'vosk';
        this.isOfflineMode = true;
        this.consecutiveErrors = 0;

        this.emit('fallback-activated', 'vosk', reason);
        this.emit('provider-switch', previousType, 'vosk', reason);
        logger.info('Switched to Vosk fallback');
      } catch (error) {
        logger.error('Failed to start fallback provider', { error: (error as Error).message });
        this.setStatus(STTStatus.ERROR);
        throw error;
      }
    } else {
      throw new Error('No fallback provider available');
    }
  }

  /**
   * Try to restore primary provider
   */
  async tryRestorePrimary(): Promise<boolean> {
    if (this.activeProviderType === 'deepgram' || !this.deepgramSTT) {
      return false;
    }

    // Check if cooldown has passed
    if (Date.now() - this.lastFallbackTime < this.config.fallbackCooldown) {
      return false;
    }

    // Check circuit breaker
    if (!this.deepgramBreaker.canAttempt()) {
      return false;
    }

    logger.info('Attempting to restore primary provider');

    try {
      // Stop current fallback
      if (this.activeProvider) {
        await this.activeProvider.stop();
      }

      // Try to start Deepgram
      await this.deepgramSTT.start();
      this.activeProvider = this.deepgramSTT;
      this.activeProviderType = 'deepgram';
      this.isOfflineMode = false;
      this.consecutiveErrors = 0;
      this.deepgramBreaker.recordSuccess();

      this.emit('primary-restored');
      this.emit('provider-switch', 'vosk', 'deepgram', 'Primary restored');
      logger.info('Primary provider restored');
      return true;
    } catch (error) {
      logger.warn('Failed to restore primary, continuing with fallback', {
        error: (error as Error).message,
      });
      this.deepgramBreaker.recordFailure();

      // Restart fallback
      if (this.voskSTT) {
        await this.voskSTT.start();
        this.activeProvider = this.voskSTT;
        this.activeProviderType = 'vosk';
      }
      return false;
    }
  }

  /**
   * Start STT (selects best available provider)
   */
  async start(): Promise<void> {
    if (this._status === STTStatus.CONNECTED || this._status === STTStatus.LISTENING) {
      logger.warn('Already started');
      return;
    }

    this.setStatus(STTStatus.CONNECTING);

    // Initialize providers if not done
    if (!this.deepgramSTT && !this.voskSTT) {
      await this.initializeProviders();
    }

    // Select provider based on preference and availability
    let provider: STTProvider | null = null;
    let providerType: STTProviderType | null = null;

    if (this.config.preferOffline || this.isOfflineMode) {
      // Try Vosk first
      if (this.voskSTT) {
        try {
          await this.voskSTT.start();
          provider = this.voskSTT;
          providerType = 'vosk';
        } catch (error) {
          logger.warn('Vosk failed, trying Deepgram', { error: (error as Error).message });
        }
      }

      // Fall back to Deepgram if Vosk failed
      if (!provider && this.deepgramSTT && this.deepgramBreaker.canAttempt()) {
        try {
          await this.deepgramSTT.start();
          provider = this.deepgramSTT;
          providerType = 'deepgram';
          this.deepgramBreaker.recordSuccess();
        } catch (error) {
          this.deepgramBreaker.recordFailure();
          throw error;
        }
      }
    } else {
      // Try Deepgram first (default)
      if (this.deepgramSTT && this.deepgramBreaker.canAttempt()) {
        try {
          await this.deepgramSTT.start();
          provider = this.deepgramSTT;
          providerType = 'deepgram';
          this.deepgramBreaker.recordSuccess();
        } catch (error) {
          logger.warn('Deepgram failed, trying Vosk fallback', { error: (error as Error).message });
          this.deepgramBreaker.recordFailure();
        }
      }

      // Fall back to Vosk if Deepgram failed
      if (!provider && this.voskSTT) {
        try {
          await this.voskSTT.start();
          provider = this.voskSTT;
          providerType = 'vosk';
          this.isOfflineMode = true;
          this.emit('fallback-activated', 'vosk', 'Primary unavailable');
        } catch (error) {
          throw new Error('All STT providers failed to start');
        }
      }
    }

    if (!provider || !providerType) {
      this.setStatus(STTStatus.ERROR);
      throw new Error('No STT provider available');
    }

    this.activeProvider = provider;
    this.activeProviderType = providerType;
    this.setStatus(STTStatus.CONNECTED);

    logger.info('STT started', { provider: providerType });
    this.emit('provider-switch', null, providerType, 'Initial start');
  }

  /**
   * Stop STT
   */
  async stop(): Promise<void> {
    if (this.activeProvider) {
      await this.activeProvider.stop();
      this.activeProvider = null;
      this.activeProviderType = null;
    }

    this.setStatus(STTStatus.CLOSED);
    logger.info('STT stopped');
  }

  /**
   * Send audio data to active provider
   */
  sendAudio(audioData: Buffer | Int16Array): void {
    if (!this.activeProvider || !this.isReady()) {
      return;
    }
    this.activeProvider.sendAudio(audioData);
  }

  /**
   * Check if ready to receive audio
   */
  isReady(): boolean {
    return this.activeProvider?.isReady() || false;
  }

  /**
   * Get current configuration
   */
  getConfig(): STTConfig {
    return this.activeProvider?.getConfig() || { apiKey: '' };
  }

  /**
   * Set offline mode preference
   */
  setOfflineMode(enabled: boolean): void {
    this.isOfflineMode = enabled;
    logger.info('Offline mode set', { enabled });
  }

  /**
   * Force switch to specific provider
   */
  async switchToProvider(type: STTProviderType): Promise<void> {
    const provider = type === 'deepgram' ? this.deepgramSTT : this.voskSTT;

    if (!provider) {
      throw new Error(`Provider ${type} not available`);
    }

    const previousType = this.activeProviderType;

    // Stop current provider
    if (this.activeProvider) {
      await this.activeProvider.stop();
    }

    // Start requested provider
    await provider.start();
    this.activeProvider = provider;
    this.activeProviderType = type;
    this.isOfflineMode = type === 'vosk';
    this.consecutiveErrors = 0;

    this.emit('provider-switch', previousType, type, 'Manual switch');
    logger.info('Manually switched provider', { to: type });
  }

  // Type-safe event emitter methods
  on<K extends keyof STTManagerEvents>(event: K, listener: STTManagerEvents[K]): this {
    return super.on(event, listener);
  }

  off<K extends keyof STTManagerEvents>(event: K, listener: STTManagerEvents[K]): this {
    return super.off(event, listener);
  }

  emit<K extends keyof STTManagerEvents>(
    event: K,
    ...args: Parameters<STTManagerEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }
}

// Singleton instance
let sttManager: STTManager | null = null;

/**
 * Get or create STT manager instance
 */
export function getSTTManager(config?: Partial<STTManagerConfig>): STTManager {
  if (!sttManager) {
    sttManager = new STTManager(config);
  }
  return sttManager;
}

/**
 * Shutdown STT manager
 */
export async function shutdownSTTManager(): Promise<void> {
  if (sttManager) {
    await sttManager.stop();
    sttManager = null;
  }
}

export default STTManager;
