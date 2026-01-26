/**
 * Atlas ML Training - Data Labeler
 *
 * Implements semi-automatic labeling of training data:
 * - LLM-powered auto-labeling for conversations
 * - Quality scoring based on metrics
 * - Topic classification
 * - Sentiment analysis
 * - Manual labeling queue management
 *
 * @module ml/training/data-labeler
 */

import { EventEmitter } from 'events';
import * as fs from 'fs-extra';
import * as path from 'path';
import { app } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { createModuleLogger } from '../../utils/logger';
import { DatasetType, ConversationSample, LabelType, LabelingTask } from './types';
import { isoDate } from '../../../shared/utils';

const logger = createModuleLogger('DataLabeler');

// =============================================================================
// Labeler Configuration
// =============================================================================

export interface LabelerConfig {
  /** Enable LLM auto-labeling */
  autoLabelEnabled: boolean;
  /** Minimum confidence for auto-labels to be applied */
  autoLabelThreshold: number;
  /** Batch size for labeling */
  batchSize: number;
  /** Storage path for labels */
  storagePath: string;
  /** LLM model for labeling (use primary model by default) */
  llmModel?: string;
}

export const DEFAULT_LABELER_CONFIG: LabelerConfig = {
  autoLabelEnabled: true,
  autoLabelThreshold: 0.8,
  batchSize: 10,
  storagePath: '',
  llmModel: undefined,
};

// =============================================================================
// Label Definitions
// =============================================================================

export const TOPIC_LABELS = [
  'coding',
  'trading',
  'finance',
  'email',
  'calendar',
  'music',
  'files',
  'browser',
  'system',
  'conversation',
  'research',
  'task',
  'reminder',
  'weather',
  'news',
  'other',
] as const;

export const QUALITY_LABELS = [1, 2, 3, 4, 5] as const;

export const SENTIMENT_LABELS = ['positive', 'negative', 'neutral'] as const;

export const INTENT_LABELS = [
  'command',
  'question',
  'statement',
  'confirmation',
  'correction',
  'clarification',
  'greeting',
  'farewell',
  'other',
] as const;

export type TopicLabel = (typeof TOPIC_LABELS)[number];
export type QualityLabel = (typeof QUALITY_LABELS)[number];
export type SentimentLabel = (typeof SENTIMENT_LABELS)[number];
export type IntentLabel = (typeof INTENT_LABELS)[number];

// =============================================================================
// Data Labeler Class
// =============================================================================

export class DataLabeler extends EventEmitter {
  private config: LabelerConfig;
  private tasksPath: string;
  private pendingTasks: Map<string, LabelingTask> = new Map();
  private initialized: boolean = false;

  constructor(config?: Partial<LabelerConfig>) {
    super();
    this.config = { ...DEFAULT_LABELER_CONFIG, ...config };
    this.tasksPath =
      this.config.storagePath || path.join(app.getPath('userData'), 'training-data', 'labels');
  }

  /**
   * Initialize the labeler
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    await fs.ensureDir(this.tasksPath);
    await this.loadPendingTasks();

    this.initialized = true;
    logger.info('DataLabeler initialized', { pendingTasks: this.pendingTasks.size });
  }

  /**
   * Load pending labeling tasks from disk
   */
  private async loadPendingTasks(): Promise<void> {
    const tasksFile = path.join(this.tasksPath, 'pending.json');

    try {
      if (await fs.pathExists(tasksFile)) {
        const tasks: LabelingTask[] = await fs.readJson(tasksFile);
        for (const task of tasks) {
          if (task.status === 'pending' || task.status === 'needs_review') {
            this.pendingTasks.set(task.id, task);
          }
        }
      }
    } catch (err) {
      logger.warn('Failed to load pending tasks', { error: err });
    }
  }

  /**
   * Save pending tasks to disk
   */
  private async savePendingTasks(): Promise<void> {
    const tasksFile = path.join(this.tasksPath, 'pending.json');
    const tasks = Array.from(this.pendingTasks.values());
    await fs.writeJson(tasksFile, tasks, { spaces: 2 });
  }

  // ==========================================================================
  // Auto-Labeling
  // ==========================================================================

  /**
   * Auto-label a conversation sample
   */
  async autoLabelConversation(sample: ConversationSample): Promise<Partial<ConversationSample>> {
    if (!this.config.autoLabelEnabled) {
      return {};
    }

    const labels: Partial<ConversationSample> = {};

    try {
      // Quality assessment
      const qualityResult = await this.assessQuality(sample);
      if (qualityResult.confidence >= this.config.autoLabelThreshold) {
        labels.quality = qualityResult.score;
      } else {
        // Create labeling task for review
        await this.createTask(
          sample.id,
          'conversation',
          'quality',
          qualityResult.score,
          qualityResult.confidence
        );
      }

      // Topic classification
      const topics = await this.classifyTopics(sample);
      if (topics.length > 0) {
        labels.topics = topics;
      }

      // Sentiment analysis
      const sentiment = await this.analyzeSentiment(sample);
      if (sentiment.confidence >= this.config.autoLabelThreshold) {
        labels.userSatisfaction = sentiment.label as 'positive' | 'negative' | 'neutral';
      }

      logger.debug('Auto-labeled conversation', { sampleId: sample.id, labels });
    } catch (err) {
      logger.error('Failed to auto-label conversation', { error: err, sampleId: sample.id });
    }

    return labels;
  }

  /**
   * Assess conversation quality (1-5)
   */
  private async assessQuality(
    sample: ConversationSample
  ): Promise<{ score: number; confidence: number }> {
    // Heuristic-based quality assessment
    let score = 3; // Start at neutral
    let factors = 0;

    // Response length (too short or too long is bad)
    const responseLength = sample.assistantResponse.length;
    if (responseLength > 100 && responseLength < 2000) {
      score += 0.5;
    } else if (responseLength < 20 || responseLength > 5000) {
      score -= 0.5;
    }
    factors++;

    // User message clarity (longer = more context)
    const userLength = sample.userMessage.length;
    if (userLength > 20 && userLength < 500) {
      score += 0.3;
    }
    factors++;

    // No error indicators in response
    const errorIndicators = ['sorry', 'cannot', "can't", 'error', 'failed', 'unable'];
    if (!errorIndicators.some((e) => sample.assistantResponse.toLowerCase().includes(e))) {
      score += 0.3;
    }
    factors++;

    // Response completeness (ends with punctuation)
    if (sample.assistantResponse.match(/[.!?]$/)) {
      score += 0.2;
    }
    factors++;

    // Latency bonus (fast responses are good if they're still quality)
    if (sample.latencyMs && sample.latencyMs < 2000) {
      score += 0.2;
    } else if (sample.latencyMs && sample.latencyMs > 10000) {
      score -= 0.2;
    }
    factors++;

    // Was it a correction? (indicates initial response was bad)
    if (sample.wasCorrection) {
      score -= 1;
    }
    factors++;

    // Clamp to 1-5
    score = Math.max(1, Math.min(5, Math.round(score)));

    // Confidence based on number of factors we could assess
    const confidence = Math.min(0.95, 0.5 + factors * 0.08);

    return { score, confidence };
  }

  /**
   * Classify conversation topics
   */
  private async classifyTopics(sample: ConversationSample): Promise<string[]> {
    const text = `${sample.userMessage} ${sample.assistantResponse}`.toLowerCase();
    const topics: string[] = [];

    const topicKeywords: Record<string, string[]> = {
      coding: ['code', 'program', 'function', 'debug', 'error', 'compile', 'variable', 'class'],
      trading: [
        'trade',
        'stock',
        'crypto',
        'bitcoin',
        'price',
        'market',
        'buy',
        'sell',
        'position',
      ],
      finance: ['money', 'bank', 'account', 'payment', 'budget', 'expense', 'income', 'balance'],
      email: ['email', 'inbox', 'send', 'reply', 'message', 'gmail', 'outlook'],
      calendar: ['calendar', 'meeting', 'schedule', 'appointment', 'event', 'remind'],
      music: ['music', 'song', 'play', 'spotify', 'playlist', 'album', 'artist'],
      files: ['file', 'folder', 'document', 'save', 'open', 'create', 'delete'],
      browser: ['browser', 'website', 'search', 'google', 'url', 'tab', 'page'],
      system: ['system', 'computer', 'restart', 'shutdown', 'settings', 'install'],
      research: ['research', 'learn', 'explain', 'what is', 'how does', 'why'],
      task: ['task', 'todo', 'list', 'complete', 'finish', 'work'],
      reminder: ['remind', 'remember', "don't forget", 'notification'],
      weather: ['weather', 'temperature', 'rain', 'sunny', 'forecast'],
      news: ['news', 'article', 'headlines', 'trending'],
    };

    for (const [topic, keywords] of Object.entries(topicKeywords)) {
      if (keywords.some((kw) => text.includes(kw))) {
        topics.push(topic);
      }
    }

    // Default to 'conversation' if no specific topic found
    if (topics.length === 0) {
      topics.push('conversation');
    }

    return topics;
  }

  /**
   * Analyze sentiment of user message
   */
  private async analyzeSentiment(
    sample: ConversationSample
  ): Promise<{ label: string; confidence: number }> {
    const text = sample.userMessage.toLowerCase();

    // Simple keyword-based sentiment
    const positiveWords = [
      'thanks',
      'great',
      'perfect',
      'awesome',
      'love',
      'excellent',
      'good',
      'nice',
      'helpful',
    ];
    const negativeWords = [
      'bad',
      'wrong',
      'terrible',
      'hate',
      'awful',
      'useless',
      'broken',
      'stupid',
      'annoying',
    ];

    let positiveScore = 0;
    let negativeScore = 0;

    for (const word of positiveWords) {
      if (text.includes(word)) positiveScore++;
    }

    for (const word of negativeWords) {
      if (text.includes(word)) negativeScore++;
    }

    if (positiveScore > negativeScore) {
      return { label: 'positive', confidence: 0.6 + positiveScore * 0.1 };
    } else if (negativeScore > positiveScore) {
      return { label: 'negative', confidence: 0.6 + negativeScore * 0.1 };
    }

    return { label: 'neutral', confidence: 0.7 };
  }

  /**
   * Classify user intent
   */
  async classifyIntent(userMessage: string): Promise<{ intent: IntentLabel; confidence: number }> {
    const text = userMessage.toLowerCase().trim();

    // Question detection
    if (
      text.includes('?') ||
      text.startsWith('what') ||
      text.startsWith('how') ||
      text.startsWith('why') ||
      text.startsWith('when') ||
      text.startsWith('where') ||
      text.startsWith('who') ||
      text.startsWith('can you tell') ||
      text.startsWith('do you know')
    ) {
      return { intent: 'question', confidence: 0.9 };
    }

    // Command detection
    if (
      text.startsWith('please') ||
      text.startsWith('can you') ||
      text.startsWith('could you') ||
      text.startsWith('open') ||
      text.startsWith('close') ||
      text.startsWith('run') ||
      text.startsWith('start') ||
      text.startsWith('stop') ||
      text.startsWith('play') ||
      text.startsWith('send') ||
      text.startsWith('create') ||
      text.startsWith('delete')
    ) {
      return { intent: 'command', confidence: 0.85 };
    }

    // Greeting detection
    if (
      text.startsWith('hi') ||
      text.startsWith('hello') ||
      text.startsWith('hey') ||
      text.includes('good morning') ||
      text.includes('good afternoon') ||
      text.includes('good evening')
    ) {
      return { intent: 'greeting', confidence: 0.95 };
    }

    // Farewell detection
    if (
      text.includes('bye') ||
      text.includes('goodbye') ||
      text.includes('see you') ||
      text.includes('good night') ||
      text.includes('talk later')
    ) {
      return { intent: 'farewell', confidence: 0.9 };
    }

    // Confirmation detection
    if (
      text === 'yes' ||
      text === 'no' ||
      text === 'okay' ||
      text === 'ok' ||
      text === 'sure' ||
      text === 'alright' ||
      text === 'yeah' ||
      text === 'nope'
    ) {
      return { intent: 'confirmation', confidence: 0.95 };
    }

    // Correction detection
    if (
      text.includes('no,') ||
      text.includes('not what i meant') ||
      text.includes('wrong') ||
      text.includes("that's not right") ||
      text.includes('i said')
    ) {
      return { intent: 'correction', confidence: 0.85 };
    }

    // Clarification detection
    if (
      text.includes('i mean') ||
      text.includes('to clarify') ||
      text.includes('specifically') ||
      text.includes('more precisely') ||
      text.includes('in other words')
    ) {
      return { intent: 'clarification', confidence: 0.8 };
    }

    return { intent: 'statement', confidence: 0.6 };
  }

  // ==========================================================================
  // Labeling Tasks
  // ==========================================================================

  /**
   * Create a labeling task for manual review
   */
  async createTask(
    sampleId: string,
    sampleType: DatasetType,
    labelType: LabelType,
    suggestedLabel?: string | number,
    confidence?: number
  ): Promise<LabelingTask> {
    const task: LabelingTask = {
      id: uuidv4(),
      sampleId,
      sampleType,
      labelType,
      suggestedLabel,
      confidence,
      status: 'pending',
    };

    this.pendingTasks.set(task.id, task);
    await this.savePendingTasks();

    this.emit('task-created', task);
    logger.debug('Created labeling task', { taskId: task.id, sampleId, labelType });

    return task;
  }

  /**
   * Get pending labeling tasks
   */
  getPendingTasks(limit?: number): LabelingTask[] {
    const tasks = Array.from(this.pendingTasks.values())
      .filter((t) => t.status === 'pending')
      .sort((a, b) => (b.confidence || 0) - (a.confidence || 0));

    return limit ? tasks.slice(0, limit) : tasks;
  }

  /**
   * Get tasks needing review
   */
  getTasksNeedingReview(limit?: number): LabelingTask[] {
    const tasks = Array.from(this.pendingTasks.values()).filter((t) => t.status === 'needs_review');

    return limit ? tasks.slice(0, limit) : tasks;
  }

  /**
   * Apply a label to a task
   */
  async applyLabel(
    taskId: string,
    label: string | number,
    labeledBy: 'auto' | 'user' | 'model' = 'user'
  ): Promise<void> {
    const task = this.pendingTasks.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    task.appliedLabel = label;
    task.labeledBy = labeledBy;
    task.labeledAt = Date.now();
    task.status = 'labeled';

    // Move to completed
    this.pendingTasks.delete(taskId);
    await this.saveCompletedTask(task);
    await this.savePendingTasks();

    this.emit('label-applied', task);
    logger.info('Applied label', { taskId, label, labeledBy });
  }

  /**
   * Skip a labeling task
   */
  async skipTask(taskId: string): Promise<void> {
    const task = this.pendingTasks.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    task.status = 'skipped';
    this.pendingTasks.delete(taskId);
    await this.saveCompletedTask(task);
    await this.savePendingTasks();

    this.emit('task-skipped', task);
  }

  /**
   * Mark task as needing review
   */
  async markForReview(taskId: string): Promise<void> {
    const task = this.pendingTasks.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    task.status = 'needs_review';
    await this.savePendingTasks();

    this.emit('task-updated', task);
  }

  /**
   * Save completed task to history
   */
  private async saveCompletedTask(task: LabelingTask): Promise<void> {
    const date = isoDate();
    const historyFile = path.join(this.tasksPath, `history_${date}.jsonl`);

    await fs.appendFile(historyFile, JSON.stringify(task) + '\n');
  }

  // ==========================================================================
  // Batch Labeling
  // ==========================================================================

  /**
   * Auto-label a batch of samples
   */
  async labelBatch(
    samples: ConversationSample[]
  ): Promise<Map<string, Partial<ConversationSample>>> {
    const results = new Map<string, Partial<ConversationSample>>();

    for (const sample of samples) {
      const labels = await this.autoLabelConversation(sample);
      results.set(sample.id, labels);
    }

    this.emit('batch-labeled', { count: samples.length });
    return results;
  }

  /**
   * Get labeling statistics
   */
  async getStats(): Promise<{
    pending: number;
    needsReview: number;
    labeled: number;
    skipped: number;
  }> {
    const pending = Array.from(this.pendingTasks.values()).filter(
      (t) => t.status === 'pending'
    ).length;
    const needsReview = Array.from(this.pendingTasks.values()).filter(
      (t) => t.status === 'needs_review'
    ).length;

    // Count from history files
    let labeled = 0;
    let skipped = 0;

    const files = await fs.readdir(this.tasksPath);
    for (const file of files) {
      if (!file.startsWith('history_')) continue;

      const content = await fs.readFile(path.join(this.tasksPath, file), 'utf-8');
      const lines = content.split('\n').filter((l) => l.trim());

      for (const line of lines) {
        try {
          const task: LabelingTask = JSON.parse(line);
          if (task.status === 'labeled') labeled++;
          if (task.status === 'skipped') skipped++;
        } catch {
          // Skip malformed lines
        }
      }
    }

    return { pending, needsReview, labeled, skipped };
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    await this.savePendingTasks();
    this.pendingTasks.clear();
    this.initialized = false;
    logger.info('DataLabeler cleaned up');
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let instance: DataLabeler | null = null;

/**
 * Get the DataLabeler singleton
 */
export function getDataLabeler(): DataLabeler {
  if (!instance) {
    instance = new DataLabeler();
  }
  return instance;
}

/**
 * Initialize the DataLabeler
 */
export async function initializeDataLabeler(config?: Partial<LabelerConfig>): Promise<DataLabeler> {
  if (!instance) {
    instance = new DataLabeler(config);
  }
  await instance.initialize();
  return instance;
}

/**
 * Cleanup the DataLabeler
 */
export async function cleanupDataLabeler(): Promise<void> {
  if (instance) {
    await instance.cleanup();
    instance = null;
  }
}
