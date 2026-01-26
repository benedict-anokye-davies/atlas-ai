/**
 * Atlas Desktop - Mobile Companion API Server
 * REST API endpoints for remote control from mobile devices
 */

import { app, ipcMain } from 'electron';
import * as http from 'http';
import * as https from 'https';
import * as crypto from 'crypto';
import { createModuleLogger } from '../utils/logger';
import { getErrorMessage } from '../../shared/utils';
import type { BrowserWindow } from 'electron';

const logger = createModuleLogger('MobileAPI');

// ============================================================================
// Types
// ============================================================================

export interface MobileAPIConfig {
  enabled: boolean;
  port: number;
  useHttps: boolean;
  requireAuth: boolean;
  authToken?: string;
  allowedOrigins: string[];
  maxRequestsPerMinute: number;
}

interface APIRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  body: unknown;
  headers: http.IncomingHttpHeaders;
}

interface APIResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
}

type RouteHandler = (req: APIRequest) => Promise<APIResponse> | APIResponse;

interface Route {
  method: string;
  path: RegExp;
  handler: RouteHandler;
  requireAuth: boolean;
}

// ============================================================================
// Rate Limiter
// ============================================================================

class RateLimiter {
  private requests: Map<string, number[]> = new Map();
  private maxRequests: number;
  private windowMs: number;

  constructor(maxRequests: number, windowMs: number = 60000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  isAllowed(ip: string): boolean {
    const now = Date.now();
    const timestamps = this.requests.get(ip) || [];
    
    // Filter out old timestamps
    const recent = timestamps.filter(t => now - t < this.windowMs);
    
    if (recent.length >= this.maxRequests) {
      return false;
    }

    recent.push(now);
    this.requests.set(ip, recent);
    return true;
  }

  getRemainingRequests(ip: string): number {
    const now = Date.now();
    const timestamps = this.requests.get(ip) || [];
    const recent = timestamps.filter(t => now - t < this.windowMs);
    return Math.max(0, this.maxRequests - recent.length);
  }
}

// ============================================================================
// Mobile API Server
// ============================================================================

export class MobileAPIServer {
  private server: http.Server | https.Server | null = null;
  private config: MobileAPIConfig;
  private routes: Route[] = [];
  private rateLimiter: RateLimiter;
  private mainWindow: BrowserWindow | null = null;
  private pairingCode: string | null = null;
  private connectedDevices: Map<string, { name: string; lastSeen: number }> = new Map();

  constructor(config: Partial<MobileAPIConfig> = {}) {
    this.config = {
      enabled: false,
      port: 3847,
      useHttps: false,
      requireAuth: true,
      allowedOrigins: ['*'],
      maxRequestsPerMinute: 60,
      ...config,
    };

    this.rateLimiter = new RateLimiter(this.config.maxRequestsPerMinute);
    this.registerRoutes();
  }

  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
  }

  // ============================================================================
  // Route Registration
  // ============================================================================

  private registerRoutes(): void {
    // Status & Info
    this.addRoute('GET', /^\/api\/status$/, this.handleStatus.bind(this), false);
    this.addRoute('GET', /^\/api\/info$/, this.handleInfo.bind(this), true);
    
    // Authentication
    this.addRoute('POST', /^\/api\/auth\/pair$/, this.handlePair.bind(this), false);
    this.addRoute('POST', /^\/api\/auth\/verify$/, this.handleVerify.bind(this), false);
    
    // Voice Control
    this.addRoute('POST', /^\/api\/voice\/start$/, this.handleVoiceStart.bind(this), true);
    this.addRoute('POST', /^\/api\/voice\/stop$/, this.handleVoiceStop.bind(this), true);
    this.addRoute('POST', /^\/api\/voice\/text$/, this.handleVoiceText.bind(this), true);
    this.addRoute('GET', /^\/api\/voice\/state$/, this.handleVoiceState.bind(this), true);
    
    // Media Control
    this.addRoute('POST', /^\/api\/media\/play$/, this.handleMediaPlay.bind(this), true);
    this.addRoute('POST', /^\/api\/media\/pause$/, this.handleMediaPause.bind(this), true);
    this.addRoute('POST', /^\/api\/media\/next$/, this.handleMediaNext.bind(this), true);
    this.addRoute('POST', /^\/api\/media\/previous$/, this.handleMediaPrevious.bind(this), true);
    this.addRoute('POST', /^\/api\/media\/volume$/, this.handleMediaVolume.bind(this), true);
    this.addRoute('GET', /^\/api\/media\/current$/, this.handleMediaCurrent.bind(this), true);
    
    // System Control
    this.addRoute('GET', /^\/api\/system\/stats$/, this.handleSystemStats.bind(this), true);
    this.addRoute('POST', /^\/api\/system\/screenshot$/, this.handleScreenshot.bind(this), true);
    this.addRoute('POST', /^\/api\/system\/command$/, this.handleCommand.bind(this), true);
    
    // Notifications
    this.addRoute('GET', /^\/api\/notifications$/, this.handleGetNotifications.bind(this), true);
    this.addRoute('POST', /^\/api\/notifications\/dismiss$/, this.handleDismissNotification.bind(this), true);
  }

  private addRoute(method: string, path: RegExp, handler: RouteHandler, requireAuth: boolean): void {
    this.routes.push({ method, path, handler, requireAuth });
  }

  // ============================================================================
  // Server Management
  // ============================================================================

  async start(): Promise<{ port: number; pairingCode: string }> {
    if (this.server) {
      await this.stop();
    }

    // Generate new auth token if none exists
    if (!this.config.authToken) {
      this.config.authToken = crypto.randomBytes(32).toString('hex');
    }

    // Generate pairing code
    this.pairingCode = this.generatePairingCode();

    return new Promise((resolve, reject) => {
      const requestHandler = this.handleRequest.bind(this);

      if (this.config.useHttps) {
        // For HTTPS, you'd need to provide certificates
        // For now, fall back to HTTP with warning
        logger.warn('HTTPS not configured, falling back to HTTP');
      }

      this.server = http.createServer(requestHandler);

      this.server.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          logger.error(`Port ${this.config.port} is already in use`);
          reject(new Error(`Port ${this.config.port} is already in use`));
        } else {
          logger.error('Server error:', { code: err.code, message: err.message });
          reject(err);
        }
      });

      this.server.listen(this.config.port, '0.0.0.0', () => {
        logger.info(`Mobile API server started on port ${this.config.port}`);
        this.config.enabled = true;
        resolve({ port: this.config.port, pairingCode: this.pairingCode! });
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.server = null;
          this.config.enabled = false;
          logger.info('Mobile API server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  isRunning(): boolean {
    return this.server !== null;
  }

  getConfig(): MobileAPIConfig {
    return { ...this.config };
  }

  getPairingCode(): string | null {
    return this.pairingCode;
  }

  getConnectedDevices(): Array<{ id: string; name: string; lastSeen: number }> {
    return Array.from(this.connectedDevices.entries()).map(([id, data]) => ({
      id,
      ...data,
    }));
  }

  private generatePairingCode(): string {
    // Generate a 6-digit code
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  // ============================================================================
  // Request Handler
  // ============================================================================

  private async handleRequest(
    req: http.IncomingMessage, 
    res: http.ServerResponse
  ): Promise<void> {
    // Get client IP
    const ip = req.socket.remoteAddress || 'unknown';

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', this.config.allowedOrigins.join(', '));
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    // Handle preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Rate limiting
    if (!this.rateLimiter.isAllowed(ip)) {
      this.sendResponse(res, {
        statusCode: 429,
        headers: { 'Retry-After': '60' },
        body: { error: 'Too many requests' },
      });
      return;
    }

    // Parse request
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const query: Record<string, string> = {};
    url.searchParams.forEach((value, key) => {
      query[key] = value;
    });

    // Parse body
    let body: unknown = {};
    if (req.method === 'POST' || req.method === 'PUT') {
      try {
        body = await this.parseBody(req);
      } catch {
        this.sendResponse(res, {
          statusCode: 400,
          headers: {},
          body: { error: 'Invalid request body' },
        });
        return;
      }
    }

    const apiRequest: APIRequest = {
      method: req.method || 'GET',
      path: url.pathname,
      query,
      body,
      headers: req.headers,
    };

    // Find matching route
    const route = this.routes.find(
      r => r.method === apiRequest.method && r.path.test(apiRequest.path)
    );

    if (!route) {
      this.sendResponse(res, {
        statusCode: 404,
        headers: {},
        body: { error: 'Not found' },
      });
      return;
    }

    // Check authentication
    if (route.requireAuth && this.config.requireAuth) {
      const authHeader = req.headers.authorization;
      const token = authHeader?.replace('Bearer ', '');

      if (!token || token !== this.config.authToken) {
        this.sendResponse(res, {
          statusCode: 401,
          headers: {},
          body: { error: 'Unauthorized' },
        });
        return;
      }

      // Update device last seen
      const deviceId = req.headers['x-device-id'] as string;
      if (deviceId && this.connectedDevices.has(deviceId)) {
        const device = this.connectedDevices.get(deviceId)!;
        device.lastSeen = Date.now();
      }
    }

    // Execute handler
    try {
      const response = await route.handler(apiRequest);
      this.sendResponse(res, response);
    } catch (error) {
      logger.error('Route handler error:', { error: getErrorMessage(error) });
      this.sendResponse(res, {
        statusCode: 500,
        headers: {},
        body: { error: 'Internal server error' },
      });
    }
  }

  private async parseBody(req: http.IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let data = '';
      req.on('data', chunk => { data += chunk; });
      req.on('end', () => {
        try {
          resolve(data ? JSON.parse(data) : {});
        } catch {
          reject(new Error('Invalid JSON'));
        }
      });
      req.on('error', reject);
    });
  }

  private sendResponse(res: http.ServerResponse, response: APIResponse): void {
    res.writeHead(response.statusCode, {
      'Content-Type': 'application/json',
      ...response.headers,
    });
    res.end(JSON.stringify(response.body));
  }

  // ============================================================================
  // Route Handlers
  // ============================================================================

  private handleStatus(): APIResponse {
    return {
      statusCode: 200,
      headers: {},
      body: {
        status: 'ok',
        version: app.getVersion(),
        name: 'Atlas Desktop',
      },
    };
  }

  private handleInfo(): APIResponse {
    return {
      statusCode: 200,
      headers: {},
      body: {
        version: app.getVersion(),
        platform: process.platform,
        uptime: process.uptime(),
        connectedDevices: this.connectedDevices.size,
      },
    };
  }

  private handlePair(req: APIRequest): APIResponse {
    const { code, deviceName } = req.body as { code?: string; deviceName?: string };

    if (!code || code !== this.pairingCode) {
      return {
        statusCode: 401,
        headers: {},
        body: { error: 'Invalid pairing code' },
      };
    }

    // Generate device token
    const deviceId = crypto.randomBytes(16).toString('hex');
    
    // Store device
    this.connectedDevices.set(deviceId, {
      name: deviceName || 'Unknown Device',
      lastSeen: Date.now(),
    });

    // Generate new pairing code
    this.pairingCode = this.generatePairingCode();

    return {
      statusCode: 200,
      headers: {},
      body: {
        success: true,
        deviceId,
        authToken: this.config.authToken,
      },
    };
  }

  private handleVerify(req: APIRequest): APIResponse {
    const authHeader = req.headers.authorization;
    const token = authHeader?.replace('Bearer ', '');

    return {
      statusCode: 200,
      headers: {},
      body: {
        valid: token === this.config.authToken,
      },
    };
  }

  private async handleVoiceStart(): Promise<APIResponse> {
    try {
      await this.sendToMain('voice:start');
      return { statusCode: 200, headers: {}, body: { success: true } };
    } catch (error) {
      return { statusCode: 500, headers: {}, body: { error: 'Failed to start voice' } };
    }
  }

  private async handleVoiceStop(): Promise<APIResponse> {
    try {
      await this.sendToMain('voice:stop');
      return { statusCode: 200, headers: {}, body: { success: true } };
    } catch (error) {
      return { statusCode: 500, headers: {}, body: { error: 'Failed to stop voice' } };
    }
  }

  private async handleVoiceText(req: APIRequest): Promise<APIResponse> {
    const { text } = req.body as { text?: string };
    
    if (!text) {
      return { statusCode: 400, headers: {}, body: { error: 'Text required' } };
    }

    try {
      await this.sendToMain('voice:send-text', text);
      return { statusCode: 200, headers: {}, body: { success: true } };
    } catch (error) {
      return { statusCode: 500, headers: {}, body: { error: 'Failed to send text' } };
    }
  }

  private async handleVoiceState(): Promise<APIResponse> {
    try {
      const state = await this.sendToMain('voice:get-state');
      return { statusCode: 200, headers: {}, body: state };
    } catch (error) {
      return { statusCode: 500, headers: {}, body: { error: 'Failed to get state' } };
    }
  }

  private async handleMediaPlay(): Promise<APIResponse> {
    try {
      await this.sendToMain('media:play');
      return { statusCode: 200, headers: {}, body: { success: true } };
    } catch (error) {
      return { statusCode: 500, headers: {}, body: { error: 'Failed to play' } };
    }
  }

  private async handleMediaPause(): Promise<APIResponse> {
    try {
      await this.sendToMain('media:pause');
      return { statusCode: 200, headers: {}, body: { success: true } };
    } catch (error) {
      return { statusCode: 500, headers: {}, body: { error: 'Failed to pause' } };
    }
  }

  private async handleMediaNext(): Promise<APIResponse> {
    try {
      await this.sendToMain('media:next');
      return { statusCode: 200, headers: {}, body: { success: true } };
    } catch (error) {
      return { statusCode: 500, headers: {}, body: { error: 'Failed to skip' } };
    }
  }

  private async handleMediaPrevious(): Promise<APIResponse> {
    try {
      await this.sendToMain('media:previous');
      return { statusCode: 200, headers: {}, body: { success: true } };
    } catch (error) {
      return { statusCode: 500, headers: {}, body: { error: 'Failed to go back' } };
    }
  }

  private async handleMediaVolume(req: APIRequest): Promise<APIResponse> {
    const { volume } = req.body as { volume?: number };
    
    if (typeof volume !== 'number' || volume < 0 || volume > 100) {
      return { statusCode: 400, headers: {}, body: { error: 'Invalid volume' } };
    }

    try {
      await this.sendToMain('media:set-volume', volume);
      return { statusCode: 200, headers: {}, body: { success: true } };
    } catch (error) {
      return { statusCode: 500, headers: {}, body: { error: 'Failed to set volume' } };
    }
  }

  private async handleMediaCurrent(): Promise<APIResponse> {
    try {
      const current = await this.sendToMain('media:get-current');
      return { statusCode: 200, headers: {}, body: current };
    } catch (error) {
      return { statusCode: 500, headers: {}, body: { error: 'Failed to get current' } };
    }
  }

  private async handleSystemStats(): Promise<APIResponse> {
    try {
      const stats = await this.sendToMain('system:get-stats');
      return { statusCode: 200, headers: {}, body: stats };
    } catch (error) {
      return { statusCode: 500, headers: {}, body: { error: 'Failed to get stats' } };
    }
  }

  private async handleScreenshot(): Promise<APIResponse> {
    try {
      const screenshot = await this.sendToMain('system:screenshot');
      return { statusCode: 200, headers: {}, body: screenshot };
    } catch (error) {
      return { statusCode: 500, headers: {}, body: { error: 'Failed to take screenshot' } };
    }
  }

  private async handleCommand(req: APIRequest): Promise<APIResponse> {
    const { command, params } = req.body as { command?: string; params?: unknown };
    
    if (!command) {
      return { statusCode: 400, headers: {}, body: { error: 'Command required' } };
    }

    try {
      const result = await this.sendToMain('execute-command', { command, params });
      return { statusCode: 200, headers: {}, body: result };
    } catch (error) {
      return { statusCode: 500, headers: {}, body: { error: 'Failed to execute command' } };
    }
  }

  private async handleGetNotifications(): Promise<APIResponse> {
    try {
      const notifications = await this.sendToMain('notifications:get-all');
      return { statusCode: 200, headers: {}, body: notifications };
    } catch (error) {
      return { statusCode: 500, headers: {}, body: { error: 'Failed to get notifications' } };
    }
  }

  private async handleDismissNotification(req: APIRequest): Promise<APIResponse> {
    const { id } = req.body as { id?: string };
    
    if (!id) {
      return { statusCode: 400, headers: {}, body: { error: 'Notification ID required' } };
    }

    try {
      await this.sendToMain('notifications:dismiss', id);
      return { statusCode: 200, headers: {}, body: { success: true } };
    } catch (error) {
      return { statusCode: 500, headers: {}, body: { error: 'Failed to dismiss notification' } };
    }
  }

  // ============================================================================
  // IPC Communication
  // ============================================================================

  private sendToMain(channel: string, ...args: unknown[]): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.mainWindow) {
        reject(new Error('Main window not available'));
        return;
      }

      const responseChannel = `${channel}:response:${Date.now()}`;
      
      const timeout = setTimeout(() => {
        ipcMain.removeHandler(responseChannel);
        reject(new Error('IPC timeout'));
      }, 10000);

      ipcMain.handleOnce(responseChannel, (_, result) => {
        clearTimeout(timeout);
        resolve(result);
      });

      this.mainWindow.webContents.send(channel, ...args, responseChannel);
    });
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let mobileAPIInstance: MobileAPIServer | null = null;

export function getMobileAPI(): MobileAPIServer {
  if (!mobileAPIInstance) {
    mobileAPIInstance = new MobileAPIServer();
  }
  return mobileAPIInstance;
}

export function initMobileAPI(mainWindow: BrowserWindow): MobileAPIServer {
  const api = getMobileAPI();
  api.setMainWindow(mainWindow);
  return api;
}

export default MobileAPIServer;
