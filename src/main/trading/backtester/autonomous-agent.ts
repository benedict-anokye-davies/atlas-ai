/**
 * Atlas Autonomous Trading - Autonomous Trading Agent
 * 
 * The main autonomous trading loop that:
 * 1. Researches markets using Perplexity API
 * 2. Generates trading strategies via LLM
 * 3. Validates strategies through backtesting
 * 4. Executes trades with risk management
 * 5. Learns from user feedback
 */

import { EventEmitter } from 'events';
import Decimal from 'decimal.js';
import { createModuleLogger } from '../../utils/logger';
import { getGoBackendClient, GoBackendClient } from './go-backend-client';
import {
  AutonomousConfig,
  AutonomousStatus,
  TradingState,
  Signal,
  Strategy,
  RiskMetrics,
  KillSwitchStatus,
  TradeFeedback,
  LearningUpdate,
  BacktestConfig,
  BacktestResult,
} from './types';

const logger = createModuleLogger('AutonomousTrader');

// Default configuration
const DEFAULT_CONFIG: AutonomousConfig = {
  enabled: false,
  mode: 'paper',
  strategies: [],
  symbols: [],
  maxCapitalPercent: new Decimal(50),
  reserveCashPercent: new Decimal(20),
  researchIntervalMs: 60000, // 1 minute
  usePerplexityResearch: true,
  useTechnicalAnalysis: true,
  useSentimentAnalysis: true,
  useOnChainAnalysis: false,
  requireConfirmation: true,
  confirmationTimeoutMs: 30000,
  maxSlippagePercent: new Decimal(1),
  usePrivateRpc: false,
  autoRebalance: false,
  rebalanceThresholdPercent: new Decimal(5),
  rebalanceIntervalMs: 3600000, // 1 hour
  riskLimits: {
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
      { id: 'consecutive', type: 'consecutive_losses', threshold: new Decimal(5), enabled: true },
    ],
    actions: ['pause_trading', 'notify_user'],
    cooldownMinutes: 60,
    notifyOnTrigger: true,
    requireManualReset: true,
  },
  pauseOnHighVolatility: true,
  volatilityThresholdPercent: new Decimal(10),
  enableLearning: true,
  feedbackWeight: new Decimal(0.3),
};

interface TraderEvents {
  'state:changed': (state: TradingState, previousState: TradingState) => void;
  'signal:received': (signal: Signal) => void;
  'signal:validated': (signal: Signal, valid: boolean, reason?: string) => void;
  'order:pending': (orderId: string, signal: Signal) => void;
  'order:executed': (orderId: string, result: unknown) => void;
  'order:failed': (orderId: string, error: string) => void;
  'position:opened': (positionId: string, signal: Signal) => void;
  'position:closed': (positionId: string, pnl: Decimal) => void;
  'killswitch:triggered': (status: KillSwitchStatus) => void;
  'killswitch:reset': () => void;
  'learning:update': (update: LearningUpdate) => void;
  'error': (error: Error) => void;
}

export class AutonomousTradingAgent extends EventEmitter {
  private config: AutonomousConfig;
  private state: TradingState = 'idle';
  private backendClient: GoBackendClient;
  
  // Runtime state
  private startedAt: number = 0;
  private cycleCount: number = 0;
  private lastCycleAt: number = 0;
  private loopInterval: NodeJS.Timeout | null = null;
  
  // Queues
  private signalQueue: Signal[] = [];
  private pendingConfirmations: Map<string, { signal: Signal; expiresAt: number }> = new Map();
  
  // Performance tracking
  private todayTrades: number = 0;
  private todayWins: number = 0;
  private todayPnl: Decimal = new Decimal(0);
  private todayVolume: Decimal = new Decimal(0);
  
  // Risk tracking
  private consecutiveLosses: number = 0;
  private dailyPnl: Decimal = new Decimal(0);
  private weeklyPnl: Decimal = new Decimal(0);
  private peakEquity: Decimal = new Decimal(0);
  private currentDrawdown: Decimal = new Decimal(0);
  
  // Kill switch
  private killSwitchTriggered: boolean = false;
  private killSwitchStatus: KillSwitchStatus = {
    triggered: false,
    actionsExecuted: [],
    canResume: true,
  };
  
  // Feedback storage
  private feedbackHistory: TradeFeedback[] = [];
  private learningUpdates: LearningUpdate[] = [];
  
  // Error tracking
  private errorCount: number = 0;
  private lastError: string | null = null;

  constructor(config: Partial<AutonomousConfig> = {}) {
    super();
    this.config = this.mergeConfig(DEFAULT_CONFIG, config);
    this.backendClient = getGoBackendClient();
  }

  private mergeConfig(base: AutonomousConfig, override: Partial<AutonomousConfig>): AutonomousConfig {
    // Deep merge with Decimal handling
    return {
      ...base,
      ...override,
      riskLimits: {
        ...base.riskLimits,
        ...(override.riskLimits || {}),
      },
      killSwitch: {
        ...base.killSwitch,
        ...(override.killSwitch || {}),
        triggers: override.killSwitch?.triggers || base.killSwitch.triggers,
        actions: override.killSwitch?.actions || base.killSwitch.actions,
      },
    };
  }

  // ===========================================================================
  // Lifecycle Management
  // ===========================================================================

  async start(): Promise<void> {
    if (this.state !== 'idle' && this.state !== 'stopped') {
      throw new Error(`Cannot start from state: ${this.state}`);
    }

    if (this.killSwitchTriggered && this.config.killSwitch.requireManualReset) {
      throw new Error('Kill switch triggered. Manual reset required.');
    }

    logger.info('Starting autonomous trading agent', { mode: this.config.mode });
    this.setState('initializing');

    try {
      // Connect to Go backend
      await this.backendClient.connect();
      logger.info('Connected to Go backend');

      // Verify backend status
      const status = await this.backendClient.getStatus();
      logger.info('Go backend status', { status });

      // Initialize tracking
      this.startedAt = Date.now();
      this.cycleCount = 0;
      this.resetDailyMetrics();

      // Start main loop
      this.setState('idle');
      this.startMainLoop();

      logger.info('Autonomous trading agent started');

    } catch (error) {
      this.setState('error');
      this.lastError = (error as Error).message;
      throw error;
    }
  }

  async stop(): Promise<void> {
    logger.info('Stopping autonomous trading agent');
    this.setState('stopped');
    this.stopMainLoop();
    
    // Clear queues
    this.signalQueue = [];
    this.pendingConfirmations.clear();
    
    logger.info('Autonomous trading agent stopped');
  }

  pause(): void {
    if (this.state === 'stopped' || this.state === 'paused') {
      return;
    }
    logger.info('Pausing autonomous trading');
    this.setState('paused');
  }

  resume(): void {
    if (this.state !== 'paused') {
      throw new Error('Can only resume from paused state');
    }
    
    if (this.killSwitchTriggered && this.config.killSwitch.requireManualReset) {
      throw new Error('Kill switch triggered. Manual reset required.');
    }
    
    logger.info('Resuming autonomous trading');
    this.setState('idle');
  }

  private setState(newState: TradingState): void {
    const previousState = this.state;
    this.state = newState;
    logger.debug('State changed', { from: previousState, to: newState });
    this.emit('state:changed', newState, previousState);
  }

  // ===========================================================================
  // Main Trading Loop
  // ===========================================================================

  private startMainLoop(): void {
    this.loopInterval = setInterval(() => {
      this.runCycle().catch((error) => {
        logger.error('Cycle error', { error: (error as Error).message });
        this.errorCount++;
        this.lastError = (error as Error).message;
        this.emit('error', error as Error);
      });
    }, this.config.researchIntervalMs);
  }

  private stopMainLoop(): void {
    if (this.loopInterval) {
      clearInterval(this.loopInterval);
      this.loopInterval = null;
    }
  }

  private async runCycle(): Promise<void> {
    if (this.state === 'paused' || this.state === 'stopped' || this.killSwitchTriggered) {
      return;
    }

    this.cycleCount++;
    this.lastCycleAt = Date.now();
    logger.debug('Starting cycle', { cycle: this.cycleCount });

    try {
      // Check risk limits before doing anything
      await this.checkRiskLimits();
      if (this.killSwitchTriggered) {
        return;
      }

      // Stage 1: Research opportunities
      this.setState('researching');
      const signals = await this.researchOpportunities();
      logger.debug('Research complete', { signalsFound: signals.length });

      // Stage 2: Validate and filter signals
      this.setState('analyzing');
      const validSignals = await this.validateSignals(signals);
      logger.debug('Validation complete', { validSignals: validSignals.length });

      // Add valid signals to queue
      for (const signal of validSignals) {
        this.signalQueue.push(signal);
        this.emit('signal:received', signal);
      }

      // Stage 3: Process signal queue
      if (this.signalQueue.length > 0) {
        await this.processSignalQueue();
      }

      // Stage 4: Monitor positions
      this.setState('monitoring');
      await this.monitorPositions();

      // Stage 5: Rebalance if needed
      if (this.config.autoRebalance) {
        await this.checkRebalance();
      }

      // Return to idle
      this.setState('idle');

    } catch (error) {
      logger.error('Cycle failed', { error: (error as Error).message });
      throw error;
    }
  }

  // ===========================================================================
  // Research & Signal Generation
  // ===========================================================================

  private async researchOpportunities(): Promise<Signal[]> {
    const signals: Signal[] = [];

    // Perplexity research (if enabled)
    if (this.config.usePerplexityResearch) {
      try {
        const perplexitySignals = await this.runPerplexityResearch();
        signals.push(...perplexitySignals);
      } catch (error) {
        logger.warn('Perplexity research failed', { error: (error as Error).message });
      }
    }

    // Technical analysis (if enabled)
    if (this.config.useTechnicalAnalysis) {
      try {
        const technicalSignals = await this.runTechnicalAnalysis();
        signals.push(...technicalSignals);
      } catch (error) {
        logger.warn('Technical analysis failed', { error: (error as Error).message });
      }
    }

    // Sentiment analysis (if enabled)
    if (this.config.useSentimentAnalysis) {
      try {
        const sentimentSignals = await this.runSentimentAnalysis();
        signals.push(...sentimentSignals);
      } catch (error) {
        logger.warn('Sentiment analysis failed', { error: (error as Error).message });
      }
    }

    return signals;
  }

  private async runPerplexityResearch(): Promise<Signal[]> {
    // TODO: Implement Perplexity API integration
    // This would call the Perplexity API to research current market conditions
    logger.debug('Running Perplexity research...');
    return [];
  }

  private async runTechnicalAnalysis(): Promise<Signal[]> {
    // TODO: Implement technical analysis
    // Calculate indicators and generate signals
    logger.debug('Running technical analysis...');
    return [];
  }

  private async runSentimentAnalysis(): Promise<Signal[]> {
    // TODO: Implement sentiment analysis
    // Analyze social media, news sentiment
    logger.debug('Running sentiment analysis...');
    return [];
  }

  // ===========================================================================
  // Signal Validation & Backtesting
  // ===========================================================================

  private async validateSignals(signals: Signal[]): Promise<Signal[]> {
    const validSignals: Signal[] = [];

    for (const signal of signals) {
      // Check basic validity
      if (signal.confidence.lessThan(0.5)) {
        this.emit('signal:validated', signal, false, 'Low confidence');
        continue;
      }

      // Check if symbol is in allowed list
      if (this.config.symbols.length > 0 && !this.config.symbols.includes(signal.symbol)) {
        this.emit('signal:validated', signal, false, 'Symbol not in allowed list');
        continue;
      }

      // Backtest the signal's strategy
      try {
        const backtestResult = await this.backtestSignal(signal);
        
        if (backtestResult.metrics.sharpeRatio.lessThan(0.5)) {
          this.emit('signal:validated', signal, false, 'Sharpe ratio too low');
          continue;
        }

        if (backtestResult.metrics.maxDrawdownPercent.greaterThan(20)) {
          this.emit('signal:validated', signal, false, 'Max drawdown too high');
          continue;
        }

        if (backtestResult.metrics.winRate.lessThan(0.45)) {
          this.emit('signal:validated', signal, false, 'Win rate too low');
          continue;
        }

        this.emit('signal:validated', signal, true);
        validSignals.push(signal);

      } catch (error) {
        logger.warn('Backtest failed for signal', { 
          signalId: signal.id, 
          error: (error as Error).message 
        });
        this.emit('signal:validated', signal, false, 'Backtest failed');
      }
    }

    return validSignals;
  }

  private async backtestSignal(signal: Signal): Promise<BacktestResult> {
    const config: BacktestConfig = {
      id: `bt_${signal.id}_${Date.now()}`,
      strategyId: 'signal_following',
      symbols: [signal.symbol],
      startTime: Date.now() - 30 * 24 * 60 * 60 * 1000, // 30 days ago
      endTime: Date.now(),
      initialCapital: new Decimal(10000),
      commissionRate: new Decimal(0.001),
      slippageRate: new Decimal(0.0005),
      useRealisticSlippage: true,
      enableMevProtection: true,
      blockDelayMs: 400,
      parameters: {
        takeProfitPercent: signal.suggestedTakeProfit 
          ? signal.suggestedTakeProfit.minus(signal.currentPrice).div(signal.currentPrice).times(100)
          : new Decimal(5),
        stopLossPercent: signal.suggestedStopLoss
          ? signal.currentPrice.minus(signal.suggestedStopLoss).div(signal.currentPrice).times(100)
          : new Decimal(2),
      },
      monteCarloRuns: 100,
    };

    const backtestId = await this.backendClient.runBacktest(config);
    
    // Wait for backtest to complete (with timeout)
    const timeout = 30000;
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      const progress = await this.backendClient.getBacktestProgress(backtestId);
      
      if (progress.status === 'completed') {
        return await this.backendClient.getBacktestResult(backtestId);
      }
      
      if (progress.status === 'failed') {
        throw new Error(progress.error || 'Backtest failed');
      }
      
      await this.sleep(1000);
    }
    
    throw new Error('Backtest timeout');
  }

  // ===========================================================================
  // Order Execution
  // ===========================================================================

  private async processSignalQueue(): Promise<void> {
    while (this.signalQueue.length > 0 && !this.killSwitchTriggered) {
      const signal = this.signalQueue.shift()!;
      
      // Check if we can take more positions
      const riskMetrics = await this.calculateRiskMetrics();
      if (riskMetrics.openPositions >= this.config.riskLimits.maxOpenPositions) {
        logger.info('Max positions reached, skipping signal', { signalId: signal.id });
        continue;
      }

      // Calculate position size
      const positionSize = this.calculatePositionSize(signal, riskMetrics);
      if (positionSize.isZero()) {
        logger.info('Position size is zero, skipping signal', { signalId: signal.id });
        continue;
      }

      // Require confirmation if configured
      if (this.config.requireConfirmation) {
        this.setState('waiting_confirmation');
        this.pendingConfirmations.set(signal.id, {
          signal,
          expiresAt: Date.now() + this.config.confirmationTimeoutMs,
        });
        this.emit('order:pending', signal.id, signal);
        
        // Wait for confirmation or timeout
        // In a real implementation, this would wait for user input
        await this.sleep(5000); // Simulated wait
        
        // For now, auto-confirm in paper mode
        if (this.config.mode === 'paper') {
          await this.executeSignal(signal, positionSize);
        }
      } else {
        await this.executeSignal(signal, positionSize);
      }
    }
  }

  private calculatePositionSize(signal: Signal, riskMetrics: RiskMetrics): Decimal {
    // Risk-based position sizing
    const accountValue = riskMetrics.currentExposure.plus(riskMetrics.marginAvailable);
    const maxPositionValue = Decimal.min(
      this.config.riskLimits.maxPositionSizeUsd,
      accountValue.times(this.config.riskLimits.maxPositionSizePercent).div(100)
    );

    // Adjust based on signal confidence
    const confidenceAdjustment = signal.confidence;
    const adjustedSize = maxPositionValue.times(confidenceAdjustment);

    // Calculate quantity based on price
    const quantity = adjustedSize.div(signal.currentPrice);
    
    return quantity;
  }

  private async executeSignal(signal: Signal, quantity: Decimal): Promise<void> {
    this.setState('executing');
    logger.info('Executing signal', { 
      signalId: signal.id, 
      symbol: signal.symbol, 
      side: signal.side,
      quantity: quantity.toString() 
    });

    try {
      // TODO: Implement actual order execution via exchange
      // This would use the trading infrastructure already in place
      
      if (this.config.mode === 'paper') {
        // Simulate order execution
        logger.info('Paper trade executed', { signal, quantity: quantity.toString() });
        this.todayTrades++;
        this.todayVolume = this.todayVolume.plus(quantity.times(signal.currentPrice));
        this.emit('order:executed', signal.id, { simulated: true });
      } else {
        // Real order execution
        // const result = await this.placeOrder(signal, quantity);
        // this.emit('order:executed', signal.id, result);
      }

    } catch (error) {
      logger.error('Order execution failed', { 
        signalId: signal.id, 
        error: (error as Error).message 
      });
      this.emit('order:failed', signal.id, (error as Error).message);
    }
  }

  // ===========================================================================
  // Risk Management
  // ===========================================================================

  private async checkRiskLimits(): Promise<void> {
    const metrics = await this.calculateRiskMetrics();
    
    // Check each kill switch trigger
    for (const trigger of this.config.killSwitch.triggers) {
      if (!trigger.enabled) continue;
      
      let triggered = false;
      
      switch (trigger.type) {
        case 'daily_loss':
          triggered = metrics.dailyPnlPercent.negated().greaterThan(trigger.threshold);
          break;
        case 'drawdown':
          triggered = metrics.currentDrawdownPercent.greaterThan(trigger.threshold);
          break;
        case 'consecutive_losses':
          triggered = new Decimal(metrics.consecutiveLosses).greaterThanOrEqualTo(trigger.threshold);
          break;
        case 'weekly_loss':
          triggered = metrics.weeklyPnlPercent.negated().greaterThan(trigger.threshold);
          break;
      }
      
      if (triggered) {
        await this.triggerKillSwitch(trigger, metrics);
        return;
      }
    }
  }

  private async triggerKillSwitch(trigger: typeof this.config.killSwitch.triggers[0], metrics: RiskMetrics): Promise<void> {
    logger.warn('Kill switch triggered!', { trigger, metrics });
    
    this.killSwitchTriggered = true;
    this.killSwitchStatus = {
      triggered: true,
      triggeredAt: Date.now(),
      trigger,
      reason: `${trigger.type} exceeded threshold: ${trigger.threshold.toString()}`,
      actionsExecuted: [],
      cooldownEndsAt: Date.now() + this.config.killSwitch.cooldownMinutes * 60 * 1000,
      canResume: !this.config.killSwitch.requireManualReset,
    };

    // Execute kill switch actions
    for (const action of this.config.killSwitch.actions) {
      try {
        switch (action) {
          case 'pause_trading':
            this.pause();
            break;
          case 'stop_trading':
            await this.stop();
            break;
          case 'close_all_positions':
            // TODO: Implement position closing
            break;
          case 'cancel_all_orders':
            // TODO: Implement order cancellation
            break;
          case 'notify_user':
            // Notification is handled by event emission
            break;
        }
        this.killSwitchStatus.actionsExecuted.push(action);
      } catch (error) {
        logger.error('Kill switch action failed', { action, error: (error as Error).message });
      }
    }

    this.emit('killswitch:triggered', this.killSwitchStatus);
  }

  async resetKillSwitch(): Promise<void> {
    if (!this.killSwitchTriggered) {
      return;
    }
    
    logger.info('Resetting kill switch');
    this.killSwitchTriggered = false;
    this.killSwitchStatus = {
      triggered: false,
      actionsExecuted: [],
      canResume: true,
    };
    
    this.emit('killswitch:reset');
  }

  private async calculateRiskMetrics(): Promise<RiskMetrics> {
    // TODO: Get real data from portfolio manager
    return {
      currentExposure: new Decimal(0),
      exposurePercent: new Decimal(0),
      dailyPnl: this.dailyPnl,
      dailyPnlPercent: new Decimal(0),
      weeklyPnl: this.weeklyPnl,
      weeklyPnlPercent: new Decimal(0),
      currentDrawdown: this.currentDrawdown,
      currentDrawdownPercent: new Decimal(0),
      maxDrawdownToday: new Decimal(0),
      consecutiveLosses: this.consecutiveLosses,
      openPositions: 0,
      pendingOrders: 0,
      leverage: new Decimal(1),
      marginUsed: new Decimal(0),
      marginAvailable: new Decimal(10000), // Placeholder
      liquidationRisk: new Decimal(0),
      riskScore: 0,
    };
  }

  // ===========================================================================
  // Position Monitoring
  // ===========================================================================

  private async monitorPositions(): Promise<void> {
    // TODO: Implement position monitoring
    // - Check stop losses
    // - Check take profits
    // - Check trailing stops
    // - Update unrealized P&L
  }

  private async checkRebalance(): Promise<void> {
    // TODO: Implement rebalancing logic
    // - Calculate current allocation
    // - Compare to target allocation
    // - Generate rebalance orders if drift exceeds threshold
  }

  // ===========================================================================
  // Learning & Feedback
  // ===========================================================================

  async submitFeedback(feedback: TradeFeedback): Promise<void> {
    this.feedbackHistory.push(feedback);
    logger.info('Feedback received', { tradeId: feedback.tradeId });

    if (this.config.enableLearning) {
      await this.processLearning(feedback);
    }
  }

  private async processLearning(feedback: TradeFeedback): Promise<void> {
    // Analyze feedback patterns
    const recentFeedback = this.feedbackHistory.slice(-20);
    
    // Calculate average ratings by strategy
    const strategyRatings = new Map<string, number[]>();
    for (const fb of recentFeedback) {
      const ratings = strategyRatings.get(fb.strategyId) || [];
      ratings.push(fb.ratings.overall);
      strategyRatings.set(fb.strategyId, ratings);
    }

    // Generate learning updates based on patterns
    for (const [strategyId, ratings] of strategyRatings) {
      const avgRating = ratings.reduce((a, b) => a + b, 0) / ratings.length;
      
      if (avgRating < -0.3) {
        // Strategy is performing poorly based on feedback
        const update: LearningUpdate = {
          strategyId,
          parameter: 'positionSize',
          adjustment: {
            type: 'decrease',
            value: new Decimal(0),
            percentage: new Decimal(20),
          },
          reason: `Poor user feedback (avg: ${avgRating.toFixed(2)})`,
          confidence: new Decimal(0.7),
          basedOnFeedback: recentFeedback.map(f => f.id),
          timestamp: Date.now(),
        };
        
        this.learningUpdates.push(update);
        this.emit('learning:update', update);
      }
    }
  }

  // ===========================================================================
  // Status & Utilities
  // ===========================================================================

  getStatus(): AutonomousStatus {
    return {
      state: this.state,
      mode: this.config.mode,
      startedAt: this.startedAt,
      uptime: this.startedAt ? Date.now() - this.startedAt : 0,
      lastCycleAt: this.lastCycleAt,
      cycleCount: this.cycleCount,
      currentAction: undefined,
      pendingSignals: this.signalQueue.length,
      pendingOrders: 0,
      pendingConfirmations: this.pendingConfirmations.size,
      todayPnl: this.todayPnl,
      todayPnlPercent: new Decimal(0),
      todayTrades: this.todayTrades,
      todayWinRate: this.todayTrades > 0 
        ? new Decimal(this.todayWins).div(this.todayTrades) 
        : new Decimal(0),
      todayVolume: this.todayVolume,
      riskMetrics: {
        currentExposure: new Decimal(0),
        exposurePercent: new Decimal(0),
        dailyPnl: this.dailyPnl,
        dailyPnlPercent: new Decimal(0),
        weeklyPnl: this.weeklyPnl,
        weeklyPnlPercent: new Decimal(0),
        currentDrawdown: this.currentDrawdown,
        currentDrawdownPercent: new Decimal(0),
        maxDrawdownToday: new Decimal(0),
        consecutiveLosses: this.consecutiveLosses,
        openPositions: 0,
        pendingOrders: 0,
        leverage: new Decimal(1),
        marginUsed: new Decimal(0),
        marginAvailable: new Decimal(0),
        liquidationRisk: new Decimal(0),
        riskScore: 0,
      },
      killSwitchStatus: this.killSwitchStatus,
      lastError: this.lastError || undefined,
      errorCount: this.errorCount,
    };
  }

  getConfig(): AutonomousConfig {
    return { ...this.config };
  }

  updateConfig(updates: Partial<AutonomousConfig>): void {
    this.config = this.mergeConfig(this.config, updates);
    logger.info('Config updated', { updates: Object.keys(updates) });
  }

  private resetDailyMetrics(): void {
    this.todayTrades = 0;
    this.todayWins = 0;
    this.todayPnl = new Decimal(0);
    this.todayVolume = new Decimal(0);
    this.dailyPnl = new Decimal(0);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Singleton instance
let autonomousTrader: AutonomousTradingAgent | null = null;

export function getAutonomousTrader(): AutonomousTradingAgent {
  if (!autonomousTrader) {
    autonomousTrader = new AutonomousTradingAgent();
  }
  return autonomousTrader;
}

export function createAutonomousTrader(config: Partial<AutonomousConfig>): AutonomousTradingAgent {
  autonomousTrader = new AutonomousTradingAgent(config);
  return autonomousTrader;
}
