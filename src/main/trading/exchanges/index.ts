/**
 * Atlas Trading - Exchange Exports
 *
 * Re-exports all exchange implementations.
 *
 * @module trading/exchanges
 */

export { BaseExchange } from './base';
export {
  BinanceExchange,
  createBinanceExchange,
  createBinanceTestnet,
  createBinanceFuturesTestnet,
} from './binance';
export type { BinanceConfig } from './binance';
export {
  CoinbaseExchange,
  createCoinbaseExchange,
  createCoinbaseSandbox,
  createCoinbaseProduction,
} from './coinbase';
export type { CoinbaseConfig } from './coinbase';
export { SchwabExchange, createSchwabExchange } from './schwab';
export type { SchwabConfig, SchwabTokens, SchwabAccount } from './schwab';
export { MetaApiExchange, createMetaApiExchange } from './metaapi';
export type { MetaApiConfig, MetaApiAccountInfo } from './metaapi';
export {
  AlpacaExchange,
  createAlpacaExchange,
  createAlpacaPaperTrading,
  createAlpacaLiveTrading,
} from './alpaca';
export type { AlpacaConfig, AlpacaAccount } from './alpaca';
