/**
 * @fileoverview PersonalityContextBuilder - Unified Context Aggregation for Atlas
 * @module personality-context-builder
 * @author Atlas Team
 * @since 1.0.0
 *
 * @description
 * This module aggregates context from all Atlas subsystems to create a rich,
 * personalized context for LLM interactions. It pulls from:
 * - User Profile (preferences, corrections, coding style)
 * - Knowledge Store (learned facts, relationships)
 * - Persona Manager (active personality mode)
 * - Emotion Detector (current user emotional state)
 * - Session Context (recent conversation history)
 * - Trading Context (portfolio state, recent trades)
 * - Business Context (client status, invoices)
 *
 * The builder creates a comprehensive context injection for the system prompt
 * that makes Atlas truly "know" Ben and adapt to his needs.
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import { getUserProfileManager, UserProfile, LearnedPreference, UserCorrection, CodingPreference } from '../memory/user-profile';
import { getKnowledgeStore, KnowledgeStore, KnowledgeEntry } from '../memory/knowledge-store';
import { getPersonaManager, PersonaManager, PersonaPromptModifiers } from './persona-manager';
import { getEmotionDetector, EmotionDetector, EmotionState } from '../intelligence/emotion-detector';
import { getMemoryManager } from '../memory';
import { getUnifiedBrain, UnifiedMemoryBrain, ContextBundle } from '../memory/unified-brain';

const logger = createModuleLogger('PersonalityContextBuilder');

// ============================================================================
// Types
// ============================================================================

/**
 * Context sections that can be enabled/disabled
 */
export interface ContextSections {
  userProfile: boolean;
  knownFacts: boolean;
  recentCorrections: boolean;
  codingPreferences: boolean;
  emotionalContext: boolean;
  personaMode: boolean;
  tradingContext: boolean;
  businessContext: boolean;
  timeAwareness: boolean;
  selfReflection: boolean;
  /** WorldBox evolutionary wisdom and observations */
  worldBoxWisdom: boolean;
  /** Unified memory context from all sources */
  unifiedMemory: boolean;
}

/**
 * Configuration for the context builder
 */
export interface ContextBuilderConfig {
  /** Maximum tokens to allocate for context injection */
  maxContextTokens: number;
  /** Sections to include */
  sections: ContextSections;
  /** Minimum confidence for facts to be included */
  minFactConfidence: number;
  /** Maximum number of facts to include */
  maxFacts: number;
  /** Maximum corrections to include */
  maxCorrections: number;
  /** Maximum coding preferences to include */
  maxCodingPrefs: number;
}

/**
 * Built context ready for injection
 */
export interface BuiltContext {
  /** Complete context string for system prompt injection */
  contextString: string;
  /** Individual sections for debugging/logging */
  sections: {
    userProfile?: string;
    knownFacts?: string;
    recentCorrections?: string;
    codingPreferences?: string;
    emotionalContext?: string;
    personaMode?: string;
    tradingContext?: string;
    businessContext?: string;
    timeAwareness?: string;
    selfReflection?: string;
    /** WorldBox evolutionary wisdom and observations */
    worldBoxWisdom?: string;
    /** Unified memory context from all sources */
    unifiedMemory?: string;
  };
  /** Metadata about the build */
  metadata: {
    buildTime: number;
    tokenEstimate: number;
    sectionsIncluded: string[];
    factCount: number;
    correctionCount: number;
  };
}

/**
 * Trading context summary for injection
 */
interface TradingContextSummary {
  status: 'running' | 'paused' | 'stopped';
  todayPnL: number;
  openPositions: number;
  winRate: number;
  recentTrades: Array<{ symbol: string; result: 'win' | 'loss'; pnl: number }>;
  mood: 'confident' | 'cautious' | 'nervous' | 'neutral';
}

/**
 * Business context summary for injection
 */
interface BusinessContextSummary {
  unpaidInvoices: number;
  unpaidAmount: number;
  overdueProjects: number;
  clientsNeedingFollowUp: number;
  thisMonthRevenue: number;
  thisMonthExpenses: number;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: ContextBuilderConfig = {
  maxContextTokens: 2000,
  sections: {
    userProfile: true,
    knownFacts: true,
    recentCorrections: true,
    codingPreferences: true,
    emotionalContext: true,
    personaMode: true,
    tradingContext: true,
    businessContext: true,
    timeAwareness: true,
    selfReflection: false, // Enable when we have session summary
    worldBoxWisdom: true,  // WorldBox evolutionary insights
    unifiedMemory: true,   // Unified memory context
  },
  minFactConfidence: 0.6,
  maxFacts: 15,
  maxCorrections: 5,
  maxCodingPrefs: 8,
};

// ============================================================================
// PersonalityContextBuilder Class
// ============================================================================

/**
 * Builds personalized context for LLM interactions by aggregating
 * information from all Atlas subsystems.
 *
 * @class PersonalityContextBuilder
 * @extends EventEmitter
 *
 * @example
 * ```typescript
 * const builder = getPersonalityContextBuilder();
 * await builder.initialize();
 *
 * // Build context for a query
 * const context = await builder.buildContext("Help me with TypeScript");
 *
 * // Use in system prompt
 * const systemPrompt = ATLAS_SYSTEM_PROMPT + context.contextString;
 * ```
 */
export class PersonalityContextBuilder extends EventEmitter {
  private config: ContextBuilderConfig;
  private initialized = false;

  // Subsystem references (lazy-loaded)
  private userProfileManager: ReturnType<typeof getUserProfileManager> | null = null;
  private knowledgeStore: KnowledgeStore | null = null;
  private personaManager: PersonaManager | null = null;
  private emotionDetector: EmotionDetector | null = null;
  
  /** Unified Memory Brain - central orchestrator for all memory systems */
  private unifiedBrain: UnifiedMemoryBrain | null = null;

  // Trading/business context providers (injected)
  private tradingContextProvider: (() => Promise<TradingContextSummary | null>) | null = null;
  private businessContextProvider: (() => Promise<BusinessContextSummary | null>) | null = null;

  constructor(config?: Partial<ContextBuilderConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize the context builder and connect to subsystems
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    logger.info('Initializing PersonalityContextBuilder');

    try {
      // Load subsystems (they may already be initialized)
      this.userProfileManager = getUserProfileManager();
      this.knowledgeStore = getKnowledgeStore();
      this.personaManager = getPersonaManager();
      this.emotionDetector = getEmotionDetector();
      
      // Initialize Unified Memory Brain - the central intelligence
      this.unifiedBrain = getUnifiedBrain();
      await this.unifiedBrain.initialize();
      logger.info('UnifiedMemoryBrain connected to PersonalityContextBuilder');

      // Ensure persona manager is initialized
      if (this.personaManager && !this.personaManager['initialized']) {
        await this.personaManager.initialize();
      }

      this.initialized = true;
      logger.info('PersonalityContextBuilder initialized');
      this.emit('initialized');
    } catch (error) {
      logger.error('Failed to initialize PersonalityContextBuilder', { error });
      throw error;
    }
  }

  /**
   * Register a trading context provider
   */
  setTradingContextProvider(provider: () => Promise<TradingContextSummary | null>): void {
    this.tradingContextProvider = provider;
  }

  /**
   * Register a business context provider
   */
  setBusinessContextProvider(provider: () => Promise<BusinessContextSummary | null>): void {
    this.businessContextProvider = provider;
  }

  /**
   * Build comprehensive context for LLM injection
   *
   * @param query - The current user query (used for relevance filtering)
   * @param currentEmotion - Current detected emotion state
   * @returns Built context with all sections
   */
  async buildContext(
    query?: string,
    currentEmotion?: EmotionState
  ): Promise<BuiltContext> {
    const startTime = Date.now();
    const sections: BuiltContext['sections'] = {};
    const sectionsIncluded: string[] = [];
    let factCount = 0;
    let correctionCount = 0;

    // Build each enabled section
    if (this.config.sections.userProfile) {
      sections.userProfile = await this.buildUserProfileSection();
      if (sections.userProfile) sectionsIncluded.push('userProfile');
    }

    if (this.config.sections.knownFacts) {
      const result = await this.buildKnownFactsSection(query);
      sections.knownFacts = result.text;
      factCount = result.count;
      if (sections.knownFacts) sectionsIncluded.push('knownFacts');
    }

    if (this.config.sections.recentCorrections) {
      const result = await this.buildCorrectionsSection();
      sections.recentCorrections = result.text;
      correctionCount = result.count;
      if (sections.recentCorrections) sectionsIncluded.push('recentCorrections');
    }

    if (this.config.sections.codingPreferences) {
      sections.codingPreferences = await this.buildCodingPrefsSection();
      if (sections.codingPreferences) sectionsIncluded.push('codingPreferences');
    }

    if (this.config.sections.emotionalContext && currentEmotion) {
      sections.emotionalContext = this.buildEmotionalContextSection(currentEmotion);
      if (sections.emotionalContext) sectionsIncluded.push('emotionalContext');
    }

    if (this.config.sections.personaMode) {
      sections.personaMode = this.buildPersonaModeSection();
      if (sections.personaMode) sectionsIncluded.push('personaMode');
    }

    if (this.config.sections.tradingContext && this.tradingContextProvider) {
      sections.tradingContext = await this.buildTradingContextSection();
      if (sections.tradingContext) sectionsIncluded.push('tradingContext');
    }

    if (this.config.sections.businessContext && this.businessContextProvider) {
      sections.businessContext = await this.buildBusinessContextSection();
      if (sections.businessContext) sectionsIncluded.push('businessContext');
    }

    if (this.config.sections.timeAwareness) {
      sections.timeAwareness = this.buildTimeAwarenessSection();
      if (sections.timeAwareness) sectionsIncluded.push('timeAwareness');
    }

    // WorldBox evolutionary wisdom - insights from observing digital evolution
    if (this.config.sections.worldBoxWisdom && this.unifiedBrain) {
      sections.worldBoxWisdom = await this.buildWorldBoxWisdomSection();
      if (sections.worldBoxWisdom) sectionsIncluded.push('worldBoxWisdom');
    }

    // Unified Memory context - comprehensive recall from all memory systems
    if (this.config.sections.unifiedMemory && this.unifiedBrain && query) {
      const unifiedResult = await this.buildUnifiedMemorySection(query);
      sections.unifiedMemory = unifiedResult.text;
      if (sections.unifiedMemory) sectionsIncluded.push('unifiedMemory');
    }

    // Combine all sections
    const contextString = this.combineSections(sections);
    const tokenEstimate = Math.ceil(contextString.length / 4); // Rough estimate

    const buildTime = Date.now() - startTime;
    logger.debug('Context built', {
      buildTime,
      tokenEstimate,
      sectionsIncluded,
      factCount,
      correctionCount,
    });

    return {
      contextString,
      sections,
      metadata: {
        buildTime,
        tokenEstimate,
        sectionsIncluded,
        factCount,
        correctionCount,
      },
    };
  }

  // ==========================================================================
  // Section Builders
  // ==========================================================================

  /**
   * Build user profile section
   */
  private async buildUserProfileSection(): Promise<string | undefined> {
    if (!this.userProfileManager) return undefined;

    try {
      const profile = this.userProfileManager.getProfile();
      if (!profile) return undefined;

      const lines: string[] = ['[USER PROFILE]'];

      // Communication preferences
      const style = profile.communicationStyle;
      if (style.preferredName) {
        lines.push(`Preferred name: ${style.preferredName}`);
      }
      lines.push(`Communication style: ${style.verbosity}, ${style.formality > 0.5 ? 'formal' : 'casual'}`);
      lines.push(`Technical depth: ${style.technicalDepth > 0.7 ? 'high' : style.technicalDepth > 0.4 ? 'medium' : 'simple'}`);

      // Activity pattern insights
      if (profile.totalSessions > 10) {
        const mostActiveHours = this.getMostActiveHours(profile);
        if (mostActiveHours.length > 0) {
          lines.push(`Most active hours: ${mostActiveHours.join(', ')}`);
        }
      }

      // Top interests
      const topInterests = this.getTopInterests(profile);
      if (topInterests.length > 0) {
        lines.push(`Top interests: ${topInterests.join(', ')}`);
      }

      return lines.join('\n');
    } catch (error) {
      logger.warn('Failed to build user profile section', { error });
      return undefined;
    }
  }

  /**
   * Build known facts section
   */
  private async buildKnownFactsSection(query?: string): Promise<{ text: string | undefined; count: number }> {
    if (!this.knowledgeStore) return { text: undefined, count: 0 };

    try {
      // Get query-relevant facts
      let facts: KnowledgeEntry[] = [];

      if (query) {
        facts = this.knowledgeStore.query({
          text: query,
          minConfidenceScore: this.config.minFactConfidence,
          sortBy: 'confidence',
          limit: this.config.maxFacts,
        });
      }

      // Always include high-confidence user facts
      const userFacts = this.knowledgeStore.getUserFacts()
        .filter(f => f.confidenceScore >= this.config.minFactConfidence)
        .slice(0, 5);

      const userPrefs = this.knowledgeStore.getUserPreferences()
        .filter(f => f.confidenceScore >= this.config.minFactConfidence)
        .slice(0, 5);

      // Combine and dedupe
      const allFacts = new Map<string, KnowledgeEntry>();
      for (const fact of [...facts, ...userFacts, ...userPrefs]) {
        allFacts.set(fact.id, fact);
      }

      const uniqueFacts = Array.from(allFacts.values()).slice(0, this.config.maxFacts);
      if (uniqueFacts.length === 0) return { text: undefined, count: 0 };

      const lines: string[] = ['[WHAT I KNOW ABOUT BEN]'];
      for (const fact of uniqueFacts) {
        lines.push(`- ${fact.naturalForm}`);
      }

      return { text: lines.join('\n'), count: uniqueFacts.length };
    } catch (error) {
      logger.warn('Failed to build known facts section', { error });
      return { text: undefined, count: 0 };
    }
  }

  /**
   * Build corrections section (mistakes not to repeat)
   */
  private async buildCorrectionsSection(): Promise<{ text: string | undefined; count: number }> {
    if (!this.userProfileManager) return { text: undefined, count: 0 };

    try {
      const profile = this.userProfileManager.getProfile();
      if (!profile || !profile.corrections || profile.corrections.length === 0) {
        return { text: undefined, count: 0 };
      }

      // Get recent, unapplied corrections
      const recentCorrections = profile.corrections
        .filter(c => !c.applied)
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, this.config.maxCorrections);

      if (recentCorrections.length === 0) return { text: undefined, count: 0 };

      const lines: string[] = ['[RECENT CORRECTIONS - AVOID THESE MISTAKES]'];
      for (const correction of recentCorrections) {
        lines.push(`- Wrong: "${correction.wrong}" → Right: "${correction.right}"`);
        if (correction.context) {
          lines.push(`  Context: ${correction.context}`);
        }
      }

      return { text: lines.join('\n'), count: recentCorrections.length };
    } catch (error) {
      logger.warn('Failed to build corrections section', { error });
      return { text: undefined, count: 0 };
    }
  }

  /**
   * Build coding preferences section
   */
  private async buildCodingPrefsSection(): Promise<string | undefined> {
    if (!this.userProfileManager) return undefined;

    try {
      const profile = this.userProfileManager.getProfile();
      if (!profile || !profile.codingPreferences || profile.codingPreferences.length === 0) {
        return undefined;
      }

      // Get strongest preferences
      const prefs = [...profile.codingPreferences]
        .sort((a, b) => b.strength - a.strength)
        .slice(0, this.config.maxCodingPrefs);

      if (prefs.length === 0) return undefined;

      const lines: string[] = ['[BEN\'S CODING PREFERENCES]'];
      for (const pref of prefs) {
        lines.push(`- ${pref.topic}: ${pref.preference}`);
        if (pref.reason) {
          lines.push(`  (Why: ${pref.reason})`);
        }
      }

      return lines.join('\n');
    } catch (error) {
      logger.warn('Failed to build coding prefs section', { error });
      return undefined;
    }
  }

  /**
   * Build emotional context section
   */
  private buildEmotionalContextSection(emotion: EmotionState): string | undefined {
    if (!emotion || emotion.primary.confidence < 0.5) return undefined;

    const lines: string[] = ['[EMOTIONAL CONTEXT]'];
    lines.push(`Ben appears to be feeling: ${emotion.primary.type} (${Math.round(emotion.primary.confidence * 100)}% confidence)`);

    if (emotion.secondary && emotion.secondary.confidence > 0.4) {
      lines.push(`Secondary emotion: ${emotion.secondary.type}`);
    }

    // Add response guidance based on emotion
    const guidance = this.getEmotionGuidance(emotion.primary.type);
    if (guidance) {
      lines.push(`Response approach: ${guidance}`);
    }

    return lines.join('\n');
  }

  /**
   * Build persona mode section
   */
  private buildPersonaModeSection(): string | undefined {
    if (!this.personaManager) return undefined;

    try {
      const modifiers = this.personaManager.getPromptModifiers();
      if (!modifiers || (!modifiers.systemPromptPrefix && !modifiers.responseStyleGuide)) {
        return undefined;
      }

      const lines: string[] = ['[PERSONA MODE]'];

      if (modifiers.systemPromptPrefix) {
        lines.push(modifiers.systemPromptPrefix);
      }

      if (modifiers.responseStyleGuide) {
        lines.push('');
        lines.push('Style Guide:');
        lines.push(modifiers.responseStyleGuide);
      }

      return lines.join('\n');
    } catch (error) {
      logger.warn('Failed to build persona mode section', { error });
      return undefined;
    }
  }

  /**
   * Build trading context section
   */
  private async buildTradingContextSection(): Promise<string | undefined> {
    if (!this.tradingContextProvider) return undefined;

    try {
      const trading = await this.tradingContextProvider();
      if (!trading) return undefined;

      const lines: string[] = ['[TRADING STATUS]'];
      lines.push(`Status: ${trading.status}`);
      lines.push(`Today's P&L: ${trading.todayPnL >= 0 ? '+' : ''}£${trading.todayPnL.toFixed(2)}`);
      lines.push(`Open positions: ${trading.openPositions}`);
      lines.push(`Win rate: ${(trading.winRate * 100).toFixed(1)}%`);
      lines.push(`Mood: ${trading.mood}`);

      // Recent trades summary
      if (trading.recentTrades.length > 0) {
        const wins = trading.recentTrades.filter(t => t.result === 'win').length;
        const losses = trading.recentTrades.length - wins;
        lines.push(`Recent streak: ${wins}W ${losses}L`);
      }

      return lines.join('\n');
    } catch (error) {
      logger.warn('Failed to build trading context section', { error });
      return undefined;
    }
  }

  /**
   * Build business context section
   */
  private async buildBusinessContextSection(): Promise<string | undefined> {
    if (!this.businessContextProvider) return undefined;

    try {
      const business = await this.businessContextProvider();
      if (!business) return undefined;

      const lines: string[] = ['[BUSINESS STATUS]'];

      if (business.unpaidInvoices > 0) {
        lines.push(`Unpaid invoices: ${business.unpaidInvoices} (£${business.unpaidAmount.toFixed(0)})`);
      }

      if (business.overdueProjects > 0) {
        lines.push(`Overdue projects: ${business.overdueProjects}`);
      }

      if (business.clientsNeedingFollowUp > 0) {
        lines.push(`Clients needing follow-up: ${business.clientsNeedingFollowUp}`);
      }

      lines.push(`This month: Revenue £${business.thisMonthRevenue.toFixed(0)}, Expenses £${business.thisMonthExpenses.toFixed(0)}`);
      lines.push(`Net: £${(business.thisMonthRevenue - business.thisMonthExpenses).toFixed(0)}`);

      return lines.join('\n');
    } catch (error) {
      logger.warn('Failed to build business context section', { error });
      return undefined;
    }
  }

  /**
   * Build time awareness section
   */
  private buildTimeAwarenessSection(): string {
    const now = new Date();
    const hour = now.getHours();
    const day = now.toLocaleDateString('en-GB', { weekday: 'long' });
    const date = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

    const lines: string[] = ['[TIME CONTEXT]'];
    lines.push(`Current time: ${now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}, ${day} ${date}`);

    // Time-based behavior hints
    if (hour >= 23 || hour < 5) {
      lines.push('Note: Late night/early hours - be gentle, suggest rest if appropriate');
    } else if (hour >= 5 && hour < 9) {
      lines.push('Note: Early morning - brief greeting appropriate');
    } else if (hour >= 12 && hour < 14) {
      lines.push('Note: Lunch time');
    }

    // Day-based hints
    if (day === 'Friday') {
      lines.push('Note: End of week');
    } else if (day === 'Monday') {
      lines.push('Note: Start of week');
    } else if (day === 'Saturday' || day === 'Sunday') {
      lines.push('Note: Weekend');
    }

    return lines.join('\n');
  }

  /**
   * Build WorldBox evolutionary wisdom section
   * 
   * This section provides Atlas with philosophical insights derived from
   * observing digital civilizations rise and fall in WorldBox. These
   * observations translate into real-world wisdom about systems, growth,
   * and the nature of complex adaptive systems.
   */
  private async buildWorldBoxWisdomSection(): Promise<string | undefined> {
    if (!this.unifiedBrain) return undefined;

    try {
      const wisdom = await this.unifiedBrain.getWorldBoxWisdom();
      if (!wisdom || wisdom.length === 0) return undefined;

      const lines: string[] = ['[EVOLUTIONARY WISDOM - From WorldBox Observations]'];
      lines.push('These insights come from watching civilizations evolve:');
      lines.push('');

      // Format wisdom entries
      for (const insight of wisdom.slice(0, 5)) {
        if (typeof insight === 'string') {
          lines.push(`• ${insight}`);
        } else if (insight && typeof insight === 'object' && 'content' in insight) {
          lines.push(`• ${insight.content}`);
        }
      }

      lines.push('');
      lines.push('Apply these patterns to help Ben see the bigger picture.');

      return lines.join('\n');
    } catch (error) {
      logger.warn('Failed to build WorldBox wisdom section', { error });
      return undefined;
    }
  }

  /**
   * Build unified memory context section
   * 
   * This pulls relevant memories from ALL Atlas memory systems:
   * - Conversation history
   * - Obsidian vault knowledge
   * - Knowledge store facts
   * - Vector-similarity results
   * - WorldBox observations
   * 
   * The UnifiedMemoryBrain ranks and deduplicates these into
   * the most relevant context for the current query.
   */
  private async buildUnifiedMemorySection(query: string): Promise<{ text: string | undefined; count: number }> {
    if (!this.unifiedBrain) return { text: undefined, count: 0 };

    try {
      // Get unified context bundle from the brain
      const contextBundle = await this.unifiedBrain.getContextForQuery(query, 1000);
      
      if (!contextBundle || (!contextBundle.memories.length && !contextBundle.topics.length)) {
        return { text: undefined, count: 0 };
      }

      const lines: string[] = ['[UNIFIED MEMORY CONTEXT]'];

      // Add relevant memories
      if (contextBundle.memories.length > 0) {
        lines.push('Relevant memories:');
        for (const memory of contextBundle.memories.slice(0, 8)) {
          const source = memory.source ? ` (${memory.source})` : '';
          lines.push(`• ${memory.content}${source}`);
        }
      }

      // Add relevant topics
      if (contextBundle.topics && contextBundle.topics.length > 0) {
        lines.push('');
        lines.push(`Related topics: ${contextBundle.topics.join(', ')}`);
      }

      // Add any active preferences
      if (contextBundle.preferences && Object.keys(contextBundle.preferences).length > 0) {
        lines.push('');
        lines.push('Active preferences:');
        for (const [key, value] of Object.entries(contextBundle.preferences)) {
          lines.push(`• ${key}: ${value}`);
        }
      }

      return { 
        text: lines.join('\n'), 
        count: contextBundle.memories.length 
      };
    } catch (error) {
      logger.warn('Failed to build unified memory section', { error });
      return { text: undefined, count: 0 };
    }
  }

  // ==========================================================================
  // Helper Methods
  // ==========================================================================

  /**
   * Combine all sections into a single context string
   */
  private combineSections(sections: BuiltContext['sections']): string {
    const parts: string[] = [];

    // Order matters - most important first
    const order: (keyof BuiltContext['sections'])[] = [
      'timeAwareness',
      'emotionalContext',
      'personaMode',
      'userProfile',
      'knownFacts',
      'recentCorrections',
      'codingPreferences',
      'tradingContext',
      'businessContext',
      'selfReflection',
      'worldBoxWisdom',    // Evolutionary insights
      'unifiedMemory',     // Unified memory context
    ];

    for (const key of order) {
      const section = sections[key];
      if (section) {
        parts.push(section);
      }
    }

    if (parts.length === 0) return '';

    return '\n\n' + parts.join('\n\n') + '\n';
  }

  /**
   * Get most active hours from profile
   */
  private getMostActiveHours(profile: UserProfile): string[] {
    if (!profile.activityPatterns || profile.activityPatterns.length === 0) {
      return [];
    }

    // Aggregate by hour
    const hourCounts = new Map<number, number>();
    for (const pattern of profile.activityPatterns) {
      const current = hourCounts.get(pattern.hour) || 0;
      hourCounts.set(pattern.hour, current + pattern.interactionCount);
    }

    // Get top 3 hours
    const sorted = Array.from(hourCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);

    return sorted.map(([hour]) => {
      if (hour < 12) return `${hour}am`;
      if (hour === 12) return '12pm';
      return `${hour - 12}pm`;
    });
  }

  /**
   * Get top interests from profile
   */
  private getTopInterests(profile: UserProfile): string[] {
    if (!profile.topicInterests || profile.topicInterests.size === 0) {
      return [];
    }

    const interests = Array.from(profile.topicInterests.values())
      .sort((a, b) => b.interestLevel - a.interestLevel)
      .slice(0, 5);

    return interests.map(i => i.topic);
  }

  /**
   * Get response guidance based on emotion
   */
  private getEmotionGuidance(emotionType: string): string | undefined {
    const guidance: Record<string, string> = {
      frustrated: 'Stay calm, validate the difficulty, offer clear next steps',
      anxious: 'Reassure, break into manageable steps, emphasize what\'s in control',
      excited: 'Match the energy, be enthusiastic, celebrate together',
      sad: 'Be empathetic, don\'t immediately problem-solve, offer support',
      angry: 'Stay calm, don\'t be defensive, acknowledge the issue',
      tired: 'Be concise, don\'t overwhelm, maybe suggest a break',
      confused: 'Be patient, explain clearly, offer to break things down',
      happy: 'Be warm, share in the positivity',
    };

    return guidance[emotionType];
  }

  /**
   * Get status of the context builder
   */
  getStatus(): {
    initialized: boolean;
    config: ContextBuilderConfig;
    subsystems: {
      userProfile: boolean;
      knowledgeStore: boolean;
      personaManager: boolean;
      emotionDetector: boolean;
      tradingProvider: boolean;
      businessProvider: boolean;
      unifiedBrain: boolean;
    };
  } {
    return {
      initialized: this.initialized,
      config: this.config,
      subsystems: {
        userProfile: !!this.userProfileManager,
        knowledgeStore: !!this.knowledgeStore,
        personaManager: !!this.personaManager,
        emotionDetector: !!this.emotionDetector,
        tradingProvider: !!this.tradingContextProvider,
        businessProvider: !!this.businessContextProvider,
        unifiedBrain: !!this.unifiedBrain,
      },
    };
  }

  /**
   * Update configuration
   */
  setConfig(config: Partial<ContextBuilderConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('Config updated', { config: this.config });
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: PersonalityContextBuilder | null = null;

/**
 * Get the PersonalityContextBuilder singleton
 */
export function getPersonalityContextBuilder(): PersonalityContextBuilder {
  if (!instance) {
    instance = new PersonalityContextBuilder();
  }
  return instance;
}

/**
 * Shutdown the PersonalityContextBuilder
 */
export function shutdownPersonalityContextBuilder(): void {
  instance = null;
}

export { PersonalityContextBuilder as default };
