/**
 * Atlas Desktop - Strategy Memory
 *
 * Persistent memory system for successful strategies, patterns,
 * and contextual knowledge learned from VM interactions.
 *
 * @module vm-agent/strategy-memory
 */

import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as path from 'path';
import { app } from 'electron';
import { createModuleLogger } from '../utils/logger';
import {
  ScreenState,
  VMAction,
  LearnedBehavior,
  WorldBoxGameState,
} from './types';
import { v4 as uuidv4 } from 'uuid';

const logger = createModuleLogger('StrategyMemory');

// =============================================================================
// Types
// =============================================================================

/**
 * A remembered strategy for accomplishing a task
 */
export interface Strategy {
  id: string;
  /** What this strategy accomplishes */
  goal: string;
  /** Context/application this works in */
  context: string;
  /** The sequence of actions */
  actions: VMAction[];
  /** When this strategy was learned */
  learnedAt: number;
  /** Number of successful uses */
  successCount: number;
  /** Number of failed uses */
  failureCount: number;
  /** Conditions that must be true for this strategy */
  preconditions: StrategyCondition[];
  /** Expected outcome */
  expectedOutcome: string;
  /** Tags for categorization */
  tags: string[];
  /** Average execution time in ms */
  avgExecutionTime: number;
  /** Source of this strategy */
  source: 'demonstration' | 'exploration' | 'llm' | 'imported';
}

/**
 * A condition that must be met for a strategy to apply
 */
export interface StrategyCondition {
  type: 'text_visible' | 'element_exists' | 'window_title' | 'application' | 'custom';
  value: string;
  required: boolean;
}

/**
 * A pattern recognized across multiple interactions
 */
export interface RecognizedPattern {
  id: string;
  /** Description of the pattern */
  description: string;
  /** Sequence of action types */
  actionSequence: string[];
  /** How often this pattern occurs */
  frequency: number;
  /** Contexts where this pattern appears */
  contexts: string[];
  /** Average success rate when this pattern is used */
  successRate: number;
}

/**
 * Application-specific knowledge
 */
export interface ApplicationKnowledge {
  id: string;
  /** Application name */
  application: string;
  /** Known UI elements and their typical locations */
  knownElements: KnownElement[];
  /** Common workflows in this application */
  workflows: string[];
  /** Keyboard shortcuts */
  shortcuts: Shortcut[];
  /** Last updated */
  updatedAt: number;
}

/**
 * A known UI element in an application
 */
export interface KnownElement {
  description: string;
  typicalLocation: { x: number; y: number; width: number; height: number };
  textPattern?: string;
  confidence: number;
}

/**
 * A keyboard shortcut
 */
export interface Shortcut {
  description: string;
  keys: string[];
  context?: string;
}

/**
 * Query options for strategy retrieval
 */
export interface StrategyQuery {
  goal?: string;
  context?: string;
  tags?: string[];
  minSuccessRate?: number;
  limit?: number;
}

// =============================================================================
// Strategy Memory Class
// =============================================================================

/**
 * Manages persistent strategy memory
 */
export class StrategyMemory extends EventEmitter {
  private strategies: Map<string, Strategy> = new Map();
  private patterns: Map<string, RecognizedPattern> = new Map();
  private appKnowledge: Map<string, ApplicationKnowledge> = new Map();
  private storageDir: string;
  private initialized: boolean = false;

  constructor() {
    super();
    this.storageDir = path.join(app.getPath('userData'), 'vm-agent/memory');
  }

  /**
   * Initialize the memory system
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    await fs.mkdir(this.storageDir, { recursive: true });
    await this.loadAll();
    this.initialized = true;

    logger.info('Strategy memory initialized', {
      strategies: this.strategies.size,
      patterns: this.patterns.size,
      applications: this.appKnowledge.size,
    });
  }

  // ===========================================================================
  // Strategy Management
  // ===========================================================================

  /**
   * Store a new strategy
   */
  async storeStrategy(strategy: Omit<Strategy, 'id' | 'learnedAt'>): Promise<Strategy> {
    const fullStrategy: Strategy = {
      ...strategy,
      id: uuidv4(),
      learnedAt: Date.now(),
    };

    this.strategies.set(fullStrategy.id, fullStrategy);
    await this.saveStrategies();

    logger.info('Stored new strategy', { id: fullStrategy.id, goal: fullStrategy.goal });
    this.emit('strategy-added', fullStrategy);

    return fullStrategy;
  }

  /**
   * Find strategies matching a query
   */
  findStrategies(query: StrategyQuery): Strategy[] {
    let results = Array.from(this.strategies.values());

    // Filter by goal similarity
    if (query.goal) {
      const goalWords = query.goal.toLowerCase().split(/\s+/);
      results = results.filter(s => {
        const strategyWords = s.goal.toLowerCase().split(/\s+/);
        const commonWords = goalWords.filter(w => strategyWords.some(sw => sw.includes(w)));
        return commonWords.length >= Math.min(2, goalWords.length * 0.5);
      });
    }

    // Filter by context
    if (query.context) {
      results = results.filter(s => 
        s.context.toLowerCase().includes(query.context!.toLowerCase())
      );
    }

    // Filter by tags
    if (query.tags && query.tags.length > 0) {
      results = results.filter(s => 
        query.tags!.some(t => s.tags.includes(t))
      );
    }

    // Filter by success rate
    if (query.minSuccessRate !== undefined) {
      results = results.filter(s => {
        const total = s.successCount + s.failureCount;
        if (total === 0) return true; // New strategies pass
        return s.successCount / total >= query.minSuccessRate!;
      });
    }

    // Sort by success rate and usage
    results.sort((a, b) => {
      const aRate = a.successCount / Math.max(1, a.successCount + a.failureCount);
      const bRate = b.successCount / Math.max(1, b.successCount + b.failureCount);
      if (Math.abs(aRate - bRate) > 0.1) return bRate - aRate;
      return (b.successCount + b.failureCount) - (a.successCount + a.failureCount);
    });

    if (query.limit) {
      results = results.slice(0, query.limit);
    }

    return results;
  }

  /**
   * Get the best strategy for a goal and context
   */
  getBestStrategy(goal: string, context: string): Strategy | null {
    const strategies = this.findStrategies({
      goal,
      context,
      minSuccessRate: 0.5,
      limit: 1,
    });

    return strategies[0] || null;
  }

  /**
   * Record strategy execution result
   */
  async recordStrategyResult(
    strategyId: string,
    success: boolean,
    executionTime: number
  ): Promise<void> {
    const strategy = this.strategies.get(strategyId);
    if (!strategy) return;

    if (success) {
      strategy.successCount++;
    } else {
      strategy.failureCount++;
    }

    // Update average execution time
    const totalExecutions = strategy.successCount + strategy.failureCount;
    strategy.avgExecutionTime = 
      (strategy.avgExecutionTime * (totalExecutions - 1) + executionTime) / totalExecutions;

    await this.saveStrategies();
    this.emit('strategy-updated', strategy);
  }

  /**
   * Delete a strategy
   */
  async deleteStrategy(id: string): Promise<boolean> {
    if (!this.strategies.has(id)) return false;
    this.strategies.delete(id);
    await this.saveStrategies();
    return true;
  }

  // ===========================================================================
  // Pattern Recognition
  // ===========================================================================

  /**
   * Record an action sequence for pattern recognition
   */
  async recordActionSequence(
    actions: VMAction[],
    context: string,
    successful: boolean
  ): Promise<void> {
    // Extract action type sequence
    const sequence = actions.map(a => a.type);
    const sequenceKey = sequence.join('-');

    let pattern = this.patterns.get(sequenceKey);
    
    if (pattern) {
      pattern.frequency++;
      if (!pattern.contexts.includes(context)) {
        pattern.contexts.push(context);
      }
      // Update success rate
      const total = pattern.frequency;
      pattern.successRate = 
        (pattern.successRate * (total - 1) + (successful ? 1 : 0)) / total;
    } else {
      pattern = {
        id: uuidv4(),
        description: this.describeActionSequence(sequence),
        actionSequence: sequence,
        frequency: 1,
        contexts: [context],
        successRate: successful ? 1 : 0,
      };
      this.patterns.set(sequenceKey, pattern);
    }

    await this.savePatterns();
  }

  /**
   * Get common patterns
   */
  getCommonPatterns(minFrequency: number = 3): RecognizedPattern[] {
    return Array.from(this.patterns.values())
      .filter(p => p.frequency >= minFrequency)
      .sort((a, b) => b.frequency - a.frequency);
  }

  // ===========================================================================
  // Application Knowledge
  // ===========================================================================

  /**
   * Update knowledge about an application
   */
  async updateAppKnowledge(
    application: string,
    elements: KnownElement[],
    shortcuts?: Shortcut[]
  ): Promise<void> {
    let knowledge = this.appKnowledge.get(application.toLowerCase());

    if (knowledge) {
      // Merge elements
      for (const element of elements) {
        const existing = knowledge.knownElements.find(
          e => e.description === element.description
        );
        if (existing) {
          // Update with higher confidence
          if (element.confidence > existing.confidence) {
            Object.assign(existing, element);
          }
        } else {
          knowledge.knownElements.push(element);
        }
      }

      // Add shortcuts
      if (shortcuts) {
        for (const shortcut of shortcuts) {
          if (!knowledge.shortcuts.find(s => 
            s.keys.join('+') === shortcut.keys.join('+')
          )) {
            knowledge.shortcuts.push(shortcut);
          }
        }
      }

      knowledge.updatedAt = Date.now();
    } else {
      knowledge = {
        id: uuidv4(),
        application: application.toLowerCase(),
        knownElements: elements,
        workflows: [],
        shortcuts: shortcuts || [],
        updatedAt: Date.now(),
      };
      this.appKnowledge.set(application.toLowerCase(), knowledge);
    }

    await this.saveAppKnowledge();
  }

  /**
   * Get knowledge about an application
   */
  getAppKnowledge(application: string): ApplicationKnowledge | null {
    return this.appKnowledge.get(application.toLowerCase()) || null;
  }

  /**
   * Find element location in an application
   */
  findElementLocation(
    application: string,
    description: string
  ): KnownElement | null {
    const knowledge = this.getAppKnowledge(application);
    if (!knowledge) return null;

    // Find best matching element
    const descWords = description.toLowerCase().split(/\s+/);
    let bestMatch: KnownElement | null = null;
    let bestScore = 0;

    for (const element of knowledge.knownElements) {
      const elemWords = element.description.toLowerCase().split(/\s+/);
      const matches = descWords.filter(w => elemWords.some(ew => ew.includes(w)));
      const score = matches.length / descWords.length * element.confidence;

      if (score > bestScore) {
        bestScore = score;
        bestMatch = element;
      }
    }

    return bestScore > 0.5 ? bestMatch : null;
  }

  // ===========================================================================
  // WorldBox-Specific Memory
  // ===========================================================================

  /**
   * Store WorldBox-specific strategy
   */
  async storeWorldBoxStrategy(
    goal: string,
    actions: VMAction[],
    gameState?: WorldBoxGameState
  ): Promise<Strategy> {
    const tags = ['worldbox'];
    if (gameState?.currentMode) {
      tags.push(gameState.currentMode);
    }

    return this.storeStrategy({
      goal,
      context: 'WorldBox',
      actions,
      successCount: 1,
      failureCount: 0,
      preconditions: gameState?.currentMode ? [
        { type: 'application', value: 'WorldBox', required: true },
        { type: 'custom', value: `mode:${gameState.currentMode}`, required: false },
      ] : [
        { type: 'application', value: 'WorldBox', required: true },
      ],
      expectedOutcome: goal,
      tags,
      avgExecutionTime: 0,
      source: 'demonstration',
    });
  }

  /**
   * Get WorldBox-specific strategies
   */
  getWorldBoxStrategies(
    goal?: string,
    gameMode?: string
  ): Strategy[] {
    let results = this.findStrategies({
      context: 'WorldBox',
      tags: ['worldbox'],
    });

    if (gameMode) {
      results = results.filter(s => 
        s.preconditions.some(p => p.value.includes(gameMode))
      );
    }

    if (goal) {
      const goalWords = goal.toLowerCase().split(/\s+/);
      results = results.filter(s => {
        const strategyWords = s.goal.toLowerCase().split(/\s+/);
        return goalWords.some(w => strategyWords.some(sw => sw.includes(w)));
      });
    }

    return results;
  }

  // ===========================================================================
  // Conversion from LearnedBehaviors
  // ===========================================================================

  /**
   * Convert learned behaviors to strategies
   */
  async importBehaviors(behaviors: LearnedBehavior[]): Promise<number> {
    let imported = 0;

    for (const behavior of behaviors) {
      // Check if similar strategy exists
      const existing = this.findStrategies({
        goal: behavior.trigger.description,
        context: behavior.trigger.applicationContext || 'general',
        limit: 1,
      });

      if (existing.length > 0) continue;

      // Convert preconditions
      const preconditions: StrategyCondition[] = [];

      if (behavior.trigger.applicationContext) {
        preconditions.push({
          type: 'application',
          value: behavior.trigger.applicationContext,
          required: true,
        });
      }

      for (const pattern of behavior.trigger.textPatterns || []) {
        preconditions.push({
          type: 'text_visible',
          value: pattern,
          required: false,
        });
      }

      await this.storeStrategy({
        goal: behavior.trigger.description,
        context: behavior.trigger.applicationContext || 'general',
        actions: behavior.actionSequence,
        successCount: Math.round(behavior.successRate * behavior.executionCount),
        failureCount: Math.round((1 - behavior.successRate) * behavior.executionCount),
        preconditions,
        expectedOutcome: behavior.expectedOutcome,
        tags: [],
        avgExecutionTime: 0,
        source: 'demonstration',
      });

      imported++;
    }

    return imported;
  }

  // ===========================================================================
  // Statistics
  // ===========================================================================

  /**
   * Get memory statistics
   */
  getStats(): {
    totalStrategies: number;
    totalPatterns: number;
    applications: string[];
    topStrategies: Array<{ goal: string; successRate: number; uses: number }>;
    mostUsedPatterns: Array<{ pattern: string; frequency: number }>;
  } {
    const strategies = Array.from(this.strategies.values());
    const patterns = Array.from(this.patterns.values());

    const topStrategies = strategies
      .map(s => ({
        goal: s.goal,
        successRate: s.successCount / Math.max(1, s.successCount + s.failureCount),
        uses: s.successCount + s.failureCount,
      }))
      .sort((a, b) => b.uses - a.uses)
      .slice(0, 10);

    const mostUsedPatterns = patterns
      .map(p => ({
        pattern: p.actionSequence.join(' → '),
        frequency: p.frequency,
      }))
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, 10);

    return {
      totalStrategies: strategies.length,
      totalPatterns: patterns.length,
      applications: Array.from(this.appKnowledge.keys()),
      topStrategies,
      mostUsedPatterns,
    };
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Load all data from disk
   */
  private async loadAll(): Promise<void> {
    await Promise.all([
      this.loadStrategies(),
      this.loadPatterns(),
      this.loadAppKnowledge(),
    ]);
  }

  private async loadStrategies(): Promise<void> {
    try {
      const data = await fs.readFile(
        path.join(this.storageDir, 'strategies.json'),
        'utf-8'
      );
      const strategies = JSON.parse(data) as Strategy[];
      for (const s of strategies) {
        this.strategies.set(s.id, s);
      }
    } catch {
      // File doesn't exist yet
    }
  }

  private async saveStrategies(): Promise<void> {
    await fs.writeFile(
      path.join(this.storageDir, 'strategies.json'),
      JSON.stringify(Array.from(this.strategies.values()), null, 2)
    );
  }

  private async loadPatterns(): Promise<void> {
    try {
      const data = await fs.readFile(
        path.join(this.storageDir, 'patterns.json'),
        'utf-8'
      );
      const patterns = JSON.parse(data) as RecognizedPattern[];
      for (const p of patterns) {
        this.patterns.set(p.actionSequence.join('-'), p);
      }
    } catch {
      // File doesn't exist yet
    }
  }

  private async savePatterns(): Promise<void> {
    await fs.writeFile(
      path.join(this.storageDir, 'patterns.json'),
      JSON.stringify(Array.from(this.patterns.values()), null, 2)
    );
  }

  private async loadAppKnowledge(): Promise<void> {
    try {
      const data = await fs.readFile(
        path.join(this.storageDir, 'app-knowledge.json'),
        'utf-8'
      );
      const knowledge = JSON.parse(data) as ApplicationKnowledge[];
      for (const k of knowledge) {
        this.appKnowledge.set(k.application, k);
      }
    } catch {
      // File doesn't exist yet
    }
  }

  private async saveAppKnowledge(): Promise<void> {
    await fs.writeFile(
      path.join(this.storageDir, 'app-knowledge.json'),
      JSON.stringify(Array.from(this.appKnowledge.values()), null, 2)
    );
  }

  /**
   * Describe an action sequence in natural language
   */
  private describeActionSequence(sequence: string[]): string {
    if (sequence.length === 0) return 'Empty sequence';
    if (sequence.length === 1) return `Single ${sequence[0]}`;

    // Find repeated subsequences
    const typeFreq: Record<string, number> = {};
    for (const type of sequence) {
      typeFreq[type] = (typeFreq[type] || 0) + 1;
    }

    const parts: string[] = [];
    for (const [type, count] of Object.entries(typeFreq)) {
      if (count === 1) {
        parts.push(type);
      } else {
        parts.push(`${count}x ${type}`);
      }
    }

    return parts.join(', ');
  }
}

// =============================================================================
// Singleton & Exports
// =============================================================================

let memoryInstance: StrategyMemory | null = null;

/**
 * Get the strategy memory singleton
 */
export function getStrategyMemory(): StrategyMemory {
  if (!memoryInstance) {
    memoryInstance = new StrategyMemory();
  }
  return memoryInstance;
}

export default StrategyMemory;
