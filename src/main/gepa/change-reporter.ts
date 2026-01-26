/**
 * GEPA Change Reporting
 *
 * Reports all optimizations and changes to the user.
 * Generates human-readable summaries of what changed and why.
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import * as fs from 'fs/promises';
import * as path from 'path';
import { getConfig } from '../config';
import { isoDate } from '../../shared/utils';
import {
  getGEPAOptimizer,
  OptimizationProposal,
  AppliedOptimization,
  OptimizationReport,
} from './optimizer';

const logger = createModuleLogger('GEPA-Reporter');

// ============================================================================
// Types
// ============================================================================

/**
 * User-friendly change summary
 */
export interface ChangeSummary {
  id: string;
  timestamp: Date;
  type: 'optimization' | 'rollback' | 'proposal' | 'validation';
  title: string;
  description: string;
  impact: 'positive' | 'neutral' | 'negative';
  details: string[];
  actionRequired: boolean;
  actionPrompt?: string;
}

/**
 * Daily digest for the user
 */
export interface DailyDigest {
  date: Date;
  summary: string;
  performanceChange: {
    direction: 'improved' | 'stable' | 'degraded';
    percentage: number;
  };
  changes: ChangeSummary[];
  pendingApprovals: OptimizationProposal[];
  recommendations: string[];
}

/**
 * Notification for real-time updates
 */
export interface ChangeNotification {
  id: string;
  timestamp: Date;
  priority: 'high' | 'medium' | 'low';
  title: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  actionUrl?: string;
}

// ============================================================================
// Change Reporter
// ============================================================================

export class ChangeReporter extends EventEmitter {
  private dataDir: string;
  private notifications: ChangeNotification[] = [];
  private initialized = false;

  // Maximum notifications in memory
  private readonly MAX_NOTIFICATIONS = 100;

  constructor() {
    super();
    this.setMaxListeners(20);
    this.dataDir = '';
  }

  // --------------------------------------------------------------------------
  // Initialization
  // --------------------------------------------------------------------------

  /**
   * Initialize the reporter
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      const appConfig = getConfig();
      const atlasDir = path.dirname(appConfig.logDir);
      this.dataDir = path.join(atlasDir, 'gepa', 'reports');

      await fs.mkdir(path.join(this.dataDir, 'digests'), { recursive: true });
      await fs.mkdir(path.join(this.dataDir, 'notifications'), { recursive: true });

      // Subscribe to optimizer events
      this.subscribeToOptimizer();

      this.initialized = true;
      logger.info('Change reporter initialized');
    } catch (error) {
      logger.error('Failed to initialize change reporter:', error);
      throw error;
    }
  }

  /**
   * Subscribe to optimizer events
   */
  private subscribeToOptimizer(): void {
    const optimizer = getGEPAOptimizer();

    optimizer.on('proposals:generated', (proposals: OptimizationProposal[]) => {
      if (proposals.length > 0) {
        this.notifyProposalsGenerated(proposals);
      }
    });

    optimizer.on('optimization:applied', (applied: AppliedOptimization) => {
      this.notifyOptimizationApplied(applied);
    });

    optimizer.on('optimization:rolledback', (data: { appliedId: string; reason: string }) => {
      this.notifyRollback(data.appliedId, data.reason);
    });

    optimizer.on('report:generated', (report: OptimizationReport) => {
      this.notifyReportGenerated(report);
    });
  }

  // --------------------------------------------------------------------------
  // Notifications
  // --------------------------------------------------------------------------

  /**
   * Notify about new proposals
   */
  private notifyProposalsGenerated(proposals: OptimizationProposal[]): void {
    const highPriority = proposals.filter(
      (p) => p.priority === 'critical' || p.priority === 'high'
    );

    const notification: ChangeNotification = {
      id: `notif_${Date.now()}`,
      timestamp: new Date(),
      priority: highPriority.length > 0 ? 'high' : 'medium',
      title: 'New Optimization Proposals',
      message: `${proposals.length} new improvement${proposals.length > 1 ? 's' : ''} identified. ${highPriority.length} require attention.`,
      type: 'info',
      actionUrl: 'atlas://gepa/proposals',
    };

    this.addNotification(notification);
  }

  /**
   * Notify about applied optimization
   */
  private notifyOptimizationApplied(applied: AppliedOptimization): void {
    const notification: ChangeNotification = {
      id: `notif_${Date.now()}`,
      timestamp: new Date(),
      priority: 'medium',
      title: 'Optimization Applied',
      message: `Improvement applied to ${applied.target}. Will be validated in 24 hours.`,
      type: 'success',
    };

    this.addNotification(notification);
  }

  /**
   * Notify about rollback
   */
  private notifyRollback(appliedId: string, reason: string): void {
    const notification: ChangeNotification = {
      id: `notif_${Date.now()}`,
      timestamp: new Date(),
      priority: 'high',
      title: 'Optimization Rolled Back',
      message: `A recent change was automatically reverted: ${reason}`,
      type: 'warning',
    };

    this.addNotification(notification);
  }

  /**
   * Notify about generated report
   */
  private notifyReportGenerated(report: OptimizationReport): void {
    const direction =
      report.metricsAnalysis.successRateChange > 0.05
        ? 'improved'
        : report.metricsAnalysis.successRateChange < -0.05
          ? 'degraded'
          : 'stable';

    const notification: ChangeNotification = {
      id: `notif_${Date.now()}`,
      timestamp: new Date(),
      priority: direction === 'degraded' ? 'high' : 'low',
      title: 'Daily Performance Report',
      message: `Performance ${direction}. Success rate: ${(report.metricsAnalysis.successRate * 100).toFixed(1)}%`,
      type: direction === 'degraded' ? 'warning' : 'info',
      actionUrl: `atlas://gepa/reports/${report.id}`,
    };

    this.addNotification(notification);
  }

  /**
   * Add a notification
   */
  private addNotification(notification: ChangeNotification): void {
    this.notifications.push(notification);

    // Trim if over limit
    while (this.notifications.length > this.MAX_NOTIFICATIONS) {
      this.notifications.shift();
    }

    // Emit for real-time updates
    this.emit('notification', notification);

    logger.debug('Notification added', { id: notification.id, title: notification.title });
  }

  /**
   * Get recent notifications
   */
  getNotifications(limit: number = 20): ChangeNotification[] {
    return this.notifications.slice(-limit);
  }

  /**
   * Get unread notifications (all are considered unread in this simple implementation)
   */
  getUnreadNotifications(): ChangeNotification[] {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    return this.notifications.filter((n) => n.timestamp > oneHourAgo);
  }

  // --------------------------------------------------------------------------
  // Change Summaries
  // --------------------------------------------------------------------------

  /**
   * Create a user-friendly summary of an applied optimization
   */
  createChangeSummary(applied: AppliedOptimization): ChangeSummary {
    const optimizer = getGEPAOptimizer();
    const proposal = optimizer.getProposals().find((p) => p.id === applied.proposalId);

    return {
      id: applied.id,
      timestamp: applied.appliedAt,
      type: 'optimization',
      title: proposal?.title || `${applied.target} Optimization`,
      description: proposal?.description || 'An optimization was applied',
      impact: applied.status === 'validated' ? 'positive' : 'neutral',
      details: [
        `Target: ${applied.target}`,
        `Applied: ${applied.appliedAt.toLocaleString()}`,
        `Status: ${applied.status}`,
        applied.improvementActual
          ? `Improvement: ${applied.improvementActual.toFixed(1)}%`
          : 'Pending validation',
      ],
      actionRequired: false,
    };
  }

  /**
   * Create a summary for a pending proposal
   */
  createProposalSummary(proposal: OptimizationProposal): ChangeSummary {
    return {
      id: proposal.id,
      timestamp: proposal.createdAt,
      type: 'proposal',
      title: proposal.title,
      description: proposal.description,
      impact: 'neutral',
      details: [
        `Priority: ${proposal.priority}`,
        `Confidence: ${(proposal.confidence * 100).toFixed(0)}%`,
        `Expected improvement: ${proposal.expectedImprovement.toFixed(0)}%`,
        ...proposal.evidence,
      ],
      actionRequired: true,
      actionPrompt: 'Review and approve or reject this proposal',
    };
  }

  // --------------------------------------------------------------------------
  // Daily Digest
  // --------------------------------------------------------------------------

  /**
   * Generate a daily digest for the user
   */
  async generateDailyDigest(date?: Date): Promise<DailyDigest> {
    const targetDate = date || new Date();
    const optimizer = getGEPAOptimizer();
    await optimizer.initialize();

    // Get today's report
    const report = await optimizer.generateReport();

    // Get all changes from today
    const changes: ChangeSummary[] = [];

    // Add applied optimizations
    const applied = optimizer.getAppliedOptimizations();
    const todayApplied = applied.filter(
      (a) => a.appliedAt.toDateString() === targetDate.toDateString()
    );
    for (const a of todayApplied) {
      changes.push(this.createChangeSummary(a));
    }

    // Get pending proposals
    const pendingProposals = optimizer.getPendingProposals();

    // Determine performance direction
    const changePercent = report.metricsAnalysis.successRateChange * 100;
    const direction: 'improved' | 'stable' | 'degraded' =
      changePercent > 5 ? 'improved' : changePercent < -5 ? 'degraded' : 'stable';

    // Generate recommendations
    const recommendations: string[] = [];
    if (pendingProposals.length > 0) {
      recommendations.push(`Review ${pendingProposals.length} pending optimization proposals`);
    }
    if (direction === 'degraded') {
      recommendations.push('Performance has declined - consider rolling back recent changes');
    }
    if (report.patterns.length > 0) {
      recommendations.push('Investigate identified failure patterns');
    }

    // Generate summary text
    let summary = `Atlas performance is ${direction}. `;
    summary += `Success rate: ${(report.metricsAnalysis.successRate * 100).toFixed(1)}% `;
    summary += `(${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(1)}% from yesterday). `;
    if (todayApplied.length > 0) {
      summary += `${todayApplied.length} optimization${todayApplied.length > 1 ? 's' : ''} applied. `;
    }
    if (pendingProposals.length > 0) {
      summary += `${pendingProposals.length} proposal${pendingProposals.length > 1 ? 's' : ''} awaiting approval.`;
    }

    const digest: DailyDigest = {
      date: targetDate,
      summary,
      performanceChange: {
        direction,
        percentage: changePercent,
      },
      changes,
      pendingApprovals: pendingProposals,
      recommendations,
    };

    // Save digest
    await this.saveDigest(digest);

    return digest;
  }

  /**
   * Save digest to disk
   */
  private async saveDigest(digest: DailyDigest): Promise<void> {
    const dateStr = isoDate(digest.date);
    const filePath = path.join(this.dataDir, 'digests', `${dateStr}.json`);
    await fs.writeFile(filePath, JSON.stringify(digest, null, 2), 'utf-8');
    logger.debug('Daily digest saved', { date: dateStr });
  }

  /**
   * Load digest for a date
   */
  async loadDigest(date: Date): Promise<DailyDigest | null> {
    const dateStr = isoDate(date);
    const filePath = path.join(this.dataDir, 'digests', `${dateStr}.json`);

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const digest = JSON.parse(content) as DailyDigest;
      digest.date = new Date(digest.date);
      return digest;
    } catch {
      return null;
    }
  }

  // --------------------------------------------------------------------------
  // Report Formatting
  // --------------------------------------------------------------------------

  /**
   * Format a report for voice output
   */
  formatReportForVoice(report: OptimizationReport): string {
    const lines: string[] = [];

    // Performance summary
    const successPercent = (report.metricsAnalysis.successRate * 100).toFixed(0);
    const changePercent = (report.metricsAnalysis.successRateChange * 100).toFixed(1);
    const direction = report.metricsAnalysis.successRateChange >= 0 ? 'up' : 'down';

    lines.push(`Here's your performance report.`);
    lines.push(
      `Success rate is ${successPercent}%, ${direction} ${Math.abs(parseFloat(changePercent))}% from yesterday.`
    );

    // Improvements
    if (report.improvements.length > 0) {
      lines.push(`${report.improvements.length} improvements were validated.`);
    }

    // Rollbacks
    if (report.rollbacks.length > 0) {
      lines.push(`${report.rollbacks.length} changes were rolled back due to performance issues.`);
    }

    // Pending proposals
    if (report.proposalsGenerated > 0) {
      lines.push(
        `${report.proposalsGenerated} new optimization proposals are pending your review.`
      );
    }

    // Next steps
    if (report.nextSteps.length > 0) {
      lines.push(`Recommended next step: ${report.nextSteps[0]}`);
    }

    return lines.join(' ');
  }

  /**
   * Format a report for display (markdown)
   */
  formatReportForDisplay(report: OptimizationReport): string {
    const lines: string[] = [];

    lines.push('# Atlas Performance Report');
    lines.push('');
    lines.push(`Generated: ${report.generatedAt.toLocaleString()}`);
    lines.push('');

    // Metrics
    lines.push('## Performance Metrics');
    lines.push('');
    lines.push(`| Metric | Value | Change |`);
    lines.push(`|--------|-------|--------|`);
    lines.push(
      `| Success Rate | ${(report.metricsAnalysis.successRate * 100).toFixed(1)}% | ${report.metricsAnalysis.successRateChange >= 0 ? '+' : ''}${(report.metricsAnalysis.successRateChange * 100).toFixed(1)}% |`
    );
    lines.push(
      `| Avg Latency | ${report.metricsAnalysis.avgLatency.toFixed(0)}ms | ${report.metricsAnalysis.latencyChange >= 0 ? '+' : ''}${report.metricsAnalysis.latencyChange.toFixed(0)}ms |`
    );
    lines.push(
      `| Correction Rate | ${(report.metricsAnalysis.correctionRate * 100).toFixed(1)}% | ${report.metricsAnalysis.correctionRateChange >= 0 ? '+' : ''}${(report.metricsAnalysis.correctionRateChange * 100).toFixed(1)}% |`
    );
    lines.push('');

    // Improvements
    if (report.improvements.length > 0) {
      lines.push('## Validated Improvements');
      lines.push('');
      for (const imp of report.improvements) {
        lines.push(`- **${imp.target}**: ${imp.description} (+${imp.improvement.toFixed(1)}%)`);
      }
      lines.push('');
    }

    // Rollbacks
    if (report.rollbacks.length > 0) {
      lines.push('## Rollbacks');
      lines.push('');
      for (const rb of report.rollbacks) {
        lines.push(`- **${rb.target}**: ${rb.reason}`);
      }
      lines.push('');
    }

    // Patterns
    if (report.patterns.length > 0) {
      lines.push('## Identified Patterns');
      lines.push('');
      for (const pattern of report.patterns) {
        lines.push(
          `- ${pattern.type}: ${pattern.description} (${(pattern.frequency * 100).toFixed(0)}% failure rate)`
        );
      }
      lines.push('');
    }

    // Next steps
    if (report.nextSteps.length > 0) {
      lines.push('## Recommended Next Steps');
      lines.push('');
      for (const step of report.nextSteps) {
        lines.push(`- ${step}`);
      }
    }

    return lines.join('\n');
  }

  // --------------------------------------------------------------------------
  // Cleanup
  // --------------------------------------------------------------------------

  async cleanup(): Promise<void> {
    this.notifications = [];
    this.initialized = false;
    logger.info('Change reporter cleaned up');
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

let reporterInstance: ChangeReporter | null = null;

export function getChangeReporter(): ChangeReporter {
  if (!reporterInstance) {
    reporterInstance = new ChangeReporter();
  }
  return reporterInstance;
}

export default ChangeReporter;
