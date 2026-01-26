/**
 * Spaced Review
 * Implements spaced repetition for knowledge retention
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { createModuleLogger } from '../utils/logger';
import {
  KnowledgeItem,
  KnowledgeType,
  ReviewSession,
  ReviewItem,
  SpacedRepetitionConfig,
  DEFAULT_SPACED_CONFIG
} from './types';

const logger = createModuleLogger('SpacedReview');

interface SpacedReviewPersistence {
  items: KnowledgeItem[];
  sessions: ReviewSession[];
  config: SpacedRepetitionConfig;
}

class SpacedReview extends EventEmitter {
  private config: SpacedRepetitionConfig;
  private items: Map<string, KnowledgeItem> = new Map();
  private sessions: ReviewSession[] = [];
  private currentSession: ReviewSession | null = null;
  private persistPath: string;
  private initialized: boolean = false;

  constructor(config?: Partial<SpacedRepetitionConfig>) {
    super();
    
    const userDataPath = app?.getPath?.('userData') || './data';
    this.persistPath = path.join(userDataPath, 'spaced-review.json');
    this.config = { ...DEFAULT_SPACED_CONFIG, ...config };
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    logger.info('Initializing spaced review system');
    
    await this.loadData();
    
    this.initialized = true;
    this.emit('initialized');
  }

  /**
   * Load persisted data
   */
  private async loadData(): Promise<void> {
    try {
      if (fs.existsSync(this.persistPath)) {
        const data: SpacedReviewPersistence = JSON.parse(
          fs.readFileSync(this.persistPath, 'utf-8')
        );
        
        for (const item of data.items || []) {
          this.items.set(item.id, {
            ...item,
            nextReview: item.nextReview ? new Date(item.nextReview) : undefined,
            lastReviewed: item.lastReviewed ? new Date(item.lastReviewed) : undefined,
            createdAt: new Date(item.createdAt),
            updatedAt: new Date(item.updatedAt)
          });
        }
        
        this.sessions = (data.sessions || []).map(s => ({
          ...s,
          startTime: new Date(s.startTime),
          endTime: s.endTime ? new Date(s.endTime) : undefined
        }));
        
        if (data.config) {
          this.config = { ...this.config, ...data.config };
        }
        
        logger.info('Loaded spaced review data', { 
          items: this.items.size,
          sessions: this.sessions.length 
        });
      }
    } catch (error) {
      logger.warn('Failed to load spaced review data', error);
    }
  }

  /**
   * Save data to disk
   */
  private async saveData(): Promise<void> {
    try {
      const dir = path.dirname(this.persistPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      const data: SpacedReviewPersistence = {
        items: Array.from(this.items.values()),
        sessions: this.sessions.slice(-50), // Keep last 50 sessions
        config: this.config
      };
      
      fs.writeFileSync(this.persistPath, JSON.stringify(data, null, 2));
    } catch (error) {
      logger.error('Failed to save spaced review data', error);
    }
  }

  /**
   * Add a knowledge item for review
   */
  addItem(
    type: KnowledgeType,
    title: string,
    content: string,
    options: {
      summary?: string;
      source?: string;
      tags?: string[];
      relatedItems?: string[];
      initialDifficulty?: number;
    } = {}
  ): KnowledgeItem {
    const id = `knowledge-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const now = new Date();
    
    // Initial review scheduled based on config
    const nextReview = new Date(now.getTime() + this.config.minInterval * 60 * 60 * 1000);
    
    const item: KnowledgeItem = {
      id,
      type,
      title,
      content,
      summary: options.summary,
      confidence: 0.5,
      source: options.source || 'manual',
      tags: options.tags || [],
      relatedItems: options.relatedItems || [],
      nextReview,
      reviewCount: 0,
      difficulty: options.initialDifficulty || 0.3,
      createdAt: now,
      updatedAt: now
    };
    
    this.items.set(id, item);
    this.saveData();
    
    logger.info('Knowledge item added', { id, type, title });
    this.emit('item-added', item);
    
    return item;
  }

  /**
   * Get items due for review
   */
  getDueItems(limit?: number): KnowledgeItem[] {
    const now = new Date();
    
    const due = Array.from(this.items.values())
      .filter(item => item.nextReview && item.nextReview <= now)
      .sort((a, b) => {
        // Prioritize by difficulty and overdue time
        const aOverdue = now.getTime() - (a.nextReview?.getTime() || 0);
        const bOverdue = now.getTime() - (b.nextReview?.getTime() || 0);
        return (bOverdue * b.difficulty) - (aOverdue * a.difficulty);
      });
    
    return limit ? due.slice(0, limit) : due;
  }

  /**
   * Start a review session
   */
  startSession(itemCount?: number): ReviewSession {
    const dueItems = this.getDueItems(itemCount || this.config.dailyLimit);
    
    const session: ReviewSession = {
      id: `session-${Date.now()}`,
      items: dueItems.map(item => ({
        itemId: item.id,
        presented: false,
        recalled: false
      })),
      startTime: new Date(),
      completed: false
    };
    
    this.currentSession = session;
    
    logger.info('Review session started', { 
      itemCount: session.items.length 
    });
    this.emit('session-started', session);
    
    return session;
  }

  /**
   * Get current session
   */
  getCurrentSession(): ReviewSession | null {
    return this.currentSession;
  }

  /**
   * Get next item to review in current session
   */
  getNextReviewItem(): KnowledgeItem | null {
    if (!this.currentSession) return null;
    
    const nextReview = this.currentSession.items.find(r => !r.presented);
    if (!nextReview) return null;
    
    return this.items.get(nextReview.itemId) || null;
  }

  /**
   * Record review result for current item
   */
  recordReview(
    itemId: string,
    recalled: boolean,
    difficulty: 'easy' | 'medium' | 'hard',
    responseTime?: number
  ): void {
    const item = this.items.get(itemId);
    if (!item) {
      logger.warn('Item not found for review', { itemId });
      return;
    }
    
    // Update session
    if (this.currentSession) {
      const reviewItem = this.currentSession.items.find(r => r.itemId === itemId);
      if (reviewItem) {
        reviewItem.presented = true;
        reviewItem.recalled = recalled;
        reviewItem.responseTime = responseTime;
        reviewItem.difficulty = difficulty;
      }
    }
    
    // Calculate new interval using SM-2 algorithm variant
    const newInterval = this.calculateNextInterval(item, recalled, difficulty);
    
    // Update item
    item.reviewCount++;
    item.lastReviewed = new Date();
    item.nextReview = new Date(Date.now() + newInterval);
    item.updatedAt = new Date();
    
    // Adjust difficulty
    if (difficulty === 'easy') {
      item.difficulty = Math.max(0, item.difficulty - 0.1);
    } else if (difficulty === 'hard') {
      item.difficulty = Math.min(1, item.difficulty + 0.1);
    }
    
    // Adjust confidence
    if (recalled) {
      item.confidence = Math.min(1, item.confidence + 0.1);
    } else {
      item.confidence = Math.max(0, item.confidence - 0.2);
    }
    
    this.saveData();
    
    logger.debug('Review recorded', { 
      itemId, 
      recalled, 
      difficulty,
      nextReview: item.nextReview 
    });
    this.emit('review-recorded', item, recalled);
  }

  /**
   * Calculate next review interval using SM-2 variant
   */
  private calculateNextInterval(
    item: KnowledgeItem,
    recalled: boolean,
    difficulty: 'easy' | 'medium' | 'hard'
  ): number {
    let interval: number;
    
    if (!recalled) {
      // Failed - reset to minimum interval
      interval = this.config.minInterval * 60 * 60 * 1000; // ms
    } else {
      // Get base interval from progression
      const intervalIndex = Math.min(
        item.reviewCount,
        this.config.intervals.length - 1
      );
      const baseDays = this.config.intervals[intervalIndex];
      
      // Adjust by difficulty
      let multiplier = this.config.easeFactor;
      if (difficulty === 'easy') multiplier *= 1.3;
      if (difficulty === 'hard') multiplier *= 0.8;
      
      // Adjust by item difficulty
      multiplier *= (1 - item.difficulty * 0.3);
      
      interval = baseDays * 24 * 60 * 60 * 1000 * multiplier;
      
      // Cap at max interval
      const maxMs = this.config.maxInterval * 24 * 60 * 60 * 1000;
      interval = Math.min(interval, maxMs);
    }
    
    return interval;
  }

  /**
   * Complete current session
   */
  completeSession(): ReviewSession | null {
    if (!this.currentSession) return null;
    
    this.currentSession.endTime = new Date();
    this.currentSession.completed = true;
    
    // Calculate session score
    const presented = this.currentSession.items.filter(i => i.presented);
    const recalled = presented.filter(i => i.recalled);
    this.currentSession.score = presented.length > 0
      ? Math.round((recalled.length / presented.length) * 100)
      : 0;
    
    this.sessions.push(this.currentSession);
    
    const completed = this.currentSession;
    this.currentSession = null;
    
    this.saveData();
    
    logger.info('Review session completed', { 
      score: completed.score,
      presented: presented.length,
      recalled: recalled.length 
    });
    this.emit('session-completed', completed);
    
    return completed;
  }

  /**
   * Get all knowledge items
   */
  getAllItems(): KnowledgeItem[] {
    return Array.from(this.items.values())
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }

  /**
   * Get items by type
   */
  getItemsByType(type: KnowledgeType): KnowledgeItem[] {
    return this.getAllItems().filter(i => i.type === type);
  }

  /**
   * Get items by tag
   */
  getItemsByTag(tag: string): KnowledgeItem[] {
    const lower = tag.toLowerCase();
    return this.getAllItems().filter(i => 
      i.tags.some(t => t.toLowerCase() === lower)
    );
  }

  /**
   * Search items
   */
  searchItems(query: string): KnowledgeItem[] {
    const lower = query.toLowerCase();
    return this.getAllItems().filter(i =>
      i.title.toLowerCase().includes(lower) ||
      i.content.toLowerCase().includes(lower) ||
      i.summary?.toLowerCase().includes(lower) ||
      i.tags.some(t => t.toLowerCase().includes(lower))
    );
  }

  /**
   * Update an item
   */
  updateItem(
    id: string,
    updates: Partial<Pick<KnowledgeItem, 'title' | 'content' | 'summary' | 'tags' | 'relatedItems'>>
  ): KnowledgeItem | null {
    const item = this.items.get(id);
    if (!item) return null;
    
    Object.assign(item, updates, { updatedAt: new Date() });
    this.saveData();
    
    this.emit('item-updated', item);
    return item;
  }

  /**
   * Delete an item
   */
  deleteItem(id: string): boolean {
    const item = this.items.get(id);
    if (!item) return false;
    
    this.items.delete(id);
    this.saveData();
    
    this.emit('item-deleted', item);
    return true;
  }

  /**
   * Get review statistics
   */
  getStatistics(): {
    totalItems: number;
    dueToday: number;
    reviewedToday: number;
    averageRetention: number;
    streakDays: number;
  } {
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    
    const items = Array.from(this.items.values());
    
    const dueToday = items.filter(i => 
      i.nextReview && i.nextReview <= now
    ).length;
    
    const reviewedToday = items.filter(i => 
      i.lastReviewed && i.lastReviewed >= todayStart
    ).length;
    
    // Calculate average retention from recent sessions
    const recentSessions = this.sessions.slice(-10);
    const avgRetention = recentSessions.length > 0
      ? recentSessions.reduce((sum, s) => sum + (s.score || 0), 0) / recentSessions.length
      : 0;
    
    // Calculate streak
    let streakDays = 0;
    const checkDate = new Date(todayStart);
    
    while (streakDays < 365) {
      const dayStart = new Date(checkDate);
      const dayEnd = new Date(checkDate);
      dayEnd.setDate(dayEnd.getDate() + 1);
      
      const hasReview = this.sessions.some(s => 
        s.startTime >= dayStart && s.startTime < dayEnd && s.completed
      );
      
      if (!hasReview && streakDays > 0) break;
      if (hasReview) streakDays++;
      
      checkDate.setDate(checkDate.getDate() - 1);
    }
    
    return {
      totalItems: items.length,
      dueToday,
      reviewedToday,
      averageRetention: Math.round(avgRetention),
      streakDays
    };
  }

  /**
   * Get recent sessions
   */
  getRecentSessions(limit: number = 10): ReviewSession[] {
    return this.sessions.slice(-limit).reverse();
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<SpacedRepetitionConfig>): void {
    Object.assign(this.config, updates);
    this.saveData();
    
    this.emit('config-updated', this.config);
  }

  getStatus(): {
    initialized: boolean;
    itemCount: number;
    dueCount: number;
    sessionActive: boolean;
    config: SpacedRepetitionConfig;
  } {
    return {
      initialized: this.initialized,
      itemCount: this.items.size,
      dueCount: this.getDueItems().length,
      sessionActive: this.currentSession !== null,
      config: this.config
    };
  }
}

// Singleton instance
let spacedReview: SpacedReview | null = null;

export function getSpacedReview(): SpacedReview {
  if (!spacedReview) {
    spacedReview = new SpacedReview();
  }
  return spacedReview;
}

export { SpacedReview };
