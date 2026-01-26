/**
 * Atlas Desktop - Routines Settings Component
 * JARVIS-style automated routines configuration UI
 * 
 * Features:
 * - Morning briefing configuration
 * - Break reminder intervals
 * - Work hours customization
 * - Custom routine builder
 * - Focus mode scheduling
 */

import React, { useState, useEffect } from 'react';
import './RoutinesSettings.css';

// ============================================================================
// Types
// ============================================================================

export type DayOfWeek = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';

export interface RoutineSchedule {
  enabled: boolean;
  time: string; // HH:MM format
  days: DayOfWeek[];
}

export interface RoutineConfig {
  id: string;
  name: string;
  description: string;
  icon: string;
  schedule: RoutineSchedule;
  actions: RoutineAction[];
  isBuiltIn: boolean;
}

export interface RoutineAction {
  type: 'speak' | 'notification' | 'focus_mode' | 'app_launch' | 'custom';
  label: string;
  payload?: Record<string, unknown>;
}

export interface AutomationSettings {
  enabled: boolean;
  userName: string;
  workStartHour: number;
  workEndHour: number;
  breakIntervalMinutes: number;
  voiceEnabled: boolean;
  notificationsEnabled: boolean;
  adaptiveBrightness: boolean;
}

interface RoutinesSettingsProps {
  isOpen: boolean;
  onClose: () => void;
}

// ============================================================================
// Icons
// ============================================================================

const SunIcon: React.FC<{ className?: string }> = ({ className }) => (
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

const MoonIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
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

const BriefcaseIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
    <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
  </svg>
);

const ZapIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </svg>
);

const ClockIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);

const PlusIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const TrashIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

const XIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const FocusIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v4" />
    <path d="M12 18v4" />
    <path d="M4.93 4.93l2.83 2.83" />
    <path d="M16.24 16.24l2.83 2.83" />
    <path d="M2 12h4" />
    <path d="M18 12h4" />
    <path d="M4.93 19.07l2.83-2.83" />
    <path d="M16.24 7.76l2.83-2.83" />
  </svg>
);

// ============================================================================
// Helper Components
// ============================================================================

const DaySelector: React.FC<{
  selected: DayOfWeek[];
  onChange: (days: DayOfWeek[]) => void;
}> = ({ selected, onChange }) => {
  const days: { key: DayOfWeek; label: string }[] = [
    { key: 'monday', label: 'M' },
    { key: 'tuesday', label: 'T' },
    { key: 'wednesday', label: 'W' },
    { key: 'thursday', label: 'T' },
    { key: 'friday', label: 'F' },
    { key: 'saturday', label: 'S' },
    { key: 'sunday', label: 'S' },
  ];

  const toggleDay = (day: DayOfWeek) => {
    if (selected.includes(day)) {
      onChange(selected.filter(d => d !== day));
    } else {
      onChange([...selected, day]);
    }
  };

  return (
    <div className="day-selector">
      {days.map((day, idx) => (
        <button
          key={`${day.key}-${idx}`}
          className={`day-button ${selected.includes(day.key) ? 'active' : ''}`}
          onClick={() => toggleDay(day.key)}
          title={day.key.charAt(0).toUpperCase() + day.key.slice(1)}
        >
          {day.label}
        </button>
      ))}
    </div>
  );
};

const TimeInput: React.FC<{
  value: string;
  onChange: (time: string) => void;
  label?: string;
}> = ({ value, onChange, label }) => (
  <div className="time-input-wrapper">
    {label && <label className="time-label">{label}</label>}
    <input
      type="time"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="time-input"
    />
  </div>
);

const Toggle: React.FC<{
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
}> = ({ checked, onChange, label }) => (
  <div className="toggle-wrapper">
    {label && <span className="toggle-label">{label}</span>}
    <button
      className={`toggle-switch ${checked ? 'active' : ''}`}
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
    >
      <span className="toggle-slider" />
    </button>
  </div>
);

// ============================================================================
// Routine Card Component
// ============================================================================

interface RoutineCardProps {
  routine: RoutineConfig;
  onToggle: (enabled: boolean) => void;
  onEdit: () => void;
  onDelete?: () => void;
}

const RoutineCard: React.FC<RoutineCardProps> = ({
  routine,
  onToggle,
  onEdit,
  onDelete,
}) => {
  const getIcon = () => {
    switch (routine.icon) {
      case 'sun': return <SunIcon className="routine-icon" />;
      case 'moon': return <MoonIcon className="routine-icon" />;
      case 'coffee': return <CoffeeIcon className="routine-icon" />;
      case 'briefcase': return <BriefcaseIcon className="routine-icon" />;
      case 'zap': return <ZapIcon className="routine-icon" />;
      case 'focus': return <FocusIcon className="routine-icon" />;
      default: return <ClockIcon className="routine-icon" />;
    }
  };

  const formatDays = (days: DayOfWeek[]) => {
    if (days.length === 7) return 'Every day';
    if (days.length === 5 && !days.includes('saturday') && !days.includes('sunday')) {
      return 'Weekdays';
    }
    if (days.length === 2 && days.includes('saturday') && days.includes('sunday')) {
      return 'Weekends';
    }
    return days.map(d => d.charAt(0).toUpperCase() + d.slice(1, 3)).join(', ');
  };

  return (
    <div className={`routine-card ${routine.schedule.enabled ? 'active' : ''}`}>
      <div className="routine-header">
        <div className="routine-icon-wrapper">{getIcon()}</div>
        <div className="routine-info">
          <h4 className="routine-name">{routine.name}</h4>
          <p className="routine-description">{routine.description}</p>
        </div>
        <Toggle
          checked={routine.schedule.enabled}
          onChange={onToggle}
        />
      </div>
      <div className="routine-schedule">
        <span className="routine-time">{routine.schedule.time}</span>
        <span className="routine-days">{formatDays(routine.schedule.days)}</span>
      </div>
      <div className="routine-actions-list">
        {routine.actions.slice(0, 3).map((action, idx) => (
          <span key={idx} className="routine-action-badge">{action.label}</span>
        ))}
        {routine.actions.length > 3 && (
          <span className="routine-action-badge more">+{routine.actions.length - 3}</span>
        )}
      </div>
      <div className="routine-buttons">
        <button className="routine-edit-btn" onClick={onEdit}>Edit</button>
        {!routine.isBuiltIn && onDelete && (
          <button className="routine-delete-btn" onClick={onDelete}>
            <TrashIcon className="btn-icon" />
          </button>
        )}
      </div>
    </div>
  );
};

// ============================================================================
// Main Component
// ============================================================================

export const RoutinesSettings: React.FC<RoutinesSettingsProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<'routines' | 'general' | 'create'>('routines');
  const [settings, setSettings] = useState<AutomationSettings>({
    enabled: true,
    userName: 'User',
    workStartHour: 9,
    workEndHour: 17,
    breakIntervalMinutes: 45,
    voiceEnabled: true,
    notificationsEnabled: true,
    adaptiveBrightness: false,
  });

  const [routines, setRoutines] = useState<RoutineConfig[]>([
    {
      id: 'morning-briefing',
      name: 'Morning Briefing',
      description: 'Start your day with weather, calendar, and news updates',
      icon: 'sun',
      schedule: { enabled: true, time: '08:00', days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] },
      actions: [
        { type: 'speak', label: 'Weather Update' },
        { type: 'speak', label: 'Calendar Review' },
        { type: 'notification', label: 'Task Summary' },
      ],
      isBuiltIn: true,
    },
    {
      id: 'break-reminder',
      name: 'Break Reminder',
      description: 'Gentle reminders to take breaks and stretch',
      icon: 'coffee',
      schedule: { enabled: true, time: '00:45', days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] },
      actions: [
        { type: 'notification', label: 'Break Alert' },
        { type: 'speak', label: 'Stretch Suggestion' },
      ],
      isBuiltIn: true,
    },
    {
      id: 'focus-mode',
      name: 'Focus Mode',
      description: 'Activate deep work mode with notifications silenced',
      icon: 'focus',
      schedule: { enabled: false, time: '09:00', days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] },
      actions: [
        { type: 'focus_mode', label: 'Enable Focus' },
        { type: 'notification', label: 'Focus Started' },
      ],
      isBuiltIn: true,
    },
    {
      id: 'evening-winddown',
      name: 'Evening Wind-Down',
      description: 'Prepare for end of day with summary and reminders',
      icon: 'moon',
      schedule: { enabled: false, time: '17:00', days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] },
      actions: [
        { type: 'speak', label: 'Day Summary' },
        { type: 'notification', label: 'Tomorrow Preview' },
      ],
      isBuiltIn: true,
    },
  ]);

  const [_editingRoutine, setEditingRoutine] = useState<RoutineConfig | null>(null);
  const [newRoutine, setNewRoutine] = useState<Partial<RoutineConfig>>({
    name: '',
    description: '',
    icon: 'clock',
    schedule: { enabled: true, time: '09:00', days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] },
    actions: [],
  });

  // Load settings from main process
  useEffect(() => {
    if (isOpen) {
      loadSettings();
    }
  }, [isOpen]);

  const loadSettings = async () => {
    try {
      const result = await window.atlas?.automation?.getSettings();
      if (result?.success && result.data) {
        setSettings(result.data as AutomationSettings);
      }
      
      const routinesResult = await window.atlas?.automation?.getRoutines();
      if (routinesResult?.success && routinesResult.data) {
        setRoutines(routinesResult.data as RoutineConfig[]);
      }
    } catch (error) {
      console.error('Failed to load automation settings:', error);
    }
  };

  const saveSettings = async (newSettings: AutomationSettings) => {
    try {
      await window.atlas?.automation?.updateSettings(newSettings);
      setSettings(newSettings);
    } catch (error) {
      console.error('Failed to save automation settings:', error);
    }
  };

  const toggleRoutine = async (id: string, enabled: boolean) => {
    const updated = routines.map(r => 
      r.id === id ? { ...r, schedule: { ...r.schedule, enabled } } : r
    );
    setRoutines(updated);
    
    try {
      await window.atlas?.automation?.updateRoutine(id, { enabled });
    } catch (error) {
      console.error('Failed to update routine:', error);
    }
  };

  const deleteRoutine = async (id: string) => {
    setRoutines(routines.filter(r => r.id !== id));
    
    try {
      await window.atlas?.automation?.deleteRoutine(id);
    } catch (error) {
      console.error('Failed to delete routine:', error);
    }
  };

  const createRoutine = async () => {
    if (!newRoutine.name || !newRoutine.schedule) return;

    const routine: RoutineConfig = {
      id: `custom-${Date.now()}`,
      name: newRoutine.name,
      description: newRoutine.description || '',
      icon: newRoutine.icon || 'clock',
      schedule: newRoutine.schedule as RoutineSchedule,
      actions: newRoutine.actions || [],
      isBuiltIn: false,
    };

    setRoutines([...routines, routine]);
    setNewRoutine({
      name: '',
      description: '',
      icon: 'clock',
      schedule: { enabled: true, time: '09:00', days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] },
      actions: [],
    });
    setActiveTab('routines');

    try {
      await window.atlas?.automation?.createRoutine(routine);
    } catch (error) {
      console.error('Failed to create routine:', error);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="routines-overlay">
      <div className="routines-modal">
        <div className="routines-header">
          <h2 className="routines-title">
            <ZapIcon className="title-icon" />
            Smart Routines
          </h2>
          <button className="close-btn" onClick={onClose}>
            <XIcon className="close-icon" />
          </button>
        </div>

        <div className="routines-tabs">
          <button
            className={`tab-btn ${activeTab === 'routines' ? 'active' : ''}`}
            onClick={() => setActiveTab('routines')}
          >
            My Routines
          </button>
          <button
            className={`tab-btn ${activeTab === 'general' ? 'active' : ''}`}
            onClick={() => setActiveTab('general')}
          >
            General Settings
          </button>
          <button
            className={`tab-btn ${activeTab === 'create' ? 'active' : ''}`}
            onClick={() => setActiveTab('create')}
          >
            <PlusIcon className="tab-icon" />
            Create New
          </button>
        </div>

        <div className="routines-content">
          {activeTab === 'routines' && (
            <div className="routines-list">
              {routines.map(routine => (
                <RoutineCard
                  key={routine.id}
                  routine={routine}
                  onToggle={(enabled) => toggleRoutine(routine.id, enabled)}
                  onEdit={() => setEditingRoutine(routine)}
                  onDelete={routine.isBuiltIn ? undefined : () => deleteRoutine(routine.id)}
                />
              ))}
            </div>
          )}

          {activeTab === 'general' && (
            <div className="general-settings">
              <div className="settings-section">
                <h3 className="section-title">Automation</h3>
                <Toggle
                  label="Enable Smart Routines"
                  checked={settings.enabled}
                  onChange={(enabled) => saveSettings({ ...settings, enabled })}
                />
                <Toggle
                  label="Voice Announcements"
                  checked={settings.voiceEnabled}
                  onChange={(voiceEnabled) => saveSettings({ ...settings, voiceEnabled })}
                />
                <Toggle
                  label="Desktop Notifications"
                  checked={settings.notificationsEnabled}
                  onChange={(notificationsEnabled) => saveSettings({ ...settings, notificationsEnabled })}
                />
              </div>

              <div className="settings-section">
                <h3 className="section-title">Work Hours</h3>
                <div className="work-hours">
                  <div className="hour-input">
                    <label>Start</label>
                    <select
                      value={settings.workStartHour}
                      onChange={(e) => saveSettings({ ...settings, workStartHour: parseInt(e.target.value) })}
                    >
                      {Array.from({ length: 24 }, (_, i) => (
                        <option key={i} value={i}>{i.toString().padStart(2, '0')}:00</option>
                      ))}
                    </select>
                  </div>
                  <span className="hour-separator">to</span>
                  <div className="hour-input">
                    <label>End</label>
                    <select
                      value={settings.workEndHour}
                      onChange={(e) => saveSettings({ ...settings, workEndHour: parseInt(e.target.value) })}
                    >
                      {Array.from({ length: 24 }, (_, i) => (
                        <option key={i} value={i}>{i.toString().padStart(2, '0')}:00</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div className="settings-section">
                <h3 className="section-title">Break Reminders</h3>
                <div className="break-interval">
                  <label>Remind me every</label>
                  <select
                    value={settings.breakIntervalMinutes}
                    onChange={(e) => saveSettings({ ...settings, breakIntervalMinutes: parseInt(e.target.value) })}
                  >
                    <option value={30}>30 minutes</option>
                    <option value={45}>45 minutes</option>
                    <option value={60}>1 hour</option>
                    <option value={90}>1.5 hours</option>
                    <option value={120}>2 hours</option>
                  </select>
                </div>
              </div>

              <div className="settings-section">
                <h3 className="section-title">Personalization</h3>
                <div className="name-input">
                  <label>Your Name</label>
                  <input
                    type="text"
                    value={settings.userName}
                    onChange={(e) => saveSettings({ ...settings, userName: e.target.value })}
                    placeholder="Enter your name"
                  />
                </div>
                <p className="setting-hint">Atlas will use your name in greetings and reminders.</p>
              </div>
            </div>
          )}

          {activeTab === 'create' && (
            <div className="create-routine">
              <div className="create-section">
                <h3 className="section-title">Routine Details</h3>
                <div className="input-group">
                  <label>Name</label>
                  <input
                    type="text"
                    value={newRoutine.name || ''}
                    onChange={(e) => setNewRoutine({ ...newRoutine, name: e.target.value })}
                    placeholder="e.g., Daily Standup Prep"
                  />
                </div>
                <div className="input-group">
                  <label>Description</label>
                  <input
                    type="text"
                    value={newRoutine.description || ''}
                    onChange={(e) => setNewRoutine({ ...newRoutine, description: e.target.value })}
                    placeholder="What this routine does"
                  />
                </div>
                <div className="input-group">
                  <label>Icon</label>
                  <div className="icon-selector">
                    {['sun', 'moon', 'coffee', 'briefcase', 'zap', 'focus', 'clock'].map(icon => (
                      <button
                        key={icon}
                        className={`icon-btn ${newRoutine.icon === icon ? 'active' : ''}`}
                        onClick={() => setNewRoutine({ ...newRoutine, icon })}
                      >
                        {icon === 'sun' && <SunIcon className="icon" />}
                        {icon === 'moon' && <MoonIcon className="icon" />}
                        {icon === 'coffee' && <CoffeeIcon className="icon" />}
                        {icon === 'briefcase' && <BriefcaseIcon className="icon" />}
                        {icon === 'zap' && <ZapIcon className="icon" />}
                        {icon === 'focus' && <FocusIcon className="icon" />}
                        {icon === 'clock' && <ClockIcon className="icon" />}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="create-section">
                <h3 className="section-title">Schedule</h3>
                <TimeInput
                  label="Time"
                  value={newRoutine.schedule?.time || '09:00'}
                  onChange={(time) => setNewRoutine({
                    ...newRoutine,
                    schedule: { ...newRoutine.schedule!, time }
                  })}
                />
                <div className="input-group">
                  <label>Days</label>
                  <DaySelector
                    selected={newRoutine.schedule?.days || []}
                    onChange={(days) => setNewRoutine({
                      ...newRoutine,
                      schedule: { ...newRoutine.schedule!, days }
                    })}
                  />
                </div>
              </div>

              <div className="create-section">
                <h3 className="section-title">Actions</h3>
                <div className="action-buttons">
                  <button
                    className="add-action-btn"
                    onClick={() => setNewRoutine({
                      ...newRoutine,
                      actions: [...(newRoutine.actions || []), { type: 'speak', label: 'Announcement' }]
                    })}
                  >
                    <PlusIcon className="btn-icon" /> Add Voice Action
                  </button>
                  <button
                    className="add-action-btn"
                    onClick={() => setNewRoutine({
                      ...newRoutine,
                      actions: [...(newRoutine.actions || []), { type: 'notification', label: 'Notification' }]
                    })}
                  >
                    <PlusIcon className="btn-icon" /> Add Notification
                  </button>
                </div>
                {(newRoutine.actions || []).map((action, idx) => (
                  <div key={idx} className="action-item">
                    <span className="action-type">{action.type}</span>
                    <input
                      type="text"
                      value={action.label}
                      onChange={(e) => {
                        const actions = [...(newRoutine.actions || [])];
                        actions[idx] = { ...action, label: e.target.value };
                        setNewRoutine({ ...newRoutine, actions });
                      }}
                    />
                    <button
                      className="remove-action-btn"
                      onClick={() => {
                        const actions = (newRoutine.actions || []).filter((_, i) => i !== idx);
                        setNewRoutine({ ...newRoutine, actions });
                      }}
                    >
                      <XIcon className="btn-icon" />
                    </button>
                  </div>
                ))}
              </div>

              <button
                className="create-btn"
                onClick={createRoutine}
                disabled={!newRoutine.name}
              >
                Create Routine
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default RoutinesSettings;
