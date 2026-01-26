/**
 * Atlas Desktop - Main Zustand Store
 * Global state management for the renderer process
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { AtlasState } from '../components/orb/AtlasParticles';

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
 * Attractor type for orb visualization (040-A)
 */
export type AttractorType = 'auto' | 'aizawa' | 'lorenz' | 'thomas' | 'halvorsen' | 'arneodo';

/**
 * Color theme preset for orb visualization (040-A)
 */
export type OrbColorTheme = 'auto' | 'cyan' | 'blue' | 'purple' | 'gold' | 'green' | 'pink' | 'custom';

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
 * Personality preset types
 */
export type PersonalityPreset = 'atlas' | 'professional' | 'playful' | 'minimal' | 'custom';

/**
 * Personality traits (0-1 scale)
 */
export interface PersonalityTraits {
  friendliness: number;
  formality: number;
  humor: number;
  curiosity: number;
  energy: number;
  patience: number;
}

/**
 * Settings configuration
 */
export interface AtlasSettings {
  // Audio settings
  inputDevice: string | null;
  outputDevice: string | null;
  audioVolume: number;
  
  // Audio feedback settings
  audioFeedbackEnabled: boolean; // Enable sound cues for state changes
  audioFeedbackVolume: number; // 0-1 volume level for feedback sounds

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

  // Orb visualization settings (040-A)
  attractorType: AttractorType;
  orbColorTheme: OrbColorTheme;
  customOrbHue: number; // 0-1 for custom color theme
  orbBrightness: number; // 0-1 brightness multiplier
  orbSaturation: number; // 0-1 saturation multiplier

  // Behavior settings
  autoStart: boolean;
  pushToTalk: boolean;
  wakeWord: string;

  // LLM settings
  preferredLlmProvider: 'fireworks' | 'openrouter' | 'auto';
  preferredSttProvider: 'deepgram' | 'vosk' | 'auto';
  maxConversationHistory: number;

  // Personality settings
  personalityPreset: PersonalityPreset;
  personalityTraits: PersonalityTraits;

  // Debug settings
  showDebug: boolean;

  // Budget settings
  dailyBudget: number; // Default $5/day
  budgetWarningThreshold: number; // Warn at 80%
}

/**
 * Atlas store state
 */
interface AtlasStore {
  // Voice state
  state: AtlasState;
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
  settings: AtlasSettings;
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
  setState: (state: AtlasState) => void;
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
  updateSettings: (settings: Partial<AtlasSettings>) => void;
  toggleSettings: () => void;

  // Actions - Budget
  updateBudgetUsage: (usage: Partial<AtlasStore['budgetUsage']>) => void;

  // Actions - Error
  setError: (error: string | null) => void;
  clearError: () => void;

  // Actions - Reset
  reset: () => void;
}

/**
 * Default personality traits (matches DEFAULT_ATLAS_PERSONALITY)
 */
const defaultPersonalityTraits: PersonalityTraits = {
  friendliness: 0.9,
  formality: 0.3,
  humor: 0.7,
  curiosity: 0.9,
  energy: 0.8,
  patience: 0.9,
};

/**
 * Default settings
 */
const defaultSettings: AtlasSettings = {
  inputDevice: null,
  outputDevice: null,
  audioVolume: 1.0,
  audioFeedbackEnabled: true, // Audio cues on by default
  audioFeedbackVolume: 0.3, // 30% volume for feedback sounds
  voiceId: 'atlas',
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
  // Orb visualization settings (040-A)
  attractorType: 'auto', // Use state-based attractor selection
  orbColorTheme: 'auto', // Use state-based colors
  customOrbHue: 0.55, // Cyan default for custom
  orbBrightness: 1.0, // Full brightness
  orbSaturation: 1.0, // Full saturation
  autoStart: true,
  pushToTalk: false,
  wakeWord: 'Hey Atlas',
  preferredLlmProvider: 'auto',
  preferredSttProvider: 'auto',
  maxConversationHistory: 50,
  personalityPreset: 'atlas',
  personalityTraits: { ...defaultPersonalityTraits },
  showDebug: false, // Debug overlay off by default
  dailyBudget: 5.0, // $5/day default
  budgetWarningThreshold: 0.8, // Warn at 80%
};

/**
 * Initial state
 */
const initialState = {
  state: 'idle' as AtlasState,
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
 * Atlas Zustand store
 */
export const useAtlasStore = create<AtlasStore>()(
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
        localStorage.setItem('atlas-settings', JSON.stringify(currentSettings));
      } catch (e) {
        console.warn('[AtlasStore] Failed to persist settings:', e);
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
    const savedSettings = localStorage.getItem('atlas-settings');
    if (savedSettings) {
      const parsed = JSON.parse(savedSettings) as Partial<AtlasSettings>;
      useAtlasStore.getState().updateSettings(parsed);
    }
  } catch (e) {
    console.warn('[AtlasStore] Failed to load saved settings:', e);
  }
}

// Selectors for optimized re-renders
export const selectState = (state: AtlasStore) => state.state;
export const selectIsReady = (state: AtlasStore) => state.isReady;
export const selectAudioLevel = (state: AtlasStore) => state.audioLevel;
export const selectMessages = (state: AtlasStore) => state.messages;
export const selectSettings = (state: AtlasStore) => state.settings;
export const selectError = (state: AtlasStore) => state.error;
export const selectBudgetUsage = (state: AtlasStore) => state.budgetUsage;

export default useAtlasStore;
