/**
 * Atlas Desktop - Memory System
 *
 * Persistent conversation memory and context management for the AI assistant.
 * Provides storage for conversations, learned facts, user preferences, and
 * contextual information that persists across sessions.
 *
 * Architecture:
 * - In-memory cache for fast access during active sessions
 * - JSON file persistence with auto-save
 * - Automatic eviction of old conversations based on configurable limits
 * - Session-based organization with message history
 *
 * @module memory
 *
 * @example
 * ```typescript
 * const memory = await getMemoryManager();
 *
 * // Start a new conversation session
 * const sessionId = memory.startSession({ context: 'coding' });
 *
 * // Add messages to the session
 * memory.addMessage(sessionId, { role: 'user', content: 'Help me debug' });
 *
 * // Store a learned fact
 * memory.addEntry({
 *   type: 'fact',
 *   content: 'User prefers TypeScript',
 *   importance: 0.8,
 * });
 *
 * // Retrieve relevant memories
 * const memories = await memory.search('TypeScript');
 * ```
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { createModuleLogger } from '../utils/logger';
import { ChatMessage } from '../../shared/types/llm';

const logger = createModuleLogger('Memory');

// =============================================================================
// Constants
// =============================================================================

/**
 * Memory system configuration constants.
 * These limits are designed to balance memory usage with useful history retention.
 */
export const MEMORY_CONSTANTS = {
  /**
   * Maximum conversations to retain in storage.
   * Older conversations are evicted when this limit is exceeded.
   */
  DEFAULT_MAX_CONVERSATIONS: 100,

  /**
   * Maximum messages per conversation session.
   * Prevents unbounded growth of individual conversations.
   */
  DEFAULT_MAX_MESSAGES_PER_CONVERSATION: 50,

  /**
   * Auto-save interval in milliseconds.
   * Balances data safety with disk I/O overhead.
   */
  DEFAULT_AUTO_SAVE_INTERVAL_MS: 30_000,

  /**
   * Minimum auto-save interval (prevents CPU thrashing).
   */
  MIN_AUTO_SAVE_INTERVAL_MS: 5_000,

  /**
   * Maximum importance score for memory entries.
   */
  MAX_IMPORTANCE_SCORE: 1.0,

  /**
   * Minimum importance score for memory entries.
   */
  MIN_IMPORTANCE_SCORE: 0.0,
} as const;

// =============================================================================
// Types
// =============================================================================

/**
 * Memory entry types for categorization.
 *
 * - `conversation`: Chat message history
 * - `fact`: Learned information about the user or world
 * - `preference`: User preferences and settings
 * - `context`: Contextual information for current task
 */
export type MemoryType = 'conversation' | 'fact' | 'preference' | 'context';

/**
 * A single memory entry stored in the system.
 *
 * @example
 * ```typescript
 * const entry: MemoryEntry = {
 *   id: 'mem_123',
 *   type: 'fact',
 *   content: 'User prefers dark theme',
 *   importance: 0.7,
 *   createdAt: Date.now(),
 *   accessedAt: Date.now(),
 *   tags: ['preferences', 'ui'],
 * };
 * ```
 */
export interface MemoryEntry {
  /** Unique identifier (UUID format) */
  id: string;

  /** Entry type for categorization */
  type: MemoryType;

  /** The actual content/value stored */
  content: string;

  /** Associated metadata (flexible key-value pairs) */
  metadata?: Record<string, unknown>;

  /** Creation timestamp (Unix ms) */
  createdAt: number;

  /** Last accessed timestamp (Unix ms) */
  accessedAt: number;

  /**
   * Importance score (0-1).
   * Higher scores indicate more important memories that should be retained longer.
   * Used for eviction decisions and relevance ranking.
   */
  importance: number;

  /** Tags for categorization and search */
  tags?: string[];
}

/**
 * A conversation session containing message history.
 */
export interface ConversationSession {
  /** Session ID (UUID format) */
  id: string;

  /** Session start timestamp (Unix ms) */
  startedAt: number;

  /** Last activity timestamp (Unix ms) */
  lastActivityAt: number;

  /** Messages in this session (ordered by time) */
  messages: ChatMessage[];

  /** AI-generated summary of conversation (if generated) */
  summary?: string;

  /** Session metadata (flexible key-value pairs) */
  metadata?: Record<string, unknown>;
}

/**
 * Memory configuration options.
 */
export interface MemoryConfig {
  /** Storage directory for persistent data */
  storageDir: string;

  /** Maximum conversations to keep (evicts oldest when exceeded) */
  maxConversations: number;

  /** Maximum messages per conversation */
  maxMessagesPerConversation: number;

  /** Auto-save interval in milliseconds */
  autoSaveInterval: number;

  /** Enable persistence to disk */
  enablePersistence: boolean;
}

/**
 * Default memory configuration.
 */
const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  storageDir: path.join(process.env.HOME || process.env.USERPROFILE || '.', '.atlas', 'memory'),
  maxConversations: MEMORY_CONSTANTS.DEFAULT_MAX_CONVERSATIONS,
  maxMessagesPerConversation: MEMORY_CONSTANTS.DEFAULT_MAX_MESSAGES_PER_CONVERSATION,
  autoSaveInterval: MEMORY_CONSTANTS.DEFAULT_AUTO_SAVE_INTERVAL_MS,
  enablePersistence: true,
};

/**
 * Memory events emitted by MemoryManager.
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

// =============================================================================
// MemoryManager Class
// =============================================================================

/**
 * Memory Manager
 *
 * Central service for managing persistent conversation history and learned information.
 * Provides storage, retrieval, and search capabilities for AI assistant memory.
 *
 * Features:
 * - Session-based conversation history
 * - Learned facts and preferences storage
 * - Auto-save with configurable intervals
 * - LRU eviction for old conversations
 * - Tag-based categorization and search
 *
 * @example
 * ```typescript
 * const memory = new MemoryManager({ maxConversations: 50 });
 * await memory.initialize();
 *
 * const sessionId = memory.startSession({ context: 'coding' });
 * memory.addMessage({ role: 'user', content: 'Hello' });
 * memory.addMessage({ role: 'assistant', content: 'Hi there!' });
 *
 * // Graceful shutdown
 * await memory.shutdown();
 * ```
 *
 * @fires entry-added - When a memory entry is added
 * @fires entry-removed - When a memory entry is removed
 * @fires conversation-saved - When a conversation is persisted
 * @fires loaded - When memory is loaded from disk
 * @fires saved - When memory is saved to disk
 * @fires error - When an error occurs
 */
export class MemoryManager extends EventEmitter {
  private config: MemoryConfig;
  private entries: Map<string, MemoryEntry> = new Map();
  private conversations: Map<string, ConversationSession> = new Map();
  private currentSessionId: string | null = null;
  private autoSaveTimer: NodeJS.Timeout | null = null;
  private isDirty = false;
  private isInitialized = false;

  /**
   * Creates a new MemoryManager instance.
   *
   * @param config - Partial configuration (merged with defaults)
   * @throws {Error} If configuration values are invalid
   *
   * @example
   * ```typescript
   * const memory = new MemoryManager({
   *   maxConversations: 50,
   *   autoSaveInterval: 60000, // 1 minute
   * });
   * ```
   */
  constructor(config?: Partial<MemoryConfig>) {
    super();
    this.config = { ...DEFAULT_MEMORY_CONFIG, ...config };

    // Validate configuration
    this.validateConfig();

    logger.info('MemoryManager initialized', {
      storageDir: this.config.storageDir,
      maxConversations: this.config.maxConversations,
      enablePersistence: this.config.enablePersistence,
    });
  }

  /**
   * Validates configuration values to prevent runtime errors.
   * @throws {Error} If any configuration value is invalid
   */
  private validateConfig(): void {
    if (this.config.maxConversations <= 0) {
      throw new Error(`maxConversations must be positive, got: ${this.config.maxConversations}`);
    }
    if (this.config.maxMessagesPerConversation <= 0) {
      throw new Error(
        `maxMessagesPerConversation must be positive, got: ${this.config.maxMessagesPerConversation}`,
      );
    }
    if (this.config.autoSaveInterval < MEMORY_CONSTANTS.MIN_AUTO_SAVE_INTERVAL_MS) {
      throw new Error(
        `autoSaveInterval must be >= ${MEMORY_CONSTANTS.MIN_AUTO_SAVE_INTERVAL_MS}ms, got: ${this.config.autoSaveInterval}`,
      );
    }
  }

  /**
   * Initializes the memory system by loading existing data and starting auto-save.
   *
   * Must be called before using the memory manager. Safe to call multiple times
   * (subsequent calls are no-ops).
   *
   * @returns Promise that resolves when initialization is complete
   * @throws {Error} If storage directory cannot be created or data cannot be loaded
   *
   * @example
   * ```typescript
   * const memory = new MemoryManager();
   * await memory.initialize();
   * // Now safe to use memory.startSession(), addMessage(), etc.
   * ```
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      logger.debug('MemoryManager already initialized, skipping');
      return;
    }

    if (this.config.enablePersistence) {
      await this.ensureStorageDir();
      await this.load();
      this.startAutoSave();
    }

    this.isInitialized = true;
    logger.info('MemoryManager initialization complete', {
      entriesLoaded: this.entries.size,
      conversationsLoaded: this.conversations.size,
    });
  }

  /**
   * Ensures the storage directory exists, creating it if necessary.
   * @throws {Error} If directory creation fails
   */
  private async ensureStorageDir(): Promise<void> {
    try {
      await fs.promises.mkdir(this.config.storageDir, { recursive: true });
      logger.debug('Storage directory ensured', { path: this.config.storageDir });
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to create storage directory', {
        error: err.message,
        path: this.config.storageDir,
      });
      throw new Error(`Failed to create storage directory: ${err.message}`);
    }
  }

  /**
   * Starts the auto-save timer for periodic persistence.
   */
  private startAutoSave(): void {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
    }
    this.autoSaveTimer = setInterval(() => {
      if (this.isDirty) {
        this.save().catch((e) => {
          const err = e as Error;
          logger.error('Auto-save failed', { error: err.message });
          this.emit('error', err);
        });
      }
    }, this.config.autoSaveInterval);

    logger.debug('Auto-save timer started', { intervalMs: this.config.autoSaveInterval });
  }

  /**
   * Stops the auto-save timer.
   */
  private stopAutoSave(): void {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
      logger.debug('Auto-save timer stopped');
    }
  }

  /**
   * Generates a unique identifier for memory entries and sessions.
   *
   * Uses crypto.randomUUID() for proper UUID generation instead of
   * timestamp-based IDs which can collide under high load.
   *
   * @returns A unique UUID string
   */
  private generateId(): string {
    return randomUUID();
  }

  /**
   * Starts a new conversation session.
   *
   * Creates a new session and sets it as the current active session.
   * Previous sessions are preserved for history.
   *
   * @param metadata - Optional metadata to attach to the session
   * @returns The new session ID (UUID format)
   *
   * @example
   * ```typescript
   * const sessionId = memory.startSession({
   *   context: 'coding',
   *   project: 'atlas-desktop',
   * });
   * ```
   */
  startSession(metadata?: Record<string, unknown>): string {
    const sessionId = this.generateId();
    const now = Date.now();
    const session: ConversationSession = {
      id: sessionId,
      startedAt: now,
      lastActivityAt: now,
      messages: [],
      metadata,
    };

    this.conversations.set(sessionId, session);
    this.currentSessionId = sessionId;
    this.isDirty = true;

    // Evict old conversations if over limit
    this.evictOldConversations();

    logger.info('New conversation session started', { sessionId });
    return sessionId;
  }

  /**
   * Evicts oldest conversations when over the configured limit.
   * Uses LRU (least recently used) eviction based on lastActivityAt.
   */
  private evictOldConversations(): void {
    if (this.conversations.size <= this.config.maxConversations) {
      return;
    }

    const sortedSessions = Array.from(this.conversations.values()).sort(
      (a, b) => a.lastActivityAt - b.lastActivityAt,
    );

    const toEvict = sortedSessions.slice(0, this.conversations.size - this.config.maxConversations);
    for (const session of toEvict) {
      this.conversations.delete(session.id);
      logger.debug('Evicted old conversation', { sessionId: session.id });
    }

    if (toEvict.length > 0) {
      logger.info('Evicted old conversations', { count: toEvict.length });
    }
  }

  /**
   * Returns the current session ID, or null if no session is active.
   */
  getCurrentSessionId(): string | null {
    return this.currentSessionId;
  }

  /**
   * Retrieves a conversation session by ID.
   *
   * @param sessionId - The session ID to retrieve
   * @returns The session if found, undefined otherwise
   */
  getSession(sessionId: string): ConversationSession | undefined {
    return this.conversations.get(sessionId);
  }

  /**
   * Retrieves the current active session.
   *
   * @returns The current session, or undefined if no session is active
   */
  getCurrentSession(): ConversationSession | undefined {
    if (!this.currentSessionId) return undefined;
    return this.conversations.get(this.currentSessionId);
  }

  /**
   * Adds a message to the current conversation session.
   *
   * Automatically truncates messages if the session exceeds maxMessagesPerConversation.
   *
   * @param message - The message to add
   * @throws {Error} If no session is active (call startSession first)
   *
   * @example
   * ```typescript
   * memory.addMessage({ role: 'user', content: 'Hello!' });
   * memory.addMessage({ role: 'assistant', content: 'Hi there!' });
   * ```
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

// ============================================================================
// Session Context Manager - Cross-Session Context Persistence
// ============================================================================

import {
  SessionContext,
  SessionContextConfig,
  SessionContextEvents,
  WelcomeBackSummary,
  ContextRetrievalOptions,
  ContextRetrievalResult,
  UserPreference,
  PendingItem,
  DEFAULT_SESSION_CONTEXT_CONFIG,
  SESSION_CONTEXT_PROMPTS,
} from './types';
import { LLMManager, getLLMManager } from '../llm/manager';

const sessionLogger = createModuleLogger('SessionContext');

/**
 * Session Context Manager
 * Maintains context across conversation sessions for continuity
 */
export class SessionContextManager extends EventEmitter {
  private config: SessionContextConfig;
  private contexts: Map<string, SessionContext> = new Map();
  private activeContextId: string | null = null;
  private llmManager: LLMManager | null = null;
  private autoSaveTimer: NodeJS.Timeout | null = null;
  private decayTimer: NodeJS.Timeout | null = null;
  private isDirty = false;
  private isInitialized = false;

  constructor(config?: Partial<SessionContextConfig>) {
    super();

    // Set default storage directory based on platform
    const defaultStorageDir = path.join(
      process.env.HOME || process.env.USERPROFILE || '.',
      '.atlas',
      'contexts'
    );

    this.config = {
      ...DEFAULT_SESSION_CONTEXT_CONFIG,
      storageDir: defaultStorageDir,
      ...config,
    };

    sessionLogger.info('SessionContextManager created', {
      storageDir: this.config.storageDir,
      maxContexts: this.config.maxSessionContexts,
    });
  }

  /**
   * Initialize the session context manager
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      // Ensure storage directory exists
      await fs.promises.mkdir(this.config.storageDir, { recursive: true });

      // Get LLM manager for generating summaries
      try {
        this.llmManager = getLLMManager();
      } catch {
        sessionLogger.warn('LLM manager not available, using fallback summaries');
      }

      // Load existing contexts
      await this.loadContexts();

      // Apply decay to loaded contexts
      this.applyTimeDecay();

      // Start auto-save timer
      this.startAutoSave();

      // Start daily decay timer
      this.startDecayTimer();

      this.isInitialized = true;
      sessionLogger.info('SessionContextManager initialized', {
        loadedContexts: this.contexts.size,
      });
    } catch (error) {
      sessionLogger.error('Failed to initialize SessionContextManager', {
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * Start a new session context
   */
  startContext(sessionId: string, metadata?: Record<string, unknown>): SessionContext {
    const context: SessionContext = {
      id: this.generateId('ctx'),
      sessionId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      topics: [],
      keyFacts: [],
      preferences: [],
      pendingItems: [],
      summary: '',
      relevance: 1.0,
      exchangeCount: 0,
      relatedSessionIds: [],
      metadata,
    };

    this.contexts.set(context.id, context);
    this.activeContextId = context.id;
    this.isDirty = true;

    this.emit('context-created', context);
    sessionLogger.info('New session context started', {
      contextId: context.id,
      sessionId,
    });

    return context;
  }

  /**
   * Get the active session context
   */
  getActiveContext(): SessionContext | undefined {
    if (!this.activeContextId) return undefined;
    return this.contexts.get(this.activeContextId);
  }

  /**
   * Get a context by ID
   */
  getContext(contextId: string): SessionContext | undefined {
    return this.contexts.get(contextId);
  }

  /**
   * Get context by session ID
   */
  getContextBySessionId(sessionId: string): SessionContext | undefined {
    for (const context of this.contexts.values()) {
      if (context.sessionId === sessionId) {
        return context;
      }
    }
    return undefined;
  }

  /**
   * Update the active context with new information
   */
  updateContext(updates: {
    topics?: string[];
    keyFacts?: string[];
    preferences?: UserPreference[];
    pendingItems?: PendingItem[];
    summary?: string;
    exchangeCount?: number;
  }): void {
    const context = this.getActiveContext();
    if (!context) {
      sessionLogger.warn('No active context to update');
      return;
    }

    if (updates.topics) {
      // Merge topics, avoiding duplicates
      const topicSet = new Set([...context.topics, ...updates.topics]);
      context.topics = Array.from(topicSet);
    }

    if (updates.keyFacts) {
      // Merge facts, avoiding duplicates
      const factSet = new Set([...context.keyFacts, ...updates.keyFacts]);
      context.keyFacts = Array.from(factSet);
    }

    if (updates.preferences) {
      // Merge or update preferences
      for (const newPref of updates.preferences) {
        const existing = context.preferences.find(
          (p) => p.category === newPref.category && p.key === newPref.key
        );
        if (existing) {
          // Update existing preference
          existing.value = newPref.value;
          existing.confidence = Math.min(1, existing.confidence + 0.1);
          existing.lastConfirmed = Date.now();
          existing.confirmationCount++;
        } else {
          context.preferences.push(newPref);
        }
      }
    }

    if (updates.pendingItems) {
      // Add new pending items
      context.pendingItems.push(...updates.pendingItems);
    }

    if (updates.summary !== undefined) {
      context.summary = updates.summary;
    }

    if (updates.exchangeCount !== undefined) {
      context.exchangeCount = updates.exchangeCount;
    }

    context.updatedAt = Date.now();
    this.isDirty = true;

    // Update context linking
    if (this.config.enableContextLinking && updates.topics) {
      this.updateContextLinks(context);
    }

    this.emit('context-updated', context);
    sessionLogger.debug('Context updated', {
      contextId: context.id,
      topics: context.topics.length,
      facts: context.keyFacts.length,
    });
  }

  /**
   * Add a pending item to the active context
   */
  addPendingItem(item: Omit<PendingItem, 'id' | 'createdAt' | 'resolved'>): PendingItem {
    const pendingItem: PendingItem = {
      ...item,
      id: this.generateId('pending'),
      createdAt: Date.now(),
      resolved: false,
    };

    const context = this.getActiveContext();
    if (context) {
      context.pendingItems.push(pendingItem);
      context.updatedAt = Date.now();
      this.isDirty = true;
    }

    return pendingItem;
  }

  /**
   * Resolve a pending item
   */
  resolvePendingItem(itemId: string, resolution?: string): boolean {
    for (const context of this.contexts.values()) {
      const item = context.pendingItems.find((p) => p.id === itemId);
      if (item) {
        item.resolved = true;
        item.resolvedAt = Date.now();
        item.resolution = resolution;
        context.updatedAt = Date.now();
        this.isDirty = true;
        return true;
      }
    }
    return false;
  }

  /**
   * End the current session context
   */
  async endContext(generateSummary = true): Promise<void> {
    const context = this.getActiveContext();
    if (!context) return;

    context.endedAt = Date.now();
    context.updatedAt = Date.now();

    // Generate summary if requested and LLM available
    if (generateSummary && this.llmManager && context.exchangeCount > 0) {
      try {
        const summary = await this.generateContextSummary(context);
        context.summary = summary;
      } catch (error) {
        sessionLogger.warn('Failed to generate context summary', {
          error: (error as Error).message,
        });
      }
    }

    this.isDirty = true;
    this.activeContextId = null;

    // Save immediately on session end
    await this.saveContexts();

    this.emit('context-ended', context.sessionId);
    sessionLogger.info('Session context ended', {
      contextId: context.id,
      exchangeCount: context.exchangeCount,
    });
  }

  /**
   * Generate a welcome back summary for a new session
   */
  async generateWelcomeBackSummary(): Promise<WelcomeBackSummary> {
    const relevantContexts = this.getRecentRelevantContexts(5);

    if (relevantContexts.length === 0) {
      return {
        hasRelevantContext: false,
        continuableTopics: [],
        pendingItems: [],
        relevantFacts: [],
        summaryText: '',
      };
    }

    const lastContext = relevantContexts[0];
    const timeSinceLastSession = this.formatTimeSince(lastContext.endedAt || lastContext.updatedAt);

    // Collect pending items across contexts
    const unresolvedPendingItems: PendingItem[] = [];
    for (const ctx of relevantContexts) {
      unresolvedPendingItems.push(...ctx.pendingItems.filter((p) => !p.resolved));
    }

    // Collect topics and facts
    const allTopics = new Set<string>();
    const allFacts: string[] = [];
    const allPreferences: UserPreference[] = [];

    for (const ctx of relevantContexts) {
      ctx.topics.forEach((t) => allTopics.add(t));
      allFacts.push(...ctx.keyFacts);
      allPreferences.push(...ctx.preferences);
    }

    // Dedupe preferences by key
    const uniquePreferences = this.dedupePreferences(allPreferences);

    // Generate summary text
    let summaryText: string;

    if (this.llmManager) {
      try {
        summaryText = await this.generateLLMWelcomeSummary(
          relevantContexts,
          unresolvedPendingItems,
          uniquePreferences
        );
      } catch (error) {
        sessionLogger.warn('LLM welcome summary failed, using fallback', {
          error: (error as Error).message,
        });
        summaryText = this.generateFallbackWelcomeSummary(
          lastContext,
          unresolvedPendingItems,
          timeSinceLastSession
        );
      }
    } else {
      summaryText = this.generateFallbackWelcomeSummary(
        lastContext,
        unresolvedPendingItems,
        timeSinceLastSession
      );
    }

    const summary: WelcomeBackSummary = {
      hasRelevantContext: true,
      lastSessionTime: lastContext.endedAt || lastContext.updatedAt,
      timeSinceLastSession,
      continuableTopics: Array.from(allTopics).slice(0, this.config.welcomeSummaryMaxItems),
      pendingItems: unresolvedPendingItems.slice(0, this.config.welcomeSummaryMaxItems),
      relevantFacts: allFacts.slice(0, this.config.welcomeSummaryMaxItems),
      summaryText,
      mostRelevantSession: {
        sessionId: lastContext.sessionId,
        summary: lastContext.summary,
        topics: lastContext.topics,
        timestamp: lastContext.endedAt || lastContext.updatedAt,
      },
    };

    this.emit('welcome-summary-generated', summary);
    sessionLogger.info('Welcome summary generated', {
      hasContext: true,
      topicCount: summary.continuableTopics.length,
      pendingCount: summary.pendingItems.length,
    });

    return summary;
  }

  /**
   * Retrieve relevant context based on current conversation
   */
  retrieveRelevantContext(options: ContextRetrievalOptions = {}): ContextRetrievalResult {
    const startTime = Date.now();
    let results = Array.from(this.contexts.values());

    // Filter by time range
    if (options.startTime) {
      results = results.filter((c) => c.createdAt >= options.startTime!);
    }
    if (options.endTime) {
      results = results.filter((c) => c.createdAt <= options.endTime!);
    }

    // Filter by minimum relevance
    const minRelevance = options.minRelevance ?? this.config.minRelevanceThreshold;
    results = results.filter((c) => c.relevance >= minRelevance);

    // Filter by session IDs if specified
    if (options.sessionIds && options.sessionIds.length > 0) {
      results = results.filter((c) => options.sessionIds!.includes(c.sessionId));
    }

    // Score and sort by topic relevance if current topics provided
    if (options.currentTopics && options.currentTopics.length > 0) {
      results = results.map((ctx) => {
        const topicScore = this.calculateTopicOverlap(options.currentTopics!, ctx.topics);
        return { ...ctx, relevance: ctx.relevance * (0.5 + topicScore * 0.5) };
      });
    }

    // Sort by relevance (descending)
    results.sort((a, b) => b.relevance - a.relevance);

    // Apply limit
    const limit = options.limit ?? 10;
    results = results.slice(0, limit);

    // Aggregate results
    const aggregatedTopics = new Set<string>();
    const aggregatedFacts: string[] = [];
    const allPendingItems: PendingItem[] = [];
    const allPreferences: UserPreference[] = [];

    for (const ctx of results) {
      ctx.topics.forEach((t) => aggregatedTopics.add(t));
      aggregatedFacts.push(...ctx.keyFacts);

      const pendingFilter = options.includeResolved
        ? ctx.pendingItems
        : ctx.pendingItems.filter((p) => !p.resolved);
      allPendingItems.push(...pendingFilter);

      allPreferences.push(...ctx.preferences);
    }

    const result: ContextRetrievalResult = {
      contexts: results,
      aggregatedTopics: Array.from(aggregatedTopics),
      aggregatedFacts: [...new Set(aggregatedFacts)],
      pendingItems: allPendingItems,
      preferences: this.dedupePreferences(allPreferences),
      totalMatches: results.length,
      searchTimeMs: Date.now() - startTime,
    };

    sessionLogger.debug('Context retrieved', {
      matchCount: result.totalMatches,
      searchTimeMs: result.searchTimeMs,
    });

    return result;
  }

  /**
   * Smart context retrieval based on current query/topic
   */
  async getSmartContext(
    currentQuery: string,
    currentTopics: string[] = []
  ): Promise<{
    relevantFacts: string[];
    preferences: UserPreference[];
    pendingItems: PendingItem[];
    contextSummary: string;
  }> {
    // Retrieve relevant contexts
    const result = this.retrieveRelevantContext({
      currentTopics,
      currentQuery,
      limit: 5,
      minRelevance: 0.2,
    });

    // Build context summary for injection into conversation
    let contextSummary = '';

    if (result.contexts.length > 0) {
      const parts: string[] = [];

      if (result.aggregatedFacts.length > 0) {
        parts.push(`Known facts: ${result.aggregatedFacts.slice(0, 3).join('; ')}`);
      }

      if (result.pendingItems.length > 0) {
        const pendingDescriptions = result.pendingItems.slice(0, 2).map((p) => p.description);
        parts.push(`Pending items: ${pendingDescriptions.join('; ')}`);
      }

      if (result.preferences.length > 0) {
        const prefStrings = result.preferences.slice(0, 3).map((p) => `${p.key}: ${p.value}`);
        parts.push(`User preferences: ${prefStrings.join('; ')}`);
      }

      contextSummary = parts.join('. ');
    }

    return {
      relevantFacts: result.aggregatedFacts,
      preferences: result.preferences,
      pendingItems: result.pendingItems,
      contextSummary,
    };
  }

  /**
   * Reset all context (manual context reset)
   */
  async resetAllContext(): Promise<void> {
    this.contexts.clear();
    this.activeContextId = null;
    this.isDirty = true;

    await this.saveContexts();

    this.emit('context-reset');
    sessionLogger.info('All context reset');
  }

  /**
   * Archive old contexts based on age and relevance
   */
  async archiveOldContexts(): Promise<number> {
    const now = Date.now();
    const maxAgeMs = this.config.maxContextAgeDays * 24 * 60 * 60 * 1000;
    let archivedCount = 0;

    for (const [id, context] of this.contexts) {
      const age = now - context.createdAt;
      const shouldArchive = context.relevance < this.config.minRelevanceThreshold || age > maxAgeMs;

      if (shouldArchive && id !== this.activeContextId) {
        this.contexts.delete(id);
        archivedCount++;
        this.emit('context-archived', context.sessionId);
      }
    }

    if (archivedCount > 0) {
      this.isDirty = true;
      await this.saveContexts();
      sessionLogger.info('Archived old contexts', { count: archivedCount });
    }

    return archivedCount;
  }

  /**
   * Get statistics about session contexts
   */
  getStats(): {
    totalContexts: number;
    activeContextId: string | null;
    averageRelevance: number;
    totalPendingItems: number;
    unresolvedPendingItems: number;
    totalPreferences: number;
    oldestContextAge: number | null;
  } {
    const contexts = Array.from(this.contexts.values());
    let totalRelevance = 0;
    let totalPending = 0;
    let unresolvedPending = 0;
    let totalPrefs = 0;
    let oldestAge: number | null = null;

    const now = Date.now();

    for (const ctx of contexts) {
      totalRelevance += ctx.relevance;
      totalPending += ctx.pendingItems.length;
      unresolvedPending += ctx.pendingItems.filter((p) => !p.resolved).length;
      totalPrefs += ctx.preferences.length;

      const age = now - ctx.createdAt;
      if (oldestAge === null || age > oldestAge) {
        oldestAge = age;
      }
    }

    return {
      totalContexts: contexts.length,
      activeContextId: this.activeContextId,
      averageRelevance: contexts.length > 0 ? totalRelevance / contexts.length : 0,
      totalPendingItems: totalPending,
      unresolvedPendingItems: unresolvedPending,
      totalPreferences: totalPrefs,
      oldestContextAge: oldestAge,
    };
  }

  /**
   * Shutdown the session context manager
   */
  async shutdown(): Promise<void> {
    // End active context if any
    if (this.activeContextId) {
      await this.endContext(true);
    }

    // Stop timers
    this.stopAutoSave();
    this.stopDecayTimer();

    // Final save
    if (this.isDirty) {
      await this.saveContexts();
    }

    this.removeAllListeners();
    this.isInitialized = false;
    sessionLogger.info('SessionContextManager shutdown');
  }

  // ============================================================================
  // Private helpers
  // ============================================================================

  /**
   * Generate unique ID
   */
  private generateId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Apply time decay to all contexts
   */
  private applyTimeDecay(): void {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;

    for (const context of this.contexts.values()) {
      if (context.id === this.activeContextId) continue; // Don't decay active context

      const daysSinceUpdate = (now - context.updatedAt) / dayMs;
      const decay = Math.pow(1 - this.config.decayRatePerDay, daysSinceUpdate);
      const newRelevance = Math.max(0, context.relevance * decay);

      if (newRelevance !== context.relevance) {
        context.relevance = newRelevance;
        this.isDirty = true;
        this.emit('context-decayed', context.sessionId, newRelevance);
      }
    }
  }

  /**
   * Get recent relevant contexts sorted by time and relevance
   */
  private getRecentRelevantContexts(limit: number): SessionContext[] {
    return Array.from(this.contexts.values())
      .filter((c) => c.relevance >= this.config.minRelevanceThreshold)
      .filter((c) => c.id !== this.activeContextId) // Exclude current
      .sort((a, b) => {
        // Sort by recency first, then relevance
        const timeScore = (b.endedAt || b.updatedAt) - (a.endedAt || a.updatedAt);
        if (Math.abs(timeScore) > 24 * 60 * 60 * 1000) {
          return timeScore;
        }
        return b.relevance - a.relevance;
      })
      .slice(0, limit);
  }

  /**
   * Calculate topic overlap between two topic sets
   */
  private calculateTopicOverlap(topics1: string[], topics2: string[]): number {
    if (topics1.length === 0 || topics2.length === 0) return 0;

    const set1 = new Set(topics1.map((t) => t.toLowerCase()));
    const set2 = new Set(topics2.map((t) => t.toLowerCase()));

    let overlap = 0;
    for (const topic of set1) {
      if (set2.has(topic)) overlap++;
    }

    const union = new Set([...set1, ...set2]).size;
    return overlap / union;
  }

  /**
   * Update context links based on topic similarity
   */
  private updateContextLinks(context: SessionContext): void {
    if (context.topics.length === 0) return;

    const relatedIds: string[] = [];

    for (const other of this.contexts.values()) {
      if (other.id === context.id) continue;

      const overlap = this.calculateTopicOverlap(context.topics, other.topics);
      if (overlap >= this.config.topicOverlapThreshold) {
        relatedIds.push(other.sessionId);

        // Also add back-link
        if (!other.relatedSessionIds.includes(context.sessionId)) {
          other.relatedSessionIds.push(context.sessionId);
          if (other.relatedSessionIds.length > this.config.maxRelatedSessions) {
            other.relatedSessionIds = other.relatedSessionIds.slice(
              -this.config.maxRelatedSessions
            );
          }
        }

        this.emit('contexts-linked', context.sessionId, other.sessionId);
      }
    }

    context.relatedSessionIds = relatedIds.slice(0, this.config.maxRelatedSessions);
  }

  /**
   * Format time since a timestamp in human-readable form
   */
  private formatTimeSince(timestamp: number): string {
    const now = Date.now();
    const diffMs = now - timestamp;
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 60) {
      return diffMins === 1 ? '1 minute ago' : `${diffMins} minutes ago`;
    } else if (diffHours < 24) {
      return diffHours === 1 ? '1 hour ago' : `${diffHours} hours ago`;
    } else if (diffDays < 7) {
      return diffDays === 1 ? 'yesterday' : `${diffDays} days ago`;
    } else if (diffDays < 30) {
      const weeks = Math.floor(diffDays / 7);
      return weeks === 1 ? 'last week' : `${weeks} weeks ago`;
    } else {
      const months = Math.floor(diffDays / 30);
      return months === 1 ? 'last month' : `${months} months ago`;
    }
  }

  /**
   * Deduplicate preferences by key, keeping highest confidence
   */
  private dedupePreferences(preferences: UserPreference[]): UserPreference[] {
    const prefMap = new Map<string, UserPreference>();

    for (const pref of preferences) {
      const key = `${pref.category}:${pref.key}`;
      const existing = prefMap.get(key);

      if (!existing || pref.confidence > existing.confidence) {
        prefMap.set(key, pref);
      }
    }

    return Array.from(prefMap.values());
  }

  /**
   * Generate context summary using LLM
   */
  private async generateContextSummary(context: SessionContext): Promise<string> {
    if (!this.llmManager) return '';

    const prompt = `Summarize this conversation session in 1-2 sentences:
Topics discussed: ${context.topics.join(', ')}
Key facts: ${context.keyFacts.join('; ')}
Exchange count: ${context.exchangeCount}

Focus on the main activities and outcomes.`;

    const response = await this.llmManager.chat(prompt);
    return response.content.trim();
  }

  /**
   * Generate welcome summary using LLM
   */
  private async generateLLMWelcomeSummary(
    contexts: SessionContext[],
    pendingItems: PendingItem[],
    preferences: UserPreference[]
  ): Promise<string> {
    if (!this.llmManager) return '';

    const sessionsText = contexts
      .slice(0, 3)
      .map(
        (c) =>
          `- ${c.summary || c.topics.join(', ')} (${this.formatTimeSince(c.endedAt || c.updatedAt)})`
      )
      .join('\n');

    const pendingText =
      pendingItems.length > 0
        ? pendingItems
            .slice(0, 3)
            .map((p) => `- ${p.description}`)
            .join('\n')
        : 'None';

    const prefsText =
      preferences.length > 0
        ? preferences
            .slice(0, 3)
            .map((p) => `- ${p.key}: ${p.value}`)
            .join('\n')
        : 'None';

    const prompt = SESSION_CONTEXT_PROMPTS.welcomeBackSummary
      .replace('{sessions}', sessionsText)
      .replace('{pendingItems}', pendingText)
      .replace('{preferences}', prefsText);

    const response = await this.llmManager.chat(prompt);

    // Try to parse JSON response
    try {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return parsed.summaryText || response.content;
      }
    } catch {
      // Fall through to return raw content
    }

    return response.content.trim();
  }

  /**
   * Generate fallback welcome summary without LLM
   */
  private generateFallbackWelcomeSummary(
    lastContext: SessionContext,
    pendingItems: PendingItem[],
    timeSinceLastSession: string
  ): string {
    const parts: string[] = [];

    // Time reference
    parts.push(`Last time we talked was ${timeSinceLastSession}.`);

    // Topics
    if (lastContext.topics.length > 0) {
      const topicList = lastContext.topics.slice(0, 3).join(', ');
      parts.push(`We discussed ${topicList}.`);
    }

    // Pending items
    if (pendingItems.length > 0) {
      const pendingDesc = pendingItems[0].description;
      if (pendingItems.length === 1) {
        parts.push(`There's still a pending item: ${pendingDesc}`);
      } else {
        parts.push(`There are ${pendingItems.length} pending items, including: ${pendingDesc}`);
      }
    }

    return parts.join(' ');
  }

  /**
   * Start auto-save timer
   */
  private startAutoSave(): void {
    if (this.autoSaveTimer) return;

    this.autoSaveTimer = setInterval(() => {
      if (this.isDirty) {
        this.saveContexts().catch((e) =>
          sessionLogger.error('Auto-save failed', { error: (e as Error).message })
        );
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
   * Start daily decay timer
   */
  private startDecayTimer(): void {
    if (this.decayTimer) return;

    // Run decay check every hour
    this.decayTimer = setInterval(
      () => {
        this.applyTimeDecay();
      },
      60 * 60 * 1000
    );
  }

  /**
   * Stop decay timer
   */
  private stopDecayTimer(): void {
    if (this.decayTimer) {
      clearInterval(this.decayTimer);
      this.decayTimer = null;
    }
  }

  /**
   * Save contexts to disk
   */
  private async saveContexts(): Promise<void> {
    try {
      const data = {
        contexts: Array.from(this.contexts.entries()),
        activeContextId: this.activeContextId,
        savedAt: Date.now(),
      };

      const filePath = path.join(this.config.storageDir, 'session-contexts.json');
      await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2));

      this.isDirty = false;
      sessionLogger.debug('Contexts saved', { count: this.contexts.size });
    } catch (error) {
      sessionLogger.error('Failed to save contexts', { error: (error as Error).message });
      this.emit('error', error as Error, 'saveContexts');
      throw error;
    }
  }

  /**
   * Load contexts from disk
   */
  private async loadContexts(): Promise<void> {
    const filePath = path.join(this.config.storageDir, 'session-contexts.json');

    try {
      const exists = await fs.promises
        .access(filePath)
        .then(() => true)
        .catch(() => false);

      if (!exists) {
        sessionLogger.info('No existing session contexts file found');
        return;
      }

      const content = await fs.promises.readFile(filePath, 'utf-8');
      const data = JSON.parse(content) as {
        contexts: Array<[string, SessionContext]>;
        activeContextId: string | null;
        savedAt: number;
      };

      this.contexts = new Map(data.contexts);

      // Prune old contexts if over limit
      await this.pruneOldContexts();

      sessionLogger.info('Contexts loaded', {
        count: this.contexts.size,
        savedAt: new Date(data.savedAt).toISOString(),
      });
    } catch (error) {
      sessionLogger.error('Failed to load contexts', { error: (error as Error).message });
      this.emit('error', error as Error, 'loadContexts');
    }
  }

  /**
   * Prune old contexts to stay within limit
   */
  private async pruneOldContexts(): Promise<void> {
    if (this.contexts.size <= this.config.maxSessionContexts) return;

    const sorted = Array.from(this.contexts.entries()).sort((a, b) => {
      // Keep higher relevance and more recent
      const relevanceDiff = b[1].relevance - a[1].relevance;
      if (Math.abs(relevanceDiff) > 0.1) return relevanceDiff;
      return (b[1].endedAt || b[1].updatedAt) - (a[1].endedAt || a[1].updatedAt);
    });

    const toKeep = sorted.slice(0, this.config.maxSessionContexts);
    this.contexts = new Map(toKeep);
    this.isDirty = true;

    sessionLogger.info('Pruned old contexts', {
      removed: sorted.length - toKeep.length,
    });
  }

  // Type-safe event emitter methods
  on<K extends keyof SessionContextEvents>(event: K, listener: SessionContextEvents[K]): this {
    return super.on(event, listener);
  }

  off<K extends keyof SessionContextEvents>(event: K, listener: SessionContextEvents[K]): this {
    return super.off(event, listener);
  }

  emit<K extends keyof SessionContextEvents>(
    event: K,
    ...args: Parameters<SessionContextEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }
}

// Singleton instance for SessionContextManager
let sessionContextManager: SessionContextManager | null = null;

/**
 * Get or create the session context manager instance
 */
export async function getSessionContextManager(
  config?: Partial<SessionContextConfig>
): Promise<SessionContextManager> {
  if (!sessionContextManager) {
    sessionContextManager = new SessionContextManager(config);
    await sessionContextManager.initialize();
  }
  return sessionContextManager;
}

/**
 * Shutdown the session context manager
 */
export async function shutdownSessionContextManager(): Promise<void> {
  if (sessionContextManager) {
    await sessionContextManager.shutdown();
    sessionContextManager = null;
  }
}

export default MemoryManager;

// Export conversation summarizer
export {
  ConversationSummarizer,
  getConversationSummarizer,
  shutdownConversationSummarizer,
} from './summarizer';

// Export summarization types
export * from './types';

// Export backup system
export {
  BackupManager,
  getBackupManager,
  initBackupSystem,
  shutdownBackupSystem,
  backupNote,
  createDailyBackup,
  pruneOldBackups,
} from './backup';
export type { BackupConfig, BackupEvents } from './backup';

// Export selective forgetting
export {
  detectForgetCommand,
  executeForgetCommand,
  handleForgetCommand,
  getForgetCapabilities,
} from './selective-forgetting';
export type { ForgetCommand, ForgetResult, ForgetCommandType } from './selective-forgetting';

// Export forgetting manager
export {
  ForgettingManager,
  getForgettingManager,
  startForgettingManager,
  stopForgettingManager,
  shutdownForgettingManager,
} from './forgetting';
export type {
  RetentionLevel,
  DecayCurve,
  RetentionPolicy,
  GDPRDeletionRequest,
  DecayResult,
  ForgettingBatchResult,
  ForgetOptions,
  ForgettingConfig,
  ForgettingEvents,
} from './forgetting';

// Export note-writer forgetting functions
export { forgetNote, forgetNotes } from './note-writer';
