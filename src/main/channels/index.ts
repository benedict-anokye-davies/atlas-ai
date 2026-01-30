/**
 * @fileoverview Channel Adapters - Multi-platform messaging integration
 * @module channels
 * @author Atlas Team
 * @since 1.0.0
 *
 * @description
 * Provides adapters for various messaging platforms, enabling Atlas to
 * communicate across multiple channels. Each adapter implements the
 * ChannelAdapter interface for consistent message handling.
 *
 * Supported channels:
 * - Desktop (native Electron app)
 * - WebChat (browser-based)
 * - WhatsApp (via Baileys)
 * - Telegram (via grammY)
 * - Discord (via discord.js)
 * - Slack (via Bolt)
 *
 * @example
 * ```typescript
 * const adapter = getChannelAdapter('telegram');
 * await adapter.connect({ token: 'BOT_TOKEN' });
 * adapter.on('message', (msg) => console.log(msg));
 * await adapter.send(chatId, 'Hello from Atlas!');
 * ```
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import type { ChannelType } from '../../shared/types/gateway';

// Import full adapter implementations
import { TelegramAdapter } from './telegram-adapter';
import { DiscordAdapter } from './discord-adapter';
import { WhatsAppAdapter } from './whatsapp-adapter';
import { SlackAdapter } from './slack-adapter';

const logger = createModuleLogger('Channels');

// Re-export adapters for external use
export { TelegramAdapter } from './telegram-adapter';
export { DiscordAdapter } from './discord-adapter';
export { WhatsAppAdapter } from './whatsapp-adapter';
export { SlackAdapter } from './slack-adapter';

// =============================================================================
// Types
// =============================================================================

/**
 * Incoming message from a channel
 */
export interface IncomingMessage {
  /** Unique message ID */
  id: string;
  /** Channel type */
  channel: ChannelType;
  /** Channel-specific chat/conversation ID */
  chatId: string;
  /** Sender information */
  sender: {
    id: string;
    name?: string;
    username?: string;
    avatar?: string;
  };
  /** Message content */
  content: string;
  /** Optional attachments */
  attachments?: MessageAttachment[];
  /** Is this a group message? */
  isGroup?: boolean;
  /** Group information if applicable */
  group?: {
    id: string;
    name: string;
  };
  /** Reply to message ID */
  replyTo?: string;
  /** Timestamp */
  timestamp: number;
  /** Raw platform-specific data */
  raw?: unknown;
}

/**
 * Message attachment
 */
export interface MessageAttachment {
  /** Attachment type */
  type: 'image' | 'video' | 'audio' | 'file' | 'voice' | 'sticker' | 'location';
  /** URL or file path */
  url?: string;
  /** File data as buffer */
  data?: Buffer;
  /** MIME type */
  mimeType?: string;
  /** File name */
  filename?: string;
  /** File size in bytes */
  size?: number;
  /** Caption/description */
  caption?: string;
  /** Duration for audio/video */
  duration?: number;
  /** Location coordinates */
  location?: { latitude: number; longitude: number };
}

/**
 * Outgoing message options
 */
export interface SendOptions {
  /** Reply to a specific message */
  replyTo?: string;
  /** Parse mode for formatting */
  parseMode?: 'text' | 'markdown' | 'html';
  /** Disable link previews */
  disablePreview?: boolean;
  /** Silent message (no notification) */
  silent?: boolean;
  /** Attachments to send */
  attachments?: MessageAttachment[];
  /** Keyboard/buttons */
  buttons?: MessageButton[][];
}

/**
 * Message button for inline keyboards
 */
export interface MessageButton {
  /** Button text */
  text: string;
  /** Button type */
  type: 'callback' | 'url' | 'reply';
  /** Callback data or URL */
  data: string;
}

/**
 * Channel adapter configuration
 */
export interface AdapterConfig {
  /** Authentication token/credentials */
  token?: string;
  /** API key */
  apiKey?: string;
  /** Webhook URL */
  webhookUrl?: string;
  /** Phone number (for WhatsApp) */
  phoneNumber?: string;
  /** Additional options */
  options?: Record<string, unknown>;
}

/**
 * Channel adapter events
 */
export interface AdapterEvents {
  'connected': () => void;
  'disconnected': (reason?: string) => void;
  'message': (message: IncomingMessage) => void;
  'message-edit': (message: IncomingMessage) => void;
  'message-delete': (messageId: string, chatId: string) => void;
  'reaction': (data: { messageId: string; chatId: string; emoji: string; userId: string }) => void;
  'typing': (chatId: string, userId: string) => void;
  'error': (error: Error) => void;
  'qr': (qrCode: string) => void; // For WhatsApp pairing
}

/**
 * Channel adapter interface
 */
export interface ChannelAdapter extends EventEmitter {
  /** Channel type */
  readonly channel: ChannelType;
  /** Whether connected */
  readonly isConnected: boolean;
  /** Connect to the channel */
  connect(config: AdapterConfig): Promise<void>;
  /** Disconnect from the channel */
  disconnect(): Promise<void>;
  /** Send a message */
  send(chatId: string, content: string, options?: SendOptions): Promise<string>;
  /** Send typing indicator */
  sendTyping(chatId: string): Promise<void>;
  /** Edit a message */
  editMessage(chatId: string, messageId: string, content: string): Promise<void>;
  /** Delete a message */
  deleteMessage(chatId: string, messageId: string): Promise<void>;
  /** React to a message */
  react(chatId: string, messageId: string, emoji: string): Promise<void>;
  /** Get chat/conversation info */
  getChat(chatId: string): Promise<{ id: string; name: string; type: 'private' | 'group' | 'channel' }>;
}

// =============================================================================
// Base Adapter
// =============================================================================

/**
 * Base class for channel adapters.
 * Provides common functionality and enforces the adapter interface.
 */
export abstract class BaseAdapter extends EventEmitter implements ChannelAdapter {
  abstract readonly channel: ChannelType;
  protected _isConnected: boolean = false;
  protected _config: AdapterConfig = {};

  get isConnected(): boolean {
    return this._isConnected;
  }

  abstract connect(config: AdapterConfig): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract send(chatId: string, content: string, options?: SendOptions): Promise<string>;

  async sendTyping(chatId: string): Promise<void> {
    // Default implementation does nothing
    logger.debug('Typing indicator not supported', { channel: this.channel, chatId });
  }

  async editMessage(chatId: string, messageId: string, content: string): Promise<void> {
    throw new Error(`Message editing not supported on ${this.channel}`);
  }

  async deleteMessage(chatId: string, messageId: string): Promise<void> {
    throw new Error(`Message deletion not supported on ${this.channel}`);
  }

  async react(chatId: string, messageId: string, emoji: string): Promise<void> {
    throw new Error(`Reactions not supported on ${this.channel}`);
  }

  async getChat(chatId: string): Promise<{ id: string; name: string; type: 'private' | 'group' | 'channel' }> {
    return { id: chatId, name: 'Unknown', type: 'private' };
  }

  protected _emitMessage(message: IncomingMessage): void {
    this.emit('message', message);
    logger.debug('Message received', {
      channel: this.channel,
      chatId: message.chatId,
      senderId: message.sender.id,
    });
  }
}

// =============================================================================
// Desktop Adapter (Native Electron)
// =============================================================================

/**
 * Adapter for the native desktop application.
 * Messages come from the Electron renderer process.
 */
export class DesktopAdapter extends BaseAdapter {
  readonly channel: ChannelType = 'desktop';

  async connect(): Promise<void> {
    // Desktop is always connected
    this._isConnected = true;
    this.emit('connected');
    logger.info('Desktop adapter connected');
  }

  async disconnect(): Promise<void> {
    this._isConnected = false;
    this.emit('disconnected');
    logger.info('Desktop adapter disconnected');
  }

  async send(chatId: string, content: string, options?: SendOptions): Promise<string> {
    // Send via IPC to renderer
    // In real implementation, this would use BrowserWindow.webContents.send()
    const messageId = `desktop-${Date.now()}`;
    logger.debug('Sending desktop message', { chatId, contentLength: content.length });
    return messageId;
  }

  /**
   * Handle incoming message from renderer process
   */
  handleRendererMessage(content: string, userId: string = 'local-user'): void {
    const message: IncomingMessage = {
      id: `desktop-in-${Date.now()}`,
      channel: 'desktop',
      chatId: 'local',
      sender: {
        id: userId,
        name: 'User',
      },
      content,
      timestamp: Date.now(),
    };
    this._emitMessage(message);
  }
}

// =============================================================================
// WebChat Adapter
// =============================================================================

/**
 * Adapter for browser-based web chat.
 * Connects via WebSocket through the Gateway.
 */
export class WebChatAdapter extends BaseAdapter {
  readonly channel: ChannelType = 'webchat';
  private _clients: Map<string, { ws: unknown; userId: string }> = new Map();

  async connect(): Promise<void> {
    // WebChat connects via Gateway WebSocket
    this._isConnected = true;
    this.emit('connected');
    logger.info('WebChat adapter connected');
  }

  async disconnect(): Promise<void> {
    this._clients.clear();
    this._isConnected = false;
    this.emit('disconnected');
    logger.info('WebChat adapter disconnected');
  }

  async send(chatId: string, content: string, options?: SendOptions): Promise<string> {
    const messageId = `webchat-${Date.now()}`;

    // In real implementation, send via WebSocket to the client
    const client = this._clients.get(chatId);
    if (client) {
      // client.ws.send(JSON.stringify({ type: 'message', content, messageId }));
    }

    logger.debug('Sending webchat message', { chatId, contentLength: content.length });
    return messageId;
  }

  /**
   * Register a WebSocket client
   */
  registerClient(sessionId: string, ws: unknown, userId: string): void {
    this._clients.set(sessionId, { ws, userId });
  }

  /**
   * Handle incoming WebSocket message
   */
  handleWebSocketMessage(sessionId: string, content: string): void {
    const client = this._clients.get(sessionId);
    if (!client) return;

    const message: IncomingMessage = {
      id: `webchat-in-${Date.now()}`,
      channel: 'webchat',
      chatId: sessionId,
      sender: {
        id: client.userId,
        name: 'Web User',
      },
      content,
      timestamp: Date.now(),
    };
    this._emitMessage(message);
  }
}

// NOTE: Full implementations for TelegramAdapter, DiscordAdapter, WhatsAppAdapter, and SlackAdapter
// are imported from their respective files above and re-exported for external use.
// See: telegram-adapter.ts, discord-adapter.ts, whatsapp-adapter.ts, slack-adapter.ts

// =============================================================================
// Channel Manager
// =============================================================================

/**
 * Manages all channel adapters.
 *
 * Provides a unified interface for multi-channel messaging.
 */
export class ChannelManager extends EventEmitter {
  private _adapters: Map<ChannelType, ChannelAdapter> = new Map();

  constructor() {
    super();
    this._registerBuiltInAdapters();
  }

  /**
   * Get an adapter by channel type.
   */
  getAdapter(channel: ChannelType): ChannelAdapter | undefined {
    return this._adapters.get(channel);
  }

  /**
   * Register a channel adapter.
   */
  registerAdapter(adapter: ChannelAdapter): void {
    this._adapters.set(adapter.channel, adapter);

    // Forward events
    adapter.on('message', (msg) => this.emit('message', msg));
    adapter.on('error', (err) => this.emit('error', adapter.channel, err));
    adapter.on('connected', () => this.emit('connected', adapter.channel));
    adapter.on('disconnected', (reason) => this.emit('disconnected', adapter.channel, reason));

    logger.info('Registered channel adapter', { channel: adapter.channel });
  }

  /**
   * Connect a channel.
   */
  async connect(channel: ChannelType, config: AdapterConfig): Promise<void> {
    const adapter = this._adapters.get(channel);
    if (!adapter) {
      throw new Error(`Unknown channel: ${channel}`);
    }
    await adapter.connect(config);
  }

  /**
   * Disconnect a channel.
   */
  async disconnect(channel: ChannelType): Promise<void> {
    const adapter = this._adapters.get(channel);
    if (adapter) {
      await adapter.disconnect();
    }
  }

  /**
   * Disconnect all channels.
   */
  async disconnectAll(): Promise<void> {
    const promises = Array.from(this._adapters.values())
      .filter((a) => a.isConnected)
      .map((a) => a.disconnect());
    await Promise.all(promises);
  }

  /**
   * Send a message to a channel.
   */
  async send(
    channel: ChannelType,
    chatId: string,
    content: string,
    options?: SendOptions
  ): Promise<string> {
    const adapter = this._adapters.get(channel);
    if (!adapter) {
      throw new Error(`Unknown channel: ${channel}`);
    }
    if (!adapter.isConnected) {
      throw new Error(`Channel ${channel} is not connected`);
    }
    return adapter.send(chatId, content, options);
  }

  /**
   * Get connected channels.
   */
  getConnectedChannels(): ChannelType[] {
    return Array.from(this._adapters.entries())
      .filter(([, adapter]) => adapter.isConnected)
      .map(([channel]) => channel);
  }

  /**
   * List all registered adapter channel types.
   */
  listAdapters(): ChannelType[] {
    return Array.from(this._adapters.keys());
  }

  /**
   * Register built-in adapters.
   *
   * NOTE: We use the full implementations from separate files for
   * Telegram, Discord, WhatsApp, and Slack. Desktop and WebChat
   * use the simple implementations defined above.
   */
  private _registerBuiltInAdapters(): void {
    // Simple adapters (defined in this file)
    this.registerAdapter(new DesktopAdapter());
    this.registerAdapter(new WebChatAdapter());

    // Full implementations (from separate files)
    this.registerAdapter(new TelegramAdapter());
    this.registerAdapter(new DiscordAdapter());
    this.registerAdapter(new WhatsAppAdapter());
    this.registerAdapter(new SlackAdapter());
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let channelManagerInstance: ChannelManager | null = null;

/**
 * Get the shared channel manager instance.
 */
export function getChannelManager(): ChannelManager {
  if (!channelManagerInstance) {
    channelManagerInstance = new ChannelManager();
  }
  return channelManagerInstance;
}

/**
 * Get a specific channel adapter.
 */
export function getChannelAdapter(channel: ChannelType): ChannelAdapter | undefined {
  return getChannelManager().getAdapter(channel);
}

export default ChannelManager;
