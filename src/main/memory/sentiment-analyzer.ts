/**
 * Nova Desktop - Sentiment Analyzer
 * Detects user sentiment from text for adaptive responses
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('SentimentAnalyzer');

/**
 * Sentiment categories
 */
export type Sentiment = 'positive' | 'negative' | 'neutral';

/**
 * Detailed sentiment types
 */
export type DetailedSentiment =
  | 'very_positive'
  | 'positive'
  | 'slightly_positive'
  | 'neutral'
  | 'slightly_negative'
  | 'negative'
  | 'very_negative';

/**
 * Emotion categories
 */
export type Emotion =
  | 'happy'
  | 'excited'
  | 'grateful'
  | 'curious'
  | 'neutral'
  | 'confused'
  | 'frustrated'
  | 'angry'
  | 'sad'
  | 'disappointed';

/**
 * Sentiment analysis result
 */
export interface SentimentResult {
  /** Basic sentiment category */
  sentiment: Sentiment;
  /** Detailed sentiment */
  detailed: DetailedSentiment;
  /** Detected emotion */
  emotion: Emotion;
  /** Sentiment score (-1 to 1) */
  score: number;
  /** Confidence in the analysis */
  confidence: number;
  /** Detected keywords that influenced the score */
  keywords: string[];
  /** Suggested response tone */
  suggestedTone: 'empathetic' | 'encouraging' | 'neutral' | 'apologetic' | 'celebratory';
}

/**
 * Word lists for sentiment detection
 */
const SENTIMENT_WORDS = {
  veryPositive: [
    'amazing',
    'awesome',
    'fantastic',
    'wonderful',
    'excellent',
    'perfect',
    'incredible',
    'outstanding',
    'brilliant',
    'superb',
    'marvelous',
    'extraordinary',
    'phenomenal',
    'spectacular',
    'magnificent',
    'tremendous',
  ],
  positive: [
    'good',
    'great',
    'nice',
    'happy',
    'glad',
    'pleased',
    'love',
    'like',
    'enjoy',
    'helpful',
    'useful',
    'thanks',
    'thank',
    'appreciate',
    'cool',
    'fine',
    'well',
    'better',
    'best',
    'right',
    'correct',
    'yes',
  ],
  slightlyPositive: [
    'okay',
    'ok',
    'alright',
    'sure',
    'interesting',
    'decent',
    'reasonable',
    'fair',
    'acceptable',
    'adequate',
    'satisfactory',
  ],
  slightlyNegative: [
    'hmm',
    'meh',
    'eh',
    'uncertain',
    'unsure',
    'maybe',
    'perhaps',
    'difficult',
    'tricky',
    'complicated',
    'confusing',
    'unclear',
  ],
  negative: [
    'bad',
    'wrong',
    'error',
    'problem',
    'issue',
    'difficult',
    'hard',
    'annoying',
    'frustrating',
    'disappointing',
    'confused',
    'stuck',
    'broken',
    'fail',
    'failed',
    'not working',
    "doesn't work",
    "can't",
  ],
  veryNegative: [
    'terrible',
    'awful',
    'horrible',
    'hate',
    'angry',
    'furious',
    'stupid',
    'useless',
    'worst',
    'disaster',
    'catastrophe',
    'unacceptable',
    'ridiculous',
    'pathetic',
    'disgusting',
    'outrageous',
  ],
};

/**
 * Emotion detection patterns
 */
const EMOTION_PATTERNS: Array<{ patterns: RegExp[]; emotion: Emotion; weight: number }> = [
  {
    patterns: [
      /\b(?:so\s+)?happy\b/i,
      /\b(?:really\s+)?excited\b/i,
      /\bcan't wait\b/i,
      /\byay\b/i,
      /!{2,}/,
    ],
    emotion: 'excited',
    weight: 1.0,
  },
  {
    patterns: [/\bhappy\b/i, /\bglad\b/i, /\bpleased\b/i, /\bdelighted\b/i, /:\)|😊|😄|🙂/],
    emotion: 'happy',
    weight: 0.8,
  },
  {
    patterns: [/\bthank(?:s| you)\b/i, /\bappreciate\b/i, /\bgrateful\b/i, /\bhelped\b/i],
    emotion: 'grateful',
    weight: 0.7,
  },
  {
    patterns: [
      /\bhow\s+(?:do|does|can|could)\b/i,
      /\bwhat\s+(?:is|are|does)\b/i,
      /\bwhy\s+(?:is|are|does)\b/i,
      /\binterested\s+in\b/i,
      /\bwondering\b/i,
      /\?/,
    ],
    emotion: 'curious',
    weight: 0.5,
  },
  {
    patterns: [
      /\bconfused\b/i,
      /\bdon't\s+understand\b/i,
      /\bwhat\s+do\s+you\s+mean\b/i,
      /\b(?:huh|what)\?/i,
      /\blost\b/i,
    ],
    emotion: 'confused',
    weight: 0.7,
  },
  {
    patterns: [
      /\bfrustrat(?:ed|ing)\b/i,
      /\bannoying\b/i,
      /\bstill\s+not\s+working\b/i,
      /\btried\s+everything\b/i,
      /\bugh\b/i,
    ],
    emotion: 'frustrated',
    weight: 0.9,
  },
  {
    patterns: [/\bangry\b/i, /\bfurious\b/i, /\boutrageous\b/i, /\bunacceptable\b/i, /!{3,}/],
    emotion: 'angry',
    weight: 1.0,
  },
  {
    patterns: [/\bsad\b/i, /\bunhappy\b/i, /\bupset\b/i, /:\(|😢|😞/],
    emotion: 'sad',
    weight: 0.8,
  },
  {
    patterns: [/\bdisappointed\b/i, /\blet\s+down\b/i, /\bexpected\s+(?:more|better)\b/i],
    emotion: 'disappointed',
    weight: 0.8,
  },
];

/**
 * Sentiment Analyzer Events
 */
export interface SentimentAnalyzerEvents {
  'sentiment-analyzed': (result: SentimentResult) => void;
  'emotion-detected': (emotion: Emotion, confidence: number) => void;
}

/**
 * Sentiment Analyzer Configuration
 */
export interface SentimentAnalyzerConfig {
  /** Enable emoji analysis */
  analyzeEmojis: boolean;
  /** Enable punctuation analysis */
  analyzePunctuation: boolean;
  /** Weight for capitalization (shouting) */
  capsWeight: number;
}

const DEFAULT_CONFIG: SentimentAnalyzerConfig = {
  analyzeEmojis: true,
  analyzePunctuation: true,
  capsWeight: 0.2,
};

/**
 * Sentiment Analyzer
 * Analyzes text for sentiment and emotion
 */
export class SentimentAnalyzer extends EventEmitter {
  private config: SentimentAnalyzerConfig;
  private history: SentimentResult[] = [];
  private readonly MAX_HISTORY = 20;

  constructor(config?: Partial<SentimentAnalyzerConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    logger.info('SentimentAnalyzer initialized', { config: this.config });
  }

  /**
   * Analyze sentiment of text
   */
  analyze(text: string): SentimentResult {
    const normalizedText = text.toLowerCase();
    const foundKeywords: string[] = [];

    // Calculate word-based sentiment score
    let score = 0;
    let matchCount = 0;

    // Very positive words (+0.8 to +1.0)
    for (const word of SENTIMENT_WORDS.veryPositive) {
      if (normalizedText.includes(word)) {
        score += 0.9;
        matchCount++;
        foundKeywords.push(word);
      }
    }

    // Positive words (+0.4 to +0.6)
    for (const word of SENTIMENT_WORDS.positive) {
      if (normalizedText.includes(word)) {
        score += 0.5;
        matchCount++;
        foundKeywords.push(word);
      }
    }

    // Slightly positive words (+0.1 to +0.3)
    for (const word of SENTIMENT_WORDS.slightlyPositive) {
      if (normalizedText.includes(word)) {
        score += 0.2;
        matchCount++;
        foundKeywords.push(word);
      }
    }

    // Slightly negative words (-0.1 to -0.3)
    for (const word of SENTIMENT_WORDS.slightlyNegative) {
      if (normalizedText.includes(word)) {
        score -= 0.2;
        matchCount++;
        foundKeywords.push(word);
      }
    }

    // Negative words (-0.4 to -0.6)
    for (const word of SENTIMENT_WORDS.negative) {
      if (normalizedText.includes(word)) {
        score -= 0.5;
        matchCount++;
        foundKeywords.push(word);
      }
    }

    // Very negative words (-0.8 to -1.0)
    for (const word of SENTIMENT_WORDS.veryNegative) {
      if (normalizedText.includes(word)) {
        score -= 0.9;
        matchCount++;
        foundKeywords.push(word);
      }
    }

    // Analyze capitalization (shouting)
    if (this.config.capsWeight > 0) {
      const capsRatio = this.getCapsRatio(text);
      if (capsRatio > 0.5) {
        // Heavy caps usage - intensify sentiment
        score *= 1 + this.config.capsWeight * capsRatio;
      }
    }

    // Analyze punctuation
    if (this.config.analyzePunctuation) {
      const exclamationCount = (text.match(/!/g) || []).length;
      const questionCount = (text.match(/\?/g) || []).length;

      // Multiple exclamations intensify sentiment
      if (exclamationCount > 1) {
        score *= 1 + exclamationCount * 0.1;
      }
    }

    // Normalize score to -1 to 1
    if (matchCount > 0) {
      score = score / matchCount;
    }
    score = Math.max(-1, Math.min(1, score));

    // Determine basic sentiment
    let sentiment: Sentiment;
    if (score > 0.15) sentiment = 'positive';
    else if (score < -0.15) sentiment = 'negative';
    else sentiment = 'neutral';

    // Determine detailed sentiment
    let detailed: DetailedSentiment;
    if (score >= 0.7) detailed = 'very_positive';
    else if (score >= 0.4) detailed = 'positive';
    else if (score >= 0.15) detailed = 'slightly_positive';
    else if (score <= -0.7) detailed = 'very_negative';
    else if (score <= -0.4) detailed = 'negative';
    else if (score <= -0.15) detailed = 'slightly_negative';
    else detailed = 'neutral';

    // Detect emotion
    const emotion = this.detectEmotion(text, sentiment);

    // Calculate confidence based on keyword matches
    const confidence = Math.min(1, 0.3 + matchCount * 0.15);

    // Determine suggested response tone
    const suggestedTone = this.getSuggestedTone(sentiment, emotion);

    const result: SentimentResult = {
      sentiment,
      detailed,
      emotion,
      score,
      confidence,
      keywords: [...new Set(foundKeywords)], // Deduplicate
      suggestedTone,
    };

    // Store in history
    this.history.push(result);
    if (this.history.length > this.MAX_HISTORY) {
      this.history.shift();
    }

    this.emit('sentiment-analyzed', result);
    this.emit('emotion-detected', emotion, confidence);

    logger.debug('Sentiment analyzed', {
      sentiment,
      detailed,
      emotion,
      score: score.toFixed(2),
      confidence: confidence.toFixed(2),
    });

    return result;
  }

  /**
   * Get caps ratio for text
   */
  private getCapsRatio(text: string): number {
    const letters = text.replace(/[^a-zA-Z]/g, '');
    if (letters.length === 0) return 0;

    const caps = letters.replace(/[^A-Z]/g, '').length;
    return caps / letters.length;
  }

  /**
   * Detect emotion from text
   */
  private detectEmotion(text: string, baseSentiment: Sentiment): Emotion {
    let bestEmotion: Emotion = 'neutral';
    let bestWeight = 0;

    for (const { patterns, emotion, weight } of EMOTION_PATTERNS) {
      let matches = 0;
      for (const pattern of patterns) {
        if (pattern.test(text)) {
          matches++;
        }
      }

      if (matches > 0) {
        const totalWeight = weight * matches;
        if (totalWeight > bestWeight) {
          bestWeight = totalWeight;
          bestEmotion = emotion;
        }
      }
    }

    // Fall back to sentiment-based emotion if no patterns matched
    if (bestWeight === 0) {
      switch (baseSentiment) {
        case 'positive':
          bestEmotion = 'happy';
          break;
        case 'negative':
          bestEmotion = 'frustrated';
          break;
        default:
          bestEmotion = 'neutral';
      }
    }

    return bestEmotion;
  }

  /**
   * Get suggested response tone based on sentiment and emotion
   */
  private getSuggestedTone(
    sentiment: Sentiment,
    emotion: Emotion
  ): SentimentResult['suggestedTone'] {
    // Celebratory for very positive emotions
    if (emotion === 'excited' || emotion === 'happy') {
      return 'celebratory';
    }

    // Empathetic for negative emotions
    if (emotion === 'sad' || emotion === 'disappointed') {
      return 'empathetic';
    }

    // Apologetic for frustrated/angry users
    if (emotion === 'frustrated' || emotion === 'angry') {
      return 'apologetic';
    }

    // Encouraging for confused users
    if (emotion === 'confused') {
      return 'encouraging';
    }

    // Based on sentiment
    switch (sentiment) {
      case 'positive':
        return 'celebratory';
      case 'negative':
        return 'empathetic';
      default:
        return 'neutral';
    }
  }

  /**
   * Get overall sentiment trend from history
   */
  getSentimentTrend(): {
    average: number;
    trend: 'improving' | 'declining' | 'stable';
    dominantEmotion: Emotion;
  } {
    if (this.history.length === 0) {
      return { average: 0, trend: 'stable', dominantEmotion: 'neutral' };
    }

    // Calculate average
    const average = this.history.reduce((sum, r) => sum + r.score, 0) / this.history.length;

    // Calculate trend (compare first half to second half)
    let trend: 'improving' | 'declining' | 'stable' = 'stable';
    if (this.history.length >= 4) {
      const midpoint = Math.floor(this.history.length / 2);
      const firstHalf = this.history.slice(0, midpoint);
      const secondHalf = this.history.slice(midpoint);

      const firstAvg = firstHalf.reduce((sum, r) => sum + r.score, 0) / firstHalf.length;
      const secondAvg = secondHalf.reduce((sum, r) => sum + r.score, 0) / secondHalf.length;

      if (secondAvg - firstAvg > 0.2) trend = 'improving';
      else if (firstAvg - secondAvg > 0.2) trend = 'declining';
    }

    // Find dominant emotion
    const emotionCounts = new Map<Emotion, number>();
    for (const result of this.history) {
      emotionCounts.set(result.emotion, (emotionCounts.get(result.emotion) || 0) + 1);
    }

    let dominantEmotion: Emotion = 'neutral';
    let maxCount = 0;
    for (const [emotion, count] of emotionCounts) {
      if (count > maxCount) {
        maxCount = count;
        dominantEmotion = emotion;
      }
    }

    return { average, trend, dominantEmotion };
  }

  /**
   * Get recent sentiment history
   */
  getHistory(limit = 10): SentimentResult[] {
    return this.history.slice(-limit);
  }

  /**
   * Clear history
   */
  clearHistory(): void {
    this.history = [];
    logger.info('Sentiment history cleared');
  }

  /**
   * Shutdown
   */
  shutdown(): void {
    this.removeAllListeners();
    logger.info('SentimentAnalyzer shutdown');
  }

  // Type-safe event emitter methods
  on<K extends keyof SentimentAnalyzerEvents>(
    event: K,
    listener: SentimentAnalyzerEvents[K]
  ): this {
    return super.on(event, listener);
  }

  off<K extends keyof SentimentAnalyzerEvents>(
    event: K,
    listener: SentimentAnalyzerEvents[K]
  ): this {
    return super.off(event, listener);
  }

  emit<K extends keyof SentimentAnalyzerEvents>(
    event: K,
    ...args: Parameters<SentimentAnalyzerEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }
}

// Singleton instance
let analyzerInstance: SentimentAnalyzer | null = null;

/**
 * Get or create the sentiment analyzer instance
 */
export function getSentimentAnalyzer(config?: Partial<SentimentAnalyzerConfig>): SentimentAnalyzer {
  if (!analyzerInstance) {
    analyzerInstance = new SentimentAnalyzer(config);
  }
  return analyzerInstance;
}

/**
 * Shutdown the sentiment analyzer
 */
export function shutdownSentimentAnalyzer(): void {
  if (analyzerInstance) {
    analyzerInstance.shutdown();
    analyzerInstance = null;
  }
}

export default SentimentAnalyzer;
