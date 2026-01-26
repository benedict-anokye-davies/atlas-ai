/**
 * GEPA - Generate, Evaluate, Propose, Apply
 *
 * Atlas's self-improvement system.
 *
 * Components:
 * - EvaluationFramework: Tracks interactions and outcomes
 * - MetricsCollector: Collects performance metrics
 * - DSPyBridge: Integrates with DSPy for prompt optimization
 * - GEPAOptimizer: Analyzes and proposes improvements
 * - OptimizationScheduler: Schedules nightly optimization runs
 * - ChangeReporter: Reports changes to the user
 * - RollbackManager: Manages safe rollback of changes
 * - SelfModificationManager: Allows safe code self-modification
 * - ABTestManager: A/B testing for optimizations
 *
 * Note: This file uses inline require() to avoid circular dependencies
 * between GEPA components. This is an intentional pattern.
 */

/* eslint-disable @typescript-eslint/no-var-requires */

// Evaluation Framework
export {
  EvaluationFramework,
  getEvaluationFramework,
  type Interaction,
  type InteractionOutcome,
  type SatisfactionSignal,
  type PeriodMetrics,
  type EvalEvents,
} from './eval-framework';

// Metrics Collector
export {
  MetricsCollector,
  getMetricsCollector,
  type MetricType,
  type MetricDataPoint,
  type AggregatedMetric,
  type HealthSnapshot,
  type PerformanceReport,
  type PerformanceAlert,
  type MetricThresholds,
} from './metrics-collector';

// DSPy Integration
export {
  DSPyBridge,
  getDSPyBridge,
  type DSPySignature,
  type TrainingExample,
  type OptimizationResult,
  type DSPyModuleConfig,
  type DSPyEvents,
} from './dspy-integration';

// GEPA Optimizer
export {
  GEPAOptimizer,
  getGEPAOptimizer,
  type OptimizationTarget,
  type OptimizationProposal,
  type AppliedOptimization,
  type OptimizationReport,
  type GEPAConfig,
} from './optimizer';

// Optimization Scheduler
export {
  OptimizationScheduler,
  getOptimizationScheduler,
  type JobType,
  type ScheduledJob,
  type JobResult,
  type SchedulerConfig,
} from './scheduler';

// Change Reporter
export {
  ChangeReporter,
  getChangeReporter,
  type ChangeSummary,
  type DailyDigest,
  type ChangeNotification,
} from './change-reporter';

// Rollback Manager
export {
  RollbackManager,
  getRollbackManager,
  type ConfigSnapshot,
  type RollbackRecord,
  type RollbackOptions,
} from './rollback-manager';

// Self-Modification Manager
export {
  SelfModificationManager,
  getSelfModificationManager,
  type ModificationType,
  type ModificationRequest,
  type AppliedModification as AppliedCodeModification,
  type SelfModConfig,
} from './self-modification';

// A/B Testing
export {
  ABTestManager,
  getABTestManager,
  type ABTest,
  type TestVariant,
  type TestAssignment,
  type VariantMetrics,
  type TestResults,
} from './ab-testing';

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Initialize all GEPA components
 */
export async function initializeGEPA(): Promise<void> {
  const { getEvaluationFramework } = await import('./eval-framework');
  const { getMetricsCollector } = await import('./metrics-collector');
  const { getDSPyBridge } = await import('./dspy-integration');
  const { getGEPAOptimizer } = await import('./optimizer');
  const { getOptimizationScheduler } = await import('./scheduler');
  const { getChangeReporter } = await import('./change-reporter');
  const { getRollbackManager } = await import('./rollback-manager');
  const { getSelfModificationManager } = await import('./self-modification');
  const { getABTestManager } = await import('./ab-testing');

  // Initialize core components
  await getEvaluationFramework().initialize();
  await getMetricsCollector().initialize();
  await getGEPAOptimizer().initialize();
  await getRollbackManager().initialize();
  await getChangeReporter().initialize();
  await getABTestManager().initialize();

  // Initialize optional components
  try {
    await getDSPyBridge().initialize();
  } catch {
    // DSPy is optional
  }

  try {
    await getSelfModificationManager().initialize();
  } catch {
    // Self-mod is optional
  }

  // Start scheduler
  const scheduler = getOptimizationScheduler();
  await scheduler.initialize();
  scheduler.start();
}

/**
 * Cleanup all GEPA components
 */
export async function cleanupGEPA(): Promise<void> {
  const { getEvaluationFramework } = await import('./eval-framework');
  const { getMetricsCollector } = await import('./metrics-collector');
  const { getDSPyBridge } = await import('./dspy-integration');
  const { getGEPAOptimizer } = await import('./optimizer');
  const { getOptimizationScheduler } = await import('./scheduler');
  const { getChangeReporter } = await import('./change-reporter');
  const { getRollbackManager } = await import('./rollback-manager');
  const { getSelfModificationManager } = await import('./self-modification');
  const { getABTestManager } = await import('./ab-testing');

  await getOptimizationScheduler().cleanup();
  await getABTestManager().cleanup();
  await getSelfModificationManager().cleanup();
  await getRollbackManager().cleanup();
  await getChangeReporter().cleanup();
  await getGEPAOptimizer().cleanup();
  await getDSPyBridge().cleanup();
  await getMetricsCollector().cleanup();
  await getEvaluationFramework().cleanup();
}

/**
 * Record an interaction for evaluation
 */
export function recordInteraction(data: {
  userInput: string;
  assistantResponse: string;
  intent?: string;
  toolsUsed?: string[];
  latencyMs?: number;
  success?: boolean;
}): string {
  // Import inline to avoid circular dependency issues
  const { getEvaluationFramework: getEval } = require('./eval-framework');
  const evalFramework = getEval();

  const interaction = evalFramework.recordInteraction({
    userInput: data.userInput,
    assistantResponse: data.assistantResponse,
    intent: data.intent,
    toolsUsed: data.toolsUsed,
    latencyMs: data.latencyMs,
    outcome: data.success === undefined ? 'unknown' : data.success ? 'success' : 'failure',
    satisfactionSignals: [],
  });

  return interaction.id;
}

/**
 * Mark an interaction outcome
 */
export function markInteractionOutcome(
  interactionId: string,
  outcome: 'success' | 'failure' | 'correction',
  details?: { correction?: string; error?: string }
): void {
  // Import inline to avoid circular dependency issues
  const { getEvaluationFramework: getEval } = require('./eval-framework');
  const evalFramework = getEval();

  if (outcome === 'success') {
    evalFramework.markSuccess(interactionId);
  } else if (outcome === 'failure') {
    evalFramework.markFailure(interactionId, details?.error);
  } else if (outcome === 'correction') {
    evalFramework.markCorrected(interactionId, details?.correction || '');
  }
}

/**
 * Get current performance summary
 */
export async function getPerformanceSummary(): Promise<{
  successRate: number;
  avgLatency: number;
  satisfactionScore: number;
  pendingProposals: number;
  recentAlerts: number;
}> {
  // Import inline to avoid circular dependency issues
  const { getEvaluationFramework: getEval } = require('./eval-framework');
  const { getMetricsCollector: getMetrics } = require('./metrics-collector');
  const { getGEPAOptimizer: getOptim } = require('./optimizer');

  const evalFramework = getEval();
  const metricsCollector = getMetrics();
  const optimizer = getOptim();

  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const metrics = await evalFramework.computeMetrics(dayAgo, now);
  const alerts = metricsCollector.getRecentAlerts(100);
  const pendingProposals = optimizer.getPendingProposals();

  return {
    successRate: metrics.successRate,
    avgLatency: metrics.avgLatencyMs,
    satisfactionScore: metrics.satisfactionScore,
    pendingProposals: pendingProposals.length,
    recentAlerts: alerts.filter((a: { timestamp: Date }) => a.timestamp > dayAgo).length,
  };
}

// ============================================================================
// IPC Handler Support Functions
// ============================================================================

/**
 * Get GEPA system status
 */
export async function getGEPAStatus(): Promise<{
  initialized: boolean;
  schedulerRunning: boolean;
  lastOptimization: Date | null;
  nextScheduledRun: Date | null;
  pendingProposals: number;
  activeABTests: number;
}> {
  const { getOptimizationScheduler: getSched } = require('./scheduler');
  const { getGEPAOptimizer: getOptim } = require('./optimizer');
  const { getABTestManager: getAB } = require('./ab-testing');

  const scheduler = getSched();
  const optimizer = getOptim();
  const abManager = getAB();

  const pendingProposals = optimizer.getPendingProposals();
  const activeTests = abManager.getActiveTests();
  const schedulerStatus = scheduler.getStatus();

  return {
    initialized: true,
    schedulerRunning: schedulerStatus.running,
    lastOptimization: schedulerStatus.lastRun,
    nextScheduledRun: schedulerStatus.nextRun,
    pendingProposals: pendingProposals.length,
    activeABTests: activeTests.length,
  };
}

/**
 * Get optimization history
 */
export async function getOptimizationHistory(): Promise<
  Array<{
    id: string;
    date: Date;
    target: string;
    description: string;
    status: string;
    improvement: number | null;
  }>
> {
  const { getGEPAOptimizer: getOptim } = require('./optimizer');
  const optimizer = getOptim();
  const history = optimizer.getOptimizationHistory();

  return history.map(
    (h: {
      id: string;
      appliedAt: Date;
      proposal: { target: string; description: string };
      status: string;
      measuredImprovement?: number;
    }) => ({
      id: h.id,
      date: h.appliedAt,
      target: h.proposal.target,
      description: h.proposal.description,
      status: h.status,
      improvement: h.measuredImprovement ?? null,
    })
  );
}

/**
 * Run optimization manually
 */
export async function runOptimization(): Promise<{
  proposalsGenerated: number;
  proposalsApplied: number;
  targets: string[];
}> {
  const { getGEPAOptimizer: getOptim } = require('./optimizer');
  const optimizer = getOptim();

  const proposals = await optimizer.generateProposals();
  let applied = 0;
  const targets: string[] = [];

  for (const proposal of proposals) {
    const result = await optimizer.applyProposal(proposal.id);
    if (result.success) {
      applied++;
      targets.push(proposal.target);
    }
  }

  return {
    proposalsGenerated: proposals.length,
    proposalsApplied: applied,
    targets,
  };
}

/**
 * Get metrics summary for the past 24 hours
 */
export async function getMetricsSummary(): Promise<{
  successRate: number;
  avgLatency: number;
  satisfactionScore: number;
  totalInteractions: number;
  corrections: number;
  failures: number;
}> {
  const { getEvaluationFramework: getEval } = require('./eval-framework');
  const evalFramework = getEval();

  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const metrics = await evalFramework.computeMetrics(dayAgo, now);

  return {
    successRate: metrics.successRate,
    avgLatency: metrics.avgLatencyMs,
    satisfactionScore: metrics.satisfactionScore,
    totalInteractions: metrics.totalInteractions,
    corrections: metrics.correctionCount,
    failures: metrics.failureCount,
  };
}

/**
 * Get all A/B tests
 */
export async function getABTests(): Promise<
  Array<{
    id: string;
    name: string;
    status: string;
    targetMetric: string;
    variants: Array<{ name: string; sampleSize: number }>;
    winner: string | null;
  }>
> {
  const { getABTestManager: getAB } = require('./ab-testing');
  const abManager = getAB();
  const tests = abManager.getAllTests();

  return tests.map(
    (t: {
      id: string;
      name: string;
      status: string;
      targetMetric: string;
      variants: Array<{ name: string }>;
      results?: { winner?: string };
    }) => ({
      id: t.id,
      name: t.name,
      status: t.status,
      targetMetric: t.targetMetric,
      variants: t.variants.map((v: { name: string }) => ({
        name: v.name,
        sampleSize: abManager.getVariantSampleSize(t.id, v.name) ?? 0,
      })),
      winner: t.results?.winner ?? null,
    })
  );
}

/**
 * Create a new A/B test
 */
export async function createABTest(config: {
  name: string;
  targetMetric: string;
  variants: Array<{ name: string; config: Record<string, unknown> }>;
}): Promise<{ id: string; name: string }> {
  const { getABTestManager: getAB } = require('./ab-testing');
  const abManager = getAB();

  const test = await abManager.createTest({
    name: config.name,
    targetMetric: config.targetMetric,
    variants: config.variants,
  });

  return { id: test.id, name: test.name };
}

/**
 * Get rollback points
 */
export async function getRollbackPoints(): Promise<
  Array<{
    id: string;
    createdAt: Date;
    reason: string;
    size: number;
  }>
> {
  const { getRollbackManager: getRollback } = require('./rollback-manager');
  const rollbackManager = getRollback();
  const snapshots = rollbackManager.listSnapshots();

  return snapshots.map((s: { id: string; createdAt: Date; reason: string; size: number }) => ({
    id: s.id,
    createdAt: s.createdAt,
    reason: s.reason,
    size: s.size,
  }));
}

/**
 * Rollback to a snapshot
 */
export async function rollbackToSnapshot(snapshotId: string): Promise<void> {
  const { getRollbackManager: getRollback } = require('./rollback-manager');
  const rollbackManager = getRollback();
  await rollbackManager.rollback(snapshotId);
}

/**
 * Get change reports
 */
export async function getChangeReports(): Promise<
  Array<{
    id: string;
    timestamp: Date;
    type: string;
    summary: string;
    details: string;
  }>
> {
  const { getChangeReporter: getReporter } = require('./change-reporter');
  const reporter = getReporter();
  const reports = reporter.getRecentReports(50);

  return reports.map(
    (r: { id: string; timestamp: Date; type: string; summary: string; details?: string }) => ({
      id: r.id,
      timestamp: r.timestamp,
      type: r.type,
      summary: r.summary,
      details: r.details ?? '',
    })
  );
}

/**
 * Get daily digest
 */
export async function getDailyDigest(): Promise<{
  date: Date;
  optimizationsApplied: number;
  testsCompleted: number;
  successRateChange: number;
  highlights: string[];
}> {
  const { getChangeReporter: getReporter } = require('./change-reporter');
  const reporter = getReporter();
  const digest = await reporter.generateDailyDigest();

  return {
    date: digest.date,
    optimizationsApplied: digest.optimizationsApplied,
    testsCompleted: digest.testsCompleted,
    successRateChange: digest.successRateChange,
    highlights: digest.highlights,
  };
}

/**
 * Get pending code modifications
 */
export async function getPendingModifications(): Promise<
  Array<{
    id: string;
    type: string;
    filePath: string;
    description: string;
    risk: string;
    createdAt: Date;
  }>
> {
  const { getSelfModificationManager: getSelfMod } = require('./self-modification');
  const selfMod = getSelfMod();
  const pending = selfMod.getPendingModifications();

  return pending.map(
    (m: {
      id: string;
      type: string;
      filePath: string;
      description: string;
      risk: string;
      createdAt: Date;
    }) => ({
      id: m.id,
      type: m.type,
      filePath: m.filePath,
      description: m.description,
      risk: m.risk,
      createdAt: m.createdAt,
    })
  );
}

/**
 * Approve a pending modification
 */
export async function approveModification(modificationId: string): Promise<void> {
  const { getSelfModificationManager: getSelfMod } = require('./self-modification');
  const selfMod = getSelfMod();
  await selfMod.approveModification(modificationId);
}

/**
 * Reject a pending modification
 */
export async function rejectModification(modificationId: string, reason?: string): Promise<void> {
  const { getSelfModificationManager: getSelfMod } = require('./self-modification');
  const selfMod = getSelfMod();
  await selfMod.rejectModification(modificationId, reason);
}

/**
 * Set optimization schedule
 */
export async function setOptimizationSchedule(config: {
  enabled: boolean;
  hour?: number;
  minute?: number;
}): Promise<void> {
  const { getOptimizationScheduler: getSched } = require('./scheduler');
  const scheduler = getSched();

  if (config.enabled) {
    scheduler.start();
    if (config.hour !== undefined || config.minute !== undefined) {
      scheduler.setSchedule({
        hour: config.hour ?? 2,
        minute: config.minute ?? 0,
      });
    }
  } else {
    scheduler.stop();
  }
}
