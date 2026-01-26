/**
 * Atlas Desktop - Audio Analyzer
 * Real-time audio analysis for orb visualization reactivity
 *
 * Features:
 * - RMS level calculation for overall amplitude
 * - FFT-based frequency band analysis (bass, mid, treble)
 * - Beat/pulse detection for rhythmic effects
 * - Smooth value transitions to avoid jarring visual changes
 * - Throttled output for 60fps rendering
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import {
  AudioSpectrum,
  AudioAnalysisConfig,
  DEFAULT_AUDIO_ANALYSIS_CONFIG,
} from '../../shared/types/voice';

const logger = createModuleLogger('AudioAnalyzer');

/**
 * Audio analyzer events
 */
export interface AudioAnalyzerEvents {
  /** Spectrum data updated */
  spectrum: (data: AudioSpectrum) => void;
  /** Error occurred */
  error: (error: Error) => void;
}

/**
 * Frequency band definitions (Hz ranges at 16kHz sample rate)
 * With FFT size of 256 and 16kHz sample rate, each bin = 62.5Hz
 */
interface FrequencyBands {
  bass: { start: number; end: number }; // 0-250Hz (bins 0-4)
  lowMid: { start: number; end: number }; // 250-500Hz (bins 4-8)
  mid: { start: number; end: number }; // 500-2000Hz (bins 8-32)
  highMid: { start: number; end: number }; // 2000-4000Hz (bins 32-64)
  treble: { start: number; end: number }; // 4000-8000Hz (bins 64-128)
}

const FREQUENCY_BANDS: FrequencyBands = {
  bass: { start: 0, end: 4 },
  lowMid: { start: 4, end: 8 },
  mid: { start: 8, end: 32 },
  highMid: { start: 32, end: 64 },
  treble: { start: 64, end: 128 },
};

/**
 * AudioAnalyzer class
 * Analyzes audio frames and emits spectrum data for visualization
 */
export class AudioAnalyzer extends EventEmitter {
  private config: AudioAnalysisConfig;

  // FFT processing
  private fftSize: number;
  private frequencyBins: number;
  private magnitudeBuffer: Float32Array;

  // Smoothed values (for smooth transitions)
  private smoothedLevel: number = 0;
  private smoothedBass: number = 0;
  private smoothedLowMid: number = 0;
  private smoothedMid: number = 0;
  private smoothedHighMid: number = 0;
  private smoothedTreble: number = 0;
  private smoothedPulse: number = 0;
  private smoothedExpansion: number = 1.0;

  // Beat detection state
  private bassHistory: number[] = [];
  private bassHistorySize: number = 30; // ~0.5s at 60fps
  private lastBeatTime: number = 0;
  private beatCooldownMs: number = 100; // Minimum time between beats

  // Throttling
  private lastEmitTime: number = 0;
  private minEmitInterval: number; // ms between emissions

  // Running state
  private isRunning: boolean = false;

  constructor(config?: Partial<AudioAnalysisConfig>) {
    super();
    this.config = { ...DEFAULT_AUDIO_ANALYSIS_CONFIG, ...config };

    // Initialize FFT buffers
    this.fftSize = this.config.fftSize;
    this.frequencyBins = this.fftSize / 2;
    this.magnitudeBuffer = new Float32Array(this.frequencyBins);

    // Calculate emit interval for target FPS
    this.minEmitInterval = 1000 / this.config.targetFps;

    logger.info('AudioAnalyzer initialized', {
      fftSize: this.fftSize,
      targetFps: this.config.targetFps,
      beatDetection: this.config.enableBeatDetection,
    });
  }

  /**
   * Start the audio analyzer
   */
  start(): void {
    if (this.isRunning) {
      return;
    }
    this.isRunning = true;
    this.reset();
    logger.info('AudioAnalyzer started');
  }

  /**
   * Stop the audio analyzer
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }
    this.isRunning = false;
    logger.info('AudioAnalyzer stopped');
  }

  /**
   * Reset analyzer state
   */
  reset(): void {
    this.smoothedLevel = 0;
    this.smoothedBass = 0;
    this.smoothedLowMid = 0;
    this.smoothedMid = 0;
    this.smoothedHighMid = 0;
    this.smoothedTreble = 0;
    this.smoothedPulse = 0;
    this.smoothedExpansion = this.config.expansionBase;
    this.bassHistory = [];
    this.lastBeatTime = 0;
    this.lastEmitTime = 0;
    this.magnitudeBuffer.fill(0);
  }

  /**
   * Process an audio frame (Int16Array from microphone)
   * @param frame Audio samples as Int16Array
   */
  processFrame(frame: Int16Array): void {
    if (!this.isRunning) {
      return;
    }

    const now = Date.now();

    // Throttle emissions to target FPS
    if (now - this.lastEmitTime < this.minEmitInterval) {
      return;
    }

    try {
      // Convert Int16 to Float32 normalized to [-1, 1]
      const floatSamples = this.int16ToFloat32(frame);

      // Calculate RMS level
      const rmsLevel = this.calculateRMS(floatSamples);

      // Perform FFT analysis using simple DFT approximation
      // (Full FFT would require complex-valued operations; we use magnitude estimation)
      this.computeMagnitudeSpectrum(floatSamples);

      // Calculate frequency band energies
      const bass = this.calculateBandEnergy(
        FREQUENCY_BANDS.bass.start,
        FREQUENCY_BANDS.bass.end
      );
      const lowMid = this.calculateBandEnergy(
        FREQUENCY_BANDS.lowMid.start,
        FREQUENCY_BANDS.lowMid.end
      );
      const mid = this.calculateBandEnergy(
        FREQUENCY_BANDS.mid.start,
        FREQUENCY_BANDS.mid.end
      );
      const highMid = this.calculateBandEnergy(
        FREQUENCY_BANDS.highMid.start,
        FREQUENCY_BANDS.highMid.end
      );
      const treble = this.calculateBandEnergy(
        FREQUENCY_BANDS.treble.start,
        FREQUENCY_BANDS.treble.end
      );

      // Detect beats based on bass energy
      const pulse = this.detectBeat(bass, now);

      // Calculate expansion factor
      const expansion = this.calculateExpansion(rmsLevel, bass);

      // Smooth all values
      const smoothing = this.config.smoothingTimeConstant;
      this.smoothedLevel = this.lerp(this.smoothedLevel, rmsLevel, 1 - smoothing);
      this.smoothedBass = this.lerp(this.smoothedBass, bass, 1 - smoothing);
      this.smoothedLowMid = this.lerp(this.smoothedLowMid, lowMid, 1 - smoothing);
      this.smoothedMid = this.lerp(this.smoothedMid, mid, 1 - smoothing);
      this.smoothedHighMid = this.lerp(this.smoothedHighMid, highMid, 1 - smoothing);
      this.smoothedTreble = this.lerp(this.smoothedTreble, treble, 1 - smoothing);
      // Pulse decays faster for snappy response
      this.smoothedPulse = this.lerp(this.smoothedPulse, pulse, 0.5);
      this.smoothedExpansion = this.lerp(this.smoothedExpansion, expansion, 1 - smoothing);

      // Create spectrum data
      const spectrum: AudioSpectrum = {
        timestamp: now,
        level: this.clamp(this.smoothedLevel, 0, 1),
        bass: this.clamp(this.smoothedBass, 0, 1),
        lowMid: this.clamp(this.smoothedLowMid, 0, 1),
        mid: this.clamp(this.smoothedMid, 0, 1),
        highMid: this.clamp(this.smoothedHighMid, 0, 1),
        treble: this.clamp(this.smoothedTreble, 0, 1),
        pulse: this.clamp(this.smoothedPulse, 0, 1),
        expansion: this.clamp(this.smoothedExpansion, 0.8, 1.5),
      };

      this.lastEmitTime = now;
      this.emit('spectrum', spectrum);
    } catch (error) {
      logger.error('Error processing audio frame', { error });
      this.emit('error', error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Process a Float32Array audio frame (already normalized)
   */
  processFloatFrame(frame: Float32Array): void {
    if (!this.isRunning) {
      return;
    }

    const now = Date.now();

    // Throttle emissions to target FPS
    if (now - this.lastEmitTime < this.minEmitInterval) {
      return;
    }

    try {
      // Calculate RMS level
      const rmsLevel = this.calculateRMS(frame);

      // Perform FFT analysis
      this.computeMagnitudeSpectrum(frame);

      // Calculate frequency band energies
      const bass = this.calculateBandEnergy(
        FREQUENCY_BANDS.bass.start,
        FREQUENCY_BANDS.bass.end
      );
      const lowMid = this.calculateBandEnergy(
        FREQUENCY_BANDS.lowMid.start,
        FREQUENCY_BANDS.lowMid.end
      );
      const mid = this.calculateBandEnergy(
        FREQUENCY_BANDS.mid.start,
        FREQUENCY_BANDS.mid.end
      );
      const highMid = this.calculateBandEnergy(
        FREQUENCY_BANDS.highMid.start,
        FREQUENCY_BANDS.highMid.end
      );
      const treble = this.calculateBandEnergy(
        FREQUENCY_BANDS.treble.start,
        FREQUENCY_BANDS.treble.end
      );

      // Detect beats based on bass energy
      const pulse = this.detectBeat(bass, now);

      // Calculate expansion factor
      const expansion = this.calculateExpansion(rmsLevel, bass);

      // Smooth all values
      const smoothing = this.config.smoothingTimeConstant;
      this.smoothedLevel = this.lerp(this.smoothedLevel, rmsLevel, 1 - smoothing);
      this.smoothedBass = this.lerp(this.smoothedBass, bass, 1 - smoothing);
      this.smoothedLowMid = this.lerp(this.smoothedLowMid, lowMid, 1 - smoothing);
      this.smoothedMid = this.lerp(this.smoothedMid, mid, 1 - smoothing);
      this.smoothedHighMid = this.lerp(this.smoothedHighMid, highMid, 1 - smoothing);
      this.smoothedTreble = this.lerp(this.smoothedTreble, treble, 1 - smoothing);
      this.smoothedPulse = this.lerp(this.smoothedPulse, pulse, 0.5);
      this.smoothedExpansion = this.lerp(this.smoothedExpansion, expansion, 1 - smoothing);

      // Create spectrum data
      const spectrum: AudioSpectrum = {
        timestamp: now,
        level: this.clamp(this.smoothedLevel, 0, 1),
        bass: this.clamp(this.smoothedBass, 0, 1),
        lowMid: this.clamp(this.smoothedLowMid, 0, 1),
        mid: this.clamp(this.smoothedMid, 0, 1),
        highMid: this.clamp(this.smoothedHighMid, 0, 1),
        treble: this.clamp(this.smoothedTreble, 0, 1),
        pulse: this.clamp(this.smoothedPulse, 0, 1),
        expansion: this.clamp(this.smoothedExpansion, 0.8, 1.5),
      };

      this.lastEmitTime = now;
      this.emit('spectrum', spectrum);
    } catch (error) {
      logger.error('Error processing float audio frame', { error });
      this.emit('error', error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Convert Int16Array to Float32Array normalized to [-1, 1]
   */
  private int16ToFloat32(frame: Int16Array): Float32Array {
    const float32 = new Float32Array(frame.length);
    for (let i = 0; i < frame.length; i++) {
      float32[i] = frame[i] / 32768;
    }
    return float32;
  }

  /**
   * Calculate RMS (Root Mean Square) level
   */
  private calculateRMS(samples: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < samples.length; i++) {
      sum += samples[i] * samples[i];
    }
    const rms = Math.sqrt(sum / samples.length);
    // Normalize and amplify for better visual response
    return Math.min(1, rms * 3);
  }

  /**
   * Compute magnitude spectrum using simplified DFT
   * For real-time performance, we use a windowed approximation
   */
  private computeMagnitudeSpectrum(samples: Float32Array): void {
    const N = Math.min(samples.length, this.fftSize);

    // Apply Hann window and compute magnitude for each frequency bin
    for (let k = 0; k < this.frequencyBins; k++) {
      let real = 0;
      let imag = 0;

      // DFT calculation for frequency bin k
      for (let n = 0; n < N; n++) {
        // Hann window
        const window = 0.5 * (1 - Math.cos((2 * Math.PI * n) / (N - 1)));
        const sample = samples[n] * window;

        // Complex exponential
        const angle = (2 * Math.PI * k * n) / N;
        real += sample * Math.cos(angle);
        imag -= sample * Math.sin(angle);
      }

      // Magnitude
      this.magnitudeBuffer[k] = Math.sqrt(real * real + imag * imag) / N;
    }
  }

  /**
   * Calculate energy in a frequency band
   */
  private calculateBandEnergy(startBin: number, endBin: number): number {
    let energy = 0;
    const binCount = Math.min(endBin, this.frequencyBins) - startBin;

    if (binCount <= 0) {
      return 0;
    }

    for (let i = startBin; i < Math.min(endBin, this.frequencyBins); i++) {
      energy += this.magnitudeBuffer[i];
    }

    // Normalize by bin count and amplify for visual response
    const normalizedEnergy = (energy / binCount) * 10;
    return Math.min(1, normalizedEnergy);
  }

  /**
   * Detect beats based on bass energy threshold
   */
  private detectBeat(bass: number, now: number): number {
    if (!this.config.enableBeatDetection) {
      return 0;
    }

    // Add current bass to history
    this.bassHistory.push(bass);
    if (this.bassHistory.length > this.bassHistorySize) {
      this.bassHistory.shift();
    }

    // Need enough history for beat detection
    if (this.bassHistory.length < 10) {
      return 0;
    }

    // Calculate average bass level
    const avgBass = this.bassHistory.reduce((a, b) => a + b, 0) / this.bassHistory.length;

    // Check for beat (bass spike above threshold * average)
    const threshold = avgBass * this.config.beatThreshold;
    const isBeat =
      bass > threshold &&
      bass > 0.1 && // Minimum absolute threshold
      now - this.lastBeatTime > this.beatCooldownMs;

    if (isBeat) {
      this.lastBeatTime = now;
      return 1.0; // Full pulse on beat
    }

    return 0;
  }

  /**
   * Calculate expansion factor based on audio levels
   */
  private calculateExpansion(level: number, bass: number): number {
    const base = this.config.expansionBase;
    const audioMultiplier = this.config.expansionAudioMultiplier;

    // Combine overall level and bass for expansion
    const audioInfluence = (level * 0.5 + bass * 0.5);
    const expansion = base + audioInfluence * audioMultiplier;

    return expansion;
  }

  /**
   * Linear interpolation
   */
  private lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
  }

  /**
   * Clamp value to range
   */
  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  /**
   * Get current configuration
   */
  getConfig(): AudioAnalysisConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<AudioAnalysisConfig>): void {
    this.config = { ...this.config, ...config };

    if (config.fftSize && config.fftSize !== this.fftSize) {
      this.fftSize = config.fftSize;
      this.frequencyBins = this.fftSize / 2;
      this.magnitudeBuffer = new Float32Array(this.frequencyBins);
    }

    if (config.targetFps) {
      this.minEmitInterval = 1000 / config.targetFps;
    }

    logger.info('AudioAnalyzer config updated', config);
  }

  /**
   * Check if analyzer is running
   */
  get running(): boolean {
    return this.isRunning;
  }

  // Type-safe event emitter methods
  on<K extends keyof AudioAnalyzerEvents>(event: K, listener: AudioAnalyzerEvents[K]): this {
    return super.on(event, listener);
  }

  off<K extends keyof AudioAnalyzerEvents>(event: K, listener: AudioAnalyzerEvents[K]): this {
    return super.off(event, listener);
  }

  emit<K extends keyof AudioAnalyzerEvents>(
    event: K,
    ...args: Parameters<AudioAnalyzerEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }
}

// Singleton instance
let audioAnalyzer: AudioAnalyzer | null = null;

/**
 * Get or create the audio analyzer instance
 */
export function getAudioAnalyzer(): AudioAnalyzer {
  if (!audioAnalyzer) {
    audioAnalyzer = new AudioAnalyzer();
  }
  return audioAnalyzer;
}

/**
 * Shutdown the audio analyzer
 */
export function shutdownAudioAnalyzer(): void {
  if (audioAnalyzer) {
    audioAnalyzer.stop();
    audioAnalyzer = null;
  }
}

export default AudioAnalyzer;
