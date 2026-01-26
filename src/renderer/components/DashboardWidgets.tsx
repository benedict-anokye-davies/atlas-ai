/**
 * Atlas Desktop - Dashboard Widgets System
 * Customizable dashboard with draggable widgets
 */

import React, { useState, useEffect } from 'react';
import './DashboardWidgets.css';

// ============================================================================
// Types
// ============================================================================

export type WidgetType = 'weather' | 'calendar' | 'study' | 'trading' | 'system' | 'goals' | 'spotify' | 'quick-actions';

export type WidgetSize = 'small' | 'medium' | 'large';

export interface WidgetConfig {
  id: string;
  type: WidgetType;
  title: string;
  size: WidgetSize;
  position: { x: number; y: number };
  visible: boolean;
  settings?: Record<string, unknown>;
}

interface DashboardWidgetsProps {
  isVisible: boolean;
  onClose: () => void;
}

// ============================================================================
// Icons (exported for future use)
// ============================================================================

export const SunIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="5" />
    <line x1="12" y1="1" x2="12" y2="3" />
    <line x1="12" y1="21" x2="12" y2="23" />
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
    <line x1="1" y1="12" x2="3" y2="12" />
    <line x1="21" y1="12" x2="23" y2="12" />
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
  </svg>
);

const CloudIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
  </svg>
);

const CalendarIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </svg>
);

const BookIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
  </svg>
);

const TrendingUpIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
    <polyline points="17 6 23 6 23 12" />
  </svg>
);

const CpuIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="4" y="4" width="16" height="16" rx="2" ry="2" />
    <rect x="9" y="9" width="6" height="6" />
    <line x1="9" y1="1" x2="9" y2="4" />
    <line x1="15" y1="1" x2="15" y2="4" />
    <line x1="9" y1="20" x2="9" y2="23" />
    <line x1="15" y1="20" x2="15" y2="23" />
    <line x1="20" y1="9" x2="23" y2="9" />
    <line x1="20" y1="14" x2="23" y2="14" />
    <line x1="1" y1="9" x2="4" y2="9" />
    <line x1="1" y1="14" x2="4" y2="14" />
  </svg>
);

const TargetIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="10" />
    <circle cx="12" cy="12" r="6" />
    <circle cx="12" cy="12" r="2" />
  </svg>
);

const ZapIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </svg>
);

const MusicIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M9 18V5l12-2v13" />
    <circle cx="6" cy="18" r="3" />
    <circle cx="18" cy="16" r="3" />
  </svg>
);

const RefreshIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="23 4 23 10 17 10" />
    <polyline points="1 20 1 14 7 14" />
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
  </svg>
);

const XIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const GridIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="3" width="7" height="7" />
    <rect x="14" y="3" width="7" height="7" />
    <rect x="14" y="14" width="7" height="7" />
    <rect x="3" y="14" width="7" height="7" />
  </svg>
);

// ============================================================================
// Weather Widget
// ============================================================================

interface WeatherData {
  temp: number;
  condition: string;
  humidity: number;
  wind: number;
  high: number;
  low: number;
  location: string;
}

const WeatherWidget: React.FC<{ onRefresh: () => void }> = ({ onRefresh: _onRefresh }) => {
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadWeather();
  }, []);

  const loadWeather = async () => {
    setIsLoading(true);
    try {
      const result = await window.atlas?.weather?.getCurrent();
      if (result?.success && result.data) {
        setWeather(result.data as WeatherData);
      } else {
        // Mock data
        setWeather({
          temp: 72,
          condition: 'Partly Cloudy',
          humidity: 45,
          wind: 8,
          high: 78,
          low: 65,
          location: 'San Francisco',
        });
      }
    } catch (error) {
      // Mock data on error
      setWeather({
        temp: 72,
        condition: 'Partly Cloudy',
        humidity: 45,
        wind: 8,
        high: 78,
        low: 65,
        location: 'San Francisco',
      });
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return <div className="widget-loading">Loading weather...</div>;
  }

  return (
    <div className="weather-content">
      <div className="weather-main">
        <div className="weather-icon-large">
          <CloudIcon className="weather-svg" />
        </div>
        <div className="weather-temp">{weather?.temp}°</div>
      </div>
      <div className="weather-details">
        <div className="weather-condition">{weather?.condition}</div>
        <div className="weather-location">{weather?.location}</div>
        <div className="weather-stats">
          <span>H: {weather?.high}°</span>
          <span>L: {weather?.low}°</span>
          <span>💧 {weather?.humidity}%</span>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// Calendar Widget
// ============================================================================

interface CalendarEvent {
  id: string;
  title: string;
  time: string;
  duration: number;
  color?: string;
}

const CalendarWidget: React.FC = () => {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadEvents();
  }, []);

  const loadEvents = async () => {
    setIsLoading(true);
    try {
      const result = await window.atlas?.calendar?.getTodayEvents();
      if (result?.success && result.data) {
        setEvents(result.data as CalendarEvent[]);
      } else {
        // Mock data
        setEvents([
          { id: '1', title: 'Team Standup', time: '10:00 AM', duration: 30, color: '#6366f1' },
          { id: '2', title: 'Project Review', time: '2:00 PM', duration: 60, color: '#22c55e' },
          { id: '3', title: 'Design Sync', time: '4:30 PM', duration: 45, color: '#f59e0b' },
        ]);
      }
    } catch {
      setEvents([
        { id: '1', title: 'Team Standup', time: '10:00 AM', duration: 30, color: '#6366f1' },
        { id: '2', title: 'Project Review', time: '2:00 PM', duration: 60, color: '#22c55e' },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const today = new Date();
  const dateStr = today.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

  if (isLoading) {
    return <div className="widget-loading">Loading events...</div>;
  }

  return (
    <div className="calendar-content">
      <div className="calendar-date">{dateStr}</div>
      <div className="calendar-events">
        {events.length === 0 ? (
          <div className="no-events">No events today</div>
        ) : (
          events.map(event => (
            <div key={event.id} className="calendar-event" style={{ borderLeftColor: event.color }}>
              <span className="event-time">{event.time}</span>
              <span className="event-title">{event.title}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

// ============================================================================
// Study Progress Widget
// ============================================================================

interface StudyStats {
  todayMinutes: number;
  weekMinutes: number;
  streak: number;
  cardsReviewed: number;
  accuracy: number;
}

const StudyWidget: React.FC = () => {
  const [stats, setStats] = useState<StudyStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    setIsLoading(true);
    try {
      const result = await window.atlas?.study?.getStats();
      if (result?.success && result.data) {
        setStats(result.data as StudyStats);
      } else {
        setStats({
          todayMinutes: 45,
          weekMinutes: 320,
          streak: 7,
          cardsReviewed: 42,
          accuracy: 87,
        });
      }
    } catch {
      setStats({
        todayMinutes: 45,
        weekMinutes: 320,
        streak: 7,
        cardsReviewed: 42,
        accuracy: 87,
      });
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return <div className="widget-loading">Loading study stats...</div>;
  }

  return (
    <div className="study-content">
      <div className="study-streak">
        <span className="streak-fire">🔥</span>
        <span className="streak-count">{stats?.streak}</span>
        <span className="streak-label">day streak</span>
      </div>
      <div className="study-stats-grid">
        <div className="study-stat">
          <span className="stat-value">{stats?.todayMinutes}m</span>
          <span className="stat-label">Today</span>
        </div>
        <div className="study-stat">
          <span className="stat-value">{stats?.cardsReviewed}</span>
          <span className="stat-label">Cards</span>
        </div>
        <div className="study-stat">
          <span className="stat-value">{stats?.accuracy}%</span>
          <span className="stat-label">Accuracy</span>
        </div>
      </div>
      <div className="study-progress-bar">
        <div className="progress-fill" style={{ width: `${Math.min(stats?.todayMinutes || 0, 60) / 60 * 100}%` }} />
      </div>
      <div className="study-goal">Goal: 60 minutes daily</div>
    </div>
  );
};

// ============================================================================
// System Stats Widget
// ============================================================================

interface SystemStats {
  cpu: number;
  memory: number;
  gpu: number;
  disk: number;
}

const SystemWidget: React.FC = () => {
  const [stats, setStats] = useState<SystemStats>({ cpu: 0, memory: 0, gpu: 0, disk: 0 });

  useEffect(() => {
    const updateStats = async () => {
      try {
        const result = await window.atlas?.system?.getStats?.();
        if (result?.success && result.data) {
          setStats(result.data as unknown as SystemStats);
        } else {
          // Simulate stats
          setStats({
            cpu: Math.floor(Math.random() * 30) + 10,
            memory: Math.floor(Math.random() * 20) + 40,
            gpu: Math.floor(Math.random() * 40) + 20,
            disk: 65,
          });
        }
      } catch {
        setStats({
          cpu: Math.floor(Math.random() * 30) + 10,
          memory: Math.floor(Math.random() * 20) + 40,
          gpu: Math.floor(Math.random() * 40) + 20,
          disk: 65,
        });
      }
    };

    updateStats();
    const interval = setInterval(updateStats, 3000);
    return () => clearInterval(interval);
  }, []);

  const getColorClass = (value: number) => {
    if (value > 80) return 'critical';
    if (value > 60) return 'warning';
    return 'normal';
  };

  return (
    <div className="system-content">
      <div className="system-stat">
        <div className="stat-header">
          <span>CPU</span>
          <span className={`stat-percent ${getColorClass(stats.cpu)}`}>{stats.cpu}%</span>
        </div>
        <div className="stat-bar">
          <div className={`stat-fill ${getColorClass(stats.cpu)}`} style={{ width: `${stats.cpu}%` }} />
        </div>
      </div>
      <div className="system-stat">
        <div className="stat-header">
          <span>Memory</span>
          <span className={`stat-percent ${getColorClass(stats.memory)}`}>{stats.memory}%</span>
        </div>
        <div className="stat-bar">
          <div className={`stat-fill ${getColorClass(stats.memory)}`} style={{ width: `${stats.memory}%` }} />
        </div>
      </div>
      <div className="system-stat">
        <div className="stat-header">
          <span>GPU</span>
          <span className={`stat-percent ${getColorClass(stats.gpu)}`}>{stats.gpu}%</span>
        </div>
        <div className="stat-bar">
          <div className={`stat-fill ${getColorClass(stats.gpu)}`} style={{ width: `${stats.gpu}%` }} />
        </div>
      </div>
      <div className="system-stat">
        <div className="stat-header">
          <span>Disk</span>
          <span className={`stat-percent ${getColorClass(stats.disk)}`}>{stats.disk}%</span>
        </div>
        <div className="stat-bar">
          <div className={`stat-fill ${getColorClass(stats.disk)}`} style={{ width: `${stats.disk}%` }} />
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// Quick Actions Widget
// ============================================================================

const QuickActionsWidget: React.FC = () => {
  const actions = [
    { icon: '🎤', label: 'Start Listening', action: 'voice:start' },
    { icon: '📝', label: 'New Note', action: 'notes:new' },
    { icon: '⏰', label: 'Set Timer', action: 'timer:new' },
    { icon: '📸', label: 'Screenshot', action: 'screenshot:take' },
    { icon: '🔍', label: 'Search', action: 'search:open' },
    { icon: '⚙️', label: 'Settings', action: 'settings:open' },
  ];

  const handleAction = async (action: string) => {
    try {
      await window.atlas?.executeAction?.(action);
    } catch (error) {
      console.error('Action failed:', error);
    }
  };

  return (
    <div className="quick-actions-content">
      {actions.map((action, idx) => (
        <button
          key={idx}
          className="quick-action-btn"
          onClick={() => handleAction(action.action)}
        >
          <span className="action-icon">{action.icon}</span>
          <span className="action-label">{action.label}</span>
        </button>
      ))}
    </div>
  );
};

// ============================================================================
// Goals Widget
// ============================================================================

interface Goal {
  id: string;
  title: string;
  progress: number;
  target: number;
  unit: string;
}

const GoalsWidget: React.FC = () => {
  const [goals] = useState<Goal[]>([
    { id: '1', title: 'Daily Steps', progress: 6500, target: 10000, unit: 'steps' },
    { id: '2', title: 'Study Time', progress: 45, target: 60, unit: 'min' },
    { id: '3', title: 'Water Intake', progress: 5, target: 8, unit: 'glasses' },
  ]);

  return (
    <div className="goals-content">
      {goals.map(goal => (
        <div key={goal.id} className="goal-item">
          <div className="goal-header">
            <span className="goal-title">{goal.title}</span>
            <span className="goal-progress">{goal.progress}/{goal.target} {goal.unit}</span>
          </div>
          <div className="goal-bar">
            <div 
              className="goal-fill" 
              style={{ width: `${Math.min(goal.progress / goal.target * 100, 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
};

// ============================================================================
// Widget Wrapper
// ============================================================================

interface WidgetWrapperProps {
  config: WidgetConfig;
  onRemove: () => void;
  onRefresh?: () => void;
  children: React.ReactNode;
}

const WidgetWrapper: React.FC<WidgetWrapperProps> = ({ config, onRemove, onRefresh, children }) => {
  const getIcon = () => {
    switch (config.type) {
      case 'weather': return <CloudIcon className="widget-icon" />;
      case 'calendar': return <CalendarIcon className="widget-icon" />;
      case 'study': return <BookIcon className="widget-icon" />;
      case 'trading': return <TrendingUpIcon className="widget-icon" />;
      case 'system': return <CpuIcon className="widget-icon" />;
      case 'goals': return <TargetIcon className="widget-icon" />;
      case 'spotify': return <MusicIcon className="widget-icon" />;
      case 'quick-actions': return <ZapIcon className="widget-icon" />;
      default: return <GridIcon className="widget-icon" />;
    }
  };

  return (
    <div className={`dashboard-widget size-${config.size}`}>
      <div className="widget-header">
        <div className="widget-title-row">
          {getIcon()}
          <span className="widget-title">{config.title}</span>
        </div>
        <div className="widget-actions">
          {onRefresh && (
            <button className="widget-action-btn" onClick={onRefresh} title="Refresh">
              <RefreshIcon className="action-icon" />
            </button>
          )}
          <button className="widget-action-btn remove" onClick={onRemove} title="Remove">
            <XIcon className="action-icon" />
          </button>
        </div>
      </div>
      <div className="widget-body">
        {children}
      </div>
    </div>
  );
};

// ============================================================================
// Main Dashboard Component
// ============================================================================

export const DashboardWidgets: React.FC<DashboardWidgetsProps> = ({ isVisible, onClose }) => {
  const [widgets, setWidgets] = useState<WidgetConfig[]>([
    { id: 'weather', type: 'weather', title: 'Weather', size: 'small', position: { x: 0, y: 0 }, visible: true },
    { id: 'calendar', type: 'calendar', title: 'Calendar', size: 'medium', position: { x: 1, y: 0 }, visible: true },
    { id: 'study', type: 'study', title: 'Study Progress', size: 'small', position: { x: 0, y: 1 }, visible: true },
    { id: 'system', type: 'system', title: 'System', size: 'small', position: { x: 1, y: 1 }, visible: true },
    { id: 'quick-actions', type: 'quick-actions', title: 'Quick Actions', size: 'medium', position: { x: 2, y: 0 }, visible: true },
    { id: 'goals', type: 'goals', title: 'Goals', size: 'medium', position: { x: 2, y: 1 }, visible: true },
  ]);

  const [showAddMenu, setShowAddMenu] = useState(false);

  const removeWidget = (id: string) => {
    setWidgets(widgets.filter(w => w.id !== id));
  };

  const addWidget = (type: WidgetType) => {
    const titles: Record<WidgetType, string> = {
      weather: 'Weather',
      calendar: 'Calendar',
      study: 'Study Progress',
      trading: 'Trading',
      system: 'System',
      goals: 'Goals',
      spotify: 'Spotify',
      'quick-actions': 'Quick Actions',
    };

    const newWidget: WidgetConfig = {
      id: `${type}-${Date.now()}`,
      type,
      title: titles[type],
      size: 'small',
      position: { x: 0, y: 0 },
      visible: true,
    };

    setWidgets([...widgets, newWidget]);
    setShowAddMenu(false);
  };

  const renderWidget = (config: WidgetConfig) => {
    const handleRefresh = () => {
      // Force re-render by updating widget
      setWidgets(ws => ws.map(w => w.id === config.id ? { ...w } : w));
    };

    let content;
    switch (config.type) {
      case 'weather':
        content = <WeatherWidget onRefresh={handleRefresh} />;
        break;
      case 'calendar':
        content = <CalendarWidget />;
        break;
      case 'study':
        content = <StudyWidget />;
        break;
      case 'system':
        content = <SystemWidget />;
        break;
      case 'quick-actions':
        content = <QuickActionsWidget />;
        break;
      case 'goals':
        content = <GoalsWidget />;
        break;
      default:
        content = <div className="widget-placeholder">Widget: {config.type}</div>;
    }

    return (
      <WidgetWrapper
        key={config.id}
        config={config}
        onRemove={() => removeWidget(config.id)}
        onRefresh={config.type !== 'quick-actions' ? handleRefresh : undefined}
      >
        {content}
      </WidgetWrapper>
    );
  };

  if (!isVisible) return null;

  return (
    <div className="dashboard-overlay">
      <div className="dashboard-container">
        <div className="dashboard-header">
          <div className="dashboard-title-row">
            <GridIcon className="dashboard-icon" />
            <h2 className="dashboard-title">Dashboard</h2>
          </div>
          <div className="dashboard-actions">
            <div className="add-widget-wrapper">
              <button 
                className="add-widget-btn"
                onClick={() => setShowAddMenu(!showAddMenu)}
              >
                + Add Widget
              </button>
              {showAddMenu && (
                <div className="add-widget-menu">
                  <button onClick={() => addWidget('weather')}>Weather</button>
                  <button onClick={() => addWidget('calendar')}>Calendar</button>
                  <button onClick={() => addWidget('study')}>Study Progress</button>
                  <button onClick={() => addWidget('system')}>System Stats</button>
                  <button onClick={() => addWidget('goals')}>Goals</button>
                  <button onClick={() => addWidget('quick-actions')}>Quick Actions</button>
                </div>
              )}
            </div>
            <button className="close-dashboard-btn" onClick={onClose}>
              <XIcon className="close-icon" />
            </button>
          </div>
        </div>

        <div className="widgets-grid">
          {widgets.filter(w => w.visible).map(renderWidget)}
        </div>
      </div>
    </div>
  );
};

export default DashboardWidgets;
