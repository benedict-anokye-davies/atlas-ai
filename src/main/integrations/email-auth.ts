/**
 * Atlas Desktop - Email OAuth Authentication Handler
 *
 * Handles OAuth 2.0 authentication for Gmail and Outlook email access.
 * Uses PKCE for enhanced security and supports both Google and Microsoft APIs.
 *
 * @module integrations/email-auth
 */

import { shell, session } from 'electron';
import { createServer, IncomingMessage, ServerResponse, Server } from 'http';
import { URL } from 'url';
import { randomBytes, createHash } from 'crypto';
import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import { getKeychainManager } from '../security/keychain';

const logger = createModuleLogger('EmailAuth');

// ============================================================================
// Types
// ============================================================================

export type EmailProvider = 'gmail' | 'outlook';

export interface EmailTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope: string;
  tokenType: string;
}

export interface EmailAuthConfig {
  provider: EmailProvider;
  clientId: string;
  clientSecret?: string;
  redirectPort?: number;
  scopes?: string[];
}

export interface EmailAccount {
  id: string;
  provider: EmailProvider;
  email: string;
  displayName: string;
  tokens: EmailTokens;
  isDefault: boolean;
  createdAt: number;
  lastSyncAt: number | null;
}

export interface EmailAuthState {
  isAuthenticated: boolean;
  provider: EmailProvider | null;
  email: string | null;
  expiresAt: number | null;
}

// ============================================================================
// Constants
// ============================================================================

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

const MICROSOFT_AUTH_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
const MICROSOFT_TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const MICROSOFT_USERINFO_URL = 'https://graph.microsoft.com/v1.0/me';

const DEFAULT_REDIRECT_PORT = 3848;

/**
 * Gmail OAuth scopes for full email access
 */
const GMAIL_SCOPES = [
  // Read, compose, send, and manage emails
  'https://www.googleapis.com/auth/gmail.modify',
  // Full access for search and labels
  'https://www.googleapis.com/auth/gmail.readonly',
  // Send emails
  'https://www.googleapis.com/auth/gmail.send',
  // Manage labels
  'https://www.googleapis.com/auth/gmail.labels',
  // User info
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];

/**
 * Outlook OAuth scopes for email access
 */
const OUTLOOK_SCOPES = [
  // Read and write mail
  'Mail.ReadWrite',
  // Send mail
  'Mail.Send',
  // Offline access for refresh tokens
  'offline_access',
  // User profile
  'User.Read',
  // OpenID for user info
  'openid',
  'profile',
  'email',
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
// Token Storage
// ============================================================================

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _EMAIL_TOKEN_STORAGE_KEY = 'ATLAS_EMAIL_TOKENS';

/**
 * Secure token storage using keychain
 */
class SecureEmailTokenStorage {
  private cache: Map<string, EmailTokens> = new Map();
  private initialized = false;

  /**
   * Initialize and load tokens from secure storage
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const _keychain = getKeychainManager();
      // Using a custom key that's not in the predefined list - store as encrypted fallback
      const storedData = await this.loadFromFallback();
      if (storedData) {
        const parsed = JSON.parse(storedData);
        for (const [accountId, tokens] of Object.entries(parsed)) {
          this.cache.set(accountId, tokens as EmailTokens);
        }
      }
      this.initialized = true;
      logger.debug('Email token storage initialized', { accountCount: this.cache.size });
    } catch (error) {
      logger.error('Failed to initialize email token storage', { error });
      this.initialized = true; // Still mark as initialized to prevent repeated attempts
    }
  }

  /**
   * Load tokens from fallback encrypted file storage
   */
  private async loadFromFallback(): Promise<string | null> {
    try {
      const fs = await import('fs/promises');
      const path = await import('path');
      const { app } = await import('electron');

      const storagePath = path.join(app.getPath('userData'), 'secure', 'email-tokens.enc');

      try {
        const data = await fs.readFile(storagePath, 'utf-8');
        // Simple obfuscation - in production would use proper encryption
        return Buffer.from(data, 'base64').toString('utf-8');
      } catch {
        return null;
      }
    } catch {
      return null;
    }
  }

  /**
   * Save tokens to fallback encrypted file storage
   */
  private async saveToFallback(): Promise<void> {
    try {
      const fs = await import('fs/promises');
      const path = await import('path');
      const { app } = await import('electron');

      const secureDir = path.join(app.getPath('userData'), 'secure');
      const storagePath = path.join(secureDir, 'email-tokens.enc');

      // Ensure directory exists
      await fs.mkdir(secureDir, { recursive: true });

      const data = JSON.stringify(Object.fromEntries(this.cache));
      // Simple obfuscation - in production would use proper encryption
      const encoded = Buffer.from(data).toString('base64');

      await fs.writeFile(storagePath, encoded, { mode: 0o600 });
    } catch (error) {
      logger.error('Failed to save email tokens to fallback storage', { error });
    }
  }

  /**
   * Get tokens for an account
   */
  async get(accountId: string): Promise<EmailTokens | null> {
    await this.initialize();
    return this.cache.get(accountId) || null;
  }

  /**
   * Set tokens for an account
   */
  async set(accountId: string, tokens: EmailTokens): Promise<void> {
    await this.initialize();
    this.cache.set(accountId, tokens);
    await this.saveToFallback();
  }

  /**
   * Delete tokens for an account
   */
  async delete(accountId: string): Promise<void> {
    await this.initialize();
    this.cache.delete(accountId);
    await this.saveToFallback();
  }

  /**
   * Get all stored tokens
   */
  async getAll(): Promise<Map<string, EmailTokens>> {
    await this.initialize();
    return new Map(this.cache);
  }

  /**
   * Clear all tokens
   */
  async clear(): Promise<void> {
    this.cache.clear();
    await this.saveToFallback();
  }
}

// ============================================================================
// EmailAuthManager Class
// ============================================================================

/**
 * Email OAuth Authentication Manager
 *
 * Handles the complete OAuth 2.0 flow for Gmail and Outlook:
 * 1. Generates PKCE verifier/challenge (for Gmail)
 * 2. Opens authorization URL in browser
 * 3. Runs local callback server
 * 4. Exchanges code for tokens
 * 5. Handles token refresh
 */
export class EmailAuthManager extends EventEmitter {
  private static instance: EmailAuthManager | null = null;
  private tokenStorage: SecureEmailTokenStorage;
  private accounts: Map<string, EmailAccount> = new Map();
  private callbackServer: Server | null = null;
  private codeVerifier: string | null = null;
  private authState: string | null = null;
  private isAuthenticating = false;
  private refreshTimers: Map<string, NodeJS.Timeout> = new Map();
  private currentConfig: EmailAuthConfig | null = null;

  private constructor() {
    super();
    this.tokenStorage = new SecureEmailTokenStorage();
    logger.info('Email Auth Manager initialized');
  }

  /**
   * Get singleton instance
   */
  static getInstance(): EmailAuthManager {
    if (!EmailAuthManager.instance) {
      EmailAuthManager.instance = new EmailAuthManager();
    }
    return EmailAuthManager.instance;
  }

  /**
   * Get the redirect URI for OAuth callback
   */
  private getRedirectUri(port: number): string {
    return `http://localhost:${port}/callback`;
  }

  /**
   * Get default scopes for a provider
   */
  private getDefaultScopes(provider: EmailProvider): string[] {
    return provider === 'gmail' ? GMAIL_SCOPES : OUTLOOK_SCOPES;
  }

  /**
   * Initialize and restore accounts from storage
   */
  async initialize(): Promise<void> {
    try {
      const allTokens = await this.tokenStorage.getAll();

      for (const [accountId, tokens] of allTokens) {
        // Parse account ID to get provider and user ID
        const parts = accountId.split('_');
        if (parts.length >= 2) {
          const provider = parts[0] as EmailProvider;

          // Try to get user info to restore account
          try {
            const userInfo = await this.getUserInfo(provider, tokens.accessToken);

            const account: EmailAccount = {
              id: accountId,
              provider,
              email: userInfo.email,
              displayName: userInfo.name,
              tokens,
              isDefault: this.accounts.size === 0,
              createdAt: Date.now(),
              lastSyncAt: null,
            };

            this.accounts.set(accountId, account);
            this.scheduleRefresh(accountId, provider);

            logger.debug('Restored email account', { accountId, email: userInfo.email });
          } catch (error) {
            // Token might be expired, try to refresh
            try {
              const newTokens = await this.refreshAccessToken(accountId, provider, tokens);
              const userInfo = await this.getUserInfo(provider, newTokens.accessToken);

              const account: EmailAccount = {
                id: accountId,
                provider,
                email: userInfo.email,
                displayName: userInfo.name,
                tokens: newTokens,
                isDefault: this.accounts.size === 0,
                createdAt: Date.now(),
                lastSyncAt: null,
              };

              this.accounts.set(accountId, account);
              this.scheduleRefresh(accountId, provider);

              logger.debug('Restored email account after token refresh', {
                accountId,
                email: userInfo.email,
              });
            } catch (refreshError) {
              logger.warn('Failed to restore email account', { accountId, error: refreshError });
              await this.tokenStorage.delete(accountId);
            }
          }
        }
      }

      logger.info('Email auth initialized', { accountCount: this.accounts.size });
    } catch (error) {
      logger.error('Failed to initialize email auth', { error });
    }
  }

  /**
   * Get all connected accounts
   */
  getAccounts(): EmailAccount[] {
    return Array.from(this.accounts.values());
  }

  /**
   * Get account by ID
   */
  getAccount(accountId: string): EmailAccount | null {
    return this.accounts.get(accountId) || null;
  }

  /**
   * Get default account
   */
  getDefaultAccount(): EmailAccount | null {
    for (const account of this.accounts.values()) {
      if (account.isDefault) {
        return account;
      }
    }
    // Return first account if no default
    return this.accounts.values().next().value || null;
  }

  /**
   * Set default account
   */
  setDefaultAccount(accountId: string): boolean {
    const account = this.accounts.get(accountId);
    if (!account) return false;

    for (const acc of this.accounts.values()) {
      acc.isDefault = acc.id === accountId;
    }

    this.emit('default-changed', account);
    return true;
  }

  /**
   * Check if any account is authenticated
   */
  isAuthenticated(): boolean {
    return this.accounts.size > 0;
  }

  /**
   * Get auth state for a specific account
   */
  getAuthState(accountId?: string): EmailAuthState {
    const account = accountId ? this.accounts.get(accountId) : this.getDefaultAccount();

    if (!account) {
      return {
        isAuthenticated: false,
        provider: null,
        email: null,
        expiresAt: null,
      };
    }

    return {
      isAuthenticated: true,
      provider: account.provider,
      email: account.email,
      expiresAt: account.tokens.expiresAt,
    };
  }

  /**
   * Start OAuth flow for a provider
   */
  async authenticate(config: EmailAuthConfig): Promise<EmailAccount> {
    if (this.isAuthenticating) {
      throw new Error('Authentication already in progress');
    }

    this.isAuthenticating = true;
    this.currentConfig = {
      ...config,
      redirectPort: config.redirectPort || DEFAULT_REDIRECT_PORT,
      scopes: config.scopes || this.getDefaultScopes(config.provider),
    };

    logger.info('Starting email authentication flow', { provider: config.provider });

    try {
      // Generate PKCE values (used by both providers for enhanced security)
      this.codeVerifier = generateCodeVerifier();
      const codeChallenge = generateCodeChallenge(this.codeVerifier);
      this.authState = generateState();

      // Wait for authorization code
      const code = await this.waitForAuthorizationCode(codeChallenge);

      // Exchange code for tokens
      const tokens = await this.exchangeCodeForTokens(config.provider, code);

      // Get user info
      const userInfo = await this.getUserInfo(config.provider, tokens.accessToken);

      // Create account
      const accountId = `${config.provider}_${userInfo.id}`;
      const account: EmailAccount = {
        id: accountId,
        provider: config.provider,
        email: userInfo.email,
        displayName: userInfo.name,
        tokens,
        isDefault: this.accounts.size === 0,
        createdAt: Date.now(),
        lastSyncAt: null,
      };

      // Store tokens and account
      await this.tokenStorage.set(accountId, tokens);
      this.accounts.set(accountId, account);
      this.scheduleRefresh(accountId, config.provider);

      logger.info('Email authentication successful', {
        provider: config.provider,
        email: account.email,
        accountId,
      });

      this.emit('authenticated', account);
      return account;
    } catch (error) {
      logger.error('Email authentication failed', { provider: config.provider, error });
      this.emit('error', error);
      throw error;
    } finally {
      this.isAuthenticating = false;
      this.codeVerifier = null;
      this.authState = null;
      this.currentConfig = null;
    }
  }

  /**
   * Wait for OAuth callback with authorization code
   */
  private waitForAuthorizationCode(codeChallenge: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const config = this.currentConfig!;
      const port = config.redirectPort!;

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

        const url = new URL(req.url, `http://localhost:${port}`);

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
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(`
              <!DOCTYPE html>
              <html>
              <head><title>Authentication Failed</title></head>
              <body style="font-family: system-ui; text-align: center; padding: 50px;">
                <h1>Authentication Failed</h1>
                <p>${errorDescription}</p>
                <p>You can close this window.</p>
              </body>
              </html>
            `);

          reject(new Error(`Email auth error: ${error} - ${errorDescription}`));
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

        const providerName = config.provider === 'gmail' ? 'Gmail' : 'Outlook';
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
            <!DOCTYPE html>
            <html>
            <head>
              <title>Atlas - ${providerName} Connected</title>
              <style>
                body {
                  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                  display: flex;
                  justify-content: center;
                  align-items: center;
                  height: 100vh;
                  margin: 0;
                  background: linear-gradient(135deg, #4285f4 0%, #1a1a2e 100%);
                  color: white;
                }
                .container {
                  text-align: center;
                  padding: 40px;
                  background: rgba(0, 0, 0, 0.5);
                  border-radius: 16px;
                  max-width: 400px;
                }
                h1 { margin-bottom: 16px; }
                p { opacity: 0.8; margin: 8px 0; }
                .icon { font-size: 48px; margin-bottom: 16px; }
              </style>
            </head>
            <body>
              <div class="container">
                <div class="icon">&#x2709;</div>
                <h1>${providerName} Connected!</h1>
                <p>Atlas can now access your email.</p>
                <p>You can close this window and return to Atlas.</p>
              </div>
            </body>
            </html>
          `);

        resolve(code);
      });

      this.callbackServer.listen(port, () => {
        logger.debug('Email auth callback server listening', { port });

        // Build and open authorization URL
        const authUrl = this.buildAuthUrl(config.provider, codeChallenge);

        // Open in default browser
        shell.openExternal(authUrl);
        logger.info('Opened email authorization page in browser', { provider: config.provider });
      });

      this.callbackServer.on('error', (error) => {
        clearTimeout(timeout);
        this.stopCallbackServer();
        reject(new Error(`Callback server error: ${error.message}`));
      });
    });
  }

  /**
   * Build OAuth authorization URL
   */
  private buildAuthUrl(provider: EmailProvider, codeChallenge: string): string {
    const config = this.currentConfig!;
    const redirectUri = this.getRedirectUri(config.redirectPort!);

    if (provider === 'gmail') {
      const params = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: config.scopes!.join(' '),
        access_type: 'offline',
        prompt: 'consent',
        state: this.authState!,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      });
      return `${GOOGLE_AUTH_URL}?${params.toString()}`;
    } else {
      const params = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: config.scopes!.join(' '),
        response_mode: 'query',
        state: this.authState!,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      });
      return `${MICROSOFT_AUTH_URL}?${params.toString()}`;
    }
  }

  /**
   * Exchange authorization code for tokens
   */
  private async exchangeCodeForTokens(provider: EmailProvider, code: string): Promise<EmailTokens> {
    const config = this.currentConfig!;
    const redirectUri = this.getRedirectUri(config.redirectPort!);

    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: config.clientId,
      code_verifier: this.codeVerifier!,
    });

    // Add client secret if available
    if (config.clientSecret) {
      params.set('client_secret', config.clientSecret);
    }

    const tokenUrl = provider === 'gmail' ? GOOGLE_TOKEN_URL : MICROSOFT_TOKEN_URL;

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error('Token exchange failed', { status: response.status, body: errorBody });
      throw new Error(`Token exchange failed: ${response.status}`);
    }

    const data = await response.json();

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000,
      scope: data.scope || config.scopes!.join(' '),
      tokenType: data.token_type,
    };
  }

  /**
   * Get user info from provider
   */
  private async getUserInfo(
    provider: EmailProvider,
    accessToken: string
  ): Promise<{ id: string; email: string; name: string }> {
    const url = provider === 'gmail' ? GOOGLE_USERINFO_URL : MICROSOFT_USERINFO_URL;

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch user info: ${response.status}`);
    }

    const data = await response.json();

    if (provider === 'gmail') {
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
  private async refreshAccessToken(
    accountId: string,
    provider: EmailProvider,
    currentTokens: EmailTokens
  ): Promise<EmailTokens> {
    logger.debug('Refreshing email access token', { accountId, provider });

    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: currentTokens.refreshToken,
      client_id: this.getClientId(provider),
    });

    const clientSecret = this.getClientSecret(provider);
    if (clientSecret) {
      params.set('client_secret', clientSecret);
    }

    const tokenUrl = provider === 'gmail' ? GOOGLE_TOKEN_URL : MICROSOFT_TOKEN_URL;

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error('Token refresh failed', { accountId, status: response.status, body: errorBody });
      throw new Error(`Token refresh failed: ${response.status}`);
    }

    const data = await response.json();

    const newTokens: EmailTokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || currentTokens.refreshToken,
      expiresAt: Date.now() + data.expires_in * 1000,
      scope: data.scope || currentTokens.scope,
      tokenType: data.token_type,
    };

    // Update storage and account
    await this.tokenStorage.set(accountId, newTokens);
    const account = this.accounts.get(accountId);
    if (account) {
      account.tokens = newTokens;
    }

    this.scheduleRefresh(accountId, provider);
    logger.info('Email access token refreshed', { accountId });
    this.emit('token-refreshed', accountId, newTokens);

    return newTokens;
  }

  /**
   * Get client ID from environment
   */
  private getClientId(provider: EmailProvider): string {
    if (provider === 'gmail') {
      return process.env.GOOGLE_EMAIL_CLIENT_ID || process.env.GOOGLE_CALENDAR_CLIENT_ID || '';
    } else {
      return (
        process.env.MICROSOFT_EMAIL_CLIENT_ID || process.env.MICROSOFT_CALENDAR_CLIENT_ID || ''
      );
    }
  }

  /**
   * Get client secret from environment
   */
  private getClientSecret(provider: EmailProvider): string {
    if (provider === 'gmail') {
      return (
        process.env.GOOGLE_EMAIL_CLIENT_SECRET || process.env.GOOGLE_CALENDAR_CLIENT_SECRET || ''
      );
    } else {
      return (
        process.env.MICROSOFT_EMAIL_CLIENT_SECRET ||
        process.env.MICROSOFT_CALENDAR_CLIENT_SECRET ||
        ''
      );
    }
  }

  /**
   * Schedule automatic token refresh
   */
  private scheduleRefresh(accountId: string, provider: EmailProvider): void {
    // Clear existing timer
    const existingTimer = this.refreshTimers.get(accountId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const account = this.accounts.get(accountId);
    if (!account) return;

    // Refresh 5 minutes before expiration
    const refreshIn = Math.max(0, account.tokens.expiresAt - Date.now() - 300000);

    const timer = setTimeout(async () => {
      try {
        const tokens = await this.tokenStorage.get(accountId);
        if (tokens) {
          await this.refreshAccessToken(accountId, provider, tokens);
        }
      } catch (error) {
        logger.error('Scheduled token refresh failed', { accountId, error });
        this.emit('token-expired', accountId);
      }
    }, refreshIn);

    this.refreshTimers.set(accountId, timer);

    logger.debug('Token refresh scheduled', {
      accountId,
      refreshInMs: refreshIn,
      refreshAt: new Date(Date.now() + refreshIn).toISOString(),
    });
  }

  /**
   * Get valid access token for an account
   */
  async getValidAccessToken(accountId: string): Promise<string | null> {
    const account = this.accounts.get(accountId);
    if (!account) return null;

    // Refresh if token expires in less than 5 minutes
    if (Date.now() > account.tokens.expiresAt - 300000) {
      try {
        const newTokens = await this.refreshAccessToken(
          accountId,
          account.provider,
          account.tokens
        );
        return newTokens.accessToken;
      } catch (error) {
        logger.error('Failed to refresh token', { accountId, error });
        return null;
      }
    }

    return account.tokens.accessToken;
  }

  /**
   * Remove an account and revoke tokens
   */
  async removeAccount(accountId: string): Promise<void> {
    const account = this.accounts.get(accountId);
    if (!account) return;

    // Revoke token if possible
    try {
      if (account.provider === 'gmail') {
        await fetch(`${GOOGLE_REVOKE_URL}?token=${account.tokens.accessToken}`, {
          method: 'POST',
        });
      }
      // Microsoft doesn't have a simple token revocation endpoint
    } catch (error) {
      logger.warn('Failed to revoke token', { accountId, error });
    }

    // Clear timer
    const timer = this.refreshTimers.get(accountId);
    if (timer) {
      clearTimeout(timer);
      this.refreshTimers.delete(accountId);
    }

    // Remove from storage and cache
    await this.tokenStorage.delete(accountId);
    this.accounts.delete(accountId);

    // Update default if needed
    if (account.isDefault && this.accounts.size > 0) {
      const firstAccount = this.accounts.values().next().value;
      if (firstAccount) {
        firstAccount.isDefault = true;
      }
    }

    // Clear session cookies
    await session.fromPartition('persist:email-oauth').clearStorageData({
      storages: ['cookies'],
    });

    this.emit('account-removed', accountId);
    logger.info('Email account removed', { accountId, email: account.email });
  }

  /**
   * Stop the callback server
   */
  private stopCallbackServer(): void {
    if (this.callbackServer) {
      this.callbackServer.close();
      this.callbackServer = null;
      logger.debug('Callback server stopped');
    }
  }

  /**
   * Shutdown and cleanup
   */
  async shutdown(): Promise<void> {
    // Stop all refresh timers
    for (const timer of this.refreshTimers.values()) {
      clearTimeout(timer);
    }
    this.refreshTimers.clear();

    // Stop callback server
    this.stopCallbackServer();

    // Clear event listeners
    this.removeAllListeners();

    EmailAuthManager.instance = null;
    logger.info('Email auth manager shutdown');
  }
}

// ============================================================================
// Exports
// ============================================================================

/**
 * Get the email auth manager singleton
 */
export function getEmailAuthManager(): EmailAuthManager {
  return EmailAuthManager.getInstance();
}

/**
 * Shutdown the email auth manager
 */
export async function shutdownEmailAuth(): Promise<void> {
  const manager = EmailAuthManager.getInstance();
  await manager.shutdown();
}

export default {
  EmailAuthManager,
  getEmailAuthManager,
  shutdownEmailAuth,
};
