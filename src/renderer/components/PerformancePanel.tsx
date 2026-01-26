/**
 * Atlas Desktop - Performance Panel Component
 * Real-time performance monitoring dashboard with historical graphs
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { usePerformanceMonitor, getPerformanceRating } from '../hooks';

// ============================================================================
// Types
// ============================================================================

interface DataPoint {
  timestamp: number;
  value: number;
}

interface PerformanceMetric {
  name: string;
  current: number;
  avg: number;
  min: number;
  max: number;
  unit: string;
}

interface MemoryMetrics {
  heapUsed: number;
  heapTotal: number;
  rss: number;
  percentUsed: number;
}

interface CPUMetrics {
  usage: number;
  cores: number;
}

interface IPCStats {
  avgLatency: number;
  maxLatency: number;
  messageCount: number;
  errorCount: number;
}

interface VoiceTimings {
  wakeWordDetection?: number;
  sttLatency?: number;
  llmFirstToken?: number;
  ttsFirstAudio?: number;
  totalResponseTime?: number;
}

interface Bottleneck {
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  value: number;
  threshold: number;
  recommendation: string;
}

interface PerformanceSnapshot {
  timestamp: number;
  memory: MemoryMetrics;
  cpu: CPUMetrics;
  ipc: IPCStats;
  voice?: VoiceTimings;
  bottlenecks: Bottleneck[];
}

interface PerformanceData {
  metrics: Record<string, PerformanceMetric>;
  snapshots: PerformanceSnapshot[];
  status: {
    enabled: boolean;
    running: boolean;
    uptime: number;
    snapshotCount: number;
  };
}

// ============================================================================
// Props
// ============================================================================

interface PerformancePanelProps {
  visible?: boolean;
  onClose?: () => void;
  refreshInterval?: number;
  historyLength?: number;
}

// ============================================================================
// Subcomponents
// ============================================================================

/**
 * Mini sparkline chart for metric visualization
 */
function Sparkline({
  data,
  width = 120,
  height = 30,
  color = '#22d3ee',
  strokeWidth = 1.5,
  showDots = false,
}: {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  strokeWidth?: number;
  showDots?: boolean;
}) {
  if (data.length < 2) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const points = data.map((value, index) => {
    const x = (index / (data.length - 1)) * width;
    const y = height - ((value - min) / range) * (height - 4) - 2;
    return `${x},${y}`;
  });

  const pathD = `M${points.join(' L')}`;

  return (
    <svg width={width} height={height} className="sparkline">
      <path
        d={pathD}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {showDots &&
        data.slice(-1).map((value, i) => {
          const x = width;
          const y = height - ((value - min) / range) * (height - 4) - 2;
          return <circle key={i} cx={x} cy={y} r={3} fill={color} />;
        })}
    </svg>
  );
}

/**
 * Metric card component
 */
function MetricCard({
  label,
  value,
  unit,
  history,
  color,
  status,
}: {
  label: string;
  value: number | string;
  unit?: string;
  history?: number[];
  color?: string;
  status?: 'good' | 'warning' | 'critical';
}) {
  const statusColors = {
    good: '#4ade80',
    warning: '#facc15',
    critical: '#f87171',
  };

  const displayColor = status ? statusColors[status] : color || '#22d3ee';

  return (
    <div className="perf-metric-card">
      <div className="metric-header">
        <span className="metric-label">{label}</span>
        <span className="metric-status" style={{ backgroundColor: displayColor }} />
      </div>
      <div className="metric-value" style={{ color: displayColor }}>
        {typeof value === 'number' ? value.toFixed(1) : value}
        {unit && <span className="metric-unit">{unit}</span>}
      </div>
      {history && history.length > 1 && (
        <div className="metric-sparkline">
          <Sparkline data={history} color={displayColor} showDots />
        </div>
      )}
    </div>
  );
}

/**
 * Section header component
 */
function SectionHeader({ title, icon }: { title: string; icon?: string }) {
  return (
    <div className="perf-section-header">
      {icon && <span className="section-icon">{icon}</span>}
      <span className="section-title">{title}</span>
    </div>
  );
}

/**
 * Bottleneck alert component
 */
function BottleneckAlert({ bottleneck }: { bottleneck: Bottleneck }) {
  const severityColors = {
    low: '#60a5fa',
    medium: '#facc15',
    high: '#fb923c',
    critical: '#f87171',
  };

  return (
    <div
      className="perf-bottleneck"
      style={{ borderLeftColor: severityColors[bottleneck.severity] }}
    >
      <div className="bottleneck-header">
        <span className="bottleneck-type">{bottleneck.type.toUpperCase()}</span>
        <span
          className="bottleneck-severity"
          style={{ color: severityColors[bottleneck.severity] }}
        >
          {bottleneck.severity}
        </span>
      </div>
      <p className="bottleneck-description">{bottleneck.description}</p>
      <p className="bottleneck-value">
        Current: {bottleneck.value.toFixed(1)} | Threshold: {bottleneck.threshold}
      </p>
      <p className="bottleneck-recommendation">{bottleneck.recommendation}</p>
    </div>
  );
}

/**
 * Voice pipeline timing breakdown
 */
function VoiceTimingBreakdown({ timings }: { timings: VoiceTimings }) {
  const stages = [
    { key: 'wakeWordDetection', label: 'Wake Word', target: 200 },
    { key: 'sttLatency', label: 'STT', target: 300 },
    { key: 'llmFirstToken', label: 'LLM First Token', target: 2000 },
    { key: 'ttsFirstAudio', label: 'TTS First Audio', target: 500 },
    { key: 'totalResponseTime', label: 'Total Response', target: 3000 },
  ];

  return (
    <div className="voice-timing-breakdown">
      {stages.map(({ key, label, target }) => {
        const value = timings[key as keyof VoiceTimings];
        if (value === undefined) return null;

        const ratio = value / target;
        const status = ratio <= 1 ? 'good' : ratio <= 1.5 ? 'warning' : 'critical';
        const barWidth = Math.min(100, ratio * 100);

        return (
          <div key={key} className="timing-row">
            <span className="timing-label">{label}</span>
            <div className="timing-bar-container">
              <div className={`timing-bar timing-${status}`} style={{ width: `${barWidth}%` }} />
              <div className="timing-target" style={{ left: '100%' }} />
            </div>
            <span className="timing-value">{value.toFixed(0)}ms</span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Historical graph component
 */
function HistoryGraph({
  data,
  label,
  unit,
  width = 280,
  height = 100,
  color = '#22d3ee',
  target,
}: {
  data: DataPoint[];
  label: string;
  unit: string;
  width?: number;
  height?: number;
  color?: string;
  target?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || data.length < 2) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    // Clear
    ctx.clearRect(0, 0, width, height);

    // Calculate bounds
    const values = data.map((d) => d.value);
    let min = Math.min(...values);
    let max = Math.max(...values);
    if (target !== undefined) {
      min = Math.min(min, target);
      max = Math.max(max, target);
    }
    const range = max - min || 1;
    const padding = { top: 5, bottom: 20, left: 10, right: 10 };
    const graphWidth = width - padding.left - padding.right;
    const graphHeight = height - padding.top - padding.bottom;

    // Draw target line if specified
    if (target !== undefined) {
      const targetY = padding.top + graphHeight - ((target - min) / range) * graphHeight;
      ctx.strokeStyle = 'rgba(250, 204, 21, 0.5)';
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padding.left, targetY);
      ctx.lineTo(width - padding.right, targetY);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Draw data line
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();

    data.forEach((point, index) => {
      const x = padding.left + (index / (data.length - 1)) * graphWidth;
      const y = padding.top + graphHeight - ((point.value - min) / range) * graphHeight;

      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });

    ctx.stroke();

    // Draw gradient fill
    const gradient = ctx.createLinearGradient(0, padding.top, 0, height - padding.bottom);
    gradient.addColorStop(0, `${color}40`);
    gradient.addColorStop(1, `${color}05`);

    ctx.fillStyle = gradient;
    ctx.beginPath();

    data.forEach((point, index) => {
      const x = padding.left + (index / (data.length - 1)) * graphWidth;
      const y = padding.top + graphHeight - ((point.value - min) / range) * graphHeight;

      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });

    ctx.lineTo(width - padding.right, height - padding.bottom);
    ctx.lineTo(padding.left, height - padding.bottom);
    ctx.closePath();
    ctx.fill();

    // Draw current value
    const lastValue = data[data.length - 1]?.value ?? 0;
    ctx.fillStyle = '#fff';
    ctx.font = '10px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`${lastValue.toFixed(1)}${unit}`, width - padding.right, height - 5);

    // Draw min/max
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.font = '9px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`${max.toFixed(0)}`, padding.left, padding.top + 8);
    ctx.fillText(`${min.toFixed(0)}`, padding.left, height - padding.bottom - 2);
  }, [data, width, height, color, target, unit]);

  return (
    <div className="history-graph">
      <div className="graph-label">{label}</div>
      <canvas ref={canvasRef} style={{ width, height }} className="graph-canvas" />
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function PerformancePanel({
  visible = false,
  onClose,
  refreshInterval = 1000,
  historyLength = 60,
}: PerformancePanelProps) {
  // Local performance metrics from renderer
  const localMetrics = usePerformanceMonitor({ enabled: visible });

  // State for main process metrics
  const [performanceData, setPerformanceData] = useState<PerformanceData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'memory' | 'voice' | 'history'>(
    'overview'
  );
  const [isExporting, setIsExporting] = useState(false);

  // History tracking for graphs
  const [fpsHistory, setFpsHistory] = useState<number[]>([]);
  const [memoryHistory, setMemoryHistory] = useState<DataPoint[]>([]);
  const [cpuHistory, setCpuHistory] = useState<DataPoint[]>([]);
  const [ipcHistory, setIpcHistory] = useState<DataPoint[]>([]);

  // Fetch performance data from main process
  const fetchPerformanceData = useCallback(async () => {
    try {
      const result = await window.atlas?.invoke<{
        success: boolean;
        data?: PerformanceData;
        error?: string;
      }>('atlas:get-performance-data');

      if (result?.success && result.data) {
        setPerformanceData(result.data);
        setError(null);

        // Update history arrays
        if (result.data.snapshots.length > 0) {
          const latest = result.data.snapshots[result.data.snapshots.length - 1];

          setMemoryHistory((prev) => {
            const newHistory = [
              ...prev,
              { timestamp: latest.timestamp, value: latest.memory.heapUsed },
            ];
            return newHistory.slice(-historyLength);
          });

          setCpuHistory((prev) => {
            const newHistory = [...prev, { timestamp: latest.timestamp, value: latest.cpu.usage }];
            return newHistory.slice(-historyLength);
          });

          setIpcHistory((prev) => {
            const newHistory = [
              ...prev,
              { timestamp: latest.timestamp, value: latest.ipc.avgLatency },
            ];
            return newHistory.slice(-historyLength);
          });
        }
      } else {
        setError(result?.error || 'Failed to fetch performance data');
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, [historyLength]);

  // Track FPS history locally
  useEffect(() => {
    if (!visible) return;

    setFpsHistory((prev) => {
      const newHistory = [...prev, localMetrics.fps];
      return newHistory.slice(-historyLength);
    });
  }, [localMetrics.fps, visible, historyLength]);

  // Polling for performance data
  useEffect(() => {
    if (!visible) return;

    fetchPerformanceData();
    const interval = setInterval(fetchPerformanceData, refreshInterval);

    return () => clearInterval(interval);
  }, [visible, refreshInterval, fetchPerformanceData]);

  // Export report handler
  const handleExportReport = useCallback(async () => {
    setIsExporting(true);
    try {
      const result = await window.atlas?.invoke<{
        success: boolean;
        data?: string;
        error?: string;
      }>('atlas:export-performance-report');
      if (result?.success) {
        // eslint-disable-next-line no-console
        console.log('[PerformancePanel] Report exported:', result.data);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[PerformancePanel] Export failed:', err);
    } finally {
      setIsExporting(false);
    }
  }, []);

  // Calculate performance status
  const fpsStatus = useMemo(() => {
    const rating = getPerformanceRating(localMetrics.fps);
    if (rating === 'excellent' || rating === 'good') return 'good';
    if (rating === 'fair') return 'warning';
    return 'critical';
  }, [localMetrics.fps]);

  // Get latest snapshot
  const latestSnapshot = performanceData?.snapshots[performanceData.snapshots.length - 1];
  const bottlenecks = latestSnapshot?.bottlenecks ?? [];

  if (!visible) return null;

  return (
    <div className="performance-panel">
      {/* Header */}
      <div className="perf-header">
        <h2>Performance Monitor</h2>
        <div className="perf-header-actions">
          <button
            className="perf-btn"
            onClick={handleExportReport}
            disabled={isExporting}
            title="Export Performance Report"
          >
            {isExporting ? 'Exporting...' : 'Export Report'}
          </button>
          {onClose && (
            <button className="perf-close-btn" onClick={onClose} aria-label="Close">
              X
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="perf-tabs">
        {(['overview', 'memory', 'voice', 'history'] as const).map((tab) => (
          <button
            key={tab}
            className={`perf-tab ${activeTab === tab ? 'active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="perf-content">
        {isLoading ? (
          <div className="perf-loading">Loading performance data...</div>
        ) : error ? (
          <div className="perf-error">
            <p>Error: {error}</p>
            <button onClick={fetchPerformanceData}>Retry</button>
          </div>
        ) : (
          <>
            {/* Overview Tab */}
            {activeTab === 'overview' && (
              <div className="perf-tab-content">
                {/* FPS Section */}
                <SectionHeader title="Render Performance" icon="*" />
                <div className="metrics-grid">
                  <MetricCard
                    label="FPS"
                    value={localMetrics.fps}
                    unit="fps"
                    history={fpsHistory}
                    status={fpsStatus}
                  />
                  <MetricCard
                    label="Avg FPS"
                    value={localMetrics.avgFps}
                    unit="fps"
                    color="#60a5fa"
                  />
                  <MetricCard
                    label="Frame Time"
                    value={localMetrics.frameTime}
                    unit="ms"
                    status={
                      localMetrics.frameTime > 33
                        ? 'critical'
                        : localMetrics.frameTime > 20
                          ? 'warning'
                          : 'good'
                    }
                  />
                  <MetricCard
                    label="Memory (JS)"
                    value={localMetrics.memoryUsage}
                    unit="MB"
                    color="#a78bfa"
                  />
                </div>

                {/* System Resources */}
                <SectionHeader title="System Resources" icon="@" />
                <div className="metrics-grid">
                  {latestSnapshot && (
                    <>
                      <MetricCard
                        label="Heap Used"
                        value={latestSnapshot.memory.heapUsed}
                        unit="MB"
                        history={memoryHistory.map((d) => d.value)}
                        status={
                          latestSnapshot.memory.percentUsed > 80
                            ? 'critical'
                            : latestSnapshot.memory.percentUsed > 60
                              ? 'warning'
                              : 'good'
                        }
                      />
                      <MetricCard
                        label="RSS"
                        value={latestSnapshot.memory.rss}
                        unit="MB"
                        color="#f472b6"
                      />
                      <MetricCard
                        label="CPU Usage"
                        value={latestSnapshot.cpu.usage}
                        unit="%"
                        history={cpuHistory.map((d) => d.value)}
                        status={
                          latestSnapshot.cpu.usage > 80
                            ? 'critical'
                            : latestSnapshot.cpu.usage > 50
                              ? 'warning'
                              : 'good'
                        }
                      />
                      <MetricCard
                        label="IPC Latency"
                        value={latestSnapshot.ipc.avgLatency}
                        unit="ms"
                        history={ipcHistory.map((d) => d.value)}
                        status={
                          latestSnapshot.ipc.avgLatency > 50
                            ? 'critical'
                            : latestSnapshot.ipc.avgLatency > 20
                              ? 'warning'
                              : 'good'
                        }
                      />
                    </>
                  )}
                </div>

                {/* Bottlenecks */}
                {bottlenecks.length > 0 && (
                  <>
                    <SectionHeader title={`Bottlenecks (${bottlenecks.length})`} icon="!" />
                    <div className="bottlenecks-list">
                      {bottlenecks.map((bottleneck, index) => (
                        <BottleneckAlert key={index} bottleneck={bottleneck} />
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Memory Tab */}
            {activeTab === 'memory' && (
              <div className="perf-tab-content">
                <SectionHeader title="Memory Usage" icon="#" />
                {latestSnapshot && (
                  <div className="memory-details">
                    <div className="memory-bar">
                      <div
                        className="memory-bar-fill"
                        style={{
                          width: `${latestSnapshot.memory.percentUsed}%`,
                          backgroundColor:
                            latestSnapshot.memory.percentUsed > 80
                              ? '#f87171'
                              : latestSnapshot.memory.percentUsed > 60
                                ? '#facc15'
                                : '#4ade80',
                        }}
                      />
                      <span className="memory-bar-text">
                        {latestSnapshot.memory.heapUsed}MB / {latestSnapshot.memory.heapTotal}MB (
                        {latestSnapshot.memory.percentUsed.toFixed(1)}%)
                      </span>
                    </div>

                    <div className="metrics-grid memory-metrics">
                      <MetricCard
                        label="Heap Used"
                        value={latestSnapshot.memory.heapUsed}
                        unit="MB"
                      />
                      <MetricCard
                        label="Heap Total"
                        value={latestSnapshot.memory.heapTotal}
                        unit="MB"
                      />
                      <MetricCard label="RSS" value={latestSnapshot.memory.rss} unit="MB" />
                      <MetricCard
                        label="Percent Used"
                        value={latestSnapshot.memory.percentUsed}
                        unit="%"
                      />
                    </div>

                    <HistoryGraph
                      data={memoryHistory}
                      label="Memory History"
                      unit="MB"
                      color="#a78bfa"
                      target={500}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Voice Tab */}
            {activeTab === 'voice' && (
              <div className="perf-tab-content">
                <SectionHeader title="Voice Pipeline Timings" icon="~" />
                {latestSnapshot?.voice ? (
                  <>
                    <VoiceTimingBreakdown timings={latestSnapshot.voice} />

                    <div className="voice-targets">
                      <h4>Performance Targets</h4>
                      <ul>
                        <li>Wake word detection: &lt;200ms</li>
                        <li>STT latency: &lt;300ms</li>
                        <li>LLM first token: &lt;2s</li>
                        <li>TTS first audio: &lt;500ms</li>
                        <li>Total response: &lt;3s</li>
                      </ul>
                    </div>
                  </>
                ) : (
                  <div className="no-voice-data">
                    <p>No voice pipeline timing data available.</p>
                    <p>Voice timings are recorded during active voice interactions.</p>
                  </div>
                )}

                {/* IPC Stats */}
                <SectionHeader title="IPC Statistics" icon="&lt;&gt;" />
                {latestSnapshot && (
                  <div className="metrics-grid">
                    <MetricCard
                      label="Avg Latency"
                      value={latestSnapshot.ipc.avgLatency}
                      unit="ms"
                    />
                    <MetricCard
                      label="Max Latency"
                      value={latestSnapshot.ipc.maxLatency}
                      unit="ms"
                    />
                    <MetricCard label="Messages" value={latestSnapshot.ipc.messageCount} />
                    <MetricCard
                      label="Errors"
                      value={latestSnapshot.ipc.errorCount}
                      status={latestSnapshot.ipc.errorCount > 0 ? 'warning' : 'good'}
                    />
                  </div>
                )}
              </div>
            )}

            {/* History Tab */}
            {activeTab === 'history' && (
              <div className="perf-tab-content">
                <SectionHeader title="Performance History" icon="$" />

                <div className="history-graphs">
                  <HistoryGraph
                    data={fpsHistory.map((value, index) => ({
                      timestamp: Date.now() - (fpsHistory.length - index) * 1000,
                      value,
                    }))}
                    label="FPS"
                    unit="fps"
                    color="#22d3ee"
                    target={60}
                  />

                  <HistoryGraph
                    data={memoryHistory}
                    label="Memory (MB)"
                    unit="MB"
                    color="#a78bfa"
                    target={500}
                  />

                  <HistoryGraph
                    data={cpuHistory}
                    label="CPU (%)"
                    unit="%"
                    color="#fb923c"
                    target={50}
                  />

                  <HistoryGraph
                    data={ipcHistory}
                    label="IPC Latency (ms)"
                    unit="ms"
                    color="#4ade80"
                    target={20}
                  />
                </div>

                <div className="history-stats">
                  <h4>Session Statistics</h4>
                  {performanceData?.status && (
                    <ul>
                      <li>Uptime: {Math.round(performanceData.status.uptime / 1000)}s</li>
                      <li>Snapshots: {performanceData.status.snapshotCount}</li>
                      <li>Profiler: {performanceData.status.running ? 'Running' : 'Stopped'}</li>
                    </ul>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Styles */}
      <style>{`
        .performance-panel {
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 90%;
          max-width: 600px;
          max-height: 80vh;
          background: rgba(15, 23, 42, 0.95);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 12px;
          backdrop-filter: blur(10px);
          z-index: 10000;
          display: flex;
          flex-direction: column;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          color: #e2e8f0;
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
        }

        .perf-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 16px 20px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        }

        .perf-header h2 {
          margin: 0;
          font-size: 18px;
          font-weight: 600;
        }

        .perf-header-actions {
          display: flex;
          gap: 8px;
        }

        .perf-btn {
          padding: 6px 12px;
          background: rgba(34, 211, 238, 0.2);
          border: 1px solid rgba(34, 211, 238, 0.3);
          border-radius: 6px;
          color: #22d3ee;
          font-size: 12px;
          cursor: pointer;
          transition: all 0.2s;
        }

        .perf-btn:hover:not(:disabled) {
          background: rgba(34, 211, 238, 0.3);
        }

        .perf-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .perf-close-btn {
          width: 28px;
          height: 28px;
          background: transparent;
          border: 1px solid rgba(255, 255, 255, 0.2);
          border-radius: 6px;
          color: #94a3b8;
          font-size: 14px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s;
        }

        .perf-close-btn:hover {
          background: rgba(255, 255, 255, 0.1);
          color: #fff;
        }

        .perf-tabs {
          display: flex;
          padding: 0 16px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        }

        .perf-tab {
          padding: 12px 16px;
          background: transparent;
          border: none;
          color: #64748b;
          font-size: 13px;
          cursor: pointer;
          transition: all 0.2s;
          border-bottom: 2px solid transparent;
          margin-bottom: -1px;
        }

        .perf-tab:hover {
          color: #94a3b8;
        }

        .perf-tab.active {
          color: #22d3ee;
          border-bottom-color: #22d3ee;
        }

        .perf-content {
          flex: 1;
          overflow-y: auto;
          padding: 16px 20px;
        }

        .perf-loading,
        .perf-error {
          text-align: center;
          padding: 40px;
          color: #64748b;
        }

        .perf-error button {
          margin-top: 16px;
          padding: 8px 16px;
          background: rgba(34, 211, 238, 0.2);
          border: 1px solid rgba(34, 211, 238, 0.3);
          border-radius: 6px;
          color: #22d3ee;
          cursor: pointer;
        }

        .perf-tab-content {
          animation: fadeIn 0.2s ease;
        }

        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .perf-section-header {
          display: flex;
          align-items: center;
          gap: 8px;
          margin: 16px 0 12px 0;
          padding-bottom: 8px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.05);
        }

        .perf-section-header:first-child {
          margin-top: 0;
        }

        .section-icon {
          font-size: 14px;
          color: #22d3ee;
        }

        .section-title {
          font-size: 13px;
          font-weight: 600;
          color: #94a3b8;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .metrics-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
          gap: 12px;
        }

        .perf-metric-card {
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.05);
          border-radius: 8px;
          padding: 12px;
        }

        .metric-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 6px;
        }

        .metric-label {
          font-size: 11px;
          color: #64748b;
          text-transform: uppercase;
        }

        .metric-status {
          width: 6px;
          height: 6px;
          border-radius: 50%;
        }

        .metric-value {
          font-size: 20px;
          font-weight: 600;
          font-family: 'SF Mono', Menlo, monospace;
        }

        .metric-unit {
          font-size: 12px;
          margin-left: 2px;
          opacity: 0.6;
        }

        .metric-sparkline {
          margin-top: 8px;
        }

        .sparkline {
          display: block;
        }

        .perf-bottleneck {
          background: rgba(255, 255, 255, 0.03);
          border-left: 3px solid;
          border-radius: 4px;
          padding: 12px;
          margin-bottom: 8px;
        }

        .bottleneck-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 6px;
        }

        .bottleneck-type {
          font-size: 11px;
          font-weight: 600;
          color: #94a3b8;
        }

        .bottleneck-severity {
          font-size: 10px;
          font-weight: 600;
          text-transform: uppercase;
        }

        .bottleneck-description {
          margin: 0 0 4px 0;
          font-size: 13px;
          color: #e2e8f0;
        }

        .bottleneck-value {
          margin: 0 0 4px 0;
          font-size: 11px;
          color: #64748b;
          font-family: monospace;
        }

        .bottleneck-recommendation {
          margin: 0;
          font-size: 12px;
          color: #22d3ee;
          font-style: italic;
        }

        .voice-timing-breakdown {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .timing-row {
          display: grid;
          grid-template-columns: 100px 1fr 60px;
          align-items: center;
          gap: 12px;
        }

        .timing-label {
          font-size: 12px;
          color: #94a3b8;
        }

        .timing-bar-container {
          height: 8px;
          background: rgba(255, 255, 255, 0.1);
          border-radius: 4px;
          position: relative;
          overflow: hidden;
        }

        .timing-bar {
          height: 100%;
          border-radius: 4px;
          transition: width 0.3s ease;
        }

        .timing-good { background: #4ade80; }
        .timing-warning { background: #facc15; }
        .timing-critical { background: #f87171; }

        .timing-value {
          font-size: 12px;
          font-family: monospace;
          text-align: right;
          color: #e2e8f0;
        }

        .voice-targets {
          margin-top: 16px;
          padding: 12px;
          background: rgba(255, 255, 255, 0.03);
          border-radius: 8px;
        }

        .voice-targets h4 {
          margin: 0 0 8px 0;
          font-size: 12px;
          color: #94a3b8;
        }

        .voice-targets ul {
          margin: 0;
          padding-left: 20px;
          font-size: 11px;
          color: #64748b;
        }

        .voice-targets li {
          margin-bottom: 4px;
        }

        .no-voice-data {
          text-align: center;
          padding: 24px;
          color: #64748b;
        }

        .memory-bar {
          position: relative;
          height: 24px;
          background: rgba(255, 255, 255, 0.1);
          border-radius: 12px;
          overflow: hidden;
          margin-bottom: 16px;
        }

        .memory-bar-fill {
          height: 100%;
          transition: width 0.3s ease;
        }

        .memory-bar-text {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          font-size: 11px;
          font-weight: 600;
          color: #fff;
          text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
        }

        .history-graph {
          margin-bottom: 16px;
        }

        .graph-label {
          font-size: 12px;
          color: #94a3b8;
          margin-bottom: 8px;
        }

        .graph-canvas {
          background: rgba(255, 255, 255, 0.02);
          border-radius: 8px;
          display: block;
        }

        .history-graphs {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
          gap: 16px;
        }

        .history-stats {
          margin-top: 20px;
          padding: 12px;
          background: rgba(255, 255, 255, 0.03);
          border-radius: 8px;
        }

        .history-stats h4 {
          margin: 0 0 8px 0;
          font-size: 12px;
          color: #94a3b8;
        }

        .history-stats ul {
          margin: 0;
          padding: 0;
          list-style: none;
          font-size: 12px;
          color: #64748b;
        }

        .history-stats li {
          margin-bottom: 4px;
        }
      `}</style>
    </div>
  );
}

export default PerformancePanel;
