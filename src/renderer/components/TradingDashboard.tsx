/**
 * Atlas Trading Dashboard
 * 
 * Comprehensive trading dashboard with:
 * - Portfolio overview
 * - Autonomous trading controls
 * - Signal monitoring
 * - Backtest results
 * - Risk metrics
 * - P&L visualization
 */

import React, { useState, useEffect, useCallback } from 'react';

// Types for the trading dashboard
interface AutonomousStatus {
  state: string;
  mode: string;
  startedAt: number;
  uptime: number;
  cycleCount: number;
  lastCycleAt: number;
  pendingSignals: number;
  pendingOrders: number;
  todayPnl: string;
  todayPnlPercent: string;
  todayTrades: number;
  todayWinRate: string;
  todayVolume: string;
  riskMetrics: RiskMetrics;
  killSwitchStatus: KillSwitchStatus;
  errorCount: number;
  lastError?: string;
}

interface RiskMetrics {
  currentExposure: string;
  exposurePercent: string;
  dailyPnl: string;
  dailyPnlPercent: string;
  weeklyPnl: string;
  weeklyPnlPercent: string;
  currentDrawdown: string;
  currentDrawdownPercent: string;
  consecutiveLosses: number;
  openPositions: number;
  riskScore: number;
}

interface KillSwitchStatus {
  triggered: boolean;
  triggeredAt?: number;
  reason?: string;
  canResume: boolean;
}

interface Signal {
  id: string;
  symbol: string;
  side: 'long' | 'short';
  type: string;
  source: string;
  confidence: string;
  timestamp: number;
  currentPrice: string;
  suggestedStopLoss?: string;
  suggestedTakeProfit?: string;
}

interface BackendStatus {
  connected: boolean;
  version?: string;
  uptime?: number;
  activeBacktests?: number;
}

interface BacktestSummary {
  id: string;
  strategyId: string;
  status: string;
  progress: number;
  startTime: number;
  metrics?: {
    totalReturn: string;
    sharpeRatio: string;
    maxDrawdown: string;
    winRate: string;
  };
}

// Styles
const styles = {
  container: {
    padding: '24px',
    backgroundColor: '#0a0a0f',
    minHeight: '100vh',
    color: '#e0e0e0',
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
  } as React.CSSProperties,
  
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '24px',
  } as React.CSSProperties,
  
  title: {
    fontSize: '28px',
    fontWeight: 600,
    color: '#ffffff',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  } as React.CSSProperties,
  
  statusBadge: {
    padding: '4px 12px',
    borderRadius: '20px',
    fontSize: '12px',
    fontWeight: 500,
  } as React.CSSProperties,
  
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
    gap: '20px',
    marginBottom: '24px',
  } as React.CSSProperties,
  
  card: {
    backgroundColor: '#12121a',
    borderRadius: '12px',
    padding: '20px',
    border: '1px solid #1e1e2d',
  } as React.CSSProperties,
  
  cardTitle: {
    fontSize: '14px',
    fontWeight: 500,
    color: '#8b8b9a',
    marginBottom: '16px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  } as React.CSSProperties,
  
  metricValue: {
    fontSize: '32px',
    fontWeight: 700,
    marginBottom: '4px',
  } as React.CSSProperties,
  
  metricLabel: {
    fontSize: '13px',
    color: '#6b6b7a',
  } as React.CSSProperties,
  
  button: {
    padding: '10px 20px',
    borderRadius: '8px',
    border: 'none',
    fontSize: '14px',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.2s',
  } as React.CSSProperties,
  
  primaryButton: {
    backgroundColor: '#3b82f6',
    color: '#ffffff',
  } as React.CSSProperties,
  
  dangerButton: {
    backgroundColor: '#ef4444',
    color: '#ffffff',
  } as React.CSSProperties,
  
  successButton: {
    backgroundColor: '#22c55e',
    color: '#ffffff',
  } as React.CSSProperties,
  
  outlineButton: {
    backgroundColor: 'transparent',
    border: '1px solid #3b82f6',
    color: '#3b82f6',
  } as React.CSSProperties,
  
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
  } as React.CSSProperties,
  
  tableHeader: {
    textAlign: 'left' as const,
    padding: '12px',
    fontSize: '12px',
    color: '#8b8b9a',
    borderBottom: '1px solid #1e1e2d',
    textTransform: 'uppercase' as const,
  } as React.CSSProperties,
  
  tableCell: {
    padding: '12px',
    fontSize: '14px',
    borderBottom: '1px solid #1e1e2d',
  } as React.CSSProperties,
  
  progressBar: {
    width: '100%',
    height: '8px',
    backgroundColor: '#1e1e2d',
    borderRadius: '4px',
    overflow: 'hidden',
  } as React.CSSProperties,
  
  progressFill: {
    height: '100%',
    backgroundColor: '#3b82f6',
    borderRadius: '4px',
    transition: 'width 0.3s',
  } as React.CSSProperties,
  
  riskMeter: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  } as React.CSSProperties,
  
  flexRow: {
    display: 'flex',
    gap: '12px',
    alignItems: 'center',
  } as React.CSSProperties,
  
  flexBetween: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  } as React.CSSProperties,
};

// Helper functions
const formatCurrency = (value: string | number): string => {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
};

const formatPercent = (value: string | number): string => {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  return `${num >= 0 ? '+' : ''}${num.toFixed(2)}%`;
};

const formatTime = (ms: number): string => {
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  return `${hours}h ${minutes}m`;
};

const getStateColor = (state: string): string => {
  switch (state) {
    case 'idle': return '#22c55e';
    case 'researching': return '#3b82f6';
    case 'analyzing': return '#8b5cf6';
    case 'executing': return '#f59e0b';
    case 'monitoring': return '#06b6d4';
    case 'paused': return '#f59e0b';
    case 'stopped': return '#6b7280';
    case 'error': return '#ef4444';
    default: return '#6b7280';
  }
};

const getRiskColor = (score: number): string => {
  if (score < 30) return '#22c55e';
  if (score < 60) return '#f59e0b';
  return '#ef4444';
};

// Main Component
export const TradingDashboard: React.FC = () => {
  const [status, setStatus] = useState<AutonomousStatus | null>(null);
  const [backendStatus, setBackendStatus] = useState<BackendStatus>({ connected: false });
  const [signals, setSignals] = useState<Signal[]>([]);
  const [backtests, setBacktests] = useState<BacktestSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch data
  const fetchStatus = useCallback(async () => {
    try {
      const atlasAny = window.atlas as unknown as Record<string, unknown>;
      const tradingApi = atlasAny?.trading as Record<string, (...args: unknown[]) => Promise<{ success: boolean; data?: unknown; error?: string }>> | undefined;
      
      if (tradingApi?.autonomousStatus) {
        const result = await tradingApi.autonomousStatus();
        if (result.success && result.data) {
          setStatus(result.data as AutonomousStatus);
        }
      }

      if (tradingApi?.backendStatus) {
        const backendResult = await tradingApi.backendStatus();
        if (backendResult.success && backendResult.data) {
          setBackendStatus(backendResult.data as BackendStatus);
        }
      }

      if (tradingApi?.signalsList) {
        const signalsResult = await tradingApi.signalsList();
        if (signalsResult.success && signalsResult.data) {
          setSignals(signalsResult.data as Signal[]);
        }
      }

      if (tradingApi?.backtestList) {
        const backtestsResult = await tradingApi.backtestList();
        if (backtestsResult.success && backtestsResult.data) {
          setBacktests(backtestsResult.data as BacktestSummary[]);
        }
      }

      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  // Actions
  const startTrading = async () => {
    try {
      const atlasAny = window.atlas as unknown as Record<string, unknown>;
      const tradingApi = atlasAny?.trading as Record<string, () => Promise<{ success: boolean; error?: string }>> | undefined;
      
      if (tradingApi?.autonomousStart) {
        const result = await tradingApi.autonomousStart();
        if (!result.success) {
          setError(result.error || 'Failed to start');
        }
      }
      fetchStatus();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const stopTrading = async () => {
    try {
      const atlasAny = window.atlas as unknown as Record<string, unknown>;
      const tradingApi = atlasAny?.trading as Record<string, () => Promise<{ success: boolean; error?: string }>> | undefined;
      
      if (tradingApi?.autonomousStop) {
        await tradingApi.autonomousStop();
      }
      fetchStatus();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const pauseTrading = async () => {
    try {
      const atlasAny = window.atlas as unknown as Record<string, unknown>;
      const tradingApi = atlasAny?.trading as Record<string, () => Promise<{ success: boolean; error?: string }>> | undefined;
      
      if (tradingApi?.autonomousPause) {
        await tradingApi.autonomousPause();
      }
      fetchStatus();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const resumeTrading = async () => {
    try {
      const atlasAny = window.atlas as unknown as Record<string, unknown>;
      const tradingApi = atlasAny?.trading as Record<string, () => Promise<{ success: boolean; error?: string }>> | undefined;
      
      if (tradingApi?.autonomousResume) {
        await tradingApi.autonomousResume();
      }
      fetchStatus();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const triggerKillSwitch = async () => {
    try {
      const atlasAny = window.atlas as unknown as Record<string, unknown>;
      const tradingApi = atlasAny?.trading as Record<string, () => Promise<{ success: boolean; error?: string }>> | undefined;
      
      if (tradingApi?.killswitchTrigger) {
        await tradingApi.killswitchTrigger();
      }
      fetchStatus();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const resetKillSwitch = async () => {
    try {
      const atlasAny = window.atlas as unknown as Record<string, unknown>;
      const tradingApi = atlasAny?.trading as Record<string, () => Promise<{ success: boolean; error?: string }>> | undefined;
      
      if (tradingApi?.killswitchReset) {
        await tradingApi.killswitchReset();
      }
      fetchStatus();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  if (loading) {
    return (
      <div style={{ ...styles.container, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div>Loading trading dashboard...</div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.title}>
          <span>Trading Dashboard</span>
          {status && (
            <span
              style={{
                ...styles.statusBadge,
                backgroundColor: getStateColor(status.state) + '20',
                color: getStateColor(status.state),
              }}
            >
              {status.state.toUpperCase()}
            </span>
          )}
          <span
            style={{
              ...styles.statusBadge,
              backgroundColor: backendStatus.connected ? '#22c55e20' : '#ef444420',
              color: backendStatus.connected ? '#22c55e' : '#ef4444',
            }}
          >
            Backend: {backendStatus.connected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
        
        <div style={styles.flexRow}>
          {status?.state === 'stopped' || !status ? (
            <button
              style={{ ...styles.button, ...styles.successButton }}
              onClick={startTrading}
            >
              Start Trading
            </button>
          ) : status?.state === 'paused' ? (
            <button
              style={{ ...styles.button, ...styles.primaryButton }}
              onClick={resumeTrading}
            >
              Resume
            </button>
          ) : (
            <button
              style={{ ...styles.button, ...styles.outlineButton }}
              onClick={pauseTrading}
            >
              Pause
            </button>
          )}
          
          {status && status.state !== 'stopped' && (
            <button
              style={{ ...styles.button, ...styles.dangerButton }}
              onClick={stopTrading}
            >
              Stop
            </button>
          )}
          
          <button
            style={{
              ...styles.button,
              backgroundColor: status?.killSwitchStatus?.triggered ? '#f59e0b' : '#ef4444',
              color: '#ffffff',
            }}
            onClick={status?.killSwitchStatus?.triggered ? resetKillSwitch : triggerKillSwitch}
          >
            {status?.killSwitchStatus?.triggered ? 'Reset Kill Switch' : 'Kill Switch'}
          </button>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div
          style={{
            ...styles.card,
            backgroundColor: '#ef444420',
            borderColor: '#ef4444',
            marginBottom: '20px',
          }}
        >
          <div style={{ color: '#ef4444', fontWeight: 500 }}>Error</div>
          <div style={{ color: '#fca5a5', marginTop: '8px' }}>{error}</div>
        </div>
      )}

      {/* Kill Switch Alert */}
      {status?.killSwitchStatus?.triggered && (
        <div
          style={{
            ...styles.card,
            backgroundColor: '#f59e0b20',
            borderColor: '#f59e0b',
            marginBottom: '20px',
          }}
        >
          <div style={{ color: '#f59e0b', fontWeight: 500 }}>Kill Switch Triggered</div>
          <div style={{ color: '#fcd34d', marginTop: '8px' }}>{status.killSwitchStatus.reason}</div>
        </div>
      )}

      {/* Performance Overview */}
      <div style={styles.grid}>
        <div style={styles.card}>
          <div style={styles.cardTitle}>Today's P&L</div>
          <div
            style={{
              ...styles.metricValue,
              color: parseFloat(status?.todayPnl || '0') >= 0 ? '#22c55e' : '#ef4444',
            }}
          >
            {formatCurrency(status?.todayPnl || '0')}
          </div>
          <div style={styles.metricLabel}>
            {formatPercent(status?.todayPnlPercent || '0')}
          </div>
        </div>

        <div style={styles.card}>
          <div style={styles.cardTitle}>Today's Trades</div>
          <div style={styles.metricValue}>{status?.todayTrades || 0}</div>
          <div style={styles.metricLabel}>
            Win Rate: {formatPercent(parseFloat(status?.todayWinRate || '0') * 100)}
          </div>
        </div>

        <div style={styles.card}>
          <div style={styles.cardTitle}>Volume</div>
          <div style={styles.metricValue}>
            {formatCurrency(status?.todayVolume || '0')}
          </div>
          <div style={styles.metricLabel}>Total traded today</div>
        </div>

        <div style={styles.card}>
          <div style={styles.cardTitle}>Uptime</div>
          <div style={styles.metricValue}>
            {formatTime(status?.uptime || 0)}
          </div>
          <div style={styles.metricLabel}>
            {status?.cycleCount || 0} cycles completed
          </div>
        </div>
      </div>

      {/* Risk Metrics */}
      <div style={{ ...styles.card, marginBottom: '24px' }}>
        <div style={{ ...styles.flexBetween, marginBottom: '20px' }}>
          <div style={styles.cardTitle}>Risk Metrics</div>
          <div style={styles.riskMeter}>
            <span style={{ color: '#8b8b9a', fontSize: '14px' }}>Risk Score:</span>
            <span
              style={{
                fontSize: '24px',
                fontWeight: 700,
                color: getRiskColor(status?.riskMetrics?.riskScore || 0),
              }}
            >
              {status?.riskMetrics?.riskScore || 0}
            </span>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '20px' }}>
          <div>
            <div style={styles.metricLabel}>Current Exposure</div>
            <div style={{ fontSize: '18px', fontWeight: 600 }}>
              {formatCurrency(status?.riskMetrics?.currentExposure || '0')}
            </div>
            <div style={{ ...styles.metricLabel, color: '#6b7280' }}>
              {formatPercent(status?.riskMetrics?.exposurePercent || '0')} of portfolio
            </div>
          </div>

          <div>
            <div style={styles.metricLabel}>Drawdown</div>
            <div
              style={{
                fontSize: '18px',
                fontWeight: 600,
                color: parseFloat(status?.riskMetrics?.currentDrawdownPercent || '0') > 10 ? '#ef4444' : '#e0e0e0',
              }}
            >
              {formatPercent(parseFloat(status?.riskMetrics?.currentDrawdownPercent || '0') * -1)}
            </div>
          </div>

          <div>
            <div style={styles.metricLabel}>Consecutive Losses</div>
            <div
              style={{
                fontSize: '18px',
                fontWeight: 600,
                color: (status?.riskMetrics?.consecutiveLosses || 0) >= 3 ? '#f59e0b' : '#e0e0e0',
              }}
            >
              {status?.riskMetrics?.consecutiveLosses || 0}
            </div>
          </div>

          <div>
            <div style={styles.metricLabel}>Open Positions</div>
            <div style={{ fontSize: '18px', fontWeight: 600 }}>
              {status?.riskMetrics?.openPositions || 0}
            </div>
          </div>
        </div>
      </div>

      {/* Two Column Layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
        {/* Active Signals */}
        <div style={styles.card}>
          <div style={styles.cardTitle}>Active Signals ({signals.length})</div>
          {signals.length === 0 ? (
            <div style={{ color: '#6b7280', padding: '20px 0', textAlign: 'center' }}>
              No active signals
            </div>
          ) : (
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.tableHeader}>Symbol</th>
                  <th style={styles.tableHeader}>Side</th>
                  <th style={styles.tableHeader}>Confidence</th>
                  <th style={styles.tableHeader}>Source</th>
                </tr>
              </thead>
              <tbody>
                {signals.slice(0, 5).map((signal) => (
                  <tr key={signal.id}>
                    <td style={styles.tableCell}>{signal.symbol}</td>
                    <td style={styles.tableCell}>
                      <span
                        style={{
                          color: signal.side === 'long' ? '#22c55e' : '#ef4444',
                          fontWeight: 500,
                        }}
                      >
                        {signal.side.toUpperCase()}
                      </span>
                    </td>
                    <td style={styles.tableCell}>
                      {(parseFloat(signal.confidence) * 100).toFixed(0)}%
                    </td>
                    <td style={styles.tableCell}>{signal.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Recent Backtests */}
        <div style={styles.card}>
          <div style={styles.cardTitle}>Recent Backtests</div>
          {backtests.length === 0 ? (
            <div style={{ color: '#6b7280', padding: '20px 0', textAlign: 'center' }}>
              No recent backtests
            </div>
          ) : (
            <div>
              {backtests.slice(0, 5).map((bt) => (
                <div
                  key={bt.id}
                  style={{
                    padding: '12px 0',
                    borderBottom: '1px solid #1e1e2d',
                  }}
                >
                  <div style={styles.flexBetween}>
                    <span style={{ fontWeight: 500 }}>{bt.strategyId}</span>
                    <span
                      style={{
                        fontSize: '12px',
                        color: bt.status === 'completed' ? '#22c55e' : '#f59e0b',
                      }}
                    >
                      {bt.status}
                    </span>
                  </div>
                  {bt.status === 'running' && (
                    <div style={{ ...styles.progressBar, marginTop: '8px' }}>
                      <div
                        style={{
                          ...styles.progressFill,
                          width: `${bt.progress}%`,
                        }}
                      />
                    </div>
                  )}
                  {bt.metrics && (
                    <div
                      style={{
                        display: 'flex',
                        gap: '16px',
                        marginTop: '8px',
                        fontSize: '12px',
                        color: '#8b8b9a',
                      }}
                    >
                      <span>Return: {formatPercent(bt.metrics.totalReturn)}</span>
                      <span>Sharpe: {bt.metrics.sharpeRatio}</span>
                      <span>Win: {formatPercent(parseFloat(bt.metrics.winRate) * 100)}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default TradingDashboard;
