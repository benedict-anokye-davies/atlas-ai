/**
 * Operation History Panel
 *
 * Shows recent operations with rollback capabilities.
 * Allows users to undo dangerous operations.
 *
 * Features:
 * 1. Timeline of operations with timestamps
 * 2. Operation details and affected files
 * 3. One-click rollback for supported operations
 * 4. Git rollback for committed changes
 * 5. Snapshot-based rollback for file changes
 */

import React, { useState, useEffect, useCallback } from 'react';

// =============================================================================
// Types
// =============================================================================

interface Operation {
  id: string;
  type: 'file_write' | 'file_delete' | 'git_commit' | 'git_push' | 'command' | 'browser' | 'trading' | 'other';
  description: string;
  timestamp: number;
  status: 'completed' | 'failed' | 'rolled_back';
  canRollback: boolean;
  details?: {
    files?: string[];
    command?: string;
    gitHash?: string;
    error?: string;
  };
  snapshotId?: string;
}

interface OperationHistoryProps {
  maxItems?: number;
  showRollbackConfirm?: boolean;
  onRollback?: (operationId: string) => Promise<boolean>;
}

// =============================================================================
// Styles
// =============================================================================

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100%',
    backgroundColor: '#1e1e1e',
    color: '#ffffff',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 16px',
    borderBottom: '1px solid #333',
    backgroundColor: '#252526',
  },
  title: {
    fontSize: '14px',
    fontWeight: 600,
    color: '#ffffff',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  badge: {
    fontSize: '11px',
    backgroundColor: '#0d6efd',
    color: '#ffffff',
    padding: '2px 8px',
    borderRadius: '10px',
    fontWeight: 500,
  },
  controls: {
    display: 'flex',
    gap: '8px',
  },
  button: {
    background: 'transparent',
    border: '1px solid #555',
    color: '#ccc',
    padding: '4px 12px',
    borderRadius: '4px',
    fontSize: '12px',
    cursor: 'pointer',
    transition: 'all 0.15s',
  },
  buttonHover: {
    borderColor: '#888',
    color: '#fff',
  },
  list: {
    flex: 1,
    overflow: 'auto',
    padding: '8px',
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    padding: '48px 16px',
    color: '#888',
    textAlign: 'center' as const,
  },
  emptyIcon: {
    fontSize: '48px',
    marginBottom: '16px',
    opacity: 0.5,
  },
  item: {
    display: 'flex',
    flexDirection: 'column' as const,
    padding: '12px',
    marginBottom: '8px',
    backgroundColor: '#2d2d2d',
    borderRadius: '6px',
    border: '1px solid #3d3d3d',
    cursor: 'pointer',
    transition: 'all 0.15s',
  },
  itemHover: {
    backgroundColor: '#353535',
    borderColor: '#4d4d4d',
  },
  itemExpanded: {
    backgroundColor: '#353535',
    borderColor: '#0d6efd',
  },
  itemHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  typeIcon: {
    width: '32px',
    height: '32px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '6px',
    fontSize: '16px',
  },
  itemContent: {
    flex: 1,
    minWidth: 0,
  },
  itemDescription: {
    fontSize: '13px',
    fontWeight: 500,
    color: '#ffffff',
    marginBottom: '4px',
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  itemMeta: {
    fontSize: '11px',
    color: '#888',
    display: 'flex',
    gap: '12px',
  },
  statusBadge: {
    fontSize: '10px',
    padding: '2px 6px',
    borderRadius: '4px',
    fontWeight: 500,
    textTransform: 'uppercase' as const,
  },
  details: {
    marginTop: '12px',
    paddingTop: '12px',
    borderTop: '1px solid #3d3d3d',
  },
  detailSection: {
    marginBottom: '8px',
  },
  detailLabel: {
    fontSize: '11px',
    color: '#888',
    marginBottom: '4px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  },
  detailValue: {
    fontSize: '12px',
    color: '#ccc',
    fontFamily: 'monospace',
  },
  fileList: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '4px',
  },
  fileItem: {
    fontSize: '11px',
    color: '#ccc',
    fontFamily: 'monospace',
    padding: '4px 8px',
    backgroundColor: '#252526',
    borderRadius: '4px',
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  rollbackButton: {
    marginTop: '12px',
    padding: '8px 16px',
    backgroundColor: '#dc3545',
    color: '#ffffff',
    border: 'none',
    borderRadius: '4px',
    fontSize: '12px',
    fontWeight: 500,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    transition: 'all 0.15s',
  },
  rollbackButtonDisabled: {
    backgroundColor: '#555',
    cursor: 'not-allowed',
    opacity: 0.6,
  },
  confirmDialog: {
    position: 'fixed' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  dialogContent: {
    backgroundColor: '#2d2d2d',
    borderRadius: '8px',
    padding: '24px',
    maxWidth: '400px',
    width: '90%',
    boxShadow: '0 4px 24px rgba(0, 0, 0, 0.5)',
  },
  dialogTitle: {
    fontSize: '16px',
    fontWeight: 600,
    marginBottom: '12px',
    color: '#dc3545',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  dialogText: {
    fontSize: '13px',
    color: '#ccc',
    marginBottom: '20px',
    lineHeight: 1.5,
  },
  dialogButtons: {
    display: 'flex',
    gap: '8px',
    justifyContent: 'flex-end',
  },
  dialogButton: {
    padding: '8px 16px',
    borderRadius: '4px',
    fontSize: '13px',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.15s',
  },
};

// =============================================================================
// Helper Functions
// =============================================================================

const getTypeIcon = (type: Operation['type']): { icon: string; color: string } => {
  const icons: Record<Operation['type'], { icon: string; color: string }> = {
    file_write: { icon: '📝', color: '#28a745' },
    file_delete: { icon: '🗑️', color: '#dc3545' },
    git_commit: { icon: '📦', color: '#6f42c1' },
    git_push: { icon: '🚀', color: '#0d6efd' },
    command: { icon: '⚡', color: '#fd7e14' },
    browser: { icon: '🌐', color: '#17a2b8' },
    trading: { icon: '📈', color: '#20c997' },
    other: { icon: '⚙️', color: '#6c757d' },
  };
  return icons[type] || icons.other;
};

const getStatusStyle = (status: Operation['status']): React.CSSProperties => {
  const statusStyles: Record<Operation['status'], React.CSSProperties> = {
    completed: { backgroundColor: '#28a745', color: '#ffffff' },
    failed: { backgroundColor: '#dc3545', color: '#ffffff' },
    rolled_back: { backgroundColor: '#fd7e14', color: '#ffffff' },
  };
  return statusStyles[status];
};

const formatTime = (timestamp: number): string => {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - timestamp;

  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;

  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
};

// =============================================================================
// Mock Data (for development)
// =============================================================================

const mockOperations: Operation[] = [
  {
    id: '1',
    type: 'file_write',
    description: 'Modified src/main/voice/voice-pipeline.ts',
    timestamp: Date.now() - 300000,
    status: 'completed',
    canRollback: true,
    details: { files: ['src/main/voice/voice-pipeline.ts'] },
    snapshotId: 'snap_001',
  },
  {
    id: '2',
    type: 'git_commit',
    description: 'Committed: feat(voice): add LLM pre-warming',
    timestamp: Date.now() - 600000,
    status: 'completed',
    canRollback: true,
    details: {
      gitHash: 'a1b2c3d',
      files: ['src/main/voice/voice-pipeline.ts', 'src/main/llm/manager.ts'],
    },
  },
  {
    id: '3',
    type: 'command',
    description: 'Executed: npm run build',
    timestamp: Date.now() - 900000,
    status: 'completed',
    canRollback: false,
    details: { command: 'npm run build' },
  },
  {
    id: '4',
    type: 'file_delete',
    description: 'Deleted old-config.json',
    timestamp: Date.now() - 1200000,
    status: 'rolled_back',
    canRollback: false,
    details: { files: ['old-config.json'] },
  },
  {
    id: '5',
    type: 'trading',
    description: 'Opened position: Long ETH @ $3,450',
    timestamp: Date.now() - 1800000,
    status: 'completed',
    canRollback: false,
    details: {},
  },
];

// =============================================================================
// Component
// =============================================================================

const OperationHistoryPanel: React.FC<OperationHistoryProps> = ({
  maxItems = 50,
  showRollbackConfirm = true,
  onRollback,
}) => {
  const [operations, setOperations] = useState<Operation[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [confirmRollback, setConfirmRollback] = useState<Operation | null>(null);
  const [isRollingBack, setIsRollingBack] = useState(false);
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);
  const [hoveredButton, setHoveredButton] = useState<string | null>(null);

  // Load operations
  useEffect(() => {
    const loadOperations = async () => {
      try {
        // Try to load from IPC if available
        const atlasAny = window.atlas as unknown as Record<string, unknown>;
        if (atlasAny?.security && typeof atlasAny.security === 'object') {
          const securityApi = atlasAny.security as { 
            getOperationHistory?: () => Promise<{ success: boolean; data?: Operation[] }> 
          };
          const result = await securityApi.getOperationHistory?.();
          if (result?.success && result.data) {
            setOperations(result.data.slice(0, maxItems));
            return;
          }
        }
      } catch {
        // Ignore errors
      }

      // Use mock data in development
      setOperations(mockOperations);
    };

    loadOperations();
    const interval = setInterval(loadOperations, 5000);
    return () => clearInterval(interval);
  }, [maxItems]);

  // Handle rollback
  const handleRollback = useCallback(async (operation: Operation) => {
    if (showRollbackConfirm) {
      setConfirmRollback(operation);
      return;
    }

    await executeRollback(operation);
  }, [showRollbackConfirm]);

  const executeRollback = async (operation: Operation) => {
    setIsRollingBack(true);
    setConfirmRollback(null);

    try {
      if (onRollback) {
        const success = await onRollback(operation.id);
        if (success) {
          setOperations(ops =>
            ops.map(op =>
              op.id === operation.id
                ? { ...op, status: 'rolled_back', canRollback: false }
                : op
            )
          );
        }
      } else {
        // Try IPC rollback
        const atlasAny = window.atlas as unknown as Record<string, unknown>;
        if (atlasAny?.security && typeof atlasAny.security === 'object') {
          const securityApi = atlasAny.security as {
            rollbackOperation?: (id: string) => Promise<{ success: boolean }>;
          };
          const result = await securityApi.rollbackOperation?.(operation.id);
          if (result?.success) {
            setOperations(ops =>
              ops.map(op =>
                op.id === operation.id
                  ? { ...op, status: 'rolled_back', canRollback: false }
                  : op
              )
            );
          }
        }
      }
    } catch (error) {
      console.error('Rollback failed:', error);
    }

    setIsRollingBack(false);
  };

  // Clear history
  const handleClearHistory = () => {
    setOperations([]);
  };

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.title}>
          <span>🕐</span>
          Operation History
          {operations.length > 0 && (
            <span style={styles.badge}>{operations.length}</span>
          )}
        </div>
        <div style={styles.controls}>
          <button
            style={{
              ...styles.button,
              ...(hoveredButton === 'clear' ? styles.buttonHover : {}),
            }}
            onMouseEnter={() => setHoveredButton('clear')}
            onMouseLeave={() => setHoveredButton(null)}
            onClick={handleClearHistory}
          >
            Clear
          </button>
        </div>
      </div>

      {/* List */}
      <div style={styles.list}>
        {operations.length === 0 ? (
          <div style={styles.emptyState}>
            <div style={styles.emptyIcon}>📋</div>
            <div>No operations recorded yet</div>
            <div style={{ fontSize: '12px', marginTop: '8px' }}>
              Operations will appear here as you work
            </div>
          </div>
        ) : (
          operations.map((operation) => {
            const typeInfo = getTypeIcon(operation.type);
            const isExpanded = expandedId === operation.id;
            const isHovered = hoveredItem === operation.id;

            return (
              <div
                key={operation.id}
                style={{
                  ...styles.item,
                  ...(isHovered && !isExpanded ? styles.itemHover : {}),
                  ...(isExpanded ? styles.itemExpanded : {}),
                }}
                onClick={() => setExpandedId(isExpanded ? null : operation.id)}
                onMouseEnter={() => setHoveredItem(operation.id)}
                onMouseLeave={() => setHoveredItem(null)}
              >
                {/* Header */}
                <div style={styles.itemHeader}>
                  <div
                    style={{
                      ...styles.typeIcon,
                      backgroundColor: `${typeInfo.color}20`,
                    }}
                  >
                    {typeInfo.icon}
                  </div>
                  <div style={styles.itemContent}>
                    <div style={styles.itemDescription}>
                      {operation.description}
                    </div>
                    <div style={styles.itemMeta}>
                      <span>{formatTime(operation.timestamp)}</span>
                      <span
                        style={{
                          ...styles.statusBadge,
                          ...getStatusStyle(operation.status),
                        }}
                      >
                        {operation.status}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Expanded Details */}
                {isExpanded && (
                  <div style={styles.details}>
                    {operation.details?.files && operation.details.files.length > 0 && (
                      <div style={styles.detailSection}>
                        <div style={styles.detailLabel}>Files Affected</div>
                        <div style={styles.fileList}>
                          {operation.details.files.map((file, i) => (
                            <div key={i} style={styles.fileItem}>
                              {file}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {operation.details?.command && (
                      <div style={styles.detailSection}>
                        <div style={styles.detailLabel}>Command</div>
                        <div style={styles.detailValue}>
                          {operation.details.command}
                        </div>
                      </div>
                    )}

                    {operation.details?.gitHash && (
                      <div style={styles.detailSection}>
                        <div style={styles.detailLabel}>Commit Hash</div>
                        <div style={styles.detailValue}>
                          {operation.details.gitHash}
                        </div>
                      </div>
                    )}

                    {operation.canRollback && operation.status === 'completed' && (
                      <button
                        style={{
                          ...styles.rollbackButton,
                          ...(isRollingBack ? styles.rollbackButtonDisabled : {}),
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRollback(operation);
                        }}
                        disabled={isRollingBack}
                      >
                        ↩️ Rollback This Operation
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Confirmation Dialog */}
      {confirmRollback && (
        <div style={styles.confirmDialog}>
          <div style={styles.dialogContent}>
            <div style={styles.dialogTitle}>
              ⚠️ Confirm Rollback
            </div>
            <div style={styles.dialogText}>
              Are you sure you want to rollback this operation?
              <br /><br />
              <strong>{confirmRollback.description}</strong>
              <br /><br />
              This action will attempt to undo the changes made by this operation.
            </div>
            <div style={styles.dialogButtons}>
              <button
                style={{
                  ...styles.dialogButton,
                  backgroundColor: 'transparent',
                  border: '1px solid #555',
                  color: '#ccc',
                }}
                onClick={() => setConfirmRollback(null)}
              >
                Cancel
              </button>
              <button
                style={{
                  ...styles.dialogButton,
                  backgroundColor: '#dc3545',
                  border: 'none',
                  color: '#ffffff',
                }}
                onClick={() => executeRollback(confirmRollback)}
              >
                Yes, Rollback
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default OperationHistoryPanel;
