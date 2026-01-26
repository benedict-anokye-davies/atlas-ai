/**
 * Trading Agent Tools
 *
 * LLM-callable tools for Atlas to control and interact with the trading system.
 * These tools let Atlas talk naturally about trading with full operational control.
 *
 * Tool Categories:
 * - Status & Monitoring
 * - Position Management
 * - Order Execution
 * - Strategy Management
 * - Analysis & Research
 * - Risk Management
 * - System Control
 */

import { createModuleLogger } from '../utils/logger';
import { getTradingAPI, type RiskLimits } from './api-client';
import { getTradingStateManager } from './state-manager';
import { getTradingResearchAgent } from './research-agent';
import type { AgentTool, ActionResult } from '../../shared/types/agent';

const logger = createModuleLogger('TradingTools');

// =============================================================================
// Helper Functions
// =============================================================================

function success(data: unknown): ActionResult {
  return { success: true, data };
}

function error(message: string): ActionResult {
  return { success: false, error: message };
}

// =============================================================================
// Status & Monitoring Tools
// =============================================================================

const getMyTradingStatus: AgentTool = {
  name: 'get_my_trading_status',
  description: `Get Atlas's current trading status - positions, PnL, regime, and mood. Use this when the user asks "how's trading going?" or similar.`,
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (): Promise<ActionResult> => {
    try {
      const stateManager = getTradingStateManager();
      const summary = stateManager.generateStatusSummary();
      const context = await stateManager.getFullContext();
      
      return success({
        summary,
        todayPnL: context.todayPnL,
        todayTrades: context.todayTrades,
        openPositions: context.openPositions.length,
        regime: context.currentRegime?.regime,
        mood: context.mood,
        agentStatus: context.agentStatus,
      });
    } catch (err) {
      logger.error('Failed to get trading status', { error: err });
      return error('Could not retrieve trading status');
    }
  },
};

const getMyPositions: AgentTool = {
  name: 'get_my_positions',
  description: `Get Atlas's current open positions with context about each. Use when user asks about positions.`,
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (): Promise<ActionResult> => {
    try {
      const stateManager = getTradingStateManager();
      const summary = stateManager.generatePositionsSummary();
      const context = await stateManager.getFullContext();
      
      return success({
        summary,
        positions: context.openPositions,
        count: context.openPositions.length,
      });
    } catch (err) {
      logger.error('Failed to get positions', { error: err });
      return error('Could not retrieve positions');
    }
  },
};

const getMyPnL: AgentTool = {
  name: 'get_my_pnl',
  description: `Get Atlas's profit and loss - today, this week, this month. Use when user asks about performance or how much Atlas made/lost.`,
  parameters: {
    type: 'object',
    properties: {
      period: {
        type: 'string',
        enum: ['today', 'week', 'month', 'total'],
        description: 'Time period for PnL',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const api = getTradingAPI();
      const pnl = await api.getPnLSummary();
      const period = (params.period as string) || 'today';
      
      let value: number;
      let percent: number;
      
      switch (period) {
        case 'week':
          value = pnl.week;
          percent = pnl.weekPercent;
          break;
        case 'month':
          value = pnl.month;
          percent = pnl.monthPercent;
          break;
        case 'total':
          value = pnl.total;
          percent = pnl.totalPercent;
          break;
        default:
          value = pnl.today;
          percent = pnl.todayPercent;
      }
      
      return success({
        period,
        pnl: value,
        pnlPercent: percent,
        winRate: pnl.winRate,
        sharpe: pnl.sharpeRatio,
        maxDrawdown: pnl.maxDrawdown,
      });
    } catch (err) {
      logger.error('Failed to get PnL', { error: err });
      return error('Could not retrieve PnL data');
    }
  },
};

const getRecentTrades: AgentTool = {
  name: 'get_recent_trades',
  description: `Get Atlas's recent trades with context and lessons learned. Use when user asks about recent trades or what Atlas has been doing.`,
  parameters: {
    type: 'object',
    properties: {
      count: {
        type: 'number',
        description: 'Number of trades to retrieve',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const stateManager = getTradingStateManager();
      const count = (params.count as number) || 5;
      const summary = stateManager.generateRecentTradesSummary(count);
      const context = await stateManager.getFullContext();
      
      return success({
        summary,
        trades: context.recentTrades.slice(0, count),
      });
    } catch (err) {
      logger.error('Failed to get recent trades', { error: err });
      return error('Could not retrieve recent trades');
    }
  },
};

const getCurrentRegime: AgentTool = {
  name: 'get_current_regime',
  description: `Get the current market regime and how Atlas is adjusting for it. Use when user asks about market conditions.`,
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (): Promise<ActionResult> => {
    try {
      const api = getTradingAPI();
      const regime = await api.getCurrentRegime();
      
      return success({
        regime: regime.regime,
        confidence: regime.confidence,
        duration: regime.duration,
        adjustments: regime.adjustments,
      });
    } catch (err) {
      logger.error('Failed to get regime', { error: err });
      return error('Could not retrieve market regime');
    }
  },
};

// =============================================================================
// Position Management Tools
// =============================================================================

const closePosition: AgentTool = {
  name: 'close_position',
  description: `Close one of Atlas's open positions. REQUIRES CONFIRMATION. Use when user asks to close a position.`,
  parameters: {
    type: 'object',
    properties: {
      symbol: {
        type: 'string',
        description: 'Symbol to close (e.g., BTC, ETH)',
      },
      reason: {
        type: 'string',
        description: 'Reason for closing',
      },
    },
    required: ['symbol'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const api = getTradingAPI();
      const symbol = params.symbol as string;
      const reason = params.reason as string | undefined;
      const trade = await api.closePosition(symbol, reason);
      
      return success({
        trade,
        symbol,
        pnl: trade.pnl,
      });
    } catch (err) {
      logger.error('Failed to close position', { error: err, symbol: params.symbol });
      return error(`Could not close ${params.symbol} position`);
    }
  },
};

const closeAllPositions: AgentTool = {
  name: 'close_all_positions',
  description: `Close ALL of Atlas's open positions. REQUIRES CONFIRMATION. Use for emergency exits or when user says to close everything.`,
  parameters: {
    type: 'object',
    properties: {
      reason: {
        type: 'string',
        description: 'Reason for closing all',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const api = getTradingAPI();
      const reason = params.reason as string | undefined;
      const trades = await api.closeAllPositions(reason);
      
      const totalPnL = trades.reduce((sum, t) => sum + t.pnl, 0);
      
      return success({
        trades,
        count: trades.length,
        totalPnL,
      });
    } catch (err) {
      logger.error('Failed to close all positions', { error: err });
      return error('Could not close all positions');
    }
  },
};

const updateStopLoss: AgentTool = {
  name: 'update_stop_loss',
  description: `Update the stop loss on an open position. Use when user wants to adjust risk.`,
  parameters: {
    type: 'object',
    properties: {
      symbol: {
        type: 'string',
        description: 'Symbol to update',
      },
      stopLoss: {
        type: 'number',
        description: 'New stop loss price',
      },
    },
    required: ['symbol', 'stopLoss'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const api = getTradingAPI();
      const symbol = params.symbol as string;
      const stopLoss = params.stopLoss as number;
      const position = await api.updatePositionStopLoss(symbol, stopLoss);
      
      return success({ position });
    } catch (err) {
      logger.error('Failed to update stop loss', { error: err });
      return error(`Could not update stop loss for ${params.symbol}`);
    }
  },
};

const updateTakeProfit: AgentTool = {
  name: 'update_take_profit',
  description: `Update the take profit target on an open position.`,
  parameters: {
    type: 'object',
    properties: {
      symbol: {
        type: 'string',
        description: 'Symbol to update',
      },
      takeProfit: {
        type: 'number',
        description: 'New take profit price',
      },
    },
    required: ['symbol', 'takeProfit'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const api = getTradingAPI();
      const symbol = params.symbol as string;
      const takeProfit = params.takeProfit as number;
      const position = await api.updatePositionTakeProfit(symbol, takeProfit);
      
      return success({ position });
    } catch (err) {
      logger.error('Failed to update take profit', { error: err });
      return error(`Could not update take profit for ${params.symbol}`);
    }
  },
};

// =============================================================================
// Order Execution Tools
// =============================================================================

/**
 * Pre-trade sentiment check
 * Returns sentiment data and whether it aligns with trade direction
 */
async function checkPreTradeSentiment(
  symbol: string,
  side: 'buy' | 'sell'
): Promise<{
  sentiment: {
    score: number;
    label: 'bearish' | 'neutral' | 'bullish';
    confidence: number;
  };
  aligns: boolean;
  warning?: string;
}> {
  try {
    const research = getTradingResearchAgent();
    const snapshot = await research.getSentimentSnapshot(symbol);
    
    const direction = side === 'buy' ? 'bullish' : 'bearish';
    const oppositeDirection = side === 'buy' ? 'bearish' : 'bullish';
    
    const aligns = snapshot.combined.label === direction || snapshot.combined.label === 'neutral';
    
    let warning: string | undefined;
    if (snapshot.combined.label === oppositeDirection && snapshot.combined.confidence > 0.6) {
      warning = `⚠️ Sentiment is ${snapshot.combined.label} (${(snapshot.combined.score * 100).toFixed(0)}% score) - opposite to your ${side} direction`;
    }
    
    return {
      sentiment: snapshot.combined,
      aligns,
      warning,
    };
  } catch (err) {
    logger.warn('Sentiment check failed, proceeding anyway', { symbol, error: err });
    return {
      sentiment: { score: 0, label: 'neutral', confidence: 0 },
      aligns: true, // Don't block trade if sentiment unavailable
    };
  }
}

const placeTrade: AgentTool = {
  name: 'place_trade',
  description: `Place a new trade. REQUIRES CONFIRMATION. Atlas will calculate proper position size using Kelly criterion, regime adjustments, AND check market sentiment before execution.`,
  parameters: {
    type: 'object',
    properties: {
      symbol: {
        type: 'string',
        description: 'Symbol to trade (e.g., BTC, ETH, SOL)',
      },
      side: {
        type: 'string',
        enum: ['buy', 'sell'],
        description: 'Trade direction',
      },
      amount: {
        type: 'number',
        description: 'Amount to trade (optional - will calculate optimal size if not provided)',
      },
      stopLossPercent: {
        type: 'number',
        description: 'Stop loss as percentage (e.g., 2 for 2%)',
      },
      takeProfitPercent: {
        type: 'number',
        description: 'Take profit as percentage (e.g., 4 for 4%)',
      },
      reasoning: {
        type: 'string',
        description: 'Why Atlas is taking this trade',
      },
      skipSentimentCheck: {
        type: 'boolean',
        description: 'Skip sentiment check (default false) - use only if you have strong conviction',
      },
    },
    required: ['symbol', 'side'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const api = getTradingAPI();
      const symbol = params.symbol as string;
      const side = params.side as 'buy' | 'sell';
      const skipSentiment = params.skipSentimentCheck === true;
      
      // Pre-trade sentiment check
      let sentimentWarning: string | undefined;
      if (!skipSentiment) {
        logger.info('Checking pre-trade sentiment', { symbol, side });
        const sentimentCheck = await checkPreTradeSentiment(symbol, side);
        
        if (sentimentCheck.warning) {
          sentimentWarning = sentimentCheck.warning;
          logger.warn('Sentiment mismatch detected', { 
            symbol, 
            side, 
            sentiment: sentimentCheck.sentiment 
          });
        }
      }
      
      // Calculate optimal position size if not provided
      let quantity = params.amount as number | undefined;
      if (!quantity) {
        const sizing = await api.calculatePositionSize({
          symbol,
          direction: side === 'buy' ? 'long' : 'short',
        });
        quantity = sizing.positionSize;
        logger.info('Calculated position size', { symbol, size: quantity });
      }
      
      const order = await api.placeOrder({
        symbol,
        side,
        type: 'market',
        quantity,
        stopLossPercent: params.stopLossPercent as number | undefined,
        takeProfitPercent: params.takeProfitPercent as number | undefined,
      });
      
      return success({
        order,
        symbol,
        side,
        quantity,
        sentimentWarning, // Include warning in response so Atlas can mention it
      });
    } catch (err) {
      logger.error('Failed to place trade', { error: err });
      return error(`Could not place ${params.side} order for ${params.symbol}`);
    }
  },
};

const cancelOrder: AgentTool = {
  name: 'cancel_order',
  description: `Cancel a pending order.`,
  parameters: {
    type: 'object',
    properties: {
      orderId: {
        type: 'string',
        description: 'Order ID to cancel',
      },
    },
    required: ['orderId'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const api = getTradingAPI();
      const orderId = params.orderId as string;
      const order = await api.cancelOrder(orderId);
      
      return success({ order });
    } catch (err) {
      logger.error('Failed to cancel order', { error: err });
      return error('Could not cancel order');
    }
  },
};

const getPendingOrders: AgentTool = {
  name: 'get_pending_orders',
  description: `Get all pending orders.`,
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (): Promise<ActionResult> => {
    try {
      const api = getTradingAPI();
      const orders = await api.getOrders('open');
      
      return success({ orders, count: orders.length });
    } catch (err) {
      logger.error('Failed to get pending orders', { error: err });
      return error('Could not retrieve pending orders');
    }
  },
};

// =============================================================================
// Analysis & Research Tools
// =============================================================================

const analyzeSymbol: AgentTool = {
  name: 'analyze_symbol',
  description: `Get Atlas's analysis of a symbol including signals, sentiment, and recommendations.`,
  parameters: {
    type: 'object',
    properties: {
      symbol: {
        type: 'string',
        description: 'Symbol to analyze (e.g., BTC, ETH)',
      },
    },
    required: ['symbol'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const api = getTradingAPI();
      const researchAgent = getTradingResearchAgent();
      const symbol = params.symbol as string;
      
      const [aggregatedSignal, sentiment, price] = await Promise.all([
        api.getAggregatedSignal(symbol).catch(() => null),
        researchAgent.getCachedSentiment(symbol),
        api.getCurrentPrice(symbol).catch(() => null),
      ]);
      
      return success({
        symbol,
        price: price?.price,
        signal: aggregatedSignal,
        sentiment,
      });
    } catch (err) {
      logger.error('Failed to analyze symbol', { error: err });
      return error(`Could not analyze ${params.symbol}`);
    }
  },
};

const researchTopic: AgentTool = {
  name: 'research_topic',
  description: `Have Atlas research a trading topic using Perplexity and other sources. Use when user asks Atlas to research something.`,
  parameters: {
    type: 'object',
    properties: {
      topic: {
        type: 'string',
        description: 'Topic to research',
      },
    },
    required: ['topic'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const researchAgent = getTradingResearchAgent();
      const topic = params.topic as string;
      
      const research = await researchAgent.conductResearch({
        topic,
        sources: ['perplexity'],
      });
      
      return success({
        topic,
        insight: research.synthesizedInsight,
        actions: research.actionableItems,
        confidence: research.confidence,
      });
    } catch (err) {
      logger.error('Failed to research topic', { error: err });
      return error('Could not complete research');
    }
  },
};

const getMarketSentiment: AgentTool = {
  name: 'get_market_sentiment',
  description: `Get current market sentiment from Twitter and Reddit.`,
  parameters: {
    type: 'object',
    properties: {
      symbol: {
        type: 'string',
        description: 'Symbol to check sentiment for',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const researchAgent = getTradingResearchAgent();
      const symbol = params.symbol as string | undefined;
      
      if (symbol) {
        const sentiment = await researchAgent.getSentimentSnapshot(symbol);
        return success({ sentiment, symbol });
      } else {
        const brief = await researchAgent.getMarketBrief();
        return success({ brief });
      }
    } catch (err) {
      logger.error('Failed to get sentiment', { error: err });
      return error('Could not retrieve market sentiment');
    }
  },
};

const runBacktest: AgentTool = {
  name: 'run_backtest',
  description: `Run a backtest on a strategy to see how it would have performed historically.`,
  parameters: {
    type: 'object',
    properties: {
      strategyId: {
        type: 'string',
        description: 'Strategy ID to backtest',
      },
      startDate: {
        type: 'string',
        description: 'Start date (YYYY-MM-DD)',
      },
      endDate: {
        type: 'string',
        description: 'End date (YYYY-MM-DD)',
      },
    },
    required: ['strategyId'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const api = getTradingAPI();
      const strategyId = params.strategyId as string;
      const startDate = (params.startDate as string) || '2024-01-01';
      const endDate = (params.endDate as string) || new Date().toISOString().split('T')[0];
      
      const result = await api.runBacktest({
        strategyId,
        startDate,
        endDate,
      });
      
      return success({ result, strategyId });
    } catch (err) {
      logger.error('Failed to run backtest', { error: err });
      return error('Could not run backtest');
    }
  },
};

const validateStrategyRobustness: AgentTool = {
  name: 'validate_strategy_robustness',
  description: `Run Monte Carlo validation to check if a strategy is robust or potentially overfit.`,
  parameters: {
    type: 'object',
    properties: {
      strategyId: {
        type: 'string',
        description: 'Strategy ID to validate',
      },
      simulations: {
        type: 'number',
        description: 'Number of Monte Carlo simulations',
      },
    },
    required: ['strategyId'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const api = getTradingAPI();
      const strategyId = params.strategyId as string;
      const simulations = (params.simulations as number) || 1000;
      
      // Get strategy trades first
      const trades = await api.getTradesByStrategy(strategyId, 200);
      const pnls = trades.map(t => t.pnl);
      
      const result = await api.runMonteCarloValidation({
        trades: pnls,
        simulations,
      });
      
      return success({ result, strategyId });
    } catch (err) {
      logger.error('Failed to validate strategy', { error: err });
      return error('Could not validate strategy');
    }
  },
};

// =============================================================================
// Strategy Management Tools
// =============================================================================

const getMyStrategies: AgentTool = {
  name: 'get_my_strategies',
  description: `Get all of Atlas's trading strategies and their status.`,
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (): Promise<ActionResult> => {
    try {
      const api = getTradingAPI();
      const strategies = await api.getStrategies();
      
      const active = strategies.filter(s => s.status === 'active');
      const paused = strategies.filter(s => s.status === 'paused');
      const paper = strategies.filter(s => s.status === 'paperTrading');
      
      return success({
        strategies,
        active,
        paused,
        paper,
        counts: {
          total: strategies.length,
          active: active.length,
          paused: paused.length,
          paper: paper.length,
        },
      });
    } catch (err) {
      logger.error('Failed to get strategies', { error: err });
      return error('Could not retrieve strategies');
    }
  },
};

const pauseStrategy: AgentTool = {
  name: 'pause_strategy',
  description: `Pause a trading strategy.`,
  parameters: {
    type: 'object',
    properties: {
      strategyId: {
        type: 'string',
        description: 'Strategy ID to pause',
      },
    },
    required: ['strategyId'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const api = getTradingAPI();
      const strategyId = params.strategyId as string;
      const strategy = await api.pauseStrategy(strategyId);
      
      return success({ strategy });
    } catch (err) {
      logger.error('Failed to pause strategy', { error: err });
      return error('Could not pause strategy');
    }
  },
};

const activateStrategy: AgentTool = {
  name: 'activate_strategy',
  description: `Activate a trading strategy.`,
  parameters: {
    type: 'object',
    properties: {
      strategyId: {
        type: 'string',
        description: 'Strategy ID to activate',
      },
    },
    required: ['strategyId'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const api = getTradingAPI();
      const strategyId = params.strategyId as string;
      const strategy = await api.activateStrategy(strategyId);
      
      return success({ strategy });
    } catch (err) {
      logger.error('Failed to activate strategy', { error: err });
      return error('Could not activate strategy');
    }
  },
};

const getStrategyViability: AgentTool = {
  name: 'get_strategy_viability',
  description: `Check if a strategy is viable based on backtesting and validation metrics.`,
  parameters: {
    type: 'object',
    properties: {
      strategyId: {
        type: 'string',
        description: 'Strategy ID to check',
      },
    },
    required: ['strategyId'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const api = getTradingAPI();
      const strategyId = params.strategyId as string;
      const viability = await api.getStrategyViability(strategyId);
      
      return success({ viability, strategyId });
    } catch (err) {
      logger.error('Failed to get strategy viability', { error: err });
      return error('Could not check strategy viability');
    }
  },
};

// =============================================================================
// Risk Management Tools
// =============================================================================

const getRiskStatus: AgentTool = {
  name: 'get_risk_status',
  description: `Get current risk status including daily/weekly limits and drawdown.`,
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (): Promise<ActionResult> => {
    try {
      const api = getTradingAPI();
      const risk = await api.getRiskStatus();
      
      return success({ risk });
    } catch (err) {
      logger.error('Failed to get risk status', { error: err });
      return error('Could not retrieve risk status');
    }
  },
};

const setRiskLimit: AgentTool = {
  name: 'set_risk_limit',
  description: `Update a risk limit. REQUIRES CONFIRMATION.`,
  parameters: {
    type: 'object',
    properties: {
      limitType: {
        type: 'string',
        enum: ['maxDailyLoss', 'maxWeeklyLoss', 'maxDrawdown', 'maxPositionSize'],
        description: 'Type of limit to update',
      },
      value: {
        type: 'number',
        description: 'New limit value',
      },
    },
    required: ['limitType', 'value'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const api = getTradingAPI();
      const limitType = params.limitType as keyof RiskLimits;
      const value = params.value as number;
      const limits = await api.setRiskLimit(limitType, value);
      
      return success({ limits, limitType, value });
    } catch (err) {
      logger.error('Failed to set risk limit', { error: err });
      return error('Could not update risk limit');
    }
  },
};

const emergencyStopTrading: AgentTool = {
  name: 'emergency_stop_trading',
  description: `EMERGENCY: Stop all trading, close all positions, cancel all orders. Use only in emergencies.`,
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (): Promise<ActionResult> => {
    try {
      const api = getTradingAPI();
      const result = await api.emergencyStop();
      
      return success({ result });
    } catch (err) {
      logger.error('EMERGENCY STOP FAILED', { error: err });
      return error('CRITICAL: Emergency stop failed - manual intervention needed');
    }
  },
};

// =============================================================================
// System Control Tools
// =============================================================================

const startTrading: AgentTool = {
  name: 'start_trading',
  description: `Start the trading agent. Use when user says to start trading.`,
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (): Promise<ActionResult> => {
    try {
      const api = getTradingAPI();
      const status = await api.startAgent();
      
      return success({ status });
    } catch (err) {
      logger.error('Failed to start trading', { error: err });
      return error('Could not start trading');
    }
  },
};

const stopTrading: AgentTool = {
  name: 'stop_trading',
  description: `Stop the trading agent. Use when user says to stop trading.`,
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (): Promise<ActionResult> => {
    try {
      const api = getTradingAPI();
      const status = await api.stopAgent();
      
      return success({ status });
    } catch (err) {
      logger.error('Failed to stop trading', { error: err });
      return error('Could not stop trading');
    }
  },
};

const pauseTrading: AgentTool = {
  name: 'pause_trading',
  description: `Temporarily pause trading. Will keep positions but won't open new ones.`,
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (): Promise<ActionResult> => {
    try {
      const api = getTradingAPI();
      const status = await api.pauseAgent();
      
      return success({ status });
    } catch (err) {
      logger.error('Failed to pause trading', { error: err });
      return error('Could not pause trading');
    }
  },
};

const resumeTrading: AgentTool = {
  name: 'resume_trading',
  description: `Resume trading after being paused.`,
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (): Promise<ActionResult> => {
    try {
      const api = getTradingAPI();
      const status = await api.resumeAgent();
      
      return success({ status });
    } catch (err) {
      logger.error('Failed to resume trading', { error: err });
      return error('Could not resume trading');
    }
  },
};

const getSystemMetrics: AgentTool = {
  name: 'get_trading_system_metrics',
  description: `Get technical metrics about the trading system - latency, events processed, etc.`,
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (): Promise<ActionResult> => {
    try {
      const api = getTradingAPI();
      const [orchestrator, events] = await Promise.all([
        api.getOrchestratorMetrics(),
        api.getEventStats(),
      ]);
      
      return success({ orchestrator, events });
    } catch (err) {
      logger.error('Failed to get system metrics', { error: err });
      return error('Could not retrieve system metrics');
    }
  },
};

// =============================================================================
// Watchlist & Research Management Tools
// =============================================================================

const addToWatchlist: AgentTool = {
  name: 'add_to_watchlist',
  description: `Add a symbol to Atlas's watchlist for monitoring.`,
  parameters: {
    type: 'object',
    properties: {
      symbol: {
        type: 'string',
        description: 'Symbol to watch',
      },
      direction: {
        type: 'string',
        enum: ['long', 'short'],
        description: 'Direction Atlas is interested in',
      },
      reasoning: {
        type: 'string',
        description: 'Why Atlas is watching this',
      },
      triggerCondition: {
        type: 'string',
        description: 'What needs to happen to trigger a trade',
      },
      priority: {
        type: 'string',
        enum: ['high', 'medium', 'low'],
        description: 'Priority level',
      },
    },
    required: ['symbol', 'direction', 'reasoning', 'triggerCondition'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const stateManager = getTradingStateManager();
      const symbol = (params.symbol as string).toUpperCase();
      const direction = params.direction as 'long' | 'short';
      const reasoning = params.reasoning as string;
      const triggerCondition = params.triggerCondition as string;
      const priority = (params.priority as 'high' | 'medium' | 'low') || 'medium';
      
      stateManager.addToWatchlist({
        symbol,
        direction,
        reasoning,
        triggerCondition,
        priority,
      });
      
      return success({ added: true, symbol, direction });
    } catch (err) {
      logger.error('Failed to add to watchlist', { error: err });
      return error('Could not add to watchlist');
    }
  },
};

const getWatchlist: AgentTool = {
  name: 'get_watchlist',
  description: `Get Atlas's current watchlist.`,
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (): Promise<ActionResult> => {
    try {
      const stateManager = getTradingStateManager();
      const context = await stateManager.getFullContext();
      
      return success({ watchlist: context.watchlist, count: context.watchlist.length });
    } catch (err) {
      logger.error('Failed to get watchlist', { error: err });
      return error('Could not retrieve watchlist');
    }
  },
};

const getCurrentResearch: AgentTool = {
  name: 'get_current_research',
  description: `Get what Atlas is currently researching and working on.`,
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (): Promise<ActionResult> => {
    try {
      const stateManager = getTradingStateManager();
      const researchAgent = getTradingResearchAgent();
      const context = await stateManager.getFullContext();
      const strategyIdeas = researchAgent.getStrategyIdeas();
      
      return success({
        research: context.activeResearch,
        improvements: context.improvements,
        strategyIdeas,
      });
    } catch (err) {
      logger.error('Failed to get current research', { error: err });
      return error('Could not retrieve research status');
    }
  },
};

// =============================================================================
// Export All Tools
// =============================================================================

export const tradingTools: AgentTool[] = [
  // Status & Monitoring
  getMyTradingStatus,
  getMyPositions,
  getMyPnL,
  getRecentTrades,
  getCurrentRegime,
  
  // Position Management
  closePosition,
  closeAllPositions,
  updateStopLoss,
  updateTakeProfit,
  
  // Order Execution
  placeTrade,
  cancelOrder,
  getPendingOrders,
  
  // Analysis & Research
  analyzeSymbol,
  researchTopic,
  getMarketSentiment,
  runBacktest,
  validateStrategyRobustness,
  
  // Strategy Management
  getMyStrategies,
  pauseStrategy,
  activateStrategy,
  getStrategyViability,
  
  // Risk Management
  getRiskStatus,
  setRiskLimit,
  emergencyStopTrading,
  
  // System Control
  startTrading,
  stopTrading,
  pauseTrading,
  resumeTrading,
  getSystemMetrics,
  
  // Watchlist & Research
  addToWatchlist,
  getWatchlist,
  getCurrentResearch,
];

export function getTradingTools(): AgentTool[] {
  return tradingTools;
}

// Tool names for reference
export const tradingToolNames = tradingTools.map(t => t.name);
