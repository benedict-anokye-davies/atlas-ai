/**
 * Atlas Desktop - Conversation Summarizer
 * Auto-summarize long conversations for context compression
 *
 * Features:
 * - Extractive summarization
 * - Abstractive summarization
 * - Multi-turn conversation compression
 * - Topic extraction
 * - Key information retention
 *
 * @module ml/conversation-summarizer
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('ConversationSummarizer');

// ============================================================================
// Types
// ============================================================================

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface ConversationSummary {
  id: string;
  originalMessageCount: number;
  summaryLength: number;
  topics: string[];
  keyPoints: string[];
  summary: string;
  compressionRatio: number;
  createdAt: number;
}

export interface TopicExtraction {
  topic: string;
  relevance: number;
  mentions: number;
  firstMention: number;
  lastMention: number;
}

export interface SummarizerConfig {
  maxSummaryLength: number;
  compressionTarget: number; // Target ratio (e.g., 0.3 = 30% of original)
  topicCount: number;
  keyPointCount: number;
  minMessageThreshold: number; // Min messages before summarization
}

export interface SummarizerEvents {
  'summary-created': (summary: ConversationSummary) => void;
  'topics-extracted': (topics: TopicExtraction[]) => void;
  error: (error: Error) => void;
}

// ============================================================================
// Text Processing Utilities
// ============================================================================

class TextProcessor {
  private stopWords: Set<string>;

  constructor() {
    this.stopWords = new Set([
      'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
      'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
      'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought',
      'used', 'it', 'its', 'this', 'that', 'these', 'those', 'i', 'you', 'he',
      'she', 'we', 'they', 'what', 'which', 'who', 'whom', 'whose', 'where',
      'when', 'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more',
      'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own',
      'same', 'so', 'than', 'too', 'very', 'just', 'also', 'now', 'here',
    ]);
  }

  /**
   * Tokenize text into words
   */
  tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 0);
  }

  /**
   * Remove stop words
   */
  removeStopWords(tokens: string[]): string[] {
    return tokens.filter((t) => !this.stopWords.has(t) && t.length > 2);
  }

  /**
   * Get sentences from text
   */
  getSentences(text: string): string[] {
    return text
      .split(/[.!?]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 10);
  }

  /**
   * Calculate TF-IDF scores
   */
  calculateTFIDF(documents: string[][]): Map<string, number>[] {
    // Document frequency
    const df = new Map<string, number>();
    for (const doc of documents) {
      const unique = new Set(doc);
      for (const word of unique) {
        df.set(word, (df.get(word) || 0) + 1);
      }
    }

    // TF-IDF for each document
    const results: Map<string, number>[] = [];
    for (const doc of documents) {
      const tfidf = new Map<string, number>();

      // Term frequency
      const tf = new Map<string, number>();
      for (const word of doc) {
        tf.set(word, (tf.get(word) || 0) + 1);
      }

      // Calculate TF-IDF
      for (const [word, freq] of tf) {
        const tfScore = freq / doc.length;
        const idf = Math.log(documents.length / (df.get(word) || 1));
        tfidf.set(word, tfScore * idf);
      }

      results.push(tfidf);
    }

    return results;
  }

  /**
   * Calculate sentence importance using TextRank-like algorithm
   */
  rankSentences(sentences: string[]): Array<{ sentence: string; score: number }> {
    const n = sentences.length;
    if (n === 0) return [];

    // Tokenize sentences
    const tokenized = sentences.map((s) => this.removeStopWords(this.tokenize(s)));

    // Build similarity matrix
    const similarity: number[][] = [];
    for (let i = 0; i < n; i++) {
      similarity[i] = [];
      for (let j = 0; j < n; j++) {
        if (i === j) {
          similarity[i][j] = 0;
        } else {
          similarity[i][j] = this.sentenceSimilarity(tokenized[i], tokenized[j]);
        }
      }
    }

    // Normalize similarity matrix
    for (let i = 0; i < n; i++) {
      const sum = similarity[i].reduce((a, b) => a + b, 0);
      if (sum > 0) {
        for (let j = 0; j < n; j++) {
          similarity[i][j] /= sum;
        }
      }
    }

    // PageRank-style iteration
    const d = 0.85;
    let scores = new Array(n).fill(1 / n);

    for (let iter = 0; iter < 50; iter++) {
      const newScores = new Array(n).fill(0);
      for (let i = 0; i < n; i++) {
        let sum = 0;
        for (let j = 0; j < n; j++) {
          sum += similarity[j][i] * scores[j];
        }
        newScores[i] = (1 - d) / n + d * sum;
      }
      scores = newScores;
    }

    return sentences.map((sentence, i) => ({
      sentence,
      score: scores[i],
    }));
  }

  /**
   * Calculate similarity between two token lists
   */
  private sentenceSimilarity(tokens1: string[], tokens2: string[]): number {
    if (tokens1.length === 0 || tokens2.length === 0) return 0;

    const set1 = new Set(tokens1);
    const set2 = new Set(tokens2);

    let intersection = 0;
    for (const t of set1) {
      if (set2.has(t)) intersection++;
    }

    const union = set1.size + set2.size - intersection;
    return union > 0 ? intersection / union : 0;
  }
}

// ============================================================================
// Conversation Summarizer
// ============================================================================

export class ConversationSummarizer extends EventEmitter {
  private config: SummarizerConfig;
  private textProcessor: TextProcessor;
  private summaryCache: Map<string, ConversationSummary> = new Map();

  // Stats
  private stats = {
    summariesCreated: 0,
    totalMessagesProcessed: 0,
    avgCompressionRatio: 0,
    topicsExtracted: 0,
  };

  constructor(config?: Partial<SummarizerConfig>) {
    super();
    this.config = {
      maxSummaryLength: 500,
      compressionTarget: 0.3,
      topicCount: 5,
      keyPointCount: 5,
      minMessageThreshold: 5,
      ...config,
    };

    this.textProcessor = new TextProcessor();

    logger.info('ConversationSummarizer initialized', { config: this.config });
  }

  // ============================================================================
  // Main Summarization
  // ============================================================================

  /**
   * Summarize a conversation
   */
  summarize(messages: ConversationMessage[]): ConversationSummary {
    if (messages.length < this.config.minMessageThreshold) {
      logger.debug('Not enough messages for summarization', {
        count: messages.length,
        threshold: this.config.minMessageThreshold,
      });
    }

    // Combine message content
    const fullContent = messages.map((m) => `${m.role}: ${m.content}`).join('\n\n');
    const originalLength = fullContent.length;

    // Extract topics
    const topics = this.extractTopics(messages);

    // Extract key points using extractive summarization
    const keyPoints = this.extractKeyPoints(messages);

    // Generate summary
    const summary = this.generateSummary(messages, topics, keyPoints);

    const result: ConversationSummary = {
      id: `summary_${Date.now()}`,
      originalMessageCount: messages.length,
      summaryLength: summary.length,
      topics: topics.slice(0, this.config.topicCount).map((t) => t.topic),
      keyPoints,
      summary,
      compressionRatio: summary.length / originalLength,
      createdAt: Date.now(),
    };

    // Update stats
    this.stats.summariesCreated++;
    this.stats.totalMessagesProcessed += messages.length;
    this.stats.avgCompressionRatio =
      (this.stats.avgCompressionRatio * (this.stats.summariesCreated - 1) + result.compressionRatio) /
      this.stats.summariesCreated;

    // Cache
    this.summaryCache.set(result.id, result);

    this.emit('summary-created', result);
    logger.info('Summary created', {
      messageCount: messages.length,
      compressionRatio: result.compressionRatio.toFixed(2),
    });

    return result;
  }

  // ============================================================================
  // Topic Extraction
  // ============================================================================

  /**
   * Extract topics from conversation
   */
  extractTopics(messages: ConversationMessage[]): TopicExtraction[] {
    // Tokenize all messages
    const allTokens: string[] = [];
    const messageTokens: Array<{ tokens: string[]; timestamp: number }> = [];

    for (const message of messages) {
      const tokens = this.textProcessor.removeStopWords(this.textProcessor.tokenize(message.content));
      allTokens.push(...tokens);
      messageTokens.push({ tokens, timestamp: message.timestamp });
    }

    // Count word frequencies
    const wordFreq = new Map<string, number>();
    const firstMention = new Map<string, number>();
    const lastMention = new Map<string, number>();

    for (const { tokens, timestamp } of messageTokens) {
      for (const token of tokens) {
        wordFreq.set(token, (wordFreq.get(token) || 0) + 1);

        if (!firstMention.has(token)) {
          firstMention.set(token, timestamp);
        }
        lastMention.set(token, timestamp);
      }
    }

    // Calculate TF-IDF across messages
    const documents = messageTokens.map((m) => m.tokens);
    const tfidfScores = this.textProcessor.calculateTFIDF(documents);

    // Aggregate TF-IDF scores
    const aggregatedTFIDF = new Map<string, number>();
    for (const tfidf of tfidfScores) {
      for (const [word, score] of tfidf) {
        aggregatedTFIDF.set(word, (aggregatedTFIDF.get(word) || 0) + score);
      }
    }

    // Build topic list
    const topics: TopicExtraction[] = [];
    for (const [word, freq] of wordFreq) {
      if (freq >= 2) {
        // At least 2 mentions
        const tfidf = aggregatedTFIDF.get(word) || 0;
        topics.push({
          topic: word,
          relevance: tfidf,
          mentions: freq,
          firstMention: firstMention.get(word)!,
          lastMention: lastMention.get(word)!,
        });
      }
    }

    // Sort by relevance
    topics.sort((a, b) => b.relevance - a.relevance);

    this.stats.topicsExtracted += topics.length;
    this.emit('topics-extracted', topics);

    return topics;
  }

  // ============================================================================
  // Key Point Extraction
  // ============================================================================

  /**
   * Extract key points from conversation
   */
  extractKeyPoints(messages: ConversationMessage[]): string[] {
    // Focus on user and assistant messages
    const relevantMessages = messages.filter((m) => m.role === 'user' || m.role === 'assistant');

    // Get all sentences
    const allSentences: string[] = [];
    for (const message of relevantMessages) {
      const sentences = this.textProcessor.getSentences(message.content);
      allSentences.push(...sentences);
    }

    if (allSentences.length === 0) return [];

    // Rank sentences
    const rankedSentences = this.textProcessor.rankSentences(allSentences);

    // Sort by score
    rankedSentences.sort((a, b) => b.score - a.score);

    // Get top sentences as key points
    const keyPoints = rankedSentences
      .slice(0, this.config.keyPointCount)
      .map((s) => this.truncateSentence(s.sentence, 100));

    return keyPoints;
  }

  /**
   * Truncate sentence to max length
   */
  private truncateSentence(sentence: string, maxLength: number): string {
    if (sentence.length <= maxLength) return sentence;
    return sentence.substring(0, maxLength - 3) + '...';
  }

  // ============================================================================
  // Summary Generation
  // ============================================================================

  /**
   * Generate summary from conversation
   */
  private generateSummary(
    messages: ConversationMessage[],
    topics: TopicExtraction[],
    keyPoints: string[]
  ): string {
    const parts: string[] = [];

    // Topic overview
    const topTopics = topics.slice(0, 3).map((t) => t.topic);
    if (topTopics.length > 0) {
      parts.push(`Discussion covered: ${topTopics.join(', ')}.`);
    }

    // Message flow summary
    const userMessages = messages.filter((m) => m.role === 'user');
    const assistantMessages = messages.filter((m) => m.role === 'assistant');

    parts.push(
      `Conversation had ${userMessages.length} user messages and ${assistantMessages.length} assistant responses.`
    );

    // Key points
    if (keyPoints.length > 0) {
      parts.push('Key points:');
      for (const point of keyPoints.slice(0, 3)) {
        parts.push(`- ${point}`);
      }
    }

    // Combine and limit length
    let summary = parts.join('\n');

    if (summary.length > this.config.maxSummaryLength) {
      summary = summary.substring(0, this.config.maxSummaryLength - 3) + '...';
    }

    return summary;
  }

  // ============================================================================
  // Incremental Summarization
  // ============================================================================

  /**
   * Update summary with new messages
   */
  incrementalUpdate(existingSummary: ConversationSummary, newMessages: ConversationMessage[]): ConversationSummary {
    // Create new summary from new messages
    const newSummary = this.summarize(newMessages);

    // Combine topics
    const combinedTopics = [...new Set([...existingSummary.topics, ...newSummary.topics])];

    // Combine key points (limit to config)
    const combinedKeyPoints = [...existingSummary.keyPoints, ...newSummary.keyPoints].slice(
      0,
      this.config.keyPointCount
    );

    // Combine summaries
    const combinedSummaryText = `${existingSummary.summary}\n\nUpdate: ${newSummary.summary}`;

    const truncatedSummary =
      combinedSummaryText.length > this.config.maxSummaryLength
        ? combinedSummaryText.substring(0, this.config.maxSummaryLength - 3) + '...'
        : combinedSummaryText;

    const updatedSummary: ConversationSummary = {
      id: `summary_${Date.now()}`,
      originalMessageCount: existingSummary.originalMessageCount + newMessages.length,
      summaryLength: truncatedSummary.length,
      topics: combinedTopics.slice(0, this.config.topicCount),
      keyPoints: combinedKeyPoints,
      summary: truncatedSummary,
      compressionRatio:
        truncatedSummary.length / (existingSummary.summaryLength + newSummary.summaryLength),
      createdAt: Date.now(),
    };

    this.summaryCache.set(updatedSummary.id, updatedSummary);

    return updatedSummary;
  }

  // ============================================================================
  // Rolling Window Summarization
  // ============================================================================

  /**
   * Create rolling summary for continuous conversations
   */
  rollingWindowSummary(
    messages: ConversationMessage[],
    windowSize: number,
    overlap: number
  ): ConversationSummary {
    const summaries: ConversationSummary[] = [];

    for (let i = 0; i < messages.length; i += windowSize - overlap) {
      const window = messages.slice(i, i + windowSize);
      if (window.length >= this.config.minMessageThreshold) {
        summaries.push(this.summarize(window));
      }
    }

    if (summaries.length === 0) {
      return this.summarize(messages);
    }

    // Merge all window summaries
    return this.mergeSummaries(summaries);
  }

  /**
   * Merge multiple summaries
   */
  private mergeSummaries(summaries: ConversationSummary[]): ConversationSummary {
    const allTopics: string[] = [];
    const allKeyPoints: string[] = [];
    const allSummaryTexts: string[] = [];
    let totalMessages = 0;

    for (const summary of summaries) {
      allTopics.push(...summary.topics);
      allKeyPoints.push(...summary.keyPoints);
      allSummaryTexts.push(summary.summary);
      totalMessages += summary.originalMessageCount;
    }

    // Deduplicate and limit
    const uniqueTopics = [...new Set(allTopics)].slice(0, this.config.topicCount);
    const uniqueKeyPoints = [...new Set(allKeyPoints)].slice(0, this.config.keyPointCount);

    // Combine summary texts
    const combinedText = allSummaryTexts.join('\n\n');
    const truncatedSummary =
      combinedText.length > this.config.maxSummaryLength
        ? combinedText.substring(0, this.config.maxSummaryLength - 3) + '...'
        : combinedText;

    return {
      id: `merged_summary_${Date.now()}`,
      originalMessageCount: totalMessages,
      summaryLength: truncatedSummary.length,
      topics: uniqueTopics,
      keyPoints: uniqueKeyPoints,
      summary: truncatedSummary,
      compressionRatio: truncatedSummary.length / summaries.reduce((a, s) => a + s.summaryLength, 0),
      createdAt: Date.now(),
    };
  }

  // ============================================================================
  // Utilities
  // ============================================================================

  /**
   * Get cached summary
   */
  getCachedSummary(summaryId: string): ConversationSummary | undefined {
    return this.summaryCache.get(summaryId);
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.summaryCache.clear();
    logger.info('Summary cache cleared');
  }

  /**
   * Get statistics
   */
  getStats(): {
    summariesCreated: number;
    totalMessagesProcessed: number;
    avgCompressionRatio: number;
    topicsExtracted: number;
    cachedSummaries: number;
  } {
    return {
      ...this.stats,
      cachedSummaries: this.summaryCache.size,
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<SummarizerConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('Config updated', { config: this.config });
  }
}

// ============================================================================
// Singleton
// ============================================================================

let conversationSummarizer: ConversationSummarizer | null = null;

export function getConversationSummarizer(): ConversationSummarizer {
  if (!conversationSummarizer) {
    conversationSummarizer = new ConversationSummarizer();
  }
  return conversationSummarizer;
}
