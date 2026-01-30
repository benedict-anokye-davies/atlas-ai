/**
 * @fileoverview Atlas Gateway - WebSocket Control Plane
 * @module gateway
 * @author Atlas Team
 * @since 1.0.0
 *
 * @description
 * The Gateway is the central control plane for Atlas Desktop, inspired by Clawdbot's
 * architecture. It provides a WebSocket server that handles:
 * - Client connections (UI, CLI, external tools)
 * - Node connections (companion devices)
 * - Session management and routing
 * - Heartbeat and presence tracking
 * - Event distribution
 *
 * The Gateway is the single source of truth for all Atlas operations and
 * enables multi-channel communication, remote access, and device integration.
 *
 * @see https://docs.clawd.bot/concepts/architecture
 *
 * @example
 * import { getGateway, startGateway } from './gateway';
 *
 * // Start the gateway server
 * await startGateway({ port: 18789 });
 *
 * // Get gateway instance
 * const gateway = getGateway();
 * gateway.broadcast('atlas:status', { state: 'ready' });
 */

import { EventEmitter } from 'events';
import { WebSocket, WebSocketServer } from 'ws';
import { createServer, IncomingMessage, Server } from 'http';
import { createModuleLogger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';
import { addHttpRoutes } from './http-server';
import { registerExtendedHandlers } from './extended-handlers';

const logger = createModuleLogger('Gateway');

// =============================================================================
// Types and Interfaces
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
 * Default gateway configuration
 * 
 * NOTE: Loopback-only by default for security. Use Tailscale or SSH tunnel
 * for remote access as recommended by Clawdbot's security model.
 */
export const DEFAULT_GATEWAY_CONFIG: GatewayConfig = {
  port: 18789,
  host: '127.0.0.1',
  enableHeartbeat: true,
  heartbeatInterval: 30000,
  clientTimeout: 60000,
};

/**
 * Client role determines what operations are permitted
 */
export type ClientRole = 'operator' | 'node' | 'readonly';

/**
 * Node capabilities advertised during connection
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
 * Connected client information
 */
export interface GatewayClient {
  /** Unique client ID */
  id: string;
  /** WebSocket connection */
  ws: WebSocket;
  /** Client role */
  role: ClientRole;
  /** Device/client name */
  name?: string;
  /** Platform identifier */
  platform?: string;
  /** Connection timestamp */
  connectedAt: number;
  /** Last activity timestamp */
  lastActivity: number;
  /** Is connection authenticated */
  authenticated: boolean;
  /** Node capabilities (if role is 'node') */
  capabilities?: NodeCapability[];
  /** Node permissions map */
  permissions?: Record<string, boolean>;
  /** Pairing status */
  pairingStatus: 'approved' | 'pending' | 'rejected';
}

/**
 * Gateway request message format
 * 
 * Follows Clawdbot's wire protocol:
 * - type: 'req' for requests
 * - id: unique request ID for response correlation
 * - method: operation to perform
 * - params: operation parameters
 */
export interface GatewayRequest {
  type: 'req';
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

/**
 * Gateway response message format
 */
export interface GatewayResponse {
  type: 'res';
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: string;
}

/**
 * Gateway event message format
 * 
 * Server-pushed events don't require a response
 */
export interface GatewayEvent {
  type: 'event';
  event: string;
  payload?: unknown;
  seq?: number;
  stateVersion?: number;
}

/**
 * Connect request params (first message from client)
 */
export interface ConnectParams {
  /** Client role */
  role: ClientRole;
  /** Authentication token */
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
  /** Node permissions */
  permissions?: Record<string, boolean>;
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
// Gateway Class
// =============================================================================

/**
 * Atlas Gateway Server
 * 
 * Central WebSocket control plane for Atlas Desktop. Handles client connections,
 * message routing, session management, and event distribution.
 * 
 * Architecture follows Clawdbot's gateway model:
 * - Single gateway per host
 * - Loopback-first for security
 * - Token-based authentication
 * - Role-based permissions (operator, node, readonly)
 * 
 * @class Gateway
 * @extends EventEmitter
 * 
 * @example
 * const gateway = new Gateway({ port: 18789 });
 * await gateway.start();
 * 
 * gateway.on('client-connected', (client) => {
 *   console.log(`Client ${client.id} connected`);
 * });
 * 
 * gateway.broadcast('atlas:state-change', { state: 'listening' });
 */
export class Gateway extends EventEmitter {
  private _config: GatewayConfig;
  private _server: Server | null = null;
  private _wss: WebSocketServer | null = null;
  private _clients: Map<string, GatewayClient> = new Map();
  private _startTime: number = 0;
  private _eventSeq: number = 0;
  private _heartbeatTimer: NodeJS.Timeout | null = null;
  private _isRunning: boolean = false;

  // Request handlers registry
  private _handlers: Map<string, (client: GatewayClient, params: unknown) => Promise<unknown>> =
    new Map();

  constructor(config: Partial<GatewayConfig> = {}) {
    super();
    this._config = { ...DEFAULT_GATEWAY_CONFIG, ...config };
    this._registerDefaultHandlers();
  }

  // ===========================================================================
  // Lifecycle Methods
  // ===========================================================================

  /**
   * Start the gateway server
   * 
   * @returns Promise that resolves when server is listening
   * @throws Error if server fails to start
   */
  async start(): Promise<void> {
    if (this._isRunning) {
      logger.warn('Gateway already running');
      return;
    }

    return new Promise((resolve, reject) => {
      try {
        // Create HTTP server for WebSocket upgrade
        this._server = createServer((req, res) => {
          // Health check endpoint
          if (req.url === '/health') {
            const health = this.getHealth();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(health));
            return;
          }

          // Default response
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end('Atlas Gateway');
        });

        // Create WebSocket server
        this._wss = new WebSocketServer({ server: this._server });

        this._wss.on('connection', (ws, req) => {
          this._handleConnection(ws, req);
        });

        this._wss.on('error', (error) => {
          logger.error('WebSocket server error', { error });
          this.emit('error', error);
        });

        // Add HTTP routes for Web UI
        addHttpRoutes(this._server, this);

        // Start listening
        this._server.listen(this._config.port, this._config.host, () => {
          this._startTime = Date.now();
          this._isRunning = true;

          logger.info('Gateway started', {
            host: this._config.host,
            port: this._config.port,
          });

          // Start heartbeat timer
          if (this._config.enableHeartbeat) {
            this._startHeartbeat();
          }

          this.emit('started');
          resolve();
        });

        this._server.on('error', (error) => {
          logger.error('HTTP server error', { error });
          reject(error);
        });
      } catch (error) {
        logger.error('Failed to start gateway', { error });
        reject(error);
      }
    });
  }

  /**
   * Stop the gateway server
   * 
   * Gracefully closes all client connections and shuts down the server
   */
  async stop(): Promise<void> {
    if (!this._isRunning) {
      return;
    }

    logger.info('Stopping gateway...');

    // Stop heartbeat
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }

    // Notify clients of shutdown
    this.broadcast('shutdown', { reason: 'gateway stopping' });

    // Close all client connections
    for (const client of this._clients.values()) {
      client.ws.close(1001, 'Gateway shutting down');
    }
    this._clients.clear();

    // Close WebSocket server
    if (this._wss) {
      await new Promise<void>((resolve) => {
        this._wss!.close(() => resolve());
      });
      this._wss = null;
    }

    // Close HTTP server
    if (this._server) {
      await new Promise<void>((resolve) => {
        this._server!.close(() => resolve());
      });
      this._server = null;
    }

    this._isRunning = false;
    logger.info('Gateway stopped');
    this.emit('stopped');
  }

  // ===========================================================================
  // Connection Handling
  // ===========================================================================

  /**
   * Handle new WebSocket connection
   * 
   * The first message must be a 'connect' request with role and auth.
   * Connection is rejected if:
   * - First message is not a valid connect request
   * - Authentication fails (if token is required)
   * - Role is not recognized
   */
  private _handleConnection(ws: WebSocket, req: IncomingMessage): void {
    const clientId = uuidv4();
    const clientIp = req.socket.remoteAddress || 'unknown';

    logger.debug('New connection', { clientId, ip: clientIp });

    // Set up connection timeout for initial handshake
    const handshakeTimeout = setTimeout(() => {
      logger.warn('Handshake timeout', { clientId });
      ws.close(4000, 'Handshake timeout');
    }, 10000);

    // Handle first message (must be connect)
    ws.once('message', (data) => {
      clearTimeout(handshakeTimeout);

      try {
        const message = JSON.parse(data.toString()) as GatewayRequest;

        if (message.type !== 'req' || message.method !== 'connect') {
          logger.warn('First message must be connect request', { clientId });
          this._sendResponse(ws, message.id || '0', false, undefined, 'First message must be connect');
          ws.close(4001, 'Invalid handshake');
          return;
        }

        const params = (message.params ?? {}) as unknown as ConnectParams;
        
        // Validate authentication if token is configured
        if (this._config.token) {
          if (!params.auth?.token || params.auth.token !== this._config.token) {
            logger.warn('Authentication failed', { clientId });
            this._sendResponse(ws, message.id, false, undefined, 'Authentication failed');
            ws.close(4003, 'Authentication failed');
            return;
          }
        }

        // Create client record
        const client: GatewayClient = {
          id: clientId,
          ws,
          role: params.role || 'readonly',
          name: params.device?.name,
          platform: params.device?.platform,
          connectedAt: Date.now(),
          lastActivity: Date.now(),
          authenticated: true,
          capabilities: params.capabilities,
          permissions: params.permissions,
          pairingStatus: params.role === 'node' ? 'pending' : 'approved',
        };

        // Store client
        this._clients.set(clientId, client);

        // Set up message handler
        ws.on('message', (data) => {
          this._handleMessage(client, data);
        });

        // Set up close handler
        ws.on('close', (code, reason) => {
          this._handleDisconnect(client, code, reason.toString());
        });

        // Set up error handler
        ws.on('error', (error) => {
          logger.error('Client WebSocket error', { clientId, error });
        });

        // Send connect response with health snapshot
        const health = this.getHealth();
        this._sendResponse(ws, message.id, true, {
          clientId,
          role: client.role,
          health,
        });

        logger.info('Client connected', {
          clientId,
          role: client.role,
          name: client.name,
        });

        this.emit('client-connected', client);

        // Broadcast presence update
        this._broadcastPresence();
      } catch (error) {
        logger.error('Error handling connect', { clientId, error });
        ws.close(4002, 'Invalid message format');
      }
    });

    ws.on('error', (error) => {
      clearTimeout(handshakeTimeout);
      logger.error('Connection error during handshake', { clientId, error });
    });
  }

  /**
   * Handle incoming message from connected client
   */
  private async _handleMessage(client: GatewayClient, data: WebSocket.Data): Promise<void> {
    client.lastActivity = Date.now();

    try {
      const message = JSON.parse(data.toString());

      if (message.type === 'req') {
        await this._handleRequest(client, message as GatewayRequest);
      } else {
        logger.warn('Unknown message type', { clientId: client.id, type: message.type });
      }
    } catch (error) {
      logger.error('Error handling message', { clientId: client.id, error });
    }
  }

  /**
   * Handle request from client
   */
  private async _handleRequest(client: GatewayClient, request: GatewayRequest): Promise<void> {
    const handler = this._handlers.get(request.method);

    if (!handler) {
      logger.warn('Unknown method', { clientId: client.id, method: request.method });
      this._sendResponse(client.ws, request.id, false, undefined, `Unknown method: ${request.method}`);
      return;
    }

    try {
      const result = await handler(client, request.params);
      this._sendResponse(client.ws, request.id, true, result);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Handler error', { method: request.method, error });
      this._sendResponse(client.ws, request.id, false, undefined, errorMessage);
    }
  }

  /**
   * Handle client disconnect
   */
  private _handleDisconnect(client: GatewayClient, code: number, reason: string): void {
    logger.info('Client disconnected', {
      clientId: client.id,
      code,
      reason,
    });

    this._clients.delete(client.id);
    this.emit('client-disconnected', client, code, reason);

    // Broadcast presence update
    this._broadcastPresence();
  }

  // ===========================================================================
  // Message Sending
  // ===========================================================================

  /**
   * Send response to a request
   */
  private _sendResponse(
    ws: WebSocket,
    requestId: string,
    ok: boolean,
    payload?: unknown,
    error?: string
  ): void {
    const response: GatewayResponse = {
      type: 'res',
      id: requestId,
      ok,
      payload,
      error,
    };

    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(response));
    }
  }

  /**
   * Send event to a specific client
   */
  sendEvent(clientId: string, event: string, payload?: unknown): boolean {
    const client = this._clients.get(clientId);
    if (!client || client.ws.readyState !== WebSocket.OPEN) {
      return false;
    }

    const message: GatewayEvent = {
      type: 'event',
      event,
      payload,
      seq: ++this._eventSeq,
    };

    client.ws.send(JSON.stringify(message));
    return true;
  }

  /**
   * Broadcast event to all connected clients
   * 
   * @param event - Event name
   * @param payload - Event data
   * @param filter - Optional filter function to select clients
   */
  broadcast(event: string, payload?: unknown, filter?: (client: GatewayClient) => boolean): void {
    const message: GatewayEvent = {
      type: 'event',
      event,
      payload,
      seq: ++this._eventSeq,
    };

    const data = JSON.stringify(message);

    for (const client of this._clients.values()) {
      if (client.ws.readyState === WebSocket.OPEN) {
        if (!filter || filter(client)) {
          client.ws.send(data);
        }
      }
    }
  }

  /**
   * Broadcast event to operators only
   */
  broadcastToOperators(event: string, payload?: unknown): void {
    this.broadcast(event, payload, (client) => client.role === 'operator');
  }

  /**
   * Broadcast event to nodes only
   */
  broadcastToNodes(event: string, payload?: unknown): void {
    this.broadcast(event, payload, (client) => client.role === 'node');
  }

  // ===========================================================================
  // Handler Registration
  // ===========================================================================

  /**
   * Register a request handler
   * 
   * @param method - Method name
   * @param handler - Handler function
   */
  registerHandler(
    method: string,
    handler: (client: GatewayClient, params: unknown) => Promise<unknown>
  ): void {
    this._handlers.set(method, handler);
    logger.debug('Registered handler', { method });
  }

  /**
   * Register default request handlers
   */
  private _registerDefaultHandlers(): void {
    // Health check
    this.registerHandler('health', async () => {
      return this.getHealth();
    });

    // Get status
    this.registerHandler('status', async () => {
      return {
        running: this._isRunning,
        uptime: Date.now() - this._startTime,
        clients: this._clients.size,
      };
    });

    // Register extended handlers for CLI/Web UI support
    registerExtendedHandlers(this);

    // List clients
    this.registerHandler('clients.list', async (client) => {
      // Only operators can list clients
      if (client.role !== 'operator') {
        throw new Error('Permission denied');
      }

      return Array.from(this._clients.values()).map((c) => ({
        id: c.id,
        role: c.role,
        name: c.name,
        platform: c.platform,
        connectedAt: c.connectedAt,
        capabilities: c.capabilities,
        pairingStatus: c.pairingStatus,
      }));
    });

    // Node pairing approval
    this.registerHandler('node.approve', async (client, params) => {
      if (client.role !== 'operator') {
        throw new Error('Permission denied');
      }

      const { nodeId } = params as { nodeId: string };
      const node = this._clients.get(nodeId);

      if (!node || node.role !== 'node') {
        throw new Error('Node not found');
      }

      node.pairingStatus = 'approved';
      this.sendEvent(nodeId, 'pairing.approved', {});

      return { success: true };
    });

    // Node pairing rejection
    this.registerHandler('node.reject', async (client, params) => {
      if (client.role !== 'operator') {
        throw new Error('Permission denied');
      }

      const { nodeId } = params as { nodeId: string };
      const node = this._clients.get(nodeId);

      if (!node || node.role !== 'node') {
        throw new Error('Node not found');
      }

      node.pairingStatus = 'rejected';
      this.sendEvent(nodeId, 'pairing.rejected', {});
      node.ws.close(4004, 'Pairing rejected');

      return { success: true };
    });

    // Node invoke (call a node command)
    this.registerHandler('node.invoke', async (client, params) => {
      const { nodeId, command, commandParams } = params as {
        nodeId: string;
        command: string;
        commandParams?: Record<string, unknown>;
      };

      const node = this._clients.get(nodeId);

      if (!node || node.role !== 'node') {
        throw new Error('Node not found');
      }

      if (node.pairingStatus !== 'approved') {
        throw new Error('Node not approved');
      }

      // Forward command to node and wait for response
      // This is a simplified implementation - production would use request IDs
      return new Promise((resolve, reject) => {
        const requestId = uuidv4();
        const timeout = setTimeout(() => {
          reject(new Error('Node command timeout'));
        }, 30000);

        const messageHandler = (data: WebSocket.Data) => {
          try {
            const response = JSON.parse(data.toString()) as GatewayResponse;
            if (response.type === 'res' && response.id === requestId) {
              clearTimeout(timeout);
              node.ws.off('message', messageHandler);
              if (response.ok) {
                resolve(response.payload);
              } else {
                reject(new Error(response.error || 'Node command failed'));
              }
            }
          } catch {
            // Not our response, ignore
          }
        };

        node.ws.on('message', messageHandler);

        // Send command to node
        const request: GatewayRequest = {
          type: 'req',
          id: requestId,
          method: command,
          params: commandParams,
        };
        node.ws.send(JSON.stringify(request));
      });
    });

    // Ping/pong for keepalive
    this.registerHandler('ping', async () => {
      return { pong: Date.now() };
    });
  }

  // ===========================================================================
  // Heartbeat
  // ===========================================================================

  /**
   * Start heartbeat timer
   * 
   * Periodically checks client connections and removes stale ones
   */
  private _startHeartbeat(): void {
    this._heartbeatTimer = setInterval(() => {
      const now = Date.now();
      const timeout = this._config.clientTimeout;

      for (const [clientId, client] of this._clients.entries()) {
        if (now - client.lastActivity > timeout) {
          logger.warn('Client timed out', { clientId });
          client.ws.close(4005, 'Connection timeout');
          this._clients.delete(clientId);
        }
      }

      // Broadcast heartbeat event
      this.broadcast('heartbeat', { timestamp: now });
    }, this._config.heartbeatInterval);
  }

  /**
   * Broadcast presence update to all clients
   */
  private _broadcastPresence(): void {
    const presence = {
      operators: Array.from(this._clients.values())
        .filter((c) => c.role === 'operator')
        .map((c) => ({ id: c.id, name: c.name })),
      nodes: Array.from(this._clients.values())
        .filter((c) => c.role === 'node')
        .map((c) => ({
          id: c.id,
          name: c.name,
          platform: c.platform,
          capabilities: c.capabilities,
          pairingStatus: c.pairingStatus,
        })),
    };

    this.broadcast('presence', presence);
  }

  // ===========================================================================
  // Public Getters
  // ===========================================================================

  /**
   * Get gateway health status
   */
  getHealth(): GatewayHealth {
    const clients = Array.from(this._clients.values());

    return {
      status: this._isRunning ? 'healthy' : 'unhealthy',
      uptime: this._isRunning ? Date.now() - this._startTime : 0,
      clients: {
        total: clients.length,
        operators: clients.filter((c) => c.role === 'operator').length,
        nodes: clients.filter((c) => c.role === 'node').length,
      },
      version: '1.0.0',
    };
  }

  /**
   * Get all connected clients
   */
  getClients(): GatewayClient[] {
    return Array.from(this._clients.values());
  }

  /**
   * Get connected nodes
   */
  getNodes(): GatewayClient[] {
    return Array.from(this._clients.values()).filter((c) => c.role === 'node');
  }

  /**
   * Get a specific client by ID
   */
  getClient(clientId: string): GatewayClient | undefined {
    return this._clients.get(clientId);
  }

  /**
   * Check if gateway is running
   */
  get isRunning(): boolean {
    return this._isRunning;
  }

  /**
   * Get gateway configuration
   */
  get config(): GatewayConfig {
    return { ...this._config };
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let gatewayInstance: Gateway | null = null;

/**
 * Get the gateway singleton instance
 * 
 * @returns Gateway instance (creates one if not exists)
 */
export function getGateway(): Gateway {
  if (!gatewayInstance) {
    gatewayInstance = new Gateway();
  }
  return gatewayInstance;
}

/**
 * Start the gateway with optional configuration
 * 
 * @param config - Gateway configuration
 * @returns Promise that resolves when gateway is started
 */
export async function startGateway(config?: Partial<GatewayConfig>): Promise<Gateway> {
  if (gatewayInstance?.isRunning) {
    logger.warn('Gateway already running');
    return gatewayInstance;
  }

  gatewayInstance = new Gateway(config);
  await gatewayInstance.start();
  return gatewayInstance;
}

/**
 * Stop the gateway
 */
export async function stopGateway(): Promise<void> {
  if (gatewayInstance) {
    await gatewayInstance.stop();
    gatewayInstance = null;
  }
}

export default Gateway;
