/**
 * Atlas Trading - Risk Management Module
 *
 * Exports all risk management components.
 *
 * @module trading/risk
 */

export {
  KillSwitchManager,
  getKillSwitchManager,
  initializeKillSwitchManager,
  DEFAULT_RISK_LIMITS,
} from './kill-switches';

export type {
  RiskLimits,
  RiskCheckResult,
  RiskMetrics,
  OrderToCheck,
  PositionState,
  KillSwitchEvent,
} from './kill-switches';
