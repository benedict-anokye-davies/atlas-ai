/**
 * Atlas Trading - Autonomous Trading Bot
 *
 * Fully autonomous trading system with:
 * - Multi-exchange support
 * - Strategy management
 * - Risk management
 * - Position sizing
 * - Trade execution
 *
 * @module trading/strategies/autonomous-bot
 */

import Decimal from 'decimal.js';
import { EventEmitter } from 'events';
import { createModuleLogger } from '../../utils/logger';
import { BaseExchange } from '../exchanges/base';
import { Order, Position, ExchangeId } from '../types';

const logger = createModuleLogger('AutonomousBot');

// ============================================================================
// Types
// ============================================================================

export type SignalType = 'long' | 'short' | 'close' | 'hold';
export type TimeFrame = '1m' | '5m' | '15m' | '1h' | '4h' | '1d' | '1w';

export interface TradingSignal {
  id: string;
  timestamp: number;
  exchange: ExchangeId;
  symbol: string;
  type: SignalType;
  confidence: number; // 0-1
  strategy: string;
  timeframe: TimeFrame;
  entryPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  reason: string;
  indicators?: Record<string, number>;
}

export interface RiskParameters {
  /** Maximum risk per trade as % of portfolio (default: 1%) */
  maxRiskPerTrade: number;
  /** Maximum total portfolio risk (default: 5%) */
  maxTotalRisk: number;
  /** Maximum position size as % of portfolio (default: 10%) */
  maxPositionSize: number;
  /** Maximum number of concurrent positions (default: 5) */
  maxPositions: number;
  /** Maximum daily loss before stopping (default: 3%) */
  maxDailyLoss: number;
  /** Maximum drawdown before stopping (default: 10%) */
  maxDrawdown: number;
  /** Minimum confidence to take trade (default: 0.7) */
  minConfidence: number;
  /** Use trailing stops */
  useTrailingStops: boolean;
  /** Trailing stop distance as ATR multiple */
  trailingStopATR: number;
}

export interface BotConfig {
  /** Bot name/identifier */
  name: string;
  /** Enabled exchanges */
  exchanges: ExchangeId[];
  /** Trading pairs to monitor */
  symbols: string[];
  /** Timeframes to analyze */
  timeframes: TimeFrame[];
  /** Risk parameters */
  risk: RiskParameters;
  /** Whether bot is active */
  active: boolean;
  /** Dry run mode (no real trades) */
  dryRun: boolean;
  /** Strategies to use */
  strategies: string[];
  /** Check interval in ms */
  checkInterval: number;
}

export interface BotState {
  /** Is bot running */
  running: boolean;
  /** Current positions */
  positions: Position[];
  /** Open orders */
  openOrders: Order[];
  /** Today's P&L */
  dailyPnl: Decimal;
  /** Total P&L */
  totalPnl: Decimal;
  /** Current drawdown % */
  drawdown: number;
  /** Trade count today */
  tradesToday: number;
  /** Win count */
  wins: number;
  /** Loss count */
  losses: number;
  /** Last signal */
  lastSignal?: TradingSignal;
  /** Last error */
  lastError?: string;
}

export interface TradeExecution {
  signal: TradingSignal;
  order: Order;
  positionSize: Decimal;
  risk: Decimal;
  timestamp: number;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_RISK: RiskParameters = {
  maxRiskPerTrade: 0.01, // 1%
  maxTotalRisk: 0.05, // 5%
  maxPositionSize: 0.1, // 10%
  maxPositions: 5,
  maxDailyLoss: 0.03, // 3%
  maxDrawdown: 0.1, // 10%
  minConfidence: 0.7,
  useTrailingStops: true,
  trailingStopATR: 2,
};

const DEFAULT_CONFIG: BotConfig = {
  name: 'JARVIS-Bot',
  exchanges: ['binance'],
  symbols: ['BTC/USDT', 'ETH/USDT'],
  timeframes: ['1h', '4h'],
  risk: DEFAULT_RISK,
  active: false,
  dryRun: true,
  strategies: ['momentum', 'mean-reversion'],
  checkInterval: 60000, // 1 minute
};

// ============================================================================
// Autonomous Bot
// ============================================================================

export class AutonomousBot extends EventEmitter {
  private config: BotConfig;
  private state: BotState;
  private exchanges: Map<ExchangeId, BaseExchange> = new Map();
  private checkTimer: NodeJS.Timeout | null = null;
  private startingBalance: Decimal = new Decimal(0);
  private peakBalance: Decimal = new Decimal(0);

  constructor(config: Partial<BotConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config, risk: { ...DEFAULT_RISK, ...config.risk } };
    this.state = {
      running: false,
      positions: [],
      openOrders: [],
      dailyPnl: new Decimal(0),
      totalPnl: new Decimal(0),
      drawdown: 0,
      tradesToday: 0,
      wins: 0,
      losses: 0,
    };
    logger.info('AutonomousBot created', { name: this.config.name, dryRun: this.config.dryRun });
  }

  // ==========================================================================
  // Exchange Management
  // ==========================================================================

  /**
   * Register an exchange
   */
  registerExchange(exchange: BaseExchange): void {
    this.exchanges.set(exchange.id, exchange);
    logger.info('Exchange registered', { exchange: exchange.id });
  }

  /**
   * Get registered exchange
   */
  getExchange(id: ExchangeId): BaseExchange | undefined {
    return this.exchanges.get(id);
  }

  // ==========================================================================
  // Bot Lifecycle
  // ==========================================================================

  /**
   * Start the bot
   */
  async start(): Promise<void> {
    if (this.state.running) {
      logger.warn('Bot already running');
      return;
    }

    logger.info('Starting autonomous bot', { name: this.config.name });

    // Initialize state
    await this.syncState();
    
    // Calculate starting balance
    this.startingBalance = await this.getTotalBalance();
    this.peakBalance = this.startingBalance;

    // Start check loop
    this.state.running = true;
    this.checkTimer = setInterval(() => this.runCycle(), this.config.checkInterval);

    // Run first cycle immediately
    await this.runCycle();

    this.emit('started', { name: this.config.name });
    logger.info('Bot started', { 
      name: this.config.name, 
      startingBalance: this.startingBalance.toString(),
      dryRun: this.config.dryRun 
    });
  }

  /**
   * Stop the bot
   */
  async stop(): Promise<void> {
    if (!this.state.running) {
      logger.warn('Bot not running');
      return;
    }

    logger.info('Stopping autonomous bot', { name: this.config.name });

    // Stop check loop
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }

    this.state.running = false;
    this.emit('stopped', { name: this.config.name });
    logger.info('Bot stopped', { name: this.config.name });
  }

  /**
   * Emergency stop - close all positions
   */
  async emergencyStop(): Promise<void> {
    logger.warn('EMERGENCY STOP triggered', { name: this.config.name });
    
    await this.stop();

    // Close all positions
    for (const position of this.state.positions) {
      try {
        await this.closePosition(position);
      } catch (error) {
        logger.error('Failed to close position during emergency stop', {
          position: position.symbol,
          error: (error as Error).message,
        });
      }
    }

    // Cancel all orders
    for (const order of this.state.openOrders) {
      try {
        const exchange = this.exchanges.get(order.exchange);
        if (exchange) {
          await exchange.cancelOrder(order.id, order.symbol);
        }
      } catch (error) {
        logger.error('Failed to cancel order during emergency stop', {
          order: order.id,
          error: (error as Error).message,
        });
      }
    }

    this.emit('emergency-stop', { name: this.config.name });
  }

  // ==========================================================================
  // Main Loop
  // ==========================================================================

  /**
   * Run one cycle of the bot
   */
  private async runCycle(): Promise<void> {
    if (!this.state.running) return;

    try {
      // 1. Sync state
      await this.syncState();

      // 2. Check risk limits
      if (await this.checkRiskLimits()) {
        logger.warn('Risk limits exceeded, pausing trading');
        return;
      }

      // 3. Generate signals for each symbol
      for (const symbol of this.config.symbols) {
        for (const exchange of this.config.exchanges) {
          const signal = await this.generateSignal(exchange, symbol);
          if (signal && signal.type !== 'hold') {
            await this.processSignal(signal);
          }
        }
      }

      // 4. Manage existing positions (trailing stops, etc.)
      await this.managePositions();

    } catch (error) {
      const err = error as Error;
      this.state.lastError = err.message;
      logger.error('Bot cycle error', { error: err.message });
      this.emit('error', { error: err });
    }
  }

  // ==========================================================================
  // Signal Generation
  // ==========================================================================

  /**
   * Generate trading signal for a symbol
   */
  private async generateSignal(exchangeId: ExchangeId, symbol: string): Promise<TradingSignal | null> {
    const exchange = this.exchanges.get(exchangeId);
    if (!exchange || !exchange.isConnected()) {
      return null;
    }

    try {
      // Fetch OHLCV data for analysis
      const candles: Record<TimeFrame, Array<{ timestamp: number; open: number; high: number; low: number; close: number; volume: number }>> = {} as Record<TimeFrame, Array<{ timestamp: number; open: number; high: number; low: number; close: number; volume: number }>>;
      for (const tf of this.config.timeframes) {
        const ohlcv = await exchange.fetchOHLCV(symbol, tf, 100);
        candles[tf] = ohlcv.map(c => ({
          timestamp: c.timestamp,
          open: c.open.toNumber(),
          high: c.high.toNumber(),
          low: c.low.toNumber(),
          close: c.close.toNumber(),
          volume: c.volume.toNumber(),
        }));
      }

      // Run strategy analysis
      const signals: TradingSignal[] = [];
      
      for (const strategyName of this.config.strategies) {
        const signal = await this.runStrategy(strategyName, exchangeId, symbol, candles);
        if (signal) {
          signals.push(signal);
        }
      }

      // Combine signals (consensus)
      if (signals.length === 0) return null;

      const combinedSignal = this.combineSignals(signals, exchangeId, symbol);
      return combinedSignal;

    } catch (error) {
      logger.error('Signal generation failed', {
        exchange: exchangeId,
        symbol,
        error: (error as Error).message,
      });
      return null;
    }
  }

  /**
   * Run a specific strategy
   */
  private async runStrategy(
    strategyName: string,
    exchangeId: ExchangeId,
    symbol: string,
    candles: Record<TimeFrame, Array<{ timestamp: number; open: number; high: number; low: number; close: number; volume: number }>>
  ): Promise<TradingSignal | null> {
    const primaryTf = this.config.timeframes[0];
    const data = candles[primaryTf];
    if (!data || data.length < 50) return null;

    const closes = data.map(c => c.close);
    const highs = data.map(c => c.high);
    const lows = data.map(c => c.low);
    const volumes = data.map(c => c.volume);

    switch (strategyName) {
      case 'momentum':
        return this.momentumStrategy(exchangeId, symbol, closes, highs, lows, volumes, primaryTf);
      case 'mean-reversion':
        return this.meanReversionStrategy(exchangeId, symbol, closes, highs, lows, primaryTf);
      case 'breakout':
        return this.breakoutStrategy(exchangeId, symbol, closes, highs, lows, volumes, primaryTf);
      case 'trend-following':
        return this.trendFollowingStrategy(exchangeId, symbol, closes, primaryTf);
      default:
        return null;
    }
  }

  // ==========================================================================
  // Trading Strategies
  // ==========================================================================

  /**
   * Momentum strategy - RSI + MACD
   */
  private momentumStrategy(
    exchangeId: ExchangeId,
    symbol: string,
    closes: number[],
    highs: number[],
    lows: number[],
    volumes: number[],
    timeframe: TimeFrame
  ): TradingSignal | null {
    const rsi = this.calculateRSI(closes, 14);
    const { macd, signal: macdSignal, histogram } = this.calculateMACD(closes);
    const atr = this.calculateATR(highs, lows, closes, 14);
    const currentPrice = closes[closes.length - 1];
    const avgVolume = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
    const currentVolume = volumes[volumes.length - 1];
    const volumeRatio = currentVolume / avgVolume;

    let signalType: SignalType = 'hold';
    let confidence = 0;
    let reason = '';

    // Long signal: RSI oversold + MACD crossover + volume confirmation
    if (rsi < 30 && histogram > 0 && macd > macdSignal && volumeRatio > 1.2) {
      signalType = 'long';
      confidence = Math.min(0.9, 0.5 + (30 - rsi) / 100 + volumeRatio / 10);
      reason = `RSI oversold (${rsi.toFixed(1)}), MACD bullish crossover, volume ${volumeRatio.toFixed(1)}x avg`;
    }
    // Short signal: RSI overbought + MACD crossover + volume confirmation
    else if (rsi > 70 && histogram < 0 && macd < macdSignal && volumeRatio > 1.2) {
      signalType = 'short';
      confidence = Math.min(0.9, 0.5 + (rsi - 70) / 100 + volumeRatio / 10);
      reason = `RSI overbought (${rsi.toFixed(1)}), MACD bearish crossover, volume ${volumeRatio.toFixed(1)}x avg`;
    }

    if (signalType === 'hold') return null;

    return {
      id: `momentum-${Date.now()}`,
      timestamp: Date.now(),
      exchange: exchangeId,
      symbol,
      type: signalType,
      confidence,
      strategy: 'momentum',
      timeframe,
      entryPrice: currentPrice,
      stopLoss: signalType === 'long' ? currentPrice - atr * 2 : currentPrice + atr * 2,
      takeProfit: signalType === 'long' ? currentPrice + atr * 3 : currentPrice - atr * 3,
      reason,
      indicators: { rsi, macd, macdSignal, histogram, atr, volumeRatio },
    };
  }

  /**
   * Mean reversion strategy - Bollinger Bands
   */
  private meanReversionStrategy(
    exchangeId: ExchangeId,
    symbol: string,
    closes: number[],
    highs: number[],
    lows: number[],
    timeframe: TimeFrame
  ): TradingSignal | null {
    const { upper, middle, lower } = this.calculateBollingerBands(closes, 20, 2);
    const atr = this.calculateATR(highs, lows, closes, 14);
    const currentPrice = closes[closes.length - 1];
    const percentB = (currentPrice - lower) / (upper - lower);

    let signalType: SignalType = 'hold';
    let confidence = 0;
    let reason = '';

    // Long signal: Price below lower band
    if (currentPrice < lower) {
      signalType = 'long';
      confidence = Math.min(0.85, 0.6 + (lower - currentPrice) / lower);
      reason = `Price below lower Bollinger Band, %B: ${(percentB * 100).toFixed(1)}%`;
    }
    // Short signal: Price above upper band
    else if (currentPrice > upper) {
      signalType = 'short';
      confidence = Math.min(0.85, 0.6 + (currentPrice - upper) / upper);
      reason = `Price above upper Bollinger Band, %B: ${(percentB * 100).toFixed(1)}%`;
    }

    if (signalType === 'hold') return null;

    return {
      id: `mean-reversion-${Date.now()}`,
      timestamp: Date.now(),
      exchange: exchangeId,
      symbol,
      type: signalType,
      confidence,
      strategy: 'mean-reversion',
      timeframe,
      entryPrice: currentPrice,
      stopLoss: signalType === 'long' ? lower - atr : upper + atr,
      takeProfit: middle,
      reason,
      indicators: { upper, middle, lower, percentB, atr },
    };
  }

  /**
   * Breakout strategy - Donchian Channel
   */
  private breakoutStrategy(
    exchangeId: ExchangeId,
    symbol: string,
    closes: number[],
    highs: number[],
    lows: number[],
    volumes: number[],
    timeframe: TimeFrame
  ): TradingSignal | null {
    const period = 20;
    const recentHighs = highs.slice(-period);
    const recentLows = lows.slice(-period);
    const channelHigh = Math.max(...recentHighs);
    const channelLow = Math.min(...recentLows);
    const currentPrice = closes[closes.length - 1];
    const previousPrice = closes[closes.length - 2];
    const atr = this.calculateATR(highs, lows, closes, 14);
    const avgVolume = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
    const currentVolume = volumes[volumes.length - 1];
    const volumeRatio = currentVolume / avgVolume;

    let signalType: SignalType = 'hold';
    let confidence = 0;
    let reason = '';

    // Long breakout: Price breaks above channel high with volume
    if (currentPrice > channelHigh && previousPrice <= channelHigh && volumeRatio > 1.5) {
      signalType = 'long';
      confidence = Math.min(0.85, 0.65 + volumeRatio / 20);
      reason = `Breakout above ${period}-period high, volume ${volumeRatio.toFixed(1)}x avg`;
    }
    // Short breakout: Price breaks below channel low with volume
    else if (currentPrice < channelLow && previousPrice >= channelLow && volumeRatio > 1.5) {
      signalType = 'short';
      confidence = Math.min(0.85, 0.65 + volumeRatio / 20);
      reason = `Breakout below ${period}-period low, volume ${volumeRatio.toFixed(1)}x avg`;
    }

    if (signalType === 'hold') return null;

    return {
      id: `breakout-${Date.now()}`,
      timestamp: Date.now(),
      exchange: exchangeId,
      symbol,
      type: signalType,
      confidence,
      strategy: 'breakout',
      timeframe,
      entryPrice: currentPrice,
      stopLoss: signalType === 'long' ? channelLow : channelHigh,
      takeProfit: signalType === 'long' ? currentPrice + atr * 4 : currentPrice - atr * 4,
      reason,
      indicators: { channelHigh, channelLow, volumeRatio, atr },
    };
  }

  /**
   * Trend following strategy - EMA crossover
   */
  private trendFollowingStrategy(
    exchangeId: ExchangeId,
    symbol: string,
    closes: number[],
    timeframe: TimeFrame
  ): TradingSignal | null {
    const ema9 = this.calculateEMA(closes, 9);
    const ema21 = this.calculateEMA(closes, 21);
    const ema50 = this.calculateEMA(closes, 50);
    const currentPrice = closes[closes.length - 1];
    const prevEma9 = this.calculateEMAAtIndex(closes, 9, closes.length - 2);
    const prevEma21 = this.calculateEMAAtIndex(closes, 21, closes.length - 2);

    let signalType: SignalType = 'hold';
    let confidence = 0;
    let reason = '';

    // Bullish: 9 EMA crosses above 21 EMA, both above 50 EMA
    if (ema9 > ema21 && prevEma9 <= prevEma21 && ema21 > ema50) {
      signalType = 'long';
      confidence = 0.75;
      reason = `EMA 9/21 bullish crossover above EMA 50`;
    }
    // Bearish: 9 EMA crosses below 21 EMA, both below 50 EMA
    else if (ema9 < ema21 && prevEma9 >= prevEma21 && ema21 < ema50) {
      signalType = 'short';
      confidence = 0.75;
      reason = `EMA 9/21 bearish crossover below EMA 50`;
    }

    if (signalType === 'hold') return null;

    const stopDistance = Math.abs(currentPrice - ema50) * 0.5;

    return {
      id: `trend-${Date.now()}`,
      timestamp: Date.now(),
      exchange: exchangeId,
      symbol,
      type: signalType,
      confidence,
      strategy: 'trend-following',
      timeframe,
      entryPrice: currentPrice,
      stopLoss: signalType === 'long' ? currentPrice - stopDistance : currentPrice + stopDistance,
      takeProfit: signalType === 'long' ? currentPrice + stopDistance * 2 : currentPrice - stopDistance * 2,
      reason,
      indicators: { ema9, ema21, ema50 },
    };
  }

  // ==========================================================================
  // Technical Indicators
  // ==========================================================================

  private calculateRSI(closes: number[], period: number = 14): number {
    if (closes.length < period + 1) return 50;

    let gains = 0;
    let losses = 0;

    for (let i = closes.length - period; i < closes.length; i++) {
      const change = closes[i] - closes[i - 1];
      if (change > 0) gains += change;
      else losses -= change;
    }

    const avgGain = gains / period;
    const avgLoss = losses / period;

    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }

  private calculateMACD(closes: number[], fast: number = 12, slow: number = 26, signal: number = 9): {
    macd: number;
    signal: number;
    histogram: number;
  } {
    const emaFast = this.calculateEMA(closes, fast);
    const emaSlow = this.calculateEMA(closes, slow);
    const macdLine = emaFast - emaSlow;
    
    // Calculate signal line (simplified)
    const macdValues: number[] = [];
    for (let i = slow; i < closes.length; i++) {
      const ef = this.calculateEMAAtIndex(closes, fast, i);
      const es = this.calculateEMAAtIndex(closes, slow, i);
      macdValues.push(ef - es);
    }
    
    const signalLine = macdValues.length >= signal 
      ? macdValues.slice(-signal).reduce((a, b) => a + b, 0) / signal
      : macdLine;

    return {
      macd: macdLine,
      signal: signalLine,
      histogram: macdLine - signalLine,
    };
  }

  private calculateEMA(closes: number[], period: number): number {
    return this.calculateEMAAtIndex(closes, period, closes.length - 1);
  }

  private calculateEMAAtIndex(closes: number[], period: number, index: number): number {
    if (index < period - 1) return closes[index];
    
    const multiplier = 2 / (period + 1);
    let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
    
    for (let i = period; i <= index; i++) {
      ema = (closes[i] - ema) * multiplier + ema;
    }
    
    return ema;
  }

  private calculateBollingerBands(closes: number[], period: number = 20, stdDev: number = 2): {
    upper: number;
    middle: number;
    lower: number;
  } {
    const recentCloses = closes.slice(-period);
    const middle = recentCloses.reduce((a, b) => a + b, 0) / period;
    const variance = recentCloses.reduce((sum, close) => sum + Math.pow(close - middle, 2), 0) / period;
    const std = Math.sqrt(variance);
    
    return {
      upper: middle + stdDev * std,
      middle,
      lower: middle - stdDev * std,
    };
  }

  private calculateATR(highs: number[], lows: number[], closes: number[], period: number = 14): number {
    const trueRanges: number[] = [];
    
    for (let i = 1; i < highs.length; i++) {
      const tr = Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1])
      );
      trueRanges.push(tr);
    }
    
    return trueRanges.slice(-period).reduce((a, b) => a + b, 0) / period;
  }

  // ==========================================================================
  // Signal Processing
  // ==========================================================================

  /**
   * Combine multiple strategy signals
   */
  private combineSignals(signals: TradingSignal[], exchangeId: ExchangeId, symbol: string): TradingSignal | null {
    if (signals.length === 0) return null;

    // Count votes
    let longVotes = 0;
    let shortVotes = 0;
    let totalConfidence = 0;
    const reasons: string[] = [];

    for (const signal of signals) {
      if (signal.type === 'long') {
        longVotes++;
        totalConfidence += signal.confidence;
      } else if (signal.type === 'short') {
        shortVotes++;
        totalConfidence += signal.confidence;
      }
      reasons.push(`${signal.strategy}: ${signal.reason}`);
    }

    // Need consensus
    if (longVotes === 0 && shortVotes === 0) return null;
    
    const type: SignalType = longVotes > shortVotes ? 'long' : 'short';
    const votes = type === 'long' ? longVotes : shortVotes;
    const avgConfidence = totalConfidence / signals.length;
    const consensusBonus = votes / signals.length * 0.1;
    const finalConfidence = Math.min(0.95, avgConfidence + consensusBonus);

    // Find best entry/SL/TP from matching signals
    const matchingSignals = signals.filter(s => s.type === type);
    const bestSignal = matchingSignals.reduce((best, current) => 
      current.confidence > best.confidence ? current : best
    );

    return {
      id: `combined-${Date.now()}`,
      timestamp: Date.now(),
      exchange: exchangeId,
      symbol,
      type,
      confidence: finalConfidence,
      strategy: 'consensus',
      timeframe: bestSignal.timeframe,
      entryPrice: bestSignal.entryPrice,
      stopLoss: bestSignal.stopLoss,
      takeProfit: bestSignal.takeProfit,
      reason: `Consensus (${votes}/${signals.length}): ${reasons.join(' | ')}`,
      indicators: bestSignal.indicators,
    };
  }

  /**
   * Process a trading signal
   */
  private async processSignal(signal: TradingSignal): Promise<void> {
    logger.info('Processing signal', {
      symbol: signal.symbol,
      type: signal.type,
      confidence: signal.confidence.toFixed(2),
      strategy: signal.strategy,
    });

    // Check minimum confidence
    if (signal.confidence < this.config.risk.minConfidence) {
      logger.debug('Signal rejected - low confidence', {
        confidence: signal.confidence,
        minRequired: this.config.risk.minConfidence,
      });
      return;
    }

    // Check if we already have a position in this symbol
    const existingPosition = this.state.positions.find(
      p => p.symbol === signal.symbol && p.exchange === signal.exchange
    );

    if (signal.type === 'close' && existingPosition) {
      await this.closePosition(existingPosition);
      return;
    }

    if (existingPosition) {
      logger.debug('Already have position in symbol', { symbol: signal.symbol });
      return;
    }

    // Calculate position size
    const positionSize = await this.calculatePositionSize(signal);
    if (positionSize.lte(0)) {
      logger.warn('Position size too small', { signal: signal.symbol });
      return;
    }

    // Execute trade
    await this.executeTrade(signal, positionSize);
    this.state.lastSignal = signal;
    this.emit('signal', signal);
  }

  // ==========================================================================
  // Risk Management
  // ==========================================================================

  /**
   * Check if risk limits are exceeded
   */
  private async checkRiskLimits(): Promise<boolean> {
    // Check daily loss
    const dailyLossPercent = this.state.dailyPnl.div(this.startingBalance).toNumber();
    if (dailyLossPercent < -this.config.risk.maxDailyLoss) {
      logger.warn('Daily loss limit exceeded', {
        loss: dailyLossPercent.toFixed(2),
        limit: this.config.risk.maxDailyLoss,
      });
      return true;
    }

    // Check drawdown
    const currentBalance = await this.getTotalBalance();
    const drawdown = this.peakBalance.minus(currentBalance).div(this.peakBalance).toNumber();
    this.state.drawdown = drawdown;
    
    if (currentBalance.gt(this.peakBalance)) {
      this.peakBalance = currentBalance;
    }

    if (drawdown > this.config.risk.maxDrawdown) {
      logger.warn('Max drawdown exceeded', {
        drawdown: drawdown.toFixed(2),
        limit: this.config.risk.maxDrawdown,
      });
      return true;
    }

    // Check max positions
    if (this.state.positions.length >= this.config.risk.maxPositions) {
      logger.debug('Max positions reached', {
        current: this.state.positions.length,
        max: this.config.risk.maxPositions,
      });
      return true;
    }

    return false;
  }

  /**
   * Calculate position size based on risk
   */
  private async calculatePositionSize(signal: TradingSignal): Promise<Decimal> {
    const balance = await this.getTotalBalance();
    
    // Risk-based position sizing
    if (!signal.entryPrice || !signal.stopLoss) {
      // Default to max position size if no SL
      return balance.mul(this.config.risk.maxPositionSize);
    }

    const riskAmount = balance.mul(this.config.risk.maxRiskPerTrade);
    const priceDiff = Math.abs(signal.entryPrice - signal.stopLoss);
    const positionSize = riskAmount.div(priceDiff);

    // Cap at max position size
    const maxPosition = balance.mul(this.config.risk.maxPositionSize);
    return Decimal.min(positionSize, maxPosition);
  }

  /**
   * Get total balance across all exchanges
   */
  private async getTotalBalance(): Promise<Decimal> {
    let total = new Decimal(0);

    for (const [, exchange] of this.exchanges) {
      if (exchange.isConnected()) {
        try {
          const balance = await exchange.fetchBalance();
          // Sum up USDT balance from currencies map
          const usdtBalance = balance.get('USDT');
          if (usdtBalance) {
            total = total.plus(usdtBalance.total);
          }
        } catch {
          // Skip if error
        }
      }
    }

    return total;
  }

  // ==========================================================================
  // Trade Execution
  // ==========================================================================

  /**
   * Execute a trade
   */
  private async executeTrade(signal: TradingSignal, positionSize: Decimal): Promise<void> {
    const exchange = this.exchanges.get(signal.exchange);
    if (!exchange) {
      logger.error('Exchange not found', { exchange: signal.exchange });
      return;
    }

    if (this.config.dryRun) {
      logger.info('DRY RUN - Would execute trade', {
        symbol: signal.symbol,
        type: signal.type,
        size: positionSize.toString(),
        entry: signal.entryPrice,
        sl: signal.stopLoss,
        tp: signal.takeProfit,
      });
      this.emit('dry-run-trade', { signal, positionSize });
      return;
    }

    try {
      const side = signal.type === 'long' ? 'buy' : 'sell';
      const order = await exchange.createOrder({
        symbol: signal.symbol,
        side: side as 'buy' | 'sell',
        type: 'market',
        amount: positionSize,
      });

      logger.info('Trade executed', {
        symbol: signal.symbol,
        side,
        size: positionSize.toString(),
        orderId: order.id,
      });

      // Set stop loss if provided
      if (signal.stopLoss) {
        const slSide = signal.type === 'long' ? 'sell' : 'buy';
        await exchange.createOrder({
          symbol: signal.symbol,
          side: slSide as 'buy' | 'sell',
          type: 'stop',
          amount: positionSize,
          stopPrice: signal.stopLoss,
        });
      }

      // Set take profit if provided
      if (signal.takeProfit) {
        const tpSide = signal.type === 'long' ? 'sell' : 'buy';
        await exchange.createOrder({
          symbol: signal.symbol,
          side: tpSide as 'buy' | 'sell',
          type: 'limit',
          amount: positionSize,
          price: signal.takeProfit,
          reduceOnly: true,
        });
      }

      this.state.tradesToday++;
      this.emit('trade-executed', { signal, order, positionSize });

    } catch (error) {
      const err = error as Error;
      logger.error('Trade execution failed', {
        symbol: signal.symbol,
        error: err.message,
      });
      this.emit('trade-error', { signal, error: err });
    }
  }

  /**
   * Close a position
   */
  private async closePosition(position: Position): Promise<void> {
    const exchange = this.exchanges.get(position.exchange);
    if (!exchange) return;

    if (this.config.dryRun) {
      logger.info('DRY RUN - Would close position', {
        symbol: position.symbol,
        size: position.contracts.toString(),
      });
      return;
    }

    try {
      const side = position.side === 'long' ? 'sell' : 'buy';
      await exchange.createOrder({
        symbol: position.symbol,
        side: side as 'buy' | 'sell',
        type: 'market',
        amount: position.contracts,
        reduceOnly: true,
      });

      // Track win/loss
      if (position.unrealizedPnl) {
        if (position.unrealizedPnl.gt(0)) {
          this.state.wins++;
        } else {
          this.state.losses++;
        }
        this.state.dailyPnl = this.state.dailyPnl.plus(position.unrealizedPnl);
        this.state.totalPnl = this.state.totalPnl.plus(position.unrealizedPnl);
      }

      logger.info('Position closed', {
        symbol: position.symbol,
        pnl: position.unrealizedPnl?.toString(),
      });

      this.emit('position-closed', position);

    } catch (error) {
      logger.error('Failed to close position', {
        symbol: position.symbol,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Manage existing positions (trailing stops, etc.)
   */
  private async managePositions(): Promise<void> {
    if (!this.config.risk.useTrailingStops) return;

    for (const position of this.state.positions) {
      // Implement trailing stop logic here
      // This would update stop loss orders as price moves in favor
    }
  }

  // ==========================================================================
  // State Management
  // ==========================================================================

  /**
   * Sync state with exchanges
   */
  private async syncState(): Promise<void> {
    this.state.positions = [];
    this.state.openOrders = [];

    for (const [, exchange] of this.exchanges) {
      if (exchange.isConnected()) {
        try {
          const positions = await exchange.fetchPositions();
          this.state.positions.push(...positions);

          const orders = await exchange.fetchOpenOrders();
          this.state.openOrders.push(...orders);
        } catch (error) {
          logger.error('Failed to sync state', {
            exchange: exchange.id,
            error: (error as Error).message,
          });
        }
      }
    }
  }

  // ==========================================================================
  // Getters
  // ==========================================================================

  getConfig(): BotConfig {
    return { ...this.config };
  }

  getState(): BotState {
    return { ...this.state };
  }

  isRunning(): boolean {
    return this.state.running;
  }

  getWinRate(): number {
    const total = this.state.wins + this.state.losses;
    return total > 0 ? this.state.wins / total : 0;
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

let botInstance: AutonomousBot | null = null;

export function getAutonomousBot(): AutonomousBot | null {
  return botInstance;
}

export function createAutonomousBot(config?: Partial<BotConfig>): AutonomousBot {
  botInstance = new AutonomousBot(config);
  return botInstance;
}

export function initializeAutonomousBot(config?: Partial<BotConfig>): AutonomousBot {
  if (!botInstance) {
    botInstance = new AutonomousBot(config);
  }
  return botInstance;
}
