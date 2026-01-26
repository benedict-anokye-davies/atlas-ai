/**
 * Atlas Desktop - VM Agent VLM (Vision Language Model) Analyzer
 *
 * Integrates vision-language models for intelligent screen understanding.
 * Provides semantic analysis of VM screen content.
 *
 * @module vm-agent/vision/vlm-analyzer
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../../utils/logger';
import { getEventBus, createEvent } from '../core/event-bus';
import { ScreenState, UIElement } from '../types';
import {
  VLMAnalysisRequest,
  VLMAnalysisResult,
  VLMStructuredResponse,
  EnhancedUIElement,
} from '../core/types';

const logger = createModuleLogger('VLMAnalyzer');

// =============================================================================
// VLM Constants
// =============================================================================

export const VLM_CONSTANTS = {
  /** Maximum image dimension for VLM input */
  MAX_IMAGE_DIMENSION: 1920,
  /** JPEG quality for VLM input */
  IMAGE_QUALITY: 85,
  /** Maximum tokens for VLM response */
  MAX_TOKENS: 4096,
  /** Cache TTL for VLM results (ms) */
  CACHE_TTL_MS: 30000,
  /** Maximum cache entries */
  MAX_CACHE_ENTRIES: 100,
  /** Default temperature for analysis */
  DEFAULT_TEMPERATURE: 0.3,
  /** Default model */
  DEFAULT_MODEL: 'accounts/fireworks/models/llama-v3p2-11b-vision-instruct',
} as const;

// =============================================================================
// VLM Analysis Types
// =============================================================================

export interface VLMConfig {
  model: string;
  apiKey?: string;
  baseUrl?: string;
  maxTokens: number;
  temperature: number;
  timeout: number;
}

export interface ScreenAnalysis {
  /** Overall screen description */
  description: string;
  /** Detected application */
  application?: {
    name: string;
    type: 'browser' | 'ide' | 'terminal' | 'office' | 'game' | 'system' | 'unknown';
    version?: string;
  };
  /** Screen regions and their content */
  regions: ScreenRegion[];
  /** Detected interactive elements */
  elements: EnhancedUIElement[];
  /** Current activity/state */
  currentActivity: string;
  /** Suggested next actions */
  suggestedActions: SuggestedAction[];
  /** Potential errors or warnings on screen */
  issues: ScreenIssue[];
  /** Raw VLM response */
  rawResponse?: string;
  /** Analysis confidence */
  confidence: number;
  /** Analysis duration */
  durationMs: number;
}

export interface ScreenRegion {
  name: string;
  bounds: { x: number; y: number; width: number; height: number };
  type: 'header' | 'sidebar' | 'main' | 'footer' | 'toolbar' | 'dialog' | 'menu' | 'unknown';
  content: string;
  elements: number[]; // Indices into elements array
}

export interface SuggestedAction {
  action: string;
  reason: string;
  priority: 'high' | 'medium' | 'low';
  targetElement?: number; // Index into elements array
  confidence: number;
}

export interface ScreenIssue {
  type: 'error' | 'warning' | 'info';
  message: string;
  location?: { x: number; y: number };
  suggestedFix?: string;
}

export interface ElementQuery {
  description: string;
  context?: string;
  type?: string;
  maxResults?: number;
}

export interface ElementQueryResult {
  matches: EnhancedUIElement[];
  confidence: number;
  reasoning: string;
}

// =============================================================================
// VLM Analyzer Class
// =============================================================================

/**
 * Vision Language Model analyzer for intelligent screen understanding
 *
 * @example
 * ```typescript
 * const analyzer = getVLMAnalyzer();
 *
 * // Analyze a screen
 * const analysis = await analyzer.analyzeScreen(screenState);
 * console.log('Current activity:', analysis.currentActivity);
 *
 * // Find elements by description
 * const result = await analyzer.findElements(
 *   screenState,
 *   { description: 'login button', type: 'button' }
 * );
 * ```
 */
export class VLMAnalyzer extends EventEmitter {
  private config: VLMConfig;
  private analysisCache: Map<string, { result: ScreenAnalysis; timestamp: number }> = new Map();
  private pendingRequests: Map<string, Promise<ScreenAnalysis>> = new Map();

  constructor(config?: Partial<VLMConfig>) {
    super();

    this.config = {
      model: config?.model ?? VLM_CONSTANTS.DEFAULT_MODEL,
      apiKey: config?.apiKey ?? process.env.FIREWORKS_API_KEY,
      baseUrl: config?.baseUrl ?? 'https://api.fireworks.ai/inference/v1',
      maxTokens: config?.maxTokens ?? VLM_CONSTANTS.MAX_TOKENS,
      temperature: config?.temperature ?? VLM_CONSTANTS.DEFAULT_TEMPERATURE,
      timeout: config?.timeout ?? 30000,
    };
  }

  /**
   * Analyze a screen state with VLM
   */
  async analyzeScreen(
    screenState: ScreenState,
    options?: {
      forceRefresh?: boolean;
      detailed?: boolean;
      focusArea?: { x: number; y: number; width: number; height: number };
    },
  ): Promise<ScreenAnalysis> {
    const startTime = Date.now();
    const cacheKey = this.generateCacheKey(screenState, options);

    // Check cache
    if (!options?.forceRefresh) {
      const cached = this.analysisCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < VLM_CONSTANTS.CACHE_TTL_MS) {
        logger.debug('Returning cached analysis');
        return cached.result;
      }
    }

    // Check for pending request
    const pending = this.pendingRequests.get(cacheKey);
    if (pending) {
      logger.debug('Waiting for pending analysis request');
      return pending;
    }

    // Create new analysis request
    const requestPromise = this.performAnalysis(screenState, options, startTime);
    this.pendingRequests.set(cacheKey, requestPromise);

    try {
      const result = await requestPromise;

      // Cache result
      this.analysisCache.set(cacheKey, { result, timestamp: Date.now() });
      this.cleanupCache();

      return result;
    } finally {
      this.pendingRequests.delete(cacheKey);
    }
  }

  /**
   * Find elements on screen matching a natural language description
   */
  async findElements(
    screenState: ScreenState,
    query: ElementQuery,
  ): Promise<ElementQueryResult> {
    const startTime = Date.now();

    logger.debug('Finding elements', { query });

    const eventBus = getEventBus();
    eventBus.emitSync(
      createEvent('vlm:query-started', { query }, 'vlm-analyzer', { priority: 'normal' }),
    );

    try {
      // First get screen analysis if not cached
      const analysis = await this.analyzeScreen(screenState, { detailed: true });

      // Build prompt for element finding
      const prompt = this.buildElementQueryPrompt(query, analysis);

      // Query VLM
      const response = await this.queryVLM(screenState.screenshot, prompt);

      // Parse response
      const matches = this.parseElementMatches(response, analysis.elements);

      const result: ElementQueryResult = {
        matches,
        confidence: matches.length > 0 ? 0.8 : 0.3,
        reasoning: response,
      };

      eventBus.emitSync(
        createEvent(
          'vlm:query-completed',
          { query, result, durationMs: Date.now() - startTime },
          'vlm-analyzer',
          { priority: 'normal' },
        ),
      );

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Element query failed', { error: errorMessage });

      return {
        matches: [],
        confidence: 0,
        reasoning: `Query failed: ${errorMessage}`,
      };
    }
  }

  /**
   * Verify if an action was successful
   */
  async verifyAction(
    beforeState: ScreenState,
    afterState: ScreenState,
    expectedOutcome: string,
  ): Promise<{
    success: boolean;
    confidence: number;
    explanation: string;
    actualOutcome: string;
  }> {
    logger.debug('Verifying action outcome', { expectedOutcome });

    const prompt = `You are analyzing two screenshots to verify if an action was successful.

EXPECTED OUTCOME: ${expectedOutcome}

Compare the before and after screenshots and determine:
1. Did the expected change occur?
2. What actually changed between the screenshots?
3. Are there any unexpected changes or errors?

Respond in JSON format:
{
  "success": boolean,
  "confidence": number (0-1),
  "actualOutcome": "what actually happened",
  "explanation": "detailed explanation of your analysis"
}`;

    try {
      // For now, do a simple comparison-based verification
      // Full VLM comparison would require multi-image support
      const beforeAnalysis = await this.analyzeScreen(beforeState);
      const afterAnalysis = await this.analyzeScreen(afterState);

      // Compare activities and issues
      const activityChanged = beforeAnalysis.currentActivity !== afterAnalysis.currentActivity;
      const hasNewIssues = afterAnalysis.issues.some(
        (i) => !beforeAnalysis.issues.find((bi) => bi.message === i.message),
      );

      // Simple heuristic verification
      const success = activityChanged && !hasNewIssues;

      return {
        success,
        confidence: 0.7,
        explanation: `Activity changed from "${beforeAnalysis.currentActivity}" to "${afterAnalysis.currentActivity}"`,
        actualOutcome: afterAnalysis.currentActivity,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        confidence: 0,
        explanation: `Verification failed: ${errorMessage}`,
        actualOutcome: 'unknown',
      };
    }
  }

  /**
   * Get task completion suggestions
   */
  async suggestNextSteps(
    screenState: ScreenState,
    taskObjective: string,
    completedSteps: string[],
  ): Promise<SuggestedAction[]> {
    logger.debug('Getting next step suggestions', { taskObjective });

    const analysis = await this.analyzeScreen(screenState, { detailed: true });

    const prompt = `You are helping complete a task on a computer.

TASK OBJECTIVE: ${taskObjective}

COMPLETED STEPS:
${completedSteps.map((s, i) => `${i + 1}. ${s}`).join('\n') || 'None yet'}

CURRENT SCREEN ANALYSIS:
- Application: ${analysis.application?.name || 'Unknown'}
- Current Activity: ${analysis.currentActivity}
- Visible Elements: ${analysis.elements.length}

Based on the current screen state and completed steps, suggest the next actions to complete the task.

Respond in JSON format:
{
  "suggestions": [
    {
      "action": "description of what to do",
      "reason": "why this action is needed",
      "priority": "high" | "medium" | "low",
      "targetElementDescription": "which element to interact with (if any)"
    }
  ]
}`;

    try {
      const response = await this.queryVLM(screenState.screenshot, prompt);
      const parsed = this.parseJSON<{ suggestions: SuggestedAction[] }>(response);

      if (parsed?.suggestions) {
        // Map suggestions to element indices
        return parsed.suggestions.map((s) => ({
          ...s,
          targetElement: s.targetElement,
          confidence: 0.7,
        }));
      }

      // Fallback to analysis suggestions
      return analysis.suggestedActions;
    } catch (error) {
      logger.warn('Failed to get VLM suggestions', { error });
      return analysis.suggestedActions;
    }
  }

  /**
   * Check if specific content is visible on screen
   */
  async isContentVisible(screenState: ScreenState, content: string): Promise<{
    visible: boolean;
    location?: { x: number; y: number };
    confidence: number;
  }> {
    // First check text content
    const textLower = screenState.text.toLowerCase();
    const contentLower = content.toLowerCase();

    if (textLower.includes(contentLower)) {
      return {
        visible: true,
        confidence: 0.9,
      };
    }

    // Check elements
    for (const element of screenState.elements) {
      if (element.text?.toLowerCase().includes(contentLower)) {
        return {
          visible: true,
          location: { x: element.bounds.x, y: element.bounds.y },
          confidence: 0.85,
        };
      }
    }

    // Use VLM for more thorough check
    const query = await this.findElements(screenState, {
      description: content,
      maxResults: 1,
    });

    if (query.matches.length > 0) {
      const match = query.matches[0];
      return {
        visible: true,
        location: { x: match.bounds.x, y: match.bounds.y },
        confidence: query.confidence,
      };
    }

    return {
      visible: false,
      confidence: 0.7,
    };
  }

  /**
   * Extract structured data from screen
   */
  async extractData<T extends Record<string, unknown>>(
    screenState: ScreenState,
    schema: { fields: Array<{ name: string; type: string; description: string }> },
  ): Promise<T | null> {
    const prompt = `Extract the following data from the screen:

${schema.fields.map((f) => `- ${f.name} (${f.type}): ${f.description}`).join('\n')}

Respond with a JSON object containing only the requested fields.
If a field is not visible, use null.`;

    try {
      const response = await this.queryVLM(screenState.screenshot, prompt);
      return this.parseJSON<T>(response);
    } catch (error) {
      logger.warn('Failed to extract data', { error });
      return null;
    }
  }

  /**
   * Get analyzer statistics
   */
  getStats(): {
    cacheSize: number;
    pendingRequests: number;
    model: string;
  } {
    return {
      cacheSize: this.analysisCache.size,
      pendingRequests: this.pendingRequests.size,
      model: this.config.model,
    };
  }

  /**
   * Clear analysis cache
   */
  clearCache(): void {
    this.analysisCache.clear();
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  private async performAnalysis(
    screenState: ScreenState,
    options?: { detailed?: boolean; focusArea?: { x: number; y: number; width: number; height: number } },
    startTime: number = Date.now(),
  ): Promise<ScreenAnalysis> {
    const eventBus = getEventBus();

    eventBus.emitSync(
      createEvent('vlm:analysis-started', { timestamp: startTime }, 'vlm-analyzer', {
        priority: 'normal',
      }),
    );

    try {
      const prompt = this.buildAnalysisPrompt(screenState, options?.detailed);

      const response = await this.queryVLM(screenState.screenshot, prompt);

      const analysis = this.parseAnalysisResponse(response, screenState, startTime);

      eventBus.emitSync(
        createEvent(
          'vlm:analysis-completed',
          { durationMs: Date.now() - startTime },
          'vlm-analyzer',
          { priority: 'normal' },
        ),
      );

      return analysis;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('VLM analysis failed', { error: errorMessage });

      eventBus.emitSync(
        createEvent('vlm:analysis-failed', { error: errorMessage }, 'vlm-analyzer', {
          priority: 'high',
        }),
      );

      // Return minimal analysis
      return this.createMinimalAnalysis(screenState, startTime, errorMessage);
    }
  }

  private async queryVLM(screenshot: Buffer, prompt: string): Promise<string> {
    // Convert screenshot to base64
    const imageBase64 = screenshot.toString('base64');
    const imageUrl = `data:image/png;base64,${imageBase64}`;

    const requestBody = {
      model: this.config.model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: imageUrl } },
          ],
        },
      ],
      max_tokens: this.config.maxTokens,
      temperature: this.config.temperature,
    };

    const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(this.config.timeout),
    });

    if (!response.ok) {
      throw new Error(`VLM API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
    };

    return data.choices[0]?.message?.content || '';
  }

  private buildAnalysisPrompt(screenState: ScreenState, detailed?: boolean): string {
    const base = `Analyze this computer screenshot and provide structured information about what you see.

CURRENT DETECTED TEXT (from OCR):
${screenState.text.slice(0, 1000)}

DETECTED ELEMENTS: ${screenState.elements.length} elements

Please analyze and respond in JSON format with the following structure:
{
  "description": "overall description of what's on screen",
  "application": {
    "name": "application name",
    "type": "browser|ide|terminal|office|game|system|unknown"
  },
  "currentActivity": "what the user appears to be doing",
  "regions": [
    {
      "name": "region name",
      "type": "header|sidebar|main|footer|toolbar|dialog|menu|unknown",
      "content": "brief description of content"
    }
  ],
  "suggestedActions": [
    {
      "action": "what to do",
      "reason": "why",
      "priority": "high|medium|low"
    }
  ],
  "issues": [
    {
      "type": "error|warning|info",
      "message": "issue description"
    }
  ]
}`;

    if (detailed) {
      return (
        base +
        `

Additionally, provide detailed element analysis including:
- Interactive elements (buttons, links, inputs)
- Their approximate locations on screen
- Their likely purposes`
      );
    }

    return base;
  }

  private buildElementQueryPrompt(query: ElementQuery, analysis: ScreenAnalysis): string {
    return `Find elements matching this description on the screen:

QUERY: ${query.description}
${query.type ? `TYPE FILTER: ${query.type}` : ''}
${query.context ? `CONTEXT: ${query.context}` : ''}

KNOWN ELEMENTS ON SCREEN:
${analysis.elements
  .slice(0, 20)
  .map((e, i) => `${i}: ${e.type} - "${e.text || 'no text'}" at (${e.bounds.x}, ${e.bounds.y})`)
  .join('\n')}

Identify which elements (by index) best match the query.
Respond in JSON format:
{
  "matchingIndices": [array of element indices],
  "reasoning": "explanation of why these match"
}`;
  }

  private parseAnalysisResponse(
    response: string,
    screenState: ScreenState,
    startTime: number,
  ): ScreenAnalysis {
    try {
      const parsed = this.parseJSON<{
        description?: string;
        application?: { name: string; type: string };
        currentActivity?: string;
        regions?: Array<{ name: string; type: string; content: string }>;
        suggestedActions?: Array<{ action: string; reason: string; priority: string }>;
        issues?: Array<{ type: string; message: string }>;
      }>(response);

      // Convert existing elements to enhanced elements
      const enhancedElements: EnhancedUIElement[] = screenState.elements.map((e, i) => ({
        ...e,
        id: `element-${i}`,
        semanticRole: e.type,
        purpose: e.text || undefined,
        relatedElements: [],
        interactions: [e.isInteractive ? 'click' : 'none'],
        lastSeen: Date.now(),
        seenCount: 1,
      }));

      return {
        description: parsed?.description || 'Screen analysis',
        application: parsed?.application
          ? {
              name: parsed.application.name,
              type: parsed.application.type as ScreenAnalysis['application']['type'],
            }
          : undefined,
        currentActivity: parsed?.currentActivity || 'Unknown activity',
        regions:
          parsed?.regions?.map((r) => ({
            name: r.name,
            type: r.type as ScreenRegion['type'],
            content: r.content,
            bounds: { x: 0, y: 0, width: 0, height: 0 },
            elements: [],
          })) || [],
        elements: enhancedElements,
        suggestedActions:
          parsed?.suggestedActions?.map((a) => ({
            action: a.action,
            reason: a.reason,
            priority: a.priority as SuggestedAction['priority'],
            confidence: 0.7,
          })) || [],
        issues:
          parsed?.issues?.map((i) => ({
            type: i.type as ScreenIssue['type'],
            message: i.message,
          })) || [],
        rawResponse: response,
        confidence: 0.8,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      return this.createMinimalAnalysis(screenState, startTime, 'Parse error');
    }
  }

  private parseElementMatches(
    response: string,
    elements: EnhancedUIElement[],
  ): EnhancedUIElement[] {
    try {
      const parsed = this.parseJSON<{ matchingIndices?: number[] }>(response);
      if (parsed?.matchingIndices) {
        return parsed.matchingIndices
          .filter((i) => i >= 0 && i < elements.length)
          .map((i) => elements[i]);
      }
    } catch (error) {
      logger.warn('Failed to parse element matches', { error });
    }
    return [];
  }

  private createMinimalAnalysis(
    screenState: ScreenState,
    startTime: number,
    error?: string,
  ): ScreenAnalysis {
    return {
      description: error ? `Analysis failed: ${error}` : 'Minimal analysis',
      currentActivity: 'Unknown',
      regions: [],
      elements: screenState.elements.map((e, i) => ({
        ...e,
        id: `element-${i}`,
        semanticRole: e.type,
        relatedElements: [],
        interactions: [],
        lastSeen: Date.now(),
        seenCount: 1,
      })),
      suggestedActions: [],
      issues: error
        ? [{ type: 'error' as const, message: error }]
        : [],
      confidence: 0.3,
      durationMs: Date.now() - startTime,
    };
  }

  private parseJSON<T>(text: string): T | null {
    try {
      // Try to find JSON in the response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]) as T;
      }
    } catch (error) {
      logger.debug('JSON parse failed', { error });
    }
    return null;
  }

  private generateCacheKey(
    screenState: ScreenState,
    options?: { detailed?: boolean },
  ): string {
    // Use URL and element count as cache key
    const urlPart = screenState.url || 'no-url';
    const elementPart = screenState.elements.length;
    const detailPart = options?.detailed ? 'detailed' : 'basic';
    return `${urlPart}-${elementPart}-${detailPart}`;
  }

  private cleanupCache(): void {
    if (this.analysisCache.size > VLM_CONSTANTS.MAX_CACHE_ENTRIES) {
      // Remove oldest entries
      const entries = Array.from(this.analysisCache.entries());
      entries.sort((a, b) => a[1].timestamp - b[1].timestamp);

      const toRemove = entries.slice(0, entries.length - VLM_CONSTANTS.MAX_CACHE_ENTRIES + 10);
      for (const [key] of toRemove) {
        this.analysisCache.delete(key);
      }
    }
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let vlmAnalyzerInstance: VLMAnalyzer | null = null;

/**
 * Get the singleton VLM analyzer instance
 */
export function getVLMAnalyzer(): VLMAnalyzer {
  if (!vlmAnalyzerInstance) {
    vlmAnalyzerInstance = new VLMAnalyzer();
  }
  return vlmAnalyzerInstance;
}

/**
 * Reset the VLM analyzer (for testing)
 */
export function resetVLMAnalyzer(): void {
  if (vlmAnalyzerInstance) {
    vlmAnalyzerInstance.clearCache();
    vlmAnalyzerInstance = null;
  }
}
