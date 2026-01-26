/**
 * Trading Status Indicator
 * 
 * Small indicator component showing:
 * - Go backend connection status
 * - WebSocket connection status
 * - Trading agent status (running/paused/stopped)
 * - Today's P&L summary
 */

import React, { useState, useEffect, useCallback } from 'react';

interface TradingStatus {
  backendConnected: boolean;
  wsConnected: boolean;
  agentStatus: 'running' | 'paused' | 'stopped' | 'error' | 'unknown';
  todayPnL: number;
  openPositions: number;
  regime: string | null;
}

const styles = {
  container: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '8px 16px',
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    borderRadius: '8px',
    backdropFilter: 'blur(8px)',
  } as React.CSSProperties,
  
  statusDot: (connected: boolean, error?: boolean) => ({
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    backgroundColor: error ? '#ef4444' : connected ? '#22c55e' : '#f59e0b',
    boxShadow: connected && !error ? '0 0 8px rgba(34, 197, 94, 0.5)' : 'none',
  } as React.CSSProperties),
  
  section: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  } as React.CSSProperties,
  
  label: {
    fontSize: '11px',
    color: '#8b8b8b',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  } as React.CSSProperties,
  
  value: (positive?: boolean, negative?: boolean) => ({
    fontSize: '13px',
    fontWeight: 500,
    color: positive ? '#22c55e' : negative ? '#ef4444' : '#e0e0e0',
  } as React.CSSProperties),
  
  separator: {
    width: '1px',
    height: '16px',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  } as React.CSSProperties,
  
  agentStatus: (status: string) => ({
    padding: '2px 8px',
    borderRadius: '4px',
    fontSize: '11px',
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    backgroundColor: 
      status === 'running' ? 'rgba(34, 197, 94, 0.2)' :
      status === 'paused' ? 'rgba(245, 158, 11, 0.2)' :
      status === 'error' ? 'rgba(239, 68, 68, 0.2)' :
      'rgba(100, 100, 100, 0.2)',
    color:
      status === 'running' ? '#22c55e' :
      status === 'paused' ? '#f59e0b' :
      status === 'error' ? '#ef4444' :
      '#8b8b8b',
  } as React.CSSProperties),
};

export const TradingStatusIndicator: React.FC = () => {
  const [status, setStatus] = useState<TradingStatus>({
    backendConnected: false,
    wsConnected: false,
    agentStatus: 'unknown',
    todayPnL: 0,
    openPositions: 0,
    regime: null,
  });
  const [expanded, setExpanded] = useState(false);

  // Fetch initial status
  const fetchStatus = useCallback(async () => {
    try {
      const atlasAny = window.atlas as unknown as Record<string, unknown>;
      if (!atlasAny?.trading) return;

      const trading = atlasAny.trading as {
        backendStatus?: () => Promise<{ success: boolean; data?: { connected: boolean } }>;
        autonomousStatus?: () => Promise<{ success: boolean; data?: { state: string; todayPnl: string } }>;
      };

      // Get backend status
      const backendResult = await trading.backendStatus?.();
      const autonomousResult = await trading.autonomousStatus?.();

      setStatus((prev) => ({
        ...prev,
        backendConnected: backendResult?.data?.connected ?? false,
        agentStatus: (autonomousResult?.data?.state as TradingStatus['agentStatus']) ?? 'unknown',
        todayPnL: parseFloat(autonomousResult?.data?.todayPnl ?? '0'),
      }));
    } catch (error) {
      console.error('Failed to fetch trading status:', error);
    }
  }, []);

  // Set up real-time listeners
  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 30000); // Refresh every 30s

    // Real-time WebSocket status updates
    const atlasAny = window.atlas as unknown as Record<string, unknown>;
    const trading = atlasAny?.trading as {
      onWsStatus?: (callback: (status: { connected: boolean }) => void) => () => void;
      onTrade?: (callback: (trade: unknown) => void) => () => void;
    } | undefined;

    const cleanups: (() => void)[] = [];

    if (trading?.onWsStatus) {
      cleanups.push(
        trading.onWsStatus((wsStatus) => {
          setStatus((prev) => ({ ...prev, wsConnected: wsStatus.connected }));
        })
      );
    }

    if (trading?.onTrade) {
      cleanups.push(
        trading.onTrade(() => {
          // Refresh on new trade
          fetchStatus();
        })
      );
    }

    return () => {
      clearInterval(interval);
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [fetchStatus]);

  const formatPnL = (pnl: number) => {
    const prefix = pnl >= 0 ? '+' : '';
    return `${prefix}£${Math.abs(pnl).toFixed(2)}`;
  };

  return (
    <div 
      style={styles.container}
      onClick={() => setExpanded(!expanded)}
      title="Click for details"
    >
      {/* Connection Status */}
      <div style={styles.section}>
        <div style={styles.statusDot(status.backendConnected)} />
        <span style={styles.label}>Backend</span>
      </div>

      <div style={styles.separator} />

      {/* WebSocket Status */}
      <div style={styles.section}>
        <div style={styles.statusDot(status.wsConnected)} />
        <span style={styles.label}>WS</span>
      </div>

      <div style={styles.separator} />

      {/* Agent Status */}
      <div style={styles.section}>
        <span style={styles.agentStatus(status.agentStatus)}>
          {status.agentStatus}
        </span>
      </div>

      <div style={styles.separator} />

      {/* Today's P&L */}
      <div style={styles.section}>
        <span style={styles.label}>Today</span>
        <span style={styles.value(status.todayPnL > 0, status.todayPnL < 0)}>
          {formatPnL(status.todayPnL)}
        </span>
      </div>

      {/* Expanded details */}
      {expanded && (
        <>
          <div style={styles.separator} />
          <div style={styles.section}>
            <span style={styles.label}>Positions</span>
            <span style={styles.value()}>{status.openPositions}</span>
          </div>
          {status.regime && (
            <>
              <div style={styles.separator} />
              <div style={styles.section}>
                <span style={styles.label}>Regime</span>
                <span style={styles.value()}>{status.regime}</span>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
};

export default TradingStatusIndicator;
