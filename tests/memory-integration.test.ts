/**
 * Nova Desktop - Memory Integration Tests
 * Tests for conversation memory persistence and integration with voice pipeline
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Mock fs for tests
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn(() => true),
    mkdirSync: vi.fn(),
    promises: {
      mkdir: vi.fn().mockResolvedValue(undefined),
      writeFile: vi.fn().mockResolvedValue(undefined),
      readFile: vi.fn().mockResolvedValue('{}'),
      access: vi.fn().mockRejectedValue(new Error('Not found')),
    },
  };
});

// Mock electron
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/mock/path'),
  },
}));

// Import after mocks
import {
  MemoryManager,
  MemoryEntry,
  ConversationSession,
  MemoryConfig,
} from '../src/main/memory/index';

describe('MemoryManager', () => {
  let memoryManager: MemoryManager;

  beforeEach(() => {
    vi.clearAllMocks();
    memoryManager = new MemoryManager({
      enablePersistence: false, // Disable persistence for unit tests
    });
  });

  afterEach(async () => {
    if (memoryManager) {
      await memoryManager.shutdown();
    }
  });

  describe('Session Management', () => {
    it('should start a new conversation session', () => {
      const sessionId = memoryManager.startSession({ device: 'test' });

      expect(sessionId).toBeDefined();
      expect(typeof sessionId).toBe('string');
      expect(memoryManager.getCurrentSessionId()).toBe(sessionId);
    });

    it('should get current session', () => {
      memoryManager.startSession({ device: 'test' });
      const session = memoryManager.getCurrentSession();

      expect(session).toBeDefined();
      expect(session?.messages).toEqual([]);
      expect(session?.metadata).toEqual({ device: 'test' });
    });

    it('should store session metadata', () => {
      memoryManager.startSession({
        device: 'desktop',
        version: '1.0.0',
        customField: 'test',
      });
      const session = memoryManager.getCurrentSession();

      expect(session?.metadata).toEqual({
        device: 'desktop',
        version: '1.0.0',
        customField: 'test',
      });
    });

    it('should return undefined for non-existent session', () => {
      const session = memoryManager.getSession('non-existent-id');
      expect(session).toBeUndefined();
    });
  });

  describe('Message Storage', () => {
    it('should add user message to session', () => {
      memoryManager.startSession();
      memoryManager.addMessage({ role: 'user', content: 'Hello Nova!' });

      const messages = memoryManager.getRecentMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({ role: 'user', content: 'Hello Nova!' });
    });

    it('should add assistant message to session', () => {
      memoryManager.startSession();
      memoryManager.addMessage({ role: 'assistant', content: 'Hello! How can I help?' });

      const messages = memoryManager.getRecentMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({ role: 'assistant', content: 'Hello! How can I help?' });
    });

    it('should maintain conversation order', () => {
      memoryManager.startSession();
      memoryManager.addMessage({ role: 'user', content: 'First message' });
      memoryManager.addMessage({ role: 'assistant', content: 'First response' });
      memoryManager.addMessage({ role: 'user', content: 'Second message' });
      memoryManager.addMessage({ role: 'assistant', content: 'Second response' });

      const messages = memoryManager.getRecentMessages();
      expect(messages).toHaveLength(4);
      expect(messages[0].role).toBe('user');
      expect(messages[1].role).toBe('assistant');
      expect(messages[2].role).toBe('user');
      expect(messages[3].role).toBe('assistant');
    });

    it('should limit messages with getRecentMessages', () => {
      memoryManager.startSession();
      for (let i = 0; i < 10; i++) {
        memoryManager.addMessage({ role: 'user', content: `Message ${i}` });
      }

      const recentFive = memoryManager.getRecentMessages(5);
      expect(recentFive).toHaveLength(5);
      expect(recentFive[0].content).toBe('Message 5');
      expect(recentFive[4].content).toBe('Message 9');
    });

    it('should auto-create session when adding message without session', () => {
      // No startSession called
      memoryManager.addMessage({ role: 'user', content: 'Test message' });

      expect(memoryManager.getCurrentSessionId()).toBeDefined();
      const messages = memoryManager.getRecentMessages();
      expect(messages).toHaveLength(1);
    });
  });

  describe('Memory Entries', () => {
    it('should add memory entry', () => {
      const entry = memoryManager.addEntry('fact', 'User likes TypeScript', {
        importance: 0.8,
        tags: ['preference', 'programming'],
      });

      expect(entry.id).toBeDefined();
      expect(entry.type).toBe('fact');
      expect(entry.content).toBe('User likes TypeScript');
      expect(entry.importance).toBe(0.8);
      expect(entry.tags).toContain('preference');
    });

    it('should get memory entry by id', () => {
      const created = memoryManager.addEntry('preference', 'Dark mode preferred');
      const retrieved = memoryManager.getEntry(created.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.content).toBe('Dark mode preferred');
    });

    it('should update accessedAt when getting entry', () => {
      const entry = memoryManager.addEntry('fact', 'Test fact');

      // Get entry - accessedAt is updated in getEntry
      const retrieved = memoryManager.getEntry(entry.id);

      expect(retrieved).toBeDefined();
      // Note: accessedAt might be the same if retrieved immediately
      expect(retrieved?.accessedAt).toBeGreaterThanOrEqual(entry.accessedAt);
    });

    it('should remove memory entry', () => {
      const entry = memoryManager.addEntry('context', 'Temporary context');
      const removed = memoryManager.removeEntry(entry.id);

      expect(removed).toBe(true);
      expect(memoryManager.getEntry(entry.id)).toBeUndefined();
    });

    it('should return false when removing non-existent entry', () => {
      const removed = memoryManager.removeEntry('non-existent-id');
      expect(removed).toBe(false);
    });
  });

  describe('Memory Search', () => {
    beforeEach(() => {
      memoryManager.addEntry('fact', 'User is a software developer', {
        importance: 0.9,
        tags: ['career', 'tech'],
      });
      memoryManager.addEntry('preference', 'Prefers TypeScript over JavaScript', {
        importance: 0.7,
        tags: ['programming', 'preference'],
      });
      memoryManager.addEntry('fact', 'Lives in New York', {
        importance: 0.5,
        tags: ['location'],
      });
      memoryManager.addEntry('context', 'Working on a React project', {
        importance: 0.6,
        tags: ['project', 'tech'],
      });
    });

    it('should search by type', () => {
      const facts = memoryManager.searchEntries({ type: 'fact' });

      expect(facts).toHaveLength(2);
      expect(facts.every((e) => e.type === 'fact')).toBe(true);
    });

    it('should search by tags', () => {
      const techEntries = memoryManager.searchEntries({ tags: ['tech'] });

      expect(techEntries).toHaveLength(2);
    });

    it('should search by minimum importance', () => {
      const important = memoryManager.searchEntries({ minImportance: 0.7 });

      expect(important).toHaveLength(2);
      expect(important.every((e) => e.importance >= 0.7)).toBe(true);
    });

    it('should search by text content', () => {
      const results = memoryManager.searchEntries({ text: 'TypeScript' });

      expect(results).toHaveLength(1);
      expect(results[0].content).toContain('TypeScript');
    });

    it('should limit search results', () => {
      const limited = memoryManager.searchEntries({ limit: 2 });

      expect(limited).toHaveLength(2);
    });

    it('should combine multiple search criteria', () => {
      const results = memoryManager.searchEntries({
        type: 'fact',
        minImportance: 0.6,
      });

      expect(results).toHaveLength(1);
      expect(results[0].content).toContain('software developer');
    });

    it('should sort by importance and recency', () => {
      const results = memoryManager.searchEntries({});

      // Should be sorted by importance (highest first)
      expect(results[0].importance).toBeGreaterThanOrEqual(results[1].importance);
    });
  });

  describe('Statistics', () => {
    it('should return correct stats', () => {
      memoryManager.startSession();
      memoryManager.addMessage({ role: 'user', content: 'Hello' });
      memoryManager.addMessage({ role: 'assistant', content: 'Hi there!' });
      memoryManager.addEntry('fact', 'Test fact');
      memoryManager.addEntry('preference', 'Test preference');

      const stats = memoryManager.getStats();

      expect(stats.totalConversations).toBe(1);
      expect(stats.currentSessionMessages).toBe(2);
      expect(stats.totalEntries).toBe(2);
    });

    it('should return zero stats when empty', () => {
      const stats = memoryManager.getStats();

      expect(stats.totalConversations).toBe(0);
      expect(stats.currentSessionMessages).toBe(0);
      expect(stats.totalEntries).toBe(0);
    });
  });

  describe('Clear Memory', () => {
    it('should clear all memory', async () => {
      memoryManager.startSession();
      memoryManager.addMessage({ role: 'user', content: 'Test' });
      memoryManager.addEntry('fact', 'Test fact');

      await memoryManager.clear();

      const stats = memoryManager.getStats();
      expect(stats.totalConversations).toBe(0);
      expect(stats.currentSessionMessages).toBe(0);
      expect(stats.totalEntries).toBe(0);
      expect(memoryManager.getCurrentSessionId()).toBeNull();
    });
  });

  describe('Multiple Sessions', () => {
    it('should get all sessions sorted by activity', async () => {
      const session1 = memoryManager.startSession({ name: 'session1' });
      memoryManager.addMessage({ role: 'user', content: 'Hello from session 1' });

      // Small delay to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 10));

      const session2 = memoryManager.startSession({ name: 'session2' });
      memoryManager.addMessage({ role: 'user', content: 'Hello from session 2' });

      const allSessions = memoryManager.getAllSessions();

      expect(allSessions).toHaveLength(2);
      // Most recent (session2) should be first (sorted by lastActivityAt)
      expect(allSessions[0].id).toBe(session2);
      expect(allSessions[1].id).toBe(session1);
    });
  });
});

describe('Memory Persistence', () => {
  let memoryManager: MemoryManager;
  let mockWriteFile: ReturnType<typeof vi.fn>;
  let mockReadFile: ReturnType<typeof vi.fn>;
  let mockAccess: ReturnType<typeof vi.fn>;
  let mockMkdir: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockWriteFile = vi.fn().mockResolvedValue(undefined);
    mockReadFile = vi.fn().mockResolvedValue(
      JSON.stringify({
        entries: [],
        conversations: [],
        currentSessionId: null,
        savedAt: Date.now(),
      })
    );
    mockAccess = vi.fn().mockResolvedValue(undefined);
    mockMkdir = vi.fn().mockResolvedValue(undefined);

    (fs.promises.writeFile as ReturnType<typeof vi.fn>) = mockWriteFile;
    (fs.promises.readFile as ReturnType<typeof vi.fn>) = mockReadFile;
    (fs.promises.access as ReturnType<typeof vi.fn>) = mockAccess;
    (fs.promises.mkdir as ReturnType<typeof vi.fn>) = mockMkdir;
  });

  afterEach(async () => {
    if (memoryManager) {
      await memoryManager.shutdown();
    }
  });

  it('should save memory to disk', async () => {
    memoryManager = new MemoryManager({
      enablePersistence: true,
      storageDir: '/test/memory',
      autoSaveInterval: 60000, // Long interval to prevent auto-save interference
    });

    await memoryManager.initialize();
    memoryManager.startSession();
    memoryManager.addMessage({ role: 'user', content: 'Test message' });

    await memoryManager.save();

    expect(mockWriteFile).toHaveBeenCalled();
    const savedData = JSON.parse(mockWriteFile.mock.calls[0][1]);
    expect(savedData.conversations).toHaveLength(1);
  });

  it('should load memory from disk', async () => {
    const existingData = {
      entries: [
        [
          'entry-1',
          {
            id: 'entry-1',
            type: 'fact',
            content: 'Loaded fact',
            createdAt: Date.now(),
            accessedAt: Date.now(),
            importance: 0.5,
          },
        ],
      ],
      conversations: [
        [
          'session-1',
          {
            id: 'session-1',
            startedAt: Date.now(),
            lastActivityAt: Date.now(),
            messages: [{ role: 'user', content: 'Previous message' }],
          },
        ],
      ],
      currentSessionId: null,
      savedAt: Date.now(),
    };

    mockReadFile.mockResolvedValue(JSON.stringify(existingData));

    memoryManager = new MemoryManager({
      enablePersistence: true,
      storageDir: '/test/memory',
    });

    await memoryManager.initialize();

    const sessions = memoryManager.getAllSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].messages).toHaveLength(1);
  });

  it('should handle missing memory file gracefully', async () => {
    mockAccess.mockRejectedValue(new Error('File not found'));

    memoryManager = new MemoryManager({
      enablePersistence: true,
      storageDir: '/test/memory',
    });

    // Should not throw
    await expect(memoryManager.initialize()).resolves.not.toThrow();

    const stats = memoryManager.getStats();
    expect(stats.totalConversations).toBe(0);
  });
});

describe('Memory Events', () => {
  let memoryManager: MemoryManager;

  beforeEach(() => {
    memoryManager = new MemoryManager({ enablePersistence: false });
  });

  afterEach(async () => {
    await memoryManager.shutdown();
  });

  it('should emit entry-added event', () => {
    const handler = vi.fn();
    memoryManager.on('entry-added', handler);

    memoryManager.addEntry('fact', 'Test fact');

    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0][0].content).toBe('Test fact');
  });

  it('should emit entry-removed event', () => {
    const handler = vi.fn();
    memoryManager.on('entry-removed', handler);

    const entry = memoryManager.addEntry('fact', 'Test fact');
    memoryManager.removeEntry(entry.id);

    expect(handler).toHaveBeenCalledWith(entry.id);
  });
});

describe('Memory Integration with Voice Pipeline', () => {
  it('should correctly format conversation history for LLM context', () => {
    const memoryManager = new MemoryManager({ enablePersistence: false });
    memoryManager.startSession();

    // Simulate conversation history
    memoryManager.addMessage({ role: 'user', content: 'What is TypeScript?' });
    memoryManager.addMessage({
      role: 'assistant',
      content: 'TypeScript is a typed superset of JavaScript.',
    });
    memoryManager.addMessage({ role: 'user', content: 'How do I use it?' });

    const recentMessages = memoryManager.getRecentMessages(10);

    // Should have 3 messages in order
    expect(recentMessages).toHaveLength(3);
    expect(recentMessages[0].role).toBe('user');
    expect(recentMessages[1].role).toBe('assistant');
    expect(recentMessages[2].role).toBe('user');

    // Last message should be excluded when building context (it's the current query)
    const historyForContext = recentMessages.slice(0, -1);
    expect(historyForContext).toHaveLength(2);
  });

  it('should respect maxHistoryTurns when loading context', () => {
    const memoryManager = new MemoryManager({
      enablePersistence: false,
      maxMessagesPerConversation: 100,
    });
    memoryManager.startSession();

    // Add many messages
    for (let i = 0; i < 20; i++) {
      memoryManager.addMessage({ role: 'user', content: `User message ${i}` });
      memoryManager.addMessage({ role: 'assistant', content: `Assistant response ${i}` });
    }

    // Request only last 5 messages
    const recentFive = memoryManager.getRecentMessages(5);
    expect(recentFive).toHaveLength(5);

    // Should be the most recent 5 messages
    expect(recentFive[4].content).toContain('19');
  });
});
