/**
 * Atlas Desktop - Onboarding Store
 * Manages first-run experience state and progress
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

/**
 * Onboarding steps in order
 */
export type OnboardingStep = 'welcome' | 'microphone' | 'wakeWord' | 'apiKeys' | 'personalization';

/**
 * API key validation status
 */
export interface ApiKeyStatus {
  key: string;
  isValid: boolean | null;
  isValidating: boolean;
  error?: string;
}

/**
 * User personalization data
 */
export interface UserPersonalization {
  name: string;
  preferredVoice: 'default' | 'warm' | 'professional';
  enableSounds: boolean;
}

/**
 * Onboarding store state
 */
interface OnboardingStore {
  // Core state
  isComplete: boolean;
  currentStep: OnboardingStep;
  stepProgress: Record<OnboardingStep, boolean>;

  // Step 1: Microphone
  hasMicrophonePermission: boolean;
  isMicrophoneTesting: boolean;
  microphoneLevel: number;
  microphoneError: string | null;

  // Step 2: Wake word
  isWakeWordTesting: boolean;
  wakeWordDetected: boolean;
  wakeWordError: string | null;

  // Step 3: API Keys
  apiKeys: {
    porcupine: ApiKeyStatus;
    deepgram: ApiKeyStatus;
    elevenlabs: ApiKeyStatus;
    fireworks: ApiKeyStatus;
    openrouter: ApiKeyStatus;
  };

  // Step 4: Personalization
  personalization: UserPersonalization;

  // Navigation actions
  goToStep: (step: OnboardingStep) => void;
  nextStep: () => void;
  previousStep: () => void;
  completeStep: (step: OnboardingStep) => void;
  skipOnboarding: () => void;
  resetOnboarding: () => void;

  // Microphone actions
  setMicrophonePermission: (granted: boolean) => void;
  setMicrophoneTesting: (testing: boolean) => void;
  setMicrophoneLevel: (level: number) => void;
  setMicrophoneError: (error: string | null) => void;

  // Wake word actions
  setWakeWordTesting: (testing: boolean) => void;
  setWakeWordDetected: (detected: boolean) => void;
  setWakeWordError: (error: string | null) => void;

  // API key actions
  setApiKey: (key: keyof OnboardingStore['apiKeys'], value: string) => void;
  setApiKeyValidating: (key: keyof OnboardingStore['apiKeys'], validating: boolean) => void;
  setApiKeyValid: (key: keyof OnboardingStore['apiKeys'], valid: boolean, error?: string) => void;
  skipApiKeys: () => void;

  // Personalization actions
  setPersonalization: (data: Partial<UserPersonalization>) => void;

  // Complete onboarding
  finishOnboarding: () => void;
}

/**
 * Storage key for onboarding completion
 */
const ONBOARDING_STORAGE_KEY = 'atlas-onboarding-complete';
const ONBOARDING_DATA_KEY = 'atlas-onboarding-data';

/**
 * Step order for navigation
 */
const STEP_ORDER: OnboardingStep[] = ['welcome', 'microphone', 'wakeWord', 'apiKeys', 'personalization'];

/**
 * Check if onboarding was already completed
 */
function isOnboardingComplete(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(ONBOARDING_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

/**
 * Load saved onboarding data
 */
function loadOnboardingData(): Partial<UserPersonalization> | null {
  if (typeof window === 'undefined') return null;
  try {
    const data = localStorage.getItem(ONBOARDING_DATA_KEY);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

/**
 * Default API key status
 */
const defaultApiKeyStatus: ApiKeyStatus = {
  key: '',
  isValid: null,
  isValidating: false,
};

/**
 * Initial state
 */
const initialState = {
  isComplete: isOnboardingComplete(),
  currentStep: 'welcome' as OnboardingStep,
  stepProgress: {
    welcome: false,
    microphone: false,
    wakeWord: false,
    apiKeys: false,
    personalization: false,
  },
  hasMicrophonePermission: false,
  isMicrophoneTesting: false,
  microphoneLevel: 0,
  microphoneError: null,
  isWakeWordTesting: false,
  wakeWordDetected: false,
  wakeWordError: null,
  apiKeys: {
    porcupine: { ...defaultApiKeyStatus },
    deepgram: { ...defaultApiKeyStatus },
    elevenlabs: { ...defaultApiKeyStatus },
    fireworks: { ...defaultApiKeyStatus },
    openrouter: { ...defaultApiKeyStatus },
  },
  personalization: {
    name: '',
    preferredVoice: 'default' as const,
    enableSounds: true,
  },
};

/**
 * Onboarding Zustand store
 */
export const useOnboardingStore = create<OnboardingStore>()(
  subscribeWithSelector((set, get) => ({
    ...initialState,

    // Navigation actions
    goToStep: (step) => set({ currentStep: step }),

    nextStep: () => {
      const { currentStep } = get();
      const currentIndex = STEP_ORDER.indexOf(currentStep);
      if (currentIndex < STEP_ORDER.length - 1) {
        set({ currentStep: STEP_ORDER[currentIndex + 1] });
      }
    },

    previousStep: () => {
      const { currentStep } = get();
      const currentIndex = STEP_ORDER.indexOf(currentStep);
      if (currentIndex > 0) {
        set({ currentStep: STEP_ORDER[currentIndex - 1] });
      }
    },

    completeStep: (step) => {
      set((state) => ({
        stepProgress: { ...state.stepProgress, [step]: true },
      }));
    },

    skipOnboarding: () => {
      try {
        localStorage.setItem(ONBOARDING_STORAGE_KEY, 'true');
      } catch (e) {
        console.warn('[Onboarding] Failed to save skip state:', e);
      }
      set({ isComplete: true });
    },

    resetOnboarding: () => {
      try {
        localStorage.removeItem(ONBOARDING_STORAGE_KEY);
        localStorage.removeItem(ONBOARDING_DATA_KEY);
      } catch (e) {
        console.warn('[Onboarding] Failed to reset state:', e);
      }
      set({
        ...initialState,
        isComplete: false,
      });
    },

    // Microphone actions
    setMicrophonePermission: (granted) => set({ hasMicrophonePermission: granted }),
    setMicrophoneTesting: (testing) => set({ isMicrophoneTesting: testing }),
    setMicrophoneLevel: (level) => set({ microphoneLevel: level }),
    setMicrophoneError: (error) => set({ microphoneError: error }),

    // Wake word actions
    setWakeWordTesting: (testing) => set({ isWakeWordTesting: testing }),
    setWakeWordDetected: (detected) => set({ wakeWordDetected: detected }),
    setWakeWordError: (error) => set({ wakeWordError: error }),

    // API key actions
    setApiKey: (key, value) => {
      set((state) => ({
        apiKeys: {
          ...state.apiKeys,
          [key]: { ...state.apiKeys[key], key: value, isValid: null, error: undefined },
        },
      }));
    },

    setApiKeyValidating: (key, validating) => {
      set((state) => ({
        apiKeys: {
          ...state.apiKeys,
          [key]: { ...state.apiKeys[key], isValidating: validating },
        },
      }));
    },

    setApiKeyValid: (key, valid, error) => {
      set((state) => ({
        apiKeys: {
          ...state.apiKeys,
          [key]: {
            ...state.apiKeys[key],
            isValid: valid,
            isValidating: false,
            error,
          },
        },
      }));
    },

    skipApiKeys: () => {
      const { completeStep, nextStep } = get();
      completeStep('apiKeys');
      nextStep();
    },

    // Personalization actions
    setPersonalization: (data) => {
      set((state) => ({
        personalization: { ...state.personalization, ...data },
      }));
    },

    // Complete onboarding
    finishOnboarding: () => {
      const { personalization } = get();

      // Save personalization data
      try {
        localStorage.setItem(ONBOARDING_DATA_KEY, JSON.stringify(personalization));
        localStorage.setItem(ONBOARDING_STORAGE_KEY, 'true');
      } catch (e) {
        console.warn('[Onboarding] Failed to save completion:', e);
      }

      set({ isComplete: true });
    },
  }))
);

// Load saved personalization data on initialization
if (typeof window !== 'undefined') {
  const savedData = loadOnboardingData();
  if (savedData) {
    useOnboardingStore.getState().setPersonalization(savedData);
  }
}

// Selectors
export const selectCurrentStep = (state: OnboardingStore) => state.currentStep;
export const selectIsComplete = (state: OnboardingStore) => state.isComplete;
export const selectStepProgress = (state: OnboardingStore) => state.stepProgress;
export const selectApiKeys = (state: OnboardingStore) => state.apiKeys;
export const selectPersonalization = (state: OnboardingStore) => state.personalization;

// Step index helper
export const getStepIndex = (step: OnboardingStep): number => STEP_ORDER.indexOf(step);
export const getTotalSteps = (): number => STEP_ORDER.length;

export default useOnboardingStore;
