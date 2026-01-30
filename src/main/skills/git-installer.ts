/**
 * @fileoverview Git-based skill installer for ClawdHub and custom skills
 * @module skills/git-installer
 * 
 * @description
 * Handles installation of skills from git repositories. Supports:
 * - Cloning from GitHub, GitLab, Bitbucket
 * - Branch/tag selection
 * - Dependency checking (binaries, env vars)
 * - Automatic updates
 * - Rollback on failure
 */

import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import { app } from 'electron';
import { createModuleLogger } from '../utils/logger';
import { ClawdHubSkill, getClawdHubClient } from './clawdhub-client';

const logger = createModuleLogger('GitInstaller');

/**
 * Installation progress event
 */
export interface InstallProgress {
  /** Current phase */
  phase: 'cloning' | 'checking' | 'installing' | 'configuring' | 'complete' | 'error';
  /** Progress percentage (0-100) */
  progress: number;
  /** Status message */
  message: string;
  /** Error if phase is 'error' */
  error?: string;
}

/**
 * Installed skill metadata
 */
export interface InstalledSkill {
  /** Skill ID */
  id: string;
  /** Display name */
  name: string;
  /** Description */
  description: string;
  /** Installation path */
  path: string;
  /** Git repository URL */
  repository: string;
  /** Installed version/tag */
  version: string;
  /** Git commit hash */
  commit: string;
  /** Installation timestamp */
  installedAt: string;
  /** Last update check */
  lastChecked?: string;
  /** Whether updates are available */
  updateAvailable?: boolean;
  /** Latest available version */
  latestVersion?: string;
  /** Whether skill is enabled */
  enabled: boolean;
  /** ClawdHub skill data if from registry */
  clawdHubData?: ClawdHubSkill;
}

/**
 * Installation options
 */
export interface InstallOptions {
  /** Specific branch to install */
  branch?: string;
  /** Specific tag/version to install */
  tag?: string;
  /** Force reinstall even if exists */
  force?: boolean;
  /** Skip dependency checks */
  skipChecks?: boolean;
  /** Custom install path */
  installPath?: string;
}

/**
 * Skill manifest from SKILL.md
 */
export interface SkillManifest {
  /** Skill name */
  name: string;
  /** Description */
  description: string;
  /** Version */
  version: string;
  /** Author */
  author?: string;
  /** Tool definitions */
  tools: Array<{
    name: string;
    description: string;
    parameters?: Record<string, unknown>;
  }>;
  /** Required environment variables */
  envVars?: string[];
  /** Required binaries */
  binaries?: string[];
  /** Setup instructions */
  setup?: string;
}

/**
 * Git-based skill installer
 */
export class GitInstaller extends EventEmitter {
  private _skillsDir: string;
  private _installedSkills: Map<string, InstalledSkill> = new Map();
  private _manifestPath: string;

  constructor() {
    super();
    this._skillsDir = path.join(app.getPath('userData'), 'skills');
    this._manifestPath = path.join(this._skillsDir, 'installed.json');
  }

  /**
   * Initialize the installer
   */
  async initialize(): Promise<void> {
    // Ensure skills directory exists
    await fs.mkdir(this._skillsDir, { recursive: true });
    
    // Load installed skills manifest
    await this._loadManifest();
    
    logger.info('Git installer initialized', {
      skillsDir: this._skillsDir,
      installedCount: this._installedSkills.size,
    });
  }

  /**
   * Load installed skills manifest
   */
  private async _loadManifest(): Promise<void> {
    try {
      const data = await fs.readFile(this._manifestPath, 'utf-8');
      const skills = JSON.parse(data) as InstalledSkill[];
      this._installedSkills.clear();
      for (const skill of skills) {
        this._installedSkills.set(skill.id, skill);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn('Failed to load manifest', { error });
      }
    }
  }

  /**
   * Save installed skills manifest
   */
  private async _saveManifest(): Promise<void> {
    const skills = Array.from(this._installedSkills.values());
    await fs.writeFile(this._manifestPath, JSON.stringify(skills, null, 2));
  }

  /**
   * Install a skill from ClawdHub
   */
  async installFromClawdHub(
    skillId: string,
    options: InstallOptions = {}
  ): Promise<InstalledSkill> {
    const client = getClawdHubClient();
    const skill = await client.getSkill(skillId);
    
    this._emitProgress('checking', 10, `Fetching skill info: ${skill.name}`);

    // Check compatibility
    const compatibility = await client.checkCompatibility(skillId, app.getVersion());
    if (!compatibility.compatible) {
      throw new Error(compatibility.message || 'Skill not compatible with this version of Atlas');
    }

    // Install from repository
    const installed = await this.installFromGit(skill.repository, {
      ...options,
      branch: options.branch || skill.branch,
      tag: options.tag || skill.version,
    });

    // Attach ClawdHub metadata
    installed.clawdHubData = skill;
    installed.id = skillId;
    installed.name = skill.name;
    installed.description = skill.description;

    // Save and report install
    this._installedSkills.set(skillId, installed);
    await this._saveManifest();
    
    // Report to ClawdHub analytics
    await client.reportInstall(skillId);

    return installed;
  }

  /**
   * Install a skill from a git repository
   */
  async installFromGit(
    repoUrl: string,
    options: InstallOptions = {}
  ): Promise<InstalledSkill> {
    // Generate skill ID from repo URL
    const skillId = this._repoToId(repoUrl);
    
    // Check if already installed
    if (this._installedSkills.has(skillId) && !options.force) {
      throw new Error(`Skill ${skillId} is already installed. Use force option to reinstall.`);
    }

    const installPath = options.installPath || path.join(this._skillsDir, skillId);

    try {
      // Phase 1: Clone repository
      this._emitProgress('cloning', 20, `Cloning ${repoUrl}`);
      await this._cloneRepo(repoUrl, installPath, options);

      // Phase 2: Parse SKILL.md
      this._emitProgress('checking', 40, 'Reading skill manifest');
      const manifest = await this._parseSkillManifest(installPath);

      // Phase 3: Check dependencies
      if (!options.skipChecks) {
        this._emitProgress('checking', 50, 'Checking dependencies');
        await this._checkDependencies(manifest);
      }

      // Phase 4: Get commit info
      this._emitProgress('installing', 70, 'Finalizing installation');
      const commit = await this._getCommitHash(installPath);

      // Phase 5: Create installed skill entry
      const installed: InstalledSkill = {
        id: skillId,
        name: manifest.name,
        description: manifest.description,
        path: installPath,
        repository: repoUrl,
        version: options.tag || manifest.version || 'main',
        commit,
        installedAt: new Date().toISOString(),
        enabled: true,
      };

      // Phase 6: Save manifest
      this._emitProgress('configuring', 90, 'Saving configuration');
      this._installedSkills.set(skillId, installed);
      await this._saveManifest();

      this._emitProgress('complete', 100, `Successfully installed ${manifest.name}`);
      
      logger.info('Skill installed', { skillId, path: installPath });
      this.emit('installed', installed);

      return installed;
    } catch (error) {
      // Rollback on failure
      this._emitProgress('error', 0, `Installation failed: ${(error as Error).message}`, (error as Error).message);
      
      try {
        await fs.rm(installPath, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }

      throw error;
    }
  }

  /**
   * Clone a git repository
   */
  private async _cloneRepo(
    repoUrl: string,
    targetPath: string,
    options: InstallOptions
  ): Promise<void> {
    // Remove existing if force
    if (options.force) {
      await fs.rm(targetPath, { recursive: true, force: true });
    }

    const args = ['clone', '--depth', '1'];
    
    if (options.branch) {
      args.push('--branch', options.branch);
    } else if (options.tag) {
      args.push('--branch', options.tag);
    }

    args.push(repoUrl, targetPath);

    await this._runGit(args);
  }

  /**
   * Run a git command
   */
  private _runGit(args: string[], cwd?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const git = spawn('git', args, {
        cwd,
        shell: process.platform === 'win32',
      });

      let stdout = '';
      let stderr = '';

      git.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      git.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      git.on('close', (code) => {
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          reject(new Error(`Git command failed: ${stderr || stdout}`));
        }
      });

      git.on('error', (error) => {
        reject(new Error(`Failed to run git: ${error.message}`));
      });
    });
  }

  /**
   * Parse SKILL.md manifest
   */
  private async _parseSkillManifest(skillPath: string): Promise<SkillManifest> {
    const manifestPath = path.join(skillPath, 'SKILL.md');
    
    try {
      const content = await fs.readFile(manifestPath, 'utf-8');
      return this._parseSkillMd(content);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error('SKILL.md not found in repository');
      }
      throw error;
    }
  }

  /**
   * Parse SKILL.md content into manifest
   */
  private _parseSkillMd(content: string): SkillManifest {
    const manifest: SkillManifest = {
      name: 'Unknown Skill',
      description: '',
      version: '1.0.0',
      tools: [],
    };

    // Parse frontmatter-style metadata
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (frontmatterMatch) {
      const lines = frontmatterMatch[1].split('\n');
      for (const line of lines) {
        const [key, ...valueParts] = line.split(':');
        const value = valueParts.join(':').trim();
        
        switch (key.trim().toLowerCase()) {
          case 'name':
            manifest.name = value;
            break;
          case 'description':
            manifest.description = value;
            break;
          case 'version':
            manifest.version = value;
            break;
          case 'author':
            manifest.author = value;
            break;
        }
      }
    }

    // Parse # Name from first heading
    const nameMatch = content.match(/^#\s+(.+)$/m);
    if (nameMatch && manifest.name === 'Unknown Skill') {
      manifest.name = nameMatch[1].trim();
    }

    // Parse description from first paragraph after heading
    const descMatch = content.match(/^#\s+.+\n\n(.+?)(?:\n\n|$)/m);
    if (descMatch && !manifest.description) {
      manifest.description = descMatch[1].trim();
    }

    // Parse ## Tools section
    const toolsMatch = content.match(/## Tools\n([\s\S]*?)(?=\n## |$)/);
    if (toolsMatch) {
      const toolSection = toolsMatch[1];
      const toolMatches = toolSection.matchAll(/###\s+`?(\w+)`?\n([\s\S]*?)(?=\n### |$)/g);
      
      for (const match of toolMatches) {
        manifest.tools.push({
          name: match[1],
          description: match[2].trim().split('\n')[0], // First line as description
        });
      }
    }

    // Parse ## Requirements section
    const reqMatch = content.match(/## Requirements\n([\s\S]*?)(?=\n## |$)/);
    if (reqMatch) {
      const reqSection = reqMatch[1];
      
      // Parse env vars
      const envMatch = reqSection.match(/### Environment Variables\n([\s\S]*?)(?=\n### |$)/);
      if (envMatch) {
        manifest.envVars = envMatch[1]
          .match(/`([A-Z_]+)`/g)
          ?.map(m => m.replace(/`/g, ''));
      }

      // Parse binaries
      const binMatch = reqSection.match(/### Binaries\n([\s\S]*?)(?=\n### |$)/);
      if (binMatch) {
        manifest.binaries = binMatch[1]
          .match(/`([a-z0-9_-]+)`/gi)
          ?.map(m => m.replace(/`/g, ''));
      }
    }

    // Parse ## Setup section
    const setupMatch = content.match(/## Setup\n([\s\S]*?)(?=\n## |$)/);
    if (setupMatch) {
      manifest.setup = setupMatch[1].trim();
    }

    return manifest;
  }

  /**
   * Check skill dependencies
   */
  private async _checkDependencies(manifest: SkillManifest): Promise<void> {
    const missing: string[] = [];

    // Check environment variables
    if (manifest.envVars) {
      for (const envVar of manifest.envVars) {
        if (!process.env[envVar]) {
          missing.push(`Environment variable: ${envVar}`);
        }
      }
    }

    // Check binaries
    if (manifest.binaries) {
      for (const binary of manifest.binaries) {
        const exists = await this._binaryExists(binary);
        if (!exists) {
          missing.push(`Binary: ${binary}`);
        }
      }
    }

    if (missing.length > 0) {
      throw new Error(`Missing dependencies:\n${missing.join('\n')}`);
    }
  }

  /**
   * Check if a binary exists in PATH
   */
  private async _binaryExists(name: string): Promise<boolean> {
    const command = process.platform === 'win32' ? 'where' : 'which';
    
    return new Promise((resolve) => {
      const proc = spawn(command, [name], {
        shell: process.platform === 'win32',
      });

      proc.on('close', (code) => {
        resolve(code === 0);
      });

      proc.on('error', () => {
        resolve(false);
      });
    });
  }

  /**
   * Get current commit hash
   */
  private async _getCommitHash(repoPath: string): Promise<string> {
    return this._runGit(['rev-parse', 'HEAD'], repoPath);
  }

  /**
   * Convert repository URL to skill ID
   */
  private _repoToId(repoUrl: string): string {
    // Extract owner/repo from URL
    const match = repoUrl.match(/(?:github\.com|gitlab\.com|bitbucket\.org)[/:](.+?)(?:\.git)?$/);
    if (match) {
      return match[1].replace(/\//g, '-').toLowerCase();
    }
    // Fallback to hash
    return `skill-${Buffer.from(repoUrl).toString('base64url').slice(0, 16)}`;
  }

  /**
   * Emit progress event
   */
  private _emitProgress(
    phase: InstallProgress['phase'],
    progress: number,
    message: string,
    error?: string
  ): void {
    const event: InstallProgress = { phase, progress, message, error };
    this.emit('progress', event);
    logger.debug('Install progress', event);
  }

  /**
   * Uninstall a skill
   */
  async uninstall(skillId: string): Promise<void> {
    const skill = this._installedSkills.get(skillId);
    if (!skill) {
      throw new Error(`Skill ${skillId} is not installed`);
    }

    // Remove files
    await fs.rm(skill.path, { recursive: true, force: true });

    // Remove from manifest
    this._installedSkills.delete(skillId);
    await this._saveManifest();

    logger.info('Skill uninstalled', { skillId });
    this.emit('uninstalled', skillId);
  }

  /**
   * Check for updates to a skill
   */
  async checkForUpdates(skillId: string): Promise<{
    hasUpdate: boolean;
    currentVersion: string;
    latestVersion?: string;
  }> {
    const skill = this._installedSkills.get(skillId);
    if (!skill) {
      throw new Error(`Skill ${skillId} is not installed`);
    }

    // If from ClawdHub, check registry
    if (skill.clawdHubData) {
      const client = getClawdHubClient();
      const latest = await client.getSkill(skillId);
      
      const hasUpdate = latest.version !== skill.version;
      
      skill.lastChecked = new Date().toISOString();
      skill.updateAvailable = hasUpdate;
      skill.latestVersion = latest.version;
      await this._saveManifest();

      return {
        hasUpdate,
        currentVersion: skill.version,
        latestVersion: latest.version,
      };
    }

    // For git repos, check remote
    try {
      await this._runGit(['fetch', '--dry-run'], skill.path);
      const localCommit = await this._getCommitHash(skill.path);
      const remoteCommit = await this._runGit(['rev-parse', 'origin/HEAD'], skill.path);
      
      const hasUpdate = localCommit !== remoteCommit;
      
      skill.lastChecked = new Date().toISOString();
      skill.updateAvailable = hasUpdate;
      await this._saveManifest();

      return {
        hasUpdate,
        currentVersion: skill.commit.slice(0, 7),
        latestVersion: hasUpdate ? remoteCommit.slice(0, 7) : undefined,
      };
    } catch {
      return {
        hasUpdate: false,
        currentVersion: skill.version,
      };
    }
  }

  /**
   * Update a skill to latest version
   */
  async update(skillId: string): Promise<InstalledSkill> {
    const skill = this._installedSkills.get(skillId);
    if (!skill) {
      throw new Error(`Skill ${skillId} is not installed`);
    }

    // Reinstall with force
    if (skill.clawdHubData) {
      return this.installFromClawdHub(skillId, { force: true });
    }

    return this.installFromGit(skill.repository, {
      force: true,
      installPath: skill.path,
    });
  }

  /**
   * Enable a skill
   */
  async enable(skillId: string): Promise<void> {
    const skill = this._installedSkills.get(skillId);
    if (!skill) {
      throw new Error(`Skill ${skillId} is not installed`);
    }

    skill.enabled = true;
    await this._saveManifest();
    
    this.emit('enabled', skillId);
  }

  /**
   * Disable a skill
   */
  async disable(skillId: string): Promise<void> {
    const skill = this._installedSkills.get(skillId);
    if (!skill) {
      throw new Error(`Skill ${skillId} is not installed`);
    }

    skill.enabled = false;
    await this._saveManifest();
    
    this.emit('disabled', skillId);
  }

  /**
   * Get all installed skills
   */
  getInstalledSkills(): InstalledSkill[] {
    return Array.from(this._installedSkills.values());
  }

  /**
   * Get a specific installed skill
   */
  getSkill(skillId: string): InstalledSkill | undefined {
    return this._installedSkills.get(skillId);
  }

  /**
   * Check if a skill is installed
   */
  isInstalled(skillId: string): boolean {
    return this._installedSkills.has(skillId);
  }

  /**
   * Get the skills directory path
   */
  getSkillsDir(): string {
    return this._skillsDir;
  }
}

// Singleton instance
let gitInstaller: GitInstaller | null = null;

/**
 * Get the git installer singleton
 */
export function getGitInstaller(): GitInstaller {
  if (!gitInstaller) {
    gitInstaller = new GitInstaller();
  }
  return gitInstaller;
}

/**
 * Initialize the git installer
 */
export async function initializeGitInstaller(): Promise<void> {
  const installer = getGitInstaller();
  await installer.initialize();
}

/**
 * Shutdown the git installer
 */
export function shutdownGitInstaller(): void {
  gitInstaller = null;
}
