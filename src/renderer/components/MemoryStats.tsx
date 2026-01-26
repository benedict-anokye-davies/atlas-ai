/* eslint-disable no-console */
/**
 * Atlas Desktop - Memory Statistics Component
 * Displays comprehensive statistics about stored memories
 *
 * Features:
 * - Overview dashboard with key metrics
 * - Storage usage visualization
 * - Memory growth chart
 * - Topic distribution breakdown
 * - Export functionality
 */

import React, { useCallback, useEffect, useState, useMemo } from 'react';
import './MemoryStats.css';

// ============================================================================
// TYPES
// ============================================================================

interface MemoryTypeCount {
  conversation: number;
  fact: number;
  preference: number;
  context: number;
}

interface KnowledgeCategoryCount {
  user_preference: number;
  user_fact: number;
  user_habit: number;
  world_fact: number;
  task_pattern: number;
  relationship: number;
  custom: number;
}

interface ConfidenceLevelCount {
  low: number;
  medium: number;
  high: number;
  verified: number;
}

interface SummaryLevelCount {
  conversation: number;
  session: number;
  daily: number;
  weekly: number;
  monthly: number;
}

interface StorageUsage {
  totalBytes: number;
  memoriesBytes: number;
  conversationsBytes: number;
  knowledgeBytes: number;
  summariesBytes: number;
  vectorsBytes: number;
  formattedTotal: string;
}

interface GrowthDataPoint {
  timestamp: number;
  totalEntries: number;
  totalKnowledge: number;
  totalSummaries: number;
  totalConversations: number;
}

interface ReferencedMemory {
  id: string;
  contentPreview: string;
  type: string;
  accessCount: number;
  importance: number;
  lastAccessedAt: number;
  createdAt: number;
}

interface TopicDistribution {
  topic: string;
  category: string;
  count: number;
  percentage: number;
  avgConfidence: number;
  firstMentioned: number;
  lastMentioned: number;
}

interface MemoryStatistics {
  generatedAt: number;
  overview: {
    totalMemories: number;
    totalKnowledge: number;
    totalSummaries: number;
    totalConversations: number;
    totalMessages: number;
    activeTopics: number;
  };
  memoriesByType: MemoryTypeCount;
  knowledgeByCategory: KnowledgeCategoryCount;
  knowledgeByConfidence: ConfidenceLevelCount;
  summariesByLevel: SummaryLevelCount;
  storage: StorageUsage;
  growth: {
    dataPoints: GrowthDataPoint[];
    dailyGrowthRate: number;
    daysTracked: number;
  };
  mostReferenced: ReferencedMemory[];
  topicDistribution: TopicDistribution[];
  sessions: {
    totalSessions: number;
    averageMessagesPerSession: number;
    averageSessionDuration: number;
    longestSession: {
      id: string;
      duration: number;
      messageCount: number;
    } | null;
  };
  actionItems: {
    total: number;
    completed: number;
    pending: number;
    byPriority: {
      high: number;
      medium: number;
      low: number;
    };
  };
  sentiment: {
    positive: number;
    negative: number;
    neutral: number;
    mixed: number;
  };
  performance: {
    averageImportance: number;
    averageKnowledgeConfidence: number;
    averageCompressionRatio: number;
    tokensSaved: number;
  };
}

interface MemoryStatsProps {
  /** Whether the panel is visible */
  visible: boolean;
  /** Callback when panel is closed */
  onClose: () => void;
}

// ============================================================================
// HELPER COMPONENTS
// ============================================================================

/**
 * Stat card component for displaying individual metrics
 */
const StatCard: React.FC<{
  label: string;
  value: string | number;
  sublabel?: string;
  icon?: React.ReactNode;
  trend?: 'up' | 'down' | 'neutral';
  color?: 'default' | 'success' | 'warning' | 'info';
}> = ({ label, value, sublabel, icon, trend, color = 'default' }) => (
  <div className={`stat-card stat-card-${color}`}>
    {icon && <div className="stat-card-icon">{icon}</div>}
    <div className="stat-card-content">
      <div className="stat-card-value">
        {value}
        {trend && (
          <span className={`stat-trend stat-trend-${trend}`}>
            {trend === 'up' ? '\u2191' : trend === 'down' ? '\u2193' : '\u2194'}
          </span>
        )}
      </div>
      <div className="stat-card-label">{label}</div>
      {sublabel && <div className="stat-card-sublabel">{sublabel}</div>}
    </div>
  </div>
);

/**
 * Progress bar component for visualizing proportions
 */
const ProgressBar: React.FC<{
  label: string;
  value: number;
  max: number;
  color?: string;
  showPercentage?: boolean;
}> = ({ label, value, max, color = '#4a9eff', showPercentage = true }) => {
  const percentage = max > 0 ? (value / max) * 100 : 0;

  return (
    <div className="progress-item">
      <div className="progress-header">
        <span className="progress-label">{label}</span>
        <span className="progress-value">
          {value.toLocaleString()}
          {showPercentage && ` (${percentage.toFixed(1)}%)`}
        </span>
      </div>
      <div className="progress-bar-container">
        <div
          className="progress-bar-fill"
          style={{ width: `${Math.min(percentage, 100)}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
};

/**
 * Section header component
 */
const SectionHeader: React.FC<{
  title: string;
  action?: React.ReactNode;
}> = ({ title, action }) => (
  <div className="section-header">
    <h3 className="section-title">{title}</h3>
    {action && <div className="section-action">{action}</div>}
  </div>
);

/**
 * Simple bar chart for growth visualization
 */
const GrowthChart: React.FC<{
  dataPoints: GrowthDataPoint[];
  height?: number;
}> = ({ dataPoints, height = 120 }) => {
  if (dataPoints.length === 0) {
    return <div className="growth-chart-empty">No growth data available yet</div>;
  }

  const maxValue = Math.max(
    ...dataPoints.map((d) => d.totalEntries + d.totalKnowledge + d.totalSummaries)
  );

  const chartWidth = 100;
  const barWidth = dataPoints.length > 1 ? chartWidth / dataPoints.length : chartWidth;

  return (
    <div className="growth-chart" style={{ height }}>
      <svg viewBox={`0 0 ${chartWidth} ${height}`} preserveAspectRatio="none">
        {dataPoints.map((point, index) => {
          const total = point.totalEntries + point.totalKnowledge + point.totalSummaries;
          const barHeight = maxValue > 0 ? (total / maxValue) * height : 0;

          return (
            <g key={index}>
              <rect
                x={index * barWidth}
                y={height - barHeight}
                width={barWidth - 1}
                height={barHeight}
                fill="#4a9eff"
                opacity={0.8}
              />
            </g>
          );
        })}
      </svg>
      <div className="growth-chart-labels">
        <span>
          {dataPoints.length > 0 ? new Date(dataPoints[0].timestamp).toLocaleDateString() : ''}
        </span>
        <span>
          {dataPoints.length > 0
            ? new Date(dataPoints[dataPoints.length - 1].timestamp).toLocaleDateString()
            : ''}
        </span>
      </div>
    </div>
  );
};

/**
 * Topic distribution list
 */
const TopicList: React.FC<{
  topics: TopicDistribution[];
  maxItems?: number;
}> = ({ topics, maxItems = 10 }) => {
  const displayTopics = topics.slice(0, maxItems);
  const colors = ['#4a9eff', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

  if (displayTopics.length === 0) {
    return <div className="topic-list-empty">No topics detected yet</div>;
  }

  return (
    <div className="topic-list">
      {displayTopics.map((topic, index) => (
        <div key={topic.topic} className="topic-item">
          <div
            className="topic-indicator"
            style={{ backgroundColor: colors[index % colors.length] }}
          />
          <div className="topic-details">
            <span className="topic-name">{topic.topic}</span>
            <span className="topic-category">{topic.category}</span>
          </div>
          <div className="topic-stats">
            <span className="topic-count">{topic.count}</span>
            <span className="topic-percentage">{topic.percentage.toFixed(1)}%</span>
          </div>
        </div>
      ))}
    </div>
  );
};

/**
 * Referenced memory list
 */
const ReferencedList: React.FC<{
  memories: ReferencedMemory[];
  maxItems?: number;
}> = ({ memories, maxItems = 5 }) => {
  const displayMemories = memories.slice(0, maxItems);

  if (displayMemories.length === 0) {
    return <div className="referenced-list-empty">No referenced memories yet</div>;
  }

  return (
    <div className="referenced-list">
      {displayMemories.map((memory) => (
        <div key={memory.id} className="referenced-item">
          <div className="referenced-type">{memory.type}</div>
          <div className="referenced-content">{memory.contentPreview}</div>
          <div className="referenced-meta">
            <span className="referenced-accesses">{memory.accessCount} accesses</span>
          </div>
        </div>
      ))}
    </div>
  );
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

/**
 * Memory Statistics Panel
 * Displays comprehensive statistics about Atlas's memory system
 */
export const MemoryStats: React.FC<MemoryStatsProps> = ({ visible, onClose }) => {
  const [stats, setStats] = useState<MemoryStatistics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'knowledge' | 'sessions' | 'growth'>(
    'overview'
  );
  const [exporting, setExporting] = useState(false);

  // Load statistics when panel becomes visible
  const loadStats = useCallback(async () => {
    if (!window.atlas) return;

    setLoading(true);
    setError(null);

    try {
      const result = (await window.atlas.invoke('memory:get-statistics')) as {
        success: boolean;
        data?: MemoryStatistics;
        error?: string;
      };
      if (result.success && result.data) {
        setStats(result.data);
      } else {
        setError(result.error || 'Failed to load statistics');
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible) {
      loadStats();
    }
  }, [visible, loadStats]);

  // Export report handler
  const handleExport = useCallback(async (format: 'json' | 'markdown' | 'text') => {
    if (!window.atlas) return;

    setExporting(true);
    try {
      const result = (await window.atlas.invoke('memory:export-report', format)) as {
        success: boolean;
        data?: string;
        error?: string;
      };
      if (result.success) {
        // Show success notification (would integrate with toast system)
        console.log('Report exported:', result.data);
      } else {
        setError(result.error || 'Failed to export report');
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setExporting(false);
    }
  }, []);

  // Get memory answer
  const memoryAnswer = useMemo(() => {
    if (!stats) return '';

    const { overview } = stats;
    const total = overview.totalMemories + overview.totalKnowledge + overview.totalSummaries;

    if (total === 0) {
      return "I don't have any memories stored yet. Our conversations will help me learn and remember things about you.";
    }

    const parts: string[] = [];
    if (overview.totalMemories > 0) {
      parts.push(`${overview.totalMemories} memory entries`);
    }
    if (overview.totalKnowledge > 0) {
      parts.push(`${overview.totalKnowledge} learned facts`);
    }
    if (overview.totalSummaries > 0) {
      parts.push(`${overview.totalSummaries} conversation summaries`);
    }

    let response = `I currently remember ${parts.join(', ')}.`;
    if (total > 100) {
      response += ` That's quite a lot! Using ${stats.storage.formattedTotal} of storage.`;
    } else if (total > 50) {
      response += ` We're building up a good history together.`;
    } else if (total > 10) {
      response += ` I'm starting to learn about your preferences.`;
    }

    return response;
  }, [stats]);

  // Don't render if not visible
  if (!visible) return null;

  return (
    <div className="memory-stats-overlay" onClick={onClose}>
      <div className="memory-stats-panel" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <header className="memory-stats-header">
          <h2 className="memory-stats-title">Memory Statistics</h2>
          <div className="memory-stats-actions">
            <div className="export-dropdown">
              <button
                className="export-button"
                disabled={exporting || loading}
                title="Export Report"
              >
                {exporting ? 'Exporting...' : 'Export'}
              </button>
              <div className="export-menu">
                <button onClick={() => handleExport('json')}>JSON</button>
                <button onClick={() => handleExport('markdown')}>Markdown</button>
                <button onClick={() => handleExport('text')}>Text</button>
              </div>
            </div>
            <button className="refresh-button" onClick={loadStats} disabled={loading}>
              {loading ? 'Loading...' : 'Refresh'}
            </button>
            <button className="close-button" onClick={onClose} aria-label="Close">
              x
            </button>
          </div>
        </header>

        {/* Memory Answer */}
        {stats && (
          <div className="memory-answer">
            <div className="memory-answer-icon">?</div>
            <div className="memory-answer-text">
              <strong>How much do you remember?</strong>
              <p>{memoryAnswer}</p>
            </div>
          </div>
        )}

        {/* Tabs */}
        <nav className="memory-stats-tabs">
          <button
            className={`tab-button ${activeTab === 'overview' ? 'active' : ''}`}
            onClick={() => setActiveTab('overview')}
          >
            Overview
          </button>
          <button
            className={`tab-button ${activeTab === 'knowledge' ? 'active' : ''}`}
            onClick={() => setActiveTab('knowledge')}
          >
            Knowledge
          </button>
          <button
            className={`tab-button ${activeTab === 'sessions' ? 'active' : ''}`}
            onClick={() => setActiveTab('sessions')}
          >
            Sessions
          </button>
          <button
            className={`tab-button ${activeTab === 'growth' ? 'active' : ''}`}
            onClick={() => setActiveTab('growth')}
          >
            Growth
          </button>
        </nav>

        {/* Content */}
        <div className="memory-stats-content">
          {loading && (
            <div className="loading-state">
              <div className="loading-spinner" />
              <span>Loading statistics...</span>
            </div>
          )}

          {error && (
            <div className="error-state">
              <span className="error-icon">!</span>
              <span>{error}</span>
              <button onClick={loadStats}>Retry</button>
            </div>
          )}

          {!loading && !error && stats && (
            <>
              {/* Overview Tab */}
              {activeTab === 'overview' && (
                <div className="tab-content overview-tab">
                  {/* Quick Stats Grid */}
                  <div className="stats-grid">
                    <StatCard
                      label="Total Memories"
                      value={stats.overview.totalMemories.toLocaleString()}
                      color="info"
                    />
                    <StatCard
                      label="Knowledge Entries"
                      value={stats.overview.totalKnowledge.toLocaleString()}
                      color="success"
                    />
                    <StatCard
                      label="Summaries"
                      value={stats.overview.totalSummaries.toLocaleString()}
                      color="warning"
                    />
                    <StatCard
                      label="Conversations"
                      value={stats.overview.totalConversations.toLocaleString()}
                      color="default"
                    />
                  </div>

                  {/* Storage Section */}
                  <section className="stats-section">
                    <SectionHeader title="Storage Usage" />
                    <div className="storage-overview">
                      <div className="storage-total">
                        <span className="storage-value">{stats.storage.formattedTotal}</span>
                        <span className="storage-label">Total Used</span>
                      </div>
                      <div className="storage-breakdown">
                        <ProgressBar
                          label="Memories"
                          value={stats.storage.memoriesBytes}
                          max={stats.storage.totalBytes}
                          color="#4a9eff"
                        />
                        <ProgressBar
                          label="Knowledge"
                          value={stats.storage.knowledgeBytes}
                          max={stats.storage.totalBytes}
                          color="#22c55e"
                        />
                        <ProgressBar
                          label="Summaries"
                          value={stats.storage.summariesBytes}
                          max={stats.storage.totalBytes}
                          color="#f59e0b"
                        />
                        <ProgressBar
                          label="Vectors"
                          value={stats.storage.vectorsBytes}
                          max={stats.storage.totalBytes}
                          color="#8b5cf6"
                        />
                      </div>
                    </div>
                  </section>

                  {/* Action Items Section */}
                  <section className="stats-section">
                    <SectionHeader title="Action Items" />
                    <div className="action-items-overview">
                      <div className="action-stats-row">
                        <StatCard label="Total" value={stats.actionItems.total} />
                        <StatCard
                          label="Completed"
                          value={stats.actionItems.completed}
                          color="success"
                        />
                        <StatCard
                          label="Pending"
                          value={stats.actionItems.pending}
                          color="warning"
                        />
                      </div>
                      <div className="priority-breakdown">
                        <span className="priority-item priority-high">
                          High: {stats.actionItems.byPriority.high}
                        </span>
                        <span className="priority-item priority-medium">
                          Medium: {stats.actionItems.byPriority.medium}
                        </span>
                        <span className="priority-item priority-low">
                          Low: {stats.actionItems.byPriority.low}
                        </span>
                      </div>
                    </div>
                  </section>

                  {/* Sentiment Overview */}
                  <section className="stats-section">
                    <SectionHeader title="Conversation Sentiment" />
                    <div className="sentiment-bars">
                      <ProgressBar
                        label="Positive"
                        value={stats.sentiment.positive}
                        max={
                          stats.sentiment.positive +
                          stats.sentiment.negative +
                          stats.sentiment.neutral +
                          stats.sentiment.mixed
                        }
                        color="#22c55e"
                      />
                      <ProgressBar
                        label="Neutral"
                        value={stats.sentiment.neutral}
                        max={
                          stats.sentiment.positive +
                          stats.sentiment.negative +
                          stats.sentiment.neutral +
                          stats.sentiment.mixed
                        }
                        color="#94a3b8"
                      />
                      <ProgressBar
                        label="Mixed"
                        value={stats.sentiment.mixed}
                        max={
                          stats.sentiment.positive +
                          stats.sentiment.negative +
                          stats.sentiment.neutral +
                          stats.sentiment.mixed
                        }
                        color="#f59e0b"
                      />
                      <ProgressBar
                        label="Negative"
                        value={stats.sentiment.negative}
                        max={
                          stats.sentiment.positive +
                          stats.sentiment.negative +
                          stats.sentiment.neutral +
                          stats.sentiment.mixed
                        }
                        color="#ef4444"
                      />
                    </div>
                  </section>
                </div>
              )}

              {/* Knowledge Tab */}
              {activeTab === 'knowledge' && (
                <div className="tab-content knowledge-tab">
                  {/* Knowledge by Category */}
                  <section className="stats-section">
                    <SectionHeader title="Knowledge by Category" />
                    <div className="category-breakdown">
                      <ProgressBar
                        label="User Preferences"
                        value={stats.knowledgeByCategory.user_preference}
                        max={stats.overview.totalKnowledge}
                        color="#4a9eff"
                      />
                      <ProgressBar
                        label="User Facts"
                        value={stats.knowledgeByCategory.user_fact}
                        max={stats.overview.totalKnowledge}
                        color="#22c55e"
                      />
                      <ProgressBar
                        label="User Habits"
                        value={stats.knowledgeByCategory.user_habit}
                        max={stats.overview.totalKnowledge}
                        color="#f59e0b"
                      />
                      <ProgressBar
                        label="World Facts"
                        value={stats.knowledgeByCategory.world_fact}
                        max={stats.overview.totalKnowledge}
                        color="#8b5cf6"
                      />
                      <ProgressBar
                        label="Task Patterns"
                        value={stats.knowledgeByCategory.task_pattern}
                        max={stats.overview.totalKnowledge}
                        color="#ec4899"
                      />
                      <ProgressBar
                        label="Relationships"
                        value={stats.knowledgeByCategory.relationship}
                        max={stats.overview.totalKnowledge}
                        color="#06b6d4"
                      />
                    </div>
                  </section>

                  {/* Confidence Levels */}
                  <section className="stats-section">
                    <SectionHeader title="Knowledge Confidence" />
                    <div className="confidence-breakdown">
                      <div className="confidence-stats-row">
                        <StatCard
                          label="Verified"
                          value={stats.knowledgeByConfidence.verified}
                          color="success"
                        />
                        <StatCard
                          label="High"
                          value={stats.knowledgeByConfidence.high}
                          color="info"
                        />
                        <StatCard
                          label="Medium"
                          value={stats.knowledgeByConfidence.medium}
                          color="warning"
                        />
                        <StatCard
                          label="Low"
                          value={stats.knowledgeByConfidence.low}
                          color="default"
                        />
                      </div>
                      <div className="confidence-average">
                        Average Confidence:{' '}
                        <strong>
                          {(stats.performance.averageKnowledgeConfidence * 100).toFixed(1)}%
                        </strong>
                      </div>
                    </div>
                  </section>

                  {/* Topic Distribution */}
                  <section className="stats-section">
                    <SectionHeader title="Topic Distribution" />
                    <TopicList topics={stats.topicDistribution} maxItems={10} />
                  </section>

                  {/* Most Referenced */}
                  <section className="stats-section">
                    <SectionHeader title="Most Referenced Memories" />
                    <ReferencedList memories={stats.mostReferenced} maxItems={5} />
                  </section>
                </div>
              )}

              {/* Sessions Tab */}
              {activeTab === 'sessions' && (
                <div className="tab-content sessions-tab">
                  {/* Session Overview */}
                  <section className="stats-section">
                    <SectionHeader title="Session Overview" />
                    <div className="stats-grid">
                      <StatCard
                        label="Total Sessions"
                        value={stats.sessions.totalSessions.toLocaleString()}
                      />
                      <StatCard
                        label="Total Messages"
                        value={stats.overview.totalMessages.toLocaleString()}
                      />
                      <StatCard
                        label="Avg Messages/Session"
                        value={stats.sessions.averageMessagesPerSession.toFixed(1)}
                      />
                      <StatCard
                        label="Avg Session Duration"
                        value={formatDuration(stats.sessions.averageSessionDuration)}
                      />
                    </div>
                  </section>

                  {/* Longest Session */}
                  {stats.sessions.longestSession && (
                    <section className="stats-section">
                      <SectionHeader title="Longest Session" />
                      <div className="longest-session">
                        <div className="longest-session-stat">
                          <span className="stat-value">
                            {formatDuration(stats.sessions.longestSession.duration)}
                          </span>
                          <span className="stat-label">Duration</span>
                        </div>
                        <div className="longest-session-stat">
                          <span className="stat-value">
                            {stats.sessions.longestSession.messageCount}
                          </span>
                          <span className="stat-label">Messages</span>
                        </div>
                      </div>
                    </section>
                  )}

                  {/* Summary Levels */}
                  <section className="stats-section">
                    <SectionHeader title="Summaries by Level" />
                    <div className="summary-levels">
                      <ProgressBar
                        label="Conversation"
                        value={stats.summariesByLevel.conversation}
                        max={stats.overview.totalSummaries}
                        color="#4a9eff"
                      />
                      <ProgressBar
                        label="Session"
                        value={stats.summariesByLevel.session}
                        max={stats.overview.totalSummaries}
                        color="#22c55e"
                      />
                      <ProgressBar
                        label="Daily"
                        value={stats.summariesByLevel.daily}
                        max={stats.overview.totalSummaries}
                        color="#f59e0b"
                      />
                      <ProgressBar
                        label="Weekly"
                        value={stats.summariesByLevel.weekly}
                        max={stats.overview.totalSummaries}
                        color="#8b5cf6"
                      />
                      <ProgressBar
                        label="Monthly"
                        value={stats.summariesByLevel.monthly}
                        max={stats.overview.totalSummaries}
                        color="#ec4899"
                      />
                    </div>
                  </section>

                  {/* Performance Metrics */}
                  <section className="stats-section">
                    <SectionHeader title="Performance Metrics" />
                    <div className="performance-metrics">
                      <div className="metric-item">
                        <span className="metric-label">Compression Ratio</span>
                        <span className="metric-value">
                          {(stats.performance.averageCompressionRatio * 100).toFixed(1)}%
                        </span>
                      </div>
                      <div className="metric-item">
                        <span className="metric-label">Tokens Saved</span>
                        <span className="metric-value">
                          {stats.performance.tokensSaved.toLocaleString()}
                        </span>
                      </div>
                    </div>
                  </section>
                </div>
              )}

              {/* Growth Tab */}
              {activeTab === 'growth' && (
                <div className="tab-content growth-tab">
                  {/* Growth Overview */}
                  <section className="stats-section">
                    <SectionHeader title="Memory Growth" />
                    <div className="growth-overview">
                      <div className="growth-stats">
                        <StatCard label="Days Tracked" value={stats.growth.daysTracked} />
                        <StatCard
                          label="Daily Growth Rate"
                          value={`${stats.growth.dailyGrowthRate.toFixed(2)}/day`}
                          trend={stats.growth.dailyGrowthRate > 0 ? 'up' : 'neutral'}
                        />
                      </div>
                    </div>
                  </section>

                  {/* Growth Chart */}
                  <section className="stats-section">
                    <SectionHeader title="Growth Over Time" />
                    <GrowthChart dataPoints={stats.growth.dataPoints} height={150} />
                  </section>

                  {/* Growth Data Points */}
                  {stats.growth.dataPoints.length > 0 && (
                    <section className="stats-section">
                      <SectionHeader title="Recent Data Points" />
                      <div className="data-points-table">
                        <div className="table-header">
                          <span>Date</span>
                          <span>Entries</span>
                          <span>Knowledge</span>
                          <span>Summaries</span>
                        </div>
                        {stats.growth.dataPoints
                          .slice(-10)
                          .reverse()
                          .map((point, index) => (
                            <div key={index} className="table-row">
                              <span>{new Date(point.timestamp).toLocaleDateString()}</span>
                              <span>{point.totalEntries}</span>
                              <span>{point.totalKnowledge}</span>
                              <span>{point.totalSummaries}</span>
                            </div>
                          ))}
                      </div>
                    </section>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <footer className="memory-stats-footer">
          {stats && (
            <span className="last-updated">
              Last updated: {new Date(stats.generatedAt).toLocaleString()}
            </span>
          )}
        </footer>
      </div>
    </div>
  );
};

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Format duration in milliseconds to human-readable string
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`;
  return `${(ms / 3600000).toFixed(1)}h`;
}

export default MemoryStats;
