/**
 * Atlas Desktop - Spotify OAuth Authentication Handler
 *
 * Handles the OAuth 2.0 PKCE flow for Spotify authentication.
 * Uses system browser for authorization and local HTTP server for callback.
 *
 * @module integrations/spotify-auth
 */

import { shell } from 'electron';
import { createServer, IncomingMessage, ServerResponse, Server } from 'http';
import { URL } from 'url';
import { randomBytes, createHash } from 'crypto';
import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('SpotifyAuth');

// ============================================================================
// Types
// ============================================================================

export interface SpotifyTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope: string;
  tokenType: string;
}

export interface SpotifyAuthConfig {
  clientId: string;
  clientSecret?: string;
  redirectPort?: number;
  scopes?: string[];
}

export interface SpotifyAuthState {
  isAuthenticated: boolean;
  expiresAt: number | null;
  scope: string | null;
}

// ============================================================================
// Constants
// ============================================================================

const SPOTIFY_AUTH_URL = 'https://accounts.spotify.com/authorize';
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
const DEFAULT_REDIRECT_PORT = 8888;

/**
 * Default scopes for Atlas Spotify integration
 * These cover playback control, library access, and current playback info
 */
const DEFAULT_SCOPES = [
  // Playback control
  'user-modify-playback-state',
  'user-read-playback-state',
  'user-read-currently-playing',
  // Library access
  'user-library-read',
  'user-library-modify',
  // Playlist access
  'playlist-read-private',
  'playlist-read-collaborative',
  'playlist-modify-public',
  'playlist-modify-private',
  // User info
  'user-read-private',
  'user-read-email',
  // Streaming (for SDK if needed)
  'streaming',
  // Top and recently played
  'user-top-read',
  'user-read-recently-played',
];

// ============================================================================
// PKCE Helpers
// ============================================================================

/**
 * Generate a cryptographically random code verifier for PKCE
 */
function generateCodeVerifier(): string {
  return randomBytes(32)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/**
 * Generate code challenge from verifier using SHA256
 */
function generateCodeChallenge(verifier: string): string {
  const hash = createHash('sha256').update(verifier).digest();
  return hash.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Generate a random state for CSRF protection
 */
function generateState(): string {
  return randomBytes(16).toString('hex');
}

// ============================================================================
// SpotifyAuthManager Class
// ============================================================================

/**
 * Spotify OAuth Authentication Manager
 *
 * Handles the complete OAuth 2.0 PKCE flow for Spotify:
 * 1. Generates PKCE verifier/challenge
 * 2. Opens authorization URL in browser
 * 3. Runs local callback server
 * 4. Exchanges code for tokens
 * 5. Handles token refresh
 *
 * @example
 * ```typescript
 * const auth = new SpotifyAuthManager({
 *   clientId: 'your-spotify-client-id'
 * });
 *
 * auth.on('authenticated', (tokens) => {
 *   console.log('Access token:', tokens.accessToken);
 * });
 *
 * await auth.authenticate();
 * ```
 */
export class SpotifyAuthManager extends EventEmitter {
  private config: Required<SpotifyAuthConfig>;
  private tokens: SpotifyTokens | null = null;
  private callbackServer: Server | null = null;
  private codeVerifier: string | null = null;
  private authState: string | null = null;
  private isAuthenticating = false;
  private refreshTimer: NodeJS.Timeout | null = null;

  constructor(config: SpotifyAuthConfig) {
    super();
    this.config = {
      clientId: config.clientId,
      clientSecret: config.clientSecret || '',
      redirectPort: config.redirectPort || DEFAULT_REDIRECT_PORT,
      scopes: config.scopes || DEFAULT_SCOPES,
    };
  }

  /**
   * Get the redirect URI for OAuth callback
   */
  private get redirectUri(): string {
    return `http://localhost:${this.config.redirectPort}/callback`;
  }

  /**
   * Check if user is currently authenticated with valid tokens
   */
  isAuthenticated(): boolean {
    if (!this.tokens) return false;
    // Consider token valid if it expires in more than 60 seconds
    return Date.now() < this.tokens.expiresAt - 60000;
  }

  /**
   * Get current authentication state
   */
  getAuthState(): SpotifyAuthState {
    return {
      isAuthenticated: this.isAuthenticated(),
      expiresAt: this.tokens?.expiresAt || null,
      scope: this.tokens?.scope || null,
    };
  }

  /**
   * Get current access token (refreshes if needed)
   */
  async getAccessToken(): Promise<string | null> {
    if (!this.tokens) return null;

    // Refresh if token expires in less than 5 minutes
    if (Date.now() > this.tokens.expiresAt - 300000) {
      try {
        await this.refreshAccessToken();
      } catch (error) {
        logger.error('Failed to refresh token', { error });
        return null;
      }
    }

    return this.tokens.accessToken;
  }

  /**
   * Get stored tokens (for persistence)
   */
  getTokens(): SpotifyTokens | null {
    return this.tokens;
  }

  /**
   * Set tokens from storage (for restoring session)
   */
  setTokens(tokens: SpotifyTokens): void {
    this.tokens = tokens;
    this.scheduleRefresh();
    logger.info('Tokens restored from storage');
    this.emit('authenticated', tokens);
  }

  /**
   * Start the OAuth authentication flow
   * Opens Spotify authorization page in default browser
   */
  async authenticate(): Promise<SpotifyTokens> {
    if (this.isAuthenticating) {
      throw new Error('Authentication already in progress');
    }

    this.isAuthenticating = true;
    logger.info('Starting Spotify authentication flow');

    try {
      // Generate PKCE values
      this.codeVerifier = generateCodeVerifier();
      const codeChallenge = generateCodeChallenge(this.codeVerifier);
      this.authState = generateState();

      // Build authorization URL
      const authUrl = new URL(SPOTIFY_AUTH_URL);
      authUrl.searchParams.set('client_id', this.config.clientId);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('redirect_uri', this.redirectUri);
      authUrl.searchParams.set('code_challenge_method', 'S256');
      authUrl.searchParams.set('code_challenge', codeChallenge);
      authUrl.searchParams.set('state', this.authState);
      authUrl.searchParams.set('scope', this.config.scopes.join(' '));

      // Start callback server and wait for authorization code
      const code = await this.waitForAuthorizationCode();

      // Exchange code for tokens
      const tokens = await this.exchangeCodeForTokens(code);

      this.tokens = tokens;
      this.scheduleRefresh();

      logger.info('Spotify authentication successful');
      this.emit('authenticated', tokens);

      return tokens;
    } catch (error) {
      logger.error('Spotify authentication failed', { error });
      this.emit('error', error);
      throw error;
    } finally {
      this.isAuthenticating = false;
      this.codeVerifier = null;
      this.authState = null;
    }
  }

  /**
   * Start callback server and wait for authorization code
   */
  private waitForAuthorizationCode(): Promise<string> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.stopCallbackServer();
        reject(new Error('Authentication timeout - no callback received'));
      }, 300000); // 5 minute timeout

      this.callbackServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
        if (!req.url) {
          res.writeHead(400);
          res.end('Bad Request');
          return;
        }

        const url = new URL(req.url, `http://localhost:${this.config.redirectPort}`);

        if (url.pathname !== '/callback') {
          res.writeHead(404);
          res.end('Not Found');
          return;
        }

        const error = url.searchParams.get('error');
        if (error) {
          clearTimeout(timeout);
          this.stopCallbackServer();

          const errorDescription = url.searchParams.get('error_description') || 'Unknown error';
          res.writeHead(400);
          res.end(`
              <!DOCTYPE html>
              <html>
              <head><title>Authentication Failed</title></head>
              <body>
                <h1>Authentication Failed</h1>
                <p>${errorDescription}</p>
                <p>You can close this window.</p>
              </body>
              </html>
            `);

          reject(new Error(`Spotify auth error: ${error} - ${errorDescription}`));
          return;
        }

        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');

        if (!code) {
          res.writeHead(400);
          res.end('Missing authorization code');
          return;
        }

        if (state !== this.authState) {
          clearTimeout(timeout);
          this.stopCallbackServer();
          res.writeHead(400);
          res.end('Invalid state - possible CSRF attack');
          reject(new Error('Invalid state parameter'));
          return;
        }

        clearTimeout(timeout);
        this.stopCallbackServer();

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
            <!DOCTYPE html>
            <html>
            <head>
              <title>Atlas - Spotify Connected</title>
              <style>
                body {
                  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                  display: flex;
                  justify-content: center;
                  align-items: center;
                  height: 100vh;
                  margin: 0;
                  background: linear-gradient(135deg, #1DB954 0%, #191414 100%);
                  color: white;
                }
                .container {
                  text-align: center;
                  padding: 40px;
                  background: rgba(0, 0, 0, 0.5);
                  border-radius: 16px;
                }
                h1 { margin-bottom: 16px; }
                p { opacity: 0.8; }
              </style>
            </head>
            <body>
              <div class="container">
                <h1>Spotify Connected!</h1>
                <p>Atlas can now control your Spotify playback.</p>
                <p>You can close this window.</p>
              </div>
            </body>
            </html>
          `);

        resolve(code);
      });

      this.callbackServer.listen(this.config.redirectPort, () => {
        logger.debug('Callback server listening', { port: this.config.redirectPort });

        // Build and open authorization URL
        const authUrl = new URL(SPOTIFY_AUTH_URL);
        authUrl.searchParams.set('client_id', this.config.clientId);
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('redirect_uri', this.redirectUri);
        authUrl.searchParams.set('code_challenge_method', 'S256');
        authUrl.searchParams.set('code_challenge', generateCodeChallenge(this.codeVerifier!));
        authUrl.searchParams.set('state', this.authState!);
        authUrl.searchParams.set('scope', this.config.scopes.join(' '));

        // Open in default browser
        shell.openExternal(authUrl.toString());
        logger.info('Opened Spotify authorization page in browser');
      });

      this.callbackServer.on('error', (error) => {
        clearTimeout(timeout);
        this.stopCallbackServer();
        reject(new Error(`Callback server error: ${error.message}`));
      });
    });
  }

  /**
   * Exchange authorization code for access and refresh tokens
   */
  private async exchangeCodeForTokens(code: string): Promise<SpotifyTokens> {
    const params = new URLSearchParams();
    params.set('grant_type', 'authorization_code');
    params.set('code', code);
    params.set('redirect_uri', this.redirectUri);
    params.set('client_id', this.config.clientId);
    params.set('code_verifier', this.codeVerifier!);

    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
    };

    // Add client secret if available (for confidential clients)
    if (this.config.clientSecret) {
      const credentials = Buffer.from(
        `${this.config.clientId}:${this.config.clientSecret}`
      ).toString('base64');
      headers['Authorization'] = `Basic ${credentials}`;
    }

    const response = await fetch(SPOTIFY_TOKEN_URL, {
      method: 'POST',
      headers,
      body: params.toString(),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error('Token exchange failed', {
        status: response.status,
        body: errorBody,
      });
      throw new Error(`Token exchange failed: ${response.status}`);
    }

    const data = await response.json();

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000,
      scope: data.scope,
      tokenType: data.token_type,
    };
  }

  /**
   * Refresh the access token using the refresh token
   */
  async refreshAccessToken(): Promise<void> {
    if (!this.tokens?.refreshToken) {
      throw new Error('No refresh token available');
    }

    logger.debug('Refreshing Spotify access token');

    const params = new URLSearchParams();
    params.set('grant_type', 'refresh_token');
    params.set('refresh_token', this.tokens.refreshToken);
    params.set('client_id', this.config.clientId);

    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
    };

    if (this.config.clientSecret) {
      const credentials = Buffer.from(
        `${this.config.clientId}:${this.config.clientSecret}`
      ).toString('base64');
      headers['Authorization'] = `Basic ${credentials}`;
    }

    const response = await fetch(SPOTIFY_TOKEN_URL, {
      method: 'POST',
      headers,
      body: params.toString(),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error('Token refresh failed', {
        status: response.status,
        body: errorBody,
      });

      // If refresh fails, clear tokens and emit event
      this.tokens = null;
      this.emit('token-expired');
      throw new Error(`Token refresh failed: ${response.status}`);
    }

    const data = await response.json();

    this.tokens = {
      accessToken: data.access_token,
      // Spotify may return a new refresh token
      refreshToken: data.refresh_token || this.tokens.refreshToken,
      expiresAt: Date.now() + data.expires_in * 1000,
      scope: data.scope || this.tokens.scope,
      tokenType: data.token_type,
    };

    this.scheduleRefresh();
    logger.info('Spotify access token refreshed');
    this.emit('token-refreshed', this.tokens);
  }

  /**
   * Schedule automatic token refresh before expiration
   */
  private scheduleRefresh(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }

    if (!this.tokens) return;

    // Refresh 5 minutes before expiration
    const refreshIn = Math.max(0, this.tokens.expiresAt - Date.now() - 300000);

    this.refreshTimer = setTimeout(async () => {
      try {
        await this.refreshAccessToken();
      } catch (error) {
        logger.error('Scheduled token refresh failed', { error });
      }
    }, refreshIn);

    logger.debug('Token refresh scheduled', {
      refreshInMs: refreshIn,
      refreshAt: new Date(Date.now() + refreshIn).toISOString(),
    });
  }

  /**
   * Stop the callback server if running
   */
  private stopCallbackServer(): void {
    if (this.callbackServer) {
      this.callbackServer.close();
      this.callbackServer = null;
      logger.debug('Callback server stopped');
    }
  }

  /**
   * Logout and clear tokens
   */
  logout(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }

    this.tokens = null;
    this.stopCallbackServer();

    logger.info('Spotify logged out');
    this.emit('logged-out');
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.logout();
    this.removeAllListeners();
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let authManager: SpotifyAuthManager | null = null;

/**
 * Get or create the Spotify auth manager singleton
 *
 * @param config - Configuration (required on first call)
 * @returns SpotifyAuthManager instance
 */
export function getSpotifyAuthManager(config?: SpotifyAuthConfig): SpotifyAuthManager {
  if (!authManager) {
    if (!config) {
      throw new Error('SpotifyAuthManager not initialized. Provide config on first call.');
    }
    authManager = new SpotifyAuthManager(config);
  }
  return authManager;
}

/**
 * Shutdown the Spotify auth manager
 */
export function shutdownSpotifyAuth(): void {
  if (authManager) {
    authManager.destroy();
    authManager = null;
    logger.info('Spotify auth manager shutdown');
  }
}

export default {
  SpotifyAuthManager,
  getSpotifyAuthManager,
  shutdownSpotifyAuth,
};
