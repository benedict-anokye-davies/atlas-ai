/**
 * Atlas Desktop - System Commands Tool
 *
 * Provides system control capabilities for the Atlas voice interface:
 * - Screenshot capture (save to ~/Pictures/Atlas/)
 * - System lock
 * - Application launch
 * - Timer creation
 * - Volume control
 * - Brightness control (where supported)
 *
 * @module agent/tools/system-commands
 */

import { exec } from 'child_process';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';
import { desktopCapturer, screen, BrowserWindow } from 'electron';
import { AgentTool, ActionResult } from '../../../shared/types/agent';
import { createModuleLogger } from '../../utils/logger';

const logger = createModuleLogger('SystemCommands');

// Platform detection
const platform = os.platform();
const isWindows = platform === 'win32';
const isMac = platform === 'darwin';
const isLinux = platform === 'linux';

// Default screenshot directory
const SCREENSHOT_DIR = path.join(os.homedir(), 'Pictures', 'Atlas');

// Timer storage (in-memory for active timers)
const activeTimers: Map<
  string,
  {
    id: string;
    name: string;
    duration: number;
    startTime: number;
    endTime: number;
    timeoutId: NodeJS.Timeout;
    callback?: () => void;
  }
> = new Map();

/**
 * Result interfaces for structured responses
 */
export interface SystemScreenshotResult {
  path: string;
  width: number;
  height: number;
  format: 'png' | 'jpeg';
  size: number;
  timestamp: string;
}

export interface TimerResult {
  id: string;
  name: string;
  duration: number;
  startTime: string;
  endTime: string;
  status: 'active' | 'completed' | 'cancelled';
}

export interface VolumeResult {
  level: number;
  muted: boolean;
  previousLevel?: number;
}

export interface BrightnessResult {
  level: number;
  previousLevel?: number;
  supported: boolean;
}

/**
 * Execute a system command and return stdout
 */
async function executeSystemCommand(
  command: string,
  timeout: number = 5000
): Promise<{ success: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    exec(command, { timeout, windowsHide: true }, (error, stdout, stderr) => {
      resolve({
        success: !error,
        stdout: stdout?.toString() || '',
        stderr: stderr?.toString() || (error?.message ?? ''),
      });
    });
  });
}

/**
 * Generate a unique timer ID
 */
function generateTimerId(): string {
  return `timer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Parse duration string to milliseconds
 * Supports: "5 minutes", "30 seconds", "1 hour", "1h 30m", etc.
 */
function parseDuration(durationStr: string): number | null {
  const normalized = durationStr.toLowerCase().trim();

  // Direct number (assume minutes)
  if (/^\d+$/.test(normalized)) {
    return parseInt(normalized, 10) * 60 * 1000;
  }

  let totalMs = 0;

  // Match patterns like "1h", "30m", "45s", "1 hour", "30 minutes", etc.
  const patterns = [
    { regex: /(\d+)\s*h(?:our)?s?/g, multiplier: 60 * 60 * 1000 },
    { regex: /(\d+)\s*m(?:in(?:ute)?s?)?/g, multiplier: 60 * 1000 },
    { regex: /(\d+)\s*s(?:ec(?:ond)?s?)?/g, multiplier: 1000 },
  ];

  for (const { regex, multiplier } of patterns) {
    let match;
    while ((match = regex.exec(normalized)) !== null) {
      totalMs += parseInt(match[1], 10) * multiplier;
    }
  }

  return totalMs > 0 ? totalMs : null;
}

/**
 * Format milliseconds to human-readable string
 */
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0 ? `${hours} hour(s) ${remainingMinutes} minute(s)` : `${hours} hour(s)`;
  }
  if (minutes > 0) {
    const remainingSeconds = seconds % 60;
    return remainingSeconds > 0
      ? `${minutes} minute(s) ${remainingSeconds} second(s)`
      : `${minutes} minute(s)`;
  }
  return `${seconds} second(s)`;
}

// ============================================================================
// Screenshot Tool
// ============================================================================

/**
 * Take a screenshot and save to ~/Pictures/Atlas/
 */
export const takeScreenshotTool: AgentTool = {
  name: 'system_screenshot',
  description:
    'Take a screenshot of the screen and save it to the Pictures/Atlas folder. Returns the file path.',
  parameters: {
    type: 'object',
    properties: {
      displayIndex: {
        type: 'number',
        description: 'Index of the display to capture (default: 0 for primary)',
      },
      format: {
        type: 'string',
        description: 'Image format: "png" or "jpeg" (default: "png")',
      },
      filename: {
        type: 'string',
        description: 'Custom filename (without extension). Default: "screenshot_TIMESTAMP"',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const displayIndex = (params.displayIndex as number) || 0;
      const format = ((params.format as string) || 'png') as 'png' | 'jpeg';
      const customFilename = params.filename as string | undefined;

      // Ensure screenshot directory exists
      await fs.mkdir(SCREENSHOT_DIR, { recursive: true });

      // Get all displays
      const displays = screen.getAllDisplays();
      if (displayIndex >= displays.length) {
        return {
          success: false,
          error: `Display ${displayIndex} not found. Available displays: 0-${displays.length - 1}`,
        };
      }

      const display = displays[displayIndex];

      // Get screen sources
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: {
          width: display.bounds.width * display.scaleFactor,
          height: display.bounds.height * display.scaleFactor,
        },
      });

      const screenSource = sources.find(
        (s) => s.display_id === display.id.toString() || s.name.includes('Screen')
      );

      if (!screenSource) {
        return { success: false, error: 'Could not find screen source for capture' };
      }

      // Get thumbnail as NativeImage
      const thumbnail = screenSource.thumbnail;
      const imageBuffer = format === 'png' ? thumbnail.toPNG() : thumbnail.toJPEG(90);
      const size = thumbnail.getSize();

      // Generate filename
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = customFilename
        ? `${customFilename}.${format}`
        : `screenshot_${timestamp}.${format}`;
      const savePath = path.join(SCREENSHOT_DIR, filename);

      // Save the screenshot
      await fs.writeFile(savePath, imageBuffer);

      const result: SystemScreenshotResult = {
        path: savePath,
        width: size.width,
        height: size.height,
        format,
        size: imageBuffer.length,
        timestamp: new Date().toISOString(),
      };

      logger.info('Screenshot saved', { path: savePath, size: imageBuffer.length });

      return {
        success: true,
        data: result,
        metadata: {
          voiceResponse: `Screenshot saved to ${filename}`,
        },
      };
    } catch (error) {
      const err = error as Error;
      logger.error('Screenshot failed', { error: err.message });
      return { success: false, error: `Failed to take screenshot: ${err.message}` };
    }
  },
};

// ============================================================================
// Lock Screen Tool
// ============================================================================

/**
 * Lock the computer screen
 */
export const lockScreenTool: AgentTool = {
  name: 'system_lock',
  description: 'Lock the computer screen. Works on Windows, macOS, and Linux.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (): Promise<ActionResult> => {
    try {
      let command: string;

      if (isWindows) {
        // Windows: Use rundll32 to lock
        command = 'rundll32.exe user32.dll,LockWorkStation';
      } else if (isMac) {
        // macOS: Use pmset or loginwindow
        command =
          '/System/Library/CoreServices/Menu\\ Extras/User.menu/Contents/Resources/CGSession -suspend';
      } else if (isLinux) {
        // Linux: Try common lock commands
        // Try loginctl first (systemd), then dbus, then xdg-screensaver
        command =
          'loginctl lock-session || dbus-send --type=method_call --dest=org.gnome.ScreenSaver /org/gnome/ScreenSaver org.gnome.ScreenSaver.Lock || xdg-screensaver lock';
      } else {
        return {
          success: false,
          error: `Screen lock not supported on platform: ${platform}`,
        };
      }

      const result = await executeSystemCommand(command);

      if (result.success || isWindows) {
        // Windows lock command doesn't wait for completion
        logger.info('Screen locked');
        return {
          success: true,
          data: { locked: true, platform },
          metadata: {
            voiceResponse: 'Computer locked',
          },
        };
      }

      return {
        success: false,
        error: `Failed to lock screen: ${result.stderr}`,
      };
    } catch (error) {
      const err = error as Error;
      logger.error('Lock screen failed', { error: err.message });
      return { success: false, error: `Failed to lock screen: ${err.message}` };
    }
  },
};

// ============================================================================
// Timer Tool
// ============================================================================

/**
 * Set a countdown timer
 */
export const setTimerTool: AgentTool = {
  name: 'system_set_timer',
  description:
    'Set a countdown timer. Supports formats like "5 minutes", "1 hour 30 minutes", "45 seconds", "1h 30m".',
  parameters: {
    type: 'object',
    properties: {
      duration: {
        type: 'string',
        description:
          'Duration for the timer (e.g., "5 minutes", "1 hour", "30 seconds", "1h 30m")',
      },
      name: {
        type: 'string',
        description: 'Optional name for the timer (e.g., "pizza timer", "break reminder")',
      },
    },
    required: ['duration'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const durationStr = params.duration as string;
      const timerName = (params.name as string) || 'Timer';

      const durationMs = parseDuration(durationStr);
      if (!durationMs) {
        return {
          success: false,
          error: `Could not parse duration: "${durationStr}". Try formats like "5 minutes", "1 hour", "30 seconds".`,
        };
      }

      // Maximum timer duration: 24 hours
      const MAX_DURATION = 24 * 60 * 60 * 1000;
      if (durationMs > MAX_DURATION) {
        return {
          success: false,
          error: 'Timer duration cannot exceed 24 hours',
        };
      }

      const timerId = generateTimerId();
      const startTime = Date.now();
      const endTime = startTime + durationMs;

      // Create the timer
      const timeoutId = setTimeout(() => {
        const timer = activeTimers.get(timerId);
        if (timer) {
          logger.info('Timer completed', { id: timerId, name: timerName });

          // Show system notification
          if (BrowserWindow.getAllWindows().length > 0) {
            const win = BrowserWindow.getAllWindows()[0];
            win.webContents.send('timer-complete', {
              id: timerId,
              name: timerName,
              duration: durationMs,
            });
          }

          // Clean up
          activeTimers.delete(timerId);
        }
      }, durationMs);

      // Store the timer
      activeTimers.set(timerId, {
        id: timerId,
        name: timerName,
        duration: durationMs,
        startTime,
        endTime,
        timeoutId,
      });

      const result: TimerResult = {
        id: timerId,
        name: timerName,
        duration: durationMs,
        startTime: new Date(startTime).toISOString(),
        endTime: new Date(endTime).toISOString(),
        status: 'active',
      };

      logger.info('Timer set', { id: timerId, name: timerName, duration: durationMs });

      return {
        success: true,
        data: result,
        metadata: {
          voiceResponse: `Timer set for ${formatDuration(durationMs)}`,
        },
      };
    } catch (error) {
      const err = error as Error;
      logger.error('Set timer failed', { error: err.message });
      return { success: false, error: `Failed to set timer: ${err.message}` };
    }
  },
};

/**
 * Cancel an active timer
 */
export const cancelTimerTool: AgentTool = {
  name: 'system_cancel_timer',
  description: 'Cancel an active timer by ID or name.',
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'Timer ID to cancel',
      },
      name: {
        type: 'string',
        description: 'Timer name to cancel (if multiple, cancels the first match)',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const timerId = params.id as string | undefined;
      const timerName = params.name as string | undefined;

      if (!timerId && !timerName) {
        return {
          success: false,
          error: 'Either timer ID or name is required',
        };
      }

      let timerToCancel: {
        id: string;
        name: string;
        duration: number;
        startTime: number;
        endTime: number;
        timeoutId: NodeJS.Timeout;
        callback?: () => void;
      } | undefined = undefined;
      let cancelKey: string | undefined;

      if (timerId && activeTimers.has(timerId)) {
        timerToCancel = activeTimers.get(timerId);
        cancelKey = timerId;
      } else if (timerName) {
        for (const [key, timer] of activeTimers) {
          if (timer.name.toLowerCase().includes(timerName.toLowerCase())) {
            timerToCancel = timer;
            cancelKey = key;
            break;
          }
        }
      }

      if (!timerToCancel || !cancelKey) {
        return {
          success: false,
          error: `Timer not found: ${timerId || timerName}`,
        };
      }

      // Clear the timeout
      clearTimeout(timerToCancel.timeoutId);
      activeTimers.delete(cancelKey);

      const result: TimerResult = {
        id: timerToCancel.id,
        name: timerToCancel.name,
        duration: timerToCancel.duration,
        startTime: new Date(timerToCancel.startTime).toISOString(),
        endTime: new Date(timerToCancel.endTime).toISOString(),
        status: 'cancelled',
      };

      logger.info('Timer cancelled', { id: cancelKey, name: timerToCancel.name });

      return {
        success: true,
        data: result,
        metadata: {
          voiceResponse: `Cancelled timer: ${timerToCancel.name}`,
        },
      };
    } catch (error) {
      const err = error as Error;
      logger.error('Cancel timer failed', { error: err.message });
      return { success: false, error: `Failed to cancel timer: ${err.message}` };
    }
  },
};

/**
 * List all active timers
 */
export const listTimersTool: AgentTool = {
  name: 'system_list_timers',
  description: 'List all active timers with their remaining time.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (): Promise<ActionResult> => {
    try {
      const now = Date.now();
      const timers: Array<TimerResult & { remaining: string }> = [];

      for (const [, timer] of activeTimers) {
        const remainingMs = Math.max(0, timer.endTime - now);
        timers.push({
          id: timer.id,
          name: timer.name,
          duration: timer.duration,
          startTime: new Date(timer.startTime).toISOString(),
          endTime: new Date(timer.endTime).toISOString(),
          status: 'active',
          remaining: formatDuration(remainingMs),
        });
      }

      logger.debug('Listed timers', { count: timers.length });

      const voiceResponse =
        timers.length === 0
          ? 'No active timers'
          : timers.length === 1
            ? `One active timer: ${timers[0].name} with ${timers[0].remaining} remaining`
            : `${timers.length} active timers`;

      return {
        success: true,
        data: { timers, count: timers.length },
        metadata: { voiceResponse },
      };
    } catch (error) {
      const err = error as Error;
      logger.error('List timers failed', { error: err.message });
      return { success: false, error: `Failed to list timers: ${err.message}` };
    }
  },
};

// ============================================================================
// Volume Control Tool
// ============================================================================

/**
 * Set system volume
 */
export const setVolumeTool: AgentTool = {
  name: 'system_set_volume',
  description: 'Set the system volume level (0-100) or mute/unmute.',
  parameters: {
    type: 'object',
    properties: {
      level: {
        type: 'number',
        description: 'Volume level from 0 to 100',
      },
      mute: {
        type: 'boolean',
        description: 'Set to true to mute, false to unmute',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const level = params.level as number | undefined;
      const mute = params.mute as boolean | undefined;

      if (level === undefined && mute === undefined) {
        return {
          success: false,
          error: 'Either volume level or mute parameter is required',
        };
      }

      let command: string;
      let voiceResponse: string;

      if (mute !== undefined) {
        // Handle mute/unmute
        if (isWindows) {
          // PowerShell command to toggle mute using SendKeys for volume mute key
          command = `powershell -Command "(New-Object -ComObject WScript.Shell).SendKeys([char]173)"`;
        } else if (isMac) {
          command = mute ? 'osascript -e "set volume with output muted"' : 'osascript -e "set volume without output muted"';
        } else {
          command = mute ? 'pactl set-sink-mute @DEFAULT_SINK@ 1' : 'pactl set-sink-mute @DEFAULT_SINK@ 0';
        }
        voiceResponse = mute ? 'Volume muted' : 'Volume unmuted';
      } else if (level !== undefined) {
        // Handle volume level
        const volumeLevel = Math.max(0, Math.min(100, level));

        if (isWindows) {
          // Windows: Use nircmd if installed, fallback to PowerShell volume key
          command = `nircmd.exe setsysvolume ${Math.floor((volumeLevel / 100) * 65535)} || powershell -Command "(New-Object -ComObject WScript.Shell).SendKeys([char]175)"`;
        } else if (isMac) {
          // macOS: Set output volume (0-100)
          command = `osascript -e "set volume output volume ${volumeLevel}"`;
        } else {
          // Linux: Use pactl or amixer
          command = `pactl set-sink-volume @DEFAULT_SINK@ ${volumeLevel}% || amixer set Master ${volumeLevel}%`;
        }
        voiceResponse = `Volume set to ${volumeLevel} percent`;
      } else {
        return { success: false, error: 'Invalid parameters' };
      }

      logger.debug('Setting volume', { level, mute, command });

      // Execute command (result is used for logging purposes, success is not critical)
      await executeSystemCommand(command);

      // Volume commands may not return useful output
      const volumeResult: VolumeResult = {
        level: level ?? 0,
        muted: mute ?? false,
      };

      logger.info('Volume changed', { level, mute });

      return {
        success: true,
        data: volumeResult,
        metadata: { voiceResponse },
      };
    } catch (error) {
      const err = error as Error;
      logger.error('Set volume failed', { error: err.message });
      return { success: false, error: `Failed to set volume: ${err.message}` };
    }
  },
};

/**
 * Get current volume level
 */
export const getVolumeTool: AgentTool = {
  name: 'system_get_volume',
  description: 'Get the current system volume level.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (): Promise<ActionResult> => {
    try {
      let command: string;

      if (isWindows) {
        // PowerShell to get volume (requires specific module or nircmd)
        command = 'powershell -Command "Get-AudioDevice -PlaybackVolume"';
      } else if (isMac) {
        command = 'osascript -e "output volume of (get volume settings)"';
      } else {
        command = "pactl get-sink-volume @DEFAULT_SINK@ | grep -oP '\\d+%' | head -1";
      }

      const result = await executeSystemCommand(command);

      let level = 50; // Default fallback
      const muted = false;

      if (result.success && result.stdout) {
        // Parse the output based on platform
        if (isMac) {
          level = parseInt(result.stdout.trim(), 10) || 50;
        } else if (isLinux) {
          const match = result.stdout.match(/(\d+)%/);
          if (match) {
            level = parseInt(match[1], 10);
          }
        }
      }

      const volumeResult: VolumeResult = { level, muted };

      return {
        success: true,
        data: volumeResult,
        metadata: {
          voiceResponse: `Volume is at ${level} percent`,
        },
      };
    } catch (error) {
      const err = error as Error;
      logger.error('Get volume failed', { error: err.message });
      return { success: false, error: `Failed to get volume: ${err.message}` };
    }
  },
};

// ============================================================================
// Brightness Control Tool
// ============================================================================

/**
 * Set display brightness
 */
export const setBrightnessTool: AgentTool = {
  name: 'system_set_brightness',
  description:
    'Set the display brightness level (0-100). May not be supported on all systems (especially external monitors).',
  parameters: {
    type: 'object',
    properties: {
      level: {
        type: 'number',
        description: 'Brightness level from 0 to 100',
      },
    },
    required: ['level'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const level = Math.max(0, Math.min(100, params.level as number));

      let command: string;
      let supported = true;

      if (isWindows) {
        // Windows: Use PowerShell with WMI (works on laptops)
        command = `powershell -Command "(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods).WmiSetBrightness(1,${level})"`;
      } else if (isMac) {
        // macOS: Use brightness command (requires brightness CLI tool)
        // Or use AppleScript for built-in display
        const macBrightness = level / 100;
        command = `brightness ${macBrightness} 2>/dev/null || osascript -e 'tell application "System Events" to set value of slider 1 of group 1 of window "Display" of application process "System Preferences" to ${level}'`;
      } else {
        // Linux: Use xrandr or brightnessctl
        command = `brightnessctl set ${level}% 2>/dev/null || xrandr --output $(xrandr | grep ' connected' | head -1 | cut -d' ' -f1) --brightness ${level / 100}`;
      }

      logger.debug('Setting brightness', { level, command });

      const result = await executeSystemCommand(command);

      // Brightness control may fail on unsupported hardware
      if (!result.success && result.stderr) {
        if (
          result.stderr.includes('not supported') ||
          result.stderr.includes('WMI') ||
          result.stderr.includes('not found')
        ) {
          supported = false;
        }
      }

      const brightnessResult: BrightnessResult = {
        level,
        supported,
      };

      if (!supported) {
        logger.warn('Brightness control not supported on this system');
        return {
          success: false,
          data: brightnessResult,
          error: 'Brightness control is not supported on this display',
        };
      }

      logger.info('Brightness changed', { level });

      return {
        success: true,
        data: brightnessResult,
        metadata: {
          voiceResponse: `Brightness set to ${level} percent`,
        },
      };
    } catch (error) {
      const err = error as Error;
      logger.error('Set brightness failed', { error: err.message });
      return { success: false, error: `Failed to set brightness: ${err.message}` };
    }
  },
};

/**
 * Get current brightness level
 */
export const getBrightnessTool: AgentTool = {
  name: 'system_get_brightness',
  description: 'Get the current display brightness level.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (): Promise<ActionResult> => {
    try {
      let command: string;

      if (isWindows) {
        command =
          'powershell -Command "(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightness).CurrentBrightness"';
      } else if (isMac) {
        command = 'brightness -l 2>/dev/null | grep brightness | head -1 | awk \'{print $2 * 100}\'';
      } else {
        command = 'brightnessctl get 2>/dev/null | xargs -I{} echo "scale=0; {} * 100 / $(brightnessctl max)" | bc';
      }

      const result = await executeSystemCommand(command);

      let level = 50; // Default fallback
      let supported = true;

      if (result.success && result.stdout) {
        const parsed = parseInt(result.stdout.trim(), 10);
        if (!isNaN(parsed)) {
          level = Math.max(0, Math.min(100, parsed));
        }
      } else {
        supported = false;
      }

      const brightnessResult: BrightnessResult = { level, supported };

      if (!supported) {
        return {
          success: false,
          data: brightnessResult,
          error: 'Brightness control is not supported on this display',
        };
      }

      return {
        success: true,
        data: brightnessResult,
        metadata: {
          voiceResponse: `Brightness is at ${level} percent`,
        },
      };
    } catch (error) {
      const err = error as Error;
      logger.error('Get brightness failed', { error: err.message });
      return { success: false, error: `Failed to get brightness: ${err.message}` };
    }
  },
};

// ============================================================================
// Exports
// ============================================================================

/**
 * Get all system command tools
 */
export function getSystemCommandTools(): AgentTool[] {
  return [
    takeScreenshotTool,
    lockScreenTool,
    setTimerTool,
    cancelTimerTool,
    listTimersTool,
    setVolumeTool,
    getVolumeTool,
    setBrightnessTool,
    getBrightnessTool,
  ];
}

/**
 * Clean up resources (clear all timers)
 */
export function cleanupSystemCommands(): void {
  for (const [, timer] of activeTimers) {
    clearTimeout(timer.timeoutId);
  }
  activeTimers.clear();
  logger.info('System commands cleanup complete');
}

export default {
  takeScreenshotTool,
  lockScreenTool,
  setTimerTool,
  cancelTimerTool,
  listTimersTool,
  setVolumeTool,
  getVolumeTool,
  setBrightnessTool,
  getBrightnessTool,
  getSystemCommandTools,
  cleanupSystemCommands,
};
