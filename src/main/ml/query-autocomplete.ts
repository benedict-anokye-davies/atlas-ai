/**
 * Atlas Desktop - Query Autocomplete
 * Learn user query patterns for intelligent autocomplete
 *
 * Features:
 * - Prefix-based completion
 * - Context-aware suggestions
 * - Personalized ranking
 * - Typo tolerance
 * - Recent query boosting
 *
 * @module ml/query-autocomplete
 */

import { EventEmitter } from 'events';
import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('QueryAutocomplete');

// ============================================================================
// Types
// ============================================================================

export interface QueryEntry {
  query: string;
  frequency: number;
  lastUsed: number;
  successRate: number;
  contexts: string[];
  avgResponseTime: number;
}

export interface AutocompleteSuggestion {
  text: string;
  score: number;
  type: 'history' | 'pattern' | 'context' | 'common';
  metadata?: Record<string, unknown>;
}

export interface TrieNode {
  children: Map<string, TrieNode>;
  isEndOfWord: boolean;
  query?: QueryEntry;
}

export interface QueryAutocompleteConfig {
  maxSuggestions: number;
  minQueryLength: number;
  maxHistorySize: number;
  recencyBoost: number;
  frequencyBoost: number;
  contextBoost: number;
  typoTolerance: number;
}

export interface QueryAutocompleteEvents {
  'suggestion-selected': (suggestion: AutocompleteSuggestion) => void;
  'query-recorded': (entry: QueryEntry) => void;
  'patterns-updated': () => void;
  error: (error: Error) => void;
}

// ============================================================================
// Query Autocomplete
// ============================================================================

export class QueryAutocomplete extends EventEmitter {
  private config: QueryAutocompleteConfig;
  private trie: TrieNode;
  private queryHistory: Map<string, QueryEntry> = new Map();
  private commonPatterns: Map<string, string[]> = new Map();
  private currentContext: string = '';
  private dataPath: string;

  // Stats
  private stats = {
    totalQueries: 0,
    uniqueQueries: 0,
    suggestionsProvided: 0,
    suggestionsAccepted: 0,
  };

  constructor(config?: Partial<QueryAutocompleteConfig>) {
    super();
    this.config = {
      maxSuggestions: 10,
      minQueryLength: 2,
      maxHistorySize: 10000,
      recencyBoost: 2.0,
      frequencyBoost: 1.5,
      contextBoost: 1.3,
      typoTolerance: 2,
      ...config,
    };

    this.trie = this.createTrieNode();
    this.dataPath = path.join(app.getPath('userData'), 'query-autocomplete.json');

    this.loadData();
    this.initializeCommonPatterns();

    logger.info('QueryAutocomplete initialized', { config: this.config });
  }

  // ============================================================================
  // Data Persistence
  // ============================================================================

  private loadData(): void {
    try {
      if (fs.existsSync(this.dataPath)) {
        const data = JSON.parse(fs.readFileSync(this.dataPath, 'utf-8'));

        // Load query history
        for (const [query, entry] of Object.entries(data.queryHistory || {})) {
          this.queryHistory.set(query, entry as QueryEntry);
          this.insertToTrie(query, entry as QueryEntry);
        }

        // Load stats
        if (data.stats) {
          this.stats = { ...this.stats, ...data.stats };
        }

        logger.info('Loaded autocomplete data', { queries: this.queryHistory.size });
      }
    } catch (error) {
      logger.warn('Failed to load autocomplete data', { error });
    }
  }

  private saveData(): void {
    try {
      const data = {
        queryHistory: Object.fromEntries(this.queryHistory),
        stats: this.stats,
        savedAt: Date.now(),
      };
      fs.writeFileSync(this.dataPath, JSON.stringify(data, null, 2));
    } catch (error) {
      logger.warn('Failed to save autocomplete data', { error });
    }
  }

  // ============================================================================
  // Trie Operations
  // ============================================================================

  private createTrieNode(): TrieNode {
    return {
      children: new Map(),
      isEndOfWord: false,
    };
  }

  private insertToTrie(query: string, entry: QueryEntry): void {
    const words = query.toLowerCase();
    let node = this.trie;

    for (const char of words) {
      if (!node.children.has(char)) {
        node.children.set(char, this.createTrieNode());
      }
      node = node.children.get(char)!;
    }

    node.isEndOfWord = true;
    node.query = entry;
  }

  private searchTrie(prefix: string): QueryEntry[] {
    const lowerPrefix = prefix.toLowerCase();
    let node = this.trie;

    // Navigate to prefix
    for (const char of lowerPrefix) {
      if (!node.children.has(char)) {
        return [];
      }
      node = node.children.get(char)!;
    }

    // Collect all entries under this prefix
    return this.collectEntries(node);
  }

  private collectEntries(node: TrieNode): QueryEntry[] {
    const entries: QueryEntry[] = [];

    if (node.isEndOfWord && node.query) {
      entries.push(node.query);
    }

    for (const [, child] of node.children) {
      entries.push(...this.collectEntries(child));
    }

    return entries;
  }

  // ============================================================================
  // Common Patterns
  // ============================================================================

  private initializeCommonPatterns(): void {
    // Command patterns
    this.commonPatterns.set('open', [
      'open file',
      'open folder',
      'open application',
      'open browser',
      'open terminal',
      'open settings',
    ]);

    this.commonPatterns.set('search', [
      'search for',
      'search files',
      'search in',
      'search google',
      'search code',
    ]);

    this.commonPatterns.set('create', [
      'create file',
      'create folder',
      'create project',
      'create note',
      'create task',
    ]);

    this.commonPatterns.set('show', [
      'show me',
      'show files',
      'show calendar',
      'show tasks',
      'show weather',
    ]);

    this.commonPatterns.set('what', [
      'what is',
      'what are',
      "what's the",
      'what time',
      'what day',
    ]);

    this.commonPatterns.set('how', [
      'how to',
      'how do I',
      'how can I',
      'how many',
      'how much',
    ]);

    this.commonPatterns.set('run', [
      'run command',
      'run script',
      'run tests',
      'run build',
      'run server',
    ]);

    this.commonPatterns.set('set', [
      'set reminder',
      'set alarm',
      'set timer',
      'set volume',
      'set brightness',
    ]);
  }

  // ============================================================================
  // Query Recording
  // ============================================================================

  /**
   * Record a query
   */
  recordQuery(query: string, context?: string, success = true, responseTime = 0): void {
    const normalizedQuery = query.trim().toLowerCase();

    if (normalizedQuery.length < this.config.minQueryLength) {
      return;
    }

    let entry = this.queryHistory.get(normalizedQuery);

    if (entry) {
      // Update existing entry
      entry.frequency++;
      entry.lastUsed = Date.now();
      entry.successRate = (entry.successRate * (entry.frequency - 1) + (success ? 1 : 0)) / entry.frequency;
      entry.avgResponseTime =
        (entry.avgResponseTime * (entry.frequency - 1) + responseTime) / entry.frequency;

      if (context && !entry.contexts.includes(context)) {
        entry.contexts.push(context);
        if (entry.contexts.length > 10) {
          entry.contexts.shift();
        }
      }
    } else {
      // Create new entry
      entry = {
        query: normalizedQuery,
        frequency: 1,
        lastUsed: Date.now(),
        successRate: success ? 1 : 0,
        contexts: context ? [context] : [],
        avgResponseTime: responseTime,
      };

      this.queryHistory.set(normalizedQuery, entry);
      this.insertToTrie(normalizedQuery, entry);
      this.stats.uniqueQueries++;
    }

    this.stats.totalQueries++;

    // Enforce max history size
    if (this.queryHistory.size > this.config.maxHistorySize) {
      this.pruneHistory();
    }

    this.emit('query-recorded', entry);

    // Save periodically
    if (this.stats.totalQueries % 10 === 0) {
      this.saveData();
    }
  }

  /**
   * Prune old/infrequent queries
   */
  private pruneHistory(): void {
    const entries = Array.from(this.queryHistory.entries());

    // Score each entry
    const scored = entries.map(([query, entry]) => ({
      query,
      entry,
      score: this.calculateEntryScore(entry),
    }));

    // Sort by score and keep top entries
    scored.sort((a, b) => b.score - a.score);
    const toKeep = scored.slice(0, Math.floor(this.config.maxHistorySize * 0.9));

    // Rebuild
    this.queryHistory.clear();
    this.trie = this.createTrieNode();

    for (const { query, entry } of toKeep) {
      this.queryHistory.set(query, entry);
      this.insertToTrie(query, entry);
    }

    logger.debug('Pruned query history', {
      before: entries.length,
      after: this.queryHistory.size,
    });
  }

  /**
   * Calculate entry score for pruning
   */
  private calculateEntryScore(entry: QueryEntry): number {
    const recencyFactor = Math.exp(-(Date.now() - entry.lastUsed) / (7 * 24 * 60 * 60 * 1000));
    return entry.frequency * entry.successRate * recencyFactor;
  }

  // ============================================================================
  // Autocomplete
  // ============================================================================

  /**
   * Get autocomplete suggestions
   */
  getSuggestions(prefix: string, context?: string): AutocompleteSuggestion[] {
    if (prefix.length < this.config.minQueryLength) {
      return [];
    }

    const suggestions: AutocompleteSuggestion[] = [];
    const seenTexts = new Set<string>();

    // 1. History-based suggestions
    const historyEntries = this.searchTrie(prefix);
    for (const entry of historyEntries) {
      if (!seenTexts.has(entry.query)) {
        const score = this.scoreHistorySuggestion(entry, context);
        suggestions.push({
          text: entry.query,
          score,
          type: 'history',
          metadata: {
            frequency: entry.frequency,
            lastUsed: entry.lastUsed,
          },
        });
        seenTexts.add(entry.query);
      }
    }

    // 2. Pattern-based suggestions
    const patternSuggestions = this.getPatternSuggestions(prefix);
    for (const text of patternSuggestions) {
      if (!seenTexts.has(text)) {
        suggestions.push({
          text,
          score: 0.5,
          type: 'pattern',
        });
        seenTexts.add(text);
      }
    }

    // 3. Context-based suggestions
    if (context) {
      const contextSuggestions = this.getContextSuggestions(prefix, context);
      for (const suggestion of contextSuggestions) {
        if (!seenTexts.has(suggestion.text)) {
          suggestions.push(suggestion);
          seenTexts.add(suggestion.text);
        }
      }
    }

    // 4. Fuzzy matches (typo tolerance)
    if (suggestions.length < this.config.maxSuggestions) {
      const fuzzyMatches = this.getFuzzyMatches(prefix);
      for (const match of fuzzyMatches) {
        if (!seenTexts.has(match.query)) {
          suggestions.push({
            text: match.query,
            score: 0.3,
            type: 'history',
            metadata: { fuzzyMatch: true },
          });
          seenTexts.add(match.query);
        }
      }
    }

    // Sort and limit
    suggestions.sort((a, b) => b.score - a.score);
    const topSuggestions = suggestions.slice(0, this.config.maxSuggestions);

    this.stats.suggestionsProvided += topSuggestions.length;

    return topSuggestions;
  }

  /**
   * Score a history suggestion
   */
  private scoreHistorySuggestion(entry: QueryEntry, context?: string): number {
    let score = 0;

    // Frequency factor
    score += Math.log(entry.frequency + 1) * this.config.frequencyBoost;

    // Recency factor (exponential decay over 7 days)
    const recencyDays = (Date.now() - entry.lastUsed) / (24 * 60 * 60 * 1000);
    score += Math.exp(-recencyDays / 7) * this.config.recencyBoost;

    // Success rate factor
    score *= entry.successRate;

    // Context match
    if (context && entry.contexts.includes(context)) {
      score *= this.config.contextBoost;
    }

    return score;
  }

  /**
   * Get pattern-based suggestions
   */
  private getPatternSuggestions(prefix: string): string[] {
    const suggestions: string[] = [];
    const lowerPrefix = prefix.toLowerCase();

    for (const [keyword, patterns] of this.commonPatterns) {
      if (keyword.startsWith(lowerPrefix) || lowerPrefix.startsWith(keyword)) {
        for (const pattern of patterns) {
          if (pattern.toLowerCase().startsWith(lowerPrefix)) {
            suggestions.push(pattern);
          }
        }
      }
    }

    return suggestions;
  }

  /**
   * Get context-based suggestions
   */
  private getContextSuggestions(prefix: string, context: string): AutocompleteSuggestion[] {
    const suggestions: AutocompleteSuggestion[] = [];
    const lowerPrefix = prefix.toLowerCase();

    // Find queries frequently used in this context
    for (const entry of this.queryHistory.values()) {
      if (entry.contexts.includes(context) && entry.query.startsWith(lowerPrefix)) {
        const contextFrequency = entry.contexts.filter((c) => c === context).length;
        suggestions.push({
          text: entry.query,
          score: (contextFrequency / entry.contexts.length) * this.config.contextBoost,
          type: 'context',
        });
      }
    }

    return suggestions;
  }

  /**
   * Get fuzzy matches for typo tolerance
   */
  private getFuzzyMatches(prefix: string): QueryEntry[] {
    const matches: QueryEntry[] = [];
    const lowerPrefix = prefix.toLowerCase();

    for (const entry of this.queryHistory.values()) {
      const distance = this.levenshteinDistance(lowerPrefix, entry.query.slice(0, prefix.length));
      if (distance <= this.config.typoTolerance && distance > 0) {
        matches.push(entry);
      }
    }

    // Sort by frequency
    matches.sort((a, b) => b.frequency - a.frequency);

    return matches.slice(0, 5);
  }

  /**
   * Calculate Levenshtein distance
   */
  private levenshteinDistance(s1: string, s2: string): number {
    const m = s1.length;
    const n = s2.length;
    const dp: number[][] = Array(m + 1)
      .fill(null)
      .map(() => Array(n + 1).fill(0));

    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (s1[i - 1] === s2[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1];
        } else {
          dp[i][j] = Math.min(
            dp[i - 1][j] + 1,
            dp[i][j - 1] + 1,
            dp[i - 1][j - 1] + 1
          );
        }
      }
    }

    return dp[m][n];
  }

  // ============================================================================
  // Feedback
  // ============================================================================

  /**
   * Record suggestion selection
   */
  recordSelection(suggestion: AutocompleteSuggestion): void {
    this.stats.suggestionsAccepted++;
    this.emit('suggestion-selected', suggestion);

    // Boost the selected query
    const entry = this.queryHistory.get(suggestion.text.toLowerCase());
    if (entry) {
      entry.frequency += 0.5; // Partial boost for selection
      entry.lastUsed = Date.now();
    }
  }

  /**
   * Set current context
   */
  setContext(context: string): void {
    this.currentContext = context;
  }

  // ============================================================================
  // Utilities
  // ============================================================================

  /**
   * Get popular queries
   */
  getPopularQueries(limit = 20): QueryEntry[] {
    return Array.from(this.queryHistory.values())
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, limit);
  }

  /**
   * Get recent queries
   */
  getRecentQueries(limit = 20): QueryEntry[] {
    return Array.from(this.queryHistory.values())
      .sort((a, b) => b.lastUsed - a.lastUsed)
      .slice(0, limit);
  }

  /**
   * Add custom pattern
   */
  addPattern(keyword: string, patterns: string[]): void {
    const existing = this.commonPatterns.get(keyword) || [];
    this.commonPatterns.set(keyword, [...new Set([...existing, ...patterns])]);
    this.emit('patterns-updated');
  }

  /**
   * Clear history
   */
  clearHistory(): void {
    this.queryHistory.clear();
    this.trie = this.createTrieNode();
    this.saveData();
    logger.info('Query history cleared');
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalQueries: number;
    uniqueQueries: number;
    suggestionsProvided: number;
    suggestionsAccepted: number;
    acceptanceRate: number;
    historySize: number;
  } {
    return {
      ...this.stats,
      acceptanceRate:
        this.stats.suggestionsProvided > 0
          ? this.stats.suggestionsAccepted / this.stats.suggestionsProvided
          : 0,
      historySize: this.queryHistory.size,
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<QueryAutocompleteConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('Config updated', { config: this.config });
  }
}

// ============================================================================
// Singleton
// ============================================================================

let queryAutocomplete: QueryAutocomplete | null = null;

export function getQueryAutocomplete(): QueryAutocomplete {
  if (!queryAutocomplete) {
    queryAutocomplete = new QueryAutocomplete();
  }
  return queryAutocomplete;
}
