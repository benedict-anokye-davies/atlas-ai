/**
 * Atlas Trading - Type Definitions
 *
 * Core types for trading infrastructure including exchanges,
 * orders, positions, and portfolio management.
 *
 * @module trading/types
 */

import Decimal from 'decimal.js';

// =============================================================================
// Exchange Types
// =============================================================================

/**
 * Supported exchange identifiers
 */
export type ExchangeId = 'binance' | 'coinbase' | 'schwab' | 'metaapi' | 'bybit' | 'oanda' | 'trading212' | 'alpaca';

/**
 * Exchange connection status
 */
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

/**
 * Exchange configuration
 */
export interface ExchangeConfig {
  /** Exchange identifier */
  id: ExchangeId;
  /** Human-readable name */
  name: string;
  /** Whether to use testnet/sandbox */
  sandbox: boolean;
  /** Rate limit (requests per minute) */
  rateLimit?: number;
  /** Additional options */
  options?: Record<string, unknown>;
}

/**
 * API credentials (stored securely in keychain)
 */
export interface ExchangeCredentials {
  apiKey: string;
  secret: string;
  /** Additional credentials (e.g., password, uid) */
  extra?: Record<string, string>;
}

// =============================================================================
// Market Data Types
// =============================================================================

/**
 * Trading pair symbol (e.g., 'BTC/USDT')
 */
export type TradingSymbol = string;

/**
 * Price ticker data
 */
export interface Ticker {
  symbol: TradingSymbol;
  timestamp: number;
  datetime: string;
  /** Highest bid price */
  bid: Decimal;
  /** Lowest ask price */
  ask: Decimal;
  /** Last trade price */
  last: Decimal;
  /** 24h high */
  high: Decimal;
  /** 24h low */
  low: Decimal;
  /** 24h volume */
  volume: Decimal;
  /** 24h percentage change */
  change: Decimal;
  /** 24h percentage change */
  percentage: Decimal;
  /** Volume-weighted average price */
  vwap?: Decimal;
}

/**
 * OHLCV candlestick data
 */
export interface OHLCV {
  timestamp: number;
  open: Decimal;
  high: Decimal;
  low: Decimal;
  close: Decimal;
  volume: Decimal;
}

/**
 * Order book level
 */
export interface OrderBookLevel {
  price: Decimal;
  amount: Decimal;
}

/**
 * Order book data
 */
export interface OrderBook {
  symbol: TradingSymbol;
  timestamp: number;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
}

/**
 * Price callback for streaming
 */
export type PriceCallback = (ticker: Ticker) => void;

// =============================================================================
// Order Types
// =============================================================================

/**
 * Order side
 */
export type OrderSide = 'buy' | 'sell';

/**
 * Order type
 */
export type OrderType = 'market' | 'limit' | 'stop' | 'stop_limit' | 'trailing_stop';

/**
 * Order status
 */
export type OrderStatus = 'open' | 'closed' | 'canceled' | 'expired' | 'rejected';

/**
 * Time in force options
 */
export type TimeInForce = 'GTC' | 'IOC' | 'FOK' | 'GTD';

/**
 * Order request parameters
 */
export interface OrderRequest {
  symbol: TradingSymbol;
  side: OrderSide;
  type: OrderType;
  /** Amount to buy/sell */
  amount: Decimal | number;
  /** Price (required for limit orders) */
  price?: Decimal | number;
  /** Stop price (for stop orders) */
  stopPrice?: Decimal | number;
  /** Time in force */
  timeInForce?: TimeInForce;
  /** Client order ID */
  clientOrderId?: string;
  /** Reduce only (futures) */
  reduceOnly?: boolean;
  /** Post only (maker only) */
  postOnly?: boolean;
}

/**
 * Order response/details
 */
export interface Order {
  id: string;
  clientOrderId?: string;
  exchange: ExchangeId;
  symbol: TradingSymbol;
  side: OrderSide;
  type: OrderType;
  status: OrderStatus;
  /** Requested amount */
  amount: Decimal;
  /** Filled amount */
  filled: Decimal;
  /** Remaining amount */
  remaining: Decimal;
  /** Limit price */
  price?: Decimal;
  /** Stop price */
  stopPrice?: Decimal;
  /** Average fill price */
  average?: Decimal;
  /** Total cost (filled * average) */
  cost: Decimal;
  /** Trading fees */
  fee?: {
    cost: Decimal;
    currency: string;
    rate?: Decimal;
  };
  /** Order creation timestamp */
  timestamp: number;
  datetime: string;
  /** Last update timestamp */
  lastUpdateTimestamp?: number;
  /** Additional order info */
  info?: Record<string, unknown>;
}

// =============================================================================
// Position Types
// =============================================================================

/**
 * Position side (for futures/margin)
 */
export type PositionSide = 'long' | 'short' | 'both';

/**
 * Trading position
 */
export interface Position {
  id?: string;
  exchange: ExchangeId;
  symbol: TradingSymbol;
  side: PositionSide;
  /** Position size */
  contracts: Decimal;
  /** Contract size */
  contractSize?: Decimal;
  /** Entry/average price */
  entryPrice: Decimal;
  /** Mark price */
  markPrice?: Decimal;
  /** Liquidation price */
  liquidationPrice?: Decimal;
  /** Unrealized P&L */
  unrealizedPnl?: Decimal;
  /** Realized P&L */
  realizedPnl?: Decimal;
  /** Leverage */
  leverage?: Decimal;
  /** Margin mode */
  marginMode?: 'cross' | 'isolated';
  /** Notional value */
  notional?: Decimal;
  /** Timestamp */
  timestamp?: number;
  /** Additional info */
  info?: Record<string, unknown>;
}

// =============================================================================
// Balance Types
// =============================================================================

/**
 * Single currency balance
 */
export interface CurrencyBalance {
  currency: string;
  /** Total balance */
  total: Decimal;
  /** Available for trading */
  free: Decimal;
  /** Reserved (in orders, positions) */
  used: Decimal;
}

/**
 * Account balance
 */
export interface Balance {
  exchange: ExchangeId;
  timestamp: number;
  currencies: Map<string, CurrencyBalance>;
  /** Get balance for specific currency */
  get(currency: string): CurrencyBalance | undefined;
  /** Get total USD value (estimated) */
  totalUsdValue?: Decimal;
}

/**
 * Aggregated balance across exchanges
 */
export interface AggregatedBalance {
  timestamp: number;
  /** Balances by exchange */
  byExchange: Map<ExchangeId, Balance>;
  /** Total by currency across all exchanges */
  byCurrency: Map<string, Decimal>;
  /** Estimated total USD value */
  totalUsdValue: Decimal;
}

// =============================================================================
// Portfolio Types
// =============================================================================

/**
 * Portfolio performance metrics
 */
export interface PerformanceMetrics {
  period: string;
  startValue: Decimal;
  endValue: Decimal;
  absoluteChange: Decimal;
  percentageChange: Decimal;
  highWaterMark: Decimal;
  drawdown: Decimal;
  maxDrawdown: Decimal;
  sharpeRatio?: Decimal;
  sortinoRatio?: Decimal;
  winRate?: Decimal;
  profitFactor?: Decimal;
}

/**
 * P&L report
 */
export interface PnLReport {
  exchange?: ExchangeId;
  period: string;
  realized: Decimal;
  unrealized: Decimal;
  total: Decimal;
  fees: Decimal;
  trades: number;
  winners: number;
  losers: number;
  avgWin?: Decimal;
  avgLoss?: Decimal;
}

// =============================================================================
// Trade Types
// =============================================================================

/**
 * Executed trade
 */
export interface Trade {
  id: string;
  orderId: string;
  exchange: ExchangeId;
  symbol: TradingSymbol;
  side: OrderSide;
  type: OrderType;
  /** Trade amount */
  amount: Decimal;
  /** Trade price */
  price: Decimal;
  /** Total cost */
  cost: Decimal;
  /** Trading fee */
  fee?: {
    cost: Decimal;
    currency: string;
    rate?: Decimal;
  };
  /** Whether maker or taker */
  takerOrMaker?: 'taker' | 'maker';
  timestamp: number;
  datetime: string;
  info?: Record<string, unknown>;
}

// =============================================================================
// Alert Types
// =============================================================================

/**
 * Alert condition types
 */
export type AlertCondition =
  | 'price_above'
  | 'price_below'
  | 'price_crosses'
  | 'change_up'
  | 'change_down'
  | 'volume_spike';

/**
 * Price alert
 */
export interface PriceAlert {
  id: string;
  exchange: ExchangeId;
  symbol: TradingSymbol;
  condition: AlertCondition;
  /** Target value (price or percentage) */
  target: Decimal;
  /** Whether alert is active */
  active: boolean;
  /** Whether alert repeats */
  repeat: boolean;
  /** Creation timestamp */
  createdAt: number;
  /** Last triggered timestamp */
  triggeredAt?: number;
  /** User note */
  note?: string;
}

// =============================================================================
// Event Types
// =============================================================================

/**
 * Trading events
 */
export interface TradingEvents {
  'exchange:connected': { exchange: ExchangeId };
  'exchange:disconnected': { exchange: ExchangeId; error?: Error };
  'ticker:update': Ticker;
  'order:created': Order;
  'order:updated': Order;
  'order:filled': Order;
  'order:canceled': Order;
  'trade:executed': Trade;
  'position:updated': Position;
  'balance:updated': { exchange: ExchangeId; balance: Balance };
  'alert:triggered': PriceAlert;
  error: { exchange?: ExchangeId; error: Error; context?: string };
}

// =============================================================================
// Exchange Interface
// =============================================================================

/**
 * Base exchange interface
 */
export interface IExchange {
  readonly id: ExchangeId;
  readonly name: string;
  readonly status: ConnectionStatus;

  // Connection
  connect(credentials: ExchangeCredentials): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;

  // Market Data
  fetchTicker(symbol: TradingSymbol): Promise<Ticker>;
  fetchTickers(symbols?: TradingSymbol[]): Promise<Map<string, Ticker>>;
  fetchOrderBook(symbol: TradingSymbol, limit?: number): Promise<OrderBook>;
  fetchOHLCV(
    symbol: TradingSymbol,
    timeframe: string,
    since?: number,
    limit?: number
  ): Promise<OHLCV[]>;
  subscribePrice(symbol: TradingSymbol, callback: PriceCallback): () => void;

  // Trading
  fetchBalance(): Promise<Balance>;
  createOrder(order: OrderRequest): Promise<Order>;
  cancelOrder(orderId: string, symbol?: TradingSymbol): Promise<Order>;
  fetchOrder(orderId: string, symbol?: TradingSymbol): Promise<Order>;
  fetchOpenOrders(symbol?: TradingSymbol): Promise<Order[]>;
  fetchClosedOrders(symbol?: TradingSymbol, since?: number, limit?: number): Promise<Order[]>;

  // Positions (for futures/margin)
  fetchPositions?(symbols?: TradingSymbol[]): Promise<Position[]>;

  // History
  fetchMyTrades(symbol?: TradingSymbol, since?: number, limit?: number): Promise<Trade[]>;

  // Utilities
  fetchMarkets(): Promise<unknown[]>;
  getSymbols(): TradingSymbol[];
}
