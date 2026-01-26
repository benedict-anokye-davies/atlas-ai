/**
 * Atlas Desktop - Conversation Export
 * Export conversation history in multiple formats
 */

import { useState, useEffect, useCallback } from 'react';
import './ConversationExport.css';

interface ConversationExportProps {
  isVisible: boolean;
  onClose: () => void;
}

interface ConversationEntry {
  id: string;
  type: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  metadata?: {
    toolsUsed?: string[];
    duration?: number;
    confidence?: number;
  };
}

interface ExportOptions {
  format: 'json' | 'markdown' | 'txt' | 'html' | 'csv';
  includeMetadata: boolean;
  includeTimestamps: boolean;
  dateRange: 'all' | 'today' | 'week' | 'month' | 'custom';
  customStartDate: string;
  customEndDate: string;
}

export function ConversationExport({ isVisible, onClose }: ConversationExportProps) {
  const [conversations, setConversations] = useState<ConversationEntry[]>([]);
  const [selectedConversations, setSelectedConversations] = useState<Set<string>>(new Set());
  const [options, setOptions] = useState<ExportOptions>({
    format: 'markdown',
    includeMetadata: true,
    includeTimestamps: true,
    dateRange: 'all',
    customStartDate: '',
    customEndDate: '',
  });
  const [isExporting, setIsExporting] = useState(false);
  const [exportResult, setExportResult] = useState<{ success: boolean; message: string } | null>(null);
  const [previewContent, setPreviewContent] = useState<string>('');

  // Load conversations
  useEffect(() => {
    if (!isVisible) return;

    const loadConversations = async () => {
      try {
        // Try the main atlas API for conversation history
        const historyResult = await window.atlas?.atlas?.getConversationHistory?.(100);
        if (historyResult?.success && historyResult.data && Array.isArray(historyResult.data)) {
          const entries: ConversationEntry[] = historyResult.data.map((msg: {
            id?: string;
            role?: string;
            content?: string;
            timestamp?: number;
            toolsUsed?: string[];
            duration?: number;
            confidence?: number;
          }, idx: number) => ({
            id: msg.id || `conv-${idx}`,
            type: msg.role === 'user' ? 'user' : msg.role === 'system' ? 'system' : 'assistant',
            content: msg.content || '',
            timestamp: msg.timestamp || Date.now() - (idx * 60000),
            metadata: msg.role === 'assistant' ? {
              toolsUsed: msg.toolsUsed,
              duration: msg.duration,
              confidence: msg.confidence,
            } : undefined,
          }));
          setConversations(entries);
          return;
        }

        // Fallback: try with larger limit
        const retryResult = await window.atlas?.atlas?.getConversationHistory?.(200);
        if (retryResult?.success && retryResult.data && Array.isArray(retryResult.data)) {
          const entries: ConversationEntry[] = retryResult.data.map((msg: {
            id?: string;
            role?: string;
            content?: string;
            timestamp?: number;
            toolsUsed?: string[];
            duration?: number;
            confidence?: number;
          }, idx: number) => ({
            id: msg.id || `conv-${idx}`,
            type: msg.role === 'user' ? 'user' : msg.role === 'system' ? 'system' : 'assistant',
            content: msg.content || '',
            timestamp: msg.timestamp || Date.now() - (idx * 60000),
            metadata: msg.role === 'assistant' ? {
              toolsUsed: msg.toolsUsed,
              duration: msg.duration,
              confidence: msg.confidence,
            } : undefined,
          }));
          setConversations(entries);
          return;
        }

        // No conversation data available - show empty state
        setConversations([]);
      } catch (error) {
        console.error('Failed to load conversations:', error);
        setConversations([]);
      }
    };

    loadConversations();
  }, [isVisible]);

  // Filter conversations by date range
  const filteredConversations = conversations.filter((conv) => {
    const convDate = new Date(conv.timestamp);
    const now = new Date();

    switch (options.dateRange) {
      case 'today':
        return convDate.toDateString() === now.toDateString();
      case 'week': {
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        return convDate >= weekAgo;
      }
      case 'month': {
        const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        return convDate >= monthAgo;
      }
      case 'custom': {
        const start = options.customStartDate ? new Date(options.customStartDate) : new Date(0);
        const end = options.customEndDate ? new Date(options.customEndDate) : new Date();
        return convDate >= start && convDate <= end;
      }
      default:
        return true;
    }
  });

  // Generate preview content
  const generatePreview = useCallback(() => {
    const toExport = selectedConversations.size > 0
      ? filteredConversations.filter((c) => selectedConversations.has(c.id))
      : filteredConversations;

    if (toExport.length === 0) {
      setPreviewContent('No conversations to export.');
      return;
    }

    let content = '';

    switch (options.format) {
      case 'markdown':
        content = generateMarkdown(toExport, options);
        break;
      case 'json':
        content = JSON.stringify(
          options.includeMetadata ? toExport : toExport.map(({ id, type, content, timestamp }) => ({ id, type, content, timestamp })),
          null,
          2
        );
        break;
      case 'txt':
        content = generatePlainText(toExport, options);
        break;
      case 'html':
        content = generateHTML(toExport, options);
        break;
      case 'csv':
        content = generateCSV(toExport, options);
        break;
    }

    setPreviewContent(content.slice(0, 2000) + (content.length > 2000 ? '\n\n... (truncated)' : ''));
  }, [selectedConversations, filteredConversations, options]);

  // Update preview when options change
  useEffect(() => {
    generatePreview();
  }, [generatePreview]);

  // Export handler
  const handleExport = useCallback(async () => {
    setIsExporting(true);
    setExportResult(null);

    try {
      const toExport = selectedConversations.size > 0
        ? filteredConversations.filter((c) => selectedConversations.has(c.id))
        : filteredConversations;

      let content = '';
      let filename = `atlas-conversations-${new Date().toISOString().split('T')[0]}`;
      let mimeType = 'text/plain';

      switch (options.format) {
        case 'markdown':
          content = generateMarkdown(toExport, options);
          filename += '.md';
          mimeType = 'text/markdown';
          break;
        case 'json':
          content = JSON.stringify(
            options.includeMetadata ? toExport : toExport.map(({ id, type, content, timestamp }) => ({ id, type, content, timestamp })),
            null,
            2
          );
          filename += '.json';
          mimeType = 'application/json';
          break;
        case 'txt':
          content = generatePlainText(toExport, options);
          filename += '.txt';
          break;
        case 'html':
          content = generateHTML(toExport, options);
          filename += '.html';
          mimeType = 'text/html';
          break;
        case 'csv':
          content = generateCSV(toExport, options);
          filename += '.csv';
          mimeType = 'text/csv';
          break;
      }

      // Create and download file
      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setExportResult({
        success: true,
        message: `Successfully exported ${toExport.length} conversations to ${filename}`,
      });
    } catch (error) {
      setExportResult({
        success: false,
        message: `Export failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }

    setIsExporting(false);
  }, [selectedConversations, filteredConversations, options]);

  // Select all/none
  const toggleSelectAll = useCallback(() => {
    if (selectedConversations.size === filteredConversations.length) {
      setSelectedConversations(new Set());
    } else {
      setSelectedConversations(new Set(filteredConversations.map((c) => c.id)));
    }
  }, [filteredConversations, selectedConversations]);

  // Close on Escape
  useEffect(() => {
    if (!isVisible) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isVisible, onClose]);

  if (!isVisible) return null;

  return (
    <div className="export-overlay" onClick={onClose}>
      <div className="export-container" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="exp-header">
          <div className="exp-title-row">
            <svg className="exp-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            <h2>Export Conversations</h2>
          </div>
          <button className="exp-close" onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="exp-content">
          {/* Left side - Options */}
          <div className="exp-options">
            <div className="option-section">
              <h3>Export Format</h3>
              <div className="format-grid">
                {(['markdown', 'json', 'txt', 'html', 'csv'] as const).map((format) => (
                  <button
                    key={format}
                    className={`format-btn ${options.format === format ? 'active' : ''}`}
                    onClick={() => setOptions((prev) => ({ ...prev, format }))}
                  >
                    <span className="format-ext">.{format === 'markdown' ? 'md' : format}</span>
                    <span className="format-name">
                      {format === 'markdown' ? 'Markdown' : format.toUpperCase()}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="option-section">
              <h3>Date Range</h3>
              <select
                className="option-select"
                value={options.dateRange}
                onChange={(e) => setOptions((prev) => ({ ...prev, dateRange: e.target.value as ExportOptions['dateRange'] }))}
              >
                <option value="all">All Time</option>
                <option value="today">Today</option>
                <option value="week">Last 7 Days</option>
                <option value="month">Last 30 Days</option>
                <option value="custom">Custom Range</option>
              </select>

              {options.dateRange === 'custom' && (
                <div className="date-inputs">
                  <input
                    type="date"
                    value={options.customStartDate}
                    onChange={(e) => setOptions((prev) => ({ ...prev, customStartDate: e.target.value }))}
                    placeholder="Start Date"
                  />
                  <span>to</span>
                  <input
                    type="date"
                    value={options.customEndDate}
                    onChange={(e) => setOptions((prev) => ({ ...prev, customEndDate: e.target.value }))}
                    placeholder="End Date"
                  />
                </div>
              )}
            </div>

            <div className="option-section">
              <h3>Options</h3>
              <label className="option-checkbox">
                <input
                  type="checkbox"
                  checked={options.includeTimestamps}
                  onChange={(e) => setOptions((prev) => ({ ...prev, includeTimestamps: e.target.checked }))}
                />
                <span>Include Timestamps</span>
              </label>
              <label className="option-checkbox">
                <input
                  type="checkbox"
                  checked={options.includeMetadata}
                  onChange={(e) => setOptions((prev) => ({ ...prev, includeMetadata: e.target.checked }))}
                />
                <span>Include Metadata (tools, duration)</span>
              </label>
            </div>

            <div className="option-section">
              <h3>Selection ({selectedConversations.size} of {filteredConversations.length})</h3>
              <button className="select-all-btn" onClick={toggleSelectAll}>
                {selectedConversations.size === filteredConversations.length ? 'Deselect All' : 'Select All'}
              </button>
              <div className="conversation-list">
                {filteredConversations.slice(0, 50).map((conv) => (
                  <label key={conv.id} className="conversation-item">
                    <input
                      type="checkbox"
                      checked={selectedConversations.has(conv.id)}
                      onChange={(e) => {
                        const newSelected = new Set(selectedConversations);
                        if (e.target.checked) {
                          newSelected.add(conv.id);
                        } else {
                          newSelected.delete(conv.id);
                        }
                        setSelectedConversations(newSelected);
                      }}
                    />
                    <span className={`conv-type ${conv.type}`}>{conv.type === 'user' ? 'U' : 'A'}</span>
                    <span className="conv-preview">{conv.content.slice(0, 50)}...</span>
                    <span className="conv-time">{new Date(conv.timestamp).toLocaleTimeString()}</span>
                  </label>
                ))}
                {filteredConversations.length > 50 && (
                  <div className="more-items">
                    +{filteredConversations.length - 50} more items
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right side - Preview */}
          <div className="exp-preview">
            <div className="preview-header">
              <h3>Preview</h3>
              <span className="preview-format">{options.format.toUpperCase()}</span>
            </div>
            <pre className="preview-content">{previewContent}</pre>
          </div>
        </div>

        {/* Result Message */}
        {exportResult && (
          <div className={`export-result ${exportResult.success ? 'success' : 'error'}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              {exportResult.success ? (
                <polyline points="20 6 9 17 4 12" />
              ) : (
                <>
                  <circle cx="12" cy="12" r="10" />
                  <line x1="15" y1="9" x2="9" y2="15" />
                  <line x1="9" y1="9" x2="15" y2="15" />
                </>
              )}
            </svg>
            <span>{exportResult.message}</span>
          </div>
        )}

        {/* Footer */}
        <div className="exp-footer">
          <div className="export-stats">
            <span>{filteredConversations.length} conversations</span>
            {selectedConversations.size > 0 && (
              <span>{selectedConversations.size} selected</span>
            )}
          </div>
          <div className="footer-actions">
            <button className="cancel-btn" onClick={onClose}>
              Cancel
            </button>
            <button
              className="export-btn"
              onClick={handleExport}
              disabled={isExporting || filteredConversations.length === 0}
            >
              {isExporting ? (
                <>
                  <span className="spinner" />
                  Exporting...
                </>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  Export
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Helper functions for generating export content
function generateMarkdown(conversations: ConversationEntry[], options: ExportOptions): string {
  let md = '# Atlas Conversation Export\n\n';
  md += `Exported on: ${new Date().toLocaleString()}\n\n`;
  md += '---\n\n';

  conversations.forEach((conv) => {
    const prefix = conv.type === 'user' ? '**You:**' : '**Atlas:**';

    if (options.includeTimestamps) {
      md += `_${new Date(conv.timestamp).toLocaleString()}_\n\n`;
    }

    md += `${prefix} ${conv.content}\n\n`;

    if (options.includeMetadata && conv.metadata) {
      md += '```\n';
      if (conv.metadata.toolsUsed?.length) {
        md += `Tools used: ${conv.metadata.toolsUsed.join(', ')}\n`;
      }
      if (conv.metadata.duration) {
        md += `Duration: ${(conv.metadata.duration / 1000).toFixed(2)}s\n`;
      }
      md += '```\n\n';
    }

    md += '---\n\n';
  });

  return md;
}

function generatePlainText(conversations: ConversationEntry[], options: ExportOptions): string {
  let txt = 'Atlas Conversation Export\n';
  txt += `Exported on: ${new Date().toLocaleString()}\n`;
  txt += '='.repeat(50) + '\n\n';

  conversations.forEach((conv) => {
    const role = conv.type === 'user' ? 'You' : 'Atlas';

    if (options.includeTimestamps) {
      txt += `[${new Date(conv.timestamp).toLocaleString()}]\n`;
    }

    txt += `${role}: ${conv.content}\n`;

    if (options.includeMetadata && conv.metadata) {
      if (conv.metadata.toolsUsed?.length) {
        txt += `  Tools: ${conv.metadata.toolsUsed.join(', ')}\n`;
      }
    }

    txt += '\n';
  });

  return txt;
}

function generateHTML(conversations: ConversationEntry[], options: ExportOptions): string {
  let html = `<!DOCTYPE html>
<html>
<head>
  <title>Atlas Conversation Export</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; background: #1a1a2e; color: #fff; }
    .message { padding: 12px 16px; margin: 8px 0; border-radius: 12px; }
    .user { background: #3b82f6; margin-left: 20%; }
    .assistant { background: #374151; margin-right: 20%; }
    .timestamp { font-size: 12px; color: #9ca3af; margin-bottom: 4px; }
    .metadata { font-size: 11px; color: #6b7280; margin-top: 8px; }
  </style>
</head>
<body>
  <h1>Atlas Conversation Export</h1>
  <p>Exported on: ${new Date().toLocaleString()}</p>
  <hr>
`;

  conversations.forEach((conv) => {
    html += `<div class="message ${conv.type}">\n`;
    
    if (options.includeTimestamps) {
      html += `  <div class="timestamp">${new Date(conv.timestamp).toLocaleString()}</div>\n`;
    }
    
    html += `  <div class="content">${conv.content.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>\n`;
    
    if (options.includeMetadata && conv.metadata) {
      html += `  <div class="metadata">`;
      if (conv.metadata.toolsUsed?.length) {
        html += `Tools: ${conv.metadata.toolsUsed.join(', ')}`;
      }
      html += `</div>\n`;
    }
    
    html += `</div>\n`;
  });

  html += '</body>\n</html>';
  return html;
}

function generateCSV(conversations: ConversationEntry[], options: ExportOptions): string {
  const headers = ['ID', 'Type', 'Content'];
  if (options.includeTimestamps) headers.push('Timestamp');
  if (options.includeMetadata) headers.push('Tools Used', 'Duration');

  let csv = headers.join(',') + '\n';

  conversations.forEach((conv) => {
    const row = [
      conv.id,
      conv.type,
      `"${conv.content.replace(/"/g, '""')}"`,
    ];

    if (options.includeTimestamps) {
      row.push(new Date(conv.timestamp).toISOString());
    }

    if (options.includeMetadata) {
      row.push(conv.metadata?.toolsUsed?.join(';') || '');
      row.push(conv.metadata?.duration?.toString() || '');
    }

    csv += row.join(',') + '\n';
  });

  return csv;
}
