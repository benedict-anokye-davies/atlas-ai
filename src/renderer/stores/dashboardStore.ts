/**
 * Dashboard Store - Zustand store for AGNT-style dashboard state
 * Manages metrics, goals, workflows, agents, and integrations
 * Now wired to backend persistence via IPC
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { getErrorMessage, clamp100 } from '../../shared/utils';

// ============================================================================
// Types
// ============================================================================

export interface DashboardMetrics {
  credits: number;
  agents: number;
  workflows: number;
  tools: number;
  runsQueued: number;
  runsCompleted24h: number;
  integrations: number;
  integrationsHealthy: number;
}

export interface Goal {
  id: string;
  title: string;
  category: 'research' | 'learning' | 'tasks' | 'trading' | 'health' | 'other';
  progress: number; // 0-100
  target?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Agent {
  id: string;
  name: string;
  icon?: string;
  status: 'active' | 'idle' | 'running' | 'error';
  taskCount: number;
  currentTask?: string;
  lastActive?: Date;
}

export interface Workflow {
  id: string;
  name: string;
  status: 'listening' | 'running' | 'scheduled' | 'paused' | 'error';
  lastRun?: Date;
  nextRun?: Date;
  currentStep?: number;
  totalSteps?: number;
  trigger?: string;
}

export interface Integration {
  id: string;
  name: string;
  icon: string;
  status: 'connected' | 'warning' | 'disconnected' | 'unconfigured';
  lastSync?: Date;
  error?: string;
}

export interface RunStats {
  queued: number;
  running: number;
  completed: number;
  failed: number;
  p95Latency: number; // in seconds
}

export type DashboardView = 'dashboard' | 'workflow-builder' | 'orb-only' | 'brain-explorer' | 'command-center';

// ============================================================================
// Store State
// ============================================================================

interface DashboardState {
  // Current view
  view: DashboardView;

  // Metrics
  metrics: DashboardMetrics;

  // Goals
  goals: Goal[];

  // Agents
  agents: Agent[];

  // Workflows
  workflows: Workflow[];

  // Integrations
  integrations: Integration[];

  // Run stats
  runStats: RunStats;

  // UI state
  leftSidebarCollapsed: boolean;
  rightSidebarCollapsed: boolean;
  bottomPanelCollapsed: boolean;

  // Loading states
  isLoading: boolean;
  error: string | null;
}

interface DashboardActions {
  // View actions
  setView: (view: DashboardView) => void;
  toggleOrbOnly: () => void;

  // Metrics actions
  setMetrics: (metrics: Partial<DashboardMetrics>) => void;
  refreshMetrics: () => Promise<void>;

  // Goal actions
  addGoal: (goal: Omit<Goal, 'id' | 'createdAt' | 'updatedAt'>) => void;
  updateGoal: (id: string, updates: Partial<Goal>) => void;
  removeGoal: (id: string) => void;
  updateGoalProgress: (id: string, progress: number) => void;

  // Agent actions
  setAgents: (agents: Agent[]) => void;
  updateAgent: (id: string, updates: Partial<Agent>) => void;

  // Workflow actions
  setWorkflows: (workflows: Workflow[]) => void;
  updateWorkflow: (id: string, updates: Partial<Workflow>) => void;
  startWorkflow: (id: string) => void;
  stopWorkflow: (id: string) => void;

  // Integration actions
  setIntegrations: (integrations: Integration[]) => void;
  updateIntegration: (id: string, updates: Partial<Integration>) => void;

  // Run stats actions
  setRunStats: (stats: Partial<RunStats>) => void;

  // UI actions
  toggleLeftSidebar: () => void;
  toggleRightSidebar: () => void;
  toggleBottomPanel: () => void;

  // Loading actions
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;

  // Initialize
  initialize: () => Promise<void>;
}

type DashboardStore = DashboardState & DashboardActions;

// ============================================================================
// Initial State
// ============================================================================

const initialMetrics: DashboardMetrics = {
  credits: 0,
  agents: 0,
  workflows: 0,
  tools: 101, // Agent reports 101 tools registered
  runsQueued: 0,
  runsCompleted24h: 0,
  integrations: 0,
  integrationsHealthy: 0,
};

const initialRunStats: RunStats = {
  queued: 0,
  running: 0,
  completed: 0,
  failed: 0,
  p95Latency: 0,
};

// Default integrations (icons will be mapped in component)
const defaultIntegrations: Integration[] = [
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

// ============================================================================
// Store Implementation
// ============================================================================

// Helper to convert persisted data (timestamps) to Date objects
const parseGoalDates = (goal: {
  id: string;
  title: string;
  category: string;
  progress: number;
  target?: string;
  createdAt: number;
  updatedAt: number;
}): Goal => ({
  ...goal,
  category: goal.category as Goal['category'],
  createdAt: new Date(goal.createdAt),
  updatedAt: new Date(goal.updatedAt),
});

const parseWorkflowDates = (workflow: {
  id: string;
  name: string;
  status: string;
  lastRun?: number;
  nextRun?: number;
  currentStep?: number;
  totalSteps?: number;
  trigger?: string;
}): Workflow => ({
  ...workflow,
  status: workflow.status as Workflow['status'],
  lastRun: workflow.lastRun ? new Date(workflow.lastRun) : undefined,
  nextRun: workflow.nextRun ? new Date(workflow.nextRun) : undefined,
});

const parseAgentDates = (agent: {
  id: string;
  name: string;
  icon?: string;
  status: string;
  taskCount: number;
  currentTask?: string;
  lastActive?: number;
}): Agent => ({
  ...agent,
  status: agent.status as Agent['status'],
  lastActive: agent.lastActive ? new Date(agent.lastActive) : undefined,
});

const parseIntegrationDates = (integration: {
  id: string;
  name: string;
  icon: string;
  status: string;
  lastSync?: number;
  error?: string;
}): Integration => ({
  ...integration,
  status: integration.status as Integration['status'],
  lastSync: integration.lastSync ? new Date(integration.lastSync) : undefined,
});

// Helper to convert Date objects to timestamps for persistence
const goalToPersistedFormat = (goal: Goal) => ({
  ...goal,
  createdAt: goal.createdAt.getTime(),
  updatedAt: goal.updatedAt.getTime(),
});

const workflowToPersistedFormat = (workflow: Workflow) => ({
  ...workflow,
  lastRun: workflow.lastRun?.getTime(),
  nextRun: workflow.nextRun?.getTime(),
});

const agentToPersistedFormat = (agent: Agent) => ({
  ...agent,
  lastActive: agent.lastActive?.getTime(),
});

const integrationToPersistedFormat = (integration: Integration) => ({
  ...integration,
  lastSync: integration.lastSync?.getTime(),
});

export const useDashboardStore = create<DashboardStore>()(
  subscribeWithSelector((set, get) => ({
    // Initial state - default to orb-only for clean minimal UI
    view: 'orb-only',
    metrics: initialMetrics,
    goals: [],
    agents: [],
    workflows: [],
    integrations: defaultIntegrations,
    runStats: initialRunStats,
    // Start with sidebars collapsed for cleaner 1080p experience
    leftSidebarCollapsed: true,
    rightSidebarCollapsed: true,
    bottomPanelCollapsed: true,
    isLoading: false,
    error: null,

    // View actions
    setView: (view) => set({ view }),

    toggleOrbOnly: () => {
      const currentView = get().view;
      set({ view: currentView === 'orb-only' ? 'dashboard' : 'orb-only' });
    },

    // Metrics actions
    setMetrics: (metrics) =>
      set((state) => ({
        metrics: { ...state.metrics, ...metrics },
      })),

    refreshMetrics: async () => {
      // Don't set loading to avoid UI flicker
      try {
        // Get metrics from dashboard IPC
        let toolCount = 101;
        let runsQueued = 0;
        let runsCompleted = 0;

        try {
          if (window.atlas?.dashboard?.getMetrics) {
            const metricsResult = await window.atlas.dashboard.getMetrics();
            if (metricsResult.success && metricsResult.data) {
              toolCount = metricsResult.data.tools;
              runsQueued = metricsResult.data.runsQueued;
              runsCompleted = metricsResult.data.runsCompleted24h;
            }
          }
        } catch {
          // Fallback to tools API
          try {
            if (window.atlas?.tools?.getSummary) {
              const toolsResult = await window.atlas.tools.getSummary();
              if (toolsResult.success && toolsResult.data) {
                toolCount = toolsResult.data.totalTools;
              }
            }
          } catch {
            // Use default
          }

          // Fallback to tasks API
          try {
            if (window.atlas?.tasks?.getStats) {
              const taskStats = await window.atlas.tasks.getStats();
              if (taskStats.success && taskStats.data) {
                runsQueued = taskStats.data.queued + taskStats.data.running;
                runsCompleted = taskStats.data.completed;
              }
            }
          } catch {
            // Use defaults
          }
        }

        const agents = get().agents;
        const workflows = get().workflows;
        const integrations = get().integrations;
        const healthyIntegrations = integrations.filter((i) => i.status === 'connected').length;

        set({
          metrics: {
            ...get().metrics,
            tools: toolCount,
            agents: agents.length,
            workflows: workflows.length,
            integrations: integrations.length,
            integrationsHealthy: healthyIntegrations,
            runsQueued,
            runsCompleted24h: runsCompleted,
          },
          runStats: {
            ...get().runStats,
            queued: runsQueued,
            completed: runsCompleted,
          },
          isLoading: false,
        });
      } catch (error) {
        set({
          error: getErrorMessage(error, 'Failed to refresh metrics'),
          isLoading: false,
        });
      }
    },

    // Goal actions - now with persistence
    addGoal: async (goalData) => {
      const goal: Goal = {
        ...goalData,
        id: `goal-${Date.now()}`,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Update local state immediately
      set((state) => ({ goals: [...state.goals, goal] }));

      // Persist to backend
      try {
        if (window.atlas?.dashboard?.saveGoal) {
          await window.atlas.dashboard.saveGoal(goalToPersistedFormat(goal));
        }
      } catch (error) {
        console.error('Failed to persist goal:', error);
      }
    },

    updateGoal: async (id, updates) => {
      // Update local state immediately
      set((state) => ({
        goals: state.goals.map((g) =>
          g.id === id ? { ...g, ...updates, updatedAt: new Date() } : g
        ),
      }));

      // Persist to backend
      try {
        if (window.atlas?.dashboard?.saveGoals) {
          const goals = get().goals;
          await window.atlas.dashboard.saveGoals(goals.map(goalToPersistedFormat));
        }
      } catch (error) {
        console.error('Failed to persist goal update:', error);
      }
    },

    removeGoal: async (id) => {
      // Update local state immediately
      set((state) => ({
        goals: state.goals.filter((g) => g.id !== id),
      }));

      // Persist to backend
      try {
        if (window.atlas?.dashboard?.deleteGoal) {
          await window.atlas.dashboard.deleteGoal(id);
        }
      } catch (error) {
        console.error('Failed to delete goal:', error);
      }
    },

    updateGoalProgress: async (id, progress) => {
      // Update local state immediately
      set((state) => ({
        goals: state.goals.map((g) =>
          g.id === id
            ? { ...g, progress: clamp100(progress), updatedAt: new Date() }
            : g
        ),
      }));

      // Persist to backend
      try {
        if (window.atlas?.dashboard?.updateGoalProgress) {
          await window.atlas.dashboard.updateGoalProgress(id, progress);
        }
      } catch (error) {
        console.error('Failed to persist goal progress:', error);
      }
    },

    // Agent actions - now with persistence
    setAgents: async (agents) => {
      set({ agents });

      // Persist to backend
      try {
        if (window.atlas?.dashboard?.saveAgents) {
          await window.atlas.dashboard.saveAgents(agents.map(agentToPersistedFormat));
        }
      } catch (error) {
        console.error('Failed to persist agents:', error);
      }
    },

    updateAgent: async (id, updates) => {
      set((state) => ({
        agents: state.agents.map((a) => (a.id === id ? { ...a, ...updates } : a)),
      }));

      // Persist to backend
      try {
        if (window.atlas?.dashboard?.saveAgents) {
          const agents = get().agents;
          await window.atlas.dashboard.saveAgents(agents.map(agentToPersistedFormat));
        }
      } catch (error) {
        console.error('Failed to persist agent update:', error);
      }
    },

    // Workflow actions - now with persistence
    setWorkflows: async (workflows) => {
      set({ workflows });

      // Persist to backend
      try {
        if (window.atlas?.dashboard?.saveWorkflows) {
          await window.atlas.dashboard.saveWorkflows(workflows.map(workflowToPersistedFormat));
        }
      } catch (error) {
        console.error('Failed to persist workflows:', error);
      }
    },

    updateWorkflow: async (id, updates) => {
      set((state) => ({
        workflows: state.workflows.map((w) => (w.id === id ? { ...w, ...updates } : w)),
      }));

      // Persist to backend
      try {
        if (window.atlas?.dashboard?.saveWorkflows) {
          const workflows = get().workflows;
          await window.atlas.dashboard.saveWorkflows(workflows.map(workflowToPersistedFormat));
        }
      } catch (error) {
        console.error('Failed to persist workflow update:', error);
      }
    },

    startWorkflow: async (id) => {
      set((state) => ({
        workflows: state.workflows.map((w) =>
          w.id === id ? { ...w, status: 'running' as const } : w
        ),
      }));

      // Persist to backend
      try {
        const workflow = get().workflows.find((w) => w.id === id);
        if (workflow && window.atlas?.dashboard?.saveWorkflow) {
          await window.atlas.dashboard.saveWorkflow(workflowToPersistedFormat(workflow));
        }
      } catch (error) {
        console.error('Failed to persist workflow start:', error);
      }
    },

    stopWorkflow: async (id) => {
      set((state) => ({
        workflows: state.workflows.map((w) =>
          w.id === id ? { ...w, status: 'paused' as const } : w
        ),
      }));

      // Persist to backend
      try {
        const workflow = get().workflows.find((w) => w.id === id);
        if (workflow && window.atlas?.dashboard?.saveWorkflow) {
          await window.atlas.dashboard.saveWorkflow(workflowToPersistedFormat(workflow));
        }
      } catch (error) {
        console.error('Failed to persist workflow stop:', error);
      }
    },

    // Integration actions - now with persistence
    setIntegrations: async (integrations) => {
      set({ integrations });

      // Persist to backend
      try {
        if (window.atlas?.dashboard?.saveIntegrations) {
          await window.atlas.dashboard.saveIntegrations(
            integrations.map(integrationToPersistedFormat)
          );
        }
      } catch (error) {
        console.error('Failed to persist integrations:', error);
      }
    },

    updateIntegration: async (id, updates) => {
      set((state) => ({
        integrations: state.integrations.map((i) => (i.id === id ? { ...i, ...updates } : i)),
      }));

      // Persist to backend
      try {
        if (updates.status && window.atlas?.dashboard?.updateIntegrationStatus) {
          await window.atlas.dashboard.updateIntegrationStatus(
            id,
            updates.status as Integration['status'],
            updates.error
          );
        }
      } catch (error) {
        console.error('Failed to persist integration update:', error);
      }
    },

    // Run stats actions
    setRunStats: (stats) =>
      set((state) => ({
        runStats: { ...state.runStats, ...stats },
      })),

    // UI actions
    toggleLeftSidebar: () =>
      set((state) => ({
        leftSidebarCollapsed: !state.leftSidebarCollapsed,
      })),

    toggleRightSidebar: () =>
      set((state) => ({
        rightSidebarCollapsed: !state.rightSidebarCollapsed,
      })),

    toggleBottomPanel: () =>
      set((state) => ({
        bottomPanelCollapsed: !state.bottomPanelCollapsed,
      })),

    // Loading actions
    setLoading: (isLoading) => set({ isLoading }),
    setError: (error) => set({ error }),

    // Initialize dashboard - now loads from backend
    initialize: async () => {
      set({ isLoading: true, error: null });

      try {
        // Try to load from backend first
        if (window.atlas?.dashboard?.initialize) {
          const result = await window.atlas.dashboard.initialize();

          if (result.success && result.data) {
            const { goals, workflows, agents, integrations } = result.data;

            set({
              goals: goals.map(parseGoalDates),
              workflows: workflows.map(parseWorkflowDates),
              agents: agents.map(parseAgentDates),
              integrations:
                integrations.length > 0
                  ? integrations.map(parseIntegrationDates)
                  : defaultIntegrations,
              isLoading: false,
            });

            // Refresh metrics after loading
            await get().refreshMetrics();
            return;
          }
        }

        // Fallback to default data if backend not available
        console.warn('Dashboard backend not available, using defaults');

        const defaultGoals: Goal[] = [
          {
            id: 'goal-1',
            title: 'Complete Atlas Dashboard',
            category: 'tasks',
            progress: 30,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          {
            id: 'goal-2',
            title: 'Learn Rust Programming',
            category: 'learning',
            progress: 15,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          {
            id: 'goal-3',
            title: 'Backtest LSTM Trading Model',
            category: 'trading',
            progress: 45,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ];

        const defaultAgents: Agent[] = [
          { id: 'agent-1', name: 'Trading Bot', status: 'idle', taskCount: 0 },
          { id: 'agent-2', name: 'Email Manager', status: 'idle', taskCount: 0 },
          { id: 'agent-3', name: 'Content Generator', status: 'idle', taskCount: 0 },
          { id: 'agent-4', name: 'Research Agent', status: 'idle', taskCount: 0 },
          { id: 'agent-5', name: 'Discord Bot', status: 'idle', taskCount: 0 },
        ];

        const defaultWorkflows: Workflow[] = [
          {
            id: 'wf-1',
            name: 'Bitcoin Price Alert',
            status: 'listening',
            trigger: 'Price threshold',
          },
          { id: 'wf-2', name: 'Email Inbox Manager', status: 'listening', trigger: 'New email' },
          {
            id: 'wf-3',
            name: 'Daily Backup',
            status: 'scheduled',
            nextRun: new Date(Date.now() + 3600000),
          },
          { id: 'wf-4', name: 'Content Scheduler', status: 'paused' },
        ];

        set({
          goals: defaultGoals,
          agents: defaultAgents,
          workflows: defaultWorkflows,
          isLoading: false,
        });

        // Refresh metrics after loading
        await get().refreshMetrics();
      } catch (error) {
        set({
          error: getErrorMessage(error, 'Failed to initialize dashboard'),
          isLoading: false,
        });
      }
    },
  }))
);

// ============================================================================
// Selectors
// ============================================================================

export const selectMetrics = (state: DashboardStore) => state.metrics;
export const selectGoals = (state: DashboardStore) => state.goals;
export const selectAgents = (state: DashboardStore) => state.agents;
export const selectWorkflows = (state: DashboardStore) => state.workflows;
export const selectIntegrations = (state: DashboardStore) => state.integrations;
export const selectRunStats = (state: DashboardStore) => state.runStats;
export const selectView = (state: DashboardStore) => state.view;

// Computed selectors
export const selectActiveAgents = (state: DashboardStore) =>
  state.agents.filter((a) => a.status === 'active' || a.status === 'running');

export const selectActiveWorkflows = (state: DashboardStore) =>
  state.workflows.filter((w) => w.status === 'listening' || w.status === 'running');

export const selectHealthyIntegrations = (state: DashboardStore) =>
  state.integrations.filter((i) => i.status === 'connected');

export const selectGoalsByCategory = (category: Goal['category']) => (state: DashboardStore) =>
  state.goals.filter((g) => g.category === category);
