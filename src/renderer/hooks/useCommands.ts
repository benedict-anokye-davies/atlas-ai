/* eslint-disable no-console */
/**
 * Atlas Desktop - useCommands Hook
 * Command registry and fuzzy search functionality for the command palette
 */

import { useEffect, useMemo, useCallback } from 'react';
import { useCommandStore, type Command, type CommandCategory } from '../stores/commandStore';
import { useAtlasStore } from '../stores/atlasStore';

/**
 * Fuzzy search scoring function
 * Returns a score (higher is better match), or -1 if no match
 */
function fuzzyScore(query: string, target: string): number {
  const queryLower = query.toLowerCase();
  const targetLower = target.toLowerCase();

  // Exact match gets highest score
  if (targetLower === queryLower) {
    return 1000;
  }

  // Starts with query gets high score
  if (targetLower.startsWith(queryLower)) {
    return 500 + (queryLower.length / targetLower.length) * 100;
  }

  // Contains query as a substring
  if (targetLower.includes(queryLower)) {
    return 200 + (queryLower.length / targetLower.length) * 50;
  }

  // Fuzzy character matching
  let queryIdx = 0;
  let score = 0;
  let lastMatchIdx = -1;
  let consecutive = 0;

  for (let i = 0; i < targetLower.length && queryIdx < queryLower.length; i++) {
    if (targetLower[i] === queryLower[queryIdx]) {
      // Character match
      queryIdx++;
      score += 10;

      // Bonus for consecutive matches
      if (lastMatchIdx === i - 1) {
        consecutive++;
        score += consecutive * 5;
      } else {
        consecutive = 0;
      }

      // Bonus for matching at word boundaries
      if (i === 0 || /[\s\-_]/.test(target[i - 1])) {
        score += 20;
      }

      lastMatchIdx = i;
    }
  }

  // All query characters must be found
  if (queryIdx !== queryLower.length) {
    return -1;
  }

  // Penalize longer targets
  score -= (targetLower.length - queryLower.length) * 0.5;

  return Math.max(0, score);
}

/**
 * Search result with score
 */
interface SearchResult {
  command: Command;
  score: number;
}

/**
 * Filter and sort commands by fuzzy search
 */
function filterCommands(commands: Command[], query: string, recentIds: string[]): Command[] {
  if (!query.trim()) {
    // No query - show all commands, with recent ones first
    const recentSet = new Set(recentIds);
    const recent = commands.filter((c) => recentSet.has(c.id));
    const others = commands.filter((c) => !recentSet.has(c.id));

    // Sort recent by their position in recentIds
    recent.sort((a, b) => recentIds.indexOf(a.id) - recentIds.indexOf(b.id));

    // Sort others by category then label
    others.sort((a, b) => {
      if (a.category !== b.category) {
        return a.category.localeCompare(b.category);
      }
      return a.label.localeCompare(b.label);
    });

    return [...recent, ...others];
  }

  // Fuzzy search
  const results: SearchResult[] = [];

  for (const command of commands) {
    // Score against label
    const labelScore = fuzzyScore(query, command.label);
    // Score against description
    const descScore = command.description ? fuzzyScore(query, command.description) : -1;
    // Score against category
    const catScore = fuzzyScore(query, command.category);

    // Take the best score
    const bestScore = Math.max(labelScore, descScore * 0.7, catScore * 0.5);

    if (bestScore > 0) {
      // Boost recently used commands
      const recentBoost = recentIds.includes(command.id) ? 50 : 0;
      results.push({ command, score: bestScore + recentBoost });
    }
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);

  return results.map((r) => r.command);
}

/**
 * Group commands by category
 */
interface CommandGroup {
  category: CommandCategory;
  commands: Command[];
}

function groupByCategory(commands: Command[]): CommandGroup[] {
  const groups = new Map<CommandCategory, Command[]>();
  const categoryOrder: CommandCategory[] = ['Voice', 'Settings', 'Git', 'System'];

  for (const command of commands) {
    const existing = groups.get(command.category);
    if (existing) {
      existing.push(command);
    } else {
      groups.set(command.category, [command]);
    }
  }

  return categoryOrder
    .filter((cat) => groups.has(cat))
    .map((cat) => ({
      category: cat,
      commands: groups.get(cat)!,
    }));
}

/**
 * Result of useCommands hook
 */
interface UseCommandsResult {
  // Filtered commands based on search
  filteredCommands: Command[];

  // Commands grouped by category
  groupedCommands: CommandGroup[];

  // Recent commands that exist in registry
  recentCommands: Command[];

  // Whether there are matching commands
  hasResults: boolean;

  // Register a new command
  registerCommand: (command: Command) => void;

  // Register multiple commands
  registerCommands: (commands: Command[]) => void;

  // Unregister a command
  unregisterCommand: (id: string) => void;

  // Execute a command by ID
  executeCommand: (id: string) => Promise<void>;

  // Execute the currently selected command
  executeSelected: () => Promise<void>;
}

/**
 * Hook to manage commands and provide filtered results
 */
export function useCommands(): UseCommandsResult {
  const {
    commands,
    recentCommands,
    searchQuery,
    selectedIndex,
    registerCommand,
    registerCommands,
    unregisterCommand,
    executeCommand,
  } = useCommandStore();

  const { toggleSettings, updateSettings, settings } = useAtlasStore();

  // Get recent command IDs
  const recentIds = useMemo(() => recentCommands.map((r) => r.id), [recentCommands]);

  // Filter commands based on search query
  const filteredCommands = useMemo(
    () => filterCommands(commands, searchQuery, recentIds),
    [commands, searchQuery, recentIds]
  );

  // Group filtered commands by category
  const groupedCommands = useMemo(() => groupByCategory(filteredCommands), [filteredCommands]);

  // Get recent commands that still exist
  const recentCommandsList = useMemo(
    () => recentIds.map((id) => commands.find((c) => c.id === id)).filter(Boolean) as Command[],
    [commands, recentIds]
  );

  // Execute the selected command
  const executeSelected = useCallback(async () => {
    const command = filteredCommands[selectedIndex];
    if (command) {
      await executeCommand(command.id);
    }
  }, [filteredCommands, selectedIndex, executeCommand]);

  // Register default Atlas commands on mount
  useEffect(() => {
    const defaultCommands: Command[] = [
      // Voice commands
      {
        id: 'voice:start',
        label: 'Start Voice Pipeline',
        description: 'Begin listening for wake word activation',
        category: 'Voice',
        icon: 'play',
        action: async () => {
          await window.atlas?.atlas.start();
        },
      },
      {
        id: 'voice:stop',
        label: 'Stop Voice Pipeline',
        description: 'Stop voice recognition and processing',
        category: 'Voice',
        icon: 'stop',
        action: async () => {
          await window.atlas?.atlas.stop();
        },
      },
      {
        id: 'voice:trigger',
        label: 'Trigger Wake Word',
        description: 'Manually activate listening mode',
        category: 'Voice',
        shortcut: 'Space',
        icon: 'mic',
        action: async () => {
          await window.atlas?.atlas.triggerWake();
        },
      },
      {
        id: 'voice:clear-history',
        label: 'Clear Conversation History',
        description: 'Reset the current conversation context',
        category: 'Voice',
        icon: 'trash',
        action: async () => {
          await window.atlas?.atlas.clearHistory();
        },
      },

      // Settings commands
      {
        id: 'settings:open',
        label: 'Open Settings',
        description: 'Open the settings panel',
        category: 'Settings',
        shortcut: 'Ctrl+,',
        icon: 'settings',
        action: () => {
          toggleSettings();
        },
      },
      {
        id: 'settings:toggle-debug',
        label: 'Toggle Debug Overlay',
        description: 'Show or hide performance debug information',
        category: 'Settings',
        shortcut: 'Ctrl+D',
        icon: 'bug',
        action: () => {
          updateSettings({ showDebug: !settings.showDebug });
        },
      },
      {
        id: 'settings:toggle-transcript',
        label: 'Toggle Transcript Display',
        description: 'Show or hide the conversation transcript',
        category: 'Settings',
        icon: 'message',
        action: () => {
          updateSettings({ showTranscript: !settings.showTranscript });
        },
      },
      {
        id: 'settings:quality-low',
        label: 'Set Quality: Low',
        description: 'Switch to low quality graphics (3K particles)',
        category: 'Settings',
        icon: 'zap',
        action: () => {
          updateSettings({
            qualityPreset: 'low',
            particleCount: 3000,
            enableEffects: false,
            enableShadows: false,
            enablePostProcessing: false,
            enableAntialiasing: false,
          });
        },
      },
      {
        id: 'settings:quality-medium',
        label: 'Set Quality: Medium',
        description: 'Switch to medium quality graphics (8K particles)',
        category: 'Settings',
        icon: 'zap',
        action: () => {
          updateSettings({
            qualityPreset: 'medium',
            particleCount: 8000,
            enableEffects: true,
            enableShadows: false,
            enablePostProcessing: false,
            enableAntialiasing: true,
          });
        },
      },
      {
        id: 'settings:quality-high',
        label: 'Set Quality: High',
        description: 'Switch to high quality graphics (15K particles)',
        category: 'Settings',
        icon: 'zap',
        action: () => {
          updateSettings({
            qualityPreset: 'high',
            particleCount: 15000,
            enableEffects: true,
            enableShadows: true,
            enablePostProcessing: true,
            enableAntialiasing: true,
          });
        },
      },
      {
        id: 'settings:quality-ultra',
        label: 'Set Quality: Ultra',
        description: 'Switch to ultra quality graphics (35K particles)',
        category: 'Settings',
        icon: 'zap',
        action: () => {
          updateSettings({
            qualityPreset: 'ultra',
            particleCount: 35000,
            enableEffects: true,
            enableShadows: true,
            enablePostProcessing: true,
            enableAntialiasing: true,
          });
        },
      },
      {
        id: 'settings:toggle-adaptive',
        label: 'Toggle Adaptive Performance',
        description: 'Enable or disable automatic performance adjustment',
        category: 'Settings',
        icon: 'activity',
        action: () => {
          updateSettings({ adaptivePerformance: !settings.adaptivePerformance });
        },
      },

      // Git commands
      {
        id: 'git:status',
        label: 'Git Status',
        description: 'Show current repository status',
        category: 'Git',
        icon: 'git-branch',
        action: async () => {
          // This would integrate with agent tools
          console.log('[Command] Git status requested');
        },
      },
      {
        id: 'git:commit',
        label: 'Git Commit',
        description: 'Commit staged changes',
        category: 'Git',
        icon: 'git-commit',
        action: async () => {
          console.log('[Command] Git commit requested');
        },
      },
      {
        id: 'git:push',
        label: 'Git Push',
        description: 'Push commits to remote',
        category: 'Git',
        icon: 'upload',
        action: async () => {
          console.log('[Command] Git push requested');
        },
      },
      {
        id: 'git:pull',
        label: 'Git Pull',
        description: 'Pull changes from remote',
        category: 'Git',
        icon: 'download',
        action: async () => {
          console.log('[Command] Git pull requested');
        },
      },

      // System commands
      {
        id: 'system:reload',
        label: 'Reload Window',
        description: 'Reload the application window',
        category: 'System',
        shortcut: 'Ctrl+R',
        icon: 'refresh',
        action: () => {
          window.location.reload();
        },
      },
      {
        id: 'system:dev-tools',
        label: 'Toggle Developer Tools',
        description: 'Open or close Chrome DevTools',
        category: 'System',
        shortcut: 'F12',
        icon: 'code',
        action: async () => {
          await window.atlas?.system?.toggleDevTools?.();
        },
      },
      {
        id: 'system:minimize',
        label: 'Minimize Window',
        description: 'Minimize the application to taskbar',
        category: 'System',
        icon: 'minus',
        action: async () => {
          await window.atlas?.system?.minimizeWindow?.();
        },
      },
      {
        id: 'system:quit',
        label: 'Quit Atlas',
        description: 'Close the application',
        category: 'System',
        shortcut: 'Ctrl+Q',
        icon: 'x',
        action: async () => {
          await window.atlas?.system?.quit?.();
        },
      },
    ];

    registerCommands(defaultCommands);
  }, [
    registerCommands,
    toggleSettings,
    updateSettings,
    settings.showDebug,
    settings.showTranscript,
    settings.adaptivePerformance,
  ]);

  return {
    filteredCommands,
    groupedCommands,
    recentCommands: recentCommandsList,
    hasResults: filteredCommands.length > 0,
    registerCommand,
    registerCommands,
    unregisterCommand,
    executeCommand,
    executeSelected,
  };
}

export default useCommands;
