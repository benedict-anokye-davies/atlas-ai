/**
 * @fileoverview Tool Profiles - Configurable tool access control system
 * @module security/tool-profiles
 * @author Atlas Team
 * @since 1.0.0
 *
 * @description
 * Provides granular control over which tools are available in different contexts.
 * Supports predefined profiles (minimal, coding, messaging, full) and custom
 * per-channel/per-session configurations.
 *
 * Reference: Clawdbot security model for tool gating
 *
 * @example
 * const profileManager = getToolProfileManager();
 * const tools = profileManager.getAvailableTools('coding');
 * const canUse = profileManager.isToolAllowed('exec', 'session-123');
 */

import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as path from 'path';
import { app } from 'electron';
import { createModuleLogger } from '../utils/logger';
import { getAuditLogger, AuditLogger } from './audit-logger';

const logger = createModuleLogger('ToolProfiles');

// ============================================================================
// Types
// ============================================================================

/**
 * Predefined tool profile types
 */
export type ToolProfileType = 'minimal' | 'coding' | 'messaging' | 'automation' | 'full' | 'custom';

/**
 * Tool group definitions for easy profile configuration
 */
export type ToolGroup =
  | 'group:fs'          // File system tools (read, write, edit, list)
  | 'group:runtime'     // Execution tools (exec, process)
  | 'group:sessions'    // Session management
  | 'group:memory'      // Memory/RAG tools
  | 'group:messaging'   // Channel messaging
  | 'group:web'         // Web search and fetch
  | 'group:browser'     // Browser automation
  | 'group:canvas'      // Canvas/A2UI tools
  | 'group:cron'        // Scheduled tasks
  | 'group:nodes'       // Companion device control
  | 'group:git';        // Git operations

/**
 * Individual tool or group reference
 */
export type ToolReference = string | ToolGroup;

/**
 * Tool profile configuration
 */
export interface ToolProfile {
  /** Profile identifier */
  id: string;

  /** Human-readable name */
  name: string;

  /** Profile description */
  description: string;

  /** Base profile to extend (inherits tools) */
  extends?: ToolProfileType;

  /** Tools to include (can use wildcards and groups) */
  allow: ToolReference[];

  /** Tools to explicitly deny (overrides allow) */
  deny: ToolReference[];

  /** Whether this profile requires user confirmation for tools */
  requireConfirmation: boolean;

  /** Maximum operations per minute (0 = unlimited) */
  rateLimit: number;

  /** Risk level of this profile */
  riskLevel: 'safe' | 'moderate' | 'elevated' | 'dangerous';

  /** Whether profile is active */
  enabled: boolean;

  /** Creation timestamp */
  createdAt: number;

  /** Last modified timestamp */
  updatedAt: number;
}

/**
 * Session-specific tool override
 */
export interface SessionToolOverride {
  sessionId: string;
  channelId?: string;
  profileId: string;
  additionalAllow?: string[];
  additionalDeny?: string[];
  expiresAt?: number;
}

/**
 * Tool profile manager configuration
 */
export interface ToolProfileManagerConfig {
  /** Default profile for new sessions */
  defaultProfile: ToolProfileType;

  /** Whether to allow custom profiles */
  allowCustomProfiles: boolean;

  /** Path to persist profiles */
  profilesPath?: string;

  /** Auto-save profiles on change */
  autoSave: boolean;
}

/**
 * Tool profile manager events
 */
export interface ToolProfileManagerEvents {
  'profile:created': (profile: ToolProfile) => void;
  'profile:updated': (profile: ToolProfile) => void;
  'profile:deleted': (profileId: string) => void;
  'access:granted': (tool: string, sessionId: string, profile: string) => void;
  'access:denied': (tool: string, sessionId: string, reason: string) => void;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Tool group to individual tools mapping
 */
export const TOOL_GROUP_MAPPINGS: Record<ToolGroup, string[]> = {
  'group:fs': ['read', 'write', 'edit', 'list_dir', 'delete', 'move', 'copy'],
  'group:runtime': ['exec', 'process_list', 'process_kill', 'process_start'],
  'group:sessions': ['sessions_list', 'sessions_history', 'sessions_send', 'sessions_spawn'],
  'group:memory': ['memory_search', 'memory_store', 'memory_recall', 'memory_forget'],
  'group:messaging': ['message_send', 'channel_list', 'channel_connect', 'channel_disconnect', 'message_typing', 'message_react'],
  'group:web': ['web_search', 'web_fetch'],
  'group:browser': ['browser_navigate', 'browser_screenshot', 'browser_click', 'browser_type', 'browser_scroll', 'browser_close'],
  'group:canvas': ['canvas_render', 'canvas_form', 'canvas_table', 'canvas_chart', 'canvas_snapshot', 'canvas_clear', 'canvas_close'],
  'group:cron': ['cron_schedule', 'cron_list', 'cron_cancel', 'cron_run'],
  'group:nodes': ['nodes_list', 'nodes_invoke', 'nodes_approve', 'nodes_reject', 'nodes_notify'],
  'group:git': ['git_status', 'git_commit', 'git_push', 'git_pull', 'git_branch', 'git_log'],
};

/**
 * Predefined tool profiles
 */
export const PREDEFINED_PROFILES: Record<ToolProfileType, Omit<ToolProfile, 'id' | 'createdAt' | 'updatedAt'>> = {
  minimal: {
    name: 'Minimal',
    description: 'Basic status and information tools only',
    allow: ['session_status', 'atlas_info', 'help'],
    deny: [],
    requireConfirmation: false,
    rateLimit: 10,
    riskLevel: 'safe',
    enabled: true,
  },
  coding: {
    name: 'Coding Assistant',
    description: 'Full development tools for coding tasks',
    allow: [
      'group:fs',
      'group:runtime',
      'group:sessions',
      'group:memory',
      'group:git',
      'group:web',
      'image',
    ],
    deny: [],
    requireConfirmation: false,
    rateLimit: 60,
    riskLevel: 'moderate',
    enabled: true,
  },
  messaging: {
    name: 'Messaging',
    description: 'Communication and messaging tools',
    allow: [
      'group:messaging',
      'sessions_list',
      'sessions_history',
      'sessions_send',
      'group:memory',
    ],
    deny: ['group:fs', 'group:runtime'],
    requireConfirmation: false,
    rateLimit: 30,
    riskLevel: 'safe',
    enabled: true,
  },
  automation: {
    name: 'Automation',
    description: 'Browser and canvas automation tools',
    allow: [
      'group:browser',
      'group:canvas',
      'group:cron',
      'group:web',
      'group:fs',
    ],
    deny: [],
    requireConfirmation: true,
    rateLimit: 30,
    riskLevel: 'elevated',
    enabled: true,
  },
  full: {
    name: 'Full Access',
    description: 'All tools enabled - use with caution',
    allow: ['*'],
    deny: [],
    requireConfirmation: true,
    rateLimit: 0,
    riskLevel: 'dangerous',
    enabled: true,
  },
  custom: {
    name: 'Custom',
    description: 'User-defined tool profile',
    allow: [],
    deny: [],
    requireConfirmation: false,
    rateLimit: 30,
    riskLevel: 'moderate',
    enabled: true,
  },
};

/**
 * Default manager configuration
 */
export const DEFAULT_TOOL_PROFILE_CONFIG: ToolProfileManagerConfig = {
  defaultProfile: 'coding',
  allowCustomProfiles: true,
  autoSave: true,
};

// ============================================================================
// Tool Profile Manager
// ============================================================================

/**
 * Manages tool access profiles for different sessions and channels.
 *
 * Provides granular control over which tools are available, supporting
 * predefined profiles, custom configurations, and per-session overrides.
 *
 * @class ToolProfileManager
 * @extends EventEmitter
 *
 * @example
 * const manager = getToolProfileManager();
 *
 * // Check if a tool is allowed for a session
 * if (manager.isToolAllowed('exec', 'session-123')) {
 *   await executeTool('exec', params);
 * }
 *
 * // Set a profile for a session
 * manager.setSessionProfile('session-123', 'messaging');
 */
export class ToolProfileManager extends EventEmitter {
  private config: ToolProfileManagerConfig;
  private profiles: Map<string, ToolProfile> = new Map();
  private sessionOverrides: Map<string, SessionToolOverride> = new Map();
  private channelProfiles: Map<string, string> = new Map(); // channelId -> profileId
  private auditLogger: AuditLogger;
  private initialized = false;
  private profilesPath: string;

  constructor(config?: Partial<ToolProfileManagerConfig>) {
    super();
    this.config = { ...DEFAULT_TOOL_PROFILE_CONFIG, ...config };
    this.profilesPath = config?.profilesPath ?? path.join(app.getPath('userData'), 'tool-profiles.json');
    this.auditLogger = getAuditLogger();

    // Initialize predefined profiles
    this._initializePredefinedProfiles();

    logger.info('ToolProfileManager initialized', {
      defaultProfile: this.config.defaultProfile,
      profileCount: this.profiles.size,
    });
  }

  /**
   * Initialize predefined profiles
   */
  private _initializePredefinedProfiles(): void {
    const now = Date.now();
    for (const [id, profile] of Object.entries(PREDEFINED_PROFILES)) {
      this.profiles.set(id, {
        ...profile,
        id,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  /**
   * Load persisted profiles from disk
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      const data = await fs.readFile(this.profilesPath, 'utf-8');
      const savedProfiles = JSON.parse(data) as { profiles: ToolProfile[]; sessionOverrides: SessionToolOverride[] };

      // Merge saved custom profiles
      for (const profile of savedProfiles.profiles) {
        if (!PREDEFINED_PROFILES[profile.id as ToolProfileType]) {
          this.profiles.set(profile.id, profile);
        }
      }

      // Restore session overrides
      for (const override of savedProfiles.sessionOverrides) {
        if (!override.expiresAt || override.expiresAt > Date.now()) {
          this.sessionOverrides.set(override.sessionId, override);
        }
      }

      logger.info('Loaded persisted profiles', {
        customProfiles: savedProfiles.profiles.length,
        sessionOverrides: savedProfiles.sessionOverrides.length,
      });
    } catch {
      // File doesn't exist yet, that's OK
      logger.debug('No persisted profiles found');
    }

    this.initialized = true;
  }

  /**
   * Save profiles to disk
   */
  async save(): Promise<void> {
    if (!this.config.autoSave) return;

    const customProfiles = Array.from(this.profiles.values())
      .filter(p => !PREDEFINED_PROFILES[p.id as ToolProfileType]);

    const data = {
      profiles: customProfiles,
      sessionOverrides: Array.from(this.sessionOverrides.values()),
    };

    await fs.mkdir(path.dirname(this.profilesPath), { recursive: true });
    await fs.writeFile(this.profilesPath, JSON.stringify(data, null, 2));

    logger.debug('Saved profiles to disk');
  }

  /**
   * Expand tool references to individual tools
   * Handles groups, wildcards, and individual tools
   */
  private _expandToolReferences(references: ToolReference[]): Set<string> {
    const tools = new Set<string>();

    for (const ref of references) {
      if (ref === '*') {
        // Wildcard - add all known tools
        for (const groupTools of Object.values(TOOL_GROUP_MAPPINGS)) {
          groupTools.forEach(t => tools.add(t));
        }
      } else if (ref.startsWith('group:')) {
        // Tool group
        const groupTools = TOOL_GROUP_MAPPINGS[ref as ToolGroup];
        if (groupTools) {
          groupTools.forEach(t => tools.add(t));
        }
      } else {
        // Individual tool
        tools.add(ref);
      }
    }

    return tools;
  }

  /**
   * Get the effective profile for a session
   */
  getEffectiveProfile(sessionId?: string): ToolProfile {
    // Check for session override first
    if (sessionId) {
      const override = this.sessionOverrides.get(sessionId);
      if (override && (!override.expiresAt || override.expiresAt > Date.now())) {
        const profile = this.profiles.get(override.profileId);
        if (profile) return profile;
      }
    }

    // Fall back to default profile
    return this.profiles.get(this.config.defaultProfile) ?? this.profiles.get('minimal')!;
  }

  /**
   * Check if a tool is allowed for a session
   */
  isToolAllowed(toolName: string, sessionId?: string): boolean {
    const profile = this.getEffectiveProfile(sessionId);
    const override = sessionId ? this.sessionOverrides.get(sessionId) : undefined;

    // Expand allow and deny lists
    const allowedTools = this._expandToolReferences(profile.allow);
    const deniedTools = this._expandToolReferences(profile.deny);

    // Apply session-specific overrides
    if (override?.additionalAllow) {
      override.additionalAllow.forEach(t => allowedTools.add(t));
    }
    if (override?.additionalDeny) {
      override.additionalDeny.forEach(t => deniedTools.add(t));
    }

    // Deny list takes precedence
    if (deniedTools.has(toolName)) {
      logger.debug('Tool denied by profile', { toolName, profile: profile.id, sessionId });
      this.emit('access:denied', toolName, sessionId ?? 'default', 'denied by profile');

      this.auditLogger.log(
        'authorization',
        'warning',
        `Tool access denied: ${toolName}`,
        {
          action: 'tool_access_denied',
          allowed: false,
          reason: 'explicit_deny',
          source: 'tool-profiles',
          sessionId,
          context: {
            toolName,
            profileId: profile.id,
          },
        }
      );

      return false;
    }

    // Check allow list
    const allowed = allowedTools.has(toolName) || allowedTools.has('*');

    if (allowed) {
      this.emit('access:granted', toolName, sessionId ?? 'default', profile.id);
    } else {
      logger.debug('Tool not in allow list', { toolName, profile: profile.id, sessionId });
      this.emit('access:denied', toolName, sessionId ?? 'default', 'not in allow list');

      this.auditLogger.log(
        'authorization',
        'info',
        `Tool not in allow list: ${toolName}`,
        {
          action: 'tool_access_denied',
          allowed: false,
          reason: 'not_allowed',
          source: 'tool-profiles',
          sessionId,
          context: {
            toolName,
            profileId: profile.id,
          },
        }
      );
    }

    return allowed;
  }

  /**
   * Get list of available tools for a session
   */
  getAvailableTools(sessionId?: string): string[] {
    const profile = this.getEffectiveProfile(sessionId);
    const override = sessionId ? this.sessionOverrides.get(sessionId) : undefined;

    const allowedTools = this._expandToolReferences(profile.allow);
    const deniedTools = this._expandToolReferences(profile.deny);

    // Apply overrides
    if (override?.additionalAllow) {
      override.additionalAllow.forEach(t => allowedTools.add(t));
    }
    if (override?.additionalDeny) {
      override.additionalDeny.forEach(t => deniedTools.add(t));
    }

    // Remove denied tools
    for (const denied of deniedTools) {
      allowedTools.delete(denied);
    }

    return Array.from(allowedTools).sort();
  }

  /**
   * Set profile for a session
   */
  setSessionProfile(
    sessionId: string,
    profileId: string,
    options?: {
      additionalAllow?: string[];
      additionalDeny?: string[];
      channelId?: string;
      expiresIn?: number;
    }
  ): void {
    if (!this.profiles.has(profileId)) {
      throw new Error(`Profile not found: ${profileId}`);
    }

    const override: SessionToolOverride = {
      sessionId,
      profileId,
      channelId: options?.channelId,
      additionalAllow: options?.additionalAllow,
      additionalDeny: options?.additionalDeny,
      expiresAt: options?.expiresIn ? Date.now() + options.expiresIn : undefined,
    };

    this.sessionOverrides.set(sessionId, override);

    logger.info('Session profile set', {
      sessionId,
      profileId,
      expiresAt: override.expiresAt,
    });

    this.auditLogger.log(
      'authorization',
      'info',
      `Profile assigned: ${profileId} to session ${sessionId}`,
      {
        action: 'profile_assigned',
        allowed: true,
        source: 'tool-profiles',
        sessionId,
        context: {
          profileId,
          channelId: options?.channelId,
          expiresAt: override.expiresAt,
        },
      }
    );

    void this.save();
  }

  /**
   * Clear session profile override
   */
  clearSessionProfile(sessionId: string): void {
    this.sessionOverrides.delete(sessionId);
    logger.debug('Session profile cleared', { sessionId });
    void this.save();
  }

  /**
   * Set default profile for a channel
   */
  setChannelProfile(channelId: string, profileId: string): void {
    if (!this.profiles.has(profileId)) {
      throw new Error(`Profile not found: ${profileId}`);
    }

    this.channelProfiles.set(channelId, profileId);

    logger.info('Channel profile set', { channelId, profileId });
    void this.save();
  }

  /**
   * Create a custom profile
   */
  createProfile(profile: Omit<ToolProfile, 'id' | 'createdAt' | 'updatedAt'>): ToolProfile {
    if (!this.config.allowCustomProfiles) {
      throw new Error('Custom profiles are disabled');
    }

    const now = Date.now();
    const id = `custom-${now.toString(36)}`;

    const newProfile: ToolProfile = {
      ...profile,
      id,
      createdAt: now,
      updatedAt: now,
    };

    this.profiles.set(id, newProfile);
    this.emit('profile:created', newProfile);

    logger.info('Custom profile created', { id, name: profile.name });

    this.auditLogger.log(
      'authorization',
      'info',
      `Custom profile created: ${profile.name}`,
      {
        action: 'profile_created',
        allowed: true,
        source: 'tool-profiles',
        context: {
          profileId: id,
          profileName: profile.name,
          riskLevel: profile.riskLevel,
        },
      }
    );

    void this.save();

    return newProfile;
  }

  /**
   * Update an existing profile
   */
  updateProfile(profileId: string, updates: Partial<Omit<ToolProfile, 'id' | 'createdAt'>>): ToolProfile {
    const existing = this.profiles.get(profileId);
    if (!existing) {
      throw new Error(`Profile not found: ${profileId}`);
    }

    // Don't allow modifying predefined profiles
    if (PREDEFINED_PROFILES[profileId as ToolProfileType]) {
      throw new Error('Cannot modify predefined profiles');
    }

    const updated: ToolProfile = {
      ...existing,
      ...updates,
      updatedAt: Date.now(),
    };

    this.profiles.set(profileId, updated);
    this.emit('profile:updated', updated);

    logger.info('Profile updated', { profileId });
    void this.save();

    return updated;
  }

  /**
   * Delete a custom profile
   */
  deleteProfile(profileId: string): void {
    if (PREDEFINED_PROFILES[profileId as ToolProfileType]) {
      throw new Error('Cannot delete predefined profiles');
    }

    if (!this.profiles.has(profileId)) {
      throw new Error(`Profile not found: ${profileId}`);
    }

    this.profiles.delete(profileId);
    this.emit('profile:deleted', profileId);

    // Clear any sessions using this profile
    for (const [sessionId, override] of this.sessionOverrides) {
      if (override.profileId === profileId) {
        this.sessionOverrides.delete(sessionId);
      }
    }

    logger.info('Profile deleted', { profileId });
    void this.save();
  }

  /**
   * Get all profiles
   */
  getAllProfiles(): ToolProfile[] {
    return Array.from(this.profiles.values());
  }

  /**
   * Get profile by ID
   */
  getProfile(profileId: string): ToolProfile | undefined {
    return this.profiles.get(profileId);
  }

  /**
   * Check if profile requires confirmation for tool execution
   */
  requiresConfirmation(sessionId?: string): boolean {
    return this.getEffectiveProfile(sessionId).requireConfirmation;
  }

  /**
   * Get rate limit for session
   */
  getRateLimit(sessionId?: string): number {
    return this.getEffectiveProfile(sessionId).rateLimit;
  }

  /**
   * Cleanup expired overrides
   */
  cleanup(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [sessionId, override] of this.sessionOverrides) {
      if (override.expiresAt && override.expiresAt < now) {
        this.sessionOverrides.delete(sessionId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.debug('Cleaned expired session overrides', { count: cleaned });
      void this.save();
    }
  }

  /**
   * Shutdown manager
   */
  async shutdown(): Promise<void> {
    await this.save();
    this.profiles.clear();
    this.sessionOverrides.clear();
    this.channelProfiles.clear();
    logger.info('ToolProfileManager shutdown');
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let instance: ToolProfileManager | null = null;

/**
 * Get the singleton ToolProfileManager instance
 */
export function getToolProfileManager(): ToolProfileManager {
  if (!instance) {
    instance = new ToolProfileManager();
  }
  return instance;
}

/**
 * Shutdown the ToolProfileManager
 */
export async function shutdownToolProfileManager(): Promise<void> {
  if (instance) {
    await instance.shutdown();
    instance = null;
  }
}
