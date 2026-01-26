/**
 * Atlas Desktop - ElevenLabs TTS Plugin
 * 
 * Provides high-quality text-to-speech via ElevenLabs API.
 * Supports voice cloning, streaming, and multiple voice presets.
 * 
 * Features:
 * - Multiple professional voice presets
 * - Voice cloning from audio samples
 * - Streaming audio for low latency
 * - Voice settings customization
 * - Multi-language support
 * 
 * @module plugins/builtin/elevenlabs-tts
 */

import { EventEmitter } from 'events';
import * as https from 'https';
import { createModuleLogger } from '../../utils/logger';
import { getErrorMessage } from '../../../shared/utils';
import {
  TTSProvider,
  TTSConfig,
  TTSStatus,
  TTSAudioChunk,
  TTSSynthesisResult,
  SpeechQueueItem,
  VoiceSettings,
} from '../../../shared/types/tts';

const logger = createModuleLogger('ElevenLabsPlugin');

// ============================================
// Configuration
// ============================================

export interface ElevenLabsVoiceSettings {
  /** Stability (0-1) */
  stability: number;
  /** Similarity boost (0-1) */
  similarityBoost: number;
  /** Style (0-1) */
  style: number;
  /** Use speaker boost */
  useSpeakerBoost: boolean;
}

export interface ElevenLabsPluginConfig {
  /** ElevenLabs API Key */
  apiKey?: string;
  /** Voice ID to use */
  voiceId: string;
  /** Model to use */
  modelId: 'eleven_monolingual_v1' | 'eleven_multilingual_v1' | 'eleven_multilingual_v2' | 'eleven_turbo_v2';
  /** Voice settings */
  voiceSettings: ElevenLabsVoiceSettings;
  /** Output format */
  outputFormat: 'mp3_44100_128' | 'mp3_22050_32' | 'pcm_16000' | 'pcm_22050' | 'pcm_24000' | 'pcm_44100';
  /** Enable streaming */
  streaming: boolean;
  /** Latency optimization (0-4, higher = more optimized) */
  optimizeStreamingLatency: number;
}

const DEFAULT_CONFIG: ElevenLabsPluginConfig = {
  voiceId: '21m00Tcm4TlvDq8ikWAM', // Rachel voice
  modelId: 'eleven_multilingual_v2',
  voiceSettings: {
    stability: 0.5,
    similarityBoost: 0.75,
    style: 0.0,
    useSpeakerBoost: true,
  },
  outputFormat: 'mp3_44100_128',
  streaming: true,
  optimizeStreamingLatency: 3,
};

// ============================================
// Voice Presets
// ============================================

export const VOICE_PRESETS: Record<string, { id: string; name: string; description: string }> = {
  rachel: { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel', description: 'Young female, calm and professional' },
  drew: { id: '29vD33N1CtxCmqQRPOHJ', name: 'Drew', description: 'Young male, conversational' },
  clyde: { id: '2EiwWnXFnvU5JabPnv8n', name: 'Clyde', description: 'Middle-aged male, deep voice' },
  paul: { id: '5Q0t7uMcjvnagumLfvZi', name: 'Paul', description: 'Middle-aged male, news anchor style' },
  domi: { id: 'AZnzlk1XvdvUeBnXmlld', name: 'Domi', description: 'Young female, energetic' },
  dave: { id: 'CYw3kZ02Hs0563khs1Fj', name: 'Dave', description: 'Young male, British accent' },
  sarah: { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah', description: 'Young female, American accent' },
  antoni: { id: 'ErXwobaYiN019PkySvjV', name: 'Antoni', description: 'Middle-aged male, conversational' },
  thomas: { id: 'GBv7mTt0atIp3Br8iCZE', name: 'Thomas', description: 'Young male, calm' },
  charlie: { id: 'IKne3meq5aSn9XLyUdCD', name: 'Charlie', description: 'Middle-aged male, Australian accent' },
  george: { id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George', description: 'Middle-aged male, British accent' },
  emily: { id: 'LcfcDJNUP1GQjkzn1xUU', name: 'Emily', description: 'Young female, calm' },
  elli: { id: 'MF3mGyEYCl7XYWbV9V6O', name: 'Elli', description: 'Young female, expressive' },
  callum: { id: 'N2lVS1w4EtoT3dr4eOWO', name: 'Callum', description: 'Middle-aged male, Scottish accent' },
  dorothy: { id: 'ThT5KcBeYPX3keUQqHPh', name: 'Dorothy', description: 'Elderly female, British accent' },
  josh: { id: 'TxGEqnHWrfWFTfGW9XjX', name: 'Josh', description: 'Young male, deep voice' },
  arnold: { id: 'VR6AewLTigWG4xSOukaG', name: 'Arnold', description: 'Middle-aged male, storyteller' },
  charlotte: { id: 'XB0fDUnXU5powFXDhCwa', name: 'Charlotte', description: 'Young female, Swedish accent' },
  alice: { id: 'Xb7hH8MSUJpSbSDYk0k2', name: 'Alice', description: 'Middle-aged female, British accent' },
  matilda: { id: 'XrExE9yKIg1WjnnlVkGX', name: 'Matilda', description: 'Young female, warm' },
  james: { id: 'ZQe5CZNOzWyzPSCn5a3c', name: 'James', description: 'Elderly male, Australian accent' },
  adam: { id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam', description: 'Middle-aged male, deep voice, narration' },
  sam: { id: 'yoZ06aMxZJJ28mfd3POQ', name: 'Sam', description: 'Young male, raspy' },
};

// ============================================
// ElevenLabs TTS Plugin
// ============================================

export class ElevenLabsTTSPlugin extends EventEmitter implements TTSProvider {
  readonly name = 'elevenlabs-plugin';
  private _status: TTSStatus = TTSStatus.IDLE;
  private config: ElevenLabsPluginConfig;
  private apiKey: string | undefined;
  
  // Speech queue
  private queue: SpeechQueueItem[] = [];
  private currentItem: SpeechQueueItem | null = null;
  private isProcessingQueue = false;
  private isPaused = false;
  
  // Audio playback
  private audioChunks: Buffer[] = [];
  
  // Statistics
  private charactersProcessed = 0;
  private requestCount = 0;
  
  constructor(config: Partial<ElevenLabsPluginConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.apiKey = this.config.apiKey || process.env.ELEVENLABS_API_KEY;
    
    logger.info('ElevenLabsTTSPlugin initialized', {
      voiceId: this.config.voiceId,
      modelId: this.config.modelId,
      streaming: this.config.streaming,
    });
  }
  
  get status(): TTSStatus {
    return this._status;
  }
  
  // ============================================
  // TTSProvider Interface
  // ============================================
  
  async synthesize(text: string): Promise<TTSSynthesisResult> {
    if (!this.apiKey) {
      throw new Error('ElevenLabs API key not configured');
    }
    
    const startTime = Date.now();
    this.requestCount++;
    this.charactersProcessed += text.length;
    
    try {
      const audioBuffer = await this.callSynthesisAPI(text);
      const duration = this.estimateDuration(audioBuffer);
      
      return {
        audio: audioBuffer,
        duration,
        format: this.config.outputFormat.startsWith('mp3') ? 'mp3' : 'pcm',
        characterCount: text.length,
        latency: Date.now() - startTime,
      };
    } catch (error) {
      logger.error('Synthesis failed', {
        error: getErrorMessage(error),
        textLength: text.length,
      });
      throw error;
    }
  }
  
  async *synthesizeStream(text: string): AsyncGenerator<TTSAudioChunk> {
    if (!this.apiKey) {
      throw new Error('ElevenLabs API key not configured');
    }
    
    this.requestCount++;
    this.charactersProcessed += text.length;
    
    const chunkIndex = 0;
    let totalBytes = 0;
    const startTime = Date.now();
    
    for await (const chunk of this.callStreamingAPI(text)) {
      totalBytes += chunk.length;
      
      yield {
        data: chunk,
        format: this.config.outputFormat.startsWith('mp3') ? 'mp3' : 'pcm',
        isFinal: false,
        duration: undefined,
      };
    }
    
    // Final chunk marker
    yield {
      data: Buffer.alloc(0),
      format: this.config.outputFormat.startsWith('mp3') ? 'mp3' : 'pcm',
      isFinal: true,
      duration: Date.now() - startTime,
    };
    
    logger.debug('Streaming synthesis complete', {
      chunks: chunkIndex,
      totalBytes,
      duration: Date.now() - startTime,
    });
  }
  
  async speak(text: string, priority = 0): Promise<void> {
    const item: SpeechQueueItem = {
      id: `speech_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      text,
      priority,
      status: 'pending',
      queuedAt: Date.now(),
    };
    
    // Insert based on priority
    const insertIndex = this.queue.findIndex(q => q.priority < priority);
    if (insertIndex === -1) {
      this.queue.push(item);
    } else {
      this.queue.splice(insertIndex, 0, item);
    }
    
    this.emit('queue:updated', this.queue);
    
    if (!this.isProcessingQueue) {
      await this.processQueue();
    }
  }
  
  stop(): void {
    this.currentItem = null;
    this.audioChunks = [];
    this._status = TTSStatus.IDLE;
    this.emit('status', TTSStatus.IDLE);
    this.emit('stop');
  }
  
  pause(): void {
    if (this._status === TTSStatus.PLAYING) {
      this.isPaused = true;
      this._status = TTSStatus.PAUSED;
      this.emit('status', TTSStatus.PAUSED);
      this.emit('pause');
    }
  }
  
  resume(): void {
    if (this.isPaused) {
      this.isPaused = false;
      if (this.currentItem) {
        this._status = TTSStatus.PLAYING;
        this.emit('status', TTSStatus.PLAYING);
        this.emit('resume');
      }
    }
  }
  
  isSpeaking(): boolean {
    return this._status === TTSStatus.PLAYING || this._status === TTSStatus.SYNTHESIZING;
  }
  
  getQueue(): SpeechQueueItem[] {
    return [...this.queue];
  }
  
  clearQueue(): void {
    this.queue = [];
    this.emit('queue:updated', this.queue);
  }
  
  getConfig(): TTSConfig {
    return {
      apiKey: this.config.apiKey || '',
      voiceId: this.config.voiceId,
      modelId: this.config.modelId,
      stability: this.config.voiceSettings.stability,
      similarityBoost: this.config.voiceSettings.similarityBoost,
      style: this.config.voiceSettings.style,
      useSpeakerBoost: this.config.voiceSettings.useSpeakerBoost,
      outputFormat: this.config.outputFormat as TTSConfig['outputFormat'],
      voiceSettings: {
        speed: 1.0,
        pitch: 1.0,
      },
    };
  }
  
  // ============================================
  // Queue Processing
  // ============================================
  
  private async processQueue(): Promise<void> {
    if (this.isProcessingQueue || this.queue.length === 0) {
      return;
    }
    
    this.isProcessingQueue = true;
    
    while (this.queue.length > 0 && !this.isPaused) {
      const item = this.queue.shift()!;
      item.status = 'speaking';
      this.currentItem = item;
      
      this._status = TTSStatus.SYNTHESIZING;
      this.emit('status', TTSStatus.SYNTHESIZING);
      this.emit('start', { id: item.id, text: item.text });
      
      try {
        if (this.config.streaming) {
          for await (const chunk of this.synthesizeStream(item.text)) {
            if (this.isPaused || !this.currentItem) break;
            
            if (!chunk.isFinal) {
              this.audioChunks.push(chunk.data);
              this.emit('chunk', chunk);
            }
          }
        } else {
          const result = await this.synthesize(item.text);
          if (this.currentItem) {
            this.emit('synthesized', result);
          }
        }
        
        if (this.currentItem) {
          item.status = 'completed';
          this._status = TTSStatus.IDLE;
          this.emit('status', TTSStatus.IDLE);
          this.emit('complete', { id: item.id });
        }
      } catch (error) {
        item.status = 'cancelled';
        this._status = TTSStatus.ERROR;
        this.emit('status', TTSStatus.ERROR);
        this.emit('error', error instanceof Error ? error : new Error(String(error)));
        // Reset to idle after error
        this._status = TTSStatus.IDLE;
      }
      
      this.currentItem = null;
      this.audioChunks = [];
    }
    
    this.isProcessingQueue = false;
  }
  
  // ============================================
  // ElevenLabs API Integration
  // ============================================
  
  private callSynthesisAPI(text: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const requestBody = JSON.stringify({
        text,
        model_id: this.config.modelId,
        voice_settings: {
          stability: this.config.voiceSettings.stability,
          similarity_boost: this.config.voiceSettings.similarityBoost,
          style: this.config.voiceSettings.style,
          use_speaker_boost: this.config.voiceSettings.useSpeakerBoost,
        },
      });
      
      const req = https.request({
        hostname: 'api.elevenlabs.io',
        path: `/v1/text-to-speech/${this.config.voiceId}?output_format=${this.config.outputFormat}`,
        method: 'POST',
        headers: {
          'xi-api-key': this.apiKey!,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(requestBody),
        },
      }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          if (res.statusCode === 200) {
            resolve(Buffer.concat(chunks));
          } else {
            const errorText = Buffer.concat(chunks).toString();
            reject(new Error(`ElevenLabs API error: ${res.statusCode} - ${errorText}`));
          }
        });
      });
      
      req.on('error', reject);
      req.write(requestBody);
      req.end();
    });
  }
  
  private async *callStreamingAPI(text: string): AsyncGenerator<Buffer> {
    const requestBody = JSON.stringify({
      text,
      model_id: this.config.modelId,
      voice_settings: {
        stability: this.config.voiceSettings.stability,
        similarity_boost: this.config.voiceSettings.similarityBoost,
        style: this.config.voiceSettings.style,
        use_speaker_boost: this.config.voiceSettings.useSpeakerBoost,
      },
    });
    
    const response = await new Promise<{ statusCode: number; stream: NodeJS.ReadableStream }>((resolve, reject) => {
      const req = https.request({
        hostname: 'api.elevenlabs.io',
        path: `/v1/text-to-speech/${this.config.voiceId}/stream?output_format=${this.config.outputFormat}&optimize_streaming_latency=${this.config.optimizeStreamingLatency}`,
        method: 'POST',
        headers: {
          'xi-api-key': this.apiKey!,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(requestBody),
        },
      }, (res) => {
        resolve({ statusCode: res.statusCode || 500, stream: res });
      });
      
      req.on('error', reject);
      req.write(requestBody);
      req.end();
    });
    
    if (response.statusCode !== 200) {
      let errorText = '';
      for await (const chunk of response.stream) {
        errorText += chunk.toString();
      }
      throw new Error(`ElevenLabs streaming error: ${response.statusCode} - ${errorText}`);
    }
    
    for await (const chunk of response.stream) {
      yield Buffer.from(chunk);
    }
  }
  
  private estimateDuration(audioBuffer: Buffer): number {
    const format = this.config.outputFormat;
    
    if (format.startsWith('mp3')) {
      // Rough estimate for MP3: bitrate-based
      const bitrate = format.includes('128') ? 128000 : 32000;
      return (audioBuffer.length * 8) / bitrate;
    } else {
      // PCM: exact calculation
      const sampleRate = parseInt(format.split('_')[1]);
      const bytesPerSample = 2; // 16-bit
      return audioBuffer.length / (sampleRate * bytesPerSample);
    }
  }
  
  // ============================================
  // Voice Management
  // ============================================
  
  /**
   * Set the voice to use
   */
  setVoice(voiceIdOrPreset: string): void {
    if (VOICE_PRESETS[voiceIdOrPreset]) {
      this.config.voiceId = VOICE_PRESETS[voiceIdOrPreset].id;
    } else {
      this.config.voiceId = voiceIdOrPreset;
    }
    logger.info('Voice changed', { voiceId: this.config.voiceId });
  }
  
  /**
   * Update voice settings
   */
  setVoiceSettings(settings: Partial<VoiceSettings>): void {
    this.config.voiceSettings = { ...this.config.voiceSettings, ...settings };
    logger.info('Voice settings updated', { settings: this.config.voiceSettings });
  }
  
  /**
   * Get available voices from ElevenLabs
   */
  async getAvailableVoices(): Promise<ElevenLabsVoice[]> {
    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'api.elevenlabs.io',
        path: '/v1/voices',
        method: 'GET',
        headers: {
          'xi-api-key': this.apiKey!,
        },
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              const parsed = JSON.parse(data);
              resolve(parsed.voices || []);
            } catch (e) {
              reject(new Error('Failed to parse voices response'));
            }
          } else {
            reject(new Error(`Failed to get voices: ${res.statusCode}`));
          }
        });
      });
      
      req.on('error', reject);
      req.end();
    });
  }
  
  /**
   * Clone a voice from audio samples
   */
  async cloneVoice(
    name: string,
    description: string,
    audioFiles: Buffer[],
    labels?: Record<string, string>
  ): Promise<string> {
    const boundary = '----AtlasElevenLabsBoundary' + Date.now();
    
    const formParts: Buffer[] = [];
    
    // Name field
    formParts.push(Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="name"\r\n\r\n` +
      `${name}\r\n`
    ));
    
    // Description field
    formParts.push(Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="description"\r\n\r\n` +
      `${description}\r\n`
    ));
    
    // Audio files
    for (let i = 0; i < audioFiles.length; i++) {
      formParts.push(Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="files"; filename="sample_${i}.mp3"\r\n` +
        `Content-Type: audio/mpeg\r\n\r\n`
      ));
      formParts.push(audioFiles[i]);
      formParts.push(Buffer.from('\r\n'));
    }
    
    // Labels
    if (labels) {
      formParts.push(Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="labels"\r\n\r\n` +
        `${JSON.stringify(labels)}\r\n`
      ));
    }
    
    // Closing boundary
    formParts.push(Buffer.from(`--${boundary}--\r\n`));
    
    const body = Buffer.concat(formParts);
    
    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'api.elevenlabs.io',
        path: '/v1/voices/add',
        method: 'POST',
        headers: {
          'xi-api-key': this.apiKey!,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': body.length,
        },
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              const parsed = JSON.parse(data);
              logger.info('Voice cloned successfully', { voiceId: parsed.voice_id });
              resolve(parsed.voice_id);
            } catch (e) {
              reject(new Error('Failed to parse clone response'));
            }
          } else {
            reject(new Error(`Voice cloning failed: ${res.statusCode} - ${data}`));
          }
        });
      });
      
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }
  
  /**
   * Delete a cloned voice
   */
  async deleteVoice(voiceId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'api.elevenlabs.io',
        path: `/v1/voices/${voiceId}`,
        method: 'DELETE',
        headers: {
          'xi-api-key': this.apiKey!,
        },
      }, (res) => {
        if (res.statusCode === 200) {
          logger.info('Voice deleted', { voiceId });
          resolve();
        } else {
          reject(new Error(`Failed to delete voice: ${res.statusCode}`));
        }
        res.resume();
      });
      
      req.on('error', reject);
      req.end();
    });
  }
  
  // ============================================
  // Statistics
  // ============================================
  
  getStats(): ElevenLabsStats {
    return {
      requestCount: this.requestCount,
      charactersProcessed: this.charactersProcessed,
      currentVoice: this.config.voiceId,
      model: this.config.modelId,
    };
  }
}

// ============================================
// Types
// ============================================

interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  category: string;
  labels: Record<string, string>;
  preview_url?: string;
  available_for_tiers?: string[];
}

interface ElevenLabsStats {
  requestCount: number;
  charactersProcessed: number;
  currentVoice: string;
  model: string;
}

// ============================================
// Plugin Registration
// ============================================

/**
 * Plugin manifest for ElevenLabs TTS
 */
export const elevenLabsTTSManifest = {
  name: '@atlas/elevenlabs-tts',
  version: '1.0.0',
  displayName: 'ElevenLabs TTS',
  description: 'High-quality text-to-speech via ElevenLabs API with voice cloning support',
  author: 'Atlas Team',
  license: 'MIT',
  main: 'elevenlabs-tts.ts',
  atlasVersion: '>=0.1.0',
  capabilities: ['network'] as const,
  permission: 'normal' as const,
  categories: ['productivity', 'integrations'] as const,
  configSchema: {
    type: 'object' as const,
    properties: {
      voiceId: {
        type: 'string',
        description: 'ElevenLabs voice ID or preset name',
        default: 'rachel',
      },
      modelId: {
        type: 'string',
        enum: ['eleven_monolingual_v1', 'eleven_multilingual_v1', 'eleven_multilingual_v2', 'eleven_turbo_v2'],
        default: 'eleven_multilingual_v2',
        description: 'TTS model to use',
      },
      stability: {
        type: 'number',
        minimum: 0,
        maximum: 1,
        default: 0.5,
        description: 'Voice stability (0-1)',
      },
      similarityBoost: {
        type: 'number',
        minimum: 0,
        maximum: 1,
        default: 0.75,
        description: 'Voice similarity boost (0-1)',
      },
      streaming: {
        type: 'boolean',
        default: true,
        description: 'Enable streaming audio',
      },
    },
  },
  defaultConfig: {
    voiceId: 'rachel',
    modelId: 'eleven_multilingual_v2',
    stability: 0.5,
    similarityBoost: 0.75,
    streaming: true,
  },
};

// Factory function for creating provider
export function createElevenLabsTTS(config?: Partial<ElevenLabsPluginConfig>): ElevenLabsTTSPlugin {
  return new ElevenLabsTTSPlugin(config);
}
