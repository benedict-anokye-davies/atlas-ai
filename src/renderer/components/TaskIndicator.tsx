/**
 * Atlas Desktop - TaskIndicator Component
 * Displays current task progress as an overlay on the orb
 */

import { useTaskState } from '../hooks';
import type { Task } from '../hooks';
import './TaskIndicator.css';

/**
 * Format duration in milliseconds to human readable string
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

/**
 * Get status color class based on task status
 */
function getStatusColorClass(status: Task['status']): string {
  switch (status) {
    case 'running':
      return 'task-status-running';
    case 'paused':
      return 'task-status-paused';
    case 'completed':
      return 'task-status-completed';
    case 'failed':
      return 'task-status-failed';
    case 'cancelled':
      return 'task-status-cancelled';
    default:
      return 'task-status-pending';
  }
}

/**
 * Get priority indicator
 */
function getPriorityIndicator(priority: Task['priority']): string {
  switch (priority) {
    case 'urgent':
      return '!!!';
    case 'high':
      return '!!';
    case 'normal':
      return '';
    case 'low':
      return '';
    default:
      return '';
  }
}

/**
 * TaskIndicator component
 * Shows active task progress and queue status
 */
export function TaskIndicator() {
  const {
    activeTask,
    taskProgress,
    isProcessing,
    queuedTasks,
    stats,
    cancelTask,
    pauseTask,
    resumeTask,
  } = useTaskState();

  // Don't render if no tasks
  if (!isProcessing && queuedTasks.length === 0) {
    return null;
  }

  const handlePauseResume = () => {
    if (!activeTask) return;
    if (activeTask.status === 'paused') {
      resumeTask(activeTask.id);
    } else {
      pauseTask(activeTask.id);
    }
  };

  const handleCancel = () => {
    if (!activeTask) return;
    cancelTask(activeTask.id, 'User cancelled');
  };

  // Calculate elapsed time for active task
  const elapsedTime = activeTask?.startedAt ? Date.now() - activeTask.startedAt : 0;

  return (
    <div className="task-indicator" role="region" aria-label="Task progress">
      {/* Active task display */}
      {activeTask && (
        <div className={`task-active ${getStatusColorClass(activeTask.status)}`}>
          {/* Task header */}
          <div className="task-header">
            <div className="task-info">
              {getPriorityIndicator(activeTask.priority) && (
                <span className="task-priority">{getPriorityIndicator(activeTask.priority)}</span>
              )}
              <span className="task-name">{activeTask.name}</span>
            </div>
            <div className="task-controls">
              <button
                className="task-control-btn"
                onClick={handlePauseResume}
                title={activeTask.status === 'paused' ? 'Resume' : 'Pause'}
                aria-label={activeTask.status === 'paused' ? 'Resume task' : 'Pause task'}
              >
                {activeTask.status === 'paused' ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="5,3 19,12 5,21" />
                  </svg>
                ) : (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="6" y="4" width="4" height="16" />
                    <rect x="14" y="4" width="4" height="16" />
                  </svg>
                )}
              </button>
              <button
                className="task-control-btn task-control-cancel"
                onClick={handleCancel}
                title="Cancel task"
                aria-label="Cancel task"
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </div>

          {/* Progress bar */}
          <div className="task-progress-container">
            <div
              className="task-progress-bar"
              style={{ width: `${taskProgress}%` }}
              role="progressbar"
              aria-valuenow={taskProgress}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Task progress: ${Math.round(taskProgress)}%`}
            />
          </div>

          {/* Task details */}
          <div className="task-details">
            <span className="task-step">{activeTask.currentStep || 'Starting...'}</span>
            <span className="task-meta">
              {Math.round(taskProgress)}% | {formatDuration(elapsedTime)}
            </span>
          </div>

          {/* Step indicators */}
          {activeTask.steps.length > 0 && activeTask.steps.length <= 8 && (
            <div className="task-steps">
              {activeTask.steps.map((step, index) => (
                <div
                  key={step.id}
                  className={`task-step-dot ${step.status}`}
                  title={`${step.name}: ${step.status}`}
                  aria-label={`Step ${index + 1}: ${step.name}, ${step.status}`}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Queue indicator */}
      {queuedTasks.length > 0 && (
        <div className="task-queue-indicator">
          <span className="queue-count">{queuedTasks.length}</span>
          <span className="queue-label">queued</span>
        </div>
      )}

      {/* Stats summary (minimal) */}
      {stats && stats.running + stats.queued > 0 && (
        <div className="task-stats" aria-live="polite">
          {stats.running > 0 && (
            <span className="stat-item stat-running">{stats.running} running</span>
          )}
          {stats.queued > 0 && <span className="stat-item stat-queued">{stats.queued} queued</span>}
        </div>
      )}
    </div>
  );
}

export default TaskIndicator;
