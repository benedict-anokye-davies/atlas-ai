/**
 * Atlas Trading - Charles Schwab Exchange
 *
 * Charles Schwab API integration for stock trading.
 * Uses OAuth 2.0 for authentication.
 *
 * Note: Schwab replaced TD Ameritrade in 2024.
 *
 * @module trading/exchanges/schwab
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

const logger = createModuleLogger('SchwabExchange');

/**
 * Schwab OAuth tokens
 */
export interface SchwabTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

/**
 * Schwab exchange configuration
 */
export interface SchwabConfig {
  /** OAuth client ID */
  clientId: string;
  /** OAuth client secret */
  clientSecret: string;
  /** OAuth redirect URI */
  redirectUri: string;
  /** Use paper trading */
  paper?: boolean;
}

/**
 * Schwab account info
 */
export interface SchwabAccount {
  accountNumber: string;
  accountType: string;
  isDayTrader: boolean;
  roundTrips: number;
}

/**
 * Schwab API endpoints
 */
const SCHWAB_API = {
  auth: 'https://api.schwabapi.com/v1/oauth/authorize',
  token: 'https://api.schwabapi.com/v1/oauth/token',
  accounts: 'https://api.schwabapi.com/trader/v1/accounts',
  orders: 'https://api.schwabapi.com/trader/v1/accounts/{accountNumber}/orders',
  quotes: 'https://api.schwabapi.com/marketdata/v1/quotes',
  priceHistory: 'https://api.schwabapi.com/marketdata/v1/pricehistory',
  chains: 'https://api.schwabapi.com/marketdata/v1/chains',
};

/**
 * Charles Schwab exchange implementation
 */
export class SchwabExchange extends EventEmitter implements IExchange {
  readonly id: ExchangeId = 'schwab';
  readonly name: string = 'Charles Schwab';

  private config: SchwabConfig;
  private tokens: SchwabTokens | null = null;
  private _status: ConnectionStatus = 'disconnected';
  private accounts: SchwabAccount[] = [];
  private primaryAccount: string | null = null;
  private symbols: symbol[] = [];
  private priceSubscriptions: Map<symbol, NodeJS.Timeout> = new Map();

  constructor(config: SchwabConfig) {
    super();
    this.config = config;
    logger.info('SchwabExchange initialized', { paper: config.paper });
  }

  get status(): ConnectionStatus {
    return this._status;
  }

  /**
   * Generate OAuth authorization URL
   */
  getAuthorizationUrl(): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: 'code',
      scope: 'api',
    });
    return `${SCHWAB_API.auth}?${params.toString()}`;
  }

  /**
   * Exchange authorization code for tokens
   */
  async exchangeCode(code: string): Promise<SchwabTokens> {
    try {
      const response = await fetch(SCHWAB_API.token, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString('base64')}`,
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: this.config.redirectUri,
        }),
      });

      if (!response.ok) {
        throw new Error(`Token exchange failed: ${response.status}`);
      }

      const data = await response.json();

      this.tokens = {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: Date.now() + data.expires_in * 1000,
      };

      logger.info('OAuth tokens obtained');
      return this.tokens;
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to exchange code for tokens', { error: err.message });
      throw error;
    }
  }

  /**
   * Refresh access token
   */
  async refreshTokens(): Promise<void> {
    if (!this.tokens?.refreshToken) {
      throw new Error('No refresh token available');
    }

    try {
      const response = await fetch(SCHWAB_API.token, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString('base64')}`,
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: this.tokens.refreshToken,
        }),
      });

      if (!response.ok) {
        throw new Error(`Token refresh failed: ${response.status}`);
      }

      const data = await response.json();

      this.tokens = {
        accessToken: data.access_token,
        refreshToken: data.refresh_token || this.tokens.refreshToken,
        expiresAt: Date.now() + data.expires_in * 1000,
      };

      logger.info('OAuth tokens refreshed');
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to refresh tokens', { error: err.message });
      throw error;
    }
  }

  /**
   * Make authenticated API request
   */
  private async apiRequest<T>(url: string, options: RequestInit = {}): Promise<T> {
    if (!this.tokens?.accessToken) {
      throw new Error('Not authenticated');
    }

    // Check if token needs refresh (5 min buffer)
    if (this.tokens.expiresAt - Date.now() < 5 * 60 * 1000) {
      await this.refreshTokens();
    }

    const response = await fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Bearer ${this.tokens.accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API request failed: ${response.status} - ${error}`);
    }

    return response.json();
  }

  /**
   * Connect with pre-existing tokens
   */
  async connect(credentials: ExchangeCredentials): Promise<void> {
    if (this._status === 'connected') {
      return;
    }

    this._status = 'connecting';
    logger.info('Connecting to Schwab');

    try {
      // If credentials contain tokens, use them
      if (credentials.extra?.accessToken && credentials.extra?.refreshToken) {
        this.tokens = {
          accessToken: credentials.extra.accessToken,
          refreshToken: credentials.extra.refreshToken,
          expiresAt: parseInt(credentials.extra.expiresAt || '0', 10),
        };
      } else {
        throw new Error(
          'Schwab requires OAuth tokens. Use getAuthorizationUrl() and exchangeCode() first.'
        );
      }

      // Fetch accounts
      await this.fetchAccounts();

      this._status = 'connected';
      logger.info('Connected to Schwab', { accounts: this.accounts.length });
      this.emit('exchange:connected', { exchange: this.id });
    } catch (error) {
      this._status = 'error';
      const err = error as Error;
      logger.error('Failed to connect to Schwab', { error: err.message });
      this.emit('exchange:disconnected', { exchange: this.id, error: err });
      throw error;
    }
  }

  /**
   * Disconnect from exchange
   */
  async disconnect(): Promise<void> {
    for (const [, interval] of this.priceSubscriptions) {
      clearInterval(interval);
    }
    this.priceSubscriptions.clear();

    this.tokens = null;
    this._status = 'disconnected';
    logger.info('Disconnected from Schwab');
    this.emit('exchange:disconnected', { exchange: this.id });
  }

  isConnected(): boolean {
    return this._status === 'connected' && this.tokens !== null;
  }

  /**
   * Fetch user accounts
   */
  private async fetchAccounts(): Promise<void> {
    const data = await this.apiRequest<{ securitiesAccount: SchwabAccount }[]>(SCHWAB_API.accounts);

    this.accounts = data.map((a) => a.securitiesAccount);
    if (this.accounts.length > 0) {
      this.primaryAccount = this.accounts[0].accountNumber;
    }

    logger.info('Fetched accounts', { count: this.accounts.length });
  }

  /**
   * Set primary account for trading
   */
  setPrimaryAccount(accountNumber: string): void {
    const account = this.accounts.find((a) => a.accountNumber === accountNumber);
    if (!account) {
      throw new Error(`Account ${accountNumber} not found`);
    }
    this.primaryAccount = accountNumber;
    logger.info('Primary account set', { accountNumber });
  }

  /**
   * Fetch ticker for a symbol
   */
  async fetchTicker(symbol: symbol): Promise<Ticker> {
    const data = await this.apiRequest<Record<string, unknown>>(
      `${SCHWAB_API.quotes}?symbols=${encodeURIComponent(symbol)}`
    );

    const quote = data[symbol] as Record<string, unknown>;
    if (!quote) {
      throw new Error(`No quote found for ${symbol}`);
    }

    return {
      symbol,
      timestamp: Date.now(),
      datetime: new Date().toISOString(),
      bid: new Decimal((quote.bidPrice as number) || 0),
      ask: new Decimal((quote.askPrice as number) || 0),
      last: new Decimal((quote.lastPrice as number) || 0),
      high: new Decimal((quote.highPrice as number) || 0),
      low: new Decimal((quote.lowPrice as number) || 0),
      volume: new Decimal((quote.totalVolume as number) || 0),
      change: new Decimal((quote.netChange as number) || 0),
      percentage: new Decimal((quote.netPercentChange as number) || 0),
    };
  }

  /**
   * Fetch tickers for multiple symbols
   */
  async fetchTickers(symbols?: symbol[]): Promise<Map<string, Ticker>> {
    if (!symbols || symbols.length === 0) {
      return new Map();
    }

    const data = await this.apiRequest<Record<string, unknown>>(
      `${SCHWAB_API.quotes}?symbols=${symbols.map(encodeURIComponent).join(',')}`
    );

    const result = new Map<string, Ticker>();
    for (const symbol of symbols) {
      const quote = data[symbol] as Record<string, unknown>;
      if (quote) {
        result.set(symbol, {
          symbol,
          timestamp: Date.now(),
          datetime: new Date().toISOString(),
          bid: new Decimal((quote.bidPrice as number) || 0),
          ask: new Decimal((quote.askPrice as number) || 0),
          last: new Decimal((quote.lastPrice as number) || 0),
          high: new Decimal((quote.highPrice as number) || 0),
          low: new Decimal((quote.lowPrice as number) || 0),
          volume: new Decimal((quote.totalVolume as number) || 0),
          change: new Decimal((quote.netChange as number) || 0),
          percentage: new Decimal((quote.netPercentChange as number) || 0),
        });
      }
    }

    return result;
  }

  /**
   * Fetch order book (limited for stocks)
   */
  async fetchOrderBook(symbol: symbol, _limit?: number): Promise<OrderBook> {
    // Schwab doesn't provide full order book, just best bid/ask
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
    _timeframe: string = '1d',
    since?: number,
    limit?: number
  ): Promise<OHLCV[]> {
    const params = new URLSearchParams({
      symbol,
      periodType: 'month',
      period: '1',
      frequencyType: 'daily',
      frequency: '1',
    });

    if (since) {
      params.set('startDate', since.toString());
    }

    const data = await this.apiRequest<{ candles: unknown[] }>(
      `${SCHWAB_API.priceHistory}?${params.toString()}`
    );

    const candles = data.candles || [];
    return candles.slice(0, limit).map((c: unknown) => {
      const candle = c as Record<string, number>;
      return {
        timestamp: candle.datetime,
        open: new Decimal(candle.open),
        high: new Decimal(candle.high),
        low: new Decimal(candle.low),
        close: new Decimal(candle.close),
        volume: new Decimal(candle.volume),
      };
    });
  }

  /**
   * Subscribe to price updates
   */
  subscribePrice(symbol: symbol, callback: PriceCallback): () => void {
    const pollInterval = 5000; // 5 seconds for stocks

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
    if (!this.primaryAccount) {
      throw new Error('No primary account set');
    }

    const data = await this.apiRequest<{ securitiesAccount: unknown }>(
      `${SCHWAB_API.accounts}/${this.primaryAccount}`
    );

    const account = data.securitiesAccount as Record<string, unknown>;
    const balances = (account.currentBalances as Record<string, number>) || {};

    const currencies = new Map<string, CurrencyBalance>();
    currencies.set('USD', {
      currency: 'USD',
      total: new Decimal(balances.liquidationValue || 0),
      free: new Decimal(balances.cashBalance || 0),
      used: new Decimal(balances.longMarketValue || 0),
    });

    return {
      exchange: this.id,
      timestamp: Date.now(),
      currencies,
      get: (currency: string) => currencies.get(currency),
      totalUsdValue: new Decimal(balances.liquidationValue || 0),
    };
  }

  /**
   * Create an order
   */
  async createOrder(order: OrderRequest): Promise<Order> {
    if (!this.primaryAccount) {
      throw new Error('No primary account set');
    }

    logger.info('Creating Schwab order', {
      symbol: order.symbol,
      side: order.side,
      type: order.type,
      amount: order.amount.toString(),
    });

    const schwabOrder = {
      orderType: order.type.toUpperCase(),
      session: 'NORMAL',
      duration: 'DAY',
      orderStrategyType: 'SINGLE',
      orderLegCollection: [
        {
          instruction: order.side === 'buy' ? 'BUY' : 'SELL',
          quantity:
            typeof order.amount === 'number' ? order.amount : parseFloat(order.amount.toString()),
          instrument: {
            symbol: order.symbol,
            assetType: 'EQUITY',
          },
        },
      ],
    };

    if (order.type === 'limit' && order.price) {
      (schwabOrder as Record<string, unknown>).price =
        typeof order.price === 'number' ? order.price : parseFloat(order.price.toString());
    }

    const response = await fetch(
      SCHWAB_API.orders.replace('{accountNumber}', this.primaryAccount),
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.tokens!.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(schwabOrder),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Order creation failed: ${response.status} - ${error}`);
    }

    // Get order ID from Location header
    const location = response.headers.get('Location');
    const orderId = location?.split('/').pop() || `schwab-${Date.now()}`;

    const result: Order = {
      id: orderId,
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
    logger.info('Order created', { orderId });

    return result;
  }

  /**
   * Cancel an order
   */
  async cancelOrder(orderId: string, _symbol?: symbol): Promise<Order> {
    if (!this.primaryAccount) {
      throw new Error('No primary account set');
    }

    const response = await fetch(
      `${SCHWAB_API.orders.replace('{accountNumber}', this.primaryAccount)}/${orderId}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${this.tokens!.accessToken}`,
        },
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Order cancellation failed: ${response.status} - ${error}`);
    }

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
    if (!this.primaryAccount) {
      throw new Error('No primary account set');
    }

    const data = await this.apiRequest<Record<string, unknown>>(
      `${SCHWAB_API.orders.replace('{accountNumber}', this.primaryAccount)}/${orderId}`
    );

    return this.convertSchwabOrder(data);
  }

  /**
   * Fetch open orders
   */
  async fetchOpenOrders(_symbol?: symbol): Promise<Order[]> {
    if (!this.primaryAccount) {
      throw new Error('No primary account set');
    }

    const data = await this.apiRequest<unknown[]>(
      `${SCHWAB_API.orders.replace('{accountNumber}', this.primaryAccount)}?status=WORKING`
    );

    return (data || []).map((o) => this.convertSchwabOrder(o as Record<string, unknown>));
  }

  /**
   * Fetch closed orders
   */
  async fetchClosedOrders(_symbol?: symbol, _since?: number, _limit?: number): Promise<Order[]> {
    if (!this.primaryAccount) {
      throw new Error('No primary account set');
    }

    const data = await this.apiRequest<unknown[]>(
      `${SCHWAB_API.orders.replace('{accountNumber}', this.primaryAccount)}?status=FILLED`
    );

    return (data || []).map((o) => this.convertSchwabOrder(o as Record<string, unknown>));
  }

  /**
   * Fetch positions
   */
  async fetchPositions(_symbols?: symbol[]): Promise<Position[]> {
    if (!this.primaryAccount) {
      throw new Error('No primary account set');
    }

    const data = await this.apiRequest<{ securitiesAccount: unknown }>(
      `${SCHWAB_API.accounts}/${this.primaryAccount}?fields=positions`
    );

    const account = data.securitiesAccount as Record<string, unknown>;
    const positions = (account.positions as unknown[]) || [];

    return positions.map((p: unknown) => {
      const pos = p as Record<string, unknown>;
      const instrument = pos.instrument as Record<string, unknown>;

      return {
        exchange: this.id,
        symbol: instrument.symbol as string,
        side: 'long' as const,
        contracts: new Decimal((pos.longQuantity as number) || 0),
        entryPrice: new Decimal((pos.averagePrice as number) || 0),
        markPrice: new Decimal((pos.currentDayProfitLoss as number) || 0),
        unrealizedPnl: new Decimal((pos.currentDayProfitLoss as number) || 0),
        timestamp: Date.now(),
      };
    });
  }

  /**
   * Fetch my trades
   */
  async fetchMyTrades(_symbol?: symbol, _since?: number, _limit?: number): Promise<Trade[]> {
    // Schwab doesn't have a direct trades endpoint
    // Would need to parse from order executions
    logger.warn('fetchMyTrades not fully implemented for Schwab');
    return [];
  }

  /**
   * Fetch markets
   */
  async fetchMarkets(): Promise<unknown[]> {
    // Schwab doesn't have a markets endpoint
    // Would need to use instrument search
    return [];
  }

  /**
   * Get symbols
   */
  getSymbols(): symbol[] {
    return this.symbols;
  }

  /**
   * Convert Schwab order to our Order type
   */
  private convertSchwabOrder(data: Record<string, unknown>): Order {
    const legs = (data.orderLegCollection as unknown[]) || [];
    const leg = (legs[0] as Record<string, unknown>) || {};
    const instrument = (leg.instrument as Record<string, unknown>) || {};

    const statusMap: Record<string, OrderStatus> = {
      WORKING: 'open',
      FILLED: 'closed',
      CANCELED: 'canceled',
      EXPIRED: 'expired',
      REJECTED: 'rejected',
    };

    return {
      id: data.orderId as string,
      exchange: this.id,
      symbol: (instrument.symbol as string) || '',
      side: (leg.instruction as string)?.toLowerCase() === 'buy' ? 'buy' : 'sell',
      type: ((data.orderType as string)?.toLowerCase() as OrderType) || 'market',
      status: statusMap[data.status as string] || 'open',
      amount: new Decimal((leg.quantity as number) || 0),
      filled: new Decimal((data.filledQuantity as number) || 0),
      remaining: new Decimal((data.remainingQuantity as number) || 0),
      price: data.price ? new Decimal(data.price as number) : undefined,
      average: data.filledPrice ? new Decimal(data.filledPrice as number) : undefined,
      cost: new Decimal(0),
      timestamp: new Date((data.enteredTime as string) || Date.now()).getTime(),
      datetime: (data.enteredTime as string) || new Date().toISOString(),
    };
  }

  /**
   * Get accounts
   */
  getAccounts(): SchwabAccount[] {
    return this.accounts;
  }

  /**
   * Get tokens for storage
   */
  getTokens(): SchwabTokens | null {
    return this.tokens;
  }

  /**
   * Set tokens from storage
   */
  setTokens(tokens: SchwabTokens): void {
    this.tokens = tokens;
  }
}

/**
 * Create a Schwab exchange instance
 */
export function createSchwabExchange(config: SchwabConfig): SchwabExchange {
  return new SchwabExchange(config);
}

export default SchwabExchange;
