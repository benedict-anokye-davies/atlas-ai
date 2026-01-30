/**
 * @fileoverview Agent tools for skill management
 * @module agent/tools/skills
 * @author Atlas Team
 * @since 1.0.0
 *
 * @description
 * Provides agent tools for discovering, installing, and managing skills.
 * Integrates with the SkillRegistry for skill lifecycle operations.
 *
 * Tools:
 * - skills_list: List installed skills
 * - skills_search: Search for skills
 * - skills_install: Install a skill
 * - skills_uninstall: Uninstall a skill
 * - skills_enable: Enable a skill
 * - skills_disable: Disable a skill
 * - skills_info: Get skill details
 */

import { createModuleLogger } from '../../utils/logger';
import { getSkillRegistry, InstalledSkill } from '../skills/skill-registry';
import type { AgentTool, ActionResult } from '../../../shared/types/agent';

const logger = createModuleLogger('tools:skills');

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Format skill info for display
 */
function formatSkillInfo(skill: InstalledSkill): Record<string, unknown> {
  // Handle different metadata formats
  const parsedMeta = skill.parsed?.metadata;
  const instanceMeta = skill.instance?.metadata;
  
  // Parsed skills use 'name', built-in skills use 'displayName'
  const name = parsedMeta?.name ?? instanceMeta?.displayName ?? skill.id;
  const author = parsedMeta?.author ?? instanceMeta?.author?.name ?? 'Unknown';

  return {
    id: skill.id,
    name,
    version: parsedMeta?.version ?? instanceMeta?.version ?? '1.0.0',
    description: parsedMeta?.description ?? instanceMeta?.description ?? '',
    author,
    tags: parsedMeta?.tags ?? instanceMeta?.tags ?? [],
    category: parsedMeta?.category ?? instanceMeta?.category,
    source: skill.source.type,
    state: skill.state,
    enabled: skill.enabled,
    installedAt: new Date(skill.installedAt).toISOString(),
    gatingOk: skill.gatingResult?.satisfied ?? true,
    gatingMissing: skill.gatingResult?.missing ?? [],
    toolCount: skill.parsed?.tools.length ?? skill.instance?.tools?.length ?? 0,
  };
}

// ============================================================================
// Tool Definitions
// ============================================================================

/**
 * List all installed skills
 */
export const skillsListTool: AgentTool = {
  name: 'skills_list',
  description:
    'List all installed skills. Can filter by state (active/installed) or category. ' +
    'Returns skill IDs, names, states, and whether they are enabled.',
  parameters: {
    type: 'object',
    properties: {
      state: {
        type: 'string',
        description: 'Filter by state: "active", "installed", or "all"',
        enum: ['active', 'installed', 'all'],
      },
      category: {
        type: 'string',
        description: 'Filter by category (e.g., "productivity", "dev")',
      },
      enabled: {
        type: 'boolean',
        description: 'Filter by enabled status',
      },
    },
    required: [],
  },

  async execute(params): Promise<ActionResult> {
    const state = params.state as string | undefined;
    const category = params.category as string | undefined;
    const enabled = params.enabled as boolean | undefined;

    logger.info('Listing skills', { state, category, enabled });

    try {
      const registry = getSkillRegistry();
      let skills = registry.listSkills();

      // Apply filters
      if (state && state !== 'all') {
        skills = skills.filter((s) => s.state === state);
      }
      if (category) {
        skills = skills.filter(
          (s) =>
            s.parsed?.metadata.category === category ||
            s.instance?.metadata.category === category
        );
      }
      if (enabled !== undefined) {
        skills = skills.filter((s) => s.enabled === enabled);
      }

      const formattedSkills = skills.map(formatSkillInfo);

      return {
        success: true,
        output: `Found ${skills.length} skill(s)`,
        data: {
          total: skills.length,
          skills: formattedSkills,
        },
      };
    } catch (error) {
      logger.error('Failed to list skills', { error });
      return {
        success: false,
        error: `Failed to list skills: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
};

/**
 * Search for skills
 */
export const skillsSearchTool: AgentTool = {
  name: 'skills_search',
  description:
    'Search for skills by name, tag, or description. ' +
    'Returns matching skills with their details.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query (matches name, tags, or description)',
      },
    },
    required: ['query'],
  },

  async execute(params): Promise<ActionResult> {
    const query = params.query as string;

    logger.info('Searching skills', { query });

    try {
      const registry = getSkillRegistry();
      const skills = registry.searchSkills(query);
      const formattedSkills = skills.map(formatSkillInfo);

      return {
        success: true,
        output: `Found ${skills.length} skill(s) matching "${query}"`,
        data: {
          query,
          total: skills.length,
          skills: formattedSkills,
        },
      };
    } catch (error) {
      logger.error('Failed to search skills', { error });
      return {
        success: false,
        error: `Failed to search skills: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
};

/**
 * Install a skill
 */
export const skillsInstallTool: AgentTool = {
  name: 'skills_install',
  description:
    'Install a skill from a local path containing a SKILL.md file. ' +
    'The skill will be checked for gating requirements before enabling.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Absolute path to the skill directory containing SKILL.md',
      },
    },
    required: ['path'],
  },

  async execute(params): Promise<ActionResult> {
    const skillPath = params.path as string;

    logger.info('Installing skill', { path: skillPath });

    try {
      const registry = getSkillRegistry();
      const installed = await registry.installFromPath(skillPath);
      const info = formatSkillInfo(installed);

      let output = `Skill "${info.name}" (${info.id}) installed successfully`;
      if (!installed.gatingResult?.satisfied) {
        output +=
          '. Note: Some gating requirements are not met - skill may have limited functionality';
      }

      return {
        success: true,
        output,
        data: info,
      };
    } catch (error) {
      logger.error('Failed to install skill', { error, path: skillPath });
      return {
        success: false,
        error: `Failed to install skill: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
};

/**
 * Uninstall a skill
 */
export const skillsUninstallTool: AgentTool = {
  name: 'skills_uninstall',
  description:
    'Uninstall an installed skill by ID. Built-in skills cannot be uninstalled.',
  parameters: {
    type: 'object',
    properties: {
      skillId: {
        type: 'string',
        description: 'ID of the skill to uninstall',
      },
    },
    required: ['skillId'],
  },

  async execute(params): Promise<ActionResult> {
    const skillId = params.skillId as string;

    logger.info('Uninstalling skill', { skillId });

    try {
      const registry = getSkillRegistry();
      await registry.uninstall(skillId);

      return {
        success: true,
        output: `Skill "${skillId}" uninstalled successfully`,
        data: { skillId },
      };
    } catch (error) {
      logger.error('Failed to uninstall skill', { error, skillId });
      return {
        success: false,
        error: `Failed to uninstall skill: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
};

/**
 * Enable a skill
 */
export const skillsEnableTool: AgentTool = {
  name: 'skills_enable',
  description:
    'Enable a disabled skill. The skill will be activated if auto-activation is on.',
  parameters: {
    type: 'object',
    properties: {
      skillId: {
        type: 'string',
        description: 'ID of the skill to enable',
      },
      activate: {
        type: 'boolean',
        description: 'Whether to also activate the skill (default: true)',
      },
    },
    required: ['skillId'],
  },

  async execute(params): Promise<ActionResult> {
    const skillId = params.skillId as string;
    const activate = params.activate !== false;

    logger.info('Enabling skill', { skillId, activate });

    try {
      const registry = getSkillRegistry();
      await registry.setEnabled(skillId, true);

      if (activate) {
        await registry.activate(skillId);
      }

      const skill = registry.getSkill(skillId);
      const info = skill ? formatSkillInfo(skill) : { id: skillId };

      return {
        success: true,
        output: `Skill "${skillId}" enabled${activate ? ' and activated' : ''}`,
        data: info,
      };
    } catch (error) {
      logger.error('Failed to enable skill', { error, skillId });
      return {
        success: false,
        error: `Failed to enable skill: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
};

/**
 * Disable a skill
 */
export const skillsDisableTool: AgentTool = {
  name: 'skills_disable',
  description: 'Disable a skill. This will also deactivate it if currently active.',
  parameters: {
    type: 'object',
    properties: {
      skillId: {
        type: 'string',
        description: 'ID of the skill to disable',
      },
    },
    required: ['skillId'],
  },

  async execute(params): Promise<ActionResult> {
    const skillId = params.skillId as string;

    logger.info('Disabling skill', { skillId });

    try {
      const registry = getSkillRegistry();
      await registry.setEnabled(skillId, false);

      return {
        success: true,
        output: `Skill "${skillId}" disabled`,
        data: { skillId },
      };
    } catch (error) {
      logger.error('Failed to disable skill', { error, skillId });
      return {
        success: false,
        error: `Failed to disable skill: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
};

/**
 * Get skill info
 */
export const skillsInfoTool: AgentTool = {
  name: 'skills_info',
  description:
    'Get detailed information about a skill including metadata, tools, gating status, and prompts.',
  parameters: {
    type: 'object',
    properties: {
      skillId: {
        type: 'string',
        description: 'ID of the skill to get info for',
      },
    },
    required: ['skillId'],
  },

  async execute(params): Promise<ActionResult> {
    const skillId = params.skillId as string;

    logger.info('Getting skill info', { skillId });

    try {
      const registry = getSkillRegistry();
      const skill = registry.getSkill(skillId);

      if (!skill) {
        return {
          success: false,
          error: `Skill not found: ${skillId}`,
        };
      }

      const info = formatSkillInfo(skill);

      // Add detailed information
      const detailed = {
        ...info,
        tools: skill.parsed?.tools.map((t) => ({
          name: t.name,
          description: t.description,
        })) ?? skill.instance?.tools?.map((t) => ({
          name: t.name,
          description: t.description,
        })) ?? [],
        prompts: skill.parsed?.prompts.map((p) => ({
          name: p.name,
          preview: p.content.slice(0, 100) + (p.content.length > 100 ? '...' : ''),
        })) ?? [],
        gating: skill.gatingResult ?? { satisfied: true, missing: [], warnings: [] },
        source: skill.source,
      };

      return {
        success: true,
        output: `Skill info for "${info.name}"`,
        data: detailed,
      };
    } catch (error) {
      logger.error('Failed to get skill info', { error, skillId });
      return {
        success: false,
        error: `Failed to get skill info: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
};

// ============================================================================
// Exports
// ============================================================================

/**
 * All skills tools
 */
export const skillsTools: AgentTool[] = [
  skillsListTool,
  skillsSearchTool,
  skillsInstallTool,
  skillsUninstallTool,
  skillsEnableTool,
  skillsDisableTool,
  skillsInfoTool,
];

/**
 * Get all skills tools
 */
export function getSkillsTools(): AgentTool[] {
  return skillsTools;
}

export default skillsTools;
