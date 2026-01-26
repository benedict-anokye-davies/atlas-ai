/**
 * Atlas Desktop - Behavior Learner
 *
 * Learns behaviors from demonstrations using imitation learning
 * and improves through reinforcement learning from feedback.
 *
 * @module vm-agent/behavior-learner
 */

import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as path from 'path';
import { app } from 'electron';
import { createModuleLogger } from '../utils/logger';
import {
  Demonstration,
  RecordedAction,
  LearnedBehavior,
  ReinforcementFeedback,
  LearningStats,
  ScreenState,
  VMAction,
} from './types';
import { v4 as uuidv4 } from 'uuid';

const logger = createModuleLogger('BehaviorLearner');

// =============================================================================
// Constants
// =============================================================================

const BEHAVIORS_DIR = 'vm-agent/learned-behaviors';
const MIN_DEMONSTRATIONS = 2; // Minimum demos needed to learn a behavior
const CONFIDENCE_THRESHOLD = 0.6;
const SIMILARITY_THRESHOLD = 0.7;

// =============================================================================
// Behavior Learner Class
// =============================================================================

/**
 * Learns and stores behaviors from demonstrations
 */
export class BehaviorLearner extends EventEmitter {
  private behaviors: Map<string, LearnedBehavior> = new Map();
  private storageDir: string;
  private initialized: boolean = false;

  constructor() {
    super();
    this.storageDir = path.join(app.getPath('userData'), BEHAVIORS_DIR);
  }

  /**
   * Initialize the learner
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    await fs.mkdir(this.storageDir, { recursive: true });
    await this.loadBehaviors();
    this.initialized = true;

    logger.info('Behavior learner initialized', { behaviors: this.behaviors.size });
  }

  /**
   * Learn from a set of demonstrations
   */
  async learnFromDemonstrations(demonstrations: Demonstration[]): Promise<LearnedBehavior[]> {
    const newBehaviors: LearnedBehavior[] = [];

    // Group demonstrations by category and similar patterns
    const grouped = this.groupDemonstrations(demonstrations);

    for (const [key, demos] of grouped.entries()) {
      if (demos.length < MIN_DEMONSTRATIONS) {
        logger.debug('Not enough demonstrations for pattern', { key, count: demos.length });
        continue;
      }

      // Extract common action sequence
      const commonSequence = this.extractCommonSequence(demos);
      if (commonSequence.length === 0) continue;

      // Create or update behavior
      const behavior = this.createBehavior(demos, commonSequence);
      
      // Check if similar behavior exists
      const existing = this.findSimilarBehavior(behavior);
      if (existing) {
        // Merge with existing
        this.mergeBehaviors(existing, behavior);
        await this.saveBehavior(existing);
        newBehaviors.push(existing);
      } else {
        // Add new behavior
        this.behaviors.set(behavior.id, behavior);
        await this.saveBehavior(behavior);
        newBehaviors.push(behavior);
      }
    }

    logger.info('Learned behaviors from demonstrations', { 
      demonstrations: demonstrations.length,
      newBehaviors: newBehaviors.length 
    });

    return newBehaviors;
  }

  /**
   * Find a behavior that matches the current situation
   */
  findMatchingBehavior(
    state: ScreenState,
    intent: string
  ): LearnedBehavior | null {
    let bestMatch: LearnedBehavior | null = null;
    let bestScore = 0;

    for (const behavior of this.behaviors.values()) {
      const score = this.scoreBehaviorMatch(behavior, state, intent);
      if (score > bestScore && score >= CONFIDENCE_THRESHOLD) {
        bestScore = score;
        bestMatch = behavior;
      }
    }

    return bestMatch;
  }

  /**
   * Apply reinforcement feedback to improve behaviors
   */
  async applyFeedback(feedback: ReinforcementFeedback): Promise<void> {
    // Find which behavior led to this action
    for (const behavior of this.behaviors.values()) {
      // Check if the action is part of this behavior's sequence
      // This is simplified - real implementation would track action-behavior mapping
      
      // Update success rate based on feedback
      if (feedback.reward > 0) {
        behavior.successRate = (behavior.successRate * behavior.executionCount + 1) / (behavior.executionCount + 1);
      } else {
        behavior.successRate = (behavior.successRate * behavior.executionCount) / (behavior.executionCount + 1);
      }
      
      behavior.executionCount++;
      behavior.updatedAt = Date.now();

      // Update confidence
      behavior.confidence = Math.min(0.95, behavior.confidence + feedback.reward * 0.05);

      await this.saveBehavior(behavior);
    }
  }

  /**
   * Get all learned behaviors
   */
  getBehaviors(): LearnedBehavior[] {
    return Array.from(this.behaviors.values());
  }

  /**
   * Get behaviors for a specific application/context
   */
  getBehaviorsForContext(applicationContext: string): LearnedBehavior[] {
    return this.getBehaviors().filter(b => 
      b.trigger.applicationContext === applicationContext
    );
  }

  /**
   * Get learning statistics
   */
  getStats(): LearningStats {
    const behaviors = this.getBehaviors();
    const totalActions = behaviors.reduce((sum, b) => sum + b.actionSequence.length, 0);
    const avgSuccess = behaviors.length > 0
      ? behaviors.reduce((sum, b) => sum + b.successRate, 0) / behaviors.length
      : 0;

    // Count actions by type
    const actionsByCategory: Record<string, number> = {};
    for (const behavior of behaviors) {
      for (const action of behavior.actionSequence) {
        const type = action.type;
        actionsByCategory[type] = (actionsByCategory[type] || 0) + 1;
      }
    }

    // Find common patterns
    const patternCounts: Record<string, number> = {};
    for (const behavior of behaviors) {
      const pattern = behavior.actionSequence.map(a => a.type).join(' -> ');
      patternCounts[pattern] = (patternCounts[pattern] || 0) + 1;
    }

    const commonPatterns = Object.entries(patternCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([pattern, count]) => ({ pattern, count }));

    return {
      totalDemonstrations: 0, // Would need to track this separately
      totalActions,
      learnedBehaviors: behaviors.length,
      averageSuccessRate: avgSuccess,
      actionsByCategory,
      commonPatterns,
    };
  }

  /**
   * Delete a learned behavior
   */
  async deleteBehavior(id: string): Promise<boolean> {
    if (!this.behaviors.has(id)) return false;

    this.behaviors.delete(id);

    try {
      await fs.unlink(path.join(this.storageDir, `${id}.json`));
    } catch {
      // File might not exist
    }

    return true;
  }

  /**
   * Export behaviors for sharing
   */
  async exportBehaviors(): Promise<string> {
    return JSON.stringify(Array.from(this.behaviors.values()), null, 2);
  }

  /**
   * Import behaviors
   */
  async importBehaviors(json: string): Promise<number> {
    const imported = JSON.parse(json) as LearnedBehavior[];
    let count = 0;

    for (const behavior of imported) {
      // Generate new ID to avoid conflicts
      behavior.id = uuidv4();
      behavior.updatedAt = Date.now();

      this.behaviors.set(behavior.id, behavior);
      await this.saveBehavior(behavior);
      count++;
    }

    return count;
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Load behaviors from disk
   */
  private async loadBehaviors(): Promise<void> {
    try {
      const files = await fs.readdir(this.storageDir);

      for (const file of files) {
        if (file.endsWith('.json')) {
          try {
            const content = await fs.readFile(path.join(this.storageDir, file), 'utf-8');
            const behavior = JSON.parse(content) as LearnedBehavior;
            this.behaviors.set(behavior.id, behavior);
          } catch (error) {
            logger.warn('Failed to load behavior', { file, error: (error as Error).message });
          }
        }
      }
    } catch (error) {
      logger.debug('No behaviors found', { error: (error as Error).message });
    }
  }

  /**
   * Save a behavior to disk
   */
  private async saveBehavior(behavior: LearnedBehavior): Promise<void> {
    const filePath = path.join(this.storageDir, `${behavior.id}.json`);
    await fs.writeFile(filePath, JSON.stringify(behavior, null, 2));
  }

  /**
   * Group demonstrations by similarity
   */
  private groupDemonstrations(demonstrations: Demonstration[]): Map<string, Demonstration[]> {
    const groups = new Map<string, Demonstration[]>();

    for (const demo of demonstrations) {
      // Create a key based on category and action pattern
      const actionPattern = demo.actions.slice(0, 5).map(a => a.action.type).join('-');
      const key = `${demo.category}:${actionPattern}`;

      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(demo);
    }

    return groups;
  }

  /**
   * Extract common action sequence from demonstrations
   */
  private extractCommonSequence(demos: Demonstration[]): VMAction[] {
    if (demos.length === 0) return [];

    // Use the shortest demo as base
    const sortedByLength = [...demos].sort((a, b) => a.actions.length - b.actions.length);
    const base = sortedByLength[0];

    const commonActions: VMAction[] = [];

    for (let i = 0; i < base.actions.length; i++) {
      const baseAction = base.actions[i].action;

      // Check if this action appears in similar position in other demos
      let matchCount = 1;
      for (let j = 1; j < demos.length; j++) {
        const demo = demos[j];
        // Look for similar action within a window
        const windowStart = Math.max(0, i - 2);
        const windowEnd = Math.min(demo.actions.length, i + 3);

        for (let k = windowStart; k < windowEnd; k++) {
          if (this.actionsAreSimilar(baseAction, demo.actions[k].action)) {
            matchCount++;
            break;
          }
        }
      }

      // If action appears in majority of demos, include it
      if (matchCount >= demos.length * 0.6) {
        // Generalize the action (remove specific coordinates if they vary)
        const generalizedAction = this.generalizeAction(
          baseAction,
          demos.map(d => d.actions[i]?.action).filter(Boolean)
        );
        commonActions.push(generalizedAction);
      }
    }

    return commonActions;
  }

  /**
   * Check if two actions are similar
   */
  private actionsAreSimilar(a: VMAction, b: VMAction): boolean {
    if (a.type !== b.type) return false;

    switch (a.type) {
      case 'click':
      case 'doubleClick':
      case 'rightClick':
        // Similar if within 50 pixels
        const bClick = b as { x: number; y: number };
        return Math.abs(a.x - bClick.x) < 50 && Math.abs(a.y - bClick.y) < 50;

      case 'type':
        // Similar if typing same or similar text
        return a.text === (b as { text: string }).text;

      case 'keyPress':
        return a.key === (b as { key: string }).key;

      case 'hotkey':
        return JSON.stringify(a.keys) === JSON.stringify((b as { keys: string[] }).keys);

      default:
        return true;
    }
  }

  /**
   * Generalize an action by finding common properties
   */
  private generalizeAction(base: VMAction, variants: VMAction[]): VMAction {
    // For now, just return the base action
    // Real implementation would average coordinates, find patterns, etc.
    return base;
  }

  /**
   * Create a behavior from demonstrations
   */
  private createBehavior(demos: Demonstration[], sequence: VMAction[]): LearnedBehavior {
    // Extract visual and text patterns from demos
    const visualPatterns: string[] = [];
    const textPatterns: string[] = [];

    for (const demo of demos) {
      // Add window titles
      if (demo.initialState.activeWindow?.title) {
        if (!visualPatterns.includes(demo.initialState.activeWindow.title)) {
          visualPatterns.push(demo.initialState.activeWindow.title);
        }
      }

      // Add text regions
      for (const region of demo.initialState.textRegions.slice(0, 5)) {
        if (region.text.length > 3 && region.text.length < 50 && !textPatterns.includes(region.text)) {
          textPatterns.push(region.text);
        }
      }
    }

    // Calculate success rate from demos
    const successRate = demos.filter(d => d.successful).length / demos.length;

    return {
      id: uuidv4(),
      trigger: {
        description: demos[0].description,
        visualPatterns: visualPatterns.slice(0, 5),
        textPatterns: textPatterns.slice(0, 10),
        applicationContext: demos[0].category,
      },
      actionSequence: sequence,
      expectedOutcome: demos[0].description,
      successRate,
      executionCount: demos.length,
      sourceDemoIds: demos.map(d => d.id),
      confidence: Math.min(0.9, 0.5 + successRate * 0.3 + demos.length * 0.05),
      updatedAt: Date.now(),
    };
  }

  /**
   * Find a similar existing behavior
   */
  private findSimilarBehavior(behavior: LearnedBehavior): LearnedBehavior | null {
    for (const existing of this.behaviors.values()) {
      // Check if triggers are similar
      if (existing.trigger.applicationContext !== behavior.trigger.applicationContext) {
        continue;
      }

      // Check if action sequences are similar
      if (this.sequencesSimilar(existing.actionSequence, behavior.actionSequence)) {
        return existing;
      }
    }
    return null;
  }

  /**
   * Check if two action sequences are similar
   */
  private sequencesSimilar(a: VMAction[], b: VMAction[]): boolean {
    if (Math.abs(a.length - b.length) > 2) return false;

    const minLength = Math.min(a.length, b.length);
    let matches = 0;

    for (let i = 0; i < minLength; i++) {
      if (this.actionsAreSimilar(a[i], b[i])) {
        matches++;
      }
    }

    return matches / minLength >= SIMILARITY_THRESHOLD;
  }

  /**
   * Merge a new behavior into an existing one
   */
  private mergeBehaviors(existing: LearnedBehavior, newer: LearnedBehavior): void {
    // Update success rate as weighted average
    const totalExecutions = existing.executionCount + newer.executionCount;
    existing.successRate = 
      (existing.successRate * existing.executionCount + newer.successRate * newer.executionCount) / 
      totalExecutions;
    existing.executionCount = totalExecutions;

    // Add new source demos
    for (const demoId of newer.sourceDemoIds) {
      if (!existing.sourceDemoIds.includes(demoId)) {
        existing.sourceDemoIds.push(demoId);
      }
    }

    // Update confidence
    existing.confidence = Math.min(0.95, existing.confidence + 0.05);
    existing.updatedAt = Date.now();
  }

  /**
   * Score how well a behavior matches a situation
   */
  private scoreBehaviorMatch(
    behavior: LearnedBehavior,
    state: ScreenState,
    intent: string
  ): number {
    let score = 0;
    let factors = 0;

    // Check application context
    if (behavior.trigger.applicationContext) {
      factors++;
      if (state.activeWindow?.application?.toLowerCase().includes(behavior.trigger.applicationContext.toLowerCase())) {
        score += 1;
      }
    }

    // Check visual patterns (window title)
    if (behavior.trigger.visualPatterns && behavior.trigger.visualPatterns.length > 0) {
      factors++;
      for (const pattern of behavior.trigger.visualPatterns) {
        if (state.activeWindow?.title?.includes(pattern)) {
          score += 1;
          break;
        }
      }
    }

    // Check text patterns
    if (behavior.trigger.textPatterns && behavior.trigger.textPatterns.length > 0) {
      factors++;
      let textMatches = 0;
      for (const pattern of behavior.trigger.textPatterns) {
        if (state.textRegions.some(r => r.text.includes(pattern))) {
          textMatches++;
        }
      }
      score += textMatches / behavior.trigger.textPatterns.length;
    }

    // Check intent similarity
    if (behavior.trigger.description) {
      factors++;
      const descWords = behavior.trigger.description.toLowerCase().split(/\s+/);
      const intentWords = intent.toLowerCase().split(/\s+/);
      const commonWords = descWords.filter(w => intentWords.includes(w));
      score += commonWords.length / Math.max(descWords.length, intentWords.length);
    }

    // Weight by behavior's success rate and confidence
    const baseScore = factors > 0 ? score / factors : 0;
    return baseScore * behavior.successRate * behavior.confidence;
  }
}

// =============================================================================
// Singleton & Exports
// =============================================================================

let learnerInstance: BehaviorLearner | null = null;

/**
 * Get the behavior learner singleton
 */
export function getBehaviorLearner(): BehaviorLearner {
  if (!learnerInstance) {
    learnerInstance = new BehaviorLearner();
  }
  return learnerInstance;
}

export default BehaviorLearner;
