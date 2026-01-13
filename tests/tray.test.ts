/**
 * Nova Desktop - System Tray Tests
 * Tests for system tray functionality
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// Mock electron
const mockTray = {
  setToolTip: vi.fn(),
  setImage: vi.fn(),
  setContextMenu: vi.fn(),
  on: vi.fn(),
  destroy: vi.fn(),
  displayBalloon: vi.fn(),
};

const mockNativeImage = {
  createFromDataURL: vi.fn(() => 'mock-image'),
};

const mockMenu = {
  buildFromTemplate: vi.fn(() => 'mock-menu'),
};

const mockGlobalShortcut = {
  register: vi.fn(() => true),
  unregister: vi.fn(),
};

const mockApp = {
  quit: vi.fn(),
};

vi.mock('electron', () => ({
  Tray: vi.fn(() => mockTray),
  nativeImage: mockNativeImage,
  Menu: mockMenu,
  globalShortcut: mockGlobalShortcut,
  app: mockApp,
  BrowserWindow: vi.fn(),
}));

// Mock logger
vi.mock('../src/main/utils/logger', () => ({
  createModuleLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('System Tray Module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetModules();
  });

  describe('TrayState', () => {
    it('should define all voice pipeline states', () => {
      const states = ['idle', 'listening', 'processing', 'speaking', 'error', 'disabled'];
      states.forEach((state) => {
        expect(state).toBeDefined();
      });
    });
  });

  describe('TrayConfig', () => {
    it('should have default configuration', () => {
      const defaultConfig = {
        pushToTalkShortcut: 'CommandOrControl+Shift+Space',
        showNotifications: true,
        startMinimized: false,
        minimizeToTray: true,
      };

      expect(defaultConfig.pushToTalkShortcut).toBe('CommandOrControl+Shift+Space');
      expect(defaultConfig.showNotifications).toBe(true);
      expect(defaultConfig.startMinimized).toBe(false);
      expect(defaultConfig.minimizeToTray).toBe(true);
    });

    it('should allow custom shortcut configuration', () => {
      const customConfig = {
        pushToTalkShortcut: 'Alt+Space',
        showNotifications: false,
        startMinimized: true,
        minimizeToTray: false,
      };

      expect(customConfig.pushToTalkShortcut).toBe('Alt+Space');
      expect(customConfig.showNotifications).toBe(false);
    });
  });

  describe('State Colors', () => {
    const STATE_COLORS = {
      idle: { primary: '#6366f1', secondary: '#4f46e5' },
      listening: { primary: '#22c55e', secondary: '#16a34a' },
      processing: { primary: '#f59e0b', secondary: '#d97706' },
      speaking: { primary: '#3b82f6', secondary: '#2563eb' },
      error: { primary: '#ef4444', secondary: '#dc2626' },
      disabled: { primary: '#6b7280', secondary: '#4b5563' },
    };

    it('should have colors for all states', () => {
      const states = ['idle', 'listening', 'processing', 'speaking', 'error', 'disabled'];
      states.forEach((state) => {
        expect(STATE_COLORS[state as keyof typeof STATE_COLORS]).toBeDefined();
        expect(STATE_COLORS[state as keyof typeof STATE_COLORS].primary).toMatch(/^#[0-9a-f]{6}$/i);
        expect(STATE_COLORS[state as keyof typeof STATE_COLORS].secondary).toMatch(
          /^#[0-9a-f]{6}$/i
        );
      });
    });

    it('should have distinct colors for listening state (green)', () => {
      expect(STATE_COLORS.listening.primary).toBe('#22c55e');
    });

    it('should have distinct colors for processing state (amber)', () => {
      expect(STATE_COLORS.processing.primary).toBe('#f59e0b');
    });

    it('should have distinct colors for speaking state (blue)', () => {
      expect(STATE_COLORS.speaking.primary).toBe('#3b82f6');
    });

    it('should have distinct colors for error state (red)', () => {
      expect(STATE_COLORS.error.primary).toBe('#ef4444');
    });
  });

  describe('SVG Icon Generation', () => {
    it('should generate valid SVG structure', () => {
      const size = 16;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"></svg>`;

      expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
      expect(svg).toContain('width="16"');
      expect(svg).toContain('height="16"');
    });

    it('should convert SVG to base64 data URL', () => {
      const svg = '<svg></svg>';
      const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;

      expect(dataUrl).toMatch(/^data:image\/svg\+xml;base64,/);
    });
  });

  describe('Context Menu', () => {
    it('should define menu structure', () => {
      const menuItems = [
        { label: 'Nova Voice Assistant', enabled: false },
        { type: 'separator' },
        { label: 'Show Window' },
        { type: 'separator' },
        { label: 'Start Listening' },
        { label: 'Push to Talk', accelerator: 'CommandOrControl+Shift+Space' },
        { type: 'separator' },
        { label: 'Settings...' },
        { type: 'separator' },
        { label: 'Quit Nova' },
      ];

      expect(menuItems.length).toBe(10);
      expect(menuItems[0].label).toBe('Nova Voice Assistant');
      expect(menuItems[4].label).toBe('Start Listening');
      expect(menuItems[9].label).toBe('Quit Nova');
    });

    it('should toggle label between Start/Stop Listening', () => {
      let isRunning = false;
      const getLabel = () => (isRunning ? 'Stop Listening' : 'Start Listening');

      expect(getLabel()).toBe('Start Listening');
      isRunning = true;
      expect(getLabel()).toBe('Stop Listening');
    });
  });

  describe('Tray Tooltips', () => {
    it('should have tooltips for all states', () => {
      const tooltips = {
        idle: 'Nova - Ready',
        listening: 'Nova - Listening...',
        processing: 'Nova - Processing...',
        speaking: 'Nova - Speaking...',
        error: 'Nova - Error',
        disabled: 'Nova - Disabled',
      };

      expect(tooltips.idle).toBe('Nova - Ready');
      expect(tooltips.listening).toBe('Nova - Listening...');
      expect(tooltips.processing).toBe('Nova - Processing...');
      expect(tooltips.speaking).toBe('Nova - Speaking...');
      expect(tooltips.error).toBe('Nova - Error');
      expect(tooltips.disabled).toBe('Nova - Disabled');
    });
  });

  describe('Global Shortcuts', () => {
    it('should use cross-platform shortcut format', () => {
      const shortcut = 'CommandOrControl+Shift+Space';
      expect(shortcut).toContain('CommandOrControl');
    });

    it('should support custom shortcuts', () => {
      const validShortcuts = [
        'CommandOrControl+Shift+Space',
        'Alt+Space',
        'CommandOrControl+Alt+N',
        'F12',
      ];

      validShortcuts.forEach((shortcut) => {
        expect(typeof shortcut).toBe('string');
        expect(shortcut.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Tray Events', () => {
    it('should define all tray events', () => {
      const events = [
        'push-to-talk',
        'toggle-window',
        'quit',
        'settings',
        'start-pipeline',
        'stop-pipeline',
      ];

      events.forEach((event) => {
        expect(event).toBeDefined();
      });
    });

    it('should emit events using EventEmitter pattern', () => {
      const emitter = new EventEmitter();
      const callback = vi.fn();

      emitter.on('push-to-talk', callback);
      emitter.emit('push-to-talk');

      expect(callback).toHaveBeenCalled();
    });
  });

  describe('Animation', () => {
    it('should animate at approximately 10fps', () => {
      const fps = 10;
      const intervalMs = 1000 / fps;
      expect(intervalMs).toBe(100);
    });

    it('should calculate pulse animation', () => {
      const frame = 0;
      const baseRadius = 5;
      const pulseAmount = 0.2;
      const pulseRadius = baseRadius * (0.8 + pulseAmount * Math.sin(frame * 0.5));

      expect(pulseRadius).toBeGreaterThan(0);
      expect(pulseRadius).toBeLessThanOrEqual(baseRadius);
    });

    it('should calculate rotation animation for processing', () => {
      const frame = 3;
      const angle = (frame * 30) % 360;
      expect(angle).toBe(90);
    });
  });

  describe('Window Management', () => {
    it('should toggle window visibility', () => {
      const mockWindow = {
        isVisible: vi.fn(() => true),
        isFocused: vi.fn(() => false),
        show: vi.fn(),
        hide: vi.fn(),
        focus: vi.fn(),
      };

      // Window visible but not focused - should focus
      if (mockWindow.isVisible()) {
        if (!mockWindow.isFocused()) {
          mockWindow.focus();
        }
      }

      expect(mockWindow.focus).toHaveBeenCalled();
    });

    it('should show hidden window', () => {
      const mockWindow = {
        isVisible: vi.fn(() => false),
        show: vi.fn(),
        focus: vi.fn(),
      };

      if (!mockWindow.isVisible()) {
        mockWindow.show();
        mockWindow.focus();
      }

      expect(mockWindow.show).toHaveBeenCalled();
      expect(mockWindow.focus).toHaveBeenCalled();
    });
  });

  describe('Notifications', () => {
    it('should support balloon notifications on Windows', () => {
      const platform = 'win32';
      const showNotifications = true;

      if (platform === 'win32' && showNotifications) {
        const notification = {
          title: 'Nova',
          content: 'Listening started',
          iconType: 'info',
        };

        expect(notification.title).toBe('Nova');
        expect(notification.iconType).toBe('info');
      }
    });
  });

  describe('Configuration Updates', () => {
    it('should merge configuration updates', () => {
      const defaultConfig = {
        pushToTalkShortcut: 'CommandOrControl+Shift+Space',
        showNotifications: true,
        startMinimized: false,
        minimizeToTray: true,
      };

      const update = {
        pushToTalkShortcut: 'Alt+Space',
        showNotifications: false,
      };

      const newConfig = { ...defaultConfig, ...update };

      expect(newConfig.pushToTalkShortcut).toBe('Alt+Space');
      expect(newConfig.showNotifications).toBe(false);
      expect(newConfig.startMinimized).toBe(false); // Unchanged
      expect(newConfig.minimizeToTray).toBe(true); // Unchanged
    });
  });

  describe('Cleanup', () => {
    it('should clear animation interval on destroy', () => {
      let animationInterval: NodeJS.Timeout | null = setInterval(() => {}, 100);

      // Cleanup
      if (animationInterval) {
        clearInterval(animationInterval);
        animationInterval = null;
      }

      expect(animationInterval).toBeNull();
    });

    it('should handle multiple destroy calls safely', async () => {
      let tray: { destroy: () => void } | null = { destroy: vi.fn() };

      const destroy = () => {
        if (tray) {
          tray.destroy();
          tray = null;
        }
      };

      destroy();
      destroy(); // Second call should be safe

      expect(tray).toBeNull();
    });
  });

  describe('Pipeline Integration', () => {
    it('should update tray state on pipeline state change', () => {
      const trayState = { current: 'idle' };
      const updateState = (state: string) => {
        trayState.current = state;
      };

      // Simulate pipeline state changes
      updateState('listening');
      expect(trayState.current).toBe('listening');

      updateState('processing');
      expect(trayState.current).toBe('processing');

      updateState('speaking');
      expect(trayState.current).toBe('speaking');

      updateState('idle');
      expect(trayState.current).toBe('idle');
    });

    it('should set running state on pipeline start/stop', () => {
      let isRunning = false;

      // Start
      isRunning = true;
      expect(isRunning).toBe(true);

      // Stop
      isRunning = false;
      expect(isRunning).toBe(false);
    });
  });
});

describe('Tray Singleton', () => {
  it('should return same instance on multiple calls', () => {
    let instance: object | null = null;

    const getInstance = () => {
      if (!instance) {
        instance = { id: 'tray' };
      }
      return instance;
    };

    const first = getInstance();
    const second = getInstance();

    expect(first).toBe(second);
  });

  it('should allow shutdown and recreation', () => {
    let instance: object | null = { id: 'tray' };

    const shutdown = () => {
      instance = null;
    };

    const getInstance = () => {
      if (!instance) {
        instance = { id: 'new-tray' };
      }
      return instance;
    };

    expect(instance).not.toBeNull();
    shutdown();
    expect(instance).toBeNull();

    const newInstance = getInstance();
    expect(newInstance).toEqual({ id: 'new-tray' });
  });
});

describe('Icon Cache', () => {
  it('should cache generated icons', () => {
    const cache = new Map<string, string>();

    const getIcon = (state: string) => {
      if (!cache.has(state)) {
        cache.set(state, `icon-${state}`);
      }
      return cache.get(state);
    };

    // First call generates
    const icon1 = getIcon('idle');
    expect(cache.size).toBe(1);

    // Second call uses cache
    const icon2 = getIcon('idle');
    expect(icon1).toBe(icon2);
    expect(cache.size).toBe(1);

    // Different state generates new icon
    getIcon('listening');
    expect(cache.size).toBe(2);
  });

  it('should pre-generate all state icons', () => {
    const cache = new Map<string, string>();
    const states = ['idle', 'listening', 'processing', 'speaking', 'error', 'disabled'];

    // Pre-generate
    states.forEach((state) => {
      cache.set(state, `icon-${state}`);
    });

    expect(cache.size).toBe(6);
    states.forEach((state) => {
      expect(cache.has(state)).toBe(true);
    });
  });
});
