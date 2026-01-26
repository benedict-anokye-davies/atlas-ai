/**
 * Atlas Desktop - Context Window Manager
 *
 * Smart context management for LLM conversations.
 * Tracks token usage, auto-summarizes old messages when approaching context limits,
 * and provides priority-based message retention.
 *
 * @module memory/context-manager
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import {
  ChatMessage,
  ConversationContext,
  estimateTokenCount,
  createConversationContext,
  ATLAS_SYSTEM_PROMPT,
} from '../../shared/types/llm';
import { getLLMManager, LLMManager } from '../llm/manager';

const logger = createModuleLogger('ContextManager');

/**
 * Message with priority and token metadata
 */
export interface PrioritizedMessage extends ChatMessage {
  /** Priority score (0-1, higher = more important) */
  priority: number;
  /** Cached token count */
  tokenCount: number;
  /** Message ID for tracking */
  id: string;
  /** Whether this message is protected from summarization */
  protected: boolean;
}

/**
 * Context statistics
 */
export interface ContextStats {
  /** Total tokens in current context */
  totalTokens: number;
  /** Tokens used by system prompt */
  systemPromptTokens: number;
  /** Tokens used by messages */
  messageTokens: number;
  /** Number of messages in context */
  messageCount: number;
  /** Maximum allowed tokens */
  maxTokens: number;
  /** Percentage of context used */
  usagePercent: number;
  /** Number of summarizations performed */
  summarizationCount: number;
  /** Tokens saved through summarization */
  tokensSaved: number;
}

/**
 * Context manager configuration
 */
export interface ContextManagerConfig {
  /** Maximum tokens for context window (default: 4000) */
  maxTokens: number;
  /** Trigger summarization at this percentage of capacity (default: 0.8 = 80%) */
  summarizationThreshold: number;
  /** Number of recent messages to always preserve (default: 4) */
  protectedMessageCount: number;
  /** Include system prompt in token counting (default: true) */
  includeSystemPrompt: boolean;
  /** Enable automatic summarization (default: true) */
  autoSummarize: boolean;
  /** Target tokens for summarized content (default: 500) */
  summaryTargetTokens: number;
}

/**
 * Default context manager configuration
 */
const DEFAULT_CONFIG: ContextManagerConfig = {
  maxTokens: 4000,
  summarizationThreshold: 0.8,
  protectedMessageCount: 4,
  includeSystemPrompt: true,
  autoSummarize: true,
  summaryTargetTokens: 500,
};

/**
 * Context manager events
 */
export interface ContextManagerEvents {
  /** Emitted when summarization occurs */
  summarized: (summary: string, originalMessageCount: number, tokensSaved: number) => void;
  /** Emitted when context is approaching limit */
  'approaching-limit': (usagePercent: number) => void;
  /** Emitted when a message is added */
  'message-added': (message: PrioritizedMessage) => void;
  /** Emitted when context is cleared */
  cleared: () => void;
  /** Emitted on error */
  error: (error: Error) => void;
}

/**
 * Summarization prompt template
 */
const SUMMARIZATION_PROMPT = `Summarize the following conversation concisely, preserving key information, decisions, and context that would be important for continuing the conversation. Focus on:
1. Main topics discussed
2. Important facts mentioned
3. User preferences or requests
4. Any decisions or conclusions reached

Keep the summary concise but informative. Respond with ONLY the summary, no preamble.

Conversation to summarize:
{conversation}`;

/**
 * ContextManager class
 *
 * Manages conversation context with intelligent summarization and priority-based retention.
 * Ensures the context window stays within token limits while preserving important information.
 */
export class ContextManager extends EventEmitter {
  private config: ContextManagerConfig;
  private messages: PrioritizedMessage[] = [];
  private systemPrompt: string;
  private systemPromptTokens: number = 0;
  private summarizationCount: number = 0;
  private tokensSaved: number = 0;
  private llmManager: LLMManager | null = null;
  private messageIdCounter: number = 0;
  private conversationId: string;

  constructor(config?: Partial<ContextManagerConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.systemPrompt = ATLAS_SYSTEM_PROMPT;
    this.systemPromptTokens = estimateTokenCount(this.systemPrompt);
    this.conversationId = this.generateConversationId();

    logger.info('ContextManager initialized', {
      maxTokens: this.config.maxTokens,
      threshold: this.config.summarizationThreshold,
      protectedCount: this.config.protectedMessageCount,
    });
  }

  /**
   * Initialize with LLM manager for summarization
   */
  async initialize(): Promise<void> {
    try {
      this.llmManager = getLLMManager();
      logger.info('ContextManager connected to LLMManager');
    } catch (error) {
      logger.warn('Failed to connect to LLMManager, summarization will be disabled', {
        error: (error as Error).message,
      });
    }
  }

  /**
   * Set the system prompt
   */
  setSystemPrompt(prompt: string): void {
    this.systemPrompt = prompt;
    this.systemPromptTokens = estimateTokenCount(prompt);
    logger.debug('System prompt updated', { tokens: this.systemPromptTokens });
  }

  /**
   * Get the current system prompt
   */
  getSystemPrompt(): string {
    return this.systemPrompt;
  }

  /**
   * Add a message to the context
   */
  async addMessage(
    message: ChatMessage,
    options?: {
      priority?: number;
      protected?: boolean;
    }
  ): Promise<PrioritizedMessage> {
    const tokenCount = estimateTokenCount(message.content);
    const priority = options?.priority ?? this.calculatePriority(message);

    const prioritizedMessage: PrioritizedMessage = {
      ...message,
      id: this.generateMessageId(),
      priority,
      tokenCount,
      protected: options?.protected ?? false,
      timestamp: message.timestamp ?? Date.now(),
    };

    this.messages.push(prioritizedMessage);
    this.emit('message-added', prioritizedMessage);

    logger.debug('Message added to context', {
      id: prioritizedMessage.id,
      role: message.role,
      tokens: tokenCount,
      priority,
    });

    // Check if we need to summarize
    await this.checkAndSummarize();

    return prioritizedMessage;
  }

  /**
   * Add multiple messages (e.g., restoring from memory)
   */
  async addMessages(
    messages: ChatMessage[],
    options?: {
      priorityFn?: (msg: ChatMessage, index: number) => number;
    }
  ): Promise<PrioritizedMessage[]> {
    const prioritized: PrioritizedMessage[] = [];

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const priority = options?.priorityFn?.(msg, i) ?? this.calculatePriority(msg);
      const tokenCount = estimateTokenCount(msg.content);

      const prioritizedMessage: PrioritizedMessage = {
        ...msg,
        id: this.generateMessageId(),
        priority,
        tokenCount,
        protected: false,
        timestamp: msg.timestamp ?? Date.now(),
      };

      this.messages.push(prioritizedMessage);
      prioritized.push(prioritizedMessage);
    }

    // Check if we need to summarize after adding all messages
    await this.checkAndSummarize();

    logger.debug('Multiple messages added to context', {
      count: messages.length,
      totalTokens: this.calculateMessageTokens(),
    });

    return prioritized;
  }

  /**
   * Get all messages in the context
   */
  getMessages(): PrioritizedMessage[] {
    return [...this.messages];
  }

  /**
   * Get messages as ChatMessage array (for LLM API)
   */
  getMessagesForLLM(): ChatMessage[] {
    return this.messages.map(
      ({ id: _id, priority: _priority, tokenCount: _tokenCount, protected: _protected, ...msg }) =>
        msg
    );
  }

  /**
   * Build a ConversationContext for LLM
   */
  buildContext(): ConversationContext {
    return {
      ...createConversationContext(this.systemPrompt),
      id: this.conversationId,
      messages: this.getMessagesForLLM(),
      totalTokens: this.getTotalTokens(),
    };
  }

  /**
   * Get context statistics
   */
  getStats(): ContextStats {
    const messageTokens = this.calculateMessageTokens();
    const totalTokens = this.getTotalTokens();

    return {
      totalTokens,
      systemPromptTokens: this.systemPromptTokens,
      messageTokens,
      messageCount: this.messages.length,
      maxTokens: this.config.maxTokens,
      usagePercent: (totalTokens / this.config.maxTokens) * 100,
      summarizationCount: this.summarizationCount,
      tokensSaved: this.tokensSaved,
    };
  }

  /**
   * Get total tokens including system prompt
   */
  getTotalTokens(): number {
    const messageTokens = this.calculateMessageTokens();
    return this.config.includeSystemPrompt
      ? this.systemPromptTokens + messageTokens
      : messageTokens;
  }

  /**
   * Check if summarization is needed and perform it
   */
  private async checkAndSummarize(): Promise<void> {
    if (!this.config.autoSummarize) return;

    const stats = this.getStats();
    const threshold = this.config.summarizationThreshold * 100;

    if (stats.usagePercent >= threshold) {
      logger.info('Context approaching limit, triggering summarization', {
        usage: `${stats.usagePercent.toFixed(1)}%`,
        threshold: `${threshold}%`,
      });

      this.emit('approaching-limit', stats.usagePercent);
      await this.summarize();
    }
  }

  /**
   * Perform summarization of old messages
   */
  async summarize(): Promise<string | null> {
    if (!this.llmManager) {
      logger.warn('Cannot summarize: LLM manager not available');
      return null;
    }

    // Identify messages to summarize (not protected, not recent)
    const protectedCount = this.config.protectedMessageCount;
    const protectedIndices = new Set<number>();

    // Protect recent messages
    for (
      let i = Math.max(0, this.messages.length - protectedCount);
      i < this.messages.length;
      i++
    ) {
      protectedIndices.add(i);
    }

    // Protect explicitly protected messages
    this.messages.forEach((msg, idx) => {
      if (msg.protected) {
        protectedIndices.add(idx);
      }
    });

    // Find messages to summarize
    const toSummarize: PrioritizedMessage[] = [];
    const toKeep: PrioritizedMessage[] = [];

    this.messages.forEach((msg, idx) => {
      if (protectedIndices.has(idx)) {
        toKeep.push(msg);
      } else {
        toSummarize.push(msg);
      }
    });

    if (toSummarize.length < 2) {
      logger.debug('Not enough messages to summarize');
      return null;
    }

    // Sort by priority (lower priority first for summarization)
    toSummarize.sort((a, b) => a.priority - b.priority);

    // Take messages until we have enough to make summarization worthwhile
    const messagesToSummarize = toSummarize.slice(0, Math.ceil(toSummarize.length * 0.6));
    const messagesToKeep = toSummarize.slice(Math.ceil(toSummarize.length * 0.6));

    if (messagesToSummarize.length < 2) {
      logger.debug('Not enough low-priority messages to summarize');
      return null;
    }

    // Calculate tokens before summarization
    const tokensBefore = messagesToSummarize.reduce((sum, m) => sum + m.tokenCount, 0);

    // Build conversation text for summarization
    const conversationText = messagesToSummarize.map((m) => `${m.role}: ${m.content}`).join('\n\n');

    const prompt = SUMMARIZATION_PROMPT.replace('{conversation}', conversationText);

    try {
      logger.info('Generating summary', {
        messageCount: messagesToSummarize.length,
        tokenCount: tokensBefore,
      });

      const response = await this.llmManager.chat(prompt);
      const summary = response.content.trim();
      const summaryTokens = estimateTokenCount(summary);

      // Create summary message
      const summaryMessage: PrioritizedMessage = {
        role: 'system',
        content: `[Previous conversation summary]: ${summary}`,
        id: this.generateMessageId(),
        priority: 0.9, // High priority for summaries
        tokenCount: summaryTokens,
        protected: true, // Protect summaries
        timestamp: Date.now(),
      };

      // Rebuild messages array: summary + kept messages + recent protected
      this.messages = [summaryMessage, ...messagesToKeep, ...toKeep];

      // Track statistics
      this.summarizationCount++;
      const savedTokens = tokensBefore - summaryTokens;
      this.tokensSaved += savedTokens;

      this.emit('summarized', summary, messagesToSummarize.length, savedTokens);

      logger.info('Summarization complete', {
        messagesSummarized: messagesToSummarize.length,
        tokensBefore,
        tokensAfter: summaryTokens,
        tokensSaved: savedTokens,
        totalSummarizations: this.summarizationCount,
      });

      return summary;
    } catch (error) {
      const err = error as Error;
      logger.error('Summarization failed', { error: err.message });
      this.emit('error', err);
      return null;
    }
  }

  /**
   * Force summarization regardless of threshold
   */
  async forceSummarize(): Promise<string | null> {
    return this.summarize();
  }

  /**
   * Calculate priority for a message
   */
  private calculatePriority(message: ChatMessage): number {
    let priority = 0.5; // Default priority
    const content = message.content.toLowerCase();

    // System messages are high priority
    if (message.role === 'system') {
      priority = 0.9;
    }

    // User messages slightly higher than assistant
    if (message.role === 'user') {
      priority += 0.1;
    }

    // Boost priority for messages with questions
    if (content.includes('?')) {
      priority += 0.1;
    }

    // Boost for preference expressions
    if (
      content.includes('i like') ||
      content.includes('i prefer') ||
      content.includes('i want') ||
      content.includes('my favorite')
    ) {
      priority += 0.15;
    }

    // Boost for personal information
    if (content.includes('my name') || content.includes("i'm ") || content.includes('i am ')) {
      priority += 0.2;
    }

    // Boost for "remember" requests
    if (content.includes('remember')) {
      priority += 0.25;
    }

    // Boost for tool-related messages
    if (message.tool_calls && message.tool_calls.length > 0) {
      priority += 0.1;
    }

    if (message.tool_call_id) {
      priority += 0.1;
    }

    // Cap at 1.0
    return Math.min(1, priority);
  }

  /**
   * Calculate total tokens used by messages
   */
  private calculateMessageTokens(): number {
    return this.messages.reduce((sum, msg) => sum + msg.tokenCount, 0);
  }

  /**
   * Generate a unique message ID
   */
  private generateMessageId(): string {
    return `msg_${this.conversationId}_${++this.messageIdCounter}`;
  }

  /**
   * Generate a unique conversation ID
   */
  private generateConversationId(): string {
    return `ctx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Clear all messages from context
   */
  clear(): void {
    this.messages = [];
    this.summarizationCount = 0;
    this.tokensSaved = 0;
    this.messageIdCounter = 0;
    this.conversationId = this.generateConversationId();
    this.emit('cleared');
    logger.info('Context cleared');
  }

  /**
   * Protect a specific message from summarization
   */
  protectMessage(messageId: string): boolean {
    const message = this.messages.find((m) => m.id === messageId);
    if (message) {
      message.protected = true;
      logger.debug('Message protected', { id: messageId });
      return true;
    }
    return false;
  }

  /**
   * Unprotect a message
   */
  unprotectMessage(messageId: string): boolean {
    const message = this.messages.find((m) => m.id === messageId);
    if (message) {
      message.protected = false;
      logger.debug('Message unprotected', { id: messageId });
      return true;
    }
    return false;
  }

  /**
   * Update message priority
   */
  updatePriority(messageId: string, priority: number): boolean {
    const message = this.messages.find((m) => m.id === messageId);
    if (message) {
      message.priority = Math.max(0, Math.min(1, priority));
      logger.debug('Message priority updated', { id: messageId, priority: message.priority });
      return true;
    }
    return false;
  }

  /**
   * Get remaining token capacity
   */
  getRemainingCapacity(): number {
    return Math.max(0, this.config.maxTokens - this.getTotalTokens());
  }

  /**
   * Check if there's room for a message of given size
   */
  canFitMessage(tokenCount: number): boolean {
    return this.getRemainingCapacity() >= tokenCount;
  }

  /**
   * Get configuration
   */
  getConfig(): ContextManagerConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<ContextManagerConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('Configuration updated', config);
  }

  // Type-safe event emitter methods
  on<K extends keyof ContextManagerEvents>(event: K, listener: ContextManagerEvents[K]): this {
    return super.on(event, listener);
  }

  off<K extends keyof ContextManagerEvents>(event: K, listener: ContextManagerEvents[K]): this {
    return super.off(event, listener);
  }

  emit<K extends keyof ContextManagerEvents>(
    event: K,
    ...args: Parameters<ContextManagerEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }
}

// Singleton instance
let contextManager: ContextManager | null = null;

/**
 * Get or create the context manager instance
 */
export async function getContextManager(
  config?: Partial<ContextManagerConfig>
): Promise<ContextManager> {
  if (!contextManager) {
    contextManager = new ContextManager(config);
    await contextManager.initialize();
  }
  return contextManager;
}

/**
 * Shutdown the context manager
 */
export function shutdownContextManager(): void {
  if (contextManager) {
    contextManager.clear();
    contextManager.removeAllListeners();
    contextManager = null;
    logger.info('ContextManager shutdown');
  }
}

export default ContextManager;
