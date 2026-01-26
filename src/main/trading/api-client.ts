/**
 * Trading Backend API Client
 *
 * HTTP client for communicating with the Go trading backend.
 * Provides type-safe access to all trading endpoints.
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('TradingAPI');

// =============================================================================
// Types
// =============================================================================

export interface TradingAPIConfig {
  baseUrl: string;
  apiKey?: string;
  timeout: number;
  retryAttempts: number;
  retryDelay: number;
}

export interface APIResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: number;
}

// Regime Types
export interface RegimeState {
  regime: 'Bull' | 'Bear' | 'HighVol' | 'LowVol' | 'MeanReverting' | 'Trending' | 'Unknown';
  confidence: number;
  duration: number; // bars in current regime
  transitionProbabilities: Record<string, number>;
  adjustments: RegimeAdjustments;
}

export interface RegimeAdjustments {
  positionMultiplier: number;
  stopMultiplier: number;
  targetMultiplier: number;
  preferredStrategies: string[];
  avoidStrategies: string[];
}

export interface RegimeHistory {
  entries: Array<{
    regime: string;
    startTime: number;
    endTime: number;
    confidence: number;
  }>;
}

// Position Types
export interface Position {
  id: string;
  symbol: string;
  side: 'long' | 'short';
  size: number;
  entryPrice: number;
  currentPrice: number;
  unrealizedPnL: number;
  unrealizedPnLPercent: number;
  stopLoss?: number;
  takeProfit?: number;
  openTime: number;
  strategyId: string;
  regime: string;
}

// Order Types
export interface Order {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  type: 'market' | 'limit' | 'stop' | 'stopLimit';
  quantity: number;
  price?: number;
  stopPrice?: number;
  status: 'pending' | 'open' | 'filled' | 'cancelled' | 'rejected';
  filledQuantity: number;
  averagePrice: number;
  createdAt: number;
  updatedAt: number;
}

export interface OrderRequest {
  symbol: string;
  side: 'buy' | 'sell';
  type: 'market' | 'limit' | 'stop' | 'stopLimit';
  quantity: number;
  price?: number;
  stopPrice?: number;
  stopLossPercent?: number;
  takeProfitPercent?: number;
  strategyId?: string;
}

// Trade Types
export interface Trade {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  price: number;
  pnl: number;
  pnlPercent: number;
  fees: number;
  timestamp: number;
  strategyId: string;
  regime: string;
  reasoning?: string;
}

// PnL Types
export interface PnLSummary {
  today: number;
  todayPercent: number;
  week: number;
  weekPercent: number;
  month: number;
  monthPercent: number;
  total: number;
  totalPercent: number;
  winRate: number;
  profitFactor: number;
  sharpeRatio: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
}

export interface DailyPnL {
  date: string;
  pnl: number;
  pnlPercent: number;
  trades: number;
  winRate: number;
}

// Signal Types
export interface Signal {
  id: string;
  symbol: string;
  direction: 'long' | 'short' | 'neutral';
  strength: number; // -1 to 1
  confidence: number; // 0 to 1
  source: string;
  reasoning: string;
  timestamp: number;
  expiry?: number;
}

export interface AggregatedSignal {
  symbol: string;
  direction: 'long' | 'short' | 'neutral';
  strength: number;
  confidence: number;
  sources: Array<{
    name: string;
    direction: string;
    strength: number;
    weight: number;
  }>;
  recommendation: string;
}

// Sizing Types
export interface SizingRequest {
  symbol: string;
  direction: 'long' | 'short';
  portfolioValue?: number;
  winRate?: number;
  winLossRatio?: number;
  volatility?: number;
  maxRiskPercent?: number;
}

export interface SizingResult {
  positionSize: number;
  positionValue: number;
  riskAmount: number;
  riskPercent: number;
  method: string;
  kelly: {
    fullKelly: number;
    fractionalKelly: number;
    fraction: number;
  };
  regime: {
    current: string;
    multiplier: number;
    adjustedSize: number;
  };
  reasoning: string;
}

// Monte Carlo Types
export interface MonteCarloRequest {
  trades: number[];
  simulations?: number;
  confidenceLevel?: number;
}

export interface MonteCarloResult {
  simulations: number;
  metrics: {
    meanReturn: number;
    medianReturn: number;
    stdDev: number;
    var95: number;
    var99: number;
    cvar95: number;
    cvar99: number;
    maxDrawdown: number;
    probabilityOfProfit: number;
    probabilityOfRuin: number;
  };
  robustnessScore: number;
  confidenceIntervals: {
    return: { lower: number; upper: number };
    drawdown: { lower: number; upper: number };
    sharpe: { lower: number; upper: number };
  };
  percentiles: Record<number, number>;
  isRobust: boolean;
  reasoning: string;
}

// Optimization Types
export interface OptimizationRequest {
  strategyId: string;
  parameters: Record<string, [number, number, number]>; // [min, max, step]
  windows?: number;
  inSampleDays?: number;
  outSampleDays?: number;
  objective?: 'sharpe' | 'sortino' | 'calmar' | 'profit';
}

export interface OptimizationResult {
  jobId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number;
  bestParams?: Record<string, number>;
  bestScore?: number;
  inSampleMetrics?: BacktestMetrics;
  outSampleMetrics?: BacktestMetrics;
  degradation?: number;
  isOverfit: boolean;
  reasoning?: string;
}

// Backtest Types
export interface BacktestRequest {
  strategyId: string;
  startDate: string;
  endDate: string;
  parameters?: Record<string, number>;
  initialCapital?: number;
}

export interface BacktestMetrics {
  totalReturn: number;
  totalReturnPercent: number;
  sharpeRatio: number;
  sortinoRatio: number;
  calmarRatio: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  winRate: number;
  profitFactor: number;
  totalTrades: number;
  avgWin: number;
  avgLoss: number;
  largestWin: number;
  largestLoss: number;
  avgHoldingPeriod: number;
  exposureTime: number;
}

export interface BacktestResult {
  metrics: BacktestMetrics;
  trades: Trade[];
  equityCurve: Array<{ timestamp: number; equity: number }>;
  drawdownCurve: Array<{ timestamp: number; drawdown: number }>;
  byRegime: Record<string, BacktestMetrics>;
  byMonth: Record<string, { pnl: number; trades: number }>;
}

// Strategy Types
export interface Strategy {
  id: string;
  name: string;
  description: string;
  type: 'momentum' | 'meanReversion' | 'breakout' | 'trend' | 'arbitrage' | 'custom';
  status: 'active' | 'paused' | 'paperTrading' | 'inactive';
  parameters: Record<string, number>;
  parameterRanges: Record<string, [number, number, number]>;
  markets: string[];
  timeframe: string;
  allocation: number; // Portfolio percentage
  performance: {
    sharpe: number;
    totalReturn: number;
    maxDrawdown: number;
    trades: number;
    winRate: number;
  };
  viability: StrategyViability;
  createdAt: number;
  updatedAt: number;
}

export interface StrategyViability {
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  score: number;
  isViable: boolean;
  factors: {
    sharpe: { value: number; score: number; weight: number };
    drawdown: { value: number; score: number; weight: number };
    winRate: { value: number; score: number; weight: number };
    profitFactor: { value: number; score: number; weight: number };
    robustness: { value: number; score: number; weight: number };
    degradation: { value: number; score: number; weight: number };
  };
  recommendation: string;
}

// Agent Types
export interface AgentStatus {
  state: 'running' | 'paused' | 'stopped' | 'error';
  uptime: number;
  currentRegime: string;
  openPositions: number;
  todayTrades: number;
  todayPnL: number;
  lastAction: string;
  lastActionTime: number;
  activeStrategies: string[];
  riskStatus: {
    dailyLossUsed: number;
    dailyLossLimit: number;
    weeklyLossUsed: number;
    weeklyLossLimit: number;
    maxDrawdownUsed: number;
    maxDrawdownLimit: number;
  };
  errors: Array<{ message: string; timestamp: number }>;
}

// Risk Types
export interface RiskStatus {
  dailyLoss: number;
  dailyLossLimit: number;
  dailyLossPercent: number;
  weeklyLoss: number;
  weeklyLossLimit: number;
  weeklyLossPercent: number;
  currentDrawdown: number;
  maxDrawdownLimit: number;
  drawdownPercent: number;
  openRisk: number;
  maxOpenRisk: number;
  isKillSwitchActive: boolean;
  killSwitchReason?: string;
  warnings: string[];
}

export interface RiskLimits {
  maxDailyLoss: number;
  maxWeeklyLoss: number;
  maxDrawdown: number;
  maxPositionSize: number;
  maxOpenPositions: number;
  maxTotalExposure: number;
}

// Orchestrator Types
export interface OrchestratorMetrics {
  uptime: number;
  eventsProcessed: number;
  strategiesActive: number;
  currentRegime: string;
  regimeConfidence: number;
  lastRegimeChange: number;
  positionUpdates: number;
  signalsProcessed: number;
  errorCount: number;
  avgLatencyMs: number;
  p99LatencyMs: number;
}

export interface EventStats {
  totalProcessed: number;
  byType: Record<string, number>;
  avgLatencyMs: number;
  p99LatencyMs: number;
  errorRate: number;
  queueDepth: number;
}

// =============================================================================
// API Client Class
// =============================================================================

const DEFAULT_CONFIG: TradingAPIConfig = {
  baseUrl: process.env.TRADING_BACKEND_URL || 'http://localhost:8080',
  apiKey: process.env.TRADING_API_KEY,
  timeout: 30000,
  retryAttempts: 3,
  retryDelay: 1000,
};

class TradingAPIClient extends EventEmitter {
  private config: TradingAPIConfig;
  private isConnected: boolean = false;

  constructor(config: Partial<TradingAPIConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ---------------------------------------------------------------------------
  // Core HTTP Methods
  // ---------------------------------------------------------------------------

  private async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    endpoint: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.config.baseUrl}/api/v1${endpoint}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.config.retryAttempts; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

        const response = await fetch(url, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        this.isConnected = true;
        return data as T;
      } catch (error) {
        lastError = error as Error;
        logger.warn(`Request failed (attempt ${attempt + 1}/${this.config.retryAttempts}): ${endpoint}`, {
          error: lastError.message,
        });

        if (attempt < this.config.retryAttempts - 1) {
          await this.sleep(this.config.retryDelay * (attempt + 1));
        }
      }
    }

    this.isConnected = false;
    this.emit('connection-lost');
    throw lastError;
  }

  private async get<T>(endpoint: string): Promise<T> {
    return this.request<T>('GET', endpoint);
  }

  private async post<T>(endpoint: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', endpoint, body);
  }

  private async put<T>(endpoint: string, body?: unknown): Promise<T> {
    return this.request<T>('PUT', endpoint, body);
  }

  private async delete<T>(endpoint: string): Promise<T> {
    return this.request<T>('DELETE', endpoint);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ---------------------------------------------------------------------------
  // Connection Management
  // ---------------------------------------------------------------------------

  async checkConnection(): Promise<boolean> {
    try {
      await this.get('/health');
      this.isConnected = true;
      return true;
    } catch {
      this.isConnected = false;
      return false;
    }
  }

  getConnectionStatus(): boolean {
    return this.isConnected;
  }

  // ---------------------------------------------------------------------------
  // Regime Endpoints
  // ---------------------------------------------------------------------------

  async getCurrentRegime(): Promise<RegimeState> {
    return this.get<RegimeState>('/regime/current');
  }

  async getRegimeHistory(limit: number = 100): Promise<RegimeHistory> {
    return this.get<RegimeHistory>(`/regime/history?limit=${limit}`);
  }

  async getRegimeAdjustments(): Promise<RegimeAdjustments> {
    return this.get<RegimeAdjustments>('/regime/adjustments');
  }

  // ---------------------------------------------------------------------------
  // Position Endpoints
  // ---------------------------------------------------------------------------

  async getPositions(): Promise<Position[]> {
    return this.get<Position[]>('/positions');
  }

  async getPosition(symbol: string): Promise<Position | null> {
    try {
      return await this.get<Position>(`/positions/${symbol}`);
    } catch {
      return null;
    }
  }

  async closePosition(symbol: string, reason?: string): Promise<Trade> {
    return this.post<Trade>(`/positions/${symbol}/close`, { reason });
  }

  async closeAllPositions(reason?: string): Promise<Trade[]> {
    return this.post<Trade[]>('/positions/close-all', { reason });
  }

  async updatePositionStopLoss(symbol: string, stopLoss: number): Promise<Position> {
    return this.put<Position>(`/positions/${symbol}/stop-loss`, { stopLoss });
  }

  async updatePositionTakeProfit(symbol: string, takeProfit: number): Promise<Position> {
    return this.put<Position>(`/positions/${symbol}/take-profit`, { takeProfit });
  }

  // ---------------------------------------------------------------------------
  // Order Endpoints
  // ---------------------------------------------------------------------------

  async getOrders(status?: string): Promise<Order[]> {
    const query = status ? `?status=${status}` : '';
    return this.get<Order[]>(`/orders${query}`);
  }

  async getOrder(orderId: string): Promise<Order> {
    return this.get<Order>(`/orders/${orderId}`);
  }

  async placeOrder(request: OrderRequest): Promise<Order> {
    return this.post<Order>('/orders', request);
  }

  async cancelOrder(orderId: string): Promise<Order> {
    return this.delete<Order>(`/orders/${orderId}`);
  }

  async cancelAllOrders(): Promise<{ cancelled: number }> {
    return this.delete<{ cancelled: number }>('/orders');
  }

  // ---------------------------------------------------------------------------
  // Trade Endpoints
  // ---------------------------------------------------------------------------

  async getRecentTrades(days: number = 7): Promise<Trade[]> {
    return this.get<Trade[]>(`/trades/recent?days=${days}`);
  }

  async getTrade(tradeId: string): Promise<Trade> {
    return this.get<Trade>(`/trades/${tradeId}`);
  }

  async getTradesByStrategy(strategyId: string, limit: number = 100): Promise<Trade[]> {
    return this.get<Trade[]>(`/trades/strategy/${strategyId}?limit=${limit}`);
  }

  async getTradesBySymbol(symbol: string, limit: number = 100): Promise<Trade[]> {
    return this.get<Trade[]>(`/trades/symbol/${symbol}?limit=${limit}`);
  }

  // ---------------------------------------------------------------------------
  // PnL Endpoints
  // ---------------------------------------------------------------------------

  async getPnLSummary(): Promise<PnLSummary> {
    return this.get<PnLSummary>('/pnl/summary');
  }

  async getDailyPnL(days: number = 30): Promise<DailyPnL[]> {
    return this.get<DailyPnL[]>(`/pnl/daily?days=${days}`);
  }

  async getPnLByStrategy(): Promise<Record<string, PnLSummary>> {
    return this.get<Record<string, PnLSummary>>('/pnl/by-strategy');
  }

  async getPnLByRegime(): Promise<Record<string, PnLSummary>> {
    return this.get<Record<string, PnLSummary>>('/pnl/by-regime');
  }

  // ---------------------------------------------------------------------------
  // Signal Endpoints
  // ---------------------------------------------------------------------------

  async getSignals(symbol?: string): Promise<Signal[]> {
    const query = symbol ? `?symbol=${symbol}` : '';
    return this.get<Signal[]>(`/signals${query}`);
  }

  async getAggregatedSignal(symbol: string): Promise<AggregatedSignal> {
    return this.get<AggregatedSignal>(`/signals/aggregate/${symbol}`);
  }

  async getAllAggregatedSignals(): Promise<AggregatedSignal[]> {
    return this.get<AggregatedSignal[]>('/signals/aggregate');
  }

  // ---------------------------------------------------------------------------
  // Sizing Endpoints
  // ---------------------------------------------------------------------------

  async calculatePositionSize(request: SizingRequest): Promise<SizingResult> {
    return this.post<SizingResult>('/sizing/calculate', request);
  }

  async calculateKellySize(request: SizingRequest): Promise<SizingResult> {
    return this.post<SizingResult>('/sizing/kelly', request);
  }

  // ---------------------------------------------------------------------------
  // Monte Carlo Endpoints
  // ---------------------------------------------------------------------------

  async runMonteCarloValidation(request: MonteCarloRequest): Promise<MonteCarloResult> {
    return this.post<MonteCarloResult>('/montecarlo/validate', request);
  }

  async runSensitivityAnalysis(
    strategyId: string,
    parameters: string[]
  ): Promise<Record<string, MonteCarloResult>> {
    return this.post<Record<string, MonteCarloResult>>('/montecarlo/sensitivity', {
      strategyId,
      parameters,
    });
  }

  // ---------------------------------------------------------------------------
  // Optimization Endpoints
  // ---------------------------------------------------------------------------

  async startOptimization(request: OptimizationRequest): Promise<OptimizationResult> {
    return this.post<OptimizationResult>('/optimization/walkforward', request);
  }

  async getOptimizationStatus(jobId: string): Promise<OptimizationResult> {
    return this.get<OptimizationResult>(`/optimization/status?jobId=${jobId}`);
  }

  async cancelOptimization(jobId: string): Promise<{ cancelled: boolean }> {
    return this.delete<{ cancelled: boolean }>(`/optimization/${jobId}`);
  }

  // ---------------------------------------------------------------------------
  // Backtest Endpoints
  // ---------------------------------------------------------------------------

  async runBacktest(request: BacktestRequest): Promise<BacktestResult> {
    return this.post<BacktestResult>('/backtest/run', request);
  }

  async getBacktestStatus(jobId: string): Promise<{
    status: string;
    progress: number;
    result?: BacktestResult;
  }> {
    return this.get(`/backtest/status?jobId=${jobId}`);
  }

  // ---------------------------------------------------------------------------
  // Strategy Endpoints
  // ---------------------------------------------------------------------------

  async getStrategies(): Promise<Strategy[]> {
    return this.get<Strategy[]>('/strategies');
  }

  async getStrategy(strategyId: string): Promise<Strategy> {
    return this.get<Strategy>(`/strategies/${strategyId}`);
  }

  async createStrategy(strategy: Partial<Strategy>): Promise<Strategy> {
    return this.post<Strategy>('/strategies', strategy);
  }

  async updateStrategy(strategyId: string, updates: Partial<Strategy>): Promise<Strategy> {
    return this.put<Strategy>(`/strategies/${strategyId}`, updates);
  }

  async deleteStrategy(strategyId: string): Promise<{ deleted: boolean }> {
    return this.delete<{ deleted: boolean }>(`/strategies/${strategyId}`);
  }

  async activateStrategy(strategyId: string): Promise<Strategy> {
    return this.put<Strategy>(`/strategies/${strategyId}/activate`, {});
  }

  async pauseStrategy(strategyId: string): Promise<Strategy> {
    return this.put<Strategy>(`/strategies/${strategyId}/pause`, {});
  }

  async getStrategyViability(strategyId: string): Promise<StrategyViability> {
    return this.get<StrategyViability>(`/strategies/${strategyId}/viability`);
  }

  async getStrategyPerformance(
    strategyId: string
  ): Promise<{ metrics: BacktestMetrics; byRegime: Record<string, BacktestMetrics> }> {
    return this.get(`/strategies/${strategyId}/performance`);
  }

  async updateStrategyAllocation(strategyId: string, allocation: number): Promise<Strategy> {
    return this.put<Strategy>(`/strategies/${strategyId}/allocation`, { allocation });
  }

  // ---------------------------------------------------------------------------
  // Agent Control Endpoints
  // ---------------------------------------------------------------------------

  async getAgentStatus(): Promise<AgentStatus> {
    return this.get<AgentStatus>('/agent/enhanced/status');
  }

  async startAgent(): Promise<AgentStatus> {
    return this.post<AgentStatus>('/agent/enhanced/start');
  }

  async stopAgent(): Promise<AgentStatus> {
    return this.post<AgentStatus>('/agent/enhanced/stop');
  }

  async pauseAgent(): Promise<AgentStatus> {
    return this.post<AgentStatus>('/agent/enhanced/pause');
  }

  async resumeAgent(): Promise<AgentStatus> {
    return this.post<AgentStatus>('/agent/enhanced/resume');
  }

  async emergencyStop(): Promise<{
    positionsClosed: number;
    ordersCancelled: number;
    agentStopped: boolean;
  }> {
    return this.post('/agent/emergency-stop');
  }

  // ---------------------------------------------------------------------------
  // Risk Endpoints
  // ---------------------------------------------------------------------------

  async getRiskStatus(): Promise<RiskStatus> {
    return this.get<RiskStatus>('/risk/status');
  }

  async getRiskLimits(): Promise<RiskLimits> {
    return this.get<RiskLimits>('/risk/limits');
  }

  async setRiskLimit(
    limitType: keyof RiskLimits,
    value: number
  ): Promise<RiskLimits> {
    return this.put<RiskLimits>(`/risk/limits/${limitType}`, { value });
  }

  async resetDailyRisk(): Promise<RiskStatus> {
    return this.post<RiskStatus>('/risk/reset-daily');
  }

  // ---------------------------------------------------------------------------
  // Orchestrator Endpoints
  // ---------------------------------------------------------------------------

  async getOrchestratorMetrics(): Promise<OrchestratorMetrics> {
    return this.get<OrchestratorMetrics>('/orchestrator/metrics');
  }

  async getEventStats(): Promise<EventStats> {
    return this.get<EventStats>('/orchestrator/events/stats');
  }

  // ---------------------------------------------------------------------------
  // Market Data Endpoints
  // ---------------------------------------------------------------------------

  async getCurrentPrice(symbol: string): Promise<{ symbol: string; price: number; timestamp: number }> {
    return this.get(`/market/price/${symbol}`);
  }

  async getOHLCV(
    symbol: string,
    timeframe: string,
    limit: number = 100
  ): Promise<Array<{ timestamp: number; open: number; high: number; low: number; close: number; volume: number }>> {
    return this.get(`/market/ohlcv/${symbol}?timeframe=${timeframe}&limit=${limit}`);
  }

  async getPortfolioValue(): Promise<{ total: number; available: number; inPositions: number }> {
    return this.get('/portfolio/value');
  }

  // ---------------------------------------------------------------------------
  // Research Endpoints (if backend supports)
  // ---------------------------------------------------------------------------

  async submitResearchQuery(query: string): Promise<{ jobId: string }> {
    return this.post('/research/query', { query });
  }

  async getResearchResult(jobId: string): Promise<{
    status: string;
    result?: { summary: string; sources: string[]; insights: string[] };
  }> {
    return this.get(`/research/result/${jobId}`);
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let tradingAPIInstance: TradingAPIClient | null = null;

export function getTradingAPI(config?: Partial<TradingAPIConfig>): TradingAPIClient {
  if (!tradingAPIInstance) {
    tradingAPIInstance = new TradingAPIClient(config);
    logger.info('Trading API client initialized', { baseUrl: tradingAPIInstance['config'].baseUrl });
  }
  return tradingAPIInstance;
}

export function resetTradingAPI(): void {
  tradingAPIInstance = null;
}

export { TradingAPIClient };
