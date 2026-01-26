/**
 * Atlas Desktop - VM Agent Plugins Module
 *
 * Exports for the plugin system including:
 * - Application plugin interface
 * - Plugin registry
 * - Built-in plugins
 *
 * @module vm-agent/plugins
 */

// =============================================================================
// Plugin Interface Exports
// =============================================================================

export {
  // Constants
  APP_PLUGIN_CONSTANTS,
  // Types
  PluginCategory,
  PluginMetadata,
  ActionParameter,
  AppAction,
  AppState,
  NavigationTarget,
  ElementPattern,
  IntentMapping,
  WorkflowTemplate,
  // Interface
  IAppPlugin,
  // Base Class
  BaseAppPlugin,
  // Built-in Plugins
  GenericWindowsPlugin,
  getGenericWindowsPlugin,
} from './app-plugin';

// =============================================================================
// Plugin Registry Exports
// =============================================================================

export {
  // Constants
  REGISTRY_CONSTANTS,
  // Types
  PluginRegistration,
  PluginMatch,
  PluginSearchResult,
  PluginStats,
  // Registry
  PluginRegistry,
  getPluginRegistry,
  resetPluginRegistry,
} from './plugin-registry';

// =============================================================================
// Module Initialization
// =============================================================================

import { createModuleLogger } from '../../utils/logger';
import { getPluginRegistry } from './plugin-registry';
import { getGenericWindowsPlugin, GenericWindowsPlugin } from './app-plugin';

const logger = createModuleLogger('VMAgentPlugins');

/**
 * Initialize the plugin system
 */
export async function initializePlugins(): Promise<void> {
  logger.info('Initializing VM Agent plugins...');

  try {
    const registry = getPluginRegistry();
    await registry.initialize();

    // Register built-in plugins
    await registerBuiltInPlugins(registry);

    // Load cached plugins
    await registry.loadCache();

    logger.info('VM Agent plugins initialized');
  } catch (error) {
    logger.error('Failed to initialize plugins', { error });
    throw error;
  }
}

/**
 * Register built-in plugins
 */
async function registerBuiltInPlugins(
  registry: ReturnType<typeof getPluginRegistry>,
): Promise<void> {
  // Generic Windows plugin (lowest priority fallback)
  const genericPlugin = getGenericWindowsPlugin();
  await registry.registerPlugin(genericPlugin);

  logger.debug('Built-in plugins registered');
}

/**
 * Reset the plugin system (for testing)
 */
export async function resetPlugins(): Promise<void> {
  const { resetPluginRegistry } = await import('./plugin-registry');
  resetPluginRegistry();
  logger.debug('Plugins reset');
}

/**
 * Get plugin system status
 */
export function getPluginStatus(): {
  initialized: boolean;
  pluginCount: number;
  enabledCount: number;
  categories: Record<string, number>;
} {
  const registry = getPluginRegistry();
  const stats = registry.getStats();
  const plugins = registry.listPlugins();

  // Count by category
  const categories: Record<string, number> = {};
  for (const plugin of plugins) {
    const category = plugin.metadata.category;
    categories[category] = (categories[category] || 0) + 1;
  }

  return {
    initialized: true,
    pluginCount: stats.totalPlugins,
    enabledCount: stats.enabledPlugins,
    categories,
  };
}

/**
 * Create application-specific plugin
 */
export function createAppPlugin(
  metadata: {
    id: string;
    name: string;
    version: string;
    description: string;
    author?: string;
    category: 'productivity' | 'development' | 'browser' | 'system' | 'creative' | 'game' | 'other';
    supportedApps: string[];
  },
  implementations: {
    canHandle?: (appContext: unknown) => Promise<boolean>;
    getAppState?: () => Promise<unknown>;
    getAvailableActions?: () => Promise<unknown[]>;
    executeAction?: (actionId: string, params: Record<string, unknown>) => Promise<unknown>;
    navigateTo?: (target: unknown) => Promise<boolean>;
    findElement?: (query: unknown) => Promise<unknown | null>;
  },
): IAppPlugin {
  // Import IAppPlugin at runtime to avoid circular dependency
  const plugin = new GenericWindowsPlugin();

  // Override with custom implementations
  if (implementations.canHandle) {
    plugin.canHandle = implementations.canHandle;
  }
  if (implementations.getAppState) {
    plugin.getAppState = implementations.getAppState;
  }
  if (implementations.getAvailableActions) {
    plugin.getAvailableActions = implementations.getAvailableActions;
  }
  if (implementations.executeAction) {
    plugin.executeAction = implementations.executeAction;
  }
  if (implementations.navigateTo) {
    plugin.navigateTo = implementations.navigateTo as (target: NavigationTarget) => Promise<boolean>;
  }
  if (implementations.findElement) {
    plugin.findElement = implementations.findElement;
  }

  // Update metadata
  Object.assign(plugin.metadata, metadata);

  return plugin;
}

// Re-export type for createAppPlugin
import { NavigationTarget, IAppPlugin } from './app-plugin';
