/**
 * Atlas Trading - Kill Switches
 *
 * Pre-trade risk checks with automatic kill switch system.
 * Enforces risk limits and protects capital from runaway losses.
 *
 * Features:
 * - Daily loss limit (auto-stop when hit)
 * - Position size limits (per-trade and total)
 * - Concentration limits (max % in single asset)
 * - Order rate limiting (prevent fat-finger / algo runaway)
 * - Maximum drawdown protection
 * - Manual kill switch trigger
 *
 * Inspired by HFT risk management systems.
 *
 * @module trading/risk/kill-switches
 */

import Decimal from 'decimal.js';
import { EventEmitter } from 'events';
import { createModuleLogger } from '../../utils/logger';

const logger = createModuleLogger('KillSwitches');

// =============================================================================
// Types
// =============================================================================

/**
 * Risk limits configuration
 */
export interface RiskLimits {
  /** Maximum daily loss in base currency (e.g., -500 for £500 loss limit) */
  maxDailyLoss: number;
  /** Maximum position size per trade in base currency */
  maxPositionSize: number;
  /** Maximum total exposure (sum of all positions) */
  maxTotalExposure: number;
  /** Maximum concentration in single asset (0.2 = 20%) */
  maxConcentration: number;
  /** Maximum orders per minute (rate limit) */
  maxOrdersPerMinute: number;
  /** Maximum drawdown from peak (0.1 = 10%) */
  maxDrawdown: number;
  /** Maximum number of open positions */
  maxOpenPositions: number;
  /** Minimum time between trades in ms (prevent rapid fire) */
  minTimeBetweenTrades: number;
}

/**
 * Default risk limits (conservative)
 */
export const DEFAULT_RISK_LIMITS: RiskLimits = {
  maxDailyLoss: -500,           // £500 daily loss limit
  maxPositionSize: 5000,         // £5000 max per position
  maxTotalExposure: 20000,       // £20000 total exposure
  maxConcentration: 0.25,        // 25% max in single asset
  maxOrdersPerMinute: 10,        // 10 orders per minute
  maxDrawdown: 0.15,             // 15% max drawdown from peak
  maxOpenPositions: 10,          // 10 max open positions
  minTimeBetweenTrades: 1000,    // 1 second minimum between trades
};

/**
 * Risk check result
 */
export interface RiskCheckResult {
  /** Whether the order is allowed */
  allowed: boolean;
  /** Reason if not allowed */
  reason?: string;
  /** Risk check that failed */
  failedCheck?: string;
  /** Current risk metrics */
  metrics: RiskMetrics;
  /** Warnings (allowed but concerning) */
  warnings: string[];
}

/**
 * Current risk metrics snapshot
 */
export interface RiskMetrics {
  /** Today's realized + unrealized PnL */
  dailyPnL: Decimal;
  /** Current total exposure */
  totalExposure: Decimal;
  /** Peak portfolio value (for drawdown calc) */
  peakValue: Decimal;
  /** Current portfolio value */
  currentValue: Decimal;
  /** Current drawdown percentage */
  drawdown: Decimal;
  /** Number of open positions */
  openPositions: number;
  /** Orders placed in last minute */
  recentOrderCount: number;
  /** Largest position as % of portfolio */
  largestConcentration: Decimal;
  /** Whether kill switch is triggered */
  killSwitchActive: boolean;
  /** Reason for kill switch if active */
  killSwitchReason?: string;
  /** Time kill switch was triggered */
  killSwitchTime?: number;
}

/**
 * Order to be checked
 */
export interface OrderToCheck {
  symbol: string;
  side: 'buy' | 'sell';
  size: Decimal;
  price: Decimal;
  /** Notional value (size * price) */
  notional: Decimal;
}

/**
 * Position state for calculations
 */
export interface PositionState {
  symbol: string;
  size: Decimal;
  notional: Decimal;
  unrealizedPnL: Decimal;
}

/**
 * Kill switch trigger event
 */
export interface KillSwitchEvent {
  reason: string;
  timestamp: number;
  metrics: RiskMetrics;
  triggeredBy: 'auto' | 'manual';
}

// =============================================================================
// Kill Switch Manager
// =============================================================================

/**
 * Manages trading risk limits and kill switches
 */
export class KillSwitchManager extends EventEmitter {
  private limits: RiskLimits;
  private triggered = false;
  private triggerReason?: string;
  private triggerTime?: number;
  
  // Tracking state
  private dailyPnL = new Decimal(0);
  private peakValue = new Decimal(0);
  private currentValue = new Decimal(0);
  private positions: Map<string, PositionState> = new Map();
  private orderTimestamps: number[] = [];
  private lastTradeTime = 0;
  private dailyResetTime: number;

  constructor(limits: Partial<RiskLimits> = {}) {
    super();
    this.limits = { ...DEFAULT_RISK_LIMITS, ...limits };
    this.dailyResetTime = this.getNextDailyReset();
    
    logger.info('KillSwitchManager initialized', { limits: this.limits });
    
    // Set up daily reset timer
    this.scheduleDailyReset();
  }

  // ===========================================================================
  // Risk Checks
  // ===========================================================================

  /**
   * Check if an order is allowed given current risk state
   */
  checkOrder(order: OrderToCheck): RiskCheckResult {
    const warnings: string[] = [];
    const metrics = this.getMetrics();

    // Check if kill switch is already triggered
    if (this.triggered) {
      return {
        allowed: false,
        reason: `Kill switch active: ${this.triggerReason}`,
        failedCheck: 'kill_switch',
        metrics,
        warnings,
      };
    }

    // Check daily loss limit
    if (metrics.dailyPnL.lessThanOrEqualTo(this.limits.maxDailyLoss)) {
      this.trigger(`Daily loss limit exceeded: ${metrics.dailyPnL.toFixed(2)}`);
      return {
        allowed: false,
        reason: 'Daily loss limit exceeded',
        failedCheck: 'daily_loss',
        metrics: this.getMetrics(),
        warnings,
      };
    }

    // Check position size
    if (order.notional.greaterThan(this.limits.maxPositionSize)) {
      return {
        allowed: false,
        reason: `Position size ${order.notional.toFixed(2)} exceeds limit ${this.limits.maxPositionSize}`,
        failedCheck: 'position_size',
        metrics,
        warnings,
      };
    }

    // Check total exposure
    const newExposure = metrics.totalExposure.plus(order.notional);
    if (newExposure.greaterThan(this.limits.maxTotalExposure)) {
      return {
        allowed: false,
        reason: `Total exposure ${newExposure.toFixed(2)} would exceed limit ${this.limits.maxTotalExposure}`,
        failedCheck: 'total_exposure',
        metrics,
        warnings,
      };
    }

    // Check concentration
    const existingPosition = this.positions.get(order.symbol);
    const newPositionSize = existingPosition 
      ? existingPosition.notional.plus(order.notional)
      : order.notional;
    const concentration = newPositionSize.div(this.currentValue.isZero() ? 1 : this.currentValue);
    
    if (concentration.greaterThan(this.limits.maxConcentration)) {
      return {
        allowed: false,
        reason: `Concentration ${concentration.times(100).toFixed(1)}% exceeds limit ${this.limits.maxConcentration * 100}%`,
        failedCheck: 'concentration',
        metrics,
        warnings,
      };
    }

    // Check order rate
    this.cleanOldOrders();
    if (this.orderTimestamps.length >= this.limits.maxOrdersPerMinute) {
      return {
        allowed: false,
        reason: `Order rate limit: ${this.orderTimestamps.length} orders in last minute`,
        failedCheck: 'order_rate',
        metrics,
        warnings,
      };
    }

    // Check max positions (for new positions only)
    if (!existingPosition && metrics.openPositions >= this.limits.maxOpenPositions) {
      return {
        allowed: false,
        reason: `Max open positions (${this.limits.maxOpenPositions}) reached`,
        failedCheck: 'max_positions',
        metrics,
        warnings,
      };
    }

    // Check minimum time between trades
    const timeSinceLastTrade = Date.now() - this.lastTradeTime;
    if (timeSinceLastTrade < this.limits.minTimeBetweenTrades) {
      return {
        allowed: false,
        reason: `Minimum time between trades: ${this.limits.minTimeBetweenTrades}ms (${timeSinceLastTrade}ms since last)`,
        failedCheck: 'trade_frequency',
        metrics,
        warnings,
      };
    }

    // Check drawdown (warning only, not blocking new trades but warn)
    if (metrics.drawdown.greaterThan(this.limits.maxDrawdown * 0.8)) {
      warnings.push(`Approaching max drawdown: ${metrics.drawdown.times(100).toFixed(1)}%`);
    }

    // All checks passed
    // Add warning if getting close to limits
    if (metrics.dailyPnL.lessThan(this.limits.maxDailyLoss * 0.7)) {
      warnings.push(`Daily PnL approaching limit: ${metrics.dailyPnL.toFixed(2)}`);
    }
    
    if (newExposure.greaterThan(this.limits.maxTotalExposure * 0.8)) {
      warnings.push(`Total exposure at ${newExposure.div(this.limits.maxTotalExposure).times(100).toFixed(0)}% of limit`);
    }

    return {
      allowed: true,
      metrics,
      warnings,
    };
  }

  /**
   * Record an order (call after order is placed)
   */
  recordOrder(): void {
    this.orderTimestamps.push(Date.now());
    this.lastTradeTime = Date.now();
    this.cleanOldOrders();
  }

  /**
   * Check drawdown and trigger kill switch if exceeded
   */
  checkDrawdown(): boolean {
    const metrics = this.getMetrics();
    
    if (metrics.drawdown.greaterThan(this.limits.maxDrawdown)) {
      this.trigger(`Maximum drawdown exceeded: ${metrics.drawdown.times(100).toFixed(1)}%`);
      return true;
    }
    
    return false;
  }

  // ===========================================================================
  // Kill Switch Control
  // ===========================================================================

  /**
   * Manually trigger kill switch
   */
  trigger(reason: string, manual = false): void {
    if (this.triggered) {
      logger.warn('Kill switch already triggered', { existingReason: this.triggerReason });
      return;
    }

    this.triggered = true;
    this.triggerReason = reason;
    this.triggerTime = Date.now();

    const event: KillSwitchEvent = {
      reason,
      timestamp: this.triggerTime,
      metrics: this.getMetrics(),
      triggeredBy: manual ? 'manual' : 'auto',
    };

    logger.error('KILL SWITCH TRIGGERED', event as unknown as Record<string, unknown>);
    this.emit('triggered', event);
    
    // Emit to voice for spoken notification
    this.emit('speak', `Trading kill switch triggered: ${reason}. All trading halted.`);
  }

  /**
   * Reset kill switch (requires manual confirmation)
   */
  reset(confirmationCode: string): boolean {
    // Simple confirmation to prevent accidental reset
    const expectedCode = `RESET-${new Date().toISOString().split('T')[0]}`;
    
    if (confirmationCode !== expectedCode) {
      logger.warn('Invalid reset confirmation', { expected: expectedCode, received: confirmationCode });
      return false;
    }

    this.triggered = false;
    this.triggerReason = undefined;
    this.triggerTime = undefined;
    
    logger.info('Kill switch reset');
    this.emit('reset');
    
    return true;
  }

  /**
   * Check if kill switch is currently triggered
   */
  isTriggered(): boolean {
    return this.triggered;
  }

  /**
   * Get trigger reason if triggered
   */
  getTriggerReason(): string | undefined {
    return this.triggerReason;
  }

  // ===========================================================================
  // State Management
  // ===========================================================================

  /**
   * Update daily PnL (call on trade close or periodically)
   */
  updateDailyPnL(pnl: Decimal | number): void {
    this.dailyPnL = pnl instanceof Decimal ? pnl : new Decimal(pnl);
    
    // Check if loss limit hit
    if (this.dailyPnL.lessThanOrEqualTo(this.limits.maxDailyLoss)) {
      this.trigger(`Daily loss limit hit: ${this.dailyPnL.toFixed(2)}`);
    }
  }

  /**
   * Update portfolio value (call periodically)
   */
  updatePortfolioValue(value: Decimal | number): void {
    this.currentValue = value instanceof Decimal ? value : new Decimal(value);
    
    // Update peak
    if (this.currentValue.greaterThan(this.peakValue)) {
      this.peakValue = this.currentValue;
    }
    
    // Check drawdown
    this.checkDrawdown();
  }

  /**
   * Update position state
   */
  updatePosition(symbol: string, position: PositionState | null): void {
    if (position) {
      this.positions.set(symbol, position);
    } else {
      this.positions.delete(symbol);
    }
  }

  /**
   * Sync all positions at once
   */
  syncPositions(positions: PositionState[]): void {
    this.positions.clear();
    for (const pos of positions) {
      this.positions.set(pos.symbol, pos);
    }
  }

  /**
   * Get current risk metrics
   */
  getMetrics(): RiskMetrics {
    this.cleanOldOrders();
    
    // Calculate total exposure
    let totalExposure = new Decimal(0);
    let largestPosition = new Decimal(0);
    
    for (const pos of this.positions.values()) {
      totalExposure = totalExposure.plus(pos.notional.abs());
      if (pos.notional.abs().greaterThan(largestPosition)) {
        largestPosition = pos.notional.abs();
      }
    }
    
    // Calculate concentration
    const largestConcentration = this.currentValue.isZero() 
      ? new Decimal(0) 
      : largestPosition.div(this.currentValue);
    
    // Calculate drawdown
    const drawdown = this.peakValue.isZero() 
      ? new Decimal(0)
      : this.peakValue.minus(this.currentValue).div(this.peakValue);

    return {
      dailyPnL: this.dailyPnL,
      totalExposure,
      peakValue: this.peakValue,
      currentValue: this.currentValue,
      drawdown,
      openPositions: this.positions.size,
      recentOrderCount: this.orderTimestamps.length,
      largestConcentration,
      killSwitchActive: this.triggered,
      killSwitchReason: this.triggerReason,
      killSwitchTime: this.triggerTime,
    };
  }

  /**
   * Update risk limits
   */
  updateLimits(limits: Partial<RiskLimits>): void {
    this.limits = { ...this.limits, ...limits };
    logger.info('Risk limits updated', { limits: this.limits });
    this.emit('limits-updated', this.limits);
  }

  /**
   * Get current risk limits
   */
  getLimits(): RiskLimits {
    return { ...this.limits };
  }

  // ===========================================================================
  // Internal Helpers
  // ===========================================================================

  private cleanOldOrders(): void {
    const oneMinuteAgo = Date.now() - 60000;
    this.orderTimestamps = this.orderTimestamps.filter(t => t > oneMinuteAgo);
  }

  private getNextDailyReset(): number {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    return tomorrow.getTime();
  }

  private scheduleDailyReset(): void {
    const msUntilReset = this.dailyResetTime - Date.now();
    
    setTimeout(() => {
      this.dailyReset();
    }, msUntilReset);
  }

  private dailyReset(): void {
    logger.info('Daily risk metrics reset');
    this.dailyPnL = new Decimal(0);
    this.dailyResetTime = this.getNextDailyReset();
    this.emit('daily-reset');
    
    // Schedule next reset
    this.scheduleDailyReset();
  }

  /**
   * Emergency: Close all positions and halt trading
   * This should be called when kill switch triggers
   */
  async emergencyShutdown(): Promise<void> {
    this.trigger('Emergency shutdown initiated', true);
    this.emit('emergency-shutdown');
    
    logger.error('EMERGENCY SHUTDOWN - Kill switch manager requesting position closure');
    // Note: Actual position closure should be handled by the trading system
    // listening to the 'emergency-shutdown' event
  }

  /**
   * Shutdown the manager
   */
  shutdown(): void {
    logger.info('KillSwitchManager shutdown');
    this.removeAllListeners();
  }
}

// =============================================================================
// Singleton
// =============================================================================

let instance: KillSwitchManager | null = null;

/**
 * Get the kill switch manager singleton
 */
export function getKillSwitchManager(): KillSwitchManager {
  if (!instance) {
    instance = new KillSwitchManager();
  }
  return instance;
}

/**
 * Initialize kill switch manager with custom limits
 */
export function initializeKillSwitchManager(limits: Partial<RiskLimits>): KillSwitchManager {
  if (instance) {
    instance.updateLimits(limits);
  } else {
    instance = new KillSwitchManager(limits);
  }
  return instance;
}

export default KillSwitchManager;
