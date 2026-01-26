/**
 * Atlas Desktop - Clipboard Manager
 *
 * Provides clipboard history tracking, pinning, and management functionality.
 * Supports text and image content with configurable history size and
 * sensitive content filtering.
 *
 * Voice commands:
 * - "Show clipboard" / "Clipboard history"
 * - "Paste item [n]"
 * - "Clear clipboard"
 * - "Pin clipboard item [n]"
 *
 * @module system/clipboard-manager
 */

import { clipboard, nativeImage, globalShortcut, BrowserWindow } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('ClipboardManager');

// ============================================================================
// Types
// ============================================================================

/**
 * Type of clipboard content
 */
export type ClipboardContentType = 'text' | 'image' | 'html' | 'rtf';

/**
 * Represents a single clipboard history entry
 */
export interface ClipboardEntry {
  /** Unique identifier */
  id: string;
  /** Type of content */
  type: ClipboardContentType;
  /** Text content (for text/html/rtf types) */
  text?: string;
  /** HTML content (if available) */
  html?: string;
  /** Image data as base64 (for image type) */
  imageBase64?: string;
  /** Image dimensions */
  imageSize?: { width: number; height: number };
  /** Preview text (truncated for display) */
  preview: string;
  /** Timestamp when copied */
  timestamp: number;
  /** Whether this item is pinned */
  pinned: boolean;
  /** Source application (if available) */
  sourceApp?: string;
  /** Hash of content for deduplication */
  contentHash: string;
  /** Content size in bytes */
  size: number;
  /** Whether content may be sensitive */
  isSensitive: boolean;
}

/**
 * Configuration for clipboard manager
 */
export interface ClipboardManagerConfig {
  /** Maximum number of history items (default: 100) */
  maxHistorySize: number;
  /** Maximum size of single item in bytes (default: 5MB) */
  maxItemSize: number;
  /** Enable sensitive content detection (default: true) */
  detectSensitiveContent: boolean;
  /** Auto-exclude sensitive content from history (default: true) */
  excludeSensitiveContent: boolean;
  /** Polling interval in ms (default: 500) */
  pollingInterval: number;
  /** Keyboard shortcut to show history (default: 'CommandOrControl+Shift+V') */
  shortcut: string;
  /** Enable image history (default: true) */
  enableImageHistory: boolean;
  /** Maximum image size in bytes to store (default: 2MB) */
  maxImageSize: number;
  /** Preview text length (default: 100) */
  previewLength: number;
}

/**
 * Clipboard manager events
 */
export interface ClipboardManagerEvents {
  'entry-added': (entry: ClipboardEntry) => void;
  'entry-removed': (id: string) => void;
  'entry-pinned': (id: string, pinned: boolean) => void;
  'history-cleared': () => void;
  'clipboard-changed': (entry: ClipboardEntry | null) => void;
  'sensitive-detected': (entry: ClipboardEntry) => void;
  error: (error: Error) => void;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CONFIG: ClipboardManagerConfig = {
  maxHistorySize: 100,
  maxItemSize: 5 * 1024 * 1024, // 5MB
  detectSensitiveContent: true,
  excludeSensitiveContent: true,
  pollingInterval: 500,
  shortcut: 'CommandOrControl+Shift+V',
  enableImageHistory: true,
  maxImageSize: 2 * 1024 * 1024, // 2MB
  previewLength: 100,
};

/**
 * Patterns that indicate sensitive content
 */
const SENSITIVE_PATTERNS = [
  // Credit card numbers (various formats)
  /\b(?:\d[ -]*?){13,19}\b/,
  // Social Security Numbers
  /\b\d{3}[-.]?\d{2}[-.]?\d{4}\b/,
  // API keys / tokens (common formats)
  /\b(?:sk|pk|api|key|token|secret|password|bearer)[-_]?[a-zA-Z0-9]{16,}\b/i,
  // Private keys
  /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/,
  // AWS credentials
  /\bAKIA[A-Z0-9]{16}\b/,
  /\baws[_-]?(?:secret[_-]?)?(?:access[_-]?)?key[=:]["']?[A-Za-z0-9/+=]{40}["']?/i,
  // JWT tokens
  /\beyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/,
  // GitHub tokens
  /\bgh[pous]_[a-zA-Z0-9]{36,}\b/,
  // Generic password in URL
  /[:/]\/[^:]+:([^@]{8,})@/,
  // Connection strings with passwords
  /(?:password|pwd|passwd)=["']?[^"'\s;]{8,}["']?/i,
];

/**
 * Keywords that might indicate sensitive content
 */
const SENSITIVE_KEYWORDS = [
  'password',
  'secret',
  'private',
  'credential',
  'token',
  'api_key',
  'apikey',
  'api-key',
  'ssh-rsa',
  'ssh-ed25519',
  'auth',
  'bearer',
];

// ============================================================================
// ClipboardManager Class
// ============================================================================

/**
 * Manages clipboard history with support for text and images,
 * pinning, searching, and sensitive content detection.
 */
export class ClipboardManager extends EventEmitter {
  private static instance: ClipboardManager;
  private history: ClipboardEntry[] = [];
  private config: ClipboardManagerConfig;
  private pollingTimer: NodeJS.Timeout | null = null;
  private lastContentHash: string = '';
  private initialized: boolean = false;
  private mainWindow: BrowserWindow | null = null;

  // Data persistence
  private readonly DATA_DIR = path.join(os.homedir(), '.atlas', 'clipboard');
  private readonly HISTORY_FILE = path.join(os.homedir(), '.atlas', 'clipboard', 'history.json');

  private constructor(config: Partial<ClipboardManagerConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Get singleton instance
   */
  public static getInstance(config?: Partial<ClipboardManagerConfig>): ClipboardManager {
    if (!ClipboardManager.instance) {
      ClipboardManager.instance = new ClipboardManager(config);
    }
    return ClipboardManager.instance;
  }

  /**
   * Initialize the clipboard manager
   */
  public async initialize(mainWindow?: BrowserWindow): Promise<void> {
    if (this.initialized) {
      return;
    }

    logger.info('Initializing clipboard manager');
    this.mainWindow = mainWindow || null;

    // Ensure data directory exists
    await fs.mkdir(this.DATA_DIR, { recursive: true });

    // Load existing history
    await this.loadHistory();

    // Register keyboard shortcut
    this.registerShortcut();

    // Start clipboard polling
    this.startPolling();

    // Record initial clipboard state
    this.lastContentHash = this.computeCurrentHash();

    this.initialized = true;
    logger.info('Clipboard manager initialized', {
      historySize: this.history.length,
      shortcut: this.config.shortcut,
    });
  }

  /**
   * Set the main window reference (for showing history UI)
   */
  public setMainWindow(window: BrowserWindow | null): void {
    this.mainWindow = window;
  }

  /**
   * Update configuration
   */
  public updateConfig(config: Partial<ClipboardManagerConfig>): void {
    const oldShortcut = this.config.shortcut;
    this.config = { ...this.config, ...config };

    // Re-register shortcut if changed
    if (oldShortcut !== this.config.shortcut) {
      globalShortcut.unregister(oldShortcut);
      this.registerShortcut();
    }

    // Restart polling if interval changed
    if (config.pollingInterval !== undefined) {
      this.stopPolling();
      this.startPolling();
    }

    logger.debug('Config updated', { config: this.config });
  }

  /**
   * Get current configuration
   */
  public getConfig(): ClipboardManagerConfig {
    return { ...this.config };
  }

  // ==========================================================================
  // History Management
  // ==========================================================================

  /**
   * Get clipboard history
   */
  public getHistory(
    options: {
      limit?: number;
      includePinned?: boolean;
      type?: ClipboardContentType;
      search?: string;
    } = {}
  ): ClipboardEntry[] {
    let results = [...this.history];

    // Filter by type
    if (options.type) {
      results = results.filter((e) => e.type === options.type);
    }

    // Filter by search term
    if (options.search) {
      const search = options.search.toLowerCase();
      results = results.filter(
        (e) =>
          e.preview.toLowerCase().includes(search) ||
          (e.text && e.text.toLowerCase().includes(search))
      );
    }

    // Sort: pinned first, then by timestamp
    results.sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return b.timestamp - a.timestamp;
    });

    // Apply limit
    if (options.limit && options.limit > 0) {
      results = results.slice(0, options.limit);
    }

    return results;
  }

  /**
   * Get a specific entry by ID
   */
  public getEntry(id: string): ClipboardEntry | undefined {
    return this.history.find((e) => e.id === id);
  }

  /**
   * Get entry by index (1-based for voice commands)
   */
  public getEntryByIndex(index: number): ClipboardEntry | undefined {
    const sorted = this.getHistory();
    return sorted[index - 1];
  }

  /**
   * Add entry to history manually
   */
  public addEntry(
    content: string | { base64: string; width: number; height: number },
    type: ClipboardContentType = 'text'
  ): ClipboardEntry | null {
    if (typeof content === 'string') {
      return this.addTextEntry(content, type === 'html' ? content : undefined);
    } else {
      return this.addImageEntry(content.base64, content.width, content.height);
    }
  }

  /**
   * Remove entry from history
   */
  public removeEntry(id: string): boolean {
    const index = this.history.findIndex((e) => e.id === id);
    if (index === -1) {
      return false;
    }

    // Cannot remove pinned items without unpinning first
    if (this.history[index].pinned) {
      logger.warn('Cannot remove pinned item', { id });
      return false;
    }

    this.history.splice(index, 1);
    this.emit('entry-removed', id);
    this.saveHistory().catch((err) =>
      logger.warn('Failed to save history', { error: err.message })
    );

    logger.debug('Entry removed', { id });
    return true;
  }

  /**
   * Pin or unpin an entry
   */
  public togglePin(id: string): boolean {
    const entry = this.history.find((e) => e.id === id);
    if (!entry) {
      return false;
    }

    entry.pinned = !entry.pinned;
    this.emit('entry-pinned', id, entry.pinned);
    this.saveHistory().catch((err) =>
      logger.warn('Failed to save history', { error: err.message })
    );

    logger.debug('Entry pin toggled', { id, pinned: entry.pinned });
    return true;
  }

  /**
   * Clear history (keeps pinned items)
   */
  public clearHistory(includePinned: boolean = false): number {
    const before = this.history.length;

    if (includePinned) {
      this.history = [];
    } else {
      this.history = this.history.filter((e) => e.pinned);
    }

    const removed = before - this.history.length;
    this.emit('history-cleared');
    this.saveHistory().catch((err) =>
      logger.warn('Failed to save history', { error: err.message })
    );

    logger.info('History cleared', { removed, remaining: this.history.length });
    return removed;
  }

  /**
   * Paste a specific entry to clipboard
   */
  public pasteEntry(id: string): boolean {
    const entry = this.history.find((e) => e.id === id);
    if (!entry) {
      return false;
    }

    return this.pasteToClipboard(entry);
  }

  /**
   * Paste entry by index (1-based)
   */
  public pasteByIndex(index: number): boolean {
    const entry = this.getEntryByIndex(index);
    if (!entry) {
      return false;
    }

    return this.pasteToClipboard(entry);
  }

  /**
   * Get history statistics
   */
  public getStats(): {
    totalEntries: number;
    pinnedEntries: number;
    textEntries: number;
    imageEntries: number;
    totalSize: number;
    oldestEntry: number | null;
    newestEntry: number | null;
  } {
    const textEntries = this.history.filter((e) => e.type === 'text' || e.type === 'html').length;
    const imageEntries = this.history.filter((e) => e.type === 'image').length;
    const totalSize = this.history.reduce((sum, e) => sum + e.size, 0);
    const timestamps = this.history.map((e) => e.timestamp);

    return {
      totalEntries: this.history.length,
      pinnedEntries: this.history.filter((e) => e.pinned).length,
      textEntries,
      imageEntries,
      totalSize,
      oldestEntry: timestamps.length > 0 ? Math.min(...timestamps) : null,
      newestEntry: timestamps.length > 0 ? Math.max(...timestamps) : null,
    };
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Start polling for clipboard changes
   */
  private startPolling(): void {
    if (this.pollingTimer) {
      return;
    }

    this.pollingTimer = setInterval(() => {
      this.checkClipboardChange();
    }, this.config.pollingInterval);

    logger.debug('Clipboard polling started', { interval: this.config.pollingInterval });
  }

  /**
   * Stop polling
   */
  private stopPolling(): void {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
      logger.debug('Clipboard polling stopped');
    }
  }

  /**
   * Check for clipboard changes
   */
  private checkClipboardChange(): void {
    try {
      const currentHash = this.computeCurrentHash();

      if (currentHash !== this.lastContentHash && currentHash !== '') {
        this.lastContentHash = currentHash;
        this.captureClipboardContent();
      }
    } catch (error) {
      logger.error('Error checking clipboard', { error: (error as Error).message });
    }
  }

  /**
   * Compute hash of current clipboard content
   */
  private computeCurrentHash(): string {
    try {
      const text = clipboard.readText();
      const image = clipboard.readImage();

      if (text) {
        return crypto.createHash('sha256').update(text).digest('hex');
      } else if (!image.isEmpty()) {
        const buffer = image.toPNG();
        return crypto.createHash('sha256').update(buffer).digest('hex');
      }

      return '';
    } catch {
      return '';
    }
  }

  /**
   * Capture current clipboard content
   */
  private captureClipboardContent(): void {
    try {
      const formats = clipboard.availableFormats();
      const hasText = formats.some((f) => f.startsWith('text/'));
      const hasImage = formats.some((f) => f.startsWith('image/'));

      // Check for text content
      if (hasText) {
        const text = clipboard.readText();
        const html = clipboard.readHTML();

        if (text && text.length > 0) {
          const entry = this.addTextEntry(text, html || undefined);
          if (entry) {
            this.emit('clipboard-changed', entry);
          }
        }
      }
      // Check for image content
      else if (hasImage && this.config.enableImageHistory) {
        const image = clipboard.readImage();
        if (!image.isEmpty()) {
          const size = image.getSize();
          const buffer = image.toPNG();

          if (buffer.length <= this.config.maxImageSize) {
            const entry = this.addImageEntry(buffer.toString('base64'), size.width, size.height);
            if (entry) {
              this.emit('clipboard-changed', entry);
            }
          }
        }
      }
    } catch (error) {
      logger.error('Error capturing clipboard', { error: (error as Error).message });
    }
  }

  /**
   * Add text entry to history
   */
  private addTextEntry(text: string, html?: string): ClipboardEntry | null {
    // Check size limit
    const size = Buffer.byteLength(text, 'utf-8');
    if (size > this.config.maxItemSize) {
      logger.debug('Text too large, skipping', { size });
      return null;
    }

    // Check for sensitive content
    const isSensitive = this.detectSensitiveContent(text);
    if (isSensitive && this.config.excludeSensitiveContent) {
      logger.info('Sensitive content detected, excluding from history');
      const entry = this.createEntry('text', text, html, size, isSensitive);
      this.emit('sensitive-detected', entry);
      return null;
    }

    // Check for duplicates
    const hash = crypto.createHash('sha256').update(text).digest('hex');
    const existing = this.history.find((e) => e.contentHash === hash);
    if (existing) {
      // Move to front by updating timestamp
      existing.timestamp = Date.now();
      this.saveHistory().catch(() => {});
      return existing;
    }

    // Create entry
    const entry = this.createEntry(html ? 'html' : 'text', text, html, size, isSensitive, hash);

    // Add to history
    this.history.unshift(entry);
    this.enforceHistoryLimit();
    this.emit('entry-added', entry);
    this.saveHistory().catch((err) =>
      logger.warn('Failed to save history', { error: err.message })
    );

    logger.debug('Text entry added', { id: entry.id, size, type: entry.type });
    return entry;
  }

  /**
   * Add image entry to history
   */
  private addImageEntry(base64: string, width: number, height: number): ClipboardEntry | null {
    const size = Math.ceil((base64.length * 3) / 4);

    if (size > this.config.maxImageSize) {
      logger.debug('Image too large, skipping', { size });
      return null;
    }

    // Check for duplicates
    const hash = crypto.createHash('sha256').update(base64).digest('hex');
    const existing = this.history.find((e) => e.contentHash === hash);
    if (existing) {
      existing.timestamp = Date.now();
      this.saveHistory().catch(() => {});
      return existing;
    }

    // Create entry
    const entry: ClipboardEntry = {
      id: crypto.randomUUID(),
      type: 'image',
      imageBase64: base64,
      imageSize: { width, height },
      preview: `Image (${width}x${height})`,
      timestamp: Date.now(),
      pinned: false,
      contentHash: hash,
      size,
      isSensitive: false,
    };

    // Add to history
    this.history.unshift(entry);
    this.enforceHistoryLimit();
    this.emit('entry-added', entry);
    this.saveHistory().catch((err) =>
      logger.warn('Failed to save history', { error: err.message })
    );

    logger.debug('Image entry added', { id: entry.id, size, dimensions: `${width}x${height}` });
    return entry;
  }

  /**
   * Create a clipboard entry object
   */
  private createEntry(
    type: ClipboardContentType,
    text: string,
    html?: string,
    size: number = 0,
    isSensitive: boolean = false,
    hash?: string
  ): ClipboardEntry {
    // Generate preview
    const preview = this.generatePreview(text);

    return {
      id: crypto.randomUUID(),
      type,
      text,
      html,
      preview,
      timestamp: Date.now(),
      pinned: false,
      contentHash: hash || crypto.createHash('sha256').update(text).digest('hex'),
      size: size || Buffer.byteLength(text, 'utf-8'),
      isSensitive,
    };
  }

  /**
   * Generate preview text
   */
  private generatePreview(text: string): string {
    // Remove excessive whitespace
    const cleaned = text.replace(/\s+/g, ' ').trim();

    if (cleaned.length <= this.config.previewLength) {
      return cleaned;
    }

    return cleaned.slice(0, this.config.previewLength - 3) + '...';
  }

  /**
   * Detect sensitive content
   */
  private detectSensitiveContent(text: string): boolean {
    if (!this.config.detectSensitiveContent) {
      return false;
    }

    // Check patterns
    for (const pattern of SENSITIVE_PATTERNS) {
      if (pattern.test(text)) {
        logger.debug('Sensitive pattern matched');
        return true;
      }
    }

    // Check keywords (case-insensitive)
    const lowerText = text.toLowerCase();
    for (const keyword of SENSITIVE_KEYWORDS) {
      // Look for keyword followed by = or : and some value
      const keywordPattern = new RegExp(`${keyword}\\s*[=:]\\s*.{4,}`, 'i');
      if (keywordPattern.test(lowerText)) {
        logger.debug('Sensitive keyword matched', { keyword });
        return true;
      }
    }

    return false;
  }

  /**
   * Enforce history size limit
   */
  private enforceHistoryLimit(): void {
    // Count non-pinned items
    const nonPinned = this.history.filter((e) => !e.pinned);

    if (nonPinned.length > this.config.maxHistorySize) {
      // Remove oldest non-pinned items
      const toRemove = nonPinned.length - this.config.maxHistorySize;
      let removed = 0;

      for (let i = this.history.length - 1; i >= 0 && removed < toRemove; i--) {
        if (!this.history[i].pinned) {
          const entry = this.history.splice(i, 1)[0];
          this.emit('entry-removed', entry.id);
          removed++;
        }
      }

      logger.debug('History limit enforced', { removed });
    }
  }

  /**
   * Paste entry to clipboard
   */
  private pasteToClipboard(entry: ClipboardEntry): boolean {
    try {
      if (entry.type === 'image' && entry.imageBase64) {
        const buffer = Buffer.from(entry.imageBase64, 'base64');
        const image = nativeImage.createFromBuffer(buffer);
        clipboard.writeImage(image);
      } else if (entry.text) {
        if (entry.html) {
          clipboard.write({
            text: entry.text,
            html: entry.html,
          });
        } else {
          clipboard.writeText(entry.text);
        }
      } else {
        return false;
      }

      // Update timestamp and move to front
      entry.timestamp = Date.now();
      const index = this.history.indexOf(entry);
      if (index > 0) {
        this.history.splice(index, 1);
        this.history.unshift(entry);
      }

      this.lastContentHash = entry.contentHash;
      this.saveHistory().catch(() => {});

      logger.debug('Entry pasted to clipboard', { id: entry.id });
      return true;
    } catch (error) {
      logger.error('Failed to paste entry', { error: (error as Error).message });
      return false;
    }
  }

  /**
   * Register keyboard shortcut
   */
  private registerShortcut(): void {
    try {
      const success = globalShortcut.register(this.config.shortcut, () => {
        this.showHistoryUI();
      });

      if (success) {
        logger.debug('Shortcut registered', { shortcut: this.config.shortcut });
      } else {
        logger.warn('Failed to register shortcut', { shortcut: this.config.shortcut });
      }
    } catch (error) {
      logger.error('Error registering shortcut', { error: (error as Error).message });
    }
  }

  /**
   * Show clipboard history UI
   */
  private showHistoryUI(): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('atlas:show-clipboard-history');
      this.mainWindow.show();
      this.mainWindow.focus();
    }
  }

  /**
   * Load history from disk
   */
  private async loadHistory(): Promise<void> {
    try {
      const data = await fs.readFile(this.HISTORY_FILE, 'utf-8');
      const parsed = JSON.parse(data);

      if (Array.isArray(parsed.history)) {
        // Filter out expired image entries (older than 7 days)
        const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        this.history = parsed.history.filter((entry: ClipboardEntry) => {
          // Keep pinned items regardless of age
          if (entry.pinned) return true;
          // Keep text items regardless of age
          if (entry.type !== 'image') return true;
          // Keep recent images
          return entry.timestamp > sevenDaysAgo;
        });

        logger.debug('History loaded', { entries: this.history.length });
      }
    } catch {
      // No history file or invalid data
      logger.debug('No history file found, starting fresh');
    }
  }

  /**
   * Save history to disk
   */
  private async saveHistory(): Promise<void> {
    try {
      // Don't save image data for non-pinned items to reduce file size
      const historyToSave = this.history.map((entry) => {
        if (entry.type === 'image' && !entry.pinned) {
          // Only save metadata for non-pinned images
          return {
            ...entry,
            imageBase64: undefined,
          };
        }
        return entry;
      });

      await fs.writeFile(
        this.HISTORY_FILE,
        JSON.stringify({ history: historyToSave }, null, 2),
        'utf-8'
      );
    } catch (error) {
      logger.error('Failed to save history', { error: (error as Error).message });
    }
  }

  /**
   * Shutdown the clipboard manager
   */
  public async shutdown(): Promise<void> {
    this.stopPolling();

    try {
      globalShortcut.unregister(this.config.shortcut);
    } catch {
      // Ignore errors during shutdown
    }

    await this.saveHistory();
    this.initialized = false;
    logger.info('Clipboard manager shutdown');
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

let clipboardManagerInstance: ClipboardManager | null = null;

/**
 * Get the clipboard manager instance
 */
export function getClipboardManager(config?: Partial<ClipboardManagerConfig>): ClipboardManager {
  if (!clipboardManagerInstance) {
    clipboardManagerInstance = ClipboardManager.getInstance(config);
  }
  return clipboardManagerInstance;
}

/**
 * Initialize the clipboard manager
 */
export async function initializeClipboardManager(
  mainWindow?: BrowserWindow,
  config?: Partial<ClipboardManagerConfig>
): Promise<ClipboardManager> {
  const manager = getClipboardManager(config);
  await manager.initialize(mainWindow);
  return manager;
}

/**
 * Shutdown the clipboard manager
 */
export async function shutdownClipboardManager(): Promise<void> {
  if (clipboardManagerInstance) {
    await clipboardManagerInstance.shutdown();
    clipboardManagerInstance = null;
  }
}

export default ClipboardManager;
