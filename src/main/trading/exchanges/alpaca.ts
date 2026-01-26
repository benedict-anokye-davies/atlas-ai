/**
 * Atlas Trading - Alpaca Exchange
 *
 * Alpaca Markets integration for paper and live trading.
 * Supports US equities and crypto with commission-free trading.
 *
 * Features:
 * - Paper trading (safe strategy testing)
 * - Real-time market data via WebSocket
 * - Fractional shares support
 * - Extended hours trading
 *
 * @module trading/exchanges/alpaca
 */

import Decimal from 'decimal.js';
import { EventEmitter } from 'events';
import WebSocket from 'ws';
import {
  ExchangeId,
  ExchangeConfig,
  ExchangeCredentials,
  ConnectionStatus,
  TradingSymbol,
  Ticker,
  OrderBook,
  OrderBookLevel,
  Balance,
  CurrencyBalance,
  OrderRequest,
  Order,
  OrderSide,
  OrderType,
  OrderStatus,
  Trade,
  Position,
  PositionSide,
  OHLCV,
  PriceCallback,
  IExchange,
} from '../types';
import { createModuleLogger } from '../../utils/logger';

const logger = createModuleLogger('AlpacaExchange');

// =============================================================================
// Types
// =============================================================================

/**
 * Alpaca exchange configuration
 */
export interface AlpacaConfig extends ExchangeConfig {
  id: 'alpaca';
  /** Use paper trading (default: true for safety) */
  paper?: boolean;
  /** Enable crypto trading (vs equities only) */
  cryptoEnabled?: boolean;
  /** Data feed: 'iex' (free) or 'sip' (paid, better quality) */
  dataFeed?: 'iex' | 'sip';
}

/**
 * Alpaca account info
 */
export interface AlpacaAccount {
  id: string;
  accountNumber: string;
  status: string;
  currency: string;
  cash: Decimal;
  portfolioValue: Decimal;
  patternDayTrader: boolean;
  tradingBlocked: boolean;
  transfersBlocked: boolean;
  accountBlocked: boolean;
  tradeSuspendedByUser: boolean;
  multiplier: string;
  shorting: boolean;
  equity: Decimal;
  lastEquity: Decimal;
  longMarketValue: Decimal;
  shortMarketValue: Decimal;
  daytradeCount: number;
  daytradingBuyingPower: Decimal;
  regtBuyingPower: Decimal;
}

/**
 * Alpaca position
 */
interface AlpacaPosition {
  asset_id: string;
  symbol: string;
  exchange: string;
  asset_class: string;
  avg_entry_price: string;
  qty: string;
  side: string;
  market_value: string;
  cost_basis: string;
  unrealized_pl: string;
  unrealized_plpc: string;
  unrealized_intraday_pl: string;
  unrealized_intraday_plpc: string;
  current_price: string;
  lastday_price: string;
  change_today: string;
}

/**
 * Alpaca order response
 */
interface AlpacaOrder {
  id: string;
  client_order_id: string;
  created_at: string;
  updated_at: string;
  submitted_at: string;
  filled_at: string | null;
  expired_at: string | null;
  canceled_at: string | null;
  failed_at: string | null;
  asset_id: string;
  symbol: string;
  asset_class: string;
  qty: string;
  filled_qty: string;
  type: string;
  side: string;
  time_in_force: string;
  limit_price: string | null;
  stop_price: string | null;
  filled_avg_price: string | null;
  status: string;
  extended_hours: boolean;
  legs: unknown[] | null;
  trail_price: string | null;
  trail_percent: string | null;
  hwm: string | null;
}

// =============================================================================
// Constants
// =============================================================================

const ALPACA_PAPER_URL = 'https://paper-api.alpaca.markets';
const ALPACA_LIVE_URL = 'https://api.alpaca.markets';
const ALPACA_DATA_URL = 'https://data.alpaca.markets';
const ALPACA_STREAM_URL = 'wss://stream.data.alpaca.markets/v2';

// =============================================================================
// Alpaca Exchange Implementation
// =============================================================================

/**
 * Alpaca exchange implementation
 * Supports paper and live trading for US equities and crypto
 */
export class AlpacaExchange extends EventEmitter implements IExchange {
  readonly id: ExchangeId = 'alpaca';
  readonly name: string = 'Alpaca';
  
  private config: AlpacaConfig;
  private credentials: ExchangeCredentials | null = null;
  private _status: ConnectionStatus = 'disconnected';
  private baseUrl: string;
  private dataUrl: string;
  private streamWs: WebSocket | null = null;
  private priceCallbacks: Map<string, PriceCallback[]> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;

  constructor(config: Partial<AlpacaConfig> = {}) {
    super();
    this.config = {
      id: 'alpaca',
      name: 'Alpaca',
      sandbox: true,
      paper: true, // Default to paper for safety
      cryptoEnabled: false,
      dataFeed: 'iex',
      ...config,
    } as AlpacaConfig;
    
    // Set URLs based on paper vs live
    this.baseUrl = this.config.paper ? ALPACA_PAPER_URL : ALPACA_LIVE_URL;
    this.dataUrl = ALPACA_DATA_URL;
    
    logger.info('AlpacaExchange initialized', {
      paper: this.config.paper,
      cryptoEnabled: this.config.cryptoEnabled,
      dataFeed: this.config.dataFeed,
    });
  }

  // ===========================================================================
  // Connection Management
  // ===========================================================================

  get status(): ConnectionStatus {
    return this._status;
  }

  private setStatus(status: ConnectionStatus): void {
    if (this._status !== status) {
      this._status = status;
      this.emit('status', status);
    }
  }

  async connect(credentials: ExchangeCredentials): Promise<void> {
    this.setStatus('connecting');
    this.credentials = credentials;

    try {
      // Verify credentials by fetching account
      const account = await this.fetchAccount();
      logger.info('Connected to Alpaca', {
        accountNumber: account.accountNumber,
        paper: this.config.paper,
        status: account.status,
      });
      
      this.setStatus('connected');
      this.reconnectAttempts = 0;
    } catch (error) {
      this.setStatus('error');
      throw new Error(`Failed to connect to Alpaca: ${(error as Error).message}`);
    }
  }

  async disconnect(): Promise<void> {
    // Close WebSocket
    if (this.streamWs) {
      this.streamWs.close();
      this.streamWs = null;
    }
    
    this.credentials = null;
    this.priceCallbacks.clear();
    this.setStatus('disconnected');
    logger.info('Disconnected from Alpaca');
  }

  isConnected(): boolean {
    return this._status === 'connected';
  }

  private ensureConnected(): void {
    if (!this.isConnected() || !this.credentials) {
      throw new Error('Not connected to Alpaca. Call connect() first.');
    }
  }

  // ===========================================================================
  // HTTP Helpers
  // ===========================================================================

  private async request<T>(
    endpoint: string,
    method: 'GET' | 'POST' | 'DELETE' | 'PATCH' = 'GET',
    body?: unknown,
    useDataApi = false
  ): Promise<T> {
    this.ensureConnected();
    
    const url = `${useDataApi ? this.dataUrl : this.baseUrl}${endpoint}`;
    
    const response = await fetch(url, {
      method,
      headers: {
        'APCA-API-KEY-ID': this.credentials!.apiKey,
        'APCA-API-SECRET-KEY': this.credentials!.secret,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Alpaca API error: ${response.status} - ${error}`);
    }

    return response.json() as Promise<T>;
  }

  // ===========================================================================
  // Account & Balance
  // ===========================================================================

  async fetchAccount(): Promise<AlpacaAccount> {
    interface RawAccount {
      id: string;
      account_number: string;
      status: string;
      currency: string;
      cash: string;
      portfolio_value: string;
      pattern_day_trader: boolean;
      trading_blocked: boolean;
      transfers_blocked: boolean;
      account_blocked: boolean;
      trade_suspended_by_user: boolean;
      multiplier: string;
      shorting_enabled: boolean;
      equity: string;
      last_equity: string;
      long_market_value: string;
      short_market_value: string;
      daytrading_buying_power: string;
      regt_buying_power: string;
      daytrade_count: number;
    }
    
    const data = await this.request<RawAccount>('/v2/account');
    
    return {
      id: data.id,
      accountNumber: data.account_number,
      status: data.status,
      currency: data.currency,
      cash: new Decimal(data.cash),
      portfolioValue: new Decimal(data.portfolio_value),
      patternDayTrader: data.pattern_day_trader,
      tradingBlocked: data.trading_blocked,
      transfersBlocked: data.transfers_blocked,
      accountBlocked: data.account_blocked,
      tradeSuspendedByUser: data.trade_suspended_by_user,
      multiplier: data.multiplier,
      shorting: data.shorting_enabled,
      equity: new Decimal(data.equity),
      lastEquity: new Decimal(data.last_equity),
      longMarketValue: new Decimal(data.long_market_value),
      shortMarketValue: new Decimal(data.short_market_value),
      daytradeCount: data.daytrade_count,
      daytradingBuyingPower: new Decimal(data.daytrading_buying_power),
      regtBuyingPower: new Decimal(data.regt_buying_power),
    };
  }

  async fetchBalance(): Promise<Balance> {
    const account = await this.fetchAccount();
    
    const currencies = new Map<string, CurrencyBalance>();
    currencies.set('USD', {
      currency: 'USD',
      total: account.portfolioValue,
      free: account.cash,
      used: account.portfolioValue.minus(account.cash),
    });

    return {
      exchange: this.id,
      timestamp: Date.now(),
      currencies,
      get: (currency: string) => currencies.get(currency),
      totalUsdValue: account.portfolioValue,
    };
  }

  // ===========================================================================
  // Market Data
  // ===========================================================================

  async fetchTicker(symbol: TradingSymbol): Promise<Ticker> {
    // Alpaca uses different endpoints for stocks vs crypto
    const isStock = !symbol.includes('/');
    
    if (isStock) {
      interface LatestTrade { trade: { p: number; s: number; t: string } }
      interface LatestQuote { quote: { ap: number; bp: number; as: number; bs: number } }
      
      const [trade, quote] = await Promise.all([
        this.request<LatestTrade>(`/v2/stocks/${symbol}/trades/latest`, 'GET', undefined, true),
        this.request<LatestQuote>(`/v2/stocks/${symbol}/quotes/latest`, 'GET', undefined, true),
      ]);
      
      return {
        symbol,
        timestamp: Date.now(),
        datetime: new Date().toISOString(),
        bid: new Decimal(quote.quote.bp),
        ask: new Decimal(quote.quote.ap),
        last: new Decimal(trade.trade.p),
        high: new Decimal(0), // Not available in latest endpoint
        low: new Decimal(0),
        volume: new Decimal(trade.trade.s),
        change: new Decimal(0),
        percentage: new Decimal(0),
      };
    } else {
      // Crypto format: BTC/USD
      const cryptoSymbol = symbol.replace('/', '');
      interface CryptoTrade { trade: { p: number; s: number } }
      interface CryptoQuote { quote: { ap: number; bp: number } }
      
      const [trade, quote] = await Promise.all([
        this.request<CryptoTrade>(`/v1beta3/crypto/us/latest/trades?symbols=${cryptoSymbol}`, 'GET', undefined, true),
        this.request<CryptoQuote>(`/v1beta3/crypto/us/latest/quotes?symbols=${cryptoSymbol}`, 'GET', undefined, true),
      ]);
      
      return {
        symbol,
        timestamp: Date.now(),
        datetime: new Date().toISOString(),
        bid: new Decimal(quote.quote?.bp || 0),
        ask: new Decimal(quote.quote?.ap || 0),
        last: new Decimal(trade.trade?.p || 0),
        high: new Decimal(0),
        low: new Decimal(0),
        volume: new Decimal(trade.trade?.s || 0),
        change: new Decimal(0),
        percentage: new Decimal(0),
      };
    }
  }

  async fetchOrderBook(symbol: TradingSymbol, _limit?: number): Promise<OrderBook> {
    // Alpaca doesn't provide full order book, only best bid/ask
    const ticker = await this.fetchTicker(symbol);
    
    const bids: OrderBookLevel[] = [{ price: ticker.bid, amount: new Decimal(1) }];
    const asks: OrderBookLevel[] = [{ price: ticker.ask, amount: new Decimal(1) }];
    
    return {
      symbol,
      timestamp: Date.now(),
      bids,
      asks,
    };
  }

  async fetchOHLCV(
    symbol: TradingSymbol,
    timeframe: string = '1h',
    since?: number,
    limit?: number
  ): Promise<OHLCV[]> {
    const params = new URLSearchParams();
    params.set('timeframe', this.convertTimeframe(timeframe));
    if (limit) params.set('limit', limit.toString());
    if (since) params.set('start', new Date(since).toISOString());
    
    interface Bar {
      t: string;
      o: number;
      h: number;
      l: number;
      c: number;
      v: number;
    }
    
    const data = await this.request<{ bars: Bar[] }>(
      `/v2/stocks/${symbol}/bars?${params}`,
      'GET',
      undefined,
      true
    );
    
    return (data.bars || []).map((bar) => ({
      timestamp: new Date(bar.t).getTime(),
      open: new Decimal(bar.o),
      high: new Decimal(bar.h),
      low: new Decimal(bar.l),
      close: new Decimal(bar.c),
      volume: new Decimal(bar.v),
    }));
  }

  private convertTimeframe(tf: string): string {
    const map: Record<string, string> = {
      '1m': '1Min',
      '5m': '5Min',
      '15m': '15Min',
      '1h': '1Hour',
      '1d': '1Day',
      '1w': '1Week',
    };
    return map[tf] || '1Hour';
  }

  async fetchTickers(symbols?: TradingSymbol[]): Promise<Map<string, Ticker>> {
    const tickers = new Map<string, Ticker>();
    
    const symbolList = symbols || await this.getSymbols();
    
    // Batch fetch (Alpaca supports multiple symbols)
    for (const symbol of symbolList.slice(0, 100)) { // Limit to 100
      try {
        const ticker = await this.fetchTicker(symbol);
        tickers.set(symbol, ticker);
      } catch {
        // Skip failed symbols
      }
    }
    
    return tickers;
  }

  subscribePrice(symbol: TradingSymbol, callback: PriceCallback): () => void {
    // Use the watchTicker mechanism
    void this.watchTicker(symbol, callback);
    
    return () => {
      this.unwatchTicker(symbol);
    };
  }

  async fetchMarkets(): Promise<unknown[]> {
    interface Asset {
      id: string;
      class: string;
      exchange: string;
      symbol: string;
      name: string;
      status: string;
      tradable: boolean;
      marginable: boolean;
      shortable: boolean;
      easy_to_borrow: boolean;
      fractionable: boolean;
    }
    
    const data = await this.request<Asset[]>('/v2/assets?status=active');
    return data;
  }

  private symbols: TradingSymbol[] = [];

  getSymbols(): TradingSymbol[] {
    return this.symbols;
  }

  async loadSymbols(): Promise<TradingSymbol[]> {
    const markets = await this.fetchMarkets() as Array<{ symbol: string; tradable: boolean }>;
    this.symbols = markets.filter(m => m.tradable).map(m => m.symbol);
    return this.symbols;
  }

  // ===========================================================================
  // Orders
  // ===========================================================================

  async createOrder(request: OrderRequest): Promise<Order> {
    const body: Record<string, unknown> = {
      symbol: request.symbol,
      qty: request.amount.toString(),
      side: request.side,
      type: this.convertOrderType(request.type),
      time_in_force: request.timeInForce || 'day',
    };

    if (request.price && (request.type === 'limit' || request.type === 'stop_limit')) {
      body.limit_price = request.price.toString();
    }
    if (request.stopPrice && (request.type === 'stop' || request.type === 'stop_limit')) {
      body.stop_price = request.stopPrice.toString();
    }
    if (request.clientOrderId) {
      body.client_order_id = request.clientOrderId;
    }

    logger.info('Creating Alpaca order', { symbol: request.symbol, side: request.side, type: request.type });
    
    const data = await this.request<AlpacaOrder>('/v2/orders', 'POST', body);
    return this.convertOrder(data);
  }

  async cancelOrder(orderId: string, _symbol?: string): Promise<Order> {
    const order = await this.fetchOrder(orderId);
    await this.request(`/v2/orders/${orderId}`, 'DELETE');
    logger.info('Cancelled order', { orderId });
    return { ...order, status: 'canceled' as OrderStatus };
  }

  async fetchOrder(orderId: string): Promise<Order> {
    const data = await this.request<AlpacaOrder>(`/v2/orders/${orderId}`);
    return this.convertOrder(data);
  }

  async fetchOpenOrders(symbol?: TradingSymbol): Promise<Order[]> {
    const params = new URLSearchParams({ status: 'open' });
    if (symbol) params.set('symbols', symbol);
    
    const data = await this.request<AlpacaOrder[]>(`/v2/orders?${params}`);
    return data.map((o) => this.convertOrder(o));
  }

  async fetchClosedOrders(symbol?: TradingSymbol, since?: number, limit?: number): Promise<Order[]> {
    const params = new URLSearchParams({ status: 'closed' });
    if (symbol) params.set('symbols', symbol);
    if (since) params.set('after', new Date(since).toISOString());
    if (limit) params.set('limit', limit.toString());
    
    const data = await this.request<AlpacaOrder[]>(`/v2/orders?${params}`);
    return data.map((o) => this.convertOrder(o));
  }

  async cancelAllOrders(): Promise<void> {
    await this.request('/v2/orders', 'DELETE');
    logger.info('Cancelled all orders');
  }

  private convertOrderType(type: OrderType): string {
    const map: Record<OrderType, string> = {
      market: 'market',
      limit: 'limit',
      stop: 'stop',
      stop_limit: 'stop_limit',
      trailing_stop: 'trailing_stop',
    };
    return map[type] || 'market';
  }

  private convertOrderStatus(status: string): OrderStatus {
    const map: Record<string, OrderStatus> = {
      new: 'open',
      partially_filled: 'open',
      filled: 'closed',
      done_for_day: 'closed',
      canceled: 'canceled',
      expired: 'expired',
      replaced: 'canceled',
      pending_cancel: 'open',
      pending_replace: 'open',
      accepted: 'open',
      pending_new: 'open',
      accepted_for_bidding: 'open',
      stopped: 'closed',
      rejected: 'rejected',
      suspended: 'open',
      calculated: 'open',
    };
    return map[status] || 'open';
  }

  private convertOrder(data: AlpacaOrder): Order {
    return {
      id: data.id,
      clientOrderId: data.client_order_id,
      exchange: this.id,
      symbol: data.symbol,
      side: data.side as OrderSide,
      type: data.type as OrderType,
      status: this.convertOrderStatus(data.status),
      amount: new Decimal(data.qty),
      filled: new Decimal(data.filled_qty || 0),
      remaining: new Decimal(data.qty).minus(data.filled_qty || 0),
      price: data.limit_price ? new Decimal(data.limit_price) : undefined,
      stopPrice: data.stop_price ? new Decimal(data.stop_price) : undefined,
      average: data.filled_avg_price ? new Decimal(data.filled_avg_price) : undefined,
      cost: new Decimal(data.filled_qty || 0).times(data.filled_avg_price || 0),
      timestamp: new Date(data.created_at).getTime(),
      datetime: data.created_at,
      lastUpdateTimestamp: new Date(data.updated_at).getTime(),
      info: data as unknown as Record<string, unknown>,
    };
  }

  // ===========================================================================
  // Positions
  // ===========================================================================

  async fetchPositions(_symbols?: TradingSymbol[]): Promise<Position[]> {
    const data = await this.request<AlpacaPosition[]>('/v2/positions');
    return data.map((p) => this.convertPosition(p));
  }

  async fetchPosition(symbol: TradingSymbol): Promise<Position | null> {
    try {
      const data = await this.request<AlpacaPosition>(`/v2/positions/${symbol}`);
      return this.convertPosition(data);
    } catch {
      return null;
    }
  }

  async closePosition(symbol: TradingSymbol, percentage?: number): Promise<Order | null> {
    const params = percentage ? `?percentage=${percentage}` : '';
    try {
      const data = await this.request<AlpacaOrder>(`/v2/positions/${symbol}${params}`, 'DELETE');
      return this.convertOrder(data);
    } catch {
      return null;
    }
  }

  async closeAllPositions(): Promise<void> {
    await this.request('/v2/positions', 'DELETE');
    logger.info('Closed all positions');
  }

  private convertPosition(data: AlpacaPosition): Position {
    const qty = new Decimal(data.qty);
    return {
      id: data.asset_id,
      exchange: this.id,
      symbol: data.symbol,
      side: qty.isPositive() ? 'long' : 'short' as PositionSide,
      contracts: qty.abs(),
      entryPrice: new Decimal(data.avg_entry_price),
      markPrice: new Decimal(data.current_price),
      unrealizedPnl: new Decimal(data.unrealized_pl),
      notional: new Decimal(data.market_value),
      timestamp: Date.now(),
      info: data as unknown as Record<string, unknown>,
    };
  }

  // ===========================================================================
  // Trades
  // ===========================================================================

  async fetchMyTrades(symbol?: TradingSymbol, since?: number, limit?: number): Promise<Trade[]> {
    // Alpaca calls these "activities"
    const params = new URLSearchParams({ activity_types: 'FILL' });
    if (since) params.set('after', new Date(since).toISOString());
    if (limit) params.set('page_size', limit.toString());
    
    interface Activity {
      id: string;
      activity_type: string;
      symbol: string;
      side: string;
      qty: string;
      price: string;
      transaction_time: string;
      order_id: string;
    }
    
    const data = await this.request<Activity[]>(`/v2/account/activities?${params}`);
    
    return data
      .filter((a) => !symbol || a.symbol === symbol)
      .map((a) => ({
        id: a.id,
        orderId: a.order_id,
        exchange: this.id,
        symbol: a.symbol,
        side: a.side as OrderSide,
        type: 'market' as OrderType, // Alpaca activities don't include order type
        amount: new Decimal(a.qty),
        price: new Decimal(a.price),
        cost: new Decimal(a.qty).times(a.price),
        timestamp: new Date(a.transaction_time).getTime(),
        datetime: a.transaction_time,
        info: a as unknown as Record<string, unknown>,
      }));
  }

  // ===========================================================================
  // Streaming
  // ===========================================================================

  async watchTicker(symbol: TradingSymbol, callback: PriceCallback): Promise<void> {
    // Add callback to list
    const callbacks = this.priceCallbacks.get(symbol) || [];
    callbacks.push(callback);
    this.priceCallbacks.set(symbol, callbacks);
    
    // Connect stream if not already connected
    if (!this.streamWs) {
      await this.connectStream();
    }
    
    // Subscribe to symbol
    this.subscribeToSymbol(symbol);
  }

  unwatchTicker(symbol: TradingSymbol): void {
    this.priceCallbacks.delete(symbol);
    
    // Unsubscribe from symbol
    if (this.streamWs?.readyState === WebSocket.OPEN) {
      this.streamWs.send(JSON.stringify({
        action: 'unsubscribe',
        trades: [symbol],
        quotes: [symbol],
      }));
    }
  }

  private async connectStream(): Promise<void> {
    if (!this.credentials) return;
    
    const feed = this.config.dataFeed || 'iex';
    const wsUrl = `${ALPACA_STREAM_URL}/${feed}`;
    
    this.streamWs = new WebSocket(wsUrl);
    
    this.streamWs.on('open', () => {
      logger.info('Alpaca stream connected');
      // Authenticate
      this.streamWs!.send(JSON.stringify({
        action: 'auth',
        key: this.credentials!.apiKey,
        secret: this.credentials!.secret,
      }));
    });
    
    this.streamWs.on('message', (data) => {
      try {
        const messages = JSON.parse(data.toString()) as Array<{
          T: string;
          S?: string;
          p?: number;
          s?: number;
          bp?: number;
          ap?: number;
          msg?: string;
        }>;
        
        for (const msg of messages) {
          if (msg.T === 'success' && msg.msg === 'authenticated') {
            logger.info('Alpaca stream authenticated');
            // Resubscribe to all symbols
            for (const symbol of this.priceCallbacks.keys()) {
              this.subscribeToSymbol(symbol);
            }
          } else if (msg.T === 't' && msg.S) {
            // Trade update
            this.handleTradeUpdate(msg.S, msg.p!, msg.s!);
          } else if (msg.T === 'q' && msg.S) {
            // Quote update
            this.handleQuoteUpdate(msg.S, msg.bp!, msg.ap!);
          }
        }
      } catch (e) {
        logger.error('Failed to parse stream message', { error: (e as Error).message });
      }
    });
    
    this.streamWs.on('close', () => {
      logger.warn('Alpaca stream disconnected');
      this.streamWs = null;
      
      // Attempt reconnect
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        setTimeout(() => this.connectStream(), 5000 * this.reconnectAttempts);
      }
    });
    
    this.streamWs.on('error', (error) => {
      logger.error('Alpaca stream error', { error: error.message });
    });
  }

  private subscribeToSymbol(symbol: string): void {
    if (this.streamWs?.readyState === WebSocket.OPEN) {
      this.streamWs.send(JSON.stringify({
        action: 'subscribe',
        trades: [symbol],
        quotes: [symbol],
      }));
    }
  }

  private handleTradeUpdate(symbol: string, price: number, size: number): void {
    const callbacks = this.priceCallbacks.get(symbol) || [];
    const ticker: Ticker = {
      symbol,
      timestamp: Date.now(),
      datetime: new Date().toISOString(),
      bid: new Decimal(0),
      ask: new Decimal(0),
      last: new Decimal(price),
      high: new Decimal(0),
      low: new Decimal(0),
      volume: new Decimal(size),
      change: new Decimal(0),
      percentage: new Decimal(0),
    };
    
    for (const cb of callbacks) {
      try {
        cb(ticker);
      } catch (e) {
        logger.error('Price callback error', { symbol, error: (e as Error).message });
      }
    }
  }

  private handleQuoteUpdate(symbol: string, bid: number, ask: number): void {
    const callbacks = this.priceCallbacks.get(symbol) || [];
    const ticker: Ticker = {
      symbol,
      timestamp: Date.now(),
      datetime: new Date().toISOString(),
      bid: new Decimal(bid),
      ask: new Decimal(ask),
      last: new Decimal(0),
      high: new Decimal(0),
      low: new Decimal(0),
      volume: new Decimal(0),
      change: new Decimal(0),
      percentage: new Decimal(0),
    };
    
    for (const cb of callbacks) {
      try {
        cb(ticker);
      } catch (e) {
        logger.error('Quote callback error', { symbol, error: (e as Error).message });
      }
    }
  }

  // ===========================================================================
  // Exchange Info
  // ===========================================================================

  getExchangeInfo(): {
    paper: boolean;
    cryptoEnabled: boolean;
    dataFeed: string;
  } {
    return {
      paper: this.config.paper ?? true,
      cryptoEnabled: this.config.cryptoEnabled ?? false,
      dataFeed: this.config.dataFeed || 'iex',
    };
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create an Alpaca exchange instance
 */
export function createAlpacaExchange(config?: Partial<AlpacaConfig>): AlpacaExchange {
  return new AlpacaExchange(config);
}

/**
 * Create an Alpaca paper trading exchange (safe for testing)
 */
export function createAlpacaPaperTrading(): AlpacaExchange {
  return new AlpacaExchange({
    paper: true,
    sandbox: true,
  });
}

/**
 * Create an Alpaca live trading exchange
 * WARNING: This uses real money!
 */
export function createAlpacaLiveTrading(): AlpacaExchange {
  logger.warn('Creating LIVE Alpaca exchange - real money will be used!');
  return new AlpacaExchange({
    paper: false,
    sandbox: false,
  });
}

export default AlpacaExchange;
