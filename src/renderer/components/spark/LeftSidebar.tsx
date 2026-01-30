/**
 * @fileoverview LeftSidebar - Stats and insights panel with real-time data
 */

import React from 'react';
import { GlassPanel } from './GlassPanel';
import { SparkStats } from './useSparkStats';
import styles from './LeftSidebar.module.css';

interface LeftSidebarProps {
  stats: SparkStats;
}

export const LeftSidebar: React.FC<LeftSidebarProps> = ({ stats }) => {
  // Format numbers with commas
  const formatNumber = (num: number) => num.toLocaleString();

  return (
    <div className={styles.sidebar}>
      {/* Stats Section */}
      <GlassPanel glow glowColor="green">
        <div className={styles.statsGrid}>
          <div className={styles.statItem}>
            <div className={styles.statValue}>{formatNumber(stats.memories)}</div>
            <div className={styles.statLabel}>Memories</div>
          </div>
          <div className={styles.statItem}>
            <div className={styles.statValue}>{formatNumber(stats.queue)}</div>
            <div className={styles.statLabel}>Queue</div>
          </div>
        </div>
      </GlassPanel>

      {/* Cognitive Section */}
      <GlassPanel>
        <div className={styles.sectionTitle}>Cognitive</div>
        <div className={styles.cognitiveGrid}>
          <div className={styles.cognitiveItem}>
            <div className={styles.cognitiveValue}>{formatNumber(stats.patterns)}</div>
            <div className={styles.cognitiveLabel}>Patterns</div>
          </div>
          <div className={styles.cognitiveItem}>
            <div className={styles.cognitiveValue}>{stats.reliability}%</div>
            <div className={styles.cognitiveLabel}>Reliability</div>
          </div>
          <div className={styles.cognitiveItem}>
            <div className={styles.cognitiveValue}>{stats.surprises}</div>
            <div className={styles.cognitiveLabel}>Surprises</div>
          </div>
        </div>
      </GlassPanel>

      {/* Recent Insights */}
      <GlassPanel>
        <div className={styles.sectionTitle}>Recent Insights</div>
        <div className={styles.insightsList}>
          {stats.recentInsights.slice(0, 3).map((insight, index) => (
            <div key={index} className={styles.insightCard}>
              <div className={styles.insightTag}>{insight.tag}</div>
              <div className={styles.insightText}>{insight.text}</div>
            </div>
          ))}
        </div>
      </GlassPanel>
    </div>
  );
};
