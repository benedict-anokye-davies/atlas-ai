/**
 * Audio Device Manager
 * Handles audio device enumeration, monitoring, and hot-switching
 *
 * Session 036-B: Multiple Audio Sources
 * - Device enumeration from PvRecorder
 * - Device change detection via polling
 * - Hot-switching between devices
 * - Event notifications for device changes
 */

import { EventEmitter } from 'events';
import { PvRecorder } from '@picovoice/pvrecorder-node';
import { BrowserWindow } from 'electron';
import { AudioDevice } from '../../shared/types/voice';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('AudioDeviceManager');

/**
 * Audio device change event
 */
export interface AudioDeviceChangeEvent {
  type: 'added' | 'removed' | 'default-changed';
  device?: AudioDevice;
  devices: AudioDevice[];
  timestamp: number;
}

/**
 * Audio device manager configuration
 */
export interface AudioDeviceManagerConfig {
  /** Polling interval for device changes in ms (default: 3000) */
  pollingIntervalMs: number;
  /** Enable automatic device change detection (default: true) */
  enableMonitoring: boolean;
  /** Preferred input device index (-1 for default) */
  preferredInputDevice: number;
  /** Preferred output device index (-1 for default) */
  preferredOutputDevice: number;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: AudioDeviceManagerConfig = {
  pollingIntervalMs: 3000,
  enableMonitoring: true,
  preferredInputDevice: -1,
  preferredOutputDevice: -1,
};

/**
 * Audio Device Manager Events
 */
export interface AudioDeviceManagerEvents {
  'devices-changed': (event: AudioDeviceChangeEvent) => void;
  'device-added': (device: AudioDevice) => void;
  'device-removed': (device: AudioDevice) => void;
  'input-device-changed': (deviceIndex: number, device: AudioDevice | null) => void;
  'output-device-changed': (deviceIndex: number, device: AudioDevice | null) => void;
  error: (error: Error) => void;
}

/**
 * AudioDeviceManager class
 * Manages audio input/output devices with monitoring and hot-switching
 */
export class AudioDeviceManager extends EventEmitter {
  private config: AudioDeviceManagerConfig;
  private devices: AudioDevice[] = [];
  private pollingTimer: NodeJS.Timeout | null = null;
  private isMonitoring: boolean = false;
  private currentInputDevice: number = -1;
  private currentOutputDevice: number = -1;

  // Callbacks for device switching
  private onInputDeviceChange: ((deviceIndex: number) => void) | null = null;
  private onOutputDeviceChange: ((deviceIndex: number) => void) | null = null;

  constructor(config?: Partial<AudioDeviceManagerConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.currentInputDevice = this.config.preferredInputDevice;
    this.currentOutputDevice = this.config.preferredOutputDevice;

    logger.info('AudioDeviceManager initialized', {
      pollingInterval: this.config.pollingIntervalMs,
      monitoring: this.config.enableMonitoring,
    });
  }

  /**
   * Get available audio input devices
   */
  getInputDevices(): AudioDevice[] {
    try {
      const deviceNames = PvRecorder.getAvailableDevices();
      this.devices = deviceNames.map((name, index) => ({
        index,
        name,
        isDefault: index === 0, // First device is typically the default
      }));

      // Add "System Default" as index -1
      const devicesWithDefault: AudioDevice[] = [
        { index: -1, name: 'System Default', isDefault: true },
        ...this.devices.map((d) => ({ ...d, isDefault: false })),
      ];

      logger.debug('Audio devices enumerated', { count: devicesWithDefault.length });
      return devicesWithDefault;
    } catch (error) {
      logger.error('Failed to enumerate audio devices', { error });
      return [{ index: -1, name: 'System Default', isDefault: true }];
    }
  }

  /**
   * Refresh device list and detect changes
   */
  refreshDevices(): AudioDeviceChangeEvent | null {
    const oldDevices = [...this.devices];
    const newDevices = this.getInputDevices();

    // Check for added devices
    const addedDevices = newDevices.filter(
      (newDev) => !oldDevices.find((oldDev) => oldDev.name === newDev.name)
    );

    // Check for removed devices
    const removedDevices = oldDevices.filter(
      (oldDev) => !newDevices.find((newDev) => newDev.name === oldDev.name)
    );

    // No changes
    if (addedDevices.length === 0 && removedDevices.length === 0) {
      return null;
    }

    // Emit events for changes
    const event: AudioDeviceChangeEvent = {
      type: addedDevices.length > 0 ? 'added' : 'removed',
      device: addedDevices[0] || removedDevices[0],
      devices: newDevices,
      timestamp: Date.now(),
    };

    // Emit individual events
    for (const device of addedDevices) {
      logger.info('Audio device added', { device: device.name, index: device.index });
      this.emit('device-added', device);
    }

    for (const device of removedDevices) {
      logger.info('Audio device removed', { device: device.name, index: device.index });
      this.emit('device-removed', device);

      // If currently selected device was removed, fall back to default
      if (device.index === this.currentInputDevice) {
        logger.warn('Current input device removed, falling back to default');
        this.setInputDevice(-1);
      }
    }

    // Emit general change event
    this.emit('devices-changed', event);

    // Send to renderer
    this.sendDeviceChangeToRenderer(event);

    return event;
  }

  /**
   * Start monitoring for device changes
   */
  startMonitoring(): void {
    if (this.isMonitoring) {
      logger.debug('Device monitoring already active');
      return;
    }

    if (!this.config.enableMonitoring) {
      logger.debug('Device monitoring disabled in config');
      return;
    }

    this.isMonitoring = true;

    // Initial device enumeration
    this.getInputDevices();

    // Start polling for changes
    this.pollingTimer = setInterval(() => {
      this.refreshDevices();
    }, this.config.pollingIntervalMs);

    logger.info('Device monitoring started', { interval: this.config.pollingIntervalMs });
  }

  /**
   * Stop monitoring for device changes
   */
  stopMonitoring(): void {
    if (!this.isMonitoring) {
      return;
    }

    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }

    this.isMonitoring = false;
    logger.info('Device monitoring stopped');
  }

  /**
   * Set the current input device
   */
  setInputDevice(deviceIndex: number): void {
    const devices = this.getInputDevices();
    const device = devices.find((d) => d.index === deviceIndex);

    if (deviceIndex !== -1 && !device) {
      logger.warn('Invalid input device index', { deviceIndex });
      return;
    }

    const previousDevice = this.currentInputDevice;
    this.currentInputDevice = deviceIndex;

    logger.info('Input device changed', {
      from: previousDevice,
      to: deviceIndex,
      deviceName: device?.name || 'System Default',
    });

    // Notify callback if registered
    if (this.onInputDeviceChange) {
      this.onInputDeviceChange(deviceIndex);
    }

    // Emit event
    this.emit('input-device-changed', deviceIndex, device || null);

    // Send to renderer
    this.sendDeviceChangeToRenderer({
      type: 'default-changed',
      device: device || undefined,
      devices,
      timestamp: Date.now(),
    });
  }

  /**
   * Set the current output device
   */
  setOutputDevice(deviceIndex: number): void {
    const previousDevice = this.currentOutputDevice;
    this.currentOutputDevice = deviceIndex;

    logger.info('Output device changed', {
      from: previousDevice,
      to: deviceIndex,
    });

    // Notify callback if registered
    if (this.onOutputDeviceChange) {
      this.onOutputDeviceChange(deviceIndex);
    }

    // Emit event
    this.emit('output-device-changed', deviceIndex, null);
  }

  /**
   * Get current input device index
   */
  getCurrentInputDevice(): number {
    return this.currentInputDevice;
  }

  /**
   * Get current output device index
   */
  getCurrentOutputDevice(): number {
    return this.currentOutputDevice;
  }

  /**
   * Register callback for input device changes (for hot-switching)
   */
  onInputChange(callback: (deviceIndex: number) => void): void {
    this.onInputDeviceChange = callback;
  }

  /**
   * Register callback for output device changes (for hot-switching)
   */
  onOutputChange(callback: (deviceIndex: number) => void): void {
    this.onOutputDeviceChange = callback;
  }

  /**
   * Get device by index
   */
  getDeviceByIndex(index: number): AudioDevice | null {
    if (index === -1) {
      return { index: -1, name: 'System Default', isDefault: true };
    }
    return this.devices.find((d) => d.index === index) || null;
  }

  /**
   * Get device by name
   */
  getDeviceByName(name: string): AudioDevice | null {
    return this.devices.find((d) => d.name === name) || null;
  }

  /**
   * Check if a device exists
   */
  deviceExists(index: number): boolean {
    if (index === -1) return true; // Default always exists
    return this.devices.some((d) => d.index === index);
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<AudioDeviceManagerConfig>): void {
    const wasMonitoring = this.isMonitoring;

    // Stop monitoring if interval changed
    if (config.pollingIntervalMs && config.pollingIntervalMs !== this.config.pollingIntervalMs) {
      this.stopMonitoring();
    }

    this.config = { ...this.config, ...config };

    // Restart monitoring if it was active
    if (wasMonitoring && config.pollingIntervalMs) {
      this.startMonitoring();
    }

    logger.info('Config updated', config);
  }

  /**
   * Send device change to renderer process
   */
  private sendDeviceChangeToRenderer(event: AudioDeviceChangeEvent): void {
    try {
      const windows = BrowserWindow.getAllWindows();
      for (const win of windows) {
        if (!win.isDestroyed()) {
          win.webContents.send('atlas:audio-devices-changed', event);
        }
      }
    } catch (error) {
      logger.debug('Could not send device change to renderer', { error });
    }
  }

  /**
   * Shutdown the device manager
   */
  shutdown(): void {
    this.stopMonitoring();
    this.removeAllListeners();
    logger.info('AudioDeviceManager shutdown');
  }
}

// Singleton instance
let audioDeviceManager: AudioDeviceManager | null = null;

/**
 * Get or create the audio device manager instance
 */
export function getAudioDeviceManager(): AudioDeviceManager {
  if (!audioDeviceManager) {
    audioDeviceManager = new AudioDeviceManager();
  }
  return audioDeviceManager;
}

/**
 * Shutdown the audio device manager
 */
export function shutdownAudioDeviceManager(): void {
  if (audioDeviceManager) {
    audioDeviceManager.shutdown();
    audioDeviceManager = null;
  }
}

export default AudioDeviceManager;
