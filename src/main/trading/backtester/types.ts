/**
 * Atlas Autonomous Trading - Backtester Types
 * 
 * Extended types for event-driven backtesting with block-accurate
 * simulation, slippage modeling, and MEV protection.
 */

import Decimal from 'decimal.js';

// ============================================================================
// COMMON TYPES
// ============================================================================

export type SignalSource = 
  | 'technical' 
  | 'sentiment' 
  | 'perplexity' 
  | 'on_chain' 
  | 'custom' 
  | 'external'
  | 'ai_research';

export type SignalType = 
  | 'entry' 
  | 'exit' 
  | 'scale_in' 
  | 'scale_out' 
  | 'stop_loss' 
  | 'take_profit' 
  | 'rebalance'
  | 'hedge';

export type SignalSide = 'long' | 'short';

export type SignalTimeframe = 
  | '1m' | '5m' | '15m' | '30m' 
  | '1h' | '4h' 
  | '1d' | '1w' | '1M';

export type OrderSide = 'buy' | 'sell';

export interface TechnicalIndicator {
  name: string;
  value: Decimal;
  signal: SignalSide | 'neutral';
  strength: Decimal;
}

export interface Position {
  id: string;
  symbol: string;
  side: OrderSide;
  quantity: Decimal;
  entryPrice: Decimal;
  currentPrice: Decimal;
  unrealizedPnl: Decimal;
  unrealizedPnlPercent: Decimal;
  openedAt: number;
  stopLoss?: Decimal;
  takeProfit?: Decimal;
  trailingStop?: Decimal;
}

// ============================================================================
// BACKTEST CONFIGURATION
// ============================================================================

export interface BacktestConfig {
  /** Unique backtest ID */
  id: string;
  /** Strategy to test */
  strategyId: string;
  /** Symbols to backtest */
  symbols: string[];
  /** Start timestamp (ms) */
  startTime: number;
  /** End timestamp (ms) */
  endTime: number;
  /** Initial capital in USD */
  initialCapital: Decimal;
  /** Commission rate (0.001 = 0.1%) */
  commissionRate: Decimal;
  /** Base slippage rate */
  slippageRate: Decimal;
  /** Use realistic volume-based slippage */
  useRealisticSlippage: boolean;
  /** Enable MEV protection simulation */
  enableMevProtection: boolean;
  /** Block delay for order execution (Solana: ~400ms) */
  blockDelayMs: number;
  
  // Strategy parameters
  parameters: {
    takeProfitPercent?: Decimal;
    stopLossPercent?: Decimal;
    trailingStopPercent?: Decimal;
    maxPositionSize?: Decimal;
    maxPositions?: number;
  };
  
  // Monte Carlo settings
  monteCarloRuns?: number;
  stressTestMultiplier?: Decimal;
}

// ============================================================================
// BACKTEST EVENTS (Block-accurate simulation)
// ============================================================================

export type BacktestEventType = 
  | 'block'
  | 'price_update'
  | 'signal'
  | 'order_placed'
  | 'order_filled'
  | 'order_cancelled'
  | 'position_opened'
  | 'position_closed'
  | 'stop_loss_triggered'
  | 'take_profit_triggered'
  | 'trailing_stop_triggered'
  | 'liquidation'
  | 'mev_detected'
  | 'rebalance';

export interface BacktestEvent {
  id: string;
  type: BacktestEventType;
  timestamp: number;
  blockNumber?: number;
  symbol?: string;
  data: Record<string, unknown>;
}

export interface BlockEvent extends BacktestEvent {
  type: 'block';
  data: {
    blockNumber: number;
    blockHash: string;
    timestamp: number;
    slot?: number; // Solana slot
    transactionCount: number;
    gasUsed?: Decimal;
    baseFee?: Decimal;
  };
}

export interface PriceUpdateEvent extends BacktestEvent {
  type: 'price_update';
  data: {
    symbol: string;
    price: Decimal;
    bid: Decimal;
    ask: Decimal;
    volume: Decimal;
    blockNumber: number;
  };
}

export interface SignalEvent extends BacktestEvent {
  type: 'signal';
  data: {
    source: string;
    symbol: string;
    side: 'buy' | 'sell';
    strength: number;
    confidence: number;
    suggestedEntry: Decimal;
    suggestedStopLoss?: Decimal;
    suggestedTakeProfit?: Decimal;
  };
}

export interface OrderEvent extends BacktestEvent {
  type: 'order_placed' | 'order_filled' | 'order_cancelled';
  data: {
    orderId: string;
    symbol: string;
    side: 'buy' | 'sell';
    type: 'market' | 'limit' | 'stop';
    quantity: Decimal;
    price: Decimal;
    slippage?: Decimal;
    fees?: Decimal;
    fillTime?: number;
  };
}

// ============================================================================
// BACKTEST RESULTS
// ============================================================================

export interface BacktestResult {
  id: string;
  config: BacktestConfig;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  
  // Core metrics
  metrics: {
    totalReturn: Decimal;
    totalReturnPercent: Decimal;
    sharpeRatio: Decimal;
    sortinoRatio: Decimal;
    calmarRatio: Decimal;
    maxDrawdown: Decimal;
    maxDrawdownPercent: Decimal;
    winRate: Decimal;
    profitFactor: Decimal;
    expectancy: Decimal;
    payoffRatio: Decimal;
  };
  
  // Trade statistics
  tradeStats: {
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    breakEvenTrades: number;
    averageWin: Decimal;
    averageLoss: Decimal;
    largestWin: Decimal;
    largestLoss: Decimal;
    averageHoldTime: number;
    maxConsecutiveWins: number;
    maxConsecutiveLosses: number;
  };
  
  // Risk analysis
  riskMetrics: {
    volatility: Decimal;
    downvol: Decimal;
    beta?: Decimal;
    alpha?: Decimal;
    valueAtRisk95: Decimal;
    valueAtRisk99: Decimal;
    conditionalVaR95: Decimal;
    ulcerIndex: Decimal;
    recoveryFactor: Decimal;
  };
  
  // Time series data
  equityCurve: EquityPoint[];
  drawdownCurve: DrawdownPoint[];
  trades: BacktestTrade[];
  events: BacktestEvent[];
  
  // Monte Carlo results (if enabled)
  monteCarlo?: MonteCarloResult;
  
  // Execution details
  execution: {
    startedAt: number;
    completedAt?: number;
    duration: number;
    eventsProcessed: number;
    dataPoints: number;
    blocksProcessed: number;
    error?: string;
  };
}

export interface EquityPoint {
  timestamp: number;
  blockNumber?: number;
  equity: Decimal;
  cash: Decimal;
  positionsValue: Decimal;
  unrealizedPnl: Decimal;
}

export interface DrawdownPoint {
  timestamp: number;
  drawdown: Decimal;
  drawdownPercent: Decimal;
  peak: Decimal;
  duration: number;
}

export interface BacktestTrade {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  
  // Entry
  entryTime: number;
  entryBlock?: number;
  entryPrice: Decimal;
  entrySlippage: Decimal;
  entryFees: Decimal;
  
  // Exit
  exitTime: number;
  exitBlock?: number;
  exitPrice: Decimal;
  exitSlippage: Decimal;
  exitFees: Decimal;
  exitReason: 'take_profit' | 'stop_loss' | 'trailing_stop' | 'signal' | 'timeout' | 'liquidation' | 'manual';
  
  // Results
  quantity: Decimal;
  pnl: Decimal;
  pnlPercent: Decimal;
  holdTime: number;
  maePercent: Decimal; // Maximum adverse excursion
  mfePercent: Decimal; // Maximum favorable excursion
}

export interface MonteCarloResult {
  runs: number;
  
  // Return distribution
  medianReturn: Decimal;
  meanReturn: Decimal;
  stdReturn: Decimal;
  percentile5: Decimal;
  percentile25: Decimal;
  percentile75: Decimal;
  percentile95: Decimal;
  
  // Risk distribution
  medianDrawdown: Decimal;
  percentile95Drawdown: Decimal;
  
  // Probabilities
  probabilityOfProfit: Decimal;
  probabilityOfRuin: Decimal;
  probabilityOf2xReturn: Decimal;
  
  // Confidence intervals
  returnConfidenceInterval: {
    lower: Decimal;
    upper: Decimal;
    confidence: Decimal;
  };
  
  // Simulation paths (subset for visualization)
  samplePaths: Array<{ timestamp: number; equity: Decimal }[]>;
}

// ============================================================================
// SLIPPAGE MODELING
// ============================================================================

export interface SlippageModel {
  /** Base slippage rate */
  baseRate: Decimal;
  /** Volume impact factor */
  volumeImpact: Decimal;
  /** Volatility impact factor */
  volatilityImpact: Decimal;
  /** Spread impact factor */
  spreadImpact: Decimal;
  /** Block delay (ms) */
  blockDelay: number;
}

export interface SlippageResult {
  /** Expected slippage */
  expected: Decimal;
  /** Worst case slippage (95th percentile) */
  worstCase: Decimal;
  /** Actual slippage (after simulation) */
  actual: Decimal;
  /** Fill price after slippage */
  fillPrice: Decimal;
  /** Blocks waited for fill */
  blocksWaited: number;
}

// ============================================================================
// MEV PROTECTION
// ============================================================================

export interface MevDetection {
  detected: boolean;
  type?: 'sandwich' | 'frontrun' | 'backrun' | 'arbitrage';
  attackerAddress?: string;
  impactPercent?: Decimal;
  blockNumber?: number;
  avoidanceAction?: 'skip' | 'delay' | 'split_order' | 'use_private_mempool';
}

export interface MevProtectionConfig {
  enabled: boolean;
  /** Minimum profit threshold to consider as MEV */
  minProfitThreshold: Decimal;
  /** Price impact threshold to trigger protection */
  priceImpactThreshold: Decimal;
  /** Use private mempool/RPC */
  usePrivateMempool: boolean;
  /** Skip blocks with detected MEV */
  skipMevBlocks: boolean;
  /** Split large orders */
  splitLargeOrders: boolean;
  /** Maximum order size before splitting */
  maxOrderSizeUsd: Decimal;
}

// ============================================================================
// STRATEGY TYPES
// ============================================================================

export type StrategyType = 
  | 'momentum'
  | 'mean_reversion'
  | 'breakout'
  | 'trend_following'
  | 'scalping'
  | 'grid'
  | 'dca'
  | 'arbitrage'
  | 'signal_following'
  | 'custom';

export interface Strategy {
  id: string;
  name: string;
  type: StrategyType;
  description: string;
  enabled: boolean;
  
  // Entry/Exit conditions
  entryConditions: TradingCondition[];
  exitConditions: TradingCondition[];
  
  // Risk parameters
  takeProfitPercent?: Decimal;
  stopLossPercent?: Decimal;
  trailingStopPercent?: Decimal;
  trailingStopActivation?: Decimal;
  maxPositionSizePercent: Decimal;
  maxPositions: number;
  
  // Filters
  symbols: string[];
  minVolume24h?: Decimal;
  minLiquidity?: Decimal;
  
  // Timing
  timeframes: string[];
  tradingHours?: TradingSchedule;
  
  // Parameters (strategy-specific)
  parameters: Record<string, Decimal | number | string | boolean>;
  
  // Performance tracking
  backtestResults?: BacktestResult[];
  livePerformance?: StrategyPerformance;
  
  // Metadata
  version: number;
  createdAt: number;
  updatedAt: number;
}

export interface TradingCondition {
  indicator: string;
  operator: 'gt' | 'lt' | 'gte' | 'lte' | 'eq' | 'neq' | 'crosses_above' | 'crosses_below' | 'between';
  value: Decimal | number | [number, number];
  timeframe?: string;
  lookback?: number;
}

export interface TradingSchedule {
  enabled: boolean;
  timezone: string;
  sessions: TradingSession[];
  excludeDates?: string[];
}

export interface TradingSession {
  dayOfWeek: number; // 0-6 (Sunday-Saturday)
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
}

export interface StrategyPerformance {
  strategyId: string;
  period: '1d' | '7d' | '30d' | '90d' | 'all';
  
  metrics: {
    totalTrades: number;
    winRate: Decimal;
    profitFactor: Decimal;
    sharpeRatio: Decimal;
    maxDrawdown: Decimal;
    totalPnl: Decimal;
    averagePnl: Decimal;
  };
  
  feedback: {
    count: number;
    averageRating: Decimal;
    commonIssues: string[];
  };
  
  parameterHistory: ParameterAdjustment[];
}

export interface ParameterAdjustment {
  parameter: string;
  oldValue: Decimal | number | string;
  newValue: Decimal | number | string;
  reason: string;
  timestamp: number;
  source: 'user' | 'optimization' | 'learning';
}

// ============================================================================
// SIGNAL TYPES
// ============================================================================

export interface Signal {
  id: string;
  source: SignalSource;
  sourceChannel?: string;
  symbol: string;
  side: SignalSide;
  type: SignalType;
  strength: number; // 0-100
  confidence: Decimal; // 0-1
  timeframe: SignalTimeframe;
  
  // Prices
  currentPrice: Decimal;
  suggestedEntry?: Decimal;
  suggestedStopLoss?: Decimal;
  suggestedTakeProfit?: Decimal;
  
  // Technical indicators
  indicators: TechnicalIndicator[];
  
  // Sizing
  suggestedPositionSize?: Decimal;
  
  // Timing
  timestamp: number;
  expiresAt?: number;
  
  // Analysis
  reasoning?: string;
  sentiment?: {
    score: Decimal;
    sources: string[];
  };
  
  // Metadata
  metadata?: Record<string, unknown>;
}

// ============================================================================
// AUTONOMOUS TRADING TYPES
// ============================================================================

export type AutonomousMode = 'paper' | 'live' | 'hybrid';
export type TradingState = 
  | 'idle'
  | 'initializing'
  | 'researching'
  | 'analyzing'
  | 'backtesting'
  | 'waiting_confirmation'
  | 'executing'
  | 'monitoring'
  | 'rebalancing'
  | 'paused'
  | 'stopped'
  | 'error'
  | 'killed';

export interface AutonomousConfig {
  enabled: boolean;
  mode: AutonomousMode;
  
  // Strategy selection
  strategies: string[];
  symbols: string[];
  
  // Capital allocation
  maxCapitalPercent: Decimal;
  reserveCashPercent: Decimal;
  
  // Research settings
  researchIntervalMs: number;
  usePerplexityResearch: boolean;
  useTechnicalAnalysis: boolean;
  useSentimentAnalysis: boolean;
  useOnChainAnalysis: boolean;
  
  // Execution settings
  requireConfirmation: boolean;
  confirmationTimeoutMs: number;
  maxSlippagePercent: Decimal;
  usePrivateRpc: boolean;
  
  // Rebalancing
  autoRebalance: boolean;
  rebalanceThresholdPercent: Decimal;
  rebalanceIntervalMs: number;
  
  // Risk limits
  riskLimits: RiskLimits;
  killSwitch: KillSwitchConfig;
  
  // Schedule
  tradingSchedule?: TradingSchedule;
  pauseOnHighVolatility: boolean;
  volatilityThresholdPercent: Decimal;
  
  // Learning
  enableLearning: boolean;
  feedbackWeight: Decimal;
}

export interface RiskLimits {
  maxPositionSizeUsd: Decimal;
  maxPositionSizePercent: Decimal;
  maxTotalExposureUsd: Decimal;
  maxTotalExposurePercent: Decimal;
  maxDailyLossUsd: Decimal;
  maxDailyLossPercent: Decimal;
  maxWeeklyLossPercent: Decimal;
  maxDrawdownPercent: Decimal;
  maxConsecutiveLosses: number;
  maxLeverage: Decimal;
  maxOpenPositions: number;
  maxOrdersPerMinute: number;
  maxOrdersPerHour: number;
}

export interface KillSwitchConfig {
  enabled: boolean;
  triggers: KillSwitchTrigger[];
  actions: KillSwitchAction[];
  cooldownMinutes: number;
  notifyOnTrigger: boolean;
  requireManualReset: boolean;
}

export interface KillSwitchTrigger {
  id: string;
  type: 'daily_loss' | 'weekly_loss' | 'drawdown' | 'consecutive_losses' | 'volatility_spike' | 'liquidity_crisis' | 'connection_lost' | 'api_error' | 'manual';
  threshold: Decimal;
  enabled: boolean;
  description?: string;
}

export type KillSwitchAction = 
  | 'close_all_positions'
  | 'cancel_all_orders'
  | 'pause_trading'
  | 'stop_trading'
  | 'hedge_positions'
  | 'notify_user'
  | 'send_alert';

export interface AutonomousStatus {
  state: TradingState;
  mode: AutonomousMode;
  startedAt: number;
  uptime: number;
  
  // Cycle info
  lastCycleAt: number;
  cycleCount: number;
  currentAction?: string;
  
  // Queue status
  pendingSignals: number;
  pendingOrders: number;
  pendingConfirmations: number;
  
  // Today's performance
  todayPnl: Decimal;
  todayPnlPercent: Decimal;
  todayTrades: number;
  todayWinRate: Decimal;
  todayVolume: Decimal;
  
  // Risk status
  riskMetrics: RiskMetrics;
  killSwitchStatus: KillSwitchStatus;
  
  // Errors
  lastError?: string;
  errorCount: number;
}

export interface RiskMetrics {
  currentExposure: Decimal;
  exposurePercent: Decimal;
  dailyPnl: Decimal;
  dailyPnlPercent: Decimal;
  weeklyPnl: Decimal;
  weeklyPnlPercent: Decimal;
  currentDrawdown: Decimal;
  currentDrawdownPercent: Decimal;
  maxDrawdownToday: Decimal;
  consecutiveLosses: number;
  openPositions: number;
  pendingOrders: number;
  leverage: Decimal;
  marginUsed: Decimal;
  marginAvailable: Decimal;
  liquidationRisk: Decimal; // 0-1
  riskScore: number; // 0-100
}

export interface KillSwitchStatus {
  triggered: boolean;
  triggeredAt?: number;
  trigger?: KillSwitchTrigger;
  reason?: string;
  actionsExecuted: KillSwitchAction[];
  cooldownEndsAt?: number;
  canResume: boolean;
}

// ============================================================================
// FEEDBACK & LEARNING
// ============================================================================

export interface TradeFeedback {
  id: string;
  tradeId: string;
  strategyId: string;
  
  ratings: {
    entryTiming: number; // -1 to +1
    exitTiming: number;
    positionSizing: number;
    riskManagement: number;
    overall: number;
  };
  
  notes?: string;
  suggestedImprovements?: string[];
  wouldRepeat: boolean;
  
  timestamp: number;
}

export interface LearningUpdate {
  strategyId: string;
  parameter: string;
  adjustment: {
    type: 'increase' | 'decrease' | 'set';
    value: Decimal;
    percentage?: Decimal;
  };
  reason: string;
  confidence: Decimal;
  basedOnFeedback: string[];
  timestamp: number;
}

// ============================================================================
// GO BACKEND API TYPES
// ============================================================================

export interface GoBackendConfig {
  host: string;
  port: number;
  useTls: boolean;
  apiKey?: string;
  timeout: number;
}

export interface GoBackendStatus {
  connected: boolean;
  version: string;
  uptime: number;
  activeBacktests: number;
  queuedBacktests: number;
  dataPointsLoaded: number;
  memoryUsage: number;
}

export interface BacktestRequest {
  config: BacktestConfig;
  priority?: 'low' | 'normal' | 'high';
  callback?: string; // Webhook URL
}

export interface BacktestProgress {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number; // 0-100
  currentTimestamp?: number;
  eventsProcessed: number;
  estimatedTimeRemaining?: number;
  error?: string;
}
