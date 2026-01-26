/**
 * RightSidebar - Active Workflows and Integrations Grid
 */

import { useDashboardStore, type Workflow, type Integration } from '../../stores/dashboardStore';

// Status icons for workflows
const WorkflowStatusIcon: Record<Workflow['status'], React.ReactNode> = {
  listening: (
    <svg viewBox="0 0 24 24" fill="currentColor" className="status-listening">
      <circle cx="12" cy="12" r="6" />
    </svg>
  ),
  running: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className="status-running"
    >
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  ),
  scheduled: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className="status-scheduled"
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  ),
  paused: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className="status-paused"
    >
      <rect x="6" y="4" width="4" height="16" />
      <rect x="14" y="4" width="4" height="16" />
    </svg>
  ),
  error: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className="status-error"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M15 9l-6 6M9 9l6 6" />
    </svg>
  ),
};

interface WorkflowCardProps {
  workflow: Workflow;
}

function WorkflowCard({ workflow }: WorkflowCardProps) {
  const statusLabel = workflow.status.charAt(0).toUpperCase() + workflow.status.slice(1);

  const getTimeLabel = () => {
    if (workflow.status === 'running' && workflow.currentStep && workflow.totalSteps) {
      return `Step ${workflow.currentStep}/${workflow.totalSteps}`;
    }
    if (workflow.lastRun) {
      const mins = Math.floor((Date.now() - workflow.lastRun.getTime()) / 60000);
      return mins < 60 ? `${mins}m ago` : `${Math.floor(mins / 60)}h ago`;
    }
    if (workflow.nextRun) {
      const mins = Math.floor((workflow.nextRun.getTime() - Date.now()) / 60000);
      return mins < 60 ? `in ${mins}m` : `in ${Math.floor(mins / 60)}h`;
    }
    return '';
  };

  return (
    <div className={`workflow-card workflow-${workflow.status}`}>
      <span className="workflow-status-icon">{WorkflowStatusIcon[workflow.status]}</span>
      <div className="workflow-info">
        <span className="workflow-name">{workflow.name}</span>
        <span className="workflow-meta">
          <span className="workflow-status-text">{statusLabel}</span>
          {getTimeLabel() && (
            <>
              <span className="workflow-divider">·</span>
              <span className="workflow-time">{getTimeLabel()}</span>
            </>
          )}
        </span>
      </div>
    </div>
  );
}

// Integration icon mapping
const IntegrationIconMap: Record<string, React.ReactNode> = {
  mail: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  ),
  music: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  ),
  'message-circle': (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  ),
  phone: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  ),
  globe: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  ),
  'trending-up': (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
      <polyline points="17 6 23 6 23 12" />
    </svg>
  ),
  'circle-dollar-sign': (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8M12 18V6" />
    </svg>
  ),
  landmark: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 22h18M6 18v-7M10 18v-7M14 18v-7M18 18v-7M12 2L2 8h20L12 2z" />
    </svg>
  ),
  'bar-chart-2': (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M18 20V10M12 20V4M6 20v-6" />
    </svg>
  ),
  youtube: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z" />
      <polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02" />
    </svg>
  ),
  video: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polygon points="23 7 16 12 23 17 23 7" />
      <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
    </svg>
  ),
  code: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  ),
  github: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
    </svg>
  ),
  wallet: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
      <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
      <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
    </svg>
  ),
  calendar: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  ),
};

function IntegrationIcon({ integration }: { integration: Integration }) {
  const icon = IntegrationIconMap[integration.icon] || IntegrationIconMap.globe;

  return (
    <div
      className={`integration-icon integration-${integration.status}`}
      title={`${integration.name}: ${integration.status}`}
    >
      {icon}
    </div>
  );
}

export function RightSidebar() {
  const { workflows, integrations, toggleRightSidebar, rightSidebarCollapsed, setView } =
    useDashboardStore();

  const healthyCount = integrations.filter((i) => i.status === 'connected').length;

  return (
    <div className="sidebar-content">
      {/* Header */}
      <div className="sidebar-header">
        <h2 className="sidebar-title">Workflows</h2>
        <button
          className="sidebar-toggle"
          onClick={toggleRightSidebar}
          aria-label={rightSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d={rightSidebarCollapsed ? 'M15 18l-6-6 6-6' : 'M9 18l6-6-6-6'} />
          </svg>
        </button>
      </div>

      {/* Workflows list */}
      <div className="sidebar-scroll">
        <div className="sidebar-section">
          <h3 className="section-label">
            Active Workflows
            <button
              className="section-action-btn"
              onClick={() => setView('workflow-builder')}
              title="Create new workflow"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
          </h3>
          <div className="workflows-list">
            {workflows.map((workflow) => (
              <WorkflowCard key={workflow.id} workflow={workflow} />
            ))}
            {workflows.length === 0 && <p className="sidebar-empty-text">No workflows yet</p>}
          </div>
        </div>

        {/* Integrations grid */}
        <div className="sidebar-section">
          <h3 className="section-label">
            Integrations
            <span className="section-badge">
              {healthyCount}/{integrations.length}
            </span>
          </h3>
          <div className="integrations-grid">
            {integrations.map((integration) => (
              <IntegrationIcon key={integration.id} integration={integration} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default RightSidebar;
