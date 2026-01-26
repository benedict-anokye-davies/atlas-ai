/**
 * Trading State Manager
 *
 * Maintains Atlas's comprehensive trading state for natural conversations.
 * This is how Atlas "knows" what's happening with trading at any moment.
 *
 * Tracks:
 * - Current positions and their stories
 * - Today's performance narrative
 * - Recent wins and losses with context
 * - What Atlas is "thinking about" in terms of trades
 * - Research and improvement work in progress
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import { getTradingAPI, type Trade, type Position, type Strategy, type RegimeState, type PnLSummary, type Signal } from './api-client';
import { getTradingWebSocket } from './websocket-client';

const logger = createModuleLogger('TradingState');

// =============================================================================
// Types
// =============================================================================

export interface TradingMood {
  overall: 'great' | 'good' | 'okay' | 'rough' | 'bad';
  confidence: number;
  factors: string[];
}

export interface TradeStory {
  trade: Trade;
  thesis: string; // Why Atlas took this trade
  outcome: string; // What happened
  lesson?: string; // What Atlas learned (if anything)
  wouldDoAgain: boolean;
}

export interface PositionStory {
  position: Position;
  entryReasoning: string;
  currentThinking: string;
  targetScenario: string;
  stopScenario: string;
  confidence: number;
}

export interface WatchlistItem {
  symbol: string;
  direction: 'long' | 'short';
  reasoning: string;
  triggerCondition: string;
  addedAt: number;
  priority: 'high' | 'medium' | 'low';
}

export interface ResearchItem {
  topic: string;
  status: 'researching' | 'backtesting' | 'paper-testing' | 'completed' | 'abandoned';
  findings?: string;
  startedAt: number;
  updatedAt: number;
}

export interface ImprovementItem {
  description: string;
  type: 'bug-fix' | 'optimization' | 'new-feature' | 'strategy';
  status: 'planned' | 'in-progress' | 'completed' | 'abandoned';
  impact?: string;
  startedAt: number;
  completedAt?: number;
}

export interface DailySummary {
  date: string;
  pnl: number;
  pnlPercent: number;
  trades: number;
  wins: number;
  losses: number;
  bestTrade?: TradeStory;
  worstTrade?: TradeStory;
  regimes: string[];
  narrative: string; // Human-readable summary
  mood: TradingMood;
}

export interface TradingContext {
  // Current state
  currentRegime: RegimeState | null;
  openPositions: PositionStory[];
  pendingOrders: number;
  
  // Today's performance
  todayPnL: number;
  todayPnLPercent: number;
  todayTrades: number;
  todayWins: number;
  todayLosses: number;
  
  // Week/Month
  weekPnL: number;
  monthPnL: number;
  
  // Recent notable events
  recentTrades: TradeStory[];
  recentWins: TradeStory[];
  recentLosses: TradeStory[];
  
  // What Atlas is working on
  watchlist: WatchlistItem[];
  activeResearch: ResearchItem[];
  improvements: ImprovementItem[];
  
  // Overall state
  mood: TradingMood;
  agentStatus: 'running' | 'paused' | 'stopped' | 'error';
  lastUpdate: number;
}

export interface ConversationContext {
  shouldMentionTrading: boolean;
  tradingHighlight?: string;
  tradingConcern?: string;
  canAskAbout: string[];
}

// =============================================================================
// State Manager Class
// =============================================================================

export class TradingStateManager extends EventEmitter {
  private api = getTradingAPI();
  private ws = getTradingWebSocket();
  
  // Core state
  private currentRegime: RegimeState | null = null;
  private openPositions: Map<string, PositionStory> = new Map();
  private recentTrades: TradeStory[] = [];
  private pnlSummary: PnLSummary | null = null;
  private agentStatus: 'running' | 'paused' | 'stopped' | 'error' = 'stopped';
  
  // Atlas's working state
  private watchlist: WatchlistItem[] = [];
  private activeResearch: ResearchItem[] = [];
  private improvements: ImprovementItem[] = [];
  
  // Daily tracking
  private dailySummaries: Map<string, DailySummary> = new Map();
  private todayDate: string = '';
  
  // Update tracking
  private lastFullRefresh: number = 0;
  private refreshInterval: NodeJS.Timeout | null = null;

  constructor() {
    super();
    this.todayDate = this.getDateString();
    this.setupWebSocketListeners();
  }

  // ---------------------------------------------------------------------------
  // Initialization
  // ---------------------------------------------------------------------------

  async initialize(): Promise<void> {
    logger.info('Initializing trading state manager');
    
    // Connect WebSocket
    this.ws.connect();
    
    // Initial data fetch
    await this.fullRefresh();
    
    // Start periodic refresh
    this.refreshInterval = setInterval(() => {
      this.fullRefresh().catch((err) => {
        logger.error('Periodic refresh failed', { error: err });
      });
    }, 60000); // Every minute
    
    logger.info('Trading state manager initialized');
  }

  shutdown(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
    this.ws.disconnect();
    logger.info('Trading state manager shutdown');
  }

  /**
   * Check if state manager is initialized and has data
   */
  isReady(): boolean {
    return this.lastFullRefresh > 0;
  }

  // ---------------------------------------------------------------------------
  // Data Refresh
  // ---------------------------------------------------------------------------

  async fullRefresh(): Promise<void> {
    try {
      const [regime, positions, trades, pnl, strategies, status] = await Promise.all([
        this.api.getCurrentRegime().catch(() => null),
        this.api.getPositions().catch(() => []),
        this.api.getRecentTrades(7).catch(() => []),
        this.api.getPnLSummary().catch(() => null),
        this.api.getStrategies().catch(() => []),
        this.api.getAgentStatus().catch(() => null),
      ]);

      this.currentRegime = regime;
      this.pnlSummary = pnl;
      
      if (status) {
        this.agentStatus = status.state;
      }

      // Update positions with stories
      this.openPositions.clear();
      for (const pos of positions) {
        this.openPositions.set(pos.symbol, this.createPositionStory(pos));
      }

      // Update recent trades with stories
      this.recentTrades = trades.slice(0, 20).map((t) => this.createTradeStory(t));

      // Check for day change
      const today = this.getDateString();
      if (today !== this.todayDate) {
        await this.handleDayChange(today);
      }

      this.lastFullRefresh = Date.now();
      this.emit('state-updated');
    } catch (error) {
      logger.error('Full refresh failed', { error });
    }
  }

  // ---------------------------------------------------------------------------
  // WebSocket Event Handling
  // ---------------------------------------------------------------------------

  private setupWebSocketListeners(): void {
    this.ws.on('trade', (event) => this.handleTradeEvent(event));
    this.ws.on('position', (event) => this.handlePositionEvent(event));
    this.ws.on('regime', (event) => this.handleRegimeEvent(event));
    this.ws.on('agent-state', (event) => this.handleAgentStateEvent(event));
    this.ws.on('risk', (event) => this.handleRiskEvent(event));
  }

  private handleTradeEvent(event: { trade: Trade; conversationalMessage: string }): void {
    const story = this.createTradeStory(event.trade);
    this.recentTrades.unshift(story);
    this.recentTrades = this.recentTrades.slice(0, 20);
    
    // Update PnL
    if (this.pnlSummary) {
      this.pnlSummary.today += event.trade.pnl;
    }
    
    this.emit('trade', { story, message: event.conversationalMessage });
  }

  private handlePositionEvent(event: { action: string; position: Position }): void {
    if (event.action === 'opened') {
      this.openPositions.set(event.position.symbol, this.createPositionStory(event.position));
    } else if (event.action === 'closed') {
      this.openPositions.delete(event.position.symbol);
    } else {
      const existing = this.openPositions.get(event.position.symbol);
      if (existing) {
        existing.position = event.position;
        existing.currentThinking = this.generateCurrentThinking(event.position);
      }
    }
    
    this.emit('position-update');
  }

  private handleRegimeEvent(event: { newRegime: string; confidence: number; conversationalMessage: string }): void {
    if (this.currentRegime) {
      this.currentRegime.regime = event.newRegime as RegimeState['regime'];
      this.currentRegime.confidence = event.confidence;
    }
    
    this.emit('regime-change', { message: event.conversationalMessage });
  }

  private handleAgentStateEvent(event: { newState: string; conversationalMessage: string }): void {
    this.agentStatus = event.newState as typeof this.agentStatus;
    this.emit('agent-state-change', { message: event.conversationalMessage });
  }

  private handleRiskEvent(event: { severity: string; message: string; conversationalMessage: string }): void {
    this.emit('risk-alert', { 
      severity: event.severity, 
      message: event.conversationalMessage 
    });
  }

  // ---------------------------------------------------------------------------
  // Story Generation
  // ---------------------------------------------------------------------------

  private createTradeStory(trade: Trade): TradeStory {
    const isWin = trade.pnl > 0;
    
    // Generate thesis based on available data
    const thesis = trade.reasoning || this.inferTradeThesis(trade);
    
    // Generate outcome narrative
    const outcome = this.generateTradeOutcome(trade);
    
    // Generate lesson if it was a loss
    const lesson = !isWin ? this.generateTradingLesson(trade) : undefined;
    
    return {
      trade,
      thesis,
      outcome,
      lesson,
      wouldDoAgain: isWin || trade.pnlPercent > -0.02, // Would do again if win or small loss
    };
  }

  private inferTradeThesis(trade: Trade): string {
    const regime = this.currentRegime?.regime || 'Unknown';
    const side = trade.side === 'buy' ? 'long' : 'short';
    
    // Try to infer from strategy ID
    if (trade.strategyId.includes('momentum')) {
      return `Momentum signal showed strength on ${trade.symbol} in ${regime} regime.`;
    } else if (trade.strategyId.includes('reversion')) {
      return `Mean reversion setup - ${trade.symbol} looked extended.`;
    } else if (trade.strategyId.includes('breakout')) {
      return `Breakout pattern on ${trade.symbol} with volume confirmation.`;
    }
    
    return `${side.charAt(0).toUpperCase() + side.slice(1)} signal on ${trade.symbol} from ${trade.strategyId}.`;
  }

  private generateTradeOutcome(trade: Trade): string {
    const pnlAbs = Math.abs(trade.pnl);
    const isWin = trade.pnl > 0;
    
    if (isWin) {
      if (trade.pnlPercent > 0.03) {
        return `Solid win - caught a good move for ${pnlAbs.toFixed(2)} quid.`;
      } else if (trade.pnlPercent > 0.01) {
        return `Clean trade, took ${pnlAbs.toFixed(2)} quid profit.`;
      } else {
        return `Small win of ${pnlAbs.toFixed(2)} quid. Nothing wrong with that.`;
      }
    } else {
      if (trade.pnlPercent < -0.03) {
        return `Bigger loss than I'd like - ${pnlAbs.toFixed(2)} quid. Need to review this one.`;
      } else if (trade.pnlPercent < -0.01) {
        return `Stop hit, lost ${pnlAbs.toFixed(2)} quid. Part of trading.`;
      } else {
        return `Small loss of ${pnlAbs.toFixed(2)} quid. Quick cut.`;
      }
    }
  }

  private generateTradingLesson(trade: Trade): string {
    if (trade.pnlPercent < -0.05) {
      return 'Position was too big for the setup quality. Size down on uncertain entries.';
    } else if (trade.pnlPercent < -0.02) {
      return 'Stop placement could have been better. Consider volatility-adjusted stops.';
    }
    return 'Normal loss within risk parameters. No changes needed.';
  }

  private createPositionStory(position: Position): PositionStory {
    return {
      position,
      entryReasoning: this.generateEntryReasoning(position),
      currentThinking: this.generateCurrentThinking(position),
      targetScenario: this.generateTargetScenario(position),
      stopScenario: this.generateStopScenario(position),
      confidence: this.calculatePositionConfidence(position),
    };
  }

  private generateEntryReasoning(position: Position): string {
    const side = position.side === 'long' ? 'Long' : 'Short';
    return `${side} ${position.symbol} at ${position.entryPrice.toFixed(2)} - ${position.strategyId} signal in ${position.regime} regime.`;
  }

  private generateCurrentThinking(position: Position): string {
    const pnlPercent = position.unrealizedPnLPercent;
    const pnlAbs = Math.abs(position.unrealizedPnL);
    
    if (pnlPercent > 0.02) {
      return `Looking good, up ${pnlAbs.toFixed(2)} quid. Watching for continuation.`;
    } else if (pnlPercent > 0) {
      return `Slightly in profit. Monitoring for either target or invalidation.`;
    } else if (pnlPercent > -0.01) {
      return `Roughly flat. Thesis still intact, giving it room.`;
    } else if (pnlPercent > -0.02) {
      return `Underwater a bit. Stop is in place, letting it play out.`;
    } else {
      return `Down ${pnlAbs.toFixed(2)} quid. Getting close to stop level.`;
    }
  }

  private generateTargetScenario(position: Position): string {
    if (position.takeProfit) {
      const tpPercent = ((position.takeProfit - position.currentPrice) / position.currentPrice) * 100;
      return `Target at ${position.takeProfit.toFixed(2)} (${tpPercent > 0 ? '+' : ''}${tpPercent.toFixed(1)}% from here).`;
    }
    return 'No fixed target - managing based on price action.';
  }

  private generateStopScenario(position: Position): string {
    if (position.stopLoss) {
      const slPercent = ((position.stopLoss - position.currentPrice) / position.currentPrice) * 100;
      return `Stop at ${position.stopLoss.toFixed(2)} (${slPercent.toFixed(1)}% risk from here).`;
    }
    return 'Mental stop based on structure invalidation.';
  }

  private calculatePositionConfidence(position: Position): number {
    let confidence = 0.5; // Base confidence
    
    // Adjust based on PnL
    if (position.unrealizedPnLPercent > 0.02) confidence += 0.2;
    else if (position.unrealizedPnLPercent < -0.02) confidence -= 0.2;
    
    // Adjust based on regime alignment
    if (this.currentRegime?.regime === position.regime) confidence += 0.1;
    
    return Math.max(0.1, Math.min(0.9, confidence));
  }

  // ---------------------------------------------------------------------------
  // Mood Assessment
  // ---------------------------------------------------------------------------

  private assessMood(): TradingMood {
    const factors: string[] = [];
    let score = 0.5; // Neutral starting point

    // Today's PnL impact
    const todayPnL = this.pnlSummary?.today || 0;
    const todayPercent = this.pnlSummary?.todayPercent || 0;
    
    if (todayPercent > 0.02) {
      score += 0.3;
      factors.push('Strong day');
    } else if (todayPercent > 0.005) {
      score += 0.15;
      factors.push('Decent day');
    } else if (todayPercent < -0.02) {
      score -= 0.3;
      factors.push('Tough day');
    } else if (todayPercent < -0.005) {
      score -= 0.15;
      factors.push('Slightly down');
    }

    // Win rate impact
    const winRate = this.pnlSummary?.winRate || 0.5;
    if (winRate > 0.6) {
      score += 0.1;
      factors.push('Good win rate');
    } else if (winRate < 0.4) {
      score -= 0.1;
      factors.push('Win rate struggling');
    }

    // Position status
    const positions = Array.from(this.openPositions.values());
    const winningPositions = positions.filter(p => p.position.unrealizedPnL > 0).length;
    const losingPositions = positions.filter(p => p.position.unrealizedPnL < 0).length;
    
    if (winningPositions > losingPositions) {
      score += 0.1;
      factors.push('Positions looking good');
    } else if (losingPositions > winningPositions) {
      score -= 0.1;
      factors.push('Positions underwater');
    }

    // Regime clarity
    if (this.currentRegime && this.currentRegime.confidence > 0.8) {
      score += 0.05;
      factors.push('Clear regime');
    } else if (this.currentRegime && this.currentRegime.confidence < 0.5) {
      score -= 0.05;
      factors.push('Uncertain regime');
    }

    // Convert score to mood
    let overall: TradingMood['overall'];
    if (score > 0.8) overall = 'great';
    else if (score > 0.6) overall = 'good';
    else if (score > 0.4) overall = 'okay';
    else if (score > 0.2) overall = 'rough';
    else overall = 'bad';

    return { overall, confidence: score, factors };
  }

  // ---------------------------------------------------------------------------
  // Context Generation for Conversations
  // ---------------------------------------------------------------------------

  async getFullContext(): Promise<TradingContext> {
    const mood = this.assessMood();
    const positions = Array.from(this.openPositions.values());
    
    return {
      currentRegime: this.currentRegime,
      openPositions: positions,
      pendingOrders: 0, // TODO: track pending orders
      
      todayPnL: this.pnlSummary?.today || 0,
      todayPnLPercent: this.pnlSummary?.todayPercent || 0,
      todayTrades: this.recentTrades.filter(t => this.isToday(t.trade.timestamp)).length,
      todayWins: this.recentTrades.filter(t => this.isToday(t.trade.timestamp) && t.trade.pnl > 0).length,
      todayLosses: this.recentTrades.filter(t => this.isToday(t.trade.timestamp) && t.trade.pnl < 0).length,
      
      weekPnL: this.pnlSummary?.week || 0,
      monthPnL: this.pnlSummary?.month || 0,
      
      recentTrades: this.recentTrades.slice(0, 10),
      recentWins: this.recentTrades.filter(t => t.trade.pnl > 0).slice(0, 5),
      recentLosses: this.recentTrades.filter(t => t.trade.pnl < 0).slice(0, 5),
      
      watchlist: this.watchlist,
      activeResearch: this.activeResearch.filter(r => r.status !== 'completed' && r.status !== 'abandoned'),
      improvements: this.improvements.filter(i => i.status !== 'completed' && i.status !== 'abandoned'),
      
      mood,
      agentStatus: this.agentStatus,
      lastUpdate: this.lastFullRefresh,
    };
  }

  getConversationContext(): ConversationContext {
    const mood = this.assessMood();
    const todayPnL = this.pnlSummary?.today || 0;
    const todayPercent = this.pnlSummary?.todayPercent || 0;
    
    // Determine if trading should be mentioned
    const shouldMentionTrading = 
      Math.abs(todayPercent) > 0.01 || // Significant move
      this.openPositions.size > 0 || // Has positions
      mood.overall === 'great' || mood.overall === 'bad'; // Notable mood
    
    // Determine highlight
    let tradingHighlight: string | undefined;
    if (todayPnL > 100) {
      tradingHighlight = `Good day trading - up ${todayPnL.toFixed(0)} quid`;
    } else if (this.recentTrades.length > 0 && this.recentTrades[0].trade.pnl > 50) {
      tradingHighlight = `Just had a nice win on ${this.recentTrades[0].trade.symbol}`;
    }
    
    // Determine concern
    let tradingConcern: string | undefined;
    if (todayPnL < -100) {
      tradingConcern = `Down ${Math.abs(todayPnL).toFixed(0)} quid today`;
    } else if (mood.overall === 'bad') {
      tradingConcern = `Trading's been rough - ${mood.factors.join(', ')}`;
    }
    
    // What can be asked about
    const canAskAbout: string[] = ['positions', 'performance', 'regime'];
    if (this.activeResearch.length > 0) canAskAbout.push('research');
    if (this.watchlist.length > 0) canAskAbout.push('watchlist');
    if (this.improvements.length > 0) canAskAbout.push('improvements');
    
    return {
      shouldMentionTrading,
      tradingHighlight,
      tradingConcern,
      canAskAbout,
    };
  }

  // ---------------------------------------------------------------------------
  // Natural Language Summaries
  // ---------------------------------------------------------------------------

  generateStatusSummary(): string {
    const mood = this.assessMood();
    const todayPnL = this.pnlSummary?.today || 0;
    const todayTrades = this.recentTrades.filter(t => this.isToday(t.trade.timestamp)).length;
    const positions = Array.from(this.openPositions.values());
    
    let summary = '';
    
    // Overall assessment
    switch (mood.overall) {
      case 'great':
        summary = 'Great day so far! ';
        break;
      case 'good':
        summary = 'Decent day. ';
        break;
      case 'okay':
        summary = 'Pretty quiet day. ';
        break;
      case 'rough':
        summary = 'Bit of a rough day. ';
        break;
      case 'bad':
        summary = 'Tough day. ';
        break;
    }
    
    // PnL
    if (Math.abs(todayPnL) > 10) {
      summary += todayPnL > 0 
        ? `Up about ${todayPnL.toFixed(0)} quid. `
        : `Down about ${Math.abs(todayPnL).toFixed(0)} quid. `;
    }
    
    // Trades
    if (todayTrades > 0) {
      summary += `${todayTrades} trade${todayTrades > 1 ? 's' : ''} today. `;
    } else {
      summary += 'No trades yet today. ';
    }
    
    // Positions
    if (positions.length > 0) {
      const totalUnrealized = positions.reduce((sum, p) => sum + p.position.unrealizedPnL, 0);
      summary += `Got ${positions.length} position${positions.length > 1 ? 's' : ''} open`;
      if (Math.abs(totalUnrealized) > 10) {
        summary += totalUnrealized > 0 
          ? `, up ${totalUnrealized.toFixed(0)} quid unrealized.`
          : `, down ${Math.abs(totalUnrealized).toFixed(0)} quid unrealized.`;
      } else {
        summary += '.';
      }
    }
    
    // Regime
    if (this.currentRegime) {
      summary += ` Market's in ${this.currentRegime.regime} regime.`;
    }
    
    return summary;
  }

  generatePositionsSummary(): string {
    const positions = Array.from(this.openPositions.values());
    
    if (positions.length === 0) {
      return "No open positions right now. Just watching the markets.";
    }
    
    let summary = `Got ${positions.length} position${positions.length > 1 ? 's' : ''} open:\n\n`;
    
    for (const p of positions) {
      const pnlStr = p.position.unrealizedPnL >= 0 
        ? `+${p.position.unrealizedPnL.toFixed(2)}`
        : p.position.unrealizedPnL.toFixed(2);
      
      summary += `**${p.position.symbol}** (${p.position.side}): ${pnlStr} quid (${(p.position.unrealizedPnLPercent * 100).toFixed(1)}%)\n`;
      summary += `${p.currentThinking}\n\n`;
    }
    
    return summary;
  }

  generateRecentTradesSummary(count: number = 5): string {
    const trades = this.recentTrades.slice(0, count);
    
    if (trades.length === 0) {
      return "No recent trades to discuss.";
    }
    
    let summary = `Last ${trades.length} trade${trades.length > 1 ? 's' : ''}:\n\n`;
    
    for (const t of trades) {
      const time = this.formatRelativeTime(t.trade.timestamp);
      const pnlStr = t.trade.pnl >= 0 ? `+${t.trade.pnl.toFixed(2)}` : t.trade.pnl.toFixed(2);
      
      summary += `**${t.trade.symbol}** ${time}: ${pnlStr} quid\n`;
      summary += `${t.outcome}\n`;
      if (t.lesson) summary += `Lesson: ${t.lesson}\n`;
      summary += '\n';
    }
    
    return summary;
  }

  // ---------------------------------------------------------------------------
  // Watchlist & Research Management
  // ---------------------------------------------------------------------------

  addToWatchlist(item: Omit<WatchlistItem, 'addedAt'>): void {
    this.watchlist.push({
      ...item,
      addedAt: Date.now(),
    });
    this.emit('watchlist-updated');
  }

  removeFromWatchlist(symbol: string): void {
    this.watchlist = this.watchlist.filter(w => w.symbol !== symbol);
    this.emit('watchlist-updated');
  }

  addResearch(topic: string): void {
    this.activeResearch.push({
      topic,
      status: 'researching',
      startedAt: Date.now(),
      updatedAt: Date.now(),
    });
    this.emit('research-updated');
  }

  updateResearch(topic: string, status: ResearchItem['status'], findings?: string): void {
    const research = this.activeResearch.find(r => r.topic === topic);
    if (research) {
      research.status = status;
      research.updatedAt = Date.now();
      if (findings) research.findings = findings;
    }
    this.emit('research-updated');
  }

  addImprovement(description: string, type: ImprovementItem['type']): void {
    this.improvements.push({
      description,
      type,
      status: 'planned',
      startedAt: Date.now(),
    });
    this.emit('improvements-updated');
  }

  updateImprovement(description: string, status: ImprovementItem['status'], impact?: string): void {
    const improvement = this.improvements.find(i => i.description === description);
    if (improvement) {
      improvement.status = status;
      if (impact) improvement.impact = impact;
      if (status === 'completed') improvement.completedAt = Date.now();
    }
    this.emit('improvements-updated');
  }

  // ---------------------------------------------------------------------------
  // Utility Methods
  // ---------------------------------------------------------------------------

  private getDateString(): string {
    return new Date().toISOString().split('T')[0];
  }

  private isToday(timestamp: number): boolean {
    const date = new Date(timestamp).toISOString().split('T')[0];
    return date === this.todayDate;
  }

  private formatRelativeTime(timestamp: number): string {
    const now = Date.now();
    const diff = now - timestamp;
    
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
  }

  private async handleDayChange(newDate: string): Promise<void> {
    // Save yesterday's summary
    const yesterdaySummary = await this.generateDailySummary();
    this.dailySummaries.set(this.todayDate, yesterdaySummary);
    
    // Reset for new day
    this.todayDate = newDate;
    this.ws.resetDailyState();
    
    logger.info('Day changed, trading state reset', { newDate });
    this.emit('day-changed', { summary: yesterdaySummary });
  }

  private async generateDailySummary(): Promise<DailySummary> {
    const todayTrades = this.recentTrades.filter(t => this.isToday(t.trade.timestamp));
    const wins = todayTrades.filter(t => t.trade.pnl > 0);
    const losses = todayTrades.filter(t => t.trade.pnl < 0);
    
    const bestTrade = wins.length > 0 
      ? wins.reduce((best, t) => t.trade.pnl > best.trade.pnl ? t : best)
      : undefined;
    const worstTrade = losses.length > 0
      ? losses.reduce((worst, t) => t.trade.pnl < worst.trade.pnl ? t : worst)
      : undefined;
    
    const mood = this.assessMood();
    const narrative = this.generateStatusSummary();
    
    return {
      date: this.todayDate,
      pnl: this.pnlSummary?.today || 0,
      pnlPercent: this.pnlSummary?.todayPercent || 0,
      trades: todayTrades.length,
      wins: wins.length,
      losses: losses.length,
      bestTrade,
      worstTrade,
      regimes: [this.currentRegime?.regime || 'Unknown'],
      narrative,
      mood,
    };
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let stateManagerInstance: TradingStateManager | null = null;

export function getTradingStateManager(): TradingStateManager {
  if (!stateManagerInstance) {
    stateManagerInstance = new TradingStateManager();
    logger.info('Trading state manager created');
  }
  return stateManagerInstance;
}

export function resetTradingStateManager(): void {
  if (stateManagerInstance) {
    stateManagerInstance.shutdown();
    stateManagerInstance = null;
  }
}
