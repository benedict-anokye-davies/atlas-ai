/**
 * @fileoverview Security Tools - Agent tools for security management
 * @module agent/tools/security
 * @author Atlas Team
 * @since 1.0.0
 *
 * @description
 * Provides agent tools for managing security settings including
 * tool profiles, exec approvals, and DM pairing.
 *
 * @example
 * // Set tool profile for a session
 * await executeTool('security_set_profile', { sessionId: 'sess-1', profile: 'coding' });
 *
 * // Approve a sender
 * await executeTool('security_approve_sender', { channel: 'whatsapp', senderId: '+123' });
 */

import { AgentTool, ActionResult } from '../../../shared/types/agent';
import { createModuleLogger } from '../../utils/logger';
import {
  getToolProfileManager,
  ToolProfileType,
} from '../../security/tool-profiles';
import {
  getExecApprovals,
  ExecApprovalMode,
} from '../../security/exec-approvals';
import {
  getDMPairing,
  PairingPolicy,
} from '../../security/dm-pairing';

const logger = createModuleLogger('SecurityTools');

// ============================================================================
// Tool Profile Tools
// ============================================================================

/**
 * Set tool profile for a session
 */
export const securitySetProfileTool: AgentTool = {
  name: 'security_set_profile',
  description: 'Set the tool access profile for a session. Profiles control which tools are available.',
  parameters: {
    type: 'object',
    properties: {
      sessionId: {
        type: 'string',
        description: 'Session ID to set profile for',
      },
      profile: {
        type: 'string',
        enum: ['minimal', 'coding', 'messaging', 'automation', 'full'],
        description: 'Profile to apply (minimal, coding, messaging, automation, full)',
      },
      additionalAllow: {
        type: 'array',
        items: { type: 'string' },
        description: 'Additional tools to allow',
      },
      additionalDeny: {
        type: 'array',
        items: { type: 'string' },
        description: 'Additional tools to deny',
      },
      expiresInMinutes: {
        type: 'number',
        description: 'Profile expiration in minutes (optional)',
      },
    },
    required: ['sessionId', 'profile'],
  },

  async execute(params: Record<string, unknown>): Promise<ActionResult> {
    const sessionId = params.sessionId as string;
    const profile = params.profile as ToolProfileType;
    const additionalAllow = params.additionalAllow as string[] | undefined;
    const additionalDeny = params.additionalDeny as string[] | undefined;
    const expiresInMinutes = params.expiresInMinutes as number | undefined;

    try {
      const manager = getToolProfileManager();
      manager.setSessionProfile(sessionId, profile, {
        additionalAllow,
        additionalDeny,
        expiresIn: expiresInMinutes ? expiresInMinutes * 60000 : undefined,
      });

      const availableTools = manager.getAvailableTools(sessionId);

      logger.info('Profile set via tool', { sessionId, profile });

      return {
        success: true,
        output: `Profile "${profile}" applied to session ${sessionId}. ${availableTools.length} tools now available.`,
        data: {
          sessionId,
          profile,
          toolCount: availableTools.length,
          tools: availableTools.slice(0, 10),
        },
      };
    } catch (error) {
      logger.error('Failed to set profile', { error, sessionId, profile });
      return {
        success: false,
        error: `Failed to set profile: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  },
};

/**
 * Get available tools for a session
 */
export const securityGetToolsTool: AgentTool = {
  name: 'security_get_tools',
  description: 'Get the list of available tools for a session based on its profile',
  parameters: {
    type: 'object',
    properties: {
      sessionId: {
        type: 'string',
        description: 'Session ID to check (optional, defaults to current)',
      },
    },
    required: [],
  },

  async execute(params: Record<string, unknown>): Promise<ActionResult> {
    const sessionId = params.sessionId as string | undefined;

    try {
      const manager = getToolProfileManager();
      const profile = manager.getEffectiveProfile(sessionId);
      const tools = manager.getAvailableTools(sessionId);

      return {
        success: true,
        output: `Profile: ${profile.name}\nAvailable tools (${tools.length}): ${tools.join(', ')}`,
        data: {
          profile: profile.name,
          profileId: profile.id,
          riskLevel: profile.riskLevel,
          requiresConfirmation: profile.requireConfirmation,
          tools,
        },
      };
    } catch (error) {
      logger.error('Failed to get tools', { error, sessionId });
      return {
        success: false,
        error: `Failed to get tools: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  },
};

/**
 * List all tool profiles
 */
export const securityListProfilesTool: AgentTool = {
  name: 'security_list_profiles',
  description: 'List all available tool profiles and their configurations',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },

  async execute(): Promise<ActionResult> {
    try {
      const manager = getToolProfileManager();
      const profiles = manager.getAllProfiles();

      const profileSummaries = profiles.map(p => ({
        id: p.id,
        name: p.name,
        description: p.description,
        riskLevel: p.riskLevel,
        enabled: p.enabled,
      }));

      return {
        success: true,
        output: profiles.map(p => `- ${p.name} (${p.id}): ${p.description}`).join('\n'),
        data: { profiles: profileSummaries },
      };
    } catch (error) {
      logger.error('Failed to list profiles', { error });
      return {
        success: false,
        error: `Failed to list profiles: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  },
};

// ============================================================================
// Exec Approval Tools
// ============================================================================

/**
 * Set exec approval mode
 */
export const securitySetExecModeTool: AgentTool = {
  name: 'security_set_exec_mode',
  description: 'Set the command execution approval mode (deny, allowlist, ask, full)',
  parameters: {
    type: 'object',
    properties: {
      mode: {
        type: 'string',
        enum: ['deny', 'allowlist', 'ask', 'full'],
        description: 'Approval mode to set',
      },
    },
    required: ['mode'],
  },

  async execute(params: Record<string, unknown>): Promise<ActionResult> {
    const mode = params.mode as ExecApprovalMode;

    try {
      const approvals = getExecApprovals();
      const oldMode = approvals.getMode();
      approvals.setMode(mode);

      logger.info('Exec mode changed via tool', { oldMode, newMode: mode });

      const modeDescription =
        mode === 'deny' ? 'All commands will be blocked.' :
        mode === 'full' ? 'WARNING: All commands will be allowed without approval!' :
        mode === 'ask' ? 'User will be prompted for each command.' :
        'Only allowlisted commands will be executed.';

      return {
        success: true,
        output: `Execution mode changed from "${oldMode}" to "${mode}". ${modeDescription}`,
        data: { oldMode, newMode: mode },
      };
    } catch (error) {
      logger.error('Failed to set exec mode', { error, mode });
      return {
        success: false,
        error: `Failed to set exec mode: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  },
};

/**
 * Add command to allowlist
 */
export const securityAllowCommandTool: AgentTool = {
  name: 'security_allow_command',
  description: 'Add a command pattern to the execution allowlist',
  parameters: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'Command pattern to allow (can use regex)',
      },
      description: {
        type: 'string',
        description: 'Description of what this pattern allows',
      },
      isRegex: {
        type: 'boolean',
        description: 'Whether the pattern is a regex (default: false)',
      },
    },
    required: ['pattern', 'description'],
  },

  async execute(params: Record<string, unknown>): Promise<ActionResult> {
    const pattern = params.pattern as string;
    const description = params.description as string;
    const isRegex = (params.isRegex as boolean) ?? false;

    try {
      const approvals = getExecApprovals();
      const entry = approvals.addToAllowlist({
        pattern,
        description,
        isRegex,
        riskLevel: 'moderate',
      });

      logger.info('Command pattern added to allowlist', { pattern });

      return {
        success: true,
        output: `Command pattern added to allowlist:\n- Pattern: ${pattern}\n- Description: ${description}\n- Is Regex: ${isRegex}`,
        data: { entry },
      };
    } catch (error) {
      logger.error('Failed to add to allowlist', { error, pattern });
      return {
        success: false,
        error: `Failed to add to allowlist: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  },
};

/**
 * Block a command pattern
 */
export const securityBlockCommandTool: AgentTool = {
  name: 'security_block_command',
  description: 'Add a command pattern to the execution denylist',
  parameters: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'Command pattern to block (can use regex)',
      },
      description: {
        type: 'string',
        description: 'Description of why this pattern is blocked',
      },
      isRegex: {
        type: 'boolean',
        description: 'Whether the pattern is a regex (default: false)',
      },
    },
    required: ['pattern', 'description'],
  },

  async execute(params: Record<string, unknown>): Promise<ActionResult> {
    const pattern = params.pattern as string;
    const description = params.description as string;
    const isRegex = (params.isRegex as boolean) ?? false;

    try {
      const approvals = getExecApprovals();
      const entry = approvals.addToDenylist({
        pattern,
        description,
        isRegex,
        riskLevel: 'dangerous',
      });

      logger.info('Command pattern added to denylist', { pattern });

      return {
        success: true,
        output: `Command pattern blocked:\n- Pattern: ${pattern}\n- Reason: ${description}`,
        data: { entry },
      };
    } catch (error) {
      logger.error('Failed to add to denylist', { error, pattern });
      return {
        success: false,
        error: `Failed to add to denylist: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  },
};

// ============================================================================
// DM Pairing Tools
// ============================================================================

/**
 * Approve a message sender
 */
export const securityApproveSenderTool: AgentTool = {
  name: 'security_approve_sender',
  description: 'Approve a sender for direct messaging',
  parameters: {
    type: 'object',
    properties: {
      channel: {
        type: 'string',
        description: 'Channel type (whatsapp, telegram, discord, etc.)',
      },
      senderId: {
        type: 'string',
        description: 'Platform-specific sender ID',
      },
      notes: {
        type: 'string',
        description: 'Optional notes about approval',
      },
    },
    required: ['channel', 'senderId'],
  },

  async execute(params: Record<string, unknown>): Promise<ActionResult> {
    const channel = params.channel as string;
    const senderId = params.senderId as string;
    const notes = params.notes as string | undefined;

    try {
      const pairing = getDMPairing();
      await pairing.approveSender(channel, senderId, notes);

      logger.info('Sender approved via tool', { channel, senderId });

      return {
        success: true,
        output: `Sender ${senderId} approved on ${channel}. They can now send messages.`,
        data: { channel, senderId },
      };
    } catch (error) {
      logger.error('Failed to approve sender', { error, channel, senderId });
      return {
        success: false,
        error: `Failed to approve sender: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  },
};

/**
 * Block a message sender
 */
export const securityBlockSenderTool: AgentTool = {
  name: 'security_block_sender',
  description: 'Block a sender from direct messaging',
  parameters: {
    type: 'object',
    properties: {
      channel: {
        type: 'string',
        description: 'Channel type (whatsapp, telegram, discord, etc.)',
      },
      senderId: {
        type: 'string',
        description: 'Platform-specific sender ID',
      },
      reason: {
        type: 'string',
        description: 'Reason for blocking',
      },
    },
    required: ['channel', 'senderId'],
  },

  async execute(params: Record<string, unknown>): Promise<ActionResult> {
    const channel = params.channel as string;
    const senderId = params.senderId as string;
    const reason = params.reason as string | undefined;

    try {
      const pairing = getDMPairing();
      await pairing.blockSender(channel, senderId, reason);

      logger.info('Sender blocked via tool', { channel, senderId, reason });

      return {
        success: true,
        output: `Sender ${senderId} blocked on ${channel}. Their messages will be ignored.`,
        data: { channel, senderId, reason },
      };
    } catch (error) {
      logger.error('Failed to block sender', { error, channel, senderId });
      return {
        success: false,
        error: `Failed to block sender: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  },
};

/**
 * List pending approval requests
 */
export const securityListPendingTool: AgentTool = {
  name: 'security_list_pending',
  description: 'List pending message approval requests',
  parameters: {
    type: 'object',
    properties: {
      channel: {
        type: 'string',
        description: 'Filter by channel (optional)',
      },
    },
    required: [],
  },

  async execute(params: Record<string, unknown>): Promise<ActionResult> {
    const channel = params.channel as string | undefined;

    try {
      const pairing = getDMPairing();
      const requests = pairing.getPendingRequests(channel);

      if (requests.length === 0) {
        return {
          success: true,
          output: 'No pending message requests.',
          data: { requests: [] },
        };
      }

      const summary = requests.map(r =>
        `- ${r.displayName} (${r.channel}:${r.senderId}) - ${r.pendingMessages} pending messages`
      ).join('\n');

      return {
        success: true,
        output: `Pending approval requests:\n${summary}`,
        data: { requests },
      };
    } catch (error) {
      logger.error('Failed to list pending', { error });
      return {
        success: false,
        error: `Failed to list pending: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  },
};

/**
 * Set DM pairing policy
 */
export const securitySetPairingPolicyTool: AgentTool = {
  name: 'security_set_pairing_policy',
  description: 'Set the DM pairing policy for a channel (open, pairing, closed)',
  parameters: {
    type: 'object',
    properties: {
      channel: {
        type: 'string',
        description: 'Channel to set policy for',
      },
      policy: {
        type: 'string',
        enum: ['open', 'pairing', 'closed'],
        description: 'Policy to set (open=all, pairing=approval required, closed=pre-approved only)',
      },
    },
    required: ['channel', 'policy'],
  },

  async execute(params: Record<string, unknown>): Promise<ActionResult> {
    const channel = params.channel as string;
    const policy = params.policy as PairingPolicy;

    try {
      const pairing = getDMPairing();
      pairing.setChannelPolicy(channel, policy);

      logger.info('Pairing policy set via tool', { channel, policy });

      const policyDescription =
        policy === 'open' ? 'All senders will be accepted.' :
        policy === 'closed' ? 'Only pre-approved senders will be accepted.' :
        'Unknown senders will require approval.';

      return {
        success: true,
        output: `Channel "${channel}" policy set to "${policy}". ${policyDescription}`,
        data: { channel, policy },
      };
    } catch (error) {
      logger.error('Failed to set pairing policy', { error, channel, policy });
      return {
        success: false,
        error: `Failed to set policy: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  },
};

// ============================================================================
// Export All Tools
// ============================================================================

/**
 * All security tools
 */
export const securityTools: AgentTool[] = [
  // Tool Profile tools
  securitySetProfileTool,
  securityGetToolsTool,
  securityListProfilesTool,
  // Exec Approval tools
  securitySetExecModeTool,
  securityAllowCommandTool,
  securityBlockCommandTool,
  // DM Pairing tools
  securityApproveSenderTool,
  securityBlockSenderTool,
  securityListPendingTool,
  securitySetPairingPolicyTool,
];

/**
 * Get all security tools
 */
export function getSecurityTools(): AgentTool[] {
  return securityTools;
}
