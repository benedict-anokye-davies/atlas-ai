/**
 * @fileoverview RightSidebar - Metrics and preferences panel with real-time data
 */

import React from 'react';
import { GlassPanel } from './GlassPanel';
import { SparkStats } from './useSparkStats';
import styles from './RightSidebar.module.css';

interface RightSidebarProps {
  stats: SparkStats;
}

export const RightSidebar: React.FC<RightSidebarProps> = ({ stats }) => {
  return (
    <div className={styles.sidebar}>
      {/* Sync Status */}
      <GlassPanel glow glowColor="green">
        <div className={styles.syncStatus}>
          <div className={styles.syncLabel}>Full sync with partner</div>
          <div className={styles.syncValue}>{stats.syncStatus}%</div>
        </div>
      </GlassPanel>

      {/* Metrics */}
      <GlassPanel>
        <div className={styles.metricsGrid}>
          <div className={styles.metricBadge}>
            <span className={styles.metricLabel}>wisdom</span>
            <span className={styles.metricValue}>{stats.wisdom}</span>
          </div>
          <div className={styles.metricBadge}>
            <span className={styles.metricLabel}>self awareness</span>
            <span className={styles.metricValue}>{stats.selfAwareness}</span>
          </div>
          <div className={styles.metricBadge}>
            <span className={styles.metricLabel}>user understanding</span>
            <span className={styles.metricValue}>{stats.userUnderstanding}</span>
          </div>
          <div className={styles.metricBadge}>
            <span className={styles.metricLabel}>context</span>
            <span className={styles.metricValue}>{stats.context}</span>
          </div>
          <div className={styles.metricBadge}>
            <span className={styles.metricLabel}>reasoning</span>
            <span className={styles.metricValue}>{stats.reasoning}</span>
          </div>
        </div>
      </GlassPanel>

      {/* Atlas Knows */}
      <GlassPanel>
        <div className={styles.sectionTitle}>Atlas Knows</div>
        <div className={styles.knowsList}>
          {stats.sparkKnows.slice(0, 3).map((item, index) => (
            <div key={index} className={styles.knowsItem}>
              <div className={styles.knowsLabel}>{item.label}</div>
              <div className={styles.knowsPercent}>{item.percentage}%</div>
            </div>
          ))}
        </div>
      </GlassPanel>

      {/* Tastebank */}
      <GlassPanel>
        <div className={styles.sectionTitle}>Tastebank</div>
        <div className={styles.tasteGrid}>
          <div className={styles.tasteItem}>
            <div className={styles.tasteIcon}>🌐</div>
            <div className={styles.tasteLabel}>Posts</div>
            <div className={styles.tasteValue}>{stats.tastebank.posts}</div>
          </div>
          <div className={styles.tasteItem}>
            <div className={styles.tasteIcon}>🎨</div>
            <div className={styles.tasteLabel}>UI</div>
            <div className={styles.tasteValue}>{stats.tastebank.ui}</div>
          </div>
          <div className={styles.tasteItem}>
            <div className={styles.tasteIcon}>✏️</div>
            <div className={styles.tasteLabel}>Art</div>
            <div className={styles.tasteValue}>{stats.tastebank.art}</div>
          </div>
        </div>
      </GlassPanel>
    </div>
  );
};
