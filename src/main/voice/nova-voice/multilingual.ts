/**
 * NovaVoice - Multi-Language Support
 * Language detection, translation, and multilingual voice management
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../../utils/logger';
import { getErrorMessage } from '../../../shared/utils';
import { StreamingTranscription, AudioChunk } from './types';

// Type alias for backward compatibility
type TranscriptionResult = StreamingTranscription;

const logger = createModuleLogger('NovaVoice-Multilingual');

// ============================================
// Types
// ============================================

export interface LanguageInfo {
  code: string;         // ISO 639-1 (e.g., 'en')
  code3: string;        // ISO 639-3 (e.g., 'eng')
  name: string;         // English name
  nativeName: string;   // Native name
  rtl: boolean;         // Right-to-left
  sttSupport: boolean;  // STT available
  ttsSupport: boolean;  // TTS available
}

export interface LanguageDetectionResult {
  language: string;
  confidence: number;
  alternatives: Array<{ language: string; confidence: number }>;
  isReliable: boolean;
}

export interface TranslationResult {
  originalText: string;
  translatedText: string;
  sourceLanguage: string;
  targetLanguage: string;
  confidence: number;
}

export interface MultilingualConfig {
  defaultLanguage: string;
  enableAutoDetection: boolean;
  detectionMinConfidence: number;
  enableTranslation: boolean;
  translationTarget: string;
  voiceMap: Record<string, string>; // language -> voiceId
}

// ============================================
// Language Database
// ============================================

export const SUPPORTED_LANGUAGES: LanguageInfo[] = [
  { code: 'en', code3: 'eng', name: 'English', nativeName: 'English', rtl: false, sttSupport: true, ttsSupport: true },
  { code: 'es', code3: 'spa', name: 'Spanish', nativeName: 'Español', rtl: false, sttSupport: true, ttsSupport: true },
  { code: 'fr', code3: 'fra', name: 'French', nativeName: 'Français', rtl: false, sttSupport: true, ttsSupport: true },
  { code: 'de', code3: 'deu', name: 'German', nativeName: 'Deutsch', rtl: false, sttSupport: true, ttsSupport: true },
  { code: 'it', code3: 'ita', name: 'Italian', nativeName: 'Italiano', rtl: false, sttSupport: true, ttsSupport: true },
  { code: 'pt', code3: 'por', name: 'Portuguese', nativeName: 'Português', rtl: false, sttSupport: true, ttsSupport: true },
  { code: 'ru', code3: 'rus', name: 'Russian', nativeName: 'Русский', rtl: false, sttSupport: true, ttsSupport: true },
  { code: 'ja', code3: 'jpn', name: 'Japanese', nativeName: '日本語', rtl: false, sttSupport: true, ttsSupport: true },
  { code: 'ko', code3: 'kor', name: 'Korean', nativeName: '한국어', rtl: false, sttSupport: true, ttsSupport: true },
  { code: 'zh', code3: 'zho', name: 'Chinese', nativeName: '中文', rtl: false, sttSupport: true, ttsSupport: true },
  { code: 'ar', code3: 'ara', name: 'Arabic', nativeName: 'العربية', rtl: true, sttSupport: true, ttsSupport: true },
  { code: 'hi', code3: 'hin', name: 'Hindi', nativeName: 'हिन्दी', rtl: false, sttSupport: true, ttsSupport: true },
  { code: 'nl', code3: 'nld', name: 'Dutch', nativeName: 'Nederlands', rtl: false, sttSupport: true, ttsSupport: true },
  { code: 'pl', code3: 'pol', name: 'Polish', nativeName: 'Polski', rtl: false, sttSupport: true, ttsSupport: true },
  { code: 'tr', code3: 'tur', name: 'Turkish', nativeName: 'Türkçe', rtl: false, sttSupport: true, ttsSupport: true },
  { code: 'vi', code3: 'vie', name: 'Vietnamese', nativeName: 'Tiếng Việt', rtl: false, sttSupport: true, ttsSupport: true },
  { code: 'th', code3: 'tha', name: 'Thai', nativeName: 'ไทย', rtl: false, sttSupport: true, ttsSupport: true },
  { code: 'uk', code3: 'ukr', name: 'Ukrainian', nativeName: 'Українська', rtl: false, sttSupport: true, ttsSupport: true },
  { code: 'cs', code3: 'ces', name: 'Czech', nativeName: 'Čeština', rtl: false, sttSupport: true, ttsSupport: true },
  { code: 'sv', code3: 'swe', name: 'Swedish', nativeName: 'Svenska', rtl: false, sttSupport: true, ttsSupport: true },
];

// Language name to code mapping
const LANGUAGE_NAME_MAP: Record<string, string> = {};
for (const lang of SUPPORTED_LANGUAGES) {
  LANGUAGE_NAME_MAP[lang.name.toLowerCase()] = lang.code;
  LANGUAGE_NAME_MAP[lang.nativeName.toLowerCase()] = lang.code;
}

// ============================================
// Language Detector (Simple N-gram based)
// ============================================

// Common words/patterns for language detection
const LANGUAGE_PATTERNS: Record<string, RegExp[]> = {
  en: [/\b(the|and|is|in|to|of|a|for|that|have|with)\b/gi, /\b(you|this|what|are|not)\b/gi],
  es: [/\b(el|la|de|que|y|en|un|es|se|los)\b/gi, /\b(una|como|más|para|con)\b/gi],
  fr: [/\b(le|la|de|et|en|un|une|que|est|les)\b/gi, /\b(pour|dans|ce|ne|pas)\b/gi],
  de: [/\b(der|die|und|in|den|von|zu|das|mit|sich)\b/gi, /\b(ist|auf|für|nicht|eine)\b/gi],
  it: [/\b(il|di|che|la|e|in|un|per|una|non)\b/gi, /\b(sono|come|con|del|della)\b/gi],
  pt: [/\b(de|que|e|o|a|do|da|em|um|para)\b/gi, /\b(com|não|uma|os|no)\b/gi],
  ru: [/[а-яА-Я]/g, /\b(и|в|не|на|с|что|он|как|это|она)\b/gi],
  ja: [/[\u3040-\u309F\u30A0-\u30FF]/g, /[\u4E00-\u9FAF]/g],
  ko: [/[\uAC00-\uD7AF]/g, /[\u1100-\u11FF]/g],
  zh: [/[\u4E00-\u9FAF]/g, /[\u3400-\u4DBF]/g],
  ar: [/[\u0600-\u06FF]/g, /[\u0750-\u077F]/g],
  hi: [/[\u0900-\u097F]/g],
};

export class LanguageDetector {
  private minTextLength = 10;
  private minConfidence = 0.6;
  
  /**
   * Detect language from text
   */
  detect(text: string): LanguageDetectionResult {
    if (text.length < this.minTextLength) {
      return {
        language: 'en',
        confidence: 0,
        alternatives: [],
        isReliable: false,
      };
    }
    
    const scores: Array<{ language: string; score: number }> = [];
    const normalizedText = text.toLowerCase();
    
    for (const [langCode, patterns] of Object.entries(LANGUAGE_PATTERNS)) {
      let totalMatches = 0;
      
      for (const pattern of patterns) {
        const matches = normalizedText.match(pattern);
        if (matches) {
          totalMatches += matches.length;
        }
      }
      
      // Normalize by text length
      const score = totalMatches / (text.length / 10);
      scores.push({ language: langCode, score });
    }
    
    // Sort by score
    scores.sort((a, b) => b.score - a.score);
    
    // Calculate confidence
    const topScore = scores[0]?.score || 0;
    const secondScore = scores[1]?.score || 0;
    const confidence = topScore > 0 ? Math.min(1, topScore / 10) * (1 - secondScore / topScore * 0.5) : 0;
    
    return {
      language: scores[0]?.language || 'en',
      confidence,
      alternatives: scores.slice(1, 4).map((s) => ({
        language: s.language,
        confidence: s.score > 0 ? Math.min(1, s.score / 10) : 0,
      })),
      isReliable: confidence >= this.minConfidence,
    };
  }
  
  /**
   * Detect language from audio characteristics using acoustic features
   * Analyzes phoneme distribution, prosody, and rhythm patterns
   */
  detectFromAudio(audio: AudioChunk): LanguageDetectionResult {
    const samples = audio.data;
    const sampleRate = audio.sampleRate || 16000;
    
    // Extract acoustic features
    const features = this.extractAcousticFeatures(samples, sampleRate);
    
    // Score each language based on acoustic characteristics
    const languageScores: Array<{ language: string; score: number }> = [];
    
    for (const [langCode, profile] of Object.entries(ACOUSTIC_LANGUAGE_PROFILES)) {
      const score = this.matchAcousticProfile(features, profile);
      languageScores.push({ language: langCode, score });
    }
    
    // Sort by score
    languageScores.sort((a, b) => b.score - a.score);
    
    const topScore = languageScores[0]?.score || 0;
    const audioConfidence = Math.min(1, topScore / 100);
    
    return {
      language: languageScores[0]?.language || 'en',
      confidence: audioConfidence,
      alternatives: languageScores.slice(1, 4).map((s) => ({
        language: s.language,
        confidence: Math.min(1, s.score / 100),
      })),
      isReliable: audioConfidence >= this.minConfidence,
    };
  }
  
  /**
   * Extract acoustic features from audio samples
   */
  private extractAcousticFeatures(samples: Float32Array, sampleRate: number): AcousticFeatures {
    const windowSize = Math.min(samples.length, sampleRate); // 1 second window
    
    // Calculate RMS energy
    let rms = 0;
    for (let i = 0; i < windowSize; i++) {
      rms += samples[i] * samples[i];
    }
    rms = Math.sqrt(rms / windowSize);
    
    // Calculate zero crossing rate
    let zcr = 0;
    for (let i = 1; i < windowSize; i++) {
      if ((samples[i] >= 0) !== (samples[i - 1] >= 0)) {
        zcr++;
      }
    }
    const zcrRate = zcr / windowSize * sampleRate;
    
    // Estimate speech rate via envelope peaks
    const envelope = this.computeEnvelope(samples, sampleRate);
    const speechRate = this.estimateSpeechRate(envelope);
    
    // Estimate pitch characteristics
    const pitchRange = this.estimatePitchRange(samples, sampleRate);
    
    // Calculate spectral features
    const spectralCentroid = this.calculateSpectralCentroid(samples, sampleRate);
    const spectralFlatness = this.calculateSpectralFlatness(samples);
    
    return {
      energy: rms,
      zeroCrossingRate: zcrRate,
      speechRate,
      pitchMean: pitchRange.mean,
      pitchVariance: pitchRange.variance,
      spectralCentroid,
      spectralFlatness,
    };
  }
  
  private computeEnvelope(samples: Float32Array, sampleRate: number): Float32Array {
    const frameSize = Math.floor(sampleRate * 0.01);
    const numFrames = Math.floor(samples.length / frameSize);
    const envelope = new Float32Array(numFrames);
    
    for (let i = 0; i < numFrames; i++) {
      let sum = 0;
      for (let j = 0; j < frameSize; j++) {
        const sample = samples[i * frameSize + j] || 0;
        sum += Math.abs(sample);
      }
      envelope[i] = sum / frameSize;
    }
    return envelope;
  }
  
  private estimateSpeechRate(envelope: Float32Array): number {
    if (envelope.length < 10) return 4;
    
    const threshold = 0.1;
    let peaks = 0;
    let inPeak = false;
    
    for (let i = 1; i < envelope.length - 1; i++) {
      if (!inPeak && envelope[i] > threshold && envelope[i] > envelope[i-1] && envelope[i] > envelope[i+1]) {
        peaks++;
        inPeak = true;
      } else if (envelope[i] < threshold * 0.5) {
        inPeak = false;
      }
    }
    
    const durationSec = envelope.length * 0.01;
    return peaks / durationSec;
  }
  
  private estimatePitchRange(samples: Float32Array, sampleRate: number): { mean: number; variance: number } {
    const windowSize = Math.min(samples.length, Math.floor(sampleRate * 0.03));
    const pitches: number[] = [];
    
    for (let start = 0; start < samples.length - windowSize; start += windowSize) {
      const pitch = this.estimatePitch(samples.slice(start, start + windowSize), sampleRate);
      if (pitch > 50 && pitch < 500) {
        pitches.push(pitch);
      }
    }
    
    if (pitches.length === 0) return { mean: 150, variance: 50 };
    
    const mean = pitches.reduce((a, b) => a + b, 0) / pitches.length;
    const variance = pitches.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / pitches.length;
    return { mean, variance: Math.sqrt(variance) };
  }
  
  private estimatePitch(window: Float32Array, sampleRate: number): number {
    const minLag = Math.floor(sampleRate / 500);
    const maxLag = Math.floor(sampleRate / 50);
    
    let bestCorrelation = 0;
    let bestLag = minLag;
    
    for (let lag = minLag; lag < maxLag && lag < window.length; lag++) {
      let correlation = 0;
      for (let i = 0; i < window.length - lag; i++) {
        correlation += window[i] * window[i + lag];
      }
      if (correlation > bestCorrelation) {
        bestCorrelation = correlation;
        bestLag = lag;
      }
    }
    return sampleRate / bestLag;
  }
  
  private calculateSpectralCentroid(samples: Float32Array, sampleRate: number): number {
    const fftSize = 256;
    const magnitudes = new Float32Array(fftSize / 2);
    
    for (let k = 0; k < fftSize / 2; k++) {
      let real = 0, imag = 0;
      for (let n = 0; n < fftSize && n < samples.length; n++) {
        const angle = -2 * Math.PI * k * n / fftSize;
        real += samples[n] * Math.cos(angle);
        imag += samples[n] * Math.sin(angle);
      }
      magnitudes[k] = Math.sqrt(real * real + imag * imag);
    }
    
    let weightedSum = 0, totalMag = 0;
    for (let k = 0; k < magnitudes.length; k++) {
      const freq = k * sampleRate / fftSize;
      weightedSum += freq * magnitudes[k];
      totalMag += magnitudes[k];
    }
    return totalMag > 0 ? weightedSum / totalMag : 1000;
  }
  
  private calculateSpectralFlatness(samples: Float32Array): number {
    const fftSize = 256;
    const magnitudes: number[] = [];
    
    for (let k = 1; k < fftSize / 2; k++) {
      let real = 0, imag = 0;
      for (let n = 0; n < fftSize && n < samples.length; n++) {
        const angle = -2 * Math.PI * k * n / fftSize;
        real += samples[n] * Math.cos(angle);
        imag += samples[n] * Math.sin(angle);
      }
      magnitudes.push(Math.sqrt(real * real + imag * imag) + 1e-10);
    }
    
    const logSum = magnitudes.reduce((a, b) => a + Math.log(b), 0);
    const geoMean = Math.exp(logSum / magnitudes.length);
    const ariMean = magnitudes.reduce((a, b) => a + b, 0) / magnitudes.length;
    return geoMean / ariMean;
  }
  
  private matchAcousticProfile(features: AcousticFeatures, profile: AcousticLanguageProfile): number {
    let score = 50;
    
    const speechRateDiff = Math.abs(features.speechRate - profile.typicalSpeechRate);
    score -= speechRateDiff * 5;
    
    const pitchDiff = Math.abs(features.pitchMean - profile.pitchRange.mean);
    score -= pitchDiff * 0.1;
    
    if (profile.isTonal && features.pitchVariance > 50) score += 20;
    if (!profile.isTonal && features.pitchVariance < 40) score += 10;
    if (profile.isStressTimed && features.spectralFlatness < 0.3) score += 10;
    
    return Math.max(0, score);
  }
  
  setMinConfidence(confidence: number): void {
    this.minConfidence = Math.max(0, Math.min(1, confidence));
  }
}

// Acoustic features interface
interface AcousticFeatures {
  energy: number;
  zeroCrossingRate: number;
  speechRate: number;
  pitchMean: number;
  pitchVariance: number;
  spectralCentroid: number;
  spectralFlatness: number;
}

// Language acoustic profile
interface AcousticLanguageProfile {
  typicalSpeechRate: number;
  pitchRange: { mean: number; variance: number };
  isTonal: boolean;
  isStressTimed: boolean;
}

// Acoustic profiles for major languages
const ACOUSTIC_LANGUAGE_PROFILES: Record<string, AcousticLanguageProfile> = {
  en: { typicalSpeechRate: 4.2, pitchRange: { mean: 150, variance: 30 }, isTonal: false, isStressTimed: true },
  es: { typicalSpeechRate: 5.0, pitchRange: { mean: 160, variance: 35 }, isTonal: false, isStressTimed: false },
  fr: { typicalSpeechRate: 4.8, pitchRange: { mean: 165, variance: 32 }, isTonal: false, isStressTimed: false },
  de: { typicalSpeechRate: 4.0, pitchRange: { mean: 145, variance: 28 }, isTonal: false, isStressTimed: true },
  it: { typicalSpeechRate: 5.2, pitchRange: { mean: 170, variance: 40 }, isTonal: false, isStressTimed: false },
  pt: { typicalSpeechRate: 4.6, pitchRange: { mean: 155, variance: 35 }, isTonal: false, isStressTimed: false },
  ru: { typicalSpeechRate: 3.8, pitchRange: { mean: 140, variance: 25 }, isTonal: false, isStressTimed: true },
  zh: { typicalSpeechRate: 3.5, pitchRange: { mean: 200, variance: 60 }, isTonal: true, isStressTimed: false },
  ja: { typicalSpeechRate: 4.5, pitchRange: { mean: 180, variance: 45 }, isTonal: true, isStressTimed: false },
  ko: { typicalSpeechRate: 4.3, pitchRange: { mean: 175, variance: 40 }, isTonal: false, isStressTimed: false },
  ar: { typicalSpeechRate: 3.9, pitchRange: { mean: 135, variance: 30 }, isTonal: false, isStressTimed: true },
  hi: { typicalSpeechRate: 4.1, pitchRange: { mean: 160, variance: 38 }, isTonal: false, isStressTimed: false },
};
// ============================================

type TranslationProvider = 'deepl' | 'google' | 'microsoft' | 'libretranslate';

interface TranslationProviderConfig {
  provider: TranslationProvider;
  apiKey?: string;
  apiEndpoint?: string;
}

export class Translator extends EventEmitter {
  private provider: TranslationProvider = 'deepl';
  private apiKey: string = '';
  private apiEndpoint: string = '';
  private cache: Map<string, TranslationResult> = new Map();
  private cacheMaxSize = 1000;
  
  /**
   * Configure translation API
   */
  configure(endpoint: string, apiKey: string): void {
    this.apiEndpoint = endpoint;
    this.apiKey = apiKey;
    
    // Auto-detect provider from endpoint
    if (endpoint.includes('deepl')) {
      this.provider = 'deepl';
    } else if (endpoint.includes('google') || endpoint.includes('translation.googleapis')) {
      this.provider = 'google';
    } else if (endpoint.includes('microsoft') || endpoint.includes('api.cognitive')) {
      this.provider = 'microsoft';
    } else if (endpoint.includes('libretranslate')) {
      this.provider = 'libretranslate';
    }
  }

  /**
   * Configure with specific provider
   */
  configureProvider(config: TranslationProviderConfig): void {
    this.provider = config.provider;
    this.apiKey = config.apiKey || '';
    this.apiEndpoint = config.apiEndpoint || this.getDefaultEndpoint(config.provider);
  }

  private getDefaultEndpoint(provider: TranslationProvider): string {
    switch (provider) {
      case 'deepl':
        return 'https://api-free.deepl.com/v2/translate';
      case 'google':
        return 'https://translation.googleapis.com/language/translate/v2';
      case 'microsoft':
        return 'https://api.cognitive.microsofttranslator.com/translate?api-version=3.0';
      case 'libretranslate':
        return 'https://libretranslate.com/translate';
      default:
        return '';
    }
  }
  
  /**
   * Translate text using configured API
   */
  async translate(
    text: string,
    sourceLanguage: string,
    targetLanguage: string
  ): Promise<TranslationResult> {
    // Check cache
    const cacheKey = `${sourceLanguage}:${targetLanguage}:${text}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    // Validate configuration
    if (!this.apiKey && this.provider !== 'libretranslate') {
      logger.warn('Translation API key not configured', { provider: this.provider });
      return {
        originalText: text,
        translatedText: text,
        sourceLanguage,
        targetLanguage,
        confidence: 0,
      };
    }

    logger.info('Translation requested', { 
      provider: this.provider,
      sourceLanguage, 
      targetLanguage, 
      textLength: text.length 
    });

    try {
      let result: TranslationResult;

      switch (this.provider) {
        case 'deepl':
          result = await this.translateWithDeepL(text, sourceLanguage, targetLanguage);
          break;
        case 'google':
          result = await this.translateWithGoogle(text, sourceLanguage, targetLanguage);
          break;
        case 'microsoft':
          result = await this.translateWithMicrosoft(text, sourceLanguage, targetLanguage);
          break;
        case 'libretranslate':
          result = await this.translateWithLibreTranslate(text, sourceLanguage, targetLanguage);
          break;
        default:
          throw new Error(`Unknown translation provider: ${this.provider}`);
      }

      // Cache successful results
      this.cacheResult(cacheKey, result);
      
      this.emit('translated', result);
      return result;
    } catch (error) {
      logger.error('Translation failed', { 
        error: getErrorMessage(error),
        provider: this.provider 
      });
      return {
        originalText: text,
        translatedText: text,
        sourceLanguage,
        targetLanguage,
        confidence: 0,
      };
    }
  }

  /**
   * DeepL API translation
   */
  private async translateWithDeepL(
    text: string,
    sourceLanguage: string,
    targetLanguage: string
  ): Promise<TranslationResult> {
    const response = await fetch(this.apiEndpoint || 'https://api-free.deepl.com/v2/translate', {
      method: 'POST',
      headers: {
        'Authorization': `DeepL-Auth-Key ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: [text],
        source_lang: sourceLanguage.toUpperCase(),
        target_lang: targetLanguage.toUpperCase(),
      }),
    });

    if (!response.ok) {
      throw new Error(`DeepL API error: ${response.status}`);
    }

    const data = await response.json();
    const translation = data.translations?.[0];

    return {
      originalText: text,
      translatedText: translation?.text || text,
      sourceLanguage: translation?.detected_source_language?.toLowerCase() || sourceLanguage,
      targetLanguage,
      confidence: 0.95, // DeepL generally has high quality
    };
  }

  /**
   * Google Translate API translation
   */
  private async translateWithGoogle(
    text: string,
    sourceLanguage: string,
    targetLanguage: string
  ): Promise<TranslationResult> {
    const url = new URL(this.apiEndpoint || 'https://translation.googleapis.com/language/translate/v2');
    url.searchParams.set('key', this.apiKey);

    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        q: text,
        source: sourceLanguage,
        target: targetLanguage,
        format: 'text',
      }),
    });

    if (!response.ok) {
      throw new Error(`Google Translate API error: ${response.status}`);
    }

    const data = await response.json();
    const translation = data.data?.translations?.[0];

    return {
      originalText: text,
      translatedText: translation?.translatedText || text,
      sourceLanguage: translation?.detectedSourceLanguage || sourceLanguage,
      targetLanguage,
      confidence: 0.9,
    };
  }

  /**
   * Microsoft Translator API translation
   */
  private async translateWithMicrosoft(
    text: string,
    sourceLanguage: string,
    targetLanguage: string
  ): Promise<TranslationResult> {
    const url = new URL(this.apiEndpoint || 'https://api.cognitive.microsofttranslator.com/translate');
    url.searchParams.set('api-version', '3.0');
    url.searchParams.set('from', sourceLanguage);
    url.searchParams.set('to', targetLanguage);

    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([{ text }]),
    });

    if (!response.ok) {
      throw new Error(`Microsoft Translator API error: ${response.status}`);
    }

    const data = await response.json();
    const translation = data[0]?.translations?.[0];

    return {
      originalText: text,
      translatedText: translation?.text || text,
      sourceLanguage: data[0]?.detectedLanguage?.language || sourceLanguage,
      targetLanguage,
      confidence: data[0]?.detectedLanguage?.score || 0.85,
    };
  }

  /**
   * LibreTranslate API translation (open source)
   */
  private async translateWithLibreTranslate(
    text: string,
    sourceLanguage: string,
    targetLanguage: string
  ): Promise<TranslationResult> {
    const response = await fetch(this.apiEndpoint || 'https://libretranslate.com/translate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        q: text,
        source: sourceLanguage,
        target: targetLanguage,
        format: 'text',
        api_key: this.apiKey || undefined,
      }),
    });

    if (!response.ok) {
      throw new Error(`LibreTranslate API error: ${response.status}`);
    }

    const data = await response.json();

    return {
      originalText: text,
      translatedText: data.translatedText || text,
      sourceLanguage: data.detectedLanguage?.language || sourceLanguage,
      targetLanguage,
      confidence: data.detectedLanguage?.confidence || 0.8,
    };
  }

  /**
   * Cache translation result
   */
  private cacheResult(key: string, result: TranslationResult): void {
    if (this.cache.size >= this.cacheMaxSize) {
      // Remove oldest entry
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, result);
  }

  /**
   * Clear translation cache
   */
  clearCache(): void {
    this.cache.clear();
  }
  
  /**
   * Detect and translate
   */
  async detectAndTranslate(text: string, targetLanguage: string): Promise<TranslationResult> {
    const detector = new LanguageDetector();
    const detection = detector.detect(text);
    
    if (detection.language === targetLanguage) {
      return {
        originalText: text,
        translatedText: text,
        sourceLanguage: detection.language,
        targetLanguage,
        confidence: 1,
      };
    }
    
    return this.translate(text, detection.language, targetLanguage);
  }
}

// ============================================
// Multilingual Voice Manager
// ============================================

export class MultilingualVoiceManager extends EventEmitter {
  private config: MultilingualConfig;
  private detector: LanguageDetector;
  private translator: Translator;
  private currentLanguage: string;
  private languageHistory: string[] = [];
  
  constructor(config?: Partial<MultilingualConfig>) {
    super();
    
    this.config = {
      defaultLanguage: 'en',
      enableAutoDetection: true,
      detectionMinConfidence: 0.7,
      enableTranslation: false,
      translationTarget: 'en',
      voiceMap: {},
      ...config,
    };
    
    this.currentLanguage = this.config.defaultLanguage;
    this.detector = new LanguageDetector();
    this.translator = new Translator();
  }
  
  /**
   * Process transcription with language detection
   */
  async processTranscription(transcription: TranscriptionResult): Promise<{
    transcription: TranscriptionResult;
    detectedLanguage?: LanguageDetectionResult;
    translation?: TranslationResult;
  }> {
    const result: {
      transcription: TranscriptionResult;
      detectedLanguage?: LanguageDetectionResult;
      translation?: TranslationResult;
    } = { transcription };
    
    // Get text from transcription (use final if available, otherwise partial)
    const transcriptionText = transcription.final || transcription.partial || '';
    
    // Detect language if enabled
    if (this.config.enableAutoDetection) {
      const detection = this.detector.detect(transcriptionText);
      result.detectedLanguage = detection;
      
      if (detection.isReliable && detection.language !== this.currentLanguage) {
        this.setLanguage(detection.language);
      }
    }
    
    // Translate if enabled
    if (this.config.enableTranslation && result.detectedLanguage) {
      const sourceLanguage = result.detectedLanguage.language;
      
      if (sourceLanguage !== this.config.translationTarget) {
        result.translation = await this.translator.translate(
          transcriptionText,
          sourceLanguage,
          this.config.translationTarget
        );
      }
    }
    
    return result;
  }
  
  /**
   * Get appropriate voice for language
   */
  getVoiceForLanguage(language: string): string | undefined {
    return this.config.voiceMap[language];
  }
  
  /**
   * Set voice mapping for language
   */
  setVoiceForLanguage(language: string, voiceId: string): void {
    this.config.voiceMap[language] = voiceId;
    logger.info('Voice mapped to language', { language, voiceId });
  }
  
  /**
   * Set current language
   */
  setLanguage(language: string): void {
    const langInfo = SUPPORTED_LANGUAGES.find((l) => l.code === language);
    
    if (!langInfo) {
      logger.warn('Unsupported language', { language });
      return;
    }
    
    const previousLanguage = this.currentLanguage;
    this.currentLanguage = language;
    
    // Track history
    this.languageHistory.push(language);
    if (this.languageHistory.length > 10) {
      this.languageHistory.shift();
    }
    
    logger.info('Language changed', { from: previousLanguage, to: language });
    this.emit('language-changed', { from: previousLanguage, to: language, langInfo });
  }
  
  /**
   * Get current language
   */
  getLanguage(): string {
    return this.currentLanguage;
  }
  
  /**
   * Get language info
   */
  getLanguageInfo(code?: string): LanguageInfo | undefined {
    const langCode = code || this.currentLanguage;
    return SUPPORTED_LANGUAGES.find((l) => l.code === langCode);
  }
  
  /**
   * Get all supported languages
   */
  getSupportedLanguages(): LanguageInfo[] {
    return [...SUPPORTED_LANGUAGES];
  }
  
  /**
   * Get languages with STT support
   */
  getSTTLanguages(): LanguageInfo[] {
    return SUPPORTED_LANGUAGES.filter((l) => l.sttSupport);
  }
  
  /**
   * Get languages with TTS support
   */
  getTTSLanguages(): LanguageInfo[] {
    return SUPPORTED_LANGUAGES.filter((l) => l.ttsSupport);
  }
  
  /**
   * Get most used language from history
   */
  getMostUsedLanguage(): string {
    if (this.languageHistory.length === 0) {
      return this.config.defaultLanguage;
    }
    
    const counts: Record<string, number> = {};
    for (const lang of this.languageHistory) {
      counts[lang] = (counts[lang] || 0) + 1;
    }
    
    return Object.entries(counts).reduce((a, b) => (b[1] > a[1] ? b : a))[0];
  }
  
  /**
   * Configure translator
   */
  configureTranslator(endpoint: string, apiKey: string): void {
    this.translator.configure(endpoint, apiKey);
  }
  
  /**
   * Update config
   */
  setConfig(config: Partial<MultilingualConfig>): void {
    Object.assign(this.config, config);
    
    if (config.detectionMinConfidence !== undefined) {
      this.detector.setMinConfidence(config.detectionMinConfidence);
    }
    
    this.emit('config-changed', this.config);
  }
  
  /**
   * Get config
   */
  getConfig(): MultilingualConfig {
    return { ...this.config };
  }
}

// ============================================
// Language Code Utilities
// ============================================

export function getLanguageCode(input: string): string | undefined {
  const normalized = input.toLowerCase().trim();
  
  // Check if it's already a code
  const byCode = SUPPORTED_LANGUAGES.find((l) => l.code === normalized || l.code3 === normalized);
  if (byCode) return byCode.code;
  
  // Check by name
  return LANGUAGE_NAME_MAP[normalized];
}

export function getLanguageName(code: string, native = false): string | undefined {
  const lang = SUPPORTED_LANGUAGES.find((l) => l.code === code);
  return lang ? (native ? lang.nativeName : lang.name) : undefined;
}

export function isRTL(code: string): boolean {
  const lang = SUPPORTED_LANGUAGES.find((l) => l.code === code);
  return lang?.rtl ?? false;
}
