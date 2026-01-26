/**
 * Atlas Trading - Bybit Exchange
 *
 * CCXT-based Bybit exchange integration supporting:
 * - Spot trading
 * - USDT perpetual futures
 * - Inverse perpetuals
 * - Testnet mode
 *
 * @module trading/exchanges/bybit
 */

import ccxt from 'ccxt';
import Decimal from 'decimal.js';
import { BaseExchange } from './base';
import { ExchangeId, ExchangeConfig, ExchangeCredentials, Position } from '../types';
import { createModuleLogger } from '../../utils/logger';

const logger = createModuleLogger('BybitExchange');

type CCXTExchange = InstanceType<typeof ccxt.Exchange>;

/**
 * Bybit exchange configuration
 */
export interface BybitConfig extends ExchangeConfig {
  id: 'bybit';
  /** Trading mode: spot, linear (USDT perps), inverse */
  tradingMode?: 'spot' | 'linear' | 'inverse';
  /** Use unified margin account */
  unifiedMargin?: boolean;
}

/**
 * Default Bybit configuration
 */
const DEFAULT_CONFIG: BybitConfig = {
  id: 'bybit',
  name: 'Bybit',
  sandbox: true,
  rateLimit: 100,
  tradingMode: 'linear',
  unifiedMargin: true,
};

/**
 * Bybit exchange implementation
 */
export class BybitExchange extends BaseExchange {
  readonly id: ExchangeId = 'bybit';
  readonly name: string = 'Bybit';
  private bybitConfig: BybitConfig;

  constructor(config: Partial<BybitConfig> = {}) {
    const fullConfig = { ...DEFAULT_CONFIG, ...config };
    super(fullConfig);
    this.bybitConfig = fullConfig;
    logger.info('BybitExchange initialized', {
      sandbox: this.bybitConfig.sandbox,
      tradingMode: this.bybitConfig.tradingMode,
      unifiedMargin: this.bybitConfig.unifiedMargin,
    });
  }

  /**
   * Create the CCXT Bybit exchange instance
   */
  protected createExchange(credentials: ExchangeCredentials): CCXTExchange {
    const options: Record<string, unknown> = {
      apiKey: credentials.apiKey,
      secret: credentials.secret,
      enableRateLimit: true,
      rateLimit: this.bybitConfig.rateLimit,
      options: {
        defaultType: this.bybitConfig.tradingMode === 'spot' ? 'spot' : 'swap',
        defaultSubType: this.bybitConfig.tradingMode === 'inverse' ? 'inverse' : 'linear',
        unifiedMargin: this.bybitConfig.unifiedMargin,
        recvWindow: 5000,
      },
    };

    const exchange = new ccxt.bybit(options);

    // Configure sandbox mode
    if (this.bybitConfig.sandbox) {
      exchange.setSandboxMode(true);
      logger.info('Using Bybit testnet', {
        tradingMode: this.bybitConfig.tradingMode,
      });
    }

    return exchange;
  }

  /**
   * Fetch positions
   */
  async fetchPositions(symbol?: string): Promise<Position[]> {
    if (this.bybitConfig.tradingMode === 'spot') {
      logger.warn('Positions only available in derivatives mode');
      return [];
    }

    this.ensureConnected();

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ccxtPositions = await this.exchange!.fetchPositions(symbol ? [symbol] : undefined) as any[];

      return ccxtPositions.map((p) => ({
        id: p.id || `${p.symbol}-${p.side}`,
        exchange: this.id,
        symbol: p.symbol,
        side: p.side === 'long' ? 'long' : p.side === 'short' ? 'short' : 'both',
        contracts: new Decimal(p.contracts ?? 0),
        contractSize: p.contractSize ? new Decimal(p.contractSize) : undefined,
        entryPrice: new Decimal(p.entryPrice ?? 0),
        markPrice: p.markPrice ? new Decimal(p.markPrice) : undefined,
        liquidationPrice: p.liquidationPrice ? new Decimal(p.liquidationPrice) : undefined,
        unrealizedPnl: p.unrealizedPnl ? new Decimal(p.unrealizedPnl) : undefined,
        leverage: p.leverage ? new Decimal(p.leverage) : undefined,
        marginMode: p.marginMode as 'cross' | 'isolated' | undefined,
        notional: p.notional ? new Decimal(p.notional) : undefined,
        timestamp: p.timestamp,
        info: p.info,
      }));
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to fetch positions', {
        exchange: this.id,
        error: err.message,
      });
      throw error;
    }
  }

  /**
   * Set leverage for a symbol
   */
  async setLeverage(symbol: string, leverage: number): Promise<void> {
    this.ensureConnected();
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (this.exchange as any).setLeverage(leverage, symbol);
      logger.info('Leverage set', { symbol, leverage });
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to set leverage', { symbol, leverage, error: err.message });
      throw error;
    }
  }

  /**
   * Set margin mode for a symbol
   */
  async setMarginMode(symbol: string, mode: 'cross' | 'isolated'): Promise<void> {
    this.ensureConnected();
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (this.exchange as any).setMarginMode(mode, symbol);
      logger.info('Margin mode set', { symbol, mode });
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to set margin mode', { symbol, mode, error: err.message });
      throw error;
    }
  }

  /**
   * Get exchange-specific info
   */
  getExchangeInfo(): {
    sandbox: boolean;
    tradingMode: string;
    unifiedMargin: boolean;
  } {
    return {
      sandbox: this.bybitConfig.sandbox ?? true,
      tradingMode: this.bybitConfig.tradingMode ?? 'linear',
      unifiedMargin: this.bybitConfig.unifiedMargin ?? true,
    };
  }
}

/**
 * Create a Bybit exchange instance
 */
export function createBybitExchange(config?: Partial<BybitConfig>): BybitExchange {
  return new BybitExchange(config);
}

/**
 * Create a Bybit testnet instance
 */
export function createBybitTestnet(tradingMode: 'spot' | 'linear' | 'inverse' = 'linear'): BybitExchange {
  return new BybitExchange({
    sandbox: true,
    tradingMode,
  });
}

/**
 * Create a Bybit production instance
 */
export function createBybitProduction(tradingMode: 'spot' | 'linear' | 'inverse' = 'linear'): BybitExchange {
  return new BybitExchange({
    sandbox: false,
    tradingMode,
  });
}
