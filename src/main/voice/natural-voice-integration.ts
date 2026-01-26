/**
 * Atlas Desktop - Natural Voice Integration
 * Wires together emotion detection, speech naturalizer, backchanneling, 
 * and dynamic voice settings for human-like TTS output
 * 
 * This is the main integration layer that makes Atlas speak naturally.
 * 
 * @module voice/natural-voice-integration
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import { getEmotionToVoiceMapper, DynamicVoiceSettings, ContentType } from './emotion-to-voice-mapper';
import { getSpeechNaturalizer, NaturalizerConfig } from './speech-naturalizer';
import { getBackchannelManager, BackchannelCategory, BackchannelContext } from './backchanneling';
import { EmotionState } from '../intelligence/emotion-detector';
import { Persona } from '../personality/types';
import { TTSManager } from '../tts/manager';

const logger = createModuleLogger('NaturalVoice');

// ============================================================================
// Types
// ============================================================================

export interface NaturalVoiceConfig {
  /** Enable dynamic emotion-based voice adjustments */
  enableEmotionVoice: boolean;
  /** Enable speech naturalization (symbols → words, pauses) */
  enableNaturalization: boolean;
  /** Enable backchanneling (acknowledgments during processing) */
  enableBackchanneling: boolean;
  /** Pre-cache backchannel audio on startup */
  preCacheBackchannels: boolean;
  /** Speech naturalizer config overrides */
  naturalizerConfig?: Partial<NaturalizerConfig>;
  /** Formality level 0-1 (affects word choice) */
  formality: number;
}

export const DEFAULT_NATURAL_VOICE_CONFIG: NaturalVoiceConfig = {
  enableEmotionVoice: true,
  enableNaturalization: true,
  enableBackchanneling: true,
  preCacheBackchannels: true,
  formality: 0.4, // Casual-leaning for Siri-like feel
};

export interface PreparedSpeech {
  /** Naturalized text ready for TTS */
  text: string;
  /** Dynamic voice settings to use */
  voiceSettings: DynamicVoiceSettings;
  /** Whether backchannel was used */
  usedBackchannel: boolean;
  /** Processing time in ms */
  processingTimeMs: number;
}

// ============================================================================
// Main Integration Class
// ============================================================================

export class NaturalVoiceIntegration extends EventEmitter {
  private config: NaturalVoiceConfig;
  private voiceMapper = getEmotionToVoiceMapper();
  private naturalizer = getSpeechNaturalizer();
  private backchannelManager = getBackchannelManager();
  private currentEmotion: EmotionState | null = null;
  private currentPersona: Persona | null = null;
  private ttsManager: TTSManager | null = null;
  private initialized = false;

  constructor(config: Partial<NaturalVoiceConfig> = {}) {
    super();
    this.config = { ...DEFAULT_NATURAL_VOICE_CONFIG, ...config };
  }

  /**
   * Initialize the natural voice system
   */
  async initialize(ttsManager?: TTSManager): Promise<void> {
    if (this.initialized) return;

    this.ttsManager = ttsManager || null;

    // Initialize backchanneling with TTS if available
    if (this.config.enableBackchanneling && this.ttsManager) {
      await this.backchannelManager.initialize(this.ttsManager);
      logger.info('Backchanneling initialized', {
        cached: this.backchannelManager.getCacheStats().cached,
      });
    }

    // Configure naturalizer
    this.naturalizer.setConfig({
      formality: this.config.formality,
      ...this.config.naturalizerConfig,
    });

    this.initialized = true;
    logger.info('Natural voice integration initialized', {
      emotionVoice: this.config.enableEmotionVoice,
      naturalization: this.config.enableNaturalization,
      backchanneling: this.config.enableBackchanneling,
    });

    this.emit('initialized');
  }

  /**
   * Set the current user emotion (from emotion detector)
   */
  setUserEmotion(emotion: EmotionState): void {
    this.currentEmotion = emotion;
    this.emit('emotion-updated', emotion);
  }

  /**
   * Set the active persona
   */
  setPersona(persona: Persona): void {
    this.currentPersona = persona;
    // Store persona for use in voice context

    // Adjust naturalizer formality based on persona
    const formality = this.config.formality;
    
    this.naturalizer.setConfig({ formality });
    
    this.emit('persona-updated', persona);
  }

  /**
   * Prepare text for speaking - the main method
   * Combines naturalization + emotion voice settings
   */
  prepareSpeech(
    text: string,
    options?: {
      emotion?: EmotionState;
      contentType?: ContentType;
      skipNaturalization?: boolean;
    }
  ): PreparedSpeech {
    const startTime = Date.now();
    
    const emotion = options?.emotion || this.currentEmotion || undefined;
    
    // 1. Naturalize text (if enabled)
    let processedText = text;
    if (this.config.enableNaturalization && !options?.skipNaturalization) {
      const result = this.naturalizer.naturalize(text);
      processedText = result.text;
      
      logger.debug('Text naturalized', {
        originalLength: text.length,
        naturalizedLength: processedText.length,
        modifications: result.modifications,
      });
    }

    // 2. Get voice settings based on emotion and content
    let voiceSettings: DynamicVoiceSettings;
    if (this.config.enableEmotionVoice) {
      // Detect content type if not provided
      const contentType = options?.contentType || this.voiceMapper.detectContentType(processedText);
      
      // Build voice context
      voiceSettings = this.voiceMapper.getVoiceSettings({
        emotion,
        contentType,
        hourOfDay: new Date().getHours(),
      });
    } else {
      voiceSettings = this.voiceMapper.getBaseline();
    }

    // 3. Apply settings to TTS manager
    if (this.ttsManager) {
      this.ttsManager.setDynamicVoiceSettings(voiceSettings);
    }

    return {
      text: processedText,
      voiceSettings,
      usedBackchannel: false,
      processingTimeMs: Date.now() - startTime,
    };
  }

  /**
   * Speak a backchannel acknowledgment
   * Use this when starting to process a request
   */
  async speakBackchannel(category?: BackchannelCategory): Promise<void> {
    if (!this.config.enableBackchanneling || !this.initialized) {
      return;
    }

    const context: BackchannelContext = {
      userEmotion: this.currentEmotion?.primary.type as 'neutral' | 'happy' | 'frustrated' | 'anxious' | 'excited' | undefined,
      formality: this.config.formality,
      hourOfDay: new Date().getHours(),
    };

    // Default to acknowledgment if no category specified
    const cat = category || (
      this.currentEmotion?.primary.type === 'frustrated' ? 'empathy' :
      this.currentEmotion?.primary.type === 'excited' ? 'excitement' :
      'acknowledgment'
    );

    await this.backchannelManager.speak(cat, context);
    this.emit('backchannel-spoken', cat);
  }

  /**
   * Speak a thinking filler for processing delays
   */
  async speakThinkingFiller(expectedDelayMs: number): Promise<void> {
    if (!this.config.enableBackchanneling || !this.initialized) {
      return;
    }

    const context: BackchannelContext = {
      processingTimeMs: expectedDelayMs,
      formality: this.config.formality,
    };

    await this.backchannelManager.speakThinkingFiller(expectedDelayMs, context);
    this.emit('thinking-filler-spoken');
  }

  /**
   * Get a backchannel phrase text without speaking
   * Useful for injecting into LLM response
   */
  getBackchannelText(category: BackchannelCategory): string {
    return this.backchannelManager.getPhraseText(category, {
      formality: this.config.formality,
      hourOfDay: new Date().getHours(),
    });
  }

  /**
   * Apply dynamic voice settings to TTS manager
   * Call this before synthesis
   */
  applyVoiceSettings(settings: DynamicVoiceSettings): void {
    if (!this.ttsManager) return;

    // Apply to TTS manager
    this.ttsManager.setDynamicVoiceSettings(settings);
    this.emit('voice-settings-applied', settings);
    
    logger.debug('Voice settings applied', {
      stability: settings.stability.toFixed(2),
      style: settings.style.toFixed(2),
      speed: settings.speed.toFixed(2),
    });
  }

  /**
   * Clear dynamic voice settings (reset to defaults)
   */
  clearVoiceSettings(): void {
    if (!this.ttsManager) return;
    
    this.ttsManager.clearDynamicVoiceSettings();
    this.voiceMapper.reset();
    
    logger.debug('Voice settings cleared');
  }

  /**
   * Process and speak with natural voice
   * Convenience method that combines preparation and synthesis
   */
  async speakNaturally(
    text: string,
    options?: {
      emotion?: EmotionState;
      contentType?: ContentType;
      priority?: number;
    }
  ): Promise<void> {
    if (!this.ttsManager) {
      logger.warn('No TTS manager available for speaking');
      return;
    }

    const prepared = this.prepareSpeech(text, options);
    
    // Apply voice settings
    this.applyVoiceSettings(prepared.voiceSettings);
    
    // Speak the naturalized text
    await this.ttsManager.speak(prepared.text, options?.priority ?? 0);
    
    this.emit('spoke-naturally', {
      originalText: text,
      preparedText: prepared.text,
      voiceSettings: prepared.voiceSettings,
      processingTimeMs: prepared.processingTimeMs,
    });
  }

  /**
   * Get current configuration
   */
  getConfig(): NaturalVoiceConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<NaturalVoiceConfig>): void {
    this.config = { ...this.config, ...config };
    
    if (config.formality !== undefined || config.naturalizerConfig) {
      this.naturalizer.setConfig({
        formality: config.formality ?? this.config.formality,
        ...config.naturalizerConfig,
      });
    }
    
    this.emit('config-updated', this.config);
  }

  /**
   * Get statistics
   */
  getStats(): {
    backchannelsCached: number;
    currentEmotion: string | null;
    currentPersona: string | null;
  } {
    return {
      backchannelsCached: this.backchannelManager.getCacheStats().cached,
      currentEmotion: this.currentEmotion?.primary.type || null,
      currentPersona: this.currentPersona?.name || null,
    };
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

let instance: NaturalVoiceIntegration | null = null;

export function getNaturalVoiceIntegration(
  ttsManager?: TTSManager,
  config?: Partial<NaturalVoiceConfig>
): NaturalVoiceIntegration {
  if (!instance) {
    instance = new NaturalVoiceIntegration(config);
  }
  // Initialize if TTS manager provided and not yet initialized
  if (ttsManager && !instance['initialized']) {
    instance.initialize(ttsManager).catch(err => {
      logger.error('Failed to initialize natural voice', { error: (err as Error).message });
    });
  }
  return instance;
}

export async function initializeNaturalVoice(
  ttsManager?: TTSManager,
  config?: Partial<NaturalVoiceConfig>
): Promise<NaturalVoiceIntegration> {
  const integration = getNaturalVoiceIntegration(config);
  await integration.initialize(ttsManager);
  return integration;
}
