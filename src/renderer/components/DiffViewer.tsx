/**
 * Atlas Desktop - Git Diff Viewer Component
 *
 * Visual git diff viewer with syntax highlighting and voice control support.
 * Features side-by-side and unified diff views with voice navigation.
 *
 * @module components/DiffViewer
 */

import React, { useCallback, useEffect, useState, useRef, useMemo } from 'react';
import './DiffViewer.css';

// ============================================================================
// Types
// ============================================================================

/** Diff line type */
interface DiffLine {
  type: 'add' | 'delete' | 'context';
  content: string;
  oldLineNo?: number;
  newLineNo?: number;
}

/** Diff hunk */
interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  header: string;
  lines: DiffLine[];
}

/** File diff */
interface FileDiff {
  path: string;
  oldPath?: string;
  changeType: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied';
  isBinary: boolean;
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
  rawDiff: string;
}

/** Diff summary from LLM */
interface DiffSummary {
  overview: string;
  keyChanges: string[];
  concerns: string[];
  suggestedCommitMessage?: string;
  fileGroups: {
    added: string[];
    modified: string[];
    deleted: string[];
    renamed: string[];
  };
}

/** Navigation state */
interface NavigationState {
  currentFileIndex: number;
  currentHunkIndex: number;
  totalFiles: number;
  currentFile: string | null;
  hasSummary: boolean;
}

/** Complete diff result */
interface DiffResult {
  staged: boolean;
  files: FileDiff[];
  totalAdditions: number;
  totalDeletions: number;
  totalFiles: number;
  repoRoot: string;
  branch: string;
  commit?: string;
  summary?: DiffSummary | null;
  navigation?: NavigationState;
}

/** View mode for diff display */
type ViewMode = 'unified' | 'split';

/** DiffViewer props */
interface DiffViewerProps {
  /** Whether the viewer is open */
  isOpen: boolean;
  /** Close handler */
  onClose: () => void;
  /** Initial diff type to show */
  initialStaged?: boolean;
}

// ============================================================================
// Helper Components
// ============================================================================

/**
 * Syntax highlighting for diff lines
 */
function highlightSyntax(content: string, fileExt: string): React.ReactNode {
  // Simple keyword highlighting based on file extension
  const keywords: Record<string, string[]> = {
    ts: [
      'const',
      'let',
      'var',
      'function',
      'class',
      'interface',
      'type',
      'import',
      'export',
      'return',
      'if',
      'else',
      'for',
      'while',
      'async',
      'await',
      'try',
      'catch',
      'throw',
      'new',
    ],
    tsx: [
      'const',
      'let',
      'var',
      'function',
      'class',
      'interface',
      'type',
      'import',
      'export',
      'return',
      'if',
      'else',
      'for',
      'while',
      'async',
      'await',
      'try',
      'catch',
      'throw',
      'new',
      'React',
    ],
    js: [
      'const',
      'let',
      'var',
      'function',
      'class',
      'import',
      'export',
      'return',
      'if',
      'else',
      'for',
      'while',
      'async',
      'await',
      'try',
      'catch',
      'throw',
      'new',
    ],
    jsx: [
      'const',
      'let',
      'var',
      'function',
      'class',
      'import',
      'export',
      'return',
      'if',
      'else',
      'for',
      'while',
      'async',
      'await',
      'try',
      'catch',
      'throw',
      'new',
      'React',
    ],
    py: [
      'def',
      'class',
      'import',
      'from',
      'return',
      'if',
      'elif',
      'else',
      'for',
      'while',
      'try',
      'except',
      'raise',
      'with',
      'as',
      'async',
      'await',
      'yield',
      'lambda',
      'self',
      'None',
      'True',
      'False',
    ],
    css: ['@import', '@media', '@keyframes', '@font-face'],
    json: [],
    md: [],
  };

  const ext = fileExt.toLowerCase().replace('.', '');
  const fileKeywords = keywords[ext] || keywords.ts;

  if (fileKeywords.length === 0) {
    return content;
  }

  // Split by word boundaries and highlight keywords
  const parts: React.ReactNode[] = [];
  let key = 0;

  // Match strings
  const stringRegex = /(['"`])(?:(?!\1)[^\\]|\\.)*\1/g;
  // Match comments
  const commentRegex = /\/\/.*$|\/\*[\s\S]*?\*\/|#.*$/gm;
  // Match keywords
  const keywordRegex = new RegExp(`\\b(${fileKeywords.join('|')})\\b`, 'g');

  // Combine all patterns
  const combined = new RegExp(
    `(${stringRegex.source})|(${commentRegex.source})|(${keywordRegex.source})`,
    'gm'
  );

  let lastIndex = 0;
  let match;

  while ((match = combined.exec(content)) !== null) {
    // Add text before match
    if (match.index > lastIndex) {
      parts.push(content.slice(lastIndex, match.index));
    }

    if (match[1]) {
      // String
      parts.push(
        <span key={key++} className="diff-syntax-string">
          {match[0]}
        </span>
      );
    } else if (match[2]) {
      // Comment
      parts.push(
        <span key={key++} className="diff-syntax-comment">
          {match[0]}
        </span>
      );
    } else if (match[3]) {
      // Keyword
      parts.push(
        <span key={key++} className="diff-syntax-keyword">
          {match[0]}
        </span>
      );
    }

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < content.length) {
    parts.push(content.slice(lastIndex));
  }

  return parts.length > 0 ? parts : content;
}

/**
 * Get file extension from path
 */
function getFileExtension(path: string): string {
  const match = path.match(/\.([^.]+)$/);
  return match ? match[1] : '';
}

/**
 * File icon based on extension
 */
function FileIcon({ path, changeType }: { path: string; changeType: string }) {
  const ext = getFileExtension(path);

  const iconColors: Record<string, string> = {
    ts: '#3178c6',
    tsx: '#3178c6',
    js: '#f7df1e',
    jsx: '#f7df1e',
    css: '#1572b6',
    html: '#e34f26',
    json: '#000000',
    md: '#083fa1',
    py: '#3776ab',
    rs: '#dea584',
    go: '#00add8',
  };

  const changeColors: Record<string, string> = {
    added: '#22c55e',
    deleted: '#ef4444',
    modified: '#f59e0b',
    renamed: '#8b5cf6',
    copied: '#06b6d4',
  };

  return (
    <span className="diff-file-icon" style={{ color: iconColors[ext] || '#9ca3af' }}>
      <span className="diff-file-icon-dot" style={{ background: changeColors[changeType] }} />
    </span>
  );
}

/**
 * Unified diff view
 */
function UnifiedDiffView({
  file,
  currentHunkIndex,
  onHunkClick,
}: {
  file: FileDiff;
  currentHunkIndex: number;
  onHunkClick: (index: number) => void;
}) {
  const fileExt = getFileExtension(file.path);

  if (file.isBinary) {
    return <div className="diff-binary-notice">Binary file - cannot display diff</div>;
  }

  return (
    <div className="diff-unified-view">
      {file.hunks.map((hunk, hunkIdx) => (
        <div
          key={hunkIdx}
          className={`diff-hunk ${currentHunkIndex === hunkIdx ? 'diff-hunk-active' : ''}`}
          onClick={() => onHunkClick(hunkIdx)}
        >
          <div className="diff-hunk-header">
            <span className="diff-hunk-range">
              @@ -{hunk.oldStart},{hunk.oldCount} +{hunk.newStart},{hunk.newCount} @@
            </span>
            {hunk.header && <span className="diff-hunk-context">{hunk.header}</span>}
          </div>
          <div className="diff-hunk-content">
            {hunk.lines.map((line, lineIdx) => (
              <div key={lineIdx} className={`diff-line diff-line-${line.type}`}>
                <span className="diff-line-no diff-line-no-old">
                  {line.type !== 'add' ? line.oldLineNo : ''}
                </span>
                <span className="diff-line-no diff-line-no-new">
                  {line.type !== 'delete' ? line.newLineNo : ''}
                </span>
                <span className="diff-line-marker">
                  {line.type === 'add' ? '+' : line.type === 'delete' ? '-' : ' '}
                </span>
                <span className="diff-line-content">{highlightSyntax(line.content, fileExt)}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
      {file.hunks.length === 0 && <div className="diff-empty-notice">No changes in this file</div>}
    </div>
  );
}

/**
 * Split (side-by-side) diff view
 */
function SplitDiffView({
  file,
  currentHunkIndex,
  onHunkClick,
}: {
  file: FileDiff;
  currentHunkIndex: number;
  onHunkClick: (index: number) => void;
}) {
  const fileExt = getFileExtension(file.path);

  if (file.isBinary) {
    return <div className="diff-binary-notice">Binary file - cannot display diff</div>;
  }

  // Process hunks into side-by-side pairs
  const processHunk = (hunk: DiffHunk) => {
    const pairs: Array<{ left: DiffLine | null; right: DiffLine | null }> = [];
    const deletes: DiffLine[] = [];
    const adds: DiffLine[] = [];

    for (const line of hunk.lines) {
      if (line.type === 'context') {
        // Flush pending deletes/adds
        while (deletes.length || adds.length) {
          pairs.push({
            left: deletes.shift() || null,
            right: adds.shift() || null,
          });
        }
        pairs.push({ left: line, right: line });
      } else if (line.type === 'delete') {
        deletes.push(line);
      } else if (line.type === 'add') {
        adds.push(line);
      }
    }

    // Flush remaining
    while (deletes.length || adds.length) {
      pairs.push({
        left: deletes.shift() || null,
        right: adds.shift() || null,
      });
    }

    return pairs;
  };

  return (
    <div className="diff-split-view">
      {file.hunks.map((hunk, hunkIdx) => {
        const pairs = processHunk(hunk);
        return (
          <div
            key={hunkIdx}
            className={`diff-hunk ${currentHunkIndex === hunkIdx ? 'diff-hunk-active' : ''}`}
            onClick={() => onHunkClick(hunkIdx)}
          >
            <div className="diff-hunk-header diff-hunk-header-split">
              <span className="diff-hunk-range">
                @@ -{hunk.oldStart},{hunk.oldCount} +{hunk.newStart},{hunk.newCount} @@
              </span>
              {hunk.header && <span className="diff-hunk-context">{hunk.header}</span>}
            </div>
            <div className="diff-split-content">
              <div className="diff-split-left">
                {pairs.map((pair, idx) => (
                  <div
                    key={idx}
                    className={`diff-line ${pair.left ? `diff-line-${pair.left.type === 'context' ? 'context' : 'delete'}` : 'diff-line-empty'}`}
                  >
                    <span className="diff-line-no">{pair.left?.oldLineNo || ''}</span>
                    <span className="diff-line-content">
                      {pair.left ? highlightSyntax(pair.left.content, fileExt) : ''}
                    </span>
                  </div>
                ))}
              </div>
              <div className="diff-split-right">
                {pairs.map((pair, idx) => (
                  <div
                    key={idx}
                    className={`diff-line ${pair.right ? `diff-line-${pair.right.type === 'context' ? 'context' : 'add'}` : 'diff-line-empty'}`}
                  >
                    <span className="diff-line-no">{pair.right?.newLineNo || ''}</span>
                    <span className="diff-line-content">
                      {pair.right ? highlightSyntax(pair.right.content, fileExt) : ''}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })}
      {file.hunks.length === 0 && <div className="diff-empty-notice">No changes in this file</div>}
    </div>
  );
}

/**
 * Summary panel
 */
function SummaryPanel({ summary }: { summary: DiffSummary }) {
  return (
    <div className="diff-summary-panel">
      <h4 className="diff-summary-title">Change Summary</h4>
      <p className="diff-summary-overview">{summary.overview}</p>

      {summary.keyChanges.length > 0 && (
        <div className="diff-summary-section">
          <h5>Key Changes</h5>
          <ul className="diff-summary-list">
            {summary.keyChanges.map((change, idx) => (
              <li key={idx}>{change}</li>
            ))}
          </ul>
        </div>
      )}

      {summary.concerns.length > 0 && (
        <div className="diff-summary-section diff-summary-concerns">
          <h5>Concerns</h5>
          <ul className="diff-summary-list">
            {summary.concerns.map((concern, idx) => (
              <li key={idx}>{concern}</li>
            ))}
          </ul>
        </div>
      )}

      {summary.suggestedCommitMessage && (
        <div className="diff-summary-section">
          <h5>Suggested Commit Message</h5>
          <code className="diff-commit-suggestion">{summary.suggestedCommitMessage}</code>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

/**
 * Git Diff Viewer Component
 */
export const DiffViewer: React.FC<DiffViewerProps> = ({
  isOpen,
  onClose,
  initialStaged = false,
}) => {
  // State
  const [diffResult, setDiffResult] = useState<DiffResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('unified');
  const [showStaged, setShowStaged] = useState(initialStaged);
  const [showSummary, setShowSummary] = useState(true);
  const [selectedFileIndex, setSelectedFileIndex] = useState(0);
  const [selectedHunkIndex, setSelectedHunkIndex] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');

  // Refs
  const containerRef = useRef<HTMLDivElement>(null);
  const fileListRef = useRef<HTMLDivElement>(null);

  // Fetch diff data
  const fetchDiff = useCallback(async (staged: boolean) => {
    setLoading(true);
    setError(null);

    try {
      const result = await window.atlas?.invoke<{
        success: boolean;
        data?: DiffResult;
        error?: string;
      }>('atlas:git-diff-viewer', { staged, summarize: true });

      if (result?.success && result.data) {
        setDiffResult(result.data);
        setSelectedFileIndex(0);
        setSelectedHunkIndex(0);
      } else {
        setError(result?.error || 'Failed to fetch diff');
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    if (isOpen) {
      fetchDiff(showStaged);
    }
  }, [isOpen, showStaged, fetchDiff]);

  // Voice command handlers
  useEffect(() => {
    if (!isOpen) return;

    const handleVoiceCommand = (event: unknown) => {
      const cmd = event as { command: string; args?: Record<string, unknown> };

      switch (cmd.command) {
        case 'next_file':
          if (diffResult && selectedFileIndex < diffResult.files.length - 1) {
            setSelectedFileIndex((i) => i + 1);
            setSelectedHunkIndex(0);
          }
          break;
        case 'previous_file':
          if (selectedFileIndex > 0) {
            setSelectedFileIndex((i) => i - 1);
            setSelectedHunkIndex(0);
          }
          break;
        case 'next_hunk':
          if (diffResult) {
            const file = diffResult.files[selectedFileIndex];
            if (file && selectedHunkIndex < file.hunks.length - 1) {
              setSelectedHunkIndex((i) => i + 1);
            } else if (selectedFileIndex < diffResult.files.length - 1) {
              setSelectedFileIndex((i) => i + 1);
              setSelectedHunkIndex(0);
            }
          }
          break;
        case 'previous_hunk':
          if (selectedHunkIndex > 0) {
            setSelectedHunkIndex((i) => i - 1);
          } else if (selectedFileIndex > 0) {
            setSelectedFileIndex((i) => i - 1);
            const prevFile = diffResult?.files[selectedFileIndex - 1];
            if (prevFile) {
              setSelectedHunkIndex(Math.max(0, prevFile.hunks.length - 1));
            }
          }
          break;
        case 'show_staged':
          setShowStaged(true);
          break;
        case 'show_unstaged':
          setShowStaged(false);
          break;
        case 'toggle_view':
          setViewMode((m) => (m === 'unified' ? 'split' : 'unified'));
          break;
        case 'accept_change':
        case 'stage_file':
          handleStageFile();
          break;
        case 'discard_change':
          handleDiscardFile();
          break;
        case 'close':
          onClose();
          break;
      }
    };

    const unsubscribe = window.atlas?.on('atlas:diff-command', handleVoiceCommand);
    return () => unsubscribe?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, diffResult, selectedFileIndex, selectedHunkIndex, onClose]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }

      if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault();
        if (diffResult && selectedFileIndex < diffResult.files.length - 1) {
          setSelectedFileIndex((i) => i + 1);
          setSelectedHunkIndex(0);
        }
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault();
        if (selectedFileIndex > 0) {
          setSelectedFileIndex((i) => i - 1);
          setSelectedHunkIndex(0);
        }
      } else if (e.key === 'ArrowRight' || e.key === 'l') {
        e.preventDefault();
        if (diffResult) {
          const file = diffResult.files[selectedFileIndex];
          if (file && selectedHunkIndex < file.hunks.length - 1) {
            setSelectedHunkIndex((i) => i + 1);
          }
        }
      } else if (e.key === 'ArrowLeft' || e.key === 'h') {
        e.preventDefault();
        if (selectedHunkIndex > 0) {
          setSelectedHunkIndex((i) => i - 1);
        }
      } else if (e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault();
        setShowStaged((s) => !s);
      } else if (e.key === 'v') {
        setViewMode((m) => (m === 'unified' ? 'split' : 'unified'));
      } else if (e.key === 's' && !e.ctrlKey && !e.metaKey) {
        handleStageFile();
      } else if (e.key === 'd' && !e.ctrlKey && !e.metaKey) {
        handleDiscardFile();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, diffResult, selectedFileIndex, selectedHunkIndex, onClose]);

  // Scroll selected file into view
  useEffect(() => {
    if (fileListRef.current) {
      const selectedElement = fileListRef.current.querySelector('.diff-file-item-selected');
      selectedElement?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [selectedFileIndex]);

  // Stage current file
  const handleStageFile = useCallback(async () => {
    if (!diffResult || !diffResult.files[selectedFileIndex]) return;

    const file = diffResult.files[selectedFileIndex];
    try {
      await window.atlas?.invoke('atlas:git-diff-action', {
        action: 'stage',
        file: file.path,
      });
      // Refresh
      fetchDiff(showStaged);
    } catch (err) {
      console.error('Failed to stage file:', err);
    }
  }, [diffResult, selectedFileIndex, showStaged, fetchDiff]);

  // Discard current file
  const handleDiscardFile = useCallback(async () => {
    if (!diffResult || !diffResult.files[selectedFileIndex]) return;

    const file = diffResult.files[selectedFileIndex];
    if (!confirm(`Discard all changes to ${file.path}?`)) return;

    try {
      await window.atlas?.invoke('atlas:git-diff-action', {
        action: 'discard',
        file: file.path,
      });
      // Refresh
      fetchDiff(showStaged);
    } catch (err) {
      console.error('Failed to discard file:', err);
    }
  }, [diffResult, selectedFileIndex, showStaged, fetchDiff]);

  // Filter files by search
  const filteredFiles = useMemo(() => {
    if (!diffResult || !searchQuery) return diffResult?.files || [];
    const query = searchQuery.toLowerCase();
    return diffResult.files.filter((f) => f.path.toLowerCase().includes(query));
  }, [diffResult, searchQuery]);

  // Current file
  const currentFile = diffResult?.files[selectedFileIndex];

  if (!isOpen) return null;

  return (
    <div className="diff-viewer-overlay" onClick={onClose}>
      <div
        ref={containerRef}
        className="diff-viewer-container"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="diff-viewer-header">
          <div className="diff-viewer-title">
            <h2>Git Diff Viewer</h2>
            {diffResult && (
              <span className="diff-viewer-subtitle">
                {diffResult.branch} - {diffResult.totalFiles} file
                {diffResult.totalFiles !== 1 ? 's' : ''} changed
              </span>
            )}
          </div>

          <div className="diff-viewer-controls">
            {/* Staged/Unstaged toggle */}
            <div className="diff-view-toggle">
              <button
                className={`diff-toggle-btn ${!showStaged ? 'active' : ''}`}
                onClick={() => setShowStaged(false)}
              >
                Unstaged
              </button>
              <button
                className={`diff-toggle-btn ${showStaged ? 'active' : ''}`}
                onClick={() => setShowStaged(true)}
              >
                Staged
              </button>
            </div>

            {/* View mode toggle */}
            <div className="diff-view-toggle">
              <button
                className={`diff-toggle-btn ${viewMode === 'unified' ? 'active' : ''}`}
                onClick={() => setViewMode('unified')}
                title="Unified view"
              >
                Unified
              </button>
              <button
                className={`diff-toggle-btn ${viewMode === 'split' ? 'active' : ''}`}
                onClick={() => setViewMode('split')}
                title="Side-by-side view"
              >
                Split
              </button>
            </div>

            {/* Summary toggle */}
            <button
              className={`diff-summary-toggle ${showSummary ? 'active' : ''}`}
              onClick={() => setShowSummary((s) => !s)}
              title="Toggle summary panel"
            >
              Summary
            </button>

            {/* Close button */}
            <button className="diff-close-btn" onClick={onClose} aria-label="Close">
              ×
            </button>
          </div>
        </div>

        {/* Loading state */}
        {loading && (
          <div className="diff-loading">
            <div className="diff-loading-spinner" />
            <span>Loading diff...</span>
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="diff-error">
            <span className="diff-error-icon">!</span>
            <span>{error}</span>
            <button onClick={() => fetchDiff(showStaged)}>Retry</button>
          </div>
        )}

        {/* Main content */}
        {!loading && !error && diffResult && (
          <div className="diff-viewer-content">
            {/* File list sidebar */}
            <div className="diff-file-list" ref={fileListRef}>
              {/* Search */}
              <div className="diff-file-search">
                <input
                  type="text"
                  placeholder="Filter files..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="diff-search-input"
                />
              </div>

              {/* Stats */}
              <div className="diff-stats">
                <span className="diff-stat diff-stat-add">+{diffResult.totalAdditions}</span>
                <span className="diff-stat diff-stat-delete">-{diffResult.totalDeletions}</span>
              </div>

              {/* File list */}
              <div className="diff-file-items">
                {filteredFiles.map((file, _idx) => {
                  const originalIdx = diffResult.files.indexOf(file);
                  return (
                    <div
                      key={file.path}
                      className={`diff-file-item ${originalIdx === selectedFileIndex ? 'diff-file-item-selected' : ''}`}
                      onClick={() => {
                        setSelectedFileIndex(originalIdx);
                        setSelectedHunkIndex(0);
                      }}
                    >
                      <FileIcon path={file.path} changeType={file.changeType} />
                      <span className="diff-file-name" title={file.path}>
                        {file.path.split('/').pop()}
                      </span>
                      <span className="diff-file-path" title={file.path}>
                        {file.path.split('/').slice(0, -1).join('/')}
                      </span>
                      <span className="diff-file-stats">
                        <span className="diff-stat-mini diff-stat-add">+{file.additions}</span>
                        <span className="diff-stat-mini diff-stat-delete">-{file.deletions}</span>
                      </span>
                    </div>
                  );
                })}

                {filteredFiles.length === 0 && (
                  <div className="diff-no-files">
                    {searchQuery ? 'No files match your search' : 'No changes to display'}
                  </div>
                )}
              </div>
            </div>

            {/* Diff content */}
            <div className="diff-content-area">
              {currentFile && (
                <>
                  {/* File header */}
                  <div className="diff-file-header">
                    <div className="diff-file-info">
                      <span className={`diff-change-badge diff-change-${currentFile.changeType}`}>
                        {currentFile.changeType}
                      </span>
                      <span className="diff-file-full-path">
                        {currentFile.oldPath ? (
                          <>
                            <span className="diff-old-path">{currentFile.oldPath}</span>
                            <span className="diff-rename-arrow"> → </span>
                            <span className="diff-new-path">{currentFile.path}</span>
                          </>
                        ) : (
                          currentFile.path
                        )}
                      </span>
                    </div>
                    <div className="diff-file-actions">
                      <button
                        className="diff-action-btn diff-action-stage"
                        onClick={handleStageFile}
                        title="Stage file (S)"
                      >
                        {showStaged ? 'Unstage' : 'Stage'}
                      </button>
                      {!showStaged && (
                        <button
                          className="diff-action-btn diff-action-discard"
                          onClick={handleDiscardFile}
                          title="Discard changes (D)"
                        >
                          Discard
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Diff view */}
                  <div className="diff-view-container">
                    {viewMode === 'unified' ? (
                      <UnifiedDiffView
                        file={currentFile}
                        currentHunkIndex={selectedHunkIndex}
                        onHunkClick={setSelectedHunkIndex}
                      />
                    ) : (
                      <SplitDiffView
                        file={currentFile}
                        currentHunkIndex={selectedHunkIndex}
                        onHunkClick={setSelectedHunkIndex}
                      />
                    )}
                  </div>
                </>
              )}

              {!currentFile && diffResult.files.length === 0 && (
                <div className="diff-no-content">
                  <p>No {showStaged ? 'staged' : 'unstaged'} changes</p>
                  <button onClick={() => setShowStaged((s) => !s)}>
                    Show {showStaged ? 'unstaged' : 'staged'} changes
                  </button>
                </div>
              )}
            </div>

            {/* Summary panel */}
            {showSummary && diffResult.summary && (
              <div className="diff-summary-sidebar">
                <SummaryPanel summary={diffResult.summary} />
              </div>
            )}
          </div>
        )}

        {/* Footer with keyboard shortcuts */}
        <div className="diff-viewer-footer">
          <div className="diff-shortcuts">
            <span className="diff-shortcut">
              <kbd>↑</kbd>/<kbd>↓</kbd> Navigate files
            </span>
            <span className="diff-shortcut">
              <kbd>←</kbd>/<kbd>→</kbd> Navigate hunks
            </span>
            <span className="diff-shortcut">
              <kbd>Tab</kbd> Toggle staged
            </span>
            <span className="diff-shortcut">
              <kbd>V</kbd> Toggle view
            </span>
            <span className="diff-shortcut">
              <kbd>S</kbd> Stage file
            </span>
            <span className="diff-shortcut">
              <kbd>Esc</kbd> Close
            </span>
          </div>
          <div className="diff-voice-hint">
            Voice: &quot;Next file&quot;, &quot;Show changes&quot;, &quot;Stage file&quot;,
            &quot;Accept change&quot;
          </div>
        </div>
      </div>
    </div>
  );
};

export default DiffViewer;
