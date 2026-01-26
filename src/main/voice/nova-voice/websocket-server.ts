/**
 * NovaVoice - WebSocket Server
 * Standalone WebSocket server for non-Electron applications
 */

import { EventEmitter } from 'events';
import { WebSocket, WebSocketServer } from 'ws';
import { createServer, Server as HttpServer } from 'http';
import { createModuleLogger } from '../../utils/logger';
import { NovaVoice, initializeNovaVoice, getNovaVoice } from './nova-voice';
import { PipelineConfig, AudioChunk, PipelineState } from './types';

const logger = createModuleLogger('NovaVoice-WebSocket');

// ============================================
// Types
// ============================================

export interface WebSocketServerConfig {
  port: number;
  host: string;
  path: string;
  maxConnections: number;
  authToken?: string;
  enableCompression: boolean;
  pingInterval: number;
}

const DEFAULT_WS_CONFIG: WebSocketServerConfig = {
  port: 8765,
  host: '0.0.0.0',
  path: '/nova-voice',
  maxConnections: 10,
  authToken: undefined,
  enableCompression: true,
  pingInterval: 30000,
};

interface WebSocketMessage {
  type: string;
  id?: string;
  data?: unknown;
}

interface ClientState {
  id: string;
  authenticated: boolean;
  isListening: boolean;
  lastPing: number;
}

// ============================================
// WebSocket Server
// ============================================

export class NovaVoiceWebSocketServer extends EventEmitter {
  private config: WebSocketServerConfig;
  private httpServer: HttpServer | null = null;
  private wss: WebSocketServer | null = null;
  private voice: NovaVoice | null = null;
  private clients: Map<WebSocket, ClientState> = new Map();
  private pingInterval: NodeJS.Timeout | null = null;
  private isRunning = false;
  
  constructor(config: Partial<WebSocketServerConfig> = {}) {
    super();
    this.config = { ...DEFAULT_WS_CONFIG, ...config };
  }
  
  /**
   * Start the WebSocket server
   */
  async start(voiceConfig?: Partial<PipelineConfig>): Promise<void> {
    if (this.isRunning) {
      logger.warn('WebSocket server already running');
      return;
    }
    
    // Initialize NovaVoice
    this.voice = await initializeNovaVoice(voiceConfig);
    this.setupVoiceListeners();
    
    // Create HTTP server
    this.httpServer = createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        service: 'NovaVoice WebSocket Server',
        status: 'running',
        connections: this.clients.size,
        path: this.config.path,
      }));
    });
    
    // Create WebSocket server
    this.wss = new WebSocketServer({
      server: this.httpServer,
      path: this.config.path,
      perMessageDeflate: this.config.enableCompression,
    });
    
    this.wss.on('connection', this.handleConnection.bind(this));
    this.wss.on('error', (error) => {
      logger.error('WebSocket server error', { error: error.message });
      this.emit('error', error);
    });
    
    // Start HTTP server
    await new Promise<void>((resolve) => {
      this.httpServer!.listen(this.config.port, this.config.host, () => {
        logger.info('NovaVoice WebSocket server started', {
          host: this.config.host,
          port: this.config.port,
          path: this.config.path,
        });
        resolve();
      });
    });
    
    // Start ping interval
    this.pingInterval = setInterval(() => {
      this.pingClients();
    }, this.config.pingInterval);
    
    this.isRunning = true;
    this.emit('started');
  }
  
  /**
   * Stop the WebSocket server
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;
    
    // Stop ping interval
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    
    // Close all clients
    for (const [ws] of this.clients) {
      ws.close(1001, 'Server shutting down');
    }
    this.clients.clear();
    
    // Close WebSocket server
    if (this.wss) {
      await new Promise<void>((resolve) => {
        this.wss!.close(() => resolve());
      });
      this.wss = null;
    }
    
    // Close HTTP server
    if (this.httpServer) {
      await new Promise<void>((resolve) => {
        this.httpServer!.close(() => resolve());
      });
      this.httpServer = null;
    }
    
    this.isRunning = false;
    logger.info('NovaVoice WebSocket server stopped');
    this.emit('stopped');
  }
  
  /**
   * Handle new WebSocket connection
   */
  private handleConnection(ws: WebSocket, req: any): void {
    // Check max connections
    if (this.clients.size >= this.config.maxConnections) {
      ws.close(1013, 'Maximum connections reached');
      return;
    }
    
    // Create client state
    const clientId = this.generateClientId();
    const clientState: ClientState = {
      id: clientId,
      authenticated: !this.config.authToken, // Auto-auth if no token required
      isListening: false,
      lastPing: Date.now(),
    };
    
    this.clients.set(ws, clientState);
    logger.info('Client connected', { clientId, totalClients: this.clients.size });
    
    // Send welcome message
    this.sendMessage(ws, {
      type: 'connected',
      data: {
        clientId,
        authRequired: !!this.config.authToken,
        version: '1.0.0',
      },
    });
    
    // Handle messages
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString()) as WebSocketMessage;
        this.handleMessage(ws, message);
      } catch (error) {
        logger.error('Invalid message format', { error });
        this.sendError(ws, 'Invalid message format');
      }
    });
    
    ws.on('close', () => {
      const state = this.clients.get(ws);
      this.clients.delete(ws);
      logger.info('Client disconnected', {
        clientId: state?.id,
        totalClients: this.clients.size,
      });
    });
    
    ws.on('error', (error) => {
      logger.error('Client error', { clientId, error: error.message });
    });
    
    ws.on('pong', () => {
      const state = this.clients.get(ws);
      if (state) {
        state.lastPing = Date.now();
      }
    });
  }
  
  /**
   * Handle incoming message
   */
  private async handleMessage(ws: WebSocket, message: WebSocketMessage): Promise<void> {
    const state = this.clients.get(ws);
    if (!state) return;
    
    // Handle authentication
    if (this.config.authToken && !state.authenticated) {
      if (message.type === 'auth' && message.data === this.config.authToken) {
        state.authenticated = true;
        this.sendMessage(ws, { type: 'auth_success', id: message.id });
        return;
      }
      this.sendError(ws, 'Authentication required', message.id);
      return;
    }
    
    try {
      switch (message.type) {
        case 'start_listening':
          await this.voice?.startListening();
          state.isListening = true;
          this.sendMessage(ws, { type: 'listening_started', id: message.id });
          break;
          
        case 'stop_listening':
          await this.voice?.stopListening();
          state.isListening = false;
          this.sendMessage(ws, { type: 'listening_stopped', id: message.id });
          break;
          
        case 'audio':
          if (state.isListening && this.voice) {
            const audioData = message.data as { samples: number[]; sampleRate: number };
            const chunk: AudioChunk = {
              data: new Float32Array(audioData.samples),
              timestamp: Date.now(),
              duration: (audioData.samples.length / audioData.sampleRate) * 1000,
              format: {
                sampleRate: audioData.sampleRate,
                channels: 1,
                bitDepth: 32,
                encoding: 'float32',
              },
            };
            await this.voice.processAudioInput(chunk);
          }
          break;
          
        case 'speak':
          if (this.voice) {
            const { text, options } = message.data as { text: string; options?: any };
            const result = await this.voice.speak(text, options);
            this.sendMessage(ws, { type: 'speak_complete', id: message.id, data: result });
          }
          break;
          
        case 'interrupt':
          this.voice?.interrupt();
          this.sendMessage(ws, { type: 'interrupted', id: message.id });
          break;
          
        case 'get_voices':
          const voices = this.voice?.getVoices() || [];
          this.sendMessage(ws, { type: 'voices', id: message.id, data: voices });
          break;
          
        case 'set_voice':
          if (this.voice && message.data) {
            this.voice.setVoice(message.data as string);
            this.sendMessage(ws, { type: 'voice_set', id: message.id });
          }
          break;
          
        case 'get_config':
          const config = this.voice?.getConfig();
          this.sendMessage(ws, { type: 'config', id: message.id, data: config });
          break;
          
        case 'set_config':
          if (this.voice && message.data) {
            this.voice.setConfig(message.data as Partial<PipelineConfig>);
            this.sendMessage(ws, { type: 'config_set', id: message.id });
          }
          break;
          
        case 'get_metrics':
          const metrics = this.voice?.getLatencyMetrics();
          this.sendMessage(ws, { type: 'metrics', id: message.id, data: metrics });
          break;
          
        case 'ping':
          this.sendMessage(ws, { type: 'pong', id: message.id });
          break;
          
        default:
          this.sendError(ws, `Unknown message type: ${message.type}`, message.id);
      }
    } catch (error) {
      const err = error as Error;
      logger.error('Error handling message', { type: message.type, error: err.message });
      this.sendError(ws, err.message, message.id);
    }
  }
  
  /**
   * Setup NovaVoice event listeners
   */
  private setupVoiceListeners(): void {
    if (!this.voice) return;
    
    this.voice.on('state-change', (state: PipelineState) => {
      this.broadcast({ type: 'state_change', data: state });
    });
    
    this.voice.on('vad-result', (result) => {
      this.broadcast({ type: 'vad_result', data: result });
    });
    
    this.voice.on('vad-speech-start', () => {
      this.broadcast({ type: 'speech_start' });
    });
    
    this.voice.on('vad-speech-end', () => {
      this.broadcast({ type: 'speech_end' });
    });
    
    this.voice.on('stt-partial', (text) => {
      this.broadcast({ type: 'stt_partial', data: text });
    });
    
    this.voice.on('stt-final', (transcription) => {
      this.broadcast({ type: 'stt_final', data: transcription });
    });
    
    this.voice.on('tts-start', (text) => {
      this.broadcast({ type: 'tts_start', data: text });
    });
    
    this.voice.on('tts-chunk', (chunk) => {
      // Convert to serializable format
      const serialized = {
        samples: Array.from(chunk.data instanceof Float32Array 
          ? chunk.data 
          : new Float32Array(chunk.data.buffer)),
        timestamp: chunk.timestamp,
        duration: chunk.duration,
        format: chunk.format,
        isFinal: chunk.isFinal,
      };
      this.broadcast({ type: 'tts_chunk', data: serialized });
    });
    
    this.voice.on('tts-complete', () => {
      this.broadcast({ type: 'tts_complete' });
    });
    
    this.voice.on('error', (error) => {
      this.broadcast({ type: 'error', data: { message: error.message } });
    });
    
    this.voice.on('latency-metrics', (metrics) => {
      this.broadcast({ type: 'latency_metrics', data: metrics });
    });
  }
  
  /**
   * Send message to client
   */
  private sendMessage(ws: WebSocket, message: WebSocketMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }
  
  /**
   * Send error to client
   */
  private sendError(ws: WebSocket, error: string, id?: string): void {
    this.sendMessage(ws, { type: 'error', id, data: { message: error } });
  }
  
  /**
   * Broadcast message to all authenticated clients
   */
  private broadcast(message: WebSocketMessage): void {
    for (const [ws, state] of this.clients) {
      if (state.authenticated && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
      }
    }
  }
  
  /**
   * Ping all clients to check connection
   */
  private pingClients(): void {
    const now = Date.now();
    const timeout = this.config.pingInterval * 2;
    
    for (const [ws, state] of this.clients) {
      if (now - state.lastPing > timeout) {
        logger.warn('Client ping timeout', { clientId: state.id });
        ws.terminate();
        this.clients.delete(ws);
      } else {
        ws.ping();
      }
    }
  }
  
  /**
   * Generate unique client ID
   */
  private generateClientId(): string {
    return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  
  /**
   * Get server status
   */
  getStatus(): { running: boolean; clients: number; port: number } {
    return {
      running: this.isRunning,
      clients: this.clients.size,
      port: this.config.port,
    };
  }
}

// ============================================
// Client Library
// ============================================

export interface NovaVoiceClientConfig {
  url: string;
  authToken?: string;
  reconnect: boolean;
  reconnectInterval: number;
  maxReconnectAttempts: number;
}

const DEFAULT_CLIENT_CONFIG: NovaVoiceClientConfig = {
  url: 'ws://localhost:8765/nova-voice',
  authToken: undefined,
  reconnect: true,
  reconnectInterval: 5000,
  maxReconnectAttempts: 10,
};

export class NovaVoiceClient extends EventEmitter {
  private config: NovaVoiceClientConfig;
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private messageId = 0;
  private pendingRequests: Map<string, { resolve: Function; reject: Function }> = new Map();
  private isConnected = false;
  
  constructor(config: Partial<NovaVoiceClientConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CLIENT_CONFIG, ...config };
  }
  
  /**
   * Connect to server
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.config.url);
      
      this.ws.on('open', async () => {
        this.isConnected = true;
        this.reconnectAttempts = 0;
        
        // Authenticate if needed
        if (this.config.authToken) {
          try {
            await this.request('auth', this.config.authToken);
          } catch (error) {
            reject(error);
            return;
          }
        }
        
        this.emit('connected');
        resolve();
      });
      
      this.ws.on('message', (data) => {
        const message = JSON.parse(data.toString()) as WebSocketMessage;
        this.handleMessage(message);
      });
      
      this.ws.on('close', () => {
        this.isConnected = false;
        this.emit('disconnected');
        
        if (this.config.reconnect && this.reconnectAttempts < this.config.maxReconnectAttempts) {
          this.reconnectAttempts++;
          setTimeout(() => this.connect(), this.config.reconnectInterval);
        }
      });
      
      this.ws.on('error', (error) => {
        this.emit('error', error);
        reject(error);
      });
    });
  }
  
  /**
   * Disconnect from server
   */
  disconnect(): void {
    this.config.reconnect = false;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
  
  /**
   * Send request and wait for response
   */
  private async request(type: string, data?: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = `msg_${++this.messageId}`;
      
      this.pendingRequests.set(id, { resolve, reject });
      
      this.ws?.send(JSON.stringify({ type, id, data }));
      
      // Timeout
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('Request timeout'));
        }
      }, 30000);
    });
  }
  
  /**
   * Handle incoming message
   */
  private handleMessage(message: WebSocketMessage): void {
    // Check if this is a response to a pending request
    if (message.id && this.pendingRequests.has(message.id)) {
      const { resolve, reject } = this.pendingRequests.get(message.id)!;
      this.pendingRequests.delete(message.id);
      
      if (message.type === 'error') {
        reject(new Error((message.data as any).message));
      } else {
        resolve(message.data);
      }
      return;
    }
    
    // Emit events
    this.emit(message.type, message.data);
  }
  
  // Public API methods
  
  async startListening(): Promise<void> {
    await this.request('start_listening');
  }
  
  async stopListening(): Promise<void> {
    await this.request('stop_listening');
  }
  
  async sendAudio(samples: Float32Array, sampleRate: number): Promise<void> {
    this.ws?.send(JSON.stringify({
      type: 'audio',
      data: { samples: Array.from(samples), sampleRate },
    }));
  }
  
  async speak(text: string, options?: any): Promise<unknown> {
    return this.request('speak', { text, options });
  }
  
  async interrupt(): Promise<void> {
    await this.request('interrupt');
  }
  
  async getVoices(): Promise<unknown[]> {
    return this.request('get_voices') as Promise<unknown[]>;
  }
  
  async setVoice(voiceId: string): Promise<void> {
    await this.request('set_voice', voiceId);
  }
  
  async getConfig(): Promise<unknown> {
    return this.request('get_config');
  }
  
  async setConfig(config: unknown): Promise<void> {
    await this.request('set_config', config);
  }
  
  async getMetrics(): Promise<unknown> {
    return this.request('get_metrics');
  }
}

// ============================================
// Exports
// ============================================

export { DEFAULT_WS_CONFIG, DEFAULT_CLIENT_CONFIG };
