/**
 * @fileoverview Session Manager - Multi-Session Coordination
 * @module gateway/sessions
 * @author Atlas Team
 * @since 1.0.0
 *
 * @description
 * Manages multiple concurrent Atlas sessions, each with its own conversation
 * context, active channel, and state. Sessions enable:
 * - Per-channel isolation (WhatsApp, Discord, etc.)
 * - Multi-agent routing
 * - Cross-session communication
 * - Session spawning and lifecycle management
 *
 * @see https://docs.clawd.bot/concepts/sessions
 *
 * @example
 * import { SessionManager } from './sessions';
 *
 * const sessions = new SessionManager();
 *
 * // Create a new session for Discord
 * const session = await sessions.create({
 *   channel: 'discord',
 *   identifier: 'guild:123/channel:456',
 * });
 *
 * // Process a message in the session
 * const response = await session.process(message);
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('SessionManager');

// =============================================================================
// Types and Interfaces
// =============================================================================

/**
 * Channel types supported by Atlas
 */
export type ChannelType =
  | 'desktop'
  | 'webchat'
  | 'discord'
  | 'telegram'
  | 'whatsapp'
  | 'slack'
  | 'imessage'
  | 'email'
  | 'api';

/**
 * Session state
 */
export type SessionState = 'active' | 'paused' | 'terminated';

/**
 * Session configuration
 */
export interface SessionConfig {
  /** Channel this session belongs to */
  channel: ChannelType;
  /** Channel-specific identifier (e.g., 'guild:123/channel:456') */
  identifier: string;
  /** Session label for display */
  label?: string;
  /** Whether to persist conversation to memory */
  persistMemory?: boolean;
  /** Tool allowlist (null = all tools allowed) */
  toolAllowlist?: string[] | null;
  /** Tool denylist */
  toolDenylist?: string[];
  /** Maximum conversation turns before auto-archive */
  maxTurns?: number;
  /** Session timeout in ms (0 = no timeout) */
  timeout?: number;
  /** Parent session ID (for spawned sessions) */
  parentSessionId?: string;
  /** Custom metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Session user identity
 */
export interface SessionUser {
  /** Platform-specific user ID */
  id: string;
  /** Display name */
  name?: string;
  /** Platform identifier */
  platform?: string;
  /** Whether user is approved */
  approved: boolean;
  /** User-specific metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Conversation turn
 */
export interface ConversationTurn {
  /** Turn ID */
  id: string;
  /** Turn timestamp */
  timestamp: number;
  /** User who initiated the turn */
  user?: SessionUser;
  /** User input */
  input: string;
  /** Input type */
  inputType: 'text' | 'voice' | 'image' | 'file';
  /** Atlas response */
  response?: string;
  /** Tool calls made during turn */
  toolCalls?: Array<{
    tool: string;
    params: Record<string, unknown>;
    result?: unknown;
    error?: string;
    duration: number;
  }>;
  /** Turn duration in ms */
  duration?: number;
  /** Token usage */
  tokens?: {
    input: number;
    output: number;
  };
}

/**
 * Session instance
 */
export interface Session {
  /** Unique session ID */
  id: string;
  /** Session configuration */
  config: SessionConfig;
  /** Session state */
  state: SessionState;
  /** Creation timestamp */
  createdAt: number;
  /** Last activity timestamp */
  lastActivityAt: number;
  /** Conversation history */
  history: ConversationTurn[];
  /** Active users in session */
  users: Map<string, SessionUser>;
  /** Session context (for LLM) */
  context: Record<string, unknown>;
  /** Spawned child sessions */
  children: string[];
  /** Event emitter for session events */
  events: EventEmitter;
}

/**
 * Session list item (for sessions_list tool)
 */
export interface SessionListItem {
  id: string;
  channel: ChannelType;
  identifier: string;
  label?: string;
  state: SessionState;
  turnCount: number;
  userCount: number;
  createdAt: number;
  lastActivityAt: number;
}

/**
 * Message to send to another session
 */
export interface CrossSessionMessage {
  /** Source session ID */
  fromSession: string;
  /** Target session ID */
  toSession: string;
  /** Message type */
  type: 'message' | 'request' | 'notification';
  /** Message content */
  content: string;
  /** Additional data */
  data?: Record<string, unknown>;
}

// =============================================================================
// Session Manager Class
// =============================================================================

/**
 * Manages Atlas sessions across channels
 * 
 * The SessionManager coordinates multiple concurrent conversations,
 * each isolated by channel and identifier. It provides:
 * - Session lifecycle management (create, pause, resume, terminate)
 * - Cross-session communication
 * - Session spawning for parallel operations
 * - History and context management
 * 
 * @class SessionManager
 * @extends EventEmitter
 * 
 * @example
 * const manager = new SessionManager();
 * 
 * // Create a session
 * const session = manager.create({
 *   channel: 'discord',
 *   identifier: 'guild:123/channel:456',
 * });
 * 
 * // List all sessions
 * const sessions = manager.list();
 * 
 * // Send message to another session
 * manager.sendToSession('session-1', 'session-2', 'Hello from session 1');
 */
export class SessionManager extends EventEmitter {
  private _sessions: Map<string, Session> = new Map();
  private _channelIndex: Map<string, Set<string>> = new Map();
  private _cleanupTimer: NodeJS.Timeout | null = null;
  private _defaultTimeout: number = 30 * 60 * 1000; // 30 minutes

  constructor() {
    super();
    this._startCleanupTimer();
  }

  // ===========================================================================
  // Session Lifecycle
  // ===========================================================================

  /**
   * Create a new session
   * 
   * @param config - Session configuration
   * @returns Created session
   */
  create(config: SessionConfig): Session {
    const sessionId = uuidv4();
    const now = Date.now();

    const session: Session = {
      id: sessionId,
      config: {
        persistMemory: true,
        toolAllowlist: null,
        toolDenylist: [],
        maxTurns: 100,
        timeout: this._defaultTimeout,
        ...config,
      },
      state: 'active',
      createdAt: now,
      lastActivityAt: now,
      history: [],
      users: new Map(),
      context: {},
      children: [],
      events: new EventEmitter(),
    };

    // Store session
    this._sessions.set(sessionId, session);

    // Update channel index
    const channelKey = `${config.channel}:${config.identifier}`;
    if (!this._channelIndex.has(channelKey)) {
      this._channelIndex.set(channelKey, new Set());
    }
    this._channelIndex.get(channelKey)!.add(sessionId);

    // If this is a spawned session, link to parent
    if (config.parentSessionId) {
      const parent = this._sessions.get(config.parentSessionId);
      if (parent) {
        parent.children.push(sessionId);
      }
    }

    logger.info('Session created', {
      sessionId,
      channel: config.channel,
      identifier: config.identifier,
    });

    this.emit('session-created', session);

    return session;
  }

  /**
   * Get a session by ID
   * 
   * @param sessionId - Session ID
   * @returns Session or undefined
   */
  get(sessionId: string): Session | undefined {
    return this._sessions.get(sessionId);
  }

  /**
   * Get or create a session for a channel/identifier pair
   * 
   * This is the typical way to access a session - it creates one if
   * it doesn't exist, or returns the existing active session.
   * 
   * @param channel - Channel type
   * @param identifier - Channel-specific identifier
   * @param config - Additional configuration for new sessions
   * @returns Session
   */
  getOrCreate(channel: ChannelType, identifier: string, config?: Partial<SessionConfig>): Session {
    const channelKey = `${channel}:${identifier}`;
    const sessionIds = this._channelIndex.get(channelKey);

    if (sessionIds) {
      // Find an active session
      for (const sessionId of sessionIds) {
        const session = this._sessions.get(sessionId);
        if (session && session.state === 'active') {
          return session;
        }
      }
    }

    // Create new session
    return this.create({
      channel,
      identifier,
      ...config,
    });
  }

  /**
   * Pause a session
   * 
   * Paused sessions retain their history and context but don't accept new input
   * 
   * @param sessionId - Session ID
   */
  pause(sessionId: string): boolean {
    const session = this._sessions.get(sessionId);
    if (!session) {
      return false;
    }

    session.state = 'paused';
    logger.info('Session paused', { sessionId });
    this.emit('session-paused', session);
    return true;
  }

  /**
   * Resume a paused session
   * 
   * @param sessionId - Session ID
   */
  resume(sessionId: string): boolean {
    const session = this._sessions.get(sessionId);
    if (!session || session.state !== 'paused') {
      return false;
    }

    session.state = 'active';
    session.lastActivityAt = Date.now();
    logger.info('Session resumed', { sessionId });
    this.emit('session-resumed', session);
    return true;
  }

  /**
   * Terminate a session
   * 
   * Terminated sessions are cleaned up and cannot be resumed
   * 
   * @param sessionId - Session ID
   * @param reason - Termination reason
   */
  terminate(sessionId: string, reason?: string): boolean {
    const session = this._sessions.get(sessionId);
    if (!session) {
      return false;
    }

    session.state = 'terminated';
    session.events.emit('terminated', { reason });

    // Terminate child sessions
    for (const childId of session.children) {
      this.terminate(childId, 'Parent session terminated');
    }

    // Remove from channel index
    const channelKey = `${session.config.channel}:${session.config.identifier}`;
    const sessionIds = this._channelIndex.get(channelKey);
    if (sessionIds) {
      sessionIds.delete(sessionId);
      if (sessionIds.size === 0) {
        this._channelIndex.delete(channelKey);
      }
    }

    // Remove from sessions map (after a delay to allow final events)
    setTimeout(() => {
      this._sessions.delete(sessionId);
    }, 1000);

    logger.info('Session terminated', { sessionId, reason });
    this.emit('session-terminated', session, reason);
    return true;
  }

  // ===========================================================================
  // Session Operations
  // ===========================================================================

  /**
   * Add a conversation turn to session history
   * 
   * @param sessionId - Session ID
   * @param turn - Conversation turn
   */
  addTurn(sessionId: string, turn: Omit<ConversationTurn, 'id' | 'timestamp'>): ConversationTurn {
    const session = this._sessions.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    const completeTurn: ConversationTurn = {
      ...turn,
      id: uuidv4(),
      timestamp: Date.now(),
    };

    session.history.push(completeTurn);
    session.lastActivityAt = Date.now();

    // Check max turns
    if (session.config.maxTurns && session.history.length >= session.config.maxTurns) {
      logger.warn('Session reached max turns', { sessionId });
      this.terminate(sessionId, 'Maximum turns reached');
    }

    session.events.emit('turn-added', completeTurn);
    this.emit('turn-added', session, completeTurn);

    return completeTurn;
  }

  /**
   * Get session history
   * 
   * @param sessionId - Session ID
   * @param limit - Maximum number of turns to return
   */
  getHistory(sessionId: string, limit?: number): ConversationTurn[] {
    const session = this._sessions.get(sessionId);
    if (!session) {
      return [];
    }

    if (limit) {
      return session.history.slice(-limit);
    }

    return [...session.history];
  }

  /**
   * Add or update a user in a session
   * 
   * @param sessionId - Session ID
   * @param user - User information
   */
  addUser(sessionId: string, user: SessionUser): void {
    const session = this._sessions.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    session.users.set(user.id, user);
    session.events.emit('user-joined', user);
    this.emit('user-joined', session, user);
  }

  /**
   * Remove a user from a session
   * 
   * @param sessionId - Session ID
   * @param userId - User ID
   */
  removeUser(sessionId: string, userId: string): void {
    const session = this._sessions.get(sessionId);
    if (!session) {
      return;
    }

    const user = session.users.get(userId);
    if (user) {
      session.users.delete(userId);
      session.events.emit('user-left', user);
      this.emit('user-left', session, user);
    }
  }

  /**
   * Update session context
   * 
   * @param sessionId - Session ID
   * @param context - Context to merge
   */
  updateContext(sessionId: string, context: Record<string, unknown>): void {
    const session = this._sessions.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    session.context = { ...session.context, ...context };
    session.lastActivityAt = Date.now();
  }

  // ===========================================================================
  // Cross-Session Communication
  // ===========================================================================

  /**
   * List all sessions (for sessions_list tool)
   * 
   * @param filter - Optional filter
   */
  list(filter?: { channel?: ChannelType; state?: SessionState }): SessionListItem[] {
    const sessions: SessionListItem[] = [];

    for (const session of this._sessions.values()) {
      if (filter?.channel && session.config.channel !== filter.channel) {
        continue;
      }
      if (filter?.state && session.state !== filter.state) {
        continue;
      }

      sessions.push({
        id: session.id,
        channel: session.config.channel,
        identifier: session.config.identifier,
        label: session.config.label,
        state: session.state,
        turnCount: session.history.length,
        userCount: session.users.size,
        createdAt: session.createdAt,
        lastActivityAt: session.lastActivityAt,
      });
    }

    return sessions;
  }

  /**
   * Send a message to another session (for sessions_send tool)
   * 
   * @param message - Cross-session message
   */
  sendToSession(message: CrossSessionMessage): boolean {
    const targetSession = this._sessions.get(message.toSession);
    if (!targetSession || targetSession.state !== 'active') {
      logger.warn('Target session not found or not active', {
        targetSession: message.toSession,
      });
      return false;
    }

    targetSession.events.emit('cross-session-message', message);
    this.emit('cross-session-message', message);

    logger.info('Cross-session message sent', {
      from: message.fromSession,
      to: message.toSession,
      type: message.type,
    });

    return true;
  }

  /**
   * Spawn a child session (for sessions_spawn tool)
   * 
   * Creates a new session linked to a parent session
   * 
   * @param parentSessionId - Parent session ID
   * @param config - Child session configuration
   */
  spawn(parentSessionId: string, config: Partial<SessionConfig>): Session {
    const parent = this._sessions.get(parentSessionId);
    if (!parent) {
      throw new Error('Parent session not found');
    }

    const childSession = this.create({
      channel: config.channel || parent.config.channel,
      identifier: config.identifier || `${parent.config.identifier}/child-${Date.now()}`,
      parentSessionId,
      ...config,
    });

    logger.info('Child session spawned', {
      parentId: parentSessionId,
      childId: childSession.id,
    });

    return childSession;
  }

  // ===========================================================================
  // Cleanup
  // ===========================================================================

  /**
   * Start cleanup timer
   * 
   * Periodically checks for timed out sessions
   */
  private _startCleanupTimer(): void {
    this._cleanupTimer = setInterval(() => {
      const now = Date.now();

      for (const [sessionId, session] of this._sessions.entries()) {
        if (session.state !== 'active') {
          continue;
        }

        const timeout = session.config.timeout || this._defaultTimeout;
        if (timeout > 0 && now - session.lastActivityAt > timeout) {
          logger.info('Session timed out', { sessionId });
          this.terminate(sessionId, 'Session timeout');
        }
      }
    }, 60000); // Check every minute
  }

  /**
   * Stop cleanup timer
   */
  stopCleanup(): void {
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer);
      this._cleanupTimer = null;
    }
  }

  /**
   * Get session count
   */
  get count(): number {
    return this._sessions.size;
  }

  /**
   * Get active session count
   */
  get activeCount(): number {
    let count = 0;
    for (const session of this._sessions.values()) {
      if (session.state === 'active') {
        count++;
      }
    }
    return count;
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let sessionManagerInstance: SessionManager | null = null;

/**
 * Get the session manager singleton instance
 */
export function getSessionManager(): SessionManager {
  if (!sessionManagerInstance) {
    sessionManagerInstance = new SessionManager();
  }
  return sessionManagerInstance;
}

/**
 * Shutdown session manager
 */
export function shutdownSessionManager(): void {
  if (sessionManagerInstance) {
    sessionManagerInstance.stopCleanup();
    sessionManagerInstance = null;
  }
}

export default SessionManager;
