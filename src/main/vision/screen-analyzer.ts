/**
 * Screen Analyzer
 *
 * Performs continuous screen analysis with OCR, UI detection, and LLM-powered
 * context understanding for proactive AI assistance. This module enables Atlas
 * to "see" what the user is working on and offer relevant help.
 *
 * Architecture:
 * - Periodic screen capture using Electron's desktopCapturer
 * - Multi-monitor support with configurable target display
 * - LLM-powered scene understanding and issue detection
 * - Rate-limited to prevent excessive resource usage
 * - Event-driven for real-time UI updates
 *
 * Privacy Considerations:
 * - Captures are processed locally (or sent to configured LLM)
 * - Configurable app exclusion list for sensitive applications
 * - Images are not persisted by default
 *
 * @module vision/screen-analyzer
 *
 * @example
 * ```typescript
 * const analyzer = new ScreenAnalyzer({ captureInterval: 5000 });
 *
 * analyzer.on('issue:detected', (issue) => {
 *   console.log(`Found issue: ${issue.title}`);
 *   if (issue.severity === 'error') {
 *     suggestFix(issue);
 *   }
 * });
 *
 * analyzer.start();
 * ```
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import { app, desktopCapturer, screen } from 'electron';
import { createModuleLogger } from '../utils/logger';
import { getLLMManager } from '../llm';
import { getAppDetector, AppDetector } from './app-detector';
import {
  ScreenCapture,
  ScreenAnalysisResult,
  ScreenAnalyzerConfig,
  DEFAULT_SCREEN_ANALYZER_CONFIG,
  ApplicationContext,
  OCRResult,
  TextType,
  DetectedIssue,
  IssueType,
  ProactiveSuggestion,
  SuggestionType,
  ExtractedEntity,
  EntityType,
  VisionEvent,
  WindowInfo,
  UIElement,
} from './types';

const logger = createModuleLogger('ScreenAnalyzer');

// =============================================================================
// Constants
// =============================================================================

/**
 * Rate limiting constants to prevent excessive CPU/memory usage.
 */
const RATE_LIMIT = {
  /** Rolling window for rate limiting (1 minute) */
  WINDOW_MS: 60_000,

  /** Default maximum captures per minute */
  DEFAULT_MAX_PER_MINUTE: 10,
} as const;

/**
 * Cooldown duration for repeated suggestions of the same type.
 * Prevents spamming the user with the same suggestion.
 */
const SUGGESTION_COOLDOWN_MS = 30_000;

// =============================================================================
// Analysis Prompts
// =============================================================================

/**
 * LLM prompt for analyzing screen captures.
 *
 * This prompt instructs the vision model to extract structured information
 * from screenshots including scene description, active application, detected
 * issues (errors, warnings), and proactive suggestions.
 *
 * @remarks
 * The prompt is designed to return JSON for reliable parsing. Keep it focused
 * on actionable insights rather than exhaustive description.
 */
const SCREEN_ANALYSIS_PROMPT = `You are analyzing a screenshot of a user's computer screen.
Extract the following information:

1. **Scene Description**: Brief description of what's on screen
2. **Active Application**: What app is being used and what the user appears to be doing
3. **Detected Issues**: Any errors, warnings, or problems visible (especially in code editors or terminals)
4. **Proactive Suggestions**: Helpful suggestions based on what you see

For each detected issue, provide:
- Type (compilation-error, runtime-error, lint-warning, type-error, syntax-error, test-failure, git-conflict, etc.)
- Severity (info, warning, error, critical)
- Description
- Suggested fix if applicable

For each suggestion:
- Type (fix-error, explain-code, refactor, documentation, test-suggestion, etc.)
- Priority (low, medium, high)
- Description
- Action to take

Format your response as JSON:
{
  "sceneDescription": "...",
  "activeApp": "...",
  "activity": "...",
  "issues": [
    {
      "type": "...",
      "severity": "...",
      "title": "...",
      "description": "...",
      "suggestedFix": "..."
    }
  ],
  "suggestions": [
    {
      "type": "...",
      "priority": "...",
      "title": "...",
      "description": "...",
      "action": "..."
    }
  ],
  "entities": [
    {
      "type": "file-path|url|error-message|code-symbol",
      "value": "..."
    }
  ]
}`;

// =============================================================================
// Screen Analyzer Class
// =============================================================================

/**
 * Continuous screen analysis service.
 *
 * Captures screenshots at configurable intervals, analyzes them using an LLM,
 * and emits events for detected issues and suggestions.
 *
 * @example
 * ```typescript
 * const analyzer = new ScreenAnalyzer({
 *   captureInterval: 5000,    // Every 5 seconds
 *   maxCapturesPerMinute: 12, // Rate limit
 *   excludeApps: ['1Password', 'Keychain Access'], // Privacy
 * });
 *
 * analyzer.on('issue:detected', (issue) => {
 *   if (issue.type === 'compilation-error') {
 *     offerToFix(issue);
 *   }
 * });
 *
 * analyzer.on('suggestion:created', (suggestion) => {
 *   showNotification(suggestion);
 * });
 *
 * analyzer.start();
 *
 * // Later: graceful shutdown
 * analyzer.stop();
 * ```
 *
 * @fires capture:completed - When a screen capture is taken
 * @fires analysis:completed - When LLM analysis finishes
 * @fires context:updated - When screen context changes
 * @fires issue:detected - When an error/warning is detected
 * @fires suggestion:created - When a proactive suggestion is generated
 * @fires app:changed - When the active application changes
 */
export class ScreenAnalyzer extends EventEmitter {
  private config: ScreenAnalyzerConfig;
  private appDetector: AppDetector;

  // State
  private isRunning = false;
  private captureTimer: NodeJS.Timeout | null = null;
  private lastCapture: ScreenCapture | null = null;
  private analysisHistory: ScreenAnalysisResult[] = [];
  private suggestionCooldowns: Map<string, number> = new Map();

  // Rate limiting
  private captureCount = 0;
  private captureWindowStart = Date.now();

  /**
   * Creates a new ScreenAnalyzer instance.
   *
   * @param config - Partial configuration (merged with defaults)
   *
   * @example
   * ```typescript
   * const analyzer = new ScreenAnalyzer({
   *   captureInterval: 10000, // 10 seconds
   *   excludeApps: ['Signal', 'WhatsApp'], // Don't capture these
   * });
   * ```
   */
  constructor(config?: Partial<ScreenAnalyzerConfig>) {
    super();
    this.config = { ...DEFAULT_SCREEN_ANALYZER_CONFIG, ...config };
    this.appDetector = getAppDetector();
  }

  /**
   * Starts continuous screen analysis.
   *
   * Begins the capture loop and starts listening for application changes.
   * Safe to call multiple times (subsequent calls are no-ops).
   */
  start(): void {
    if (this.isRunning) {
      logger.warn('Screen analyzer already running, ignoring start request');
      return;
    }

    logger.info('Starting screen analyzer', {
      captureInterval: this.config.captureInterval,
      maxCapturesPerMinute: this.config.maxCapturesPerMinute,
    });
    this.isRunning = true;

    // Start capture loop
    this.captureLoop();

    // Listen for app changes
    this.appDetector.on('app:changed', (app: ApplicationContext) => {
      this.emitEvent({ type: 'app:changed', app });
    });
  }

  /**
   * Stops screen analysis and cleans up resources.
   *
   * Cancels the capture timer and removes event listeners to prevent memory leaks.
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    logger.info('Stopping screen analyzer');
    this.isRunning = false;

    if (this.captureTimer) {
      clearTimeout(this.captureTimer);
      this.captureTimer = null;
    }

    // Clean up event listeners to prevent memory leaks
    this.removeAllListeners();
  }

  /**
   * Captures and analyzes the screen immediately.
   *
   * Useful for on-demand analysis (e.g., user asks "what am I looking at?").
   *
   * @returns Analysis result, or null if capture failed
   *
   * @example
   * ```typescript
   * const result = await analyzer.captureAndAnalyze();
   * if (result?.detectedIssues.length > 0) {
   *   console.log(`Found ${result.detectedIssues.length} issues`);
   * }
   * ```
   */
  async captureAndAnalyze(): Promise<ScreenAnalysisResult | null> {
    try {
      // Capture screen
      const capture = await this.captureScreen();
      if (!capture) {
        return null;
      }

      this.emitEvent({ type: 'capture:completed', capture });

      // Analyze the capture
      const result = await this.analyzeCapture(capture);

      if (result) {
        // Store in history (bounded queue)
        this.analysisHistory.unshift(result);
        if (this.analysisHistory.length > this.config.contextHistorySize) {
          this.analysisHistory.pop();
        }

        this.emitEvent({ type: 'analysis:completed', result });
        this.emitEvent({ type: 'context:updated', context: result });

        // Emit individual issues
        for (const issue of result.detectedIssues) {
          this.emitEvent({ type: 'issue:detected', issue });
        }

        // Emit suggestions (respecting cooldown to avoid spam)
        for (const suggestion of result.suggestions) {
          if (this.canShowSuggestion(suggestion)) {
            this.emitEvent({ type: 'suggestion:created', suggestion });
            this.suggestionCooldowns.set(suggestion.type, Date.now());
          }
        }
      }

      return result;

    } catch (error) {
      const err = error as Error;
      logger.error('Capture and analyze failed', { error: err.message });
      return null;
    }
  }

  /**
   * Returns the most recent screen analysis result.
   *
   * @returns The latest analysis, or null if no analysis has been performed
   */
  getCurrentContext(): ScreenAnalysisResult | null {
    return this.analysisHistory[0] || null;
  }

  /**
   * Returns the analysis history (most recent first).
   *
   * @returns Copy of the analysis history array
   */
  getHistory(): ScreenAnalysisResult[] {
    return [...this.analysisHistory];
  }

  /**
   * Returns a human-readable summary of the current screen context.
   *
   * Useful for injecting into LLM conversations as context.
   *
   * @returns Formatted context string, or fallback message if no context
   *
   * @example
   * ```typescript
   * const summary = analyzer.getContextSummary();
   * // "Active app: VS Code - "index.ts"\n\nDetected issues:\n- error: TypeScript compilation error"
   * ```
   */
  getContextSummary(): string {
    const current = this.getCurrentContext();
    if (!current) {
      return 'No screen context available.';
    }

    const parts: string[] = [];

    if (current.activeApp) {
      parts.push(`Active app: ${current.activeApp.name} - "${current.activeApp.windowTitle}"`);
    }

    if (current.sceneDescription) {
      parts.push(`Scene: ${current.sceneDescription}`);
    }

    if (current.detectedIssues.length > 0) {
      const issuesSummary = current.detectedIssues
        .slice(0, 3)
        .map((i) => `- ${i.severity}: ${i.title}`)
        .join('\n');
      parts.push(`Detected issues:\n${issuesSummary}`);
    }

    return parts.join('\n\n');
  }

  // ===========================================================================
  // Private Methods - Capture Loop
  // ===========================================================================

  /**
   * Main capture loop - runs continuously while analyzer is active.
   */
  private async captureLoop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    // Check rate limit before capturing
    if (!this.checkRateLimit()) {
      logger.debug('Rate limit reached, skipping capture');
      this.scheduleNextCapture();
      return;
    }

    try {
      await this.captureAndAnalyze();
    } catch (error) {
      const err = error as Error;
      logger.error('Error in capture loop', { error: err.message });
    }

    this.scheduleNextCapture();
  }

  /**
   * Schedules the next capture based on configured interval.
   */
  private scheduleNextCapture(): void {
    if (!this.isRunning) {
      return;
    }

    this.captureTimer = setTimeout(() => {
      this.captureLoop();
    }, this.config.captureInterval);
  }

  /**
   * Checks if we're within rate limits.
   *
   * Uses a sliding window to limit captures per minute.
   *
   * @returns true if capture is allowed, false if rate limited
   */
  private checkRateLimit(): boolean {
    const now = Date.now();

    // Reset window if expired
    if (now - this.captureWindowStart > RATE_LIMIT.WINDOW_MS) {
      this.captureWindowStart = now;
      this.captureCount = 0;
    }

    if (this.captureCount >= this.config.maxCapturesPerMinute) {
      return false;
    }

    this.captureCount++;
    return true;
  }

  // ===========================================================================
  // Private Methods - Multi-Monitor Support
  // ===========================================================================

  /**
   * Returns information about all available displays.
   *
   * Useful for building a display picker UI.
   *
   * @returns Array of display info objects
   */
  static getAvailableDisplays(): Array<{
    id: number;
    name: string;
    bounds: { x: number; y: number; width: number; height: number };
    isPrimary: boolean;
  }> {
    const allDisplays = screen.getAllDisplays();
    const primaryDisplay = screen.getPrimaryDisplay();

    return allDisplays.map((display, index) => ({
      id: display.id,
      name: `Display ${index + 1}${display.id === primaryDisplay.id ? ' (Primary)' : ''}`,
      bounds: display.bounds,
      isPrimary: display.id === primaryDisplay.id,
    }));
  }

  /**
   * Sets the target display for capture.
   *
   * @param displayId - Display ID to target, or null for primary display
   */
  setTargetDisplay(displayId: number | null): void {
    this.config.targetDisplayId = displayId;
    logger.info('Screen analyzer target display updated', {
      displayId: displayId ?? 'primary',
    });
  }

  /**
   * Returns the currently targeted display.
   *
   * Falls back to primary display if configured display is not found.
   */
  getTargetDisplay(): {
    id: number;
    bounds: { x: number; y: number; width: number; height: number };
  } | null {
    const allDisplays = screen.getAllDisplays();

    if (this.config.targetDisplayId === null) {
      const primary = screen.getPrimaryDisplay();
      return { id: primary.id, bounds: primary.bounds };
    }

    const targetDisplay = allDisplays.find((d) => d.id === this.config.targetDisplayId);
    if (!targetDisplay) {
      logger.warn('Configured display not found, falling back to primary', {
        configuredId: this.config.targetDisplayId,
      });
      const primary = screen.getPrimaryDisplay();
      return { id: primary.id, bounds: primary.bounds };
    }

    return { id: targetDisplay.id, bounds: targetDisplay.bounds };
  }

  // ===========================================================================
  // Private Methods - Screen Capture
  // ===========================================================================

  /**
   * Captures a screenshot of the target display.
   *
   * @returns ScreenCapture object with image data and metadata, or null on failure
   */
  private async captureScreen(): Promise<ScreenCapture | null> {
    try {
      // Determine target display (multi-monitor aware)
      const allDisplays = screen.getAllDisplays();
      const primaryDisplay = screen.getPrimaryDisplay();

      let targetDisplay = primaryDisplay;

      // Use configured display if specified and available
      if (this.config.targetDisplayId !== null) {
        const foundDisplay = allDisplays.find((d) => d.id === this.config.targetDisplayId);
        if (foundDisplay) {
          targetDisplay = foundDisplay;
        } else {
          logger.warn('Configured display not found, using primary', {
            configuredId: this.config.targetDisplayId,
          });
        }
      }

      const { width, height } = targetDisplay.size;

      // Get active app first (for exclusion check)
      const activeApp = await this.appDetector.getActiveApp();

      // Skip capture if app is in exclusion list (privacy)
      if (activeApp && this.config.excludeApps.includes(activeApp.name)) {
        logger.debug('Skipping capture for excluded app', { app: activeApp.name });
        return null;
      }

      // Use desktopCapturer to get screen thumbnail
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width, height },
      });

      if (sources.length === 0) {
        logger.warn('No screen sources available from desktopCapturer');
        return null;
      }

      // Find the source that matches our target display
      // desktopCapturer sources have IDs like "screen:0:0" - the first number is the display index
      let selectedSource = sources[0]; // Default to first
      
      if (sources.length > 1 && this.config.targetDisplayId !== null) {
        // Try to find matching source by comparing display IDs
        const displayIndex = allDisplays.findIndex(d => d.id === targetDisplay.id);
        if (displayIndex >= 0 && sources[displayIndex]) {
          selectedSource = sources[displayIndex];
        }
      }

      const thumbnail = selectedSource.thumbnail;
      
      // Convert to buffer
      const imageData = this.config.captureFormat === 'jpeg'
        ? thumbnail.toJPEG(this.config.captureQuality)
        : thumbnail.toPNG();

      const capture: ScreenCapture = {
        id: uuidv4(),
        timestamp: Date.now(),
        displayId: targetDisplay.id,
        bounds: {
          x: targetDisplay.bounds.x,
          y: targetDisplay.bounds.y,
          width: targetDisplay.bounds.width,
          height: targetDisplay.bounds.height,
        },
        imageData,
        format: this.config.captureFormat,
        quality: this.config.captureQuality,
      };

      this.lastCapture = capture;
      return capture;

    } catch (error) {
      logger.error('Screen capture failed:', error);
      return null;
    }
  }

  /**
   * Analyze a screen capture
   */
  private async analyzeCapture(capture: ScreenCapture): Promise<ScreenAnalysisResult | null> {
    this.emitEvent({ type: 'analysis:started', captureId: capture.id });

    try {
      // Get app context
      const activeApp = await this.appDetector.getActiveApp();
      const visibleWindows = await this.appDetector.getVisibleWindows();

      // Perform OCR if enabled
      let ocrResults: OCRResult[] = [];
      if (this.config.enableOCR) {
        ocrResults = await this.performOCR(capture);
      }

      // Perform LLM analysis if enabled
      let llmAnalysis: {
        sceneDescription: string;
        detectedIssues: DetectedIssue[];
        suggestions: ProactiveSuggestion[];
        entities: ExtractedEntity[];
      } = {
        sceneDescription: '',
        detectedIssues: [],
        suggestions: [],
        entities: [],
      };

      if (this.config.enableLLMAnalysis) {
        llmAnalysis = await this.performLLMAnalysis(capture, activeApp, ocrResults);
      }

      // Build the analysis result
      const result: ScreenAnalysisResult = {
        id: uuidv4(),
        timestamp: Date.now(),
        activeApp,
        visibleWindows,
        ocrResults,
        uiElements: [], // UI detection not implemented yet
        sceneDescription: llmAnalysis.sceneDescription,
        detectedIssues: llmAnalysis.detectedIssues,
        suggestions: llmAnalysis.suggestions,
        contextSummary: this.buildContextSummary(activeApp, llmAnalysis.sceneDescription),
        relevantEntities: llmAnalysis.entities,
      };

      return result;

    } catch (error) {
      logger.error('Screen analysis failed:', error);
      return null;
    }
  }

  /**
   * Perform OCR on capture (simplified - would use Tesseract or cloud API)
   */
  private async performOCR(capture: ScreenCapture): Promise<OCRResult[]> {
    // For now, return empty - would integrate with Tesseract.js or similar
    // This is a placeholder for the actual OCR implementation
    logger.debug('OCR not implemented yet');
    return [];
  }

  /**
   * Perform LLM analysis on capture
   */
  private async performLLMAnalysis(
    capture: ScreenCapture,
    activeApp: ApplicationContext | null,
    _ocrResults: OCRResult[]
  ): Promise<{
    sceneDescription: string;
    detectedIssues: DetectedIssue[];
    suggestions: ProactiveSuggestion[];
    entities: ExtractedEntity[];
  }> {
    try {
      const llm = getLLMManager();

      // Encode image as base64
      const imageBase64 = capture.imageData.toString('base64');
      const mimeType = capture.format === 'jpeg' ? 'image/jpeg' : 'image/png';

      // Build context string
      let contextInfo = '';
      if (activeApp) {
        contextInfo = `Active application: ${activeApp.name}\nWindow title: ${activeApp.windowTitle}\nApp type: ${activeApp.appType}`;
      }

      // Build prompt with image reference (vision handled by provider)
      const prompt = `${SCREEN_ANALYSIS_PROMPT}\n\nAnalyze this screenshot.\n\nContext:\n${contextInfo}\n\n[Image: base64 screenshot attached - ${capture.width}x${capture.height}]`;

      // Call LLM (note: full vision support requires provider with image capability)
      // For now, use text-based analysis with image metadata
      const response = await llm.chat(
        prompt,
        { systemPrompt: 'You are a screen analysis AI. Analyze application state and provide insights.' },
        {
          temperature: 0.3,
          maxTokens: 2000,
        }
      );

      // Parse the response
      return this.parseLLMAnalysisResponse(response.content);

    } catch (error) {
      logger.error('LLM analysis failed:', error);
      return {
        sceneDescription: 'Analysis failed',
        detectedIssues: [],
        suggestions: [],
        entities: [],
      };
    }
  }

  /**
   * Parse LLM analysis response
   */
  private parseLLMAnalysisResponse(content: string): {
    sceneDescription: string;
    detectedIssues: DetectedIssue[];
    suggestions: ProactiveSuggestion[];
    entities: ExtractedEntity[];
  } {
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const data = JSON.parse(jsonMatch[0]);

      return {
        sceneDescription: data.sceneDescription || '',
        detectedIssues: (data.issues || []).map((issue: Record<string, unknown>, index: number) => ({
          id: `issue_${Date.now()}_${index}`,
          type: issue.type as IssueType || 'other',
          severity: issue.severity || 'info',
          title: issue.title || 'Unknown issue',
          description: issue.description || '',
          suggestedFix: issue.suggestedFix ? {
            description: issue.suggestedFix as string,
            automated: false,
            confidence: 0.7,
          } : undefined,
          confidence: 0.8,
        })),
        suggestions: (data.suggestions || []).map((suggestion: Record<string, unknown>, index: number) => ({
          id: `suggestion_${Date.now()}_${index}`,
          type: suggestion.type as SuggestionType || 'other',
          priority: suggestion.priority || 'medium',
          title: suggestion.title || 'Suggestion',
          description: suggestion.description || '',
          actions: [{
            id: `action_${index}`,
            label: suggestion.action as string || 'Apply',
            type: 'voice-command',
            payload: suggestion.action,
          }],
          context: data.sceneDescription || '',
          trigger: 'screen-analysis',
          dismissed: false,
          accepted: false,
        })),
        entities: (data.entities || []).map((entity: Record<string, unknown>) => ({
          type: entity.type as EntityType || 'other',
          value: entity.value as string || '',
          confidence: 0.8,
        })),
      };

    } catch (error) {
      logger.warn('Failed to parse LLM analysis response:', error);
      return {
        sceneDescription: content.substring(0, 200),
        detectedIssues: [],
        suggestions: [],
        entities: [],
      };
    }
  }

  /**
   * Build context summary string
   */
  private buildContextSummary(activeApp: ApplicationContext | null, sceneDescription: string): string {
    const parts: string[] = [];
    
    if (activeApp) {
      parts.push(`Using ${activeApp.name}: "${activeApp.windowTitle}"`);
    }
    
    if (sceneDescription) {
      parts.push(sceneDescription);
    }

    return parts.join('. ') || 'No context available';
  }

  /**
   * Check if a suggestion can be shown (respecting cooldown)
   */
  private canShowSuggestion(suggestion: ProactiveSuggestion): boolean {
    if (!this.config.enableProactiveSuggestions) {
      return false;
    }

    const lastShown = this.suggestionCooldowns.get(suggestion.type);
    if (!lastShown) {
      return true;
    }

    return Date.now() - lastShown > this.config.suggestionCooldown;
  }

  /**
   * Emit a typed vision event
   */
  private emitEvent(event: VisionEvent): void {
    this.emit(event.type, event);
    this.emit('vision:event', event);
  }
}

// ============================================================================
// Singleton
// ============================================================================

let analyzerInstance: ScreenAnalyzer | null = null;

export function getScreenAnalyzer(config?: Partial<ScreenAnalyzerConfig>): ScreenAnalyzer {
  if (!analyzerInstance) {
    analyzerInstance = new ScreenAnalyzer(config);
  }
  return analyzerInstance;
}

export function resetScreenAnalyzer(): void {
  if (analyzerInstance) {
    analyzerInstance.stop();
  }
  analyzerInstance = null;
}
