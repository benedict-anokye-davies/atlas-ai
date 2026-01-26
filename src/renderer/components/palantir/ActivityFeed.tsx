/**
 * Atlas Desktop - Activity Feed Widget
 * Unified feed with tabs for Activity, News, and Calendar
 */
import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import './ActivityFeed.css';

export type FeedItemType = 'trade' | 'atlas' | 'bank' | 'signal' | 'system' | 'news' | 'github' | 'calendar';

export interface FeedItem {
  id: string;
  type: FeedItemType;
  title: string;
  subtitle?: string;
  timestamp: number;
  icon?: string;
  link?: string;
  metadata?: Record<string, unknown>;
}

export interface ActivityFeedProps {
  items: FeedItem[];
  onItemClick?: (item: FeedItem) => void;
  onRefresh?: () => void;
  isLoading?: boolean;
}

type TabId = 'activity' | 'news' | 'calendar';

const TABS: { id: TabId; label: string; types: FeedItemType[] }[] = [
  { id: 'activity', label: 'OPS_LOG', types: ['trade', 'atlas', 'bank', 'signal', 'system'] },
  { id: 'news', label: 'INTEL_FEED', types: ['news', 'github'] },
  { id: 'calendar', label: 'SCHEDULE', types: ['calendar'] },
];

const TYPE_CONFIG: Record<FeedItemType, { icon: string; color: string; label: string }> = {
  trade: { icon: '📈', color: 'var(--atlas-accent-green)', label: 'Trading' },
  atlas: { icon: '🤖', color: 'var(--atlas-accent-cyan)', label: 'Atlas' },
  bank: { icon: '🏦', color: 'var(--atlas-accent-blue)', label: 'Banking' },
  signal: { icon: '📊', color: 'var(--atlas-accent-purple)', label: 'Signal' },
  system: { icon: '⚙️', color: 'var(--atlas-text-muted)', label: 'System' },
  news: { icon: '📰', color: 'var(--atlas-accent-yellow)', label: 'News' },
  github: { icon: '🔥', color: 'var(--atlas-text-primary)', label: 'GitHub' },
  calendar: { icon: '📅', color: 'var(--atlas-accent-cyan)', label: 'Calendar' },
};

const formatTime = (timestamp: number): string => {
  const now = Date.now();
  const diff = now - timestamp;
  
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
};

export const ActivityFeed: React.FC<ActivityFeedProps> = ({
  items,
  onItemClick,
  onRefresh,
  isLoading = false,
}) => {
  const [activeTab, setActiveTab] = useState<TabId>('activity');

  const activeTabConfig = TABS.find(t => t.id === activeTab)!;
  const filteredItems = items.filter(item => activeTabConfig.types.includes(item.type));

  return (
    <div className="activity-feed">
      {/* Header with Tabs */}
      <div className="activity-feed__header">
        <div className="activity-feed__tabs">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              className={`activity-feed__tab ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
              <span className="activity-feed__tab-count">
                {items.filter(i => tab.types.includes(i.type)).length}
              </span>
            </button>
          ))}
        </div>
        
        {onRefresh && (
          <button 
            className="activity-feed__refresh" 
            onClick={onRefresh}
            disabled={isLoading}
            aria-label="Refresh feed"
          >
            <motion.svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="currentColor"
              animate={isLoading ? { rotate: 360 } : {}}
              transition={isLoading ? { duration: 1, repeat: Infinity, ease: 'linear' } : {}}
            >
              <path d="M7 1a6 6 0 0 1 6 6h-2a4 4 0 0 0-4-4V1zM7 13a6 6 0 0 1-6-6h2a4 4 0 0 0 4 4v2z"/>
            </motion.svg>
          </button>
        )}
      </div>

      {/* Feed Items */}
      <div className="activity-feed__content">
        <AnimatePresence mode="popLayout">
          {filteredItems.length === 0 ? (
            <motion.div
              className="activity-feed__empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <span className="activity-feed__empty-icon">📭</span>
              <span className="activity-feed__empty-text">No items yet</span>
            </motion.div>
          ) : (
            filteredItems.map((item, index) => {
              const config = TYPE_CONFIG[item.type];
              return (
                <motion.div
                  key={item.id}
                  className="activity-feed__item"
                  onClick={() => onItemClick?.(item)}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ delay: index * 0.03 }}
                  whileHover={{ backgroundColor: 'var(--atlas-bg-hover)' }}
                  layout
                >
                  <div className="activity-feed__item-time">
                    {formatTime(item.timestamp)}
                  </div>
                  
                  <div className="activity-feed__item-content">
                    <span className="activity-feed__item-title">
                      {item.icon || config.icon} {item.title}
                    </span>
                    {item.subtitle && (
                      <span className="activity-feed__item-subtitle">{item.subtitle}</span>
                    )}
                  </div>
                  
                  <div 
                    className="activity-feed__item-badge"
                    style={{ backgroundColor: `${config.color}20`, color: config.color }}
                  >
                    {config.label}
                  </div>
                </motion.div>
              );
            })
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default ActivityFeed;
