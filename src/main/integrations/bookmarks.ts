/**
 * Atlas Desktop - Browser Bookmarks Integration
 *
 * Provides access to browser bookmarks from Chrome, Firefox, and Edge.
 * Supports searching, opening, and suggesting bookmarks based on context.
 *
 * @module integrations/bookmarks
 */

import { readFile, readdir, access } from 'fs/promises';
import { constants as fsConstants } from 'fs';
import { join, basename } from 'path';
import { homedir, platform } from 'os';
import { shell } from 'electron';
import { AgentTool, ActionResult } from '../../shared/types/agent';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('Bookmarks');

// ============================================================================
// Types & Interfaces
// ============================================================================

/**
 * Supported browser types
 */
export type BrowserType = 'chrome' | 'firefox' | 'edge' | 'brave' | 'opera' | 'vivaldi';

/**
 * Bookmark entry representing a single bookmark
 */
export interface Bookmark {
  /** Unique identifier */
  id: string;
  /** Bookmark title/name */
  title: string;
  /** Bookmark URL */
  url: string;
  /** Folder path (e.g., "Bookmarks Bar/Work") */
  folder: string;
  /** Source browser */
  browser: BrowserType;
  /** Browser profile name */
  profile: string;
  /** Date added (Unix timestamp in microseconds for Chrome, seconds for Firefox) */
  dateAdded?: number;
  /** Last modified date */
  dateModified?: number;
  /** Favicon URL (if available) */
  favicon?: string;
  /** Tags (Firefox only) */
  tags?: string[];
}

/**
 * Bookmark folder structure
 */
export interface BookmarkFolder {
  /** Folder name */
  name: string;
  /** Full folder path */
  path: string;
  /** Child bookmarks */
  bookmarks: Bookmark[];
  /** Child folders */
  children: BookmarkFolder[];
}

/**
 * Search options for bookmark queries
 */
export interface BookmarkSearchOptions {
  /** Search query string */
  query: string;
  /** Filter by browser(s) */
  browsers?: BrowserType[];
  /** Filter by folder path (partial match) */
  folder?: string;
  /** Filter by profile name */
  profile?: string;
  /** Maximum results to return */
  limit?: number;
  /** Search in titles only */
  titleOnly?: boolean;
  /** Case-sensitive search */
  caseSensitive?: boolean;
}

/**
 * Search result with relevance score
 */
export interface BookmarkSearchResult extends Bookmark {
  /** Relevance score (0-1) */
  score: number;
  /** Matched field(s) */
  matchedFields: ('title' | 'url' | 'folder' | 'tags')[];
}

/**
 * Browser profile information
 */
export interface BrowserProfile {
  /** Browser type */
  browser: BrowserType;
  /** Profile name */
  name: string;
  /** Profile directory path */
  path: string;
  /** Whether this is the default profile */
  isDefault: boolean;
}

/**
 * Bookmark statistics
 */
export interface BookmarkStats {
  /** Total bookmark count */
  totalBookmarks: number;
  /** Bookmarks per browser */
  byBrowser: Record<BrowserType, number>;
  /** Bookmarks per profile */
  byProfile: Record<string, number>;
  /** Folder count */
  totalFolders: number;
  /** Most recent bookmark date */
  newestBookmark?: Date;
  /** Oldest bookmark date */
  oldestBookmark?: Date;
}

// ============================================================================
// Browser Path Configuration
// ============================================================================

/**
 * Get browser data paths based on platform
 */
function getBrowserPaths(): Record<BrowserType, string[]> {
  const home = homedir();
  const os = platform();

  if (os === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || join(home, 'AppData', 'Local');
    const appData = process.env.APPDATA || join(home, 'AppData', 'Roaming');

    return {
      chrome: [join(localAppData, 'Google', 'Chrome', 'User Data')],
      edge: [join(localAppData, 'Microsoft', 'Edge', 'User Data')],
      firefox: [join(appData, 'Mozilla', 'Firefox', 'Profiles')],
      brave: [join(localAppData, 'BraveSoftware', 'Brave-Browser', 'User Data')],
      opera: [join(appData, 'Opera Software', 'Opera Stable')],
      vivaldi: [join(localAppData, 'Vivaldi', 'User Data')],
    };
  } else if (os === 'darwin') {
    return {
      chrome: [join(home, 'Library', 'Application Support', 'Google', 'Chrome')],
      edge: [join(home, 'Library', 'Application Support', 'Microsoft Edge')],
      firefox: [join(home, 'Library', 'Application Support', 'Firefox', 'Profiles')],
      brave: [join(home, 'Library', 'Application Support', 'BraveSoftware', 'Brave-Browser')],
      opera: [join(home, 'Library', 'Application Support', 'com.operasoftware.Opera')],
      vivaldi: [join(home, 'Library', 'Application Support', 'Vivaldi')],
    };
  } else {
    // Linux
    return {
      chrome: [
        join(home, '.config', 'google-chrome'),
        join(home, '.config', 'chromium'),
      ],
      edge: [join(home, '.config', 'microsoft-edge')],
      firefox: [join(home, '.mozilla', 'firefox')],
      brave: [join(home, '.config', 'BraveSoftware', 'Brave-Browser')],
      opera: [join(home, '.config', 'opera')],
      vivaldi: [join(home, '.config', 'vivaldi')],
    };
  }
}

// ============================================================================
// Chromium-based Browser Parser (Chrome, Edge, Brave, Opera, Vivaldi)
// ============================================================================

/**
 * Parse Chromium bookmark JSON structure
 */
interface ChromiumBookmarkNode {
  type: 'url' | 'folder';
  name: string;
  url?: string;
  date_added?: string;
  date_modified?: string;
  children?: ChromiumBookmarkNode[];
  meta_info?: {
    last_visited_desktop?: string;
  };
}

interface ChromiumBookmarkFile {
  roots: {
    bookmark_bar: ChromiumBookmarkNode;
    other: ChromiumBookmarkNode;
    synced?: ChromiumBookmarkNode;
  };
  version: number;
}

/**
 * Recursively parse Chromium bookmark node
 */
function parseChromiumNode(
  node: ChromiumBookmarkNode,
  browser: BrowserType,
  profile: string,
  folderPath: string = ''
): { bookmarks: Bookmark[]; folders: string[] } {
  const bookmarks: Bookmark[] = [];
  const folders: string[] = [];
  const currentPath = folderPath ? `${folderPath}/${node.name}` : node.name;

  if (node.type === 'url' && node.url) {
    bookmarks.push({
      id: `${browser}-${profile}-${node.date_added || Date.now()}`,
      title: node.name,
      url: node.url,
      folder: folderPath,
      browser,
      profile,
      dateAdded: node.date_added ? parseInt(node.date_added, 10) : undefined,
      dateModified: node.date_modified ? parseInt(node.date_modified, 10) : undefined,
    });
  } else if (node.type === 'folder' && node.children) {
    folders.push(currentPath);
    for (const child of node.children) {
      const result = parseChromiumNode(child, browser, profile, currentPath);
      bookmarks.push(...result.bookmarks);
      folders.push(...result.folders);
    }
  }

  return { bookmarks, folders };
}

/**
 * Read bookmarks from Chromium-based browser
 */
async function readChromiumBookmarks(
  browser: BrowserType,
  profilePath: string,
  profileName: string
): Promise<Bookmark[]> {
  const bookmarksFile = join(profilePath, 'Bookmarks');

  try {
    await access(bookmarksFile, fsConstants.R_OK);
    const content = await readFile(bookmarksFile, 'utf-8');
    const data: ChromiumBookmarkFile = JSON.parse(content);

    const allBookmarks: Bookmark[] = [];

    // Parse bookmark bar
    if (data.roots.bookmark_bar) {
      const result = parseChromiumNode(
        data.roots.bookmark_bar,
        browser,
        profileName,
        'Bookmarks Bar'
      );
      allBookmarks.push(...result.bookmarks);
    }

    // Parse other bookmarks
    if (data.roots.other) {
      const result = parseChromiumNode(data.roots.other, browser, profileName, 'Other Bookmarks');
      allBookmarks.push(...result.bookmarks);
    }

    // Parse synced bookmarks (if present)
    if (data.roots.synced) {
      const result = parseChromiumNode(data.roots.synced, browser, profileName, 'Mobile Bookmarks');
      allBookmarks.push(...result.bookmarks);
    }

    logger.debug(`Loaded ${allBookmarks.length} bookmarks from ${browser}/${profileName}`);
    return allBookmarks;
  } catch (error) {
    logger.debug(`Could not read bookmarks from ${bookmarksFile}: ${(error as Error).message}`);
    return [];
  }
}

/**
 * Get Chromium browser profiles
 */
async function getChromiumProfiles(browser: BrowserType, basePath: string): Promise<BrowserProfile[]> {
  const profiles: BrowserProfile[] = [];

  try {
    await access(basePath, fsConstants.R_OK);
    const entries = await readdir(basePath, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      // Check for Default profile or Profile N directories
      if (entry.name === 'Default' || entry.name.startsWith('Profile ')) {
        const profilePath = join(basePath, entry.name);
        const bookmarksFile = join(profilePath, 'Bookmarks');

        try {
          await access(bookmarksFile, fsConstants.R_OK);
          profiles.push({
            browser,
            name: entry.name,
            path: profilePath,
            isDefault: entry.name === 'Default',
          });
        } catch {
          // Profile exists but no bookmarks file
        }
      }
    }
  } catch (error) {
    logger.debug(`Could not access ${browser} profiles at ${basePath}: ${(error as Error).message}`);
  }

  return profiles;
}

// ============================================================================
// Firefox Browser Parser
// ============================================================================

/**
 * Firefox places.sqlite bookmark type constants
 */
const FIREFOX_BOOKMARK_TYPE = {
  BOOKMARK: 1,
  FOLDER: 2,
  SEPARATOR: 3,
  DYNAMIC_CONTAINER: 4,
};

/**
 * Read bookmarks from Firefox using places.sqlite
 * Note: Firefox uses SQLite, but we'll try JSON backup first
 */
async function readFirefoxBookmarks(profilePath: string, profileName: string): Promise<Bookmark[]> {
  const bookmarks: Bookmark[] = [];

  // Try to read from bookmarkbackups (JSON format)
  const backupDir = join(profilePath, 'bookmarkbackups');

  try {
    await access(backupDir, fsConstants.R_OK);
    const backupFiles = await readdir(backupDir);

    // Find most recent backup (filename format: bookmarks-YYYY-MM-DD_N_hash.jsonlz4)
    const jsonBackups = backupFiles
      .filter((f) => f.endsWith('.json') || f.endsWith('.jsonlz4'))
      .sort()
      .reverse();

    if (jsonBackups.length > 0) {
      const latestBackup = join(backupDir, jsonBackups[0]);

      // Only read plain JSON backups (jsonlz4 requires decompression)
      if (latestBackup.endsWith('.json')) {
        const content = await readFile(latestBackup, 'utf-8');
        const data = JSON.parse(content);
        parseFirefoxBookmarkNode(data, profileName, '', bookmarks);
      }
    }
  } catch (error) {
    logger.debug(`Could not read Firefox bookmarks from ${profilePath}: ${(error as Error).message}`);
  }

  // If no backups found, try reading places.sqlite directly
  // Note: This is complex and may fail if Firefox is running (database locked)
  // For production, consider using better-sqlite3 or sql.js

  return bookmarks;
}

/**
 * Parse Firefox bookmark JSON node
 */
interface FirefoxBookmarkNode {
  type?: string;
  typeCode?: number;
  title?: string;
  uri?: string;
  dateAdded?: number;
  lastModified?: number;
  children?: FirefoxBookmarkNode[];
  tags?: string;
}

function parseFirefoxBookmarkNode(
  node: FirefoxBookmarkNode,
  profile: string,
  folderPath: string,
  bookmarks: Bookmark[]
): void {
  const typeCode = node.typeCode || (node.type === 'text/x-moz-place' ? 1 : 2);
  const title = node.title || '';
  const currentPath = folderPath ? `${folderPath}/${title}` : title;

  if (typeCode === FIREFOX_BOOKMARK_TYPE.BOOKMARK && node.uri) {
    // Skip internal Firefox URIs
    if (!node.uri.startsWith('place:') && !node.uri.startsWith('about:')) {
      bookmarks.push({
        id: `firefox-${profile}-${node.dateAdded || Date.now()}`,
        title: title,
        url: node.uri,
        folder: folderPath,
        browser: 'firefox',
        profile,
        dateAdded: node.dateAdded,
        dateModified: node.lastModified,
        tags: node.tags ? node.tags.split(',').map((t) => t.trim()) : undefined,
      });
    }
  } else if (typeCode === FIREFOX_BOOKMARK_TYPE.FOLDER && node.children) {
    for (const child of node.children) {
      parseFirefoxBookmarkNode(child, profile, currentPath, bookmarks);
    }
  }
}

/**
 * Get Firefox profiles from profiles.ini
 */
async function getFirefoxProfiles(basePath: string): Promise<BrowserProfile[]> {
  const profiles: BrowserProfile[] = [];

  try {
    // Firefox stores profiles in a profiles.ini file at the parent level
    const profilesIniPath = join(basePath, '..', 'profiles.ini');
    let profileDirs: string[] = [];

    try {
      const iniContent = await readFile(profilesIniPath, 'utf-8');
      // Simple INI parsing for profile paths
      const lines = iniContent.split('\n');
      let currentPath = '';
      let isRelative = true;

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('Path=')) {
          currentPath = trimmed.substring(5);
        } else if (trimmed.startsWith('IsRelative=')) {
          isRelative = trimmed.substring(11) === '1';
        } else if (trimmed.startsWith('[Profile')) {
          if (currentPath) {
            const fullPath = isRelative ? join(basePath, '..', currentPath) : currentPath;
            profileDirs.push(fullPath);
          }
          currentPath = '';
          isRelative = true;
        }
      }
      // Don't forget the last profile
      if (currentPath) {
        const fullPath = isRelative ? join(basePath, '..', currentPath) : currentPath;
        profileDirs.push(fullPath);
      }
    } catch {
      // If profiles.ini doesn't exist, try direct directory listing
      const entries = await readdir(basePath, { withFileTypes: true });
      profileDirs = entries
        .filter((e) => e.isDirectory())
        .map((e) => join(basePath, e.name));
    }

    for (const profilePath of profileDirs) {
      try {
        await access(profilePath, fsConstants.R_OK);
        profiles.push({
          browser: 'firefox',
          name: basename(profilePath),
          path: profilePath,
          isDefault: basename(profilePath).includes('default'),
        });
      } catch {
        // Profile directory not accessible
      }
    }
  } catch (error) {
    logger.debug(`Could not get Firefox profiles: ${(error as Error).message}`);
  }

  return profiles;
}

// ============================================================================
// Bookmark Manager Class
// ============================================================================

/**
 * Bookmark Manager - central class for bookmark operations
 */
export class BookmarkManager {
  private bookmarks: Bookmark[] = [];
  private lastUpdate: Date | null = null;
  private updateInProgress = false;
  private cacheTimeout = 5 * 60 * 1000; // 5 minutes cache

  /**
   * Get all bookmarks, refreshing cache if necessary
   */
  async getAllBookmarks(forceRefresh = false): Promise<Bookmark[]> {
    if (
      !forceRefresh &&
      this.lastUpdate &&
      Date.now() - this.lastUpdate.getTime() < this.cacheTimeout
    ) {
      return this.bookmarks;
    }

    await this.refreshBookmarks();
    return this.bookmarks;
  }

  /**
   * Refresh bookmarks from all browsers
   */
  async refreshBookmarks(): Promise<void> {
    if (this.updateInProgress) {
      logger.debug('Bookmark refresh already in progress, skipping');
      return;
    }

    this.updateInProgress = true;
    const startTime = Date.now();

    try {
      const allBookmarks: Bookmark[] = [];
      const browserPaths = getBrowserPaths();

      // Process each browser
      for (const [browserName, paths] of Object.entries(browserPaths)) {
        const browser = browserName as BrowserType;

        for (const basePath of paths) {
          try {
            await access(basePath, fsConstants.R_OK);

            if (browser === 'firefox') {
              const profiles = await getFirefoxProfiles(basePath);
              for (const profile of profiles) {
                const bookmarks = await readFirefoxBookmarks(profile.path, profile.name);
                allBookmarks.push(...bookmarks);
              }
            } else {
              // Chromium-based browsers
              const profiles = await getChromiumProfiles(browser, basePath);
              for (const profile of profiles) {
                const bookmarks = await readChromiumBookmarks(browser, profile.path, profile.name);
                allBookmarks.push(...bookmarks);
              }
            }
          } catch {
            // Browser not installed or not accessible
          }
        }
      }

      this.bookmarks = allBookmarks;
      this.lastUpdate = new Date();

      const duration = Date.now() - startTime;
      logger.info(`Bookmark refresh complete: ${allBookmarks.length} bookmarks in ${duration}ms`);
    } finally {
      this.updateInProgress = false;
    }
  }

  /**
   * Search bookmarks with advanced options
   */
  async search(options: BookmarkSearchOptions): Promise<BookmarkSearchResult[]> {
    const bookmarks = await this.getAllBookmarks();
    const query = options.caseSensitive ? options.query : options.query.toLowerCase();
    const results: BookmarkSearchResult[] = [];

    for (const bookmark of bookmarks) {
      // Apply browser filter
      if (options.browsers && !options.browsers.includes(bookmark.browser)) {
        continue;
      }

      // Apply profile filter
      if (options.profile && bookmark.profile !== options.profile) {
        continue;
      }

      // Apply folder filter
      if (options.folder) {
        const folderLower = options.caseSensitive ? bookmark.folder : bookmark.folder.toLowerCase();
        const filterLower = options.caseSensitive ? options.folder : options.folder.toLowerCase();
        if (!folderLower.includes(filterLower)) {
          continue;
        }
      }

      // Calculate match score
      const matchResult = this.calculateMatchScore(bookmark, query, options);
      if (matchResult.score > 0) {
        results.push({
          ...bookmark,
          score: matchResult.score,
          matchedFields: matchResult.matchedFields,
        });
      }
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);

    // Apply limit
    const limit = options.limit || 20;
    return results.slice(0, limit);
  }

  /**
   * Calculate match score for a bookmark
   */
  private calculateMatchScore(
    bookmark: Bookmark,
    query: string,
    options: BookmarkSearchOptions
  ): { score: number; matchedFields: ('title' | 'url' | 'folder' | 'tags')[] } {
    let score = 0;
    const matchedFields: ('title' | 'url' | 'folder' | 'tags')[] = [];
    const caseSensitive = options.caseSensitive || false;

    const normalize = (s: string) => (caseSensitive ? s : s.toLowerCase());
    const queryWords = query.split(/\s+/).filter((w) => w.length > 0);

    // Title matching (highest weight)
    const title = normalize(bookmark.title);
    let titleScore = 0;
    for (const word of queryWords) {
      if (title.includes(word)) {
        titleScore += 0.3;
        if (title.startsWith(word)) titleScore += 0.2;
        if (title === word) titleScore += 0.3;
      }
    }
    if (titleScore > 0) {
      score += Math.min(titleScore, 1);
      matchedFields.push('title');
    }

    // URL matching (if not title-only)
    if (!options.titleOnly) {
      const url = normalize(bookmark.url);
      let urlScore = 0;
      for (const word of queryWords) {
        if (url.includes(word)) {
          urlScore += 0.2;
        }
      }
      if (urlScore > 0) {
        score += Math.min(urlScore, 0.5);
        matchedFields.push('url');
      }

      // Folder matching
      const folder = normalize(bookmark.folder);
      let folderScore = 0;
      for (const word of queryWords) {
        if (folder.includes(word)) {
          folderScore += 0.15;
        }
      }
      if (folderScore > 0) {
        score += Math.min(folderScore, 0.3);
        matchedFields.push('folder');
      }

      // Tags matching (Firefox)
      if (bookmark.tags && bookmark.tags.length > 0) {
        const tags = bookmark.tags.map(normalize);
        let tagScore = 0;
        for (const word of queryWords) {
          if (tags.some((t) => t.includes(word))) {
            tagScore += 0.25;
          }
        }
        if (tagScore > 0) {
          score += Math.min(tagScore, 0.4);
          matchedFields.push('tags');
        }
      }
    }

    return { score: Math.min(score, 1), matchedFields };
  }

  /**
   * Get bookmarks by folder
   */
  async getByFolder(folder: string): Promise<Bookmark[]> {
    const bookmarks = await this.getAllBookmarks();
    return bookmarks.filter((b) => b.folder.toLowerCase().includes(folder.toLowerCase()));
  }

  /**
   * Get bookmarks by browser
   */
  async getByBrowser(browser: BrowserType): Promise<Bookmark[]> {
    const bookmarks = await this.getAllBookmarks();
    return bookmarks.filter((b) => b.browser === browser);
  }

  /**
   * Get bookmark statistics
   */
  async getStats(): Promise<BookmarkStats> {
    const bookmarks = await this.getAllBookmarks();

    const byBrowser: Record<BrowserType, number> = {
      chrome: 0,
      firefox: 0,
      edge: 0,
      brave: 0,
      opera: 0,
      vivaldi: 0,
    };

    const byProfile: Record<string, number> = {};
    const folders = new Set<string>();
    let newestDate: number | undefined;
    let oldestDate: number | undefined;

    for (const bookmark of bookmarks) {
      byBrowser[bookmark.browser]++;
      byProfile[`${bookmark.browser}/${bookmark.profile}`] =
        (byProfile[`${bookmark.browser}/${bookmark.profile}`] || 0) + 1;
      folders.add(bookmark.folder);

      if (bookmark.dateAdded) {
        if (!newestDate || bookmark.dateAdded > newestDate) {
          newestDate = bookmark.dateAdded;
        }
        if (!oldestDate || bookmark.dateAdded < oldestDate) {
          oldestDate = bookmark.dateAdded;
        }
      }
    }

    return {
      totalBookmarks: bookmarks.length,
      byBrowser,
      byProfile,
      totalFolders: folders.size,
      newestBookmark: newestDate ? new Date(newestDate / 1000) : undefined, // Chrome uses microseconds
      oldestBookmark: oldestDate ? new Date(oldestDate / 1000) : undefined,
    };
  }

  /**
   * Get suggested bookmarks based on context
   */
  async getSuggestions(context: string, limit = 5): Promise<BookmarkSearchResult[]> {
    // Extract keywords from context
    const keywords = context
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3)
      .slice(0, 5);

    if (keywords.length === 0) {
      return [];
    }

    // Search for each keyword and combine results
    const allResults = new Map<string, BookmarkSearchResult>();

    for (const keyword of keywords) {
      const results = await this.search({
        query: keyword,
        limit: 10,
      });

      for (const result of results) {
        const existing = allResults.get(result.id);
        if (existing) {
          existing.score += result.score * 0.5; // Boost for multiple keyword matches
        } else {
          allResults.set(result.id, { ...result });
        }
      }
    }

    // Sort and limit
    return Array.from(allResults.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /**
   * Open a bookmark in the default browser
   */
  async openBookmark(bookmark: Bookmark): Promise<void> {
    await shell.openExternal(bookmark.url);
    logger.info('Opened bookmark', { title: bookmark.title, url: bookmark.url });
  }

  /**
   * Open a bookmark by URL
   */
  async openByUrl(url: string): Promise<boolean> {
    const bookmarks = await this.getAllBookmarks();
    const bookmark = bookmarks.find((b) => b.url === url);

    if (bookmark) {
      await this.openBookmark(bookmark);
      return true;
    }

    return false;
  }

  /**
   * Get all unique folders
   */
  async getFolders(): Promise<string[]> {
    const bookmarks = await this.getAllBookmarks();
    const folders = new Set<string>();

    for (const bookmark of bookmarks) {
      if (bookmark.folder) {
        folders.add(bookmark.folder);
      }
    }

    return Array.from(folders).sort();
  }

  /**
   * Get available browser profiles
   */
  async getProfiles(): Promise<BrowserProfile[]> {
    const profiles: BrowserProfile[] = [];
    const browserPaths = getBrowserPaths();

    for (const [browserName, paths] of Object.entries(browserPaths)) {
      const browser = browserName as BrowserType;

      for (const basePath of paths) {
        try {
          await access(basePath, fsConstants.R_OK);

          if (browser === 'firefox') {
            const firefoxProfiles = await getFirefoxProfiles(basePath);
            profiles.push(...firefoxProfiles);
          } else {
            const chromiumProfiles = await getChromiumProfiles(browser, basePath);
            profiles.push(...chromiumProfiles);
          }
        } catch {
          // Browser not installed
        }
      }
    }

    return profiles;
  }

  /**
   * Clear the bookmark cache
   */
  clearCache(): void {
    this.bookmarks = [];
    this.lastUpdate = null;
    logger.debug('Bookmark cache cleared');
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let bookmarkManagerInstance: BookmarkManager | null = null;

/**
 * Get the singleton BookmarkManager instance
 */
export function getBookmarkManager(): BookmarkManager {
  if (!bookmarkManagerInstance) {
    bookmarkManagerInstance = new BookmarkManager();
  }
  return bookmarkManagerInstance;
}

// ============================================================================
// Agent Tools
// ============================================================================

/**
 * Search bookmarks tool
 */
export const searchBookmarksTool: AgentTool = {
  name: 'bookmark_search',
  description:
    'Search browser bookmarks by title, URL, or folder. Returns matching bookmarks with relevance scores.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query string to find bookmarks',
      },
      browser: {
        type: 'string',
        description:
          'Filter by browser: "chrome", "firefox", "edge", "brave", "opera", "vivaldi" (optional)',
      },
      folder: {
        type: 'string',
        description: 'Filter by folder path (partial match, optional)',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results to return (default: 10)',
      },
    },
    required: ['query'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const manager = getBookmarkManager();
      const query = params.query as string;

      if (!query || query.trim().length === 0) {
        return { success: false, error: 'Search query cannot be empty' };
      }

      const searchOptions: BookmarkSearchOptions = {
        query: query.trim(),
        limit: (params.limit as number) || 10,
      };

      if (params.browser) {
        searchOptions.browsers = [params.browser as BrowserType];
      }

      if (params.folder) {
        searchOptions.folder = params.folder as string;
      }

      const results = await manager.search(searchOptions);

      logger.info('Bookmark search completed', { query, resultCount: results.length });

      return {
        success: true,
        data: {
          query,
          results: results.map((r) => ({
            title: r.title,
            url: r.url,
            folder: r.folder,
            browser: r.browser,
            score: Math.round(r.score * 100) / 100,
          })),
          totalResults: results.length,
        },
      };
    } catch (error) {
      const err = error as Error;
      logger.error('Bookmark search failed', { error: err.message });
      return { success: false, error: err.message };
    }
  },
};

/**
 * Open bookmark tool
 */
export const openBookmarkTool: AgentTool = {
  name: 'bookmark_open',
  description: 'Open a bookmark in the default browser by searching for it first.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query to find the bookmark to open',
      },
      url: {
        type: 'string',
        description: 'Direct URL of the bookmark to open (optional, overrides query)',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const manager = getBookmarkManager();

      // Direct URL provided
      if (params.url) {
        const url = params.url as string;
        await shell.openExternal(url);
        logger.info('Opened bookmark URL directly', { url });
        return {
          success: true,
          data: { url, opened: true },
        };
      }

      // Search and open first result
      const query = params.query as string;
      if (!query || query.trim().length === 0) {
        return { success: false, error: 'Either query or url must be provided' };
      }

      const results = await manager.search({ query: query.trim(), limit: 1 });

      if (results.length === 0) {
        return { success: false, error: `No bookmark found matching: ${query}` };
      }

      const bookmark = results[0];
      await manager.openBookmark(bookmark);

      return {
        success: true,
        data: {
          title: bookmark.title,
          url: bookmark.url,
          folder: bookmark.folder,
          browser: bookmark.browser,
          opened: true,
        },
      };
    } catch (error) {
      const err = error as Error;
      logger.error('Open bookmark failed', { error: err.message });
      return { success: false, error: err.message };
    }
  },
};

/**
 * List bookmarks tool
 */
export const listBookmarksTool: AgentTool = {
  name: 'bookmark_list',
  description:
    'List all bookmarks, optionally filtered by browser or folder. Returns bookmark statistics.',
  parameters: {
    type: 'object',
    properties: {
      browser: {
        type: 'string',
        description: 'Filter by browser (optional)',
      },
      folder: {
        type: 'string',
        description: 'Filter by folder path (optional)',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of bookmarks to return (default: 50)',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const manager = getBookmarkManager();
      let bookmarks = await manager.getAllBookmarks();

      // Apply filters
      if (params.browser) {
        bookmarks = bookmarks.filter((b) => b.browser === params.browser);
      }

      if (params.folder) {
        const folderFilter = (params.folder as string).toLowerCase();
        bookmarks = bookmarks.filter((b) => b.folder.toLowerCase().includes(folderFilter));
      }

      const limit = (params.limit as number) || 50;
      const stats = await manager.getStats();

      return {
        success: true,
        data: {
          bookmarks: bookmarks.slice(0, limit).map((b) => ({
            title: b.title,
            url: b.url,
            folder: b.folder,
            browser: b.browser,
          })),
          totalCount: bookmarks.length,
          returnedCount: Math.min(bookmarks.length, limit),
          stats: {
            totalBookmarks: stats.totalBookmarks,
            byBrowser: stats.byBrowser,
            totalFolders: stats.totalFolders,
          },
        },
      };
    } catch (error) {
      const err = error as Error;
      logger.error('List bookmarks failed', { error: err.message });
      return { success: false, error: err.message };
    }
  },
};

/**
 * Get bookmark suggestions tool
 */
export const suggestBookmarksTool: AgentTool = {
  name: 'bookmark_suggest',
  description:
    'Get bookmark suggestions based on context or topic. Useful for finding relevant bookmarks.',
  parameters: {
    type: 'object',
    properties: {
      context: {
        type: 'string',
        description: 'Context or topic to find relevant bookmarks for',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of suggestions (default: 5)',
      },
    },
    required: ['context'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const manager = getBookmarkManager();
      const context = params.context as string;

      if (!context || context.trim().length === 0) {
        return { success: false, error: 'Context cannot be empty' };
      }

      const limit = (params.limit as number) || 5;
      const suggestions = await manager.getSuggestions(context.trim(), limit);

      logger.info('Bookmark suggestions generated', { context, count: suggestions.length });

      return {
        success: true,
        data: {
          context,
          suggestions: suggestions.map((s) => ({
            title: s.title,
            url: s.url,
            folder: s.folder,
            browser: s.browser,
            relevanceScore: Math.round(s.score * 100) / 100,
          })),
          count: suggestions.length,
        },
      };
    } catch (error) {
      const err = error as Error;
      logger.error('Bookmark suggestions failed', { error: err.message });
      return { success: false, error: err.message };
    }
  },
};

/**
 * List bookmark folders tool
 */
export const listBookmarkFoldersTool: AgentTool = {
  name: 'bookmark_folders',
  description: 'List all unique bookmark folders across all browsers.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (): Promise<ActionResult> => {
    try {
      const manager = getBookmarkManager();
      const folders = await manager.getFolders();

      return {
        success: true,
        data: {
          folders,
          count: folders.length,
        },
      };
    } catch (error) {
      const err = error as Error;
      logger.error('List bookmark folders failed', { error: err.message });
      return { success: false, error: err.message };
    }
  },
};

/**
 * Refresh bookmarks cache tool
 */
export const refreshBookmarksTool: AgentTool = {
  name: 'bookmark_refresh',
  description: 'Refresh the bookmark cache by re-reading from all browsers.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (): Promise<ActionResult> => {
    try {
      const manager = getBookmarkManager();
      await manager.refreshBookmarks();
      const stats = await manager.getStats();

      logger.info('Bookmark cache refreshed', { totalBookmarks: stats.totalBookmarks });

      return {
        success: true,
        data: {
          refreshed: true,
          stats: {
            totalBookmarks: stats.totalBookmarks,
            byBrowser: stats.byBrowser,
            totalFolders: stats.totalFolders,
          },
        },
      };
    } catch (error) {
      const err = error as Error;
      logger.error('Bookmark refresh failed', { error: err.message });
      return { success: false, error: err.message };
    }
  },
};

// ============================================================================
// Tool Collection Export
// ============================================================================

/**
 * Get all bookmark tools
 */
export function getBookmarkTools(): AgentTool[] {
  return [
    searchBookmarksTool,
    openBookmarkTool,
    listBookmarksTool,
    suggestBookmarksTool,
    listBookmarkFoldersTool,
    refreshBookmarksTool,
  ];
}

export default {
  getBookmarkManager,
  getBookmarkTools,
  searchBookmarksTool,
  openBookmarkTool,
  listBookmarksTool,
  suggestBookmarksTool,
  listBookmarkFoldersTool,
  refreshBookmarksTool,
};
