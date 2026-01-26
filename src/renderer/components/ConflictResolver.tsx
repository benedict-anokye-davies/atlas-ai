/**
 * Atlas Desktop - Conflict Resolver Component
 *
 * Voice-driven UI for git merge/rebase conflict resolution.
 * Features:
 * - Visual diff view of conflicts
 * - Voice command integration
 * - Navigation between conflicts
 * - LLM-suggested resolutions
 * - Quick actions for ours/theirs/both
 *
 * @module renderer/components/ConflictResolver
 */

import React, { useCallback, useEffect, useState, useMemo } from 'react';
import './ConflictResolver.css';

// ============================================================================
// Types
// ============================================================================

/**
 * Conflict hunk from main process
 */
interface ConflictHunk {
  id: string;
  startLine: number;
  endLine: number;
  oursContent: string;
  theirsContent: string;
  baseContent: string;
  contextBefore: string[];
  contextAfter: string[];
  oursBranch: string;
  theirsBranch: string;
}

/**
 * Conflict file from main process
 */
interface ConflictFile {
  path: string;
  absolutePath: string;
  conflictCount: number;
  hunks: ConflictHunk[];
  fileType: string;
  isBinary: boolean;
}

/**
 * Merge state from main process
 */
interface MergeState {
  type: 'merge' | 'rebase' | 'cherry-pick' | 'revert' | 'none';
  hasConflicts: boolean;
  currentBranch: string;
  incomingRef: string;
  conflictFiles: string[];
  currentStep?: number;
  totalSteps?: number;
  mergeMessage?: string;
}

/**
 * Resolution strategy
 */
type ResolutionStrategy = 'ours' | 'theirs' | 'both' | 'manual';

/**
 * Conflict resolver props
 */
interface ConflictResolverProps {
  /** Whether the resolver panel is visible */
  visible: boolean;
  /** Callback when panel is closed */
  onClose: () => void;
  /** Initial file to show (optional) */
  initialFile?: string;
}

/**
 * Navigation position
 */
interface NavigationPosition {
  fileIndex: number;
  hunkIndex: number;
}

// ============================================================================
// Helper Components
// ============================================================================

/**
 * Syntax-highlighted code block
 */
const CodeBlock: React.FC<{
  content: string;
  language?: string;
  label?: string;
  variant?: 'ours' | 'theirs' | 'base' | 'context';
}> = ({ content, label, variant = 'context' }) => {
  const lines = content.split('\n');

  return (
    <div className={`code-block code-block-${variant}`}>
      {label && <div className="code-block-label">{label}</div>}
      <pre className="code-block-content">
        <code>
          {lines.map((line, index) => (
            <div key={index} className="code-line">
              <span className="line-number">{index + 1}</span>
              <span className="line-content">{line || ' '}</span>
            </div>
          ))}
        </code>
      </pre>
    </div>
  );
};

/**
 * Context lines display
 */
const ContextLines: React.FC<{
  lines: string[];
  position: 'before' | 'after';
}> = ({ lines, position }) => {
  if (lines.length === 0) return null;

  return (
    <div className={`context-lines context-${position}`}>
      {lines.map((line, index) => (
        <div key={index} className="context-line">
          <span className="context-indicator">...</span>
          <span className="context-content">{line || ' '}</span>
        </div>
      ))}
    </div>
  );
};

/**
 * Resolution button
 */
const ResolutionButton: React.FC<{
  strategy: ResolutionStrategy;
  label: string;
  description: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
}> = ({ strategy, label, description, onClick, disabled, variant = 'secondary' }) => (
  <button
    className={`resolution-button resolution-button-${variant}`}
    onClick={onClick}
    disabled={disabled}
    title={description}
    data-strategy={strategy}
  >
    <span className="button-label">{label}</span>
    <span className="button-description">{description}</span>
  </button>
);

/**
 * File navigation sidebar item
 */
const FileNavItem: React.FC<{
  file: ConflictFile;
  isSelected: boolean;
  resolvedCount: number;
  onClick: () => void;
}> = ({ file, isSelected, resolvedCount, onClick }) => {
  const remainingConflicts = file.conflictCount - resolvedCount;
  const isFullyResolved = remainingConflicts === 0;

  return (
    <button
      className={`file-nav-item ${isSelected ? 'selected' : ''} ${isFullyResolved ? 'resolved' : ''}`}
      onClick={onClick}
    >
      <span className="file-icon">
        {isFullyResolved ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M20 6L9 17l-5-5" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14,2 14,8 20,8" />
          </svg>
        )}
      </span>
      <span className="file-name">{file.path}</span>
      <span className="conflict-badge">
        {isFullyResolved ? 'Done' : `${remainingConflicts}/${file.conflictCount}`}
      </span>
    </button>
  );
};

// ============================================================================
// Main Component
// ============================================================================

export const ConflictResolver: React.FC<ConflictResolverProps> = ({
  visible,
  onClose,
  initialFile,
}) => {
  // State
  const [mergeState, setMergeState] = useState<MergeState | null>(null);
  const [conflictFiles, setConflictFiles] = useState<ConflictFile[]>([]);
  const [currentPosition, setCurrentPosition] = useState<NavigationPosition>({
    fileIndex: 0,
    hunkIndex: 0,
  });
  const [resolvedHunks, setResolvedHunks] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [llmSuggestion, setLlmSuggestion] = useState<string | null>(null);
  const [isResolving, setIsResolving] = useState(false);

  // Current file and hunk
  const currentFile = useMemo(
    () => conflictFiles[currentPosition.fileIndex],
    [conflictFiles, currentPosition.fileIndex]
  );

  const currentHunk = useMemo(
    () => currentFile?.hunks[currentPosition.hunkIndex],
    [currentFile, currentPosition.hunkIndex]
  );

  // Total conflicts count
  const totalConflicts = useMemo(
    () => conflictFiles.reduce((sum, file) => sum + file.conflictCount, 0),
    [conflictFiles]
  );

  // Current conflict number (1-indexed for display)
  const currentConflictNumber = useMemo(() => {
    let count = 0;
    for (let i = 0; i < currentPosition.fileIndex; i++) {
      count += conflictFiles[i]?.conflictCount || 0;
    }
    return count + currentPosition.hunkIndex + 1;
  }, [conflictFiles, currentPosition]);

  // Load conflicts from main process
  const loadConflicts = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Call main process to detect conflicts
      const result = await window.atlas?.invoke<{
        success: boolean;
        data?: {
          mergeState: MergeState;
          conflictFiles: ConflictFile[];
          totalConflicts: number;
        };
        error?: string;
      }>('atlas:git-conflict-detect');

      if (result?.success && result.data) {
        setMergeState(result.data.mergeState);
        setConflictFiles(result.data.conflictFiles);

        // Set initial file if specified
        if (initialFile) {
          const fileIndex = result.data.conflictFiles.findIndex((f) => f.path === initialFile);
          if (fileIndex >= 0) {
            setCurrentPosition({ fileIndex, hunkIndex: 0 });
          }
        }
      } else {
        setError(result?.error || 'Failed to detect conflicts');
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, [initialFile]);

  // Load conflicts when visible
  useEffect(() => {
    if (visible) {
      loadConflicts();
    }
  }, [visible, loadConflicts]);

  // Navigate to next conflict
  const goToNext = useCallback(() => {
    if (!currentFile) return;

    if (currentPosition.hunkIndex < currentFile.hunks.length - 1) {
      // Next hunk in same file
      setCurrentPosition((prev) => ({
        ...prev,
        hunkIndex: prev.hunkIndex + 1,
      }));
    } else if (currentPosition.fileIndex < conflictFiles.length - 1) {
      // Next file
      setCurrentPosition({
        fileIndex: currentPosition.fileIndex + 1,
        hunkIndex: 0,
      });
    }
  }, [currentFile, currentPosition, conflictFiles.length]);

  // Navigate to previous conflict
  const goToPrevious = useCallback(() => {
    if (currentPosition.hunkIndex > 0) {
      // Previous hunk in same file
      setCurrentPosition((prev) => ({
        ...prev,
        hunkIndex: prev.hunkIndex - 1,
      }));
    } else if (currentPosition.fileIndex > 0) {
      // Previous file, last hunk
      const prevFileIndex = currentPosition.fileIndex - 1;
      const prevFile = conflictFiles[prevFileIndex];
      setCurrentPosition({
        fileIndex: prevFileIndex,
        hunkIndex: prevFile ? prevFile.hunks.length - 1 : 0,
      });
    }
  }, [currentPosition, conflictFiles]);

  // Select a specific file
  const selectFile = useCallback((fileIndex: number) => {
    setCurrentPosition({ fileIndex, hunkIndex: 0 });
  }, []);

  // Resolve current conflict
  const resolveConflict = useCallback(
    async (strategy: ResolutionStrategy, manualContent?: string) => {
      if (!currentFile || !currentHunk) return;

      setIsResolving(true);
      setError(null);

      try {
        const result = await window.atlas?.invoke<{
          success: boolean;
          data?: {
            remainingConflicts: number;
            staged: boolean;
          };
          error?: string;
        }>('atlas:git-conflict-resolve', {
          file: currentFile.path,
          strategy,
          hunkIndex: currentPosition.hunkIndex,
          manualContent,
        });

        if (result?.success) {
          // Mark hunk as resolved
          setResolvedHunks((prev) => new Set(prev).add(currentHunk.id));

          // Move to next conflict
          goToNext();

          // Reload if all resolved
          if (result.data?.remainingConflicts === 0) {
            await loadConflicts();
          }
        } else {
          setError(result?.error || 'Failed to resolve conflict');
        }
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setIsResolving(false);
      }
    },
    [currentFile, currentHunk, currentPosition.hunkIndex, goToNext, loadConflicts]
  );

  // Accept entire file (reserved for future use)
  // @ts-expect-error Reserved for future implementation
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _acceptFile = useCallback(
    async (accept: 'ours' | 'theirs') => {
      if (!currentFile) return;

      setIsResolving(true);
      setError(null);

      try {
        const result = await window.atlas?.invoke<{
          success: boolean;
          error?: string;
        }>('atlas:git-conflict-accept-file', {
          file: currentFile.path,
          accept,
        });

        if (result?.success) {
          // Mark all hunks in file as resolved
          const newResolved = new Set(resolvedHunks);
          currentFile.hunks.forEach((h) => newResolved.add(h.id));
          setResolvedHunks(newResolved);

          // Move to next file
          if (currentPosition.fileIndex < conflictFiles.length - 1) {
            setCurrentPosition({
              fileIndex: currentPosition.fileIndex + 1,
              hunkIndex: 0,
            });
          }

          await loadConflicts();
        } else {
          setError(result?.error || 'Failed to accept file');
        }
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setIsResolving(false);
      }
    },
    [currentFile, resolvedHunks, currentPosition, conflictFiles.length, loadConflicts]
  );

  // Abort operation
  const abortOperation = useCallback(async () => {
    if (!mergeState) return;

    const confirmed = window.confirm(
      `Are you sure you want to abort the ${mergeState.type}? All conflict resolutions will be lost.`
    );

    if (!confirmed) return;

    setIsResolving(true);
    setError(null);

    try {
      const result = await window.atlas?.invoke<{
        success: boolean;
        error?: string;
      }>('atlas:git-conflict-abort');

      if (result?.success) {
        onClose();
      } else {
        setError(result?.error || 'Failed to abort operation');
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsResolving(false);
    }
  }, [mergeState, onClose]);

  // Continue operation
  const continueOperation = useCallback(async () => {
    setIsResolving(true);
    setError(null);

    try {
      const result = await window.atlas?.invoke<{
        success: boolean;
        error?: string;
      }>('atlas:git-conflict-continue');

      if (result?.success) {
        onClose();
      } else {
        setError(result?.error || 'Failed to continue operation');
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsResolving(false);
    }
  }, [onClose]);

  // Get LLM suggestion
  const getSuggestion = useCallback(async () => {
    if (!currentFile || !currentHunk) return;

    setLlmSuggestion(null);

    try {
      const result = await window.atlas?.invoke<{
        success: boolean;
        data?: {
          analysisPrompt: string;
        };
        error?: string;
      }>('atlas:git-conflict-suggest', {
        file: currentFile.path,
        hunkIndex: currentPosition.hunkIndex,
      });

      if (result?.success && result.data) {
        // Send to LLM for analysis (response comes through normal channels)
        await window.atlas?.atlas.sendText(
          `Analyze this git conflict and suggest a resolution:\n\n${result.data.analysisPrompt}`
        );
        // The response will come through the normal response channels
        setLlmSuggestion('Analyzing conflict...');
      }
    } catch (err) {
      setError((err as Error).message);
    }
  }, [currentFile, currentHunk, currentPosition.hunkIndex]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!visible) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if in input field
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
        case 'ArrowRight':
        case 'j':
          e.preventDefault();
          goToNext();
          break;
        case 'ArrowLeft':
        case 'k':
          e.preventDefault();
          goToPrevious();
          break;
        case '1':
          e.preventDefault();
          resolveConflict('ours');
          break;
        case '2':
          e.preventDefault();
          resolveConflict('theirs');
          break;
        case '3':
          e.preventDefault();
          resolveConflict('both');
          break;
        case 's':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            getSuggestion();
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [visible, onClose, goToNext, goToPrevious, resolveConflict, getSuggestion]);

  // Listen for voice commands
  useEffect(() => {
    if (!visible) return;

    const handleVoiceCommand = (event: { command: string; args?: string[] }) => {
      const { command, args } = event;

      switch (command.toLowerCase()) {
        case 'show conflicts':
          loadConflicts();
          break;
        case 'accept theirs':
          resolveConflict('theirs');
          break;
        case 'accept ours':
          resolveConflict('ours');
          break;
        case 'accept both':
          resolveConflict('both');
          break;
        case 'next conflict':
          goToNext();
          break;
        case 'previous conflict':
          goToPrevious();
          break;
        case 'suggest resolution':
          getSuggestion();
          break;
        case 'abort merge':
        case 'abort rebase':
          abortOperation();
          break;
        case 'continue merge':
        case 'continue rebase':
          continueOperation();
          break;
        case 'go to file':
          if (args && args[0]) {
            const fileIndex = conflictFiles.findIndex((f) =>
              f.path.toLowerCase().includes(args[0].toLowerCase())
            );
            if (fileIndex >= 0) {
              selectFile(fileIndex);
            }
          }
          break;
      }
    };

    // Subscribe to voice command events
    const unsubscribe = window.atlas?.on(
      'atlas:voice-command',
      handleVoiceCommand as (...args: unknown[]) => void
    );

    return () => {
      unsubscribe?.();
    };
  }, [
    visible,
    loadConflicts,
    resolveConflict,
    goToNext,
    goToPrevious,
    getSuggestion,
    abortOperation,
    continueOperation,
    conflictFiles,
    selectFile,
  ]);

  if (!visible) return null;

  // Calculate resolved count per file
  const getResolvedCount = (file: ConflictFile): number => {
    return file.hunks.filter((h) => resolvedHunks.has(h.id)).length;
  };

  // Check if all conflicts are resolved
  const allResolved = conflictFiles.every((f) => getResolvedCount(f) === f.conflictCount);

  return (
    <div className="conflict-resolver-overlay" onClick={onClose}>
      <div className="conflict-resolver-panel" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="conflict-resolver-header">
          <div className="header-info">
            <h2 className="header-title">
              {mergeState?.type === 'none'
                ? 'No Conflicts'
                : `Resolve ${mergeState?.type || 'merge'} conflicts`}
            </h2>
            {mergeState && mergeState.type !== 'none' && (
              <div className="header-subtitle">
                <span className="branch-info">
                  {mergeState.currentBranch}
                  <span className="branch-arrow"> ← </span>
                  {mergeState.incomingRef}
                </span>
                {mergeState.currentStep && mergeState.totalSteps && (
                  <span className="step-info">
                    (Step {mergeState.currentStep}/{mergeState.totalSteps})
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="header-actions">
            <span className="conflict-counter">
              {currentConflictNumber} / {totalConflicts}
            </span>
            <button
              className="header-button"
              onClick={onClose}
              aria-label="Close"
              title="Close (Esc)"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Main content */}
        <div className="conflict-resolver-content">
          {/* File sidebar */}
          <div className="file-sidebar">
            <div className="sidebar-header">
              <h3>Conflicting Files</h3>
              <span className="file-count">{conflictFiles.length}</span>
            </div>
            <div className="file-list">
              {conflictFiles.map((file, index) => (
                <FileNavItem
                  key={file.path}
                  file={file}
                  isSelected={index === currentPosition.fileIndex}
                  resolvedCount={getResolvedCount(file)}
                  onClick={() => selectFile(index)}
                />
              ))}
            </div>
          </div>

          {/* Conflict view */}
          <div className="conflict-view">
            {isLoading ? (
              <div className="loading-state">
                <div className="loading-spinner" />
                <p>Detecting conflicts...</p>
              </div>
            ) : error ? (
              <div className="error-state">
                <p className="error-message">{error}</p>
                <button className="retry-button" onClick={loadConflicts}>
                  Retry
                </button>
              </div>
            ) : !currentHunk ? (
              <div className="empty-state">
                {allResolved ? (
                  <>
                    <div className="success-icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                    </div>
                    <h3>All Conflicts Resolved!</h3>
                    <p>You can now continue the {mergeState?.type} operation.</p>
                    <button className="continue-button" onClick={continueOperation}>
                      Continue {mergeState?.type}
                    </button>
                  </>
                ) : (
                  <>
                    <p>No conflicts to display</p>
                    <button className="refresh-button" onClick={loadConflicts}>
                      Refresh
                    </button>
                  </>
                )}
              </div>
            ) : (
              <>
                {/* Conflict header */}
                <div className="conflict-header">
                  <div className="conflict-info">
                    <span className="conflict-file">{currentFile?.path}</span>
                    <span className="conflict-location">
                      Lines {currentHunk.startLine}-{currentHunk.endLine}
                    </span>
                  </div>
                  <div className="conflict-nav">
                    <button
                      className="nav-button"
                      onClick={goToPrevious}
                      disabled={currentConflictNumber <= 1}
                      title="Previous conflict (k or Left Arrow)"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M15 18l-6-6 6-6" />
                      </svg>
                    </button>
                    <button
                      className="nav-button"
                      onClick={goToNext}
                      disabled={currentConflictNumber >= totalConflicts}
                      title="Next conflict (j or Right Arrow)"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M9 18l6-6-6-6" />
                      </svg>
                    </button>
                  </div>
                </div>

                {/* Conflict display */}
                <div className="conflict-display">
                  <ContextLines lines={currentHunk.contextBefore} position="before" />

                  <div className="conflict-sections">
                    <div className="conflict-section conflict-ours">
                      <div className="section-header">
                        <span className="section-label">Ours</span>
                        <span className="branch-name">{currentHunk.oursBranch}</span>
                      </div>
                      <CodeBlock
                        content={currentHunk.oursContent}
                        variant="ours"
                        language={currentFile?.fileType}
                      />
                    </div>

                    {currentHunk.baseContent && (
                      <div className="conflict-section conflict-base">
                        <div className="section-header">
                          <span className="section-label">Base</span>
                        </div>
                        <CodeBlock
                          content={currentHunk.baseContent}
                          variant="base"
                          language={currentFile?.fileType}
                        />
                      </div>
                    )}

                    <div className="conflict-section conflict-theirs">
                      <div className="section-header">
                        <span className="section-label">Theirs</span>
                        <span className="branch-name">{currentHunk.theirsBranch}</span>
                      </div>
                      <CodeBlock
                        content={currentHunk.theirsContent}
                        variant="theirs"
                        language={currentFile?.fileType}
                      />
                    </div>
                  </div>

                  <ContextLines lines={currentHunk.contextAfter} position="after" />
                </div>

                {/* LLM Suggestion */}
                {llmSuggestion && (
                  <div className="llm-suggestion">
                    <div className="suggestion-header">
                      <span>AI Suggestion</span>
                      <button className="dismiss-button" onClick={() => setLlmSuggestion(null)}>
                        Dismiss
                      </button>
                    </div>
                    <div className="suggestion-content">{llmSuggestion}</div>
                  </div>
                )}

                {/* Resolution actions */}
                <div className="resolution-actions">
                  <div className="action-group primary-actions">
                    <ResolutionButton
                      strategy="ours"
                      label="Accept Ours"
                      description="Keep our version (1)"
                      onClick={() => resolveConflict('ours')}
                      disabled={isResolving}
                      variant="primary"
                    />
                    <ResolutionButton
                      strategy="theirs"
                      label="Accept Theirs"
                      description="Use incoming version (2)"
                      onClick={() => resolveConflict('theirs')}
                      disabled={isResolving}
                      variant="secondary"
                    />
                    <ResolutionButton
                      strategy="both"
                      label="Accept Both"
                      description="Keep both versions (3)"
                      onClick={() => resolveConflict('both')}
                      disabled={isResolving}
                    />
                  </div>

                  <div className="action-group secondary-actions">
                    <button
                      className="action-button suggest-button"
                      onClick={getSuggestion}
                      disabled={isResolving}
                      title="Get AI suggestion (Ctrl+S)"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" />
                        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                        <line x1="12" y1="17" x2="12.01" y2="17" />
                      </svg>
                      Suggest
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="conflict-resolver-footer">
          <div className="footer-actions left">
            <button
              className="footer-button danger"
              onClick={abortOperation}
              disabled={isResolving || !mergeState || mergeState.type === 'none'}
            >
              Abort {mergeState?.type}
            </button>
          </div>

          <div className="footer-info">
            <p className="keyboard-hints">
              <kbd>1</kbd> Ours <kbd>2</kbd> Theirs <kbd>3</kbd> Both <kbd>j/k</kbd> Navigate{' '}
              <kbd>Esc</kbd> Close
            </p>
          </div>

          <div className="footer-actions right">
            {allResolved && (
              <button
                className="footer-button primary"
                onClick={continueOperation}
                disabled={isResolving}
              >
                Continue {mergeState?.type}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConflictResolver;
