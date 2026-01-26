/**
 * Atlas Desktop - File Explorer Integration Tool
 *
 * Provides Windows File Explorer automation for opening folders,
 * revealing files, and accessing quick access/recent items.
 *
 * @module agent/tools/explorer
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import { shell } from 'electron';
import { AgentTool, ActionResult } from '../../../shared/types/agent';
import { createModuleLogger } from '../../utils/logger';
import { getErrorMessage } from '../../../shared/utils';

const execAsync = promisify(exec);
const logger = createModuleLogger('Explorer');

// ============================================================================
// Types
// ============================================================================

interface RecentItem {
  path: string;
  name: string;
  type: 'file' | 'folder';
  accessedAt?: string;
}

interface QuickAccessItem {
  path: string;
  name: string;
  isPinned: boolean;
}

// ============================================================================
// File Explorer Manager
// ============================================================================

class ExplorerManager {
  /**
   * Open a folder in File Explorer
   */
  async openFolder(folderPath: string): Promise<void> {
    const resolvedPath = path.resolve(folderPath);

    // Verify path exists
    if (!(await fs.pathExists(resolvedPath))) {
      throw new Error(`Path does not exist: ${resolvedPath}`);
    }

    const stats = await fs.stat(resolvedPath);
    if (!stats.isDirectory()) {
      throw new Error(`Path is not a directory: ${resolvedPath}`);
    }

    if (process.platform === 'win32') {
      await execAsync(`explorer.exe "${resolvedPath}"`, { windowsHide: true });
    } else if (process.platform === 'darwin') {
      await execAsync(`open "${resolvedPath}"`);
    } else {
      await execAsync(`xdg-open "${resolvedPath}"`);
    }

    logger.info(`Opened folder: ${resolvedPath}`);
  }

  /**
   * Reveal a file in File Explorer (highlight it)
   */
  async revealFile(filePath: string): Promise<void> {
    const resolvedPath = path.resolve(filePath);

    // Verify path exists
    if (!(await fs.pathExists(resolvedPath))) {
      throw new Error(`Path does not exist: ${resolvedPath}`);
    }

    if (process.platform === 'win32') {
      // Use /select to highlight the file
      await execAsync(`explorer.exe /select,"${resolvedPath}"`, { windowsHide: true });
    } else if (process.platform === 'darwin') {
      await execAsync(`open -R "${resolvedPath}"`);
    } else {
      // On Linux, open the containing folder
      const dir = path.dirname(resolvedPath);
      await execAsync(`xdg-open "${dir}"`);
    }

    logger.info(`Revealed file: ${resolvedPath}`);
  }

  /**
   * Open file with default application
   */
  async openFile(filePath: string): Promise<void> {
    const resolvedPath = path.resolve(filePath);

    // Verify path exists
    if (!(await fs.pathExists(resolvedPath))) {
      throw new Error(`Path does not exist: ${resolvedPath}`);
    }

    // Use Electron's shell.openPath for cross-platform support
    const error = await shell.openPath(resolvedPath);
    if (error) {
      throw new Error(`Failed to open file: ${error}`);
    }

    logger.info(`Opened file: ${resolvedPath}`);
  }

  /**
   * Open file with specific application
   */
  async openWith(filePath: string, appPath: string): Promise<void> {
    const resolvedFilePath = path.resolve(filePath);
    const resolvedAppPath = path.resolve(appPath);

    if (!(await fs.pathExists(resolvedFilePath))) {
      throw new Error(`File does not exist: ${resolvedFilePath}`);
    }

    if (process.platform === 'win32') {
      await execAsync(`"${resolvedAppPath}" "${resolvedFilePath}"`, { windowsHide: true });
    } else if (process.platform === 'darwin') {
      await execAsync(`open -a "${resolvedAppPath}" "${resolvedFilePath}"`);
    } else {
      await execAsync(`"${resolvedAppPath}" "${resolvedFilePath}"`);
    }

    logger.info(`Opened ${resolvedFilePath} with ${resolvedAppPath}`);
  }

  /**
   * Get recent files from Windows Recent Items
   */
  async getRecentFiles(limit: number = 20): Promise<RecentItem[]> {
    const recentItems: RecentItem[] = [];

    if (process.platform === 'win32') {
      // Windows Recent folder
      const recentPath = path.join(
        os.homedir(),
        'AppData',
        'Roaming',
        'Microsoft',
        'Windows',
        'Recent'
      );

      try {
        if (await fs.pathExists(recentPath)) {
          const files = await fs.readdir(recentPath);

          for (const file of files.slice(0, limit * 2)) {
            // Skip if not a shortcut
            if (!file.endsWith('.lnk')) continue;

            try {
              const lnkPath = path.join(recentPath, file);
              const stats = await fs.stat(lnkPath);

              // Get the target of the shortcut using PowerShell
              const { stdout } = await execAsync(
                `powershell -Command "(New-Object -ComObject WScript.Shell).CreateShortcut('${lnkPath.replace(/'/g, "''")}').TargetPath"`,
                { windowsHide: true }
              );

              const targetPath = stdout.trim();
              if (targetPath && (await fs.pathExists(targetPath))) {
                const targetStats = await fs.stat(targetPath);
                recentItems.push({
                  path: targetPath,
                  name: path.basename(targetPath),
                  type: targetStats.isDirectory() ? 'folder' : 'file',
                  accessedAt: stats.atime.toISOString(),
                });
              }
            } catch {
              // Skip items we can't resolve
            }

            if (recentItems.length >= limit) break;
          }
        }
      } catch (error) {
        logger.warn('Failed to read recent files:', error);
      }
    } else if (process.platform === 'darwin') {
      // macOS recent files via mdfind
      try {
        const { stdout } = await execAsync(
          `mdfind -onlyin ~ "kMDItemLastUsedDate > $time.today(-7)" | head -${limit}`
        );

        for (const line of stdout.split('\n').filter(Boolean)) {
          try {
            const stats = await fs.stat(line);
            recentItems.push({
              path: line,
              name: path.basename(line),
              type: stats.isDirectory() ? 'folder' : 'file',
              accessedAt: stats.atime.toISOString(),
            });
          } catch {
            // Skip inaccessible items
          }
        }
      } catch (error) {
        logger.warn('Failed to get recent files on macOS:', error);
      }
    }

    return recentItems.slice(0, limit);
  }

  /**
   * Get Quick Access / Pinned items (Windows)
   */
  async getQuickAccess(): Promise<QuickAccessItem[]> {
    const items: QuickAccessItem[] = [];

    if (process.platform === 'win32') {
      try {
        // Use PowerShell to get Quick Access items
        const { stdout } = await execAsync(
          `powershell -Command "$shell = New-Object -ComObject Shell.Application; $shell.Namespace('shell:::{679f85cb-0220-4080-b29b-5540cc05aab6}').Items() | ForEach-Object { $_.Path }"`,
          { windowsHide: true, timeout: 10000 }
        );

        for (const line of stdout.split('\n').filter(Boolean)) {
          const itemPath = line.trim();
          if (itemPath && (await fs.pathExists(itemPath))) {
            items.push({
              path: itemPath,
              name: path.basename(itemPath),
              isPinned: true,
            });
          }
        }
      } catch (error) {
        logger.warn('Failed to get Quick Access items:', error);
      }
    }

    return items;
  }

  /**
   * Get downloads folder path
   */
  getDownloadsPath(): string {
    if (process.platform === 'win32') {
      return path.join(os.homedir(), 'Downloads');
    } else if (process.platform === 'darwin') {
      return path.join(os.homedir(), 'Downloads');
    } else {
      // Try XDG user dir
      const xdgDownloads = process.env.XDG_DOWNLOAD_DIR;
      return xdgDownloads || path.join(os.homedir(), 'Downloads');
    }
  }

  /**
   * Get documents folder path
   */
  getDocumentsPath(): string {
    if (process.platform === 'win32') {
      return path.join(os.homedir(), 'Documents');
    } else if (process.platform === 'darwin') {
      return path.join(os.homedir(), 'Documents');
    } else {
      const xdgDocuments = process.env.XDG_DOCUMENTS_DIR;
      return xdgDocuments || path.join(os.homedir(), 'Documents');
    }
  }

  /**
   * Get desktop folder path
   */
  getDesktopPath(): string {
    if (process.platform === 'win32') {
      return path.join(os.homedir(), 'Desktop');
    } else if (process.platform === 'darwin') {
      return path.join(os.homedir(), 'Desktop');
    } else {
      const xdgDesktop = process.env.XDG_DESKTOP_DIR;
      return xdgDesktop || path.join(os.homedir(), 'Desktop');
    }
  }

  /**
   * Show file properties dialog (Windows)
   */
  async showProperties(filePath: string): Promise<void> {
    const resolvedPath = path.resolve(filePath);

    if (!(await fs.pathExists(resolvedPath))) {
      throw new Error(`Path does not exist: ${resolvedPath}`);
    }

    if (process.platform === 'win32') {
      // Use PowerShell to show properties dialog
      await execAsync(
        `powershell -Command "$shell = New-Object -ComObject Shell.Application; $shell.Namespace((Split-Path '${resolvedPath.replace(/'/g, "''")}' -Parent)).ParseName((Split-Path '${resolvedPath.replace(/'/g, "''")}' -Leaf)).InvokeVerb('properties')"`,
        { windowsHide: true }
      );
    } else {
      throw new Error('Properties dialog is only supported on Windows');
    }
  }

  /**
   * Get special folder paths
   */
  getSpecialFolders(): Record<string, string> {
    return {
      home: os.homedir(),
      downloads: this.getDownloadsPath(),
      documents: this.getDocumentsPath(),
      desktop: this.getDesktopPath(),
      pictures: path.join(os.homedir(), 'Pictures'),
      music: path.join(os.homedir(), 'Music'),
      videos: path.join(os.homedir(), 'Videos'),
      temp: os.tmpdir(),
    };
  }
}

// Singleton instance
const explorerManager = new ExplorerManager();

// ============================================================================
// Agent Tools
// ============================================================================

/**
 * Open folder in File Explorer
 */
export const explorerOpenFolderTool: AgentTool = {
  name: 'explorer_open',
  description: 'Open a folder in the system file explorer',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to the folder to open',
      },
    },
    required: ['path'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const folderPath = params.path as string;
      await explorerManager.openFolder(folderPath);

      return {
        success: true,
        data: { message: `Opened folder: ${folderPath}` },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to open folder: ${getErrorMessage(error)}`,
      };
    }
  },
};

/**
 * Reveal file in File Explorer
 */
export const explorerRevealFileTool: AgentTool = {
  name: 'explorer_reveal',
  description: 'Reveal and highlight a file in the system file explorer',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to the file to reveal',
      },
    },
    required: ['path'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const filePath = params.path as string;
      await explorerManager.revealFile(filePath);

      return {
        success: true,
        data: { message: `Revealed file: ${filePath}` },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to reveal file: ${getErrorMessage(error)}`,
      };
    }
  },
};

/**
 * Open file with default application
 */
export const explorerOpenFileTool: AgentTool = {
  name: 'explorer_open_file',
  description: 'Open a file with its default application',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to the file to open',
      },
    },
    required: ['path'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const filePath = params.path as string;
      await explorerManager.openFile(filePath);

      return {
        success: true,
        data: { message: `Opened file: ${filePath}` },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to open file: ${getErrorMessage(error)}`,
      };
    }
  },
};

/**
 * Get recent files
 */
export const explorerGetRecentTool: AgentTool = {
  name: 'explorer_recent',
  description: 'Get a list of recently accessed files and folders',
  parameters: {
    type: 'object',
    properties: {
      limit: {
        type: 'number',
        description: 'Maximum number of items to return (default: 20)',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const limit = (params.limit as number) || 20;
      const recent = await explorerManager.getRecentFiles(limit);

      return {
        success: true,
        data: { recent, count: recent.length },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to get recent files: ${getErrorMessage(error)}`,
      };
    }
  },
};

/**
 * Get Quick Access items
 */
export const explorerGetQuickAccessTool: AgentTool = {
  name: 'explorer_quick_access',
  description: 'Get pinned/Quick Access items from File Explorer (Windows)',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (): Promise<ActionResult> => {
    try {
      const items = await explorerManager.getQuickAccess();

      return {
        success: true,
        data: { items, count: items.length },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to get Quick Access: ${getErrorMessage(error)}`,
      };
    }
  },
};

/**
 * Get special folder paths
 */
export const explorerGetSpecialFoldersTool: AgentTool = {
  name: 'explorer_special_folders',
  description: 'Get paths to special system folders (Downloads, Documents, Desktop, etc.)',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (): Promise<ActionResult> => {
    try {
      const folders = explorerManager.getSpecialFolders();

      return {
        success: true,
        data: { folders },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to get special folders: ${getErrorMessage(error)}`,
      };
    }
  },
};

/**
 * Open with specific application
 */
export const explorerOpenWithTool: AgentTool = {
  name: 'explorer_open_with',
  description: 'Open a file with a specific application',
  parameters: {
    type: 'object',
    properties: {
      filePath: {
        type: 'string',
        description: 'Path to the file to open',
      },
      appPath: {
        type: 'string',
        description: 'Path to the application to use',
      },
    },
    required: ['filePath', 'appPath'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      await explorerManager.openWith(params.filePath as string, params.appPath as string);

      return {
        success: true,
        data: { message: 'File opened with specified application' },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to open file: ${getErrorMessage(error)}`,
      };
    }
  },
};

/**
 * Show file properties
 */
export const explorerShowPropertiesTool: AgentTool = {
  name: 'explorer_properties',
  description: 'Show the properties dialog for a file or folder (Windows only)',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to the file or folder',
      },
    },
    required: ['path'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      await explorerManager.showProperties(params.path as string);

      return {
        success: true,
        data: { message: 'Properties dialog opened' },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to show properties: ${getErrorMessage(error)}`,
      };
    }
  },
};

/**
 * Get all File Explorer tools
 */
export function getExplorerTools(): AgentTool[] {
  return [
    explorerOpenFolderTool,
    explorerRevealFileTool,
    explorerOpenFileTool,
    explorerGetRecentTool,
    explorerGetQuickAccessTool,
    explorerGetSpecialFoldersTool,
    explorerOpenWithTool,
    explorerShowPropertiesTool,
  ];
}

// Export manager for direct access if needed
export { explorerManager, ExplorerManager };
