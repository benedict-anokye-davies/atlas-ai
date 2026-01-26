/**
 * Atlas Desktop - Command Store
 * Zustand store for command palette state management
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

/**
 * Command category types
 */
export type CommandCategory = 'Voice' | 'Settings' | 'Git' | 'System';

/**
 * Command definition
 */
export interface Command {
  id: string;
  label: string;
  description?: string;
  category: CommandCategory;
  shortcut?: string;
  icon?: string;
  action: () => void | Promise<void>;
  disabled?: boolean;
}

/**
 * Recent command entry
 */
interface RecentCommand {
  id: string;
  timestamp: number;
}

/**
 * Command store state
 */
interface CommandStore {
  // Palette state
  isOpen: boolean;
  searchQuery: string;
  selectedIndex: number;

  // Command registry
  commands: Command[];
  recentCommands: RecentCommand[];

  // Actions - Palette control
  open: () => void;
  close: () => void;
  toggle: () => void;

  // Actions - Search
  setSearchQuery: (query: string) => void;
  clearSearch: () => void;

  // Actions - Selection
  setSelectedIndex: (index: number) => void;
  selectNext: () => void;
  selectPrevious: () => void;

  // Actions - Commands
  registerCommand: (command: Command) => void;
  registerCommands: (commands: Command[]) => void;
  unregisterCommand: (id: string) => void;
  executeCommand: (id: string) => Promise<void>;

  // Actions - Recent commands
  addRecentCommand: (id: string) => void;
  clearRecentCommands: () => void;
}

/**
 * Maximum number of recent commands to store
 */
const MAX_RECENT_COMMANDS = 5;

/**
 * LocalStorage key for recent commands
 */
const RECENT_COMMANDS_KEY = 'atlas-recent-commands';

/**
 * Load recent commands from localStorage
 */
function loadRecentCommands(): RecentCommand[] {
  if (typeof window === 'undefined') return [];
  try {
    const stored = localStorage.getItem(RECENT_COMMANDS_KEY);
    if (stored) {
      return JSON.parse(stored) as RecentCommand[];
    }
  } catch (e) {
    console.warn('[CommandStore] Failed to load recent commands:', e);
  }
  return [];
}

/**
 * Save recent commands to localStorage
 */
function saveRecentCommands(commands: RecentCommand[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(RECENT_COMMANDS_KEY, JSON.stringify(commands));
  } catch (e) {
    console.warn('[CommandStore] Failed to save recent commands:', e);
  }
}

/**
 * Command palette Zustand store
 */
export const useCommandStore = create<CommandStore>()(
  subscribeWithSelector((set, get) => ({
    // Initial state
    isOpen: false,
    searchQuery: '',
    selectedIndex: 0,
    commands: [],
    recentCommands: loadRecentCommands(),

    // Palette control
    open: () => set({ isOpen: true, searchQuery: '', selectedIndex: 0 }),
    close: () => set({ isOpen: false, searchQuery: '', selectedIndex: 0 }),
    toggle: () => {
      const { isOpen } = get();
      if (isOpen) {
        set({ isOpen: false, searchQuery: '', selectedIndex: 0 });
      } else {
        set({ isOpen: true, searchQuery: '', selectedIndex: 0 });
      }
    },

    // Search
    setSearchQuery: (query) => set({ searchQuery: query, selectedIndex: 0 }),
    clearSearch: () => set({ searchQuery: '', selectedIndex: 0 }),

    // Selection
    setSelectedIndex: (index) => set({ selectedIndex: index }),
    selectNext: () => {
      // This will be bounded by the filtered commands in the component
      set((state) => ({ selectedIndex: state.selectedIndex + 1 }));
    },
    selectPrevious: () => {
      set((state) => ({ selectedIndex: Math.max(0, state.selectedIndex - 1) }));
    },

    // Command registration
    registerCommand: (command) => {
      set((state) => {
        // Check if command already exists
        const existing = state.commands.find((c) => c.id === command.id);
        if (existing) {
          // Update existing command
          return {
            commands: state.commands.map((c) =>
              c.id === command.id ? command : c
            ),
          };
        }
        return { commands: [...state.commands, command] };
      });
    },

    registerCommands: (commands) => {
      set((state) => {
        const existingIds = new Set(state.commands.map((c) => c.id));
        const newCommands = commands.filter((c) => !existingIds.has(c.id));
        const updatedCommands = state.commands.map((existing) => {
          const updated = commands.find((c) => c.id === existing.id);
          return updated || existing;
        });
        return { commands: [...updatedCommands, ...newCommands] };
      });
    },

    unregisterCommand: (id) => {
      set((state) => ({
        commands: state.commands.filter((c) => c.id !== id),
      }));
    },

    executeCommand: async (id) => {
      const { commands, addRecentCommand, close } = get();
      const command = commands.find((c) => c.id === id);

      if (!command || command.disabled) return;

      // Add to recent commands
      addRecentCommand(id);

      // Close palette
      close();

      // Execute the command action
      try {
        await command.action();
      } catch (err) {
        console.error(`[CommandStore] Failed to execute command "${id}":`, err);
      }
    },

    // Recent commands
    addRecentCommand: (id) => {
      set((state) => {
        // Remove existing entry for this command if present
        const filtered = state.recentCommands.filter((r) => r.id !== id);

        // Add to the front
        const updated = [
          { id, timestamp: Date.now() },
          ...filtered,
        ].slice(0, MAX_RECENT_COMMANDS);

        // Persist to localStorage
        saveRecentCommands(updated);

        return { recentCommands: updated };
      });
    },

    clearRecentCommands: () => {
      set({ recentCommands: [] });
      saveRecentCommands([]);
    },
  }))
);

// Selectors for optimized re-renders
export const selectIsOpen = (state: CommandStore) => state.isOpen;
export const selectSearchQuery = (state: CommandStore) => state.searchQuery;
export const selectSelectedIndex = (state: CommandStore) => state.selectedIndex;
export const selectCommands = (state: CommandStore) => state.commands;
export const selectRecentCommands = (state: CommandStore) => state.recentCommands;

export default useCommandStore;
