/**
 * Atlas Desktop - Deepgram Speech-to-Text
 * Real-time streaming transcription using Deepgram's Nova model
 */

import { EventEmitter } from 'events';
import { createClient, LiveTranscriptionEvents, LiveClient } from '@deepgram/sdk';
import WebSocket from 'ws';
import { createModuleLogger, PerformanceTimer } from '../utils/logger';
import { APIError, withRetry } from '../utils/errors';
import {
  STTProvider,
  STTConfig,
  STTStatus,
  STTEvents,
  TranscriptionResult,
  TranscriptionWord,
  DEFAULT_STT_CONFIG,
  SupportedLanguage,
  LanguageDetectionResult,
  SUPPORTED_LANGUAGES,
} from '../../shared/types/stt';

const logger = createModuleLogger('DeepgramSTT');
const perfTimer = new PerformanceTimer('DeepgramSTT');

/**
 * Deepgram-specific configuration options
 */
export interface DeepgramConfig extends STTConfig {
  /** Use Nova-2 or Nova-3 model */
  model?: 'nova-2' | 'nova-3' | 'nova' | 'enhanced' | 'base';
  /** Deepgram tier */
  tier?: 'enhanced' | 'base';
  /** Enable diarization (speaker detection) */
  diarize?: boolean;
  /** Number of speakers for diarization (optional, auto-detected if not set) */
  diarizeSpeakers?: number;
  /** Number of alternative transcriptions */
  alternatives?: number;
  /** Keywords to boost recognition (Atlas-specific terms) */
  keywords?: string[];
  /** Custom vocabulary */
  search?: string[];
  /** Enable filler words (um, uh) */
  fillerWords?: boolean;
  /** Endpointing - how long to wait for speech end (ms) */
  endpointing?: number | false;
  /** Enable automatic language detection */
  detectLanguage?: boolean;
  /** Languages to consider for auto-detection */
  detectLanguages?: SupportedLanguage[];
  /** Enable utterances for natural sentence boundaries */
  utterances?: boolean;
  /** Utterance end timeout in ms (how long to wait before finalizing utterance) */
  utteranceEndMs?: number;
}

/**
 * Atlas-specific keywords for improved recognition
 */
const ATLAS_KEYWORDS: string[] = [
  // Core Atlas terms
  'Atlas',
  'portfolio',
  'trading',
  'backtest',
  'Palantir',
  // Trading terms
  'stop loss',
  'take profit',
  'position',
  'long',
  'short',
  'PnL',
  'drawdown',
  'Sharpe',
  // Crypto
  'Bitcoin',
  'Ethereum',
  'Solana',
  'USDT',
  // Commands
  'kill switch',
  'autonomous',
  'regime',
];

/**
 * Default Deepgram configuration
 */
const DEFAULT_DEEPGRAM_CONFIG: Partial<DeepgramConfig> = {
  ...DEFAULT_STT_CONFIG,
  model: 'nova-2',
  // Removed 'enhanced' tier - requires special account access
  // tier: 'enhanced',
  diarize: true,                    // ENABLED: Multi-speaker support
  alternatives: 1,
  fillerWords: false,
  endpointing: 300, // 300ms of silence = end of speech
  detectLanguage: false,
  utterances: true,                 // ENABLED: Natural sentence boundaries
  utteranceEndMs: 1000,             // 1s utterance timeout
  keywords: ATLAS_KEYWORDS,         // ENABLED: Atlas-specific vocabulary
  detectLanguages: ['en', 'es', 'fr', 'de', 'ja', 'zh'],
};

/**
 * Deepgram Speech-to-Text provider
 * Implements real-time streaming transcription with the Nova model
 * Supports multi-language recognition and automatic language detection
 */
export class DeepgramSTT extends EventEmitter implements STTProvider {
  readonly name = 'deepgram';
  private _status: STTStatus = STTStatus.IDLE;
  private config: DeepgramConfig;
  private client: ReturnType<typeof createClient> | null = null;
  private connection: LiveClient | null = null;
  private keepAliveInterval: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 3;
  private isClosing = false; // Prevents writes during shutdown

  // Language tracking
  private _currentLanguage: SupportedLanguage = 'en';
  private _detectedLanguage: SupportedLanguage | null = null;
  private languageDetectionHistory: Array<{ language: SupportedLanguage; confidence: number }> = [];

  constructor(config: Partial<DeepgramConfig> = {}) {
    super();
    this.setMaxListeners(20); // Prevent memory leak warnings
    this.config = { ...DEFAULT_DEEPGRAM_CONFIG, ...config } as DeepgramConfig;

    if (!this.config.apiKey) {
      throw new Error(
        'Deepgram API key is required. Set DEEPGRAM_API_KEY in your environment or pass it in the configuration.'
      );
    }

    // Initialize current language from config
    this._currentLanguage = this.extractLanguageFromCode(this.config.language || 'en-US');

    logger.info('DeepgramSTT initialized', {
      model: this.config.model,
      language: this._currentLanguage,
      detectLanguage: this.config.detectLanguage,
    });
  }

  /**
   * Extract base language code from full language code
   */
  private extractLanguageFromCode(fullCode: string): SupportedLanguage {
    const baseCode = fullCode.split('-')[0].toLowerCase();
    if (baseCode in SUPPORTED_LANGUAGES) {
      return baseCode as SupportedLanguage;
    }
    return 'en'; // Default to English
  }

  /**
   * Get the current language being used for transcription
   */
  get currentLanguage(): SupportedLanguage {
    return this._currentLanguage;
  }

  /**
   * Get the most recently detected language (if auto-detection enabled)
   */
  get detectedLanguage(): SupportedLanguage | null {
    return this._detectedLanguage;
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
      const previousStatus = this._status;
      this._status = status;
      logger.debug('Status changed', { from: previousStatus, to: status });
      this.emit('status', status);
    }
  }

  /**
   * Start the Deepgram connection
   */
  async start(): Promise<void> {
    if (this._status === STTStatus.CONNECTED || this._status === STTStatus.LISTENING) {
      logger.warn('Already connected');
      return;
    }

    this.setStatus(STTStatus.CONNECTING);
    this.isClosing = false; // Reset closing flag on new connection
    perfTimer.start('connect');

    try {
      // Create Deepgram client with Node.js WebSocket for Electron compatibility
      this.client = createClient(this.config.apiKey, {
        global: {
          websocket: {
            client: WebSocket,
          },
        },
      });

      // Build options for live transcription
      const options = this.buildOptions();

      logger.debug('Starting live transcription', { options });

      // Create live transcription connection with retry
      await withRetry(
        async () => {
          this.connection = this.client!.listen.live(options);
          await this.setupConnectionListeners();
        },
        {
          maxAttempts: 3,
          initialDelayMs: 1000,
          onRetry: (attempt, error) => {
            logger.warn(`Connection attempt ${attempt} failed`, { error: error.message });
          },
        }
      );

      // Start keep-alive interval
      this.startKeepAlive();

      this.reconnectAttempts = 0;
      this.setStatus(STTStatus.CONNECTED);
      perfTimer.end('connect');

      logger.info('Deepgram connection established');
    } catch (error) {
      perfTimer.end('connect');
      this.setStatus(STTStatus.ERROR);
      const apiError = new APIError(
        `Failed to connect to Deepgram: ${(error as Error).message}`,
        'deepgram',
        undefined,
        { error: (error as Error).message }
      );
      logger.error('Connection failed', { error: (error as Error).message });
      this.emit('error', apiError);
      throw apiError;
    }
  }

  /**
   * Build Deepgram live transcription options
   */
  private buildOptions(): Record<string, unknown> {
    const options: Record<string, unknown> = {
      model: this.config.model,
      punctuate: this.config.punctuate,
      profanity_filter: this.config.profanityFilter,
      smart_format: this.config.smartFormat,
      interim_results: this.config.interimResults,
      sample_rate: this.config.sampleRate,
      channels: this.config.channels,
      encoding: this.config.encoding,
      vad_events: this.config.vad,
      utterance_end_ms: this.config.utteranceEndMs,
    };

    // Handle language configuration
    if (this.config.detectLanguage) {
      // Enable language detection - Deepgram will auto-detect
      options.detect_language = true;

      // If specific languages to detect are provided, use them
      if (this.config.detectLanguages && this.config.detectLanguages.length > 0) {
        // Map supported languages to Deepgram codes
        const deepgramCodes = this.config.detectLanguages
          .filter((lang) => lang in SUPPORTED_LANGUAGES)
          .map((lang) => SUPPORTED_LANGUAGES[lang].deepgramCode);
        if (deepgramCodes.length > 0) {
          options.language = deepgramCodes;
        }
      }
    } else {
      // Use fixed language from config
      options.language = this.config.language || SUPPORTED_LANGUAGES[this._currentLanguage].deepgramCode;
    }

    // Add Deepgram-specific options
    if (this.config.tier) {
      options.tier = this.config.tier;
    }
    if (this.config.diarize) {
      options.diarize = this.config.diarize;
      // Set number of speakers if specified
      if (this.config.diarizeSpeakers) {
        options.diarize_version = '2';
        options.diarize_max_speakers = this.config.diarizeSpeakers;
      }
    }
    if (this.config.alternatives && this.config.alternatives > 1) {
      options.alternatives = this.config.alternatives;
    }
    if (this.config.keywords?.length) {
      // Format keywords with boost weights for better recognition
      options.keywords = this.config.keywords.map(kw => `${kw}:2`);  // 2x boost
    }
    if (this.config.search?.length) {
      options.search = this.config.search;
    }
    if (this.config.fillerWords) {
      options.filler_words = this.config.fillerWords;
    }
    if (this.config.endpointing !== undefined) {
      options.endpointing = this.config.endpointing;
    }
    // Enable utterances for natural sentence boundaries
    if (this.config.utterances) {
      options.utterances = this.config.utterances;
    }

    return options;
  }

  /**
   * Set up WebSocket connection event listeners
   */
  private setupConnectionListeners(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.connection) {
        reject(new Error('No connection'));
        return;
      }

      let resolved = false;

      // Connection opened
      this.connection.on(LiveTranscriptionEvents.Open, () => {
        logger.debug('WebSocket connection opened');
        this.emit('open');
        if (!resolved) {
          resolved = true;
          resolve();
        }
      });

      // Transcription result
      this.connection.on(LiveTranscriptionEvents.Transcript, (data) => {
        this.handleTranscript(data);
      });

      // Metadata received
      this.connection.on(LiveTranscriptionEvents.Metadata, (data) => {
        logger.debug('Metadata received', { data });
      });

      // Speech started (VAD event)
      this.connection.on(LiveTranscriptionEvents.SpeechStarted, () => {
        logger.debug('Speech started');
        this.setStatus(STTStatus.LISTENING);
        this.emit('speechStarted');
      });

      // Utterance end (VAD event)
      this.connection.on(LiveTranscriptionEvents.UtteranceEnd, () => {
        logger.debug('Utterance ended');
        this.emit('utteranceEnd');
      });

      // Error
      this.connection.on(LiveTranscriptionEvents.Error, (error) => {
        logger.error('Deepgram error', { error });
        this.setStatus(STTStatus.ERROR);
        this.emit('error', error instanceof Error ? error : new Error(String(error)));
        if (!resolved) {
          resolved = true;
          reject(error);
        }
      });

      // Connection closed
      this.connection.on(LiveTranscriptionEvents.Close, (event) => {
        const code = event?.code;
        const reason = event?.reason;
        logger.info('Connection closed', { code, reason });
        this.setStatus(STTStatus.CLOSED);
        this.emit('close', code, reason);
        this.handleDisconnect();
      });

      // Timeout for connection
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          reject(
            new Error(
              'Connection to Deepgram timed out after 10 seconds. Check your network connection and API key.'
            )
          );
        }
      }, 10000);
    });
  }

  /**
   * Handle transcription results from Deepgram
   */
  private handleTranscript(data: unknown): void {
    try {
      const response = data as {
        channel?: {
          alternatives?: Array<{
            transcript?: string;
            confidence?: number;
            words?: Array<{
              word: string;
              start: number;
              end: number;
              confidence: number;
              punctuated_word?: string;
            }>;
            languages?: string[];
          }>;
          detected_language?: string;
        };
        is_final?: boolean;
        speech_final?: boolean;
        duration?: number;
        start?: number;
        metadata?: {
          request_id?: string;
          detected_language?: string;
        };
      };

      const alternative = response.channel?.alternatives?.[0];
      if (!alternative?.transcript) {
        return; // Empty transcript, ignore
      }

      // Process detected language if available
      let detectedLang: string | undefined =
        response.channel?.detected_language ||
        response.metadata?.detected_language ||
        alternative.languages?.[0];

      // Extract detected language and update tracking
      if (detectedLang && this.config.detectLanguage) {
        const normalizedLang = this.extractLanguageFromCode(detectedLang);
        this.updateLanguageDetection(normalizedLang, alternative.confidence || 0.5);
        detectedLang = normalizedLang;
      }

      const words: TranscriptionWord[] = (alternative.words || []).map((w) => ({
        word: w.word,
        start: w.start * 1000, // Convert to ms
        end: w.end * 1000,
        confidence: w.confidence,
        punctuatedWord: w.punctuated_word,
      }));

      const result: TranscriptionResult = {
        text: alternative.transcript,
        isFinal: response.is_final || response.speech_final || false,
        confidence: alternative.confidence || 0,
        duration: response.duration ? response.duration * 1000 : undefined,
        startTime: response.start ? response.start * 1000 : undefined,
        language: detectedLang || this._currentLanguage,
        words: words.length > 0 ? words : undefined,
        raw: data,
      };

      // Log transcription
      if (result.isFinal) {
        logger.info('Final transcript', {
          text: result.text,
          confidence: result.confidence.toFixed(2),
          language: result.language,
        });
      } else {
        logger.debug('Interim transcript', { text: result.text, language: result.language });
      }

      // Emit appropriate events
      this.emit('transcript', result);
      if (result.isFinal) {
        this.emit('final', result);
      } else {
        this.emit('interim', result);
      }
    } catch (error) {
      logger.error('Error processing transcript', { error: (error as Error).message });
    }
  }

  /**
   * Update language detection tracking
   */
  private updateLanguageDetection(language: SupportedLanguage, confidence: number): void {
    // Add to history
    this.languageDetectionHistory.push({ language, confidence });

    // Keep only last 5 detections for averaging
    if (this.languageDetectionHistory.length > 5) {
      this.languageDetectionHistory.shift();
    }

    // Calculate most frequent detected language
    const languageCounts = new Map<SupportedLanguage, number>();
    for (const entry of this.languageDetectionHistory) {
      const count = languageCounts.get(entry.language) || 0;
      languageCounts.set(entry.language, count + entry.confidence);
    }

    // Find language with highest weighted count
    let maxLang: SupportedLanguage = language;
    let maxCount = 0;
    for (const [lang, count] of languageCounts) {
      if (count > maxCount) {
        maxCount = count;
        maxLang = lang;
      }
    }

    // Update detected language if it changed
    if (maxLang !== this._detectedLanguage) {
      const previousLang = this._detectedLanguage;
      this._detectedLanguage = maxLang;
      logger.info('Language detected', {
        language: maxLang,
        previous: previousLang,
        confidence: (maxCount / this.languageDetectionHistory.length).toFixed(2),
      });
    }
  }

  /**
   * Get language detection result
   */
  getLanguageDetection(): LanguageDetectionResult | null {
    if (!this._detectedLanguage || this.languageDetectionHistory.length === 0) {
      return null;
    }

    // Calculate confidence for detected language
    const totalConfidence = this.languageDetectionHistory
      .filter((e) => e.language === this._detectedLanguage)
      .reduce((sum, e) => sum + e.confidence, 0);

    const avgConfidence = totalConfidence / this.languageDetectionHistory.length;

    // Build alternatives from history
    const langScores = new Map<SupportedLanguage, number>();
    for (const entry of this.languageDetectionHistory) {
      const score = langScores.get(entry.language) || 0;
      langScores.set(entry.language, score + entry.confidence);
    }

    const alternatives: Array<{ language: SupportedLanguage; confidence: number }> = [];
    for (const [lang, score] of langScores) {
      if (lang !== this._detectedLanguage) {
        alternatives.push({
          language: lang,
          confidence: score / this.languageDetectionHistory.length,
        });
      }
    }

    return {
      language: this._detectedLanguage,
      confidence: avgConfidence,
      alternatives: alternatives.length > 0 ? alternatives.sort((a, b) => b.confidence - a.confidence) : undefined,
    };
  }

  /**
   * Handle disconnection and potential reconnection
   */
  private handleDisconnect(): void {
    this.stopKeepAlive();

    // Attempt reconnection if not intentionally closed
    if (this._status !== STTStatus.CLOSED && this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      logger.info(`Attempting reconnection ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);

      setTimeout(() => {
        this.start().catch((error) => {
          logger.error('Reconnection failed', { error: error.message });
        });
      }, 1000 * this.reconnectAttempts); // Exponential backoff
    }
  }

  /**
   * Start keep-alive ping interval
   */
  private startKeepAlive(): void {
    this.stopKeepAlive();

    // Send keep-alive every 10 seconds
    this.keepAliveInterval = setInterval(() => {
      if (this.connection && this._status === STTStatus.CONNECTED) {
        try {
          this.connection.keepAlive();
        } catch (error) {
          logger.warn('Keep-alive failed', { error: (error as Error).message });
        }
      }
    }, 10000);
  }

  /**
   * Stop keep-alive interval
   */
  private stopKeepAlive(): void {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }
  }

  /**
   * Stop the Deepgram connection
   */
  async stop(): Promise<void> {
    logger.info('Stopping Deepgram connection');

    // Set closing flag BEFORE anything else to prevent race conditions
    this.isClosing = true;

    this.stopKeepAlive();
    this.setStatus(STTStatus.CLOSED);

    if (this.connection) {
      try {
        this.connection.requestClose();
      } catch (error) {
        logger.warn('Error closing connection', { error: (error as Error).message });
      }
      this.connection = null;
    }

    this.client = null;
    logger.info('Deepgram connection stopped');
  }

  /**
   * Send audio data to Deepgram
   */
  sendAudio(audioData: Buffer | Int16Array): void {
    // Check both isReady and isClosing to prevent race conditions
    if (!this.isReady() || this.isClosing) {
      if (!this.isClosing) {
        logger.warn('Cannot send audio - connection not ready', { status: this._status });
      }
      return;
    }

    // Double-check connection exists
    if (!this.connection) {
      logger.warn('Cannot send audio - connection is null');
      return;
    }

    try {
      // Convert Int16Array to Buffer if needed
      const buffer = audioData instanceof Buffer ? audioData : Buffer.from(audioData.buffer);

      this.connection.send(buffer as unknown as ArrayBuffer);
    } catch (error) {
      const errorMessage = (error as Error).message;
      // Silently ignore "write after end" errors as they're expected during shutdown
      if (errorMessage.includes('write after end') || errorMessage.includes('closed')) {
        logger.debug('Audio send skipped - connection closing', { error: errorMessage });
        return;
      }
      logger.error('Error sending audio', { error: errorMessage });
      this.emit('error', error as Error);
    }
  }

  /**
   * Check if ready to receive audio
   */
  isReady(): boolean {
    return (
      this.connection !== null &&
      !this.isClosing &&
      (this._status === STTStatus.CONNECTED || this._status === STTStatus.LISTENING)
    );
  }

  /**
   * Get current configuration
   */
  getConfig(): STTConfig {
    return { ...this.config };
  }

  /**
   * Update configuration (requires restart)
   */
  updateConfig(config: Partial<DeepgramConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('Configuration updated', { config: this.config });
  }

  /**
   * Set the language for transcription
   * Requires reconnection to take effect
   *
   * @param language - The language code to use
   * @returns True if language was changed and reconnection is needed
   */
  async setLanguage(language: SupportedLanguage): Promise<boolean> {
    if (!(language in SUPPORTED_LANGUAGES)) {
      logger.warn('Unsupported language', { language });
      return false;
    }

    const langInfo = SUPPORTED_LANGUAGES[language];
    const previousLanguage = this._currentLanguage;

    if (language === previousLanguage) {
      logger.debug('Language already set', { language });
      return false;
    }

    // Update current language
    this._currentLanguage = language;
    this.config.language = langInfo.deepgramCode;

    // Clear detection history
    this.languageDetectionHistory = [];
    this._detectedLanguage = null;

    logger.info('Language changed', { from: previousLanguage, to: language });

    // If connected, need to reconnect with new language
    if (this._status === STTStatus.CONNECTED || this._status === STTStatus.LISTENING) {
      logger.info('Reconnecting with new language');
      await this.stop();
      await this.start();
    }

    return true;
  }

  /**
   * Enable or disable automatic language detection
   */
  setAutoDetect(enabled: boolean, languages?: SupportedLanguage[]): void {
    this.config.detectLanguage = enabled;
    if (languages) {
      this.config.detectLanguages = languages;
    }
    logger.info('Auto-detect language updated', {
      enabled,
      languages: this.config.detectLanguages,
    });
  }

  /**
   * Get list of supported languages
   */
  static getSupportedLanguages(): SupportedLanguage[] {
    return Object.keys(SUPPORTED_LANGUAGES) as SupportedLanguage[];
  }

  // Type-safe event emitter methods
  on<K extends keyof STTEvents>(event: K, listener: STTEvents[K]): this {
    return super.on(event, listener);
  }

  off<K extends keyof STTEvents>(event: K, listener: STTEvents[K]): this {
    return super.off(event, listener);
  }

  emit<K extends keyof STTEvents>(event: K, ...args: Parameters<STTEvents[K]>): boolean {
    return super.emit(event, ...args);
  }
}

/**
 * Create a DeepgramSTT instance with configuration from environment
 */
export function createDeepgramSTT(apiKey: string, config?: Partial<DeepgramConfig>): DeepgramSTT {
  return new DeepgramSTT({ apiKey, ...config });
}

export default DeepgramSTT;
