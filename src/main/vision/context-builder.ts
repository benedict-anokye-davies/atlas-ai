/**
 * Context Builder
 * 
 * Builds comprehensive context from screen analysis for conversation
 * and proactive assistance features.
 * 
 * @module vision/context-builder
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import { getScreenAnalyzer, ScreenAnalyzer } from './screen-analyzer';
import { getAppDetector, AppDetector } from './app-detector';
import {
  ScreenAnalysisResult,
  ApplicationContext,
  DetectedIssue,
  ProactiveSuggestion,
  ExtractedEntity,
} from './types';

const logger = createModuleLogger('ContextBuilder');

// ============================================================================
// Context Types
// ============================================================================

export interface ConversationContext {
  // Current state
  timestamp: number;
  
  // Application context
  activeApp: ApplicationContext | null;
  appSpecificContext: string;
  
  // Screen understanding
  sceneDescription: string;
  visibleText: string[];
  
  // Issues and suggestions
  activeIssues: DetectedIssue[];
  pendingSuggestions: ProactiveSuggestion[];
  
  // Extracted information
  entities: ExtractedEntity[];
  
  // Historical context
  recentApps: string[];
  recentFiles: string[];
  recentUrls: string[];
  
  // Summary for LLM
  summary: string;
}

export interface ContextBuilderConfig {
  // Context building
  maxHistoryItems: number;
  maxTextItems: number;
  maxIssues: number;
  maxSuggestions: number;
  
  // Auto-update
  autoUpdate: boolean;
  updateInterval: number;
}

const DEFAULT_CONFIG: ContextBuilderConfig = {
  maxHistoryItems: 10,
  maxTextItems: 20,
  maxIssues: 5,
  maxSuggestions: 3,
  autoUpdate: true,
  updateInterval: 10000,
};

// ============================================================================
// Context Builder Class
// ============================================================================

export class ContextBuilder extends EventEmitter {
  private config: ContextBuilderConfig;
  private screenAnalyzer: ScreenAnalyzer;
  private appDetector: AppDetector;
  
  // State
  private currentContext: ConversationContext | null = null;
  private updateTimer: NodeJS.Timeout | null = null;
  
  // History tracking
  private recentApps: string[] = [];
  private recentFiles: string[] = [];
  private recentUrls: string[] = [];

  constructor(config?: Partial<ContextBuilderConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.screenAnalyzer = getScreenAnalyzer();
    this.appDetector = getAppDetector();
    
    this.setupListeners();
  }

  /**
   * Start context building
   */
  start(): void {
    if (this.config.autoUpdate) {
      this.updateTimer = setInterval(() => {
        this.updateContext();
      }, this.config.updateInterval);
    }
    
    // Initial context build
    this.updateContext();
  }

  /**
   * Stop context building
   */
  stop(): void {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
    }
  }

  /**
   * Get current conversation context
   */
  getContext(): ConversationContext | null {
    return this.currentContext;
  }

  /**
   * Get context summary for LLM
   */
  getContextSummary(): string {
    return this.currentContext?.summary || 'No context available.';
  }

  /**
   * Get context for a specific query
   */
  async getContextForQuery(query: string): Promise<ConversationContext> {
    // Update context first
    await this.updateContext();
    
    // Enhance context based on query
    const context = this.currentContext || this.createEmptyContext();
    
    // Add query-relevant information
    const enhanced = { ...context };
    enhanced.summary = this.buildQueryRelevantSummary(query, context);
    
    return enhanced;
  }

  /**
   * Force context update
   */
  async updateContext(): Promise<ConversationContext> {
    try {
      // Get latest screen analysis
      const analysis = this.screenAnalyzer.getCurrentContext();
      const activeApp = await this.appDetector.getActiveApp();
      
      // Update history
      if (activeApp) {
        this.trackApp(activeApp);
      }
      
      if (analysis) {
        this.trackEntities(analysis);
      }
      
      // Build context
      this.currentContext = this.buildContext(analysis, activeApp);
      
      this.emit('context:updated', this.currentContext);
      return this.currentContext;

    } catch (error) {
      logger.error('Failed to update context:', error);
      return this.currentContext || this.createEmptyContext();
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Setup event listeners
   */
  private setupListeners(): void {
    // Listen for screen analysis updates
    this.screenAnalyzer.on('analysis:completed', (event: { result: ScreenAnalysisResult }) => {
      this.trackEntities(event.result);
    });

    // Listen for app changes
    this.appDetector.on('app:changed', (app: ApplicationContext) => {
      this.trackApp(app);
      this.updateContext();
    });
  }

  /**
   * Build conversation context
   */
  private buildContext(
    analysis: ScreenAnalysisResult | null,
    activeApp: ApplicationContext | null
  ): ConversationContext {
    const timestamp = Date.now();

    // Build app-specific context
    const appSpecificContext = this.buildAppSpecificContext(activeApp);

    // Collect visible text from OCR
    const visibleText = analysis?.ocrResults
      .slice(0, this.config.maxTextItems)
      .map(r => r.text) || [];

    // Get active issues
    const activeIssues = analysis?.detectedIssues
      .slice(0, this.config.maxIssues) || [];

    // Get pending suggestions
    const pendingSuggestions = analysis?.suggestions
      .filter(s => !s.dismissed && !s.accepted)
      .slice(0, this.config.maxSuggestions) || [];

    // Build the context
    const context: ConversationContext = {
      timestamp,
      activeApp,
      appSpecificContext,
      sceneDescription: analysis?.sceneDescription || '',
      visibleText,
      activeIssues,
      pendingSuggestions,
      entities: analysis?.relevantEntities || [],
      recentApps: [...this.recentApps],
      recentFiles: [...this.recentFiles],
      recentUrls: [...this.recentUrls],
      summary: '',
    };

    // Build summary
    context.summary = this.buildContextSummary(context);

    return context;
  }

  /**
   * Build app-specific context string
   */
  private buildAppSpecificContext(app: ApplicationContext | null): string {
    if (!app) {
      return '';
    }

    const parts: string[] = [];

    switch (app.appType) {
      case 'ide':
        if (app.metadata.currentFile) {
          parts.push(`Editing: ${app.metadata.currentFile}`);
        }
        if (app.metadata.language) {
          parts.push(`Language: ${app.metadata.language}`);
        }
        if (app.metadata.projectName) {
          parts.push(`Project: ${app.metadata.projectName}`);
        }
        break;

      case 'browser':
        if (app.metadata.pageTitle) {
          parts.push(`Viewing: ${app.metadata.pageTitle}`);
        }
        if (app.metadata.currentUrl) {
          parts.push(`URL: ${app.metadata.currentUrl}`);
        }
        break;

      case 'terminal':
        if (app.metadata.currentDirectory) {
          parts.push(`Directory: ${app.metadata.currentDirectory}`);
        }
        if (app.metadata.lastCommand) {
          parts.push(`Last command: ${app.metadata.lastCommand}`);
        }
        break;
    }

    return parts.join('. ');
  }

  /**
   * Build context summary for LLM
   */
  private buildContextSummary(context: ConversationContext): string {
    const parts: string[] = [];

    // Active application
    if (context.activeApp) {
      parts.push(`User is using ${context.activeApp.name}: "${context.activeApp.windowTitle}"`);
    }

    // App-specific context
    if (context.appSpecificContext) {
      parts.push(context.appSpecificContext);
    }

    // Scene description
    if (context.sceneDescription) {
      parts.push(`Screen shows: ${context.sceneDescription}`);
    }

    // Active issues
    if (context.activeIssues.length > 0) {
      const issueList = context.activeIssues
        .map(i => `- ${i.severity.toUpperCase()}: ${i.title}`)
        .join('\n');
      parts.push(`Detected issues:\n${issueList}`);
    }

    // Recent activity
    if (context.recentFiles.length > 0) {
      parts.push(`Recently accessed files: ${context.recentFiles.slice(0, 3).join(', ')}`);
    }

    return parts.join('\n\n');
  }

  /**
   * Build query-relevant summary
   */
  private buildQueryRelevantSummary(query: string, context: ConversationContext): string {
    const base = this.buildContextSummary(context);
    
    // Check if query mentions specific things we have context for
    const queryLower = query.toLowerCase();
    const additions: string[] = [];

    // Check for file references
    if (queryLower.includes('file') || queryLower.includes('code')) {
      const files = context.entities.filter(e => e.type === 'file-path');
      if (files.length > 0) {
        additions.push(`Visible files: ${files.map(f => f.value).join(', ')}`);
      }
    }

    // Check for error references
    if (queryLower.includes('error') || queryLower.includes('fix') || queryLower.includes('problem')) {
      const errors = context.activeIssues.filter(i => i.severity === 'error' || i.severity === 'critical');
      if (errors.length > 0) {
        const errorDetails = errors.map(e => `${e.title}: ${e.description}`).join('\n');
        additions.push(`Error details:\n${errorDetails}`);
      }
    }

    if (additions.length > 0) {
      return `${base}\n\nAdditional context:\n${additions.join('\n')}`;
    }

    return base;
  }

  /**
   * Track app in history
   */
  private trackApp(app: ApplicationContext): void {
    const appKey = `${app.name}:${app.windowTitle}`;
    
    // Remove if exists and add to front
    this.recentApps = this.recentApps.filter(a => a !== appKey);
    this.recentApps.unshift(appKey);
    
    // Trim to max size
    if (this.recentApps.length > this.config.maxHistoryItems) {
      this.recentApps.pop();
    }

    // Track files from IDE apps
    if (app.appType === 'ide' && app.metadata.currentFile) {
      this.trackFile(app.metadata.currentFile);
    }

    // Track URLs from browser apps
    if (app.appType === 'browser' && app.metadata.currentUrl) {
      this.trackUrl(app.metadata.currentUrl);
    }
  }

  /**
   * Track file in history
   */
  private trackFile(file: string): void {
    this.recentFiles = this.recentFiles.filter(f => f !== file);
    this.recentFiles.unshift(file);
    
    if (this.recentFiles.length > this.config.maxHistoryItems) {
      this.recentFiles.pop();
    }
  }

  /**
   * Track URL in history
   */
  private trackUrl(url: string): void {
    this.recentUrls = this.recentUrls.filter(u => u !== url);
    this.recentUrls.unshift(url);
    
    if (this.recentUrls.length > this.config.maxHistoryItems) {
      this.recentUrls.pop();
    }
  }

  /**
   * Track entities from analysis
   */
  private trackEntities(analysis: ScreenAnalysisResult): void {
    for (const entity of analysis.relevantEntities) {
      switch (entity.type) {
        case 'file-path':
          this.trackFile(entity.value);
          break;
        case 'url':
          this.trackUrl(entity.value);
          break;
      }
    }
  }

  /**
   * Create empty context
   */
  private createEmptyContext(): ConversationContext {
    return {
      timestamp: Date.now(),
      activeApp: null,
      appSpecificContext: '',
      sceneDescription: '',
      visibleText: [],
      activeIssues: [],
      pendingSuggestions: [],
      entities: [],
      recentApps: [],
      recentFiles: [],
      recentUrls: [],
      summary: 'No context available.',
    };
  }
}

// ============================================================================
// Singleton
// ============================================================================

let builderInstance: ContextBuilder | null = null;

export function getContextBuilder(config?: Partial<ContextBuilderConfig>): ContextBuilder {
  if (!builderInstance) {
    builderInstance = new ContextBuilder(config);
  }
  return builderInstance;
}

export function resetContextBuilder(): void {
  if (builderInstance) {
    builderInstance.stop();
  }
  builderInstance = null;
}
