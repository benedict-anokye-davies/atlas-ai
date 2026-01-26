/**
 * NovaVoice - Testing Utilities
 * Comprehensive testing framework for voice components
 */

import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createModuleLogger } from '../../utils/logger';
import { AudioChunk, AudioFormat, StreamingTranscription, TTSSynthesisResult } from './types';

// Type aliases for backwards compatibility
type TranscriptionResult = StreamingTranscription;
type SynthesisResult = TTSSynthesisResult;

const logger = createModuleLogger('NovaVoice-Testing');

// ============================================
// Types
// ============================================

export interface TestCase {
  id: string;
  name: string;
  description?: string;
  input: TestInput;
  expected: TestExpectation;
  tags?: string[];
}

export interface TestInput {
  type: 'audio' | 'text' | 'config';
  data: unknown;
  options?: Record<string, unknown>;
}

export interface TestExpectation {
  type: 'transcription' | 'synthesis' | 'vad' | 'latency' | 'accuracy';
  value?: unknown;
  tolerance?: number;
  minConfidence?: number;
  maxLatencyMs?: number;
}

export interface TestResult {
  testId: string;
  passed: boolean;
  actualValue: unknown;
  expectedValue: unknown;
  latencyMs: number;
  error?: string;
  metrics?: Record<string, number>;
}

export interface BenchmarkResult {
  name: string;
  runs: number;
  avgLatencyMs: number;
  minLatencyMs: number;
  maxLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  throughput: number;
  errors: number;
}

// ============================================
// Audio Generator
// ============================================

export class AudioGenerator {
  private sampleRate: number;
  
  constructor(sampleRate = 16000) {
    this.sampleRate = sampleRate;
  }
  
  /**
   * Generate sine wave audio
   */
  generateSineWave(frequencyHz: number, durationMs: number, amplitude = 0.5): Float32Array {
    const numSamples = Math.floor((durationMs / 1000) * this.sampleRate);
    const samples = new Float32Array(numSamples);
    
    for (let i = 0; i < numSamples; i++) {
      samples[i] = amplitude * Math.sin(2 * Math.PI * frequencyHz * i / this.sampleRate);
    }
    
    return samples;
  }
  
  /**
   * Generate white noise
   */
  generateWhiteNoise(durationMs: number, amplitude = 0.3): Float32Array {
    const numSamples = Math.floor((durationMs / 1000) * this.sampleRate);
    const samples = new Float32Array(numSamples);
    
    for (let i = 0; i < numSamples; i++) {
      samples[i] = (Math.random() * 2 - 1) * amplitude;
    }
    
    return samples;
  }
  
  /**
   * Generate silence
   */
  generateSilence(durationMs: number): Float32Array {
    const numSamples = Math.floor((durationMs / 1000) * this.sampleRate);
    return new Float32Array(numSamples);
  }
  
  /**
   * Generate speech-like audio (periodic + noise)
   */
  generateSpeechLike(durationMs: number): Float32Array {
    const numSamples = Math.floor((durationMs / 1000) * this.sampleRate);
    const samples = new Float32Array(numSamples);
    
    // Fundamental frequency around 120Hz (male voice)
    const f0 = 120;
    
    for (let i = 0; i < numSamples; i++) {
      // Glottal pulse approximation
      let sample = 0;
      
      // Add harmonics
      for (let h = 1; h <= 10; h++) {
        const amplitude = 0.3 / h;
        sample += amplitude * Math.sin(2 * Math.PI * f0 * h * i / this.sampleRate);
      }
      
      // Add slight noise
      sample += (Math.random() * 2 - 1) * 0.05;
      
      // Add amplitude envelope
      const envelope = Math.sin(Math.PI * i / numSamples);
      samples[i] = sample * envelope * 0.5;
    }
    
    return samples;
  }
  
  /**
   * Concatenate audio segments
   */
  concatenate(...segments: Float32Array[]): Float32Array {
    const totalLength = segments.reduce((acc, s) => acc + s.length, 0);
    const result = new Float32Array(totalLength);
    
    let offset = 0;
    for (const segment of segments) {
      result.set(segment, offset);
      offset += segment.length;
    }
    
    return result;
  }
  
  /**
   * Add noise to audio
   */
  addNoise(audio: Float32Array, snrDb: number): Float32Array {
    const result = new Float32Array(audio.length);
    
    // Calculate signal power
    let signalPower = 0;
    for (let i = 0; i < audio.length; i++) {
      signalPower += audio[i] * audio[i];
    }
    signalPower /= audio.length;
    
    // Calculate noise power
    const noisePower = signalPower / Math.pow(10, snrDb / 10);
    const noiseAmplitude = Math.sqrt(noisePower);
    
    // Add noise
    for (let i = 0; i < audio.length; i++) {
      result[i] = audio[i] + (Math.random() * 2 - 1) * noiseAmplitude;
    }
    
    return result;
  }
  
  /**
   * Create AudioChunk from samples
   */
  createChunk(samples: Float32Array, timestamp = Date.now()): AudioChunk {
    return {
      data: samples,
      timestamp,
      duration: (samples.length / this.sampleRate) * 1000,
      format: {
        sampleRate: this.sampleRate,
        channels: 1,
        bitDepth: 32,
        encoding: 'float32',
      },
    };
  }
}

// ============================================
// Mock STT Engine
// ============================================

export class MockSTTEngine {
  private responses: Map<string, TranscriptionResult> = new Map();
  private delay: number;
  private errorRate: number;
  
  constructor(delayMs = 50, errorRate = 0) {
    this.delay = delayMs;
    this.errorRate = errorRate;
  }
  
  /**
   * Set mock response for audio hash
   */
  setResponse(audioHash: string, result: TranscriptionResult): void {
    this.responses.set(audioHash, result);
  }
  
  /**
   * Transcribe audio (mock)
   */
  async transcribe(audio: AudioChunk): Promise<TranscriptionResult> {
    await this.simulateDelay();
    
    if (Math.random() < this.errorRate) {
      throw new Error('Mock STT error');
    }
    
    const hash = this.hashAudio(audio.data);
    const response = this.responses.get(hash);
    
    if (response) {
      return response;
    }
    
    // Default response
    return {
      partial: '',
      final: 'mock transcription',
      segments: [],
      ttft: 50,
      totalLatency: 100,
      language: 'en',
      isComplete: true,
    };
  }
  
  private async simulateDelay(): Promise<void> {
    if (this.delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delay));
    }
  }
  
  private hashAudio(data: Float32Array | Buffer): string {
    const samples = data instanceof Float32Array ? data : new Float32Array(data.buffer);
    let hash = 0;
    for (let i = 0; i < Math.min(samples.length, 1000); i += 10) {
      hash += samples[i] * (i + 1);
    }
    return hash.toString(36);
  }
}

// ============================================
// Mock TTS Engine
// ============================================

export class MockTTSEngine {
  private sampleRate: number;
  private delay: number;
  private errorRate: number;
  
  constructor(sampleRate = 24000, delayMs = 30, errorRate = 0) {
    this.sampleRate = sampleRate;
    this.delay = delayMs;
    this.errorRate = errorRate;
  }
  
  /**
   * Synthesize speech (mock)
   */
  async synthesize(text: string): Promise<SynthesisResult> {
    await this.simulateDelay();
    
    if (Math.random() < this.errorRate) {
      throw new Error('Mock TTS error');
    }
    
    // Generate mock audio based on text length
    const durationMs = Math.max(200, text.length * 50);
    const generator = new AudioGenerator(this.sampleRate);
    const audio = generator.generateSpeechLike(durationMs);
    
    return {
      audio: Buffer.from(audio.buffer),
      format: { sampleRate: this.sampleRate, channels: 1, bitDepth: 32, encoding: 'float32' as const },
      duration: durationMs,
      ttfb: 30,
      totalLatency: this.delay,
      voiceId: 'mock-voice',
      textLength: text.length,
    };
  }
  
  /**
   * Synthesize with streaming
   */
  async *synthesizeStreaming(text: string, chunkMs = 100): AsyncGenerator<AudioChunk> {
    const totalDurationMs = Math.max(200, text.length * 50);
    const generator = new AudioGenerator(this.sampleRate);
    const chunksCount = Math.ceil(totalDurationMs / chunkMs);
    
    for (let i = 0; i < chunksCount; i++) {
      await this.simulateDelay();
      
      if (Math.random() < this.errorRate) {
        throw new Error('Mock TTS streaming error');
      }
      
      const chunkDuration = Math.min(chunkMs, totalDurationMs - i * chunkMs);
      const audio = generator.generateSpeechLike(chunkDuration);
      
      yield generator.createChunk(audio);
    }
  }
  
  private async simulateDelay(): Promise<void> {
    if (this.delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delay));
    }
  }
}

// ============================================
// Test Runner
// ============================================

export class TestRunner extends EventEmitter {
  private tests: TestCase[] = [];
  private results: TestResult[] = [];
  
  /**
   * Add test case
   */
  addTest(test: TestCase): void {
    this.tests.push(test);
  }
  
  /**
   * Add multiple tests
   */
  addTests(tests: TestCase[]): void {
    this.tests.push(...tests);
  }
  
  /**
   * Run all tests
   */
  async runAll(): Promise<TestResult[]> {
    this.results = [];
    
    for (const test of this.tests) {
      const result = await this.runTest(test);
      this.results.push(result);
      this.emit('test-complete', result);
    }
    
    this.emit('suite-complete', this.results);
    return this.results;
  }
  
  /**
   * Run tests by tag
   */
  async runByTag(tag: string): Promise<TestResult[]> {
    const filtered = this.tests.filter((t) => t.tags?.includes(tag));
    
    this.results = [];
    
    for (const test of filtered) {
      const result = await this.runTest(test);
      this.results.push(result);
      this.emit('test-complete', result);
    }
    
    return this.results;
  }
  
  /**
   * Run single test
   */
  private async runTest(test: TestCase): Promise<TestResult> {
    const startTime = performance.now();
    
    try {
      const actualValue = await this.executeTest(test);
      const latencyMs = performance.now() - startTime;
      
      const passed = this.evaluateResult(test.expected, actualValue, latencyMs);
      
      return {
        testId: test.id,
        passed,
        actualValue,
        expectedValue: test.expected.value,
        latencyMs,
      };
    } catch (error) {
      return {
        testId: test.id,
        passed: false,
        actualValue: null,
        expectedValue: test.expected.value,
        latencyMs: performance.now() - startTime,
        error: (error as Error).message,
      };
    }
  }
  
  /**
   * Execute test input
   */
  private async executeTest(test: TestCase): Promise<unknown> {
    // This would be overridden by specific test implementations
    return test.input.data;
  }
  
  /**
   * Evaluate test result
   */
  private evaluateResult(
    expected: TestExpectation,
    actual: unknown,
    latencyMs: number
  ): boolean {
    // Check latency constraint
    if (expected.maxLatencyMs !== undefined && latencyMs > expected.maxLatencyMs) {
      return false;
    }
    
    // Check value
    if (expected.value !== undefined) {
      if (typeof expected.value === 'number' && typeof actual === 'number') {
        const tolerance = expected.tolerance || 0.01;
        return Math.abs(expected.value - actual) <= tolerance;
      }
      
      if (typeof expected.value === 'string' && typeof actual === 'string') {
        return expected.value.toLowerCase() === actual.toLowerCase();
      }
      
      return expected.value === actual;
    }
    
    return true;
  }
  
  /**
   * Get test results summary
   */
  getSummary(): {
    total: number;
    passed: number;
    failed: number;
    avgLatencyMs: number;
  } {
    const passed = this.results.filter((r) => r.passed).length;
    const avgLatency = this.results.reduce((acc, r) => acc + r.latencyMs, 0) / this.results.length;
    
    return {
      total: this.results.length,
      passed,
      failed: this.results.length - passed,
      avgLatencyMs: avgLatency,
    };
  }
}

// ============================================
// Benchmark Runner
// ============================================

export class BenchmarkRunner {
  /**
   * Run benchmark
   */
  async run(
    name: string,
    fn: () => Promise<void>,
    options: { runs?: number; warmupRuns?: number } = {}
  ): Promise<BenchmarkResult> {
    const { runs = 100, warmupRuns = 5 } = options;
    const latencies: number[] = [];
    let errors = 0;
    
    // Warmup
    for (let i = 0; i < warmupRuns; i++) {
      try {
        await fn();
      } catch {
        // Ignore warmup errors
      }
    }
    
    // Actual runs
    for (let i = 0; i < runs; i++) {
      const start = performance.now();
      try {
        await fn();
        latencies.push(performance.now() - start);
      } catch {
        errors++;
      }
    }
    
    // Calculate statistics
    latencies.sort((a, b) => a - b);
    
    const sum = latencies.reduce((a, b) => a + b, 0);
    const avg = sum / latencies.length;
    
    const p50Index = Math.floor(latencies.length * 0.5);
    const p95Index = Math.floor(latencies.length * 0.95);
    const p99Index = Math.floor(latencies.length * 0.99);
    
    return {
      name,
      runs,
      avgLatencyMs: avg,
      minLatencyMs: latencies[0],
      maxLatencyMs: latencies[latencies.length - 1],
      p50LatencyMs: latencies[p50Index],
      p95LatencyMs: latencies[p95Index],
      p99LatencyMs: latencies[p99Index] || latencies[latencies.length - 1],
      throughput: 1000 / avg, // ops/second
      errors,
    };
  }
  
  /**
   * Compare multiple benchmarks
   */
  async compare(
    benchmarks: Array<{ name: string; fn: () => Promise<void> }>,
    options: { runs?: number; warmupRuns?: number } = {}
  ): Promise<BenchmarkResult[]> {
    const results: BenchmarkResult[] = [];
    
    for (const { name, fn } of benchmarks) {
      const result = await this.run(name, fn, options);
      results.push(result);
    }
    
    return results;
  }
  
  /**
   * Format results as table
   */
  formatResults(results: BenchmarkResult[]): string {
    let output = '| Name | Avg (ms) | Min (ms) | P50 (ms) | P95 (ms) | P99 (ms) | Throughput |\n';
    output += '|------|----------|----------|----------|----------|----------|------------|\n';
    
    for (const r of results) {
      output += `| ${r.name} | ${r.avgLatencyMs.toFixed(2)} | ${r.minLatencyMs.toFixed(2)} | `;
      output += `${r.p50LatencyMs.toFixed(2)} | ${r.p95LatencyMs.toFixed(2)} | `;
      output += `${r.p99LatencyMs.toFixed(2)} | ${r.throughput.toFixed(1)} ops/s |\n`;
    }
    
    return output;
  }
}

// ============================================
// Accuracy Calculator
// ============================================

export class AccuracyCalculator {
  /**
   * Calculate Word Error Rate (WER)
   */
  calculateWER(reference: string, hypothesis: string): number {
    const refWords = reference.toLowerCase().split(/\s+/);
    const hypWords = hypothesis.toLowerCase().split(/\s+/);
    
    const { distance, substitutions, insertions, deletions } = this.levenshtein(refWords, hypWords);
    
    return distance / refWords.length;
  }
  
  /**
   * Calculate Character Error Rate (CER)
   */
  calculateCER(reference: string, hypothesis: string): number {
    const refChars = reference.toLowerCase().split('');
    const hypChars = hypothesis.toLowerCase().split('');
    
    const { distance } = this.levenshtein(refChars, hypChars);
    
    return distance / refChars.length;
  }
  
  /**
   * Levenshtein distance with operations
   */
  private levenshtein(ref: string[], hyp: string[]): {
    distance: number;
    substitutions: number;
    insertions: number;
    deletions: number;
  } {
    const m = ref.length;
    const n = hyp.length;
    
    const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
    
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (ref[i - 1] === hyp[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1];
        } else {
          dp[i][j] = 1 + Math.min(
            dp[i - 1][j],     // deletion
            dp[i][j - 1],     // insertion
            dp[i - 1][j - 1]  // substitution
          );
        }
      }
    }
    
    // Backtrack to count operations (simplified)
    return {
      distance: dp[m][n],
      substitutions: 0, // Would need backtracking
      insertions: 0,
      deletions: 0,
    };
  }
}

// ============================================
// Exports
// ============================================

// Classes already exported at definition above
