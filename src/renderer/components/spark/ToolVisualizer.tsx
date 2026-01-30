/**
 * @fileoverview ToolVisualizer - Shows tool execution details
 */

import React from 'react';
import styles from './ModernAtlas.module.css';

interface ToolExecution {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  params?: Record<string, unknown>;
  result?: unknown;
  startTime: number;
  endTime?: number;
}

interface ToolVisualizerProps {
  tools: ToolExecution[];
}

export const ToolVisualizer: React.FC<ToolVisualizerProps> = ({ tools }) => {
  return (
    <div className={styles.toolPanel}>
      <div className={styles.toolPanelHeader}>
        <span className={styles.toolPanelTitle}>Tools</span>
        <span className={styles.toolPanelCount}>{tools.length} executed</span>
      </div>
      <div className={styles.toolList}>
        {tools.map((tool) => (
          <div key={tool.id} className={`${styles.toolItem} ${styles[tool.status]}`}>
            <div className={styles.toolHeader}>
              <span className={styles.toolStatusIcon}>
                {tool.status === 'running' && <span className={styles.spinner}>◐</span>}
                {tool.status === 'completed' && '✓'}
                {tool.status === 'error' && '✗'}
                {tool.status === 'pending' && '○'}
              </span>
              <span className={styles.toolItemName}>{tool.name}</span>
              <span className={styles.toolDuration}>
                {tool.endTime ? `${((tool.endTime - tool.startTime) / 1000).toFixed(1)}s` : '...'}
              </span>
            </div>
            {tool.params && Object.keys(tool.params).length > 0 && (
              <div className={styles.toolParams}>
                <pre>{JSON.stringify(tool.params, null, 2)}</pre>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
