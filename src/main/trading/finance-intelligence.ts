/**
 * Finance Intelligence Module
 *
 * Atlas's comprehensive financial research and market intelligence system.
 * Stores market analysis, manages watchlists, tracks thesis, and aggregates news.
 *
 * Features:
 * - Stored market research (macro, sector, company analysis)
 * - Price alert management with entry/exit triggers
 * - Trading thesis tracking with validation
 * - News aggregation via Perplexity/browser agent
 * - Portfolio construction recommendations
 *
 * @module trading/finance-intelligence
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { createModuleLogger } from '../utils/logger';
import { getStore } from '../store';

const logger = createModuleLogger('FinanceIntelligence');

// =============================================================================
// Constants
// =============================================================================

export const FINANCE_CONSTANTS = {
  /** Maximum stored research entries */
  MAX_RESEARCH_ENTRIES: 500,
  /** Maximum watchlist items */
  MAX_WATCHLIST_ITEMS: 100,
  /** Maximum stored news items */
  MAX_NEWS_ITEMS: 1000,
  /** Cache duration for news (1 hour) */
  NEWS_CACHE_MS: 60 * 60 * 1000,
  /** Default alert check interval */
  ALERT_CHECK_INTERVAL_MS: 5000,
  /** Store key for persistence */
  STORE_KEY: 'finance-intelligence',
} as const;

// =============================================================================
// Types
// =============================================================================

/**
 * Market research entry (macro, sector, or company level)
 */
export interface MarketResearchEntry {
  id: string;
  type: 'macro' | 'sector' | 'company' | 'crypto' | 'forex';
  title: string;
  summary: string;
  timestamp: number;
  
  // Key findings
  keyFindings: string[];
  riskFactors: string[];
  opportunities: string[];
  
  // For company/asset specific
  ticker?: string;
  fairValue?: number;
  currentPrice?: number;
  upside?: number;
  
  // Technical analysis
  technicalSetup?: TechnicalSetup;
  
  // Catalyst tracking
  catalysts?: Catalyst[];
  
  // Source attribution
  sources: string[];
  confidence: number; // 0-1
  
  // Tags for retrieval
  tags: string[];
}

/**
 * Technical analysis setup
 */
export interface TechnicalSetup {
  trend: 'bullish' | 'bearish' | 'neutral';
  pattern?: string;
  
  // Key levels
  support: number[];
  resistance: number[];
  
  // Entry/Exit
  entryTrigger: string;
  entryPrice?: number;
  stopLoss: number;
  targets: number[];
  
  // Risk/Reward
  riskRewardRatio: number;
  probabilityBullish: number; // 0-100
  
  // Indicators
  rsi?: number;
  macdSignal?: 'bullish' | 'bearish' | 'neutral';
  volumeProfile?: 'accumulation' | 'distribution' | 'neutral';
}

/**
 * Catalyst event to monitor
 */
export interface Catalyst {
  date: string; // ISO date or "TBD"
  event: string;
  expectedImpact: 'high' | 'medium' | 'low';
  direction?: 'bullish' | 'bearish' | 'uncertain';
  notes?: string;
}

/**
 * Watchlist item with trading thesis
 */
export interface WatchlistEntry {
  id: string;
  ticker: string;
  name: string;
  exchange?: string;
  addedAt: number;
  updatedAt: number;
  
  // Thesis
  thesis: string;
  timeframe: 'day' | 'swing' | 'position' | 'investment';
  direction: 'long' | 'short';
  conviction: 'high' | 'medium' | 'low';
  
  // Price levels
  currentPrice?: number;
  entryZone: { low: number; high: number };
  stopLoss: number;
  targets: Array<{ price: number; allocation: number }>;
  
  // Status
  status: 'watching' | 'triggered' | 'entered' | 'exited' | 'invalidated';
  notes: string[];
  
  // Alerts
  alertIds: string[];
}

/**
 * Price alert with rich context
 */
export interface PriceAlert {
  id: string;
  ticker: string;
  type: 'price_above' | 'price_below' | 'volume_spike' | 'breakout' | 'breakdown';
  
  // Trigger conditions
  targetPrice: number;
  currentPrice?: number;
  triggered: boolean;
  triggeredAt?: number;
  
  // Context
  reason: string;
  action: string; // What to do when triggered
  watchlistId?: string;
  
  // Configuration
  repeat: boolean;
  expiresAt?: number;
  createdAt: number;
}

/**
 * News item from various sources
 */
export interface NewsItem {
  id: string;
  title: string;
  summary: string;
  source: string;
  url?: string;
  publishedAt: number;
  fetchedAt: number;
  
  // Categorization
  tickers: string[];
  categories: string[];
  sentiment: 'bullish' | 'bearish' | 'neutral';
  importance: 'high' | 'medium' | 'low';
  
  // Analysis
  tradingImplications?: string;
}

/**
 * Portfolio recommendation based on research
 */
export interface PortfolioRecommendation {
  id: string;
  timestamp: number;
  
  // Allocation
  allocations: Array<{
    ticker: string;
    weight: number; // 0-100
    thesis: string;
    riskLevel: 'conservative' | 'moderate' | 'aggressive';
  }>;
  
  // Risk management
  maxDrawdown: number;
  cashReserve: number;
  hedges?: string[];
  
  // Context
  marketRegime: string;
  keyRisks: string[];
  catalystsToWatch: string[];
}

/**
 * Persisted state
 */
interface FinanceIntelligenceState {
  research: MarketResearchEntry[];
  watchlist: WatchlistEntry[];
  alerts: PriceAlert[];
  news: NewsItem[];
  recommendations: PortfolioRecommendation[];
  lastUpdated: number;
}

// =============================================================================
// Finance Intelligence Manager
// =============================================================================

export class FinanceIntelligenceManager extends EventEmitter {
  private research: Map<string, MarketResearchEntry> = new Map();
  private watchlist: Map<string, WatchlistEntry> = new Map();
  private alerts: Map<string, PriceAlert> = new Map();
  private news: Map<string, NewsItem> = new Map();
  private recommendations: PortfolioRecommendation[] = [];
  
  private alertCheckInterval: NodeJS.Timeout | null = null;
  private initialized = false;

  constructor() {
    super();
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Initialize and load persisted state
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    try {
      await this.loadState();
      this.initialized = true;
      logger.info('Finance Intelligence initialized', {
        research: this.research.size,
        watchlist: this.watchlist.size,
        alerts: this.alerts.size,
      });
    } catch (error) {
      logger.error('Failed to initialize Finance Intelligence', { error });
      throw error;
    }
  }

  /**
   * Start alert monitoring
   */
  startAlertMonitoring(): void {
    if (this.alertCheckInterval) return;
    
    this.alertCheckInterval = setInterval(
      () => this.checkAlerts(),
      FINANCE_CONSTANTS.ALERT_CHECK_INTERVAL_MS
    );
    logger.info('Alert monitoring started');
  }

  /**
   * Stop alert monitoring
   */
  stopAlertMonitoring(): void {
    if (this.alertCheckInterval) {
      clearInterval(this.alertCheckInterval);
      this.alertCheckInterval = null;
      logger.info('Alert monitoring stopped');
    }
  }

  /**
   * Shutdown and persist state
   */
  async shutdown(): Promise<void> {
    this.stopAlertMonitoring();
    await this.saveState();
    logger.info('Finance Intelligence shutdown complete');
  }

  // ---------------------------------------------------------------------------
  // Research Management
  // ---------------------------------------------------------------------------

  /**
   * Store market research entry
   */
  addResearch(entry: Omit<MarketResearchEntry, 'id' | 'timestamp'>): MarketResearchEntry {
    const research: MarketResearchEntry = {
      ...entry,
      id: randomUUID(),
      timestamp: Date.now(),
    };
    
    // Enforce max entries (remove oldest)
    if (this.research.size >= FINANCE_CONSTANTS.MAX_RESEARCH_ENTRIES) {
      const oldest = [...this.research.values()]
        .sort((a, b) => a.timestamp - b.timestamp)[0];
      if (oldest) {
        this.research.delete(oldest.id);
      }
    }
    
    this.research.set(research.id, research);
    this.emit('research-added', research);
    this.saveState();
    
    logger.info('Research added', { id: research.id, type: research.type, title: research.title });
    return research;
  }

  /**
   * Get research by ID
   */
  getResearch(id: string): MarketResearchEntry | undefined {
    return this.research.get(id);
  }

  /**
   * Search research by query
   */
  searchResearch(query: {
    type?: MarketResearchEntry['type'];
    ticker?: string;
    tags?: string[];
    fromDate?: number;
    toDate?: number;
    limit?: number;
  }): MarketResearchEntry[] {
    let results = [...this.research.values()];
    
    if (query.type) {
      results = results.filter(r => r.type === query.type);
    }
    if (query.ticker) {
      results = results.filter(r => r.ticker?.toLowerCase() === query.ticker!.toLowerCase());
    }
    if (query.tags?.length) {
      results = results.filter(r => 
        query.tags!.some(tag => r.tags.includes(tag.toLowerCase()))
      );
    }
    if (query.fromDate) {
      results = results.filter(r => r.timestamp >= query.fromDate!);
    }
    if (query.toDate) {
      results = results.filter(r => r.timestamp <= query.toDate!);
    }
    
    // Sort by timestamp descending
    results.sort((a, b) => b.timestamp - a.timestamp);
    
    if (query.limit) {
      results = results.slice(0, query.limit);
    }
    
    return results;
  }

  /**
   * Get all research entries
   */
  getAllResearch(): MarketResearchEntry[] {
    return [...this.research.values()].sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Get latest research for a ticker
   */
  getLatestResearchForTicker(ticker: string): MarketResearchEntry | undefined {
    return this.searchResearch({ ticker, limit: 1 })[0];
  }

  // ---------------------------------------------------------------------------
  // Watchlist Management
  // ---------------------------------------------------------------------------

  /**
   * Add to watchlist
   */
  addToWatchlist(entry: Omit<WatchlistEntry, 'id' | 'addedAt' | 'updatedAt' | 'alertIds'>): WatchlistEntry {
    const watchlistEntry: WatchlistEntry = {
      ...entry,
      id: randomUUID(),
      addedAt: Date.now(),
      updatedAt: Date.now(),
      alertIds: [],
    };
    
    // Create alerts for entry zone
    const alerts = this.createWatchlistAlerts(watchlistEntry);
    watchlistEntry.alertIds = alerts.map(a => a.id);
    
    this.watchlist.set(watchlistEntry.id, watchlistEntry);
    this.emit('watchlist-added', watchlistEntry);
    this.saveState();
    
    logger.info('Added to watchlist', { 
      id: watchlistEntry.id, 
      ticker: watchlistEntry.ticker,
      direction: watchlistEntry.direction,
    });
    
    return watchlistEntry;
  }

  /**
   * Create alerts for watchlist entry
   */
  private createWatchlistAlerts(entry: WatchlistEntry): PriceAlert[] {
    const alerts: PriceAlert[] = [];
    
    // Entry zone alert
    const entryAlert = this.createAlert({
      ticker: entry.ticker,
      type: entry.direction === 'long' ? 'price_below' : 'price_above',
      targetPrice: entry.direction === 'long' ? entry.entryZone.high : entry.entryZone.low,
      reason: `Entry zone reached for ${entry.ticker}`,
      action: `Consider ${entry.direction} position. Thesis: ${entry.thesis}`,
      watchlistId: entry.id,
      repeat: false,
    });
    alerts.push(entryAlert);
    
    // Stop loss alert
    const stopAlert = this.createAlert({
      ticker: entry.ticker,
      type: entry.direction === 'long' ? 'price_below' : 'price_above',
      targetPrice: entry.stopLoss,
      reason: `Stop loss level hit for ${entry.ticker}`,
      action: `STOP HIT - Consider exiting position`,
      watchlistId: entry.id,
      repeat: false,
    });
    alerts.push(stopAlert);
    
    // Target alerts
    for (const target of entry.targets) {
      const targetAlert = this.createAlert({
        ticker: entry.ticker,
        type: entry.direction === 'long' ? 'price_above' : 'price_below',
        targetPrice: target.price,
        reason: `Target ${target.price} hit for ${entry.ticker}`,
        action: `Consider taking ${target.allocation}% profit`,
        watchlistId: entry.id,
        repeat: false,
      });
      alerts.push(targetAlert);
    }
    
    return alerts;
  }

  /**
   * Update watchlist entry
   */
  updateWatchlistEntry(id: string, updates: Partial<WatchlistEntry>): WatchlistEntry | undefined {
    const entry = this.watchlist.get(id);
    if (!entry) return undefined;
    
    const updated: WatchlistEntry = {
      ...entry,
      ...updates,
      updatedAt: Date.now(),
    };
    
    this.watchlist.set(id, updated);
    this.emit('watchlist-updated', updated);
    this.saveState();
    
    return updated;
  }

  /**
   * Remove from watchlist
   */
  removeFromWatchlist(id: string): boolean {
    const entry = this.watchlist.get(id);
    if (!entry) return false;
    
    // Remove associated alerts
    for (const alertId of entry.alertIds) {
      this.alerts.delete(alertId);
    }
    
    this.watchlist.delete(id);
    this.emit('watchlist-removed', entry);
    this.saveState();
    
    logger.info('Removed from watchlist', { id, ticker: entry.ticker });
    return true;
  }

  /**
   * Get full watchlist
   */
  getWatchlist(): WatchlistEntry[] {
    return [...this.watchlist.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /**
   * Get watchlist entry by ticker
   */
  getWatchlistByTicker(ticker: string): WatchlistEntry | undefined {
    return [...this.watchlist.values()].find(
      e => e.ticker.toLowerCase() === ticker.toLowerCase()
    );
  }

  // ---------------------------------------------------------------------------
  // Alert Management
  // ---------------------------------------------------------------------------

  /**
   * Create a price alert
   */
  createAlert(params: Omit<PriceAlert, 'id' | 'triggered' | 'createdAt'>): PriceAlert {
    const alert: PriceAlert = {
      ...params,
      id: randomUUID(),
      triggered: false,
      createdAt: Date.now(),
    };
    
    this.alerts.set(alert.id, alert);
    this.emit('alert-created', alert);
    this.saveState();
    
    logger.info('Alert created', { 
      id: alert.id, 
      ticker: alert.ticker, 
      type: alert.type,
      target: alert.targetPrice,
    });
    
    return alert;
  }

  /**
   * Check alerts against current prices
   * Called by alert monitoring interval
   */
  private async checkAlerts(): Promise<void> {
    // This would integrate with price feed
    // For now, emit event for external handling
    const activeAlerts = [...this.alerts.values()].filter(a => !a.triggered);
    
    if (activeAlerts.length > 0) {
      this.emit('alerts-check-needed', activeAlerts);
    }
  }

  /**
   * Trigger an alert (called when price condition met)
   */
  triggerAlert(id: string, currentPrice: number): void {
    const alert = this.alerts.get(id);
    if (!alert || alert.triggered) return;
    
    alert.triggered = true;
    alert.triggeredAt = Date.now();
    alert.currentPrice = currentPrice;
    
    this.emit('alert-triggered', alert);
    this.saveState();
    
    logger.info('Alert triggered', {
      id: alert.id,
      ticker: alert.ticker,
      target: alert.targetPrice,
      actual: currentPrice,
    });
    
    // Update watchlist status if linked
    if (alert.watchlistId) {
      const entry = this.watchlist.get(alert.watchlistId);
      if (entry && entry.status === 'watching') {
        this.updateWatchlistEntry(alert.watchlistId, { status: 'triggered' });
      }
    }
    
    // Remove if not repeating
    if (!alert.repeat) {
      this.alerts.delete(id);
    }
  }

  /**
   * Get all active alerts
   */
  getActiveAlerts(): PriceAlert[] {
    return [...this.alerts.values()]
      .filter(a => !a.triggered)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  /**
   * Get alerts for a ticker
   */
  getAlertsForTicker(ticker: string): PriceAlert[] {
    return [...this.alerts.values()].filter(
      a => a.ticker.toLowerCase() === ticker.toLowerCase()
    );
  }

  /**
   * Delete an alert
   */
  deleteAlert(id: string): boolean {
    const deleted = this.alerts.delete(id);
    if (deleted) {
      this.saveState();
      logger.info('Alert deleted', { id });
    }
    return deleted;
  }

  // ---------------------------------------------------------------------------
  // News Management
  // ---------------------------------------------------------------------------

  /**
   * Add news item
   */
  addNews(item: Omit<NewsItem, 'id' | 'fetchedAt'>): NewsItem {
    const news: NewsItem = {
      ...item,
      id: randomUUID(),
      fetchedAt: Date.now(),
    };
    
    // Enforce max items
    if (this.news.size >= FINANCE_CONSTANTS.MAX_NEWS_ITEMS) {
      const oldest = [...this.news.values()]
        .sort((a, b) => a.fetchedAt - b.fetchedAt)[0];
      if (oldest) {
        this.news.delete(oldest.id);
      }
    }
    
    this.news.set(news.id, news);
    this.emit('news-added', news);
    
    return news;
  }

  /**
   * Get recent news
   */
  getRecentNews(options: {
    tickers?: string[];
    categories?: string[];
    importance?: NewsItem['importance'];
    limit?: number;
    hoursBack?: number;
  } = {}): NewsItem[] {
    const { limit = 50, hoursBack = 24 } = options;
    const cutoff = Date.now() - (hoursBack * 60 * 60 * 1000);
    
    let results = [...this.news.values()].filter(n => n.fetchedAt >= cutoff);
    
    if (options.tickers?.length) {
      const tickerSet = new Set(options.tickers.map(t => t.toLowerCase()));
      results = results.filter(n => 
        n.tickers.some(t => tickerSet.has(t.toLowerCase()))
      );
    }
    
    if (options.categories?.length) {
      const catSet = new Set(options.categories.map(c => c.toLowerCase()));
      results = results.filter(n =>
        n.categories.some(c => catSet.has(c.toLowerCase()))
      );
    }
    
    if (options.importance) {
      results = results.filter(n => n.importance === options.importance);
    }
    
    return results
      .sort((a, b) => b.publishedAt - a.publishedAt)
      .slice(0, limit);
  }

  // ---------------------------------------------------------------------------
  // Portfolio Recommendations
  // ---------------------------------------------------------------------------

  /**
   * Store portfolio recommendation
   */
  addRecommendation(rec: Omit<PortfolioRecommendation, 'id' | 'timestamp'>): PortfolioRecommendation {
    const recommendation: PortfolioRecommendation = {
      ...rec,
      id: randomUUID(),
      timestamp: Date.now(),
    };
    
    this.recommendations.push(recommendation);
    
    // Keep only last 50 recommendations
    if (this.recommendations.length > 50) {
      this.recommendations = this.recommendations.slice(-50);
    }
    
    this.emit('recommendation-added', recommendation);
    this.saveState();
    
    return recommendation;
  }

  /**
   * Get latest recommendation
   */
  getLatestRecommendation(): PortfolioRecommendation | undefined {
    return this.recommendations[this.recommendations.length - 1];
  }

  // ---------------------------------------------------------------------------
  // Convenience Methods for Atlas Voice
  // ---------------------------------------------------------------------------

  /**
   * Get summary for voice response
   */
  getSummary(): {
    watchlistCount: number;
    activeAlerts: number;
    recentResearch: number;
    topWatchItems: Array<{ ticker: string; thesis: string; conviction: string }>;
    upcomingCatalysts: Catalyst[];
  } {
    const watchlist = this.getWatchlist();
    const topWatchItems = watchlist.slice(0, 5).map(w => ({
      ticker: w.ticker,
      thesis: w.thesis,
      conviction: w.conviction,
    }));
    
    const upcomingCatalysts: Catalyst[] = [];
    for (const research of this.research.values()) {
      if (research.catalysts) {
        upcomingCatalysts.push(...research.catalysts);
      }
    }
    
    // Sort by date (put TBD at end)
    upcomingCatalysts.sort((a, b) => {
      if (a.date === 'TBD') return 1;
      if (b.date === 'TBD') return -1;
      return new Date(a.date).getTime() - new Date(b.date).getTime();
    });
    
    return {
      watchlistCount: this.watchlist.size,
      activeAlerts: this.getActiveAlerts().length,
      recentResearch: this.research.size,
      topWatchItems,
      upcomingCatalysts: upcomingCatalysts.slice(0, 10),
    };
  }

  /**
   * Get context for LLM
   */
  getContextForLLM(): string {
    const summary = this.getSummary();
    const watchlist = this.getWatchlist().slice(0, 10);
    const alerts = this.getActiveAlerts().slice(0, 10);
    
    let context = `[FINANCE INTELLIGENCE CONTEXT]\n`;
    context += `Watchlist: ${summary.watchlistCount} items\n`;
    context += `Active Alerts: ${summary.activeAlerts}\n`;
    context += `Research Entries: ${summary.recentResearch}\n\n`;
    
    if (watchlist.length > 0) {
      context += `Top Watchlist:\n`;
      for (const item of watchlist) {
        context += `- ${item.ticker}: ${item.direction} (${item.conviction}) - ${item.thesis.slice(0, 100)}\n`;
        context += `  Entry: $${item.entryZone.low}-${item.entryZone.high}, Stop: $${item.stopLoss}\n`;
      }
      context += '\n';
    }
    
    if (alerts.length > 0) {
      context += `Active Alerts:\n`;
      for (const alert of alerts) {
        context += `- ${alert.ticker} @ $${alert.targetPrice}: ${alert.reason}\n`;
      }
      context += '\n';
    }
    
    if (summary.upcomingCatalysts.length > 0) {
      context += `Upcoming Catalysts:\n`;
      for (const catalyst of summary.upcomingCatalysts.slice(0, 5)) {
        context += `- ${catalyst.date}: ${catalyst.event} (${catalyst.expectedImpact} impact)\n`;
      }
    }
    
    return context;
  }

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  private async loadState(): Promise<void> {
    try {
      const store = getStore();
      const state = store.get(FINANCE_CONSTANTS.STORE_KEY) as FinanceIntelligenceState | undefined;
      
      if (state) {
        // Load research
        for (const entry of state.research || []) {
          this.research.set(entry.id, entry);
        }
        
        // Load watchlist
        for (const entry of state.watchlist || []) {
          this.watchlist.set(entry.id, entry);
        }
        
        // Load alerts
        for (const alert of state.alerts || []) {
          this.alerts.set(alert.id, alert);
        }
        
        // Load news
        for (const item of state.news || []) {
          this.news.set(item.id, item);
        }
        
        // Load recommendations
        this.recommendations = state.recommendations || [];
        
        logger.info('State loaded', {
          research: this.research.size,
          watchlist: this.watchlist.size,
          alerts: this.alerts.size,
          news: this.news.size,
        });
      }
    } catch (error) {
      logger.warn('Failed to load state, starting fresh', { error });
    }
  }

  private async saveState(): Promise<void> {
    try {
      const store = getStore();
      const state: FinanceIntelligenceState = {
        research: [...this.research.values()],
        watchlist: [...this.watchlist.values()],
        alerts: [...this.alerts.values()],
        news: [...this.news.values()],
        recommendations: this.recommendations,
        lastUpdated: Date.now(),
      };
      
      store.set(FINANCE_CONSTANTS.STORE_KEY, state);
    } catch (error) {
      logger.error('Failed to save state', { error });
    }
  }
}

// =============================================================================
// Singleton
// =============================================================================

let instance: FinanceIntelligenceManager | null = null;

export function getFinanceIntelligence(): FinanceIntelligenceManager {
  if (!instance) {
    instance = new FinanceIntelligenceManager();
  }
  return instance;
}

export function shutdownFinanceIntelligence(): void {
  if (instance) {
    instance.shutdown();
    instance = null;
  }
}
