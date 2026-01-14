/**
 * Nova Desktop - Main Zustand Store
 * Global state management for the renderer process
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { NovaState } from '../components/orb/NovaParticles';

/**
 * Conversation message
 */
export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  isInterim?: boolean;
}

/**
 * Quality preset types
 */
export type QualityPreset = 'low' | 'medium' | 'high' | 'ultra' | 'custom';

/**
 * Quality preset configuration
 */
export interface QualityPresetConfig {
  particles: number;
  effects: boolean;
  shadows: boolean;
  postProcessing: boolean;
  antialiasing: boolean;
}

/**
 * Quality presets configuration map
 */
export const QUALITY_PRESETS: Record<Exclude<QualityPreset, 'custom'>, QualityPresetConfig> = {
  low: {
    particles: 3000,
    effects: false,
    shadows: false,
    postProcessing: false,
    antialiasing: false,
  },
  medium: {
    particles: 8000,
    effects: true,
    shadows: false,
    postProcessing: false,
    antialiasing: true,
  },
  high: {
    particles: 15000,
    effects: true,
    shadows: true,
    postProcessing: true,
    antialiasing: true,
  },
  ultra: {
    particles: 35000,
    effects: true,
    shadows: true,
    postProcessing: true,
    antialiasing: true,
  },
};

/**
 * Settings configuration
 */
export interface NovaSettings {
  // Audio settings
  inputDevice: string | null;
  outputDevice: string | null;
  audioVolume: number;

  // Voice settings
  voiceId: string;
  voiceSpeed: number;
  voiceStability: number;

  // Visual settings
  particleCount: number;
  showTranscript: boolean;
  theme: 'dark' | 'light' | 'system';
  adaptivePerformance: boolean;
  qualityPreset: QualityPreset;
  enableEffects: boolean;
  enableShadows: boolean;
  enablePostProcessing: boolean;
  enableAntialiasing: boolean;

  // Behavior settings
  autoStart: boolean;
  pushToTalk: boolean;
  wakeWord: string;

  // LLM settings
  preferredLlmProvider: 'fireworks' | 'openrouter' | 'auto';
  preferredSttProvider: 'deepgram' | 'vosk' | 'auto';
  maxConversationHistory: number;

  // Debug settings
  showDebug: boolean;

  // Budget settings
  dailyBudget: number; // Default $5/day
  budgetWarningThreshold: number; // Warn at 80%
}

/**
 * Nova store state
 */
interface NovaStore {
  // Voice state
  state: NovaState;
  isReady: boolean;
  isListening: boolean;
  isSpeaking: boolean;
  isThinking: boolean;
  audioLevel: number;

  // Providers
  sttProvider: string | null;
  llmProvider: string | null;
  ttsProvider: string | null;

  // Conversation
  messages: Message[];
  currentTranscript: string;
  interimTranscript: string;
  currentResponse: string;

  // Settings
  settings: NovaSettings;
  isSettingsOpen: boolean;

  // Budget/Usage tracking
  budgetUsage: {
    todaySpend: number;
    remainingBudget: number;
    usagePercent: number;
    isWithinBudget: boolean;
    budgetExceeded: boolean;
    lastUpdated: number;
  };

  // Error handling
  error: string | null;
  lastError: { message: string; timestamp: number } | null;

  // Actions - Voice state
  setState: (state: NovaState) => void;
  setReady: (ready: boolean) => void;
  setListening: (listening: boolean) => void;
  setSpeaking: (speaking: boolean) => void;
  setThinking: (thinking: boolean) => void;
  setAudioLevel: (level: number) => void;

  // Actions - Providers
  setProvider: (type: 'stt' | 'llm' | 'tts', provider: string | null) => void;

  // Actions - Conversation
  addMessage: (message: Omit<Message, 'id' | 'timestamp'>) => void;
  updateMessage: (id: string, content: string) => void;
  clearMessages: () => void;
  setTranscript: (transcript: string, isInterim?: boolean) => void;
  setResponse: (response: string) => void;
  appendResponse: (chunk: string) => void;

  // Actions - Settings
  updateSettings: (settings: Partial<NovaSettings>) => void;
  toggleSettings: () => void;

  // Actions - Budget
  updateBudgetUsage: (usage: Partial<NovaStore['budgetUsage']>) => void;

  // Actions - Error
  setError: (error: string | null) => void;
  clearError: () => void;

  // Actions - Reset
  reset: () => void;
}

/**
 * Default settings
 */
const defaultSettings: NovaSettings = {
  inputDevice: null,
  outputDevice: null,
  audioVolume: 1.0,
  voiceId: 'nova',
  voiceSpeed: 1.0,
  voiceStability: 0.5,
  particleCount: 35000,
  showTranscript: true,
  theme: 'dark',
  adaptivePerformance: true, // Auto-adjust particles for FPS
  qualityPreset: 'ultra', // Default to ultra quality
  enableEffects: true,
  enableShadows: true,
  enablePostProcessing: true,
  enableAntialiasing: true,
  autoStart: true,
  pushToTalk: false,
  wakeWord: 'Hey Nova',
  preferredLlmProvider: 'auto',
  preferredSttProvider: 'auto',
  maxConversationHistory: 50,
  showDebug: false, // Debug overlay off by default
  dailyBudget: 5.0, // $5/day default
  budgetWarningThreshold: 0.8, // Warn at 80%
};

/**
 * Initial state
 */
const initialState = {
  state: 'idle' as NovaState,
  isReady: false,
  isListening: false,
  isSpeaking: false,
  isThinking: false,
  audioLevel: 0,
  sttProvider: null,
  llmProvider: null,
  ttsProvider: null,
  messages: [] as Message[],
  currentTranscript: '',
  interimTranscript: '',
  currentResponse: '',
  settings: defaultSettings,
  isSettingsOpen: false,
  budgetUsage: {
    todaySpend: 0,
    remainingBudget: defaultSettings.dailyBudget,
    usagePercent: 0,
    isWithinBudget: true,
    budgetExceeded: false,
    lastUpdated: Date.now(),
  },
  error: null,
  lastError: null,
};

/**
 * Generate unique message ID
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Nova Zustand store
 */
export const useNovaStore = create<NovaStore>()(
  subscribeWithSelector((set, get) => ({
    ...initialState,

    // Voice state actions
    setState: (state) => set({ state }),
    setReady: (isReady) => set({ isReady }),
    setListening: (isListening) => set({ isListening }),
    setSpeaking: (isSpeaking) => set({ isSpeaking }),
    setThinking: (isThinking) => set({ isThinking }),
    setAudioLevel: (audioLevel) => set({ audioLevel }),

    // Provider actions
    setProvider: (type, provider) => {
      switch (type) {
        case 'stt':
          set({ sttProvider: provider });
          break;
        case 'llm':
          set({ llmProvider: provider });
          break;
        case 'tts':
          set({ ttsProvider: provider });
          break;
      }
    },

    // Conversation actions
    addMessage: (message) => {
      const newMessage: Message = {
        ...message,
        id: generateId(),
        timestamp: Date.now(),
      };
      set((state) => ({
        messages: [...state.messages, newMessage].slice(-state.settings.maxConversationHistory),
      }));
    },

    updateMessage: (id, content) => {
      set((state) => ({
        messages: state.messages.map((msg) =>
          msg.id === id ? { ...msg, content, isInterim: false } : msg
        ),
      }));
    },

    clearMessages: () => set({ messages: [], currentTranscript: '', currentResponse: '' }),

    setTranscript: (transcript, isInterim = false) => {
      if (isInterim) {
        set({ interimTranscript: transcript });
      } else {
        set({ currentTranscript: transcript, interimTranscript: '' });
      }
    },

    setResponse: (response) => set({ currentResponse: response }),

    appendResponse: (chunk) => {
      set((state) => ({ currentResponse: state.currentResponse + chunk }));
    },

    // Settings actions
    updateSettings: (newSettings) => {
      set((state) => ({
        settings: { ...state.settings, ...newSettings },
      }));

      // Persist settings to localStorage
      try {
        const currentSettings = get().settings;
        localStorage.setItem('nova-settings', JSON.stringify(currentSettings));
      } catch (e) {
        console.warn('[NovaStore] Failed to persist settings:', e);
      }
    },

    toggleSettings: () => set((state) => ({ isSettingsOpen: !state.isSettingsOpen })),

    // Budget actions
    updateBudgetUsage: (usage) => {
      set((state) => ({
        budgetUsage: { ...state.budgetUsage, ...usage, lastUpdated: Date.now() },
      }));
    },

    // Error actions
    setError: (error) => {
      set({
        error,
        lastError: error ? { message: error, timestamp: Date.now() } : null,
        state: error ? 'error' : get().state,
      });
    },

    clearError: () => set({ error: null }),

    // Reset
    reset: () => set(initialState),
  }))
);

// Load settings from localStorage on initialization
if (typeof window !== 'undefined') {
  try {
    const savedSettings = localStorage.getItem('nova-settings');
    if (savedSettings) {
      const parsed = JSON.parse(savedSettings) as Partial<NovaSettings>;
      useNovaStore.getState().updateSettings(parsed);
    }
  } catch (e) {
    console.warn('[NovaStore] Failed to load saved settings:', e);
  }
}

// Selectors for optimized re-renders
export const selectState = (state: NovaStore) => state.state;
export const selectIsReady = (state: NovaStore) => state.isReady;
export const selectAudioLevel = (state: NovaStore) => state.audioLevel;
export const selectMessages = (state: NovaStore) => state.messages;
export const selectSettings = (state: NovaStore) => state.settings;
export const selectError = (state: NovaStore) => state.error;
export const selectBudgetUsage = (state: NovaStore) => state.budgetUsage;

export default useNovaStore;
