/**
 * Atlas Trading - Base Exchange
 *
 * Abstract base class for exchange implementations using CCXT.
 * Provides common functionality for all exchanges.
 *
 * @module trading/exchanges/base
 */

import ccxt from 'ccxt';
import Decimal from 'decimal.js';
import { EventEmitter } from 'events';
import {
  ExchangeId,
  ExchangeConfig,
  ExchangeCredentials,
  ConnectionStatus,
  IExchange,
  TradingSymbol,
  Ticker,
  OrderBook,
  OrderBookLevel,
  OHLCV,
  Balance,
  CurrencyBalance,
  OrderRequest,
  Order,
  OrderSide,
  OrderType,
  OrderStatus,
  Trade,
  Position,
  PriceCallback,
} from '../types';
import { createModuleLogger } from '../../utils/logger';

const logger = createModuleLogger('BaseExchange');

// CCXT Exchange type
type CCXTExchange = InstanceType<typeof ccxt.Exchange>;

// Configure Decimal.js for financial calculations
Decimal.set({
  precision: 20,
  rounding: Decimal.ROUND_DOWN,
  toExpNeg: -18,
  toExpPos: 18,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CCXTTicker = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CCXTOrder = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CCXTTrade = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CCXTMarket = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CCXTPosition = any;

/**
 * Convert CCXT ticker to our Ticker type
 */
function convertTicker(ccxtTicker: CCXTTicker, _exchangeId: ExchangeId): Ticker {
  return {
    symbol: ccxtTicker.symbol,
    timestamp: ccxtTicker.timestamp || Date.now(),
    datetime: ccxtTicker.datetime || new Date().toISOString(),
    bid: new Decimal(ccxtTicker.bid ?? 0),
    ask: new Decimal(ccxtTicker.ask ?? 0),
    last: new Decimal(ccxtTicker.last ?? 0),
    high: new Decimal(ccxtTicker.high ?? 0),
    low: new Decimal(ccxtTicker.low ?? 0),
    volume: new Decimal(ccxtTicker.baseVolume ?? 0),
    change: new Decimal(ccxtTicker.change ?? 0),
    percentage: new Decimal(ccxtTicker.percentage ?? 0),
    vwap: ccxtTicker.vwap ? new Decimal(ccxtTicker.vwap) : undefined,
  };
}

/**
 * Convert CCXT order to our Order type
 */
function convertOrder(ccxtOrder: CCXTOrder, exchangeId: ExchangeId): Order {
  return {
    id: ccxtOrder.id,
    clientOrderId: ccxtOrder.clientOrderId || undefined,
    exchange: exchangeId,
    symbol: ccxtOrder.symbol,
    side: ccxtOrder.side as OrderSide,
    type: ccxtOrder.type as OrderType,
    status: ccxtOrder.status as OrderStatus,
    amount: new Decimal(ccxtOrder.amount ?? 0),
    filled: new Decimal(ccxtOrder.filled ?? 0),
    remaining: new Decimal(ccxtOrder.remaining ?? 0),
    price: ccxtOrder.price ? new Decimal(ccxtOrder.price) : undefined,
    stopPrice: ccxtOrder.stopPrice ? new Decimal(ccxtOrder.stopPrice) : undefined,
    average: ccxtOrder.average ? new Decimal(ccxtOrder.average) : undefined,
    cost: new Decimal(ccxtOrder.cost ?? 0),
    fee: ccxtOrder.fee
      ? {
          cost: new Decimal(ccxtOrder.fee.cost ?? 0),
          currency: ccxtOrder.fee.currency ?? '',
          rate: ccxtOrder.fee.rate ? new Decimal(ccxtOrder.fee.rate) : undefined,
        }
      : undefined,
    timestamp: ccxtOrder.timestamp ?? Date.now(),
    datetime: ccxtOrder.datetime ?? new Date().toISOString(),
    lastUpdateTimestamp: ccxtOrder.lastUpdateTimestamp || undefined,
    info: ccxtOrder.info,
  };
}

/**
 * Convert CCXT trade to our Trade type
 */
function convertTrade(ccxtTrade: CCXTTrade, exchangeId: ExchangeId): Trade {
  return {
    id: ccxtTrade.id,
    orderId: ccxtTrade.order || '',
    exchange: exchangeId,
    symbol: ccxtTrade.symbol,
    side: ccxtTrade.side as OrderSide,
    type: (ccxtTrade.type as OrderType) || 'market',
    amount: new Decimal(ccxtTrade.amount ?? 0),
    price: new Decimal(ccxtTrade.price ?? 0),
    cost: new Decimal(ccxtTrade.cost ?? 0),
    fee: ccxtTrade.fee
      ? {
          cost: new Decimal(ccxtTrade.fee.cost ?? 0),
          currency: ccxtTrade.fee.currency ?? '',
          rate: ccxtTrade.fee.rate ? new Decimal(ccxtTrade.fee.rate) : undefined,
        }
      : undefined,
    takerOrMaker: ccxtTrade.takerOrMaker as 'taker' | 'maker' | undefined,
    timestamp: ccxtTrade.timestamp ?? Date.now(),
    datetime: ccxtTrade.datetime ?? new Date().toISOString(),
    info: ccxtTrade.info,
  };
}

/**
 * Convert CCXT position to our Position type
 */
function convertPosition(ccxtPosition: CCXTPosition, exchangeId: ExchangeId): Position {
  return {
    id: ccxtPosition.id,
    exchange: exchangeId,
    symbol: ccxtPosition.symbol,
    side: ccxtPosition.side as 'long' | 'short',
    contracts: new Decimal(ccxtPosition.contracts ?? 0),
    contractSize: ccxtPosition.contractSize ? new Decimal(ccxtPosition.contractSize) : undefined,
    entryPrice: new Decimal(ccxtPosition.entryPrice ?? 0),
    markPrice: ccxtPosition.markPrice ? new Decimal(ccxtPosition.markPrice) : undefined,
    liquidationPrice: ccxtPosition.liquidationPrice ? new Decimal(ccxtPosition.liquidationPrice) : undefined,
    unrealizedPnl: ccxtPosition.unrealizedPnl ? new Decimal(ccxtPosition.unrealizedPnl) : undefined,
    realizedPnl: ccxtPosition.realizedPnl ? new Decimal(ccxtPosition.realizedPnl) : undefined,
    leverage: ccxtPosition.leverage ? new Decimal(ccxtPosition.leverage) : undefined,
    marginMode: ccxtPosition.marginMode,
    notional: ccxtPosition.notional ? new Decimal(ccxtPosition.notional) : undefined,
    timestamp: ccxtPosition.timestamp,
    info: ccxtPosition.info,
  };
}

/**
 * Abstract base class for CCXT-based exchanges
 */
export abstract class BaseExchange extends EventEmitter implements IExchange {
  abstract readonly id: ExchangeId;
  abstract readonly name: string;

  protected exchange: CCXTExchange | null = null;
  protected config: ExchangeConfig;
  protected _status: ConnectionStatus = 'disconnected';
  protected markets: CCXTMarket[] = [];
  protected priceSubscriptions: Map<TradingSymbol, NodeJS.Timeout> = new Map();

  constructor(config: ExchangeConfig) {
    super();
    this.config = config;
  }

  /**
   * Get connection status
   */
  get status(): ConnectionStatus {
    return this._status;
  }

  /**
   * Create the CCXT exchange instance
   */
  protected abstract createExchange(credentials: ExchangeCredentials): CCXTExchange;

  /**
   * Connect to the exchange
   */
  async connect(credentials: ExchangeCredentials): Promise<void> {
    if (this._status === 'connected') {
      logger.warn('Already connected', { exchange: this.id });
      return;
    }

    this._status = 'connecting';
    logger.info('Connecting to exchange', { exchange: this.id, sandbox: this.config.sandbox });

    try {
      this.exchange = this.createExchange(credentials);

      // Enable sandbox/testnet if configured
      if (this.config.sandbox) {
        this.exchange.setSandboxMode(true);
      }

      // Load markets
      await this.exchange.loadMarkets();
      this.markets = Object.values(this.exchange.markets);

      this._status = 'connected';
      logger.info('Connected to exchange', {
        exchange: this.id,
        markets: this.markets.length,
      });

      this.emit('exchange:connected', { exchange: this.id });
    } catch (error) {
      this._status = 'error';
      const err = error as Error;
      logger.error('Failed to connect to exchange', {
        exchange: this.id,
        error: err.message,
      });
      this.emit('exchange:disconnected', { exchange: this.id, error: err });
      throw error;
    }
  }

  /**
   * Disconnect from the exchange
   */
  async disconnect(): Promise<void> {
    // Cancel all price subscriptions
    for (const [symbol, interval] of this.priceSubscriptions) {
      clearInterval(interval);
      logger.debug('Unsubscribed from price updates', { exchange: this.id, symbol });
    }
    this.priceSubscriptions.clear();

    this.exchange = null;
    this._status = 'disconnected';
    logger.info('Disconnected from exchange', { exchange: this.id });
    this.emit('exchange:disconnected', { exchange: this.id });
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this._status === 'connected' && this.exchange !== null;
  }

  /**
   * Ensure exchange is connected
   */
  protected ensureConnected(): void {
    if (!this.isConnected()) {
      throw new Error(`Not connected to ${this.name}`);
    }
  }

  // ===========================================================================
  // Market Data
  // ===========================================================================

  /**
   * Fetch ticker for a symbol
   */
  async fetchTicker(symbol: TradingSymbol): Promise<Ticker> {
    this.ensureConnected();
    const ccxtTicker = await this.exchange!.fetchTicker(symbol);
    return convertTicker(ccxtTicker, this.id);
  }

  /**
   * Fetch tickers for multiple symbols
   */
  async fetchTickers(symbols?: TradingSymbol[]): Promise<Map<string, Ticker>> {
    this.ensureConnected();
    const ccxtTickers = await this.exchange!.fetchTickers(symbols);
    const result = new Map<string, Ticker>();

    for (const [symbol, ticker] of Object.entries(ccxtTickers)) {
      result.set(symbol, convertTicker(ticker, this.id));
    }

    return result;
  }

  /**
   * Fetch order book
   */
  async fetchOrderBook(symbol: TradingSymbol, limit?: number): Promise<OrderBook> {
    this.ensureConnected();
    const book = await this.exchange!.fetchOrderBook(symbol, limit);

    return {
      symbol,
      timestamp: book.timestamp ?? Date.now(),
      bids: book.bids.map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (level: any): OrderBookLevel => ({
          price: new Decimal(level[0] ?? 0),
          amount: new Decimal(level[1] ?? 0),
        })
      ),
      asks: book.asks.map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (level: any): OrderBookLevel => ({
          price: new Decimal(level[0] ?? 0),
          amount: new Decimal(level[1] ?? 0),
        })
      ),
    };
  }

  /**
   * Fetch OHLCV candlestick data
   */
  async fetchOHLCV(
    symbol: TradingSymbol,
    timeframe: string = '1h',
    since?: number,
    limit?: number
  ): Promise<OHLCV[]> {
    this.ensureConnected();
    const candles = await this.exchange!.fetchOHLCV(symbol, timeframe, since, limit);

    return candles.map((c) => ({
      timestamp: c[0] as number,
      open: new Decimal(c[1] as number),
      high: new Decimal(c[2] as number),
      low: new Decimal(c[3] as number),
      close: new Decimal(c[4] as number),
      volume: new Decimal(c[5] as number),
    }));
  }

  /**
   * Subscribe to price updates (polling-based for REST API exchanges)
   * Returns unsubscribe function
   */
  subscribePrice(symbol: TradingSymbol, callback: PriceCallback): () => void {
    this.ensureConnected();

    // Check if already subscribed
    if (this.priceSubscriptions.has(symbol)) {
      logger.warn('Already subscribed to price updates', { exchange: this.id, symbol });
    }

    // Poll every 1 second for price updates
    const pollInterval = 1000;
    let lastPrice: Decimal | null = null;

    const interval = setInterval(async () => {
      try {
        const ticker = await this.fetchTicker(symbol);

        // Only emit if price changed
        if (!lastPrice || !ticker.last.equals(lastPrice)) {
          lastPrice = ticker.last;
          callback(ticker);
          this.emit('ticker:update', ticker);
        }
      } catch (error) {
        const err = error as Error;
        logger.error('Price subscription error', {
          exchange: this.id,
          symbol,
          error: err.message,
        });
      }
    }, pollInterval);

    this.priceSubscriptions.set(symbol, interval);
    logger.debug('Subscribed to price updates', { exchange: this.id, symbol });

    // Return unsubscribe function
    return () => {
      const existingInterval = this.priceSubscriptions.get(symbol);
      if (existingInterval) {
        clearInterval(existingInterval);
        this.priceSubscriptions.delete(symbol);
        logger.debug('Unsubscribed from price updates', { exchange: this.id, symbol });
      }
    };
  }

  // ===========================================================================
  // Balance & Account
  // ===========================================================================

  /**
   * Fetch account balance
   */
  async fetchBalance(): Promise<Balance> {
    this.ensureConnected();
    const ccxtBalance = await this.exchange!.fetchBalance();

    const currencies = new Map<string, CurrencyBalance>();

    for (const [currency, balance] of Object.entries(ccxtBalance)) {
      // Skip non-currency fields
      if (['info', 'free', 'used', 'total', 'timestamp', 'datetime'].includes(currency)) {
        continue;
      }

      const bal = balance as { free?: number; used?: number; total?: number };
      if (bal.total && bal.total > 0) {
        currencies.set(currency, {
          currency,
          total: new Decimal(bal.total ?? 0),
          free: new Decimal(bal.free ?? 0),
          used: new Decimal(bal.used ?? 0),
        });
      }
    }

    return {
      exchange: this.id,
      timestamp: ccxtBalance.timestamp ?? Date.now(),
      currencies,
      get: (currency: string) => currencies.get(currency),
    };
  }

  // ===========================================================================
  // Trading
  // ===========================================================================

  /**
   * Create an order
   */
  async createOrder(order: OrderRequest): Promise<Order> {
    this.ensureConnected();

    logger.info('Creating order', {
      exchange: this.id,
      symbol: order.symbol,
      side: order.side,
      type: order.type,
      amount: order.amount.toString(),
      price: order.price?.toString(),
    });

    const amount =
      typeof order.amount === 'number' ? order.amount : parseFloat(order.amount.toString());
    const price =
      order.price !== undefined
        ? typeof order.price === 'number'
          ? order.price
          : parseFloat(order.price.toString())
        : undefined;

    const params: Record<string, unknown> = {};

    if (order.stopPrice !== undefined) {
      params.stopPrice =
        typeof order.stopPrice === 'number'
          ? order.stopPrice
          : parseFloat(order.stopPrice.toString());
    }

    if (order.timeInForce) {
      params.timeInForce = order.timeInForce;
    }

    if (order.clientOrderId) {
      params.clientOrderId = order.clientOrderId;
    }

    if (order.reduceOnly) {
      params.reduceOnly = order.reduceOnly;
    }

    if (order.postOnly) {
      params.postOnly = order.postOnly;
    }

    const ccxtOrder = await this.exchange!.createOrder(
      order.symbol,
      order.type,
      order.side,
      amount,
      price,
      params
    );

    const result = convertOrder(ccxtOrder, this.id);
    this.emit('order:created', result);
    logger.info('Order created', {
      exchange: this.id,
      orderId: result.id,
      symbol: result.symbol,
    });

    return result;
  }

  /**
   * Cancel an order
   */
  async cancelOrder(orderId: string, symbol?: TradingSymbol): Promise<Order> {
    this.ensureConnected();

    logger.info('Canceling order', { exchange: this.id, orderId, symbol });

    const ccxtOrder = await this.exchange!.cancelOrder(orderId, symbol);
    const result = convertOrder(ccxtOrder, this.id);
    this.emit('order:canceled', result);
    logger.info('Order canceled', { exchange: this.id, orderId });

    return result;
  }

  /**
   * Fetch a specific order
   */
  async fetchOrder(orderId: string, symbol?: TradingSymbol): Promise<Order> {
    this.ensureConnected();
    const ccxtOrder = await this.exchange!.fetchOrder(orderId, symbol);
    return convertOrder(ccxtOrder, this.id);
  }

  /**
   * Fetch open orders
   */
  async fetchOpenOrders(symbol?: TradingSymbol): Promise<Order[]> {
    this.ensureConnected();
    const ccxtOrders = await this.exchange!.fetchOpenOrders(symbol);
    return ccxtOrders.map((o) => convertOrder(o, this.id));
  }

  /**
   * Fetch closed orders
   */
  async fetchClosedOrders(
    symbol?: TradingSymbol,
    since?: number,
    limit?: number
  ): Promise<Order[]> {
    this.ensureConnected();
    const ccxtOrders = await this.exchange!.fetchClosedOrders(symbol, since, limit);
    return ccxtOrders.map((o) => convertOrder(o, this.id));
  }

  /**
   * Fetch my trades
   */
  async fetchMyTrades(symbol?: TradingSymbol, since?: number, limit?: number): Promise<Trade[]> {
    this.ensureConnected();
    const ccxtTrades = await this.exchange!.fetchMyTrades(symbol, since, limit);
    return ccxtTrades.map((t) => convertTrade(t, this.id));
  }

  /**
   * Fetch open positions (for futures/margin trading)
   */
  async fetchPositions(symbol?: TradingSymbol): Promise<Position[]> {
    this.ensureConnected();
    
    // Check if exchange supports fetchPositions
    if (!this.exchange!.has.fetchPositions) {
      logger.debug('Exchange does not support fetchPositions', { exchange: this.id });
      return [];
    }
    
    try {
      const ccxtPositions = await this.exchange!.fetchPositions(symbol ? [symbol] : undefined);
      return ccxtPositions
        .filter((p: CCXTPosition) => p && new Decimal(p.contracts ?? 0).abs().gt(0))
        .map((p: CCXTPosition) => convertPosition(p, this.id));
    } catch (error) {
      logger.warn('Failed to fetch positions', { exchange: this.id, error: (error as Error).message });
      return [];
    }
  }

  // ===========================================================================
  // Market Info
  // ===========================================================================

  /**
   * Fetch available markets
   */
  async fetchMarkets(): Promise<CCXTMarket[]> {
    this.ensureConnected();
    return this.markets;
  }

  /**
   * Get list of trading symbols
   */
  getSymbols(): TradingSymbol[] {
    return this.markets.map((m) => m.symbol);
  }
}
