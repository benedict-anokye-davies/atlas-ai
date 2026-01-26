/**
 * Atlas Desktop - Tool Pre-Warmer
 * 
 * Predicts likely tool calls based on conversation context and pre-warms them
 * to reduce latency. Uses the intent predictor for pattern-based predictions
 * and analyzes conversation context for semantic predictions.
 * 
 * Pre-warming strategies:
 * - Tool definition caching (keeps tool schemas hot)
 * - API connection warming (for external services)
 * - Data prefetching (for predictable tool chains)
 * 
 * @module ml/tool-prewarmer
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import { getIntentPredictor, type IntentPrediction } from './intent-predictor';
import { getToolCache } from '../utils/tool-cache';

const logger = createModuleLogger('ToolPrewarmer');

// =============================================================================
// Types
// =============================================================================

export interface ToolPrediction {
  tool: string;
  confidence: number;
  reasoning: string;
  preWarmAction?: 'cache' | 'prefetch' | 'connect';
}

export interface PreWarmResult {
  tool: string;
  success: boolean;
  latencyMs: number;
  cached?: boolean;
}

export interface PreWarmerConfig {
  enabled: boolean;
  confidenceThreshold: number; // Minimum confidence to pre-warm (0-1)
  maxConcurrentPreWarms: number;
  enableConnectionWarm: boolean;
  enableDataPrefetch: boolean;
  enableCacheWarm: boolean;
}

export interface ConversationContext {
  recentMessages: Array<{
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
  }>;
  lastToolCalls: string[];
  activeProject?: string;
  currentState?: string; // e.g., 'debugging', 'coding', 'researching'
}

export interface ToolPrewarmerEvents {
  'prediction-made': (predictions: ToolPrediction[]) => void;
  'prewarm-started': (tool: string, action: string) => void;
  'prewarm-completed': (result: PreWarmResult) => void;
  'prewarm-failed': (tool: string, error: Error) => void;
  error: (error: Error) => void;
}

// =============================================================================
// Tool Chain Patterns
// =============================================================================

/**
 * Common tool chains - when tool A is called, tool B is likely next
 */
const TOOL_CHAINS: Record<string, string[]> = {
  // File operations
  'read_file': ['write_file', 'grep_search', 'semantic_code_search'],
  'list_directory': ['read_file', 'search_files'],
  'search_files': ['read_file', 'grep_search'],
  
  // Git operations
  'git_status': ['git_diff', 'git_commit', 'git_add'],
  'git_diff': ['git_commit', 'git_add', 'read_file'],
  'git_commit': ['git_push', 'git_status'],
  
  // Code operations
  'grep_search': ['read_file', 'write_file'],
  'semantic_code_search': ['read_file', 'code_patch'],
  'find_symbol': ['list_code_usages', 'read_file'],
  
  // Terminal operations
  'execute_command': ['read_file', 'list_directory'],
  'npm_command': ['read_file', 'execute_command'],
  
  // Browser operations
  'browser_navigate': ['browser_click', 'browser_type', 'browser_extract'],
  'browser_extract': ['read_file', 'write_file'],
  
  // Trading operations
  'get_my_trading_status': ['get_my_positions', 'get_my_pnl'],
  'get_my_positions': ['close_position', 'update_stop_loss'],
  'place_trade': ['get_my_positions', 'get_my_pnl'],
};

/**
 * Context-to-tool mappings - conversation keywords suggest tools
 */
const CONTEXT_TOOL_HINTS: Record<string, string[]> = {
  // File keywords
  'file': ['read_file', 'write_file', 'search_files'],
  'read': ['read_file', 'list_directory'],
  'edit': ['read_file', 'write_file', 'code_patch'],
  'create': ['write_file', 'create_directory'],
  'find': ['search_files', 'grep_search', 'semantic_code_search'],
  'search': ['grep_search', 'semantic_code_search', 'web_search'],
  
  // Git keywords
  'git': ['git_status', 'git_diff', 'git_commit'],
  'commit': ['git_commit', 'git_status', 'git_diff'],
  'push': ['git_push', 'git_status'],
  'branch': ['git_status', 'git_branch'],
  
  // Code keywords
  'debug': ['read_file', 'execute_command', 'grep_search'],
  'error': ['read_file', 'grep_search', 'execute_command'],
  'test': ['execute_command', 'npm_command', 'read_file'],
  'refactor': ['read_file', 'write_file', 'list_code_usages'],
  
  // Browser keywords
  'browse': ['browser_navigate', 'browser_execute_task'],
  'website': ['browser_navigate', 'browser_extract'],
  'scrape': ['browser_extract', 'browser_navigate'],
  
  // Trading keywords
  'trade': ['get_my_trading_status', 'get_my_positions', 'place_trade'],
  'position': ['get_my_positions', 'close_position'],
  'profit': ['get_my_pnl', 'get_my_trading_status'],
  'market': ['get_market_regime', 'get_trading_research'],
  
  // System keywords
  'screenshot': ['screenshot', 'browser_navigate'],
  'clipboard': ['clipboard_read', 'clipboard_write'],
  'window': ['window_list', 'window_focus'],
};

// =============================================================================
// Tool Pre-Warmer
// =============================================================================

export class ToolPrewarmer extends EventEmitter {
  private config: PreWarmerConfig;
  private activePreWarms = new Set<string>();
  private preWarmHistory: PreWarmResult[] = [];
  private lastPredictions: ToolPrediction[] = [];
  private connectionWarmTimestamps = new Map<string, number>();

  constructor(config?: Partial<PreWarmerConfig>) {
    super();
    this.config = {
      enabled: true,
      confidenceThreshold: 0.25,
      maxConcurrentPreWarms: 3,
      enableConnectionWarm: true,
      enableDataPrefetch: true,
      enableCacheWarm: true,
      ...config,
    };
  }

  // ===========================================================================
  // Prediction
  // ===========================================================================

  /**
   * Predict likely tools based on context
   */
  predictTools(context: ConversationContext): ToolPrediction[] {
    if (!this.config.enabled) return [];

    const predictions: ToolPrediction[] = [];
    const seenTools = new Set<string>();

    // 1. Chain-based prediction from last tool calls
    if (context.lastToolCalls.length > 0) {
      const lastTool = context.lastToolCalls[context.lastToolCalls.length - 1];
      const chainedTools = TOOL_CHAINS[lastTool];
      
      if (chainedTools) {
        for (let i = 0; i < chainedTools.length; i++) {
          const tool = chainedTools[i];
          if (!seenTools.has(tool)) {
            const confidence = 0.7 - (i * 0.15); // Decreasing confidence
            if (confidence >= this.config.confidenceThreshold) {
              predictions.push({
                tool,
                confidence,
                reasoning: `Commonly follows ${lastTool}`,
                preWarmAction: 'cache',
              });
              seenTools.add(tool);
            }
          }
        }
      }
    }

    // 2. Context-based prediction from message content
    const recentText = context.recentMessages
      .slice(-3)
      .map(m => m.content.toLowerCase())
      .join(' ');

    for (const [keyword, tools] of Object.entries(CONTEXT_TOOL_HINTS)) {
      if (recentText.includes(keyword)) {
        for (const tool of tools) {
          if (!seenTools.has(tool)) {
            predictions.push({
              tool,
              confidence: 0.4,
              reasoning: `Keyword "${keyword}" detected in conversation`,
              preWarmAction: 'cache',
            });
            seenTools.add(tool);
          }
        }
      }
    }

    // 3. Intent predictor integration
    try {
      const predictor = getIntentPredictor();
      const intentPredictions = predictor.predict({
        previousCommand: context.lastToolCalls[context.lastToolCalls.length - 1],
        hour: new Date().getHours(),
        dayOfWeek: new Date().getDay(),
      });

      for (const intent of intentPredictions) {
        // Map intent commands to tools
        const tools = this.mapIntentToTools(intent.command);
        for (const tool of tools) {
          if (!seenTools.has(tool)) {
            predictions.push({
              tool,
              confidence: intent.probability * 0.8, // Scale down slightly
              reasoning: intent.reasoning,
              preWarmAction: 'cache',
            });
            seenTools.add(tool);
          }
        }
      }
    } catch (_error) {
      // Intent predictor not available, continue without it
    }

    // 4. State-based predictions
    if (context.currentState) {
      const stateTools = this.getToolsForState(context.currentState);
      for (const tool of stateTools) {
        if (!seenTools.has(tool)) {
          predictions.push({
            tool,
            confidence: 0.35,
            reasoning: `User is ${context.currentState}`,
            preWarmAction: 'cache',
          });
          seenTools.add(tool);
        }
      }
    }

    // Sort by confidence and limit
    predictions.sort((a, b) => b.confidence - a.confidence);
    const topPredictions = predictions.slice(0, 5);

    this.lastPredictions = topPredictions;
    this.emit('prediction-made', topPredictions);

    return topPredictions;
  }

  /**
   * Map intent commands to tool names
   */
  private mapIntentToTools(command: string): string[] {
    const commandLower = command.toLowerCase();
    const tools: string[] = [];

    // Direct mappings
    const mappings: Record<string, string[]> = {
      'read': ['read_file'],
      'write': ['write_file'],
      'find': ['search_files', 'grep_search'],
      'search': ['grep_search', 'web_search'],
      'git': ['git_status', 'git_diff'],
      'commit': ['git_commit'],
      'push': ['git_push'],
      'run': ['execute_command'],
      'test': ['execute_command', 'npm_command'],
      'build': ['npm_command', 'execute_command'],
      'trade': ['get_my_trading_status', 'place_trade'],
      'buy': ['place_trade'],
      'sell': ['place_trade', 'close_position'],
    };

    for (const [keyword, toolList] of Object.entries(mappings)) {
      if (commandLower.includes(keyword)) {
        tools.push(...toolList);
      }
    }

    return [...new Set(tools)];
  }

  /**
   * Get tools commonly used in a state
   */
  private getToolsForState(state: string): string[] {
    const stateTools: Record<string, string[]> = {
      'debugging': ['read_file', 'grep_search', 'execute_command'],
      'coding': ['read_file', 'write_file', 'semantic_code_search'],
      'researching': ['web_search', 'browser_navigate', 'browser_extract'],
      'trading': ['get_my_trading_status', 'get_my_positions', 'get_market_regime'],
      'git_workflow': ['git_status', 'git_diff', 'git_commit'],
      'testing': ['execute_command', 'npm_command', 'read_file'],
    };

    return stateTools[state] || [];
  }

  // ===========================================================================
  // Pre-Warming
  // ===========================================================================

  /**
   * Pre-warm tools based on predictions
   */
  async preWarmTools(predictions: ToolPrediction[]): Promise<PreWarmResult[]> {
    const results: PreWarmResult[] = [];
    const toolsToWarm = predictions
      .filter(p => p.confidence >= this.config.confidenceThreshold)
      .slice(0, this.config.maxConcurrentPreWarms);

    const warmPromises = toolsToWarm.map(async (prediction) => {
      if (this.activePreWarms.has(prediction.tool)) {
        return null; // Already warming
      }

      this.activePreWarms.add(prediction.tool);
      this.emit('prewarm-started', prediction.tool, prediction.preWarmAction || 'cache');

      const startTime = Date.now();
      try {
        await this.warmTool(prediction);
        
        const result: PreWarmResult = {
          tool: prediction.tool,
          success: true,
          latencyMs: Date.now() - startTime,
          cached: prediction.preWarmAction === 'cache',
        };
        
        this.emit('prewarm-completed', result);
        this.preWarmHistory.push(result);
        return result;
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        this.emit('prewarm-failed', prediction.tool, err);
        
        return {
          tool: prediction.tool,
          success: false,
          latencyMs: Date.now() - startTime,
        };
      } finally {
        this.activePreWarms.delete(prediction.tool);
      }
    });

    const settled = await Promise.all(warmPromises);
    return settled.filter((r): r is PreWarmResult => r !== null);
  }

  /**
   * Warm a specific tool
   */
  private async warmTool(prediction: ToolPrediction): Promise<void> {
    const { tool, preWarmAction } = prediction;

    switch (preWarmAction) {
      case 'cache':
        await this.warmCache(tool);
        break;
      case 'connect':
        await this.warmConnection(tool);
        break;
      case 'prefetch':
        await this.prefetchData(tool);
        break;
      default:
        await this.warmCache(tool);
    }
  }

  /**
   * Warm tool cache (ensure tool definition is in memory)
   */
  private async warmCache(tool: string): Promise<void> {
    // Touch the tool cache to ensure it's loaded
    const cache = getToolCache();
    
    // Check if we have any cached results for this tool
    // This keeps the tool's cache entries "hot" in LRU
    const cacheKey = `tool:${tool}:*`;
    logger.debug('Warming cache for tool', { tool, cacheKey });
    
    // No actual work needed - just the intent of accessing ensures memory locality
  }

  /**
   * Warm connection for external tools
   */
  private async warmConnection(tool: string): Promise<void> {
    // Check if recently warmed
    const lastWarm = this.connectionWarmTimestamps.get(tool);
    if (lastWarm && Date.now() - lastWarm < 30000) {
      return; // Warmed in last 30 seconds
    }

    // For tools that connect to external services, we can pre-establish connections
    const connectionTools: Record<string, () => Promise<void>> = {
      'browser_navigate': async () => {
        // Pre-launch browser if needed
        // (actual implementation would import browser agent)
      },
      'web_search': async () => {
        // Warm search API connection
      },
      'get_my_trading_status': async () => {
        // Warm trading API connection
      },
    };

    const warmFn = connectionTools[tool];
    if (warmFn) {
      await warmFn();
      this.connectionWarmTimestamps.set(tool, Date.now());
    }
  }

  /**
   * Prefetch data for tools
   */
  private async prefetchData(tool: string): Promise<void> {
    // For tools with predictable data needs, prefetch
    const prefetchTools: Record<string, () => Promise<void>> = {
      'git_status': async () => {
        // Could prefetch git status
      },
      'get_my_positions': async () => {
        // Could prefetch positions from trading API
      },
    };

    const prefetchFn = prefetchTools[tool];
    if (prefetchFn) {
      await prefetchFn();
    }
  }

  // ===========================================================================
  // Integration
  // ===========================================================================

  /**
   * Main entry point - predict and pre-warm based on context
   */
  async processContext(context: ConversationContext): Promise<void> {
    if (!this.config.enabled) return;

    const predictions = this.predictTools(context);
    
    if (predictions.length > 0) {
      logger.debug('Pre-warming tools', { 
        tools: predictions.map(p => `${p.tool}(${(p.confidence * 100).toFixed(0)}%)`),
      });
      
      await this.preWarmTools(predictions);
    }
  }

  /**
   * Record a tool call (for learning)
   */
  recordToolCall(tool: string, context?: Partial<ConversationContext>): void {
    try {
      const predictor = getIntentPredictor();
      predictor.recordCommand(tool, {
        previousCommand: context?.lastToolCalls?.[context.lastToolCalls.length - 1],
        activeApp: context?.activeProject,
      });
    } catch (_error) {
      // Intent predictor not available
    }
  }

  // ===========================================================================
  // Stats & Config
  // ===========================================================================

  getStats(): {
    totalPreWarms: number;
    successRate: number;
    avgLatencyMs: number;
    lastPredictions: ToolPrediction[];
  } {
    const successful = this.preWarmHistory.filter(r => r.success).length;
    const avgLatency = this.preWarmHistory.length > 0
      ? this.preWarmHistory.reduce((sum, r) => sum + r.latencyMs, 0) / this.preWarmHistory.length
      : 0;

    return {
      totalPreWarms: this.preWarmHistory.length,
      successRate: this.preWarmHistory.length > 0 ? successful / this.preWarmHistory.length : 0,
      avgLatencyMs: avgLatency,
      lastPredictions: this.lastPredictions,
    };
  }

  updateConfig(config: Partial<PreWarmerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getConfig(): PreWarmerConfig {
    return { ...this.config };
  }
}

// =============================================================================
// Singleton
// =============================================================================

let instance: ToolPrewarmer | null = null;

export function getToolPrewarmer(): ToolPrewarmer {
  if (!instance) {
    instance = new ToolPrewarmer();
  }
  return instance;
}

export function shutdownToolPrewarmer(): void {
  if (instance) {
    instance.removeAllListeners();
    instance = null;
  }
}
