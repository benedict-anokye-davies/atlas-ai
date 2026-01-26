/**
 * Atlas Desktop - Dashboard IPC Handlers
 * Handles communication between main and renderer for dashboard features
 */

import { ipcMain } from 'electron';
import { createModuleLogger } from '../utils/logger';
import { getErrorMessage } from '../../shared/utils';
import {
  initializeDashboardPersistence,
  loadDashboardData,
  loadGoals,
  saveGoals,
  saveGoal,
  deleteGoal,
  updateGoalProgress,
  loadWorkflows,
  saveWorkflows,
  saveWorkflow,
  deleteWorkflow,
  loadAgents,
  saveAgents,
  loadIntegrations,
  saveIntegrations,
  updateIntegrationStatus,
  DashboardGoal,
  DashboardWorkflow,
  DashboardAgent,
  DashboardIntegration,
} from './persistence';
import { getTaskQueueManager } from '../agent/task-queue';

const logger = createModuleLogger('DashboardIPC');

// Track initialization
let initialized = false;

// Credit usage tracking
interface UsageRecord {
  timestamp: number;
  service: 'llm' | 'tts' | 'stt' | 'embedding';
  tokens?: number;
  characters?: number;
  duration?: number;
  cost?: number;
}

const usageHistory: UsageRecord[] = [];
const MAX_USAGE_HISTORY = 10000;

/**
 * Track API usage for credit accounting
 */
export function trackAPIUsage(record: Omit<UsageRecord, 'timestamp'>): void {
  const entry: UsageRecord = {
    ...record,
    timestamp: Date.now(),
  };
  usageHistory.push(entry);
  
  // Trim old records
  while (usageHistory.length > MAX_USAGE_HISTORY) {
    usageHistory.shift();
  }
}

/**
 * Get total credits used (estimated cost in cents)
 */
function calculateCreditsUsed(): number {
  // Simple cost estimation based on usage
  // Adjust these rates based on actual API pricing
  const rates = {
    llm: 0.002, // per 1K tokens
    tts: 0.015, // per 1K characters
    stt: 0.006, // per minute
    embedding: 0.0001, // per 1K tokens
  };

  let totalCost = 0;

  for (const record of usageHistory) {
    switch (record.service) {
      case 'llm':
        totalCost += ((record.tokens || 0) / 1000) * rates.llm;
        break;
      case 'tts':
        totalCost += ((record.characters || 0) / 1000) * rates.tts;
        break;
      case 'stt':
        totalCost += ((record.duration || 0) / 60) * rates.stt;
        break;
      case 'embedding':
        totalCost += ((record.tokens || 0) / 1000) * rates.embedding;
        break;
    }
  }

  // Convert to credits (100 credits = $1)
  return Math.round(totalCost * 100);
}

/**
 * Register all dashboard IPC handlers
 */
export function registerDashboardIPC(): void {
  logger.info('Registering dashboard IPC handlers...');

  // ============================================================================
  // Initialization
  // ============================================================================

  ipcMain.handle('dashboard:initialize', async () => {
    try {
      if (!initialized) {
        await initializeDashboardPersistence();
        initialized = true;
      }
      const data = await loadDashboardData();
      return { success: true, data };
    } catch (error) {
      logger.error('Failed to initialize dashboard', { error });
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('dashboard:get-data', async () => {
    try {
      if (!initialized) {
        await initializeDashboardPersistence();
        initialized = true;
      }
      const data = await loadDashboardData();
      return { success: true, data };
    } catch (error) {
      logger.error('Failed to get dashboard data', { error });
      return { success: false, error: String(error) };
    }
  });

  // ============================================================================
  // Goals
  // ============================================================================

  ipcMain.handle('dashboard:get-goals', async () => {
    try {
      const goals = await loadGoals();
      return { success: true, data: goals };
    } catch (error) {
      logger.error('Failed to get goals', { error });
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('dashboard:save-goals', async (_event, goals: DashboardGoal[]) => {
    try {
      await saveGoals(goals);
      return { success: true };
    } catch (error) {
      logger.error('Failed to save goals', { error });
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('dashboard:save-goal', async (_event, goal: DashboardGoal) => {
    try {
      await saveGoal(goal);
      return { success: true };
    } catch (error) {
      logger.error('Failed to save goal', { error });
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('dashboard:delete-goal', async (_event, goalId: string) => {
    try {
      const deleted = await deleteGoal(goalId);
      return { success: true, data: { deleted } };
    } catch (error) {
      logger.error('Failed to delete goal', { error });
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle(
    'dashboard:update-goal-progress',
    async (_event, goalId: string, progress: number) => {
      try {
        const updated = await updateGoalProgress(goalId, progress);
        return { success: true, data: { updated } };
      } catch (error) {
        logger.error('Failed to update goal progress', { error });
        return { success: false, error: String(error) };
      }
    }
  );

  // ============================================================================
  // Workflows
  // ============================================================================

  ipcMain.handle('dashboard:get-workflows', async () => {
    try {
      const workflows = await loadWorkflows();
      return { success: true, data: workflows };
    } catch (error) {
      logger.error('Failed to get workflows', { error });
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('dashboard:save-workflows', async (_event, workflows: DashboardWorkflow[]) => {
    try {
      await saveWorkflows(workflows);
      return { success: true };
    } catch (error) {
      logger.error('Failed to save workflows', { error });
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('dashboard:save-workflow', async (_event, workflow: DashboardWorkflow) => {
    try {
      await saveWorkflow(workflow);
      return { success: true };
    } catch (error) {
      logger.error('Failed to save workflow', { error });
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('dashboard:delete-workflow', async (_event, workflowId: string) => {
    try {
      const deleted = await deleteWorkflow(workflowId);
      return { success: true, data: { deleted } };
    } catch (error) {
      logger.error('Failed to delete workflow', { error });
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('dashboard:execute-workflow', async (_event, workflowId: string) => {
    try {
      // Load the workflow
      const workflows = await loadWorkflows();
      const workflow = workflows.find((w) => w.id === workflowId);

      if (!workflow) {
        return { success: false, error: 'Workflow not found' };
      }

      // Import and use the workflow manager
      const { getWorkflowManager, initializeWorkflowManager } = await import(
        '../automation/workflow-manager'
      );
      await initializeWorkflowManager();
      const manager = getWorkflowManager();

      // Convert dashboard workflow to manager format and save
      const savedWorkflow = await manager.saveWorkflow({
        name: workflow.name,
        description: `Dashboard workflow: ${workflow.name}`,
        nodes:
          workflow.nodes?.map((n) => ({
            id: n.id,
            type: n.type,
            position: n.position,
            data: {
              label: n.data.label,
              type: n.type,
              config: n.data.config || {},
            },
          })) || [],
        edges:
          workflow.edges?.map((e) => ({
            id: e.id,
            source: e.source,
            target: e.target,
            type: e.type,
          })) || [],
        enabled: true,
      });

      // Execute it
      const result = await manager.executeWorkflow(savedWorkflow.id);

      // Update dashboard workflow status
      const updatedWorkflow: DashboardWorkflow = {
        ...workflow,
        status: result.status === 'completed' ? 'running' : 'error',
        lastRun: new Date().toISOString(),
      };
      await saveWorkflow(updatedWorkflow);

      return { success: true, data: result };
    } catch (error) {
      logger.error('Failed to execute workflow', { workflowId, error });
      return { success: false, error: String(error) };
    }
  });

  // ============================================================================
  // Agents
  // ============================================================================

  ipcMain.handle('dashboard:get-agents', async () => {
    try {
      const agents = await loadAgents();
      return { success: true, data: agents };
    } catch (error) {
      logger.error('Failed to get agents', { error });
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('dashboard:save-agents', async (_event, agents: DashboardAgent[]) => {
    try {
      await saveAgents(agents);
      return { success: true };
    } catch (error) {
      logger.error('Failed to save agents', { error });
      return { success: false, error: String(error) };
    }
  });

  // ============================================================================
  // Integrations
  // ============================================================================

  ipcMain.handle('dashboard:get-integrations', async () => {
    try {
      const integrations = await loadIntegrations();
      return { success: true, data: integrations };
    } catch (error) {
      logger.error('Failed to get integrations', { error });
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle(
    'dashboard:save-integrations',
    async (_event, integrations: DashboardIntegration[]) => {
      try {
        await saveIntegrations(integrations);
        return { success: true };
      } catch (error) {
        logger.error('Failed to save integrations', { error });
        return { success: false, error: String(error) };
      }
    }
  );

  ipcMain.handle(
    'dashboard:update-integration-status',
    async (
      _event,
      integrationId: string,
      status: DashboardIntegration['status'],
      error?: string
    ) => {
      try {
        await updateIntegrationStatus(integrationId, status, error);
        return { success: true };
      } catch (err) {
        logger.error('Failed to update integration status', { error: err });
        return { success: false, error: String(err) };
      }
    }
  );

  // ============================================================================
  // Real-time Metrics
  // ============================================================================

  ipcMain.handle('dashboard:get-metrics', async () => {
    try {
      const metrics = await getDashboardMetrics();
      return { success: true, data: metrics };
    } catch (error) {
      logger.error('Failed to get metrics', { error });
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('dashboard:check-integration-health', async () => {
    try {
      const health = await checkIntegrationHealth();
      return { success: true, data: health };
    } catch (error) {
      logger.error('Failed to check integration health', { error });
      return { success: false, error: String(error) };
    }
  });

  logger.info('Dashboard IPC handlers registered (16 handlers)');
}

// ============================================================================
// Real-time Metrics Collection
// ============================================================================

interface DashboardMetrics {
  credits: number;
  agents: number;
  workflows: number;
  tools: number;
  runsQueued: number;
  runsCompleted24h: number;
  integrations: number;
  integrationsHealthy: number;
  // Trading data
  trading?: {
    totalPortfolioValue: number;
    dailyPnL: number;
    dailyPnLPercent: number;
    positions: number;
    openOrders: number;
    exchangesConnected: number;
  };
}

/**
 * Get real-time dashboard metrics including trading data
 */
async function getDashboardMetrics(): Promise<DashboardMetrics> {
  const [agents, workflows, integrations] = await Promise.all([
    loadAgents(),
    loadWorkflows(),
    loadIntegrations(),
  ]);

  // Get tool count from tool registry (if available)
  let toolCount = 101; // Default
  try {
    const tools = await import('../agent/tools/index');
    const allTools = tools.getAllTools();
    toolCount = allTools.length;
  } catch {
    // Use default
  }

  // Count healthy integrations
  const healthyIntegrations = integrations.filter((i) => i.status === 'connected').length;

  // Get task queue stats
  let runsQueued = 0;
  let runsCompleted24h = 0;
  try {
    const taskQueue = getTaskQueueManager();
    const stats = taskQueue.getStats();
    runsQueued = stats.pending + stats.running;
    runsCompleted24h = stats.completed;
  } catch {
    // Task queue not available
  }

  // Calculate credits from usage tracking
  const credits = calculateCreditsUsed();
  
  // Fetch trading data
  let tradingData: DashboardMetrics['trading'] | undefined;
  try {
    const { getPortfolioManager } = await import('../trading');
    const portfolio = getPortfolioManager();
    
    const [balance, performance, positions] = await Promise.all([
      portfolio.getAggregatedBalance(),
      portfolio.getPerformance('24h'),
      portfolio.getAllPositions(),
    ]);
    
    // Get connected exchanges count
    const exchangeIds = portfolio.getRegisteredExchanges();
    
    tradingData = {
      totalPortfolioValue: parseFloat(balance.totalUsdValue?.toString() || '0'),
      dailyPnL: parseFloat(performance?.pnl?.toString() || '0'),
      dailyPnLPercent: parseFloat(performance?.pnlPercentage?.toString() || '0'),
      positions: positions.length,
      openOrders: 0, // Would need order tracking
      exchangesConnected: exchangeIds.length,
    };
  } catch (error) {
    // Trading module not available or not configured
    logger.debug('Trading data not available for dashboard', {
      error: getErrorMessage(error),
    });
  }

  return {
    credits,
    agents: agents.length,
    workflows: workflows.length,
    tools: toolCount,
    runsQueued,
    runsCompleted24h,
    integrations: integrations.length,
    integrationsHealthy: healthyIntegrations,
    trading: tradingData,
  };
}

// ============================================================================
// Integration Health Checks
// ============================================================================

interface IntegrationHealth {
  id: string;
  status: 'connected' | 'warning' | 'disconnected' | 'unconfigured';
  latency?: number;
  error?: string;
}

/**
 * Check health of all integrations
 * Returns basic health status based on integration type
 */
async function checkIntegrationHealth(): Promise<IntegrationHealth[]> {
  const integrations = await loadIntegrations();
  const health: IntegrationHealth[] = [];

  for (const integration of integrations) {
    // For now, just return current status
    // In the future, we can add actual health checks (ping APIs, etc.)
    const result: IntegrationHealth = {
      id: integration.id,
      status: integration.status,
      error: integration.error,
    };

    // Local apps are always connected
    if (['brave', 'vscode'].includes(integration.id)) {
      result.status = 'connected';
    }

    health.push(result);
  }

  return health;
}
