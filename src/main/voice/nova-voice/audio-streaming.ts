/**
 * NovaVoice - Audio Streaming
 * Efficient audio streaming with backpressure handling
 */

import { EventEmitter } from 'events';
import { Readable, Writable, Transform, pipeline } from 'stream';
import { promisify } from 'util';
import { createModuleLogger } from '../../utils/logger';
import { AudioChunk, AudioFormat } from './types';

const logger = createModuleLogger('NovaVoice-Streaming');
const pipelineAsync = promisify(pipeline);

// ============================================
// Types
// ============================================

export interface StreamConfig {
  highWaterMark: number;     // Bytes before backpressure
  chunkSize: number;         // Target chunk size
  timeout: number;           // Stream timeout in ms
  enableMetrics: boolean;
}

export interface StreamMetrics {
  bytesRead: number;
  bytesWritten: number;
  chunksProcessed: number;
  droppedChunks: number;
  avgLatency: number;
  backpressureEvents: number;
}

export interface AudioStreamOptions {
  format: AudioFormat;
  bufferMs: number;
  maxBufferMs: number;
}

// ============================================
// Audio Input Stream
// ============================================

export class AudioInputStream extends Readable {
  private format: AudioFormat;
  private buffer: AudioChunk[] = [];
  private maxBufferSize: number;
  private metrics: StreamMetrics = {
    bytesRead: 0,
    bytesWritten: 0,
    chunksProcessed: 0,
    droppedChunks: 0,
    avgLatency: 0,
    backpressureEvents: 0,
  };
  private latencies: number[] = [];
  private _isPaused = false;
  
  constructor(options: AudioStreamOptions) {
    super({
      objectMode: true,
      highWaterMark: 10, // 10 chunks
    });
    
    this.format = options.format;
    this.maxBufferSize = Math.ceil(
      (options.maxBufferMs / 1000) * options.format.sampleRate
    );
  }
  
  /**
   * Push audio chunk to stream
   */
  pushAudio(chunk: AudioChunk): boolean {
    const startTime = performance.now();
    
    // Check buffer size
    const totalSamples = this.buffer.reduce((acc, c) => {
      const samples = c.data instanceof Float32Array ? c.data.length : c.data.length / 4;
      return acc + samples;
    }, 0);
    
    if (totalSamples > this.maxBufferSize) {
      // Drop oldest chunk (backpressure)
      this.buffer.shift();
      this.metrics.droppedChunks++;
      this.metrics.backpressureEvents++;
    }
    
    this.buffer.push(chunk);
    
    // Track latency
    const latency = performance.now() - startTime;
    this.latencies.push(latency);
    if (this.latencies.length > 100) this.latencies.shift();
    this.metrics.avgLatency = this.latencies.reduce((a, b) => a + b, 0) / this.latencies.length;
    
    // Update metrics
    const bytes = chunk.data instanceof Float32Array 
      ? chunk.data.length * 4 
      : chunk.data.length;
    this.metrics.bytesRead += bytes;
    
    // Push to stream if not paused
    if (!this._isPaused) {
      return this.push(chunk);
    }
    
    return true;
  }
  
  _read(): void {
    this._isPaused = false;
    
    while (this.buffer.length > 0 && !this._isPaused) {
      const chunk = this.buffer.shift()!;
      this.metrics.chunksProcessed++;
      
      if (!this.push(chunk)) {
        this._isPaused = true;
        break;
      }
    }
  }
  
  getMetrics(): StreamMetrics {
    return { ...this.metrics };
  }
  
  getFormat(): AudioFormat {
    return this.format;
  }
}

// ============================================
// Audio Output Stream
// ============================================

export class AudioOutputStream extends Writable {
  private format: AudioFormat;
  private metrics: StreamMetrics = {
    bytesRead: 0,
    bytesWritten: 0,
    chunksProcessed: 0,
    droppedChunks: 0,
    avgLatency: 0,
    backpressureEvents: 0,
  };
  private onChunk: (chunk: AudioChunk) => void;
  
  constructor(
    format: AudioFormat,
    onChunk: (chunk: AudioChunk) => void
  ) {
    super({
      objectMode: true,
      highWaterMark: 10,
    });
    
    this.format = format;
    this.onChunk = onChunk;
  }
  
  _write(
    chunk: AudioChunk,
    encoding: string,
    callback: (error?: Error | null) => void
  ): void {
    try {
      const bytes = chunk.data instanceof Float32Array 
        ? chunk.data.length * 4 
        : chunk.data.length;
      
      this.metrics.bytesWritten += bytes;
      this.metrics.chunksProcessed++;
      
      this.onChunk(chunk);
      callback();
    } catch (error) {
      callback(error as Error);
    }
  }
  
  getMetrics(): StreamMetrics {
    return { ...this.metrics };
  }
}

// ============================================
// Audio Transform Stream
// ============================================

export type AudioTransformFn = (chunk: AudioChunk) => AudioChunk | Promise<AudioChunk>;

export class AudioTransformStream extends Transform {
  private transformFn: AudioTransformFn;
  private metrics: StreamMetrics = {
    bytesRead: 0,
    bytesWritten: 0,
    chunksProcessed: 0,
    droppedChunks: 0,
    avgLatency: 0,
    backpressureEvents: 0,
  };
  private latencies: number[] = [];
  
  constructor(transformFn: AudioTransformFn) {
    super({
      objectMode: true,
      highWaterMark: 5,
    });
    
    this.transformFn = transformFn;
  }
  
  async _transform(
    chunk: AudioChunk,
    encoding: string,
    callback: (error?: Error | null, data?: AudioChunk) => void
  ): Promise<void> {
    const startTime = performance.now();
    
    try {
      const transformed = await this.transformFn(chunk);
      
      // Track metrics
      const inputBytes = chunk.data instanceof Float32Array 
        ? chunk.data.length * 4 
        : chunk.data.length;
      const outputBytes = transformed.data instanceof Float32Array 
        ? transformed.data.length * 4 
        : transformed.data.length;
      
      this.metrics.bytesRead += inputBytes;
      this.metrics.bytesWritten += outputBytes;
      this.metrics.chunksProcessed++;
      
      // Track latency
      const latency = performance.now() - startTime;
      this.latencies.push(latency);
      if (this.latencies.length > 100) this.latencies.shift();
      this.metrics.avgLatency = this.latencies.reduce((a, b) => a + b, 0) / this.latencies.length;
      
      callback(null, transformed);
    } catch (error) {
      callback(error as Error);
    }
  }
  
  getMetrics(): StreamMetrics {
    return { ...this.metrics };
  }
}

// ============================================
// Resampler Stream
// ============================================

export class ResamplerStream extends AudioTransformStream {
  private inputRate: number;
  private outputRate: number;
  
  constructor(inputRate: number, outputRate: number) {
    super((chunk) => this.resample(chunk));
    this.inputRate = inputRate;
    this.outputRate = outputRate;
  }
  
  private resample(chunk: AudioChunk): AudioChunk {
    const samples = chunk.data instanceof Float32Array 
      ? chunk.data 
      : new Float32Array(chunk.data.buffer);
    
    if (this.inputRate === this.outputRate) {
      return chunk;
    }
    
    const ratio = this.outputRate / this.inputRate;
    const outputLength = Math.ceil(samples.length * ratio);
    const output = new Float32Array(outputLength);
    
    // Linear interpolation resampling
    for (let i = 0; i < outputLength; i++) {
      const srcIndex = i / ratio;
      const srcIndexFloor = Math.floor(srcIndex);
      const srcIndexCeil = Math.min(srcIndexFloor + 1, samples.length - 1);
      const t = srcIndex - srcIndexFloor;
      
      output[i] = samples[srcIndexFloor] * (1 - t) + samples[srcIndexCeil] * t;
    }
    
    return {
      ...chunk,
      data: output,
      duration: (outputLength / this.outputRate) * 1000,
      format: {
        ...chunk.format,
        sampleRate: this.outputRate,
      },
    };
  }
}

// ============================================
// Channel Mixer Stream
// ============================================

export class ChannelMixerStream extends AudioTransformStream {
  private inputChannels: number;
  private outputChannels: number;
  
  constructor(inputChannels: number, outputChannels: number) {
    super((chunk) => this.mixChannels(chunk));
    this.inputChannels = inputChannels;
    this.outputChannels = outputChannels;
  }
  
  private mixChannels(chunk: AudioChunk): AudioChunk {
    const samples = chunk.data instanceof Float32Array 
      ? chunk.data 
      : new Float32Array(chunk.data.buffer);
    
    if (this.inputChannels === this.outputChannels) {
      return chunk;
    }
    
    const framesCount = Math.floor(samples.length / this.inputChannels);
    const output = new Float32Array(framesCount * this.outputChannels);
    
    if (this.inputChannels === 2 && this.outputChannels === 1) {
      // Stereo to mono
      for (let i = 0; i < framesCount; i++) {
        output[i] = (samples[i * 2] + samples[i * 2 + 1]) / 2;
      }
    } else if (this.inputChannels === 1 && this.outputChannels === 2) {
      // Mono to stereo
      for (let i = 0; i < framesCount; i++) {
        output[i * 2] = samples[i];
        output[i * 2 + 1] = samples[i];
      }
    } else {
      // Generic downmix/upmix
      for (let i = 0; i < framesCount; i++) {
        let sum = 0;
        for (let c = 0; c < this.inputChannels; c++) {
          sum += samples[i * this.inputChannels + c];
        }
        const avg = sum / this.inputChannels;
        
        for (let c = 0; c < this.outputChannels; c++) {
          output[i * this.outputChannels + c] = avg;
        }
      }
    }
    
    return {
      ...chunk,
      data: output,
      format: {
        ...chunk.format,
        channels: this.outputChannels,
      },
    };
  }
}

// ============================================
// Audio Pipeline Builder
// ============================================

export class AudioPipelineBuilder {
  private inputStream: AudioInputStream | null = null;
  private transforms: AudioTransformStream[] = [];
  private outputStream: AudioOutputStream | null = null;
  
  /**
   * Set input stream
   */
  input(options: AudioStreamOptions): AudioPipelineBuilder {
    this.inputStream = new AudioInputStream(options);
    return this;
  }
  
  /**
   * Add transform
   */
  transform(fn: AudioTransformFn): AudioPipelineBuilder {
    this.transforms.push(new AudioTransformStream(fn));
    return this;
  }
  
  /**
   * Add resampler
   */
  resample(inputRate: number, outputRate: number): AudioPipelineBuilder {
    this.transforms.push(new ResamplerStream(inputRate, outputRate));
    return this;
  }
  
  /**
   * Add channel mixer
   */
  mixChannels(inputChannels: number, outputChannels: number): AudioPipelineBuilder {
    this.transforms.push(new ChannelMixerStream(inputChannels, outputChannels));
    return this;
  }
  
  /**
   * Set output
   */
  output(format: AudioFormat, onChunk: (chunk: AudioChunk) => void): AudioPipelineBuilder {
    this.outputStream = new AudioOutputStream(format, onChunk);
    return this;
  }
  
  /**
   * Build and connect pipeline
   */
  async build(): Promise<{
    input: AudioInputStream;
    output: AudioOutputStream;
    push: (chunk: AudioChunk) => boolean;
    getMetrics: () => Record<string, StreamMetrics>;
    destroy: () => void;
  }> {
    if (!this.inputStream || !this.outputStream) {
      throw new Error('Input and output streams are required');
    }
    
    const streams: (Readable | Transform | Writable)[] = [
      this.inputStream,
      ...this.transforms,
      this.outputStream,
    ];
    
    // Connect pipeline - use apply to spread the array
    await (pipelineAsync as (...args: (Readable | Transform | Writable)[]) => Promise<void>)(...streams).catch((error) => {
      // Pipeline errors are handled by stream error events
      if (error.code !== 'ERR_STREAM_PREMATURE_CLOSE') {
        logger.error('Pipeline error', { error: error.message });
      }
    });
    
    const input = this.inputStream;
    const output = this.outputStream;
    const transforms = this.transforms;
    
    return {
      input,
      output,
      push: (chunk) => input.pushAudio(chunk),
      getMetrics: () => ({
        input: input.getMetrics(),
        ...Object.fromEntries(
          transforms.map((t, i) => [`transform_${i}`, t.getMetrics()])
        ),
        output: output.getMetrics(),
      }),
      destroy: () => {
        input.destroy();
        transforms.forEach((t) => t.destroy());
        output.destroy();
      },
    };
  }
}

// ============================================
// Chunked Audio Streamer
// ============================================

export class ChunkedAudioStreamer extends EventEmitter {
  private chunkDurationMs: number;
  private format: AudioFormat;
  private buffer: Float32Array;
  private bufferOffset = 0;
  private chunkSize: number;
  
  constructor(format: AudioFormat, chunkDurationMs = 100) {
    super();
    this.format = format;
    this.chunkDurationMs = chunkDurationMs;
    this.chunkSize = Math.floor((chunkDurationMs / 1000) * format.sampleRate * format.channels);
    this.buffer = new Float32Array(this.chunkSize * 2); // Double buffer
  }
  
  /**
   * Add audio samples
   */
  addSamples(samples: Float32Array): void {
    let samplesOffset = 0;
    
    while (samplesOffset < samples.length) {
      const remaining = this.chunkSize - this.bufferOffset;
      const toCopy = Math.min(remaining, samples.length - samplesOffset);
      
      this.buffer.set(
        samples.subarray(samplesOffset, samplesOffset + toCopy),
        this.bufferOffset
      );
      
      this.bufferOffset += toCopy;
      samplesOffset += toCopy;
      
      // Emit chunk when full
      if (this.bufferOffset >= this.chunkSize) {
        const chunk: AudioChunk = {
          data: new Float32Array(this.buffer.subarray(0, this.chunkSize)),
          timestamp: Date.now(),
          duration: this.chunkDurationMs,
          format: this.format,
        };
        
        this.emit('chunk', chunk);
        this.bufferOffset = 0;
      }
    }
  }
  
  /**
   * Flush remaining buffer
   */
  flush(): AudioChunk | null {
    if (this.bufferOffset === 0) return null;
    
    const chunk: AudioChunk = {
      data: new Float32Array(this.buffer.subarray(0, this.bufferOffset)),
      timestamp: Date.now(),
      duration: (this.bufferOffset / this.format.sampleRate / this.format.channels) * 1000,
      format: this.format,
      isFinal: true,
    };
    
    this.bufferOffset = 0;
    this.emit('chunk', chunk);
    
    return chunk;
  }
  
  /**
   * Reset buffer
   */
  reset(): void {
    this.bufferOffset = 0;
  }
}

// ============================================
// Exports
// ============================================

export function createPipeline(): AudioPipelineBuilder {
  return new AudioPipelineBuilder();
}
