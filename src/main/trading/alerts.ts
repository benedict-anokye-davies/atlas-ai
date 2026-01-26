/**
 * Atlas Trading - Alert Manager
 *
 * Manages price alerts across multiple exchanges with notifications.
 *
 * @module trading/alerts
 */

import Decimal from 'decimal.js';
import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { ExchangeId, IExchange, TradingSymbol, AlertCondition, PriceAlert, Ticker } from './types';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('AlertManager');

/**
 * Alert creation request
 */
export interface CreateAlertRequest {
  exchange: ExchangeId;
  symbol: TradingSymbol;
  condition: AlertCondition;
  target: Decimal | number;
  repeat?: boolean;
  note?: string;
}

/**
 * Alert triggered event data
 */
export interface AlertTriggeredEvent {
  alert: PriceAlert;
  ticker: Ticker;
  message: string;
}

/**
 * Alert manager configuration
 */
export interface AlertManagerConfig {
  /** Check interval in milliseconds */
  checkInterval?: number;
  /** Maximum alerts per exchange */
  maxAlertsPerExchange?: number;
  /** Maximum total alerts */
  maxTotalAlerts?: number;
}

const DEFAULT_CONFIG: Required<AlertManagerConfig> = {
  checkInterval: 5000, // 5 seconds
  maxAlertsPerExchange: 50,
  maxTotalAlerts: 200,
};

/**
 * Alert Manager
 *
 * Creates, monitors, and triggers price alerts across exchanges.
 */
export class AlertManager extends EventEmitter {
  private exchanges: Map<ExchangeId, IExchange> = new Map();
  private alerts: Map<string, PriceAlert> = new Map();
  private lastPrices: Map<string, Decimal> = new Map();
  private checkTimer: NodeJS.Timeout | null = null;
  private config: Required<AlertManagerConfig>;

  constructor(config: AlertManagerConfig = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Register an exchange with the alert manager
   */
  registerExchange(exchange: IExchange): void {
    if (this.exchanges.has(exchange.id)) {
      logger.warn('Exchange already registered', { exchange: exchange.id });
      return;
    }

    this.exchanges.set(exchange.id, exchange);
    logger.info('Exchange registered for alerts', { exchange: exchange.id });
  }

  /**
   * Unregister an exchange
   */
  unregisterExchange(exchangeId: ExchangeId): void {
    if (this.exchanges.delete(exchangeId)) {
      // Remove all alerts for this exchange
      for (const [id, alert] of this.alerts) {
        if (alert.exchange === exchangeId) {
          this.alerts.delete(id);
        }
      }
      logger.info('Exchange unregistered from alerts', { exchange: exchangeId });
    }
  }

  /**
   * Start monitoring alerts
   */
  start(): void {
    if (this.checkTimer) {
      return;
    }

    this.checkTimer = setInterval(() => {
      this.checkAlerts().catch((error) => {
        logger.error('Failed to check alerts', { error: (error as Error).message });
      });
    }, this.config.checkInterval);

    logger.info('Alert monitoring started', { interval: this.config.checkInterval });
  }

  /**
   * Stop monitoring alerts
   */
  stop(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
      logger.info('Alert monitoring stopped');
    }
  }

  /**
   * Create a new price alert
   */
  createAlert(request: CreateAlertRequest): PriceAlert {
    // Check exchange exists
    if (!this.exchanges.has(request.exchange)) {
      throw new Error(`Exchange ${request.exchange} not registered`);
    }

    // Check limits
    const exchangeAlerts = this.getAlertsByExchange(request.exchange);
    if (exchangeAlerts.length >= this.config.maxAlertsPerExchange) {
      throw new Error(
        `Maximum alerts (${this.config.maxAlertsPerExchange}) reached for ${request.exchange}`
      );
    }

    if (this.alerts.size >= this.config.maxTotalAlerts) {
      throw new Error(`Maximum total alerts (${this.config.maxTotalAlerts}) reached`);
    }

    const target =
      typeof request.target === 'number' ? new Decimal(request.target) : request.target;

    const alert: PriceAlert = {
      id: randomUUID(),
      exchange: request.exchange,
      symbol: request.symbol,
      condition: request.condition,
      target,
      active: true,
      repeat: request.repeat ?? false,
      createdAt: Date.now(),
      note: request.note,
    };

    this.alerts.set(alert.id, alert);
    logger.info('Alert created', {
      id: alert.id,
      exchange: alert.exchange,
      symbol: alert.symbol,
      condition: alert.condition,
      target: alert.target.toString(),
    });

    this.emit('alert:created', alert);
    return alert;
  }

  /**
   * Cancel an alert
   */
  cancelAlert(alertId: string): boolean {
    const alert = this.alerts.get(alertId);
    if (!alert) {
      return false;
    }

    this.alerts.delete(alertId);
    logger.info('Alert canceled', { id: alertId });
    this.emit('alert:canceled', alert);
    return true;
  }

  /**
   * Get all alerts
   */
  getAlerts(): PriceAlert[] {
    return Array.from(this.alerts.values());
  }

  /**
   * Get active alerts
   */
  getActiveAlerts(): PriceAlert[] {
    return Array.from(this.alerts.values()).filter((a) => a.active);
  }

  /**
   * Get alerts by exchange
   */
  getAlertsByExchange(exchangeId: ExchangeId): PriceAlert[] {
    return Array.from(this.alerts.values()).filter((a) => a.exchange === exchangeId);
  }

  /**
   * Get alerts by symbol
   */
  getAlertsBySymbol(symbol: TradingSymbol): PriceAlert[] {
    return Array.from(this.alerts.values()).filter((a) => a.symbol === symbol);
  }

  /**
   * Get a specific alert
   */
  getAlert(alertId: string): PriceAlert | undefined {
    return this.alerts.get(alertId);
  }

  /**
   * Update an existing alert
   */
  updateAlert(
    alertId: string,
    updates: Partial<Pick<PriceAlert, 'target' | 'active' | 'repeat' | 'note'>>
  ): PriceAlert | null {
    const alert = this.alerts.get(alertId);
    if (!alert) {
      return null;
    }

    if (updates.target !== undefined) {
      alert.target =
        typeof updates.target === 'number' ? new Decimal(updates.target) : updates.target;
    }
    if (updates.active !== undefined) {
      alert.active = updates.active;
    }
    if (updates.repeat !== undefined) {
      alert.repeat = updates.repeat;
    }
    if (updates.note !== undefined) {
      alert.note = updates.note;
    }

    logger.info('Alert updated', { id: alertId, updates });
    this.emit('alert:updated', alert);
    return alert;
  }

  /**
   * Reactivate a triggered alert
   */
  reactivateAlert(alertId: string): boolean {
    const alert = this.alerts.get(alertId);
    if (!alert) {
      return false;
    }

    alert.active = true;
    alert.triggeredAt = undefined;
    logger.info('Alert reactivated', { id: alertId });
    this.emit('alert:updated', alert);
    return true;
  }

  /**
   * Check all active alerts
   */
  private async checkAlerts(): Promise<void> {
    const activeAlerts = this.getActiveAlerts();
    if (activeAlerts.length === 0) {
      return;
    }

    // Group alerts by exchange and symbol
    const groupedAlerts = new Map<ExchangeId, Map<TradingSymbol, PriceAlert[]>>();

    for (const alert of activeAlerts) {
      if (!groupedAlerts.has(alert.exchange)) {
        groupedAlerts.set(alert.exchange, new Map());
      }
      const exchangeAlerts = groupedAlerts.get(alert.exchange)!;
      if (!exchangeAlerts.has(alert.symbol)) {
        exchangeAlerts.set(alert.symbol, []);
      }
      exchangeAlerts.get(alert.symbol)!.push(alert);
    }

    // Check each exchange
    for (const [exchangeId, symbolAlerts] of groupedAlerts) {
      const exchange = this.exchanges.get(exchangeId);
      if (!exchange || !exchange.isConnected()) {
        continue;
      }

      const symbols = Array.from(symbolAlerts.keys());

      try {
        // Fetch tickers for all symbols with alerts
        const tickers = await exchange.fetchTickers(symbols);

        for (const [symbol, alerts] of symbolAlerts) {
          const ticker = tickers.get(symbol);
          if (!ticker) continue;

          const lastPrice = this.lastPrices.get(`${exchangeId}:${symbol}`);

          for (const alert of alerts) {
            if (this.checkAlertCondition(alert, ticker, lastPrice)) {
              this.triggerAlert(alert, ticker);
            }
          }

          // Update last price
          this.lastPrices.set(`${exchangeId}:${symbol}`, ticker.last);
        }
      } catch (error) {
        logger.error('Failed to fetch prices for alerts', {
          exchange: exchangeId,
          error: (error as Error).message,
        });
      }
    }
  }

  /**
   * Check if an alert condition is met
   */
  private checkAlertCondition(alert: PriceAlert, ticker: Ticker, lastPrice?: Decimal): boolean {
    const currentPrice = ticker.last;
    const target = alert.target;

    switch (alert.condition) {
      case 'price_above':
        return currentPrice.greaterThanOrEqualTo(target);

      case 'price_below':
        return currentPrice.lessThanOrEqualTo(target);

      case 'price_crosses': {
        if (!lastPrice) return false;
        // Check if price crossed the target in either direction
        const crossedUp = lastPrice.lessThan(target) && currentPrice.greaterThanOrEqualTo(target);
        const crossedDown = lastPrice.greaterThan(target) && currentPrice.lessThanOrEqualTo(target);
        return crossedUp || crossedDown;
      }

      case 'change_up':
        // Target is percentage
        return ticker.percentage.greaterThanOrEqualTo(target);

      case 'change_down':
        // Target is percentage (negative)
        return ticker.percentage.lessThanOrEqualTo(target.negated());

      case 'volume_spike':
        // Target is volume threshold
        return ticker.volume.greaterThanOrEqualTo(target);

      default:
        return false;
    }
  }

  /**
   * Trigger an alert
   */
  private triggerAlert(alert: PriceAlert, ticker: Ticker): void {
    alert.triggeredAt = Date.now();

    if (!alert.repeat) {
      alert.active = false;
    }

    const message = this.formatAlertMessage(alert, ticker);

    logger.info('Alert triggered', {
      id: alert.id,
      exchange: alert.exchange,
      symbol: alert.symbol,
      condition: alert.condition,
      target: alert.target.toString(),
      currentPrice: ticker.last.toString(),
    });

    const event: AlertTriggeredEvent = {
      alert,
      ticker,
      message,
    };

    this.emit('alert:triggered', event);
  }

  /**
   * Format alert message for display
   */
  private formatAlertMessage(alert: PriceAlert, ticker: Ticker): string {
    const price = ticker.last.toFixed(2);
    const target = alert.target.toFixed(2);

    switch (alert.condition) {
      case 'price_above':
        return `${alert.symbol} price ($${price}) is now above $${target}`;

      case 'price_below':
        return `${alert.symbol} price ($${price}) is now below $${target}`;

      case 'price_crosses':
        return `${alert.symbol} price crossed $${target} (now at $${price})`;

      case 'change_up':
        return `${alert.symbol} is up ${ticker.percentage.toFixed(2)}% (target: ${target}%)`;

      case 'change_down':
        return `${alert.symbol} is down ${ticker.percentage.abs().toFixed(2)}% (target: ${target}%)`;

      case 'volume_spike':
        return `${alert.symbol} volume spike: ${ticker.volume.toFixed(2)} (threshold: ${target})`;

      default:
        return `Alert triggered for ${alert.symbol}`;
    }
  }

  /**
   * Get alert statistics
   */
  getStats(): {
    total: number;
    active: number;
    triggered: number;
    byExchange: Map<ExchangeId, number>;
  } {
    const alerts = Array.from(this.alerts.values());
    const byExchange = new Map<ExchangeId, number>();

    for (const alert of alerts) {
      const count = byExchange.get(alert.exchange) ?? 0;
      byExchange.set(alert.exchange, count + 1);
    }

    return {
      total: alerts.length,
      active: alerts.filter((a) => a.active).length,
      triggered: alerts.filter((a) => a.triggeredAt !== undefined).length,
      byExchange,
    };
  }

  /**
   * Clear all alerts
   */
  clearAllAlerts(): number {
    const count = this.alerts.size;
    this.alerts.clear();
    this.lastPrices.clear();
    logger.info('All alerts cleared', { count });
    return count;
  }

  /**
   * Clear alerts for a specific exchange
   */
  clearExchangeAlerts(exchangeId: ExchangeId): number {
    let count = 0;
    for (const [id, alert] of this.alerts) {
      if (alert.exchange === exchangeId) {
        this.alerts.delete(id);
        count++;
      }
    }
    logger.info('Exchange alerts cleared', { exchange: exchangeId, count });
    return count;
  }

  /**
   * Export alerts for persistence
   */
  exportAlerts(): PriceAlert[] {
    return Array.from(this.alerts.values());
  }

  /**
   * Import alerts from storage
   */
  importAlerts(alerts: PriceAlert[]): number {
    let imported = 0;
    for (const alert of alerts) {
      // Convert target back to Decimal if needed (for JSON deserialization)
      const target =
        alert.target instanceof Decimal ? alert.target : new Decimal(String(alert.target));

      const processedAlert: PriceAlert = {
        ...alert,
        target,
      };

      if (!this.alerts.has(processedAlert.id)) {
        this.alerts.set(processedAlert.id, processedAlert);
        imported++;
      }
    }
    logger.info('Alerts imported', { imported, total: alerts.length });
    return imported;
  }

  /**
   * Cleanup and dispose resources
   */
  dispose(): void {
    this.stop();
    this.alerts.clear();
    this.lastPrices.clear();
    this.exchanges.clear();
    this.removeAllListeners();
    logger.info('Alert manager disposed');
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let alertManager: AlertManager | null = null;

/**
 * Get the alert manager singleton
 */
export function getAlertManager(): AlertManager {
  if (!alertManager) {
    alertManager = new AlertManager();
  }
  return alertManager;
}

/**
 * Create a new alert manager with custom config
 */
export function createAlertManager(config: AlertManagerConfig): AlertManager {
  return new AlertManager(config);
}
