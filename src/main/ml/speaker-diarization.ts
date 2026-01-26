/**
 * Atlas Desktop - Speaker Diarization
 * Multi-user voice identification and tracking
 *
 * Features:
 * - Speaker segmentation from audio
 * - Voice embedding extraction
 * - Speaker clustering and identification
 * - Online speaker tracking
 * - Speaker profile management
 *
 * @module ml/speaker-diarization
 */

import { EventEmitter } from 'events';
import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('SpeakerDiarization');

// ============================================================================
// Types
// ============================================================================

export interface SpeakerEmbedding {
  id: string;
  name: string;
  embeddings: number[][]; // Multiple embeddings for robustness
  centroid: number[];
  createdAt: number;
  lastSeen: number;
  sampleCount: number;
  metadata?: Record<string, unknown>;
}

export interface DiarizationSegment {
  speakerId: string;
  speakerName: string;
  startTime: number;
  endTime: number;
  confidence: number;
  embedding?: number[];
}

export interface DiarizationResult {
  segments: DiarizationSegment[];
  speakerCount: number;
  speakerMap: Map<string, string>; // id -> name
  duration: number;
}

export interface SpeakerDiarizationConfig {
  embeddingDim: number;
  clusterThreshold: number; // Cosine similarity threshold
  minSegmentDuration: number; // ms
  maxSpeakersPerSession: number;
  enrollmentSamples: number;
}

export interface SpeakerDiarizationEvents {
  'speaker-detected': (speaker: SpeakerEmbedding, segment: DiarizationSegment) => void;
  'new-speaker': (speaker: SpeakerEmbedding) => void;
  'speaker-enrolled': (speaker: SpeakerEmbedding) => void;
  'segment-complete': (segment: DiarizationSegment) => void;
  error: (error: Error) => void;
}

// ============================================================================
// Simple Voice Feature Extractor
// ============================================================================

class VoiceFeatureExtractor {
  private config: { embeddingDim: number };

  constructor(config: { embeddingDim: number }) {
    this.config = config;
  }

  /**
   * Extract voice features from audio samples
   * In production, use proper MFCC/d-vector/x-vector extraction
   */
  extractFeatures(samples: Float32Array, sampleRate: number): number[] {
    const features: number[] = [];

    // Frame parameters
    const frameSize = Math.floor(sampleRate * 0.025); // 25ms frames
    const hopSize = Math.floor(sampleRate * 0.01); // 10ms hop
    const numFrames = Math.floor((samples.length - frameSize) / hopSize);

    if (numFrames < 10) {
      // Not enough audio, return zeros
      return new Array(this.config.embeddingDim).fill(0);
    }

    // Extract frame-level features
    const frameFeatures: number[][] = [];

    for (let i = 0; i < numFrames; i++) {
      const start = i * hopSize;
      const frame = samples.slice(start, start + frameSize);

      // Basic features per frame
      const frameFeature: number[] = [];

      // 1. Energy
      let energy = 0;
      for (let j = 0; j < frame.length; j++) {
        energy += frame[j] * frame[j];
      }
      frameFeature.push(Math.sqrt(energy / frame.length));

      // 2. Zero crossing rate
      let zcr = 0;
      for (let j = 1; j < frame.length; j++) {
        if ((frame[j] >= 0 && frame[j - 1] < 0) || (frame[j] < 0 && frame[j - 1] >= 0)) {
          zcr++;
        }
      }
      frameFeature.push(zcr / frame.length);

      // 3. Spectral features (simplified)
      const spectrum = this.computeSpectrum(frame);

      // Spectral centroid
      let centroid = 0;
      let totalMag = 0;
      for (let j = 0; j < spectrum.length; j++) {
        centroid += j * spectrum[j];
        totalMag += spectrum[j];
      }
      frameFeature.push(totalMag > 0 ? centroid / totalMag : 0);

      // Spectral spread
      let spread = 0;
      const meanCentroid = totalMag > 0 ? centroid / totalMag : 0;
      for (let j = 0; j < spectrum.length; j++) {
        spread += Math.pow(j - meanCentroid, 2) * spectrum[j];
      }
      frameFeature.push(totalMag > 0 ? Math.sqrt(spread / totalMag) : 0);

      // Spectral rolloff
      let cumSum = 0;
      let rolloff = 0;
      for (let j = 0; j < spectrum.length; j++) {
        cumSum += spectrum[j];
        if (cumSum >= 0.85 * totalMag) {
          rolloff = j / spectrum.length;
          break;
        }
      }
      frameFeature.push(rolloff);

      // 4. MFCCs (simplified - normally use proper DCT)
      const mfccs = this.computeSimpleMFCC(spectrum, 13);
      frameFeature.push(...mfccs);

      frameFeatures.push(frameFeature);
    }

    // Aggregate frame features to get utterance-level embedding
    const featureDim = frameFeatures[0].length;
    const aggregated: number[] = [];

    // Mean pooling
    for (let d = 0; d < featureDim; d++) {
      let sum = 0;
      for (const frame of frameFeatures) {
        sum += frame[d];
      }
      aggregated.push(sum / frameFeatures.length);
    }

    // Std pooling
    for (let d = 0; d < featureDim; d++) {
      const mean = aggregated[d];
      let variance = 0;
      for (const frame of frameFeatures) {
        variance += Math.pow(frame[d] - mean, 2);
      }
      aggregated.push(Math.sqrt(variance / frameFeatures.length));
    }

    // Pad or truncate to embedding dimension
    while (aggregated.length < this.config.embeddingDim) {
      aggregated.push(0);
    }

    return aggregated.slice(0, this.config.embeddingDim);
  }

  /**
   * Simple DFT spectrum computation
   */
  private computeSpectrum(frame: Float32Array): number[] {
    const n = frame.length;
    const spectrum: number[] = [];

    // Use only first half of spectrum (Nyquist)
    for (let k = 0; k < n / 2; k++) {
      let real = 0;
      let imag = 0;
      for (let t = 0; t < n; t++) {
        const angle = (2 * Math.PI * k * t) / n;
        real += frame[t] * Math.cos(angle);
        imag -= frame[t] * Math.sin(angle);
      }
      spectrum.push(Math.sqrt(real * real + imag * imag));
    }

    return spectrum;
  }

  /**
   * Simplified MFCC computation
   */
  private computeSimpleMFCC(spectrum: number[], numCoeffs: number): number[] {
    // Apply mel filterbank (simplified)
    const numFilters = 26;
    const melSpectrum: number[] = [];

    const melScale = (f: number) => 2595 * Math.log10(1 + f / 700);
    const invMelScale = (m: number) => 700 * (Math.pow(10, m / 2595) - 1);

    const maxMel = melScale(8000); // Assume 16kHz sample rate
    const melStep = maxMel / (numFilters + 1);

    for (let i = 0; i < numFilters; i++) {
      const lowMel = i * melStep;
      const centerMel = (i + 1) * melStep;
      const highMel = (i + 2) * melStep;

      const lowFreq = invMelScale(lowMel);
      const centerFreq = invMelScale(centerMel);
      const highFreq = invMelScale(highMel);

      let filterOutput = 0;
      const freqStep = 8000 / spectrum.length;

      for (let j = 0; j < spectrum.length; j++) {
        const freq = j * freqStep;
        let weight = 0;

        if (freq >= lowFreq && freq <= centerFreq) {
          weight = (freq - lowFreq) / (centerFreq - lowFreq);
        } else if (freq > centerFreq && freq <= highFreq) {
          weight = (highFreq - freq) / (highFreq - centerFreq);
        }

        filterOutput += spectrum[j] * weight;
      }

      melSpectrum.push(Math.log(filterOutput + 1e-10));
    }

    // DCT to get MFCCs
    const mfccs: number[] = [];
    for (let k = 0; k < numCoeffs; k++) {
      let sum = 0;
      for (let n = 0; n < numFilters; n++) {
        sum += melSpectrum[n] * Math.cos((Math.PI * k * (n + 0.5)) / numFilters);
      }
      mfccs.push(sum);
    }

    return mfccs;
  }
}

// ============================================================================
// Speaker Diarization Manager
// ============================================================================

export class SpeakerDiarization extends EventEmitter {
  private speakers: Map<string, SpeakerEmbedding> = new Map();
  private currentSessionSpeakers: Set<string> = new Set();
  private featureExtractor: VoiceFeatureExtractor;
  private config: SpeakerDiarizationConfig;
  private dataPath: string;

  // Stats
  private stats = {
    totalSegments: 0,
    identifiedSegments: 0,
    unknownSegments: 0,
    enrolledSpeakers: 0,
  };

  constructor(config?: Partial<SpeakerDiarizationConfig>) {
    super();
    this.config = {
      embeddingDim: 128,
      clusterThreshold: 0.75,
      minSegmentDuration: 500,
      maxSpeakersPerSession: 10,
      enrollmentSamples: 3,
      ...config,
    };

    this.featureExtractor = new VoiceFeatureExtractor({ embeddingDim: this.config.embeddingDim });
    this.dataPath = path.join(app.getPath('userData'), 'speaker-profiles.json');

    this.loadProfiles();

    logger.info('SpeakerDiarization initialized', { config: this.config });
  }

  // ============================================================================
  // Profile Management
  // ============================================================================

  /**
   * Load speaker profiles from disk
   */
  private loadProfiles(): void {
    try {
      if (fs.existsSync(this.dataPath)) {
        const data = JSON.parse(fs.readFileSync(this.dataPath, 'utf-8'));
        for (const profile of data.speakers || []) {
          this.speakers.set(profile.id, profile);
        }
        logger.info('Loaded speaker profiles', { count: this.speakers.size });
      }
    } catch (error) {
      logger.warn('Failed to load speaker profiles', { error });
    }
  }

  /**
   * Save speaker profiles to disk
   */
  private saveProfiles(): void {
    try {
      const data = {
        speakers: Array.from(this.speakers.values()),
        savedAt: Date.now(),
      };
      fs.writeFileSync(this.dataPath, JSON.stringify(data, null, 2));
    } catch (error) {
      logger.warn('Failed to save speaker profiles', { error });
    }
  }

  // ============================================================================
  // Speaker Identification
  // ============================================================================

  /**
   * Process audio segment and identify speaker
   */
  processSegment(samples: Float32Array, sampleRate: number): DiarizationSegment | null {
    const duration = (samples.length / sampleRate) * 1000;

    if (duration < this.config.minSegmentDuration) {
      return null;
    }

    // Extract embedding
    const embedding = this.featureExtractor.extractFeatures(samples, sampleRate);

    // Find matching speaker
    const { speaker, similarity } = this.findMatchingSpeaker(embedding);

    this.stats.totalSegments++;

    if (speaker && similarity >= this.config.clusterThreshold) {
      // Known speaker
      this.stats.identifiedSegments++;
      this.currentSessionSpeakers.add(speaker.id);

      // Update speaker's last seen and add embedding
      speaker.lastSeen = Date.now();
      speaker.sampleCount++;

      // Add embedding to cluster (keep best N)
      speaker.embeddings.push(embedding);
      if (speaker.embeddings.length > 10) {
        speaker.embeddings.shift();
      }
      speaker.centroid = this.computeCentroid(speaker.embeddings);

      this.saveProfiles();

      const segment: DiarizationSegment = {
        speakerId: speaker.id,
        speakerName: speaker.name,
        startTime: 0,
        endTime: duration,
        confidence: similarity,
        embedding,
      };

      this.emit('speaker-detected', speaker, segment);
      this.emit('segment-complete', segment);

      return segment;
    } else {
      // Unknown speaker
      this.stats.unknownSegments++;

      // Check if we should create new speaker
      if (this.currentSessionSpeakers.size < this.config.maxSpeakersPerSession) {
        const newSpeaker = this.createUnknownSpeaker(embedding);
        this.currentSessionSpeakers.add(newSpeaker.id);

        this.emit('new-speaker', newSpeaker);

        const segment: DiarizationSegment = {
          speakerId: newSpeaker.id,
          speakerName: newSpeaker.name,
          startTime: 0,
          endTime: duration,
          confidence: 0.5,
          embedding,
        };

        this.emit('segment-complete', segment);

        return segment;
      }
    }

    return null;
  }

  /**
   * Find speaker with highest similarity
   */
  private findMatchingSpeaker(embedding: number[]): { speaker: SpeakerEmbedding | null; similarity: number } {
    let bestSpeaker: SpeakerEmbedding | null = null;
    let bestSimilarity = 0;

    for (const speaker of this.speakers.values()) {
      const similarity = this.cosineSimilarity(embedding, speaker.centroid);
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestSpeaker = speaker;
      }
    }

    return { speaker: bestSpeaker, similarity: bestSimilarity };
  }

  /**
   * Create new unknown speaker
   */
  private createUnknownSpeaker(embedding: number[]): SpeakerEmbedding {
    const id = `speaker_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const speaker: SpeakerEmbedding = {
      id,
      name: `Unknown Speaker ${this.speakers.size + 1}`,
      embeddings: [embedding],
      centroid: embedding,
      createdAt: Date.now(),
      lastSeen: Date.now(),
      sampleCount: 1,
    };

    this.speakers.set(id, speaker);
    this.saveProfiles();

    return speaker;
  }

  // ============================================================================
  // Enrollment
  // ============================================================================

  /**
   * Enroll a new speaker with name
   */
  enrollSpeaker(name: string, audioSamples: Float32Array[], sampleRate: number): SpeakerEmbedding | null {
    if (audioSamples.length < this.config.enrollmentSamples) {
      logger.warn('Not enough samples for enrollment', {
        provided: audioSamples.length,
        required: this.config.enrollmentSamples,
      });
      return null;
    }

    const embeddings: number[][] = [];
    for (const samples of audioSamples) {
      const embedding = this.featureExtractor.extractFeatures(samples, sampleRate);
      embeddings.push(embedding);
    }

    const centroid = this.computeCentroid(embeddings);
    const id = `speaker_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const speaker: SpeakerEmbedding = {
      id,
      name,
      embeddings,
      centroid,
      createdAt: Date.now(),
      lastSeen: Date.now(),
      sampleCount: audioSamples.length,
    };

    this.speakers.set(id, speaker);
    this.stats.enrolledSpeakers++;
    this.saveProfiles();

    this.emit('speaker-enrolled', speaker);
    logger.info('Speaker enrolled', { id, name });

    return speaker;
  }

  /**
   * Update speaker name
   */
  renameSpeaker(speakerId: string, newName: string): boolean {
    const speaker = this.speakers.get(speakerId);
    if (speaker) {
      speaker.name = newName;
      this.saveProfiles();
      logger.info('Speaker renamed', { speakerId, newName });
      return true;
    }
    return false;
  }

  /**
   * Delete speaker profile
   */
  deleteSpeaker(speakerId: string): boolean {
    if (this.speakers.delete(speakerId)) {
      this.currentSessionSpeakers.delete(speakerId);
      this.saveProfiles();
      logger.info('Speaker deleted', { speakerId });
      return true;
    }
    return false;
  }

  // ============================================================================
  // Batch Diarization
  // ============================================================================

  /**
   * Diarize a full audio recording
   */
  diarize(samples: Float32Array, sampleRate: number, windowMs = 2000): DiarizationResult {
    const segments: DiarizationSegment[] = [];
    const windowSize = Math.floor((windowMs / 1000) * sampleRate);
    const hopSize = Math.floor(windowSize / 2);

    let currentSpeaker: string | null = null;
    let segmentStart = 0;

    for (let i = 0; i <= samples.length - windowSize; i += hopSize) {
      const window = samples.slice(i, i + windowSize);
      const result = this.processSegment(window, sampleRate);

      if (result) {
        const timeMs = (i / sampleRate) * 1000;

        if (result.speakerId !== currentSpeaker) {
          // Speaker change
          if (currentSpeaker !== null && segments.length > 0) {
            segments[segments.length - 1].endTime = timeMs;
          }

          segments.push({
            ...result,
            startTime: timeMs,
            endTime: timeMs + windowMs,
          });

          currentSpeaker = result.speakerId;
          segmentStart = timeMs;
        } else {
          // Same speaker, extend segment
          if (segments.length > 0) {
            segments[segments.length - 1].endTime = timeMs + windowMs;
          }
        }
      }
    }

    // Merge adjacent segments from same speaker
    const mergedSegments = this.mergeSegments(segments);

    // Build speaker map
    const speakerMap = new Map<string, string>();
    for (const segment of mergedSegments) {
      speakerMap.set(segment.speakerId, segment.speakerName);
    }

    return {
      segments: mergedSegments,
      speakerCount: speakerMap.size,
      speakerMap,
      duration: (samples.length / sampleRate) * 1000,
    };
  }

  /**
   * Merge adjacent segments from same speaker
   */
  private mergeSegments(segments: DiarizationSegment[]): DiarizationSegment[] {
    if (segments.length === 0) return [];

    const merged: DiarizationSegment[] = [{ ...segments[0] }];

    for (let i = 1; i < segments.length; i++) {
      const current = segments[i];
      const last = merged[merged.length - 1];

      if (current.speakerId === last.speakerId && current.startTime - last.endTime < 500) {
        // Merge
        last.endTime = current.endTime;
        last.confidence = (last.confidence + current.confidence) / 2;
      } else {
        merged.push({ ...current });
      }
    }

    return merged;
  }

  // ============================================================================
  // Utilities
  // ============================================================================

  /**
   * Compute cosine similarity
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Compute centroid of embeddings
   */
  private computeCentroid(embeddings: number[][]): number[] {
    if (embeddings.length === 0) return [];

    const dim = embeddings[0].length;
    const centroid = new Array(dim).fill(0);

    for (const embedding of embeddings) {
      for (let i = 0; i < dim; i++) {
        centroid[i] += embedding[i];
      }
    }

    for (let i = 0; i < dim; i++) {
      centroid[i] /= embeddings.length;
    }

    return centroid;
  }

  /**
   * Get all speakers
   */
  getSpeakers(): SpeakerEmbedding[] {
    return Array.from(this.speakers.values());
  }

  /**
   * Get speaker by ID
   */
  getSpeaker(speakerId: string): SpeakerEmbedding | undefined {
    return this.speakers.get(speakerId);
  }

  /**
   * Reset session speakers
   */
  resetSession(): void {
    this.currentSessionSpeakers.clear();
    logger.info('Session reset');
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalSegments: number;
    identifiedSegments: number;
    unknownSegments: number;
    identificationRate: number;
    enrolledSpeakers: number;
    totalSpeakers: number;
    sessionSpeakers: number;
  } {
    return {
      ...this.stats,
      identificationRate:
        this.stats.totalSegments > 0 ? this.stats.identifiedSegments / this.stats.totalSegments : 0,
      totalSpeakers: this.speakers.size,
      sessionSpeakers: this.currentSessionSpeakers.size,
    };
  }
}

// ============================================================================
// Singleton
// ============================================================================

let speakerDiarization: SpeakerDiarization | null = null;

export function getSpeakerDiarization(): SpeakerDiarization {
  if (!speakerDiarization) {
    speakerDiarization = new SpeakerDiarization();
  }
  return speakerDiarization;
}
