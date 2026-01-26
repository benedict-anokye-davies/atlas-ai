/**
 * WellnessPanel Component
 * 
 * Dashboard component displaying developer health metrics including
 * screen time, break tracking, productivity scores, and suggestions.
 */

import React, { useState, useEffect, useCallback } from 'react';
import './WellnessPanel.css';

// ============================================================================
// Types
// ============================================================================

interface WellnessSummary {
  session: {
    duration: number;
    activeTime: number;
    keystrokes: number;
    breaks: number;
  } | null;
  today: {
    screenTime: number;
    focusTime: number;
    breaks: number;
    breakScore: number;
    paceScore: number;
  } | null;
  breakStatus: {
    status: string;
    nextBreak: { type: string; in: number } | null;
    shouldTakeBreak: boolean;
    urgency: string;
  };
}

interface BreakSuggestion {
  type: string;
  activity: string;
  duration: string;
  benefit: string;
  icon?: string;
}

interface WellnessPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

// ============================================================================
// Helper Functions
// ============================================================================

function formatDuration(ms: number): string {
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

function formatTimeUntil(ms: number): string {
  if (ms < 0) return 'now';
  
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return 'less than 1m';
  if (minutes < 60) return `${minutes}m`;
  
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

function getScoreColor(score: number): string {
  if (score >= 80) return '#22c55e'; // Green
  if (score >= 60) return '#eab308'; // Yellow
  if (score >= 40) return '#f97316'; // Orange
  return '#ef4444'; // Red
}

function getUrgencyColor(urgency: string): string {
  switch (urgency) {
    case 'high': return '#ef4444';
    case 'medium': return '#f97316';
    case 'low': return '#eab308';
    default: return '#22c55e';
  }
}

// ============================================================================
// Sub-Components
// ============================================================================

const ScoreRing: React.FC<{ score: number; label: string; size?: number }> = ({
  score,
  label,
  size = 80,
}) => {
  const strokeWidth = 8;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const color = getScoreColor(score);

  return (
    <div className="score-ring-container">
      <svg width={size} height={size} className="score-ring">
        <circle
          className="score-ring-background"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
        />
        <circle
          className="score-ring-progress"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
          stroke={color}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.5s ease' }}
        />
      </svg>
      <div className="score-ring-content">
        <span className="score-value" style={{ color }}>{score}</span>
      </div>
      <span className="score-label">{label}</span>
    </div>
  );
};

const StatCard: React.FC<{ icon: string; label: string; value: string; subtext?: string }> = ({
  icon,
  label,
  value,
  subtext,
}) => (
  <div className="stat-card">
    <span className="stat-icon">{icon}</span>
    <div className="stat-content">
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
      {subtext && <span className="stat-subtext">{subtext}</span>}
    </div>
  </div>
);

const BreakAlert: React.FC<{
  shouldTakeBreak: boolean;
  urgency: string;
  nextBreak: { type: string; in: number } | null;
  onTakeBreak: () => void;
  onSnooze: () => void;
}> = ({ shouldTakeBreak, urgency, nextBreak, onTakeBreak, onSnooze }) => {
  if (!shouldTakeBreak) {
    return (
      <div className="break-alert break-alert-ok">
        <span className="break-icon">✓</span>
        <div className="break-content">
          <span className="break-title">You're doing great!</span>
          {nextBreak && (
            <span className="break-next">
              Next {nextBreak.type} break in {formatTimeUntil(nextBreak.in)}
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`break-alert break-alert-${urgency}`}>
      <span className="break-icon" style={{ color: getUrgencyColor(urgency) }}>
        {urgency === 'high' ? '⚠️' : urgency === 'medium' ? '⏰' : '💡'}
      </span>
      <div className="break-content">
        <span className="break-title">
          {urgency === 'high' ? 'Break overdue!' : 
           urgency === 'medium' ? 'Break recommended' : 'Consider a break soon'}
        </span>
        <span className="break-message">
          Taking regular breaks improves focus and prevents fatigue
        </span>
      </div>
      <div className="break-actions">
        <button className="break-btn break-btn-primary" onClick={onTakeBreak}>
          Take Break
        </button>
        <button className="break-btn break-btn-secondary" onClick={onSnooze}>
          Snooze
        </button>
      </div>
    </div>
  );
};

const BreakSuggestionCard: React.FC<{ suggestion: BreakSuggestion }> = ({ suggestion }) => (
  <div className="suggestion-card">
    <span className="suggestion-icon">{suggestion.icon || '💡'}</span>
    <div className="suggestion-content">
      <span className="suggestion-activity">{suggestion.activity}</span>
      <span className="suggestion-meta">
        {suggestion.duration} • {suggestion.benefit}
      </span>
    </div>
  </div>
);

// ============================================================================
// Main Component
// ============================================================================

export const WellnessPanel: React.FC<WellnessPanelProps> = ({ isOpen, onClose }) => {
  const [summary, setSummary] = useState<WellnessSummary | null>(null);
  const [suggestions, setSuggestions] = useState<BreakSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'history' | 'settings'>('overview');

  const fetchWellnessData = useCallback(async () => {
    try {
      // Access wellness API through dynamic window.atlas
      const atlasAny = window.atlas as unknown as Record<string, unknown>;
      
      if (atlasAny?.wellness && typeof atlasAny.wellness === 'object') {
        const wellnessApi = atlasAny.wellness as {
          getSummary?: () => Promise<{ success: boolean; data?: WellnessSummary }>;
          getBreakSuggestions?: (type: string) => Promise<{ success: boolean; data?: BreakSuggestion[] }>;
        };
        
        if (wellnessApi.getSummary) {
          const summaryResult = await wellnessApi.getSummary();
          if (summaryResult.success && summaryResult.data) {
            setSummary(summaryResult.data);
          }
        }
        
        if (wellnessApi.getBreakSuggestions) {
          const suggestionsResult = await wellnessApi.getBreakSuggestions('short');
          if (suggestionsResult.success && suggestionsResult.data) {
            setSuggestions(suggestionsResult.data);
          }
        }
      } else {
        // Fallback mock data for development
        setSummary({
          session: {
            duration: 5400000, // 1.5 hours
            activeTime: 4800000,
            keystrokes: 12500,
            breaks: 2,
          },
          today: {
            screenTime: 21600000, // 6 hours
            focusTime: 14400000, // 4 hours
            breaks: 5,
            breakScore: 72,
            paceScore: 68,
          },
          breakStatus: {
            status: 'active',
            nextBreak: { type: 'micro', in: 900000 }, // 15 minutes
            shouldTakeBreak: false,
            urgency: 'low',
          },
        });
        
        setSuggestions([
          { type: 'short', activity: 'Stand up and stretch', duration: '2-3 minutes', benefit: 'Improves circulation', icon: '🧘' },
          { type: 'short', activity: 'Walk to get water', duration: '3-5 minutes', benefit: 'Hydration + movement', icon: '💧' },
          { type: 'short', activity: 'Do desk exercises', duration: '5 minutes', benefit: 'Reduces sedentary harm', icon: '💪' },
        ]);
      }
      
      setIsLoading(false);
    } catch (err) {
      setError('Failed to load wellness data');
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchWellnessData();
      
      // Refresh data periodically
      const interval = setInterval(fetchWellnessData, 30000);
      return () => clearInterval(interval);
    }
    return undefined;
  }, [isOpen, fetchWellnessData]);

  const handleTakeBreak = async () => {
    const atlasAny = window.atlas as unknown as Record<string, unknown>;
    if (atlasAny?.wellness && typeof atlasAny.wellness === 'object') {
      const wellnessApi = atlasAny.wellness as { takeBreak?: () => Promise<void> };
      await wellnessApi.takeBreak?.();
    }
    fetchWellnessData();
  };

  const handleSnooze = async () => {
    const atlasAny = window.atlas as unknown as Record<string, unknown>;
    if (atlasAny?.wellness && typeof atlasAny.wellness === 'object') {
      const wellnessApi = atlasAny.wellness as { snoozeBreak?: () => Promise<void> };
      await wellnessApi.snoozeBreak?.();
    }
    fetchWellnessData();
  };

  if (!isOpen) return null;

  return (
    <div className="wellness-panel-overlay" onClick={onClose}>
      <div className="wellness-panel" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="wellness-header">
          <h2>Wellness Dashboard</h2>
          <button className="wellness-close" onClick={onClose}>×</button>
        </div>

        {/* Tabs */}
        <div className="wellness-tabs">
          <button
            className={`wellness-tab ${activeTab === 'overview' ? 'active' : ''}`}
            onClick={() => setActiveTab('overview')}
          >
            Overview
          </button>
          <button
            className={`wellness-tab ${activeTab === 'history' ? 'active' : ''}`}
            onClick={() => setActiveTab('history')}
          >
            History
          </button>
          <button
            className={`wellness-tab ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveTab('settings')}
          >
            Settings
          </button>
        </div>

        {/* Content */}
        <div className="wellness-content">
          {isLoading && (
            <div className="wellness-loading">
              <div className="spinner"></div>
              <span>Loading wellness data...</span>
            </div>
          )}

          {error && (
            <div className="wellness-error">
              <span>⚠️ {error}</span>
              <button onClick={fetchWellnessData}>Retry</button>
            </div>
          )}

          {!isLoading && !error && summary && activeTab === 'overview' && (
            <>
              {/* Break Alert */}
              <BreakAlert
                shouldTakeBreak={summary.breakStatus.shouldTakeBreak}
                urgency={summary.breakStatus.urgency}
                nextBreak={summary.breakStatus.nextBreak}
                onTakeBreak={handleTakeBreak}
                onSnooze={handleSnooze}
              />

              {/* Scores */}
              <div className="wellness-section">
                <h3>Health Scores</h3>
                <div className="scores-grid">
                  <ScoreRing
                    score={summary.today?.breakScore || 0}
                    label="Break Score"
                  />
                  <ScoreRing
                    score={summary.today?.paceScore || 0}
                    label="Pace Score"
                  />
                </div>
              </div>

              {/* Current Session */}
              {summary.session && (
                <div className="wellness-section">
                  <h3>Current Session</h3>
                  <div className="stats-grid">
                    <StatCard
                      icon="⏱️"
                      label="Duration"
                      value={formatDuration(summary.session.duration)}
                    />
                    <StatCard
                      icon="⌨️"
                      label="Keystrokes"
                      value={summary.session.keystrokes.toLocaleString()}
                    />
                    <StatCard
                      icon="☕"
                      label="Breaks"
                      value={summary.session.breaks.toString()}
                    />
                  </div>
                </div>
              )}

              {/* Today's Stats */}
              {summary.today && (
                <div className="wellness-section">
                  <h3>Today</h3>
                  <div className="stats-grid">
                    <StatCard
                      icon="🖥️"
                      label="Screen Time"
                      value={formatDuration(summary.today.screenTime)}
                    />
                    <StatCard
                      icon="🎯"
                      label="Focus Time"
                      value={formatDuration(summary.today.focusTime)}
                    />
                    <StatCard
                      icon="☕"
                      label="Total Breaks"
                      value={summary.today.breaks.toString()}
                    />
                  </div>
                </div>
              )}

              {/* Break Suggestions */}
              {suggestions.length > 0 && (
                <div className="wellness-section">
                  <h3>Break Ideas</h3>
                  <div className="suggestions-list">
                    {suggestions.map((suggestion, index) => (
                      <BreakSuggestionCard key={index} suggestion={suggestion} />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {activeTab === 'history' && (
            <div className="wellness-section">
              <h3>Activity History</h3>
              <p className="placeholder-text">
                Historical wellness data will be displayed here.
                Track your progress over days and weeks.
              </p>
            </div>
          )}

          {activeTab === 'settings' && (
            <div className="wellness-section">
              <h3>Break Settings</h3>
              <div className="settings-list">
                <label className="setting-item">
                  <span>Enable micro-breaks (20-20-20 rule)</span>
                  <input type="checkbox" defaultChecked />
                </label>
                <label className="setting-item">
                  <span>Enable short breaks (hourly)</span>
                  <input type="checkbox" defaultChecked />
                </label>
                <label className="setting-item">
                  <span>Enable long breaks (every 4 hours)</span>
                  <input type="checkbox" defaultChecked />
                </label>
                <label className="setting-item">
                  <span>Sound notifications</span>
                  <input type="checkbox" defaultChecked />
                </label>
                <label className="setting-item">
                  <span>Respect focus mode</span>
                  <input type="checkbox" defaultChecked />
                </label>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default WellnessPanel;
