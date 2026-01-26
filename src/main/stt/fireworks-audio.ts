/**
 * Atlas Desktop - Fireworks Audio Provider (STT)
 *
 * Speech-to-text using Fireworks AI Whisper models.
 * Alternative to Deepgram for transcription.
 *
 * Models available (Jan 2026):
 * - Whisper V3 Turbo: Fastest, cheapest ($0.0009/min)
 * - Whisper V3 Large: Best quality ($0.0015/min)
 * - Streaming ASR v2: Real-time streaming ($0.0035/min)
 *
 * @module stt/fireworks-audio
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import { getConfig } from '../config';
import * as fs from 'fs';

const logger = createModuleLogger('FireworksAudio');

/**
 * Audio transcription models
 */
export const AUDIO_MODELS = {
  WHISPER_TURBO: 'accounts/fireworks/models/whisper-v3-turbo',
  WHISPER_LARGE: 'accounts/fireworks/models/whisper-v3-large',
  STREAMING_V2: 'accounts/fireworks/models/streaming-asr-v2',
} as const;

/**
 * Transcription options
 */
export interface TranscriptionOptions {
  /** Model to use */
  model?: string;
  /** Language hint (ISO 639-1 code) */
  language?: string;
  /** Output format */
  format?: 'text' | 'json' | 'vtt' | 'srt';
  /** Include word-level timestamps */
  wordTimestamps?: boolean;
  /** Temperature for generation */
  temperature?: number;
}

/**
 * Transcription result
 */
export interface TranscriptionResult {
  /** Transcribed text */
  text: string;
  /** Detected language */
  language?: string;
  /** Duration of audio in seconds */
  duration?: number;
  /** Word-level segments (if requested) */
  segments?: Array<{
    text: string;
    start: number;
    end: number;
    confidence?: number;
  }>;
  /** Model used */
  model: string;
  /** Processing latency in ms */
  latency: number;
}

/**
 * Default transcription configuration
 */
const DEFAULT_CONFIG: Required<Omit<TranscriptionOptions, 'language' | 'wordTimestamps'>> = {
  model: AUDIO_MODELS.WHISPER_TURBO,
  format: 'json',
  temperature: 0,
};

/**
 * Fireworks Audio Provider
 *
 * Provides speech-to-text capabilities using Fireworks AI.
 * Can be used as an alternative to Deepgram.
 */
export class FireworksAudio extends EventEmitter {
  private apiKey: string;
  private config: typeof DEFAULT_CONFIG;

  constructor(config?: Partial<TranscriptionOptions>) {
    super();

    const appConfig = getConfig();
    if (!appConfig.fireworksApiKey) {
      throw new Error('Fireworks API key is required for audio transcription');
    }

    this.apiKey = appConfig.fireworksApiKey;
    this.config = { ...DEFAULT_CONFIG, ...config };

    logger.info('FireworksAudio initialized', { model: this.config.model });
  }

  /**
   * Transcribe audio from a file path
   */
  async transcribeFile(
    filePath: string,
    options?: Partial<TranscriptionOptions>
  ): Promise<TranscriptionResult> {
    const startTime = Date.now();
    const opts = { ...this.config, ...options };

    if (!fs.existsSync(filePath)) {
      throw new Error(`Audio file not found: ${filePath}`);
    }

    const audioBuffer = await fs.promises.readFile(filePath);
    return this.transcribeBuffer(audioBuffer, filePath, opts);
  }

  /**
   * Transcribe audio from a buffer
   */
  async transcribeBuffer(
    audioBuffer: Buffer,
    filename: string = 'audio.wav',
    options?: Partial<TranscriptionOptions>
  ): Promise<TranscriptionResult> {
    const startTime = Date.now();
    const opts = { ...this.config, ...options };

    logger.debug('Transcribing audio', {
      model: opts.model,
      size: audioBuffer.length,
      filename,
    });

    // Create form data
    const formData = new FormData();
    const blob = new Blob([new Uint8Array(audioBuffer)], { type: 'audio/wav' });
    formData.append('file', blob, filename);
    formData.append('model', opts.model);

    if (opts.language) {
      formData.append('language', opts.language);
    }
    if (opts.wordTimestamps) {
      formData.append('timestamp_granularities', 'word');
    }
    formData.append('temperature', String(opts.temperature));
    formData.append('response_format', opts.format);

    try {
      const response = await fetch(
        'https://api.fireworks.ai/inference/v1/audio/transcriptions',
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
          },
          body: formData,
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Fireworks Audio API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json() as {
        text: string;
        language?: string;
        duration?: number;
        segments?: Array<{
          text: string;
          start: number;
          end: number;
          avg_logprob?: number;
        }>;
      };

      const latency = Date.now() - startTime;

      const result: TranscriptionResult = {
        text: data.text,
        language: data.language,
        duration: data.duration,
        segments: data.segments?.map((seg) => ({
          text: seg.text,
          start: seg.start,
          end: seg.end,
          confidence: seg.avg_logprob ? Math.exp(seg.avg_logprob) : undefined,
        })),
        model: opts.model,
        latency,
      };

      logger.info('Transcription complete', {
        latency,
        textLength: result.text.length,
        duration: result.duration,
      });

      this.emit('transcription-complete', result);
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Transcription failed', { error: errorMessage });
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Transcribe audio from base64
   */
  async transcribeBase64(
    base64Audio: string,
    options?: Partial<TranscriptionOptions>
  ): Promise<TranscriptionResult> {
    const buffer = Buffer.from(base64Audio, 'base64');
    return this.transcribeBuffer(buffer, 'audio.wav', options);
  }

  /**
   * Get available models
   */
  getAvailableModels(): typeof AUDIO_MODELS {
    return AUDIO_MODELS;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<TranscriptionOptions>): void {
    this.config = { ...this.config, ...config } as typeof DEFAULT_CONFIG;
    logger.info('Audio config updated', this.config);
  }
}

// Singleton instance
let audioInstance: FireworksAudio | null = null;

/**
 * Get the singleton FireworksAudio instance
 */
export function getFireworksAudio(config?: Partial<TranscriptionOptions>): FireworksAudio {
  if (!audioInstance) {
    audioInstance = new FireworksAudio(config);
  }
  return audioInstance;
}

/**
 * Shutdown the audio provider
 */
export function shutdownFireworksAudio(): void {
  if (audioInstance) {
    audioInstance.removeAllListeners();
    audioInstance = null;
    logger.info('FireworksAudio shut down');
  }
}

export default FireworksAudio;
