/**
 * Kyutai TTS 1.6B Integration
 * 
 * The key differentiator from ElevenLabs:
 * - STREAMING IN TEXT: Can start generating audio before full text is available
 * - Pipe LLM tokens directly to TTS - audio starts while LLM is still generating
 * - Word-level timestamps for lip-sync and karaoke
 * - Rust server with WebSocket for production deployment
 * 
 * This is what makes sub-200ms end-to-end latency possible!
 */

import { EventEmitter } from 'events';
import WebSocket from 'ws';

// =============================================================================
// TYPES
// =============================================================================

export interface KyutaiConfig {
  /** Server URL (Rust WebSocket server) */
  serverUrl: string;
  /** Voice ID to use */
  voiceId: string;
  /** Sample rate for output audio */
  sampleRate: 24000 | 44100 | 48000;
  /** Enable streaming text input (the key feature!) */
  streamingTextInput: boolean;
  /** Output word timestamps */
  outputTimestamps: boolean;
  /** Connection timeout in ms */
  connectionTimeout: number;
}

export interface TextToken {
  /** The text token (word or partial word) */
  text: string;
  /** Is this the last token? */
  isFinal: boolean;
  /** Sequence number for ordering */
  sequence: number;
}

export interface AudioChunk {
  /** PCM audio samples */
  samples: Float32Array;
  /** Word timestamps (if enabled) */
  timestamps?: WordTimestamp[];
  /** Is this the final chunk? */
  isFinal: boolean;
  /** Latency from text input to this audio chunk */
  latencyMs: number;
}

export interface WordTimestamp {
  word: string;
  startMs: number;
  endMs: number;
}

export interface SynthesisMetrics {
  /** Time to first audio byte */
  ttfbMs: number;
  /** Total synthesis time */
  totalTimeMs: number;
  /** Characters processed */
  charactersProcessed: number;
  /** Audio duration generated */
  audioDurationMs: number;
  /** Real-time factor */
  rtf: number;
}

// =============================================================================
// KYUTAI TTS ENGINE
// =============================================================================

export class KyutaiTTSEngine extends EventEmitter {
  private config: KyutaiConfig;
  private ws: WebSocket | null = null;
  private isConnected = false;
  private isGenerating = false;
  private textBuffer: TextToken[] = [];
  private audioQueue: AudioChunk[] = [];
  private currentSequence = 0;
  private synthesisStartTime = 0;
  private firstAudioTime = 0;

  constructor(config: Partial<KyutaiConfig> = {}) {
    super();
    this.config = {
      serverUrl: 'ws://localhost:8765',
      voiceId: 'default',
      sampleRate: 24000,
      streamingTextInput: true, // THE KEY FEATURE
      outputTimestamps: true,
      connectionTimeout: 5000,
      ...config,
    };
  }

  /**
   * Connect to Kyutai TTS server
   */
  async connect(): Promise<void> {
    if (this.isConnected) return;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
      }, this.config.connectionTimeout);

      this.ws = new WebSocket(this.config.serverUrl);

      this.ws.on('open', () => {
        clearTimeout(timeout);
        this.isConnected = true;
        
        // Send configuration
        this.ws?.send(JSON.stringify({
          type: 'config',
          voiceId: this.config.voiceId,
          sampleRate: this.config.sampleRate,
          streamingText: this.config.streamingTextInput,
          timestamps: this.config.outputTimestamps,
        }));

        this.emit('connected');
        resolve();
      });

      this.ws.on('message', (data) => {
        this.handleMessage(data);
      });

      this.ws.on('close', () => {
        this.isConnected = false;
        this.emit('disconnected');
      });

      this.ws.on('error', (error) => {
        clearTimeout(timeout);
        this.emit('error', error);
        reject(error);
      });
    });
  }

  private handleMessage(data: WebSocket.Data): void {
    try {
      // Handle binary audio data
      if (data instanceof Buffer) {
        const samples = new Float32Array(data.buffer, data.byteOffset, data.length / 4);
        
        if (this.firstAudioTime === 0) {
          this.firstAudioTime = performance.now();
          this.emit('first-audio', {
            ttfbMs: this.firstAudioTime - this.synthesisStartTime,
          });
        }

        const chunk: AudioChunk = {
          samples,
          isFinal: false,
          latencyMs: performance.now() - this.synthesisStartTime,
        };

        this.audioQueue.push(chunk);
        this.emit('audio', chunk);
        return;
      }

      // Handle JSON messages
      const message = JSON.parse(data.toString());

      switch (message.type) {
        case 'ready':
          this.emit('ready');
          break;

        case 'timestamps':
          // Word timestamps for the latest audio
          if (this.audioQueue.length > 0) {
            const lastChunk = this.audioQueue[this.audioQueue.length - 1];
            lastChunk.timestamps = message.words;
          }
          this.emit('timestamps', message.words);
          break;

        case 'complete':
          this.isGenerating = false;
          this.emit('complete', {
            totalTimeMs: performance.now() - this.synthesisStartTime,
            ttfbMs: this.firstAudioTime - this.synthesisStartTime,
          });
          break;

        case 'error':
          this.emit('error', new Error(message.message));
          break;
      }
    } catch (error) {
      this.emit('error', error);
    }
  }

  /**
   * THE KEY FEATURE: Stream text tokens and get audio in real-time
   * 
   * Unlike ElevenLabs which requires full text, Kyutai can:
   * 1. Accept text token by token
   * 2. Start generating audio immediately
   * 3. Output audio while still receiving text
   * 
   * This enables piping LLM output directly to TTS!
   */
  async *synthesizeStreaming(
    textStream: AsyncIterable<string>,
    options: { voiceId?: string } = {}
  ): AsyncGenerator<AudioChunk> {
    if (!this.isConnected) {
      await this.connect();
    }

    this.isGenerating = true;
    this.synthesisStartTime = performance.now();
    this.firstAudioTime = 0;
    this.audioQueue = [];
    this.currentSequence = 0;

    // Start synthesis session
    this.ws?.send(JSON.stringify({
      type: 'start',
      voiceId: options.voiceId || this.config.voiceId,
      streamingText: true,
    }));

    // Create a promise-based queue for audio chunks
    const audioPromises: Promise<AudioChunk | null>[] = [];
    let resolveNext: ((chunk: AudioChunk | null) => void) | null = null;

    const onAudio = (chunk: AudioChunk) => {
      if (resolveNext) {
        resolveNext(chunk);
        resolveNext = null;
      } else {
        audioPromises.push(Promise.resolve(chunk));
      }
    };

    const onComplete = () => {
      if (resolveNext) {
        resolveNext(null);
        resolveNext = null;
      } else {
        audioPromises.push(Promise.resolve(null));
      }
    };

    this.on('audio', onAudio);
    this.on('complete', onComplete);

    try {
      // Process text stream - send tokens as they arrive
      for await (const text of textStream) {
        this.currentSequence++;
        
        // Send text token to server
        this.ws?.send(JSON.stringify({
          type: 'text',
          content: text,
          sequence: this.currentSequence,
          isFinal: false,
        }));

        // Yield any available audio chunks
        while (audioPromises.length > 0) {
          const chunk = await audioPromises.shift()!;
          if (chunk === null) break;
          yield chunk;
        }
      }

      // Signal end of text
      this.ws?.send(JSON.stringify({
        type: 'text',
        content: '',
        sequence: this.currentSequence + 1,
        isFinal: true,
      }));

      // Yield remaining audio chunks
      while (this.isGenerating || audioPromises.length > 0) {
        if (audioPromises.length > 0) {
          const chunk = await audioPromises.shift()!;
          if (chunk === null) break;
          yield chunk;
        } else {
          // Wait for next chunk
          const chunk = await new Promise<AudioChunk | null>((resolve) => {
            resolveNext = resolve;
            // Timeout to prevent infinite wait
            setTimeout(() => {
              if (resolveNext === resolve) {
                resolveNext = null;
                resolve(null);
              }
            }, 5000);
          });
          if (chunk === null) break;
          yield chunk;
        }
      }
    } finally {
      this.off('audio', onAudio);
      this.off('complete', onComplete);
    }
  }

  /**
   * Convenience method: Pipe LLM stream directly to audio output
   * 
   * Usage:
   * ```typescript
   * const llmStream = generateWithLLM(userQuery);
   * const audioStream = kyutai.pipeLLMToAudio(llmStream);
   * 
   * for await (const audio of audioStream) {
   *   playAudio(audio.samples);
   * }
   * ```
   */
  async *pipeLLMToAudio(
    llmStream: AsyncIterable<string>,
    voiceId?: string
  ): AsyncGenerator<AudioChunk> {
    yield* this.synthesizeStreaming(llmStream, { voiceId });
  }

  /**
   * Standard synthesis (non-streaming text input)
   */
  async synthesize(
    text: string,
    options: { voiceId?: string } = {}
  ): Promise<{ audio: Float32Array; timestamps: WordTimestamp[]; metrics: SynthesisMetrics }> {
    const chunks: AudioChunk[] = [];
    const allTimestamps: WordTimestamp[] = [];
    const startTime = performance.now();
    let ttfb = 0;

    // Use streaming internally
    async function* textGenerator() {
      yield text;
    }

    for await (const chunk of this.synthesizeStreaming(textGenerator(), options)) {
      if (ttfb === 0) {
        ttfb = performance.now() - startTime;
      }
      chunks.push(chunk);
      if (chunk.timestamps) {
        allTimestamps.push(...chunk.timestamps);
      }
    }

    // Combine audio chunks
    const totalLength = chunks.reduce((acc, c) => acc + c.samples.length, 0);
    const audio = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      audio.set(chunk.samples, offset);
      offset += chunk.samples.length;
    }

    const totalTime = performance.now() - startTime;
    const audioDuration = (audio.length / this.config.sampleRate) * 1000;

    return {
      audio,
      timestamps: allTimestamps,
      metrics: {
        ttfbMs: ttfb,
        totalTimeMs: totalTime,
        charactersProcessed: text.length,
        audioDurationMs: audioDuration,
        rtf: audioDuration / totalTime,
      },
    };
  }

  /**
   * Change voice
   */
  setVoice(voiceId: string): void {
    this.config.voiceId = voiceId;
    if (this.isConnected) {
      this.ws?.send(JSON.stringify({
        type: 'config',
        voiceId,
      }));
    }
  }

  /**
   * Disconnect from server
   */
  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
  }

  /**
   * Check if connected
   */
  get connected(): boolean {
    return this.isConnected;
  }
}

// =============================================================================
// LOCAL KYUTAI SERVER (for self-hosted deployment)
// =============================================================================

export interface LocalServerConfig {
  port: number;
  modelPath: string;
  useGpu: boolean;
  maxConcurrent: number;
}

/**
 * Manages a local Kyutai TTS server
 * In production, you'd run the official Rust server
 */
export class KyutaiLocalServer extends EventEmitter {
  private config: LocalServerConfig;
  private serverProcess: import('child_process').ChildProcess | null = null;

  constructor(config: Partial<LocalServerConfig> = {}) {
    super();
    this.config = {
      port: 8765,
      modelPath: 'kyutai/kyutai-tts-1.6b',
      useGpu: true,
      maxConcurrent: 4,
      ...config,
    };
  }

  /**
   * Start the local Kyutai server
   */
  async start(): Promise<void> {
    // In production, you would start the Rust server:
    // cargo run --release -- --port 8765 --model kyutai-tts-1.6b
    
    this.emit('status', 'Starting Kyutai TTS server...');
    
    // For now, emit ready (actual implementation would spawn process)
    this.emit('ready', {
      url: `ws://localhost:${this.config.port}`,
    });
  }

  async stop(): Promise<void> {
    if (this.serverProcess) {
      this.serverProcess.kill();
      this.serverProcess = null;
    }
  }
}

// =============================================================================
// COMPARISON: KYUTAI vs ELEVENLABS
// =============================================================================

export const KYUTAI_VS_ELEVENLABS = {
  kyutai: {
    name: 'Kyutai TTS 1.6B',
    latency: '<100ms (streaming text)',
    streamingText: 'YES - Can pipe LLM tokens directly',
    streamingAudio: 'YES',
    timestamps: 'Word-level with exact timing',
    languages: '20+ (Pocket TTS)',
    cost: 'FREE (self-hosted)',
    voiceCloning: 'Yes (Pocket TTS)',
    quality: 'State of the art (July 2025)',
    deployment: 'Rust server (WebSocket)',
    keyAdvantage: 'Streaming in TEXT allows audio to start before full text is ready',
  },
  elevenLabs: {
    name: 'ElevenLabs',
    latency: '300-500ms',
    streamingText: 'NO - Requires full text before generation',
    streamingAudio: 'YES',
    timestamps: 'Limited',
    languages: '29',
    cost: '$0.30/1K chars',
    voiceCloning: 'Yes (30s sample required)',
    quality: 'Best-in-class',
    deployment: 'Cloud API only',
    keyAdvantage: 'Largest voice library, proven at scale',
  },
  advantages: {
    kyutai: [
      'Streaming text input (the killer feature)',
      '3-5x lower latency',
      'Zero cost (self-hosted)',
      'Full data privacy',
      'Word-level timestamps',
      'No rate limits',
      'Latest research (delayed streams modeling)',
    ],
    elevenLabs: [
      'More voices (1200+)',
      'More languages (29)',
      'No infrastructure needed',
      'Proven at massive scale',
      'Professional support',
      'Voice design tools',
      'Ecosystem (dubbing, sound effects)',
    ],
  },
  whenToUse: {
    kyutai: [
      'Need lowest possible latency',
      'Building real-time voice agents',
      'Want to pipe LLM output directly to TTS',
      'Cost is a concern (high volume)',
      'Data privacy is critical',
      'Need word-level timestamps',
    ],
    elevenLabs: [
      'Need widest voice selection',
      'Don\'t want to manage infrastructure',
      'Need proven enterprise reliability',
      'Using their dubbing/localization features',
      'Building content creation tools',
    ],
  },
};
