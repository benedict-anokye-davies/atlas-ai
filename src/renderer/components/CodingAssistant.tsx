/**
 * @file Coding Assistant Panel
 * @description UI component for visual feedback during coding operations
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import './CodingAssistant.css';

// Types for coding agent communication
interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

interface ToolResult {
  success: boolean;
  output?: string;
  error?: string;
  duration?: number;
  filesAffected?: string[];
}

interface CodingSession {
  id: string;
  state: 'idle' | 'thinking' | 'executing' | 'waiting-for-tool' | 'error' | 'complete';
  filesModified: string[];
  toolCalls: Array<{
    id: string;
    name: string;
    result: ToolResult;
    startTime: number;
    endTime: number;
  }>;
  errors: string[];
}

interface StreamChunk {
  type: 'text' | 'tool-call' | 'tool-result' | 'thinking' | 'error' | 'complete';
  content?: string;
  toolCall?: ToolCall;
  toolResult?: ToolResult;
  state?: string;
  progress?: number;
}

interface CodingAssistantProps {
  isOpen: boolean;
  onClose: () => void;
  onExecute?: (prompt: string) => void;
}

// Tool icon mapping
const TOOL_ICONS: Record<string, string> = {
  read_file: '📖',
  create_file: '📝',
  edit_file: '✏️',
  delete_file: '🗑️',
  list_directory: '📁',
  grep_search: '🔍',
  find_symbol: '🎯',
  get_errors: '⚠️',
  run_command: '▶️',
  git_status: '📊',
  git_diff: '📋',
};

/**
 * Coding Assistant Panel Component
 */
export const CodingAssistant: React.FC<CodingAssistantProps> = ({
  isOpen,
  onClose,
  onExecute,
}) => {
  const [prompt, setPrompt] = useState('');
  const [isExecuting, setIsExecuting] = useState(false);
  const [session, setSession] = useState<CodingSession | null>(null);
  const [streamOutput, setStreamOutput] = useState<string[]>([]);
  const [toolCalls, setToolCalls] = useState<Array<{ call: ToolCall; result?: ToolResult }>>([]);
  const [progress, setProgress] = useState(0);
  const [currentThinking, setCurrentThinking] = useState('');
  const outputRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom when new output arrives
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [streamOutput, toolCalls]);

  // Listen for coding agent events
  useEffect(() => {
    if (!window.atlas) return;

    const handleStreamChunk = (_event: unknown, chunk: StreamChunk) => {
      switch (chunk.type) {
        case 'text':
          if (chunk.content) {
            setStreamOutput(prev => [...prev, chunk.content!]);
          }
          break;
        case 'tool-call':
          if (chunk.toolCall) {
            setToolCalls(prev => [...prev, { call: chunk.toolCall! }]);
          }
          break;
        case 'tool-result':
          if (chunk.toolResult) {
            setToolCalls(prev => {
              const updated = [...prev];
              const lastCall = updated[updated.length - 1];
              if (lastCall && !lastCall.result) {
                lastCall.result = chunk.toolResult;
              }
              return updated;
            });
          }
          break;
        case 'thinking':
          setCurrentThinking(chunk.content || '');
          break;
        case 'error':
          setStreamOutput(prev => [...prev, `Error: ${chunk.content}`]);
          break;
        case 'complete':
          setIsExecuting(false);
          setCurrentThinking('');
          break;
      }

      if (chunk.progress !== undefined) {
        setProgress(chunk.progress);
      }
    };

    const handleSessionStart = (_event: unknown, newSession: CodingSession) => {
      setSession(newSession);
      setStreamOutput([]);
      setToolCalls([]);
      setProgress(0);
    };

    const handleSessionEnd = (_event: unknown, endedSession: CodingSession) => {
      setSession(endedSession);
      setIsExecuting(false);
    };

    const handleStateChange = (_event: unknown, data: { state: string; sessionId: string }) => {
      setSession(prev => prev ? { ...prev, state: data.state as CodingSession['state'] } : null);
    };

    // Register event listeners with type-safe handlers
    const removeChunk = window.atlas.on?.('coding:stream-chunk', handleStreamChunk as (...args: unknown[]) => void);
    const removeStart = window.atlas.on?.('coding:session-start', handleSessionStart as (...args: unknown[]) => void);
    const removeEnd = window.atlas.on?.('coding:session-end', handleSessionEnd as (...args: unknown[]) => void);
    const removeState = window.atlas.on?.('coding:state-change', handleStateChange as (...args: unknown[]) => void);

    return () => {
      removeChunk?.();
      removeStart?.();
      removeEnd?.();
      removeState?.();
    };
  }, []);

  // Execute coding task
  const handleExecute = useCallback(async () => {
    if (!prompt.trim() || isExecuting) return;

    setIsExecuting(true);
    setStreamOutput([]);
    setToolCalls([]);
    setProgress(0);
    setCurrentThinking('Analyzing request...');

    try {
      if (onExecute) {
        onExecute(prompt);
      } else if (window.atlas?.coding?.executeStream) {
        await window.atlas.coding.executeStream({ prompt });
      }
    } catch (error) {
      setStreamOutput(prev => [...prev, `Error: ${error}`]);
      setIsExecuting(false);
    }
  }, [prompt, isExecuting, onExecute]);

  // Handle keyboard shortcuts
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleExecute();
    }
    if (e.key === 'Escape') {
      if (isExecuting) {
        handleAbort();
      } else {
        onClose();
      }
    }
  };

  // Abort current task
  const handleAbort = useCallback(async () => {
    if (window.atlas?.coding?.abort) {
      await window.atlas.coding.abort();
    }
    setIsExecuting(false);
    setCurrentThinking('');
  }, []);

  // Rollback last edit
  const handleRollback = useCallback(async () => {
    if (window.atlas?.coding?.rollback) {
      const result = await window.atlas.coding.rollback(1);
      if (result.success && result.data) {
        setStreamOutput(prev => [...prev, `Rolled back ${result.data?.rolledBack} edit(s)`]);
      }
    }
  }, []);

  if (!isOpen) return null;

  return (
    <div className="coding-assistant-overlay" onClick={onClose}>
      <div className="coding-assistant-panel" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="coding-assistant-header">
          <div className="coding-assistant-title">
            <span className="coding-icon">🤖</span>
            <h2>Coding Agent</h2>
            {session?.state && (
              <span className={`state-badge state-${session.state}`}>
                {session.state}
              </span>
            )}
          </div>
          <div className="coding-assistant-actions">
            {toolCalls.length > 0 && (
              <button
                className="action-btn rollback-btn"
                onClick={handleRollback}
                title="Rollback last edit"
              >
                ↩️ Undo
              </button>
            )}
            <button className="close-btn" onClick={onClose}>
              ×
            </button>
          </div>
        </div>

        {/* Input area */}
        <div className="coding-assistant-input">
          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="What would you like me to code? (Ctrl+Enter to execute)"
            disabled={isExecuting}
            rows={3}
          />
          <div className="input-actions">
            {isExecuting ? (
              <button className="abort-btn" onClick={handleAbort}>
                ⏹ Abort
              </button>
            ) : (
              <button
                className="execute-btn"
                onClick={handleExecute}
                disabled={!prompt.trim()}
              >
                ▶ Execute
              </button>
            )}
          </div>
        </div>

        {/* Progress bar */}
        {isExecuting && (
          <div className="coding-progress">
            <div
              className="coding-progress-bar"
              style={{ width: `${progress}%` }}
            />
            {currentThinking && (
              <span className="thinking-text">{currentThinking}</span>
            )}
          </div>
        )}

        {/* Output area */}
        <div className="coding-assistant-output" ref={outputRef}>
          {/* Tool calls */}
          {toolCalls.map((tc, index) => (
            <div key={index} className="tool-call-item">
              <div className="tool-call-header">
                <span className="tool-icon">
                  {TOOL_ICONS[tc.call.name] || '🔧'}
                </span>
                <span className="tool-name">{tc.call.name}</span>
                {tc.result && (
                  <span className={`tool-status ${tc.result.success ? 'success' : 'error'}`}>
                    {tc.result.success ? '✓' : '✗'}
                  </span>
                )}
                {tc.result?.duration && (
                  <span className="tool-duration">{tc.result.duration}ms</span>
                )}
              </div>
              {tc.call.arguments && Object.keys(tc.call.arguments).length > 0 && (
                <div className="tool-args">
                  {Object.entries(tc.call.arguments).map(([key, value]) => (
                    <div key={key} className="tool-arg">
                      <span className="arg-key">{key}:</span>
                      <span className="arg-value">
                        {typeof value === 'string'
                          ? value.length > 100
                            ? value.substring(0, 100) + '...'
                            : value
                          : JSON.stringify(value)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {tc.result && (
                <div className={`tool-result ${tc.result.success ? '' : 'error'}`}>
                  {tc.result.error ? (
                    <span className="error-text">{tc.result.error}</span>
                  ) : tc.result.output ? (
                    <pre className="result-output">
                      {tc.result.output.length > 500
                        ? tc.result.output.substring(0, 500) + '...'
                        : tc.result.output}
                    </pre>
                  ) : (
                    <span className="success-text">Success</span>
                  )}
                  {tc.result.filesAffected && tc.result.filesAffected.length > 0 && (
                    <div className="files-affected">
                      Files: {tc.result.filesAffected.join(', ')}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}

          {/* Stream output */}
          {streamOutput.map((text, index) => (
            <div key={index} className="stream-output-item">
              {text}
            </div>
          ))}

          {/* Empty state */}
          {!isExecuting && toolCalls.length === 0 && streamOutput.length === 0 && (
            <div className="empty-state">
              <div className="empty-icon">💻</div>
              <p>Tell me what code changes you need.</p>
              <p className="hint">Examples:</p>
              <ul className="examples">
                <li onClick={() => setPrompt('Fix all TypeScript errors')}>
                  "Fix all TypeScript errors"
                </li>
                <li onClick={() => setPrompt('Create a new React component for user settings')}>
                  "Create a new React component for user settings"
                </li>
                <li onClick={() => setPrompt('Add error handling to the API calls')}>
                  "Add error handling to the API calls"
                </li>
                <li onClick={() => setPrompt('Refactor this function to be more readable')}>
                  "Refactor this function to be more readable"
                </li>
              </ul>
            </div>
          )}
        </div>

        {/* Footer with session info */}
        {session && (
          <div className="coding-assistant-footer">
            <span>Session: {session.id.substring(0, 8)}</span>
            <span>Tools: {toolCalls.length}</span>
            <span>Files: {session.filesModified?.length || 0}</span>
            {session.errors?.length > 0 && (
              <span className="error-count">Errors: {session.errors.length}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default CodingAssistant;
