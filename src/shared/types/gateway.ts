/**
 * @fileoverview Gateway Type Definitions
 * @module shared/types/gateway
 * @author Atlas Team
 * @since 1.0.0
 *
 * @description
 * Type definitions for the Atlas Gateway system, including:
 * - Gateway configuration
 * - Client connections
 * - Session management
 * - Cron/scheduler
 * - Node protocols
 *
 * These types are shared between main process gateway implementations
 * and any client code that needs to interact with the gateway.
 */

// =============================================================================
// Gateway Core Types
// =============================================================================

/**
 * Gateway configuration options
 */
export interface GatewayConfig {
  /** WebSocket server port (default: 18789) */
  port: number;
  /** Bind host (default: '127.0.0.1' for loopback-only) */
  host: string;
  /** Authentication token (optional, but recommended) */
  token?: string;
  /** Enable heartbeat checking (default: true) */
  enableHeartbeat: boolean;
  /** Heartbeat interval in ms (default: 30000) */
  heartbeatInterval: number;
  /** Client timeout in ms (default: 60000) */
  clientTimeout: number;
}

/**
 * Client role determines what operations are permitted
 */
export type ClientRole = 'operator' | 'node' | 'readonly';

/**
 * Gateway client info (public view)
 */
export interface GatewayClientInfo {
  /** Unique client ID */
  id: string;
  /** Client role */
  role: ClientRole;
  /** Device/client name */
  name?: string;
  /** Platform identifier */
  platform?: string;
  /** Connection timestamp */
  connectedAt: number;
  /** Is connection authenticated */
  authenticated: boolean;
}

/**
 * Gateway health status
 */
export interface GatewayHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  uptime: number;
  clients: {
    total: number;
    operators: number;
    nodes: number;
  };
  version: string;
}

// =============================================================================
// Session Types
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
}

/**
 * Session list item (public view)
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

// =============================================================================
// Cron/Scheduler Types
// =============================================================================

/**
 * Task action types
 */
export type TaskActionType =
  | 'message'
  | 'tool'
  | 'notify'
  | 'function'
  | 'http'
  | 'workflow';

/**
 * Task state
 */
export type TaskState = 'active' | 'paused' | 'completed' | 'failed' | 'cancelled';

/**
 * Scheduled task info (public view)
 */
export interface ScheduledTaskInfo {
  /** Unique task ID */
  id: string;
  /** Human-readable task name */
  name: string;
  /** Task description */
  description?: string;
  /** Cron expression (for recurring tasks) */
  cron?: string;
  /** Task state */
  state: TaskState;
  /** Creation timestamp */
  createdAt: number;
  /** Last run timestamp */
  lastRunAt?: number;
  /** Next scheduled run timestamp */
  nextRunAt?: number;
  /** Number of times task has run */
  runCount: number;
  /** Task tags */
  tags?: string[];
}

// =============================================================================
// Node Types
// =============================================================================

/**
 * Node capabilities
 */
export type NodeCapability =
  | 'canvas'
  | 'camera'
  | 'screen'
  | 'location'
  | 'notifications'
  | 'system.run'
  | 'sms';

/**
 * Node pairing status
 */
export type NodePairingStatus = 'approved' | 'pending' | 'rejected';

/**
 * Node info (public view)
 */
export interface NodeInfo {
  /** Node ID */
  id: string;
  /** Node name */
  name?: string;
  /** Platform (ios, android, macos, windows, linux) */
  platform?: string;
  /** Capabilities this node provides */
  capabilities: NodeCapability[];
  /** Pairing status */
  pairingStatus: NodePairingStatus;
  /** Connection timestamp */
  connectedAt: number;
  /** Last activity timestamp */
  lastActivityAt: number;
}

/**
 * Node command result
 */
export interface NodeCommandResult {
  /** Was command successful */
  success: boolean;
  /** Result data */
  data?: unknown;
  /** Error message if failed */
  error?: string;
  /** Execution duration in ms */
  duration: number;
}

// =============================================================================
// Wire Protocol Types
// =============================================================================

/**
 * Gateway request message
 */
export interface GatewayRequest {
  type: 'req';
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

/**
 * Gateway response message
 */
export interface GatewayResponse {
  type: 'res';
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: string;
}

/**
 * Gateway event message
 */
export interface GatewayEvent {
  type: 'event';
  event: string;
  payload?: unknown;
  seq?: number;
}

/**
 * Connect request params
 */
export interface ConnectParams {
  /** Client role */
  role: ClientRole;
  /** Authentication */
  auth?: {
    token?: string;
  };
  /** Device information */
  device?: {
    id: string;
    name: string;
    platform: string;
  };
  /** Node capabilities (if role is 'node') */
  capabilities?: NodeCapability[];
}

// =============================================================================
// IPC Integration Types
// =============================================================================

/**
 * Gateway IPC methods exposed to renderer
 */
export interface GatewayIPCMethods {
  /** Get gateway status */
  getStatus(): Promise<GatewayHealth | null>;
  /** Start gateway */
  start(config?: Partial<GatewayConfig>): Promise<boolean>;
  /** Stop gateway */
  stop(): Promise<boolean>;
  /** List clients */
  listClients(): Promise<GatewayClientInfo[]>;
  /** List sessions */
  listSessions(filter?: { channel?: ChannelType; state?: SessionState }): Promise<SessionListItem[]>;
  /** List nodes */
  listNodes(): Promise<NodeInfo[]>;
  /** Approve node */
  approveNode(nodeId: string): Promise<boolean>;
  /** Reject node */
  rejectNode(nodeId: string): Promise<boolean>;
  /** List scheduled tasks */
  listTasks(filter?: { state?: TaskState }): Promise<ScheduledTaskInfo[]>;
}

/**
 * Gateway events sent to renderer
 */
export interface GatewayIPCEvents {
  /** Gateway started */
  'gateway:started': void;
  /** Gateway stopped */
  'gateway:stopped': void;
  /** Client connected */
  'gateway:client-connected': GatewayClientInfo;
  /** Client disconnected */
  'gateway:client-disconnected': { id: string; reason: string };
  /** Node connected */
  'gateway:node-connected': NodeInfo;
  /** Session created */
  'gateway:session-created': SessionListItem;
  /** Session terminated */
  'gateway:session-terminated': { id: string; reason: string };
  /** Task executed */
  'gateway:task-executed': { id: string; success: boolean };
}
