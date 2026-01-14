/**
 * Nova Desktop - Deepgram Speech-to-Text
 * Real-time streaming transcription using Deepgram's Nova model
 */

import { EventEmitter } from 'events';
import { createClient, LiveTranscriptionEvents, LiveClient } from '@deepgram/sdk';
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
  /** Number of alternative transcriptions */
  alternatives?: number;
  /** Keywords to boost recognition */
  keywords?: string[];
  /** Custom vocabulary */
  search?: string[];
  /** Enable filler words (um, uh) */
  fillerWords?: boolean;
  /** Endpointing - how long to wait for speech end (ms) */
  endpointing?: number | false;
}

/**
 * Default Deepgram configuration
 */
const DEFAULT_DEEPGRAM_CONFIG: Partial<DeepgramConfig> = {
  ...DEFAULT_STT_CONFIG,
  model: 'nova-2',
  tier: 'enhanced',
  diarize: false,
  alternatives: 1,
  fillerWords: false,
  endpointing: 300, // 300ms of silence = end of speech
};

/**
 * Deepgram Speech-to-Text provider
 * Implements real-time streaming transcription with the Nova model
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

  constructor(config: Partial<DeepgramConfig> = {}) {
    super();
    this.config = { ...DEFAULT_DEEPGRAM_CONFIG, ...config } as DeepgramConfig;

    if (!this.config.apiKey) {
      throw new Error(
        'Deepgram API key is required. Set DEEPGRAM_API_KEY in your environment or pass it in the configuration.'
      );
    }

    logger.info('DeepgramSTT initialized', { model: this.config.model });
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
    perfTimer.start('connect');

    try {
      // Create Deepgram client
      this.client = createClient(this.config.apiKey);

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
      language: this.config.language,
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

    // Add Deepgram-specific options
    if (this.config.tier) {
      options.tier = this.config.tier;
    }
    if (this.config.diarize) {
      options.diarize = this.config.diarize;
    }
    if (this.config.alternatives && this.config.alternatives > 1) {
      options.alternatives = this.config.alternatives;
    }
    if (this.config.keywords?.length) {
      options.keywords = this.config.keywords;
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
          }>;
        };
        is_final?: boolean;
        speech_final?: boolean;
        duration?: number;
        start?: number;
        metadata?: {
          request_id?: string;
        };
      };

      const alternative = response.channel?.alternatives?.[0];
      if (!alternative?.transcript) {
        return; // Empty transcript, ignore
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
        words: words.length > 0 ? words : undefined,
        raw: data,
      };

      // Log transcription
      if (result.isFinal) {
        logger.info('Final transcript', {
          text: result.text,
          confidence: result.confidence.toFixed(2),
        });
      } else {
        logger.debug('Interim transcript', { text: result.text });
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
    if (!this.isReady()) {
      logger.warn('Cannot send audio - connection not ready', { status: this._status });
      return;
    }

    try {
      // Convert Int16Array to Buffer if needed
      const buffer = audioData instanceof Buffer ? audioData : Buffer.from(audioData.buffer);

      this.connection!.send(buffer as unknown as ArrayBuffer);
    } catch (error) {
      logger.error('Error sending audio', { error: (error as Error).message });
      this.emit('error', error as Error);
    }
  }

  /**
   * Check if ready to receive audio
   */
  isReady(): boolean {
    return (
      this.connection !== null &&
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
