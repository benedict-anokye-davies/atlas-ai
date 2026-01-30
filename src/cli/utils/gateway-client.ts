/**
 * @fileoverview Gateway Client - WebSocket client for CLI communication
 * @module cli/utils/gateway-client
 * @author Atlas Team
 * @since 1.0.0
 *
 * @description
 * Provides a WebSocket client for CLI tools to communicate with the
 * Atlas Gateway. Handles connection, authentication, request/response
 * correlation, and event subscription.
 *
 * @example
 * ```typescript
 * const client = new GatewayClient();
 * await client.connect({ port: 18789, token: 'secret' });
 *
 * const health = await client.request('health');
 * console.log('Gateway health:', health);
 *
 * client.on('event', (event, payload) => {
 *   console.log('Received event:', event, payload);
 * });
 *
 * await client.disconnect();
 * ```
 */

import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';

// =============================================================================
// Types
// =============================================================================

/**
 * Gateway client configuration
 */
export interface GatewayClientConfig {
  /** Gateway host (default: '127.0.0.1') */
  host?: string;
  /** Gateway port (default: 18789) */
  port?: number;
  /** Authentication token */
  token?: string;
  /** Connection timeout in ms (default: 10000) */
  timeout?: number;
  /** Auto-reconnect on disconnect (default: false for CLI) */
  autoReconnect?: boolean;
}

/**
 * Gateway request message
 */
interface GatewayRequest {
  type: 'req';
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

/**
 * Gateway response message
 */
interface GatewayResponse {
  type: 'res';
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: string;
}

/**
 * Gateway event message
 */
interface GatewayEvent {
  type: 'event';
  event: string;
  payload?: unknown;
  seq?: number;
}

/**
 * Pending request tracker
 */
interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

// =============================================================================
// Gateway Client
// =============================================================================

/**
 * WebSocket client for Gateway communication
 *
 * Provides request/response pattern over WebSocket with:
 * - Automatic request ID correlation
 * - Request timeouts
 * - Event subscription
 * - Connection management
 *
 * @class GatewayClient
 * @extends EventEmitter
 */
export class GatewayClient extends EventEmitter {
  private _ws: WebSocket | null = null;
  private _config: Required<GatewayClientConfig>;
  private _isConnected: boolean = false;
  private _pendingRequests: Map<string, PendingRequest> = new Map();
  private _clientId: string = '';

  constructor(config: GatewayClientConfig = {}) {
    super();
    this._config = {
      host: config.host || '127.0.0.1',
      port: config.port || 18789,
      token: config.token || '',
      timeout: config.timeout || 10000,
      autoReconnect: config.autoReconnect || false,
    };
  }

  // ===========================================================================
  // Connection Management
  // ===========================================================================

  /**
   * Connect to the Gateway
   *
   * @returns Promise that resolves when connected and authenticated
   * @throws Error if connection or authentication fails
   */
  async connect(): Promise<void> {
    if (this._isConnected) {
      return;
    }

    return new Promise((resolve, reject) => {
      const url = `ws://${this._config.host}:${this._config.port}`;

      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
        this._ws?.close();
      }, this._config.timeout);

      try {
        this._ws = new WebSocket(url);

        this._ws.on('open', async () => {
          clearTimeout(timeout);

          try {
            // Send connect request
            const response = await this._sendConnectRequest();
            this._clientId = response.clientId as string;
            this._isConnected = true;
            this.emit('connected');
            resolve();
          } catch (error) {
            reject(error);
            this._ws?.close();
          }
        });

        this._ws.on('message', (data) => {
          this._handleMessage(data.toString());
        });

        this._ws.on('close', (code, reason) => {
          this._handleClose(code, reason.toString());
        });

        this._ws.on('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      } catch (error) {
        clearTimeout(timeout);
        reject(error);
      }
    });
  }

  /**
   * Disconnect from the Gateway
   */
  async disconnect(): Promise<void> {
    if (!this._ws) {
      return;
    }

    // Cancel pending requests
    for (const [id, pending] of this._pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Connection closed'));
    }
    this._pendingRequests.clear();

    // Close WebSocket
    this._ws.close(1000, 'Client disconnect');
    this._ws = null;
    this._isConnected = false;
    this._clientId = '';
  }

  /**
   * Check if connected
   */
  get isConnected(): boolean {
    return this._isConnected;
  }

  /**
   * Get client ID assigned by gateway
   */
  get clientId(): string {
    return this._clientId;
  }

  // ===========================================================================
  // Request/Response
  // ===========================================================================

  /**
   * Send a request to the Gateway
   *
   * @param method - Request method name
   * @param params - Request parameters
   * @returns Promise that resolves with the response payload
   * @throws Error if request fails or times out
   */
  async request<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    if (!this._ws || !this._isConnected) {
      throw new Error('Not connected to gateway');
    }

    const id = uuidv4();

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this._pendingRequests.delete(id);
        reject(new Error(`Request timeout: ${method}`));
      }, this._config.timeout);

      this._pendingRequests.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout,
      });

      const request: GatewayRequest = {
        type: 'req',
        id,
        method,
        params,
      };

      this._ws!.send(JSON.stringify(request));
    });
  }

  // ===========================================================================
  // Internal Methods
  // ===========================================================================

  /**
   * Send the initial connect request
   */
  private async _sendConnectRequest(): Promise<{ clientId: string }> {
    const id = uuidv4();

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Connect request timeout'));
      }, this._config.timeout);

      const handleResponse = (data: string) => {
        try {
          const message = JSON.parse(data);
          if (message.type === 'res' && message.id === id) {
            clearTimeout(timeout);
            this._ws?.off('message', handleResponse);

            if (message.ok) {
              resolve(message.payload);
            } else {
              reject(new Error(message.error || 'Connect failed'));
            }
          }
        } catch {
          // Ignore parse errors
        }
      };

      this._ws!.on('message', handleResponse);

      const request: GatewayRequest = {
        type: 'req',
        id,
        method: 'connect',
        params: {
          role: 'operator',
          auth: this._config.token ? { token: this._config.token } : undefined,
          device: {
            id: `cli-${process.pid}`,
            name: 'Atlas CLI',
            platform: process.platform,
          },
        },
      };

      this._ws!.send(JSON.stringify(request));
    });
  }

  /**
   * Handle incoming message
   */
  private _handleMessage(data: string): void {
    try {
      const message = JSON.parse(data);

      if (message.type === 'res') {
        this._handleResponse(message as GatewayResponse);
      } else if (message.type === 'event') {
        this._handleEvent(message as GatewayEvent);
      }
    } catch {
      // Ignore parse errors
    }
  }

  /**
   * Handle response message
   */
  private _handleResponse(response: GatewayResponse): void {
    const pending = this._pendingRequests.get(response.id);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timeout);
    this._pendingRequests.delete(response.id);

    if (response.ok) {
      pending.resolve(response.payload);
    } else {
      pending.reject(new Error(response.error || 'Request failed'));
    }
  }

  /**
   * Handle event message
   */
  private _handleEvent(event: GatewayEvent): void {
    this.emit('event', event.event, event.payload);
    this.emit(`event:${event.event}`, event.payload);
  }

  /**
   * Handle connection close
   */
  private _handleClose(code: number, reason: string): void {
    this._isConnected = false;

    // Reject all pending requests
    for (const [, pending] of this._pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Connection closed'));
    }
    this._pendingRequests.clear();

    this.emit('disconnected', code, reason);

    // Auto-reconnect if enabled
    if (this._config.autoReconnect && code !== 1000) {
      setTimeout(() => {
        this.connect().catch(() => {
          // Silently fail reconnect attempts
        });
      }, 5000);
    }
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Create a gateway client with default config from environment
 */
export function createGatewayClient(overrides?: GatewayClientConfig): GatewayClient {
  return new GatewayClient({
    host: process.env.ATLAS_GATEWAY_HOST || '127.0.0.1',
    port: parseInt(process.env.ATLAS_GATEWAY_PORT || '18789', 10),
    token: process.env.ATLAS_GATEWAY_TOKEN,
    ...overrides,
  });
}

export default GatewayClient;
