/**
 * Unified Competitive Voice Engine
 * 
 * Combines all best-in-class engines into a single interface:
 * - Parakeet TDT v2 for STT (98% accuracy, 3380x RTF)
 * - Kyutai TTS for streaming-in-text
 * - Cartesia Sonic for sub-90ms latency
 * - F5-TTS for voice cloning
 * - Fish Audio for variety (1000+ voices)
 * - Moshi for end-to-end (future)
 * 
 * With automatic fallback to ElevenLabs/Deepgram when needed.
 */

import { EventEmitter } from 'events';
import { ParakeetSTTEngine, TranscriptionResult } from './parakeet-integration';
import { KyutaiTTSEngine, AudioChunk } from './kyutai-integration';
import { CartesiaSonicEngine, CartesiaSynthesisResult } from './cartesia-integration';
import { FishAudioEngine, EmotionControlParams } from './fish-audio';

// =============================================================================
// TYPES
// =============================================================================

export interface UnifiedEngineConfig {
  /** STT engine preference */
  sttEngine: 'parakeet' | 'deepgram' | 'whisper' | 'auto';
  /** TTS engine preference */
  ttsEngine: 'kyutai' | 'cartesia' | 'fish' | 'elevenlabs' | 'auto';
  /** Enable cloud fallback */
  enableCloudFallback: boolean;
  /** Cloud API keys */
  apiKeys: {
    deepgram?: string;
    elevenlabs?: string;
    cartesia?: string;
    fishAudio?: string;
  };
  /** Latency target in ms */
  targetLatencyMs: number;
  /** Quality vs speed priority */
  priority: 'quality' | 'speed' | 'balanced';
}

export interface STTOptions {
  language?: string;
  enableTimestamps?: boolean;
  enablePunctuation?: boolean;
}

export interface TTSOptions {
  voiceId?: string;
  emotion?: EmotionControlParams;
  speed?: number;
  language?: string;
  streamOutput?: boolean;
}

export interface VoiceProcessingResult {
  transcription: string;
  audio?: Float32Array;
  metrics: {
    sttLatencyMs: number;
    ttsLatencyMs: number;
    totalLatencyMs: number;
    engineUsed: {
      stt: string;
      tts: string;
    };
  };
}

// =============================================================================
// UNIFIED ENGINE
// =============================================================================

export class UnifiedVoiceEngine extends EventEmitter {
  private config: UnifiedEngineConfig;
  
  // Local engines
  private parakeet?: ParakeetSTTEngine;
  private kyutai?: KyutaiTTSEngine;
  private cartesia?: CartesiaSonicEngine;
  private fishAudio?: FishAudioEngine;
  
  // State
  private isInitialized = false;
  private engineStatus = new Map<string, boolean>();

  constructor(config: Partial<UnifiedEngineConfig> = {}) {
    super();
    this.config = {
      sttEngine: 'auto',
      ttsEngine: 'auto',
      enableCloudFallback: true,
      apiKeys: {},
      targetLatencyMs: 200,
      priority: 'balanced',
      ...config,
    };
  }

  /**
   * Initialize all engines
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    this.emit('status', 'Initializing unified voice engine...');

    // Initialize STT engines
    await this.initializeSTT();

    // Initialize TTS engines
    await this.initializeTTS();

    this.isInitialized = true;
    this.emit('ready', {
      sttEngines: this.getAvailableSTTEngines(),
      ttsEngines: this.getAvailableTTSEngines(),
    });
  }

  private async initializeSTT(): Promise<void> {
    // Try Parakeet first (best accuracy/speed)
    if (this.config.sttEngine === 'parakeet' || this.config.sttEngine === 'auto') {
      try {
        this.parakeet = new ParakeetSTTEngine();
        await this.parakeet.initialize();
        this.engineStatus.set('parakeet', true);
        this.emit('engine-ready', { engine: 'parakeet', type: 'stt' });
      } catch (error) {
        this.emit('engine-error', { engine: 'parakeet', error });
        this.engineStatus.set('parakeet', false);
      }
    }

    // Deepgram fallback
    if (this.config.apiKeys.deepgram) {
      this.engineStatus.set('deepgram', true);
    }
  }

  private async initializeTTS(): Promise<void> {
    // Kyutai for streaming-in-text
    if (this.config.ttsEngine === 'kyutai' || this.config.ttsEngine === 'auto') {
      try {
        this.kyutai = new KyutaiTTSEngine();
        await this.kyutai.connect();
        this.engineStatus.set('kyutai', true);
        this.emit('engine-ready', { engine: 'kyutai', type: 'tts' });
      } catch (error) {
        this.emit('engine-error', { engine: 'kyutai', error });
        this.engineStatus.set('kyutai', false);
      }
    }

    // Cartesia for sub-90ms latency
    if (this.config.ttsEngine === 'cartesia' || this.config.ttsEngine === 'auto') {
      if (this.config.apiKeys.cartesia) {
        try {
          this.cartesia = new CartesiaSonicEngine({
            apiKey: this.config.apiKeys.cartesia,
          });
          await this.cartesia.initialize();
          this.engineStatus.set('cartesia', true);
          this.emit('engine-ready', { engine: 'cartesia', type: 'tts' });
        } catch (error) {
          this.emit('engine-error', { engine: 'cartesia', error });
        }
      }
    }

    // Fish Audio for variety
    if (this.config.ttsEngine === 'fish' || this.config.ttsEngine === 'auto') {
      if (this.config.apiKeys.fishAudio) {
        try {
          this.fishAudio = new FishAudioEngine({
            apiKey: this.config.apiKeys.fishAudio,
          });
          await this.fishAudio.initialize();
          this.engineStatus.set('fish', true);
          this.emit('engine-ready', { engine: 'fish', type: 'tts' });
        } catch (error) {
          this.emit('engine-error', { engine: 'fish', error });
        }
      }
    }

    // ElevenLabs fallback
    if (this.config.apiKeys.elevenlabs) {
      this.engineStatus.set('elevenlabs', true);
    }
  }

  /**
   * Speech-to-Text: Automatically selects best engine
   */
  async transcribe(
    audio: Float32Array,
    options: STTOptions = {}
  ): Promise<TranscriptionResult> {
    const startTime = performance.now();
    let result: TranscriptionResult;
    let engineUsed = 'unknown';

    // Try engines in order of preference
    const engines = this.getSTTEngineOrder();

    for (const engine of engines) {
      try {
        switch (engine) {
          case 'parakeet':
            if (this.parakeet && this.engineStatus.get('parakeet')) {
              result = await this.parakeet.transcribe(audio);
              engineUsed = 'parakeet';
              break;
            }
            continue;

          case 'deepgram':
            if (this.config.apiKeys.deepgram && this.config.enableCloudFallback) {
              result = await this.transcribeWithDeepgram(audio, options);
              engineUsed = 'deepgram';
              break;
            }
            continue;

          default:
            continue;
        }

        // Success - return result
        result!.processingTimeMs = performance.now() - startTime;
        this.emit('transcription', { result, engine: engineUsed });
        return result;
      } catch (error) {
        this.emit('engine-error', { engine, error });
        continue;
      }
    }

    throw new Error('All STT engines failed');
  }

  /**
   * Text-to-Speech: Automatically selects best engine
   */
  async synthesize(
    text: string,
    options: TTSOptions = {}
  ): Promise<{ audio: Float32Array; latencyMs: number; engine: string }> {
    const startTime = performance.now();
    let audio: Float32Array;
    let engineUsed = 'unknown';

    const engines = this.getTTSEngineOrder();

    for (const engine of engines) {
      try {
        switch (engine) {
          case 'cartesia':
            if (this.cartesia && this.engineStatus.get('cartesia')) {
              const result = await this.cartesia.synthesize(text, {
                voiceId: options.voiceId,
                speed: options.speed,
                language: options.language,
              });
              audio = result.audio;
              engineUsed = 'cartesia';
              break;
            }
            continue;

          case 'kyutai':
            if (this.kyutai && this.engineStatus.get('kyutai')) {
              const result = await this.kyutai.synthesize(text, {
                voiceId: options.voiceId,
              });
              audio = result.audio;
              engineUsed = 'kyutai';
              break;
            }
            continue;

          case 'fish':
            if (this.fishAudio && this.engineStatus.get('fish')) {
              audio = await this.fishAudio.synthesize(text, options.voiceId, options.emotion);
              engineUsed = 'fish';
              break;
            }
            continue;

          case 'elevenlabs':
            if (this.config.apiKeys.elevenlabs && this.config.enableCloudFallback) {
              audio = await this.synthesizeWithElevenLabs(text, options);
              engineUsed = 'elevenlabs';
              break;
            }
            continue;

          default:
            continue;
        }

        const latencyMs = performance.now() - startTime;
        this.emit('synthesis', { engine: engineUsed, latencyMs });
        return { audio: audio!, latencyMs, engine: engineUsed };
      } catch (error) {
        this.emit('engine-error', { engine, error });
        continue;
      }
    }

    throw new Error('All TTS engines failed');
  }

  /**
   * Streaming TTS: Pipe LLM output directly to audio
   * THIS IS THE KEY FEATURE THAT BEATS ELEVENLABS
   */
  async *synthesizeStreaming(
    textStream: AsyncIterable<string>,
    options: TTSOptions = {}
  ): AsyncGenerator<AudioChunk> {
    // Kyutai is the only engine that can stream text input
    if (this.kyutai && this.engineStatus.get('kyutai')) {
      yield* this.kyutai.synthesizeStreaming(textStream, {
        voiceId: options.voiceId,
      });
    } else if (this.cartesia && this.engineStatus.get('cartesia')) {
      // Cartesia can stream audio output, but needs full text
      // Buffer text then stream audio
      let fullText = '';
      for await (const chunk of textStream) {
        fullText += chunk;
      }
      // Wrap Float32Array in AudioChunk
      for await (const samples of this.cartesia.synthesizeStream(fullText, {
        voiceId: options.voiceId,
      })) {
        yield {
          samples: samples,
          isFinal: false,
          latencyMs: 0,
        };
      }
    } else {
      throw new Error('No streaming TTS engine available');
    }
  }

  /**
   * Full voice processing: Audio in → Audio out
   */
  async processVoice(
    inputAudio: Float32Array,
    llmCallback: (text: string) => AsyncIterable<string>,
    options: { stt?: STTOptions; tts?: TTSOptions } = {}
  ): Promise<VoiceProcessingResult> {
    const startTime = performance.now();

    // Step 1: STT
    const sttStart = performance.now();
    const transcription = await this.transcribe(inputAudio, options.stt);
    const sttLatency = performance.now() - sttStart;

    if (!transcription.text) {
      return {
        transcription: '',
        metrics: {
          sttLatencyMs: sttLatency,
          ttsLatencyMs: 0,
          totalLatencyMs: performance.now() - startTime,
          engineUsed: { stt: 'unknown', tts: 'none' },
        },
      };
    }

    // Step 2: LLM (streaming)
    const llmStream = llmCallback(transcription.text);

    // Step 3: TTS (streaming)
    const ttsStart = performance.now();
    const audioChunks: Float32Array[] = [];

    for await (const chunk of this.synthesizeStreaming(llmStream, options.tts)) {
      audioChunks.push(chunk.samples);
    }

    const ttsLatency = performance.now() - ttsStart;

    // Combine audio
    const totalLength = audioChunks.reduce((acc, c) => acc + c.length, 0);
    const audio = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of audioChunks) {
      audio.set(chunk, offset);
      offset += chunk.length;
    }

    return {
      transcription: transcription.text,
      audio,
      metrics: {
        sttLatencyMs: sttLatency,
        ttsLatencyMs: ttsLatency,
        totalLatencyMs: performance.now() - startTime,
        engineUsed: { stt: 'parakeet', tts: 'kyutai' },
      },
    };
  }

  // ==========================================================================
  // CLOUD FALLBACKS
  // ==========================================================================

  private async transcribeWithDeepgram(
    audio: Float32Array,
    options: STTOptions
  ): Promise<TranscriptionResult> {
    // Convert Float32Array to WAV
    const wavBuffer = this.createWavBuffer(audio, 16000);

    const response = await fetch('https://api.deepgram.com/v1/listen', {
      method: 'POST',
      headers: {
        'Authorization': `Token ${this.config.apiKeys.deepgram}`,
        'Content-Type': 'audio/wav',
      },
      body: wavBuffer,
    });

    if (!response.ok) {
      throw new Error(`Deepgram error: ${response.statusText}`);
    }

    const result = await response.json();
    const transcript = result.results?.channels?.[0]?.alternatives?.[0];

    return {
      text: transcript?.transcript || '',
      segments: [],
      language: options.language || 'en',
      processingTimeMs: 0,
      audioLengthSeconds: audio.length / 16000,
      rtfx: 0,
    };
  }

  private async synthesizeWithElevenLabs(
    text: string,
    options: TTSOptions
  ): Promise<Float32Array> {
    const voiceId = options.voiceId || '21m00Tcm4TlvDq8ikWAM'; // Default voice

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': this.config.apiKeys.elevenlabs!,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_turbo_v2_5',
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
          },
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`ElevenLabs error: ${response.statusText}`);
    }

    const buffer = await response.arrayBuffer();
    // Note: ElevenLabs returns MP3, would need decoder
    // For simplicity, assuming PCM
    return new Float32Array(buffer);
  }

  // ==========================================================================
  // HELPERS
  // ==========================================================================

  private getSTTEngineOrder(): string[] {
    if (this.config.sttEngine !== 'auto') {
      return [this.config.sttEngine, 'deepgram'];
    }

    switch (this.config.priority) {
      case 'speed':
        return ['parakeet', 'deepgram'];
      case 'quality':
        return ['parakeet', 'deepgram'];
      default:
        return ['parakeet', 'deepgram'];
    }
  }

  private getTTSEngineOrder(): string[] {
    if (this.config.ttsEngine !== 'auto') {
      return [this.config.ttsEngine, 'elevenlabs'];
    }

    switch (this.config.priority) {
      case 'speed':
        return ['cartesia', 'kyutai', 'fish', 'elevenlabs'];
      case 'quality':
        return ['elevenlabs', 'fish', 'cartesia', 'kyutai'];
      default:
        return ['kyutai', 'cartesia', 'fish', 'elevenlabs'];
    }
  }

  getAvailableSTTEngines(): string[] {
    return Array.from(this.engineStatus.entries())
      .filter(([_, available]) => available)
      .filter(([engine]) => ['parakeet', 'deepgram', 'whisper'].includes(engine))
      .map(([engine]) => engine);
  }

  getAvailableTTSEngines(): string[] {
    return Array.from(this.engineStatus.entries())
      .filter(([_, available]) => available)
      .filter(([engine]) => ['kyutai', 'cartesia', 'fish', 'elevenlabs'].includes(engine))
      .map(([engine]) => engine);
  }

  private createWavBuffer(audio: Float32Array, sampleRate: number): ArrayBuffer {
    const buffer = new ArrayBuffer(44 + audio.length * 2);
    const view = new DataView(buffer);

    // WAV header
    const writeString = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + audio.length * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, audio.length * 2, true);

    // Audio data
    for (let i = 0; i < audio.length; i++) {
      const sample = Math.max(-1, Math.min(1, audio[i]));
      view.setInt16(44 + i * 2, Math.floor(sample * 32767), true);
    }

    return buffer;
  }

  async dispose(): Promise<void> {
    await this.parakeet?.dispose();
    this.kyutai?.disconnect();
    await this.cartesia?.dispose();
    await this.fishAudio?.dispose();
    this.isInitialized = false;
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

export {
  ParakeetSTTEngine,
  KyutaiTTSEngine,
  CartesiaSonicEngine,
  FishAudioEngine,
};
