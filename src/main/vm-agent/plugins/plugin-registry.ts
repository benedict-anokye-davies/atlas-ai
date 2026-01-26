/**
 * Atlas Desktop - VM Agent Plugin Registry
 *
 * Central registry for managing application plugins.
 * Handles plugin discovery, loading, and lifecycle management.
 *
 * @module vm-agent/plugins/plugin-registry
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { createModuleLogger } from '../../utils/logger';
import { getEventBus, createEvent } from '../core/event-bus';
import {
  IAppPlugin,
  BaseAppPlugin,
  GenericWindowsPlugin,
  PluginMetadata,
  PluginCategory,
  AppAction,
  AppState,
  IntentMapping,
} from './app-plugin';
import { ApplicationContext } from '../vision/enhanced-screen';
import { EnhancedUIElement } from '../core/types';
import { ScreenState, VMAction } from '../types';

const logger = createModuleLogger('PluginRegistry');

// =============================================================================
// Plugin Registry Constants
// =============================================================================

export const PLUGIN_REGISTRY_CONSTANTS = {
  /** Built-in plugins directory */
  BUILTIN_PLUGINS_DIR: 'builtin-plugins',
  /** User plugins directory */
  USER_PLUGINS_DIR: 'vm-agent-plugins',
  /** Plugin manifest file */
  MANIFEST_FILE: 'plugin.json',
  /** Plugin cache file */
  CACHE_FILE: 'vm-plugin-cache.json',
  /** Max plugins */
  MAX_PLUGINS: 50,
} as const;

// =============================================================================
// Plugin Registry Types
// =============================================================================

export interface PluginRegistration {
  /** Plugin instance */
  plugin: IAppPlugin;
  /** Registration time */
  registeredAt: number;
  /** Is built-in */
  isBuiltin: boolean;
  /** Source path (if loaded from file) */
  sourcePath?: string;
  /** Is enabled */
  enabled: boolean;
  /** Error (if failed to initialize) */
  error?: string;
}

export interface PluginMatch {
  /** Plugin */
  plugin: IAppPlugin;
  /** Match confidence */
  confidence: number;
  /** Registration */
  registration: PluginRegistration;
}

export interface PluginSearchResult {
  /** Plugin ID */
  pluginId: string;
  /** Plugin name */
  name: string;
  /** Category */
  category: PluginCategory;
  /** Actions matching query */
  matchingActions: AppAction[];
  /** Relevance score */
  relevance: number;
}

export interface PluginStats {
  /** Total plugins */
  total: number;
  /** Enabled plugins */
  enabled: number;
  /** Built-in plugins */
  builtin: number;
  /** By category */
  byCategory: Record<PluginCategory, number>;
  /** Total actions */
  totalActions: number;
}

// =============================================================================
// Plugin Registry
// =============================================================================

/**
 * Central registry for application plugins
 *
 * @example
 * ```typescript
 * const registry = getPluginRegistry();
 *
 * // Register a custom plugin
 * registry.registerPlugin(new VSCodePlugin());
 *
 * // Find best plugin for current app
 * const match = await registry.findBestPlugin(appContext);
 * if (match) {
 *   const actions = match.plugin.getAvailableActions(state);
 * }
 *
 * // Execute intent across all plugins
 * const result = await registry.executeIntent('save the file', state);
 * ```
 */
export class PluginRegistry extends EventEmitter {
  private plugins: Map<string, PluginRegistration> = new Map();
  private genericPlugin: IAppPlugin;
  private dataDir: string;
  private pluginsDir: string;
  private initialized: boolean = false;

  constructor() {
    super();
    this.dataDir = path.join(app.getPath('userData'), 'vm-agent');
    this.pluginsDir = path.join(this.dataDir, PLUGIN_REGISTRY_CONSTANTS.USER_PLUGINS_DIR);
    this.genericPlugin = new GenericWindowsPlugin();
  }

  /**
   * Initialize the registry
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Ensure directories exist
      if (!fs.existsSync(this.dataDir)) {
        fs.mkdirSync(this.dataDir, { recursive: true });
      }
      if (!fs.existsSync(this.pluginsDir)) {
        fs.mkdirSync(this.pluginsDir, { recursive: true });
      }

      // Initialize generic plugin
      await this.genericPlugin.initialize();

      // Register built-in plugins
      await this.registerBuiltinPlugins();

      // Load user plugins
      await this.loadUserPlugins();

      // Load cache
      await this.loadCache();

      this.initialized = true;

      const eventBus = getEventBus();
      eventBus.emitSync(
        createEvent(
          'plugins:registry-initialized',
          { pluginCount: this.plugins.size },
          'plugin-registry',
          { priority: 'normal' },
        ),
      );

      logger.info('Plugin registry initialized', {
        totalPlugins: this.plugins.size,
        enabledPlugins: Array.from(this.plugins.values()).filter((r) => r.enabled).length,
      });
    } catch (error) {
      logger.error('Failed to initialize plugin registry', { error });
      this.initialized = true; // Prevent retry loops
    }
  }

  // ==========================================================================
  // Plugin Registration
  // ==========================================================================

  /**
   * Register a plugin
   */
  async registerPlugin(
    plugin: IAppPlugin,
    options: { isBuiltin?: boolean; sourcePath?: string } = {},
  ): Promise<boolean> {
    await this.ensureInitialized();

    const pluginId = plugin.metadata.id;

    if (this.plugins.has(pluginId)) {
      logger.warn('Plugin already registered', { pluginId });
      return false;
    }

    if (this.plugins.size >= PLUGIN_REGISTRY_CONSTANTS.MAX_PLUGINS) {
      logger.error('Maximum plugin limit reached');
      return false;
    }

    try {
      await plugin.initialize();

      const registration: PluginRegistration = {
        plugin,
        registeredAt: Date.now(),
        isBuiltin: options.isBuiltin || false,
        sourcePath: options.sourcePath,
        enabled: true,
      };

      this.plugins.set(pluginId, registration);

      this.emit('plugin-registered', { pluginId, metadata: plugin.metadata });
      logger.info('Plugin registered', {
        pluginId,
        name: plugin.metadata.name,
        category: plugin.metadata.category,
      });

      this.scheduleCacheSave();

      return true;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to register plugin', { pluginId, error: errorMsg });

      // Register as disabled
      const registration: PluginRegistration = {
        plugin,
        registeredAt: Date.now(),
        isBuiltin: options.isBuiltin || false,
        sourcePath: options.sourcePath,
        enabled: false,
        error: errorMsg,
      };

      this.plugins.set(pluginId, registration);

      return false;
    }
  }

  /**
   * Unregister a plugin
   */
  async unregisterPlugin(pluginId: string): Promise<boolean> {
    const registration = this.plugins.get(pluginId);
    if (!registration) return false;

    if (registration.isBuiltin) {
      logger.warn('Cannot unregister built-in plugin', { pluginId });
      return false;
    }

    try {
      registration.plugin.dispose();
    } catch (error) {
      logger.warn('Error disposing plugin', { pluginId, error });
    }

    this.plugins.delete(pluginId);

    this.emit('plugin-unregistered', { pluginId });
    logger.info('Plugin unregistered', { pluginId });

    this.scheduleCacheSave();

    return true;
  }

  /**
   * Enable a plugin
   */
  enablePlugin(pluginId: string): boolean {
    const registration = this.plugins.get(pluginId);
    if (!registration) return false;

    registration.enabled = true;
    this.emit('plugin-enabled', { pluginId });

    this.scheduleCacheSave();

    return true;
  }

  /**
   * Disable a plugin
   */
  disablePlugin(pluginId: string): boolean {
    const registration = this.plugins.get(pluginId);
    if (!registration) return false;

    registration.enabled = false;
    this.emit('plugin-disabled', { pluginId });

    this.scheduleCacheSave();

    return true;
  }

  // ==========================================================================
  // Plugin Discovery
  // ==========================================================================

  /**
   * Find the best plugin for an application context
   */
  findBestPlugin(context: ApplicationContext): PluginMatch | undefined {
    let bestMatch: PluginMatch | undefined;
    let bestScore = 0;

    for (const [_pluginId, registration] of this.plugins.entries()) {
      if (!registration.enabled) continue;

      const plugin = registration.plugin;

      if (plugin.canHandle(context)) {
        // Calculate confidence based on specificity
        const confidence = this.calculatePluginConfidence(plugin, context);

        if (confidence > bestScore) {
          bestScore = confidence;
          bestMatch = {
            plugin,
            confidence,
            registration,
          };
        }
      }
    }

    // Fall back to generic plugin
    if (!bestMatch || bestScore < 0.5) {
      return {
        plugin: this.genericPlugin,
        confidence: 0.3,
        registration: {
          plugin: this.genericPlugin,
          registeredAt: 0,
          isBuiltin: true,
          enabled: true,
        },
      };
    }

    return bestMatch;
  }

  /**
   * Find all plugins that can handle a context
   */
  findAllPlugins(context: ApplicationContext): PluginMatch[] {
    const matches: PluginMatch[] = [];

    for (const [_pluginId, registration] of this.plugins.entries()) {
      if (!registration.enabled) continue;

      const plugin = registration.plugin;

      if (plugin.canHandle(context)) {
        const confidence = this.calculatePluginConfidence(plugin, context);
        matches.push({
          plugin,
          confidence,
          registration,
        });
      }
    }

    // Sort by confidence
    matches.sort((a, b) => b.confidence - a.confidence);

    // Add generic plugin at end
    matches.push({
      plugin: this.genericPlugin,
      confidence: 0.3,
      registration: {
        plugin: this.genericPlugin,
        registeredAt: 0,
        isBuiltin: true,
        enabled: true,
      },
    });

    return matches;
  }

  /**
   * Search plugins by query
   */
  searchPlugins(query: string): PluginSearchResult[] {
    const queryLower = query.toLowerCase();
    const results: PluginSearchResult[] = [];

    for (const [pluginId, registration] of this.plugins.entries()) {
      if (!registration.enabled) continue;

      const plugin = registration.plugin;
      const metadata = plugin.metadata;

      // Score based on name/description match
      let relevance = 0;
      if (metadata.name.toLowerCase().includes(queryLower)) {
        relevance += 0.5;
      }
      if (metadata.description.toLowerCase().includes(queryLower)) {
        relevance += 0.3;
      }

      // Find matching actions
      const state: AppState = {
        appName: metadata.name,
        context: {
          name: metadata.name,
          processName: metadata.supportedApps[0],
          isReady: true,
        },
      };
      const actions = plugin.getAvailableActions(state);
      const matchingActions = actions.filter(
        (a) =>
          a.name.toLowerCase().includes(queryLower) ||
          a.description.toLowerCase().includes(queryLower) ||
          a.keywords.some((k) => k.toLowerCase().includes(queryLower)),
      );

      if (matchingActions.length > 0) {
        relevance += 0.2 * Math.min(matchingActions.length, 5);
      }

      if (relevance > 0) {
        results.push({
          pluginId,
          name: metadata.name,
          category: metadata.category,
          matchingActions,
          relevance,
        });
      }
    }

    // Sort by relevance
    results.sort((a, b) => b.relevance - a.relevance);

    return results;
  }

  // ==========================================================================
  // Intent Execution
  // ==========================================================================

  /**
   * Execute an intent across all applicable plugins
   */
  async executeIntent(
    intent: string,
    context: ApplicationContext,
    screenState: ScreenState,
    elements: EnhancedUIElement[],
  ): Promise<{ plugin: IAppPlugin; actions: VMAction[] } | undefined> {
    const match = this.findBestPlugin(context);
    if (!match) return undefined;

    const plugin = match.plugin;
    const state = plugin.getAppState(screenState, elements);
    const mapping = plugin.mapIntent(intent, state);

    if (!mapping) {
      // Try generic plugin
      const genericState = this.genericPlugin.getAppState(screenState, elements);
      const genericMapping = this.genericPlugin.mapIntent(intent, genericState);

      if (genericMapping) {
        const actions = await this.genericPlugin.executeAction(
          genericMapping.actionId,
          genericMapping.parameters,
        );
        return { plugin: this.genericPlugin, actions };
      }

      return undefined;
    }

    const actions = await plugin.executeAction(mapping.actionId, mapping.parameters);
    return { plugin, actions };
  }

  // ==========================================================================
  // Plugin Information
  // ==========================================================================

  /**
   * Get plugin by ID
   */
  getPlugin(pluginId: string): IAppPlugin | undefined {
    return this.plugins.get(pluginId)?.plugin;
  }

  /**
   * Get plugin registration
   */
  getRegistration(pluginId: string): PluginRegistration | undefined {
    return this.plugins.get(pluginId);
  }

  /**
   * Get all plugin metadata
   */
  listPlugins(): PluginMetadata[] {
    return Array.from(this.plugins.values())
      .filter((r) => r.enabled)
      .map((r) => r.plugin.metadata);
  }

  /**
   * Get all registrations
   */
  listRegistrations(): PluginRegistration[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Get plugins by category
   */
  getPluginsByCategory(category: PluginCategory): PluginMetadata[] {
    return this.listPlugins().filter((m) => m.category === category);
  }

  /**
   * Get plugin statistics
   */
  getStats(): PluginStats {
    const registrations = Array.from(this.plugins.values());

    const byCategory: Record<PluginCategory, number> = {
      productivity: 0,
      development: 0,
      communication: 0,
      media: 0,
      gaming: 0,
      system: 0,
      browser: 0,
      custom: 0,
    };

    let totalActions = 0;

    for (const reg of registrations) {
      byCategory[reg.plugin.metadata.category]++;

      if (reg.enabled) {
        const state: AppState = {
          appName: reg.plugin.metadata.name,
          context: {
            name: reg.plugin.metadata.name,
            processName: reg.plugin.metadata.supportedApps[0],
            isReady: true,
          },
        };
        totalActions += reg.plugin.getAvailableActions(state).length;
      }
    }

    return {
      total: registrations.length,
      enabled: registrations.filter((r) => r.enabled).length,
      builtin: registrations.filter((r) => r.isBuiltin).length,
      byCategory,
      totalActions,
    };
  }

  /**
   * Get generic plugin
   */
  getGenericPlugin(): IAppPlugin {
    return this.genericPlugin;
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  private async registerBuiltinPlugins(): Promise<void> {
    // The generic plugin is always available
    // Other built-in plugins can be added here

    logger.debug('Built-in plugins registered');
  }

  private async loadUserPlugins(): Promise<void> {
    if (!fs.existsSync(this.pluginsDir)) return;

    try {
      const entries = await fs.promises.readdir(this.pluginsDir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const pluginPath = path.join(this.pluginsDir, entry.name);
          const manifestPath = path.join(
            pluginPath,
            PLUGIN_REGISTRY_CONSTANTS.MANIFEST_FILE,
          );

          if (fs.existsSync(manifestPath)) {
            try {
              await this.loadPluginFromPath(pluginPath);
            } catch (error) {
              logger.warn('Failed to load plugin', { path: pluginPath, error });
            }
          }
        }
      }
    } catch (error) {
      logger.error('Failed to load user plugins', { error });
    }
  }

  private async loadPluginFromPath(_pluginPath: string): Promise<void> {
    // For now, we only support built-in plugins
    // External plugin loading would require a sandboxed execution environment
    logger.debug('External plugin loading not yet implemented');
  }

  private calculatePluginConfidence(plugin: IAppPlugin, context: ApplicationContext): number {
    let confidence = 0;

    const processName = context.processName?.toLowerCase() || '';
    const appName = context.name?.toLowerCase() || '';

    // Exact process name match = high confidence
    for (const supported of plugin.metadata.supportedApps) {
      const supportedLower = supported.toLowerCase();

      if (processName === supportedLower) {
        confidence = Math.max(confidence, 1.0);
      } else if (processName.includes(supportedLower)) {
        confidence = Math.max(confidence, 0.8);
      } else if (appName.includes(supportedLower)) {
        confidence = Math.max(confidence, 0.6);
      }
    }

    // Non-generic plugins get bonus
    if (plugin.metadata.id !== 'generic-windows') {
      confidence += 0.1;
    }

    return Math.min(confidence, 1.0);
  }

  private cacheTimeout: NodeJS.Timeout | null = null;
  private scheduleCacheSave(): void {
    if (this.cacheTimeout) return;
    this.cacheTimeout = setTimeout(() => {
      this.saveCache().catch((e) => logger.error('Failed to save plugin cache', { error: e }));
      this.cacheTimeout = null;
    }, 5000);
  }

  private async saveCache(): Promise<void> {
    const cachePath = path.join(this.dataDir, PLUGIN_REGISTRY_CONSTANTS.CACHE_FILE);

    const cacheData = Array.from(this.plugins.entries()).map(([id, reg]) => ({
      id,
      enabled: reg.enabled,
      isBuiltin: reg.isBuiltin,
      sourcePath: reg.sourcePath,
    }));

    await fs.promises.writeFile(cachePath, JSON.stringify(cacheData, null, 2));
    logger.debug('Plugin cache saved');
  }

  private async loadCache(): Promise<void> {
    const cachePath = path.join(this.dataDir, PLUGIN_REGISTRY_CONSTANTS.CACHE_FILE);

    if (!fs.existsSync(cachePath)) return;

    try {
      const content = await fs.promises.readFile(cachePath, 'utf-8');
      const cacheData = JSON.parse(content);

      // Apply cached enabled states
      for (const item of cacheData) {
        const registration = this.plugins.get(item.id);
        if (registration) {
          registration.enabled = item.enabled;
        }
      }

      logger.debug('Plugin cache loaded');
    } catch (error) {
      logger.warn('Failed to load plugin cache', { error });
    }
  }

  /**
   * Shutdown the registry
   */
  async shutdown(): Promise<void> {
    // Dispose all plugins
    for (const [pluginId, registration] of this.plugins.entries()) {
      try {
        registration.plugin.dispose();
      } catch (error) {
        logger.warn('Error disposing plugin', { pluginId, error });
      }
    }

    this.plugins.clear();

    // Dispose generic plugin
    this.genericPlugin.dispose();

    // Save cache
    await this.saveCache();

    logger.info('Plugin registry shutdown');
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let registryInstance: PluginRegistry | null = null;

/**
 * Get the singleton plugin registry
 */
export function getPluginRegistry(): PluginRegistry {
  if (!registryInstance) {
    registryInstance = new PluginRegistry();
  }
  return registryInstance;
}

/**
 * Reset plugin registry (for testing)
 */
export function resetPluginRegistry(): void {
  if (registryInstance) {
    registryInstance.shutdown().catch(() => {});
  }
  registryInstance = null;
}

// =============================================================================
// Workflow Index Module Export
// =============================================================================

export { getCrossAppWorkflowManager, resetCrossAppWorkflowManager } from '../workflows/cross-app';
export { getMultiVMManager, resetMultiVMManager } from '../workflows/multi-vm';
