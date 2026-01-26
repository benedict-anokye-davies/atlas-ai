/**
 * Atlas Desktop - OAuth Manager
 * Handles OAuth 2.0 authentication for Google Calendar and Microsoft Outlook
 */

import { EventEmitter } from 'events';
import * as crypto from 'crypto';
import * as http from 'http';
import * as url from 'url';
import { BrowserWindow, session } from 'electron';
import { createModuleLogger } from '../utils/logger';
import type {
  CalendarProvider,
  OAuthTokens,
  OAuthConfig,
  CalendarAccount,
} from '../../shared/types/calendar';

const logger = createModuleLogger('OAuthManager');

/**
 * Google OAuth configuration
 */
const GOOGLE_OAUTH_CONFIG: OAuthConfig = {
  clientId: process.env.GOOGLE_CALENDAR_CLIENT_ID || '',
  clientSecret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET || '',
  redirectUri: 'http://localhost:3847/oauth/callback',
  scopes: [
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
  ],
};

/**
 * Microsoft OAuth configuration
 */
const MICROSOFT_OAUTH_CONFIG: OAuthConfig = {
  clientId: process.env.MICROSOFT_CALENDAR_CLIENT_ID || '',
  clientSecret: process.env.MICROSOFT_CALENDAR_CLIENT_SECRET || '',
  redirectUri: 'http://localhost:3847/oauth/callback',
  scopes: ['offline_access', 'User.Read', 'Calendars.ReadWrite', 'Calendars.Read.Shared'],
};

/**
 * Token storage interface
 */
interface TokenStorage {
  get(accountId: string): Promise<OAuthTokens | null>;
  set(accountId: string, tokens: OAuthTokens): Promise<void>;
  delete(accountId: string): Promise<void>;
  getAll(): Promise<Map<string, OAuthTokens>>;
}

/**
 * In-memory token storage (for development - should use keychain in production)
 */
class InMemoryTokenStorage implements TokenStorage {
  private tokens = new Map<string, OAuthTokens>();

  async get(accountId: string): Promise<OAuthTokens | null> {
    return this.tokens.get(accountId) || null;
  }

  async set(accountId: string, tokens: OAuthTokens): Promise<void> {
    this.tokens.set(accountId, tokens);
  }

  async delete(accountId: string): Promise<void> {
    this.tokens.delete(accountId);
  }

  async getAll(): Promise<Map<string, OAuthTokens>> {
    return new Map(this.tokens);
  }
}

/**
 * OAuth Manager for handling authentication flows
 */
export class OAuthManager extends EventEmitter {
  private static instance: OAuthManager | null = null;
  private tokenStorage: TokenStorage;
  private authWindow: BrowserWindow | null = null;
  private httpServer: ReturnType<typeof import('http').createServer> | null = null;

  private constructor() {
    super();
    this.tokenStorage = new InMemoryTokenStorage();
    logger.info('OAuth Manager initialized');
  }

  /**
   * Get singleton instance
   */
  static getInstance(): OAuthManager {
    if (!OAuthManager.instance) {
      OAuthManager.instance = new OAuthManager();
    }
    return OAuthManager.instance;
  }

  /**
   * Start OAuth flow for a provider
   */
  async startAuthFlow(provider: CalendarProvider): Promise<CalendarAccount> {
    logger.info('Starting OAuth flow', { provider });

    const config = provider === 'google' ? GOOGLE_OAUTH_CONFIG : MICROSOFT_OAUTH_CONFIG;

    if (!config.clientId || !config.clientSecret) {
      throw new Error(
        `Missing OAuth credentials for ${provider}. Please configure environment variables.`
      );
    }

    // Generate authorization URL
    const authUrl = this.buildAuthUrl(provider, config);

    // Start local callback server
    const authCode = await this.waitForAuthCode(authUrl);

    // Exchange code for tokens
    const tokens = await this.exchangeCodeForTokens(provider, config, authCode);

    // Get user info
    const userInfo = await this.getUserInfo(provider, tokens.accessToken);

    // Create account
    const account: CalendarAccount = {
      id: `${provider}_${userInfo.id}`,
      provider,
      email: userInfo.email,
      displayName: userInfo.name,
      isDefault: false,
      tokens,
      createdAt: Date.now(),
      lastSyncAt: null,
    };

    // Store tokens
    await this.tokenStorage.set(account.id, tokens);

    logger.info('OAuth flow completed', {
      provider,
      email: account.email,
      accountId: account.id,
    });

    this.emit('account-added', account);
    return account;
  }

  /**
   * Build OAuth authorization URL
   */
  private buildAuthUrl(provider: CalendarProvider, config: OAuthConfig): string {
    const state = this.generateState();
    const params = new URLSearchParams();

    if (provider === 'google') {
      params.set('client_id', config.clientId);
      params.set('redirect_uri', config.redirectUri);
      params.set('response_type', 'code');
      params.set('scope', config.scopes.join(' '));
      params.set('access_type', 'offline');
      params.set('prompt', 'consent');
      params.set('state', state);
      return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    } else {
      const tenantId = process.env.MICROSOFT_TENANT_ID || 'common';
      params.set('client_id', config.clientId);
      params.set('redirect_uri', config.redirectUri);
      params.set('response_type', 'code');
      params.set('scope', config.scopes.join(' '));
      params.set('response_mode', 'query');
      params.set('state', state);
      return `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?${params.toString()}`;
    }
  }

  /**
   * Wait for OAuth callback with authorization code
   */
  private async waitForAuthCode(authUrl: string): Promise<string> {
    return new Promise((resolve, reject) => {
      // Create local server to receive callback
      this.httpServer = http.createServer(
        (
          req: { url?: string },
          res: {
            writeHead: (statusCode: number, headers: Record<string, string>) => void;
            end: (body: string) => void;
          }
        ) => {
          const parsedUrl = url.parse(req.url || '', true);

          if (parsedUrl.pathname === '/oauth/callback') {
            const code = parsedUrl.query.code as string;
            const error = parsedUrl.query.error as string;

            if (error) {
              res.writeHead(400, { 'Content-Type': 'text/html' });
              res.end(
                '<html><body><h1>Authentication Failed</h1><p>You can close this window.</p></body></html>'
              );
              reject(new Error(`OAuth error: ${error}`));
            } else if (code) {
              res.writeHead(200, { 'Content-Type': 'text/html' });
              res.end(
                '<html><body><h1>Authentication Successful</h1><p>You can close this window and return to Atlas.</p></body></html>'
              );
              resolve(code);
            }

            // Cleanup
            this.cleanup();
          }
        }
      );

      this.httpServer.listen(3847, '127.0.0.1', () => {
        logger.debug('OAuth callback server started on port 3847');
      });

      // Open auth window
      this.authWindow = new BrowserWindow({
        width: 600,
        height: 800,
        show: true,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          partition: 'persist:oauth',
        },
      });

      this.authWindow.loadURL(authUrl);

      this.authWindow.on('closed', () => {
        this.authWindow = null;
        // If window closed without completing, reject
        if (this.httpServer) {
          this.cleanup();
          reject(new Error('OAuth flow cancelled by user'));
        }
      });

      // Timeout after 5 minutes
      setTimeout(
        () => {
          this.cleanup();
          reject(new Error('OAuth flow timed out'));
        },
        5 * 60 * 1000
      );
    });
  }

  /**
   * Exchange authorization code for tokens
   */
  private async exchangeCodeForTokens(
    provider: CalendarProvider,
    config: OAuthConfig,
    code: string
  ): Promise<OAuthTokens> {
    const params = new URLSearchParams();
    params.set('code', code);
    params.set('client_id', config.clientId);
    params.set('client_secret', config.clientSecret);
    params.set('redirect_uri', config.redirectUri);
    params.set('grant_type', 'authorization_code');

    let tokenUrl: string;
    if (provider === 'google') {
      tokenUrl = 'https://oauth2.googleapis.com/token';
    } else {
      const tenantId = process.env.MICROSOFT_TENANT_ID || 'common';
      tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
    }

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token exchange failed: ${error}`);
    }

    const data = await response.json();

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000,
      tokenType: data.token_type,
      scope: data.scope,
    };
  }

  /**
   * Get user info from provider
   */
  private async getUserInfo(
    provider: CalendarProvider,
    accessToken: string
  ): Promise<{ id: string; email: string; name: string }> {
    let url: string;
    if (provider === 'google') {
      url = 'https://www.googleapis.com/oauth2/v2/userinfo';
    } else {
      url = 'https://graph.microsoft.com/v1.0/me';
    }

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      throw new Error('Failed to fetch user info');
    }

    const data = await response.json();

    if (provider === 'google') {
      return {
        id: data.id,
        email: data.email,
        name: data.name || data.email,
      };
    } else {
      return {
        id: data.id,
        email: data.mail || data.userPrincipalName,
        name: data.displayName || data.mail,
      };
    }
  }

  /**
   * Refresh access token
   */
  async refreshToken(accountId: string, provider: CalendarProvider): Promise<OAuthTokens> {
    const tokens = await this.tokenStorage.get(accountId);
    if (!tokens) {
      throw new Error(`No tokens found for account ${accountId}`);
    }

    const config = provider === 'google' ? GOOGLE_OAUTH_CONFIG : MICROSOFT_OAUTH_CONFIG;
    const params = new URLSearchParams();
    params.set('refresh_token', tokens.refreshToken);
    params.set('client_id', config.clientId);
    params.set('client_secret', config.clientSecret);
    params.set('grant_type', 'refresh_token');

    let tokenUrl: string;
    if (provider === 'google') {
      tokenUrl = 'https://oauth2.googleapis.com/token';
    } else {
      const tenantId = process.env.MICROSOFT_TENANT_ID || 'common';
      tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
    }

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!response.ok) {
      const error = await response.text();
      logger.error('Token refresh failed', { accountId, error });
      throw new Error(`Token refresh failed: ${error}`);
    }

    const data = await response.json();

    const newTokens: OAuthTokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || tokens.refreshToken,
      expiresAt: Date.now() + data.expires_in * 1000,
      tokenType: data.token_type,
      scope: data.scope,
    };

    await this.tokenStorage.set(accountId, newTokens);
    logger.debug('Token refreshed', { accountId });

    return newTokens;
  }

  /**
   * Get valid access token (refreshes if needed)
   */
  async getValidAccessToken(accountId: string, provider: CalendarProvider): Promise<string> {
    const tokens = await this.tokenStorage.get(accountId);
    if (!tokens) {
      throw new Error(`No tokens found for account ${accountId}`);
    }

    // Refresh if token expires in less than 5 minutes
    if (tokens.expiresAt - Date.now() < 5 * 60 * 1000) {
      const newTokens = await this.refreshToken(accountId, provider);
      return newTokens.accessToken;
    }

    return tokens.accessToken;
  }

  /**
   * Remove account and revoke tokens
   */
  async removeAccount(accountId: string, provider: CalendarProvider): Promise<void> {
    const tokens = await this.tokenStorage.get(accountId);
    if (tokens) {
      // Revoke token
      try {
        if (provider === 'google') {
          await fetch(`https://oauth2.googleapis.com/revoke?token=${tokens.accessToken}`, {
            method: 'POST',
          });
        }
        // Microsoft doesn't have a token revocation endpoint
      } catch (error) {
        logger.warn('Failed to revoke token', { accountId, error });
      }

      await this.tokenStorage.delete(accountId);
    }

    // Clear session cookies for this provider
    await session.fromPartition('persist:oauth').clearStorageData({
      storages: ['cookies'],
    });

    this.emit('account-removed', accountId);
    logger.info('Account removed', { accountId });
  }

  /**
   * Get stored tokens for an account
   */
  async getTokens(accountId: string): Promise<OAuthTokens | null> {
    return this.tokenStorage.get(accountId);
  }

  /**
   * Get all stored account IDs
   */
  async getAllAccountIds(): Promise<string[]> {
    const tokens = await this.tokenStorage.getAll();
    return Array.from(tokens.keys());
  }

  /**
   * Generate random state for CSRF protection
   */
  private generateState(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Cleanup auth resources
   */
  private cleanup(): void {
    if (this.authWindow && !this.authWindow.isDestroyed()) {
      this.authWindow.close();
      this.authWindow = null;
    }
    if (this.httpServer) {
      this.httpServer.close();
      this.httpServer = null;
    }
  }

  /**
   * Shutdown manager
   */
  async shutdown(): Promise<void> {
    this.cleanup();
    this.removeAllListeners();
    OAuthManager.instance = null;
    logger.info('OAuth Manager shutdown');
  }
}

/**
 * Get OAuth manager instance
 */
export function getOAuthManager(): OAuthManager {
  return OAuthManager.getInstance();
}
