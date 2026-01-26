/**
 * Browser Agent Voice Integration
 * 
 * Connects the browser agent's advanced intelligence modules to the voice pipeline:
 * - Predictive engine for anticipating browser tasks
 * - Context fusion for comprehensive understanding
 * - Natural language engine for command interpretation
 * 
 * This enables voice commands like "buy that laptop I was looking at" to work
 * by leveraging the browser's visual memory and site knowledge.
 * 
 * @module agent/browser-agent/voice-integration
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../../utils/logger';
import { getPredictiveEngine, type TaskPlan, type ActionPrediction } from './predictive-engine';
import { getContextFusionEngine, type FusedContext, type ConversationContext } from './context-fusion';
import { getWebsiteKnowledgeBase, type WebsiteProfile } from './website-knowledge';
import { getVisualMemory, type VisualSnapshot } from './visual-memory';
import { getNaturalLanguageEngine, type NLUResult } from './natural-language';
import type { BrowserState, BrowserTask, BrowserAction } from './types';

const logger = createModuleLogger('BrowserVoiceIntegration');

// =============================================================================
// Types
// =============================================================================

export interface VoiceTaskRequest {
  /** Raw voice command */
  command: string;
  /** Conversation context from voice pipeline */
  conversationContext?: {
    recentMessages: Array<{ role: string; content: string }>;
    currentEmotion?: string;
    timeOfDay?: string;
  };
  /** Whether to require confirmation */
  requireConfirmation?: boolean;
}

export interface VoiceTaskResult {
  /** Task ID */
  taskId: string;
  /** Interpreted intent */
  intent: string;
  /** Task plan if created */
  plan?: TaskPlan;
  /** Predicted actions */
  predictedActions: ActionPrediction[];
  /** Confidence in interpretation */
  confidence: number;
  /** Natural language explanation */
  explanation: string;
  /** Needs clarification */
  needsClarification?: boolean;
  /** Clarification question */
  clarificationQuestion?: string;
  /** Referenced entities from memory */
  referencedEntities: string[];
}

export interface BrowserVoiceContext {
  /** Is browser currently active */
  browserActive: boolean;
  /** Current page info */
  currentPage?: {
    url: string;
    title: string;
    domain: string;
  };
  /** Site knowledge available */
  siteKnowledge?: WebsiteProfile;
  /** Recent visual state */
  visualSnapshot?: VisualSnapshot;
  /** Active tasks */
  activeTasks: string[];
}

export interface VoiceIntegrationEvents {
  'task-interpreted': (result: VoiceTaskResult) => void;
  'context-updated': (context: BrowserVoiceContext) => void;
  'prediction-ready': (predictions: ActionPrediction[]) => void;
  'clarification-needed': (question: string, options: string[]) => void;
  error: (error: Error) => void;
}

// =============================================================================
// Browser Voice Integrator
// =============================================================================

export class BrowserVoiceIntegrator extends EventEmitter {
  private browserContext: BrowserVoiceContext = {
    browserActive: false,
    activeTasks: [],
  };
  private conversationHistory: Array<{ role: string; content: string }> = [];
  private pendingClarifications = new Map<string, VoiceTaskResult>();
  private lastBrowserState: BrowserState | null = null;

  constructor() {
    super();
    this.setMaxListeners(20);
    logger.info('BrowserVoiceIntegrator initialized');
  }

  // ===========================================================================
  // Voice Command Processing
  // ===========================================================================

  /**
   * Process a voice command for browser tasks
   */
  async processVoiceCommand(request: VoiceTaskRequest): Promise<VoiceTaskResult> {
    const startTime = Date.now();
    
    try {
      // Update conversation context
      if (request.conversationContext?.recentMessages) {
        this.conversationHistory = request.conversationContext.recentMessages.slice(-10);
      }
      this.conversationHistory.push({ role: 'user', content: request.command });

      // Step 1: Natural language understanding
      const nlu = getNaturalLanguageEngine();
      const nluResult = await this.interpretCommand(request.command);

      // Step 2: Check if we need the browser
      const requiresBrowser = this.commandRequiresBrowser(request.command, nluResult);
      
      if (!requiresBrowser) {
        return {
          taskId: this.generateTaskId(),
          intent: 'non_browser',
          predictedActions: [],
          confidence: 0.9,
          explanation: 'This command does not require browser interaction.',
          referencedEntities: [],
        };
      }

      // Step 3: Get current browser context
      await this.updateBrowserContext();

      // Step 4: Fuse all context sources
      const fusedContext = await this.getFusedContext(request.command);

      // Step 5: Create task plan
      const plan = await this.createTaskPlan(request.command, fusedContext);

      // Step 6: Get predictions
      const predictions = await this.getPredictions(request.command, fusedContext);

      // Step 7: Check if clarification needed
      const clarification = this.checkNeedsClarification(nluResult, fusedContext);

      const result: VoiceTaskResult = {
        taskId: this.generateTaskId(),
        intent: nluResult?.intent || 'unknown',
        plan,
        predictedActions: predictions,
        confidence: fusedContext?.confidence || 0.5,
        explanation: this.generateExplanation(request.command, plan, predictions),
        needsClarification: clarification.needed,
        clarificationQuestion: clarification.question,
        referencedEntities: this.extractReferences(request.command, fusedContext),
      };

      logger.info('Voice command processed', {
        command: request.command.substring(0, 50),
        intent: result.intent,
        confidence: result.confidence,
        latencyMs: Date.now() - startTime,
      });

      this.emit('task-interpreted', result);
      return result;

    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('Failed to process voice command', { error: err.message });
      this.emit('error', err);
      
      return {
        taskId: this.generateTaskId(),
        intent: 'error',
        predictedActions: [],
        confidence: 0,
        explanation: `Failed to process command: ${err.message}`,
        referencedEntities: [],
      };
    }
  }

  /**
   * Provide clarification answer
   */
  async provideClarification(taskId: string, answer: string): Promise<VoiceTaskResult | null> {
    const pending = this.pendingClarifications.get(taskId);
    if (!pending) {
      logger.warn('No pending clarification for task', { taskId });
      return null;
    }

    this.pendingClarifications.delete(taskId);
    
    // Re-process with clarification
    const clarifiedCommand = `${pending.intent}: ${answer}`;
    return this.processVoiceCommand({
      command: clarifiedCommand,
      requireConfirmation: true,
    });
  }

  // ===========================================================================
  // Context Management
  // ===========================================================================

  /**
   * Update browser state from the browser agent
   */
  updateBrowserState(state: BrowserState): void {
    this.lastBrowserState = state;
    this.browserContext.browserActive = true;
    this.browserContext.currentPage = {
      url: state.url,
      title: state.title,
      domain: new URL(state.url).hostname,
    };

    // Update site knowledge
    try {
      const kb = getWebsiteKnowledgeBase();
      this.browserContext.siteKnowledge = kb.getProfile(this.browserContext.currentPage.domain);
    } catch (_error) {
      // Knowledge base not available
    }

    this.emit('context-updated', this.browserContext);
  }

  /**
   * Update browser context from visual memory
   */
  private async updateBrowserContext(): Promise<void> {
    try {
      const visualMemory = getVisualMemory();
      const snapshot = visualMemory.getLatestSnapshot();
      if (snapshot) {
        this.browserContext.visualSnapshot = snapshot;
      }
    } catch (_error) {
      // Visual memory not available
    }
  }

  /**
   * Get fused context for decision making
   */
  private async getFusedContext(command: string): Promise<FusedContext | null> {
    if (!this.lastBrowserState) {
      return null;
    }

    try {
      const fusion = getContextFusionEngine();
      const conversationContext: ConversationContext = {
        currentTask: command,
        recentMessages: this.conversationHistory.map(m => m.content),
        extractedEntities: this.extractEntitiesFromCommand(command),
        mentionedUrls: this.extractUrls(command),
        references: [],
        userIntent: command,
      };

      return await fusion.fuse(this.lastBrowserState, conversationContext);
    } catch (error) {
      logger.debug('Context fusion not available', { error });
      return null;
    }
  }

  // ===========================================================================
  // NLU & Prediction
  // ===========================================================================

  /**
   * Interpret a voice command using NLU
   */
  private async interpretCommand(command: string): Promise<NLUResult | null> {
    try {
      const nlu = getNaturalLanguageEngine();
      return await nlu.process(command, this.lastBrowserState || undefined);
    } catch (_error) {
      return null;
    }
  }

  /**
   * Check if command requires browser
   */
  private commandRequiresBrowser(command: string, _nluResult: NLUResult | null): boolean {
    const browserKeywords = [
      'browse', 'website', 'page', 'click', 'search', 'google', 'amazon',
      'buy', 'order', 'book', 'navigate', 'go to', 'open', 'login', 'sign in',
      'fill', 'form', 'checkout', 'cart', 'looking at', 'i was looking',
    ];

    const lower = command.toLowerCase();
    return browserKeywords.some(kw => lower.includes(kw));
  }

  /**
   * Create a task plan for the command
   */
  private async createTaskPlan(command: string, context: FusedContext | null): Promise<TaskPlan | undefined> {
    if (!this.lastBrowserState) {
      return undefined;
    }

    try {
      const engine = getPredictiveEngine();
      return await engine.createTaskPlan(command, this.lastBrowserState);
    } catch (error) {
      logger.debug('Task planning not available', { error });
      return undefined;
    }
  }

  /**
   * Get action predictions
   */
  private async getPredictions(command: string, context: FusedContext | null): Promise<ActionPrediction[]> {
    // Use context's predicted actions if available
    if (context?.predictedActions) {
      return context.predictedActions;
    }

    if (!this.lastBrowserState) {
      return [];
    }

    try {
      const engine = getPredictiveEngine();
      return await engine.predictNextActions(this.lastBrowserState, []);
    } catch (_error) {
      return [];
    }
  }

  /**
   * Check if clarification is needed
   */
  private checkNeedsClarification(
    nluResult: NLUResult | null,
    context: FusedContext | null
  ): { needed: boolean; question?: string } {
    // Check if NLU has ambiguity
    if (nluResult?.needsDisambiguation) {
      const options = nluResult.disambiguationOptions?.map(o => o.text).join(', ') || '';
      return {
        needed: true,
        question: `I found multiple options: ${options}. Which one did you mean?`,
      };
    }

    // Check confidence
    if (nluResult && nluResult.confidence < 0.5) {
      return {
        needed: true,
        question: 'I\'m not sure I understood. Could you be more specific?',
      };
    }

    return { needed: false };
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  /**
   * Generate explanation for the task
   */
  private generateExplanation(
    command: string,
    plan: TaskPlan | undefined,
    predictions: ActionPrediction[]
  ): string {
    if (plan) {
      const stepCount = plan.steps.length;
      const firstStep = plan.steps[0]?.description || 'starting the task';
      return `I'll ${firstStep}, then complete ${stepCount - 1} more steps. ` +
             `Confidence: ${(plan.successProbability * 100).toFixed(0)}%`;
    }

    if (predictions.length > 0) {
      const topPrediction = predictions[0];
      return `I'll ${topPrediction.reasoning}. ${topPrediction.expectedOutcome}`;
    }

    return 'I\'ll work on that browser task for you.';
  }

  /**
   * Extract referenced entities from command and context
   */
  private extractReferences(command: string, context: FusedContext | null): string[] {
    const refs: string[] = [];

    // Check for "that", "this", "it" references
    const referentialPatterns = /\b(that|this|it|those|these)\b/gi;
    if (referentialPatterns.test(command)) {
      // Try to resolve from visual memory
      if (this.browserContext.visualSnapshot) {
        refs.push(`Recent page: ${this.browserContext.currentPage?.title || 'unknown'}`);
      }
      
      // Try to resolve from site knowledge
      if (this.browserContext.siteKnowledge) {
        const recentWorkflows = this.browserContext.siteKnowledge.workflows?.slice(0, 3);
        if (recentWorkflows) {
          refs.push(...recentWorkflows.map(w => w.name));
        }
      }
    }

    return refs;
  }

  /**
   * Extract entities from command
   */
  private extractEntitiesFromCommand(command: string): string[] {
    // Simple entity extraction - proper NER would be better
    const entities: string[] = [];
    
    // Extract quoted strings
    const quotes = command.match(/"([^"]+)"|'([^']+)'/g);
    if (quotes) {
      entities.push(...quotes.map(q => q.replace(/['"]/g, '')));
    }

    // Extract capitalized words (likely proper nouns)
    const caps = command.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g);
    if (caps) {
      entities.push(...caps);
    }

    return entities;
  }

  /**
   * Extract URLs from command
   */
  private extractUrls(command: string): string[] {
    const urlPattern = /https?:\/\/[^\s]+/g;
    return command.match(urlPattern) || [];
  }

  /**
   * Generate unique task ID
   */
  private generateTaskId(): string {
    return `voice-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  }

  // ===========================================================================
  // Voice Pipeline Integration
  // ===========================================================================

  /**
   * Get context for LLM system prompt injection
   * This provides browser context to the voice pipeline's LLM
   */
  getBrowserContextForLLM(): string {
    if (!this.browserContext.browserActive) {
      return '';
    }

    const parts: string[] = ['\n\n[BROWSER CONTEXT]'];

    if (this.browserContext.currentPage) {
      parts.push(`Current page: ${this.browserContext.currentPage.title} (${this.browserContext.currentPage.domain})`);
    }

    if (this.browserContext.siteKnowledge) {
      const workflows = this.browserContext.siteKnowledge.workflows?.slice(0, 3);
      if (workflows && workflows.length > 0) {
        parts.push(`Known workflows: ${workflows.map(w => w.name).join(', ')}`);
      }
    }

    if (this.browserContext.visualSnapshot) {
      parts.push('Visual state captured - can reference recent page elements.');
    }

    return parts.join('\n');
  }

  /**
   * Pre-warm browser context for voice command
   */
  async preWarmForVoice(partialCommand: string): Promise<void> {
    // If command might involve browser, start warming up
    if (this.commandRequiresBrowser(partialCommand, null)) {
      await this.updateBrowserContext();
      
      if (this.lastBrowserState) {
        try {
          const engine = getPredictiveEngine();
          const predictions = await engine.predictNextActions(this.lastBrowserState, []);
          
          if (predictions.length > 0) {
            this.emit('prediction-ready', predictions);
          }
        } catch (_error) {
          // Predictions not available
        }
      }
    }
  }

  // ===========================================================================
  // State Access
  // ===========================================================================

  getBrowserContext(): BrowserVoiceContext {
    return { ...this.browserContext };
  }

  isActive(): boolean {
    return this.browserContext.browserActive;
  }
}

// =============================================================================
// Singleton
// =============================================================================

let instance: BrowserVoiceIntegrator | null = null;

export function getBrowserVoiceIntegrator(): BrowserVoiceIntegrator {
  if (!instance) {
    instance = new BrowserVoiceIntegrator();
  }
  return instance;
}

export function shutdownBrowserVoiceIntegrator(): void {
  if (instance) {
    instance.removeAllListeners();
    instance = null;
  }
}
