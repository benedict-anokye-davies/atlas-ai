/**
 * @fileoverview Agent Swarm Controller - Multi-Agent Orchestration System
 * @module agent/swarm/controller
 * @author Atlas Team
 * @since 2.0.0
 *
 * @description
 * Central controller for the Kimi K2.5 Agent Swarm system. Manages multiple
 * specialized agents, coordinates their activities, decomposes complex tasks,
 * and aggregates results. Enables parallel execution and collaborative problem-solving.
 *
 * Features:
 * - Dynamic agent spawning and lifecycle management
 * - Intelligent task decomposition and routing
 * - Parallel and sequential execution modes
 * - Inter-agent communication protocol
 * - Result aggregation and consensus building
 * - Load balancing across agents
 *
 * @example
 * ```typescript
 * const swarm = new AgentSwarmController();
 *
 * // Register specialized agents
 * swarm.registerAgent(new CoderAgent());
 * swarm.registerAgent(new ResearchAgent());
 *
 * // Execute complex task
 * const result = await swarm.executeTask({
 *   task: "Build a React dashboard",
 *   complexity: "high"
 * });
 * ```
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { createModuleLogger } from '../../utils/logger';
import { BaseAgent, AgentConfig, AgentType, AgentStatus } from './base-agent';
import { Task, TaskResult, TaskDecomposition, ExecutionMode } from './types';
import { TaskDecomposer } from './task-decomposer';
import { AgentCommunicator } from './communicator';
import { ResultAggregator } from './result-aggregator';

const logger = createModuleLogger('SwarmController');

// =============================================================================
// Types and Interfaces
// =============================================================================

/**
 * Swarm controller configuration
 */
export interface SwarmConfig {
  /** Maximum number of concurrent agents */
  maxConcurrentAgents: number;
  /** Default execution mode */
  defaultExecutionMode: ExecutionMode;
  /** Enable load balancing */
  enableLoadBalancing: boolean;
  /** Consensus threshold (0-1) */
  consensusThreshold: number;
  /** Task timeout in ms */
  taskTimeout: number;
  /** Enable inter-agent communication */
  enableCommunication: boolean;
  /** Auto-scale agents based on workload */
  autoScale: boolean;
}

/**
 * Default swarm configuration
 */
export const DEFAULT_SWARM_CONFIG: SwarmConfig = {
  maxConcurrentAgents: 10,
  defaultExecutionMode: 'parallel',
  enableLoadBalancing: true,
  consensusThreshold: 0.7,
  taskTimeout: 300000, // 5 minutes
  enableCommunication: true,
  autoScale: true,
};

/**
 * Swarm execution result
 */
export interface SwarmResult {
  /** Unique execution ID */
  executionId: string;
  /** Overall success status */
  success: boolean;
  /** Aggregated results from all agents */
  results: TaskResult[];
  /** Execution metadata */
  metadata: {
    startTime: number;
    endTime: number;
    duration: number;
    agentCount: number;
    taskCount: number;
    executionMode: ExecutionMode;
  };
  /** Any errors that occurred */
  errors: Error[];
  /** Consensus score (if applicable) */
  consensusScore?: number;
}

/**
 * Agent registration info
 */
interface AgentRegistration {
  agent: BaseAgent;
  config: AgentConfig;
  status: AgentStatus;
  registeredAt: number;
  lastActive: number;
  taskCount: number;
  successCount: number;
}

/**
 * Active task tracking
 */
interface ActiveTask {
  task: Task;
  subtasks: Task[];
  agents: BaseAgent[];
  startTime: number;
  timeout: number;
  results: Map<string, TaskResult>;
  status: 'pending' | 'running' | 'completed' | 'failed';
}

// =============================================================================
// Agent Swarm Controller Class
// =============================================================================

/**
 * Central controller for multi-agent swarm operations.
 *
 * The SwarmController orchestrates multiple specialized agents to collaboratively
 * solve complex tasks. It handles task decomposition, agent assignment, execution
 * coordination, and result aggregation.
 *
 * @class AgentSwarmController
 * @extends EventEmitter
 */
export class AgentSwarmController extends EventEmitter {
  private config: SwarmConfig;
  private agents: Map<string, AgentRegistration> = new Map();
  private activeTasks: Map<string, ActiveTask> = new Map();
  private taskDecomposer: TaskDecomposer;
  private communicator: AgentCommunicator;
  private resultAggregator: ResultAggregator;
  private isRunning: boolean = false;
  private metrics = {
    totalTasks: 0,
    successfulTasks: 0,
    failedTasks: 0,
    totalAgents: 0,
    avgExecutionTime: 0,
  };

  /**
   * Creates a new AgentSwarmController instance
   *
   * @param {Partial<SwarmConfig>} config - Swarm configuration options
   * @param {number} [config.maxConcurrentAgents=10] - Max concurrent agents
   * @param {ExecutionMode} [config.defaultExecutionMode='parallel'] - Default mode
   * @param {boolean} [config.enableLoadBalancing=true] - Enable load balancing
   * @param {number} [config.consensusThreshold=0.7] - Consensus threshold
   * @param {number} [config.taskTimeout=300000] - Task timeout in ms
   * @param {boolean} [config.enableCommunication=true] - Enable communication
   * @param {boolean} [config.autoScale=true] - Auto-scale agents
   *
   * @example
   * const swarm = new AgentSwarmController({
   *   maxConcurrentAgents: 5,
   *   defaultExecutionMode: 'sequential',
   *   consensusThreshold: 0.8,
   * });
   */
  constructor(config: Partial<SwarmConfig> = {}) {
    super();
    this.config = { ...DEFAULT_SWARM_CONFIG, ...config };
    this.taskDecomposer = new TaskDecomposer();
    this.communicator = new AgentCommunicator();
    this.resultAggregator = new ResultAggregator(this.config.consensusThreshold);

    logger.info('AgentSwarmController initialized', {
      maxConcurrentAgents: this.config.maxConcurrentAgents,
      defaultExecutionMode: this.config.defaultExecutionMode,
    });
  }

  // ===========================================================================
  // Agent Management
  // ===========================================================================

  /**
   * Register a new agent with the swarm
   *
   * @async
   * @param {BaseAgent} agent - Agent instance to register
   * @param {AgentConfig} [config] - Optional agent configuration
   * @returns {Promise<string>} Agent ID
   *
   * @example
   * const agent = new CoderAgent();
   * const agentId = await swarm.registerAgent(agent, {
   *   priority: 1,
   *   maxConcurrentTasks: 3,
   * });
   */
  async registerAgent(agent: BaseAgent, config?: AgentConfig): Promise<string> {
    const agentId = agent.id || uuidv4();

    if (this.agents.has(agentId)) {
      throw new Error(`Agent with ID ${agentId} already registered`);
    }

    // Initialize the agent
    await agent.initialize();

    const registration: AgentRegistration = {
      agent,
      config: config || agent.getConfig(),
      status: 'idle',
      registeredAt: Date.now(),
      lastActive: Date.now(),
      taskCount: 0,
      successCount: 0,
    };

    this.agents.set(agentId, registration);
    this.metrics.totalAgents++;

    // Set up agent event listeners
    agent.on('status-change', (status: AgentStatus) => {
      registration.status = status;
      registration.lastActive = Date.now();
      this.emit('agent-status-change', { agentId, status });
    });

    agent.on('task-complete', (result: TaskResult) => {
      registration.taskCount++;
      if (result.success) {
        registration.successCount++;
      }
      registration.lastActive = Date.now();
    });

    logger.info('Agent registered', {
      agentId,
      type: agent.type,
      name: agent.name,
    });

    this.emit('agent-registered', { agentId, agent });
    return agentId;
  }

  /**
   * Unregister an agent from the swarm
   *
   * @async
   * @param {string} agentId - ID of agent to unregister
   * @returns {Promise<boolean>} True if unregistered successfully
   *
   * @example
   * await swarm.unregisterAgent('agent-123');
   */
  async unregisterAgent(agentId: string): Promise<boolean> {
    const registration = this.agents.get(agentId);
    if (!registration) {
      logger.warn('Attempted to unregister non-existent agent', { agentId });
      return false;
    }

    // Shutdown the agent
    await registration.agent.shutdown();

    this.agents.delete(agentId);
    this.metrics.totalAgents--;

    logger.info('Agent unregistered', { agentId });
    this.emit('agent-unregistered', { agentId });
    return true;
  }

  /**
   * Get all registered agents
   *
   * @returns {BaseAgent[]} Array of all registered agents
   */
  getAllAgents(): BaseAgent[] {
    return Array.from(this.agents.values()).map((r) => r.agent);
  }

  /**
   * Get agents by type
   *
   * @param {AgentType} type - Agent type to filter by
   * @returns {BaseAgent[]} Array of agents of the specified type
   */
  getAgentsByType(type: AgentType): BaseAgent[] {
    return this.getAllAgents().filter((agent) => agent.type === type);
  }

  /**
   * Get agent by ID
   *
   * @param {string} agentId - Agent ID
   * @returns {BaseAgent | undefined} Agent instance or undefined
   */
  getAgent(agentId: string): BaseAgent | undefined {
    return this.agents.get(agentId)?.agent;
  }

  // ===========================================================================
  // Task Execution
  // ===========================================================================

  /**
   * Execute a task using the agent swarm
   *
   * @async
   * @param {Task | string} task - Task to execute (or task description string)
   * @param {ExecutionMode} [mode] - Execution mode (parallel/sequential/hybrid)
   * @returns {Promise<SwarmResult>} Execution result
   *
   * @example
   * // Execute with automatic decomposition
   * const result = await swarm.executeTask({
   *   id: 'task-123',
   *   description: 'Build a React dashboard',
   *   complexity: 'high',
   * });
   *
   * // Execute with specific mode
   * const result = await swarm.executeTask(
   *   'Analyze this codebase',
   *   'sequential'
   * );
   */
  async executeTask(task: Task | string, mode?: ExecutionMode): Promise<SwarmResult> {
    const executionId = uuidv4();
    const startTime = Date.now();

    // Normalize task input
    const normalizedTask: Task =
      typeof task === 'string' ? { id: uuidv4(), description: task, complexity: 'medium' } : task;

    logger.info('Starting swarm task execution', {
      executionId,
      taskId: normalizedTask.id,
      description: normalizedTask.description,
      mode: mode || this.config.defaultExecutionMode,
    });

    try {
      // Step 1: Decompose task into subtasks
      const decomposition = await this.taskDecomposer.decompose(normalizedTask);

      // Step 2: Assign agents to subtasks
      const assignments = this.assignAgentsToSubtasks(decomposition.subtasks);

      // Step 3: Execute subtasks
      const executionMode = mode || this.config.defaultExecutionMode;
      const subtaskResults = await this.executeSubtasks(assignments, executionMode, executionId);

      // Step 4: Aggregate results
      const aggregatedResult = await this.resultAggregator.aggregate(
        subtaskResults,
        decomposition.strategy
      );

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Update metrics
      this.metrics.totalTasks++;
      if (aggregatedResult.success) {
        this.metrics.successfulTasks++;
      } else {
        this.metrics.failedTasks++;
      }
      this.updateAverageExecutionTime(duration);

      const result: SwarmResult = {
        executionId,
        success: aggregatedResult.success,
        results: subtaskResults,
        metadata: {
          startTime,
          endTime,
          duration,
          agentCount: assignments.length,
          taskCount: decomposition.subtasks.length,
          executionMode,
        },
        errors: aggregatedResult.errors,
        consensusScore: aggregatedResult.consensusScore,
      };

      logger.info('Swarm task execution completed', {
        executionId,
        success: result.success,
        duration,
        agentCount: result.metadata.agentCount,
      });

      this.emit('task-complete', result);
      return result;
    } catch (error) {
      logger.error('Swarm task execution failed', {
        executionId,
        error: (error as Error).message,
      });

      this.metrics.failedTasks++;

      return {
        executionId,
        success: false,
        results: [],
        metadata: {
          startTime,
          endTime: Date.now(),
          duration: Date.now() - startTime,
          agentCount: 0,
          taskCount: 0,
          executionMode: mode || this.config.defaultExecutionMode,
        },
        errors: [error as Error],
      };
    }
  }

  /**
   * Execute multiple tasks in parallel
   *
   * @async
   * @param {Task[]} tasks - Array of tasks to execute
   * @returns {Promise<SwarmResult[]>} Results for each task
   */
  async executeMultipleTasks(tasks: Task[]): Promise<SwarmResult[]> {
    logger.info('Executing multiple tasks', { count: tasks.length });

    const promises = tasks.map((task) => this.executeTask(task, 'parallel'));
    return Promise.all(promises);
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Assign agents to subtasks based on capabilities and load
   */
  private assignAgentsToSubtasks(subtasks: Task[]): Array<{ subtask: Task; agent: BaseAgent }> {
    const assignments: Array<{ subtask: Task; agent: BaseAgent }> = [];
    const availableAgents = this.getAvailableAgents();

    for (const subtask of subtasks) {
      // Find best agent for this subtask
      const agent = this.selectBestAgent(subtask, availableAgents);

      if (agent) {
        assignments.push({ subtask, agent });
        // Mark agent as busy
        const registration = this.agents.get(agent.id);
        if (registration) {
          registration.status = 'busy';
        }
      } else {
        logger.warn('No available agent for subtask', {
          subtaskId: subtask.id,
          requiredCapabilities: subtask.requiredCapabilities,
        });
      }
    }

    return assignments;
  }

  /**
   * Select the best agent for a subtask
   */
  private selectBestAgent(subtask: Task, availableAgents: BaseAgent[]): BaseAgent | null {
    // Filter agents by required capabilities
    const capableAgents = availableAgents.filter((agent) => {
      if (!subtask.requiredCapabilities) return true;
      return subtask.requiredCapabilities.every((cap) => agent.capabilities.includes(cap));
    });

    if (capableAgents.length === 0) return null;

    // Score agents based on multiple factors
    const scoredAgents = capableAgents.map((agent) => {
      const registration = this.agents.get(agent.id)!;
      let score = 0;

      // Prefer agents with higher success rate
      if (registration.taskCount > 0) {
        score += (registration.successCount / registration.taskCount) * 100;
      } else {
        score += 50; // Neutral score for new agents
      }

      // Prefer specialized agents for the task type
      if (subtask.type && agent.type === subtask.type) {
        score += 50;
      }

      // Prefer less busy agents (load balancing)
      if (this.config.enableLoadBalancing) {
        const activeTasks = this.getAgentActiveTaskCount(agent.id);
        score -= activeTasks * 10;
      }

      return { agent, score };
    });

    // Sort by score (descending) and return best agent
    scoredAgents.sort((a, b) => b.score - a.score);
    return scoredAgents[0].agent;
  }

  /**
   * Get all available (idle) agents
   */
  private getAvailableAgents(): BaseAgent[] {
    return Array.from(this.agents.values())
      .filter((r) => r.status === 'idle')
      .map((r) => r.agent);
  }

  /**
   * Get count of active tasks for an agent
   */
  private getAgentActiveTaskCount(agentId: string): number {
    let count = 0;
    Array.from(this.activeTasks.values()).forEach((task) => {
      if (task.agents.some((a) => a.id === agentId)) {
        count++;
      }
    });
    return count;
  }

  /**
   * Execute subtasks based on execution mode
   */
  private async executeSubtasks(
    assignments: Array<{ subtask: Task; agent: BaseAgent }>,
    mode: ExecutionMode,
    executionId: string
  ): Promise<TaskResult[]> {
    switch (mode) {
      case 'parallel':
        return this.executeParallel(assignments, executionId);
      case 'sequential':
        return this.executeSequential(assignments, executionId);
      case 'hybrid':
        return this.executeHybrid(assignments, executionId);
      default:
        return this.executeParallel(assignments, executionId);
    }
  }

  /**
   * Execute subtasks in parallel
   */
  private async executeParallel(
    assignments: Array<{ subtask: Task; agent: BaseAgent }>,
    executionId: string
  ): Promise<TaskResult[]> {
    logger.debug('Executing subtasks in parallel', {
      executionId,
      count: assignments.length,
    });

    const promises = assignments.map(({ subtask, agent }) =>
      this.executeSubtaskWithTimeout(subtask, agent, executionId)
    );

    return Promise.all(promises);
  }

  /**
   * Execute subtasks sequentially
   */
  private async executeSequential(
    assignments: Array<{ subtask: Task; agent: BaseAgent }>,
    executionId: string
  ): Promise<TaskResult[]> {
    logger.debug('Executing subtasks sequentially', {
      executionId,
      count: assignments.length,
    });

    const results: TaskResult[] = [];

    for (const { subtask, agent } of assignments) {
      const result = await this.executeSubtaskWithTimeout(subtask, agent, executionId);
      results.push(result);

      // If a subtask fails and is critical, stop execution
      if (!result.success && subtask.critical) {
        logger.warn('Critical subtask failed, stopping sequential execution', {
          executionId,
          subtaskId: subtask.id,
        });
        break;
      }
    }

    return results;
  }

  /**
   * Execute subtasks in hybrid mode (parallel groups with sequential dependencies)
   */
  private async executeHybrid(
    assignments: Array<{ subtask: Task; agent: BaseAgent }>,
    executionId: string
  ): Promise<TaskResult[]> {
    logger.debug('Executing subtasks in hybrid mode', {
      executionId,
      count: assignments.length,
    });

    // Group subtasks by dependency level
    const groups = this.groupByDependencies(assignments);
    const results: TaskResult[] = [];

    // Execute each group sequentially, but tasks within group in parallel
    for (const group of groups) {
      const groupResults = await this.executeParallel(group, executionId);
      results.push(...groupResults);
    }

    return results;
  }

  /**
   * Group assignments by dependency level for hybrid execution
   */
  private groupByDependencies(
    assignments: Array<{ subtask: Task; agent: BaseAgent }>
  ): Array<Array<{ subtask: Task; agent: BaseAgent }>> {
    // Simple implementation: group by dependency count
    const groups = new Map<number, Array<{ subtask: Task; agent: BaseAgent }>>();

    for (const assignment of assignments) {
      const depCount = assignment.subtask.dependencies?.length || 0;
      if (!groups.has(depCount)) {
        groups.set(depCount, []);
      }
      groups.get(depCount)!.push(assignment);
    }

    // Sort by dependency count and return groups
    const sortedKeys = Array.from(groups.keys()).sort((a, b) => a - b);
    return sortedKeys.map((key) => groups.get(key)!);
  }

  /**
   * Execute a single subtask with timeout
   */
  private async executeSubtaskWithTimeout(
    subtask: Task,
    agent: BaseAgent,
    executionId: string
  ): Promise<TaskResult> {
    const timeout = subtask.timeout || this.config.taskTimeout;

    return Promise.race([
      this.executeSubtask(subtask, agent, executionId),
      this.createTimeoutPromise(timeout, subtask.id),
    ]);
  }

  /**
   * Execute a single subtask
   */
  private async executeSubtask(
    subtask: Task,
    agent: BaseAgent,
    executionId: string
  ): Promise<TaskResult> {
    try {
      logger.debug('Executing subtask', {
        executionId,
        subtaskId: subtask.id,
        agentId: agent.id,
        agentType: agent.type,
      });

      // Enable communication if configured
      if (this.config.enableCommunication) {
        this.communicator.registerChannel(executionId, agent);
      }

      // Execute the subtask
      const result = await agent.execute(subtask);

      // Update agent status
      const registration = this.agents.get(agent.id);
      if (registration) {
        registration.status = 'idle';
        registration.taskCount++;
        if (result.success) {
          registration.successCount++;
        }
      }

      logger.debug('Subtask completed', {
        executionId,
        subtaskId: subtask.id,
        success: result.success,
      });

      return result;
    } catch (error) {
      logger.error('Subtask execution failed', {
        executionId,
        subtaskId: subtask.id,
        error: (error as Error).message,
      });

      // Update agent status
      const registration = this.agents.get(agent.id);
      if (registration) {
        registration.status = 'idle';
        registration.taskCount++;
      }

      return {
        success: false,
        taskId: subtask.id,
        error: (error as Error).message,
        output: null,
        data: null,
      };
    }
  }

  /**
   * Create a timeout promise
   */
  private createTimeoutPromise(timeout: number, subtaskId: string): Promise<TaskResult> {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          success: false,
          taskId: subtaskId,
          error: `Subtask timed out after ${timeout}ms`,
          output: null,
          data: null,
        });
      }, timeout);
    });
  }

  /**
   * Update average execution time metric
   */
  private updateAverageExecutionTime(duration: number): void {
    const total = this.metrics.avgExecutionTime * (this.metrics.totalTasks - 1) + duration;
    this.metrics.avgExecutionTime = total / this.metrics.totalTasks;
  }

  // ===========================================================================
  // Public API
  // ===========================================================================

  /**
   * Start the swarm controller
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Swarm controller already running');
      return;
    }

    this.isRunning = true;
    logger.info('AgentSwarmController started');
    this.emit('started');
  }

  /**
   * Stop the swarm controller
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;

    // Cancel all active tasks
    for (const [taskId, task] of this.activeTasks) {
      logger.warn('Cancelling active task', { taskId });
      task.status = 'failed';
    }

    this.isRunning = false;
    logger.info('AgentSwarmController stopped');
    this.emit('stopped');
  }

  /**
   * Get swarm metrics
   */
  getMetrics() {
    return { ...this.metrics };
  }

  /**
   * Get swarm status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      totalAgents: this.agents.size,
      activeAgents: this.getAvailableAgents().length,
      activeTasks: this.activeTasks.size,
      metrics: this.getMetrics(),
    };
  }
}

// =============================================================================
// Singleton Factory
// =============================================================================

let swarmControllerInstance: AgentSwarmController | null = null;

/**
 * Get or create the singleton swarm controller instance
 */
export function getSwarmController(config?: Partial<SwarmConfig>): AgentSwarmController {
  if (!swarmControllerInstance) {
    swarmControllerInstance = new AgentSwarmController(config);
  }
  return swarmControllerInstance;
}

/**
 * Initialize the swarm controller with configuration
 */
export async function initializeSwarm(
  config?: Partial<SwarmConfig>
): Promise<AgentSwarmController> {
  const swarm = getSwarmController(config);
  await swarm.start();
  return swarm;
}

/**
 * Shutdown the swarm controller
 */
export async function shutdownSwarm(): Promise<void> {
  if (swarmControllerInstance) {
    await swarmControllerInstance.stop();
    swarmControllerInstance = null;
  }
}
