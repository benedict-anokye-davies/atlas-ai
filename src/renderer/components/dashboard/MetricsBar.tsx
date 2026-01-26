/**
 * MetricsBar - Top bar showing key metrics
 * Credits, Agents, Workflows, Tools, Runs, Integrations
 */

import { useDashboardStore } from '../../stores/dashboardStore';

interface MetricCardProps {
  icon: React.ReactNode;
  value: number | string;
  label: string;
  subValue?: string;
  status?: 'normal' | 'warning' | 'error' | 'success';
  onClick?: () => void;
}

function MetricCard({ icon, value, label, subValue, status = 'normal', onClick }: MetricCardProps) {
  return (
    <button className={`metric-card metric-${status}`} onClick={onClick} type="button">
      <span className="metric-icon">{icon}</span>
      <div className="metric-content">
        <span className="metric-value">
          {value}
          {subValue && <span className="metric-sub">{subValue}</span>}
        </span>
        <span className="metric-label">{label}</span>
      </div>
    </button>
  );
}

// Simple SVG icons
const Icons = {
  credits: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v12M9 9h6M9 15h6" />
    </svg>
  ),
  agents: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 4-6 8-6s8 2 8 6" />
    </svg>
  ),
  workflows: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 3h6v6H3zM15 3h6v6h-6zM9 15h6v6H9z" />
      <path d="M6 9v3h12V9M12 12v3" />
    </svg>
  ),
  tools: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  ),
  runs: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  ),
  integrations: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="2" y="2" width="8" height="8" rx="1" />
      <rect x="14" y="2" width="8" height="8" rx="1" />
      <rect x="2" y="14" width="8" height="8" rx="1" />
      <rect x="14" y="14" width="8" height="8" rx="1" />
    </svg>
  ),
};

export function MetricsBar() {
  const { metrics, runStats } = useDashboardStore();

  const integrationStatus =
    metrics.integrationsHealthy === metrics.integrations
      ? 'success'
      : metrics.integrationsHealthy < metrics.integrations / 2
        ? 'error'
        : 'warning';

  return (
    <div className="metrics-bar">
      <div className="metrics-bar-content">
        {/* Logo/Brand */}
        <div className="metrics-brand">
          <span className="brand-icon">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="12" r="10" opacity="0.2" />
              <circle cx="12" cy="12" r="6" opacity="0.4" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </span>
          <span className="brand-name">ATLAS</span>
        </div>

        {/* Metrics */}
        <div className="metrics-group">
          <MetricCard
            icon={Icons.credits}
            value={metrics.credits.toLocaleString()}
            label="Credits"
          />
          <MetricCard icon={Icons.agents} value={metrics.agents} label="Agents" />
          <MetricCard icon={Icons.workflows} value={metrics.workflows} label="Workflows" />
          <MetricCard icon={Icons.tools} value={metrics.tools} label="Tools" />
          <MetricCard
            icon={Icons.runs}
            value={runStats.queued}
            subValue={`/${runStats.completed}/24h`}
            label="Runs"
            status={runStats.failed > 0 ? 'warning' : 'normal'}
          />
          <MetricCard
            icon={Icons.integrations}
            value={`${metrics.integrationsHealthy}/${metrics.integrations}`}
            label="Integrations"
            status={integrationStatus}
          />
        </div>

        {/* Right side - time/status */}
        <div className="metrics-status">
          <span className="status-time">
            {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      </div>
    </div>
  );
}

export default MetricsBar;
