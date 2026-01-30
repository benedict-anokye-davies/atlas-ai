/**
 * Auto Journaling
 * Automatically generates daily journals from conversations and activities
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { createModuleLogger } from '../utils/logger';
import {
  JournalEntry,
  JournalType,
  MoodLevel,
  LinkedEntity,
  JournalMetadata
} from './types';
import { isoDate } from '../../shared/utils';

const logger = createModuleLogger('AutoJournaling');

interface AutoJournalingConfig {
  persistPath: string;
  autoGenerate: boolean;
  generateTime: string; // HH:mm
  minConversations: number;
  maxEntryLength: number;
}

const DEFAULT_CONFIG: AutoJournalingConfig = {
  persistPath: '',
  autoGenerate: true,
  generateTime: '22:00',
  minConversations: 3,
  maxEntryLength: 2000
};

interface ConversationData {
  id: string;
  timestamp: Date;
  messages: Array<{ role: string; content: string }>;
  toolsUsed: string[];
  topics: string[];
}

class AutoJournaling extends EventEmitter {
  private config: AutoJournalingConfig;
  private entries: Map<string, JournalEntry> = new Map();
  private conversationBuffer: ConversationData[] = [];
  private generateTimer: NodeJS.Timeout | null = null;
  private initialized: boolean = false;

  constructor(config?: Partial<AutoJournalingConfig>) {
    super();
    
    const userDataPath = app?.getPath?.('userData') || './data';
    this.config = {
      ...DEFAULT_CONFIG,
      persistPath: path.join(userDataPath, 'journals'),
      ...config
    };
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    logger.info('Initializing auto journaling');
    
    // Ensure persist directory exists
    if (!fs.existsSync(this.config.persistPath)) {
      fs.mkdirSync(this.config.persistPath, { recursive: true });
    }
    
    // Load existing entries
    await this.loadEntries();
    
    // Schedule daily generation
    if (this.config.autoGenerate) {
      this.scheduleDailyGeneration();
    }
    
    this.initialized = true;
    this.emit('initialized');
  }

  /**
   * Load existing journal entries
   */
  private async loadEntries(): Promise<void> {
    try {
      const files = fs.readdirSync(this.config.persistPath)
        .filter(f => f.endsWith('.json'));
      
      for (const file of files) {
        const filePath = path.join(this.config.persistPath, file);
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        
        this.entries.set(data.id, {
          ...data,
          date: new Date(data.date),
          metadata: {
            ...data.metadata,
            editedAt: data.metadata.editedAt ? new Date(data.metadata.editedAt) : undefined
          }
        });
      }
      
      logger.info('Loaded journal entries', { count: this.entries.size });
    } catch (error) {
      logger.warn('Failed to load journal entries', error);
    }
  }

  /**
   * Schedule daily journal generation
   */
  private scheduleDailyGeneration(): void {
    const scheduleNext = () => {
      const now = new Date();
      const [hours, minutes] = this.config.generateTime.split(':').map(Number);
      
      const nextRun = new Date(now);
      nextRun.setHours(hours, minutes, 0, 0);
      
      if (nextRun <= now) {
        nextRun.setDate(nextRun.getDate() + 1);
      }
      
      const delay = nextRun.getTime() - now.getTime();
      
      this.generateTimer = setTimeout(async () => {
        await this.generateDailyEntry();
        scheduleNext();
      }, delay);
    };
    
    scheduleNext();
  }

  /**
   * Record a conversation for journaling
   */
  recordConversation(conversation: ConversationData): void {
    this.conversationBuffer.push(conversation);
    
    // Keep only today's conversations
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    this.conversationBuffer = this.conversationBuffer.filter(c => 
      c.timestamp >= today
    );
    
    this.emit('conversation-recorded', conversation.id);
  }

  /**
   * Generate daily journal entry
   */
  async generateDailyEntry(): Promise<JournalEntry | null> {
    if (this.conversationBuffer.length < this.config.minConversations) {
      logger.info('Not enough conversations for daily entry', {
        count: this.conversationBuffer.length,
        required: this.config.minConversations
      });
      return null;
    }
    
    try {
      const today = new Date();
      const dateStr = isoDate(today);
      const entryId = `journal-${dateStr}`;
      
      // Check if entry already exists
      if (this.entries.has(entryId)) {
        logger.info('Daily entry already exists', { date: dateStr });
        return this.entries.get(entryId)!;
      }
      
      // Generate entry content
      const content = this.composeEntry(this.conversationBuffer);
      const summary = this.generateSummary(content);
      const tags = this.extractTags(this.conversationBuffer);
      const entities = this.extractEntities(this.conversationBuffer);
      const mood = this.detectMood(this.conversationBuffer);
      const insights = this.extractInsights(this.conversationBuffer);
      
      const entry: JournalEntry = {
        id: entryId,
        date: today,
        type: 'daily',
        content,
        summary,
        mood,
        tags,
        linkedEntities: entities,
        insights,
        metadata: {
          wordCount: content.split(/\s+/).length,
          readTime: Math.ceil(content.split(/\s+/).length / 200),
          autoGenerated: true,
          conversationIds: this.conversationBuffer.map(c => c.id),
          toolsUsed: [...new Set(this.conversationBuffer.flatMap(c => c.toolsUsed))]
        }
      };
      
      // Save entry
      await this.saveEntry(entry);
      this.entries.set(entryId, entry);
      
      // Clear buffer
      this.conversationBuffer = [];
      
      logger.info('Generated daily journal entry', { date: dateStr });
      this.emit('entry-generated', entry);
      
      return entry;
    } catch (error) {
      logger.error('Failed to generate daily entry', error);
      return null;
    }
  }

  /**
   * Compose journal entry content from conversations
   */
  private composeEntry(conversations: ConversationData[]): string {
    const sections: string[] = [];
    
    // Group conversations by topic
    const topicMap = new Map<string, ConversationData[]>();
    
    for (const conv of conversations) {
      for (const topic of conv.topics) {
        if (!topicMap.has(topic)) {
          topicMap.set(topic, []);
        }
        topicMap.get(topic)!.push(conv);
      }
    }
    
    // Generate overview
    sections.push(`## Daily Overview\n`);
    sections.push(`Today I had ${conversations.length} conversations with Atlas covering ${topicMap.size} main topics.\n`);
    
    // Topics covered
    if (topicMap.size > 0) {
      sections.push(`\n## Topics Explored\n`);
      
      for (const [topic, convs] of topicMap) {
        const keyPoints = this.extractKeyPoints(convs);
        sections.push(`\n### ${topic}\n`);
        
        if (keyPoints.length > 0) {
          for (const point of keyPoints.slice(0, 3)) {
            sections.push(`- ${point}`);
          }
        }
      }
    }
    
    // Tools used
    const allTools = [...new Set(conversations.flatMap(c => c.toolsUsed))];
    if (allTools.length > 0) {
      sections.push(`\n## Tools Utilized\n`);
      sections.push(`Used ${allTools.length} different tools: ${allTools.join(', ')}`);
    }
    
    // Trim to max length
    let content = sections.join('\n');
    if (content.length > this.config.maxEntryLength) {
      content = content.slice(0, this.config.maxEntryLength) + '...';
    }
    
    return content;
  }

  /**
   * Extract key points from conversations
   */
  private extractKeyPoints(conversations: ConversationData[]): string[] {
    const points: string[] = [];
    
    for (const conv of conversations) {
      for (const msg of conv.messages) {
        if (msg.role === 'assistant' && msg.content.length > 50) {
          // Extract first sentence as potential key point
          const firstSentence = msg.content.split(/[.!?]/)[0];
          if (firstSentence && firstSentence.length > 20 && firstSentence.length < 200) {
            points.push(firstSentence.trim());
          }
        }
      }
    }
    
    // Deduplicate and limit
    return [...new Set(points)].slice(0, 10);
  }

  /**
   * Generate summary of content
   */
  private generateSummary(content: string): string {
    // Extract first paragraph or first 200 chars
    const firstPara = content.split('\n\n')[0] || content;
    return firstPara.slice(0, 200) + (firstPara.length > 200 ? '...' : '');
  }

  /**
   * Extract tags from conversations
   */
  private extractTags(conversations: ConversationData[]): string[] {
    const tags = new Set<string>();
    
    // Add all topics as tags
    for (const conv of conversations) {
      for (const topic of conv.topics) {
        tags.add(topic.toLowerCase());
      }
    }
    
    // Add tool categories as tags
    for (const conv of conversations) {
      for (const tool of conv.toolsUsed) {
        if (tool.includes('file') || tool.includes('read') || tool.includes('write')) {
          tags.add('file-operations');
        }
        if (tool.includes('git')) {
          tags.add('version-control');
        }
        if (tool.includes('search') || tool.includes('grep')) {
          tags.add('code-search');
        }
        if (tool.includes('browser') || tool.includes('web')) {
          tags.add('web');
        }
      }
    }
    
    return Array.from(tags).slice(0, 10);
  }

  /**
   * Extract linked entities from conversations
   */
  private extractEntities(conversations: ConversationData[]): LinkedEntity[] {
    const entities: LinkedEntity[] = [];
    const seen = new Set<string>();
    
    for (const conv of conversations) {
      for (const msg of conv.messages) {
        // Extract file paths
        const fileMatches = msg.content.match(/[\w/\\.-]+\.(ts|js|py|json|md|tsx|jsx)/g);
        if (fileMatches) {
          for (const file of fileMatches) {
            const key = `file:${file}`;
            if (!seen.has(key)) {
              seen.add(key);
              entities.push({
                type: 'file',
                id: key,
                name: file,
                relevance: 0.8
              });
            }
          }
        }
        
        // Extract project names (simplified)
        const projectMatches = msg.content.match(/(?:project|repo(?:sitory)?)\s+['"]?(\w+[-\w]*)['"]?/gi);
        if (projectMatches) {
          for (const match of projectMatches) {
            const name = match.replace(/project|repo(?:sitory)?/i, '').trim();
            const key = `project:${name}`;
            if (!seen.has(key) && name.length > 2) {
              seen.add(key);
              entities.push({
                type: 'project',
                id: key,
                name,
                relevance: 0.7
              });
            }
          }
        }
      }
    }
    
    return entities.slice(0, 20);
  }

  /**
   * Detect mood from conversations
   */
  private detectMood(conversations: ConversationData[]): MoodLevel {
    let positiveCount = 0;
    let negativeCount = 0;
    
    const positiveWords = ['great', 'awesome', 'thanks', 'perfect', 'excellent', 'amazing', 'helpful'];
    const negativeWords = ['error', 'problem', 'issue', 'bug', 'broken', 'frustrated', 'stuck'];
    
    for (const conv of conversations) {
      for (const msg of conv.messages) {
        if (msg.role === 'user') {
          const lower = msg.content.toLowerCase();
          
          for (const word of positiveWords) {
            if (lower.includes(word)) positiveCount++;
          }
          for (const word of negativeWords) {
            if (lower.includes(word)) negativeCount++;
          }
        }
      }
    }
    
    const total = positiveCount + negativeCount;
    if (total === 0) return 'neutral';
    
    const ratio = positiveCount / total;
    
    if (ratio > 0.7) return 'great';
    if (ratio > 0.5) return 'good';
    if (ratio > 0.3) return 'neutral';
    if (ratio > 0.1) return 'stressed';
    return 'frustrated';
  }

  /**
   * Extract insights from conversations
   */
  private extractInsights(conversations: ConversationData[]): string[] {
    const insights: string[] = [];
    
    // Count tool usage patterns
    const toolCounts = new Map<string, number>();
    for (const conv of conversations) {
      for (const tool of conv.toolsUsed) {
        toolCounts.set(tool, (toolCounts.get(tool) || 0) + 1);
      }
    }
    
    // Find most used tool
    let maxTool = '';
    let maxCount = 0;
    for (const [tool, count] of toolCounts) {
      if (count > maxCount) {
        maxTool = tool;
        maxCount = count;
      }
    }
    
    if (maxTool && maxCount > 2) {
      insights.push(`Most used tool today: ${maxTool} (${maxCount} times)`);
    }
    
    // Topic diversity
    const allTopics = new Set(conversations.flatMap(c => c.topics));
    if (allTopics.size > 5) {
      insights.push(`Explored ${allTopics.size} different topics - very diverse day!`);
    }
    
    return insights;
  }

  /**
   * Save entry to disk
   */
  private async saveEntry(entry: JournalEntry): Promise<void> {
    const filePath = path.join(this.config.persistPath, `${entry.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(entry, null, 2));
  }

  /**
   * Create a manual journal entry
   */
  async createEntry(
    type: JournalType,
    content: string,
    options: {
      tags?: string[];
      mood?: MoodLevel;
    } = {}
  ): Promise<JournalEntry> {
    const entryId = `journal-${type}-${Date.now()}`;
    
    const entry: JournalEntry = {
      id: entryId,
      date: new Date(),
      type,
      content,
      summary: this.generateSummary(content),
      mood: options.mood,
      tags: options.tags || [],
      linkedEntities: [],
      insights: [],
      metadata: {
        wordCount: content.split(/\s+/).length,
        readTime: Math.ceil(content.split(/\s+/).length / 200),
        autoGenerated: false
      }
    };
    
    await this.saveEntry(entry);
    this.entries.set(entryId, entry);
    
    this.emit('entry-created', entry);
    return entry;
  }

  /**
   * Get journal entry by ID
   */
  getEntry(id: string): JournalEntry | undefined {
    return this.entries.get(id);
  }

  /**
   * Get all entries
   */
  getAllEntries(): JournalEntry[] {
    return Array.from(this.entries.values())
      .sort((a, b) => b.date.getTime() - a.date.getTime());
  }

  /**
   * Get entries by date range
   */
  getEntriesByDateRange(start: Date, end: Date): JournalEntry[] {
    return this.getAllEntries().filter(e => 
      e.date >= start && e.date <= end
    );
  }

  /**
   * Get entries by tag
   */
  getEntriesByTag(tag: string): JournalEntry[] {
    const lowerTag = tag.toLowerCase();
    return this.getAllEntries().filter(e => 
      e.tags.some(t => t.toLowerCase() === lowerTag)
    );
  }

  /**
   * Search entries
   */
  searchEntries(query: string): JournalEntry[] {
    const lowerQuery = query.toLowerCase();
    return this.getAllEntries().filter(e =>
      e.content.toLowerCase().includes(lowerQuery) ||
      e.summary?.toLowerCase().includes(lowerQuery) ||
      e.tags.some(t => t.toLowerCase().includes(lowerQuery))
    );
  }

  /**
   * Delete an entry
   */
  deleteEntry(id: string): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    
    this.entries.delete(id);
    
    const filePath = path.join(this.config.persistPath, `${id}.json`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    
    this.emit('entry-deleted', entry);
    return true;
  }

  getStatus(): {
    initialized: boolean;
    entryCount: number;
    bufferedConversations: number;
    autoGenerate: boolean;
  } {
    return {
      initialized: this.initialized,
      entryCount: this.entries.size,
      bufferedConversations: this.conversationBuffer.length,
      autoGenerate: this.config.autoGenerate
    };
  }
}

// Singleton instance
let autoJournaling: AutoJournaling | null = null;

export function getAutoJournaling(): AutoJournaling {
  if (!autoJournaling) {
    autoJournaling = new AutoJournaling();
  }
  return autoJournaling;
}

export { AutoJournaling };
