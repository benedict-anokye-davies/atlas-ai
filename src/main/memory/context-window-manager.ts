/**
 * Atlas Desktop - Context Window Manager (T-031)
 * Smart context truncation with importance weighting and seamless summarization
 *
 * Features:
 * - Dynamic window sizing based on model limits
 * - Importance-weighted message retention
 * - Automatic summarization triggers
 * - Token counting and budget management
 *
 * @module memory/context-window-manager
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import { ChatMessage } from '../../shared/types/llm';
import { clamp01 } from '../../shared/utils';

const logger = createModuleLogger('ContextWindowManager');

// ============================================================================
// Types
// ============================================================================

export interface TokenBudget {
  total: number;
  system: number;
  history: number;
  response: number;
  tools: number;
}

export interface MessageImportance {
  messageId: string;
  score: number;
  factors: {
    recency: number;
    userMessage: number;
    containsQuestion: number;
    containsName: number;
    containsCode: number;
    topicRelevance: number;
    explicitImportance: number;
  };
}

export interface ContextWindowConfig {
  maxTokens: number;
  systemPromptBudget: number;
  responseBudget: number;
  toolBudget: number;
  summarizationThreshold: number; // Trigger summarization when history exceeds this %
  minMessagesToKeep: number;
  importanceWeights: {
    recency: number;
    userMessage: number;
    containsQuestion: number;
    containsName: number;
    containsCode: number;
    topicRelevance: number;
  };
}

export interface TruncationResult {
  messages: ChatMessage[];
  summary?: string;
  tokenCount: number;
  truncatedCount: number;
  summarizedCount: number;
}

export interface ContextWindowEvents {
  'context-truncated': (result: TruncationResult) => void;
  'summarization-triggered': (messageCount: number) => void;
  'token-budget-exceeded': (used: number, budget: number) => void;
  error: (error: Error) => void;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: ContextWindowConfig = {
  maxTokens: 128000, // DeepSeek V3 context window
  systemPromptBudget: 2000,
  responseBudget: 4000,
  toolBudget: 8000,
  summarizationThreshold: 0.7, // Summarize when 70% of history budget used
  minMessagesToKeep: 4,
  importanceWeights: {
    recency: 0.3,
    userMessage: 0.2,
    containsQuestion: 0.15,
    containsName: 0.1,
    containsCode: 0.15,
    topicRelevance: 0.1,
  },
};

// ============================================================================
// Context Window Manager
// ============================================================================

export class ContextWindowManager extends EventEmitter {
  private config: ContextWindowConfig;
  private currentTopics: Set<string> = new Set();
  private userNames: Set<string> = new Set();
  private messageCache: Map<string, MessageImportance> = new Map();

  constructor(config?: Partial<ContextWindowConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };

    logger.info('ContextWindowManager initialized', {
      maxTokens: this.config.maxTokens,
      historyBudget: this.getHistoryBudget(),
    });
  }

  // ============================================================================
  // Token Counting
  // ============================================================================

  /**
   * Estimate token count for text (rough approximation)
   * ~4 characters per token for English
   */
  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Get token count for a message
   */
  getMessageTokens(message: ChatMessage): number {
    let content = '';
    if (typeof message.content === 'string') {
      content = message.content;
    } else if (Array.isArray(message.content)) {
      content = message.content.map((c) => (typeof c === 'string' ? c : JSON.stringify(c))).join(' ');
    }
    // Add overhead for role and formatting
    return this.estimateTokens(content) + 4;
  }

  /**
   * Get total tokens for message array
   */
  getTotalTokens(messages: ChatMessage[]): number {
    return messages.reduce((sum, msg) => sum + this.getMessageTokens(msg), 0);
  }

  /**
   * Get available budget for conversation history
   */
  getHistoryBudget(): number {
    return (
      this.config.maxTokens -
      this.config.systemPromptBudget -
      this.config.responseBudget -
      this.config.toolBudget
    );
  }

  // ============================================================================
  // Importance Scoring
  // ============================================================================

  /**
   * Calculate importance score for a message
   */
  calculateImportance(message: ChatMessage, index: number, totalMessages: number): MessageImportance {
    const content = typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
    const contentLower = content.toLowerCase();

    const factors = {
      // Recency: newer messages are more important (0-1)
      recency: totalMessages > 1 ? index / (totalMessages - 1) : 1,

      // User messages are more important than assistant messages
      userMessage: message.role === 'user' ? 1 : 0.5,

      // Questions are important
      containsQuestion: /\?|what|how|why|when|where|who|which|can you|could you|would you/i.test(content)
        ? 1
        : 0,

      // Messages mentioning names are important
      containsName: this.containsKnownName(contentLower) ? 1 : 0,

      // Code blocks are often important for context
      containsCode: /```|`[^`]+`|\bfunction\b|\bclass\b|\bconst\b|\blet\b|\bvar\b/i.test(content) ? 1 : 0,

      // Topic relevance to current conversation
      topicRelevance: this.calculateTopicRelevance(contentLower),

      // Explicit importance markers (can be set externally)
      explicitImportance: 0,
    };

    const weights = this.config.importanceWeights;
    const score =
      factors.recency * weights.recency +
      factors.userMessage * weights.userMessage +
      factors.containsQuestion * weights.containsQuestion +
      factors.containsName * weights.containsName +
      factors.containsCode * weights.containsCode +
      factors.topicRelevance * weights.topicRelevance;

    return {
      messageId: `msg-${index}`,
      score: clamp01(score),
      factors,
    };
  }

  private containsKnownName(text: string): boolean {
    for (const name of this.userNames) {
      if (text.includes(name.toLowerCase())) return true;
    }
    return false;
  }

  private calculateTopicRelevance(text: string): number {
    if (this.currentTopics.size === 0) return 0.5;

    let matches = 0;
    for (const topic of this.currentTopics) {
      if (text.includes(topic.toLowerCase())) matches++;
    }
    return Math.min(1, matches / this.currentTopics.size);
  }

  /**
   * Add a topic to track for relevance scoring
   */
  addTopic(topic: string): void {
    this.currentTopics.add(topic.toLowerCase());
    // Limit topics to prevent bloat
    if (this.currentTopics.size > 20) {
      const firstTopic = this.currentTopics.values().next().value;
      this.currentTopics.delete(firstTopic);
    }
  }

  /**
   * Add a known user name for importance scoring
   */
  addUserName(name: string): void {
    this.userNames.add(name.toLowerCase());
  }

  // ============================================================================
  // Context Management
  // ============================================================================

  /**
   * Fit messages within token budget using importance-based truncation
   */
  async fitToContext(
    messages: ChatMessage[],
    options?: {
      tokenBudget?: number;
      preserveSystemMessage?: boolean;
      summarizer?: (messages: ChatMessage[]) => Promise<string>;
    }
  ): Promise<TruncationResult> {
    const budget = options?.tokenBudget || this.getHistoryBudget();
    const currentTokens = this.getTotalTokens(messages);

    // If within budget, return as-is
    if (currentTokens <= budget) {
      return {
        messages,
        tokenCount: currentTokens,
        truncatedCount: 0,
        summarizedCount: 0,
      };
    }

    logger.info('Context exceeds budget, truncating', {
      currentTokens,
      budget,
      messageCount: messages.length,
    });

    // Check if we should summarize
    const shouldSummarize =
      currentTokens > budget * this.config.summarizationThreshold && options?.summarizer;

    if (shouldSummarize && options?.summarizer) {
      return await this.truncateWithSummarization(messages, budget, options.summarizer);
    }

    return this.truncateByImportance(messages, budget, options?.preserveSystemMessage);
  }

  /**
   * Truncate messages by importance score
   */
  private truncateByImportance(
    messages: ChatMessage[],
    budget: number,
    preserveSystem?: boolean
  ): TruncationResult {
    // Score all messages
    const scored = messages.map((msg, i) => ({
      message: msg,
      importance: this.calculateImportance(msg, i, messages.length),
      index: i,
    }));

    // Separate system messages if preserving
    const systemMessages = preserveSystem ? scored.filter((s) => s.message.role === 'system') : [];
    const otherMessages = preserveSystem
      ? scored.filter((s) => s.message.role !== 'system')
      : scored;

    // Sort by importance (keep most important)
    const sortedByImportance = [...otherMessages].sort((a, b) => b.importance.score - a.importance.score);

    // Select messages to keep within budget
    let tokenCount = this.getTotalTokens(systemMessages.map((s) => s.message));
    const keptMessages: typeof scored = [...systemMessages];

    // Always keep at least the most recent messages
    const recentMessages = otherMessages.slice(-this.config.minMessagesToKeep);
    for (const msg of recentMessages) {
      const msgTokens = this.getMessageTokens(msg.message);
      if (tokenCount + msgTokens <= budget) {
        if (!keptMessages.find((k) => k.index === msg.index)) {
          keptMessages.push(msg);
          tokenCount += msgTokens;
        }
      }
    }

    // Fill remaining budget with most important messages
    for (const msg of sortedByImportance) {
      if (keptMessages.find((k) => k.index === msg.index)) continue;

      const msgTokens = this.getMessageTokens(msg.message);
      if (tokenCount + msgTokens <= budget) {
        keptMessages.push(msg);
        tokenCount += msgTokens;
      }
    }

    // Sort back to original order
    keptMessages.sort((a, b) => a.index - b.index);

    const result: TruncationResult = {
      messages: keptMessages.map((k) => k.message),
      tokenCount,
      truncatedCount: messages.length - keptMessages.length,
      summarizedCount: 0,
    };

    this.emit('context-truncated', result);
    logger.info('Context truncated by importance', {
      originalCount: messages.length,
      keptCount: keptMessages.length,
      truncatedCount: result.truncatedCount,
    });

    return result;
  }

  /**
   * Truncate with summarization of older messages
   */
  private async truncateWithSummarization(
    messages: ChatMessage[],
    budget: number,
    summarizer: (messages: ChatMessage[]) => Promise<string>
  ): Promise<TruncationResult> {
    // Split into older messages to summarize and recent to keep
    const splitPoint = Math.floor(messages.length * 0.6);
    const olderMessages = messages.slice(0, splitPoint);
    const recentMessages = messages.slice(splitPoint);

    this.emit('summarization-triggered', olderMessages.length);
    logger.info('Summarizing older messages', { count: olderMessages.length });

    try {
      // Generate summary
      const summary = await summarizer(olderMessages);
      const summaryMessage: ChatMessage = {
        role: 'system',
        content: `[Previous conversation summary]: ${summary}`,
      };

      const summaryTokens = this.getMessageTokens(summaryMessage);
      const recentTokens = this.getTotalTokens(recentMessages);

      // If summary + recent fits, return that
      if (summaryTokens + recentTokens <= budget) {
        return {
          messages: [summaryMessage, ...recentMessages],
          summary,
          tokenCount: summaryTokens + recentTokens,
          truncatedCount: 0,
          summarizedCount: olderMessages.length,
        };
      }

      // Otherwise, truncate recent messages by importance
      const truncatedRecent = this.truncateByImportance(recentMessages, budget - summaryTokens);

      return {
        messages: [summaryMessage, ...truncatedRecent.messages],
        summary,
        tokenCount: summaryTokens + truncatedRecent.tokenCount,
        truncatedCount: truncatedRecent.truncatedCount,
        summarizedCount: olderMessages.length,
      };
    } catch (error) {
      logger.error('Summarization failed, falling back to truncation', { error });
      return this.truncateByImportance(messages, budget);
    }
  }

  // ============================================================================
  // Configuration
  // ============================================================================

  /**
   * Update configuration
   */
  updateConfig(config: Partial<ContextWindowConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('Configuration updated', { newConfig: this.config });
  }

  /**
   * Get current configuration
   */
  getConfig(): ContextWindowConfig {
    return { ...this.config };
  }

  /**
   * Clear topic and name caches
   */
  clearCaches(): void {
    this.currentTopics.clear();
    this.messageCache.clear();
    logger.debug('Caches cleared');
  }
}

// ============================================================================
// Singleton
// ============================================================================

let contextManager: ContextWindowManager | null = null;

export function getContextWindowManager(): ContextWindowManager {
  if (!contextManager) {
    contextManager = new ContextWindowManager();
  }
  return contextManager;
}
