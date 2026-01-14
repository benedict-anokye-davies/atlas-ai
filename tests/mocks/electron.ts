/**
 * Electron Mock Utilities
 * Mock implementations for Electron APIs for testing main process code
 */

import { vi } from 'vitest';

/**
 * Creates a mock BrowserWindow
 */
export function createMockBrowserWindow(options: {
  focused?: boolean;
  visible?: boolean;
  minimized?: boolean;
  bounds?: { x: number; y: number; width: number; height: number };
} = {}) {
  const { focused = false, visible = true, minimized = false, bounds = { x: 0, y: 0, width: 800, height: 600 } } = options;

  return {
    id: Math.floor(Math.random() * 1000),
    webContents: {
      send: vi.fn(),
      on: vi.fn(),
      openDevTools: vi.fn(),
      closeDevTools: vi.fn(),
      isDevToolsOpened: vi.fn().mockReturnValue(false),
    },
    show: vi.fn(),
    hide: vi.fn(),
    close: vi.fn(),
    destroy: vi.fn(),
    focus: vi.fn(),
    blur: vi.fn(),
    minimize: vi.fn(),
    maximize: vi.fn(),
    restore: vi.fn(),
    isMinimized: vi.fn().mockReturnValue(minimized),
    isMaximized: vi.fn().mockReturnValue(false),
    isVisible: vi.fn().mockReturnValue(visible),
    isFocused: vi.fn().mockReturnValue(focused),
    getBounds: vi.fn().mockReturnValue(bounds),
    setBounds: vi.fn(),
    setPosition: vi.fn(),
    getPosition: vi.fn().mockReturnValue([bounds.x, bounds.y]),
    setSize: vi.fn(),
    getSize: vi.fn().mockReturnValue([bounds.width, bounds.height]),
    on: vi.fn(),
    once: vi.fn(),
    removeAllListeners: vi.fn(),
  };
}

/**
 * Creates a mock app module
 */
export function createMockApp() {
  return {
    getPath: vi.fn((name: string) => {
      const paths: Record<string, string> = {
        userData: '/mock/user/data',
        appData: '/mock/app/data',
        temp: '/mock/temp',
        home: '/mock/home',
        desktop: '/mock/desktop',
        documents: '/mock/documents',
        downloads: '/mock/downloads',
      };
      return paths[name] || `/mock/${name}`;
    }),
    getVersion: vi.fn().mockReturnValue('0.1.0'),
    getName: vi.fn().mockReturnValue('Nova'),
    isReady: vi.fn().mockReturnValue(true),
    whenReady: vi.fn().mockResolvedValue(undefined),
    quit: vi.fn(),
    exit: vi.fn(),
    relaunch: vi.fn(),
    focus: vi.fn(),
    hide: vi.fn(),
    show: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
  };
}

/**
 * Creates a mock ipcMain module
 */
export function createMockIpcMain() {
  const handlers = new Map<string, Function>();
  return {
    handle: vi.fn((channel: string, handler: Function) => {
      handlers.set(channel, handler);
    }),
    removeHandler: vi.fn((channel: string) => {
      handlers.delete(channel);
    }),
    on: vi.fn(),
    once: vi.fn(),
    removeAllListeners: vi.fn(),
    _handlers: handlers,
    _invokeHandler: async (channel: string, ...args: unknown[]) => {
      const handler = handlers.get(channel);
      if (handler) {
        return handler({ sender: {} }, ...args);
      }
      throw new Error(`No handler for channel: ${channel}`);
    },
  };
}

/**
 * Creates a mock dialog module
 */
export function createMockDialog() {
  return {
    showOpenDialog: vi.fn().mockResolvedValue({ canceled: false, filePaths: ['/mock/file.txt'] }),
    showSaveDialog: vi.fn().mockResolvedValue({ canceled: false, filePath: '/mock/save.txt' }),
    showMessageBox: vi.fn().mockResolvedValue({ response: 0 }),
    showErrorBox: vi.fn(),
  };
}

/**
 * Creates a mock Tray
 */
export function createMockTray() {
  return {
    setImage: vi.fn(),
    setToolTip: vi.fn(),
    setContextMenu: vi.fn(),
    on: vi.fn(),
    destroy: vi.fn(),
    isDestroyed: vi.fn().mockReturnValue(false),
  };
}

/**
 * Creates a mock Menu
 */
export function createMockMenu() {
  return {
    append: vi.fn(),
    insert: vi.fn(),
    items: [],
    popup: vi.fn(),
    closePopup: vi.fn(),
  };
}

/**
 * Creates a mock nativeImage
 */
export function createMockNativeImage() {
  return {
    createFromPath: vi.fn().mockReturnValue({
      isEmpty: vi.fn().mockReturnValue(false),
      getSize: vi.fn().mockReturnValue({ width: 16, height: 16 }),
      resize: vi.fn().mockReturnThis(),
      toPNG: vi.fn().mockReturnValue(Buffer.from([0x89, 0x50, 0x4e, 0x47])),
    }),
    createEmpty: vi.fn().mockReturnValue({
      isEmpty: vi.fn().mockReturnValue(true),
    }),
  };
}

/**
 * Factory function to create complete Electron mock
 */
export function createElectronMock() {
  const focusedWindow = createMockBrowserWindow({ focused: true });
  const allWindows = [focusedWindow];

  return {
    app: createMockApp(),
    BrowserWindow: Object.assign(vi.fn().mockImplementation(() => createMockBrowserWindow()), {
      getFocusedWindow: vi.fn().mockReturnValue(focusedWindow),
      getAllWindows: vi.fn().mockReturnValue(allWindows),
    }),
    ipcMain: createMockIpcMain(),
    dialog: createMockDialog(),
    Tray: vi.fn().mockImplementation(() => createMockTray()),
    Menu: Object.assign(vi.fn().mockImplementation(() => createMockMenu()), {
      buildFromTemplate: vi.fn().mockReturnValue(createMockMenu()),
      setApplicationMenu: vi.fn(),
    }),
    nativeImage: createMockNativeImage(),
    shell: {
      openExternal: vi.fn().mockResolvedValue(undefined),
      openPath: vi.fn().mockResolvedValue(''),
    },
    clipboard: {
      readText: vi.fn().mockReturnValue(''),
      writeText: vi.fn(),
      readImage: vi.fn().mockReturnValue(createMockNativeImage().createEmpty()),
      writeImage: vi.fn(),
    },
  };
}
