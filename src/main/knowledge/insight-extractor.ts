/**
 * Insight Extractor
 * Extracts insights and patterns from conversations and activities
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { createModuleLogger } from '../utils/logger';
import { Insight, InsightType, InsightSource } from './types';

const logger = createModuleLogger('InsightExtractor');

interface InsightExtractorConfig {
  persistPath: string;
  minConfidence: number;
  maxInsights: number;
  extractionInterval: number; // hours
}

const DEFAULT_CONFIG: InsightExtractorConfig = {
  persistPath: '',
  minConfidence: 0.6,
  maxInsights: 100,
  extractionInterval: 6
};

interface ConversationContext {
  id: string;
  timestamp: Date;
  messages: Array<{ role: string; content: string }>;
  topics: string[];
  sentiment: number;
}

class InsightExtractor extends EventEmitter {
  private config: InsightExtractorConfig;
  private insights: Map<string, Insight> = new Map();
  private patterns: Map<string, PatternTracker> = new Map();
  private initialized: boolean = false;

  constructor(config?: Partial<InsightExtractorConfig>) {
    super();
    
    const userDataPath = app?.getPath?.('userData') || './data';
    this.config = {
      ...DEFAULT_CONFIG,
      persistPath: path.join(userDataPath, 'insights.json'),
      ...config
    };
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    logger.info('Initializing insight extractor');
    
    await this.loadInsights();
    
    this.initialized = true;
    this.emit('initialized');
  }

  /**
   * Load persisted insights
   */
  private async loadInsights(): Promise<void> {
    try {
      if (fs.existsSync(this.config.persistPath)) {
        const data = JSON.parse(fs.readFileSync(this.config.persistPath, 'utf-8'));
        
        for (const insight of data.insights || []) {
          this.insights.set(insight.id, {
            ...insight,
            createdAt: new Date(insight.createdAt),
            reviewedAt: insight.reviewedAt ? new Date(insight.reviewedAt) : undefined
          });
        }
        
        logger.info('Loaded insights', { count: this.insights.size });
      }
    } catch (error) {
      logger.warn('Failed to load insights', error);
    }
  }

  /**
   * Save insights to disk
   */
  private async saveInsights(): Promise<void> {
    try {
      const dir = path.dirname(this.config.persistPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      const data = {
        insights: Array.from(this.insights.values())
      };
      
      fs.writeFileSync(this.config.persistPath, JSON.stringify(data, null, 2));
    } catch (error) {
      logger.error('Failed to save insights', error);
    }
  }

  /**
   * Process a conversation to extract insights
   */
  processConversation(context: ConversationContext): Insight[] {
    const extracted: Insight[] = [];
    
    // Extract patterns
    const patterns = this.detectPatterns(context);
    for (const pattern of patterns) {
      if (pattern.confidence >= this.config.minConfidence) {
        extracted.push(pattern);
      }
    }
    
    // Extract learnings
    const learnings = this.detectLearnings(context);
    for (const learning of learnings) {
      if (learning.confidence >= this.config.minConfidence) {
        extracted.push(learning);
      }
    }
    
    // Extract recommendations
    const recommendations = this.detectRecommendations(context);
    for (const rec of recommendations) {
      if (rec.confidence >= this.config.minConfidence) {
        extracted.push(rec);
      }
    }
    
    // Store new insights
    for (const insight of extracted) {
      this.insights.set(insight.id, insight);
    }
    
    // Enforce max limit
    this.enforceLimit();
    
    // Save
    this.saveInsights();
    
    this.emit('insights-extracted', extracted);
    return extracted;
  }

  /**
   * Detect patterns in conversation
   */
  private detectPatterns(context: ConversationContext): Insight[] {
    const patterns: Insight[] = [];
    
    // Track topic frequency
    for (const topic of context.topics) {
      const key = `topic:${topic}`;
      let tracker = this.patterns.get(key);
      
      if (!tracker) {
        tracker = { count: 0, firstSeen: context.timestamp, lastSeen: context.timestamp };
        this.patterns.set(key, tracker);
      }
      
      tracker.count++;
      tracker.lastSeen = context.timestamp;
      
      // Generate insight if pattern is significant
      if (tracker.count >= 5) {
        const daysSinceFirst = (context.timestamp.getTime() - tracker.firstSeen.getTime()) / (1000 * 60 * 60 * 24);
        
        if (daysSinceFirst <= 7) { // Frequent in last week
          patterns.push({
            id: `insight-pattern-${key}-${Date.now()}`,
            type: 'pattern',
            title: `Frequent topic: ${topic}`,
            content: `You've been discussing "${topic}" ${tracker.count} times recently. This seems to be a current focus area.`,
            confidence: Math.min(0.9, 0.5 + tracker.count * 0.05),
            source: {
              type: 'conversation',
              ids: [context.id],
              timeRange: { start: tracker.firstSeen, end: tracker.lastSeen }
            },
            tags: [topic, 'pattern', 'frequent'],
            actionable: false,
            createdAt: new Date(),
            dismissed: false
          });
        }
      }
    }
    
    // Detect time-based patterns
    const hour = context.timestamp.getHours();
    const timeKey = `time:${Math.floor(hour / 4)}`; // 6 time buckets
    
    let timeTracker = this.patterns.get(timeKey);
    if (!timeTracker) {
      timeTracker = { count: 0, firstSeen: context.timestamp, lastSeen: context.timestamp };
      this.patterns.set(timeKey, timeTracker);
    }
    timeTracker.count++;
    timeTracker.lastSeen = context.timestamp;
    
    return patterns;
  }

  /**
   * Detect learnings from conversation
   */
  private detectLearnings(context: ConversationContext): Insight[] {
    const learnings: Insight[] = [];
    
    const learningIndicators = [
      /i learned|i understand now|that makes sense|now i know|til:|today i learned/i,
      /so basically|in other words|to summarize/i,
      /i didn't know|new to me|interesting that/i
    ];
    
    for (const msg of context.messages) {
      if (msg.role !== 'user') continue;
      
      for (const pattern of learningIndicators) {
        if (pattern.test(msg.content)) {
          // Extract the learning
          const sentences = msg.content.split(/[.!?]+/).filter(s => s.trim().length > 10);
          
          for (const sentence of sentences) {
            if (sentence.length > 200) continue;
            
            learnings.push({
              id: `insight-learning-${Date.now()}-${Math.random().toString(36).slice(2)}`,
              type: 'learning',
              title: 'New Learning',
              content: sentence.trim(),
              confidence: 0.7,
              source: {
                type: 'conversation',
                ids: [context.id]
              },
              tags: [...context.topics, 'learning'],
              actionable: false,
              createdAt: new Date(),
              dismissed: false
            });
            
            break; // One learning per indicator
          }
          break;
        }
      }
    }
    
    return learnings.slice(0, 3); // Max 3 learnings per conversation
  }

  /**
   * Detect recommendation opportunities
   */
  private detectRecommendations(context: ConversationContext): Insight[] {
    const recommendations: Insight[] = [];
    
    // Check for repeated issues/errors
    const errorPatterns = /error|issue|problem|bug|doesn't work|not working|failed/gi;
    let errorCount = 0;
    
    for (const msg of context.messages) {
      if (msg.role === 'user') {
        const matches = msg.content.match(errorPatterns);
        if (matches) errorCount += matches.length;
      }
    }
    
    if (errorCount >= 3) {
      recommendations.push({
        id: `insight-rec-errors-${Date.now()}`,
        type: 'recommendation',
        title: 'Troubleshooting Session Detected',
        content: `This conversation involved multiple issues. Consider documenting the solutions for future reference.`,
        confidence: 0.75,
        source: {
          type: 'conversation',
          ids: [context.id]
        },
        tags: ['troubleshooting', 'recommendation'],
        actionable: true,
        suggestedActions: [
          'Create a troubleshooting note',
          'Add common fixes to knowledge base'
        ],
        createdAt: new Date(),
        dismissed: false
      });
    }
    
    // Check for teaching moments (assistant explaining concepts)
    let explanationCount = 0;
    const explanationPatterns = /here's how|the reason is|this works because|essentially|fundamentally/gi;
    
    for (const msg of context.messages) {
      if (msg.role === 'assistant') {
        const matches = msg.content.match(explanationPatterns);
        if (matches) explanationCount += matches.length;
      }
    }
    
    if (explanationCount >= 2) {
      recommendations.push({
        id: `insight-rec-learn-${Date.now()}`,
        type: 'recommendation',
        title: 'Learning Opportunity',
        content: `This conversation contained detailed explanations that might be worth reviewing or saving.`,
        confidence: 0.7,
        source: {
          type: 'conversation',
          ids: [context.id]
        },
        tags: context.topics.concat(['learning', 'recommendation']),
        actionable: true,
        suggestedActions: [
          'Save key explanations to notes',
          'Schedule review of concepts'
        ],
        createdAt: new Date(),
        dismissed: false
      });
    }
    
    return recommendations;
  }

  /**
   * Enforce maximum insights limit
   */
  private enforceLimit(): void {
    if (this.insights.size <= this.config.maxInsights) return;
    
    // Remove oldest dismissed insights first
    const sorted = Array.from(this.insights.values())
      .sort((a, b) => {
        // Dismissed first
        if (a.dismissed !== b.dismissed) return a.dismissed ? -1 : 1;
        // Then by age
        return a.createdAt.getTime() - b.createdAt.getTime();
      });
    
    const toRemove = sorted.slice(0, this.insights.size - this.config.maxInsights);
    
    for (const insight of toRemove) {
      this.insights.delete(insight.id);
    }
  }

  /**
   * Get all insights
   */
  getAllInsights(includeDissmissed: boolean = false): Insight[] {
    return Array.from(this.insights.values())
      .filter(i => includeDissmissed || !i.dismissed)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /**
   * Get insights by type
   */
  getInsightsByType(type: InsightType): Insight[] {
    return this.getAllInsights().filter(i => i.type === type);
  }

  /**
   * Get actionable insights
   */
  getActionableInsights(): Insight[] {
    return this.getAllInsights().filter(i => i.actionable && !i.dismissed);
  }

  /**
   * Mark insight as reviewed
   */
  reviewInsight(id: string): boolean {
    const insight = this.insights.get(id);
    if (!insight) return false;
    
    insight.reviewedAt = new Date();
    this.saveInsights();
    
    this.emit('insight-reviewed', insight);
    return true;
  }

  /**
   * Dismiss an insight
   */
  dismissInsight(id: string): boolean {
    const insight = this.insights.get(id);
    if (!insight) return false;
    
    insight.dismissed = true;
    this.saveInsights();
    
    this.emit('insight-dismissed', insight);
    return true;
  }

  /**
   * Create manual insight
   */
  createInsight(
    type: InsightType,
    title: string,
    content: string,
    options: {
      tags?: string[];
      actionable?: boolean;
      suggestedActions?: string[];
    } = {}
  ): Insight {
    const insight: Insight = {
      id: `insight-manual-${Date.now()}`,
      type,
      title,
      content,
      confidence: 1.0,
      source: {
        type: 'conversation',
        ids: []
      },
      tags: options.tags || [],
      actionable: options.actionable || false,
      suggestedActions: options.suggestedActions,
      createdAt: new Date(),
      dismissed: false
    };
    
    this.insights.set(insight.id, insight);
    this.saveInsights();
    
    this.emit('insight-created', insight);
    return insight;
  }

  /**
   * Search insights
   */
  searchInsights(query: string): Insight[] {
    const lower = query.toLowerCase();
    return this.getAllInsights().filter(i =>
      i.title.toLowerCase().includes(lower) ||
      i.content.toLowerCase().includes(lower) ||
      i.tags.some(t => t.toLowerCase().includes(lower))
    );
  }

  getStatus(): {
    initialized: boolean;
    insightCount: number;
    actionableCount: number;
    patternCount: number;
  } {
    return {
      initialized: this.initialized,
      insightCount: this.insights.size,
      actionableCount: this.getActionableInsights().length,
      patternCount: this.patterns.size
    };
  }
}

interface PatternTracker {
  count: number;
  firstSeen: Date;
  lastSeen: Date;
}

// Singleton instance
let insightExtractor: InsightExtractor | null = null;

export function getInsightExtractor(): InsightExtractor {
  if (!insightExtractor) {
    insightExtractor = new InsightExtractor();
  }
  return insightExtractor;
}

export { InsightExtractor };
