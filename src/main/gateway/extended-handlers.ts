/**
 * @fileoverview Extended Gateway Handlers for CLI and Web UI
 * @module gateway/extended-handlers
 * 
 * @description
 * Registers additional request handlers on the gateway for:
 * - Sessions management
 * - DM pairing
 * - Cron/scheduling
 * - Channel management
 * - Skills management
 * - Node management
 * 
 * These handlers support both the CLI and Web UI interfaces.
 */

import { Gateway, GatewayClient } from './index';
import { createModuleLogger } from '../utils/logger';
import { getChannelManager } from '../channels';
import { getClawdHubClient, getGitInstaller, InstalledSkill } from '../skills';
import type { ChannelType } from '../../shared/types/gateway';

const logger = createModuleLogger('GatewayHandlers');

// In-memory stores (these would connect to real managers in production)
interface Session {
  id: string;
  channelType: string;
  chatId: string;
  state: 'active' | 'idle' | 'ended';
  createdAt: number;
  lastActivity: number;
  messageCount: number;
  metadata?: Record<string, unknown>;
}

interface PairingRequest {
  id: string;
  channelType: string;
  chatId: string;
  senderName: string;
  senderUsername?: string;
  firstMessage: string;
  timestamp: number;
  status: 'pending' | 'approved' | 'denied' | 'blocked';
}

interface CronTask {
  id: string;
  name: string;
  schedule: string;
  command: string;
  enabled: boolean;
  lastRun?: number;
  nextRun?: number;
  runCount: number;
  createdAt: number;
}

// Stores
const sessions = new Map<string, Session>();
const pairingRequests = new Map<string, PairingRequest>();
const cronTasks = new Map<string, CronTask>();
const blockedSenders = new Set<string>();

/**
 * Register extended handlers on the gateway
 */
export function registerExtendedHandlers(gateway: Gateway): void {
  logger.info('Registering extended gateway handlers');

  // ===========================================================================
  // Session Handlers
  // ===========================================================================

  gateway.registerHandler('sessions.list', async (client, params) => {
    const { state, channelType, limit = 50, offset = 0 } = (params || {}) as {
      state?: string;
      channelType?: string;
      limit?: number;
      offset?: number;
    };

    let list = Array.from(sessions.values());

    if (state) {
      list = list.filter(s => s.state === state);
    }
    if (channelType) {
      list = list.filter(s => s.channelType === channelType);
    }

    // Sort by last activity desc
    list.sort((a, b) => b.lastActivity - a.lastActivity);

    return {
      sessions: list.slice(offset, offset + limit),
      total: list.length,
    };
  });

  gateway.registerHandler('sessions.get', async (client, params) => {
    const { sessionId } = params as { sessionId: string };
    const session = sessions.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }
    return session;
  });

  gateway.registerHandler('sessions.end', async (client, params) => {
    const { sessionId } = params as { sessionId: string };
    const session = sessions.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }
    session.state = 'ended';
    return { success: true };
  });

  gateway.registerHandler('sessions.send', async (client, params) => {
    const { sessionId, message } = params as { sessionId: string; message: string };
    const session = sessions.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    const channelManager = getChannelManager();
    const adapter = channelManager.getAdapter(session.channelType as ChannelType);
    if (!adapter) {
      throw new Error(`Channel ${session.channelType} not connected`);
    }

    await adapter.send(session.chatId, message);
    session.lastActivity = Date.now();
    session.messageCount++;

    return { success: true };
  });

  // ===========================================================================
  // DM Pairing Handlers
  // ===========================================================================

  gateway.registerHandler('pairing.list', async () => {
    return {
      requests: Array.from(pairingRequests.values())
        .filter(r => r.status === 'pending')
        .sort((a, b) => b.timestamp - a.timestamp),
      blocked: Array.from(blockedSenders),
    };
  });

  gateway.registerHandler('pairing.approve', async (client, params) => {
    const { requestId } = params as { requestId: string };
    const request = pairingRequests.get(requestId);
    if (!request) {
      throw new Error('Pairing request not found');
    }

    request.status = 'approved';
    
    // Create session for this chat
    const sessionId = `${request.channelType}-${request.chatId}`;
    sessions.set(sessionId, {
      id: sessionId,
      channelType: request.channelType,
      chatId: request.chatId,
      state: 'active',
      createdAt: Date.now(),
      lastActivity: Date.now(),
      messageCount: 0,
      metadata: {
        senderName: request.senderName,
        senderUsername: request.senderUsername,
      },
    });

    // Notify via gateway
    gateway.broadcast('pairing.approved', { request, sessionId });

    return { success: true, sessionId };
  });

  gateway.registerHandler('pairing.deny', async (client, params) => {
    const { requestId } = params as { requestId: string };
    const request = pairingRequests.get(requestId);
    if (!request) {
      throw new Error('Pairing request not found');
    }

    request.status = 'denied';
    gateway.broadcast('pairing.denied', { request });

    return { success: true };
  });

  gateway.registerHandler('pairing.block', async (client, params) => {
    const { requestId } = params as { requestId: string };
    const request = pairingRequests.get(requestId);
    if (!request) {
      throw new Error('Pairing request not found');
    }

    request.status = 'blocked';
    blockedSenders.add(`${request.channelType}:${request.chatId}`);
    gateway.broadcast('pairing.blocked', { request });

    return { success: true };
  });

  gateway.registerHandler('pairing.unblock', async (client, params) => {
    const { channelType, chatId } = params as { channelType: string; chatId: string };
    const key = `${channelType}:${chatId}`;
    blockedSenders.delete(key);
    return { success: true };
  });

  // ===========================================================================
  // Cron/Scheduling Handlers
  // ===========================================================================

  gateway.registerHandler('cron.list', async () => {
    return {
      tasks: Array.from(cronTasks.values())
        .sort((a, b) => (a.nextRun || 0) - (b.nextRun || 0)),
    };
  });

  gateway.registerHandler('cron.create', async (client, params) => {
    const { name, schedule, command } = params as {
      name: string;
      schedule: string;
      command: string;
    };

    const id = `cron-${Date.now()}`;
    const task: CronTask = {
      id,
      name,
      schedule,
      command,
      enabled: true,
      runCount: 0,
      createdAt: Date.now(),
      nextRun: calculateNextRun(schedule),
    };

    cronTasks.set(id, task);
    gateway.broadcast('cron.created', { task });

    return { task };
  });

  gateway.registerHandler('cron.pause', async (client, params) => {
    const { taskId } = params as { taskId: string };
    const task = cronTasks.get(taskId);
    if (!task) {
      throw new Error('Task not found');
    }

    task.enabled = false;
    gateway.broadcast('cron.paused', { taskId });

    return { success: true };
  });

  gateway.registerHandler('cron.resume', async (client, params) => {
    const { taskId } = params as { taskId: string };
    const task = cronTasks.get(taskId);
    if (!task) {
      throw new Error('Task not found');
    }

    task.enabled = true;
    task.nextRun = calculateNextRun(task.schedule);
    gateway.broadcast('cron.resumed', { taskId });

    return { success: true };
  });

  gateway.registerHandler('cron.cancel', async (client, params) => {
    const { taskId } = params as { taskId: string };
    if (!cronTasks.has(taskId)) {
      throw new Error('Task not found');
    }

    cronTasks.delete(taskId);
    gateway.broadcast('cron.cancelled', { taskId });

    return { success: true };
  });

  gateway.registerHandler('cron.trigger', async (client, params) => {
    const { taskId } = params as { taskId: string };
    const task = cronTasks.get(taskId);
    if (!task) {
      throw new Error('Task not found');
    }

    // Execute command (simplified - would use proper execution in production)
    task.lastRun = Date.now();
    task.runCount++;
    gateway.broadcast('cron.triggered', { taskId, command: task.command });

    return { success: true };
  });

  // ===========================================================================
  // Channel Handlers
  // ===========================================================================

  gateway.registerHandler('channels.list', async () => {
    const channelManager = getChannelManager();
    const adapters = channelManager.listAdapters();

    return {
      channels: adapters.map(name => {
        const adapter = channelManager.getAdapter(name);
        return {
          name,
          type: name,
          connected: adapter?.isConnected || false,
          status: adapter?.isConnected ? 'connected' : 'disconnected',
        };
      }),
    };
  });

  gateway.registerHandler('channels.connect', async (client, params) => {
    const { channelType, config } = params as {
      channelType: string;
      config?: Record<string, unknown>;
    };

    const channelManager = getChannelManager();
    const adapter = channelManager.getAdapter(channelType as ChannelType);

    if (!adapter) {
      throw new Error(`Unknown channel type: ${channelType}`);
    }

    await adapter.connect(config || {});
    gateway.broadcast('channels.connected', { channelType });

    return { success: true };
  });

  gateway.registerHandler('channels.disconnect', async (client, params) => {
    const { channelType } = params as { channelType: string };

    const channelManager = getChannelManager();
    const adapter = channelManager.getAdapter(channelType as ChannelType);

    if (!adapter) {
      throw new Error(`Unknown channel type: ${channelType}`);
    }

    await adapter.disconnect();
    gateway.broadcast('channels.disconnected', { channelType });

    return { success: true };
  });

  gateway.registerHandler('channels.send', async (client, params) => {
    const { channelType, chatId, message, options } = params as {
      channelType: string;
      chatId: string;
      message: string;
      options?: Record<string, unknown>;
    };

    const channelManager = getChannelManager();
    const adapter = channelManager.getAdapter(channelType as ChannelType);

    if (!adapter) {
      throw new Error(`Unknown channel type: ${channelType}`);
    }

    if (!adapter.isConnected) {
      throw new Error(`Channel ${channelType} not connected`);
    }

    const messageId = await adapter.send(chatId, message, options);
    return { messageId };
  });

  // ===========================================================================
  // Skills Handlers
  // ===========================================================================

  gateway.registerHandler('skills.list', async () => {
    const installer = getGitInstaller();
    return {
      skills: installer.getInstalledSkills(),
    };
  });

  gateway.registerHandler('skills.search', async (client, params) => {
    const { query, category, page, perPage } = params as {
      query?: string;
      category?: string;
      page?: number;
      perPage?: number;
    };

    const clawdHub = getClawdHubClient();
    return clawdHub.search({ query, category, page, perPage });
  });

  gateway.registerHandler('skills.categories', async () => {
    const clawdHub = getClawdHubClient();
    return {
      categories: await clawdHub.getCategories(),
    };
  });

  gateway.registerHandler('skills.trending', async (client, params) => {
    const { limit = 10 } = (params || {}) as { limit?: number };
    const clawdHub = getClawdHubClient();
    return {
      skills: await clawdHub.getTrending(limit),
    };
  });

  gateway.registerHandler('skills.install', async (client, params) => {
    const { skillId, repository, branch, tag, force } = params as {
      skillId?: string;
      repository?: string;
      branch?: string;
      tag?: string;
      force?: boolean;
    };

    const installer = getGitInstaller();

    // Set up progress forwarding
    const progressHandler = (progress: unknown) => {
      gateway.sendEvent(client.id, 'skills.install.progress', progress);
    };
    installer.on('progress', progressHandler);

    try {
      let skill: InstalledSkill;

      if (skillId) {
        // Install from ClawdHub
        skill = await installer.installFromClawdHub(skillId, { branch, tag, force });
      } else if (repository) {
        // Install from git URL
        skill = await installer.installFromGit(repository, { branch, tag, force });
      } else {
        throw new Error('Either skillId or repository must be provided');
      }

      gateway.broadcast('skills.installed', { skill });
      return { skill };
    } finally {
      installer.off('progress', progressHandler);
    }
  });

  gateway.registerHandler('skills.uninstall', async (client, params) => {
    const { skillId } = params as { skillId: string };
    const installer = getGitInstaller();

    await installer.uninstall(skillId);
    gateway.broadcast('skills.uninstalled', { skillId });

    return { success: true };
  });

  gateway.registerHandler('skills.enable', async (client, params) => {
    const { skillId } = params as { skillId: string };
    const installer = getGitInstaller();

    await installer.enable(skillId);
    gateway.broadcast('skills.enabled', { skillId });

    return { success: true };
  });

  gateway.registerHandler('skills.disable', async (client, params) => {
    const { skillId } = params as { skillId: string };
    const installer = getGitInstaller();

    await installer.disable(skillId);
    gateway.broadcast('skills.disabled', { skillId });

    return { success: true };
  });

  gateway.registerHandler('skills.checkUpdates', async (client, params) => {
    const { skillId } = params as { skillId?: string };
    const installer = getGitInstaller();

    if (skillId) {
      return installer.checkForUpdates(skillId);
    }

    // Check all skills
    const updates: Array<{ skillId: string; hasUpdate: boolean; latestVersion?: string }> = [];
    for (const skill of installer.getInstalledSkills()) {
      try {
        const update = await installer.checkForUpdates(skill.id);
        updates.push({ skillId: skill.id, ...update });
      } catch {
        // Skip failed checks
      }
    }

    return { updates };
  });

  gateway.registerHandler('skills.update', async (client, params) => {
    const { skillId } = params as { skillId: string };
    const installer = getGitInstaller();

    const skill = await installer.update(skillId);
    gateway.broadcast('skills.updated', { skill });

    return { skill };
  });

  // ===========================================================================
  // Node Extended Handlers
  // ===========================================================================

  gateway.registerHandler('nodes.list', async () => {
    const nodes = gateway.getNodes();
    return {
      nodes: nodes.map(n => ({
        id: n.id,
        name: n.name,
        platform: n.platform,
        capabilities: n.capabilities,
        pairingStatus: n.pairingStatus,
        connectedAt: n.connectedAt,
        lastActivity: n.lastActivity,
      })),
    };
  });

  gateway.registerHandler('nodes.capabilities', async (client, params) => {
    const { nodeId } = params as { nodeId: string };
    const node = gateway.getClient(nodeId);

    if (!node || node.role !== 'node') {
      throw new Error('Node not found');
    }

    return {
      capabilities: node.capabilities || [],
      permissions: node.permissions || {},
    };
  });

  // ===========================================================================
  // Config Handlers
  // ===========================================================================

  gateway.registerHandler('config.get', async (client, params) => {
    const { key } = params as { key?: string };
    // Would connect to settings store in production
    return { value: null };
  });

  gateway.registerHandler('config.set', async (client, params) => {
    const { key, value } = params as { key: string; value: unknown };
    // Would connect to settings store in production
    gateway.broadcast('config.changed', { key, value });
    return { success: true };
  });

  logger.info('Extended gateway handlers registered');
}

/**
 * Calculate next run time from cron schedule
 */
function calculateNextRun(schedule: string): number {
  // Simplified - would use cron parser in production
  // For now, just return 1 minute from now
  return Date.now() + 60000;
}

/**
 * Add a pairing request (called by channel adapters)
 */
export function addPairingRequest(
  channelType: string,
  chatId: string,
  senderName: string,
  firstMessage: string,
  senderUsername?: string
): PairingRequest {
  const id = `pair-${Date.now()}`;
  const request: PairingRequest = {
    id,
    channelType,
    chatId,
    senderName,
    senderUsername,
    firstMessage,
    timestamp: Date.now(),
    status: 'pending',
  };

  pairingRequests.set(id, request);
  return request;
}

/**
 * Check if a sender is blocked
 */
export function isSenderBlocked(channelType: string, chatId: string): boolean {
  return blockedSenders.has(`${channelType}:${chatId}`);
}

/**
 * Check if a sender is approved
 */
export function isSenderApproved(channelType: string, chatId: string): boolean {
  const sessionId = `${channelType}-${chatId}`;
  return sessions.has(sessionId);
}

/**
 * Create or get session for a chat
 */
export function getOrCreateSession(
  channelType: string,
  chatId: string,
  metadata?: Record<string, unknown>
): Session {
  const sessionId = `${channelType}-${chatId}`;
  
  let session = sessions.get(sessionId);
  if (!session) {
    session = {
      id: sessionId,
      channelType,
      chatId,
      state: 'active',
      createdAt: Date.now(),
      lastActivity: Date.now(),
      messageCount: 0,
      metadata,
    };
    sessions.set(sessionId, session);
  }

  return session;
}

/**
 * Update session activity
 */
export function updateSessionActivity(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (session) {
    session.lastActivity = Date.now();
    session.messageCount++;
  }
}
