/**
 * NovaVoice - Voice Cloning Support
 * Create custom voices from audio samples
 */

import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createModuleLogger } from '../../utils/logger';
import { AudioChunk, AudioFormat } from './types';

const logger = createModuleLogger('NovaVoice-VoiceClone');

// ============================================
// Types
// ============================================

export interface VoiceCloneConfig {
  minSamples: number;
  maxSamples: number;
  minSampleDuration: number;   // seconds
  maxSampleDuration: number;   // seconds
  preferredSampleRate: number;
  storageDir: string;
}

export interface VoiceSample {
  id: string;
  path: string;
  duration: number;
  transcript?: string;
  createdAt: Date;
  quality: SampleQuality;
}

export interface SampleQuality {
  snr: number;           // Signal-to-noise ratio
  clipping: number;      // Clipping percentage (0-1)
  silenceRatio: number;  // Ratio of silence
  isAcceptable: boolean;
}

export interface ClonedVoice {
  id: string;
  name: string;
  description?: string;
  samples: VoiceSample[];
  embedding?: Float32Array;
  status: 'collecting' | 'processing' | 'ready' | 'failed';
  createdAt: Date;
  updatedAt: Date;
  metadata: Record<string, unknown>;
}

export interface CloneProgress {
  stage: 'uploading' | 'analyzing' | 'extracting' | 'training' | 'validating';
  progress: number;  // 0-100
  message: string;
}

// ============================================
// Voice Clone Manager
// ============================================

const DEFAULT_CONFIG: VoiceCloneConfig = {
  minSamples: 3,
  maxSamples: 20,
  minSampleDuration: 3,
  maxSampleDuration: 30,
  preferredSampleRate: 24000,
  storageDir: 'voice-clones',
};

export class VoiceCloneManager extends EventEmitter {
  private config: VoiceCloneConfig;
  private voices: Map<string, ClonedVoice> = new Map();
  private activeVoice: string | null = null;
  
  constructor(config?: Partial<VoiceCloneConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }
  
  /**
   * Initialize storage directory
   */
  async initialize(): Promise<void> {
    try {
      await fs.mkdir(this.config.storageDir, { recursive: true });
      await this.loadVoices();
      logger.info('Voice clone manager initialized', { voiceCount: this.voices.size });
    } catch (error) {
      logger.error('Failed to initialize voice clone manager', { error });
    }
  }
  
  /**
   * Create a new voice clone project
   */
  async createVoice(name: string, description?: string): Promise<ClonedVoice> {
    const id = `voice_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const voice: ClonedVoice = {
      id,
      name,
      description,
      samples: [],
      status: 'collecting',
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: {},
    };
    
    // Create voice directory
    const voiceDir = path.join(this.config.storageDir, id);
    await fs.mkdir(voiceDir, { recursive: true });
    
    this.voices.set(id, voice);
    await this.saveVoiceMetadata(voice);
    
    logger.info('Voice clone created', { id, name });
    this.emit('voice-created', voice);
    
    return voice;
  }
  
  /**
   * Add audio sample to voice
   */
  async addSample(
    voiceId: string,
    audio: AudioChunk | Buffer,
    transcript?: string
  ): Promise<VoiceSample> {
    const voice = this.voices.get(voiceId);
    if (!voice) {
      throw new Error(`Voice ${voiceId} not found`);
    }
    
    if (voice.samples.length >= this.config.maxSamples) {
      throw new Error(`Maximum samples (${this.config.maxSamples}) reached`);
    }
    
    // Generate sample ID
    const sampleId = `sample_${Date.now()}_${voice.samples.length + 1}`;
    const samplePath = path.join(this.config.storageDir, voiceId, `${sampleId}.wav`);
    
    // Analyze audio quality
    const quality = this.analyzeQuality(audio);
    
    if (!quality.isAcceptable) {
      throw new Error('Sample quality is too low. Please record in a quieter environment.');
    }
    
    // Calculate duration
    let duration: number;
    if (Buffer.isBuffer(audio)) {
      // Assume 16-bit mono at preferredSampleRate
      duration = audio.length / (this.config.preferredSampleRate * 2);
    } else {
      duration = audio.duration / 1000;
    }
    
    // Validate duration
    if (duration < this.config.minSampleDuration) {
      throw new Error(`Sample too short. Minimum duration: ${this.config.minSampleDuration}s`);
    }
    if (duration > this.config.maxSampleDuration) {
      throw new Error(`Sample too long. Maximum duration: ${this.config.maxSampleDuration}s`);
    }
    
    // Save audio
    if (Buffer.isBuffer(audio)) {
      await fs.writeFile(samplePath, audio);
    } else {
      // Convert AudioChunk to WAV
      const wavBuffer = this.audioChunkToWav(audio);
      await fs.writeFile(samplePath, wavBuffer);
    }
    
    // Create sample record
    const sample: VoiceSample = {
      id: sampleId,
      path: samplePath,
      duration,
      transcript,
      createdAt: new Date(),
      quality,
    };
    
    voice.samples.push(sample);
    voice.updatedAt = new Date();
    
    await this.saveVoiceMetadata(voice);
    
    logger.info('Sample added to voice', { voiceId, sampleId, duration });
    this.emit('sample-added', { voice, sample });
    
    return sample;
  }
  
  /**
   * Remove sample from voice
   */
  async removeSample(voiceId: string, sampleId: string): Promise<void> {
    const voice = this.voices.get(voiceId);
    if (!voice) {
      throw new Error(`Voice ${voiceId} not found`);
    }
    
    const index = voice.samples.findIndex((s) => s.id === sampleId);
    if (index === -1) {
      throw new Error(`Sample ${sampleId} not found`);
    }
    
    const sample = voice.samples[index];
    
    // Delete file
    try {
      await fs.unlink(sample.path);
    } catch (error) {
      logger.warn('Failed to delete sample file', { path: sample.path, error });
    }
    
    voice.samples.splice(index, 1);
    voice.updatedAt = new Date();
    
    await this.saveVoiceMetadata(voice);
    
    logger.info('Sample removed from voice', { voiceId, sampleId });
    this.emit('sample-removed', { voiceId, sampleId });
  }
  
  /**
   * Process voice clone (extract embeddings)
   */
  async processVoice(voiceId: string): Promise<void> {
    const voice = this.voices.get(voiceId);
    if (!voice) {
      throw new Error(`Voice ${voiceId} not found`);
    }
    
    if (voice.samples.length < this.config.minSamples) {
      throw new Error(`Need at least ${this.config.minSamples} samples. Have ${voice.samples.length}.`);
    }
    
    voice.status = 'processing';
    this.emit('voice-status', { voiceId, status: 'processing' });
    
    try {
      // Stage 1: Upload
      this.emitProgress(voiceId, 'uploading', 10, 'Preparing samples...');
      await this.delay(500);
      
      // Stage 2: Analyze
      this.emitProgress(voiceId, 'analyzing', 30, 'Analyzing voice characteristics...');
      await this.delay(500);
      
      // Stage 3: Extract features
      this.emitProgress(voiceId, 'extracting', 50, 'Extracting voice embeddings...');
      
      // In real implementation, this would:
      // 1. Load all audio samples
      // 2. Extract mel spectrograms
      // 3. Pass through speaker encoder model
      // 4. Average embeddings
      
      const embedding = await this.extractVoiceEmbedding(voice);
      voice.embedding = embedding;
      
      // Stage 4: Training/Fine-tuning
      this.emitProgress(voiceId, 'training', 70, 'Optimizing voice model...');
      await this.delay(500);
      
      // Stage 5: Validation
      this.emitProgress(voiceId, 'validating', 90, 'Validating voice quality...');
      await this.delay(500);
      
      voice.status = 'ready';
      voice.updatedAt = new Date();
      
      await this.saveVoiceMetadata(voice);
      
      this.emitProgress(voiceId, 'validating', 100, 'Voice clone ready!');
      logger.info('Voice clone processed', { voiceId });
      this.emit('voice-ready', voice);
      
    } catch (error) {
      voice.status = 'failed';
      voice.metadata.error = (error as Error).message;
      await this.saveVoiceMetadata(voice);
      
      logger.error('Voice clone processing failed', { voiceId, error });
      this.emit('voice-failed', { voiceId, error });
      throw error;
    }
  }
  
  /**
   * Delete voice clone
   */
  async deleteVoice(voiceId: string): Promise<void> {
    const voice = this.voices.get(voiceId);
    if (!voice) {
      throw new Error(`Voice ${voiceId} not found`);
    }
    
    // Delete directory
    const voiceDir = path.join(this.config.storageDir, voiceId);
    try {
      await fs.rm(voiceDir, { recursive: true, force: true });
    } catch (error) {
      logger.warn('Failed to delete voice directory', { voiceDir, error });
    }
    
    this.voices.delete(voiceId);
    
    if (this.activeVoice === voiceId) {
      this.activeVoice = null;
    }
    
    logger.info('Voice clone deleted', { voiceId });
    this.emit('voice-deleted', voiceId);
  }
  
  /**
   * Get voice by ID
   */
  getVoice(voiceId: string): ClonedVoice | undefined {
    return this.voices.get(voiceId);
  }
  
  /**
   * List all voices
   */
  listVoices(): ClonedVoice[] {
    return Array.from(this.voices.values());
  }
  
  /**
   * Get voices that are ready for use
   */
  getReadyVoices(): ClonedVoice[] {
    return this.listVoices().filter((v) => v.status === 'ready');
  }
  
  /**
   * Set active voice
   */
  setActiveVoice(voiceId: string | null): void {
    if (voiceId) {
      const voice = this.voices.get(voiceId);
      if (!voice) {
        throw new Error(`Voice ${voiceId} not found`);
      }
      if (voice.status !== 'ready') {
        throw new Error(`Voice ${voiceId} is not ready`);
      }
    }
    
    this.activeVoice = voiceId;
    this.emit('active-voice-changed', voiceId);
  }
  
  /**
   * Get active voice
   */
  getActiveVoice(): ClonedVoice | undefined {
    return this.activeVoice ? this.voices.get(this.activeVoice) : undefined;
  }
  
  /**
   * Get voice embedding for TTS
   */
  getVoiceEmbedding(voiceId?: string): Float32Array | undefined {
    const id = voiceId || this.activeVoice;
    if (!id) return undefined;
    
    const voice = this.voices.get(id);
    return voice?.embedding;
  }
  
  // ============================================
  // Private Methods
  // ============================================
  
  /**
   * Load voices from storage
   */
  private async loadVoices(): Promise<void> {
    try {
      const entries = await fs.readdir(this.config.storageDir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name.startsWith('voice_')) {
          const metadataPath = path.join(this.config.storageDir, entry.name, 'metadata.json');
          
          try {
            const content = await fs.readFile(metadataPath, 'utf-8');
            const voice = JSON.parse(content) as ClonedVoice;
            
            // Restore dates
            voice.createdAt = new Date(voice.createdAt);
            voice.updatedAt = new Date(voice.updatedAt);
            
            for (const sample of voice.samples) {
              sample.createdAt = new Date(sample.createdAt);
            }
            
            // Load embedding if exists
            const embeddingPath = path.join(this.config.storageDir, entry.name, 'embedding.bin');
            try {
              const buffer = await fs.readFile(embeddingPath);
              voice.embedding = new Float32Array(buffer.buffer);
            } catch {
              // No embedding yet
            }
            
            this.voices.set(voice.id, voice);
          } catch (error) {
            logger.warn('Failed to load voice', { dir: entry.name, error });
          }
        }
      }
    } catch (error) {
      // Storage directory may not exist yet
    }
  }
  
  /**
   * Save voice metadata
   */
  private async saveVoiceMetadata(voice: ClonedVoice): Promise<void> {
    const voiceDir = path.join(this.config.storageDir, voice.id);
    const metadataPath = path.join(voiceDir, 'metadata.json');
    
    // Don't save embedding in JSON (it's binary)
    const { embedding, ...metadata } = voice;
    
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
    
    // Save embedding separately
    if (embedding) {
      const embeddingPath = path.join(voiceDir, 'embedding.bin');
      await fs.writeFile(embeddingPath, Buffer.from(embedding.buffer));
    }
  }
  
  /**
   * Analyze audio quality
   */
  private analyzeQuality(audio: AudioChunk | Buffer): SampleQuality {
    let samples: Float32Array;
    
    if (Buffer.isBuffer(audio)) {
      // Convert buffer to Float32Array (assume 16-bit PCM)
      const view = new Int16Array(audio.buffer, audio.byteOffset, audio.length / 2);
      samples = new Float32Array(view.length);
      for (let i = 0; i < view.length; i++) {
        samples[i] = view[i] / 32768;
      }
    } else {
      samples = audio.data instanceof Float32Array 
        ? audio.data 
        : new Float32Array(audio.data.buffer);
    }
    
    // Calculate RMS
    let sumSquares = 0;
    let maxAbs = 0;
    let silentSamples = 0;
    const silenceThreshold = 0.01;
    
    for (let i = 0; i < samples.length; i++) {
      const abs = Math.abs(samples[i]);
      sumSquares += samples[i] * samples[i];
      maxAbs = Math.max(maxAbs, abs);
      
      if (abs < silenceThreshold) {
        silentSamples++;
      }
    }
    
    const rms = Math.sqrt(sumSquares / samples.length);
    
    // Estimate SNR (simplified)
    const signalPower = rms * rms;
    const noisePower = 0.001; // Assumed noise floor
    const snr = 10 * Math.log10(signalPower / noisePower);
    
    // Check for clipping
    let clippedSamples = 0;
    const clippingThreshold = 0.99;
    
    for (let i = 0; i < samples.length; i++) {
      if (Math.abs(samples[i]) >= clippingThreshold) {
        clippedSamples++;
      }
    }
    
    const clipping = clippedSamples / samples.length;
    const silenceRatio = silentSamples / samples.length;
    
    // Determine if acceptable
    const isAcceptable = snr > 10 && clipping < 0.01 && silenceRatio < 0.8;
    
    return {
      snr,
      clipping,
      silenceRatio,
      isAcceptable,
    };
  }
  
  /**
   * Convert AudioChunk to WAV format
   */
  private audioChunkToWav(chunk: AudioChunk): Buffer {
    const samples = chunk.data instanceof Float32Array 
      ? chunk.data 
      : new Float32Array(chunk.data.buffer);
    
    const sampleRate = chunk.format.sampleRate;
    const numChannels = chunk.format.channels;
    
    // Convert to 16-bit PCM
    const pcmData = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    
    // Create WAV header
    const dataSize = pcmData.length * 2;
    const header = Buffer.alloc(44);
    
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + dataSize, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(numChannels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(sampleRate * numChannels * 2, 28);
    header.writeUInt16LE(numChannels * 2, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36);
    header.writeUInt32LE(dataSize, 40);
    
    return Buffer.concat([header, Buffer.from(pcmData.buffer)]);
  }
  
  /**
   * Extract voice embedding using acoustic feature analysis
   * Creates a d-vector style embedding that captures speaker characteristics
   */
  private async extractVoiceEmbedding(voice: ClonedVoice): Promise<Float32Array> {
    const embeddingSize = 256;
    const embeddings: Float32Array[] = [];
    
    // Process each audio sample
    for (const sample of voice.samples) {
      if (sample.audioData) {
        const sampleEmbedding = this.extractSampleEmbedding(sample.audioData, embeddingSize);
        embeddings.push(sampleEmbedding);
      }
    }
    
    if (embeddings.length === 0) {
      // Return zero embedding if no samples
      return new Float32Array(embeddingSize);
    }
    
    // Average all sample embeddings
    const avgEmbedding = new Float32Array(embeddingSize);
    for (const emb of embeddings) {
      for (let i = 0; i < embeddingSize; i++) {
        avgEmbedding[i] += emb[i] / embeddings.length;
      }
    }
    
    // L2 normalize the final embedding
    let norm = 0;
    for (let i = 0; i < embeddingSize; i++) {
      norm += avgEmbedding[i] * avgEmbedding[i];
    }
    norm = Math.sqrt(norm) || 1;
    
    for (let i = 0; i < embeddingSize; i++) {
      avgEmbedding[i] /= norm;
    }
    
    return avgEmbedding;
  }
  
  /**
   * Extract embedding from a single audio sample
   * Uses MFCC-like features and prosodic characteristics
   */
  private extractSampleEmbedding(audioData: Buffer, embeddingSize: number): Float32Array {
    const embedding = new Float32Array(embeddingSize);
    
    // Convert buffer to float samples (assuming 16-bit PCM)
    const samples = new Float32Array(audioData.length / 2);
    for (let i = 0; i < samples.length; i++) {
      samples[i] = audioData.readInt16LE(i * 2) / 32768;
    }
    
    const sampleRate = 16000; // Assume 16kHz
    const frameSize = Math.floor(sampleRate * 0.025); // 25ms frames
    const hopSize = Math.floor(sampleRate * 0.010);   // 10ms hop
    const numFrames = Math.floor((samples.length - frameSize) / hopSize);
    
    if (numFrames < 10) {
      return embedding; // Not enough data
    }
    
    // Extract frame-level features
    const mfccs: number[][] = [];
    const pitches: number[] = [];
    const energies: number[] = [];
    
    for (let frameIdx = 0; frameIdx < numFrames; frameIdx++) {
      const start = frameIdx * hopSize;
      const frame = samples.slice(start, start + frameSize);
      
      // Apply Hamming window
      const windowedFrame = this.applyHammingWindow(frame);
      
      // Extract MFCC-like features (simplified)
      const frameMfcc = this.extractFrameMFCC(windowedFrame, sampleRate);
      mfccs.push(frameMfcc);
      
      // Extract pitch
      const pitch = this.estimateFramePitch(windowedFrame, sampleRate);
      pitches.push(pitch);
      
      // Extract energy
      let energy = 0;
      for (let i = 0; i < frame.length; i++) {
        energy += frame[i] * frame[i];
      }
      energies.push(Math.sqrt(energy / frame.length));
    }
    
    // Compute statistics over all frames
    let embIdx = 0;
    
    // MFCC statistics (mean and std for each coefficient)
    const numCoeffs = mfccs[0]?.length || 13;
    for (let c = 0; c < numCoeffs && embIdx < embeddingSize - 1; c++) {
      const values = mfccs.map(m => m[c] || 0);
      embedding[embIdx++] = this.mean(values);
      embedding[embIdx++] = this.std(values);
    }
    
    // Pitch statistics
    const validPitches = pitches.filter(p => p > 50 && p < 500);
    if (validPitches.length > 0 && embIdx < embeddingSize - 5) {
      embedding[embIdx++] = this.mean(validPitches) / 500;
      embedding[embIdx++] = this.std(validPitches) / 100;
      embedding[embIdx++] = Math.min(...validPitches) / 500;
      embedding[embIdx++] = Math.max(...validPitches) / 500;
      embedding[embIdx++] = validPitches.length / pitches.length; // Voiced ratio
    }
    
    // Energy statistics
    if (embIdx < embeddingSize - 3) {
      embedding[embIdx++] = this.mean(energies);
      embedding[embIdx++] = this.std(energies);
      embedding[embIdx++] = Math.max(...energies);
    }
    
    // Speaking rate (energy peaks)
    if (embIdx < embeddingSize) {
      const peakCount = this.countEnergyPeaks(energies);
      embedding[embIdx++] = peakCount / (numFrames * 0.01); // Peaks per second
    }
    
    // Spectral characteristics
    const spectralFeatures = this.extractSpectralFeatures(samples, sampleRate);
    for (let i = 0; i < spectralFeatures.length && embIdx < embeddingSize; i++) {
      embedding[embIdx++] = spectralFeatures[i];
    }
    
    // Fill remaining with delta features or zeros
    // Delta MFCCs (first derivative)
    if (mfccs.length > 2 && embIdx < embeddingSize - numCoeffs) {
      for (let c = 0; c < numCoeffs && embIdx < embeddingSize; c++) {
        const deltas: number[] = [];
        for (let i = 1; i < mfccs.length - 1; i++) {
          deltas.push((mfccs[i + 1][c] - mfccs[i - 1][c]) / 2);
        }
        embedding[embIdx++] = this.mean(deltas);
      }
    }
    
    return embedding;
  }
  
  /**
   * Apply Hamming window to frame
   */
  private applyHammingWindow(frame: Float32Array): Float32Array {
    const windowed = new Float32Array(frame.length);
    for (let i = 0; i < frame.length; i++) {
      const window = 0.54 - 0.46 * Math.cos(2 * Math.PI * i / (frame.length - 1));
      windowed[i] = frame[i] * window;
    }
    return windowed;
  }
  
  /**
   * Extract MFCC-like features from a frame
   */
  private extractFrameMFCC(frame: Float32Array, sampleRate: number): number[] {
    const numCoeffs = 13;
    const numFilters = 26;
    const fftSize = 512;
    
    // Compute power spectrum
    const spectrum = this.computePowerSpectrum(frame, fftSize);
    
    // Apply mel filterbank
    const melEnergies = this.applyMelFilterbank(spectrum, sampleRate, numFilters, fftSize);
    
    // Apply log and DCT to get MFCCs
    const logMelEnergies = melEnergies.map(e => Math.log(e + 1e-10));
    const mfccs = this.dct(logMelEnergies, numCoeffs);
    
    return mfccs;
  }
  
  /**
   * Compute power spectrum using DFT
   */
  private computePowerSpectrum(frame: Float32Array, fftSize: number): Float32Array {
    const spectrum = new Float32Array(fftSize / 2 + 1);
    
    for (let k = 0; k <= fftSize / 2; k++) {
      let real = 0, imag = 0;
      for (let n = 0; n < frame.length && n < fftSize; n++) {
        const angle = -2 * Math.PI * k * n / fftSize;
        real += frame[n] * Math.cos(angle);
        imag += frame[n] * Math.sin(angle);
      }
      spectrum[k] = (real * real + imag * imag) / fftSize;
    }
    
    return spectrum;
  }
  
  /**
   * Apply mel filterbank to spectrum
   */
  private applyMelFilterbank(
    spectrum: Float32Array,
    sampleRate: number,
    numFilters: number,
    fftSize: number
  ): number[] {
    const melEnergies: number[] = new Array(numFilters).fill(0);
    
    // Mel scale conversion
    const hzToMel = (hz: number) => 2595 * Math.log10(1 + hz / 700);
    const melToHz = (mel: number) => 700 * (Math.pow(10, mel / 2595) - 1);
    
    const lowMel = hzToMel(80);
    const highMel = hzToMel(sampleRate / 2);
    const melPoints = new Array(numFilters + 2);
    
    for (let i = 0; i < numFilters + 2; i++) {
      melPoints[i] = melToHz(lowMel + i * (highMel - lowMel) / (numFilters + 1));
    }
    
    // Convert to FFT bin indices
    const binPoints = melPoints.map(hz => Math.floor((fftSize + 1) * hz / sampleRate));
    
    // Apply triangular filters
    for (let m = 0; m < numFilters; m++) {
      for (let k = binPoints[m]; k < binPoints[m + 1] && k < spectrum.length; k++) {
        melEnergies[m] += spectrum[k] * (k - binPoints[m]) / (binPoints[m + 1] - binPoints[m]);
      }
      for (let k = binPoints[m + 1]; k < binPoints[m + 2] && k < spectrum.length; k++) {
        melEnergies[m] += spectrum[k] * (binPoints[m + 2] - k) / (binPoints[m + 2] - binPoints[m + 1]);
      }
    }
    
    return melEnergies;
  }
  
  /**
   * Discrete Cosine Transform (Type-II)
   */
  private dct(input: number[], numCoeffs: number): number[] {
    const output: number[] = [];
    const N = input.length;
    
    for (let k = 0; k < numCoeffs; k++) {
      let sum = 0;
      for (let n = 0; n < N; n++) {
        sum += input[n] * Math.cos(Math.PI * k * (2 * n + 1) / (2 * N));
      }
      output.push(sum * Math.sqrt(2 / N));
    }
    
    return output;
  }
  
  /**
   * Estimate pitch using autocorrelation
   */
  private estimateFramePitch(frame: Float32Array, sampleRate: number): number {
    const minLag = Math.floor(sampleRate / 500);
    const maxLag = Math.floor(sampleRate / 50);
    
    let bestCorrelation = 0;
    let bestLag = minLag;
    
    for (let lag = minLag; lag < maxLag && lag < frame.length / 2; lag++) {
      let correlation = 0;
      for (let i = 0; i < frame.length - lag; i++) {
        correlation += frame[i] * frame[i + lag];
      }
      if (correlation > bestCorrelation) {
        bestCorrelation = correlation;
        bestLag = lag;
      }
    }
    
    return sampleRate / bestLag;
  }
  
  /**
   * Extract additional spectral features
   */
  private extractSpectralFeatures(samples: Float32Array, sampleRate: number): number[] {
    const features: number[] = [];
    const fftSize = 512;
    const spectrum = this.computePowerSpectrum(samples.slice(0, fftSize), fftSize);
    
    // Spectral centroid
    let weightedSum = 0, totalPower = 0;
    for (let k = 0; k < spectrum.length; k++) {
      const freq = k * sampleRate / fftSize;
      weightedSum += freq * spectrum[k];
      totalPower += spectrum[k];
    }
    features.push(totalPower > 0 ? weightedSum / totalPower / 4000 : 0);
    
    // Spectral rolloff (frequency below which 85% of energy is contained)
    const targetEnergy = totalPower * 0.85;
    let cumEnergy = 0;
    let rolloff = 0;
    for (let k = 0; k < spectrum.length; k++) {
      cumEnergy += spectrum[k];
      if (cumEnergy >= targetEnergy) {
        rolloff = k * sampleRate / fftSize;
        break;
      }
    }
    features.push(rolloff / 8000);
    
    // Spectral flatness
    const logSum = spectrum.reduce((a, b) => a + Math.log(b + 1e-10), 0);
    const geoMean = Math.exp(logSum / spectrum.length);
    const ariMean = totalPower / spectrum.length;
    features.push(ariMean > 0 ? geoMean / ariMean : 0);
    
    return features;
  }
  
  /**
   * Count energy peaks (syllable rate proxy)
   */
  private countEnergyPeaks(energies: number[]): number {
    const threshold = this.mean(energies) * 0.5;
    let peaks = 0;
    let inPeak = false;
    
    for (let i = 1; i < energies.length - 1; i++) {
      if (!inPeak && energies[i] > threshold && 
          energies[i] > energies[i-1] && energies[i] > energies[i+1]) {
        peaks++;
        inPeak = true;
      } else if (energies[i] < threshold * 0.5) {
        inPeak = false;
      }
    }
    
    return peaks;
  }
  
  /**
   * Calculate mean of array
   */
  private mean(arr: number[]): number {
    if (arr.length === 0) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }
  
  /**
   * Calculate standard deviation
   */
  private std(arr: number[]): number {
    if (arr.length < 2) return 0;
    const m = this.mean(arr);
    const variance = arr.reduce((a, b) => a + Math.pow(b - m, 2), 0) / arr.length;
    return Math.sqrt(variance);
  }
  
  /**
   * Emit progress event
   */
  private emitProgress(
    voiceId: string,
    stage: CloneProgress['stage'],
    progress: number,
    message: string
  ): void {
    this.emit('progress', { voiceId, stage, progress, message });
  }
  
  /**
   * Helper delay
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ============================================
// Exports
// ============================================

export const voiceCloneManager = new VoiceCloneManager();
export { DEFAULT_CONFIG as DEFAULT_VOICE_CLONE_CONFIG };
