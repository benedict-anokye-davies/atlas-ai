/**
 * Atlas Desktop - Context Builder
 * Assembles intelligent context from conversation history, memories, and preferences
 * for LLM prompts
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import { ChatMessage } from '../../shared/types/llm';
import { getSemanticChunker } from './semantic-chunker';
import { getPreferenceLearner } from './preference-learner';
import { getMemoryManager } from './index';

const logger = createModuleLogger('ContextBuilder');

/**
 * A turn in the conversation
 */
export interface ConversationTurn {
  /** Turn ID */
  id: string;
  /** User message */
  userMessage: string;
  /** Assistant response */
  assistantResponse: string;
  /** Timestamp */
  timestamp: number;
  /** Detected topics */
  topics: string[];
  /** Sentiment */
  sentiment: 'positive' | 'negative' | 'neutral';
  /** Importance score */
  importance: number;
  /** Whether this turn was summarized */
  summarized?: boolean;
}

/**
 * Context assembly options
 */
export interface ContextOptions {
  /** Maximum recent turns to include verbatim */
  maxRecentTurns?: number;
  /** Maximum older turns to summarize */
  maxSummarizedTurns?: number;
  /** Include user preferences */
  includePreferences?: boolean;
  /** Include relevant memories */
  includeMemories?: boolean;
  /** Include topic summary */
  includeTopics?: boolean;
  /** Maximum context length in characters */
  maxLength?: number;
  /** Target topic for relevance (optional) */
  targetTopic?: string;
  /** Priority for different context types */
  priorities?: {
    recentTurns: number;
    summarizedTurns: number;
    preferences: number;
    memories: number;
  };
}

/**
 * Assembled context result
 */
export interface AssembledContext {
  /** System context (preferences, memories) */
  systemContext: string;
  /** Conversation history as messages */
  conversationHistory: ChatMessage[];
  /** Summary of older conversation */
  conversationSummary: string | null;
  /** Detected current topics */
  currentTopics: string[];
  /** Total token estimate */
  estimatedTokens: number;
  /** Debug information */
  debug: {
    recentTurnsIncluded: number;
    summarizedTurnsIncluded: number;
    preferencesIncluded: number;
    memoriesIncluded: number;
    truncated: boolean;
  };
}

/**
 * Topic tracking for the current conversation
 */
interface TopicTracker {
  name: string;
  firstMentioned: number;
  lastMentioned: number;
  mentions: number;
  weight: number;
}

/**
 * Default context options
 */
const DEFAULT_OPTIONS: Required<ContextOptions> = {
  maxRecentTurns: 5,
  maxSummarizedTurns: 10,
  includePreferences: true,
  includeMemories: true,
  includeTopics: true,
  maxLength: 8000,
  targetTopic: '',
  priorities: {
    recentTurns: 1.0,
    summarizedTurns: 0.6,
    preferences: 0.8,
    memories: 0.7,
  },
};

/**
 * Context Builder Events
 */
export interface ContextBuilderEvents {
  'turn-added': (turn: ConversationTurn) => void;
  'topic-changed': (oldTopic: string | null, newTopic: string) => void;
  'context-built': (context: AssembledContext) => void;
  'conversation-cleared': () => void;
}

/**
 * Context Builder Configuration
 */
export interface ContextBuilderConfig {
  /** Maximum turns to keep in history */
  maxHistoryTurns: number;
  /** Enable automatic topic tracking */
  enableTopicTracking: boolean;
  /** Enable automatic preference extraction */
  enablePreferenceExtraction: boolean;
  /** Summarization threshold (turns before summarizing) */
  summarizeThreshold: number;
}

const DEFAULT_CONFIG: ContextBuilderConfig = {
  maxHistoryTurns: 50,
  enableTopicTracking: true,
  enablePreferenceExtraction: true,
  summarizeThreshold: 10,
};

/**
 * Context Builder
 * Builds intelligent context for LLM prompts from multiple sources
 */
export class ContextBuilder extends EventEmitter {
  private config: ContextBuilderConfig;
  private turns: ConversationTurn[] = [];
  private topics: Map<string, TopicTracker> = new Map();
  private currentTopic: string | null = null;
  private sessionStartTime: number = Date.now();
  private summarizedContext: string | null = null;
  private summarizedTurnCount = 0;

  constructor(config?: Partial<ContextBuilderConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    logger.info('ContextBuilder initialized', { config: this.config });
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `turn-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Estimate tokens from text (rough approximation)
   */
  private estimateTokens(text: string): number {
    // Rough estimate: 1 token ≈ 4 characters
    return Math.ceil(text.length / 4);
  }

  /**
   * Add a conversation turn
   */
  async addTurn(userMessage: string, assistantResponse: string): Promise<ConversationTurn> {
    const chunker = getSemanticChunker();
    const topics = chunker.extractTopics(userMessage + ' ' + assistantResponse);
    const importance = chunker.calculateImportance(userMessage + ' ' + assistantResponse);
    const sentiment = this.analyzeSentiment(userMessage);

    const turn: ConversationTurn = {
      id: this.generateId(),
      userMessage,
      assistantResponse,
      timestamp: Date.now(),
      topics,
      sentiment,
      importance,
    };

    this.turns.push(turn);

    // Update topic tracking
    if (this.config.enableTopicTracking) {
      this.updateTopics(topics);
    }

    // Extract preferences if enabled
    if (this.config.enablePreferenceExtraction) {
      try {
        const learner = await getPreferenceLearner();
        learner.extractPreferences(userMessage);
      } catch (error) {
        logger.debug('Preference extraction skipped', { error: (error as Error).message });
      }
    }

    // Trim old turns if over limit
    if (this.turns.length > this.config.maxHistoryTurns) {
      this.turns.shift();
    }

    // Check if we need to summarize older turns
    if (this.turns.length > this.config.summarizeThreshold) {
      await this.summarizeOlderTurns();
    }

    this.emit('turn-added', turn);

    logger.debug('Turn added', {
      turnId: turn.id,
      topics,
      importance: importance.toFixed(2),
      totalTurns: this.turns.length,
    });

    return turn;
  }

  /**
   * Analyze sentiment of text
   */
  private analyzeSentiment(text: string): 'positive' | 'negative' | 'neutral' {
    const lowerText = text.toLowerCase();

    const positiveWords = [
      'great',
      'awesome',
      'thanks',
      'thank',
      'love',
      'good',
      'nice',
      'excellent',
      'wonderful',
      'amazing',
      'helpful',
      'perfect',
      'happy',
    ];
    const negativeWords = [
      'bad',
      'hate',
      'annoying',
      'wrong',
      'terrible',
      'awful',
      'horrible',
      'frustrated',
      'angry',
      'upset',
      'disappointed',
      'problem',
      'error',
    ];

    const positiveCount = positiveWords.filter((w) => lowerText.includes(w)).length;
    const negativeCount = negativeWords.filter((w) => lowerText.includes(w)).length;

    if (positiveCount > negativeCount) return 'positive';
    if (negativeCount > positiveCount) return 'negative';
    return 'neutral';
  }

  /**
   * Update topic tracking
   */
  private updateTopics(newTopics: string[]): void {
    const now = Date.now();

    for (const topic of newTopics) {
      const existing = this.topics.get(topic);

      if (existing) {
        existing.lastMentioned = now;
        existing.mentions++;
        existing.weight = Math.min(1, existing.weight + 0.15);
      } else {
        this.topics.set(topic, {
          name: topic,
          firstMentioned: now,
          lastMentioned: now,
          mentions: 1,
          weight: 0.5,
        });
      }
    }

    // Decay weights for topics not mentioned
    for (const [name, tracker] of this.topics) {
      if (!newTopics.includes(name)) {
        tracker.weight *= 0.9;
        if (tracker.weight < 0.1) {
          this.topics.delete(name);
        }
      }
    }

    // Update current topic
    const topTopics = Array.from(this.topics.values()).sort((a, b) => b.weight - a.weight);

    if (topTopics.length > 0 && topTopics[0].name !== this.currentTopic) {
      const oldTopic = this.currentTopic;
      this.currentTopic = topTopics[0].name;
      this.emit('topic-changed', oldTopic, this.currentTopic);
    }
  }

  /**
   * Summarize older turns to save context space
   */
  private async summarizeOlderTurns(): Promise<void> {
    const turnsToSummarize = this.turns.slice(0, -this.config.summarizeThreshold);
    if (turnsToSummarize.length === 0) return;

    // Simple summarization: extract key points
    const keyPoints: string[] = [];

    for (const turn of turnsToSummarize) {
      if (turn.importance > 0.6) {
        keyPoints.push(`User asked about: ${turn.userMessage.slice(0, 50)}...`);
      }
    }

    if (keyPoints.length > 0) {
      this.summarizedContext = `Earlier in conversation: ${keyPoints.join('; ')}`;
      this.summarizedTurnCount = turnsToSummarize.length;

      // Mark turns as summarized
      for (const turn of turnsToSummarize) {
        turn.summarized = true;
      }

      logger.debug('Turns summarized', {
        count: turnsToSummarize.length,
        keyPoints: keyPoints.length,
      });
    }
  }

  /**
   * Build context for LLM prompt
   */
  async buildContext(options?: ContextOptions): Promise<AssembledContext> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const parts: string[] = [];

    const debug = {
      recentTurnsIncluded: 0,
      summarizedTurnsIncluded: 0,
      preferencesIncluded: 0,
      memoriesIncluded: 0,
      truncated: false,
    };

    // 1. Include user preferences
    if (opts.includePreferences) {
      try {
        const learner = await getPreferenceLearner();
        const summary = learner.getPreferenceSummary();
        if (summary) {
          parts.push(`[User preferences: ${summary}]`);
          debug.preferencesIncluded = 1;
        }
      } catch (error) {
        logger.debug('Preference summary skipped', { error: (error as Error).message });
      }
    }

    // 2. Include relevant memories
    if (opts.includeMemories) {
      try {
        const memoryManager = await getMemoryManager();
        const relevantEntries = memoryManager.searchEntries({
          minImportance: 0.7,
          limit: 5,
        });

        if (relevantEntries.length > 0) {
          const memoryText = relevantEntries.map((e) => e.content).join('; ');
          parts.push(`[Relevant memories: ${memoryText}]`);
          debug.memoriesIncluded = relevantEntries.length;
        }
      } catch (error) {
        logger.debug('Memory retrieval skipped', { error: (error as Error).message });
      }
    }

    // 3. Include topic summary
    if (opts.includeTopics && this.currentTopic) {
      const activeTopics = Array.from(this.topics.values())
        .filter((t) => t.weight > 0.3)
        .map((t) => t.name)
        .slice(0, 5);

      if (activeTopics.length > 0) {
        parts.push(`[Current topics: ${activeTopics.join(', ')}]`);
      }
    }

    // 4. Include summarized older turns
    if (this.summarizedContext && opts.maxSummarizedTurns > 0) {
      parts.push(this.summarizedContext);
      debug.summarizedTurnsIncluded = this.summarizedTurnCount;
    }

    // Build system context
    const systemContext = parts.join('\n');

    // 5. Build conversation history
    const recentTurns = this.turns.filter((t) => !t.summarized).slice(-opts.maxRecentTurns);

    const conversationHistory: ChatMessage[] = [];
    for (const turn of recentTurns) {
      conversationHistory.push({ role: 'user', content: turn.userMessage });
      conversationHistory.push({ role: 'assistant', content: turn.assistantResponse });
    }
    debug.recentTurnsIncluded = recentTurns.length;

    // 6. Check total length and truncate if needed
    const totalLength =
      systemContext.length + conversationHistory.reduce((acc, m) => acc + m.content.length, 0);

    if (totalLength > opts.maxLength) {
      debug.truncated = true;
      logger.debug('Context truncated', {
        totalLength,
        maxLength: opts.maxLength,
      });
    }

    // Get current topics
    const currentTopics = Array.from(this.topics.values())
      .filter((t) => t.weight > 0.3)
      .sort((a, b) => b.weight - a.weight)
      .map((t) => t.name);

    const result: AssembledContext = {
      systemContext,
      conversationHistory,
      conversationSummary: this.summarizedContext,
      currentTopics,
      estimatedTokens: this.estimateTokens(
        systemContext + conversationHistory.map((m) => m.content).join('')
      ),
      debug,
    };

    this.emit('context-built', result);

    logger.debug('Context built', {
      systemContextLength: systemContext.length,
      historyMessages: conversationHistory.length,
      currentTopics,
      estimatedTokens: result.estimatedTokens,
    });

    return result;
  }

  /**
   * Get recent turns
   */
  getRecentTurns(limit = 5): ConversationTurn[] {
    return this.turns.slice(-limit);
  }

  /**
   * Get all turns
   */
  getAllTurns(): ConversationTurn[] {
    return [...this.turns];
  }

  /**
   * Get current topic
   */
  getCurrentTopic(): string | null {
    return this.currentTopic;
  }

  /**
   * Get all active topics
   */
  getActiveTopics(): TopicTracker[] {
    return Array.from(this.topics.values())
      .filter((t) => t.weight > 0.2)
      .sort((a, b) => b.weight - a.weight);
  }

  /**
   * Get conversation summary
   */
  getConversationSummary(): {
    turnCount: number;
    duration: number;
    mainTopics: string[];
    sentiment: 'positive' | 'negative' | 'neutral' | 'mixed';
  } {
    const sentiments = this.turns.map((t) => t.sentiment);
    const positiveCount = sentiments.filter((s) => s === 'positive').length;
    const negativeCount = sentiments.filter((s) => s === 'negative').length;

    let overallSentiment: 'positive' | 'negative' | 'neutral' | 'mixed';
    if (positiveCount > negativeCount * 2) {
      overallSentiment = 'positive';
    } else if (negativeCount > positiveCount * 2) {
      overallSentiment = 'negative';
    } else if (positiveCount > 0 && negativeCount > 0) {
      overallSentiment = 'mixed';
    } else {
      overallSentiment = 'neutral';
    }

    return {
      turnCount: this.turns.length,
      duration: Date.now() - this.sessionStartTime,
      mainTopics: this.getActiveTopics()
        .slice(0, 5)
        .map((t) => t.name),
      sentiment: overallSentiment,
    };
  }

  /**
   * Clear conversation history
   */
  clear(): void {
    this.turns = [];
    this.topics.clear();
    this.currentTopic = null;
    this.summarizedContext = null;
    this.summarizedTurnCount = 0;
    this.sessionStartTime = Date.now();

    this.emit('conversation-cleared');
    logger.info('ContextBuilder cleared');
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalTurns: number;
    activeTopics: number;
    summarizedTurns: number;
    sessionDuration: number;
  } {
    return {
      totalTurns: this.turns.length,
      activeTopics: this.topics.size,
      summarizedTurns: this.summarizedTurnCount,
      sessionDuration: Date.now() - this.sessionStartTime,
    };
  }

  /**
   * Shutdown
   */
  shutdown(): void {
    this.removeAllListeners();
    logger.info('ContextBuilder shutdown');
  }

  // Type-safe event emitter methods
  on<K extends keyof ContextBuilderEvents>(event: K, listener: ContextBuilderEvents[K]): this {
    return super.on(event, listener);
  }

  off<K extends keyof ContextBuilderEvents>(event: K, listener: ContextBuilderEvents[K]): this {
    return super.off(event, listener);
  }

  emit<K extends keyof ContextBuilderEvents>(
    event: K,
    ...args: Parameters<ContextBuilderEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }
}

// Singleton instance
let builderInstance: ContextBuilder | null = null;

/**
 * Get or create the context builder instance
 */
export function getContextBuilder(config?: Partial<ContextBuilderConfig>): ContextBuilder {
  if (!builderInstance) {
    builderInstance = new ContextBuilder(config);
  }
  return builderInstance;
}

/**
 * Shutdown the context builder
 */
export function shutdownContextBuilder(): void {
  if (builderInstance) {
    builderInstance.shutdown();
    builderInstance = null;
  }
}

export default ContextBuilder;
