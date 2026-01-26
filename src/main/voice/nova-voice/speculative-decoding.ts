/**
 * NovaVoice - Speculative Decoding
 * Reduce latency through speculative execution and caching
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../../utils/logger';
import { AudioChunk, StreamingTranscription, TTSSynthesisResult } from './types';

// Type aliases for backward compatibility
type TranscriptionResult = StreamingTranscription;
type SynthesisResult = TTSSynthesisResult;

const logger = createModuleLogger('NovaVoice-Speculative');

// ============================================
// Types
// ============================================

export interface PredictionContext {
  recentTexts: string[];
  currentPartial: string;
  conversationHistory: ConversationTurn[];
  userProfile: UserProfile;
}

export interface ConversationTurn {
  role: 'user' | 'assistant';
  text: string;
  timestamp: number;
}

export interface UserProfile {
  commonPhrases: Map<string, number>;     // phrase -> frequency
  vocabulary: Set<string>;
  speakingStyle: 'formal' | 'casual' | 'mixed';
  avgSentenceLength: number;
}

export interface Prediction {
  text: string;
  confidence: number;
  source: 'ngram' | 'pattern' | 'prefix' | 'contextual';
  speculativeTTS?: Buffer;  // Pre-generated audio
}

export interface CacheEntry<T> {
  key: string;
  value: T;
  timestamp: number;
  hits: number;
  size: number;
}

export interface SpeculativeConfig {
  enablePrediction: boolean;
  enableTTSPrefetch: boolean;
  maxPredictions: number;
  minConfidence: number;
  cacheMaxSize: number;      // bytes
  cacheTTL: number;          // ms
  contextWindowSize: number;
}

// ============================================
// LRU Cache
// ============================================

export class LRUCache<T> {
  private cache: Map<string, CacheEntry<T>> = new Map();
  private maxSize: number;
  private currentSize = 0;
  private ttl: number;
  
  constructor(maxSize: number, ttl: number) {
    this.maxSize = maxSize;
    this.ttl = ttl;
  }
  
  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    
    if (!entry) return undefined;
    
    // Check TTL
    if (Date.now() - entry.timestamp > this.ttl) {
      this.delete(key);
      return undefined;
    }
    
    // Update access order (LRU)
    entry.hits++;
    this.cache.delete(key);
    this.cache.set(key, entry);
    
    return entry.value;
  }
  
  set(key: string, value: T, size: number): void {
    // Remove if exists
    if (this.cache.has(key)) {
      this.delete(key);
    }
    
    // Evict if needed
    while (this.currentSize + size > this.maxSize && this.cache.size > 0) {
      const oldest = this.cache.keys().next().value;
      if (oldest) this.delete(oldest);
    }
    
    // Add entry
    this.cache.set(key, {
      key,
      value,
      timestamp: Date.now(),
      hits: 0,
      size,
    });
    
    this.currentSize += size;
  }
  
  delete(key: string): boolean {
    const entry = this.cache.get(key);
    if (entry) {
      this.currentSize -= entry.size;
      return this.cache.delete(key);
    }
    return false;
  }
  
  clear(): void {
    this.cache.clear();
    this.currentSize = 0;
  }
  
  getStats(): { size: number; entries: number; hitRate: number } {
    let totalHits = 0;
    for (const entry of this.cache.values()) {
      totalHits += entry.hits;
    }
    
    return {
      size: this.currentSize,
      entries: this.cache.size,
      hitRate: this.cache.size > 0 ? totalHits / this.cache.size : 0,
    };
  }
}

// ============================================
// N-gram Language Model
// ============================================

export class NgramModel {
  private unigrams: Map<string, number> = new Map();
  private bigrams: Map<string, Map<string, number>> = new Map();
  private trigrams: Map<string, Map<string, number>> = new Map();
  private totalTokens = 0;
  
  /**
   * Train on text corpus
   */
  train(text: string): void {
    const tokens = this.tokenize(text);
    
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      
      // Unigram
      this.unigrams.set(token, (this.unigrams.get(token) || 0) + 1);
      this.totalTokens++;
      
      // Bigram
      if (i > 0) {
        const prev = tokens[i - 1];
        if (!this.bigrams.has(prev)) {
          this.bigrams.set(prev, new Map());
        }
        const bigramMap = this.bigrams.get(prev)!;
        bigramMap.set(token, (bigramMap.get(token) || 0) + 1);
      }
      
      // Trigram
      if (i > 1) {
        const context = `${tokens[i - 2]} ${tokens[i - 1]}`;
        if (!this.trigrams.has(context)) {
          this.trigrams.set(context, new Map());
        }
        const trigramMap = this.trigrams.get(context)!;
        trigramMap.set(token, (trigramMap.get(token) || 0) + 1);
      }
    }
  }
  
  /**
   * Predict next tokens
   */
  predict(context: string, n: number = 5): Array<{ token: string; probability: number }> {
    const tokens = this.tokenize(context);
    const predictions: Map<string, number> = new Map();
    
    // Try trigram prediction
    if (tokens.length >= 2) {
      const trigramContext = `${tokens[tokens.length - 2]} ${tokens[tokens.length - 1]}`;
      const trigramPredictions = this.trigrams.get(trigramContext);
      
      if (trigramPredictions) {
        const total = Array.from(trigramPredictions.values()).reduce((a, b) => a + b, 0);
        for (const [token, count] of trigramPredictions) {
          predictions.set(token, (predictions.get(token) || 0) + (count / total) * 0.5);
        }
      }
    }
    
    // Try bigram prediction
    if (tokens.length >= 1) {
      const bigramContext = tokens[tokens.length - 1];
      const bigramPredictions = this.bigrams.get(bigramContext);
      
      if (bigramPredictions) {
        const total = Array.from(bigramPredictions.values()).reduce((a, b) => a + b, 0);
        for (const [token, count] of bigramPredictions) {
          predictions.set(token, (predictions.get(token) || 0) + (count / total) * 0.3);
        }
      }
    }
    
    // Fallback to unigram
    for (const [token, count] of this.unigrams) {
      const prob = count / this.totalTokens;
      predictions.set(token, (predictions.get(token) || 0) + prob * 0.2);
    }
    
    // Sort and return top n
    return Array.from(predictions.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([token, probability]) => ({ token, probability }));
  }
  
  /**
   * Complete a partial sentence
   */
  complete(partial: string, maxTokens: number = 5): string {
    let result = partial;
    
    for (let i = 0; i < maxTokens; i++) {
      const predictions = this.predict(result, 1);
      
      if (predictions.length === 0 || predictions[0].probability < 0.1) {
        break;
      }
      
      result += ' ' + predictions[0].token;
      
      // Stop at sentence end
      if (/[.!?]$/.test(predictions[0].token)) {
        break;
      }
    }
    
    return result;
  }
  
  private tokenize(text: string): string[] {
    return text.toLowerCase()
      .replace(/[^\w\s'.!?]/g, '')
      .split(/\s+/)
      .filter((t) => t.length > 0);
  }
}

// ============================================
// Speculative Decoder
// ============================================

const DEFAULT_CONFIG: SpeculativeConfig = {
  enablePrediction: true,
  enableTTSPrefetch: true,
  maxPredictions: 5,
  minConfidence: 0.3,
  cacheMaxSize: 50 * 1024 * 1024, // 50MB
  cacheTTL: 5 * 60 * 1000,        // 5 minutes
  contextWindowSize: 10,
};

export class SpeculativeDecoder extends EventEmitter {
  private config: SpeculativeConfig;
  private ngramModel: NgramModel;
  private ttsCache: LRUCache<Buffer>;
  private predictionCache: LRUCache<Prediction[]>;
  private conversationHistory: ConversationTurn[] = [];
  private userProfile: UserProfile;
  private currentPartial = '';
  private predictions: Prediction[] = [];
  
  // Common phrases for prediction
  private commonPhrases = [
    'thank you',
    'please help me',
    'what is',
    'how do I',
    'can you',
    'I need',
    'tell me',
    'show me',
    'search for',
    'open',
    'close',
    'stop',
    'start',
    'play',
    'pause',
  ];
  
  constructor(config?: Partial<SpeculativeConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    this.ngramModel = new NgramModel();
    this.ttsCache = new LRUCache(this.config.cacheMaxSize * 0.7, this.config.cacheTTL);
    this.predictionCache = new LRUCache(this.config.cacheMaxSize * 0.3, this.config.cacheTTL);
    
    this.userProfile = {
      commonPhrases: new Map(),
      vocabulary: new Set(),
      speakingStyle: 'mixed',
      avgSentenceLength: 10,
    };
    
    // Train on common phrases
    for (const phrase of this.commonPhrases) {
      this.ngramModel.train(phrase);
    }
  }
  
  /**
   * Update with partial transcription
   */
  updatePartial(text: string): Prediction[] {
    this.currentPartial = text;
    
    if (!this.config.enablePrediction) {
      return [];
    }
    
    // Check prediction cache
    const cacheKey = this.generateCacheKey(text);
    const cached = this.predictionCache.get(cacheKey);
    if (cached) {
      this.predictions = cached;
      return cached;
    }
    
    // Generate predictions
    this.predictions = this.generatePredictions(text);
    
    // Cache predictions
    this.predictionCache.set(cacheKey, this.predictions, JSON.stringify(this.predictions).length);
    
    // Prefetch TTS for high-confidence predictions
    if (this.config.enableTTSPrefetch) {
      this.prefetchTTS(this.predictions);
    }
    
    this.emit('predictions', this.predictions);
    return this.predictions;
  }
  
  /**
   * Generate predictions for partial text
   */
  private generatePredictions(partial: string): Prediction[] {
    const predictions: Prediction[] = [];
    const normalizedPartial = partial.toLowerCase().trim();
    
    // 1. Prefix matching from common phrases
    for (const phrase of this.commonPhrases) {
      if (phrase.startsWith(normalizedPartial) && phrase !== normalizedPartial) {
        const confidence = normalizedPartial.length / phrase.length;
        if (confidence >= this.config.minConfidence) {
          predictions.push({
            text: phrase,
            confidence,
            source: 'prefix',
          });
        }
      }
    }
    
    // 2. User's common phrases
    for (const [phrase, freq] of this.userProfile.commonPhrases) {
      if (phrase.startsWith(normalizedPartial) && phrase !== normalizedPartial) {
        const baseConfidence = normalizedPartial.length / phrase.length;
        const freqBoost = Math.min(0.2, freq * 0.02);
        predictions.push({
          text: phrase,
          confidence: baseConfidence + freqBoost,
          source: 'pattern',
        });
      }
    }
    
    // 3. N-gram completion
    if (partial.split(' ').length >= 2) {
      const completion = this.ngramModel.complete(partial, 3);
      if (completion !== partial) {
        predictions.push({
          text: completion,
          confidence: 0.4,
          source: 'ngram',
        });
      }
    }
    
    // 4. Contextual predictions from conversation
    const contextualPreds = this.getContextualPredictions(partial);
    predictions.push(...contextualPreds);
    
    // Sort by confidence and limit
    return predictions
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, this.config.maxPredictions);
  }
  
  /**
   * Get contextual predictions from conversation history
   */
  private getContextualPredictions(partial: string): Prediction[] {
    const predictions: Prediction[] = [];
    
    // Look for similar contexts in history
    for (const turn of this.conversationHistory) {
      if (turn.role === 'user' && turn.text.toLowerCase().startsWith(partial.toLowerCase())) {
        if (turn.text.toLowerCase() !== partial.toLowerCase()) {
          predictions.push({
            text: turn.text,
            confidence: 0.5,
            source: 'contextual',
          });
        }
      }
    }
    
    return predictions;
  }
  
  /**
   * Prefetch TTS for predictions
   */
  private async prefetchTTS(predictions: Prediction[]): Promise<void> {
    const highConfidence = predictions.filter((p) => p.confidence >= 0.6);
    
    for (const prediction of highConfidence) {
      // Check if already cached
      const cacheKey = this.generateTTSCacheKey(prediction.text);
      if (this.ttsCache.get(cacheKey)) continue;
      
      // Emit prefetch request
      this.emit('prefetch-tts', prediction.text);
    }
  }
  
  /**
   * Store prefetched TTS audio
   */
  cacheTTS(text: string, audio: Buffer): void {
    const cacheKey = this.generateTTSCacheKey(text);
    this.ttsCache.set(cacheKey, audio, audio.length);
    
    // Update predictions with audio
    const prediction = this.predictions.find((p) => p.text === text);
    if (prediction) {
      prediction.speculativeTTS = audio;
    }
  }
  
  /**
   * Get cached TTS
   */
  getCachedTTS(text: string): Buffer | undefined {
    const cacheKey = this.generateTTSCacheKey(text);
    return this.ttsCache.get(cacheKey);
  }
  
  /**
   * Check if prediction was correct
   */
  validatePrediction(finalText: string): Prediction | null {
    const matched = this.predictions.find(
      (p) => finalText.toLowerCase() === p.text.toLowerCase()
    );
    
    if (matched) {
      logger.debug('Prediction validated', { text: finalText, confidence: matched.confidence });
      this.emit('prediction-validated', matched);
      
      // Update user profile
      this.updateUserProfile(finalText);
      
      return matched;
    }
    
    // No prediction matched - learn from this
    this.updateUserProfile(finalText);
    
    return null;
  }
  
  /**
   * Add conversation turn
   */
  addConversationTurn(role: 'user' | 'assistant', text: string): void {
    this.conversationHistory.push({
      role,
      text,
      timestamp: Date.now(),
    });
    
    // Limit history size
    while (this.conversationHistory.length > this.config.contextWindowSize * 2) {
      this.conversationHistory.shift();
    }
    
    // Train n-gram model on user input
    if (role === 'user') {
      this.ngramModel.train(text);
    }
  }
  
  /**
   * Update user profile with new phrase
   */
  private updateUserProfile(text: string): void {
    const normalized = text.toLowerCase().trim();
    
    // Update common phrases
    const currentFreq = this.userProfile.commonPhrases.get(normalized) || 0;
    this.userProfile.commonPhrases.set(normalized, currentFreq + 1);
    
    // Update vocabulary
    const words = normalized.split(/\s+/);
    for (const word of words) {
      this.userProfile.vocabulary.add(word);
    }
    
    // Update average sentence length
    const totalPhrases = Array.from(this.userProfile.commonPhrases.values())
      .reduce((a, b) => a + b, 0);
    this.userProfile.avgSentenceLength = 
      (this.userProfile.avgSentenceLength * (totalPhrases - 1) + words.length) / totalPhrases;
  }
  
  /**
   * Get current predictions
   */
  getPredictions(): Prediction[] {
    return [...this.predictions];
  }
  
  /**
   * Get cache statistics
   */
  getCacheStats(): {
    tts: { size: number; entries: number; hitRate: number };
    prediction: { size: number; entries: number; hitRate: number };
  } {
    return {
      tts: this.ttsCache.getStats(),
      prediction: this.predictionCache.getStats(),
    };
  }
  
  /**
   * Clear caches
   */
  clearCache(): void {
    this.ttsCache.clear();
    this.predictionCache.clear();
    this.predictions = [];
  }
  
  /**
   * Reset all state
   */
  reset(): void {
    this.clearCache();
    this.conversationHistory = [];
    this.currentPartial = '';
    this.emit('reset');
  }
  
  private generateCacheKey(text: string): string {
    return `pred_${text.toLowerCase().trim()}`;
  }
  
  private generateTTSCacheKey(text: string): string {
    return `tts_${text.toLowerCase().trim()}`;
  }
}

// ============================================
// Model Warmup
// ============================================

export class ModelWarmup {
  private warmupComplete = false;
  
  /**
   * Warm up models with dummy inference
   */
  async warmup(callbacks: {
    stt?: (audio: Float32Array) => Promise<void>;
    tts?: (text: string) => Promise<void>;
    vad?: (audio: Float32Array) => Promise<void>;
  }): Promise<{ sttMs?: number; ttsMs?: number; vadMs?: number }> {
    const results: { sttMs?: number; ttsMs?: number; vadMs?: number } = {};
    
    // Generate dummy audio
    const dummyAudio = new Float32Array(16000); // 1 second at 16kHz
    for (let i = 0; i < dummyAudio.length; i++) {
      dummyAudio[i] = Math.sin(2 * Math.PI * 440 * i / 16000) * 0.3;
    }
    
    // Warmup VAD
    if (callbacks.vad) {
      const start = performance.now();
      await callbacks.vad(dummyAudio.slice(0, 1600)); // 100ms
      results.vadMs = performance.now() - start;
      logger.info('VAD warmup complete', { ms: results.vadMs });
    }
    
    // Warmup STT
    if (callbacks.stt) {
      const start = performance.now();
      await callbacks.stt(dummyAudio);
      results.sttMs = performance.now() - start;
      logger.info('STT warmup complete', { ms: results.sttMs });
    }
    
    // Warmup TTS
    if (callbacks.tts) {
      const start = performance.now();
      await callbacks.tts('Hello');
      results.ttsMs = performance.now() - start;
      logger.info('TTS warmup complete', { ms: results.ttsMs });
    }
    
    this.warmupComplete = true;
    return results;
  }
  
  isWarmupComplete(): boolean {
    return this.warmupComplete;
  }
}

// ============================================
// Exports
// ============================================

export const speculativeDecoder = new SpeculativeDecoder();
export const modelWarmup = new ModelWarmup();
export { DEFAULT_CONFIG as DEFAULT_SPECULATIVE_CONFIG };
