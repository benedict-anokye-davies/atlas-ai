/**
 * Atlas Desktop - Context Window Display
 * Show LLM context window usage and token counts
 */

import React, { useState, useEffect, useCallback } from 'react';
import './ContextWindowDisplay.css';

interface ContextWindowProps {
  isVisible: boolean;
  onClose: () => void;
}

interface ContextSegment {
  id: string;
  type: 'system' | 'memory' | 'tools' | 'conversation' | 'user' | 'assistant';
  label: string;
  tokens: number;
  content?: string;
}

interface ContextStats {
  totalTokens: number;
  maxTokens: number;
  inputTokens: number;
  outputTokens: number;
  segments: ContextSegment[];
}

const ContextWindowDisplay: React.FC<ContextWindowProps> = ({
  isVisible,
  onClose,
}) => {
  const [stats, setStats] = useState<ContextStats>({
    totalTokens: 0,
    maxTokens: 128000,
    inputTokens: 0,
    outputTokens: 0,
    segments: [],
  });
  const [selectedSegment, setSelectedSegment] = useState<ContextSegment | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  // Load context stats from Atlas API
  useEffect(() => {
    const fetchContextStats = async () => {
      try {
        // Try to get real context data from Atlas
        const metricsResult = await window.atlas?.atlas?.getMetrics?.();
        const memoryResult = await window.atlas?.atlas?.getMemoryStats?.();
        const historyResult = await window.atlas?.atlas?.getConversationHistory?.(10);
        
        const segments: ContextSegment[] = [];
        const systemTokens = 850; // Base system prompt
        let memoryTokens = 0;
        let toolsTokens = 4200; // Tool definitions are relatively stable
        let conversationTokens = 0;
        let userTokens = 0;

        // System prompt segment
        segments.push({
          id: '1',
          type: 'system',
          label: 'System Prompt',
          tokens: systemTokens,
          content: 'You are Atlas, a voice-first AI desktop assistant built with advanced natural language understanding...',
        });

        // Memory stats
        if (memoryResult?.success && memoryResult.data) {
          const memData = memoryResult.data as { 
            totalEntries?: number; 
            totalTokens?: number;
            entries?: number;
          };
          memoryTokens = memData.totalTokens || (memData.totalEntries || memData.entries || 0) * 50;
          segments.push({
            id: '2',
            type: 'memory',
            label: 'Long-term Memory',
            tokens: memoryTokens,
            content: `${memData.totalEntries || memData.entries || 0} memory entries stored`,
          });
        } else {
          segments.push({
            id: '2',
            type: 'memory',
            label: 'Long-term Memory',
            tokens: 500,
            content: 'Memory entries loaded from local database',
          });
          memoryTokens = 500;
        }

        // Tools segment
        const toolsResult = await window.atlas?.tools?.getSummary?.();
        if (toolsResult?.success && toolsResult.data) {
          const toolData = toolsResult.data as { total?: number; categories?: Record<string, number> };
          toolsTokens = (toolData.total || 45) * 100; // Estimate ~100 tokens per tool definition
          segments.push({
            id: '3',
            type: 'tools',
            label: 'Tool Definitions',
            tokens: toolsTokens,
            content: `${toolData.total || 45} tools available across ${Object.keys(toolData.categories || {}).length} categories`,
          });
        } else {
          segments.push({
            id: '3',
            type: 'tools',
            label: 'Tool Definitions',
            tokens: toolsTokens,
            content: '45+ tools available: read_file, write_file, execute_command, git_status, browser_navigate...',
          });
        }

        // Conversation history
        if (historyResult?.success && historyResult.data) {
          const history = historyResult.data as Array<{ content?: string; role?: string }>;
          // Estimate tokens from message content
          conversationTokens = history.reduce((sum, msg) => {
            return sum + Math.ceil((msg.content?.length || 0) / 4); // ~4 chars per token
          }, 0);
          segments.push({
            id: '4',
            type: 'conversation',
            label: 'Conversation History',
            tokens: conversationTokens,
            content: `${history.length} messages in current session`,
          });
        } else {
          conversationTokens = 1000;
          segments.push({
            id: '4',
            type: 'conversation',
            label: 'Conversation History',
            tokens: conversationTokens,
            content: 'Recent conversation messages',
          });
        }

        // Current user input placeholder
        userTokens = 50;
        segments.push({
          id: '5',
          type: 'user',
          label: 'Current User Input',
          tokens: userTokens,
          content: 'Waiting for input...',
        });

        const total = segments.reduce((sum, s) => sum + s.tokens, 0);
        
        // Get max tokens from metrics if available
        let maxTokens = 128000;
        if (metricsResult?.success && metricsResult.data) {
          const mData = metricsResult.data as { maxContextTokens?: number };
          maxTokens = mData.maxContextTokens || 128000;
        }

        setStats({
          totalTokens: total,
          maxTokens,
          inputTokens: total,
          outputTokens: 0,
          segments,
        });
      } catch (error) {
        console.error('[ContextWindowDisplay] Failed to fetch context stats:', error);
        // Fallback to demo data
        const mockSegments: ContextSegment[] = [
          { id: '1', type: 'system', label: 'System Prompt', tokens: 850, content: 'System instructions...' },
          { id: '2', type: 'memory', label: 'Long-term Memory', tokens: 2340, content: 'User preferences...' },
          { id: '3', type: 'tools', label: 'Tool Definitions', tokens: 4200, content: 'Available tools...' },
          { id: '4', type: 'conversation', label: 'Conversation History', tokens: 8500, content: 'Messages...' },
          { id: '5', type: 'user', label: 'Current User Input', tokens: 120, content: 'User query...' },
        ];
        const total = mockSegments.reduce((sum, s) => sum + s.tokens, 0);
        setStats({ totalTokens: total, maxTokens: 128000, inputTokens: total, outputTokens: 0, segments: mockSegments });
      }
    };

    if (isVisible) {
      fetchContextStats();
    }
  }, [isVisible]);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showDetails) {
          setShowDetails(false);
          setSelectedSegment(null);
        } else {
          onClose();
        }
      }
    };
    if (isVisible) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
    return undefined;
  }, [isVisible, onClose, showDetails]);

  // Get segment color
  const getSegmentColor = (type: ContextSegment['type']) => {
    switch (type) {
      case 'system':
        return '#a78bfa';
      case 'memory':
        return '#10b981';
      case 'tools':
        return '#f59e0b';
      case 'conversation':
        return '#60a5fa';
      case 'user':
        return '#ec4899';
      case 'assistant':
        return '#8b5cf6';
      default:
        return '#9ca3af';
    }
  };

  // Get segment icon
  const getSegmentIcon = (type: ContextSegment['type']) => {
    switch (type) {
      case 'system':
        return (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
          </svg>
        );
      case 'memory':
        return (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2v-4M9 21H5a2 2 0 01-2-2v-4" />
          </svg>
        );
      case 'tools':
        return (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" />
          </svg>
        );
      case 'conversation':
        return (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
          </svg>
        );
      case 'user':
        return (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        );
      case 'assistant':
        return (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <path d="M8 14s1.5 2 4 2 4-2 4-2" />
            <line x1="9" y1="9" x2="9.01" y2="9" />
            <line x1="15" y1="9" x2="15.01" y2="9" />
          </svg>
        );
      default:
        return null;
    }
  };

  // Format token count
  const formatTokens = (tokens: number) => {
    if (tokens >= 1000) {
      return `${(tokens / 1000).toFixed(1)}k`;
    }
    return tokens.toString();
  };

  // Calculate percentage
  const percentage = (stats.totalTokens / stats.maxTokens) * 100;

  // Determine usage level
  const getUsageLevel = () => {
    if (percentage < 50) return 'low';
    if (percentage < 75) return 'medium';
    if (percentage < 90) return 'high';
    return 'critical';
  };

  // View segment details
  const viewSegment = useCallback((segment: ContextSegment) => {
    setSelectedSegment(segment);
    setShowDetails(true);
  }, []);

  if (!isVisible) return null;

  return (
    <div className="ctx-overlay" onClick={onClose}>
      <div className="ctx-container" onClick={(e) => e.stopPropagation()}>
        <div className="ctx-header">
          <div className="ctx-title-row">
            <svg className="ctx-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <line x1="3" y1="9" x2="21" y2="9" />
              <line x1="9" y1="21" x2="9" y2="9" />
            </svg>
            <h2>Context Window</h2>
          </div>
          <button className="ctx-close" onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="ctx-content">
          {/* Usage Overview */}
          <div className="ctx-usage-card">
            <div className="ctx-usage-header">
              <div className="ctx-usage-title">
                <h3>Token Usage</h3>
                <span className={`ctx-usage-badge ${getUsageLevel()}`}>
                  {percentage.toFixed(1)}% used
                </span>
              </div>
              <div className="ctx-usage-values">
                <span className="ctx-current">{formatTokens(stats.totalTokens)}</span>
                <span className="ctx-separator">/</span>
                <span className="ctx-max">{formatTokens(stats.maxTokens)}</span>
              </div>
            </div>

            {/* Progress Bar */}
            <div className="ctx-progress">
              <div className="ctx-progress-bg">
                {stats.segments.map((segment) => (
                  <div
                    key={segment.id}
                    className="ctx-progress-segment"
                    style={{
                      width: `${(segment.tokens / stats.maxTokens) * 100}%`,
                      backgroundColor: getSegmentColor(segment.type),
                    }}
                    title={`${segment.label}: ${formatTokens(segment.tokens)} tokens`}
                  />
                ))}
              </div>
              <div className="ctx-progress-markers">
                <span className="marker" style={{ left: '50%' }}>50%</span>
                <span className="marker" style={{ left: '75%' }}>75%</span>
                <span className="marker" style={{ left: '90%' }}>90%</span>
              </div>
            </div>

            {/* Quick Stats */}
            <div className="ctx-quick-stats">
              <div className="ctx-stat">
                <span className="ctx-stat-label">Available</span>
                <span className="ctx-stat-value">{formatTokens(stats.maxTokens - stats.totalTokens)}</span>
              </div>
              <div className="ctx-stat">
                <span className="ctx-stat-label">Model</span>
                <span className="ctx-stat-value">Llama-3.3-70B</span>
              </div>
              <div className="ctx-stat">
                <span className="ctx-stat-label">Segments</span>
                <span className="ctx-stat-value">{stats.segments.length}</span>
              </div>
            </div>
          </div>

          {/* Segments Breakdown */}
          <div className="ctx-segments-section">
            <h3>Context Breakdown</h3>
            <div className="ctx-segments">
              {stats.segments.map((segment) => (
                <div
                  key={segment.id}
                  className="ctx-segment"
                  onClick={() => viewSegment(segment)}
                >
                  <div
                    className="ctx-segment-indicator"
                    style={{ backgroundColor: getSegmentColor(segment.type) }}
                  />
                  <div className="ctx-segment-icon" style={{ color: getSegmentColor(segment.type) }}>
                    {getSegmentIcon(segment.type)}
                  </div>
                  <div className="ctx-segment-info">
                    <span className="ctx-segment-label">{segment.label}</span>
                    <span className="ctx-segment-type">{segment.type}</span>
                  </div>
                  <div className="ctx-segment-stats">
                    <span className="ctx-segment-tokens">{formatTokens(segment.tokens)}</span>
                    <span className="ctx-segment-percent">
                      {((segment.tokens / stats.totalTokens) * 100).toFixed(1)}%
                    </span>
                  </div>
                  <svg className="ctx-segment-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="9,18 15,12 9,6" />
                  </svg>
                </div>
              ))}
            </div>
          </div>

          {/* Tips */}
          <div className="ctx-tips">
            <h4>Optimization Tips</h4>
            <ul>
              <li>Clear old conversation history to free up tokens</li>
              <li>Use summarization for long-term memory entries</li>
              <li>Reduce tool definitions if not needed</li>
            </ul>
          </div>
        </div>

        {/* Detail Slide-in */}
        {showDetails && selectedSegment && (
          <div className="ctx-detail-overlay" onClick={() => setShowDetails(false)}>
            <div className="ctx-detail" onClick={(e) => e.stopPropagation()}>
              <div className="ctx-detail-header">
                <div
                  className="ctx-detail-icon"
                  style={{ backgroundColor: `${getSegmentColor(selectedSegment.type)}20`, color: getSegmentColor(selectedSegment.type) }}
                >
                  {getSegmentIcon(selectedSegment.type)}
                </div>
                <div className="ctx-detail-title">
                  <h3>{selectedSegment.label}</h3>
                  <span>{formatTokens(selectedSegment.tokens)} tokens</span>
                </div>
                <button className="ctx-detail-close" onClick={() => setShowDetails(false)}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
              <div className="ctx-detail-content">
                <pre>{selectedSegment.content}</pre>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ContextWindowDisplay;
