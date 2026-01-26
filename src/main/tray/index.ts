/**
 * Atlas Desktop - System Tray Module
 * Manages the system tray icon, menu, global shortcuts, and status indicators
 *
 * Features:
 * - Animated tray icons for different states (listening, processing, speaking)
 * - Quick actions menu: Start/Stop listening, Settings, Quit
 * - Recent conversations in tray menu
 * - Status indicators: online/offline, connected/disconnected
 * - Tooltip with current state and connection status
 * - Double-click to show/hide window
 * - Notification badges
 */

import {
  Tray,
  Menu,
  nativeImage,
  app,
  globalShortcut,
  BrowserWindow,
  NativeImage,
  MenuItemConstructorOptions,
  Notification,
} from 'electron';
import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import { VoicePipelineState } from '../../shared/types/voice';
import {
  getConnectivityManager,
  ConnectivityStatus,
  ServiceAvailability,
} from '../utils/connectivity';

const logger = createModuleLogger('Tray');

/**
 * Window display modes
 */
export type WindowMode = 'normal' | 'compact' | 'overlay' | 'tray';

/**
 * Theme preference
 */
export type ThemePreference = 'system' | 'light' | 'dark';

/**
 * Audio device info for tray menu
 */
export interface AudioDeviceInfo {
  id: string;
  label: string;
  kind: 'audioinput' | 'audiooutput';
  isDefault?: boolean;
}

/**
 * Tray icon states matching VoicePipelineState
 */
export type TrayState = VoicePipelineState | 'disabled';

/**
 * Connection status for tray display
 */
export interface TrayConnectionStatus {
  isOnline: boolean;
  services: ServiceAvailability;
  latency: number | null;
}

/**
 * Recent conversation entry for tray menu
 */
export interface RecentConversation {
  id: string;
  timestamp: number;
  userMessage: string;
  assistantResponse: string;
  topics: string[];
}

/**
 * Notification badge info
 */
export interface NotificationBadge {
  count: number;
  type: 'info' | 'warning' | 'error' | 'success';
  message?: string;
}

/**
 * Tray configuration
 */
export interface TrayConfig {
  /** Global shortcut for push-to-talk (default: CommandOrControl+Shift+Space) */
  pushToTalkShortcut: string;
  /** Whether to show notifications */
  showNotifications: boolean;
  /** Whether to start minimized to tray */
  startMinimized: boolean;
  /** Whether to minimize to tray instead of closing */
  minimizeToTray: boolean;
  /** Maximum recent conversations to show */
  maxRecentConversations: number;
  /** Show connection status in tooltip */
  showConnectionStatus: boolean;
  /** Animation frame rate (fps) */
  animationFps: number;
  /** Show audio device selection in menu */
  showAudioDevices: boolean;
  /** Show volume control in menu */
  showVolumeControl: boolean;
  /** Show theme switcher in menu */
  showThemeSwitcher: boolean;
}

/**
 * Default tray configuration
 */
export const DEFAULT_TRAY_CONFIG: TrayConfig = {
  pushToTalkShortcut: 'CommandOrControl+Shift+Space',
  showNotifications: true,
  startMinimized: false,
  minimizeToTray: true,
  maxRecentConversations: 5,
  showConnectionStatus: true,
  animationFps: 10,
  showAudioDevices: true,
  showVolumeControl: true,
  showThemeSwitcher: true,
};

/**
 * Tray events
 */
export interface TrayEvents {
  'push-to-talk': () => void;
  'toggle-window': () => void;
  quit: () => void;
  settings: () => void;
  'start-pipeline': () => void;
  'stop-pipeline': () => void;
  'open-conversation': (id: string) => void;
  'clear-notifications': () => void;
  'set-window-mode': (mode: WindowMode) => void;
  'set-audio-input': (deviceId: string) => void;
  'set-audio-output': (deviceId: string) => void;
  'set-volume': (volume: number) => void;
  'set-theme': (theme: ThemePreference) => void;
  'mute-toggle': () => void;
}

/**
 * Color schemes for different states
 */
const STATE_COLORS: Record<TrayState, { primary: string; secondary: string; accent: string }> = {
  idle: { primary: '#6366f1', secondary: '#4f46e5', accent: '#818cf8' }, // Indigo
  listening: { primary: '#22c55e', secondary: '#16a34a', accent: '#4ade80' }, // Green
  processing: { primary: '#f59e0b', secondary: '#d97706', accent: '#fbbf24' }, // Amber
  speaking: { primary: '#3b82f6', secondary: '#2563eb', accent: '#60a5fa' }, // Blue
  error: { primary: '#ef4444', secondary: '#dc2626', accent: '#f87171' }, // Red
  disabled: { primary: '#6b7280', secondary: '#4b5563', accent: '#9ca3af' }, // Gray
};

/**
 * Badge colors by type
 */
const BADGE_COLORS: Record<NotificationBadge['type'], string> = {
  info: '#3b82f6',
  warning: '#f59e0b',
  error: '#ef4444',
  success: '#22c55e',
};

/**
 * Atlas System Tray Manager
 */
export class AtlasTray extends EventEmitter {
  private tray: Tray | null = null;
  private config: TrayConfig;
  private state: TrayState = 'idle';
  private isRunning = false;
  private mainWindow: BrowserWindow | null = null;
  private iconCache: Map<string, NativeImage> = new Map();
  private animationInterval: NodeJS.Timeout | null = null;
  private animationFrame = 0;

  // Enhanced status tracking
  private connectionStatus: TrayConnectionStatus = {
    isOnline: true,
    services: {
      fireworks: true,
      deepgram: true,
      elevenlabs: true,
      internet: true,
    },
    latency: null,
  };

  // Recent conversations
  private recentConversations: RecentConversation[] = [];

  // Notification badge
  private badge: NotificationBadge | null = null;

  // Connectivity manager reference
  private connectivityUnsubscribe: (() => void) | null = null;

  // Current window mode
  private windowMode: WindowMode = 'normal';

  // Audio device tracking
  private audioInputDevices: AudioDeviceInfo[] = [];
  private audioOutputDevices: AudioDeviceInfo[] = [];
  private selectedInputDevice: string = 'default';
  private selectedOutputDevice: string = 'default';

  // Volume state
  private volume: number = 100;
  private isMuted: boolean = false;

  // Theme preference
  private themePreference: ThemePreference = 'system';

  constructor(config: Partial<TrayConfig> = {}) {
    super();
    this.config = { ...DEFAULT_TRAY_CONFIG, ...config };
  }

  /**
   * Initialize the system tray
   */
  async initialize(mainWindow?: BrowserWindow): Promise<void> {
    if (this.tray) {
      logger.warn('Tray already initialized');
      return;
    }

    this.mainWindow = mainWindow || null;

    // Pre-generate icons for all states
    this.generateIcons();

    // Create tray with idle icon
    const icon = this.iconCache.get('idle-0') || this.createIcon('idle');
    this.tray = new Tray(icon);
    this.updateTooltip();

    // Build and set context menu
    this.updateContextMenu();

    // Handle tray click - show window
    this.tray.on('click', () => {
      this.showWindow();
    });

    // Handle double-click (Windows) - toggle window
    this.tray.on('double-click', () => {
      this.emit('toggle-window');
      this.toggleWindow();
    });

    // Handle right-click - show context menu (default behavior)
    // Note: Context menu is set via setContextMenu

    // Register global shortcuts
    this.registerShortcuts();

    // Subscribe to connectivity status changes
    this.subscribeToConnectivity();

    logger.info('System tray initialized with enhanced features');
  }

  /**
   * Subscribe to connectivity manager updates
   */
  private subscribeToConnectivity(): void {
    try {
      const connectivityManager = getConnectivityManager();

      // Subscribe to status changes
      this.connectivityUnsubscribe = connectivityManager.onStatusChange(
        (online: boolean, status: ConnectivityStatus) => {
          this.connectionStatus.isOnline = online;
          this.connectionStatus.latency = status.latency;
          this.connectionStatus.services = connectivityManager.getServiceAvailability();
          this.updateTooltip();
          this.updateContextMenu();

          // Show notification on connectivity change
          if (this.config.showNotifications) {
            if (!online) {
              this.showNotification(
                'Atlas Offline',
                'Network connection lost. Using offline mode.'
              );
            } else {
              this.showNotification(
                'Atlas Online',
                `Connection restored. Latency: ${status.latency}ms`
              );
            }
          }
        }
      );

      // Get initial status
      this.connectionStatus.isOnline = connectivityManager.isOnline();
      this.connectionStatus.services = connectivityManager.getServiceAvailability();
      this.connectionStatus.latency = connectivityManager.getStatus().latency;

      logger.debug('Subscribed to connectivity updates');
    } catch (error) {
      logger.warn('Failed to subscribe to connectivity manager', {
        error: (error as Error).message,
      });
    }
  }

  /**
   * Generate icons for all states
   */
  private generateIcons(): void {
    const states: TrayState[] = [
      'idle',
      'listening',
      'processing',
      'speaking',
      'error',
      'disabled',
    ];

    // Generate static icons (frame 0)
    for (const state of states) {
      const icon = this.createIcon(state, 0);
      this.iconCache.set(`${state}-0`, icon);
    }

    // Pre-generate animation frames for animated states
    const animatedStates: TrayState[] = ['listening', 'processing', 'speaking'];
    const framesPerState = 12; // Enough for smooth animation

    for (const state of animatedStates) {
      for (let frame = 1; frame < framesPerState; frame++) {
        const icon = this.createIcon(state, frame);
        this.iconCache.set(`${state}-${frame}`, icon);
      }
    }
  }

  /**
   * Create a tray icon for a specific state
   * Uses nativeImage to create a simple circular icon
   */
  private createIcon(state: TrayState, frame = 0): NativeImage {
    const size = 16; // Standard tray icon size
    const colors = STATE_COLORS[state];

    // Create a simple SVG icon
    const svg = this.generateSVGIcon(size, colors, state, frame);

    // Convert SVG to data URL
    const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;

    return nativeImage.createFromDataURL(dataUrl);
  }

  /**
   * Generate SVG icon for tray with enhanced animations
   */
  private generateSVGIcon(
    size: number,
    colors: { primary: string; secondary: string; accent: string },
    state: TrayState,
    frame = 0
  ): string {
    const center = size / 2;
    const radius = size / 2 - 1;

    // Base circle
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`;

    // Add gradient definition for richer colors
    svg += `<defs>
      <radialGradient id="grad" cx="30%" cy="30%" r="70%">
        <stop offset="0%" style="stop-color:${colors.accent};stop-opacity:1" />
        <stop offset="100%" style="stop-color:${colors.primary};stop-opacity:1" />
      </radialGradient>
    </defs>`;

    // Background circle with gradient
    svg += `<circle cx="${center}" cy="${center}" r="${radius}" fill="url(#grad)" />`;

    // Connection status indicator (small dot in corner)
    if (!this.connectionStatus.isOnline) {
      svg += `<circle cx="${size - 3}" cy="${size - 3}" r="2" fill="#ef4444" stroke="#fff" stroke-width="0.5" />`;
    }

    // Badge indicator (if present)
    if (this.badge && this.badge.count > 0) {
      const badgeColor = BADGE_COLORS[this.badge.type];
      svg += `<circle cx="${size - 3}" cy="3" r="3" fill="${badgeColor}" />`;
      if (this.badge.count <= 9) {
        svg += `<text x="${size - 3}" y="4.5" font-size="4" text-anchor="middle" fill="white" font-family="Arial">${this.badge.count}</text>`;
      } else {
        svg += `<text x="${size - 3}" y="4.5" font-size="3" text-anchor="middle" fill="white" font-family="Arial">9+</text>`;
      }
    }

    // State-specific decorations with enhanced animations
    switch (state) {
      case 'listening': {
        // Pulsing concentric circles for listening
        const pulsePhase = (frame * Math.PI * 2) / 12;
        const pulseRadius1 = radius * 0.3 + Math.sin(pulsePhase) * radius * 0.15;
        const pulseRadius2 = radius * 0.5 + Math.sin(pulsePhase + Math.PI / 2) * radius * 0.1;
        const pulseOpacity1 = 0.8 + Math.sin(pulsePhase) * 0.2;
        const pulseOpacity2 = 0.5 + Math.sin(pulsePhase + Math.PI / 2) * 0.2;

        svg += `<circle cx="${center}" cy="${center}" r="${pulseRadius2}" fill="none" stroke="white" stroke-width="0.8" opacity="${pulseOpacity2}" />`;
        svg += `<circle cx="${center}" cy="${center}" r="${pulseRadius1}" fill="white" opacity="${pulseOpacity1}" />`;

        // Microphone icon
        svg += `<rect x="${center - 1}" y="${center - 2.5}" width="2" height="3.5" rx="0.8" fill="${colors.secondary}" />`;
        svg += `<path d="M${center - 2} ${center + 1.5} Q${center - 2} ${center + 3} ${center} ${center + 3} Q${center + 2} ${center + 3} ${center + 2} ${center + 1.5}" stroke="${colors.secondary}" stroke-width="0.8" fill="none" />`;
        svg += `<line x1="${center}" y1="${center + 3}" x2="${center}" y2="${center + 4}" stroke="${colors.secondary}" stroke-width="0.8" />`;
        break;
      }

      case 'processing': {
        // Spinning dots around center
        const numDots = 6;
        const baseAngle = (frame * 30) % 360;

        for (let i = 0; i < numDots; i++) {
          const angle = (baseAngle + i * (360 / numDots)) % 360;
          const rad = (angle * Math.PI) / 180;
          const dotX = center + Math.cos(rad) * (radius * 0.55);
          const dotY = center + Math.sin(rad) * (radius * 0.55);
          const dotSize = 1.2 - i * 0.15;
          const dotOpacity = 1 - i * 0.12;
          svg += `<circle cx="${dotX}" cy="${dotY}" r="${dotSize}" fill="white" opacity="${dotOpacity}" />`;
        }

        // Center dot
        svg += `<circle cx="${center}" cy="${center}" r="1.5" fill="white" />`;
        break;
      }

      case 'speaking': {
        // Sound wave animation
        const wavePhase = (frame * Math.PI) / 6;
        const wave1 = Math.sin(wavePhase) * 0.5;
        const wave2 = Math.sin(wavePhase + Math.PI / 3) * 0.5;
        const wave3 = Math.sin(wavePhase + (2 * Math.PI) / 3) * 0.5;

        // Speaker cone
        svg += `<polygon points="${center - 1},${center - 1.5} ${center - 1},${center + 1.5} ${center + 0.5},${center + 2.5} ${center + 0.5},${center - 2.5}" fill="white" />`;

        // Sound waves
        svg += `<path d="M${center + 2} ${center - 2 + wave1} Q${center + 3.5} ${center} ${center + 2} ${center + 2 + wave1}" stroke="white" stroke-width="0.8" fill="none" opacity="0.9" />`;
        svg += `<path d="M${center + 3} ${center - 3 + wave2} Q${center + 5} ${center} ${center + 3} ${center + 3 + wave2}" stroke="white" stroke-width="0.7" fill="none" opacity="0.6" />`;
        svg += `<path d="M${center + 4} ${center - 4 + wave3} Q${center + 6.5} ${center} ${center + 4} ${center + 4 + wave3}" stroke="white" stroke-width="0.6" fill="none" opacity="0.3" />`;
        break;
      }

      case 'error': {
        // X mark with subtle animation
        const errorPulse = 1 + Math.sin((frame * Math.PI) / 6) * 0.1;
        svg += `<g transform="scale(${errorPulse}) translate(${center * (1 - errorPulse)}, ${center * (1 - errorPulse)})">`;
        svg += `<line x1="${center - 2.5}" y1="${center - 2.5}" x2="${center + 2.5}" y2="${center + 2.5}" stroke="white" stroke-width="2" stroke-linecap="round" />`;
        svg += `<line x1="${center + 2.5}" y1="${center - 2.5}" x2="${center - 2.5}" y2="${center + 2.5}" stroke="white" stroke-width="2" stroke-linecap="round" />`;
        svg += `</g>`;
        break;
      }

      case 'disabled':
        // Slash through circle
        svg += `<line x1="${center - 3}" y1="${center + 3}" x2="${center + 3}" y2="${center - 3}" stroke="white" stroke-width="1.5" stroke-linecap="round" />`;
        svg += `<circle cx="${center}" cy="${center}" r="${radius * 0.4}" fill="none" stroke="white" stroke-width="1" opacity="0.5" />`;
        break;

      case 'idle':
      default: {
        // Atlas "A" logo or simple dot
        svg += `<circle cx="${center}" cy="${center}" r="${radius * 0.35}" fill="white" />`;
        // Small breathing animation
        const breathe = 0.9 + Math.sin((frame * Math.PI) / 6) * 0.1;
        svg += `<circle cx="${center}" cy="${center}" r="${radius * 0.5 * breathe}" fill="none" stroke="white" stroke-width="0.5" opacity="0.5" />`;
        break;
      }
    }

    svg += '</svg>';
    return svg;
  }

  /**
   * Update the tray icon state
   */
  setState(state: TrayState): void {
    if (this.state === state) return;

    const previousState = this.state;
    this.state = state;

    // Stop any existing animation
    this.stopAnimation();

    // Start animation for dynamic states
    if (state === 'listening' || state === 'processing' || state === 'speaking') {
      this.startAnimation();
    } else {
      // Set static icon
      const icon = this.iconCache.get(`${state}-0`) || this.createIcon(state);
      this.tray?.setImage(icon);
    }

    // Update tooltip
    this.updateTooltip();

    // Update context menu
    this.updateContextMenu();

    logger.debug('Tray state changed', { from: previousState, to: state });
  }

  /**
   * Start icon animation
   */
  private startAnimation(): void {
    if (this.animationInterval) return;

    this.animationFrame = 0;
    const frameInterval = Math.floor(1000 / this.config.animationFps);

    this.animationInterval = setInterval(() => {
      this.animationFrame = (this.animationFrame + 1) % 12;
      const cacheKey = `${this.state}-${this.animationFrame}`;
      const icon = this.iconCache.get(cacheKey) || this.createIcon(this.state, this.animationFrame);
      this.tray?.setImage(icon);
    }, frameInterval);
  }

  /**
   * Stop icon animation
   */
  private stopAnimation(): void {
    if (this.animationInterval) {
      clearInterval(this.animationInterval);
      this.animationInterval = null;
      this.animationFrame = 0;
    }
  }

  /**
   * Update the tray tooltip with detailed status
   */
  private updateTooltip(): void {
    const stateDescriptions: Record<TrayState, string> = {
      idle: 'Ready',
      listening: 'Listening...',
      processing: 'Processing...',
      speaking: 'Speaking...',
      error: 'Error',
      disabled: 'Disabled',
    };

    let tooltip = `Atlas - ${stateDescriptions[this.state]}`;

    // Add connection status if enabled
    if (this.config.showConnectionStatus) {
      const connectionText = this.connectionStatus.isOnline ? 'Online' : 'Offline';
      tooltip += `\nStatus: ${connectionText}`;

      if (this.connectionStatus.isOnline && this.connectionStatus.latency) {
        tooltip += ` (${this.connectionStatus.latency}ms)`;
      }

      // Add service status
      const services = this.connectionStatus.services;
      const availableServices: string[] = [];
      const unavailableServices: string[] = [];

      if (services.fireworks) availableServices.push('LLM');
      else unavailableServices.push('LLM');

      if (services.deepgram) availableServices.push('STT');
      else unavailableServices.push('STT');

      if (services.elevenlabs) availableServices.push('TTS');
      else unavailableServices.push('TTS');

      if (unavailableServices.length > 0 && this.connectionStatus.isOnline) {
        tooltip += `\nOffline: ${unavailableServices.join(', ')}`;
      }
    }

    // Add badge info if present
    if (this.badge && this.badge.count > 0) {
      tooltip += `\n${this.badge.count} notification${this.badge.count > 1 ? 's' : ''}`;
      if (this.badge.message) {
        tooltip += `: ${this.badge.message}`;
      }
    }

    this.tray?.setToolTip(tooltip);
  }

  /**
   * Update the context menu with enhanced options
   */
  private updateContextMenu(): void {
    if (!this.tray) return;

    const menuTemplate: MenuItemConstructorOptions[] = [];

    // Header with status
    menuTemplate.push({
      label: 'Atlas Voice Assistant',
      enabled: false,
      icon: this.createSmallStatusIcon(),
    });

    // Connection status indicator
    const statusLabel = this.connectionStatus.isOnline
      ? `Online${this.connectionStatus.latency ? ` (${this.connectionStatus.latency}ms)` : ''}`
      : 'Offline Mode';
    menuTemplate.push({
      label: statusLabel,
      enabled: false,
    });

    menuTemplate.push({ type: 'separator' });

    // Window controls
    menuTemplate.push({
      label: 'Show Window',
      accelerator: 'CommandOrControl+Shift+A',
      click: () => {
        this.emit('toggle-window');
        this.showWindow();
      },
    });

    // Window Mode submenu
    menuTemplate.push({
      label: 'Window Mode',
      submenu: [
        {
          label: 'Normal',
          type: 'radio',
          checked: this.windowMode === 'normal',
          accelerator: 'CommandOrControl+Shift+N',
          click: () => {
            this.emit('set-window-mode', 'normal');
          },
        },
        {
          label: 'Compact',
          type: 'radio',
          checked: this.windowMode === 'compact',
          accelerator: 'CommandOrControl+Shift+C',
          click: () => {
            this.emit('set-window-mode', 'compact');
          },
        },
        {
          label: 'Overlay',
          type: 'radio',
          checked: this.windowMode === 'overlay',
          accelerator: 'CommandOrControl+Shift+O',
          click: () => {
            this.emit('set-window-mode', 'overlay');
          },
        },
        {
          label: 'Minimize to Tray',
          type: 'radio',
          checked: this.windowMode === 'tray',
          accelerator: 'CommandOrControl+Shift+M',
          click: () => {
            this.emit('set-window-mode', 'tray');
          },
        },
      ],
    });

    menuTemplate.push({ type: 'separator' });

    // Voice controls
    menuTemplate.push({
      label: this.isRunning ? 'Stop Listening' : 'Start Listening',
      accelerator: 'CommandOrControl+Shift+L',
      click: () => {
        if (this.isRunning) {
          this.emit('stop-pipeline');
        } else {
          this.emit('start-pipeline');
        }
      },
    });

    menuTemplate.push({
      label: 'Push to Talk',
      accelerator: this.config.pushToTalkShortcut,
      click: () => {
        this.emit('push-to-talk');
      },
    });

    menuTemplate.push({ type: 'separator' });

    // Recent conversations submenu
    if (this.recentConversations.length > 0) {
      const conversationItems: MenuItemConstructorOptions[] = this.recentConversations.map(
        (conv) => ({
          label: this.truncateText(conv.userMessage, 40),
          sublabel: this.formatTimestamp(conv.timestamp),
          click: () => {
            this.emit('open-conversation', conv.id);
            this.showWindow();
          },
        })
      );

      conversationItems.push({ type: 'separator' });
      conversationItems.push({
        label: 'Clear History',
        click: () => {
          this.clearRecentConversations();
        },
      });

      menuTemplate.push({
        label: 'Recent Conversations',
        submenu: conversationItems,
      });

      menuTemplate.push({ type: 'separator' });
    }

    // Service status submenu
    menuTemplate.push({
      label: 'Service Status',
      submenu: [
        {
          label: `LLM (Fireworks): ${this.connectionStatus.services.fireworks ? 'Available' : 'Offline'}`,
          enabled: false,
        },
        {
          label: `STT (Deepgram): ${this.connectionStatus.services.deepgram ? 'Available' : 'Offline'}`,
          enabled: false,
        },
        {
          label: `TTS (ElevenLabs): ${this.connectionStatus.services.elevenlabs ? 'Available' : 'Offline'}`,
          enabled: false,
        },
        { type: 'separator' },
        {
          label: 'Check Connection',
          click: async () => {
            try {
              const connectivityManager = getConnectivityManager();
              await connectivityManager.forceCheck();
              this.showNotification('Connection Check', 'Connectivity check completed.');
            } catch (error) {
              logger.error('Failed to check connectivity', { error });
            }
          },
        },
      ],
    });

    // Audio Devices submenu (Session 047-A)
    if (this.config.showAudioDevices) {
      menuTemplate.push({ type: 'separator' });

      // Audio Input Devices
      const inputDeviceItems: MenuItemConstructorOptions[] =
        this.audioInputDevices.length > 0
          ? this.audioInputDevices.map((device) => ({
              label: device.label + (device.isDefault ? ' (System Default)' : ''),
              type: 'radio' as const,
              checked: this.selectedInputDevice === device.id,
              click: () => {
                this.setSelectedInputDevice(device.id);
                this.emit('set-audio-input', device.id);
              },
            }))
          : [{ label: 'No input devices found', enabled: false }];

      menuTemplate.push({
        label: 'Microphone',
        submenu: inputDeviceItems,
      });

      // Audio Output Devices
      const outputDeviceItems: MenuItemConstructorOptions[] =
        this.audioOutputDevices.length > 0
          ? this.audioOutputDevices.map((device) => ({
              label: device.label + (device.isDefault ? ' (System Default)' : ''),
              type: 'radio' as const,
              checked: this.selectedOutputDevice === device.id,
              click: () => {
                this.setSelectedOutputDevice(device.id);
                this.emit('set-audio-output', device.id);
              },
            }))
          : [{ label: 'No output devices found', enabled: false }];

      menuTemplate.push({
        label: 'Speaker',
        submenu: outputDeviceItems,
      });
    }

    // Volume Control submenu (Session 047-A)
    if (this.config.showVolumeControl) {
      menuTemplate.push({ type: 'separator' });

      const volumeItems: MenuItemConstructorOptions[] = [
        {
          label: this.isMuted ? 'Unmute' : 'Mute',
          accelerator: 'CommandOrControl+Shift+M',
          click: () => {
            this.toggleMute();
            this.emit('mute-toggle');
          },
        },
        { type: 'separator' },
        {
          label: `Volume: ${this.isMuted ? 'Muted' : `${this.volume}%`}`,
          enabled: false,
        },
        { type: 'separator' },
        {
          label: '100%',
          type: 'radio',
          checked: this.volume === 100 && !this.isMuted,
          click: () => {
            this.setVolume(100);
            this.emit('set-volume', 100);
          },
        },
        {
          label: '75%',
          type: 'radio',
          checked: this.volume === 75 && !this.isMuted,
          click: () => {
            this.setVolume(75);
            this.emit('set-volume', 75);
          },
        },
        {
          label: '50%',
          type: 'radio',
          checked: this.volume === 50 && !this.isMuted,
          click: () => {
            this.setVolume(50);
            this.emit('set-volume', 50);
          },
        },
        {
          label: '25%',
          type: 'radio',
          checked: this.volume === 25 && !this.isMuted,
          click: () => {
            this.setVolume(25);
            this.emit('set-volume', 25);
          },
        },
      ];

      menuTemplate.push({
        label: 'Volume',
        submenu: volumeItems,
      });
    }

    // Theme Switcher submenu (Session 047-A)
    if (this.config.showThemeSwitcher) {
      menuTemplate.push({ type: 'separator' });

      menuTemplate.push({
        label: 'Theme',
        submenu: [
          {
            label: 'System Default',
            type: 'radio',
            checked: this.themePreference === 'system',
            click: () => {
              this.setTheme('system');
              this.emit('set-theme', 'system');
            },
          },
          {
            label: 'Light',
            type: 'radio',
            checked: this.themePreference === 'light',
            click: () => {
              this.setTheme('light');
              this.emit('set-theme', 'light');
            },
          },
          {
            label: 'Dark',
            type: 'radio',
            checked: this.themePreference === 'dark',
            click: () => {
              this.setTheme('dark');
              this.emit('set-theme', 'dark');
            },
          },
        ],
      });
    }

    menuTemplate.push({ type: 'separator' });

    // Settings
    menuTemplate.push({
      label: 'Settings...',
      accelerator: 'CommandOrControl+,',
      click: () => {
        this.emit('settings');
        this.showWindow();
      },
    });

    // Notifications (if badge present)
    if (this.badge && this.badge.count > 0) {
      menuTemplate.push({
        label: `Notifications (${this.badge.count})`,
        click: () => {
          this.emit('clear-notifications');
          this.clearBadge();
        },
      });
    }

    menuTemplate.push({ type: 'separator' });

    // Quit
    menuTemplate.push({
      label: 'Quit Atlas',
      accelerator: 'CommandOrControl+Q',
      click: () => {
        this.emit('quit');
        app.quit();
      },
    });

    const contextMenu = Menu.buildFromTemplate(menuTemplate);
    this.tray.setContextMenu(contextMenu);
  }

  /**
   * Create a small status icon for menu items
   */
  private createSmallStatusIcon(): NativeImage | undefined {
    // Only create for certain platforms
    if (process.platform !== 'darwin') return undefined;

    const size = 16;
    const color = this.connectionStatus.isOnline ? '#22c55e' : '#ef4444';

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <circle cx="${size / 2}" cy="${size / 2}" r="4" fill="${color}" />
    </svg>`;

    const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
    return nativeImage.createFromDataURL(dataUrl);
  }

  /**
   * Register global keyboard shortcuts
   */
  private registerShortcuts(): void {
    // Push-to-talk shortcut - unregister first to handle hot-reload
    if (globalShortcut.isRegistered(this.config.pushToTalkShortcut)) {
      globalShortcut.unregister(this.config.pushToTalkShortcut);
      logger.debug('Unregistered existing tray shortcut before re-registering');
    }

    const registered = globalShortcut.register(this.config.pushToTalkShortcut, () => {
      logger.debug('Push-to-talk shortcut triggered');
      this.emit('push-to-talk');
    });

    if (registered) {
      logger.info('Global shortcut registered', { shortcut: this.config.pushToTalkShortcut });
    } else {
      logger.warn('Failed to register global shortcut', {
        shortcut: this.config.pushToTalkShortcut,
      });
    }
  }

  /**
   * Unregister global shortcuts
   */
  private unregisterShortcuts(): void {
    globalShortcut.unregister(this.config.pushToTalkShortcut);
    logger.info('Global shortcuts unregistered');
  }

  /**
   * Show the main window
   */
  private showWindow(): void {
    if (!this.mainWindow) return;

    if (!this.mainWindow.isVisible()) {
      this.mainWindow.show();
    }
    this.mainWindow.focus();
  }

  /**
   * Toggle the main window visibility
   */
  private toggleWindow(): void {
    if (!this.mainWindow) return;

    if (this.mainWindow.isVisible()) {
      if (this.mainWindow.isFocused()) {
        this.mainWindow.hide();
      } else {
        this.mainWindow.focus();
      }
    } else {
      this.mainWindow.show();
      this.mainWindow.focus();
    }
  }

  /**
   * Set the main window reference
   */
  setMainWindow(window: BrowserWindow | null): void {
    this.mainWindow = window;
  }

  /**
   * Set pipeline running state (for menu label)
   */
  setRunning(running: boolean): void {
    this.isRunning = running;
    this.updateContextMenu();
  }

  /**
   * Set current window mode (for menu radio button)
   */
  setWindowMode(mode: WindowMode): void {
    this.windowMode = mode;
    this.updateContextMenu();
    logger.debug('Window mode updated in tray', { mode });
  }

  /**
   * Get current window mode
   */
  getWindowMode(): WindowMode {
    return this.windowMode;
  }

  /**
   * Update connection status
   */
  setConnectionStatus(status: Partial<TrayConnectionStatus>): void {
    this.connectionStatus = { ...this.connectionStatus, ...status };
    this.updateTooltip();
    this.updateContextMenu();
  }

  // ===== Audio Device Methods (Session 047-A) =====

  /**
   * Set available audio input devices
   */
  setAudioInputDevices(devices: AudioDeviceInfo[]): void {
    this.audioInputDevices = devices;
    this.updateContextMenu();
    logger.debug('Audio input devices updated', { count: devices.length });
  }

  /**
   * Set available audio output devices
   */
  setAudioOutputDevices(devices: AudioDeviceInfo[]): void {
    this.audioOutputDevices = devices;
    this.updateContextMenu();
    logger.debug('Audio output devices updated', { count: devices.length });
  }

  /**
   * Set all audio devices at once
   */
  setAudioDevices(inputDevices: AudioDeviceInfo[], outputDevices: AudioDeviceInfo[]): void {
    this.audioInputDevices = inputDevices;
    this.audioOutputDevices = outputDevices;
    this.updateContextMenu();
    logger.debug('Audio devices updated', {
      inputs: inputDevices.length,
      outputs: outputDevices.length,
    });
  }

  /**
   * Set selected input device
   */
  setSelectedInputDevice(deviceId: string): void {
    this.selectedInputDevice = deviceId;
    this.updateContextMenu();
    logger.debug('Selected input device changed', { deviceId });
  }

  /**
   * Set selected output device
   */
  setSelectedOutputDevice(deviceId: string): void {
    this.selectedOutputDevice = deviceId;
    this.updateContextMenu();
    logger.debug('Selected output device changed', { deviceId });
  }

  /**
   * Get selected input device ID
   */
  getSelectedInputDevice(): string {
    return this.selectedInputDevice;
  }

  /**
   * Get selected output device ID
   */
  getSelectedOutputDevice(): string {
    return this.selectedOutputDevice;
  }

  /**
   * Get audio input devices
   */
  getAudioInputDevices(): AudioDeviceInfo[] {
    return [...this.audioInputDevices];
  }

  /**
   * Get audio output devices
   */
  getAudioOutputDevices(): AudioDeviceInfo[] {
    return [...this.audioOutputDevices];
  }

  // ===== Volume Control Methods (Session 047-A) =====

  /**
   * Set volume level (0-100)
   */
  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(100, volume));
    if (this.volume > 0) {
      this.isMuted = false;
    }
    this.updateContextMenu();
    logger.debug('Volume changed', { volume: this.volume });
  }

  /**
   * Get current volume level
   */
  getVolume(): number {
    return this.volume;
  }

  /**
   * Toggle mute state
   */
  toggleMute(): void {
    this.isMuted = !this.isMuted;
    this.updateContextMenu();
    logger.debug('Mute toggled', { isMuted: this.isMuted });
  }

  /**
   * Set mute state
   */
  setMuted(muted: boolean): void {
    this.isMuted = muted;
    this.updateContextMenu();
    logger.debug('Mute state set', { isMuted: this.isMuted });
  }

  /**
   * Get mute state
   */
  isMutedState(): boolean {
    return this.isMuted;
  }

  // ===== Theme Methods (Session 047-A) =====

  /**
   * Set theme preference
   */
  setTheme(theme: ThemePreference): void {
    this.themePreference = theme;
    this.updateContextMenu();
    logger.debug('Theme preference changed', { theme });
  }

  /**
   * Get current theme preference
   */
  getTheme(): ThemePreference {
    return this.themePreference;
  }

  /**
   * Add a recent conversation
   */
  addRecentConversation(conversation: RecentConversation): void {
    // Remove if already exists (update)
    this.recentConversations = this.recentConversations.filter((c) => c.id !== conversation.id);

    // Add to front
    this.recentConversations.unshift(conversation);

    // Trim to max
    if (this.recentConversations.length > this.config.maxRecentConversations) {
      this.recentConversations = this.recentConversations.slice(
        0,
        this.config.maxRecentConversations
      );
    }

    this.updateContextMenu();
    logger.debug('Recent conversation added', {
      id: conversation.id,
      total: this.recentConversations.length,
    });
  }

  /**
   * Clear recent conversations
   */
  clearRecentConversations(): void {
    this.recentConversations = [];
    this.updateContextMenu();
    logger.info('Recent conversations cleared');
  }

  /**
   * Get recent conversations
   */
  getRecentConversations(): RecentConversation[] {
    return [...this.recentConversations];
  }

  /**
   * Set notification badge
   */
  setBadge(badge: NotificationBadge): void {
    this.badge = badge;
    this.updateTooltip();
    this.updateContextMenu();

    // Regenerate current icon with badge
    if (!this.animationInterval) {
      const icon = this.createIcon(this.state, 0);
      this.tray?.setImage(icon);
    }

    logger.debug('Badge set', badge);
  }

  /**
   * Clear notification badge
   */
  clearBadge(): void {
    this.badge = null;
    this.updateTooltip();
    this.updateContextMenu();

    // Regenerate current icon without badge
    if (!this.animationInterval) {
      const icon = this.createIcon(this.state, 0);
      this.tray?.setImage(icon);
    }

    logger.debug('Badge cleared');
  }

  /**
   * Increment badge count
   */
  incrementBadge(type: NotificationBadge['type'] = 'info', message?: string): void {
    const currentCount = this.badge?.count || 0;
    this.setBadge({
      count: currentCount + 1,
      type,
      message,
    });
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<TrayConfig>): void {
    const oldShortcut = this.config.pushToTalkShortcut;
    this.config = { ...this.config, ...config };

    // Re-register shortcut if changed
    if (config.pushToTalkShortcut && config.pushToTalkShortcut !== oldShortcut) {
      globalShortcut.unregister(oldShortcut);
      this.registerShortcuts();
    }

    this.updateContextMenu();
    this.updateTooltip();
    logger.info('Tray configuration updated');
  }

  /**
   * Get current configuration
   */
  getConfig(): TrayConfig {
    return { ...this.config };
  }

  /**
   * Get current state
   */
  getState(): TrayState {
    return this.state;
  }

  /**
   * Get connection status
   */
  getConnectionStatus(): TrayConnectionStatus {
    return { ...this.connectionStatus };
  }

  /**
   * Show a balloon notification (Windows) or notification
   */
  showNotification(title: string, content: string): void {
    if (!this.config.showNotifications) return;

    // Use Electron Notification API (cross-platform)
    if (Notification.isSupported()) {
      const notification = new Notification({
        title,
        body: content,
        icon: this.iconCache.get('idle-0'),
        silent: true,
      });

      notification.on('click', () => {
        this.showWindow();
      });

      notification.show();
    } else if (process.platform === 'win32' && this.tray) {
      // Fallback to tray balloon on Windows
      this.tray.displayBalloon({
        title,
        content,
        iconType: 'info',
      });
    }
  }

  /**
   * Truncate text for display
   */
  private truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
  }

  /**
   * Format timestamp for display
   */
  private formatTimestamp(timestamp: number): string {
    const now = Date.now();
    const diff = now - timestamp;

    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;

    const date = new Date(timestamp);
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  /**
   * Destroy the tray
   */
  async destroy(): Promise<void> {
    this.stopAnimation();
    this.unregisterShortcuts();

    // Unsubscribe from connectivity updates
    if (this.connectivityUnsubscribe) {
      this.connectivityUnsubscribe();
      this.connectivityUnsubscribe = null;
    }

    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }

    this.iconCache.clear();
    this.recentConversations = [];
    this.badge = null;
    this.mainWindow = null;

    logger.info('System tray destroyed');
  }
}

// Singleton instance
let trayInstance: AtlasTray | null = null;

/**
 * Get or create the tray singleton
 */
export function getTray(config?: Partial<TrayConfig>): AtlasTray {
  if (!trayInstance) {
    trayInstance = new AtlasTray(config);
  }
  return trayInstance;
}

/**
 * Initialize the tray with a main window
 */
export async function initializeTray(
  mainWindow?: BrowserWindow,
  config?: Partial<TrayConfig>
): Promise<AtlasTray> {
  const tray = getTray(config);
  await tray.initialize(mainWindow);
  return tray;
}

/**
 * Shutdown the tray
 */
export async function shutdownTray(): Promise<void> {
  if (trayInstance) {
    await trayInstance.destroy();
    trayInstance = null;
  }
}

export default AtlasTray;
