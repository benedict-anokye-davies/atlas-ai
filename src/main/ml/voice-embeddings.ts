/**
 * Atlas Desktop - Voice Embeddings
 * Extract speaker embeddings (d-vectors/x-vectors) for speaker identification
 *
 * Features:
 * - D-vector extraction (DNN-based)
 * - X-vector extraction (TDNN-based)
 * - Embedding similarity comparison
 * - Speaker verification
 * - Embedding clustering
 *
 * @module ml/voice-embeddings
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('VoiceEmbeddings');

// ============================================================================
// Types
// ============================================================================

export interface VoiceEmbedding {
  type: 'd-vector' | 'x-vector' | 'ecapa-tdnn';
  vector: number[];
  dimension: number;
  extractedAt: number;
  audioLength: number; // ms
  quality: number; // 0-1
}

export interface SpeakerVerificationResult {
  match: boolean;
  similarity: number;
  threshold: number;
  confidence: number;
}

export interface EmbeddingCluster {
  id: string;
  centroid: number[];
  members: VoiceEmbedding[];
  variance: number;
}

export interface VoiceEmbeddingsConfig {
  embeddingType: 'd-vector' | 'x-vector' | 'ecapa-tdnn';
  dimension: number;
  frameSize: number; // ms
  hopSize: number; // ms
  minAudioLength: number; // ms
  verificationThreshold: number;
}

export interface VoiceEmbeddingsEvents {
  'embedding-extracted': (embedding: VoiceEmbedding) => void;
  'speaker-verified': (result: SpeakerVerificationResult) => void;
  'cluster-updated': (cluster: EmbeddingCluster) => void;
  error: (error: Error) => void;
}

// ============================================================================
// Voice Embedding Extractor
// ============================================================================

export class VoiceEmbeddings extends EventEmitter {
  private config: VoiceEmbeddingsConfig;
  private melFilterbank: number[][] = [];
  private dctMatrix: number[][] = [];

  // Stats
  private stats = {
    extractionsCount: 0,
    verificationsCount: 0,
    avgExtractionTime: 0,
    avgQuality: 0,
  };

  constructor(config?: Partial<VoiceEmbeddingsConfig>) {
    super();
    this.config = {
      embeddingType: 'd-vector',
      dimension: 256,
      frameSize: 25,
      hopSize: 10,
      minAudioLength: 500,
      verificationThreshold: 0.7,
      ...config,
    };

    this.initializeFilterbanks();

    logger.info('VoiceEmbeddings initialized', { config: this.config });
  }

  // ============================================================================
  // Initialization
  // ============================================================================

  /**
   * Initialize mel filterbank and DCT matrix
   */
  private initializeFilterbanks(): void {
    const numFilters = 40;
    const fftSize = 512;
    const sampleRate = 16000;

    // Mel filterbank
    const melScale = (f: number) => 2595 * Math.log10(1 + f / 700);
    const invMelScale = (m: number) => 700 * (Math.pow(10, m / 2595) - 1);

    const minMel = melScale(0);
    const maxMel = melScale(sampleRate / 2);
    const melPoints: number[] = [];

    for (let i = 0; i <= numFilters + 1; i++) {
      melPoints.push(invMelScale(minMel + (i * (maxMel - minMel)) / (numFilters + 1)));
    }

    // Convert to FFT bins
    const fftBins = melPoints.map((f) => Math.floor((fftSize + 1) * f / sampleRate));

    // Build filterbank
    this.melFilterbank = [];
    for (let i = 0; i < numFilters; i++) {
      const filter = new Array(fftSize / 2 + 1).fill(0);

      for (let j = fftBins[i]; j < fftBins[i + 1]; j++) {
        filter[j] = (j - fftBins[i]) / (fftBins[i + 1] - fftBins[i]);
      }
      for (let j = fftBins[i + 1]; j < fftBins[i + 2]; j++) {
        filter[j] = (fftBins[i + 2] - j) / (fftBins[i + 2] - fftBins[i + 1]);
      }

      this.melFilterbank.push(filter);
    }

    // DCT matrix for MFCC
    const numCepstral = 20;
    this.dctMatrix = [];
    for (let i = 0; i < numCepstral; i++) {
      const row: number[] = [];
      for (let j = 0; j < numFilters; j++) {
        row.push(Math.cos((Math.PI * i * (j + 0.5)) / numFilters));
      }
      this.dctMatrix.push(row);
    }
  }

  // ============================================================================
  // Feature Extraction
  // ============================================================================

  /**
   * Extract voice embedding from audio
   */
  extractEmbedding(samples: Float32Array, sampleRate: number): VoiceEmbedding {
    const startTime = performance.now();
    const audioLength = (samples.length / sampleRate) * 1000;

    if (audioLength < this.config.minAudioLength) {
      logger.warn('Audio too short for reliable embedding', { audioLength, minRequired: this.config.minAudioLength });
    }

    let vector: number[];
    let quality: number;

    switch (this.config.embeddingType) {
      case 'x-vector':
        ({ vector, quality } = this.extractXVector(samples, sampleRate));
        break;
      case 'ecapa-tdnn':
        ({ vector, quality } = this.extractECAPATDNN(samples, sampleRate));
        break;
      case 'd-vector':
      default:
        ({ vector, quality } = this.extractDVector(samples, sampleRate));
    }

    const embedding: VoiceEmbedding = {
      type: this.config.embeddingType,
      vector,
      dimension: vector.length,
      extractedAt: Date.now(),
      audioLength,
      quality,
    };

    // Update stats
    const extractionTime = performance.now() - startTime;
    this.stats.extractionsCount++;
    this.stats.avgExtractionTime =
      (this.stats.avgExtractionTime * (this.stats.extractionsCount - 1) + extractionTime) /
      this.stats.extractionsCount;
    this.stats.avgQuality =
      (this.stats.avgQuality * (this.stats.extractionsCount - 1) + quality) / this.stats.extractionsCount;

    this.emit('embedding-extracted', embedding);
    logger.debug('Embedding extracted', { type: embedding.type, dimension: embedding.dimension, quality });

    return embedding;
  }

  /**
   * Extract D-vector (DNN-based speaker embedding)
   */
  private extractDVector(samples: Float32Array, sampleRate: number): { vector: number[]; quality: number } {
    // Resample to 16kHz if needed
    if (sampleRate !== 16000) {
      samples = this.resample(samples, sampleRate, 16000);
      sampleRate = 16000;
    }

    // Extract frame-level features
    const frameFeatures = this.extractFrameFeatures(samples, sampleRate);

    // Aggregate to utterance-level (mean pooling)
    const utteranceFeature = this.meanPooling(frameFeatures);

    // Apply simple transformation (simulating DNN)
    const vector = this.applyTransformation(utteranceFeature, this.config.dimension);

    // L2 normalize
    const normalized = this.l2Normalize(vector);

    // Compute quality based on signal characteristics
    const quality = this.computeQuality(samples, sampleRate);

    return { vector: normalized, quality };
  }

  /**
   * Extract X-vector (TDNN-based speaker embedding)
   */
  private extractXVector(samples: Float32Array, sampleRate: number): { vector: number[]; quality: number } {
    // Resample to 16kHz if needed
    if (sampleRate !== 16000) {
      samples = this.resample(samples, sampleRate, 16000);
      sampleRate = 16000;
    }

    // Extract frame-level features
    const frameFeatures = this.extractFrameFeatures(samples, sampleRate);

    // Apply TDNN-style temporal context (simplified)
    const contextFeatures = this.applyTemporalContext(frameFeatures, [5, 3, 3, 1, 1]);

    // Statistics pooling (mean + std)
    const pooled = this.statisticsPooling(contextFeatures);

    // Apply transformation
    const vector = this.applyTransformation(pooled, this.config.dimension);

    // L2 normalize
    const normalized = this.l2Normalize(vector);

    const quality = this.computeQuality(samples, sampleRate);

    return { vector: normalized, quality };
  }

  /**
   * Extract ECAPA-TDNN embedding (simplified)
   */
  private extractECAPATDNN(samples: Float32Array, sampleRate: number): { vector: number[]; quality: number } {
    // Similar to x-vector but with attention-based pooling
    if (sampleRate !== 16000) {
      samples = this.resample(samples, sampleRate, 16000);
      sampleRate = 16000;
    }

    const frameFeatures = this.extractFrameFeatures(samples, sampleRate);

    // Apply SE-Res2Net-like transformation (simplified)
    const transformedFeatures = this.applySERes2NetTransform(frameFeatures);

    // Attention-based statistics pooling
    const pooled = this.attentionStatisticsPooling(transformedFeatures);

    const vector = this.applyTransformation(pooled, this.config.dimension);
    const normalized = this.l2Normalize(vector);

    const quality = this.computeQuality(samples, sampleRate);

    return { vector: normalized, quality };
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Extract frame-level features (MFCCs)
   */
  private extractFrameFeatures(samples: Float32Array, sampleRate: number): number[][] {
    const frameSize = Math.floor((this.config.frameSize / 1000) * sampleRate);
    const hopSize = Math.floor((this.config.hopSize / 1000) * sampleRate);
    const numFrames = Math.floor((samples.length - frameSize) / hopSize);

    const features: number[][] = [];

    for (let i = 0; i < numFrames; i++) {
      const start = i * hopSize;
      const frame = samples.slice(start, start + frameSize);

      // Apply Hamming window
      const windowed = this.applyHammingWindow(frame);

      // Compute power spectrum
      const spectrum = this.computePowerSpectrum(windowed);

      // Apply mel filterbank
      const melEnergies = this.applyMelFilterbank(spectrum);

      // Apply DCT to get MFCCs
      const mfccs = this.applyDCT(melEnergies);

      // Add delta and delta-delta features
      features.push(mfccs);
    }

    // Add delta features
    const deltas = this.computeDeltas(features);
    const deltaDeltas = this.computeDeltas(deltas);

    return features.map((f, i) => [...f, ...deltas[i], ...deltaDeltas[i]]);
  }

  /**
   * Apply Hamming window
   */
  private applyHammingWindow(frame: Float32Array): Float32Array {
    const windowed = new Float32Array(frame.length);
    for (let i = 0; i < frame.length; i++) {
      const window = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (frame.length - 1));
      windowed[i] = frame[i] * window;
    }
    return windowed;
  }

  /**
   * Compute power spectrum using FFT
   */
  private computePowerSpectrum(frame: Float32Array): number[] {
    const n = 512; // FFT size
    const padded = new Float32Array(n);
    for (let i = 0; i < Math.min(frame.length, n); i++) {
      padded[i] = frame[i];
    }

    // Simple DFT (for production, use FFT library)
    const spectrum: number[] = [];
    for (let k = 0; k <= n / 2; k++) {
      let real = 0;
      let imag = 0;
      for (let t = 0; t < n; t++) {
        const angle = (2 * Math.PI * k * t) / n;
        real += padded[t] * Math.cos(angle);
        imag -= padded[t] * Math.sin(angle);
      }
      spectrum.push((real * real + imag * imag) / n);
    }

    return spectrum;
  }

  /**
   * Apply mel filterbank
   */
  private applyMelFilterbank(spectrum: number[]): number[] {
    const melEnergies: number[] = [];

    for (const filter of this.melFilterbank) {
      let energy = 0;
      for (let i = 0; i < Math.min(filter.length, spectrum.length); i++) {
        energy += filter[i] * spectrum[i];
      }
      melEnergies.push(Math.log(energy + 1e-10));
    }

    return melEnergies;
  }

  /**
   * Apply DCT to get MFCCs
   */
  private applyDCT(melEnergies: number[]): number[] {
    const mfccs: number[] = [];

    for (const row of this.dctMatrix) {
      let coeff = 0;
      for (let j = 0; j < melEnergies.length; j++) {
        coeff += row[j] * melEnergies[j];
      }
      mfccs.push(coeff);
    }

    return mfccs;
  }

  /**
   * Compute delta features
   */
  private computeDeltas(features: number[][], windowSize = 2): number[][] {
    const deltas: number[][] = [];

    for (let i = 0; i < features.length; i++) {
      const delta: number[] = [];

      for (let d = 0; d < features[0].length; d++) {
        let num = 0;
        let denom = 0;

        for (let n = 1; n <= windowSize; n++) {
          const prev = i - n >= 0 ? features[i - n][d] : features[0][d];
          const next = i + n < features.length ? features[i + n][d] : features[features.length - 1][d];
          num += n * (next - prev);
          denom += 2 * n * n;
        }

        delta.push(denom > 0 ? num / denom : 0);
      }

      deltas.push(delta);
    }

    return deltas;
  }

  /**
   * Apply temporal context (TDNN-style)
   */
  private applyTemporalContext(features: number[][], contextSizes: number[]): number[][] {
    let current = features;

    for (const contextSize of contextSizes) {
      const half = Math.floor(contextSize / 2);
      const newFeatures: number[][] = [];

      for (let i = 0; i < current.length; i++) {
        const contextFeature: number[] = [];

        for (let j = -half; j <= half; j++) {
          const idx = Math.max(0, Math.min(current.length - 1, i + j));
          contextFeature.push(...current[idx]);
        }

        // Reduce dimension through simple linear projection
        const reduced = this.reduceFeature(contextFeature, current[0].length);
        newFeatures.push(reduced);
      }

      current = newFeatures;
    }

    return current;
  }

  /**
   * Reduce feature dimension
   */
  private reduceFeature(feature: number[], targetDim: number): number[] {
    if (feature.length <= targetDim) {
      return feature;
    }

    const ratio = feature.length / targetDim;
    const reduced: number[] = [];

    for (let i = 0; i < targetDim; i++) {
      const start = Math.floor(i * ratio);
      const end = Math.floor((i + 1) * ratio);
      let sum = 0;
      for (let j = start; j < end; j++) {
        sum += feature[j];
      }
      reduced.push(sum / (end - start));
    }

    return reduced;
  }

  /**
   * Mean pooling
   */
  private meanPooling(features: number[][]): number[] {
    if (features.length === 0) return [];

    const dim = features[0].length;
    const mean = new Array(dim).fill(0);

    for (const feature of features) {
      for (let i = 0; i < dim; i++) {
        mean[i] += feature[i];
      }
    }

    for (let i = 0; i < dim; i++) {
      mean[i] /= features.length;
    }

    return mean;
  }

  /**
   * Statistics pooling (mean + std)
   */
  private statisticsPooling(features: number[][]): number[] {
    if (features.length === 0) return [];

    const dim = features[0].length;
    const mean = this.meanPooling(features);

    // Compute std
    const std = new Array(dim).fill(0);
    for (const feature of features) {
      for (let i = 0; i < dim; i++) {
        std[i] += Math.pow(feature[i] - mean[i], 2);
      }
    }
    for (let i = 0; i < dim; i++) {
      std[i] = Math.sqrt(std[i] / features.length);
    }

    return [...mean, ...std];
  }

  /**
   * SE-Res2Net-like transformation (simplified)
   */
  private applySERes2NetTransform(features: number[][]): number[][] {
    // Simplified version - apply channel attention
    const transformed: number[][] = [];

    for (const feature of features) {
      // Global average pooling for attention
      const avgPool = feature.reduce((a, b) => a + b, 0) / feature.length;

      // SE attention (simplified)
      const attention = feature.map((v) => Math.tanh(v * avgPool));

      // Apply attention
      const attended = feature.map((v, i) => v * (1 + attention[i]));
      transformed.push(attended);
    }

    return transformed;
  }

  /**
   * Attention-based statistics pooling
   */
  private attentionStatisticsPooling(features: number[][]): number[] {
    if (features.length === 0) return [];

    // Compute attention weights
    const weights: number[] = [];
    for (const feature of features) {
      const energy = feature.reduce((a, b) => a + b * b, 0);
      weights.push(energy);
    }

    // Softmax
    const maxWeight = Math.max(...weights);
    const expWeights = weights.map((w) => Math.exp(w - maxWeight));
    const sumWeights = expWeights.reduce((a, b) => a + b, 0);
    const normalizedWeights = expWeights.map((w) => w / sumWeights);

    // Weighted mean
    const dim = features[0].length;
    const mean = new Array(dim).fill(0);
    for (let f = 0; f < features.length; f++) {
      for (let i = 0; i < dim; i++) {
        mean[i] += normalizedWeights[f] * features[f][i];
      }
    }

    // Weighted std
    const std = new Array(dim).fill(0);
    for (let f = 0; f < features.length; f++) {
      for (let i = 0; i < dim; i++) {
        std[i] += normalizedWeights[f] * Math.pow(features[f][i] - mean[i], 2);
      }
    }
    for (let i = 0; i < dim; i++) {
      std[i] = Math.sqrt(std[i]);
    }

    return [...mean, ...std];
  }

  /**
   * Apply simple linear transformation
   */
  private applyTransformation(input: number[], outputDim: number): number[] {
    // Simple dimension adjustment through interpolation/aggregation
    if (input.length === outputDim) return input;

    const output: number[] = [];
    const ratio = input.length / outputDim;

    for (let i = 0; i < outputDim; i++) {
      const start = i * ratio;
      const end = (i + 1) * ratio;

      let sum = 0;
      let count = 0;

      for (let j = Math.floor(start); j < Math.ceil(end) && j < input.length; j++) {
        const weight =
          Math.min(j + 1, end) - Math.max(j, start);
        sum += input[j] * weight;
        count += weight;
      }

      output.push(count > 0 ? sum / count : 0);
    }

    return output;
  }

  /**
   * L2 normalize vector
   */
  private l2Normalize(vector: number[]): number[] {
    const norm = Math.sqrt(vector.reduce((a, b) => a + b * b, 0));
    if (norm === 0) return vector;
    return vector.map((v) => v / norm);
  }

  /**
   * Resample audio
   */
  private resample(samples: Float32Array, fromRate: number, toRate: number): Float32Array {
    const ratio = fromRate / toRate;
    const newLength = Math.floor(samples.length / ratio);
    const resampled = new Float32Array(newLength);

    for (let i = 0; i < newLength; i++) {
      const srcIndex = i * ratio;
      const srcIndexFloor = Math.floor(srcIndex);
      const srcIndexCeil = Math.min(srcIndexFloor + 1, samples.length - 1);
      const frac = srcIndex - srcIndexFloor;

      resampled[i] = samples[srcIndexFloor] * (1 - frac) + samples[srcIndexCeil] * frac;
    }

    return resampled;
  }

  /**
   * Compute embedding quality score
   */
  private computeQuality(samples: Float32Array, sampleRate: number): number {
    // Based on SNR and audio length
    const audioLength = (samples.length / sampleRate) * 1000;

    // RMS energy
    let rms = 0;
    for (let i = 0; i < samples.length; i++) {
      rms += samples[i] * samples[i];
    }
    rms = Math.sqrt(rms / samples.length);

    // Estimate SNR (simplified)
    const snr = 20 * Math.log10(rms / 0.001 + 1);

    // Quality factors
    const lengthFactor = Math.min(audioLength / 3000, 1); // Max at 3s
    const snrFactor = Math.min(snr / 30, 1); // Max at 30dB

    return (lengthFactor + snrFactor) / 2;
  }

  // ============================================================================
  // Speaker Verification
  // ============================================================================

  /**
   * Verify if two embeddings are from the same speaker
   */
  verifySpeaker(embedding1: VoiceEmbedding, embedding2: VoiceEmbedding): SpeakerVerificationResult {
    const similarity = this.cosineSimilarity(embedding1.vector, embedding2.vector);
    const match = similarity >= this.config.verificationThreshold;

    // Confidence based on quality of both embeddings
    const confidence = (embedding1.quality + embedding2.quality) / 2;

    const result: SpeakerVerificationResult = {
      match,
      similarity,
      threshold: this.config.verificationThreshold,
      confidence,
    };

    this.stats.verificationsCount++;
    this.emit('speaker-verified', result);

    return result;
  }

  /**
   * Compute cosine similarity
   */
  cosineSimilarity(a: number[], b: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  // ============================================================================
  // Clustering
  // ============================================================================

  /**
   * Cluster embeddings using agglomerative clustering
   */
  clusterEmbeddings(embeddings: VoiceEmbedding[], numClusters?: number): EmbeddingCluster[] {
    if (embeddings.length === 0) return [];

    // Initial: each embedding is its own cluster
    let clusters: EmbeddingCluster[] = embeddings.map((e, i) => ({
      id: `cluster_${i}`,
      centroid: e.vector,
      members: [e],
      variance: 0,
    }));

    // Agglomerative clustering
    while (clusters.length > (numClusters || Math.ceil(embeddings.length / 3))) {
      // Find most similar pair
      let maxSim = -1;
      let mergeI = 0;
      let mergeJ = 1;

      for (let i = 0; i < clusters.length; i++) {
        for (let j = i + 1; j < clusters.length; j++) {
          const sim = this.cosineSimilarity(clusters[i].centroid, clusters[j].centroid);
          if (sim > maxSim) {
            maxSim = sim;
            mergeI = i;
            mergeJ = j;
          }
        }
      }

      // Merge if similar enough
      if (maxSim < this.config.verificationThreshold) break;

      const merged = this.mergeClusters(clusters[mergeI], clusters[mergeJ]);
      clusters = clusters.filter((_, i) => i !== mergeI && i !== mergeJ);
      clusters.push(merged);
    }

    // Emit updates
    for (const cluster of clusters) {
      this.emit('cluster-updated', cluster);
    }

    return clusters;
  }

  /**
   * Merge two clusters
   */
  private mergeClusters(a: EmbeddingCluster, b: EmbeddingCluster): EmbeddingCluster {
    const members = [...a.members, ...b.members];

    // Compute new centroid
    const dim = a.centroid.length;
    const centroid = new Array(dim).fill(0);

    for (const member of members) {
      for (let i = 0; i < dim; i++) {
        centroid[i] += member.vector[i];
      }
    }
    for (let i = 0; i < dim; i++) {
      centroid[i] /= members.length;
    }

    // Compute variance
    let variance = 0;
    for (const member of members) {
      variance += 1 - this.cosineSimilarity(member.vector, centroid);
    }
    variance /= members.length;

    return {
      id: `cluster_${Date.now()}`,
      centroid,
      members,
      variance,
    };
  }

  // ============================================================================
  // Statistics
  // ============================================================================

  /**
   * Get statistics
   */
  getStats(): {
    extractionsCount: number;
    verificationsCount: number;
    avgExtractionTime: number;
    avgQuality: number;
    embeddingType: string;
    dimension: number;
  } {
    return {
      ...this.stats,
      embeddingType: this.config.embeddingType,
      dimension: this.config.dimension,
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<VoiceEmbeddingsConfig>): void {
    this.config = { ...this.config, ...config };
    if (config.embeddingType || config.dimension) {
      this.initializeFilterbanks();
    }
    logger.info('Config updated', { config: this.config });
  }
}

// ============================================================================
// Singleton
// ============================================================================

let voiceEmbeddings: VoiceEmbeddings | null = null;

export function getVoiceEmbeddings(): VoiceEmbeddings {
  if (!voiceEmbeddings) {
    voiceEmbeddings = new VoiceEmbeddings();
  }
  return voiceEmbeddings;
}
