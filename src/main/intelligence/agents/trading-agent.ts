/**
 * Trading Intelligence Agent
 * Analyzes trades, portfolio, and provides trading insights
 */

import { createModuleLogger } from '../../utils/logger';
import { EntityType, AgentContext, AgentResponse, AgentInsight, AgentAction, TradeEntity } from '../types';
import { BaseIntelligenceAgent } from './base-agent';
import {
  AgentCapability,
  AgentQuery,
  AgentQueryResult,
  AgentAlert,
  AgentRecommendation,
  TradingInsight,
  PortfolioSummary,
} from './types';

const logger = createModuleLogger('TradingAgent');

// ============================================================================
// TRADING AGENT
// ============================================================================

export class TradingAgent extends BaseIntelligenceAgent {
  id = 'trading';
  name = 'Trading Intelligence';
  description = 'Analyzes trades, portfolio performance, and provides trading insights';
  capabilities: AgentCapability[] = [
    'entity_query',
    'temporal_query',
    'pattern_detection',
    'prediction',
    'recommendation',
    'alert_generation',
  ];
  focusEntities: EntityType[] = ['trade'];

  // --------------------------------------------------------------------------
  // QUERY HANDLING
  // --------------------------------------------------------------------------

  protected async handleQuery(query: AgentQuery): Promise<AgentQueryResult> {
    const lowerQuery = query.query.toLowerCase();

    // Determine query type
    if (lowerQuery.includes('portfolio') || lowerQuery.includes('holdings')) {
      return this.handlePortfolioQuery(query);
    }

    if (lowerQuery.includes('pnl') || lowerQuery.includes('profit') || lowerQuery.includes('loss')) {
      return this.handlePnLQuery(query);
    }

    if (lowerQuery.includes('trade') || lowerQuery.includes('position')) {
      return this.handleTradeQuery(query);
    }

    if (lowerQuery.includes('risk') || lowerQuery.includes('exposure')) {
      return this.handleRiskQuery(query);
    }

    // Default: general trading query
    return this.handleGeneralQuery(query);
  }

  private async handlePortfolioQuery(query: AgentQuery): Promise<AgentQueryResult> {
    const summary = await this.getPortfolioSummary();

    return {
      answer: this.formatPortfolioAnswer(summary),
      confidence: 0.9,
      evidence: summary.positions.map(p => ({
        entityId: p.symbol,
        entityType: 'trade' as EntityType,
        relevance: 1,
        snippet: `${p.symbol}: ${p.value.toFixed(2)} (${p.pnlPercent >= 0 ? '+' : ''}${p.pnlPercent.toFixed(2)}%)`,
      })),
      insights: [],
      followUpQueries: [
        'What are my best performing trades?',
        'What is my risk exposure?',
        'Show me my trading history',
      ],
      suggestedActions: [],
    };
  }

  private async handlePnLQuery(query: AgentQuery): Promise<AgentQueryResult> {
    const trades = this.getRecentTrades(30);
    const totalPnL = trades.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
    const winners = trades.filter(t => (t.pnl ?? 0) > 0);
    const losers = trades.filter(t => (t.pnl ?? 0) < 0);

    return {
      answer: `Your total P&L over the last 30 days is ${totalPnL >= 0 ? '+' : ''}£${totalPnL.toFixed(2)}. ` +
        `You had ${winners.length} winning trades and ${losers.length} losing trades. ` +
        `Win rate: ${((winners.length / trades.length) * 100).toFixed(1)}%`,
      confidence: 0.95,
      evidence: trades.slice(0, 5).map(t => ({
        entityId: t.id,
        entityType: 'trade' as EntityType,
        relevance: 1,
        snippet: `${t.name}: ${(t.pnl ?? 0) >= 0 ? '+' : ''}£${(t.pnl ?? 0).toFixed(2)}`,
      })),
      insights: this.generatePnLInsights(trades),
      followUpQueries: [
        'What was my best trade?',
        'What was my worst trade?',
        'Show me my monthly performance',
      ],
      suggestedActions: [],
    };
  }

  private async handleTradeQuery(query: AgentQuery): Promise<AgentQueryResult> {
    const trades = this.getRecentTrades(10);

    return {
      answer: `You have ${trades.length} recent trades. ` +
        trades.slice(0, 3).map(t =>
          `${t.properties?.symbol ?? t.name}: ${t.properties?.direction ?? 'unknown'} ` +
          `${t.properties?.size ?? 0} at ${t.properties?.entryPrice ?? 0}`
        ).join('; '),
      confidence: 0.9,
      evidence: trades.map(t => ({
        entityId: t.id,
        entityType: 'trade' as EntityType,
        relevance: 1,
        snippet: `${t.name}: ${t.properties?.direction ?? ''} ${t.properties?.size ?? 0}`,
      })),
      insights: [],
      followUpQueries: ['Show more details about my positions', 'What is my exposure?'],
      suggestedActions: [],
    };
  }

  private async handleRiskQuery(query: AgentQuery): Promise<AgentQueryResult> {
    const trades = this.getOpenTrades();
    const totalExposure = trades.reduce((sum, t) => {
      const size = (t.properties?.size as number) ?? 0;
      const price = (t.properties?.currentPrice as number) ?? (t.properties?.entryPrice as number) ?? 0;
      return sum + size * price;
    }, 0);

    return {
      answer: `Your current risk exposure is £${totalExposure.toFixed(2)} across ${trades.length} open positions.`,
      confidence: 0.85,
      evidence: trades.map(t => ({
        entityId: t.id,
        entityType: 'trade' as EntityType,
        relevance: 1,
        snippet: `${t.properties?.symbol ?? t.name}: £${((t.properties?.size as number ?? 0) * (t.properties?.currentPrice as number ?? 0)).toFixed(2)}`,
      })),
      insights: [],
      followUpQueries: ['What is my max drawdown?', 'How diversified is my portfolio?'],
      suggestedActions: [],
    };
  }

  private async handleGeneralQuery(query: AgentQuery): Promise<AgentQueryResult> {
    return {
      answer: 'I can help with trading analysis. Try asking about your portfolio, P&L, trades, or risk exposure.',
      confidence: 0.5,
      evidence: [],
      insights: [],
      followUpQueries: [
        'What is my portfolio value?',
        'How am I doing this month?',
        'What are my open positions?',
      ],
      suggestedActions: [],
    };
  }

  // --------------------------------------------------------------------------
  // INSIGHTS
  // --------------------------------------------------------------------------

  protected async computeInsights(context: AgentContext): Promise<AgentInsight[]> {
    const insights: AgentInsight[] = [];
    const trades = this.getRecentTrades(30);

    if (trades.length === 0) return insights;

    // Win rate insight
    const winners = trades.filter(t => (t.pnl ?? 0) > 0);
    const winRate = winners.length / trades.length;

    if (winRate > 0.6) {
      insights.push({
        id: this.generateId(),
        type: 'pattern',
        title: 'Strong Win Rate',
        description: `Your win rate of ${(winRate * 100).toFixed(1)}% over the last 30 days is excellent.`,
        confidence: 0.9,
        relatedEntityIds: trades.slice(0, 5).map(t => t.id),
        actionable: false,
      });
    } else if (winRate < 0.4) {
      insights.push({
        id: this.generateId(),
        type: 'warning',
        title: 'Low Win Rate',
        description: `Your win rate of ${(winRate * 100).toFixed(1)}% is below optimal. Consider reviewing your strategy.`,
        confidence: 0.85,
        relatedEntityIds: trades.filter(t => (t.pnl ?? 0) < 0).slice(0, 5).map(t => t.id),
        actionable: true,
        suggestedAction: {
          type: 'review',
          description: 'Review losing trades for patterns',
          parameters: {},
        },
      });
    }

    // Streak detection
    const streak = this.detectStreak(trades);
    if (Math.abs(streak) >= 3) {
      insights.push({
        id: this.generateId(),
        type: streak > 0 ? 'achievement' : 'warning',
        title: streak > 0 ? 'Winning Streak!' : 'Losing Streak',
        description: streak > 0
          ? `You're on a ${streak} trade winning streak!`
          : `You've had ${Math.abs(streak)} consecutive losing trades.`,
        confidence: 1,
        relatedEntityIds: trades.slice(0, Math.abs(streak)).map(t => t.id),
        actionable: streak < 0,
      });
    }

    return insights;
  }

  private generatePnLInsights(trades: TradeEntity[]): AgentInsight[] {
    const insights: AgentInsight[] = [];

    // Best/worst trade
    const sorted = [...trades].sort((a, b) => (b.pnl ?? 0) - (a.pnl ?? 0));
    if (sorted.length > 0) {
      const best = sorted[0];
      const worst = sorted[sorted.length - 1];

      if ((best.pnl ?? 0) > 0) {
        insights.push({
          id: this.generateId(),
          type: 'achievement',
          title: 'Best Trade',
          description: `Your best trade was ${best.properties?.symbol ?? best.name} with +£${(best.pnl ?? 0).toFixed(2)}`,
          confidence: 1,
          relatedEntityIds: [best.id],
          actionable: false,
        });
      }
    }

    return insights;
  }

  // --------------------------------------------------------------------------
  // ALERTS
  // --------------------------------------------------------------------------

  protected async computeAlerts(context: AgentContext): Promise<AgentAlert[]> {
    const alerts: AgentAlert[] = [];
    const openTrades = this.getOpenTrades();

    for (const trade of openTrades) {
      const pnlPercent = (trade.properties?.pnlPercent as number) ?? 0;

      // Stop loss warning
      if (pnlPercent < -5) {
        alerts.push({
          id: this.generateId(),
          agentId: this.id,
          type: 'warning',
          title: 'Significant Loss',
          description: `${trade.properties?.symbol ?? trade.name} is down ${pnlPercent.toFixed(2)}%`,
          relatedEntities: [trade.id],
          priority: Math.abs(pnlPercent) > 10 ? 9 : 7,
          actionable: true,
          suggestedActions: [{
            type: 'close_position',
            description: 'Consider closing this position',
            parameters: { tradeId: trade.id },
          }],
          createdAt: new Date(),
          dismissed: false,
        });
      }

      // Take profit opportunity
      if (pnlPercent > 10) {
        alerts.push({
          id: this.generateId(),
          agentId: this.id,
          type: 'opportunity',
          title: 'Take Profit Opportunity',
          description: `${trade.properties?.symbol ?? trade.name} is up ${pnlPercent.toFixed(2)}%`,
          relatedEntities: [trade.id],
          priority: 5,
          actionable: true,
          suggestedActions: [{
            type: 'take_profit',
            description: 'Consider taking some profit',
            parameters: { tradeId: trade.id },
          }],
          createdAt: new Date(),
          dismissed: false,
        });
      }
    }

    return alerts;
  }

  // --------------------------------------------------------------------------
  // RECOMMENDATIONS
  // --------------------------------------------------------------------------

  protected async computeRecommendations(context: AgentContext): Promise<AgentRecommendation[]> {
    const recommendations: AgentRecommendation[] = [];
    const trades = this.getRecentTrades(30);

    if (trades.length < 5) {
      return recommendations;
    }

    // Risk management recommendation
    const avgLoss = trades
      .filter(t => (t.pnl ?? 0) < 0)
      .reduce((sum, t) => sum + Math.abs(t.pnl ?? 0), 0) / trades.length;

    const avgWin = trades
      .filter(t => (t.pnl ?? 0) > 0)
      .reduce((sum, t) => sum + (t.pnl ?? 0), 0) / trades.length;

    if (avgLoss > avgWin) {
      recommendations.push({
        id: this.generateId(),
        agentId: this.id,
        type: 'risk_management',
        title: 'Improve Risk/Reward Ratio',
        description: 'Your average loss exceeds your average win',
        rationale: `Average win: £${avgWin.toFixed(2)}, Average loss: £${avgLoss.toFixed(2)}. Consider tighter stop losses or wider take profits.`,
        confidence: 0.8,
        impact: 'high',
        effort: 'low',
        relatedEntities: [],
        actions: [{
          type: 'review',
          description: 'Review and adjust stop loss levels',
          parameters: {},
        }],
        createdAt: new Date(),
      });
    }

    return recommendations;
  }

  // --------------------------------------------------------------------------
  // ACTIONS
  // --------------------------------------------------------------------------

  protected async handleAction(action: AgentAction): Promise<AgentResponse> {
    switch (action.type) {
      case 'close_position':
        return {
          success: true,
          message: 'Position close request noted. Please confirm in your trading platform.',
        };

      case 'take_profit':
        return {
          success: true,
          message: 'Take profit suggestion noted. Please execute in your trading platform.',
        };

      default:
        return {
          success: false,
          message: `Unknown action type: ${action.type}`,
        };
    }
  }

  // --------------------------------------------------------------------------
  // UTILITY METHODS
  // --------------------------------------------------------------------------

  private getRecentTrades(days: number): TradeEntity[] {
    const store = this.getStore();
    const trades = store.getEntitiesByType('trade', 100) as TradeEntity[];
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

    return trades.filter(t => new Date(t.updatedAt).getTime() > cutoff);
  }

  private getOpenTrades(): TradeEntity[] {
    const store = this.getStore();
    const trades = store.getEntitiesByType('trade', 100) as TradeEntity[];

    return trades.filter(t => t.properties?.status === 'open');
  }

  private detectStreak(trades: TradeEntity[]): number {
    if (trades.length === 0) return 0;

    const sorted = [...trades].sort((a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );

    let streak = 0;
    const firstPnL = sorted[0].pnl ?? 0;
    const direction = firstPnL >= 0 ? 1 : -1;

    for (const trade of sorted) {
      const pnl = trade.pnl ?? 0;
      if ((pnl >= 0 && direction > 0) || (pnl < 0 && direction < 0)) {
        streak++;
      } else {
        break;
      }
    }

    return streak * direction;
  }

  async getPortfolioSummary(): Promise<PortfolioSummary> {
    const trades = this.getOpenTrades();

    let totalValue = 0;
    let dailyPnL = 0;

    const positions = trades.map(t => {
      const size = (t.properties?.size as number) ?? 0;
      const currentPrice = (t.properties?.currentPrice as number) ?? (t.properties?.entryPrice as number) ?? 0;
      const value = size * currentPrice;
      const pnl = t.pnl ?? 0;

      totalValue += value;
      dailyPnL += pnl;

      return {
        symbol: (t.properties?.symbol as string) ?? t.name,
        size,
        value,
        pnl,
        pnlPercent: (t.properties?.pnlPercent as number) ?? 0,
      };
    });

    return {
      totalValue,
      currency: 'GBP',
      dailyPnL,
      dailyPnLPercent: totalValue > 0 ? (dailyPnL / totalValue) * 100 : 0,
      positions,
      riskMetrics: {
        portfolioHeat: 0, // Would need more data
        maxDrawdown: 0,
        sharpeRatio: 0,
      },
    };
  }

  private formatPortfolioAnswer(summary: PortfolioSummary): string {
    return `Your portfolio is worth £${summary.totalValue.toFixed(2)}. ` +
      `Today's P&L: ${summary.dailyPnL >= 0 ? '+' : ''}£${summary.dailyPnL.toFixed(2)} (${summary.dailyPnLPercent >= 0 ? '+' : ''}${summary.dailyPnLPercent.toFixed(2)}%). ` +
      `You have ${summary.positions.length} open positions.`;
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let instance: TradingAgent | null = null;

export function getTradingAgent(): TradingAgent {
  if (!instance) {
    instance = new TradingAgent();
  }
  return instance;
}
