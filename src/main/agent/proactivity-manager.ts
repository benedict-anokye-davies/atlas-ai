/**
 * Atlas Proactivity Manager
 *
 * Manages Atlas's proactive behavior - learning when to suggest things
 * and when to stay quiet based on user feedback and context.
 *
 * Features:
 * - Adaptive learning from suggestion outcomes
 * - Time-based preference learning
 * - Context awareness (active conversation, focus mode, etc.)
 * - Weekend mode with reduced proactivity
 * - Frequency management to prevent suggestion fatigue
 *
 * @module agent/proactivity-manager
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import {
  loadStateSync,
  saveStateSync,
  STATE_LOCATIONS,
  StateDocument,
  generateProactivityContent,
} from '../memory/obsidian-state';

const logger = createModuleLogger('ProactivityManager');

// ============================================================================
// Types
// ============================================================================

/**
 * Types of suggestions Atlas can make
 */
export type SuggestionType =
  | 'code-improvement'
  | 'break-reminder'
  | 'learning-resource'
  | 'pattern-automation'
  | 'meeting-prep'
  | 'task-suggestion'
  | 'refactoring'
  | 'dependency-update';

/**
 * A proactive suggestion from Atlas
 */
export interface Suggestion {
  id: string;
  type: SuggestionType;
  content: string;
  timestamp: Date;
  context?: string;
}

/**
 * A time slot for timing recommendations
 */
export interface TimeSlot {
  dayOfWeek?: number[]; // 0-6 (Sunday-Saturday)
  hourRange: [number, number]; // [start, end] in 24h format
}

/**
 * Recommendation for optimal suggestion timing
 */
export interface TimingRecommendation {
  bestTimes: TimeSlot[];
  avoidTimes: TimeSlot[];
  frequency: 'rare' | 'occasional' | 'regular';
  confidence: number;
}

/**
 * Configuration for proactivity behavior
 */
export interface ProactivityConfig {
  baseLevel: number; // 0-1, default 0.5
  weekendMultiplier: number; // default 0.3
  afterRejectionCooldown: number; // minutes
  maxSuggestionsPerHour: number;
  learningRate: number; // How fast to adapt (0-1)
}

/**
 * Historical record of a suggestion
 */
export interface SuggestionHistory {
  id: string;
  type: SuggestionType;
  accepted: boolean;
  timestamp: Date;
  dayOfWeek: number;
  hourOfDay: number;
  context: string;
}

/**
 * Learned preferences for a suggestion type
 */
interface TypePreferences {
  acceptanceRate: number;
  totalSuggestions: number;
  totalAccepted: number;
  bestHours: number[];
  worstHours: number[];
  bestDays: number[];
  worstDays: number[];
  lastSuggestion: Date | null;
  lastRejection: Date | null;
  consecutiveRejections: number;
}

/**
 * Context states that affect proactivity
 */
interface ContextState {
  isVoiceActive: boolean;
  isDebugging: boolean;
  isInMeeting: boolean;
  isFocusMode: boolean;
  lastInteraction: Date | null;
}

/**
 * Persisted state for proactivity manager
 */
interface ProactivityState {
  version: number;
  proactivityLevel: number;
  history: SuggestionHistory[];
  typePreferences: Record<SuggestionType, TypePreferences>;
  suggestionsThisHour: number;
  hourStarted: number;
  lastUpdated: string;
}

/**
 * Proactivity report for analytics
 */
export interface ProactivityReport {
  currentLevel: number;
  isWeekendMode: boolean;
  overallAcceptanceRate: number;
  suggestionsByType: Record<
    SuggestionType,
    {
      total: number;
      accepted: number;
      rate: number;
    }
  >;
  bestTimes: TimeSlot[];
  recentActivity: {
    suggestionsLast24h: number;
    acceptedLast24h: number;
  };
  recommendations: string[];
}

// ============================================================================
// Constants
// ============================================================================

const STATE_VERSION = 1;
const HISTORY_RETENTION_DAYS = 30;
const DEFAULT_DECAY_FACTOR = 0.95; // Recent feedback weighs more

const DEFAULT_CONFIG: ProactivityConfig = {
  baseLevel: 0.5,
  weekendMultiplier: 0.3,
  afterRejectionCooldown: 30, // minutes
  maxSuggestionsPerHour: 5,
  learningRate: 0.1,
};

const ALL_SUGGESTION_TYPES: SuggestionType[] = [
  'code-improvement',
  'break-reminder',
  'learning-resource',
  'pattern-automation',
  'meeting-prep',
  'task-suggestion',
  'refactoring',
  'dependency-update',
];

/**
 * Work-related suggestion types (suppressed on weekends)
 */
const WORK_SUGGESTION_TYPES: SuggestionType[] = [
  'code-improvement',
  'meeting-prep',
  'task-suggestion',
  'refactoring',
  'dependency-update',
];

/**
 * Wellness suggestion types (allowed on weekends)
 */
const WELLNESS_SUGGESTION_TYPES: SuggestionType[] = ['break-reminder', 'learning-resource'];

// ============================================================================
// ProactivityManager Class
// ============================================================================

/**
 * Events emitted by ProactivityManager
 */
export interface ProactivityManagerEvents {
  'level-changed': (level: number) => void;
  'suggestion-tracked': (suggestion: Suggestion, accepted: boolean) => void;
  'cooldown-started': (type: SuggestionType, durationMs: number) => void;
  'weekend-mode-changed': (enabled: boolean) => void;
}

/**
 * Manages Atlas's proactive behavior with adaptive learning.
 *
 * @example
 * ```typescript
 * const manager = getProactivityManager();
 *
 * // Check if should suggest
 * if (manager.shouldSuggest('code-improvement')) {
 *   // Make suggestion...
 *   manager.trackSuggestionOutcome(suggestion, userAccepted);
 * }
 *
 * // Get optimal timing
 * const timing = manager.getOptimalTiming('break-reminder');
 * ```
 */
export class ProactivityManager extends EventEmitter {
  private config: ProactivityConfig;
  private state: ProactivityState;
  private context: ContextState;
  private saveTimeout: NodeJS.Timeout | null = null;

  constructor(config?: Partial<ProactivityConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.context = this.createDefaultContext();
    this.state = this.loadState();
    logger.info('ProactivityManager initialized', {
      level: this.state.proactivityLevel,
      historySize: this.state.history.length,
    });
  }

  // ==========================================================================
  // Core Interface Methods
  // ==========================================================================

  /**
   * Check if Atlas should make a proactive suggestion of the given type.
   *
   * Considers:
   * - Current proactivity level
   * - Type-specific acceptance rate
   * - Time of day preferences
   * - Context (voice active, debugging, etc.)
   * - Cooldown after rejections
   * - Suggestion frequency limits
   * - Weekend mode
   *
   * @param type - The type of suggestion to check
   * @returns Whether to proceed with the suggestion
   */
  public shouldSuggest(type: SuggestionType): boolean {
    // Check basic conditions
    if (!this.isGoodTimeForSuggestion()) {
      logger.debug('Not a good time for suggestions');
      return false;
    }

    // Check weekend mode restrictions
    if (this.isWeekendMode() && WORK_SUGGESTION_TYPES.includes(type)) {
      logger.debug('Weekend mode - skipping work suggestion', { type });
      return false;
    }

    // Check hourly limit
    if (!this.checkHourlyLimit()) {
      logger.debug('Hourly suggestion limit reached');
      return false;
    }

    // Check type-specific cooldown
    const prefs = this.state.typePreferences[type];
    if (prefs.lastRejection) {
      const cooldownMs = this.config.afterRejectionCooldown * 60 * 1000;
      const cooldownMultiplier = Math.min(prefs.consecutiveRejections, 5);
      const adjustedCooldown = cooldownMs * cooldownMultiplier;
      const timeSinceRejection = Date.now() - new Date(prefs.lastRejection).getTime();

      if (timeSinceRejection < adjustedCooldown) {
        logger.debug('In cooldown period', {
          type,
          remainingMs: adjustedCooldown - timeSinceRejection,
        });
        return false;
      }
    }

    // Calculate suggestion probability
    const probability = this.calculateSuggestionProbability(type);
    const shouldSuggest = Math.random() < probability;

    logger.debug('Suggestion decision', {
      type,
      probability: probability.toFixed(3),
      shouldSuggest,
    });

    return shouldSuggest;
  }

  /**
   * Track the outcome of a suggestion.
   *
   * Updates:
   * - Type-specific acceptance rate
   * - Time-based preferences
   * - Cooldown state
   * - Overall learning
   *
   * @param suggestion - The suggestion that was made
   * @param accepted - Whether the user accepted/acted on the suggestion
   */
  public trackSuggestionOutcome(suggestion: Suggestion, accepted: boolean): void {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const hourOfDay = now.getHours();

    // Create history entry
    const historyEntry: SuggestionHistory = {
      id: suggestion.id,
      type: suggestion.type,
      accepted,
      timestamp: now,
      dayOfWeek,
      hourOfDay,
      context: suggestion.context || '',
    };

    // Add to history
    this.state.history.push(historyEntry);

    // Update type preferences
    this.updateTypePreferences(suggestion.type, accepted, dayOfWeek, hourOfDay);

    // Update hourly count
    this.incrementHourlyCount();

    // Emit event
    this.emit('suggestion-tracked', suggestion, accepted);

    // Handle rejection
    if (!accepted) {
      const prefs = this.state.typePreferences[suggestion.type];
      const cooldownMs =
        this.config.afterRejectionCooldown * 60 * 1000 * Math.min(prefs.consecutiveRejections, 5);
      this.emit('cooldown-started', suggestion.type, cooldownMs);
    }

    // Prune old history
    this.pruneHistory();

    // Schedule state save
    this.scheduleSave();

    logger.info('Suggestion outcome tracked', {
      type: suggestion.type,
      accepted,
      newAcceptanceRate: this.state.typePreferences[suggestion.type].acceptanceRate.toFixed(3),
    });
  }

  /**
   * Get optimal timing recommendation for a suggestion type.
   *
   * Based on historical acceptance patterns:
   * - Best times when acceptance is high
   * - Avoid times when suggestions are rejected
   * - Frequency based on overall acceptance rate
   *
   * @param type - The suggestion type
   * @returns Timing recommendation
   */
  public getOptimalTiming(type: SuggestionType): TimingRecommendation {
    const prefs = this.state.typePreferences[type];
    const hasEnoughData = prefs.totalSuggestions >= 10;

    // Default times if not enough data
    if (!hasEnoughData) {
      return {
        bestTimes: [
          { hourRange: [9, 12] as [number, number], dayOfWeek: [1, 2, 3, 4, 5] },
          { hourRange: [14, 17] as [number, number], dayOfWeek: [1, 2, 3, 4, 5] },
        ],
        avoidTimes: [
          { hourRange: [0, 7] as [number, number] },
          { hourRange: [22, 24] as [number, number] },
        ],
        frequency: 'occasional',
        confidence: 0.3,
      };
    }

    // Build timing from learned preferences
    const bestTimes: TimeSlot[] = [];
    const avoidTimes: TimeSlot[] = [];

    // Best hours
    if (prefs.bestHours.length > 0) {
      const hourRanges = this.groupConsecutiveHours(prefs.bestHours);
      for (const range of hourRanges) {
        bestTimes.push({
          hourRange: range,
          dayOfWeek: prefs.bestDays.length > 0 ? prefs.bestDays : undefined,
        });
      }
    }

    // Worst hours
    if (prefs.worstHours.length > 0) {
      const hourRanges = this.groupConsecutiveHours(prefs.worstHours);
      for (const range of hourRanges) {
        avoidTimes.push({
          hourRange: range,
          dayOfWeek: prefs.worstDays.length > 0 ? prefs.worstDays : undefined,
        });
      }
    }

    // Determine frequency based on acceptance rate
    let frequency: 'rare' | 'occasional' | 'regular';
    if (prefs.acceptanceRate < 0.3) {
      frequency = 'rare';
    } else if (prefs.acceptanceRate < 0.6) {
      frequency = 'occasional';
    } else {
      frequency = 'regular';
    }

    // Confidence based on data amount
    const confidence = Math.min(1, prefs.totalSuggestions / 50);

    return {
      bestTimes,
      avoidTimes,
      frequency,
      confidence,
    };
  }

  /**
   * Get the current proactivity level (0-1).
   */
  public getProactivityLevel(): number {
    return this.state.proactivityLevel;
  }

  /**
   * Set the proactivity level.
   *
   * Levels:
   * - 0.0: Silent - Only respond when asked
   * - 0.3: Minimal - Only critical suggestions
   * - 0.5: Balanced - Default, moderate suggestions
   * - 0.7: Active - Regular helpful suggestions
   * - 1.0: Maximum - Highly proactive
   *
   * @param level - The new level (0-1)
   */
  public setProactivityLevel(level: number): void {
    const clampedLevel = Math.max(0, Math.min(1, level));
    const oldLevel = this.state.proactivityLevel;
    this.state.proactivityLevel = clampedLevel;

    if (oldLevel !== clampedLevel) {
      this.emit('level-changed', clampedLevel);
      this.scheduleSave();
      logger.info('Proactivity level changed', { from: oldLevel, to: clampedLevel });
    }
  }

  /**
   * Check if it's generally a good time for suggestions.
   *
   * Considers:
   * - Active voice conversation
   * - Debugging session
   * - Meeting context
   * - Focus mode
   */
  public isGoodTimeForSuggestion(): boolean {
    // Never suggest during active voice
    if (this.context.isVoiceActive) {
      return false;
    }

    // Never suggest during debugging (high frustration potential)
    if (this.context.isDebugging) {
      return false;
    }

    // Never suggest during meetings
    if (this.context.isInMeeting) {
      return false;
    }

    // Never suggest in focus mode
    if (this.context.isFocusMode) {
      return false;
    }

    // If proactivity is at minimum, only allow during explicit requests
    if (this.state.proactivityLevel === 0) {
      return false;
    }

    return true;
  }

  /**
   * Check if weekend mode is active.
   *
   * Weekend mode:
   * - Lower proactivity (weekendMultiplier)
   * - Skip work-related suggestions
   * - Keep wellness reminders
   */
  public isWeekendMode(): boolean {
    const day = new Date().getDay();
    return day === 0 || day === 6; // Sunday or Saturday
  }

  // ==========================================================================
  // Context Management
  // ==========================================================================

  /**
   * Update context state for voice activity.
   */
  public setVoiceActive(active: boolean): void {
    this.context.isVoiceActive = active;
    if (active) {
      this.context.lastInteraction = new Date();
    }
  }

  /**
   * Update context state for debugging session.
   */
  public setDebugging(debugging: boolean): void {
    this.context.isDebugging = debugging;
  }

  /**
   * Update context state for meeting.
   */
  public setInMeeting(inMeeting: boolean): void {
    this.context.isInMeeting = inMeeting;
  }

  /**
   * Update context state for focus mode.
   */
  public setFocusMode(focusMode: boolean): void {
    this.context.isFocusMode = focusMode;
  }

  /**
   * Record user interaction (for timing suggestions appropriately).
   */
  public recordInteraction(): void {
    this.context.lastInteraction = new Date();
  }

  // ==========================================================================
  // Voice Command Support
  // ==========================================================================

  /**
   * Process voice commands related to proactivity.
   *
   * Supported commands:
   * - "be less proactive" / "stop suggesting things"
   * - "be more helpful" / "be more proactive"
   * - "weekend mode"
   * - "reset proactivity"
   *
   * @param command - The voice command text
   * @returns Whether the command was handled and the response
   */
  public processVoiceCommand(command: string): { handled: boolean; response: string } {
    const lowerCommand = command.toLowerCase();

    // Decrease proactivity
    if (
      lowerCommand.includes('less proactive') ||
      lowerCommand.includes('stop suggesting') ||
      lowerCommand.includes('be quiet') ||
      lowerCommand.includes('fewer suggestions')
    ) {
      const newLevel = Math.max(0, this.state.proactivityLevel - 0.2);
      this.setProactivityLevel(newLevel);
      return {
        handled: true,
        response:
          newLevel === 0
            ? "I'll stay quiet and only respond when you ask."
            : `Understood. I'll be less proactive. Level is now ${Math.round(newLevel * 100)}%.`,
      };
    }

    // Increase proactivity
    if (
      lowerCommand.includes('more helpful') ||
      lowerCommand.includes('more proactive') ||
      lowerCommand.includes('more suggestions')
    ) {
      const newLevel = Math.min(1, this.state.proactivityLevel + 0.2);
      this.setProactivityLevel(newLevel);
      return {
        handled: true,
        response: `I'll be more proactive with suggestions. Level is now ${Math.round(newLevel * 100)}%.`,
      };
    }

    // Weekend mode explicit toggle
    if (lowerCommand.includes('weekend mode')) {
      // Weekend mode is automatic based on day, but user can request minimum proactivity
      this.setProactivityLevel(0.2);
      return {
        handled: true,
        response:
          "Weekend mode activated. I'll minimize interruptions and only remind you about breaks.",
      };
    }

    // Reset learning
    if (lowerCommand.includes('reset proactivity') || lowerCommand.includes('reset suggestions')) {
      this.resetLearning();
      return {
        handled: true,
        response: "I've reset my suggestion learning. Starting fresh with balanced proactivity.",
      };
    }

    // Silent mode
    if (lowerCommand.includes('silent mode') || lowerCommand.includes('no suggestions')) {
      this.setProactivityLevel(0);
      return {
        handled: true,
        response: "Silent mode activated. I'll only respond when you ask.",
      };
    }

    return { handled: false, response: '' };
  }

  // ==========================================================================
  // Analytics & Reporting
  // ==========================================================================

  /**
   * Get a comprehensive proactivity report.
   */
  public getProactivityReport(): ProactivityReport {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Calculate suggestions by type
    const suggestionsByType: ProactivityReport['suggestionsByType'] =
      {} as ProactivityReport['suggestionsByType'];
    for (const type of ALL_SUGGESTION_TYPES) {
      const prefs = this.state.typePreferences[type];
      suggestionsByType[type] = {
        total: prefs.totalSuggestions,
        accepted: prefs.totalAccepted,
        rate: prefs.acceptanceRate,
      };
    }

    // Recent activity
    const recentHistory = this.state.history.filter((h) => new Date(h.timestamp) > oneDayAgo);
    const recentAccepted = recentHistory.filter((h) => h.accepted).length;

    // Overall acceptance rate
    const totalSuggestions = this.state.history.length;
    const totalAccepted = this.state.history.filter((h) => h.accepted).length;
    const overallAcceptanceRate = totalSuggestions > 0 ? totalAccepted / totalSuggestions : 0.5;

    // Best times (aggregate across all types)
    const bestTimes = this.calculateOverallBestTimes();

    // Generate recommendations
    const recommendations = this.generateRecommendations();

    return {
      currentLevel: this.state.proactivityLevel,
      isWeekendMode: this.isWeekendMode(),
      overallAcceptanceRate,
      suggestionsByType,
      bestTimes,
      recentActivity: {
        suggestionsLast24h: recentHistory.length,
        acceptedLast24h: recentAccepted,
      },
      recommendations,
    };
  }

  // ==========================================================================
  // Learning & Persistence
  // ==========================================================================

  /**
   * Reset all learned preferences.
   */
  public resetLearning(): void {
    this.state = this.createDefaultState();
    this.scheduleSave();
    logger.info('Proactivity learning reset');
  }

  /**
   * Force save the current state.
   */
  public save(): void {
    this.saveState();
  }

  /**
   * Shutdown and cleanup.
   */
  public shutdown(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
    this.saveState();
    this.removeAllListeners();
    logger.info('ProactivityManager shutdown complete');
  }

  // ==========================================================================
  // Private Methods - State Management
  // ==========================================================================

  private createDefaultContext(): ContextState {
    return {
      isVoiceActive: false,
      isDebugging: false,
      isInMeeting: false,
      isFocusMode: false,
      lastInteraction: null,
    };
  }

  private createDefaultState(): ProactivityState {
    const typePreferences: Record<SuggestionType, TypePreferences> = {} as Record<
      SuggestionType,
      TypePreferences
    >;

    for (const type of ALL_SUGGESTION_TYPES) {
      typePreferences[type] = {
        acceptanceRate: 0.5, // Start neutral
        totalSuggestions: 0,
        totalAccepted: 0,
        bestHours: [],
        worstHours: [],
        bestDays: [],
        worstDays: [],
        lastSuggestion: null,
        lastRejection: null,
        consecutiveRejections: 0,
      };
    }

    return {
      version: STATE_VERSION,
      proactivityLevel: this.config.baseLevel,
      history: [],
      typePreferences,
      suggestionsThisHour: 0,
      hourStarted: new Date().getHours(),
      lastUpdated: new Date().toISOString(),
    };
  }

  private loadState(): ProactivityState {
    try {
      const doc = loadStateSync<ProactivityState>(STATE_LOCATIONS.proactivity);

      if (doc && doc.frontmatter.version) {
        const parsed = doc.frontmatter;

        // Version check
        if (parsed.version !== STATE_VERSION) {
          logger.warn('State version mismatch, creating fresh state', {
            found: parsed.version,
            expected: STATE_VERSION,
          });
          return this.createDefaultState();
        }

        // Restore dates
        parsed.history = parsed.history.map((h) => ({
          ...h,
          timestamp: new Date(h.timestamp),
        }));

        for (const type of ALL_SUGGESTION_TYPES) {
          if (parsed.typePreferences[type]) {
            const prefs = parsed.typePreferences[type];
            if (prefs.lastSuggestion) {
              prefs.lastSuggestion = new Date(prefs.lastSuggestion);
            }
            if (prefs.lastRejection) {
              prefs.lastRejection = new Date(prefs.lastRejection);
            }
          } else {
            // Add missing type
            parsed.typePreferences[type] = {
              acceptanceRate: 0.5,
              totalSuggestions: 0,
              totalAccepted: 0,
              bestHours: [],
              worstHours: [],
              bestDays: [],
              worstDays: [],
              lastSuggestion: null,
              lastRejection: null,
              consecutiveRejections: 0,
            };
          }
        }

        logger.info('Loaded proactivity state from Obsidian', {
          level: parsed.proactivityLevel,
          historySize: parsed.history.length,
        });

        return parsed;
      }
    } catch (error) {
      logger.error('Failed to load proactivity state', {
        error: (error as Error).message,
      });
    }

    return this.createDefaultState();
  }

  private saveState(): void {
    try {
      this.state.lastUpdated = new Date().toISOString();

      // Generate human-readable content
      const suggestionsByType: Record<string, { total: number; accepted: number; rate: number }> =
        {};
      for (const type of ALL_SUGGESTION_TYPES) {
        const prefs = this.state.typePreferences[type];
        suggestionsByType[type] = {
          total: prefs.totalSuggestions,
          accepted: prefs.totalAccepted,
          rate: prefs.acceptanceRate,
        };
      }

      const content = generateProactivityContent({
        level: this.state.proactivityLevel,
        suggestionsByType,
        recommendations: this.generateRecommendations(),
      });

      const doc: StateDocument<ProactivityState> = {
        frontmatter: this.state,
        content,
      };

      saveStateSync(STATE_LOCATIONS.proactivity, doc);
      logger.debug('Proactivity state saved to Obsidian');
    } catch (error) {
      logger.error('Failed to save proactivity state', {
        error: (error as Error).message,
      });
    }
  }

  private scheduleSave(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    // Debounce saves to prevent excessive disk writes
    this.saveTimeout = setTimeout(() => {
      this.saveState();
      this.saveTimeout = null;
    }, 5000);
  }

  // ==========================================================================
  // Private Methods - Learning
  // ==========================================================================

  private updateTypePreferences(
    type: SuggestionType,
    accepted: boolean,
    dayOfWeek: number,
    hourOfDay: number
  ): void {
    const prefs = this.state.typePreferences[type];

    // Update counts
    prefs.totalSuggestions++;
    if (accepted) {
      prefs.totalAccepted++;
      prefs.consecutiveRejections = 0;
    } else {
      prefs.consecutiveRejections++;
      prefs.lastRejection = new Date();
    }
    prefs.lastSuggestion = new Date();

    // Update acceptance rate with learning rate and decay
    const oldRate = prefs.acceptanceRate;
    const observation = accepted ? 1 : 0;
    const decayedOldRate = oldRate * DEFAULT_DECAY_FACTOR;
    prefs.acceptanceRate =
      decayedOldRate + (observation - decayedOldRate) * this.config.learningRate;

    // Update time-based preferences
    this.updateTimePreferences(prefs, accepted, dayOfWeek, hourOfDay);
  }

  private updateTimePreferences(
    prefs: TypePreferences,
    accepted: boolean,
    dayOfWeek: number,
    hourOfDay: number
  ): void {
    if (accepted) {
      // Add to best times if not already there
      if (!prefs.bestHours.includes(hourOfDay)) {
        prefs.bestHours.push(hourOfDay);
        // Keep sorted and limit to top 6
        prefs.bestHours.sort((a, b) => a - b);
        if (prefs.bestHours.length > 6) {
          prefs.bestHours = prefs.bestHours.slice(0, 6);
        }
      }
      if (!prefs.bestDays.includes(dayOfWeek)) {
        prefs.bestDays.push(dayOfWeek);
      }
      // Remove from worst if present
      prefs.worstHours = prefs.worstHours.filter((h) => h !== hourOfDay);
      prefs.worstDays = prefs.worstDays.filter((d) => d !== dayOfWeek);
    } else {
      // Add to worst times if not already there
      if (!prefs.worstHours.includes(hourOfDay)) {
        prefs.worstHours.push(hourOfDay);
        prefs.worstHours.sort((a, b) => a - b);
        if (prefs.worstHours.length > 6) {
          prefs.worstHours = prefs.worstHours.slice(0, 6);
        }
      }
      if (!prefs.worstDays.includes(dayOfWeek)) {
        prefs.worstDays.push(dayOfWeek);
      }
      // Remove from best if present
      prefs.bestHours = prefs.bestHours.filter((h) => h !== hourOfDay);
      prefs.bestDays = prefs.bestDays.filter((d) => d !== dayOfWeek);
    }
  }

  private pruneHistory(): void {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - HISTORY_RETENTION_DAYS);

    const originalLength = this.state.history.length;
    this.state.history = this.state.history.filter((h) => new Date(h.timestamp) > cutoff);

    if (this.state.history.length < originalLength) {
      logger.debug('Pruned old history entries', {
        removed: originalLength - this.state.history.length,
      });
    }
  }

  // ==========================================================================
  // Private Methods - Probability Calculation
  // ==========================================================================

  private calculateSuggestionProbability(type: SuggestionType): number {
    const prefs = this.state.typePreferences[type];
    const now = new Date();
    const currentHour = now.getHours();
    const currentDay = now.getDay();

    // Base probability from proactivity level
    let probability = this.state.proactivityLevel;

    // Apply weekend multiplier if applicable
    if (this.isWeekendMode()) {
      probability *= this.config.weekendMultiplier;
    }

    // Adjust based on type acceptance rate
    probability *= prefs.acceptanceRate;

    // Boost if current time is a known good time
    if (prefs.bestHours.includes(currentHour)) {
      probability *= 1.3;
    }
    if (prefs.bestDays.includes(currentDay)) {
      probability *= 1.2;
    }

    // Reduce if current time is a known bad time
    if (prefs.worstHours.includes(currentHour)) {
      probability *= 0.5;
    }
    if (prefs.worstDays.includes(currentDay)) {
      probability *= 0.6;
    }

    // Reduce based on consecutive rejections
    if (prefs.consecutiveRejections > 0) {
      probability *= Math.pow(0.7, prefs.consecutiveRejections);
    }

    // Time since last suggestion of this type (minimum spacing)
    if (prefs.lastSuggestion) {
      const timeSince = Date.now() - new Date(prefs.lastSuggestion).getTime();
      const minSpacing = 30 * 60 * 1000; // 30 minutes minimum between same type
      if (timeSince < minSpacing) {
        probability *= timeSince / minSpacing;
      }
    }

    // Clamp to valid range
    return Math.max(0, Math.min(1, probability));
  }

  private checkHourlyLimit(): boolean {
    const currentHour = new Date().getHours();

    // Reset counter if hour changed
    if (currentHour !== this.state.hourStarted) {
      this.state.suggestionsThisHour = 0;
      this.state.hourStarted = currentHour;
    }

    return this.state.suggestionsThisHour < this.config.maxSuggestionsPerHour;
  }

  private incrementHourlyCount(): void {
    const currentHour = new Date().getHours();

    if (currentHour !== this.state.hourStarted) {
      this.state.suggestionsThisHour = 1;
      this.state.hourStarted = currentHour;
    } else {
      this.state.suggestionsThisHour++;
    }
  }

  // ==========================================================================
  // Private Methods - Utilities
  // ==========================================================================

  private groupConsecutiveHours(hours: number[]): [number, number][] {
    if (hours.length === 0) return [];

    const sorted = [...hours].sort((a, b) => a - b);
    const ranges: [number, number][] = [];
    let start = sorted[0];
    let end = sorted[0];

    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] === end + 1) {
        end = sorted[i];
      } else {
        ranges.push([start, end + 1]);
        start = sorted[i];
        end = sorted[i];
      }
    }
    ranges.push([start, end + 1]);

    return ranges;
  }

  private calculateOverallBestTimes(): TimeSlot[] {
    // Aggregate best hours across all types
    const hourCounts = new Map<number, number>();

    for (const type of ALL_SUGGESTION_TYPES) {
      const prefs = this.state.typePreferences[type];
      for (const hour of prefs.bestHours) {
        hourCounts.set(hour, (hourCounts.get(hour) || 0) + 1);
      }
    }

    // Find hours that appear in multiple types' best hours
    const commonBestHours = Array.from(hourCounts.entries())
      .filter(([, count]) => count >= 2)
      .map(([hour]) => hour)
      .sort((a, b) => a - b);

    if (commonBestHours.length === 0) {
      // Default times
      return [
        { hourRange: [9, 12] as [number, number], dayOfWeek: [1, 2, 3, 4, 5] },
        { hourRange: [14, 17] as [number, number], dayOfWeek: [1, 2, 3, 4, 5] },
      ];
    }

    const ranges = this.groupConsecutiveHours(commonBestHours);
    return ranges.map((range) => ({
      hourRange: range,
      dayOfWeek: [1, 2, 3, 4, 5], // Weekdays by default
    }));
  }

  private generateRecommendations(): string[] {
    const recommendations: string[] = [];
    const report = this.state;

    // Check overall acceptance rate
    const totalSuggestions = report.history.length;
    const totalAccepted = report.history.filter((h) => h.accepted).length;
    const overallRate = totalSuggestions > 0 ? totalAccepted / totalSuggestions : 0.5;

    if (overallRate < 0.3 && totalSuggestions > 10) {
      recommendations.push(
        'Suggestion acceptance is low. Consider reducing proactivity level or focusing on more targeted suggestions.'
      );
    }

    if (overallRate > 0.8 && totalSuggestions > 10) {
      recommendations.push(
        'High suggestion acceptance! Consider increasing proactivity level for more helpful interactions.'
      );
    }

    // Check for types with very low acceptance
    for (const type of ALL_SUGGESTION_TYPES) {
      const prefs = report.typePreferences[type];
      if (prefs.totalSuggestions > 5 && prefs.acceptanceRate < 0.2) {
        recommendations.push(
          `${type} suggestions have low acceptance (${Math.round(prefs.acceptanceRate * 100)}%). Consider reducing or disabling this type.`
        );
      }
    }

    // Weekend behavior
    if (this.isWeekendMode()) {
      recommendations.push('Weekend mode is active. Work-related suggestions are minimized.');
    }

    // Proactivity level feedback
    if (report.proactivityLevel === 0) {
      recommendations.push('Proactivity is at silent mode. Atlas will only respond when asked.');
    } else if (report.proactivityLevel < 0.3) {
      recommendations.push(
        'Proactivity is at minimal level. Only critical suggestions will be made.'
      );
    }

    return recommendations;
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let proactivityManagerInstance: ProactivityManager | null = null;

/**
 * Get or create the ProactivityManager singleton instance.
 *
 * @param config - Optional configuration (only used on first call)
 * @returns ProactivityManager instance
 */
export function getProactivityManager(config?: Partial<ProactivityConfig>): ProactivityManager {
  if (!proactivityManagerInstance) {
    proactivityManagerInstance = new ProactivityManager(config);
    logger.info('ProactivityManager singleton created');
  }
  return proactivityManagerInstance;
}

/**
 * Shutdown and cleanup ProactivityManager singleton.
 */
export function shutdownProactivityManager(): void {
  if (proactivityManagerInstance) {
    proactivityManagerInstance.shutdown();
    proactivityManagerInstance = null;
    logger.info('ProactivityManager shutdown');
  }
}

/**
 * Reset ProactivityManager singleton (for testing).
 */
export function resetProactivityManager(): void {
  if (proactivityManagerInstance) {
    proactivityManagerInstance.removeAllListeners();
  }
  proactivityManagerInstance = null;
}

// ============================================================================
// Exports
// ============================================================================

export { WELLNESS_SUGGESTION_TYPES, WORK_SUGGESTION_TYPES, ALL_SUGGESTION_TYPES };
