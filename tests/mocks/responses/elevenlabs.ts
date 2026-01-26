/**
 * ElevenLabs API Mock Response Fixtures
 * Pre-configured responses for testing TTS functionality
 */

// ============================================================================
// Types
// ============================================================================

export interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  category: 'premade' | 'cloned' | 'generated';
  labels?: {
    accent?: string;
    age?: string;
    gender?: string;
    description?: string;
    use_case?: string;
  };
  description?: string;
  preview_url?: string;
  available_for_tiers?: string[];
  settings?: {
    stability?: number;
    similarity_boost?: number;
    style?: number;
    use_speaker_boost?: boolean;
  };
  high_quality_base_model_ids?: string[];
}

export interface ElevenLabsVoicesResponse {
  voices: ElevenLabsVoice[];
}

export interface ElevenLabsSubscriptionInfo {
  tier: string;
  character_count: number;
  character_limit: number;
  can_extend_character_limit: boolean;
  allowed_to_extend_character_limit: boolean;
  next_character_count_reset_unix: number;
  voice_limit: number;
  professional_voice_limit: number;
  max_voice_add_edits: number;
  voice_add_edit_counter: number;
  can_use_instant_voice_cloning: boolean;
  can_use_professional_voice_cloning: boolean;
  currency?: string;
  status?: string;
}

export interface ElevenLabsUserInfo {
  subscription: ElevenLabsSubscriptionInfo;
  is_new_user: boolean;
  xi_api_key: string;
  can_use_delayed_payment_methods: boolean;
}

export interface ElevenLabsModel {
  model_id: string;
  name: string;
  can_be_finetuned: boolean;
  can_do_text_to_speech: boolean;
  can_do_voice_conversion: boolean;
  can_use_style: boolean;
  can_use_speaker_boost: boolean;
  serves_pro_voices: boolean;
  token_cost_factor: number;
  description: string;
  requires_alpha_access: boolean;
  max_characters_request_free_user: number;
  max_characters_request_subscribed_user: number;
  languages: Array<{ language_id: string; name: string }>;
}

// ============================================================================
// Pre-configured Voice Responses
// ============================================================================

/**
 * Default Atlas voice
 */
export const ATLAS_DEFAULT_VOICE: ElevenLabsVoice = {
  voice_id: 'atlas-default-voice-id',
  name: 'Atlas Default',
  category: 'premade',
  labels: {
    accent: 'american',
    age: 'young',
    gender: 'female',
    description: 'Friendly and professional AI assistant voice',
    use_case: 'assistant',
  },
  description: 'The default Atlas AI assistant voice - clear, friendly, and professional.',
  preview_url: 'https://api.elevenlabs.io/v1/voices/atlas-default-voice-id/preview',
  available_for_tiers: ['free', 'starter', 'creator', 'pro', 'scale', 'business'],
  settings: {
    stability: 0.5,
    similarity_boost: 0.75,
    style: 0.0,
    use_speaker_boost: true,
  },
  high_quality_base_model_ids: ['eleven_multilingual_v2', 'eleven_turbo_v2_5'],
};

/**
 * Professional male voice
 */
export const PROFESSIONAL_VOICE: ElevenLabsVoice = {
  voice_id: 'professional-voice-id',
  name: 'Professional',
  category: 'premade',
  labels: {
    accent: 'british',
    age: 'middle-aged',
    gender: 'male',
    description: 'Professional and authoritative',
    use_case: 'narration',
  },
  description: 'A professional male voice with British accent, perfect for formal content.',
  preview_url: 'https://api.elevenlabs.io/v1/voices/professional-voice-id/preview',
  settings: {
    stability: 0.65,
    similarity_boost: 0.8,
    style: 0.1,
    use_speaker_boost: true,
  },
};

/**
 * Casual conversational voice
 */
export const CASUAL_VOICE: ElevenLabsVoice = {
  voice_id: 'casual-voice-id',
  name: 'Casual',
  category: 'premade',
  labels: {
    accent: 'american',
    age: 'young',
    gender: 'male',
    description: 'Casual and friendly',
    use_case: 'conversational',
  },
  description: 'A casual, friendly voice perfect for informal conversations.',
  preview_url: 'https://api.elevenlabs.io/v1/voices/casual-voice-id/preview',
  settings: {
    stability: 0.4,
    similarity_boost: 0.7,
    style: 0.2,
    use_speaker_boost: false,
  },
};

/**
 * Custom cloned voice
 */
export const CUSTOM_CLONED_VOICE: ElevenLabsVoice = {
  voice_id: 'custom-clone-voice-id',
  name: 'My Custom Voice',
  category: 'cloned',
  labels: {
    description: 'Custom cloned voice',
  },
  description: 'A custom voice clone created by the user.',
  settings: {
    stability: 0.55,
    similarity_boost: 0.85,
  },
};

/**
 * Full voices list response
 */
export const VOICES_RESPONSE: ElevenLabsVoicesResponse = {
  voices: [ATLAS_DEFAULT_VOICE, PROFESSIONAL_VOICE, CASUAL_VOICE, CUSTOM_CLONED_VOICE],
};

// ============================================================================
// Subscription Responses
// ============================================================================

/**
 * Free tier subscription
 */
export const FREE_SUBSCRIPTION: ElevenLabsSubscriptionInfo = {
  tier: 'free',
  character_count: 8500,
  character_limit: 10000,
  can_extend_character_limit: false,
  allowed_to_extend_character_limit: false,
  next_character_count_reset_unix: Math.floor(Date.now() / 1000) + 86400 * 30,
  voice_limit: 3,
  professional_voice_limit: 0,
  max_voice_add_edits: 0,
  voice_add_edit_counter: 0,
  can_use_instant_voice_cloning: false,
  can_use_professional_voice_cloning: false,
};

/**
 * Starter tier subscription
 */
export const STARTER_SUBSCRIPTION: ElevenLabsSubscriptionInfo = {
  tier: 'starter',
  character_count: 15000,
  character_limit: 30000,
  can_extend_character_limit: true,
  allowed_to_extend_character_limit: true,
  next_character_count_reset_unix: Math.floor(Date.now() / 1000) + 86400 * 30,
  voice_limit: 10,
  professional_voice_limit: 0,
  max_voice_add_edits: 3,
  voice_add_edit_counter: 1,
  can_use_instant_voice_cloning: true,
  can_use_professional_voice_cloning: false,
};

/**
 * Creator tier subscription
 */
export const CREATOR_SUBSCRIPTION: ElevenLabsSubscriptionInfo = {
  tier: 'creator',
  character_count: 50000,
  character_limit: 100000,
  can_extend_character_limit: true,
  allowed_to_extend_character_limit: true,
  next_character_count_reset_unix: Math.floor(Date.now() / 1000) + 86400 * 30,
  voice_limit: 30,
  professional_voice_limit: 1,
  max_voice_add_edits: 10,
  voice_add_edit_counter: 3,
  can_use_instant_voice_cloning: true,
  can_use_professional_voice_cloning: true,
};

/**
 * Pro tier subscription
 */
export const PRO_SUBSCRIPTION: ElevenLabsSubscriptionInfo = {
  tier: 'pro',
  character_count: 200000,
  character_limit: 500000,
  can_extend_character_limit: true,
  allowed_to_extend_character_limit: true,
  next_character_count_reset_unix: Math.floor(Date.now() / 1000) + 86400 * 30,
  voice_limit: 100,
  professional_voice_limit: 5,
  max_voice_add_edits: 30,
  voice_add_edit_counter: 10,
  can_use_instant_voice_cloning: true,
  can_use_professional_voice_cloning: true,
};

// ============================================================================
// Model Responses
// ============================================================================

/**
 * Available TTS models
 */
export const MODELS_RESPONSE: { models: ElevenLabsModel[] } = {
  models: [
    {
      model_id: 'eleven_multilingual_v2',
      name: 'Eleven Multilingual v2',
      can_be_finetuned: true,
      can_do_text_to_speech: true,
      can_do_voice_conversion: true,
      can_use_style: true,
      can_use_speaker_boost: true,
      serves_pro_voices: true,
      token_cost_factor: 1.0,
      description: 'State-of-the-art multilingual model for natural speech.',
      requires_alpha_access: false,
      max_characters_request_free_user: 2500,
      max_characters_request_subscribed_user: 5000,
      languages: [
        { language_id: 'en', name: 'English' },
        { language_id: 'es', name: 'Spanish' },
        { language_id: 'fr', name: 'French' },
        { language_id: 'de', name: 'German' },
        { language_id: 'it', name: 'Italian' },
        { language_id: 'pt', name: 'Portuguese' },
        { language_id: 'ja', name: 'Japanese' },
        { language_id: 'zh', name: 'Chinese' },
      ],
    },
    {
      model_id: 'eleven_turbo_v2_5',
      name: 'Eleven Turbo v2.5',
      can_be_finetuned: false,
      can_do_text_to_speech: true,
      can_do_voice_conversion: false,
      can_use_style: false,
      can_use_speaker_boost: true,
      serves_pro_voices: false,
      token_cost_factor: 0.5,
      description: 'Fast, low-latency model optimized for real-time applications.',
      requires_alpha_access: false,
      max_characters_request_free_user: 5000,
      max_characters_request_subscribed_user: 10000,
      languages: [{ language_id: 'en', name: 'English' }],
    },
    {
      model_id: 'eleven_monolingual_v1',
      name: 'Eleven English v1',
      can_be_finetuned: true,
      can_do_text_to_speech: true,
      can_do_voice_conversion: true,
      can_use_style: false,
      can_use_speaker_boost: true,
      serves_pro_voices: false,
      token_cost_factor: 1.0,
      description: 'Original high-quality English model.',
      requires_alpha_access: false,
      max_characters_request_free_user: 2500,
      max_characters_request_subscribed_user: 5000,
      languages: [{ language_id: 'en', name: 'English' }],
    },
  ],
};

// ============================================================================
// Audio Data Generation
// ============================================================================

/**
 * Generate mock MP3 audio data with realistic structure
 */
export function generateMockAudioData(options: {
  durationMs?: number;
  format?: 'mp3' | 'pcm';
  sampleRate?: number;
} = {}): ArrayBuffer {
  const { durationMs = 1000, format = 'mp3', sampleRate = 44100 } = options;

  // Calculate approximate size
  let size: number;
  if (format === 'mp3') {
    // ~128kbps MP3 = ~16KB per second
    size = Math.floor((durationMs / 1000) * 16000);
  } else {
    // PCM 16-bit mono
    size = Math.floor((durationMs / 1000) * sampleRate * 2);
  }

  size = Math.max(size, 256); // Minimum size

  const buffer = new ArrayBuffer(size);
  const view = new Uint8Array(buffer);

  if (format === 'mp3') {
    // ID3v2 header
    view[0] = 0x49; // 'I'
    view[1] = 0x44; // 'D'
    view[2] = 0x33; // '3'
    view[3] = 0x04; // Version 4
    view[4] = 0x00; // Revision
    view[5] = 0x00; // Flags
    // ID3 size (4 bytes, 7 bits each)
    view[6] = 0x00;
    view[7] = 0x00;
    view[8] = 0x00;
    view[9] = 0x10;

    // MP3 frame sync (0xFF 0xFB for MPEG1 Layer 3)
    for (let i = 10; i < size - 1; i += 417) {
      view[i] = 0xff;
      view[i + 1] = 0xfb;
    }

    // Fill with semi-random data
    for (let i = 12; i < size; i++) {
      if (view[i] === 0) {
        view[i] = Math.floor(Math.random() * 200) + 28;
      }
    }
  } else {
    // PCM data - generate simple waveform-like data
    for (let i = 0; i < size; i += 2) {
      const sample = Math.floor(Math.sin(i / 10) * 32767 * 0.3);
      view[i] = sample & 0xff;
      view[i + 1] = (sample >> 8) & 0xff;
    }
  }

  return buffer;
}

/**
 * Generate mock audio chunks for streaming response
 */
export function generateAudioChunks(options: {
  totalDurationMs?: number;
  chunkCount?: number;
  format?: 'mp3' | 'pcm';
} = {}): Uint8Array[] {
  const { totalDurationMs = 2000, chunkCount = 10, format = 'mp3' } = options;

  const chunks: Uint8Array[] = [];
  const chunkDuration = totalDurationMs / chunkCount;

  for (let i = 0; i < chunkCount; i++) {
    const buffer = generateMockAudioData({ durationMs: chunkDuration, format });
    chunks.push(new Uint8Array(buffer));
  }

  return chunks;
}

// ============================================================================
// Error Responses
// ============================================================================

export interface ElevenLabsError {
  detail: {
    status: string;
    message: string;
  };
}

/**
 * Invalid API key error
 */
export const INVALID_API_KEY_ERROR: ElevenLabsError = {
  detail: {
    status: 'invalid_api_key',
    message: 'The API key you provided is invalid. Please check your API key and try again.',
  },
};

/**
 * Rate limit error
 */
export const RATE_LIMIT_ERROR: ElevenLabsError = {
  detail: {
    status: 'rate_limit_exceeded',
    message: 'You have exceeded the rate limit. Please wait before making additional requests.',
  },
};

/**
 * Quota exceeded error
 */
export const QUOTA_EXCEEDED_ERROR: ElevenLabsError = {
  detail: {
    status: 'quota_exceeded',
    message:
      'You have exceeded your character quota for this billing period. Please upgrade your plan or wait for the quota to reset.',
  },
};

/**
 * Voice not found error
 */
export const VOICE_NOT_FOUND_ERROR: ElevenLabsError = {
  detail: {
    status: 'voice_not_found',
    message: 'The specified voice ID does not exist or you do not have access to it.',
  },
};

/**
 * Text too long error
 */
export const TEXT_TOO_LONG_ERROR: ElevenLabsError = {
  detail: {
    status: 'text_too_long',
    message: 'The text you provided exceeds the maximum allowed length for your subscription tier.',
  },
};

/**
 * Model not available error
 */
export const MODEL_NOT_AVAILABLE_ERROR: ElevenLabsError = {
  detail: {
    status: 'model_not_available',
    message: 'The specified model is not available for your account or is currently unavailable.',
  },
};

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a custom voice
 */
export function createVoice(
  name: string,
  options: Partial<Omit<ElevenLabsVoice, 'voice_id' | 'name'>> = {}
): ElevenLabsVoice {
  return {
    voice_id: `voice-${Date.now()}-${Math.random().toString(36).substring(7)}`,
    name,
    category: 'premade',
    ...options,
  };
}

/**
 * Create a custom subscription response
 */
export function createSubscriptionResponse(
  tier: string,
  characterCount: number,
  characterLimit: number,
  options: Partial<ElevenLabsSubscriptionInfo> = {}
): ElevenLabsSubscriptionInfo {
  return {
    tier,
    character_count: characterCount,
    character_limit: characterLimit,
    can_extend_character_limit: tier !== 'free',
    allowed_to_extend_character_limit: tier !== 'free',
    next_character_count_reset_unix: Math.floor(Date.now() / 1000) + 86400 * 30,
    voice_limit: 10,
    professional_voice_limit: 0,
    max_voice_add_edits: 3,
    voice_add_edit_counter: 0,
    can_use_instant_voice_cloning: tier !== 'free',
    can_use_professional_voice_cloning: ['creator', 'pro', 'scale', 'business'].includes(tier),
    ...options,
  };
}

/**
 * Create TTS synthesis request body
 */
export function createSynthesisRequest(
  text: string,
  options: {
    modelId?: string;
    voiceSettings?: {
      stability?: number;
      similarity_boost?: number;
      style?: number;
      use_speaker_boost?: boolean;
    };
  } = {}
): Record<string, unknown> {
  const { modelId = 'eleven_multilingual_v2', voiceSettings } = options;

  return {
    text,
    model_id: modelId,
    voice_settings: voiceSettings ?? {
      stability: 0.5,
      similarity_boost: 0.75,
      style: 0.0,
      use_speaker_boost: true,
    },
  };
}

export default {
  // Voices
  ATLAS_DEFAULT_VOICE,
  PROFESSIONAL_VOICE,
  CASUAL_VOICE,
  CUSTOM_CLONED_VOICE,
  VOICES_RESPONSE,
  // Subscriptions
  FREE_SUBSCRIPTION,
  STARTER_SUBSCRIPTION,
  CREATOR_SUBSCRIPTION,
  PRO_SUBSCRIPTION,
  // Models
  MODELS_RESPONSE,
  // Errors
  INVALID_API_KEY_ERROR,
  RATE_LIMIT_ERROR,
  QUOTA_EXCEEDED_ERROR,
  VOICE_NOT_FOUND_ERROR,
  TEXT_TOO_LONG_ERROR,
  MODEL_NOT_AVAILABLE_ERROR,
  // Factory functions
  createVoice,
  createSubscriptionResponse,
  createSynthesisRequest,
  generateMockAudioData,
  generateAudioChunks,
};
