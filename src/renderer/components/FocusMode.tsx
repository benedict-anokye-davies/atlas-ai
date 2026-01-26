/**
 * Atlas Desktop - Focus Mode / Pomodoro Timer
 * Productivity timer with DND integration and session tracking
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import './FocusMode.css';

// ============================================================================
// Types
// ============================================================================

interface FocusSession {
  id: string;
  startTime: number;
  endTime?: number;
  duration: number;
  type: 'focus' | 'short-break' | 'long-break';
  completed: boolean;
  task?: string;
}

interface FocusSettings {
  focusDuration: number; // minutes
  shortBreakDuration: number;
  longBreakDuration: number;
  sessionsBeforeLongBreak: number;
  autoStartBreaks: boolean;
  autoStartFocus: boolean;
  enableDND: boolean;
  enableSounds: boolean;
  enableNotifications: boolean;
}

interface FocusModeProps {
  isVisible: boolean;
  onClose: () => void;
}

type TimerState = 'idle' | 'focus' | 'short-break' | 'long-break' | 'paused';

// ============================================================================
// Icons
// ============================================================================

const PlayIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <polygon points="5 3 19 12 5 21 5 3" />
  </svg>
);

const PauseIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <rect x="6" y="4" width="4" height="16" />
    <rect x="14" y="4" width="4" height="16" />
  </svg>
);

const StopIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <rect x="4" y="4" width="16" height="16" rx="2" />
  </svg>
);

const SkipIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <polygon points="5 4 15 12 5 20 5 4" />
    <line x1="19" y1="5" x2="19" y2="19" stroke="currentColor" strokeWidth="2" />
  </svg>
);

const SettingsIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

const XIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const CoffeeIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M18 8h1a4 4 0 0 1 0 8h-1" />
    <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z" />
    <line x1="6" y1="1" x2="6" y2="4" />
    <line x1="10" y1="1" x2="10" y2="4" />
    <line x1="14" y1="1" x2="14" y2="4" />
  </svg>
);

const TargetIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="10" />
    <circle cx="12" cy="12" r="6" />
    <circle cx="12" cy="12" r="2" />
  </svg>
);

const HistoryIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);

// ============================================================================
// Default Settings
// ============================================================================

const DEFAULT_SETTINGS: FocusSettings = {
  focusDuration: 25,
  shortBreakDuration: 5,
  longBreakDuration: 15,
  sessionsBeforeLongBreak: 4,
  autoStartBreaks: false,
  autoStartFocus: false,
  enableDND: true,
  enableSounds: true,
  enableNotifications: true,
};

// ============================================================================
// Main Component
// ============================================================================

export const FocusMode: React.FC<FocusModeProps> = ({ isVisible, onClose }) => {
  const [settings, setSettings] = useState<FocusSettings>(DEFAULT_SETTINGS);
  const [timerState, setTimerState] = useState<TimerState>('idle');
  const [timeRemaining, setTimeRemaining] = useState(25 * 60); // seconds
  const [completedSessions, setCompletedSessions] = useState(0);
  const [currentTask, setCurrentTask] = useState('');
  const [sessions, setSessions] = useState<FocusSession[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const sessionStartRef = useRef<number>(0);
  const pausedStateRef = useRef<TimerState>('idle');

  // Load settings from localStorage
  useEffect(() => {
    const stored = localStorage.getItem('atlas:focus-settings');
    if (stored) {
      setSettings(JSON.parse(stored));
    }
    const storedSessions = localStorage.getItem('atlas:focus-sessions');
    if (storedSessions) {
      setSessions(JSON.parse(storedSessions));
    }
  }, []);

  // Save settings
  const saveSettings = useCallback((newSettings: FocusSettings) => {
    setSettings(newSettings);
    localStorage.setItem('atlas:focus-settings', JSON.stringify(newSettings));
  }, []);

  // Format time as MM:SS
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Get duration for current state
  const getDuration = useCallback((state: TimerState): number => {
    switch (state) {
      case 'focus': return settings.focusDuration * 60;
      case 'short-break': return settings.shortBreakDuration * 60;
      case 'long-break': return settings.longBreakDuration * 60;
      default: return settings.focusDuration * 60;
    }
  }, [settings]);

  // Play notification sound
  const playSound = useCallback((type: 'start' | 'complete' | 'break') => {
    if (!settings.enableSounds) return;
    // Use system notification sound or custom audio
    const audio = new Audio();
    audio.src = type === 'complete' 
      ? 'data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2teleVEjYaHF+vS0OQFBp9n0/8dHAEOq3P//vUIAP6TV8P+9SABBps/o/7dPAD2gxOD/sVcAO5y73/+rXwA5l7Hc/6ZnADeTqNr/oG8AN4+f1/+adwA1jJbT/5R/ADSIjM7/j4cAMoSCyf+JjwAygHnE/4SWAC58b7//f50AKnhl...'
      : 'data:audio/wav;base64,UklGRjIAAABXQVZFZm10IBIAAAABAAEAQB8AAEAfAAABAAgAAABmYWN0BAAAAAAAAABkYXRhAAAAAA==';
    audio.volume = 0.5;
    audio.play().catch(() => {});
  }, [settings.enableSounds]);

  // Show notification
  const showNotification = useCallback((title: string, body: string) => {
    if (!settings.enableNotifications) return;
    if (Notification.permission === 'granted') {
      new Notification(title, { body, icon: '/icon.png' });
    }
  }, [settings.enableNotifications]);

  // Toggle DND mode
  const toggleDND = useCallback(async (enable: boolean) => {
    if (!settings.enableDND) return;
    try {
      // setDND is not exposed in current API - would need IPC implementation
      const systemAny = window.atlas?.system as unknown as Record<string, unknown> | undefined;
      if (systemAny?.setDND && typeof systemAny.setDND === 'function') {
        await (systemAny.setDND as (enable: boolean) => Promise<void>)(enable);
      }
    } catch (error) {
      console.error('Failed to toggle DND:', error);
    }
  }, [settings.enableDND]);

  // Start timer
  const startTimer = useCallback((type: TimerState = 'focus') => {
    if (type === 'idle' || type === 'paused') return;
    
    const duration = getDuration(type);
    setTimeRemaining(duration);
    setTimerState(type);
    sessionStartRef.current = Date.now();
    
    if (type === 'focus') {
      toggleDND(true);
      playSound('start');
    } else {
      playSound('break');
    }

    timerRef.current = setInterval(() => {
      setTimeRemaining(prev => {
        if (prev <= 1) {
          // Timer complete
          clearInterval(timerRef.current!);
          handleTimerComplete(type);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [getDuration, toggleDND, playSound]);

  // Handle timer completion
  const handleTimerComplete = useCallback((completedType: TimerState) => {
    playSound('complete');
    toggleDND(false);
    
    // Save session
    const session: FocusSession = {
      id: `session-${Date.now()}`,
      startTime: sessionStartRef.current,
      endTime: Date.now(),
      duration: getDuration(completedType),
      type: completedType as 'focus' | 'short-break' | 'long-break',
      completed: true,
      task: currentTask || undefined,
    };
    
    const newSessions = [session, ...sessions].slice(0, 100);
    setSessions(newSessions);
    localStorage.setItem('atlas:focus-sessions', JSON.stringify(newSessions));

    if (completedType === 'focus') {
      const newCompleted = completedSessions + 1;
      setCompletedSessions(newCompleted);
      
      showNotification('Focus Session Complete!', 'Great work! Time for a break.');
      
      // Auto-start break if enabled
      if (settings.autoStartBreaks) {
        const breakType = newCompleted % settings.sessionsBeforeLongBreak === 0 
          ? 'long-break' 
          : 'short-break';
        startTimer(breakType);
      } else {
        setTimerState('idle');
        setTimeRemaining(getDuration('focus'));
      }
    } else {
      showNotification('Break Over!', 'Ready to focus again?');
      
      // Auto-start focus if enabled
      if (settings.autoStartFocus) {
        startTimer('focus');
      } else {
        setTimerState('idle');
        setTimeRemaining(getDuration('focus'));
      }
    }
  }, [completedSessions, currentTask, getDuration, playSound, sessions, settings, showNotification, startTimer, toggleDND]);

  // Pause timer
  const pauseTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    pausedStateRef.current = timerState;
    setTimerState('paused');
  }, [timerState]);

  // Resume timer
  const resumeTimer = useCallback(() => {
    setTimerState(pausedStateRef.current);
    timerRef.current = setInterval(() => {
      setTimeRemaining(prev => {
        if (prev <= 1) {
          clearInterval(timerRef.current!);
          handleTimerComplete(pausedStateRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [handleTimerComplete]);

  // Stop timer
  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    toggleDND(false);
    setTimerState('idle');
    setTimeRemaining(getDuration('focus'));
  }, [getDuration, toggleDND]);

  // Skip to next
  const skipToNext = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    
    if (timerState === 'focus') {
      const newCompleted = completedSessions + 1;
      setCompletedSessions(newCompleted);
      const breakType = newCompleted % settings.sessionsBeforeLongBreak === 0 
        ? 'long-break' 
        : 'short-break';
      startTimer(breakType);
    } else {
      startTimer('focus');
    }
  }, [completedSessions, settings.sessionsBeforeLongBreak, startTimer, timerState]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, []);

  // Get progress percentage
  const progress = timerState !== 'idle' && timerState !== 'paused'
    ? ((getDuration(timerState) - timeRemaining) / getDuration(timerState)) * 100
    : 0;

  // Get state label
  const getStateLabel = (): string => {
    switch (timerState) {
      case 'focus': return 'Focus Time';
      case 'short-break': return 'Short Break';
      case 'long-break': return 'Long Break';
      case 'paused': return 'Paused';
      default: return 'Ready to Focus';
    }
  };

  // Today's stats
  const todaysSessions = sessions.filter(s => {
    const today = new Date();
    const sessionDate = new Date(s.startTime);
    return sessionDate.toDateString() === today.toDateString() && s.type === 'focus';
  });
  const todaysFocusTime = todaysSessions.reduce((acc, s) => acc + s.duration, 0);

  if (!isVisible) return null;

  return (
    <div className="focus-overlay">
      <div className="focus-container">
        {/* Header */}
        <div className="focus-header">
          <div className="header-title-row">
            <TargetIcon className="header-icon" />
            <h2 className="header-title">Focus Mode</h2>
          </div>
          <div className="header-actions">
            <button 
              className="icon-btn"
              onClick={() => setShowHistory(!showHistory)}
              title="Session History"
            >
              <HistoryIcon className="btn-icon" />
            </button>
            <button 
              className="icon-btn"
              onClick={() => setShowSettings(!showSettings)}
              title="Settings"
            >
              <SettingsIcon className="btn-icon" />
            </button>
            <button className="close-btn" onClick={onClose}>
              <XIcon className="close-icon" />
            </button>
          </div>
        </div>

        {/* Main Content */}
        <div className="focus-content">
          {showSettings ? (
            /* Settings Panel */
            <div className="focus-settings">
              <h3>Timer Settings</h3>
              
              <div className="setting-group">
                <label>Focus Duration (minutes)</label>
                <input 
                  type="number" 
                  value={settings.focusDuration}
                  onChange={(e) => saveSettings({ ...settings, focusDuration: parseInt(e.target.value) || 25 })}
                  min={1}
                  max={120}
                />
              </div>

              <div className="setting-group">
                <label>Short Break (minutes)</label>
                <input 
                  type="number" 
                  value={settings.shortBreakDuration}
                  onChange={(e) => saveSettings({ ...settings, shortBreakDuration: parseInt(e.target.value) || 5 })}
                  min={1}
                  max={30}
                />
              </div>

              <div className="setting-group">
                <label>Long Break (minutes)</label>
                <input 
                  type="number" 
                  value={settings.longBreakDuration}
                  onChange={(e) => saveSettings({ ...settings, longBreakDuration: parseInt(e.target.value) || 15 })}
                  min={1}
                  max={60}
                />
              </div>

              <div className="setting-group">
                <label>Sessions before Long Break</label>
                <input 
                  type="number" 
                  value={settings.sessionsBeforeLongBreak}
                  onChange={(e) => saveSettings({ ...settings, sessionsBeforeLongBreak: parseInt(e.target.value) || 4 })}
                  min={1}
                  max={10}
                />
              </div>

              <div className="setting-toggle">
                <label>Auto-start Breaks</label>
                <input 
                  type="checkbox" 
                  checked={settings.autoStartBreaks}
                  onChange={(e) => saveSettings({ ...settings, autoStartBreaks: e.target.checked })}
                />
              </div>

              <div className="setting-toggle">
                <label>Auto-start Focus</label>
                <input 
                  type="checkbox" 
                  checked={settings.autoStartFocus}
                  onChange={(e) => saveSettings({ ...settings, autoStartFocus: e.target.checked })}
                />
              </div>

              <div className="setting-toggle">
                <label>Enable Do Not Disturb</label>
                <input 
                  type="checkbox" 
                  checked={settings.enableDND}
                  onChange={(e) => saveSettings({ ...settings, enableDND: e.target.checked })}
                />
              </div>

              <div className="setting-toggle">
                <label>Enable Sounds</label>
                <input 
                  type="checkbox" 
                  checked={settings.enableSounds}
                  onChange={(e) => saveSettings({ ...settings, enableSounds: e.target.checked })}
                />
              </div>

              <div className="setting-toggle">
                <label>Enable Notifications</label>
                <input 
                  type="checkbox" 
                  checked={settings.enableNotifications}
                  onChange={(e) => saveSettings({ ...settings, enableNotifications: e.target.checked })}
                />
              </div>

              <button className="back-btn" onClick={() => setShowSettings(false)}>
                Back to Timer
              </button>
            </div>
          ) : showHistory ? (
            /* History Panel */
            <div className="focus-history">
              <h3>Session History</h3>
              
              <div className="history-stats">
                <div className="stat-card">
                  <span className="stat-value">{todaysSessions.length}</span>
                  <span className="stat-label">Sessions Today</span>
                </div>
                <div className="stat-card">
                  <span className="stat-value">{Math.floor(todaysFocusTime / 60)}m</span>
                  <span className="stat-label">Focus Time</span>
                </div>
              </div>

              <div className="session-list">
                {sessions.slice(0, 20).map(session => (
                  <div key={session.id} className={`session-item ${session.type}`}>
                    <div className="session-icon">
                      {session.type === 'focus' ? <TargetIcon /> : <CoffeeIcon />}
                    </div>
                    <div className="session-info">
                      <span className="session-type">
                        {session.type === 'focus' ? 'Focus' : session.type === 'short-break' ? 'Short Break' : 'Long Break'}
                      </span>
                      <span className="session-time">
                        {new Date(session.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        {' - '}
                        {Math.floor(session.duration / 60)}min
                      </span>
                    </div>
                    {session.task && <span className="session-task">{session.task}</span>}
                  </div>
                ))}
                {sessions.length === 0 && (
                  <p className="no-sessions">No sessions yet. Start focusing!</p>
                )}
              </div>

              <button className="back-btn" onClick={() => setShowHistory(false)}>
                Back to Timer
              </button>
            </div>
          ) : (
            /* Timer Panel */
            <>
              {/* Timer Circle */}
              <div className="timer-circle-container">
                <svg className="timer-circle" viewBox="0 0 200 200">
                  <circle 
                    className="timer-bg"
                    cx="100" 
                    cy="100" 
                    r="90"
                  />
                  <circle 
                    className={`timer-progress ${timerState}`}
                    cx="100" 
                    cy="100" 
                    r="90"
                    strokeDasharray={2 * Math.PI * 90}
                    strokeDashoffset={2 * Math.PI * 90 * (1 - progress / 100)}
                  />
                </svg>
                <div className="timer-display">
                  <span className="timer-time">{formatTime(timeRemaining)}</span>
                  <span className="timer-state">{getStateLabel()}</span>
                </div>
              </div>

              {/* Task Input */}
              <div className="task-input-container">
                <input 
                  type="text"
                  className="task-input"
                  placeholder="What are you working on?"
                  value={currentTask}
                  onChange={(e) => setCurrentTask(e.target.value)}
                  disabled={timerState !== 'idle'}
                />
              </div>

              {/* Session Counter */}
              <div className="session-counter">
                <span className="session-dots">
                  {Array.from({ length: settings.sessionsBeforeLongBreak }).map((_, i) => (
                    <span 
                      key={i} 
                      className={`dot ${i < completedSessions % settings.sessionsBeforeLongBreak ? 'completed' : ''}`}
                    />
                  ))}
                </span>
                <span className="session-label">
                  {completedSessions} sessions completed
                </span>
              </div>

              {/* Controls */}
              <div className="timer-controls">
                {timerState === 'idle' ? (
                  <>
                    <button className="control-btn primary" onClick={() => startTimer('focus')}>
                      <PlayIcon className="btn-icon" />
                      Start Focus
                    </button>
                    <button className="control-btn secondary" onClick={() => startTimer('short-break')}>
                      <CoffeeIcon className="btn-icon" />
                      Take Break
                    </button>
                  </>
                ) : timerState === 'paused' ? (
                  <>
                    <button className="control-btn primary" onClick={resumeTimer}>
                      <PlayIcon className="btn-icon" />
                      Resume
                    </button>
                    <button className="control-btn danger" onClick={stopTimer}>
                      <StopIcon className="btn-icon" />
                      Stop
                    </button>
                  </>
                ) : (
                  <>
                    <button className="control-btn secondary" onClick={pauseTimer}>
                      <PauseIcon className="btn-icon" />
                      Pause
                    </button>
                    <button className="control-btn secondary" onClick={skipToNext}>
                      <SkipIcon className="btn-icon" />
                      Skip
                    </button>
                    <button className="control-btn danger" onClick={stopTimer}>
                      <StopIcon className="btn-icon" />
                      Stop
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default FocusMode;
