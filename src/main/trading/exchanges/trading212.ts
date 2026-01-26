/**
 * Atlas Trading - Trading212 Exchange (Stocks/ETFs)
 *
 * REST API integration for Trading212:
 * - Stocks and ETFs
 * - ISA and Invest accounts
 * - Fractional shares
 *
 * Note: Trading212 doesn't have CCXT support, using direct API
 *
 * @module trading/exchanges/trading212
 */

import Decimal from 'decimal.js';
import { ExchangeId, ExchangeConfig, ExchangeCredentials, Balance, Position, CurrencyBalance } from '../types';
import { createModuleLogger } from '../../utils/logger';

const logger = createModuleLogger('Trading212Exchange');

const TRADING212_API_URL = 'https://live.trading212.com/api/v0';
const TRADING212_DEMO_URL = 'https://demo.trading212.com/api/v0';

/**
 * Trading212 exchange configuration
 */
export interface Trading212Config extends ExchangeConfig {
  id: 'trading212';
  /** Account type */
  accountType?: 'invest' | 'isa' | 'cfd';
}

/**
 * Trading212 instrument info
 */
export interface Trading212Instrument {
  ticker: string;
  type: 'STOCK' | 'ETF';
  currencyCode: string;
  name: string;
  shortName: string;
  minTradeQuantity: number;
  maxOpenQuantity: number;
  addedOn: string;
}

/**
 * Trading212 position
 */
export interface Trading212Position {
  ticker: string;
  quantity: number;
  averagePrice: number;
  currentPrice: number;
  ppl: number;
  fxPpl: number;
  initialFillDate: string;
  frontend: string;
  maxBuy: number;
  maxSell: number;
  pieQuantity: number;
}

/**
 * Trading212 order
 */
export interface Trading212Order {
  id: number;
  ticker: string;
  quantity: number;
  filledQuantity: number;
  type: 'LIMIT' | 'MARKET' | 'STOP' | 'STOP_LIMIT';
  status: 'NEW' | 'FILLED' | 'CANCELLED' | 'REJECTED';
  limitPrice?: number;
  stopPrice?: number;
  dateCreated: string;
  dateModified: string;
}

/**
 * Default Trading212 configuration
 */
const DEFAULT_CONFIG: Trading212Config = {
  id: 'trading212',
  name: 'Trading212',
  sandbox: true, // Demo mode
  accountType: 'invest',
  rateLimit: 100,
};

/**
 * Trading212 exchange implementation
 */
export class Trading212Exchange {
  readonly id: ExchangeId = 'trading212';
  readonly name: string = 'Trading212';
  private config: Trading212Config;
  private apiKey: string | null = null;
  private connected: boolean = false;

  constructor(config: Partial<Trading212Config> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    logger.info('Trading212Exchange initialized', {
      sandbox: this.config.sandbox,
      accountType: this.config.accountType,
    });
  }

  /**
   * Get API base URL
   */
  private get baseUrl(): string {
    return this.config.sandbox ? TRADING212_DEMO_URL : TRADING212_API_URL;
  }

  /**
   * Make authenticated API request
   */
  private async request<T>(
    endpoint: string,
    method: 'GET' | 'POST' | 'DELETE' = 'GET',
    body?: Record<string, unknown>
  ): Promise<T> {
    if (!this.apiKey) {
      throw new Error('Not connected - call connect() first');
    }

    const url = `${this.baseUrl}${endpoint}`;
    const headers: Record<string, string> = {
      'Authorization': this.apiKey,
      'Content-Type': 'application/json',
    };

    const options: RequestInit = {
      method,
      headers,
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Trading212 API error: ${response.status} - ${error}`);
    }

    return response.json();
  }

  /**
   * Connect to Trading212
   */
  async connect(credentials: ExchangeCredentials): Promise<void> {
    this.apiKey = credentials.apiKey;
    
    // Test connection by fetching account info
    try {
      await this.request('/equity/account/cash');
      this.connected = true;
      logger.info('Connected to Trading212', { sandbox: this.config.sandbox });
    } catch (error) {
      this.apiKey = null;
      throw error;
    }
  }

  /**
   * Disconnect
   */
  async disconnect(): Promise<void> {
    this.apiKey = null;
    this.connected = false;
    logger.info('Disconnected from Trading212');
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected && this.apiKey !== null;
  }

  /**
   * Get account cash balance
   */
  async fetchBalance(): Promise<Balance> {
    const data = await this.request<{
      free: number;
      total: number;
      ppl: number;
      result: number;
      invested: number;
      pieCash: number;
    }>('/equity/account/cash');

    const currencies = new Map<string, CurrencyBalance>();
    currencies.set('GBP', {
      currency: 'GBP',
      total: new Decimal(data.total),
      free: new Decimal(data.free),
      used: new Decimal(data.invested),
    });

    return {
      exchange: this.id,
      timestamp: Date.now(),
      currencies,
      get: (currency: string) => currencies.get(currency),
    };
  }

  /**
   * Fetch open positions
   */
  async fetchPositions(): Promise<Position[]> {
    const positions = await this.request<Trading212Position[]>('/equity/portfolio');

    return positions.map((p) => ({
      id: p.ticker,
      exchange: this.id,
      symbol: p.ticker,
      side: 'long' as const, // Trading212 is long-only
      contracts: new Decimal(p.quantity),
      entryPrice: new Decimal(p.averagePrice),
      markPrice: new Decimal(p.currentPrice),
      unrealizedPnl: new Decimal(p.ppl),
      timestamp: new Date(p.initialFillDate).getTime(),
      info: p as unknown as Record<string, unknown>,
    }));
  }

  /**
   * Get all available instruments
   */
  async fetchInstruments(): Promise<Trading212Instrument[]> {
    return this.request<Trading212Instrument[]>('/equity/metadata/instruments');
  }

  /**
   * Place a market order
   */
  async createMarketOrder(
    ticker: string,
    quantity: number
  ): Promise<Trading212Order> {
    return this.request<Trading212Order>('/equity/orders/market', 'POST', {
      ticker,
      quantity,
    });
  }

  /**
   * Place a limit order
   */
  async createLimitOrder(
    ticker: string,
    quantity: number,
    limitPrice: number,
    timeValidity?: 'DAY' | 'GTC'
  ): Promise<Trading212Order> {
    return this.request<Trading212Order>('/equity/orders/limit', 'POST', {
      ticker,
      quantity,
      limitPrice,
      timeValidity: timeValidity || 'GTC',
    });
  }

  /**
   * Place a stop order
   */
  async createStopOrder(
    ticker: string,
    quantity: number,
    stopPrice: number,
    timeValidity?: 'DAY' | 'GTC'
  ): Promise<Trading212Order> {
    return this.request<Trading212Order>('/equity/orders/stop', 'POST', {
      ticker,
      quantity,
      stopPrice,
      timeValidity: timeValidity || 'GTC',
    });
  }

  /**
   * Cancel an order
   */
  async cancelOrder(orderId: number): Promise<void> {
    await this.request(`/equity/orders/${orderId}`, 'DELETE');
  }

  /**
   * Get open orders
   */
  async fetchOpenOrders(): Promise<Trading212Order[]> {
    return this.request<Trading212Order[]>('/equity/orders');
  }

  /**
   * Get order history
   */
  async fetchOrderHistory(limit: number = 50): Promise<Trading212Order[]> {
    return this.request<Trading212Order[]>(`/equity/history/orders?limit=${limit}`);
  }

  /**
   * Get exchange info
   */
  getExchangeInfo(): {
    sandbox: boolean;
    accountType: string;
  } {
    return {
      sandbox: this.config.sandbox ?? true,
      accountType: this.config.accountType ?? 'invest',
    };
  }
}

/**
 * Create a Trading212 exchange instance
 */
export function createTrading212Exchange(config?: Partial<Trading212Config>): Trading212Exchange {
  return new Trading212Exchange(config);
}

/**
 * Create a Trading212 demo instance
 */
export function createTrading212Demo(): Trading212Exchange {
  return new Trading212Exchange({
    sandbox: true,
  });
}

/**
 * Create a Trading212 live instance
 */
export function createTrading212Live(accountType: 'invest' | 'isa' = 'invest'): Trading212Exchange {
  return new Trading212Exchange({
    sandbox: false,
    accountType,
  });
}
