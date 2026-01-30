/**
 * @fileoverview ThinkingPanel - Shows Atlas thinking process
 */

import React from 'react';
import styles from './ModernAtlas.module.css';

interface ToolExecution {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  startTime: number;
  endTime?: number;
}

interface ThinkingState {
  isThinking: boolean;
  currentStep: string;
  steps: string[];
  tools: ToolExecution[];
  startTime: number;
}

interface ThinkingPanelProps {
  thinking: ThinkingState;
  onCancel: () => void;
}

export const ThinkingPanel: React.FC<ThinkingPanelProps> = ({ thinking, onCancel }) => {
  const elapsed = Math.floor((Date.now() - thinking.startTime) / 1000);

  return (
    <div className={styles.thinkingPanel}>
      <div className={styles.thinkingHeader}>
        <div className={styles.thinkingIndicator}>
          <div className={styles.thinkingDot} />
          <div className={styles.thinkingDot} style={{ animationDelay: '0.2s' }} />
          <div className={styles.thinkingDot} style={{ animationDelay: '0.4s' }} />
        </div>
        <span className={styles.thinkingText}>Thinking...</span>
        <span className={styles.thinkingTime}>{elapsed}s</span>
        <button className={styles.thinkingCancel} onClick={onCancel}>
          Cancel
        </button>
      </div>

      <div className={styles.thinkingSteps}>
        {thinking.steps.map((step, index) => (
          <div key={index} className={styles.thinkingStep}>
            <span className={styles.stepNumber}>{index + 1}</span>
            <span className={styles.stepText}>{step}</span>
          </div>
        ))}
        {thinking.isThinking && (
          <div className={styles.thinkingStepActive}>
            <span className={styles.stepNumber}>{thinking.steps.length + 1}</span>
            <span className={styles.stepTextActive}>{thinking.currentStep}</span>
          </div>
        )}
      </div>

      {thinking.tools.length > 0 && (
        <div className={styles.thinkingTools}>
          <div className={styles.toolsLabel}>Tools used:</div>
          <div className={styles.toolsList}>
            {thinking.tools.map((tool) => (
              <div key={tool.id} className={`${styles.toolBadge} ${styles[tool.status]}`}>
                <span className={styles.toolIcon}>
                  {tool.status === 'running' ? '⚙️' : tool.status === 'completed' ? '✓' : '○'}
                </span>
                <span className={styles.toolName}>{tool.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
