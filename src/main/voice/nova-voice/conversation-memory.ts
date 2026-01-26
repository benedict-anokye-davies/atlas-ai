/**
 * NovaVoice - Conversation Memory
 * Track conversation context, topics, and user preferences over time
 */

import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createModuleLogger } from '../../utils/logger';
import { StreamingTranscription } from './types';

// Type alias for backwards compatibility
type TranscriptionResult = StreamingTranscription;

const logger = createModuleLogger('NovaVoice-Memory');

// ============================================
// Types
// ============================================

export interface ConversationMemory {
  id: string;
  startTime: number;
  endTime?: number;
  turns: Turn[];
  topics: Topic[];
  entities: EntityMention[];
  sentiment: SentimentTrend;
  summary?: string;
}

export interface Turn {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  timestamp: number;
  duration?: number;
  intent?: string;
  entities: ExtractedEntity[];
  sentiment: number; // -1 to 1
}

export interface Topic {
  name: string;
  mentions: number;
  firstMentioned: number;
  lastMentioned: number;
  confidence: number;
}

export interface ExtractedEntity {
  type: string;
  value: string;
  normalized?: string;
  confidence: number;
}

export interface EntityMention {
  entity: ExtractedEntity;
  turnIds: string[];
  frequency: number;
}

export interface SentimentTrend {
  overall: number;
  trend: 'improving' | 'declining' | 'stable';
  history: Array<{ timestamp: number; value: number }>;
}

export interface UserContext {
  id: string;
  name?: string;
  preferences: Record<string, unknown>;
  recentTopics: string[];
  entities: Map<string, string>; // type -> last value
  interactionCount: number;
  firstInteraction: number;
  lastInteraction: number;
}

export interface MemoryConfig {
  maxTurnsInMemory: number;
  maxConversationsStored: number;
  entityExtractionEnabled: boolean;
  topicTrackingEnabled: boolean;
  sentimentTrackingEnabled: boolean;
  storageDir: string;
  autoSave: boolean;
  saveInterval: number; // ms
}

// ============================================
// Topic Extractor
// ============================================

const TOPIC_PATTERNS: Record<string, RegExp[]> = {
  weather: [/weather/i, /temperature/i, /forecast/i, /rain/i, /sunny/i, /cloudy/i],
  calendar: [/calendar/i, /schedule/i, /meeting/i, /appointment/i, /event/i, /remind/i],
  email: [/email/i, /mail/i, /inbox/i, /send.*message/i],
  music: [/music/i, /song/i, /play/i, /album/i, /artist/i, /playlist/i],
  news: [/news/i, /headlines/i, /current events/i],
  timer: [/timer/i, /alarm/i, /countdown/i, /remind.*in/i],
  search: [/search/i, /look.*up/i, /find/i, /google/i],
  smart_home: [/lights?/i, /thermostat/i, /temperature/i, /lock/i, /door/i],
  navigation: [/directions/i, /navigate/i, /how.*get.*to/i, /route/i],
  shopping: [/buy/i, /order/i, /purchase/i, /shopping/i, /cart/i],
  general_knowledge: [/what.*is/i, /who.*is/i, /tell.*about/i, /explain/i],
  coding: [/code/i, /programming/i, /debug/i, /function/i, /error/i, /compile/i],
  files: [/file/i, /folder/i, /document/i, /save/i, /open/i],
};

export class TopicExtractor {
  /**
   * Extract topics from text
   */
  extract(text: string): Array<{ name: string; confidence: number }> {
    const topics: Array<{ name: string; confidence: number }> = [];
    const normalizedText = text.toLowerCase();
    
    for (const [topic, patterns] of Object.entries(TOPIC_PATTERNS)) {
      let matchCount = 0;
      
      for (const pattern of patterns) {
        if (pattern.test(normalizedText)) {
          matchCount++;
        }
      }
      
      if (matchCount > 0) {
        const confidence = Math.min(1, matchCount / patterns.length + 0.3);
        topics.push({ name: topic, confidence });
      }
    }
    
    return topics.sort((a, b) => b.confidence - a.confidence);
  }
}

// ============================================
// Entity Extractor
// ============================================

export class EntityExtractor {
  private patterns: Record<string, RegExp> = {
    date: /\b(\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}(?:,?\s*\d{4})?|today|tomorrow|yesterday|next\s+(?:week|month|year))\b/gi,
    time: /\b(\d{1,2}:\d{2}(?:\s*(?:am|pm))?|noon|midnight|\d{1,2}\s*(?:am|pm))\b/gi,
    person: /\b(?:(?:mr|mrs|ms|dr|prof)\.?\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g,
    email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    phone: /\b(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    url: /https?:\/\/[^\s]+/gi,
    number: /\b\d+(?:\.\d+)?(?:\s*(?:dollars?|%|percent|minutes?|hours?|days?|weeks?|months?|years?))?\b/gi,
    location: /\b(?:in|at|to|from)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/g,
  };
  
  /**
   * Extract entities from text
   */
  extract(text: string): ExtractedEntity[] {
    const entities: ExtractedEntity[] = [];
    
    for (const [type, pattern] of Object.entries(this.patterns)) {
      const globalPattern = new RegExp(pattern.source, 'gi');
      let match;
      
      while ((match = globalPattern.exec(text)) !== null) {
        entities.push({
          type,
          value: match[0],
          normalized: this.normalize(type, match[0]),
          confidence: 0.85,
        });
      }
    }
    
    return entities;
  }
  
  private normalize(type: string, value: string): string {
    switch (type) {
      case 'date':
        // Would use date parsing library
        return value.toLowerCase();
      case 'time':
        return value.toLowerCase().replace(/\s/g, '');
      case 'email':
        return value.toLowerCase();
      case 'phone':
        return value.replace(/[^\d+]/g, '');
      default:
        return value;
    }
  }
}

// ============================================
// Sentiment Analyzer
// ============================================

export class SentimentAnalyzer {
  private positiveWords = new Set([
    'good', 'great', 'excellent', 'amazing', 'wonderful', 'fantastic',
    'love', 'like', 'happy', 'thanks', 'thank', 'please', 'awesome',
    'perfect', 'best', 'nice', 'beautiful', 'helpful', 'appreciate',
  ]);
  
  private negativeWords = new Set([
    'bad', 'terrible', 'awful', 'horrible', 'hate', 'dislike',
    'angry', 'frustrated', 'annoying', 'stupid', 'wrong', 'broken',
    'worst', 'useless', 'fail', 'error', 'problem', 'issue',
  ]);
  
  /**
   * Analyze sentiment of text
   */
  analyze(text: string): number {
    const words = text.toLowerCase().split(/\s+/);
    let score = 0;
    let wordCount = 0;
    
    for (const word of words) {
      if (this.positiveWords.has(word)) {
        score += 1;
        wordCount++;
      } else if (this.negativeWords.has(word)) {
        score -= 1;
        wordCount++;
      }
    }
    
    return wordCount > 0 ? score / wordCount : 0;
  }
}

// ============================================
// Conversation Memory Manager
// ============================================

const DEFAULT_CONFIG: MemoryConfig = {
  maxTurnsInMemory: 100,
  maxConversationsStored: 50,
  entityExtractionEnabled: true,
  topicTrackingEnabled: true,
  sentimentTrackingEnabled: true,
  storageDir: 'conversations',
  autoSave: true,
  saveInterval: 60000, // 1 minute
};

export class ConversationMemoryManager extends EventEmitter {
  private config: MemoryConfig;
  private currentConversation: ConversationMemory | null = null;
  private userContext: UserContext;
  private topicExtractor: TopicExtractor;
  private entityExtractor: EntityExtractor;
  private sentimentAnalyzer: SentimentAnalyzer;
  private turnCounter = 0;
  private saveTimer: NodeJS.Timeout | null = null;
  
  constructor(config?: Partial<MemoryConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    this.topicExtractor = new TopicExtractor();
    this.entityExtractor = new EntityExtractor();
    this.sentimentAnalyzer = new SentimentAnalyzer();
    
    this.userContext = {
      id: 'default_user',
      preferences: {},
      recentTopics: [],
      entities: new Map(),
      interactionCount: 0,
      firstInteraction: Date.now(),
      lastInteraction: Date.now(),
    };
  }
  
  /**
   * Initialize memory manager
   */
  async initialize(): Promise<void> {
    try {
      await fs.mkdir(this.config.storageDir, { recursive: true });
      await this.loadUserContext();
      
      if (this.config.autoSave) {
        this.startAutoSave();
      }
      
      logger.info('Conversation memory initialized');
    } catch (error) {
      logger.error('Failed to initialize memory', { error });
    }
  }
  
  /**
   * Start a new conversation
   */
  startConversation(): ConversationMemory {
    // Save previous conversation
    if (this.currentConversation) {
      this.endConversation();
    }
    
    this.currentConversation = {
      id: `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      startTime: Date.now(),
      turns: [],
      topics: [],
      entities: [],
      sentiment: {
        overall: 0,
        trend: 'stable',
        history: [],
      },
    };
    
    this.emit('conversation-started', this.currentConversation);
    return this.currentConversation;
  }
  
  /**
   * Add a turn to current conversation
   */
  addTurn(role: 'user' | 'assistant' | 'system', text: string, metadata?: Partial<Turn>): Turn {
    if (!this.currentConversation) {
      this.startConversation();
    }
    
    const turn: Turn = {
      id: `turn_${++this.turnCounter}`,
      role,
      text,
      timestamp: Date.now(),
      entities: this.config.entityExtractionEnabled ? this.entityExtractor.extract(text) : [],
      sentiment: this.config.sentimentTrackingEnabled ? this.sentimentAnalyzer.analyze(text) : 0,
      ...metadata,
    };
    
    this.currentConversation!.turns.push(turn);
    
    // Extract and track topics
    if (this.config.topicTrackingEnabled) {
      const extractedTopics = this.topicExtractor.extract(text);
      this.updateTopics(extractedTopics, turn.timestamp);
    }
    
    // Track entities
    if (turn.entities.length > 0) {
      this.updateEntityMentions(turn.entities, turn.id);
    }
    
    // Update sentiment
    if (this.config.sentimentTrackingEnabled) {
      this.updateSentiment(turn.sentiment, turn.timestamp);
    }
    
    // Update user context
    if (role === 'user') {
      this.userContext.lastInteraction = turn.timestamp;
      this.userContext.interactionCount++;
      
      for (const entity of turn.entities) {
        this.userContext.entities.set(entity.type, entity.value);
      }
    }
    
    // Limit turns in memory
    if (this.currentConversation!.turns.length > this.config.maxTurnsInMemory) {
      this.currentConversation!.turns.shift();
    }
    
    this.emit('turn-added', turn);
    return turn;
  }
  
  /**
   * End current conversation
   */
  async endConversation(): Promise<void> {
    if (!this.currentConversation) return;
    
    this.currentConversation.endTime = Date.now();
    this.currentConversation.summary = this.generateSummary();
    
    await this.saveConversation(this.currentConversation);
    
    this.emit('conversation-ended', this.currentConversation);
    this.currentConversation = null;
  }
  
  /**
   * Get conversation context for AI
   */
  getContext(maxTurns: number = 10): string {
    if (!this.currentConversation) return '';
    
    const recentTurns = this.currentConversation.turns.slice(-maxTurns);
    
    return recentTurns
      .map((t) => `${t.role}: ${t.text}`)
      .join('\n');
  }
  
  /**
   * Get relevant information for current context
   */
  getRelevantContext(currentText: string): {
    recentTopics: string[];
    relevantEntities: ExtractedEntity[];
    userPreferences: Record<string, unknown>;
    conversationSummary?: string;
  } {
    // Extract topics from current text
    const currentTopics = this.topicExtractor.extract(currentText);
    
    // Find relevant entities
    const relevantEntities: ExtractedEntity[] = [];
    if (this.currentConversation) {
      for (const mention of this.currentConversation.entities) {
        if (mention.frequency >= 2) {
          relevantEntities.push(mention.entity);
        }
      }
    }
    
    return {
      recentTopics: this.currentConversation?.topics.slice(0, 5).map((t) => t.name) || [],
      relevantEntities,
      userPreferences: this.userContext.preferences,
      conversationSummary: this.currentConversation?.summary,
    };
  }
  
  /**
   * Search conversation history
   */
  async searchHistory(query: string, limit: number = 10): Promise<Turn[]> {
    const results: Turn[] = [];
    const normalizedQuery = query.toLowerCase();
    
    // Search current conversation
    if (this.currentConversation) {
      for (const turn of this.currentConversation.turns) {
        if (turn.text.toLowerCase().includes(normalizedQuery)) {
          results.push(turn);
        }
      }
    }
    
    // Search stored conversations
    try {
      const files = await fs.readdir(this.config.storageDir);
      
      for (const file of files) {
        if (!file.endsWith('.json') || results.length >= limit) continue;
        
        const content = await fs.readFile(
          path.join(this.config.storageDir, file),
          'utf-8'
        );
        const conversation = JSON.parse(content) as ConversationMemory;
        
        for (const turn of conversation.turns) {
          if (turn.text.toLowerCase().includes(normalizedQuery)) {
            results.push(turn);
            if (results.length >= limit) break;
          }
        }
      }
    } catch (error) {
      logger.error('Error searching history', { error });
    }
    
    return results.slice(0, limit);
  }
  
  /**
   * Get user context
   */
  getUserContext(): UserContext {
    return { ...this.userContext };
  }
  
  /**
   * Update user preference
   */
  setUserPreference(key: string, value: unknown): void {
    this.userContext.preferences[key] = value;
    this.saveUserContext();
    this.emit('preference-updated', { key, value });
  }
  
  /**
   * Get current conversation
   */
  getCurrentConversation(): ConversationMemory | null {
    return this.currentConversation;
  }
  
  // ============================================
  // Private Methods
  // ============================================
  
  private updateTopics(
    extracted: Array<{ name: string; confidence: number }>,
    timestamp: number
  ): void {
    if (!this.currentConversation) return;
    
    for (const { name, confidence } of extracted) {
      const existing = this.currentConversation.topics.find((t) => t.name === name);
      
      if (existing) {
        existing.mentions++;
        existing.lastMentioned = timestamp;
        existing.confidence = Math.max(existing.confidence, confidence);
      } else {
        this.currentConversation.topics.push({
          name,
          mentions: 1,
          firstMentioned: timestamp,
          lastMentioned: timestamp,
          confidence,
        });
      }
    }
    
    // Sort by mentions
    this.currentConversation.topics.sort((a, b) => b.mentions - a.mentions);
    
    // Update user's recent topics
    this.userContext.recentTopics = this.currentConversation.topics
      .slice(0, 5)
      .map((t) => t.name);
  }
  
  private updateEntityMentions(entities: ExtractedEntity[], turnId: string): void {
    if (!this.currentConversation) return;
    
    for (const entity of entities) {
      const key = `${entity.type}:${entity.normalized || entity.value}`;
      const existing = this.currentConversation.entities.find(
        (e) => `${e.entity.type}:${e.entity.normalized || e.entity.value}` === key
      );
      
      if (existing) {
        existing.turnIds.push(turnId);
        existing.frequency++;
      } else {
        this.currentConversation.entities.push({
          entity,
          turnIds: [turnId],
          frequency: 1,
        });
      }
    }
  }
  
  private updateSentiment(sentiment: number, timestamp: number): void {
    if (!this.currentConversation) return;
    
    const sentimentData = this.currentConversation.sentiment;
    sentimentData.history.push({ timestamp, value: sentiment });
    
    // Limit history
    if (sentimentData.history.length > 50) {
      sentimentData.history.shift();
    }
    
    // Calculate overall sentiment
    const sum = sentimentData.history.reduce((acc, h) => acc + h.value, 0);
    sentimentData.overall = sum / sentimentData.history.length;
    
    // Calculate trend
    if (sentimentData.history.length >= 3) {
      const recentAvg = sentimentData.history.slice(-3).reduce((acc, h) => acc + h.value, 0) / 3;
      const olderAvg = sentimentData.history.slice(-6, -3).reduce((acc, h) => acc + h.value, 0) / 3 || 0;
      
      if (recentAvg - olderAvg > 0.2) {
        sentimentData.trend = 'improving';
      } else if (recentAvg - olderAvg < -0.2) {
        sentimentData.trend = 'declining';
      } else {
        sentimentData.trend = 'stable';
      }
    }
  }
  
  private generateSummary(): string {
    if (!this.currentConversation) return '';
    
    const topics = this.currentConversation.topics
      .slice(0, 3)
      .map((t) => t.name)
      .join(', ');
    
    const turnCount = this.currentConversation.turns.length;
    const duration = Math.round(
      (Date.now() - this.currentConversation.startTime) / 60000
    );
    
    return `Conversation about ${topics || 'general topics'}. ` +
           `${turnCount} turns over ${duration} minutes. ` +
           `Sentiment: ${this.currentConversation.sentiment.trend}.`;
  }
  
  private async saveConversation(conversation: ConversationMemory): Promise<void> {
    try {
      const filename = `${conversation.id}.json`;
      const filepath = path.join(this.config.storageDir, filename);
      
      await fs.writeFile(filepath, JSON.stringify(conversation, null, 2));
      logger.debug('Conversation saved', { id: conversation.id });
      
      // Cleanup old conversations
      await this.cleanupOldConversations();
    } catch (error) {
      logger.error('Failed to save conversation', { error });
    }
  }
  
  private async cleanupOldConversations(): Promise<void> {
    try {
      const files = await fs.readdir(this.config.storageDir);
      const jsonFiles = files.filter((f) => f.endsWith('.json') && f.startsWith('conv_'));
      
      if (jsonFiles.length > this.config.maxConversationsStored) {
        // Sort by filename (which includes timestamp)
        jsonFiles.sort();
        
        const toDelete = jsonFiles.slice(0, jsonFiles.length - this.config.maxConversationsStored);
        
        for (const file of toDelete) {
          await fs.unlink(path.join(this.config.storageDir, file));
        }
        
        logger.debug('Cleaned up old conversations', { count: toDelete.length });
      }
    } catch (error) {
      logger.error('Failed to cleanup conversations', { error });
    }
  }
  
  private async loadUserContext(): Promise<void> {
    try {
      const filepath = path.join(this.config.storageDir, 'user_context.json');
      const content = await fs.readFile(filepath, 'utf-8');
      const saved = JSON.parse(content);
      
      this.userContext = {
        ...this.userContext,
        ...saved,
        entities: new Map(Object.entries(saved.entities || {})),
      };
    } catch {
      // No saved context
    }
  }
  
  private async saveUserContext(): Promise<void> {
    try {
      const filepath = path.join(this.config.storageDir, 'user_context.json');
      
      const toSave = {
        ...this.userContext,
        entities: Object.fromEntries(this.userContext.entities),
      };
      
      await fs.writeFile(filepath, JSON.stringify(toSave, null, 2));
    } catch (error) {
      logger.error('Failed to save user context', { error });
    }
  }
  
  private startAutoSave(): void {
    this.saveTimer = setInterval(async () => {
      if (this.currentConversation && this.currentConversation.turns.length > 0) {
        await this.saveConversation(this.currentConversation);
      }
      await this.saveUserContext();
    }, this.config.saveInterval);
  }
  
  /**
   * Shutdown
   */
  async shutdown(): Promise<void> {
    if (this.saveTimer) {
      clearInterval(this.saveTimer);
    }
    
    if (this.currentConversation) {
      await this.endConversation();
    }
    
    await this.saveUserContext();
  }
}

// ============================================
// Exports
// ============================================

export const conversationMemory = new ConversationMemoryManager();

// Re-export with alias (classes already exported at definition)
export { DEFAULT_CONFIG as DEFAULT_MEMORY_CONFIG };
