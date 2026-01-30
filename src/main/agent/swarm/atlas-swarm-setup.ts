/**
 * @fileoverview Atlas Swarm Setup - Initialize swarm for Atlas development
 * @module agent/swarm/atlas-swarm-setup
 * @author Atlas Team
 * @since 2.0.0
 *
 * @description
 * Initializes and configures the agent swarm specifically for working on
 * the Atlas codebase itself. Creates specialized agents for different
 * aspects of Atlas development.
 *
 * @example
 * ```typescript
 * import { initializeAtlasSwarm, runAtlasImprovement } from './atlas-swarm-setup';
 *
 * // Initialize the swarm
 * const swarm = await initializeAtlasSwarm();
 *
 * // Have the swarm work on Atlas
 * const result = await runAtlasImprovement(
 *   'Fix all TypeScript errors and improve code quality'
 * );
 *
 * console.log(result.output);
 * ```
 */

import { AgentSwarmController, getSwarmController } from './controller';
import { AtlasDeveloperAgent } from './atlas-developer-agent';
import { CoderAgent, ResearchAgent, SystemAgent } from './specialized-agents';
import { Task } from './types';
import type { SwarmResult } from './controller';
import { createModuleLogger } from '../../utils/logger';

const logger = createModuleLogger('AtlasSwarmSetup');

/**
 * Initialize the agent swarm for Atlas development
 *
 * Creates and registers specialized agents for working on the Atlas codebase:
 * - AtlasDeveloperAgent: Primary agent for Atlas code modifications
 * - CoderAgent: General coding tasks and refactoring
 * - ResearchAgent: Research and analysis tasks
 * - SystemAgent: System-level changes and DevOps
 *
 * @async
 * @returns {Promise<AgentSwarmController>} Configured swarm controller
 *
 * @example
 * const swarm = await initializeAtlasSwarm();
 *
 * // Now the swarm can work on Atlas
 * const result = await swarm.executeTask({
 *   description: 'Refactor the voice pipeline code',
 *   complexity: 'high',
 * });
 */
export async function initializeAtlasSwarm(): Promise<AgentSwarmController> {
  logger.info('Initializing Atlas Development Swarm');

  // Get or create swarm controller
  const swarm = getSwarmController({
    maxConcurrentAgents: 5,
    defaultExecutionMode: 'parallel',
    consensusThreshold: 0.8,
    taskTimeout: 600000, // 10 minutes for complex development tasks
    enableCommunication: true,
    autoScale: false, // Fixed agent count for predictability
  });

  // Start the swarm
  await swarm.start();

  // Register specialized agents for Atlas development

  // 1. Primary Atlas Developer Agent
  const atlasDeveloper = new AtlasDeveloperAgent({
    maxConcurrentTasks: 2,
    priority: 1,
  });
  await swarm.registerAgent(atlasDeveloper);
  logger.info('Registered AtlasDeveloperAgent');

  // 2. Coder Agent for general coding tasks
  const coderAgent = new CoderAgent({
    maxConcurrentTasks: 3,
    priority: 2,
  });
  await swarm.registerAgent(coderAgent);
  logger.info('Registered CoderAgent');

  // 3. Research Agent for analysis and investigation
  const researchAgent = new ResearchAgent({
    maxConcurrentTasks: 2,
    priority: 3,
  });
  await swarm.registerAgent(researchAgent);
  logger.info('Registered ResearchAgent');

  // 4. System Agent for infrastructure and configuration
  const systemAgent = new SystemAgent({
    maxConcurrentTasks: 2,
    priority: 3,
  });
  await swarm.registerAgent(systemAgent);
  logger.info('Registered SystemAgent');

  logger.info('Atlas Development Swarm initialized', {
    totalAgents: swarm.getStatus().totalAgents,
  });

  return swarm;
}

/**
 * Run an improvement task on Atlas using the swarm
 *
 * This is the main entry point for having the swarm work on Atlas.
 * The swarm will analyze the task, decompose it into subtasks, and
 * distribute work among the specialized agents.
 *
 * @async
 * @param {string} taskDescription - Description of what to improve/fix/add
 * @param {string} [complexity='medium'] - Task complexity (low/medium/high/critical)
 * @returns {Promise<SwarmResult>} Result of the improvement work
 *
 * @example
 * // Fix TypeScript errors
 * const result = await runAtlasImprovement(
 *   'Fix all TypeScript compilation errors in the codebase',
 *   'high'
 * );
 *
 * // Add a feature
 * const result = await runAtlasImprovement(
 *   'Add a new tool for managing bookmarks',
 *   'medium'
 * );
 *
 * // Improve code quality
 * const result = await runAtlasImprovement(
 *   'Refactor the agent tools to improve type safety',
 *   'high'
 * );
 */
export async function runAtlasImprovement(
  taskDescription: string,
  complexity: 'low' | 'medium' | 'high' | 'critical' = 'medium'
): Promise<SwarmResult> {
  logger.info('Starting Atlas improvement task', {
    description: taskDescription,
    complexity,
  });

  // Initialize swarm if not already done
  const swarm = await initializeAtlasSwarm();

  // Create the task
  const task: Task = {
    id: `atlas-improvement-${Date.now()}`,
    description: taskDescription,
    complexity,
    type: 'atlas-development',
    requiredCapabilities: ['read-files', 'write-files', 'modify-code', 'run-tests', 'type-check'],
    priority: complexity === 'critical' ? 10 : complexity === 'high' ? 7 : 5,
  };

  // Execute the task
  const result = await swarm.executeTask(task, 'hybrid');

  // Log results
  logger.info('Atlas improvement task completed', {
    success: result.success,
    duration: result.metadata.duration,
    agentCount: result.metadata.agentCount,
    taskCount: result.metadata.taskCount,
  });

  // Get detailed change summary from AtlasDeveloperAgent
  const atlasDevAgent = swarm.getAllAgents().find((a) => a.name === 'Atlas Developer Agent') as
    | AtlasDeveloperAgent
    | undefined;

  if (atlasDevAgent) {
    const changeSummary = atlasDevAgent.getChangeSummary();
    logger.info('Changes made to Atlas', changeSummary);
  }

  return result;
}

/**
 * Run multiple improvement tasks on Atlas
 *
 * @async
 * @param {Array<{description: string; complexity?: 'low' | 'medium' | 'high' | 'critical'}>} tasks - Tasks to run
 * @returns {Promise<SwarmResult[]>} Results for each task
 *
 * @example
 * const results = await runMultipleAtlasImprovements([
 *   { description: 'Fix TypeScript errors', complexity: 'high' },
 *   { description: 'Add tests for swarm system', complexity: 'medium' },
 *   { description: 'Update documentation', complexity: 'low' },
 * ]);
 */
export async function runMultipleAtlasImprovements(
  tasks: Array<{
    description: string;
    complexity?: 'low' | 'medium' | 'high' | 'critical';
  }>
): Promise<SwarmResult[]> {
  logger.info('Running multiple Atlas improvement tasks', { count: tasks.length });

  const swarm = await initializeAtlasSwarm();

  // Create task objects
  const taskObjects: Task[] = tasks.map((t, index) => ({
    id: `atlas-improvement-${Date.now()}-${index}`,
    description: t.description,
    complexity: t.complexity || 'medium',
    type: 'atlas-development',
    requiredCapabilities: ['read-files', 'write-files', 'modify-code'],
  }));

  // Execute all tasks
  return swarm.executeMultipleTasks(taskObjects);
}

/**
 * Quick fix - Have the swarm fix a specific issue
 *
 * Convenience function for quick fixes without full swarm setup.
 *
 * @async
 * @param {string} issue - Description of the issue to fix
 * @returns {Promise<string>} Summary of the fix
 *
 * @example
 * // Quick fix TypeScript errors
 * const result = await quickAtlasFix('Fix TypeScript errors in src/main/agent/swarm/');
 * console.log(result);
 */
export async function quickAtlasFix(issue: string): Promise<string> {
  const result = await runAtlasImprovement(issue, 'high');

  if (result.success) {
    const outputs = result.results
      .map((r) => r.output)
      .filter(Boolean)
      .join('\n');
    return `✅ Fixed: ${issue}\n\nChanges made:\n${outputs}\n\nCompleted in ${result.metadata.duration}ms using ${result.metadata.agentCount} agents.`;
  } else {
    return `❌ Failed to fix: ${issue}\n\nErrors:\n${result.errors.map((e) => e.message).join('\n')}`;
  }
}

/**
 * Get swarm status for Atlas development
 *
 * @returns {Object} Current swarm status
 */
export function getAtlasSwarmStatus(): {
  initialized: boolean;
  agentCount: number;
  activeAgents: number;
  metrics: {
    totalTasks: number;
    successfulTasks: number;
    failedTasks: number;
  };
} {
  try {
    const swarm = getSwarmController();
    const status = swarm.getStatus();

    return {
      initialized: status.isRunning,
      agentCount: status.totalAgents,
      activeAgents: status.activeAgents,
      metrics: status.metrics,
    };
  } catch {
    return {
      initialized: false,
      agentCount: 0,
      activeAgents: 0,
      metrics: {
        totalTasks: 0,
        successfulTasks: 0,
        failedTasks: 0,
      },
    };
  }
}
