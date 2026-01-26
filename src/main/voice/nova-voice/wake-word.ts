/**
 * NovaVoice - Wake Word Detection
 * Low-power always-on wake word detection
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../../utils/logger';
import { AudioChunk, AudioFormat } from './types';

const logger = createModuleLogger('NovaVoice-WakeWord');

// ============================================
// Types
// ============================================

export interface WakeWordConfig {
  wakeWords: string[];
  sensitivity: number;      // 0-1, higher = more sensitive
  minConfidence: number;    // 0-1, minimum confidence to trigger
  cooldownMs: number;       // Cooldown between detections
  audioContext: number;     // ms of audio to keep for context
  energyThreshold: number;  // Minimum energy to process
  maxSilenceMs: number;     // Max silence before resetting
}

export interface WakeWordDetection {
  wakeWord: string;
  confidence: number;
  timestamp: number;
  audioContext?: Float32Array;
}

export interface WakeWordModel {
  name: string;
  wakeWords: string[];
  sampleRate: number;
  frameSize: number;
  process: (audio: Float32Array) => WakeWordResult;
}

export interface WakeWordResult {
  detected: boolean;
  wakeWord?: string;
  confidence: number;
  scores: Record<string, number>;
}

// ============================================
// Simple MFCC Feature Extractor
// ============================================

class MFCCExtractor {
  private sampleRate: number;
  private frameSize: number;
  private numFilters: number;
  private numCoeffs: number;
  private filterBank: Float32Array[];
  
  constructor(sampleRate = 16000, frameSize = 512, numFilters = 26, numCoeffs = 13) {
    this.sampleRate = sampleRate;
    this.frameSize = frameSize;
    this.numFilters = numFilters;
    this.numCoeffs = numCoeffs;
    this.filterBank = this.createMelFilterBank();
  }
  
  /**
   * Create mel filter bank
   */
  private createMelFilterBank(): Float32Array[] {
    const bank: Float32Array[] = [];
    const nyquist = this.sampleRate / 2;
    const fftSize = this.frameSize;
    
    // Mel scale conversion
    const melMin = 0;
    const melMax = 2595 * Math.log10(1 + nyquist / 700);
    
    const melPoints = new Float32Array(this.numFilters + 2);
    for (let i = 0; i < melPoints.length; i++) {
      melPoints[i] = melMin + (melMax - melMin) * i / (this.numFilters + 1);
    }
    
    // Convert back to Hz
    const hzPoints = melPoints.map((mel) => 700 * (Math.pow(10, mel / 2595) - 1));
    
    // Convert to FFT bins
    const binPoints = hzPoints.map((hz) => Math.floor((fftSize + 1) * hz / this.sampleRate));
    
    // Create filters
    for (let i = 0; i < this.numFilters; i++) {
      const filter = new Float32Array(fftSize / 2 + 1);
      
      for (let j = binPoints[i]; j < binPoints[i + 1]; j++) {
        filter[j] = (j - binPoints[i]) / (binPoints[i + 1] - binPoints[i]);
      }
      
      for (let j = binPoints[i + 1]; j < binPoints[i + 2]; j++) {
        filter[j] = (binPoints[i + 2] - j) / (binPoints[i + 2] - binPoints[i + 1]);
      }
      
      bank.push(filter);
    }
    
    return bank;
  }
  
  /**
   * Extract MFCC features from audio frame
   */
  extract(frame: Float32Array): Float32Array {
    // Apply window
    const windowed = this.applyHammingWindow(frame);
    
    // Compute power spectrum (simplified - real impl would use FFT)
    const powerSpectrum = this.computePowerSpectrum(windowed);
    
    // Apply mel filter bank
    const melEnergies = new Float32Array(this.numFilters);
    for (let i = 0; i < this.numFilters; i++) {
      let sum = 0;
      for (let j = 0; j < powerSpectrum.length; j++) {
        sum += powerSpectrum[j] * this.filterBank[i][j];
      }
      melEnergies[i] = Math.log(Math.max(1e-10, sum));
    }
    
    // DCT to get MFCCs
    return this.dct(melEnergies);
  }
  
  private applyHammingWindow(frame: Float32Array): Float32Array {
    const windowed = new Float32Array(frame.length);
    for (let i = 0; i < frame.length; i++) {
      const window = 0.54 - 0.46 * Math.cos(2 * Math.PI * i / (frame.length - 1));
      windowed[i] = frame[i] * window;
    }
    return windowed;
  }
  
  private computePowerSpectrum(frame: Float32Array): Float32Array {
    // Simplified power spectrum (real impl would use FFT)
    const spectrum = new Float32Array(frame.length / 2 + 1);
    
    for (let k = 0; k < spectrum.length; k++) {
      let real = 0;
      let imag = 0;
      
      for (let n = 0; n < frame.length; n++) {
        const angle = -2 * Math.PI * k * n / frame.length;
        real += frame[n] * Math.cos(angle);
        imag += frame[n] * Math.sin(angle);
      }
      
      spectrum[k] = (real * real + imag * imag) / frame.length;
    }
    
    return spectrum;
  }
  
  private dct(input: Float32Array): Float32Array {
    const output = new Float32Array(this.numCoeffs);
    const N = input.length;
    
    for (let k = 0; k < this.numCoeffs; k++) {
      let sum = 0;
      for (let n = 0; n < N; n++) {
        sum += input[n] * Math.cos(Math.PI * k * (n + 0.5) / N);
      }
      output[k] = sum;
    }
    
    return output;
  }
}

// ============================================
// Template-Based Wake Word Detector
// ============================================

class TemplateWakeWordDetector implements WakeWordModel {
  name = 'template-matcher';
  wakeWords: string[];
  sampleRate = 16000;
  frameSize = 512;
  
  private mfccExtractor: MFCCExtractor;
  private templates: Map<string, Float32Array[][]> = new Map();
  private buffer: Float32Array[] = [];
  private maxBufferSize = 100; // ~3 seconds
  
  constructor(wakeWords: string[]) {
    this.wakeWords = wakeWords;
    this.mfccExtractor = new MFCCExtractor(this.sampleRate, this.frameSize);
    
    // Initialize with synthetic templates (in real impl, would use recorded samples)
    for (const word of wakeWords) {
      this.templates.set(word, this.generateSyntheticTemplates(word));
    }
  }
  
  /**
   * Generate synthetic templates for wake word
   */
  private generateSyntheticTemplates(word: string): Float32Array[][] {
    // In real implementation, these would be pre-recorded MFCC sequences
    // Here we just create placeholder templates
    const numTemplates = 3;
    const numFrames = Math.ceil(word.length * 5); // Rough estimate
    const templates: Float32Array[][] = [];
    
    for (let t = 0; t < numTemplates; t++) {
      const template: Float32Array[] = [];
      for (let f = 0; f < numFrames; f++) {
        const features = new Float32Array(13);
        // Fill with deterministic but word-dependent values
        for (let i = 0; i < 13; i++) {
          features[i] = Math.sin(word.charCodeAt(f % word.length) + i + t) * 0.5;
        }
        template.push(features);
      }
      templates.push(template);
    }
    
    return templates;
  }
  
  /**
   * Process audio frame
   */
  process(audio: Float32Array): WakeWordResult {
    // Extract features
    const features = this.mfccExtractor.extract(audio);
    this.buffer.push(features);
    
    // Limit buffer size
    while (this.buffer.length > this.maxBufferSize) {
      this.buffer.shift();
    }
    
    // Check against templates
    const scores: Record<string, number> = {};
    let bestMatch = { wakeWord: '', score: 0 };
    
    for (const [word, templates] of this.templates) {
      let maxScore = 0;
      
      for (const template of templates) {
        const score = this.matchTemplate(this.buffer, template);
        maxScore = Math.max(maxScore, score);
      }
      
      scores[word] = maxScore;
      
      if (maxScore > bestMatch.score) {
        bestMatch = { wakeWord: word, score: maxScore };
      }
    }
    
    return {
      detected: bestMatch.score > 0.7,
      wakeWord: bestMatch.wakeWord,
      confidence: bestMatch.score,
      scores,
    };
  }
  
  /**
   * Match buffer against template using DTW
   */
  private matchTemplate(buffer: Float32Array[], template: Float32Array[]): number {
    if (buffer.length < template.length / 2) {
      return 0;
    }
    
    // Simple DTW distance
    const n = buffer.length;
    const m = template.length;
    const dtw = Array(n + 1).fill(null).map(() => Array(m + 1).fill(Infinity));
    dtw[0][0] = 0;
    
    for (let i = 1; i <= n; i++) {
      for (let j = 1; j <= m; j++) {
        const cost = this.featureDistance(buffer[i - 1], template[j - 1]);
        dtw[i][j] = cost + Math.min(dtw[i - 1][j], dtw[i][j - 1], dtw[i - 1][j - 1]);
      }
    }
    
    // Convert distance to similarity score
    const distance = dtw[n][m] / (n + m);
    return Math.exp(-distance);
  }
  
  /**
   * Euclidean distance between feature vectors
   */
  private featureDistance(a: Float32Array, b: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      const diff = a[i] - b[i];
      sum += diff * diff;
    }
    return Math.sqrt(sum);
  }
  
  /**
   * Reset buffer
   */
  reset(): void {
    this.buffer = [];
  }
}

// ============================================
// Wake Word Detector
// ============================================

const DEFAULT_CONFIG: WakeWordConfig = {
  wakeWords: ['hey nova', 'nova'],
  sensitivity: 0.5,
  minConfidence: 0.7,
  cooldownMs: 2000,
  audioContext: 1500,
  energyThreshold: 0.001,
  maxSilenceMs: 3000,
};

export class WakeWordDetector extends EventEmitter {
  private config: WakeWordConfig;
  private model: WakeWordModel;
  private isListening = false;
  private lastDetection: number = 0;
  private silenceStart: number = 0;
  private contextBuffer: Float32Array[] = [];
  private frameSize = 512;
  private framesPerContext: number;
  
  constructor(config?: Partial<WakeWordConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.model = new TemplateWakeWordDetector(this.config.wakeWords);
    
    // Calculate frames to keep for context
    const sampleRate = 16000;
    const msPerFrame = (this.frameSize / sampleRate) * 1000;
    this.framesPerContext = Math.ceil(this.config.audioContext / msPerFrame);
  }
  
  /**
   * Start wake word detection
   */
  start(): void {
    if (this.isListening) return;
    
    this.isListening = true;
    this.silenceStart = Date.now();
    
    logger.info('Wake word detection started', { wakeWords: this.config.wakeWords });
    this.emit('started');
  }
  
  /**
   * Stop wake word detection
   */
  stop(): void {
    if (!this.isListening) return;
    
    this.isListening = false;
    this.contextBuffer = [];
    
    logger.info('Wake word detection stopped');
    this.emit('stopped');
  }
  
  /**
   * Process audio frame
   */
  processAudio(audio: AudioChunk): WakeWordDetection | null {
    if (!this.isListening) return null;
    
    const samples = audio.data instanceof Float32Array 
      ? audio.data 
      : new Float32Array(audio.data.buffer);
    
    // Calculate energy
    let energy = 0;
    for (let i = 0; i < samples.length; i++) {
      energy += samples[i] * samples[i];
    }
    energy = energy / samples.length;
    
    // Skip if below energy threshold
    if (energy < this.config.energyThreshold) {
      // Track silence
      if (Date.now() - this.silenceStart > this.config.maxSilenceMs) {
        (this.model as TemplateWakeWordDetector).reset?.();
        this.contextBuffer = [];
      }
      return null;
    }
    
    this.silenceStart = Date.now();
    
    // Add to context buffer
    this.contextBuffer.push(samples);
    while (this.contextBuffer.length > this.framesPerContext) {
      this.contextBuffer.shift();
    }
    
    // Check cooldown
    if (Date.now() - this.lastDetection < this.config.cooldownMs) {
      return null;
    }
    
    // Process through model
    const result = this.model.process(samples);
    
    // Apply sensitivity
    const adjustedConfidence = result.confidence * (0.5 + this.config.sensitivity * 0.5);
    
    if (result.detected && adjustedConfidence >= this.config.minConfidence) {
      this.lastDetection = Date.now();
      
      // Merge context buffer
      const contextLength = this.contextBuffer.reduce((acc, buf) => acc + buf.length, 0);
      const audioContext = new Float32Array(contextLength);
      let offset = 0;
      for (const buf of this.contextBuffer) {
        audioContext.set(buf, offset);
        offset += buf.length;
      }
      
      const detection: WakeWordDetection = {
        wakeWord: result.wakeWord!,
        confidence: adjustedConfidence,
        timestamp: Date.now(),
        audioContext,
      };
      
      logger.info('Wake word detected', {
        wakeWord: detection.wakeWord,
        confidence: detection.confidence.toFixed(2),
      });
      
      this.emit('detected', detection);
      return detection;
    }
    
    return null;
  }
  
  /**
   * Add custom wake word
   */
  addWakeWord(wakeWord: string): void {
    if (!this.config.wakeWords.includes(wakeWord)) {
      this.config.wakeWords.push(wakeWord);
      
      // Recreate model with new wake word
      this.model = new TemplateWakeWordDetector(this.config.wakeWords);
      
      logger.info('Wake word added', { wakeWord });
      this.emit('wake-word-added', wakeWord);
    }
  }
  
  /**
   * Remove wake word
   */
  removeWakeWord(wakeWord: string): void {
    const index = this.config.wakeWords.indexOf(wakeWord);
    if (index !== -1) {
      this.config.wakeWords.splice(index, 1);
      
      // Recreate model
      this.model = new TemplateWakeWordDetector(this.config.wakeWords);
      
      logger.info('Wake word removed', { wakeWord });
      this.emit('wake-word-removed', wakeWord);
    }
  }
  
  /**
   * Get configured wake words
   */
  getWakeWords(): string[] {
    return [...this.config.wakeWords];
  }
  
  /**
   * Set sensitivity
   */
  setSensitivity(sensitivity: number): void {
    this.config.sensitivity = Math.max(0, Math.min(1, sensitivity));
  }
  
  /**
   * Get status
   */
  getStatus(): {
    isListening: boolean;
    wakeWords: string[];
    sensitivity: number;
    lastDetection: number;
  } {
    return {
      isListening: this.isListening,
      wakeWords: this.config.wakeWords,
      sensitivity: this.config.sensitivity,
      lastDetection: this.lastDetection,
    };
  }
}

// ============================================
// Exports
// ============================================

export const wakeWordDetector = new WakeWordDetector();

// Re-export config alias (classes already exported at definition)
export { DEFAULT_CONFIG as DEFAULT_WAKE_WORD_CONFIG };
