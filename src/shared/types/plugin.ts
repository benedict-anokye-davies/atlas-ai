/**
 * Atlas Desktop - Plugin Types
 * Type definitions for the plugin architecture
 *
 * @module plugin
 */

import type { AgentTool, ToolCategory } from './agent';

/**
 * Plugin lifecycle states
 */
export type PluginState =
  | 'unloaded'
  | 'loading'
  | 'loaded'
  | 'initializing'
  | 'active'
  | 'stopping'
  | 'stopped'
  | 'error'
  | 'disabled';

/**
 * Plugin capability declarations
 * Plugins must declare what capabilities they need/provide
 */
export type PluginCapability =
  | 'tools' // Can register agent tools
  | 'commands' // Can register voice/text commands
  | 'integrations' // Can connect to external services
  | 'ui' // Can add UI components (future)
  | 'hooks' // Can hook into pipeline events
  | 'storage' // Needs persistent storage
  | 'network' // Needs network access
  | 'filesystem' // Needs filesystem access (sandboxed)
  | 'subprocess' // Needs to spawn subprocesses (requires approval)
  | 'system'; // Needs system-level access (highly restricted)

/**
 * Plugin permission levels
 */
export type PluginPermission =
  | 'minimal' // Only basic API, no external access
  | 'standard' // Standard tools, network, limited filesystem
  | 'elevated' // More filesystem access, subprocess
  | 'full'; // Full access (requires explicit user approval)

/**
 * Plugin manifest (package.json extension)
 * This is what plugin developers define in their package.json
 */
export interface PluginManifest {
  /** Plugin unique identifier (npm-style: @scope/name or name) */
  name: string;

  /** Semantic version */
  version: string;

  /** Human-readable display name */
  displayName: string;

  /** Short description */
  description: string;

  /** Author information */
  author?:
    | string
    | {
        name: string;
        email?: string;
        url?: string;
      };

  /** License identifier (SPDX) */
  license?: string;

  /** Repository URL */
  repository?:
    | string
    | {
        type: string;
        url: string;
      };

  /** Plugin homepage/documentation URL */
  homepage?: string;

  /** Keywords for discovery */
  keywords?: string[];

  /** Plugin entry point (relative to plugin root) */
  main: string;

  /** Minimum Atlas version required */
  atlasVersion: string;

  /** Capabilities this plugin requires */
  capabilities: PluginCapability[];

  /** Permission level requested */
  permission: PluginPermission;

  /** Optional icon path (relative to plugin root) */
  icon?: string;

  /** Categories for organization */
  categories?: PluginCategory[];

  /** Plugin dependencies (other plugins) */
  pluginDependencies?: Record<string, string>;

  /** Node.js dependencies (already in node_modules) */
  dependencies?: Record<string, string>;

  /** Plugin configuration schema (JSON Schema) */
  configSchema?: PluginConfigSchema;

  /** Default configuration values */
  defaultConfig?: Record<string, unknown>;

  /** Activation events (when to load the plugin) */
  activationEvents?: PluginActivationEvent[];

  /** Contributes section - what the plugin provides */
  contributes?: PluginContributes;

  /** Security metadata */
  security?: PluginSecurityMeta;
}

/**
 * Plugin categories for organization
 */
export type PluginCategory =
  | 'productivity'
  | 'developer-tools'
  | 'communication'
  | 'media'
  | 'utilities'
  | 'integrations'
  | 'accessibility'
  | 'automation'
  | 'other';

/**
 * Plugin configuration schema (subset of JSON Schema)
 */
export interface PluginConfigSchema {
  type: 'object';
  properties: Record<string, PluginConfigProperty>;
  required?: string[];
}

/**
 * Plugin configuration property
 */
export interface PluginConfigProperty {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description?: string;
  default?: unknown;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  items?: PluginConfigProperty;
  properties?: Record<string, PluginConfigProperty>;
  format?: 'uri' | 'email' | 'password' | 'date' | 'time' | 'datetime';
  sensitive?: boolean; // Should be masked in UI
}

/**
 * Plugin activation events
 */
export type PluginActivationEvent =
  | 'startup' // Load on Atlas startup
  | 'onCommand:*' // Load when any command is invoked
  | `onCommand:${string}` // Load when specific command is invoked
  | 'onTool:*' // Load when any tool is requested
  | `onTool:${string}` // Load when specific tool is requested
  | 'onVoice' // Load when voice input starts
  | 'onIntegration:*' // Load when any integration is requested
  | `onIntegration:${string}` // Load when specific integration is requested
  | 'manual'; // Only load when explicitly requested

/**
 * What the plugin contributes/provides
 */
export interface PluginContributes {
  /** Agent tools this plugin provides */
  tools?: PluginToolContribution[];

  /** Voice/text commands this plugin provides */
  commands?: PluginCommandContribution[];

  /** External service integrations */
  integrations?: PluginIntegrationContribution[];

  /** Settings this plugin adds */
  settings?: PluginSettingContribution[];

  /** Hooks into the pipeline */
  hooks?: PluginHookContribution[];
}

/**
 * Tool contribution from a plugin
 */
export interface PluginToolContribution {
  /** Tool name (will be prefixed with plugin name) */
  name: string;

  /** Tool description */
  description: string;

  /** Tool category */
  category: ToolCategory;

  /** Whether tool requires user confirmation */
  requiresConfirmation?: boolean;

  /** Risk level */
  riskLevel?: 'low' | 'medium' | 'high';
}

/**
 * Command contribution from a plugin
 */
export interface PluginCommandContribution {
  /** Command identifier */
  id: string;

  /** Display name */
  title: string;

  /** Command description */
  description?: string;

  /** Voice trigger phrases */
  voiceTriggers?: string[];

  /** Keyboard shortcut (Electron accelerator format) */
  shortcut?: string;
}

/**
 * Integration contribution from a plugin
 */
export interface PluginIntegrationContribution {
  /** Integration identifier */
  id: string;

  /** Display name */
  name: string;

  /** Integration description */
  description?: string;

  /** Icon path */
  icon?: string;

  /** Whether OAuth is required */
  requiresAuth?: boolean;

  /** Auth type */
  authType?: 'oauth2' | 'apikey' | 'basic' | 'custom';
}

/**
 * Setting contribution from a plugin
 */
export interface PluginSettingContribution {
  /** Setting key */
  key: string;

  /** Display name */
  title: string;

  /** Description */
  description?: string;

  /** Setting type */
  type: 'string' | 'number' | 'boolean' | 'select' | 'multiselect';

  /** Default value */
  default?: unknown;

  /** Options for select/multiselect */
  options?: Array<{ value: unknown; label: string }>;
}

/**
 * Hook contribution from a plugin
 */
export interface PluginHookContribution {
  /** Hook point */
  event: PluginHookEvent;

  /** Hook priority (lower runs first) */
  priority?: number;
}

/**
 * Available hook events
 */
export type PluginHookEvent =
  | 'beforeVoiceInput'
  | 'afterVoiceInput'
  | 'beforeSTT'
  | 'afterSTT'
  | 'beforeLLM'
  | 'afterLLM'
  | 'beforeTTS'
  | 'afterTTS'
  | 'beforeToolExecution'
  | 'afterToolExecution'
  | 'onError'
  | 'onConversationStart'
  | 'onConversationEnd';

/**
 * Security metadata for plugins
 */
export interface PluginSecurityMeta {
  /** Content Security Policy for plugin */
  csp?: string;

  /** Sandbox mode to run in */
  sandbox?: 'strict' | 'standard' | 'relaxed';

  /** Allowed network hosts (for network capability) */
  allowedHosts?: string[];

  /** Allowed filesystem paths (for filesystem capability) */
  allowedPaths?: string[];

  /** Checksum for integrity verification */
  checksum?: {
    algorithm: 'sha256' | 'sha384' | 'sha512';
    value: string;
  };
}

/**
 * Runtime plugin instance interface
 * This is what the plugin exports
 */
export interface PluginInstance {
  /**
   * Called when the plugin is activated
   * @param context - Plugin context with API access
   */
  activate(context: PluginContext): Promise<void> | void;

  /**
   * Called when the plugin is deactivated
   * Cleanup resources, save state, etc.
   */
  deactivate?(): Promise<void> | void;

  /**
   * Get tools provided by this plugin
   */
  getTools?(): AgentTool[];

  /**
   * Handle a command invocation
   */
  executeCommand?(commandId: string, ...args: unknown[]): Promise<unknown>;

  /**
   * Handle a hook event
   */
  onHook?(event: PluginHookEvent, data: unknown): Promise<unknown> | unknown;

  /**
   * Called when plugin configuration changes
   */
  onConfigChange?(newConfig: Record<string, unknown>): void;
}

/**
 * Plugin context provided to plugins during activation
 * This is the sandboxed API surface available to plugins
 */
export interface PluginContext {
  /** Plugin metadata */
  readonly plugin: PluginInfo;

  /** Plugin configuration (user settings) */
  readonly config: Readonly<Record<string, unknown>>;

  /** Logging API */
  readonly log: PluginLogger;

  /** Storage API (scoped to plugin) */
  readonly storage: PluginStorage;

  /** Secrets/credentials API (scoped to plugin) */
  readonly secrets: PluginSecrets;

  /** Register tools with Atlas */
  registerTool(tool: AgentTool): void;

  /** Unregister a tool */
  unregisterTool(toolName: string): void;

  /** Register a command */
  registerCommand(id: string, handler: (...args: unknown[]) => Promise<unknown> | unknown): void;

  /** Unregister a command */
  unregisterCommand(id: string): void;

  /** Subscribe to a hook event */
  subscribeHook(
    event: PluginHookEvent,
    handler: (data: unknown) => Promise<unknown> | unknown,
    priority?: number
  ): () => void;

  /** Show a notification to the user */
  showNotification(message: string, type?: 'info' | 'warning' | 'error'): void;

  /** Request user confirmation */
  requestConfirmation(message: string, title?: string): Promise<boolean>;

  /** Get another plugin's API (if exposed) */
  getPluginAPI<T>(pluginName: string): T | undefined;

  /** Expose an API for other plugins */
  exposeAPI<T>(api: T): void;

  /** Fetch URL (network access required) */
  fetch?(url: string, options?: RequestInit): Promise<Response>;

  /** Read file (filesystem access required) */
  readFile?(path: string): Promise<string>;

  /** Write file (filesystem access required) */
  writeFile?(path: string, content: string): Promise<void>;

  /** Execute shell command (subprocess access required) */
  executeCommand?(
    command: string,
    options?: { cwd?: string; timeout?: number }
  ): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
  }>;
}

/**
 * Plugin information (subset of manifest for runtime)
 */
export interface PluginInfo {
  name: string;
  version: string;
  displayName: string;
  description: string;
  capabilities: PluginCapability[];
  permission: PluginPermission;
  state: PluginState;
  path: string;
  enabled: boolean;
}

/**
 * Plugin logger interface
 */
export interface PluginLogger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

/**
 * Plugin storage interface
 */
export interface PluginStorage {
  /** Get a value from storage */
  get<T>(key: string): Promise<T | undefined>;

  /** Set a value in storage */
  set<T>(key: string, value: T): Promise<void>;

  /** Delete a value from storage */
  delete(key: string): Promise<void>;

  /** Check if a key exists */
  has(key: string): Promise<boolean>;

  /** Get all keys */
  keys(): Promise<string[]>;

  /** Clear all storage */
  clear(): Promise<void>;
}

/**
 * Plugin secrets interface
 */
export interface PluginSecrets {
  /** Get a secret */
  get(key: string): Promise<string | undefined>;

  /** Store a secret */
  set(key: string, value: string): Promise<void>;

  /** Delete a secret */
  delete(key: string): Promise<void>;
}

/**
 * Plugin load result
 */
export interface PluginLoadResult {
  success: boolean;
  plugin?: PluginInfo;
  error?: string;
  warnings?: string[];
}

/**
 * Plugin registry entry (internal state)
 */
export interface PluginRegistryEntry {
  manifest: PluginManifest;
  info: PluginInfo;
  instance?: PluginInstance;
  context?: PluginContext;
  tools: string[]; // Tool names registered by this plugin
  commands: string[]; // Command IDs registered by this plugin
  hooks: Map<
    PluginHookEvent,
    Array<{ handler: (...args: unknown[]) => unknown; priority: number }>
  >;
  exposedAPI?: unknown;
  loadError?: string;
  lastError?: string;
  loadedAt?: number;
  activatedAt?: number;
}

/**
 * Plugin manager events
 */
export interface PluginManagerEvents {
  'plugin:discovered': { manifest: PluginManifest; path: string };
  'plugin:loading': { name: string };
  'plugin:loaded': { plugin: PluginInfo };
  'plugin:activated': { plugin: PluginInfo };
  'plugin:deactivated': { plugin: PluginInfo };
  'plugin:error': { name: string; error: string };
  'plugin:unloaded': { name: string };
  'plugin:enabled': { name: string };
  'plugin:disabled': { name: string };
  'plugin:configChanged': { name: string; config: Record<string, unknown> };
}

/**
 * Plugin settings (stored in Atlas config)
 */
export interface PluginSettings {
  /** Whether plugins are enabled globally */
  enabled: boolean;

  /** Directory for plugins */
  pluginsDir: string;

  /** List of disabled plugins (by name) */
  disabledPlugins: string[];

  /** Per-plugin configuration */
  pluginConfig: Record<string, Record<string, unknown>>;

  /** Per-plugin permission overrides */
  permissionOverrides: Record<string, PluginPermission>;

  /** Trusted plugin sources */
  trustedSources: string[];

  /** Whether to auto-update plugins */
  autoUpdate: boolean;
}

/**
 * Default plugin settings
 */
export const DEFAULT_PLUGIN_SETTINGS: PluginSettings = {
  enabled: true,
  pluginsDir: '~/.atlas/plugins',
  disabledPlugins: [],
  pluginConfig: {},
  permissionOverrides: {},
  trustedSources: [],
  autoUpdate: false,
};

/**
 * Plugin validation result
 */
export interface PluginValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  manifest?: PluginManifest;
}

/**
 * Plugin discovery result
 */
export interface PluginDiscoveryResult {
  plugins: Array<{
    path: string;
    manifest: PluginManifest;
    validation: PluginValidationResult;
  }>;
  errors: Array<{
    path: string;
    error: string;
  }>;
}
