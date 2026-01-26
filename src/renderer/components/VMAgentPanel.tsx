/**
 * Atlas Desktop - VM Agent Control Panel
 *
 * React component for controlling the VM Agent from the UI.
 * Provides:
 * - Connection management
 * - Live screen view
 * - Task execution
 * - Recording controls
 * - Workflow management
 * - Visual feedback
 *
 * @module renderer/components/VMAgentPanel
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';

// =============================================================================
// Types
// =============================================================================

interface VMStatus {
  connected: boolean;
  vmName?: string;
  protocol?: string;
  state: 'idle' | 'connecting' | 'connected' | 'executing' | 'recording' | 'error';
  currentTask?: string;
  error?: string;
}

interface Screenshot {
  data: string; // Base64
  timestamp: number;
}

interface Recording {
  id: string;
  name: string;
  description?: string;
  stepCount: number;
  createdAt: number;
}

interface Workflow {
  id: string;
  name: string;
  description?: string;
  stepCount: number;
}

interface Prediction {
  id: string;
  action: string;
  confidence: number;
  description: string;
}

// =============================================================================
// Styles
// =============================================================================

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    backgroundColor: '#1a1a2e',
    color: '#e0e0e0',
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 16px',
    borderBottom: '1px solid #2a2a4a',
    backgroundColor: '#16162a',
  },
  title: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '16px',
    fontWeight: 600,
  },
  statusBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '4px 10px',
    borderRadius: '12px',
    fontSize: '12px',
    fontWeight: 500,
  },
  statusDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
  },
  content: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
  },
  mainPanel: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  screenView: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0a0a1a',
    overflow: 'hidden',
    position: 'relative',
  },
  screenshot: {
    maxWidth: '100%',
    maxHeight: '100%',
    objectFit: 'contain',
    borderRadius: '4px',
  },
  placeholder: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '16px',
    color: '#666',
  },
  controlBar: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '12px 16px',
    borderTop: '1px solid #2a2a4a',
    backgroundColor: '#16162a',
  },
  sidebar: {
    width: '280px',
    borderLeft: '1px solid #2a2a4a',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  sidebarSection: {
    borderBottom: '1px solid #2a2a4a',
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 12px',
    backgroundColor: '#1e1e3a',
    cursor: 'pointer',
    userSelect: 'none',
  },
  sectionTitle: {
    fontSize: '12px',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    color: '#888',
  },
  sectionContent: {
    padding: '8px 12px',
    maxHeight: '200px',
    overflowY: 'auto',
  },
  button: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    padding: '8px 16px',
    borderRadius: '6px',
    border: 'none',
    fontSize: '13px',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },
  primaryButton: {
    backgroundColor: '#6366f1',
    color: 'white',
  },
  secondaryButton: {
    backgroundColor: '#2a2a4a',
    color: '#e0e0e0',
  },
  dangerButton: {
    backgroundColor: '#ef4444',
    color: 'white',
  },
  iconButton: {
    padding: '8px',
    borderRadius: '6px',
    backgroundColor: 'transparent',
    border: '1px solid #3a3a5a',
    color: '#888',
    cursor: 'pointer',
  },
  input: {
    flex: 1,
    padding: '10px 12px',
    borderRadius: '6px',
    border: '1px solid #3a3a5a',
    backgroundColor: '#1a1a2e',
    color: '#e0e0e0',
    fontSize: '14px',
    outline: 'none',
  },
  listItem: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px',
    borderRadius: '4px',
    marginBottom: '4px',
    backgroundColor: '#1e1e3a',
    cursor: 'pointer',
    transition: 'background-color 0.15s ease',
  },
  predictionItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px',
    borderRadius: '4px',
    marginBottom: '4px',
    backgroundColor: '#1e1e3a',
    cursor: 'pointer',
  },
  confidenceBar: {
    height: '4px',
    borderRadius: '2px',
    backgroundColor: '#2a2a4a',
    overflow: 'hidden',
  },
  confidenceFill: {
    height: '100%',
    borderRadius: '2px',
    transition: 'width 0.3s ease',
  },
  modal: {
    position: 'fixed',
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
  modalContent: {
    backgroundColor: '#1a1a2e',
    borderRadius: '12px',
    padding: '24px',
    width: '400px',
    maxWidth: '90%',
  },
  modalTitle: {
    fontSize: '18px',
    fontWeight: 600,
    marginBottom: '16px',
  },
  formGroup: {
    marginBottom: '16px',
  },
  label: {
    display: 'block',
    fontSize: '12px',
    fontWeight: 500,
    color: '#888',
    marginBottom: '6px',
  },
  select: {
    width: '100%',
    padding: '10px 12px',
    borderRadius: '6px',
    border: '1px solid #3a3a5a',
    backgroundColor: '#1a1a2e',
    color: '#e0e0e0',
    fontSize: '14px',
    outline: 'none',
  },
};

// =============================================================================
// Icons (inline SVG components)
// =============================================================================

const IconMonitor: React.FC<{ size?: number }> = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="2" y="3" width="20" height="14" rx="2" />
    <line x1="8" y1="21" x2="16" y2="21" />
    <line x1="12" y1="17" x2="12" y2="21" />
  </svg>
);

const IconPlay: React.FC<{ size?: number }> = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <polygon points="5,3 19,12 5,21" />
  </svg>
);

const IconPause: React.FC<{ size?: number }> = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <rect x="6" y="4" width="4" height="16" />
    <rect x="14" y="4" width="4" height="16" />
  </svg>
);

const IconStop: React.FC<{ size?: number }> = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <rect x="4" y="4" width="16" height="16" rx="2" />
  </svg>
);

const IconRecord: React.FC<{ size?: number }> = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="#ef4444">
    <circle cx="12" cy="12" r="8" />
  </svg>
);

const IconCamera: React.FC<{ size?: number }> = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
    <circle cx="12" cy="13" r="4" />
  </svg>
);

const IconRefresh: React.FC<{ size?: number }> = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="23,4 23,10 17,10" />
    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
  </svg>
);

const IconChevronDown: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const IconChevronRight: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

const IconSend: React.FC<{ size?: number }> = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="22" y1="2" x2="11" y2="13" />
    <polygon points="22,2 15,22 11,13 2,9" />
  </svg>
);

// =============================================================================
// Sub-Components
// =============================================================================

interface ConnectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConnect: (config: { type: string; host: string; port: number; vmName?: string }) => void;
}

const ConnectionModal: React.FC<ConnectionModalProps> = ({ isOpen, onClose, onConnect }) => {
  const [type, setType] = useState('vnc');
  const [host, setHost] = useState('localhost');
  const [port, setPort] = useState(5900);
  const [vmName, setVmName] = useState('');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onConnect({ type, host, port, vmName: vmName || undefined });
  };

  return (
    <div style={styles.modal} onClick={onClose}>
      <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
        <h2 style={styles.modalTitle}>Connect to VM</h2>
        <form onSubmit={handleSubmit}>
          <div style={styles.formGroup}>
            <label style={styles.label}>Connection Type</label>
            <select style={styles.select} value={type} onChange={(e) => setType(e.target.value)}>
              <option value="vnc">VNC</option>
              <option value="hyperv">Hyper-V</option>
              <option value="virtualbox">VirtualBox</option>
              <option value="vmware">VMware</option>
            </select>
          </div>

          {type === 'vnc' && (
            <>
              <div style={styles.formGroup}>
                <label style={styles.label}>Host</label>
                <input
                  style={{ ...styles.input, width: '100%', boxSizing: 'border-box' }}
                  type="text"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  placeholder="localhost"
                />
              </div>
              <div style={styles.formGroup}>
                <label style={styles.label}>Port</label>
                <input
                  style={{ ...styles.input, width: '100%', boxSizing: 'border-box' }}
                  type="number"
                  value={port}
                  onChange={(e) => setPort(parseInt(e.target.value))}
                  placeholder="5900"
                />
              </div>
            </>
          )}

          {(type === 'hyperv' || type === 'virtualbox' || type === 'vmware') && (
            <div style={styles.formGroup}>
              <label style={styles.label}>VM Name</label>
              <input
                style={{ ...styles.input, width: '100%', boxSizing: 'border-box' }}
                type="text"
                value={vmName}
                onChange={(e) => setVmName(e.target.value)}
                placeholder="Enter VM name"
              />
            </div>
          )}

          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '20px' }}>
            <button
              type="button"
              style={{ ...styles.button, ...styles.secondaryButton }}
              onClick={onClose}
            >
              Cancel
            </button>
            <button type="submit" style={{ ...styles.button, ...styles.primaryButton }}>
              Connect
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

interface RecordingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStart: (name: string, description: string) => void;
}

const RecordingModal: React.FC<RecordingModalProps> = ({ isOpen, onClose, onStart }) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) {
      onStart(name.trim(), description.trim());
    }
  };

  return (
    <div style={styles.modal} onClick={onClose}>
      <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
        <h2 style={styles.modalTitle}>Start Recording</h2>
        <form onSubmit={handleSubmit}>
          <div style={styles.formGroup}>
            <label style={styles.label}>Recording Name</label>
            <input
              style={{ ...styles.input, width: '100%', boxSizing: 'border-box' }}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Open Excel and create report"
              autoFocus
            />
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Description (optional)</label>
            <textarea
              style={{
                ...styles.input,
                width: '100%',
                boxSizing: 'border-box',
                minHeight: '80px',
                resize: 'vertical',
              }}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what this recording does..."
            />
          </div>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '20px' }}>
            <button
              type="button"
              style={{ ...styles.button, ...styles.secondaryButton }}
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              style={{ ...styles.button, ...styles.primaryButton }}
              disabled={!name.trim()}
            >
              Start Recording
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// =============================================================================
// Main Component
// =============================================================================

export const VMAgentPanel: React.FC = () => {
  // State
  const [status, setStatus] = useState<VMStatus>({
    connected: false,
    state: 'idle',
  });
  const [screenshot, setScreenshot] = useState<Screenshot | null>(null);
  const [taskInput, setTaskInput] = useState('');
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(['predictions', 'recordings']),
  );

  // Modals
  const [showConnectionModal, setShowConnectionModal] = useState(false);
  const [showRecordingModal, setShowRecordingModal] = useState(false);

  // Refs
  const screenshotIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // IPC helpers
  const invoke = useCallback(async (channel: string, ...args: unknown[]) => {
    const atlas = (window as unknown as { atlas?: { ipcRenderer?: { invoke: (channel: string, ...args: unknown[]) => Promise<unknown> } } }).atlas;
    if (atlas?.ipcRenderer?.invoke) {
      return atlas.ipcRenderer.invoke(channel, ...args);
    }
    console.warn('IPC not available');
    return null;
  }, []);

  // Load initial data
  useEffect(() => {
    const loadData = async () => {
      try {
        const [statusRes, recordingsRes, workflowsRes, predictionsRes] = await Promise.all([
          invoke('vm-agent:get-status'),
          invoke('vm-agent:list-recordings'),
          invoke('vm-agent:list-workflows'),
          invoke('vm-agent:predictions:get'),
        ]);

        if ((statusRes as { success: boolean; data?: VMStatus })?.success) {
          setStatus((statusRes as { success: boolean; data: VMStatus }).data);
        }
        if ((recordingsRes as { success: boolean; data?: Recording[] })?.success) {
          setRecordings((recordingsRes as { success: boolean; data: Recording[] }).data);
        }
        if ((workflowsRes as { success: boolean; data?: Workflow[] })?.success) {
          setWorkflows((workflowsRes as { success: boolean; data: Workflow[] }).data);
        }
        if ((predictionsRes as { success: boolean; data?: Prediction[] })?.success) {
          setPredictions((predictionsRes as { success: boolean; data: Prediction[] }).data);
        }
      } catch (error) {
        console.error('Failed to load VM agent data:', error);
      }
    };

    loadData();
  }, [invoke]);

  // Screenshot refresh when connected
  useEffect(() => {
    if (status.connected) {
      const refreshScreenshot = async () => {
        try {
          const res = await invoke('vm-agent:screenshot');
          if ((res as { success: boolean; data?: { screenshot: string; timestamp: number } })?.success) {
            const data = (res as { success: boolean; data: { screenshot: string; timestamp: number } }).data;
            setScreenshot({
              data: data.screenshot,
              timestamp: data.timestamp,
            });
          }
        } catch (error) {
          console.error('Screenshot failed:', error);
        }
      };

      refreshScreenshot();
      screenshotIntervalRef.current = setInterval(refreshScreenshot, 2000);

      return () => {
        if (screenshotIntervalRef.current) {
          clearInterval(screenshotIntervalRef.current);
        }
      };
    }
    return undefined;
  }, [status.connected, invoke]);

  // Handlers
  const handleConnect = async (config: {
    type: string;
    host: string;
    port: number;
    vmName?: string;
  }) => {
    setStatus((s) => ({ ...s, state: 'connecting' }));
    setShowConnectionModal(false);

    try {
      const res = await invoke('vm-agent:connect', config);
      if ((res as { success: boolean })?.success) {
        setStatus((s) => ({
          ...s,
          connected: true,
          state: 'connected',
          vmName: config.vmName || `${config.host}:${config.port}`,
          protocol: config.type,
        }));
      } else {
        setStatus((s) => ({
          ...s,
          state: 'error',
          error: (res as { error?: string })?.error || 'Connection failed',
        }));
      }
    } catch (error) {
      setStatus((s) => ({
        ...s,
        state: 'error',
        error: error instanceof Error ? error.message : 'Connection failed',
      }));
    }
  };

  const handleDisconnect = async () => {
    try {
      await invoke('vm-agent:disconnect');
      setStatus({
        connected: false,
        state: 'idle',
      });
      setScreenshot(null);
    } catch (error) {
      console.error('Disconnect failed:', error);
    }
  };

  const handleExecuteTask = async () => {
    if (!taskInput.trim() || !status.connected) return;

    const task = taskInput.trim();
    setTaskInput('');
    setStatus((s) => ({ ...s, state: 'executing', currentTask: task }));

    try {
      const res = await invoke('vm-agent:execute-task', { objective: task });
      if ((res as { success: boolean })?.success) {
        setStatus((s) => ({ ...s, state: 'connected', currentTask: undefined }));
      } else {
        setStatus((s) => ({
          ...s,
          state: 'error',
          error: (res as { error?: string })?.error || 'Task failed',
        }));
      }
    } catch (error) {
      setStatus((s) => ({
        ...s,
        state: 'error',
        error: error instanceof Error ? error.message : 'Task failed',
      }));
    }
  };

  const handleStartRecording = async (name: string, description: string) => {
    setShowRecordingModal(false);
    setStatus((s) => ({ ...s, state: 'recording' }));

    try {
      await invoke('vm-agent:start-recording', { name, description });
    } catch (error) {
      console.error('Failed to start recording:', error);
      setStatus((s) => ({ ...s, state: 'connected' }));
    }
  };

  const handleStopRecording = async () => {
    try {
      const res = await invoke('vm-agent:stop-recording');
      if ((res as { success: boolean; data?: Recording })?.success) {
        const newRecording = (res as { success: boolean; data: Recording }).data;
        setRecordings((r) => [...r, newRecording]);
      }
      setStatus((s) => ({ ...s, state: 'connected' }));
    } catch (error) {
      console.error('Failed to stop recording:', error);
    }
  };

  const handleReplayRecording = async (recordingId: string) => {
    try {
      setStatus((s) => ({ ...s, state: 'executing', currentTask: 'Replaying recording...' }));
      await invoke('vm-agent:replay-recording', recordingId);
      setStatus((s) => ({ ...s, state: 'connected', currentTask: undefined }));
    } catch (error) {
      console.error('Failed to replay recording:', error);
      setStatus((s) => ({ ...s, state: 'error', error: 'Replay failed' }));
    }
  };

  const handleExecuteWorkflow = async (workflowId: string) => {
    try {
      setStatus((s) => ({ ...s, state: 'executing', currentTask: 'Running workflow...' }));
      await invoke('vm-agent:execute-workflow', workflowId);
      setStatus((s) => ({ ...s, state: 'connected', currentTask: undefined }));
    } catch (error) {
      console.error('Failed to execute workflow:', error);
      setStatus((s) => ({ ...s, state: 'error', error: 'Workflow failed' }));
    }
  };

  const handleAcceptPrediction = async (predictionId: string) => {
    const prediction = predictions.find((p) => p.id === predictionId);
    if (prediction) {
      setTaskInput(prediction.action);
    }
  };

  const toggleSection = (section: string) => {
    setExpandedSections((s) => {
      const newSet = new Set(s);
      if (newSet.has(section)) {
        newSet.delete(section);
      } else {
        newSet.add(section);
      }
      return newSet;
    });
  };

  // Get status color
  const getStatusColor = () => {
    switch (status.state) {
      case 'connected':
        return '#22c55e';
      case 'connecting':
      case 'executing':
        return '#f59e0b';
      case 'recording':
        return '#ef4444';
      case 'error':
        return '#ef4444';
      default:
        return '#666';
    }
  };

  const getStatusText = () => {
    switch (status.state) {
      case 'connected':
        return 'Connected';
      case 'connecting':
        return 'Connecting...';
      case 'executing':
        return 'Executing';
      case 'recording':
        return 'Recording';
      case 'error':
        return 'Error';
      default:
        return 'Disconnected';
    }
  };

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.title}>
          <IconMonitor size={20} />
          <span>VM Agent</span>
          {status.vmName && (
            <span style={{ color: '#666', fontWeight: 400 }}>— {status.vmName}</span>
          )}
        </div>
        <div
          style={{
            ...styles.statusBadge,
            backgroundColor: `${getStatusColor()}20`,
            color: getStatusColor(),
          }}
        >
          <span style={{ ...styles.statusDot, backgroundColor: getStatusColor() }} />
          {getStatusText()}
        </div>
      </div>

      {/* Content */}
      <div style={styles.content}>
        {/* Main Panel */}
        <div style={styles.mainPanel}>
          {/* Screen View */}
          <div style={styles.screenView}>
            {screenshot ? (
              <img
                src={`data:image/png;base64,${screenshot.data}`}
                alt="VM Screen"
                style={styles.screenshot}
              />
            ) : (
              <div style={styles.placeholder}>
                <IconMonitor size={48} />
                <p>{status.connected ? 'Loading screen...' : 'Connect to a VM to see the screen'}</p>
              </div>
            )}
          </div>

          {/* Control Bar */}
          <div style={styles.controlBar}>
            {!status.connected ? (
              <button
                style={{ ...styles.button, ...styles.primaryButton }}
                onClick={() => setShowConnectionModal(true)}
              >
                <IconMonitor size={16} />
                Connect to VM
              </button>
            ) : (
              <>
                <button
                  style={{ ...styles.button, ...styles.dangerButton }}
                  onClick={handleDisconnect}
                >
                  Disconnect
                </button>

                <button
                  style={styles.iconButton}
                  onClick={async () => {
                    const res = await invoke('vm-agent:screenshot');
                    if ((res as { success: boolean; data?: { screenshot: string; timestamp: number } })?.success) {
                      const data = (res as { success: boolean; data: { screenshot: string; timestamp: number } }).data;
                      setScreenshot({ data: data.screenshot, timestamp: data.timestamp });
                    }
                  }}
                  title="Refresh screenshot"
                >
                  <IconRefresh size={16} />
                </button>

                <button style={styles.iconButton} title="Take screenshot">
                  <IconCamera size={16} />
                </button>

                <div style={{ flex: 1 }} />

                {status.state === 'recording' ? (
                  <button
                    style={{ ...styles.button, ...styles.dangerButton }}
                    onClick={handleStopRecording}
                  >
                    <IconStop size={16} />
                    Stop Recording
                  </button>
                ) : (
                  <button
                    style={{ ...styles.button, ...styles.secondaryButton }}
                    onClick={() => setShowRecordingModal(true)}
                  >
                    <IconRecord size={16} />
                    Record
                  </button>
                )}

                {status.state === 'executing' ? (
                  <button
                    style={{ ...styles.button, ...styles.secondaryButton }}
                    onClick={() => invoke('vm-agent:pause-task', status.currentTask)}
                  >
                    <IconPause size={16} />
                    Pause
                  </button>
                ) : (
                  <button
                    style={{ ...styles.button, ...styles.secondaryButton }}
                    disabled={status.state !== 'connected'}
                  >
                    <IconPlay size={16} />
                    Resume
                  </button>
                )}
              </>
            )}
          </div>

          {/* Task Input */}
          {status.connected && (
            <div style={{ ...styles.controlBar, borderTop: 'none', paddingTop: '0' }}>
              <input
                style={styles.input}
                type="text"
                placeholder="Tell me what to do... (e.g., 'Open Chrome and search for weather')"
                value={taskInput}
                onChange={(e) => setTaskInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleExecuteTask();
                  }
                }}
                disabled={status.state === 'executing' || status.state === 'recording'}
              />
              <button
                style={{ ...styles.button, ...styles.primaryButton }}
                onClick={handleExecuteTask}
                disabled={
                  !taskInput.trim() ||
                  status.state === 'executing' ||
                  status.state === 'recording'
                }
              >
                <IconSend size={16} />
                Execute
              </button>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div style={styles.sidebar}>
          {/* Predictions */}
          <div style={styles.sidebarSection}>
            <div style={styles.sectionHeader} onClick={() => toggleSection('predictions')}>
              <span style={styles.sectionTitle}>Predictions</span>
              {expandedSections.has('predictions') ? (
                <IconChevronDown size={14} />
              ) : (
                <IconChevronRight size={14} />
              )}
            </div>
            {expandedSections.has('predictions') && (
              <div style={styles.sectionContent}>
                {predictions.length > 0 ? (
                  predictions.map((prediction) => (
                    <div
                      key={prediction.id}
                      style={styles.predictionItem}
                      onClick={() => handleAcceptPrediction(prediction.id)}
                    >
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '13px', marginBottom: '4px' }}>
                          {prediction.description}
                        </div>
                        <div style={styles.confidenceBar}>
                          <div
                            style={{
                              ...styles.confidenceFill,
                              width: `${prediction.confidence * 100}%`,
                              backgroundColor:
                                prediction.confidence > 0.7
                                  ? '#22c55e'
                                  : prediction.confidence > 0.4
                                    ? '#f59e0b'
                                    : '#ef4444',
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div style={{ color: '#666', fontSize: '13px', textAlign: 'center', padding: '12px' }}>
                    No predictions yet
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Recordings */}
          <div style={styles.sidebarSection}>
            <div style={styles.sectionHeader} onClick={() => toggleSection('recordings')}>
              <span style={styles.sectionTitle}>Recordings ({recordings.length})</span>
              {expandedSections.has('recordings') ? (
                <IconChevronDown size={14} />
              ) : (
                <IconChevronRight size={14} />
              )}
            </div>
            {expandedSections.has('recordings') && (
              <div style={styles.sectionContent}>
                {recordings.length > 0 ? (
                  recordings.map((recording) => (
                    <div
                      key={recording.id}
                      style={styles.listItem}
                      onClick={() => handleReplayRecording(recording.id)}
                    >
                      <div>
                        <div style={{ fontSize: '13px', fontWeight: 500 }}>{recording.name}</div>
                        <div style={{ fontSize: '11px', color: '#666' }}>
                          {recording.stepCount} steps
                        </div>
                      </div>
                      <IconPlay size={14} />
                    </div>
                  ))
                ) : (
                  <div style={{ color: '#666', fontSize: '13px', textAlign: 'center', padding: '12px' }}>
                    No recordings yet
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Workflows */}
          <div style={styles.sidebarSection}>
            <div style={styles.sectionHeader} onClick={() => toggleSection('workflows')}>
              <span style={styles.sectionTitle}>Workflows ({workflows.length})</span>
              {expandedSections.has('workflows') ? (
                <IconChevronDown size={14} />
              ) : (
                <IconChevronRight size={14} />
              )}
            </div>
            {expandedSections.has('workflows') && (
              <div style={styles.sectionContent}>
                {workflows.length > 0 ? (
                  workflows.map((workflow) => (
                    <div
                      key={workflow.id}
                      style={styles.listItem}
                      onClick={() => handleExecuteWorkflow(workflow.id)}
                    >
                      <div>
                        <div style={{ fontSize: '13px', fontWeight: 500 }}>{workflow.name}</div>
                        <div style={{ fontSize: '11px', color: '#666' }}>
                          {workflow.stepCount} steps
                        </div>
                      </div>
                      <IconPlay size={14} />
                    </div>
                  ))
                ) : (
                  <div style={{ color: '#666', fontSize: '13px', textAlign: 'center', padding: '12px' }}>
                    No workflows yet
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modals */}
      <ConnectionModal
        isOpen={showConnectionModal}
        onClose={() => setShowConnectionModal(false)}
        onConnect={handleConnect}
      />
      <RecordingModal
        isOpen={showRecordingModal}
        onClose={() => setShowRecordingModal(false)}
        onStart={handleStartRecording}
      />
    </div>
  );
};

export default VMAgentPanel;
