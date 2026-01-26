/**
 * Atlas Desktop - Conversation Memory
 * High-level conversation context management with topic extraction
 * and intelligent context assembly for LLM prompts
 */

import { EventEmitter } from 'events';
import { format } from 'date-fns';
import { createModuleLogger } from '../utils/logger';
import { getMemoryManager, MemoryManager } from './index';
import { ChatMessage } from '../../shared/types/llm';
import { createNote } from './note-writer';
import { addConversationToJournal } from './daily-journal';
import { indexNote } from './lance-sync';

const logger = createModuleLogger('ConversationMemory');

/**
 * A single conversation turn (user message + nova response)
 */
export interface ConversationTurn {
  id: string;
  timestamp: number;
  userMessage: string;
  novaResponse: string;
  topics: string[];
  sentiment?: 'positive' | 'negative' | 'neutral';
  importance: number;
}

/**
 * Topic tracking for conversation context
 */
export interface TopicInfo {
  name: string;
  mentions: number;
  lastMentioned: number;
  importance: number;
}

/**
 * Conversation summary
 */
export interface ConversationSummary {
  mainTopics: string[];
  turnCount: number;
  duration: number;
  sentiment: 'positive' | 'negative' | 'neutral' | 'mixed';
  keyPoints: string[];
}

/**
 * Context assembly options
 */
export interface ContextOptions {
  /** Maximum turns to include */
  maxTurns?: number;
  /** Include topic summary */
  includeTopics?: boolean;
  /** Include user preferences */
  includePreferences?: boolean;
  /** Include relevant memories */
  includeMemories?: boolean;
  /** Maximum context length in characters */
  maxLength?: number;
}

/**
 * Conversation Memory Events
 */
export interface ConversationMemoryEvents {
  'turn-added': (turn: ConversationTurn) => void;
  'topic-detected': (topic: string) => void;
  'context-updated': () => void;
  error: (error: Error) => void;
}

/**
 * Known topic keywords for extraction
 */
const TOPIC_KEYWORDS: Record<string, string[]> = {
  weather: ['weather', 'temperature', 'rain', 'sunny', 'cloudy', 'forecast', 'storm'],
  music: ['music', 'song', 'playlist', 'artist', 'album', 'play', 'listen'],
  coding: ['code', 'coding', 'programming', 'bug', 'error', 'function', 'variable', 'debug'],
  help: ['help', 'assist', 'support', 'how to', 'can you', 'please'],
  time: ['time', 'clock', 'schedule', 'calendar', 'appointment', 'meeting', 'reminder'],
  email: ['email', 'mail', 'inbox', 'message', 'send', 'reply'],
  search: ['search', 'find', 'look up', 'google', 'browse', 'website'],
  files: ['file', 'folder', 'document', 'save', 'open', 'download', 'upload'],
  settings: ['settings', 'configure', 'setup', 'preference', 'option'],
  system: ['system', 'computer', 'restart', 'shutdown', 'update', 'install'],
  personal: ['my name', 'i am', "i'm", 'i like', 'i prefer', 'favorite'],
  work: ['work', 'job', 'project', 'task', 'deadline', 'meeting'],
  entertainment: ['movie', 'show', 'video', 'game', 'watch', 'stream'],
  health: ['health', 'exercise', 'sleep', 'diet', 'fitness', 'medical'],
  learning: ['learn', 'study', 'tutorial', 'course', 'explain', 'understand'],
};

/**
 * Default context options
 */
const DEFAULT_CONTEXT_OPTIONS: Required<ContextOptions> = {
  maxTurns: 5,
  includeTopics: true,
  includePreferences: true,
  includeMemories: true,
  maxLength: 4000,
};

/**
 * ConversationMemory class
 * Provides high-level conversation context management
 */
export class ConversationMemory extends EventEmitter {
  private turns: ConversationTurn[] = [];
  private topics: Map<string, TopicInfo> = new Map();
  private memoryManager: MemoryManager | null = null;
  private readonly MAX_TURNS = 50;
  private sessionStartTime: number = Date.now();

  constructor() {
    super();
    logger.info('ConversationMemory initialized');
  }

  /**
   * Initialize with memory manager
   */
  async initialize(): Promise<void> {
    try {
      this.memoryManager = await getMemoryManager();
      logger.info('ConversationMemory connected to MemoryManager');
    } catch (error) {
      logger.error('Failed to connect to MemoryManager', { error: (error as Error).message });
    }
  }

  /**
   * Add a conversation turn
   */
  addTurn(userMessage: string, novaResponse: string): ConversationTurn {
    const topics = this.extractTopics(userMessage + ' ' + novaResponse);
    const sentiment = this.analyzeSentiment(userMessage);
    const importance = this.calculateImportance(userMessage, novaResponse, topics);

    const turn: ConversationTurn = {
      id: this.generateId(),
      timestamp: Date.now(),
      userMessage,
      novaResponse,
      topics,
      sentiment,
      importance,
    };

    this.turns.push(turn);

    // Update topic tracking
    for (const topic of topics) {
      this.updateTopic(topic);
    }

    // Trim old turns if needed
    if (this.turns.length > this.MAX_TURNS) {
      this.turns.shift();
    }

    // Store in memory manager
    if (this.memoryManager) {
      this.memoryManager.addMessage({ role: 'user', content: userMessage });
      this.memoryManager.addMessage({ role: 'assistant', content: novaResponse });
    }

    // Extract and store preferences/facts
    this.extractAndStoreUserInfo(userMessage);

    this.emit('turn-added', turn);
    this.emit('context-updated');

    logger.debug('Turn added', {
      turnId: turn.id,
      topics,
      importance,
      totalTurns: this.turns.length,
    });

    return turn;
  }

  /**
   * Get conversation context for LLM prompt
   */
  getContext(options?: ContextOptions): string {
    const opts = { ...DEFAULT_CONTEXT_OPTIONS, ...options };
    const parts: string[] = [];

    // Add topic summary if enabled
    if (opts.includeTopics && this.topics.size > 0) {
      const topicSummary = this.getTopicSummary();
      if (topicSummary) {
        parts.push(`[Current Topics: ${topicSummary}]`);
      }
    }

    // Add user preferences if enabled
    if (opts.includePreferences && this.memoryManager) {
      const preferences = this.getUserPreferences();
      if (preferences.length > 0) {
        parts.push(`[User Preferences: ${preferences.join(', ')}]`);
      }
    }

    // Add relevant memories if enabled
    if (opts.includeMemories && this.memoryManager) {
      const relevantMemories = this.getRelevantMemories();
      if (relevantMemories.length > 0) {
        parts.push(`[Relevant Context: ${relevantMemories.join('; ')}]`);
      }
    }

    // Add recent conversation turns
    const recentTurns = this.turns.slice(-opts.maxTurns);
    const conversationContext = recentTurns
      .map((t) => `User: ${t.userMessage}\nNova: ${t.novaResponse}`)
      .join('\n\n');

    if (conversationContext) {
      parts.push(conversationContext);
    }

    // Combine and truncate if needed
    let context = parts.join('\n\n');
    if (context.length > opts.maxLength) {
      context = context.slice(-opts.maxLength);
      // Try to start at a reasonable boundary
      const newlineIndex = context.indexOf('\n');
      if (newlineIndex > 0 && newlineIndex < 200) {
        context = context.slice(newlineIndex + 1);
      }
    }

    return context;
  }

  /**
   * Get recent turns as ChatMessage array
   */
  getRecentMessages(limit: number = 10): ChatMessage[] {
    const messages: ChatMessage[] = [];
    const recentTurns = this.turns.slice(-limit);

    for (const turn of recentTurns) {
      messages.push({ role: 'user', content: turn.userMessage });
      messages.push({ role: 'assistant', content: turn.novaResponse });
    }

    return messages;
  }

  /**
   * Get conversation summary
   */
  getSummary(): ConversationSummary {
    const sentiments = this.turns.map((t) => t.sentiment).filter((s) => s !== undefined);
    const positiveCount = sentiments.filter((s) => s === 'positive').length;
    const negativeCount = sentiments.filter((s) => s === 'negative').length;

    let overallSentiment: ConversationSummary['sentiment'];
    if (positiveCount > negativeCount * 2) {
      overallSentiment = 'positive';
    } else if (negativeCount > positiveCount * 2) {
      overallSentiment = 'negative';
    } else if (positiveCount > 0 && negativeCount > 0) {
      overallSentiment = 'mixed';
    } else {
      overallSentiment = 'neutral';
    }

    // Get main topics
    const sortedTopics = Array.from(this.topics.entries())
      .sort((a, b) => b[1].importance - a[1].importance)
      .slice(0, 5)
      .map(([name]) => name);

    // Extract key points from high-importance turns
    const keyPoints = this.turns
      .filter((t) => t.importance > 0.7)
      .slice(-5)
      .map((t) => t.userMessage.slice(0, 100));

    return {
      mainTopics: sortedTopics,
      turnCount: this.turns.length,
      duration: Date.now() - this.sessionStartTime,
      sentiment: overallSentiment,
      keyPoints,
    };
  }

  /**
   * Extract topics from text
   */
  private extractTopics(text: string): string[] {
    const lowerText = text.toLowerCase();
    const foundTopics: string[] = [];

    for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS)) {
      if (keywords.some((keyword) => lowerText.includes(keyword))) {
        foundTopics.push(topic);
      }
    }

    return foundTopics;
  }

  /**
   * Update topic tracking
   */
  private updateTopic(topicName: string): void {
    const existing = this.topics.get(topicName);
    const now = Date.now();

    if (existing) {
      existing.mentions++;
      existing.lastMentioned = now;
      existing.importance = Math.min(1, existing.importance + 0.1);
    } else {
      this.topics.set(topicName, {
        name: topicName,
        mentions: 1,
        lastMentioned: now,
        importance: 0.5,
      });
      this.emit('topic-detected', topicName);
    }
  }

  /**
   * Get topic summary string
   */
  private getTopicSummary(): string {
    const recentTopics = Array.from(this.topics.values())
      .filter((t) => Date.now() - t.lastMentioned < 5 * 60 * 1000) // Last 5 minutes
      .sort((a, b) => b.importance - a.importance)
      .slice(0, 3)
      .map((t) => t.name);

    return recentTopics.join(', ');
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
      'love',
      'good',
      'nice',
      'excellent',
      'wonderful',
      'amazing',
      'helpful',
      'perfect',
      'happy',
      'glad',
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
   * Calculate importance score for a turn
   */
  private calculateImportance(userMessage: string, novaResponse: string, topics: string[]): number {
    let score = 0.5;
    const text = (userMessage + ' ' + novaResponse).toLowerCase();

    // Higher importance for preference expressions
    if (
      text.includes('i like') ||
      text.includes('i prefer') ||
      text.includes('i want') ||
      text.includes('my favorite')
    ) {
      score += 0.2;
    }

    // Higher importance for questions/requests
    if (text.includes('?') || text.includes('please') || text.includes('can you')) {
      score += 0.1;
    }

    // Higher importance if contains personal information
    if (text.includes('my name') || text.includes("i'm ") || text.includes('i am ')) {
      score += 0.2;
    }

    // Higher importance for "remember" requests
    if (text.includes('remember')) {
      score += 0.3;
    }

    // Higher importance for multiple topics
    if (topics.length > 1) {
      score += 0.1;
    }

    return Math.min(1, score);
  }

  /**
   * Extract and store user information (preferences, facts)
   */
  private extractAndStoreUserInfo(text: string): void {
    if (!this.memoryManager) return;

    const lowerText = text.toLowerCase();

    // Extract preferences: "I like X", "I prefer X"
    const likePatterns = [
      /i (?:really )?(?:like|love|enjoy) (\w+(?:\s+\w+)?)/gi,
      /i prefer (\w+(?:\s+\w+)?)/gi,
      /my favorite (?:\w+ )?is (\w+(?:\s+\w+)?)/gi,
    ];

    for (const pattern of likePatterns) {
      let match;
      while ((match = pattern.exec(lowerText)) !== null) {
        this.memoryManager.addEntry('preference', `User likes: ${match[1]}`, {
          importance: 0.8,
          tags: ['preference', 'likes'],
        });
      }
    }

    // Extract dislikes
    const dislikePatterns = [/i (?:don't like|hate|dislike) (\w+(?:\s+\w+)?)/gi];

    for (const pattern of dislikePatterns) {
      let match;
      while ((match = pattern.exec(lowerText)) !== null) {
        this.memoryManager.addEntry('preference', `User dislikes: ${match[1]}`, {
          importance: 0.8,
          tags: ['preference', 'dislikes'],
        });
      }
    }

    // Extract facts: "My name is X", "I am X"
    const nameMatch = lowerText.match(/my name is (\w+)/i);
    if (nameMatch) {
      this.memoryManager.addEntry('fact', `User's name is ${nameMatch[1]}`, {
        importance: 1.0,
        tags: ['fact', 'name', 'personal'],
      });
    }
  }

  /**
   * Get user preferences from memory
   */
  private getUserPreferences(): string[] {
    if (!this.memoryManager) return [];

    const entries = this.memoryManager.searchEntries({
      type: 'preference',
      limit: 5,
    });

    return entries.map((e) => e.content);
  }

  /**
   * Get relevant memories based on current topics
   */
  private getRelevantMemories(): string[] {
    if (!this.memoryManager) return [];

    const currentTopics = Array.from(this.topics.keys());
    if (currentTopics.length === 0) return [];

    const entries = this.memoryManager.searchEntries({
      tags: currentTopics,
      limit: 3,
    });

    return entries.map((e) => e.content);
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `turn-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Clear conversation history
   */
  clear(): void {
    this.turns = [];
    this.topics.clear();
    this.sessionStartTime = Date.now();
    this.emit('context-updated');
    logger.info('Conversation memory cleared');
  }

  /**
   * Mark the current conversation as "do not remember"
   * Clears turns without storing to vault and removes from memory manager
   */
  async forgetConversation(): Promise<void> {
    logger.info('Forgetting current conversation', { turnCount: this.turns.length });

    // Clear the current session from memory manager without storing
    if (this.memoryManager) {
      const currentSession = this.memoryManager.getCurrentSession();
      if (currentSession) {
        // Remove all messages from the current session
        currentSession.messages = [];
        logger.debug('Cleared messages from memory manager session');
      }
    }

    // Clear local turns without storing to vault
    this.turns = [];
    this.topics.clear();
    this.sessionStartTime = Date.now();

    this.emit('context-updated');
    logger.info('Conversation forgotten - not stored to vault');
  }

  /**
   * Forget the last N turns from the conversation
   * @param count Number of turns to forget (default: 1)
   */
  forgetLastTurns(count: number = 1): number {
    const toRemove = Math.min(count, this.turns.length);

    if (toRemove === 0) {
      logger.debug('No turns to forget');
      return 0;
    }

    // Remove turns from the end
    this.turns.splice(-toRemove, toRemove);

    // Update topics based on remaining turns
    this.recalculateTopics();

    // Remove corresponding messages from memory manager
    if (this.memoryManager) {
      const currentSession = this.memoryManager.getCurrentSession();
      if (currentSession) {
        // Each turn has 2 messages (user + assistant)
        const messagesToRemove = toRemove * 2;
        currentSession.messages = currentSession.messages.slice(0, -messagesToRemove);
      }
    }

    this.emit('context-updated');
    logger.info('Forgot last turns', {
      removed: toRemove,
      remaining: this.turns.length,
    });

    return toRemove;
  }

  /**
   * Forget a specific turn by ID
   */
  forgetTurn(turnId: string): boolean {
    const index = this.turns.findIndex((t) => t.id === turnId);
    if (index === -1) {
      logger.warn('Turn not found for forgetting', { turnId });
      return false;
    }

    this.turns.splice(index, 1);
    this.recalculateTopics();

    this.emit('context-updated');
    logger.info('Forgot specific turn', { turnId });

    return true;
  }

  /**
   * Recalculate topics based on remaining turns
   */
  private recalculateTopics(): void {
    this.topics.clear();

    for (const turn of this.turns) {
      for (const topic of turn.topics) {
        this.updateTopic(topic);
      }
    }
  }

  /**
   * Store the current conversation session to Obsidian vault
   * Creates a note in conversations/ and adds entry to daily journal
   */
  async storeToVault(): Promise<string | null> {
    if (this.turns.length === 0) {
      logger.debug('No turns to store to vault');
      return null;
    }

    try {
      const summary = this.getSummary();
      const timestamp = format(new Date(), 'yyyy-MM-dd-HHmmss');
      const filename = `conversation-${timestamp}`;

      // Build conversation transcript
      const transcript = this.turns
        .map((turn) => `**User:** ${turn.userMessage}\n\n**Atlas:** ${turn.novaResponse}`)
        .join('\n\n---\n\n');

      // Build topics section
      const topicsSection =
        summary.mainTopics.length > 0
          ? `## Topics\n\n${summary.mainTopics.map((t) => `- [[${t}]]`).join('\n')}`
          : '';

      // Build key points section
      const keyPointsSection =
        summary.keyPoints.length > 0
          ? `## Key Points\n\n${summary.keyPoints.map((p) => `- ${p}`).join('\n')}`
          : '';

      // Generate a one-line summary for the journal
      const journalSummary = this.generateJournalSummary(summary);

      // Build note content
      const content = `## Summary

${journalSummary}

${topicsSection}

${keyPointsSection}

## Transcript

${transcript}

---

*Duration: ${Math.round(summary.duration / 60000)} minutes | Turns: ${summary.turnCount} | Sentiment: ${summary.sentiment}*

#conversation #${format(new Date(), 'yyyy-MM-dd')}
`;

      // Create the note in conversations/ directory
      const notePath = await createNote('conversations', filename, content, {
        type: 'conversation',
        date: format(new Date(), 'yyyy-MM-dd'),
        time: format(new Date(), 'HH:mm'),
        turns: summary.turnCount,
        topics: summary.mainTopics,
        sentiment: summary.sentiment,
        duration: summary.duration,
      });

      logger.info('Conversation stored to vault', {
        path: notePath,
        turns: summary.turnCount,
        topics: summary.mainTopics,
      });

      // Add to daily journal
      try {
        await addConversationToJournal(journalSummary, filename);
        logger.debug('Added conversation to daily journal');
      } catch (err) {
        logger.warn('Failed to add conversation to journal', {
          error: (err as Error).message,
        });
      }

      // Index in LanceDB for semantic search
      try {
        await indexNote(notePath);
        logger.debug('Indexed conversation in LanceDB');
      } catch (err) {
        logger.warn('Failed to index conversation', {
          error: (err as Error).message,
        });
      }

      return notePath;
    } catch (error) {
      logger.error('Failed to store conversation to vault', {
        error: (error as Error).message,
      });
      return null;
    }
  }

  /**
   * Generate a brief summary for the daily journal entry
   */
  private generateJournalSummary(summary: ConversationSummary): string {
    const parts: string[] = [];

    if (summary.mainTopics.length > 0) {
      parts.push(`Discussed ${summary.mainTopics.slice(0, 3).join(', ')}`);
    } else {
      parts.push('General conversation');
    }

    if (summary.keyPoints.length > 0) {
      parts.push(
        `- ${summary.keyPoints[0].slice(0, 50)}${summary.keyPoints[0].length > 50 ? '...' : ''}`
      );
    }

    return parts.join('. ');
  }

  /**
   * Get total turns count
   */
  get turnCount(): number {
    return this.turns.length;
  }

  /**
   * Get all tracked topics
   */
  get currentTopics(): TopicInfo[] {
    return Array.from(this.topics.values());
  }
}

// Singleton instance
let conversationMemory: ConversationMemory | null = null;

/**
 * Get or create the conversation memory instance
 */
export async function getConversationMemory(): Promise<ConversationMemory> {
  if (!conversationMemory) {
    conversationMemory = new ConversationMemory();
    await conversationMemory.initialize();
  }
  return conversationMemory;
}

/**
 * Shutdown conversation memory
 */
export function shutdownConversationMemory(): void {
  if (conversationMemory) {
    conversationMemory.clear();
    conversationMemory.removeAllListeners();
    conversationMemory = null;
  }
}

export default ConversationMemory;
