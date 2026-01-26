/**
 * Atlas Desktop - Background Research Manager
 * Performs research while the assistant is idle
 */

import { EventEmitter } from 'events';
import { powerMonitor } from 'electron';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('BackgroundResearch');

/**
 * Research topic with priority
 */
export interface ResearchTopic {
  id: string;
  query: string;
  priority: 'high' | 'medium' | 'low';
  source: 'conversation' | 'user_interest' | 'scheduled' | 'follow_up';
  createdAt: number;
  metadata?: Record<string, unknown>;
}

/**
 * Research result
 */
export interface ResearchResult {
  id: string;
  topicId: string;
  query: string;
  summary: string;
  facts: string[];
  sources: string[];
  confidence: number;
  researchedAt: number;
  expiresAt: number;
}

/**
 * Research queue item
 */
interface QueueItem {
  topic: ResearchTopic;
  attempts: number;
  lastAttempt?: number;
}

/**
 * Research state
 */
export type ResearchState = 'idle' | 'researching' | 'paused' | 'disabled';

/**
 * Research configuration
 */
export interface ResearchConfig {
  /** Enable background research */
  enabled: boolean;
  /** Maximum topics to research per idle session */
  maxTopicsPerSession: number;
  /** Minimum idle time before starting research (ms) */
  minIdleTimeMs: number;
  /** Maximum research time per topic (ms) */
  maxResearchTimeMs: number;
  /** Result expiration time (ms) */
  resultExpirationMs: number;
  /** Maximum queue size */
  maxQueueSize: number;
  /** Pause research on user activity */
  pauseOnActivity: boolean;
}

/**
 * Default research configuration
 */
const DEFAULT_CONFIG: ResearchConfig = {
  enabled: true,
  maxTopicsPerSession: 3,
  minIdleTimeMs: 60000, // 1 minute
  maxResearchTimeMs: 30000, // 30 seconds per topic
  resultExpirationMs: 7 * 24 * 60 * 60 * 1000, // 7 days
  maxQueueSize: 50,
  pauseOnActivity: true,
};

/**
 * Topic extraction patterns
 */
const TOPIC_PATTERNS = [
  // Questions about facts
  /(?:what|who|where|when|how|why) (?:is|are|was|were|do|does|did|can|could|would|will) (.+?)\?/gi,
  // Explicit research requests
  /(?:research|look up|find out about|learn about|tell me about) (.+?)(?:\.|$)/gi,
  // Interest indicators
  /(?:interested in|curious about|want to know about|fascinated by) (.+?)(?:\.|$)/gi,
  // Follow-up potential
  /(?:later|next time|remind me to|don't forget) .+?(?:about|regarding) (.+?)(?:\.|$)/gi,
];

/**
 * BackgroundResearchManager - Handles idle-time research
 */
export class BackgroundResearchManager extends EventEmitter {
  private config: ResearchConfig;
  private state: ResearchState = 'idle';
  private queue: QueueItem[] = [];
  private results: Map<string, ResearchResult> = new Map();
  private idleCheckInterval: NodeJS.Timeout | null = null;
  private currentResearch: { topic: ResearchTopic; abortController?: AbortController } | null = null;
  private lastActivityTime: number = Date.now();
  private researchedTopics: Set<string> = new Set();

  constructor(config?: Partial<ResearchConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    logger.info('BackgroundResearchManager initialized', { config: this.config });
  }

  /**
   * Start the background research manager
   */
  start(): void {
    if (!this.config.enabled) {
      logger.info('Background research is disabled');
      return;
    }

    // Monitor power/activity state
    if (this.config.pauseOnActivity) {
      powerMonitor.on('resume', () => this.handleUserActivity());
      powerMonitor.on('unlock-screen', () => this.handleUserActivity());
    }

    // Start idle checking
    this.startIdleMonitoring();
    logger.info('Background research manager started');
  }

  /**
   * Stop the background research manager
   */
  stop(): void {
    this.stopIdleMonitoring();
    this.abortCurrentResearch();
    this.state = 'disabled';
    logger.info('Background research manager stopped');
  }

  /**
   * Update configuration
   */
  setConfig(config: Partial<ResearchConfig>): void {
    this.config = { ...this.config, ...config };

    if (!this.config.enabled) {
      this.stop();
    } else if (this.state === 'disabled') {
      this.start();
    }

    logger.info('Configuration updated', { config: this.config });
  }

  /**
   * Extract potential research topics from conversation text
   */
  extractTopics(text: string, source: ResearchTopic['source'] = 'conversation'): ResearchTopic[] {
    const topics: ResearchTopic[] = [];
    const seenQueries = new Set<string>();

    for (const pattern of TOPIC_PATTERNS) {
      let match;
      const regex = new RegExp(pattern.source, pattern.flags);

      while ((match = regex.exec(text)) !== null) {
        const query = match[1]?.trim();
        if (query && query.length > 3 && query.length < 200 && !seenQueries.has(query.toLowerCase())) {
          seenQueries.add(query.toLowerCase());
          topics.push({
            id: this.generateId(),
            query,
            priority: this.calculatePriority(query, source),
            source,
            createdAt: Date.now(),
          });
        }
      }
    }

    return topics;
  }

  /**
   * Add a topic to the research queue
   */
  queueTopic(topic: ResearchTopic): boolean {
    // Check if already researched recently
    const queryKey = topic.query.toLowerCase().trim();
    if (this.researchedTopics.has(queryKey)) {
      logger.debug('Topic already researched recently', { query: topic.query });
      return false;
    }

    // Check queue size
    if (this.queue.length >= this.config.maxQueueSize) {
      // Remove lowest priority items
      this.queue.sort((a, b) => this.priorityValue(b.topic.priority) - this.priorityValue(a.topic.priority));
      this.queue = this.queue.slice(0, this.config.maxQueueSize - 1);
    }

    // Check for duplicates
    const exists = this.queue.some(
      item => item.topic.query.toLowerCase().trim() === queryKey
    );
    if (exists) {
      return false;
    }

    this.queue.push({ topic, attempts: 0 });
    this.emit('topic-queued', topic);
    logger.info('Topic queued for research', { query: topic.query, priority: topic.priority });
    return true;
  }

  /**
   * Queue multiple topics from conversation
   */
  processConversation(userMessage: string, assistantResponse?: string): number {
    const text = `${userMessage} ${assistantResponse || ''}`;
    const topics = this.extractTopics(text);
    let queued = 0;

    for (const topic of topics) {
      if (this.queueTopic(topic)) {
        queued++;
      }
    }

    return queued;
  }

  /**
   * Get research result for a query
   */
  getResult(query: string): ResearchResult | null {
    const queryKey = query.toLowerCase().trim();

    // Check direct match
    const values = Array.from(this.results.values());
    for (const result of values) {
      if (result.query.toLowerCase().trim() === queryKey) {
        if (Date.now() < result.expiresAt) {
          return result;
        }
        // Expired, remove it
        this.results.delete(result.id);
      }
    }

    return null;
  }

  /**
   * Get all non-expired results
   */
  getAllResults(): ResearchResult[] {
    const now = Date.now();
    const results: ResearchResult[] = [];
    const values = Array.from(this.results.values());

    for (const result of values) {
      if (now < result.expiresAt) {
        results.push(result);
      } else {
        this.results.delete(result.id);
      }
    }

    return results;
  }

  /**
   * Get context string from relevant research for a query
   */
  getResearchContext(query: string): string {
    const keywords = query.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const relevantResults: ResearchResult[] = [];
    const values = Array.from(this.results.values());

    for (const result of values) {
      if (Date.now() >= result.expiresAt) {
        this.results.delete(result.id);
        continue;
      }

      // Check keyword overlap
      const resultWords = result.query.toLowerCase().split(/\s+/);
      const overlap = keywords.filter(k => resultWords.some(w => w.includes(k) || k.includes(w)));

      if (overlap.length > 0) {
        relevantResults.push(result);
      }
    }

    if (relevantResults.length === 0) {
      return '';
    }

    // Build context string
    const sections = relevantResults.map(r =>
      `Research on "${r.query}":\n${r.summary}\nKey facts: ${r.facts.slice(0, 3).join('; ')}`
    );

    return `Background research insights:\n\n${sections.join('\n\n')}`;
  }

  /**
   * Get current state
   */
  getState(): ResearchState {
    return this.state;
  }

  /**
   * Get queue status
   */
  getQueueStatus(): { size: number; topics: string[] } {
    return {
      size: this.queue.length,
      topics: this.queue.slice(0, 10).map(item => item.topic.query),
    };
  }

  /**
   * Notify of user activity (pauses research if configured)
   */
  notifyActivity(): void {
    this.lastActivityTime = Date.now();
    if (this.config.pauseOnActivity && this.state === 'researching') {
      this.pauseResearch();
    }
  }

  /**
   * Clear all queued topics
   */
  clearQueue(): void {
    this.queue = [];
    this.emit('queue-cleared');
    logger.info('Research queue cleared');
  }

  /**
   * Clear all results
   */
  clearResults(): void {
    this.results.clear();
    this.researchedTopics.clear();
    this.emit('results-cleared');
    logger.info('Research results cleared');
  }

  // Private methods

  private startIdleMonitoring(): void {
    if (this.idleCheckInterval) return;

    this.idleCheckInterval = setInterval(() => {
      this.checkIdleState();
    }, 10000); // Check every 10 seconds
  }

  private stopIdleMonitoring(): void {
    if (this.idleCheckInterval) {
      clearInterval(this.idleCheckInterval);
      this.idleCheckInterval = null;
    }
  }

  private checkIdleState(): void {
    if (this.state === 'disabled' || !this.config.enabled) return;

    const idleTime = Date.now() - this.lastActivityTime;

    if (idleTime >= this.config.minIdleTimeMs && this.state === 'idle') {
      this.startResearchSession();
    }
  }

  private async startResearchSession(): Promise<void> {
    if (this.queue.length === 0) {
      logger.debug('No topics in queue for research');
      return;
    }

    this.state = 'researching';
    this.emit('research-started');
    logger.info('Starting research session');

    let topicsResearched = 0;

    while (
      topicsResearched < this.config.maxTopicsPerSession &&
      this.queue.length > 0 &&
      this.state === 'researching'
    ) {
      const item = this.getNextTopic();
      if (!item) break;

      try {
        await this.researchTopic(item.topic);
        topicsResearched++;
        item.attempts++;

        // Mark as researched
        this.researchedTopics.add(item.topic.query.toLowerCase().trim());

        // Remove from queue
        this.queue = this.queue.filter(i => i.topic.id !== item.topic.id);
      } catch (error) {
        logger.error('Research failed', { topic: item.topic.query, error });
        item.attempts++;
        item.lastAttempt = Date.now();

        // Remove if too many attempts
        if (item.attempts >= 3) {
          this.queue = this.queue.filter(i => i.topic.id !== item.topic.id);
        }
      }
    }

    this.state = 'idle';
    this.emit('research-completed', { topicsResearched });
    logger.info('Research session completed', { topicsResearched });
  }

  private getNextTopic(): QueueItem | null {
    // Sort by priority (high first), then by creation time (oldest first)
    this.queue.sort((a, b) => {
      const priorityDiff = this.priorityValue(b.topic.priority) - this.priorityValue(a.topic.priority);
      if (priorityDiff !== 0) return priorityDiff;
      return a.topic.createdAt - b.topic.createdAt;
    });

    // Get first item that hasn't been attempted recently
    const now = Date.now();
    return this.queue.find(item =>
      !item.lastAttempt || now - item.lastAttempt > 60000
    ) || null;
  }

  private async researchTopic(topic: ResearchTopic): Promise<void> {
    const abortController = new AbortController();
    this.currentResearch = { topic, abortController };

    logger.info('Researching topic', { query: topic.query });

    // Set timeout
    const timeoutId = setTimeout(() => {
      abortController.abort();
    }, this.config.maxResearchTimeMs);

    try {
      // Simulate research (in production, this would call LLM or search APIs)
      const result = await this.performResearch(topic, abortController.signal);

      // Store result
      this.results.set(result.id, result);
      this.emit('research-result', result);
      logger.info('Research completed', { query: topic.query, factsFound: result.facts.length });
    } finally {
      clearTimeout(timeoutId);
      this.currentResearch = null;
    }
  }

  private async performResearch(topic: ResearchTopic, signal: AbortSignal): Promise<ResearchResult> {
    // Check for abort
    if (signal.aborted) {
      throw new Error('Research aborted');
    }

    // For now, create a placeholder result
    // In production, this would:
    // 1. Call web search API or LLM
    // 2. Parse and summarize results
    // 3. Extract facts
    const result: ResearchResult = {
      id: this.generateId(),
      topicId: topic.id,
      query: topic.query,
      summary: `Researched: ${topic.query}. [Placeholder - would contain actual research summary from LLM or search APIs]`,
      facts: [
        `This is a placeholder fact about "${topic.query}"`,
        `Research would extract key information from multiple sources`,
      ],
      sources: [],
      confidence: 0.7,
      researchedAt: Date.now(),
      expiresAt: Date.now() + this.config.resultExpirationMs,
    };

    // Simulate async research time
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(resolve, 1000);
      signal.addEventListener('abort', () => {
        clearTimeout(timeout);
        reject(new Error('Research aborted'));
      });
    });

    return result;
  }

  private pauseResearch(): void {
    if (this.state !== 'researching') return;

    this.state = 'paused';
    this.abortCurrentResearch();
    this.emit('research-paused');
    logger.info('Research paused due to user activity');
  }

  private abortCurrentResearch(): void {
    if (this.currentResearch?.abortController) {
      this.currentResearch.abortController.abort();
      this.currentResearch = null;
    }
  }

  private handleUserActivity(): void {
    this.lastActivityTime = Date.now();
    if (this.state === 'researching') {
      this.pauseResearch();
    }
  }

  private calculatePriority(query: string, source: ResearchTopic['source']): ResearchTopic['priority'] {
    // Higher priority for explicit requests
    if (source === 'user_interest') return 'high';
    if (source === 'scheduled') return 'high';
    if (source === 'follow_up') return 'medium';

    // Check query indicators
    const lowerQuery = query.toLowerCase();
    if (lowerQuery.includes('important') || lowerQuery.includes('urgent')) return 'high';
    if (lowerQuery.includes('when') || lowerQuery.includes('deadline')) return 'high';

    return 'medium';
  }

  private priorityValue(priority: ResearchTopic['priority']): number {
    switch (priority) {
      case 'high': return 3;
      case 'medium': return 2;
      case 'low': return 1;
      default: return 0;
    }
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }
}

// Singleton instance
let researchManager: BackgroundResearchManager | null = null;

/**
 * Get or create the background research manager
 */
export function getBackgroundResearchManager(): BackgroundResearchManager {
  if (!researchManager) {
    researchManager = new BackgroundResearchManager();
  }
  return researchManager;
}

/**
 * Shutdown the background research manager
 */
export function shutdownBackgroundResearchManager(): void {
  if (researchManager) {
    researchManager.stop();
    researchManager = null;
  }
}

export default BackgroundResearchManager;
