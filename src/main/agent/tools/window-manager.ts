/**
 * Atlas Desktop - Window Manager Tool
 * Manage windows on Windows using PowerShell and Win32 APIs
 *
 * Features:
 * - List all open windows
 * - Focus/activate a window
 * - Minimize/maximize/restore windows
 * - Move and resize windows
 * - Close windows
 * - Get window information
 *
 * @module agent/tools/window-manager
 */

import { AgentTool, ActionResult } from '../../../shared/types/agent';
import { createModuleLogger } from '../../utils/logger';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

const execAsync = promisify(exec);
const logger = createModuleLogger('WindowManager');

// =============================================================================
// Types and Interfaces
// =============================================================================

/**
 * Window information structure
 */
export interface WindowInfo {
  /** Window handle (unique identifier) */
  handle: string;
  /** Window title */
  title: string;
  /** Process ID */
  processId: number;
  /** Process name */
  processName: string;
  /** Window position and size */
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  /** Whether window is visible */
  isVisible: boolean;
  /** Whether window is minimized */
  isMinimized: boolean;
  /** Whether window is maximized */
  isMaximized: boolean;
  /** Whether window is the foreground window */
  isForeground: boolean;
}

/**
 * Window state to set
 */
export type WindowState = 'minimize' | 'maximize' | 'restore' | 'hide' | 'show';

// =============================================================================
// PowerShell Scripts
// =============================================================================

/**
 * PowerShell script to list all windows
 */
const LIST_WINDOWS_SCRIPT = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Collections.Generic;

public class WindowHelper {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    
    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool IsWindowVisible(IntPtr hWnd);
    
    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool IsIconic(IntPtr hWnd);
    
    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool IsZoomed(IntPtr hWnd);
    
    [DllImport("user32.dll")]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    
    [DllImport("user32.dll")]
    public static extern int GetWindowTextLength(IntPtr hWnd);
    
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    
    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }
    
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    
    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    
    public static List<IntPtr> handles = new List<IntPtr>();
    
    public static bool EnumCallback(IntPtr hWnd, IntPtr lParam) {
        if (IsWindowVisible(hWnd) && GetWindowTextLength(hWnd) > 0) {
            handles.Add(hWnd);
        }
        return true;
    }
}
"@

$foreground = [WindowHelper]::GetForegroundWindow()
[WindowHelper]::handles.Clear()
[void][WindowHelper]::EnumWindows([WindowHelper+EnumWindowsProc]{ param($h, $l) [WindowHelper]::EnumCallback($h, $l) }, [IntPtr]::Zero)

$windows = @()
foreach ($handle in [WindowHelper]::handles) {
    $length = [WindowHelper]::GetWindowTextLength($handle)
    $sb = New-Object System.Text.StringBuilder($length + 1)
    [WindowHelper]::GetWindowText($handle, $sb, $sb.Capacity) | Out-Null
    $title = $sb.ToString()
    
    $processId = 0
    [WindowHelper]::GetWindowThreadProcessId($handle, [ref]$processId) | Out-Null
    
    $processName = ""
    try {
        $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
        if ($process) { $processName = $process.ProcessName }
    } catch {}
    
    $rect = New-Object WindowHelper+RECT
    [WindowHelper]::GetWindowRect($handle, [ref]$rect) | Out-Null
    
    $windows += @{
        handle = $handle.ToString()
        title = $title
        processId = $processId
        processName = $processName
        bounds = @{
            x = $rect.Left
            y = $rect.Top
            width = $rect.Right - $rect.Left
            height = $rect.Bottom - $rect.Top
        }
        isVisible = [WindowHelper]::IsWindowVisible($handle)
        isMinimized = [WindowHelper]::IsIconic($handle)
        isMaximized = [WindowHelper]::IsZoomed($handle)
        isForeground = ($handle -eq $foreground)
    }
}

$windows | ConvertTo-Json -Depth 3
`;

/**
 * PowerShell script to focus a window
 */
const FOCUS_WINDOW_SCRIPT = (handle: string) => `
Add-Type @"
using System;
using System.Runtime.InteropServices;

public class FocusHelper {
    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
    
    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    
    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool IsIconic(IntPtr hWnd);
}
"@

$handle = [IntPtr]::new(${handle})
if ([FocusHelper]::IsIconic($handle)) {
    [FocusHelper]::ShowWindow($handle, 9) | Out-Null  # SW_RESTORE
}
$result = [FocusHelper]::SetForegroundWindow($handle)
@{ success = $result } | ConvertTo-Json
`;

/**
 * PowerShell script to set window state
 */
const SET_WINDOW_STATE_SCRIPT = (handle: string, state: WindowState) => {
  const showCommand: Record<WindowState, number> = {
    minimize: 6, // SW_MINIMIZE
    maximize: 3, // SW_MAXIMIZE
    restore: 9, // SW_RESTORE
    hide: 0, // SW_HIDE
    show: 5, // SW_SHOW
  };
  return `
Add-Type @"
using System;
using System.Runtime.InteropServices;

public class StateHelper {
    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@

$handle = [IntPtr]::new(${handle})
$result = [StateHelper]::ShowWindow($handle, ${showCommand[state]})
@{ success = $result } | ConvertTo-Json
`;
};

/**
 * PowerShell script to move/resize a window
 */
const MOVE_WINDOW_SCRIPT = (
  handle: string,
  x: number,
  y: number,
  width: number,
  height: number
) => `
Add-Type @"
using System;
using System.Runtime.InteropServices;

public class MoveHelper {
    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);
}
"@

$handle = [IntPtr]::new(${handle})
$result = [MoveHelper]::MoveWindow($handle, ${x}, ${y}, ${width}, ${height}, $true)
@{ success = $result } | ConvertTo-Json
`;

/**
 * PowerShell script to close a window
 */
const CLOSE_WINDOW_SCRIPT = (handle: string) => `
Add-Type @"
using System;
using System.Runtime.InteropServices;

public class CloseHelper {
    public const int WM_CLOSE = 0x0010;
    
    [DllImport("user32.dll")]
    public static extern IntPtr SendMessage(IntPtr hWnd, int Msg, IntPtr wParam, IntPtr lParam);
}
"@

$handle = [IntPtr]::new(${handle})
[CloseHelper]::SendMessage($handle, [CloseHelper]::WM_CLOSE, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
@{ success = $true } | ConvertTo-Json
`;

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Execute a PowerShell script and parse JSON output
 * Uses file-based execution to handle complex scripts with here-strings
 */
async function runPowerShell<T>(script: string): Promise<T> {
  const tempFile = path.join(
    os.tmpdir(),
    `atlas-ps-${Date.now()}-${Math.random().toString(36).slice(2)}.ps1`
  );

  try {
    // Write script to temp file
    await fs.writeFile(tempFile, script, 'utf8');

    // Execute the script file
    const { stdout } = await execAsync(
      `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${tempFile}"`,
      { maxBuffer: 10 * 1024 * 1024 }
    );

    const trimmed = stdout.trim();
    if (!trimmed) {
      return [] as unknown as T;
    }

    return JSON.parse(trimmed);
  } catch (error) {
    const err = error as Error & { stdout?: string; stderr?: string };
    logger.error('PowerShell execution failed', {
      error: err.message,
      stderr: err.stderr,
    });
    throw error;
  } finally {
    // Clean up temp file
    await fs.unlink(tempFile).catch(() => {});
  }
}

/**
 * Find a window by title (partial match)
 */
async function findWindowByTitle(title: string): Promise<WindowInfo | undefined> {
  const windows = await runPowerShell<WindowInfo[]>(LIST_WINDOWS_SCRIPT);
  const lowerTitle = title.toLowerCase();
  return windows.find((w) => w.title.toLowerCase().includes(lowerTitle));
}

// =============================================================================
// Agent Tools
// =============================================================================

/**
 * List all open windows
 */
export const listWindowsTool: AgentTool = {
  name: 'window_list',
  description:
    'List all open windows with their titles, process names, and states. Useful for finding windows to interact with.',
  parameters: {
    type: 'object',
    properties: {
      filter: {
        type: 'string',
        description: 'Optional filter to match window titles (case-insensitive)',
      },
      visibleOnly: {
        type: 'boolean',
        description: 'Only list visible windows (default: true)',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const filter = params.filter as string | undefined;
      const visibleOnly = (params.visibleOnly as boolean) ?? true;

      let windows = await runPowerShell<WindowInfo[]>(LIST_WINDOWS_SCRIPT);

      // Apply filters
      if (visibleOnly) {
        windows = windows.filter((w) => w.isVisible);
      }
      if (filter) {
        const lowerFilter = filter.toLowerCase();
        windows = windows.filter(
          (w) =>
            w.title.toLowerCase().includes(lowerFilter) ||
            w.processName.toLowerCase().includes(lowerFilter)
        );
      }

      logger.info('Windows listed', { count: windows.length, filter });

      return {
        success: true,
        data: {
          windows,
          count: windows.length,
        },
      };
    } catch (error) {
      const err = error as Error;
      logger.error('List windows failed', { error: err.message });
      return { success: false, error: err.message };
    }
  },
};

/**
 * Focus/activate a window
 */
export const focusWindowTool: AgentTool = {
  name: 'window_focus',
  description: 'Bring a window to the foreground and give it focus. Use window title or handle.',
  parameters: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Window title to search for (partial match)',
      },
      handle: {
        type: 'string',
        description: 'Window handle (if known from window_list)',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const title = params.title as string | undefined;
      const handle = params.handle as string | undefined;

      if (!title && !handle) {
        return { success: false, error: 'Either title or handle is required' };
      }

      let targetHandle = handle;
      if (!targetHandle && title) {
        const window = await findWindowByTitle(title);
        if (!window) {
          return { success: false, error: `Window with title "${title}" not found` };
        }
        targetHandle = window.handle;
      }

      const result = await runPowerShell<{ success: boolean }>(FOCUS_WINDOW_SCRIPT(targetHandle!));

      logger.info('Window focused', { handle: targetHandle, title });

      return {
        success: result.success,
        data: { handle: targetHandle },
      };
    } catch (error) {
      const err = error as Error;
      logger.error('Focus window failed', { error: err.message });
      return { success: false, error: err.message };
    }
  },
};

/**
 * Minimize a window
 */
export const minimizeWindowTool: AgentTool = {
  name: 'window_minimize',
  description: 'Minimize a window to the taskbar.',
  parameters: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Window title to search for (partial match)',
      },
      handle: {
        type: 'string',
        description: 'Window handle (if known)',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const title = params.title as string | undefined;
      const handle = params.handle as string | undefined;

      if (!title && !handle) {
        return { success: false, error: 'Either title or handle is required' };
      }

      let targetHandle = handle;
      if (!targetHandle && title) {
        const window = await findWindowByTitle(title);
        if (!window) {
          return { success: false, error: `Window with title "${title}" not found` };
        }
        targetHandle = window.handle;
      }

      const result = await runPowerShell<{ success: boolean }>(
        SET_WINDOW_STATE_SCRIPT(targetHandle!, 'minimize')
      );

      logger.info('Window minimized', { handle: targetHandle });

      return { success: result.success, data: { handle: targetHandle } };
    } catch (error) {
      const err = error as Error;
      logger.error('Minimize window failed', { error: err.message });
      return { success: false, error: err.message };
    }
  },
};

/**
 * Maximize a window
 */
export const maximizeWindowTool: AgentTool = {
  name: 'window_maximize',
  description: 'Maximize a window to fill the screen.',
  parameters: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Window title to search for (partial match)',
      },
      handle: {
        type: 'string',
        description: 'Window handle (if known)',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const title = params.title as string | undefined;
      const handle = params.handle as string | undefined;

      if (!title && !handle) {
        return { success: false, error: 'Either title or handle is required' };
      }

      let targetHandle = handle;
      if (!targetHandle && title) {
        const window = await findWindowByTitle(title);
        if (!window) {
          return { success: false, error: `Window with title "${title}" not found` };
        }
        targetHandle = window.handle;
      }

      const result = await runPowerShell<{ success: boolean }>(
        SET_WINDOW_STATE_SCRIPT(targetHandle!, 'maximize')
      );

      logger.info('Window maximized', { handle: targetHandle });

      return { success: result.success, data: { handle: targetHandle } };
    } catch (error) {
      const err = error as Error;
      logger.error('Maximize window failed', { error: err.message });
      return { success: false, error: err.message };
    }
  },
};

/**
 * Restore a window
 */
export const restoreWindowTool: AgentTool = {
  name: 'window_restore',
  description: 'Restore a minimized or maximized window to its normal state.',
  parameters: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Window title to search for (partial match)',
      },
      handle: {
        type: 'string',
        description: 'Window handle (if known)',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const title = params.title as string | undefined;
      const handle = params.handle as string | undefined;

      if (!title && !handle) {
        return { success: false, error: 'Either title or handle is required' };
      }

      let targetHandle = handle;
      if (!targetHandle && title) {
        const window = await findWindowByTitle(title);
        if (!window) {
          return { success: false, error: `Window with title "${title}" not found` };
        }
        targetHandle = window.handle;
      }

      const result = await runPowerShell<{ success: boolean }>(
        SET_WINDOW_STATE_SCRIPT(targetHandle!, 'restore')
      );

      logger.info('Window restored', { handle: targetHandle });

      return { success: result.success, data: { handle: targetHandle } };
    } catch (error) {
      const err = error as Error;
      logger.error('Restore window failed', { error: err.message });
      return { success: false, error: err.message };
    }
  },
};

/**
 * Move and/or resize a window
 */
export const moveWindowTool: AgentTool = {
  name: 'window_move',
  description: 'Move and/or resize a window to specific coordinates.',
  parameters: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Window title to search for (partial match)',
      },
      handle: {
        type: 'string',
        description: 'Window handle (if known)',
      },
      x: {
        type: 'number',
        description: 'New X position (pixels from left)',
      },
      y: {
        type: 'number',
        description: 'New Y position (pixels from top)',
      },
      width: {
        type: 'number',
        description: 'New width (pixels)',
      },
      height: {
        type: 'number',
        description: 'New height (pixels)',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const title = params.title as string | undefined;
      const handle = params.handle as string | undefined;
      const x = params.x as number | undefined;
      const y = params.y as number | undefined;
      const width = params.width as number | undefined;
      const height = params.height as number | undefined;

      if (!title && !handle) {
        return { success: false, error: 'Either title or handle is required' };
      }

      // Find window
      let targetWindow: WindowInfo | undefined;
      if (handle) {
        const windows = await runPowerShell<WindowInfo[]>(LIST_WINDOWS_SCRIPT);
        targetWindow = windows.find((w) => w.handle === handle);
      } else if (title) {
        targetWindow = await findWindowByTitle(title);
      }

      if (!targetWindow) {
        return { success: false, error: 'Window not found' };
      }

      // Use current values if not specified
      const newX = x ?? targetWindow.bounds.x;
      const newY = y ?? targetWindow.bounds.y;
      const newWidth = width ?? targetWindow.bounds.width;
      const newHeight = height ?? targetWindow.bounds.height;

      const result = await runPowerShell<{ success: boolean }>(
        MOVE_WINDOW_SCRIPT(targetWindow.handle, newX, newY, newWidth, newHeight)
      );

      logger.info('Window moved', {
        handle: targetWindow.handle,
        bounds: { x: newX, y: newY, width: newWidth, height: newHeight },
      });

      return {
        success: result.success,
        data: {
          handle: targetWindow.handle,
          bounds: { x: newX, y: newY, width: newWidth, height: newHeight },
        },
      };
    } catch (error) {
      const err = error as Error;
      logger.error('Move window failed', { error: err.message });
      return { success: false, error: err.message };
    }
  },
};

/**
 * Close a window
 */
export const closeWindowTool: AgentTool = {
  name: 'window_close',
  description: 'Close a window gracefully by sending a close message.',
  parameters: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Window title to search for (partial match)',
      },
      handle: {
        type: 'string',
        description: 'Window handle (if known)',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const title = params.title as string | undefined;
      const handle = params.handle as string | undefined;

      if (!title && !handle) {
        return { success: false, error: 'Either title or handle is required' };
      }

      let targetHandle = handle;
      let targetTitle = title;
      if (!targetHandle && title) {
        const window = await findWindowByTitle(title);
        if (!window) {
          return { success: false, error: `Window with title "${title}" not found` };
        }
        targetHandle = window.handle;
        targetTitle = window.title;
      }

      await runPowerShell<{ success: boolean }>(CLOSE_WINDOW_SCRIPT(targetHandle!));

      logger.info('Window closed', { handle: targetHandle, title: targetTitle });

      return {
        success: true,
        data: { handle: targetHandle, closed: true },
      };
    } catch (error) {
      const err = error as Error;
      logger.error('Close window failed', { error: err.message });
      return { success: false, error: err.message };
    }
  },
};

/**
 * Get the currently focused window
 */
export const getForegroundWindowTool: AgentTool = {
  name: 'window_get_foreground',
  description: 'Get information about the currently focused/foreground window.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (): Promise<ActionResult> => {
    try {
      const windows = await runPowerShell<WindowInfo[]>(LIST_WINDOWS_SCRIPT);
      const foreground = windows.find((w) => w.isForeground);

      if (!foreground) {
        return { success: false, error: 'No foreground window found' };
      }

      logger.info('Foreground window retrieved', {
        title: foreground.title,
        process: foreground.processName,
      });

      return { success: true, data: foreground };
    } catch (error) {
      const err = error as Error;
      logger.error('Get foreground window failed', { error: err.message });
      return { success: false, error: err.message };
    }
  },
};

/**
 * Get all window manager tools
 */
export function getWindowManagerTools(): AgentTool[] {
  return [
    listWindowsTool,
    focusWindowTool,
    minimizeWindowTool,
    maximizeWindowTool,
    restoreWindowTool,
    moveWindowTool,
    closeWindowTool,
    getForegroundWindowTool,
  ];
}

export default {
  getWindowManagerTools,
  listWindowsTool,
  focusWindowTool,
  minimizeWindowTool,
  maximizeWindowTool,
  restoreWindowTool,
  moveWindowTool,
  closeWindowTool,
  getForegroundWindowTool,
};
