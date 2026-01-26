/**
 * Atlas Desktop - Background Researcher
 * Performs background research during idle time on topics Ben is working on
 * Stores findings in Obsidian vault for later reference
 */

import { EventEmitter } from 'events';
import * as fse from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import { format } from 'date-fns';
import { createModuleLogger } from '../utils/logger';
import { createNote, readNote } from '../memory/note-writer';
import { getVaultPath } from '../memory/obsidian-brain';

const logger = createModuleLogger('BackgroundResearcher');

// =============================================================================
// Types and Interfaces
// =============================================================================

/**
 * Priority level for research topics
 */
export type ResearchPriority = 'low' | 'normal' | 'high';

/**
 * Source of the research topic
 */
export type TopicSource = 'conversation' | 'code' | 'manual';

/**
 * Source type for research findings
 */
export type SourceType = 'documentation' | 'article' | 'stackoverflow' | 'github' | 'other';

/**
 * A queued research topic
 */
export interface QueuedTopic {
  id: string;
  topic: string;
  priority: ResearchPriority;
  queuedAt: Date;
  source: TopicSource;
  context?: string;
}

/**
 * A source reference for research findings
 */
export interface Source {
  title: string;
  url?: string;
  type: SourceType;
  relevance: number;
}

/**
 * Result of background research
 */
export interface ResearchResult {
  id: string;
  topic: string;
  summary: string;
  keyPoints: string[];
  sources: Source[];
  relatedTopics: string[];
  researchedAt: Date;
  confidence: number;
  notePath?: string;
}

/**
 * Research offer for proactive suggestions
 */
export interface ResearchOffer {
  topic: string;
  teaser: string;
  relevance: number;
  resultId: string;
}

/**
 * Idle state tracking
 */
interface IdleState {
  lastVoiceInteraction: number;
  lastActiveTask: number;
  inFocusMode: boolean;
  workHoursStart: number;
  workHoursEnd: number;
}

/**
 * Configuration for the researcher
 */
export interface ResearcherConfig {
  /** Minimum idle time before research starts (ms) */
  minIdleTimeMs: number;
  /** Maximum time per research topic (ms) */
  maxResearchTimeMs: number;
  /** Maximum topics to research per session */
  maxTopicsPerSession: number;
  /** Work hours start (0-23) */
  workHoursStart: number;
  /** Work hours end (0-23) */
  workHoursEnd: number;
  /** Enable proactive research offers */
  enableProactiveOffers: boolean;
  /** Minimum relevance score for offers */
  minOfferRelevance: number;
}

/**
 * Researcher events
 */
export interface ResearcherEvents {
  'research-started': (topic: string) => void;
  'research-completed': (result: ResearchResult) => void;
  'research-failed': (topic: string, error: Error) => void;
  'topic-queued': (topic: QueuedTopic) => void;
  'idle-research-started': () => void;
  'idle-research-completed': (count: number) => void;
  'offer-available': (offer: ResearchOffer) => void;
  error: (error: Error) => void;
}

/**
 * BackgroundResearcher interface
 */
export interface BackgroundResearcher {
  queueResearch(topic: string, priority: ResearchPriority): void;
  runIdleResearch(): Promise<ResearchResult>;
  getResearch(topic: string): ResearchResult | null;
  shouldRunResearch(): boolean;
  getResearchQueue(): QueuedTopic[];
  hasRelevantResearch(context: string): ResearchOffer | null;
}

// =============================================================================
// Default Configuration
// =============================================================================

const DEFAULT_CONFIG: ResearcherConfig = {
  minIdleTimeMs: 5 * 60 * 1000, // 5 minutes
  maxResearchTimeMs: 2 * 60 * 1000, // 2 minutes per topic
  maxTopicsPerSession: 3,
  workHoursStart: 8,
  workHoursEnd: 22,
  enableProactiveOffers: true,
  minOfferRelevance: 0.6,
};

const QUEUE_FILE_PATH = path.join(os.homedir(), '.atlas', 'brain', 'research', 'queue.json');
// Results are stored in Obsidian vault at ~/.atlas/brain/research/

// =============================================================================
// BackgroundResearcherImpl Class
// =============================================================================

/**
 * Implementation of the BackgroundResearcher
 * Handles idle-time research on topics Ben is working on
 */
export class BackgroundResearcherImpl extends EventEmitter implements BackgroundResearcher {
  private config: ResearcherConfig;
  private queue: QueuedTopic[] = [];
  private results: Map<string, ResearchResult> = new Map();
  private idleState: IdleState;
  private isResearching: boolean = false;
  private researchAbortController: AbortController | null = null;

  constructor(config?: Partial<ResearcherConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.idleState = {
      lastVoiceInteraction: Date.now(),
      lastActiveTask: Date.now(),
      inFocusMode: false,
      workHoursStart: this.config.workHoursStart,
      workHoursEnd: this.config.workHoursEnd,
    };

    // Load persisted queue
    this.loadQueue();

    // Load cached results
    this.loadCachedResults();

    logger.info('BackgroundResearcher initialized', {
      queueSize: this.queue.length,
      cachedResults: this.results.size,
    });
  }

  // ===========================================================================
  // Public API
  // ===========================================================================

  /**
   * Queue a topic for research
   */
  queueResearch(
    topic: string,
    priority: ResearchPriority,
    source: TopicSource = 'manual',
    context?: string
  ): void {
    // Normalize topic
    const normalizedTopic = this.normalizeTopic(topic);

    // Check for duplicates
    if (this.isDuplicate(normalizedTopic)) {
      logger.debug('Topic already in queue or researched', { topic: normalizedTopic });
      return;
    }

    const queuedTopic: QueuedTopic = {
      id: this.generateId(),
      topic: normalizedTopic,
      priority,
      queuedAt: new Date(),
      source,
      context,
    };

    // Insert in priority order
    this.insertByPriority(queuedTopic);

    // Persist queue
    this.saveQueue();

    this.emit('topic-queued', queuedTopic);
    logger.info('Research topic queued', {
      topic: normalizedTopic,
      priority,
      source,
      queueSize: this.queue.length,
    });
  }

  /**
   * Run research during idle time
   * Returns the result of the first successfully researched topic
   */
  async runIdleResearch(): Promise<ResearchResult> {
    if (!this.shouldRunResearch()) {
      throw new Error('Research conditions not met');
    }

    if (this.queue.length === 0) {
      throw new Error('No topics in queue');
    }

    this.isResearching = true;
    this.emit('idle-research-started');
    logger.info('Starting idle research session');

    let completedCount = 0;
    let lastResult: ResearchResult | null = null;

    try {
      const topicsToResearch = Math.min(this.config.maxTopicsPerSession, this.queue.length);

      for (let i = 0; i < topicsToResearch; i++) {
        // Check if we should continue
        if (!this.shouldRunResearch()) {
          logger.info('Research interrupted - conditions no longer met');
          break;
        }

        const topic = this.queue[0];
        if (!topic) break;

        try {
          const result = await this.researchTopic(topic);
          lastResult = result;
          completedCount++;

          // Remove from queue
          this.queue.shift();
          this.saveQueue();
        } catch (error) {
          logger.error('Failed to research topic', {
            topic: topic.topic,
            error: (error as Error).message,
          });
          this.emit('research-failed', topic.topic, error as Error);

          // Move to end of queue for retry
          this.queue.shift();
          this.queue.push({ ...topic, queuedAt: new Date() });
          this.saveQueue();
        }
      }
    } finally {
      this.isResearching = false;
      this.emit('idle-research-completed', completedCount);
      logger.info('Idle research session completed', { topicsResearched: completedCount });
    }

    if (!lastResult) {
      throw new Error('No research completed');
    }

    return lastResult;
  }

  /**
   * Get research result for a topic
   */
  getResearch(topic: string): ResearchResult | null {
    const normalizedTopic = this.normalizeTopic(topic);

    // Check in-memory cache
    const results = Array.from(this.results.values());
    for (const result of results) {
      if (this.topicMatches(result.topic, normalizedTopic)) {
        return result;
      }
    }

    return null;
  }

  /**
   * Check if idle research should run
   */
  shouldRunResearch(): boolean {
    const now = Date.now();
    const currentHour = new Date().getHours();

    // Check idle time (no voice for 5+ minutes)
    const idleTime = now - this.idleState.lastVoiceInteraction;
    if (idleTime < this.config.minIdleTimeMs) {
      return false;
    }

    // Check for active tasks
    const taskIdleTime = now - this.idleState.lastActiveTask;
    if (taskIdleTime < this.config.minIdleTimeMs) {
      return false;
    }

    // Check focus mode
    if (this.idleState.inFocusMode) {
      return false;
    }

    // Check work hours
    if (currentHour < this.idleState.workHoursStart || currentHour >= this.idleState.workHoursEnd) {
      return false;
    }

    // Check if already researching
    if (this.isResearching) {
      return false;
    }

    // Check queue
    if (this.queue.length === 0) {
      return false;
    }

    return true;
  }

  /**
   * Get the current research queue
   */
  getResearchQueue(): QueuedTopic[] {
    return [...this.queue];
  }

  /**
   * Check for relevant research to offer
   */
  hasRelevantResearch(context: string): ResearchOffer | null {
    if (!this.config.enableProactiveOffers) {
      return null;
    }

    const contextWords = this.extractKeywords(context.toLowerCase());
    let bestMatch: { result: ResearchResult; relevance: number } | null = null;

    const results = Array.from(this.results.values());
    for (const result of results) {
      const relevance = this.calculateRelevance(result, contextWords);

      if (relevance >= this.config.minOfferRelevance) {
        if (!bestMatch || relevance > bestMatch.relevance) {
          bestMatch = { result, relevance };
        }
      }
    }

    if (!bestMatch) {
      return null;
    }

    const offer: ResearchOffer = {
      topic: bestMatch.result.topic,
      teaser: this.generateTeaser(bestMatch.result),
      relevance: bestMatch.relevance,
      resultId: bestMatch.result.id,
    };

    this.emit('offer-available', offer);
    return offer;
  }

  // ===========================================================================
  // State Management
  // ===========================================================================

  /**
   * Update last voice interaction time
   */
  recordVoiceInteraction(): void {
    this.idleState.lastVoiceInteraction = Date.now();
  }

  /**
   * Update last active task time
   */
  recordActiveTask(): void {
    this.idleState.lastActiveTask = Date.now();
  }

  /**
   * Set focus mode
   */
  setFocusMode(enabled: boolean): void {
    this.idleState.inFocusMode = enabled;
    logger.debug('Focus mode updated', { enabled });
  }

  /**
   * Update work hours
   */
  setWorkHours(start: number, end: number): void {
    this.idleState.workHoursStart = start;
    this.idleState.workHoursEnd = end;
    logger.debug('Work hours updated', { start, end });
  }

  /**
   * Cancel ongoing research
   */
  cancelResearch(): void {
    if (this.researchAbortController) {
      this.researchAbortController.abort();
      this.researchAbortController = null;
    }
    this.isResearching = false;
    logger.info('Research cancelled');
  }

  /**
   * Clear the research queue
   */
  clearQueue(): void {
    this.queue = [];
    this.saveQueue();
    logger.info('Research queue cleared');
  }

  /**
   * Get all cached research results
   */
  getAllResults(): ResearchResult[] {
    return Array.from(this.results.values());
  }

  // ===========================================================================
  // Topic Extraction (from conversation context)
  // ===========================================================================

  /**
   * Extract research topics from conversation
   */
  extractTopicsFromConversation(userMessage: string, atlasResponse: string): string[] {
    const text = `${userMessage} ${atlasResponse}`.toLowerCase();
    const topics: string[] = [];

    // Patterns for extracting research-worthy topics
    const patterns = [
      // Questions about how things work
      /how (?:does|do|can|to) (.+?)(?:\?|$)/gi,
      // Questions about what something is
      /what (?:is|are) (.+?)(?:\?|$)/gi,
      // Questions about why
      /why (?:does|do|is|are) (.+?)(?:\?|$)/gi,
      // Error-related queries
      /(?:error|issue|problem|bug) (?:with|in|about) (.+?)(?:\.|$)/gi,
      // Technology mentions
      /(?:using|implement|work with) (.+?) (?:to|for|in)/gi,
      // Best practices queries
      /(?:best practice|pattern|approach) (?:for|with) (.+?)(?:\?|$)/gi,
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const topic = match[1]?.trim();
        if (topic && topic.length > 3 && topic.length < 100) {
          topics.push(topic);
        }
      }
    }

    // Deduplicate
    return Array.from(new Set(topics));
  }

  /**
   * Extract research topics from code context
   */
  extractTopicsFromCode(code: string, language: string): string[] {
    const topics: string[] = [];

    // Common patterns in code that might need research
    const codePatterns: Record<string, RegExp[]> = {
      typescript: [
        /import\s+.*\s+from\s+['"]([^'"]+)['"]/g,
        /new\s+([A-Z][a-zA-Z]+)/g,
        /extends\s+([A-Z][a-zA-Z]+)/g,
        /implements\s+([A-Z][a-zA-Z]+)/g,
      ],
      javascript: [
        /require\(['"]([^'"]+)['"]\)/g,
        /import\s+.*\s+from\s+['"]([^'"]+)['"]/g,
        /new\s+([A-Z][a-zA-Z]+)/g,
      ],
      python: [/import\s+(\w+)/g, /from\s+(\w+)\s+import/g, /class\s+\w+\(([A-Z][a-zA-Z]+)\)/g],
    };

    const patterns = codePatterns[language.toLowerCase()] || [];
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(code)) !== null) {
        const topic = match[1]?.trim();
        if (topic && topic.length > 2 && !topic.startsWith('.')) {
          topics.push(topic);
        }
      }
    }

    return Array.from(new Set(topics));
  }

  // ===========================================================================
  // Private Methods - Research
  // ===========================================================================

  /**
   * Research a single topic
   */
  private async researchTopic(queuedTopic: QueuedTopic): Promise<ResearchResult> {
    const { topic, context } = queuedTopic;

    logger.info('Researching topic', { topic });
    this.emit('research-started', topic);

    this.researchAbortController = new AbortController();
    const { signal } = this.researchAbortController;

    try {
      // Set timeout
      const timeout = setTimeout(() => {
        this.researchAbortController?.abort();
      }, this.config.maxResearchTimeMs);

      try {
        // Generate search queries
        const queries = this.generateSearchQueries(topic, context);

        // Perform research (simulated - in production would call APIs)
        const researchData = await this.performResearch(queries, signal);

        // Create research result
        const result: ResearchResult = {
          id: this.generateId(),
          topic,
          summary: researchData.summary,
          keyPoints: researchData.keyPoints,
          sources: researchData.sources,
          relatedTopics: researchData.relatedTopics,
          researchedAt: new Date(),
          confidence: researchData.confidence,
        };

        // Store in Obsidian vault
        const notePath = await this.storeToVault(result, context);
        result.notePath = notePath;

        // Cache result
        this.results.set(result.id, result);

        this.emit('research-completed', result);
        logger.info('Research completed', {
          topic,
          keyPoints: result.keyPoints.length,
          sources: result.sources.length,
        });

        return result;
      } finally {
        clearTimeout(timeout);
      }
    } finally {
      this.researchAbortController = null;
    }
  }

  /**
   * Generate search queries for a topic
   */
  private generateSearchQueries(topic: string, context?: string): string[] {
    const queries: string[] = [
      topic,
      `${topic} best practices`,
      `${topic} tutorial`,
      `${topic} examples`,
    ];

    if (context) {
      queries.push(`${topic} ${context}`);
    }

    return queries;
  }

  /**
   * Perform the actual research
   * In production, this would call web search APIs, LLM, etc.
   */
  private async performResearch(
    queries: string[],
    signal: AbortSignal
  ): Promise<{
    summary: string;
    keyPoints: string[];
    sources: Source[];
    relatedTopics: string[];
    confidence: number;
  }> {
    // Check abort
    if (signal.aborted) {
      throw new Error('Research aborted');
    }

    // Simulate research delay
    await this.delay(1000, signal);

    // In production, this would:
    // 1. Call web search API (Perplexity, Google, etc.)
    // 2. Call LLM to summarize findings
    // 3. Extract key points and related topics
    // 4. Verify source credibility

    const topic = queries[0];

    return {
      summary: `Research findings for "${topic}". This would contain a comprehensive summary of the topic based on multiple sources, covering key concepts, best practices, and practical applications.`,
      keyPoints: [
        `Key concept 1 related to ${topic}`,
        `Important consideration when working with ${topic}`,
        `Common pattern or best practice for ${topic}`,
        `Potential pitfall to avoid with ${topic}`,
      ],
      sources: [
        {
          title: `Official Documentation - ${topic}`,
          url: `https://docs.example.com/${topic.toLowerCase().replace(/\s+/g, '-')}`,
          type: 'documentation' as SourceType,
          relevance: 0.95,
        },
        {
          title: `${topic} Best Practices - Stack Overflow`,
          url: `https://stackoverflow.com/questions/tagged/${topic.toLowerCase().replace(/\s+/g, '-')}`,
          type: 'stackoverflow' as SourceType,
          relevance: 0.85,
        },
        {
          title: `Understanding ${topic} - Developer Blog`,
          url: `https://blog.example.com/${topic.toLowerCase().replace(/\s+/g, '-')}`,
          type: 'article' as SourceType,
          relevance: 0.75,
        },
      ],
      relatedTopics: [`${topic} patterns`, `${topic} alternatives`, `Advanced ${topic}`],
      confidence: 0.8,
    };
  }

  /**
   * Store research result to Obsidian vault
   */
  private async storeToVault(result: ResearchResult, context?: string): Promise<string> {
    const timestamp = format(result.researchedAt, "MMMM d, yyyy 'at' h:mm a");

    // Build key points section
    const keyPointsSection = result.keyPoints.map((point) => `- ${point}`).join('\n');

    // Build sources section
    const sourcesSection = result.sources
      .map((source) => {
        const urlPart = source.url ? `(${source.url})` : '';
        return `- [${source.title}]${urlPart} - ${source.type}`;
      })
      .join('\n');

    // Build related topics section with wiki-style links
    const relatedTopicsSection = result.relatedTopics.map((topic) => `- [[${topic}]]`).join('\n');

    // Build context section
    const contextSection = context ? `\n## Context\n\n${context}\n` : '';

    // Build note content
    const content = `**Researched:** ${timestamp}
${contextSection}
## Summary

${result.summary}

## Key Points

${keyPointsSection}

## Relevant Code Patterns

\`\`\`typescript
// Example code pattern for ${result.topic}
// This section would contain relevant code examples
\`\`\`

## Sources

${sourcesSection}

## Related Topics

${relatedTopicsSection}

---

*Confidence: ${Math.round(result.confidence * 100)}%*

#research #background-research
`;

    // Create note in Obsidian vault
    const notePath = await createNote(
      'research',
      `Research-${result.topic}`,
      content,
      {
        type: 'research',
        topic: result.topic,
        confidence: result.confidence,
        sources_count: result.sources.length,
        researched_at: result.researchedAt.toISOString(),
      },
      {
        overwrite: true,
        tags: ['research', 'background-research', ...result.relatedTopics.slice(0, 3)],
      }
    );

    logger.info('Research stored to vault', { notePath, topic: result.topic });
    return notePath;
  }

  // ===========================================================================
  // Private Methods - Queue Management
  // ===========================================================================

  /**
   * Insert topic in priority order
   */
  private insertByPriority(topic: QueuedTopic): void {
    const priorityOrder: Record<ResearchPriority, number> = {
      high: 3,
      normal: 2,
      low: 1,
    };

    const insertIndex = this.queue.findIndex(
      (t) => priorityOrder[t.priority] < priorityOrder[topic.priority]
    );

    if (insertIndex === -1) {
      this.queue.push(topic);
    } else {
      this.queue.splice(insertIndex, 0, topic);
    }
  }

  /**
   * Check if topic is duplicate
   */
  private isDuplicate(topic: string): boolean {
    // Check queue
    const inQueue = this.queue.some((t) => this.topicMatches(t.topic, topic));
    if (inQueue) return true;

    // Check results
    const results = Array.from(this.results.values());
    for (const result of results) {
      if (this.topicMatches(result.topic, topic)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if two topics match
   */
  private topicMatches(topic1: string, topic2: string): boolean {
    const normalized1 = this.normalizeTopic(topic1);
    const normalized2 = this.normalizeTopic(topic2);
    return normalized1 === normalized2;
  }

  /**
   * Normalize a topic string
   */
  private normalizeTopic(topic: string): string {
    return topic.toLowerCase().trim().replace(/\s+/g, ' ');
  }

  /**
   * Load queue from file
   */
  private async loadQueue(): Promise<void> {
    try {
      if (await fse.pathExists(QUEUE_FILE_PATH)) {
        const data = await fse.readJson(QUEUE_FILE_PATH);
        this.queue = (data.queue || []).map((item: QueuedTopic) => ({
          ...item,
          queuedAt: new Date(item.queuedAt),
        }));
        logger.debug('Queue loaded', { size: this.queue.length });
      }
    } catch (error) {
      logger.warn('Failed to load queue', { error: (error as Error).message });
      this.queue = [];
    }
  }

  /**
   * Save queue to file
   */
  private async saveQueue(): Promise<void> {
    try {
      await fse.ensureDir(path.dirname(QUEUE_FILE_PATH));
      await fse.writeJson(QUEUE_FILE_PATH, { queue: this.queue }, { spaces: 2 });
      logger.debug('Queue saved', { size: this.queue.length });
    } catch (error) {
      logger.warn('Failed to save queue', { error: (error as Error).message });
    }
  }

  /**
   * Load cached results from vault
   */
  private async loadCachedResults(): Promise<void> {
    try {
      const vaultPath = getVaultPath();
      const researchDir = path.join(vaultPath, 'research');

      if (!(await fse.pathExists(researchDir))) {
        return;
      }

      const files = await fse.readdir(researchDir);
      for (const file of files) {
        if (!file.startsWith('Research-') || !file.endsWith('.md')) continue;

        try {
          const notePath = path.join('research', file);
          const note = await readNote(notePath);

          if (note?.metadata?.type === 'research') {
            const result: ResearchResult = {
              id: this.generateId(),
              topic:
                (note.metadata.topic as string) || file.replace('Research-', '').replace('.md', ''),
              summary: this.extractSummaryFromContent(note.content),
              keyPoints: this.extractKeyPointsFromContent(note.content),
              sources: [],
              relatedTopics: [],
              researchedAt: new Date((note.metadata.researched_at as string) || Date.now()),
              confidence: (note.metadata.confidence as number) || 0.7,
              notePath,
            };

            this.results.set(result.id, result);
          }
        } catch (error) {
          logger.debug('Failed to load cached result', { file, error: (error as Error).message });
        }
      }

      logger.debug('Cached results loaded', { count: this.results.size });
    } catch (error) {
      logger.warn('Failed to load cached results', { error: (error as Error).message });
    }
  }

  /**
   * Extract summary from note content
   */
  private extractSummaryFromContent(content: string): string {
    const summaryMatch = content.match(/## Summary\s*\n\n([\s\S]*?)(?=\n##|$)/);
    return summaryMatch?.[1]?.trim() || '';
  }

  /**
   * Extract key points from note content
   */
  private extractKeyPointsFromContent(content: string): string[] {
    const keyPointsMatch = content.match(/## Key Points\s*\n\n([\s\S]*?)(?=\n##|$)/);
    if (!keyPointsMatch) return [];

    return keyPointsMatch[1]
      .split('\n')
      .filter((line) => line.startsWith('- '))
      .map((line) => line.replace(/^- /, '').trim());
  }

  // ===========================================================================
  // Private Methods - Relevance
  // ===========================================================================

  /**
   * Calculate relevance of a result to context
   */
  private calculateRelevance(result: ResearchResult, contextWords: string[]): number {
    const topicWords = this.extractKeywords(result.topic.toLowerCase());
    const keyPointWords = result.keyPoints.flatMap((kp) => this.extractKeywords(kp.toLowerCase()));

    const allResultWords = Array.from(new Set([...topicWords, ...keyPointWords]));

    // Calculate overlap
    const overlap = contextWords.filter((word) =>
      allResultWords.some((rw) => rw.includes(word) || word.includes(rw))
    );

    if (overlap.length === 0) return 0;

    // Calculate relevance score
    const precision = overlap.length / contextWords.length;
    const recall = overlap.length / allResultWords.length;

    if (precision + recall === 0) return 0;

    // F1 score
    return (2 * precision * recall) / (precision + recall);
  }

  /**
   * Extract keywords from text
   */
  private extractKeywords(text: string): string[] {
    const stopWords = new Set([
      'the',
      'a',
      'an',
      'is',
      'are',
      'was',
      'were',
      'be',
      'been',
      'being',
      'have',
      'has',
      'had',
      'do',
      'does',
      'did',
      'will',
      'would',
      'could',
      'should',
      'may',
      'might',
      'must',
      'shall',
      'can',
      'to',
      'of',
      'in',
      'for',
      'on',
      'with',
      'at',
      'by',
      'from',
      'as',
      'into',
      'through',
      'during',
      'before',
      'after',
      'above',
      'below',
      'between',
      'under',
      'again',
      'further',
      'then',
      'once',
      'here',
      'there',
      'when',
      'where',
      'why',
      'how',
      'all',
      'each',
      'few',
      'more',
      'most',
      'other',
      'some',
      'such',
      'no',
      'nor',
      'not',
      'only',
      'own',
      'same',
      'so',
      'than',
      'too',
      'very',
      'just',
      'and',
      'but',
      'if',
      'or',
      'because',
      'until',
      'while',
      'this',
      'that',
      'these',
      'those',
    ]);

    return text.split(/\W+/).filter((word) => word.length > 2 && !stopWords.has(word));
  }

  /**
   * Generate a teaser for research offer
   */
  private generateTeaser(result: ResearchResult): string {
    const keyPoint = result.keyPoints[0] || result.summary.slice(0, 100);
    return `I found some interesting info about ${result.topic}. ${keyPoint.slice(0, 80)}...`;
  }

  // ===========================================================================
  // Private Methods - Utilities
  // ===========================================================================

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }

  /**
   * Delay with abort signal support
   */
  private delay(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(resolve, ms);
      signal?.addEventListener('abort', () => {
        clearTimeout(timeout);
        reject(new Error('Aborted'));
      });
    });
  }

  // ===========================================================================
  // Event Emitter Type Safety
  // ===========================================================================

  on<K extends keyof ResearcherEvents>(event: K, listener: ResearcherEvents[K]): this {
    return super.on(event, listener);
  }

  off<K extends keyof ResearcherEvents>(event: K, listener: ResearcherEvents[K]): this {
    return super.off(event, listener);
  }

  emit<K extends keyof ResearcherEvents>(
    event: K,
    ...args: Parameters<ResearcherEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }
}

// =============================================================================
// Singleton Export
// =============================================================================

let researcherInstance: BackgroundResearcherImpl | null = null;

/**
 * Get or create the BackgroundResearcher singleton
 */
export function getBackgroundResearcher(
  config?: Partial<ResearcherConfig>
): BackgroundResearcherImpl {
  if (!researcherInstance) {
    researcherInstance = new BackgroundResearcherImpl(config);
  }
  return researcherInstance;
}

/**
 * Shutdown the BackgroundResearcher
 */
export function shutdownBackgroundResearcher(): void {
  if (researcherInstance) {
    researcherInstance.cancelResearch();
    researcherInstance.removeAllListeners();
    researcherInstance = null;
    logger.info('BackgroundResearcher shutdown');
  }
}

export default BackgroundResearcherImpl;
