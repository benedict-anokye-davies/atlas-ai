/**
 * Atlas Desktop - TTS Manager
 * Manages TTS providers with automatic fallback
 * Primary: Cartesia (fastest ~90ms), Fallback: Piper/espeak (Offline)
 */

import { EventEmitter } from 'events';
import { BrowserWindow } from 'electron';
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
import { CartesiaTTS, CartesiaConfig } from './cartesia';
import { OfflineTTS, OfflineTTSConfig } from './offline';
import { getAudioPreprocessor, getSystemAudioDucker } from '../voice/audio-preprocessor';
import { SystemAudioDuckingConfig } from '../../shared/types/voice';

const logger = createModuleLogger('TTSManager');

/**
 * TTS Manager configuration
 */
export interface TTSManagerConfig {
  /** Cartesia configuration (fastest, ~90ms latency) */
  cartesia?: Partial<CartesiaConfig>;
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
  /** System audio ducking configuration */
  systemDucking?: Partial<SystemAudioDuckingConfig>;
}

/**
 * Default TTS Manager configuration
 */
const DEFAULT_TTS_MANAGER_CONFIG: Required<TTSManagerConfig> = {
  cartesia: {},
  offline: {},
  preferOffline: false,
  autoFallback: true,
  errorThreshold: 3,
  fallbackCooldown: 60000, // 1 minute
  systemDucking: {}, // Use defaults from SystemAudioDuckingConfig
};

/**
 * TTS Provider type
 */
export type TTSProviderType = 'cartesia' | 'offline';

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
  /** Audio data ready for renderer (base64 data URL) */
  'audio-data': (dataUrl: string, format: string) => void;
}

/**
 * TTS Manager
 * Orchestrates TTS providers with automatic fallback
 */
export class TTSManager extends EventEmitter implements TTSProvider {
  readonly name = 'tts-manager';
  private config: Required<TTSManagerConfig>;

  // Providers
  private cartesiaTTS: CartesiaTTS | null = null;
  private offlineTTS: OfflineTTS | null = null;
  private activeProvider: TTSProvider | null = null;
  private activeProviderType: TTSProviderType | null = null;

  // Circuit breaker for online provider
  private cartesiaBreaker: CircuitBreaker;

  // State tracking
  private consecutiveErrors = 0;
  private lastFallbackTime = 0;
  private _status: TTSStatus = TTSStatus.IDLE;

  constructor(config?: Partial<TTSManagerConfig>) {
    super();
    this.config = { ...DEFAULT_TTS_MANAGER_CONFIG, ...config } as Required<TTSManagerConfig>;

    // Initialize circuit breaker for Cartesia
    this.cartesiaBreaker = new CircuitBreaker('cartesia', {
      failureThreshold: this.config.errorThreshold,
      timeout: this.config.fallbackCooldown,
      onStateChange: (_from, to) => {
        if (to === CircuitState.OPEN) {
          logger.warn('Cartesia circuit breaker opened - switching to fallback');
          this.switchToFallback('Cartesia circuit breaker opened');
        } else if (to === CircuitState.HALF_OPEN) {
          logger.info('Cartesia circuit breaker half-open - will retry');
        } else if (to === CircuitState.CLOSED) {
          logger.info('Cartesia circuit breaker closed - available');
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
   * Get current provider name (alias for getActiveProviderType for compatibility)
   */
  getCurrentProvider(): TTSProviderType | null {
    return this.activeProviderType;
  }

  /**
   * Initialize providers
   */
  private initializeProviders(): void {
    logger.info('TTSManager initializeProviders called', {
      hasCartesiaApiKey: !!this.config.cartesia.apiKey,
      preferredProvider: this.config.preferredProvider,
    });
    
    // Initialize Cartesia if API key provided (fastest provider ~90ms)
    if (this.config.cartesia.apiKey) {
      try {
        logger.info('Creating CartesiaTTS instance...');
        this.cartesiaTTS = new CartesiaTTS(this.config.cartesia as CartesiaConfig);
        this.setupProviderListeners(this.cartesiaTTS as unknown as TTSProvider, 'cartesia');
        // Async initialize Cartesia (verify API connection)
        logger.info('Starting Cartesia async initialization...');
        this.cartesiaTTS.initialize().then(() => {
          logger.info('Cartesia provider initialized successfully (fastest ~90ms latency)');
          // Re-select provider now that Cartesia is ready
          if (this.config.preferredProvider === 'cartesia') {
            logger.info('Re-selecting provider to Cartesia as preferred');
            this.selectProvider();
          }
        }).catch((error) => {
          logger.warn('Cartesia initialization failed, will use offline TTS', { error: (error as Error).message });
          this.cartesiaTTS = null;
          this.selectProvider();
        });
      } catch (error) {
        logger.warn('Failed to initialize Cartesia', { error: (error as Error).message });
      }
    } else {
      logger.info('No Cartesia API key provided, skipping Cartesia');
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
   * Priority: preferOffline > cartesia > offline
   */
  private selectProvider(): void {
    // Prefer offline if configured
    if (this.config.preferOffline && this.offlineTTS) {
      this.activeProvider = this.offlineTTS;
      this.activeProviderType = 'offline';
    }
    // Use Cartesia if available (fastest ~90ms latency)
    else if (this.cartesiaTTS && this.cartesiaBreaker.canAttempt()) {
      this.activeProvider = this.cartesiaTTS as unknown as TTSProvider;
      this.activeProviderType = 'cartesia';
    }
    // Fall back to offline
    else if (this.offlineTTS) {
      this.activeProvider = this.offlineTTS;
      this.activeProviderType = 'offline';
    }
    // Last resort - use Cartesia even if circuit breaker is open
    else if (this.cartesiaTTS) {
      this.activeProvider = this.cartesiaTTS as unknown as TTSProvider;
      this.activeProviderType = 'cartesia';
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
        if (type === 'cartesia') {
          this.cartesiaBreaker.recordSuccess();
        }
        this.emit('synthesized', result);
      }
    });

    provider.on('playbackStart', () => {
      if (provider === this.activeProvider) {
        // Notify audio preprocessor that TTS is starting (enables mic ducking + echo cancellation)
        try {
          const preprocessor = getAudioPreprocessor();
          preprocessor.notifyTTSStart();
        } catch (error) {
          logger.debug('Could not notify preprocessor of TTS start', { error: (error as Error).message });
        }

        // Start system audio ducking (lowers other app volumes)
        try {
          const ducker = getSystemAudioDucker(this.config.systemDucking);
          ducker.startDucking().catch((err) => {
            logger.debug('Could not start system audio ducking', { error: err.message });
          });
        } catch (error) {
          logger.debug('Could not get system audio ducker', { error: (error as Error).message });
        }

        this.emit('playbackStart');
      }
    });

    provider.on('playbackEnd', () => {
      if (provider === this.activeProvider) {
        // Notify audio preprocessor that TTS has ended (releases mic ducking)
        try {
          const preprocessor = getAudioPreprocessor();
          preprocessor.notifyTTSEnd();
          preprocessor.clearEchoReference();
        } catch (error) {
          logger.debug('Could not notify preprocessor of TTS end', { error: (error as Error).message });
        }

        // Stop system audio ducking (restores other app volumes)
        try {
          const ducker = getSystemAudioDucker();
          ducker.stopDucking().catch((err) => {
            logger.debug('Could not stop system audio ducking', { error: err.message });
          });
        } catch (error) {
          logger.debug('Could not get system audio ducker', { error: (error as Error).message });
        }

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
    if (this.config.autoFallback && this.consecutiveErrors >= this.config.errorThreshold) {
      if (type === 'cartesia') {
        this.cartesiaBreaker.recordFailure();
      }
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

    // Cascade fallback: Cartesia -> Offline
    let nextProvider: TTSProvider | null = null;
    let nextType: TTSProviderType = 'offline';

    if (this.offlineTTS) {
      // Fall back to offline
      nextProvider = this.offlineTTS;
      nextType = 'offline';
      logger.info('Falling back to offline provider', { reason });
    }

    if (!nextProvider) {
      logger.error('No fallback provider available');
      return;
    }

    logger.info('Switching to fallback provider', { reason, from: this.activeProviderType, to: nextType });
    this.lastFallbackTime = Date.now();

    const previousType = this.activeProviderType;
    this.activeProvider = nextProvider;
    this.activeProviderType = nextType;
    this.consecutiveErrors = 0;

    this.emit('fallback-activated', nextType, reason);
    this.emit('provider-switch', previousType, nextType, reason);
    logger.info(`Switched to ${nextType} fallback`);
  }

  /**
   * Try to restore primary provider (preferred provider based on config)
   */
  async tryRestorePrimary(): Promise<boolean> {
    // Already using Cartesia or no Cartesia available
    if (this.activeProviderType === 'cartesia' || !this.cartesiaTTS) {
      return false;
    }

    // Check if cooldown has passed
    if (Date.now() - this.lastFallbackTime < this.config.fallbackCooldown) {
      return false;
    }

    // Check circuit breaker
    if (!preferredBreaker.canAttempt()) {
      return false;
    }

    logger.info('Restoring primary provider', { provider: preferredType });

    const previousType = this.activeProviderType;
    this.activeProvider = preferredProvider;
    this.activeProviderType = preferredType;
    this.consecutiveErrors = 0;

    this.emit('primary-restored');
    this.emit('provider-switch', previousType, preferredType, 'Primary restored');
    logger.info('Primary provider restored', { provider: preferredType });
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
      if (this.config.autoFallback && this.activeProviderType === 'cartesia') {
        logger.info('Attempting fallback after synthesis error');
        this.switchToFallback((error as Error).message);
        if (this.activeProvider) {
          return await this.activeProvider.synthesize(text);
        }
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
      if (this.config.autoFallback && this.activeProviderType === 'cartesia') {
        logger.info('Attempting fallback after stream error');
        this.switchToFallback((error as Error).message);
        if (this.activeProvider) {
          yield* this.activeProvider.synthesizeStream(text);
        }
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
      if (this.config.autoFallback && this.activeProviderType === 'cartesia') {
        logger.info('Attempting fallback after speak error');
        this.switchToFallback((error as Error).message);
        if (this.activeProvider) {
          await this.activeProvider.speak(text, priority);
        }
      } else {
        throw error;
      }
    }
  }

  /**
   * Speak text and stream audio to renderer for visualization
   * Synthesizes TTS and sends audio data as base64 to renderer via IPC
   */
  async speakWithAudioStream(text: string, priority = 0): Promise<void> {
    if (!this.activeProvider) {
      throw new Error('No TTS provider available');
    }

    try {
      // Synthesize audio
      const result = await this.synthesize(text);

      // Send audio to renderer for visualization
      this.sendAudioToRenderer(result.audio, result.format);

      // Also add to speech queue for actual playback
      await this.activeProvider.speak(text, priority);
    } catch (error) {
      // Try fallback on error
      if (this.config.autoFallback && this.activeProviderType === 'cartesia' && this.offlineTTS) {
        logger.info('Attempting fallback after speakWithAudioStream error');
        this.switchToFallback((error as Error).message);

        const result = await this.offlineTTS.synthesize(text);
        this.sendAudioToRenderer(result.audio, result.format);
        await this.offlineTTS.speak(text, priority);
      } else {
        throw error;
      }
    }
  }

  /**
   * Create a WAV file buffer from raw PCM data
   * PCM data must have a proper WAV header to be playable by browser Audio API
   */
  private createWavFromPcm(pcmData: Buffer, sampleRate: number, numChannels = 1, bitsPerSample = 16): Buffer {
    const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
    const blockAlign = numChannels * (bitsPerSample / 8);
    const dataSize = pcmData.length;
    const headerSize = 44;
    
    const wavBuffer = Buffer.alloc(headerSize + dataSize);
    
    // RIFF header
    wavBuffer.write('RIFF', 0);
    wavBuffer.writeUInt32LE(36 + dataSize, 4); // File size - 8
    wavBuffer.write('WAVE', 8);
    
    // fmt subchunk
    wavBuffer.write('fmt ', 12);
    wavBuffer.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
    wavBuffer.writeUInt16LE(1, 20); // AudioFormat (1 for PCM)
    wavBuffer.writeUInt16LE(numChannels, 22);
    wavBuffer.writeUInt32LE(sampleRate, 24);
    wavBuffer.writeUInt32LE(byteRate, 28);
    wavBuffer.writeUInt16LE(blockAlign, 32);
    wavBuffer.writeUInt16LE(bitsPerSample, 34);
    
    // data subchunk
    wavBuffer.write('data', 36);
    wavBuffer.writeUInt32LE(dataSize, 40);
    
    // Copy PCM data
    pcmData.copy(wavBuffer, headerSize);
    
    return wavBuffer;
  }

  /**
   * Send audio data to renderer process for visualization
   * Converts audio buffer to base64 data URL and sends via IPC
   * Also sends to audio preprocessor for echo cancellation reference
   */
  sendAudioToRenderer(audioData: Buffer, format: string): void {
    const mainWindow = BrowserWindow.getAllWindows()[0];
    if (!mainWindow) {
      logger.warn('No main window available to send audio data');
      return;
    }

    // Determine MIME type and process audio based on format
    let mimeType = 'audio/mpeg'; // default for mp3
    let processedAudio = audioData;
    
    if (format.startsWith('pcm_')) {
      // PCM format: pcm_22050 or pcm_s16le_22050
      // Extract sample rate from format string
      const sampleRateMatch = format.match(/(\d+)/);
      const sampleRate = sampleRateMatch ? parseInt(sampleRateMatch[1], 10) : 22050;
      
      // Convert raw PCM to WAV with proper header for browser playback
      processedAudio = this.createWavFromPcm(audioData, sampleRate);
      mimeType = 'audio/wav';
      
      logger.debug('Converted PCM to WAV', {
        originalSize: audioData.length,
        wavSize: processedAudio.length,
        sampleRate,
      });
    } else if (format === 'wav') {
      mimeType = 'audio/wav';
    } else if (format.includes('mp3')) {
      mimeType = 'audio/mpeg';
    }

    // Convert to base64 data URL
    const base64 = processedAudio.toString('base64');
    const dataUrl = `data:${mimeType};base64,${base64}`;

    logger.debug('Sending audio to renderer', {
      format,
      mimeType,
      audioSize: processedAudio.length,
      dataUrlLength: dataUrl.length,
    });

    // Send audio reference to preprocessor for echo cancellation
    // Convert audio buffer to Float32Array for NLMS filter
    try {
      const preprocessor = getAudioPreprocessor();
      const floatArray = this.audioBufferToFloat32(audioData, format);
      if (floatArray) {
        preprocessor.setEchoReference(floatArray);
      }
    } catch (error) {
      logger.debug('Could not set echo reference', { error: (error as Error).message });
    }

    // Send to renderer via IPC
    mainWindow.webContents.send('atlas:tts-audio', dataUrl);

    // Also emit event for internal use
    this.emit('audio-data', dataUrl, format);
  }

  /**
   * Convert audio buffer to Float32Array for echo cancellation
   * Supports PCM and attempts basic decoding for other formats
   */
  private audioBufferToFloat32(audioData: Buffer, format: string): Float32Array | null {
    try {
      // For PCM formats, convert directly
      if (format.startsWith('pcm_s16le') || format === 'pcm') {
        // 16-bit signed PCM little-endian
        const samples = audioData.length / 2;
        const floatArray = new Float32Array(samples);
        for (let i = 0; i < samples; i++) {
          const sample = audioData.readInt16LE(i * 2);
          floatArray[i] = sample / 32768.0; // Normalize to -1.0 to 1.0
        }
        return floatArray;
      }

      // For mp3/other compressed formats, we can't easily decode in Node
      // The echo cancellation will be less effective but mic ducking still helps
      // In a production system, you'd use a native decoder like ffmpeg
      logger.debug('Cannot decode audio format for echo reference', { format });
      return null;
    } catch (error) {
      logger.debug('Error converting audio to float32', { error: (error as Error).message });
      return null;
    }
  }

  /**
   * Stream a sentence chunk to TTS with minimal latency
   * Optimized for LLM-to-TTS streaming - starts synthesis immediately without queueing
   * Returns a promise that resolves when the audio starts playing (not when complete)
   *
   * @param text - Sentence chunk to speak
   * @returns Promise that resolves with time-to-first-audio in ms
   */
  async streamSentenceChunk(text: string): Promise<number> {
    if (!this.activeProvider) {
      throw new Error('No TTS provider available');
    }

    const startTime = Date.now();

    try {
      // Use streaming synthesis for lowest latency
      if (this.activeProviderType === 'cartesia' && this.cartesiaTTS) {
        let firstChunkTime = 0;
        const chunks: Buffer[] = [];

        for await (const chunk of this.cartesiaTTS.synthesizeStream(text)) {
          if (chunk.data.length > 0) {
            if (firstChunkTime === 0) {
              firstChunkTime = Date.now() - startTime;
              // Emit first audio chunk immediately
              this.emit('chunk', chunk);
            }
            chunks.push(chunk.data);
          }

          if (chunk.isFinal) {
            break;
          }
        }

        // Send remaining audio to renderer for visualization
        if (chunks.length > 0) {
          const audioBuffer = Buffer.concat(chunks);
          this.sendAudioToRenderer(audioBuffer, 'pcm_44100');
        }

        return firstChunkTime || Date.now() - startTime;
      } else {
        // For offline TTS, synthesize and send audio to renderer for playback
        let firstChunkTime = 0;
        const chunks: Buffer[] = [];

        for await (const chunk of this.activeProvider.synthesizeStream(text)) {
          if (chunk.data.length > 0) {
            if (firstChunkTime === 0) {
              firstChunkTime = Date.now() - startTime;
              this.emit('chunk', chunk);
            }
            chunks.push(chunk.data);
          }

          if (chunk.isFinal) {
            break;
          }
        }

        // Send audio to renderer for playback
        if (chunks.length > 0) {
          const audioBuffer = Buffer.concat(chunks);
          const format = this.activeProviderType === 'offline' ? 'pcm_22050' : 'mp3_44100_128';
          this.sendAudioToRenderer(audioBuffer, format);
        }

        return firstChunkTime || Date.now() - startTime;
      }
    } catch (error) {
      // Try fallback on error
      if (this.config.autoFallback && this.activeProviderType === 'cartesia' && this.offlineTTS) {
        logger.info('Attempting fallback after streamSentenceChunk error');
        this.switchToFallback((error as Error).message);
        
        // Synthesize with offline and send to renderer
        const result = await this.offlineTTS.synthesize(text);
        this.sendAudioToRenderer(result.audio, result.format);
        return Date.now() - startTime;
      }
      throw error;
    }
  }

  /**
   * Queue multiple sentence chunks for sequential streaming
   * Optimized for continuous LLM output - sentences are queued and played back-to-back
   *
   * @param sentences - Array of sentence chunks to speak
   * @returns Promise that resolves when all sentences are queued (not when complete)
   */
  async queueSentenceChunks(sentences: string[]): Promise<void> {
    for (const sentence of sentences) {
      if (sentence.trim()) {
        await this.speak(sentence, 5); // Medium-high priority
      }
    }
  }

  /**
   * Stream audio chunks to renderer in real-time
   * Useful for streaming synthesis where we want live audio reactivity
   */
  async speakWithStreamingAudio(text: string): Promise<void> {
    if (!this.activeProvider) {
      throw new Error('No TTS provider available');
    }

    const mainWindow = BrowserWindow.getAllWindows()[0];
    if (!mainWindow) {
      logger.warn('No main window available for streaming audio');
      return this.speak(text);
    }

    try {
      this.setStatus(TTSStatus.SYNTHESIZING);

      // Collect chunks and send periodically
      const chunks: Buffer[] = [];
      let lastSendTime = Date.now();
      const SEND_INTERVAL_MS = 100; // Send audio data every 100ms for smooth visualization

      for await (const chunk of this.synthesizeStream(text)) {
        if (chunk.data.length > 0) {
          chunks.push(chunk.data);

          // Send accumulated chunks periodically
          const now = Date.now();
          if (now - lastSendTime >= SEND_INTERVAL_MS) {
            const audioBuffer = Buffer.concat(chunks);
            this.sendAudioToRenderer(audioBuffer, chunk.format);
            lastSendTime = now;
          }
        }

        if (chunk.isFinal) {
          // Send any remaining audio
          if (chunks.length > 0) {
            const audioBuffer = Buffer.concat(chunks);
            this.sendAudioToRenderer(audioBuffer, chunk.format);
          }
          break;
        }
      }

      this.setStatus(TTSStatus.IDLE);
    } catch (error) {
      this.setStatus(TTSStatus.ERROR);
      logger.error('Streaming audio failed', { error: (error as Error).message });
      throw error;
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
   * Set dynamic voice settings for emotion-based synthesis
   * Note: Currently only implemented for Cartesia if supported
   */
  setDynamicVoiceSettings(_settings: import('../voice/emotion-to-voice-mapper').DynamicVoiceSettings | null): void {
    // TODO: Implement for Cartesia if the API supports it
    logger.debug('setDynamicVoiceSettings called but not implemented for Cartesia');
  }

  /**
   * Get current dynamic voice settings
   */
  getDynamicVoiceSettings(): import('../voice/emotion-to-voice-mapper').DynamicVoiceSettings | null {
    // TODO: Implement for Cartesia if the API supports it
    return null;
  }

  /**
   * Clear dynamic voice settings
   */
  clearDynamicVoiceSettings(): void {
    // TODO: Implement for Cartesia if the API supports it
    logger.debug('clearDynamicVoiceSettings called but not implemented for Cartesia');
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
    const provider = type === 'cartesia' ? this.cartesiaTTS as unknown as TTSProvider : this.offlineTTS;

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

  // ============================================================================
  // System Audio Ducking Controls
  // ============================================================================

  /**
   * Enable or disable system audio ducking
   * When enabled, other app volumes will be lowered when Atlas speaks
   */
  setSystemDuckingEnabled(enabled: boolean): void {
    try {
      const ducker = getSystemAudioDucker(this.config.systemDucking);
      ducker.setEnabled(enabled);
      logger.info('System audio ducking', { enabled });
    } catch (error) {
      logger.error('Failed to set system ducking state', { error: (error as Error).message });
    }
  }

  /**
   * Check if system audio ducking is enabled
   */
  isSystemDuckingEnabled(): boolean {
    try {
      const ducker = getSystemAudioDucker();
      return ducker.getConfig().enabled;
    } catch {
      return false;
    }
  }

  /**
   * Update system audio ducking configuration
   */
  updateSystemDuckingConfig(config: Partial<SystemAudioDuckingConfig>): void {
    try {
      const ducker = getSystemAudioDucker();
      ducker.updateConfig(config);
      // Also update our stored config
      this.config.systemDucking = { ...this.config.systemDucking, ...config };
      logger.info('System ducking config updated', config);
    } catch (error) {
      logger.error('Failed to update system ducking config', { error: (error as Error).message });
    }
  }

  /**
   * Get current system audio ducking status
   */
  getSystemDuckingStatus(): { enabled: boolean; isActive: boolean; currentVolume: number } {
    try {
      const ducker = getSystemAudioDucker();
      const status = ducker.getStatus();
      return {
        enabled: ducker.getConfig().enabled,
        isActive: status.isActive,
        currentVolume: status.currentVolume,
      };
    } catch {
      return { enabled: false, isActive: false, currentVolume: 1.0 };
    }
  }

  /**
   * Set the ducking level (how much to reduce other app volumes)
   * @param level 0-1 where 0.3 means reduce to 30% (70% reduction)
   */
  setDuckingLevel(level: number): void {
    const clampedLevel = Math.max(0.1, Math.min(1.0, level));
    this.updateSystemDuckingConfig({ duckLevel: clampedLevel });
  }

  /**
   * Set ducking attack/release times
   * @param attackMs Time to lower volume (default 150ms)
   * @param releaseMs Time to restore volume (default 500ms)
   */
  setDuckingTiming(attackMs: number, releaseMs: number): void {
    this.updateSystemDuckingConfig({
      attackMs: Math.max(10, Math.min(1000, attackMs)),
      releaseMs: Math.max(100, Math.min(2000, releaseMs)),
    });
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
