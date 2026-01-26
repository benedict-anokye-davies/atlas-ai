/**
 * Atlas Desktop - Proactive Suggestions UI
 * Smart, context-aware suggestion cards with learning
 */

import React, { useState, useEffect } from 'react';
import './ProactiveSuggestions.css';

// ============================================================================
// Types
// ============================================================================

export type SuggestionPriority = 'urgent' | 'high' | 'medium' | 'low';
export type SuggestionCategory = 'reminder' | 'optimization' | 'learning' | 'health' | 'productivity' | 'system' | 'social';

export interface Suggestion {
  id: string;
  title: string;
  description: string;
  category: SuggestionCategory;
  priority: SuggestionPriority;
  action?: {
    label: string;
    command: string;
    params?: Record<string, unknown>;
  };
  timestamp: number;
  expiresAt?: number;
  source: string;
  dismissed?: boolean;
  snoozedUntil?: number;
}

interface ProactiveSuggestionsProps {
  /** Whether the suggestions panel is visible */
  isVisible?: boolean;
  /** Maximum suggestions to show */
  maxSuggestions?: number;
  /** Position of the panel */
  position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
  /** Callback when panel is closed */
  onClose?: () => void;
}

// ============================================================================
// Icons
// ============================================================================

const LightbulbIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M9 21h6M12 3a6 6 0 0 0-4.24 10.24c.74.74 1.24 1.76 1.24 2.76v1h6v-1c0-1 .5-2.02 1.24-2.76A6 6 0 0 0 12 3z" />
  </svg>
);

const ClockIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);

const CheckIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const XIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const BellIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </svg>
);

const ZapIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </svg>
);

const BookIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
  </svg>
);

const HeartIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
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

const UsersIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

const EyeOffIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
    <line x1="1" y1="1" x2="23" y2="23" />
  </svg>
);

const ChevronDownIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

// ============================================================================
// Suggestion Card Component
// ============================================================================

interface SuggestionCardProps {
  suggestion: Suggestion;
  onAccept: () => void;
  onDismiss: () => void;
  onSnooze: (duration: number) => void;
  onNeverShow: () => void;
}

const SuggestionCard: React.FC<SuggestionCardProps> = ({
  suggestion,
  onAccept,
  onDismiss,
  onSnooze,
  onNeverShow,
}) => {
  const [showSnoozeMenu, setShowSnoozeMenu] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  const getCategoryIcon = () => {
    switch (suggestion.category) {
      case 'reminder': return <BellIcon className="category-icon" />;
      case 'optimization': return <ZapIcon className="category-icon" />;
      case 'learning': return <BookIcon className="category-icon" />;
      case 'health': return <HeartIcon className="category-icon" />;
      case 'productivity': return <LightbulbIcon className="category-icon" />;
      case 'system': return <CpuIcon className="category-icon" />;
      case 'social': return <UsersIcon className="category-icon" />;
      default: return <LightbulbIcon className="category-icon" />;
    }
  };

  const getPriorityClass = () => {
    return `priority-${suggestion.priority}`;
  };

  const getTimeAgo = () => {
    const diff = Date.now() - suggestion.timestamp;
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  const snoozeOptions = [
    { label: '15 minutes', duration: 15 * 60 * 1000 },
    { label: '1 hour', duration: 60 * 60 * 1000 },
    { label: '3 hours', duration: 3 * 60 * 60 * 1000 },
    { label: 'Tomorrow', duration: 24 * 60 * 60 * 1000 },
  ];

  return (
    <div className={`suggestion-card ${getPriorityClass()}`}>
      <div className="suggestion-header">
        <div className="suggestion-category">
          {getCategoryIcon()}
          <span className="category-label">{suggestion.category}</span>
        </div>
        <span className="suggestion-time">{getTimeAgo()}</span>
      </div>

      <div className="suggestion-content">
        <h4 className="suggestion-title">{suggestion.title}</h4>
        <p className={`suggestion-description ${isExpanded ? 'expanded' : ''}`}>
          {suggestion.description}
        </p>
        {suggestion.description.length > 100 && (
          <button 
            className="expand-btn"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            {isExpanded ? 'Show less' : 'Show more'}
            <ChevronDownIcon className={`chevron ${isExpanded ? 'up' : ''}`} />
          </button>
        )}
      </div>

      <div className="suggestion-actions">
        {suggestion.action && (
          <button className="action-btn primary" onClick={onAccept}>
            <CheckIcon className="btn-icon" />
            {suggestion.action.label}
          </button>
        )}
        
        <div className="secondary-actions">
          <div className="snooze-wrapper">
            <button 
              className="action-btn secondary"
              onClick={() => setShowSnoozeMenu(!showSnoozeMenu)}
            >
              <ClockIcon className="btn-icon" />
              Snooze
            </button>
            {showSnoozeMenu && (
              <div className="snooze-menu">
                {snoozeOptions.map(option => (
                  <button 
                    key={option.label}
                    onClick={() => {
                      onSnooze(option.duration);
                      setShowSnoozeMenu(false);
                    }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          
          <button className="action-btn secondary dismiss" onClick={onDismiss}>
            <XIcon className="btn-icon" />
            Dismiss
          </button>
        </div>
      </div>

      <button className="never-show-btn" onClick={onNeverShow}>
        <EyeOffIcon className="btn-icon" />
        Don't suggest this again
      </button>
    </div>
  );
};

// ============================================================================
// Main Component
// ============================================================================

export const ProactiveSuggestions: React.FC<ProactiveSuggestionsProps> = ({
  isVisible = true,
  maxSuggestions = 5,
  position = 'bottom-right',
  onClose,
}) => {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [isMinimized, setIsMinimized] = useState(false);
  const [filter, setFilter] = useState<SuggestionCategory | 'all'>('all');

  // Load suggestions from proactive engine
  useEffect(() => {
    loadSuggestions();
    
    // Subscribe to new suggestions (if API available)
    const atlasAny = window.atlas as unknown as Record<string, unknown>;
    const proactiveApi = atlasAny?.proactive as { onSuggestion?: (cb: (s: unknown) => void) => (() => void) } | undefined;
    
    let unsubscribe: (() => void) | undefined;
    if (proactiveApi && typeof proactiveApi.onSuggestion === 'function') {
      unsubscribe = proactiveApi.onSuggestion((suggestion: unknown) => {
        const typedSuggestion = suggestion as Suggestion;
        setSuggestions(prev => {
          const exists = prev.some(s => s.id === typedSuggestion.id);
          if (exists) return prev;
          return [typedSuggestion, ...prev].slice(0, maxSuggestions);
        });
      });
    }

    return () => {
      unsubscribe?.();
    };
  }, [maxSuggestions]);

  const loadSuggestions = async () => {
    try {
      // Safely access proactive API
      const atlasAny = window.atlas as unknown as Record<string, unknown>;
      const proactiveApi = atlasAny?.proactive as { getSuggestions?: () => Promise<{ success: boolean; data?: Suggestion[] }> } | undefined;
      
      if (proactiveApi && typeof proactiveApi.getSuggestions === 'function') {
        const result = await proactiveApi.getSuggestions();
        if (result?.success && result.data) {
          setSuggestions(result.data.slice(0, maxSuggestions));
          return;
        }
      }
      
      // Fallback to mock data if API not available
      setSuggestions([
        {
          id: '1',
          title: 'Time for a break',
          description: "You've been working for 2 hours straight. Consider taking a 5-minute break to stay productive.",
          category: 'health',
          priority: 'medium',
          action: { label: 'Start break timer', command: 'break:start' },
          timestamp: Date.now() - 5 * 60 * 1000,
          source: 'BreakReminder',
        },
        {
          id: '2',
          title: 'Meeting in 15 minutes',
          description: 'Your "Team Standup" meeting starts at 10:00 AM. Would you like me to prepare a summary of yesterday\'s work?',
          category: 'reminder',
          priority: 'high',
          action: { label: 'Prepare summary', command: 'meeting:prep' },
          timestamp: Date.now() - 2 * 60 * 1000,
          source: 'CalendarIntegration',
        },
        {
          id: '3',
          title: 'Optimize your workflow',
          description: 'I noticed you often switch between VS Code and Chrome. Would you like me to set up a split-screen layout?',
          category: 'optimization',
          priority: 'low',
          action: { label: 'Set up layout', command: 'window:layout' },
          timestamp: Date.now() - 30 * 60 * 1000,
          source: 'WorkflowAnalyzer',
        },
      ]);
    } catch (error) {
      console.error('Failed to load suggestions:', error);
    }
  };

  const handleAccept = async (suggestion: Suggestion) => {
    if (suggestion.action) {
      try {
        // Safely access executeAction
        const atlasAny = window.atlas as unknown as Record<string, unknown>;
        const executeAction = atlasAny?.executeAction as ((cmd: string) => Promise<void>) | undefined;
        if (typeof executeAction === 'function') {
          await executeAction(suggestion.action.command);
        }
        // Record acceptance for learning (if API available)
        const proactiveApi = atlasAny?.proactive as { recordAction?: (id: string, action: string) => Promise<void> } | undefined;
        if (proactiveApi && typeof proactiveApi.recordAction === 'function') {
          await proactiveApi.recordAction(suggestion.id, 'accepted');
        }
      } catch (error) {
        console.error('Action failed:', error);
      }
    }
    setSuggestions(prev => prev.filter(s => s.id !== suggestion.id));
  };

  const handleDismiss = async (suggestion: Suggestion) => {
    try {
      const atlasAny = window.atlas as unknown as Record<string, unknown>;
      const proactiveApi = atlasAny?.proactive as { recordAction?: (id: string, action: string) => Promise<void> } | undefined;
      if (proactiveApi && typeof proactiveApi.recordAction === 'function') {
        await proactiveApi.recordAction(suggestion.id, 'dismissed');
      }
    } catch (error) {
      console.error('Failed to record dismissal:', error);
    }
    setSuggestions(prev => prev.filter(s => s.id !== suggestion.id));
  };

  const handleSnooze = async (suggestion: Suggestion, duration: number) => {
    try {
      const atlasAny = window.atlas as unknown as Record<string, unknown>;
      const proactiveApi = atlasAny?.proactive as { snoozeSuggestion?: (id: string, duration: number) => Promise<void> } | undefined;
      if (proactiveApi && typeof proactiveApi.snoozeSuggestion === 'function') {
        await proactiveApi.snoozeSuggestion(suggestion.id, duration);
      }
    } catch (error) {
      console.error('Failed to snooze suggestion:', error);
    }
    setSuggestions(prev => prev.filter(s => s.id !== suggestion.id));
  };

  const handleNeverShow = async (suggestion: Suggestion) => {
    try {
      const atlasAny = window.atlas as unknown as Record<string, unknown>;
      const proactiveApi = atlasAny?.proactive as { blockSuggestionType?: (id: string, source: string) => Promise<void> } | undefined;
      if (proactiveApi && typeof proactiveApi.blockSuggestionType === 'function') {
        await proactiveApi.blockSuggestionType(suggestion.id, suggestion.source);
      }
    } catch (error) {
      console.error('Failed to block suggestion type:', error);
    }
    setSuggestions(prev => prev.filter(s => s.id !== suggestion.id));
  };

  const filteredSuggestions = suggestions.filter(s => 
    filter === 'all' || s.category === filter
  );

  const urgentCount = suggestions.filter(s => s.priority === 'urgent' || s.priority === 'high').length;

  if (!isVisible) return null;

  return (
    <div className={`proactive-suggestions ${position}`}>
      <div className={`suggestions-panel ${isMinimized ? 'minimized' : ''}`}>
        <div className="panel-header" onClick={() => setIsMinimized(!isMinimized)}>
          <div className="header-left">
            <LightbulbIcon className="header-icon" />
            <span className="header-title">Suggestions</span>
            {urgentCount > 0 && (
              <span className="urgent-badge">{urgentCount}</span>
            )}
          </div>
          <div className="header-actions">
            <button 
              className="minimize-btn"
              onClick={(e) => {
                e.stopPropagation();
                setIsMinimized(!isMinimized);
              }}
            >
              <ChevronDownIcon className={`chevron ${isMinimized ? 'up' : ''}`} />
            </button>
            {onClose && (
              <button className="close-btn" onClick={onClose}>
                <XIcon className="close-icon" />
              </button>
            )}
          </div>
        </div>

        {!isMinimized && (
          <>
            <div className="filter-tabs">
              {(['all', 'reminder', 'health', 'optimization', 'productivity'] as const).map(cat => (
                <button
                  key={cat}
                  className={`filter-tab ${filter === cat ? 'active' : ''}`}
                  onClick={() => setFilter(cat)}
                >
                  {cat === 'all' ? 'All' : cat.charAt(0).toUpperCase() + cat.slice(1)}
                </button>
              ))}
            </div>

            <div className="suggestions-list">
              {filteredSuggestions.length === 0 ? (
                <div className="no-suggestions">
                  <LightbulbIcon className="empty-icon" />
                  <p>No suggestions right now</p>
                  <span>I'll notify you when I have something helpful</span>
                </div>
              ) : (
                filteredSuggestions.map(suggestion => (
                  <SuggestionCard
                    key={suggestion.id}
                    suggestion={suggestion}
                    onAccept={() => handleAccept(suggestion)}
                    onDismiss={() => handleDismiss(suggestion)}
                    onSnooze={(duration) => handleSnooze(suggestion, duration)}
                    onNeverShow={() => handleNeverShow(suggestion)}
                  />
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default ProactiveSuggestions;
