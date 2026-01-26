/**
 * Atlas Desktop - Transcript View Component
 * Displays conversation history with search, copy, and export functionality
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useMemo,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import {
  useTranscriptStore,
  formatTimestamp,
  formatSessionDate,
  type TranscriptMessage,
  type ExportFormat,
} from '../stores/transcriptStore';
import { SETTINGS_VALIDATION } from '../utils/validation-constants';

// Icons as inline SVGs for self-contained component
const Icons = {
  Search: () => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  ),
  X: () => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  ),
  Copy: () => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  ),
  Check: () => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  Download: () => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" x2="12" y1="15" y2="3" />
    </svg>
  ),
  Trash: () => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
    </svg>
  ),
  Expand: () => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="15 3 21 3 21 9" />
      <polyline points="9 21 3 21 3 15" />
      <line x1="21" x2="14" y1="3" y2="10" />
      <line x1="3" x2="10" y1="21" y2="14" />
    </svg>
  ),
  Collapse: () => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="4 14 10 14 10 20" />
      <polyline points="20 10 14 10 14 4" />
      <line x1="14" x2="21" y1="10" y2="3" />
      <line x1="3" x2="10" y1="21" y2="14" />
    </svg>
  ),
  ScrollDown: () => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m7 13 5 5 5-5" />
      <path d="m7 6 5 5 5-5" />
    </svg>
  ),
  User: () => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  ),
  Bot: () => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 8V4H8" />
      <rect width="16" height="12" x="4" y="8" rx="2" />
      <path d="M2 14h2" />
      <path d="M20 14h2" />
      <path d="M15 13v2" />
      <path d="M9 13v2" />
    </svg>
  ),
  History: () => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l4 2" />
    </svg>
  ),
  ChevronDown: () => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  ),
};

/**
 * Individual message component
 */
interface MessageItemProps {
  message: TranscriptMessage;
  isSelected: boolean;
  searchQuery: string;
  onSelect: (id: string) => void;
  onCopy: (id: string) => Promise<boolean>;
  onDelete: (id: string) => void;
}

function MessageItem({
  message,
  isSelected,
  searchQuery,
  onSelect,
  onCopy,
  onDelete,
}: MessageItemProps) {
  const [copied, setCopied] = useState(false);
  const [showActions, setShowActions] = useState(false);

  // Memoize event handlers to prevent unnecessary re-renders of child components
  // and maintain stable function references across renders
  const handleCopy = useCallback(async () => {
    const success = await onCopy(message.id);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), SETTINGS_VALIDATION.COPY_SUCCESS_DISPLAY_MS);
    }
  }, [message.id, onCopy]);

  const handleDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onDelete(message.id);
    },
    [message.id, onDelete]
  );

  const handleCopyClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      handleCopy();
    },
    [handleCopy]
  );

  const handleSelect = useCallback(() => {
    onSelect(message.id);
  }, [message.id, onSelect]);

  const handleMouseEnter = useCallback(() => {
    setShowActions(true);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setShowActions(false);
  }, []);

  // Highlight search matches in content
  const highlightedContent = useMemo(() => {
    if (!searchQuery.trim()) {
      return message.content;
    }

    const parts = message.content.split(new RegExp(`(${escapeRegExp(searchQuery)})`, 'gi'));
    return parts.map((part, i) =>
      part.toLowerCase() === searchQuery.toLowerCase() ? (
        <mark key={i} className="transcript-highlight">
          {part}
        </mark>
      ) : (
        part
      )
    );
  }, [message.content, searchQuery]);

  const roleIcon =
    message.role === 'user' ? <Icons.User /> : message.role === 'assistant' ? <Icons.Bot /> : null;
  const roleLabel = message.role === 'assistant' ? 'Atlas' : message.role === 'user' ? 'You' : 'System';
  const roleClass = `transcript-message-${message.role}`;

  return (
    <div
      className={`transcript-message ${roleClass} ${isSelected ? 'selected' : ''} ${message.isInterim ? 'interim' : ''}`}
      onClick={handleSelect}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      role="listitem"
      tabIndex={0}
      aria-selected={isSelected}
    >
      <div className="transcript-message-header">
        <div className="transcript-message-role">
          {roleIcon}
          <span className="transcript-message-role-label">{roleLabel}</span>
        </div>
        <span className="transcript-message-time">{formatTimestamp(message.timestamp)}</span>
      </div>

      <div className="transcript-message-content">
        {highlightedContent}
        {message.isInterim && <span className="transcript-interim-indicator">...</span>}
      </div>

      <div className={`transcript-message-actions ${showActions ? 'visible' : ''}`}>
        <button
          className="transcript-action-btn"
          onClick={handleCopyClick}
          title="Copy message"
          aria-label="Copy message"
        >
          {copied ? <Icons.Check /> : <Icons.Copy />}
        </button>
        <button
          className="transcript-action-btn transcript-action-delete"
          onClick={handleDelete}
          title="Delete message"
          aria-label="Delete message"
        >
          <Icons.Trash />
        </button>
      </div>
    </div>
  );
}

/**
 * Escape regex special characters
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Export dropdown component
 */
interface ExportDropdownProps {
  onExport: (format: ExportFormat) => void;
  disabled: boolean;
}

function ExportDropdown({ onExport, disabled }: ExportDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleExport = (format: ExportFormat) => {
    onExport(format);
    setIsOpen(false);
  };

  return (
    <div className="transcript-export-dropdown" ref={dropdownRef}>
      <button
        className="transcript-toolbar-btn"
        onClick={() => setIsOpen(!isOpen)}
        disabled={disabled}
        title="Export transcript"
        aria-label="Export transcript"
        aria-expanded={isOpen}
      >
        <Icons.Download />
        <Icons.ChevronDown />
      </button>

      {isOpen && (
        <div className="transcript-dropdown-menu" role="menu">
          <button
            className="transcript-dropdown-item"
            onClick={() => handleExport('text')}
            role="menuitem"
          >
            Export as Text (.txt)
          </button>
          <button
            className="transcript-dropdown-item"
            onClick={() => handleExport('markdown')}
            role="menuitem"
          >
            Export as Markdown (.md)
          </button>
          <button
            className="transcript-dropdown-item"
            onClick={() => handleExport('json')}
            role="menuitem"
          >
            Export as JSON (.json)
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Session history sidebar
 */
interface SessionHistoryProps {
  onClose: () => void;
}

function SessionHistory({ onClose }: SessionHistoryProps) {
  const { archivedSessions, loadSession, deleteSession } = useTranscriptStore();

  return (
    <div className="transcript-history-panel">
      <div className="transcript-history-header">
        <h3>Session History</h3>
        <button
          className="transcript-close-btn"
          onClick={onClose}
          aria-label="Close history"
        >
          <Icons.X />
        </button>
      </div>

      <div className="transcript-history-list">
        {archivedSessions.length === 0 ? (
          <div className="transcript-history-empty">No archived sessions</div>
        ) : (
          archivedSessions.map((session) => (
            <div key={session.id} className="transcript-history-item">
              <div className="transcript-history-item-info">
                <span className="transcript-history-item-title">{session.title}</span>
                <span className="transcript-history-item-date">
                  {formatSessionDate(session.startTime)}
                </span>
                <span className="transcript-history-item-count">
                  {session.messages.length} messages
                </span>
              </div>
              <div className="transcript-history-item-actions">
                <button
                  className="transcript-history-load-btn"
                  onClick={() => {
                    loadSession(session.id);
                    onClose();
                  }}
                  title="Load session"
                >
                  Load
                </button>
                <button
                  className="transcript-history-delete-btn"
                  onClick={() => deleteSession(session.id)}
                  title="Delete session"
                >
                  <Icons.Trash />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/**
 * Main TranscriptView component
 */
export function TranscriptView() {
  const {
    messages,
    searchQuery,
    selectedMessageId,
    isVisible,
    isExpanded,
    autoScroll,
    setSearchQuery,
    clearSearch,
    selectMessage,
    selectNextMessage,
    selectPreviousMessage,
    toggleVisibility,
    toggleExpanded,
    toggleAutoScroll,
    copyMessage,
    copyAllMessages,
    deleteMessage,
    clearMessages,
    exportTranscript,
    getFilteredMessages,
    getMessageCount,
  } = useTranscriptStore();

  const [showHistory, setShowHistory] = useState(false);
  const [copyAllSuccess, setCopyAllSuccess] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const filteredMessages = getFilteredMessages();
  const messageCount = getMessageCount();

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (autoScroll && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, autoScroll]);

  // Keyboard navigation
  useEffect(() => {
    if (!isVisible) return;

    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      // Ignore if typing in search input
      if (document.activeElement === searchInputRef.current) {
        if (e.key === 'Escape') {
          clearSearch();
          searchInputRef.current?.blur();
        }
        return;
      }

      switch (e.key) {
        case 'j':
        case 'ArrowDown':
          e.preventDefault();
          selectNextMessage();
          break;
        case 'k':
        case 'ArrowUp':
          e.preventDefault();
          selectPreviousMessage();
          break;
        case '/':
          e.preventDefault();
          searchInputRef.current?.focus();
          break;
        case 'Escape':
          if (selectedMessageId) {
            selectMessage(null);
          } else if (searchQuery) {
            clearSearch();
          } else {
            toggleVisibility();
          }
          break;
        case 'c':
          if ((e.metaKey || e.ctrlKey) && selectedMessageId) {
            e.preventDefault();
            copyMessage(selectedMessageId);
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    isVisible,
    selectedMessageId,
    searchQuery,
    selectNextMessage,
    selectPreviousMessage,
    selectMessage,
    clearSearch,
    toggleVisibility,
    copyMessage,
  ]);

  // Handle copy all
  const handleCopyAll = useCallback(async () => {
    const success = await copyAllMessages();
    if (success) {
      setCopyAllSuccess(true);
      setTimeout(() => setCopyAllSuccess(false), SETTINGS_VALIDATION.COPY_SUCCESS_DISPLAY_MS);
    }
  }, [copyAllMessages]);

  // Handle export
  const handleExport = useCallback(
    (format: ExportFormat) => {
      const content = exportTranscript(format);
      const extension = format === 'markdown' ? 'md' : format;
      const mimeType =
        format === 'json' ? 'application/json' : format === 'markdown' ? 'text/markdown' : 'text/plain';

      // Create download
      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `atlas-transcript-${new Date().toISOString().slice(0, 10)}.${extension}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    },
    [exportTranscript]
  );

  // Handle clear with confirmation
  const handleClear = useCallback(() => {
    if (messageCount > 0 && window.confirm('Clear all messages in current session?')) {
      clearMessages();
    }
  }, [messageCount, clearMessages]);

  // Handle search input
  const handleSearchKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      // Select first match if any
      if (filteredMessages.length > 0 && !selectedMessageId) {
        selectMessage(filteredMessages[0].id);
      }
    }
  };

  if (!isVisible) {
    return null;
  }

  return (
    <div
      className={`transcript-view ${isExpanded ? 'expanded' : ''}`}
      ref={containerRef}
      role="region"
      aria-label="Conversation transcript"
    >
      {/* Header */}
      <div className="transcript-header">
        <div className="transcript-title">
          <h2>Transcript</h2>
          <span className="transcript-count">{messageCount} messages</span>
        </div>

        <div className="transcript-header-actions">
          <button
            className="transcript-toolbar-btn"
            onClick={() => setShowHistory(!showHistory)}
            title="Session history"
            aria-label="Session history"
          >
            <Icons.History />
          </button>
          <button
            className="transcript-toolbar-btn"
            onClick={toggleExpanded}
            title={isExpanded ? 'Collapse' : 'Expand'}
            aria-label={isExpanded ? 'Collapse panel' : 'Expand panel'}
          >
            {isExpanded ? <Icons.Collapse /> : <Icons.Expand />}
          </button>
          <button
            className="transcript-close-btn"
            onClick={toggleVisibility}
            title="Close transcript"
            aria-label="Close transcript"
          >
            <Icons.X />
          </button>
        </div>
      </div>

      {/* Session history sidebar */}
      {showHistory && <SessionHistory onClose={() => setShowHistory(false)} />}

      {/* Search bar */}
      <div className="transcript-search">
        <div className="transcript-search-input-wrapper">
          <Icons.Search />
          <input
            ref={searchInputRef}
            type="text"
            className="transcript-search-input"
            placeholder="Search transcript... (press /)"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            aria-label="Search transcript"
          />
          {searchQuery && (
            <button
              className="transcript-search-clear"
              onClick={clearSearch}
              aria-label="Clear search"
            >
              <Icons.X />
            </button>
          )}
        </div>
        {searchQuery && (
          <span className="transcript-search-results">
            {filteredMessages.length} of {messageCount} matches
          </span>
        )}
      </div>

      {/* Toolbar */}
      <div className="transcript-toolbar">
        <div className="transcript-toolbar-left">
          <button
            className={`transcript-toolbar-btn ${autoScroll ? 'active' : ''}`}
            onClick={toggleAutoScroll}
            title={autoScroll ? 'Auto-scroll enabled' : 'Auto-scroll disabled'}
            aria-label="Toggle auto-scroll"
            aria-pressed={autoScroll}
          >
            <Icons.ScrollDown />
          </button>
        </div>

        <div className="transcript-toolbar-right">
          <button
            className="transcript-toolbar-btn"
            onClick={handleCopyAll}
            disabled={messageCount === 0}
            title="Copy all messages"
            aria-label="Copy all messages"
          >
            {copyAllSuccess ? <Icons.Check /> : <Icons.Copy />}
          </button>
          <ExportDropdown onExport={handleExport} disabled={messageCount === 0} />
          <button
            className="transcript-toolbar-btn transcript-toolbar-delete"
            onClick={handleClear}
            disabled={messageCount === 0}
            title="Clear transcript"
            aria-label="Clear transcript"
          >
            <Icons.Trash />
          </button>
        </div>
      </div>

      {/* Messages list */}
      <div className="transcript-messages" role="list" aria-label="Messages">
        {filteredMessages.length === 0 ? (
          <div className="transcript-empty">
            {searchQuery ? (
              <p>No messages match your search.</p>
            ) : (
              <p>No messages yet. Start a conversation to see the transcript.</p>
            )}
          </div>
        ) : (
          <>
            {filteredMessages.map((message) => (
              <MessageItem
                key={message.id}
                message={message}
                isSelected={message.id === selectedMessageId}
                searchQuery={searchQuery}
                onSelect={selectMessage}
                onCopy={copyMessage}
                onDelete={deleteMessage}
              />
            ))}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Keyboard shortcuts hint */}
      <div className="transcript-footer">
        <span className="transcript-shortcuts">
          <kbd>j</kbd>/<kbd>k</kbd> navigate <kbd>/</kbd> search <kbd>Esc</kbd> close
        </span>
      </div>
    </div>
  );
}

export default TranscriptView;
