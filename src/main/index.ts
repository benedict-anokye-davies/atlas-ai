/**
 * Nova Desktop - Electron Main Process
 * Entry point for the Electron application
 */

import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'path';
import { isConfigValid, getSafeConfig, getConfigValidation } from './config';
import {
  mainLogger,
  ipcLogger,
  voiceLogger,
  createModuleLogger,
  shutdownLogger,
  PerformanceTimer,
} from './utils/logger';
import { WakeWordDetector, getWakeWordDetector, shutdownWakeWordDetector } from './voice/wake-word';
import { AudioPipeline, getAudioPipeline, shutdownAudioPipeline } from './voice/pipeline';
import { getVoicePipeline, shutdownVoicePipeline, VoicePipeline } from './voice/voice-pipeline';
import { registerIPCHandlers, setMainWindow, cleanupIPC } from './ipc';
import { initializeTray, shutdownTray, NovaTray } from './tray';
import type { WakeWordEvent, VoicePipelineState, SpeechSegment } from '../shared/types/voice';

// Keep a global reference of the window object
let mainWindow: BrowserWindow | null = null;

// System tray instance
let tray: NovaTray | null = null;

// Full voice pipeline instance (for tray integration)
let fullVoicePipeline: VoicePipeline | null = null;

// Check if we're in development mode
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

// Performance timer for startup
const startupTimer = new PerformanceTimer('Startup');

/**
 * Create the main application window
 */
function createWindow(): void {
  startupTimer.start('createWindow');

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true, // Enable sandbox for security - native modules handled via IPC
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
    frame: true,
    show: false, // Don't show until ready
    backgroundColor: '#0a0a0f', // Dark background matching Nova theme
    title: 'Nova',
  });

  // Load the app
  if (isDev) {
    // In development, load from Vite dev server
    mainWindow.loadURL('http://localhost:5173');
    // Open DevTools in development
    mainWindow.webContents.openDevTools();
  } else {
    // In production, load from built files
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  // Show window when ready to prevent visual flash
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    startupTimer.end('createWindow');
    mainLogger.info('Main window ready');
  });

  // Handle window closed
  mainWindow.on('closed', () => {
    mainWindow = null;
    mainLogger.info('Main window closed');
  });

  // Log any load errors
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    mainLogger.error(`Failed to load: ${errorCode} - ${errorDescription}`);
  });
}

/**
 * App lifecycle events
 */

// Create window when Electron is ready
app.whenReady().then(async () => {
  startupTimer.end('appReady');
  mainLogger.info('App ready, creating window...');

  // Register voice pipeline IPC handlers
  registerIPCHandlers();

  createWindow();

  // Set the main window for IPC event forwarding
  if (mainWindow) {
    setMainWindow(mainWindow);
  }

  // Initialize system tray
  try {
    tray = await initializeTray(mainWindow || undefined);
    setupTrayIntegration();
    mainLogger.info('System tray initialized');
  } catch (error) {
    mainLogger.error('Failed to initialize system tray', { error: (error as Error).message });
  }

  // On macOS, re-create window when dock icon is clicked
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      if (mainWindow) {
        setMainWindow(mainWindow);
        tray?.setMainWindow(mainWindow);
      }
    }
  });
});

/**
 * Setup tray integration with voice pipeline
 */
function setupTrayIntegration(): void {
  if (!tray) return;

  // Handle push-to-talk from tray
  tray.on('push-to-talk', async () => {
    voiceLogger.info('Push-to-talk triggered from tray');
    try {
      if (!fullVoicePipeline) {
        fullVoicePipeline = getVoicePipeline();
        connectPipelineToTray(fullVoicePipeline);
      }
      fullVoicePipeline.triggerWake();
    } catch (error) {
      voiceLogger.error('Push-to-talk failed', { error: (error as Error).message });
    }
  });

  // Handle start pipeline from tray
  tray.on('start-pipeline', async () => {
    voiceLogger.info('Starting pipeline from tray');
    try {
      if (!fullVoicePipeline) {
        fullVoicePipeline = getVoicePipeline();
        connectPipelineToTray(fullVoicePipeline);
      }
      await fullVoicePipeline.start();
      tray?.setRunning(true);
    } catch (error) {
      voiceLogger.error('Failed to start pipeline from tray', { error: (error as Error).message });
    }
  });

  // Handle stop pipeline from tray
  tray.on('stop-pipeline', async () => {
    voiceLogger.info('Stopping pipeline from tray');
    try {
      if (fullVoicePipeline) {
        await fullVoicePipeline.stop();
        tray?.setRunning(false);
      }
    } catch (error) {
      voiceLogger.error('Failed to stop pipeline from tray', { error: (error as Error).message });
    }
  });

  // Handle toggle window from tray
  tray.on('toggle-window', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });

  // Handle settings from tray
  tray.on('settings', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
      // Send event to renderer to open settings
      mainWindow.webContents.send('nova:open-settings');
    }
  });

  voiceLogger.info('Tray integration setup complete');
}

/**
 * Connect voice pipeline events to tray state
 */
function connectPipelineToTray(pipeline: VoicePipeline): void {
  if (!tray) return;

  pipeline.on('state-change', (state: VoicePipelineState) => {
    tray?.setState(state);
  });

  pipeline.on('started', () => {
    tray?.setRunning(true);
    tray?.setState('idle');
  });

  pipeline.on('stopped', () => {
    tray?.setRunning(false);
    tray?.setState('idle');
  });

  pipeline.on('error', () => {
    tray?.setState('error');
  });

  voiceLogger.info('Pipeline connected to tray');
}

// Quit when all windows are closed (except on macOS)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    mainLogger.info('All windows closed, quitting app');
    app.quit();
  }
});

// Track if cleanup is in progress to prevent double cleanup
let isCleaningUp = false;

// Handle app before quit - use will-quit with proper async handling
app.on('will-quit', (event) => {
  // Prevent default quit to allow async cleanup
  if (!isCleaningUp) {
    event.preventDefault();
    isCleaningUp = true;

    mainLogger.info('App quitting, cleaning up...');

    // Perform async cleanup then exit
    Promise.all([
      shutdownTray().catch((e) =>
        mainLogger.error('Tray shutdown error', { error: (e as Error).message })
      ),
      cleanupIPC().catch((e) =>
        mainLogger.error('IPC cleanup error', { error: (e as Error).message })
      ),
      shutdownVoicePipeline().catch((e) =>
        mainLogger.error('Voice pipeline shutdown error', { error: (e as Error).message })
      ),
      shutdownAudioPipeline().catch((e) =>
        mainLogger.error('Audio pipeline shutdown error', { error: (e as Error).message })
      ),
      shutdownWakeWordDetector().catch((e) =>
        mainLogger.error('Wake word shutdown error', { error: (e as Error).message })
      ),
    ])
      .then(() => shutdownLogger())
      .catch((e) => console.error('Logger shutdown error:', e))
      .finally(() => {
        mainLogger.info('Cleanup complete, exiting');
        app.exit(0);
      });
  }
});

/**
 * Voice Pipeline Setup
 */
let wakeWordDetector: WakeWordDetector | null = null;

/**
 * Initialize voice pipeline components
 */
async function initializeVoicePipeline(): Promise<void> {
  if (!isConfigValid()) {
    voiceLogger.warn('Voice pipeline disabled - missing API keys');
    return;
  }

  try {
    voiceLogger.info('Initializing voice pipeline...');
    wakeWordDetector = getWakeWordDetector();

    // Set up wake word event handlers
    wakeWordDetector.on('wake', (event: WakeWordEvent) => {
      voiceLogger.info('Wake word detected!', {
        keyword: event.keyword,
        confidence: event.confidence,
      });
      // Send to renderer
      mainWindow?.webContents.send('nova:status', {
        type: 'wake-word',
        event,
      });
    });

    // Throttle audio level updates to prevent flooding (~30fps)
    let lastWakeWordAudioLevelTime = 0;
    wakeWordDetector.on('audio-level', (level: number) => {
      const now = Date.now();
      if (now - lastWakeWordAudioLevelTime > 33) {
        lastWakeWordAudioLevelTime = now;
        mainWindow?.webContents.send('nova:audio-level', level);
      }
    });

    wakeWordDetector.on('error', (error: Error) => {
      voiceLogger.error('Wake word detector error', { error: error.message });
      mainWindow?.webContents.send('nova:error', {
        type: 'wake-word',
        message: error.message,
      });
    });

    wakeWordDetector.on('started', () => {
      voiceLogger.info('Wake word detection started');
      mainWindow?.webContents.send('nova:status', {
        type: 'wake-word-started',
      });
    });

    wakeWordDetector.on('stopped', () => {
      voiceLogger.info('Wake word detection stopped');
      mainWindow?.webContents.send('nova:status', {
        type: 'wake-word-stopped',
      });
    });

    voiceLogger.info('Voice pipeline initialized');
  } catch (error) {
    voiceLogger.error('Failed to initialize voice pipeline', {
      error: (error as Error).message,
    });
  }
}

/**
 * IPC Handlers
 * Communication between main and renderer processes
 */

// Get app version
ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

// Get app path
ipcMain.handle('get-app-path', () => {
  return app.getAppPath();
});

// Check if in development mode
ipcMain.handle('is-dev', () => {
  return isDev;
});

// Get Nova status
ipcMain.handle('get-nova-status', () => {
  const validation = getConfigValidation();
  return {
    status: isConfigValid() ? 'ready' : 'missing-config',
    version: app.getVersion(),
    isDev,
    configValid: validation.valid,
    missingKeys: validation.missing,
  };
});

// Get safe config (masked API keys)
ipcMain.handle('get-config', () => {
  return getSafeConfig();
});

/**
 * Renderer Logging IPC
 * Allows renderer to log through main process logger
 */
ipcMain.handle(
  'log',
  (_event, level: string, module: string, message: string, meta?: Record<string, unknown>) => {
    const logger = createModuleLogger(`Renderer:${module}`);
    switch (level) {
      case 'debug':
        logger.debug(message, meta);
        break;
      case 'info':
        logger.info(message, meta);
        break;
      case 'warn':
        logger.warn(message, meta);
        break;
      case 'error':
        logger.error(message, meta);
        break;
      default:
        logger.info(message, meta);
    }
  }
);

/**
 * Security: Prevent new window creation
 */
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => {
    return { action: 'deny' };
  });
});

// Start timing
startupTimer.start('appReady');

// Log startup info
mainLogger.info('Starting Nova Desktop...', {
  environment: isDev ? 'development' : 'production',
  electron: process.versions.electron,
  node: process.versions.node,
  platform: process.platform,
  configValid: isConfigValid(),
});

if (!isConfigValid()) {
  const validation = getConfigValidation();
  mainLogger.warn('Missing API keys', { missing: validation.missing });
}

ipcLogger.info('IPC handlers registered');

/**
 * Voice Pipeline IPC Handlers
 */

// Start wake word detection
ipcMain.handle('voice:start-wake-word', async () => {
  if (!wakeWordDetector) {
    await initializeVoicePipeline();
  }
  if (wakeWordDetector) {
    await wakeWordDetector.start();
    return { success: true };
  }
  return { success: false, error: 'Wake word detector not initialized' };
});

// Stop wake word detection
ipcMain.handle('voice:stop-wake-word', async () => {
  if (wakeWordDetector) {
    await wakeWordDetector.stop();
    return { success: true };
  }
  return { success: false, error: 'Wake word detector not initialized' };
});

// Pause wake word detection
ipcMain.handle('voice:pause-wake-word', () => {
  if (wakeWordDetector) {
    wakeWordDetector.pause();
    return { success: true };
  }
  return { success: false, error: 'Wake word detector not initialized' };
});

// Resume wake word detection
ipcMain.handle('voice:resume-wake-word', () => {
  if (wakeWordDetector) {
    wakeWordDetector.resume();
    return { success: true };
  }
  return { success: false, error: 'Wake word detector not initialized' };
});

// Set wake word sensitivity
ipcMain.handle('voice:set-sensitivity', (_event, sensitivity: number) => {
  if (wakeWordDetector) {
    try {
      wakeWordDetector.setSensitivity(sensitivity);
      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }
  return { success: false, error: 'Wake word detector not initialized' };
});

// Get audio devices
ipcMain.handle('voice:get-audio-devices', () => {
  return WakeWordDetector.getAudioDevices();
});

// Set audio device
ipcMain.handle('voice:set-audio-device', (_event, deviceIndex: number) => {
  if (wakeWordDetector) {
    wakeWordDetector.setAudioDevice(deviceIndex);
    return { success: true };
  }
  return { success: false, error: 'Wake word detector not initialized' };
});

// Get voice pipeline status
ipcMain.handle('voice:get-status', () => {
  return {
    wakeWordActive: wakeWordDetector?.running ?? false,
    wakeWordPaused: wakeWordDetector?.paused ?? false,
    configValid: isConfigValid(),
  };
});

voiceLogger.info('Voice IPC handlers registered');

/**
 * Audio Pipeline IPC Handlers
 */
let audioPipeline: AudioPipeline | null = null;

/**
 * Initialize the audio pipeline with event forwarding to renderer
 */
async function initializeAudioPipeline(): Promise<AudioPipeline> {
  if (audioPipeline) {
    return audioPipeline;
  }

  audioPipeline = getAudioPipeline();

  // Forward state changes to renderer
  audioPipeline.on(
    'state-change',
    (state: VoicePipelineState, previousState: VoicePipelineState) => {
      mainWindow?.webContents.send('nova:pipeline-state', { state, previousState });
    }
  );

  // Forward wake word events
  audioPipeline.on('wake-word', (event: WakeWordEvent) => {
    mainWindow?.webContents.send('nova:wake-word', event);
  });

  // Forward speech events
  audioPipeline.on('speech-start', (event) => {
    mainWindow?.webContents.send('nova:speech-start', event);
  });

  audioPipeline.on('speech-segment', (segment: SpeechSegment) => {
    // Convert Float32Array to base64 for IPC (can't send typed arrays directly)
    const audioBase64 = Buffer.from(segment.audio.buffer).toString('base64');
    mainWindow?.webContents.send('nova:speech-segment', {
      ...segment,
      audio: audioBase64,
    });
  });

  // Forward audio level
  audioPipeline.on('audio-level', (level: number) => {
    mainWindow?.webContents.send('nova:audio-level', level);
  });

  // Forward errors
  audioPipeline.on('error', (error: Error) => {
    voiceLogger.error('Pipeline error', { error: error.message });
    mainWindow?.webContents.send('nova:error', {
      type: 'pipeline',
      message: error.message,
    });
  });

  // Forward barge-in
  audioPipeline.on('barge-in', () => {
    mainWindow?.webContents.send('nova:barge-in');
  });

  // Forward timeouts
  audioPipeline.on('listening-timeout', () => {
    mainWindow?.webContents.send('nova:listening-timeout');
  });

  audioPipeline.on('processing-timeout', () => {
    mainWindow?.webContents.send('nova:processing-timeout');
  });

  voiceLogger.info('Audio pipeline initialized with IPC event forwarding');
  return audioPipeline;
}

// Start audio pipeline
ipcMain.handle('pipeline:start', async () => {
  try {
    const pipeline = await initializeAudioPipeline();
    await pipeline.start();
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
});

// Stop audio pipeline
ipcMain.handle('pipeline:stop', async () => {
  if (audioPipeline) {
    await audioPipeline.stop();
    return { success: true };
  }
  return { success: false, error: 'Pipeline not initialized' };
});

// Get pipeline status
ipcMain.handle('pipeline:get-status', () => {
  if (audioPipeline) {
    return audioPipeline.getStatus();
  }
  return {
    state: 'idle' as VoicePipelineState,
    isListening: false,
    isSpeaking: false,
    audioLevel: 0,
  };
});

// Trigger manual wake (push-to-talk)
ipcMain.handle('pipeline:trigger-wake', () => {
  if (audioPipeline) {
    audioPipeline.triggerWake();
    return { success: true };
  }
  return { success: false, error: 'Pipeline not initialized' };
});

// Cancel current interaction
ipcMain.handle('pipeline:cancel', () => {
  if (audioPipeline) {
    audioPipeline.cancel();
    return { success: true };
  }
  return { success: false, error: 'Pipeline not initialized' };
});

// Pause pipeline
ipcMain.handle('pipeline:pause', () => {
  if (audioPipeline) {
    audioPipeline.pause();
    return { success: true };
  }
  return { success: false, error: 'Pipeline not initialized' };
});

// Resume pipeline
ipcMain.handle('pipeline:resume', () => {
  if (audioPipeline) {
    audioPipeline.resume();
    return { success: true };
  }
  return { success: false, error: 'Pipeline not initialized' };
});

// Set input device
ipcMain.handle('pipeline:set-input-device', (_event, deviceIndex: number) => {
  if (audioPipeline) {
    audioPipeline.setInputDevice(deviceIndex);
    return { success: true };
  }
  return { success: false, error: 'Pipeline not initialized' };
});

// Set output device
ipcMain.handle('pipeline:set-output-device', (_event, deviceIndex: number) => {
  if (audioPipeline) {
    audioPipeline.setOutputDevice(deviceIndex);
    return { success: true };
  }
  return { success: false, error: 'Pipeline not initialized' };
});

// Get pipeline config
ipcMain.handle('pipeline:get-config', () => {
  if (audioPipeline) {
    return audioPipeline.getConfig();
  }
  return null;
});

// Update pipeline config
ipcMain.handle('pipeline:update-config', (_event, config: Record<string, unknown>) => {
  if (audioPipeline) {
    audioPipeline.updateConfig(config);
    return { success: true };
  }
  return { success: false, error: 'Pipeline not initialized' };
});

// Signal that processing is complete, start speaking
ipcMain.handle('pipeline:start-speaking', () => {
  if (audioPipeline) {
    audioPipeline.startSpeaking();
    return { success: true };
  }
  return { success: false, error: 'Pipeline not initialized' };
});

// Signal that speaking is complete
ipcMain.handle('pipeline:finish-speaking', () => {
  if (audioPipeline) {
    audioPipeline.finishSpeaking();
    return { success: true };
  }
  return { success: false, error: 'Pipeline not initialized' };
});

voiceLogger.info('Pipeline IPC handlers registered');
