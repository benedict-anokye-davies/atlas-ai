/**
 * Atlas Desktop - Memory Statistics Module
 * Provides comprehensive statistics about stored memories
 *
 * Features:
 * - Count total memories by type
 * - Storage space usage calculation
 * - Memory growth over time tracking
 * - Most referenced memories identification
 * - Topic distribution analysis
 * - Export statistics report
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { createModuleLogger } from '../utils/logger';
import { MemoryManager, MemoryType } from './index';
import { KnowledgeStore, KnowledgeCategory } from './knowledge-store';
import { ConversationSummarizer } from './summarizer';
import { TopicDetector, TopicCategory } from './topic-detector';

const logger = createModuleLogger('MemoryStats');

// ============================================================================
// TYPES AND INTERFACES
// ============================================================================

/**
 * Memory type count breakdown
 */
export interface MemoryTypeCount {
  conversation: number;
  fact: number;
  preference: number;
  context: number;
}

/**
 * Knowledge category count breakdown
 */
export interface KnowledgeCategoryCount {
  user_preference: number;
  user_fact: number;
  user_habit: number;
  world_fact: number;
  task_pattern: number;
  relationship: number;
  custom: number;
}

/**
 * Summary level count breakdown
 */
export interface SummaryLevelCount {
  conversation: number;
  session: number;
  daily: number;
  weekly: number;
  monthly: number;
}

/**
 * Confidence level count breakdown
 */
export interface ConfidenceLevelCount {
  low: number;
  medium: number;
  high: number;
  verified: number;
}

/**
 * Storage usage breakdown in bytes
 */
export interface StorageUsage {
  /** Total storage used in bytes */
  totalBytes: number;
  /** Memory entries storage in bytes */
  memoriesBytes: number;
  /** Conversations storage in bytes */
  conversationsBytes: number;
  /** Knowledge storage in bytes */
  knowledgeBytes: number;
  /** Summaries storage in bytes */
  summariesBytes: number;
  /** Vector storage in bytes */
  vectorsBytes: number;
  /** Human-readable total size */
  formattedTotal: string;
}

/**
 * Memory growth data point
 */
export interface GrowthDataPoint {
  /** Timestamp */
  timestamp: number;
  /** Total memory entries at this time */
  totalEntries: number;
  /** Total knowledge entries at this time */
  totalKnowledge: number;
  /** Total summaries at this time */
  totalSummaries: number;
  /** Total conversations at this time */
  totalConversations: number;
}

/**
 * Most referenced memory entry
 */
export interface ReferencedMemory {
  /** Entry ID */
  id: string;
  /** Entry content (truncated) */
  contentPreview: string;
  /** Entry type */
  type: MemoryType | KnowledgeCategory | 'summary';
  /** Number of accesses/references */
  accessCount: number;
  /** Importance score */
  importance: number;
  /** Last accessed timestamp */
  lastAccessedAt: number;
  /** Creation timestamp */
  createdAt: number;
}

/**
 * Topic distribution entry
 */
export interface TopicDistribution {
  /** Topic name */
  topic: string;
  /** Topic category */
  category: TopicCategory;
  /** Number of occurrences */
  count: number;
  /** Percentage of total */
  percentage: number;
  /** Average confidence when detected */
  avgConfidence: number;
  /** First mentioned timestamp */
  firstMentioned: number;
  /** Last mentioned timestamp */
  lastMentioned: number;
}

/**
 * Comprehensive memory statistics
 */
export interface MemoryStatistics {
  /** Generation timestamp */
  generatedAt: number;

  // Overview counts
  overview: {
    totalMemories: number;
    totalKnowledge: number;
    totalSummaries: number;
    totalConversations: number;
    totalMessages: number;
    activeTopics: number;
  };

  // Detailed breakdowns
  memoriesByType: MemoryTypeCount;
  knowledgeByCategory: KnowledgeCategoryCount;
  knowledgeByConfidence: ConfidenceLevelCount;
  summariesByLevel: SummaryLevelCount;

  // Storage metrics
  storage: StorageUsage;

  // Growth tracking
  growth: {
    /** Data points over time */
    dataPoints: GrowthDataPoint[];
    /** Growth rate (entries per day) */
    dailyGrowthRate: number;
    /** Days of data available */
    daysTracked: number;
  };

  // Most referenced entries
  mostReferenced: ReferencedMemory[];

  // Topic analysis
  topicDistribution: TopicDistribution[];

  // Session statistics
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

  // Action items summary
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

  // Sentiment overview
  sentiment: {
    positive: number;
    negative: number;
    neutral: number;
    mixed: number;
  };

  // Performance metrics
  performance: {
    averageImportance: number;
    averageKnowledgeConfidence: number;
    averageCompressionRatio: number;
    tokensSaved: number;
  };
}

/**
 * Statistics report format
 */
export type ReportFormat = 'json' | 'markdown' | 'text';

/**
 * Statistics configuration
 */
export interface StatsConfig {
  /** Directory for storing growth history */
  storageDir: string;
  /** Maximum growth data points to keep */
  maxGrowthPoints: number;
  /** Interval for recording growth (ms) */
  growthRecordInterval: number;
  /** Number of most referenced items to track */
  topReferencedCount: number;
  /** Enable automatic growth tracking */
  enableGrowthTracking: boolean;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: StatsConfig = {
  storageDir: path.join(process.env.HOME || process.env.USERPROFILE || '.', '.atlas', 'stats'),
  maxGrowthPoints: 365, // One year of daily data
  growthRecordInterval: 24 * 60 * 60 * 1000, // 24 hours
  topReferencedCount: 20,
  enableGrowthTracking: true,
};

/**
 * Statistics events
 */
export interface StatsEvents {
  'stats-generated': (stats: MemoryStatistics) => void;
  'growth-recorded': (dataPoint: GrowthDataPoint) => void;
  'report-exported': (path: string, format: ReportFormat) => void;
  error: (error: Error) => void;
}

// ============================================================================
// MEMORY STATISTICS MANAGER
// ============================================================================

/**
 * Memory Statistics Manager
 * Collects, analyzes, and reports on memory system statistics
 */
export class MemoryStatsManager extends EventEmitter {
  private config: StatsConfig;
  private growthHistory: GrowthDataPoint[] = [];
  private growthTimer: NodeJS.Timeout | null = null;
  private isInitialized = false;

  // References to memory subsystems
  private memoryManager: MemoryManager | null = null;
  private knowledgeStore: KnowledgeStore | null = null;
  private summarizer: ConversationSummarizer | null = null;
  private topicDetector: TopicDetector | null = null;

  constructor(config?: Partial<StatsConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };

    logger.info('MemoryStatsManager created', {
      storageDir: this.config.storageDir,
      enableGrowthTracking: this.config.enableGrowthTracking,
    });
  }

  /**
   * Initialize the statistics manager
   */
  async initialize(options?: {
    memoryManager?: MemoryManager;
    knowledgeStore?: KnowledgeStore;
    summarizer?: ConversationSummarizer;
    topicDetector?: TopicDetector;
  }): Promise<void> {
    if (this.isInitialized) return;

    try {
      // Store references to subsystems
      this.memoryManager = options?.memoryManager ?? null;
      this.knowledgeStore = options?.knowledgeStore ?? null;
      this.summarizer = options?.summarizer ?? null;
      this.topicDetector = options?.topicDetector ?? null;

      // Ensure storage directory exists
      await fs.promises.mkdir(this.config.storageDir, { recursive: true });

      // Load existing growth history
      await this.loadGrowthHistory();

      // Start growth tracking if enabled
      if (this.config.enableGrowthTracking) {
        this.startGrowthTracking();
      }

      this.isInitialized = true;
      logger.info('MemoryStatsManager initialized', {
        growthHistoryPoints: this.growthHistory.length,
      });
    } catch (error) {
      logger.error('Failed to initialize MemoryStatsManager', {
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * Set memory subsystem references
   */
  setSubsystems(options: {
    memoryManager?: MemoryManager;
    knowledgeStore?: KnowledgeStore;
    summarizer?: ConversationSummarizer;
    topicDetector?: TopicDetector;
  }): void {
    if (options.memoryManager) this.memoryManager = options.memoryManager;
    if (options.knowledgeStore) this.knowledgeStore = options.knowledgeStore;
    if (options.summarizer) this.summarizer = options.summarizer;
    if (options.topicDetector) this.topicDetector = options.topicDetector;
  }

  /**
   * Generate comprehensive memory statistics
   */
  async getStatistics(): Promise<MemoryStatistics> {
    const startTime = Date.now();

    // Collect data from all subsystems
    const memoryStats = this.memoryManager?.getStats() ?? {
      totalEntries: 0,
      totalConversations: 0,
      currentSessionMessages: 0,
    };

    const knowledgeStats = this.knowledgeStore?.getStats() ?? {
      totalEntries: 0,
      totalEntities: 0,
      byCategory: {
        user_preference: 0,
        user_fact: 0,
        user_habit: 0,
        world_fact: 0,
        task_pattern: 0,
        relationship: 0,
        custom: 0,
      },
      byConfidence: { low: 0, medium: 0, high: 0, verified: 0 },
      averageConfidence: 0,
    };

    const summarizerStats = this.summarizer?.getStats() ?? {
      totalSummaries: 0,
      summariesByLevel: {
        conversation: 0,
        session: 0,
        daily: 0,
        weekly: 0,
        monthly: 0,
      },
      totalExchangesSummarized: 0,
      totalActionItems: 0,
      completedActionItems: 0,
      averageCompressionRatio: 0,
      totalTokensSaved: 0,
    };

    const topicStats = this.topicDetector?.getStats() ?? {
      activeTopics: 0,
      turnCount: 0,
      primaryTopic: null,
      focus: null,
      diversity: 0,
    };

    // Calculate storage usage
    const storage = await this.calculateStorageUsage();

    // Get memories by type
    const memoriesByType = this.getMemoriesByType();

    // Get most referenced entries
    const mostReferenced = this.getMostReferenced();

    // Get topic distribution
    const topicDistribution = this.getTopicDistribution();

    // Get session statistics
    const sessions = this.getSessionStatistics();

    // Calculate total messages
    const totalMessages = this.getTotalMessageCount();

    // Get action items breakdown
    const actionItems = this.getActionItemsBreakdown();

    // Get sentiment overview
    const sentiment = this.getSentimentOverview();

    // Calculate growth metrics
    const growth = this.calculateGrowthMetrics();

    const stats: MemoryStatistics = {
      generatedAt: Date.now(),

      overview: {
        totalMemories: memoryStats.totalEntries,
        totalKnowledge: knowledgeStats.totalEntries,
        totalSummaries: summarizerStats.totalSummaries,
        totalConversations: memoryStats.totalConversations,
        totalMessages,
        activeTopics: topicStats.activeTopics,
      },

      memoriesByType,
      knowledgeByCategory: knowledgeStats.byCategory as KnowledgeCategoryCount,
      knowledgeByConfidence: knowledgeStats.byConfidence,
      summariesByLevel: summarizerStats.summariesByLevel,

      storage,
      growth,
      mostReferenced,
      topicDistribution,
      sessions,
      actionItems,
      sentiment,

      performance: {
        averageImportance: this.calculateAverageImportance(),
        averageKnowledgeConfidence: knowledgeStats.averageConfidence,
        averageCompressionRatio: summarizerStats.averageCompressionRatio,
        tokensSaved: summarizerStats.totalTokensSaved,
      },
    };

    this.emit('stats-generated', stats);
    logger.info('Statistics generated', {
      totalMemories: stats.overview.totalMemories,
      totalKnowledge: stats.overview.totalKnowledge,
      generationTimeMs: Date.now() - startTime,
    });

    return stats;
  }

  /**
   * Get quick overview statistics (lightweight)
   */
  getQuickStats(): {
    totalMemories: number;
    totalKnowledge: number;
    totalSummaries: number;
    totalConversations: number;
    storageUsed: string;
  } {
    const memoryStats = this.memoryManager?.getStats();
    const knowledgeStats = this.knowledgeStore?.getStats();
    const summarizerStats = this.summarizer?.getStats();

    return {
      totalMemories: memoryStats?.totalEntries ?? 0,
      totalKnowledge: knowledgeStats?.totalEntries ?? 0,
      totalSummaries: summarizerStats?.totalSummaries ?? 0,
      totalConversations: memoryStats?.totalConversations ?? 0,
      storageUsed: this.formatBytes(this.estimateStorageSize()),
    };
  }

  /**
   * Export statistics report
   */
  async exportReport(format: ReportFormat = 'json', outputPath?: string): Promise<string> {
    const stats = await this.getStatistics();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `memory-stats-${timestamp}.${format === 'markdown' ? 'md' : format}`;
    const filePath = outputPath || path.join(this.config.storageDir, 'reports', filename);

    // Ensure reports directory exists
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });

    let content: string;

    switch (format) {
      case 'json':
        content = JSON.stringify(stats, null, 2);
        break;
      case 'markdown':
        content = this.generateMarkdownReport(stats);
        break;
      case 'text':
        content = this.generateTextReport(stats);
        break;
      default:
        content = JSON.stringify(stats, null, 2);
    }

    await fs.promises.writeFile(filePath, content, 'utf-8');

    this.emit('report-exported', filePath, format);
    logger.info('Statistics report exported', { format, path: filePath });

    return filePath;
  }

  /**
   * Get answer to "How much do you remember?"
   */
  getMemoryAnswer(): string {
    const stats = this.getQuickStats();

    const parts: string[] = [];

    if (stats.totalMemories > 0) {
      parts.push(
        `${stats.totalMemories} memory ${stats.totalMemories === 1 ? 'entry' : 'entries'}`
      );
    }

    if (stats.totalKnowledge > 0) {
      parts.push(
        `${stats.totalKnowledge} learned ${stats.totalKnowledge === 1 ? 'fact' : 'facts'}`
      );
    }

    if (stats.totalSummaries > 0) {
      parts.push(
        `${stats.totalSummaries} conversation ${stats.totalSummaries === 1 ? 'summary' : 'summaries'}`
      );
    }

    if (stats.totalConversations > 0) {
      parts.push(
        `${stats.totalConversations} ${stats.totalConversations === 1 ? 'conversation' : 'conversations'}`
      );
    }

    if (parts.length === 0) {
      return "I don't have any memories stored yet. Our conversations will help me learn and remember things about you.";
    }

    const total = stats.totalMemories + stats.totalKnowledge + stats.totalSummaries;
    let response = `I currently remember ${parts.join(', ')}.`;

    if (total > 100) {
      response += ` That's quite a lot! Using ${stats.storageUsed} of storage.`;
    } else if (total > 50) {
      response += ` We're building up a good history together.`;
    } else if (total > 10) {
      response += ` I'm starting to learn about your preferences.`;
    } else {
      response += ` I'm just getting started learning about you.`;
    }

    return response;
  }

  /**
   * Record current state for growth tracking
   */
  async recordGrowthPoint(): Promise<void> {
    const memoryStats = this.memoryManager?.getStats();
    const knowledgeStats = this.knowledgeStore?.getStats();
    const summarizerStats = this.summarizer?.getStats();

    const dataPoint: GrowthDataPoint = {
      timestamp: Date.now(),
      totalEntries: memoryStats?.totalEntries ?? 0,
      totalKnowledge: knowledgeStats?.totalEntries ?? 0,
      totalSummaries: summarizerStats?.totalSummaries ?? 0,
      totalConversations: memoryStats?.totalConversations ?? 0,
    };

    this.growthHistory.push(dataPoint);

    // Trim if exceeds max points
    if (this.growthHistory.length > this.config.maxGrowthPoints) {
      this.growthHistory = this.growthHistory.slice(-this.config.maxGrowthPoints);
    }

    await this.saveGrowthHistory();
    this.emit('growth-recorded', dataPoint);

    logger.debug('Growth point recorded', dataPoint);
  }

  /**
   * Shutdown the statistics manager
   */
  async shutdown(): Promise<void> {
    this.stopGrowthTracking();
    await this.saveGrowthHistory();
    this.removeAllListeners();
    this.isInitialized = false;
    logger.info('MemoryStatsManager shutdown');
  }

  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================

  /**
   * Calculate storage usage across all memory subsystems
   */
  private async calculateStorageUsage(): Promise<StorageUsage> {
    const baseDir = path.join(process.env.HOME || process.env.USERPROFILE || '.', '.atlas');

    let memoriesBytes = 0;
    const conversationsBytes = 0;
    let knowledgeBytes = 0;
    let summariesBytes = 0;
    let vectorsBytes = 0;

    // Check memory.json
    const memoryPath = path.join(baseDir, 'memory', 'memory.json');
    memoriesBytes = await this.getFileSize(memoryPath);

    // Check knowledge.json
    const knowledgePath = path.join(baseDir, 'knowledge', 'knowledge.json');
    knowledgeBytes = await this.getFileSize(knowledgePath);

    // Check summaries.json
    const summariesPath = path.join(baseDir, 'summaries', 'summaries.json');
    summariesBytes = await this.getFileSize(summariesPath);

    // Check vectors directory
    const vectorsPath = path.join(baseDir, 'vectors');
    vectorsBytes = await this.getDirectorySize(vectorsPath);

    const totalBytes =
      memoriesBytes + conversationsBytes + knowledgeBytes + summariesBytes + vectorsBytes;

    return {
      totalBytes,
      memoriesBytes,
      conversationsBytes,
      knowledgeBytes,
      summariesBytes,
      vectorsBytes,
      formattedTotal: this.formatBytes(totalBytes),
    };
  }

  /**
   * Get file size in bytes
   */
  private async getFileSize(filePath: string): Promise<number> {
    try {
      const stat = await fs.promises.stat(filePath);
      return stat.size;
    } catch {
      return 0;
    }
  }

  /**
   * Get directory size recursively
   */
  private async getDirectorySize(dirPath: string): Promise<number> {
    try {
      const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
      let totalSize = 0;

      for (const entry of entries) {
        const entryPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          totalSize += await this.getDirectorySize(entryPath);
        } else {
          totalSize += await this.getFileSize(entryPath);
        }
      }

      return totalSize;
    } catch {
      return 0;
    }
  }

  /**
   * Format bytes to human-readable string
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';

    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const k = 1024;
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${units[i]}`;
  }

  /**
   * Estimate current storage size (quick estimate)
   */
  private estimateStorageSize(): number {
    const memoryStats = this.memoryManager?.getStats();
    const knowledgeStats = this.knowledgeStore?.getStats();
    const summarizerStats = this.summarizer?.getStats();

    // Rough estimates per entry type
    const avgMemoryEntrySize = 500; // bytes
    const avgKnowledgeEntrySize = 300;
    const avgSummarySize = 2000;

    return (
      (memoryStats?.totalEntries ?? 0) * avgMemoryEntrySize +
      (knowledgeStats?.totalEntries ?? 0) * avgKnowledgeEntrySize +
      (summarizerStats?.totalSummaries ?? 0) * avgSummarySize
    );
  }

  /**
   * Get memories breakdown by type
   */
  private getMemoriesByType(): MemoryTypeCount {
    // If we had direct access to memory entries, we'd count them
    // For now, return zeros as placeholder
    return {
      conversation: 0,
      fact: 0,
      preference: 0,
      context: 0,
    };
  }

  /**
   * Get most referenced/accessed entries
   */
  private getMostReferenced(): ReferencedMemory[] {
    const referenced: ReferencedMemory[] = [];

    // Get from knowledge store (has access counts via reinforcements)
    if (this.knowledgeStore) {
      const allKnowledge = this.knowledgeStore.query({
        sortBy: 'reinforcements',
        sortOrder: 'desc',
        limit: this.config.topReferencedCount,
      });

      for (const entry of allKnowledge) {
        referenced.push({
          id: entry.id,
          contentPreview: entry.naturalForm.substring(0, 100),
          type: entry.category,
          accessCount: entry.reinforcements,
          importance: entry.confidenceScore,
          lastAccessedAt: entry.accessedAt,
          createdAt: entry.createdAt,
        });
      }
    }

    // Sort by access count
    return referenced
      .sort((a, b) => b.accessCount - a.accessCount)
      .slice(0, this.config.topReferencedCount);
  }

  /**
   * Get topic distribution analysis
   */
  private getTopicDistribution(): TopicDistribution[] {
    if (!this.topicDetector) return [];

    const activeTopics = this.topicDetector.getActiveTopics();
    const totalMentions = activeTopics.reduce((sum, t) => sum + t.mentions, 0);

    return activeTopics.map((topic) => ({
      topic: topic.name,
      category: topic.category,
      count: topic.mentions,
      percentage: totalMentions > 0 ? (topic.mentions / totalMentions) * 100 : 0,
      avgConfidence: topic.confidence,
      firstMentioned: topic.firstDetected,
      lastMentioned: topic.lastDetected,
    }));
  }

  /**
   * Get session statistics
   */
  private getSessionStatistics(): MemoryStatistics['sessions'] {
    if (!this.memoryManager) {
      return {
        totalSessions: 0,
        averageMessagesPerSession: 0,
        averageSessionDuration: 0,
        longestSession: null,
      };
    }

    const sessions = this.memoryManager.getAllSessions();
    if (sessions.length === 0) {
      return {
        totalSessions: 0,
        averageMessagesPerSession: 0,
        averageSessionDuration: 0,
        longestSession: null,
      };
    }

    let totalMessages = 0;
    let totalDuration = 0;
    let longestSession: { id: string; duration: number; messageCount: number } | null = null;

    for (const session of sessions) {
      const messageCount = session.messages.length;
      const duration = session.lastActivityAt - session.startedAt;

      totalMessages += messageCount;
      totalDuration += duration;

      if (!longestSession || duration > longestSession.duration) {
        longestSession = {
          id: session.id,
          duration,
          messageCount,
        };
      }
    }

    return {
      totalSessions: sessions.length,
      averageMessagesPerSession: sessions.length > 0 ? totalMessages / sessions.length : 0,
      averageSessionDuration: sessions.length > 0 ? totalDuration / sessions.length : 0,
      longestSession,
    };
  }

  /**
   * Get total message count
   */
  private getTotalMessageCount(): number {
    if (!this.memoryManager) return 0;

    const sessions = this.memoryManager.getAllSessions();
    return sessions.reduce((sum, session) => sum + session.messages.length, 0);
  }

  /**
   * Get action items breakdown
   */
  private getActionItemsBreakdown(): MemoryStatistics['actionItems'] {
    const result = {
      total: 0,
      completed: 0,
      pending: 0,
      byPriority: { high: 0, medium: 0, low: 0 },
    };

    if (!this.summarizer) return result;

    const allItems = this.summarizer.getAllActionItems();
    result.total = allItems.length;
    result.completed = allItems.filter((i) => i.completed).length;
    result.pending = result.total - result.completed;

    for (const item of allItems) {
      result.byPriority[item.priority]++;
    }

    return result;
  }

  /**
   * Get sentiment overview from summaries
   */
  private getSentimentOverview(): MemoryStatistics['sentiment'] {
    const result = { positive: 0, negative: 0, neutral: 0, mixed: 0 };

    if (!this.summarizer) return result;

    const summaries = this.summarizer.searchSummaries({}).summaries;

    for (const summary of summaries) {
      result[summary.sentiment]++;
    }

    return result;
  }

  /**
   * Calculate average importance across memory entries
   */
  private calculateAverageImportance(): number {
    // Placeholder - would need access to raw memory entries
    return 0.5;
  }

  /**
   * Calculate growth metrics
   */
  private calculateGrowthMetrics(): MemoryStatistics['growth'] {
    if (this.growthHistory.length < 2) {
      return {
        dataPoints: this.growthHistory,
        dailyGrowthRate: 0,
        daysTracked: this.growthHistory.length,
      };
    }

    const first = this.growthHistory[0];
    const last = this.growthHistory[this.growthHistory.length - 1];
    const daysDiff = (last.timestamp - first.timestamp) / (24 * 60 * 60 * 1000);

    const totalGrowth =
      last.totalEntries -
      first.totalEntries +
      (last.totalKnowledge - first.totalKnowledge) +
      (last.totalSummaries - first.totalSummaries);

    return {
      dataPoints: this.growthHistory,
      dailyGrowthRate: daysDiff > 0 ? totalGrowth / daysDiff : 0,
      daysTracked: Math.ceil(daysDiff),
    };
  }

  /**
   * Generate markdown report
   */
  private generateMarkdownReport(stats: MemoryStatistics): string {
    const date = new Date(stats.generatedAt).toLocaleString();

    return `# Atlas Memory Statistics Report

Generated: ${date}

## Overview

| Metric | Value |
|--------|-------|
| Total Memories | ${stats.overview.totalMemories} |
| Total Knowledge | ${stats.overview.totalKnowledge} |
| Total Summaries | ${stats.overview.totalSummaries} |
| Total Conversations | ${stats.overview.totalConversations} |
| Total Messages | ${stats.overview.totalMessages} |
| Active Topics | ${stats.overview.activeTopics} |

## Storage Usage

- **Total**: ${stats.storage.formattedTotal}
- Memories: ${this.formatBytes(stats.storage.memoriesBytes)}
- Knowledge: ${this.formatBytes(stats.storage.knowledgeBytes)}
- Summaries: ${this.formatBytes(stats.storage.summariesBytes)}
- Vectors: ${this.formatBytes(stats.storage.vectorsBytes)}

## Knowledge by Category

| Category | Count |
|----------|-------|
| User Preferences | ${stats.knowledgeByCategory.user_preference} |
| User Facts | ${stats.knowledgeByCategory.user_fact} |
| User Habits | ${stats.knowledgeByCategory.user_habit} |
| World Facts | ${stats.knowledgeByCategory.world_fact} |
| Task Patterns | ${stats.knowledgeByCategory.task_pattern} |
| Relationships | ${stats.knowledgeByCategory.relationship} |

## Knowledge by Confidence

| Level | Count |
|-------|-------|
| Verified | ${stats.knowledgeByConfidence.verified} |
| High | ${stats.knowledgeByConfidence.high} |
| Medium | ${stats.knowledgeByConfidence.medium} |
| Low | ${stats.knowledgeByConfidence.low} |

## Summaries by Level

| Level | Count |
|-------|-------|
| Conversation | ${stats.summariesByLevel.conversation} |
| Session | ${stats.summariesByLevel.session} |
| Daily | ${stats.summariesByLevel.daily} |
| Weekly | ${stats.summariesByLevel.weekly} |
| Monthly | ${stats.summariesByLevel.monthly} |

## Action Items

- **Total**: ${stats.actionItems.total}
- **Completed**: ${stats.actionItems.completed}
- **Pending**: ${stats.actionItems.pending}
- High Priority: ${stats.actionItems.byPriority.high}
- Medium Priority: ${stats.actionItems.byPriority.medium}
- Low Priority: ${stats.actionItems.byPriority.low}

## Sentiment Overview

| Sentiment | Count |
|-----------|-------|
| Positive | ${stats.sentiment.positive} |
| Negative | ${stats.sentiment.negative} |
| Neutral | ${stats.sentiment.neutral} |
| Mixed | ${stats.sentiment.mixed} |

## Session Statistics

- Total Sessions: ${stats.sessions.totalSessions}
- Average Messages/Session: ${stats.sessions.averageMessagesPerSession.toFixed(1)}
- Average Session Duration: ${this.formatDuration(stats.sessions.averageSessionDuration)}
${stats.sessions.longestSession ? `- Longest Session: ${this.formatDuration(stats.sessions.longestSession.duration)} (${stats.sessions.longestSession.messageCount} messages)` : ''}

## Performance Metrics

- Average Knowledge Confidence: ${(stats.performance.averageKnowledgeConfidence * 100).toFixed(1)}%
- Average Compression Ratio: ${(stats.performance.averageCompressionRatio * 100).toFixed(1)}%
- Tokens Saved: ${stats.performance.tokensSaved.toLocaleString()}

## Growth Statistics

- Days Tracked: ${stats.growth.daysTracked}
- Daily Growth Rate: ${stats.growth.dailyGrowthRate.toFixed(2)} entries/day

## Top Referenced Entries

${
  stats.mostReferenced.length > 0
    ? stats.mostReferenced
        .slice(0, 10)
        .map(
          (entry, i) =>
            `${i + 1}. **${entry.type}**: ${entry.contentPreview} (${entry.accessCount} accesses)`
        )
        .join('\n')
    : 'No referenced entries yet.'
}

## Topic Distribution

${
  stats.topicDistribution.length > 0
    ? stats.topicDistribution
        .slice(0, 10)
        .map(
          (topic) =>
            `- **${topic.topic}** (${topic.category}): ${topic.count} mentions (${topic.percentage.toFixed(1)}%)`
        )
        .join('\n')
    : 'No topics detected yet.'
}

---
*Report generated by Atlas Memory Statistics*
`;
  }

  /**
   * Generate plain text report
   */
  private generateTextReport(stats: MemoryStatistics): string {
    const date = new Date(stats.generatedAt).toLocaleString();

    return `ATLAS MEMORY STATISTICS REPORT
Generated: ${date}

=== OVERVIEW ===
Total Memories: ${stats.overview.totalMemories}
Total Knowledge: ${stats.overview.totalKnowledge}
Total Summaries: ${stats.overview.totalSummaries}
Total Conversations: ${stats.overview.totalConversations}
Total Messages: ${stats.overview.totalMessages}
Active Topics: ${stats.overview.activeTopics}

=== STORAGE ===
Total: ${stats.storage.formattedTotal}

=== SESSIONS ===
Total Sessions: ${stats.sessions.totalSessions}
Average Messages/Session: ${stats.sessions.averageMessagesPerSession.toFixed(1)}

=== ACTION ITEMS ===
Total: ${stats.actionItems.total}
Completed: ${stats.actionItems.completed}
Pending: ${stats.actionItems.pending}

=== GROWTH ===
Days Tracked: ${stats.growth.daysTracked}
Daily Growth Rate: ${stats.growth.dailyGrowthRate.toFixed(2)} entries/day

Report generated by Atlas Memory Statistics
`;
  }

  /**
   * Format duration in milliseconds to human-readable string
   */
  private formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`;
    return `${(ms / 3600000).toFixed(1)}h`;
  }

  /**
   * Start growth tracking timer
   */
  private startGrowthTracking(): void {
    if (this.growthTimer) return;

    // Record immediately
    this.recordGrowthPoint().catch((e) =>
      logger.error('Initial growth recording failed', { error: (e as Error).message })
    );

    // Schedule periodic recording
    this.growthTimer = setInterval(() => {
      this.recordGrowthPoint().catch((e) =>
        logger.error('Growth recording failed', { error: (e as Error).message })
      );
    }, this.config.growthRecordInterval);

    logger.info('Growth tracking started', {
      intervalMs: this.config.growthRecordInterval,
    });
  }

  /**
   * Stop growth tracking timer
   */
  private stopGrowthTracking(): void {
    if (this.growthTimer) {
      clearInterval(this.growthTimer);
      this.growthTimer = null;
      logger.info('Growth tracking stopped');
    }
  }

  /**
   * Save growth history to disk
   */
  private async saveGrowthHistory(): Promise<void> {
    try {
      const filePath = path.join(this.config.storageDir, 'growth-history.json');
      await fs.promises.writeFile(
        filePath,
        JSON.stringify({ history: this.growthHistory, savedAt: Date.now() }, null, 2)
      );
    } catch (error) {
      logger.error('Failed to save growth history', { error: (error as Error).message });
    }
  }

  /**
   * Load growth history from disk
   */
  private async loadGrowthHistory(): Promise<void> {
    try {
      const filePath = path.join(this.config.storageDir, 'growth-history.json');
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const data = JSON.parse(content) as { history: GrowthDataPoint[] };
      this.growthHistory = data.history || [];
      logger.info('Growth history loaded', { points: this.growthHistory.length });
    } catch {
      // File doesn't exist or is corrupted - start fresh
      this.growthHistory = [];
      logger.debug('No existing growth history found');
    }
  }

  // Type-safe event emitter methods
  on<K extends keyof StatsEvents>(event: K, listener: StatsEvents[K]): this {
    return super.on(event, listener);
  }

  off<K extends keyof StatsEvents>(event: K, listener: StatsEvents[K]): this {
    return super.off(event, listener);
  }

  emit<K extends keyof StatsEvents>(event: K, ...args: Parameters<StatsEvents[K]>): boolean {
    return super.emit(event, ...args);
  }
}

// ============================================================================
// SINGLETON AND EXPORTS
// ============================================================================

let statsManager: MemoryStatsManager | null = null;

/**
 * Get or create the memory stats manager instance
 */
export async function getMemoryStatsManager(
  config?: Partial<StatsConfig>
): Promise<MemoryStatsManager> {
  if (!statsManager) {
    statsManager = new MemoryStatsManager(config);
    await statsManager.initialize();
  }
  return statsManager;
}

/**
 * Shutdown the memory stats manager
 */
export async function shutdownMemoryStatsManager(): Promise<void> {
  if (statsManager) {
    await statsManager.shutdown();
    statsManager = null;
  }
}

export default MemoryStatsManager;
