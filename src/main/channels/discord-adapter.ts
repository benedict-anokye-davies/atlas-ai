/**
 * @fileoverview Discord Channel Adapter - Full discord.js implementation
 * @module channels/discord-adapter
 * @author Atlas Team
 * @since 1.0.0
 *
 * @description
 * Full-featured Discord bot adapter using the discord.js library.
 * Implements comprehensive Discord integration:
 * - Guild (server) and DM support
 * - Text channels, threads, and forum posts
 * - Message formatting with embeds
 * - Reactions and emoji support
 * - Slash commands (optional)
 * - Mention-based activation
 * - File attachments
 * - Voice channel presence (future)
 *
 * Configuration:
 * - DISCORD_BOT_TOKEN: Bot token from Discord Developer Portal
 * - Requires Privileged Gateway Intents: Message Content, Guild Members
 *
 * @example
 * ```typescript
 * const adapter = new DiscordAdapter();
 * await adapter.connect({ token: process.env.DISCORD_BOT_TOKEN });
 *
 * adapter.on('message', (msg) => {
 *   console.log(`Message from ${msg.sender.name}: ${msg.content}`);
 * });
 *
 * await adapter.send(channelId, 'Hello from Atlas!');
 * ```
 */

import {
  Client,
  GatewayIntentBits,
  Message,
  TextChannel,
  DMChannel,
  NewsChannel,
  ThreadChannel,
  PartialMessage,
  ChannelType as DiscordChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageReaction,
  User,
  PartialUser,
  Partials,
  Channel,
} from 'discord.js';
import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import type { ChannelType } from '../../shared/types/gateway';
import type {
  IncomingMessage,
  MessageAttachment,
  SendOptions,
  MessageButton,
  AdapterConfig,
  ChannelAdapter,
} from './index';

const logger = createModuleLogger('DiscordAdapter');

// =============================================================================
// Types
// =============================================================================

/**
 * Discord-specific adapter configuration
 */
export interface DiscordAdapterConfig extends AdapterConfig {
  /** Bot token from Discord Developer Portal */
  token: string;
  /** Require mention in guilds (default: true) */
  requireMention?: boolean;
  /** Allow DM messages (default: true) */
  allowDMs?: boolean;
  /** Max message length before chunking (default: 2000) */
  maxMessageLength?: number;
  /** Guild IDs to respond in (empty = all guilds) */
  allowedGuilds?: string[];
  /** Use embeds for responses (default: false) */
  useEmbeds?: boolean;
}

// =============================================================================
// Discord Adapter
// =============================================================================

/**
 * Discord adapter using discord.js library
 *
 * Provides full Discord Bot API integration with support for:
 * - Text messages in guilds and DMs
 * - Thread messages
 * - Embeds and rich formatting
 * - Action rows with buttons
 * - Reactions
 * - File attachments
 *
 * @class DiscordAdapter
 * @extends EventEmitter
 * @implements ChannelAdapter
 */
export class DiscordAdapter extends EventEmitter implements ChannelAdapter {
  readonly channel: ChannelType = 'discord';
  private _client: Client | null = null;
  private _config: DiscordAdapterConfig | null = null;
  private _isConnected: boolean = false;

  // ==========================================================================
  // Connection Lifecycle
  // ==========================================================================

  get isConnected(): boolean {
    return this._isConnected;
  }

  /**
   * Connect to Discord using bot token
   *
   * @param config - Adapter configuration with bot token
   * @throws Error if token is missing or connection fails
   */
  async connect(config: AdapterConfig): Promise<void> {
    const discordConfig = config as DiscordAdapterConfig;

    if (!discordConfig.token) {
      throw new Error('Discord bot token is required');
    }

    this._config = {
      token: discordConfig.token,
      requireMention: discordConfig.requireMention ?? true,
      allowDMs: discordConfig.allowDMs ?? true,
      maxMessageLength: discordConfig.maxMessageLength ?? 2000,
      allowedGuilds: discordConfig.allowedGuilds ?? [],
      useEmbeds: discordConfig.useEmbeds ?? false,
    };

    logger.info('Connecting Discord adapter');

    try {
      // Create client with required intents
      this._client = new Client({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMessages,
          GatewayIntentBits.GuildMessageReactions,
          GatewayIntentBits.DirectMessages,
          GatewayIntentBits.DirectMessageReactions,
          GatewayIntentBits.MessageContent,
        ],
        partials: [Partials.Message, Partials.Channel, Partials.Reaction],
      });

      // Set up event handlers
      this._setupHandlers();

      // Login
      await this._client.login(this._config.token);

      // Wait for ready event
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Discord client ready timeout'));
        }, 30000);

        this._client!.once('ready', () => {
          clearTimeout(timeout);
          resolve();
        });

        this._client!.once('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });

      this._isConnected = true;
      this.emit('connected');

      const user = this._client.user;
      logger.info('Discord adapter connected', {
        username: user?.username,
        id: user?.id,
        guilds: this._client.guilds.cache.size,
      });
    } catch (error) {
      logger.error('Failed to connect Discord adapter', { error });
      throw error;
    }
  }

  /**
   * Disconnect from Discord
   */
  async disconnect(): Promise<void> {
    logger.info('Disconnecting Discord adapter');

    if (this._client) {
      try {
        await this._client.destroy();
      } catch (error) {
        logger.warn('Error destroying client', { error });
      }
      this._client = null;
    }

    this._isConnected = false;
    this.emit('disconnected');
    logger.info('Discord adapter disconnected');
  }

  // ==========================================================================
  // Event Handlers
  // ==========================================================================

  /**
   * Set up Discord event handlers
   */
  private _setupHandlers(): void {
    if (!this._client) return;

    // Handle messages
    this._client.on('messageCreate', (message) => this._handleMessage(message));

    // Handle message edits
    this._client.on('messageUpdate', (oldMessage, newMessage) => {
      if (newMessage.partial) return;
      this._handleMessageUpdate(newMessage as Message);
    });

    // Handle message deletions
    this._client.on('messageDelete', (message) => {
      if (message.partial) return;
      this.emit('message-delete', message.id, message.channelId);
    });

    // Handle reactions
    this._client.on('messageReactionAdd', (reaction, user) => {
      this._handleReactionAdd(reaction as MessageReaction, user as User);
    });

    // Handle disconnection
    this._client.on('disconnect', () => {
      logger.warn('Discord client disconnected');
      this._isConnected = false;
      this.emit('disconnected', 'Discord gateway disconnected');
    });

    // Handle reconnection
    this._client.on('shardResume', () => {
      logger.info('Discord client reconnected');
      this._isConnected = true;
      this.emit('connected');
    });

    // Handle errors
    this._client.on('error', (error) => {
      logger.error('Discord client error', { error });
      this.emit('error', error);
    });

    // Handle warnings
    this._client.on('warn', (message) => {
      logger.warn('Discord client warning', { message });
    });

    logger.debug('Discord handlers set up');
  }

  /**
   * Handle incoming message
   */
  private async _handleMessage(message: Message): Promise<void> {
    // Ignore bot messages
    if (message.author.bot) return;

    // Ignore system messages
    if (message.system) return;

    const isDM = message.channel.type === DiscordChannelType.DM;
    const isGuild = message.guild !== null;

    // Check DM permissions
    if (isDM && !this._config?.allowDMs) {
      return;
    }

    // Check guild permissions
    if (isGuild && this._config?.allowedGuilds?.length) {
      if (!this._config.allowedGuilds.includes(message.guild!.id)) {
        return;
      }
    }

    // Check mention requirement for guilds
    if (isGuild && this._config?.requireMention) {
      if (!this._isBotMentioned(message)) {
        return;
      }
    }

    // Build and emit incoming message
    const incomingMessage = await this._buildIncomingMessage(message);

    // Remove bot mention from content if present
    if (this._client?.user) {
      incomingMessage.content = incomingMessage.content
        .replace(new RegExp(`<@!?${this._client.user.id}>\\s*`, 'g'), '')
        .trim();
    }

    this._emitMessage(incomingMessage);
  }

  /**
   * Handle message update (edit)
   */
  private async _handleMessageUpdate(message: Message): Promise<void> {
    // Ignore bot messages
    if (message.author.bot) return;

    const incomingMessage = await this._buildIncomingMessage(message);
    this.emit('message-edit', incomingMessage);
  }

  /**
   * Handle reaction add
   */
  private _handleReactionAdd(reaction: MessageReaction, user: User): void {
    if (user.bot) return;

    this.emit('reaction', {
      messageId: reaction.message.id,
      chatId: reaction.message.channelId,
      emoji: reaction.emoji.name || reaction.emoji.id || '?',
      userId: user.id,
    });
  }

  // ==========================================================================
  // Message Sending
  // ==========================================================================

  /**
   * Send a message to a Discord channel
   *
   * @param chatId - Discord channel ID
   * @param content - Message content
   * @param options - Send options
   * @returns Message ID
   */
  async send(chatId: string, content: string, options?: SendOptions): Promise<string> {
    if (!this._client) {
      throw new Error('Discord adapter not connected');
    }

    const channel = await this._client.channels.fetch(chatId);
    if (!channel) {
      throw new Error(`Channel not found: ${chatId}`);
    }

    if (!this._isTextBasedChannel(channel)) {
      throw new Error(`Channel is not text-based: ${chatId}`);
    }

    const textChannel = channel as TextChannel | DMChannel | NewsChannel | ThreadChannel;

    // Chunk long messages
    const chunks = this._chunkMessage(content);

    let lastMessageId: string | undefined;

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const isLastChunk = i === chunks.length - 1;

      // Build message options
      const sendOptions: Parameters<TextChannel['send']>[0] = {};

      // Use embeds or plain text
      if (this._config?.useEmbeds) {
        const embed = new EmbedBuilder()
          .setDescription(chunk)
          .setColor(0x5865f2); // Discord blurple

        sendOptions.embeds = [embed];
      } else {
        sendOptions.content = chunk;
      }

      // Add buttons on last chunk
      if (isLastChunk && options?.buttons) {
        sendOptions.components = this._buildActionRows(options.buttons);
      }

      // Add reply reference
      if (options?.replyTo) {
        sendOptions.reply = {
          messageReference: options.replyTo,
          failIfNotExists: false,
        };
      }

      const result = await textChannel.send(sendOptions);
      lastMessageId = result.id;
    }

    logger.debug('Discord message sent', {
      chatId,
      contentLength: content.length,
      chunks: chunks.length,
    });

    return lastMessageId || '';
  }

  /**
   * Send typing indicator
   */
  async sendTyping(chatId: string): Promise<void> {
    if (!this._client) return;

    try {
      const channel = await this._client.channels.fetch(chatId);
      if (channel && this._isTextBasedChannel(channel)) {
        await (channel as TextChannel).sendTyping();
      }
    } catch (error) {
      logger.debug('Failed to send typing indicator', { chatId, error });
    }
  }

  /**
   * Edit a message
   */
  async editMessage(chatId: string, messageId: string, content: string): Promise<void> {
    if (!this._client) {
      throw new Error('Discord adapter not connected');
    }

    const channel = await this._client.channels.fetch(chatId);
    if (!channel || !this._isTextBasedChannel(channel)) {
      throw new Error(`Channel not found or not text-based: ${chatId}`);
    }

    const textChannel = channel as TextChannel | DMChannel;
    const message = await textChannel.messages.fetch(messageId);

    if (this._config?.useEmbeds && message.embeds.length > 0) {
      const embed = EmbedBuilder.from(message.embeds[0]).setDescription(content);
      await message.edit({ embeds: [embed] });
    } else {
      await message.edit(content);
    }

    logger.debug('Discord message edited', { chatId, messageId });
  }

  /**
   * Delete a message
   */
  async deleteMessage(chatId: string, messageId: string): Promise<void> {
    if (!this._client) {
      throw new Error('Discord adapter not connected');
    }

    const channel = await this._client.channels.fetch(chatId);
    if (!channel || !this._isTextBasedChannel(channel)) {
      throw new Error(`Channel not found or not text-based: ${chatId}`);
    }

    const textChannel = channel as TextChannel | DMChannel;
    const message = await textChannel.messages.fetch(messageId);
    await message.delete();

    logger.debug('Discord message deleted', { chatId, messageId });
  }

  /**
   * React to a message
   */
  async react(chatId: string, messageId: string, emoji: string): Promise<void> {
    if (!this._client) {
      throw new Error('Discord adapter not connected');
    }

    const channel = await this._client.channels.fetch(chatId);
    if (!channel || !this._isTextBasedChannel(channel)) {
      throw new Error(`Channel not found or not text-based: ${chatId}`);
    }

    const textChannel = channel as TextChannel | DMChannel;
    const message = await textChannel.messages.fetch(messageId);
    await message.react(emoji);

    logger.debug('Discord reaction added', { chatId, messageId, emoji });
  }

  /**
   * Get channel information
   */
  async getChat(
    chatId: string
  ): Promise<{ id: string; name: string; type: 'private' | 'group' | 'channel' }> {
    if (!this._client) {
      throw new Error('Discord adapter not connected');
    }

    const channel = await this._client.channels.fetch(chatId);
    if (!channel) {
      throw new Error(`Channel not found: ${chatId}`);
    }

    let name = 'Unknown';
    let type: 'private' | 'group' | 'channel' = 'channel';

    if (channel.type === DiscordChannelType.DM) {
      type = 'private';
      const dm = channel as DMChannel;
      name = dm.recipient?.username || 'DM';
    } else if (
      channel.type === DiscordChannelType.GuildText ||
      channel.type === DiscordChannelType.GuildAnnouncement
    ) {
      const textChannel = channel as TextChannel | NewsChannel;
      name = textChannel.name;
      type = 'group';
    } else if (
      channel.type === DiscordChannelType.PublicThread ||
      channel.type === DiscordChannelType.PrivateThread
    ) {
      const thread = channel as ThreadChannel;
      name = thread.name;
      type = 'group';
    }

    return { id: chatId, name, type };
  }

  // ==========================================================================
  // Helper Methods
  // ==========================================================================

  /**
   * Check if the bot is mentioned in the message
   */
  private _isBotMentioned(message: Message): boolean {
    if (!this._client?.user) return false;

    // Check for direct mention
    if (message.mentions.users.has(this._client.user.id)) {
      return true;
    }

    // Check for reply to bot
    if (message.reference?.messageId) {
      // Could fetch the referenced message to check, but for now just allow replies
      return true;
    }

    return false;
  }

  /**
   * Check if a channel is text-based
   */
  private _isTextBasedChannel(channel: Channel): boolean {
    return (
      channel.type === DiscordChannelType.GuildText ||
      channel.type === DiscordChannelType.DM ||
      channel.type === DiscordChannelType.GuildAnnouncement ||
      channel.type === DiscordChannelType.PublicThread ||
      channel.type === DiscordChannelType.PrivateThread ||
      channel.type === DiscordChannelType.AnnouncementThread
    );
  }

  /**
   * Build an IncomingMessage from Discord message
   */
  private async _buildIncomingMessage(message: Message): Promise<IncomingMessage> {
    const isDM = message.channel.type === DiscordChannelType.DM;
    const attachments: MessageAttachment[] = [];

    // Process attachments
    for (const [, attachment] of message.attachments) {
      let type: MessageAttachment['type'] = 'file';

      if (attachment.contentType?.startsWith('image/')) {
        type = 'image';
      } else if (attachment.contentType?.startsWith('video/')) {
        type = 'video';
      } else if (attachment.contentType?.startsWith('audio/')) {
        type = 'audio';
      }

      attachments.push({
        type,
        url: attachment.url,
        mimeType: attachment.contentType || undefined,
        filename: attachment.name || undefined,
        size: attachment.size,
      });
    }

    return {
      id: message.id,
      channel: 'discord',
      chatId: message.channelId,
      sender: {
        id: message.author.id,
        name: message.member?.displayName || message.author.username,
        username: message.author.username,
        avatar: message.author.avatarURL() || undefined,
      },
      content: message.content,
      attachments: attachments.length > 0 ? attachments : undefined,
      isGroup: !isDM,
      group: !isDM && message.guild
        ? {
            id: message.guild.id,
            name: message.guild.name,
          }
        : undefined,
      replyTo: message.reference?.messageId,
      timestamp: message.createdTimestamp,
      raw: message,
    };
  }

  /**
   * Emit an incoming message
   */
  private _emitMessage(message: IncomingMessage): void {
    this.emit('message', message);
    logger.debug('Message received', {
      channel: 'discord',
      chatId: message.chatId,
      senderId: message.sender.id,
      isGroup: message.isGroup,
    });
  }

  /**
   * Build action rows from buttons
   */
  private _buildActionRows(buttons: MessageButton[][]): ActionRowBuilder<ButtonBuilder>[] {
    const rows: ActionRowBuilder<ButtonBuilder>[] = [];

    for (const row of buttons) {
      const actionRow = new ActionRowBuilder<ButtonBuilder>();

      for (const button of row) {
        const discordButton = new ButtonBuilder().setLabel(button.text);

        if (button.type === 'url') {
          discordButton.setStyle(ButtonStyle.Link).setURL(button.data);
        } else if (button.type === 'callback') {
          discordButton.setStyle(ButtonStyle.Primary).setCustomId(button.data);
        } else {
          discordButton.setStyle(ButtonStyle.Secondary).setCustomId(button.data);
        }

        actionRow.addComponents(discordButton);
      }

      rows.push(actionRow);
    }

    return rows;
  }

  /**
   * Chunk a message that exceeds max length
   */
  private _chunkMessage(content: string): string[] {
    const maxLength = this._config?.maxMessageLength || 2000;

    if (content.length <= maxLength) {
      return [content];
    }

    const chunks: string[] = [];
    let remaining = content;

    while (remaining.length > 0) {
      if (remaining.length <= maxLength) {
        chunks.push(remaining);
        break;
      }

      // Try to split at a natural break point
      let splitIndex = maxLength;
      const newlineIndex = remaining.lastIndexOf('\n', maxLength);
      const spaceIndex = remaining.lastIndexOf(' ', maxLength);

      if (newlineIndex > maxLength * 0.5) {
        splitIndex = newlineIndex;
      } else if (spaceIndex > maxLength * 0.5) {
        splitIndex = spaceIndex;
      }

      chunks.push(remaining.substring(0, splitIndex));
      remaining = remaining.substring(splitIndex).trim();
    }

    return chunks;
  }
}

export default DiscordAdapter;
