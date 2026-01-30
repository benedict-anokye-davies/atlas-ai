/**
 * @fileoverview ToolCallBlock - Claude Code-like tool execution display
 * Shows tool calls inline in chat with status, params, and results
 */

import React from 'react';
import styles from './ToolCallBlock.module.css';

export interface ToolCall {
    id: string;
    toolName: string;
    params?: Record<string, unknown>;
    status: 'running' | 'completed' | 'error';
    result?: unknown;
    error?: string;
    startTime: number;
    endTime?: number;
}

interface ToolCallBlockProps {
    tool: ToolCall;
    expanded?: boolean;
    onToggle?: () => void;
}

const getToolIcon = (toolName: string): string => {
    const iconMap: Record<string, string> = {
        read_file: '📄',
        create_file: '📝',
        edit_file: '✏️',
        delete_file: '🗑️',
        list_directory: '📁',
        grep_search: '🔍',
        run_command: '💻',
        search_codebase: '🔎',
        get_current_time: '🕐',
        calculator: '🧮',
        get_system_info: '💻',
    };
    return iconMap[toolName] || '🔧';
};

const formatDuration = (start: number, end?: number): string => {
    if (!end) return '...';
    const ms = end - start;
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
};

const formatParams = (params?: Record<string, unknown>): string => {
    if (!params || Object.keys(params).length === 0) return '';

    // Show key params in a compact format
    const entries = Object.entries(params).slice(0, 3);
    return entries.map(([key, value]) => {
        const strValue = typeof value === 'string' ? value : JSON.stringify(value);
        const truncated = strValue.length > 50 ? strValue.slice(0, 50) + '...' : strValue;
        return `${key}: ${truncated}`;
    }).join(', ');
};

export const ToolCallBlock: React.FC<ToolCallBlockProps> = ({
    tool,
    expanded = false,
    onToggle
}) => {
    const statusClass = styles[tool.status] || '';

    return (
        <div className={`${styles.toolCallBlock} ${statusClass}`} onClick={onToggle}>
            <div className={styles.header}>
                <span className={styles.icon}>{getToolIcon(tool.toolName)}</span>
                <span className={styles.toolName}>{tool.toolName}</span>
                <span className={styles.status}>
                    {tool.status === 'running' && <span className={styles.spinner}>◐</span>}
                    {tool.status === 'completed' && '✓'}
                    {tool.status === 'error' && '✗'}
                </span>
                <span className={styles.duration}>
                    {formatDuration(tool.startTime, tool.endTime)}
                </span>
            </div>

            {tool.params && Object.keys(tool.params).length > 0 && (
                <div className={styles.params}>
                    {formatParams(tool.params)}
                </div>
            )}

            {expanded && tool.result !== undefined && (
                <div className={styles.result}>
                    <pre>{typeof tool.result === 'string' ? tool.result : JSON.stringify(tool.result, null, 2)}</pre>
                </div>
            )}
            {tool.error && (
                <div className={styles.error}>
                    {String(tool.error)}
                </div>
            )}
        </div>
    );
};

export default ToolCallBlock;
