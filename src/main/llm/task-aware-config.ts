/**
 * Atlas Desktop - Task-Aware LLM Configuration
 *
 * Dynamically adjusts LLM parameters based on detected task type:
 * - Factual: Low temp (0.2), grounding instructions, strict outputs
 * - Coding: Medium-low temp (0.3), precise outputs, error handling
 * - Creative: Higher temp (0.8), exploratory outputs
 * - Analysis: Low-medium temp (0.3), step-by-step reasoning
 * - Conversational: Medium temp (0.5), natural flow
 *
 * Anti-hallucination strategies:
 * - Task-specific system prompt modifiers
 * - Dynamic temperature/top_p adjustment
 * - Grounding instructions for factual tasks
 * - Explicit uncertainty acknowledgment
 *
 * @module llm/task-aware-config
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('TaskAwareConfig');

/**
 * Task types the system can detect and optimize for
 */
export type TaskType =
  | 'factual'
  | 'coding'
  | 'creative'
  | 'conversational'
  | 'analysis'
  | 'trading'
  | 'research'
  | 'debugging';

/**
 * Confidence level for task detection
 */
export type DetectionConfidence = 'high' | 'medium' | 'low';

/**
 * Configuration for a specific task type
 */
export interface TaskConfig {
  /** Temperature (0-1) - lower = more deterministic */
  temperature: number;
  /** Top-p nucleus sampling (0-1) */
  topP: number;
  /** Maximum tokens to generate */
  maxTokens: number;
  /** Frequency penalty to reduce repetition */
  frequencyPenalty: number;
  /** Presence penalty for topic diversity */
  presencePenalty: number;
  /** System prompt modifier to append */
  systemModifier: string;
  /** Whether to enable chain-of-thought reasoning */
  chainOfThought: boolean;
  /** Whether to request structured JSON output */
  structuredOutput: boolean;
}

/**
 * Result of task type detection
 */
export interface TaskDetectionResult {
  /** Detected task type */
  taskType: TaskType;
  /** Confidence level */
  confidence: DetectionConfidence;
  /** Confidence score (0-1) */
  confidenceScore: number;
  /** Matched indicators that led to detection */
  matchedIndicators: string[];
  /** Reasoning for the detection */
  reasoning: string;
  /** Task configuration to apply */
  config: TaskConfig;
  /** Whether clarification is needed to determine complexity */
  needsClarification: boolean;
  /** Suggested clarifying question if needed */
  clarifyingQuestion?: string;
  /** Complexity level (simple vs complex) */
  complexity: 'simple' | 'complex' | 'uncertain';
}

/**
 * Clarification response from user
 */
export interface ClarificationResponse {
  /** The original query */
  originalQuery: string;
  /** User's answer to clarifying question */
  answer: string;
  /** Detected complexity based on answer */
  complexity: 'simple' | 'complex';
  /** Updated task detection result */
  updatedResult: TaskDetectionResult;
}

/**
 * Task detection patterns
 */
interface TaskPatterns {
  /** Keywords strongly indicating the task */
  strongKeywords: string[];
  /** Keywords weakly indicating the task */
  weakKeywords: string[];
  /** Regex patterns for detection */
  patterns: RegExp[];
  /** Negative patterns (reduce confidence) */
  negativePatterns?: RegExp[];
}

/**
 * Task-specific configurations optimized for reducing hallucinations
 */
export const TASK_CONFIGS: Record<TaskType, TaskConfig> = {
  factual: {
    temperature: 0.2,
    topP: 0.7,
    maxTokens: 1000,
    frequencyPenalty: 0,
    presencePenalty: 0,
    systemModifier: `FACTUAL TASK MODE:
- Be precise and accurate. Only state verified facts.
- If you don't know or aren't certain, say "I don't have enough information" or "I'm not certain about this."
- Never fabricate facts, citations, statistics, or data.
- Distinguish clearly between what you know vs. what you're inferring.
- If making an inference, explicitly label it as such.
- Prefer saying "I don't know" over guessing.`,
    chainOfThought: false,
    structuredOutput: false,
  },

  coding: {
    temperature: 0.3,
    topP: 0.8,
    maxTokens: 2500,
    frequencyPenalty: 0.1,
    presencePenalty: 0,
    systemModifier: `CODING TASK MODE:
- Write clean, working, production-ready code.
- No placeholder comments like "// implement this" or "// TODO".
- Handle edge cases and errors gracefully.
- If unsure about syntax or API, say so rather than guessing.
- Include brief comments only for non-obvious logic.
- Match existing code style if context is provided.
- If you can't implement something fully, explain what's missing.`,
    chainOfThought: false,
    structuredOutput: false,
  },

  creative: {
    temperature: 0.8,
    topP: 0.95,
    maxTokens: 2000,
    frequencyPenalty: 0.3,
    presencePenalty: 0.3,
    systemModifier: `CREATIVE TASK MODE:
- Be creative, expressive, and exploratory.
- Take risks with ideas and language.
- Don't hedge or qualify unless asked.
- Embrace unique perspectives and unconventional approaches.`,
    chainOfThought: false,
    structuredOutput: false,
  },

  conversational: {
    temperature: 0.5,
    topP: 0.9,
    maxTokens: 500,
    frequencyPenalty: 0.1,
    presencePenalty: 0.1,
    systemModifier: `CONVERSATIONAL MODE:
- Be natural, concise, and match the user's tone.
- Keep responses brief unless more detail is requested.
- If uncertain about something, ask for clarification rather than assuming.`,
    chainOfThought: false,
    structuredOutput: false,
  },

  analysis: {
    temperature: 0.3,
    topP: 0.85,
    maxTokens: 2000,
    frequencyPenalty: 0,
    presencePenalty: 0.1,
    systemModifier: `ANALYSIS TASK MODE:
- Think step by step. Show your reasoning process.
- Clearly distinguish between facts, inferences, and opinions.
- Consider multiple perspectives before concluding.
- Acknowledge limitations in your analysis.
- If data is insufficient, say so explicitly.
- Quantify uncertainty where possible: "likely", "possibly", "uncertain".`,
    chainOfThought: true,
    structuredOutput: false,
  },

  trading: {
    temperature: 0.2,
    topP: 0.7,
    maxTokens: 1500,
    frequencyPenalty: 0,
    presencePenalty: 0,
    systemModifier: `TRADING/FINANCIAL TASK MODE:
- Be extremely precise with numbers, prices, and percentages.
- Never fabricate price data, market statistics, or financial metrics.
- Always acknowledge that past performance doesn't guarantee future results.
- If you don't have real-time data, say so explicitly.
- Distinguish between analysis and recommendation.
- Include risk warnings for any trading suggestions.
- Be conservative in predictions - better to understate than overstate.`,
    chainOfThought: true,
    structuredOutput: false,
  },

  research: {
    temperature: 0.3,
    topP: 0.8,
    maxTokens: 2500,
    frequencyPenalty: 0.1,
    presencePenalty: 0.1,
    systemModifier: `RESEARCH TASK MODE:
- Synthesize information from provided context.
- Clearly cite sources when available.
- If no source is provided, explicitly state "based on my training data" or "I don't have a specific source."
- Distinguish between established facts and emerging/contested information.
- Note when information might be outdated.
- If asked about current events, acknowledge your knowledge cutoff.`,
    chainOfThought: true,
    structuredOutput: false,
  },

  debugging: {
    temperature: 0.2,
    topP: 0.7,
    maxTokens: 2000,
    frequencyPenalty: 0,
    presencePenalty: 0,
    systemModifier: `DEBUGGING TASK MODE:
- Be systematic and methodical.
- Start with the most likely causes first.
- Explain your reasoning for each hypothesis.
- If you're not sure what's wrong, list possibilities ranked by likelihood.
- Never claim certainty about a bug's cause without clear evidence.
- Suggest diagnostic steps to confirm hypotheses.
- If you can't identify the issue, say so and suggest next steps.`,
    chainOfThought: true,
    structuredOutput: false,
  },
};

/**
 * Task detection patterns for each task type
 */
const TASK_PATTERNS: Record<TaskType, TaskPatterns> = {
  factual: {
    strongKeywords: [
      'what is', 'define', 'explain', 'who is', 'when did', 'where is',
      'how many', 'how much', 'what are', 'tell me about', 'what does',
      'fact', 'true or false', 'is it true',
    ],
    weakKeywords: [
      'info', 'information', 'data', 'statistics', 'history', 'meaning',
    ],
    patterns: [
      /^(what|who|when|where|which|how many|how much)\b/i,
      /\b(definition|meaning of|stands for)\b/i,
      /\b(fact check|verify|confirm)\b/i,
    ],
  },

  coding: {
    strongKeywords: [
      'code', 'function', 'implement', 'write a', 'create a', 'class',
      'typescript', 'javascript', 'python', 'fix this', 'refactor',
      'method', 'api', 'endpoint', 'component', 'module',
    ],
    weakKeywords: [
      'script', 'program', 'algorithm', 'syntax', 'compile', 'build',
      'import', 'export', 'interface', 'type', 'const', 'let', 'var',
    ],
    patterns: [
      /```[\s\S]*```/, // Code blocks
      /\b(function|class|const|let|var|import|export|async|await)\b/,
      /\.(ts|js|tsx|jsx|py|rs|go|java|cpp|c|h|css|html|sql)$/i,
      /\b(npm|yarn|pip|cargo|maven|gradle)\b/i,
    ],
  },

  creative: {
    strongKeywords: [
      'write a story', 'creative', 'imagine', 'brainstorm', 'ideas for',
      'come up with', 'invent', 'create something', 'make up',
      'fictional', 'fantasy', 'poem', 'song', 'narrative',
    ],
    weakKeywords: [
      'interesting', 'unique', 'innovative', 'original', 'inspiring',
      'artistic', 'expressive', 'playful',
    ],
    patterns: [
      /\b(write|create|compose|draft)\s+(a\s+)?(story|poem|song|script|narrative)\b/i,
      /\b(brainstorm|ideate|imagine|fantasize)\b/i,
      /\b(creative|artistic|expressive)\s+(writing|content|ideas)\b/i,
    ],
  },

  conversational: {
    strongKeywords: [
      'hi', 'hello', 'hey', 'thanks', 'thank you', 'ok', 'okay',
      'sure', 'yes', 'no', 'bye', 'goodbye', 'how are you',
    ],
    weakKeywords: [
      'chat', 'talk', 'discuss', 'conversation',
    ],
    patterns: [
      /^(hi|hello|hey|thanks|ok|yes|no|bye|sup|yo)\b/i,
      /\b(how are you|what's up|how's it going)\b/i,
    ],
    negativePatterns: [
      /\b(explain|analyze|implement|code|write|research)\b/i,
    ],
  },

  analysis: {
    strongKeywords: [
      'analyze', 'analyse', 'compare', 'evaluate', 'assess', 'review',
      'pros and cons', 'trade-off', 'trade-offs', 'advantages', 'disadvantages',
      'strengths', 'weaknesses', 'critique', 'critical analysis',
    ],
    weakKeywords: [
      'consider', 'examine', 'investigate', 'study', 'look at',
      'break down', 'dissect', 'explore',
    ],
    patterns: [
      /\b(analyze|analyse|evaluate|assess|compare)\b/i,
      /\b(pros\s+and\s+cons|trade-?offs?|advantages|disadvantages)\b/i,
      /\b(strengths?\s+(and|&)\s+weaknesses?)\b/i,
      /\bwhy\s+(does|did|is|are|would|should)\b/i,
    ],
  },

  trading: {
    strongKeywords: [
      'trade', 'trading', 'portfolio', 'position', 'pnl', 'profit',
      'loss', 'buy', 'sell', 'long', 'short', 'stop loss', 'take profit',
      'market', 'stock', 'crypto', 'forex', 'bitcoin', 'ethereum',
      'solana', 'backtest', 'sharpe', 'drawdown',
    ],
    weakKeywords: [
      'invest', 'investment', 'price', 'chart', 'candlestick',
      'indicator', 'signal', 'breakout', 'support', 'resistance',
    ],
    patterns: [
      /\b(buy|sell|long|short)\s+(position|order|trade)?\b/i,
      /\b(stop\s*loss|take\s*profit|trailing\s*stop|tp|sl)\b/i,
      /\b(portfolio|pnl|p&l|profit|loss)\b/i,
      /\b(backtest|sharpe|drawdown|risk.?reward)\b/i,
      /\$[A-Z]{2,5}\b/, // Ticker symbols like $SOL, $BTC
    ],
  },

  research: {
    strongKeywords: [
      'research', 'find out', 'look up', 'search for', 'investigate',
      'what is the latest', 'current state of', 'recent developments',
      'news about', 'updates on',
    ],
    weakKeywords: [
      'learn about', 'discover', 'explore', 'dig into', 'deep dive',
    ],
    patterns: [
      /\b(research|investigate|find\s+out|look\s+up)\b/i,
      /\b(latest|recent|current|new)\s+(news|developments|updates|research)\b/i,
      /\b(what('s|\s+is)\s+the\s+latest)\b/i,
    ],
  },

  debugging: {
    strongKeywords: [
      'debug', 'bug', 'error', 'exception', 'crash', 'not working',
      'broken', 'fix', 'issue', 'problem', 'failing', 'failed',
      'undefined', 'null', 'traceback', 'stack trace',
    ],
    weakKeywords: [
      'wrong', 'incorrect', 'unexpected', 'strange', 'weird',
      'help', 'stuck', 'confused',
    ],
    patterns: [
      /\b(error|exception|bug|crash|fail(ed|ing)?)\b/i,
      /\b(not\s+working|doesn't\s+work|won't\s+work|broken)\b/i,
      /\b(debug|troubleshoot|diagnose)\b/i,
      /\b(undefined|null|NaN|TypeError|ReferenceError|SyntaxError)\b/,
      /\b(stack\s*trace|traceback|line\s+\d+)\b/i,
    ],
  },
};

/**
 * Task-Aware Configuration Manager
 *
 * Analyzes user queries and dynamically adjusts LLM parameters
 * to reduce hallucinations and optimize output quality.
 */
export class TaskAwareConfigManager extends EventEmitter {
  private detectionHistory: TaskDetectionResult[] = [];
  private customConfigs: Partial<Record<TaskType, Partial<TaskConfig>>> = {};

  constructor() {
    super();
    logger.info('TaskAwareConfigManager initialized');
  }

  /**
   * Detect task type from user message
   */
  detectTaskType(message: string, context?: { hasCode?: boolean; conversationLength?: number }): TaskDetectionResult {
    const scores: Record<TaskType, number> = {
      factual: 0,
      coding: 0,
      creative: 0,
      conversational: 0,
      analysis: 0,
      trading: 0,
      research: 0,
      debugging: 0,
    };

    const matchedIndicators: Record<TaskType, string[]> = {
      factual: [],
      coding: [],
      creative: [],
      conversational: [],
      analysis: [],
      trading: [],
      research: [],
      debugging: [],
    };

    const lowerMessage = message.toLowerCase();

    // Score each task type
    for (const [taskType, patterns] of Object.entries(TASK_PATTERNS) as [TaskType, TaskPatterns][]) {
      // Strong keywords (+0.3 each, max +0.9)
      for (const keyword of patterns.strongKeywords) {
        if (lowerMessage.includes(keyword)) {
          scores[taskType] += 0.3;
          matchedIndicators[taskType].push(`keyword: "${keyword}"`);
        }
      }
      scores[taskType] = Math.min(scores[taskType], 0.9);

      // Weak keywords (+0.1 each, max +0.3)
      let weakScore = 0;
      for (const keyword of patterns.weakKeywords) {
        if (lowerMessage.includes(keyword)) {
          weakScore += 0.1;
          matchedIndicators[taskType].push(`weak: "${keyword}"`);
        }
      }
      scores[taskType] += Math.min(weakScore, 0.3);

      // Pattern matches (+0.25 each)
      for (const pattern of patterns.patterns) {
        if (pattern.test(message)) {
          scores[taskType] += 0.25;
          matchedIndicators[taskType].push(`pattern: ${pattern.toString().slice(0, 30)}...`);
        }
      }

      // Negative patterns (-0.3 each)
      if (patterns.negativePatterns) {
        for (const pattern of patterns.negativePatterns) {
          if (pattern.test(message)) {
            scores[taskType] -= 0.3;
          }
        }
      }
    }

    // Context bonuses
    if (context?.hasCode) {
      scores.coding += 0.4;
      scores.debugging += 0.2;
      matchedIndicators.coding.push('context: has code');
    }

    // Short messages tend to be conversational
    if (message.length < 30 && !message.includes('```')) {
      scores.conversational += 0.2;
    }

    // Find highest scoring task
    let maxScore = 0;
    let detectedType: TaskType = 'conversational';

    for (const [taskType, score] of Object.entries(scores) as [TaskType, number][]) {
      if (score > maxScore) {
        maxScore = score;
        detectedType = taskType;
      }
    }

    // Determine confidence
    const confidence: DetectionConfidence =
      maxScore >= 0.7 ? 'high' : maxScore >= 0.4 ? 'medium' : 'low';

    // Normalize score to 0-1
    const confidenceScore = Math.min(maxScore, 1);

    // Get config (with custom overrides)
    const baseConfig = TASK_CONFIGS[detectedType];
    const customOverrides = this.customConfigs[detectedType] || {};
    const config: TaskConfig = { ...baseConfig, ...customOverrides };

    // Determine complexity and whether clarification is needed
    const complexityAnalysis = this.analyzeComplexity(message, detectedType, confidenceScore);

    const result: TaskDetectionResult = {
      taskType: detectedType,
      confidence,
      confidenceScore,
      matchedIndicators: matchedIndicators[detectedType].slice(0, 5),
      reasoning: this.generateReasoning(detectedType, confidence, matchedIndicators[detectedType]),
      config: this.adjustConfigForComplexity(config, complexityAnalysis.complexity),
      needsClarification: complexityAnalysis.needsClarification,
      clarifyingQuestion: complexityAnalysis.clarifyingQuestion,
      complexity: complexityAnalysis.complexity,
    };

    // Track history
    this.detectionHistory.push(result);
    if (this.detectionHistory.length > 100) {
      this.detectionHistory = this.detectionHistory.slice(-100);
    }

    logger.debug('Task detected', {
      taskType: result.taskType,
      confidence: result.confidence,
      score: confidenceScore.toFixed(2),
      indicators: result.matchedIndicators.length,
    });

    this.emit('task-detected', result);
    return result;
  }

  /**
   * Generate human-readable reasoning for detection
   */
  private generateReasoning(taskType: TaskType, confidence: DetectionConfidence, indicators: string[]): string {
    const indicatorSummary = indicators.length > 0
      ? `Matched: ${indicators.slice(0, 3).join(', ')}`
      : 'No strong indicators';

    const confidenceText =
      confidence === 'high' ? 'Strong signals' :
      confidence === 'medium' ? 'Moderate signals' :
      'Weak/default classification';

    return `${confidenceText} for ${taskType} task. ${indicatorSummary}`;
  }

  /**
   * Analyze complexity of a task and determine if clarification is needed
   */
  private analyzeComplexity(
    message: string,
    taskType: TaskType,
    confidenceScore: number
  ): {
    complexity: 'simple' | 'complex' | 'uncertain';
    needsClarification: boolean;
    clarifyingQuestion?: string;
  } {
    const lowerMessage = message.toLowerCase();

    // Complexity indicators
    const complexIndicators = [
      /\b(step by step|multi-?step|multiple|several|many)\b/i,
      /\b(analyze|compare|evaluate|design|architect|plan)\b/i,
      /\b(explain in detail|comprehensive|thorough|deep dive)\b/i,
      /\b(all|every|complete|full|entire)\b/i,
      /\b(why|how does|trade-?off|pros and cons)\b/i,
      /\b(refactor|optimize|improve|enhance|restructure)\b/i,
      /\b(create|build|implement|develop)\s+(a|an|the)\s+\w+\s+(system|app|application|service|api)/i,
      /\b(research|investigate|explore|study)\b/i,
    ];

    const simpleIndicators = [
      /^(what is|what's|who is|when did|where is|define)\b/i,
      /^(hi|hello|hey|thanks|ok|yes|no)\b/i,
      /\b(quick|simple|brief|short|just|only)\b/i,
      /\b(one|single|a|the)\s+(line|word|sentence|example)\b/i,
      /\?([\s]*$)/, // Simple questions ending with ?
    ];

    let complexScore = 0;
    let simpleScore = 0;

    // Check complex indicators
    for (const pattern of complexIndicators) {
      if (pattern.test(message)) {
        complexScore += 0.2;
      }
    }

    // Check simple indicators
    for (const pattern of simpleIndicators) {
      if (pattern.test(message)) {
        simpleScore += 0.25;
      }
    }

    // Message length factor
    if (message.length > 200) complexScore += 0.2;
    else if (message.length > 100) complexScore += 0.1;
    else if (message.length < 50) simpleScore += 0.15;

    // Task type inherent complexity
    const inherentlyComplexTasks: TaskType[] = ['analysis', 'research', 'debugging'];
    const inherentlySimpleTasks: TaskType[] = ['conversational', 'factual'];

    if (inherentlyComplexTasks.includes(taskType)) {
      complexScore += 0.15;
    } else if (inherentlySimpleTasks.includes(taskType)) {
      simpleScore += 0.15;
    }

    // Determine complexity
    const diff = complexScore - simpleScore;

    if (diff > 0.3) {
      return { complexity: 'complex', needsClarification: false };
    } else if (diff < -0.3) {
      return { complexity: 'simple', needsClarification: false };
    }

    // Uncertain - need clarification
    const clarifyingQuestion = this.generateClarifyingQuestion(taskType, message);

    return {
      complexity: 'uncertain',
      needsClarification: confidenceScore < 0.6, // Only ask if confidence is also low
      clarifyingQuestion,
    };
  }

  /**
   * Generate a clarifying question based on task type
   */
  private generateClarifyingQuestion(taskType: TaskType, message: string): string {
    const questions: Record<TaskType, string[]> = {
      factual: [
        'Do you need a quick answer or a detailed explanation?',
        'Should I just give you the facts, or explain the reasoning too?',
      ],
      coding: [
        'Is this a quick snippet or a full implementation you need?',
        'Do you need just the code, or should I explain the approach too?',
        'Is this a small fix or part of a larger refactor?',
      ],
      creative: [
        'Do you want a quick draft or something more polished?',
        'Should I explore multiple ideas or focus on one approach?',
      ],
      conversational: [
        'Is there something specific you need help with?',
      ],
      analysis: [
        'Do you need a quick overview or a deep analysis?',
        'Should I compare multiple options or focus on one?',
        'Do you want just the conclusion or the full reasoning?',
      ],
      trading: [
        'Quick price check or full market analysis?',
        'Do you need a simple status update or detailed breakdown?',
      ],
      research: [
        'Quick summary or comprehensive research?',
        'Do you need sources and citations, or just the key points?',
      ],
      debugging: [
        'Quick fix or should I explain what went wrong and why?',
        'Do you want me to just solve it or help you understand the issue?',
      ],
    };

    const taskQuestions = questions[taskType];
    // Pick a relevant question (could be randomized or based on context)
    return taskQuestions[0];
  }

  /**
   * Adjust configuration based on complexity
   */
  private adjustConfigForComplexity(config: TaskConfig, complexity: 'simple' | 'complex' | 'uncertain'): TaskConfig {
    if (complexity === 'simple') {
      return {
        ...config,
        maxTokens: Math.min(config.maxTokens, 1000), // Cap tokens for simple tasks
        chainOfThought: false, // Skip reasoning for simple tasks
      };
    } else if (complexity === 'complex') {
      return {
        ...config,
        maxTokens: Math.max(config.maxTokens, 2000), // Ensure enough tokens
        chainOfThought: true, // Enable reasoning for complex tasks
      };
    }
    return config; // Uncertain - use default
  }

  /**
   * Process user's answer to clarifying question
   */
  processClarificationAnswer(
    originalQuery: string,
    originalResult: TaskDetectionResult,
    userAnswer: string
  ): ClarificationResponse {
    const lowerAnswer = userAnswer.toLowerCase();

    // Detect if user wants simple or complex response
    const simpleSignals = [
      'quick', 'simple', 'brief', 'short', 'just', 'only',
      'basic', 'fast', 'snippet', 'yes', 'no', 'ok',
    ];
    const complexSignals = [
      'detailed', 'full', 'comprehensive', 'explain', 'thorough',
      'complete', 'deep', 'all', 'everything', 'understand', 'why',
    ];

    let simpleScore = 0;
    let complexScore = 0;

    for (const signal of simpleSignals) {
      if (lowerAnswer.includes(signal)) simpleScore++;
    }
    for (const signal of complexSignals) {
      if (lowerAnswer.includes(signal)) complexScore++;
    }

    const complexity: 'simple' | 'complex' = complexScore > simpleScore ? 'complex' : 'simple';

    // Update the config based on user's answer
    const updatedConfig = this.adjustConfigForComplexity(originalResult.config, complexity);

    const updatedResult: TaskDetectionResult = {
      ...originalResult,
      config: updatedConfig,
      needsClarification: false,
      complexity,
      reasoning: `${originalResult.reasoning} User clarified: ${complexity} task.`,
    };

    logger.info('Clarification processed', {
      originalQuery: originalQuery.slice(0, 50),
      userAnswer: userAnswer.slice(0, 50),
      detectedComplexity: complexity,
    });

    this.emit('clarification-processed', { originalQuery, complexity });

    return {
      originalQuery,
      answer: userAnswer,
      complexity,
      updatedResult,
    };
  }

  /**
   * Check if clarification should be requested
   */
  shouldAskForClarification(result: TaskDetectionResult): boolean {
    return result.needsClarification && result.complexity === 'uncertain';
  }

  /**
   * Get clarifying question for a detection result
   */
  getClarifyingQuestion(result: TaskDetectionResult): string | null {
    if (!result.needsClarification) return null;
    return result.clarifyingQuestion || null;
  }

  /**
   * Get configuration for a specific task type
   */
  getConfigForTask(taskType: TaskType): TaskConfig {
    const baseConfig = TASK_CONFIGS[taskType];
    const customOverrides = this.customConfigs[taskType] || {};
    return { ...baseConfig, ...customOverrides };
  }

  /**
   * Override configuration for a specific task type
   */
  setCustomConfig(taskType: TaskType, config: Partial<TaskConfig>): void {
    this.customConfigs[taskType] = { ...this.customConfigs[taskType], ...config };
    logger.info('Custom config set', { taskType, config });
    this.emit('config-updated', { taskType, config });
  }

  /**
   * Reset custom configurations
   */
  resetCustomConfigs(): void {
    this.customConfigs = {};
    logger.info('Custom configs reset');
    this.emit('configs-reset');
  }

  /**
   * Get detection history
   */
  getDetectionHistory(): TaskDetectionResult[] {
    return [...this.detectionHistory];
  }

  /**
   * Get statistics about task detection
   */
  getStats(): {
    totalDetections: number;
    byTaskType: Record<TaskType, number>;
    averageConfidence: number;
  } {
    const byTaskType: Record<TaskType, number> = {
      factual: 0,
      coding: 0,
      creative: 0,
      conversational: 0,
      analysis: 0,
      trading: 0,
      research: 0,
      debugging: 0,
    };

    let totalConfidence = 0;

    for (const result of this.detectionHistory) {
      byTaskType[result.taskType]++;
      totalConfidence += result.confidenceScore;
    }

    return {
      totalDetections: this.detectionHistory.length,
      byTaskType,
      averageConfidence: this.detectionHistory.length > 0
        ? totalConfidence / this.detectionHistory.length
        : 0,
    };
  }

  /**
   * Build enhanced system prompt with task-specific modifier
   */
  buildEnhancedSystemPrompt(basePrompt: string, taskConfig: TaskConfig): string {
    if (!taskConfig.systemModifier) {
      return basePrompt;
    }

    // Add task-specific modifier at the end
    return `${basePrompt}

## Current Task Configuration
${taskConfig.systemModifier}`;
  }

  /**
   * Get anti-hallucination instructions for any task
   * These are universal guidelines that help reduce hallucinations
   */
  getAntiHallucinationInstructions(): string {
    return `## Anti-Hallucination Guidelines
- If you don't know something, say "I don't know" or "I'm not certain."
- Never fabricate facts, quotes, statistics, or citations.
- Distinguish between: (1) facts you're confident about, (2) reasonable inferences, (3) speculation.
- If making an inference, label it: "I believe..." or "This suggests..."
- When uncertain, express the uncertainty: "possibly", "likely", "I think".
- If asked about something outside your knowledge, acknowledge your limitations.`;
  }
}

// Singleton instance
let taskAwareConfigInstance: TaskAwareConfigManager | null = null;

/**
 * Get the singleton TaskAwareConfigManager instance
 */
export function getTaskAwareConfig(): TaskAwareConfigManager {
  if (!taskAwareConfigInstance) {
    taskAwareConfigInstance = new TaskAwareConfigManager();
  }
  return taskAwareConfigInstance;
}

/**
 * Shutdown the task-aware config manager
 */
export function shutdownTaskAwareConfig(): void {
  if (taskAwareConfigInstance) {
    taskAwareConfigInstance.removeAllListeners();
    taskAwareConfigInstance = null;
    logger.info('TaskAwareConfigManager shut down');
  }
}

export default TaskAwareConfigManager;
