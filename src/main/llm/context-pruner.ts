/**
 * Dynamic Context Pruner
 *
 * Intelligently prunes conversation context based on importance scoring.
 * Keeps the most relevant messages within token limits.
 *
 * Scoring Factors:
 * 1. Recency - Recent messages score higher
 * 2. Tool calls - Messages with tool results score higher
 * 3. User messages - User messages score higher than assistant
 * 4. Keywords - Messages with important keywords score higher
 * 5. References - Messages referenced later score higher
 * 6. Code blocks - Messages with code score higher
 * 7. Decisions - Messages with decisions/conclusions score higher
 *
 * Expected Impact:
 * - +20% more context utilization
 * - Fewer "forgot earlier context" issues
 * - Better long conversation coherence
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('ContextPruner');

// =============================================================================
// Types
// =============================================================================

export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp?: number;
  toolName?: string;
  toolCallId?: string;
  metadata?: {
    hasCode?: boolean;
    hasTool?: boolean;
    isDecision?: boolean;
    topics?: string[];
    tokenCount?: number;
  };
}

export interface ScoredMessage {
  message: ConversationMessage;
  index: number;
  score: number;
  scoreBreakdown: ScoreBreakdown;
  tokenEstimate: number;
  keep: boolean;
}

export interface ScoreBreakdown {
  recency: number;
  toolUsage: number;
  roleWeight: number;
  keywordMatch: number;
  codePresence: number;
  decisionIndicator: number;
  referenceBoost: number;
  total: number;
}

export interface PruneResult {
  originalMessages: ConversationMessage[];
  prunedMessages: ConversationMessage[];
  removedMessages: ConversationMessage[];
  originalTokens: number;
  prunedTokens: number;
  tokensSaved: number;
  keepRatio: number;
  scoredMessages: ScoredMessage[];
}

export interface PrunerConfig {
  /** Maximum tokens to keep in context */
  maxTokens: number;
  /** Reserved tokens for system prompt */
  systemPromptReserve: number;
  /** Reserved tokens for response */
  responseReserve: number;
  /** Always keep last N messages regardless of score */
  alwaysKeepLast: number;
  /** Always keep first message (usually system prompt) */
  keepFirst: boolean;
  /** Scoring weights */
  weights: {
    recency: number;
    toolUsage: number;
    userMessage: number;
    assistantMessage: number;
    keyword: number;
    code: number;
    decision: number;
    reference: number;
  };
  /** Important keywords that boost score */
  importantKeywords: string[];
  /** Decision indicator phrases */
  decisionIndicators: string[];
}

// =============================================================================
// Default Configuration
// =============================================================================

const DEFAULT_CONFIG: PrunerConfig = {
  maxTokens: 8000,
  systemPromptReserve: 1000,
  responseReserve: 2000,
  alwaysKeepLast: 4,
  keepFirst: true,
  weights: {
    recency: 1.5,
    toolUsage: 2.0,
    userMessage: 1.5,
    assistantMessage: 1.0,
    keyword: 1.5,
    code: 1.8,
    decision: 2.0,
    reference: 1.3,
  },
  importantKeywords: [
    // Technical
    'error', 'bug', 'fix', 'issue', 'problem', 'solution', 'implement',
    'create', 'update', 'delete', 'modify', 'change', 'add', 'remove',
    // Files/Code
    'file', 'code', 'function', 'class', 'method', 'variable',
    // Actions
    'commit', 'push', 'deploy', 'test', 'build', 'run',
    // Importance
    'important', 'critical', 'urgent', 'must', 'should', 'need',
    // Trading
    'trade', 'position', 'stop', 'profit', 'loss', 'buy', 'sell',
    // Decisions
    'decided', 'confirmed', 'agreed', 'approved', 'chosen',
  ],
  decisionIndicators: [
    "let's go with",
    "i'll do",
    "we'll use",
    "decided to",
    "confirmed",
    "approved",
    "the plan is",
    "going to",
    "will implement",
    "yes, do it",
    "sounds good",
    "perfect",
    "that works",
  ],
};

// =============================================================================
// Token Estimation
// =============================================================================

/**
 * Estimate token count for a message.
 * Rough approximation: ~4 characters per token for English.
 */
function estimateTokens(content: string): number {
  if (!content) return 0;
  
  // More accurate estimation considering:
  // - Average English word is ~4.5 characters
  // - Average token is ~4 characters
  // - Whitespace and punctuation add overhead
  
  const words = content.split(/\s+/).length;
  const chars = content.length;
  
  // Use combination of word count and character count
  const wordBasedEstimate = words * 1.3; // ~1.3 tokens per word
  const charBasedEstimate = chars / 4; // ~4 chars per token
  
  // Average both estimates
  return Math.ceil((wordBasedEstimate + charBasedEstimate) / 2);
}

// =============================================================================
// Context Pruner Class
// =============================================================================

export class ContextPruner extends EventEmitter {
  private config: PrunerConfig;
  private pruneHistory: PruneResult[] = [];
  private readonly MAX_HISTORY = 20;

  constructor(config: Partial<PrunerConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    logger.info('ContextPruner initialized', {
      maxTokens: this.config.maxTokens,
      alwaysKeepLast: this.config.alwaysKeepLast,
    });
  }

  /**
   * Prune messages to fit within token limit while preserving importance
   */
  prune(messages: ConversationMessage[]): PruneResult {
    if (messages.length === 0) {
      return this.createEmptyResult();
    }

    // Calculate available tokens
    const availableTokens = this.config.maxTokens -
      this.config.systemPromptReserve -
      this.config.responseReserve;

    // Score all messages
    const scoredMessages = this.scoreMessages(messages);

    // Calculate total tokens
    const totalTokens = scoredMessages.reduce((sum, m) => sum + m.tokenEstimate, 0);

    // If under limit, keep everything
    if (totalTokens <= availableTokens) {
      scoredMessages.forEach(m => m.keep = true);
      return this.createResult(messages, scoredMessages, totalTokens);
    }

    // Mark messages to keep
    this.markMessagesToKeep(scoredMessages, availableTokens);

    // Build pruned message list
    const prunedMessages: ConversationMessage[] = [];
    const removedMessages: ConversationMessage[] = [];
    let prunedTokens = 0;

    for (const scored of scoredMessages) {
      if (scored.keep) {
        prunedMessages.push(scored.message);
        prunedTokens += scored.tokenEstimate;
      } else {
        removedMessages.push(scored.message);
      }
    }

    const result = this.createResult(
      messages,
      scoredMessages,
      totalTokens,
      prunedMessages,
      removedMessages,
      prunedTokens
    );

    // Store in history
    this.pruneHistory.push(result);
    if (this.pruneHistory.length > this.MAX_HISTORY) {
      this.pruneHistory.shift();
    }

    // Emit event
    this.emit('pruned', result);

    logger.info('Context pruned', {
      originalMessages: messages.length,
      prunedMessages: prunedMessages.length,
      removed: removedMessages.length,
      tokensSaved: result.tokensSaved,
    });

    return result;
  }

  /**
   * Score all messages based on importance factors
   */
  private scoreMessages(messages: ConversationMessage[]): ScoredMessage[] {
    const scored: ScoredMessage[] = [];
    const now = Date.now();
    const totalMessages = messages.length;

    // First pass: basic scoring
    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      const content = message.content.toLowerCase();

      // Calculate individual scores
      const recencyScore = this.calculateRecencyScore(i, totalMessages, message.timestamp, now);
      const toolScore = this.calculateToolScore(message);
      const roleScore = this.calculateRoleScore(message);
      const keywordScore = this.calculateKeywordScore(content);
      const codeScore = this.calculateCodeScore(content);
      const decisionScore = this.calculateDecisionScore(content);

      const breakdown: ScoreBreakdown = {
        recency: recencyScore,
        toolUsage: toolScore,
        roleWeight: roleScore,
        keywordMatch: keywordScore,
        codePresence: codeScore,
        decisionIndicator: decisionScore,
        referenceBoost: 0, // Calculated in second pass
        total: 0,
      };

      scored.push({
        message,
        index: i,
        score: 0,
        scoreBreakdown: breakdown,
        tokenEstimate: estimateTokens(message.content),
        keep: false,
      });
    }

    // Second pass: reference boost (messages that are referenced later)
    this.calculateReferenceBoosts(scored);

    // Calculate final scores
    for (const s of scored) {
      const b = s.scoreBreakdown;
      b.total = (
        b.recency * this.config.weights.recency +
        b.toolUsage * this.config.weights.toolUsage +
        b.roleWeight +
        b.keywordMatch * this.config.weights.keyword +
        b.codePresence * this.config.weights.code +
        b.decisionIndicator * this.config.weights.decision +
        b.referenceBoost * this.config.weights.reference
      );
      s.score = b.total;
    }

    return scored;
  }

  /**
   * Calculate recency score (0-1, higher = more recent)
   */
  private calculateRecencyScore(
    index: number,
    total: number,
    timestamp: number | undefined,
    now: number
  ): number {
    // Position-based score (linear decay from end)
    const positionScore = (index + 1) / total;

    // Time-based score if available (exponential decay)
    if (timestamp) {
      const ageMinutes = (now - timestamp) / 60000;
      const timeScore = Math.exp(-ageMinutes / 60); // 1-hour half-life
      return (positionScore + timeScore) / 2;
    }

    return positionScore;
  }

  /**
   * Calculate tool usage score
   */
  private calculateToolScore(message: ConversationMessage): number {
    if (message.role === 'tool') return 2.0;
    if (message.metadata?.hasTool) return 1.5;
    
    // Check for tool-like content
    const content = message.content.toLowerCase();
    const toolIndicators = ['executed', 'result:', 'output:', 'returned', 'file:', 'created', 'modified'];
    const hasToolIndicator = toolIndicators.some(t => content.includes(t));
    
    return hasToolIndicator ? 1.2 : 0;
  }

  /**
   * Calculate role-based score
   */
  private calculateRoleScore(message: ConversationMessage): number {
    switch (message.role) {
      case 'system': return 2.0; // System prompts are critical
      case 'user': return this.config.weights.userMessage;
      case 'assistant': return this.config.weights.assistantMessage;
      case 'tool': return this.config.weights.toolUsage;
      default: return 1.0;
    }
  }

  /**
   * Calculate keyword match score
   */
  private calculateKeywordScore(content: string): number {
    let matchCount = 0;
    for (const keyword of this.config.importantKeywords) {
      if (content.includes(keyword)) {
        matchCount++;
      }
    }
    // Diminishing returns after 3 keywords
    return Math.min(1.0, matchCount * 0.3);
  }

  /**
   * Calculate code presence score
   */
  private calculateCodeScore(content: string): number {
    // Check for code blocks
    if (content.includes('```')) return 1.0;
    
    // Check for inline code patterns
    const codePatterns = [
      /`[^`]+`/,
      /function\s+\w+/,
      /const\s+\w+/,
      /import\s+/,
      /export\s+/,
      /=>\s*{/,
    ];
    
    const hasCodePattern = codePatterns.some(p => p.test(content));
    return hasCodePattern ? 0.5 : 0;
  }

  /**
   * Calculate decision indicator score
   */
  private calculateDecisionScore(content: string): number {
    for (const indicator of this.config.decisionIndicators) {
      if (content.includes(indicator)) {
        return 1.0;
      }
    }
    return 0;
  }

  /**
   * Calculate reference boosts for messages referenced later
   */
  private calculateReferenceBoosts(messages: ScoredMessage[]): void {
    // Build reference patterns from message content
    for (let i = 0; i < messages.length; i++) {
      const content = messages[i].message.content.toLowerCase();
      
      // Check for back-references to earlier messages
      const referencePatterns = [
        /as (i|you|we) mentioned/,
        /earlier/,
        /before/,
        /previous/,
        /that (\w+)/,
        /the (\w+) (we|you|i)/,
      ];
      
      for (const pattern of referencePatterns) {
        if (pattern.test(content)) {
          // Boost earlier messages that might be referenced
          for (let j = 0; j < i; j++) {
            // Simple heuristic: boost messages within last 5
            if (i - j <= 5) {
              messages[j].scoreBreakdown.referenceBoost += 0.2;
            }
          }
          break;
        }
      }
    }
  }

  /**
   * Mark which messages to keep within token budget
   */
  private markMessagesToKeep(messages: ScoredMessage[], availableTokens: number): void {
    const n = messages.length;
    
    // Always keep first message (if configured)
    if (this.config.keepFirst && n > 0) {
      messages[0].keep = true;
    }
    
    // Always keep last N messages
    const lastKeepStart = Math.max(0, n - this.config.alwaysKeepLast);
    for (let i = lastKeepStart; i < n; i++) {
      messages[i].keep = true;
    }
    
    // Calculate tokens already committed
    let usedTokens = messages
      .filter(m => m.keep)
      .reduce((sum, m) => sum + m.tokenEstimate, 0);
    
    // Sort remaining by score (descending)
    const remaining = messages
      .filter(m => !m.keep)
      .sort((a, b) => b.score - a.score);
    
    // Greedily add highest scoring messages that fit
    for (const msg of remaining) {
      if (usedTokens + msg.tokenEstimate <= availableTokens) {
        msg.keep = true;
        usedTokens += msg.tokenEstimate;
      }
    }
    
    // Re-sort by original index to maintain order
    // (keep flag already set, this is just for understanding)
  }

  /**
   * Create empty result
   */
  private createEmptyResult(): PruneResult {
    return {
      originalMessages: [],
      prunedMessages: [],
      removedMessages: [],
      originalTokens: 0,
      prunedTokens: 0,
      tokensSaved: 0,
      keepRatio: 1,
      scoredMessages: [],
    };
  }

  /**
   * Create prune result
   */
  private createResult(
    original: ConversationMessage[],
    scored: ScoredMessage[],
    originalTokens: number,
    pruned?: ConversationMessage[],
    removed?: ConversationMessage[],
    prunedTokens?: number
  ): PruneResult {
    return {
      originalMessages: original,
      prunedMessages: pruned || original,
      removedMessages: removed || [],
      originalTokens,
      prunedTokens: prunedTokens || originalTokens,
      tokensSaved: originalTokens - (prunedTokens || originalTokens),
      keepRatio: (pruned?.length || original.length) / original.length,
      scoredMessages: scored,
    };
  }

  /**
   * Get pruning statistics
   */
  getStatistics(): {
    totalPrunes: number;
    avgTokensSaved: number;
    avgKeepRatio: number;
    avgMessagesRemoved: number;
  } {
    const total = this.pruneHistory.length;
    if (total === 0) {
      return {
        totalPrunes: 0,
        avgTokensSaved: 0,
        avgKeepRatio: 1,
        avgMessagesRemoved: 0,
      };
    }

    return {
      totalPrunes: total,
      avgTokensSaved: this.pruneHistory.reduce((s, r) => s + r.tokensSaved, 0) / total,
      avgKeepRatio: this.pruneHistory.reduce((s, r) => s + r.keepRatio, 0) / total,
      avgMessagesRemoved: this.pruneHistory.reduce(
        (s, r) => s + r.removedMessages.length,
        0
      ) / total,
    };
  }

  /**
   * Get recent prune results
   */
  getPruneHistory(): PruneResult[] {
    return [...this.pruneHistory];
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<PrunerConfig>): void {
    this.config = {
      ...this.config,
      ...config,
      weights: { ...this.config.weights, ...config.weights },
    };
    logger.info('ContextPruner config updated', this.config);
  }

  /**
   * Get current configuration
   */
  getConfig(): PrunerConfig {
    return {
      ...this.config,
      weights: { ...this.config.weights },
      importantKeywords: [...this.config.importantKeywords],
      decisionIndicators: [...this.config.decisionIndicators],
    };
  }

  /**
   * Add custom important keywords
   */
  addKeywords(keywords: string[]): void {
    const newKeywords = keywords.filter(
      k => !this.config.importantKeywords.includes(k.toLowerCase())
    );
    this.config.importantKeywords.push(...newKeywords.map(k => k.toLowerCase()));
  }

  /**
   * Remove keywords
   */
  removeKeywords(keywords: string[]): void {
    const toRemove = new Set(keywords.map(k => k.toLowerCase()));
    this.config.importantKeywords = this.config.importantKeywords.filter(
      k => !toRemove.has(k)
    );
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let contextPrunerInstance: ContextPruner | null = null;

export function getContextPruner(): ContextPruner {
  if (!contextPrunerInstance) {
    contextPrunerInstance = new ContextPruner();
  }
  return contextPrunerInstance;
}

export function createContextPruner(config?: Partial<PrunerConfig>): ContextPruner {
  contextPrunerInstance = new ContextPruner(config);
  return contextPrunerInstance;
}
