/**
 * Atlas Desktop - Enhanced Debug Panel
 * Comprehensive debugging dashboard (048-B)
 *
 * Features:
 * - System information
 * - Voice pipeline state
 * - Memory stats
 * - IPC event log
 * - Performance metrics
 * - Provider status
 *
 * @module components/DebugPanel
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { usePerformanceMonitor, getPerformanceRating } from '../hooks';
import { useAtlasStore } from '../stores/atlasStore';

/**
 * Debug event log entry
 */
interface DebugEvent {
  id: string;
  timestamp: number;
  type: 'ipc' | 'error' | 'state' | 'info';
  message: string;
  data?: unknown;
}

/**
 * System information
 */
interface SystemInfo {
  platform: string;
  arch: string;
  nodeVersion: string;
  electronVersion: string;
  isDev: boolean;
  uptime: number;
}

/**
 * Debug panel tabs
 */
type DebugTab = 'overview' | 'voice' | 'memory' | 'events' | 'system';

interface DebugPanelProps {
  visible: boolean;
  onClose: () => void;
}

/**
 * Enhanced Debug Panel component
 */
export function DebugPanel({ visible, onClose }: DebugPanelProps) {
  const [activeTab, setActiveTab] = useState<DebugTab>('overview');
  const [events, setEvents] = useState<DebugEvent[]>([]);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [memoryStats, setMemoryStats] = useState<Record<string, unknown> | null>(null);
  const [devState, setDevState] = useState<Record<string, unknown> | null>(null);
  const eventsEndRef = useRef<HTMLDivElement>(null);

  const metrics = usePerformanceMonitor({ enabled: visible });
  const state = useAtlasStore((s) => s.state);
  const isListening = useAtlasStore((s) => s.isListening);
  const isSpeaking = useAtlasStore((s) => s.isSpeaking);
  const isThinking = useAtlasStore((s) => s.isThinking);
  const sttProvider = useAtlasStore((s) => s.sttProvider);
  const llmProvider = useAtlasStore((s) => s.llmProvider);
  const ttsProvider = useAtlasStore((s) => s.ttsProvider);
  const budgetUsage = useAtlasStore((s) => s.budgetUsage);
  const settings = useAtlasStore((s) => s.settings);

  // Add event to log
  const addEvent = useCallback((type: DebugEvent['type'], message: string, data?: unknown) => {
    const event: DebugEvent = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      timestamp: Date.now(),
      type,
      message,
      data,
    };
    setEvents((prev) => [...prev.slice(-99), event]);
  }, []);

  // Load system info
  useEffect(() => {
    if (!visible) return;

    const loadSystemInfo = async () => {
      try {
        const devStatus = await window.atlas?.dev?.getStatus();
        if (devStatus?.data) {
          setSystemInfo({
            platform: devStatus.data.platform,
            arch: devStatus.data.arch,
            nodeVersion: devStatus.data.nodeVersion,
            electronVersion: devStatus.data.electronVersion,
            isDev: devStatus.data.isDev,
            uptime: Date.now(),
          });
        }
      } catch {
        // Dev API might not be available in production
      }
    };

    const loadDevState = async () => {
      try {
        const state = await window.atlas?.dev?.getState();
        if (state?.data) {
          setDevState(state.data as Record<string, unknown>);
        }
      } catch {
        // Ignore
      }
    };

    const loadMemoryStats = async () => {
      try {
        const stats = await window.atlas?.atlas?.getMemoryStats();
        if (stats?.data) {
          setMemoryStats(stats.data as Record<string, unknown>);
        }
      } catch {
        // Ignore
      }
    };

    loadSystemInfo();
    loadDevState();
    loadMemoryStats();

    // Refresh every 5 seconds
    const interval = setInterval(() => {
      loadMemoryStats();
    }, 5000);

    return () => clearInterval(interval);
  }, [visible]);

  // Listen for events
  useEffect(() => {
    if (!visible) return;

    // Subscribe to various events
    const unsubscribers: Array<() => void> = [];

    const subscribeToEvent = (channel: string, type: DebugEvent['type']) => {
      const unsub = window.atlas?.on(channel, (...args: unknown[]) => {
        addEvent(type, `${channel}`, args[0]);
      });
      if (unsub) unsubscribers.push(unsub);
    };

    // State changes
    subscribeToEvent('atlas:state-change', 'state');
    subscribeToEvent('atlas:error', 'error');
    subscribeToEvent('atlas:wake-word', 'ipc');
    subscribeToEvent('atlas:transcript-interim', 'ipc');
    subscribeToEvent('atlas:transcript-final', 'ipc');
    subscribeToEvent('atlas:response-start', 'ipc');
    subscribeToEvent('atlas:response-complete', 'ipc');
    subscribeToEvent('atlas:provider-change', 'state');
    subscribeToEvent('atlas:connectivity-change', 'state');

    return () => {
      unsubscribers.forEach((unsub) => unsub());
    };
  }, [visible, addEvent]);

  // Auto-scroll events
  useEffect(() => {
    eventsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events]);

  // Handle keyboard shortcut to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && visible) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [visible, onClose]);

  if (!visible) return null;

  const rating = getPerformanceRating(metrics.fps);
  const ratingColors = {
    excellent: '#4ade80',
    good: '#a3e635',
    fair: '#facc15',
    poor: '#f87171',
  };

  const tabs: Array<{ id: DebugTab; label: string }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'voice', label: 'Voice' },
    { id: 'memory', label: 'Memory' },
    { id: 'events', label: 'Events' },
    { id: 'system', label: 'System' },
  ];

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        width: '400px',
        height: '100vh',
        backgroundColor: 'rgba(10, 10, 15, 0.95)',
        color: '#fff',
        fontFamily: 'monospace',
        fontSize: '12px',
        zIndex: 10000,
        display: 'flex',
        flexDirection: 'column',
        borderLeft: '1px solid rgba(255,255,255,0.1)',
        backdropFilter: 'blur(8px)',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid rgba(255,255,255,0.1)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span style={{ fontWeight: 'bold', fontSize: '14px' }}>Debug Panel</span>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: '#fff',
            cursor: 'pointer',
            fontSize: '16px',
            padding: '4px 8px',
          }}
        >
          ×
        </button>
      </div>

      {/* Tabs */}
      <div
        style={{
          display: 'flex',
          borderBottom: '1px solid rgba(255,255,255,0.1)',
        }}
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              flex: 1,
              padding: '8px',
              background: activeTab === tab.id ? 'rgba(255,255,255,0.1)' : 'none',
              border: 'none',
              color: activeTab === tab.id ? '#fff' : 'rgba(255,255,255,0.5)',
              cursor: 'pointer',
              fontSize: '11px',
              borderBottom: activeTab === tab.id ? '2px solid #6366f1' : '2px solid transparent',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
        {/* Overview Tab */}
        {activeTab === 'overview' && (
          <div>
            <Section title="Performance">
              <Row label="FPS" value={metrics.fps} color={ratingColors[rating]} />
              <Row label="Avg FPS" value={metrics.avgFps} />
              <Row label="Frame Time" value={`${metrics.frameTime.toFixed(1)}ms`} />
              {metrics.memoryUsage > 0 && <Row label="Memory" value={`${metrics.memoryUsage}MB`} />}
              <Row label="Rating" value={rating.toUpperCase()} color={ratingColors[rating]} />
            </Section>

            <Section title="Providers">
              <Row label="STT" value={sttProvider || 'none'} />
              <Row label="LLM" value={llmProvider || 'none'} />
              <Row label="TTS" value={ttsProvider || 'none'} />
            </Section>

            <Section title="Budget">
              <Row label="Today" value={`$${budgetUsage.todaySpend.toFixed(2)}`} />
              <Row label="Remaining" value={`$${budgetUsage.remainingBudget.toFixed(2)}`} />
              <Row label="Usage" value={`${(budgetUsage.usagePercent * 100).toFixed(0)}%`} />
            </Section>

            <Section title="Settings">
              <Row label="Quality" value={settings.qualityPreset} />
              <Row label="Particles" value={settings.particleCount.toLocaleString()} />
              <Row label="Push-to-Talk" value={settings.pushToTalk ? 'On' : 'Off'} />
            </Section>
          </div>
        )}

        {/* Voice Tab */}
        {activeTab === 'voice' && (
          <div>
            <Section title="Pipeline State">
              <Row label="State" value={state} />
              <Row label="Listening" value={isListening ? 'Yes' : 'No'} color={isListening ? '#4ade80' : undefined} />
              <Row label="Speaking" value={isSpeaking ? 'Yes' : 'No'} color={isSpeaking ? '#60a5fa' : undefined} />
              <Row label="Thinking" value={isThinking ? 'Yes' : 'No'} color={isThinking ? '#a78bfa' : undefined} />
            </Section>

            <Section title="Audio Settings">
              <Row label="Input Device" value={settings.inputDevice || 'Default'} />
              <Row label="Output Device" value={settings.outputDevice || 'Default'} />
              <Row label="Wake Word" value={settings.wakeWord} />
              <Row label="Sensitivity" value={`${(settings.wakeWordSensitivity * 100).toFixed(0)}%`} />
              <Row label="Barge-In" value={settings.enableBargeIn ? 'Enabled' : 'Disabled'} />
            </Section>

            <Section title="Providers">
              <Row label="STT Provider" value={settings.preferredSttProvider} />
              <Row label="LLM Provider" value={settings.preferredLlmProvider} />
            </Section>
          </div>
        )}

        {/* Memory Tab */}
        {activeTab === 'memory' && (
          <div>
            <Section title="Memory Stats">
              {memoryStats ? (
                Object.entries(memoryStats).map(([key, value]) => (
                  <Row key={key} label={key} value={JSON.stringify(value)} />
                ))
              ) : (
                <div style={{ color: 'rgba(255,255,255,0.5)' }}>Loading...</div>
              )}
            </Section>

            <Section title="Conversation">
              <Row label="Max History" value={settings.maxConversationHistory} />
            </Section>
          </div>
        )}

        {/* Events Tab */}
        {activeTab === 'events' && (
          <div>
            <div style={{ marginBottom: '8px', display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ opacity: 0.7 }}>Event Log ({events.length})</span>
              <button
                onClick={() => setEvents([])}
                style={{
                  background: 'rgba(255,255,255,0.1)',
                  border: 'none',
                  color: '#fff',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '10px',
                }}
              >
                Clear
              </button>
            </div>
            <div
              style={{
                maxHeight: 'calc(100vh - 200px)',
                overflow: 'auto',
                backgroundColor: 'rgba(0,0,0,0.3)',
                borderRadius: '4px',
                padding: '8px',
              }}
            >
              {events.length === 0 ? (
                <div style={{ color: 'rgba(255,255,255,0.5)', textAlign: 'center', padding: '20px' }}>
                  No events yet
                </div>
              ) : (
                events.map((event) => (
                  <div
                    key={event.id}
                    style={{
                      marginBottom: '6px',
                      padding: '4px',
                      borderLeft: `2px solid ${getEventColor(event.type)}`,
                      paddingLeft: '8px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px' }}>
                      <span style={{ color: getEventColor(event.type) }}>{event.type.toUpperCase()}</span>
                      <span style={{ opacity: 0.5 }}>{formatTime(event.timestamp)}</span>
                    </div>
                    <div style={{ marginTop: '2px' }}>{event.message}</div>
                    {event.data !== undefined && event.data !== null ? (
                      <div
                        style={{
                          marginTop: '2px',
                          fontSize: '10px',
                          color: 'rgba(255,255,255,0.5)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {JSON.stringify(event.data).slice(0, 100)}
                      </div>
                    ) : null}
                  </div>
                ))
              )}
              <div ref={eventsEndRef} />
            </div>
          </div>
        )}

        {/* System Tab */}
        {activeTab === 'system' && (
          <div>
            <Section title="System Info">
              {systemInfo ? (
                <>
                  <Row label="Platform" value={systemInfo.platform} />
                  <Row label="Architecture" value={systemInfo.arch} />
                  <Row label="Node" value={systemInfo.nodeVersion} />
                  <Row label="Electron" value={systemInfo.electronVersion} />
                  <Row label="Dev Mode" value={systemInfo.isDev ? 'Yes' : 'No'} />
                </>
              ) : (
                <div style={{ color: 'rgba(255,255,255,0.5)' }}>Loading...</div>
              )}
            </Section>

            <Section title="Dev State">
              {devState ? (
                <Row label="Fresh Restart" value={String((devState as Record<string, boolean>).isFreshRestart)} />
              ) : (
                <div style={{ color: 'rgba(255,255,255,0.5)' }}>Not available</div>
              )}
            </Section>

            <Section title="Actions">
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <ActionButton
                  label="Reload Renderer"
                  onClick={() => window.atlas?.dev?.reloadRenderer()}
                />
                <ActionButton
                  label="Toggle DevTools"
                  onClick={() => window.atlas?.dev?.toggleDevTools()}
                />
                <ActionButton
                  label="Clear Dev State"
                  onClick={() => window.atlas?.dev?.clearState()}
                />
              </div>
            </Section>
          </div>
        )}
      </div>
    </div>
  );
}

// Helper components
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '16px' }}>
      <div
        style={{
          fontSize: '10px',
          textTransform: 'uppercase',
          letterSpacing: '1px',
          opacity: 0.5,
          marginBottom: '8px',
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function Row({
  label,
  value,
  color,
}: {
  label: string;
  value: string | number;
  color?: string;
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        marginBottom: '4px',
        padding: '2px 0',
      }}
    >
      <span style={{ opacity: 0.7 }}>{label}:</span>
      <span style={{ color: color || '#fff', fontWeight: color ? 'bold' : 'normal' }}>{value}</span>
    </div>
  );
}

function ActionButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: 'rgba(99, 102, 241, 0.2)',
        border: '1px solid rgba(99, 102, 241, 0.5)',
        color: '#fff',
        padding: '6px 12px',
        borderRadius: '4px',
        cursor: 'pointer',
        fontSize: '11px',
      }}
    >
      {label}
    </button>
  );
}

function getEventColor(type: DebugEvent['type']): string {
  switch (type) {
    case 'error':
      return '#f87171';
    case 'state':
      return '#a78bfa';
    case 'ipc':
      return '#60a5fa';
    default:
      return '#9ca3af';
  }
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export default DebugPanel;
