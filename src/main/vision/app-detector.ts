/**
 * Application Detector
 * 
 * Detects the active application and extracts context-specific metadata.
 * Supports IDEs, browsers, terminals, and other common applications.
 * 
 * @module vision/app-detector
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import { executeCommand } from '../utils/shell';
import {
  ApplicationContext,
  AppType,
  AppMetadata,
  WindowInfo,
} from './types';

const logger = createModuleLogger('AppDetector');

// ============================================================================
// App Detection Patterns
// ============================================================================

const APP_PATTERNS: Record<string, { type: AppType; patterns: RegExp[] }> = {
  // IDEs
  vscode: {
    type: 'ide',
    patterns: [/code\.exe/i, /code$/i, /visual studio code/i],
  },
  intellij: {
    type: 'ide',
    patterns: [/idea64\.exe/i, /intellij/i, /webstorm/i, /pycharm/i],
  },
  sublime: {
    type: 'ide',
    patterns: [/sublime_text/i, /subl$/i],
  },
  vim: {
    type: 'ide',
    patterns: [/vim/i, /nvim/i, /neovim/i],
  },
  
  // Browsers
  chrome: {
    type: 'browser',
    patterns: [/chrome\.exe/i, /google chrome/i],
  },
  firefox: {
    type: 'browser',
    patterns: [/firefox\.exe/i, /firefox$/i],
  },
  edge: {
    type: 'browser',
    patterns: [/msedge\.exe/i, /microsoft edge/i],
  },
  brave: {
    type: 'browser',
    patterns: [/brave\.exe/i, /brave$/i],
  },
  
  // Terminals
  windowsTerminal: {
    type: 'terminal',
    patterns: [/windowsterminal/i, /wt\.exe/i],
  },
  powershell: {
    type: 'terminal',
    patterns: [/powershell/i, /pwsh/i],
  },
  cmd: {
    type: 'terminal',
    patterns: [/cmd\.exe/i],
  },
  iterm: {
    type: 'terminal',
    patterns: [/iterm/i],
  },
  
  // Communication
  slack: {
    type: 'communication',
    patterns: [/slack/i],
  },
  discord: {
    type: 'communication',
    patterns: [/discord/i],
  },
  teams: {
    type: 'communication',
    patterns: [/teams/i],
  },
  
  // Design
  figma: {
    type: 'design',
    patterns: [/figma/i],
  },
  photoshop: {
    type: 'design',
    patterns: [/photoshop/i],
  },
  
  // Media
  spotify: {
    type: 'media',
    patterns: [/spotify/i],
  },
  
  // File managers
  explorer: {
    type: 'file-manager',
    patterns: [/explorer\.exe/i],
  },
  finder: {
    type: 'file-manager',
    patterns: [/finder$/i],
  },
};

// ============================================================================
// App Detector Class
// ============================================================================

export class AppDetector extends EventEmitter {
  private lastActiveApp: ApplicationContext | null = null;
  private windowCache: Map<number, WindowInfo> = new Map();
  private platform: NodeJS.Platform;

  constructor() {
    super();
    this.platform = process.platform;
  }

  /**
   * Get the currently active application
   */
  async getActiveApp(): Promise<ApplicationContext | null> {
    try {
      switch (this.platform) {
        case 'win32':
          return this.getActiveAppWindows();
        case 'darwin':
          return this.getActiveAppMac();
        case 'linux':
          return this.getActiveAppLinux();
        default:
          logger.warn(`Unsupported platform: ${this.platform}`);
          return null;
      }
    } catch (error) {
      logger.error('Failed to get active app:', error);
      return null;
    }
  }

  /**
   * Get all visible windows
   */
  async getVisibleWindows(): Promise<WindowInfo[]> {
    try {
      switch (this.platform) {
        case 'win32':
          return this.getWindowsWindows();
        case 'darwin':
          return this.getWindowsMac();
        case 'linux':
          return this.getWindowsLinux();
        default:
          return [];
      }
    } catch (error) {
      logger.error('Failed to get visible windows:', error);
      return [];
    }
  }

  /**
   * Extract app-specific metadata
   */
  async extractAppMetadata(app: ApplicationContext): Promise<AppMetadata> {
    const metadata: AppMetadata = {};

    try {
      switch (app.appType) {
        case 'ide':
          await this.extractIDEMetadata(app, metadata);
          break;
        case 'browser':
          await this.extractBrowserMetadata(app, metadata);
          break;
        case 'terminal':
          await this.extractTerminalMetadata(app, metadata);
          break;
      }
    } catch (error) {
      logger.debug('Failed to extract app metadata:', error);
    }

    return metadata;
  }

  /**
   * Detect app change and emit event
   */
  async checkForAppChange(): Promise<ApplicationContext | null> {
    const currentApp = await this.getActiveApp();
    
    if (currentApp && this.lastActiveApp) {
      const changed = currentApp.name !== this.lastActiveApp.name ||
                     currentApp.windowTitle !== this.lastActiveApp.windowTitle;
      
      if (changed) {
        this.emit('app:changed', currentApp);
      }
    }
    
    this.lastActiveApp = currentApp;
    return currentApp;
  }

  // ============================================================================
  // Windows Implementation
  // ============================================================================

  private async getActiveAppWindows(): Promise<ApplicationContext | null> {
    try {
      // Use PowerShell to get active window info
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
        $title = New-Object System.Text.StringBuilder 256
        [Win32]::GetWindowText($hwnd, $title, 256) | Out-Null
        $processId = 0
        [Win32]::GetWindowThreadProcessId($hwnd, [ref]$processId) | Out-Null
        $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
        @{
          Title = $title.ToString()
          ProcessId = $processId
          ProcessName = $process.ProcessName
          Path = $process.Path
        } | ConvertTo-Json
      `;

      const { stdout } = await executeCommand(`powershell -NoProfile -Command "${script.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, {
        timeout: 5000,
      });

      const data = JSON.parse(stdout);
      
      return {
        name: data.ProcessName || 'Unknown',
        processId: data.ProcessId,
        windowTitle: data.Title || '',
        executablePath: data.Path,
        appType: this.detectAppType(data.ProcessName, data.Path),
        metadata: {},
      };
    } catch (error) {
      logger.error('Failed to get active app on Windows:', error);
      return null;
    }
  }

  private async getWindowsWindows(): Promise<WindowInfo[]> {
    try {
      const script = `
        Add-Type @"
          using System;
          using System.Runtime.InteropServices;
          using System.Text;
          using System.Collections.Generic;
          public class Win32Enum {
            public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
            [DllImport("user32.dll")]
            public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
            [DllImport("user32.dll")]
            public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
            [DllImport("user32.dll")]
            public static extern bool IsWindowVisible(IntPtr hWnd);
            [DllImport("user32.dll")]
            public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
          }
"@
        $windows = @()
        $callback = {
          param($hwnd, $lparam)
          if ([Win32Enum]::IsWindowVisible($hwnd)) {
            $title = New-Object System.Text.StringBuilder 256
            [Win32Enum]::GetWindowText($hwnd, $title, 256) | Out-Null
            if ($title.Length -gt 0) {
              $processId = 0
              [Win32Enum]::GetWindowThreadProcessId($hwnd, [ref]$processId) | Out-Null
              $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
              $script:windows += @{
                Id = $hwnd.ToInt32()
                Title = $title.ToString()
                ProcessName = $process.ProcessName
              }
            }
          }
          return $true
        }
        [Win32Enum]::EnumWindows($callback, [IntPtr]::Zero)
        $windows | ConvertTo-Json -Compress
      `;

      const { stdout } = await executeCommand(`powershell -NoProfile -Command "${script.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, {
        timeout: 5000,
      });

      const data = JSON.parse(stdout);
      const windowsArray = Array.isArray(data) ? data : [data];

      return windowsArray.map((w: Record<string, unknown>, index: number) => ({
        id: w.Id as number || index,
        title: w.Title as string || '',
        appName: w.ProcessName as string || 'Unknown',
        bounds: { x: 0, y: 0, width: 0, height: 0 },
        isActive: index === 0,
        isMinimized: false,
        zOrder: index,
      }));
    } catch (error) {
      logger.error('Failed to get windows on Windows:', error);
      return [];
    }
  }

  // ============================================================================
  // macOS Implementation
  // ============================================================================

  private async getActiveAppMac(): Promise<ApplicationContext | null> {
    try {
      const script = `
        tell application "System Events"
          set frontApp to first application process whose frontmost is true
          set appName to name of frontApp
          set windowTitle to ""
          try
            set windowTitle to name of front window of frontApp
          end try
          return appName & "|" & windowTitle
        end tell
      `;

      const { stdout } = await executeCommand(`osascript -e '${script}'`, {
        timeout: 5000,
      });

      const [appName, windowTitle] = stdout.trim().split('|');

      return {
        name: appName || 'Unknown',
        processId: 0,
        windowTitle: windowTitle || '',
        appType: this.detectAppType(appName, ''),
        metadata: {},
      };
    } catch (error) {
      logger.error('Failed to get active app on macOS:', error);
      return null;
    }
  }

  private async getWindowsMac(): Promise<WindowInfo[]> {
    // Simplified implementation for macOS
    const activeApp = await this.getActiveAppMac();
    if (!activeApp) return [];

    return [{
      id: 1,
      title: activeApp.windowTitle,
      appName: activeApp.name,
      bounds: { x: 0, y: 0, width: 0, height: 0 },
      isActive: true,
      isMinimized: false,
      zOrder: 0,
    }];
  }

  // ============================================================================
  // Linux Implementation
  // ============================================================================

  private async getActiveAppLinux(): Promise<ApplicationContext | null> {
    try {
      // Try xdotool first
      const { stdout: windowId } = await executeCommand('xdotool getactivewindow', {
        timeout: 5000,
      });

      const { stdout: windowName } = await executeCommand(`xdotool getwindowname ${windowId.trim()}`, {
        timeout: 5000,
      });

      const { stdout: pid } = await executeCommand(`xdotool getwindowpid ${windowId.trim()}`, {
        timeout: 5000,
      });

      const { stdout: processName } = await executeCommand(`ps -p ${pid.trim()} -o comm=`, {
        timeout: 5000,
      });

      return {
        name: processName.trim() || 'Unknown',
        processId: parseInt(pid.trim(), 10) || 0,
        windowTitle: windowName.trim() || '',
        appType: this.detectAppType(processName.trim(), ''),
        metadata: {},
      };
    } catch (error) {
      logger.error('Failed to get active app on Linux:', error);
      return null;
    }
  }

  private async getWindowsLinux(): Promise<WindowInfo[]> {
    try {
      const { stdout } = await executeCommand('wmctrl -l', {
        timeout: 5000,
      });

      const lines = stdout.trim().split('\n');
      return lines.map((line, index) => {
        const parts = line.split(/\s+/);
        return {
          id: parseInt(parts[0], 16) || index,
          title: parts.slice(3).join(' ') || '',
          appName: 'Unknown',
          bounds: { x: 0, y: 0, width: 0, height: 0 },
          isActive: index === 0,
          isMinimized: false,
          zOrder: index,
        };
      });
    } catch (error) {
      logger.error('Failed to get windows on Linux:', error);
      return [];
    }
  }

  // ============================================================================
  // Metadata Extraction
  // ============================================================================

  private async extractIDEMetadata(app: ApplicationContext, metadata: AppMetadata): Promise<void> {
    // Extract file info from window title
    const titlePatterns = [
      // VS Code: "file.ts - ProjectName - Visual Studio Code"
      /^(.+?)\s+-\s+(.+?)\s+-\s+Visual Studio Code/i,
      // IntelliJ: "ProjectName - file.ts"
      /^(.+?)\s+-\s+(.+?)$/,
    ];

    for (const pattern of titlePatterns) {
      const match = app.windowTitle.match(pattern);
      if (match) {
        metadata.currentFile = match[1];
        metadata.projectName = match[2];
        
        // Detect language from extension
        const ext = metadata.currentFile?.split('.').pop()?.toLowerCase();
        metadata.language = this.detectLanguageFromExtension(ext);
        break;
      }
    }
  }

  private async extractBrowserMetadata(app: ApplicationContext, metadata: AppMetadata): Promise<void> {
    // Extract URL/title from window title
    // Chrome: "Page Title - Google Chrome"
    const match = app.windowTitle.match(/^(.+?)\s+-\s+(?:Google Chrome|Firefox|Microsoft Edge|Brave)/i);
    if (match) {
      metadata.pageTitle = match[1];
    }
  }

  private async extractTerminalMetadata(app: ApplicationContext, metadata: AppMetadata): Promise<void> {
    // Extract current directory from title if available
    // PowerShell: "Administrator: Windows PowerShell" or "PS C:\path>"
    const pathMatch = app.windowTitle.match(/([A-Z]:\\[^>]*)/i);
    if (pathMatch) {
      metadata.currentDirectory = pathMatch[1];
    }
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private detectAppType(processName: string, executablePath: string): AppType {
    const searchString = `${processName} ${executablePath}`.toLowerCase();

    for (const [, config] of Object.entries(APP_PATTERNS)) {
      for (const pattern of config.patterns) {
        if (pattern.test(searchString)) {
          return config.type;
        }
      }
    }

    return 'other';
  }

  private detectLanguageFromExtension(ext?: string): string | undefined {
    if (!ext) return undefined;

    const languageMap: Record<string, string> = {
      ts: 'TypeScript',
      tsx: 'TypeScript React',
      js: 'JavaScript',
      jsx: 'JavaScript React',
      py: 'Python',
      rb: 'Ruby',
      go: 'Go',
      rs: 'Rust',
      java: 'Java',
      kt: 'Kotlin',
      swift: 'Swift',
      c: 'C',
      cpp: 'C++',
      cs: 'C#',
      php: 'PHP',
      html: 'HTML',
      css: 'CSS',
      scss: 'SCSS',
      json: 'JSON',
      yaml: 'YAML',
      yml: 'YAML',
      md: 'Markdown',
      sql: 'SQL',
      sh: 'Shell',
      ps1: 'PowerShell',
    };

    return languageMap[ext];
  }
}

// ============================================================================
// Singleton
// ============================================================================

let detectorInstance: AppDetector | null = null;

export function getAppDetector(): AppDetector {
  if (!detectorInstance) {
    detectorInstance = new AppDetector();
  }
  return detectorInstance;
}

export function resetAppDetector(): void {
  detectorInstance = null;
}
