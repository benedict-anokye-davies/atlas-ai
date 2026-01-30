/**
 * @fileoverview Base Agent - Foundation class for all specialized agents
 * @module agent/swarm/base-agent
 * @author Atlas Team
 * @since 2.0.0
 *
 * @description
 * Abstract base class that all specialized agents must extend. Provides
 * common functionality for agent lifecycle, task execution, and event handling.
 *
 * @example
 * ```typescript
 * class CoderAgent extends BaseAgent {
 *   constructor() {
 *     super({
 *       type: 'coder',
 *       name: 'Coder Agent',
 *       capabilities: ['code-generation', 'debugging', 'refactoring'],
 *       maxConcurrentTasks: 3,
 *       priority: 1,
 *     });
 *   }
 *
 *   async execute(task: Task): Promise<TaskResult> {
 *     // Implementation
 *   }
 * }
 * ```
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { createModuleLogger } from '../../utils/logger';
import type { AgentConfig, AgentStatus, AgentType, Task, TaskResult } from './types';
export type { AgentConfig, AgentStatus, AgentType };

const logger = createModuleLogger('BaseAgent');

// =============================================================================
// Base Agent Class
// =============================================================================

/**
 * Abstract base class for all swarm agents.
 *
 * Provides the foundation for specialized agents with:
 * - Lifecycle management (initialize, execute, shutdown)
 * - Task queue management
 * - Event emission for status changes
 * - Metrics tracking
 *
 * @abstract
 * @class BaseAgent
 * @extends EventEmitter
 */
export abstract class BaseAgent extends EventEmitter {
  /** Unique agent ID */
  readonly id: string;
  /** Agent configuration */
  protected config: AgentConfig;
  /** Current agent status */
  protected status: AgentStatus = 'idle';
  /** Task queue */
  protected taskQueue: Task[] = [];
  /** Active task count */
  protected activeTaskCount: number = 0;
  /** Total tasks executed */
  protected totalTasks: number = 0;
  /** Successful task count */
  protected successfulTasks: number = 0;
  /** Agent creation timestamp */
  protected createdAt: number;
  /** Whether agent is initialized */
  protected isInitialized: boolean = false;

  /**
   * Creates a new BaseAgent instance
   *
   * @param {AgentConfig} config - Agent configuration
   * @param {AgentType} config.type - Agent type/category
   * @param {string} config.name - Agent name
   * @param {string[]} config.capabilities - Agent capabilities
   * @param {number} [config.maxConcurrentTasks=1] - Max concurrent tasks
   * @param {number} [config.priority=1] - Agent priority
   */
  constructor(config: AgentConfig) {
    super();
    this.id = uuidv4();
    this.config = {
      ...config,
      maxConcurrentTasks: config.maxConcurrentTasks ?? 1,
      priority: config.priority ?? 1,
    };
    this.createdAt = Date.now();

    logger.info('BaseAgent created', {
      agentId: this.id,
      type: this.config.type,
      name: this.config.name,
    });
  }

  // ===========================================================================
  // Properties
  // ===========================================================================

  /**
   * Get agent type
   */
  get type(): AgentType {
    return this.config.type;
  }

  /**
   * Get agent name
   */
  get name(): string {
    return this.config.name;
  }

  /**
   * Get agent capabilities
   */
  get capabilities(): string[] {
    return this.config.capabilities;
  }

  /**
   * Get current status
   */
  get currentStatus(): AgentStatus {
    return this.status;
  }

  /**
   * Get agent metrics
   */
  get metrics() {
    return {
      totalTasks: this.totalTasks,
      successfulTasks: this.successfulTasks,
      failedTasks: this.totalTasks - this.successfulTasks,
      successRate: this.totalTasks > 0 ? this.successfulTasks / this.totalTasks : 0,
      activeTasks: this.activeTaskCount,
      queuedTasks: this.taskQueue.length,
      uptime: Date.now() - this.createdAt,
    };
  }

  // ===========================================================================
  // Lifecycle Methods
  // ===========================================================================

  /**
   * Initialize the agent.
   *
   * Called when agent is registered with the swarm.
   * Override to add custom initialization logic.
   *
   * @async
   * @returns {Promise<void>}
   *
   * @example
   * ```typescript
   * async initialize(): Promise<void> {
   *   await super.initialize();
   *   // Custom initialization
   *   await this.loadModels();
   * }
   * ```
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      logger.warn('Agent already initialized', { agentId: this.id });
      return;
    }

    this.status = 'initializing';
    this.emit('status-change', this.status);

    // Base initialization
    this.isInitialized = true;
    this.status = 'idle';
    this.emit('status-change', this.status);

    logger.info('Agent initialized', { agentId: this.id });
    this.emit('initialized');
  }

  /**
   * Shutdown the agent.
   *
   * Called when agent is unregistered from the swarm.
   * Override to add custom cleanup logic.
   *
   * @async
   * @returns {Promise<void>}
   */
  async shutdown(): Promise<void> {
    if (!this.isInitialized) {
      return;
    }

    this.status = 'offline';
    this.emit('status-change', this.status);

    // Clear task queue
    this.taskQueue = [];

    this.isInitialized = false;

    logger.info('Agent shutdown', { agentId: this.id });
    this.emit('shutdown');
  }

  // ===========================================================================
  // Task Execution
  // ===========================================================================

  /**
   * Execute a task.
   *
   * Abstract method that must be implemented by subclasses.
   * This is where the agent's core logic lives.
   *
   * @abstract
   * @async
   * @param {Task} task - Task to execute
   * @returns {Promise<TaskResult>} Task execution result
   *
   * @example
   * ```typescript
   * async execute(task: Task): Promise<TaskResult> {
   *   try {
   *     const result = await this.processTask(task);
   *     return {
   *       success: true,
   *       taskId: task.id,
   *       output: result.summary,
   *       data: result,
   *     };
   *   } catch (error) {
   *     return {
   *       success: false,
   *       taskId: task.id,
   *       error: error.message,
   *     };
   *   }
   * }
   * ```
   */
  abstract execute(task: Task): Promise<TaskResult>;

  /**
   * Queue a task for execution.
   *
   * @param {Task} task - Task to queue
   * @returns {boolean} True if task was queued
   */
  queueTask(task: Task): boolean {
    if (this.taskQueue.length >= this.config.maxConcurrentTasks * 2) {
      logger.warn('Task queue full', { agentId: this.id, taskId: task.id });
      return false;
    }

    this.taskQueue.push(task);
    logger.debug('Task queued', { agentId: this.id, taskId: task.id });
    this.emit('task-queued', { task });

    // Process queue if idle
    if (this.status === 'idle') {
      this.processQueue();
    }

    return true;
  }

  /**
   * Process the task queue.
   *
   * @private
   */
  private async processQueue(): Promise<void> {
    if (this.taskQueue.length === 0 || this.activeTaskCount >= this.config.maxConcurrentTasks) {
      return;
    }

    const task = this.taskQueue.shift();
    if (!task) return;

    this.activeTaskCount++;
    this.status = 'busy';
    this.emit('status-change', this.status);

    try {
      const result = await this.execute(task);

      this.totalTasks++;
      if (result.success) {
        this.successfulTasks++;
      }

      this.emit('task-complete', result);
    } catch (error) {
      logger.error('Task execution failed', {
        agentId: this.id,
        taskId: task.id,
        error: (error as Error).message,
      });

      this.totalTasks++;
      this.emit('task-complete', {
        success: false,
        taskId: task.id,
        error: (error as Error).message,
      });
    } finally {
      this.activeTaskCount--;

      if (this.activeTaskCount === 0 && this.taskQueue.length === 0) {
        this.status = 'idle';
        this.emit('status-change', this.status);
      } else if (this.taskQueue.length > 0) {
        // Process next task
        this.processQueue();
      }
    }
  }

  // ===========================================================================
  // Utility Methods
  // ===========================================================================

  /**
   * Check if agent has a specific capability.
   *
   * @param {string} capability - Capability to check
   * @returns {boolean} True if agent has capability
   */
  hasCapability(capability: string): boolean {
    return this.config.capabilities.includes(capability);
  }

  /**
   * Get agent configuration.
   *
   * @returns {AgentConfig} Agent configuration
   */
  getConfig(): AgentConfig {
    return { ...this.config };
  }

  /**
   * Update agent configuration.
   *
   * @param {Partial<AgentConfig>} updates - Configuration updates
   */
  updateConfig(updates: Partial<AgentConfig>): void {
    this.config = { ...this.config, ...updates };
    logger.info('Agent config updated', { agentId: this.id, updates });
    this.emit('config-updated', updates);
  }

  /**
   * Set agent status.
   *
   * @protected
   * @param {AgentStatus} status - New status
   */
  protected setStatus(status: AgentStatus): void {
    if (this.status !== status) {
      this.status = status;
      this.emit('status-change', status);
    }
  }

  /**
   * Log agent activity.
   *
   * @protected
   * @param {string} message - Log message
   * @param {Record<string, unknown>} [meta] - Additional metadata
   */
  protected log(message: string, meta?: Record<string, unknown>): void {
    logger.info(message, { agentId: this.id, ...meta });
  }

  /**
   * Log agent debug info.
   *
   * @protected
   * @param {string} message - Debug message
   * @param {Record<string, unknown>} [meta] - Additional metadata
   */
  protected debug(message: string, meta?: Record<string, unknown>): void {
    logger.debug(message, { agentId: this.id, ...meta });
  }

  /**
   * Log agent error.
   *
   * @protected
   * @param {string} message - Error message
   * @param {Error} error - Error object
   * @param {Record<string, unknown>} [meta] - Additional metadata
   */
  protected error(message: string, error: Error, meta?: Record<string, unknown>): void {
    logger.error(message, { agentId: this.id, error: error.message, ...meta });
  }
}
