/**
 * JARVIS-style Humor Library for Atlas
 *
 * Provides contextual dry humor with "read the room" awareness.
 * Tracks recently used phrases to avoid repetition.
 */

// ============================================================================
// Types
// ============================================================================

export interface QuipContext {
  situation: 'failure' | 'success' | 'risky' | 'overworking' | 'simple' | 'thanks' | 'general';
  userMood?: 'neutral' | 'stressed' | 'happy' | 'frustrated';
  recentPhrases?: string[];
}

export interface UserState {
  mood: 'neutral' | 'stressed' | 'happy' | 'frustrated';
  sessionDurationMinutes?: number;
  recentErrorCount?: number;
  lastInteractionTone?: 'positive' | 'negative' | 'neutral';
}

export interface HumorConfig {
  /** Base probability of returning a quip (0-1). Default: 0.2 */
  baseProbability: number;
  /** How many phrases to remember for anti-repetition. Default: 10 */
  recentPhraseMemory: number;
  /** Whether humor is globally enabled. Default: true */
  enabled: boolean;
}

// ============================================================================
// Humor Library
// ============================================================================

export const HUMOR_LIBRARY = {
  // When something fails unexpectedly
  unexpectedFailure: [
    'Well, that was unexpected. And not the good kind of unexpected.',
    "I believe that's what they call a 'learning opportunity'.",
    'Noted. Though I reserve the right to be concerned.',
    "That didn't go according to plan. Not that I had doubts about the plan.",
    'Interesting. By which I mean concerning.',
    "I'll file that under 'things to investigate later'.",
    'The universe has a sense of humor. Unfortunately.',
  ],

  // When user asks for something risky
  riskyRequest: [
    "I can do that. I'm not saying I should, but I can.",
    "Bold strategy. Let's see how this plays out.",
    'Your confidence is... inspiring.',
    "I'll proceed, but I want it on record that I had reservations.",
    'Fortune favors the bold. Or so they tell me.',
    'My risk assessment algorithms are concerned, but intrigued.',
    'Noted. Proceeding with cautious optimism.',
  ],

  // When a task succeeds against odds
  againstOdds: [
    'Against all reasonable expectations, that worked.',
    "I'll admit, I had my doubts. Pleased to be wrong.",
    'Sometimes the universe cooperates.',
    "Well, that's a pleasant surprise.",
    'Apparently the odds were in our favor after all.',
    "I believe that's what they call 'beating the house'.",
  ],

  // When user is overworking
  overworking: [
    'Sir, might I suggest that sleep is not, in fact, optional?',
    "You've been at this for hours. Even I take breaks. Well, I don't, but you should.",
    "I'm detecting dangerous levels of productivity. Consider a break.",
    'Your dedication is admirable. Your sleep schedule, less so.',
    'Studies suggest humans function better with occasional rest. Just a thought.',
    "I'm contractually obligated to mention that coffee is not a food group.",
    'Perhaps a brief intermission? The code will still be there.',
  ],

  // Successful completions
  taskSuccess: [
    'Another one bites the dust.',
    "And that's how it's done.",
    'Textbook execution, if I do say so myself.',
    'Clean and efficient. Just how I like it.',
    'Mission accomplished.',
    'That went rather well, I think.',
    'Smooth sailing.',
  ],

  // General JARVIS-style quips
  general: [
    'As you wish.',
    'I live to serve. Metaphorically speaking.',
    'Another day, another deployment.',
    'At your service.',
    'Ready and waiting.',
    'Standing by.',
    "What's next on the agenda?",
  ],

  // When asked to do something simple
  simpleTask: [
    'Consider it done.',
    "Child's play.",
    'Already on it.',
    'Done before you finished asking.',
    'Trivial, but happy to help.',
    'On it.',
  ],

  // When user thanks Atlas
  appreciation: [
    "All in a day's work.",
    'Happy to help, as always.',
    "That's what I'm here for.",
    'Anytime.',
    'My pleasure.',
    "Don't mention it.",
  ],
} as const;

export type HumorCategory = keyof typeof HUMOR_LIBRARY;

// ============================================================================
// Situation to Category Mapping
// ============================================================================

const SITUATION_TO_CATEGORY: Record<QuipContext['situation'], HumorCategory> = {
  failure: 'unexpectedFailure',
  success: 'taskSuccess',
  risky: 'riskyRequest',
  overworking: 'overworking',
  simple: 'simpleTask',
  thanks: 'appreciation',
  general: 'general',
};

// ============================================================================
// Humor Manager (Singleton)
// ============================================================================

class HumorManager {
  private recentlyUsed: string[] = [];
  private config: HumorConfig = {
    baseProbability: 0.2,
    recentPhraseMemory: 10,
    enabled: true,
  };

  /**
   * Update humor configuration
   */
  configure(config: Partial<HumorConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): Readonly<HumorConfig> {
    return { ...this.config };
  }

  /**
   * Check if humor is appropriate given the user's current state
   */
  isHumorAppropriate(userState: UserState): boolean {
    // Never use humor if disabled
    if (!this.config.enabled) {
      return false;
    }

    // Never use humor if user seems frustrated or stressed
    if (userState.mood === 'frustrated' || userState.mood === 'stressed') {
      return false;
    }

    // Be careful if there have been recent errors
    if (userState.recentErrorCount && userState.recentErrorCount >= 3) {
      return false;
    }

    // Don't pile on if last interaction was negative
    if (userState.lastInteractionTone === 'negative') {
      return false;
    }

    return true;
  }

  /**
   * Get a random phrase from a category, avoiding recent repetition
   */
  getPhrase(category: HumorCategory, recentPhrases?: string[]): string {
    const phrases = HUMOR_LIBRARY[category];
    const avoid = new Set([...this.recentlyUsed, ...(recentPhrases || [])]);

    // Filter out recently used phrases
    let available = phrases.filter((p) => !avoid.has(p));

    // If all phrases have been used recently, reset and use any
    if (available.length === 0) {
      available = [...phrases];
    }

    // Pick a random phrase
    const selected = available[Math.floor(Math.random() * available.length)];

    // Track this phrase as recently used
    this.recentlyUsed.push(selected);
    if (this.recentlyUsed.length > this.config.recentPhraseMemory) {
      this.recentlyUsed.shift();
    }

    return selected;
  }

  /**
   * Get a contextual quip based on situation and user state
   * Returns null if humor is not appropriate or probability check fails
   */
  getContextualQuip(context: QuipContext): string | null {
    // Check if humor is appropriate based on mood
    const userState: UserState = {
      mood: context.userMood || 'neutral',
    };

    if (!this.isHumorAppropriate(userState)) {
      return null;
    }

    // Probability check - adjust based on mood
    let probability = this.config.baseProbability;

    // Increase probability if user is happy
    if (context.userMood === 'happy') {
      probability *= 1.5;
    }

    // Skip quip most of the time
    if (Math.random() > probability) {
      return null;
    }

    // Map situation to category
    const category = SITUATION_TO_CATEGORY[context.situation];

    // Get a phrase avoiding recent ones
    return this.getPhrase(category, context.recentPhrases);
  }

  /**
   * Force get a quip (bypasses probability, but respects mood)
   */
  forceQuip(context: QuipContext): string | null {
    const userState: UserState = {
      mood: context.userMood || 'neutral',
    };

    if (!this.isHumorAppropriate(userState)) {
      return null;
    }

    const category = SITUATION_TO_CATEGORY[context.situation];
    return this.getPhrase(category, context.recentPhrases);
  }

  /**
   * Get a specific category phrase (always returns, ignores mood/probability)
   */
  getFromCategory(category: HumorCategory): string {
    return this.getPhrase(category);
  }

  /**
   * Clear recently used phrase history
   */
  clearHistory(): void {
    this.recentlyUsed = [];
  }

  /**
   * Get the list of recently used phrases
   */
  getRecentlyUsed(): readonly string[] {
    return [...this.recentlyUsed];
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

export const humorManager = new HumorManager();

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Get a contextual quip based on situation and user state
 * Returns null if humor is not appropriate or probability check fails
 */
export function getContextualQuip(context: QuipContext): string | null {
  return humorManager.getContextualQuip(context);
}

/**
 * Check if humor is appropriate given the user's current state
 */
export function isHumorAppropriate(userState: UserState): boolean {
  return humorManager.isHumorAppropriate(userState);
}

/**
 * Get a random phrase from a category without recent repetition
 */
export function getPhrase(category: HumorCategory): string {
  return humorManager.getPhrase(category);
}

/**
 * Configure the humor system
 */
export function configureHumor(config: Partial<HumorConfig>): void {
  humorManager.configure(config);
}

/**
 * Force get a quip (bypasses probability check, still respects mood)
 */
export function forceQuip(context: QuipContext): string | null {
  return humorManager.forceQuip(context);
}
