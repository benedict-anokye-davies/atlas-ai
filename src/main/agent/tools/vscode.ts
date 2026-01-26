/**
 * Atlas Desktop - VS Code Integration Tool
 *
 * Provides VS Code automation via the `code` CLI.
 * Supports opening files, running commands, terminal operations, and extension management.
 *
 * @module agent/tools/vscode
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import { glob } from 'glob';
import { AgentTool, ActionResult } from '../../../shared/types/agent';
import { createModuleLogger } from '../../utils/logger';
import { getErrorMessage } from '../../../shared/utils';

const execAsync = promisify(exec);
const logger = createModuleLogger('VSCode');

// ============================================================================
// Types
// ============================================================================

interface VSCodeOpenResult {
  path: string;
  line?: number;
  column?: number;
  reused?: boolean;
}

interface VSCodeExtension {
  id: string;
  name?: string;
  version?: string;
  publisher?: string;
  enabled?: boolean;
}

// Reserved for future workspace management features
// interface VSCodeWorkspace {
//   folders: string[];
//   settings?: Record<string, unknown>;
// }

// ============================================================================
// VS Code Manager
// ============================================================================

class VSCodeManager {
  private codePath: string | null = null;

  /**
   * Find the VS Code CLI path
   */
  async findCodePath(): Promise<string> {
    if (this.codePath) {
      return this.codePath;
    }

    // Common VS Code CLI paths
    const possiblePaths: string[] = [];

    if (process.platform === 'win32') {
      // Windows paths
      const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
      const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
      const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

      possiblePaths.push(
        // User installation
        path.join(localAppData, 'Programs', 'Microsoft VS Code', 'bin', 'code.cmd'),
        path.join(localAppData, 'Programs', 'Microsoft VS Code', 'Code.exe'),
        // System installation
        path.join(programFiles, 'Microsoft VS Code', 'bin', 'code.cmd'),
        path.join(programFiles, 'Microsoft VS Code', 'Code.exe'),
        path.join(programFilesX86, 'Microsoft VS Code', 'bin', 'code.cmd'),
        // VS Code Insiders
        path.join(
          localAppData,
          'Programs',
          'Microsoft VS Code Insiders',
          'bin',
          'code-insiders.cmd'
        ),
        path.join(programFiles, 'Microsoft VS Code Insiders', 'bin', 'code-insiders.cmd')
      );

      // Try PATH
      try {
        const { stdout } = await execAsync('where code', { windowsHide: true });
        const codePath = stdout.trim().split('\n')[0];
        if (codePath && (await fs.pathExists(codePath))) {
          this.codePath = codePath;
          return this.codePath;
        }
      } catch {
        // Not in PATH
      }
    } else {
      // macOS/Linux paths
      possiblePaths.push(
        '/usr/local/bin/code',
        '/usr/bin/code',
        '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',
        path.join(os.homedir(), '.local/bin/code')
      );
    }

    // Check each path
    for (const codePath of possiblePaths) {
      if (await fs.pathExists(codePath)) {
        this.codePath = codePath;
        return this.codePath;
      }
    }

    // Default to 'code' and hope it's in PATH
    this.codePath = 'code';
    return this.codePath;
  }

  /**
   * Execute a VS Code CLI command
   */
  private async execCode(args: string[], options?: { cwd?: string }): Promise<string> {
    const codePath = await this.findCodePath();
    const cmd = `"${codePath}" ${args.map((a) => `"${a}"`).join(' ')}`;

    try {
      const { stdout, stderr } = await execAsync(cmd, {
        cwd: options?.cwd,
        windowsHide: true,
        timeout: 30000,
      });

      if (stderr && !stdout) {
        logger.warn('VS Code stderr:', { stderr });
      }

      return stdout.trim();
    } catch (error) {
      logger.error('VS Code command failed:', { cmd, error });
      throw error;
    }
  }

  /**
   * Open a file in VS Code
   */
  async openFile(
    filePath: string,
    options?: { line?: number; column?: number; reuse?: boolean }
  ): Promise<VSCodeOpenResult> {
    const args: string[] = [];

    // Reuse existing window or open new
    if (options?.reuse === false) {
      args.push('--new-window');
    } else {
      args.push('--reuse-window');
    }

    // Build file path with line/column
    let targetPath = path.resolve(filePath);
    if (options?.line) {
      targetPath += `:${options.line}`;
      if (options?.column) {
        targetPath += `:${options.column}`;
      }
    }

    args.push('--goto', targetPath);

    await this.execCode(args);

    return {
      path: filePath,
      line: options?.line,
      column: options?.column,
      reused: options?.reuse !== false,
    };
  }

  /**
   * Open a folder/workspace in VS Code
   */
  async openFolder(folderPath: string, options?: { newWindow?: boolean }): Promise<string> {
    const args: string[] = [];

    if (options?.newWindow) {
      args.push('--new-window');
    }

    const resolvedPath = path.resolve(folderPath);
    args.push(resolvedPath);

    await this.execCode(args);

    return resolvedPath;
  }

  /**
   * Open a diff view
   */
  async openDiff(file1: string, file2: string): Promise<void> {
    const args = ['--diff', path.resolve(file1), path.resolve(file2)];
    await this.execCode(args);
  }

  /**
   * Get list of installed extensions
   */
  async getExtensions(): Promise<VSCodeExtension[]> {
    const output = await this.execCode(['--list-extensions', '--show-versions']);

    return output
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        // Format: publisher.name@version
        const [fullId, version] = line.split('@');
        const [publisher, ...nameParts] = fullId.split('.');
        const name = nameParts.join('.');

        return {
          id: fullId,
          name,
          version,
          publisher,
          enabled: true,
        };
      });
  }

  /**
   * Install an extension
   */
  async installExtension(extensionId: string): Promise<void> {
    await this.execCode(['--install-extension', extensionId]);
    logger.info(`Installed VS Code extension: ${extensionId}`);
  }

  /**
   * Uninstall an extension
   */
  async uninstallExtension(extensionId: string): Promise<void> {
    await this.execCode(['--uninstall-extension', extensionId]);
    logger.info(`Uninstalled VS Code extension: ${extensionId}`);
  }

  /**
   * Get VS Code version
   */
  async getVersion(): Promise<string> {
    return await this.execCode(['--version']);
  }

  /**
   * Check if VS Code is installed and accessible
   */
  async isAvailable(): Promise<boolean> {
    try {
      await this.getVersion();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Open VS Code settings
   */
  async openSettings(type: 'user' | 'workspace' = 'user'): Promise<void> {
    // Settings are opened via a file path
    if (type === 'user') {
      const settingsPath =
        process.platform === 'win32'
          ? path.join(os.homedir(), 'AppData', 'Roaming', 'Code', 'User', 'settings.json')
          : path.join(os.homedir(), '.config', 'Code', 'User', 'settings.json');

      if (await fs.pathExists(settingsPath)) {
        await this.openFile(settingsPath);
      } else {
        throw new Error('User settings file not found');
      }
    } else {
      // Workspace settings would be in .vscode/settings.json
      throw new Error('Workspace settings require a specific workspace path');
    }
  }

  /**
   * Open keyboard shortcuts
   */
  async openKeybindings(): Promise<void> {
    const keybindingsPath =
      process.platform === 'win32'
        ? path.join(os.homedir(), 'AppData', 'Roaming', 'Code', 'User', 'keybindings.json')
        : path.join(os.homedir(), '.config', 'Code', 'User', 'keybindings.json');

    if (await fs.pathExists(keybindingsPath)) {
      await this.openFile(keybindingsPath);
    } else {
      throw new Error('Keybindings file not found');
    }
  }

  /**
   * Search for files in workspace (requires open workspace)
   */
  async searchFiles(pattern: string, workspacePath: string): Promise<string[]> {
    // Use glob to search files - VS Code CLI doesn't have direct search
    const files = await glob(pattern, { cwd: workspacePath, nodir: true });
    return files.map((f) => path.join(workspacePath, f));
  }

  /**
   * Run a task in VS Code terminal (opens integrated terminal)
   */
  async runInTerminal(command: string, cwd?: string): Promise<void> {
    // VS Code doesn't have direct CLI for running commands in terminal
    // We can open a folder and then the user can run commands
    // For now, open the folder which is the best we can do via CLI
    if (cwd) {
      await this.openFolder(cwd);
    }
    logger.info(`Opened VS Code. Run command manually: ${command}`);
  }

  /**
   * Get recently opened files/folders
   */
  async getRecentlyOpened(): Promise<string[]> {
    // Recent items are stored in storage.json
    const storagePath =
      process.platform === 'win32'
        ? path.join(
            os.homedir(),
            'AppData',
            'Roaming',
            'Code',
            'User',
            'globalStorage',
            'storage.json'
          )
        : path.join(os.homedir(), '.config', 'Code', 'User', 'globalStorage', 'storage.json');

    try {
      if (await fs.pathExists(storagePath)) {
        const storage = await fs.readJson(storagePath);
        const recent: string[] = [];

        // Extract recent folders and files
        if (storage.openedPathsList?.entries) {
          for (const entry of storage.openedPathsList.entries) {
            if (entry.folderUri) {
              recent.push(entry.folderUri.replace('file:///', ''));
            }
            if (entry.fileUri) {
              recent.push(entry.fileUri.replace('file:///', ''));
            }
          }
        }

        return recent.slice(0, 20);
      }
    } catch (error) {
      logger.warn('Failed to read VS Code storage:', error);
    }

    return [];
  }
}

// Singleton instance
const vscodeManager = new VSCodeManager();

// ============================================================================
// Agent Tools
// ============================================================================

/**
 * Open a file in VS Code
 */
export const vscodeOpenFileTool: AgentTool = {
  name: 'vscode_open_file',
  description: 'Open a file in VS Code, optionally at a specific line and column',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to the file to open',
      },
      line: {
        type: 'number',
        description: 'Line number to go to (optional)',
      },
      column: {
        type: 'number',
        description: 'Column number to go to (optional)',
      },
      newWindow: {
        type: 'boolean',
        description: 'Open in a new window instead of reusing existing',
      },
    },
    required: ['path'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const filePath = params.path as string;
      const result = await vscodeManager.openFile(filePath, {
        line: params.line as number | undefined,
        column: params.column as number | undefined,
        reuse: !(params.newWindow as boolean | undefined),
      });

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to open file in VS Code: ${getErrorMessage(error)}`,
      };
    }
  },
};

/**
 * Open a folder in VS Code
 */
export const vscodeOpenFolderTool: AgentTool = {
  name: 'vscode_open_folder',
  description: 'Open a folder or workspace in VS Code',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to the folder to open',
      },
      newWindow: {
        type: 'boolean',
        description: 'Open in a new window',
      },
    },
    required: ['path'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const folderPath = params.path as string;
      const result = await vscodeManager.openFolder(folderPath, {
        newWindow: params.newWindow as boolean | undefined,
      });

      return {
        success: true,
        data: { path: result },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to open folder in VS Code: ${getErrorMessage(error)}`,
      };
    }
  },
};

/**
 * Open diff view in VS Code
 */
export const vscodeOpenDiffTool: AgentTool = {
  name: 'vscode_diff',
  description: 'Open a diff view comparing two files in VS Code',
  parameters: {
    type: 'object',
    properties: {
      file1: {
        type: 'string',
        description: 'Path to the first file',
      },
      file2: {
        type: 'string',
        description: 'Path to the second file',
      },
    },
    required: ['file1', 'file2'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      await vscodeManager.openDiff(params.file1 as string, params.file2 as string);

      return {
        success: true,
        data: { message: 'Diff view opened' },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to open diff in VS Code: ${getErrorMessage(error)}`,
      };
    }
  },
};

/**
 * Get installed extensions
 */
export const vscodeGetExtensionsTool: AgentTool = {
  name: 'vscode_get_extensions',
  description: 'List all installed VS Code extensions',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (): Promise<ActionResult> => {
    try {
      const extensions = await vscodeManager.getExtensions();

      return {
        success: true,
        data: { extensions, count: extensions.length },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to get extensions: ${getErrorMessage(error)}`,
      };
    }
  },
};

/**
 * Install an extension
 */
export const vscodeInstallExtensionTool: AgentTool = {
  name: 'vscode_install_extension',
  description: 'Install a VS Code extension by ID (e.g., "ms-python.python")',
  parameters: {
    type: 'object',
    properties: {
      extensionId: {
        type: 'string',
        description: 'Extension ID (publisher.name format)',
      },
    },
    required: ['extensionId'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const extensionId = params.extensionId as string;
      await vscodeManager.installExtension(extensionId);

      return {
        success: true,
        data: { message: `Extension ${extensionId} installed successfully` },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to install extension: ${getErrorMessage(error)}`,
      };
    }
  },
};

/**
 * Uninstall an extension
 */
export const vscodeUninstallExtensionTool: AgentTool = {
  name: 'vscode_uninstall_extension',
  description: 'Uninstall a VS Code extension by ID',
  parameters: {
    type: 'object',
    properties: {
      extensionId: {
        type: 'string',
        description: 'Extension ID to uninstall',
      },
    },
    required: ['extensionId'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const extensionId = params.extensionId as string;
      await vscodeManager.uninstallExtension(extensionId);

      return {
        success: true,
        data: { message: `Extension ${extensionId} uninstalled successfully` },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to uninstall extension: ${getErrorMessage(error)}`,
      };
    }
  },
};

/**
 * Get VS Code version and status
 */
export const vscodeStatusTool: AgentTool = {
  name: 'vscode_status',
  description: 'Check if VS Code is installed and get version information',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (): Promise<ActionResult> => {
    try {
      const available = await vscodeManager.isAvailable();

      if (!available) {
        return {
          success: true,
          data: {
            installed: false,
            message: 'VS Code is not installed or not in PATH',
          },
        };
      }

      const version = await vscodeManager.getVersion();
      const lines = version.split('\n');

      return {
        success: true,
        data: {
          installed: true,
          version: lines[0],
          commit: lines[1],
          architecture: lines[2],
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to get VS Code status: ${getErrorMessage(error)}`,
      };
    }
  },
};

/**
 * Open VS Code settings
 */
export const vscodeOpenSettingsTool: AgentTool = {
  name: 'vscode_open_settings',
  description: 'Open VS Code user settings file',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (): Promise<ActionResult> => {
    try {
      await vscodeManager.openSettings('user');

      return {
        success: true,
        data: { message: 'Settings file opened' },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to open settings: ${getErrorMessage(error)}`,
      };
    }
  },
};

/**
 * Search files in workspace
 */
export const vscodeSearchFilesTool: AgentTool = {
  name: 'vscode_search_files',
  description: 'Search for files matching a pattern in a workspace directory',
  parameters: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'Glob pattern to search for (e.g., "**/*.ts")',
      },
      workspace: {
        type: 'string',
        description: 'Workspace directory to search in',
      },
    },
    required: ['pattern', 'workspace'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const pattern = params.pattern as string;
      const workspace = params.workspace as string;

      const files = await vscodeManager.searchFiles(pattern, workspace);

      return {
        success: true,
        data: { files, count: files.length },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to search files: ${getErrorMessage(error)}`,
      };
    }
  },
};

/**
 * Get recently opened items
 */
export const vscodeGetRecentTool: AgentTool = {
  name: 'vscode_get_recent',
  description: 'Get recently opened files and folders in VS Code',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (): Promise<ActionResult> => {
    try {
      const recent = await vscodeManager.getRecentlyOpened();

      return {
        success: true,
        data: { recent, count: recent.length },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to get recent items: ${getErrorMessage(error)}`,
      };
    }
  },
};

/**
 * Get all VS Code tools
 */
export function getVSCodeTools(): AgentTool[] {
  return [
    vscodeOpenFileTool,
    vscodeOpenFolderTool,
    vscodeOpenDiffTool,
    vscodeGetExtensionsTool,
    vscodeInstallExtensionTool,
    vscodeUninstallExtensionTool,
    vscodeStatusTool,
    vscodeOpenSettingsTool,
    vscodeSearchFilesTool,
    vscodeGetRecentTool,
  ];
}

// Export manager for direct access if needed
export { vscodeManager, VSCodeManager };
