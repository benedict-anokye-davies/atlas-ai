/**
 * Atlas Desktop - Backchanneling System
 * Provides natural conversational acknowledgments during processing
 * 
 * Features:
 * - Pre-cached common phrases for instant playback
 * - Varied acknowledgments to avoid repetition
 * - Context-aware backchannel selection
 * - Thinking fillers for processing delays
 * 
 * @module voice/backchanneling
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import { TTSManager, getTTSManager } from '../tts/manager';

const logger = createModuleLogger('Backchanneling');

// ============================================================================
// Types
// ============================================================================

/**
 * Backchannel categories for context-appropriate responses
 */
export type BackchannelCategory = 
  | 'acknowledgment'     // "Got it", "Okay"
  | 'thinking'           // "Let me see...", "Hmm..."
  | 'working'            // "Working on it", "One moment"
  | 'understanding'      // "I see", "Makes sense"
  | 'confirmation'       // "Sure thing", "Absolutely"
  | 'empathy'            // "I understand", "I hear you"
  | 'excitement'         // "Oh nice!", "Great!"
  | 'clarification';     // "So you want...", "Just to confirm..."

/**
 * Backchannel phrase with metadata
 */
export interface BackchannelPhrase {
  text: string;
  category: BackchannelCategory;
  /** Energy level 0-1 (calm to energetic) */
  energy: number;
  /** Formality 0-1 (casual to formal) */
  formality: number;
  /** Use count for rotation */
  useCount: number;
  /** Last used timestamp */
  lastUsed: number;
}

/**
 * Backchannel selection context
 */
export interface BackchannelContext {
  /** User's apparent emotion */
  userEmotion?: 'neutral' | 'happy' | 'frustrated' | 'anxious' | 'excited';
  /** Expected processing time */
  processingTimeMs?: number;
  /** Whether this is a complex task */
  isComplexTask?: boolean;
  /** Current persona formality level */
  formality?: number;
  /** Time of day (hour 0-23) */
  hourOfDay?: number;
}

/**
 * Pre-cached audio for instant playback
 */
export interface CachedBackchannel {
  phrase: BackchannelPhrase;
  audioBuffer?: Buffer;
  format?: string;
  cachedAt: number;
}

// ============================================================================
// Phrase Library
// ============================================================================

/**
 * All backchannel phrases organized by category
 */
const BACKCHANNEL_LIBRARY: BackchannelPhrase[] = [
  // Acknowledgments - quick recognition
  { text: 'Got it', category: 'acknowledgment', energy: 0.5, formality: 0.3, useCount: 0, lastUsed: 0 },
  { text: 'Okay', category: 'acknowledgment', energy: 0.4, formality: 0.4, useCount: 0, lastUsed: 0 },
  { text: 'Alright', category: 'acknowledgment', energy: 0.4, formality: 0.3, useCount: 0, lastUsed: 0 },
  { text: 'Sure', category: 'acknowledgment', energy: 0.4, formality: 0.3, useCount: 0, lastUsed: 0 },
  { text: 'Understood', category: 'acknowledgment', energy: 0.4, formality: 0.7, useCount: 0, lastUsed: 0 },
  { text: 'Right', category: 'acknowledgment', energy: 0.4, formality: 0.4, useCount: 0, lastUsed: 0 },
  
  // Thinking - buying time naturally
  { text: 'Let me see', category: 'thinking', energy: 0.3, formality: 0.4, useCount: 0, lastUsed: 0 },
  { text: 'Hmm', category: 'thinking', energy: 0.3, formality: 0.2, useCount: 0, lastUsed: 0 },
  { text: 'Let me think', category: 'thinking', energy: 0.3, formality: 0.4, useCount: 0, lastUsed: 0 },
  { text: 'So', category: 'thinking', energy: 0.3, formality: 0.3, useCount: 0, lastUsed: 0 },
  { text: 'Well', category: 'thinking', energy: 0.3, formality: 0.3, useCount: 0, lastUsed: 0 },
  { text: 'Let me check', category: 'thinking', energy: 0.4, formality: 0.5, useCount: 0, lastUsed: 0 },
  
  // Working - task acknowledgment
  { text: 'Working on it', category: 'working', energy: 0.5, formality: 0.4, useCount: 0, lastUsed: 0 },
  { text: 'One moment', category: 'working', energy: 0.4, formality: 0.6, useCount: 0, lastUsed: 0 },
  { text: 'On it', category: 'working', energy: 0.6, formality: 0.2, useCount: 0, lastUsed: 0 },
  { text: 'Give me a sec', category: 'working', energy: 0.4, formality: 0.2, useCount: 0, lastUsed: 0 },
  { text: 'Just a moment', category: 'working', energy: 0.4, formality: 0.6, useCount: 0, lastUsed: 0 },
  { text: "I'll handle that", category: 'working', energy: 0.5, formality: 0.4, useCount: 0, lastUsed: 0 },
  
  // Understanding - showing comprehension
  { text: 'I see', category: 'understanding', energy: 0.4, formality: 0.5, useCount: 0, lastUsed: 0 },
  { text: 'Makes sense', category: 'understanding', energy: 0.4, formality: 0.3, useCount: 0, lastUsed: 0 },
  { text: 'I get it', category: 'understanding', energy: 0.4, formality: 0.2, useCount: 0, lastUsed: 0 },
  { text: 'Right, right', category: 'understanding', energy: 0.5, formality: 0.2, useCount: 0, lastUsed: 0 },
  { text: 'Ah', category: 'understanding', energy: 0.4, formality: 0.2, useCount: 0, lastUsed: 0 },
  
  // Confirmation - positive agreement
  { text: 'Sure thing', category: 'confirmation', energy: 0.6, formality: 0.3, useCount: 0, lastUsed: 0 },
  { text: 'Absolutely', category: 'confirmation', energy: 0.6, formality: 0.5, useCount: 0, lastUsed: 0 },
  { text: 'Of course', category: 'confirmation', energy: 0.5, formality: 0.5, useCount: 0, lastUsed: 0 },
  { text: 'Definitely', category: 'confirmation', energy: 0.6, formality: 0.4, useCount: 0, lastUsed: 0 },
  { text: 'Will do', category: 'confirmation', energy: 0.5, formality: 0.4, useCount: 0, lastUsed: 0 },
  { text: 'No problem', category: 'confirmation', energy: 0.5, formality: 0.3, useCount: 0, lastUsed: 0 },
  
  // Empathy - emotional support
  { text: 'I understand', category: 'empathy', energy: 0.3, formality: 0.5, useCount: 0, lastUsed: 0 },
  { text: 'I hear you', category: 'empathy', energy: 0.3, formality: 0.3, useCount: 0, lastUsed: 0 },
  { text: 'That makes sense', category: 'empathy', energy: 0.4, formality: 0.4, useCount: 0, lastUsed: 0 },
  { text: 'I get that', category: 'empathy', energy: 0.4, formality: 0.2, useCount: 0, lastUsed: 0 },
  
  // Excitement - positive energy
  { text: 'Oh nice', category: 'excitement', energy: 0.7, formality: 0.2, useCount: 0, lastUsed: 0 },
  { text: 'Great', category: 'excitement', energy: 0.7, formality: 0.4, useCount: 0, lastUsed: 0 },
  { text: 'Awesome', category: 'excitement', energy: 0.8, formality: 0.2, useCount: 0, lastUsed: 0 },
  { text: 'Perfect', category: 'excitement', energy: 0.6, formality: 0.4, useCount: 0, lastUsed: 0 },
  { text: 'Love it', category: 'excitement', energy: 0.8, formality: 0.2, useCount: 0, lastUsed: 0 },
  
  // Clarification starters
  { text: 'So', category: 'clarification', energy: 0.4, formality: 0.3, useCount: 0, lastUsed: 0 },
  { text: 'Just to make sure', category: 'clarification', energy: 0.4, formality: 0.5, useCount: 0, lastUsed: 0 },
  { text: 'Let me confirm', category: 'clarification', energy: 0.4, formality: 0.6, useCount: 0, lastUsed: 0 },
];

// ============================================================================
// Backchannel Manager
// ============================================================================

export class BackchannelManager extends EventEmitter {
  private phrases: BackchannelPhrase[] = [];
  private cachedAudio: Map<string, CachedBackchannel> = new Map();
  private tts: TTSManager | null = null;
  private isCaching = false;
  private recentlyUsed: string[] = []; // Track last N phrases to avoid repetition
  private readonly maxRecent = 5;

  constructor() {
    super();
    // Clone library to allow mutation of use counts
    this.phrases = BACKCHANNEL_LIBRARY.map(p => ({ ...p }));
  }

  /**
   * Initialize with TTS manager and pre-cache common phrases
   */
  async initialize(tts?: TTSManager): Promise<void> {
    this.tts = tts || getTTSManager();
    
    // Pre-cache most common phrases
    const toCache = this.phrases
      .filter(p => ['acknowledgment', 'working', 'thinking'].includes(p.category))
      .slice(0, 15);
    
    logger.info('Pre-caching backchannel phrases', { count: toCache.length });
    await this.preCachePhrases(toCache);
  }

  /**
   * Pre-cache phrases for instant playback
   */
  private async preCachePhrases(phrases: BackchannelPhrase[]): Promise<void> {
    if (this.isCaching || !this.tts) return;
    
    this.isCaching = true;
    
    for (const phrase of phrases) {
      try {
        // Only cache if not already cached
        if (!this.cachedAudio.has(phrase.text)) {
          const result = await this.tts.synthesize(phrase.text);
          this.cachedAudio.set(phrase.text, {
            phrase,
            audioBuffer: result.audio,
            format: result.format,
            cachedAt: Date.now(),
          });
        }
      } catch (error) {
        logger.debug('Failed to cache phrase', { phrase: phrase.text, error: (error as Error).message });
      }
    }
    
    this.isCaching = false;
    logger.debug('Pre-caching complete', { cached: this.cachedAudio.size });
  }

  /**
   * Get appropriate backchannel for context
   */
  selectBackchannel(
    category: BackchannelCategory,
    context?: BackchannelContext
  ): BackchannelPhrase | null {
    // Filter by category
    let candidates = this.phrases.filter(p => p.category === category);
    
    if (candidates.length === 0) return null;
    
    // Filter out recently used
    candidates = candidates.filter(p => !this.recentlyUsed.includes(p.text));
    
    // If all filtered out, reset and use full list
    if (candidates.length === 0) {
      this.recentlyUsed = [];
      candidates = this.phrases.filter(p => p.category === category);
    }
    
    // Apply context filters
    if (context) {
      // Filter by formality
      if (context.formality !== undefined) {
        const formalityTarget = context.formality;
        candidates = candidates.filter(p => 
          Math.abs(p.formality - formalityTarget) < 0.4
        );
      }
      
      // Filter by energy based on emotion
      if (context.userEmotion === 'excited') {
        candidates = candidates.filter(p => p.energy >= 0.5);
      } else if (context.userEmotion === 'anxious' || context.userEmotion === 'frustrated') {
        candidates = candidates.filter(p => p.energy <= 0.5);
      }
      
      // Late night: prefer calmer phrases
      if (context.hourOfDay !== undefined && (context.hourOfDay >= 22 || context.hourOfDay < 6)) {
        candidates = candidates.filter(p => p.energy <= 0.5);
      }
    }
    
    // If all filtered out, relax constraints
    if (candidates.length === 0) {
      candidates = this.phrases.filter(p => p.category === category);
    }
    
    // Select least recently used
    candidates.sort((a, b) => a.lastUsed - b.lastUsed);
    const selected = candidates[0];
    
    // Update tracking
    selected.useCount++;
    selected.lastUsed = Date.now();
    this.recentlyUsed.push(selected.text);
    if (this.recentlyUsed.length > this.maxRecent) {
      this.recentlyUsed.shift();
    }
    
    return selected;
  }

  /**
   * Speak a backchannel phrase immediately
   */
  async speak(
    category: BackchannelCategory,
    context?: BackchannelContext
  ): Promise<void> {
    const phrase = this.selectBackchannel(category, context);
    if (!phrase || !this.tts) return;
    
    logger.debug('Speaking backchannel', { category, phrase: phrase.text });
    
    // Check if we have cached audio
    const cached = this.cachedAudio.get(phrase.text);
    if (cached?.audioBuffer) {
      // Use cached audio for instant playback
      this.emit('backchannel-start', phrase);
      // Note: Would need to emit audio directly to audio output
      // For now, fall back to TTS.speak which handles playback
      await this.tts.speak(phrase.text, 10); // High priority
      this.emit('backchannel-end', phrase);
    } else {
      // Generate on-the-fly
      this.emit('backchannel-start', phrase);
      await this.tts.speak(phrase.text, 10);
      this.emit('backchannel-end', phrase);
    }
  }

  /**
   * Get a thinking filler for processing delays
   * @param delayMs - Expected delay in milliseconds
   */
  async speakThinkingFiller(delayMs: number, context?: BackchannelContext): Promise<void> {
    // Short delay: single filler
    if (delayMs < 1000) {
      await this.speak('thinking', context);
      return;
    }
    
    // Medium delay: acknowledgment + working
    if (delayMs < 3000) {
      await this.speak('acknowledgment', context);
      return;
    }
    
    // Long delay: full working phrase
    await this.speak('working', context);
  }

  /**
   * Get appropriate category based on user emotion
   */
  getCategoryForEmotion(emotion: string): BackchannelCategory {
    switch (emotion) {
      case 'frustrated':
      case 'anxious':
        return 'empathy';
      case 'excited':
      case 'happy':
        return 'excitement';
      default:
        return 'acknowledgment';
    }
  }

  /**
   * Get phrase text without speaking (for injection into responses)
   */
  getPhraseText(category: BackchannelCategory, context?: BackchannelContext): string {
    const phrase = this.selectBackchannel(category, context);
    return phrase?.text || '';
  }

  /**
   * Check if a phrase is cached
   */
  isCached(text: string): boolean {
    return this.cachedAudio.has(text);
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { total: number; cached: number; phrases: string[] } {
    return {
      total: this.phrases.length,
      cached: this.cachedAudio.size,
      phrases: Array.from(this.cachedAudio.keys()),
    };
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cachedAudio.clear();
    this.recentlyUsed = [];
    logger.info('Backchannel cache cleared');
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

let instance: BackchannelManager | null = null;

export function getBackchannelManager(): BackchannelManager {
  if (!instance) {
    instance = new BackchannelManager();
  }
  return instance;
}

export async function initializeBackchanneling(tts?: TTSManager): Promise<BackchannelManager> {
  const manager = getBackchannelManager();
  await manager.initialize(tts);
  return manager;
}
