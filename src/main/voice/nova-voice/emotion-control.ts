/**
 * NovaVoice - Emotion & Style Control for TTS
 * Add emotional expression and speaking styles to synthesis
 */

import { createModuleLogger } from '../../utils/logger';

const logger = createModuleLogger('NovaVoice-Emotion');

// ============================================
// Emotion Types
// ============================================

/**
 * Primary emotions supported by the system
 */
export enum Emotion {
  NEUTRAL = 'neutral',
  HAPPY = 'happy',
  SAD = 'sad',
  ANGRY = 'angry',
  FEARFUL = 'fearful',
  DISGUSTED = 'disgusted',
  SURPRISED = 'surprised',
  EXCITED = 'excited',
  CALM = 'calm',
  SERIOUS = 'serious',
  FRIENDLY = 'friendly',
  PROFESSIONAL = 'professional',
  EMPATHETIC = 'empathetic',
  ENTHUSIASTIC = 'enthusiastic',
  SARCASTIC = 'sarcastic',
  WHISPER = 'whisper',
  SHOUTING = 'shouting',
}

/**
 * Speaking style presets
 */
export enum SpeakingStyle {
  CONVERSATIONAL = 'conversational',
  NARRATION = 'narration',
  NEWS_ANCHOR = 'news-anchor',
  CUSTOMER_SERVICE = 'customer-service',
  ASSISTANT = 'assistant',
  STORYTELLING = 'storytelling',
  TUTORIAL = 'tutorial',
  MEDITATION = 'meditation',
  SPORTS_COMMENTARY = 'sports-commentary',
  DOCUMENTARY = 'documentary',
  AUDIOBOOK = 'audiobook',
  PODCAST = 'podcast',
  PRESENTATION = 'presentation',
  GAMING = 'gaming',
}

// ============================================
// Prosody Parameters
// ============================================

/**
 * Prosody control parameters
 */
export interface ProsodyParams {
  /** Speech rate multiplier (0.5 - 2.0, default 1.0) */
  rate: number;
  /** Pitch shift in semitones (-12 to +12) */
  pitch: number;
  /** Pitch variation/range (0 - 2.0, default 1.0) */
  pitchRange: number;
  /** Volume multiplier (0 - 2.0, default 1.0) */
  volume: number;
  /** Energy/intensity (0 - 1.0) */
  energy: number;
  /** Breathiness (0 - 1.0) */
  breathiness: number;
  /** Roughness/hoarseness (0 - 1.0) */
  roughness: number;
}

const DEFAULT_PROSODY: ProsodyParams = {
  rate: 1.0,
  pitch: 0,
  pitchRange: 1.0,
  volume: 1.0,
  energy: 0.5,
  breathiness: 0.0,
  roughness: 0.0,
};

// ============================================
// Emotion to Prosody Mapping
// ============================================

/**
 * Emotion prosody profiles
 */
const EMOTION_PROSODY_MAP: Record<Emotion, Partial<ProsodyParams>> = {
  [Emotion.NEUTRAL]: {},
  [Emotion.HAPPY]: {
    rate: 1.1,
    pitch: 2,
    pitchRange: 1.3,
    energy: 0.7,
  },
  [Emotion.SAD]: {
    rate: 0.85,
    pitch: -2,
    pitchRange: 0.7,
    energy: 0.3,
    breathiness: 0.2,
  },
  [Emotion.ANGRY]: {
    rate: 1.15,
    pitch: 1,
    pitchRange: 1.4,
    energy: 0.9,
    roughness: 0.3,
  },
  [Emotion.FEARFUL]: {
    rate: 1.2,
    pitch: 3,
    pitchRange: 1.5,
    energy: 0.6,
    breathiness: 0.3,
  },
  [Emotion.DISGUSTED]: {
    rate: 0.9,
    pitch: -1,
    pitchRange: 0.8,
    energy: 0.5,
    roughness: 0.2,
  },
  [Emotion.SURPRISED]: {
    rate: 1.15,
    pitch: 4,
    pitchRange: 1.6,
    energy: 0.8,
  },
  [Emotion.EXCITED]: {
    rate: 1.25,
    pitch: 3,
    pitchRange: 1.5,
    energy: 0.9,
  },
  [Emotion.CALM]: {
    rate: 0.9,
    pitch: -1,
    pitchRange: 0.6,
    energy: 0.3,
    breathiness: 0.1,
  },
  [Emotion.SERIOUS]: {
    rate: 0.95,
    pitch: -2,
    pitchRange: 0.5,
    energy: 0.6,
  },
  [Emotion.FRIENDLY]: {
    rate: 1.05,
    pitch: 1,
    pitchRange: 1.2,
    energy: 0.6,
  },
  [Emotion.PROFESSIONAL]: {
    rate: 1.0,
    pitch: 0,
    pitchRange: 0.8,
    energy: 0.5,
  },
  [Emotion.EMPATHETIC]: {
    rate: 0.92,
    pitch: 0,
    pitchRange: 1.1,
    energy: 0.4,
    breathiness: 0.15,
  },
  [Emotion.ENTHUSIASTIC]: {
    rate: 1.2,
    pitch: 2,
    pitchRange: 1.4,
    energy: 0.85,
  },
  [Emotion.SARCASTIC]: {
    rate: 0.95,
    pitch: 1,
    pitchRange: 1.3,
    energy: 0.5,
  },
  [Emotion.WHISPER]: {
    rate: 0.85,
    pitch: 0,
    pitchRange: 0.4,
    volume: 0.4,
    energy: 0.2,
    breathiness: 0.8,
  },
  [Emotion.SHOUTING]: {
    rate: 1.1,
    pitch: 2,
    pitchRange: 1.2,
    volume: 1.5,
    energy: 1.0,
    roughness: 0.4,
  },
};

// ============================================
// Speaking Style to Prosody Mapping
// ============================================

const STYLE_PROSODY_MAP: Record<SpeakingStyle, Partial<ProsodyParams>> = {
  [SpeakingStyle.CONVERSATIONAL]: {
    rate: 1.0,
    pitchRange: 1.2,
    energy: 0.5,
  },
  [SpeakingStyle.NARRATION]: {
    rate: 0.95,
    pitchRange: 1.0,
    energy: 0.5,
  },
  [SpeakingStyle.NEWS_ANCHOR]: {
    rate: 1.05,
    pitchRange: 0.9,
    energy: 0.6,
  },
  [SpeakingStyle.CUSTOMER_SERVICE]: {
    rate: 0.95,
    pitch: 1,
    pitchRange: 1.1,
    energy: 0.5,
  },
  [SpeakingStyle.ASSISTANT]: {
    rate: 1.0,
    pitch: 1,
    pitchRange: 1.0,
    energy: 0.5,
  },
  [SpeakingStyle.STORYTELLING]: {
    rate: 0.9,
    pitchRange: 1.4,
    energy: 0.6,
  },
  [SpeakingStyle.TUTORIAL]: {
    rate: 0.9,
    pitchRange: 1.0,
    energy: 0.5,
  },
  [SpeakingStyle.MEDITATION]: {
    rate: 0.75,
    pitch: -2,
    pitchRange: 0.5,
    energy: 0.2,
    breathiness: 0.2,
  },
  [SpeakingStyle.SPORTS_COMMENTARY]: {
    rate: 1.3,
    pitchRange: 1.6,
    energy: 0.9,
  },
  [SpeakingStyle.DOCUMENTARY]: {
    rate: 0.92,
    pitchRange: 0.9,
    energy: 0.5,
  },
  [SpeakingStyle.AUDIOBOOK]: {
    rate: 0.88,
    pitchRange: 1.2,
    energy: 0.5,
  },
  [SpeakingStyle.PODCAST]: {
    rate: 1.0,
    pitchRange: 1.1,
    energy: 0.55,
  },
  [SpeakingStyle.PRESENTATION]: {
    rate: 0.95,
    pitchRange: 1.0,
    energy: 0.6,
  },
  [SpeakingStyle.GAMING]: {
    rate: 1.1,
    pitchRange: 1.3,
    energy: 0.7,
  },
};

// ============================================
// Emotion Controller
// ============================================

export interface EmotionControlOptions {
  emotion: Emotion;
  intensity: number;  // 0-1, how strong the emotion is
  style?: SpeakingStyle;
  customProsody?: Partial<ProsodyParams>;
}

export class EmotionController {
  private defaultProsody: ProsodyParams;
  
  constructor() {
    this.defaultProsody = { ...DEFAULT_PROSODY };
  }
  
  /**
   * Calculate prosody parameters for given emotion and style
   */
  calculateProsody(options: EmotionControlOptions): ProsodyParams {
    const { emotion, intensity, style, customProsody } = options;
    
    // Start with default
    let prosody = { ...this.defaultProsody };
    
    // Apply style if specified
    if (style) {
      const styleParams = STYLE_PROSODY_MAP[style];
      prosody = this.blendProsody(prosody, styleParams, 1.0);
    }
    
    // Apply emotion with intensity
    const emotionParams = EMOTION_PROSODY_MAP[emotion];
    prosody = this.blendProsody(prosody, emotionParams, intensity);
    
    // Apply custom overrides
    if (customProsody) {
      prosody = { ...prosody, ...customProsody };
    }
    
    // Clamp values
    prosody.rate = Math.max(0.5, Math.min(2.0, prosody.rate));
    prosody.pitch = Math.max(-12, Math.min(12, prosody.pitch));
    prosody.pitchRange = Math.max(0, Math.min(2.0, prosody.pitchRange));
    prosody.volume = Math.max(0, Math.min(2.0, prosody.volume));
    prosody.energy = Math.max(0, Math.min(1.0, prosody.energy));
    prosody.breathiness = Math.max(0, Math.min(1.0, prosody.breathiness));
    prosody.roughness = Math.max(0, Math.min(1.0, prosody.roughness));
    
    return prosody;
  }
  
  /**
   * Blend two prosody configurations
   */
  private blendProsody(
    base: ProsodyParams,
    overlay: Partial<ProsodyParams>,
    weight: number
  ): ProsodyParams {
    const result = { ...base };
    
    for (const key of Object.keys(overlay) as (keyof ProsodyParams)[]) {
      const baseVal = base[key];
      const overlayVal = overlay[key];
      
      if (overlayVal !== undefined) {
        if (key === 'pitch') {
          // Pitch is additive
          result[key] = baseVal + (overlayVal - 0) * weight;
        } else {
          // Others are multiplicative or interpolated
          result[key] = baseVal + (overlayVal - baseVal) * weight;
        }
      }
    }
    
    return result;
  }
  
  /**
   * Convert prosody to SSML
   */
  prosodyToSSML(text: string, prosody: ProsodyParams): string {
    const ratePercent = Math.round(prosody.rate * 100);
    const pitchSign = prosody.pitch >= 0 ? '+' : '';
    
    return `<prosody rate="${ratePercent}%" pitch="${pitchSign}${Math.round(prosody.pitch)}st" volume="${Math.round(prosody.volume * 100)}%">${text}</prosody>`;
  }
  
  /**
   * Detect emotion from text (simple keyword-based)
   */
  detectEmotion(text: string): { emotion: Emotion; confidence: number } {
    const lowerText = text.toLowerCase();
    
    const emotionKeywords: Record<Emotion, string[]> = {
      [Emotion.HAPPY]: ['happy', 'joy', 'excited', 'great', 'wonderful', 'amazing', 'love', 'fantastic', '😊', '😄', '🎉'],
      [Emotion.SAD]: ['sad', 'sorry', 'unfortunately', 'regret', 'miss', 'crying', 'heartbroken', '😢', '😭'],
      [Emotion.ANGRY]: ['angry', 'furious', 'mad', 'annoyed', 'frustrated', 'outraged', '😠', '😡'],
      [Emotion.FEARFUL]: ['scared', 'afraid', 'worried', 'anxious', 'terrified', 'nervous', '😰', '😨'],
      [Emotion.SURPRISED]: ['wow', 'amazing', 'incredible', 'unexpected', 'shocked', '😮', '😲'],
      [Emotion.EXCITED]: ['excited', 'can\'t wait', 'thrilled', 'pumped', 'stoked', '🤩'],
      [Emotion.CALM]: ['calm', 'peaceful', 'relaxed', 'serene', 'tranquil', '😌'],
      [Emotion.SERIOUS]: ['important', 'critical', 'serious', 'urgent', 'attention'],
      [Emotion.FRIENDLY]: ['hey', 'hi', 'hello', 'friend', 'buddy', '👋'],
      [Emotion.EMPATHETIC]: ['understand', 'feel', 'sorry to hear', 'must be', 'that\'s tough'],
      [Emotion.NEUTRAL]: [],
      [Emotion.DISGUSTED]: ['disgusting', 'gross', 'awful', 'terrible', '🤢'],
      [Emotion.PROFESSIONAL]: ['regarding', 'please note', 'as per', 'kindly'],
      [Emotion.ENTHUSIASTIC]: ['awesome', 'incredible', 'absolutely', 'definitely', '🚀'],
      [Emotion.SARCASTIC]: ['oh really', 'sure', 'right', 'obviously'],
      [Emotion.WHISPER]: ['secret', 'quietly', 'shh', 'between us'],
      [Emotion.SHOUTING]: ['!!!', 'HELP', 'STOP', 'NOW', 'URGENT'],
    };
    
    let bestEmotion = Emotion.NEUTRAL;
    let bestScore = 0;
    
    for (const [emotion, keywords] of Object.entries(emotionKeywords)) {
      let score = 0;
      for (const keyword of keywords) {
        if (lowerText.includes(keyword)) {
          score++;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        bestEmotion = emotion as Emotion;
      }
    }
    
    const confidence = bestScore > 0 ? Math.min(1, bestScore / 3) : 0;
    
    return { emotion: bestEmotion, confidence };
  }
  
  /**
   * Get emotion from emoji
   */
  getEmotionFromEmoji(emoji: string): Emotion | null {
    const emojiMap: Record<string, Emotion> = {
      '😊': Emotion.HAPPY,
      '😄': Emotion.HAPPY,
      '😃': Emotion.HAPPY,
      '🙂': Emotion.FRIENDLY,
      '😢': Emotion.SAD,
      '😭': Emotion.SAD,
      '😠': Emotion.ANGRY,
      '😡': Emotion.ANGRY,
      '😨': Emotion.FEARFUL,
      '😰': Emotion.FEARFUL,
      '😮': Emotion.SURPRISED,
      '😲': Emotion.SURPRISED,
      '🤩': Emotion.EXCITED,
      '😌': Emotion.CALM,
      '🤢': Emotion.DISGUSTED,
      '😏': Emotion.SARCASTIC,
    };
    
    return emojiMap[emoji] || null;
  }
}

// ============================================
// Text Preprocessor for Emotion
// ============================================

export interface EmotionTag {
  emotion: Emotion;
  intensity: number;
  startIndex: number;
  endIndex: number;
}

export class TextEmotionParser {
  private emotionController: EmotionController;
  
  constructor() {
    this.emotionController = new EmotionController();
  }
  
  /**
   * Parse text with emotion tags
   * Format: [emotion:intensity]text[/emotion]
   * Example: [happy:0.8]I'm so glad to see you![/happy]
   */
  parse(text: string): { cleanText: string; emotionSegments: EmotionTag[] } {
    const segments: EmotionTag[] = [];
    let cleanText = text;
    
    // Pattern: [emotion:intensity]...[/emotion]
    const pattern = /\[(\w+):?([\d.]+)?\](.*?)\[\/\1\]/g;
    let match;
    let offset = 0;
    
    while ((match = pattern.exec(text)) !== null) {
      const emotionName = match[1].toUpperCase();
      const intensity = match[2] ? parseFloat(match[2]) : 0.7;
      const content = match[3];
      
      // Check if valid emotion
      if (Object.values(Emotion).includes(emotionName.toLowerCase() as Emotion)) {
        const startIndex = match.index - offset;
        const endIndex = startIndex + content.length;
        
        segments.push({
          emotion: emotionName.toLowerCase() as Emotion,
          intensity,
          startIndex,
          endIndex,
        });
        
        // Remove tags from clean text
        const fullMatch = match[0];
        cleanText = cleanText.replace(fullMatch, content);
        offset += fullMatch.length - content.length;
      }
    }
    
    return { cleanText, emotionSegments: segments };
  }
  
  /**
   * Auto-tag text with detected emotions
   */
  autoTag(text: string): string {
    const { emotion, confidence } = this.emotionController.detectEmotion(text);
    
    if (confidence > 0.3 && emotion !== Emotion.NEUTRAL) {
      return `[${emotion}:${confidence.toFixed(1)}]${text}[/${emotion}]`;
    }
    
    return text;
  }
}

// ============================================
// Exports
// ============================================

export {
  DEFAULT_PROSODY,
  EMOTION_PROSODY_MAP,
  STYLE_PROSODY_MAP,
};
