/**
 * Atlas Trading - Coinbase Exchange
 *
 * CCXT-based Coinbase exchange integration supporting:
 * - Spot trading
 * - Coinbase Pro (Advanced Trade API)
 * - Sandbox mode for testing
 *
 * @module trading/exchanges/coinbase
 */

import ccxt from 'ccxt';
import { BaseExchange } from './base';
import { ExchangeId, ExchangeConfig, ExchangeCredentials, Position } from '../types';
import { createModuleLogger } from '../../utils/logger';

const logger = createModuleLogger('CoinbaseExchange');

// CCXT Exchange type
type CCXTExchange = InstanceType<typeof ccxt.Exchange>;

/**
 * Coinbase exchange configuration
 */
export interface CoinbaseConfig extends ExchangeConfig {
  id: 'coinbase';
  /** Use Coinbase Advanced Trade API (Pro) */
  advanced?: boolean;
}

/**
 * Default Coinbase configuration
 */
const DEFAULT_CONFIG: CoinbaseConfig = {
  id: 'coinbase',
  name: 'Coinbase',
  sandbox: true, // Default to sandbox for safety
  rateLimit: 1000, // Coinbase rate limit: ~10 requests per second
  advanced: true, // Use Advanced Trade API by default
};

/**
 * Coinbase exchange implementation
 */
export class CoinbaseExchange extends BaseExchange {
  readonly id: ExchangeId = 'coinbase';
  readonly name: string = 'Coinbase';
  private coinbaseConfig: CoinbaseConfig;

  constructor(config: Partial<CoinbaseConfig> = {}) {
    const fullConfig = { ...DEFAULT_CONFIG, ...config };
    super(fullConfig);
    this.coinbaseConfig = fullConfig;
    logger.info('CoinbaseExchange initialized', {
      sandbox: this.coinbaseConfig.sandbox,
      advanced: this.coinbaseConfig.advanced,
    });
  }

  /**
   * Create the CCXT Coinbase exchange instance
   */
  protected createExchange(credentials: ExchangeCredentials): CCXTExchange {
    // Coinbase Advanced Trade API uses coinbaseadvanced in CCXT
    const ExchangeClass = this.coinbaseConfig.advanced
      ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (ccxt as any).coinbaseadvanced || ccxt.coinbase
      : ccxt.coinbase;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const options: any = {
      apiKey: credentials.apiKey,
      secret: credentials.secret,
      enableRateLimit: true,
      rateLimit: this.coinbaseConfig.rateLimit,
      options: {
        createMarketBuyOrderRequiresPrice: false,
      },
    };

    // Add passphrase if provided (required for Coinbase Pro)
    if (credentials.extra?.passphrase) {
      options.password = credentials.extra.passphrase;
    }

    const exchange = new ExchangeClass(options);

    // Configure sandbox mode
    if (this.coinbaseConfig.sandbox) {
      exchange.setSandboxMode(true);
      logger.info('Using Coinbase sandbox');
    }

    return exchange;
  }

  /**
   * Fetch positions (not supported on Coinbase spot)
   */
  async fetchPositions(_symbols?: symbol[]): Promise<Position[]> {
    logger.warn('Positions not supported on Coinbase spot trading');
    return [];
  }

  /**
   * Get exchange-specific info
   */
  getExchangeInfo(): {
    sandbox: boolean;
    advanced: boolean;
    rateLimit: number;
  } {
    return {
      sandbox: this.coinbaseConfig.sandbox,
      advanced: this.coinbaseConfig.advanced || false,
      rateLimit: this.coinbaseConfig.rateLimit || 1000,
    };
  }

  /**
   * Get available USD pairs
   */
  getUSDPairs(): string[] {
    return this.getSymbols().filter((s) => s.endsWith('/USD') || s.endsWith('/USDC'));
  }

  /**
   * Get available BTC pairs
   */
  getBTCPairs(): string[] {
    return this.getSymbols().filter((s) => s.endsWith('/BTC'));
  }
}

/**
 * Create a Coinbase exchange instance
 */
export function createCoinbaseExchange(config?: Partial<CoinbaseConfig>): CoinbaseExchange {
  return new CoinbaseExchange(config);
}

/**
 * Create a Coinbase sandbox exchange (for testing)
 */
export function createCoinbaseSandbox(): CoinbaseExchange {
  return new CoinbaseExchange({
    sandbox: true,
    advanced: true,
  });
}

/**
 * Create a Coinbase production exchange
 */
export function createCoinbaseProduction(): CoinbaseExchange {
  return new CoinbaseExchange({
    sandbox: false,
    advanced: true,
  });
}

export default CoinbaseExchange;
