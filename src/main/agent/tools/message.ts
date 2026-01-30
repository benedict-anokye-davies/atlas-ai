/**
 * @fileoverview Messaging Tools for Multi-Channel Communication
 * @module agent/tools/message
 * @author Atlas Team
 * @since 1.0.0
 *
 * @description
 * Provides agent tools for sending messages across multiple channels.
 * Integrates with the ChannelManager to support Desktop, WebChat,
 * Telegram, Discord, WhatsApp, and Slack.
 *
 * @example
 * ```typescript
 * // Send a message via Telegram
 * await messageSendTool.execute({
 *   channel: 'telegram',
 *   chatId: '123456789',
 *   content: 'Hello from Atlas!',
 * });
 * ```
 */

import type { AgentTool, ActionResult } from '../../../shared/types/agent';
import { getChannelManager, type SendOptions } from '../../channels';
import type { ChannelType } from '../../../shared/types/gateway';
import { createModuleLogger } from '../../utils/logger';

const logger = createModuleLogger('MessageTools');

// =============================================================================
// Message Send Tool
// =============================================================================

/**
 * Tool to send a message to any connected channel.
 */
export const messageSendTool: AgentTool = {
  name: 'message_send',
  description: `Send a message to a connected channel. Atlas can communicate across multiple platforms:
- desktop: Native desktop app (always connected)
- webchat: Browser-based chat widget
- telegram: Telegram Bot
- discord: Discord Bot
- whatsapp: WhatsApp (linked via QR)
- slack: Slack workspace

Use the channel-specific chatId/conversationId to target the recipient.`,

  parameters: {
    type: 'object',
    properties: {
      channel: {
        type: 'string',
        description: 'The channel to send the message on',
        enum: ['desktop', 'webchat', 'telegram', 'discord', 'whatsapp', 'slack'],
      },
      chatId: {
        type: 'string',
        description: 'The chat/conversation ID (channel-specific)',
      },
      content: {
        type: 'string',
        description: 'The message content to send',
      },
      replyTo: {
        type: 'string',
        description: 'Message ID to reply to (optional)',
      },
      parseMode: {
        type: 'string',
        description: 'Text formatting mode',
        enum: ['text', 'markdown', 'html'],
        default: 'text',
      },
      silent: {
        type: 'boolean',
        description: 'Send without notification sound',
        default: false,
      },
    },
    required: ['channel', 'chatId', 'content'],
  },

  async execute(params: Record<string, unknown>): Promise<ActionResult> {
    try {
      const channel = params.channel as ChannelType;
      const chatId = params.chatId as string;
      const content = params.content as string;
      const replyTo = params.replyTo as string | undefined;
      const parseMode = (params.parseMode as 'text' | 'markdown' | 'html') || 'text';
      const silent = params.silent === true;

      if (!channel || !chatId || !content) {
        return {
          success: false,
          output: 'channel, chatId, and content are required',
          error: 'Missing parameters',
        };
      }

      logger.info('Sending message', { channel, chatId, contentLength: content.length });

      const channelManager = getChannelManager();

      // Check if channel is connected
      const connectedChannels = channelManager.getConnectedChannels();
      if (!connectedChannels.includes(channel)) {
        return {
          success: false,
          output: `Channel "${channel}" is not connected. Connected channels: ${connectedChannels.join(', ') || 'none'}`,
          error: 'Channel not connected',
        };
      }

      const options: SendOptions = {
        replyTo,
        parseMode,
        silent,
      };

      const messageId = await channelManager.send(channel, chatId, content, options);

      return {
        success: true,
        output: `✅ Message sent to ${channel}:${chatId}\nMessage ID: ${messageId}`,
        data: {
          channel,
          chatId,
          messageId,
          contentLength: content.length,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to send message', { error });

      return {
        success: false,
        output: `Failed to send message: ${errorMessage}`,
        error: errorMessage,
      };
    }
  },
};

// =============================================================================
// Channel List Tool
// =============================================================================

/**
 * Tool to list connected channels.
 */
export const channelListTool: AgentTool = {
  name: 'channel_list',
  description: `List all available messaging channels and their connection status.`,

  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },

  async execute(): Promise<ActionResult> {
    try {
      logger.info('Listing channels');

      const channelManager = getChannelManager();
      const connectedChannels = channelManager.getConnectedChannels();

      const allChannels: ChannelType[] = ['desktop', 'webchat', 'telegram', 'discord', 'whatsapp', 'slack'];

      let output = '## Messaging Channels\n\n';
      for (const channel of allChannels) {
        const isConnected = connectedChannels.includes(channel);
        output += `- **${channel}**: ${isConnected ? '✅ Connected' : '❌ Not connected'}\n`;
      }

      return {
        success: true,
        output,
        data: {
          channels: allChannels,
          connected: connectedChannels,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to list channels', { error });

      return {
        success: false,
        output: `Failed to list channels: ${errorMessage}`,
        error: errorMessage,
      };
    }
  },
};

// =============================================================================
// Channel Connect Tool
// =============================================================================

/**
 * Tool to connect a messaging channel.
 */
export const channelConnectTool: AgentTool = {
  name: 'channel_connect',
  description: `Connect to a messaging channel. Some channels require tokens/credentials.

- telegram: Requires TELEGRAM_BOT_TOKEN environment variable
- discord: Requires DISCORD_BOT_TOKEN environment variable
- slack: Requires SLACK_BOT_TOKEN environment variable
- whatsapp: Will show QR code for phone linking
- desktop/webchat: Auto-connected`,

  parameters: {
    type: 'object',
    properties: {
      channel: {
        type: 'string',
        description: 'The channel to connect',
        enum: ['telegram', 'discord', 'whatsapp', 'slack'],
      },
      token: {
        type: 'string',
        description: 'Bot token (if not using environment variable)',
      },
    },
    required: ['channel'],
  },

  async execute(params: Record<string, unknown>): Promise<ActionResult> {
    try {
      const channel = params.channel as ChannelType;
      let token = params.token as string | undefined;

      if (!channel) {
        return {
          success: false,
          output: 'channel is required',
          error: 'Missing channel',
        };
      }

      logger.info('Connecting channel', { channel });

      // Get token from environment if not provided
      if (!token) {
        const envVars: Record<string, string> = {
          telegram: 'TELEGRAM_BOT_TOKEN',
          discord: 'DISCORD_BOT_TOKEN',
          slack: 'SLACK_BOT_TOKEN',
        };

        const envVar = envVars[channel];
        if (envVar) {
          token = process.env[envVar];
          if (!token) {
            return {
              success: false,
              output: `No token provided and ${envVar} environment variable not set.`,
              error: 'Missing token',
            };
          }
        }
      }

      const channelManager = getChannelManager();
      await channelManager.connect(channel, { token });

      return {
        success: true,
        output: `✅ Connected to ${channel}${channel === 'whatsapp' ? '\n\nScan the QR code with your phone to link WhatsApp.' : ''}`,
        data: { channel, connected: true },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to connect channel', { error });

      return {
        success: false,
        output: `Failed to connect: ${errorMessage}`,
        error: errorMessage,
      };
    }
  },
};

// =============================================================================
// Channel Disconnect Tool
// =============================================================================

/**
 * Tool to disconnect a messaging channel.
 */
export const channelDisconnectTool: AgentTool = {
  name: 'channel_disconnect',
  description: `Disconnect from a messaging channel.`,

  parameters: {
    type: 'object',
    properties: {
      channel: {
        type: 'string',
        description: 'The channel to disconnect',
        enum: ['telegram', 'discord', 'whatsapp', 'slack', 'webchat'],
      },
    },
    required: ['channel'],
  },

  async execute(params: Record<string, unknown>): Promise<ActionResult> {
    try {
      const channel = params.channel as ChannelType;

      if (!channel) {
        return {
          success: false,
          output: 'channel is required',
          error: 'Missing channel',
        };
      }

      logger.info('Disconnecting channel', { channel });

      const channelManager = getChannelManager();
      await channelManager.disconnect(channel);

      return {
        success: true,
        output: `✅ Disconnected from ${channel}`,
        data: { channel, connected: false },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to disconnect channel', { error });

      return {
        success: false,
        output: `Failed to disconnect: ${errorMessage}`,
        error: errorMessage,
      };
    }
  },
};

// =============================================================================
// Message Typing Tool
// =============================================================================

/**
 * Tool to send typing indicator.
 */
export const messageTypingTool: AgentTool = {
  name: 'message_typing',
  description: `Send a typing indicator to show you're composing a message. Supported on most channels.`,

  parameters: {
    type: 'object',
    properties: {
      channel: {
        type: 'string',
        description: 'The channel',
        enum: ['telegram', 'discord', 'whatsapp', 'slack'],
      },
      chatId: {
        type: 'string',
        description: 'The chat/conversation ID',
      },
    },
    required: ['channel', 'chatId'],
  },

  async execute(params: Record<string, unknown>): Promise<ActionResult> {
    try {
      const channel = params.channel as ChannelType;
      const chatId = params.chatId as string;

      if (!channel || !chatId) {
        return {
          success: false,
          output: 'channel and chatId are required',
          error: 'Missing parameters',
        };
      }

      const channelManager = getChannelManager();
      const adapter = channelManager.getAdapter(channel);

      if (!adapter || !adapter.isConnected) {
        return {
          success: false,
          output: `Channel "${channel}" is not connected`,
          error: 'Channel not connected',
        };
      }

      await adapter.sendTyping(chatId);

      return {
        success: true,
        output: `✅ Typing indicator sent to ${channel}:${chatId}`,
        data: { channel, chatId },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to send typing indicator', { error });

      return {
        success: false,
        output: `Failed: ${errorMessage}`,
        error: errorMessage,
      };
    }
  },
};

// =============================================================================
// Message React Tool
// =============================================================================

/**
 * Tool to react to a message with an emoji.
 */
export const messageReactTool: AgentTool = {
  name: 'message_react',
  description: `React to a message with an emoji. Supported on Telegram, Discord, WhatsApp, and Slack.`,

  parameters: {
    type: 'object',
    properties: {
      channel: {
        type: 'string',
        description: 'The channel',
        enum: ['telegram', 'discord', 'whatsapp', 'slack'],
      },
      chatId: {
        type: 'string',
        description: 'The chat/conversation ID',
      },
      messageId: {
        type: 'string',
        description: 'The message ID to react to',
      },
      emoji: {
        type: 'string',
        description: 'The emoji to react with (e.g., "👍", "❤️", "🎉")',
      },
    },
    required: ['channel', 'chatId', 'messageId', 'emoji'],
  },

  async execute(params: Record<string, unknown>): Promise<ActionResult> {
    try {
      const channel = params.channel as ChannelType;
      const chatId = params.chatId as string;
      const messageId = params.messageId as string;
      const emoji = params.emoji as string;

      if (!channel || !chatId || !messageId || !emoji) {
        return {
          success: false,
          output: 'channel, chatId, messageId, and emoji are required',
          error: 'Missing parameters',
        };
      }

      const channelManager = getChannelManager();
      const adapter = channelManager.getAdapter(channel);

      if (!adapter || !adapter.isConnected) {
        return {
          success: false,
          output: `Channel "${channel}" is not connected`,
          error: 'Channel not connected',
        };
      }

      await adapter.react(chatId, messageId, emoji);

      return {
        success: true,
        output: `✅ Reacted with ${emoji} to message ${messageId}`,
        data: { channel, chatId, messageId, emoji },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to react', { error });

      return {
        success: false,
        output: `Failed: ${errorMessage}`,
        error: errorMessage,
      };
    }
  },
};

// =============================================================================
// Export All Message Tools
// =============================================================================

export const messageTools: AgentTool[] = [
  messageSendTool,
  channelListTool,
  channelConnectTool,
  channelDisconnectTool,
  messageTypingTool,
  messageReactTool,
];

export default messageTools;
