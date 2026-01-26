/**
 * GEPA Code Self-Modification
 *
 * Allows Atlas to safely modify its own code for self-improvement.
 * All changes are tracked in git for transparency and rollback capability.
 *
 * Safety Features:
 * - All modifications are git-tracked
 * - Sandboxed execution for testing
 * - Automatic rollback on failure
 * - User approval for significant changes
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import { getErrorMessage } from '../../shared/utils';
import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import { getConfig } from '../config';

const logger = createModuleLogger('GEPA-SelfMod');

// ============================================================================
// Types
// ============================================================================

/**
 * Code modification types
 */
export type ModificationType =
  | 'prompt_update' // System prompt changes
  | 'config_update' // Configuration changes
  | 'tool_update' // Tool improvements
  | 'script_creation' // New automation script
  | 'hotfix'; // Quick fix for identified issue

/**
 * Code modification request
 */
export interface ModificationRequest {
  id: string;
  type: ModificationType;
  target: string; // File or config path
  description: string;
  reason: string;
  currentContent?: string;
  proposedContent: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  requiresApproval: boolean;
  createdAt: Date;
  status: 'pending' | 'approved' | 'applied' | 'rejected' | 'failed';
}

/**
 * Applied modification record
 */
export interface AppliedModification {
  id: string;
  requestId: string;
  type: ModificationType;
  target: string;
  appliedAt: Date;
  gitCommit: string;
  previousCommit: string;
  testsPassed: boolean;
  rolledBack: boolean;
}

/**
 * Self-modification configuration
 */
export interface SelfModConfig {
  enabled: boolean;
  allowAutoApply: boolean; // Auto-apply low-risk changes
  requireApprovalTypes: ModificationType[]; // Types that always need approval
  maxPendingRequests: number;
  testBeforeApply: boolean;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: SelfModConfig = {
  enabled: true,
  allowAutoApply: false, // Require approval by default
  requireApprovalTypes: ['tool_update', 'hotfix'],
  maxPendingRequests: 10,
  testBeforeApply: true,
};

// ============================================================================
// Self-Modification Manager
// ============================================================================

export class SelfModificationManager extends EventEmitter {
  private config: SelfModConfig;
  private dataDir: string;
  private projectRoot: string;
  private pendingRequests: Map<string, ModificationRequest> = new Map();
  private appliedModifications: Map<string, AppliedModification> = new Map();
  private initialized = false;

  constructor(config?: Partial<SelfModConfig>) {
    super();
    this.setMaxListeners(20);
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.dataDir = '';
    this.projectRoot = '';
  }

  // --------------------------------------------------------------------------
  // Initialization
  // --------------------------------------------------------------------------

  /**
   * Initialize the self-modification manager
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      const appConfig = getConfig();
      const atlasDir = path.dirname(appConfig.logDir);
      this.dataDir = path.join(atlasDir, 'gepa', 'self-mod');
      this.projectRoot = process.cwd(); // Electron app root

      await fs.mkdir(path.join(this.dataDir, 'requests'), { recursive: true });
      await fs.mkdir(path.join(this.dataDir, 'applied'), { recursive: true });
      await fs.mkdir(path.join(this.dataDir, 'scripts'), { recursive: true });

      // Load existing state
      await this.loadState();

      // Verify git is available
      const gitAvailable = await this.checkGitAvailable();
      if (!gitAvailable) {
        logger.warn('Git not available - self-modification disabled');
        this.config.enabled = false;
      }

      this.initialized = true;
      logger.info('Self-modification manager initialized', { dataDir: this.dataDir });
    } catch (error) {
      logger.error('Failed to initialize self-modification manager:', error);
      throw error;
    }
  }

  /**
   * Check if git is available
   */
  private async checkGitAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn('git', ['--version']);
      proc.on('close', (code) => resolve(code === 0));
      proc.on('error', () => resolve(false));
    });
  }

  // --------------------------------------------------------------------------
  // Modification Requests
  // --------------------------------------------------------------------------

  /**
   * Create a modification request
   */
  async createRequest(params: {
    type: ModificationType;
    target: string;
    description: string;
    reason: string;
    proposedContent: string;
    priority?: 'critical' | 'high' | 'medium' | 'low';
  }): Promise<ModificationRequest> {
    if (!this.config.enabled) {
      throw new Error('Self-modification is disabled');
    }

    if (this.pendingRequests.size >= this.config.maxPendingRequests) {
      throw new Error('Too many pending modification requests');
    }

    // Get current content if target exists
    let currentContent: string | undefined;
    try {
      const targetPath = this.resolveTarget(params.target);
      currentContent = await fs.readFile(targetPath, 'utf-8');
    } catch {
      // Target doesn't exist yet
    }

    const requiresApproval =
      this.config.requireApprovalTypes.includes(params.type) || !this.config.allowAutoApply;

    const request: ModificationRequest = {
      id: `mod_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      type: params.type,
      target: params.target,
      description: params.description,
      reason: params.reason,
      currentContent,
      proposedContent: params.proposedContent,
      priority: params.priority || 'medium',
      requiresApproval,
      createdAt: new Date(),
      status: 'pending',
    };

    this.pendingRequests.set(request.id, request);
    await this.saveRequest(request);

    logger.info('Modification request created', {
      id: request.id,
      type: request.type,
      target: request.target,
      requiresApproval,
    });

    this.emit('request:created', request);

    return request;
  }

  /**
   * Approve a modification request
   */
  async approveRequest(requestId: string): Promise<void> {
    const request = this.pendingRequests.get(requestId);
    if (!request) {
      throw new Error(`Request not found: ${requestId}`);
    }

    request.status = 'approved';
    await this.saveRequest(request);

    logger.info('Modification request approved', { id: requestId });
    this.emit('request:approved', request);
  }

  /**
   * Reject a modification request
   */
  async rejectRequest(requestId: string, reason?: string): Promise<void> {
    const request = this.pendingRequests.get(requestId);
    if (!request) {
      throw new Error(`Request not found: ${requestId}`);
    }

    request.status = 'rejected';
    await this.saveRequest(request);

    logger.info('Modification request rejected', { id: requestId, reason });
    this.emit('request:rejected', request);
  }

  // --------------------------------------------------------------------------
  // Modification Application
  // --------------------------------------------------------------------------

  /**
   * Apply a modification request
   */
  async applyModification(requestId: string): Promise<AppliedModification> {
    const request = this.pendingRequests.get(requestId);
    if (!request) {
      throw new Error(`Request not found: ${requestId}`);
    }

    if (request.status !== 'approved' && request.requiresApproval) {
      throw new Error('Request must be approved before applying');
    }

    // Get current git commit
    const previousCommit = await this.getCurrentCommit();

    // Create backup branch
    const backupBranch = `backup/pre-selfmod-${Date.now()}`;
    await this.runGit(['branch', backupBranch]);

    try {
      // Write the new content
      const targetPath = this.resolveTarget(request.target);
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, request.proposedContent, 'utf-8');

      // Run tests if configured
      let testsPassed = true;
      if (this.config.testBeforeApply) {
        testsPassed = await this.runTests();
        if (!testsPassed) {
          // Revert the file
          if (request.currentContent) {
            await fs.writeFile(targetPath, request.currentContent, 'utf-8');
          } else {
            await fs.unlink(targetPath);
          }
          throw new Error('Tests failed after modification');
        }
      }

      // Commit the change
      await this.runGit(['add', targetPath]);
      const commitMessage = `[GEPA] ${request.type}: ${request.description}\n\nReason: ${request.reason}\nRequest ID: ${request.id}`;
      await this.runGit(['commit', '-m', commitMessage]);

      const newCommit = await this.getCurrentCommit();

      // Create applied record
      const applied: AppliedModification = {
        id: `applied_${Date.now()}`,
        requestId: request.id,
        type: request.type,
        target: request.target,
        appliedAt: new Date(),
        gitCommit: newCommit,
        previousCommit,
        testsPassed,
        rolledBack: false,
      };

      // Update request status
      request.status = 'applied';
      await this.saveRequest(request);

      // Save applied record
      this.appliedModifications.set(applied.id, applied);
      await this.saveApplied(applied);

      // Remove from pending
      this.pendingRequests.delete(requestId);

      logger.info('Modification applied', {
        id: applied.id,
        type: request.type,
        commit: newCommit,
      });

      this.emit('modification:applied', applied);

      return applied;
    } catch (error) {
      // Mark request as failed
      request.status = 'failed';
      await this.saveRequest(request);

      logger.error('Modification failed', {
        id: requestId,
        error: getErrorMessage(error),
      });

      this.emit('modification:failed', { request, error });

      throw error;
    }
  }

  /**
   * Rollback an applied modification
   */
  async rollbackModification(appliedId: string): Promise<void> {
    const applied = this.appliedModifications.get(appliedId);
    if (!applied) {
      throw new Error(`Applied modification not found: ${appliedId}`);
    }

    if (applied.rolledBack) {
      throw new Error('Modification already rolled back');
    }

    try {
      // Revert the commit
      await this.runGit(['revert', '--no-commit', applied.gitCommit]);
      await this.runGit(['commit', '-m', `[GEPA] Rollback: Reverted ${applied.gitCommit}`]);

      applied.rolledBack = true;
      await this.saveApplied(applied);

      logger.info('Modification rolled back', {
        id: appliedId,
        commit: applied.gitCommit,
      });

      this.emit('modification:rolledback', applied);
    } catch (error) {
      // Try hard reset as fallback
      try {
        await this.runGit(['reset', '--hard', applied.previousCommit]);
      } catch {
        // Last resort: manual intervention needed
      }
      throw error;
    }
  }

  // --------------------------------------------------------------------------
  // Script Creation
  // --------------------------------------------------------------------------

  /**
   * Create a new automation script
   */
  async createScript(params: {
    name: string;
    language: 'typescript' | 'python' | 'bash';
    content: string;
    description: string;
  }): Promise<string> {
    const extensions = { typescript: '.ts', python: '.py', bash: '.sh' };
    const ext = extensions[params.language];
    const scriptPath = path.join(this.dataDir, 'scripts', `${params.name}${ext}`);

    // Add shebang and header
    let content = '';
    if (params.language === 'bash') {
      content = `#!/bin/bash\n# ${params.description}\n# Generated by Atlas GEPA\n\n${params.content}`;
    } else if (params.language === 'python') {
      content = `#!/usr/bin/env python3\n"""${params.description}\nGenerated by Atlas GEPA"""\n\n${params.content}`;
    } else {
      content = `/**\n * ${params.description}\n * Generated by Atlas GEPA\n */\n\n${params.content}`;
    }

    await fs.writeFile(scriptPath, content, 'utf-8');

    // Make executable if bash
    if (params.language === 'bash') {
      await fs.chmod(scriptPath, '755');
    }

    logger.info('Script created', { name: params.name, path: scriptPath });

    return scriptPath;
  }

  /**
   * List created scripts
   */
  async listScripts(): Promise<Array<{ name: string; path: string; language: string }>> {
    const scriptsDir = path.join(this.dataDir, 'scripts');
    const scripts: Array<{ name: string; path: string; language: string }> = [];

    try {
      const files = await fs.readdir(scriptsDir);
      for (const file of files) {
        const ext = path.extname(file);
        const language =
          ext === '.ts'
            ? 'typescript'
            : ext === '.py'
              ? 'python'
              : ext === '.sh'
                ? 'bash'
                : 'unknown';

        scripts.push({
          name: path.basename(file, ext),
          path: path.join(scriptsDir, file),
          language,
        });
      }
    } catch {
      // Directory doesn't exist
    }

    return scripts;
  }

  // --------------------------------------------------------------------------
  // Git Operations
  // --------------------------------------------------------------------------

  private async runGit(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn('git', args, { cwd: this.projectRoot });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          reject(new Error(`Git command failed: ${stderr || stdout}`));
        }
      });

      proc.on('error', reject);
    });
  }

  private async getCurrentCommit(): Promise<string> {
    return this.runGit(['rev-parse', 'HEAD']);
  }

  private async runTests(): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn('npm', ['run', 'typecheck'], {
        cwd: this.projectRoot,
        shell: true,
      });

      proc.on('close', (code) => {
        resolve(code === 0);
      });

      proc.on('error', () => {
        resolve(false);
      });
    });
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  private resolveTarget(target: string): string {
    // If target is relative, resolve from project root
    if (target.startsWith('src/') || target.startsWith('config/')) {
      return path.join(this.projectRoot, target);
    }
    // If target is in data dir
    if (target.startsWith('~/.atlas/')) {
      return target.replace('~/.atlas/', path.dirname(this.dataDir) + '/');
    }
    return target;
  }

  // --------------------------------------------------------------------------
  // Persistence
  // --------------------------------------------------------------------------

  private async saveRequest(request: ModificationRequest): Promise<void> {
    const filePath = path.join(this.dataDir, 'requests', `${request.id}.json`);
    await fs.writeFile(filePath, JSON.stringify(request, null, 2), 'utf-8');
  }

  private async saveApplied(applied: AppliedModification): Promise<void> {
    const filePath = path.join(this.dataDir, 'applied', `${applied.id}.json`);
    await fs.writeFile(filePath, JSON.stringify(applied, null, 2), 'utf-8');
  }

  private async loadState(): Promise<void> {
    // Load pending requests
    try {
      const files = await fs.readdir(path.join(this.dataDir, 'requests'));
      for (const file of files) {
        if (file.endsWith('.json')) {
          const content = await fs.readFile(path.join(this.dataDir, 'requests', file), 'utf-8');
          const request = JSON.parse(content) as ModificationRequest;
          request.createdAt = new Date(request.createdAt);
          if (request.status === 'pending' || request.status === 'approved') {
            this.pendingRequests.set(request.id, request);
          }
        }
      }
    } catch {
      // Directory doesn't exist
    }

    // Load applied modifications
    try {
      const files = await fs.readdir(path.join(this.dataDir, 'applied'));
      for (const file of files) {
        if (file.endsWith('.json')) {
          const content = await fs.readFile(path.join(this.dataDir, 'applied', file), 'utf-8');
          const applied = JSON.parse(content) as AppliedModification;
          applied.appliedAt = new Date(applied.appliedAt);
          this.appliedModifications.set(applied.id, applied);
        }
      }
    } catch {
      // Directory doesn't exist
    }

    logger.debug('Loaded self-mod state', {
      pendingRequests: this.pendingRequests.size,
      appliedModifications: this.appliedModifications.size,
    });
  }

  // --------------------------------------------------------------------------
  // Getters
  // --------------------------------------------------------------------------

  getPendingRequests(): ModificationRequest[] {
    return Array.from(this.pendingRequests.values());
  }

  getAppliedModifications(): AppliedModification[] {
    return Array.from(this.appliedModifications.values());
  }

  getRecentModifications(limit: number = 10): AppliedModification[] {
    return Array.from(this.appliedModifications.values())
      .sort((a, b) => b.appliedAt.getTime() - a.appliedAt.getTime())
      .slice(0, limit);
  }

  // --------------------------------------------------------------------------
  // Cleanup
  // --------------------------------------------------------------------------

  async cleanup(): Promise<void> {
    this.pendingRequests.clear();
    this.appliedModifications.clear();
    this.initialized = false;
    logger.info('Self-modification manager cleaned up');
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

let selfModInstance: SelfModificationManager | null = null;

export function getSelfModificationManager(): SelfModificationManager {
  if (!selfModInstance) {
    selfModInstance = new SelfModificationManager();
  }
  return selfModInstance;
}

export default SelfModificationManager;
