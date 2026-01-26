/**
 * GEPA Optimizer
 *
 * Core optimization engine for self-improvement.
 * Analyzes performance data, identifies optimization opportunities,
 * and applies improvements to prompts and configurations.
 *
 * GEPA = Generate, Evaluate, Propose, Apply
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import * as fs from 'fs/promises';
import * as path from 'path';
import { getConfig } from '../config';
import { getEvaluationFramework, Interaction, PeriodMetrics } from './eval-framework';
import { getMetricsCollector } from './metrics-collector';
import { getDSPyBridge, OptimizationResult, DSPyModuleConfig } from './dspy-integration';

const logger = createModuleLogger('GEPA-Optimizer');

// ============================================================================
// Types
// ============================================================================

/**
 * Optimization target types
 */
export type OptimizationTarget =
  | 'system_prompt' // Main system prompt
  | 'tool_selection' // Tool selection logic
  | 'response_style' // Communication style
  | 'error_handling' // Error recovery
  | 'prioritization' // Task prioritization
  | 'context_building'; // Memory/context retrieval

/**
 * Optimization proposal
 */
export interface OptimizationProposal {
  id: string;
  target: OptimizationTarget;
  title: string;
  description: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  confidence: number; // 0-1
  expectedImprovement: number; // Percentage
  evidence: string[];
  suggestedChange: string;
  rollbackPlan: string;
  createdAt: Date;
  status: 'proposed' | 'approved' | 'applied' | 'rejected' | 'rolled_back';
}

/**
 * Applied optimization record
 */
export interface AppliedOptimization {
  id: string;
  proposalId: string;
  target: OptimizationTarget;
  appliedAt: Date;
  originalValue: string;
  newValue: string;
  metricsBeforeId: string;
  metricsAfterId?: string;
  improvementActual?: number;
  status: 'pending_validation' | 'validated' | 'degraded' | 'rolled_back';
}

/**
 * Optimization report for user
 */
export interface OptimizationReport {
  id: string;
  generatedAt: Date;
  periodStart: Date;
  periodEnd: Date;
  metricsAnalysis: {
    successRate: number;
    successRateChange: number;
    avgLatency: number;
    latencyChange: number;
    correctionRate: number;
    correctionRateChange: number;
  };
  patterns: Array<{
    type: string;
    description: string;
    frequency: number;
  }>;
  proposalsGenerated: number;
  proposalsApplied: number;
  improvements: Array<{
    target: string;
    description: string;
    improvement: number;
  }>;
  rollbacks: Array<{
    target: string;
    reason: string;
  }>;
  nextSteps: string[];
}

/**
 * GEPA configuration
 */
export interface GEPAConfig {
  enabled: boolean;
  autoApply: boolean; // Auto-apply low-risk optimizations
  minConfidence: number; // Min confidence to auto-apply
  validationPeriodHours: number; // Hours to wait before validating
  rollbackThreshold: number; // Performance degradation threshold
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_GEPA_CONFIG: GEPAConfig = {
  enabled: true,
  autoApply: false, // Require approval by default
  minConfidence: 0.8,
  validationPeriodHours: 24,
  rollbackThreshold: 0.1, // 10% degradation triggers rollback
};

// ============================================================================
// GEPA Optimizer
// ============================================================================

export class GEPAOptimizer extends EventEmitter {
  private config: GEPAConfig;
  private dataDir: string;
  private proposals: Map<string, OptimizationProposal> = new Map();
  private appliedOptimizations: Map<string, AppliedOptimization> = new Map();
  private initialized = false;

  constructor(config?: Partial<GEPAConfig>) {
    super();
    this.setMaxListeners(20);
    this.config = { ...DEFAULT_GEPA_CONFIG, ...config };
    this.dataDir = '';
  }

  // --------------------------------------------------------------------------
  // Initialization
  // --------------------------------------------------------------------------

  /**
   * Initialize the optimizer
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      const appConfig = getConfig();
      const atlasDir = path.dirname(appConfig.logDir);
      this.dataDir = path.join(atlasDir, 'gepa', 'optimizer');

      // Create directories
      await fs.mkdir(path.join(this.dataDir, 'proposals'), { recursive: true });
      await fs.mkdir(path.join(this.dataDir, 'applied'), { recursive: true });
      await fs.mkdir(path.join(this.dataDir, 'reports'), { recursive: true });
      await fs.mkdir(path.join(this.dataDir, 'rollbacks'), { recursive: true });

      // Load existing proposals and applied optimizations
      await this.loadState();

      this.initialized = true;
      logger.info('GEPA Optimizer initialized', { dataDir: this.dataDir });
    } catch (error) {
      logger.error('Failed to initialize GEPA Optimizer:', error);
      throw error;
    }
  }

  // --------------------------------------------------------------------------
  // Analysis
  // --------------------------------------------------------------------------

  /**
   * Analyze recent performance and identify optimization opportunities
   */
  async analyzePerformance(days: number = 7): Promise<{
    metrics: PeriodMetrics;
    patterns: Array<{
      pattern: string;
      type: string;
      failureRate: number;
      examples: Interaction[];
    }>;
    opportunities: string[];
  }> {
    const evalFramework = getEvaluationFramework();

    // Get period metrics
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);
    const metrics = await evalFramework.computeMetrics(startDate, endDate);

    // Load interactions for pattern analysis
    const interactions = await evalFramework.loadInteractions(startDate, endDate);

    // Find problematic patterns
    const patterns = evalFramework.findProblematicPatterns(interactions);

    // Identify optimization opportunities
    const opportunities: string[] = [];

    // High correction rate = communication style issues
    if (metrics.correctionRate > 0.1) {
      opportunities.push('Response style optimization - high correction rate detected');
    }

    // High failure rate on specific tools
    for (const [tool, stats] of Object.entries(metrics.toolBreakdown)) {
      if (stats.successRate < 0.7 && stats.count >= 5) {
        opportunities.push(
          `Tool reliability: ${tool} has ${((1 - stats.successRate) * 100).toFixed(0)}% failure rate`
        );
      }
    }

    // Low success rate on specific intents
    for (const [intent, stats] of Object.entries(metrics.intentBreakdown)) {
      if (stats.successRate < 0.7 && stats.count >= 5) {
        opportunities.push(
          `Intent handling: ${intent} has ${((1 - stats.successRate) * 100).toFixed(0)}% failure rate`
        );
      }
    }

    // High latency
    if (metrics.avgLatencyMs > 3000) {
      opportunities.push('Performance optimization - average latency exceeds target');
    }

    // Low satisfaction score
    if (metrics.satisfactionScore < 0.6) {
      opportunities.push('User satisfaction below target - review interaction patterns');
    }

    return { metrics, patterns, opportunities };
  }

  // --------------------------------------------------------------------------
  // Proposal Generation
  // --------------------------------------------------------------------------

  /**
   * Generate optimization proposals based on analysis
   */
  async generateProposals(): Promise<OptimizationProposal[]> {
    const analysis = await this.analyzePerformance();
    const proposals: OptimizationProposal[] = [];

    // Generate proposals for each opportunity
    for (const opportunity of analysis.opportunities) {
      const proposal = await this.createProposalForOpportunity(opportunity, analysis);
      if (proposal) {
        proposals.push(proposal);
        this.proposals.set(proposal.id, proposal);
        await this.saveProposal(proposal);
      }
    }

    // Generate proposals for patterns
    for (const pattern of analysis.patterns) {
      const proposal = await this.createProposalForPattern(pattern);
      if (proposal) {
        proposals.push(proposal);
        this.proposals.set(proposal.id, proposal);
        await this.saveProposal(proposal);
      }
    }

    logger.info('Generated optimization proposals', { count: proposals.length });
    this.emit('proposals:generated', proposals);

    return proposals;
  }

  /**
   * Create a proposal for an opportunity
   */
  private async createProposalForOpportunity(
    opportunity: string,
    analysis: Awaited<ReturnType<typeof this.analyzePerformance>>
  ): Promise<OptimizationProposal | null> {
    const id = `prop_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    // Determine target and create proposal based on opportunity type
    if (opportunity.includes('Response style')) {
      return {
        id,
        target: 'response_style',
        title: 'Improve Response Style',
        description: 'High correction rate indicates responses may not match user expectations',
        priority: 'high',
        confidence: 0.7,
        expectedImprovement: 15,
        evidence: [
          `Correction rate: ${(analysis.metrics.correctionRate * 100).toFixed(1)}%`,
          `Satisfaction score: ${(analysis.metrics.satisfactionScore * 100).toFixed(1)}%`,
        ],
        suggestedChange: 'Adjust system prompt to be more concise and direct',
        rollbackPlan: 'Restore previous system prompt from backup',
        createdAt: new Date(),
        status: 'proposed',
      };
    }

    if (opportunity.includes('Tool reliability')) {
      const toolMatch = opportunity.match(/Tool reliability: (\w+)/);
      const tool = toolMatch ? toolMatch[1] : 'unknown';
      return {
        id,
        target: 'tool_selection',
        title: `Improve ${tool} Tool Reliability`,
        description: `The ${tool} tool has a high failure rate`,
        priority: 'high',
        confidence: 0.8,
        expectedImprovement: 20,
        evidence: [opportunity],
        suggestedChange: `Add pre-execution validation for ${tool} tool`,
        rollbackPlan: 'Remove validation checks',
        createdAt: new Date(),
        status: 'proposed',
      };
    }

    if (opportunity.includes('Performance optimization')) {
      return {
        id,
        target: 'context_building',
        title: 'Reduce Response Latency',
        description: 'Average latency exceeds target threshold',
        priority: 'medium',
        confidence: 0.6,
        expectedImprovement: 25,
        evidence: [`Average latency: ${analysis.metrics.avgLatencyMs.toFixed(0)}ms`],
        suggestedChange: 'Optimize context retrieval and reduce prompt length',
        rollbackPlan: 'Restore previous context building configuration',
        createdAt: new Date(),
        status: 'proposed',
      };
    }

    return null;
  }

  /**
   * Create a proposal for a problematic pattern
   */
  private async createProposalForPattern(pattern: {
    pattern: string;
    type: string;
    failureRate: number;
    examples: Interaction[];
  }): Promise<OptimizationProposal | null> {
    const id = `prop_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    if (pattern.type === 'intent') {
      return {
        id,
        target: 'system_prompt',
        title: `Improve Handling of "${pattern.pattern}" Intent`,
        description: `The "${pattern.pattern}" intent has a ${(pattern.failureRate * 100).toFixed(0)}% failure rate`,
        priority: pattern.failureRate > 0.5 ? 'critical' : 'high',
        confidence: 0.75,
        expectedImprovement: pattern.failureRate * 50,
        evidence: pattern.examples.slice(0, 3).map((e) => `Failed: "${e.userInput}"`),
        suggestedChange: `Add specific instructions for handling ${pattern.pattern} requests`,
        rollbackPlan: 'Remove added instructions',
        createdAt: new Date(),
        status: 'proposed',
      };
    }

    if (pattern.type === 'tool') {
      return {
        id,
        target: 'tool_selection',
        title: `Fix ${pattern.pattern} Tool Issues`,
        description: `The ${pattern.pattern} tool fails frequently`,
        priority: 'high',
        confidence: 0.8,
        expectedImprovement: pattern.failureRate * 60,
        evidence: pattern.examples.slice(0, 3).map((e) => `Error: ${e.errorMessage || 'Unknown'}`),
        suggestedChange: `Improve error handling and input validation for ${pattern.pattern}`,
        rollbackPlan: 'Restore previous tool implementation',
        createdAt: new Date(),
        status: 'proposed',
      };
    }

    return null;
  }

  // --------------------------------------------------------------------------
  // Optimization Application
  // --------------------------------------------------------------------------

  /**
   * Apply an optimization proposal
   */
  async applyOptimization(proposalId: string): Promise<AppliedOptimization | null> {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) {
      logger.warn('Proposal not found', { proposalId });
      return null;
    }

    if (proposal.status !== 'proposed' && proposal.status !== 'approved') {
      logger.warn('Proposal cannot be applied', { proposalId, status: proposal.status });
      return null;
    }

    // Get current value before applying
    const originalValue = await this.getCurrentValue(proposal.target);

    // Apply the optimization
    const newValue = await this.applyChange(proposal);

    // Create applied record
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _metricsCollector = getMetricsCollector();
    const applied: AppliedOptimization = {
      id: `applied_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      proposalId: proposal.id,
      target: proposal.target,
      appliedAt: new Date(),
      originalValue,
      newValue,
      metricsBeforeId: `metrics_${Date.now()}`,
      status: 'pending_validation',
    };

    // Update proposal status
    proposal.status = 'applied';
    await this.saveProposal(proposal);

    // Save applied optimization
    this.appliedOptimizations.set(applied.id, applied);
    await this.saveApplied(applied);

    logger.info('Optimization applied', {
      proposalId,
      target: proposal.target,
      appliedId: applied.id,
    });

    this.emit('optimization:applied', applied);

    return applied;
  }

  /**
   * Get current value for an optimization target
   */
  private async getCurrentValue(target: OptimizationTarget): Promise<string> {
    const configPath = path.join(this.dataDir, 'config', `${target}.json`);
    try {
      return await fs.readFile(configPath, 'utf-8');
    } catch {
      return '{}';
    }
  }

  /**
   * Apply a change for a proposal
   */
  private async applyChange(proposal: OptimizationProposal): Promise<string> {
    const configDir = path.join(this.dataDir, 'config');
    await fs.mkdir(configDir, { recursive: true });

    const configPath = path.join(configDir, `${proposal.target}.json`);
    const config = {
      updatedAt: new Date().toISOString(),
      proposal: proposal.title,
      change: proposal.suggestedChange,
    };

    const configStr = JSON.stringify(config, null, 2);
    await fs.writeFile(configPath, configStr, 'utf-8');

    return configStr;
  }

  /**
   * Run DSPy optimization for prompts
   */
  async runDSPyOptimization(target: OptimizationTarget): Promise<OptimizationResult | null> {
    const dspyBridge = getDSPyBridge();
    await dspyBridge.initialize();

    const signature = dspyBridge.createSignature({
      name: target,
      description: `Optimize ${target} for better performance`,
      inputs: [
        { name: 'context', desc: 'Current context and user request' },
        { name: 'history', desc: 'Recent conversation history' },
      ],
      outputs: [{ name: 'response', desc: 'Optimized response' }],
    });

    const config: DSPyModuleConfig = {
      signature,
      optimizer: 'bootstrap',
      metric: 'semantic_similarity',
      numTrials: 10,
    };

    return dspyBridge.optimize(config);
  }

  // --------------------------------------------------------------------------
  // Rollback
  // --------------------------------------------------------------------------

  /**
   * Rollback an applied optimization
   */
  async rollback(appliedId: string, reason: string): Promise<boolean> {
    const applied = this.appliedOptimizations.get(appliedId);
    if (!applied) {
      logger.warn('Applied optimization not found', { appliedId });
      return false;
    }

    // Restore original value
    const configPath = path.join(this.dataDir, 'config', `${applied.target}.json`);
    await fs.writeFile(configPath, applied.originalValue, 'utf-8');

    // Save rollback record
    const rollbackPath = path.join(this.dataDir, 'rollbacks', `${appliedId}_${Date.now()}.json`);
    await fs.writeFile(
      rollbackPath,
      JSON.stringify({ applied, reason, rolledBackAt: new Date() }, null, 2),
      'utf-8'
    );

    // Update applied status
    applied.status = 'rolled_back';
    await this.saveApplied(applied);

    // Update proposal status
    const proposal = this.proposals.get(applied.proposalId);
    if (proposal) {
      proposal.status = 'rolled_back';
      await this.saveProposal(proposal);
    }

    logger.info('Optimization rolled back', { appliedId, reason });
    this.emit('optimization:rolledback', { appliedId, reason });

    return true;
  }

  /**
   * Validate applied optimizations and rollback if degraded
   */
  async validateAppliedOptimizations(): Promise<void> {
    const evalFramework = getEvaluationFramework();

    for (const [id, applied] of this.appliedOptimizations) {
      if (applied.status !== 'pending_validation') continue;

      // Check if enough time has passed
      const hoursSinceApplied = (Date.now() - applied.appliedAt.getTime()) / (1000 * 60 * 60);
      if (hoursSinceApplied < this.config.validationPeriodHours) continue;

      // Get metrics after application
      const startDate = applied.appliedAt;
      const endDate = new Date();
      const metricsAfter = await evalFramework.computeMetrics(startDate, endDate);

      // Get metrics before application (approximate)
      const beforeStart = new Date(
        startDate.getTime() - this.config.validationPeriodHours * 60 * 60 * 1000
      );
      const metricsBefore = await evalFramework.computeMetrics(beforeStart, startDate);

      // Compare success rates
      const successRateDelta = metricsAfter.successRate - metricsBefore.successRate;

      if (successRateDelta < -this.config.rollbackThreshold) {
        // Performance degraded - rollback
        await this.rollback(
          id,
          `Performance degraded by ${(Math.abs(successRateDelta) * 100).toFixed(1)}%`
        );
      } else {
        // Validated successfully
        applied.status = 'validated';
        applied.metricsAfterId = `metrics_${Date.now()}`;
        applied.improvementActual = successRateDelta * 100;
        await this.saveApplied(applied);

        logger.info('Optimization validated', {
          id,
          improvement: `${(successRateDelta * 100).toFixed(1)}%`,
        });
      }
    }
  }

  // --------------------------------------------------------------------------
  // Reporting
  // --------------------------------------------------------------------------

  /**
   * Generate an optimization report
   */
  async generateReport(): Promise<OptimizationReport> {
    const evalFramework = getEvaluationFramework();
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);

    // Get current and previous period metrics
    const currentMetrics = await evalFramework.computeMetrics(dayAgo, now);
    const previousMetrics = await evalFramework.computeMetrics(twoDaysAgo, dayAgo);

    // Analyze patterns
    const analysis = await this.analyzePerformance(1);

    // Count proposals
    const proposalsArray = Array.from(this.proposals.values());
    const recentProposals = proposalsArray.filter((p) => p.createdAt.getTime() > dayAgo.getTime());

    // Count applied
    const appliedArray = Array.from(this.appliedOptimizations.values());
    const recentApplied = appliedArray.filter((a) => a.appliedAt.getTime() > dayAgo.getTime());

    // Count rollbacks
    const rollbacks = appliedArray.filter(
      (a) => a.status === 'rolled_back' && a.appliedAt.getTime() > dayAgo.getTime()
    );

    const report: OptimizationReport = {
      id: `report_${Date.now()}`,
      generatedAt: now,
      periodStart: dayAgo,
      periodEnd: now,
      metricsAnalysis: {
        successRate: currentMetrics.successRate,
        successRateChange: currentMetrics.successRate - previousMetrics.successRate,
        avgLatency: currentMetrics.avgLatencyMs,
        latencyChange: currentMetrics.avgLatencyMs - previousMetrics.avgLatencyMs,
        correctionRate: currentMetrics.correctionRate,
        correctionRateChange: currentMetrics.correctionRate - previousMetrics.correctionRate,
      },
      patterns: analysis.patterns.map((p) => ({
        type: p.type,
        description: p.pattern,
        frequency: p.failureRate,
      })),
      proposalsGenerated: recentProposals.length,
      proposalsApplied: recentApplied.length,
      improvements: recentApplied
        .filter((a) => a.status === 'validated')
        .map((a) => ({
          target: a.target,
          description: this.proposals.get(a.proposalId)?.title || 'Unknown',
          improvement: a.improvementActual || 0,
        })),
      rollbacks: rollbacks.map((r) => ({
        target: r.target,
        reason: 'Performance degradation',
      })),
      nextSteps: analysis.opportunities,
    };

    // Save report
    const reportPath = path.join(this.dataDir, 'reports', `${report.id}.json`);
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf-8');

    logger.info('Optimization report generated', { id: report.id });
    this.emit('report:generated', report);

    return report;
  }

  // --------------------------------------------------------------------------
  // Persistence
  // --------------------------------------------------------------------------

  private async saveProposal(proposal: OptimizationProposal): Promise<void> {
    const filePath = path.join(this.dataDir, 'proposals', `${proposal.id}.json`);
    await fs.writeFile(filePath, JSON.stringify(proposal, null, 2), 'utf-8');
  }

  private async saveApplied(applied: AppliedOptimization): Promise<void> {
    const filePath = path.join(this.dataDir, 'applied', `${applied.id}.json`);
    await fs.writeFile(filePath, JSON.stringify(applied, null, 2), 'utf-8');
  }

  private async loadState(): Promise<void> {
    // Load proposals
    try {
      const proposalFiles = await fs.readdir(path.join(this.dataDir, 'proposals'));
      for (const file of proposalFiles) {
        if (file.endsWith('.json')) {
          const content = await fs.readFile(path.join(this.dataDir, 'proposals', file), 'utf-8');
          const proposal = JSON.parse(content) as OptimizationProposal;
          proposal.createdAt = new Date(proposal.createdAt);
          this.proposals.set(proposal.id, proposal);
        }
      }
    } catch {
      // Directory doesn't exist yet
    }

    // Load applied
    try {
      const appliedFiles = await fs.readdir(path.join(this.dataDir, 'applied'));
      for (const file of appliedFiles) {
        if (file.endsWith('.json')) {
          const content = await fs.readFile(path.join(this.dataDir, 'applied', file), 'utf-8');
          const applied = JSON.parse(content) as AppliedOptimization;
          applied.appliedAt = new Date(applied.appliedAt);
          this.appliedOptimizations.set(applied.id, applied);
        }
      }
    } catch {
      // Directory doesn't exist yet
    }

    logger.debug('Loaded GEPA state', {
      proposals: this.proposals.size,
      applied: this.appliedOptimizations.size,
    });
  }

  // --------------------------------------------------------------------------
  // Getters
  // --------------------------------------------------------------------------

  getProposals(): OptimizationProposal[] {
    return Array.from(this.proposals.values());
  }

  getAppliedOptimizations(): AppliedOptimization[] {
    return Array.from(this.appliedOptimizations.values());
  }

  getPendingProposals(): OptimizationProposal[] {
    return Array.from(this.proposals.values()).filter((p) => p.status === 'proposed');
  }

  // --------------------------------------------------------------------------
  // Cleanup
  // --------------------------------------------------------------------------

  async cleanup(): Promise<void> {
    this.proposals.clear();
    this.appliedOptimizations.clear();
    this.initialized = false;
    logger.info('GEPA Optimizer cleaned up');
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

let optimizerInstance: GEPAOptimizer | null = null;

export function getGEPAOptimizer(): GEPAOptimizer {
  if (!optimizerInstance) {
    optimizerInstance = new GEPAOptimizer();
  }
  return optimizerInstance;
}

export default GEPAOptimizer;
