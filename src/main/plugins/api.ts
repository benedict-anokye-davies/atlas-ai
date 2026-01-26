/**
 * Atlas Desktop - Plugin API
 * Provides sandboxed API surface for plugins
 *
 * Security Features:
 * - Capability-based access control
 * - Request validation and sanitization
 * - Rate limiting per-plugin
 * - Audit logging of all API calls
 *
 * @module plugins/api
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { EventEmitter } from 'events';
import { createModuleLogger, ModuleLogger } from '../utils/logger';
import { getErrorMessage } from '../../shared/utils';
import { getAuditLogger } from '../security/audit-logger';
import { getSandboxManager } from '../security/sandbox-manager';
import { validateInput } from '../security/input-validator';
import {
  PluginContext,
  PluginManifest,
  PluginInfo,
  PluginLogger,
  PluginStorage,
  PluginSecrets,
  PluginHookEvent,
  PluginCapability,
} from '../../shared/types/plugin';
import type { AgentTool } from '../../shared/types/agent';

const logger = createModuleLogger('PluginAPI');

/**
 * Rate limit configuration for plugin API calls
 */
const RATE_LIMITS = {
  network: { maxRequests: 100, windowMs: 60000 }, // 100 req/min
  filesystem: { maxRequests: 50, windowMs: 60000 }, // 50 req/min
  subprocess: { maxRequests: 10, windowMs: 60000 }, // 10 req/min
  storage: { maxRequests: 200, windowMs: 60000 }, // 200 req/min
  notification: { maxRequests: 10, windowMs: 60000 }, // 10 req/min
};

/**
 * Rate limiter for plugin API calls
 */
class PluginRateLimiter {
  private buckets: Map<string, { count: number; resetAt: number }> = new Map();

  check(pluginName: string, operation: keyof typeof RATE_LIMITS): boolean {
    const key = `${pluginName}:${operation}`;
    const limit = RATE_LIMITS[operation];
    const now = Date.now();

    let bucket = this.buckets.get(key);

    if (!bucket || bucket.resetAt < now) {
      bucket = { count: 0, resetAt: now + limit.windowMs };
      this.buckets.set(key, bucket);
    }

    bucket.count++;

    if (bucket.count > limit.maxRequests) {
      logger.warn('Plugin rate limit exceeded', {
        plugin: pluginName,
        operation,
        count: bucket.count,
        limit: limit.maxRequests,
      });
      return false;
    }

    return true;
  }

  reset(pluginName: string): void {
    for (const key of this.buckets.keys()) {
      if (key.startsWith(`${pluginName}:`)) {
        this.buckets.delete(key);
      }
    }
  }
}

/**
 * Plugin Storage implementation
 * Provides isolated key-value storage for each plugin
 */
class PluginStorageImpl implements PluginStorage {
  private storagePath: string;
  private cache: Map<string, unknown> = new Map();
  private dirty: boolean = false;
  private saveDebounceTimer: NodeJS.Timeout | null = null;

  constructor(pluginName: string) {
    const storageDir = path.join(homedir(), '.atlas', 'plugins', 'storage');
    if (!existsSync(storageDir)) {
      mkdirSync(storageDir, { recursive: true });
    }
    // Sanitize plugin name for filename
    const safeName = pluginName.replace(/[^a-zA-Z0-9-_]/g, '_');
    this.storagePath = path.join(storageDir, `${safeName}.json`);
    this.loadSync();
  }

  private loadSync(): void {
    try {
      if (existsSync(this.storagePath)) {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const data = require('fs').readFileSync(this.storagePath, 'utf-8');
        const parsed = JSON.parse(data);
        this.cache = new Map(Object.entries(parsed));
      }
    } catch {
      this.cache = new Map();
    }
  }

  private scheduleSave(): void {
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
    }
    this.saveDebounceTimer = setTimeout(() => this.save(), 1000);
  }

  private async save(): Promise<void> {
    if (!this.dirty) return;

    try {
      const data = Object.fromEntries(this.cache);
      await fs.writeFile(this.storagePath, JSON.stringify(data, null, 2));
      this.dirty = false;
    } catch (error) {
      logger.error('Failed to save plugin storage', {
        path: this.storagePath,
        error: getErrorMessage(error),
      });
    }
  }

  async get<T>(key: string): Promise<T | undefined> {
    return this.cache.get(key) as T | undefined;
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.cache.set(key, value);
    this.dirty = true;
    this.scheduleSave();
  }

  async delete(key: string): Promise<void> {
    this.cache.delete(key);
    this.dirty = true;
    this.scheduleSave();
  }

  async has(key: string): Promise<boolean> {
    return this.cache.has(key);
  }

  async keys(): Promise<string[]> {
    return Array.from(this.cache.keys());
  }

  async clear(): Promise<void> {
    this.cache.clear();
    this.dirty = true;
    await this.save();
  }

  async flush(): Promise<void> {
    await this.save();
  }
}

/**
 * Plugin Secrets implementation
 * Provides secure credential storage for plugins
 */
class PluginSecretsImpl implements PluginSecrets {
  private prefix: string;

  constructor(pluginName: string) {
    // Create unique prefix for plugin secrets
    const safeName = pluginName.replace(/[^a-zA-Z0-9-_]/g, '_').toUpperCase();
    this.prefix = `PLUGIN_${safeName}_`;
  }

  async get(key: string): Promise<string | undefined> {
    try {
      // Use a type assertion since we're using a dynamic key
      const fullKey = `${this.prefix}${key}`;
      // Note: In production, this would use a dedicated plugin keychain
      // For now, we'll use a separate storage mechanism
      const storage = new PluginStorageImpl('__secrets__');
      const value = await storage.get<string>(fullKey);
      return value;
    } catch {
      return undefined;
    }
  }

  async set(key: string, value: string): Promise<void> {
    const fullKey = `${this.prefix}${key}`;
    const storage = new PluginStorageImpl('__secrets__');
    await storage.set(fullKey, value);
  }

  async delete(key: string): Promise<void> {
    const fullKey = `${this.prefix}${key}`;
    const storage = new PluginStorageImpl('__secrets__');
    await storage.delete(fullKey);
  }
}

/**
 * Plugin Logger implementation
 * Wraps Atlas logger with plugin context
 */
class PluginLoggerImpl implements PluginLogger {
  private logger: ModuleLogger;

  constructor(pluginName: string) {
    this.logger = createModuleLogger(`Plugin:${pluginName}`);
  }

  debug(message: string, ...args: unknown[]): void {
    this.logger.debug(message, this.formatArgs(args));
  }

  info(message: string, ...args: unknown[]): void {
    this.logger.info(message, this.formatArgs(args));
  }

  warn(message: string, ...args: unknown[]): void {
    this.logger.warn(message, this.formatArgs(args));
  }

  error(message: string, ...args: unknown[]): void {
    this.logger.error(message, this.formatArgs(args));
  }

  private formatArgs(args: unknown[]): Record<string, unknown> | undefined {
    if (args.length === 0) return undefined;
    if (args.length === 1 && typeof args[0] === 'object') {
      return args[0] as Record<string, unknown>;
    }
    return { args };
  }
}

/**
 * Plugin API Factory
 * Creates sandboxed API context for plugins
 */
export class PluginAPIFactory extends EventEmitter {
  private rateLimiter = new PluginRateLimiter();
  private auditLogger = getAuditLogger();
  private registeredTools: Map<string, Map<string, AgentTool>> = new Map();
  private registeredCommands: Map<string, Map<string, (...args: unknown[]) => unknown>> = new Map();
  private hookHandlers: Map<
    PluginHookEvent,
    Array<{ plugin: string; handler: (...args: unknown[]) => unknown; priority: number }>
  > = new Map();
  private exposedAPIs: Map<string, unknown> = new Map();

  /**
   * Create a plugin context for a specific plugin
   */
  createContext(manifest: PluginManifest, pluginPath: string): PluginContext {
    const pluginName = manifest.name;
    const capabilities = new Set(manifest.capabilities);

    // Initialize storage maps for this plugin
    if (!this.registeredTools.has(pluginName)) {
      this.registeredTools.set(pluginName, new Map());
    }
    if (!this.registeredCommands.has(pluginName)) {
      this.registeredCommands.set(pluginName, new Map());
    }

    // Create plugin info
    const pluginInfo: PluginInfo = {
      name: manifest.name,
      version: manifest.version,
      displayName: manifest.displayName,
      description: manifest.description,
      capabilities: manifest.capabilities,
      permission: manifest.permission,
      state: 'loading',
      path: pluginPath,
      enabled: true,
    };

    // Create the context object
    const context: PluginContext = {
      plugin: pluginInfo,
      config: manifest.defaultConfig || {},
      log: new PluginLoggerImpl(pluginName),
      storage: new PluginStorageImpl(pluginName),
      secrets: new PluginSecretsImpl(pluginName),

      registerTool: (tool: AgentTool) => {
        this.validateCapability(pluginName, capabilities, 'tools', 'registerTool');
        this.registerPluginTool(pluginName, tool);
      },

      unregisterTool: (toolName: string) => {
        this.unregisterPluginTool(pluginName, toolName);
      },

      registerCommand: (id: string, handler: (...args: unknown[]) => unknown) => {
        this.validateCapability(pluginName, capabilities, 'commands', 'registerCommand');
        this.registerPluginCommand(pluginName, id, handler);
      },

      unregisterCommand: (id: string) => {
        this.unregisterPluginCommand(pluginName, id);
      },

      subscribeHook: (
        event: PluginHookEvent,
        handler: (...args: unknown[]) => unknown,
        priority = 100
      ) => {
        this.validateCapability(pluginName, capabilities, 'hooks', 'subscribeHook');
        return this.subscribePluginHook(pluginName, event, handler, priority);
      },

      showNotification: (message: string, type = 'info') => {
        if (!this.rateLimiter.check(pluginName, 'notification')) {
          throw new Error('Rate limit exceeded for notifications');
        }
        this.emit('notification', { plugin: pluginName, message, type });
      },

      requestConfirmation: async (message: string, title?: string) => {
        return this.requestPluginConfirmation(pluginName, message, title);
      },

      getPluginAPI: <T>(targetPlugin: string): T | undefined => {
        return this.exposedAPIs.get(targetPlugin) as T | undefined;
      },

      exposeAPI: <T>(api: T) => {
        this.exposedAPIs.set(pluginName, api);
        logger.debug('Plugin exposed API', { plugin: pluginName });
      },
    };

    // Add network capability if granted
    if (capabilities.has('network')) {
      context.fetch = async (url: string, options?: RequestInit) => {
        return this.pluginFetch(pluginName, manifest, url, options);
      };
    }

    // Add filesystem capability if granted
    if (capabilities.has('filesystem')) {
      context.readFile = async (filePath: string) => {
        return this.pluginReadFile(pluginName, manifest, filePath);
      };

      context.writeFile = async (filePath: string, content: string) => {
        return this.pluginWriteFile(pluginName, manifest, filePath, content);
      };
    }

    // Add subprocess capability if granted
    if (capabilities.has('subprocess')) {
      context.executeCommand = async (
        command: string,
        options?: { cwd?: string; timeout?: number }
      ) => {
        return this.pluginExecuteCommand(pluginName, manifest, command, options);
      };
    }

    logger.info('Created plugin context', {
      plugin: pluginName,
      capabilities: Array.from(capabilities),
    });

    return context;
  }

  /**
   * Validate that plugin has required capability
   */
  private validateCapability(
    pluginName: string,
    capabilities: Set<PluginCapability>,
    required: PluginCapability,
    operation: string
  ): void {
    if (!capabilities.has(required)) {
      this.auditLogger.logAuthorization(
        `plugin:${pluginName}`,
        operation,
        false,
        `Missing capability: ${required}`
      );
      throw new Error(
        `Plugin "${pluginName}" lacks capability "${required}" for operation "${operation}"`
      );
    }
  }

  /**
   * Register a tool from a plugin
   */
  private registerPluginTool(pluginName: string, tool: AgentTool): void {
    const tools = this.registeredTools.get(pluginName)!;

    // Prefix tool name with plugin name for namespacing
    const namespacedTool: AgentTool = {
      ...tool,
      name: `${pluginName}:${tool.name}`,
      description: `[${pluginName}] ${tool.description}`,
    };

    tools.set(tool.name, namespacedTool);

    this.auditLogger.logToolExecution(namespacedTool.name, {}, true, {
      action: 'register',
      plugin: pluginName,
    });

    this.emit('tool:registered', { plugin: pluginName, tool: namespacedTool });

    logger.debug('Plugin registered tool', {
      plugin: pluginName,
      tool: tool.name,
    });
  }

  /**
   * Unregister a tool from a plugin
   */
  private unregisterPluginTool(pluginName: string, toolName: string): void {
    const tools = this.registeredTools.get(pluginName);
    if (tools?.has(toolName)) {
      tools.delete(toolName);
      this.emit('tool:unregistered', { plugin: pluginName, toolName });
      logger.debug('Plugin unregistered tool', {
        plugin: pluginName,
        tool: toolName,
      });
    }
  }

  /**
   * Register a command from a plugin
   */
  private registerPluginCommand(
    pluginName: string,
    id: string,
    handler: (...args: unknown[]) => unknown
  ): void {
    const commands = this.registeredCommands.get(pluginName)!;
    const namespacedId = `${pluginName}:${id}`;

    commands.set(id, handler);
    this.emit('command:registered', { plugin: pluginName, commandId: namespacedId });

    logger.debug('Plugin registered command', {
      plugin: pluginName,
      command: id,
    });
  }

  /**
   * Unregister a command from a plugin
   */
  private unregisterPluginCommand(pluginName: string, id: string): void {
    const commands = this.registeredCommands.get(pluginName);
    if (commands?.has(id)) {
      commands.delete(id);
      this.emit('command:unregistered', { plugin: pluginName, commandId: id });
      logger.debug('Plugin unregistered command', {
        plugin: pluginName,
        command: id,
      });
    }
  }

  /**
   * Subscribe to a hook event
   */
  private subscribePluginHook(
    pluginName: string,
    event: PluginHookEvent,
    handler: (...args: unknown[]) => unknown,
    priority: number
  ): () => void {
    if (!this.hookHandlers.has(event)) {
      this.hookHandlers.set(event, []);
    }

    const handlers = this.hookHandlers.get(event)!;
    const entry = { plugin: pluginName, handler, priority };
    handlers.push(entry);

    // Sort by priority (lower = runs first)
    handlers.sort((a, b) => a.priority - b.priority);

    logger.debug('Plugin subscribed to hook', {
      plugin: pluginName,
      event,
      priority,
    });

    // Return unsubscribe function
    return () => {
      const idx = handlers.indexOf(entry);
      if (idx !== -1) {
        handlers.splice(idx, 1);
      }
    };
  }

  /**
   * Request confirmation from user
   */
  private async requestPluginConfirmation(
    pluginName: string,
    message: string,
    title?: string
  ): Promise<boolean> {
    return new Promise((resolve) => {
      this.emit('confirmation:request', {
        plugin: pluginName,
        message,
        title: title || `Plugin: ${pluginName}`,
        resolve,
      });

      // Timeout after 30 seconds
      setTimeout(() => resolve(false), 30000);
    });
  }

  /**
   * Plugin network fetch with restrictions
   */
  private async pluginFetch(
    pluginName: string,
    manifest: PluginManifest,
    url: string,
    options?: RequestInit
  ): Promise<Response> {
    // Rate limit check
    if (!this.rateLimiter.check(pluginName, 'network')) {
      throw new Error('Rate limit exceeded for network requests');
    }

    // Validate URL
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      throw new Error('Invalid URL');
    }

    // Check allowed hosts
    const allowedHosts = manifest.security?.allowedHosts || [];
    if (
      allowedHosts.length > 0 &&
      !allowedHosts.some((h) => this.matchHost(parsedUrl.hostname, h))
    ) {
      this.auditLogger.logAuthorization(
        `plugin:${pluginName}`,
        'network:fetch',
        false,
        `Host not allowed: ${parsedUrl.hostname}`
      );
      throw new Error(`Host "${parsedUrl.hostname}" is not allowed for this plugin`);
    }

    // Block internal/localhost URLs
    if (['localhost', '127.0.0.1', '::1', '0.0.0.0'].includes(parsedUrl.hostname)) {
      throw new Error('Localhost access is not allowed');
    }

    // Block private IP ranges
    if (this.isPrivateIP(parsedUrl.hostname)) {
      throw new Error('Private network access is not allowed');
    }

    this.auditLogger.logAuthorization(
      `plugin:${pluginName}`,
      'network:fetch',
      true,
      `Fetching: ${url}`
    );

    // Perform fetch with timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      return response;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Match hostname against pattern
   */
  private matchHost(hostname: string, pattern: string): boolean {
    if (pattern === '*') return true;
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(1);
      return hostname.endsWith(suffix) || hostname === pattern.slice(2);
    }
    return hostname === pattern;
  }

  /**
   * Check if IP is private
   */
  private isPrivateIP(ip: string): boolean {
    // Check for private IP ranges
    const privateRanges = [
      /^10\./,
      /^172\.(1[6-9]|2[0-9]|3[01])\./,
      /^192\.168\./,
      /^169\.254\./,
      /^fc00:/,
      /^fd/,
      /^fe80:/,
    ];

    return privateRanges.some((r) => r.test(ip));
  }

  /**
   * Plugin file read with restrictions
   */
  private async pluginReadFile(
    pluginName: string,
    manifest: PluginManifest,
    filePath: string
  ): Promise<string> {
    // Rate limit check
    if (!this.rateLimiter.check(pluginName, 'filesystem')) {
      throw new Error('Rate limit exceeded for filesystem operations');
    }

    // Validate input
    const validation = validateInput(filePath, 'file_path');
    if (!validation.safe) {
      throw new Error(
        `Invalid file path: ${validation.threats.map((t) => t.description).join(', ')}`
      );
    }

    // Resolve path
    const resolvedPath = path.resolve(filePath);

    // Check allowed paths
    const allowedPaths = manifest.security?.allowedPaths || [];
    const pluginDir = path.join(homedir(), '.atlas', 'plugins', pluginName);
    const defaultAllowed = [pluginDir];

    const allAllowed = [...defaultAllowed, ...allowedPaths.map((p) => path.resolve(p))];

    const isAllowed = allAllowed.some((allowed) => resolvedPath.startsWith(allowed));
    if (!isAllowed) {
      this.auditLogger.logFileOperation(
        filePath,
        'read',
        false,
        `Plugin ${pluginName} access denied`
      );
      throw new Error(`Access denied: ${filePath}`);
    }

    this.auditLogger.logFileOperation(filePath, 'read', true, `Plugin: ${pluginName}`);

    return fs.readFile(resolvedPath, 'utf-8');
  }

  /**
   * Plugin file write with restrictions
   */
  private async pluginWriteFile(
    pluginName: string,
    manifest: PluginManifest,
    filePath: string,
    content: string
  ): Promise<void> {
    // Rate limit check
    if (!this.rateLimiter.check(pluginName, 'filesystem')) {
      throw new Error('Rate limit exceeded for filesystem operations');
    }

    // Validate input
    const validation = validateInput(filePath, 'file_path');
    if (!validation.safe) {
      throw new Error(
        `Invalid file path: ${validation.threats.map((t) => t.description).join(', ')}`
      );
    }

    // Resolve path
    const resolvedPath = path.resolve(filePath);

    // Plugin can only write to its own directory
    const pluginDir = path.join(homedir(), '.atlas', 'plugins', pluginName, 'data');

    if (!resolvedPath.startsWith(pluginDir)) {
      this.auditLogger.logFileOperation(
        filePath,
        'write',
        false,
        `Plugin ${pluginName} write access denied - outside plugin directory`
      );
      throw new Error(`Write access denied: plugins can only write to their data directory`);
    }

    // Ensure directory exists
    const dir = path.dirname(resolvedPath);
    if (!existsSync(dir)) {
      await fs.mkdir(dir, { recursive: true });
    }

    this.auditLogger.logFileOperation(filePath, 'write', true, `Plugin: ${pluginName}`);

    await fs.writeFile(resolvedPath, content, 'utf-8');
  }

  /**
   * Plugin command execution with sandboxing
   */
  private async pluginExecuteCommand(
    pluginName: string,
    manifest: PluginManifest,
    command: string,
    options?: { cwd?: string; timeout?: number }
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    // Rate limit check
    if (!this.rateLimiter.check(pluginName, 'subprocess')) {
      throw new Error('Rate limit exceeded for subprocess operations');
    }

    // Log the attempt
    this.auditLogger.logSandboxExecution(command, false, {
      plugin: pluginName,
      status: 'attempting',
    });

    // Use sandbox manager for execution
    const sandbox = getSandboxManager();
    const result = await sandbox.execute(command, {
      cwd: options?.cwd,
      timeout: Math.min(options?.timeout || 30000, 60000), // Max 60 seconds
      sandboxLevel: manifest.permission === 'elevated' ? 'medium' : 'strict',
    });

    this.auditLogger.logSandboxExecution(command, result.success, {
      plugin: pluginName,
      exitCode: result.data?.exitCode,
    });

    if (!result.success) {
      throw new Error(result.error || 'Command execution failed');
    }

    return {
      stdout: result.data?.stdout || '',
      stderr: result.data?.stderr || '',
      exitCode: result.data?.exitCode || 0,
    };
  }

  /**
   * Get all tools registered by plugins
   */
  getAllPluginTools(): AgentTool[] {
    const tools: AgentTool[] = [];
    for (const pluginTools of this.registeredTools.values()) {
      tools.push(...pluginTools.values());
    }
    return tools;
  }

  /**
   * Get tools for a specific plugin
   */
  getPluginTools(pluginName: string): AgentTool[] {
    const tools = this.registeredTools.get(pluginName);
    return tools ? Array.from(tools.values()) : [];
  }

  /**
   * Execute a hook event
   */
  async executeHook(event: PluginHookEvent, data: unknown): Promise<unknown> {
    const handlers = this.hookHandlers.get(event);
    if (!handlers || handlers.length === 0) {
      return data;
    }

    let result = data;
    for (const { plugin, handler, priority } of handlers) {
      try {
        const hookResult = await handler(result);
        if (hookResult !== undefined) {
          result = hookResult;
        }
      } catch (error) {
        logger.error('Hook handler error', {
          event,
          plugin,
          priority,
          error: getErrorMessage(error),
        });
      }
    }

    return result;
  }

  /**
   * Execute a plugin command
   */
  async executeCommand(commandId: string, ...args: unknown[]): Promise<unknown> {
    // Parse namespaced command ID
    const [pluginName, localId] = commandId.includes(':')
      ? commandId.split(':', 2)
      : [null, commandId];

    if (!pluginName) {
      throw new Error(`Invalid command ID: ${commandId}`);
    }

    const commands = this.registeredCommands.get(pluginName);
    if (!commands) {
      throw new Error(`Plugin not found: ${pluginName}`);
    }

    const handler = commands.get(localId);
    if (!handler) {
      throw new Error(`Command not found: ${commandId}`);
    }

    this.auditLogger.logAuthorization(
      `plugin:${pluginName}`,
      `command:${localId}`,
      true,
      `Executing command`
    );

    return handler(...args);
  }

  /**
   * Clean up resources for a plugin
   */
  cleanupPlugin(pluginName: string): void {
    // Remove registered tools
    this.registeredTools.delete(pluginName);

    // Remove registered commands
    this.registeredCommands.delete(pluginName);

    // Remove hook handlers
    for (const handlers of this.hookHandlers.values()) {
      const toRemove = handlers.filter((h) => h.plugin === pluginName);
      for (const entry of toRemove) {
        const idx = handlers.indexOf(entry);
        if (idx !== -1) {
          handlers.splice(idx, 1);
        }
      }
    }

    // Remove exposed API
    this.exposedAPIs.delete(pluginName);

    // Reset rate limiter
    this.rateLimiter.reset(pluginName);

    logger.info('Cleaned up plugin resources', { plugin: pluginName });
  }
}

// Singleton instance
let apiFactoryInstance: PluginAPIFactory | null = null;

/**
 * Get or create the singleton PluginAPIFactory instance
 */
export function getPluginAPIFactory(): PluginAPIFactory {
  if (!apiFactoryInstance) {
    apiFactoryInstance = new PluginAPIFactory();
  }
  return apiFactoryInstance;
}

/**
 * Shutdown the plugin API factory
 */
export function shutdownPluginAPIFactory(): void {
  if (apiFactoryInstance) {
    apiFactoryInstance.removeAllListeners();
    apiFactoryInstance = null;
  }
}

export default PluginAPIFactory;
