/**
 * @fileoverview Slack Channel Adapter - Full Bolt SDK implementation
 * @module channels/slack-adapter
 * @author Atlas Team
 * @since 1.0.0
 *
 * @description
 * Full-featured Slack adapter using the Bolt SDK.
 * Implements comprehensive Slack integration:
 * - Socket Mode for real-time events (no public URL needed)
 * - HTTP mode for production with webhook
 * - Channels, DMs, and threads
 * - Rich message formatting with blocks
 * - App mentions and direct messages
 * - Reactions
 * - File uploads
 * - Slash commands (optional)
 *
 * Configuration:
 * - SLACK_BOT_TOKEN: Bot User OAuth Token (xoxb-...)
 * - SLACK_SIGNING_SECRET: Signing secret for HTTP mode
 * - SLACK_APP_TOKEN: App-Level Token for Socket Mode (xapp-...)
 *
 * @example
 * ```typescript
 * const adapter = new SlackAdapter();
 * await adapter.connect({
 *   token: process.env.SLACK_BOT_TOKEN,
 *   options: {
 *     appToken: process.env.SLACK_APP_TOKEN,
 *     signingSecret: process.env.SLACK_SIGNING_SECRET,
 *   },
 * });
 *
 * adapter.on('message', (msg) => {
 *   console.log(`Message from ${msg.sender.name}: ${msg.content}`);
 * });
 * ```
 */

import { App, LogLevel, AppMentionEvent, KnownEventFromType } from '@slack/bolt';
import { WebClient, ChatPostMessageArguments } from '@slack/web-api';
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

const logger = createModuleLogger('SlackAdapter');

// =============================================================================
// Types
// =============================================================================

// Re-define message types locally since they may not be directly exported
type MessageEvent = KnownEventFromType<'message'>;
type ReactionAddedEvent = KnownEventFromType<'reaction_added'>;

// Slack message event with common properties we need
interface SlackMessageEvent {
  type: 'message';
  channel: string;
  user?: string;
  text?: string;
  ts: string;
  thread_ts?: string;
  subtype?: string;
  channel_type?: 'im' | 'channel' | 'group' | 'mpim';
  files?: Array<{
    id: string;
    name: string;
    mimetype: string;
    url_private_download?: string;
    size?: number;
  }>;
}

/**
 * Slack-specific adapter configuration
 */
export interface SlackAdapterConfig extends AdapterConfig {
  /** Bot User OAuth Token (xoxb-...) */
  token: string;
  /** App-Level Token for Socket Mode (xapp-...) */
  appToken?: string;
  /** Signing secret for HTTP mode */
  signingSecret?: string;
  /** Use Socket Mode (default: true if appToken provided) */
  socketMode?: boolean;
  /** HTTP port for webhook mode (default: 3000) */
  port?: number;
  /** Allow DM messages (default: true) */
  allowDMs?: boolean;
  /** Require app mention in channels (default: true) */
  requireMention?: boolean;
  /** Max message length before chunking (default: 3000) */
  maxMessageLength?: number;
  /** Allowed channel IDs (empty = all channels) */
  allowedChannels?: string[];
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: Partial<SlackAdapterConfig> = {
  socketMode: true,
  port: 3000,
  allowDMs: true,
  requireMention: true,
  maxMessageLength: 3000,
  allowedChannels: [],
};

// =============================================================================
// Slack Adapter
// =============================================================================

/**
 * Slack adapter using Bolt SDK
 *
 * Provides full Slack App integration with:
 * - Socket Mode for development/firewalled environments
 * - HTTP mode for production
 * - Rich message formatting
 * - Thread support
 * - Reactions
 * - File handling
 *
 * @class SlackAdapter
 * @extends EventEmitter
 * @implements ChannelAdapter
 */
export class SlackAdapter extends EventEmitter implements ChannelAdapter {
  readonly channel: ChannelType = 'slack';
  private _app: App | null = null;
  private _client: WebClient | null = null;
  private _config: SlackAdapterConfig | null = null;
  private _isConnected: boolean = false;
  private _botUserId: string = '';
  private _botInfo: { id: string; name: string } | null = null;

  // ==========================================================================
  // Connection Lifecycle
  // ==========================================================================

  get isConnected(): boolean {
    return this._isConnected;
  }

  /**
   * Connect to Slack using Bolt SDK
   *
   * @param config - Adapter configuration
   * @throws Error if token is missing or connection fails
   */
  async connect(config: AdapterConfig): Promise<void> {
    const slackConfig = config as SlackAdapterConfig;

    if (!slackConfig.token) {
      throw new Error('Slack bot token is required');
    }

    this._config = {
      ...DEFAULT_CONFIG,
      ...slackConfig,
      // Determine socket mode based on available tokens
      socketMode: slackConfig.socketMode ?? !!slackConfig.appToken,
    };

    logger.info('Connecting Slack adapter', {
      socketMode: this._config.socketMode,
    });

    try {
      // Create Bolt app
      const appConfig: ConstructorParameters<typeof App>[0] = {
        token: this._config.token,
        logLevel: LogLevel.WARN,
      };

      if (this._config.socketMode && this._config.appToken) {
        appConfig.socketMode = true;
        appConfig.appToken = this._config.appToken;
      } else if (this._config.signingSecret) {
        appConfig.signingSecret = this._config.signingSecret;
      } else {
        throw new Error('Either appToken (for Socket Mode) or signingSecret (for HTTP) is required');
      }

      this._app = new App(appConfig);
      this._client = this._app.client;

      // Set up event handlers
      this._setupHandlers();

      // Start the app
      if (this._config.socketMode) {
        await this._app.start();
        logger.info('Slack app started in Socket Mode');
      } else {
        await this._app.start(this._config.port || 3000);
        logger.info('Slack app started in HTTP mode', { port: this._config.port });
      }

      // Get bot info
      const authResult = await this._client.auth.test();
      this._botUserId = authResult.user_id || '';
      this._botInfo = {
        id: authResult.user_id || '',
        name: authResult.user || '',
      };

      this._isConnected = true;
      this.emit('connected');

      logger.info('Slack adapter connected', {
        botId: this._botUserId,
        botName: this._botInfo.name,
      });
    } catch (error) {
      logger.error('Failed to connect Slack adapter', { error });
      throw error;
    }
  }

  /**
   * Disconnect from Slack
   */
  async disconnect(): Promise<void> {
    logger.info('Disconnecting Slack adapter');

    if (this._app) {
      try {
        await this._app.stop();
      } catch (error) {
        logger.warn('Error stopping app', { error });
      }
      this._app = null;
      this._client = null;
    }

    this._isConnected = false;
    this._botUserId = '';
    this._botInfo = null;

    this.emit('disconnected');
    logger.info('Slack adapter disconnected');
  }

  // ==========================================================================
  // Event Handlers
  // ==========================================================================

  /**
   * Set up Bolt event handlers
   */
  private _setupHandlers(): void {
    if (!this._app) return;

    // Handle all messages
    this._app.message(async ({ message }) => {
      await this._handleMessage(message as SlackMessageEvent);
    });

    // Handle app mentions (when @mentioned)
    this._app.event('app_mention', async ({ event }) => {
      await this._handleAppMention(event as AppMentionEvent);
    });

    // Handle reactions
    this._app.event('reaction_added', async ({ event }) => {
      this._handleReactionAdded(event as ReactionAddedEvent);
    });

    // Handle errors
    this._app.error(async (error) => {
      logger.error('Slack app error', { error });
      this.emit('error', error);
    });

    logger.debug('Slack handlers set up');
  }

  /**
   * Handle incoming message
   */
  private async _handleMessage(message: SlackMessageEvent): Promise<void> {
    // Skip bot messages
    if ('bot_id' in message || message.subtype === 'bot_message') return;

    // Skip message_changed events (edits)
    if (message.subtype === 'message_changed') return;

    // Determine if this is a DM
    const isDM = message.channel_type === 'im';
    const isChannel = message.channel_type === 'channel' || message.channel_type === 'group';

    // Check DM permissions
    if (isDM && !this._config?.allowDMs) return;

    // Check channel permissions
    if (isChannel && this._config?.allowedChannels?.length) {
      if (!this._config.allowedChannels.includes(message.channel)) return;
    }

    // For channels, check mention requirement (unless this came from app_mention)
    if (isChannel && this._config?.requireMention) {
      if (!this._isBotMentioned(message.text || '')) {
        return;
      }
    }

    // Build and emit incoming message
    const incomingMessage = await this._buildIncomingMessage(message);

    // Remove bot mention from content if present
    if (this._botUserId) {
      incomingMessage.content = incomingMessage.content
        .replace(new RegExp(`<@${this._botUserId}>\\s*`, 'g'), '')
        .trim();
    }

    this._emitMessage(incomingMessage);
  }

  /**
   * Handle app mention (explicit @mention)
   */
  private async _handleAppMention(event: {
    user: string;
    text: string;
    ts: string;
    channel: string;
    thread_ts?: string;
  }): Promise<void> {
    // Build incoming message
    const incomingMessage = await this._buildAppMentionMessage(event);

    // Remove bot mention from content
    if (this._botUserId) {
      incomingMessage.content = incomingMessage.content
        .replace(new RegExp(`<@${this._botUserId}>\\s*`, 'g'), '')
        .trim();
    }

    this._emitMessage(incomingMessage);
  }

  /**
   * Handle reaction added
   */
  private _handleReactionAdded(event: ReactionAddedEvent): void {
    // Skip our own reactions
    if (event.user === this._botUserId) return;

    this.emit('reaction', {
      messageId: event.item.ts,
      chatId: event.item.channel,
      emoji: event.reaction,
      userId: event.user,
    });
  }

  // ==========================================================================
  // Message Sending
  // ==========================================================================

  /**
   * Send a message to a Slack channel
   *
   * @param chatId - Slack channel ID
   * @param content - Message content
   * @param options - Send options
   * @returns Message timestamp (ts)
   */
  async send(chatId: string, content: string, options?: SendOptions): Promise<string> {
    if (!this._client) {
      throw new Error('Slack adapter not connected');
    }

    // Chunk long messages
    const chunks = this._chunkMessage(content);

    let lastTs: string | undefined;

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const isLastChunk = i === chunks.length - 1;

      const sendOptions: Record<string, unknown> = {
        channel: chatId,
        text: chunk,
      };

      // Add thread_ts for replies
      if (options?.replyTo) {
        sendOptions.thread_ts = options.replyTo;
      }

      // Add blocks with buttons on last chunk
      if (isLastChunk && options?.buttons) {
        sendOptions.blocks = this._buildBlocks(chunk, options.buttons);
      }

      // Disable unfurling if requested
      if (options?.disablePreview) {
        sendOptions.unfurl_links = false;
        sendOptions.unfurl_media = false;
      }

      const result = await this._client.chat.postMessage(sendOptions as ChatPostMessageArguments);
      lastTs = result.ts;
    }

    logger.debug('Slack message sent', {
      chatId,
      contentLength: content.length,
      chunks: chunks.length,
    });

    return lastTs || '';
  }

  /**
   * Send typing indicator
   *
   * Note: Slack doesn't have a built-in typing indicator for bots,
   * but we can use a workaround with reactions or temporary messages
   */
  async sendTyping(chatId: string): Promise<void> {
    // Slack doesn't support typing indicators for bots
    // This is a no-op but maintains the interface
    logger.debug('Typing indicator not supported on Slack', { chatId });
  }

  /**
   * Edit a message
   */
  async editMessage(chatId: string, messageId: string, content: string): Promise<void> {
    if (!this._client) {
      throw new Error('Slack adapter not connected');
    }

    await this._client.chat.update({
      channel: chatId,
      ts: messageId,
      text: content,
    });

    logger.debug('Slack message edited', { chatId, messageId });
  }

  /**
   * Delete a message
   */
  async deleteMessage(chatId: string, messageId: string): Promise<void> {
    if (!this._client) {
      throw new Error('Slack adapter not connected');
    }

    await this._client.chat.delete({
      channel: chatId,
      ts: messageId,
    });

    logger.debug('Slack message deleted', { chatId, messageId });
  }

  /**
   * React to a message
   */
  async react(chatId: string, messageId: string, emoji: string): Promise<void> {
    if (!this._client) {
      throw new Error('Slack adapter not connected');
    }

    // Remove colons from emoji name
    const emojiName = emoji.replace(/:/g, '');

    await this._client.reactions.add({
      channel: chatId,
      timestamp: messageId,
      name: emojiName,
    });

    logger.debug('Slack reaction added', { chatId, messageId, emoji: emojiName });
  }

  /**
   * Get channel information
   */
  async getChat(
    chatId: string
  ): Promise<{ id: string; name: string; type: 'private' | 'group' | 'channel' }> {
    if (!this._client) {
      throw new Error('Slack adapter not connected');
    }

    try {
      const result = await this._client.conversations.info({
        channel: chatId,
      });

      const channel = result.channel;
      if (!channel) {
        return { id: chatId, name: 'Unknown', type: 'channel' };
      }

      let type: 'private' | 'group' | 'channel' = 'channel';
      if (channel.is_im) {
        type = 'private';
      } else if (channel.is_group || channel.is_mpim) {
        type = 'group';
      }

      return {
        id: chatId,
        name: channel.name || channel.id || 'Unknown',
        type,
      };
    } catch (error) {
      logger.warn('Failed to get channel info', { chatId, error });
      return { id: chatId, name: 'Unknown', type: 'channel' };
    }
  }

  // ==========================================================================
  // Helper Methods
  // ==========================================================================

  /**
   * Check if the bot is mentioned in the text
   */
  private _isBotMentioned(text: string): boolean {
    if (!this._botUserId) return false;
    return text.includes(`<@${this._botUserId}>`);
  }

  /**
   * Build an IncomingMessage from Slack message event
   */
  private async _buildIncomingMessage(message: GenericMessageEvent): Promise<IncomingMessage> {
    const isDM = message.channel_type === 'im';
    const attachments: MessageAttachment[] = [];

    // Process files
    if (message.files) {
      for (const file of message.files) {
        let type: MessageAttachment['type'] = 'file';

        if (file.mimetype?.startsWith('image/')) {
          type = 'image';
        } else if (file.mimetype?.startsWith('video/')) {
          type = 'video';
        } else if (file.mimetype?.startsWith('audio/')) {
          type = 'audio';
        }

        attachments.push({
          type,
          url: file.url_private,
          mimeType: file.mimetype || undefined,
          filename: file.name || undefined,
          size: file.size,
        });
      }
    }

    // Get user info
    let userName = 'Unknown';
    if (this._client && message.user) {
      try {
        const userInfo = await this._client.users.info({ user: message.user });
        userName = userInfo.user?.real_name || userInfo.user?.name || 'Unknown';
      } catch {
        userName = message.user;
      }
    }

    // Get channel info for groups
    let groupInfo: { id: string; name: string } | undefined;
    if (!isDM && this._client) {
      try {
        const channelInfo = await this._client.conversations.info({ channel: message.channel });
        groupInfo = {
          id: message.channel,
          name: channelInfo.channel?.name || 'Channel',
        };
      } catch {
        groupInfo = { id: message.channel, name: 'Channel' };
      }
    }

    return {
      id: message.ts,
      channel: 'slack',
      chatId: message.channel,
      sender: {
        id: message.user || 'unknown',
        name: userName,
      },
      content: message.text || '',
      attachments: attachments.length > 0 ? attachments : undefined,
      isGroup: !isDM,
      group: groupInfo,
      replyTo: message.thread_ts,
      timestamp: parseFloat(message.ts) * 1000,
      raw: message,
    };
  }

  /**
   * Build an IncomingMessage from app_mention event
   */
  private async _buildAppMentionMessage(event: {
    user: string;
    text: string;
    ts: string;
    channel: string;
    thread_ts?: string;
  }): Promise<IncomingMessage> {
    // Get user info
    let userName = 'Unknown';
    if (this._client) {
      try {
        const userInfo = await this._client.users.info({ user: event.user });
        userName = userInfo.user?.real_name || userInfo.user?.name || 'Unknown';
      } catch {
        userName = event.user;
      }
    }

    // Get channel info
    let groupInfo: { id: string; name: string } | undefined;
    if (this._client) {
      try {
        const channelInfo = await this._client.conversations.info({ channel: event.channel });
        groupInfo = {
          id: event.channel,
          name: channelInfo.channel?.name || 'Channel',
        };
      } catch {
        groupInfo = { id: event.channel, name: 'Channel' };
      }
    }

    return {
      id: event.ts,
      channel: 'slack',
      chatId: event.channel,
      sender: {
        id: event.user,
        name: userName,
      },
      content: event.text,
      isGroup: true,
      group: groupInfo,
      replyTo: event.thread_ts,
      timestamp: parseFloat(event.ts) * 1000,
      raw: event,
    };
  }

  /**
   * Emit an incoming message
   */
  private _emitMessage(message: IncomingMessage): void {
    this.emit('message', message);
    logger.debug('Message received', {
      channel: 'slack',
      chatId: message.chatId,
      senderId: message.sender.id,
      isGroup: message.isGroup,
    });
  }

  /**
   * Build Slack blocks with buttons
   */
  private _buildBlocks(
    text: string,
    buttons: MessageButton[][]
  ): Parameters<WebClient['chat']['postMessage']>[0]['blocks'] {
    const blocks: Parameters<WebClient['chat']['postMessage']>[0]['blocks'] = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text,
        },
      },
    ];

    // Add button rows
    for (const row of buttons) {
      const elements: any[] = row.map((button) => {
        if (button.type === 'url') {
          return {
            type: 'button',
            text: {
              type: 'plain_text',
              text: button.text,
            },
            url: button.data,
          };
        }

        return {
          type: 'button',
          text: {
            type: 'plain_text',
            text: button.text,
          },
          action_id: button.data,
        };
      });

      blocks.push({
        type: 'actions',
        elements,
      });
    }

    return blocks;
  }

  /**
   * Chunk a message that exceeds max length
   */
  private _chunkMessage(content: string): string[] {
    const maxLength = this._config?.maxMessageLength || 3000;

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

export default SlackAdapter;
