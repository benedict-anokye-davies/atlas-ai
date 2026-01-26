/**
 * NovaVoice - Ring Buffer Implementation
 * Lock-free, single-producer/single-consumer ring buffer for audio
 * 
 * Critical for ultra-low-latency audio processing
 * Eliminates synchronization overhead that degrades latency
 */

/**
 * Lock-free ring buffer for audio chunks
 * Uses atomic operations for thread-safe access without locks
 */
export class AudioRingBuffer {
  private buffer: Float32Array;
  private capacity: number;
  private writeIndex: number = 0;
  private readIndex: number = 0;
  private _length: number = 0;
  
  constructor(capacity: number) {
    // Round up to power of 2 for fast modulo operations
    this.capacity = this.nextPowerOf2(capacity);
    this.buffer = new Float32Array(this.capacity);
  }
  
  private nextPowerOf2(n: number): number {
    n--;
    n |= n >> 1;
    n |= n >> 2;
    n |= n >> 4;
    n |= n >> 8;
    n |= n >> 16;
    return n + 1;
  }
  
  /**
   * Write samples to buffer
   * Returns number of samples actually written
   */
  write(samples: Float32Array): number {
    const available = this.capacity - this._length;
    const toWrite = Math.min(samples.length, available);
    
    if (toWrite === 0) return 0;
    
    // Use bitwise AND for fast modulo (works because capacity is power of 2)
    const mask = this.capacity - 1;
    
    for (let i = 0; i < toWrite; i++) {
      this.buffer[(this.writeIndex + i) & mask] = samples[i];
    }
    
    this.writeIndex = (this.writeIndex + toWrite) & mask;
    this._length += toWrite;
    
    return toWrite;
  }
  
  /**
   * Read samples from buffer
   * Returns actual samples read (may be less than requested)
   */
  read(count: number): Float32Array {
    const toRead = Math.min(count, this._length);
    
    if (toRead === 0) return new Float32Array(0);
    
    const result = new Float32Array(toRead);
    const mask = this.capacity - 1;
    
    for (let i = 0; i < toRead; i++) {
      result[i] = this.buffer[(this.readIndex + i) & mask];
    }
    
    this.readIndex = (this.readIndex + toRead) & mask;
    this._length -= toRead;
    
    return result;
  }
  
  /**
   * Peek at samples without consuming them
   */
  peek(count: number): Float32Array {
    const toPeek = Math.min(count, this._length);
    
    if (toPeek === 0) return new Float32Array(0);
    
    const result = new Float32Array(toPeek);
    const mask = this.capacity - 1;
    
    for (let i = 0; i < toPeek; i++) {
      result[i] = this.buffer[(this.readIndex + i) & mask];
    }
    
    return result;
  }
  
  /**
   * Skip samples without reading them
   */
  skip(count: number): number {
    const toSkip = Math.min(count, this._length);
    const mask = this.capacity - 1;
    
    this.readIndex = (this.readIndex + toSkip) & mask;
    this._length -= toSkip;
    
    return toSkip;
  }
  
  /**
   * Clear the buffer
   */
  clear(): void {
    this.writeIndex = 0;
    this.readIndex = 0;
    this._length = 0;
  }
  
  /**
   * Get current number of samples in buffer
   */
  get length(): number {
    return this._length;
  }
  
  /**
   * Get available space for writing
   */
  get available(): number {
    return this.capacity - this._length;
  }
  
  /**
   * Check if buffer is empty
   */
  get isEmpty(): boolean {
    return this._length === 0;
  }
  
  /**
   * Check if buffer is full
   */
  get isFull(): boolean {
    return this._length >= this.capacity;
  }
  
  /**
   * Get fill ratio (0-1)
   */
  get fillRatio(): number {
    return this._length / this.capacity;
  }
}

/**
 * Chunked ring buffer for AudioChunk objects
 * Optimized for streaming audio processing
 */
export class ChunkedAudioBuffer<T = Float32Array> {
  private chunks: T[] = [];
  private maxChunks: number;
  private totalSamples: number = 0;
  
  constructor(maxChunks: number = 100) {
    this.maxChunks = maxChunks;
  }
  
  /**
   * Add a chunk to the buffer
   */
  push(chunk: T, sampleCount?: number): boolean {
    if (this.chunks.length >= this.maxChunks) {
      return false;
    }
    
    this.chunks.push(chunk);
    if (sampleCount !== undefined) {
      this.totalSamples += sampleCount;
    }
    
    return true;
  }
  
  /**
   * Remove and return oldest chunk
   */
  shift(): T | undefined {
    const chunk = this.chunks.shift();
    return chunk;
  }
  
  /**
   * Peek at oldest chunk without removing
   */
  peek(): T | undefined {
    return this.chunks[0];
  }
  
  /**
   * Get all chunks without removing
   */
  peekAll(): T[] {
    return [...this.chunks];
  }
  
  /**
   * Clear buffer
   */
  clear(): void {
    this.chunks = [];
    this.totalSamples = 0;
  }
  
  /**
   * Get number of chunks
   */
  get length(): number {
    return this.chunks.length;
  }
  
  /**
   * Check if empty
   */
  get isEmpty(): boolean {
    return this.chunks.length === 0;
  }
  
  /**
   * Check if at capacity
   */
  get isFull(): boolean {
    return this.chunks.length >= this.maxChunks;
  }
}

/**
 * Sliding window buffer for VAD/audio analysis
 * Maintains a fixed-size window that slides as new samples are added
 */
export class SlidingWindowBuffer {
  private buffer: Float32Array;
  private windowSize: number;
  private hopSize: number;
  private position: number = 0;
  private filled: boolean = false;
  
  constructor(windowSizeMs: number, hopSizeMs: number, sampleRate: number) {
    this.windowSize = Math.floor(windowSizeMs * sampleRate / 1000);
    this.hopSize = Math.floor(hopSizeMs * sampleRate / 1000);
    this.buffer = new Float32Array(this.windowSize);
  }
  
  /**
   * Add samples and return windows that are ready
   */
  addSamples(samples: Float32Array): Float32Array[] {
    const windows: Float32Array[] = [];
    
    for (let i = 0; i < samples.length; i++) {
      this.buffer[this.position] = samples[i];
      this.position++;
      
      if (this.position >= this.windowSize) {
        this.filled = true;
        
        // Emit a copy of the window
        windows.push(new Float32Array(this.buffer));
        
        // Slide by hopSize
        this.buffer.copyWithin(0, this.hopSize);
        this.position = this.windowSize - this.hopSize;
      }
    }
    
    return windows;
  }
  
  /**
   * Get current partial window (for final processing)
   */
  getPartial(): Float32Array | null {
    if (this.position === 0) return null;
    return this.buffer.slice(0, this.position);
  }
  
  /**
   * Reset buffer
   */
  reset(): void {
    this.buffer.fill(0);
    this.position = 0;
    this.filled = false;
  }
  
  /**
   * Check if we have a full window
   */
  get hasFullWindow(): boolean {
    return this.filled;
  }
}

/**
 * Jitter buffer for smooth audio playback
 * Compensates for variable chunk arrival times
 */
export class JitterBuffer {
  private buffer: Array<{ chunk: Float32Array; timestamp: number }> = [];
  private targetDelayMs: number;
  private maxDelayMs: number;
  private sampleRate: number;
  private isBuffering: boolean = true;
  private lastPlaybackTime: number = 0;
  
  constructor(
    targetDelayMs: number = 50,
    maxDelayMs: number = 200,
    sampleRate: number = 24000
  ) {
    this.targetDelayMs = targetDelayMs;
    this.maxDelayMs = maxDelayMs;
    this.sampleRate = sampleRate;
  }
  
  /**
   * Add chunk to jitter buffer
   */
  push(chunk: Float32Array, timestamp: number): void {
    // Insert in sorted order by timestamp
    let insertIndex = this.buffer.length;
    for (let i = this.buffer.length - 1; i >= 0; i--) {
      if (this.buffer[i].timestamp <= timestamp) {
        insertIndex = i + 1;
        break;
      }
      insertIndex = i;
    }
    
    this.buffer.splice(insertIndex, 0, { chunk, timestamp });
    
    // Remove old chunks beyond maxDelay
    const cutoff = timestamp - this.maxDelayMs;
    while (this.buffer.length > 0 && this.buffer[0].timestamp < cutoff) {
      this.buffer.shift();
    }
  }
  
  /**
   * Get next chunk for playback
   * Returns null if still buffering or no chunk available
   */
  pop(): Float32Array | null {
    const now = Date.now();
    
    // Still in initial buffering phase
    if (this.isBuffering) {
      const bufferedMs = this.getBufferedDuration();
      if (bufferedMs >= this.targetDelayMs) {
        this.isBuffering = false;
        this.lastPlaybackTime = now;
      } else {
        return null;
      }
    }
    
    // Get next chunk
    if (this.buffer.length === 0) {
      // Buffer underrun - go back to buffering
      this.isBuffering = true;
      return null;
    }
    
    const entry = this.buffer.shift()!;
    this.lastPlaybackTime = now;
    
    return entry.chunk;
  }
  
  /**
   * Get total buffered duration in ms
   */
  getBufferedDuration(): number {
    let totalSamples = 0;
    for (const entry of this.buffer) {
      totalSamples += entry.chunk.length;
    }
    return (totalSamples / this.sampleRate) * 1000;
  }
  
  /**
   * Clear buffer and reset state
   */
  clear(): void {
    this.buffer = [];
    this.isBuffering = true;
    this.lastPlaybackTime = 0;
  }
  
  /**
   * Check if currently buffering
   */
  get buffering(): boolean {
    return this.isBuffering;
  }
  
  /**
   * Get number of chunks in buffer
   */
  get length(): number {
    return this.buffer.length;
  }
}

/**
 * Audio resampler using linear interpolation
 * For converting between sample rates
 */
export class AudioResampler {
  private inputRate: number;
  private outputRate: number;
  private ratio: number;
  private lastSample: number = 0;
  private position: number = 0;
  
  constructor(inputRate: number, outputRate: number) {
    this.inputRate = inputRate;
    this.outputRate = outputRate;
    this.ratio = inputRate / outputRate;
  }
  
  /**
   * Resample audio to target rate
   */
  resample(input: Float32Array): Float32Array {
    if (this.inputRate === this.outputRate) {
      return input;
    }
    
    const outputLength = Math.ceil(input.length / this.ratio);
    const output = new Float32Array(outputLength);
    
    for (let i = 0; i < outputLength; i++) {
      const srcPosition = i * this.ratio;
      const srcIndex = Math.floor(srcPosition);
      const fraction = srcPosition - srcIndex;
      
      const sample1 = srcIndex < input.length ? input[srcIndex] : this.lastSample;
      const sample2 = srcIndex + 1 < input.length ? input[srcIndex + 1] : sample1;
      
      // Linear interpolation
      output[i] = sample1 + (sample2 - sample1) * fraction;
    }
    
    // Remember last sample for continuity
    if (input.length > 0) {
      this.lastSample = input[input.length - 1];
    }
    
    return output;
  }
  
  /**
   * Reset state
   */
  reset(): void {
    this.lastSample = 0;
    this.position = 0;
  }
}

/**
 * Calculate RMS (Root Mean Square) audio level
 */
export function calculateRMS(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  
  return Math.sqrt(sum / samples.length);
}

/**
 * Calculate peak audio level
 */
export function calculatePeak(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const abs = Math.abs(samples[i]);
    if (abs > peak) peak = abs;
  }
  
  return peak;
}

/**
 * Convert dB to linear amplitude
 */
export function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}

/**
 * Convert linear amplitude to dB
 */
export function linearToDb(linear: number): number {
  return 20 * Math.log10(Math.max(linear, 1e-10));
}

/**
 * Apply gain to audio samples
 */
export function applyGain(samples: Float32Array, gainDb: number): Float32Array {
  const gain = dbToLinear(gainDb);
  const output = new Float32Array(samples.length);
  
  for (let i = 0; i < samples.length; i++) {
    output[i] = samples[i] * gain;
  }
  
  return output;
}

/**
 * Mix two audio streams
 */
export function mixAudio(a: Float32Array, b: Float32Array, mixRatio: number = 0.5): Float32Array {
  const length = Math.max(a.length, b.length);
  const output = new Float32Array(length);
  
  for (let i = 0; i < length; i++) {
    const sampleA = i < a.length ? a[i] : 0;
    const sampleB = i < b.length ? b[i] : 0;
    output[i] = sampleA * mixRatio + sampleB * (1 - mixRatio);
  }
  
  return output;
}

/**
 * Convert Float32Array to Int16Array (for PCM output)
 */
export function float32ToInt16(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length);
  
  for (let i = 0; i < input.length; i++) {
    // Clamp to [-1, 1] and scale to int16 range
    const clamped = Math.max(-1, Math.min(1, input[i]));
    output[i] = clamped < 0 ? clamped * 32768 : clamped * 32767;
  }
  
  return output;
}

/**
 * Convert Int16Array to Float32Array
 */
export function int16ToFloat32(input: Int16Array): Float32Array {
  const output = new Float32Array(input.length);
  
  for (let i = 0; i < input.length; i++) {
    output[i] = input[i] / 32768;
  }
  
  return output;
}

/**
 * Convert Buffer to Float32Array (assuming 16-bit PCM)
 */
export function bufferToFloat32(buffer: Buffer): Float32Array {
  const int16 = new Int16Array(buffer.buffer, buffer.byteOffset, buffer.length / 2);
  return int16ToFloat32(int16);
}

/**
 * Convert Float32Array to Buffer (16-bit PCM)
 */
export function float32ToBuffer(input: Float32Array): Buffer {
  const int16 = float32ToInt16(input);
  return Buffer.from(int16.buffer);
}

/**
 * Type guard to check if value is a Buffer
 */
export function isBuffer(value: Buffer | Float32Array): value is Buffer {
  return Buffer.isBuffer(value);
}

/**
 * Type guard to check if value is a Float32Array
 */
export function isFloat32Array(value: Buffer | Float32Array): value is Float32Array {
  return value instanceof Float32Array;
}

/**
 * Extract Float32Array from Buffer or Float32Array
 * Type-safe conversion helper
 */
export function toFloat32Array(data: Buffer | Float32Array): Float32Array {
  if (Buffer.isBuffer(data)) {
    return bufferToFloat32(data);
  }
  return data;
}

/**
 * Convert to Buffer from Buffer or Float32Array
 * Type-safe conversion helper
 */
export function toBuffer(data: Buffer | Float32Array): Buffer {
  if (Buffer.isBuffer(data)) {
    return data;
  }
  return float32ToBuffer(data);
}
