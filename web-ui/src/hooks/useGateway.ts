/**
 * useGateway - WebSocket hook for Gateway communication
 */

import { useState, useEffect, useCallback, useRef } from 'react';

interface GatewayHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  uptime: number;
  clients: {
    total: number;
    operators: number;
    nodes: number;
  };
  version: string;
}

interface GatewayClient {
  id: string;
  role: string;
  name?: string;
  platform?: string;
  connectedAt: number;
  pairingStatus: string;
}

interface GatewayState {
  connected: boolean;
  health: GatewayHealth | null;
  clients: GatewayClient[];
  error: string | null;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export function useGateway() {
  const [state, setState] = useState<GatewayState>({
    connected: false,
    health: null,
    clients: [],
    error: null,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const pendingRequestsRef = useRef<Map<string, PendingRequest>>(new Map());
  const reconnectTimeoutRef = useRef<number | null>(null);

  // Generate unique request ID
  const generateId = () => Math.random().toString(36).substring(2, 15);

  // Send request and wait for response
  const request = useCallback(async <T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> => {
    return new Promise((resolve, reject) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        reject(new Error('Not connected'));
        return;
      }

      const id = generateId();
      pendingRequestsRef.current.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });

      wsRef.current.send(JSON.stringify({
        type: 'req',
        id,
        method,
        params,
      }));

      // Timeout after 30 seconds
      setTimeout(() => {
        const pending = pendingRequestsRef.current.get(id);
        if (pending) {
          pendingRequestsRef.current.delete(id);
          pending.reject(new Error('Request timeout'));
        }
      }, 30000);
    });
  }, []);

  // Connect to gateway
  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.hostname;
    const port = window.location.port || '18789';
    const wsUrl = `${protocol}//${host}:${port}`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = async () => {
      try {
        // Send connect request
        const connectId = generateId();

        await new Promise<void>((resolve, reject) => {
          pendingRequestsRef.current.set(connectId, {
            resolve: () => resolve(),
            reject,
          });

          ws.send(JSON.stringify({
            type: 'req',
            id: connectId,
            method: 'connect',
            params: {
              role: 'operator',
              device: {
                id: `web-${Date.now()}`,
                name: 'Web Dashboard',
                platform: 'web',
              },
            },
          }));
        });

        setState(prev => ({ ...prev, connected: true, error: null }));

        // Fetch initial data
        const health = await request<GatewayHealth>('health');
        const clientsResult = await request<GatewayClient[]>('clients.list');

        setState(prev => ({
          ...prev,
          health,
          clients: clientsResult || [],
        }));
      } catch (error) {
        setState(prev => ({
          ...prev,
          error: (error as Error).message,
        }));
      }
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);

        if (message.type === 'res') {
          const pending = pendingRequestsRef.current.get(message.id);
          if (pending) {
            pendingRequestsRef.current.delete(message.id);
            if (message.ok) {
              pending.resolve(message.payload);
            } else {
              pending.reject(new Error(message.error || 'Request failed'));
            }
          }
        } else if (message.type === 'event') {
          // Handle events
          if (message.event === 'presence') {
            // Update clients list from presence event
          }
        }
      } catch {
        // Ignore parse errors
      }
    };

    ws.onclose = () => {
      setState(prev => ({ ...prev, connected: false }));

      // Attempt reconnect after 5 seconds
      reconnectTimeoutRef.current = window.setTimeout(() => {
        connect();
      }, 5000);
    };

    ws.onerror = () => {
      setState(prev => ({
        ...prev,
        error: 'WebSocket connection error',
      }));
    };
  }, [request]);

  // Disconnect
  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    wsRef.current?.close();
    wsRef.current = null;
    setState(prev => ({ ...prev, connected: false }));
  }, []);

  // Auto-connect on mount
  useEffect(() => {
    connect();
    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  // Refresh data
  const refresh = useCallback(async () => {
    if (!state.connected) return;

    try {
      const health = await request<GatewayHealth>('health');
      const clients = await request<GatewayClient[]>('clients.list');

      setState(prev => ({
        ...prev,
        health,
        clients: clients || [],
      }));
    } catch (error) {
      setState(prev => ({
        ...prev,
        error: (error as Error).message,
      }));
    }
  }, [state.connected, request]);

  return {
    ...state,
    connect,
    disconnect,
    request,
    refresh,
  };
}

export default useGateway;
