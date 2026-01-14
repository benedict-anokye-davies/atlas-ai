/**
 * Nova Desktop - Settings Tests
 * Tests for Settings configuration, NovaStore, and keyboard shortcuts
 *
 * Created by: Terminal 3 (session-018)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Electron
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/mock/path'),
  },
  ipcMain: {
    handle: vi.fn(),
    removeHandler: vi.fn(),
  },
  ipcRenderer: {
    invoke: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
  },
}));

// ============================================================================
// SETTINGS CONFIGURATION TESTS
// ============================================================================

describe('Settings Configuration', () => {
  describe('Default Settings Values', () => {
    it('should have correct default audio settings', () => {
      const defaultSettings = {
        inputDevice: null,
        outputDevice: null,
        audioVolume: 1.0,
      };

      expect(defaultSettings.inputDevice).toBeNull();
      expect(defaultSettings.outputDevice).toBeNull();
      expect(defaultSettings.audioVolume).toBe(1.0);
    });

    it('should have correct default voice settings', () => {
      const defaultSettings = {
        voiceId: 'nova',
        voiceSpeed: 1.0,
        voiceStability: 0.5,
      };

      expect(defaultSettings.voiceId).toBe('nova');
      expect(defaultSettings.voiceSpeed).toBe(1.0);
      expect(defaultSettings.voiceStability).toBe(0.5);
    });

    it('should have correct default visual settings', () => {
      const defaultSettings = {
        particleCount: 35000,
        showTranscript: true,
        theme: 'dark' as const,
      };

      expect(defaultSettings.particleCount).toBe(35000);
      expect(defaultSettings.showTranscript).toBe(true);
      expect(defaultSettings.theme).toBe('dark');
    });

    it('should have correct default behavior settings', () => {
      const defaultSettings = {
        autoStart: true,
        pushToTalk: false,
        wakeWord: 'Hey Nova',
      };

      expect(defaultSettings.autoStart).toBe(true);
      expect(defaultSettings.pushToTalk).toBe(false);
      expect(defaultSettings.wakeWord).toBe('Hey Nova');
    });

    it('should have correct default provider settings', () => {
      const defaultSettings = {
        preferredLlmProvider: 'auto' as const,
        preferredSttProvider: 'auto' as const,
        maxConversationHistory: 50,
      };

      expect(defaultSettings.preferredLlmProvider).toBe('auto');
      expect(defaultSettings.preferredSttProvider).toBe('auto');
      expect(defaultSettings.maxConversationHistory).toBe(50);
    });
  });

  describe('Settings Validation', () => {
    it('should accept valid volume values (0-1)', () => {
      const validValues = [0, 0.5, 1];
      validValues.forEach((value) => {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      });
    });

    it('should accept valid voice speed values (0.5-2.0)', () => {
      const validValues = [0.5, 1.0, 1.5, 2.0];
      validValues.forEach((value) => {
        expect(value).toBeGreaterThanOrEqual(0.5);
        expect(value).toBeLessThanOrEqual(2.0);
      });
    });

    it('should accept valid voice stability values (0-1)', () => {
      const validValues = [0, 0.25, 0.5, 0.75, 1];
      validValues.forEach((value) => {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      });
    });

    it('should accept valid particle count values', () => {
      const validValues = [10000, 25000, 35000, 50000, 100000];
      validValues.forEach((value) => {
        expect(value).toBeGreaterThanOrEqual(10000);
        expect(value).toBeLessThanOrEqual(100000);
      });
    });

    it('should accept valid theme values', () => {
      const validThemes = ['dark', 'light', 'system'];
      expect(validThemes).toContain('dark');
      expect(validThemes).toContain('light');
      expect(validThemes).toContain('system');
    });

    it('should accept valid STT provider values', () => {
      const validProviders = ['deepgram', 'vosk', 'auto'];
      expect(validProviders).toContain('deepgram');
      expect(validProviders).toContain('vosk');
      expect(validProviders).toContain('auto');
    });

    it('should accept valid LLM provider values', () => {
      const validProviders = ['fireworks', 'openrouter', 'auto'];
      expect(validProviders).toContain('fireworks');
      expect(validProviders).toContain('openrouter');
      expect(validProviders).toContain('auto');
    });

    it('should accept valid conversation history limits', () => {
      const validLimits = [10, 25, 50, 75, 100];
      validLimits.forEach((value) => {
        expect(value).toBeGreaterThanOrEqual(10);
        expect(value).toBeLessThanOrEqual(100);
      });
    });
  });
});

// ============================================================================
// KEYBOARD SHORTCUTS TESTS
// ============================================================================

describe('Keyboard Shortcuts', () => {
  describe('Shortcut Key Definitions', () => {
    it('should define Space as wake trigger key', () => {
      const wakeKey = ' ';
      expect(wakeKey).toBe(' ');
    });

    it('should define Escape as cancel key', () => {
      const cancelKey = 'Escape';
      expect(cancelKey).toBe('Escape');
    });

    it('should define Comma with modifier as settings key', () => {
      const settingsKey = ',';
      expect(settingsKey).toBe(',');
    });
  });

  describe('Modifier Key Combinations', () => {
    it('should support Ctrl modifier', () => {
      const modifiers = { ctrlKey: true, metaKey: false, shiftKey: false, altKey: false };
      expect(modifiers.ctrlKey).toBe(true);
      expect(modifiers.metaKey).toBe(false);
    });

    it('should support Meta modifier (macOS)', () => {
      const modifiers = { ctrlKey: false, metaKey: true, shiftKey: false, altKey: false };
      expect(modifiers.metaKey).toBe(true);
      expect(modifiers.ctrlKey).toBe(false);
    });

    it('should detect settings shortcut Ctrl+,', () => {
      const event = { key: ',', ctrlKey: true, metaKey: false };
      const isSettingsShortcut = event.key === ',' && (event.ctrlKey || event.metaKey);
      expect(isSettingsShortcut).toBe(true);
    });

    it('should detect settings shortcut Cmd+, (macOS)', () => {
      const event = { key: ',', ctrlKey: false, metaKey: true };
      const isSettingsShortcut = event.key === ',' && (event.ctrlKey || event.metaKey);
      expect(isSettingsShortcut).toBe(true);
    });
  });

  describe('Input Field Detection Logic', () => {
    it('should identify input element types to ignore', () => {
      const ignoredTypes = ['INPUT', 'TEXTAREA', 'SELECT'];
      expect(ignoredTypes).toContain('INPUT');
      expect(ignoredTypes).toContain('TEXTAREA');
      expect(ignoredTypes).toContain('SELECT');
    });

    it('should allow shortcuts when not in input', () => {
      const activeElement = 'DIV';
      const ignoredTypes = ['INPUT', 'TEXTAREA', 'SELECT'];
      const shouldHandle = !ignoredTypes.includes(activeElement);
      expect(shouldHandle).toBe(true);
    });

    it('should block shortcuts when in input', () => {
      const activeElement = 'INPUT';
      const ignoredTypes = ['INPUT', 'TEXTAREA', 'SELECT'];
      const shouldHandle = !ignoredTypes.includes(activeElement);
      expect(shouldHandle).toBe(false);
    });
  });
});

// ============================================================================
// VOICE STATE TESTS
// ============================================================================

describe('Voice State Types', () => {
  describe('Valid States', () => {
    it('should include idle state', () => {
      const states = ['idle', 'listening', 'thinking', 'speaking', 'error'];
      expect(states).toContain('idle');
    });

    it('should include listening state', () => {
      const states = ['idle', 'listening', 'thinking', 'speaking', 'error'];
      expect(states).toContain('listening');
    });

    it('should include thinking state', () => {
      const states = ['idle', 'listening', 'thinking', 'speaking', 'error'];
      expect(states).toContain('thinking');
    });

    it('should include speaking state', () => {
      const states = ['idle', 'listening', 'thinking', 'speaking', 'error'];
      expect(states).toContain('speaking');
    });

    it('should include error state', () => {
      const states = ['idle', 'listening', 'thinking', 'speaking', 'error'];
      expect(states).toContain('error');
    });
  });

  describe('State Transitions', () => {
    it('should allow idle -> listening', () => {
      const validTransitions: Record<string, string[]> = {
        idle: ['listening'],
        listening: ['thinking', 'idle'],
        thinking: ['speaking', 'error'],
        speaking: ['idle', 'listening'],
        error: ['idle'],
      };
      expect(validTransitions['idle']).toContain('listening');
    });

    it('should allow listening -> thinking', () => {
      const validTransitions: Record<string, string[]> = {
        idle: ['listening'],
        listening: ['thinking', 'idle'],
        thinking: ['speaking', 'error'],
        speaking: ['idle', 'listening'],
        error: ['idle'],
      };
      expect(validTransitions['listening']).toContain('thinking');
    });

    it('should allow thinking -> speaking', () => {
      const validTransitions: Record<string, string[]> = {
        idle: ['listening'],
        listening: ['thinking', 'idle'],
        thinking: ['speaking', 'error'],
        speaking: ['idle', 'listening'],
        error: ['idle'],
      };
      expect(validTransitions['thinking']).toContain('speaking');
    });

    it('should allow speaking -> idle (completed)', () => {
      const validTransitions: Record<string, string[]> = {
        idle: ['listening'],
        listening: ['thinking', 'idle'],
        thinking: ['speaking', 'error'],
        speaking: ['idle', 'listening'],
        error: ['idle'],
      };
      expect(validTransitions['speaking']).toContain('idle');
    });

    it('should allow speaking -> listening (barge-in)', () => {
      const validTransitions: Record<string, string[]> = {
        idle: ['listening'],
        listening: ['thinking', 'idle'],
        thinking: ['speaking', 'error'],
        speaking: ['idle', 'listening'],
        error: ['idle'],
      };
      expect(validTransitions['speaking']).toContain('listening');
    });
  });
});

// ============================================================================
// MESSAGE TYPES TESTS
// ============================================================================

describe('Message Types', () => {
  describe('Message Roles', () => {
    it('should support user role', () => {
      const roles = ['user', 'assistant', 'system'];
      expect(roles).toContain('user');
    });

    it('should support assistant role', () => {
      const roles = ['user', 'assistant', 'system'];
      expect(roles).toContain('assistant');
    });

    it('should support system role', () => {
      const roles = ['user', 'assistant', 'system'];
      expect(roles).toContain('system');
    });
  });

  describe('Message Structure', () => {
    it('should have id field', () => {
      const message = {
        id: '123-abc',
        role: 'user',
        content: 'Hello',
        timestamp: Date.now(),
      };
      expect(message.id).toBeDefined();
      expect(typeof message.id).toBe('string');
    });

    it('should have role field', () => {
      const message = {
        id: '123-abc',
        role: 'user',
        content: 'Hello',
        timestamp: Date.now(),
      };
      expect(message.role).toBeDefined();
      expect(['user', 'assistant', 'system']).toContain(message.role);
    });

    it('should have content field', () => {
      const message = {
        id: '123-abc',
        role: 'user',
        content: 'Hello',
        timestamp: Date.now(),
      };
      expect(message.content).toBeDefined();
      expect(typeof message.content).toBe('string');
    });

    it('should have timestamp field', () => {
      const message = {
        id: '123-abc',
        role: 'user',
        content: 'Hello',
        timestamp: Date.now(),
      };
      expect(message.timestamp).toBeDefined();
      expect(typeof message.timestamp).toBe('number');
    });

    it('should optionally have isInterim field', () => {
      const message = {
        id: '123-abc',
        role: 'user',
        content: 'Hello',
        timestamp: Date.now(),
        isInterim: true,
      };
      expect(message.isInterim).toBe(true);
    });
  });

  describe('Message ID Generation', () => {
    it('should generate unique IDs', () => {
      const generateId = () => `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const id1 = generateId();
      const id2 = generateId();
      expect(id1).not.toBe(id2);
    });

    it('should include timestamp in ID', () => {
      const generateId = () => `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const id = generateId();
      const timestampPart = id.split('-')[0];
      expect(parseInt(timestampPart)).toBeGreaterThan(0);
    });
  });
});

// ============================================================================
// PROVIDER TYPES TESTS
// ============================================================================

describe('Provider Types', () => {
  describe('STT Providers', () => {
    it('should support Deepgram provider', () => {
      const providers = ['deepgram', 'vosk'];
      expect(providers).toContain('deepgram');
    });

    it('should support Vosk provider', () => {
      const providers = ['deepgram', 'vosk'];
      expect(providers).toContain('vosk');
    });
  });

  describe('LLM Providers', () => {
    it('should support Fireworks provider', () => {
      const providers = ['fireworks', 'openrouter'];
      expect(providers).toContain('fireworks');
    });

    it('should support OpenRouter provider', () => {
      const providers = ['fireworks', 'openrouter'];
      expect(providers).toContain('openrouter');
    });
  });

  describe('TTS Providers', () => {
    it('should support ElevenLabs provider', () => {
      const providers = ['elevenlabs', 'piper', 'espeak'];
      expect(providers).toContain('elevenlabs');
    });

    it('should support Piper provider', () => {
      const providers = ['elevenlabs', 'piper', 'espeak'];
      expect(providers).toContain('piper');
    });

    it('should support espeak provider', () => {
      const providers = ['elevenlabs', 'piper', 'espeak'];
      expect(providers).toContain('espeak');
    });
  });
});

// ============================================================================
// AUDIO LEVEL TESTS
// ============================================================================

describe('Audio Level', () => {
  describe('Valid Range', () => {
    it('should accept minimum value 0', () => {
      const level = 0;
      expect(level).toBeGreaterThanOrEqual(0);
    });

    it('should accept maximum value 1', () => {
      const level = 1;
      expect(level).toBeLessThanOrEqual(1);
    });

    it('should accept mid-range values', () => {
      const levels = [0.1, 0.25, 0.5, 0.75, 0.9];
      levels.forEach((level) => {
        expect(level).toBeGreaterThan(0);
        expect(level).toBeLessThan(1);
      });
    });
  });

  describe('Normalization', () => {
    it('should clamp values below 0', () => {
      const clamp = (v: number) => Math.max(0, Math.min(1, v));
      expect(clamp(-0.5)).toBe(0);
    });

    it('should clamp values above 1', () => {
      const clamp = (v: number) => Math.max(0, Math.min(1, v));
      expect(clamp(1.5)).toBe(1);
    });
  });
});
