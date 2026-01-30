/**
 * @fileoverview Trading Voice Integration - Wire trading operations into voice pipeline
 * @module trading/voice-integration
 * @author Atlas Team
 * @since 1.0.0
 *
 * @description
 * This module bridges the trading system with Atlas's voice pipeline,
 * enabling natural voice control of trading operations and providing
 * real-time trading context for personality injection.
 *
 * Atlas becomes fully aware of trading state during all conversations -
 * positions, PnL, market regime, and can speak proactively about trades.
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import { getTradingStateManager } from './state-manager';
import { getResearchAgent } from './research-agent';
import { getPersonalityContextBuilder } from '../personality/personality-context-builder';

const logger = createModuleLogger('TradingVoiceIntegration');

// ============================================================================
// Types
// ============================================================================

/**
 * Trading context summary for voice pipeline injection.
 * This gives Atlas awareness of trading state during conversations.
 */
export interface TradingContextSummary {
  /** Whether autonomous trading is running */
  status: 'running' | 'paused' | 'stopped' | 'error';
  /** Today's realized + unrealized PnL in GBP */
  todayPnL: number;
  /** Number of open positions */
  openPositions: number;
  /** Win rate as decimal (0-1) */
  winRate: number;
  /** Recent trades with results */
  recentTrades: Array<{
    symbol: string;
    result: 'win' | 'loss';
    pnl: number;
    timestamp: Date;
  }>;
  /** Atlas's emotional state based on trading performance */
  mood: 'confident' | 'cautious' | 'nervous' | 'neutral' | 'excited';
  /** Current market regime */
  marketRegime: 'bull' | 'bear' | 'sideways' | 'volatile';
  /** Regime confidence */
  regimeConfidence: number;
  /** Total portfolio value */
  portfolioValue: number;
  /** Daily drawdown percentage */
  dailyDrawdown: number;
  /** Whether kill switch is active */
  killSwitchActive: boolean;
  /** Current streak */
  streak: {
    type: 'win' | 'loss' | 'none';
    count: number;
  };
  /** Quick summary for conversation context */
  quickSummary: string;
}

/**
 * Events emitted by the trading voice integration
 */
export interface TradingVoiceEvents {
  'context-updated': (context: TradingContextSummary) => void;
  'trade-completed': (trade: { symbol: string; result: string; pnl: number }) => void;
  'regime-changed': (regime: { old: string; new: string }) => void;
  'risk-alert': (alert: { type: string; message: string }) => void;
}

// ============================================================================
// TradingVoiceIntegration Class
// ============================================================================

/**
 * Integrates trading module with Atlas voice pipeline.
 *
 * @example
 * ```typescript
 * const integration = getTradingVoiceIntegration();
 * await integration.initialize();
 *
 * // Get current trading context
 * const context = await integration.getTradingContext();
 * ```
 */
export class TradingVoiceIntegration extends EventEmitter {
  private initialized = false;
  private contextUpdateInterval: NodeJS.Timeout | null = null;
  private lastContext: TradingContextSummary | null = null;
  private lastRegime: string | null = null;

  // ============================================================================
  // Initialization
  // ============================================================================

  /**
   * Initialize the trading voice integration.
   * Connects to personality context builder and sets up real-time updates.
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      logger.warn('TradingVoiceIntegration already initialized');
      return;
    }

    logger.info('Initializing TradingVoiceIntegration...');

    try {
      // Wire trading context provider to PersonalityContextBuilder
      const contextBuilder = getPersonalityContextBuilder();
      contextBuilder.setTradingContextProvider(() => this.getTradingContext());

      // Listen to trading events for proactive messages
      this.setupTradingEventListeners();

      // Start periodic context updates (every 30 seconds for trading)
      this.startContextUpdates();

      this.initialized = true;
      logger.info('TradingVoiceIntegration initialized');
    } catch (error) {
      logger.error('Failed to initialize TradingVoiceIntegration', { error });
      throw error;
    }
  }

  /**
   * Set up listeners for trading events to trigger proactive voice messages
   */
  private setupTradingEventListeners(): void {
    try {
      const stateManager = getTradingStateManager();
      
      // Listen for trade completions
      stateManager.on('trade-closed', (trade: { symbol: string; pnl: number }) => {
        const result = trade.pnl >= 0 ? 'win' : 'loss';
        this.emit('trade-completed', { 
          symbol: trade.symbol, 
          result, 
          pnl: trade.pnl 
        });
      });

      // Listen for regime changes
      stateManager.on('regime-changed', (data: { old: string; new: string }) => {
        if (this.lastRegime && this.lastRegime !== data.new) {
          this.emit('regime-changed', data);
        }
        this.lastRegime = data.new;
      });

      // Listen for risk alerts
      stateManager.on('risk-alert', (alert: { type: string; message: string }) => {
        this.emit('risk-alert', alert);
      });

    } catch (error) {
      logger.warn('Could not set up trading event listeners', { error });
    }
  }

  /**
   * Start periodic trading context updates
   */
  private startContextUpdates(): void {
    // Update context every 30 seconds (trading is time-sensitive)
    this.contextUpdateInterval = setInterval(async () => {
      try {
        const context = await this.getTradingContext();
        this.lastContext = context;
        this.emit('context-updated', context);
      } catch (error) {
        logger.warn('Failed to update trading context', { error });
      }
    }, 30 * 1000);
  }

  // ============================================================================
  // Context Provider
  // ============================================================================

  /**
   * Get comprehensive trading context for voice pipeline.
   * This is injected into conversations so Atlas knows trading state.
   */
  async getTradingContext(): Promise<TradingContextSummary> {
    try {
      const stateManager = getTradingStateManager();
      
      // Get current state
      const state = stateManager.getState();
      const positions = stateManager.getPositions();
      const todayPnL = stateManager.getTodayPnL();
      const recentTrades = stateManager.getRecentTrades(10);
      const stats = stateManager.getStats();
      const regime = stateManager.getRegime();

      // Calculate mood based on performance
      const mood = this.calculateMood(todayPnL, stats.winRate, stats.streak);

      // Calculate streak
      const streak = this.calculateStreak(recentTrades);

      // Format recent trades
      const formattedTrades = recentTrades.slice(0, 5).map(t => ({
        symbol: t.symbol,
        result: (t.pnl >= 0 ? 'win' : 'loss') as 'win' | 'loss',
        pnl: t.pnl,
        timestamp: new Date(t.closedAt || t.openedAt),
      }));

      // Generate quick summary
      const quickSummary = this.generateQuickSummary({
        status: state.status,
        todayPnL,
        openPositions: positions.length,
        streak,
        regime: regime.name,
        killSwitchActive: state.killSwitchActive,
      });

      return {
        status: state.status as 'running' | 'paused' | 'stopped' | 'error',
        todayPnL,
        openPositions: positions.length,
        winRate: stats.winRate,
        recentTrades: formattedTrades,
        mood,
        marketRegime: regime.name as 'bull' | 'bear' | 'sideways' | 'volatile',
        regimeConfidence: regime.confidence,
        portfolioValue: state.portfolioValue,
        dailyDrawdown: stats.dailyDrawdown,
        killSwitchActive: state.killSwitchActive,
        streak,
        quickSummary,
      };
    } catch (error) {
      logger.error('Failed to get trading context', { error });
      // Return minimal context on error
      return {
        status: 'error',
        todayPnL: 0,
        openPositions: 0,
        winRate: 0,
        recentTrades: [],
        mood: 'neutral',
        marketRegime: 'sideways',
        regimeConfidence: 0,
        portfolioValue: 0,
        dailyDrawdown: 0,
        killSwitchActive: false,
        streak: { type: 'none', count: 0 },
        quickSummary: 'Trading data unavailable',
      };
    }
  }

  /**
   * Calculate Atlas's emotional state based on trading performance
   */
  private calculateMood(
    todayPnL: number,
    winRate: number,
    streak?: { type: string; count: number }
  ): 'confident' | 'cautious' | 'nervous' | 'neutral' | 'excited' {
    // Excited: Big wins or hot streak
    if (todayPnL > 500 || (streak && streak.type === 'win' && streak.count >= 5)) {
      return 'excited';
    }

    // Confident: Good day and solid win rate
    if (todayPnL > 0 && winRate > 0.55) {
      return 'confident';
    }

    // Nervous: Bad day or losing streak
    if (todayPnL < -300 || (streak && streak.type === 'loss' && streak.count >= 3)) {
      return 'nervous';
    }

    // Cautious: Slight loss or mediocre win rate
    if (todayPnL < 0 || winRate < 0.45) {
      return 'cautious';
    }

    return 'neutral';
  }

  /**
   * Calculate current streak from recent trades
   */
  private calculateStreak(
    trades: Array<{ pnl: number }>
  ): { type: 'win' | 'loss' | 'none'; count: number } {
    if (!trades || trades.length === 0) {
      return { type: 'none', count: 0 };
    }

    const firstResult = trades[0].pnl >= 0 ? 'win' : 'loss';
    let count = 0;

    for (const trade of trades) {
      const result = trade.pnl >= 0 ? 'win' : 'loss';
      if (result === firstResult) {
        count++;
      } else {
        break;
      }
    }

    return { type: firstResult, count };
  }

  /**
   * Generate a quick natural language summary of trading state
   */
  private generateQuickSummary(data: {
    status: string;
    todayPnL: number;
    openPositions: number;
    streak: { type: string; count: number };
    regime: string;
    killSwitchActive: boolean;
  }): string {
    const parts: string[] = [];

    // Kill switch takes priority
    if (data.killSwitchActive) {
      return '⚠️ Kill switch active - trading halted for safety';
    }

    // Status
    if (data.status === 'running') {
      parts.push('Trading active');
    } else if (data.status === 'paused') {
      parts.push('Trading paused');
    } else if (data.status === 'stopped') {
      parts.push('Trading stopped');
    }

    // PnL
    const pnlStr = data.todayPnL >= 0 
      ? `+£${data.todayPnL.toFixed(0)}` 
      : `-£${Math.abs(data.todayPnL).toFixed(0)}`;
    parts.push(`Today: ${pnlStr}`);

    // Positions
    if (data.openPositions > 0) {
      parts.push(`${data.openPositions} open position${data.openPositions > 1 ? 's' : ''}`);
    }

    // Streak (if notable)
    if (data.streak.count >= 3) {
      const emoji = data.streak.type === 'win' ? '🔥' : '❄️';
      parts.push(`${emoji} ${data.streak.count} ${data.streak.type} streak`);
    }

    // Regime
    parts.push(`Market: ${data.regime}`);

    return parts.join('. ') + '.';
  }

  // ============================================================================
  // Voice Command Helpers
  // ============================================================================

  /**
   * Generate a proactive message about a completed trade
   */
  generateTradeMessage(trade: { symbol: string; result: string; pnl: number }): string {
    const pnlStr = trade.pnl >= 0 
      ? `+£${trade.pnl.toFixed(2)}` 
      : `-£${Math.abs(trade.pnl).toFixed(2)}`;

    if (trade.result === 'win') {
      const celebrations = [
        `Nice one! Just closed ${trade.symbol} for ${pnlStr}.`,
        `Winner! ${trade.symbol} closed at ${pnlStr}.`,
        `Banked ${pnlStr} on ${trade.symbol}. Keep it rolling.`,
      ];
      return celebrations[Math.floor(Math.random() * celebrations.length)];
    } else {
      const acknowledgments = [
        `${trade.symbol} stopped out for ${pnlStr}. Part of the game.`,
        `Took an L on ${trade.symbol}: ${pnlStr}. Moving on.`,
        `${trade.symbol} didn't work out. ${pnlStr}. Next opportunity.`,
      ];
      return acknowledgments[Math.floor(Math.random() * acknowledgments.length)];
    }
  }

  /**
   * Generate a proactive message about regime change
   */
  generateRegimeChangeMessage(data: { old: string; new: string }): string {
    const messages: Record<string, string> = {
      'bull': 'Market turning bullish. Good time to look for longs.',
      'bear': 'Market shifting bearish. Being more defensive with positions.',
      'sideways': 'Market going sideways. Tightening ranges, looking for breakouts.',
      'volatile': 'Volatility picking up. Reducing position sizes for safety.',
    };

    return `Heads up - ${messages[data.new] || `Market regime changed to ${data.new}`}`;
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Get the last cached context (for quick access)
   */
  getLastContext(): TradingContextSummary | null {
    return this.lastContext;
  }

  /**
   * Force a context refresh
   */
  async refreshContext(): Promise<TradingContextSummary> {
    const context = await this.getTradingContext();
    this.lastContext = context;
    this.emit('context-updated', context);
    return context;
  }

  /**
   * Shutdown the integration
   */
  shutdown(): void {
    if (this.contextUpdateInterval) {
      clearInterval(this.contextUpdateInterval);
      this.contextUpdateInterval = null;
    }
    this.initialized = false;
    logger.info('TradingVoiceIntegration shutdown');
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: TradingVoiceIntegration | null = null;

/**
 * Get the TradingVoiceIntegration singleton
 */
export function getTradingVoiceIntegration(): TradingVoiceIntegration {
  if (!instance) {
    instance = new TradingVoiceIntegration();
  }
  return instance;
}

/**
 * Initialize the trading voice integration
 */
export async function initializeTradingVoiceIntegration(): Promise<void> {
  const integration = getTradingVoiceIntegration();
  await integration.initialize();
}

/**
 * Shutdown the trading voice integration
 */
export function shutdownTradingVoiceIntegration(): void {
  if (instance) {
    instance.shutdown();
    instance = null;
  }
}

export default TradingVoiceIntegration;
