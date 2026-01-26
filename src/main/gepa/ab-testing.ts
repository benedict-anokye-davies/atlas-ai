/**
 * GEPA A/B Testing
 *
 * Tests optimizations before full deployment.
 * Runs experiments to compare variants and measure impact.
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import * as fs from 'fs/promises';
import * as path from 'path';
import { getConfig } from '../config';
import { getEvaluationFramework, Interaction } from './eval-framework';
import { isoDate } from '../../shared/utils';

const logger = createModuleLogger('GEPA-ABTest');

// ============================================================================
// Types
// ============================================================================

/**
 * A/B test variant
 */
export interface TestVariant {
  id: string;
  name: string;
  description: string;
  config: Record<string, unknown>;
  weight: number; // Traffic allocation weight (0-1)
}

/**
 * A/B test definition
 */
export interface ABTest {
  id: string;
  name: string;
  description: string;
  target: string; // What is being tested
  hypothesis: string;
  variants: TestVariant[];
  controlVariantId: string;
  status: 'draft' | 'running' | 'paused' | 'completed' | 'cancelled';
  startDate?: Date;
  endDate?: Date;
  minSampleSize: number;
  successMetric: 'success_rate' | 'latency' | 'satisfaction' | 'custom';
  customMetricFn?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Test assignment for a session
 */
export interface TestAssignment {
  testId: string;
  variantId: string;
  sessionId: string;
  assignedAt: Date;
}

/**
 * Variant performance metrics
 */
export interface VariantMetrics {
  variantId: string;
  sampleSize: number;
  successRate: number;
  avgLatency: number;
  satisfactionScore: number;
  conversionRate: number;
  confidence: number; // Statistical confidence
}

/**
 * A/B test results
 */
export interface TestResults {
  testId: string;
  computedAt: Date;
  status: 'insufficient_data' | 'no_winner' | 'winner_found' | 'inconclusive';
  variants: VariantMetrics[];
  winnerVariantId?: string;
  improvementPercent?: number;
  statisticalSignificance: number;
  recommendation: string;
}

// ============================================================================
// A/B Test Manager
// ============================================================================

export class ABTestManager extends EventEmitter {
  private dataDir: string;
  private tests: Map<string, ABTest> = new Map();
  private assignments: Map<string, TestAssignment> = new Map(); // sessionId -> assignment
  private initialized = false;

  constructor() {
    super();
    this.setMaxListeners(20);
    this.dataDir = '';
  }

  // --------------------------------------------------------------------------
  // Initialization
  // --------------------------------------------------------------------------

  /**
   * Initialize the A/B test manager
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      const appConfig = getConfig();
      const atlasDir = path.dirname(appConfig.logDir);
      this.dataDir = path.join(atlasDir, 'gepa', 'ab-tests');

      await fs.mkdir(path.join(this.dataDir, 'tests'), { recursive: true });
      await fs.mkdir(path.join(this.dataDir, 'assignments'), { recursive: true });
      await fs.mkdir(path.join(this.dataDir, 'results'), { recursive: true });

      // Load existing tests
      await this.loadTests();

      this.initialized = true;
      logger.info('A/B test manager initialized', { dataDir: this.dataDir });
    } catch (error) {
      logger.error('Failed to initialize A/B test manager:', error);
      throw error;
    }
  }

  // --------------------------------------------------------------------------
  // Test Management
  // --------------------------------------------------------------------------

  /**
   * Create a new A/B test
   */
  async createTest(params: {
    name: string;
    description: string;
    target: string;
    hypothesis: string;
    variants: Array<{
      name: string;
      description: string;
      config: Record<string, unknown>;
      weight?: number;
    }>;
    controlVariantIndex?: number;
    minSampleSize?: number;
    successMetric?: 'success_rate' | 'latency' | 'satisfaction' | 'custom';
  }): Promise<ABTest> {
    const testId = `test_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    // Create variants with IDs and normalized weights
    const totalWeight = params.variants.reduce((sum, v) => sum + (v.weight || 1), 0);
    const variants: TestVariant[] = params.variants.map((v, i) => ({
      id: `var_${i}_${Math.random().toString(36).substring(2, 6)}`,
      name: v.name,
      description: v.description,
      config: v.config,
      weight: (v.weight || 1) / totalWeight,
    }));

    const test: ABTest = {
      id: testId,
      name: params.name,
      description: params.description,
      target: params.target,
      hypothesis: params.hypothesis,
      variants,
      controlVariantId: variants[params.controlVariantIndex || 0].id,
      status: 'draft',
      minSampleSize: params.minSampleSize || 100,
      successMetric: params.successMetric || 'success_rate',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.tests.set(test.id, test);
    await this.saveTest(test);

    logger.info('A/B test created', { id: test.id, name: test.name });
    this.emit('test:created', test);

    return test;
  }

  /**
   * Start an A/B test
   */
  async startTest(testId: string): Promise<void> {
    const test = this.tests.get(testId);
    if (!test) {
      throw new Error(`Test not found: ${testId}`);
    }

    if (test.status !== 'draft' && test.status !== 'paused') {
      throw new Error(`Test cannot be started from status: ${test.status}`);
    }

    test.status = 'running';
    test.startDate = test.startDate || new Date();
    test.updatedAt = new Date();

    await this.saveTest(test);

    logger.info('A/B test started', { id: testId });
    this.emit('test:started', test);
  }

  /**
   * Pause an A/B test
   */
  async pauseTest(testId: string): Promise<void> {
    const test = this.tests.get(testId);
    if (!test) {
      throw new Error(`Test not found: ${testId}`);
    }

    if (test.status !== 'running') {
      throw new Error(`Test cannot be paused from status: ${test.status}`);
    }

    test.status = 'paused';
    test.updatedAt = new Date();

    await this.saveTest(test);

    logger.info('A/B test paused', { id: testId });
    this.emit('test:paused', test);
  }

  /**
   * Complete an A/B test
   */
  async completeTest(testId: string, winnerVariantId?: string): Promise<void> {
    const test = this.tests.get(testId);
    if (!test) {
      throw new Error(`Test not found: ${testId}`);
    }

    test.status = 'completed';
    test.endDate = new Date();
    test.updatedAt = new Date();

    await this.saveTest(test);

    logger.info('A/B test completed', { id: testId, winner: winnerVariantId });
    this.emit('test:completed', test);
  }

  /**
   * Cancel an A/B test
   */
  async cancelTest(testId: string): Promise<void> {
    const test = this.tests.get(testId);
    if (!test) {
      throw new Error(`Test not found: ${testId}`);
    }

    test.status = 'cancelled';
    test.endDate = new Date();
    test.updatedAt = new Date();

    await this.saveTest(test);

    logger.info('A/B test cancelled', { id: testId });
    this.emit('test:cancelled', test);
  }

  // --------------------------------------------------------------------------
  // Variant Assignment
  // --------------------------------------------------------------------------

  /**
   * Get variant assignment for a session
   */
  getAssignment(sessionId: string): TestAssignment | null {
    return this.assignments.get(sessionId) || null;
  }

  /**
   * Assign a session to a variant for a running test
   */
  async assignVariant(testId: string, sessionId: string): Promise<TestVariant | null> {
    const test = this.tests.get(testId);
    if (!test || test.status !== 'running') {
      return null;
    }

    // Check if already assigned
    const existing = this.assignments.get(sessionId);
    if (existing && existing.testId === testId) {
      return test.variants.find((v) => v.id === existing.variantId) || null;
    }

    // Random assignment based on weights
    const random = Math.random();
    let cumulative = 0;
    let selectedVariant: TestVariant | null = null;

    for (const variant of test.variants) {
      cumulative += variant.weight;
      if (random <= cumulative) {
        selectedVariant = variant;
        break;
      }
    }

    // Fallback to first variant
    if (!selectedVariant) {
      selectedVariant = test.variants[0];
    }

    // Record assignment
    const assignment: TestAssignment = {
      testId,
      variantId: selectedVariant.id,
      sessionId,
      assignedAt: new Date(),
    };

    this.assignments.set(sessionId, assignment);
    await this.saveAssignment(assignment);

    logger.debug('Variant assigned', {
      testId,
      sessionId,
      variantId: selectedVariant.id,
    });

    return selectedVariant;
  }

  /**
   * Get active variant config for a session
   */
  async getActiveConfig(
    sessionId: string,
    target: string
  ): Promise<Record<string, unknown> | null> {
    // Find running tests for this target
    for (const test of this.tests.values()) {
      if (test.status === 'running' && test.target === target) {
        const variant = await this.assignVariant(test.id, sessionId);
        if (variant) {
          return variant.config;
        }
      }
    }
    return null;
  }

  // --------------------------------------------------------------------------
  // Results Analysis
  // --------------------------------------------------------------------------

  /**
   * Compute results for a test
   */
  async computeResults(testId: string): Promise<TestResults> {
    const test = this.tests.get(testId);
    if (!test) {
      throw new Error(`Test not found: ${testId}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _evalFramework = getEvaluationFramework();

    // Get interactions for each variant
    const variantMetrics: VariantMetrics[] = [];

    for (const variant of test.variants) {
      const interactions = await this.getVariantInteractions(testId, variant.id);

      if (interactions.length === 0) {
        variantMetrics.push({
          variantId: variant.id,
          sampleSize: 0,
          successRate: 0,
          avgLatency: 0,
          satisfactionScore: 0,
          conversionRate: 0,
          confidence: 0,
        });
        continue;
      }

      // Calculate metrics
      const successes = interactions.filter((i) => i.outcome === 'success').length;
      const latencies = interactions.filter((i) => i.latencyMs).map((i) => i.latencyMs!);

      variantMetrics.push({
        variantId: variant.id,
        sampleSize: interactions.length,
        successRate: successes / interactions.length,
        avgLatency:
          latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0,
        satisfactionScore: this.calculateSatisfaction(interactions),
        conversionRate: successes / interactions.length,
        confidence: this.calculateConfidence(interactions.length),
      });
    }

    // Determine winner
    const controlMetrics = variantMetrics.find((v) => v.variantId === test.controlVariantId);
    let winnerVariantId: string | undefined;
    let improvementPercent: number | undefined;
    let status: TestResults['status'] = 'insufficient_data';

    const minSampleMet = variantMetrics.every((v) => v.sampleSize >= test.minSampleSize);

    if (minSampleMet) {
      // Find best performing variant
      const sortedByMetric = [...variantMetrics].sort((a, b) => {
        switch (test.successMetric) {
          case 'success_rate':
            return b.successRate - a.successRate;
          case 'latency':
            return a.avgLatency - b.avgLatency; // Lower is better
          case 'satisfaction':
            return b.satisfactionScore - a.satisfactionScore;
          default:
            return b.successRate - a.successRate;
        }
      });

      const best = sortedByMetric[0];
      const second = sortedByMetric[1];

      // Check if difference is significant
      const diff = Math.abs(best.successRate - second.successRate);
      const significance = this.calculateSignificance(best, second);

      if (significance >= 0.95) {
        status = 'winner_found';
        winnerVariantId = best.variantId;
        if (controlMetrics) {
          improvementPercent =
            ((best.successRate - controlMetrics.successRate) / controlMetrics.successRate) * 100;
        }
      } else if (diff < 0.01) {
        status = 'no_winner';
      } else {
        status = 'inconclusive';
      }
    }

    // Generate recommendation
    let recommendation = '';
    switch (status) {
      case 'insufficient_data':
        recommendation = 'Continue running the test to gather more data.';
        break;
      case 'winner_found': {
        const winner = test.variants.find((v) => v.id === winnerVariantId);
        recommendation = `Deploy "${winner?.name}" variant. Expected improvement: ${improvementPercent?.toFixed(1)}%.`;
        break;
      }
      case 'no_winner':
        recommendation =
          'No significant difference between variants. Consider keeping the control.';
        break;
      case 'inconclusive':
        recommendation = 'Results are inconclusive. Consider extending the test duration.';
        break;
    }

    const results: TestResults = {
      testId,
      computedAt: new Date(),
      status,
      variants: variantMetrics,
      winnerVariantId,
      improvementPercent,
      statisticalSignificance: this.calculateOverallSignificance(variantMetrics),
      recommendation,
    };

    // Save results
    await this.saveResults(results);

    logger.info('Test results computed', {
      testId,
      status,
      winner: winnerVariantId,
    });

    return results;
  }

  /**
   * Get interactions for a variant
   */
  private async getVariantInteractions(testId: string, variantId: string): Promise<Interaction[]> {
    const evalFramework = getEvaluationFramework();
    const test = this.tests.get(testId);
    if (!test || !test.startDate) return [];

    // Load interactions from the test period
    const interactions = await evalFramework.loadInteractions(
      test.startDate,
      test.endDate || new Date()
    );

    // Filter by variant assignment
    const assignedSessions = new Set<string>();
    for (const [sessionId, assignment] of this.assignments) {
      if (assignment.testId === testId && assignment.variantId === variantId) {
        assignedSessions.add(sessionId);
      }
    }

    return interactions.filter((i) => assignedSessions.has(i.sessionId));
  }

  /**
   * Calculate satisfaction score from interactions
   */
  private calculateSatisfaction(interactions: Interaction[]): number {
    if (interactions.length === 0) return 0;

    const weights: Record<string, number> = {
      explicit_positive: 1.0,
      task_completed: 0.8,
      follow_up: 0.6,
      explicit_negative: -1.0,
      task_failed: -0.8,
      retry: -0.4,
      correction: -0.3,
      abandonment: -0.6,
    };

    let total = 0;
    let count = 0;

    for (const interaction of interactions) {
      for (const signal of interaction.satisfactionSignals) {
        total += weights[signal] || 0;
        count++;
      }
    }

    if (count === 0) return 0.5;
    return Math.max(0, Math.min(1, (total / count + 1) / 2));
  }

  /**
   * Calculate confidence based on sample size
   */
  private calculateConfidence(sampleSize: number): number {
    // Simple heuristic: confidence increases with sample size
    return Math.min(0.99, 1 - 1 / Math.sqrt(sampleSize + 1));
  }

  /**
   * Calculate statistical significance between two variants
   */
  private calculateSignificance(a: VariantMetrics, b: VariantMetrics): number {
    // Simplified z-test for proportions
    const p1 = a.successRate;
    const p2 = b.successRate;
    const n1 = a.sampleSize;
    const n2 = b.sampleSize;

    if (n1 === 0 || n2 === 0) return 0;

    const pooledP = (p1 * n1 + p2 * n2) / (n1 + n2);
    const se = Math.sqrt(pooledP * (1 - pooledP) * (1 / n1 + 1 / n2));

    if (se === 0) return 0;

    const z = Math.abs(p1 - p2) / se;

    // Convert z-score to p-value (approximation)
    const pValue = Math.exp(-0.5 * z * z);
    return 1 - pValue;
  }

  /**
   * Calculate overall significance across all variants
   */
  private calculateOverallSignificance(variants: VariantMetrics[]): number {
    if (variants.length < 2) return 0;

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _totalSamples = variants.reduce((sum, v) => sum + v.sampleSize, 0);
    const avgConfidence = variants.reduce((sum, v) => sum + v.confidence, 0) / variants.length;

    return avgConfidence;
  }

  // --------------------------------------------------------------------------
  // Persistence
  // --------------------------------------------------------------------------

  private async saveTest(test: ABTest): Promise<void> {
    const filePath = path.join(this.dataDir, 'tests', `${test.id}.json`);
    await fs.writeFile(filePath, JSON.stringify(test, null, 2), 'utf-8');
  }

  private async saveAssignment(assignment: TestAssignment): Promise<void> {
    const dateStr = isoDate(assignment.assignedAt);
    const filePath = path.join(this.dataDir, 'assignments', `${dateStr}.jsonl`);
    await fs.appendFile(filePath, JSON.stringify(assignment) + '\n', 'utf-8');
  }

  private async saveResults(results: TestResults): Promise<void> {
    const filePath = path.join(this.dataDir, 'results', `${results.testId}_${Date.now()}.json`);
    await fs.writeFile(filePath, JSON.stringify(results, null, 2), 'utf-8');
  }

  private async loadTests(): Promise<void> {
    try {
      const files = await fs.readdir(path.join(this.dataDir, 'tests'));
      for (const file of files) {
        if (file.endsWith('.json')) {
          const content = await fs.readFile(path.join(this.dataDir, 'tests', file), 'utf-8');
          const test = JSON.parse(content) as ABTest;
          test.createdAt = new Date(test.createdAt);
          test.updatedAt = new Date(test.updatedAt);
          if (test.startDate) test.startDate = new Date(test.startDate);
          if (test.endDate) test.endDate = new Date(test.endDate);
          this.tests.set(test.id, test);
        }
      }
      logger.debug('Loaded A/B tests', { count: this.tests.size });
    } catch {
      // Directory doesn't exist
    }
  }

  // --------------------------------------------------------------------------
  // Getters
  // --------------------------------------------------------------------------

  getTests(): ABTest[] {
    return Array.from(this.tests.values());
  }

  getRunningTests(): ABTest[] {
    return Array.from(this.tests.values()).filter((t) => t.status === 'running');
  }

  getTest(testId: string): ABTest | null {
    return this.tests.get(testId) || null;
  }

  // --------------------------------------------------------------------------
  // Cleanup
  // --------------------------------------------------------------------------

  async cleanup(): Promise<void> {
    this.tests.clear();
    this.assignments.clear();
    this.initialized = false;
    logger.info('A/B test manager cleaned up');
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

let abTestInstance: ABTestManager | null = null;

export function getABTestManager(): ABTestManager {
  if (!abTestInstance) {
    abTestInstance = new ABTestManager();
  }
  return abTestInstance;
}

export default ABTestManager;
