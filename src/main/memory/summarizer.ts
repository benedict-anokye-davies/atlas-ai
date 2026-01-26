/**
 * Atlas Desktop - Conversation Summarizer
 * Automatic conversation summarization with LLM integration
 *
 * Features:
 * - Summarizes conversations after N exchanges or on session end
 * - Uses LLM to generate concise summaries
 * - Extracts key facts, decisions, and action items
 * - Stores summaries with timestamps and references
 * - Enables searching past conversation summaries
 * - Hierarchical summarization (daily, weekly, monthly)
 * - Integrates with existing memory system (LanceDB)
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { createModuleLogger } from '../utils/logger';
import { LLMManager, getLLMManager } from '../llm/manager';
import { estimateTokenCount } from '../../shared/types/llm';
import {
  ConversationSummary,
  ConversationExchange,
  ActionItem,
  SummarizationConfig,
  SummarizationResult,
  HierarchicalRollupResult,
  SummarySearchOptions,
  SummarySearchResult,
  SummarizerStats,
  SummarizerEvents,
  SummaryLevel,
  DEFAULT_SUMMARIZATION_CONFIG,
  SUMMARIZATION_PROMPTS,
} from './types';

const logger = createModuleLogger('ConversationSummarizer');

/**
 * Conversation Summarizer
 * Manages automatic summarization of conversations using LLM
 */
export class ConversationSummarizer extends EventEmitter {
  private config: SummarizationConfig;
  private llmManager: LLMManager | null = null;
  private summaries: Map<string, ConversationSummary> = new Map();
  private pendingExchanges: Map<string, ConversationExchange[]> = new Map();
  private storageDir: string;
  private autoSaveTimer: NodeJS.Timeout | null = null;
  private hierarchicalTimers: Map<SummaryLevel, NodeJS.Timeout> = new Map();
  private isInitialized = false;
  private isDirty = false;

  constructor(config?: Partial<SummarizationConfig>) {
    super();
    this.config = { ...DEFAULT_SUMMARIZATION_CONFIG, ...config };
    this.storageDir = path.join(
      process.env.HOME || process.env.USERPROFILE || '.',
      '.atlas',
      'summaries'
    );

    logger.info('ConversationSummarizer created', {
      config: this.config,
      storageDir: this.storageDir,
    });
  }

  /**
   * Initialize the summarizer
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      // Ensure storage directory exists
      await fs.promises.mkdir(this.storageDir, { recursive: true });

      // Get LLM manager
      this.llmManager = getLLMManager();

      // Load existing summaries
      await this.loadSummaries();

      // Start auto-save timer
      this.startAutoSave();

      // Schedule hierarchical rollups
      if (this.config.enableHierarchicalSummary) {
        this.scheduleHierarchicalRollups();
      }

      this.isInitialized = true;
      logger.info('ConversationSummarizer initialized', {
        loadedSummaries: this.summaries.size,
      });
    } catch (error) {
      logger.error('Failed to initialize ConversationSummarizer', {
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * Record a conversation exchange
   */
  recordExchange(
    sessionId: string,
    userMessage: string,
    assistantResponse: string,
    metadata?: { topics?: string[]; sentiment?: 'positive' | 'negative' | 'neutral'; importance?: number }
  ): ConversationExchange {
    const exchange: ConversationExchange = {
      id: this.generateId('exchange'),
      userMessage,
      assistantResponse,
      timestamp: Date.now(),
      topics: metadata?.topics,
      sentiment: metadata?.sentiment,
      importance: metadata?.importance ?? 0.5,
    };

    // Add to pending exchanges for this session
    if (!this.pendingExchanges.has(sessionId)) {
      this.pendingExchanges.set(sessionId, []);
    }
    this.pendingExchanges.get(sessionId)!.push(exchange);

    logger.debug('Exchange recorded', {
      sessionId,
      exchangeId: exchange.id,
      pendingCount: this.pendingExchanges.get(sessionId)!.length,
    });

    // Check if auto-summarization should trigger
    if (this.config.enableAutoSummarization) {
      const exchanges = this.pendingExchanges.get(sessionId)!;
      if (exchanges.length >= this.config.maxExchangesBeforeSummary) {
        // Trigger async summarization
        this.summarizeSession(sessionId).catch((err) =>
          logger.error('Auto-summarization failed', { error: (err as Error).message })
        );
      }
    }

    return exchange;
  }

  /**
   * Summarize a session's pending exchanges
   */
  async summarizeSession(sessionId: string): Promise<SummarizationResult | null> {
    const exchanges = this.pendingExchanges.get(sessionId);
    if (!exchanges || exchanges.length < this.config.minExchangesForSummary) {
      logger.debug('Not enough exchanges to summarize', {
        sessionId,
        exchangeCount: exchanges?.length ?? 0,
        required: this.config.minExchangesForSummary,
      });
      return null;
    }

    this.emit('summarization-started', 'conversation', exchanges.length);
    const startTime = Date.now();

    try {
      // Build conversation text for LLM
      const conversationText = this.buildConversationText(exchanges);
      const originalTokens = estimateTokenCount(conversationText);

      // Generate summary using LLM
      let summaryData: Partial<ConversationSummary>;
      let usedLLM = false;

      if (this.llmManager) {
        try {
          summaryData = await this.generateLLMSummary(conversationText);
          usedLLM = true;
        } catch (llmError) {
          logger.warn('LLM summarization failed, using fallback', {
            error: (llmError as Error).message,
          });
          summaryData = this.generateFallbackSummary(exchanges);
        }
      } else {
        summaryData = this.generateFallbackSummary(exchanges);
      }

      // Create the full summary object
      const summary: ConversationSummary = {
        id: this.generateId('summary'),
        sessionId,
        level: 'conversation',
        summary: summaryData.summary || 'No summary generated',
        keyFacts: summaryData.keyFacts || [],
        decisions: summaryData.decisions || [],
        actionItems: summaryData.actionItems || [],
        topics: summaryData.topics || [],
        sentiment: summaryData.sentiment || 'neutral',
        exchangeCount: exchanges.length,
        startTime: exchanges[0].timestamp,
        endTime: exchanges[exchanges.length - 1].timestamp,
        createdAt: Date.now(),
        originalTokens,
        summaryTokens: estimateTokenCount(summaryData.summary || ''),
        compressionRatio: originalTokens > 0 ? estimateTokenCount(summaryData.summary || '') / originalTokens : 1,
      };

      // Store the summary
      this.summaries.set(summary.id, summary);
      this.isDirty = true;

      // Clear pending exchanges
      this.pendingExchanges.delete(sessionId);

      // Emit action items
      for (const item of summary.actionItems) {
        this.emit('action-item-extracted', item);
      }

      const result: SummarizationResult = {
        summary,
        exchangesProcessed: exchanges.length,
        processingTimeMs: Date.now() - startTime,
        usedLLM,
      };

      this.emit('summarization-completed', result);
      logger.info('Session summarized', {
        sessionId,
        summaryId: summary.id,
        exchangeCount: exchanges.length,
        compressionRatio: summary.compressionRatio.toFixed(2),
        usedLLM,
      });

      return result;
    } catch (error) {
      this.emit('error', error as Error, 'summarizeSession');
      logger.error('Summarization failed', { error: (error as Error).message });
      throw error;
    }
  }

  /**
   * Summarize session on end
   */
  async summarizeOnSessionEnd(sessionId: string): Promise<SummarizationResult | null> {
    if (!this.config.summarizeOnSessionEnd) {
      return null;
    }

    const exchanges = this.pendingExchanges.get(sessionId);
    if (!exchanges || exchanges.length === 0) {
      return null;
    }

    // Summarize even if below minimum threshold on session end
    const originalMinExchanges = this.config.minExchangesForSummary;
    this.config.minExchangesForSummary = 1;

    try {
      return await this.summarizeSession(sessionId);
    } finally {
      this.config.minExchangesForSummary = originalMinExchanges;
    }
  }

  /**
   * Generate LLM-based summary
   */
  private async generateLLMSummary(conversationText: string): Promise<Partial<ConversationSummary>> {
    if (!this.llmManager) {
      throw new Error('LLM manager not available');
    }

    // Truncate if too long
    const maxTokens = this.config.maxContextTokens;
    let truncatedText = conversationText;
    if (estimateTokenCount(conversationText) > maxTokens) {
      // Keep most recent content
      const words = conversationText.split(/\s+/);
      const targetWords = Math.floor(maxTokens * 0.8 * 4); // Rough word count
      truncatedText = words.slice(-targetWords).join(' ');
      logger.debug('Conversation text truncated for summarization', {
        originalTokens: estimateTokenCount(conversationText),
        truncatedTokens: estimateTokenCount(truncatedText),
      });
    }

    const prompt = SUMMARIZATION_PROMPTS.conversationSummary.replace('{conversation}', truncatedText);

    const response = await this.llmManager.chat(prompt);

    // Parse JSON response
    try {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          summary: parsed.summary || '',
          keyFacts: Array.isArray(parsed.keyFacts) ? parsed.keyFacts : [],
          decisions: Array.isArray(parsed.decisions) ? parsed.decisions : [],
          actionItems: this.parseActionItems(parsed.actionItems),
          topics: Array.isArray(parsed.topics) ? parsed.topics : [],
          sentiment: this.parseSentiment(parsed.sentiment),
        };
      }
    } catch (parseError) {
      logger.warn('Failed to parse LLM summary response', {
        error: (parseError as Error).message,
      });
    }

    // If JSON parsing fails, use the response as-is
    return {
      summary: response.content,
      keyFacts: [],
      decisions: [],
      actionItems: [],
      topics: [],
      sentiment: 'neutral',
    };
  }

  /**
   * Generate fallback summary without LLM
   */
  private generateFallbackSummary(exchanges: ConversationExchange[]): Partial<ConversationSummary> {
    // Extract topics from exchanges
    const topics = new Set<string>();
    exchanges.forEach((e) => e.topics?.forEach((t) => topics.add(t)));

    // Simple extractive summary - take first sentence of each assistant response
    const summaryParts: string[] = [];
    for (const exchange of exchanges.slice(-5)) {
      const firstSentence = exchange.assistantResponse.split(/[.!?]/)[0];
      if (firstSentence && firstSentence.length > 20) {
        summaryParts.push(firstSentence.trim());
      }
    }

    // Determine overall sentiment
    const sentiments = exchanges.map((e) => e.sentiment).filter((s) => s);
    const sentimentCounts = { positive: 0, negative: 0, neutral: 0 };
    sentiments.forEach((s) => {
      if (s && s in sentimentCounts) {
        sentimentCounts[s as keyof typeof sentimentCounts]++;
      }
    });

    let sentiment: ConversationSummary['sentiment'] = 'neutral';
    if (sentimentCounts.positive > sentimentCounts.negative * 2) {
      sentiment = 'positive';
    } else if (sentimentCounts.negative > sentimentCounts.positive * 2) {
      sentiment = 'negative';
    } else if (sentimentCounts.positive > 0 && sentimentCounts.negative > 0) {
      sentiment = 'mixed';
    }

    return {
      summary: summaryParts.join('. ') || 'Conversation summary not available.',
      keyFacts: [],
      decisions: [],
      actionItems: [],
      topics: Array.from(topics),
      sentiment,
    };
  }

  /**
   * Perform hierarchical rollup
   */
  async performHierarchicalRollup(
    targetLevel: SummaryLevel,
    sourceSummaries: ConversationSummary[]
  ): Promise<HierarchicalRollupResult | null> {
    if (sourceSummaries.length < 2) {
      return null;
    }

    const startTime = Date.now();
    this.emit('summarization-started', targetLevel, sourceSummaries.length);

    try {
      // Build summaries text for rollup
      const summariesText = sourceSummaries
        .map((s, i) => `Summary ${i + 1} (${new Date(s.startTime).toLocaleDateString()}):\n${s.summary}`)
        .join('\n\n');

      let rollupData: Partial<ConversationSummary>;

      if (this.llmManager) {
        try {
          const prompt = SUMMARIZATION_PROMPTS.hierarchicalRollup
            .replace('{level}', this.getLevelDisplayName(sourceSummaries[0].level))
            .replace('{summaries}', summariesText);

          const response = await this.llmManager.chat(prompt);

          const jsonMatch = response.content.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            rollupData = {
              summary: parsed.summary || '',
              keyFacts: Array.isArray(parsed.keyFacts) ? parsed.keyFacts : [],
              decisions: Array.isArray(parsed.decisions) ? parsed.decisions : [],
              actionItems: this.parseActionItems(parsed.actionItems),
              topics: Array.isArray(parsed.topics) ? parsed.topics : [],
              sentiment: this.parseSentiment(parsed.sentiment),
            };
          } else {
            rollupData = { summary: response.content };
          }
        } catch (llmError) {
          logger.warn('LLM rollup failed, using fallback', {
            error: (llmError as Error).message,
          });
          rollupData = this.generateFallbackRollup(sourceSummaries);
        }
      } else {
        rollupData = this.generateFallbackRollup(sourceSummaries);
      }

      // Calculate totals
      const totalExchanges = sourceSummaries.reduce((sum, s) => sum + s.exchangeCount, 0);
      const totalOriginalTokens = sourceSummaries.reduce((sum, s) => sum + s.originalTokens, 0);

      // Create hierarchical summary
      const newSummary: ConversationSummary = {
        id: this.generateId('summary'),
        sessionId: `${targetLevel}-${Date.now()}`,
        level: targetLevel,
        summary: rollupData.summary || 'Rollup summary not available.',
        keyFacts: rollupData.keyFacts || this.mergeArrays(sourceSummaries.map((s) => s.keyFacts)),
        decisions: rollupData.decisions || this.mergeArrays(sourceSummaries.map((s) => s.decisions)),
        actionItems: rollupData.actionItems || this.mergeActionItems(sourceSummaries.map((s) => s.actionItems)),
        topics: rollupData.topics || this.mergeArrays(sourceSummaries.map((s) => s.topics)),
        sentiment: rollupData.sentiment || this.aggregateSentiment(sourceSummaries),
        exchangeCount: totalExchanges,
        startTime: Math.min(...sourceSummaries.map((s) => s.startTime)),
        endTime: Math.max(...sourceSummaries.map((s) => s.endTime)),
        createdAt: Date.now(),
        childSummaryIds: sourceSummaries.map((s) => s.id),
        originalTokens: totalOriginalTokens,
        summaryTokens: estimateTokenCount(rollupData.summary || ''),
        compressionRatio: totalOriginalTokens > 0 ? estimateTokenCount(rollupData.summary || '') / totalOriginalTokens : 1,
      };

      // Store and update parent references
      this.summaries.set(newSummary.id, newSummary);
      for (const source of sourceSummaries) {
        source.parentSummaryId = newSummary.id;
        this.summaries.set(source.id, source);
      }
      this.isDirty = true;

      const result: HierarchicalRollupResult = {
        targetLevel,
        sourceSummaryIds: sourceSummaries.map((s) => s.id),
        newSummary,
        processingTimeMs: Date.now() - startTime,
      };

      this.emit('rollup-completed', result);
      logger.info('Hierarchical rollup completed', {
        targetLevel,
        sourceCount: sourceSummaries.length,
        newSummaryId: newSummary.id,
      });

      return result;
    } catch (error) {
      this.emit('error', error as Error, 'performHierarchicalRollup');
      logger.error('Hierarchical rollup failed', { error: (error as Error).message });
      throw error;
    }
  }

  /**
   * Search summaries
   */
  searchSummaries(options: SummarySearchOptions = {}): SummarySearchResult {
    const startTime = Date.now();
    let results = Array.from(this.summaries.values());

    // Apply filters
    if (options.level) {
      results = results.filter((s) => s.level === options.level);
    }

    if (options.sessionId) {
      results = results.filter((s) => s.sessionId === options.sessionId);
    }

    if (options.topics && options.topics.length > 0) {
      results = results.filter((s) => options.topics!.some((t) => s.topics.includes(t)));
    }

    if (options.startDate) {
      results = results.filter((s) => s.startTime >= options.startDate!);
    }

    if (options.endDate) {
      results = results.filter((s) => s.endTime <= options.endDate!);
    }

    if (options.sentiment) {
      results = results.filter((s) => s.sentiment === options.sentiment);
    }

    if (options.hasActionItems) {
      results = results.filter((s) => s.actionItems.length > 0);
    }

    if (options.query) {
      const queryLower = options.query.toLowerCase();
      results = results.filter(
        (s) =>
          s.summary.toLowerCase().includes(queryLower) ||
          s.keyFacts.some((f) => f.toLowerCase().includes(queryLower)) ||
          s.topics.some((t) => t.toLowerCase().includes(queryLower))
      );
    }

    // Store total count before pagination
    const totalCount = results.length;

    // Sort
    const sortBy = options.sortBy || 'createdAt';
    const sortOrder = options.sortOrder || 'desc';
    results.sort((a, b) => {
      const aVal = a[sortBy] as number;
      const bVal = b[sortBy] as number;
      return sortOrder === 'desc' ? bVal - aVal : aVal - bVal;
    });

    // Pagination
    if (options.offset) {
      results = results.slice(options.offset);
    }
    if (options.limit) {
      results = results.slice(0, options.limit);
    }

    const searchResult: SummarySearchResult = {
      summaries: results,
      totalCount,
      query: options.query,
      searchTimeMs: Date.now() - startTime,
    };

    this.emit('search-performed', options, results.length);
    return searchResult;
  }

  /**
   * Get summary by ID
   */
  getSummary(id: string): ConversationSummary | undefined {
    return this.summaries.get(id);
  }

  /**
   * Get summaries for a session
   */
  getSessionSummaries(sessionId: string): ConversationSummary[] {
    return Array.from(this.summaries.values())
      .filter((s) => s.sessionId === sessionId)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  /**
   * Get all action items
   */
  getAllActionItems(completed?: boolean): ActionItem[] {
    const items: ActionItem[] = [];
    const summaryValues = Array.from(this.summaries.values());
    for (const summary of summaryValues) {
      for (const item of summary.actionItems) {
        if (completed === undefined || item.completed === completed) {
          items.push(item);
        }
      }
    }
    return items;
  }

  /**
   * Mark action item as completed
   */
  markActionItemCompleted(summaryId: string, itemIndex: number): boolean {
    const summary = this.summaries.get(summaryId);
    if (!summary || itemIndex >= summary.actionItems.length) {
      return false;
    }

    summary.actionItems[itemIndex].completed = true;
    this.isDirty = true;
    return true;
  }

  /**
   * Get summarizer statistics
   */
  getStats(): SummarizerStats {
    const summaries = Array.from(this.summaries.values());

    const byLevel: Record<SummaryLevel, number> = {
      conversation: 0,
      session: 0,
      daily: 0,
      weekly: 0,
      monthly: 0,
    };

    let totalExchanges = 0;
    let totalActionItems = 0;
    let completedActionItems = 0;
    let totalCompressionRatio = 0;
    let totalTokensSaved = 0;
    let lastSummarizationTime: number | undefined;

    for (const summary of summaries) {
      byLevel[summary.level]++;
      totalExchanges += summary.exchangeCount;
      totalActionItems += summary.actionItems.length;
      completedActionItems += summary.actionItems.filter((i) => i.completed).length;
      totalCompressionRatio += summary.compressionRatio;
      totalTokensSaved += summary.originalTokens - summary.summaryTokens;

      if (!lastSummarizationTime || summary.createdAt > lastSummarizationTime) {
        lastSummarizationTime = summary.createdAt;
      }
    }

    return {
      totalSummaries: summaries.length,
      summariesByLevel: byLevel,
      totalExchangesSummarized: totalExchanges,
      totalActionItems,
      completedActionItems,
      averageCompressionRatio: summaries.length > 0 ? totalCompressionRatio / summaries.length : 0,
      totalTokensSaved,
      lastSummarizationTime,
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<SummarizationConfig>): void {
    this.config = { ...this.config, ...config };

    // Reschedule hierarchical rollups if needed
    if (config.enableHierarchicalSummary !== undefined ||
        config.dailySummaryHour !== undefined ||
        config.weeklySummaryDay !== undefined ||
        config.monthlySummaryDay !== undefined) {
      this.cancelHierarchicalTimers();
      if (this.config.enableHierarchicalSummary) {
        this.scheduleHierarchicalRollups();
      }
    }

    logger.info('Summarizer config updated', { config: this.config });
  }

  /**
   * Clear all summaries
   */
  async clear(): Promise<void> {
    this.summaries.clear();
    this.pendingExchanges.clear();
    this.isDirty = true;
    await this.saveSummaries();
    logger.info('All summaries cleared');
  }

  /**
   * Shutdown the summarizer
   */
  async shutdown(): Promise<void> {
    // Summarize any pending exchanges
    const sessionIds = Array.from(this.pendingExchanges.keys());
    for (const sessionId of sessionIds) {
      try {
        await this.summarizeOnSessionEnd(sessionId);
      } catch (error) {
        logger.warn('Failed to summarize session on shutdown', {
          sessionId,
          error: (error as Error).message,
        });
      }
    }

    // Stop timers
    this.stopAutoSave();
    this.cancelHierarchicalTimers();

    // Save final state
    if (this.isDirty) {
      await this.saveSummaries();
    }

    this.removeAllListeners();
    this.isInitialized = false;
    logger.info('ConversationSummarizer shutdown');
  }

  // ============================================================================
  // Private helpers
  // ============================================================================

  /**
   * Build conversation text from exchanges
   */
  private buildConversationText(exchanges: ConversationExchange[]): string {
    return exchanges
      .map((e) => `User: ${e.userMessage}\nAtlas: ${e.assistantResponse}`)
      .join('\n\n');
  }

  /**
   * Parse action items from LLM response
   */
  private parseActionItems(items: unknown): ActionItem[] {
    if (!Array.isArray(items)) return [];

    return items.map((item: unknown) => {
      const i = item as Record<string, unknown>;
      return {
        description: String(i.description || ''),
        priority: this.parsePriority(i.priority),
        dueDate: i.dueDate ? new Date(String(i.dueDate)).getTime() : undefined,
        assignee: i.assignee ? String(i.assignee) : undefined,
        completed: Boolean(i.completed),
      };
    }).filter((i) => i.description.length > 0);
  }

  /**
   * Parse priority value
   */
  private parsePriority(value: unknown): ActionItem['priority'] {
    const v = String(value).toLowerCase();
    if (v === 'high') return 'high';
    if (v === 'low') return 'low';
    return 'medium';
  }

  /**
   * Parse sentiment value
   */
  private parseSentiment(value: unknown): ConversationSummary['sentiment'] {
    const v = String(value).toLowerCase();
    if (v === 'positive') return 'positive';
    if (v === 'negative') return 'negative';
    if (v === 'mixed') return 'mixed';
    return 'neutral';
  }

  /**
   * Generate fallback rollup summary
   */
  private generateFallbackRollup(summaries: ConversationSummary[]): Partial<ConversationSummary> {
    // Combine summaries
    const combinedSummary = summaries
      .map((s) => s.summary)
      .filter((s) => s.length > 0)
      .join(' ');

    // Truncate if too long
    const maxLength = this.config.targetSummaryTokens * 4; // Rough char estimate
    const truncated = combinedSummary.length > maxLength
      ? combinedSummary.substring(0, maxLength) + '...'
      : combinedSummary;

    return {
      summary: truncated,
      keyFacts: this.mergeArrays(summaries.map((s) => s.keyFacts)).slice(0, 10),
      decisions: this.mergeArrays(summaries.map((s) => s.decisions)).slice(0, 10),
      actionItems: this.mergeActionItems(summaries.map((s) => s.actionItems)),
      topics: this.mergeArrays(summaries.map((s) => s.topics)).slice(0, 10),
      sentiment: this.aggregateSentiment(summaries),
    };
  }

  /**
   * Merge arrays removing duplicates
   */
  private mergeArrays(arrays: string[][]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const arr of arrays) {
      for (const item of arr) {
        const lower = item.toLowerCase();
        if (!seen.has(lower)) {
          seen.add(lower);
          result.push(item);
        }
      }
    }
    return result;
  }

  /**
   * Merge action items removing duplicates
   */
  private mergeActionItems(arrays: ActionItem[][]): ActionItem[] {
    const seen = new Set<string>();
    const result: ActionItem[] = [];
    for (const arr of arrays) {
      for (const item of arr) {
        const key = item.description.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          result.push(item);
        }
      }
    }
    return result;
  }

  /**
   * Aggregate sentiment from multiple summaries
   */
  private aggregateSentiment(summaries: ConversationSummary[]): ConversationSummary['sentiment'] {
    const counts = { positive: 0, negative: 0, neutral: 0, mixed: 0 };
    for (const s of summaries) {
      counts[s.sentiment]++;
    }

    if (counts.positive > counts.negative * 2 && counts.mixed < counts.positive) {
      return 'positive';
    }
    if (counts.negative > counts.positive * 2 && counts.mixed < counts.negative) {
      return 'negative';
    }
    if (counts.mixed > 0 || (counts.positive > 0 && counts.negative > 0)) {
      return 'mixed';
    }
    return 'neutral';
  }

  /**
   * Get display name for summary level
   */
  private getLevelDisplayName(level: SummaryLevel): string {
    const names: Record<SummaryLevel, string> = {
      conversation: 'conversation',
      session: 'session',
      daily: 'daily',
      weekly: 'weekly',
      monthly: 'monthly',
    };
    return names[level];
  }

  /**
   * Generate unique ID
   */
  private generateId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Start auto-save timer
   */
  private startAutoSave(): void {
    if (this.autoSaveTimer) return;
    this.autoSaveTimer = setInterval(() => {
      if (this.isDirty) {
        this.saveSummaries().catch((e) =>
          logger.error('Auto-save failed', { error: (e as Error).message })
        );
      }
    }, 60000); // Every minute
  }

  /**
   * Stop auto-save timer
   */
  private stopAutoSave(): void {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
  }

  /**
   * Schedule hierarchical rollups
   */
  private scheduleHierarchicalRollups(): void {
    // Daily rollup
    if (this.config.dailySummaryHour >= 0) {
      this.scheduleDailyRollup();
    }

    // Weekly rollup
    if (this.config.weeklySummaryDay >= 0) {
      this.scheduleWeeklyRollup();
    }

    // Monthly rollup
    if (this.config.monthlySummaryDay >= 0) {
      this.scheduleMonthlyRollup();
    }
  }

  /**
   * Schedule daily rollup
   */
  private scheduleDailyRollup(): void {
    const now = new Date();
    const target = new Date();
    target.setHours(this.config.dailySummaryHour, 0, 0, 0);

    if (target.getTime() <= now.getTime()) {
      target.setDate(target.getDate() + 1);
    }

    const delay = target.getTime() - now.getTime();

    const timer = setTimeout(async () => {
      try {
        // Get conversation summaries from yesterday
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        yesterday.setHours(0, 0, 0, 0);
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const summaries = this.searchSummaries({
          level: 'conversation',
          startDate: yesterday.getTime(),
          endDate: today.getTime(),
        }).summaries;

        if (summaries.length >= 2) {
          await this.performHierarchicalRollup('daily', summaries);
        }
      } catch (error) {
        logger.error('Daily rollup failed', { error: (error as Error).message });
      }

      // Reschedule
      this.scheduleDailyRollup();
    }, delay);

    this.hierarchicalTimers.set('daily', timer);
  }

  /**
   * Schedule weekly rollup
   */
  private scheduleWeeklyRollup(): void {
    const now = new Date();
    const target = new Date();
    target.setHours(this.config.dailySummaryHour >= 0 ? this.config.dailySummaryHour + 1 : 0, 0, 0, 0);

    // Find next target day
    while (target.getDay() !== this.config.weeklySummaryDay || target.getTime() <= now.getTime()) {
      target.setDate(target.getDate() + 1);
    }

    const delay = target.getTime() - now.getTime();

    const timer = setTimeout(async () => {
      try {
        // Get daily summaries from last week
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);

        const summaries = this.searchSummaries({
          level: 'daily',
          startDate: weekAgo.getTime(),
          endDate: Date.now(),
        }).summaries;

        if (summaries.length >= 2) {
          await this.performHierarchicalRollup('weekly', summaries);
        }
      } catch (error) {
        logger.error('Weekly rollup failed', { error: (error as Error).message });
      }

      // Reschedule
      this.scheduleWeeklyRollup();
    }, delay);

    this.hierarchicalTimers.set('weekly', timer);
  }

  /**
   * Schedule monthly rollup
   */
  private scheduleMonthlyRollup(): void {
    const now = new Date();
    const target = new Date();
    target.setDate(this.config.monthlySummaryDay);
    target.setHours(this.config.dailySummaryHour >= 0 ? this.config.dailySummaryHour + 2 : 1, 0, 0, 0);

    if (target.getTime() <= now.getTime()) {
      target.setMonth(target.getMonth() + 1);
    }

    const delay = target.getTime() - now.getTime();

    const timer = setTimeout(async () => {
      try {
        // Get weekly summaries from last month
        const monthAgo = new Date();
        monthAgo.setMonth(monthAgo.getMonth() - 1);

        const summaries = this.searchSummaries({
          level: 'weekly',
          startDate: monthAgo.getTime(),
          endDate: Date.now(),
        }).summaries;

        if (summaries.length >= 2) {
          await this.performHierarchicalRollup('monthly', summaries);
        }
      } catch (error) {
        logger.error('Monthly rollup failed', { error: (error as Error).message });
      }

      // Reschedule
      this.scheduleMonthlyRollup();
    }, delay);

    this.hierarchicalTimers.set('monthly', timer);
  }

  /**
   * Cancel hierarchical timers
   */
  private cancelHierarchicalTimers(): void {
    const timers = Array.from(this.hierarchicalTimers.values());
    for (const timer of timers) {
      clearTimeout(timer);
    }
    this.hierarchicalTimers.clear();
  }

  /**
   * Save summaries to disk
   */
  private async saveSummaries(): Promise<void> {
    try {
      const data = {
        summaries: Array.from(this.summaries.entries()),
        savedAt: Date.now(),
      };

      const filePath = path.join(this.storageDir, 'summaries.json');
      await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2));

      this.isDirty = false;
      logger.debug('Summaries saved', { count: this.summaries.size });
    } catch (error) {
      logger.error('Failed to save summaries', { error: (error as Error).message });
      throw error;
    }
  }

  /**
   * Load summaries from disk
   */
  private async loadSummaries(): Promise<void> {
    const filePath = path.join(this.storageDir, 'summaries.json');

    try {
      const exists = await fs.promises
        .access(filePath)
        .then(() => true)
        .catch(() => false);

      if (!exists) {
        logger.info('No existing summaries file found');
        return;
      }

      const content = await fs.promises.readFile(filePath, 'utf-8');
      const data = JSON.parse(content) as {
        summaries: Array<[string, ConversationSummary]>;
        savedAt: number;
      };

      this.summaries = new Map(data.summaries);
      logger.info('Summaries loaded', {
        count: this.summaries.size,
        savedAt: new Date(data.savedAt).toISOString(),
      });
    } catch (error) {
      logger.error('Failed to load summaries', { error: (error as Error).message });
    }
  }

  // Type-safe event emitter methods
  on<K extends keyof SummarizerEvents>(event: K, listener: SummarizerEvents[K]): this {
    return super.on(event, listener);
  }

  off<K extends keyof SummarizerEvents>(event: K, listener: SummarizerEvents[K]): this {
    return super.off(event, listener);
  }

  emit<K extends keyof SummarizerEvents>(event: K, ...args: Parameters<SummarizerEvents[K]>): boolean {
    return super.emit(event, ...args);
  }
}

// Singleton instance
let conversationSummarizer: ConversationSummarizer | null = null;

/**
 * Get or create the conversation summarizer instance
 */
export async function getConversationSummarizer(
  config?: Partial<SummarizationConfig>
): Promise<ConversationSummarizer> {
  if (!conversationSummarizer) {
    conversationSummarizer = new ConversationSummarizer(config);
    await conversationSummarizer.initialize();
  }
  return conversationSummarizer;
}

/**
 * Shutdown the conversation summarizer
 */
export async function shutdownConversationSummarizer(): Promise<void> {
  if (conversationSummarizer) {
    await conversationSummarizer.shutdown();
    conversationSummarizer = null;
  }
}

export default ConversationSummarizer;
