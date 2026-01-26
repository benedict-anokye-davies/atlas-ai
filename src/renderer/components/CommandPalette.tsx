/**
 * Atlas Desktop - Command Palette Component
 * VS Code-style command palette for quick access to all commands
 */

import React, { useEffect, useRef, useCallback } from 'react';
import { useCommandStore, type Command, type CommandCategory } from '../stores/commandStore';
import { useCommands } from '../hooks/useCommands';
import './CommandPalette.css';

/**
 * Icon component for command categories
 */
const CommandIcon: React.FC<{ category: CommandCategory; icon?: string }> = ({ category, icon }) => {
  // Map categories to default icons if no specific icon provided
  const iconMap: Record<CommandCategory, string> = {
    Voice: 'mic',
    Settings: 'settings',
    Git: 'git-branch',
    System: 'terminal',
  };

  const iconName = icon || iconMap[category];

  // Simple SVG icons
  const icons: Record<string, React.ReactNode> = {
    mic: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
        <line x1="12" y1="19" x2="12" y2="23" />
        <line x1="8" y1="23" x2="16" y2="23" />
      </svg>
    ),
    settings: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
    'git-branch': (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="6" y1="3" x2="6" y2="15" />
        <circle cx="18" cy="6" r="3" />
        <circle cx="6" cy="18" r="3" />
        <path d="M18 9a9 9 0 0 1-9 9" />
      </svg>
    ),
    terminal: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="4 17 10 11 4 5" />
        <line x1="12" y1="19" x2="20" y2="19" />
      </svg>
    ),
    play: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="5 3 19 12 5 21 5 3" />
      </svg>
    ),
    stop: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      </svg>
    ),
    trash: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="3 6 5 6 21 6" />
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      </svg>
    ),
    bug: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="8" y="6" width="8" height="14" rx="4" />
        <path d="M8 10H4" />
        <path d="M20 10h-4" />
        <path d="M8 18H4" />
        <path d="M20 18h-4" />
        <path d="M12 6V2" />
      </svg>
    ),
    message: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
    zap: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
      </svg>
    ),
    activity: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    ),
    'git-commit': (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="4" />
        <line x1="1.05" y1="12" x2="7" y2="12" />
        <line x1="17.01" y1="12" x2="22.96" y2="12" />
      </svg>
    ),
    upload: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="16 16 12 12 8 16" />
        <line x1="12" y1="12" x2="12" y2="21" />
        <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
      </svg>
    ),
    download: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="8 17 12 21 16 17" />
        <line x1="12" y1="12" x2="12" y2="21" />
        <path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.29" />
      </svg>
    ),
    refresh: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="23 4 23 10 17 10" />
        <polyline points="1 20 1 14 7 14" />
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
      </svg>
    ),
    code: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="16 18 22 12 16 6" />
        <polyline points="8 6 2 12 8 18" />
      </svg>
    ),
    minus: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="5" y1="12" x2="19" y2="12" />
      </svg>
    ),
    x: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    ),
  };

  return (
    <span className="command-icon">
      {icons[iconName] || icons.terminal}
    </span>
  );
};

/**
 * Single command item in the list
 */
interface CommandItemProps {
  command: Command;
  isSelected: boolean;
  isRecent: boolean;
  onSelect: () => void;
  onExecute: () => void;
}

const CommandItem: React.FC<CommandItemProps> = ({
  command,
  isSelected,
  isRecent,
  onSelect,
  onExecute,
}) => {
  const itemRef = useRef<HTMLDivElement>(null);

  // Scroll selected item into view
  useEffect(() => {
    if (isSelected && itemRef.current) {
      itemRef.current.scrollIntoView({
        block: 'nearest',
        behavior: 'smooth',
      });
    }
  }, [isSelected]);

  return (
    <div
      ref={itemRef}
      className={`command-item ${isSelected ? 'selected' : ''} ${command.disabled ? 'disabled' : ''}`}
      onMouseEnter={onSelect}
      onClick={onExecute}
      role="option"
      aria-selected={isSelected}
      aria-disabled={command.disabled}
    >
      <CommandIcon category={command.category} icon={command.icon} />
      <div className="command-content">
        <span className="command-label">
          {command.label}
          {isRecent && <span className="command-recent-badge">Recent</span>}
        </span>
        {command.description && (
          <span className="command-description">{command.description}</span>
        )}
      </div>
      {command.shortcut && (
        <kbd className="command-shortcut">{command.shortcut}</kbd>
      )}
    </div>
  );
};

/**
 * Command category header
 */
const CategoryHeader: React.FC<{ category: CommandCategory }> = ({ category }) => (
  <div className="command-category-header">
    {category}
  </div>
);

/**
 * Main Command Palette component
 */
export const CommandPalette: React.FC = () => {
  const { isOpen, searchQuery, selectedIndex, close, setSearchQuery, setSelectedIndex } =
    useCommandStore();
  const { filteredCommands, groupedCommands, recentCommands, hasResults, executeCommand } =
    useCommands();
  const inputRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Get set of recent command IDs
  const recentIds = new Set(recentCommands.map((c) => c.id));

  // Focus input when palette opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  // Keyboard shortcut to open palette (Ctrl+Shift+P)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Open palette with Ctrl+Shift+P
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        useCommandStore.getState().toggle();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Handle keyboard navigation within the palette
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          close();
          break;

        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex(Math.min(selectedIndex + 1, filteredCommands.length - 1));
          break;

        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex(Math.max(selectedIndex - 1, 0));
          break;

        case 'Enter':
          e.preventDefault();
          if (filteredCommands[selectedIndex]) {
            executeCommand(filteredCommands[selectedIndex].id);
          }
          break;

        case 'Tab':
          e.preventDefault();
          // Tab cycles through results
          if (e.shiftKey) {
            setSelectedIndex(
              selectedIndex > 0 ? selectedIndex - 1 : filteredCommands.length - 1
            );
          } else {
            setSelectedIndex(
              selectedIndex < filteredCommands.length - 1 ? selectedIndex + 1 : 0
            );
          }
          break;
      }
    },
    [close, selectedIndex, setSelectedIndex, filteredCommands, executeCommand]
  );

  // Close on overlay click
  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === overlayRef.current) {
        close();
      }
    },
    [close]
  );

  // Don't render if not open
  if (!isOpen) {
    return null;
  }

  // Calculate flattened index for each command
  let flatIndex = 0;

  return (
    <div
      ref={overlayRef}
      className="command-palette-overlay"
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div className="command-palette">
        {/* Search input */}
        <div className="command-search">
          <svg
            className="command-search-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            className="command-input"
            placeholder="Type a command..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck="false"
          />
          {searchQuery && (
            <button
              className="command-clear"
              onClick={() => setSearchQuery('')}
              aria-label="Clear search"
            >
              <svg
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

        {/* Results list */}
        <div className="command-results" role="listbox">
          {!hasResults ? (
            <div className="command-empty">
              No commands found for &quot;{searchQuery}&quot;
            </div>
          ) : searchQuery ? (
            // When searching, show flat list
            filteredCommands.map((command, index) => (
              <CommandItem
                key={command.id}
                command={command}
                isSelected={selectedIndex === index}
                isRecent={recentIds.has(command.id)}
                onSelect={() => setSelectedIndex(index)}
                onExecute={() => executeCommand(command.id)}
              />
            ))
          ) : (
            // When not searching, show grouped by category
            <>
              {/* Recent commands section */}
              {recentCommands.length > 0 && (
                <>
                  <div className="command-category-header">Recent</div>
                  {recentCommands.map((command) => {
                    const currentIndex = flatIndex++;
                    return (
                      <CommandItem
                        key={`recent-${command.id}`}
                        command={command}
                        isSelected={selectedIndex === currentIndex}
                        isRecent={true}
                        onSelect={() => setSelectedIndex(currentIndex)}
                        onExecute={() => executeCommand(command.id)}
                      />
                    );
                  })}
                </>
              )}

              {/* Grouped commands */}
              {groupedCommands.map((group) => (
                <React.Fragment key={group.category}>
                  <CategoryHeader category={group.category} />
                  {group.commands
                    .filter((c) => !recentIds.has(c.id) || searchQuery)
                    .map((command) => {
                      const currentIndex = flatIndex++;
                      return (
                        <CommandItem
                          key={command.id}
                          command={command}
                          isSelected={selectedIndex === currentIndex}
                          isRecent={false}
                          onSelect={() => setSelectedIndex(currentIndex)}
                          onExecute={() => executeCommand(command.id)}
                        />
                      );
                    })}
                </React.Fragment>
              ))}
            </>
          )}
        </div>

        {/* Footer with keyboard hints */}
        <div className="command-footer">
          <span className="command-hint">
            <kbd>↑</kbd><kbd>↓</kbd> Navigate
          </span>
          <span className="command-hint">
            <kbd>Enter</kbd> Execute
          </span>
          <span className="command-hint">
            <kbd>Esc</kbd> Close
          </span>
        </div>
      </div>
    </div>
  );
};

export default CommandPalette;
