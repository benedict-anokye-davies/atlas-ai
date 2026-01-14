/**
 * Nova Desktop - Semantic Chunker
 * Breaks conversations into semantic chunks for better memory organization
 */

import { createModuleLogger } from '../utils/logger';
import { ChatMessage } from '../../shared/types/llm';

const logger = createModuleLogger('SemanticChunker');

/**
 * Semantic chunk representing a coherent conversation segment
 */
export interface SemanticChunk {
  /** Unique identifier */
  id: string;
  /** Chunk content (formatted conversation) */
  content: string;
  /** Detected topics in this chunk */
  topics: string[];
  /** Importance score (0-1) */
  importance: number;
  /** Creation timestamp */
  timestamp: number;
  /** Number of turns in this chunk */
  turnCount: number;
  /** Start index in original conversation */
  startIndex: number;
  /** End index in original conversation */
  endIndex: number;
  /** Optional embedding for vector search */
  embedding?: number[];
  /** Summary of the chunk (if generated) */
  summary?: string;
}

/**
 * Topic detection keywords organized by category
 */
const TOPIC_KEYWORDS: Record<string, string[]> = {
  weather: ['weather', 'temperature', 'rain', 'sun', 'forecast', 'cold', 'hot', 'snow', 'storm'],
  coding: [
    'code',
    'programming',
    'function',
    'bug',
    'error',
    'debug',
    'javascript',
    'python',
    'react',
    'api',
  ],
  music: ['music', 'song', 'playlist', 'album', 'artist', 'play', 'listen', 'spotify'],
  calendar: ['calendar', 'schedule', 'meeting', 'appointment', 'event', 'reminder', 'time', 'date'],
  email: ['email', 'mail', 'send', 'inbox', 'message', 'reply'],
  files: ['file', 'folder', 'document', 'save', 'open', 'download', 'upload'],
  web: ['website', 'browser', 'search', 'google', 'internet', 'url', 'link'],
  help: ['help', 'how', 'what', 'why', 'explain', 'tutorial', 'guide'],
  settings: ['settings', 'preference', 'configure', 'option', 'change', 'update'],
  personal: ['like', 'love', 'hate', 'prefer', 'favorite', 'always', 'never', 'usually'],
  tasks: ['todo', 'task', 'list', 'complete', 'done', 'finish', 'deadline'],
  general: ['hi', 'hello', 'thanks', 'bye', 'good', 'great', 'okay'],
};

/**
 * Importance keywords that boost chunk importance
 */
const IMPORTANCE_KEYWORDS: Record<string, number> = {
  // High importance - user preferences and facts
  remember: 0.3,
  "don't forget": 0.3,
  important: 0.25,
  always: 0.2,
  never: 0.2,
  prefer: 0.2,
  favorite: 0.2,
  'my name': 0.3,
  birthday: 0.25,
  // Medium importance - decisions and actions
  decide: 0.15,
  decision: 0.15,
  choice: 0.1,
  should: 0.1,
  // Lower importance - general engagement
  interesting: 0.05,
  cool: 0.05,
  nice: 0.05,
};

/**
 * Chunker configuration
 */
export interface SemanticChunkerConfig {
  /** Maximum turns per chunk */
  maxTurnsPerChunk: number;
  /** Minimum turns per chunk */
  minTurnsPerChunk: number;
  /** Topic change threshold (0-1) */
  topicChangeThreshold: number;
  /** Base importance for all chunks */
  baseImportance: number;
}

/**
 * Default chunker configuration
 */
const DEFAULT_CONFIG: SemanticChunkerConfig = {
  maxTurnsPerChunk: 10,
  minTurnsPerChunk: 2,
  topicChangeThreshold: 0.5,
  baseImportance: 0.3,
};

/**
 * Semantic Chunker
 * Analyzes conversations and breaks them into meaningful chunks
 */
export class SemanticChunker {
  private config: SemanticChunkerConfig;

  constructor(config?: Partial<SemanticChunkerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    logger.info('SemanticChunker initialized', { config: this.config });
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `chunk-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Extract topics from text
   */
  extractTopics(text: string): string[] {
    const normalizedText = text.toLowerCase();
    const topics: string[] = [];

    for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS)) {
      if (keywords.some((keyword) => normalizedText.includes(keyword))) {
        topics.push(topic);
      }
    }

    return topics;
  }

  /**
   * Calculate topic similarity between two sets of topics
   */
  private calculateTopicSimilarity(topics1: string[], topics2: string[]): number {
    if (topics1.length === 0 && topics2.length === 0) return 1;
    if (topics1.length === 0 || topics2.length === 0) return 0;

    const intersection = topics1.filter((t) => topics2.includes(t));
    const union = [...new Set([...topics1, ...topics2])];

    return intersection.length / union.length;
  }

  /**
   * Calculate importance score for text
   */
  calculateImportance(text: string): number {
    const normalizedText = text.toLowerCase();
    let score = this.config.baseImportance;

    // Check for importance keywords
    for (const [keyword, boost] of Object.entries(IMPORTANCE_KEYWORDS)) {
      if (normalizedText.includes(keyword)) {
        score += boost;
      }
    }

    // Boost for questions (often important context)
    const questionCount = (text.match(/\?/g) || []).length;
    score += Math.min(questionCount * 0.05, 0.15);

    // Boost for longer, substantive content
    const wordCount = text.split(/\s+/).length;
    if (wordCount > 50) score += 0.1;
    if (wordCount > 100) score += 0.1;

    // Cap at 1.0
    return Math.min(1.0, score);
  }

  /**
   * Detect if there's a topic shift between turns
   */
  detectTopicShift(prevTopics: string[], currentTopics: string[]): boolean {
    const similarity = this.calculateTopicSimilarity(prevTopics, currentTopics);
    return similarity < this.config.topicChangeThreshold;
  }

  /**
   * Format messages into readable content
   */
  private formatMessages(messages: ChatMessage[]): string {
    return messages.map((m) => `${m.role === 'user' ? 'User' : 'Nova'}: ${m.content}`).join('\n');
  }

  /**
   * Chunk a conversation into semantic segments
   */
  chunkConversation(messages: ChatMessage[]): SemanticChunk[] {
    if (messages.length === 0) return [];

    const chunks: SemanticChunk[] = [];
    let currentChunkMessages: ChatMessage[] = [];
    let currentChunkTopics: Set<string> = new Set();
    let currentChunkStartIndex = 0;
    let previousTopics: string[] = [];

    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      const messageTopics = this.extractTopics(message.content);

      // Check if we should start a new chunk
      const shouldSplit =
        // Reached max turns
        currentChunkMessages.length >= this.config.maxTurnsPerChunk ||
        // Topic shift detected (and have minimum turns)
        (currentChunkMessages.length >= this.config.minTurnsPerChunk &&
          this.detectTopicShift(previousTopics, messageTopics) &&
          messageTopics.length > 0);

      if (shouldSplit && currentChunkMessages.length > 0) {
        // Create chunk from accumulated messages
        chunks.push(
          this.createChunk(
            currentChunkMessages,
            Array.from(currentChunkTopics),
            currentChunkStartIndex,
            i - 1
          )
        );

        // Reset for new chunk
        currentChunkMessages = [];
        currentChunkTopics = new Set();
        currentChunkStartIndex = i;
      }

      // Add message to current chunk
      currentChunkMessages.push(message);
      messageTopics.forEach((t) => currentChunkTopics.add(t));
      previousTopics = messageTopics;
    }

    // Create final chunk if there are remaining messages
    if (currentChunkMessages.length > 0) {
      chunks.push(
        this.createChunk(
          currentChunkMessages,
          Array.from(currentChunkTopics),
          currentChunkStartIndex,
          messages.length - 1
        )
      );
    }

    logger.info('Conversation chunked', {
      originalMessages: messages.length,
      chunks: chunks.length,
    });

    return chunks;
  }

  /**
   * Create a semantic chunk from messages
   */
  private createChunk(
    messages: ChatMessage[],
    topics: string[],
    startIndex: number,
    endIndex: number
  ): SemanticChunk {
    const content = this.formatMessages(messages);
    const importance = this.calculateImportance(content);

    return {
      id: this.generateId(),
      content,
      topics,
      importance,
      timestamp: Date.now(),
      turnCount: messages.length,
      startIndex,
      endIndex,
    };
  }

  /**
   * Merge similar chunks (for consolidation)
   */
  mergeChunks(chunks: SemanticChunk[]): SemanticChunk[] {
    if (chunks.length < 2) return chunks;

    const merged: SemanticChunk[] = [];
    let current = chunks[0];

    for (let i = 1; i < chunks.length; i++) {
      const next = chunks[i];

      // Merge if topics are similar and combined size is acceptable
      const similarity = this.calculateTopicSimilarity(current.topics, next.topics);
      const combinedTurns = current.turnCount + next.turnCount;

      if (similarity > 0.6 && combinedTurns <= this.config.maxTurnsPerChunk) {
        // Merge chunks
        current = {
          id: current.id, // Keep original ID
          content: `${current.content}\n\n${next.content}`,
          topics: [...new Set([...current.topics, ...next.topics])],
          importance: Math.max(current.importance, next.importance),
          timestamp: current.timestamp, // Keep original timestamp
          turnCount: combinedTurns,
          startIndex: current.startIndex,
          endIndex: next.endIndex,
        };
      } else {
        merged.push(current);
        current = next;
      }
    }

    merged.push(current);

    logger.debug('Chunks merged', {
      original: chunks.length,
      merged: merged.length,
    });

    return merged;
  }

  /**
   * Get chunks above a certain importance threshold
   */
  getImportantChunks(chunks: SemanticChunk[], threshold = 0.5): SemanticChunk[] {
    return chunks.filter((c) => c.importance >= threshold);
  }

  /**
   * Get chunks by topic
   */
  getChunksByTopic(chunks: SemanticChunk[], topic: string): SemanticChunk[] {
    return chunks.filter((c) => c.topics.includes(topic.toLowerCase()));
  }

  /**
   * Search chunks by keyword
   */
  searchChunks(chunks: SemanticChunk[], keyword: string): SemanticChunk[] {
    const normalizedKeyword = keyword.toLowerCase();
    return chunks.filter((c) => c.content.toLowerCase().includes(normalizedKeyword));
  }
}

// Export singleton factory
let chunkerInstance: SemanticChunker | null = null;

export function getSemanticChunker(config?: Partial<SemanticChunkerConfig>): SemanticChunker {
  if (!chunkerInstance) {
    chunkerInstance = new SemanticChunker(config);
  }
  return chunkerInstance;
}

export default SemanticChunker;
