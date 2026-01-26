/**
 * Atlas Desktop - Plugin System
 * Extensible plugin architecture for Atlas desktop assistant
 *
 * @module plugins
 *
 * @example
 * ```typescript
 * import {
 *   initializePluginManager,
 *   getPluginManager,
 *   shutdownPluginManager
 * } from './plugins';
 *
 * // Initialize on startup
 * await initializePluginManager();
 *
 * // Get manager instance
 * const manager = getPluginManager();
 *
 * // List plugins
 * const plugins = manager.getAllPlugins();
 *
 * // Get plugin tools for LLM
 * const tools = manager.getAllPluginTools();
 *
 * // Execute hook
 * const result = await manager.executeHook('beforeLLM', { prompt });
 *
 * // Shutdown on exit
 * await shutdownPluginManager();
 * ```
 */

// Manager exports
export {
  PluginManager,
  getPluginManager,
  initializePluginManager,
  shutdownPluginManager,
} from './manager';

// Loader exports
export {
  PluginLoader,
  getPluginLoader,
  shutdownPluginLoader,
} from './loader';

// API exports
export {
  PluginAPIFactory,
  getPluginAPIFactory,
  shutdownPluginAPIFactory,
} from './api';

// Re-export types from shared
export type {
  // Core types
  PluginManifest,
  PluginInstance,
  PluginContext,
  PluginInfo,
  PluginState,
  PluginCapability,
  PluginPermission,

  // Configuration
  PluginSettings,
  PluginConfigSchema,
  PluginConfigProperty,

  // Contributions
  PluginContributes,
  PluginToolContribution,
  PluginCommandContribution,
  PluginIntegrationContribution,
  PluginSettingContribution,
  PluginHookContribution,

  // Hooks
  PluginHookEvent,

  // Activation
  PluginActivationEvent,
  PluginCategory,

  // Security
  PluginSecurityMeta,

  // Results
  PluginLoadResult,
  PluginValidationResult,
  PluginDiscoveryResult,

  // Logging & Storage
  PluginLogger,
  PluginStorage,
  PluginSecrets,

  // Registry
  PluginRegistryEntry,
  PluginManagerEvents,
} from '../../shared/types/plugin';

export { DEFAULT_PLUGIN_SETTINGS } from '../../shared/types/plugin';

/**
 * Quick start guide for plugin development
 *
 * ## Creating a Plugin
 *
 * 1. Create a directory in ~/.atlas/plugins/
 * 2. Create package.json with atlas configuration
 * 3. Implement the plugin module
 *
 * ### Example package.json
 * ```json
 * {
 *   "name": "my-atlas-plugin",
 *   "version": "1.0.0",
 *   "main": "index.js",
 *   "atlas": {
 *     "displayName": "My Plugin",
 *     "atlasVersion": "1.0.0",
 *     "capabilities": ["tools", "commands"],
 *     "permission": "standard",
 *     "contributes": {
 *       "tools": [
 *         {
 *           "name": "my_tool",
 *           "description": "Does something useful",
 *           "category": "utility"
 *         }
 *       ]
 *     }
 *   }
 * }
 * ```
 *
 * ### Example plugin module (index.js)
 * ```javascript
 * module.exports = {
 *   activate(context) {
 *     context.log.info('Plugin activated!');
 *
 *     // Register a tool
 *     context.registerTool({
 *       name: 'my_tool',
 *       description: 'Does something useful',
 *       parameters: {
 *         type: 'object',
 *         properties: {
 *           input: { type: 'string', description: 'Input text' }
 *         },
 *         required: ['input']
 *       },
 *       execute: async ({ input }) => {
 *         return {
 *           success: true,
 *           data: `Processed: ${input}`
 *         };
 *       }
 *     });
 *
 *     // Register a command
 *     context.registerCommand('greet', (name) => {
 *       return `Hello, ${name}!`;
 *     });
 *   },
 *
 *   deactivate() {
 *     console.log('Plugin deactivated');
 *   }
 * };
 * ```
 *
 * ## Plugin Capabilities
 *
 * - `tools`: Register agent tools for LLM
 * - `commands`: Register voice/text commands
 * - `hooks`: Hook into pipeline events
 * - `storage`: Persistent key-value storage
 * - `network`: Make HTTP requests (restricted)
 * - `filesystem`: Read/write files (sandboxed)
 * - `subprocess`: Execute shell commands (restricted)
 * - `integrations`: Connect to external services
 * - `system`: System-level access (requires approval)
 *
 * ## Permission Levels
 *
 * - `minimal`: Basic tools, commands, hooks only
 * - `standard`: Adds network, storage, integrations
 * - `elevated`: Adds filesystem, subprocess
 * - `full`: All capabilities (requires user approval)
 *
 * ## Security Notes
 *
 * - Plugins run in sandboxed environment
 * - Network requests are restricted to allowed hosts
 * - Filesystem access is limited to plugin directory
 * - All actions are audited
 * - User must approve elevated permissions
 */
