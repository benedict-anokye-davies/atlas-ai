/**
 * Atlas Desktop - VM Agent Few-Shot Learner
 *
 * Learns from demonstrations and examples to perform new tasks.
 * Implements few-shot learning for rapid task acquisition.
 *
 * @module vm-agent/learning/few-shot-learner
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { createModuleLogger } from '../../utils/logger';
import { getEventBus, createEvent } from '../core/event-bus';
import { VMAction, ScreenState, Demonstration } from '../types';
import { EnhancedUIElement, TaskPlan, PlannedStep } from '../core/types';
import { ScreenUnderstanding } from '../vision/enhanced-screen';

const logger = createModuleLogger('FewShotLearner');

// =============================================================================
// Few-Shot Learning Constants
// =============================================================================

export const FEW_SHOT_CONSTANTS = {
  /** Minimum demonstrations for learning */
  MIN_DEMONSTRATIONS: 1,
  /** Optimal demonstrations for good learning */
  OPTIMAL_DEMONSTRATIONS: 3,
  /** Maximum demonstrations to store per task */
  MAX_DEMONSTRATIONS_PER_TASK: 10,
  /** Similarity threshold for matching */
  SIMILARITY_THRESHOLD: 0.6,
  /** Storage file name */
  STORAGE_FILE: 'vm-few-shot-learner.json',
} as const;

// =============================================================================
// Few-Shot Types
// =============================================================================

export interface TaskTemplate {
  /** Template ID */
  id: string;
  /** Task name */
  name: string;
  /** Task description */
  description: string;
  /** Required parameters */
  parameters: TaskParameter[];
  /** Learned from demonstrations */
  demonstrations: StoredDemonstration[];
  /** Abstracted action sequence */
  actionTemplate: ActionTemplate[];
  /** Success rate */
  successRate: number;
  /** Times executed */
  executionCount: number;
  /** Application context */
  applicationContext?: string;
  /** Screen context */
  screenContext?: string;
  /** Created at */
  createdAt: number;
  /** Last used */
  lastUsed: number;
}

export interface TaskParameter {
  /** Parameter name */
  name: string;
  /** Parameter type */
  type: 'text' | 'number' | 'element' | 'file' | 'boolean';
  /** Description */
  description: string;
  /** Is required */
  required: boolean;
  /** Default value */
  defaultValue?: string | number | boolean;
  /** Example values */
  examples: Array<string | number | boolean>;
}

export interface ActionTemplate {
  /** Action type */
  type: VMAction['type'];
  /** Target description (natural language) */
  targetDescription?: string;
  /** Parameter reference (e.g., "$username") */
  parameterRef?: string;
  /** Relative position from previous element */
  relativePosition?: {
    direction: 'above' | 'below' | 'left' | 'right' | 'same';
    distance?: 'close' | 'medium' | 'far';
  };
  /** Element characteristics */
  elementCharacteristics?: {
    type?: string;
    textContains?: string;
    role?: string;
  };
  /** Fixed values */
  fixedValues?: Partial<VMAction>;
  /** Wait before action */
  waitBefore?: number;
  /** Confidence in this template step */
  confidence: number;
}

export interface StoredDemonstration {
  /** Demonstration ID */
  id: string;
  /** Original demonstration */
  demonstration: Demonstration;
  /** Extracted parameters */
  extractedParams: Record<string, string | number>;
  /** Abstraction quality */
  abstractionQuality: number;
  /** Timestamp */
  timestamp: number;
}

export interface LearningResult {
  /** Was learning successful */
  success: boolean;
  /** Created or updated template */
  template?: TaskTemplate;
  /** Learning quality score */
  quality: number;
  /** Suggestions for improvement */
  suggestions: string[];
  /** Detected parameters */
  detectedParameters: TaskParameter[];
}

export interface ExecutionContext {
  /** Parameter values */
  parameters: Record<string, string | number | boolean>;
  /** Current screen understanding */
  understanding: ScreenUnderstanding;
  /** Previous actions in this execution */
  previousActions: VMAction[];
}

// =============================================================================
// Few-Shot Learner
// =============================================================================

/**
 * Learns tasks from demonstrations and executes them
 *
 * @example
 * ```typescript
 * const learner = getFewShotLearner();
 *
 * // Record a demonstration
 * learner.recordDemonstration('Login to email', demonstration);
 *
 * // Learn from demonstrations
 * const result = await learner.learn('Login to email');
 *
 * // Execute learned task
 * const plan = await learner.execute('Login to email', {
 *   parameters: { username: 'test@example.com', password: '***' },
 *   understanding: currentState
 * });
 * ```
 */
export class FewShotLearner extends EventEmitter {
  private templates: Map<string, TaskTemplate> = new Map();
  private pendingDemonstrations: Map<string, Demonstration[]> = new Map();
  private dataDir: string;
  private initialized: boolean = false;

  constructor() {
    super();
    this.dataDir = path.join(app.getPath('userData'), 'vm-agent');
  }

  /**
   * Initialize the learner
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      if (!fs.existsSync(this.dataDir)) {
        fs.mkdirSync(this.dataDir, { recursive: true });
      }

      await this.loadFromDisk();
      this.initialized = true;
      logger.info('Few-shot learner initialized', { templates: this.templates.size });
    } catch (error) {
      logger.error('Failed to initialize few-shot learner', { error });
      this.initialized = true;
    }
  }

  /**
   * Record a demonstration for a task
   */
  recordDemonstration(taskName: string, demonstration: Demonstration): void {
    const normalizedName = this.normalizeTaskName(taskName);

    if (!this.pendingDemonstrations.has(normalizedName)) {
      this.pendingDemonstrations.set(normalizedName, []);
    }

    this.pendingDemonstrations.get(normalizedName)!.push(demonstration);

    const eventBus = getEventBus();
    eventBus.emitSync(
      createEvent(
        'learning:demonstration-recorded',
        { task: normalizedName, count: this.pendingDemonstrations.get(normalizedName)!.length },
        'few-shot-learner',
        { priority: 'normal' },
      ),
    );

    logger.info('Demonstration recorded', {
      task: normalizedName,
      actions: demonstration.actions.length,
    });
  }

  /**
   * Learn from recorded demonstrations
   */
  async learn(taskName: string): Promise<LearningResult> {
    await this.ensureInitialized();

    const normalizedName = this.normalizeTaskName(taskName);
    const demonstrations = this.pendingDemonstrations.get(normalizedName) || [];

    if (demonstrations.length < FEW_SHOT_CONSTANTS.MIN_DEMONSTRATIONS) {
      return {
        success: false,
        quality: 0,
        suggestions: [`Need at least ${FEW_SHOT_CONSTANTS.MIN_DEMONSTRATIONS} demonstration(s). Current: ${demonstrations.length}`],
        detectedParameters: [],
      };
    }

    const eventBus = getEventBus();
    eventBus.emitSync(
      createEvent(
        'learning:started',
        { task: normalizedName, demonstrations: demonstrations.length },
        'few-shot-learner',
        { priority: 'normal' },
      ),
    );

    // Extract common patterns
    const actionTemplate = this.extractActionTemplate(demonstrations);
    const detectedParameters = this.detectParameters(demonstrations);
    const quality = this.calculateLearningQuality(demonstrations, actionTemplate);

    // Store demonstrations
    const storedDemos: StoredDemonstration[] = demonstrations.map((demo) => ({
      id: `demo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      demonstration: demo,
      extractedParams: this.extractParameterValues(demo, detectedParameters),
      abstractionQuality: quality,
      timestamp: Date.now(),
    }));

    // Create or update template
    const existingTemplate = this.templates.get(normalizedName);

    const template: TaskTemplate = {
      id: existingTemplate?.id || `template-${Date.now()}`,
      name: normalizedName,
      description: taskName,
      parameters: detectedParameters,
      demonstrations: [
        ...(existingTemplate?.demonstrations || []).slice(-5),
        ...storedDemos,
      ].slice(-FEW_SHOT_CONSTANTS.MAX_DEMONSTRATIONS_PER_TASK),
      actionTemplate,
      successRate: existingTemplate?.successRate || 0,
      executionCount: existingTemplate?.executionCount || 0,
      applicationContext: demonstrations[0]?.context?.application,
      screenContext: demonstrations[0]?.context?.screen,
      createdAt: existingTemplate?.createdAt || Date.now(),
      lastUsed: Date.now(),
    };

    this.templates.set(normalizedName, template);
    this.pendingDemonstrations.delete(normalizedName);

    this.scheduleSave();

    const suggestions: string[] = [];
    if (quality < 0.5) {
      suggestions.push('Learning quality is low. Consider providing more diverse demonstrations.');
    }
    if (demonstrations.length < FEW_SHOT_CONSTANTS.OPTIMAL_DEMONSTRATIONS) {
      suggestions.push(`For better results, provide ${FEW_SHOT_CONSTANTS.OPTIMAL_DEMONSTRATIONS} demonstrations.`);
    }
    if (detectedParameters.length === 0) {
      suggestions.push('No parameters detected. If the task has variable inputs, demonstrate with different values.');
    }

    eventBus.emitSync(
      createEvent(
        'learning:completed',
        { task: normalizedName, quality, parameters: detectedParameters.length },
        'few-shot-learner',
        { priority: 'normal' },
      ),
    );

    return {
      success: true,
      template,
      quality,
      suggestions,
      detectedParameters,
    };
  }

  /**
   * Execute a learned task
   */
  async execute(taskName: string, context: ExecutionContext): Promise<TaskPlan> {
    await this.ensureInitialized();

    const normalizedName = this.normalizeTaskName(taskName);
    const template = this.templates.get(normalizedName);

    if (!template) {
      // Try to find similar task
      const similar = this.findSimilarTask(taskName);
      if (similar) {
        logger.info(`Task "${taskName}" not found, using similar: "${similar.name}"`);
        return this.executeTemplate(similar, context);
      }

      throw new Error(`No learned template for task: ${taskName}`);
    }

    return this.executeTemplate(template, context);
  }

  /**
   * Check if a task has been learned
   */
  hasLearned(taskName: string): boolean {
    return this.templates.has(this.normalizeTaskName(taskName));
  }

  /**
   * Get all learned tasks
   */
  getLearnedTasks(): Array<{
    name: string;
    parameters: TaskParameter[];
    successRate: number;
    executionCount: number;
  }> {
    return Array.from(this.templates.values()).map((t) => ({
      name: t.name,
      parameters: t.parameters,
      successRate: t.successRate,
      executionCount: t.executionCount,
    }));
  }

  /**
   * Get template details
   */
  getTemplate(taskName: string): TaskTemplate | undefined {
    return this.templates.get(this.normalizeTaskName(taskName));
  }

  /**
   * Record execution result for learning
   */
  recordExecutionResult(taskName: string, success: boolean): void {
    const template = this.templates.get(this.normalizeTaskName(taskName));
    if (template) {
      template.executionCount++;
      template.successRate =
        (template.successRate * (template.executionCount - 1) + (success ? 1 : 0)) /
        template.executionCount;
      template.lastUsed = Date.now();
      this.scheduleSave();
    }
  }

  /**
   * Delete a learned task
   */
  deleteTask(taskName: string): boolean {
    const deleted = this.templates.delete(this.normalizeTaskName(taskName));
    if (deleted) {
      this.scheduleSave();
    }
    return deleted;
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalTemplates: number;
    totalDemonstrations: number;
    avgSuccessRate: number;
    topTasks: Array<{ name: string; executionCount: number }>;
  } {
    const templates = Array.from(this.templates.values());
    const totalDemos = templates.reduce((sum, t) => sum + t.demonstrations.length, 0);
    const avgSuccess =
      templates.length > 0
        ? templates.reduce((sum, t) => sum + t.successRate, 0) / templates.length
        : 0;

    const topTasks = templates
      .sort((a, b) => b.executionCount - a.executionCount)
      .slice(0, 5)
      .map((t) => ({ name: t.name, executionCount: t.executionCount }));

    return {
      totalTemplates: templates.length,
      totalDemonstrations: totalDemos,
      avgSuccessRate: avgSuccess,
      topTasks,
    };
  }

  /**
   * Clear all learned data
   */
  clear(): void {
    this.templates.clear();
    this.pendingDemonstrations.clear();
    this.scheduleSave();
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  private normalizeTaskName(name: string): string {
    return name.toLowerCase().trim().replace(/\s+/g, '-');
  }

  private extractActionTemplate(demonstrations: Demonstration[]): ActionTemplate[] {
    if (demonstrations.length === 0) return [];

    // Use first demonstration as base
    const baseDemo = demonstrations[0];
    const templates: ActionTemplate[] = [];

    for (let i = 0; i < baseDemo.actions.length; i++) {
      const action = baseDemo.actions[i];
      const screenshot = baseDemo.screenshots?.[i];

      // Check if this action is consistent across demonstrations
      const consistency = this.checkActionConsistency(demonstrations, i);

      const template: ActionTemplate = {
        type: action.type,
        confidence: consistency,
      };

      // Extract target description from screenshots/context
      if (screenshot && (action.type === 'click' || action.type === 'type')) {
        template.targetDescription = this.inferTargetDescription(action, screenshot);
      }

      // Check for parameter patterns
      if (action.type === 'type' && action.text) {
        const isVariable = this.isVariableValue(demonstrations, i);
        if (isVariable) {
          template.parameterRef = `$param${templates.filter((t) => t.parameterRef).length + 1}`;
        } else {
          template.fixedValues = { type: 'type', text: action.text };
        }
      }

      // Detect element characteristics
      if (action.type === 'click' || action.type === 'doubleClick') {
        template.elementCharacteristics = this.inferElementCharacteristics(demonstrations, i);
      }

      templates.push(template);
    }

    return templates;
  }

  private checkActionConsistency(demonstrations: Demonstration[], actionIndex: number): number {
    if (demonstrations.length === 1) return 0.7;

    let matches = 0;
    const baseAction = demonstrations[0].actions[actionIndex];
    if (!baseAction) return 0;

    for (let i = 1; i < demonstrations.length; i++) {
      const action = demonstrations[i].actions[actionIndex];
      if (action && action.type === baseAction.type) {
        matches++;
      }
    }

    return matches / (demonstrations.length - 1);
  }

  private inferTargetDescription(action: VMAction, _screenshot: Buffer): string {
    // In a real implementation, this would use vision to analyze the screenshot
    // For now, use action coordinates to infer
    if ('x' in action && 'y' in action) {
      return `Element at approximately (${action.x}, ${action.y})`;
    }
    return 'Target element';
  }

  private isVariableValue(demonstrations: Demonstration[], actionIndex: number): boolean {
    if (demonstrations.length < 2) return false;

    const values = new Set<string>();
    for (const demo of demonstrations) {
      const action = demo.actions[actionIndex];
      if (action && action.type === 'type' && action.text) {
        values.add(action.text);
      }
    }

    return values.size > 1;
  }

  private inferElementCharacteristics(
    demonstrations: Demonstration[],
    _actionIndex: number,
  ): ActionTemplate['elementCharacteristics'] {
    // This would ideally analyze screenshots to find common element characteristics
    // For now, return basic characteristics
    return {
      type: 'interactive',
    };
  }

  private detectParameters(demonstrations: Demonstration[]): TaskParameter[] {
    const parameters: TaskParameter[] = [];
    const variableActions = new Map<number, Set<string>>();

    // Find actions with variable values
    for (let i = 0; i < demonstrations[0].actions.length; i++) {
      const values = new Set<string>();

      for (const demo of demonstrations) {
        const action = demo.actions[i];
        if (action && action.type === 'type' && action.text) {
          values.add(action.text);
        }
      }

      if (values.size > 1) {
        variableActions.set(i, values);
      }
    }

    // Create parameters for variable actions
    let paramIndex = 1;
    for (const [_actionIdx, values] of variableActions) {
      const examples = Array.from(values);
      const isNumeric = examples.every((v) => !isNaN(Number(v)));

      parameters.push({
        name: `param${paramIndex}`,
        type: isNumeric ? 'number' : 'text',
        description: `Parameter ${paramIndex} - variable input`,
        required: true,
        examples: isNumeric ? examples.map(Number) : examples,
      });

      paramIndex++;
    }

    return parameters;
  }

  private extractParameterValues(
    demonstration: Demonstration,
    parameters: TaskParameter[],
  ): Record<string, string | number> {
    const values: Record<string, string | number> = {};

    let paramIndex = 0;
    for (const action of demonstration.actions) {
      if (action.type === 'type' && action.text) {
        if (paramIndex < parameters.length) {
          const param = parameters[paramIndex];
          values[param.name] = param.type === 'number' ? Number(action.text) : action.text;
          paramIndex++;
        }
      }
    }

    return values;
  }

  private calculateLearningQuality(
    demonstrations: Demonstration[],
    actionTemplate: ActionTemplate[],
  ): number {
    let quality = 0.5;

    // More demonstrations = higher quality
    const demoBonus = Math.min(0.2, demonstrations.length * 0.05);
    quality += demoBonus;

    // Consistent actions = higher quality
    const avgConfidence =
      actionTemplate.length > 0
        ? actionTemplate.reduce((sum, t) => sum + t.confidence, 0) / actionTemplate.length
        : 0;
    quality += avgConfidence * 0.3;

    return Math.min(1, quality);
  }

  private async executeTemplate(
    template: TaskTemplate,
    context: ExecutionContext,
  ): Promise<TaskPlan> {
    const steps: PlannedStep[] = [];

    for (let i = 0; i < template.actionTemplate.length; i++) {
      const actionTemp = template.actionTemplate[i];
      const action = this.instantiateAction(actionTemp, context);

      if (action) {
        steps.push({
          id: `step-${i + 1}`,
          action,
          description: actionTemp.targetDescription || this.describeAction(action),
          expectedOutcome: `Complete step ${i + 1}`,
          estimatedDuration: this.estimateActionDuration(action),
          confidence: actionTemp.confidence,
          dependencies: i > 0 ? [`step-${i}`] : [],
        });
      }
    }

    return {
      id: `plan-${Date.now()}`,
      goal: template.description,
      steps,
      totalEstimatedDuration: steps.reduce((sum, s) => sum + s.estimatedDuration, 0),
      confidence: template.actionTemplate.length > 0
        ? template.actionTemplate.reduce((sum, t) => sum + t.confidence, 0) / template.actionTemplate.length
        : 0.5,
      createdAt: Date.now(),
      context: {
        application: template.applicationContext,
        screen: template.screenContext,
      },
    };
  }

  private instantiateAction(
    template: ActionTemplate,
    context: ExecutionContext,
  ): VMAction | null {
    // If there are fixed values, use them
    if (template.fixedValues) {
      return template.fixedValues as VMAction;
    }

    // Handle parameter substitution
    if (template.parameterRef && template.type === 'type') {
      const paramName = template.parameterRef.replace('$', '');
      const value = context.parameters[paramName];
      if (value !== undefined) {
        return { type: 'type', text: String(value) };
      }
    }

    // Handle element targeting
    if (template.elementCharacteristics && context.understanding) {
      const element = this.findMatchingElement(
        template.elementCharacteristics,
        context.understanding,
      );

      if (element) {
        const x = element.bounds.x + element.bounds.width / 2;
        const y = element.bounds.y + element.bounds.height / 2;

        switch (template.type) {
          case 'click':
            return { type: 'click', x, y };
          case 'doubleClick':
            return { type: 'doubleClick', x, y };
        }
      }
    }

    // Fallback for simple actions
    switch (template.type) {
      case 'keyPress':
        return { type: 'keyPress', key: 'Enter' };
      case 'wait':
        return { type: 'wait', ms: 1000 };
      case 'scroll':
        return {
          type: 'scroll',
          x: context.understanding.screenState.dimensions.width / 2,
          y: context.understanding.screenState.dimensions.height / 2,
          deltaX: 0,
          deltaY: 200,
        };
    }

    return null;
  }

  private findMatchingElement(
    characteristics: ActionTemplate['elementCharacteristics'],
    understanding: ScreenUnderstanding,
  ): EnhancedUIElement | undefined {
    if (!characteristics) return undefined;

    return understanding.enhancedElements.find((el) => {
      if (characteristics.type && el.type !== characteristics.type) {
        return false;
      }
      if (characteristics.textContains && !el.text?.includes(characteristics.textContains)) {
        return false;
      }
      if (characteristics.role && el.semanticRole !== characteristics.role) {
        return false;
      }
      return true;
    });
  }

  private findSimilarTask(taskName: string): TaskTemplate | undefined {
    const nameLower = taskName.toLowerCase();
    let bestMatch: TaskTemplate | undefined;
    let bestScore = 0;

    for (const template of this.templates.values()) {
      const score = this.calculateSimilarity(nameLower, template.name.toLowerCase());
      if (score > bestScore && score >= FEW_SHOT_CONSTANTS.SIMILARITY_THRESHOLD) {
        bestScore = score;
        bestMatch = template;
      }
    }

    return bestMatch;
  }

  private calculateSimilarity(a: string, b: string): number {
    if (a === b) return 1;
    if (a.includes(b) || b.includes(a)) return 0.8;

    // Word overlap
    const wordsA = new Set(a.split(/\s+/));
    const wordsB = new Set(b.split(/\s+/));
    const intersection = [...wordsA].filter((w) => wordsB.has(w));
    const union = new Set([...wordsA, ...wordsB]);

    return intersection.length / union.size;
  }

  private describeAction(action: VMAction): string {
    switch (action.type) {
      case 'click':
        return `Click at (${action.x}, ${action.y})`;
      case 'doubleClick':
        return `Double-click at (${action.x}, ${action.y})`;
      case 'type':
        return `Type "${action.text?.slice(0, 20)}${action.text && action.text.length > 20 ? '...' : ''}"`;
      case 'keyPress':
        return `Press ${action.key}`;
      case 'hotkey':
        return `Press ${action.keys.join('+')}`;
      case 'scroll':
        return `Scroll ${action.deltaY > 0 ? 'down' : 'up'}`;
      case 'wait':
        return `Wait ${action.ms}ms`;
      default:
        return action.type;
    }
  }

  private estimateActionDuration(action: VMAction): number {
    switch (action.type) {
      case 'click':
      case 'doubleClick':
        return 500;
      case 'type':
        return (action.text?.length || 0) * 50 + 500;
      case 'keyPress':
      case 'hotkey':
        return 300;
      case 'scroll':
        return 500;
      case 'wait':
        return action.ms;
      case 'drag':
        return 1000;
      default:
        return 500;
    }
  }

  private saveTimeout: NodeJS.Timeout | null = null;
  private scheduleSave(): void {
    if (this.saveTimeout) return;
    this.saveTimeout = setTimeout(() => {
      this.saveToDisk().catch((e) => logger.error('Failed to save few-shot data', { error: e }));
      this.saveTimeout = null;
    }, 5000);
  }

  private async saveToDisk(): Promise<void> {
    const filePath = path.join(this.dataDir, FEW_SHOT_CONSTANTS.STORAGE_FILE);

    const data = {
      templates: Array.from(this.templates.entries()),
    };

    await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2));
    logger.debug('Few-shot learner data saved', { templates: this.templates.size });
  }

  private async loadFromDisk(): Promise<void> {
    const filePath = path.join(this.dataDir, FEW_SHOT_CONSTANTS.STORAGE_FILE);

    if (!fs.existsSync(filePath)) return;

    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const data = JSON.parse(content);

      this.templates = new Map(data.templates || []);
    } catch (error) {
      logger.warn('Failed to load few-shot data', { error });
    }
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let fewShotInstance: FewShotLearner | null = null;

/**
 * Get the singleton few-shot learner
 */
export function getFewShotLearner(): FewShotLearner {
  if (!fewShotInstance) {
    fewShotInstance = new FewShotLearner();
  }
  return fewShotInstance;
}

/**
 * Reset few-shot learner (for testing)
 */
export function resetFewShotLearner(): void {
  if (fewShotInstance) {
    fewShotInstance.clear();
    fewShotInstance = null;
  }
}
