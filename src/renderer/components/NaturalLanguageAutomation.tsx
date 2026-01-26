/**
 * Atlas Desktop - Natural Language Automation
 * Create workflows using voice/text commands
 */

import React, { useState, useEffect, useCallback } from 'react';
import './NaturalLanguageAutomation.css';

interface AutomationProps {
  isVisible: boolean;
  onClose: () => void;
}

interface Workflow {
  id: string;
  name: string;
  trigger: string;
  actions: WorkflowAction[];
  enabled: boolean;
  lastRun?: Date;
  runCount: number;
}

interface WorkflowAction {
  id: string;
  type: 'command' | 'app' | 'file' | 'script' | 'notify' | 'wait';
  description: string;
  params: Record<string, unknown>;
}

interface ParsedIntent {
  trigger: string;
  actions: WorkflowAction[];
  confidence: number;
}

const NaturalLanguageAutomation: React.FC<AutomationProps> = ({
  isVisible,
  onClose,
}) => {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [inputText, setInputText] = useState('');
  const [parsedIntent, setParsedIntent] = useState<ParsedIntent | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [selectedWorkflow, setSelectedWorkflow] = useState<Workflow | null>(null);
  const [showExamples, setShowExamples] = useState(false);

  // Load saved workflows
  useEffect(() => {
    const saved = localStorage.getItem('atlas-workflows');
    if (saved) {
      setWorkflows(JSON.parse(saved));
    } else {
      // Default example workflows
      setWorkflows([
        {
          id: '1',
          name: 'Morning Routine',
          trigger: 'when I say "good morning"',
          actions: [
            { id: 'a1', type: 'app', description: 'Open Spotify', params: { app: 'spotify' } },
            { id: 'a2', type: 'command', description: 'Play morning playlist', params: { command: 'play morning playlist' } },
            { id: 'a3', type: 'app', description: 'Open email', params: { app: 'outlook' } },
            { id: 'a4', type: 'notify', description: 'Show weather', params: { message: 'weather' } },
          ],
          enabled: true,
          runCount: 42,
        },
        {
          id: '2',
          name: 'Focus Mode',
          trigger: 'when I say "focus time"',
          actions: [
            { id: 'b1', type: 'command', description: 'Enable DND', params: { command: 'dnd on' } },
            { id: 'b2', type: 'app', description: 'Close Slack', params: { app: 'slack', action: 'close' } },
            { id: 'b3', type: 'app', description: 'Open VS Code', params: { app: 'vscode' } },
          ],
          enabled: true,
          runCount: 18,
        },
        {
          id: '3',
          name: 'Meeting Prep',
          trigger: 'when I say "prepare for meeting"',
          actions: [
            { id: 'c1', type: 'app', description: 'Open Zoom', params: { app: 'zoom' } },
            { id: 'c2', type: 'file', description: 'Open notes folder', params: { path: '~/Documents/Meeting Notes' } },
            { id: 'c3', type: 'command', description: 'Mute notifications', params: { command: 'mute' } },
          ],
          enabled: false,
          runCount: 7,
        },
      ]);
    }
  }, []);

  // Save workflows
  useEffect(() => {
    if (workflows.length > 0) {
      localStorage.setItem('atlas-workflows', JSON.stringify(workflows));
    }
  }, [workflows]);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isVisible) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
    return undefined;
  }, [isVisible, onClose]);

  // Parse natural language input
  const parseInput = useCallback((text: string): ParsedIntent | null => {
    const lower = text.toLowerCase();
    let trigger = '';
    const actions: WorkflowAction[] = [];
    let confidence = 0.5;

    // Extract trigger phrase
    const triggerPatterns = [
      /when i say [""'](.+?)[""']/i,
      /if i say [""'](.+?)[""']/i,
      /on the phrase [""'](.+?)[""']/i,
      /whenever i say [""'](.+?)[""']/i,
    ];

    for (const pattern of triggerPatterns) {
      const match = lower.match(pattern);
      if (match) {
        trigger = match[1];
        confidence += 0.2;
        break;
      }
    }

    // Extract actions
    if (lower.includes('open ')) {
      const appMatch = lower.match(/open (\w+)/i);
      if (appMatch) {
        actions.push({
          id: `act-${Date.now()}-1`,
          type: 'app',
          description: `Open ${appMatch[1]}`,
          params: { app: appMatch[1] },
        });
        confidence += 0.1;
      }
    }

    if (lower.includes('play ')) {
      const playMatch = lower.match(/play (.+?)(?:,|and|then|$)/i);
      if (playMatch) {
        actions.push({
          id: `act-${Date.now()}-2`,
          type: 'command',
          description: `Play ${playMatch[1]}`,
          params: { command: `play ${playMatch[1]}` },
        });
        confidence += 0.1;
      }
    }

    if (lower.includes('close ')) {
      const closeMatch = lower.match(/close (\w+)/i);
      if (closeMatch) {
        actions.push({
          id: `act-${Date.now()}-3`,
          type: 'app',
          description: `Close ${closeMatch[1]}`,
          params: { app: closeMatch[1], action: 'close' },
        });
        confidence += 0.1;
      }
    }

    if (lower.includes('run ') || lower.includes('execute ')) {
      const runMatch = lower.match(/(?:run|execute) (.+?)(?:,|and|then|$)/i);
      if (runMatch) {
        actions.push({
          id: `act-${Date.now()}-4`,
          type: 'script',
          description: `Run ${runMatch[1]}`,
          params: { script: runMatch[1] },
        });
        confidence += 0.1;
      }
    }

    if (lower.includes('notify') || lower.includes('show')) {
      const notifyMatch = lower.match(/(?:notify|show) (?:me )?(.+?)(?:,|and|then|$)/i);
      if (notifyMatch) {
        actions.push({
          id: `act-${Date.now()}-5`,
          type: 'notify',
          description: `Notify: ${notifyMatch[1]}`,
          params: { message: notifyMatch[1] },
        });
        confidence += 0.1;
      }
    }

    if (lower.includes('wait ')) {
      const waitMatch = lower.match(/wait (\d+) (second|minute)/i);
      if (waitMatch) {
        const seconds = waitMatch[2] === 'minute' ? parseInt(waitMatch[1]) * 60 : parseInt(waitMatch[1]);
        actions.push({
          id: `act-${Date.now()}-6`,
          type: 'wait',
          description: `Wait ${waitMatch[1]} ${waitMatch[2]}(s)`,
          params: { seconds },
        });
        confidence += 0.1;
      }
    }

    if (!trigger && actions.length === 0) return null;

    return {
      trigger: trigger || 'custom trigger',
      actions,
      confidence: Math.min(confidence, 0.95),
    };
  }, []);

  // Handle input change
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    setInputText(text);
    
    if (text.length > 10) {
      const parsed = parseInput(text);
      setParsedIntent(parsed);
    } else {
      setParsedIntent(null);
    }
  };

  // Start voice input
  const handleVoiceInput = () => {
    setIsListening(true);
    // Simulate voice recognition
    setTimeout(() => {
      setInputText('When I say "start work" open VS Code and play focus music');
      setIsListening(false);
      const parsed = parseInput('When I say "start work" open VS Code and play focus music');
      setParsedIntent(parsed);
    }, 2000);
  };

  // Create workflow from parsed intent
  const createWorkflow = () => {
    if (!parsedIntent) return;

    const newWorkflow: Workflow = {
      id: Date.now().toString(),
      name: `Workflow ${workflows.length + 1}`,
      trigger: parsedIntent.trigger,
      actions: parsedIntent.actions,
      enabled: true,
      runCount: 0,
    };

    setWorkflows([...workflows, newWorkflow]);
    setInputText('');
    setParsedIntent(null);
  };

  // Toggle workflow enabled
  const toggleWorkflow = (id: string) => {
    setWorkflows(
      workflows.map((w) =>
        w.id === id ? { ...w, enabled: !w.enabled } : w
      )
    );
  };

  // Delete workflow
  const deleteWorkflow = (id: string) => {
    setWorkflows(workflows.filter((w) => w.id !== id));
    if (selectedWorkflow?.id === id) {
      setSelectedWorkflow(null);
    }
  };

  // Get action icon
  const getActionIcon = (type: WorkflowAction['type']) => {
    switch (type) {
      case 'app':
        return (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
          </svg>
        );
      case 'command':
        return (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="4,17 10,11 4,5" />
            <line x1="12" y1="19" x2="20" y2="19" />
          </svg>
        );
      case 'file':
        return (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z" />
            <polyline points="13,2 13,9 20,9" />
          </svg>
        );
      case 'script':
        return (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="16,18 22,12 16,6" />
            <polyline points="8,6 2,12 8,18" />
          </svg>
        );
      case 'notify':
        return (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 01-3.46 0" />
          </svg>
        );
      case 'wait':
        return (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12,6 12,12 16,14" />
          </svg>
        );
      default:
        return null;
    }
  };

  if (!isVisible) return null;

  const examples = [
    'When I say "good morning" open Spotify and play my morning playlist',
    'When I say "focus time" close Slack and enable do not disturb',
    'When I say "meeting prep" open Zoom and mute notifications',
    'If I say "night mode" close all apps and show my calendar for tomorrow',
    'Whenever I say "break time" play lo-fi music and wait 15 minutes',
  ];

  return (
    <div className="nla-overlay" onClick={onClose}>
      <div className="nla-container" onClick={(e) => e.stopPropagation()}>
        <div className="nla-header">
          <div className="nla-title-row">
            <svg className="nla-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2a3 3 0 00-3 3v7a3 3 0 006 0V5a3 3 0 00-3-3z" />
              <path d="M19 10v2a7 7 0 01-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="22" />
            </svg>
            <h2>Voice Automation</h2>
          </div>
          <button className="nla-close" onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="nla-content">
          {/* Input Section */}
          <div className="nla-input-section">
            <div className="nla-input-header">
              <h3>Create a Workflow</h3>
              <button
                className="nla-examples-btn"
                onClick={() => setShowExamples(!showExamples)}
              >
                {showExamples ? 'Hide' : 'Show'} Examples
              </button>
            </div>

            {showExamples && (
              <div className="nla-examples">
                {examples.map((example, i) => (
                  <button
                    key={i}
                    className="nla-example"
                    onClick={() => {
                      setInputText(example);
                      const parsed = parseInput(example);
                      setParsedIntent(parsed);
                    }}
                  >
                    "{example}"
                  </button>
                ))}
              </div>
            )}

            <div className="nla-input-container">
              <textarea
                className="nla-input"
                value={inputText}
                onChange={handleInputChange}
                placeholder='Describe what you want in natural language... e.g., "When I say good morning, open Spotify and play my morning playlist"'
                rows={3}
              />
              <button
                className={`nla-voice-btn ${isListening ? 'listening' : ''}`}
                onClick={handleVoiceInput}
                disabled={isListening}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2a3 3 0 00-3 3v7a3 3 0 006 0V5a3 3 0 00-3-3z" />
                  <path d="M19 10v2a7 7 0 01-14 0v-2" />
                </svg>
              </button>
            </div>

            {/* Parsed Preview */}
            {parsedIntent && (
              <div className="nla-preview">
                <div className="nla-preview-header">
                  <span className="nla-preview-title">Parsed Intent</span>
                  <span className="nla-preview-confidence">
                    {Math.round(parsedIntent.confidence * 100)}% confident
                  </span>
                </div>
                <div className="nla-preview-trigger">
                  <span className="nla-trigger-label">Trigger:</span>
                  <span className="nla-trigger-value">"{parsedIntent.trigger}"</span>
                </div>
                <div className="nla-preview-actions">
                  <span className="nla-actions-label">Actions:</span>
                  {parsedIntent.actions.map((action) => (
                    <div key={action.id} className="nla-preview-action">
                      {getActionIcon(action.type)}
                      <span>{action.description}</span>
                    </div>
                  ))}
                </div>
                <button className="nla-create-btn" onClick={createWorkflow}>
                  Create Workflow
                </button>
              </div>
            )}
          </div>

          {/* Workflows List */}
          <div className="nla-workflows-section">
            <h3>Your Workflows</h3>
            <div className="nla-workflows">
              {workflows.length === 0 ? (
                <div className="nla-empty">
                  No workflows yet. Create one above!
                </div>
              ) : (
                workflows.map((workflow) => (
                  <div
                    key={workflow.id}
                    className={`nla-workflow ${selectedWorkflow?.id === workflow.id ? 'selected' : ''} ${!workflow.enabled ? 'disabled' : ''}`}
                    onClick={() => setSelectedWorkflow(workflow)}
                  >
                    <div className="nla-workflow-header">
                      <span className="nla-workflow-name">{workflow.name}</span>
                      <label className="nla-toggle" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={workflow.enabled}
                          onChange={() => toggleWorkflow(workflow.id)}
                        />
                        <span className="nla-toggle-slider" />
                      </label>
                    </div>
                    <div className="nla-workflow-trigger">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polygon points="5,3 19,12 5,21" />
                      </svg>
                      "{workflow.trigger}"
                    </div>
                    <div className="nla-workflow-meta">
                      <span>{workflow.actions.length} actions</span>
                      <span>{workflow.runCount} runs</span>
                    </div>
                    <button
                      className="nla-delete-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteWorkflow(workflow.id);
                      }}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="3,6 5,6 21,6" />
                        <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                      </svg>
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Workflow Detail */}
          {selectedWorkflow && (
            <div className="nla-detail">
              <h3>{selectedWorkflow.name}</h3>
              <div className="nla-detail-trigger">
                Trigger: "{selectedWorkflow.trigger}"
              </div>
              <div className="nla-detail-actions">
                {selectedWorkflow.actions.map((action, i) => (
                  <div key={action.id} className="nla-detail-action">
                    <div className={`nla-action-icon ${action.type}`}>
                      {getActionIcon(action.type)}
                    </div>
                    <div className="nla-action-info">
                      <span className="nla-action-type">{action.type}</span>
                      <span className="nla-action-desc">{action.description}</span>
                    </div>
                    {i < selectedWorkflow.actions.length - 1 && (
                      <div className="nla-action-arrow">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <line x1="12" y1="5" x2="12" y2="19" />
                          <polyline points="19,12 12,19 5,12" />
                        </svg>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default NaturalLanguageAutomation;
