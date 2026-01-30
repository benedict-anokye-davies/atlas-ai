/**
 * @fileoverview Cron Tool - Schedule Background Tasks
 * @module agent/tools/cron
 * @author Atlas Team
 * @since 1.0.0
 *
 * @description
 * Tools for scheduling and managing background tasks in Atlas.
 * Enables the agent to:
 * - Schedule recurring tasks (cron expressions)
 * - Set one-time reminders
 * - List and manage scheduled tasks
 * - Cancel scheduled tasks
 *
 * @see https://docs.clawd.bot/tools/cron
 *
 * @example
 * import { cronScheduleTool, cronListTool } from './cron';
 *
 * // Schedule a daily reminder
 * await cronScheduleTool.execute({
 *   name: 'daily-standup',
 *   cron: '0 9 * * 1-5',
 *   message: 'Time for the daily standup!',
 * });
 */

import { createModuleLogger } from '../../utils/logger';
import {
  getCronScheduler,
  ScheduledTask,
  CreateTaskOptions,
  MessageAction,
  NotifyAction,
  ToolAction,
} from '../../gateway/cron';
import type { AgentTool, ActionResult } from '../index';

const logger = createModuleLogger('CronTool');

// =============================================================================
// Cron Schedule Tool
// =============================================================================

/**
 * Schedule a new task
 * 
 * Supports both cron expressions for recurring tasks and
 * one-time scheduling with runAt timestamp.
 */
export const cronScheduleTool: AgentTool = {
  name: 'cron_schedule',
  description: `Schedule a task to run at a specific time or on a recurring schedule.

Use this tool to:
- Set reminders ("remind me in 1 hour")
- Schedule recurring tasks ("every day at 9am")
- Automate repetitive operations

Cron Expression Format: minute hour day-of-month month day-of-week
Examples:
- "0 9 * * *" = Every day at 9:00 AM
- "0 9 * * 1-5" = Weekdays at 9:00 AM
- "*/15 * * * *" = Every 15 minutes
- "0 0 1 * *" = First of every month at midnight

For one-time tasks, use runAt with a Unix timestamp or relative time.`,

  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Name for the task (required)',
      },
      cron: {
        type: 'string',
        description: 'Cron expression for recurring tasks (e.g., "0 9 * * *" for daily at 9am)',
      },
      runAt: {
        type: 'number',
        description: 'Unix timestamp for one-time tasks (milliseconds since epoch)',
      },
      runIn: {
        type: 'number',
        description: 'Run task in X milliseconds from now (alternative to runAt)',
      },
      message: {
        type: 'string',
        description: 'Message to send when task runs',
      },
      notification: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Notification title' },
          body: { type: 'string', description: 'Notification body' },
        },
        description: 'Send a notification instead of a message',
      },
      tool: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Tool name to execute' },
          params: { type: 'object', description: 'Tool parameters' },
        },
        description: 'Execute a tool when task runs',
      },
      maxRuns: {
        type: 'number',
        description: 'Maximum number of times to run (0 = unlimited, default for recurring)',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Tags for organizing tasks',
      },
    },
    required: ['name'],
  },

  async execute(params: Record<string, unknown>): Promise<ActionResult> {
    try {
      const scheduler = getCronScheduler();
      const name = params.name as string;

      // Validate scheduling method
      const hasCron = !!params.cron;
      const hasRunAt = !!params.runAt;
      const hasRunIn = !!params.runIn;

      if (!hasCron && !hasRunAt && !hasRunIn) {
        return {
          success: false,
          output: 'Please specify when to run the task: cron (for recurring), runAt (timestamp), or runIn (delay in ms)',
          error: 'Missing scheduling parameter',
        };
      }

      // Determine action type
      let action: MessageAction | NotifyAction | ToolAction;

      if (params.notification) {
        const notif = params.notification as { title: string; body?: string };
        action = {
          type: 'notify',
          title: notif.title,
          body: notif.body,
        };
      } else if (params.tool) {
        const tool = params.tool as { name: string; params?: Record<string, unknown> };
        action = {
          type: 'tool',
          tool: tool.name,
          toolParams: tool.params || {},
        };
      } else {
        action = {
          type: 'message',
          channel: 'desktop',
          content: params.message as string || `Scheduled task: ${name}`,
        };
      }

      // Build task options
      const options: CreateTaskOptions = {
        name,
        action,
        tags: params.tags as string[] | undefined,
      };

      if (hasCron) {
        options.cron = params.cron as string;
      } else if (hasRunIn) {
        options.runAt = Date.now() + (params.runIn as number);
        options.maxRuns = 1;
      } else if (hasRunAt) {
        options.runAt = params.runAt as number;
        options.maxRuns = 1;
      }

      if (params.maxRuns !== undefined) {
        options.maxRuns = params.maxRuns as number;
      }

      // Create task
      const task = scheduler.schedule(options);

      // Format output
      const nextRun = task.nextRunAt
        ? new Date(task.nextRunAt).toLocaleString()
        : 'N/A';

      logger.info('Task scheduled', {
        taskId: task.id,
        name: task.name,
        nextRunAt: task.nextRunAt,
      });

      return {
        success: true,
        output: `✅ Task "${name}" scheduled!
Task ID: ${task.id.slice(0, 8)}...
${task.cron ? `Schedule: ${task.cron}` : `One-time`}
Next run: ${nextRun}`,
        data: {
          taskId: task.id,
          name: task.name,
          cron: task.cron,
          nextRunAt: task.nextRunAt,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to schedule task', { error });

      return {
        success: false,
        output: `Failed to schedule task: ${errorMessage}`,
        error: errorMessage,
      };
    }
  },
};

// =============================================================================
// Cron List Tool
// =============================================================================

/**
 * List scheduled tasks
 */
export const cronListTool: AgentTool = {
  name: 'cron_list',
  description: `List all scheduled tasks.

Use this tool to:
- See what tasks are scheduled
- Check when tasks will run next
- Review task status and run history`,

  parameters: {
    type: 'object',
    properties: {
      state: {
        type: 'string',
        enum: ['active', 'paused', 'completed', 'failed', 'cancelled'],
        description: 'Filter by task state (optional)',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Filter by tags (optional)',
      },
    },
    required: [],
  },

  async execute(params: Record<string, unknown>): Promise<ActionResult> {
    try {
      const scheduler = getCronScheduler();

      const tasks = scheduler.listTasks({
        state: params.state as ScheduledTask['state'] | undefined,
        tags: params.tags as string[] | undefined,
      });

      if (tasks.length === 0) {
        return {
          success: true,
          output: 'No scheduled tasks found.',
          data: { tasks: [] },
        };
      }

      // Format output
      const output = tasks
        .map((task) => {
          const nextRun = task.nextRunAt
            ? new Date(task.nextRunAt).toLocaleString()
            : 'N/A';
          const lastRun = task.lastRunAt
            ? new Date(task.lastRunAt).toLocaleString()
            : 'Never';

          return `**${task.name}** (${task.id.slice(0, 8)}...)
  State: ${task.state} | Runs: ${task.runCount}${task.maxRuns ? `/${task.maxRuns}` : ''}
  ${task.cron ? `Cron: ${task.cron}` : 'One-time'}
  Next: ${nextRun} | Last: ${lastRun}
  ${task.tags?.length ? `Tags: ${task.tags.join(', ')}` : ''}`;
        })
        .join('\n\n');

      return {
        success: true,
        output: `Found ${tasks.length} task(s):\n\n${output}`,
        data: {
          count: tasks.length,
          tasks: tasks.map((t) => ({
            id: t.id,
            name: t.name,
            state: t.state,
            cron: t.cron,
            nextRunAt: t.nextRunAt,
            runCount: t.runCount,
          })),
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to list tasks', { error });

      return {
        success: false,
        output: `Failed to list tasks: ${errorMessage}`,
        error: errorMessage,
      };
    }
  },
};

// =============================================================================
// Cron Cancel Tool
// =============================================================================

/**
 * Cancel a scheduled task
 */
export const cronCancelTool: AgentTool = {
  name: 'cron_cancel',
  description: `Cancel a scheduled task.

Use this tool to:
- Stop a recurring task from running
- Cancel a pending one-time task
- Remove tasks that are no longer needed`,

  parameters: {
    type: 'object',
    properties: {
      taskId: {
        type: 'string',
        description: 'The ID of the task to cancel',
      },
      name: {
        type: 'string',
        description: 'The name of the task to cancel (if ID unknown)',
      },
    },
    required: [],
  },

  async execute(params: Record<string, unknown>): Promise<ActionResult> {
    try {
      const scheduler = getCronScheduler();

      let taskId = params.taskId as string | undefined;

      // Find by name if ID not provided
      if (!taskId && params.name) {
        const tasks = scheduler.listTasks();
        const task = tasks.find((t) => t.name === params.name);
        if (task) {
          taskId = task.id;
        }
      }

      if (!taskId) {
        return {
          success: false,
          output: 'Task not found. Please provide a valid taskId or name.',
          error: 'Task not found',
        };
      }

      const success = scheduler.cancelTask(taskId);

      if (!success) {
        return {
          success: false,
          output: `Could not cancel task ${taskId}`,
          error: 'Cancel failed',
        };
      }

      logger.info('Task cancelled', { taskId });

      return {
        success: true,
        output: `Task ${taskId.slice(0, 8)}... has been cancelled.`,
        data: { taskId, cancelled: true },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to cancel task', { error });

      return {
        success: false,
        output: `Failed to cancel task: ${errorMessage}`,
        error: errorMessage,
      };
    }
  },
};

// =============================================================================
// Cron Run Tool
// =============================================================================

/**
 * Run a task immediately (manual trigger)
 */
export const cronRunTool: AgentTool = {
  name: 'cron_run',
  description: `Run a scheduled task immediately (manual trigger).

Use this tool to:
- Test a scheduled task
- Trigger a task outside its normal schedule
- Debug task execution`,

  parameters: {
    type: 'object',
    properties: {
      taskId: {
        type: 'string',
        description: 'The ID of the task to run',
      },
    },
    required: ['taskId'],
  },

  async execute(params: Record<string, unknown>): Promise<ActionResult> {
    try {
      const scheduler = getCronScheduler();
      const taskId = params.taskId as string;

      const result = await scheduler.runTask(taskId);

      logger.info('Task manually triggered', {
        taskId,
        success: result.success,
        duration: result.duration,
      });

      return {
        success: result.success,
        output: result.success
          ? `Task ${taskId.slice(0, 8)}... executed successfully in ${result.duration}ms`
          : `Task ${taskId.slice(0, 8)}... failed: ${result.error}`,
        data: result,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to run task', { error });

      return {
        success: false,
        output: `Failed to run task: ${errorMessage}`,
        error: errorMessage,
      };
    }
  },
};

// =============================================================================
// Export All Tools
// =============================================================================

export const cronTools = [
  cronScheduleTool,
  cronListTool,
  cronCancelTool,
  cronRunTool,
];

export default cronTools;
