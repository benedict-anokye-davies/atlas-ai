/**
 * Atlas Desktop - Plugin Loader
 * Handles plugin discovery, validation, and sandboxed loading
 *
 * Security Features:
 * - Manifest validation with strict schema checking
 * - Capability-based sandboxing
 * - Path traversal prevention
 * - Code integrity verification
 *
 * @module plugins/loader
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { createHash } from 'crypto';
import { createModuleLogger } from '../utils/logger';
import { getErrorMessage } from '../../shared/utils';
import {
  PluginManifest,
  PluginValidationResult,
  PluginDiscoveryResult,
  PluginCapability,
  PluginPermission,
  PluginInstance,
  PluginCategory,
  PluginActivationEvent,
  DEFAULT_PLUGIN_SETTINGS,
} from '../../shared/types/plugin';

const logger = createModuleLogger('PluginLoader');

/**
 * Minimum Atlas version supported
 */
const ATLAS_VERSION = '1.0.0';

/**
 * Maximum manifest file size (1MB)
 */
const MAX_MANIFEST_SIZE = 1024 * 1024;

/**
 * Maximum plugin entry file size (5MB)
 */
const MAX_ENTRY_SIZE = 5 * 1024 * 1024;

/**
 * Blocked capability combinations (security risk)
 */
const BLOCKED_CAPABILITY_COMBINATIONS: PluginCapability[][] = [
  ['subprocess', 'network'], // Remote code execution risk
  ['system', 'network'],     // System compromise risk
];

/**
 * Capability requirements by permission level
 */
const PERMISSION_CAPABILITY_LIMITS: Record<PluginPermission, PluginCapability[]> = {
  minimal: ['tools', 'commands', 'hooks'],
  standard: ['tools', 'commands', 'hooks', 'integrations', 'storage', 'network'],
  elevated: ['tools', 'commands', 'hooks', 'integrations', 'storage', 'network', 'filesystem', 'subprocess'],
  full: ['tools', 'commands', 'hooks', 'integrations', 'storage', 'network', 'filesystem', 'subprocess', 'system', 'ui'],
};

/**
 * Reserved plugin names that cannot be used
 */
const RESERVED_NAMES = [
  'atlas',
  'core',
  'system',
  'internal',
  'builtin',
  'default',
  '__proto__',
  'constructor',
  'prototype',
];

/**
 * Blocked patterns in plugin code
 */
const BLOCKED_CODE_PATTERNS = [
  /require\s*\(\s*['"]child_process['"]\s*\)/,  // Direct child_process import
  /require\s*\(\s*['"]cluster['"]\s*\)/,        // Cluster module
  /require\s*\(\s*['"]worker_threads['"]\s*\)/, // Worker threads
  /eval\s*\(/,                                   // eval usage
  /new\s+Function\s*\(/,                        // Function constructor
  /process\.binding\s*\(/,                      // Low-level bindings
  /require\s*\(\s*['"]vm['"]\s*\)/,             // VM module
  /__dirname\s*\+\s*['"].*\.\.\//,              // Path traversal
];

/**
 * Plugin Loader class
 * Handles discovery, validation, and loading of plugins
 */
export class PluginLoader {
  private pluginsDir: string;
  private loadedModules: Map<string, unknown> = new Map();
  private manifestCache: Map<string, PluginManifest> = new Map();

  constructor(pluginsDir?: string) {
    this.pluginsDir = pluginsDir || this.getDefaultPluginsDir();
    logger.info('PluginLoader initialized', { pluginsDir: this.pluginsDir });
  }

  /**
   * Get default plugins directory
   */
  private getDefaultPluginsDir(): string {
    const defaultDir = DEFAULT_PLUGIN_SETTINGS.pluginsDir.replace('~', homedir());
    return path.resolve(defaultDir);
  }

  /**
   * Ensure plugins directory exists
   */
  async ensurePluginsDir(): Promise<void> {
    if (!existsSync(this.pluginsDir)) {
      await fs.mkdir(this.pluginsDir, { recursive: true });
      logger.info('Created plugins directory', { path: this.pluginsDir });
    }
  }

  /**
   * Discover all plugins in the plugins directory
   */
  async discoverPlugins(): Promise<PluginDiscoveryResult> {
    const result: PluginDiscoveryResult = {
      plugins: [],
      errors: [],
    };

    await this.ensurePluginsDir();

    try {
      const entries = await fs.readdir(this.pluginsDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }

        // Skip hidden directories and node_modules
        if (entry.name.startsWith('.') || entry.name === 'node_modules') {
          continue;
        }

        const pluginPath = path.join(this.pluginsDir, entry.name);

        try {
          const manifest = await this.loadManifest(pluginPath);
          const validation = await this.validateManifest(manifest, pluginPath);

          result.plugins.push({
            path: pluginPath,
            manifest,
            validation,
          });

          if (validation.valid) {
            logger.debug('Discovered plugin', {
              name: manifest.name,
              version: manifest.version,
            });
          } else {
            logger.warn('Plugin validation failed', {
              name: manifest.name,
              errors: validation.errors,
            });
          }
        } catch (error) {
          const errorMessage = getErrorMessage(error);
          result.errors.push({
            path: pluginPath,
            error: errorMessage,
          });
          logger.warn('Failed to load plugin manifest', {
            path: pluginPath,
            error: errorMessage,
          });
        }
      }
    } catch (error) {
      logger.error('Failed to discover plugins', {
        error: getErrorMessage(error),
      });
    }

    logger.info('Plugin discovery complete', {
      found: result.plugins.length,
      valid: result.plugins.filter((p) => p.validation.valid).length,
      errors: result.errors.length,
    });

    return result;
  }

  /**
   * Load and parse plugin manifest (package.json)
   */
  async loadManifest(pluginPath: string): Promise<PluginManifest> {
    // Check cache first
    const cached = this.manifestCache.get(pluginPath);
    if (cached) {
      return cached;
    }

    const manifestPath = path.join(pluginPath, 'package.json');

    // Security: Check path doesn't escape plugins directory
    const normalizedPath = path.normalize(manifestPath);
    if (!normalizedPath.startsWith(this.pluginsDir)) {
      throw new Error('Path traversal attempt detected');
    }

    // Check file exists
    if (!existsSync(manifestPath)) {
      throw new Error('package.json not found');
    }

    // Check file size
    const stats = await fs.stat(manifestPath);
    if (stats.size > MAX_MANIFEST_SIZE) {
      throw new Error(`Manifest too large: ${stats.size} bytes (max: ${MAX_MANIFEST_SIZE})`);
    }

    // Read and parse
    const content = await fs.readFile(manifestPath, 'utf-8');
    let packageJson: Record<string, unknown>;

    try {
      packageJson = JSON.parse(content);
    } catch {
      throw new Error('Invalid JSON in package.json');
    }

    // Extract Atlas plugin configuration
    const manifest = this.extractPluginManifest(packageJson);

    // Cache the manifest
    this.manifestCache.set(pluginPath, manifest);

    return manifest;
  }

  /**
   * Extract plugin manifest from package.json
   */
  private extractPluginManifest(packageJson: Record<string, unknown>): PluginManifest {
    // Atlas-specific config can be in "atlas" field or root
    const atlasConfig = (packageJson.atlas as Record<string, unknown>) || {};

    // Build manifest from package.json + atlas config
    const manifest: PluginManifest = {
      name: this.validateString(packageJson.name, 'name'),
      version: this.validateString(packageJson.version, 'version'),
      displayName: this.validateString(
        atlasConfig.displayName || packageJson.displayName || packageJson.name,
        'displayName'
      ),
      description: this.validateString(
        packageJson.description || atlasConfig.description || '',
        'description'
      ),
      author: packageJson.author as string | { name: string; email?: string; url?: string },
      license: packageJson.license as string,
      repository: packageJson.repository as string | { type: string; url: string },
      homepage: packageJson.homepage as string,
      keywords: packageJson.keywords as string[],
      main: this.validateString(packageJson.main || atlasConfig.main || 'index.js', 'main'),
      atlasVersion: this.validateString(
        atlasConfig.atlasVersion || atlasConfig.engineVersion || ATLAS_VERSION,
        'atlasVersion'
      ),
      capabilities: this.validateCapabilities(atlasConfig.capabilities as string[]),
      permission: this.validatePermission(atlasConfig.permission as string),
      icon: atlasConfig.icon as string,
      categories: atlasConfig.categories as PluginCategory[],
      pluginDependencies: atlasConfig.pluginDependencies as Record<string, string>,
      dependencies: packageJson.dependencies as Record<string, string>,
      configSchema: atlasConfig.configSchema as PluginManifest['configSchema'],
      defaultConfig: atlasConfig.defaultConfig as Record<string, unknown>,
      activationEvents: atlasConfig.activationEvents as PluginActivationEvent[],
      contributes: atlasConfig.contributes as PluginManifest['contributes'],
      security: atlasConfig.security as PluginManifest['security'],
    };

    return manifest;
  }

  /**
   * Validate a string field
   */
  private validateString(value: unknown, fieldName: string): string {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(`Invalid or missing field: ${fieldName}`);
    }
    return value.trim();
  }

  /**
   * Validate capabilities array
   */
  private validateCapabilities(capabilities: unknown): PluginCapability[] {
    const validCapabilities: PluginCapability[] = [
      'tools', 'commands', 'integrations', 'ui', 'hooks',
      'storage', 'network', 'filesystem', 'subprocess', 'system',
    ];

    if (!Array.isArray(capabilities)) {
      return ['tools']; // Default capability
    }

    const result: PluginCapability[] = [];
    for (const cap of capabilities) {
      if (typeof cap === 'string' && validCapabilities.includes(cap as PluginCapability)) {
        result.push(cap as PluginCapability);
      }
    }

    return result.length > 0 ? result : ['tools'];
  }

  /**
   * Validate permission level
   */
  private validatePermission(permission: unknown): PluginPermission {
    const validPermissions: PluginPermission[] = ['minimal', 'standard', 'elevated', 'full'];

    if (typeof permission === 'string' && validPermissions.includes(permission as PluginPermission)) {
      return permission as PluginPermission;
    }

    return 'minimal'; // Default to minimal permissions
  }

  /**
   * Validate plugin manifest
   */
  async validateManifest(
    manifest: PluginManifest,
    pluginPath: string
  ): Promise<PluginValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate name
    if (!manifest.name || manifest.name.length < 1) {
      errors.push('Plugin name is required');
    } else {
      // Check reserved names
      const baseName = manifest.name.split('/').pop()?.toLowerCase() || '';
      if (RESERVED_NAMES.includes(baseName)) {
        errors.push(`Plugin name "${manifest.name}" is reserved`);
      }

      // Validate name format (npm-style)
      if (!/^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/.test(manifest.name)) {
        errors.push('Plugin name must be lowercase and may contain hyphens, underscores, dots');
      }
    }

    // Validate version
    if (!manifest.version || !/^\d+\.\d+\.\d+/.test(manifest.version)) {
      errors.push('Valid semantic version is required');
    }

    // Validate main entry point
    if (!manifest.main) {
      errors.push('Main entry point is required');
    } else {
      // Security: Check for path traversal
      if (manifest.main.includes('..') || path.isAbsolute(manifest.main)) {
        errors.push('Main entry point cannot contain path traversal or absolute paths');
      }

      // Check entry file exists
      const entryPath = path.join(pluginPath, manifest.main);
      if (!existsSync(entryPath)) {
        errors.push(`Main entry file not found: ${manifest.main}`);
      } else {
        // Check entry file size
        const stats = await fs.stat(entryPath);
        if (stats.size > MAX_ENTRY_SIZE) {
          warnings.push(`Entry file is large: ${Math.round(stats.size / 1024)}KB`);
        }
      }
    }

    // Validate Atlas version compatibility
    if (!this.isVersionCompatible(manifest.atlasVersion)) {
      warnings.push(`Plugin requires Atlas ${manifest.atlasVersion}, current is ${ATLAS_VERSION}`);
    }

    // Validate capabilities vs permission level
    const allowedCapabilities = PERMISSION_CAPABILITY_LIMITS[manifest.permission];
    for (const cap of manifest.capabilities) {
      if (!allowedCapabilities.includes(cap)) {
        errors.push(
          `Capability "${cap}" requires higher permission level than "${manifest.permission}"`
        );
      }
    }

    // Check for blocked capability combinations
    for (const blocked of BLOCKED_CAPABILITY_COMBINATIONS) {
      const hasAll = blocked.every((cap) => manifest.capabilities.includes(cap));
      if (hasAll) {
        errors.push(`Capability combination [${blocked.join(', ')}] is not allowed for security reasons`);
      }
    }

    // Validate high-risk capabilities
    if (manifest.capabilities.includes('system')) {
      warnings.push('Plugin requests system-level access - requires explicit user approval');
    }
    if (manifest.capabilities.includes('subprocess')) {
      warnings.push('Plugin requests subprocess access - review carefully before enabling');
    }

    // Validate contributes section
    if (manifest.contributes) {
      // Check tool contributions
      if (manifest.contributes.tools) {
        for (const tool of manifest.contributes.tools) {
          if (!tool.name || !tool.description) {
            errors.push('Tool contributions must have name and description');
          }
        }
      }

      // Check command contributions
      if (manifest.contributes.commands) {
        for (const cmd of manifest.contributes.commands) {
          if (!cmd.id || !cmd.title) {
            errors.push('Command contributions must have id and title');
          }
        }
      }
    }

    // Security metadata validation
    if (manifest.security) {
      // Validate allowed hosts
      if (manifest.security.allowedHosts) {
        for (const host of manifest.security.allowedHosts) {
          if (host === '*' || host.includes('*')) {
            warnings.push('Plugin requests wildcard network access');
          }
        }
      }

      // Validate allowed paths
      if (manifest.security.allowedPaths) {
        for (const p of manifest.security.allowedPaths) {
          if (p === '/' || p === 'C:\\' || p.includes('..')) {
            errors.push(`Invalid allowed path: ${p}`);
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      manifest: errors.length === 0 ? manifest : undefined,
    };
  }

  /**
   * Check version compatibility (simple semver check)
   */
  private isVersionCompatible(required: string): boolean {
    try {
      const [reqMajor] = required.split('.').map(Number);
      const [curMajor] = ATLAS_VERSION.split('.').map(Number);
      return curMajor >= reqMajor;
    } catch {
      return true; // Assume compatible if parsing fails
    }
  }

  /**
   * Load a plugin module (sandboxed)
   */
  async loadPluginModule(
    pluginPath: string,
    manifest: PluginManifest
  ): Promise<PluginInstance> {
    // Security: Normalize and validate path
    const normalizedPath = path.normalize(pluginPath);
    if (!normalizedPath.startsWith(this.pluginsDir)) {
      throw new Error('Plugin path must be within plugins directory');
    }

    const entryPath = path.join(normalizedPath, manifest.main);

    // Security: Validate entry file
    await this.validateEntryFile(entryPath, manifest);

    // Check if already loaded
    const cached = this.loadedModules.get(manifest.name);
    if (cached) {
      return cached as PluginInstance;
    }

    logger.info('Loading plugin module', {
      name: manifest.name,
      entry: manifest.main,
    });

    try {
      // Dynamic import with sandboxing considerations
      // Note: Full VM-based sandboxing would be implemented in production
      // For now, we rely on capability restrictions in the API layer

      // Clear require cache to allow hot reloading
      const resolvedPath = require.resolve(entryPath);
      delete require.cache[resolvedPath];

      // Import the module
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const pluginModule = require(entryPath);

      // Get the plugin instance
      let instance: PluginInstance;

      if (typeof pluginModule === 'function') {
        // Plugin exports a factory function
        instance = pluginModule();
      } else if (typeof pluginModule.default === 'function') {
        // Plugin has a default export factory
        instance = pluginModule.default();
      } else if (pluginModule.default?.activate) {
        // Plugin default export is the instance
        instance = pluginModule.default;
      } else if (pluginModule.activate) {
        // Plugin exports the instance directly
        instance = pluginModule;
      } else {
        throw new Error('Plugin must export an activate function or factory');
      }

      // Validate instance has required methods
      if (typeof instance.activate !== 'function') {
        throw new Error('Plugin must have an activate method');
      }

      // Cache the loaded module
      this.loadedModules.set(manifest.name, instance);

      logger.info('Plugin module loaded successfully', {
        name: manifest.name,
        version: manifest.version,
      });

      return instance;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to load plugin module', {
        name: manifest.name,
        error: errorMessage,
      });
      throw new Error(`Failed to load plugin "${manifest.name}": ${errorMessage}`);
    }
  }

  /**
   * Validate entry file for security issues
   */
  private async validateEntryFile(entryPath: string, manifest: PluginManifest): Promise<void> {
    // Check file exists
    if (!existsSync(entryPath)) {
      throw new Error(`Entry file not found: ${entryPath}`);
    }

    // Read file content for security scanning
    const content = await fs.readFile(entryPath, 'utf-8');

    // Check for blocked patterns (only for non-elevated plugins)
    if (manifest.permission !== 'full' && manifest.permission !== 'elevated') {
      for (const pattern of BLOCKED_CODE_PATTERNS) {
        if (pattern.test(content)) {
          throw new Error(
            `Plugin contains blocked code pattern: ${pattern.source.substring(0, 50)}...`
          );
        }
      }
    }

    // Verify checksum if provided
    if (manifest.security?.checksum) {
      const { algorithm, value } = manifest.security.checksum;
      const hash = createHash(algorithm).update(content).digest('hex');

      if (hash !== value) {
        throw new Error('Plugin checksum verification failed - file may have been tampered with');
      }

      logger.debug('Plugin checksum verified', {
        name: manifest.name,
        algorithm,
      });
    }
  }

  /**
   * Unload a plugin module
   */
  unloadPluginModule(pluginName: string): boolean {
    if (!this.loadedModules.has(pluginName)) {
      return false;
    }

    this.loadedModules.delete(pluginName);
    this.manifestCache.delete(pluginName);

    logger.info('Plugin module unloaded', { name: pluginName });

    return true;
  }

  /**
   * Clear all caches
   */
  clearCaches(): void {
    this.loadedModules.clear();
    this.manifestCache.clear();
    logger.debug('Plugin loader caches cleared');
  }

  /**
   * Get plugins directory
   */
  getPluginsDir(): string {
    return this.pluginsDir;
  }

  /**
   * Set plugins directory
   */
  setPluginsDir(dir: string): void {
    const resolvedDir = dir.replace('~', homedir());
    this.pluginsDir = path.resolve(resolvedDir);
    this.clearCaches();
    logger.info('Plugins directory changed', { path: this.pluginsDir });
  }

  /**
   * Calculate plugin hash for integrity checking
   */
  async calculatePluginHash(
    pluginPath: string,
    algorithm: 'sha256' | 'sha384' | 'sha512' = 'sha256'
  ): Promise<string> {
    const manifest = await this.loadManifest(pluginPath);
    const entryPath = path.join(pluginPath, manifest.main);
    const content = await fs.readFile(entryPath);

    return createHash(algorithm).update(content).digest('hex');
  }
}

// Singleton instance
let loaderInstance: PluginLoader | null = null;

/**
 * Get or create the singleton PluginLoader instance
 */
export function getPluginLoader(pluginsDir?: string): PluginLoader {
  if (!loaderInstance) {
    loaderInstance = new PluginLoader(pluginsDir);
  }
  return loaderInstance;
}

/**
 * Shutdown the plugin loader
 */
export function shutdownPluginLoader(): void {
  if (loaderInstance) {
    loaderInstance.clearCaches();
    loaderInstance = null;
  }
}

export default PluginLoader;
