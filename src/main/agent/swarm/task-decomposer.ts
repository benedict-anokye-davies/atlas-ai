/**
 * @fileoverview Task Decomposer - Intelligent task breakdown system
 * @module agent/swarm/task-decomposer
 * @author Atlas Team
 * @since 2.0.0
 *
 * @description
 * Analyzes complex tasks and decomposes them into smaller, manageable subtasks
 * that can be distributed across multiple agents. Uses LLM-based analysis for
 * intelligent task breakdown.
 */

import { v4 as uuidv4 } from 'uuid';
import { createModuleLogger } from '../../utils/logger';
import { getLLMManager } from '../../llm/manager';
import {
  Task,
  TaskDecomposition,
  ExecutionMode,
  ExecutionStrategy,
  RetryStrategy,
  TaskComplexity,
} from './types';

const logger = createModuleLogger('TaskDecomposer');

// =============================================================================
// Task Decomposer Class
// =============================================================================

/**
 * Intelligent task decomposition engine.
 *
 * Analyzes tasks and breaks them down into subtasks that can be executed
 * by multiple agents in parallel or sequentially.
 *
 * @class TaskDecomposer
 */
export class TaskDecomposer {
  private llmManager = getLLMManager();

  /**
   * Decompose a task into subtasks.
   *
   * @async
   * @param {Task} task - Task to decompose
   * @returns {Promise<TaskDecomposition>} Decomposition result
   */
  async decompose(task: Task): Promise<TaskDecomposition> {
    logger.info('Decomposing task', { taskId: task.id, complexity: task.complexity });

    // For simple tasks, don't decompose
    if (task.complexity === 'low') {
      return this.createSimpleDecomposition(task);
    }

    // Use LLM for intelligent decomposition of complex tasks
    const subtasks = await this.intelligentDecomposition(task);

    // Determine execution strategy
    const strategy = this.determineExecutionStrategy(task, subtasks);

    // Calculate estimates
    const estimatedDuration = this.estimateDuration(subtasks);
    const requiredAgentTypes = this.identifyRequiredAgentTypes(subtasks);

    return {
      originalTask: task,
      subtasks,
      strategy,
      estimatedDuration,
      requiredAgentTypes,
    };
  }

  /**
   * Create a simple decomposition (no breakdown) for low-complexity tasks.
   */
  private createSimpleDecomposition(task: Task): TaskDecomposition {
    return {
      originalTask: task,
      subtasks: [task],
      strategy: {
        mode: 'sequential',
        parallelFactor: 1,
        retryStrategy: this.getDefaultRetryStrategy(),
      },
      estimatedDuration: 60000, // 1 minute default
      requiredAgentTypes: task.type ? [task.type] : ['general'],
    };
  }

  /**
   * Use LLM to intelligently decompose a complex task.
   */
  private async intelligentDecomposition(task: Task): Promise<Task[]> {
    try {
      const prompt = this.buildDecompositionPrompt(task);

      // Use LLM to analyze and decompose
      const response = await this.llmManager.chat(prompt);

      // Parse the decomposition
      const subtasks = this.parseDecompositionResponse(response.content, task);

      logger.info('Task decomposed', {
        taskId: task.id,
        subtaskCount: subtasks.length,
      });

      return subtasks;
    } catch (error) {
      logger.error('Intelligent decomposition failed', {
        taskId: task.id,
        error: (error as Error).message,
      });

      // Fallback: create a single subtask
      return [task];
    }
  }

  /**
   * Build the decomposition prompt for the LLM.
   */
  private buildDecompositionPrompt(task: Task): string {
    return `
Analyze the following task and break it down into specific, actionable subtasks.

Task: ${task.description}
Complexity: ${task.complexity}
Type: ${task.type || 'general'}
${task.context ? `Context: ${JSON.stringify(task.context)}` : ''}

Please decompose this task into 2-6 subtasks. For each subtask, provide:
1. A clear description
2. The type of agent best suited (coder, research, creative, system, data, security)
3. Required capabilities
4. Estimated complexity (low, medium, high)
5. Any dependencies on other subtasks

Format your response as a JSON array:
[
  {
    "description": "Subtask description",
    "type": "agent_type",
    "capabilities": ["capability1", "capability2"],
    "complexity": "medium",
    "dependencies": []
  }
]
`;
  }

  /**
   * Parse the LLM decomposition response.
   */
  private parseDecompositionResponse(content: string, parentTask: Task): Task[] {
    try {
      // Try to extract JSON from the response
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        throw new Error('No JSON array found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]) as Array<{
        description: string;
        type: string;
        capabilities: string[];
        complexity: TaskComplexity;
        dependencies?: number[];
      }>;

      return parsed.map((item, index) => ({
        id: `${parentTask.id}-sub-${index + 1}`,
        description: item.description,
        type: item.type,
        complexity: item.complexity,
        requiredCapabilities: item.capabilities,
        parentId: parentTask.id,
        dependencies: item.dependencies?.map((i) => `${parentTask.id}-sub-${i}`),
        priority: parentTask.priority,
        context: parentTask.context,
      }));
    } catch (error) {
      logger.error('Failed to parse decomposition', {
        error: (error as Error).message,
        content: content.substring(0, 200),
      });

      // Fallback: return single task
      return [parentTask];
    }
  }

  /**
   * Determine the best execution strategy for the subtasks.
   */
  private determineExecutionStrategy(task: Task, subtasks: Task[]): ExecutionStrategy {
    // If only one subtask, use sequential
    if (subtasks.length === 1) {
      return {
        mode: 'sequential',
        parallelFactor: 1,
        retryStrategy: this.getDefaultRetryStrategy(),
      };
    }

    // Check for dependencies
    const hasDependencies = subtasks.some((st) => st.dependencies && st.dependencies.length > 0);

    if (hasDependencies) {
      // Use hybrid mode if there are dependencies
      return {
        mode: 'hybrid',
        parallelFactor: Math.min(subtasks.length, 3),
        retryStrategy: this.getDefaultRetryStrategy(),
      };
    }

    // For independent tasks, use parallel
    return {
      mode: 'parallel',
      parallelFactor: Math.min(subtasks.length, 5),
      retryStrategy: this.getDefaultRetryStrategy(),
    };
  }

  /**
   * Estimate total duration for subtasks.
   */
  private estimateDuration(subtasks: Task[]): number {
    const complexityMultiplier: Record<TaskComplexity, number> = {
      low: 30000, // 30 seconds
      medium: 60000, // 1 minute
      high: 180000, // 3 minutes
      critical: 300000, // 5 minutes
    };

    return subtasks.reduce((total, task) => {
      return total + complexityMultiplier[task.complexity];
    }, 0);
  }

  /**
   * Identify required agent types from subtasks.
   */
  private identifyRequiredAgentTypes(subtasks: Task[]): string[] {
    const types = new Set<string>();

    for (const task of subtasks) {
      if (task.type) {
        types.add(task.type);
      }
    }

    return Array.from(types);
  }

  /**
   * Get default retry strategy.
   */
  private getDefaultRetryStrategy(): RetryStrategy {
    return {
      maxRetries: 2,
      retryDelay: 5000,
      exponentialBackoff: true,
      nonRetryableTypes: ['destructive', 'payment', 'critical'],
    };
  }
}
