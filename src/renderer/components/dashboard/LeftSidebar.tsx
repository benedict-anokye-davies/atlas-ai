/**
 * LeftSidebar - Goals Map panel
 * Shows goals organized by category with progress bars
 */

import { useDashboardStore, type Goal } from '../../stores/dashboardStore';

// Category icons
const CategoryIcons: Record<Goal['category'], React.ReactNode> = {
  research: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.35-4.35" />
    </svg>
  ),
  learning: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </svg>
  ),
  tasks: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  ),
  trading: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 3v18h18" />
      <path d="m19 9-5 5-4-4-3 3" />
    </svg>
  ),
  health: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  ),
  other: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4M12 8h.01" />
    </svg>
  ),
};

interface GoalCardProps {
  goal: Goal;
}

function GoalCard({ goal }: GoalCardProps) {
  const progressColor =
    goal.progress >= 80
      ? 'var(--dashboard-success)'
      : goal.progress >= 50
        ? 'var(--dashboard-accent)'
        : goal.progress >= 25
          ? 'var(--dashboard-warning)'
          : 'var(--dashboard-text-dim)';

  return (
    <div className="goal-card">
      <div className="goal-header">
        <span className="goal-icon">{CategoryIcons[goal.category]}</span>
        <span className="goal-title">{goal.title}</span>
        <span className="goal-percentage">{goal.progress}%</span>
      </div>
      <div className="goal-progress-track">
        <div
          className="goal-progress-fill"
          style={{
            width: `${goal.progress}%`,
            backgroundColor: progressColor,
          }}
        />
      </div>
    </div>
  );
}

export function LeftSidebar() {
  const { goals, toggleLeftSidebar, leftSidebarCollapsed } = useDashboardStore();

  // Group goals by category
  const goalsByCategory = goals.reduce(
    (acc, goal) => {
      if (!acc[goal.category]) {
        acc[goal.category] = [];
      }
      acc[goal.category].push(goal);
      return acc;
    },
    {} as Record<Goal['category'], Goal[]>
  );

  const categories: Goal['category'][] = [
    'tasks',
    'learning',
    'research',
    'trading',
    'health',
    'other',
  ];

  return (
    <div className="sidebar-content">
      {/* Header */}
      <div className="sidebar-header">
        <h2 className="sidebar-title">Goals Map</h2>
        <button
          className="sidebar-toggle"
          onClick={toggleLeftSidebar}
          aria-label={leftSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d={leftSidebarCollapsed ? 'M9 18l6-6-6-6' : 'M15 18l-6-6 6-6'} />
          </svg>
        </button>
      </div>

      {/* Goals list */}
      <div className="sidebar-scroll">
        {categories.map((category) => {
          const categoryGoals = goalsByCategory[category];
          if (!categoryGoals || categoryGoals.length === 0) return null;

          return (
            <div key={category} className="goal-category">
              <h3 className="category-label">{category}</h3>
              <div className="category-goals">
                {categoryGoals.map((goal) => (
                  <GoalCard key={goal.id} goal={goal} />
                ))}
              </div>
            </div>
          );
        })}

        {goals.length === 0 && (
          <div className="sidebar-empty">
            <p>No goals yet</p>
            <p className="sidebar-hint">Say &quot;Add goal: Learn Rust&quot; to create one</p>
          </div>
        )}
      </div>

      {/* Add goal button */}
      <div className="sidebar-footer">
        <button className="add-goal-btn" title="Add goal via voice">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14M5 12h14" />
          </svg>
          <span>Add Goal</span>
        </button>
      </div>
    </div>
  );
}

export default LeftSidebar;
