/**
 * Atlas Desktop - Enhanced Command Palette
 * Fuzzy search, aliases, command chaining, and workflow support
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import './CommandPaletteEnhanced.css';

// ============================================================================
// Types
// ============================================================================

export type CommandCategory = 
  | 'Voice' 
  | 'System' 
  | 'Git' 
  | 'Settings' 
  | 'Navigation'
  | 'Workflow'
  | 'Quick Actions'
  | 'Media'
  | 'Tools';

export interface Command {
  id: string;
  label: string;
  description?: string;
  category: CommandCategory;
  icon?: string;
  shortcut?: string;
  aliases?: string[];
  execute: () => void | Promise<void> | Promise<unknown>;
  disabled?: boolean;
  when?: () => boolean;
}

export interface CommandAlias {
  alias: string;
  commandId: string;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  commands: string[];
  icon?: string;
}

interface EnhancedCommandPaletteProps {
  isVisible: boolean;
  onClose: () => void;
}

// ============================================================================
// Icons
// ============================================================================

const SearchIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

const XIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const MicIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <line x1="12" y1="19" x2="12" y2="23" />
    <line x1="8" y1="23" x2="16" y2="23" />
  </svg>
);

const SettingsIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

const GitBranchIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="6" y1="3" x2="6" y2="15" />
    <circle cx="18" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <path d="M18 9a9 9 0 0 1-9 9" />
  </svg>
);

const TerminalIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="4 17 10 11 4 5" />
    <line x1="12" y1="19" x2="20" y2="19" />
  </svg>
);

const ZapIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </svg>
);

const LayersIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polygon points="12 2 2 7 12 12 22 7 12 2" />
    <polyline points="2 17 12 22 22 17" />
    <polyline points="2 12 12 17 22 12" />
  </svg>
);

const MusicIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M9 18V5l12-2v13" />
    <circle cx="6" cy="18" r="3" />
    <circle cx="18" cy="16" r="3" />
  </svg>
);

const ToolIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
  </svg>
);

const CompassIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="10" />
    <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
  </svg>
);

const PlayIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polygon points="5 3 19 12 5 21 5 3" />
  </svg>
);

const ChevronRightIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

const ClockIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);

const StarIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
);

// ============================================================================
// Enhanced Fuzzy Search with Typo Tolerance
// ============================================================================

/**
 * Calculate the Levenshtein edit distance between two strings
 * Returns the minimum number of edits needed to transform one string into another
 */
function levenshteinDistance(s1: string, s2: string): number {
  const m = s1.length;
  const n = s2.length;
  
  // Create a 2D array for dynamic programming
  const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
  
  // Initialize first column
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  // Initialize first row
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  
  // Fill the table
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (s1[i - 1] === s2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(
          dp[i - 1][j],     // deletion
          dp[i][j - 1],     // insertion
          dp[i - 1][j - 1]  // substitution
        );
      }
    }
  }
  
  return dp[m][n];
}

/**
 * Check if query matches text with typo tolerance
 * Allows up to maxTypos character differences
 */
function fuzzyMatchWithTypos(text: string, query: string, maxTypos: number = 2): { match: boolean; score: number } {
  const textLower = text.toLowerCase();
  const queryLower = query.toLowerCase();
  
  // If query is short, be strict about typos
  const allowedTypos = query.length <= 3 ? 0 : Math.min(maxTypos, Math.floor(query.length / 3));
  
  // Check whole words
  const words = textLower.split(/[\s\-_]/);
  for (const word of words) {
    const distance = levenshteinDistance(word, queryLower);
    if (distance <= allowedTypos) {
      // Found a matching word with acceptable typos
      // Score decreases with more typos
      return { match: true, score: 60 - (distance * 15) };
    }
  }
  
  // Check if query is a substring with typos
  for (let i = 0; i <= textLower.length - queryLower.length; i++) {
    const substring = textLower.substring(i, i + queryLower.length);
    const distance = levenshteinDistance(substring, queryLower);
    if (distance <= allowedTypos) {
      return { match: true, score: 50 - (distance * 12) };
    }
  }
  
  return { match: false, score: 0 };
}

/**
 * Enhanced fuzzy match with multiple matching strategies
 * 1. Exact prefix match (highest score)
 * 2. Exact substring match
 * 3. Acronym/initials match (e.g., "gs" -> "Git Status")
 * 4. Fuzzy character sequence match
 * 5. Typo-tolerant match (lowest score)
 */
function fuzzyMatch(text: string, query: string): { match: boolean; score: number; ranges: [number, number][] } {
  if (!query) return { match: true, score: 0, ranges: [] };
  
  const textLower = text.toLowerCase();
  const queryLower = query.toLowerCase();
  
  // Strategy 1: Exact prefix match (highest priority)
  if (textLower.startsWith(queryLower)) {
    return {
      match: true,
      score: 150 + (query.length / text.length) * 50,
      ranges: [[0, query.length - 1]],
    };
  }
  
  // Strategy 2: Exact substring match
  const exactIndex = textLower.indexOf(queryLower);
  if (exactIndex !== -1) {
    // Bonus if match is at word boundary
    const atWordBoundary = exactIndex === 0 || /[\s\-_]/.test(text[exactIndex - 1]);
    return {
      match: true,
      score: 100 + (query.length / text.length) * 50 + (atWordBoundary ? 20 : 0),
      ranges: [[exactIndex, exactIndex + query.length - 1]],
    };
  }
  
  // Strategy 3: Acronym/initials match (e.g., "gs" -> "Git Status", "cp" -> "Command Palette")
  const words = text.split(/[\s\-_]+/);
  if (words.length >= query.length) {
    const initials = words.map(w => w[0]?.toLowerCase()).join('');
    if (initials.includes(queryLower)) {
      const initialsIndex = initials.indexOf(queryLower);
      const ranges: [number, number][] = [];
      let charIndex = 0;
      
      for (let w = 0; w < words.length; w++) {
        if (w >= initialsIndex && w < initialsIndex + query.length) {
          ranges.push([charIndex, charIndex]);
        }
        charIndex += words[w].length + 1; // +1 for space
      }
      
      return {
        match: true,
        score: 80 + (query.length / words.length) * 30,
        ranges,
      };
    }
  }
  
  // Strategy 4: Fuzzy character sequence match
  let queryIndex = 0;
  let score = 0;
  const ranges: [number, number][] = [];
  let rangeStart = -1;
  let prevMatchIndex = -1;
  let consecutiveMatches = 0;
  
  for (let i = 0; i < text.length && queryIndex < queryLower.length; i++) {
    if (textLower[i] === queryLower[queryIndex]) {
      if (rangeStart === -1) rangeStart = i;
      
      // Progressive bonus for consecutive matches
      if (prevMatchIndex === i - 1) {
        consecutiveMatches++;
        score += 10 + (consecutiveMatches * 3); // Increasing bonus for longer streaks
      } else {
        // Save previous range if there was one
        if (rangeStart !== -1 && rangeStart !== i) {
          ranges.push([rangeStart, prevMatchIndex]);
        }
        rangeStart = i;
        score += 8;
        consecutiveMatches = 1;
      }
      
      // Bonus for matching at word boundaries (camelCase, spaces, dashes)
      if (i === 0 || /[\s\-_]/.test(text[i - 1]) || 
          (text[i] === text[i].toUpperCase() && i > 0 && text[i - 1] === text[i - 1].toLowerCase())) {
        score += 15;
      }
      
      // Bonus for matching capital letters in camelCase
      if (text[i] !== text[i].toLowerCase() && text[i] === text[i].toUpperCase()) {
        score += 5;
      }
      
      prevMatchIndex = i;
      queryIndex++;
    }
  }
  
  // Push the last range
  if (rangeStart !== -1 && prevMatchIndex !== -1) {
    ranges.push([rangeStart, prevMatchIndex]);
  }
  
  const matched = queryIndex === queryLower.length;
  if (matched) {
    // Penalty for gaps between matches
    const totalGaps = ranges.reduce((sum, r, i) => {
      if (i === 0) return 0;
      return sum + (r[0] - ranges[i - 1][1] - 1);
    }, 0);
    score = Math.max(1, score - totalGaps * 2);
    
    return { match: true, score, ranges };
  }
  
  // Strategy 5: Typo-tolerant match (last resort)
  const typoMatch = fuzzyMatchWithTypos(text, query);
  if (typoMatch.match) {
    return { match: true, score: typoMatch.score, ranges: [] };
  }
  
  return { match: false, score: 0, ranges: [] };
}

// ============================================================================
// Command Registry
// ============================================================================

const DEFAULT_COMMANDS: Command[] = [
  // Voice commands - use atlas pipeline API
  { id: 'voice:start', label: 'Start Listening', description: 'Activate voice input', category: 'Voice', icon: 'mic', shortcut: 'Alt+V', aliases: ['listen', 'speak'], execute: () => window.atlas?.atlas?.start() },
  { id: 'voice:stop', label: 'Stop Listening', description: 'Deactivate voice input', category: 'Voice', icon: 'mic', aliases: ['mute', 'quiet'], execute: () => window.atlas?.atlas?.stop() },
  { id: 'voice:toggle', label: 'Toggle Voice', description: 'Toggle voice input on/off', category: 'Voice', icon: 'mic', aliases: ['voice'], execute: () => window.atlas?.atlas?.triggerWake() },
  
  // Git commands - use tools.execute API
  { id: 'git:status', label: 'Git Status', description: 'Show repository status', category: 'Git', icon: 'git', shortcut: 'Alt+G S', aliases: ['gs', 'status'], execute: () => window.atlas?.tools?.execute('git_status', {}) },
  { id: 'git:commit', label: 'Git Commit', description: 'Commit staged changes', category: 'Git', icon: 'git', shortcut: 'Alt+G C', aliases: ['gc', 'commit'], execute: () => window.atlas?.tools?.execute('git_commit', { message: 'Quick commit' }) },
  { id: 'git:push', label: 'Git Push', description: 'Push to remote', category: 'Git', icon: 'git', aliases: ['gp', 'push'], execute: () => window.atlas?.tools?.execute('git_push', {}) },
  { id: 'git:pull', label: 'Git Pull', description: 'Pull from remote', category: 'Git', icon: 'git', aliases: ['pull'], execute: () => window.atlas?.tools?.execute('git_pull', {}) },
  
  // System commands - use tools.execute API
  { id: 'system:screenshot', label: 'Take Screenshot', description: 'Capture screen', category: 'System', icon: 'camera', shortcut: 'Alt+S', aliases: ['ss', 'capture', 'screen'], execute: () => window.atlas?.tools?.execute('screenshot', {}) },
  { id: 'system:clipboard', label: 'Clipboard History', description: 'View clipboard history', category: 'System', icon: 'clipboard', aliases: ['clip', 'paste'], execute: () => window.atlas?.tools?.execute('clipboard_history', {}) },
  { id: 'system:reload', label: 'Reload Window', description: 'Reload the application', category: 'System', icon: 'refresh', shortcut: 'Ctrl+R', aliases: ['refresh', 'restart'], execute: () => window.location.reload() },
  { id: 'system:devtools', label: 'Toggle DevTools', description: 'Open developer tools', category: 'System', icon: 'terminal', shortcut: 'Ctrl+Shift+I', aliases: ['dev', 'debug', 'inspect'], execute: () => window.atlas?.dev?.toggleDevTools() },
  
  // Settings - emit custom events for navigation
  { id: 'settings:open', label: 'Open Settings', description: 'Configure Atlas', category: 'Settings', icon: 'settings', shortcut: 'Ctrl+,', aliases: ['config', 'preferences', 'prefs'], execute: () => { window.dispatchEvent(new CustomEvent('atlas:open-settings')); } },
  { id: 'settings:theme', label: 'Change Theme', description: 'Toggle light/dark theme', category: 'Settings', icon: 'palette', aliases: ['theme', 'dark', 'light'], execute: () => { document.documentElement.classList.toggle('light-theme'); } },
  { id: 'settings:routines', label: 'Manage Routines', description: 'Configure automated routines', category: 'Settings', aliases: ['routines', 'automation'], execute: () => {} },
  
  // Navigation
  { id: 'nav:dashboard', label: 'Go to Dashboard', description: 'Open dashboard view', category: 'Navigation', icon: 'dashboard', aliases: ['home', 'main'], execute: () => {} },
  { id: 'nav:notifications', label: 'View Notifications', description: 'Open notification center', category: 'Navigation', icon: 'bell', aliases: ['alerts', 'inbox'], execute: () => {} },
  { id: 'nav:privacy', label: 'Privacy Settings', description: 'View privacy dashboard', category: 'Navigation', icon: 'shield', aliases: ['privacy', 'security'], execute: () => {} },
  
  // Media - spotify API has play() and pause() separately
  { id: 'media:play', label: 'Play/Pause', description: 'Toggle media playback', category: 'Media', icon: 'play', aliases: ['play', 'pause'], execute: async () => {
    const playback = await window.atlas?.spotify?.getCurrentPlayback();
    if (playback?.success && (playback.data as { is_playing?: boolean })?.is_playing) {
      await window.atlas?.spotify?.pause();
    } else {
      await window.atlas?.spotify?.play();
    }
  } },
  { id: 'media:next', label: 'Next Track', description: 'Skip to next track', category: 'Media', icon: 'skip', aliases: ['skip', 'next'], execute: () => window.atlas?.spotify?.next() },
  { id: 'media:prev', label: 'Previous Track', description: 'Go to previous track', category: 'Media', icon: 'rewind', aliases: ['previous', 'back'], execute: () => window.atlas?.spotify?.previous() },
  
  // Quick Actions
  { id: 'quick:timer', label: 'Set Timer', description: 'Start a countdown timer', category: 'Quick Actions', icon: 'clock', aliases: ['timer', 'countdown'], execute: () => {} },
  { id: 'quick:note', label: 'Quick Note', description: 'Create a quick note', category: 'Quick Actions', icon: 'note', aliases: ['note', 'memo'], execute: () => {} },
  { id: 'quick:search', label: 'Web Search', description: 'Search the web', category: 'Quick Actions', icon: 'search', aliases: ['google', 'search', 'web'], execute: () => {} },
  
  // Tools
  { id: 'tools:calculator', label: 'Calculator', description: 'Open calculator', category: 'Tools', icon: 'calculator', aliases: ['calc', 'math'], execute: () => {} },
  { id: 'tools:translate', label: 'Translate', description: 'Translate text', category: 'Tools', icon: 'globe', aliases: ['translate', 'lang'], execute: () => {} },
];

const DEFAULT_WORKFLOWS: Workflow[] = [
  {
    id: 'workflow:morning',
    name: 'Morning Startup',
    description: 'Open apps, check calendar, play music',
    commands: ['nav:dashboard', 'media:play'],
    icon: 'sunrise',
  },
  {
    id: 'workflow:dev',
    name: 'Dev Setup',
    description: 'Open VS Code, terminal, and browser',
    commands: ['system:devtools'],
    icon: 'code',
  },
  {
    id: 'workflow:focus',
    name: 'Focus Mode',
    description: 'Mute notifications, start timer',
    commands: ['voice:stop', 'quick:timer'],
    icon: 'target',
  },
];

// ============================================================================
// Highlight Component
// ============================================================================

const HighlightedText: React.FC<{ text: string; ranges: [number, number][] }> = ({ text, ranges }) => {
  if (ranges.length === 0) return <>{text}</>;
  
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  
  ranges.forEach(([start, end], i) => {
    if (start > lastIndex) {
      parts.push(<span key={`text-${i}`}>{text.slice(lastIndex, start)}</span>);
    }
    parts.push(<mark key={`mark-${i}`} className="highlight">{text.slice(start, end + 1)}</mark>);
    lastIndex = end + 1;
  });
  
  if (lastIndex < text.length) {
    parts.push(<span key="text-last">{text.slice(lastIndex)}</span>);
  }
  
  return <>{parts}</>;
};

// ============================================================================
// Command Item Component
// ============================================================================

interface CommandItemProps {
  command: Command;
  isSelected: boolean;
  isRecent?: boolean;
  isFavorite?: boolean;
  matchRanges?: [number, number][];
  onSelect: () => void;
  onExecute: () => void;
  onToggleFavorite?: () => void;
}

const CommandItem: React.FC<CommandItemProps> = ({
  command,
  isSelected,
  isRecent,
  isFavorite,
  matchRanges = [],
  onSelect,
  onExecute,
  onToggleFavorite,
}) => {
  const itemRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isSelected && itemRef.current) {
      itemRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [isSelected]);

  const getCategoryIcon = () => {
    switch (command.category) {
      case 'Voice': return <MicIcon className="item-icon" />;
      case 'Git': return <GitBranchIcon className="item-icon" />;
      case 'System': return <TerminalIcon className="item-icon" />;
      case 'Settings': return <SettingsIcon className="item-icon" />;
      case 'Navigation': return <CompassIcon className="item-icon" />;
      case 'Workflow': return <LayersIcon className="item-icon" />;
      case 'Media': return <MusicIcon className="item-icon" />;
      case 'Quick Actions': return <ZapIcon className="item-icon" />;
      case 'Tools': return <ToolIcon className="item-icon" />;
      default: return <TerminalIcon className="item-icon" />;
    }
  };

  return (
    <div
      ref={itemRef}
      className={`enhanced-command-item ${isSelected ? 'selected' : ''} ${command.disabled ? 'disabled' : ''}`}
      onMouseEnter={onSelect}
      onClick={onExecute}
      role="option"
      aria-selected={isSelected}
    >
      {getCategoryIcon()}
      <div className="item-content">
        <span className="item-label">
          <HighlightedText text={command.label} ranges={matchRanges} />
          {isRecent && <span className="recent-badge">Recent</span>}
        </span>
        {command.description && (
          <span className="item-description">{command.description}</span>
        )}
        {command.aliases && command.aliases.length > 0 && (
          <span className="item-aliases">
            {command.aliases.slice(0, 3).map((alias, i) => (
              <span key={i} className="alias-tag">{alias}</span>
            ))}
          </span>
        )}
      </div>
      <div className="item-actions">
        {onToggleFavorite && (
          <button 
            className={`favorite-btn ${isFavorite ? 'active' : ''}`}
            onClick={(e) => { e.stopPropagation(); onToggleFavorite(); }}
          >
            <StarIcon className="star-icon" />
          </button>
        )}
        {command.shortcut && (
          <kbd className="item-shortcut">{command.shortcut}</kbd>
        )}
        <ChevronRightIcon className="chevron" />
      </div>
    </div>
  );
};

// ============================================================================
// Workflow Item Component
// ============================================================================

interface WorkflowItemProps {
  workflow: Workflow;
  isSelected: boolean;
  onSelect: () => void;
  onExecute: () => void;
}

const WorkflowItem: React.FC<WorkflowItemProps> = ({
  workflow,
  isSelected,
  onSelect,
  onExecute,
}) => {
  const itemRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isSelected && itemRef.current) {
      itemRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [isSelected]);

  return (
    <div
      ref={itemRef}
      className={`workflow-item ${isSelected ? 'selected' : ''}`}
      onMouseEnter={onSelect}
      onClick={onExecute}
    >
      <LayersIcon className="workflow-icon" />
      <div className="workflow-content">
        <span className="workflow-name">{workflow.name}</span>
        <span className="workflow-desc">{workflow.description}</span>
        <span className="workflow-steps">{workflow.commands.length} steps</span>
      </div>
      <button className="run-workflow-btn">
        <PlayIcon className="play-icon" />
        Run
      </button>
    </div>
  );
};

// ============================================================================
// Main Component
// ============================================================================

export const EnhancedCommandPalette: React.FC<EnhancedCommandPaletteProps> = ({
  isVisible,
  onClose,
}) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [activeTab, setActiveTab] = useState<'all' | 'recent' | 'favorites' | 'workflows'>('all');
  const [recentCommands, setRecentCommands] = useState<string[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [commands] = useState<Command[]>(DEFAULT_COMMANDS);
  const [workflows] = useState<Workflow[]>(DEFAULT_WORKFLOWS);
  
  const inputRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Load recent/favorites from localStorage
  useEffect(() => {
    const storedRecent = localStorage.getItem('atlas:recent-commands');
    const storedFavorites = localStorage.getItem('atlas:favorite-commands');
    if (storedRecent) setRecentCommands(JSON.parse(storedRecent));
    if (storedFavorites) setFavorites(JSON.parse(storedFavorites));
  }, []);

  // Focus input on open
  useEffect(() => {
    if (isVisible && inputRef.current) {
      inputRef.current.focus();
      setQuery('');
      setSelectedIndex(0);
    }
  }, [isVisible]);

  // Filter and sort commands
  const filteredResults = useMemo(() => {
    let results = commands.filter(cmd => !cmd.disabled && (!cmd.when || cmd.when()));
    
    if (activeTab === 'recent') {
      results = results.filter(cmd => recentCommands.includes(cmd.id));
    } else if (activeTab === 'favorites') {
      results = results.filter(cmd => favorites.includes(cmd.id));
    }
    
    if (!query) {
      return results.map(cmd => ({ command: cmd, score: 0, ranges: [] as [number, number][] }));
    }
    
    // Fuzzy search on label, description, and aliases
    return results
      .map(cmd => {
        const labelMatch = fuzzyMatch(cmd.label, query);
        const descMatch = cmd.description ? fuzzyMatch(cmd.description, query) : { match: false, score: 0, ranges: [] };
        const aliasMatches = (cmd.aliases || []).map(a => fuzzyMatch(a, query));
        const bestAliasMatch = aliasMatches.reduce((best, m) => m.score > best.score ? m : best, { match: false, score: 0, ranges: [] });
        
        const bestScore = Math.max(labelMatch.score, descMatch.score * 0.8, bestAliasMatch.score * 0.9);
        const bestMatch = labelMatch.match || descMatch.match || bestAliasMatch.match;
        
        return {
          command: cmd,
          score: bestMatch ? bestScore : 0,
          ranges: labelMatch.ranges,
        };
      })
      .filter(r => r.score > 0)
      .sort((a, b) => {
        // Boost recent commands
        const aRecent = recentCommands.indexOf(a.command.id);
        const bRecent = recentCommands.indexOf(b.command.id);
        const aBoost = aRecent >= 0 ? 50 - aRecent * 5 : 0;
        const bBoost = bRecent >= 0 ? 50 - bRecent * 5 : 0;
        return (b.score + bBoost) - (a.score + aBoost);
      });
  }, [commands, query, activeTab, recentCommands, favorites]);

  const totalItems = activeTab === 'workflows' ? workflows.length : filteredResults.length;

  // Execute command
  const executeCommand = useCallback(async (cmd: Command) => {
    try {
      await cmd.execute();
      
      // Update recent commands
      setRecentCommands(prev => {
        const updated = [cmd.id, ...prev.filter(id => id !== cmd.id)].slice(0, 10);
        localStorage.setItem('atlas:recent-commands', JSON.stringify(updated));
        return updated;
      });
      
      onClose();
    } catch (error) {
      console.error('Command execution failed:', error);
    }
  }, [onClose]);

  // Execute workflow
  const executeWorkflow = useCallback(async (workflow: Workflow) => {
    for (const cmdId of workflow.commands) {
      const cmd = commands.find(c => c.id === cmdId);
      if (cmd) {
        try {
          await cmd.execute();
          await new Promise(r => setTimeout(r, 300)); // Small delay between commands
        } catch (error) {
          console.error(`Workflow step failed: ${cmdId}`, error);
        }
      }
    }
    onClose();
  }, [commands, onClose]);

  // Toggle favorite
  const toggleFavorite = useCallback((cmdId: string) => {
    setFavorites(prev => {
      const updated = prev.includes(cmdId) 
        ? prev.filter(id => id !== cmdId)
        : [...prev, cmdId];
      localStorage.setItem('atlas:favorite-commands', JSON.stringify(updated));
      return updated;
    });
  }, []);

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        onClose();
        break;
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(prev => Math.min(prev + 1, totalItems - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(prev => Math.max(prev - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (activeTab === 'workflows') {
          if (workflows[selectedIndex]) {
            executeWorkflow(workflows[selectedIndex]);
          }
        } else {
          if (filteredResults[selectedIndex]) {
            executeCommand(filteredResults[selectedIndex].command);
          }
        }
        break;
      case 'Tab':
        e.preventDefault();
        const tabs: typeof activeTab[] = ['all', 'recent', 'favorites', 'workflows'];
        const currentIdx = tabs.indexOf(activeTab);
        setActiveTab(tabs[(currentIdx + (e.shiftKey ? -1 : 1) + tabs.length) % tabs.length]);
        setSelectedIndex(0);
        break;
    }
  }, [onClose, totalItems, activeTab, workflows, selectedIndex, filteredResults, executeCommand, executeWorkflow]);

  // Close on overlay click
  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if (e.target === overlayRef.current) onClose();
  }, [onClose]);

  if (!isVisible) return null;

  return (
    <div
      ref={overlayRef}
      className="enhanced-palette-overlay"
      onClick={handleOverlayClick}
    >
      <div className="enhanced-palette">
        {/* Search */}
        <div className="palette-search">
          <SearchIcon className="search-icon" />
          <input
            ref={inputRef}
            type="text"
            className="search-input"
            placeholder="Search commands, actions, or workflows..."
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelectedIndex(0); }}
            onKeyDown={handleKeyDown}
            autoComplete="off"
            autoCorrect="off"
            spellCheck="false"
          />
          {query && (
            <button className="clear-btn" onClick={() => setQuery('')}>
              <XIcon className="clear-icon" />
            </button>
          )}
        </div>

        {/* Tabs */}
        <div className="palette-tabs">
          <button 
            className={`tab ${activeTab === 'all' ? 'active' : ''}`}
            onClick={() => { setActiveTab('all'); setSelectedIndex(0); }}
          >
            All
          </button>
          <button 
            className={`tab ${activeTab === 'recent' ? 'active' : ''}`}
            onClick={() => { setActiveTab('recent'); setSelectedIndex(0); }}
          >
            <ClockIcon className="tab-icon" />
            Recent
          </button>
          <button 
            className={`tab ${activeTab === 'favorites' ? 'active' : ''}`}
            onClick={() => { setActiveTab('favorites'); setSelectedIndex(0); }}
          >
            <StarIcon className="tab-icon" />
            Favorites
          </button>
          <button 
            className={`tab ${activeTab === 'workflows' ? 'active' : ''}`}
            onClick={() => { setActiveTab('workflows'); setSelectedIndex(0); }}
          >
            <LayersIcon className="tab-icon" />
            Workflows
          </button>
        </div>

        {/* Results */}
        <div className="palette-results">
          {activeTab === 'workflows' ? (
            workflows.length === 0 ? (
              <div className="empty-state">No workflows yet</div>
            ) : (
              workflows.map((workflow, idx) => (
                <WorkflowItem
                  key={workflow.id}
                  workflow={workflow}
                  isSelected={selectedIndex === idx}
                  onSelect={() => setSelectedIndex(idx)}
                  onExecute={() => executeWorkflow(workflow)}
                />
              ))
            )
          ) : filteredResults.length === 0 ? (
            <div className="empty-state">
              {query ? `No results for "${query}"` : 'No commands available'}
            </div>
          ) : (
            filteredResults.map((result, idx) => (
              <CommandItem
                key={result.command.id}
                command={result.command}
                isSelected={selectedIndex === idx}
                isRecent={recentCommands.includes(result.command.id)}
                isFavorite={favorites.includes(result.command.id)}
                matchRanges={result.ranges}
                onSelect={() => setSelectedIndex(idx)}
                onExecute={() => executeCommand(result.command)}
                onToggleFavorite={() => toggleFavorite(result.command.id)}
              />
            ))
          )}
        </div>

        {/* Footer */}
        <div className="palette-footer">
          <span className="hint"><kbd>↑↓</kbd> Navigate</span>
          <span className="hint"><kbd>Tab</kbd> Switch tabs</span>
          <span className="hint"><kbd>Enter</kbd> Execute</span>
          <span className="hint"><kbd>Esc</kbd> Close</span>
        </div>
      </div>
    </div>
  );
};

export default EnhancedCommandPalette;
