/**
 * Atlas Desktop - Activity Timeline
 * Visual timeline of all Atlas activities and interactions
 */

import React, { useState, useEffect, useMemo } from 'react';
import './ActivityTimeline.css';

// ============================================================================
// Types
// ============================================================================

type ActivityType = 
  | 'voice-command' 
  | 'tool-execution' 
  | 'system-event' 
  | 'notification' 
  | 'error' 
  | 'reminder'
  | 'automation';

interface Activity {
  id: string;
  type: ActivityType;
  title: string;
  description?: string;
  timestamp: number;
  duration?: number;
  status?: 'success' | 'error' | 'pending';
  metadata?: Record<string, unknown>;
}

interface ActivityTimelineProps {
  isVisible: boolean;
  onClose: () => void;
}

// ============================================================================
// Icons
// ============================================================================

const TimelineIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="12" y1="2" x2="12" y2="22" />
    <circle cx="12" cy="6" r="3" />
    <circle cx="12" cy="12" r="3" />
    <circle cx="12" cy="18" r="3" />
  </svg>
);

const XIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const MicIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
  </svg>
);

const ToolIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
  </svg>
);

const SystemIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

const BellIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </svg>
);

const AlertIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="8" x2="12" y2="12" />
    <line x1="12" y1="16" x2="12.01" y2="16" />
  </svg>
);

const ClockIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);

const ZapIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </svg>
);

const FilterIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
  </svg>
);

// ============================================================================
// Helpers
// ============================================================================

const getActivityIcon = (type: ActivityType): React.ReactNode => {
  switch (type) {
    case 'voice-command': return <MicIcon className="activity-icon" />;
    case 'tool-execution': return <ToolIcon className="activity-icon" />;
    case 'system-event': return <SystemIcon className="activity-icon" />;
    case 'notification': return <BellIcon className="activity-icon" />;
    case 'error': return <AlertIcon className="activity-icon" />;
    case 'reminder': return <ClockIcon className="activity-icon" />;
    case 'automation': return <ZapIcon className="activity-icon" />;
    default: return <TimelineIcon className="activity-icon" />;
  }
};

const getActivityColor = (type: ActivityType): string => {
  switch (type) {
    case 'voice-command': return '#8b5cf6';
    case 'tool-execution': return '#3b82f6';
    case 'system-event': return '#6b7280';
    case 'notification': return '#fbbf24';
    case 'error': return '#ef4444';
    case 'reminder': return '#f97316';
    case 'automation': return '#10b981';
    default: return '#6b7280';
  }
};

const formatTimeAgo = (timestamp: number): string => {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return new Date(timestamp).toLocaleDateString();
};

const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
};

// ============================================================================
// Main Component
// ============================================================================

export const ActivityTimeline: React.FC<ActivityTimelineProps> = ({ isVisible, onClose }) => {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [filter, setFilter] = useState<ActivityType | 'all'>('all');
  const [isLoading, setIsLoading] = useState(true);

  // Load activities
  useEffect(() => {
    if (!isVisible) return;

    const loadActivities = async () => {
      setIsLoading(true);
      try {
        // Try conversation history as activity source
        const historyResult = await window.atlas?.atlas?.getConversationHistory?.(50);
        if (historyResult?.success && historyResult.data) {
          const history = historyResult.data as Array<{
            id?: string;
            role?: string;
            content?: string;
            timestamp?: number;
            toolsUsed?: string[];
          }>;
          
          const activities: Activity[] = history.map((msg, idx) => {
            if (msg.role === 'user') {
              return {
                id: msg.id || `activity-${idx}`,
                type: 'voice-command' as ActivityType,
                title: `Voice command: "${(msg.content || '').slice(0, 50)}${(msg.content?.length || 0) > 50 ? '...' : ''}"`,
                description: msg.content,
                timestamp: msg.timestamp || Date.now() - (idx * 60000),
                status: 'success' as const,
              };
            } else if (msg.toolsUsed && msg.toolsUsed.length > 0) {
              return {
                id: msg.id || `activity-${idx}`,
                type: 'tool-execution' as ActivityType,
                title: `Executed: ${msg.toolsUsed.join(', ')}`,
                description: (msg.content || '').slice(0, 100),
                timestamp: msg.timestamp || Date.now() - (idx * 60000),
                status: 'success' as const,
              };
            } else {
              return {
                id: msg.id || `activity-${idx}`,
                type: 'system-event' as ActivityType,
                title: 'Assistant response',
                description: (msg.content || '').slice(0, 100),
                timestamp: msg.timestamp || Date.now() - (idx * 60000),
                status: 'success' as const,
              };
            }
          });
          
          setActivities(activities);
          setIsLoading(false);
          return;
        }

        // Fall back to localStorage
        const stored = localStorage.getItem('atlas:activity-timeline');
        if (stored) {
          setActivities(JSON.parse(stored));
        } else {
          // No data available
          setActivities([]);
        }
      } catch (error) {
        console.error('[ActivityTimeline] Failed to load activities:', error);
        // Fall back to localStorage
        const stored = localStorage.getItem('atlas:activity-timeline');
        if (stored) {
          setActivities(JSON.parse(stored));
        } else {
          setActivities([]);
        }
      } finally {
        setIsLoading(false);
      }
    };

    loadActivities();
  }, [isVisible]);

  // Filter activities
  const filteredActivities = useMemo(() => {
    if (filter === 'all') return activities;
    return activities.filter(a => a.type === filter);
  }, [activities, filter]);

  // Group by day
  const groupedActivities = useMemo(() => {
    const groups: { [key: string]: Activity[] } = {};
    
    filteredActivities.forEach(activity => {
      const date = new Date(activity.timestamp);
      const key = date.toDateString();
      if (!groups[key]) groups[key] = [];
      groups[key].push(activity);
    });

    return Object.entries(groups).map(([date, items]) => ({
      date,
      activities: items.sort((a, b) => b.timestamp - a.timestamp),
    }));
  }, [filteredActivities]);

  // Stats
  const stats = useMemo(() => {
    const today = new Date().setHours(0, 0, 0, 0);
    const todayActivities = activities.filter(a => a.timestamp >= today);
    return {
      total: activities.length,
      today: todayActivities.length,
      voiceCommands: activities.filter(a => a.type === 'voice-command').length,
      automations: activities.filter(a => a.type === 'automation').length,
    };
  }, [activities]);

  if (!isVisible) return null;

  return (
    <div className="activity-timeline-overlay">
      <div className="activity-timeline-container">
        {/* Header */}
        <div className="at-header">
          <div className="at-title-row">
            <TimelineIcon className="at-icon" />
            <h2>Activity Timeline</h2>
          </div>
          <button className="at-close" onClick={onClose}>
            <XIcon />
          </button>
        </div>

        {/* Stats */}
        <div className="at-stats">
          <div className="stat-item">
            <span className="stat-value">{stats.today}</span>
            <span className="stat-label">Today</span>
          </div>
          <div className="stat-item">
            <span className="stat-value">{stats.voiceCommands}</span>
            <span className="stat-label">Voice</span>
          </div>
          <div className="stat-item">
            <span className="stat-value">{stats.automations}</span>
            <span className="stat-label">Auto</span>
          </div>
          <div className="stat-item">
            <span className="stat-value">{stats.total}</span>
            <span className="stat-label">Total</span>
          </div>
        </div>

        {/* Filter */}
        <div className="at-filter">
          <FilterIcon className="filter-icon" />
          <select value={filter} onChange={(e) => setFilter(e.target.value as ActivityType | 'all')}>
            <option value="all">All Activities</option>
            <option value="voice-command">Voice Commands</option>
            <option value="tool-execution">Tool Executions</option>
            <option value="automation">Automations</option>
            <option value="notification">Notifications</option>
            <option value="reminder">Reminders</option>
            <option value="error">Errors</option>
            <option value="system-event">System Events</option>
          </select>
        </div>

        {/* Timeline */}
        <div className="at-content">
          {isLoading ? (
            <div className="at-loading">Loading activities...</div>
          ) : groupedActivities.length === 0 ? (
            <div className="at-empty">
              <TimelineIcon className="empty-icon" />
              <p>No activities yet</p>
              <span>Your Atlas activities will appear here</span>
            </div>
          ) : (
            <div className="at-timeline">
              {groupedActivities.map(group => (
                <div key={group.date} className="timeline-group">
                  <div className="group-header">
                    <span className="group-date">
                      {new Date(group.date).toDateString() === new Date().toDateString() 
                        ? 'Today' 
                        : new Date(group.date).toLocaleDateString(undefined, { 
                            weekday: 'long', 
                            month: 'short', 
                            day: 'numeric' 
                          })
                      }
                    </span>
                    <span className="group-count">{group.activities.length} activities</span>
                  </div>

                  <div className="timeline-items">
                    {group.activities.map((activity, index) => (
                      <div 
                        key={activity.id} 
                        className={`timeline-item ${activity.status || ''}`}
                        style={{ '--activity-color': getActivityColor(activity.type) } as React.CSSProperties}
                      >
                        <div className="item-line">
                          <div className="item-dot" />
                          {index < group.activities.length - 1 && <div className="item-connector" />}
                        </div>

                        <div className="item-content">
                          <div className="item-header">
                            <div className="item-icon-wrap" style={{ backgroundColor: `${getActivityColor(activity.type)}20` }}>
                              {getActivityIcon(activity.type)}
                            </div>
                            <div className="item-info">
                              <span className="item-title">{activity.title}</span>
                              <span className="item-time">{formatTimeAgo(activity.timestamp)}</span>
                            </div>
                          </div>
                          
                          {activity.description && (
                            <p className="item-description">{activity.description}</p>
                          )}

                          <div className="item-meta">
                            {activity.duration && (
                              <span className="meta-tag duration">
                                <ClockIcon className="meta-icon" />
                                {formatDuration(activity.duration)}
                              </span>
                            )}
                            {activity.status && (
                              <span className={`meta-tag status-${activity.status}`}>
                                {activity.status}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ActivityTimeline;
