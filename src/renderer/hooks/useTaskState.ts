/**
 * Atlas Desktop - useTaskState Hook
 * Connects to the task framework IPC events and provides reactive state
 */

import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Task step information
 */
export interface TaskStep {
  id: string;
  name: string;
  type: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  error?: string;
}

/**
 * Task information
 */
export interface Task {
  id: string;
  name: string;
  description?: string;
  status: 'pending' | 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  priority: 'urgent' | 'high' | 'normal' | 'low';
  progress: number;
  currentStep?: string;
  steps: TaskStep[];
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  error?: string;
}

/**
 * Task progress event
 */
export interface TaskProgressEvent {
  taskId: string;
  stepId?: string;
  progress: number;
  currentStep?: string;
  message?: string;
  status: string;
  completedSteps: number;
  totalSteps: number;
}

/**
 * Task completion event
 */
export interface TaskCompletionEvent {
  taskId: string;
  status: 'completed' | 'failed';
  error?: string;
  duration: number;
}

/**
 * Task queue statistics
 */
export interface TaskQueueStats {
  queued: number;
  running: number;
  completed: number;
  failed: number;
  cancelled: number;
  avgDuration: number;
  successRate: number;
}

/**
 * State returned by the hook
 */
export interface TaskStateResult {
  // Current state
  tasks: Task[];
  queuedTasks: Task[];
  runningTasks: Task[];
  recentTasks: Task[];

  // Statistics
  stats: TaskQueueStats | null;

  // Current active task (first running task)
  activeTask: Task | null;

  // Progress for orb visualization (0-100)
  taskProgress: number;

  // Is any task currently running
  isProcessing: boolean;

  // Loading state
  isLoading: boolean;

  // Error
  error: string | null;

  // Actions
  createTask: (options: CreateTaskOptions) => Promise<Task | null>;
  cancelTask: (taskId: string, reason?: string) => Promise<boolean>;
  pauseTask: (taskId: string) => Promise<boolean>;
  resumeTask: (taskId: string) => Promise<boolean>;
  refresh: () => Promise<void>;
  clearCompleted: () => Promise<number>;
}

/**
 * Options for creating a task
 */
export interface CreateTaskOptions {
  name: string;
  description?: string;
  priority?: 'urgent' | 'high' | 'normal' | 'low';
  steps: Array<{
    name: string;
    type: 'tool' | 'llm' | 'wait' | 'condition' | 'parallel' | 'loop' | 'delay';
    config: Record<string, unknown>;
    timeout?: number;
    retryCount?: number;
    errorStrategy?: 'fail' | 'skip' | 'retry' | 'rollback';
  }>;
  context?: Record<string, unknown>;
  tags?: string[];
}

/**
 * Hook to connect to Atlas task framework
 */
export function useTaskState(): TaskStateResult {
  // Tasks state
  const [tasks, setTasks] = useState<Task[]>([]);
  const [queuedTasks, setQueuedTasks] = useState<Task[]>([]);
  const [runningTasks, setRunningTasks] = useState<Task[]>([]);
  const [recentTasks, setRecentTasks] = useState<Task[]>([]);

  // Statistics
  const [stats, setStats] = useState<TaskQueueStats | null>(null);

  // UI state
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Cleanup refs
  const cleanupFunctionsRef = useRef<Array<() => void>>([]);

  // Computed values
  const activeTask = runningTasks.length > 0 ? runningTasks[0] : null;
  const taskProgress = activeTask?.progress ?? 0;
  const isProcessing = runningTasks.length > 0;

  /**
   * Refresh all task data from main process
   */
  const refresh = useCallback(async () => {
    if (!window.atlas?.tasks) {
      return;
    }

    try {
      const [queuedResult, runningResult, recentResult, statsResult] = await Promise.all([
        window.atlas.tasks.getQueued(),
        window.atlas.tasks.getRunning(),
        window.atlas.tasks.getRecent(20),
        window.atlas.tasks.getStats(),
      ]);

      if (queuedResult.success && queuedResult.data) {
        setQueuedTasks(queuedResult.data as Task[]);
      }
      if (runningResult.success && runningResult.data) {
        setRunningTasks(runningResult.data as Task[]);
      }
      if (recentResult.success && recentResult.data) {
        setRecentTasks(recentResult.data as Task[]);
      }
      if (statsResult.success && statsResult.data) {
        setStats(statsResult.data as TaskQueueStats);
      }

      // Combine all tasks
      setTasks([
        ...(runningResult.data as Task[]),
        ...(queuedResult.data as Task[]),
        ...(recentResult.data as Task[]),
      ]);

      setError(null);
    } catch (err) {
      // Silently ignore "No handler registered" errors during initialization
      // These can occur if the renderer loads before main process handlers are ready
      const errorMessage = (err as Error).message;
      if (!errorMessage.includes('No handler registered')) {
        setError(errorMessage);
      }
    }
  }, []);

  /**
   * Create and enqueue a new task
   */
  const createTask = useCallback(
    async (options: CreateTaskOptions): Promise<Task | null> => {
      if (!window.atlas?.tasks) {
        setError('Task API not available');
        return null;
      }

      try {
        const result = await window.atlas.tasks.create(options);
        if (result.success && result.data) {
          // Refresh to get updated state
          await refresh();
          return result.data as Task;
        }
        setError(result.error || 'Failed to create task');
        return null;
      } catch (err) {
        setError((err as Error).message);
        return null;
      }
    },
    [refresh]
  );

  /**
   * Cancel a task
   */
  const cancelTask = useCallback(
    async (taskId: string, reason?: string): Promise<boolean> => {
      if (!window.atlas?.tasks) {
        return false;
      }

      try {
        const result = await window.atlas.tasks.cancel(taskId, reason);
        if (result.success) {
          await refresh();
          return true;
        }
        return false;
      } catch {
        return false;
      }
    },
    [refresh]
  );

  /**
   * Pause a task
   */
  const pauseTask = useCallback(
    async (taskId: string): Promise<boolean> => {
      if (!window.atlas?.tasks) {
        return false;
      }

      try {
        const result = await window.atlas.tasks.pause(taskId);
        if (result.success) {
          await refresh();
          return true;
        }
        return false;
      } catch {
        return false;
      }
    },
    [refresh]
  );

  /**
   * Resume a task
   */
  const resumeTask = useCallback(
    async (taskId: string): Promise<boolean> => {
      if (!window.atlas?.tasks) {
        return false;
      }

      try {
        const result = await window.atlas.tasks.resume(taskId);
        if (result.success) {
          await refresh();
          return true;
        }
        return false;
      } catch {
        return false;
      }
    },
    [refresh]
  );

  /**
   * Clear completed tasks
   */
  const clearCompleted = useCallback(async (): Promise<number> => {
    if (!window.atlas?.tasks) {
      return 0;
    }

    try {
      const result = await window.atlas.tasks.clearCompleted();
      if (result.success && result.data) {
        await refresh();
        return (result.data as { cleared: number }).cleared;
      }
      return 0;
    } catch {
      return 0;
    }
  }, [refresh]);

  // Subscribe to IPC events
  useEffect(() => {
    if (!window.atlas) {
      console.warn('[useTaskState] Atlas API not available');
      setIsLoading(false);
      return;
    }

    const { on } = window.atlas;
    const cleanups: Array<() => void> = [];

    // Task queued event
    cleanups.push(
      on('task:queued', (data: unknown) => {
        const task = data as Task;
        setQueuedTasks((prev) => [...prev, task]);
        setTasks((prev) => [...prev, task]);
      })
    );

    // Task started event
    cleanups.push(
      on('task:started', (data: unknown) => {
        const task = data as Task;
        setQueuedTasks((prev) => prev.filter((t) => t.id !== task.id));
        setRunningTasks((prev) => [...prev, task]);
        setTasks((prev) => prev.map((t) => (t.id === task.id ? task : t)));
      })
    );

    // Task progress event
    cleanups.push(
      on('task:progress', (data: unknown) => {
        const event = data as TaskProgressEvent;
        setRunningTasks((prev) =>
          prev.map((t) =>
            t.id === event.taskId
              ? {
                  ...t,
                  progress: event.progress,
                  currentStep: event.currentStep,
                  status: event.status as Task['status'],
                }
              : t
          )
        );
        setTasks((prev) =>
          prev.map((t) =>
            t.id === event.taskId
              ? {
                  ...t,
                  progress: event.progress,
                  currentStep: event.currentStep,
                  status: event.status as Task['status'],
                }
              : t
          )
        );
      })
    );

    // Task step started event
    cleanups.push(
      on('task:step-started', (data: unknown) => {
        const { taskId, step } = data as { taskId: string; step: TaskStep };
        setRunningTasks((prev) =>
          prev.map((t) =>
            t.id === taskId
              ? {
                  ...t,
                  currentStep: step.name,
                  steps: t.steps.map((s) => (s.id === step.id ? { ...s, status: 'running' } : s)),
                }
              : t
          )
        );
      })
    );

    // Task step completed event
    cleanups.push(
      on('task:step-completed', (data: unknown) => {
        const { taskId, step } = data as { taskId: string; step: TaskStep; result: unknown };
        setRunningTasks((prev) =>
          prev.map((t) =>
            t.id === taskId
              ? {
                  ...t,
                  steps: t.steps.map((s) =>
                    s.id === step.id ? { ...s, status: step.status, error: step.error } : s
                  ),
                }
              : t
          )
        );
      })
    );

    // Task completed event
    cleanups.push(
      on('task:completed', (data: unknown) => {
        const event = data as TaskCompletionEvent;
        setRunningTasks((prev) => {
          const task = prev.find((t) => t.id === event.taskId);
          if (task) {
            const completedTask: Task = {
              ...task,
              status: event.status,
              progress: event.status === 'completed' ? 100 : task.progress,
              completedAt: Date.now(),
              error: event.error,
            };
            setRecentTasks((recent) => [completedTask, ...recent.slice(0, 19)]);
          }
          return prev.filter((t) => t.id !== event.taskId);
        });
        setTasks((prev) =>
          prev.map((t) =>
            t.id === event.taskId
              ? {
                  ...t,
                  status: event.status,
                  progress: event.status === 'completed' ? 100 : t.progress,
                  completedAt: Date.now(),
                  error: event.error,
                }
              : t
          )
        );
        // Refresh stats
        refresh();
      })
    );

    // Task cancelled event
    cleanups.push(
      on('task:cancelled', (data: unknown) => {
        const { taskId } = data as { taskId: string; reason?: string };
        setQueuedTasks((prev) => prev.filter((t) => t.id !== taskId));
        setRunningTasks((prev) => prev.filter((t) => t.id !== taskId));
        setTasks((prev) =>
          prev.map((t) =>
            t.id === taskId ? { ...t, status: 'cancelled', completedAt: Date.now() } : t
          )
        );
        refresh();
      })
    );

    // Task paused event
    cleanups.push(
      on('task:paused', (data: unknown) => {
        const { taskId } = data as { taskId: string };
        setRunningTasks((prev) =>
          prev.map((t) => (t.id === taskId ? { ...t, status: 'paused' } : t))
        );
        setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status: 'paused' } : t)));
      })
    );

    // Task resumed event
    cleanups.push(
      on('task:resumed', (data: unknown) => {
        const { taskId } = data as { taskId: string };
        setRunningTasks((prev) =>
          prev.map((t) => (t.id === taskId ? { ...t, status: 'running' } : t))
        );
        setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status: 'running' } : t)));
      })
    );

    // Store cleanup functions
    cleanupFunctionsRef.current = cleanups;

    // Initial data load with retry for handler timing issues
    const loadWithRetry = async (retries = 3, delay = 500) => {
      for (let i = 0; i < retries; i++) {
        try {
          await refresh();
          return; // Success
        } catch (err) {
          const errorMessage = (err as Error).message;
          if (errorMessage.includes('No handler registered') && i < retries - 1) {
            // Wait and retry if handlers not ready yet
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        }
      }
    };

    loadWithRetry().finally(() => setIsLoading(false));

    // Cleanup
    return () => {
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [refresh]);

  return {
    tasks,
    queuedTasks,
    runningTasks,
    recentTasks,
    stats,
    activeTask,
    taskProgress,
    isProcessing,
    isLoading,
    error,
    createTask,
    cancelTask,
    pauseTask,
    resumeTask,
    refresh,
    clearCompleted,
  };
}

export default useTaskState;
