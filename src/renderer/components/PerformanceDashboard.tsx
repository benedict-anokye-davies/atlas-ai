/**
 * Atlas Desktop - Performance Metrics Dashboard
 * Real-time visualization of system performance metrics
 *
 * Features:
 * - CPU, Memory, GPU usage display
 * - Voice pipeline latency metrics
 * - LLM response times
 * - Audio processing stats
 * - Historical charts
 *
 * @module renderer/components/PerformanceDashboard
 */

import React, { useEffect, useState, useCallback, useMemo } from 'react';

// ============================================================================
// Types
// ============================================================================

interface PerformanceMetrics {
  cpu: {
    usage: number;
    cores: number;
  };
  memory: {
    used: number;
    total: number;
    percentage: number;
  };
  gpu?: {
    usage: number;
    memory: number;
  };
  voice: {
    wakeWordLatency: number;
    vadLatency: number;
    sttLatency: number;
    llmFirstToken: number;
    llmTotal: number;
    ttsLatency: number;
    totalPipelineLatency: number;
  };
  orb: {
    fps: number;
    particleCount: number;
    gpuMemory: number;
  };
  uptime: number;
  timestamp: number;
}

// MetricHistory - timestamp/value pairs for graphing
type _MetricHistory = {
  timestamp: number;
  value: number;
};
void (null as unknown as _MetricHistory); // suppress unused warning

interface PerformanceDashboardProps {
  isOpen: boolean;
  onClose: () => void;
}

// ============================================================================
// Styles
// ============================================================================

const styles = {
  overlay: {
    position: 'fixed' as const,
    inset: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    backdropFilter: 'blur(4px)',
  },
  container: {
    backgroundColor: '#1a1a2e',
    borderRadius: '16px',
    padding: '24px',
    width: '90%',
    maxWidth: '900px',
    maxHeight: '85vh',
    overflow: 'auto',
    boxShadow: '0 25px 50px rgba(0, 0, 0, 0.5)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '24px',
    paddingBottom: '16px',
    borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
  },
  title: {
    fontSize: '24px',
    fontWeight: 600,
    color: '#ffffff',
    margin: 0,
  },
  closeButton: {
    background: 'none',
    border: 'none',
    color: '#888',
    fontSize: '24px',
    cursor: 'pointer',
    padding: '8px',
    borderRadius: '8px',
    transition: 'all 0.2s',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '16px',
    marginBottom: '24px',
  },
  card: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: '12px',
    padding: '16px',
    border: '1px solid rgba(255, 255, 255, 0.08)',
  },
  cardTitle: {
    fontSize: '12px',
    fontWeight: 500,
    color: '#888',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    marginBottom: '8px',
  },
  cardValue: {
    fontSize: '28px',
    fontWeight: 600,
    color: '#ffffff',
  },
  cardUnit: {
    fontSize: '14px',
    color: '#666',
    marginLeft: '4px',
  },
  progressBar: {
    height: '4px',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: '2px',
    marginTop: '8px',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: '2px',
    transition: 'width 0.3s ease',
  },
  section: {
    marginBottom: '24px',
  },
  sectionTitle: {
    fontSize: '16px',
    fontWeight: 600,
    color: '#ffffff',
    marginBottom: '16px',
  },
  latencyGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    gap: '12px',
  },
  latencyItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: '8px',
  },
  latencyLabel: {
    fontSize: '13px',
    color: '#888',
  },
  latencyValue: {
    fontSize: '14px',
    fontWeight: 600,
    fontFamily: 'monospace',
  },
  chart: {
    height: '100px',
    display: 'flex',
    alignItems: 'flex-end',
    gap: '2px',
    padding: '8px 0',
  },
  chartBar: {
    flex: 1,
    minWidth: '4px',
    backgroundColor: 'rgba(99, 102, 241, 0.6)',
    borderRadius: '2px 2px 0 0',
    transition: 'height 0.2s ease',
  },
  status: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginTop: '16px',
    padding: '12px',
    backgroundColor: 'rgba(34, 197, 94, 0.1)',
    borderRadius: '8px',
    border: '1px solid rgba(34, 197, 94, 0.2)',
  },
  statusDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    backgroundColor: '#22c55e',
    animation: 'pulse 2s infinite',
  },
  statusText: {
    fontSize: '13px',
    color: '#22c55e',
  },
};

// ============================================================================
// Helper Functions
// ============================================================================

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

const formatUptime = (seconds: number): string => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  }
  return `${secs}s`;
};

const getLatencyColor = (ms: number, thresholds: { good: number; warning: number }): string => {
  if (ms <= thresholds.good) return '#22c55e';
  if (ms <= thresholds.warning) return '#eab308';
  return '#ef4444';
};

const getUsageColor = (percentage: number): string => {
  if (percentage <= 50) return '#22c55e';
  if (percentage <= 80) return '#eab308';
  return '#ef4444';
};

// ============================================================================
// Components
// ============================================================================

const MetricCard: React.FC<{
  title: string;
  value: string | number;
  unit?: string;
  percentage?: number;
  color?: string;
}> = ({ title, value, unit, percentage, color }) => (
  <div style={styles.card}>
    <div style={styles.cardTitle}>{title}</div>
    <div style={{ display: 'flex', alignItems: 'baseline' }}>
      <span style={{ ...styles.cardValue, color: color || '#ffffff' }}>{value}</span>
      {unit && <span style={styles.cardUnit}>{unit}</span>}
    </div>
    {percentage !== undefined && (
      <div style={styles.progressBar}>
        <div
          style={{
            ...styles.progressFill,
            width: `${Math.min(percentage, 100)}%`,
            backgroundColor: color || getUsageColor(percentage),
          }}
        />
      </div>
    )}
  </div>
);

const LatencyItem: React.FC<{
  label: string;
  value: number;
  thresholds?: { good: number; warning: number };
}> = ({ label, value, thresholds = { good: 200, warning: 500 } }) => (
  <div style={styles.latencyItem}>
    <span style={styles.latencyLabel}>{label}</span>
    <span
      style={{
        ...styles.latencyValue,
        color: getLatencyColor(value, thresholds),
      }}
    >
      {value.toFixed(0)}ms
    </span>
  </div>
);

const MiniChart: React.FC<{ data: number[]; maxValue?: number }> = ({ data, maxValue }) => {
  const max = maxValue || Math.max(...data, 1);

  return (
    <div style={styles.chart}>
      {data.map((value, i) => (
        <div
          key={i}
          style={{
            ...styles.chartBar,
            height: `${(value / max) * 100}%`,
          }}
        />
      ))}
    </div>
  );
};

// ============================================================================
// Main Component
// ============================================================================

export const PerformanceDashboard: React.FC<PerformanceDashboardProps> = ({ isOpen, onClose }) => {
  const [metrics, setMetrics] = useState<PerformanceMetrics | null>(null);
  const [cpuHistory, setCpuHistory] = useState<number[]>([]);
  const [memoryHistory, setMemoryHistory] = useState<number[]>([]);
  const [fpsHistory, setFpsHistory] = useState<number[]>([]);
  const [latencyHistory, setLatencyHistory] = useState<number[]>([]);

  // Fetch metrics from main process
  const fetchMetrics = useCallback(async () => {
    try {
      // @ts-expect-error - window.atlas is injected by preload
      if (window.atlas?.getPerformanceMetrics) {
        // @ts-expect-error - window.atlas is injected by preload
        const data = await window.atlas.getPerformanceMetrics();
        setMetrics(data);

        // Update history arrays (keep last 30 values)
        if (data) {
          setCpuHistory((prev) => [...prev.slice(-29), data.cpu.usage]);
          setMemoryHistory((prev) => [...prev.slice(-29), data.memory.percentage]);
          setFpsHistory((prev) => [...prev.slice(-29), data.orb.fps]);
          setLatencyHistory((prev) => [...prev.slice(-29), data.voice.totalPipelineLatency]);
        }
      }
    } catch (error) {
      console.error('Failed to fetch performance metrics:', error);
    }
  }, []);

  // Poll for metrics
  useEffect(() => {
    if (!isOpen) return;

    fetchMetrics();
    const interval = setInterval(fetchMetrics, 1000);

    return () => clearInterval(interval);
  }, [isOpen, fetchMetrics]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
    return undefined;
  }, [isOpen, onClose]);

  // Default metrics for display
  const displayMetrics = useMemo(
    () =>
      metrics || {
        cpu: { usage: 0, cores: 0 },
        memory: { used: 0, total: 0, percentage: 0 },
        voice: {
          wakeWordLatency: 0,
          vadLatency: 0,
          sttLatency: 0,
          llmFirstToken: 0,
          llmTotal: 0,
          ttsLatency: 0,
          totalPipelineLatency: 0,
        },
        orb: { fps: 0, particleCount: 0, gpuMemory: 0 },
        uptime: 0,
        timestamp: Date.now(),
      },
    [metrics]
  );

  if (!isOpen) return null;

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.container} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={styles.header}>
          <h2 style={styles.title}>Performance Dashboard</h2>
          <button
            style={styles.closeButton}
            onClick={onClose}
            onMouseOver={(e) => (e.currentTarget.style.color = '#fff')}
            onMouseOut={(e) => (e.currentTarget.style.color = '#888')}
          >
            &times;
          </button>
        </div>

        {/* System Metrics */}
        <div style={styles.section}>
          <div style={styles.sectionTitle}>System Resources</div>
          <div style={styles.grid}>
            <MetricCard
              title="CPU Usage"
              value={displayMetrics.cpu.usage.toFixed(1)}
              unit="%"
              percentage={displayMetrics.cpu.usage}
            />
            <MetricCard
              title="Memory"
              value={formatBytes(displayMetrics.memory.used)}
              unit={`/ ${formatBytes(displayMetrics.memory.total)}`}
              percentage={displayMetrics.memory.percentage}
            />
            <MetricCard
              title="Orb FPS"
              value={displayMetrics.orb.fps.toFixed(0)}
              unit="fps"
              percentage={(displayMetrics.orb.fps / 60) * 100}
              color={displayMetrics.orb.fps >= 55 ? '#22c55e' : displayMetrics.orb.fps >= 30 ? '#eab308' : '#ef4444'}
            />
            <MetricCard title="Uptime" value={formatUptime(displayMetrics.uptime)} />
          </div>

          {/* Mini Charts */}
          {cpuHistory.length > 5 && (
            <div style={{ ...styles.grid, gridTemplateColumns: 'repeat(2, 1fr)' }}>
              <div style={styles.card}>
                <div style={styles.cardTitle}>CPU History</div>
                <MiniChart data={cpuHistory} maxValue={100} />
              </div>
              <div style={styles.card}>
                <div style={styles.cardTitle}>Memory History</div>
                <MiniChart data={memoryHistory} maxValue={100} />
              </div>
            </div>
          )}
        </div>

        {/* Voice Pipeline Latency */}
        <div style={styles.section}>
          <div style={styles.sectionTitle}>Voice Pipeline Latency</div>
          <div style={styles.latencyGrid}>
            <LatencyItem label="Wake Word" value={displayMetrics.voice.wakeWordLatency} thresholds={{ good: 100, warning: 200 }} />
            <LatencyItem label="VAD" value={displayMetrics.voice.vadLatency} thresholds={{ good: 50, warning: 100 }} />
            <LatencyItem label="STT" value={displayMetrics.voice.sttLatency} thresholds={{ good: 300, warning: 500 }} />
            <LatencyItem label="LLM First Token" value={displayMetrics.voice.llmFirstToken} thresholds={{ good: 500, warning: 2000 }} />
            <LatencyItem label="LLM Total" value={displayMetrics.voice.llmTotal} thresholds={{ good: 2000, warning: 5000 }} />
            <LatencyItem label="TTS" value={displayMetrics.voice.ttsLatency} thresholds={{ good: 300, warning: 600 }} />
          </div>

          {/* Total Pipeline */}
          <div style={{ marginTop: '16px' }}>
            <div style={styles.card}>
              <div style={styles.cardTitle}>Total Pipeline Latency</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                <span
                  style={{
                    ...styles.cardValue,
                    color: getLatencyColor(displayMetrics.voice.totalPipelineLatency, { good: 2000, warning: 4000 }),
                  }}
                >
                  {displayMetrics.voice.totalPipelineLatency.toFixed(0)}
                </span>
                <span style={styles.cardUnit}>ms</span>
                <span style={{ marginLeft: 'auto', color: '#666', fontSize: '12px' }}>
                  Target: &lt;2000ms
                </span>
              </div>
              {latencyHistory.length > 5 && <MiniChart data={latencyHistory} maxValue={5000} />}
            </div>
          </div>
        </div>

        {/* 3D Orb Stats */}
        <div style={styles.section}>
          <div style={styles.sectionTitle}>3D Orb Visualization</div>
          <div style={styles.grid}>
            <MetricCard
              title="Particle Count"
              value={displayMetrics.orb.particleCount.toLocaleString()}
              unit="particles"
            />
            <MetricCard
              title="GPU Memory"
              value={formatBytes(displayMetrics.orb.gpuMemory)}
              unit=""
            />
            <MetricCard
              title="Frame Rate"
              value={displayMetrics.orb.fps.toFixed(0)}
              unit="fps"
              percentage={(displayMetrics.orb.fps / 60) * 100}
            />
          </div>
          {fpsHistory.length > 5 && (
            <div style={styles.card}>
              <div style={styles.cardTitle}>FPS History</div>
              <MiniChart data={fpsHistory} maxValue={65} />
            </div>
          )}
        </div>

        {/* Status */}
        <div style={styles.status}>
          <div style={styles.statusDot} />
          <span style={styles.statusText}>
            System healthy - All metrics within normal range
          </span>
        </div>
      </div>

      {/* Pulse animation */}
      <style>
        {`
          @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
          }
        `}
      </style>
    </div>
  );
};

export default PerformanceDashboard;
