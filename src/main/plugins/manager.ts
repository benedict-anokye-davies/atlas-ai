/**
 * Atlas Desktop - Plugin Manager
 * Central management for plugin lifecycle, settings, and coordination
 *
 * Features:
 * - Plugin discovery and loading
 * - Lifecycle management (activate, deactivate, reload)
 * - Settings management with persistence
 * - Plugin dependency resolution
 * - Event-based communication
 *
 * @module plugins/manager
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import { getErrorMessage } from '../../shared/utils';
import { getAuditLogger } from '../security/audit-logger';
import { PluginLoader, getPluginLoader } from './loader';
import { PluginAPIFactory, getPluginAPIFactory } from './api';
import {
  PluginManifest,
  PluginInfo,
  PluginState,
  PluginRegistryEntry,
  PluginSettings,
  PluginLoadResult,
  PluginHookEvent,
  DEFAULT_PLUGIN_SETTINGS,
} from '../../shared/types/plugin';
import type { AgentTool } from '../../shared/types/agent';

const logger = createModuleLogger('PluginManager');

/**
 * Settings file path
 */
const SETTINGS_FILE = path.join(homedir(), '.atlas', 'plugins', 'settings.json');

/**
 * Plugin Manager class
 * Coordinates all plugin operations
 */
export class PluginManager extends EventEmitter {
  private loader: PluginLoader;
  private apiFactory: PluginAPIFactory;
  private registry: Map<string, PluginRegistryEntry> = new Map();
  private settings: PluginSettings;
  private auditLogger = getAuditLogger();
  private initialized = false;
  private activationQueue: string[] = [];
  private isProcessingQueue = false;

  constructor() {
    super();

    // Load settings first to get plugins directory
    this.settings = this.loadSettings();

    // Initialize loader and API factory
    this.loader = getPluginLoader(this.settings.pluginsDir);
    this.apiFactory = getPluginAPIFactory();

    // Set up API factory event forwarding
    this.setupAPIEvents();

    logger.info('PluginManager initialized', {
      pluginsDir: this.settings.pluginsDir,
      enabled: this.settings.enabled,
    });
  }

  /**
   * Set up event forwarding from API factory
   */
  private setupAPIEvents(): void {
    this.apiFactory.on('tool:registered', (data) => {
      this.emit('tool:registered', data);
    });

    this.apiFactory.on('tool:unregistered', (data) => {
      this.emit('tool:unregistered', data);
    });

    this.apiFactory.on('command:registered', (data) => {
      this.emit('command:registered', data);
    });

    this.apiFactory.on('notification', (data) => {
      this.emit('plugin:notification', data);
    });

    this.apiFactory.on('confirmation:request', (data) => {
      this.emit('plugin:confirmation', data);
    });
  }

  /**
   * Initialize the plugin manager
   * Discovers and optionally auto-loads plugins
   */
  async initialize(autoActivate = true): Promise<void> {
    if (this.initialized) {
      logger.warn('PluginManager already initialized');
      return;
    }

    logger.info('Initializing plugin system...');

    // Ensure directories exist
    await this.loader.ensurePluginsDir();
    await this.ensureSettingsDir();

    // Discover plugins
    const discovery = await this.loader.discoverPlugins();

    // Register discovered plugins
    for (const { path: pluginPath, manifest, validation } of discovery.plugins) {
      if (validation.valid && manifest) {
        await this.registerPlugin(manifest, pluginPath);
      } else {
        logger.warn('Skipping invalid plugin', {
          path: pluginPath,
          errors: validation.errors,
        });
      }
    }

    // Auto-activate plugins if enabled
    if (autoActivate && this.settings.enabled) {
      await this.activateEnabledPlugins();
    }

    this.initialized = true;

    logger.info('Plugin system initialized', {
      registered: this.registry.size,
      active: this.getActivePlugins().length,
    });
  }

  /**
   * Ensure settings directory exists
   */
  private async ensureSettingsDir(): Promise<void> {
    const dir = path.dirname(SETTINGS_FILE);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Load settings from disk
   */
  private loadSettings(): PluginSettings {
    try {
      if (existsSync(SETTINGS_FILE)) {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const data = require('fs').readFileSync(SETTINGS_FILE, 'utf-8');
        const settings = JSON.parse(data);
        return {
          ...DEFAULT_PLUGIN_SETTINGS,
          ...settings,
          // Expand home directory
          pluginsDir: (settings.pluginsDir || DEFAULT_PLUGIN_SETTINGS.pluginsDir).replace(
            '~',
            homedir()
          ),
        };
      }
    } catch (error) {
      logger.warn('Failed to load plugin settings, using defaults', {
        error: getErrorMessage(error),
      });
    }

    return {
      ...DEFAULT_PLUGIN_SETTINGS,
      pluginsDir: DEFAULT_PLUGIN_SETTINGS.pluginsDir.replace('~', homedir()),
    };
  }

  /**
   * Save settings to disk
   */
  private async saveSettings(): Promise<void> {
    try {
      await this.ensureSettingsDir();
      const data = JSON.stringify(this.settings, null, 2);
      await fs.writeFile(SETTINGS_FILE, data);
      logger.debug('Plugin settings saved');
    } catch (error) {
      logger.error('Failed to save plugin settings', {
        error: getErrorMessage(error),
      });
    }
  }

  /**
   * Register a plugin in the registry
   */
  private async registerPlugin(manifest: PluginManifest, pluginPath: string): Promise<void> {
    const entry: PluginRegistryEntry = {
      manifest,
      info: {
        name: manifest.name,
        version: manifest.version,
        displayName: manifest.displayName,
        description: manifest.description,
        capabilities: manifest.capabilities,
        permission: manifest.permission,
        state: 'unloaded',
        path: pluginPath,
        enabled: !this.settings.disabledPlugins.includes(manifest.name),
      },
      tools: [],
      commands: [],
      hooks: new Map(),
    };

    this.registry.set(manifest.name, entry);

    this.emit('plugin:discovered', { manifest, path: pluginPath });

    logger.debug('Plugin registered', {
      name: manifest.name,
      version: manifest.version,
      enabled: entry.info.enabled,
    });
  }

  /**
   * Activate all enabled plugins
   */
  private async activateEnabledPlugins(): Promise<void> {
    const enabledPlugins = Array.from(this.registry.values())
      .filter((entry) => entry.info.enabled)
      .sort((a, b) => {
        // Sort by dependencies (plugins with no dependencies first)
        const aDeps = Object.keys(a.manifest.pluginDependencies || {}).length;
        const bDeps = Object.keys(b.manifest.pluginDependencies || {}).length;
        return aDeps - bDeps;
      });

    for (const entry of enabledPlugins) {
      this.activationQueue.push(entry.info.name);
    }

    await this.processActivationQueue();
  }

  /**
   * Process the activation queue
   */
  private async processActivationQueue(): Promise<void> {
    if (this.isProcessingQueue) {
      return;
    }

    this.isProcessingQueue = true;

    while (this.activationQueue.length > 0) {
      const pluginName = this.activationQueue.shift()!;
      try {
        await this.activatePlugin(pluginName);
      } catch (error) {
        logger.error('Failed to activate plugin from queue', {
          plugin: pluginName,
          error: getErrorMessage(error),
        });
      }
    }

    this.isProcessingQueue = false;
  }

  /**
   * Load a plugin (load module without activating)
   */
  async loadPlugin(pluginName: string): Promise<PluginLoadResult> {
    const entry = this.registry.get(pluginName);
    if (!entry) {
      return {
        success: false,
        error: `Plugin "${pluginName}" not found`,
      };
    }

    if (entry.info.state !== 'unloaded' && entry.info.state !== 'error') {
      return {
        success: true,
        plugin: entry.info,
        warnings: ['Plugin already loaded'],
      };
    }

    try {
      this.updatePluginState(pluginName, 'loading');
      this.emit('plugin:loading', { name: pluginName });

      // Load the plugin module
      const instance = await this.loader.loadPluginModule(entry.info.path, entry.manifest);

      // Store the instance
      entry.instance = instance;

      this.updatePluginState(pluginName, 'loaded');
      entry.loadedAt = Date.now();

      this.emit('plugin:loaded', { plugin: entry.info });

      logger.info('Plugin loaded', {
        name: pluginName,
        version: entry.manifest.version,
      });

      return {
        success: true,
        plugin: entry.info,
      };
    } catch (error) {
      const errorMessage = getErrorMessage(error);

      entry.loadError = errorMessage;
      this.updatePluginState(pluginName, 'error');

      this.emit('plugin:error', { name: pluginName, error: errorMessage });

      logger.error('Failed to load plugin', {
        name: pluginName,
        error: errorMessage,
      });

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Activate a plugin
   */
  async activatePlugin(pluginName: string): Promise<PluginLoadResult> {
    const entry = this.registry.get(pluginName);
    if (!entry) {
      return {
        success: false,
        error: `Plugin "${pluginName}" not found`,
      };
    }

    // Check if already active
    if (entry.info.state === 'active') {
      return {
        success: true,
        plugin: entry.info,
        warnings: ['Plugin already active'],
      };
    }

    // Load if not loaded
    if (entry.info.state === 'unloaded' || entry.info.state === 'error') {
      const loadResult = await this.loadPlugin(pluginName);
      if (!loadResult.success) {
        return loadResult;
      }
    }

    // Check dependencies
    const depResult = await this.checkDependencies(entry.manifest);
    if (!depResult.success) {
      return {
        success: false,
        error: `Dependency check failed: ${depResult.missing.join(', ')}`,
      };
    }

    try {
      this.updatePluginState(pluginName, 'initializing');

      // Create plugin context
      const context = this.apiFactory.createContext(entry.manifest, entry.info.path);
      entry.context = context;

      // Apply user configuration
      const userConfig = this.settings.pluginConfig[pluginName];
      if (userConfig) {
        (context as { config: Record<string, unknown> }).config = {
          ...entry.manifest.defaultConfig,
          ...userConfig,
        };
      }

      // Activate the plugin
      await entry.instance!.activate(context);

      // Get tools if the plugin provides them
      if (entry.instance!.getTools) {
        const tools = entry.instance!.getTools();
        for (const tool of tools) {
          context.registerTool(tool);
          entry.tools.push(`${pluginName}:${tool.name}`);
        }
      }

      this.updatePluginState(pluginName, 'active');
      entry.activatedAt = Date.now();

      this.emit('plugin:activated', { plugin: entry.info });

      this.auditLogger.log('authorization', 'info', `Plugin activated: ${pluginName}`, {
        action: 'activate',
        allowed: true,
        source: `plugin:${pluginName}`,
        context: { version: entry.manifest.version },
      });

      logger.info('Plugin activated', {
        name: pluginName,
        version: entry.manifest.version,
        tools: entry.tools.length,
      });

      return {
        success: true,
        plugin: entry.info,
      };
    } catch (error) {
      const errorMessage = getErrorMessage(error);

      entry.lastError = errorMessage;
      this.updatePluginState(pluginName, 'error');

      this.emit('plugin:error', { name: pluginName, error: errorMessage });

      this.auditLogger.log('authorization', 'warning', `Plugin activation failed: ${pluginName}`, {
        action: 'activate',
        allowed: false,
        reason: errorMessage,
        source: `plugin:${pluginName}`,
      });

      logger.error('Failed to activate plugin', {
        name: pluginName,
        error: errorMessage,
      });

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Deactivate a plugin
   */
  async deactivatePlugin(pluginName: string): Promise<boolean> {
    const entry = this.registry.get(pluginName);
    if (!entry || entry.info.state !== 'active') {
      return false;
    }

    try {
      this.updatePluginState(pluginName, 'stopping');

      // Call deactivate if available
      if (entry.instance?.deactivate) {
        await entry.instance.deactivate();
      }

      // Clean up resources
      this.apiFactory.cleanupPlugin(pluginName);

      // Clear tools and commands
      entry.tools = [];
      entry.commands = [];
      entry.hooks.clear();

      this.updatePluginState(pluginName, 'stopped');

      this.emit('plugin:deactivated', { plugin: entry.info });

      logger.info('Plugin deactivated', { name: pluginName });

      return true;
    } catch (error) {
      const errorMessage = getErrorMessage(error);

      logger.error('Error deactivating plugin', {
        name: pluginName,
        error: errorMessage,
      });

      // Force cleanup even on error
      this.apiFactory.cleanupPlugin(pluginName);
      this.updatePluginState(pluginName, 'error');
      entry.lastError = errorMessage;

      return false;
    }
  }

  /**
   * Reload a plugin
   */
  async reloadPlugin(pluginName: string): Promise<PluginLoadResult> {
    const entry = this.registry.get(pluginName);
    if (!entry) {
      return {
        success: false,
        error: `Plugin "${pluginName}" not found`,
      };
    }

    // Deactivate if active
    if (entry.info.state === 'active') {
      await this.deactivatePlugin(pluginName);
    }

    // Unload
    this.loader.unloadPluginModule(pluginName);
    this.updatePluginState(pluginName, 'unloaded');

    // Reload manifest
    try {
      const manifest = await this.loader.loadManifest(entry.info.path);
      entry.manifest = manifest;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      return {
        success: false,
        error: `Failed to reload manifest: ${errorMessage}`,
      };
    }

    // Activate again
    return this.activatePlugin(pluginName);
  }

  /**
   * Unload a plugin completely
   */
  async unloadPlugin(pluginName: string): Promise<boolean> {
    const entry = this.registry.get(pluginName);
    if (!entry) {
      return false;
    }

    // Deactivate if active
    if (entry.info.state === 'active') {
      await this.deactivatePlugin(pluginName);
    }

    // Unload module
    this.loader.unloadPluginModule(pluginName);

    // Remove from registry
    this.registry.delete(pluginName);

    this.emit('plugin:unloaded', { name: pluginName });

    logger.info('Plugin unloaded', { name: pluginName });

    return true;
  }

  /**
   * Enable a plugin
   */
  async enablePlugin(pluginName: string): Promise<boolean> {
    const entry = this.registry.get(pluginName);
    if (!entry) {
      return false;
    }

    // Update settings
    this.settings.disabledPlugins = this.settings.disabledPlugins.filter(
      (name) => name !== pluginName
    );
    await this.saveSettings();

    // Update state
    entry.info.enabled = true;

    this.emit('plugin:enabled', { name: pluginName });

    logger.info('Plugin enabled', { name: pluginName });

    // Activate if system is enabled
    if (this.settings.enabled && entry.info.state === 'unloaded') {
      await this.activatePlugin(pluginName);
    }

    return true;
  }

  /**
   * Disable a plugin
   */
  async disablePlugin(pluginName: string): Promise<boolean> {
    const entry = this.registry.get(pluginName);
    if (!entry) {
      return false;
    }

    // Deactivate if active
    if (entry.info.state === 'active') {
      await this.deactivatePlugin(pluginName);
    }

    // Update settings
    if (!this.settings.disabledPlugins.includes(pluginName)) {
      this.settings.disabledPlugins.push(pluginName);
    }
    await this.saveSettings();

    // Update state
    entry.info.enabled = false;
    this.updatePluginState(pluginName, 'disabled');

    this.emit('plugin:disabled', { name: pluginName });

    logger.info('Plugin disabled', { name: pluginName });

    return true;
  }

  /**
   * Check plugin dependencies
   */
  private async checkDependencies(
    manifest: PluginManifest
  ): Promise<{ success: boolean; missing: string[] }> {
    const missing: string[] = [];

    if (!manifest.pluginDependencies) {
      return { success: true, missing: [] };
    }

    for (const [depName, depVersion] of Object.entries(manifest.pluginDependencies)) {
      const dep = this.registry.get(depName);

      if (!dep) {
        missing.push(`${depName}@${depVersion} (not installed)`);
        continue;
      }

      if (dep.info.state !== 'active') {
        // Try to activate dependency
        const result = await this.activatePlugin(depName);
        if (!result.success) {
          missing.push(`${depName}@${depVersion} (activation failed)`);
        }
      }
    }

    return {
      success: missing.length === 0,
      missing,
    };
  }

  /**
   * Update plugin state
   */
  private updatePluginState(pluginName: string, state: PluginState): void {
    const entry = this.registry.get(pluginName);
    if (entry) {
      entry.info.state = state;
    }
  }

  /**
   * Get plugin configuration
   */
  getPluginConfig(pluginName: string): Record<string, unknown> | undefined {
    return this.settings.pluginConfig[pluginName];
  }

  /**
   * Set plugin configuration
   */
  async setPluginConfig(pluginName: string, config: Record<string, unknown>): Promise<boolean> {
    const entry = this.registry.get(pluginName);
    if (!entry) {
      return false;
    }

    // Validate against schema if available
    if (entry.manifest.configSchema) {
      const valid = this.validateConfig(config, entry.manifest.configSchema);
      if (!valid) {
        logger.warn('Invalid plugin configuration', { plugin: pluginName });
        return false;
      }
    }

    // Update settings
    this.settings.pluginConfig[pluginName] = config;
    await this.saveSettings();

    // Notify plugin of config change
    if (entry.instance?.onConfigChange) {
      try {
        entry.instance.onConfigChange(config);
      } catch (error) {
        logger.error('Plugin config change handler error', {
          plugin: pluginName,
          error: getErrorMessage(error),
        });
      }
    }

    this.emit('plugin:configChanged', { name: pluginName, config });

    return true;
  }

  /**
   * Validate configuration against schema
   */
  private validateConfig(
    config: Record<string, unknown>,
    schema: NonNullable<PluginManifest['configSchema']>
  ): boolean {
    // Basic validation - in production, use a proper JSON Schema validator
    if (schema.required) {
      for (const key of schema.required) {
        if (!(key in config)) {
          return false;
        }
      }
    }

    for (const [key, value] of Object.entries(config)) {
      const propSchema = schema.properties[key];
      if (!propSchema) {
        continue; // Allow extra properties
      }

      const valueType = Array.isArray(value) ? 'array' : typeof value;
      if (valueType !== propSchema.type) {
        return false;
      }
    }

    return true;
  }

  /**
   * Get all registered plugins
   */
  getAllPlugins(): PluginInfo[] {
    return Array.from(this.registry.values()).map((entry) => entry.info);
  }

  /**
   * Get active plugins
   */
  getActivePlugins(): PluginInfo[] {
    return this.getAllPlugins().filter((p) => p.state === 'active');
  }

  /**
   * Get plugin info
   */
  getPlugin(pluginName: string): PluginInfo | undefined {
    return this.registry.get(pluginName)?.info;
  }

  /**
   * Get plugin manifest
   */
  getPluginManifest(pluginName: string): PluginManifest | undefined {
    return this.registry.get(pluginName)?.manifest;
  }

  /**
   * Get all tools from all active plugins
   */
  getAllPluginTools(): AgentTool[] {
    return this.apiFactory.getAllPluginTools();
  }

  /**
   * Execute a hook event across all plugins
   */
  async executeHook(event: PluginHookEvent, data: unknown): Promise<unknown> {
    return this.apiFactory.executeHook(event, data);
  }

  /**
   * Execute a plugin command
   */
  async executeCommand(commandId: string, ...args: unknown[]): Promise<unknown> {
    return this.apiFactory.executeCommand(commandId, ...args);
  }

  /**
   * Get settings
   */
  getSettings(): Readonly<PluginSettings> {
    return { ...this.settings };
  }

  /**
   * Update settings
   */
  async updateSettings(updates: Partial<PluginSettings>): Promise<void> {
    this.settings = {
      ...this.settings,
      ...updates,
    };

    // Handle plugins directory change
    if (updates.pluginsDir) {
      const newDir = updates.pluginsDir.replace('~', homedir());
      this.settings.pluginsDir = path.resolve(newDir);
      this.loader.setPluginsDir(this.settings.pluginsDir);
    }

    await this.saveSettings();

    logger.info('Plugin settings updated', { updates: Object.keys(updates) });
  }

  /**
   * Enable/disable plugin system globally
   */
  async setEnabled(enabled: boolean): Promise<void> {
    if (this.settings.enabled === enabled) {
      return;
    }

    this.settings.enabled = enabled;
    await this.saveSettings();

    if (enabled) {
      // Activate all enabled plugins
      await this.activateEnabledPlugins();
    } else {
      // Deactivate all plugins
      for (const entry of this.registry.values()) {
        if (entry.info.state === 'active') {
          await this.deactivatePlugin(entry.info.name);
        }
      }
    }

    logger.info('Plugin system enabled state changed', { enabled });
  }

  /**
   * Rescan plugins directory for new plugins
   */
  async rescanPlugins(): Promise<number> {
    const discovery = await this.loader.discoverPlugins();
    let newCount = 0;

    for (const { path: pluginPath, manifest, validation } of discovery.plugins) {
      if (!validation.valid || !manifest) {
        continue;
      }

      // Skip already registered plugins
      if (this.registry.has(manifest.name)) {
        continue;
      }

      await this.registerPlugin(manifest, pluginPath);
      newCount++;

      // Auto-activate if enabled
      if (this.settings.enabled && !this.settings.disabledPlugins.includes(manifest.name)) {
        await this.activatePlugin(manifest.name);
      }
    }

    logger.info('Plugin rescan complete', { newPlugins: newCount });

    return newCount;
  }

  /**
   * Shutdown the plugin manager
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down plugin manager...');

    // Deactivate all plugins
    for (const entry of this.registry.values()) {
      if (entry.info.state === 'active') {
        await this.deactivatePlugin(entry.info.name);
      }
    }

    // Clear registry
    this.registry.clear();

    // Remove listeners
    this.removeAllListeners();

    logger.info('Plugin manager shutdown complete');
  }
  
  // ==========================================================================
  // Plugin Auto-Update System
  // ==========================================================================
  
  /**
   * Check for plugin updates from configured registries
   */
  async checkForUpdates(): Promise<PluginUpdateInfo[]> {
    const updates: PluginUpdateInfo[] = [];
    
    for (const [name, entry] of this.registry.entries()) {
      try {
        const latestVersion = await this.fetchLatestVersion(name, entry.manifest);
        
        if (latestVersion && this.isNewerVersion(latestVersion.version, entry.manifest.version)) {
          updates.push({
            name,
            currentVersion: entry.manifest.version,
            latestVersion: latestVersion.version,
            releaseNotes: latestVersion.releaseNotes,
            downloadUrl: latestVersion.downloadUrl,
            publishedAt: latestVersion.publishedAt,
          });
        }
      } catch (error) {
        logger.debug('Failed to check updates for plugin', {
          name,
          error: getErrorMessage(error),
        });
      }
    }
    
    if (updates.length > 0) {
      this.emit('updates:available', { updates });
      logger.info('Plugin updates available', { count: updates.length });
    }
    
    return updates;
  }
  
  /**
   * Fetch the latest version info from npm or GitHub
   */
  private async fetchLatestVersion(
    name: string,
    manifest: PluginManifest
  ): Promise<PluginVersionInfo | null> {
    // Check npm registry
    if (!name.startsWith('@atlas/')) {
      try {
        const info = await this.fetchNpmVersion(name);
        if (info) return info;
      } catch {
        // Continue to try other sources
      }
    }
    
    // Check GitHub releases if repository is specified
    if (manifest.repository) {
      const repoUrl = typeof manifest.repository === 'string'
        ? manifest.repository
        : manifest.repository.url;
        
      if (repoUrl?.includes('github.com')) {
        try {
          const info = await this.fetchGitHubVersion(repoUrl);
          if (info) return info;
        } catch {
          // Continue
        }
      }
    }
    
    return null;
  }
  
  /**
   * Fetch version info from npm registry
   */
  private async fetchNpmVersion(packageName: string): Promise<PluginVersionInfo | null> {
    return new Promise((resolve) => {
      const https = require('https');
      
      const req = https.request({
        hostname: 'registry.npmjs.org',
        path: `/${encodeURIComponent(packageName)}/latest`,
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      }, (res: NodeJS.ReadableStream & { statusCode: number }) => {
        if (res.statusCode !== 200) {
          resolve(null);
          return;
        }
        
        let data = '';
        res.on('data', (chunk: string) => { data += chunk; });
        res.on('end', () => {
          try {
            const pkg = JSON.parse(data);
            resolve({
              version: pkg.version,
              releaseNotes: pkg.description,
              downloadUrl: `https://registry.npmjs.org/${packageName}/-/${packageName}-${pkg.version}.tgz`,
              publishedAt: new Date().toISOString(),
            });
          } catch {
            resolve(null);
          }
        });
      });
      
      req.on('error', () => resolve(null));
      req.setTimeout(5000, () => {
        req.destroy();
        resolve(null);
      });
      req.end();
    });
  }
  
  /**
   * Fetch version info from GitHub releases
   */
  private async fetchGitHubVersion(repoUrl: string): Promise<PluginVersionInfo | null> {
    return new Promise((resolve) => {
      const https = require('https');
      
      // Extract owner/repo from URL
      const match = repoUrl.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
      if (!match) {
        resolve(null);
        return;
      }
      
      const [, owner, repo] = match;
      
      const req = https.request({
        hostname: 'api.github.com',
        path: `/repos/${owner}/${repo}/releases/latest`,
        method: 'GET',
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'Atlas-Desktop-Plugin-Manager',
        },
      }, (res: NodeJS.ReadableStream & { statusCode: number }) => {
        if (res.statusCode !== 200) {
          resolve(null);
          return;
        }
        
        let data = '';
        res.on('data', (chunk: string) => { data += chunk; });
        res.on('end', () => {
          try {
            const release = JSON.parse(data);
            const version = release.tag_name?.replace(/^v/, '');
            
            if (!version) {
              resolve(null);
              return;
            }
            
            // Find tarball asset
            const tarball = release.assets?.find((a: { name: string }) => 
              a.name.endsWith('.tgz') || a.name.endsWith('.tar.gz')
            );
            
            resolve({
              version,
              releaseNotes: release.body || release.name,
              downloadUrl: tarball?.browser_download_url || release.tarball_url,
              publishedAt: release.published_at,
            });
          } catch {
            resolve(null);
          }
        });
      });
      
      req.on('error', () => resolve(null));
      req.setTimeout(5000, () => {
        req.destroy();
        resolve(null);
      });
      req.end();
    });
  }
  
  /**
   * Compare semantic versions
   */
  private isNewerVersion(latest: string, current: string): boolean {
    const parseVersion = (v: string) => {
      const parts = v.replace(/^v/, '').split('.').map(Number);
      return { major: parts[0] || 0, minor: parts[1] || 0, patch: parts[2] || 0 };
    };
    
    const l = parseVersion(latest);
    const c = parseVersion(current);
    
    if (l.major !== c.major) return l.major > c.major;
    if (l.minor !== c.minor) return l.minor > c.minor;
    return l.patch > c.patch;
  }
  
  /**
   * Update a plugin to the latest version
   */
  async updatePlugin(pluginName: string, downloadUrl?: string): Promise<PluginLoadResult> {
    const entry = this.registry.get(pluginName);
    if (!entry) {
      return { success: false, error: `Plugin "${pluginName}" not found` };
    }
    
    // Deactivate current version
    if (entry.info.state === 'active') {
      await this.deactivatePlugin(pluginName);
    }
    
    // Determine download URL
    let url = downloadUrl;
    if (!url) {
      const versionInfo = await this.fetchLatestVersion(pluginName, entry.manifest);
      if (!versionInfo) {
        return { success: false, error: 'Could not find update URL' };
      }
      url = versionInfo.downloadUrl;
    }
    
    try {
      // Download and install
      const result = await this.downloadAndInstallPlugin(url, entry.info.path);
      if (!result.success) {
        return result;
      }
      
      // Re-register the plugin
      this.registry.delete(pluginName);
      await this.rescanPlugins();
      
      // Re-activate if it was enabled
      if (!this.settings.disabledPlugins.includes(pluginName)) {
        await this.activatePlugin(pluginName);
      }
      
      const newEntry = this.registry.get(pluginName);
      this.emit('plugin:updated', {
        name: pluginName,
        previousVersion: entry.manifest.version,
        newVersion: newEntry?.manifest.version,
      });
      
      logger.info('Plugin updated', {
        name: pluginName,
        from: entry.manifest.version,
        to: newEntry?.manifest.version,
      });
      
      return { success: true, plugin: newEntry?.info };
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Plugin update failed', { name: pluginName, error: errorMessage });
      
      // Try to restore previous version
      await this.activatePlugin(pluginName);
      
      return { success: false, error: errorMessage };
    }
  }
  
  /**
   * Download and install a plugin from URL
   */
  private async downloadAndInstallPlugin(
    url: string,
    targetPath: string
  ): Promise<PluginLoadResult> {
    const https = require('https');
    const http = require('http');
    const { createWriteStream, promises: fsp } = require('fs');
    const { pipeline } = require('stream/promises');
    const { createGunzip } = require('zlib');
    const tar = require('tar');
    
    // Create temp file
    const tempFile = path.join(this.settings.pluginsDir, `_temp_${Date.now()}.tgz`);
    
    try {
      // Download
      await new Promise<void>((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        const request = client.get(url, { 
          headers: { 'User-Agent': 'Atlas-Desktop-Plugin-Manager' },
        }, (response: NodeJS.ReadableStream & { statusCode: number; headers: Record<string, string> }) => {
          // Follow redirects
          if (response.statusCode === 302 || response.statusCode === 301) {
            const redirectUrl = response.headers.location;
            if (redirectUrl) {
              this.downloadAndInstallPlugin(redirectUrl, targetPath)
                .then(() => resolve())
                .catch(reject);
              return;
            }
          }
          
          if (response.statusCode !== 200) {
            reject(new Error(`Download failed: ${response.statusCode}`));
            return;
          }
          
          const file = createWriteStream(tempFile);
          pipeline(response, file)
            .then(() => resolve())
            .catch(reject);
        });
        
        request.on('error', reject);
        request.setTimeout(60000, () => {
          request.destroy();
          reject(new Error('Download timeout'));
        });
      });
      
      // Backup current version
      const backupPath = `${targetPath}_backup_${Date.now()}`;
      if (existsSync(targetPath)) {
        await fsp.rename(targetPath, backupPath);
      }
      
      // Extract
      try {
        await fsp.mkdir(targetPath, { recursive: true });
        await tar.extract({
          file: tempFile,
          cwd: targetPath,
          strip: 1, // Remove top-level directory
        });
      } catch (extractError) {
        // Restore backup
        if (existsSync(backupPath)) {
          await fsp.rm(targetPath, { recursive: true, force: true });
          await fsp.rename(backupPath, targetPath);
        }
        throw extractError;
      }
      
      // Cleanup backup
      if (existsSync(backupPath)) {
        await fsp.rm(backupPath, { recursive: true, force: true });
      }
      
      return { success: true };
    } finally {
      // Cleanup temp file
      try {
        await fsp.unlink(tempFile);
      } catch {
        // Ignore
      }
    }
  }
  
  /**
   * Enable auto-update checking
   */
  startAutoUpdateCheck(intervalMs = 24 * 60 * 60 * 1000): void {
    if (this.autoUpdateTimer) {
      clearInterval(this.autoUpdateTimer);
    }
    
    this.autoUpdateTimer = setInterval(() => {
      this.checkForUpdates().catch(err => {
        logger.error('Auto-update check failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, intervalMs);
    
    logger.info('Plugin auto-update enabled', { intervalMs });
  }
  
  /**
   * Stop auto-update checking
   */
  stopAutoUpdateCheck(): void {
    if (this.autoUpdateTimer) {
      clearInterval(this.autoUpdateTimer);
      this.autoUpdateTimer = null;
      logger.info('Plugin auto-update disabled');
    }
  }
  
  private autoUpdateTimer: NodeJS.Timeout | null = null;
}

// Plugin update info types
interface PluginUpdateInfo {
  name: string;
  currentVersion: string;
  latestVersion: string;
  releaseNotes?: string;
  downloadUrl?: string;
  publishedAt?: string;
}

interface PluginVersionInfo {
  version: string;
  releaseNotes?: string;
  downloadUrl?: string;
  publishedAt?: string;
}

// Singleton instance
let managerInstance: PluginManager | null = null;

/**
 * Get or create the singleton PluginManager instance
 */
export function getPluginManager(): PluginManager {
  if (!managerInstance) {
    managerInstance = new PluginManager();
  }
  return managerInstance;
}

/**
 * Initialize the plugin manager
 */
export async function initializePluginManager(autoActivate = true): Promise<PluginManager> {
  const manager = getPluginManager();
  await manager.initialize(autoActivate);
  return manager;
}

/**
 * Shutdown the plugin manager
 */
export async function shutdownPluginManager(): Promise<void> {
  if (managerInstance) {
    await managerInstance.shutdown();
    managerInstance = null;
  }
}

export default PluginManager;
