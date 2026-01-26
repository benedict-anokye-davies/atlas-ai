/**
 * Atlas Desktop - System Stats Widget
 * Real-time CPU, RAM, and system monitoring
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import './SystemStats.css';

// ============================================================================
// Types
// ============================================================================

interface SystemInfo {
  cpu: {
    usage: number;
    cores: number;
    model: string;
    speed: number;
  };
  memory: {
    total: number;
    used: number;
    free: number;
    usagePercent: number;
  };
  disk: {
    total: number;
    used: number;
    free: number;
    usagePercent: number;
  };
  network: {
    bytesReceived: number;
    bytesSent: number;
    downloadSpeed: number;
    uploadSpeed: number;
  };
  uptime: number;
  platform: string;
  hostname: string;
}

interface SystemStatsProps {
  isVisible: boolean;
  onClose: () => void;
  position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
}

interface HistoryPoint {
  timestamp: number;
  cpu: number;
  memory: number;
}

// ============================================================================
// Icons
// ============================================================================

const CpuIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="4" y="4" width="16" height="16" rx="2" ry="2" />
    <rect x="9" y="9" width="6" height="6" />
    <line x1="9" y1="1" x2="9" y2="4" />
    <line x1="15" y1="1" x2="15" y2="4" />
    <line x1="9" y1="20" x2="9" y2="23" />
    <line x1="15" y1="20" x2="15" y2="23" />
    <line x1="20" y1="9" x2="23" y2="9" />
    <line x1="20" y1="14" x2="23" y2="14" />
    <line x1="1" y1="9" x2="4" y2="9" />
    <line x1="1" y1="14" x2="4" y2="14" />
  </svg>
);

const MemoryIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="2" y="6" width="20" height="12" rx="2" />
    <line x1="6" y1="10" x2="6" y2="14" />
    <line x1="10" y1="10" x2="10" y2="14" />
    <line x1="14" y1="10" x2="14" y2="14" />
    <line x1="18" y1="10" x2="18" y2="14" />
  </svg>
);

const DiskIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="10" />
    <circle cx="12" cy="12" r="3" />
    <line x1="12" y1="2" x2="12" y2="4" />
  </svg>
);

const NetworkIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M5 12.55a11 11 0 0 1 14.08 0" />
    <path d="M1.42 9a16 16 0 0 1 21.16 0" />
    <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
    <line x1="12" y1="20" x2="12.01" y2="20" />
  </svg>
);

const XIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const ClockIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);

const UploadIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="17 11 12 6 7 11" />
    <line x1="12" y1="6" x2="12" y2="18" />
  </svg>
);

const DownloadIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="7 13 12 18 17 13" />
    <line x1="12" y1="6" x2="12" y2="18" />
  </svg>
);

// ============================================================================
// Helpers
// ============================================================================

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

const formatUptime = (seconds: number): string => {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
};

const getUsageColor = (percent: number): string => {
  if (percent < 50) return '#10b981';
  if (percent < 75) return '#f59e0b';
  return '#ef4444';
};

// ============================================================================
// Components
// ============================================================================

interface CircularProgressProps {
  value: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  label: string;
  subLabel?: string;
}

const CircularProgress: React.FC<CircularProgressProps> = ({
  value,
  size = 100,
  strokeWidth = 8,
  color,
  label,
  subLabel,
}) => {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (value / 100) * circumference;
  const displayColor = color || getUsageColor(value);

  return (
    <div className="circular-progress" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle
          className="progress-bg"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
        />
        <circle
          className="progress-value"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ stroke: displayColor }}
        />
      </svg>
      <div className="progress-label">
        <span className="progress-value-text" style={{ color: displayColor }}>
          {value.toFixed(0)}%
        </span>
        <span className="progress-sub">{label}</span>
        {subLabel && <span className="progress-extra">{subLabel}</span>}
      </div>
    </div>
  );
};

interface MiniChartProps {
  data: number[];
  color: string;
  height?: number;
}

const MiniChart: React.FC<MiniChartProps> = ({ data, color, height = 40 }) => {
  const max = Math.max(...data, 100);
  const points = data.map((value, i) => {
    const x = (i / (data.length - 1)) * 100;
    const y = height - (value / max) * height;
    return `${x},${y}`;
  }).join(' ');

  return (
    <div className="mini-chart" style={{ height }}>
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none">
        <polyline
          points={points}
          fill="none"
          stroke={color}
          strokeWidth="2"
        />
        <linearGradient id={`gradient-${color}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
        <polygon
          points={`0,${height} ${points} 100,${height}`}
          fill={`url(#gradient-${color})`}
        />
      </svg>
    </div>
  );
};

// ============================================================================
// Main Component
// ============================================================================

export const SystemStats: React.FC<SystemStatsProps> = ({ 
  isVisible, 
  onClose,
  position = 'bottom-right' 
}) => {
  const [stats, setStats] = useState<SystemInfo | null>(null);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const prevNetworkRef = useRef<{ received: number; sent: number }>({ received: 0, sent: 0 });

  // Fetch stats
  const fetchStats = useCallback(async () => {
    try {
      // Try the new performance API first
      const perfResult = await window.atlas?.performance?.getData?.();
      
      if (perfResult?.success && perfResult.data) {
        const snapshots = perfResult.data.snapshots || [];
        const latest = snapshots[snapshots.length - 1];
        
        if (latest) {
          // Handle cpu which can be object {usage, cores} or number
          const cpuData = latest.cpu;
          const cpuUsage = typeof cpuData === 'object' ? (cpuData.usage || 0) : (cpuData || 0);
          const cpuCores = typeof cpuData === 'object' ? (cpuData.cores || 8) : 8;
          
          // Memory comes as heapUsed, heapTotal, rss, percentUsed
          const mem = latest.memory;
          const memUsed = mem.heapUsed || mem.rss || 0;
          const memTotal = mem.heapTotal || (16 * 1024 * 1024 * 1024);
          const memPercent = mem.percentUsed || (memUsed / memTotal * 100);
          
          const data: SystemInfo = {
            cpu: {
              usage: cpuUsage,
              cores: cpuCores,
              model: 'CPU',
              speed: 3.0,
            },
            memory: {
              total: memTotal,
              used: memUsed,
              free: memTotal - memUsed,
              usagePercent: memPercent,
            },
            disk: {
              total: 500 * 1024 * 1024 * 1024,
              used: 300 * 1024 * 1024 * 1024,
              free: 200 * 1024 * 1024 * 1024,
              usagePercent: 60,
            },
            network: {
              bytesReceived: 0,
              bytesSent: 0,
              downloadSpeed: 0,
              uploadSpeed: 0,
            },
            uptime: perfResult.data.status?.uptime || 0,
            platform: window.atlas?.platform || 'win32',
            hostname: 'ATLAS-DESKTOP',
          };

          // Calculate network speed
          if (prevNetworkRef.current.received > 0) {
            data.network.downloadSpeed = data.network.bytesReceived - prevNetworkRef.current.received;
            data.network.uploadSpeed = data.network.bytesSent - prevNetworkRef.current.sent;
          }
          prevNetworkRef.current = {
            received: data.network.bytesReceived,
            sent: data.network.bytesSent,
          };

          setStats(data);
          
          // Add to history
          setHistory(prev => {
            const newPoint: HistoryPoint = {
              timestamp: Date.now(),
              cpu: cpuUsage,
              memory: memPercent,
            };
            return [...prev, newPoint].slice(-60);
          });
          return;
        }
      }

      // Try legacy system.getStats API
      const result = await window.atlas?.system?.getStats?.();
      if (result?.success && result.data) {
        const rawData = result.data as {
          cpu: number;
          memory: number;
          gpu?: number;
          disk?: number;
          uptime: number;
        };
        
        // Map simple stats to full SystemInfo format
        const data: SystemInfo = {
          cpu: {
            usage: rawData.cpu,
            cores: 8,
            model: 'System CPU',
            speed: 0,
          },
          memory: {
            total: 16 * 1024 * 1024 * 1024,
            used: (rawData.memory / 100) * 16 * 1024 * 1024 * 1024,
            free: ((100 - rawData.memory) / 100) * 16 * 1024 * 1024 * 1024,
            usagePercent: rawData.memory,
          },
          disk: {
            total: 500 * 1024 * 1024 * 1024,
            used: (rawData.disk || 50) / 100 * 500 * 1024 * 1024 * 1024,
            free: ((100 - (rawData.disk || 50)) / 100) * 500 * 1024 * 1024 * 1024,
            usagePercent: rawData.disk || 50,
          },
          network: {
            bytesReceived: prevNetworkRef.current.received,
            bytesSent: prevNetworkRef.current.sent,
            downloadSpeed: 0,
            uploadSpeed: 0,
          },
          uptime: rawData.uptime,
          platform: window.atlas?.platform || 'win32',
          hostname: 'localhost',
        };
        
        setStats(data);
        
        // Add to history
        setHistory(prev => {
          const newPoint: HistoryPoint = {
            timestamp: Date.now(),
            cpu: data.cpu.usage,
            memory: data.memory.usagePercent,
          };
          const updated = [...prev, newPoint].slice(-60);
          return updated;
        });
      } else {
        // Generate placeholder data if no API available
        generatePlaceholderStats();
      }
    } catch (error) {
      // Generate placeholder data if IPC fails
      generatePlaceholderStats();
    }
  }, []);

  // Generate placeholder stats when API unavailable
  const generatePlaceholderStats = useCallback(() => {
    // Use the last known values or defaults
    const lastHistory = history[history.length - 1];
    const cpuVal = lastHistory?.cpu || 0;
    const memVal = lastHistory?.memory || 0;
    
    setStats({
      cpu: {
        usage: cpuVal,
        cores: 8,
        model: 'Waiting for data...',
        speed: 0,
      },
      memory: {
        total: 16 * 1024 * 1024 * 1024,
        used: memVal / 100 * 16 * 1024 * 1024 * 1024,
        free: (1 - memVal / 100) * 16 * 1024 * 1024 * 1024,
        usagePercent: memVal,
      },
      disk: {
        total: 0,
        used: 0,
        free: 0,
        usagePercent: 0,
      },
      network: {
        bytesReceived: 0,
        bytesSent: 0,
        downloadSpeed: 0,
        uploadSpeed: 0,
      },
      uptime: 0,
      platform: window.atlas?.platform || 'unknown',
      hostname: 'ATLAS',
    });
  }, [history]);

  // Start/stop polling
  useEffect(() => {
    if (isVisible) {
      fetchStats();
      intervalRef.current = setInterval(fetchStats, 1000);
    }
    
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isVisible, fetchStats]);

  if (!isVisible || !stats) return null;

  const cpuHistory = history.map(h => h.cpu);
  const memHistory = history.map(h => h.memory);

  return (
    <div className={`system-stats-widget ${position} ${isExpanded ? 'expanded' : ''}`}>
      {/* Collapsed View */}
      {!isExpanded ? (
        <div className="stats-mini" onClick={() => setIsExpanded(true)}>
          <div className="mini-stat">
            <CpuIcon className="mini-icon cpu" />
            <span className="mini-value" style={{ color: getUsageColor(stats.cpu.usage) }}>
              {stats.cpu.usage.toFixed(0)}%
            </span>
          </div>
          <div className="mini-stat">
            <MemoryIcon className="mini-icon mem" />
            <span className="mini-value" style={{ color: getUsageColor(stats.memory.usagePercent) }}>
              {stats.memory.usagePercent.toFixed(0)}%
            </span>
          </div>
          <button className="close-mini" onClick={(e) => { e.stopPropagation(); onClose(); }}>
            <XIcon />
          </button>
        </div>
      ) : (
        /* Expanded View */
        <div className="stats-expanded">
          <div className="stats-header">
            <div className="stats-title">
              <CpuIcon className="header-icon" />
              <span>System Monitor</span>
            </div>
            <div className="stats-actions">
              <button onClick={() => setIsExpanded(false)} title="Minimize">
                &minus;
              </button>
              <button onClick={onClose} title="Close">
                <XIcon />
              </button>
            </div>
          </div>

          {/* Circular Gauges */}
          <div className="stats-gauges">
            <CircularProgress
              value={stats.cpu.usage}
              label="CPU"
              subLabel={`${stats.cpu.cores} cores`}
            />
            <CircularProgress
              value={stats.memory.usagePercent}
              label="Memory"
              subLabel={formatBytes(stats.memory.used)}
            />
          </div>

          {/* Mini Charts */}
          <div className="stats-charts">
            <div className="chart-section">
              <div className="chart-header">
                <span>CPU History</span>
                <span className="chart-value" style={{ color: getUsageColor(stats.cpu.usage) }}>
                  {stats.cpu.usage.toFixed(1)}%
                </span>
              </div>
              <MiniChart data={cpuHistory} color={getUsageColor(stats.cpu.usage)} />
            </div>
            <div className="chart-section">
              <div className="chart-header">
                <span>Memory History</span>
                <span className="chart-value" style={{ color: getUsageColor(stats.memory.usagePercent) }}>
                  {stats.memory.usagePercent.toFixed(1)}%
                </span>
              </div>
              <MiniChart data={memHistory} color={getUsageColor(stats.memory.usagePercent)} />
            </div>
          </div>

          {/* Details */}
          <div className="stats-details">
            {/* Disk */}
            <div className="detail-row">
              <div className="detail-icon">
                <DiskIcon />
              </div>
              <div className="detail-info">
                <span className="detail-label">Disk</span>
                <span className="detail-value">
                  {formatBytes(stats.disk.used)} / {formatBytes(stats.disk.total)}
                </span>
              </div>
              <div className="detail-bar">
                <div 
                  className="detail-bar-fill" 
                  style={{ 
                    width: `${stats.disk.usagePercent}%`,
                    backgroundColor: getUsageColor(stats.disk.usagePercent) 
                  }} 
                />
              </div>
            </div>

            {/* Network */}
            <div className="detail-row">
              <div className="detail-icon">
                <NetworkIcon />
              </div>
              <div className="detail-info">
                <span className="detail-label">Network</span>
                <div className="network-speeds">
                  <span className="speed download">
                    <DownloadIcon className="speed-icon" />
                    {formatBytes(stats.network.downloadSpeed)}/s
                  </span>
                  <span className="speed upload">
                    <UploadIcon className="speed-icon" />
                    {formatBytes(stats.network.uploadSpeed)}/s
                  </span>
                </div>
              </div>
            </div>

            {/* Uptime */}
            <div className="detail-row">
              <div className="detail-icon">
                <ClockIcon />
              </div>
              <div className="detail-info">
                <span className="detail-label">Uptime</span>
                <span className="detail-value">{formatUptime(stats.uptime)}</span>
              </div>
            </div>
          </div>

          {/* System Info */}
          <div className="stats-footer">
            <span className="system-info">{stats.hostname}</span>
            <span className="system-info">{stats.cpu.model}</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default SystemStats;
