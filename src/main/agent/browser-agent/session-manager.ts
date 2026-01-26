/**
 * Session Manager
 *
 * Manages browser profiles, authentication state, and session persistence.
 * Keeps users logged in across sessions and enables seamless context switching.
 *
 * @module agent/browser-agent/session-manager
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { app } from 'electron';
import { createModuleLogger } from '../../utils/logger';
import {
  BrowserProfile,
  BrowserSession,
  SessionCookie,
  ProfilePreferences,
  AuthState,
} from './types';

const logger = createModuleLogger('SessionManager');

// ============================================================================
// Encryption Utilities
// ============================================================================

const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const ENCRYPTION_KEY_LENGTH = 32;
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

/**
 * Derive encryption key from machine-specific data
 */
function deriveEncryptionKey(): Buffer {
  const machineId = `${process.env.COMPUTERNAME || 'atlas'}-${process.platform}-${process.arch}`;
  return crypto.scryptSync(machineId, 'atlas-browser-session', ENCRYPTION_KEY_LENGTH);
}

/**
 * Encrypt sensitive data
 */
function encrypt(data: string): string {
  const key = deriveEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
  
  let encrypted = cipher.update(data, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag();
  
  // Format: iv:authTag:encrypted
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypt sensitive data
 */
function decrypt(encryptedData: string): string {
  const key = deriveEncryptionKey();
  const parts = encryptedData.split(':');
  
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted data format');
  }
  
  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encrypted = parts[2];
  
  const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

// ============================================================================
// Session Manager Class
// ============================================================================

export class SessionManager extends EventEmitter {
  private profilesDir: string;
  private sessionsDir: string;
  private profiles: Map<string, BrowserProfile> = new Map();
  private currentSession: BrowserSession | null = null;
  private page: any;

  constructor() {
    super();
    
    const userDataPath = app.getPath('userData');
    this.profilesDir = path.join(userDataPath, 'browser-profiles');
    this.sessionsDir = path.join(userDataPath, 'browser-sessions');
    
    // Ensure directories exist
    fs.mkdirSync(this.profilesDir, { recursive: true });
    fs.mkdirSync(this.sessionsDir, { recursive: true });
    
    // Load existing profiles
    this.loadProfiles();
  }

  /**
   * Initialize with a Puppeteer page
   */
  setPage(page: any): void {
    this.page = page;
  }

  // ============================================================================
  // Profile Management
  // ============================================================================

  /**
   * Create a new browser profile
   */
  async createProfile(name: string, domains?: string[]): Promise<BrowserProfile> {
    const id = `profile_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    
    const profile: BrowserProfile = {
      id,
      name,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      domains: domains || [],
      cookies: [],
      localStorage: {},
      preferences: {},
      authState: {},
    };
    
    this.profiles.set(id, profile);
    await this.saveProfile(profile);
    
    logger.info('Created browser profile', { id, name });
    this.emit('profile:created', profile);
    
    return profile;
  }

  /**
   * Get a profile by ID
   */
  getProfile(id: string): BrowserProfile | undefined {
    return this.profiles.get(id);
  }

  /**
   * Get profile by domain
   */
  getProfileForDomain(domain: string): BrowserProfile | undefined {
    for (const profile of this.profiles.values()) {
      if (profile.domains.some(d => domain.includes(d) || d.includes(domain))) {
        return profile;
      }
    }
    return undefined;
  }

  /**
   * List all profiles
   */
  listProfiles(): BrowserProfile[] {
    return Array.from(this.profiles.values());
  }

  /**
   * Update profile preferences
   */
  async updateProfilePreferences(
    profileId: string,
    preferences: Partial<ProfilePreferences>
  ): Promise<void> {
    const profile = this.profiles.get(profileId);
    if (!profile) {
      throw new Error(`Profile not found: ${profileId}`);
    }
    
    profile.preferences = { ...profile.preferences, ...preferences };
    profile.updatedAt = Date.now();
    await this.saveProfile(profile);
    
    logger.debug('Updated profile preferences', { profileId });
  }

  /**
   * Add domain to profile
   */
  async addDomainToProfile(profileId: string, domain: string): Promise<void> {
    const profile = this.profiles.get(profileId);
    if (!profile) {
      throw new Error(`Profile not found: ${profileId}`);
    }
    
    if (!profile.domains.includes(domain)) {
      profile.domains.push(domain);
      profile.updatedAt = Date.now();
      await this.saveProfile(profile);
    }
  }

  /**
   * Delete a profile
   */
  async deleteProfile(profileId: string): Promise<void> {
    const profile = this.profiles.get(profileId);
    if (!profile) return;
    
    this.profiles.delete(profileId);
    
    const filePath = path.join(this.profilesDir, `${profileId}.json`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    
    logger.info('Deleted browser profile', { profileId });
    this.emit('profile:deleted', profileId);
  }

  // ============================================================================
  // Session Management
  // ============================================================================

  /**
   * Start a new session with optional profile
   */
  async startSession(profileId?: string): Promise<BrowserSession> {
    const session: BrowserSession = {
      id: `session_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      profileId,
      startedAt: Date.now(),
      lastActiveAt: Date.now(),
      tabs: [],
      activeTabId: '',
      cookies: [],
      localStorage: {},
      sessionStorage: {},
    };
    
    // If profile specified, restore its state
    if (profileId) {
      const profile = this.profiles.get(profileId);
      if (profile) {
        await this.restoreProfileState(profile);
        session.cookies = profile.cookies;
        session.localStorage = profile.localStorage;
      }
    }
    
    this.currentSession = session;
    logger.info('Started browser session', { id: session.id, profileId });
    this.emit('session:started', session);
    
    return session;
  }

  /**
   * Get current session
   */
  getCurrentSession(): BrowserSession | null {
    return this.currentSession;
  }

  /**
   * Update session activity
   */
  updateSessionActivity(): void {
    if (this.currentSession) {
      this.currentSession.lastActiveAt = Date.now();
    }
  }

  /**
   * Save current session state to profile
   */
  async saveSessionToProfile(): Promise<void> {
    if (!this.currentSession?.profileId) return;
    
    const profile = this.profiles.get(this.currentSession.profileId);
    if (!profile) return;
    
    // Capture current browser state
    await this.captureSessionState();
    
    // Update profile with session data
    profile.cookies = this.currentSession.cookies;
    profile.localStorage = this.currentSession.localStorage;
    profile.updatedAt = Date.now();
    
    await this.saveProfile(profile);
    logger.debug('Saved session to profile', { profileId: profile.id });
  }

  /**
   * End current session
   */
  async endSession(saveToProfile = true): Promise<void> {
    if (!this.currentSession) return;
    
    if (saveToProfile && this.currentSession.profileId) {
      await this.saveSessionToProfile();
    }
    
    const sessionId = this.currentSession.id;
    this.currentSession = null;
    
    logger.info('Ended browser session', { id: sessionId });
    this.emit('session:ended', sessionId);
  }

  // ============================================================================
  // Cookie Management
  // ============================================================================

  /**
   * Get all cookies from current page
   */
  async getCookies(urls?: string[]): Promise<SessionCookie[]> {
    if (!this.page) return [];
    
    const cookies = urls 
      ? await this.page.cookies(...urls)
      : await this.page.cookies();
    
    return cookies.map((c: any) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      expires: c.expires,
      httpOnly: c.httpOnly,
      secure: c.secure,
      sameSite: c.sameSite || 'Lax',
    }));
  }

  /**
   * Set cookies on current page
   */
  async setCookies(cookies: SessionCookie[]): Promise<void> {
    if (!this.page) return;
    
    const puppeteerCookies = cookies.map(c => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      expires: c.expires,
      httpOnly: c.httpOnly,
      secure: c.secure,
      sameSite: c.sameSite,
    }));
    
    await this.page.setCookie(...puppeteerCookies);
    logger.debug('Set cookies', { count: cookies.length });
  }

  /**
   * Clear all cookies
   */
  async clearCookies(): Promise<void> {
    if (!this.page) return;
    
    const cookies = await this.page.cookies();
    if (cookies.length > 0) {
      await this.page.deleteCookie(...cookies);
    }
    
    logger.debug('Cleared all cookies');
  }

  // ============================================================================
  // Local Storage Management
  // ============================================================================

  /**
   * Sensitive key patterns to exclude from storage access
   */
  private static readonly BLOCKED_KEY_PATTERNS = [
    'token',
    'password',
    'pwd',
    'api_key',
    'apikey',
    'secret',
    'auth',
    'session',
    'credential',
    'private',
    'access_token',
    'refresh_token',
    'jwt',
  ];

  /**
   * Check if a storage key contains sensitive information
   */
  private isSensitiveKey(key: string): boolean {
    const lowerKey = key.toLowerCase();
    return SessionManager.BLOCKED_KEY_PATTERNS.some(pattern =>
      lowerKey.includes(pattern)
    );
  }

  /**
   * Get localStorage for current origin (with security filtering)
   * Excludes sensitive keys like tokens, passwords, API keys
   */
  async getLocalStorage(): Promise<Record<string, string>> {
    if (!this.page) return {};

    const allData = await this.page.evaluate(() => {
      const data: Record<string, string> = {};
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key) {
          data[key] = localStorage.getItem(key) || '';
        }
      }
      return data;
    });

    // Filter out sensitive keys
    const sanitized: Record<string, string> = {};
    let blockedCount = 0;

    for (const [key, value] of Object.entries(allData)) {
      if (this.isSensitiveKey(key)) {
        blockedCount++;
        logger.debug('Blocked sensitive localStorage key', { key });
      } else {
        sanitized[key] = value;
      }
    }

    if (blockedCount > 0) {
      logger.info('Filtered sensitive localStorage keys', {
        blocked: blockedCount,
        allowed: Object.keys(sanitized).length
      });
    }

    return sanitized;
  }

  /**
   * Set localStorage items
   */
  async setLocalStorage(data: Record<string, string>): Promise<void> {
    if (!this.page) return;
    
    await this.page.evaluate((items: Record<string, string>) => {
      for (const [key, value] of Object.entries(items)) {
        localStorage.setItem(key, value);
      }
    }, data);
    
    logger.debug('Set localStorage items', { count: Object.keys(data).length });
  }

  /**
   * Clear localStorage
   */
  async clearLocalStorage(): Promise<void> {
    if (!this.page) return;
    
    await this.page.evaluate(() => localStorage.clear());
    logger.debug('Cleared localStorage');
  }

  // ============================================================================
  // Authentication State
  // ============================================================================

  /**
   * Update auth state for a domain
   */
  async updateAuthState(domain: string, authState: Partial<AuthState>): Promise<void> {
    if (!this.currentSession?.profileId) return;
    
    const profile = this.profiles.get(this.currentSession.profileId);
    if (!profile) return;
    
    profile.authState[domain] = {
      ...profile.authState[domain],
      ...authState,
    };
    profile.updatedAt = Date.now();
    
    await this.saveProfile(profile);
    logger.debug('Updated auth state', { domain, isLoggedIn: authState.isLoggedIn });
  }

  /**
   * Check if authenticated for domain
   */
  isAuthenticatedForDomain(domain: string): boolean {
    if (!this.currentSession?.profileId) return false;
    
    const profile = this.profiles.get(this.currentSession.profileId);
    if (!profile) return false;
    
    return profile.authState[domain]?.isLoggedIn || false;
  }

  /**
   * Detect login state change by monitoring page
   */
  async detectLoginState(): Promise<{ domain: string; isLoggedIn: boolean } | null> {
    if (!this.page) return null;
    
    const url = this.page.url();
    const domain = new URL(url).hostname;
    
    // Check for common login indicators
    const indicators = await this.page.evaluate(() => {
      const body = document.body.innerText.toLowerCase();
      const hasLogout = body.includes('log out') || 
                       body.includes('logout') || 
                       body.includes('sign out') ||
                       !!document.querySelector('[href*="logout"]') ||
                       !!document.querySelector('[href*="signout"]');
      
      const hasLogin = body.includes('log in') || 
                      body.includes('login') || 
                      body.includes('sign in') ||
                      !!document.querySelector('input[type="password"]');
      
      const hasUserProfile = !!document.querySelector('[class*="avatar"]') ||
                            !!document.querySelector('[class*="profile"]') ||
                            !!document.querySelector('[class*="account"]');
      
      return { hasLogout, hasLogin, hasUserProfile };
    });
    
    // Heuristic: likely logged in if logout visible or user profile visible, and no login form
    const isLoggedIn = (indicators.hasLogout || indicators.hasUserProfile) && !indicators.hasLogin;
    
    return { domain, isLoggedIn };
  }

  // ============================================================================
  // State Capture & Restore
  // ============================================================================

  /**
   * Capture current session state
   */
  private async captureSessionState(): Promise<void> {
    if (!this.page || !this.currentSession) return;
    
    try {
      const url = this.page.url();
      const origin = new URL(url).origin;
      
      // Capture cookies
      this.currentSession.cookies = await this.getCookies();
      
      // Capture localStorage
      const localStorage = await this.getLocalStorage();
      this.currentSession.localStorage[origin] = localStorage;
      
      logger.debug('Captured session state', {
        cookieCount: this.currentSession.cookies.length,
        localStorageKeys: Object.keys(localStorage).length,
      });
    } catch (error) {
      logger.warn('Failed to capture session state', { error });
    }
  }

  /**
   * Restore profile state to browser
   */
  private async restoreProfileState(profile: BrowserProfile): Promise<void> {
    if (!this.page) return;
    
    try {
      // Restore cookies
      if (profile.cookies.length > 0) {
        await this.setCookies(profile.cookies);
      }
      
      // Note: localStorage can only be set after navigating to the origin
      // This will be handled when navigating to pages
      
      logger.debug('Restored profile state', {
        profileId: profile.id,
        cookieCount: profile.cookies.length,
      });
    } catch (error) {
      logger.warn('Failed to restore profile state', { error });
    }
  }

  /**
   * Restore localStorage for current origin
   */
  async restoreLocalStorageForCurrentOrigin(): Promise<void> {
    if (!this.page || !this.currentSession?.profileId) return;
    
    const profile = this.profiles.get(this.currentSession.profileId);
    if (!profile) return;
    
    try {
      const url = this.page.url();
      const origin = new URL(url).origin;
      
      const localStorage = profile.localStorage[origin];
      if (localStorage && Object.keys(localStorage).length > 0) {
        await this.setLocalStorage(localStorage);
        logger.debug('Restored localStorage for origin', { origin });
      }
    } catch (error) {
      logger.warn('Failed to restore localStorage', { error });
    }
  }

  // ============================================================================
  // Persistence
  // ============================================================================

  /**
   * Load all profiles from disk
   */
  private loadProfiles(): void {
    try {
      const files = fs.readdirSync(this.profilesDir);
      
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        
        try {
          const filePath = path.join(this.profilesDir, file);
          const encrypted = fs.readFileSync(filePath, 'utf-8');
          const decrypted = decrypt(encrypted);
          const profile = JSON.parse(decrypted) as BrowserProfile;
          
          this.profiles.set(profile.id, profile);
        } catch (error) {
          logger.warn('Failed to load profile', { file, error });
        }
      }
      
      logger.info('Loaded browser profiles', { count: this.profiles.size });
    } catch (error) {
      logger.warn('Failed to load profiles directory', { error });
    }
  }

  /**
   * Save profile to disk (encrypted)
   */
  private async saveProfile(profile: BrowserProfile): Promise<void> {
    try {
      const data = JSON.stringify(profile, null, 2);
      const encrypted = encrypt(data);
      
      const filePath = path.join(this.profilesDir, `${profile.id}.json`);
      fs.writeFileSync(filePath, encrypted, 'utf-8');
      
      logger.debug('Saved profile to disk', { profileId: profile.id });
    } catch (error) {
      logger.error('Failed to save profile', { profileId: profile.id, error });
      throw error;
    }
  }

  /**
   * Export profile (for backup/transfer)
   */
  async exportProfile(profileId: string): Promise<string> {
    const profile = this.profiles.get(profileId);
    if (!profile) {
      throw new Error(`Profile not found: ${profileId}`);
    }
    
    // Remove sensitive data for export
    const exportData = {
      ...profile,
      cookies: profile.cookies.map(c => ({ ...c, value: '[REDACTED]' })),
    };
    
    return JSON.stringify(exportData, null, 2);
  }

  /**
   * Import profile
   */
  async importProfile(data: string): Promise<BrowserProfile> {
    const imported = JSON.parse(data) as BrowserProfile;
    
    // Generate new ID to avoid conflicts
    imported.id = `profile_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    imported.createdAt = Date.now();
    imported.updatedAt = Date.now();
    
    this.profiles.set(imported.id, imported);
    await this.saveProfile(imported);
    
    logger.info('Imported browser profile', { id: imported.id, name: imported.name });
    return imported;
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let sessionManagerInstance: SessionManager | null = null;

/**
 * Get or create the session manager
 */
export function getSessionManager(): SessionManager {
  if (!sessionManagerInstance) {
    sessionManagerInstance = new SessionManager();
  }
  return sessionManagerInstance;
}
