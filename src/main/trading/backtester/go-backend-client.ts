/**
 * Atlas Autonomous Trading - Go Backend Client
 * 
 * Client for communicating with the Go backtesting backend.
 * Handles WebSocket connections for real-time updates and
 * HTTP requests for backtest management.
 */

import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { createModuleLogger } from '../../utils/logger';
import {
  GoBackendConfig,
  GoBackendStatus,
  BacktestConfig,
  BacktestRequest,
  BacktestResult,
  BacktestProgress,
  BacktestEvent,
} from './types';

const logger = createModuleLogger('GoBackendClient');

const DEFAULT_CONFIG: GoBackendConfig = {
  host: 'localhost',
  port: 8080,
  useTls: false,
  timeout: 30000,
};

interface BackendEvents {
  'connected': () => void;
  'disconnected': (reason: string) => void;
  'error': (error: Error) => void;
  'backtest:progress': (progress: BacktestProgress) => void;
  'backtest:event': (event: BacktestEvent) => void;
  'backtest:complete': (result: BacktestResult) => void;
  'backtest:error': (id: string, error: string) => void;
}

export class GoBackendClient extends EventEmitter {
  private config: GoBackendConfig;
  private ws: WebSocket | null = null;
  private connected = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private pingInterval: NodeJS.Timeout | null = null;
  private pendingRequests = new Map<string, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }>();

  constructor(config: Partial<GoBackendConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ===========================================================================
  // Connection Management
  // ===========================================================================

  async connect(): Promise<void> {
    if (this.connected) {
      logger.warn('Already connected to Go backend');
      return;
    }

    const protocol = this.config.useTls ? 'wss' : 'ws';
    const url = `${protocol}://${this.config.host}:${this.config.port}/ws`;

    logger.info('Connecting to Go backend...', { url });

    return new Promise((resolve, reject) => {
      try {
        const headers: Record<string, string> = {};
        if (this.config.apiKey) {
          headers['Authorization'] = `Bearer ${this.config.apiKey}`;
        }

        this.ws = new WebSocket(url, { headers });

        this.ws.on('open', () => {
          this.connected = true;
          this.reconnectAttempts = 0;
          logger.info('Connected to Go backend');
          this.startPingInterval();
          this.emit('connected');
          resolve();
        });

        this.ws.on('message', (data) => {
          this.handleMessage(data.toString());
        });

        this.ws.on('close', (code, reason) => {
          this.connected = false;
          this.stopPingInterval();
          logger.warn('Disconnected from Go backend', { code, reason: reason.toString() });
          this.emit('disconnected', reason.toString());
          this.attemptReconnect();
        });

        this.ws.on('error', (error) => {
          logger.error('WebSocket error', { error: error.message });
          this.emit('error', error);
          if (!this.connected) {
            reject(error);
          }
        });

        // Connection timeout
        setTimeout(() => {
          if (!this.connected) {
            this.ws?.close();
            reject(new Error('Connection timeout'));
          }
        }, this.config.timeout);

      } catch (error) {
        reject(error);
      }
    });
  }

  disconnect(): void {
    this.stopPingInterval();
    if (this.ws) {
      this.ws.close(1000, 'Client disconnecting');
      this.ws = null;
    }
    this.connected = false;
    
    // Reject all pending requests
    for (const [id, request] of this.pendingRequests) {
      clearTimeout(request.timeout);
      request.reject(new Error('Connection closed'));
    }
    this.pendingRequests.clear();
  }

  isConnected(): boolean {
    return this.connected;
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error('Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    
    logger.info(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    
    setTimeout(() => {
      this.connect().catch((error) => {
        logger.error('Reconnect failed', { error: error.message });
      });
    }, delay);
  }

  private startPingInterval(): void {
    this.pingInterval = setInterval(() => {
      if (this.connected && this.ws) {
        this.ws.ping();
      }
    }, 30000);
  }

  private stopPingInterval(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  // ===========================================================================
  // Message Handling
  // ===========================================================================

  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data);
      
      switch (message.type) {
        case 'response':
          this.handleResponse(message);
          break;
        case 'backtest:progress':
          this.emit('backtest:progress', message.payload as BacktestProgress);
          break;
        case 'backtest:event':
          this.emit('backtest:event', message.payload as BacktestEvent);
          break;
        case 'backtest:complete':
          this.emit('backtest:complete', message.payload as BacktestResult);
          break;
        case 'backtest:error':
          this.emit('backtest:error', message.payload.id, message.payload.error);
          break;
        case 'pong':
          // Heartbeat response
          break;
        default:
          logger.warn('Unknown message type', { type: message.type });
      }
    } catch (error) {
      logger.error('Failed to parse message', { error: (error as Error).message });
    }
  }

  private handleResponse(message: { id: string; success: boolean; data?: unknown; error?: string }): void {
    const pending = this.pendingRequests.get(message.id);
    if (!pending) {
      logger.warn('Received response for unknown request', { id: message.id });
      return;
    }

    clearTimeout(pending.timeout);
    this.pendingRequests.delete(message.id);

    if (message.success) {
      pending.resolve(message.data);
    } else {
      pending.reject(new Error(message.error || 'Unknown error'));
    }
  }

  private async sendRequest<T>(action: string, payload: unknown): Promise<T> {
    if (!this.connected || !this.ws) {
      throw new Error('Not connected to Go backend');
    }

    const id = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error('Request timeout'));
      }, this.config.timeout);

      this.pendingRequests.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout,
      });

      const message = JSON.stringify({
        id,
        action,
        payload,
      });

      this.ws!.send(message);
    });
  }

  // ===========================================================================
  // API Methods
  // ===========================================================================

  async getStatus(): Promise<GoBackendStatus> {
    return this.sendRequest<GoBackendStatus>('status', {});
  }

  async runBacktest(config: BacktestConfig): Promise<string> {
    const request: BacktestRequest = {
      config,
      priority: 'normal',
    };
    
    const response = await this.sendRequest<{ id: string }>('backtest:run', request);
    return response.id;
  }

  async getBacktestProgress(id: string): Promise<BacktestProgress> {
    return this.sendRequest<BacktestProgress>('backtest:progress', { id });
  }

  async getBacktestResult(id: string): Promise<BacktestResult> {
    return this.sendRequest<BacktestResult>('backtest:result', { id });
  }

  async cancelBacktest(id: string): Promise<void> {
    await this.sendRequest('backtest:cancel', { id });
  }

  async listBacktests(status?: string): Promise<BacktestProgress[]> {
    return this.sendRequest<BacktestProgress[]>('backtest:list', { status });
  }

  async loadHistoricalData(params: {
    symbol: string;
    startTime: number;
    endTime: number;
    resolution: string;
  }): Promise<{ loaded: number; symbol: string }> {
    return this.sendRequest('data:load', params);
  }

  async getLoadedSymbols(): Promise<string[]> {
    return this.sendRequest<string[]>('data:symbols', {});
  }

  async runMonteCarloSimulation(backtestId: string, runs: number): Promise<string> {
    const response = await this.sendRequest<{ id: string }>('montecarlo:run', {
      backtestId,
      runs,
    });
    return response.id;
  }

  async optimizeStrategy(params: {
    strategyId: string;
    parameterRanges: Record<string, [number, number]>;
    optimizationTarget: 'sharpe' | 'return' | 'calmar' | 'sortino';
    maxIterations: number;
  }): Promise<string> {
    const response = await this.sendRequest<{ id: string }>('strategy:optimize', params);
    return response.id;
  }

  // ===========================================================================
  // HTTP API Methods (for larger data transfers)
  // ===========================================================================

  private getBaseUrl(): string {
    const protocol = this.config.useTls ? 'https' : 'http';
    return `${protocol}://${this.config.host}:${this.config.port}`;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }
    return headers;
  }

  async uploadSignalData(source: string, data: unknown[]): Promise<{ uploaded: number }> {
    const response = await fetch(`${this.getBaseUrl()}/api/signals/${source}`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ signals: data }),
    });

    if (!response.ok) {
      throw new Error(`Failed to upload signal data: ${response.statusText}`);
    }

    return response.json();
  }

  async downloadBacktestReport(id: string, format: 'json' | 'csv' | 'pdf'): Promise<Blob> {
    const response = await fetch(`${this.getBaseUrl()}/api/backtest/${id}/report?format=${format}`, {
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Failed to download report: ${response.statusText}`);
    }

    return response.blob();
  }

  async getHistoricalPrices(params: {
    symbol: string;
    startTime: number;
    endTime: number;
    interval: string;
  }): Promise<Array<{
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>> {
    const query = new URLSearchParams({
      symbol: params.symbol,
      start: params.startTime.toString(),
      end: params.endTime.toString(),
      interval: params.interval,
    });

    const response = await fetch(`${this.getBaseUrl()}/api/prices?${query}`, {
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Failed to get prices: ${response.statusText}`);
    }

    return response.json();
  }
}

// Singleton instance
let backendClient: GoBackendClient | null = null;

export function getGoBackendClient(): GoBackendClient {
  if (!backendClient) {
    backendClient = new GoBackendClient();
  }
  return backendClient;
}

export function createGoBackendClient(config: Partial<GoBackendConfig>): GoBackendClient {
  backendClient = new GoBackendClient(config);
  return backendClient;
}
