/**
 * Atlas Desktop - Transcript Store
 * Zustand store for managing conversation transcript state
 */

import { create } from 'zustand';
import { subscribeWithSelector, persist } from 'zustand/middleware';

/**
 * Transcript message entry
 */
export interface TranscriptMessage {
  /** Unique message identifier */
  id: string;
  /** Message sender role */
  role: 'user' | 'assistant' | 'system';
  /** Message content */
  content: string;
  /** Unix timestamp in milliseconds */
  timestamp: number;
  /** Whether this is an interim (in-progress) transcription */
  isInterim?: boolean;
  /** Optional metadata (e.g., tool calls, confidence score) */
  metadata?: Record<string, unknown>;
}

/**
 * Transcript session grouping
 */
export interface TranscriptSession {
  /** Session identifier */
  id: string;
  /** Session start timestamp */
  startTime: number;
  /** Session end timestamp (null if active) */
  endTime: number | null;
  /** Messages in this session */
  messages: TranscriptMessage[];
  /** Session title (auto-generated or user-defined) */
  title: string;
}

/**
 * Export format options
 */
export type ExportFormat = 'text' | 'markdown' | 'json';

/**
 * Transcript store state
 */
interface TranscriptStore {
  // State
  /** All messages in the current session */
  messages: TranscriptMessage[];
  /** Current active session */
  currentSession: TranscriptSession | null;
  /** Archived sessions */
  archivedSessions: TranscriptSession[];
  /** Search query string */
  searchQuery: string;
  /** Filtered message IDs based on search */
  filteredMessageIds: Set<string>;
  /** Currently selected message ID */
  selectedMessageId: string | null;
  /** Whether transcript panel is visible */
  isVisible: boolean;
  /** Whether panel is expanded (full width) */
  isExpanded: boolean;
  /** Auto-scroll enabled */
  autoScroll: boolean;

  // Actions - Messages
  /** Add a new message to the transcript */
  addMessage: (message: Omit<TranscriptMessage, 'id' | 'timestamp'>) => string;
  /** Update an existing message */
  updateMessage: (id: string, updates: Partial<Omit<TranscriptMessage, 'id'>>) => void;
  /** Delete a message by ID */
  deleteMessage: (id: string) => void;
  /** Clear all messages in current session */
  clearMessages: () => void;

  // Actions - Session Management
  /** Start a new session */
  startSession: (title?: string) => void;
  /** End and archive the current session */
  endSession: () => void;
  /** Load a session from archive */
  loadSession: (sessionId: string) => void;
  /** Delete an archived session */
  deleteSession: (sessionId: string) => void;
  /** Update session title */
  updateSessionTitle: (sessionId: string, title: string) => void;

  // Actions - Search
  /** Set search query and filter messages */
  setSearchQuery: (query: string) => void;
  /** Clear search */
  clearSearch: () => void;

  // Actions - Selection & Navigation
  /** Select a message by ID */
  selectMessage: (id: string | null) => void;
  /** Select next message */
  selectNextMessage: () => void;
  /** Select previous message */
  selectPreviousMessage: () => void;

  // Actions - UI State
  /** Toggle transcript visibility */
  toggleVisibility: () => void;
  /** Set visibility explicitly */
  setVisible: (visible: boolean) => void;
  /** Toggle expanded mode */
  toggleExpanded: () => void;
  /** Toggle auto-scroll */
  toggleAutoScroll: () => void;

  // Actions - Export
  /** Copy a single message to clipboard */
  copyMessage: (id: string) => Promise<boolean>;
  /** Copy all messages to clipboard */
  copyAllMessages: () => Promise<boolean>;
  /** Export transcript in specified format */
  exportTranscript: (format: ExportFormat, sessionId?: string) => string;

  // Selectors
  /** Get messages filtered by search query */
  getFilteredMessages: () => TranscriptMessage[];
  /** Get message by ID */
  getMessageById: (id: string) => TranscriptMessage | undefined;
  /** Get messages by role */
  getMessagesByRole: (role: TranscriptMessage['role']) => TranscriptMessage[];
  /** Get total message count */
  getMessageCount: () => number;
  /** Get session duration in ms */
  getSessionDuration: () => number;
}

/**
 * Generate unique message ID
 */
function generateId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Generate session ID
 */
function generateSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
}

/**
 * Format timestamp for display
 */
export function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

/**
 * Format date for session headers
 */
export function formatSessionDate(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Format message for export
 */
function formatMessageForExport(msg: TranscriptMessage, format: ExportFormat): string {
  const time = formatTimestamp(msg.timestamp);
  const role = msg.role === 'assistant' ? 'Atlas' : msg.role === 'user' ? 'You' : 'System';

  switch (format) {
    case 'markdown':
      return `**[${time}] ${role}:**\n${msg.content}\n`;
    case 'text':
      return `[${time}] ${role}: ${msg.content}`;
    case 'json':
      return JSON.stringify(msg, null, 2);
    default:
      return `[${time}] ${role}: ${msg.content}`;
  }
}

/**
 * Search messages by query
 */
function searchMessages(messages: TranscriptMessage[], query: string): Set<string> {
  if (!query.trim()) {
    return new Set(messages.map((m) => m.id));
  }

  const lowerQuery = query.toLowerCase();
  const matchingIds = new Set<string>();

  for (const message of messages) {
    if (message.content.toLowerCase().includes(lowerQuery)) {
      matchingIds.add(message.id);
    }
  }

  return matchingIds;
}

/**
 * Auto-generate session title from first user message
 */
function generateSessionTitle(messages: TranscriptMessage[]): string {
  const firstUserMessage = messages.find((m) => m.role === 'user');
  if (firstUserMessage) {
    const content = firstUserMessage.content;
    // Truncate to first 50 chars or first sentence
    const firstSentence = content.split(/[.!?]/)[0];
    if (firstSentence.length <= 50) {
      return firstSentence;
    }
    return content.substring(0, 47) + '...';
  }
  return `Session ${formatSessionDate(Date.now())}`;
}

/**
 * Transcript Zustand store
 */
export const useTranscriptStore = create<TranscriptStore>()(
  subscribeWithSelector(
    persist(
      (set, get) => ({
        // Initial state
        messages: [],
        currentSession: null,
        archivedSessions: [],
        searchQuery: '',
        filteredMessageIds: new Set<string>(),
        selectedMessageId: null,
        isVisible: false,
        isExpanded: false,
        autoScroll: true,

        // Message actions
        addMessage: (message) => {
          const id = generateId();
          const newMessage: TranscriptMessage = {
            ...message,
            id,
            timestamp: Date.now(),
          };

          set((state) => {
            const messages = [...state.messages, newMessage];
            const filteredMessageIds = searchMessages(messages, state.searchQuery);

            // Update current session
            let currentSession = state.currentSession;
            if (!currentSession) {
              currentSession = {
                id: generateSessionId(),
                startTime: Date.now(),
                endTime: null,
                messages: [],
                title: 'New Session',
              };
            }
            currentSession = {
              ...currentSession,
              messages: [...currentSession.messages, newMessage],
            };

            return { messages, filteredMessageIds, currentSession };
          });

          return id;
        },

        updateMessage: (id, updates) => {
          set((state) => {
            const messages = state.messages.map((msg) =>
              msg.id === id ? { ...msg, ...updates } : msg
            );
            const filteredMessageIds = searchMessages(messages, state.searchQuery);

            // Update current session
            let currentSession = state.currentSession;
            if (currentSession) {
              currentSession = {
                ...currentSession,
                messages: currentSession.messages.map((msg) =>
                  msg.id === id ? { ...msg, ...updates } : msg
                ),
              };
            }

            return { messages, filteredMessageIds, currentSession };
          });
        },

        deleteMessage: (id) => {
          set((state) => {
            const messages = state.messages.filter((msg) => msg.id !== id);
            const filteredMessageIds = searchMessages(messages, state.searchQuery);
            const selectedMessageId =
              state.selectedMessageId === id ? null : state.selectedMessageId;

            // Update current session
            let currentSession = state.currentSession;
            if (currentSession) {
              currentSession = {
                ...currentSession,
                messages: currentSession.messages.filter((msg) => msg.id !== id),
              };
            }

            return { messages, filteredMessageIds, selectedMessageId, currentSession };
          });
        },

        clearMessages: () => {
          set({
            messages: [],
            filteredMessageIds: new Set<string>(),
            selectedMessageId: null,
            currentSession: null,
          });
        },

        // Session management
        startSession: (title) => {
          const session: TranscriptSession = {
            id: generateSessionId(),
            startTime: Date.now(),
            endTime: null,
            messages: [],
            title: title || 'New Session',
          };

          set({
            currentSession: session,
            messages: [],
            filteredMessageIds: new Set<string>(),
            selectedMessageId: null,
          });
        },

        endSession: () => {
          const state = get();
          if (!state.currentSession || state.currentSession.messages.length === 0) {
            return;
          }

          const endedSession: TranscriptSession = {
            ...state.currentSession,
            endTime: Date.now(),
            title:
              state.currentSession.title === 'New Session'
                ? generateSessionTitle(state.currentSession.messages)
                : state.currentSession.title,
          };

          set((s) => ({
            archivedSessions: [endedSession, ...s.archivedSessions].slice(0, 100), // Keep last 100 sessions
            currentSession: null,
            messages: [],
            filteredMessageIds: new Set<string>(),
            selectedMessageId: null,
          }));
        },

        loadSession: (sessionId) => {
          const state = get();
          const session = state.archivedSessions.find((s) => s.id === sessionId);
          if (!session) return;

          set({
            messages: [...session.messages],
            filteredMessageIds: searchMessages(session.messages, state.searchQuery),
            selectedMessageId: null,
          });
        },

        deleteSession: (sessionId) => {
          set((state) => ({
            archivedSessions: state.archivedSessions.filter((s) => s.id !== sessionId),
          }));
        },

        updateSessionTitle: (sessionId, title) => {
          set((state) => ({
            archivedSessions: state.archivedSessions.map((s) =>
              s.id === sessionId ? { ...s, title } : s
            ),
            currentSession:
              state.currentSession?.id === sessionId
                ? { ...state.currentSession, title }
                : state.currentSession,
          }));
        },

        // Search actions
        setSearchQuery: (query) => {
          const state = get();
          const filteredMessageIds = searchMessages(state.messages, query);
          set({ searchQuery: query, filteredMessageIds });
        },

        clearSearch: () => {
          const state = get();
          set({
            searchQuery: '',
            filteredMessageIds: new Set(state.messages.map((m) => m.id)),
          });
        },

        // Selection & navigation
        selectMessage: (id) => {
          set({ selectedMessageId: id });
        },

        selectNextMessage: () => {
          const state = get();
          const filtered = state.getFilteredMessages();
          if (filtered.length === 0) return;

          const currentIndex = state.selectedMessageId
            ? filtered.findIndex((m) => m.id === state.selectedMessageId)
            : -1;

          const nextIndex = currentIndex < filtered.length - 1 ? currentIndex + 1 : 0;
          set({ selectedMessageId: filtered[nextIndex].id });
        },

        selectPreviousMessage: () => {
          const state = get();
          const filtered = state.getFilteredMessages();
          if (filtered.length === 0) return;

          const currentIndex = state.selectedMessageId
            ? filtered.findIndex((m) => m.id === state.selectedMessageId)
            : filtered.length;

          const prevIndex = currentIndex > 0 ? currentIndex - 1 : filtered.length - 1;
          set({ selectedMessageId: filtered[prevIndex].id });
        },

        // UI state actions
        toggleVisibility: () => {
          set((state) => ({ isVisible: !state.isVisible }));
        },

        setVisible: (visible) => {
          set({ isVisible: visible });
        },

        toggleExpanded: () => {
          set((state) => ({ isExpanded: !state.isExpanded }));
        },

        toggleAutoScroll: () => {
          set((state) => ({ autoScroll: !state.autoScroll }));
        },

        // Export actions
        copyMessage: async (id) => {
          const state = get();
          const message = state.messages.find((m) => m.id === id);
          if (!message) return false;

          try {
            await navigator.clipboard.writeText(message.content);
            return true;
          } catch (err) {
            console.error('[TranscriptStore] Failed to copy message:', err);
            return false;
          }
        },

        copyAllMessages: async () => {
          const state = get();
          const text = state.messages
            .map((msg) => formatMessageForExport(msg, 'text'))
            .join('\n\n');

          try {
            await navigator.clipboard.writeText(text);
            return true;
          } catch (err) {
            console.error('[TranscriptStore] Failed to copy transcript:', err);
            return false;
          }
        },

        exportTranscript: (format, sessionId) => {
          const state = get();
          let messages = state.messages;

          // If sessionId provided, get messages from that session
          if (sessionId) {
            const session = state.archivedSessions.find((s) => s.id === sessionId);
            if (session) {
              messages = session.messages;
            }
          }

          if (format === 'json') {
            return JSON.stringify(
              {
                exportedAt: new Date().toISOString(),
                messageCount: messages.length,
                messages,
              },
              null,
              2
            );
          }

          const header =
            format === 'markdown'
              ? `# Atlas Transcript\n\n*Exported: ${new Date().toLocaleString()}*\n\n---\n\n`
              : `Atlas Transcript\nExported: ${new Date().toLocaleString()}\n${'='.repeat(50)}\n\n`;

          const body = messages.map((msg) => formatMessageForExport(msg, format)).join('\n\n');

          return header + body;
        },

        // Selectors
        getFilteredMessages: () => {
          const state = get();
          if (!state.searchQuery.trim()) {
            return state.messages;
          }
          return state.messages.filter((m) => state.filteredMessageIds.has(m.id));
        },

        getMessageById: (id) => {
          return get().messages.find((m) => m.id === id);
        },

        getMessagesByRole: (role) => {
          return get().messages.filter((m) => m.role === role);
        },

        getMessageCount: () => {
          return get().messages.length;
        },

        getSessionDuration: () => {
          const state = get();
          if (!state.currentSession) return 0;
          return Date.now() - state.currentSession.startTime;
        },
      }),
      {
        name: 'atlas-transcript',
        partialize: (state) => ({
          archivedSessions: state.archivedSessions,
          autoScroll: state.autoScroll,
        }),
      }
    )
  )
);

// Selectors for optimized re-renders
export const selectMessages = (state: TranscriptStore) => state.messages;
export const selectSearchQuery = (state: TranscriptStore) => state.searchQuery;
export const selectSelectedMessageId = (state: TranscriptStore) => state.selectedMessageId;
export const selectIsVisible = (state: TranscriptStore) => state.isVisible;
export const selectIsExpanded = (state: TranscriptStore) => state.isExpanded;
export const selectAutoScroll = (state: TranscriptStore) => state.autoScroll;
export const selectCurrentSession = (state: TranscriptStore) => state.currentSession;
export const selectArchivedSessions = (state: TranscriptStore) => state.archivedSessions;

export default useTranscriptStore;
