/**
 * Atlas Desktop - Conversation History Manager
 * Replay, edit, and branch conversations
 *
 * Features:
 * - Navigate through conversation history
 * - Edit past user messages and regenerate responses
 * - Create conversation branches (like Git for conversations)
 * - Export/import conversation threads
 *
 * @module memory/conversation-history
 */

import { EventEmitter } from 'events';
import * as fs from 'fs-extra';
import * as path from 'path';
import { app } from 'electron';
import { createModuleLogger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

const logger = createModuleLogger('ConversationHistory');

// ============================================================================
// Types
// ============================================================================

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  metadata?: {
    edited?: boolean;
    originalContent?: string;
    regenerated?: boolean;
    branchedFrom?: string;
    toolCalls?: unknown[];
    tokenCount?: number;
  };
}

export interface ConversationBranch {
  id: string;
  name: string;
  parentBranchId: string | null;
  branchPointMessageId: string | null;
  createdAt: number;
  messages: ConversationMessage[];
  isActive: boolean;
}

export interface ConversationThread {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  branches: ConversationBranch[];
  activeBranchId: string;
  tags: string[];
  summary?: string;
  metadata?: Record<string, unknown>;
}

export interface ConversationHistoryEvents {
  'message-added': (message: ConversationMessage, branchId: string) => void;
  'message-edited': (message: ConversationMessage, oldContent: string) => void;
  'branch-created': (branch: ConversationBranch) => void;
  'branch-switched': (branchId: string) => void;
  'thread-created': (thread: ConversationThread) => void;
  'thread-loaded': (thread: ConversationThread) => void;
  error: (error: Error) => void;
}

export interface ReplayOptions {
  speed?: number; // Messages per second
  includeAssistant?: boolean;
  onMessage?: (message: ConversationMessage, index: number) => void;
  onComplete?: () => void;
}

// ============================================================================
// Conversation History Manager
// ============================================================================

export class ConversationHistoryManager extends EventEmitter {
  private threads: Map<string, ConversationThread> = new Map();
  private currentThreadId: string | null = null;
  private storagePath: string;
  private autoSaveInterval: NodeJS.Timeout | null = null;
  private isDirty: boolean = false;

  constructor() {
    super();
    this.storagePath = path.join(app.getPath('userData'), 'conversations');
    this.initialize();
  }

  private async initialize(): Promise<void> {
    try {
      await fs.ensureDir(this.storagePath);
      await this.loadAllThreads();
      this.startAutoSave();
      logger.info('ConversationHistoryManager initialized', {
        storagePath: this.storagePath,
        threadCount: this.threads.size,
      });
    } catch (error) {
      logger.error('Failed to initialize conversation history', { error });
      this.emit('error', error as Error);
    }
  }

  private async loadAllThreads(): Promise<void> {
    const files = await fs.readdir(this.storagePath);
    const threadFiles = files.filter((f) => f.endsWith('.json'));

    for (const file of threadFiles) {
      try {
        const filePath = path.join(this.storagePath, file);
        const data = await fs.readJson(filePath);
        this.threads.set(data.id, data);
      } catch (error) {
        logger.warn('Failed to load thread file', { file, error });
      }
    }
  }

  private startAutoSave(): void {
    this.autoSaveInterval = setInterval(async () => {
      if (this.isDirty) {
        await this.saveAllThreads();
        this.isDirty = false;
      }
    }, 30000); // Auto-save every 30 seconds
  }

  private async saveAllThreads(): Promise<void> {
    for (const [id, thread] of this.threads) {
      const filePath = path.join(this.storagePath, `${id}.json`);
      await fs.writeJson(filePath, thread, { spaces: 2 });
    }
    logger.debug('Saved all conversation threads', { count: this.threads.size });
  }

  // ============================================================================
  // Thread Management
  // ============================================================================

  /**
   * Create a new conversation thread
   */
  createThread(title?: string): ConversationThread {
    const threadId = uuidv4();
    const mainBranch: ConversationBranch = {
      id: uuidv4(),
      name: 'main',
      parentBranchId: null,
      branchPointMessageId: null,
      createdAt: Date.now(),
      messages: [],
      isActive: true,
    };

    const thread: ConversationThread = {
      id: threadId,
      title: title || `Conversation ${new Date().toLocaleDateString()}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      branches: [mainBranch],
      activeBranchId: mainBranch.id,
      tags: [],
    };

    this.threads.set(threadId, thread);
    this.currentThreadId = threadId;
    this.isDirty = true;

    this.emit('thread-created', thread);
    logger.info('Created new conversation thread', { threadId, title: thread.title });

    return thread;
  }

  /**
   * Get current thread or create one if none exists
   */
  getCurrentThread(): ConversationThread {
    if (!this.currentThreadId || !this.threads.has(this.currentThreadId)) {
      return this.createThread();
    }
    return this.threads.get(this.currentThreadId)!;
  }

  /**
   * Get active branch of current thread
   */
  getActiveBranch(): ConversationBranch | null {
    const thread = this.getCurrentThread();
    return thread.branches.find((b) => b.id === thread.activeBranchId) || null;
  }

  /**
   * List all conversation threads
   */
  listThreads(): ConversationThread[] {
    return Array.from(this.threads.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /**
   * Switch to a different thread
   */
  switchThread(threadId: string): boolean {
    if (!this.threads.has(threadId)) {
      logger.warn('Thread not found', { threadId });
      return false;
    }
    this.currentThreadId = threadId;
    this.emit('thread-loaded', this.threads.get(threadId)!);
    return true;
  }

  /**
   * Delete a thread
   */
  async deleteThread(threadId: string): Promise<boolean> {
    if (!this.threads.has(threadId)) return false;

    this.threads.delete(threadId);
    const filePath = path.join(this.storagePath, `${threadId}.json`);
    await fs.remove(filePath).catch(() => {});

    if (this.currentThreadId === threadId) {
      this.currentThreadId = null;
    }

    logger.info('Deleted conversation thread', { threadId });
    return true;
  }

  // ============================================================================
  // Message Management
  // ============================================================================

  /**
   * Add a message to the current conversation
   */
  addMessage(
    role: 'user' | 'assistant' | 'system',
    content: string,
    metadata?: ConversationMessage['metadata']
  ): ConversationMessage {
    const branch = this.getActiveBranch();
    if (!branch) {
      const thread = this.createThread();
      return this.addMessage(role, content, metadata);
    }

    const message: ConversationMessage = {
      id: uuidv4(),
      role,
      content,
      timestamp: Date.now(),
      metadata,
    };

    branch.messages.push(message);
    this.getCurrentThread().updatedAt = Date.now();
    this.isDirty = true;

    this.emit('message-added', message, branch.id);
    return message;
  }

  /**
   * Edit a past message (user messages only)
   */
  editMessage(messageId: string, newContent: string): ConversationMessage | null {
    const branch = this.getActiveBranch();
    if (!branch) return null;

    const messageIndex = branch.messages.findIndex((m) => m.id === messageId);
    if (messageIndex === -1) return null;

    const message = branch.messages[messageIndex];
    if (message.role !== 'user') {
      logger.warn('Can only edit user messages');
      return null;
    }

    const oldContent = message.content;
    message.content = newContent;
    message.metadata = {
      ...message.metadata,
      edited: true,
      originalContent: message.metadata?.originalContent || oldContent,
    };

    // Remove all messages after the edited message (they need to be regenerated)
    branch.messages = branch.messages.slice(0, messageIndex + 1);

    this.isDirty = true;
    this.emit('message-edited', message, oldContent);
    logger.info('Edited message', { messageId, truncatedAfter: messageIndex });

    return message;
  }

  /**
   * Get message history for context
   */
  getHistory(limit?: number): ConversationMessage[] {
    const branch = this.getActiveBranch();
    if (!branch) return [];

    const messages = branch.messages;
    return limit ? messages.slice(-limit) : messages;
  }

  /**
   * Get a specific message by ID
   */
  getMessage(messageId: string): ConversationMessage | null {
    const branch = this.getActiveBranch();
    if (!branch) return null;
    return branch.messages.find((m) => m.id === messageId) || null;
  }

  // ============================================================================
  // Branching
  // ============================================================================

  /**
   * Create a new branch from a specific message
   * Like Git, allows exploring alternate conversation paths
   */
  createBranch(fromMessageId: string, branchName?: string): ConversationBranch | null {
    const thread = this.getCurrentThread();
    const currentBranch = this.getActiveBranch();
    if (!currentBranch) return null;

    const messageIndex = currentBranch.messages.findIndex((m) => m.id === fromMessageId);
    if (messageIndex === -1) {
      logger.warn('Message not found for branching', { fromMessageId });
      return null;
    }

    // Copy messages up to and including the branch point
    const branchedMessages = currentBranch.messages.slice(0, messageIndex + 1).map((m) => ({
      ...m,
      id: uuidv4(), // New IDs for branched messages
      metadata: { ...m.metadata, branchedFrom: m.id },
    }));

    const newBranch: ConversationBranch = {
      id: uuidv4(),
      name: branchName || `branch-${thread.branches.length}`,
      parentBranchId: currentBranch.id,
      branchPointMessageId: fromMessageId,
      createdAt: Date.now(),
      messages: branchedMessages,
      isActive: false,
    };

    thread.branches.push(newBranch);
    this.isDirty = true;

    this.emit('branch-created', newBranch);
    logger.info('Created conversation branch', {
      branchId: newBranch.id,
      fromMessage: fromMessageId,
      messageCount: branchedMessages.length,
    });

    return newBranch;
  }

  /**
   * Switch to a different branch
   */
  switchBranch(branchId: string): boolean {
    const thread = this.getCurrentThread();
    const branch = thread.branches.find((b) => b.id === branchId);

    if (!branch) {
      logger.warn('Branch not found', { branchId });
      return false;
    }

    // Deactivate current branch
    thread.branches.forEach((b) => (b.isActive = false));

    // Activate new branch
    branch.isActive = true;
    thread.activeBranchId = branchId;
    this.isDirty = true;

    this.emit('branch-switched', branchId);
    logger.info('Switched to branch', { branchId, name: branch.name });

    return true;
  }

  /**
   * List all branches in current thread
   */
  listBranches(): ConversationBranch[] {
    const thread = this.getCurrentThread();
    return thread.branches;
  }

  /**
   * Merge a branch into main (copies all unique messages)
   */
  mergeBranch(branchId: string): boolean {
    const thread = this.getCurrentThread();
    const mainBranch = thread.branches.find((b) => b.name === 'main');
    const sourceBranch = thread.branches.find((b) => b.id === branchId);

    if (!mainBranch || !sourceBranch) return false;
    if (sourceBranch.id === mainBranch.id) return false;

    // Find messages unique to source branch
    const mainMessageIds = new Set(mainBranch.messages.map((m) => m.metadata?.branchedFrom || m.id));
    const uniqueMessages = sourceBranch.messages.filter(
      (m) => !mainMessageIds.has(m.metadata?.branchedFrom || m.id)
    );

    mainBranch.messages.push(...uniqueMessages);
    this.isDirty = true;

    logger.info('Merged branch', { branchId, addedMessages: uniqueMessages.length });
    return true;
  }

  // ============================================================================
  // Replay
  // ============================================================================

  /**
   * Replay a conversation with optional callback per message
   */
  async replay(options: ReplayOptions = {}): Promise<void> {
    const branch = this.getActiveBranch();
    if (!branch) return;

    const { speed = 1, includeAssistant = true, onMessage, onComplete } = options;

    const messages = includeAssistant
      ? branch.messages
      : branch.messages.filter((m) => m.role === 'user');

    const delayMs = 1000 / speed;

    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      if (onMessage) {
        onMessage(message, i);
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    if (onComplete) {
      onComplete();
    }

    logger.info('Conversation replay complete', { messageCount: messages.length });
  }

  /**
   * Get conversation as exportable format
   */
  exportThread(threadId?: string): string {
    const thread = threadId ? this.threads.get(threadId) : this.getCurrentThread();
    if (!thread) return '';

    return JSON.stringify(thread, null, 2);
  }

  /**
   * Import a conversation thread
   */
  async importThread(data: string): Promise<ConversationThread | null> {
    try {
      const thread = JSON.parse(data) as ConversationThread;
      thread.id = uuidv4(); // Assign new ID to avoid conflicts
      thread.createdAt = Date.now();
      thread.updatedAt = Date.now();

      this.threads.set(thread.id, thread);
      this.isDirty = true;

      logger.info('Imported conversation thread', { threadId: thread.id });
      return thread;
    } catch (error) {
      logger.error('Failed to import thread', { error });
      return null;
    }
  }

  // ============================================================================
  // Search
  // ============================================================================

  /**
   * Search across all conversations
   */
  search(query: string, options?: { limit?: number; threadId?: string }): ConversationMessage[] {
    const results: ConversationMessage[] = [];
    const queryLower = query.toLowerCase();
    const limit = options?.limit || 50;

    const threadsToSearch = options?.threadId
      ? [this.threads.get(options.threadId)].filter(Boolean)
      : Array.from(this.threads.values());

    for (const thread of threadsToSearch) {
      if (!thread) continue;
      for (const branch of thread.branches) {
        for (const message of branch.messages) {
          if (message.content.toLowerCase().includes(queryLower)) {
            results.push(message);
            if (results.length >= limit) break;
          }
        }
      }
    }

    return results;
  }

  // ============================================================================
  // Cleanup
  // ============================================================================

  async dispose(): Promise<void> {
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
    }
    await this.saveAllThreads();
    logger.info('ConversationHistoryManager disposed');
  }
}

// ============================================================================
// Singleton
// ============================================================================

let historyManager: ConversationHistoryManager | null = null;

export function getConversationHistoryManager(): ConversationHistoryManager {
  if (!historyManager) {
    historyManager = new ConversationHistoryManager();
  }
  return historyManager;
}
