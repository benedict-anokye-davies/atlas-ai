/**
 * @fileoverview Session Tools - Cross-Session Agent Communication
 * @module agent/tools/sessions
 * @author Atlas Team
 * @since 1.0.0
 *
 * @description
 * Tools for managing and communicating between Atlas sessions. These enable:
 * - Listing active sessions (sessions_list)
 * - Reading session history (sessions_history)
 * - Sending messages to other sessions (sessions_send)
 * - Spawning child sessions (sessions_spawn)
 *
 * These tools are essential for multi-channel and multi-agent operations,
 * allowing Atlas instances to coordinate and share information.
 *
 * @see https://docs.clawd.bot/tools/sessions
 *
 * @example
 * import { sessionsListTool, sessionsSendTool } from './sessions';
 *
 * // List all active sessions
 * const sessions = await sessionsListTool.execute({});
 *
 * // Send a message to another session
 * await sessionsSendTool.execute({
 *   sessionId: 'abc123',
 *   message: 'Check completed!',
 * });
 */

import { createModuleLogger } from '../../utils/logger';
import { getSessionManager, ChannelType, SessionState } from '../../gateway/sessions';
import type { AgentTool, ActionResult } from '../index';

const logger = createModuleLogger('SessionTools');

// =============================================================================
// Sessions List Tool
// =============================================================================

/**
 * List all active sessions
 * 
 * Returns information about all Atlas sessions, including:
 * - Session ID and channel
 * - Turn count and user count
 * - Creation and last activity timestamps
 */
export const sessionsListTool: AgentTool = {
  name: 'sessions_list',
  description: `List all active Atlas sessions.

Use this tool to:
- See what sessions are currently active
- Find a session to communicate with
- Monitor session activity across channels

Returns a list of sessions with their IDs, channels, and activity info.`,

  parameters: {
    type: 'object',
    properties: {
      channel: {
        type: 'string',
        enum: ['desktop', 'webchat', 'discord', 'telegram', 'whatsapp', 'slack', 'imessage', 'email', 'api'],
        description: 'Filter by channel type (optional)',
      },
      state: {
        type: 'string',
        enum: ['active', 'paused', 'terminated'],
        description: 'Filter by session state (optional, default: active)',
      },
    },
    required: [],
  },

  async execute(params: Record<string, unknown>): Promise<ActionResult> {
    try {
      const sessionManager = getSessionManager();

      const sessions = sessionManager.list({
        channel: params.channel as ChannelType | undefined,
        state: (params.state as SessionState | undefined) || 'active',
      });

      if (sessions.length === 0) {
        return {
          success: true,
          output: 'No active sessions found.',
          data: { sessions: [] },
        };
      }

      // Format output
      const output = sessions
        .map((s) => {
          const lastActive = new Date(s.lastActivityAt).toLocaleString();
          return `- **${s.id.slice(0, 8)}...** (${s.channel})
  Identifier: ${s.identifier}
  ${s.label ? `Label: ${s.label}\n  ` : ''}State: ${s.state} | Turns: ${s.turnCount} | Users: ${s.userCount}
  Last active: ${lastActive}`;
        })
        .join('\n\n');

      logger.info('Sessions listed', { count: sessions.length });

      return {
        success: true,
        output: `Found ${sessions.length} session(s):\n\n${output}`,
        data: { sessions },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to list sessions', { error });

      return {
        success: false,
        output: `Failed to list sessions: ${errorMessage}`,
        error: errorMessage,
      };
    }
  },
};

// =============================================================================
// Sessions History Tool
// =============================================================================

/**
 * Get conversation history from a session
 * 
 * Retrieves the conversation turns from a specific session,
 * useful for understanding context or reviewing past interactions.
 */
export const sessionsHistoryTool: AgentTool = {
  name: 'sessions_history',
  description: `Get the conversation history from a specific session.

Use this tool to:
- Review what was discussed in another session
- Understand context before sending a message
- Audit session activity

Returns the most recent conversation turns from the session.`,

  parameters: {
    type: 'object',
    properties: {
      sessionId: {
        type: 'string',
        description: 'The ID of the session to get history from',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of turns to return (default: 20)',
      },
    },
    required: ['sessionId'],
  },

  async execute(params: Record<string, unknown>): Promise<ActionResult> {
    try {
      const sessionId = params.sessionId as string;
      const limit = (params.limit as number) || 20;

      const sessionManager = getSessionManager();
      const session = sessionManager.get(sessionId);

      if (!session) {
        return {
          success: false,
          output: `Session not found: ${sessionId}`,
          error: 'Session not found',
        };
      }

      const history = sessionManager.getHistory(sessionId, limit);

      if (history.length === 0) {
        return {
          success: true,
          output: `Session ${sessionId.slice(0, 8)}... has no conversation history.`,
          data: { sessionId, history: [] },
        };
      }

      // Format output
      const output = history
        .map((turn) => {
          const time = new Date(turn.timestamp).toLocaleTimeString();
          const user = turn.user?.name || 'User';
          let text = `[${time}] **${user}**: ${turn.input}`;
          if (turn.response) {
            text += `\n[${time}] **Atlas**: ${turn.response.slice(0, 200)}${turn.response.length > 200 ? '...' : ''}`;
          }
          return text;
        })
        .join('\n\n');

      logger.info('Session history retrieved', {
        sessionId: sessionId.slice(0, 8),
        turns: history.length,
      });

      return {
        success: true,
        output: `Conversation history for session ${sessionId.slice(0, 8)}... (last ${history.length} turns):\n\n${output}`,
        data: {
          sessionId,
          channel: session.config.channel,
          identifier: session.config.identifier,
          history,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to get session history', { error });

      return {
        success: false,
        output: `Failed to get session history: ${errorMessage}`,
        error: errorMessage,
      };
    }
  },
};

// =============================================================================
// Sessions Send Tool
// =============================================================================

/**
 * Send a message to another session
 * 
 * Enables cross-session communication, allowing Atlas instances
 * to coordinate and share information.
 */
export const sessionsSendTool: AgentTool = {
  name: 'sessions_send',
  description: `Send a message to another active session.

Use this tool to:
- Notify another session about something
- Share information between sessions
- Coordinate multi-channel operations
- Request action from another session

The message will appear in the target session's conversation.`,

  parameters: {
    type: 'object',
    properties: {
      sessionId: {
        type: 'string',
        description: 'The ID of the session to send to',
      },
      message: {
        type: 'string',
        description: 'The message to send',
      },
      type: {
        type: 'string',
        enum: ['message', 'request', 'notification'],
        description: 'Message type (default: message)',
      },
    },
    required: ['sessionId', 'message'],
  },

  async execute(params: Record<string, unknown>): Promise<ActionResult> {
    try {
      const sessionId = params.sessionId as string;
      const message = params.message as string;
      const type = (params.type as 'message' | 'request' | 'notification') || 'message';

      const sessionManager = getSessionManager();

      // Get current session ID from context (would be passed via agent context)
      // For now, we'll use a placeholder
      const currentSessionId = 'current-session';

      const success = sessionManager.sendToSession({
        fromSession: currentSessionId,
        toSession: sessionId,
        type,
        content: message,
      });

      if (!success) {
        return {
          success: false,
          output: `Could not send to session ${sessionId}. It may not exist or is not active.`,
          error: 'Session not found or inactive',
        };
      }

      logger.info('Message sent to session', {
        toSession: sessionId.slice(0, 8),
        type,
      });

      return {
        success: true,
        output: `Message sent to session ${sessionId.slice(0, 8)}...`,
        data: { sessionId, type, delivered: true },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to send to session', { error });

      return {
        success: false,
        output: `Failed to send message: ${errorMessage}`,
        error: errorMessage,
      };
    }
  },
};

// =============================================================================
// Sessions Spawn Tool
// =============================================================================

/**
 * Spawn a new child session
 * 
 * Creates a new session linked to the current session, useful for:
 * - Parallel task execution
 * - Delegating work to a separate context
 * - Creating channel-specific sessions
 */
export const sessionsSpawnTool: AgentTool = {
  name: 'sessions_spawn',
  description: `Spawn a new child session.

Use this tool to:
- Create a parallel session for a sub-task
- Delegate work to a separate context
- Start a session on a different channel

The spawned session is linked to the current session and can communicate with it.`,

  parameters: {
    type: 'object',
    properties: {
      channel: {
        type: 'string',
        enum: ['desktop', 'webchat', 'discord', 'telegram', 'whatsapp', 'slack', 'api'],
        description: 'Channel for the new session (optional, defaults to current)',
      },
      label: {
        type: 'string',
        description: 'Human-readable label for the session',
      },
      identifier: {
        type: 'string',
        description: 'Channel-specific identifier (optional)',
      },
      initialMessage: {
        type: 'string',
        description: 'Initial message/task for the spawned session',
      },
    },
    required: [],
  },

  async execute(params: Record<string, unknown>): Promise<ActionResult> {
    try {
      const sessionManager = getSessionManager();

      // Get current session ID from context
      const currentSessionId = 'current-session';

      const childSession = sessionManager.spawn(currentSessionId, {
        channel: params.channel as ChannelType | undefined,
        label: params.label as string | undefined,
        identifier: params.identifier as string | undefined,
      });

      // If initial message provided, add it as first turn
      if (params.initialMessage) {
        sessionManager.addTurn(childSession.id, {
          input: params.initialMessage as string,
          inputType: 'text',
        });
      }

      logger.info('Child session spawned', {
        parentId: currentSessionId.slice(0, 8),
        childId: childSession.id.slice(0, 8),
        channel: childSession.config.channel,
      });

      return {
        success: true,
        output: `Spawned new session: ${childSession.id.slice(0, 8)}...
Channel: ${childSession.config.channel}
${childSession.config.label ? `Label: ${childSession.config.label}` : ''}`,
        data: {
          sessionId: childSession.id,
          channel: childSession.config.channel,
          identifier: childSession.config.identifier,
          label: childSession.config.label,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to spawn session', { error });

      return {
        success: false,
        output: `Failed to spawn session: ${errorMessage}`,
        error: errorMessage,
      };
    }
  },
};

// =============================================================================
// Export All Tools
// =============================================================================

export const sessionTools = [
  sessionsListTool,
  sessionsHistoryTool,
  sessionsSendTool,
  sessionsSpawnTool,
];

export default sessionTools;
