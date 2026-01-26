/**
 * Atlas Desktop - Clipboard History Component
 *
 * UI for viewing and managing clipboard history.
 * Supports search, pinning, and quick paste functionality.
 *
 * @module renderer/components/ClipboardHistory
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import './ClipboardHistory.css';

// ============================================================================
// Types
// ============================================================================

/**
 * Clipboard entry type (matches main process)
 */
interface ClipboardEntry {
  id: string;
  type: 'text' | 'image' | 'html' | 'rtf';
  text?: string;
  html?: string;
  imageBase64?: string;
  imageSize?: { width: number; height: number };
  preview: string;
  timestamp: number;
  pinned: boolean;
  sourceApp?: string;
  size: number;
  isSensitive: boolean;
}

/**
 * Clipboard stats
 */
interface ClipboardStats {
  totalEntries: number;
  pinnedEntries: number;
  textEntries: number;
  imageEntries: number;
  totalSize: number;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Format timestamp to relative time
 */
function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;

  return new Date(timestamp).toLocaleDateString();
}

/**
 * Format file size
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Get content type icon
 */
function getTypeIcon(type: string): string {
  switch (type) {
    case 'image':
      return '\u{1F4F7}'; // camera
    case 'html':
      return '\u{1F310}'; // globe
    default:
      return '\u{1F4DD}'; // memo
  }
}

// ============================================================================
// Subcomponents
// ============================================================================

interface ClipboardEntryItemProps {
  entry: ClipboardEntry;
  index: number;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onPaste: (id: string) => void;
  onPin: (id: string) => void;
  onDelete: (id: string) => void;
  onDoubleClick: (id: string) => void;
}

const ClipboardEntryItem: React.FC<ClipboardEntryItemProps> = ({
  entry,
  index,
  isSelected,
  onSelect,
  onPaste,
  onPin,
  onDelete,
  onDoubleClick,
}) => {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      onPaste(entry.id);
    } else if (e.key === 'p' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onPin(entry.id);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      if (!entry.pinned) {
        onDelete(entry.id);
      }
    }
  };

  return (
    <div
      className={`clipboard-entry ${isSelected ? 'selected' : ''} ${entry.pinned ? 'pinned' : ''}`}
      onClick={() => onSelect(entry.id)}
      onDoubleClick={() => onDoubleClick(entry.id)}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="listitem"
      aria-selected={isSelected}
    >
      {/* Index badge */}
      <div className="entry-index">{index}</div>

      {/* Content preview */}
      <div className="entry-content">
        {entry.type === 'image' && entry.imageBase64 ? (
          <div className="entry-image-preview">
            <img
              src={`data:image/png;base64,${entry.imageBase64}`}
              alt={`Clipboard image ${entry.imageSize?.width}x${entry.imageSize?.height}`}
            />
          </div>
        ) : (
          <div className="entry-text-preview">
            <span className="entry-type-icon">{getTypeIcon(entry.type)}</span>
            <span className="entry-preview-text">{entry.preview}</span>
          </div>
        )}
      </div>

      {/* Metadata */}
      <div className="entry-meta">
        <span className="entry-time">{formatRelativeTime(entry.timestamp)}</span>
        <span className="entry-size">{formatSize(entry.size)}</span>
      </div>

      {/* Actions */}
      <div className="entry-actions">
        <button
          className={`entry-action-btn pin-btn ${entry.pinned ? 'active' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            onPin(entry.id);
          }}
          title={entry.pinned ? 'Unpin (Ctrl+P)' : 'Pin (Ctrl+P)'}
          aria-label={entry.pinned ? 'Unpin item' : 'Pin item'}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill={entry.pinned ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="12" y1="17" x2="12" y2="22" />
            <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z" />
          </svg>
        </button>

        <button
          className="entry-action-btn paste-btn"
          onClick={(e) => {
            e.stopPropagation();
            onPaste(entry.id);
          }}
          title="Paste (Enter)"
          aria-label="Paste to clipboard"
        >
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
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        </button>

        {!entry.pinned && (
          <button
            className="entry-action-btn delete-btn"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(entry.id);
            }}
            title="Delete"
            aria-label="Delete item"
          >
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
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
              <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
};

// ============================================================================
// Main Component
// ============================================================================

interface ClipboardHistoryProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ClipboardHistory: React.FC<ClipboardHistoryProps> = ({ isOpen, onClose }) => {
  // State
  const [entries, setEntries] = useState<ClipboardEntry[]>([]);
  const [stats, setStats] = useState<ClipboardStats | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_selectedIndex, setSelectedIndex] = useState(0);
  const [filterType, setFilterType] = useState<'all' | 'text' | 'image'>('all');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refs
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Load clipboard history
  const loadHistory = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await window.atlas?.invoke<{
        success: boolean;
        data?: { entries: ClipboardEntry[]; stats: ClipboardStats };
        error?: string;
      }>('clipboard:get-history', {
        search: searchQuery,
        type: filterType === 'all' ? undefined : filterType,
      });

      if (result?.success && result.data) {
        setEntries(result.data.entries);
        setStats(result.data.stats);

        // Select first item if none selected
        if (result.data.entries.length > 0 && !selectedId) {
          setSelectedId(result.data.entries[0].id);
          setSelectedIndex(0);
        }
      } else {
        setError(result?.error || 'Failed to load clipboard history');
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, [searchQuery, filterType, selectedId]);

  // Load on open
  useEffect(() => {
    if (isOpen) {
      loadHistory();
      // Focus search input
      setTimeout(() => searchInputRef.current?.focus(), 100);
    }
  }, [isOpen, loadHistory]);

  // Listen for clipboard changes
  useEffect(() => {
    if (!isOpen) return;

    const unsubscribe = window.atlas?.on('atlas:clipboard-changed', () => {
      loadHistory();
    });

    return () => unsubscribe?.();
  }, [isOpen, loadHistory]);

  // Handle paste
  const handlePaste = useCallback(
    async (id: string) => {
      try {
        const result = await window.atlas?.invoke<{ success: boolean; error?: string }>(
          'clipboard:paste',
          id
        );

        if (result?.success) {
          onClose();
        } else {
          setError(result?.error || 'Failed to paste');
        }
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [onClose]
  );

  // Handle pin toggle
  const handlePin = useCallback(
    async (id: string) => {
      try {
        const result = await window.atlas?.invoke<{ success: boolean; error?: string }>(
          'clipboard:toggle-pin',
          id
        );

        if (result?.success) {
          loadHistory();
        }
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [loadHistory]
  );

  // Handle delete
  const handleDelete = useCallback(
    async (id: string) => {
      try {
        const result = await window.atlas?.invoke<{ success: boolean; error?: string }>(
          'clipboard:remove',
          id
        );

        if (result?.success) {
          loadHistory();
        }
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [loadHistory]
  );

  // Handle clear all
  const handleClearAll = useCallback(async () => {
    if (!window.confirm('Clear all non-pinned clipboard history?')) {
      return;
    }

    try {
      const result = await window.atlas?.invoke<{ success: boolean; error?: string }>(
        'clipboard:clear'
      );

      if (result?.success) {
        loadHistory();
      }
    } catch (err) {
      setError((err as Error).message);
    }
  }, [loadHistory]);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (entries.length === 0) return;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) => {
            const next = Math.min(prev + 1, entries.length - 1);
            setSelectedId(entries[next].id);
            return next;
          });
          break;

        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) => {
            const next = Math.max(prev - 1, 0);
            setSelectedId(entries[next].id);
            return next;
          });
          break;

        case 'Enter':
          e.preventDefault();
          if (selectedId) {
            handlePaste(selectedId);
          }
          break;

        case 'Escape':
          e.preventDefault();
          onClose();
          break;

        case '1':
        case '2':
        case '3':
        case '4':
        case '5':
        case '6':
        case '7':
        case '8':
        case '9':
          // Quick paste by number
          if (!e.metaKey && !e.ctrlKey && !e.altKey) {
            const index = parseInt(e.key) - 1;
            if (index < entries.length) {
              handlePaste(entries[index].id);
            }
          }
          break;
      }
    },
    [entries, selectedId, handlePaste, onClose]
  );

  // Handle select
  const handleSelect = useCallback(
    (id: string) => {
      setSelectedId(id);
      const index = entries.findIndex((e) => e.id === id);
      if (index !== -1) {
        setSelectedIndex(index);
      }
    },
    [entries]
  );

  // Handle double click (paste)
  const handleDoubleClick = useCallback(
    (id: string) => {
      handlePaste(id);
    },
    [handlePaste]
  );

  // Don't render if not open
  if (!isOpen) return null;

  return (
    <div className="clipboard-history-overlay" onClick={onClose}>
      <div
        className="clipboard-history-panel"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        role="dialog"
        aria-label="Clipboard History"
      >
        {/* Header */}
        <div className="clipboard-header">
          <h2 className="clipboard-title">Clipboard History</h2>
          <button className="clipboard-close" onClick={onClose} aria-label="Close">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Search and filters */}
        <div className="clipboard-toolbar">
          <div className="clipboard-search">
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
              className="search-icon"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search clipboard history..."
              className="search-input"
            />
            {searchQuery && (
              <button
                className="search-clear"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
              >
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
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
          </div>

          <div className="clipboard-filters">
            <button
              className={`filter-btn ${filterType === 'all' ? 'active' : ''}`}
              onClick={() => setFilterType('all')}
            >
              All
            </button>
            <button
              className={`filter-btn ${filterType === 'text' ? 'active' : ''}`}
              onClick={() => setFilterType('text')}
            >
              Text
            </button>
            <button
              className={`filter-btn ${filterType === 'image' ? 'active' : ''}`}
              onClick={() => setFilterType('image')}
            >
              Images
            </button>
          </div>
        </div>

        {/* Stats bar */}
        {stats && (
          <div className="clipboard-stats">
            <span>{stats.totalEntries} items</span>
            <span className="stat-separator">|</span>
            <span>{stats.pinnedEntries} pinned</span>
            <span className="stat-separator">|</span>
            <span>{formatSize(stats.totalSize)}</span>
          </div>
        )}

        {/* Content */}
        <div className="clipboard-content" ref={listRef} role="list">
          {isLoading ? (
            <div className="clipboard-loading">
              <div className="loading-spinner" />
              <span>Loading clipboard history...</span>
            </div>
          ) : error ? (
            <div className="clipboard-error">
              <span className="error-icon">!</span>
              <span>{error}</span>
              <button onClick={loadHistory}>Retry</button>
            </div>
          ) : entries.length === 0 ? (
            <div className="clipboard-empty">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="48"
                height="48"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              <p>{searchQuery ? 'No items match your search' : 'Clipboard history is empty'}</p>
              <span className="empty-hint">Copy something to start building history</span>
            </div>
          ) : (
            entries.map((entry, index) => (
              <ClipboardEntryItem
                key={entry.id}
                entry={entry}
                index={index + 1}
                isSelected={entry.id === selectedId}
                onSelect={handleSelect}
                onPaste={handlePaste}
                onPin={handlePin}
                onDelete={handleDelete}
                onDoubleClick={handleDoubleClick}
              />
            ))
          )}
        </div>

        {/* Footer */}
        <div className="clipboard-footer">
          <div className="footer-shortcuts">
            <span className="shortcut">
              <kbd>1</kbd>-<kbd>9</kbd> Quick paste
            </span>
            <span className="shortcut">
              <kbd>Enter</kbd> Paste selected
            </span>
            <span className="shortcut">
              <kbd>Esc</kbd> Close
            </span>
          </div>
          <button
            className="clear-all-btn"
            onClick={handleClearAll}
            disabled={entries.filter((e) => !e.pinned).length === 0}
          >
            Clear All
          </button>
        </div>
      </div>
    </div>
  );
};

export default ClipboardHistory;
