/**
 * Nova Desktop - Topic Detector
 * Detects topics and topic shifts in conversations
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('TopicDetector');

/**
 * Predefined topic categories
 */
export type TopicCategory =
  | 'technology'
  | 'programming'
  | 'entertainment'
  | 'work'
  | 'personal'
  | 'health'
  | 'education'
  | 'finance'
  | 'travel'
  | 'food'
  | 'sports'
  | 'weather'
  | 'news'
  | 'shopping'
  | 'home'
  | 'general';

/**
 * A detected topic
 */
export interface DetectedTopic {
  /** Topic name */
  name: string;
  /** Category */
  category: TopicCategory;
  /** Confidence score (0-1) */
  confidence: number;
  /** Keywords that triggered this topic */
  keywords: string[];
  /** First detected timestamp */
  firstDetected: number;
  /** Last detected timestamp */
  lastDetected: number;
  /** Number of mentions */
  mentions: number;
}

/**
 * Topic shift event
 */
export interface TopicShift {
  /** Previous topic(s) */
  from: DetectedTopic[];
  /** New topic(s) */
  to: DetectedTopic[];
  /** Timestamp of shift */
  timestamp: number;
  /** Abruptness of shift (0-1, higher = more abrupt) */
  abruptness: number;
}

/**
 * Topic detection result
 */
export interface TopicDetectionResult {
  /** All detected topics */
  topics: DetectedTopic[];
  /** Primary/dominant topic */
  primaryTopic: DetectedTopic | null;
  /** Whether a topic shift occurred */
  topicShift: boolean;
  /** Shift details if occurred */
  shift?: TopicShift;
  /** Topic diversity score (0-1, higher = more diverse) */
  diversity: number;
}

/**
 * Topic keywords organized by category
 */
const TOPIC_KEYWORDS: Record<TopicCategory, Record<string, string[]>> = {
  technology: {
    general: ['tech', 'technology', 'digital', 'computer', 'software', 'hardware', 'device'],
    ai: ['ai', 'artificial intelligence', 'machine learning', 'ml', 'neural', 'gpt', 'chatbot'],
    mobile: ['phone', 'smartphone', 'mobile', 'android', 'iphone', 'ios', 'app'],
    web: ['website', 'browser', 'internet', 'online', 'url', 'link', 'web'],
  },
  programming: {
    general: ['code', 'coding', 'programming', 'developer', 'development', 'software'],
    languages: ['javascript', 'python', 'typescript', 'java', 'react', 'node', 'rust', 'go'],
    concepts: ['function', 'variable', 'class', 'api', 'database', 'server', 'frontend', 'backend'],
    tools: ['git', 'github', 'vscode', 'terminal', 'docker', 'npm', 'debug', 'test'],
  },
  entertainment: {
    media: ['movie', 'film', 'tv', 'show', 'series', 'watch', 'stream', 'netflix', 'youtube'],
    music: ['music', 'song', 'playlist', 'album', 'artist', 'band', 'spotify', 'listen'],
    games: ['game', 'gaming', 'play', 'video game', 'console', 'pc game', 'steam'],
    reading: ['book', 'novel', 'read', 'story', 'author', 'kindle'],
  },
  work: {
    general: ['work', 'job', 'career', 'office', 'business', 'company', 'colleague'],
    tasks: ['project', 'task', 'deadline', 'meeting', 'presentation', 'report'],
    communication: ['email', 'slack', 'teams', 'call', 'conference', 'zoom'],
  },
  personal: {
    family: ['family', 'wife', 'husband', 'kids', 'children', 'parents', 'mom', 'dad'],
    relationships: ['friend', 'relationship', 'dating', 'partner'],
    life: ['birthday', 'anniversary', 'wedding', 'vacation', 'holiday'],
  },
  health: {
    fitness: ['exercise', 'workout', 'gym', 'fitness', 'running', 'yoga'],
    medical: ['doctor', 'hospital', 'medicine', 'health', 'sick', 'illness'],
    wellness: ['sleep', 'diet', 'nutrition', 'mental health', 'stress', 'meditation'],
  },
  education: {
    learning: ['learn', 'study', 'course', 'tutorial', 'lesson', 'education'],
    school: ['school', 'university', 'college', 'class', 'student', 'teacher'],
  },
  finance: {
    money: ['money', 'budget', 'expense', 'cost', 'price', 'payment'],
    investing: ['invest', 'stock', 'crypto', 'bitcoin', 'trading', 'portfolio'],
    banking: ['bank', 'account', 'credit', 'loan', 'mortgage'],
  },
  travel: {
    general: ['travel', 'trip', 'vacation', 'holiday', 'destination'],
    transport: ['flight', 'airplane', 'train', 'car', 'drive', 'airport'],
    accommodation: ['hotel', 'booking', 'reservation', 'airbnb'],
  },
  food: {
    cooking: ['cook', 'recipe', 'kitchen', 'ingredient', 'bake'],
    eating: ['food', 'restaurant', 'dinner', 'lunch', 'breakfast', 'eat'],
    diet: ['vegetarian', 'vegan', 'gluten', 'allergy', 'diet'],
  },
  sports: {
    general: ['sports', 'game', 'team', 'player', 'match', 'score'],
    specific: ['football', 'soccer', 'basketball', 'baseball', 'tennis', 'golf'],
  },
  weather: {
    conditions: ['weather', 'rain', 'sunny', 'cloudy', 'storm', 'snow', 'temperature'],
    forecast: ['forecast', 'tomorrow', 'weekend weather'],
  },
  news: {
    general: ['news', 'headline', 'breaking', 'update', 'current events'],
    topics: ['politics', 'economy', 'election', 'government'],
  },
  shopping: {
    general: ['buy', 'shop', 'shopping', 'store', 'purchase', 'order'],
    online: ['amazon', 'ebay', 'delivery', 'shipping', 'cart', 'checkout'],
  },
  home: {
    general: ['home', 'house', 'apartment', 'room'],
    maintenance: ['clean', 'repair', 'fix', 'maintenance', 'renovation'],
    smart: ['smart home', 'thermostat', 'lights', 'automation'],
  },
  general: {
    greetings: ['hi', 'hello', 'hey', 'good morning', 'good afternoon'],
    questions: ['what', 'how', 'why', 'when', 'where', 'who'],
    responses: ['yes', 'no', 'maybe', 'okay', 'sure', 'thanks'],
  },
};

/**
 * Topic Detector Events
 */
export interface TopicDetectorEvents {
  'topic-detected': (topic: DetectedTopic) => void;
  'topic-shift': (shift: TopicShift) => void;
  'primary-topic-changed': (oldTopic: DetectedTopic | null, newTopic: DetectedTopic) => void;
}

/**
 * Topic Detector Configuration
 */
export interface TopicDetectorConfig {
  /** Minimum confidence to consider a topic detected */
  minConfidence: number;
  /** Decay rate for topic weights (per turn) */
  decayRate: number;
  /** Threshold for topic shift detection */
  shiftThreshold: number;
  /** Maximum topics to track */
  maxTopics: number;
}

const DEFAULT_CONFIG: TopicDetectorConfig = {
  minConfidence: 0.3,
  decayRate: 0.1,
  shiftThreshold: 0.5,
  maxTopics: 20,
};

/**
 * Topic Detector
 * Detects topics and topic shifts in conversations
 */
export class TopicDetector extends EventEmitter {
  private config: TopicDetectorConfig;
  private activeTopics: Map<string, DetectedTopic> = new Map();
  private primaryTopic: DetectedTopic | null = null;
  private previousTopics: DetectedTopic[] = [];
  private turnCount = 0;

  constructor(config?: Partial<TopicDetectorConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    logger.info('TopicDetector initialized', { config: this.config });
  }

  /**
   * Detect topics in text
   */
  detect(text: string): TopicDetectionResult {
    const normalizedText = text.toLowerCase();
    const detectedTopics: DetectedTopic[] = [];
    const now = Date.now();

    // Check each category
    for (const [category, subtopics] of Object.entries(TOPIC_KEYWORDS)) {
      for (const [subtopicName, keywords] of Object.entries(subtopics)) {
        const matchedKeywords: string[] = [];

        for (const keyword of keywords) {
          if (normalizedText.includes(keyword)) {
            matchedKeywords.push(keyword);
          }
        }

        if (matchedKeywords.length > 0) {
          const topicName = `${category}/${subtopicName}`;
          const confidence = Math.min(1, 0.3 + matchedKeywords.length * 0.2);

          // Check if topic already exists
          const existing = this.activeTopics.get(topicName);

          if (existing) {
            // Update existing topic
            existing.confidence = Math.min(1, existing.confidence + 0.2);
            existing.lastDetected = now;
            existing.mentions++;
            existing.keywords = [...new Set([...existing.keywords, ...matchedKeywords])];
            detectedTopics.push(existing);
          } else {
            // Create new topic
            const newTopic: DetectedTopic = {
              name: topicName,
              category: category as TopicCategory,
              confidence,
              keywords: matchedKeywords,
              firstDetected: now,
              lastDetected: now,
              mentions: 1,
            };

            if (confidence >= this.config.minConfidence) {
              this.activeTopics.set(topicName, newTopic);
              detectedTopics.push(newTopic);
              this.emit('topic-detected', newTopic);
            }
          }
        }
      }
    }

    // Apply decay to non-detected topics
    this.applyDecay(detectedTopics);

    // Determine primary topic
    const sortedTopics = this.getSortedTopics();
    const newPrimary = sortedTopics.length > 0 ? sortedTopics[0] : null;

    // Check for topic shift
    let shift: TopicShift | undefined;
    let topicShift = false;

    if (this.primaryTopic && newPrimary && this.primaryTopic.name !== newPrimary.name) {
      const abruptness = this.calculateAbruptness(this.primaryTopic, newPrimary);

      if (abruptness > this.config.shiftThreshold) {
        topicShift = true;
        shift = {
          from: this.previousTopics.length > 0 ? [...this.previousTopics] : [this.primaryTopic],
          to: detectedTopics,
          timestamp: now,
          abruptness,
        };

        this.emit('topic-shift', shift);
        logger.info('Topic shift detected', {
          from: this.primaryTopic.name,
          to: newPrimary.name,
          abruptness: abruptness.toFixed(2),
        });
      }

      this.emit('primary-topic-changed', this.primaryTopic, newPrimary);
    }

    // Update state
    this.previousTopics = detectedTopics;
    this.primaryTopic = newPrimary;
    this.turnCount++;

    // Prune old topics
    this.pruneTopics();

    // Calculate diversity
    const diversity = this.calculateDiversity();

    const result: TopicDetectionResult = {
      topics: detectedTopics,
      primaryTopic: newPrimary,
      topicShift,
      shift,
      diversity,
    };

    logger.debug('Topics detected', {
      topicCount: detectedTopics.length,
      primary: newPrimary?.name,
      shift: topicShift,
    });

    return result;
  }

  /**
   * Apply decay to topics not detected in current turn
   */
  private applyDecay(detectedTopics: DetectedTopic[]): void {
    const detectedNames = new Set(detectedTopics.map((t) => t.name));

    for (const [name, topic] of this.activeTopics) {
      if (!detectedNames.has(name)) {
        topic.confidence -= this.config.decayRate;

        if (topic.confidence < this.config.minConfidence) {
          this.activeTopics.delete(name);
        }
      }
    }
  }

  /**
   * Calculate abruptness of topic shift
   */
  private calculateAbruptness(fromTopic: DetectedTopic, toTopic: DetectedTopic): number {
    // Different categories = more abrupt
    if (fromTopic.category !== toTopic.category) {
      return 0.8;
    }

    // Check keyword overlap
    const fromKeywords = new Set(fromTopic.keywords);
    const toKeywords = new Set(toTopic.keywords);
    const overlap = [...fromKeywords].filter((k) => toKeywords.has(k)).length;
    const total = new Set([...fromKeywords, ...toKeywords]).size;

    const similarity = total > 0 ? overlap / total : 0;
    return 1 - similarity;
  }

  /**
   * Calculate topic diversity
   */
  private calculateDiversity(): number {
    const topics = Array.from(this.activeTopics.values());
    if (topics.length === 0) return 0;

    const categories = new Set(topics.map((t) => t.category));
    return categories.size / topics.length;
  }

  /**
   * Prune old/low-confidence topics
   */
  private pruneTopics(): void {
    if (this.activeTopics.size <= this.config.maxTopics) return;

    const sorted = this.getSortedTopics();
    const toRemove = sorted.slice(this.config.maxTopics);

    for (const topic of toRemove) {
      this.activeTopics.delete(topic.name);
    }
  }

  /**
   * Get topics sorted by confidence
   */
  private getSortedTopics(): DetectedTopic[] {
    return Array.from(this.activeTopics.values()).sort((a, b) => {
      // Sort by confidence, then by recency
      if (b.confidence !== a.confidence) {
        return b.confidence - a.confidence;
      }
      return b.lastDetected - a.lastDetected;
    });
  }

  /**
   * Get all active topics
   */
  getActiveTopics(): DetectedTopic[] {
    return this.getSortedTopics();
  }

  /**
   * Get primary topic
   */
  getPrimaryTopic(): DetectedTopic | null {
    return this.primaryTopic;
  }

  /**
   * Get topics by category
   */
  getTopicsByCategory(category: TopicCategory): DetectedTopic[] {
    return Array.from(this.activeTopics.values()).filter((t) => t.category === category);
  }

  /**
   * Check if a specific topic is active
   */
  isTopicActive(topicName: string): boolean {
    return this.activeTopics.has(topicName);
  }

  /**
   * Get topic summary for LLM context
   */
  getTopicSummary(): string {
    const topics = this.getSortedTopics().slice(0, 5);
    if (topics.length === 0) return '';

    const parts = topics.map(
      (t) => `${t.name.split('/')[1]} (${(t.confidence * 100).toFixed(0)}%)`
    );

    return `Current topics: ${parts.join(', ')}`;
  }

  /**
   * Get conversation focus (main category)
   */
  getConversationFocus(): TopicCategory | null {
    const topics = this.getSortedTopics();
    if (topics.length === 0) return null;

    // Count categories
    const categoryCounts = new Map<TopicCategory, number>();
    for (const topic of topics) {
      categoryCounts.set(
        topic.category,
        (categoryCounts.get(topic.category) || 0) + topic.confidence
      );
    }

    // Find dominant category
    let maxCategory: TopicCategory | null = null;
    let maxCount = 0;

    for (const [category, count] of categoryCounts) {
      if (count > maxCount) {
        maxCount = count;
        maxCategory = category;
      }
    }

    return maxCategory;
  }

  /**
   * Get statistics
   */
  getStats(): {
    activeTopics: number;
    turnCount: number;
    primaryTopic: string | null;
    focus: TopicCategory | null;
    diversity: number;
  } {
    return {
      activeTopics: this.activeTopics.size,
      turnCount: this.turnCount,
      primaryTopic: this.primaryTopic?.name || null,
      focus: this.getConversationFocus(),
      diversity: this.calculateDiversity(),
    };
  }

  /**
   * Clear all topics
   */
  clear(): void {
    this.activeTopics.clear();
    this.primaryTopic = null;
    this.previousTopics = [];
    this.turnCount = 0;
    logger.info('TopicDetector cleared');
  }

  /**
   * Shutdown
   */
  shutdown(): void {
    this.removeAllListeners();
    logger.info('TopicDetector shutdown');
  }

  // Type-safe event emitter methods
  on<K extends keyof TopicDetectorEvents>(event: K, listener: TopicDetectorEvents[K]): this {
    return super.on(event, listener);
  }

  off<K extends keyof TopicDetectorEvents>(event: K, listener: TopicDetectorEvents[K]): this {
    return super.off(event, listener);
  }

  emit<K extends keyof TopicDetectorEvents>(
    event: K,
    ...args: Parameters<TopicDetectorEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }
}

// Singleton instance
let detectorInstance: TopicDetector | null = null;

/**
 * Get or create the topic detector instance
 */
export function getTopicDetector(config?: Partial<TopicDetectorConfig>): TopicDetector {
  if (!detectorInstance) {
    detectorInstance = new TopicDetector(config);
  }
  return detectorInstance;
}

/**
 * Shutdown the topic detector
 */
export function shutdownTopicDetector(): void {
  if (detectorInstance) {
    detectorInstance.shutdown();
    detectorInstance = null;
  }
}

export default TopicDetector;
