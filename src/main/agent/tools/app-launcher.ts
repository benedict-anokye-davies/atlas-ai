/**
 * Atlas Desktop - Application Launcher Tool
 *
 * Provides voice-activated application launching with:
 * - Fuzzy matching for app names
 * - Custom aliases (e.g., "browser" -> Chrome)
 * - Recent apps tracking
 * - Launch with arguments support
 * - Graceful error handling for missing apps
 *
 * @module agent/tools/app-launcher
 *
 * @example
 * ```typescript
 * // Voice commands supported:
 * // "Open Chrome"
 * // "Launch VS Code"
 * // "Open browser" (resolves to Chrome/Edge/Firefox)
 * // "Launch notepad with file.txt"
 * ```
 */

import { spawn } from 'child_process';
import * as os from 'os';
import { shell } from 'electron';
import { AgentTool, ActionResult } from '../../../shared/types/agent';
import { createModuleLogger } from '../../utils/logger';
import { getAppRegistry, AppRegistry } from '../../system/app-registry';

const logger = createModuleLogger('AppLauncher');

/**
 * Result of an app launch operation
 */
export interface AppLaunchResult {
  /** Name of the application */
  appName: string;
  /** Whether the launch was successful */
  launched: boolean;
  /** Path to the executable that was launched */
  executablePath?: string;
  /** Process ID if available */
  pid?: number;
  /** Arguments passed to the application */
  args?: string[];
  /** If fuzzy matched, the original query */
  matchedFrom?: string;
  /** Confidence score of the match (0-1) */
  matchConfidence?: number;
  /** Suggestions if app not found */
  suggestions?: string[];
}

/**
 * Parse voice command to extract app name and arguments
 *
 * Handles patterns like:
 * - "Open Chrome"
 * - "Launch VS Code with project.txt"
 * - "Start notepad file.txt"
 * - "Run calculator"
 */
function parseVoiceCommand(command: string): { appName: string; args: string[] } {
  // Normalize command
  const normalized = command.toLowerCase().trim();

  // Remove common prefixes
  const prefixes = ['open', 'launch', 'start', 'run', 'execute', 'please open', 'can you open'];
  let remaining = normalized;

  for (const prefix of prefixes) {
    if (remaining.startsWith(prefix + ' ')) {
      remaining = remaining.slice(prefix.length + 1).trim();
      break;
    }
  }

  // Check for "with" or "using" to separate args
  const argSeparators = [' with ', ' using ', ' and open '];
  let appName = remaining;
  let args: string[] = [];

  for (const sep of argSeparators) {
    const sepIndex = remaining.indexOf(sep);
    if (sepIndex !== -1) {
      appName = remaining.slice(0, sepIndex).trim();
      const argString = remaining.slice(sepIndex + sep.length).trim();
      // Split arguments by spaces but preserve quoted strings
      args = parseArguments(argString);
      break;
    }
  }

  return { appName, args };
}

/**
 * Parse argument string into array, respecting quotes
 */
function parseArguments(argString: string): string[] {
  const args: string[] = [];
  let current = '';
  let inQuotes = false;
  let quoteChar = '';

  for (const char of argString) {
    if ((char === '"' || char === "'") && !inQuotes) {
      inQuotes = true;
      quoteChar = char;
    } else if (char === quoteChar && inQuotes) {
      inQuotes = false;
      quoteChar = '';
    } else if (char === ' ' && !inQuotes) {
      if (current.trim()) {
        args.push(current.trim());
      }
      current = '';
    } else {
      current += char;
    }
  }

  if (current.trim()) {
    args.push(current.trim());
  }

  return args;
}

/**
 * Launch an application by path
 */
async function launchApp(
  executablePath: string,
  args: string[] = []
): Promise<{ success: boolean; pid?: number; error?: string }> {
  return new Promise((resolve) => {
    try {
      logger.debug('Launching application', { executablePath, args });

      // For Windows, handle special cases
      const isWindows = os.platform() === 'win32';

      // Spawn the process
      const child = spawn(executablePath, args, {
        detached: true, // Allow the app to run independently
        stdio: 'ignore', // Don't pipe stdio
        shell: isWindows, // Use shell on Windows for better compatibility
        windowsHide: false, // Show the window
      });

      // Unref to allow parent to exit independently
      child.unref();

      // Give it a moment to start
      setTimeout(() => {
        if (child.pid) {
          logger.info('Application launched', { executablePath, pid: child.pid });
          resolve({ success: true, pid: child.pid });
        } else {
          resolve({ success: true }); // Still success, just no PID
        }
      }, 100);

      child.on('error', (error) => {
        logger.error('Failed to launch application', { executablePath, error: error.message });
        resolve({ success: false, error: error.message });
      });
    } catch (error) {
      const err = error as Error;
      logger.error('Exception launching application', { executablePath, error: err.message });
      resolve({ success: false, error: err.message });
    }
  });
}

/**
 * Launch an application using shell.openPath (for non-exe files)
 */
async function launchWithShell(targetPath: string): Promise<{ success: boolean; error?: string }> {
  try {
    const error = await shell.openPath(targetPath);
    if (error) {
      return { success: false, error };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Build suggestions for when an app is not found
 */
function buildSuggestions(query: string, registry: AppRegistry): string[] {
  const searchResults = registry.searchApps(query, 5);
  return searchResults.map((app) => app.name);
}

/**
 * Main application launcher tool
 *
 * Handles voice commands like:
 * - "Open Chrome"
 * - "Launch VS Code"
 * - "Open browser" (uses alias)
 * - "Start notepad with myfile.txt"
 */
export const launchAppTool: AgentTool = {
  name: 'app_launch',
  description:
    'Launch an application by name. Supports common apps, fuzzy matching, and aliases like "browser", "editor", "terminal". Can also pass arguments to the app.',
  parameters: {
    type: 'object',
    properties: {
      appName: {
        type: 'string',
        description:
          'Name of the application to launch (e.g., "Chrome", "VS Code", "browser", "notepad")',
      },
      args: {
        type: 'array',
        description: 'Optional arguments to pass to the application (e.g., file paths)',
      },
      voiceCommand: {
        type: 'string',
        description:
          'Full voice command if available (e.g., "open chrome with google.com"). Will be parsed to extract app name and args.',
      },
    },
    required: ['appName'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      // Initialize registry if needed
      const registry = getAppRegistry();
      await registry.initialize();

      // Parse input - either direct appName or voice command
      let appName: string;
      let args: string[];

      if (params.voiceCommand && typeof params.voiceCommand === 'string') {
        const parsed = parseVoiceCommand(params.voiceCommand);
        appName = parsed.appName;
        args = parsed.args;
      } else {
        appName = params.appName as string;
        args = (params.args as string[]) || [];
      }

      logger.info('Launching application', { appName, args });

      // Find the app
      const app = registry.findApp(appName);

      if (!app) {
        // App not found - provide suggestions
        const suggestions = buildSuggestions(appName, registry);

        logger.warn('Application not found', { appName, suggestions });

        const result: AppLaunchResult = {
          appName,
          launched: false,
          suggestions,
        };

        const voiceResponse =
          suggestions.length > 0
            ? `I couldn't find "${appName}". Did you mean ${suggestions.slice(0, 3).join(', ')}?`
            : `I couldn't find an application called "${appName}". Try saying the full name or add it as a custom app.`;

        return {
          success: false,
          data: result,
          error: `Application "${appName}" not found`,
          metadata: { voiceResponse },
        };
      }

      // Launch the app
      const launchResult = await launchApp(app.executablePath, args);

      if (!launchResult.success) {
        // Try with shell.openPath as fallback
        const shellResult = await launchWithShell(app.executablePath);

        if (!shellResult.success) {
          const result: AppLaunchResult = {
            appName: app.name,
            launched: false,
            executablePath: app.executablePath,
          };

          return {
            success: false,
            data: result,
            error: launchResult.error || shellResult.error || 'Failed to launch application',
            metadata: {
              voiceResponse: `Failed to open ${app.name}. The application might be unavailable.`,
            },
          };
        }
      }

      // Record the launch for recent apps tracking
      registry.recordLaunch(app.name);

      // Calculate match confidence
      const normalizedQuery = appName.toLowerCase().replace(/[^a-z0-9]/g, '');
      const normalizedApp = app.normalizedName.replace(/[^a-z0-9]/g, '');
      const matchConfidence = normalizedQuery === normalizedApp ? 1.0 : 0.8;

      const result: AppLaunchResult = {
        appName: app.name,
        launched: true,
        executablePath: app.executablePath,
        pid: launchResult.pid,
        args: args.length > 0 ? args : undefined,
        matchedFrom: normalizedQuery !== normalizedApp ? appName : undefined,
        matchConfidence,
      };

      logger.info('Application launched successfully', { app: app.name, pid: launchResult.pid });

      return {
        success: true,
        data: result,
        metadata: {
          voiceResponse: `Opening ${app.name}`,
        },
      };
    } catch (error) {
      const err = error as Error;
      logger.error('App launch failed', { error: err.message });
      return {
        success: false,
        error: `Failed to launch application: ${err.message}`,
        metadata: {
          voiceResponse: 'Sorry, I encountered an error trying to open that application.',
        },
      };
    }
  },
};

/**
 * Search for applications by name
 */
export const searchAppsTool: AgentTool = {
  name: 'app_search',
  description:
    'Search for installed applications by name. Returns matching apps with fuzzy search.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query for app name',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results (default: 5)',
      },
    },
    required: ['query'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const registry = getAppRegistry();
      await registry.initialize();

      const query = params.query as string;
      const limit = (params.limit as number) || 5;

      const results = registry.searchApps(query, limit);

      return {
        success: true,
        data: {
          query,
          results: results.map((app) => ({
            name: app.name,
            path: app.executablePath,
            source: app.source,
            lastLaunched: app.lastLaunched,
            launchCount: app.launchCount,
          })),
          count: results.length,
        },
        metadata: {
          voiceResponse:
            results.length > 0
              ? `Found ${results.length} apps matching "${query}": ${results
                  .slice(0, 3)
                  .map((a) => a.name)
                  .join(', ')}`
              : `No apps found matching "${query}"`,
        },
      };
    } catch (error) {
      const err = error as Error;
      logger.error('App search failed', { error: err.message });
      return {
        success: false,
        error: err.message,
      };
    }
  },
};

/**
 * Get recently launched applications
 */
export const recentAppsTool: AgentTool = {
  name: 'app_recent',
  description: 'Get the list of recently launched applications via Atlas.',
  parameters: {
    type: 'object',
    properties: {
      limit: {
        type: 'number',
        description: 'Maximum number of results (default: 10)',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const registry = getAppRegistry();
      await registry.initialize();

      const limit = (params.limit as number) || 10;
      const recentApps = registry.getRecentApps().slice(0, limit);

      return {
        success: true,
        data: {
          apps: recentApps.map((app) => ({
            name: app.name,
            lastLaunched: app.lastLaunched,
            launchCount: app.launchCount,
          })),
          count: recentApps.length,
        },
        metadata: {
          voiceResponse:
            recentApps.length > 0
              ? `Your recent apps are: ${recentApps
                  .slice(0, 3)
                  .map((a) => a.name)
                  .join(', ')}`
              : 'No recently launched apps',
        },
      };
    } catch (error) {
      const err = error as Error;
      logger.error('Recent apps lookup failed', { error: err.message });
      return {
        success: false,
        error: err.message,
      };
    }
  },
};

/**
 * Add a custom application alias
 */
export const addAliasTool: AgentTool = {
  name: 'app_add_alias',
  description:
    'Add a custom alias for an application. For example, "browser" can be aliased to "Google Chrome".',
  parameters: {
    type: 'object',
    properties: {
      alias: {
        type: 'string',
        description: 'The alias phrase (e.g., "my editor")',
      },
      appName: {
        type: 'string',
        description: 'The target application name (e.g., "Visual Studio Code")',
      },
    },
    required: ['alias', 'appName'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const registry = getAppRegistry();
      await registry.initialize();

      const alias = params.alias as string;
      const appName = params.appName as string;

      const success = registry.addAlias(alias, appName);

      if (success) {
        logger.info('Added app alias', { alias, appName });
        return {
          success: true,
          data: { alias, appName },
          metadata: {
            voiceResponse: `Got it! From now on, "${alias}" will open ${appName}.`,
          },
        };
      } else {
        return {
          success: false,
          error: `Could not find application "${appName}" to create alias`,
          metadata: {
            voiceResponse: `I couldn't find an application called "${appName}" to create that alias.`,
          },
        };
      }
    } catch (error) {
      const err = error as Error;
      logger.error('Add alias failed', { error: err.message });
      return {
        success: false,
        error: err.message,
      };
    }
  },
};

/**
 * Remove a custom alias
 */
export const removeAliasTool: AgentTool = {
  name: 'app_remove_alias',
  description: 'Remove a custom application alias.',
  parameters: {
    type: 'object',
    properties: {
      alias: {
        type: 'string',
        description: 'The alias to remove',
      },
    },
    required: ['alias'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const registry = getAppRegistry();
      await registry.initialize();

      const alias = params.alias as string;
      const success = registry.removeAlias(alias);

      if (success) {
        logger.info('Removed app alias', { alias });
        return {
          success: true,
          data: { alias, removed: true },
          metadata: {
            voiceResponse: `Removed the alias "${alias}".`,
          },
        };
      } else {
        return {
          success: false,
          error: `Alias "${alias}" not found`,
          metadata: {
            voiceResponse: `I couldn't find an alias called "${alias}".`,
          },
        };
      }
    } catch (error) {
      const err = error as Error;
      logger.error('Remove alias failed', { error: err.message });
      return {
        success: false,
        error: err.message,
      };
    }
  },
};

/**
 * Add a custom application to the registry
 */
export const addCustomAppTool: AgentTool = {
  name: 'app_add_custom',
  description: 'Add a custom application to the registry that can be launched by voice.',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Name for the application (how you will refer to it)',
      },
      executablePath: {
        type: 'string',
        description: 'Full path to the executable',
      },
      aliases: {
        type: 'array',
        description: 'Optional additional names/aliases for this app',
      },
    },
    required: ['name', 'executablePath'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const registry = getAppRegistry();
      await registry.initialize();

      const name = params.name as string;
      const executablePath = params.executablePath as string;
      const aliases = params.aliases as string[] | undefined;

      // Validate path
      const fs = await import('fs/promises');
      try {
        await fs.access(executablePath);
      } catch {
        return {
          success: false,
          error: `Executable not found at: ${executablePath}`,
          metadata: {
            voiceResponse: `I couldn't find an executable at that path.`,
          },
        };
      }

      const app = registry.addCustomApp(name, executablePath, aliases);

      logger.info('Added custom application', { name, executablePath });

      return {
        success: true,
        data: {
          name: app.name,
          executablePath: app.executablePath,
          aliases: app.aliases,
        },
        metadata: {
          voiceResponse: `Added "${name}" to your applications. You can now say "Open ${name}" to launch it.`,
        },
      };
    } catch (error) {
      const err = error as Error;
      logger.error('Add custom app failed', { error: err.message });
      return {
        success: false,
        error: err.message,
      };
    }
  },
};

/**
 * Refresh the application registry
 */
export const refreshRegistryTool: AgentTool = {
  name: 'app_refresh_registry',
  description: 'Refresh the list of installed applications by rescanning the system.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (): Promise<ActionResult> => {
    try {
      const registry = getAppRegistry();
      const result = await registry.refresh();

      logger.info('Application registry refreshed', {
        totalApps: result.apps.length,
        duration: result.duration,
      });

      return {
        success: true,
        data: {
          totalApps: result.apps.length,
          scannedAt: new Date(result.scannedAt).toISOString(),
          duration: result.duration,
          sources: result.sources,
        },
        metadata: {
          voiceResponse: `Found ${result.apps.length} applications. The registry has been updated.`,
        },
      };
    } catch (error) {
      const err = error as Error;
      logger.error('Registry refresh failed', { error: err.message });
      return {
        success: false,
        error: err.message,
        metadata: {
          voiceResponse: 'Sorry, I had trouble scanning for applications.',
        },
      };
    }
  },
};

/**
 * Get registry statistics
 */
export const registryStatsTool: AgentTool = {
  name: 'app_registry_stats',
  description: 'Get statistics about the application registry.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (): Promise<ActionResult> => {
    try {
      const registry = getAppRegistry();
      await registry.initialize();

      const stats = registry.getStats();

      return {
        success: true,
        data: stats,
        metadata: {
          voiceResponse: `I have ${stats.totalApps} applications in my registry, including ${stats.customApps} custom apps and ${stats.recentCount} recently used.`,
        },
      };
    } catch (error) {
      const err = error as Error;
      logger.error('Registry stats failed', { error: err.message });
      return {
        success: false,
        error: err.message,
      };
    }
  },
};

/**
 * Get all app launcher tools
 */
export function getAppLauncherTools(): AgentTool[] {
  return [
    launchAppTool,
    searchAppsTool,
    recentAppsTool,
    addAliasTool,
    removeAliasTool,
    addCustomAppTool,
    refreshRegistryTool,
    registryStatsTool,
  ];
}

export default {
  launchAppTool,
  searchAppsTool,
  recentAppsTool,
  addAliasTool,
  removeAliasTool,
  addCustomAppTool,
  refreshRegistryTool,
  registryStatsTool,
  getAppLauncherTools,
};
