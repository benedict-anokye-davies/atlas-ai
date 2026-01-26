/**
 * Atlas Desktop - Cartesia TTS Provider
 * Premium TTS with rich prosody control for natural speech
 * 
 * Features:
 * - Superior prosody and emotion control
 * - Word-level timing and emphasis
 * - Streaming synthesis
 * - Voice cloning support
 * - Emotion embeddings
 * 
 * @module tts/cartesia
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import { DynamicVoiceSettings } from '../voice/emotion-to-voice-mapper';
import { SpeechQueueItem, TTSStatus } from '../../shared/types/tts';

const logger = createModuleLogger('CartesiaTTS');

/**
 * Convert raw PCM data to WAV format by adding a 44-byte header.
 * SSE endpoint only returns raw PCM, but browsers can play WAV natively.
 * 
 * @param pcmData - Raw PCM audio buffer (signed 16-bit little-endian)
 * @param sampleRate - Sample rate in Hz (default 24000)
 * @param numChannels - Number of audio channels (default 1 for mono)
 * @returns Buffer with WAV header prepended
 */
function pcmToWav(pcmData: Buffer, sampleRate = 24000, numChannels = 1): Buffer {
  const bytesPerSample = 2; // 16-bit PCM
  const byteRate = sampleRate * numChannels * bytesPerSample;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = pcmData.length;
  const headerSize = 44;
  
  const wavBuffer = Buffer.alloc(headerSize + dataSize);
  
  // RIFF header
  wavBuffer.write('RIFF', 0);
  wavBuffer.writeUInt32LE(36 + dataSize, 4); // File size - 8
  wavBuffer.write('WAVE', 8);
  
  // fmt subchunk
  wavBuffer.write('fmt ', 12);
  wavBuffer.writeUInt32LE(16, 16); // Subchunk1 size (16 for PCM)
  wavBuffer.writeUInt16LE(1, 20); // Audio format (1 = PCM)
  wavBuffer.writeUInt16LE(numChannels, 22);
  wavBuffer.writeUInt32LE(sampleRate, 24);
  wavBuffer.writeUInt32LE(byteRate, 28);
  wavBuffer.writeUInt16LE(blockAlign, 32);
  wavBuffer.writeUInt16LE(bytesPerSample * 8, 34); // Bits per sample
  
  // data subchunk
  wavBuffer.write('data', 36);
  wavBuffer.writeUInt32LE(dataSize, 40);
  
  // Copy PCM data
  pcmData.copy(wavBuffer, headerSize);
  
  return wavBuffer;
}

// Helper to generate unique IDs
function generateId(): string {
  return `cartesia_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

// ============================================================================
// Types
// ============================================================================

export interface CartesiaConfig {
  apiKey: string;
  voiceId?: string;
  modelId?: string;
  baseUrl?: string;
  outputFormat?: CartesiaOutputFormat;
}

export type CartesiaOutputFormat = 
  | 'pcm_16000'
  | 'pcm_22050' 
  | 'pcm_24000'
  | 'pcm_44100'
  | 'mp3'
  | 'wav';

export interface CartesiaVoice {
  id: string;
  name: string;
  description?: string;
  language: string;
  gender?: 'male' | 'female' | 'neutral';
  isCustom?: boolean;
}

export interface CartesiaEmotion {
  /** Emotion type */
  name: string;
  /** Intensity 0-1 */
  level: number;
}

export interface CartesiaProsody {
  /** Speed multiplier (0.5-2.0) */
  speed?: number;
  /** Pitch adjustment in semitones (-12 to 12) */
  pitch?: number;
  /** Volume multiplier (0-2) */
  volume?: number;
  /** Emphasis on specific words */
  emphasis?: Array<{ word: string; level: 'moderate' | 'strong' }>;
}

export interface CartesiaSynthesisOptions {
  /** Voice ID to use */
  voiceId?: string;
  /** Model ID */
  modelId?: string;
  /** Output format */
  outputFormat?: CartesiaOutputFormat;
  /** Emotion settings */
  emotion?: CartesiaEmotion[];
  /** Prosody adjustments */
  prosody?: CartesiaProsody;
  /** Dynamic voice settings from emotion mapper */
  dynamicSettings?: DynamicVoiceSettings;
  /** Enable word timestamps */
  withTimestamps?: boolean;
  /** Stream results */
  stream?: boolean;
}

export interface CartesiaSynthesisResult {
  audio: Buffer;
  format: string;
  sampleRate: number;
  durationMs: number;
  wordTimestamps?: Array<{
    word: string;
    startMs: number;
    endMs: number;
  }>;
}

export interface CartesiaStreamChunk {
  audio: Buffer;
  wordTimestamps?: Array<{
    word: string;
    startMs: number;
    endMs: number;
  }>;
  isFinal: boolean;
}

// ============================================================================
// Cartesia Provider
// ============================================================================

export class CartesiaTTS extends EventEmitter {
  private config: CartesiaConfig;
  private initialized = false;
  private voiceCache: Map<string, CartesiaVoice> = new Map();

  // Speech queue management
  private speechQueue: SpeechQueueItem[] = [];
  private isProcessingQueue = false;
  private isPaused = false;
  private isStopping = false;
  private currentSpeechId: string | null = null;
  private _status: TTSStatus = TTSStatus.IDLE;

  // Default voices
  static readonly DEFAULT_VOICE_ID = 'a0e99841-438c-4a64-b679-ae501e7d6091'; // Barbershop Man
  static readonly DEFAULT_MODEL_ID = 'sonic-english';

  // Emotion mappings for Cartesia's emotion system (what Atlas expresses)
  private static readonly EMOTION_MAPPINGS: Record<string, CartesiaEmotion[]> = {
    neutral: [],
    happy: [{ name: 'positivity', level: 0.6 }, { name: 'enthusiasm', level: 0.4 }],
    sad: [{ name: 'sadness', level: 0.5 }],
    angry: [{ name: 'anger', level: 0.4 }],
    frustrated: [{ name: 'frustration', level: 0.5 }],
    excited: [{ name: 'enthusiasm', level: 0.8 }, { name: 'positivity', level: 0.6 }],
    anxious: [{ name: 'concern', level: 0.5 }],
    confused: [{ name: 'curiosity', level: 0.4 }],
    grateful: [{ name: 'positivity', level: 0.5 }, { name: 'warmth', level: 0.4 }],
    disappointed: [{ name: 'sadness', level: 0.3 }],
  };

  /**
   * User emotion → Atlas response voice mapping
   * How Atlas should sound when responding to a user in a specific emotional state
   */
  private static readonly USER_EMOTION_RESPONSE_MAP: Record<string, {
    emotion: CartesiaEmotion[];
    speed: number;
    pitch: number;
  }> = {
    // User is excited → Atlas matches energy
    excited: {
      emotion: [{ name: 'enthusiasm', level: 0.7 }, { name: 'positivity', level: 0.6 }],
      speed: 1.1,
      pitch: 2,
    },
    // User is frustrated → Atlas stays calm and patient
    frustrated: {
      emotion: [{ name: 'positivity', level: 0.3 }, { name: 'warmth', level: 0.4 }],
      speed: 0.95,
      pitch: -1,
    },
    // User is tired → Atlas is gentle and calm
    tired: {
      emotion: [{ name: 'warmth', level: 0.4 }],
      speed: 0.9,
      pitch: -2,
    },
    // User is anxious → Atlas is reassuring
    anxious: {
      emotion: [{ name: 'warmth', level: 0.5 }, { name: 'positivity', level: 0.3 }],
      speed: 0.9,
      pitch: -1,
    },
    // User is confused → Atlas speaks clearly and slowly
    confused: {
      emotion: [{ name: 'positivity', level: 0.2 }],
      speed: 0.85,
      pitch: 0,
    },
    // User is happy → Atlas is warm and positive
    happy: {
      emotion: [{ name: 'positivity', level: 0.5 }, { name: 'enthusiasm', level: 0.3 }],
      speed: 1.05,
      pitch: 1,
    },
    // User is sad → Atlas is empathetic and warm
    sad: {
      emotion: [{ name: 'warmth', level: 0.5 }],
      speed: 0.9,
      pitch: -2,
    },
    // User is angry → Atlas stays calm
    angry: {
      emotion: [{ name: 'positivity', level: 0.2 }],
      speed: 0.9,
      pitch: -2,
    },
    // Default/neutral
    neutral: {
      emotion: [],
      speed: 1.0,
      pitch: 0,
    },
  };

  constructor(config: CartesiaConfig) {
    super();
    this.config = {
      ...config,
      baseUrl: config.baseUrl || 'https://api.cartesia.ai',
      outputFormat: config.outputFormat || 'mp3', // Use mp3 for browser playback compatibility
      voiceId: config.voiceId || CartesiaTTS.DEFAULT_VOICE_ID,
      modelId: config.modelId || CartesiaTTS.DEFAULT_MODEL_ID,
    };
  }

  /**
   * Initialize the provider
   */
  async initialize(): Promise<void> {
    logger.info('Cartesia initialize() called', { 
      hasApiKey: !!this.config.apiKey,
      apiKeyLength: this.config.apiKey?.length,
      voiceId: this.config.voiceId,
      initialized: this.initialized
    });
    
    if (this.initialized) {
      logger.info('Cartesia already initialized, skipping');
      return;
    }

    if (!this.config.apiKey) {
      throw new Error('Cartesia API key is required');
    }

    // Verify API connectivity
    try {
      logger.info('Cartesia: Verifying API connectivity...');
      await this.listVoices();
      this.initialized = true;
      logger.info('Cartesia TTS initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Cartesia TTS', { error: (error as Error).message });
      throw error;
    }
  }

  /**
   * List available voices
   */
  async listVoices(): Promise<CartesiaVoice[]> {
    const response = await fetch(`${this.config.baseUrl}/voices`, {
      headers: {
        'X-API-Key': this.config.apiKey,
        'Cartesia-Version': '2024-06-10',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to list voices: ${response.statusText}`);
    }

    const data = await response.json() as { voices?: CartesiaVoice[] };
    const voices = data.voices || [];
    
    // Cache voices
    for (const voice of voices) {
      this.voiceCache.set(voice.id, voice);
    }

    return voices;
  }

  /**
   * Synthesize speech
   */
  async synthesize(
    text: string,
    options: CartesiaSynthesisOptions = {}
  ): Promise<CartesiaSynthesisResult> {
    if (!this.initialized) {
      await this.initialize();
    }

    const voiceId = options.voiceId || this.config.voiceId!;
    const modelId = options.modelId || this.config.modelId!;
    const outputFormat = options.outputFormat || this.config.outputFormat!;

    // Build prosody from dynamic settings
    const prosody = this.buildProsody(options);
    
    // Build emotion from dynamic settings or explicit emotion
    const emotion = options.emotion || this.mapDynamicToEmotion(options.dynamicSettings);

    // Build output_format based on requested format
    // For MP3/WAV: need container + bit_rate + sample_rate
    // For PCM: need container: 'raw' + encoding + sample_rate  
    const outputFormatObj: Record<string, unknown> = outputFormat === 'mp3' || outputFormat === 'wav'
      ? {
          container: outputFormat,
          bit_rate: 128000, // 128kbps for good quality
          sample_rate: this.getSampleRate(outputFormat),
        }
      : {
          container: 'raw',
          encoding: 'pcm_s16le',
          sample_rate: this.getSampleRate(outputFormat),
        };

    const requestBody: Record<string, unknown> = {
      model_id: modelId,
      transcript: text,
      voice: {
        mode: 'id',
        id: voiceId,
      },
      output_format: outputFormatObj,
    };

    // Add prosody if specified
    if (prosody && Object.keys(prosody).length > 0) {
      requestBody.prosody = prosody;
    }

    // Add emotion if specified
    if (emotion && emotion.length > 0) {
      requestBody.voice = {
        ...(requestBody.voice as Record<string, unknown>),
        __experimental_controls: {
          emotion,
        },
      };
    }

    // Add timestamps if requested
    if (options.withTimestamps) {
      requestBody.output_format = {
        ...(requestBody.output_format as Record<string, unknown>),
        timestamps: true,
      };
    }

    logger.debug('Synthesizing with Cartesia', { 
      textLength: text.length, 
      voiceId,
      hasProsody: !!prosody,
      hasEmotion: emotion && emotion.length > 0,
    });

    const startTime = Date.now();

    const response = await fetch(`${this.config.baseUrl}/tts/bytes`, {
      method: 'POST',
      headers: {
        'X-API-Key': this.config.apiKey,
        'Cartesia-Version': '2024-06-10',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Cartesia synthesis failed: ${response.statusText} - ${errorText}`);
    }

    const audioBuffer = Buffer.from(await response.arrayBuffer());
    const duration = Date.now() - startTime;

    logger.debug('Cartesia synthesis complete', { 
      bytes: audioBuffer.length, 
      durationMs: duration,
    });

    // Parse timestamps from headers if available
    let wordTimestamps: CartesiaSynthesisResult['wordTimestamps'];
    const timestampHeader = response.headers.get('X-Word-Timestamps');
    if (timestampHeader) {
      try {
        wordTimestamps = JSON.parse(timestampHeader);
      } catch {
        // Ignore parsing errors
      }
    }

    return {
      audio: audioBuffer,
      format: outputFormat,
      sampleRate: this.getSampleRate(outputFormat),
      durationMs: this.estimateDuration(audioBuffer.length, outputFormat),
      wordTimestamps,
    };
  }

  /**
   * Stream synthesis for lower latency
   */
  async *synthesizeStream(
    text: string,
    options: CartesiaSynthesisOptions = {}
  ): AsyncGenerator<CartesiaStreamChunk> {
    if (!this.initialized) {
      await this.initialize();
    }

    const voiceId = options.voiceId || this.config.voiceId!;
    const modelId = options.modelId || this.config.modelId!;
    const outputFormat = options.outputFormat || this.config.outputFormat!;

    const prosody = this.buildProsody(options);
    const emotion = options.emotion || this.mapDynamicToEmotion(options.dynamicSettings);

    // SSE endpoint ONLY supports RAW/PCM format (not MP3/WAV)
    // See: https://docs.cartesia.ai/api-reference/endpoints/stream-speech-server-sent-events
    const outputFormatObj: Record<string, unknown> = {
      container: 'raw',
      encoding: 'pcm_s16le',
      sample_rate: 24000,
    };

    const requestBody: Record<string, unknown> = {
      model_id: modelId,
      transcript: text,
      voice: {
        mode: 'id',
        id: voiceId,
      },
      output_format: outputFormatObj,
      language: 'en', // Required for SSE endpoint
    };

    if (prosody && Object.keys(prosody).length > 0) {
      requestBody.prosody = prosody;
    }

    if (emotion && emotion.length > 0) {
      requestBody.voice = {
        ...(requestBody.voice as Record<string, unknown>),
        __experimental_controls: {
          emotion,
        },
      };
    }

    logger.debug('Cartesia stream request', {
      url: `${this.config.baseUrl}/tts/sse`,
      modelId,
      voiceId,
      outputFormat: outputFormatObj,
      language: 'en',
      textLength: text.length,
    });

    const response = await fetch(`${this.config.baseUrl}/tts/sse`, {
      method: 'POST',
      headers: {
        'X-API-Key': this.config.apiKey,
        'Cartesia-Version': '2024-06-10',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'Failed to read error body');
      logger.error('Cartesia API error', { status: response.status, statusText: response.statusText, errorBody });
      throw new Error(`Cartesia stream failed: ${response.statusText} - ${errorBody}`);
    }

    if (!response.body) {
      throw new Error('No response body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              yield { audio: Buffer.alloc(0), isFinal: true };
              return;
            }

            try {
              const parsed = JSON.parse(data) as { audio?: string; done?: boolean };
              if (parsed.audio) {
                yield {
                  audio: Buffer.from(parsed.audio, 'base64'),
                  isFinal: !!parsed.done,
                };
              }
            } catch {
              // Skip invalid JSON
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Build prosody settings from options
   */
  private buildProsody(options: CartesiaSynthesisOptions): CartesiaProsody | undefined {
    const prosody: CartesiaProsody = {};

    // Apply explicit prosody
    if (options.prosody) {
      Object.assign(prosody, options.prosody);
    }

    // Apply dynamic settings
    if (options.dynamicSettings) {
      const ds = options.dynamicSettings;
      
      // Speed mapping (our 0.8-1.3 → Cartesia's 0.5-2.0)
      if (ds.speed !== undefined) {
        prosody.speed = ds.speed;
      }

      // Pitch mapping (our -0.2 to 0.2 → Cartesia's -12 to 12 semitones)
      if (ds.pitch !== undefined) {
        prosody.pitch = ds.pitch * 60; // Scale to semitones
      }
    }

    return Object.keys(prosody).length > 0 ? prosody : undefined;
  }

  /**
   * Map dynamic voice settings to Cartesia emotions
   * Infers emotion from voice parameters (stability, style, speed)
   */
  private mapDynamicToEmotion(settings?: DynamicVoiceSettings): CartesiaEmotion[] | undefined {
    if (!settings) return undefined;

    // Infer emotional state from voice parameters
    // Low stability + high style = excited/energetic
    // High stability + low style = calm/neutral
    // Low stability + low speed = sad
    // High style + high speed = happy

    const emotions: CartesiaEmotion[] = [];

    // High energy detection (style > 0.3 OR speed > 1.1)
    if (settings.style > 0.3 || settings.speed > 1.1) {
      emotions.push({ name: 'positivity', level: Math.min(1, settings.style + 0.2) });
    }

    // Low stability means more emotional expression
    if (settings.stability < 0.4) {
      // Combined with slow speed = sadness
      if (settings.speed < 0.9) {
        emotions.push({ name: 'sadness', level: 0.4 });
      } else {
        // Combined with normal/fast speed = excitement
        emotions.push({ name: 'surprise', level: 0.3 });
      }
    }

    // Calm/reassuring (high stability, moderate everything)
    if (settings.stability > 0.6 && settings.style < 0.3) {
      emotions.push({ name: 'positivity', level: 0.2 });
    }

    // Return undefined if no significant emotions detected
    return emotions.length > 0 ? emotions : undefined;
  }

  /**
   * Get voice settings adapted for the detected user emotion
   * This makes Atlas respond appropriately to how the user is feeling
   * 
   * @param userEmotion - The detected emotion of the user (e.g., 'frustrated', 'excited')
   * @returns CartesiaSynthesisOptions with appropriate emotion and prosody
   */
  getVoiceSettingsForUserEmotion(userEmotion: string): CartesiaSynthesisOptions {
    const response = CartesiaTTS.USER_EMOTION_RESPONSE_MAP[userEmotion.toLowerCase()] 
      || CartesiaTTS.USER_EMOTION_RESPONSE_MAP.neutral;
    
    return {
      emotion: response.emotion,
      prosody: {
        speed: response.speed,
        pitch: response.pitch,
      },
    };
  }

  /**
   * Synthesize with automatic emotion adaptation based on user's emotional state
   */
  async synthesizeWithUserEmotion(
    text: string,
    userEmotion: string,
    additionalOptions?: CartesiaSynthesisOptions
  ): Promise<CartesiaSynthesisResult> {
    const emotionSettings = this.getVoiceSettingsForUserEmotion(userEmotion);
    
    // Merge emotion settings with any additional options
    const mergedOptions: CartesiaSynthesisOptions = {
      ...emotionSettings,
      ...additionalOptions,
      // Combine emotions if both specified
      emotion: additionalOptions?.emotion 
        ? [...(emotionSettings.emotion || []), ...additionalOptions.emotion]
        : emotionSettings.emotion,
      // Merge prosody (additional overrides emotion-based)
      prosody: {
        ...emotionSettings.prosody,
        ...additionalOptions?.prosody,
      },
    };

    logger.debug('Synthesizing with user emotion adaptation', {
      userEmotion,
      appliedEmotion: mergedOptions.emotion,
      speed: mergedOptions.prosody?.speed,
    });

    return this.synthesize(text, mergedOptions);
  }

  /**
   * Stream synthesis with automatic emotion adaptation
   */
  async *synthesizeStreamWithUserEmotion(
    text: string,
    userEmotion: string,
    additionalOptions?: CartesiaSynthesisOptions
  ): AsyncGenerator<CartesiaStreamChunk> {
    const emotionSettings = this.getVoiceSettingsForUserEmotion(userEmotion);
    
    const mergedOptions: CartesiaSynthesisOptions = {
      ...emotionSettings,
      ...additionalOptions,
      emotion: additionalOptions?.emotion 
        ? [...(emotionSettings.emotion || []), ...additionalOptions.emotion]
        : emotionSettings.emotion,
      prosody: {
        ...emotionSettings.prosody,
        ...additionalOptions?.prosody,
      },
    };

    yield* this.synthesizeStream(text, mergedOptions);
  }

  /**
   * Get sample rate from format
   */
  private getSampleRate(format: CartesiaOutputFormat): number {
    const rates: Record<CartesiaOutputFormat, number> = {
      pcm_16000: 16000,
      pcm_22050: 22050,
      pcm_24000: 24000,
      pcm_44100: 44100,
      mp3: 24000,
      wav: 24000,
    };
    return rates[format] || 24000;
  }

  /**
   * Estimate audio duration from buffer size
   */
  private estimateDuration(bytes: number, format: CartesiaOutputFormat): number {
    const sampleRate = this.getSampleRate(format);
    const bytesPerSample = 2; // 16-bit PCM
    const samples = bytes / bytesPerSample;
    return (samples / sampleRate) * 1000;
  }

  // ==========================================================================
  // Speech Queue Management (Required by TTSManager)
  // ==========================================================================

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
   * Get current TTS status
   */
  get status(): TTSStatus {
    return this._status;
  }

  /**
   * Speak text (synthesize and emit for playback)
   * Adds to speech queue with priority
   */
  async speak(text: string, priority = 0): Promise<void> {
    // Don't queue new speech while stopping
    if (this.isStopping) {
      logger.debug('Ignoring speak request - currently stopping');
      return;
    }

    const item: SpeechQueueItem = {
      id: generateId(),
      text,
      priority,
      queuedAt: Date.now(),
      status: 'pending',
    };

    // Insert based on priority (higher priority first)
    const insertIndex = this.speechQueue.findIndex((q) => q.priority < priority);
    if (insertIndex === -1) {
      this.speechQueue.push(item);
    } else {
      this.speechQueue.splice(insertIndex, 0, item);
    }

    logger.debug('Added to speech queue', {
      id: item.id,
      priority,
      queueLength: this.speechQueue.length,
    });

    this.emit('queueUpdate', [...this.speechQueue]);

    // Start processing queue if not already
    if (!this.isProcessingQueue && !this.isStopping) {
      await this.processQueue();
    }
  }

  /**
   * Process the speech queue
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessingQueue || this.isPaused || this.isStopping) {
      return;
    }

    this.isProcessingQueue = true;

    while (this.speechQueue.length > 0 && !this.isPaused && !this.isStopping) {
      const item = this.speechQueue[0];

      if (item.status === 'cancelled') {
        this.speechQueue.shift();
        continue;
      }

      item.status = 'speaking';
      this.currentSpeechId = item.id;
      this.emit('queueUpdate', [...this.speechQueue]);

      try {
        this.setStatus(TTSStatus.PLAYING);
        this.emit('playbackStart');

        // Collect all audio chunks for this speech item
        // SSE endpoint returns RAW PCM (pcm_s16le @ 24kHz), we convert to WAV for browser playback
        const chunks: Buffer[] = [];
        let wasCancelled = false;
        let chunkIndex = 0;

        for await (const chunk of this.synthesizeStream(item.text)) {
          // Check if cancelled
          if ((item.status as string) === 'cancelled') {
            wasCancelled = true;
            break;
          }
          
          if (chunk.audio && chunk.audio.length > 0) {
            chunks.push(chunk.audio);
            chunkIndex++;
            
            // Convert PCM chunk to WAV for browser playback
            // SSE only supports RAW PCM, but browsers need WAV/MP3
            const wavChunk = pcmToWav(chunk.audio, 24000, 1);
            
            // Emit chunk for real-time playback with TTSAudioChunk format
            logger.debug('[CartesiaTTS] Emitting chunk event', {
              pcmLength: chunk.audio.length,
              wavLength: wavChunk.length,
              format: 'wav',
              chunkIndex,
            });
            this.emit('chunk', {
              data: wavChunk,
              format: 'wav',
              isFinal: false,
              duration: undefined,
            });
          }
        }

        if (!wasCancelled) {
          item.status = 'completed';
          // Emit final chunk marker
          if (chunks.length > 0) {
            const completePcm = Buffer.concat(chunks);
            const completeWav = pcmToWav(completePcm, 24000, 1);
            
            this.emit('chunk', {
              data: Buffer.alloc(0),
              format: 'wav',
              isFinal: true,
              duration: undefined,
            });
            this.emit('audio', completeWav);
            // Also emit synthesized for TTS manager
            this.emit('synthesized', {
              audio: completeWav,
              format: 'wav',
              duration: 0,
              characterCount: item.text.length,
            });
          }
        }

        this.emit('playbackEnd');
      } catch (error) {
        logger.error('Speech synthesis error', { error: (error as Error).message });
        item.status = 'error';
        this.emit('error', error);
      }

      // Remove processed item
      this.speechQueue.shift();
      this.emit('queueUpdate', [...this.speechQueue]);
    }

    this.currentSpeechId = null;
    this.isProcessingQueue = false;
    this.setStatus(TTSStatus.IDLE);
  }

  /**
   * Stop all speech immediately
   */
  async stop(): Promise<void> {
    logger.debug('Stopping speech');
    this.isStopping = true;

    // Cancel all queued items
    for (const item of this.speechQueue) {
      item.status = 'cancelled';
    }
    
    this.speechQueue = [];
    this.currentSpeechId = null;
    this.isProcessingQueue = false;
    
    this.emit('queueUpdate', []);
    this.emit('interrupted');
    this.setStatus(TTSStatus.IDLE);
    
    this.isStopping = false;
    logger.debug('Speech stopped');
  }

  /**
   * Pause speech playback
   */
  pause(): void {
    if (!this.isPaused) {
      this.isPaused = true;
      this.setStatus(TTSStatus.IDLE);
      logger.debug('Speech paused');
    }
  }

  /**
   * Resume speech playback
   */
  async resume(): Promise<void> {
    if (this.isPaused) {
      this.isPaused = false;
      logger.debug('Speech resumed');
      
      // Resume queue processing
      if (this.speechQueue.length > 0 && !this.isProcessingQueue) {
        await this.processQueue();
      }
    }
  }

  /**
   * Check if currently speaking.
   * Returns true if there's an active speech item or the queue is being processed.
   */
  isSpeaking(): boolean {
    return this.isProcessingQueue || 
           this._status === TTSStatus.SPEAKING || 
           this.speechQueue.some(item => item.status === 'speaking');
  }

  /**
   * Get current speech queue
   */
  getQueue(): SpeechQueueItem[] {
    return [...this.speechQueue];
  }

  /**
   * Clear the speech queue (keeps current speech playing)
   */
  clearQueue(): void {
    // Cancel all pending items
    for (const item of this.speechQueue) {
      if (item.status === 'pending') {
        item.status = 'cancelled';
      }
    }
    
    // Keep only the currently speaking item
    this.speechQueue = this.speechQueue.filter(
      (item) => item.status === 'speaking'
    );
    
    this.emit('queueUpdate', [...this.speechQueue]);
    logger.debug('Queue cleared');
  }

  // ==========================================================================
  // Status Methods
  // ==========================================================================

  /**
   * Get status
   */
  getProviderStatus(): { initialized: boolean; voiceId: string; modelId: string } {
    return {
      initialized: this.initialized,
      voiceId: this.config.voiceId || CartesiaTTS.DEFAULT_VOICE_ID,
      modelId: this.config.modelId || CartesiaTTS.DEFAULT_MODEL_ID,
    };
  }

  /**
   * Shutdown
   */
  async shutdown(): Promise<void> {
    this.voiceCache.clear();
    this.initialized = false;
    logger.info('Cartesia TTS shut down');
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

let instance: CartesiaTTS | null = null;

export function getCartesiaTTS(config?: CartesiaConfig): CartesiaTTS {
  if (!instance && config) {
    instance = new CartesiaTTS(config);
  }
  if (!instance) {
    throw new Error('CartesiaTTS not initialized. Provide config on first call.');
  }
  return instance;
}

export async function initializeCartesiaTTS(config: CartesiaConfig): Promise<CartesiaTTS> {
  instance = new CartesiaTTS(config);
  await instance.initialize();
  return instance;
}
