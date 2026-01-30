/**
 * Finance Intelligence Tools
 *
 * LLM-callable tools for Atlas to manage financial research,
 * watchlists, alerts, and market intelligence.
 *
 * @module trading/finance-tools
 */

import {
  getFinanceIntelligence,
  MarketResearchEntry,
  WatchlistEntry,
  PriceAlert,
  TechnicalSetup,
  Catalyst,
} from './finance-intelligence';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('FinanceTools');

// =============================================================================
// Tool Definitions
// =============================================================================

export interface AgentTool {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  execute: (params: Record<string, unknown>) => Promise<unknown>;
}

// =============================================================================
// Research Tools
// =============================================================================

export const finance_add_research: AgentTool = {
  name: 'finance_add_research',
  description: 'Store market research analysis (macro, sector, or company level). Use this to save important market analysis for future reference.',
  parameters: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['macro', 'sector', 'company', 'crypto', 'forex'],
        description: 'Type of research',
      },
      title: { type: 'string', description: 'Title of the research' },
      summary: { type: 'string', description: 'Summary of key findings' },
      keyFindings: {
        type: 'array',
        items: { type: 'string' },
        description: 'List of key findings',
      },
      riskFactors: {
        type: 'array',
        items: { type: 'string' },
        description: 'List of risk factors',
      },
      opportunities: {
        type: 'array',
        items: { type: 'string' },
        description: 'List of opportunities',
      },
      ticker: { type: 'string', description: 'Ticker symbol (for company/asset research)' },
      fairValue: { type: 'number', description: 'Estimated fair value' },
      currentPrice: { type: 'number', description: 'Current price' },
      sources: {
        type: 'array',
        items: { type: 'string' },
        description: 'Sources of the research',
      },
      confidence: { type: 'number', description: 'Confidence level 0-1' },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Tags for categorization',
      },
    },
    required: ['type', 'title', 'summary', 'keyFindings', 'sources', 'tags'],
  },
  execute: async (params) => {
    const fi = getFinanceIntelligence();
    
    const entry = fi.addResearch({
      type: params.type as MarketResearchEntry['type'],
      title: params.title as string,
      summary: params.summary as string,
      keyFindings: params.keyFindings as string[],
      riskFactors: (params.riskFactors as string[]) || [],
      opportunities: (params.opportunities as string[]) || [],
      ticker: params.ticker as string | undefined,
      fairValue: params.fairValue as number | undefined,
      currentPrice: params.currentPrice as number | undefined,
      upside: params.fairValue && params.currentPrice
        ? ((params.fairValue as number) - (params.currentPrice as number)) / (params.currentPrice as number) * 100
        : undefined,
      sources: params.sources as string[],
      confidence: (params.confidence as number) || 0.7,
      tags: params.tags as string[],
    });
    
    logger.info('Research added via tool', { id: entry.id, title: entry.title });
    
    return {
      success: true,
      id: entry.id,
      message: `Research "${entry.title}" stored successfully`,
    };
  },
};

export const finance_search_research: AgentTool = {
  name: 'finance_search_research',
  description: 'Search stored market research by type, ticker, or tags',
  parameters: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['macro', 'sector', 'company', 'crypto', 'forex'],
        description: 'Filter by research type',
      },
      ticker: { type: 'string', description: 'Filter by ticker symbol' },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Filter by tags',
      },
      limit: { type: 'number', description: 'Maximum results (default 10)' },
    },
  },
  execute: async (params) => {
    const fi = getFinanceIntelligence();
    
    const results = fi.searchResearch({
      type: params.type as MarketResearchEntry['type'] | undefined,
      ticker: params.ticker as string | undefined,
      tags: params.tags as string[] | undefined,
      limit: (params.limit as number) || 10,
    });
    
    return {
      success: true,
      count: results.length,
      research: results.map(r => ({
        id: r.id,
        type: r.type,
        title: r.title,
        ticker: r.ticker,
        summary: r.summary.slice(0, 200) + (r.summary.length > 200 ? '...' : ''),
        keyFindings: r.keyFindings.slice(0, 3),
        timestamp: new Date(r.timestamp).toISOString(),
      })),
    };
  },
};

export const finance_get_research: AgentTool = {
  name: 'finance_get_research',
  description: 'Get full details of a specific research entry',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Research entry ID' },
      ticker: { type: 'string', description: 'Or get latest for a ticker' },
    },
  },
  execute: async (params) => {
    const fi = getFinanceIntelligence();
    
    let research: MarketResearchEntry | undefined;
    
    if (params.id) {
      research = fi.getResearch(params.id as string);
    } else if (params.ticker) {
      research = fi.getLatestResearchForTicker(params.ticker as string);
    }
    
    if (!research) {
      return { success: false, error: 'Research not found' };
    }
    
    return { success: true, research };
  },
};

// =============================================================================
// Watchlist Tools
// =============================================================================

export const finance_add_to_watchlist: AgentTool = {
  name: 'finance_add_to_watchlist',
  description: 'Add a stock/asset to the watchlist with a trading thesis and price levels. Automatically creates alerts.',
  parameters: {
    type: 'object',
    properties: {
      ticker: { type: 'string', description: 'Ticker symbol (e.g., NVDA, BTC)' },
      name: { type: 'string', description: 'Full name of the asset' },
      exchange: { type: 'string', description: 'Exchange (e.g., NASDAQ, NYSE, Binance)' },
      thesis: { type: 'string', description: 'Trading thesis - why this trade?' },
      direction: {
        type: 'string',
        enum: ['long', 'short'],
        description: 'Trade direction',
      },
      timeframe: {
        type: 'string',
        enum: ['day', 'swing', 'position', 'investment'],
        description: 'Trading timeframe',
      },
      conviction: {
        type: 'string',
        enum: ['high', 'medium', 'low'],
        description: 'Conviction level',
      },
      entryLow: { type: 'number', description: 'Lower bound of entry zone' },
      entryHigh: { type: 'number', description: 'Upper bound of entry zone' },
      stopLoss: { type: 'number', description: 'Stop loss price' },
      targets: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            price: { type: 'number' },
            allocation: { type: 'number', description: 'Percentage to sell at this target' },
          },
        },
        description: 'Price targets with allocation percentages',
      },
      notes: {
        type: 'array',
        items: { type: 'string' },
        description: 'Additional notes',
      },
    },
    required: ['ticker', 'name', 'thesis', 'direction', 'timeframe', 'conviction', 'entryLow', 'entryHigh', 'stopLoss', 'targets'],
  },
  execute: async (params) => {
    const fi = getFinanceIntelligence();
    
    const entry = fi.addToWatchlist({
      ticker: params.ticker as string,
      name: params.name as string,
      exchange: params.exchange as string | undefined,
      thesis: params.thesis as string,
      direction: params.direction as 'long' | 'short',
      timeframe: params.timeframe as 'day' | 'swing' | 'position' | 'investment',
      conviction: params.conviction as 'high' | 'medium' | 'low',
      entryZone: {
        low: params.entryLow as number,
        high: params.entryHigh as number,
      },
      stopLoss: params.stopLoss as number,
      targets: params.targets as Array<{ price: number; allocation: number }>,
      status: 'watching',
      notes: (params.notes as string[]) || [],
    });
    
    logger.info('Added to watchlist via tool', { id: entry.id, ticker: entry.ticker });
    
    return {
      success: true,
      id: entry.id,
      message: `${entry.ticker} added to watchlist with ${entry.alertIds.length} alerts`,
      alertIds: entry.alertIds,
    };
  },
};

export const finance_get_watchlist: AgentTool = {
  name: 'finance_get_watchlist',
  description: 'Get the current watchlist with all trading setups',
  parameters: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        enum: ['watching', 'triggered', 'entered', 'exited', 'invalidated'],
        description: 'Filter by status',
      },
    },
  },
  execute: async (params) => {
    const fi = getFinanceIntelligence();
    let watchlist = fi.getWatchlist();
    
    if (params.status) {
      watchlist = watchlist.filter(w => w.status === params.status);
    }
    
    return {
      success: true,
      count: watchlist.length,
      watchlist: watchlist.map(w => ({
        id: w.id,
        ticker: w.ticker,
        name: w.name,
        direction: w.direction,
        timeframe: w.timeframe,
        conviction: w.conviction,
        thesis: w.thesis,
        entryZone: w.entryZone,
        stopLoss: w.stopLoss,
        targets: w.targets,
        status: w.status,
        currentPrice: w.currentPrice,
        alertIds: w.alertIds,
      })),
    };
  },
};

export const finance_update_watchlist: AgentTool = {
  name: 'finance_update_watchlist',
  description: 'Update a watchlist entry (e.g., change status, add notes)',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Watchlist entry ID' },
      ticker: { type: 'string', description: 'Or find by ticker' },
      status: {
        type: 'string',
        enum: ['watching', 'triggered', 'entered', 'exited', 'invalidated'],
      },
      currentPrice: { type: 'number' },
      note: { type: 'string', description: 'Add a note' },
    },
    required: ['id'],
  },
  execute: async (params) => {
    const fi = getFinanceIntelligence();
    
    let id = params.id as string;
    if (!id && params.ticker) {
      const entry = fi.getWatchlistByTicker(params.ticker as string);
      if (entry) id = entry.id;
    }
    
    if (!id) {
      return { success: false, error: 'Watchlist entry not found' };
    }
    
    const updates: Partial<WatchlistEntry> = {};
    if (params.status) updates.status = params.status as WatchlistEntry['status'];
    if (params.currentPrice) updates.currentPrice = params.currentPrice as number;
    
    const entry = fi.getWatchlist().find(w => w.id === id);
    if (params.note && entry) {
      updates.notes = [...entry.notes, params.note as string];
    }
    
    const updated = fi.updateWatchlistEntry(id, updates);
    
    return {
      success: !!updated,
      entry: updated,
    };
  },
};

export const finance_remove_from_watchlist: AgentTool = {
  name: 'finance_remove_from_watchlist',
  description: 'Remove an asset from the watchlist',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Watchlist entry ID' },
      ticker: { type: 'string', description: 'Or remove by ticker' },
    },
  },
  execute: async (params) => {
    const fi = getFinanceIntelligence();
    
    let id = params.id as string;
    if (!id && params.ticker) {
      const entry = fi.getWatchlistByTicker(params.ticker as string);
      if (entry) id = entry.id;
    }
    
    if (!id) {
      return { success: false, error: 'Entry not found' };
    }
    
    const removed = fi.removeFromWatchlist(id);
    return {
      success: removed,
      message: removed ? 'Removed from watchlist' : 'Entry not found',
    };
  },
};

// =============================================================================
// Alert Tools
// =============================================================================

export const finance_create_alert: AgentTool = {
  name: 'finance_create_alert',
  description: 'Create a price alert for a ticker',
  parameters: {
    type: 'object',
    properties: {
      ticker: { type: 'string', description: 'Ticker symbol' },
      type: {
        type: 'string',
        enum: ['price_above', 'price_below', 'volume_spike', 'breakout', 'breakdown'],
        description: 'Alert type',
      },
      targetPrice: { type: 'number', description: 'Target price to trigger alert' },
      reason: { type: 'string', description: 'Why is this alert important?' },
      action: { type: 'string', description: 'What action to take when triggered' },
      repeat: { type: 'boolean', description: 'Should alert repeat after triggering?' },
    },
    required: ['ticker', 'type', 'targetPrice', 'reason', 'action'],
  },
  execute: async (params) => {
    const fi = getFinanceIntelligence();
    
    const alert = fi.createAlert({
      ticker: params.ticker as string,
      type: params.type as PriceAlert['type'],
      targetPrice: params.targetPrice as number,
      reason: params.reason as string,
      action: params.action as string,
      repeat: (params.repeat as boolean) || false,
    });
    
    return {
      success: true,
      id: alert.id,
      message: `Alert created: ${alert.ticker} ${alert.type} $${alert.targetPrice}`,
    };
  },
};

export const finance_get_alerts: AgentTool = {
  name: 'finance_get_alerts',
  description: 'Get all active price alerts',
  parameters: {
    type: 'object',
    properties: {
      ticker: { type: 'string', description: 'Filter by ticker' },
    },
  },
  execute: async (params) => {
    const fi = getFinanceIntelligence();
    
    let alerts = fi.getActiveAlerts();
    if (params.ticker) {
      alerts = fi.getAlertsForTicker(params.ticker as string);
    }
    
    return {
      success: true,
      count: alerts.length,
      alerts: alerts.map(a => ({
        id: a.id,
        ticker: a.ticker,
        type: a.type,
        targetPrice: a.targetPrice,
        reason: a.reason,
        action: a.action,
        createdAt: new Date(a.createdAt).toISOString(),
      })),
    };
  },
};

export const finance_delete_alert: AgentTool = {
  name: 'finance_delete_alert',
  description: 'Delete a price alert',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Alert ID to delete' },
    },
    required: ['id'],
  },
  execute: async (params) => {
    const fi = getFinanceIntelligence();
    const deleted = fi.deleteAlert(params.id as string);
    
    return {
      success: deleted,
      message: deleted ? 'Alert deleted' : 'Alert not found',
    };
  },
};

// =============================================================================
// Summary Tools
// =============================================================================

export const finance_get_summary: AgentTool = {
  name: 'finance_get_summary',
  description: 'Get a summary of the finance intelligence status (watchlist, alerts, research)',
  parameters: {
    type: 'object',
    properties: {},
  },
  execute: async () => {
    const fi = getFinanceIntelligence();
    const summary = fi.getSummary();
    
    return {
      success: true,
      summary: {
        watchlistCount: summary.watchlistCount,
        activeAlerts: summary.activeAlerts,
        researchEntries: summary.recentResearch,
        topWatchItems: summary.topWatchItems,
        upcomingCatalysts: summary.upcomingCatalysts.map(c => ({
          date: c.date,
          event: c.event,
          impact: c.expectedImpact,
        })),
      },
    };
  },
};

export const finance_get_context: AgentTool = {
  name: 'finance_get_context',
  description: 'Get finance context for conversation (watchlist status, alerts, catalysts)',
  parameters: {
    type: 'object',
    properties: {},
  },
  execute: async () => {
    const fi = getFinanceIntelligence();
    return {
      success: true,
      context: fi.getContextForLLM(),
    };
  },
};

// =============================================================================
// Export All Tools
// =============================================================================

export function getFinanceIntelligenceTools(): AgentTool[] {
  return [
    finance_add_research,
    finance_search_research,
    finance_get_research,
    finance_add_to_watchlist,
    finance_get_watchlist,
    finance_update_watchlist,
    finance_remove_from_watchlist,
    finance_create_alert,
    finance_get_alerts,
    finance_delete_alert,
    finance_get_summary,
    finance_get_context,
  ];
}
