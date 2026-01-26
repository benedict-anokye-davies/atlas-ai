/**
 * Atlas Desktop - OpenAI Whisper STT Plugin
 * 
 * Provides speech-to-text via OpenAI's Whisper API.
 * Supports both streaming and batch transcription modes.
 * 
 * Features:
 * - High accuracy transcription using Whisper models
 * - Multi-language support with automatic detection
 * - Timestamps for word-level alignment
 * - Integration with Atlas voice pipeline
 * 
 * @module plugins/builtin/whisper-stt
 */

import { EventEmitter } from 'events';
import * as https from 'https';
import * as http from 'http';
import { createModuleLogger } from '../../utils/logger';
import { getConfig } from '../../config';
import { getErrorMessage } from '../../../shared/utils';
import { 
  STTProvider, 
  STTConfig, 
  STTStatus, 
  TranscriptionResult 
} from '../../../shared/types/stt';

const logger = createModuleLogger('WhisperSTT');

// ============================================
// Configuration
// ============================================

export interface WhisperConfig {
  /** OpenAI API Key */
  apiKey?: string;
  /** Model to use: whisper-1 */
  model: 'whisper-1';
  /** Language code (ISO-639-1) or undefined for auto-detect */
  language?: string;
  /** Response format */
  responseFormat: 'json' | 'verbose_json' | 'text' | 'srt' | 'vtt';
  /** Temperature for sampling (0-1) */
  temperature: number;
  /** Sample rate for audio */
  sampleRate: number;
  /** Minimum audio duration to send (ms) */
  minAudioDuration: number;
  /** Maximum audio duration per request (ms) */
  maxAudioDuration: number;
  /** Prompt to guide transcription style */
  prompt?: string;
}

const DEFAULT_WHISPER_CONFIG: WhisperConfig = {
  model: 'whisper-1',
  responseFormat: 'verbose_json',
  temperature: 0,
  sampleRate: 16000,
  minAudioDuration: 500,
  maxAudioDuration: 30000,
};

// ============================================
// Whisper STT Provider
// ============================================

export class WhisperSTT extends EventEmitter implements STTProvider {
  readonly name = 'whisper';
  private _status: STTStatus = STTStatus.CLOSED;
  private config: WhisperConfig;
  private apiKey: string | undefined;
  
  // Audio buffering
  private audioBuffer: Int16Array[] = [];
  private audioBufferLength = 0;
  private processingTimer: NodeJS.Timeout | null = null;
  private isProcessing = false;
  
  // Statistics
  private totalRequests = 0;
  private successfulRequests = 0;
  private failedRequests = 0;
  
  constructor(config: Partial<WhisperConfig> = {}) {
    super();
    this.config = { ...DEFAULT_WHISPER_CONFIG, ...config };
    this.apiKey = this.config.apiKey || process.env.OPENAI_API_KEY;
    
    logger.info('WhisperSTT initialized', {
      model: this.config.model,
      language: this.config.language || 'auto',
      responseFormat: this.config.responseFormat,
    });
  }
  
  get status(): STTStatus {
    return this._status;
  }
  
  // ============================================
  // STTProvider Interface
  // ============================================
  
  async start(): Promise<void> {
    if (this._status === STTStatus.CONNECTED) {
      return;
    }
    
    if (!this.apiKey) {
      throw new Error('OpenAI API key not configured');
    }
    
    // Validate API key by making a test request
    try {
      await this.validateApiKey();
      this._status = STTStatus.CONNECTED;
      this.emit('status', STTStatus.CONNECTED);
      logger.info('WhisperSTT started');
    } catch (error) {
      this._status = STTStatus.ERROR;
      this.emit('status', STTStatus.ERROR);
      throw error;
    }
  }
  
  async stop(): Promise<void> {
    // Process any remaining audio
    if (this.audioBufferLength > 0) {
      await this.flushAudioBuffer();
    }
    
    if (this.processingTimer) {
      clearTimeout(this.processingTimer);
      this.processingTimer = null;
    }
    
    this.audioBuffer = [];
    this.audioBufferLength = 0;
    
    this._status = STTStatus.CLOSED;
    this.emit('status', STTStatus.CLOSED);
    logger.info('WhisperSTT stopped', {
      totalRequests: this.totalRequests,
      successful: this.successfulRequests,
      failed: this.failedRequests,
    });
  }
  
  sendAudio(audioData: Buffer | Int16Array): void {
    if (this._status !== STTStatus.CONNECTED) {
      return;
    }
    
    // Convert Buffer to Int16Array if needed
    const samples = audioData instanceof Int16Array
      ? audioData
      : new Int16Array(audioData.buffer, audioData.byteOffset, audioData.length / 2);
    
    this.audioBuffer.push(samples);
    this.audioBufferLength += samples.length;
    
    // Schedule processing when we have enough audio
    const durationMs = (this.audioBufferLength / this.config.sampleRate) * 1000;
    
    if (durationMs >= this.config.maxAudioDuration) {
      // Max duration reached, process immediately
      this.processAudioBuffer();
    } else if (!this.processingTimer && durationMs >= this.config.minAudioDuration) {
      // Schedule processing after a short delay to batch more audio
      this.processingTimer = setTimeout(() => {
        this.processAudioBuffer();
      }, 500);
    }
  }
  
  isReady(): boolean {
    return this._status === STTStatus.CONNECTED && !this.isProcessing;
  }
  
  getConfig(): STTConfig {
    return {
      apiKey: this.apiKey || '',
      model: this.config.model,
      language: this.config.language || 'en-US',
      punctuate: true,
      profanityFilter: false,
      smartFormat: true,
      interimResults: false, // Whisper is batch-based
      sampleRate: this.config.sampleRate,
      channels: 1,
      encoding: 'linear16',
      utteranceEndMs: 1000,
      vad: false,
    };
  }
  
  // ============================================
  // Audio Processing
  // ============================================
  
  private async processAudioBuffer(): Promise<void> {
    if (this.processingTimer) {
      clearTimeout(this.processingTimer);
      this.processingTimer = null;
    }
    
    if (this.isProcessing || this.audioBufferLength === 0) {
      return;
    }
    
    this.isProcessing = true;
    
    // Combine audio chunks
    const totalLength = this.audioBuffer.reduce((sum, chunk) => sum + chunk.length, 0);
    const combined = new Int16Array(totalLength);
    let offset = 0;
    for (const chunk of this.audioBuffer) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }
    
    // Clear buffer
    this.audioBuffer = [];
    this.audioBufferLength = 0;
    
    try {
      const result = await this.transcribe(combined);
      if (result) {
        this.emit('transcript', result);
      }
    } catch (error) {
      logger.error('Transcription failed', {
        error: getErrorMessage(error),
      });
      this.emit('error', error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.isProcessing = false;
    }
  }
  
  private async flushAudioBuffer(): Promise<void> {
    if (this.audioBufferLength > 0) {
      await this.processAudioBuffer();
    }
  }
  
  // ============================================
  // Whisper API Integration
  // ============================================
  
  private async validateApiKey(): Promise<void> {
    // Make a simple API call to validate the key
    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'api.openai.com',
        path: '/v1/models',
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        },
      }, (res) => {
        if (res.statusCode === 200) {
          resolve();
        } else {
          reject(new Error(`API key validation failed: ${res.statusCode}`));
        }
        res.resume();
      });
      
      req.on('error', reject);
      req.end();
    });
  }
  
  private async transcribe(audio: Int16Array): Promise<TranscriptionResult | null> {
    this.totalRequests++;
    
    // Convert Int16 to WAV format
    const wavBuffer = this.createWavBuffer(audio);
    
    try {
      const response = await this.sendToWhisperAPI(wavBuffer);
      this.successfulRequests++;
      return this.parseResponse(response);
    } catch (error) {
      this.failedRequests++;
      throw error;
    }
  }
  
  private createWavBuffer(samples: Int16Array): Buffer {
    const numChannels = 1;
    const sampleRate = this.config.sampleRate;
    const bitsPerSample = 16;
    const byteRate = sampleRate * numChannels * bitsPerSample / 8;
    const blockAlign = numChannels * bitsPerSample / 8;
    const dataSize = samples.length * 2;
    
    const buffer = Buffer.alloc(44 + dataSize);
    
    // RIFF header
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write('WAVE', 8);
    
    // fmt chunk
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);         // Subchunk1Size
    buffer.writeUInt16LE(1, 20);          // AudioFormat (PCM)
    buffer.writeUInt16LE(numChannels, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(byteRate, 28);
    buffer.writeUInt16LE(blockAlign, 32);
    buffer.writeUInt16LE(bitsPerSample, 34);
    
    // data chunk
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataSize, 40);
    
    // Copy samples
    for (let i = 0; i < samples.length; i++) {
      buffer.writeInt16LE(samples[i], 44 + i * 2);
    }
    
    return buffer;
  }
  
  private sendToWhisperAPI(wavBuffer: Buffer): Promise<WhisperResponse> {
    return new Promise((resolve, reject) => {
      const boundary = '----AtlasWhisperBoundary' + Date.now();
      
      // Build multipart form data
      const formParts: Buffer[] = [];
      
      // File field
      formParts.push(Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="audio.wav"\r\n` +
        `Content-Type: audio/wav\r\n\r\n`
      ));
      formParts.push(wavBuffer);
      formParts.push(Buffer.from('\r\n'));
      
      // Model field
      formParts.push(Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="model"\r\n\r\n` +
        `${this.config.model}\r\n`
      ));
      
      // Response format field
      formParts.push(Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="response_format"\r\n\r\n` +
        `${this.config.responseFormat}\r\n`
      ));
      
      // Temperature field
      formParts.push(Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="temperature"\r\n\r\n` +
        `${this.config.temperature}\r\n`
      ));
      
      // Language field (if specified)
      if (this.config.language) {
        formParts.push(Buffer.from(
          `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="language"\r\n\r\n` +
          `${this.config.language}\r\n`
        ));
      }
      
      // Prompt field (if specified)
      if (this.config.prompt) {
        formParts.push(Buffer.from(
          `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="prompt"\r\n\r\n` +
          `${this.config.prompt}\r\n`
        ));
      }
      
      // Timestamp granularities for verbose_json
      if (this.config.responseFormat === 'verbose_json') {
        formParts.push(Buffer.from(
          `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="timestamp_granularities[]"\r\n\r\n` +
          `word\r\n`
        ));
      }
      
      // Closing boundary
      formParts.push(Buffer.from(`--${boundary}--\r\n`));
      
      const body = Buffer.concat(formParts);
      
      const req = https.request({
        hostname: 'api.openai.com',
        path: '/v1/audio/transcriptions',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': body.length,
        },
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              reject(new Error('Failed to parse Whisper response'));
            }
          } else {
            reject(new Error(`Whisper API error: ${res.statusCode} - ${data}`));
          }
        });
      });
      
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }
  
  private parseResponse(response: WhisperResponse): TranscriptionResult {
    const result: TranscriptionResult = {
      text: response.text || '',
      confidence: 0.95, // Whisper doesn't provide confidence, use high default
      isFinal: true,
      startTime: 0,
      duration: response.duration ? response.duration * 1000 : undefined, // Convert to ms
    };
    
    // Add word-level timestamps if available
    if (response.words) {
      result.words = response.words.map(w => ({
        word: w.word,
        start: w.start * 1000, // Convert to ms
        end: w.end * 1000,
        confidence: 0.95,
      }));
    }
    
    // Add detected language if available
    if (response.language) {
      result.language = response.language;
    }
    
    return result;
  }
  
  // ============================================
  // Batch Transcription
  // ============================================
  
  /**
   * Transcribe a complete audio file
   */
  async transcribeFile(filePath: string): Promise<TranscriptionResult> {
    const fs = await import('fs/promises');
    const audioData = await fs.readFile(filePath);
    
    // Determine file type and convert if needed
    const ext = filePath.toLowerCase().split('.').pop();
    let wavBuffer: Buffer;
    
    if (ext === 'wav') {
      wavBuffer = audioData;
    } else {
      // For other formats, send directly to API (it supports mp3, mp4, mpeg, mpga, m4a, wav, webm)
      return await this.transcribeRawFile(audioData, ext || 'wav');
    }
    
    const response = await this.sendToWhisperAPI(wavBuffer);
    return this.parseResponse(response);
  }
  
  private async transcribeRawFile(data: Buffer, extension: string): Promise<TranscriptionResult> {
    return new Promise((resolve, reject) => {
      const boundary = '----AtlasWhisperBoundary' + Date.now();
      
      const mimeTypes: Record<string, string> = {
        'mp3': 'audio/mpeg',
        'mp4': 'audio/mp4',
        'm4a': 'audio/mp4',
        'mpeg': 'audio/mpeg',
        'mpga': 'audio/mpeg',
        'wav': 'audio/wav',
        'webm': 'audio/webm',
      };
      
      const formParts: Buffer[] = [];
      
      formParts.push(Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="audio.${extension}"\r\n` +
        `Content-Type: ${mimeTypes[extension] || 'audio/wav'}\r\n\r\n`
      ));
      formParts.push(data);
      formParts.push(Buffer.from('\r\n'));
      
      formParts.push(Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="model"\r\n\r\n` +
        `${this.config.model}\r\n`
      ));
      
      formParts.push(Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="response_format"\r\n\r\n` +
        `verbose_json\r\n`
      ));
      
      formParts.push(Buffer.from(`--${boundary}--\r\n`));
      
      const body = Buffer.concat(formParts);
      
      const req = https.request({
        hostname: 'api.openai.com',
        path: '/v1/audio/transcriptions',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': body.length,
        },
      }, (res) => {
        let responseData = '';
        res.on('data', (chunk) => { responseData += chunk; });
        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              resolve(this.parseResponse(JSON.parse(responseData)));
            } catch (e) {
              reject(new Error('Failed to parse Whisper response'));
            }
          } else {
            reject(new Error(`Whisper API error: ${res.statusCode} - ${responseData}`));
          }
        });
      });
      
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }
  
  // ============================================
  // Translation
  // ============================================
  
  /**
   * Translate audio to English text
   */
  async translateToEnglish(audio: Int16Array): Promise<TranscriptionResult> {
    const wavBuffer = this.createWavBuffer(audio);
    
    return new Promise((resolve, reject) => {
      const boundary = '----AtlasWhisperBoundary' + Date.now();
      
      const formParts: Buffer[] = [];
      
      formParts.push(Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="audio.wav"\r\n` +
        `Content-Type: audio/wav\r\n\r\n`
      ));
      formParts.push(wavBuffer);
      formParts.push(Buffer.from('\r\n'));
      
      formParts.push(Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="model"\r\n\r\n` +
        `${this.config.model}\r\n`
      ));
      
      formParts.push(Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="response_format"\r\n\r\n` +
        `verbose_json\r\n`
      ));
      
      formParts.push(Buffer.from(`--${boundary}--\r\n`));
      
      const body = Buffer.concat(formParts);
      
      const req = https.request({
        hostname: 'api.openai.com',
        path: '/v1/audio/translations', // Different endpoint for translation
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': body.length,
        },
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              resolve(this.parseResponse(JSON.parse(data)));
            } catch (e) {
              reject(new Error('Failed to parse Whisper response'));
            }
          } else {
            reject(new Error(`Whisper API error: ${res.statusCode} - ${data}`));
          }
        });
      });
      
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }
  
  // ============================================
  // Statistics
  // ============================================
  
  getStats(): WhisperStats {
    return {
      totalRequests: this.totalRequests,
      successfulRequests: this.successfulRequests,
      failedRequests: this.failedRequests,
      successRate: this.totalRequests > 0 
        ? this.successfulRequests / this.totalRequests 
        : 0,
    };
  }
}

// ============================================
// Types
// ============================================

interface WhisperResponse {
  text: string;
  language?: string;
  duration?: number;
  words?: Array<{
    word: string;
    start: number;
    end: number;
  }>;
  segments?: Array<{
    id: number;
    start: number;
    end: number;
    text: string;
  }>;
}

interface WhisperStats {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  successRate: number;
}

// ============================================
// Plugin Registration
// ============================================

/**
 * Plugin manifest for Whisper STT
 */
export const whisperSTTManifest = {
  name: '@atlas/whisper-stt',
  version: '1.0.0',
  displayName: 'OpenAI Whisper STT',
  description: 'Speech-to-text via OpenAI Whisper API with high accuracy and multi-language support',
  author: 'Atlas Team',
  license: 'MIT',
  main: 'whisper-stt.ts',
  atlasVersion: '>=0.1.0',
  capabilities: ['network'] as const,
  permission: 'normal' as const,
  categories: ['productivity', 'integrations'] as const,
  configSchema: {
    type: 'object' as const,
    properties: {
      language: {
        type: 'string',
        description: 'Language code (ISO-639-1) or leave empty for auto-detect',
      },
      temperature: {
        type: 'number',
        description: 'Temperature for sampling (0-1)',
        minimum: 0,
        maximum: 1,
        default: 0,
      },
      prompt: {
        type: 'string',
        description: 'Prompt to guide transcription style',
      },
    },
  },
  defaultConfig: {
    temperature: 0,
  },
};

// Factory function for creating provider
export function createWhisperSTT(config?: Partial<WhisperConfig>): WhisperSTT {
  return new WhisperSTT(config);
}
