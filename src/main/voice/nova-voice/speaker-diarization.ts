/**
 * NovaVoice - Speaker Diarization
 * Identify and track different speakers in audio
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../../utils/logger';
import { AudioChunk, StreamingTranscription } from './types';

// Type alias for backward compatibility
type TranscriptionResult = StreamingTranscription;

const logger = createModuleLogger('NovaVoice-Diarization');

// ============================================
// Types
// ============================================

export interface Speaker {
  id: string;
  name?: string;
  color?: string;
  embedding?: Float32Array;
  sampleCount: number;
  totalSpeakingTime: number; // ms
  firstSeen: number;         // timestamp
  lastSeen: number;          // timestamp
  confidence: number;
}

export interface SpeakerSegment {
  speakerId: string;
  start: number;      // ms
  end: number;        // ms
  confidence: number;
  text?: string;
}

export interface DiarizationResult {
  segments: SpeakerSegment[];
  speakers: Speaker[];
  dominantSpeaker: string | null;
  turnCount: number;
  totalDuration: number;
}

export interface DiarizationConfig {
  minSpeakers: number;
  maxSpeakers: number;
  minSegmentDuration: number;     // ms
  embedDimension: number;
  similarityThreshold: number;    // 0-1 for matching speakers
  windowSize: number;             // ms
  hopSize: number;                // ms
  enableVoicePrint: boolean;
}

// ============================================
// Speaker Embedder - MFCC and Prosodic Features
// ============================================

class SpeakerEmbedder {
  private embedDimension: number;
  private sampleRate: number;
  private frameSize: number;
  private hopSize: number;
  private numMfcc: number;
  private numFilters: number;
  
  constructor(embedDimension = 256, sampleRate = 16000) {
    this.embedDimension = embedDimension;
    this.sampleRate = sampleRate;
    this.frameSize = Math.floor(sampleRate * 0.025); // 25ms
    this.hopSize = Math.floor(sampleRate * 0.010);   // 10ms
    this.numMfcc = 13;
    this.numFilters = 26;
  }
  
  /**
   * Extract speaker embedding from audio using MFCC and prosodic features
   * Creates a discriminative representation for speaker identification
   */
  extractEmbedding(audio: Float32Array): Float32Array {
    const embedding = new Float32Array(this.embedDimension);
    
    if (audio.length < this.frameSize * 2) {
      return embedding; // Not enough data
    }
    
    // Extract frame-level features
    const mfccs: number[][] = [];
    const pitches: number[] = [];
    const energies: number[] = [];
    const zcrs: number[] = [];
    
    const numFrames = Math.floor((audio.length - this.frameSize) / this.hopSize);
    
    for (let frameIdx = 0; frameIdx < numFrames; frameIdx++) {
      const start = frameIdx * this.hopSize;
      const frame = audio.slice(start, start + this.frameSize);
      
      // Apply Hamming window
      const windowedFrame = this.applyWindow(frame);
      
      // Extract MFCCs
      const frameMfcc = this.extractMFCC(windowedFrame);
      mfccs.push(frameMfcc);
      
      // Extract pitch
      pitches.push(this.estimatePitch(windowedFrame));
      
      // Extract energy
      energies.push(this.computeEnergy(frame));
      
      // Extract ZCR
      zcrs.push(this.computeZCR(frame));
    }
    
    let embIdx = 0;
    
    // MFCC statistics (mean, std, skewness, kurtosis for each coefficient)
    for (let c = 0; c < this.numMfcc && embIdx < this.embedDimension - 3; c++) {
      const values = mfccs.map(m => m[c] || 0);
      embedding[embIdx++] = this.mean(values);
      embedding[embIdx++] = this.std(values);
      embedding[embIdx++] = this.skewness(values);
      embedding[embIdx++] = this.kurtosis(values);
    }
    
    // Delta MFCCs (velocity)
    if (mfccs.length > 2 && embIdx < this.embedDimension - this.numMfcc * 2) {
      for (let c = 0; c < this.numMfcc && embIdx < this.embedDimension - 1; c++) {
        const deltas: number[] = [];
        for (let i = 1; i < mfccs.length - 1; i++) {
          deltas.push((mfccs[i + 1][c] - mfccs[i - 1][c]) / 2);
        }
        embedding[embIdx++] = this.mean(deltas);
        embedding[embIdx++] = this.std(deltas);
      }
    }
    
    // Delta-delta MFCCs (acceleration)
    if (mfccs.length > 4 && embIdx < this.embedDimension - this.numMfcc * 2) {
      for (let c = 0; c < this.numMfcc && embIdx < this.embedDimension - 1; c++) {
        const deltas: number[] = [];
        for (let i = 1; i < mfccs.length - 1; i++) {
          deltas.push((mfccs[i + 1][c] - mfccs[i - 1][c]) / 2);
        }
        const deltaDeltas: number[] = [];
        for (let i = 1; i < deltas.length - 1; i++) {
          deltaDeltas.push((deltas[i + 1] - deltas[i - 1]) / 2);
        }
        if (deltaDeltas.length > 0) {
          embedding[embIdx++] = this.mean(deltaDeltas);
          embedding[embIdx++] = this.std(deltaDeltas);
        }
      }
    }
    
    // Pitch statistics (F0)
    const validPitches = pitches.filter(p => p > 50 && p < 500);
    if (validPitches.length > 0 && embIdx < this.embedDimension - 6) {
      embedding[embIdx++] = this.mean(validPitches) / 500;
      embedding[embIdx++] = this.std(validPitches) / 100;
      embedding[embIdx++] = this.percentile(validPitches, 10) / 500;
      embedding[embIdx++] = this.percentile(validPitches, 90) / 500;
      embedding[embIdx++] = validPitches.length / pitches.length; // Voiced ratio
      embedding[embIdx++] = this.jitter(validPitches);
    }
    
    // Energy statistics
    if (embIdx < this.embedDimension - 4) {
      embedding[embIdx++] = this.mean(energies);
      embedding[embIdx++] = this.std(energies);
      embedding[embIdx++] = this.percentile(energies, 10);
      embedding[embIdx++] = this.percentile(energies, 90);
    }
    
    // ZCR statistics
    if (embIdx < this.embedDimension - 2) {
      embedding[embIdx++] = this.mean(zcrs);
      embedding[embIdx++] = this.std(zcrs);
    }
    
    // Spectral features
    const spectralFeatures = this.extractSpectralStatistics(audio);
    for (const feat of spectralFeatures) {
      if (embIdx < this.embedDimension) {
        embedding[embIdx++] = feat;
      }
    }
    
    // Speaking rate (syllable-like units)
    if (embIdx < this.embedDimension) {
      const speakingRate = this.estimateSpeakingRate(energies);
      embedding[embIdx++] = speakingRate / 10;
    }
    
    // Long-term spectral variability
    if (embIdx < this.embedDimension - 2) {
      const ltsv = this.computeLTSV(mfccs);
      embedding[embIdx++] = ltsv.mean;
      embedding[embIdx++] = ltsv.std;
    }
    
    // L2 normalize
    let norm = 0;
    for (let i = 0; i < this.embedDimension; i++) {
      norm += embedding[i] * embedding[i];
    }
    norm = Math.sqrt(norm) || 1;
    
    for (let i = 0; i < this.embedDimension; i++) {
      embedding[i] /= norm;
    }
    
    return embedding;
  }
  
  /**
   * Apply Hamming window
   */
  private applyWindow(frame: Float32Array): Float32Array {
    const windowed = new Float32Array(frame.length);
    for (let i = 0; i < frame.length; i++) {
      const w = 0.54 - 0.46 * Math.cos(2 * Math.PI * i / (frame.length - 1));
      windowed[i] = frame[i] * w;
    }
    return windowed;
  }
  
  /**
   * Extract MFCC features
   */
  private extractMFCC(frame: Float32Array): number[] {
    const fftSize = 512;
    const spectrum = this.computePowerSpectrum(frame, fftSize);
    const melEnergies = this.applyMelFilterbank(spectrum, fftSize);
    const logMel = melEnergies.map(e => Math.log(e + 1e-10));
    return this.dct(logMel, this.numMfcc);
  }
  
  /**
   * Compute power spectrum
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
   * Apply mel filterbank
   */
  private applyMelFilterbank(spectrum: Float32Array, fftSize: number): number[] {
    const melEnergies: number[] = new Array(this.numFilters).fill(0);
    
    const hzToMel = (hz: number) => 2595 * Math.log10(1 + hz / 700);
    const melToHz = (mel: number) => 700 * (Math.pow(10, mel / 2595) - 1);
    
    const lowMel = hzToMel(80);
    const highMel = hzToMel(this.sampleRate / 2);
    const melPoints: number[] = [];
    
    for (let i = 0; i < this.numFilters + 2; i++) {
      melPoints.push(melToHz(lowMel + i * (highMel - lowMel) / (this.numFilters + 1)));
    }
    
    const binPoints = melPoints.map(hz => Math.floor((fftSize + 1) * hz / this.sampleRate));
    
    for (let m = 0; m < this.numFilters; m++) {
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
   * DCT Type-II
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
  private estimatePitch(frame: Float32Array): number {
    const minLag = Math.floor(this.sampleRate / 500);
    const maxLag = Math.floor(this.sampleRate / 50);
    
    let bestCorr = 0, bestLag = minLag;
    
    for (let lag = minLag; lag < maxLag && lag < frame.length / 2; lag++) {
      let corr = 0;
      for (let i = 0; i < frame.length - lag; i++) {
        corr += frame[i] * frame[i + lag];
      }
      if (corr > bestCorr) {
        bestCorr = corr;
        bestLag = lag;
      }
    }
    
    return this.sampleRate / bestLag;
  }
  
  /**
   * Compute frame energy
   */
  private computeEnergy(frame: Float32Array): number {
    let energy = 0;
    for (let i = 0; i < frame.length; i++) {
      energy += frame[i] * frame[i];
    }
    return Math.sqrt(energy / frame.length);
  }
  
  /**
   * Compute zero crossing rate
   */
  private computeZCR(frame: Float32Array): number {
    let zcr = 0;
    for (let i = 1; i < frame.length; i++) {
      if ((frame[i] >= 0) !== (frame[i - 1] >= 0)) {
        zcr++;
      }
    }
    return zcr / frame.length;
  }
  
  /**
   * Extract spectral statistics
   */
  private extractSpectralStatistics(audio: Float32Array): number[] {
    const features: number[] = [];
    const fftSize = 512;
    const spectrum = this.computePowerSpectrum(audio.slice(0, Math.min(audio.length, fftSize)), fftSize);
    
    // Spectral centroid
    let wSum = 0, tPower = 0;
    for (let k = 0; k < spectrum.length; k++) {
      const freq = k * this.sampleRate / fftSize;
      wSum += freq * spectrum[k];
      tPower += spectrum[k];
    }
    features.push(tPower > 0 ? wSum / tPower / 4000 : 0);
    
    // Spectral spread
    const centroid = tPower > 0 ? wSum / tPower : 0;
    let spreadSum = 0;
    for (let k = 0; k < spectrum.length; k++) {
      const freq = k * this.sampleRate / fftSize;
      spreadSum += spectrum[k] * Math.pow(freq - centroid, 2);
    }
    features.push(tPower > 0 ? Math.sqrt(spreadSum / tPower) / 2000 : 0);
    
    // Spectral rolloff
    const targetEnergy = tPower * 0.85;
    let cumEnergy = 0, rolloff = 0;
    for (let k = 0; k < spectrum.length; k++) {
      cumEnergy += spectrum[k];
      if (cumEnergy >= targetEnergy) {
        rolloff = k * this.sampleRate / fftSize;
        break;
      }
    }
    features.push(rolloff / 8000);
    
    // Spectral flatness
    const logSum = spectrum.reduce((a, b) => a + Math.log(b + 1e-10), 0);
    const geoMean = Math.exp(logSum / spectrum.length);
    const ariMean = tPower / spectrum.length;
    features.push(ariMean > 0 ? geoMean / ariMean : 0);
    
    return features;
  }
  
  /**
   * Estimate speaking rate from energy contour
   */
  private estimateSpeakingRate(energies: number[]): number {
    if (energies.length < 10) return 4;
    
    const threshold = this.mean(energies) * 0.5;
    let peaks = 0, inPeak = false;
    
    for (let i = 1; i < energies.length - 1; i++) {
      if (!inPeak && energies[i] > threshold && 
          energies[i] > energies[i-1] && energies[i] > energies[i+1]) {
        peaks++;
        inPeak = true;
      } else if (energies[i] < threshold * 0.5) {
        inPeak = false;
      }
    }
    
    const durationSec = energies.length * 0.01; // 10ms per frame
    return peaks / durationSec;
  }
  
  /**
   * Compute long-term spectral variability
   */
  private computeLTSV(mfccs: number[][]): { mean: number; std: number } {
    if (mfccs.length < 10) return { mean: 0, std: 0 };
    
    const variations: number[] = [];
    for (let i = 1; i < mfccs.length; i++) {
      let diff = 0;
      for (let c = 0; c < mfccs[0].length; c++) {
        diff += Math.pow(mfccs[i][c] - mfccs[i-1][c], 2);
      }
      variations.push(Math.sqrt(diff));
    }
    
    return { mean: this.mean(variations), std: this.std(variations) };
  }
  
  /**
   * Calculate jitter (pitch perturbation)
   */
  private jitter(pitches: number[]): number {
    if (pitches.length < 3) return 0;
    
    let sum = 0;
    for (let i = 1; i < pitches.length; i++) {
      sum += Math.abs(pitches[i] - pitches[i-1]);
    }
    
    return (sum / (pitches.length - 1)) / this.mean(pitches);
  }
  
  // Statistical helper functions
  private mean(arr: number[]): number {
    return arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  }
  
  private std(arr: number[]): number {
    if (arr.length < 2) return 0;
    const m = this.mean(arr);
    return Math.sqrt(arr.reduce((a, b) => a + Math.pow(b - m, 2), 0) / arr.length);
  }
  
  private skewness(arr: number[]): number {
    if (arr.length < 3) return 0;
    const m = this.mean(arr);
    const s = this.std(arr);
    if (s === 0) return 0;
    const n = arr.length;
    const sum = arr.reduce((a, b) => a + Math.pow((b - m) / s, 3), 0);
    return sum * n / ((n - 1) * (n - 2));
  }
  
  private kurtosis(arr: number[]): number {
    if (arr.length < 4) return 0;
    const m = this.mean(arr);
    const s = this.std(arr);
    if (s === 0) return 0;
    const sum = arr.reduce((a, b) => a + Math.pow((b - m) / s, 4), 0);
    return sum / arr.length - 3;
  }
  
  private percentile(arr: number[], p: number): number {
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.floor(sorted.length * p / 100);
    return sorted[Math.min(idx, sorted.length - 1)];
  }
  
  /**
   * Calculate cosine similarity between embeddings
   */
  similarity(a: Float32Array, b: Float32Array): number {
    let dot = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    
    return dot / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
  }
}

// ============================================
// Speaker Diarizer
// ============================================

const DEFAULT_CONFIG: DiarizationConfig = {
  minSpeakers: 1,
  maxSpeakers: 10,
  minSegmentDuration: 500,
  embedDimension: 256,
  similarityThreshold: 0.75,
  windowSize: 1500,
  hopSize: 500,
  enableVoicePrint: true,
};

// Speaker colors for visualization
const SPEAKER_COLORS = [
  '#4CAF50', '#2196F3', '#FF9800', '#E91E63',
  '#9C27B0', '#00BCD4', '#FF5722', '#8BC34A',
  '#3F51B5', '#FFC107',
];

export class SpeakerDiarizer extends EventEmitter {
  private config: DiarizationConfig;
  private embedder: SpeakerEmbedder;
  private speakers: Map<string, Speaker> = new Map();
  private segments: SpeakerSegment[] = [];
  private currentSpeaker: string | null = null;
  private segmentStart: number | null = null;
  private speakerCounter = 0;
  
  constructor(config?: Partial<DiarizationConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.embedder = new SpeakerEmbedder(this.config.embedDimension);
  }
  
  /**
   * Process audio chunk for diarization
   */
  processAudio(audio: AudioChunk): SpeakerSegment | null {
    const samples = audio.data instanceof Float32Array 
      ? audio.data 
      : new Float32Array(audio.data.buffer);
    
    // Check if enough audio
    if (samples.length < this.config.windowSize * (audio.format.sampleRate / 1000)) {
      return null;
    }
    
    // Extract embedding
    const embedding = this.embedder.extractEmbedding(samples);
    
    // Find best matching speaker
    const { speakerId, confidence, isNew } = this.matchSpeaker(embedding, audio.timestamp);
    
    // Update segment tracking
    return this.updateSegments(speakerId, confidence, audio.timestamp, audio.duration);
  }
  
  /**
   * Match embedding to existing speaker or create new one
   */
  private matchSpeaker(
    embedding: Float32Array,
    timestamp: number
  ): { speakerId: string; confidence: number; isNew: boolean } {
    let bestMatch: { speaker: Speaker; similarity: number } | null = null;
    
    // Compare with existing speakers
    for (const [, speaker] of this.speakers) {
      if (speaker.embedding) {
        const similarity = this.embedder.similarity(embedding, speaker.embedding);
        
        if (!bestMatch || similarity > bestMatch.similarity) {
          bestMatch = { speaker, similarity };
        }
      }
    }
    
    // Check if we should create new speaker
    if (!bestMatch || bestMatch.similarity < this.config.similarityThreshold) {
      // Check speaker limit
      if (this.speakers.size >= this.config.maxSpeakers) {
        // Use speaker with lowest confidence if above max
        const lowestConfidence = Array.from(this.speakers.values())
          .sort((a, b) => a.confidence - b.confidence)[0];
        
        if (lowestConfidence && (!bestMatch || bestMatch.similarity > lowestConfidence.confidence)) {
          // Update this speaker's embedding instead
          lowestConfidence.embedding = this.mergeEmbeddings(
            lowestConfidence.embedding!,
            embedding,
            lowestConfidence.sampleCount
          );
          lowestConfidence.sampleCount++;
          lowestConfidence.lastSeen = timestamp;
          lowestConfidence.confidence = bestMatch?.similarity || 0.5;
          
          return {
            speakerId: lowestConfidence.id,
            confidence: bestMatch?.similarity || 0.5,
            isNew: false,
          };
        }
      }
      
      // Create new speaker
      const newSpeaker = this.createSpeaker(embedding, timestamp);
      
      logger.debug('New speaker detected', { speakerId: newSpeaker.id });
      this.emit('speaker-detected', newSpeaker);
      
      return {
        speakerId: newSpeaker.id,
        confidence: 0.8, // Initial confidence
        isNew: true,
      };
    }
    
    // Update existing speaker
    const speaker = bestMatch.speaker;
    speaker.embedding = this.mergeEmbeddings(
      speaker.embedding!,
      embedding,
      speaker.sampleCount
    );
    speaker.sampleCount++;
    speaker.lastSeen = timestamp;
    speaker.confidence = (speaker.confidence * 0.9) + (bestMatch.similarity * 0.1);
    
    return {
      speakerId: speaker.id,
      confidence: bestMatch.similarity,
      isNew: false,
    };
  }
  
  /**
   * Create new speaker
   */
  private createSpeaker(embedding: Float32Array, timestamp: number): Speaker {
    this.speakerCounter++;
    
    const speaker: Speaker = {
      id: `speaker_${this.speakerCounter}`,
      name: `Speaker ${this.speakerCounter}`,
      color: SPEAKER_COLORS[(this.speakerCounter - 1) % SPEAKER_COLORS.length],
      embedding,
      sampleCount: 1,
      totalSpeakingTime: 0,
      firstSeen: timestamp,
      lastSeen: timestamp,
      confidence: 0.8,
    };
    
    this.speakers.set(speaker.id, speaker);
    return speaker;
  }
  
  /**
   * Merge embeddings (rolling average)
   */
  private mergeEmbeddings(
    existing: Float32Array,
    newEmbed: Float32Array,
    count: number
  ): Float32Array {
    const weight = Math.min(0.1, 1 / (count + 1));
    const result = new Float32Array(existing.length);
    
    for (let i = 0; i < existing.length; i++) {
      result[i] = existing[i] * (1 - weight) + newEmbed[i] * weight;
    }
    
    // Normalize
    let norm = 0;
    for (let i = 0; i < result.length; i++) {
      norm += result[i] * result[i];
    }
    norm = Math.sqrt(norm);
    
    for (let i = 0; i < result.length; i++) {
      result[i] /= norm;
    }
    
    return result;
  }
  
  /**
   * Update segment tracking
   */
  private updateSegments(
    speakerId: string,
    confidence: number,
    timestamp: number,
    duration: number
  ): SpeakerSegment | null {
    const speaker = this.speakers.get(speakerId);
    
    // Check for speaker change
    if (speakerId !== this.currentSpeaker) {
      // Close previous segment
      if (this.currentSpeaker && this.segmentStart !== null) {
        const prevSpeaker = this.speakers.get(this.currentSpeaker);
        const segmentDuration = timestamp - this.segmentStart;
        
        if (segmentDuration >= this.config.minSegmentDuration) {
          const segment: SpeakerSegment = {
            speakerId: this.currentSpeaker,
            start: this.segmentStart,
            end: timestamp,
            confidence: prevSpeaker?.confidence || 0.5,
          };
          
          this.segments.push(segment);
          
          if (prevSpeaker) {
            prevSpeaker.totalSpeakingTime += segmentDuration;
          }
          
          this.emit('segment-complete', segment);
        }
      }
      
      // Start new segment
      this.currentSpeaker = speakerId;
      this.segmentStart = timestamp;
      
      this.emit('speaker-change', { 
        previousSpeaker: this.currentSpeaker, 
        newSpeaker: speakerId,
        speaker 
      });
    }
    
    // Update speaking time
    if (speaker) {
      speaker.totalSpeakingTime += duration;
    }
    
    return null;
  }
  
  /**
   * Finalize current segment
   */
  finalizeSegment(timestamp: number): SpeakerSegment | null {
    if (this.currentSpeaker && this.segmentStart !== null) {
      const speaker = this.speakers.get(this.currentSpeaker);
      const segmentDuration = timestamp - this.segmentStart;
      
      if (segmentDuration >= this.config.minSegmentDuration) {
        const segment: SpeakerSegment = {
          speakerId: this.currentSpeaker,
          start: this.segmentStart,
          end: timestamp,
          confidence: speaker?.confidence || 0.5,
        };
        
        this.segments.push(segment);
        this.currentSpeaker = null;
        this.segmentStart = null;
        
        return segment;
      }
    }
    
    return null;
  }
  
  /**
   * Assign text to segment
   */
  assignTextToSegment(transcription: TranscriptionResult): void {
    // Extract timing from segments if available, or use defaults
    const startTime = transcription.segments?.[0]?.start ?? 0;
    const endTime = transcription.segments?.[transcription.segments.length - 1]?.end ?? 0;
    const text = transcription.final || transcription.partial || '';
    
    // Find overlapping segment
    const segmentIndex = this.segments.findIndex((s) =>
      startTime >= s.start && endTime <= s.end
    );
    
    if (segmentIndex !== -1) {
      this.segments[segmentIndex].text = text;
      this.emit('segment-updated', this.segments[segmentIndex]);
    }
  }
  
  /**
   * Get diarization results
   */
  getResults(): DiarizationResult {
    const speakers = Array.from(this.speakers.values());
    
    // Find dominant speaker
    let dominantSpeaker: string | null = null;
    let maxTime = 0;
    
    for (const speaker of speakers) {
      if (speaker.totalSpeakingTime > maxTime) {
        maxTime = speaker.totalSpeakingTime;
        dominantSpeaker = speaker.id;
      }
    }
    
    // Count speaker turns
    let turnCount = 0;
    let lastSpeaker: string | null = null;
    
    for (const segment of this.segments) {
      if (segment.speakerId !== lastSpeaker) {
        turnCount++;
        lastSpeaker = segment.speakerId;
      }
    }
    
    // Calculate total duration
    const totalDuration = this.segments.length > 0
      ? this.segments[this.segments.length - 1].end - this.segments[0].start
      : 0;
    
    return {
      segments: [...this.segments],
      speakers,
      dominantSpeaker,
      turnCount,
      totalDuration,
    };
  }
  
  /**
   * Get speaker by ID
   */
  getSpeaker(speakerId: string): Speaker | undefined {
    return this.speakers.get(speakerId);
  }
  
  /**
   * Set speaker name
   */
  setSpeakerName(speakerId: string, name: string): void {
    const speaker = this.speakers.get(speakerId);
    if (speaker) {
      speaker.name = name;
      this.emit('speaker-renamed', speaker);
    }
  }
  
  /**
   * Merge two speakers
   */
  mergeSpeakers(keepId: string, mergeId: string): void {
    const keep = this.speakers.get(keepId);
    const merge = this.speakers.get(mergeId);
    
    if (!keep || !merge) {
      throw new Error('Speaker not found');
    }
    
    // Merge embeddings
    if (keep.embedding && merge.embedding) {
      const totalSamples = keep.sampleCount + merge.sampleCount;
      keep.embedding = this.mergeEmbeddings(
        keep.embedding,
        merge.embedding,
        keep.sampleCount
      );
      keep.sampleCount = totalSamples;
    }
    
    // Update times
    keep.totalSpeakingTime += merge.totalSpeakingTime;
    keep.firstSeen = Math.min(keep.firstSeen, merge.firstSeen);
    keep.lastSeen = Math.max(keep.lastSeen, merge.lastSeen);
    
    // Update segments
    for (const segment of this.segments) {
      if (segment.speakerId === mergeId) {
        segment.speakerId = keepId;
      }
    }
    
    // Remove merged speaker
    this.speakers.delete(mergeId);
    
    logger.info('Speakers merged', { keepId, mergeId });
    this.emit('speakers-merged', { keepId, mergeId, result: keep });
  }
  
  /**
   * Reset diarization
   */
  reset(): void {
    this.speakers.clear();
    this.segments = [];
    this.currentSpeaker = null;
    this.segmentStart = null;
    this.speakerCounter = 0;
    
    this.emit('reset');
  }
  
  /**
   * Export transcript with speaker labels
   */
  exportTranscript(): string {
    let transcript = '';
    
    for (const segment of this.segments) {
      const speaker = this.speakers.get(segment.speakerId);
      const name = speaker?.name || segment.speakerId;
      const startTime = this.formatTime(segment.start);
      const endTime = this.formatTime(segment.end);
      
      if (segment.text) {
        transcript += `[${startTime} - ${endTime}] ${name}: ${segment.text}\n`;
      }
    }
    
    return transcript;
  }
  
  /**
   * Format timestamp as mm:ss
   */
  private formatTime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
}

// ============================================
// Exports
// ============================================

export const speakerDiarizer = new SpeakerDiarizer();
export { SpeakerEmbedder, DEFAULT_CONFIG as DEFAULT_DIARIZATION_CONFIG, SPEAKER_COLORS };
