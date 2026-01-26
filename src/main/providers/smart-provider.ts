/**
 * Atlas Desktop - Smart Provider Manager
 * Auto-selects online vs offline providers based on connectivity
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import { getConnectivityManager } from '../utils/connectivity';

const logger = createModuleLogger('SmartProvider');

/**
 * STT Provider options
 */
export type STTProvider = 'deepgram' | 'vosk' | 'whisper';

/**
 * TTS Provider options
 */
export type TTSProvider = 'elevenlabs' | 'piper' | 'system';

/**
 * LLM Provider options
 */
export type LLMProvider = 'fireworks' | 'openrouter' | 'local';

/**
 * Provider selection reason
 */
export interface ProviderSelectionReason {
  provider: string;
  reason: string;
  isOnline: boolean;
  hasApiKey: boolean;
  serviceAvailable: boolean;
}

/**
 * Smart provider configuration
 */
export interface SmartProviderConfig {
  /** Prefer offline providers even when online */
  preferOffline: boolean;
  /** Auto-switch providers when connectivity changes */
  autoSwitch: boolean;
  /** Delay before switching after connectivity change (ms) */
  switchDelay: number;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: SmartProviderConfig = {
  preferOffline: false,
  autoSwitch: true,
  switchDelay: 2000, // Wait 2s before switching to prevent flapping
};

/**
 * SmartProviderManager - Auto-selects providers based on connectivity
 *
 * Features:
 * - Automatic provider selection based on connectivity
 * - Service-specific availability checking
 * - Graceful fallback to offline providers
 * - Event-based provider switch notifications
 */
export class SmartProviderManager extends EventEmitter {
  private config: SmartProviderConfig;
  private currentSTT: STTProvider | null = null;
  private currentTTS: TTSProvider | null = null;
  private currentLLM: LLMProvider | null = null;
  private switchTimeout: NodeJS.Timeout | null = null;
  private unsubscribeConnectivity: (() => void) | null = null;

  constructor(config?: Partial<SmartProviderConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };

    logger.info('SmartProviderManager initialized', {
      preferOffline: this.config.preferOffline,
      autoSwitch: this.config.autoSwitch,
    });
  }

  /**
   * Start monitoring connectivity and auto-switching providers
   */
  start(): void {
    if (this.unsubscribeConnectivity) {
      return; // Already started
    }

    const connectivity = getConnectivityManager();

    this.unsubscribeConnectivity = connectivity.onStatusChange((online) => {
      if (this.config.autoSwitch) {
        this.handleConnectivityChange(online);
      }
    });

    // Select initial providers
    this.selectAllProviders();

    logger.info('SmartProviderManager started');
  }

  /**
   * Stop monitoring and cleanup
   */
  stop(): void {
    if (this.switchTimeout) {
      clearTimeout(this.switchTimeout);
      this.switchTimeout = null;
    }

    if (this.unsubscribeConnectivity) {
      this.unsubscribeConnectivity();
      this.unsubscribeConnectivity = null;
    }

    logger.info('SmartProviderManager stopped');
  }

  /**
   * Handle connectivity change with delay to prevent flapping
   */
  private handleConnectivityChange(online: boolean): void {
    if (this.switchTimeout) {
      clearTimeout(this.switchTimeout);
    }

    this.switchTimeout = setTimeout(() => {
      logger.info('Connectivity changed, re-selecting providers', { online });
      this.selectAllProviders();
      this.switchTimeout = null;
    }, this.config.switchDelay);
  }

  /**
   * Select all providers based on current connectivity
   */
  async selectAllProviders(): Promise<void> {
    await Promise.all([
      this.selectSTTProvider(),
      this.selectTTSProvider(),
      this.selectLLMProvider(),
    ]);
  }

  /**
   * Select the best STT provider
   */
  async selectSTTProvider(): Promise<STTProvider> {
    const connectivity = getConnectivityManager();
    const isOnline = connectivity.isOnline();
    const services = connectivity.getServiceAvailability();
    const hasDeepgramKey = !!process.env.DEEPGRAM_API_KEY;

    let provider: STTProvider;
    let reason: string;

    if (this.config.preferOffline) {
      provider = 'vosk';
      reason = 'Prefer offline mode enabled';
    } else if (isOnline && hasDeepgramKey && services.deepgram) {
      provider = 'deepgram';
      reason = 'Online with valid API key and service available';
    } else if (isOnline && hasDeepgramKey) {
      provider = 'vosk';
      reason = 'Online but Deepgram service unavailable';
    } else if (isOnline) {
      provider = 'vosk';
      reason = 'Online but missing Deepgram API key';
    } else {
      provider = 'vosk';
      reason = 'Offline - using local STT';
    }

    if (this.currentSTT !== provider) {
      const oldProvider = this.currentSTT;
      this.currentSTT = provider;

      const selection: ProviderSelectionReason = {
        provider,
        reason,
        isOnline,
        hasApiKey: hasDeepgramKey,
        serviceAvailable: services.deepgram,
      };

      logger.info('STT provider selected', selection);
      this.emit('stt-provider-change', provider, oldProvider, selection);
    }

    return provider;
  }

  /**
   * Select the best TTS provider
   */
  async selectTTSProvider(): Promise<TTSProvider> {
    const connectivity = getConnectivityManager();
    const isOnline = connectivity.isOnline();
    const services = connectivity.getServiceAvailability();
    const hasElevenLabsKey = !!process.env.ELEVENLABS_API_KEY;

    let provider: TTSProvider;
    let reason: string;

    if (this.config.preferOffline) {
      provider = 'piper';
      reason = 'Prefer offline mode enabled';
    } else if (isOnline && hasElevenLabsKey && services.elevenlabs) {
      provider = 'elevenlabs';
      reason = 'Online with valid API key and service available';
    } else if (isOnline && hasElevenLabsKey) {
      provider = 'piper';
      reason = 'Online but ElevenLabs service unavailable';
    } else if (isOnline) {
      provider = 'system';
      reason = 'Online but missing ElevenLabs API key - using system voice';
    } else {
      provider = 'piper';
      reason = 'Offline - using local TTS';
    }

    if (this.currentTTS !== provider) {
      const oldProvider = this.currentTTS;
      this.currentTTS = provider;

      const selection: ProviderSelectionReason = {
        provider,
        reason,
        isOnline,
        hasApiKey: hasElevenLabsKey,
        serviceAvailable: services.elevenlabs,
      };

      logger.info('TTS provider selected', selection);
      this.emit('tts-provider-change', provider, oldProvider, selection);
    }

    return provider;
  }

  /**
   * Select the best LLM provider
   */
  async selectLLMProvider(): Promise<LLMProvider> {
    const connectivity = getConnectivityManager();
    const isOnline = connectivity.isOnline();
    const services = connectivity.getServiceAvailability();
    const hasFireworksKey = !!process.env.FIREWORKS_API_KEY;
    const hasOpenRouterKey = !!process.env.OPENROUTER_API_KEY;

    let provider: LLMProvider;
    let reason: string;

    if (this.config.preferOffline) {
      provider = 'local';
      reason = 'Prefer offline mode enabled';
    } else if (isOnline && hasFireworksKey && services.fireworks) {
      provider = 'fireworks';
      reason = 'Online with Fireworks API key and service available';
    } else if (isOnline && hasFireworksKey) {
      // Fireworks key but service unavailable - try OpenRouter
      if (hasOpenRouterKey) {
        provider = 'openrouter';
        reason = 'Fireworks unavailable, falling back to OpenRouter';
      } else {
        provider = 'local';
        reason = 'Fireworks unavailable and no OpenRouter key';
      }
    } else if (isOnline && hasOpenRouterKey) {
      provider = 'openrouter';
      reason = 'Online with OpenRouter API key';
    } else if (isOnline) {
      provider = 'local';
      reason = 'Online but missing API keys - using local model';
    } else {
      provider = 'local';
      reason = 'Offline - using local model';
    }

    if (this.currentLLM !== provider) {
      const oldProvider = this.currentLLM;
      this.currentLLM = provider;

      const selection: ProviderSelectionReason = {
        provider,
        reason,
        isOnline,
        hasApiKey: hasFireworksKey || hasOpenRouterKey,
        serviceAvailable: services.fireworks,
      };

      logger.info('LLM provider selected', selection);
      this.emit('llm-provider-change', provider, oldProvider, selection);
    }

    return provider;
  }

  /**
   * Get current STT provider
   */
  getCurrentSTT(): STTProvider | null {
    return this.currentSTT;
  }

  /**
   * Get current TTS provider
   */
  getCurrentTTS(): TTSProvider | null {
    return this.currentTTS;
  }

  /**
   * Get current LLM provider
   */
  getCurrentLLM(): LLMProvider | null {
    return this.currentLLM;
  }

  /**
   * Get all current providers
   */
  getCurrentProviders(): {
    stt: STTProvider | null;
    tts: TTSProvider | null;
    llm: LLMProvider | null;
  } {
    return {
      stt: this.currentSTT,
      tts: this.currentTTS,
      llm: this.currentLLM,
    };
  }

  /**
   * Force selection of a specific STT provider
   */
  forceSTTProvider(provider: STTProvider): void {
    const oldProvider = this.currentSTT;
    this.currentSTT = provider;
    logger.info('STT provider forced', { provider, oldProvider });
    this.emit('stt-provider-change', provider, oldProvider, {
      provider,
      reason: 'Manually set',
      isOnline: getConnectivityManager().isOnline(),
      hasApiKey: true,
      serviceAvailable: true,
    });
  }

  /**
   * Force selection of a specific TTS provider
   */
  forceTTSProvider(provider: TTSProvider): void {
    const oldProvider = this.currentTTS;
    this.currentTTS = provider;
    logger.info('TTS provider forced', { provider, oldProvider });
    this.emit('tts-provider-change', provider, oldProvider, {
      provider,
      reason: 'Manually set',
      isOnline: getConnectivityManager().isOnline(),
      hasApiKey: true,
      serviceAvailable: true,
    });
  }

  /**
   * Force selection of a specific LLM provider
   */
  forceLLMProvider(provider: LLMProvider): void {
    const oldProvider = this.currentLLM;
    this.currentLLM = provider;
    logger.info('LLM provider forced', { provider, oldProvider });
    this.emit('llm-provider-change', provider, oldProvider, {
      provider,
      reason: 'Manually set',
      isOnline: getConnectivityManager().isOnline(),
      hasApiKey: true,
      serviceAvailable: true,
    });
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<SmartProviderConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('SmartProviderManager config updated', config);

    // Re-select providers if preferOffline changed
    if ('preferOffline' in config) {
      this.selectAllProviders();
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): SmartProviderConfig {
    return { ...this.config };
  }

  /**
   * Add listener for STT provider changes
   */
  onSTTChange(
    callback: (
      provider: STTProvider,
      oldProvider: STTProvider | null,
      reason: ProviderSelectionReason
    ) => void
  ): () => void {
    this.on('stt-provider-change', callback);
    return () => this.off('stt-provider-change', callback);
  }

  /**
   * Add listener for TTS provider changes
   */
  onTTSChange(
    callback: (
      provider: TTSProvider,
      oldProvider: TTSProvider | null,
      reason: ProviderSelectionReason
    ) => void
  ): () => void {
    this.on('tts-provider-change', callback);
    return () => this.off('tts-provider-change', callback);
  }

  /**
   * Add listener for LLM provider changes
   */
  onLLMChange(
    callback: (
      provider: LLMProvider,
      oldProvider: LLMProvider | null,
      reason: ProviderSelectionReason
    ) => void
  ): () => void {
    this.on('llm-provider-change', callback);
    return () => this.off('llm-provider-change', callback);
  }
}

// Singleton instance
let smartProviderManager: SmartProviderManager | null = null;

/**
 * Get the singleton SmartProviderManager instance
 */
export function getSmartProviderManager(
  config?: Partial<SmartProviderConfig>
): SmartProviderManager {
  if (!smartProviderManager) {
    smartProviderManager = new SmartProviderManager(config);
  }
  return smartProviderManager;
}

/**
 * Shutdown the smart provider manager
 */
export function shutdownSmartProviderManager(): void {
  if (smartProviderManager) {
    smartProviderManager.stop();
    smartProviderManager.removeAllListeners();
    smartProviderManager = null;
    logger.info('SmartProviderManager shutdown complete');
  }
}
