/**
 * @fileoverview HTTP Server for Gateway Web UI
 * @module gateway/http-server
 * @author Atlas Team
 * @since 1.0.0
 *
 * @description
 * Provides HTTP endpoints for the Gateway Web UI, including:
 * - Static file serving for the React dashboard
 * - REST API endpoints for non-WebSocket operations
 * - Health and status endpoints
 * - CORS support for development
 *
 * The HTTP server runs on the same port as the WebSocket server,
 * handling HTTP requests before upgrading to WebSocket for the
 * control plane connection.
 *
 * @example
 * ```typescript
 * import { addHttpRoutes } from './http-server';
 *
 * // Add HTTP routes to existing HTTP server
 * addHttpRoutes(server, gateway);
 * ```
 */

import { IncomingMessage, ServerResponse, Server } from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { createModuleLogger } from '../utils/logger';
import { Gateway } from './index';
import { app } from 'electron';

const logger = createModuleLogger('HTTPServer');

// =============================================================================
// Types
// =============================================================================

/**
 * HTTP route handler
 */
type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  gateway: Gateway
) => Promise<void> | void;

/**
 * Route definition
 */
interface Route {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  pattern: RegExp | string;
  handler: RouteHandler;
}

// =============================================================================
// MIME Types
// =============================================================================

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
};

// =============================================================================
// Routes
// =============================================================================

const routes: Route[] = [];

/**
 * Register an API route
 */
function registerRoute(
  method: Route['method'],
  pattern: string | RegExp,
  handler: RouteHandler
): void {
  routes.push({ method, pattern, handler });
}

// Health check
registerRoute('GET', '/health', (req, res, gateway) => {
  const health = gateway.getHealth();
  sendJSON(res, 200, health);
});

// Gateway status
registerRoute('GET', '/api/status', (req, res, gateway) => {
  sendJSON(res, 200, {
    running: gateway.isRunning,
    config: gateway.config,
    health: gateway.getHealth(),
  });
});

// List clients
registerRoute('GET', '/api/clients', (req, res, gateway) => {
  const clients = gateway.getClients().map((c) => ({
    id: c.id,
    role: c.role,
    name: c.name,
    platform: c.platform,
    connectedAt: c.connectedAt,
    pairingStatus: c.pairingStatus,
  }));
  sendJSON(res, 200, { clients });
});

// List nodes
registerRoute('GET', '/api/nodes', (req, res, gateway) => {
  const nodes = gateway.getNodes().map((n) => ({
    id: n.id,
    name: n.name,
    platform: n.platform,
    capabilities: n.capabilities,
    pairingStatus: n.pairingStatus,
  }));
  sendJSON(res, 200, { nodes });
});

// =============================================================================
// HTTP Server Integration
// =============================================================================

/**
 * Add HTTP routes to the Gateway's HTTP server
 *
 * @param server - HTTP server instance
 * @param gateway - Gateway instance
 * @param webUIPath - Path to static web UI files
 */
export function addHttpRoutes(
  server: Server,
  gateway: Gateway,
  webUIPath?: string
): void {
  // Determine web UI path
  const staticPath =
    webUIPath ||
    (app?.isPackaged
      ? path.join(process.resourcesPath, 'web-ui')
      : path.join(__dirname, '../../../web-ui/dist'));

  // Store original request handler
  const originalHandler = server.listeners('request')[0] as
    | ((req: IncomingMessage, res: ServerResponse) => void)
    | undefined;

  // Remove original handler
  if (originalHandler) {
    server.removeListener('request', originalHandler);
  }

  // Add new request handler
  server.on('request', async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const pathname = url.pathname;
    const method = req.method || 'GET';

    // Add CORS headers for development
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    // Handle preflight requests
    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Try API routes first
    for (const route of routes) {
      if (route.method !== method) continue;

      let matches = false;
      if (typeof route.pattern === 'string') {
        matches = pathname === route.pattern;
      } else {
        matches = route.pattern.test(pathname);
      }

      if (matches) {
        try {
          await route.handler(req, res, gateway);
          return;
        } catch (error) {
          logger.error('Route handler error', { path: pathname, error });
          sendJSON(res, 500, { error: 'Internal server error' });
          return;
        }
      }
    }

    // Serve static files for Web UI
    if (method === 'GET') {
      // Check if web UI exists
      if (fs.existsSync(staticPath)) {
        const filePath = pathname === '/' ? '/index.html' : pathname;
        const fullPath = path.join(staticPath, filePath);

        // Security: prevent path traversal
        if (!fullPath.startsWith(staticPath)) {
          sendJSON(res, 403, { error: 'Forbidden' });
          return;
        }

        try {
          // Check if file exists
          if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
            const ext = path.extname(fullPath);
            const mimeType = MIME_TYPES[ext] || 'application/octet-stream';

            res.writeHead(200, { 'Content-Type': mimeType });
            fs.createReadStream(fullPath).pipe(res);
            return;
          }

          // For SPA routing, serve index.html for unknown paths
          const indexPath = path.join(staticPath, 'index.html');
          if (fs.existsSync(indexPath)) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            fs.createReadStream(indexPath).pipe(res);
            return;
          }
        } catch (error) {
          logger.error('Static file error', { path: pathname, error });
        }
      }
    }

    // Fall back to original handler or 404
    if (originalHandler) {
      originalHandler(req, res);
    } else {
      // Default response for root
      if (pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
<!DOCTYPE html>
<html>
<head>
  <title>Atlas Gateway</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0a0a0a;
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
    }
    .container {
      text-align: center;
      padding: 2rem;
    }
    h1 { color: #ef4444; margin-bottom: 1rem; }
    p { color: #888; margin: 0.5rem 0; }
    .status { color: #22c55e; }
    code {
      background: #1f1f1f;
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
      font-size: 0.9em;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Atlas Gateway</h1>
    <p class="status">● Running</p>
    <p>WebSocket: <code>ws://localhost:${gateway.config.port}</code></p>
    <p>Health: <code>/health</code></p>
    <p>API: <code>/api/*</code></p>
  </div>
</body>
</html>
        `);
        return;
      }

      sendJSON(res, 404, { error: 'Not found' });
    }
  });

  logger.info('HTTP routes added to gateway');
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Send JSON response
 */
function sendJSON(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

/**
 * Parse JSON body from request
 */
export async function parseJSONBody<T = unknown>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk.toString();
    });

    req.on('end', () => {
      try {
        resolve(JSON.parse(body) as T);
      } catch (error) {
        reject(new Error('Invalid JSON body'));
      }
    });

    req.on('error', reject);
  });
}

/**
 * Get query parameters from URL
 */
export function getQueryParams(req: IncomingMessage): URLSearchParams {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  return url.searchParams;
}

export default addHttpRoutes;
