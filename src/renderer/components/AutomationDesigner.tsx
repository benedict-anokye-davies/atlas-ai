/**
 * AutomationDesigner
 * Visual trigger-action builder for contextual automation
 */

import React, { useState, useCallback } from 'react';
import './AutomationDesigner.css';

interface AutomationRule {
  id: string;
  name: string;
  enabled: boolean;
  trigger: TriggerConfig;
  conditions: ConditionConfig[];
  actions: ActionConfig[];
}

interface TriggerConfig {
  type: TriggerType;
  config: Record<string, unknown>;
}

type TriggerType = 
  | 'app_launch'
  | 'app_close'
  | 'time_of_day'
  | 'file_change'
  | 'network_change'
  | 'battery_level'
  | 'system_idle'
  | 'voice_command'
  | 'hotkey';

interface ConditionConfig {
  type: ConditionType;
  operator: 'equals' | 'contains' | 'greater' | 'less' | 'matches';
  value: string;
}

type ConditionType = 
  | 'active_app'
  | 'time_range'
  | 'day_of_week'
  | 'file_exists'
  | 'network_connected'
  | 'battery_charging';

interface ActionConfig {
  type: ActionType;
  config: Record<string, unknown>;
}

type ActionType =
  | 'run_tool'
  | 'send_notification'
  | 'run_workflow'
  | 'set_variable'
  | 'speak'
  | 'open_app'
  | 'run_command'
  | 'wait';

const TRIGGER_OPTIONS: Record<TriggerType, { icon: string; label: string; description: string }> = {
  app_launch: { icon: '\ud83d\ude80', label: 'App Launch', description: 'When an application starts' },
  app_close: { icon: '\u274c', label: 'App Close', description: 'When an application closes' },
  time_of_day: { icon: '\u23f0', label: 'Time of Day', description: 'At a specific time' },
  file_change: { icon: '\ud83d\udcc1', label: 'File Change', description: 'When files change' },
  network_change: { icon: '\ud83c\udf10', label: 'Network Change', description: 'On connectivity change' },
  battery_level: { icon: '\ud83d\udd0b', label: 'Battery Level', description: 'At battery threshold' },
  system_idle: { icon: '\ud83d\udca4', label: 'System Idle', description: 'After idle period' },
  voice_command: { icon: '\ud83c\udf99\ufe0f', label: 'Voice Command', description: 'On voice trigger' },
  hotkey: { icon: '\u2328\ufe0f', label: 'Hotkey', description: 'On keyboard shortcut' }
};

const ACTION_OPTIONS: Record<ActionType, { icon: string; label: string; description: string }> = {
  run_tool: { icon: '\u2699\ufe0f', label: 'Run Tool', description: 'Execute an Atlas tool' },
  send_notification: { icon: '\ud83d\udd14', label: 'Notification', description: 'Show a notification' },
  run_workflow: { icon: '\ud83d\udd04', label: 'Run Workflow', description: 'Execute a workflow' },
  set_variable: { icon: '\ud83d\udcdd', label: 'Set Variable', description: 'Set a context variable' },
  speak: { icon: '\ud83d\udde3\ufe0f', label: 'Speak', description: 'Atlas speaks text' },
  open_app: { icon: '\ud83d\udcbb', label: 'Open App', description: 'Launch an application' },
  run_command: { icon: '\ud83d\udcbb', label: 'Run Command', description: 'Execute terminal command' },
  wait: { icon: '\u23f3', label: 'Wait', description: 'Pause execution' }
};

export const AutomationDesigner: React.FC = () => {
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [selectedRule, setSelectedRule] = useState<string | null>(null);
  const [editMode, setEditMode] = useState<'trigger' | 'conditions' | 'actions' | null>(null);

  const createRule = useCallback(() => {
    const newRule: AutomationRule = {
      id: `rule-${Date.now()}`,
      name: `New Automation ${rules.length + 1}`,
      enabled: true,
      trigger: { type: 'time_of_day', config: { time: '09:00' } },
      conditions: [],
      actions: []
    };
    setRules(prev => [...prev, newRule]);
    setSelectedRule(newRule.id);
  }, [rules.length]);

  const updateRule = useCallback((ruleId: string, updates: Partial<AutomationRule>) => {
    setRules(prev => prev.map(r => 
      r.id === ruleId ? { ...r, ...updates } : r
    ));
  }, []);

  const deleteRule = useCallback((ruleId: string) => {
    setRules(prev => prev.filter(r => r.id !== ruleId));
    if (selectedRule === ruleId) {
      setSelectedRule(null);
    }
  }, [selectedRule]);

  const toggleRule = useCallback((ruleId: string) => {
    setRules(prev => prev.map(r =>
      r.id === ruleId ? { ...r, enabled: !r.enabled } : r
    ));
  }, []);

  const addCondition = useCallback((ruleId: string) => {
    setRules(prev => prev.map(r => {
      if (r.id !== ruleId) return r;
      return {
        ...r,
        conditions: [...r.conditions, {
          type: 'active_app' as ConditionType,
          operator: 'equals' as const,
          value: ''
        }]
      };
    }));
  }, []);

  const updateCondition = useCallback((ruleId: string, index: number, updates: Partial<ConditionConfig>) => {
    setRules(prev => prev.map(r => {
      if (r.id !== ruleId) return r;
      const conditions = [...r.conditions];
      conditions[index] = { ...conditions[index], ...updates };
      return { ...r, conditions };
    }));
  }, []);

  const removeCondition = useCallback((ruleId: string, index: number) => {
    setRules(prev => prev.map(r => {
      if (r.id !== ruleId) return r;
      return {
        ...r,
        conditions: r.conditions.filter((_, i) => i !== index)
      };
    }));
  }, []);

  const addAction = useCallback((ruleId: string, type: ActionType) => {
    setRules(prev => prev.map(r => {
      if (r.id !== ruleId) return r;
      return {
        ...r,
        actions: [...r.actions, { type, config: {} }]
      };
    }));
  }, []);

  const updateAction = useCallback((ruleId: string, index: number, updates: Partial<ActionConfig>) => {
    setRules(prev => prev.map(r => {
      if (r.id !== ruleId) return r;
      const actions = [...r.actions];
      actions[index] = { ...actions[index], ...updates };
      return { ...r, actions };
    }));
  }, []);

  const removeAction = useCallback((ruleId: string, index: number) => {
    setRules(prev => prev.map(r => {
      if (r.id !== ruleId) return r;
      return {
        ...r,
        actions: r.actions.filter((_, i) => i !== index)
      };
    }));
  }, []);

  const selectedRuleData = rules.find(r => r.id === selectedRule);

  const renderTriggerConfig = (rule: AutomationRule) => {
    switch (rule.trigger.type) {
      case 'time_of_day':
        return (
          <div className="config-field">
            <label>Time</label>
            <input
              type="time"
              value={(rule.trigger.config.time as string) || '09:00'}
              onChange={(e) => updateRule(rule.id, {
                trigger: { ...rule.trigger, config: { ...rule.trigger.config, time: e.target.value } }
              })}
            />
          </div>
        );
      case 'app_launch':
      case 'app_close':
        return (
          <div className="config-field">
            <label>Application Name</label>
            <input
              type="text"
              value={(rule.trigger.config.appName as string) || ''}
              onChange={(e) => updateRule(rule.id, {
                trigger: { ...rule.trigger, config: { ...rule.trigger.config, appName: e.target.value } }
              })}
              placeholder="e.g., Code, Chrome"
            />
          </div>
        );
      case 'battery_level':
        return (
          <div className="config-field">
            <label>Battery Level (%)</label>
            <input
              type="number"
              min={0}
              max={100}
              value={(rule.trigger.config.level as number) || 20}
              onChange={(e) => updateRule(rule.id, {
                trigger: { ...rule.trigger, config: { ...rule.trigger.config, level: parseInt(e.target.value) } }
              })}
            />
          </div>
        );
      case 'system_idle':
        return (
          <div className="config-field">
            <label>Idle Time (minutes)</label>
            <input
              type="number"
              min={1}
              value={(rule.trigger.config.minutes as number) || 5}
              onChange={(e) => updateRule(rule.id, {
                trigger: { ...rule.trigger, config: { ...rule.trigger.config, minutes: parseInt(e.target.value) } }
              })}
            />
          </div>
        );
      case 'voice_command':
        return (
          <div className="config-field">
            <label>Trigger Phrase</label>
            <input
              type="text"
              value={(rule.trigger.config.phrase as string) || ''}
              onChange={(e) => updateRule(rule.id, {
                trigger: { ...rule.trigger, config: { ...rule.trigger.config, phrase: e.target.value } }
              })}
              placeholder="e.g., start my workflow"
            />
          </div>
        );
      case 'hotkey':
        return (
          <div className="config-field">
            <label>Hotkey</label>
            <input
              type="text"
              value={(rule.trigger.config.hotkey as string) || ''}
              onChange={(e) => updateRule(rule.id, {
                trigger: { ...rule.trigger, config: { ...rule.trigger.config, hotkey: e.target.value } }
              })}
              placeholder="e.g., Ctrl+Shift+A"
            />
          </div>
        );
      default:
        return null;
    }
  };

  const renderActionConfig = (rule: AutomationRule, action: ActionConfig, index: number) => {
    switch (action.type) {
      case 'send_notification':
        return (
          <>
            <input
              type="text"
              value={(action.config.title as string) || ''}
              onChange={(e) => updateAction(rule.id, index, {
                config: { ...action.config, title: e.target.value }
              })}
              placeholder="Notification title"
            />
            <input
              type="text"
              value={(action.config.message as string) || ''}
              onChange={(e) => updateAction(rule.id, index, {
                config: { ...action.config, message: e.target.value }
              })}
              placeholder="Notification message"
            />
          </>
        );
      case 'speak':
        return (
          <input
            type="text"
            value={(action.config.text as string) || ''}
            onChange={(e) => updateAction(rule.id, index, {
              config: { ...action.config, text: e.target.value }
            })}
            placeholder="Text to speak"
          />
        );
      case 'open_app':
        return (
          <input
            type="text"
            value={(action.config.appName as string) || ''}
            onChange={(e) => updateAction(rule.id, index, {
              config: { ...action.config, appName: e.target.value }
            })}
            placeholder="Application name or path"
          />
        );
      case 'run_command':
        return (
          <input
            type="text"
            value={(action.config.command as string) || ''}
            onChange={(e) => updateAction(rule.id, index, {
              config: { ...action.config, command: e.target.value }
            })}
            placeholder="Command to run"
          />
        );
      case 'wait':
        return (
          <input
            type="number"
            min={100}
            step={100}
            value={(action.config.ms as number) || 1000}
            onChange={(e) => updateAction(rule.id, index, {
              config: { ...action.config, ms: parseInt(e.target.value) }
            })}
            placeholder="Milliseconds"
          />
        );
      case 'run_tool':
        return (
          <>
            <input
              type="text"
              value={(action.config.toolName as string) || ''}
              onChange={(e) => updateAction(rule.id, index, {
                config: { ...action.config, toolName: e.target.value }
              })}
              placeholder="Tool name"
            />
            <input
              type="text"
              value={(action.config.args as string) || ''}
              onChange={(e) => updateAction(rule.id, index, {
                config: { ...action.config, args: e.target.value }
              })}
              placeholder="Arguments (JSON)"
            />
          </>
        );
      default:
        return null;
    }
  };

  return (
    <div className="automation-designer">
      <div className="automation-sidebar">
        <div className="sidebar-header">
          <h3>Automations</h3>
          <button className="create-btn" onClick={createRule}>
            + New
          </button>
        </div>
        
        <div className="rules-list">
          {rules.length === 0 ? (
            <div className="empty-state">
              <p>No automations yet</p>
              <p className="hint">Create one to get started</p>
            </div>
          ) : (
            rules.map(rule => (
              <div
                key={rule.id}
                className={`rule-item ${selectedRule === rule.id ? 'selected' : ''} ${!rule.enabled ? 'disabled' : ''}`}
                onClick={() => setSelectedRule(rule.id)}
              >
                <div className="rule-toggle">
                  <input
                    type="checkbox"
                    checked={rule.enabled}
                    onChange={(e) => { e.stopPropagation(); toggleRule(rule.id); }}
                  />
                </div>
                <div className="rule-info">
                  <span className="rule-name">{rule.name}</span>
                  <span className="rule-trigger">
                    {TRIGGER_OPTIONS[rule.trigger.type].icon} {TRIGGER_OPTIONS[rule.trigger.type].label}
                  </span>
                </div>
                <button
                  className="delete-btn"
                  onClick={(e) => { e.stopPropagation(); deleteRule(rule.id); }}
                >
                  x
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="automation-editor">
        {!selectedRuleData ? (
          <div className="no-selection">
            <p>Select an automation to edit</p>
            <p className="hint">or create a new one</p>
          </div>
        ) : (
          <>
            <div className="editor-header">
              <input
                type="text"
                className="rule-name-input"
                value={selectedRuleData.name}
                onChange={(e) => updateRule(selectedRuleData.id, { name: e.target.value })}
              />
            </div>

            <div className="editor-section">
              <div className="section-header" onClick={() => setEditMode(editMode === 'trigger' ? null : 'trigger')}>
                <span className="section-icon">\ud83c\udfaf</span>
                <h4>Trigger</h4>
                <span className="section-summary">
                  {TRIGGER_OPTIONS[selectedRuleData.trigger.type].label}
                </span>
              </div>
              
              {editMode === 'trigger' && (
                <div className="section-content">
                  <div className="trigger-grid">
                    {(Object.entries(TRIGGER_OPTIONS) as [TriggerType, typeof TRIGGER_OPTIONS[TriggerType]][]).map(([type, opt]) => (
                      <button
                        key={type}
                        className={`trigger-option ${selectedRuleData.trigger.type === type ? 'selected' : ''}`}
                        onClick={() => updateRule(selectedRuleData.id, {
                          trigger: { type, config: {} }
                        })}
                      >
                        <span className="option-icon">{opt.icon}</span>
                        <span className="option-label">{opt.label}</span>
                      </button>
                    ))}
                  </div>
                  
                  <div className="trigger-config">
                    {renderTriggerConfig(selectedRuleData)}
                  </div>
                </div>
              )}
            </div>

            <div className="editor-section">
              <div className="section-header" onClick={() => setEditMode(editMode === 'conditions' ? null : 'conditions')}>
                <span className="section-icon">\ud83e\uddea</span>
                <h4>Conditions</h4>
                <span className="section-summary">
                  {selectedRuleData.conditions.length} condition{selectedRuleData.conditions.length !== 1 ? 's' : ''}
                </span>
              </div>
              
              {editMode === 'conditions' && (
                <div className="section-content">
                  {selectedRuleData.conditions.map((cond, idx) => (
                    <div key={idx} className="condition-row">
                      <select
                        value={cond.type}
                        onChange={(e) => updateCondition(selectedRuleData.id, idx, { type: e.target.value as ConditionType })}
                      >
                        <option value="active_app">Active App</option>
                        <option value="time_range">Time Range</option>
                        <option value="day_of_week">Day of Week</option>
                        <option value="network_connected">Network</option>
                        <option value="battery_charging">Battery Charging</option>
                      </select>
                      <select
                        value={cond.operator}
                        onChange={(e) => updateCondition(selectedRuleData.id, idx, { operator: e.target.value as ConditionConfig['operator'] })}
                      >
                        <option value="equals">equals</option>
                        <option value="contains">contains</option>
                        <option value="greater">greater than</option>
                        <option value="less">less than</option>
                        <option value="matches">matches</option>
                      </select>
                      <input
                        type="text"
                        value={cond.value}
                        onChange={(e) => updateCondition(selectedRuleData.id, idx, { value: e.target.value })}
                        placeholder="Value"
                      />
                      <button 
                        className="remove-btn"
                        onClick={() => removeCondition(selectedRuleData.id, idx)}
                      >
                        x
                      </button>
                    </div>
                  ))}
                  <button 
                    className="add-btn"
                    onClick={() => addCondition(selectedRuleData.id)}
                  >
                    + Add Condition
                  </button>
                </div>
              )}
            </div>

            <div className="editor-section">
              <div className="section-header" onClick={() => setEditMode(editMode === 'actions' ? null : 'actions')}>
                <span className="section-icon">\u26a1</span>
                <h4>Actions</h4>
                <span className="section-summary">
                  {selectedRuleData.actions.length} action{selectedRuleData.actions.length !== 1 ? 's' : ''}
                </span>
              </div>
              
              {editMode === 'actions' && (
                <div className="section-content">
                  {selectedRuleData.actions.map((action, idx) => (
                    <div key={idx} className="action-row">
                      <div className="action-header">
                        <span className="action-icon">{ACTION_OPTIONS[action.type].icon}</span>
                        <span className="action-label">{ACTION_OPTIONS[action.type].label}</span>
                        <button
                          className="remove-btn"
                          onClick={() => removeAction(selectedRuleData.id, idx)}
                        >
                          x
                        </button>
                      </div>
                      <div className="action-config">
                        {renderActionConfig(selectedRuleData, action, idx)}
                      </div>
                    </div>
                  ))}
                  
                  <div className="add-action-grid">
                    {(Object.entries(ACTION_OPTIONS) as [ActionType, typeof ACTION_OPTIONS[ActionType]][]).map(([type, opt]) => (
                      <button
                        key={type}
                        className="add-action-btn"
                        onClick={() => addAction(selectedRuleData.id, type)}
                      >
                        <span className="option-icon">{opt.icon}</span>
                        <span className="option-label">{opt.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default AutomationDesigner;
