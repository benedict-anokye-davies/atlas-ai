/**
 * Audit Logger
 * Tracks all significant operations for security and compliance
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../../utils/logger';
import { v4 as uuidv4 } from 'uuid';
import {
  AuditLogEntry,
  AuditLogFilter,
  AuditLogStats,
  AuditAction,
  AuditSeverity,
  AuditOutcome,
} from './types';

const logger = createModuleLogger('AuditLogger');

// ============================================================================
// AUDIT LOGGER
// ============================================================================

export class AuditLogger extends EventEmitter {
  private logs: AuditLogEntry[] = [];
  private maxLogs: number;
  private writeToFile: boolean;
  private minSeverity: AuditSeverity;
  private initialized = false;
  
  // Severity levels for filtering
  private severityLevels: Record<AuditSeverity, number> = {
    debug: 0,
    info: 1,
    warning: 2,
    error: 3,
    critical: 4,
  };

  constructor(options: {
    maxLogs?: number;
    writeToFile?: boolean;
    minSeverity?: AuditSeverity;
  } = {}) {
    super();
    this.maxLogs = options.maxLogs ?? 10000;
    this.writeToFile = options.writeToFile ?? true;
    this.minSeverity = options.minSeverity ?? 'info';
  }

  // --------------------------------------------------------------------------
  // INITIALIZATION
  // --------------------------------------------------------------------------

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    logger.info('Initializing audit logger...');

    // In production, load recent logs from database
    // await this.loadRecentLogs();

    this.initialized = true;
    logger.info('Audit logger initialized');
  }

  async shutdown(): Promise<void> {
    // Flush pending logs
    await this.flush();
    this.initialized = false;
    logger.info('Audit logger shut down');
  }

  // --------------------------------------------------------------------------
  // LOGGING
  // --------------------------------------------------------------------------

  /**
   * Log an audit entry
   */
  log(entry: Omit<AuditLogEntry, 'id' | 'timestamp'>): string {
    // Check severity threshold
    if (this.severityLevels[entry.severity] < this.severityLevels[this.minSeverity]) {
      return '';
    }

    const fullEntry: AuditLogEntry = {
      ...entry,
      id: uuidv4(),
      timestamp: new Date(),
    };

    this.logs.push(fullEntry);
    this.emit('entry-logged', fullEntry);

    // Trim logs if needed
    if (this.logs.length > this.maxLogs) {
      const removed = this.logs.splice(0, this.logs.length - this.maxLogs);
      this.emit('logs-trimmed', removed.length);
    }

    // Write to file if enabled
    if (this.writeToFile) {
      this.writeEntryToFile(fullEntry);
    }

    // Log critical and error entries to main logger
    if (entry.severity === 'critical' || entry.severity === 'error') {
      logger.warn(`[AUDIT:${entry.severity.toUpperCase()}] ${entry.action}`, entry.details);
    }

    return fullEntry.id;
  }

  /**
   * Convenience method for successful entity operations
   */
  logEntityOperation(
    action: AuditAction,
    entityType: string,
    entityId: string,
    details: Record<string, unknown> = {},
    outcome: AuditOutcome = 'success'
  ): string {
    return this.log({
      action,
      severity: 'info',
      outcome,
      entityType,
      entityId,
      details,
    });
  }

  /**
   * Convenience method for security operations
   */
  logSecurityEvent(
    action: AuditAction,
    severity: AuditSeverity,
    outcome: AuditOutcome,
    details: Record<string, unknown> = {}
  ): string {
    return this.log({
      action,
      severity,
      outcome,
      details,
    });
  }

  /**
   * Log a query execution
   */
  logQuery(
    query: string,
    agentId?: string,
    resultCount?: number,
    durationMs?: number
  ): string {
    return this.log({
      action: 'query:execute',
      severity: 'debug',
      outcome: 'success',
      details: {
        query,
        agentId,
        resultCount,
        durationMs,
      },
    });
  }

  /**
   * Log a failed operation
   */
  logFailure(
    action: AuditAction,
    errorCode: string,
    errorMessage: string,
    details: Record<string, unknown> = {}
  ): string {
    return this.log({
      action,
      severity: 'error',
      outcome: 'failure',
      errorCode,
      errorMessage,
      details,
    });
  }

  /**
   * Log access denied
   */
  logAccessDenied(
    action: AuditAction,
    reason: string,
    userId?: string,
    resourceType?: string,
    resourceId?: string
  ): string {
    return this.log({
      action,
      severity: 'warning',
      outcome: 'denied',
      userId,
      resourceType,
      resourceId,
      details: { reason },
    });
  }

  // --------------------------------------------------------------------------
  // QUERYING
  // --------------------------------------------------------------------------

  /**
   * Query logs with filters
   */
  query(filter: AuditLogFilter = {}): AuditLogEntry[] {
    let results = [...this.logs];

    if (filter.startTime) {
      results = results.filter(e => e.timestamp >= filter.startTime!);
    }

    if (filter.endTime) {
      results = results.filter(e => e.timestamp <= filter.endTime!);
    }

    if (filter.actions && filter.actions.length > 0) {
      results = results.filter(e => filter.actions!.includes(e.action));
    }

    if (filter.severities && filter.severities.length > 0) {
      results = results.filter(e => filter.severities!.includes(e.severity));
    }

    if (filter.outcomes && filter.outcomes.length > 0) {
      results = results.filter(e => filter.outcomes!.includes(e.outcome));
    }

    if (filter.userId) {
      results = results.filter(e => e.userId === filter.userId);
    }

    if (filter.sessionId) {
      results = results.filter(e => e.sessionId === filter.sessionId);
    }

    if (filter.entityType) {
      results = results.filter(e => e.entityType === filter.entityType);
    }

    if (filter.entityId) {
      results = results.filter(e => e.entityId === filter.entityId);
    }

    // Sort by timestamp descending (newest first)
    results.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    // Apply pagination
    const offset = filter.offset ?? 0;
    const limit = filter.limit ?? 100;
    results = results.slice(offset, offset + limit);

    return results;
  }

  /**
   * Get recent logs
   */
  getRecent(limit = 50): AuditLogEntry[] {
    return this.query({ limit });
  }

  /**
   * Get logs for a specific entity
   */
  getEntityHistory(entityType: string, entityId: string, limit = 100): AuditLogEntry[] {
    return this.query({ entityType, entityId, limit });
  }

  /**
   * Get security-related logs
   */
  getSecurityLogs(since?: Date, limit = 100): AuditLogEntry[] {
    const securityActions: AuditAction[] = [
      'security:encrypt',
      'security:decrypt',
      'security:key_rotate',
      'security:export',
      'security:import',
      'access:login',
      'access:logout',
      'access:permission_grant',
      'access:permission_revoke',
    ];
    return this.query({ actions: securityActions, startTime: since, limit });
  }

  /**
   * Get failed operations
   */
  getFailures(since?: Date, limit = 100): AuditLogEntry[] {
    return this.query({ outcomes: ['failure', 'denied'], startTime: since, limit });
  }

  // --------------------------------------------------------------------------
  // STATISTICS
  // --------------------------------------------------------------------------

  /**
   * Get statistics for a time period
   */
  getStats(since?: Date): AuditLogStats {
    const startTime = since ?? new Date(Date.now() - 24 * 60 * 60 * 1000); // Last 24h
    const logs = this.logs.filter(e => e.timestamp >= startTime);

    const byAction = {} as Record<AuditAction, number>;
    const bySeverity = {} as Record<AuditSeverity, number>;
    const byOutcome = {} as Record<AuditOutcome, number>;

    let failures = 0;

    for (const log of logs) {
      byAction[log.action] = (byAction[log.action] || 0) + 1;
      bySeverity[log.severity] = (bySeverity[log.severity] || 0) + 1;
      byOutcome[log.outcome] = (byOutcome[log.outcome] || 0) + 1;

      if (log.outcome === 'failure' || log.outcome === 'denied') {
        failures++;
      }
    }

    return {
      totalEntries: logs.length,
      byAction,
      bySeverity,
      byOutcome,
      failureRate: logs.length > 0 ? failures / logs.length : 0,
      periodStart: startTime,
      periodEnd: new Date(),
    };
  }

  /**
   * Check for anomalies (e.g., unusual activity patterns)
   */
  detectAnomalies(
    windowMinutes = 60,
    thresholds: {
      maxFailures?: number;
      maxDenied?: number;
      maxSecurityEvents?: number;
    } = {}
  ): {
    anomalies: string[];
    stats: { failures: number; denied: number; securityEvents: number };
  } {
    const since = new Date(Date.now() - windowMinutes * 60 * 1000);
    const logs = this.logs.filter(e => e.timestamp >= since);

    const failures = logs.filter(e => e.outcome === 'failure').length;
    const denied = logs.filter(e => e.outcome === 'denied').length;
    const securityEvents = logs.filter(e => e.action.startsWith('security:')).length;

    const anomalies: string[] = [];

    if (thresholds.maxFailures && failures > thresholds.maxFailures) {
      anomalies.push(`High failure rate: ${failures} failures in ${windowMinutes} minutes`);
    }

    if (thresholds.maxDenied && denied > thresholds.maxDenied) {
      anomalies.push(`High access denial rate: ${denied} denials in ${windowMinutes} minutes`);
    }

    if (thresholds.maxSecurityEvents && securityEvents > thresholds.maxSecurityEvents) {
      anomalies.push(`Unusual security activity: ${securityEvents} events in ${windowMinutes} minutes`);
    }

    if (anomalies.length > 0) {
      this.emit('anomalies-detected', anomalies);
    }

    return {
      anomalies,
      stats: { failures, denied, securityEvents },
    };
  }

  // --------------------------------------------------------------------------
  // PERSISTENCE
  // --------------------------------------------------------------------------

  private async writeEntryToFile(entry: AuditLogEntry): Promise<void> {
    // In production, write to rotating log file
    // For now, just track in memory
  }

  async flush(): Promise<void> {
    // Flush any pending writes
  }

  /**
   * Export logs for backup or analysis
   */
  export(filter: AuditLogFilter = {}): string {
    const logs = this.query({ ...filter, limit: this.maxLogs });
    return JSON.stringify(logs, null, 2);
  }

  /**
   * Import logs (for restore)
   */
  import(data: string): number {
    try {
      const logs: AuditLogEntry[] = JSON.parse(data);
      
      // Convert date strings back to Date objects
      for (const log of logs) {
        log.timestamp = new Date(log.timestamp);
      }
      
      // Merge with existing logs, avoiding duplicates
      const existingIds = new Set(this.logs.map(l => l.id));
      const newLogs = logs.filter(l => !existingIds.has(l.id));
      
      this.logs.push(...newLogs);
      
      // Sort and trim
      this.logs.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      if (this.logs.length > this.maxLogs) {
        this.logs.splice(0, this.logs.length - this.maxLogs);
      }
      
      logger.info(`Imported ${newLogs.length} audit log entries`);
      return newLogs.length;
    } catch (error) {
      logger.error('Failed to import audit logs:', error as Record<string, unknown>);
      return 0;
    }
  }

  /**
   * Clear old logs
   */
  purge(before: Date): number {
    const originalLength = this.logs.length;
    this.logs = this.logs.filter(e => e.timestamp >= before);
    const purged = originalLength - this.logs.length;
    
    if (purged > 0) {
      logger.info(`Purged ${purged} audit log entries before ${before.toISOString()}`);
      this.emit('logs-purged', purged);
    }
    
    return purged;
  }

  // --------------------------------------------------------------------------
  // STATUS
  // --------------------------------------------------------------------------

  getLogCount(): number {
    return this.logs.length;
  }

  isInitialized(): boolean {
    return this.initialized;
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let instance: AuditLogger | null = null;

export function getAuditLogger(): AuditLogger {
  if (!instance) {
    instance = new AuditLogger();
  }
  return instance;
}
