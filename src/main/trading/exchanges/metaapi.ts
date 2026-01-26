/**
 * Atlas Trading - MetaApi Exchange
 *
 * MetaApi.cloud integration for MT4/MT5 forex trading.
 * Provides access to forex brokers through MetaApi SDK.
 *
 * Note: Requires MetaApi account and deployed MT4/MT5 account.
 *
 * @module trading/exchanges/metaapi
 */

import { EventEmitter } from 'events';
import Decimal from 'decimal.js';
import {
  ExchangeId,
  ExchangeCredentials,
  ConnectionStatus,
  IExchange,
  Ticker,
  OrderBook,
  OHLCV,
  Balance,
  CurrencyBalance,
  OrderRequest,
  Order,
  OrderStatus,
  Trade,
  Position,
  PriceCallback,
} from '../types';
import { createModuleLogger } from '../../utils/logger';

const logger = createModuleLogger('MetaApiExchange');

/**
 * MetaApi configuration
 */
export interface MetaApiConfig {
  /** MetaApi account ID */
  accountId: string;
  /** Use demo account */
  demo?: boolean;
}

/**
 * MetaApi account information
 */
export interface MetaApiAccountInfo {
  platform: 'mt4' | 'mt5';
  broker: string;
  balance: number;
  equity: number;
  margin: number;
  freeMargin: number;
  leverage: number;
  currency: string;
  server: string;
  connected: boolean;
}

/**
 * MetaApi position data
 */
interface MetaApiPosition {
  id: string;
  symbol: string;
  type: 'POSITION_TYPE_BUY' | 'POSITION_TYPE_SELL';
  volume: number;
  openPrice: number;
  currentPrice: number;
  profit: number;
  swap: number;
  commission: number;
  stopLoss?: number;
  takeProfit?: number;
  openTime: string;
}

/**
 * MetaApi order data
 */
interface MetaApiOrder {
  id: string;
  symbol: string;
  type: string;
  volume: number;
  openPrice?: number;
  currentPrice?: number;
  state: string;
  openTime: string;
  doneTime?: string;
  stopLoss?: number;
  takeProfit?: number;
}

/**
 * MetaApi exchange implementation
 */
export class MetaApiExchange extends EventEmitter implements IExchange {
  readonly id: ExchangeId = 'metaapi';
  readonly name: string = 'MetaApi (MT4/MT5)';

  private config: MetaApiConfig;
  private apiToken: string | null = null;
  private _status: ConnectionStatus = 'disconnected';
  private accountInfo: MetaApiAccountInfo | null = null;
  private symbols: symbol[] = [];
  private priceSubscriptions: Map<symbol, NodeJS.Timeout> = new Map();
  private baseUrl = 'https://mt-client-api-v1.agiliumtrade.agiliumtrade.ai';

  constructor(config: MetaApiConfig) {
    super();
    this.config = config;
    logger.info('MetaApiExchange initialized', { accountId: config.accountId, demo: config.demo });
  }

  get status(): ConnectionStatus {
    return this._status;
  }

  /**
   * Connect to MetaApi
   */
  async connect(credentials: ExchangeCredentials): Promise<void> {
    if (this._status === 'connected') {
      return;
    }

    this._status = 'connecting';
    logger.info('Connecting to MetaApi');

    try {
      this.apiToken = credentials.apiKey;

      // Fetch account information
      await this.fetchAccountInfo();

      // Fetch available symbols
      await this.fetchSymbols();

      this._status = 'connected';
      logger.info('Connected to MetaApi', {
        platform: this.accountInfo?.platform,
        broker: this.accountInfo?.broker,
        symbols: this.symbols.length,
      });
      this.emit('exchange:connected', { exchange: this.id });
    } catch (error) {
      this._status = 'error';
      const err = error as Error;
      logger.error('Failed to connect to MetaApi', { error: err.message });
      this.emit('exchange:disconnected', { exchange: this.id, error: err });
      throw error;
    }
  }

  /**
   * Disconnect from MetaApi
   */
  async disconnect(): Promise<void> {
    for (const interval of this.priceSubscriptions.values()) {
      clearInterval(interval);
    }
    this.priceSubscriptions.clear();

    this.apiToken = null;
    this._status = 'disconnected';
    logger.info('Disconnected from MetaApi');
    this.emit('exchange:disconnected', { exchange: this.id });
  }

  isConnected(): boolean {
    return this._status === 'connected' && this.apiToken !== null;
  }

  /**
   * Make authenticated API request
   */
  private async apiRequest<T>(
    endpoint: string,
    method: 'GET' | 'POST' | 'DELETE' = 'GET',
    body?: unknown
  ): Promise<T> {
    if (!this.apiToken) {
      throw new Error('Not authenticated');
    }

    const url = `${this.baseUrl}/users/current/accounts/${this.config.accountId}${endpoint}`;

    const response = await fetch(url, {
      method,
      headers: {
        'auth-token': this.apiToken,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`MetaApi request failed: ${response.status} - ${error}`);
    }

    return response.json();
  }

  /**
   * Fetch account information
   */
  private async fetchAccountInfo(): Promise<void> {
    const data = await this.apiRequest<Record<string, unknown>>('/account-information');

    this.accountInfo = {
      platform: (data.platform as 'mt4' | 'mt5') || 'mt4',
      broker: (data.broker as string) || '',
      balance: (data.balance as number) || 0,
      equity: (data.equity as number) || 0,
      margin: (data.margin as number) || 0,
      freeMargin: (data.freeMargin as number) || 0,
      leverage: (data.leverage as number) || 100,
      currency: (data.currency as string) || 'USD',
      server: (data.server as string) || '',
      connected: true,
    };

    logger.debug('Account info fetched', this.accountInfo);
  }

  /**
   * Fetch available symbols
   */
  private async fetchSymbols(): Promise<void> {
    try {
      const data = await this.apiRequest<{ symbol: string }[]>('/symbols');
      this.symbols = data.map((s) => s.symbol);
    } catch {
      // If symbols endpoint fails, use common forex pairs
      this.symbols = [
        'EURUSD',
        'GBPUSD',
        'USDJPY',
        'USDCHF',
        'AUDUSD',
        'USDCAD',
        'NZDUSD',
        'EURGBP',
        'EURJPY',
        'GBPJPY',
        'XAUUSD',
        'XAGUSD',
      ];
    }
  }

  /**
   * Fetch ticker for a symbol
   */
  async fetchTicker(symbol: symbol): Promise<Ticker> {
    const data = await this.apiRequest<{
      symbol: string;
      bid: number;
      ask: number;
      time: string;
    }>(`/symbols/${symbol}/current-price`);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _spread = new Decimal(data.ask).minus(data.bid);
    const mid = new Decimal(data.bid).plus(data.ask).dividedBy(2);

    return {
      symbol,
      timestamp: new Date(data.time).getTime(),
      datetime: data.time,
      bid: new Decimal(data.bid),
      ask: new Decimal(data.ask),
      last: mid,
      high: mid, // Not available in tick data
      low: mid,
      volume: new Decimal(0),
      change: new Decimal(0),
      percentage: new Decimal(0),
    };
  }

  /**
   * Fetch tickers for multiple symbols
   */
  async fetchTickers(symbols?: symbol[]): Promise<Map<string, Ticker>> {
    const result = new Map<string, Ticker>();
    const symbolList = symbols || this.symbols.slice(0, 10);

    for (const symbol of symbolList) {
      try {
        const ticker = await this.fetchTicker(symbol);
        result.set(symbol, ticker);
      } catch (error) {
        logger.warn(`Failed to fetch ticker for ${symbol}`);
      }
    }

    return result;
  }

  /**
   * Fetch order book (bid/ask only for forex)
   */
  async fetchOrderBook(symbol: symbol, _limit?: number): Promise<OrderBook> {
    const ticker = await this.fetchTicker(symbol);

    return {
      symbol,
      timestamp: ticker.timestamp,
      bids: [{ price: ticker.bid, amount: new Decimal(0) }],
      asks: [{ price: ticker.ask, amount: new Decimal(0) }],
    };
  }

  /**
   * Fetch OHLCV data
   */
  async fetchOHLCV(
    symbol: symbol,
    timeframe: string = '1h',
    since?: number,
    limit?: number
  ): Promise<OHLCV[]> {
    const tf = this.convertTimeframe(timeframe);
    const startTime = since ? new Date(since).toISOString() : undefined;

    let endpoint = `/historical-market-data/symbols/${symbol}/timeframes/${tf}/candles`;
    const params: string[] = [];

    if (startTime) params.push(`startTime=${startTime}`);
    if (limit) params.push(`limit=${limit}`);

    if (params.length > 0) {
      endpoint += `?${params.join('&')}`;
    }

    const data = await this.apiRequest<
      {
        time: string;
        open: number;
        high: number;
        low: number;
        close: number;
        tickVolume: number;
      }[]
    >(endpoint);

    return data.map((c) => ({
      timestamp: new Date(c.time).getTime(),
      open: new Decimal(c.open),
      high: new Decimal(c.high),
      low: new Decimal(c.low),
      close: new Decimal(c.close),
      volume: new Decimal(c.tickVolume),
    }));
  }

  /**
   * Convert timeframe to MetaApi format
   */
  private convertTimeframe(tf: string): string {
    const mapping: Record<string, string> = {
      '1m': '1m',
      '5m': '5m',
      '15m': '15m',
      '30m': '30m',
      '1h': '1h',
      '4h': '4h',
      '1d': '1d',
      '1w': '1w',
      '1M': '1mn',
    };
    return mapping[tf] || '1h';
  }

  /**
   * Subscribe to price updates
   */
  subscribePrice(symbol: symbol, callback: PriceCallback): () => void {
    const pollInterval = 1000; // 1 second for forex

    const interval = setInterval(async () => {
      try {
        const ticker = await this.fetchTicker(symbol);
        callback(ticker);
        this.emit('ticker:update', ticker);
      } catch (error) {
        logger.error('Price subscription error', { symbol, error });
      }
    }, pollInterval);

    this.priceSubscriptions.set(symbol, interval);

    return () => {
      clearInterval(interval);
      this.priceSubscriptions.delete(symbol);
    };
  }

  /**
   * Fetch account balance
   */
  async fetchBalance(): Promise<Balance> {
    await this.fetchAccountInfo();

    const currencies = new Map<string, CurrencyBalance>();
    const currency = this.accountInfo?.currency || 'USD';

    currencies.set(currency, {
      currency,
      total: new Decimal(this.accountInfo?.equity || 0),
      free: new Decimal(this.accountInfo?.freeMargin || 0),
      used: new Decimal(this.accountInfo?.margin || 0),
    });

    return {
      exchange: this.id,
      timestamp: Date.now(),
      currencies,
      get: (cur: string) => currencies.get(cur),
      totalUsdValue: new Decimal(this.accountInfo?.equity || 0),
    };
  }

  /**
   * Create a trade order
   */
  async createOrder(order: OrderRequest): Promise<Order> {
    logger.info('Creating MetaApi order', {
      symbol: order.symbol,
      side: order.side,
      type: order.type,
      amount: order.amount.toString(),
    });

    const volume =
      typeof order.amount === 'number' ? order.amount : parseFloat(order.amount.toString());

    const tradeRequest: Record<string, unknown> = {
      actionType: order.type === 'market' ? 'ORDER_TYPE_BUY' : 'ORDER_TYPE_BUY_LIMIT',
      symbol: order.symbol,
      volume: volume,
    };

    // Set order type based on side and type
    if (order.side === 'buy') {
      tradeRequest.actionType = order.type === 'market' ? 'ORDER_TYPE_BUY' : 'ORDER_TYPE_BUY_LIMIT';
    } else {
      tradeRequest.actionType =
        order.type === 'market' ? 'ORDER_TYPE_SELL' : 'ORDER_TYPE_SELL_LIMIT';
    }

    if (order.price) {
      tradeRequest.openPrice =
        typeof order.price === 'number' ? order.price : parseFloat(order.price.toString());
    }

    if (order.stopPrice) {
      tradeRequest.stopLoss =
        typeof order.stopPrice === 'number'
          ? order.stopPrice
          : parseFloat(order.stopPrice.toString());
    }

    const response = await this.apiRequest<{
      orderId: string;
      positionId?: string;
    }>('/trade', 'POST', tradeRequest);

    const result: Order = {
      id: response.orderId || response.positionId || `meta-${Date.now()}`,
      exchange: this.id,
      symbol: order.symbol,
      side: order.side,
      type: order.type,
      status: 'open',
      amount: new Decimal(order.amount.toString()),
      filled: new Decimal(0),
      remaining: new Decimal(order.amount.toString()),
      price: order.price ? new Decimal(order.price.toString()) : undefined,
      cost: new Decimal(0),
      timestamp: Date.now(),
      datetime: new Date().toISOString(),
    };

    this.emit('order:created', result);
    logger.info('Order created', { orderId: result.id });

    return result;
  }

  /**
   * Cancel an order
   */
  async cancelOrder(orderId: string, _symbol?: symbol): Promise<Order> {
    await this.apiRequest(`/orders/${orderId}`, 'DELETE');

    const result: Order = {
      id: orderId,
      exchange: this.id,
      symbol: '',
      side: 'buy',
      type: 'market',
      status: 'canceled',
      amount: new Decimal(0),
      filled: new Decimal(0),
      remaining: new Decimal(0),
      cost: new Decimal(0),
      timestamp: Date.now(),
      datetime: new Date().toISOString(),
    };

    this.emit('order:canceled', result);
    logger.info('Order canceled', { orderId });

    return result;
  }

  /**
   * Fetch a specific order
   */
  async fetchOrder(orderId: string, _symbol?: symbol): Promise<Order> {
    const data = await this.apiRequest<MetaApiOrder>(`/orders/${orderId}`);
    return this.convertMetaApiOrder(data);
  }

  /**
   * Fetch open orders
   */
  async fetchOpenOrders(_symbol?: symbol): Promise<Order[]> {
    const data = await this.apiRequest<MetaApiOrder[]>('/orders');
    return data
      .filter((o) => o.state === 'ORDER_STATE_PLACED' || o.state === 'ORDER_STATE_STARTED')
      .map((o) => this.convertMetaApiOrder(o));
  }

  /**
   * Fetch closed orders
   */
  async fetchClosedOrders(_symbol?: symbol, _since?: number, _limit?: number): Promise<Order[]> {
    const data = await this.apiRequest<MetaApiOrder[]>('/history-orders');
    return data.map((o) => this.convertMetaApiOrder(o));
  }

  /**
   * Fetch positions
   */
  async fetchPositions(_symbols?: symbol[]): Promise<Position[]> {
    const data = await this.apiRequest<MetaApiPosition[]>('/positions');

    return data.map((p) => ({
      id: p.id,
      exchange: this.id,
      symbol: p.symbol,
      side: p.type === 'POSITION_TYPE_BUY' ? ('long' as const) : ('short' as const),
      contracts: new Decimal(p.volume),
      entryPrice: new Decimal(p.openPrice),
      markPrice: new Decimal(p.currentPrice),
      unrealizedPnl: new Decimal(p.profit),
      timestamp: new Date(p.openTime).getTime(),
      info: {
        swap: p.swap,
        commission: p.commission,
        stopLoss: p.stopLoss,
        takeProfit: p.takeProfit,
      },
    }));
  }

  /**
   * Close a position
   */
  async closePosition(positionId: string): Promise<void> {
    await this.apiRequest(`/positions/${positionId}`, 'DELETE');
    logger.info('Position closed', { positionId });
  }

  /**
   * Fetch my trades
   */
  async fetchMyTrades(_symbol?: symbol, _since?: number, _limit?: number): Promise<Trade[]> {
    const data = await this.apiRequest<MetaApiOrder[]>('/history-deals');

    return data.map((d) => ({
      id: d.id,
      orderId: d.id,
      exchange: this.id,
      symbol: d.symbol,
      side: d.type.includes('BUY') ? ('buy' as const) : ('sell' as const),
      type: d.type.includes('MARKET') ? ('market' as const) : ('limit' as const),
      amount: new Decimal(d.volume),
      price: new Decimal(d.openPrice || 0),
      cost: new Decimal(d.volume).times(d.openPrice || 0),
      timestamp: new Date(d.openTime).getTime(),
      datetime: d.openTime,
    }));
  }

  /**
   * Fetch markets
   */
  async fetchMarkets(): Promise<unknown[]> {
    return this.symbols.map((s) => ({ symbol: s }));
  }

  /**
   * Get symbols
   */
  getSymbols(): symbol[] {
    return this.symbols;
  }

  /**
   * Get account info
   */
  getAccountInfo(): MetaApiAccountInfo | null {
    return this.accountInfo;
  }

  /**
   * Convert MetaApi order to our Order type
   */
  private convertMetaApiOrder(data: MetaApiOrder): Order {
    const statusMap: Record<string, OrderStatus> = {
      ORDER_STATE_PLACED: 'open',
      ORDER_STATE_STARTED: 'open',
      ORDER_STATE_FILLED: 'closed',
      ORDER_STATE_CANCELED: 'canceled',
      ORDER_STATE_REJECTED: 'rejected',
      ORDER_STATE_EXPIRED: 'expired',
    };

    return {
      id: data.id,
      exchange: this.id,
      symbol: data.symbol,
      side: data.type.includes('BUY') ? 'buy' : 'sell',
      type: data.type.includes('MARKET') ? 'market' : 'limit',
      status: statusMap[data.state] || 'open',
      amount: new Decimal(data.volume),
      filled: data.state === 'ORDER_STATE_FILLED' ? new Decimal(data.volume) : new Decimal(0),
      remaining: data.state === 'ORDER_STATE_FILLED' ? new Decimal(0) : new Decimal(data.volume),
      price: data.openPrice ? new Decimal(data.openPrice) : undefined,
      cost: new Decimal(0),
      timestamp: new Date(data.openTime).getTime(),
      datetime: data.openTime,
    };
  }
}

/**
 * Create a MetaApi exchange instance
 */
export function createMetaApiExchange(config: MetaApiConfig): MetaApiExchange {
  return new MetaApiExchange(config);
}

export default MetaApiExchange;
