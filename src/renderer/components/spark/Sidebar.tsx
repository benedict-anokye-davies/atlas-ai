/**
 * @fileoverview Sidebar - Modern sidebar with stats and navigation
 */

import React from 'react';
import styles from './ModernAtlas.module.css';
import { SparkStats } from './useSparkStats';

interface SidebarProps {
  stats: SparkStats;
}

export const Sidebar: React.FC<SidebarProps> = ({ stats }) => {
  return (
    <aside className={styles.sidebar}>
      {/* New Chat Button */}
      <button className={styles.newChatButton}>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        New Chat
      </button>

      {/* Search */}
      <div className={styles.searchBox}>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input type="text" placeholder="Search conversations..." />
      </div>

      {/* Recent Chats */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Recent</div>
        <div className={styles.chatList}>
          <div className={styles.chatItem}>
            <div className={styles.chatIcon}>💬</div>
            <div className={styles.chatInfo}>
              <div className={styles.chatName}>Current Conversation</div>
              <div className={styles.chatPreview}>Just now</div>
            </div>
          </div>
        </div>
      </div>

      {/* Other Views */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Other Views</div>
        <div className={styles.viewList}>
          <button className={styles.viewButton}>
            <span className={styles.viewIcon}>📈</span>
            Trading
          </button>
          <button className={styles.viewButton}>
            <span className={styles.viewIcon}>🎓</span>
            Learning
          </button>
          <button className={styles.viewButton}>
            <span className={styles.viewIcon}>📊</span>
            Dashboard
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>System Status</div>
        <div className={styles.statsGrid}>
          <div className={styles.statItem}>
            <span className={styles.statValue}>{stats.memories.toLocaleString()}</span>
            <span className={styles.statLabel}>Memories</span>
          </div>
          <div className={styles.statItem}>
            <span className={styles.statValue}>{stats.queue}</span>
            <span className={styles.statLabel}>Queue</span>
          </div>
          <div className={styles.statItem}>
            <span className={styles.statValue}>{stats.patterns}</span>
            <span className={styles.statLabel}>Patterns</span>
          </div>
          <div className={styles.statItem}>
            <span className={styles.statValue}>{stats.reliability}%</span>
            <span className={styles.statLabel}>Reliability</span>
          </div>
        </div>
      </div>

      {/* Settings */}
      <button className={styles.settingsButton}>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M12 1v6m0 6v6m4.22-10.22l4.24-4.24M6.34 6.34L2.1 2.1m17.8 17.8l-4.24-4.24M6.34 17.66l-4.24 4.24M23 12h-6m-6 0H1m20.07-4.93l-4.24 4.24M6.34 6.34l-4.24-4.24" />
        </svg>
        Settings
      </button>
    </aside>
  );
};
