/**
 * @fileoverview Telegram Channel Adapter - Full grammY implementation
 * @module channels/telegram-adapter
 * @author Atlas Team
 * @since 1.0.0
 *
 * @description
 * Full-featured Telegram bot adapter using the grammY library.
 * Implements all Clawdbot Telegram features:
 * - Bot API integration with long-polling (default) and webhook modes
 * - DM and group message handling
 * - Message formatting (MarkdownV2, HTML)
 * - Inline keyboards and buttons
 * - Media support (images, documents, voice, video)
 * - Reactions and message editing
 * - Draft streaming (Telegram 9.3+)
 * - Mention-based activation for groups
 *
 * Configuration:
 * - TELEGRAM_BOT_TOKEN: Bot token from @BotFather
 * - Optional: Webhook URL for production deployments
 *
 * @example
 * ```typescript
 * const adapter = new TelegramAdapter();
 * await adapter.connect({ token: process.env.TELEGRAM_BOT_TOKEN });
 *
 * adapter.on('message', (msg) => {
 *   console.log(`Message from ${msg.sender.name}: ${msg.content}`);
 * });
 *
 * await adapter.send(chatId, 'Hello from Atlas!', { parseMode: 'markdown' });
 * ```
 */

import { Bot, Context, InlineKeyboard, GrammyError, HttpError } from 'grammy';
import { Message, Update, Chat, User } from 'grammy/types';
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

const logger = createModuleLogger('TelegramAdapter');

// =============================================================================
// Types
// =============================================================================

/**
 * Telegram-specific adapter configuration
 */
export interface TelegramAdapterConfig extends AdapterConfig {
  /** Bot token from @BotFather */
  token: string;
  /** Use webhook instead of long-polling */
  useWebhook?: boolean;
  /** Webhook URL (required if useWebhook is true) */
  webhookUrl?: string;
  /** Webhook secret for verification */
  webhookSecret?: string;
  /** Require mention in groups (default: true) */
  requireMention?: boolean;
  /** Allow DM messages (default: true) */
  allowDMs?: boolean;
  /** Max message length before chunking (default: 4000) */
  maxMessageLength?: number;
  /** Enable draft streaming for real-time updates */
  enableDraftStreaming?: boolean;
}

/**
 * Draft message state for streaming
 */
interface DraftMessage {
  chatId: number;
  messageId: number;
  content: string;
  lastUpdate: number;
}

// =============================================================================
// Telegram Adapter
// =============================================================================

/**
 * Telegram adapter using grammY library
 *
 * Provides full Telegram Bot API integration with support for:
 * - Text messages with formatting
 * - Media (photos, documents, voice, video)
 * - Inline keyboards
 * - Message editing and deletion
 * - Reactions
 * - Draft streaming for real-time responses
 *
 * @class TelegramAdapter
 * @extends EventEmitter
 * @implements ChannelAdapter
 */
export class TelegramAdapter extends EventEmitter implements ChannelAdapter {
  readonly channel: ChannelType = 'telegram';
  private _bot: Bot | null = null;
  private _config: TelegramAdapterConfig | null = null;
  private _isConnected: boolean = false;
  private _botInfo: User | null = null;

  // Draft streaming state
  private _draftMessages: Map<string, DraftMessage> = new Map();
  private _draftUpdateDebounce: number = 300; // ms between draft updates

  // ==========================================================================
  // Connection Lifecycle
  // ==========================================================================

  get isConnected(): boolean {
    return this._isConnected;
  }

  /**
   * Connect to Telegram using bot token
   *
   * @param config - Adapter configuration with bot token
   * @throws Error if token is missing or connection fails
   */
  async connect(config: AdapterConfig): Promise<void> {
    const telegramConfig = config as TelegramAdapterConfig;

    if (!telegramConfig.token) {
      throw new Error('Telegram bot token is required');
    }

    this._config = {
      token: telegramConfig.token,
      useWebhook: telegramConfig.useWebhook ?? false,
      webhookUrl: telegramConfig.webhookUrl,
      webhookSecret: telegramConfig.webhookSecret,
      requireMention: telegramConfig.requireMention ?? true,
      allowDMs: telegramConfig.allowDMs ?? true,
      maxMessageLength: telegramConfig.maxMessageLength ?? 4000,
      enableDraftStreaming: telegramConfig.enableDraftStreaming ?? true,
    };

    logger.info('Connecting Telegram adapter');

    try {
      // Create bot instance
      this._bot = new Bot(this._config.token);

      // Set up message handlers
      this._setupHandlers();

      // Get bot info
      this._botInfo = await this._bot.api.getMe();
      logger.info('Bot info retrieved', {
        username: this._botInfo.username,
        id: this._botInfo.id,
      });

      // Start the bot
      if (this._config.useWebhook && this._config.webhookUrl) {
        // Webhook mode for production
        await this._bot.api.setWebhook(this._config.webhookUrl, {
          secret_token: this._config.webhookSecret,
        });
        logger.info('Webhook set', { url: this._config.webhookUrl });
      } else {
        // Long-polling mode (default)
        this._bot.start({
          onStart: () => {
            logger.info('Telegram bot started (long-polling)');
          },
        });
      }

      this._isConnected = true;
      this.emit('connected');
      logger.info('Telegram adapter connected', { username: this._botInfo.username });
    } catch (error) {
      logger.error('Failed to connect Telegram adapter', { error });
      throw error;
    }
  }

  /**
   * Disconnect from Telegram
   */
  async disconnect(): Promise<void> {
    logger.info('Disconnecting Telegram adapter');

    if (this._bot) {
      try {
        await this._bot.stop();
      } catch (error) {
        logger.warn('Error stopping bot', { error });
      }
      this._bot = null;
    }

    this._draftMessages.clear();
    this._isConnected = false;
    this._botInfo = null;

    this.emit('disconnected');
    logger.info('Telegram adapter disconnected');
  }

  // ==========================================================================
  // Message Handlers
  // ==========================================================================

  /**
   * Set up bot message handlers
   */
  private _setupHandlers(): void {
    if (!this._bot) return;

    // Handle all text messages
    this._bot.on('message:text', (ctx) => this._handleTextMessage(ctx));

    // Handle photo messages
    this._bot.on('message:photo', (ctx) => this._handlePhotoMessage(ctx));

    // Handle document messages
    this._bot.on('message:document', (ctx) => this._handleDocumentMessage(ctx));

    // Handle voice messages
    this._bot.on('message:voice', (ctx) => this._handleVoiceMessage(ctx));

    // Handle video messages
    this._bot.on('message:video', (ctx) => this._handleVideoMessage(ctx));

    // Handle sticker messages
    this._bot.on('message:sticker', (ctx) => this._handleStickerMessage(ctx));

    // Handle location messages
    this._bot.on('message:location', (ctx) => this._handleLocationMessage(ctx));

    // Handle callback queries (inline keyboard buttons)
    this._bot.on('callback_query:data', (ctx) => this._handleCallbackQuery(ctx));

    // Handle edited messages
    this._bot.on('edited_message', (ctx) => this._handleEditedMessage(ctx));

    // Error handling
    this._bot.catch((err) => {
      const ctx = err.ctx;
      logger.error('Bot error', {
        error: err.error,
        updateId: ctx?.update?.update_id,
      });

      if (err.error instanceof GrammyError) {
        logger.error('Grammy error', {
          description: err.error.description,
          errorCode: err.error.error_code,
        });
      } else if (err.error instanceof HttpError) {
        logger.error('HTTP error', { error: err.error });
      }

      this.emit('error', err.error);
    });

    logger.debug('Telegram handlers set up');
  }

  /**
   * Handle incoming text message
   */
  private async _handleTextMessage(ctx: Context): Promise<void> {
    const message = ctx.message;
    if (!message || !message.text) return;

    const chat = message.chat;
    const from = message.from;
    if (!from) return;

    // Check if this is a group message
    const isGroup = chat.type === 'group' || chat.type === 'supergroup';

    // For groups, check if mention is required
    if (isGroup && this._config?.requireMention) {
      if (!this._isBotMentioned(message)) {
        // Silently ignore messages that don't mention the bot
        return;
      }
    }

    // For DMs, check if DMs are allowed
    if (chat.type === 'private' && !this._config?.allowDMs) {
      return;
    }

    // Build incoming message
    const incomingMessage = this._buildIncomingMessage(message, chat, from);

    // Remove bot mention from content if present
    if (this._botInfo?.username) {
      incomingMessage.content = incomingMessage.content
        .replace(new RegExp(`@${this._botInfo.username}\\s*`, 'gi'), '')
        .trim();
    }

    this._emitMessage(incomingMessage);
  }

  /**
   * Handle photo message
   */
  private async _handlePhotoMessage(ctx: Context): Promise<void> {
    const message = ctx.message;
    if (!message || !message.photo) return;

    const chat = message.chat;
    const from = message.from;
    if (!from) return;

    // Get the largest photo
    const photo = message.photo[message.photo.length - 1];
    const file = await ctx.api.getFile(photo.file_id);
    const fileUrl = `https://api.telegram.org/file/bot${this._config?.token}/${file.file_path}`;

    const attachment: MessageAttachment = {
      type: 'image',
      url: fileUrl,
      mimeType: 'image/jpeg',
      size: photo.file_size,
      caption: message.caption,
    };

    const incomingMessage = this._buildIncomingMessage(message, chat, from, [attachment]);
    incomingMessage.content = message.caption || '[Photo]';

    this._emitMessage(incomingMessage);
  }

  /**
   * Handle document message
   */
  private async _handleDocumentMessage(ctx: Context): Promise<void> {
    const message = ctx.message;
    if (!message || !message.document) return;

    const chat = message.chat;
    const from = message.from;
    if (!from) return;

    const doc = message.document;
    const file = await ctx.api.getFile(doc.file_id);
    const fileUrl = `https://api.telegram.org/file/bot${this._config?.token}/${file.file_path}`;

    const attachment: MessageAttachment = {
      type: 'file',
      url: fileUrl,
      mimeType: doc.mime_type,
      filename: doc.file_name,
      size: doc.file_size,
      caption: message.caption,
    };

    const incomingMessage = this._buildIncomingMessage(message, chat, from, [attachment]);
    incomingMessage.content = message.caption || `[File: ${doc.file_name || 'document'}]`;

    this._emitMessage(incomingMessage);
  }

  /**
   * Handle voice message
   */
  private async _handleVoiceMessage(ctx: Context): Promise<void> {
    const message = ctx.message;
    if (!message || !message.voice) return;

    const chat = message.chat;
    const from = message.from;
    if (!from) return;

    const voice = message.voice;
    const file = await ctx.api.getFile(voice.file_id);
    const fileUrl = `https://api.telegram.org/file/bot${this._config?.token}/${file.file_path}`;

    const attachment: MessageAttachment = {
      type: 'voice',
      url: fileUrl,
      mimeType: voice.mime_type || 'audio/ogg',
      size: voice.file_size,
      duration: voice.duration,
    };

    const incomingMessage = this._buildIncomingMessage(message, chat, from, [attachment]);
    incomingMessage.content = '[Voice message]';

    this._emitMessage(incomingMessage);
  }

  /**
   * Handle video message
   */
  private async _handleVideoMessage(ctx: Context): Promise<void> {
    const message = ctx.message;
    if (!message || !message.video) return;

    const chat = message.chat;
    const from = message.from;
    if (!from) return;

    const video = message.video;
    const file = await ctx.api.getFile(video.file_id);
    const fileUrl = `https://api.telegram.org/file/bot${this._config?.token}/${file.file_path}`;

    const attachment: MessageAttachment = {
      type: 'video',
      url: fileUrl,
      mimeType: video.mime_type || 'video/mp4',
      size: video.file_size,
      duration: video.duration,
      caption: message.caption,
    };

    const incomingMessage = this._buildIncomingMessage(message, chat, from, [attachment]);
    incomingMessage.content = message.caption || '[Video]';

    this._emitMessage(incomingMessage);
  }

  /**
   * Handle sticker message
   */
  private async _handleStickerMessage(ctx: Context): Promise<void> {
    const message = ctx.message;
    if (!message || !message.sticker) return;

    const chat = message.chat;
    const from = message.from;
    if (!from) return;

    const sticker = message.sticker;

    const attachment: MessageAttachment = {
      type: 'sticker',
      mimeType: sticker.is_animated ? 'application/x-tgsticker' : 'image/webp',
    };

    const incomingMessage = this._buildIncomingMessage(message, chat, from, [attachment]);
    incomingMessage.content = sticker.emoji || '[Sticker]';

    this._emitMessage(incomingMessage);
  }

  /**
   * Handle location message
   */
  private async _handleLocationMessage(ctx: Context): Promise<void> {
    const message = ctx.message;
    if (!message || !message.location) return;

    const chat = message.chat;
    const from = message.from;
    if (!from) return;

    const location = message.location;

    const attachment: MessageAttachment = {
      type: 'location',
      location: {
        latitude: location.latitude,
        longitude: location.longitude,
      },
    };

    const incomingMessage = this._buildIncomingMessage(message, chat, from, [attachment]);
    incomingMessage.content = `[Location: ${location.latitude}, ${location.longitude}]`;

    this._emitMessage(incomingMessage);
  }

  /**
   * Handle callback query (inline button press)
   */
  private async _handleCallbackQuery(ctx: Context): Promise<void> {
    const callback = ctx.callbackQuery;
    if (!callback || !callback.data) return;

    const from = callback.from;
    const message = callback.message;

    // Acknowledge the callback
    await ctx.answerCallbackQuery();

    // Emit as a special event
    this.emit('callback', {
      id: callback.id,
      data: callback.data,
      userId: from.id.toString(),
      username: from.username,
      chatId: message?.chat?.id?.toString(),
      messageId: message?.message_id?.toString(),
    });
  }

  /**
   * Handle edited message
   */
  private async _handleEditedMessage(ctx: Context): Promise<void> {
    const message = ctx.editedMessage;
    if (!message) return;

    const chat = message.chat;
    const from = message.from;
    if (!from) return;

    const incomingMessage = this._buildIncomingMessage(
      message as Message.TextMessage,
      chat,
      from
    );

    this.emit('message-edit', incomingMessage);
  }

  // ==========================================================================
  // Message Sending
  // ==========================================================================

  /**
   * Send a message to a Telegram chat
   *
   * @param chatId - Telegram chat ID
   * @param content - Message content
   * @param options - Send options (formatting, buttons, etc.)
   * @returns Message ID
   */
  async send(chatId: string, content: string, options?: SendOptions): Promise<string> {
    if (!this._bot) {
      throw new Error('Telegram adapter not connected');
    }

    const numericChatId = parseInt(chatId, 10);
    if (isNaN(numericChatId)) {
      throw new Error(`Invalid chat ID: ${chatId}`);
    }

    // Chunk long messages
    const chunks = this._chunkMessage(content);

    let lastMessageId: number | undefined;

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const isLastChunk = i === chunks.length - 1;

      // Only add buttons to the last chunk
      const sendOptions: Parameters<Bot['api']['sendMessage']>[2] = {
        parse_mode: this._getParseMode(options?.parseMode),
        link_preview_options: options?.disablePreview ? { is_disabled: true } : undefined,
        disable_notification: options?.silent,
        reply_parameters: options?.replyTo
          ? { message_id: parseInt(options.replyTo, 10) }
          : undefined,
      };

      // Add inline keyboard if present and this is the last chunk
      if (isLastChunk && options?.buttons) {
        sendOptions.reply_markup = this._buildInlineKeyboard(options.buttons);
      }

      const result = await this._bot.api.sendMessage(numericChatId, chunk, sendOptions);
      lastMessageId = result.message_id;
    }

    logger.debug('Telegram message sent', {
      chatId,
      contentLength: content.length,
      chunks: chunks.length,
    });

    return lastMessageId?.toString() || '';
  }

  /**
   * Send typing indicator
   */
  async sendTyping(chatId: string): Promise<void> {
    if (!this._bot) return;

    const numericChatId = parseInt(chatId, 10);
    if (isNaN(numericChatId)) return;

    try {
      await this._bot.api.sendChatAction(numericChatId, 'typing');
    } catch (error) {
      logger.debug('Failed to send typing indicator', { chatId, error });
    }
  }

  /**
   * Edit a message
   */
  async editMessage(chatId: string, messageId: string, content: string): Promise<void> {
    if (!this._bot) {
      throw new Error('Telegram adapter not connected');
    }

    const numericChatId = parseInt(chatId, 10);
    const numericMessageId = parseInt(messageId, 10);

    if (isNaN(numericChatId) || isNaN(numericMessageId)) {
      throw new Error('Invalid chat ID or message ID');
    }

    await this._bot.api.editMessageText(numericChatId, numericMessageId, content, {
      parse_mode: 'HTML',
    });

    logger.debug('Telegram message edited', { chatId, messageId });
  }

  /**
   * Delete a message
   */
  async deleteMessage(chatId: string, messageId: string): Promise<void> {
    if (!this._bot) {
      throw new Error('Telegram adapter not connected');
    }

    const numericChatId = parseInt(chatId, 10);
    const numericMessageId = parseInt(messageId, 10);

    if (isNaN(numericChatId) || isNaN(numericMessageId)) {
      throw new Error('Invalid chat ID or message ID');
    }

    await this._bot.api.deleteMessage(numericChatId, numericMessageId);
    logger.debug('Telegram message deleted', { chatId, messageId });
  }

  /**
   * React to a message with an emoji
   */
  async react(chatId: string, messageId: string, emoji: string): Promise<void> {
    if (!this._bot) {
      throw new Error('Telegram adapter not connected');
    }

    const numericChatId = parseInt(chatId, 10);
    const numericMessageId = parseInt(messageId, 10);

    if (isNaN(numericChatId) || isNaN(numericMessageId)) {
      throw new Error('Invalid chat ID or message ID');
    }

    // Cast emoji to the expected type - Telegram has a specific set of allowed reactions
    await this._bot.api.setMessageReaction(numericChatId, numericMessageId, [
      { type: 'emoji', emoji: emoji as '👍' },
    ]);

    logger.debug('Telegram reaction added', { chatId, messageId, emoji });
  }

  /**
   * Get chat information
   */
  async getChat(
    chatId: string
  ): Promise<{ id: string; name: string; type: 'private' | 'group' | 'channel' }> {
    if (!this._bot) {
      throw new Error('Telegram adapter not connected');
    }

    const numericChatId = parseInt(chatId, 10);
    if (isNaN(numericChatId)) {
      throw new Error(`Invalid chat ID: ${chatId}`);
    }

    const chat = await this._bot.api.getChat(numericChatId);

    let name = 'Unknown';
    if ('title' in chat) {
      name = chat.title;
    } else if ('first_name' in chat) {
      name = chat.first_name + (chat.last_name ? ` ${chat.last_name}` : '');
    }

    let type: 'private' | 'group' | 'channel' = 'private';
    if (chat.type === 'group' || chat.type === 'supergroup') {
      type = 'group';
    } else if (chat.type === 'channel') {
      type = 'channel';
    }

    return { id: chatId, name, type };
  }

  // ==========================================================================
  // Draft Streaming
  // ==========================================================================

  /**
   * Start a draft message for streaming responses
   *
   * Creates an initial message that can be updated as the response streams in.
   * This provides a real-time typing effect for longer responses.
   *
   * @param chatId - Chat to send draft to
   * @param initialContent - Initial content (usually "..." or similar)
   * @returns Draft message ID
   */
  async startDraft(chatId: string, initialContent: string = '...'): Promise<string> {
    if (!this._bot || !this._config?.enableDraftStreaming) {
      // Fall back to regular send if streaming disabled
      return this.send(chatId, initialContent);
    }

    const numericChatId = parseInt(chatId, 10);
    if (isNaN(numericChatId)) {
      throw new Error(`Invalid chat ID: ${chatId}`);
    }

    const result = await this._bot.api.sendMessage(numericChatId, initialContent);
    const draftKey = `${chatId}:${result.message_id}`;

    this._draftMessages.set(draftKey, {
      chatId: numericChatId,
      messageId: result.message_id,
      content: initialContent,
      lastUpdate: Date.now(),
    });

    return result.message_id.toString();
  }

  /**
   * Update a draft message with new content
   *
   * Debounces updates to avoid rate limiting
   *
   * @param chatId - Chat ID
   * @param messageId - Draft message ID
   * @param content - Updated content
   */
  async updateDraft(chatId: string, messageId: string, content: string): Promise<void> {
    if (!this._bot || !this._config?.enableDraftStreaming) return;

    const draftKey = `${chatId}:${messageId}`;
    const draft = this._draftMessages.get(draftKey);

    if (!draft) {
      logger.warn('Draft message not found', { chatId, messageId });
      return;
    }

    const now = Date.now();
    const timeSinceLastUpdate = now - draft.lastUpdate;

    // Debounce updates
    if (timeSinceLastUpdate < this._draftUpdateDebounce) {
      // Store content for later but don't send yet
      draft.content = content;
      return;
    }

    try {
      await this._bot.api.editMessageText(draft.chatId, draft.messageId, content, {
        parse_mode: 'HTML',
      });

      draft.content = content;
      draft.lastUpdate = now;
    } catch (error) {
      // Message might not have changed or other transient error
      logger.debug('Failed to update draft', { error });
    }
  }

  /**
   * Finalize a draft message
   *
   * Sends final update and cleans up draft state
   *
   * @param chatId - Chat ID
   * @param messageId - Draft message ID
   * @param finalContent - Final message content
   */
  async finalizeDraft(chatId: string, messageId: string, finalContent: string): Promise<void> {
    if (!this._bot) return;

    const draftKey = `${chatId}:${messageId}`;
    const draft = this._draftMessages.get(draftKey);

    if (draft) {
      try {
        await this._bot.api.editMessageText(draft.chatId, draft.messageId, finalContent, {
          parse_mode: 'HTML',
        });
      } catch (error) {
        logger.debug('Failed to finalize draft', { error });
      }

      this._draftMessages.delete(draftKey);
    }
  }

  // ==========================================================================
  // Helper Methods
  // ==========================================================================

  /**
   * Check if the bot is mentioned in the message
   */
  private _isBotMentioned(message: Message.TextMessage): boolean {
    if (!this._botInfo) return false;

    const text = message.text || '';
    const entities = message.entities || [];

    // Check for @mention
    if (this._botInfo.username) {
      const mentionPattern = new RegExp(`@${this._botInfo.username}`, 'i');
      if (mentionPattern.test(text)) return true;
    }

    // Check entities for mentions
    for (const entity of entities) {
      if (entity.type === 'mention') {
        const mention = text.substring(entity.offset, entity.offset + entity.length);
        if (mention.toLowerCase() === `@${this._botInfo.username?.toLowerCase()}`) {
          return true;
        }
      }
      if (entity.type === 'text_mention' && entity.user?.id === this._botInfo.id) {
        return true;
      }
    }

    // Check for reply to bot
    if (message.reply_to_message?.from?.id === this._botInfo.id) {
      return true;
    }

    return false;
  }

  /**
   * Build an IncomingMessage from Telegram message data
   */
  private _buildIncomingMessage(
    message: Message,
    chat: Chat,
    from: User,
    attachments?: MessageAttachment[]
  ): IncomingMessage {
    const isGroup = chat.type === 'group' || chat.type === 'supergroup';

    return {
      id: message.message_id.toString(),
      channel: 'telegram',
      chatId: chat.id.toString(),
      sender: {
        id: from.id.toString(),
        name: from.first_name + (from.last_name ? ` ${from.last_name}` : ''),
        username: from.username,
      },
      content: 'text' in message ? (message.text as string) || '' : '',
      attachments,
      isGroup,
      group: isGroup
        ? {
            id: chat.id.toString(),
            name: 'title' in chat ? chat.title : 'Group',
          }
        : undefined,
      replyTo: message.reply_to_message?.message_id?.toString(),
      timestamp: message.date * 1000, // Convert to ms
      raw: message,
    };
  }

  /**
   * Emit an incoming message
   */
  private _emitMessage(message: IncomingMessage): void {
    this.emit('message', message);
    logger.debug('Message received', {
      channel: 'telegram',
      chatId: message.chatId,
      senderId: message.sender.id,
      isGroup: message.isGroup,
    });
  }

  /**
   * Get parse mode for Telegram API
   */
  private _getParseMode(mode?: 'text' | 'markdown' | 'html'): 'HTML' | 'MarkdownV2' | undefined {
    switch (mode) {
      case 'html':
        return 'HTML';
      case 'markdown':
        return 'MarkdownV2';
      default:
        return undefined;
    }
  }

  /**
   * Build inline keyboard from buttons
   */
  private _buildInlineKeyboard(buttons: MessageButton[][]): InlineKeyboard {
    const keyboard = new InlineKeyboard();

    for (const row of buttons) {
      for (const button of row) {
        if (button.type === 'url') {
          keyboard.url(button.text, button.data);
        } else if (button.type === 'callback') {
          keyboard.text(button.text, button.data);
        }
      }
      keyboard.row();
    }

    return keyboard;
  }

  /**
   * Chunk a message that exceeds max length
   */
  private _chunkMessage(content: string): string[] {
    const maxLength = this._config?.maxMessageLength || 4000;

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

export default TelegramAdapter;
