/**
 * Cartesia Sonic 3 Integration
 * 
 * Ultra-low latency TTS using State Space Models (SSM/Mamba):
 * - Sub-90ms streaming latency
 * - 42 languages
 * - Native emotion control
 * - 81% preferred over PlayHT in human evaluations
 * 
 * Architecture Innovation:
 * State Space Models provide O(1) memory per token (vs O(n) for transformers)
 * enabling extremely efficient streaming without attention recomputation.
 */

import { EventEmitter } from 'events';

// =============================================================================
// TYPES
// =============================================================================

export interface CartesiaConfig {
  apiKey: string;
  apiVersion: string;
  /** Base URL for API */
  baseUrl: string;
  /** Default model */
  model: 'sonic-3' | 'sonic-2' | 'sonic-1';
  /** Default voice ID */
  defaultVoiceId: string;
  /** Audio output format */
  outputFormat: CartesiaOutputFormat;
  /** Enable emotion control */
  emotionControl: boolean;
}

export interface CartesiaOutputFormat {
  container: 'raw' | 'mp3' | 'wav';
  encoding: 'pcm_f32le' | 'pcm_s16le' | 'mp3';
  sampleRate: 8000 | 16000 | 22050 | 24000 | 44100;
}

export interface CartesiaVoice {
  id: string;
  name: string;
  description: string;
  language: string;
  gender: 'male' | 'female' | 'neutral';
  age: 'child' | 'young' | 'adult' | 'senior';
  style: string[];
}

export interface CartesiaEmotion {
  name: CartesiaEmotionName;
  level: 'lowest' | 'low' | 'moderate' | 'high' | 'highest';
}

export type CartesiaEmotionName =
  | 'anger' | 'positivity' | 'surprise' | 'sadness' | 'curiosity';

export interface CartesiaSynthesisOptions {
  voiceId?: string;
  emotions?: CartesiaEmotion[];
  speed?: number; // 0.5 - 2.0
  language?: string;
}

export interface CartesiaSynthesisResult {
  audio: Float32Array;
  durationMs: number;
  latencyMs: number;
}

// =============================================================================
// CARTESIA ENGINE
// =============================================================================

export class CartesiaSonicEngine extends EventEmitter {
  private config: CartesiaConfig;
  private voices = new Map<string, CartesiaVoice>();
  private ws: WebSocket | null = null;

  constructor(config: Partial<CartesiaConfig> = {}) {
    super();
    this.config = {
      apiKey: process.env.CARTESIA_API_KEY || '',
      apiVersion: '2025-01-01',
      baseUrl: 'https://api.cartesia.ai',
      model: 'sonic-3',
      defaultVoiceId: '',
      outputFormat: {
        container: 'raw',
        encoding: 'pcm_f32le',
        sampleRate: 24000,
      },
      emotionControl: true,
      ...config,
    };
  }

  /**
   * Initialize and fetch available voices
   */
  async initialize(): Promise<void> {
    this.emit('status', 'Initializing Cartesia Sonic 3...');

    if (!this.config.apiKey) {
      this.emit('warning', 'No API key provided. Some features may be limited.');
    }

    await this.loadVoices();
    this.emit('ready');
  }

  /**
   * Load available voices
   */
  async loadVoices(): Promise<CartesiaVoice[]> {
    if (!this.config.apiKey) return [];

    try {
      const response = await fetch(`${this.config.baseUrl}/voices`, {
        headers: {
          'X-API-Key': this.config.apiKey,
          'Cartesia-Version': this.config.apiVersion,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to load voices: ${response.statusText}`);
      }

      const voices: CartesiaVoice[] = await response.json();
      for (const voice of voices) {
        this.voices.set(voice.id, voice);
      }

      return voices;
    } catch (error) {
      this.emit('error', error);
      return [];
    }
  }

  /**
   * Get voices by language
   */
  getVoicesByLanguage(language: string): CartesiaVoice[] {
    return Array.from(this.voices.values()).filter(v =>
      v.language.toLowerCase().includes(language.toLowerCase())
    );
  }

  /**
   * Synthesize with sub-90ms streaming latency
   * Uses SSM architecture for efficient generation
   */
  async synthesize(
    text: string,
    options: CartesiaSynthesisOptions = {}
  ): Promise<CartesiaSynthesisResult> {
    const startTime = performance.now();

    const body: Record<string, unknown> = {
      model_id: this.config.model,
      transcript: text,
      voice: {
        mode: 'id',
        id: options.voiceId || this.config.defaultVoiceId,
      },
      output_format: this.config.outputFormat,
    };

    // Add emotions if specified
    if (options.emotions && this.config.emotionControl) {
      body.voice = {
        ...body.voice as object,
        __experimental_controls: {
          emotion: options.emotions,
        },
      };
    }

    // Add speed if specified
    if (options.speed) {
      body.voice = {
        ...body.voice as object,
        __experimental_controls: {
          ...(body.voice as Record<string, unknown>).__experimental_controls as object || {},
          speed: options.speed < 1 ? 'slowest' : options.speed > 1 ? 'fastest' : 'normal',
        },
      };
    }

    // Add language override
    if (options.language) {
      body.language = options.language;
    }

    const response = await fetch(`${this.config.baseUrl}/tts/bytes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.config.apiKey,
        'Cartesia-Version': this.config.apiVersion,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Synthesis failed: ${error}`);
    }

    const buffer = await response.arrayBuffer();
    const audio = this.decodeAudio(buffer);
    const latency = performance.now() - startTime;

    return {
      audio,
      durationMs: (audio.length / this.config.outputFormat.sampleRate) * 1000,
      latencyMs: latency,
    };
  }

  /**
   * Stream synthesis for ultra-low latency
   * Target: <90ms time to first byte
   */
  async *synthesizeStream(
    text: string,
    options: CartesiaSynthesisOptions = {}
  ): AsyncGenerator<Float32Array> {
    const startTime = performance.now();
    let firstChunkTime = 0;

    const body: Record<string, unknown> = {
      model_id: this.config.model,
      transcript: text,
      voice: {
        mode: 'id',
        id: options.voiceId || this.config.defaultVoiceId,
      },
      output_format: this.config.outputFormat,
    };

    if (options.emotions && this.config.emotionControl) {
      body.voice = {
        ...body.voice as object,
        __experimental_controls: {
          emotion: options.emotions,
        },
      };
    }

    const response = await fetch(`${this.config.baseUrl}/tts/bytes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.config.apiKey,
        'Cartesia-Version': this.config.apiVersion,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok || !response.body) {
      throw new Error(`Streaming synthesis failed: ${response.statusText}`);
    }

    const reader = response.body.getReader();
    const chunkSize = this.config.outputFormat.sampleRate * 0.05; // 50ms chunks

    let buffer = new Uint8Array(0);

    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      if (firstChunkTime === 0) {
        firstChunkTime = performance.now();
        this.emit('first-byte', {
          latencyMs: firstChunkTime - startTime,
        });
      }

      // Append to buffer
      const newBuffer = new Uint8Array(buffer.length + value.length);
      newBuffer.set(buffer);
      newBuffer.set(value, buffer.length);
      buffer = newBuffer;

      // Yield complete chunks
      const bytesPerSample = this.config.outputFormat.encoding === 'pcm_f32le' ? 4 : 2;
      const chunkBytes = chunkSize * bytesPerSample;

      while (buffer.length >= chunkBytes) {
        const chunk = buffer.slice(0, chunkBytes);
        buffer = buffer.slice(chunkBytes);
        yield this.decodeAudioChunk(chunk);
      }
    }

    // Yield remaining
    if (buffer.length > 0) {
      yield this.decodeAudioChunk(buffer);
    }
  }

  /**
   * WebSocket streaming for lowest latency
   */
  async connectWebSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`wss://api.cartesia.ai/tts/websocket?api_key=${this.config.apiKey}&cartesia_version=${this.config.apiVersion}`);

      this.ws.onopen = () => {
        this.emit('ws-connected');
        resolve();
      };

      this.ws.onerror = (error) => {
        this.emit('error', error);
        reject(error);
      };

      this.ws.onmessage = (event) => {
        this.handleWebSocketMessage(event);
      };

      this.ws.onclose = () => {
        this.emit('ws-disconnected');
      };
    });
  }

  private handleWebSocketMessage(event: MessageEvent): void {
    if (event.data instanceof ArrayBuffer || event.data instanceof Blob) {
      // Audio data
      if (event.data instanceof Blob) {
        event.data.arrayBuffer().then((buffer) => {
          const audio = this.decodeAudio(buffer);
          this.emit('audio', audio);
        });
      } else {
        const audio = this.decodeAudio(event.data);
        this.emit('audio', audio);
      }
    } else {
      // JSON message
      try {
        const message = JSON.parse(event.data);
        this.emit('message', message);
      } catch {
        // Ignore parse errors
      }
    }
  }

  /**
   * Send text via WebSocket for streaming synthesis
   */
  sendText(text: string, voiceId?: string, isFinal = false): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }

    this.ws.send(JSON.stringify({
      model_id: this.config.model,
      transcript: text,
      voice: {
        mode: 'id',
        id: voiceId || this.config.defaultVoiceId,
      },
      output_format: this.config.outputFormat,
      context_id: 'stream',
      continue: !isFinal,
    }));
  }

  private decodeAudio(buffer: ArrayBuffer): Float32Array {
    if (this.config.outputFormat.encoding === 'pcm_f32le') {
      return new Float32Array(buffer);
    } else if (this.config.outputFormat.encoding === 'pcm_s16le') {
      const int16 = new Int16Array(buffer);
      const float32 = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) {
        float32[i] = int16[i] / 32768;
      }
      return float32;
    }
    return new Float32Array(buffer);
  }

  private decodeAudioChunk(chunk: Uint8Array): Float32Array {
    // Create a copy of the buffer slice to ensure it's an ArrayBuffer
    const bufferSlice = chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.length);
    return this.decodeAudio(bufferSlice as ArrayBuffer);
  }

  /**
   * Disconnect WebSocket
   */
  disconnectWebSocket(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  async dispose(): Promise<void> {
    this.disconnectWebSocket();
    this.voices.clear();
  }
}

// =============================================================================
// SUPPORTED LANGUAGES (42 languages)
// =============================================================================

export const CARTESIA_LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'it', name: 'Italian' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'pl', name: 'Polish' },
  { code: 'tr', name: 'Turkish' },
  { code: 'ru', name: 'Russian' },
  { code: 'nl', name: 'Dutch' },
  { code: 'cs', name: 'Czech' },
  { code: 'ar', name: 'Arabic' },
  { code: 'zh', name: 'Chinese' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'hu', name: 'Hungarian' },
  { code: 'hi', name: 'Hindi' },
  { code: 'sv', name: 'Swedish' },
  { code: 'da', name: 'Danish' },
  { code: 'fi', name: 'Finnish' },
  { code: 'no', name: 'Norwegian' },
  { code: 'el', name: 'Greek' },
  { code: 'he', name: 'Hebrew' },
  { code: 'id', name: 'Indonesian' },
  { code: 'ms', name: 'Malay' },
  { code: 'ro', name: 'Romanian' },
  { code: 'sk', name: 'Slovak' },
  { code: 'uk', name: 'Ukrainian' },
  { code: 'bg', name: 'Bulgarian' },
  { code: 'hr', name: 'Croatian' },
  { code: 'lt', name: 'Lithuanian' },
  { code: 'lv', name: 'Latvian' },
  { code: 'et', name: 'Estonian' },
  { code: 'sl', name: 'Slovenian' },
  { code: 'sr', name: 'Serbian' },
  { code: 'th', name: 'Thai' },
  { code: 'vi', name: 'Vietnamese' },
  { code: 'tl', name: 'Filipino' },
  { code: 'ta', name: 'Tamil' },
  { code: 'bn', name: 'Bengali' },
  { code: 'ur', name: 'Urdu' },
  { code: 'fa', name: 'Persian' },
];

// =============================================================================
// COMPARISON: CARTESIA vs ELEVENLABS
// =============================================================================

export const CARTESIA_VS_ELEVENLABS = {
  cartesia: {
    name: 'Cartesia Sonic 3',
    latency: '<90ms streaming (SSM architecture)',
    architecture: 'State Space Models (Mamba)',
    languages: '42',
    emotionControl: 'Fine-grained (anger, positivity, surprise, sadness, curiosity)',
    voiceCloning: '3 seconds of audio',
    quality: '81% preferred over PlayHT',
    pricing: 'Pay per character (~$0.10-0.15/1K)',
    deployment: 'Cloud API + WebSocket',
    keyAdvantage: 'Lowest latency in the industry via SSM architecture',
  },
  elevenLabs: {
    name: 'ElevenLabs',
    latency: '300-500ms',
    architecture: 'Transformer-based',
    languages: '29',
    emotionControl: 'Style presets',
    voiceCloning: '30 seconds of audio',
    quality: 'Best-in-class',
    pricing: '$0.30/1K chars',
    deployment: 'Cloud API + WebSocket',
    keyAdvantage: 'Largest library, most natural prosody',
  },
  advantages: {
    cartesia: [
      '3-6x lower latency',
      'More languages (42 vs 29)',
      '10x less audio for cloning (3s vs 30s)',
      'More granular emotion control',
      '2-3x cheaper',
      'SSM architecture (future-proof)',
    ],
    elevenLabs: [
      'More voices (1200+)',
      'Slightly better quality (subjective)',
      'Better tooling (Voice Design)',
      'More ecosystem features (dubbing, SFX)',
      'Larger community',
      'Proven enterprise reliability',
    ],
  },
};
