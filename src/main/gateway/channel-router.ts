/**
 * @fileoverview Channel Router - Routes messages between channels and sessions
 * @module gateway/channel-router
 * @author Atlas Team
 * @since 1.0.0
 *
 * @description
 * The Channel Router is the bridge between the Channel Manager and the Gateway.
 * It handles:
 * - Routing incoming messages from channels to appropriate sessions
 * - Triggering channel sends when sessions produce responses
 * - Managing session creation based on channel messages
 * - Integrating with DM pairing for sender approval
 *
 * This follows Clawdbot's architecture where:
 * - DMs collapse into a shared 'main' session per sender
 * - Groups get isolated sessions with unique IDs
 * - Messages are deterministically routed back to their source channel
 *
 * @example
 * import { getChannelRouter, initializeChannelRouter } from './channel-router';
 *
 * // Initialize the router (connects channels to gateway)
 * await initializeChannelRouter();
 *
 * // Router automatically handles message routing
 * // When a Telegram message comes in:
 * // 1. Router receives it via ChannelManager 'message' event
 * // 2. Checks DM pairing if needed
 * // 3. Gets or creates a session
 * // 4. Adds the message as a turn
 * // 5. When agent responds, routes back to Telegram
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import { getChannelManager, IncomingMessage, SendOptions } from '../channels';
import { getGateway, Gateway } from './index';
import { getSessionManager, SessionManager, Session } from './sessions';
import { getDMPairingManager, DMPairingManager } from '../security/dm-pairing';
import type { ChannelType } from '../../shared/types/gateway';

const logger = createModuleLogger('ChannelRouter');

// =============================================================================
// Types
// =============================================================================

/**
 * Routing decision for an incoming message
 */
export interface RoutingDecision {
  /** Whether to allow the message */
  allow: boolean;
  /** Reason if blocked */
  reason?: string;
  /** Session to route to */
  sessionId?: string;
  /** Whether this is a new session */
  isNewSession?: boolean;
}

/**
 * Channel router configuration
 */
export interface ChannelRouterConfig {
  /** Default session timeout in ms (30 minutes) */
  defaultSessionTimeout: number;
  /** Maximum turns per session before auto-archive */
  maxTurnsPerSession: number;
  /** Whether to persist conversations to memory */
  persistMemory: boolean;
  /** Whether to collapse DMs into main session */
  collapseDMs: boolean;
}

/**
 * Default router configuration
 */
export const DEFAULT_ROUTER_CONFIG: ChannelRouterConfig = {
  defaultSessionTimeout: 30 * 60 * 1000, // 30 minutes
  maxTurnsPerSession: 100,
  persistMemory: true,
  collapseDMs: true,
};

// =============================================================================
// Channel Router Class
// =============================================================================

/**
 * Routes messages between channels and sessions
 *
 * The ChannelRouter acts as the orchestration layer that:
 * 1. Listens for incoming messages from all channels
 * 2. Applies security checks (DM pairing)
 * 3. Creates or retrieves the appropriate session
 * 4. Forwards messages to the session for processing
 * 5. Routes responses back to the originating channel
 *
 * @class ChannelRouter
 * @extends EventEmitter
 */
export class ChannelRouter extends EventEmitter {
  private _config: ChannelRouterConfig;
  private _gateway: Gateway | null = null;
  private _sessionManager: SessionManager | null = null;
  private _dmPairing: DMPairingManager | null = null;
  private _isInitialized: boolean = false;

  // Map of messageId -> { channel, chatId } for response routing
  private _pendingResponses: Map<
    string,
    { channel: ChannelType; chatId: string; messageId?: string }
  > = new Map();

  constructor(config: Partial<ChannelRouterConfig> = {}) {
    super();
    this._config = { ...DEFAULT_ROUTER_CONFIG, ...config };
  }

  // ===========================================================================
  // Initialization
  // ===========================================================================

  /**
   * Initialize the channel router
   *
   * Sets up listeners on the channel manager and connects to gateway/sessions
   */
  async initialize(): Promise<void> {
    if (this._isInitialized) {
      logger.warn('ChannelRouter already initialized');
      return;
    }

    logger.info('Initializing ChannelRouter');

    // Get dependencies
    const channelManager = getChannelManager();
    this._gateway = getGateway();
    this._sessionManager = getSessionManager();
    this._dmPairing = getDMPairingManager();

    // Listen for incoming messages from all channels
    channelManager.on('message', (message: IncomingMessage) => {
      this._handleIncomingMessage(message).catch((error) => {
        logger.error('Error handling incoming message', { error, messageId: message.id });
      });
    });

    // Listen for channel connections/disconnections
    channelManager.on('connected', (channel: ChannelType) => {
      logger.info('Channel connected', { channel });
      this.emit('channel:connected', channel);
    });

    channelManager.on('disconnected', (channel: ChannelType, reason?: string) => {
      logger.info('Channel disconnected', { channel, reason });
      this.emit('channel:disconnected', channel, reason);
    });

    // Register gateway handlers for channel operations
    this._registerGatewayHandlers();

    this._isInitialized = true;
    logger.info('ChannelRouter initialized');
  }

  /**
   * Shutdown the channel router
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down ChannelRouter');
    this._pendingResponses.clear();
    this._isInitialized = false;
  }

  // ===========================================================================
  // Message Routing
  // ===========================================================================

  /**
   * Handle incoming message from a channel
   *
   * @param message - The incoming message
   */
  private async _handleIncomingMessage(message: IncomingMessage): Promise<void> {
    logger.debug('Incoming message', {
      channel: message.channel,
      chatId: message.chatId,
      senderId: message.sender.id,
      isGroup: message.isGroup,
    });

    // Step 1: Check DM pairing for non-group messages
    if (!message.isGroup && this._dmPairing) {
      const pairingResult = await this._checkDMPairing(message);
      if (!pairingResult.allow) {
        logger.info('Message blocked by DM pairing', {
          channel: message.channel,
          senderId: message.sender.id,
          reason: pairingResult.reason,
        });
        return;
      }
    }

    // Step 2: Determine the session to route to
    const routingDecision = await this._determineRouting(message);

    if (!routingDecision.allow) {
      logger.warn('Message routing blocked', {
        channel: message.channel,
        reason: routingDecision.reason,
      });
      return;
    }

    // Step 3: Get or create the session
    const session = await this._getOrCreateSession(message, routingDecision);

    if (!session) {
      logger.error('Failed to get or create session', {
        channel: message.channel,
        chatId: message.chatId,
      });
      return;
    }

    // Step 4: Store routing info for response
    const turnId = `${session.id}-${Date.now()}`;
    this._pendingResponses.set(turnId, {
      channel: message.channel,
      chatId: message.chatId,
      messageId: message.id,
    });

    // Step 5: Add turn to session
    try {
      await session.addTurn({
        id: turnId,
        timestamp: message.timestamp,
        user: {
          id: message.sender.id,
          name: message.sender.name || message.sender.username,
          platform: message.channel,
          approved: true,
        },
        input: message.content,
        inputType: this._determineInputType(message),
      });

      logger.debug('Turn added to session', {
        sessionId: session.id,
        turnId,
        channel: message.channel,
      });

      // Emit event for agent processing
      this.emit('message:routed', {
        sessionId: session.id,
        turnId,
        message,
      });
    } catch (error) {
      logger.error('Failed to add turn to session', { error, sessionId: session.id });
      this._pendingResponses.delete(turnId);
    }
  }

  /**
   * Check DM pairing for a message
   */
  private async _checkDMPairing(
    message: IncomingMessage
  ): Promise<{ allow: boolean; reason?: string }> {
    if (!this._dmPairing) {
      return { allow: true };
    }

    try {
      const result = await this._dmPairing.checkSender(message.channel, message.sender.id, {
        name: message.sender.name || message.sender.username,
        firstMessage: message.content.substring(0, 100),
      });

      return {
        allow: result.approved,
        reason: result.approved ? undefined : result.reason || 'Sender not approved',
      };
    } catch (error) {
      logger.error('DM pairing check failed', { error });
      // Fail open for now - could be configured
      return { allow: true };
    }
  }

  /**
   * Determine routing for a message
   */
  private async _determineRouting(message: IncomingMessage): Promise<RoutingDecision> {
    // Generate session identifier based on channel and context
    const identifier = this._generateSessionIdentifier(message);

    // Check if session already exists
    const existingSession = await this._sessionManager?.getByChannelIdentifier(
      message.channel,
      identifier
    );

    return {
      allow: true,
      sessionId: existingSession?.id,
      isNewSession: !existingSession,
    };
  }

  /**
   * Generate a session identifier for a message
   *
   * For DMs: Uses sender ID (optionally collapsed to 'main')
   * For groups: Uses group ID
   */
  private _generateSessionIdentifier(message: IncomingMessage): string {
    if (message.isGroup && message.group) {
      return `group:${message.group.id}`;
    }

    // For DMs, optionally collapse to main session
    if (this._config.collapseDMs) {
      return `dm:${message.sender.id}`;
    }

    return `dm:${message.sender.id}:${message.chatId}`;
  }

  /**
   * Get or create a session for the message
   */
  private async _getOrCreateSession(
    message: IncomingMessage,
    routing: RoutingDecision
  ): Promise<Session | null> {
    if (!this._sessionManager) {
      return null;
    }

    const identifier = this._generateSessionIdentifier(message);

    // Get or create session
    const session = await this._sessionManager.getOrCreate({
      channel: message.channel,
      identifier,
      label: message.isGroup && message.group ? message.group.name : message.sender.name,
      persistMemory: this._config.persistMemory,
      maxTurns: this._config.maxTurnsPerSession,
      timeout: this._config.defaultSessionTimeout,
    });

    // Add user to session if not already present
    if (session) {
      await session.addUser({
        id: message.sender.id,
        name: message.sender.name || message.sender.username,
        platform: message.channel,
        approved: true,
      });
    }

    return session;
  }

  /**
   * Determine input type from message
   */
  private _determineInputType(
    message: IncomingMessage
  ): 'text' | 'voice' | 'image' | 'file' {
    if (message.attachments?.length) {
      const firstAttachment = message.attachments[0];
      if (firstAttachment.type === 'voice' || firstAttachment.type === 'audio') {
        return 'voice';
      }
      if (firstAttachment.type === 'image') {
        return 'image';
      }
      return 'file';
    }
    return 'text';
  }

  // ===========================================================================
  // Response Routing
  // ===========================================================================

  /**
   * Route a response back to its originating channel
   *
   * Called by the agent when it produces a response for a turn
   *
   * @param turnId - The turn ID this response is for
   * @param content - The response content
   * @param options - Optional send options
   */
  async routeResponse(turnId: string, content: string, options?: SendOptions): Promise<void> {
    const routingInfo = this._pendingResponses.get(turnId);

    if (!routingInfo) {
      logger.warn('No routing info found for turn', { turnId });
      return;
    }

    try {
      const channelManager = getChannelManager();

      // Send response to the channel
      await channelManager.send(routingInfo.channel, routingInfo.chatId, content, {
        replyTo: routingInfo.messageId,
        ...options,
      });

      logger.debug('Response routed', {
        turnId,
        channel: routingInfo.channel,
        chatId: routingInfo.chatId,
      });

      // Clean up
      this._pendingResponses.delete(turnId);
    } catch (error) {
      logger.error('Failed to route response', { error, turnId });
      throw error;
    }
  }

  /**
   * Send typing indicator to a session's channel
   */
  async sendTyping(sessionId: string): Promise<void> {
    const session = this._sessionManager?.get(sessionId);
    if (!session) return;

    const channelManager = getChannelManager();
    const adapter = channelManager.getAdapter(session.config.channel);

    if (adapter?.isConnected) {
      try {
        // Extract chatId from session identifier
        const chatId = this._extractChatId(session.config.identifier);
        await adapter.sendTyping(chatId);
      } catch (error) {
        // Typing indicators are best-effort
        logger.debug('Failed to send typing indicator', { sessionId, error });
      }
    }
  }

  /**
   * Extract chat ID from session identifier
   */
  private _extractChatId(identifier: string): string {
    // Identifiers are like "dm:senderId" or "group:groupId"
    const parts = identifier.split(':');
    return parts[parts.length - 1];
  }

  // ===========================================================================
  // Gateway Handlers
  // ===========================================================================

  /**
   * Register handlers on the gateway for channel operations
   */
  private _registerGatewayHandlers(): void {
    if (!this._gateway) return;

    // List connected channels
    this._gateway.registerHandler('channels.list', async () => {
      const channelManager = getChannelManager();
      return channelManager.getConnectedChannels();
    });

    // Connect a channel
    this._gateway.registerHandler('channels.connect', async (client, params) => {
      const { channel, config } = params as { channel: ChannelType; config: unknown };
      const channelManager = getChannelManager();
      await channelManager.connect(channel, config as Record<string, unknown>);
      return { success: true };
    });

    // Disconnect a channel
    this._gateway.registerHandler('channels.disconnect', async (client, params) => {
      const { channel } = params as { channel: ChannelType };
      const channelManager = getChannelManager();
      await channelManager.disconnect(channel);
      return { success: true };
    });

    // Send message to a channel
    this._gateway.registerHandler('channels.send', async (client, params) => {
      const { channel, chatId, content, options } = params as {
        channel: ChannelType;
        chatId: string;
        content: string;
        options?: SendOptions;
      };

      const channelManager = getChannelManager();
      const messageId = await channelManager.send(channel, chatId, content, options);
      return { messageId };
    });

    logger.debug('Gateway handlers registered');
  }

  // ===========================================================================
  // Public Getters
  // ===========================================================================

  /**
   * Check if router is initialized
   */
  get isInitialized(): boolean {
    return this._isInitialized;
  }

  /**
   * Get router configuration
   */
  get config(): ChannelRouterConfig {
    return { ...this._config };
  }

  /**
   * Get count of pending responses
   */
  get pendingResponseCount(): number {
    return this._pendingResponses.size;
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let channelRouterInstance: ChannelRouter | null = null;

/**
 * Get the channel router singleton
 */
export function getChannelRouter(): ChannelRouter {
  if (!channelRouterInstance) {
    channelRouterInstance = new ChannelRouter();
  }
  return channelRouterInstance;
}

/**
 * Initialize the channel router
 *
 * Should be called after the gateway and channel manager are ready
 */
export async function initializeChannelRouter(
  config?: Partial<ChannelRouterConfig>
): Promise<ChannelRouter> {
  if (channelRouterInstance?.isInitialized) {
    logger.warn('ChannelRouter already initialized');
    return channelRouterInstance;
  }

  channelRouterInstance = new ChannelRouter(config);
  await channelRouterInstance.initialize();
  return channelRouterInstance;
}

/**
 * Shutdown the channel router
 */
export async function shutdownChannelRouter(): Promise<void> {
  if (channelRouterInstance) {
    await channelRouterInstance.shutdown();
    channelRouterInstance = null;
  }
}

export default ChannelRouter;
