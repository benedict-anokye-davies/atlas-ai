/**
 * Streaming TTS Implementation
 * 
 * Makes responses FEEL 3x faster by starting audio playback
 * while the LLM is still generating text.
 * 
 * Before: Wait for full response (1600ms) → Then TTS (400ms) → First audio at 2000ms
 * After:  First sentence ready (~500ms) → TTS starts → First audio at ~800ms
 * 
 * Works with ElevenLabs streaming API for lowest latency.
 */

import { EventEmitter } from 'events';
import { sleep } from '../../../shared/utils';

// ============================================================================
// CONFIGURATION
// ============================================================================

export interface StreamingTTSConfig {
  // ElevenLabs settings
  elevenLabsApiKey: string;
  voiceId: string;
  modelId: string;
  
  // Streaming behavior
  minChunkLength: number;      // Minimum chars before sending to TTS (default: 50)
  maxChunkLength: number;      // Maximum chars per chunk (default: 200)
  sentenceDelimiters: string[]; // What ends a sentence
  
  // Audio settings
  outputFormat: 'mp3_44100_128' | 'pcm_16000' | 'pcm_22050' | 'pcm_24000';
  optimizeStreamingLatency: 0 | 1 | 2 | 3 | 4; // 0=disabled, 4=max optimization
  
  // Playback
  crossfadeDuration: number;   // ms to crossfade between chunks
  bufferAhead: number;         // How many chunks to buffer ahead
}

export const DEFAULT_STREAMING_CONFIG: StreamingTTSConfig = {
  elevenLabsApiKey: '',
  voiceId: 'EXAVITQu4vr4xnSDxMaL', // Sarah - natural conversational voice
  modelId: 'eleven_turbo_v2_5',    // Fastest model with great quality
  
  minChunkLength: 40,
  maxChunkLength: 150,
  sentenceDelimiters: ['.', '!', '?', ':', ';', '\n'],
  
  outputFormat: 'pcm_24000',
  optimizeStreamingLatency: 3,    // High optimization for speed
  
  crossfadeDuration: 50,
  bufferAhead: 2,
};

// ============================================================================
// STREAMING TTS ENGINE
// ============================================================================

interface AudioChunk {
  id: number;
  text: string;
  audio: ArrayBuffer | null;
  status: 'pending' | 'generating' | 'ready' | 'playing' | 'done';
  startTime?: number;
  endTime?: number;
}

export class StreamingTTSEngine extends EventEmitter {
  private config: StreamingTTSConfig;
  private chunks: AudioChunk[] = [];
  private currentChunkId = 0;
  private textBuffer = '';
  private isPlaying = false;
  private playbackQueue: AudioChunk[] = [];
  private audioContext: AudioContext | null = null;
  private currentSource: AudioBufferSourceNode | null = null;
  private gainNode: GainNode | null = null;
  private abortController: AbortController | null = null;
  
  // Metrics
  private metrics = {
    firstTextTime: 0,
    firstAudioTime: 0,
    totalChunks: 0,
    avgChunkLatency: 0,
  };

  constructor(config: Partial<StreamingTTSConfig> = {}) {
    super();
    this.config = { ...DEFAULT_STREAMING_CONFIG, ...config };
  }

  /**
   * Initialize audio context (must be called after user interaction)
   */
  async initialize(): Promise<void> {
    if (typeof window !== 'undefined' && !this.audioContext) {
      this.audioContext = new AudioContext({ sampleRate: 24000 });
      this.gainNode = this.audioContext.createGain();
      this.gainNode.connect(this.audioContext.destination);
    }
  }

  /**
   * Main entry point - stream LLM response and speak as it generates
   */
  async streamAndSpeak(
    llmStream: AsyncIterable<string>,
    onTextChunk?: (text: string) => void
  ): Promise<void> {
    this.reset();
    this.abortController = new AbortController();
    this.metrics.firstTextTime = 0;
    
    const startTime = Date.now();
    
    try {
      // Process LLM stream
      for await (const token of llmStream) {
        if (this.abortController.signal.aborted) break;
        
        // Track first text time
        if (!this.metrics.firstTextTime) {
          this.metrics.firstTextTime = Date.now() - startTime;
        }
        
        // Emit text for display
        onTextChunk?.(token);
        
        // Buffer text and check for sentence boundaries
        this.textBuffer += token;
        await this.processBuffer();
      }
      
      // Process any remaining text
      if (this.textBuffer.trim()) {
        await this.createChunk(this.textBuffer.trim());
        this.textBuffer = '';
      }
      
      // Wait for all audio to finish playing
      await this.waitForPlaybackComplete();
      
      this.emit('complete', this.metrics);
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        this.emit('error', error);
        throw error;
      }
    }
  }

  /**
   * Process buffered text and create chunks at sentence boundaries
   */
  private async processBuffer(): Promise<void> {
    const { minChunkLength, maxChunkLength, sentenceDelimiters } = this.config;
    
    // Find sentence boundary
    let boundaryIndex = -1;
    for (const delimiter of sentenceDelimiters) {
      const idx = this.textBuffer.lastIndexOf(delimiter);
      if (idx > boundaryIndex && idx < this.textBuffer.length - 1) {
        boundaryIndex = idx;
      }
    }
    
    // Check if we should create a chunk
    const hasEnoughText = this.textBuffer.length >= minChunkLength;
    const hasSentenceBoundary = boundaryIndex >= minChunkLength - 10;
    const tooLong = this.textBuffer.length >= maxChunkLength;
    
    if ((hasEnoughText && hasSentenceBoundary) || tooLong) {
      const splitIndex = tooLong 
        ? this.findBestSplitPoint(this.textBuffer, maxChunkLength)
        : boundaryIndex + 1;
      
      const chunkText = this.textBuffer.slice(0, splitIndex).trim();
      this.textBuffer = this.textBuffer.slice(splitIndex).trim();
      
      if (chunkText) {
        await this.createChunk(chunkText);
      }
    }
  }

  /**
   * Find the best point to split text (prefer word boundaries)
   */
  private findBestSplitPoint(text: string, maxLength: number): number {
    // Look for last space before maxLength
    const lastSpace = text.lastIndexOf(' ', maxLength);
    if (lastSpace > maxLength / 2) {
      return lastSpace;
    }
    return maxLength;
  }

  /**
   * Create an audio chunk and start generating TTS
   */
  private async createChunk(text: string): Promise<void> {
    const chunk: AudioChunk = {
      id: this.currentChunkId++,
      text,
      audio: null,
      status: 'pending',
    };
    
    this.chunks.push(chunk);
    this.metrics.totalChunks++;
    
    this.emit('chunk_created', { id: chunk.id, text });
    
    // Start generating audio (don't await - let it run in background)
    this.generateAudio(chunk);
    
    // Start playback if not already playing
    if (!this.isPlaying) {
      this.startPlayback();
    }
  }

  /**
   * Generate audio for a chunk using ElevenLabs streaming API
   */
  private async generateAudio(chunk: AudioChunk): Promise<void> {
    chunk.status = 'generating';
    chunk.startTime = Date.now();
    
    try {
      const response = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${this.config.voiceId}/stream`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'xi-api-key': this.config.elevenLabsApiKey,
          },
          body: JSON.stringify({
            text: chunk.text,
            model_id: this.config.modelId,
            output_format: this.config.outputFormat,
            optimize_streaming_latency: this.config.optimizeStreamingLatency,
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.75,
              style: 0.0,
              use_speaker_boost: true,
            },
          }),
          signal: this.abortController?.signal,
        }
      );

      if (!response.ok) {
        throw new Error(`ElevenLabs API error: ${response.status}`);
      }

      // Collect streamed audio chunks
      const audioChunks: Uint8Array[] = [];
      const reader = response.body?.getReader();
      
      if (!reader) throw new Error('No response body');

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        audioChunks.push(value);
      }

      // Combine chunks
      const totalLength = audioChunks.reduce((acc, chunk) => acc + chunk.length, 0);
      const audioData = new Uint8Array(totalLength);
      let offset = 0;
      for (const audioChunk of audioChunks) {
        audioData.set(audioChunk, offset);
        offset += audioChunk.length;
      }

      chunk.audio = audioData.buffer;
      chunk.status = 'ready';
      chunk.endTime = Date.now();
      
      // Track metrics
      const latency = chunk.endTime - chunk.startTime!;
      this.metrics.avgChunkLatency = 
        (this.metrics.avgChunkLatency * (this.metrics.totalChunks - 1) + latency) / 
        this.metrics.totalChunks;
      
      // Track first audio time
      if (!this.metrics.firstAudioTime && this.chunks[0]?.id === chunk.id) {
        this.metrics.firstAudioTime = Date.now();
      }
      
      this.emit('chunk_ready', { id: chunk.id, latency });
      
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        chunk.status = 'done'; // Skip this chunk
        this.emit('chunk_error', { id: chunk.id, error });
      }
    }
  }

  /**
   * Start the playback loop
   */
  private async startPlayback(): Promise<void> {
    if (this.isPlaying) return;
    this.isPlaying = true;
    
    await this.initialize();
    
    let playingChunkIndex = 0;
    
    while (this.isPlaying) {
      const chunk = this.chunks[playingChunkIndex];
      
      if (!chunk) {
        // No more chunks yet, wait a bit
        await this.sleep(50);
        continue;
      }
      
      if (chunk.status === 'ready' && chunk.audio) {
        // Play this chunk
        chunk.status = 'playing';
        await this.playAudioChunk(chunk);
        chunk.status = 'done';
        playingChunkIndex++;
        
      } else if (chunk.status === 'done') {
        // Already played or errored, skip
        playingChunkIndex++;
        
      } else if (chunk.status === 'pending' || chunk.status === 'generating') {
        // Wait for chunk to be ready
        await this.sleep(20);
      }
      
      // Check if we're done
      const allDone = this.chunks.length > 0 && 
        playingChunkIndex >= this.chunks.length &&
        this.textBuffer === '';
      
      if (allDone) {
        break;
      }
    }
    
    this.isPlaying = false;
  }

  /**
   * Play a single audio chunk
   */
  private async playAudioChunk(chunk: AudioChunk): Promise<void> {
    if (!this.audioContext || !this.gainNode || !chunk.audio) return;
    
    try {
      // Decode PCM audio
      const audioBuffer = await this.decodePCM(chunk.audio);
      
      // Create source
      const source = this.audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.gainNode);
      
      this.currentSource = source;
      
      // Play and wait for completion
      return new Promise((resolve) => {
        source.onended = () => {
          this.currentSource = null;
          resolve();
        };
        source.start();
        this.emit('chunk_playing', { id: chunk.id, text: chunk.text });
      });
      
    } catch (error) {
      this.emit('playback_error', { id: chunk.id, error });
    }
  }

  /**
   * Decode PCM audio data to AudioBuffer
   */
  private async decodePCM(data: ArrayBuffer): Promise<AudioBuffer> {
    if (!this.audioContext) throw new Error('No audio context');
    
    const sampleRate = 24000; // PCM 24000
    const numChannels = 1;
    const bytesPerSample = 2; // 16-bit
    
    const dataView = new DataView(data);
    const numSamples = data.byteLength / bytesPerSample;
    
    const audioBuffer = this.audioContext.createBuffer(
      numChannels,
      numSamples,
      sampleRate
    );
    
    const channelData = audioBuffer.getChannelData(0);
    
    for (let i = 0; i < numSamples; i++) {
      // Convert 16-bit signed int to float (-1.0 to 1.0)
      const sample = dataView.getInt16(i * bytesPerSample, true);
      channelData[i] = sample / 32768;
    }
    
    return audioBuffer;
  }

  /**
   * Wait for all playback to complete
   */
  private async waitForPlaybackComplete(): Promise<void> {
    while (this.isPlaying) {
      await this.sleep(100);
    }
  }

  /**
   * Stop all streaming and playback
   */
  stop(): void {
    this.abortController?.abort();
    this.isPlaying = false;
    
    if (this.currentSource) {
      try {
        this.currentSource.stop();
      } catch {
        // Ignore if already stopped
      }
      this.currentSource = null;
    }
    
    this.emit('stopped');
  }

  /**
   * Reset state for new stream
   */
  private reset(): void {
    this.stop();
    this.chunks = [];
    this.currentChunkId = 0;
    this.textBuffer = '';
    this.playbackQueue = [];
    this.metrics = {
      firstTextTime: 0,
      firstAudioTime: 0,
      totalChunks: 0,
      avgChunkLatency: 0,
    };
  }

  /**
   * Get current metrics
   */
  getMetrics() {
    return { ...this.metrics };
  }

  private sleep(ms: number): Promise<void> {
    return sleep(ms);
  }
}

// ============================================================================
// INTEGRATION WITH NOVA VOICE PIPELINE
// ============================================================================

export interface NovaStreamingPipelineConfig {
  // STT
  deepgramApiKey: string;
  
  // LLM  
  llmEndpoint: string;
  llmApiKey: string;
  llmModel: string;
  systemPrompt: string;
  
  // TTS
  elevenLabsApiKey: string;
  voiceId: string;
}

/**
 * Full streaming pipeline: Voice → STT → LLM (streaming) → TTS (streaming) → Audio
 * 
 * This makes the entire conversation feel incredibly responsive.
 */
export class NovaStreamingPipeline extends EventEmitter {
  private config: NovaStreamingPipelineConfig;
  private streamingTTS: StreamingTTSEngine;
  private conversationHistory: Array<{ role: string; content: string }> = [];

  constructor(config: NovaStreamingPipelineConfig) {
    super();
    this.config = config;
    this.streamingTTS = new StreamingTTSEngine({
      elevenLabsApiKey: config.elevenLabsApiKey,
      voiceId: config.voiceId,
    });
    
    // Forward TTS events
    this.streamingTTS.on('chunk_playing', (data) => this.emit('speaking', data));
    this.streamingTTS.on('complete', (metrics) => this.emit('response_complete', metrics));
    this.streamingTTS.on('error', (error) => this.emit('error', error));
  }

  /**
   * Process user input and stream response with audio
   */
  async processUserInput(userText: string): Promise<string> {
    const startTime = Date.now();
    this.emit('processing_start', { userText });
    
    // Add to history
    this.conversationHistory.push({ role: 'user', content: userText });
    
    // Create LLM stream
    const llmStream = this.createLLMStream(userText);
    
    // Collect full response while streaming TTS
    let fullResponse = '';
    
    await this.streamingTTS.streamAndSpeak(
      llmStream,
      (token) => {
        fullResponse += token;
        this.emit('text_token', { token, fullText: fullResponse });
      }
    );
    
    // Add assistant response to history
    this.conversationHistory.push({ role: 'assistant', content: fullResponse });
    
    const totalTime = Date.now() - startTime;
    const metrics = this.streamingTTS.getMetrics();
    
    this.emit('turn_complete', {
      userText,
      response: fullResponse,
      totalTime,
      firstAudioDelay: metrics.firstAudioTime,
      metrics,
    });
    
    return fullResponse;
  }

  /**
   * Create async generator for LLM streaming
   */
  private async *createLLMStream(userText: string): AsyncGenerator<string> {
    const messages = [
      { role: 'system', content: this.config.systemPrompt },
      ...this.conversationHistory,
    ];

    const response = await fetch(this.config.llmEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.llmApiKey}`,
      },
      body: JSON.stringify({
        model: this.config.llmModel,
        messages,
        stream: true,
        temperature: 0.7,
        max_tokens: 1024,
      }),
    });

    if (!response.ok) {
      throw new Error(`LLM API error: ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              yield content;
            }
          } catch {
            // Ignore parse errors
          }
        }
      }
    }
  }

  /**
   * Stop current response
   */
  stop(): void {
    this.streamingTTS.stop();
  }

  /**
   * Clear conversation history
   */
  clearHistory(): void {
    this.conversationHistory = [];
  }
}

// ============================================================================
// ELECTRON MAIN PROCESS WRAPPER
// ============================================================================

/**
 * Electron-compatible streaming TTS for main process
 * Uses native audio playback instead of Web Audio API
 */
export class ElectronStreamingTTS extends EventEmitter {
  private config: StreamingTTSConfig;
  private chunks: AudioChunk[] = [];
  private currentChunkId = 0;
  private textBuffer = '';
  private isPlaying = false;
  private abortController: AbortController | null = null;
  private audioQueue: ArrayBuffer[] = [];

  constructor(config: Partial<StreamingTTSConfig> = {}) {
    super();
    this.config = { ...DEFAULT_STREAMING_CONFIG, ...config };
  }

  /**
   * Stream text and emit audio chunks for playback
   */
  async streamAndEmitAudio(
    llmStream: AsyncIterable<string>,
    onTextChunk?: (text: string) => void,
    onAudioChunk?: (audio: ArrayBuffer, text: string) => void
  ): Promise<void> {
    this.reset();
    this.abortController = new AbortController();

    try {
      for await (const token of llmStream) {
        if (this.abortController.signal.aborted) break;
        
        onTextChunk?.(token);
        this.textBuffer += token;
        
        // Check for sentence boundaries
        await this.processBufferAndEmit(onAudioChunk);
      }

      // Process remaining text
      if (this.textBuffer.trim()) {
        const audio = await this.generateAudioForText(this.textBuffer.trim());
        if (audio) {
          onAudioChunk?.(audio, this.textBuffer.trim());
        }
        this.textBuffer = '';
      }

      this.emit('complete');
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        this.emit('error', error);
        throw error;
      }
    }
  }

  private async processBufferAndEmit(
    onAudioChunk?: (audio: ArrayBuffer, text: string) => void
  ): Promise<void> {
    const { minChunkLength, maxChunkLength, sentenceDelimiters } = this.config;

    let boundaryIndex = -1;
    for (const delimiter of sentenceDelimiters) {
      const idx = this.textBuffer.lastIndexOf(delimiter);
      if (idx > boundaryIndex && idx < this.textBuffer.length - 1) {
        boundaryIndex = idx;
      }
    }

    const hasEnoughText = this.textBuffer.length >= minChunkLength;
    const hasSentenceBoundary = boundaryIndex >= minChunkLength - 10;
    const tooLong = this.textBuffer.length >= maxChunkLength;

    if ((hasEnoughText && hasSentenceBoundary) || tooLong) {
      const splitIndex = tooLong
        ? this.findBestSplitPoint(this.textBuffer, maxChunkLength)
        : boundaryIndex + 1;

      const chunkText = this.textBuffer.slice(0, splitIndex).trim();
      this.textBuffer = this.textBuffer.slice(splitIndex).trim();

      if (chunkText) {
        const audio = await this.generateAudioForText(chunkText);
        if (audio) {
          onAudioChunk?.(audio, chunkText);
        }
      }
    }
  }

  private findBestSplitPoint(text: string, maxLength: number): number {
    const lastSpace = text.lastIndexOf(' ', maxLength);
    if (lastSpace > maxLength / 2) {
      return lastSpace;
    }
    return maxLength;
  }

  private async generateAudioForText(text: string): Promise<ArrayBuffer | null> {
    try {
      const response = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${this.config.voiceId}/stream`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'xi-api-key': this.config.elevenLabsApiKey,
          },
          body: JSON.stringify({
            text,
            model_id: this.config.modelId,
            output_format: this.config.outputFormat,
            optimize_streaming_latency: this.config.optimizeStreamingLatency,
          }),
          signal: this.abortController?.signal,
        }
      );

      if (!response.ok) {
        throw new Error(`ElevenLabs API error: ${response.status}`);
      }

      const audioChunks: Uint8Array[] = [];
      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        audioChunks.push(value);
      }

      const totalLength = audioChunks.reduce((acc, chunk) => acc + chunk.length, 0);
      const audioData = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of audioChunks) {
        audioData.set(chunk, offset);
        offset += chunk.length;
      }

      return audioData.buffer;
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        this.emit('chunk_error', { text, error });
      }
      return null;
    }
  }

  stop(): void {
    this.abortController?.abort();
    this.isPlaying = false;
  }

  private reset(): void {
    this.stop();
    this.chunks = [];
    this.currentChunkId = 0;
    this.textBuffer = '';
    this.audioQueue = [];
  }
}

// Classes and constants already exported at definition above
