/**
 * Atlas Desktop - Application Registry
 *
 * Detects and maintains a registry of installed applications on Windows.
 * Uses Windows Registry, Start Menu, and common installation paths for detection.
 *
 * @module system/app-registry
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { createModuleLogger } from '../utils/logger';

const execAsync = promisify(exec);
const logger = createModuleLogger('AppRegistry');

/**
 * Represents an installed application
 */
export interface InstalledApp {
  /** Display name of the application */
  name: string;
  /** Normalized name for matching (lowercase, no special chars) */
  normalizedName: string;
  /** Full path to the executable */
  executablePath: string;
  /** Version string if available */
  version?: string;
  /** Publisher/vendor name */
  publisher?: string;
  /** Application icon path */
  iconPath?: string;
  /** Installation directory */
  installDir?: string;
  /** Source of detection (registry, startmenu, common) */
  source: 'registry' | 'startmenu' | 'common' | 'custom';
  /** User-defined aliases for this app */
  aliases?: string[];
  /** Last time this app was launched via Atlas */
  lastLaunched?: number;
  /** Number of times launched via Atlas */
  launchCount?: number;
}

/**
 * Custom alias mapping for common voice commands
 */
export interface AppAlias {
  /** The alias phrase (e.g., "browser") */
  alias: string;
  /** Target app name or executable */
  target: string;
  /** Priority when multiple matches exist */
  priority?: number;
}

/**
 * Registry scan result
 */
export interface RegistryScanResult {
  apps: InstalledApp[];
  scannedAt: number;
  duration: number;
  sources: {
    registry: number;
    startMenu: number;
    common: number;
  };
}

/**
 * Default aliases for common voice commands
 */
const DEFAULT_ALIASES: AppAlias[] = [
  // Browsers
  { alias: 'browser', target: 'chrome', priority: 1 },
  { alias: 'browser', target: 'microsoft edge', priority: 2 },
  { alias: 'browser', target: 'firefox', priority: 3 },
  { alias: 'web browser', target: 'chrome', priority: 1 },
  { alias: 'internet', target: 'chrome', priority: 1 },

  // Code Editors
  { alias: 'code editor', target: 'visual studio code', priority: 1 },
  { alias: 'code editor', target: 'sublime text', priority: 2 },
  { alias: 'vs code', target: 'visual studio code', priority: 1 },
  { alias: 'vscode', target: 'visual studio code', priority: 1 },
  { alias: 'editor', target: 'visual studio code', priority: 1 },
  { alias: 'editor', target: 'notepad++', priority: 2 },
  { alias: 'editor', target: 'notepad', priority: 3 },

  // File Manager
  { alias: 'file manager', target: 'explorer', priority: 1 },
  { alias: 'files', target: 'explorer', priority: 1 },
  { alias: 'finder', target: 'explorer', priority: 1 },
  { alias: 'my computer', target: 'explorer', priority: 1 },

  // Terminal
  { alias: 'terminal', target: 'windows terminal', priority: 1 },
  { alias: 'terminal', target: 'cmd', priority: 2 },
  { alias: 'command prompt', target: 'cmd', priority: 1 },
  { alias: 'powershell', target: 'powershell', priority: 1 },
  { alias: 'shell', target: 'windows terminal', priority: 1 },

  // Communication
  { alias: 'chat', target: 'slack', priority: 1 },
  { alias: 'chat', target: 'discord', priority: 2 },
  { alias: 'chat', target: 'teams', priority: 3 },
  { alias: 'messaging', target: 'slack', priority: 1 },
  { alias: 'video call', target: 'zoom', priority: 1 },
  { alias: 'video call', target: 'teams', priority: 2 },
  { alias: 'meetings', target: 'zoom', priority: 1 },

  // Music
  { alias: 'music', target: 'spotify', priority: 1 },
  { alias: 'music player', target: 'spotify', priority: 1 },

  // Office
  { alias: 'word processor', target: 'microsoft word', priority: 1 },
  { alias: 'word', target: 'microsoft word', priority: 1 },
  { alias: 'spreadsheet', target: 'microsoft excel', priority: 1 },
  { alias: 'excel', target: 'microsoft excel', priority: 1 },
  { alias: 'presentation', target: 'microsoft powerpoint', priority: 1 },
  { alias: 'powerpoint', target: 'microsoft powerpoint', priority: 1 },

  // System
  { alias: 'settings', target: 'settings', priority: 1 },
  { alias: 'control panel', target: 'control panel', priority: 1 },
  { alias: 'task manager', target: 'task manager', priority: 1 },
  { alias: 'calculator', target: 'calculator', priority: 1 },
  { alias: 'notepad', target: 'notepad', priority: 1 },
  { alias: 'paint', target: 'paint', priority: 1 },

  // Development
  { alias: 'git client', target: 'github desktop', priority: 1 },
  { alias: 'git client', target: 'sourcetree', priority: 2 },
  { alias: 'database', target: 'dbeaver', priority: 1 },
  { alias: 'database', target: 'sql server management studio', priority: 2 },
  { alias: 'api client', target: 'postman', priority: 1 },
  { alias: 'postman', target: 'postman', priority: 1 },
];

/**
 * Common Windows application paths to scan
 */
const COMMON_APP_PATHS = [
  // System paths
  'C:\\Windows\\System32\\calc.exe',
  'C:\\Windows\\System32\\notepad.exe',
  'C:\\Windows\\System32\\mspaint.exe',
  'C:\\Windows\\System32\\cmd.exe',
  'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
  'C:\\Windows\\explorer.exe',

  // Common program files locations
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
  'C:\\Program Files (x86)\\Mozilla Firefox\\firefox.exe',
  'C:\\Program Files\\Microsoft VS Code\\Code.exe',
  'C:\\Program Files (x86)\\Microsoft VS Code\\Code.exe',
  'C:\\Program Files\\Notepad++\\notepad++.exe',
  'C:\\Program Files (x86)\\Notepad++\\notepad++.exe',
  'C:\\Program Files\\VideoLAN\\VLC\\vlc.exe',
  'C:\\Program Files (x86)\\VideoLAN\\VLC\\vlc.exe',
  'C:\\Program Files\\7-Zip\\7zFM.exe',
  'C:\\Program Files (x86)\\7-Zip\\7zFM.exe',

  // Local app data locations
  path.join(os.homedir(), 'AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe'),
  path.join(os.homedir(), 'AppData\\Local\\Discord\\Update.exe'),
  path.join(os.homedir(), 'AppData\\Local\\slack\\slack.exe'),
  path.join(os.homedir(), 'AppData\\Local\\GitHubDesktop\\GitHubDesktop.exe'),
  path.join(os.homedir(), 'AppData\\Roaming\\Spotify\\Spotify.exe'),
  path.join(os.homedir(), 'AppData\\Local\\Postman\\Postman.exe'),
];

/**
 * Name mappings for common executables
 */
const EXECUTABLE_NAME_MAP: Record<string, string> = {
  'chrome.exe': 'Google Chrome',
  'firefox.exe': 'Mozilla Firefox',
  'msedge.exe': 'Microsoft Edge',
  'Code.exe': 'Visual Studio Code',
  'code.exe': 'Visual Studio Code',
  'notepad.exe': 'Notepad',
  'notepad++.exe': 'Notepad++',
  'calc.exe': 'Calculator',
  'mspaint.exe': 'Paint',
  'cmd.exe': 'Command Prompt',
  'powershell.exe': 'PowerShell',
  'explorer.exe': 'File Explorer',
  'vlc.exe': 'VLC Media Player',
  '7zFM.exe': '7-Zip',
  'Discord.exe': 'Discord',
  'slack.exe': 'Slack',
  'Spotify.exe': 'Spotify',
  'Postman.exe': 'Postman',
  'GitHubDesktop.exe': 'GitHub Desktop',
  'WindowsTerminal.exe': 'Windows Terminal',
  'WINWORD.EXE': 'Microsoft Word',
  'EXCEL.EXE': 'Microsoft Excel',
  'POWERPNT.EXE': 'Microsoft PowerPoint',
  'OUTLOOK.EXE': 'Microsoft Outlook',
  'Teams.exe': 'Microsoft Teams',
  'Zoom.exe': 'Zoom',
};

/**
 * Application Registry Manager
 *
 * Singleton class that manages the registry of installed applications.
 * Provides methods for scanning, searching, and managing app metadata.
 */
export class AppRegistry {
  private static instance: AppRegistry;
  private apps: Map<string, InstalledApp> = new Map();
  private aliases: AppAlias[] = [...DEFAULT_ALIASES];
  private customAliases: Map<string, string> = new Map();
  private recentApps: string[] = [];
  private lastScan: number = 0;
  private scanPromise: Promise<RegistryScanResult> | null = null;
  private initialized: boolean = false;

  // Configuration
  private readonly CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
  private readonly MAX_RECENT_APPS = 10;
  private readonly DATA_FILE = path.join(os.homedir(), '.atlas', 'app-registry.json');

  private constructor() {}

  /**
   * Get the singleton instance
   */
  public static getInstance(): AppRegistry {
    if (!AppRegistry.instance) {
      AppRegistry.instance = new AppRegistry();
    }
    return AppRegistry.instance;
  }

  /**
   * Initialize the registry (load cached data and optionally refresh)
   */
  public async initialize(forceRefresh: boolean = false): Promise<void> {
    if (this.initialized && !forceRefresh) {
      return;
    }

    logger.info('Initializing application registry');

    // Load cached data
    await this.loadCachedData();

    // Check if we need to refresh
    const needsRefresh = forceRefresh || Date.now() - this.lastScan > this.CACHE_TTL;

    if (needsRefresh || this.apps.size === 0) {
      await this.refresh();
    }

    this.initialized = true;
    logger.info('Application registry initialized', {
      appCount: this.apps.size,
      recentCount: this.recentApps.length,
    });
  }

  /**
   * Refresh the application registry by scanning the system
   */
  public async refresh(): Promise<RegistryScanResult> {
    // Prevent concurrent scans
    if (this.scanPromise) {
      return this.scanPromise;
    }

    this.scanPromise = this.performScan();
    const result = await this.scanPromise;
    this.scanPromise = null;

    return result;
  }

  /**
   * Perform the actual system scan
   */
  private async performScan(): Promise<RegistryScanResult> {
    const startTime = Date.now();
    logger.info('Starting application scan');

    const sources = {
      registry: 0,
      startMenu: 0,
      common: 0,
    };

    // Clear existing apps (keep custom ones)
    const customApps = Array.from(this.apps.values()).filter((app) => app.source === 'custom');
    this.apps.clear();
    customApps.forEach((app) => this.apps.set(app.normalizedName, app));

    // Scan all sources in parallel
    const [registryApps, startMenuApps, commonApps] = await Promise.all([
      this.scanWindowsRegistry().catch((err) => {
        logger.warn('Registry scan failed', { error: err.message });
        return [] as InstalledApp[];
      }),
      this.scanStartMenu().catch((err) => {
        logger.warn('Start menu scan failed', { error: err.message });
        return [] as InstalledApp[];
      }),
      this.scanCommonPaths().catch((err) => {
        logger.warn('Common paths scan failed', { error: err.message });
        return [] as InstalledApp[];
      }),
    ]);

    // Add apps to registry (avoid duplicates)
    for (const app of registryApps) {
      if (!this.apps.has(app.normalizedName)) {
        this.apps.set(app.normalizedName, app);
        sources.registry++;
      }
    }

    for (const app of startMenuApps) {
      if (!this.apps.has(app.normalizedName)) {
        this.apps.set(app.normalizedName, app);
        sources.startMenu++;
      }
    }

    for (const app of commonApps) {
      if (!this.apps.has(app.normalizedName)) {
        this.apps.set(app.normalizedName, app);
        sources.common++;
      }
    }

    this.lastScan = Date.now();
    const duration = this.lastScan - startTime;

    // Persist to disk
    await this.saveCachedData();

    logger.info('Application scan complete', {
      totalApps: this.apps.size,
      duration,
      sources,
    });

    return {
      apps: Array.from(this.apps.values()),
      scannedAt: this.lastScan,
      duration,
      sources,
    };
  }

  /**
   * Scan Windows Registry for installed applications
   */
  private async scanWindowsRegistry(): Promise<InstalledApp[]> {
    const apps: InstalledApp[] = [];

    // Registry paths to scan
    const registryPaths = [
      'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
      'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
      'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    ];

    for (const regPath of registryPaths) {
      try {
        // Get list of subkeys
        const { stdout } = await execAsync(`reg query "${regPath}" /s /v DisplayName`, {
          timeout: 30000,
          windowsHide: true,
          maxBuffer: 10 * 1024 * 1024, // 10MB buffer
        });

        // Parse registry output
        const entries = stdout.split(/\r?\n\r?\n/).filter((entry) => entry.trim());

        for (const entry of entries) {
          const app = this.parseRegistryEntry(entry);
          if (app) {
            apps.push(app);
          }
        }
      } catch {
        // Registry path might not exist or be accessible
        continue;
      }
    }

    return apps;
  }

  /**
   * Parse a Windows Registry entry into an InstalledApp
   */
  private parseRegistryEntry(entry: string): InstalledApp | null {
    try {
      const lines = entry.split(/\r?\n/);
      const data: Record<string, string> = {};

      // Parse key-value pairs
      for (const line of lines) {
        const match = line.match(/^\s+(\w+)\s+REG_\w+\s+(.+)$/);
        if (match) {
          data[match[1]] = match[2].trim();
        }
      }

      // Must have a display name
      if (!data.DisplayName) {
        return null;
      }

      // Skip system components and updates
      if (
        data.SystemComponent === '1' ||
        data.DisplayName.includes('Update for') ||
        data.DisplayName.includes('Hotfix') ||
        data.DisplayName.includes('Security Update') ||
        data.DisplayName.includes('Service Pack') ||
        data.DisplayName.startsWith('KB')
      ) {
        return null;
      }

      // Get executable path
      let executablePath = '';
      if (data.DisplayIcon) {
        // DisplayIcon often contains the exe path
        executablePath = data.DisplayIcon.split(',')[0].replace(/"/g, '');
      } else if (data.InstallLocation) {
        // Try to find exe in install location
        executablePath = data.InstallLocation;
      }

      // Validate path exists
      if (!executablePath || (!executablePath.toLowerCase().endsWith('.exe') && !data.InstallLocation)) {
        return null;
      }

      const name = data.DisplayName;
      const normalizedName = this.normalizeName(name);

      return {
        name,
        normalizedName,
        executablePath,
        version: data.DisplayVersion,
        publisher: data.Publisher,
        installDir: data.InstallLocation,
        source: 'registry',
      };
    } catch {
      return null;
    }
  }

  /**
   * Scan Start Menu for shortcuts to applications
   */
  private async scanStartMenu(): Promise<InstalledApp[]> {
    const apps: InstalledApp[] = [];

    // Start menu locations
    const startMenuPaths = [
      path.join(os.homedir(), 'AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs'),
      'C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs',
    ];

    for (const menuPath of startMenuPaths) {
      try {
        const shortcuts = await this.findShortcuts(menuPath);

        for (const shortcut of shortcuts) {
          const app = await this.parseShortcut(shortcut);
          if (app) {
            apps.push(app);
          }
        }
      } catch {
        continue;
      }
    }

    return apps;
  }

  /**
   * Find .lnk files recursively in a directory
   */
  private async findShortcuts(dir: string): Promise<string[]> {
    const shortcuts: string[] = [];

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          // Skip certain folders
          if (entry.name.toLowerCase() === 'startup') continue;

          const subShortcuts = await this.findShortcuts(fullPath);
          shortcuts.push(...subShortcuts);
        } else if (entry.name.toLowerCase().endsWith('.lnk')) {
          shortcuts.push(fullPath);
        }
      }
    } catch {
      // Directory not accessible
    }

    return shortcuts;
  }

  /**
   * Parse a Windows shortcut file to get target information
   */
  private async parseShortcut(shortcutPath: string): Promise<InstalledApp | null> {
    try {
      // Use PowerShell to read shortcut target
      const command = `
        $shell = New-Object -ComObject WScript.Shell
        $shortcut = $shell.CreateShortcut('${shortcutPath.replace(/'/g, "''")}')
        Write-Output $shortcut.TargetPath
        Write-Output $shortcut.Arguments
      `;

      const { stdout } = await execAsync(`powershell -Command "${command.replace(/"/g, '\\"')}"`, {
        timeout: 5000,
        windowsHide: true,
      });

      const lines = stdout.trim().split(/\r?\n/);
      const targetPath = lines[0]?.trim();

      if (!targetPath || !targetPath.toLowerCase().endsWith('.exe')) {
        return null;
      }

      // Check if file exists
      try {
        await fs.access(targetPath);
      } catch {
        return null;
      }

      // Get name from shortcut filename or executable
      const shortcutName = path.basename(shortcutPath, '.lnk');
      const exeName = path.basename(targetPath);
      const name = EXECUTABLE_NAME_MAP[exeName] || shortcutName;
      const normalizedName = this.normalizeName(name);

      return {
        name,
        normalizedName,
        executablePath: targetPath,
        installDir: path.dirname(targetPath),
        source: 'startmenu',
      };
    } catch {
      return null;
    }
  }

  /**
   * Scan common installation paths for applications
   */
  private async scanCommonPaths(): Promise<InstalledApp[]> {
    const apps: InstalledApp[] = [];

    for (const appPath of COMMON_APP_PATHS) {
      try {
        await fs.access(appPath);

        const exeName = path.basename(appPath);
        const name = EXECUTABLE_NAME_MAP[exeName] || path.basename(appPath, '.exe');
        const normalizedName = this.normalizeName(name);

        apps.push({
          name,
          normalizedName,
          executablePath: appPath,
          installDir: path.dirname(appPath),
          source: 'common',
        });
      } catch {
        // File doesn't exist
        continue;
      }
    }

    return apps;
  }

  /**
   * Normalize an app name for matching
   */
  private normalizeName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Search for an app by name using fuzzy matching
   */
  public findApp(query: string): InstalledApp | null {
    const normalizedQuery = this.normalizeName(query);

    // First, check exact match
    const exactMatch = this.apps.get(normalizedQuery);
    if (exactMatch) {
      return exactMatch;
    }

    // Check custom aliases
    const customTarget = this.customAliases.get(normalizedQuery);
    if (customTarget) {
      const aliasApp = this.apps.get(this.normalizeName(customTarget));
      if (aliasApp) {
        return aliasApp;
      }
    }

    // Check default aliases
    const aliasMatches = this.aliases
      .filter((a) => this.normalizeName(a.alias) === normalizedQuery)
      .sort((a, b) => (a.priority || 99) - (b.priority || 99));

    for (const alias of aliasMatches) {
      const targetApp = this.findAppByTarget(alias.target);
      if (targetApp) {
        return targetApp;
      }
    }

    // Fuzzy search
    const fuzzyMatch = this.fuzzySearch(normalizedQuery);
    if (fuzzyMatch) {
      return fuzzyMatch;
    }

    return null;
  }

  /**
   * Find app by target name (for aliases)
   */
  private findAppByTarget(target: string): InstalledApp | null {
    const normalizedTarget = this.normalizeName(target);

    // Exact match
    const exact = this.apps.get(normalizedTarget);
    if (exact) return exact;

    // Partial match
    for (const [, app] of this.apps) {
      if (app.normalizedName.includes(normalizedTarget) || normalizedTarget.includes(app.normalizedName)) {
        return app;
      }
    }

    return null;
  }

  /**
   * Perform fuzzy search using Levenshtein distance
   */
  private fuzzySearch(query: string, maxDistance: number = 3): InstalledApp | null {
    let bestMatch: InstalledApp | null = null;
    let bestScore = Infinity;

    for (const [, app] of this.apps) {
      // Check main name
      const nameDistance = this.levenshteinDistance(query, app.normalizedName);
      if (nameDistance < bestScore && nameDistance <= maxDistance) {
        bestScore = nameDistance;
        bestMatch = app;
      }

      // Check if query is a substring
      if (app.normalizedName.includes(query) || query.includes(app.normalizedName)) {
        const substringScore = Math.abs(app.normalizedName.length - query.length) * 0.5;
        if (substringScore < bestScore) {
          bestScore = substringScore;
          bestMatch = app;
        }
      }

      // Check aliases
      if (app.aliases) {
        for (const alias of app.aliases) {
          const aliasDistance = this.levenshteinDistance(query, this.normalizeName(alias));
          if (aliasDistance < bestScore && aliasDistance <= maxDistance) {
            bestScore = aliasDistance;
            bestMatch = app;
          }
        }
      }
    }

    return bestMatch;
  }

  /**
   * Calculate Levenshtein distance between two strings
   */
  private levenshteinDistance(s1: string, s2: string): number {
    const m = s1.length;
    const n = s2.length;

    // Quick checks
    if (m === 0) return n;
    if (n === 0) return m;

    // Create distance matrix
    const dp: number[][] = Array(m + 1)
      .fill(null)
      .map(() => Array(n + 1).fill(0));

    // Initialize first row and column
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    // Fill the matrix
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1, // deletion
          dp[i][j - 1] + 1, // insertion
          dp[i - 1][j - 1] + cost // substitution
        );
      }
    }

    return dp[m][n];
  }

  /**
   * Search apps with multiple results
   */
  public searchApps(query: string, limit: number = 5): InstalledApp[] {
    const normalizedQuery = this.normalizeName(query);
    const results: Array<{ app: InstalledApp; score: number }> = [];

    for (const [, app] of this.apps) {
      let score = Infinity;

      // Exact match
      if (app.normalizedName === normalizedQuery) {
        score = 0;
      }
      // Starts with
      else if (app.normalizedName.startsWith(normalizedQuery)) {
        score = 1;
      }
      // Contains
      else if (app.normalizedName.includes(normalizedQuery)) {
        score = 2;
      }
      // Levenshtein
      else {
        score = this.levenshteinDistance(normalizedQuery, app.normalizedName);
      }

      // Boost recently used apps
      if (this.recentApps.includes(app.normalizedName)) {
        const recentIndex = this.recentApps.indexOf(app.normalizedName);
        score -= (this.MAX_RECENT_APPS - recentIndex) * 0.1;
      }

      if (score < 5) {
        results.push({ app, score });
      }
    }

    // Sort by score and return top matches
    return results
      .sort((a, b) => a.score - b.score)
      .slice(0, limit)
      .map((r) => r.app);
  }

  /**
   * Get all installed apps
   */
  public getAllApps(): InstalledApp[] {
    return Array.from(this.apps.values());
  }

  /**
   * Get recently launched apps
   */
  public getRecentApps(): InstalledApp[] {
    return this.recentApps
      .map((name) => this.apps.get(name))
      .filter((app): app is InstalledApp => app !== undefined);
  }

  /**
   * Record app launch for tracking
   */
  public recordLaunch(appName: string): void {
    const normalizedName = this.normalizeName(appName);
    const app = this.apps.get(normalizedName);

    if (app) {
      // Update launch stats
      app.lastLaunched = Date.now();
      app.launchCount = (app.launchCount || 0) + 1;

      // Update recent apps list
      const existingIndex = this.recentApps.indexOf(normalizedName);
      if (existingIndex !== -1) {
        this.recentApps.splice(existingIndex, 1);
      }
      this.recentApps.unshift(normalizedName);

      // Trim to max size
      if (this.recentApps.length > this.MAX_RECENT_APPS) {
        this.recentApps = this.recentApps.slice(0, this.MAX_RECENT_APPS);
      }

      // Save updated data
      this.saveCachedData().catch((err) => {
        logger.warn('Failed to save app registry', { error: err.message });
      });
    }
  }

  /**
   * Add a custom alias
   */
  public addAlias(alias: string, appName: string): boolean {
    const normalizedAlias = this.normalizeName(alias);
    const normalizedApp = this.normalizeName(appName);

    // Verify app exists
    if (!this.apps.has(normalizedApp)) {
      const fuzzyMatch = this.fuzzySearch(normalizedApp);
      if (!fuzzyMatch) {
        return false;
      }
    }

    this.customAliases.set(normalizedAlias, appName);

    // Save to disk
    this.saveCachedData().catch((err) => {
      logger.warn('Failed to save custom alias', { error: err.message });
    });

    logger.info('Added custom alias', { alias, appName });
    return true;
  }

  /**
   * Remove a custom alias
   */
  public removeAlias(alias: string): boolean {
    const normalizedAlias = this.normalizeName(alias);
    const existed = this.customAliases.delete(normalizedAlias);

    if (existed) {
      this.saveCachedData().catch((err) => {
        logger.warn('Failed to save after alias removal', { error: err.message });
      });
    }

    return existed;
  }

  /**
   * Add a custom application
   */
  public addCustomApp(name: string, executablePath: string, aliases?: string[]): InstalledApp {
    const normalizedName = this.normalizeName(name);

    const app: InstalledApp = {
      name,
      normalizedName,
      executablePath,
      installDir: path.dirname(executablePath),
      source: 'custom',
      aliases,
    };

    this.apps.set(normalizedName, app);

    // Save to disk
    this.saveCachedData().catch((err) => {
      logger.warn('Failed to save custom app', { error: err.message });
    });

    logger.info('Added custom application', { name, executablePath });
    return app;
  }

  /**
   * Remove a custom application
   */
  public removeCustomApp(name: string): boolean {
    const normalizedName = this.normalizeName(name);
    const app = this.apps.get(normalizedName);

    if (app && app.source === 'custom') {
      this.apps.delete(normalizedName);

      this.saveCachedData().catch((err) => {
        logger.warn('Failed to save after app removal', { error: err.message });
      });

      return true;
    }

    return false;
  }

  /**
   * Load cached data from disk
   */
  private async loadCachedData(): Promise<void> {
    try {
      const dataDir = path.dirname(this.DATA_FILE);
      await fs.mkdir(dataDir, { recursive: true });

      const data = await fs.readFile(this.DATA_FILE, 'utf-8');
      const parsed = JSON.parse(data);

      // Restore apps
      if (parsed.apps && Array.isArray(parsed.apps)) {
        for (const app of parsed.apps as InstalledApp[]) {
          this.apps.set(app.normalizedName, app);
        }
      }

      // Restore recent apps
      if (parsed.recentApps && Array.isArray(parsed.recentApps)) {
        this.recentApps = parsed.recentApps;
      }

      // Restore custom aliases
      if (parsed.customAliases && typeof parsed.customAliases === 'object') {
        this.customAliases = new Map(Object.entries(parsed.customAliases));
      }

      // Restore last scan time
      if (typeof parsed.lastScan === 'number') {
        this.lastScan = parsed.lastScan;
      }

      logger.debug('Loaded cached app registry', {
        appCount: this.apps.size,
        aliasCount: this.customAliases.size,
      });
    } catch (err) {
      // No cached data or invalid JSON
      logger.debug('No cached app registry found, will scan');
    }
  }

  /**
   * Save data to disk
   */
  private async saveCachedData(): Promise<void> {
    const dataDir = path.dirname(this.DATA_FILE);
    await fs.mkdir(dataDir, { recursive: true });

    const data = {
      apps: Array.from(this.apps.values()),
      recentApps: this.recentApps,
      customAliases: Object.fromEntries(this.customAliases),
      lastScan: this.lastScan,
    };

    await fs.writeFile(this.DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
  }

  /**
   * Get registry statistics
   */
  public getStats(): {
    totalApps: number;
    customApps: number;
    aliasCount: number;
    recentCount: number;
    lastScanAge: number;
  } {
    const customApps = Array.from(this.apps.values()).filter((a) => a.source === 'custom').length;

    return {
      totalApps: this.apps.size,
      customApps,
      aliasCount: this.customAliases.size + this.aliases.length,
      recentCount: this.recentApps.length,
      lastScanAge: Date.now() - this.lastScan,
    };
  }
}

// Export singleton getter
export function getAppRegistry(): AppRegistry {
  return AppRegistry.getInstance();
}

export default AppRegistry;
