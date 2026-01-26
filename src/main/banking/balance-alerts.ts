/**
 * Atlas Banking - Balance Alerts
 *
 * Real-time balance monitoring with configurable alerts.
 * Notifies when balance drops below threshold or unusual activity detected.
 *
 * @module banking/balance-alerts
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import { app } from 'electron';
import { join } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { BankAccount } from './types';

const logger = createModuleLogger('BalanceAlerts');

/**
 * Alert types
 */
export type AlertType =
  | 'low_balance'
  | 'large_withdrawal'
  | 'unusual_activity'
  | 'payment_due'
  | 'balance_increase'
  | 'overdraft_warning';

/**
 * Alert priority levels
 */
export type AlertPriority = 'low' | 'medium' | 'high' | 'urgent';

/**
 * Alert configuration
 */
export interface AlertConfig {
  id: string;
  accountId: string;
  type: AlertType;
  enabled: boolean;
  threshold?: number;
  createdAt: number;
  lastTriggered?: number;
}

/**
 * Generated alert
 */
export interface BalanceAlert {
  id: string;
  configId: string;
  accountId: string;
  accountName: string;
  type: AlertType;
  priority: AlertPriority;
  title: string;
  message: string;
  currentBalance: number;
  threshold?: number;
  triggeredAt: number;
  acknowledged: boolean;
}

/**
 * Alert thresholds by type
 */
interface AlertThresholds {
  lowBalance: number;
  largeWithdrawal: number;
  overdraftBuffer: number;
}

/**
 * Balance Alert Manager
 */
export class BalanceAlertManager extends EventEmitter {
  private configs: Map<string, AlertConfig> = new Map();
  private alerts: BalanceAlert[] = [];
  private previousBalances: Map<string, number> = new Map();
  private thresholds: AlertThresholds = {
    lowBalance: 100, // Default £100
    largeWithdrawal: 500, // Alert on withdrawals > £500
    overdraftBuffer: 50, // Warn when within £50 of overdraft
  };
  private dataPath: string;
  private checkInterval: NodeJS.Timeout | null = null;

  constructor() {
    super();
    this.dataPath = join(app.getPath('userData'), 'banking');
    this.loadData();
  }

  /**
   * Load alert configurations and history
   */
  private loadData(): void {
    try {
      const filePath = join(this.dataPath, 'balance-alerts.json');
      if (existsSync(filePath)) {
        const data = JSON.parse(readFileSync(filePath, 'utf-8'));
        this.configs = new Map(Object.entries(data.configs || {}));
        this.alerts = data.alerts || [];
        this.thresholds = { ...this.thresholds, ...data.thresholds };
        this.previousBalances = new Map(Object.entries(data.previousBalances || {}));
        logger.info('Loaded balance alert data', {
          configs: this.configs.size,
          alerts: this.alerts.length,
        });
      }
    } catch (error) {
      logger.warn('Failed to load balance alert data', { error: (error as Error).message });
    }
  }

  /**
   * Save alert data
   */
  private saveData(): void {
    try {
      if (!existsSync(this.dataPath)) {
        mkdirSync(this.dataPath, { recursive: true });
      }
      const filePath = join(this.dataPath, 'balance-alerts.json');
      const data = {
        configs: Object.fromEntries(this.configs),
        alerts: this.alerts.slice(-500), // Keep last 500 alerts
        thresholds: this.thresholds,
        previousBalances: Object.fromEntries(this.previousBalances),
      };
      writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch (error) {
      logger.error('Failed to save balance alert data', { error: (error as Error).message });
    }
  }

  /**
   * Create an alert configuration
   */
  createConfig(
    accountId: string,
    type: AlertType,
    threshold?: number
  ): AlertConfig {
    const config: AlertConfig = {
      id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      accountId,
      type,
      enabled: true,
      threshold,
      createdAt: Date.now(),
    };

    this.configs.set(config.id, config);
    this.saveData();

    logger.info('Created alert config', { config });
    return config;
  }

  /**
   * Update alert configuration
   */
  updateConfig(id: string, updates: Partial<AlertConfig>): AlertConfig | null {
    const config = this.configs.get(id);
    if (!config) return null;

    Object.assign(config, updates);
    this.configs.set(id, config);
    this.saveData();

    return config;
  }

  /**
   * Delete alert configuration
   */
  deleteConfig(id: string): boolean {
    const deleted = this.configs.delete(id);
    if (deleted) {
      this.saveData();
    }
    return deleted;
  }

  /**
   * Get all configurations
   */
  getConfigs(accountId?: string): AlertConfig[] {
    const configs = Array.from(this.configs.values());
    if (accountId) {
      return configs.filter((c) => c.accountId === accountId);
    }
    return configs;
  }

  /**
   * Set global thresholds
   */
  setThresholds(thresholds: Partial<AlertThresholds>): void {
    this.thresholds = { ...this.thresholds, ...thresholds };
    this.saveData();
  }

  /**
   * Get current thresholds
   */
  getThresholds(): AlertThresholds {
    return { ...this.thresholds };
  }

  /**
   * Check accounts for alert conditions
   */
  checkAccounts(accounts: BankAccount[]): BalanceAlert[] {
    const newAlerts: BalanceAlert[] = [];

    for (const account of accounts) {
      const previousBalance = this.previousBalances.get(account.id);

      // Check low balance
      if (account.currentBalance < this.thresholds.lowBalance) {
        const alert = this.createAlert(
          account,
          'low_balance',
          'urgent',
          'Low Balance Warning',
          `Your ${account.name} balance is £${account.currentBalance.toFixed(2)}, below the £${this.thresholds.lowBalance} threshold.`
        );
        if (alert) newAlerts.push(alert);
      }

      // Check overdraft warning
      if (account.availableBalance !== undefined && account.availableBalance < this.thresholds.overdraftBuffer) {
        const alert = this.createAlert(
          account,
          'overdraft_warning',
          'urgent',
          'Overdraft Warning',
          `Your ${account.name} is close to overdraft. Available: £${account.availableBalance.toFixed(2)}`
        );
        if (alert) newAlerts.push(alert);
      }

      // Check large withdrawal
      if (previousBalance !== undefined) {
        const change = previousBalance - account.currentBalance;
        if (change > this.thresholds.largeWithdrawal) {
          const alert = this.createAlert(
            account,
            'large_withdrawal',
            'high',
            'Large Withdrawal Detected',
            `£${change.toFixed(2)} was withdrawn from ${account.name}. New balance: £${account.currentBalance.toFixed(2)}`
          );
          if (alert) newAlerts.push(alert);
        }

        // Check significant balance increase (income)
        if (change < -1000) {
          const alert = this.createAlert(
            account,
            'balance_increase',
            'low',
            'Balance Increased',
            `£${Math.abs(change).toFixed(2)} was added to ${account.name}. New balance: £${account.currentBalance.toFixed(2)}`
          );
          if (alert) newAlerts.push(alert);
        }
      }

      // Update previous balance
      this.previousBalances.set(account.id, account.currentBalance);
    }

    if (newAlerts.length > 0) {
      this.saveData();
    }

    return newAlerts;
  }

  /**
   * Create and emit an alert
   */
  private createAlert(
    account: BankAccount,
    type: AlertType,
    priority: AlertPriority,
    title: string,
    message: string
  ): BalanceAlert | null {
    // Check for recent duplicate
    const recentDuplicate = this.alerts.find(
      (a) =>
        a.accountId === account.id &&
        a.type === type &&
        Date.now() - a.triggeredAt < 24 * 60 * 60 * 1000 && // Within 24 hours
        !a.acknowledged
    );

    if (recentDuplicate) {
      return null; // Don't spam with duplicates
    }

    const alert: BalanceAlert = {
      id: `ba_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      configId: '',
      accountId: account.id,
      accountName: account.name,
      type,
      priority,
      title,
      message,
      currentBalance: account.currentBalance,
      triggeredAt: Date.now(),
      acknowledged: false,
    };

    this.alerts.push(alert);
    this.emit('alert', alert);

    logger.info('Balance alert triggered', { alertId: alert.id, type, accountId: account.id });

    return alert;
  }

  /**
   * Get unacknowledged alerts
   */
  getActiveAlerts(): BalanceAlert[] {
    return this.alerts.filter((a) => !a.acknowledged);
  }

  /**
   * Get all alerts (with optional filters)
   */
  getAlerts(options?: {
    accountId?: string;
    type?: AlertType;
    acknowledged?: boolean;
    since?: number;
    limit?: number;
  }): BalanceAlert[] {
    let filtered = [...this.alerts];

    if (options?.accountId) {
      filtered = filtered.filter((a) => a.accountId === options.accountId);
    }
    if (options?.type) {
      filtered = filtered.filter((a) => a.type === options.type);
    }
    if (options?.acknowledged !== undefined) {
      filtered = filtered.filter((a) => a.acknowledged === options.acknowledged);
    }
    if (options?.since) {
      filtered = filtered.filter((a) => a.triggeredAt >= options.since);
    }

    // Sort by most recent first
    filtered.sort((a, b) => b.triggeredAt - a.triggeredAt);

    if (options?.limit) {
      filtered = filtered.slice(0, options.limit);
    }

    return filtered;
  }

  /**
   * Acknowledge an alert
   */
  acknowledgeAlert(alertId: string): boolean {
    const alert = this.alerts.find((a) => a.id === alertId);
    if (alert) {
      alert.acknowledged = true;
      this.saveData();
      this.emit('acknowledged', alert);
      return true;
    }
    return false;
  }

  /**
   * Acknowledge all alerts
   */
  acknowledgeAll(): number {
    let count = 0;
    for (const alert of this.alerts) {
      if (!alert.acknowledged) {
        alert.acknowledged = true;
        count++;
      }
    }
    if (count > 0) {
      this.saveData();
    }
    return count;
  }

  /**
   * Start periodic balance checking
   */
  startMonitoring(checkFn: () => Promise<BankAccount[]>, intervalMs = 15 * 60 * 1000): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }

    this.checkInterval = setInterval(async () => {
      try {
        const accounts = await checkFn();
        const alerts = this.checkAccounts(accounts);
        if (alerts.length > 0) {
          this.emit('alerts', alerts);
        }
      } catch (error) {
        logger.error('Balance check failed', { error: (error as Error).message });
      }
    }, intervalMs);

    logger.info('Started balance monitoring', { intervalMs });
  }

  /**
   * Stop monitoring
   */
  stopMonitoring(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
      logger.info('Stopped balance monitoring');
    }
  }

  /**
   * Get alert statistics
   */
  getStats(): {
    total: number;
    unacknowledged: number;
    byType: Record<AlertType, number>;
    last24h: number;
    last7d: number;
  } {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const week = 7 * day;

    const byType: Record<AlertType, number> = {
      low_balance: 0,
      large_withdrawal: 0,
      unusual_activity: 0,
      payment_due: 0,
      balance_increase: 0,
      overdraft_warning: 0,
    };

    for (const alert of this.alerts) {
      byType[alert.type]++;
    }

    return {
      total: this.alerts.length,
      unacknowledged: this.alerts.filter((a) => !a.acknowledged).length,
      byType,
      last24h: this.alerts.filter((a) => now - a.triggeredAt < day).length,
      last7d: this.alerts.filter((a) => now - a.triggeredAt < week).length,
    };
  }
}

// Singleton instance
let alertManager: BalanceAlertManager | null = null;

export function getBalanceAlertManager(): BalanceAlertManager {
  if (!alertManager) {
    alertManager = new BalanceAlertManager();
  }
  return alertManager;
}
