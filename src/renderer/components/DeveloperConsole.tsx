/**
 * Atlas Desktop - Developer Console
 * Debug panel for developers with logs, state inspection, and tools
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { getErrorMessage } from '../../shared/utils';
import './DeveloperConsole.css';

// ============================================================================
// Types
// ============================================================================

interface LogEntry {
  id: string;
  timestamp: number;
  level: 'debug' | 'info' | 'warn' | 'error';
  source: string;
  message: string;
  data?: Record<string, unknown>;
}

interface DeveloperConsoleProps {
  isVisible: boolean;
  onClose: () => void;
}

type TabType = 'logs' | 'state' | 'ipc' | 'performance';

// ============================================================================
// Icons
// ============================================================================

const TerminalIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="4 17 10 11 4 5" />
    <line x1="12" y1="19" x2="20" y2="19" />
  </svg>
);

const XIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const TrashIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

const FilterIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
  </svg>
);

const CopyIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

const RefreshIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="23 4 23 10 17 10" />
    <polyline points="1 20 1 14 7 14" />
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
  </svg>
);

const PlayIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polygon points="5 3 19 12 5 21 5 3" />
  </svg>
);

// ============================================================================
// Helper Functions
// ============================================================================

const formatTimestamp = (ts: number): string => {
  const date = new Date(ts);
  return date.toLocaleTimeString([], { 
    hour: '2-digit', 
    minute: '2-digit', 
    second: '2-digit',
    fractionalSecondDigits: 3 
  } as Intl.DateTimeFormatOptions);
};

const getLevelColor = (level: string): string => {
  switch (level) {
    case 'debug': return '#6b7280';
    case 'info': return '#3b82f6';
    case 'warn': return '#f59e0b';
    case 'error': return '#ef4444';
    default: return '#fff';
  }
};

// ============================================================================
// Performance Panel Sub-Component
// ============================================================================

interface StartupPhase {
  phase: string;
  durationMs: number;
  percentOfTotal: number;
  status: 'fast' | 'acceptable' | 'slow' | 'critical';
}

interface PerformanceData {
  totalDurationMs: number;
  isWarmStart: boolean;
  phaseSummaries: StartupPhase[];
  recommendations: string[];
  memoryUsage?: {
    heapUsed: number;
    heapTotal: number;
    rss: number;
  };
}

const PerformancePanel: React.FC = () => {
  const [perfData, setPerfData] = useState<PerformanceData | null>(null);
  const [runtimeMetrics, setRuntimeMetrics] = useState<{
    fps: number;
    memory: number;
    cpu: number;
  }>({ fps: 60, memory: 0, cpu: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch startup timing data
  useEffect(() => {
    const fetchStartupData = async () => {
      try {
        const result = await window.atlas?.performance?.getStartupTiming?.();
        if (result?.success && result.data) {
          setPerfData({
            totalDurationMs: result.data.totalDurationMs,
            isWarmStart: result.data.isWarmStart,
            phaseSummaries: result.data.phaseSummaries || [],
            recommendations: result.data.recommendations || [],
            memoryUsage: result.data.memoryUsage,
          });
        }
      } catch (err) {
        setError('Failed to load startup timing');
      } finally {
        setLoading(false);
      }
    };

    fetchStartupData();
  }, []);

  // Fetch runtime metrics periodically
  useEffect(() => {
    const fetchRuntimeMetrics = async () => {
      try {
        const result = await window.atlas?.performance?.getData?.();
        if (result?.success && result.data) {
          const snapshots = result.data.snapshots || [];
          const latest = snapshots[snapshots.length - 1];
          if (latest) {
            setRuntimeMetrics({
              fps: 60, // Will come from render metrics
              memory: Math.round((latest.memory?.heapUsed || 0) / 1024 / 1024),
              cpu: Math.round(typeof latest.cpu === 'object' ? latest.cpu.usage : latest.cpu || 0),
            });
          }
        }
      } catch {
        // Ignore runtime metric errors
      }
    };

    fetchRuntimeMetrics();
    const interval = setInterval(fetchRuntimeMetrics, 2000);
    return () => clearInterval(interval);
  }, []);

  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'fast': return '#10b981';
      case 'acceptable': return '#3b82f6';
      case 'slow': return '#f59e0b';
      case 'critical': return '#ef4444';
      default: return '#6b7280';
    }
  };

  const formatPhaseName = (phase: string): string => {
    return phase
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  if (loading) {
    return (
      <div className="perf-panel">
        <div className="perf-loading">Loading performance data...</div>
      </div>
    );
  }

  return (
    <div className="perf-panel">
      {/* Runtime Metrics */}
      <div className="perf-metrics">
        <div className="perf-metric">
          <span className="metric-value">{runtimeMetrics.fps}</span>
          <span className="metric-label">FPS</span>
        </div>
        <div className="perf-metric">
          <span className="metric-value">{runtimeMetrics.memory}</span>
          <span className="metric-label">MB Memory</span>
        </div>
        <div className="perf-metric">
          <span className="metric-value">{runtimeMetrics.cpu}%</span>
          <span className="metric-label">CPU</span>
        </div>
        {perfData && (
          <div className="perf-metric">
            <span className="metric-value">{Math.round(perfData.totalDurationMs)}</span>
            <span className="metric-label">Startup (ms)</span>
          </div>
        )}
      </div>

      {/* Startup Timing */}
      {perfData && (
        <>
          <div className="perf-timings">
            <h4>
              Startup Phases ({perfData.isWarmStart ? 'Warm' : 'Cold'} Start)
            </h4>
            <div className="timing-list">
              {perfData.phaseSummaries.map(phase => (
                <div key={phase.phase} className="timing-item">
                  <span className="timing-name">{formatPhaseName(phase.phase)}</span>
                  <div className="timing-bar-container">
                    <div 
                      className="timing-bar"
                      style={{
                        width: `${Math.min(100, phase.percentOfTotal)}%`,
                        backgroundColor: getStatusColor(phase.status),
                      }}
                    />
                  </div>
                  <span 
                    className="timing-value"
                    style={{ color: getStatusColor(phase.status) }}
                  >
                    {phase.durationMs.toFixed(0)}ms
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Recommendations */}
          {perfData.recommendations.length > 0 && (
            <div className="perf-recommendations">
              <h4>Recommendations</h4>
              <ul>
                {perfData.recommendations.map((rec, i) => (
                  <li key={i}>{rec}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {error && (
        <div className="perf-error">{error}</div>
      )}
    </div>
  );
};

// ============================================================================
// Main Component
// ============================================================================

export const DeveloperConsole: React.FC<DeveloperConsoleProps> = ({ isVisible, onClose }) => {
  const [activeTab, setActiveTab] = useState<TabType>('logs');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [levelFilter, setLevelFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set());
  const [commandInput, setCommandInput] = useState('');
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  
  const logsEndRef = useRef<HTMLDivElement>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);

  // Fetch real logs from Atlas
  useEffect(() => {
    if (!isVisible) return;
    
    const fetchLogs = async () => {
      try {
        // Try to get performance data which includes logs
        const perfResult = await window.atlas?.performance?.getData?.();
        // Note: atlas.getMetrics() can be used for additional data
        
        const realLogs: LogEntry[] = [];
        let logId = 1;
        const now = Date.now();

        // Add info from performance data
        if (perfResult?.success && perfResult.data) {
          const status = perfResult.data.status;
          if (status) {
            realLogs.push({
              id: String(logId++),
              timestamp: now - 1000,
              level: 'info',
              source: 'Performance',
              message: `Performance profiler ${status.running ? 'running' : 'stopped'}`,
              data: { uptime: status.uptime, snapshots: status.snapshotCount }
            });
          }

          const snapshots = perfResult.data.snapshots || [];
          if (snapshots.length > 0) {
            const latest = snapshots[snapshots.length - 1];
            realLogs.push({
              id: String(logId++),
              timestamp: latest.timestamp || now,
              level: 'debug',
              source: 'System',
              message: `CPU: ${(typeof latest.cpu === 'object' ? latest.cpu.usage : latest.cpu || 0).toFixed(1)}%, Memory: ${latest.memory?.percentUsed?.toFixed(1) || 0}%`,
              data: latest
            });

            // Check for bottlenecks
            if (latest.bottlenecks && latest.bottlenecks.length > 0) {
              latest.bottlenecks.forEach((b) => {
                realLogs.push({
                  id: String(logId++),
                  timestamp: now,
                  level: 'warn',
                  source: 'Performance',
                  message: `Bottleneck detected: ${b.type || b.description}`,
                  data: b
                });
              });
            }
          }
        }

        // Add voice pipeline status if available
        const voiceResult = await window.atlas?.voice?.getStatus?.();
        if (voiceResult) {
          // voice.getStatus() returns {wakeWordActive, wakeWordPaused, configValid} directly
          realLogs.push({
            id: String(logId++),
            timestamp: now - 500,
            level: 'info',
            source: 'VoicePipeline',
            message: `Wake word: ${voiceResult.wakeWordActive ? 'active' : 'inactive'}${voiceResult.wakeWordPaused ? ' (paused)' : ''}`,
            data: voiceResult
          });
        }

        // Add connectivity info
        const connResult = await window.atlas?.atlas?.getConnectivity?.();
        if (connResult?.success && connResult.data) {
          const conn = connResult.data;
          realLogs.push({
            id: String(logId++),
            timestamp: now - 200,
            level: conn.status?.isOnline ? 'info' : 'warn',
            source: 'Network',
            message: conn.status?.isOnline ? 'Online - all services available' : 'Offline or degraded connectivity',
            data: conn.services
          });
        }

        // Add Atlas ready message
        realLogs.push({
          id: String(logId++),
          timestamp: now,
          level: 'info',
          source: 'Atlas',
          message: 'Developer console connected',
        });

        if (realLogs.length > 0) {
          setLogs(realLogs.sort((a, b) => a.timestamp - b.timestamp));
        } else {
          // Show placeholder if no data available
          setLogs([{
            id: '1',
            timestamp: now,
            level: 'info',
            source: 'Console',
            message: 'No log data available yet. Interact with Atlas to generate logs.'
          }]);
        }
      } catch (error) {
        console.error('[DeveloperConsole] Failed to fetch logs:', error);
        setLogs([{
          id: '1',
          timestamp: Date.now(),
          level: 'error',
          source: 'Console',
          message: 'Failed to fetch log data',
          data: error instanceof Error ? { message: error.message } : { error: String(error) }
        }]);
      }
    };
    
    fetchLogs();
    
    // Refresh logs periodically
    const interval = setInterval(fetchLogs, 5000);
    return () => clearInterval(interval);
  }, [isVisible]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  // Filter logs
  const filteredLogs = logs.filter(log => {
    if (levelFilter !== 'all' && log.level !== levelFilter) return false;
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        log.message.toLowerCase().includes(query) ||
        log.source.toLowerCase().includes(query)
      );
    }
    return true;
  });

  // Clear logs
  const clearLogs = useCallback(() => {
    setLogs([]);
  }, []);

  // Copy logs
  const copyLogs = useCallback(() => {
    const text = filteredLogs.map(log => 
      `[${formatTimestamp(log.timestamp)}] [${log.level.toUpperCase()}] [${log.source}] ${log.message}`
    ).join('\n');
    navigator.clipboard.writeText(text);
  }, [filteredLogs]);

  // Toggle log expansion
  const toggleLogExpand = useCallback((id: string) => {
    setExpandedLogs(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  // Execute command
  const executeCommand = useCallback(async (cmd: string) => {
    if (!cmd.trim()) return;

    setCommandHistory(prev => [...prev, cmd]);
    setHistoryIndex(-1);

    // Add command log
    const commandLog: LogEntry = {
      id: `cmd-${Date.now()}`,
      timestamp: Date.now(),
      level: 'info',
      source: 'Console',
      message: `> ${cmd}`,
    };
    setLogs(prev => [...prev, commandLog]);

    try {
      // Send command to main process for safe execution
      // This prevents arbitrary code execution in renderer process
      const atlasAny = window.atlas as unknown as Record<string, unknown>;
      if (atlasAny?.executeCommand && typeof atlasAny.executeCommand === 'function') {
        const result = await (atlasAny.executeCommand as (cmd: string) => Promise<unknown>)(cmd);

        if (result !== undefined && result !== null) {
          const resultLog: LogEntry = {
            id: `result-${Date.now()}`,
            timestamp: Date.now(),
            level: 'debug',
            source: 'Console',
            message: 'Result:',
            data: result as Record<string, unknown>,
          };
          setLogs(prev => [...prev, resultLog]);
        }
      } else {
        // Fallback: log warning that command execution is not available
        const warnLog: LogEntry = {
          id: `warn-${Date.now()}`,
          timestamp: Date.now(),
          level: 'warn',
          source: 'Console',
          message: 'Command execution not available. Commands must be executed via main process.',
        };
        setLogs(prev => [...prev, warnLog]);
      }
    } catch (error) {
      const errorLog: LogEntry = {
        id: `error-${Date.now()}`,
        timestamp: Date.now(),
        level: 'error',
        source: 'Console',
        message: getErrorMessage(error),
      };
      setLogs(prev => [...prev, errorLog]);
    }

    setCommandInput('');
  }, []);

  // Handle command input keydown
  const handleCommandKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      executeCommand(commandInput);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (commandHistory.length > 0) {
        const newIndex = historyIndex === -1 ? commandHistory.length - 1 : Math.max(0, historyIndex - 1);
        setHistoryIndex(newIndex);
        setCommandInput(commandHistory[newIndex]);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex !== -1) {
        const newIndex = historyIndex + 1;
        if (newIndex >= commandHistory.length) {
          setHistoryIndex(-1);
          setCommandInput('');
        } else {
          setHistoryIndex(newIndex);
          setCommandInput(commandHistory[newIndex]);
        }
      }
    }
  }, [commandInput, commandHistory, historyIndex, executeCommand]);

  // Add new log (simulated real-time)
  const addDemoLog = useCallback(() => {
    const sources = ['VoicePipeline', 'STT', 'LLM', 'TTS', 'Memory', 'Network', 'Orb'];
    const levels: LogEntry['level'][] = ['debug', 'info', 'warn', 'error'];
    const messages = [
      'Processing voice input',
      'Transcription complete',
      'Token generated',
      'Audio synthesized',
      'Memory updated',
      'Request sent',
      'Frame rendered',
    ];

    const newLog: LogEntry = {
      id: `log-${Date.now()}-${Math.random()}`,
      timestamp: Date.now(),
      level: levels[Math.floor(Math.random() * levels.length)],
      source: sources[Math.floor(Math.random() * sources.length)],
      message: messages[Math.floor(Math.random() * messages.length)],
    };

    setLogs(prev => [...prev.slice(-99), newLog]);
  }, []);

  if (!isVisible) return null;

  return (
    <div className="dev-console-overlay">
      <div className="dev-console-container">
        {/* Header */}
        <div className="dc-header">
          <div className="dc-title-row">
            <TerminalIcon className="dc-icon" />
            <h2>Developer Console</h2>
          </div>
          <button className="dc-close" onClick={onClose}>
            <XIcon />
          </button>
        </div>

        {/* Tabs */}
        <div className="dc-tabs">
          {(['logs', 'state', 'ipc', 'performance'] as TabType[]).map(tab => (
            <button
              key={tab}
              className={`tab-btn ${activeTab === tab ? 'active' : ''}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="dc-content">
          {activeTab === 'logs' && (
            <div className="logs-panel">
              {/* Toolbar */}
              <div className="logs-toolbar">
                <div className="toolbar-left">
                  <div className="filter-group">
                    <FilterIcon className="filter-icon" />
                    <select 
                      value={levelFilter}
                      onChange={(e) => setLevelFilter(e.target.value)}
                    >
                      <option value="all">All Levels</option>
                      <option value="debug">Debug</option>
                      <option value="info">Info</option>
                      <option value="warn">Warn</option>
                      <option value="error">Error</option>
                    </select>
                  </div>
                  <input
                    type="text"
                    placeholder="Search logs..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="search-input"
                  />
                </div>
                <div className="toolbar-right">
                  <button onClick={addDemoLog} title="Add demo log">
                    <PlayIcon />
                  </button>
                  <button onClick={copyLogs} title="Copy logs">
                    <CopyIcon />
                  </button>
                  <button onClick={clearLogs} title="Clear logs">
                    <TrashIcon />
                  </button>
                  <label className="auto-scroll">
                    <input
                      type="checkbox"
                      checked={autoScroll}
                      onChange={(e) => setAutoScroll(e.target.checked)}
                    />
                    Auto-scroll
                  </label>
                </div>
              </div>

              {/* Logs List */}
              <div className="logs-list" ref={logContainerRef}>
                {filteredLogs.length === 0 ? (
                  <div className="logs-empty">No logs to display</div>
                ) : (
                  filteredLogs.map(log => (
                    <div 
                      key={log.id} 
                      className={`log-entry ${log.level} ${expandedLogs.has(log.id) ? 'expanded' : ''}`}
                      onClick={() => log.data && toggleLogExpand(log.id)}
                    >
                      <span className="log-time">{formatTimestamp(log.timestamp)}</span>
                      <span className="log-level" style={{ color: getLevelColor(log.level) }}>
                        [{log.level.toUpperCase()}]
                      </span>
                      <span className="log-source">[{log.source}]</span>
                      <span className="log-message">{log.message}</span>
                      {log.data && (
                        <span className="log-expand-indicator">
                          {expandedLogs.has(log.id) ? '▼' : '▶'}
                        </span>
                      )}
                      {expandedLogs.has(log.id) && log.data && (
                        <pre className="log-data">
                          {JSON.stringify(log.data, null, 2)}
                        </pre>
                      )}
                    </div>
                  ))
                )}
                <div ref={logsEndRef} />
              </div>

              {/* Command Input */}
              <div className="command-input">
                <span className="prompt">&gt;</span>
                <input
                  type="text"
                  value={commandInput}
                  onChange={(e) => setCommandInput(e.target.value)}
                  onKeyDown={handleCommandKeyDown}
                  placeholder="Execute JavaScript..."
                />
              </div>
            </div>
          )}

          {activeTab === 'state' && (
            <div className="state-panel">
              <div className="state-header">
                <h3>Application State</h3>
                <button onClick={() => {}} title="Refresh state">
                  <RefreshIcon />
                </button>
              </div>
              <div className="state-content">
                <div className="state-section">
                  <h4>Voice Pipeline</h4>
                  <pre>{JSON.stringify({
                    status: 'ready',
                    wakeWordActive: true,
                    vadActive: false,
                    isListening: false,
                  }, null, 2)}</pre>
                </div>
                <div className="state-section">
                  <h4>Memory</h4>
                  <pre>{JSON.stringify({
                    entriesCount: 42,
                    vectorStoreSize: 1024,
                    lastSync: new Date().toISOString(),
                  }, null, 2)}</pre>
                </div>
                <div className="state-section">
                  <h4>Settings</h4>
                  <pre>{JSON.stringify({
                    theme: 'dark',
                    wakeWord: 'hey atlas',
                    voiceId: 'rachel',
                  }, null, 2)}</pre>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'ipc' && (
            <div className="ipc-panel">
              <div className="ipc-header">
                <h3>IPC Channels</h3>
              </div>
              <div className="ipc-list">
                {[
                  { channel: 'voice:start', calls: 12, lastCall: '2s ago' },
                  { channel: 'voice:stop', calls: 11, lastCall: '5s ago' },
                  { channel: 'atlas:send-text', calls: 8, lastCall: '1m ago' },
                  { channel: 'memory:search', calls: 24, lastCall: '30s ago' },
                  { channel: 'system:getStats', calls: 156, lastCall: '1s ago' },
                ].map(item => (
                  <div key={item.channel} className="ipc-item">
                    <span className="ipc-channel">{item.channel}</span>
                    <span className="ipc-calls">{item.calls} calls</span>
                    <span className="ipc-last">{item.lastCall}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'performance' && (
            <PerformancePanel />
          )}
        </div>
      </div>
    </div>
  );
};

export default DeveloperConsole;
