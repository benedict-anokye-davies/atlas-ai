/**
 * Atlas Desktop - Discord Integration Tool
 *
 * Provides Discord bot functionality for sending messages, reading channels,
 * and interacting with Discord servers.
 *
 * NOTE: This requires a Discord Bot Token. Create one at:
 * https://discord.com/developers/applications
 *
 * @module agent/tools/discord
 */

import {
  Client,
  GatewayIntentBits,
  TextChannel,
  DMChannel,
  NewsChannel,
  Message,
  Guild,
  PresenceStatusData,
  ActivityType,
} from 'discord.js';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import { AgentTool, ActionResult } from '../../../shared/types/agent';
import { createModuleLogger } from '../../utils/logger';
import { getErrorMessage } from '../../../shared/utils';

const logger = createModuleLogger('Discord');

// ============================================================================
// Types
// ============================================================================

interface DiscordServer {
  id: string;
  name: string;
  memberCount: number;
  ownerId: string;
  iconUrl?: string;
}

interface DiscordChannel {
  id: string;
  name: string;
  type: string;
  guildId?: string;
  guildName?: string;
}

interface DiscordMessage {
  id: string;
  content: string;
  author: {
    id: string;
    username: string;
    bot: boolean;
  };
  channelId: string;
  guildId?: string;
  timestamp: string;
  attachments: Array<{
    url: string;
    name: string;
  }>;
}

interface DiscordUser {
  id: string;
  username: string;
  discriminator: string;
  avatar?: string;
  bot: boolean;
}

// ============================================================================
// Discord Manager
// ============================================================================

const DISCORD_CONFIG_DIR = path.join(os.homedir(), '.atlas', 'discord');
const DISCORD_TOKEN_FILE = path.join(DISCORD_CONFIG_DIR, 'token.json');

class DiscordManager {
  private client: Client | null = null;
  private token: string | null = null;
  private isConnected: boolean = false;

  constructor() {
    this.loadToken();
  }

  /**
   * Load token from disk
   */
  private loadToken(): void {
    try {
      if (fs.existsSync(DISCORD_TOKEN_FILE)) {
        const data = fs.readJsonSync(DISCORD_TOKEN_FILE);
        this.token = data.token;
        logger.info('Loaded Discord token from disk');
      }
    } catch (error) {
      logger.warn('Failed to load Discord token:', error);
      this.token = null;
    }
  }

  /**
   * Save token to disk
   */
  private saveToken(): void {
    try {
      fs.ensureDirSync(DISCORD_CONFIG_DIR);
      fs.writeJsonSync(DISCORD_TOKEN_FILE, { token: this.token }, { spaces: 2 });
      logger.info('Saved Discord token to disk');
    } catch (error) {
      logger.error('Failed to save Discord token:', error);
    }
  }

  /**
   * Connect to Discord with a bot token
   */
  async connect(token?: string): Promise<void> {
    // Use provided token or saved token
    const botToken = token || this.token || process.env.DISCORD_BOT_TOKEN;

    if (!botToken) {
      throw new Error(
        'No Discord bot token provided. Set DISCORD_BOT_TOKEN environment variable or provide token.'
      );
    }

    // Save token if provided
    if (token && token !== this.token) {
      this.token = token;
      this.saveToken();
    }

    // Create client with required intents
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildMembers,
      ],
    });

    // Set up event handlers
    this.client.on('ready', () => {
      logger.info(`Discord bot logged in as ${this.client?.user?.tag}`);
      this.isConnected = true;
    });

    this.client.on('error', (error) => {
      logger.error('Discord client error:', { message: error.message, stack: error.stack });
    });

    // Login
    await this.client.login(botToken);

    // Wait for ready
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Discord login timeout')), 30000);
      this.client!.once('ready', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  /**
   * Disconnect from Discord
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      this.client.destroy();
      this.client = null;
      this.isConnected = false;
      logger.info('Disconnected from Discord');
    }
  }

  /**
   * Check if connected
   */
  isReady(): boolean {
    return this.isConnected && this.client !== null && this.client.isReady();
  }

  /**
   * Ensure connected
   */
  private async ensureConnected(): Promise<void> {
    if (!this.isReady()) {
      await this.connect();
    }
  }

  /**
   * Get list of servers the bot is in
   */
  async getServers(): Promise<DiscordServer[]> {
    await this.ensureConnected();

    const guilds = this.client!.guilds.cache;
    return guilds.map((guild) => ({
      id: guild.id,
      name: guild.name,
      memberCount: guild.memberCount,
      ownerId: guild.ownerId,
      iconUrl: guild.iconURL() ?? undefined,
    }));
  }

  /**
   * Get channels in a server
   */
  async getChannels(guildId: string): Promise<DiscordChannel[]> {
    await this.ensureConnected();

    const guild = this.client!.guilds.cache.get(guildId);
    if (!guild) {
      throw new Error(`Server with ID ${guildId} not found`);
    }

    const channels = guild.channels.cache;
    return channels
      .filter((ch) => ch.isTextBased())
      .map((ch) => ({
        id: ch.id,
        name: ch.name,
        type: ch.type.toString(),
        guildId: guild.id,
        guildName: guild.name,
      }));
  }

  /**
   * Send a message to a channel
   */
  async sendMessage(channelId: string, content: string): Promise<DiscordMessage> {
    await this.ensureConnected();

    const channel = await this.client!.channels.fetch(channelId);
    if (!channel) {
      throw new Error(`Channel with ID ${channelId} not found`);
    }

    if (!channel.isTextBased()) {
      throw new Error('Channel is not a text channel');
    }

    const textChannel = channel as TextChannel | DMChannel | NewsChannel;
    const message = await textChannel.send(content);

    return this.formatMessage(message);
  }

  /**
   * Read messages from a channel
   */
  async readMessages(channelId: string, limit: number = 20): Promise<DiscordMessage[]> {
    await this.ensureConnected();

    const channel = await this.client!.channels.fetch(channelId);
    if (!channel) {
      throw new Error(`Channel with ID ${channelId} not found`);
    }

    if (!channel.isTextBased()) {
      throw new Error('Channel is not a text channel');
    }

    const textChannel = channel as TextChannel | DMChannel | NewsChannel;
    const messages = await textChannel.messages.fetch({ limit });

    return Array.from(messages.values()).map((msg) => this.formatMessage(msg));
  }

  /**
   * Get messages mentioning the bot
   */
  async getMentions(guildId?: string, limit: number = 20): Promise<DiscordMessage[]> {
    await this.ensureConnected();

    const mentions: DiscordMessage[] = [];
    const botId = this.client!.user!.id;

    // Search through guilds
    const guilds = guildId
      ? ([this.client!.guilds.cache.get(guildId)].filter(Boolean) as Guild[])
      : Array.from(this.client!.guilds.cache.values());

    for (const guild of guilds) {
      for (const channel of guild.channels.cache.values()) {
        if (!channel.isTextBased()) continue;

        try {
          const textChannel = channel as TextChannel;
          const messages = await textChannel.messages.fetch({ limit: 100 });

          for (const msg of messages.values()) {
            if (msg.mentions.users.has(botId)) {
              mentions.push(this.formatMessage(msg));
              if (mentions.length >= limit) break;
            }
          }
        } catch {
          // Skip channels we can't read
        }

        if (mentions.length >= limit) break;
      }
      if (mentions.length >= limit) break;
    }

    return mentions.slice(0, limit);
  }

  /**
   * Add reaction to a message
   */
  async addReaction(channelId: string, messageId: string, emoji: string): Promise<void> {
    await this.ensureConnected();

    const channel = await this.client!.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) {
      throw new Error('Channel not found or not a text channel');
    }

    const textChannel = channel as TextChannel | DMChannel | NewsChannel;
    const message = await textChannel.messages.fetch(messageId);
    await message.react(emoji);
  }

  /**
   * Set bot status
   */
  async setStatus(
    status: 'online' | 'idle' | 'dnd' | 'invisible',
    activity?: string
  ): Promise<void> {
    await this.ensureConnected();

    const statusMap: Record<string, PresenceStatusData> = {
      online: 'online',
      idle: 'idle',
      dnd: 'dnd',
      invisible: 'invisible',
    };

    this.client!.user!.setPresence({
      status: statusMap[status],
      activities: activity ? [{ name: activity, type: ActivityType.Playing }] : [],
    });
  }

  /**
   * Get bot user info
   */
  async getBotInfo(): Promise<DiscordUser | null> {
    await this.ensureConnected();

    const user = this.client!.user;
    if (!user) return null;

    return {
      id: user.id,
      username: user.username,
      discriminator: user.discriminator,
      avatar: user.avatarURL() ?? undefined,
      bot: user.bot,
    };
  }

  /**
   * Reply to a message
   */
  async replyToMessage(
    channelId: string,
    messageId: string,
    content: string
  ): Promise<DiscordMessage> {
    await this.ensureConnected();

    const channel = await this.client!.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) {
      throw new Error('Channel not found or not a text channel');
    }

    const textChannel = channel as TextChannel | DMChannel | NewsChannel;
    const originalMessage = await textChannel.messages.fetch(messageId);
    const reply = await originalMessage.reply(content);

    return this.formatMessage(reply);
  }

  /**
   * Format a Discord.js Message to our DiscordMessage type
   */
  private formatMessage(msg: Message): DiscordMessage {
    return {
      id: msg.id,
      content: msg.content,
      author: {
        id: msg.author.id,
        username: msg.author.username,
        bot: msg.author.bot,
      },
      channelId: msg.channelId,
      guildId: msg.guildId ?? undefined,
      timestamp: msg.createdAt.toISOString(),
      attachments: Array.from(msg.attachments.values()).map((att) => ({
        url: att.url,
        name: att.name,
      })),
    };
  }

  /**
   * Delete saved token
   */
  clearToken(): void {
    this.token = null;
    try {
      if (fs.existsSync(DISCORD_TOKEN_FILE)) {
        fs.unlinkSync(DISCORD_TOKEN_FILE);
      }
    } catch (error) {
      logger.warn('Failed to delete token file:', error);
    }
  }
}

// Singleton instance
const discordManager = new DiscordManager();

// ============================================================================
// Agent Tools
// ============================================================================

/**
 * Connect to Discord
 */
export const discordConnectTool: AgentTool = {
  name: 'discord_connect',
  description: 'Connect to Discord using a bot token. Token is saved for future use.',
  parameters: {
    type: 'object',
    properties: {
      token: {
        type: 'string',
        description:
          'Discord bot token (optional if already saved or in DISCORD_BOT_TOKEN env var)',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      await discordManager.connect(params.token as string | undefined);
      const botInfo = await discordManager.getBotInfo();

      return {
        success: true,
        data: {
          message: 'Connected to Discord',
          bot: botInfo,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to connect to Discord: ${getErrorMessage(error)}`,
      };
    }
  },
};

/**
 * Get servers
 */
export const discordGetServersTool: AgentTool = {
  name: 'discord_get_servers',
  description: 'Get list of Discord servers the bot is in',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (): Promise<ActionResult> => {
    try {
      const servers = await discordManager.getServers();

      return {
        success: true,
        data: { servers, count: servers.length },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to get servers: ${getErrorMessage(error)}`,
      };
    }
  },
};

/**
 * Get channels
 */
export const discordGetChannelsTool: AgentTool = {
  name: 'discord_get_channels',
  description: 'Get list of text channels in a Discord server',
  parameters: {
    type: 'object',
    properties: {
      serverId: {
        type: 'string',
        description: 'Server (guild) ID',
      },
    },
    required: ['serverId'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const channels = await discordManager.getChannels(params.serverId as string);

      return {
        success: true,
        data: { channels, count: channels.length },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to get channels: ${getErrorMessage(error)}`,
      };
    }
  },
};

/**
 * Send message
 */
export const discordSendMessageTool: AgentTool = {
  name: 'discord_send_message',
  description: 'Send a message to a Discord channel',
  parameters: {
    type: 'object',
    properties: {
      channelId: {
        type: 'string',
        description: 'Channel ID to send message to',
      },
      content: {
        type: 'string',
        description: 'Message content to send',
      },
    },
    required: ['channelId', 'content'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const message = await discordManager.sendMessage(
        params.channelId as string,
        params.content as string
      );

      return {
        success: true,
        data: { message },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to send message: ${getErrorMessage(error)}`,
      };
    }
  },
};

/**
 * Read messages
 */
export const discordReadMessagesTool: AgentTool = {
  name: 'discord_read_messages',
  description: 'Read recent messages from a Discord channel',
  parameters: {
    type: 'object',
    properties: {
      channelId: {
        type: 'string',
        description: 'Channel ID to read messages from',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of messages to fetch (default: 20, max: 100)',
      },
    },
    required: ['channelId'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const limit = Math.min((params.limit as number) || 20, 100);
      const messages = await discordManager.readMessages(params.channelId as string, limit);

      return {
        success: true,
        data: { messages, count: messages.length },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to read messages: ${getErrorMessage(error)}`,
      };
    }
  },
};

/**
 * Get mentions
 */
export const discordGetMentionsTool: AgentTool = {
  name: 'discord_get_mentions',
  description: 'Get recent messages that mention the bot',
  parameters: {
    type: 'object',
    properties: {
      serverId: {
        type: 'string',
        description: 'Server ID to search in (optional, searches all if not provided)',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of mentions to fetch (default: 20)',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const mentions = await discordManager.getMentions(
        params.serverId as string | undefined,
        (params.limit as number) || 20
      );

      return {
        success: true,
        data: { mentions, count: mentions.length },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to get mentions: ${getErrorMessage(error)}`,
      };
    }
  },
};

/**
 * Add reaction
 */
export const discordReactTool: AgentTool = {
  name: 'discord_react',
  description: 'Add a reaction emoji to a message',
  parameters: {
    type: 'object',
    properties: {
      channelId: {
        type: 'string',
        description: 'Channel ID',
      },
      messageId: {
        type: 'string',
        description: 'Message ID to react to',
      },
      emoji: {
        type: 'string',
        description: 'Emoji to react with (e.g., "👍" or custom emoji ID)',
      },
    },
    required: ['channelId', 'messageId', 'emoji'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      await discordManager.addReaction(
        params.channelId as string,
        params.messageId as string,
        params.emoji as string
      );

      return {
        success: true,
        data: { message: 'Reaction added' },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to add reaction: ${getErrorMessage(error)}`,
      };
    }
  },
};

/**
 * Set status
 */
export const discordSetStatusTool: AgentTool = {
  name: 'discord_set_status',
  description: "Set the bot's online status and activity",
  parameters: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        description: 'Status: online, idle, dnd, or invisible',
        enum: ['online', 'idle', 'dnd', 'invisible'],
      },
      activity: {
        type: 'string',
        description: 'Activity text (e.g., "Playing a game")',
      },
    },
    required: ['status'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      await discordManager.setStatus(
        params.status as 'online' | 'idle' | 'dnd' | 'invisible',
        params.activity as string | undefined
      );

      return {
        success: true,
        data: { message: 'Status updated' },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to set status: ${getErrorMessage(error)}`,
      };
    }
  },
};

/**
 * Reply to message
 */
export const discordReplyTool: AgentTool = {
  name: 'discord_reply',
  description: 'Reply to a specific message',
  parameters: {
    type: 'object',
    properties: {
      channelId: {
        type: 'string',
        description: 'Channel ID',
      },
      messageId: {
        type: 'string',
        description: 'Message ID to reply to',
      },
      content: {
        type: 'string',
        description: 'Reply content',
      },
    },
    required: ['channelId', 'messageId', 'content'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const reply = await discordManager.replyToMessage(
        params.channelId as string,
        params.messageId as string,
        params.content as string
      );

      return {
        success: true,
        data: { message: reply },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to reply: ${getErrorMessage(error)}`,
      };
    }
  },
};

/**
 * Disconnect
 */
export const discordDisconnectTool: AgentTool = {
  name: 'discord_disconnect',
  description: 'Disconnect from Discord',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (): Promise<ActionResult> => {
    try {
      await discordManager.disconnect();

      return {
        success: true,
        data: { message: 'Disconnected from Discord' },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to disconnect: ${getErrorMessage(error)}`,
      };
    }
  },
};

/**
 * Get all Discord tools
 */
export function getDiscordTools(): AgentTool[] {
  return [
    discordConnectTool,
    discordGetServersTool,
    discordGetChannelsTool,
    discordSendMessageTool,
    discordReadMessagesTool,
    discordGetMentionsTool,
    discordReactTool,
    discordSetStatusTool,
    discordReplyTool,
    discordDisconnectTool,
  ];
}

// Export manager for direct access if needed
export { discordManager, DiscordManager };
