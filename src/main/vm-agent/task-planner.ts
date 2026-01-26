/**
 * Atlas Desktop - Task Planner
 *
 * Uses LLM to break down high-level tasks into executable steps,
 * monitors progress, and adapts plans based on actual outcomes.
 *
 * @module vm-agent/task-planner
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import {
  VMTask,
  TaskPlan,
  PlannedStep,
  StepStatus,
  ScreenState,
  VMAction,
  LearnedBehavior,
  WorldBoxGameState,
} from './types';
import { ScreenUnderstanding, getScreenUnderstanding } from './screen-understanding';
import { BehaviorLearner, getBehaviorLearner } from './behavior-learner';
import { v4 as uuidv4 } from 'uuid';

const logger = createModuleLogger('TaskPlanner');

// =============================================================================
// Constants
// =============================================================================

const MAX_STEPS_PER_PLAN = 50;
const MAX_RETRIES_PER_STEP = 3;
const STEP_TIMEOUT_MS = 30000;

// =============================================================================
// Task Planner Class
// =============================================================================

/**
 * Plans and coordinates task execution in VMs
 */
export class TaskPlanner extends EventEmitter {
  private screenUnderstanding: ScreenUnderstanding;
  private behaviorLearner: BehaviorLearner;
  private currentPlan: TaskPlan | null = null;
  private llmPlanFunction: ((prompt: string) => Promise<string>) | null = null;

  constructor() {
    super();
    this.screenUnderstanding = getScreenUnderstanding();
    this.behaviorLearner = getBehaviorLearner();
  }

  /**
   * Set the LLM function for planning
   */
  setLLMFunction(fn: (prompt: string) => Promise<string>): void {
    this.llmPlanFunction = fn;
  }

  /**
   * Create a plan for a task
   */
  async createPlan(task: VMTask, currentState: ScreenState): Promise<TaskPlan> {
    logger.info('Creating plan for task', { task: task.goal });

    const plan: TaskPlan = {
      id: uuidv4(),
      task,
      steps: [],
      currentStepIndex: 0,
      status: 'planning',
      overallConfidence: 0,
      estimatedDurationMs: 0,
      risks: [],
      createdAt: Date.now(),
    };

    // Check for existing learned behaviors
    const matchingBehavior = this.behaviorLearner.findMatchingBehavior(
      currentState,
      task.goal
    );

    if (matchingBehavior) {
      logger.info('Found matching learned behavior', { behavior: matchingBehavior.id });
      plan.steps = this.behaviorToSteps(matchingBehavior);
    } else {
      // Use LLM to plan steps
      plan.steps = await this.planWithLLM(task, currentState);
    }

    // Add verification steps if needed
    if (task.successCriteria) {
      plan.steps.push(this.createVerificationStep(task.successCriteria));
    }

    plan.status = 'ready';
    this.currentPlan = plan;

    this.emit('plan-created', plan);
    return plan;
  }

  /**
   * Get the next step to execute
   */
  getNextStep(): PlannedStep | null {
    if (!this.currentPlan || this.currentPlan.status !== 'executing') {
      return null;
    }

    if (this.currentPlan.currentStepIndex >= this.currentPlan.steps.length) {
      return null;
    }

    return this.currentPlan.steps[this.currentPlan.currentStepIndex];
  }

  /**
   * Start executing a plan
   */
  startExecution(): PlannedStep | null {
    if (!this.currentPlan) return null;

    this.currentPlan.status = 'executing';
    this.currentPlan.startedAt = Date.now();
    this.currentPlan.currentStepIndex = 0;

    const firstStep = this.currentPlan.steps[0];
    if (firstStep) {
      firstStep.status = 'in_progress';
      firstStep.startedAt = Date.now();
    }

    this.emit('execution-started', this.currentPlan);
    return firstStep;
  }

  /**
   * Mark the current step as complete and get the next one
   */
  async completeCurrentStep(
    success: boolean,
    newState: ScreenState,
    error?: string
  ): Promise<PlannedStep | null> {
    if (!this.currentPlan) return null;

    const currentStep = this.currentPlan.steps[this.currentPlan.currentStepIndex];
    if (!currentStep) return null;

    currentStep.completedAt = Date.now();
    currentStep.actualState = newState;

    if (success) {
      currentStep.status = 'completed';
      this.currentPlan.currentStepIndex++;

      // Check if plan is complete
      if (this.currentPlan.currentStepIndex >= this.currentPlan.steps.length) {
        this.currentPlan.status = 'completed';
        this.currentPlan.completedAt = Date.now();
        this.emit('execution-completed', this.currentPlan);
        return null;
      }

      // Start next step
      const nextStep = this.currentPlan.steps[this.currentPlan.currentStepIndex];
      nextStep.status = 'in_progress';
      nextStep.startedAt = Date.now();

      this.emit('step-completed', currentStep, nextStep);
      return nextStep;
    } else {
      // Handle failure
      currentStep.status = 'failed';
      currentStep.error = error;
      currentStep.retryCount = (currentStep.retryCount || 0) + 1;

      if (currentStep.retryCount < MAX_RETRIES_PER_STEP) {
        // Retry - possibly with adapted actions
        const adaptedStep = await this.adaptStep(currentStep, newState, error);
        this.currentPlan.steps[this.currentPlan.currentStepIndex] = adaptedStep;
        adaptedStep.status = 'in_progress';
        adaptedStep.startedAt = Date.now();

        this.emit('step-retry', currentStep, adaptedStep);
        return adaptedStep;
      } else {
        // Max retries reached - try to replan
        const replanned = await this.replan(newState);
        if (replanned) {
          return this.startExecution();
        }

        this.currentPlan.status = 'failed';
        this.currentPlan.completedAt = Date.now();
        this.emit('execution-failed', this.currentPlan, error);
        return null;
      }
    }
  }

  /**
   * Get the current plan
   */
  getCurrentPlan(): TaskPlan | null {
    return this.currentPlan;
  }

  /**
   * Cancel the current plan
   */
  cancelPlan(): void {
    if (this.currentPlan) {
      this.currentPlan.status = 'cancelled';
      this.emit('execution-cancelled', this.currentPlan);
      this.currentPlan = null;
    }
  }

  /**
   * Plan steps for WorldBox-specific tasks
   */
  async planWorldBoxTask(
    task: string,
    gameState: WorldBoxGameState
  ): Promise<PlannedStep[]> {
    logger.info('Planning WorldBox task', { task, gameState: gameState.currentMode });

    const steps: PlannedStep[] = [];
    const taskLower = task.toLowerCase();

    // Parse common WorldBox tasks
    if (taskLower.includes('create') && taskLower.includes('world')) {
      steps.push(
        this.createStep('click', 'Click New World button', { elementDescription: 'New World button' }),
        this.createStep('wait', 'Wait for world creation screen', { duration: 1000 }),
        this.createStep('click', 'Select world size', { elementDescription: 'world size option' }),
        this.createStep('click', 'Confirm creation', { elementDescription: 'Create button' }),
      );
    } else if (taskLower.includes('spawn') || taskLower.includes('place')) {
      // Extract what to spawn
      const thingsToSpawn = this.parseSpawnTarget(task);
      
      for (const thing of thingsToSpawn) {
        steps.push(
          this.createStep('click', `Select ${thing} from toolbar`, { 
            elementDescription: `${thing} tool or icon` 
          }),
          this.createStep('click', 'Click on map to place', { 
            elementDescription: 'map area',
            repeat: 5 // Place multiple
          }),
        );
      }
    } else if (taskLower.includes('destroy') || taskLower.includes('disaster')) {
      const disaster = this.parseDisasterType(task);
      steps.push(
        this.createStep('click', 'Open disasters menu', { elementDescription: 'disasters tab' }),
        this.createStep('click', `Select ${disaster}`, { elementDescription: disaster }),
        this.createStep('click', 'Apply to map', { elementDescription: 'map area' }),
      );
    } else if (taskLower.includes('speed') || taskLower.includes('time')) {
      const speedChange = taskLower.includes('fast') || taskLower.includes('speed up') ? 'faster' : 'slower';
      steps.push(
        this.createStep('click', `Click ${speedChange} time button`, { 
          elementDescription: `${speedChange} speed button` 
        }),
      );
    } else if (taskLower.includes('save')) {
      steps.push(
        this.createStep('hotkey', 'Open save menu', { keys: ['ctrl', 's'] }),
        this.createStep('wait', 'Wait for save dialog', { duration: 500 }),
        this.createStep('click', 'Confirm save', { elementDescription: 'Save button' }),
      );
    } else {
      // Generic task - use LLM planning
      const llmSteps = await this.planWithLLM(
        { 
          id: uuidv4(), 
          goal: task, 
          description: task,
          context: 'WorldBox', 
          category: 'game',
          priority: 'medium',
          createdAt: Date.now() 
        } as VMTask,
        { 
          timestamp: Date.now(),
          screenshot: '',
          resolution: { width: 1920, height: 1080 },
          elements: [],
          textRegions: [], 
          stateHash: '',
        } as ScreenState
      );
      steps.push(...llmSteps);
    }

    return steps;
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Convert a learned behavior to planned steps
   */
  private behaviorToSteps(behavior: LearnedBehavior): PlannedStep[] {
    return behavior.actionSequence.map((action, index) => ({
      stepNumber: index,
      description: `Step ${index + 1}: ${this.actionToDescription(action)}`,
      expectedActionType: action.type,
      successCriteria: 'Step completed',
      confidence: behavior.confidence,
      dependsOn: index > 0 ? [index - 1] : [],
      action,
      status: 'pending' as StepStatus,
    }));
  }

  /**
   * Plan steps using LLM
   */
  private async planWithLLM(task: VMTask, currentState: ScreenState): Promise<PlannedStep[]> {
    if (!this.llmPlanFunction) {
      logger.warn('No LLM function set, using heuristic planning');
      return this.heuristicPlan(task, currentState);
    }

    const prompt = this.buildPlanningPrompt(task, currentState);
    
    try {
      const response = await this.llmPlanFunction(prompt);
      return this.parseLLMPlan(response);
    } catch (error) {
      logger.error('LLM planning failed, falling back to heuristics', { error });
      return this.heuristicPlan(task, currentState);
    }
  }

  /**
   * Build the prompt for LLM planning
   */
  private buildPlanningPrompt(task: VMTask, currentState: ScreenState): string {
    const stateDescription = this.describeState(currentState);

    return `You are an AI assistant helping to plan computer tasks. Given the current screen state and a task, break it down into specific mouse/keyboard actions.

CURRENT SCREEN STATE:
${stateDescription}

TASK: ${task.goal}

CONTEXT: ${task.context || 'General computer use'}

Respond with a JSON array of steps. Each step should have:
- description: What this step does (string)
- action: One of: click, doubleClick, rightClick, type, keyPress, hotkey, scroll, wait, drag
- target: What to interact with (string describing the UI element)
- value: For type actions, the text to type. For hotkey, array of keys.

Example:
[
  {"description": "Click the File menu", "action": "click", "target": "File menu"},
  {"description": "Type the filename", "action": "type", "target": "filename input", "value": "document.txt"},
  {"description": "Press Enter to confirm", "action": "keyPress", "target": null, "value": "Enter"}
]

Respond ONLY with the JSON array, no other text.`;
  }

  /**
   * Parse LLM response into planned steps
   */
  private parseLLMPlan(response: string): PlannedStep[] {
    try {
      // Extract JSON from response
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        logger.warn('No JSON array found in LLM response');
        return [];
      }

      const parsed = JSON.parse(jsonMatch[0]) as Array<{
        description: string;
        action: string;
        target?: string;
        value?: string | string[];
      }>;

      return parsed.slice(0, MAX_STEPS_PER_PLAN).map((step, index) => {
        const action = this.parseStepAction(step);
        const plannedStep: PlannedStep = {
          stepNumber: index + 1,
          description: step.description,
          expectedActionType: action.type,
          action,
          targetElement: step.target,
          successCriteria: `Complete: ${step.description}`,
          confidence: 0.7,
          dependsOn: index > 0 ? [index] : [],
          status: 'pending' as StepStatus,
        };
        return plannedStep;
      });
    } catch (error) {
      logger.error('Failed to parse LLM plan', { error, response: response.slice(0, 200) });
      return [];
    }
  }

  /**
   * Parse a step into a VMAction
   */
  private parseStepAction(step: {
    action: string;
    target?: string;
    value?: string | string[];
  }): VMAction {
    switch (step.action) {
      case 'click':
        return { type: 'click', x: 0, y: 0, button: 'left' };
      case 'doubleClick':
        return { type: 'doubleClick', x: 0, y: 0 };
      case 'rightClick':
        return { type: 'rightClick', x: 0, y: 0 };
      case 'type':
        return { type: 'type', text: String(step.value || '') };
      case 'keyPress':
        return { type: 'keyPress', key: String(step.value || 'Enter') };
      case 'hotkey':
        return { 
          type: 'hotkey', 
          keys: Array.isArray(step.value) ? step.value : [String(step.value || '')] 
        };
      case 'scroll':
        return { type: 'scroll', x: 0, y: 0, deltaX: 0, deltaY: -100 };
      case 'wait':
        return { type: 'wait', ms: 1000 };
      default:
        return { type: 'wait', ms: 500 };
    }
  }

  /**
   * Heuristic planning when LLM is unavailable
   */
  private heuristicPlan(task: VMTask, currentState: ScreenState): PlannedStep[] {
    const steps: PlannedStep[] = [];
    const taskLower = task.goal.toLowerCase();

    // Simple keyword-based planning
    if (taskLower.includes('open')) {
      const app = this.extractAppName(task.goal);
      steps.push(
        this.createStep('hotkey', 'Open start menu', { keys: ['win'] }),
        this.createStep('wait', 'Wait for start menu', { ms: 500 }),
        this.createStep('type', `Type "${app}"`, { text: app }),
        this.createStep('wait', 'Wait for search', { ms: 1000 }),
        this.createStep('keyPress', 'Press Enter', { key: 'Enter' }),
      );
    } else if (taskLower.includes('type') || taskLower.includes('write')) {
      const text = this.extractTextToType(task.goal);
      steps.push(
        this.createStep('type', `Type: ${text}`, { text }),
      );
    } else if (taskLower.includes('click')) {
      const target = this.extractClickTarget(task.goal);
      steps.push(
        this.createStep('click', `Click ${target}`, { x: 0, y: 0, button: 'left' }, target),
      );
    } else if (taskLower.includes('close')) {
      steps.push(
        this.createStep('hotkey', 'Close window', { keys: ['alt', 'F4'] }),
      );
    } else {
      // Generic - just try to interact with visible elements
      const interactiveElements = currentState.elements.filter(e => e.isInteractive);
      for (const element of interactiveElements.slice(0, 3)) {
        if (element.text && element.text.toLowerCase().includes(taskLower.split(' ')[0])) {
          steps.push(
            this.createStep('click', `Click ${element.text}`, { 
              x: element.bounds.x + element.bounds.width / 2,
              y: element.bounds.y + element.bounds.height / 2,
            }),
          );
          break;
        }
      }
    }

    // Add a verification step
    steps.push(
      this.createStep('wait', 'Wait for action to complete', { ms: 1000 }),
    );

    return steps;
  }

  /**
   * Create a planned step
   */
  private createStep(
    type: VMAction['type'],
    description: string,
    params: Record<string, unknown> & { repeat?: number },
    targetElement?: string
  ): PlannedStep {
    let action: VMAction;
    
    // Build the appropriate action based on type
    switch (type) {
      case 'click':
        action = { 
          type: 'click', 
          x: params.x as number || 0, 
          y: params.y as number || 0,
          button: params.button as 'left' | 'right' | 'middle' || 'left'
        };
        break;
      case 'type':
        action = { type: 'type', text: params.text as string || '' };
        break;
      case 'hotkey':
        action = { type: 'hotkey', keys: params.keys as string[] || [] };
        break;
      case 'wait':
        action = { type: 'wait', ms: params.duration as number || params.ms as number || 1000 };
        break;
      case 'scroll':
        action = { 
          type: 'scroll', 
          x: params.x as number || 0, 
          y: params.y as number || 0,
          deltaX: params.deltaX as number || 0,
          deltaY: params.deltaY as number || -100
        };
        break;
      case 'keyPress':
        action = { 
          type: 'keyPress', 
          key: params.key as string || '', 
          modifiers: params.modifiers as string[]
        };
        break;
      default:
        action = { type: 'wait', ms: 1000 };
    }

    return {
      stepNumber: 0, // Will be set when added to plan
      description,
      expectedActionType: type,
      targetElement: targetElement || params.elementDescription as string,
      successCriteria: 'Step completed',
      confidence: 0.8,
      dependsOn: [],
      action,
      status: 'pending',
    };
  }

  /**
   * Create a verification step
   */
  private createVerificationStep(criteria: string): PlannedStep {
    return {
      stepNumber: 0,
      description: `Verify: ${criteria}`,
      expectedActionType: 'wait',
      successCriteria: criteria,
      confidence: 0.9,
      dependsOn: [],
      action: { type: 'wait', ms: 500 },
      status: 'pending',
    };
  }

  /**
   * Adapt a failed step based on error and current state
   */
  private async adaptStep(
    step: PlannedStep,
    currentState: ScreenState,
    error?: string
  ): Promise<PlannedStep> {
    // If element wasn't found, try to find it with relaxed matching
    if (error?.includes('not found') && step.targetElement) {
      const element = await this.screenUnderstanding.findElement(
        currentState,
        step.targetElement
      );

      if (element && (step.action.type === 'click' || step.action.type === 'doubleClick' || step.action.type === 'rightClick')) {
        const centerX = element.bounds.x + element.bounds.width / 2;
        const centerY = element.bounds.y + element.bounds.height / 2;
        
        let newAction: VMAction;
        if (step.action.type === 'click') {
          newAction = { type: 'click', x: centerX, y: centerY, button: 'left' };
        } else if (step.action.type === 'doubleClick') {
          newAction = { type: 'doubleClick', x: centerX, y: centerY };
        } else {
          newAction = { type: 'rightClick', x: centerX, y: centerY };
        }
        
        return {
          ...step,
          action: newAction,
        };
      }
    }

    // Try clicking in the general area
    if (step.action.type === 'click' && step.action.x === 0) {
      // Click in center of screen as fallback
      return {
        ...step,
        action: {
          type: 'click',
          x: 960, // Assuming 1920 width
          y: 540, // Assuming 1080 height
          button: 'left',
        },
      };
    }

    return step;
  }

  /**
   * Try to replan after a failure
   */
  private async replan(currentState: ScreenState): Promise<boolean> {
    if (!this.currentPlan) return false;

    // Get remaining task from original plan
    const remainingDescription = this.currentPlan.steps
      .slice(this.currentPlan.currentStepIndex)
      .map(s => s.description)
      .join(', ');

    const newTask: VMTask = {
      id: uuidv4(),
      goal: `Continue: ${remainingDescription}`,
      description: `Continue: ${remainingDescription}`,
      context: this.currentPlan.task.context,
      category: this.currentPlan.task.category,
      priority: this.currentPlan.task.priority,
      createdAt: Date.now(),
    };

    try {
      const newPlan = await this.createPlan(newTask, currentState);
      // Replace current plan with the new one
      this.currentPlan = newPlan;
      return true;
    } catch (error) {
      logger.error('Replanning failed', { error });
      return false;
    }
  }

  /**
   * Describe the current screen state for LLM
   */
  private describeState(state: ScreenState): string {
    const parts: string[] = [];

    if (state.activeWindow) {
      parts.push(`Active window: ${state.activeWindow.title} (${state.activeWindow.application})`);
    }

    if (state.textRegions.length > 0) {
      parts.push('Visible text:');
      for (const region of state.textRegions.slice(0, 10)) {
        parts.push(`  - "${region.text}"`);
      }
    }

    const interactiveElements = state.elements.filter(e => e.isInteractive);
    if (interactiveElements.length > 0) {
      parts.push('Interactive elements:');
      for (const element of interactiveElements.slice(0, 10)) {
        parts.push(`  - ${element.type}: "${element.text || element.ariaLabel || 'unlabeled'}"`);
      }
    }

    return parts.join('\n');
  }

  /**
   * Convert an action to a human-readable description
   */
  private actionToDescription(action: VMAction): string {
    switch (action.type) {
      case 'click':
        return `Click at (${action.x}, ${action.y})`;
      case 'doubleClick':
        return `Double-click at (${action.x}, ${action.y})`;
      case 'rightClick':
        return `Right-click at (${action.x}, ${action.y})`;
      case 'type':
        return `Type "${action.text}"`;
      case 'keyPress':
        return `Press ${action.key}`;
      case 'hotkey':
        return `Press ${action.keys.join('+')}`;
      case 'scroll':
        return `Scroll ${action.deltaY < 0 ? 'up' : 'down'}`;
      case 'wait':
        return `Wait ${action.ms}ms`;
      case 'drag':
        return `Drag from (${action.fromX}, ${action.fromY}) to (${action.toX}, ${action.toY})`;
      default:
        return 'Unknown action';
    }
  }

  // Helper extraction methods
  private extractAppName(description: string): string {
    const match = description.match(/open\s+(\w+)/i);
    return match ? match[1] : '';
  }

  private extractTextToType(description: string): string {
    const match = description.match(/(?:type|write)\s+"?([^"]+)"?/i);
    return match ? match[1] : '';
  }

  private extractClickTarget(description: string): string {
    const match = description.match(/click\s+(?:on\s+)?(?:the\s+)?(.+)/i);
    return match ? match[1] : 'button';
  }

  private parseSpawnTarget(task: string): string[] {
    const targets: string[] = [];
    const words = task.toLowerCase().split(/\s+/);
    
    const spawnables = ['humans', 'elves', 'orcs', 'dwarves', 'animals', 'trees', 'mountains', 'water'];
    for (const word of words) {
      for (const spawnable of spawnables) {
        if (word.includes(spawnable.slice(0, -1))) { // Match singular or plural
          targets.push(spawnable);
        }
      }
    }
    
    return targets.length > 0 ? targets : ['humans'];
  }

  private parseDisasterType(task: string): string {
    const disasters = ['meteor', 'lightning', 'earthquake', 'tornado', 'fire', 'plague', 'acid rain'];
    const taskLower = task.toLowerCase();
    
    for (const disaster of disasters) {
      if (taskLower.includes(disaster)) {
        return disaster;
      }
    }
    
    return 'lightning';
  }
}

// =============================================================================
// Singleton & Exports
// =============================================================================

let plannerInstance: TaskPlanner | null = null;

/**
 * Get the task planner singleton
 */
export function getTaskPlanner(): TaskPlanner {
  if (!plannerInstance) {
    plannerInstance = new TaskPlanner();
  }
  return plannerInstance;
}

export default TaskPlanner;
