/**
 * BottomPanel - Agents Swarm and Run Statistics
 */

import { useDashboardStore, type Agent } from '../../stores/dashboardStore';

// Agent status colors
const StatusColors: Record<Agent['status'], string> = {
  active: 'var(--dashboard-success)',
  running: 'var(--dashboard-accent)',
  idle: 'var(--dashboard-text-dim)',
  error: 'var(--dashboard-error)',
};

interface AgentCardProps {
  agent: Agent;
}

function AgentCard({ agent }: AgentCardProps) {
  const statusLabel = agent.status.charAt(0).toUpperCase() + agent.status.slice(1);

  return (
    <div className={`agent-card agent-${agent.status}`}>
      <div className="agent-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="8" r="4" />
          <path d="M4 20c0-4 4-6 8-6s8 2 8 6" />
        </svg>
        <span
          className="agent-status-dot"
          style={{ backgroundColor: StatusColors[agent.status] }}
        />
      </div>
      <div className="agent-info">
        <span className="agent-name">{agent.name}</span>
        <span className="agent-meta">
          {statusLabel}
          {agent.taskCount > 0 && ` · ${agent.taskCount} tasks`}
        </span>
      </div>
    </div>
  );
}

function RunStats() {
  const { runStats } = useDashboardStore();

  return (
    <div className="run-stats">
      <h3 className="run-stats-title">Runs Queue</h3>
      <div className="run-stats-grid">
        <div className="run-stat">
          <span className="run-stat-value run-stat-queued">{runStats.queued}</span>
          <span className="run-stat-label">Queued</span>
        </div>
        <div className="run-stat">
          <span className="run-stat-value run-stat-running">{runStats.running}</span>
          <span className="run-stat-label">Running</span>
        </div>
        <div className="run-stat">
          <span className="run-stat-value run-stat-completed">{runStats.completed}</span>
          <span className="run-stat-label">Completed</span>
        </div>
        <div className="run-stat">
          <span className="run-stat-value run-stat-failed">{runStats.failed}</span>
          <span className="run-stat-label">Failed</span>
        </div>
      </div>
      <div className="run-stats-footer">
        <span className="run-stat-p95">p95: {runStats.p95Latency}s</span>
      </div>
    </div>
  );
}

export function BottomPanel() {
  const { agents, toggleBottomPanel, bottomPanelCollapsed } = useDashboardStore();

  return (
    <div className="bottom-panel-content">
      {/* Toggle button */}
      <button
        className="bottom-panel-toggle"
        onClick={toggleBottomPanel}
        aria-label={bottomPanelCollapsed ? 'Expand panel' : 'Collapse panel'}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d={bottomPanelCollapsed ? 'M18 15l-6-6-6 6' : 'M6 9l6 6 6-6'} />
        </svg>
      </button>

      {/* Agents Swarm */}
      <div className="bottom-panel-main">
        <div className="agents-section">
          <h3 className="agents-title">Agents Swarm</h3>
          <div className="agents-grid">
            {agents.map((agent) => (
              <AgentCard key={agent.id} agent={agent} />
            ))}
            {agents.length === 0 && <p className="agents-empty">No agents configured</p>}
          </div>
        </div>
      </div>

      {/* Run Stats */}
      <div className="bottom-panel-side">
        <RunStats />
      </div>
    </div>
  );
}

export default BottomPanel;
