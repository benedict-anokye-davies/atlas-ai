/**
 * Atlas Autonomous Trading - Risk Manager
 * 
 * Comprehensive risk management including:
 * - Position sizing using Kelly Criterion / Fixed Fractional
 * - Dynamic stop loss / take profit management
 * - Trailing stop implementation
 * - Portfolio-level risk limits
 * - Kill switch triggers
 * - MEV protection awareness
 */

import { EventEmitter } from 'events';
import Decimal from 'decimal.js';
import { createModuleLogger } from '../../utils/logger';
import {
  RiskLimits,
  RiskMetrics,
  KillSwitchConfig,
  KillSwitchStatus,
  Signal,
  Position,
  OrderSide,
} from './types';

const logger = createModuleLogger('RiskManager');

// ============================================================================
// Position Sizing Strategies
// ============================================================================

type SizingMethod = 'fixed' | 'fixed_fractional' | 'kelly' | 'volatility_adjusted' | 'atr_based';

interface SizingConfig {
  method: SizingMethod;
  fixedSize?: Decimal;
  riskPercent?: Decimal;     // For fixed fractional
  kellyFraction?: Decimal;   // Fraction of full Kelly (usually 0.25-0.5)
  maxSizePercent?: Decimal;  // Cap on position size
  volatilityPeriod?: number; // For volatility-adjusted
  atrMultiplier?: Decimal;   // For ATR-based stops
}

interface SizingInput {
  accountEquity: Decimal;
  entryPrice: Decimal;
  stopLoss?: Decimal;
  winRate?: Decimal;           // Historical win rate
  avgWinLoss?: Decimal;        // Average win/loss ratio
  currentVolatility?: Decimal; // Current ATR or std dev
  avgVolatility?: Decimal;     // Historical average volatility
}

class PositionSizer {
  /**
   * Fixed position size
   */
  static fixed(config: SizingConfig, _input: SizingInput): Decimal {
    return config.fixedSize || new Decimal(100);
  }

  /**
   * Fixed Fractional - risk fixed % of account per trade
   */
  static fixedFractional(config: SizingConfig, input: SizingInput): Decimal {
    const riskPercent = config.riskPercent || new Decimal(1);
    const riskAmount = input.accountEquity.times(riskPercent).div(100);
    
    if (!input.stopLoss || input.stopLoss.equals(input.entryPrice)) {
      // If no stop loss, use default 2% risk
      const assumedStopDistance = input.entryPrice.times(0.02);
      return riskAmount.div(assumedStopDistance);
    }
    
    const stopDistance = input.entryPrice.minus(input.stopLoss).abs();
    const positionSize = riskAmount.div(stopDistance);
    
    return this.applyMaxSize(positionSize, config, input);
  }

  /**
   * Kelly Criterion - optimal sizing based on edge
   */
  static kelly(config: SizingConfig, input: SizingInput): Decimal {
    const winRate = input.winRate || new Decimal(0.5);
    const avgWinLoss = input.avgWinLoss || new Decimal(1.5);
    
    // Kelly formula: f* = (p * b - q) / b
    // p = probability of win, b = win/loss ratio, q = 1 - p
    const p = winRate;
    const q = new Decimal(1).minus(p);
    const b = avgWinLoss;
    
    let kellyPercent = p.times(b).minus(q).div(b);
    
    // Apply fractional Kelly (safer)
    const fraction = config.kellyFraction || new Decimal(0.25);
    kellyPercent = kellyPercent.times(fraction);
    
    // Ensure positive and bounded
    kellyPercent = Decimal.max(new Decimal(0), Decimal.min(kellyPercent, new Decimal(25)));
    
    const positionValue = input.accountEquity.times(kellyPercent).div(100);
    const positionSize = positionValue.div(input.entryPrice);
    
    return this.applyMaxSize(positionSize, config, input);
  }

  /**
   * Volatility-adjusted sizing - reduce size in high volatility
   */
  static volatilityAdjusted(config: SizingConfig, input: SizingInput): Decimal {
    // Start with fixed fractional base
    let baseSize = this.fixedFractional(config, input);
    
    if (input.currentVolatility && input.avgVolatility && !input.avgVolatility.isZero()) {
      // Adjust based on volatility ratio
      const volRatio = input.currentVolatility.div(input.avgVolatility);
      
      // If vol is 2x average, halve position size
      // If vol is 0.5x average, 1.5x position size (capped)
      const adjustment = new Decimal(1).div(volRatio);
      const cappedAdjustment = Decimal.max(new Decimal(0.25), Decimal.min(adjustment, new Decimal(1.5)));
      
      baseSize = baseSize.times(cappedAdjustment);
    }
    
    return this.applyMaxSize(baseSize, config, input);
  }

  /**
   * ATR-based sizing - position size based on ATR stop
   */
  static atrBased(config: SizingConfig, input: SizingInput): Decimal {
    const riskPercent = config.riskPercent || new Decimal(1);
    const riskAmount = input.accountEquity.times(riskPercent).div(100);
    
    if (!input.currentVolatility) {
      // Fallback to fixed fractional
      return this.fixedFractional(config, input);
    }
    
    const atrMultiplier = config.atrMultiplier || new Decimal(2);
    const stopDistance = input.currentVolatility.times(atrMultiplier);
    const positionSize = riskAmount.div(stopDistance);
    
    return this.applyMaxSize(positionSize, config, input);
  }

  /**
   * Apply maximum size constraint
   */
  private static applyMaxSize(size: Decimal, config: SizingConfig, input: SizingInput): Decimal {
    const maxPercent = config.maxSizePercent || new Decimal(10);
    const maxPositionValue = input.accountEquity.times(maxPercent).div(100);
    const maxSize = maxPositionValue.div(input.entryPrice);
    
    return Decimal.min(size, maxSize);
  }

  /**
   * Calculate position size using specified method
   */
  static calculate(config: SizingConfig, input: SizingInput): Decimal {
    switch (config.method) {
      case 'fixed':
        return this.fixed(config, input);
      case 'fixed_fractional':
        return this.fixedFractional(config, input);
      case 'kelly':
        return this.kelly(config, input);
      case 'volatility_adjusted':
        return this.volatilityAdjusted(config, input);
      case 'atr_based':
        return this.atrBased(config, input);
      default:
        return this.fixedFractional(config, input);
    }
  }
}

// ============================================================================
// Stop Loss Management
// ============================================================================

type StopType = 'fixed' | 'trailing' | 'atr' | 'breakeven' | 'time';

interface StopConfig {
  type: StopType;
  value: Decimal;          // Percent or absolute value
  trailingStep?: Decimal;  // Minimum move before trailing
  activationPrice?: Decimal; // Price at which stop activates
  timeoutMinutes?: number; // For time-based stop
}

interface StopState {
  currentStop: Decimal;
  highestPrice: Decimal;  // For long positions
  lowestPrice: Decimal;   // For short positions
  activatedAt?: number;
  breakevenSet: boolean;
}

class StopLossManager {
  private stops: Map<string, { config: StopConfig; state: StopState }> = new Map();

  /**
   * Initialize stop for a position
   */
  initializeStop(
    positionId: string,
    side: OrderSide,
    entryPrice: Decimal,
    config: StopConfig
  ): Decimal {
    const initialStop = this.calculateInitialStop(side, entryPrice, config);
    
    const state: StopState = {
      currentStop: initialStop,
      highestPrice: entryPrice,
      lowestPrice: entryPrice,
      breakevenSet: false,
    };

    this.stops.set(positionId, { config, state });
    
    return initialStop;
  }

  /**
   * Update stop based on new price
   */
  updateStop(positionId: string, currentPrice: Decimal, side: OrderSide): Decimal | null {
    const stop = this.stops.get(positionId);
    if (!stop) return null;

    const { config, state } = stop;

    // Update high/low
    if (side === 'buy') {
      state.highestPrice = Decimal.max(state.highestPrice, currentPrice);
    } else {
      state.lowestPrice = Decimal.min(state.lowestPrice, currentPrice);
    }

    // Handle different stop types
    switch (config.type) {
      case 'trailing':
        state.currentStop = this.calculateTrailingStop(side, currentPrice, state, config);
        break;
      case 'breakeven':
        if (!state.breakevenSet && config.activationPrice) {
          const inProfit = side === 'buy' 
            ? currentPrice.greaterThanOrEqualTo(config.activationPrice)
            : currentPrice.lessThanOrEqualTo(config.activationPrice);
          
          if (inProfit) {
            // Move stop to breakeven (entry price)
            state.currentStop = side === 'buy' ? state.lowestPrice : state.highestPrice;
            state.breakevenSet = true;
          }
        }
        break;
      // Fixed and ATR stops don't change after initialization
    }

    return state.currentStop;
  }

  /**
   * Check if stop has been triggered
   */
  isStopTriggered(positionId: string, currentPrice: Decimal, side: OrderSide): boolean {
    const stop = this.stops.get(positionId);
    if (!stop) return false;

    const { state } = stop;

    if (side === 'buy') {
      return currentPrice.lessThanOrEqualTo(state.currentStop);
    } else {
      return currentPrice.greaterThanOrEqualTo(state.currentStop);
    }
  }

  /**
   * Remove stop when position is closed
   */
  removeStop(positionId: string): void {
    this.stops.delete(positionId);
  }

  private calculateInitialStop(side: OrderSide, entryPrice: Decimal, config: StopConfig): Decimal {
    switch (config.type) {
      case 'fixed':
      case 'trailing':
      case 'breakeven':
        // Value is percentage
        const distance = entryPrice.times(config.value).div(100);
        return side === 'buy' 
          ? entryPrice.minus(distance) 
          : entryPrice.plus(distance);
      
      case 'atr':
        // Value is ATR multiplier, but we need ATR passed in
        // For now, treat as percentage
        const atrDistance = entryPrice.times(config.value).div(100);
        return side === 'buy'
          ? entryPrice.minus(atrDistance)
          : entryPrice.plus(atrDistance);
      
      default:
        return side === 'buy'
          ? entryPrice.times(0.95) // 5% default
          : entryPrice.times(1.05);
    }
  }

  private calculateTrailingStop(
    side: OrderSide,
    currentPrice: Decimal,
    state: StopState,
    config: StopConfig
  ): Decimal {
    const trailPercent = config.value;
    
    if (side === 'buy') {
      // Long position - trail below highest price
      const trailDistance = state.highestPrice.times(trailPercent).div(100);
      const newStop = state.highestPrice.minus(trailDistance);
      
      // Only move stop up, never down
      return Decimal.max(state.currentStop, newStop);
    } else {
      // Short position - trail above lowest price
      const trailDistance = state.lowestPrice.times(trailPercent).div(100);
      const newStop = state.lowestPrice.plus(trailDistance);
      
      // Only move stop down, never up
      return Decimal.min(state.currentStop, newStop);
    }
  }
}

// ============================================================================
// Risk Manager
// ============================================================================

interface RiskManagerConfig {
  limits: RiskLimits;
  killSwitch: KillSwitchConfig;
  sizingConfig: SizingConfig;
  defaultStopConfig: StopConfig;
  mevProtection: boolean;
  minLiquidityUsd: Decimal;
  maxSlippagePercent: Decimal;
}

const DEFAULT_CONFIG: RiskManagerConfig = {
  limits: {
    maxPositionSizeUsd: new Decimal(1000),
    maxPositionSizePercent: new Decimal(10),
    maxTotalExposureUsd: new Decimal(5000),
    maxTotalExposurePercent: new Decimal(80),
    maxDailyLossUsd: new Decimal(500),
    maxDailyLossPercent: new Decimal(5),
    maxWeeklyLossPercent: new Decimal(15),
    maxDrawdownPercent: new Decimal(20),
    maxConsecutiveLosses: 5,
    maxLeverage: new Decimal(1),
    maxOpenPositions: 10,
    maxOrdersPerMinute: 10,
    maxOrdersPerHour: 100,
  },
  killSwitch: {
    enabled: true,
    triggers: [
      { id: 'daily_loss', type: 'daily_loss', threshold: new Decimal(5), enabled: true },
      { id: 'drawdown', type: 'drawdown', threshold: new Decimal(20), enabled: true },
    ],
    actions: ['pause_trading', 'notify_user'],
    cooldownMinutes: 60,
    notifyOnTrigger: true,
    requireManualReset: true,
  },
  sizingConfig: {
    method: 'fixed_fractional',
    riskPercent: new Decimal(1),
    maxSizePercent: new Decimal(10),
  },
  defaultStopConfig: {
    type: 'trailing',
    value: new Decimal(3), // 3% trailing stop
  },
  mevProtection: true,
  minLiquidityUsd: new Decimal(100000),
  maxSlippagePercent: new Decimal(1),
};

export class RiskManager extends EventEmitter {
  private config: RiskManagerConfig;
  private stopManager: StopLossManager;
  
  // Tracking
  private dailyPnl: Decimal = new Decimal(0);
  private weeklyPnl: Decimal = new Decimal(0);
  private peakEquity: Decimal = new Decimal(0);
  private currentEquity: Decimal = new Decimal(0);
  private consecutiveLosses: number = 0;
  private ordersThisMinute: number = 0;
  private ordersThisHour: number = 0;
  
  // Kill switch
  private killSwitchTriggered: boolean = false;
  private killSwitchStatus: KillSwitchStatus = {
    triggered: false,
    actionsExecuted: [],
    canResume: true,
  };
  
  // Rate limiting
  private lastMinuteReset: number = Date.now();
  private lastHourReset: number = Date.now();

  constructor(config: Partial<RiskManagerConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.stopManager = new StopLossManager();
  }

  // ===========================================================================
  // Position Sizing
  // ===========================================================================

  calculatePositionSize(signal: Signal, accountEquity: Decimal): Decimal {
    const input: SizingInput = {
      accountEquity,
      entryPrice: signal.currentPrice,
      stopLoss: signal.suggestedStopLoss,
    };

    const size = PositionSizer.calculate(this.config.sizingConfig, input);
    
    // Apply additional limits
    const maxByLimit = this.config.limits.maxPositionSizeUsd.div(signal.currentPrice);
    const maxByPercent = accountEquity.times(this.config.limits.maxPositionSizePercent).div(100).div(signal.currentPrice);
    
    return Decimal.min(size, maxByLimit, maxByPercent);
  }

  // ===========================================================================
  // Trade Validation
  // ===========================================================================

  validateTrade(
    signal: Signal,
    positionSize: Decimal,
    accountEquity: Decimal,
    currentExposure: Decimal,
    openPositions: number
  ): { valid: boolean; reason?: string } {
    // Check kill switch
    if (this.killSwitchTriggered) {
      return { valid: false, reason: 'Kill switch triggered' };
    }

    // Check position count
    if (openPositions >= this.config.limits.maxOpenPositions) {
      return { valid: false, reason: 'Maximum positions reached' };
    }

    // Check exposure limits
    const tradeValue = positionSize.times(signal.currentPrice);
    const newExposure = currentExposure.plus(tradeValue);
    
    if (newExposure.greaterThan(this.config.limits.maxTotalExposureUsd)) {
      return { valid: false, reason: 'Would exceed max exposure' };
    }

    const exposurePercent = newExposure.div(accountEquity).times(100);
    if (exposurePercent.greaterThan(this.config.limits.maxTotalExposurePercent)) {
      return { valid: false, reason: 'Would exceed max exposure percent' };
    }

    // Check rate limits
    this.updateRateLimits();
    if (this.ordersThisMinute >= this.config.limits.maxOrdersPerMinute) {
      return { valid: false, reason: 'Rate limit: orders per minute' };
    }
    if (this.ordersThisHour >= this.config.limits.maxOrdersPerHour) {
      return { valid: false, reason: 'Rate limit: orders per hour' };
    }

    // Check slippage estimate
    if (signal.metadata?.estimatedSlippage) {
      const slippage = new Decimal(signal.metadata.estimatedSlippage as string);
      if (slippage.greaterThan(this.config.maxSlippagePercent)) {
        return { valid: false, reason: 'Estimated slippage too high' };
      }
    }

    return { valid: true };
  }

  // ===========================================================================
  // Stop Loss Management
  // ===========================================================================

  initializePositionStop(
    positionId: string,
    side: OrderSide,
    entryPrice: Decimal,
    stopConfig?: StopConfig
  ): Decimal {
    return this.stopManager.initializeStop(
      positionId,
      side,
      entryPrice,
      stopConfig || this.config.defaultStopConfig
    );
  }

  updatePositionStop(positionId: string, currentPrice: Decimal, side: OrderSide): Decimal | null {
    return this.stopManager.updateStop(positionId, currentPrice, side);
  }

  isStopTriggered(positionId: string, currentPrice: Decimal, side: OrderSide): boolean {
    return this.stopManager.isStopTriggered(positionId, currentPrice, side);
  }

  removePositionStop(positionId: string): void {
    this.stopManager.removeStop(positionId);
  }

  // ===========================================================================
  // Risk Monitoring
  // ===========================================================================

  updateMetrics(pnl: Decimal, isWin: boolean, newEquity: Decimal): void {
    // Update P&L tracking
    this.dailyPnl = this.dailyPnl.plus(pnl);
    this.weeklyPnl = this.weeklyPnl.plus(pnl);
    this.currentEquity = newEquity;

    // Update peak equity
    if (newEquity.greaterThan(this.peakEquity)) {
      this.peakEquity = newEquity;
    }

    // Update consecutive losses
    if (isWin) {
      this.consecutiveLosses = 0;
    } else {
      this.consecutiveLosses++;
    }

    // Check risk limits
    this.checkRiskLimits();
  }

  private checkRiskLimits(): void {
    if (!this.config.killSwitch.enabled) return;

    for (const trigger of this.config.killSwitch.triggers) {
      if (!trigger.enabled) continue;

      let triggered = false;
      let reason = '';

      switch (trigger.type) {
        case 'daily_loss': {
          const dailyLossPercent = this.dailyPnl.negated().div(this.peakEquity).times(100);
          if (dailyLossPercent.greaterThan(trigger.threshold)) {
            triggered = true;
            reason = `Daily loss ${dailyLossPercent.toFixed(2)}% > ${trigger.threshold}%`;
          }
          break;
        }

        case 'drawdown': {
          const drawdown = this.peakEquity.minus(this.currentEquity).div(this.peakEquity).times(100);
          if (drawdown.greaterThan(trigger.threshold)) {
            triggered = true;
            reason = `Drawdown ${drawdown.toFixed(2)}% > ${trigger.threshold}%`;
          }
          break;
        }

        case 'consecutive_losses': {
          if (this.consecutiveLosses >= trigger.threshold.toNumber()) {
            triggered = true;
            reason = `${this.consecutiveLosses} consecutive losses >= ${trigger.threshold}`;
          }
          break;
        }

        case 'weekly_loss': {
          const weeklyLossPercent = this.weeklyPnl.negated().div(this.peakEquity).times(100);
          if (weeklyLossPercent.greaterThan(trigger.threshold)) {
            triggered = true;
            reason = `Weekly loss ${weeklyLossPercent.toFixed(2)}% > ${trigger.threshold}%`;
          }
          break;
        }
      }

      if (triggered) {
        this.triggerKillSwitch(trigger, reason);
        break;
      }
    }
  }

  private triggerKillSwitch(
    trigger: KillSwitchConfig['triggers'][0],
    reason: string
  ): void {
    logger.warn('KILL SWITCH TRIGGERED', { trigger, reason });

    this.killSwitchTriggered = true;
    this.killSwitchStatus = {
      triggered: true,
      triggeredAt: Date.now(),
      trigger,
      reason,
      actionsExecuted: [...this.config.killSwitch.actions],
      cooldownEndsAt: Date.now() + this.config.killSwitch.cooldownMinutes * 60 * 1000,
      canResume: !this.config.killSwitch.requireManualReset,
    };

    this.emit('killswitch', this.killSwitchStatus);
  }

  resetKillSwitch(): boolean {
    if (!this.killSwitchTriggered) return true;

    if (this.config.killSwitch.requireManualReset) {
      // Manual reset
      this.killSwitchTriggered = false;
      this.killSwitchStatus = {
        triggered: false,
        actionsExecuted: [],
        canResume: true,
      };
      logger.info('Kill switch manually reset');
      return true;
    }

    // Check cooldown
    if (this.killSwitchStatus.cooldownEndsAt && Date.now() < this.killSwitchStatus.cooldownEndsAt) {
      const remaining = Math.ceil((this.killSwitchStatus.cooldownEndsAt - Date.now()) / 60000);
      logger.info('Kill switch cooldown active', { remainingMinutes: remaining });
      return false;
    }

    this.killSwitchTriggered = false;
    this.killSwitchStatus.canResume = true;
    logger.info('Kill switch reset after cooldown');
    return true;
  }

  // ===========================================================================
  // MEV Protection
  // ===========================================================================

  assessMevRisk(
    symbol: string,
    side: OrderSide,
    size: Decimal,
    currentPrice: Decimal,
    recentPriceChanges: Decimal[]
  ): { safe: boolean; reason?: string; recommendation?: string } {
    if (!this.config.mevProtection) {
      return { safe: true };
    }

    // Check for suspicious price movements (potential sandwich attack)
    if (recentPriceChanges.length >= 2) {
      const lastChange = recentPriceChanges[recentPriceChanges.length - 1];
      const prevChange = recentPriceChanges[recentPriceChanges.length - 2];

      // Rapid price reversal pattern
      if (lastChange.times(prevChange).isNegative()) {
        const changeSize = lastChange.abs().plus(prevChange.abs());
        if (changeSize.greaterThan(1)) { // > 1% total
          return {
            safe: false,
            reason: 'Suspicious price reversal pattern detected',
            recommendation: 'Wait for price to stabilize',
          };
        }
      }
    }

    // Check order size relative to typical volume
    // In production, would check actual order book depth
    const tradeValue = size.times(currentPrice);
    if (tradeValue.greaterThan(this.config.minLiquidityUsd.div(10))) {
      return {
        safe: true,
        recommendation: 'Consider splitting into smaller orders',
      };
    }

    return { safe: true };
  }

  // ===========================================================================
  // Metrics & Status
  // ===========================================================================

  getMetrics(): RiskMetrics {
    const drawdown = this.peakEquity.greaterThan(0)
      ? this.peakEquity.minus(this.currentEquity).div(this.peakEquity).times(100)
      : new Decimal(0);

    const dailyLossPercent = this.peakEquity.greaterThan(0)
      ? this.dailyPnl.div(this.peakEquity).times(100)
      : new Decimal(0);

    const weeklyLossPercent = this.peakEquity.greaterThan(0)
      ? this.weeklyPnl.div(this.peakEquity).times(100)
      : new Decimal(0);

    return {
      currentExposure: new Decimal(0), // Would need position data
      exposurePercent: new Decimal(0),
      dailyPnl: this.dailyPnl,
      dailyPnlPercent: dailyLossPercent,
      weeklyPnl: this.weeklyPnl,
      weeklyPnlPercent: weeklyLossPercent,
      currentDrawdown: this.peakEquity.minus(this.currentEquity),
      currentDrawdownPercent: drawdown,
      maxDrawdownToday: drawdown, // Simplified
      consecutiveLosses: this.consecutiveLosses,
      openPositions: 0,
      pendingOrders: 0,
      leverage: new Decimal(1),
      marginUsed: new Decimal(0),
      marginAvailable: this.currentEquity,
      liquidationRisk: new Decimal(0),
      riskScore: this.calculateRiskScore(drawdown),
    };
  }

  getKillSwitchStatus(): KillSwitchStatus {
    return { ...this.killSwitchStatus };
  }

  isKillSwitchTriggered(): boolean {
    return this.killSwitchTriggered;
  }

  private calculateRiskScore(drawdownPercent: Decimal): number {
    // Risk score 0-100
    let score = 0;

    // Drawdown contribution (0-40 points)
    score += Math.min(40, drawdownPercent.toNumber() * 2);

    // Consecutive losses contribution (0-30 points)
    score += Math.min(30, this.consecutiveLosses * 6);

    // Daily loss contribution (0-30 points)
    const dailyLossPercent = this.dailyPnl.negated().div(this.peakEquity || 1).times(100);
    score += Math.min(30, dailyLossPercent.toNumber() * 6);

    return Math.round(score);
  }

  private updateRateLimits(): void {
    const now = Date.now();

    if (now - this.lastMinuteReset > 60000) {
      this.ordersThisMinute = 0;
      this.lastMinuteReset = now;
    }

    if (now - this.lastHourReset > 3600000) {
      this.ordersThisHour = 0;
      this.lastHourReset = now;
    }
  }

  recordOrder(): void {
    this.updateRateLimits();
    this.ordersThisMinute++;
    this.ordersThisHour++;
  }

  // ===========================================================================
  // Configuration
  // ===========================================================================

  updateConfig(updates: Partial<RiskManagerConfig>): void {
    this.config = { ...this.config, ...updates };
    logger.info('Risk manager config updated');
  }

  getLimits(): RiskLimits {
    return { ...this.config.limits };
  }

  setEquity(equity: Decimal): void {
    this.currentEquity = equity;
    if (equity.greaterThan(this.peakEquity)) {
      this.peakEquity = equity;
    }
  }

  resetDaily(): void {
    this.dailyPnl = new Decimal(0);
    logger.info('Daily P&L reset');
  }

  resetWeekly(): void {
    this.weeklyPnl = new Decimal(0);
    logger.info('Weekly P&L reset');
  }
}

// Singleton
let riskManager: RiskManager | null = null;

export function getRiskManager(): RiskManager {
  if (!riskManager) {
    riskManager = new RiskManager();
  }
  return riskManager;
}

export function createRiskManager(config: Partial<RiskManagerConfig>): RiskManager {
  riskManager = new RiskManager(config);
  return riskManager;
}

// Export components
export { PositionSizer, StopLossManager };
export type { SizingMethod, SizingConfig, SizingInput, StopType, StopConfig, StopState };
