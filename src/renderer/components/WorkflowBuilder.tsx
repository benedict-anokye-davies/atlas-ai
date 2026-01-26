/**
 * WorkflowBuilder
 * Visual workflow editor for creating multi-step automation
 */

import React, { useState, useCallback } from 'react';
import './WorkflowBuilder.css';

interface WorkflowStep {
  id: string;
  name: string;
  type: StepType;
  config: Record<string, unknown>;
  dependencies: string[];
}

type StepType = 
  | 'tool'
  | 'condition'
  | 'loop'
  | 'delay'
  | 'prompt'
  | 'script';

interface Workflow {
  id: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
  variables: Record<string, string>;
}

const STEP_TEMPLATES: Record<StepType, { icon: string; label: string; color: string }> = {
  tool: { icon: '\u2699', label: 'Tool', color: '#4a9eff' },
  condition: { icon: '\u2753', label: 'Condition', color: '#ff9f43' },
  loop: { icon: '\u21bb', label: 'Loop', color: '#a55eea' },
  delay: { icon: '\u23f1', label: 'Delay', color: '#26de81' },
  prompt: { icon: '\ud83d\udcac', label: 'Prompt', color: '#fd9644' },
  script: { icon: '\ud83d\udcdd', label: 'Script', color: '#fc5c65' }
};

const AVAILABLE_TOOLS = [
  'read_file', 'write_file', 'list_directory', 'search_files',
  'execute_command', 'git_status', 'git_commit', 'git_push',
  'screenshot', 'clipboard_read', 'clipboard_write',
  'browser_open', 'browser_click', 'browser_type'
];

export const WorkflowBuilder: React.FC = () => {
  const [workflow, setWorkflow] = useState<Workflow>({
    id: `workflow-${Date.now()}`,
    name: 'New Workflow',
    description: '',
    steps: [],
    variables: {}
  });
  
  const [selectedStep, setSelectedStep] = useState<string | null>(null);
  const [showStepPicker, setShowStepPicker] = useState(false);
  const [showVariableEditor, setShowVariableEditor] = useState(false);
  const [savedWorkflows, setSavedWorkflows] = useState<Workflow[]>([]);
  const [showLibrary, setShowLibrary] = useState(false);

  const addStep = useCallback((type: StepType) => {
    const newStep: WorkflowStep = {
      id: `step-${Date.now()}`,
      name: `${STEP_TEMPLATES[type].label} ${workflow.steps.length + 1}`,
      type,
      config: type === 'tool' ? { toolName: AVAILABLE_TOOLS[0], args: {} } : {},
      dependencies: workflow.steps.length > 0 
        ? [workflow.steps[workflow.steps.length - 1].id] 
        : []
    };
    
    setWorkflow(prev => ({
      ...prev,
      steps: [...prev.steps, newStep]
    }));
    setSelectedStep(newStep.id);
    setShowStepPicker(false);
  }, [workflow.steps]);

  const updateStep = useCallback((stepId: string, updates: Partial<WorkflowStep>) => {
    setWorkflow(prev => ({
      ...prev,
      steps: prev.steps.map(s => 
        s.id === stepId ? { ...s, ...updates } : s
      )
    }));
  }, []);

  const deleteStep = useCallback((stepId: string) => {
    setWorkflow(prev => ({
      ...prev,
      steps: prev.steps
        .filter(s => s.id !== stepId)
        .map(s => ({
          ...s,
          dependencies: s.dependencies.filter(d => d !== stepId)
        }))
    }));
    setSelectedStep(null);
  }, []);

  const moveStep = useCallback((stepId: string, direction: 'up' | 'down') => {
    setWorkflow(prev => {
      const index = prev.steps.findIndex(s => s.id === stepId);
      if (index === -1) return prev;
      
      const newIndex = direction === 'up' ? index - 1 : index + 1;
      if (newIndex < 0 || newIndex >= prev.steps.length) return prev;
      
      const newSteps = [...prev.steps];
      [newSteps[index], newSteps[newIndex]] = [newSteps[newIndex], newSteps[index]];
      
      return { ...prev, steps: newSteps };
    });
  }, []);

  const saveWorkflow = useCallback(() => {
    setSavedWorkflows(prev => {
      const existing = prev.findIndex(w => w.id === workflow.id);
      if (existing >= 0) {
        const updated = [...prev];
        updated[existing] = workflow;
        return updated;
      }
      return [...prev, workflow];
    });
    
    // Also save to localStorage
    try {
      const saved = JSON.parse(localStorage.getItem('atlas-workflows') || '[]');
      const existingIdx = saved.findIndex((w: Workflow) => w.id === workflow.id);
      if (existingIdx >= 0) {
        saved[existingIdx] = workflow;
      } else {
        saved.push(workflow);
      }
      localStorage.setItem('atlas-workflows', JSON.stringify(saved));
    } catch { /* Ignore */ }
  }, [workflow]);

  const loadWorkflow = useCallback((w: Workflow) => {
    setWorkflow(w);
    setSelectedStep(null);
    setShowLibrary(false);
  }, []);

  const executeWorkflow = useCallback(async () => {
    if (workflow.steps.length === 0) return;
    
    try {
      const atlasAny = window.atlas as unknown as Record<string, unknown>;
      if (atlasAny?.workflow && typeof atlasAny.workflow === 'object') {
        const workflowApi = atlasAny.workflow as { execute?: (w: Workflow) => Promise<unknown> };
        await workflowApi.execute?.(workflow);
      } else {
        console.log('Workflow execution:', workflow);
        alert('Workflow submitted for execution');
      }
    } catch (error) {
      console.error('Failed to execute workflow:', error);
    }
  }, [workflow]);

  const renderStepConfig = (step: WorkflowStep) => {
    switch (step.type) {
      case 'tool':
        return (
          <div className="step-config">
            <label>Tool</label>
            <select
              value={(step.config.toolName as string) || AVAILABLE_TOOLS[0]}
              onChange={(e) => updateStep(step.id, { 
                config: { ...step.config, toolName: e.target.value } 
              })}
            >
              {AVAILABLE_TOOLS.map(tool => (
                <option key={tool} value={tool}>{tool}</option>
              ))}
            </select>
            
            <label>Arguments (JSON)</label>
            <textarea
              value={JSON.stringify(step.config.args || {}, null, 2)}
              onChange={(e) => {
                try {
                  const args = JSON.parse(e.target.value);
                  updateStep(step.id, { config: { ...step.config, args } });
                } catch { /* Invalid JSON, ignore */ }
              }}
              rows={4}
            />
          </div>
        );
        
      case 'condition':
        return (
          <div className="step-config">
            <label>Condition Expression</label>
            <input
              type="text"
              value={(step.config.expression as string) || ''}
              onChange={(e) => updateStep(step.id, { 
                config: { ...step.config, expression: e.target.value } 
              })}
              placeholder="e.g., {{result}} === 'success'"
            />
          </div>
        );
        
      case 'loop':
        return (
          <div className="step-config">
            <label>Iterations</label>
            <input
              type="number"
              value={(step.config.iterations as number) || 1}
              onChange={(e) => updateStep(step.id, { 
                config: { ...step.config, iterations: parseInt(e.target.value) || 1 } 
              })}
              min={1}
              max={100}
            />
            
            <label>Or iterate over variable</label>
            <input
              type="text"
              value={(step.config.iterateOver as string) || ''}
              onChange={(e) => updateStep(step.id, { 
                config: { ...step.config, iterateOver: e.target.value } 
              })}
              placeholder="e.g., {{files}}"
            />
          </div>
        );
        
      case 'delay':
        return (
          <div className="step-config">
            <label>Delay (ms)</label>
            <input
              type="number"
              value={(step.config.delayMs as number) || 1000}
              onChange={(e) => updateStep(step.id, { 
                config: { ...step.config, delayMs: parseInt(e.target.value) || 1000 } 
              })}
              min={100}
              step={100}
            />
          </div>
        );
        
      case 'prompt':
        return (
          <div className="step-config">
            <label>Prompt Message</label>
            <textarea
              value={(step.config.message as string) || ''}
              onChange={(e) => updateStep(step.id, { 
                config: { ...step.config, message: e.target.value } 
              })}
              rows={3}
              placeholder="Ask user for input..."
            />
            
            <label>Variable to store response</label>
            <input
              type="text"
              value={(step.config.storeAs as string) || ''}
              onChange={(e) => updateStep(step.id, { 
                config: { ...step.config, storeAs: e.target.value } 
              })}
              placeholder="e.g., userInput"
            />
          </div>
        );
        
      case 'script':
        return (
          <div className="step-config">
            <label>JavaScript Code</label>
            <textarea
              value={(step.config.code as string) || ''}
              onChange={(e) => updateStep(step.id, { 
                config: { ...step.config, code: e.target.value } 
              })}
              rows={8}
              placeholder="// Access variables with context.variables&#10;// Return value is stored as step result"
            />
          </div>
        );
        
      default:
        return null;
    }
  };

  const selectedStepData = workflow.steps.find(s => s.id === selectedStep);

  return (
    <div className="workflow-builder">
      <div className="workflow-header">
        <div className="workflow-info">
          <input
            type="text"
            className="workflow-name-input"
            value={workflow.name}
            onChange={(e) => setWorkflow(prev => ({ ...prev, name: e.target.value }))}
            placeholder="Workflow Name"
          />
          <input
            type="text"
            className="workflow-desc-input"
            value={workflow.description}
            onChange={(e) => setWorkflow(prev => ({ ...prev, description: e.target.value }))}
            placeholder="Description (optional)"
          />
        </div>
        
        <div className="workflow-actions">
          <button 
            className="action-btn library"
            onClick={() => setShowLibrary(!showLibrary)}
          >
            Library
          </button>
          <button 
            className="action-btn variables"
            onClick={() => setShowVariableEditor(!showVariableEditor)}
          >
            Variables
          </button>
          <button className="action-btn save" onClick={saveWorkflow}>
            Save
          </button>
          <button 
            className="action-btn execute"
            onClick={executeWorkflow}
            disabled={workflow.steps.length === 0}
          >
            Execute
          </button>
        </div>
      </div>

      {showLibrary && (
        <div className="workflow-library">
          <h4>Saved Workflows</h4>
          {savedWorkflows.length === 0 ? (
            <p className="empty-message">No saved workflows yet</p>
          ) : (
            <div className="library-list">
              {savedWorkflows.map(w => (
                <div 
                  key={w.id} 
                  className="library-item"
                  onClick={() => loadWorkflow(w)}
                >
                  <span className="item-name">{w.name}</span>
                  <span className="item-steps">{w.steps.length} steps</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {showVariableEditor && (
        <div className="variable-editor">
          <h4>Workflow Variables</h4>
          {Object.entries(workflow.variables).map(([key, value]) => (
            <div key={key} className="variable-row">
              <input
                type="text"
                value={key}
                onChange={(e) => {
                  const newVars = { ...workflow.variables };
                  delete newVars[key];
                  newVars[e.target.value] = value;
                  setWorkflow(prev => ({ ...prev, variables: newVars }));
                }}
                placeholder="Variable name"
              />
              <input
                type="text"
                value={value}
                onChange={(e) => {
                  setWorkflow(prev => ({
                    ...prev,
                    variables: { ...prev.variables, [key]: e.target.value }
                  }));
                }}
                placeholder="Default value"
              />
              <button 
                className="remove-var"
                onClick={() => {
                  const newVars = { ...workflow.variables };
                  delete newVars[key];
                  setWorkflow(prev => ({ ...prev, variables: newVars }));
                }}
              >
                x
              </button>
            </div>
          ))}
          <button 
            className="add-variable"
            onClick={() => {
              const key = `var${Object.keys(workflow.variables).length + 1}`;
              setWorkflow(prev => ({
                ...prev,
                variables: { ...prev.variables, [key]: '' }
              }));
            }}
          >
            + Add Variable
          </button>
        </div>
      )}

      <div className="workflow-canvas">
        <div className="steps-container">
          {workflow.steps.map((step, index) => {
            const template = STEP_TEMPLATES[step.type];
            return (
              <React.Fragment key={step.id}>
                {index > 0 && <div className="step-connector" />}
                <div
                  className={`workflow-step ${selectedStep === step.id ? 'selected' : ''}`}
                  style={{ borderColor: template.color }}
                  onClick={() => setSelectedStep(step.id)}
                >
                  <div 
                    className="step-icon"
                    style={{ backgroundColor: template.color }}
                  >
                    {template.icon}
                  </div>
                  <div className="step-content">
                    <span className="step-name">{step.name}</span>
                    <span className="step-type">{template.label}</span>
                  </div>
                  <div className="step-actions">
                    <button 
                      onClick={(e) => { e.stopPropagation(); moveStep(step.id, 'up'); }}
                      disabled={index === 0}
                    >
                      up
                    </button>
                    <button 
                      onClick={(e) => { e.stopPropagation(); moveStep(step.id, 'down'); }}
                      disabled={index === workflow.steps.length - 1}
                    >
                      dn
                    </button>
                    <button 
                      className="delete"
                      onClick={(e) => { e.stopPropagation(); deleteStep(step.id); }}
                    >
                      x
                    </button>
                  </div>
                </div>
              </React.Fragment>
            );
          })}
          
          <button 
            className="add-step-btn"
            onClick={() => setShowStepPicker(true)}
          >
            + Add Step
          </button>
        </div>

        {selectedStepData && (
          <div className="step-editor">
            <h4>Edit Step</h4>
            <label>Step Name</label>
            <input
              type="text"
              value={selectedStepData.name}
              onChange={(e) => updateStep(selectedStepData.id, { name: e.target.value })}
            />
            
            {renderStepConfig(selectedStepData)}
          </div>
        )}
      </div>

      {showStepPicker && (
        <div className="step-picker-overlay" onClick={() => setShowStepPicker(false)}>
          <div className="step-picker" onClick={e => e.stopPropagation()}>
            <h4>Select Step Type</h4>
            <div className="step-type-grid">
              {(Object.entries(STEP_TEMPLATES) as [StepType, typeof STEP_TEMPLATES[StepType]][]).map(([type, template]) => (
                <button
                  key={type}
                  className="step-type-btn"
                  style={{ borderColor: template.color }}
                  onClick={() => addStep(type)}
                >
                  <span className="icon" style={{ color: template.color }}>{template.icon}</span>
                  <span className="label">{template.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default WorkflowBuilder;
