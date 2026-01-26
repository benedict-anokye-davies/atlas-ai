/**
 * Atlas Trading - OANDA Exchange (Forex)
 *
 * CCXT-based OANDA integration for forex trading:
 * - Major, minor, and exotic currency pairs
 * - CFD trading
 * - Practice (demo) and live accounts
 *
 * @module trading/exchanges/oanda
 */

import ccxt from 'ccxt';
import Decimal from 'decimal.js';
import { BaseExchange } from './base';
import { ExchangeId, ExchangeConfig, ExchangeCredentials, Position } from '../types';
import { createModuleLogger } from '../../utils/logger';

const logger = createModuleLogger('OandaExchange');

type CCXTExchange = InstanceType<typeof ccxt.Exchange>;

/**
 * OANDA exchange configuration
 */
export interface OandaConfig extends ExchangeConfig {
  id: 'oanda';
  /** OANDA account ID */
  accountId?: string;
  /** Use practice (demo) account */
  practice?: boolean;
}

/**
 * Default OANDA configuration
 */
const DEFAULT_CONFIG: OandaConfig = {
  id: 'oanda',
  name: 'OANDA',
  sandbox: true, // Practice account
  practice: true,
  rateLimit: 100,
};

/**
 * OANDA exchange implementation
 */
export class OandaExchange extends BaseExchange {
  readonly id: ExchangeId = 'oanda';
  readonly name: string = 'OANDA';
  private oandaConfig: OandaConfig;

  constructor(config: Partial<OandaConfig> = {}) {
    const fullConfig = { ...DEFAULT_CONFIG, ...config };
    super(fullConfig);
    this.oandaConfig = fullConfig;
    logger.info('OandaExchange initialized', {
      practice: this.oandaConfig.practice,
      accountId: this.oandaConfig.accountId ? '***' : undefined,
    });
  }

  /**
   * Create the CCXT OANDA exchange instance
   * Note: OANDA is not directly supported by CCXT.
   * This uses a generic approach that may need a custom adapter.
   */
  protected createExchange(credentials: ExchangeCredentials): CCXTExchange {
    const options: Record<string, unknown> = {
      apiKey: credentials.apiKey,
      enableRateLimit: true,
      rateLimit: this.oandaConfig.rateLimit,
      options: {
        accountId: this.oandaConfig.accountId || credentials.extra?.accountId,
      },
    };

    // OANDA not in CCXT - would need custom adapter or direct API
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ExchangeClass = (ccxt as any).Exchange;
    const exchange = new ExchangeClass(options);

    // Configure practice mode
    if (this.oandaConfig.practice || this.oandaConfig.sandbox) {
      exchange.setSandboxMode(true);
      logger.info('Using OANDA practice account');
    }

    return exchange;
  }

  /**
   * Fetch open positions
   */
  async fetchPositions(_symbol?: string): Promise<Position[]> {
    this.ensureConnected();

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ccxtPositions = await (this.exchange as any).fetchPositions();

      return ccxtPositions.map((p: { id?: string; symbol: string; contracts?: number; entryPrice?: number; markPrice?: number; unrealizedPnl?: number; timestamp?: number; info: Record<string, unknown> }) => ({
        id: p.id || p.symbol,
        exchange: this.id,
        symbol: p.symbol,
        side: Number(p.contracts) > 0 ? 'long' : 'short',
        contracts: new Decimal(Math.abs(Number(p.contracts ?? 0))),
        entryPrice: new Decimal(p.entryPrice ?? 0),
        markPrice: p.markPrice ? new Decimal(p.markPrice) : undefined,
        unrealizedPnl: p.unrealizedPnl ? new Decimal(p.unrealizedPnl) : undefined,
        timestamp: p.timestamp,
        info: p.info,
      }));
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to fetch positions', { error: err.message });
      throw error;
    }
  }

  /**
   * Get account summary
   */
  async getAccountSummary(): Promise<{
    balance: Decimal;
    unrealizedPnl: Decimal;
    marginUsed: Decimal;
    marginAvailable: Decimal;
    currency: string;
  }> {
    this.ensureConnected();

    try {
      const balance = await this.exchange!.fetchBalance();
      const info = balance.info as Record<string, unknown>;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const balanceTotal = balance.total as any;
      return {
        balance: new Decimal(balanceTotal?.['USD'] ?? balanceTotal?.['EUR'] ?? 0),
        unrealizedPnl: new Decimal((info.unrealizedPL as number) ?? 0),
        marginUsed: new Decimal((info.marginUsed as number) ?? 0),
        marginAvailable: new Decimal((info.marginAvailable as number) ?? 0),
        currency: (info.currency as string) ?? 'USD',
      };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to get account summary', { error: err.message });
      throw error;
    }
  }

  /**
   * Get available forex instruments
   */
  async getForexPairs(): Promise<string[]> {
    this.ensureConnected();

    try {
      const markets = await this.exchange!.loadMarkets();
      return Object.keys(markets).filter((symbol) => {
        const market = markets[symbol];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (market as any)?.type === 'forex' || symbol.includes('/');
      });
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to get forex pairs', { error: err.message });
      throw error;
    }
  }

  /**
   * Get exchange-specific info
   */
  getExchangeInfo(): {
    practice: boolean;
    accountId: string | undefined;
  } {
    return {
      practice: this.oandaConfig.practice ?? true,
      accountId: this.oandaConfig.accountId,
    };
  }
}

/**
 * Create an OANDA exchange instance
 */
export function createOandaExchange(config?: Partial<OandaConfig>): OandaExchange {
  return new OandaExchange(config);
}

/**
 * Create an OANDA practice account instance
 */
export function createOandaPractice(accountId?: string): OandaExchange {
  return new OandaExchange({
    practice: true,
    sandbox: true,
    accountId,
  });
}

/**
 * Create an OANDA live account instance
 */
export function createOandaLive(accountId: string): OandaExchange {
  return new OandaExchange({
    practice: false,
    sandbox: false,
    accountId,
  });
}
