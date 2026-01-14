/**
 * Nova Desktop - Memory Summarizer
 * Summarizes low-importance memories for efficient storage
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../../utils/logger';
import { VectorDocument, VectorMetadata } from '../vector-store';
import { getSemanticChunker } from '../semantic-chunker';

const logger = createModuleLogger('Summarizer');

/**
 * Summarization strategy
 */
export type SummarizationStrategy = 'extractive' | 'abstractive' | 'hybrid';

/**
 * Summarization configuration
 */
export interface SummarizerConfig {
  /** Summarization strategy */
  strategy: SummarizationStrategy;
  /** Target length for summaries (in characters) */
  targetLength: number;
  /** Minimum importance to keep full detail */
  fullDetailThreshold: number;
  /** Importance threshold for light summarization */
  lightSummaryThreshold: number;
  /** Enable LLM-based summarization (when available) */
  enableLLMSummarization: boolean;
}

const DEFAULT_CONFIG: SummarizerConfig = {
  strategy: 'extractive',
  targetLength: 500,
  fullDetailThreshold: 0.7,
  lightSummaryThreshold: 0.4,
  enableLLMSummarization: false,
};

/**
 * Summarization result
 */
export interface SummarizationResult {
  /** Original document IDs */
  sourceIds: string[];
  /** Summary content */
  summary: string;
  /** Combined topics */
  topics: string[];
  /** Average importance of sources */
  combinedImportance: number;
  /** Strategy used */
  strategyUsed: SummarizationStrategy;
  /** Compression ratio */
  compressionRatio: number;
}

/**
 * Summarizer events
 */
export interface SummarizerEvents {
  'summarization-started': (documentCount: number) => void;
  'summarization-completed': (result: SummarizationResult) => void;
  error: (error: Error) => void;
}

/**
 * Memory Summarizer
 * Intelligently summarizes memories based on importance
 */
export class MemorySummarizer extends EventEmitter {
  private config: SummarizerConfig;

  constructor(config?: Partial<SummarizerConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    logger.info('MemorySummarizer initialized', { config: this.config });
  }

  /**
   * Determine summarization level based on importance
   */
  getSummarizationLevel(importance: number): 'full' | 'light' | 'aggressive' {
    if (importance >= this.config.fullDetailThreshold) {
      return 'full'; // Keep full detail
    }
    if (importance >= this.config.lightSummaryThreshold) {
      return 'light'; // Light summarization
    }
    return 'aggressive'; // Aggressive summarization
  }

  /**
   * Summarize a single document based on importance
   */
  summarizeDocument(doc: VectorDocument): string {
    const level = this.getSummarizationLevel(doc.metadata.importance);

    switch (level) {
      case 'full':
        return doc.content;
      case 'light':
        return this.lightSummarize(doc.content);
      case 'aggressive':
        return this.aggressiveSummarize(doc.content);
    }
  }

  /**
   * Summarize multiple related documents into one
   */
  summarizeGroup(documents: VectorDocument[]): SummarizationResult {
    this.emit('summarization-started', documents.length);

    const chunker = getSemanticChunker();

    // Collect all content
    const allContent = documents.map((d) => d.content).join('\n\n');
    const originalLength = allContent.length;

    // Collect all topics
    const allTopics = new Set<string>();
    for (const doc of documents) {
      if (doc.metadata.topics) {
        doc.metadata.topics.forEach((t) => allTopics.add(t));
      }
      // Extract additional topics from content
      chunker.extractTopics(doc.content).forEach((t) => allTopics.add(t));
    }

    // Calculate combined importance (weighted by content length)
    let totalWeight = 0;
    let weightedImportance = 0;
    for (const doc of documents) {
      const weight = doc.content.length;
      totalWeight += weight;
      weightedImportance += doc.metadata.importance * weight;
    }
    const combinedImportance = totalWeight > 0 ? weightedImportance / totalWeight : 0.5;

    // Choose summarization strategy
    let summary: string;
    const strategyUsed = this.config.strategy;

    switch (strategyUsed) {
      case 'abstractive':
        summary = this.abstractiveSummarize(documents);
        break;
      case 'hybrid':
        summary = this.hybridSummarize(documents);
        break;
      case 'extractive':
      default:
        summary = this.extractiveSummarize(documents);
    }

    const result: SummarizationResult = {
      sourceIds: documents.map((d) => d.id),
      summary,
      topics: Array.from(allTopics),
      combinedImportance,
      strategyUsed,
      compressionRatio: originalLength > 0 ? summary.length / originalLength : 1,
    };

    this.emit('summarization-completed', result);
    logger.debug('Group summarized', {
      documents: documents.length,
      originalLength,
      summaryLength: summary.length,
      compressionRatio: result.compressionRatio.toFixed(2),
    });

    return result;
  }

  /**
   * Light summarization - removes filler words, keeps key information
   */
  private lightSummarize(content: string): string {
    const sentences = this.splitSentences(content);
    const scored = this.scoreSentences(sentences);

    // Keep top 70% of sentences
    const threshold = Math.ceil(sentences.length * 0.7);
    const kept = scored.slice(0, threshold).sort((a, b) => a.index - b.index);

    return kept.map((s) => s.sentence).join(' ');
  }

  /**
   * Aggressive summarization - keeps only key sentences
   */
  private aggressiveSummarize(content: string): string {
    const sentences = this.splitSentences(content);
    const scored = this.scoreSentences(sentences);

    // Keep top 30% of sentences or minimum 1
    const threshold = Math.max(1, Math.ceil(sentences.length * 0.3));
    const kept = scored.slice(0, threshold).sort((a, b) => a.index - b.index);

    return kept.map((s) => s.sentence).join(' ');
  }

  /**
   * Extractive summarization - selects important sentences
   */
  private extractiveSummarize(documents: VectorDocument[]): string {
    const allSentences: Array<{ sentence: string; docIndex: number; importance: number }> = [];

    // Extract and score sentences from all documents
    for (let i = 0; i < documents.length; i++) {
      const doc = documents[i];
      const sentences = this.splitSentences(doc.content);
      const scored = this.scoreSentences(sentences);

      for (const s of scored) {
        allSentences.push({
          sentence: s.sentence,
          docIndex: i,
          importance: s.score * doc.metadata.importance,
        });
      }
    }

    // Sort by importance
    allSentences.sort((a, b) => b.importance - a.importance);

    // Select sentences up to target length
    const selected: string[] = [];
    let currentLength = 0;

    for (const item of allSentences) {
      if (currentLength + item.sentence.length > this.config.targetLength) {
        continue;
      }
      selected.push(item.sentence);
      currentLength += item.sentence.length;
    }

    return selected.join(' ');
  }

  /**
   * Abstractive summarization - generates new summary text
   * Falls back to extractive if LLM not available
   */
  private abstractiveSummarize(documents: VectorDocument[]): string {
    // For now, fall back to extractive
    // Real implementation would use LLM
    logger.debug('Abstractive summarization falling back to extractive');
    return this.extractiveSummarize(documents);
  }

  /**
   * Hybrid summarization - combines extractive and abstractive
   */
  private hybridSummarize(documents: VectorDocument[]): string {
    // Extract key sentences
    const extractive = this.extractiveSummarize(documents);

    // Create a structured summary
    const topics = new Set<string>();
    const chunker = getSemanticChunker();

    for (const doc of documents) {
      chunker.extractTopics(doc.content).forEach((t) => topics.add(t));
    }

    if (topics.size > 0) {
      return `[Topics: ${Array.from(topics).slice(0, 5).join(', ')}] ${extractive}`;
    }

    return extractive;
  }

  /**
   * Split text into sentences
   */
  private splitSentences(text: string): string[] {
    // Simple sentence splitting
    return text
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  /**
   * Score sentences by importance
   */
  private scoreSentences(
    sentences: string[]
  ): Array<{ sentence: string; score: number; index: number }> {
    const scored = sentences.map((sentence, index) => ({
      sentence,
      score: this.scoreSentence(sentence),
      index,
    }));

    // Sort by score descending
    return scored.sort((a, b) => b.score - a.score);
  }

  /**
   * Score a single sentence
   */
  private scoreSentence(sentence: string): number {
    let score = 0.5; // Base score

    // Length bonus (prefer medium-length sentences)
    const wordCount = sentence.split(/\s+/).length;
    if (wordCount >= 5 && wordCount <= 25) {
      score += 0.1;
    }

    // Important keyword bonus
    const importantKeywords = [
      'important',
      'remember',
      'always',
      'never',
      'must',
      'need',
      'want',
      'prefer',
      'like',
      'name',
      'birthday',
      'because',
      'therefore',
      'however',
      'first',
      'finally',
      'key',
      'main',
    ];

    const lowerSentence = sentence.toLowerCase();
    for (const keyword of importantKeywords) {
      if (lowerSentence.includes(keyword)) {
        score += 0.05;
      }
    }

    // Question bonus
    if (sentence.includes('?')) {
      score += 0.1;
    }

    // Named entity bonus (simple heuristic: capitalized words not at start)
    const words = sentence.split(/\s+/);
    for (let i = 1; i < words.length; i++) {
      if (/^[A-Z][a-z]+/.test(words[i])) {
        score += 0.03;
      }
    }

    // Number bonus (specific information)
    if (/\d+/.test(sentence)) {
      score += 0.05;
    }

    return Math.min(1, score);
  }

  /**
   * Create summary metadata
   */
  createSummaryMetadata(
    result: SummarizationResult,
    originalMetadata?: Partial<VectorMetadata>
  ): VectorMetadata {
    return {
      sourceType: originalMetadata?.sourceType || 'context',
      importance: result.combinedImportance,
      accessCount: 0,
      topics: result.topics,
      isSummary: true,
      summarizedIds: result.sourceIds,
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<SummarizerConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('Summarizer config updated', { config: this.config });
  }

  // Type-safe event emitter methods
  on<K extends keyof SummarizerEvents>(event: K, listener: SummarizerEvents[K]): this {
    return super.on(event, listener);
  }

  off<K extends keyof SummarizerEvents>(event: K, listener: SummarizerEvents[K]): this {
    return super.off(event, listener);
  }

  emit<K extends keyof SummarizerEvents>(
    event: K,
    ...args: Parameters<SummarizerEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }
}

// Singleton instance
let summarizer: MemorySummarizer | null = null;

/**
 * Get or create the summarizer instance
 */
export function getMemorySummarizer(config?: Partial<SummarizerConfig>): MemorySummarizer {
  if (!summarizer) {
    summarizer = new MemorySummarizer(config);
  }
  return summarizer;
}

export default MemorySummarizer;
