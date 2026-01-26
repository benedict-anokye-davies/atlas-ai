/**
 * Atlas Desktop - Repository Statistics Component
 *
 * Displays comprehensive git repository statistics including:
 * - Commit frequency charts
 * - Contributor statistics
 * - Code churn analysis
 * - File change hotspots
 * - Branch activity overview
 *
 * Voice command: "Show repo stats"
 *
 * @module renderer/components/RepoStats
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './RepoStats.css';

// ============================================================================
// Types
// ============================================================================

/**
 * Commit frequency data point
 */
interface CommitFrequencyPoint {
  date: string;
  count: number;
  additions?: number;
  deletions?: number;
}

/**
 * Contributor statistics
 */
interface ContributorStats {
  name: string;
  email: string;
  commits: number;
  additions: number;
  deletions: number;
  firstCommit: string;
  lastCommit: string;
  percentage: number;
}

/**
 * File hotspot
 */
interface FileHotspot {
  path: string;
  changeCount: number;
  additions: number;
  deletions: number;
  churn: number;
  lastModified: string;
  authors: string[];
}

/**
 * Branch activity
 */
interface BranchActivity {
  name: string;
  commits: number;
  isCurrent: boolean;
  lastCommit: string;
  ahead: number;
  behind: number;
  contributors: string[];
}

/**
 * Code churn analysis
 */
interface CodeChurn {
  totalAdditions: number;
  totalDeletions: number;
  netChange: number;
  churnRate: number;
  avgChurnPerCommit: number;
  highChurnFiles: FileHotspot[];
}

/**
 * Repository overview
 */
interface RepoOverview {
  totalCommits: number;
  totalContributors: number;
  ageInDays: number;
  firstCommitDate: string;
  lastCommitDate: string;
  totalBranches: number;
  totalTags: number;
  totalLinesOfCode: number;
  languages: { name: string; percentage: number; files: number }[];
}

/**
 * Complete repository statistics
 */
interface RepositoryStats {
  overview: RepoOverview;
  commitFrequency: CommitFrequencyPoint[];
  contributors: ContributorStats[];
  codeChurn: CodeChurn;
  hotspots: FileHotspot[];
  branches: BranchActivity[];
  generatedAt: string;
  period: {
    since?: string;
    until?: string;
  };
}

/**
 * Component props
 */
interface RepoStatsProps {
  /** Repository path */
  repoPath?: string;
  /** Whether the panel is visible */
  isOpen: boolean;
  /** Close callback */
  onClose: () => void;
}

// ============================================================================
// Constants
// ============================================================================

const CHART_COLORS = {
  primary: '#3b82f6',
  secondary: '#8b5cf6',
  success: '#10b981',
  warning: '#f59e0b',
  danger: '#ef4444',
  neutral: '#6b7280',
};

const TAB_OPTIONS = ['Overview', 'Commits', 'Contributors', 'Hotspots', 'Branches'] as const;
type TabType = (typeof TAB_OPTIONS)[number];

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Format number with K/M suffix
 */
function formatNumber(num: number): string {
  if (num >= 1000000) {
    return `${(num / 1000000).toFixed(1)}M`;
  }
  if (num >= 1000) {
    return `${(num / 1000).toFixed(1)}K`;
  }
  return num.toLocaleString();
}

/**
 * Format relative time
 */
function formatRelativeTime(dateStr: string): string {
  if (!dateStr) return 'N/A';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} years ago`;
}

/**
 * Format date as short string
 */
function formatDate(dateStr: string): string {
  if (!dateStr) return 'N/A';
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Get color for language
 */
function getLanguageColor(lang: string): string {
  const colors: Record<string, string> = {
    TypeScript: '#3178c6',
    JavaScript: '#f7df1e',
    Python: '#3776ab',
    Java: '#ed8b00',
    Go: '#00add8',
    Rust: '#dea584',
    'C': '#555555',
    'C++': '#f34b7d',
    CSS: '#563d7c',
    HTML: '#e34c26',
    JSON: '#292929',
    Markdown: '#083fa1',
    YAML: '#cb171e',
  };
  return colors[lang] || '#6b7280';
}

// ============================================================================
// Sub-Components
// ============================================================================

/**
 * Overview tab content
 */
interface OverviewTabProps {
  overview: RepoOverview;
  codeChurn: CodeChurn;
}

const OverviewTab: React.FC<OverviewTabProps> = ({ overview, codeChurn }) => {
  return (
    <div className="repo-stats-overview">
      {/* Key metrics grid */}
      <div className="metrics-grid">
        <div className="metric-card">
          <div className="metric-value">{formatNumber(overview.totalCommits)}</div>
          <div className="metric-label">Total Commits</div>
        </div>
        <div className="metric-card">
          <div className="metric-value">{overview.totalContributors}</div>
          <div className="metric-label">Contributors</div>
        </div>
        <div className="metric-card">
          <div className="metric-value">{overview.ageInDays}</div>
          <div className="metric-label">Days Active</div>
        </div>
        <div className="metric-card">
          <div className="metric-value">{overview.totalBranches}</div>
          <div className="metric-label">Branches</div>
        </div>
        <div className="metric-card">
          <div className="metric-value">{overview.totalTags}</div>
          <div className="metric-label">Tags</div>
        </div>
        <div className="metric-card">
          <div className="metric-value">~{formatNumber(overview.totalLinesOfCode)}</div>
          <div className="metric-label">Lines of Code</div>
        </div>
      </div>

      {/* Activity summary */}
      <div className="overview-section">
        <h3>Activity Summary</h3>
        <div className="activity-summary">
          <div className="activity-item">
            <span className="label">First Commit:</span>
            <span className="value">{formatDate(overview.firstCommitDate)}</span>
          </div>
          <div className="activity-item">
            <span className="label">Last Commit:</span>
            <span className="value">{formatRelativeTime(overview.lastCommitDate)}</span>
          </div>
          <div className="activity-item">
            <span className="label">Net Code Change:</span>
            <span className={`value ${codeChurn.netChange >= 0 ? 'positive' : 'negative'}`}>
              {codeChurn.netChange >= 0 ? '+' : ''}{formatNumber(codeChurn.netChange)} lines
            </span>
          </div>
          <div className="activity-item">
            <span className="label">Avg Churn/Commit:</span>
            <span className="value">{formatNumber(codeChurn.avgChurnPerCommit)} lines</span>
          </div>
        </div>
      </div>

      {/* Languages */}
      {overview.languages.length > 0 && (
        <div className="overview-section">
          <h3>Languages</h3>
          <div className="language-list">
            {overview.languages.map((lang) => (
              <div key={lang.name} className="language-item">
                <div className="language-bar-container">
                  <div
                    className="language-bar"
                    style={{
                      width: `${lang.percentage}%`,
                      backgroundColor: getLanguageColor(lang.name),
                    }}
                  />
                </div>
                <div className="language-info">
                  <span
                    className="language-dot"
                    style={{ backgroundColor: getLanguageColor(lang.name) }}
                  />
                  <span className="language-name">{lang.name}</span>
                  <span className="language-percentage">{lang.percentage}%</span>
                  <span className="language-files">{lang.files} files</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* High churn files */}
      {codeChurn.highChurnFiles.length > 0 && (
        <div className="overview-section">
          <h3>High Churn Files</h3>
          <div className="hotspot-list compact">
            {codeChurn.highChurnFiles.map((file) => (
              <div key={file.path} className="hotspot-item">
                <span className="hotspot-path">{file.path}</span>
                <span className="hotspot-churn">{formatNumber(file.churn)} lines</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * Commits chart tab content
 */
interface CommitsTabProps {
  frequency: CommitFrequencyPoint[];
}

const CommitsTab: React.FC<CommitsTabProps> = ({ frequency }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; data: CommitFrequencyPoint } | null>(null);

  const maxCount = useMemo(() => Math.max(...frequency.map((p) => p.count), 1), [frequency]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = container.clientWidth;
    const height = 200;
    const padding = { top: 20, right: 20, bottom: 40, left: 50 };

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, width, height);

    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;
    const barWidth = Math.max(2, chartWidth / frequency.length - 1);

    // Draw Y axis grid lines
    ctx.strokeStyle = '#374151';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    for (let i = 0; i <= 4; i++) {
      const y = padding.top + (chartHeight * i) / 4;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(width - padding.right, y);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Draw Y axis labels
    ctx.fillStyle = '#9ca3af';
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
      const value = Math.round(maxCount * (1 - i / 4));
      const y = padding.top + (chartHeight * i) / 4;
      ctx.fillText(value.toString(), padding.left - 8, y + 4);
    }

    // Draw bars
    frequency.forEach((point, i) => {
      const barHeight = (point.count / maxCount) * chartHeight;
      const x = padding.left + (i * chartWidth) / frequency.length;
      const y = padding.top + chartHeight - barHeight;

      // Bar gradient
      const gradient = ctx.createLinearGradient(x, y, x, y + barHeight);
      gradient.addColorStop(0, CHART_COLORS.primary);
      gradient.addColorStop(1, '#1e40af');

      ctx.fillStyle = gradient;
      ctx.fillRect(x, y, barWidth, barHeight);
    });

    // Draw X axis labels (every 7th or so)
    ctx.fillStyle = '#9ca3af';
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    const step = Math.ceil(frequency.length / 10);
    frequency.forEach((point, i) => {
      if (i % step === 0) {
        const x = padding.left + (i * chartWidth) / frequency.length + barWidth / 2;
        const dateStr = point.date.substring(5); // MM-DD
        ctx.fillText(dateStr, x, height - padding.bottom + 15);
      }
    });
  }, [frequency, maxCount]);

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const padding = { left: 50, right: 20 };
    const chartWidth = container.clientWidth - padding.left - padding.right;

    const index = Math.floor(((x - padding.left) / chartWidth) * frequency.length);
    if (index >= 0 && index < frequency.length) {
      setTooltip({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        data: frequency[index],
      });
    } else {
      setTooltip(null);
    }
  };

  const handleMouseLeave = () => {
    setTooltip(null);
  };

  const totalCommits = useMemo(
    () => frequency.reduce((sum, p) => sum + p.count, 0),
    [frequency]
  );

  return (
    <div className="repo-stats-commits">
      <div className="commits-summary">
        <div className="summary-stat">
          <span className="value">{formatNumber(totalCommits)}</span>
          <span className="label">Total Commits</span>
        </div>
        <div className="summary-stat">
          <span className="value">{frequency.length}</span>
          <span className="label">Days Analyzed</span>
        </div>
        <div className="summary-stat">
          <span className="value">{(totalCommits / Math.max(frequency.length, 1)).toFixed(1)}</span>
          <span className="label">Avg/Day</span>
        </div>
      </div>

      <div className="chart-container" ref={containerRef}>
        <canvas
          ref={canvasRef}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          className="commits-chart"
        />
        {tooltip && (
          <div
            className="chart-tooltip"
            style={{
              left: tooltip.x,
              top: tooltip.y - 40,
            }}
          >
            <div className="tooltip-date">{tooltip.data.date}</div>
            <div className="tooltip-value">{tooltip.data.count} commits</div>
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * Contributors tab content
 */
interface ContributorsTabProps {
  contributors: ContributorStats[];
}

const ContributorsTab: React.FC<ContributorsTabProps> = ({ contributors }) => {
  const [sortBy, setSortBy] = useState<'commits' | 'additions' | 'deletions'>('commits');

  const sortedContributors = useMemo(() => {
    return [...contributors].sort((a, b) => b[sortBy] - a[sortBy]);
  }, [contributors, sortBy]);

  const maxValue = useMemo(() => {
    return Math.max(...contributors.map((c) => c[sortBy]), 1);
  }, [contributors, sortBy]);

  return (
    <div className="repo-stats-contributors">
      <div className="contributors-controls">
        <span className="sort-label">Sort by:</span>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
          className="sort-select"
        >
          <option value="commits">Commits</option>
          <option value="additions">Additions</option>
          <option value="deletions">Deletions</option>
        </select>
      </div>

      <div className="contributors-list">
        {sortedContributors.map((contributor, index) => (
          <div key={contributor.email} className="contributor-item">
            <div className="contributor-rank">#{index + 1}</div>
            <div className="contributor-info">
              <div className="contributor-name">{contributor.name}</div>
              <div className="contributor-email">{contributor.email}</div>
            </div>
            <div className="contributor-stats">
              <div className="stat-bar-container">
                <div
                  className="stat-bar"
                  style={{
                    width: `${(contributor[sortBy] / maxValue) * 100}%`,
                    backgroundColor: CHART_COLORS.primary,
                  }}
                />
              </div>
              <div className="stat-details">
                <span className="commits">{contributor.commits} commits</span>
                <span className="additions">+{formatNumber(contributor.additions)}</span>
                <span className="deletions">-{formatNumber(contributor.deletions)}</span>
                <span className="percentage">{contributor.percentage}%</span>
              </div>
            </div>
            <div className="contributor-activity">
              <span className="first">First: {formatRelativeTime(contributor.firstCommit)}</span>
              <span className="last">Last: {formatRelativeTime(contributor.lastCommit)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

/**
 * Hotspots tab content
 */
interface HotspotsTabProps {
  hotspots: FileHotspot[];
}

const HotspotsTab: React.FC<HotspotsTabProps> = ({ hotspots }) => {
  const [sortBy, setSortBy] = useState<'changeCount' | 'churn'>('changeCount');

  const sortedHotspots = useMemo(() => {
    return [...hotspots].sort((a, b) => b[sortBy] - a[sortBy]);
  }, [hotspots, sortBy]);

  const maxValue = useMemo(() => {
    return Math.max(...hotspots.map((h) => h[sortBy]), 1);
  }, [hotspots, sortBy]);

  return (
    <div className="repo-stats-hotspots">
      <div className="hotspots-controls">
        <span className="sort-label">Sort by:</span>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
          className="sort-select"
        >
          <option value="changeCount">Change Count</option>
          <option value="churn">Total Churn</option>
        </select>
      </div>

      <div className="hotspots-list">
        {sortedHotspots.map((hotspot, index) => (
          <div key={hotspot.path} className="hotspot-item">
            <div className="hotspot-rank">#{index + 1}</div>
            <div className="hotspot-info">
              <div className="hotspot-path" title={hotspot.path}>
                {hotspot.path}
              </div>
              <div className="hotspot-authors">
                {hotspot.authors.slice(0, 3).join(', ')}
                {hotspot.authors.length > 3 && ` +${hotspot.authors.length - 3} more`}
              </div>
            </div>
            <div className="hotspot-stats">
              <div className="stat-bar-container">
                <div
                  className="stat-bar"
                  style={{
                    width: `${(hotspot[sortBy] / maxValue) * 100}%`,
                    backgroundColor: CHART_COLORS.warning,
                  }}
                />
              </div>
              <div className="stat-details">
                <span className="changes">{hotspot.changeCount} changes</span>
                <span className="additions">+{formatNumber(hotspot.additions)}</span>
                <span className="deletions">-{formatNumber(hotspot.deletions)}</span>
                <span className="churn">{formatNumber(hotspot.churn)} churn</span>
              </div>
            </div>
            <div className="hotspot-modified">
              Last modified: {formatRelativeTime(hotspot.lastModified)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

/**
 * Branches tab content
 */
interface BranchesTabProps {
  branches: BranchActivity[];
}

const BranchesTab: React.FC<BranchesTabProps> = ({ branches }) => {
  const maxCommits = useMemo(
    () => Math.max(...branches.map((b) => b.commits), 1),
    [branches]
  );

  return (
    <div className="repo-stats-branches">
      <div className="branches-list">
        {branches.map((branch, index) => (
          <div
            key={branch.name}
            className={`branch-item ${branch.isCurrent ? 'current' : ''}`}
          >
            <div className="branch-rank">#{index + 1}</div>
            <div className="branch-info">
              <div className="branch-name">
                {branch.name}
                {branch.isCurrent && <span className="current-badge">current</span>}
              </div>
              <div className="branch-contributors">
                {branch.contributors.slice(0, 3).join(', ')}
              </div>
            </div>
            <div className="branch-stats">
              <div className="stat-bar-container">
                <div
                  className="stat-bar"
                  style={{
                    width: `${(branch.commits / maxCommits) * 100}%`,
                    backgroundColor: branch.isCurrent
                      ? CHART_COLORS.success
                      : CHART_COLORS.secondary,
                  }}
                />
              </div>
              <div className="stat-details">
                <span className="commits">{branch.commits} commits</span>
                {!branch.isCurrent && (
                  <>
                    <span className="ahead">+{branch.ahead} ahead</span>
                    <span className="behind">-{branch.behind} behind</span>
                  </>
                )}
              </div>
            </div>
            <div className="branch-activity">
              Last commit: {formatRelativeTime(branch.lastCommit)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ============================================================================
// Main Component
// ============================================================================

/**
 * Repository Statistics Component
 */
export const RepoStats: React.FC<RepoStatsProps> = ({ repoPath, isOpen, onClose }) => {
  // State
  const [stats, setStats] = useState<RepositoryStats | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('Overview');
  const [isExporting, setIsExporting] = useState(false);

  // Fetch stats
  const fetchStats = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await window.atlas?.invoke<{
        success: boolean;
        data?: RepositoryStats;
        error?: string;
      }>('git:repo-stats', {
        path: repoPath,
        since: '6 months ago',
        contributorLimit: 20,
        hotspotLimit: 20,
        branchLimit: 10,
      });

      if (result?.success && result.data) {
        setStats(result.data);
      } else {
        setError(result?.error || 'Failed to fetch repository statistics');
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, [repoPath]);

  // Export stats
  const handleExport = useCallback(async (format: 'json' | 'csv' | 'markdown') => {
    if (!stats) return;

    setIsExporting(true);

    try {
      const result = await window.atlas?.invoke<{
        success: boolean;
        data?: { format: string; content: string; filename: string };
        error?: string;
      }>('git:export-stats', {
        path: repoPath,
        format,
        since: '6 months ago',
      });

      if (result?.success && result.data) {
        // Create and download file
        const blob = new Blob([result.data.content], {
          type: format === 'json' ? 'application/json' : 'text/plain',
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = result.data.filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } else {
        alert(result?.error || 'Export failed');
      }
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setIsExporting(false);
    }
  }, [stats, repoPath]);

  // Initial fetch
  useEffect(() => {
    if (isOpen) {
      fetchStats();
    }
  }, [isOpen, fetchStats]);

  // Keyboard handler
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="repo-stats-overlay">
      <div className="repo-stats-panel">
        {/* Header */}
        <div className="repo-stats-header">
          <h2>Repository Statistics</h2>
          {stats && (
            <div className="header-info">
              <span className="generated-at">
                Generated {formatRelativeTime(stats.generatedAt)}
              </span>
            </div>
          )}
          <div className="header-actions">
            {/* Export dropdown */}
            <div className="export-dropdown">
              <button
                className="export-btn"
                disabled={!stats || isExporting}
                onClick={() => handleExport('markdown')}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                {isExporting ? 'Exporting...' : 'Export'}
              </button>
            </div>

            {/* Refresh button */}
            <button
              className="refresh-btn"
              onClick={fetchStats}
              disabled={isLoading}
              aria-label="Refresh"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className={isLoading ? 'spinning' : ''}
              >
                <polyline points="23 4 23 10 17 10" />
                <polyline points="1 20 1 14 7 14" />
                <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
              </svg>
            </button>

            {/* Close button */}
            <button className="close-btn" onClick={onClose} aria-label="Close">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="repo-stats-tabs">
          {TAB_OPTIONS.map((tab) => (
            <button
              key={tab}
              className={`tab-btn ${activeTab === tab ? 'active' : ''}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="repo-stats-content">
          {/* Error state */}
          {error && (
            <div className="repo-stats-error">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>{error}</span>
              <button onClick={fetchStats}>Retry</button>
            </div>
          )}

          {/* Loading state */}
          {isLoading && !stats && (
            <div className="repo-stats-loading">
              <div className="loading-spinner" />
              <span>Generating statistics...</span>
              <span className="loading-hint">This may take a moment for large repositories</span>
            </div>
          )}

          {/* Stats content */}
          {stats && (
            <>
              {activeTab === 'Overview' && (
                <OverviewTab overview={stats.overview} codeChurn={stats.codeChurn} />
              )}
              {activeTab === 'Commits' && <CommitsTab frequency={stats.commitFrequency} />}
              {activeTab === 'Contributors' && (
                <ContributorsTab contributors={stats.contributors} />
              )}
              {activeTab === 'Hotspots' && <HotspotsTab hotspots={stats.hotspots} />}
              {activeTab === 'Branches' && <BranchesTab branches={stats.branches} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default RepoStats;
