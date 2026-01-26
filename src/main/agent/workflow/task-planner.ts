/**
 * Task Planner
 * 
 * Uses LLM to decompose natural language requests into structured workflow plans.
 * Analyzes requirements, identifies tools needed, and estimates complexity.
 * 
 * @module agent/workflow/task-planner
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { createModuleLogger } from '../../utils/logger';
import { getLLMManager } from '../../llm';
import { getToolRegistry } from '../tool-registry';
import {
  TaskPlan,
  PlannedTask,
  Requirement,
  Risk,
  WorkflowStep,
  StepType,
  Workflow,
  WorkflowContext,
  DEFAULT_WORKFLOW_CONFIG,
} from './types';

const logger = createModuleLogger('TaskPlanner');

// ============================================================================
// Planning Prompts
// ============================================================================

const PLANNING_SYSTEM_PROMPT = `You are a task planning AI that decomposes user requests into structured execution plans.

Your job is to:
1. Understand the user's intent
2. Break down complex requests into atomic, executable steps
3. Identify required tools and their parameters
4. Determine dependencies between steps
5. Assess risks and requirements

Available tools:
{{TOOLS}}

Output your plan as JSON with this structure:
{
  "interpretation": "Your understanding of what the user wants",
  "confidence": 0.0-1.0,
  "tasks": [
    {
      "id": "task_1",
      "description": "What this task does",
      "toolsRequired": ["tool_name"],
      "dependencies": [],
      "optional": false,
      "estimatedDuration": 5000
    }
  ],
  "requirements": [
    {
      "type": "file|api|permission|tool",
      "description": "What is needed",
      "satisfied": true,
      "blocksExecution": true
    }
  ],
  "risks": [
    {
      "type": "data-loss|side-effect|performance|security",
      "description": "What could go wrong",
      "severity": "low|medium|high",
      "mitigation": "How to prevent it"
    }
  ],
  "complexity": "simple|moderate|complex"
}

Guidelines:
- Keep tasks atomic and focused
- Order tasks by dependencies
- Be conservative with risk assessment
- Mark destructive operations clearly
- Prefer reading before writing
- Always validate before executing`;

const STEP_GENERATION_PROMPT = `Convert this task plan into executable workflow steps.

Task Plan:
{{PLAN}}

Available Tools:
{{TOOLS}}

Generate steps as JSON array:
[
  {
    "id": "step_1",
    "type": "tool|llm|conditional|parallel|human-input|checkpoint",
    "name": "Short name",
    "description": "What this step does",
    "tool": {
      "name": "tool_name",
      "parameters": {}
    },
    "dependencies": [],
    "rollbackAction": {
      "type": "tool",
      "tool": { "name": "...", "parameters": {} }
    }
  }
]

Rules:
- Add checkpoint steps before destructive operations
- Include rollback actions for reversible steps
- Use human-input for confirmations on risky operations
- Group independent steps as parallel when safe`;

// ============================================================================
// Task Planner Class
// ============================================================================

export class TaskPlanner extends EventEmitter {
  private initialized = false;
  private toolDescriptions: string = '';

  constructor() {
    super();
  }

  /**
   * Initialize the planner with available tools
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Get tool descriptions for planning prompts
      const registry = getToolRegistry();
      const tools = registry.getAllTools();
      
      this.toolDescriptions = tools.map(tool => 
        `- ${tool.name}: ${tool.description}\n  Parameters: ${JSON.stringify(tool.parameters)}`
      ).join('\n');

      this.initialized = true;
      logger.info('TaskPlanner initialized with', tools.length, 'tools');
    } catch (error) {
      logger.error('Failed to initialize TaskPlanner:', error);
      throw error;
    }
  }

  /**
   * Create a task plan from a natural language request
   */
  async planTask(request: string, context?: Partial<WorkflowContext>): Promise<TaskPlan> {
    await this.initialize();
    
    logger.info('Planning task:', request.substring(0, 100));
    this.emit('planning:started', { request });

    try {
      const llm = getLLMManager();
      
      // Build the planning prompt
      const systemPrompt = PLANNING_SYSTEM_PROMPT.replace('{{TOOLS}}', this.toolDescriptions);
      
      const response = await llm.chat(
        `Plan this request: "${request}"`,
        { systemPrompt },
        {
          temperature: 0.3,  // Lower temperature for more consistent planning
          maxTokens: 4000,
        }
      );

      // Parse the LLM response
      const planData = this.parsePlanResponse(response.content);
      
      const plan: TaskPlan = {
        id: uuidv4(),
        originalRequest: request,
        interpretation: planData.interpretation || request,
        confidence: planData.confidence || 0.7,
        tasks: planData.tasks || [],
        requirements: planData.requirements || [],
        risks: planData.risks || [],
        estimatedDuration: this.calculateEstimatedDuration(planData.tasks || []),
        estimatedSteps: planData.tasks?.length || 0,
        complexity: planData.complexity || 'moderate',
      };

      // Validate the plan
      this.validatePlan(plan);
      
      logger.info('Task plan created:', {
        id: plan.id,
        tasks: plan.tasks.length,
        complexity: plan.complexity,
        confidence: plan.confidence,
      });
      
      this.emit('planning:completed', { plan });
      return plan;

    } catch (error) {
      logger.error('Task planning failed:', error);
      this.emit('planning:failed', { request, error });
      throw error;
    }
  }

  /**
   * Convert a task plan into executable workflow steps
   */
  async generateWorkflowSteps(plan: TaskPlan): Promise<WorkflowStep[]> {
    await this.initialize();
    
    logger.info('Generating workflow steps for plan:', plan.id);

    try {
      const llm = getLLMManager();
      
      const prompt = STEP_GENERATION_PROMPT
        .replace('{{PLAN}}', JSON.stringify(plan, null, 2))
        .replace('{{TOOLS}}', this.toolDescriptions);

      const response = await llm.chat(
        prompt,
        { systemPrompt: 'You are a workflow step generator. Output valid JSON only.' },
        {
          temperature: 0.2,
          maxTokens: 4000,
        }
      );

      const stepsData = this.parseStepsResponse(response.content);
      
      // Convert to WorkflowStep objects with proper typing
      const steps: WorkflowStep[] = stepsData.map((step: Record<string, unknown>, index: number) => ({
        id: step.id as string || `step_${index + 1}`,
        type: (step.type as StepType) || 'tool',
        name: step.name as string || `Step ${index + 1}`,
        description: step.description as string || '',
        status: 'pending' as const,
        tool: step.tool as WorkflowStep['tool'],
        llm: step.llm as WorkflowStep['llm'],
        condition: step.condition as WorkflowStep['condition'],
        parallel: step.parallel as WorkflowStep['parallel'],
        loop: step.loop as WorkflowStep['loop'],
        humanInput: step.humanInput as WorkflowStep['humanInput'],
        dependencies: (step.dependencies as string[]) || [],
        retryConfig: step.retryConfig as WorkflowStep['retryConfig'],
        rollbackAction: step.rollbackAction as WorkflowStep['rollbackAction'],
      }));

      // Inject checkpoints before destructive operations
      const stepsWithCheckpoints = this.injectCheckpoints(steps, plan.risks);
      
      logger.info('Generated', stepsWithCheckpoints.length, 'workflow steps');
      return stepsWithCheckpoints;

    } catch (error) {
      logger.error('Step generation failed:', error);
      throw error;
    }
  }

  /**
   * Create a complete workflow from a request
   */
  async createWorkflow(request: string, workingDirectory?: string): Promise<Workflow> {
    // First, create the plan
    const plan = await this.planTask(request);
    
    // Check requirements
    const unsatisfiedRequirements = plan.requirements.filter(r => !r.satisfied && r.blocksExecution);
    if (unsatisfiedRequirements.length > 0) {
      const reqList = unsatisfiedRequirements.map(r => r.description).join(', ');
      throw new Error(`Cannot execute workflow: unsatisfied requirements: ${reqList}`);
    }

    // Generate steps
    const steps = await this.generateWorkflowSteps(plan);

    // Create the workflow
    const workflow: Workflow = {
      id: uuidv4(),
      name: plan.interpretation.substring(0, 50),
      description: plan.interpretation,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: 'pending',
      originalRequest: request,
      steps,
      currentStepIndex: 0,
      context: {
        userInput: {},
        stepOutputs: {},
        files: [],
        codeChanges: [],
        gitOperations: [],
        workingDirectory: workingDirectory || process.cwd(),
        environment: {},
      },
      results: [],
      checkpoints: [],
      canRollback: true,
    };

    logger.info('Workflow created:', {
      id: workflow.id,
      steps: workflow.steps.length,
      name: workflow.name,
    });

    return workflow;
  }

  /**
   * Parse LLM response into plan data
   */
  private parsePlanResponse(content: string): Partial<TaskPlan> {
    try {
      // Extract JSON from the response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      throw new Error('No JSON found in response');
    } catch (error) {
      logger.warn('Failed to parse plan response, using defaults:', error);
      return {
        interpretation: content.substring(0, 200),
        confidence: 0.5,
        tasks: [],
        requirements: [],
        risks: [],
        complexity: 'moderate',
      };
    }
  }

  /**
   * Parse LLM response into steps data
   */
  private parseStepsResponse(content: string): Record<string, unknown>[] {
    try {
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      throw new Error('No JSON array found in response');
    } catch (error) {
      logger.warn('Failed to parse steps response:', error);
      return [];
    }
  }

  /**
   * Validate a task plan
   */
  private validatePlan(plan: TaskPlan): void {
    // Check for circular dependencies
    const taskIds = new Set(plan.tasks.map(t => t.id));
    for (const task of plan.tasks) {
      for (const dep of task.dependencies) {
        if (!taskIds.has(dep)) {
          logger.warn(`Task ${task.id} has unknown dependency: ${dep}`);
        }
        if (dep === task.id) {
          throw new Error(`Task ${task.id} depends on itself`);
        }
      }
    }

    // Check for required tools
    const registry = getToolRegistry();
    for (const task of plan.tasks) {
      for (const toolName of task.toolsRequired) {
        if (!registry.hasTool(toolName)) {
          logger.warn(`Task ${task.id} requires unknown tool: ${toolName}`);
          plan.requirements.push({
            type: 'tool',
            description: `Tool "${toolName}" is not available`,
            satisfied: false,
            blocksExecution: true,
          });
        }
      }
    }
  }

  /**
   * Calculate estimated total duration
   */
  private calculateEstimatedDuration(tasks: PlannedTask[]): number {
    return tasks.reduce((sum, task) => sum + (task.estimatedDuration || 5000), 0);
  }

  /**
   * Inject checkpoint steps before risky operations
   */
  private injectCheckpoints(steps: WorkflowStep[], risks: Risk[]): WorkflowStep[] {
    const highRiskSteps = new Set<string>();
    
    // Find steps that involve high-risk operations
    for (const step of steps) {
      if (step.tool?.name?.includes('write') || 
          step.tool?.name?.includes('delete') ||
          step.tool?.name?.includes('commit') ||
          step.tool?.name?.includes('push')) {
        highRiskSteps.add(step.id);
      }
    }

    const result: WorkflowStep[] = [];
    let checkpointCount = 0;

    for (const step of steps) {
      // Add checkpoint before high-risk steps
      if (highRiskSteps.has(step.id) && checkpointCount < DEFAULT_WORKFLOW_CONFIG.maxCheckpoints) {
        result.push({
          id: `checkpoint_${++checkpointCount}`,
          type: 'checkpoint',
          name: `Checkpoint before ${step.name}`,
          description: `Save state before potentially destructive operation`,
          status: 'pending',
          dependencies: step.dependencies,
        });
        
        // Update the step to depend on the checkpoint
        step.dependencies = [`checkpoint_${checkpointCount}`];
      }
      
      result.push(step);
    }

    return result;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let plannerInstance: TaskPlanner | null = null;

export function getTaskPlanner(): TaskPlanner {
  if (!plannerInstance) {
    plannerInstance = new TaskPlanner();
  }
  return plannerInstance;
}

export function resetTaskPlanner(): void {
  plannerInstance = null;
}
