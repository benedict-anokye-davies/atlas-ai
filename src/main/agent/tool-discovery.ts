/**
 * Atlas Desktop - Natural Language Tool Discovery
 * Suggest existing tools when user asks for unavailable capabilities
 *
 * Features:
 * - Semantic matching of user requests to available tools
 * - Tool capability indexing
 * - Fuzzy matching and synonyms
 * - Proactive suggestions
 * - Learning from user interactions
 *
 * @module agent/tool-discovery
 */

import { EventEmitter } from 'events';
import * as fs from 'fs-extra';
import * as path from 'path';
import { app } from 'electron';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('ToolDiscovery');

// ============================================================================
// Types
// ============================================================================

export interface ToolDefinition {
  name: string;
  description: string;
  category: string;
  keywords: string[];
  aliases: string[];
  capabilities: string[];
  examples: string[];
  parameters?: Array<{
    name: string;
    description: string;
    required: boolean;
    type: string;
  }>;
}

export interface ToolMatch {
  tool: ToolDefinition;
  score: number;
  matchedKeywords: string[];
  matchedCapabilities: string[];
  reason: string;
}

export interface ToolSuggestion {
  query: string;
  suggestions: ToolMatch[];
  timestamp: number;
}

export interface ToolUsageStats {
  toolName: string;
  useCount: number;
  lastUsed: number;
  successRate: number;
  averageResponseTime: number;
  userFeedback: {
    helpful: number;
    notHelpful: number;
  };
}

export interface ToolDiscoveryEvents {
  'tools-indexed': (count: number) => void;
  'suggestion-made': (suggestion: ToolSuggestion) => void;
  'tool-used': (toolName: string, query: string) => void;
  'feedback-recorded': (toolName: string, helpful: boolean) => void;
  error: (error: Error) => void;
}

// ============================================================================
// Synonym Dictionary
// ============================================================================

const SYNONYM_MAP: Record<string, string[]> = {
  // File operations
  file: ['document', 'text', 'content', 'data'],
  read: ['open', 'view', 'show', 'display', 'get', 'load'],
  write: ['save', 'create', 'make', 'generate', 'store'],
  delete: ['remove', 'erase', 'trash', 'clear'],
  search: ['find', 'look', 'locate', 'query', 'grep'],
  list: ['show', 'display', 'enumerate', 'get all'],

  // Terminal operations
  run: ['execute', 'start', 'launch', 'invoke'],
  command: ['cmd', 'terminal', 'shell', 'cli'],

  // Git operations
  commit: ['save changes', 'checkpoint', 'snapshot'],
  push: ['upload', 'sync', 'publish'],
  pull: ['download', 'fetch', 'update'],
  branch: ['fork', 'version', 'track'],

  // Code operations
  code: ['script', 'program', 'function', 'module'],
  edit: ['modify', 'change', 'update', 'fix'],
  debug: ['fix', 'troubleshoot', 'diagnose'],

  // Browser operations
  browse: ['navigate', 'visit', 'open', 'go to'],
  webpage: ['website', 'url', 'link', 'page', 'site'],
  click: ['press', 'tap', 'select', 'activate'],

  // Desktop operations
  screenshot: ['capture', 'snapshot', 'screen grab', 'screen capture'],
  clipboard: ['copy', 'paste', 'cut'],
  window: ['app', 'application', 'program'],

  // Media operations
  play: ['start', 'resume'],
  pause: ['stop', 'halt'],
  music: ['song', 'track', 'audio'],
};

// ============================================================================
// Tool Registry (built-in tools)
// ============================================================================

const BUILT_IN_TOOLS: ToolDefinition[] = [
  // Filesystem tools
  {
    name: 'read_file',
    description: 'Read the contents of a file',
    category: 'filesystem',
    keywords: ['file', 'read', 'content', 'text', 'view'],
    aliases: ['open file', 'show file', 'get file content'],
    capabilities: ['read text files', 'read code files', 'read configuration'],
    examples: ['read the readme file', 'show me the contents of package.json', 'what is in config.ts'],
  },
  {
    name: 'write_file',
    description: 'Write content to a file',
    category: 'filesystem',
    keywords: ['file', 'write', 'create', 'save'],
    aliases: ['save file', 'create file', 'write to file'],
    capabilities: ['create new files', 'save text content', 'update file content'],
    examples: ['create a new file called test.txt', 'save this code to app.js', 'write to the config file'],
  },
  {
    name: 'list_directory',
    description: 'List files and folders in a directory',
    category: 'filesystem',
    keywords: ['directory', 'folder', 'list', 'files', 'contents'],
    aliases: ['ls', 'dir', 'show folder', 'list files'],
    capabilities: ['list directory contents', 'show files', 'browse folders'],
    examples: ['list files in src', 'show me whats in the project', 'what files are here'],
  },
  {
    name: 'search_files',
    description: 'Search for files by name or pattern',
    category: 'filesystem',
    keywords: ['search', 'find', 'file', 'pattern', 'name'],
    aliases: ['find file', 'locate file', 'search for'],
    capabilities: ['find files by name', 'search with patterns', 'locate configuration'],
    examples: ['find all typescript files', 'search for package.json', 'locate the main file'],
  },

  // Terminal tools
  {
    name: 'execute_command',
    description: 'Run a shell command in the terminal',
    category: 'terminal',
    keywords: ['command', 'terminal', 'shell', 'run', 'execute'],
    aliases: ['run command', 'terminal command', 'shell command'],
    capabilities: ['execute shell commands', 'run scripts', 'system commands'],
    examples: ['run npm install', 'execute git status', 'run the build command'],
  },
  {
    name: 'npm_command',
    description: 'Run an NPM command',
    category: 'terminal',
    keywords: ['npm', 'package', 'install', 'script'],
    aliases: ['npm run', 'npm install', 'package manager'],
    capabilities: ['install packages', 'run npm scripts', 'manage dependencies'],
    examples: ['install lodash', 'run the test script', 'update dependencies'],
  },

  // Git tools
  {
    name: 'git_status',
    description: 'Check the current git status',
    category: 'git',
    keywords: ['git', 'status', 'changes', 'modified'],
    aliases: ['check status', 'show changes', 'what changed'],
    capabilities: ['show modified files', 'check staging', 'view git state'],
    examples: ['whats the git status', 'show me changed files', 'what needs to be committed'],
  },
  {
    name: 'git_commit',
    description: 'Commit staged changes',
    category: 'git',
    keywords: ['git', 'commit', 'save', 'checkpoint'],
    aliases: ['save changes', 'make commit', 'commit changes'],
    capabilities: ['create commits', 'save changes to history', 'commit with message'],
    examples: ['commit my changes', 'save these changes with message fix bug', 'commit everything'],
  },
  {
    name: 'git_push',
    description: 'Push commits to remote repository',
    category: 'git',
    keywords: ['git', 'push', 'upload', 'remote'],
    aliases: ['push changes', 'upload commits', 'sync to github'],
    capabilities: ['push to remote', 'upload commits', 'sync repository'],
    examples: ['push my commits', 'upload to github', 'sync my changes'],
  },
  {
    name: 'git_diff',
    description: 'Show differences in files',
    category: 'git',
    keywords: ['git', 'diff', 'changes', 'compare'],
    aliases: ['show diff', 'what changed', 'compare versions'],
    capabilities: ['show file differences', 'compare commits', 'view changes'],
    examples: ['show me the diff', 'what did I change', 'compare with last commit'],
  },

  // Browser tools
  {
    name: 'browser_navigate',
    description: 'Navigate to a URL in the browser',
    category: 'browser',
    keywords: ['browser', 'navigate', 'url', 'website', 'open'],
    aliases: ['go to website', 'open url', 'visit page'],
    capabilities: ['open websites', 'navigate pages', 'browse internet'],
    examples: ['go to google.com', 'open github', 'navigate to stackoverflow'],
  },
  {
    name: 'browser_click',
    description: 'Click an element on a webpage',
    category: 'browser',
    keywords: ['browser', 'click', 'button', 'element'],
    aliases: ['click button', 'press element', 'select item'],
    capabilities: ['click buttons', 'interact with pages', 'select elements'],
    examples: ['click the submit button', 'press login', 'select the first result'],
  },

  // Code tools
  {
    name: 'grep_search',
    description: 'Search for text patterns in code',
    category: 'code',
    keywords: ['grep', 'search', 'code', 'pattern', 'text'],
    aliases: ['search code', 'find in files', 'grep for'],
    capabilities: ['search code patterns', 'find text in files', 'regex search'],
    examples: ['search for function name', 'find all imports', 'grep for TODO'],
  },
  {
    name: 'semantic_code_search',
    description: 'Search code using natural language',
    category: 'code',
    keywords: ['semantic', 'search', 'code', 'meaning', 'find'],
    aliases: ['find code that', 'search for function that', 'where is the code for'],
    capabilities: ['semantic search', 'find by meaning', 'natural language code search'],
    examples: ['find code that handles authentication', 'where is the file upload logic', 'code that validates input'],
  },
  {
    name: 'find_symbol',
    description: 'Find symbol definitions in code',
    category: 'code',
    keywords: ['symbol', 'definition', 'function', 'class', 'variable'],
    aliases: ['find definition', 'where is defined', 'go to definition'],
    capabilities: ['find definitions', 'locate symbols', 'jump to declaration'],
    examples: ['find where User class is defined', 'go to handleClick definition', 'where is formatDate'],
  },

  // Desktop tools
  {
    name: 'screenshot',
    description: 'Capture a screenshot',
    category: 'desktop',
    keywords: ['screenshot', 'capture', 'screen', 'image'],
    aliases: ['take screenshot', 'capture screen', 'screen grab'],
    capabilities: ['capture screen', 'take pictures', 'screenshot window'],
    examples: ['take a screenshot', 'capture the screen', 'screenshot the current window'],
  },
  {
    name: 'clipboard',
    description: 'Read or write to clipboard',
    category: 'desktop',
    keywords: ['clipboard', 'copy', 'paste', 'cut'],
    aliases: ['copy to clipboard', 'paste from clipboard', 'get clipboard'],
    capabilities: ['copy text', 'paste content', 'manage clipboard'],
    examples: ['copy this text', 'what is in my clipboard', 'paste the clipboard content'],
  },
  {
    name: 'window_manager',
    description: 'Manage application windows',
    category: 'desktop',
    keywords: ['window', 'application', 'minimize', 'maximize', 'focus'],
    aliases: ['manage windows', 'switch apps', 'focus window'],
    capabilities: ['switch windows', 'minimize apps', 'focus applications'],
    examples: ['switch to vscode', 'minimize this window', 'focus the browser'],
  },

  // Integrations
  {
    name: 'spotify',
    description: 'Control Spotify playback',
    category: 'integrations',
    keywords: ['spotify', 'music', 'play', 'song', 'playlist'],
    aliases: ['play music', 'pause music', 'control spotify'],
    capabilities: ['play songs', 'pause music', 'skip tracks', 'control volume'],
    examples: ['play some music', 'pause spotify', 'skip this song', 'what song is playing'],
  },
  {
    name: 'calendar',
    description: 'Manage calendar events',
    category: 'integrations',
    keywords: ['calendar', 'event', 'meeting', 'schedule', 'appointment'],
    aliases: ['check calendar', 'create event', 'whats my schedule'],
    capabilities: ['view events', 'create meetings', 'check schedule'],
    examples: ['whats on my calendar today', 'schedule a meeting', 'create an event for tomorrow'],
  },
  {
    name: 'vscode',
    description: 'Control VS Code editor',
    category: 'integrations',
    keywords: ['vscode', 'editor', 'code', 'file', 'open'],
    aliases: ['open in vscode', 'edit in vscode', 'vscode command'],
    capabilities: ['open files', 'run vscode commands', 'manage editor'],
    examples: ['open this file in vscode', 'run format document', 'create new file in editor'],
  },
];

// ============================================================================
// Tool Discovery Manager
// ============================================================================

export class ToolDiscoveryManager extends EventEmitter {
  private tools: Map<string, ToolDefinition> = new Map();
  private usageStats: Map<string, ToolUsageStats> = new Map();
  private recentSuggestions: ToolSuggestion[] = [];
  private storagePath: string;

  constructor() {
    super();
    this.storagePath = path.join(app.getPath('userData'), 'tool-discovery-stats.json');
    this.initialize();
  }

  private async initialize(): Promise<void> {
    // Index built-in tools
    for (const tool of BUILT_IN_TOOLS) {
      this.tools.set(tool.name, tool);
    }

    await this.loadStats();
    this.emit('tools-indexed', this.tools.size);
    logger.info('ToolDiscoveryManager initialized', { toolCount: this.tools.size });
  }

  private async loadStats(): Promise<void> {
    try {
      if (await fs.pathExists(this.storagePath)) {
        const data = await fs.readJson(this.storagePath);
        if (data.stats) {
          for (const stat of data.stats) {
            this.usageStats.set(stat.toolName, stat);
          }
        }
      }
    } catch (error) {
      logger.warn('Failed to load tool stats', { error });
    }
  }

  private async saveStats(): Promise<void> {
    try {
      await fs.writeJson(
        this.storagePath,
        {
          stats: Array.from(this.usageStats.values()),
          savedAt: Date.now(),
        },
        { spaces: 2 }
      );
    } catch (error) {
      logger.error('Failed to save tool stats', { error });
    }
  }

  // ============================================================================
  // Tool Registration
  // ============================================================================

  /**
   * Register a new tool
   */
  registerTool(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
    logger.info('Tool registered', { name: tool.name, category: tool.category });
  }

  /**
   * Get a tool by name
   */
  getTool(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /**
   * Get all tools
   */
  getAllTools(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get tools by category
   */
  getToolsByCategory(category: string): ToolDefinition[] {
    return Array.from(this.tools.values()).filter((t) => t.category === category);
  }

  // ============================================================================
  // Tool Discovery
  // ============================================================================

  /**
   * Find tools matching a user query
   */
  findTools(query: string, limit = 5): ToolMatch[] {
    const queryLower = query.toLowerCase();
    const queryWords = this.tokenize(queryLower);
    const expandedWords = this.expandWithSynonyms(queryWords);

    const matches: ToolMatch[] = [];

    for (const tool of this.tools.values()) {
      const match = this.scoreTool(tool, queryLower, queryWords, expandedWords);
      if (match.score > 0.1) {
        matches.push(match);
      }
    }

    // Sort by score descending
    matches.sort((a, b) => b.score - a.score);

    // Create suggestion record
    const suggestion: ToolSuggestion = {
      query,
      suggestions: matches.slice(0, limit),
      timestamp: Date.now(),
    };

    this.recentSuggestions.push(suggestion);
    if (this.recentSuggestions.length > 100) {
      this.recentSuggestions.shift();
    }

    this.emit('suggestion-made', suggestion);

    return matches.slice(0, limit);
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2);
  }

  private expandWithSynonyms(words: string[]): Set<string> {
    const expanded = new Set(words);

    for (const word of words) {
      // Add synonyms of this word
      for (const [key, synonyms] of Object.entries(SYNONYM_MAP)) {
        if (key === word || synonyms.includes(word)) {
          expanded.add(key);
          for (const syn of synonyms) {
            expanded.add(syn);
          }
        }
      }
    }

    return expanded;
  }

  private scoreTool(tool: ToolDefinition, query: string, queryWords: string[], expandedWords: Set<string>): ToolMatch {
    let score = 0;
    const matchedKeywords: string[] = [];
    const matchedCapabilities: string[] = [];
    const reasons: string[] = [];

    // Direct name match (highest weight)
    if (query.includes(tool.name.replace(/_/g, ' '))) {
      score += 0.5;
      reasons.push('name match');
    }

    // Alias match
    for (const alias of tool.aliases) {
      if (query.includes(alias)) {
        score += 0.4;
        reasons.push(`alias "${alias}"`);
        break;
      }
    }

    // Keyword matching with synonyms
    const toolKeywords = new Set(tool.keywords.map((k) => k.toLowerCase()));
    for (const word of expandedWords) {
      if (toolKeywords.has(word)) {
        score += 0.1;
        matchedKeywords.push(word);
      }
    }

    // Capability matching
    for (const cap of tool.capabilities) {
      const capWords = this.tokenize(cap);
      const overlap = capWords.filter((w) => expandedWords.has(w)).length;
      if (overlap > 0) {
        score += overlap * 0.05;
        matchedCapabilities.push(cap);
      }
    }

    // Example similarity
    for (const example of tool.examples) {
      const exampleWords = this.tokenize(example);
      const overlap = exampleWords.filter((w) => expandedWords.has(w)).length;
      score += overlap * 0.02;
    }

    // Boost based on usage stats
    const stats = this.usageStats.get(tool.name);
    if (stats) {
      // Small boost for frequently used tools
      score += Math.min(stats.useCount / 100, 0.1);
      // Boost for high success rate
      if (stats.successRate > 0.8) {
        score += 0.05;
      }
    }

    // Normalize score
    score = Math.min(score, 1);

    const reason =
      reasons.length > 0
        ? `Matched: ${reasons.join(', ')}`
        : matchedKeywords.length > 0
          ? `Keywords: ${matchedKeywords.join(', ')}`
          : 'Partial match';

    return {
      tool,
      score,
      matchedKeywords,
      matchedCapabilities,
      reason,
    };
  }

  // ============================================================================
  // Suggestion Generation
  // ============================================================================

  /**
   * Generate a natural language suggestion message
   */
  generateSuggestionMessage(query: string): string {
    const matches = this.findTools(query, 3);

    if (matches.length === 0) {
      return "I couldn't find a matching tool for that request. Could you describe what you're trying to do?";
    }

    const lines = ["I found some tools that might help:\n"];

    for (const match of matches) {
      lines.push(`- **${match.tool.name}**: ${match.tool.description}`);
      if (match.tool.examples.length > 0) {
        lines.push(`  Example: "${match.tool.examples[0]}"`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Check if a query matches any tool well enough to auto-suggest
   */
  shouldSuggestTool(query: string): { should: boolean; match?: ToolMatch } {
    const matches = this.findTools(query, 1);

    if (matches.length > 0 && matches[0].score > 0.5) {
      return { should: true, match: matches[0] };
    }

    return { should: false };
  }

  // ============================================================================
  // Usage Tracking
  // ============================================================================

  /**
   * Record tool usage
   */
  recordUsage(toolName: string, query: string, success: boolean, responseTime?: number): void {
    let stats = this.usageStats.get(toolName);

    if (!stats) {
      stats = {
        toolName,
        useCount: 0,
        lastUsed: 0,
        successRate: 1,
        averageResponseTime: 0,
        userFeedback: { helpful: 0, notHelpful: 0 },
      };
    }

    stats.useCount++;
    stats.lastUsed = Date.now();

    // Update success rate (rolling average)
    const successNum = success ? 1 : 0;
    stats.successRate = stats.successRate * 0.9 + successNum * 0.1;

    // Update response time
    if (responseTime !== undefined) {
      stats.averageResponseTime = stats.averageResponseTime * 0.9 + responseTime * 0.1;
    }

    this.usageStats.set(toolName, stats);
    this.emit('tool-used', toolName, query);
    this.saveStats();
  }

  /**
   * Record user feedback on a tool
   */
  recordFeedback(toolName: string, helpful: boolean): void {
    const stats = this.usageStats.get(toolName);
    if (stats) {
      if (helpful) {
        stats.userFeedback.helpful++;
      } else {
        stats.userFeedback.notHelpful++;
      }
      this.saveStats();
      this.emit('feedback-recorded', toolName, helpful);
    }
  }

  // ============================================================================
  // Analysis
  // ============================================================================

  /**
   * Get most used tools
   */
  getMostUsedTools(limit = 10): ToolUsageStats[] {
    return Array.from(this.usageStats.values())
      .sort((a, b) => b.useCount - a.useCount)
      .slice(0, limit);
  }

  /**
   * Get tool categories with counts
   */
  getCategories(): Array<{ category: string; count: number }> {
    const categories = new Map<string, number>();

    for (const tool of this.tools.values()) {
      categories.set(tool.category, (categories.get(tool.category) || 0) + 1);
    }

    return Array.from(categories.entries())
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count);
  }

  /**
   * Generate tool discovery summary for LLM
   */
  getToolSummaryForLLM(): string {
    const categories = this.getCategories();
    const lines = ['## Available Tool Categories\n'];

    for (const { category, count } of categories) {
      const tools = this.getToolsByCategory(category);
      lines.push(`### ${category} (${count} tools)`);
      for (const tool of tools) {
        lines.push(`- **${tool.name}**: ${tool.description}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }
}

// ============================================================================
// Singleton
// ============================================================================

let toolDiscoveryManager: ToolDiscoveryManager | null = null;

export function getToolDiscoveryManager(): ToolDiscoveryManager {
  if (!toolDiscoveryManager) {
    toolDiscoveryManager = new ToolDiscoveryManager();
  }
  return toolDiscoveryManager;
}
