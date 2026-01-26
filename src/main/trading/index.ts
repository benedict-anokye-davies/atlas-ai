/**
 * Atlas Trading - Main Module
 *
 * Provides unified trading infrastructure for multiple exchanges:
 * - Crypto: Binance, Coinbase
 * - Stocks: Charles Schwab
 * - Forex: MetaApi (MT4/MT5)
 *
 * Autonomous Trading (Atlas's Trading Bot):
 * - API Client for Go backend
 * - WebSocket for real-time events
 * - State Manager for conversational context
 * - Research Agent for market intelligence
 * - Tools for LLM-callable trading operations
 *
 * @module trading
 */

// Type exports
export * from './types';

// Exchange exports
export * from './exchanges';

// Credentials management
export { CredentialsManager, getCredentialsManager } from './credentials';

// Trade logging
export { logOrder, logTrade, logAlert, getTradingStats, type TradeLogEntry } from './trade-logger';

// Portfolio management
export {
  PortfolioManager,
  getPortfolioManager,
  createPortfolioManager,
  type PortfolioManagerConfig,
  type PortfolioSnapshot,
  type PerformancePeriod,
} from './portfolio';

// Alert management
export {
  AlertManager,
  getAlertManager,
  createAlertManager,
  type AlertManagerConfig,
  type CreateAlertRequest,
  type AlertTriggeredEvent,
} from './alerts';

// Trading history
export {
  TradingHistory,
  getTradingHistory,
  createTradingHistory,
  type TradingHistoryConfig,
  type TradeHistoryQuery,
  type OrderHistoryQuery,
  type TradeSummary,
} from './history';

// IPC handlers (portfolio, alerts, history)
export { registerTradingHandlers, unregisterTradingHandlers, TRADING_IPC_CHANNELS } from './ipc';

// Autonomous Trading IPC handlers
export { registerTradingIpcHandlers as registerAutonomousTradingHandlers } from './ipc-autonomous';

// =============================================================================
// Atlas's Trading Bot - Autonomous Trading System
// =============================================================================

// API Client - HTTP client for Go backend
export { getTradingAPI, TradingAPIClient, type TradingAPIConfig } from './api-client';

// WebSocket Client - Real-time trading events
export { getTradingWebSocket, TradingWebSocketClient, type TradingWSConfig } from './websocket-client';

// State Manager - Trading context for conversations
export { getTradingStateManager, TradingStateManager, type TradingContext, type TradingMood } from './state-manager';

// Research Agent - Market research and sentiment
export { getTradingResearchAgent, TradingResearchAgent, type ResearchConfig, type SentimentSnapshot } from './research-agent';

// Agent Tools - LLM-callable trading operations
export { tradingTools as autonomousTradingTools, getTradingTools as getAutonomousTradingTools, tradingToolNames } from './tools';

// Proactive Handler - Voice notifications for trading events
export {
  TradingProactiveHandler,
  getTradingProactiveHandler,
  createTradingProactiveHandler,
  type ProactiveMessage,
  type ProactiveConfig,
} from './proactive-handler';

// System Initializer - Bootstraps trading on app start
export {
  TradingSystemInitializer,
  getTradingSystem,
  createTradingSystem,
  initializeTradingSystem,
  getTradingContextForLLM,
  type TradingSystemConfig,
  type TradingSystemStatus,
} from './initializer';

// Re-export specific items for convenience
export { BinanceExchange, createBinanceExchange, createBinanceTestnet } from './exchanges/binance';
export { BaseExchange } from './exchanges/base';
