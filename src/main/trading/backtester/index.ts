/**
 * Atlas Autonomous Trading - Backtester Module Index
 * 
 * Exports all backtester components for the autonomous trading system
 */

// Types
export * from './types';

// Go Backend Client
export { 
  GoBackendClient, 
  getGoBackendClient, 
  createGoBackendClient,
} from './go-backend-client';

// Autonomous Trading Agent
export {
  AutonomousTradingAgent,
  getAutonomousTrader,
  createAutonomousTrader,
} from './autonomous-agent';

// Signal Aggregator
export {
  SignalAggregator,
  getSignalAggregator,
  createSignalAggregator,
  TechnicalAnalyzer,
  SentimentAnalyzer,
  type OHLCV,
  type IndicatorResult,
  type SentimentData,
} from './signal-aggregator';

// Risk Manager
export {
  RiskManager,
  getRiskManager,
  createRiskManager,
  PositionSizer,
  StopLossManager,
  type SizingMethod,
  type SizingConfig,
  type SizingInput,
  type StopType,
  type StopConfig,
  type StopState,
} from './risk-manager';
