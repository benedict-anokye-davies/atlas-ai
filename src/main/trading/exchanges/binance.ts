/**
 * Atlas Trading - Binance Exchange
 *
 * CCXT-based Binance exchange integration supporting:
 * - Spot trading
 * - Testnet/sandbox mode
 * - Real-time price streaming
 *
 * @module trading/exchanges/binance
 */

import ccxt from 'ccxt';
import Decimal from 'decimal.js';
import { BaseExchange } from './base';
import { ExchangeId, ExchangeConfig, ExchangeCredentials, Position } from '../types';
import { createModuleLogger } from '../../utils/logger';

const logger = createModuleLogger('BinanceExchange');

// CCXT Exchange type
type CCXTExchange = InstanceType<typeof ccxt.Exchange>;

/**
 * Binance exchange configuration
 */
export interface BinanceConfig extends ExchangeConfig {
  id: 'binance';
  /** Use Binance futures (USDT-M) */
  futures?: boolean;
  /** Recvwindow for signed requests (default: 5000) */
  recvWindow?: number;
}

/**
 * Default Binance configuration
 */
const DEFAULT_CONFIG: BinanceConfig = {
  id: 'binance',
  name: 'Binance',
  sandbox: true, // Default to testnet for safety
  rateLimit: 1200, // Binance rate limit: 1200 requests per minute
};

/**
 * Binance exchange implementation
 */
export class BinanceExchange extends BaseExchange {
  readonly id: ExchangeId = 'binance';
  readonly name: string = 'Binance';
  private binanceConfig: BinanceConfig;

  constructor(config: Partial<BinanceConfig> = {}) {
    const fullConfig = { ...DEFAULT_CONFIG, ...config };
    super(fullConfig);
    this.binanceConfig = fullConfig;
    logger.info('BinanceExchange initialized', {
      sandbox: this.binanceConfig.sandbox,
      futures: this.binanceConfig.futures,
    });
  }

  /**
   * Create the CCXT Binance exchange instance
   */
  protected createExchange(credentials: ExchangeCredentials): CCXTExchange {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const options: any = {
      apiKey: credentials.apiKey,
      secret: credentials.secret,
      enableRateLimit: true,
      rateLimit: this.binanceConfig.rateLimit,
      options: {
        defaultType: this.binanceConfig.futures ? 'future' : 'spot',
        recvWindow: this.binanceConfig.recvWindow || 5000,
        adjustForTimeDifference: true,
      },
    };

    // Add password if provided (for some API operations)
    if (credentials.extra?.password) {
      options.password = credentials.extra.password;
    }

    const exchange = new ccxt.binance(options);

    // Configure sandbox mode
    if (this.binanceConfig.sandbox) {
      exchange.setSandboxMode(true);
      logger.info('Using Binance testnet', {
        futures: this.binanceConfig.futures,
      });
    }

    return exchange;
  }

  /**
   * Fetch positions (for futures trading)
   */
  async fetchPositions(symbols?: symbol[]): Promise<Position[]> {
    if (!this.binanceConfig.futures) {
      logger.warn('Positions only available in futures mode');
      return [];
    }

    this.ensureConnected();

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ccxtPositions = await (this.exchange as any).fetchPositions(symbols);

      return ccxtPositions.map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (p: any) => ({
          id: p.id,
          exchange: this.id,
          symbol: p.symbol,
          side: p.side === 'long' ? 'long' : p.side === 'short' ? 'short' : 'both',
          contracts: new Decimal(p.contracts ?? 0),
          contractSize: p.contractSize ? new Decimal(p.contractSize) : undefined,
          entryPrice: new Decimal(p.entryPrice ?? 0),
          markPrice: p.markPrice ? new Decimal(p.markPrice) : undefined,
          liquidationPrice: p.liquidationPrice ? new Decimal(p.liquidationPrice) : undefined,
          unrealizedPnl: p.unrealizedPnl ? new Decimal(p.unrealizedPnl) : undefined,
          realizedPnl: undefined, // Not provided by CCXT
          leverage: p.leverage ? new Decimal(p.leverage) : undefined,
          marginMode: p.marginMode as 'cross' | 'isolated' | undefined,
          notional: p.notional ? new Decimal(p.notional) : undefined,
          timestamp: p.timestamp,
          info: p.info,
        })
      );
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
   * Get exchange-specific info
   */
  getExchangeInfo(): {
    sandbox: boolean;
    futures: boolean;
    rateLimit: number;
  } {
    return {
      sandbox: this.binanceConfig.sandbox,
      futures: this.binanceConfig.futures || false,
      rateLimit: this.binanceConfig.rateLimit || 1200,
    };
  }
}

/**
 * Create a Binance exchange instance
 */
export function createBinanceExchange(config?: Partial<BinanceConfig>): BinanceExchange {
  return new BinanceExchange(config);
}

/**
 * Create a Binance testnet exchange (sandbox mode)
 */
export function createBinanceTestnet(): BinanceExchange {
  return new BinanceExchange({
    sandbox: true,
    futures: false,
  });
}

/**
 * Create a Binance futures testnet exchange
 */
export function createBinanceFuturesTestnet(): BinanceExchange {
  return new BinanceExchange({
    sandbox: true,
    futures: true,
  });
}

export default BinanceExchange;
