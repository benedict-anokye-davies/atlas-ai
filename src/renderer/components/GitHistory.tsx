/**
 * Atlas Desktop - Git History Explorer Component
 *
 * Visual git history exploration with commit graph, branch navigation,
 * filtering, and voice-controlled navigation support.
 *
 * @module renderer/components/GitHistory
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './GitHistory.css';

// ============================================================================
// Types
// ============================================================================

/**
 * Commit information from git history
 */
interface GitCommitInfo {
  sha: string;
  shortSha: string;
  subject: string;
  body?: string;
  author: string;
  authorEmail: string;
  authorDate: string;
  committer: string;
  committerEmail: string;
  commitDate: string;
  parents: string[];
  branches: string[];
  tags: string[];
  isMerge: boolean;
  filesChanged?: number;
  insertions?: number;
  deletions?: number;
}

/**
 * Graph node for visualization
 */
interface GitGraphNode {
  sha: string;
  column: number;
  row: number;
  colors: string[];
  lines: GitGraphLine[];
}

/**
 * Graph line connecting commits
 */
interface GitGraphLine {
  fromColumn: number;
  toColumn: number;
  parentSha: string;
  color: string;
}

/**
 * History query result
 */
interface GitHistoryResult {
  commits: GitCommitInfo[];
  totalCount: number;
  graph?: GitGraphNode[];
  currentBranch: string;
  branches: string[];
  page: number;
  pageSize: number;
  hasMore: boolean;
}

/**
 * File diff information
 */
interface GitDiffFile {
  path: string;
  oldPath?: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied';
  additions: number;
  deletions: number;
  isBinary: boolean;
}

/**
 * Commit detail with diff
 */
interface GitCommitDetail {
  commit: GitCommitInfo;
  diff?: {
    sha: string;
    files: GitDiffFile[];
    stats: {
      filesChanged: number;
      insertions: number;
      deletions: number;
    };
    rawDiff?: string;
  };
}

/**
 * Branch comparison result
 */
interface GitBranchComparison {
  baseBranch: string;
  compareBranch: string;
  mergeBase: string;
  ahead: GitCommitInfo[];
  behind: GitCommitInfo[];
  diffFiles: GitDiffFile[];
  stats: {
    aheadCount: number;
    behindCount: number;
    filesChanged: number;
    insertions: number;
    deletions: number;
  };
}

/**
 * Filter options
 */
interface GitHistoryFilter {
  branch?: string;
  author?: string;
  since?: string;
  until?: string;
  messagePattern?: string;
  limit?: number;
}

/**
 * Component props
 */
interface GitHistoryProps {
  /** Repository path */
  repoPath?: string;
  /** Initial branch to show */
  initialBranch?: string;
  /** Whether the panel is visible */
  isOpen: boolean;
  /** Close callback */
  onClose: () => void;
  /** Commit selection callback */
  onCommitSelect?: (commit: GitCommitInfo) => void;
}

// ============================================================================
// Constants
// ============================================================================

// @ts-expect-error Reserved for future git graph visualization
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _GRAPH_COLORS = [
  '#f97316', // orange
  '#3b82f6', // blue
  '#10b981', // green
  '#8b5cf6', // purple
  '#ec4899', // pink
  '#14b8a6', // teal
  '#f59e0b', // amber
  '#6366f1', // indigo
];

const COLUMN_WIDTH = 16;
const NODE_RADIUS = 4;
const LINE_WIDTH = 2;

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Format relative time
 */
function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffWeeks = Math.floor(diffDays / 7);
  const diffMonths = Math.floor(diffDays / 30);
  const diffYears = Math.floor(diffDays / 365);

  if (diffSecs < 60) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffWeeks < 4) return `${diffWeeks}w ago`;
  if (diffMonths < 12) return `${diffMonths}mo ago`;
  return `${diffYears}y ago`;
}

/**
 * Get status color
 */
function getStatusColor(status: GitDiffFile['status']): string {
  switch (status) {
    case 'added':
      return '#10b981';
    case 'deleted':
      return '#ef4444';
    case 'modified':
      return '#f59e0b';
    case 'renamed':
      return '#3b82f6';
    case 'copied':
      return '#8b5cf6';
    default:
      return '#6b7280';
  }
}

/**
 * Get status icon
 */
function getStatusIcon(status: GitDiffFile['status']): string {
  switch (status) {
    case 'added':
      return '+';
    case 'deleted':
      return '-';
    case 'modified':
      return 'M';
    case 'renamed':
      return 'R';
    case 'copied':
      return 'C';
    default:
      return '?';
  }
}

// ============================================================================
// Sub-Components
// ============================================================================

/**
 * Commit graph visualization
 */
interface CommitGraphProps {
  nodes: GitGraphNode[];
  selectedSha?: string;
  onNodeClick: (sha: string) => void;
}

const CommitGraph: React.FC<CommitGraphProps> = ({ nodes, selectedSha, onNodeClick }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const maxColumn = useMemo(() => Math.max(...nodes.map((n) => n.column), 0), [nodes]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = (maxColumn + 2) * COLUMN_WIDTH;
    const height = nodes.length * 28;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, width, height);

    // Draw lines first (behind nodes)
    for (const node of nodes) {
      const x = node.column * COLUMN_WIDTH + COLUMN_WIDTH / 2;
      const y = node.row * 28 + 14;

      for (const line of node.lines) {
        const parentNode = nodes.find((n) => n.sha === line.parentSha);
        if (!parentNode) continue;

        const toX = line.toColumn * COLUMN_WIDTH + COLUMN_WIDTH / 2;
        const toY = parentNode.row * 28 + 14;

        ctx.beginPath();
        ctx.strokeStyle = line.color;
        ctx.lineWidth = LINE_WIDTH;

        if (line.fromColumn === line.toColumn) {
          // Straight line
          ctx.moveTo(x, y);
          ctx.lineTo(toX, toY);
        } else {
          // Curved line for merges
          const midY = y + (toY - y) / 2;
          ctx.moveTo(x, y);
          ctx.bezierCurveTo(x, midY, toX, midY, toX, toY);
        }

        ctx.stroke();
      }
    }

    // Draw nodes
    for (const node of nodes) {
      const x = node.column * COLUMN_WIDTH + COLUMN_WIDTH / 2;
      const y = node.row * 28 + 14;
      const isSelected = node.sha === selectedSha;

      // Node circle
      ctx.beginPath();
      ctx.arc(x, y, isSelected ? NODE_RADIUS + 2 : NODE_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = isSelected ? '#ffffff' : node.colors[0];
      ctx.fill();

      if (isSelected) {
        ctx.strokeStyle = node.colors[0];
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  }, [nodes, selectedSha, maxColumn]);

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const y = e.clientY - rect.top;
    const row = Math.floor(y / 28);

    const node = nodes.find((n) => n.row === row);
    if (node) {
      onNodeClick(node.sha);
    }
  };

  return (
    <canvas
      ref={canvasRef}
      className="git-history-graph"
      onClick={handleClick}
      style={{ minWidth: (maxColumn + 2) * COLUMN_WIDTH }}
    />
  );
};

/**
 * Commit row component
 */
interface CommitRowProps {
  commit: GitCommitInfo;
  isSelected: boolean;
  onClick: () => void;
}

const CommitRow: React.FC<CommitRowProps> = ({ commit, isSelected, onClick }) => {
  return (
    <div
      className={`git-history-commit ${isSelected ? 'selected' : ''}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClick()}
    >
      <div className="commit-main">
        <span className="commit-sha">{commit.shortSha}</span>
        <span className="commit-subject">{commit.subject}</span>
        {commit.isMerge && <span className="commit-badge merge">merge</span>}
      </div>
      <div className="commit-meta">
        <span className="commit-author">{commit.author}</span>
        <span className="commit-date">{formatRelativeTime(commit.authorDate)}</span>
        {commit.branches.length > 0 && (
          <span className="commit-branches">
            {commit.branches.slice(0, 2).map((branch) => (
              <span key={branch} className="commit-branch">
                {branch}
              </span>
            ))}
            {commit.branches.length > 2 && (
              <span className="commit-branch-more">+{commit.branches.length - 2}</span>
            )}
          </span>
        )}
        {commit.tags.length > 0 && (
          <span className="commit-tags">
            {commit.tags.slice(0, 2).map((tag) => (
              <span key={tag} className="commit-tag">
                {tag}
              </span>
            ))}
          </span>
        )}
      </div>
    </div>
  );
};

/**
 * Commit detail panel
 */
interface CommitDetailPanelProps {
  detail: GitCommitDetail | null;
  isLoading: boolean;
  onClose: () => void;
  onCheckout: (sha: string) => void;
  onCherryPick: (sha: string) => void;
}

const CommitDetailPanel: React.FC<CommitDetailPanelProps> = ({
  detail,
  isLoading,
  onClose,
  onCheckout,
  onCherryPick,
}) => {
  const [showRawDiff, setShowRawDiff] = useState(false);

  if (isLoading) {
    return (
      <div className="git-history-detail loading">
        <div className="loading-spinner" />
        <span>Loading commit details...</span>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="git-history-detail empty">
        <span>Select a commit to view details</span>
      </div>
    );
  }

  const { commit, diff } = detail;

  return (
    <div className="git-history-detail">
      <div className="detail-header">
        <h3>Commit Details</h3>
        <button className="detail-close" onClick={onClose} aria-label="Close">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="detail-content">
        {/* Commit info */}
        <div className="detail-section">
          <div className="detail-sha">
            <span className="label">SHA:</span>
            <code>{commit.sha}</code>
          </div>
          <div className="detail-message">
            <h4>{commit.subject}</h4>
            {commit.body && <p>{commit.body}</p>}
          </div>
          <div className="detail-meta">
            <div className="meta-item">
              <span className="label">Author:</span>
              <span>
                {commit.author} &lt;{commit.authorEmail}&gt;
              </span>
            </div>
            <div className="meta-item">
              <span className="label">Date:</span>
              <span>{new Date(commit.authorDate).toLocaleString()}</span>
            </div>
            {commit.author !== commit.committer && (
              <div className="meta-item">
                <span className="label">Committer:</span>
                <span>{commit.committer}</span>
              </div>
            )}
            <div className="meta-item">
              <span className="label">Parents:</span>
              <span>{commit.parents.map((p) => p.substring(0, 7)).join(', ') || 'None'}</span>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="detail-actions">
          <button className="action-btn" onClick={() => onCheckout(commit.sha)}>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <polyline points="9 11 12 14 22 4" />
              <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
            </svg>
            Checkout
          </button>
          <button className="action-btn" onClick={() => onCherryPick(commit.sha)}>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="12" cy="8" r="6" />
              <path d="M12 14v7" />
              <path d="M9 18h6" />
            </svg>
            Cherry-pick
          </button>
        </div>

        {/* File changes */}
        {diff && (
          <div className="detail-section">
            <h4>
              Files Changed
              <span className="stats">
                <span className="additions">+{diff.stats.insertions}</span>
                <span className="deletions">-{diff.stats.deletions}</span>
              </span>
            </h4>
            <div className="file-list">
              {diff.files.map((file) => (
                <div key={file.path} className="file-item">
                  <span className="file-status" style={{ color: getStatusColor(file.status) }}>
                    {getStatusIcon(file.status)}
                  </span>
                  <span className="file-path">
                    {file.oldPath && file.oldPath !== file.path ? (
                      <>
                        <span className="old-path">{file.oldPath}</span>
                        <span className="arrow"> -&gt; </span>
                      </>
                    ) : null}
                    {file.path}
                  </span>
                  {!file.isBinary && (
                    <span className="file-stats">
                      <span className="additions">+{file.additions}</span>
                      <span className="deletions">-{file.deletions}</span>
                    </span>
                  )}
                  {file.isBinary && <span className="binary-badge">binary</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Raw diff toggle */}
        {diff?.rawDiff && (
          <div className="detail-section">
            <button className="toggle-diff" onClick={() => setShowRawDiff(!showRawDiff)}>
              {showRawDiff ? 'Hide' : 'Show'} Raw Diff
            </button>
            {showRawDiff && (
              <pre className="raw-diff">
                <code>{diff.rawDiff}</code>
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * Branch comparison panel
 */
interface BranchComparisonPanelProps {
  comparison: GitBranchComparison | null;
  isLoading: boolean;
  onClose: () => void;
}

const BranchComparisonPanel: React.FC<BranchComparisonPanelProps> = ({
  comparison,
  isLoading,
  onClose,
}) => {
  if (isLoading) {
    return (
      <div className="git-history-comparison loading">
        <div className="loading-spinner" />
        <span>Comparing branches...</span>
      </div>
    );
  }

  if (!comparison) {
    return null;
  }

  return (
    <div className="git-history-comparison">
      <div className="comparison-header">
        <h3>
          {comparison.baseBranch} ... {comparison.compareBranch}
        </h3>
        <button className="comparison-close" onClick={onClose} aria-label="Close">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="comparison-stats">
        <div className="stat">
          <span className="value ahead">{comparison.stats.aheadCount}</span>
          <span className="label">ahead</span>
        </div>
        <div className="stat">
          <span className="value behind">{comparison.stats.behindCount}</span>
          <span className="label">behind</span>
        </div>
        <div className="stat">
          <span className="value">{comparison.stats.filesChanged}</span>
          <span className="label">files</span>
        </div>
        <div className="stat">
          <span className="value additions">+{comparison.stats.insertions}</span>
          <span className="value deletions">-{comparison.stats.deletions}</span>
        </div>
      </div>

      {comparison.ahead.length > 0 && (
        <div className="comparison-section">
          <h4>Commits ahead of {comparison.baseBranch}</h4>
          <div className="commit-list">
            {comparison.ahead.map((commit) => (
              <div key={commit.sha} className="comparison-commit">
                <span className="sha">{commit.shortSha}</span>
                <span className="subject">{commit.subject}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {comparison.behind.length > 0 && (
        <div className="comparison-section">
          <h4>Commits behind {comparison.baseBranch}</h4>
          <div className="commit-list">
            {comparison.behind.map((commit) => (
              <div key={commit.sha} className="comparison-commit">
                <span className="sha">{commit.shortSha}</span>
                <span className="subject">{commit.subject}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * Filter panel
 */
interface FilterPanelProps {
  filters: GitHistoryFilter;
  branches: string[];
  onFilterChange: (filters: GitHistoryFilter) => void;
  onSearch: (query: string) => void;
}

const FilterPanel: React.FC<FilterPanelProps> = ({
  filters,
  branches,
  onFilterChange,
  onSearch,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [isExpanded, setIsExpanded] = useState(false);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch(searchQuery);
  };

  return (
    <div className="git-history-filters">
      <form className="search-form" onSubmit={handleSearch}>
        <input
          type="text"
          placeholder="Search commits..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="search-input"
        />
        <button type="submit" className="search-btn">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
        </button>
      </form>

      <button className="filter-toggle" onClick={() => setIsExpanded(!isExpanded)}>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
        </svg>
        Filters
        {isExpanded ? (
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <polyline points="18 15 12 9 6 15" />
          </svg>
        ) : (
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        )}
      </button>

      {isExpanded && (
        <div className="filter-options">
          <div className="filter-row">
            <label>Branch:</label>
            <select
              value={filters.branch || ''}
              onChange={(e) => onFilterChange({ ...filters, branch: e.target.value || undefined })}
            >
              <option value="">All branches</option>
              {branches.map((branch) => (
                <option key={branch} value={branch}>
                  {branch}
                </option>
              ))}
            </select>
          </div>

          <div className="filter-row">
            <label>Author:</label>
            <input
              type="text"
              placeholder="Filter by author"
              value={filters.author || ''}
              onChange={(e) => onFilterChange({ ...filters, author: e.target.value || undefined })}
            />
          </div>

          <div className="filter-row">
            <label>Since:</label>
            <input
              type="date"
              value={filters.since || ''}
              onChange={(e) => onFilterChange({ ...filters, since: e.target.value || undefined })}
            />
          </div>

          <div className="filter-row">
            <label>Until:</label>
            <input
              type="date"
              value={filters.until || ''}
              onChange={(e) => onFilterChange({ ...filters, until: e.target.value || undefined })}
            />
          </div>

          <div className="filter-row">
            <label>Limit:</label>
            <select
              value={filters.limit || 20}
              onChange={(e) => onFilterChange({ ...filters, limit: parseInt(e.target.value, 10) })}
            >
              <option value="10">10</option>
              <option value="20">20</option>
              <option value="50">50</option>
              <option value="100">100</option>
            </select>
          </div>

          <button className="filter-clear" onClick={() => onFilterChange({ limit: 20 })}>
            Clear Filters
          </button>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// Main Component
// ============================================================================

/**
 * Git History Explorer Component
 */
export const GitHistory: React.FC<GitHistoryProps> = ({
  repoPath,
  initialBranch,
  isOpen,
  onClose,
  onCommitSelect,
}) => {
  // State
  const [history, setHistory] = useState<GitHistoryResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedSha, setSelectedSha] = useState<string | null>(null);
  const [commitDetail, setCommitDetail] = useState<GitCommitDetail | null>(null);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [comparison, setComparison] = useState<GitBranchComparison | null>(null);
  const [isComparing, setIsComparing] = useState(false);
  const [filters, setFilters] = useState<GitHistoryFilter>({
    branch: initialBranch,
    limit: 20,
  });
  const [page, setPage] = useState(0);

  const listRef = useRef<HTMLDivElement>(null);

  // Fetch history
  const fetchHistory = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await window.atlas?.invoke<{
        success: boolean;
        data?: GitHistoryResult;
        error?: string;
      }>('git:history', {
        path: repoPath,
        branch: filters.branch,
        author: filters.author,
        since: filters.since,
        until: filters.until,
        messagePattern: filters.messagePattern,
        limit: filters.limit || 20,
        skip: page * (filters.limit || 20),
        includeGraph: true,
      });

      if (result?.success && result.data) {
        setHistory(result.data);
      } else {
        setError(result?.error || 'Failed to fetch git history');
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, [repoPath, filters, page]);

  // Fetch commit detail
  const fetchCommitDetail = useCallback(
    async (sha: string) => {
      setIsDetailLoading(true);

      try {
        const result = await window.atlas?.invoke<{
          success: boolean;
          data?: GitCommitDetail;
          error?: string;
        }>('git:commit-detail', {
          sha,
          path: repoPath,
          includeDiff: true,
        });

        if (result?.success && result.data) {
          setCommitDetail(result.data);
        }
      } catch (err) {
        console.error('Failed to fetch commit detail:', err);
      } finally {
        setIsDetailLoading(false);
      }
    },
    [repoPath]
  );

  // Compare branches
  // @ts-expect-error Reserved for future branch comparison feature
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _compareBranches = useCallback(
    async (base: string, compare: string) => {
      setIsComparing(true);

      try {
        const result = await window.atlas?.invoke<{
          success: boolean;
          data?: GitBranchComparison;
          error?: string;
        }>('git:compare-branches', {
          base,
          compare,
          path: repoPath,
          includeDiff: true,
        });

        if (result?.success && result.data) {
          setComparison(result.data);
        }
      } catch (err) {
        console.error('Failed to compare branches:', err);
      } finally {
        setIsComparing(false);
      }
    },
    [repoPath]
  );

  // Search commits
  const searchCommits = useCallback(async (query: string) => {
    if (!query.trim()) {
      setFilters((f) => ({ ...f, messagePattern: undefined }));
      return;
    }

    setFilters((f) => ({ ...f, messagePattern: query }));
    setPage(0);
  }, []);

  // Checkout commit
  const handleCheckout = useCallback(
    async (sha: string) => {
      if (!window.confirm(`Are you sure you want to checkout commit ${sha.substring(0, 7)}?`)) {
        return;
      }

      try {
        const result = await window.atlas?.invoke<{ success: boolean; error?: string }>(
          'git:checkout',
          {
            ref: sha,
            path: repoPath,
          }
        );

        if (result?.success) {
          fetchHistory();
        } else {
          alert(result?.error || 'Checkout failed');
        }
      } catch (err) {
        alert((err as Error).message);
      }
    },
    [repoPath, fetchHistory]
  );

  // Cherry-pick commit
  const handleCherryPick = useCallback(
    async (sha: string) => {
      if (!window.confirm(`Are you sure you want to cherry-pick commit ${sha.substring(0, 7)}?`)) {
        return;
      }

      try {
        const result = await window.atlas?.invoke<{ success: boolean; error?: string }>(
          'git:cherry-pick',
          {
            sha,
            path: repoPath,
          }
        );

        if (result?.success) {
          fetchHistory();
        } else {
          alert(result?.error || 'Cherry-pick failed');
        }
      } catch (err) {
        alert((err as Error).message);
      }
    },
    [repoPath, fetchHistory]
  );

  // Handle commit selection
  const handleCommitClick = useCallback(
    (sha: string) => {
      setSelectedSha(sha);
      fetchCommitDetail(sha);

      const commit = history?.commits.find((c) => c.sha === sha);
      if (commit && onCommitSelect) {
        onCommitSelect(commit);
      }
    },
    [history, fetchCommitDetail, onCommitSelect]
  );

  // Initial fetch
  useEffect(() => {
    if (isOpen) {
      fetchHistory();
    }
  }, [isOpen, fetchHistory]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (commitDetail) {
          setCommitDetail(null);
          setSelectedSha(null);
        } else {
          onClose();
        }
      } else if (e.key === 'ArrowDown' && history?.commits) {
        e.preventDefault();
        const currentIndex = history.commits.findIndex((c) => c.sha === selectedSha);
        const nextIndex = Math.min(currentIndex + 1, history.commits.length - 1);
        handleCommitClick(history.commits[nextIndex].sha);
      } else if (e.key === 'ArrowUp' && history?.commits) {
        e.preventDefault();
        const currentIndex = history.commits.findIndex((c) => c.sha === selectedSha);
        const prevIndex = Math.max(currentIndex - 1, 0);
        handleCommitClick(history.commits[prevIndex].sha);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, history, selectedSha, commitDetail, onClose, handleCommitClick]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="git-history-overlay">
      <div className="git-history-panel">
        {/* Header */}
        <div className="git-history-header">
          <h2>Git History</h2>
          <div className="header-info">
            {history && (
              <>
                <span className="branch-badge">{history.currentBranch}</span>
                <span className="commit-count">{history.totalCount} commits</span>
              </>
            )}
          </div>
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

        {/* Filters */}
        {history && (
          <FilterPanel
            filters={filters}
            branches={history.branches}
            onFilterChange={(f) => {
              setFilters(f);
              setPage(0);
            }}
            onSearch={searchCommits}
          />
        )}

        {/* Content */}
        <div className="git-history-content">
          {/* Error state */}
          {error && (
            <div className="git-history-error">
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
              <button onClick={fetchHistory}>Retry</button>
            </div>
          )}

          {/* Loading state */}
          {isLoading && !history && (
            <div className="git-history-loading">
              <div className="loading-spinner" />
              <span>Loading history...</span>
            </div>
          )}

          {/* Commit list with graph */}
          {history && (
            <div className="git-history-list-container">
              <div className="git-history-list" ref={listRef}>
                {history.graph && (
                  <CommitGraph
                    nodes={history.graph}
                    selectedSha={selectedSha || undefined}
                    onNodeClick={handleCommitClick}
                  />
                )}
                <div className="commit-list">
                  {history.commits.map((commit) => (
                    <CommitRow
                      key={commit.sha}
                      commit={commit}
                      isSelected={commit.sha === selectedSha}
                      onClick={() => handleCommitClick(commit.sha)}
                    />
                  ))}
                </div>
              </div>

              {/* Pagination */}
              {(history.hasMore || page > 0) && (
                <div className="git-history-pagination">
                  <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                    Previous
                  </button>
                  <span>
                    Page {page + 1} of {Math.ceil(history.totalCount / (filters.limit || 20))}
                  </span>
                  <button disabled={!history.hasMore} onClick={() => setPage((p) => p + 1)}>
                    Next
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Detail panel */}
          {selectedSha && (
            <CommitDetailPanel
              detail={commitDetail}
              isLoading={isDetailLoading}
              onClose={() => {
                setCommitDetail(null);
                setSelectedSha(null);
              }}
              onCheckout={handleCheckout}
              onCherryPick={handleCherryPick}
            />
          )}

          {/* Branch comparison */}
          {comparison && (
            <BranchComparisonPanel
              comparison={comparison}
              isLoading={isComparing}
              onClose={() => setComparison(null)}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default GitHistory;
