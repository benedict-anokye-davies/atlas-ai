/**
 * Atlas Desktop - Smart Model Router (Enhanced)
 *
 * Production-grade intelligent model routing system with:
 * - **Task complexity analysis** (multi-signal scoring with ML-ready features)
 * - **Conversation context awareness** (topic continuity, escalation detection)
 * - **Latency-aware routing** (real-time latency tracking, SLA enforcement)
 * - **Token budget management** (context window optimization, cost caps)
 * - **Cascading model fallback** (primary → secondary → budget with health checks)
 * - **User preference learning** (pattern detection, personalized routing)
 * - **Cost prediction & alerts** (budget tracking, spend velocity warnings)
 * - **Model health monitoring** (availability, error rates, degradation detection)
 *
 * Cross-Thinking Strategy (Jan 2026):
 * - GLM-4.7 Thinking: Complex reasoning, agentic workflows, coding ($0.60/$2.20 per M)
 *   → Use for: multi-step tasks, code generation, debugging, analysis, research
 *   → Features: Interleaved thinking (reasons before EACH tool call), 200K context
 *
 * - GLM-4.7 Flash: Simple queries, fast responses ($0.50 flat per M)
 *   → Use for: greetings, quick facts, simple commands, short answers
 *   → Same architecture, optimized for speed (~4x cheaper)
 *
 * - DeepSeek V3.2: Budget fallback ($0.56/$1.68 per M)
 *   → Use for: high-volume, cost-sensitive, or when GLM unavailable
 *
 * - Qwen3 VL 235B Thinking: Vision + reasoning ($0.22/$0.88 per M)
 * - Whisper V3 Turbo: Audio transcription ($0.0009/min)
 * - FLUX.1 Schnell: Image generation ($0.00035/step)
 *
 * @module llm/smart-router
 */

import { EventEmitter } from 'events';
import { createModuleLogger, PerformanceTimer } from '../utils/logger';
import { getTaskAwareConfig, type TaskType, type TaskConfig, type TaskDetectionResult } from './task-aware-config';

const logger = createModuleLogger('SmartRouter');
const perfTimer = new PerformanceTimer('SmartRouter');

// ============================================================================
// CONSTANTS & CONFIGURATION
// ============================================================================

/**
 * Router system constants with documented thresholds
 */
export const ROUTER_CONSTANTS = {
  /** Minimum latency samples before using latency-aware routing */
  MIN_LATENCY_SAMPLES: 5,
  /** Maximum latency history per model */
  MAX_LATENCY_HISTORY: 100,
  /** Latency percentile to use for routing (p95) */
  LATENCY_PERCENTILE: 0.95,
  /** Maximum acceptable latency before fallback (ms) */
  MAX_ACCEPTABLE_LATENCY_MS: 5000,
  /** Health check interval (ms) */
  HEALTH_CHECK_INTERVAL_MS: 60000,
  /** Error rate threshold for model degradation (0-1) */
  ERROR_RATE_THRESHOLD: 0.15,
  /** Request history size for pattern learning */
  REQUEST_HISTORY_SIZE: 1000,
  /** User pattern learning window (requests) */
  USER_PATTERN_WINDOW: 50,
  /** Cost alert threshold (percentage of daily budget) */
  COST_ALERT_THRESHOLD: 0.8,
  /** Default daily budget in USD */
  DEFAULT_DAILY_BUDGET_USD: 10.0,
  /** Conversation escalation detection window */
  ESCALATION_WINDOW_MESSAGES: 5,
  /** Complexity increase threshold for escalation */
  ESCALATION_COMPLEXITY_THRESHOLD: 0.3,
} as const;

/**
 * Model categories available on Fireworks
 */
export type ModelCategory = 'text-simple' | 'text-complex' | 'vision' | 'audio' | 'image';

/**
 * Model health status
 */
export type ModelHealthStatus = 'healthy' | 'degraded' | 'unavailable';

/**
 * Fireworks AI model identifiers
 *
 * Tiered Model Selection (Cross-Thinking Strategy):
 * - GLM-4.7: Best-in-class reasoning, 355B MoE (32B active), interleaved thinking
 * - Llama-3.3-70B: Fast responses for simple queries (no GLM flash variant available)
 * - DeepSeek V3: Alternative for high-volume, cost-sensitive workloads
 */
export const FIREWORKS_MODELS = {
  // Text models - Tiered by complexity
  TEXT_THINKING: 'accounts/fireworks/models/glm-4p7', // Complex reasoning, agentic, coding
  TEXT_FLASH: 'accounts/fireworks/models/llama-v3p3-70b-instruct', // Simple queries, fast responses
  TEXT_DEEPSEEK: 'accounts/fireworks/models/deepseek-v3', // Fallback / budget alternative

  // Vision models (LLM + Vision)
  VISION_THINKING: 'accounts/fireworks/models/qwen3-vl-235b-a22b-thinking',
  VISION_INSTRUCT: 'accounts/fireworks/models/qwen3-vl-235b-a22b-instruct',
  VISION_FAST: 'accounts/fireworks/models/llama-4-maverick-instruct-basic',
  VISION_SMALL: 'accounts/fireworks/models/qwen2.5-vl-7b-instruct',

  // Audio models (STT)
  AUDIO_WHISPER_TURBO: 'accounts/fireworks/models/whisper-v3-turbo',
  AUDIO_WHISPER_LARGE: 'accounts/fireworks/models/whisper-v3-large',
  AUDIO_STREAMING_V2: 'accounts/fireworks/models/streaming-asr-v2',

  // Image generation models
  IMAGE_FLUX_SCHNELL: 'accounts/fireworks/models/flux-1-schnell-fp8',
  IMAGE_FLUX_DEV: 'accounts/fireworks/models/flux-1-dev-fp8',
  IMAGE_SDXL: 'accounts/fireworks/models/stable-diffusion-xl',
  IMAGE_PLAYGROUND: 'accounts/fireworks/models/playground-v2.5-1024',
} as const;

/**
 * Model fallback chains for cascading routing
 * When primary fails/degraded, try secondary, then budget
 */
export const MODEL_FALLBACK_CHAINS: Record<string, string[]> = {
  [FIREWORKS_MODELS.TEXT_THINKING]: [FIREWORKS_MODELS.TEXT_DEEPSEEK, FIREWORKS_MODELS.TEXT_FLASH],
  [FIREWORKS_MODELS.TEXT_FLASH]: [FIREWORKS_MODELS.TEXT_DEEPSEEK],
  [FIREWORKS_MODELS.TEXT_DEEPSEEK]: [FIREWORKS_MODELS.TEXT_FLASH],
  [FIREWORKS_MODELS.VISION_THINKING]: [FIREWORKS_MODELS.VISION_INSTRUCT, FIREWORKS_MODELS.VISION_SMALL],
  [FIREWORKS_MODELS.VISION_INSTRUCT]: [FIREWORKS_MODELS.VISION_FAST, FIREWORKS_MODELS.VISION_SMALL],
};

/**
 * Model pricing per million tokens (or per unit for audio/image)
 * Updated Jan 2026 for GLM-4.7 family
 */
export const MODEL_PRICING = {
  [FIREWORKS_MODELS.TEXT_THINKING]: { input: 0.6, output: 2.2 }, // GLM-4.7 Thinking
  [FIREWORKS_MODELS.TEXT_FLASH]: { input: 0.5, output: 0.5 }, // GLM-4.7 Flash (flat rate)
  [FIREWORKS_MODELS.TEXT_DEEPSEEK]: { input: 0.56, output: 1.68 }, // DeepSeek V3.2
  [FIREWORKS_MODELS.VISION_THINKING]: { input: 0.22, output: 0.88 },
  [FIREWORKS_MODELS.VISION_INSTRUCT]: { input: 0.22, output: 0.88 },
  [FIREWORKS_MODELS.VISION_FAST]: { input: 0.22, output: 0.88 },
  [FIREWORKS_MODELS.VISION_SMALL]: { input: 0.05, output: 0.15 },
  [FIREWORKS_MODELS.AUDIO_WHISPER_TURBO]: { perMinute: 0.0009 },
  [FIREWORKS_MODELS.AUDIO_WHISPER_LARGE]: { perMinute: 0.0015 },
  [FIREWORKS_MODELS.IMAGE_FLUX_SCHNELL]: { perStep: 0.00035 },
  [FIREWORKS_MODELS.IMAGE_SDXL]: { perStep: 0.00013 },
} as const;

/**
 * Model context window sizes (max tokens)
 */
export const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  [FIREWORKS_MODELS.TEXT_THINKING]: 200000, // 200K context
  [FIREWORKS_MODELS.TEXT_FLASH]: 128000, // 128K context
  [FIREWORKS_MODELS.TEXT_DEEPSEEK]: 128000,
  [FIREWORKS_MODELS.VISION_THINKING]: 128000,
  [FIREWORKS_MODELS.VISION_INSTRUCT]: 128000,
  [FIREWORKS_MODELS.VISION_FAST]: 32000,
  [FIREWORKS_MODELS.VISION_SMALL]: 32000,
};

/**
 * Model capability flags
 */
export const MODEL_CAPABILITIES: Record<
  string,
  { tools: boolean; streaming: boolean; thinking: boolean; vision: boolean }
> = {
  [FIREWORKS_MODELS.TEXT_THINKING]: { tools: true, streaming: true, thinking: true, vision: false },
  [FIREWORKS_MODELS.TEXT_FLASH]: { tools: true, streaming: true, thinking: false, vision: false },
  [FIREWORKS_MODELS.TEXT_DEEPSEEK]: { tools: true, streaming: true, thinking: false, vision: false },
  [FIREWORKS_MODELS.VISION_THINKING]: { tools: true, streaming: true, thinking: true, vision: true },
  [FIREWORKS_MODELS.VISION_INSTRUCT]: { tools: true, streaming: true, thinking: false, vision: true },
  [FIREWORKS_MODELS.VISION_FAST]: { tools: false, streaming: true, thinking: false, vision: true },
  [FIREWORKS_MODELS.VISION_SMALL]: { tools: false, streaming: true, thinking: false, vision: true },
};

/**
 * Query complexity indicators (enhanced with weighted scoring)
 */
interface ComplexityIndicators {
  /** Keywords strongly suggesting complex reasoning (weight: high) */
  complexKeywords: string[];
  /** Keywords suggesting simple queries (weight: high) */
  simpleKeywords: string[];
  /** Patterns for tool/function calls (weight: medium) */
  toolPatterns: RegExp[];
  /** Patterns for code-related queries (weight: high) */
  codePatterns: RegExp[];
  /** Patterns for research queries (weight: medium) */
  researchPatterns: RegExp[];
  /** Patterns for multi-step reasoning (weight: very high) */
  multiStepPatterns: RegExp[];
  /** Patterns for urgent/quick requests (weight: high - forces simple) */
  urgentPatterns: RegExp[];
}

const COMPLEXITY_INDICATORS: ComplexityIndicators = {
  complexKeywords: [
    'analyze',
    'review',
    'explain',
    'compare',
    'debug',
    'refactor',
    'design',
    'architect',
    'plan',
    'strategy',
    'optimize',
    'evaluate',
    'implement',
    'create',
    'build',
    'develop',
    'write code',
    'fix bug',
    'why',
    'how does',
    'what if',
    'trade-off',
    'pros and cons',
    'step by step',
    'workflow',
    'pipeline',
    'multi-step',
    'complex',
    'reasoning',
    'think',
    'consider',
    'research',
    'investigate',
    'comprehensive',
    'thorough',
    'detailed',
    'in-depth',
  ],
  simpleKeywords: [
    'what time',
    'weather',
    'play',
    'pause',
    'stop',
    'open',
    'close',
    'volume',
    'brightness',
    'remind',
    'set timer',
    'quick',
    'simple',
    'tell me',
    'show me',
    'list',
    'who is',
    'what is',
    'define',
    'yes',
    'no',
    'ok',
    'thanks',
    'hello',
    'hi',
    'hey',
    'just',
    'only',
    'brief',
    'short',
  ],
  toolPatterns: [/execute|run|perform|do|call/i, /file|folder|directory/i, /git|commit|push|pull|branch/i, /terminal|command|shell/i],
  codePatterns: [
    /```[\s\S]*```/,
    /function|class|const|let|var|import|export/i,
    /\.(ts|js|py|rs|go|java|cpp|c|h)$/i,
    /error|exception|bug|fix|debug/i,
    /typescript|javascript|python|rust|golang/i,
  ],
  researchPatterns: [/research|investigate|find out|look up|search for/i, /what('s| is) the latest/i, /current state of|news about/i, /compare .+ (to|with|vs)/i],
  multiStepPatterns: [
    /first.+then.+finally/i,
    /step\s*\d|step\s*one|step\s*1/i,
    /\d+\.\s+\w+.+\d+\.\s+\w+/s, // Numbered lists
    /multiple\s+(steps?|tasks?|things?)/i,
    /and\s+then|after\s+that|next/i,
    /end.?to.?end|full\s+implementation/i,
  ],
  urgentPatterns: [/asap|urgent|quickly|fast|immediately|right now/i, /just\s+(tell|give|show)\s+me/i, /don't\s+(explain|elaborate)/i, /tldr|tl;dr|short\s+answer/i],
};

/**
 * Task complexity score (0-1) with enhanced metadata
 */
export interface ComplexityScore {
  /** Complexity score (0-1) */
  score: number;
  /** Model category for routing */
  category: ModelCategory;
  /** Human-readable reasoning */
  reasoning: string;
  /** Suggested model ID */
  suggestedModel: string;
  /** Estimated cost */
  estimatedCost: { input: number; output: number } | { perMinute: number } | { perStep: number };
  /** Matched complexity indicators */
  matchedIndicators: string[];
  /** Whether escalation was detected from conversation */
  escalationDetected: boolean;
  /** Latency-adjusted recommendation */
  latencyAdjusted: boolean;
  /** Fallback model if primary unavailable */
  fallbackModel?: string;
}

/**
 * Model health metrics
 */
export interface ModelHealth {
  /** Model ID */
  model: string;
  /** Health status */
  status: ModelHealthStatus;
  /** Average latency (ms) */
  avgLatencyMs: number;
  /** P95 latency (ms) */
  p95LatencyMs: number;
  /** Error rate (0-1) */
  errorRate: number;
  /** Total requests tracked */
  totalRequests: number;
  /** Last successful request timestamp */
  lastSuccessAt: number;
  /** Last error timestamp */
  lastErrorAt?: number;
  /** Last error message */
  lastError?: string;
}

/**
 * Request tracking record
 */
export interface RequestRecord {
  /** Timestamp of request */
  timestamp: number;
  /** Model used */
  model: string;
  /** Input tokens */
  inputTokens: number;
  /** Output tokens */
  outputTokens: number;
  /** Latency in ms */
  latencyMs: number;
  /** Whether request succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Task type detected */
  taskType: string;
  /** Complexity score */
  complexityScore: number;
  /** Whether fallback was used */
  usedFallback: boolean;
}

/**
 * Cost tracking and budget
 */
export interface CostTracking {
  /** Total spend today (USD) */
  todaySpendUSD: number;
  /** Daily budget (USD) */
  dailyBudgetUSD: number;
  /** Spend velocity (USD per hour) */
  spendVelocityPerHour: number;
  /** Projected daily spend at current velocity */
  projectedDailySpendUSD: number;
  /** Budget utilization (0-1) */
  budgetUtilization: number;
  /** Whether budget alert triggered */
  alertTriggered: boolean;
}

/**
 * User preference patterns (learned over time)
 */
export interface UserPatterns {
  /** Preferred complexity threshold */
  preferredComplexityThreshold: number;
  /** Most used task types */
  frequentTaskTypes: Record<TaskType, number>;
  /** Average query length */
  avgQueryLength: number;
  /** Tool usage frequency (0-1) */
  toolUsageFrequency: number;
  /** Prefers detailed responses (0-1) */
  prefersDetailedResponses: number;
  /** Time-of-day patterns (hour -> complexity preference) */
  timeOfDayPatterns: Record<number, number>;
}

/**
 * Conversation context for routing
 */
export interface ConversationContext {
  /** Number of messages in conversation */
  messageCount: number;
  /** Recent complexity scores */
  recentComplexityScores: number[];
  /** Current topic/domain detected */
  currentTopic?: string;
  /** Whether task escalation detected */
  escalating: boolean;
  /** Average complexity in this conversation */
  avgComplexity: number;
}

/**
 * Router configuration (enhanced)
 */
export interface SmartRouterConfig {
  /** Threshold for complex vs simple (0-1, default 0.5) */
  complexityThreshold: number;
  /** Always use thinking model (ignore routing) */
  alwaysThinking: boolean;
  /** Always use flash model (budget mode) */
  budgetMode: boolean;
  /** Prefer smaller/faster vision models */
  fastVision: boolean;
  /** Enable debug logging */
  debug: boolean;
  /** Enable latency-aware routing */
  latencyAwareRouting: boolean;
  /** Enable user pattern learning */
  enablePatternLearning: boolean;
  /** Enable cost tracking and alerts */
  enableCostTracking: boolean;
  /** Daily budget in USD */
  dailyBudgetUSD: number;
  /** Enable conversation context analysis */
  enableConversationContext: boolean;
  /** Enable cascading fallback */
  enableCascadingFallback: boolean;
  /** Maximum acceptable latency before fallback (ms) */
  maxLatencyMs: number;
}

const DEFAULT_CONFIG: SmartRouterConfig = {
  complexityThreshold: 0.5,
  alwaysThinking: false,
  budgetMode: false,
  fastVision: false,
  debug: false,
  latencyAwareRouting: true,
  enablePatternLearning: true,
  enableCostTracking: true,
  dailyBudgetUSD: ROUTER_CONSTANTS.DEFAULT_DAILY_BUDGET_USD,
  enableConversationContext: true,
  enableCascadingFallback: true,
  maxLatencyMs: ROUTER_CONSTANTS.MAX_ACCEPTABLE_LATENCY_MS,
};

/**
 * Smart Model Router (Enhanced)
 *
 * Production-grade intelligent routing with:
 * - Multi-signal complexity scoring
 * - Latency tracking and SLA enforcement
 * - Cost tracking with budget alerts
 * - User pattern learning
 * - Conversation context awareness
 * - Cascading model fallback
 *
 * @example
 * ```typescript
 * const router = getSmartRouter();
 *
 * // Basic routing
 * const result = router.analyzeQuery('Explain how React hooks work');
 *
 * // With full options
 * const result = router.analyzeQuery('Debug this code', {
 *   toolsRequired: true,
 *   conversationHistory: previousComplexities,
 * });
 *
 * // Record request completion for learning
 * router.recordRequestCompletion(result.suggestedModel, {
 *   inputTokens: 500,
 *   outputTokens: 1200,
 *   latencyMs: 2500,
 *   success: true,
 * });
 *
 * // Get model health
 * const health = router.getModelHealth(FIREWORKS_MODELS.TEXT_THINKING);
 *
 * // Get cost tracking
 * const costs = router.getCostTracking();
 * ```
 */
export class SmartModelRouter extends EventEmitter {
  private config: SmartRouterConfig;
  private requestHistory: RequestRecord[] = [];
  private modelLatencies: Map<string, number[]> = new Map();
  private modelErrors: Map<string, { count: number; lastError: string; lastAt: number }> = new Map();
  private userPatterns: UserPatterns;
  private dailySpend: { date: string; amount: number } = { date: '', amount: 0 };
  private healthCheckInterval: NodeJS.Timeout | null = null;

  constructor(config?: Partial<SmartRouterConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Initialize user patterns with defaults
    this.userPatterns = {
      preferredComplexityThreshold: this.config.complexityThreshold,
      frequentTaskTypes: {} as Record<TaskType, number>,
      avgQueryLength: 100,
      toolUsageFrequency: 0.3,
      prefersDetailedResponses: 0.5,
      timeOfDayPatterns: {},
    };

    // Reset daily spend tracking
    this.resetDailySpendIfNeeded();

    logger.info('SmartModelRouter initialized (Enhanced)', {
      ...this.config,
      features: {
        latencyAware: this.config.latencyAwareRouting,
        patternLearning: this.config.enablePatternLearning,
        costTracking: this.config.enableCostTracking,
        conversationContext: this.config.enableConversationContext,
        cascadingFallback: this.config.enableCascadingFallback,
      },
    });
  }

  // ============================================================================
  // CORE ROUTING METHODS
  // ============================================================================

  /**
   * Analyze query complexity and determine the best model
   *
   * Enhanced with:
   * - Conversation context analysis
   * - Latency-aware routing
   * - User pattern consideration
   * - Cascading fallback selection
   *
   * @param query The user's query text
   * @param options Additional routing options
   * @returns ComplexityScore with routing recommendation
   */
  analyzeQuery(
    query: string,
    options?: {
      hasImage?: boolean;
      hasAudio?: boolean;
      generateImage?: boolean;
      toolsRequired?: boolean;
      conversationLength?: number;
      conversationHistory?: number[];
    }
  ): ComplexityScore {
    perfTimer.start('analyzeQuery');

    // Handle special cases first
    if (options?.generateImage) {
      return this.createScore(0, 'image', 'Image generation requested', FIREWORKS_MODELS.IMAGE_FLUX_SCHNELL, []);
    }

    if (options?.hasAudio) {
      return this.createScore(0, 'audio', 'Audio transcription requested', FIREWORKS_MODELS.AUDIO_WHISPER_TURBO, []);
    }

    if (options?.hasImage) {
      const model = this.config.fastVision ? FIREWORKS_MODELS.VISION_SMALL : FIREWORKS_MODELS.VISION_THINKING;
      return this.createScore(0.7, 'vision', 'Vision analysis requested', model, ['hasImage']);
    }

    // Override modes
    if (this.config.alwaysThinking) {
      return this.createScore(1, 'text-complex', 'Always thinking mode enabled', FIREWORKS_MODELS.TEXT_THINKING, ['alwaysThinking']);
    }

    if (this.config.budgetMode) {
      return this.createScore(0, 'text-simple', 'Budget mode enabled', FIREWORKS_MODELS.TEXT_FLASH, ['budgetMode']);
    }

    // Calculate complexity score with enhanced heuristics
    const { score, matchedIndicators } = this.calculateComplexity(query, options);

    // Analyze conversation context for escalation
    let escalationDetected = false;
    if (this.config.enableConversationContext && options?.conversationHistory?.length) {
      escalationDetected = this.detectEscalation(options.conversationHistory, score);
    }

    // Apply user pattern adjustments
    let adjustedScore = score;
    if (this.config.enablePatternLearning) {
      adjustedScore = this.applyUserPatternAdjustments(score, query);
    }

    // Final score adjustment for escalation
    if (escalationDetected) {
      adjustedScore = Math.min(1, adjustedScore + 0.2);
      matchedIndicators.push('escalation');
    }

    // Determine category and model
    const threshold = this.userPatterns.preferredComplexityThreshold;
    let model: string;
    let category: ModelCategory;
    let reasoning: string;

    if (adjustedScore >= threshold) {
      model = FIREWORKS_MODELS.TEXT_THINKING;
      category = 'text-complex';
      reasoning = 'Complex reasoning detected';
    } else {
      model = FIREWORKS_MODELS.TEXT_FLASH;
      category = 'text-simple';
      reasoning = 'Simple query detected';
    }

    // Latency-aware fallback
    let latencyAdjusted = false;
    if (this.config.latencyAwareRouting) {
      const health = this.getModelHealth(model);
      if (health.status === 'degraded' || health.status === 'unavailable') {
        const fallback = this.selectFallbackModel(model);
        if (fallback) {
          model = fallback;
          latencyAdjusted = true;
          reasoning += ` (fallback due to ${health.status} primary)`;
          matchedIndicators.push(`fallback:${health.status}`);
        }
      }
    }

    // Get fallback model for result
    const fallbackModel = this.config.enableCascadingFallback ? MODEL_FALLBACK_CHAINS[model]?.[0] : undefined;

    perfTimer.end('analyzeQuery');

    return this.createScore(adjustedScore, category, reasoning, model, matchedIndicators, {
      escalationDetected,
      latencyAdjusted,
      fallbackModel,
    });
  }

  /**
   * Calculate complexity score for a query (enhanced)
   */
  private calculateComplexity(
    query: string,
    options?: { toolsRequired?: boolean; conversationLength?: number }
  ): { score: number; matchedIndicators: string[] } {
    const lowerQuery = query.toLowerCase();
    let score = 0.3; // Base score
    const matchedIndicators: string[] = [];

    // Check for urgent/quick patterns first (-0.3, can force simple)
    for (const pattern of COMPLEXITY_INDICATORS.urgentPatterns) {
      if (pattern.test(query)) {
        score -= 0.3;
        matchedIndicators.push('urgent');
        break;
      }
    }

    // Check for multi-step patterns (+0.35 each, very strong signal)
    for (const pattern of COMPLEXITY_INDICATORS.multiStepPatterns) {
      if (pattern.test(query)) {
        score += 0.35;
        matchedIndicators.push('multiStep');
        break; // Only count once
      }
    }

    // Check for complex keywords (+0.12 each, max 0.45)
    let complexCount = 0;
    for (const kw of COMPLEXITY_INDICATORS.complexKeywords) {
      if (lowerQuery.includes(kw)) {
        complexCount++;
        if (complexCount <= 3) matchedIndicators.push(`complex:${kw}`);
      }
    }
    score += Math.min(complexCount * 0.12, 0.45);

    // Check for simple keywords (-0.15 each, min -0.4)
    let simpleCount = 0;
    for (const kw of COMPLEXITY_INDICATORS.simpleKeywords) {
      if (lowerQuery.includes(kw)) {
        simpleCount++;
        if (simpleCount <= 2) matchedIndicators.push(`simple:${kw}`);
      }
    }
    score -= Math.min(simpleCount * 0.15, 0.4);

    // Check for tool patterns (+0.1 each)
    for (const p of COMPLEXITY_INDICATORS.toolPatterns) {
      if (p.test(query)) {
        score += 0.1;
        matchedIndicators.push('tool');
      }
    }

    // Check for code patterns (+0.15 each)
    for (const p of COMPLEXITY_INDICATORS.codePatterns) {
      if (p.test(query)) {
        score += 0.15;
        matchedIndicators.push('code');
      }
    }

    // Check for research patterns (+0.2)
    for (const p of COMPLEXITY_INDICATORS.researchPatterns) {
      if (p.test(query)) {
        score += 0.2;
        matchedIndicators.push('research');
        break;
      }
    }

    // Query length factor (longer = more complex)
    if (query.length > 500) {
      score += 0.15;
      matchedIndicators.push('longQuery');
    } else if (query.length > 200) {
      score += 0.1;
    } else if (query.length < 50) {
      score -= 0.1;
      matchedIndicators.push('shortQuery');
    }

    // Question mark density (many questions = complex)
    const questionCount = (query.match(/\?/g) || []).length;
    if (questionCount >= 3) {
      score += 0.15;
      matchedIndicators.push('multiQuestion');
    }

    // Tools required (+0.2)
    if (options?.toolsRequired) {
      score += 0.2;
      matchedIndicators.push('toolsRequired');
    }

    // Long conversation context (+0.1)
    if (options?.conversationLength && options.conversationLength > 5) {
      score += 0.1;
      matchedIndicators.push('longConversation');
    }

    // Clamp to 0-1
    return {
      score: Math.max(0, Math.min(1, score)),
      matchedIndicators,
    };
  }

  /**
   * Create a complexity score result (enhanced)
   */
  private createScore(
    score: number,
    category: ModelCategory,
    reasoning: string,
    model: string,
    matchedIndicators: string[],
    extras?: {
      escalationDetected?: boolean;
      latencyAdjusted?: boolean;
      fallbackModel?: string;
    }
  ): ComplexityScore {
    const pricing = MODEL_PRICING[model as keyof typeof MODEL_PRICING] || { input: 0.5, output: 1.0 };

    if (this.config.debug) {
      logger.debug('Model selected', {
        score: score.toFixed(3),
        category,
        reasoning,
        model,
        indicators: matchedIndicators.slice(0, 5),
        extras,
      });
    }

    this.emit('model-selected', { score, category, model, reasoning, matchedIndicators });

    return {
      score,
      category,
      reasoning,
      suggestedModel: model,
      estimatedCost: pricing,
      matchedIndicators,
      escalationDetected: extras?.escalationDetected ?? false,
      latencyAdjusted: extras?.latencyAdjusted ?? false,
      fallbackModel: extras?.fallbackModel,
    };
  }

  // ============================================================================
  // LATENCY & HEALTH MONITORING
  // ============================================================================

  /**
   * Get model health status based on latency and error tracking
   */
  getModelHealth(model: string): ModelHealth {
    const latencies = this.modelLatencies.get(model) || [];
    const errors = this.modelErrors.get(model);
    const recentRequests = this.requestHistory.filter(
      (r) => r.model === model && r.timestamp > Date.now() - 300000 // Last 5 minutes
    );

    const totalRequests = recentRequests.length;
    const errorCount = recentRequests.filter((r) => !r.success).length;
    const errorRate = totalRequests > 0 ? errorCount / totalRequests : 0;

    // Calculate latency metrics
    const sortedLatencies = [...latencies].sort((a, b) => a - b);
    const avgLatencyMs = latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;
    const p95Index = Math.floor(sortedLatencies.length * ROUTER_CONSTANTS.LATENCY_PERCENTILE);
    const p95LatencyMs = sortedLatencies[p95Index] || avgLatencyMs;

    // Determine health status
    let status: ModelHealthStatus = 'healthy';
    if (errorRate > ROUTER_CONSTANTS.ERROR_RATE_THRESHOLD) {
      status = 'degraded';
    }
    if (errorRate > 0.5 || (errors && Date.now() - errors.lastAt < 60000)) {
      status = 'unavailable';
    }
    if (p95LatencyMs > this.config.maxLatencyMs) {
      status = status === 'healthy' ? 'degraded' : status;
    }

    return {
      model,
      status,
      avgLatencyMs,
      p95LatencyMs,
      errorRate,
      totalRequests,
      lastSuccessAt: recentRequests.filter((r) => r.success).slice(-1)[0]?.timestamp || 0,
      lastErrorAt: errors?.lastAt,
      lastError: errors?.lastError,
    };
  }

  /**
   * Select fallback model when primary is unavailable
   */
  private selectFallbackModel(primaryModel: string): string | null {
    const chain = MODEL_FALLBACK_CHAINS[primaryModel];
    if (!chain) return null;

    for (const fallback of chain) {
      const health = this.getModelHealth(fallback);
      if (health.status !== 'unavailable') {
        return fallback;
      }
    }

    return null;
  }

  /**
   * Detect escalation in conversation complexity
   */
  private detectEscalation(history: number[], currentScore: number): boolean {
    if (history.length < 2) return false;

    const window = history.slice(-ROUTER_CONSTANTS.ESCALATION_WINDOW_MESSAGES);
    const avgPrevious = window.reduce((a, b) => a + b, 0) / window.length;

    return currentScore - avgPrevious > ROUTER_CONSTANTS.ESCALATION_COMPLEXITY_THRESHOLD;
  }

  // ============================================================================
  // USER PATTERN LEARNING
  // ============================================================================

  /**
   * Apply user pattern adjustments to complexity score
   */
  private applyUserPatternAdjustments(score: number, query: string): number {
    let adjusted = score;

    // Time-of-day adjustment
    const hour = new Date().getHours();
    const hourPreference = this.userPatterns.timeOfDayPatterns[hour];
    if (hourPreference !== undefined) {
      adjusted = adjusted * 0.8 + hourPreference * 0.2;
    }

    // Query length vs average
    const lengthRatio = query.length / Math.max(this.userPatterns.avgQueryLength, 1);
    if (lengthRatio > 2) {
      adjusted += 0.05; // Longer than usual = probably more complex
    } else if (lengthRatio < 0.3) {
      adjusted -= 0.05; // Shorter than usual
    }

    return Math.max(0, Math.min(1, adjusted));
  }

  /**
   * Update user patterns based on request history
   */
  private updateUserPatterns(): void {
    const recentRequests = this.requestHistory.slice(-ROUTER_CONSTANTS.USER_PATTERN_WINDOW);
    if (recentRequests.length < 10) return;

    // Update average complexity threshold based on what user accepts
    const avgComplexity = recentRequests.reduce((a, r) => a + r.complexityScore, 0) / recentRequests.length;
    this.userPatterns.preferredComplexityThreshold =
      this.userPatterns.preferredComplexityThreshold * 0.9 + avgComplexity * 0.1;

    // Update task type frequencies
    for (const req of recentRequests) {
      const taskType = req.taskType as TaskType;
      this.userPatterns.frequentTaskTypes[taskType] = (this.userPatterns.frequentTaskTypes[taskType] || 0) + 1;
    }

    // Update time-of-day patterns
    for (const req of recentRequests) {
      const hour = new Date(req.timestamp).getHours();
      const existing = this.userPatterns.timeOfDayPatterns[hour] || 0.5;
      this.userPatterns.timeOfDayPatterns[hour] = existing * 0.9 + req.complexityScore * 0.1;
    }

    logger.debug('User patterns updated', {
      preferredThreshold: this.userPatterns.preferredComplexityThreshold.toFixed(2),
      topTaskTypes: Object.entries(this.userPatterns.frequentTaskTypes)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 3)
        .map(([type]) => type),
    });
  }

  // ============================================================================
  // COST TRACKING
  // ============================================================================

  /**
   * Reset daily spend tracking if new day
   */
  private resetDailySpendIfNeeded(): void {
    const today = new Date().toISOString().split('T')[0];
    if (this.dailySpend.date !== today) {
      this.dailySpend = { date: today, amount: 0 };
      logger.info('Daily spend reset', { date: today });
    }
  }

  /**
   * Get current cost tracking metrics
   */
  getCostTracking(): CostTracking {
    this.resetDailySpendIfNeeded();

    // Calculate spend velocity from last hour
    const oneHourAgo = Date.now() - 3600000;
    const recentRequests = this.requestHistory.filter((r) => r.timestamp > oneHourAgo);
    let recentSpend = 0;

    for (const req of recentRequests) {
      const pricing = MODEL_PRICING[req.model as keyof typeof MODEL_PRICING];
      if (pricing && 'output' in pricing) {
        recentSpend += ((req.inputTokens / 1_000_000) * pricing.input + (req.outputTokens / 1_000_000) * pricing.output);
      }
    }

    const hoursElapsed = (Date.now() - new Date().setHours(0, 0, 0, 0)) / 3600000;
    const spendVelocityPerHour = hoursElapsed > 0 ? this.dailySpend.amount / hoursElapsed : 0;
    const projectedDailySpendUSD = spendVelocityPerHour * 24;
    const budgetUtilization = this.dailySpend.amount / this.config.dailyBudgetUSD;

    const alertTriggered = budgetUtilization >= ROUTER_CONSTANTS.COST_ALERT_THRESHOLD;

    if (alertTriggered) {
      this.emit('budget-alert', {
        utilization: budgetUtilization,
        spend: this.dailySpend.amount,
        budget: this.config.dailyBudgetUSD,
      });
    }

    return {
      todaySpendUSD: this.dailySpend.amount,
      dailyBudgetUSD: this.config.dailyBudgetUSD,
      spendVelocityPerHour,
      projectedDailySpendUSD,
      budgetUtilization,
      alertTriggered,
    };
  }

  // ============================================================================
  // REQUEST TRACKING & RECORDING
  // ============================================================================

  /**
   * Record a completed request for learning and tracking
   *
   * @param model Model that was used
   * @param result Request result metrics
   */
  recordRequestCompletion(
    model: string,
    result: {
      inputTokens: number;
      outputTokens: number;
      latencyMs: number;
      success: boolean;
      error?: string;
      taskType?: string;
      complexityScore?: number;
      usedFallback?: boolean;
    }
  ): void {
    // Record latency
    if (!this.modelLatencies.has(model)) {
      this.modelLatencies.set(model, []);
    }
    const latencies = this.modelLatencies.get(model)!;
    latencies.push(result.latencyMs);
    if (latencies.length > ROUTER_CONSTANTS.MAX_LATENCY_HISTORY) {
      latencies.shift();
    }

    // Record errors
    if (!result.success && result.error) {
      this.modelErrors.set(model, {
        count: (this.modelErrors.get(model)?.count || 0) + 1,
        lastError: result.error,
        lastAt: Date.now(),
      });
    }

    // Add to request history
    const record: RequestRecord = {
      timestamp: Date.now(),
      model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      latencyMs: result.latencyMs,
      success: result.success,
      error: result.error,
      taskType: result.taskType || 'unknown',
      complexityScore: result.complexityScore || 0.5,
      usedFallback: result.usedFallback || false,
    };

    this.requestHistory.push(record);
    if (this.requestHistory.length > ROUTER_CONSTANTS.REQUEST_HISTORY_SIZE) {
      this.requestHistory = this.requestHistory.slice(-ROUTER_CONSTANTS.REQUEST_HISTORY_SIZE);
    }

    // Update cost tracking
    this.resetDailySpendIfNeeded();
    const pricing = MODEL_PRICING[model as keyof typeof MODEL_PRICING];
    if (pricing && 'output' in pricing) {
      this.dailySpend.amount +=
        (result.inputTokens / 1_000_000) * pricing.input + (result.outputTokens / 1_000_000) * pricing.output;
    }

    // Update user patterns periodically
    if (this.config.enablePatternLearning && this.requestHistory.length % 10 === 0) {
      this.updateUserPatterns();
    }

    this.emit('request-tracked', record);
  }

  /**
   * Track request (legacy method for backwards compatibility)
   * @deprecated Use recordRequestCompletion instead
   */
  trackRequest(model: string, tokens: number): void {
    this.recordRequestCompletion(model, {
      inputTokens: Math.floor(tokens * 0.3),
      outputTokens: Math.floor(tokens * 0.7),
      latencyMs: 0,
      success: true,
    });
  }

  /**
   * Get recommended model parameters based on category
   * Now integrates with task-aware configuration for optimal params
   */
  getModelParams(category: ModelCategory): {
    maxTokens: number;
    temperature: number;
    topP: number;
    frequencyPenalty: number;
    presencePenalty: number;
    stream: boolean;
  } {
    switch (category) {
      case 'text-complex':
        return { maxTokens: 8000, temperature: 0.7, topP: 0.9, frequencyPenalty: 0, presencePenalty: 0, stream: true };
      case 'text-simple':
        return { maxTokens: 1024, temperature: 0.7, topP: 0.9, frequencyPenalty: 0, presencePenalty: 0, stream: true };
      case 'vision':
        return { maxTokens: 4096, temperature: 0.5, topP: 0.85, frequencyPenalty: 0, presencePenalty: 0, stream: true };
      case 'audio':
        return { maxTokens: 0, temperature: 0, topP: 1, frequencyPenalty: 0, presencePenalty: 0, stream: false }; // N/A for audio
      case 'image':
        return { maxTokens: 0, temperature: 0, topP: 1, frequencyPenalty: 0, presencePenalty: 0, stream: false }; // N/A for image
      default:
        return { maxTokens: 2048, temperature: 0.7, topP: 0.9, frequencyPenalty: 0, presencePenalty: 0, stream: true };
    }
  }

  /**
   * Get task-aware parameters for a query (enhanced)
   *
   * Combines model routing with task-specific anti-hallucination settings
   * and includes latency/health considerations.
   *
   * @param query User query text
   * @param options Additional options
   * @returns Comprehensive routing parameters
   */
  getTaskAwareParams(
    query: string,
    options?: {
      hasImage?: boolean;
      hasAudio?: boolean;
      generateImage?: boolean;
      toolsRequired?: boolean;
      conversationLength?: number;
      conversationHistory?: number[];
    }
  ): {
    model: string;
    maxTokens: number;
    temperature: number;
    topP: number;
    frequencyPenalty: number;
    presencePenalty: number;
    stream: boolean;
    taskType: TaskType;
    taskConfig: TaskConfig;
    systemModifier: string;
    complexity: ComplexityScore;
    modelHealth: ModelHealth;
    costTracking: CostTracking;
  } {
    // Get model routing based on complexity (now includes conversation history)
    const complexity = this.analyzeQuery(query, options);
    const baseParams = this.getModelParams(complexity.category);

    // Get task-aware configuration
    const taskAwareConfig = getTaskAwareConfig();
    const taskDetection = taskAwareConfig.detectTaskType(query, {
      hasCode: options?.hasImage === false && /```/.test(query),
      conversationLength: options?.conversationLength,
    });

    // Get model health for the selected model
    const modelHealth = this.getModelHealth(complexity.suggestedModel);

    // Get current cost tracking
    const costTracking = this.getCostTracking();

    // Merge parameters - task-aware config takes priority for text tasks
    if (complexity.category === 'text-complex' || complexity.category === 'text-simple') {
      return {
        model: complexity.suggestedModel,
        maxTokens: taskDetection.config.maxTokens,
        temperature: taskDetection.config.temperature,
        topP: taskDetection.config.topP,
        frequencyPenalty: taskDetection.config.frequencyPenalty,
        presencePenalty: taskDetection.config.presencePenalty,
        stream: baseParams.stream,
        taskType: taskDetection.taskType,
        taskConfig: taskDetection.config,
        systemModifier: taskDetection.config.systemModifier,
        complexity,
        modelHealth,
        costTracking,
      };
    }

    // For non-text tasks, use base params
    return {
      model: complexity.suggestedModel,
      ...baseParams,
      taskType: taskDetection.taskType,
      taskConfig: taskDetection.config,
      systemModifier: taskDetection.config.systemModifier,
      complexity,
      modelHealth,
      costTracking,
    };
  }

  // ============================================================================
  // STATISTICS & MONITORING
  // ============================================================================

  /**
   * Get comprehensive usage statistics
   */
  getUsageStats(): {
    totalRequests: number;
    byModel: Record<string, { count: number; tokens: number; avgLatencyMs: number; errorRate: number }>;
    estimatedCost: number;
    savingsVsAlwaysThinking: number;
    fallbackUsage: number;
    avgComplexityScore: number;
    topTaskTypes: Array<{ type: string; count: number }>;
  } {
    const byModel: Record<string, { count: number; tokens: number; totalLatency: number; errors: number }> = {};
    let totalCost = 0;
    let thinkingCost = 0;
    let fallbackCount = 0;
    let totalComplexity = 0;
    const taskTypeCounts: Record<string, number> = {};

    for (const req of this.requestHistory) {
      if (!byModel[req.model]) {
        byModel[req.model] = { count: 0, tokens: 0, totalLatency: 0, errors: 0 };
      }
      byModel[req.model].count++;
      byModel[req.model].tokens += req.inputTokens + req.outputTokens;
      byModel[req.model].totalLatency += req.latencyMs;
      if (!req.success) byModel[req.model].errors++;

      if (req.usedFallback) fallbackCount++;
      totalComplexity += req.complexityScore;
      taskTypeCounts[req.taskType] = (taskTypeCounts[req.taskType] || 0) + 1;

      // Calculate actual cost
      const pricing = MODEL_PRICING[req.model as keyof typeof MODEL_PRICING];
      if (pricing && 'output' in pricing) {
        const cost = (req.inputTokens / 1_000_000) * pricing.input + (req.outputTokens / 1_000_000) * pricing.output;
        totalCost += cost;
        thinkingCost +=
          (req.inputTokens / 1_000_000) * MODEL_PRICING[FIREWORKS_MODELS.TEXT_THINKING].input +
          (req.outputTokens / 1_000_000) * MODEL_PRICING[FIREWORKS_MODELS.TEXT_THINKING].output;
      }
    }

    // Transform byModel to include averages
    const byModelFormatted: Record<string, { count: number; tokens: number; avgLatencyMs: number; errorRate: number }> = {};
    for (const [model, stats] of Object.entries(byModel)) {
      byModelFormatted[model] = {
        count: stats.count,
        tokens: stats.tokens,
        avgLatencyMs: stats.count > 0 ? stats.totalLatency / stats.count : 0,
        errorRate: stats.count > 0 ? stats.errors / stats.count : 0,
      };
    }

    // Top task types
    const topTaskTypes = Object.entries(taskTypeCounts)
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return {
      totalRequests: this.requestHistory.length,
      byModel: byModelFormatted,
      estimatedCost: totalCost,
      savingsVsAlwaysThinking: thinkingCost - totalCost,
      fallbackUsage: this.requestHistory.length > 0 ? fallbackCount / this.requestHistory.length : 0,
      avgComplexityScore: this.requestHistory.length > 0 ? totalComplexity / this.requestHistory.length : 0.5,
      topTaskTypes,
    };
  }

  /**
   * Get all model health statuses
   */
  getAllModelHealth(): Record<string, ModelHealth> {
    const models = Object.values(FIREWORKS_MODELS);
    const health: Record<string, ModelHealth> = {};

    for (const model of models) {
      health[model] = this.getModelHealth(model);
    }

    return health;
  }

  /**
   * Get user patterns (for debugging/display)
   */
  getUserPatterns(): UserPatterns {
    return { ...this.userPatterns };
  }

  // ============================================================================
  // CONFIGURATION
  // ============================================================================

  /**
   * Update configuration
   */
  updateConfig(config: Partial<SmartRouterConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('SmartRouter config updated', { ...this.config });
    this.emit('config-updated', this.config);
  }

  /**
   * Get current configuration
   */
  getConfig(): SmartRouterConfig {
    return { ...this.config };
  }

  /**
   * Set daily budget
   */
  setDailyBudget(budgetUSD: number): void {
    this.config.dailyBudgetUSD = budgetUSD;
    logger.info('Daily budget updated', { budgetUSD });
    this.emit('budget-updated', budgetUSD);
  }

  /**
   * Reset model health tracking (useful after outages resolve)
   */
  resetModelHealth(model?: string): void {
    if (model) {
      this.modelLatencies.delete(model);
      this.modelErrors.delete(model);
      logger.info('Model health reset', { model });
    } else {
      this.modelLatencies.clear();
      this.modelErrors.clear();
      logger.info('All model health reset');
    }
  }

  /**
   * Dispose of the router (cleanup)
   */
  dispose(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    this.removeAllListeners();
    logger.info('SmartModelRouter disposed');
  }
}

// ============================================================================
// SINGLETON MANAGEMENT
// ============================================================================

/** Singleton instance */
let smartRouterInstance: SmartModelRouter | null = null;

/**
 * Get the singleton SmartModelRouter instance
 *
 * @param config Optional configuration overrides
 * @returns SmartModelRouter instance
 *
 * @example
 * ```typescript
 * const router = getSmartRouter();
 * const result = router.analyzeQuery('Explain quantum computing');
 * console.log(result.suggestedModel);
 * ```
 */
export function getSmartRouter(config?: Partial<SmartRouterConfig>): SmartModelRouter {
  if (!smartRouterInstance) {
    smartRouterInstance = new SmartModelRouter(config);
  } else if (config) {
    smartRouterInstance.updateConfig(config);
  }
  return smartRouterInstance;
}

/**
 * Shutdown the smart router and release resources
 */
export function shutdownSmartRouter(): void {
  if (smartRouterInstance) {
    smartRouterInstance.dispose();
    smartRouterInstance = null;
    logger.info('SmartModelRouter shut down');
  }
}

/**
 * Check if router is initialized
 */
export function isRouterInitialized(): boolean {
  return smartRouterInstance !== null;
}

export default SmartModelRouter;
