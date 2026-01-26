/**
 * Atlas Desktop - Dashboard Persistence
 * Handles saving and loading dashboard data (workflows, goals, agents)
 */

import * as fse from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import { createModuleLogger } from '../utils/logger';
import { createNote, readNote, updateNote } from '../memory/note-writer';
import { getVaultPath } from '../memory/obsidian-brain';
import { clamp100 } from '../../shared/utils';

const logger = createModuleLogger('DashboardPersistence');

// ============================================================================
// Types
// ============================================================================

export interface DashboardGoal {
  id: string;
  title: string;
  category: 'research' | 'learning' | 'tasks' | 'trading' | 'health' | 'other';
  progress: number;
  target?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DashboardWorkflow {
  id: string;
  name: string;
  status: 'listening' | 'running' | 'scheduled' | 'paused' | 'error';
  lastRun?: string;
  nextRun?: string;
  currentStep?: number;
  totalSteps?: number;
  trigger?: string;
  nodes?: WorkflowNode[];
  edges?: WorkflowEdge[];
}

export interface WorkflowNode {
  id: string;
  type: 'trigger' | 'action' | 'condition' | 'output';
  position: { x: number; y: number };
  data: {
    label: string;
    config?: Record<string, unknown>;
  };
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  type?: string;
}

export interface DashboardAgent {
  id: string;
  name: string;
  icon?: string;
  status: 'active' | 'idle' | 'running' | 'error';
  taskCount: number;
  currentTask?: string;
  lastActive?: string;
}

export interface DashboardIntegration {
  id: string;
  name: string;
  icon: string;
  status: 'connected' | 'warning' | 'disconnected' | 'unconfigured';
  lastSync?: string;
  error?: string;
}

export interface DashboardData {
  goals: DashboardGoal[];
  workflows: DashboardWorkflow[];
  agents: DashboardAgent[];
  integrations: DashboardIntegration[];
  lastUpdated: string;
}

// ============================================================================
// Paths
// ============================================================================

function getDashboardDir(): string {
  return path.join(os.homedir(), '.atlas', 'dashboard');
}

function getWorkflowsPath(): string {
  return path.join(getDashboardDir(), 'workflows.json');
}

function getAgentsPath(): string {
  return path.join(getDashboardDir(), 'agents.json');
}

function getIntegrationsPath(): string {
  return path.join(getDashboardDir(), 'integrations.json');
}

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initialize dashboard persistence directories
 */
export async function initializeDashboardPersistence(): Promise<void> {
  const dashboardDir = getDashboardDir();
  await fse.ensureDir(dashboardDir);
  logger.info('Dashboard persistence initialized', { path: dashboardDir });
}

// ============================================================================
// Workflow Persistence (JSON file)
// ============================================================================

/**
 * Save workflows to disk
 */
export async function saveWorkflows(workflows: DashboardWorkflow[]): Promise<void> {
  const filePath = getWorkflowsPath();
  await fse.ensureDir(path.dirname(filePath));
  await fse.writeJson(filePath, { workflows, updatedAt: new Date().toISOString() }, { spaces: 2 });
  logger.debug('Workflows saved', { count: workflows.length });
}

/**
 * Load workflows from disk
 */
export async function loadWorkflows(): Promise<DashboardWorkflow[]> {
  const filePath = getWorkflowsPath();

  if (!(await fse.pathExists(filePath))) {
    logger.debug('No workflows file found, returning empty array');
    return [];
  }

  try {
    const data = await fse.readJson(filePath);
    logger.debug('Workflows loaded', { count: data.workflows?.length || 0 });
    return data.workflows || [];
  } catch (error) {
    logger.error('Failed to load workflows', { error });
    return [];
  }
}

/**
 * Save a single workflow
 */
export async function saveWorkflow(workflow: DashboardWorkflow): Promise<void> {
  const workflows = await loadWorkflows();
  const index = workflows.findIndex((w) => w.id === workflow.id);

  if (index >= 0) {
    workflows[index] = workflow;
  } else {
    workflows.push(workflow);
  }

  await saveWorkflows(workflows);
}

/**
 * Delete a workflow
 */
export async function deleteWorkflow(workflowId: string): Promise<boolean> {
  const workflows = await loadWorkflows();
  const filtered = workflows.filter((w) => w.id !== workflowId);

  if (filtered.length === workflows.length) {
    return false; // Not found
  }

  await saveWorkflows(filtered);
  return true;
}

// ============================================================================
// Goal Persistence (Obsidian Vault)
// ============================================================================

const GOALS_NOTE_PATH = 'profile/goals.md';

/**
 * Save goals to Obsidian vault
 */
export async function saveGoals(goals: DashboardGoal[]): Promise<void> {
  const vaultPath = getVaultPath();
  const notePath = path.join(vaultPath, GOALS_NOTE_PATH);

  // Build markdown content
  const content = buildGoalsMarkdown(goals);
  const metadata = {
    type: 'goals',
    count: goals.length,
    last_modified: new Date().toISOString(),
    tags: ['goals', 'dashboard'],
  };

  // Ensure profile directory exists
  await fse.ensureDir(path.dirname(notePath));

  // Check if note exists
  if (await fse.pathExists(notePath)) {
    await updateNote(GOALS_NOTE_PATH, {
      content,
      metadata,
    });
  } else {
    await createNote('profile', 'goals', content, metadata, { overwrite: true });
  }

  logger.debug('Goals saved to Obsidian', { count: goals.length });
}

/**
 * Load goals from Obsidian vault
 */
export async function loadGoals(): Promise<DashboardGoal[]> {
  const vaultPath = getVaultPath();
  const notePath = path.join(vaultPath, GOALS_NOTE_PATH);

  if (!(await fse.pathExists(notePath))) {
    logger.debug('No goals note found, returning empty array');
    return [];
  }

  try {
    const note = await readNote(GOALS_NOTE_PATH);
    if (!note) return [];

    // Parse goals from markdown
    const goals = parseGoalsFromMarkdown(note.content);
    logger.debug('Goals loaded from Obsidian', { count: goals.length });
    return goals;
  } catch (error) {
    logger.error('Failed to load goals', { error });
    return [];
  }
}

/**
 * Save a single goal
 */
export async function saveGoal(goal: DashboardGoal): Promise<void> {
  const goals = await loadGoals();
  const index = goals.findIndex((g) => g.id === goal.id);

  if (index >= 0) {
    goals[index] = goal;
  } else {
    goals.push(goal);
  }

  await saveGoals(goals);
}

/**
 * Delete a goal
 */
export async function deleteGoal(goalId: string): Promise<boolean> {
  const goals = await loadGoals();
  const filtered = goals.filter((g) => g.id !== goalId);

  if (filtered.length === goals.length) {
    return false; // Not found
  }

  await saveGoals(filtered);
  return true;
}

/**
 * Update goal progress
 */
export async function updateGoalProgress(goalId: string, progress: number): Promise<boolean> {
  const goals = await loadGoals();
  const goal = goals.find((g) => g.id === goalId);

  if (!goal) return false;

  goal.progress = clamp100(progress);
  goal.updatedAt = new Date().toISOString();

  await saveGoals(goals);
  return true;
}

/**
 * Build markdown content for goals
 */
function buildGoalsMarkdown(goals: DashboardGoal[]): string {
  const lines: string[] = ['# Goals', '', 'Active goals tracked by Atlas.', ''];

  // Group by category
  const categories = ['research', 'learning', 'tasks', 'trading', 'health', 'other'] as const;

  for (const category of categories) {
    const categoryGoals = goals.filter((g) => g.category === category);
    if (categoryGoals.length === 0) continue;

    lines.push(`## ${category.charAt(0).toUpperCase() + category.slice(1)}`);
    lines.push('');

    for (const goal of categoryGoals) {
      const progressBar = buildProgressBar(goal.progress);
      lines.push(`### ${goal.title}`);
      lines.push('');
      lines.push(`- **ID:** ${goal.id}`);
      lines.push(`- **Progress:** ${progressBar} ${goal.progress}%`);
      if (goal.target) {
        lines.push(`- **Target:** ${goal.target}`);
      }
      lines.push(`- **Created:** ${goal.createdAt}`);
      lines.push(`- **Updated:** ${goal.updatedAt}`);
      lines.push('');
    }
  }

  // Add JSON data block for parsing
  lines.push('---');
  lines.push('');
  lines.push('<!-- GOAL_DATA_START');
  lines.push(JSON.stringify(goals, null, 2));
  lines.push('GOAL_DATA_END -->');

  return lines.join('\n');
}

/**
 * Parse goals from markdown content
 */
function parseGoalsFromMarkdown(content: string): DashboardGoal[] {
  // Try to extract JSON data block first
  const dataMatch = content.match(/<!-- GOAL_DATA_START\n([\s\S]*?)\nGOAL_DATA_END -->/);

  if (dataMatch) {
    try {
      return JSON.parse(dataMatch[1]);
    } catch {
      logger.warn('Failed to parse goal data block');
    }
  }

  // Fallback: Parse from markdown structure
  const goals: DashboardGoal[] = [];
  const goalBlocks = content.split(/^### /m).slice(1);

  for (const block of goalBlocks) {
    const lines = block.trim().split('\n');
    const title = lines[0]?.trim();
    if (!title) continue;

    const idMatch = block.match(/\*\*ID:\*\* (.+)/);
    const progressMatch = block.match(/(\d+)%/);
    const targetMatch = block.match(/\*\*Target:\*\* (.+)/);
    const createdMatch = block.match(/\*\*Created:\*\* (.+)/);
    const updatedMatch = block.match(/\*\*Updated:\*\* (.+)/);

    // Determine category from section header
    let category: DashboardGoal['category'] = 'other';
    const categoryMatch = content.substring(0, content.indexOf(title)).match(/## (\w+)\s*$/m);
    if (categoryMatch) {
      const cat = categoryMatch[1].toLowerCase();
      if (['research', 'learning', 'tasks', 'trading', 'health', 'other'].includes(cat)) {
        category = cat as DashboardGoal['category'];
      }
    }

    goals.push({
      id: idMatch?.[1] || `goal-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      title,
      category,
      progress: progressMatch ? parseInt(progressMatch[1], 10) : 0,
      target: targetMatch?.[1],
      createdAt: createdMatch?.[1] || new Date().toISOString(),
      updatedAt: updatedMatch?.[1] || new Date().toISOString(),
    });
  }

  return goals;
}

/**
 * Build a text progress bar
 */
function buildProgressBar(progress: number): string {
  const filled = Math.round(progress / 10);
  const empty = 10 - filled;
  return '[' + '='.repeat(filled) + '-'.repeat(empty) + ']';
}

// ============================================================================
// Agent Persistence (JSON file)
// ============================================================================

/**
 * Save agents to disk
 */
export async function saveAgents(agents: DashboardAgent[]): Promise<void> {
  const filePath = getAgentsPath();
  await fse.ensureDir(path.dirname(filePath));
  await fse.writeJson(filePath, { agents, updatedAt: new Date().toISOString() }, { spaces: 2 });
  logger.debug('Agents saved', { count: agents.length });
}

/**
 * Load agents from disk
 */
export async function loadAgents(): Promise<DashboardAgent[]> {
  const filePath = getAgentsPath();

  if (!(await fse.pathExists(filePath))) {
    // Return default agents
    return getDefaultAgents();
  }

  try {
    const data = await fse.readJson(filePath);
    return data.agents || getDefaultAgents();
  } catch (error) {
    logger.error('Failed to load agents', { error });
    return getDefaultAgents();
  }
}

/**
 * Get default agents
 */
function getDefaultAgents(): DashboardAgent[] {
  return [
    { id: 'agent-trading', name: 'Trading Bot', status: 'idle', taskCount: 0 },
    { id: 'agent-email', name: 'Email Manager', status: 'idle', taskCount: 0 },
    { id: 'agent-content', name: 'Content Generator', status: 'idle', taskCount: 0 },
    { id: 'agent-research', name: 'Research Agent', status: 'idle', taskCount: 0 },
    { id: 'agent-discord', name: 'Discord Bot', status: 'idle', taskCount: 0 },
  ];
}

// ============================================================================
// Integration Status (JSON file + real-time checks)
// ============================================================================

/**
 * Save integration status to disk
 */
export async function saveIntegrations(integrations: DashboardIntegration[]): Promise<void> {
  const filePath = getIntegrationsPath();
  await fse.ensureDir(path.dirname(filePath));
  await fse.writeJson(
    filePath,
    { integrations, updatedAt: new Date().toISOString() },
    { spaces: 2 }
  );
  logger.debug('Integrations saved', { count: integrations.length });
}

/**
 * Load integration status from disk
 */
export async function loadIntegrations(): Promise<DashboardIntegration[]> {
  const filePath = getIntegrationsPath();

  if (!(await fse.pathExists(filePath))) {
    return getDefaultIntegrations();
  }

  try {
    const data = await fse.readJson(filePath);
    return data.integrations || getDefaultIntegrations();
  } catch (error) {
    logger.error('Failed to load integrations', { error });
    return getDefaultIntegrations();
  }
}

/**
 * Get default integrations
 */
function getDefaultIntegrations(): DashboardIntegration[] {
  return [
    { id: 'gmail', name: 'Gmail', icon: 'mail', status: 'unconfigured' },
    { id: 'outlook', name: 'Outlook', icon: 'mail', status: 'unconfigured' },
    { id: 'spotify', name: 'Spotify', icon: 'music', status: 'unconfigured' },
    { id: 'discord', name: 'Discord', icon: 'message-circle', status: 'unconfigured' },
    { id: 'twilio', name: 'Twilio', icon: 'phone', status: 'unconfigured' },
    { id: 'brave', name: 'Brave', icon: 'globe', status: 'connected' },
    { id: 'binance', name: 'Binance', icon: 'trending-up', status: 'unconfigured' },
    { id: 'coinbase', name: 'Coinbase', icon: 'circle-dollar-sign', status: 'unconfigured' },
    { id: 'schwab', name: 'Schwab', icon: 'landmark', status: 'unconfigured' },
    { id: 'metatrader', name: 'MetaTrader', icon: 'bar-chart-2', status: 'unconfigured' },
    { id: 'youtube', name: 'YouTube', icon: 'youtube', status: 'unconfigured' },
    { id: 'tiktok', name: 'TikTok', icon: 'video', status: 'unconfigured' },
    { id: 'vscode', name: 'VS Code', icon: 'code', status: 'connected' },
    { id: 'github', name: 'GitHub', icon: 'github', status: 'unconfigured' },
    { id: 'truelayer', name: 'TrueLayer', icon: 'wallet', status: 'unconfigured' },
    { id: 'google-calendar', name: 'Google Calendar', icon: 'calendar', status: 'unconfigured' },
  ];
}

/**
 * Update a single integration status
 */
export async function updateIntegrationStatus(
  integrationId: string,
  status: DashboardIntegration['status'],
  error?: string
): Promise<void> {
  const integrations = await loadIntegrations();
  const integration = integrations.find((i) => i.id === integrationId);

  if (integration) {
    integration.status = status;
    integration.error = error;
    integration.lastSync = status === 'connected' ? new Date().toISOString() : integration.lastSync;
    await saveIntegrations(integrations);
  }
}

// ============================================================================
// Full Dashboard Data
// ============================================================================

/**
 * Load all dashboard data
 */
export async function loadDashboardData(): Promise<DashboardData> {
  const [goals, workflows, agents, integrations] = await Promise.all([
    loadGoals(),
    loadWorkflows(),
    loadAgents(),
    loadIntegrations(),
  ]);

  return {
    goals,
    workflows,
    agents,
    integrations,
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Save all dashboard data
 */
export async function saveDashboardData(data: Partial<DashboardData>): Promise<void> {
  const promises: Promise<void>[] = [];

  if (data.goals) promises.push(saveGoals(data.goals));
  if (data.workflows) promises.push(saveWorkflows(data.workflows));
  if (data.agents) promises.push(saveAgents(data.agents));
  if (data.integrations) promises.push(saveIntegrations(data.integrations));

  await Promise.all(promises);
}
