/**
 * Atlas Desktop - Emotion to Voice Mapper
 * Maps detected user emotions to TTS voice parameters for adaptive prosody
 * 
 * Key principle: Single voice ID with dynamic settings
 * - Stability affects expressiveness (lower = more emotional)
 * - Style affects energy (higher = more intense)
 * - Speed affects pacing (slower for calm/sad, faster for excited)
 * 
 * @module voice/emotion-to-voice-mapper
 */

import { createModuleLogger } from '../utils/logger';
import { EmotionState, EmotionType, EmotionIntensity } from '../intelligence/emotion-detector';
import { PersonalityTraits, VoiceSettings as PersonaVoiceSettings } from '../personality/types';

const logger = createModuleLogger('EmotionToVoiceMapper');

// ============================================================================
// Types
// ============================================================================

/**
 * Dynamic voice parameters for ElevenLabs API
 */
export interface DynamicVoiceSettings {
  /** Voice stability (0-1): lower = more expressive/emotional */
  stability: number;
  /** Similarity boost (0-1): higher = more consistent to original */
  similarityBoost: number;
  /** Style (0-1): higher = more exaggerated delivery */
  style: number;
  /** Use speaker boost for clarity */
  useSpeakerBoost: boolean;
  /** Speed multiplier (0.5-2.0) */
  speed: number;
  /** Pitch adjustment in semitones (-12 to +12) */
  pitch: number;
}

/**
 * Content type classification for adaptive pacing
 */
export type ContentType = 
  | 'confirmation'    // "Got it", "Sure" - fast
  | 'question'        // Clarifying questions - moderate with rising intonation
  | 'explanation'     // Technical explanations - slower, clear
  | 'empathetic'      // Emotional support - warm, gentle
  | 'excited'         // Good news - energetic
  | 'error'           // Problem reporting - calm, reassuring
  | 'list'            // Enumerating items - paced with pauses
  | 'default';        // Standard response

/**
 * Complete voice context for TTS synthesis
 */
export interface VoiceContext {
  /** User's current emotional state */
  emotion?: EmotionState;
  /** Active persona traits */
  personaTraits?: PersonalityTraits;
  /** Persona voice settings */
  personaVoice?: PersonaVoiceSettings;
  /** Type of content being spoken */
  contentType?: ContentType;
  /** Time of day (0-23) */
  hourOfDay?: number;
}

// ============================================================================
// Baseline Settings
// ============================================================================

/**
 * Default (neutral) voice settings - Siri-like balance
 */
const BASELINE_SETTINGS: DynamicVoiceSettings = {
  stability: 0.5,
  similarityBoost: 0.75,
  style: 0.0,
  useSpeakerBoost: true,
  speed: 1.0,
  pitch: 0,
};

// ============================================================================
// Emotion Mappings
// ============================================================================

/**
 * Voice adjustments per emotion type
 * Values are deltas from baseline
 */
const EMOTION_VOICE_MAP: Record<EmotionType, Partial<DynamicVoiceSettings>> = {
  neutral: {
    // No changes from baseline
  },
  happy: {
    stability: -0.1,        // Slightly more expressive
    style: 0.2,             // More energetic
    speed: 1.05,            // Slightly faster
    pitch: 1,               // Slightly higher
  },
  sad: {
    stability: 0.1,         // More measured
    style: -0.1,            // Less intense
    speed: 0.9,             // Slower, gentler
    pitch: -1,              // Slightly lower
  },
  angry: {
    // When user is angry, Atlas stays calm and grounded
    stability: 0.2,         // Very stable, calm
    style: 0.0,             // Neutral intensity
    speed: 0.95,            // Slightly slower, measured
    pitch: -1,              // Lower, grounding
  },
  frustrated: {
    // Patient and understanding
    stability: 0.15,        // Stable, reassuring
    style: 0.0,             // Neutral
    speed: 0.92,            // Slower for clarity
    pitch: 0,               // Neutral
  },
  excited: {
    stability: -0.15,       // More expressive
    style: 0.3,             // More energetic
    speed: 1.1,             // Faster
    pitch: 2,               // Higher, enthusiastic
  },
  anxious: {
    // Calm, reassuring voice
    stability: 0.25,        // Very stable
    style: -0.1,            // Gentle
    speed: 0.88,            // Slower, soothing
    pitch: -1,              // Slightly lower, grounding
  },
  confused: {
    // Clear, patient delivery
    stability: 0.1,         // Stable
    style: 0.0,             // Neutral
    speed: 0.9,             // Slower for clarity
    pitch: 0,               // Neutral
  },
  grateful: {
    stability: 0.0,         // Baseline
    style: 0.15,            // Warm
    speed: 1.0,             // Normal
    pitch: 1,               // Slightly higher, pleasant
  },
  disappointed: {
    // Empathetic but not matching the negativity
    stability: 0.1,         // Stable
    style: 0.05,            // Subtle warmth
    speed: 0.95,            // Slightly slower
    pitch: 0,               // Neutral
  },
};

/**
 * Intensity multipliers for emotion adjustments
 */
const INTENSITY_MULTIPLIERS: Record<EmotionIntensity, number> = {
  subtle: 0.4,
  moderate: 0.7,
  strong: 1.0,
};

// ============================================================================
// Content Type Mappings
// ============================================================================

/**
 * Voice adjustments per content type
 */
const CONTENT_VOICE_MAP: Record<ContentType, Partial<DynamicVoiceSettings>> = {
  confirmation: {
    speed: 1.1,             // Quick acknowledgment
    style: 0.1,             // Slightly warm
  },
  question: {
    speed: 1.0,             // Normal pace
    pitch: 1,               // Slight rise for question intonation
    style: 0.05,            // Slight engagement
  },
  explanation: {
    stability: 0.15,        // Clear, consistent
    speed: 0.9,             // Slower for comprehension
    style: 0.0,             // Neutral
  },
  empathetic: {
    stability: 0.1,         // Warm, stable
    style: 0.15,            // Gentle warmth
    speed: 0.92,            // Slower, caring
    pitch: -1,              // Slightly lower, soothing
  },
  excited: {
    stability: -0.1,        // More expressive
    style: 0.25,            // Energetic
    speed: 1.08,            // Faster
    pitch: 1,               // Slightly higher
  },
  error: {
    stability: 0.15,        // Calm, reassuring
    speed: 0.95,            // Measured
    style: 0.0,             // Professional
  },
  list: {
    stability: 0.1,         // Clear
    speed: 0.95,            // Paced
    style: 0.0,             // Neutral
  },
  default: {
    // No changes
  },
};

// ============================================================================
// Time-of-Day Adjustments
// ============================================================================

/**
 * Get time-based voice adjustments
 * Night = gentler, morning = energizing
 */
function getTimeAdjustments(hour: number): Partial<DynamicVoiceSettings> {
  // Late night (10pm - 6am): Gentler, softer
  if (hour >= 22 || hour < 6) {
    return {
      stability: 0.1,
      speed: 0.92,
      style: -0.1,
      pitch: -1,
    };
  }
  
  // Early morning (6am - 9am): Slightly energizing
  if (hour >= 6 && hour < 9) {
    return {
      speed: 0.98,
      style: 0.05,
    };
  }
  
  // Evening (6pm - 10pm): Relaxed
  if (hour >= 18 && hour < 22) {
    return {
      stability: 0.05,
      speed: 0.97,
    };
  }
  
  // Daytime: No adjustments
  return {};
}

// ============================================================================
// Main Mapper Class
// ============================================================================

class EmotionToVoiceMapper {
  private lastSettings: DynamicVoiceSettings = { ...BASELINE_SETTINGS };
  private transitionSmoothing = 0.3; // Blend factor for smooth transitions

  /**
   * Map emotion state to voice settings
   */
  mapEmotionToVoice(
    emotion: EmotionState,
    currentSettings?: Partial<DynamicVoiceSettings>
  ): DynamicVoiceSettings {
    const base = currentSettings 
      ? { ...BASELINE_SETTINGS, ...currentSettings }
      : { ...BASELINE_SETTINGS };
    
    // Get emotion adjustments
    const emotionAdjust = EMOTION_VOICE_MAP[emotion.primary.type] || {};
    const intensity = INTENSITY_MULTIPLIERS[emotion.primary.intensity];
    
    // Apply emotion adjustments with intensity scaling
    const settings = this.applyAdjustments(base, emotionAdjust, intensity);
    
    // Smooth transition from last settings
    const smoothed = this.smoothTransition(this.lastSettings, settings);
    this.lastSettings = smoothed;
    
    logger.debug('Mapped emotion to voice', {
      emotion: emotion.primary.type,
      intensity: emotion.primary.intensity,
      settings: smoothed,
    });
    
    return smoothed;
  }

  /**
   * Map content type to voice settings
   */
  mapContentTypeToVoice(
    contentType: ContentType,
    currentSettings?: Partial<DynamicVoiceSettings>
  ): DynamicVoiceSettings {
    const base = currentSettings 
      ? { ...BASELINE_SETTINGS, ...currentSettings }
      : { ...BASELINE_SETTINGS };
    
    const contentAdjust = CONTENT_VOICE_MAP[contentType] || {};
    return this.applyAdjustments(base, contentAdjust, 1.0);
  }

  /**
   * Get complete voice settings from full context
   * Combines emotion, persona, content type, and time-of-day
   */
  getVoiceSettings(context: VoiceContext): DynamicVoiceSettings {
    let settings = { ...BASELINE_SETTINGS };
    
    // 1. Apply persona voice settings (base layer)
    if (context.personaVoice) {
      settings = this.applyPersonaSettings(settings, context.personaVoice);
    }
    
    // 2. Apply persona trait adjustments
    if (context.personaTraits) {
      settings = this.applyPersonalityTraits(settings, context.personaTraits);
    }
    
    // 3. Apply time-of-day adjustments
    const hour = context.hourOfDay ?? new Date().getHours();
    const timeAdjust = getTimeAdjustments(hour);
    settings = this.applyAdjustments(settings, timeAdjust, 0.5); // Subtle time effect
    
    // 4. Apply content type adjustments
    if (context.contentType) {
      const contentAdjust = CONTENT_VOICE_MAP[context.contentType] || {};
      settings = this.applyAdjustments(settings, contentAdjust, 0.8);
    }
    
    // 5. Apply emotion adjustments (top priority)
    if (context.emotion) {
      const emotionAdjust = EMOTION_VOICE_MAP[context.emotion.primary.type] || {};
      const intensity = INTENSITY_MULTIPLIERS[context.emotion.primary.intensity];
      settings = this.applyAdjustments(settings, emotionAdjust, intensity);
    }
    
    // 6. Smooth transition
    const smoothed = this.smoothTransition(this.lastSettings, settings);
    this.lastSettings = smoothed;
    
    // 7. Clamp to valid ranges
    return this.clampSettings(smoothed);
  }

  /**
   * Apply persona voice settings to base
   */
  private applyPersonaSettings(
    base: DynamicVoiceSettings,
    persona: PersonaVoiceSettings
  ): DynamicVoiceSettings {
    return {
      ...base,
      stability: persona.stability ?? base.stability,
      style: persona.style ?? base.style,
      speed: persona.speed ?? base.speed,
      pitch: persona.pitch !== undefined 
        ? persona.pitch * 12 // Convert -1..1 to semitones
        : base.pitch,
    };
  }

  /**
   * Apply personality traits to voice settings
   */
  private applyPersonalityTraits(
    base: DynamicVoiceSettings,
    traits: PersonalityTraits
  ): DynamicVoiceSettings {
    return {
      ...base,
      // High enthusiasm = more expressive, faster
      stability: base.stability - (traits.enthusiasm - 0.5) * 0.2,
      style: base.style + (traits.enthusiasm - 0.5) * 0.3,
      speed: base.speed + (traits.enthusiasm - 0.5) * 0.1,
      // High formality = more stable, measured
      // (already factored into stability via enthusiasm inverse)
    };
  }

  /**
   * Apply adjustment deltas with intensity scaling
   */
  private applyAdjustments(
    base: DynamicVoiceSettings,
    adjustments: Partial<DynamicVoiceSettings>,
    intensity: number
  ): DynamicVoiceSettings {
    return {
      stability: base.stability + (adjustments.stability ?? 0) * intensity,
      similarityBoost: base.similarityBoost + (adjustments.similarityBoost ?? 0) * intensity,
      style: base.style + (adjustments.style ?? 0) * intensity,
      useSpeakerBoost: adjustments.useSpeakerBoost ?? base.useSpeakerBoost,
      speed: base.speed * (1 + ((adjustments.speed ?? 1) - 1) * intensity),
      pitch: base.pitch + (adjustments.pitch ?? 0) * intensity,
    };
  }

  /**
   * Smooth transition between settings to avoid jarring changes
   */
  private smoothTransition(
    previous: DynamicVoiceSettings,
    target: DynamicVoiceSettings
  ): DynamicVoiceSettings {
    const blend = (prev: number, next: number) => 
      prev + (next - prev) * this.transitionSmoothing;
    
    return {
      stability: blend(previous.stability, target.stability),
      similarityBoost: blend(previous.similarityBoost, target.similarityBoost),
      style: blend(previous.style, target.style),
      useSpeakerBoost: target.useSpeakerBoost,
      speed: blend(previous.speed, target.speed),
      pitch: blend(previous.pitch, target.pitch),
    };
  }

  /**
   * Clamp settings to valid API ranges
   */
  private clampSettings(settings: DynamicVoiceSettings): DynamicVoiceSettings {
    return {
      stability: Math.max(0, Math.min(1, settings.stability)),
      similarityBoost: Math.max(0, Math.min(1, settings.similarityBoost)),
      style: Math.max(0, Math.min(1, settings.style)),
      useSpeakerBoost: settings.useSpeakerBoost,
      speed: Math.max(0.5, Math.min(2.0, settings.speed)),
      pitch: Math.max(-12, Math.min(12, Math.round(settings.pitch))),
    };
  }

  /**
   * Detect content type from text
   */
  detectContentType(text: string): ContentType {
    const lower = text.toLowerCase().trim();
    
    // Confirmations (short acknowledgments)
    if (lower.length < 50 && /^(got it|sure|okay|on it|done|alright|will do|no problem)/i.test(lower)) {
      return 'confirmation';
    }
    
    // Questions
    if (/\?$/.test(text) || /^(would you|do you|can you|should i|what|which|where|when|how|why)/i.test(lower)) {
      return 'question';
    }
    
    // Empathetic (emotional support)
    if (/sorry to hear|understand how|that must be|here for you|take your time/i.test(lower)) {
      return 'empathetic';
    }
    
    // Excited (good news)
    if (/great news|excellent|fantastic|awesome|congrats|amazing/i.test(lower) || /!{2,}/.test(text)) {
      return 'excited';
    }
    
    // Error/Problem
    if (/unfortunately|couldn't|failed|error|issue|problem|sorry,? (i|but)/i.test(lower)) {
      return 'error';
    }
    
    // List (enumeration)
    if (/first,|second,|third,|finally,|here's what|let me list|there are \d+/i.test(lower)) {
      return 'list';
    }
    
    // Explanation (technical or detailed)
    if (lower.length > 150 || /because|therefore|this means|in other words|essentially|basically/i.test(lower)) {
      return 'explanation';
    }
    
    return 'default';
  }

  /**
   * Reset transition state
   */
  reset(): void {
    this.lastSettings = { ...BASELINE_SETTINGS };
  }

  /**
   * Get baseline settings
   */
  getBaseline(): DynamicVoiceSettings {
    return { ...BASELINE_SETTINGS };
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

let instance: EmotionToVoiceMapper | null = null;

export function getEmotionToVoiceMapper(): EmotionToVoiceMapper {
  if (!instance) {
    instance = new EmotionToVoiceMapper();
  }
  return instance;
}

export { EmotionToVoiceMapper, BASELINE_SETTINGS };
