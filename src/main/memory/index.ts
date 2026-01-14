/**
 * Nova Desktop - Memory System
 * Persistent conversation memory and context management
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { createModuleLogger } from '../utils/logger';
import { ChatMessage } from '../../shared/types/llm';

const logger = createModuleLogger('Memory');

/**
 * Memory entry types
 */
export type MemoryType = 'conversation' | 'fact' | 'preference' | 'context';

/**
 * Memory entry
 */
export interface MemoryEntry {
  /** Unique identifier */
  id: string;
  /** Entry type */
  type: MemoryType;
  /** Content/value */
  content: string;
  /** Associated metadata */
  metadata?: Record<string, unknown>;
  /** Creation timestamp */
  createdAt: number;
  /** Last accessed timestamp */
  accessedAt: number;
  /** Importance score (0-1) */
  importance: number;
  /** Tags for categorization */
  tags?: string[];
}

/**
 * Conversation session
 */
export interface ConversationSession {
  /** Session ID */
  id: string;
  /** Session start time */
  startedAt: number;
  /** Last activity time */
  lastActivityAt: number;
  /** Messages in this session */
  messages: ChatMessage[];
  /** Summary of conversation (if generated) */
  summary?: string;
  /** Session metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Memory configuration
 */
export interface MemoryConfig {
  /** Storage directory */
  storageDir: string;
  /** Maximum conversations to keep */
  maxConversations: number;
  /** Maximum messages per conversation */
  maxMessagesPerConversation: number;
  /** Auto-save interval in ms */
  autoSaveInterval: number;
  /** Enable persistence */
  enablePersistence: boolean;
}

/**
 * Default memory configuration
 */
const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  storageDir: path.join(process.env.HOME || process.env.USERPROFILE || '.', '.nova', 'memory'),
  maxConversations: 100,
  maxMessagesPerConversation: 50,
  autoSaveInterval: 30000, // 30 seconds
  enablePersistence: true,
};

/**
 * Memory events
 */
export interface MemoryEvents {
  /** Memory entry added */
  'entry-added': (entry: MemoryEntry) => void;
  /** Memory entry removed */
  'entry-removed': (id: string) => void;
  /** Conversation saved */
  'conversation-saved': (sessionId: string) => void;
  /** Memory loaded from disk */
  loaded: () => void;
  /** Memory saved to disk */
  saved: () => void;
  /** Error occurred */
  error: (error: Error) => void;
}

/**
 * Memory Manager
 * Handles persistent storage of conversations and learned information
 */
export class MemoryManager extends EventEmitter {
  private config: MemoryConfig;
  private entries: Map<string, MemoryEntry> = new Map();
  private conversations: Map<string, ConversationSession> = new Map();
  private currentSessionId: string | null = null;
  private autoSaveTimer: NodeJS.Timeout | null = null;
  private isDirty = false;

  constructor(config?: Partial<MemoryConfig>) {
    super();
    this.config = { ...DEFAULT_MEMORY_CONFIG, ...config };

    logger.info('MemoryManager initialized', {
      storageDir: this.config.storageDir,
      enablePersistence: this.config.enablePersistence,
    });
  }

  /**
   * Initialize and load existing memory
   */
  async initialize(): Promise<void> {
    if (this.config.enablePersistence) {
      // Ensure storage directory exists
      await this.ensureStorageDir();

      // Load existing data
      await this.load();

      // Start auto-save timer
      this.startAutoSave();
    }
  }

  /**
   * Ensure storage directory exists
   */
  private async ensureStorageDir(): Promise<void> {
    try {
      await fs.promises.mkdir(this.config.storageDir, { recursive: true });
    } catch (error) {
      logger.error('Failed to create storage directory', { error: (error as Error).message });
      throw error;
    }
  }

  /**
   * Start auto-save timer
   */
  private startAutoSave(): void {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
    }
    this.autoSaveTimer = setInterval(() => {
      if (this.isDirty) {
        this.save().catch((e) => logger.error('Auto-save failed', { error: (e as Error).message }));
      }
    }, this.config.autoSaveInterval);
  }

  /**
   * Stop auto-save timer
   */
  private stopAutoSave(): void {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Start a new conversation session
   */
  startSession(metadata?: Record<string, unknown>): string {
    const sessionId = this.generateId();
    const session: ConversationSession = {
      id: sessionId,
      startedAt: Date.now(),
      lastActivityAt: Date.now(),
      messages: [],
      metadata,
    };

    this.conversations.set(sessionId, session);
    this.currentSessionId = sessionId;
    this.isDirty = true;

    logger.info('New conversation session started', { sessionId });
    return sessionId;
  }

  /**
   * Get current session ID
   */
  getCurrentSessionId(): string | null {
    return this.currentSessionId;
  }

  /**
   * Get a conversation session
   */
  getSession(sessionId: string): ConversationSession | undefined {
    return this.conversations.get(sessionId);
  }

  /**
   * Get current session
   */
  getCurrentSession(): ConversationSession | undefined {
    if (!this.currentSessionId) return undefined;
    return this.conversations.get(this.currentSessionId);
  }

  /**
   * Add a message to the current session
   */
  addMessage(message: ChatMessage): void {
    const session = this.getCurrentSession();
    if (!session) {
      // Auto-create session if none exists
      this.startSession();
      this.addMessage(message);
      return;
    }

    session.messages.push(message);
    session.lastActivityAt = Date.now();

    // Trim if exceeds max messages
    if (session.messages.length > this.config.maxMessagesPerConversation) {
      session.messages = session.messages.slice(-this.config.maxMessagesPerConversation);
    }

    this.isDirty = true;
    logger.debug('Message added to session', {
      sessionId: session.id,
      role: message.role,
      messageCount: session.messages.length,
    });
  }

  /**
   * Get recent messages from current session
   */
  getRecentMessages(limit?: number): ChatMessage[] {
    const session = this.getCurrentSession();
    if (!session) return [];

    const count = limit || this.config.maxMessagesPerConversation;
    return session.messages.slice(-count);
  }

  /**
   * Add a memory entry
   */
  addEntry(
    type: MemoryType,
    content: string,
    options?: {
      importance?: number;
      tags?: string[];
      metadata?: Record<string, unknown>;
    }
  ): MemoryEntry {
    const entry: MemoryEntry = {
      id: this.generateId(),
      type,
      content,
      createdAt: Date.now(),
      accessedAt: Date.now(),
      importance: options?.importance ?? 0.5,
      tags: options?.tags,
      metadata: options?.metadata,
    };

    this.entries.set(entry.id, entry);
    this.isDirty = true;

    this.emit('entry-added', entry);
    logger.debug('Memory entry added', { id: entry.id, type });

    return entry;
  }

  /**
   * Get a memory entry
   */
  getEntry(id: string): MemoryEntry | undefined {
    const entry = this.entries.get(id);
    if (entry) {
      entry.accessedAt = Date.now();
    }
    return entry;
  }

  /**
   * Remove a memory entry
   */
  removeEntry(id: string): boolean {
    const removed = this.entries.delete(id);
    if (removed) {
      this.isDirty = true;
      this.emit('entry-removed', id);
    }
    return removed;
  }

  /**
   * Search memory entries
   */
  searchEntries(query: {
    type?: MemoryType;
    tags?: string[];
    minImportance?: number;
    text?: string;
    limit?: number;
  }): MemoryEntry[] {
    let results = Array.from(this.entries.values());

    if (query.type) {
      results = results.filter((e) => e.type === query.type);
    }

    if (query.tags && query.tags.length > 0) {
      results = results.filter((e) => query.tags!.some((tag) => e.tags?.includes(tag)));
    }

    if (query.minImportance !== undefined) {
      results = results.filter((e) => e.importance >= query.minImportance!);
    }

    if (query.text) {
      const searchText = query.text.toLowerCase();
      results = results.filter((e) => e.content.toLowerCase().includes(searchText));
    }

    // Sort by importance and recency
    results.sort((a, b) => {
      const importanceDiff = b.importance - a.importance;
      if (importanceDiff !== 0) return importanceDiff;
      return b.accessedAt - a.accessedAt;
    });

    if (query.limit) {
      results = results.slice(0, query.limit);
    }

    return results;
  }

  /**
   * Get all conversation sessions
   */
  getAllSessions(): ConversationSession[] {
    return Array.from(this.conversations.values()).sort(
      (a, b) => b.lastActivityAt - a.lastActivityAt
    );
  }

  /**
   * Save memory to disk
   */
  async save(): Promise<void> {
    if (!this.config.enablePersistence) return;

    try {
      const data = {
        entries: Array.from(this.entries.entries()),
        conversations: Array.from(this.conversations.entries()),
        currentSessionId: this.currentSessionId,
        savedAt: Date.now(),
      };

      const filePath = path.join(this.config.storageDir, 'memory.json');
      await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2));

      this.isDirty = false;
      this.emit('saved');
      logger.info('Memory saved to disk', {
        entries: this.entries.size,
        conversations: this.conversations.size,
      });
    } catch (error) {
      logger.error('Failed to save memory', { error: (error as Error).message });
      this.emit('error', error as Error);
      throw error;
    }
  }

  /**
   * Load memory from disk
   */
  async load(): Promise<void> {
    if (!this.config.enablePersistence) return;

    const filePath = path.join(this.config.storageDir, 'memory.json');

    try {
      const exists = await fs.promises
        .access(filePath)
        .then(() => true)
        .catch(() => false);

      if (!exists) {
        logger.info('No existing memory file found');
        return;
      }

      const content = await fs.promises.readFile(filePath, 'utf-8');
      const data = JSON.parse(content) as {
        entries: Array<[string, MemoryEntry]>;
        conversations: Array<[string, ConversationSession]>;
        currentSessionId: string | null;
      };

      this.entries = new Map(data.entries);
      this.conversations = new Map(data.conversations);

      // Clean up old conversations if needed
      this.pruneOldConversations();

      this.emit('loaded');
      logger.info('Memory loaded from disk', {
        entries: this.entries.size,
        conversations: this.conversations.size,
      });
    } catch (error) {
      logger.error('Failed to load memory', { error: (error as Error).message });
      this.emit('error', error as Error);
    }
  }

  /**
   * Remove old conversations to stay within limit
   */
  private pruneOldConversations(): void {
    const sessions = this.getAllSessions();
    if (sessions.length <= this.config.maxConversations) return;

    const toRemove = sessions.slice(this.config.maxConversations);
    for (const session of toRemove) {
      this.conversations.delete(session.id);
    }

    this.isDirty = true;
    logger.info('Pruned old conversations', { removed: toRemove.length });
  }

  /**
   * Clear all memory
   */
  async clear(): Promise<void> {
    this.entries.clear();
    this.conversations.clear();
    this.currentSessionId = null;
    this.isDirty = true;
    await this.save();
    logger.info('Memory cleared');
  }

  /**
   * Shutdown memory manager
   */
  async shutdown(): Promise<void> {
    this.stopAutoSave();
    if (this.isDirty) {
      await this.save();
    }
    this.removeAllListeners();
    logger.info('MemoryManager shutdown');
  }

  /**
   * Get memory statistics
   */
  getStats(): {
    totalEntries: number;
    totalConversations: number;
    currentSessionMessages: number;
  } {
    return {
      totalEntries: this.entries.size,
      totalConversations: this.conversations.size,
      currentSessionMessages: this.getCurrentSession()?.messages.length ?? 0,
    };
  }

  // Type-safe event emitter methods
  on<K extends keyof MemoryEvents>(event: K, listener: MemoryEvents[K]): this {
    return super.on(event, listener);
  }

  off<K extends keyof MemoryEvents>(event: K, listener: MemoryEvents[K]): this {
    return super.off(event, listener);
  }

  emit<K extends keyof MemoryEvents>(event: K, ...args: Parameters<MemoryEvents[K]>): boolean {
    return super.emit(event, ...args);
  }
}

// Singleton instance
let memoryManager: MemoryManager | null = null;

/**
 * Get or create the memory manager instance
 */
export async function getMemoryManager(config?: Partial<MemoryConfig>): Promise<MemoryManager> {
  if (!memoryManager) {
    memoryManager = new MemoryManager(config);
    await memoryManager.initialize();
  }
  return memoryManager;
}

/**
 * Shutdown the memory manager
 */
export async function shutdownMemoryManager(): Promise<void> {
  if (memoryManager) {
    await memoryManager.shutdown();
    memoryManager = null;
  }
}

export default MemoryManager;
