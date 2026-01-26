/**
 * Context Monitor
 * Monitors system context for automation triggers
 */

import { EventEmitter } from 'events';
import { exec } from 'child_process';
import { promisify } from 'util';
import { createModuleLogger } from '../utils/logger';
import { ContextState } from './types';

const execAsync = promisify(exec);
const logger = createModuleLogger('ContextMonitor');

interface ContextMonitorConfig {
  pollInterval: number;
  idleThreshold: number;
  trackApplications: boolean;
  trackNetwork: boolean;
  trackBattery: boolean;
}

const DEFAULT_CONFIG: ContextMonitorConfig = {
  pollInterval: 5000, // 5 seconds
  idleThreshold: 300, // 5 minutes
  trackApplications: true,
  trackNetwork: true,
  trackBattery: true
};

class ContextMonitor extends EventEmitter {
  private config: ContextMonitorConfig;
  private pollTimer: NodeJS.Timeout | null = null;
  private lastState: ContextState | null = null;
  private customVariables: Map<string, unknown> = new Map();
  private initialized: boolean = false;

  constructor(config: Partial<ContextMonitorConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    logger.info('Initializing context monitor');
    this.initialized = true;
    this.emit('initialized');
  }

  /**
   * Start monitoring context
   */
  start(): void {
    if (this.pollTimer) return;
    
    logger.info('Starting context monitor');
    
    // Initial poll
    this.pollContext();
    
    // Set up periodic polling
    this.pollTimer = setInterval(() => {
      this.pollContext();
    }, this.config.pollInterval);
    
    this.emit('started');
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    
    logger.info('Context monitor stopped');
    this.emit('stopped');
  }

  /**
   * Poll current context
   */
  private async pollContext(): Promise<void> {
    try {
      const state = await this.getCurrentState();
      
      // Detect changes
      if (this.lastState) {
        this.detectChanges(this.lastState, state);
      }
      
      this.lastState = state;
      this.emit('context-update', state);
    } catch (error) {
      logger.error('Context poll failed', error);
    }
  }

  /**
   * Get current context state
   */
  async getCurrentState(): Promise<ContextState> {
    const [
      applicationInfo,
      idleTime,
      batteryInfo,
      networkInfo
    ] = await Promise.all([
      this.config.trackApplications ? this.getActiveApplication() : { app: 'unknown', window: 'unknown' },
      this.getIdleTime(),
      this.config.trackBattery ? this.getBatteryInfo() : { level: undefined, charging: undefined },
      this.config.trackNetwork ? this.getNetworkInfo() : { connected: true, type: undefined, ssid: undefined }
    ]);

    const now = new Date();
    const hour = now.getHours();
    
    let timeOfDay: string;
    if (hour >= 5 && hour < 12) timeOfDay = 'morning';
    else if (hour >= 12 && hour < 17) timeOfDay = 'afternoon';
    else if (hour >= 17 && hour < 21) timeOfDay = 'evening';
    else timeOfDay = 'night';

    return {
      activeApplication: applicationInfo.app,
      activeWindow: applicationInfo.window,
      idleTime,
      isLocked: await this.isScreenLocked(),
      batteryLevel: batteryInfo.level,
      isCharging: batteryInfo.charging,
      networkConnected: networkInfo.connected,
      networkType: networkInfo.type,
      ssid: networkInfo.ssid,
      timeOfDay,
      dayOfWeek: now.getDay(),
      customVariables: this.customVariables
    };
  }

  /**
   * Detect context changes
   */
  private detectChanges(oldState: ContextState, newState: ContextState): void {
    // Application change
    if (oldState.activeApplication !== newState.activeApplication) {
      this.emit('application-change', {
        previous: oldState.activeApplication,
        current: newState.activeApplication
      });
      
      // Emit focus/blur events
      this.emit('application-blur', oldState.activeApplication);
      this.emit('application-focus', newState.activeApplication);
    }

    // Window change
    if (oldState.activeWindow !== newState.activeWindow) {
      this.emit('window-change', {
        previous: oldState.activeWindow,
        current: newState.activeWindow
      });
    }

    // Lock state change
    if (oldState.isLocked !== newState.isLocked) {
      this.emit(newState.isLocked ? 'system-lock' : 'system-unlock');
    }

    // Network change
    if (oldState.networkConnected !== newState.networkConnected) {
      this.emit(newState.networkConnected ? 'network-connect' : 'network-disconnect', {
        type: newState.networkType,
        ssid: newState.ssid
      });
    }

    // Battery events
    if (newState.batteryLevel !== undefined && oldState.batteryLevel !== undefined) {
      if (newState.batteryLevel <= 20 && oldState.batteryLevel > 20) {
        this.emit('battery-low', newState.batteryLevel);
      }
    }
    
    if (oldState.isCharging !== newState.isCharging) {
      this.emit(newState.isCharging ? 'battery-charging' : 'battery-discharging');
    }

    // Idle detection
    if (oldState.idleTime < this.config.idleThreshold && 
        newState.idleTime >= this.config.idleThreshold) {
      this.emit('system-idle', newState.idleTime);
    }
    
    if (oldState.idleTime >= this.config.idleThreshold && 
        newState.idleTime < this.config.idleThreshold) {
      this.emit('system-active');
    }

    // Time of day change
    if (oldState.timeOfDay !== newState.timeOfDay) {
      this.emit('time-period-change', {
        previous: oldState.timeOfDay,
        current: newState.timeOfDay
      });
    }
  }

  /**
   * Get active application (Windows)
   */
  private async getActiveApplication(): Promise<{ app: string; window: string }> {
    try {
      if (process.platform === 'win32') {
        const script = `
          Add-Type @"
          using System;
          using System.Runtime.InteropServices;
          using System.Text;
          public class Win32 {
            [DllImport("user32.dll")]
            public static extern IntPtr GetForegroundWindow();
            [DllImport("user32.dll")]
            public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
            [DllImport("user32.dll")]
            public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
          }
"@
          $hwnd = [Win32]::GetForegroundWindow()
          $sb = New-Object System.Text.StringBuilder 256
          [Win32]::GetWindowText($hwnd, $sb, 256) | Out-Null
          $processId = 0
          [Win32]::GetWindowThreadProcessId($hwnd, [ref]$processId) | Out-Null
          $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
          Write-Output "$($process.ProcessName)|$($sb.ToString())"
        `;
        
        const { stdout } = await execAsync(`powershell -Command "${script.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`);
        const [app, window] = stdout.trim().split('|');
        return { app: app || 'unknown', window: window || 'unknown' };
      } else if (process.platform === 'darwin') {
        const { stdout } = await execAsync(`osascript -e 'tell application "System Events" to get name of first process whose frontmost is true'`);
        return { app: stdout.trim(), window: 'unknown' };
      } else {
        // Linux - try xdotool
        try {
          const { stdout } = await execAsync('xdotool getwindowfocus getwindowname');
          return { app: 'unknown', window: stdout.trim() };
        } catch {
          return { app: 'unknown', window: 'unknown' };
        }
      }
    } catch (error) {
      logger.debug('Failed to get active application', error);
      return { app: 'unknown', window: 'unknown' };
    }
  }

  /**
   * Get system idle time in seconds
   */
  private async getIdleTime(): Promise<number> {
    try {
      if (process.platform === 'win32') {
        const script = `
          Add-Type @"
          using System;
          using System.Runtime.InteropServices;
          public class IdleTime {
            [StructLayout(LayoutKind.Sequential)]
            public struct LASTINPUTINFO {
              public uint cbSize;
              public uint dwTime;
            }
            [DllImport("user32.dll")]
            public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);
          }
"@
          $lii = New-Object IdleTime+LASTINPUTINFO
          $lii.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf($lii)
          [IdleTime]::GetLastInputInfo([ref]$lii) | Out-Null
          $tickCount = [Environment]::TickCount
          $idleMs = $tickCount - $lii.dwTime
          Write-Output ($idleMs / 1000)
        `;
        
        const { stdout } = await execAsync(`powershell -Command "${script.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`);
        return Math.floor(parseFloat(stdout.trim()));
      } else if (process.platform === 'darwin') {
        const { stdout } = await execAsync("ioreg -c IOHIDSystem | awk '/HIDIdleTime/ {print $NF/1000000000; exit}'");
        return Math.floor(parseFloat(stdout.trim()));
      } else {
        // Linux - try xprintidle
        try {
          const { stdout } = await execAsync('xprintidle');
          return Math.floor(parseInt(stdout.trim()) / 1000);
        } catch {
          return 0;
        }
      }
    } catch (error) {
      logger.debug('Failed to get idle time', error);
      return 0;
    }
  }

  /**
   * Check if screen is locked
   */
  private async isScreenLocked(): Promise<boolean> {
    try {
      if (process.platform === 'win32') {
        const { stdout } = await execAsync(
          'powershell -Command "(Get-Process -Name LogonUI -ErrorAction SilentlyContinue) -ne $null"'
        );
        return stdout.trim().toLowerCase() === 'true';
      } else if (process.platform === 'darwin') {
        const { stdout } = await execAsync(
          "python3 -c \"import Quartz; print(Quartz.CGSessionCopyCurrentDictionary().get('CGSSessionScreenIsLocked', 0))\""
        );
        return stdout.trim() === '1';
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Get battery information
   */
  private async getBatteryInfo(): Promise<{ level?: number; charging?: boolean }> {
    try {
      if (process.platform === 'win32') {
        const { stdout } = await execAsync(
          'powershell -Command "Get-WmiObject Win32_Battery | Select-Object -First 1 EstimatedChargeRemaining,BatteryStatus | ConvertTo-Json"'
        );
        const data = JSON.parse(stdout.trim());
        return {
          level: data.EstimatedChargeRemaining,
          charging: data.BatteryStatus === 2
        };
      } else if (process.platform === 'darwin') {
        const { stdout } = await execAsync('pmset -g batt');
        const match = stdout.match(/(\d+)%/);
        const level = match ? parseInt(match[1]) : undefined;
        const charging = stdout.includes('charging') || stdout.includes('AC Power');
        return { level, charging };
      }
      return {};
    } catch {
      return {};
    }
  }

  /**
   * Get network information
   */
  private async getNetworkInfo(): Promise<{ connected: boolean; type?: string; ssid?: string }> {
    try {
      if (process.platform === 'win32') {
        const { stdout } = await execAsync(
          'netsh wlan show interfaces | findstr /i "SSID State"'
        );
        const ssidMatch = stdout.match(/SSID\s*:\s*(.+)/i);
        const stateMatch = stdout.match(/State\s*:\s*(.+)/i);
        
        return {
          connected: stateMatch ? stateMatch[1].trim().toLowerCase() === 'connected' : true,
          type: 'wifi',
          ssid: ssidMatch ? ssidMatch[1].trim() : undefined
        };
      } else if (process.platform === 'darwin') {
        const { stdout } = await execAsync(
          "/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport -I | awk '/ SSID/ {print substr($0, index($0, $2))}'"
        );
        return {
          connected: stdout.trim().length > 0,
          type: 'wifi',
          ssid: stdout.trim() || undefined
        };
      }
      return { connected: true };
    } catch {
      return { connected: true };
    }
  }

  /**
   * Set a custom variable
   */
  setVariable(name: string, value: unknown): void {
    this.customVariables.set(name, value);
    this.emit('variable-change', { name, value });
  }

  /**
   * Get a custom variable
   */
  getVariable(name: string): unknown {
    return this.customVariables.get(name);
  }

  /**
   * Get all custom variables
   */
  getVariables(): Map<string, unknown> {
    return new Map(this.customVariables);
  }

  getStatus(): {
    initialized: boolean;
    running: boolean;
    lastState: ContextState | null;
  } {
    return {
      initialized: this.initialized,
      running: this.pollTimer !== null,
      lastState: this.lastState
    };
  }
}

// Singleton instance
let contextMonitor: ContextMonitor | null = null;

export function getContextMonitor(): ContextMonitor {
  if (!contextMonitor) {
    contextMonitor = new ContextMonitor();
  }
  return contextMonitor;
}

export { ContextMonitor };
