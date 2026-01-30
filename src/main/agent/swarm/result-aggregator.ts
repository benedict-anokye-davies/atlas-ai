/**
 * @fileoverview Result Aggregator - Combines results from multiple agents
 * @module agent/swarm/result-aggregator
 * @author Atlas Team
 * @since 2.0.0
 *
 * @description
 * Aggregates results from multiple agents into a coherent output.
 * Supports various aggregation strategies including concatenation,
 * voting, and consensus building.
 */

import { createModuleLogger } from '../../utils/logger';
import { TaskResult, AggregationResult, ExecutionStrategy, AggregationStrategy } from './types';

const logger = createModuleLogger('ResultAggregator');

// =============================================================================
// Result Aggregator Class
// =============================================================================

/**
 * Aggregates results from multiple agents.
 *
 * Combines individual task results into a single coherent output
 * using various aggregation strategies.
 *
 * @class ResultAggregator
 */
export class ResultAggregator {
  private consensusThreshold: number;

  /**
   * Creates a new ResultAggregator instance
   *
   * @param {number} consensusThreshold - Threshold for consensus (0-1)
   */
  constructor(consensusThreshold: number = 0.7) {
    this.consensusThreshold = consensusThreshold;
  }

  /**
   * Aggregate multiple task results.
   *
   * @async
   * @param {TaskResult[]} results - Individual task results
   * @param {ExecutionStrategy} strategy - Execution strategy
   * @returns {Promise<AggregationResult>} Aggregated result
   */
  async aggregate(results: TaskResult[], strategy: ExecutionStrategy): Promise<AggregationResult> {
    logger.info('Aggregating results', {
      resultCount: results.length,
      mode: strategy.mode,
    });

    // Determine aggregation strategy based on execution mode
    const aggregationStrategy = this.determineAggregationStrategy(strategy);

    // Perform aggregation
    switch (aggregationStrategy) {
      case 'concatenate':
        return this.aggregateConcatenate(results);
      case 'merge':
        return this.aggregateMerge(results);
      case 'vote':
        return this.aggregateVote(results);
      case 'best':
        return this.aggregateBest(results);
      default:
        return this.aggregateConcatenate(results);
    }
  }

  /**
   * Determine the best aggregation strategy.
   */
  private determineAggregationStrategy(strategy: ExecutionStrategy): AggregationStrategy {
    // Use strategy-specific aggregation
    switch (strategy.mode) {
      case 'parallel':
        return 'merge';
      case 'sequential':
        return 'concatenate';
      case 'hybrid':
        return 'merge';
      default:
        return 'concatenate';
    }
  }

  /**
   * Concatenate results (for sequential execution).
   */
  private aggregateConcatenate(results: TaskResult[]): AggregationResult {
    const successful = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);

    // Concatenate outputs
    const output = successful
      .map((r) => r.output)
      .filter(Boolean)
      .join('\n\n');

    // Merge data objects
    const data = successful.reduce((acc, r) => {
      if (r.data && typeof r.data === 'object') {
        return { ...acc, ...r.data };
      }
      return acc;
    }, {});

    // Collect errors
    const errors = failed
      .map((r) => r.error)
      .filter(Boolean)
      .map((e) => new Error(e!));

    const success = failed.length === 0 || successful.length > 0;

    return {
      success,
      output: output || 'No output',
      data,
      errors,
      sourceResults: results,
    };
  }

  /**
   * Merge results (for parallel execution).
   */
  private aggregateMerge(results: TaskResult[]): AggregationResult {
    const successful = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);

    // Calculate consensus score
    const consensusScore = successful.length / results.length;

    // Merge outputs into a structured format
    const output = successful
      .map((r, i) => `## Result ${i + 1}\n${r.output || 'No output'}`)
      .join('\n\n');

    // Combine all data into an array
    const data = successful.map((r) => r.data);

    // Collect errors
    const errors = failed
      .map((r) => r.error)
      .filter(Boolean)
      .map((e) => new Error(e!));

    // Success if we have consensus or at least one success
    const success = consensusScore >= this.consensusThreshold || successful.length > 0;

    return {
      success,
      output: output || 'No output',
      data,
      errors,
      consensusScore,
      sourceResults: results,
    };
  }

  /**
   * Vote on results (for consensus building).
   */
  private aggregateVote(results: TaskResult[]): AggregationResult {
    // Group results by similarity
    const groups = this.groupSimilarResults(results);

    // Find the largest group (consensus)
    const consensusGroup = groups.reduce((largest, current) =>
      current.length > largest.length ? current : largest
    );

    const consensusScore = consensusGroup.length / results.length;
    const success = consensusScore >= this.consensusThreshold;

    // Use the consensus result
    const representative = consensusGroup[0];

    return {
      success,
      output: representative?.output || 'No consensus',
      data: representative?.data,
      errors: [],
      consensusScore,
      sourceResults: results,
    };
  }

  /**
   * Select best result (for competitive execution).
   */
  private aggregateBest(results: TaskResult[]): AggregationResult {
    // Filter successful results
    const successful = results.filter((r) => r.success);

    if (successful.length === 0) {
      return {
        success: false,
        output: 'All attempts failed',
        data: null,
        errors: results
          .map((r) => r.error)
          .filter(Boolean)
          .map((e) => new Error(e!)),
        sourceResults: results,
      };
    }

    // Select the best result (could use metadata scoring)
    const best = successful.reduce((current, next) => {
      // Prefer results with more complete data
      const currentScore = this.scoreResult(current);
      const nextScore = this.scoreResult(next);
      return nextScore > currentScore ? next : current;
    });

    return {
      success: true,
      output: best.output || 'Best result',
      data: best.data,
      errors: [],
      sourceResults: results,
    };
  }

  /**
   * Score a result for quality.
   */
  private scoreResult(result: TaskResult): number {
    let score = 0;

    // Has output
    if (result.output) score += 1;

    // Has data
    if (result.data) score += 2;

    // No error
    if (!result.error) score += 1;

    // Has metadata with duration (faster is better)
    if (result.metadata?.duration) {
      score += Math.max(0, 10 - result.metadata.duration / 1000);
    }

    return score;
  }

  /**
   * Group similar results together.
   */
  private groupSimilarResults(results: TaskResult[]): TaskResult[][] {
    const groups: TaskResult[][] = [];

    for (const result of results) {
      let added = false;

      for (const group of groups) {
        if (this.areResultsSimilar(result, group[0])) {
          group.push(result);
          added = true;
          break;
        }
      }

      if (!added) {
        groups.push([result]);
      }
    }

    return groups;
  }

  /**
   * Check if two results are similar.
   */
  private areResultsSimilar(a: TaskResult, b: TaskResult): boolean {
    // Simple similarity check based on output
    if (a.output && b.output) {
      return a.output.substring(0, 100) === b.output.substring(0, 100);
    }

    // Check data similarity
    if (a.data && b.data) {
      return JSON.stringify(a.data) === JSON.stringify(b.data);
    }

    return false;
  }
}
