/**
 * @fileoverview Skills Registry for managing installed skills
 * @module skills/skill-registry
 * @author Atlas Team
 * @since 1.0.0
 *
 * @description
 * Manages the installation, activation, and lifecycle of skills.
 * Supports both built-in skills and external SKILL.md-based skills.
 * Provides tools for skill discovery, installation from ClawdHub,
 * and runtime management.
 *
 * @example
 * import { getSkillRegistry } from './skill-registry';
 *
 * const registry = getSkillRegistry();
 * await registry.initialize();
 *
 * // Install a skill from path
 * await registry.installFromPath('/path/to/skill');
 *
 * // List installed skills
 * const skills = registry.listSkills();
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { app } from 'electron';
import { EventEmitter } from 'events';
import { createModuleLogger } from '../../utils/logger';
import { SkillParser, ParsedSkill, GatingCheckResult, getSkillParser } from './skill-parser';
import type { Skill, SkillState } from '../../../shared/types/skill';
import type { AgentTool } from '../../../shared/types/agent';
import { getBuiltInSkills } from './index';

const logger = createModuleLogger('skill-registry');

// ============================================================================
// Types
// ============================================================================

/**
 * Installation source for a skill
 */
export type SkillSource =
  | { type: 'builtin' }
  | { type: 'local'; path: string }
  | { type: 'clawdhub'; id: string; version: string }
  | { type: 'git'; url: string; branch?: string };

/**
 * Installed skill entry
 */
export interface InstalledSkill {
  /** Skill ID */
  id: string;
  /** Parsed SKILL.md data (for external skills) */
  parsed?: ParsedSkill;
  /** Built-in skill instance (for built-in skills) */
  instance?: Skill;
  /** Installation source */
  source: SkillSource;
  /** Installation timestamp */
  installedAt: number;
  /** Last update check */
  lastChecked?: number;
  /** Current state */
  state: SkillState;
  /** Gating check result */
  gatingResult?: GatingCheckResult;
  /** Whether skill is enabled */
  enabled: boolean;
  /** User notes/tags */
  notes?: string;
}

/**
 * Registry configuration
 */
export interface RegistryConfig {
  /** Skills directory path */
  skillsDir: string;
  /** Auto-activate skills on startup */
  autoActivate: boolean;
  /** Check gating requirements */
  checkGating: boolean;
  /** Enable ClawdHub integration */
  enableClawdHub: boolean;
  /** ClawdHub API URL */
  clawdHubUrl: string;
}

/**
 * Registry state persisted to disk
 */
interface RegistryState {
  skills: Record<string, InstalledSkill>;
  config: Partial<RegistryConfig>;
  version: number;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CONFIG: RegistryConfig = {
  skillsDir: '',
  autoActivate: true,
  checkGating: true,
  enableClawdHub: false,
  clawdHubUrl: 'https://api.clawdhub.com',
};

const STATE_VERSION = 1;
const STATE_FILENAME = 'skill-registry.json';

// ============================================================================
// SkillRegistry Class
// ============================================================================

/**
 * Central registry for managing skills.
 *
 * Handles:
 * - Loading and initializing built-in skills
 * - Installing external skills from SKILL.md files
 * - Gating requirement validation
 * - Skill lifecycle management (activate/deactivate)
 * - Tool aggregation from all active skills
 *
 * @class SkillRegistry
 * @extends EventEmitter
 *
 * @fires SkillRegistry#skill:installed - New skill installed
 * @fires SkillRegistry#skill:uninstalled - Skill removed
 * @fires SkillRegistry#skill:activated - Skill activated
 * @fires SkillRegistry#skill:deactivated - Skill deactivated
 * @fires SkillRegistry#skill:error - Skill error occurred
 *
 * @example
 * const registry = getSkillRegistry();
 * await registry.initialize();
 *
 * // Install external skill
 * const skill = await registry.installFromPath('/skills/homebridge');
 *
 * // Get tools from all active skills
 * const tools = registry.getAllTools();
 */
export class SkillRegistry extends EventEmitter {
  private config: RegistryConfig;
  private skills: Map<string, InstalledSkill> = new Map();
  private parser: SkillParser;
  private initialized = false;
  private stateFilePath: string;

  constructor(config?: Partial<RegistryConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.parser = getSkillParser();

    // Default skills directory
    if (!this.config.skillsDir) {
      this.config.skillsDir = path.join(app.getPath('userData'), 'skills');
    }

    this.stateFilePath = path.join(app.getPath('userData'), STATE_FILENAME);
  }

  // ==========================================================================
  // Initialization
  // ==========================================================================

  /**
   * Initialize the registry.
   *
   * Loads persisted state, registers built-in skills, and scans
   * the skills directory for external skills.
   *
   * @example
   * await registry.initialize();
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    logger.info('Initializing skill registry', { config: this.config });

    // Ensure skills directory exists
    await fs.mkdir(this.config.skillsDir, { recursive: true });

    // Load persisted state
    await this._loadState();

    // Register built-in skills
    await this._registerBuiltInSkills();

    // Scan for external skills
    await this._scanSkillsDirectory();

    // Auto-activate if configured
    if (this.config.autoActivate) {
      await this._autoActivateSkills();
    }

    this.initialized = true;

    logger.info('Skill registry initialized', {
      totalSkills: this.skills.size,
      activeSkills: this.getActiveSkills().length,
    });
  }

  /**
   * Shutdown the registry.
   *
   * Deactivates all skills and persists state.
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down skill registry');

    // Deactivate all skills
    for (const [id, skill] of this.skills) {
      if (skill.state === 'active') {
        await this._deactivateSkill(id);
      }
    }

    // Save state
    await this._saveState();

    this.initialized = false;
  }

  // ==========================================================================
  // Skill Installation
  // ==========================================================================

  /**
   * Install a skill from a local directory path.
   *
   * The directory should contain a SKILL.md file.
   *
   * @param dirPath - Directory containing SKILL.md
   * @returns Installed skill info
   *
   * @example
   * const skill = await registry.installFromPath('/path/to/skill');
   */
  async installFromPath(dirPath: string): Promise<InstalledSkill> {
    const skillMdPath = path.join(dirPath, 'SKILL.md');

    logger.info('Installing skill from path', { path: dirPath });

    // Parse SKILL.md
    const parsed = await this.parser.parseFile(skillMdPath);

    // Check if already installed
    if (this.skills.has(parsed.metadata.id)) {
      logger.warn('Skill already installed, updating', { id: parsed.metadata.id });
    }

    // Check gating requirements
    let gatingResult: GatingCheckResult | undefined;
    if (this.config.checkGating) {
      gatingResult = await this.parser.checkGating(parsed.gating);
      if (!gatingResult.satisfied) {
        logger.warn('Skill gating requirements not met', {
          id: parsed.metadata.id,
          missing: gatingResult.missing,
        });
      }
    }

    const installed: InstalledSkill = {
      id: parsed.metadata.id,
      parsed,
      source: { type: 'local', path: dirPath },
      installedAt: Date.now(),
      state: 'installed',
      gatingResult,
      enabled: gatingResult?.satisfied ?? true,
    };

    this.skills.set(installed.id, installed);
    await this._saveState();

    this.emit('skill:installed', installed);

    logger.info('Skill installed', {
      id: installed.id,
      name: parsed.metadata.name,
      toolCount: parsed.tools.length,
    });

    return installed;
  }

  /**
   * Install a skill from ClawdHub.
   *
   * Downloads the skill package and installs it locally.
   *
   * @param skillId - ClawdHub skill ID
   * @param version - Version to install (default: latest)
   * @returns Installed skill info
   */
  async installFromClawdHub(skillId: string, version = 'latest'): Promise<InstalledSkill> {
    if (!this.config.enableClawdHub) {
      throw new Error('ClawdHub integration is disabled');
    }

    logger.info('Installing skill from ClawdHub', { skillId, version });

    // TODO: Implement ClawdHub API integration
    // For now, throw not implemented
    throw new Error('ClawdHub installation not yet implemented');
  }

  /**
   * Install a skill from a Git repository.
   *
   * @param url - Git repository URL
   * @param branch - Branch to clone (default: main)
   * @returns Installed skill info
   */
  async installFromGit(url: string, branch = 'main'): Promise<InstalledSkill> {
    logger.info('Installing skill from Git', { url, branch });

    // TODO: Implement Git clone and install
    throw new Error('Git installation not yet implemented');
  }

  /**
   * Uninstall a skill.
   *
   * @param skillId - Skill ID to uninstall
   */
  async uninstall(skillId: string): Promise<void> {
    const skill = this.skills.get(skillId);
    if (!skill) {
      throw new Error(`Skill not found: ${skillId}`);
    }

    // Can't uninstall built-in skills
    if (skill.source.type === 'builtin') {
      throw new Error('Cannot uninstall built-in skills');
    }

    logger.info('Uninstalling skill', { skillId });

    // Deactivate first
    if (skill.state === 'active') {
      await this._deactivateSkill(skillId);
    }

    // Remove from registry
    this.skills.delete(skillId);
    await this._saveState();

    this.emit('skill:uninstalled', skillId);

    logger.info('Skill uninstalled', { skillId });
  }

  // ==========================================================================
  // Skill Activation
  // ==========================================================================

  /**
   * Activate a skill.
   *
   * @param skillId - Skill ID to activate
   */
  async activate(skillId: string): Promise<void> {
    const skill = this.skills.get(skillId);
    if (!skill) {
      throw new Error(`Skill not found: ${skillId}`);
    }

    if (!skill.enabled) {
      throw new Error(`Skill is disabled due to unmet gating requirements: ${skillId}`);
    }

    if (skill.state === 'active') {
      logger.debug('Skill already active', { skillId });
      return;
    }

    await this._activateSkill(skillId);
  }

  /**
   * Deactivate a skill.
   *
   * @param skillId - Skill ID to deactivate
   */
  async deactivate(skillId: string): Promise<void> {
    const skill = this.skills.get(skillId);
    if (!skill) {
      throw new Error(`Skill not found: ${skillId}`);
    }

    if (skill.state !== 'active') {
      logger.debug('Skill not active', { skillId });
      return;
    }

    await this._deactivateSkill(skillId);
  }

  /**
   * Enable/disable a skill.
   *
   * @param skillId - Skill ID
   * @param enabled - Whether to enable
   */
  async setEnabled(skillId: string, enabled: boolean): Promise<void> {
    const skill = this.skills.get(skillId);
    if (!skill) {
      throw new Error(`Skill not found: ${skillId}`);
    }

    skill.enabled = enabled;

    if (!enabled && skill.state === 'active') {
      await this._deactivateSkill(skillId);
    }

    await this._saveState();
  }

  // ==========================================================================
  // Skill Queries
  // ==========================================================================

  /**
   * Get a skill by ID.
   */
  getSkill(skillId: string): InstalledSkill | undefined {
    return this.skills.get(skillId);
  }

  /**
   * List all installed skills.
   */
  listSkills(): InstalledSkill[] {
    return Array.from(this.skills.values());
  }

  /**
   * Get active skills only.
   */
  getActiveSkills(): InstalledSkill[] {
    return this.listSkills().filter((s) => s.state === 'active');
  }

  /**
   * Get skills by category.
   */
  getSkillsByCategory(category: string): InstalledSkill[] {
    return this.listSkills().filter(
      (s) => s.parsed?.metadata.category === category || s.instance?.metadata.category === category
    );
  }

  /**
   * Search skills by name or tag.
   */
  searchSkills(query: string): InstalledSkill[] {
    const lower = query.toLowerCase();
    return this.listSkills().filter((s) => {
      // Handle different metadata formats
      const name = s.parsed?.metadata.name ?? s.instance?.metadata.displayName ?? '';
      const tags = s.parsed?.metadata.tags ?? s.instance?.metadata.tags ?? [];
      const desc = s.parsed?.metadata.description ?? s.instance?.metadata.description ?? '';

      return (
        name.toLowerCase().includes(lower) ||
        tags.some((t) => t.toLowerCase().includes(lower)) ||
        desc.toLowerCase().includes(lower)
      );
    });
  }

  // ==========================================================================
  // Tool Aggregation
  // ==========================================================================

  /**
   * Get all tools from active skills.
   */
  getAllTools(): AgentTool[] {
    const tools: AgentTool[] = [];

    for (const skill of this.getActiveSkills()) {
      // Built-in skills have tool instances
      if (skill.instance?.tools) {
        tools.push(...skill.instance.tools);
      }

      // External skills have tool definitions that need wrapping
      if (skill.parsed) {
        for (const toolDef of skill.parsed.tools) {
          tools.push(this._createToolFromDef(skill.id, toolDef));
        }
      }
    }

    return tools;
  }

  /**
   * Get tool by name from any active skill.
   */
  getToolByName(name: string): AgentTool | undefined {
    return this.getAllTools().find((t) => t.name === name);
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Register built-in skills.
   */
  private async _registerBuiltInSkills(): Promise<void> {
    logger.info('Registering built-in skills');

    const builtInSkills = getBuiltInSkills();

    for (const instance of builtInSkills) {
      // Initialize the skill if it has an initialize method
      if (instance.initialize) {
        await instance.initialize();
      }

      const installed: InstalledSkill = {
        id: instance.id,
        instance,
        source: { type: 'builtin' },
        installedAt: Date.now(),
        state: 'installed',
        enabled: true,
      };

      this.skills.set(installed.id, installed);
    }

    logger.info('Built-in skills registered', { count: builtInSkills.length });
  }

  /**
   * Scan skills directory for external skills.
   */
  private async _scanSkillsDirectory(): Promise<void> {
    logger.info('Scanning skills directory', { path: this.config.skillsDir });

    try {
      const parsedSkills = await this.parser.scanDirectory(this.config.skillsDir);

      for (const parsed of parsedSkills) {
        // Skip if already registered
        if (this.skills.has(parsed.metadata.id)) continue;

        // Check gating
        const gatingResult = this.config.checkGating
          ? await this.parser.checkGating(parsed.gating)
          : undefined;

        const installed: InstalledSkill = {
          id: parsed.metadata.id,
          parsed,
          source: { type: 'local', path: path.dirname(parsed.filePath) },
          installedAt: Date.now(),
          state: 'installed',
          gatingResult,
          enabled: gatingResult?.satisfied ?? true,
        };

        this.skills.set(installed.id, installed);
      }
    } catch (error) {
      logger.warn('Error scanning skills directory', { error });
    }
  }

  /**
   * Auto-activate enabled skills.
   */
  private async _autoActivateSkills(): Promise<void> {
    logger.info('Auto-activating skills');

    for (const [id, skill] of this.skills) {
      if (skill.enabled && skill.state === 'installed') {
        try {
          await this._activateSkill(id);
        } catch (error) {
          logger.error('Failed to auto-activate skill', { id, error });
          this.emit('skill:error', id, error);
        }
      }
    }
  }

  /**
   * Activate a skill by ID.
   */
  private async _activateSkill(skillId: string): Promise<void> {
    const skill = this.skills.get(skillId);
    if (!skill) return;

    logger.info('Activating skill', { skillId });

    // Built-in skills
    if (skill.instance?.activate) {
      await skill.instance.activate();
    }

    skill.state = 'active';
    await this._saveState();

    this.emit('skill:activated', skillId);

    logger.info('Skill activated', { skillId });
  }

  /**
   * Deactivate a skill by ID.
   */
  private async _deactivateSkill(skillId: string): Promise<void> {
    const skill = this.skills.get(skillId);
    if (!skill) return;

    logger.info('Deactivating skill', { skillId });

    // Built-in skills
    if (skill.instance?.deactivate) {
      await skill.instance.deactivate();
    }

    skill.state = 'installed';
    await this._saveState();

    this.emit('skill:deactivated', skillId);

    logger.info('Skill deactivated', { skillId });
  }

  /**
   * Create an AgentTool from a SKILL.md tool definition.
   */
  private _createToolFromDef(
    _skillId: string,
    toolDef: ParsedSkill['tools'][0]
  ): AgentTool {
    // Convert SKILL.md tool definition to AgentTool format
    return {
      name: toolDef.name,
      description: toolDef.description,
      parameters: {
        type: 'object' as const,
        properties: Object.fromEntries(
          Object.entries(toolDef.parameters ?? {}).map(([key, param]) => [
            key,
            {
              type: param.type,
              description: param.description,
              enum: param.enum,
            },
          ])
        ),
        required: Object.entries(toolDef.parameters ?? {})
          .filter(([, param]) => param.required)
          .map(([key]) => key),
      },
      execute: async (_params) => {
        // External skills execute through a different mechanism
        // For now, return a placeholder
        return {
          success: false,
          error: `External skill tool execution not yet implemented: ${toolDef.name}`,
        };
      },
    };
  }

  /**
   * Load persisted state from disk.
   */
  private async _loadState(): Promise<void> {
    try {
      const data = await fs.readFile(this.stateFilePath, 'utf-8');
      const state: RegistryState = JSON.parse(data);

      if (state.version !== STATE_VERSION) {
        logger.warn('State version mismatch, resetting', {
          expected: STATE_VERSION,
          actual: state.version,
        });
        return;
      }

      // Restore enabled/disabled state for skills
      for (const [id, savedSkill] of Object.entries(state.skills)) {
        const existing = this.skills.get(id);
        if (existing) {
          existing.enabled = savedSkill.enabled;
          existing.notes = savedSkill.notes;
        }
      }

      // Merge config
      this.config = { ...this.config, ...state.config };

      logger.info('State loaded from disk');
    } catch (error) {
      // File doesn't exist or is invalid - start fresh
      logger.debug('No existing state file, starting fresh', { error });
    }
  }

  /**
   * Save state to disk.
   */
  private async _saveState(): Promise<void> {
    const state: RegistryState = {
      skills: Object.fromEntries(
        Array.from(this.skills.entries()).map(([id, skill]) => [
          id,
          {
            ...skill,
            // Don't persist instance objects
            instance: undefined,
            parsed: skill.parsed
              ? {
                  ...skill.parsed,
                  // Keep only essential metadata
                }
              : undefined,
          },
        ])
      ),
      config: this.config,
      version: STATE_VERSION,
    };

    await fs.writeFile(this.stateFilePath, JSON.stringify(state, null, 2), 'utf-8');
    logger.debug('State saved to disk');
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let registryInstance: SkillRegistry | null = null;

/**
 * Get the singleton skill registry instance.
 */
export function getSkillRegistry(): SkillRegistry {
  if (!registryInstance) {
    registryInstance = new SkillRegistry();
  }
  return registryInstance;
}

/**
 * Shutdown and cleanup the registry.
 */
export async function shutdownSkillRegistry(): Promise<void> {
  if (registryInstance) {
    await registryInstance.shutdown();
    registryInstance = null;
  }
}

export default SkillRegistry;
