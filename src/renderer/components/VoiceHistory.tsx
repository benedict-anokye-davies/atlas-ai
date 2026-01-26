/**
 * Atlas Desktop - Voice History Panel
 * Searchable log of past voice commands with metadata
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import './VoiceHistory.css';

// ============================================================================
// Types
// ============================================================================

interface VoiceCommand {
  id: string;
  timestamp: number;
  transcript: string;
  response?: string;
  duration: number;
  confidence: number;
  status: 'success' | 'error' | 'partial';
  toolsUsed?: string[];
}

interface VoiceHistoryProps {
  isVisible: boolean;
  onClose: () => void;
}

// ============================================================================
// Icons
// ============================================================================

const MicIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <line x1="12" y1="19" x2="12" y2="23" />
    <line x1="8" y1="23" x2="16" y2="23" />
  </svg>
);

const SearchIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

const XIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const CheckIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const AlertIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="8" x2="12" y2="12" />
    <line x1="12" y1="16" x2="12.01" y2="16" />
  </svg>
);

const CopyIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

const TrashIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

const FilterIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
  </svg>
);

const CalendarIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </svg>
);

// ============================================================================
// Main Component
// ============================================================================

export const VoiceHistory: React.FC<VoiceHistoryProps> = ({ isVisible, onClose }) => {
  const [commands, setCommands] = useState<VoiceCommand[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'success' | 'error'>('all');
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | 'week' | 'month'>('all');
  const [selectedCommand, setSelectedCommand] = useState<VoiceCommand | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Load history on mount
  useEffect(() => {
    if (isVisible) {
      loadHistory();
    }
  }, [isVisible]);

  const loadHistory = async () => {
    setIsLoading(true);
    try {
      // Try to load from IPC first
      const result = await window.atlas?.atlas?.getConversationHistory?.(100);
      if (result?.success && result.data) {
        // Transform conversation history to voice commands
        const history = result.data as Array<{
          id: string;
          timestamp: number;
          role: string;
          content: string;
          metadata?: { confidence?: number; duration?: number; tools?: string[] };
        }>;
        
        const userCommands = history
          .filter(msg => msg.role === 'user')
          .map((msg, i) => {
            const assistantResponse = history.find(
              h => h.role === 'assistant' && h.timestamp > msg.timestamp
            );
            return {
              id: msg.id || `cmd-${i}`,
              timestamp: msg.timestamp,
              transcript: msg.content,
              response: assistantResponse?.content,
              duration: msg.metadata?.duration || 0,
              confidence: msg.metadata?.confidence || 0.95,
              status: 'success' as const,
              toolsUsed: msg.metadata?.tools,
            };
          });
        setCommands(userCommands);
      } else {
        // Fall back to localStorage
        const stored = localStorage.getItem('atlas:voice-history');
        if (stored) {
          setCommands(JSON.parse(stored));
        }
      }
    } catch (error) {
      console.error('Failed to load voice history:', error);
      // Fall back to localStorage
      const stored = localStorage.getItem('atlas:voice-history');
      if (stored) {
        setCommands(JSON.parse(stored));
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Filter commands
  const filteredCommands = useMemo(() => {
    let filtered = commands;

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(cmd => 
        cmd.transcript.toLowerCase().includes(query) ||
        cmd.response?.toLowerCase().includes(query)
      );
    }

    // Status filter
    if (filterStatus !== 'all') {
      filtered = filtered.filter(cmd => cmd.status === filterStatus);
    }

    // Date filter
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    switch (dateFilter) {
      case 'today':
        filtered = filtered.filter(cmd => now - cmd.timestamp < day);
        break;
      case 'week':
        filtered = filtered.filter(cmd => now - cmd.timestamp < 7 * day);
        break;
      case 'month':
        filtered = filtered.filter(cmd => now - cmd.timestamp < 30 * day);
        break;
    }

    return filtered.sort((a, b) => b.timestamp - a.timestamp);
  }, [commands, searchQuery, filterStatus, dateFilter]);

  // Copy to clipboard
  const copyCommand = useCallback((cmd: VoiceCommand) => {
    const text = cmd.response 
      ? `User: ${cmd.transcript}\nAtlas: ${cmd.response}`
      : cmd.transcript;
    navigator.clipboard.writeText(text);
  }, []);

  // Delete command
  const deleteCommand = useCallback((id: string) => {
    const updated = commands.filter(c => c.id !== id);
    setCommands(updated);
    localStorage.setItem('atlas:voice-history', JSON.stringify(updated));
    if (selectedCommand?.id === id) {
      setSelectedCommand(null);
    }
  }, [commands, selectedCommand]);

  // Clear all history
  const clearHistory = useCallback(() => {
    if (confirm('Are you sure you want to clear all voice history?')) {
      setCommands([]);
      localStorage.removeItem('atlas:voice-history');
      setSelectedCommand(null);
    }
  }, []);

  // Format timestamp
  const formatTime = (timestamp: number): string => {
    const date = new Date(timestamp);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    
    if (isToday) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' }) + 
           ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  // Format duration
  const formatDuration = (ms: number): string => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  // Stats
  const stats = useMemo(() => {
    const today = commands.filter(c => Date.now() - c.timestamp < 24 * 60 * 60 * 1000);
    const successRate = commands.length > 0 
      ? Math.round(commands.filter(c => c.status === 'success').length / commands.length * 100)
      : 100;
    return {
      total: commands.length,
      today: today.length,
      successRate: successRate,
    };
  }, [commands]);

  if (!isVisible) return null;

  return (
    <div className="voice-history-overlay">
      <div className="voice-history-container">
        {/* Header */}
        <div className="vh-header">
          <div className="vh-title-row">
            <MicIcon className="vh-icon" />
            <h2>Voice History</h2>
          </div>
          <button className="vh-close" onClick={onClose}>
            <XIcon />
          </button>
        </div>

        {/* Stats Bar */}
        <div className="vh-stats">
          <div className="stat">
            <span className="stat-value">{stats.total}</span>
            <span className="stat-label">Total</span>
          </div>
          <div className="stat">
            <span className="stat-value">{stats.today}</span>
            <span className="stat-label">Today</span>
          </div>
          <div className="stat">
            <span className="stat-value">{stats.successRate}%</span>
            <span className="stat-label">Success</span>
          </div>
        </div>

        {/* Search & Filters */}
        <div className="vh-controls">
          <div className="search-box">
            <SearchIcon className="search-icon" />
            <input
              type="text"
              placeholder="Search commands..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button className="clear-search" onClick={() => setSearchQuery('')}>
                <XIcon />
              </button>
            )}
          </div>
          
          <div className="filter-row">
            <div className="filter-group">
              <FilterIcon className="filter-icon" />
              <select 
                value={filterStatus} 
                onChange={(e) => setFilterStatus(e.target.value as typeof filterStatus)}
              >
                <option value="all">All Status</option>
                <option value="success">Success</option>
                <option value="error">Errors</option>
              </select>
            </div>
            
            <div className="filter-group">
              <CalendarIcon className="filter-icon" />
              <select 
                value={dateFilter} 
                onChange={(e) => setDateFilter(e.target.value as typeof dateFilter)}
              >
                <option value="all">All Time</option>
                <option value="today">Today</option>
                <option value="week">This Week</option>
                <option value="month">This Month</option>
              </select>
            </div>

            <button className="clear-all-btn" onClick={clearHistory} title="Clear all history">
              <TrashIcon />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="vh-content">
          {isLoading ? (
            <div className="vh-loading">Loading...</div>
          ) : filteredCommands.length === 0 ? (
            <div className="vh-empty">
              <MicIcon className="empty-icon" />
              <p>No voice commands found</p>
              <span>Start speaking to Atlas to see your history here</span>
            </div>
          ) : (
            <div className="vh-split">
              {/* Command List */}
              <div className="vh-list">
                {filteredCommands.map(cmd => (
                  <div 
                    key={cmd.id} 
                    className={`vh-item ${selectedCommand?.id === cmd.id ? 'selected' : ''} ${cmd.status}`}
                    onClick={() => setSelectedCommand(cmd)}
                  >
                    <div className="item-status">
                      {cmd.status === 'success' ? (
                        <CheckIcon className="status-icon success" />
                      ) : (
                        <AlertIcon className="status-icon error" />
                      )}
                    </div>
                    <div className="item-content">
                      <p className="item-transcript">{cmd.transcript}</p>
                      <span className="item-time">{formatTime(cmd.timestamp)}</span>
                    </div>
                    <div className="item-actions">
                      <button onClick={(e) => { e.stopPropagation(); copyCommand(cmd); }} title="Copy">
                        <CopyIcon />
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); deleteCommand(cmd.id); }} title="Delete">
                        <TrashIcon />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Detail Panel */}
              {selectedCommand && (
                <div className="vh-detail">
                  <h3>Command Details</h3>
                  
                  <div className="detail-section">
                    <label>Transcript</label>
                    <p className="detail-transcript">{selectedCommand.transcript}</p>
                  </div>

                  {selectedCommand.response && (
                    <div className="detail-section">
                      <label>Response</label>
                      <p className="detail-response">{selectedCommand.response}</p>
                    </div>
                  )}

                  <div className="detail-meta">
                    <div className="meta-item">
                      <span className="meta-label">Time</span>
                      <span className="meta-value">{formatTime(selectedCommand.timestamp)}</span>
                    </div>
                    <div className="meta-item">
                      <span className="meta-label">Duration</span>
                      <span className="meta-value">{formatDuration(selectedCommand.duration)}</span>
                    </div>
                    <div className="meta-item">
                      <span className="meta-label">Confidence</span>
                      <span className="meta-value">{(selectedCommand.confidence * 100).toFixed(0)}%</span>
                    </div>
                    <div className="meta-item">
                      <span className="meta-label">Status</span>
                      <span className={`meta-value status-${selectedCommand.status}`}>
                        {selectedCommand.status}
                      </span>
                    </div>
                  </div>

                  {selectedCommand.toolsUsed && selectedCommand.toolsUsed.length > 0 && (
                    <div className="detail-section">
                      <label>Tools Used</label>
                      <div className="tools-list">
                        {selectedCommand.toolsUsed.map((tool, i) => (
                          <span key={i} className="tool-tag">{tool}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default VoiceHistory;
