/**
 * Fish Audio Integration for NovaVoice
 * 
 * Fish Audio provides:
 * - 1000+ voices in 70+ languages
 * - Industry-leading emotion control
 * - Studio-grade quality
 * - Instant voice cloning
 * 
 * This competes directly with ElevenLabs at lower cost
 */

import { EventEmitter } from 'events';

// =============================================================================
// TYPES
// =============================================================================

export interface FishAudioConfig {
  apiKey: string;
  baseUrl: string;
  /** Default voice ID */
  defaultVoice: string;
  /** Audio format settings */
  format: AudioFormat;
  /** Enable emotion control */
  emotionControl: boolean;
}

export interface AudioFormat {
  sampleRate: 8000 | 16000 | 24000 | 44100 | 48000;
  encoding: 'pcm' | 'mp3' | 'opus' | 'wav';
  channels: 1 | 2;
}

export interface FishVoice {
  id: string;
  name: string;
  language: string;
  gender: 'male' | 'female' | 'neutral';
  style: string[];
  sampleUrl?: string;
  isCloned: boolean;
}

export interface EmotionControlParams {
  /** Primary emotion */
  emotion: FishEmotion;
  /** Intensity 0-1 */
  intensity: number;
  /** Speaking rate multiplier */
  rate: number;
  /** Pitch shift in semitones */
  pitch: number;
  /** Volume multiplier */
  volume: number;
}

export type FishEmotion = 
  | 'neutral' | 'happy' | 'sad' | 'angry' | 'fearful'
  | 'surprised' | 'disgusted' | 'excited' | 'calm'
  | 'tender' | 'proud' | 'ashamed' | 'contemptuous';

export interface VoiceCloningRequest {
  /** Audio samples for cloning */
  samples: AudioSample[];
  /** Name for the cloned voice */
  name: string;
  /** Description */
  description?: string;
  /** Language of the voice */
  language: string;
  /** Gender */
  gender: 'male' | 'female' | 'neutral';
}

export interface AudioSample {
  audio: ArrayBuffer;
  /** Transcript of what's being said (improves quality) */
  transcript?: string;
  /** Sample rate of the audio */
  sampleRate: number;
}

// =============================================================================
// FISH AUDIO ENGINE
// =============================================================================

export class FishAudioEngine extends EventEmitter {
  private config: FishAudioConfig;
  private voices = new Map<string, FishVoice>();
  private isInitialized = false;

  constructor(config: Partial<FishAudioConfig> = {}) {
    super();
    this.config = {
      apiKey: process.env.FISH_AUDIO_API_KEY || '',
      baseUrl: 'https://api.fish.audio',
      defaultVoice: '',
      format: {
        sampleRate: 24000,
        encoding: 'pcm',
        channels: 1,
      },
      emotionControl: true,
      ...config,
    };
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    this.emit('status', 'Initializing Fish Audio...');

    // Load available voices
    await this.loadVoices();

    this.isInitialized = true;
    this.emit('ready');
  }

  /**
   * Load all available voices from Fish Audio
   */
  async loadVoices(): Promise<FishVoice[]> {
    try {
      const response = await fetch(`${this.config.baseUrl}/v1/voices`, {
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to load voices: ${response.statusText}`);
      }

      const data = await response.json();
      const voices: FishVoice[] = data.voices || [];

      for (const voice of voices) {
        this.voices.set(voice.id, voice);
      }

      return voices;
    } catch (error) {
      this.emit('error', error);
      return [];
    }
  }

  /**
   * Get voices by language
   */
  getVoicesByLanguage(language: string): FishVoice[] {
    return Array.from(this.voices.values()).filter(v => 
      v.language.toLowerCase().includes(language.toLowerCase())
    );
  }

  /**
   * Get voices by gender
   */
  getVoicesByGender(gender: 'male' | 'female' | 'neutral'): FishVoice[] {
    return Array.from(this.voices.values()).filter(v => v.gender === gender);
  }

  /**
   * Synthesize speech with emotion control
   * This is where Fish Audio excels over ElevenLabs
   */
  async synthesize(
    text: string,
    voiceId?: string,
    emotion?: EmotionControlParams
  ): Promise<Float32Array> {
    const voice = voiceId || this.config.defaultVoice;

    const body: Record<string, unknown> = {
      text,
      voice_id: voice,
      format: this.config.format.encoding,
      sample_rate: this.config.format.sampleRate,
    };

    // Add emotion control
    if (emotion && this.config.emotionControl) {
      body.emotion = emotion.emotion;
      body.emotion_intensity = emotion.intensity;
      body.speed = emotion.rate;
      body.pitch = emotion.pitch;
      body.volume = emotion.volume;
    }

    const response = await fetch(`${this.config.baseUrl}/v1/tts`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`TTS failed: ${response.statusText}`);
    }

    const audioBuffer = await response.arrayBuffer();
    return this.decodeAudio(audioBuffer);
  }

  /**
   * Stream synthesis for real-time applications
   */
  async *synthesizeStream(
    text: string,
    voiceId?: string,
    emotion?: EmotionControlParams
  ): AsyncGenerator<Float32Array> {
    const voice = voiceId || this.config.defaultVoice;

    const body: Record<string, unknown> = {
      text,
      voice_id: voice,
      format: 'pcm',
      sample_rate: this.config.format.sampleRate,
      stream: true,
    };

    if (emotion && this.config.emotionControl) {
      body.emotion = emotion.emotion;
      body.emotion_intensity = emotion.intensity;
    }

    const response = await fetch(`${this.config.baseUrl}/v1/tts/stream`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok || !response.body) {
      throw new Error(`Streaming TTS failed: ${response.statusText}`);
    }

    const reader = response.body.getReader();
    const chunkSize = this.config.format.sampleRate * 0.1; // 100ms chunks

    let buffer = new Uint8Array(0);

    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      // Append new data to buffer
      const newBuffer = new Uint8Array(buffer.length + value.length);
      newBuffer.set(buffer);
      newBuffer.set(value, buffer.length);
      buffer = newBuffer;

      // Yield complete chunks
      while (buffer.length >= chunkSize * 4) { // 4 bytes per float32
        const chunk = buffer.slice(0, chunkSize * 4);
        buffer = buffer.slice(chunkSize * 4);
        yield new Float32Array(chunk.buffer);
      }
    }

    // Yield remaining buffer
    if (buffer.length > 0) {
      yield new Float32Array(buffer.buffer);
    }
  }

  /**
   * Clone a voice from audio samples
   * Fish Audio allows instant cloning with minimal samples
   */
  async cloneVoice(request: VoiceCloningRequest): Promise<FishVoice> {
    const formData = new FormData();

    // Add audio samples
    for (let i = 0; i < request.samples.length; i++) {
      const sample = request.samples[i];
      const blob = new Blob([sample.audio], { type: 'audio/wav' });
      formData.append(`sample_${i}`, blob);
      
      if (sample.transcript) {
        formData.append(`transcript_${i}`, sample.transcript);
      }
    }

    // Add metadata
    formData.append('name', request.name);
    formData.append('language', request.language);
    formData.append('gender', request.gender);
    if (request.description) {
      formData.append('description', request.description);
    }

    const response = await fetch(`${this.config.baseUrl}/v1/voices/clone`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Voice cloning failed: ${response.statusText}`);
    }

    const voice: FishVoice = await response.json();
    this.voices.set(voice.id, voice);

    return voice;
  }

  /**
   * Delete a cloned voice
   */
  async deleteVoice(voiceId: string): Promise<void> {
    const response = await fetch(`${this.config.baseUrl}/v1/voices/${voiceId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to delete voice: ${response.statusText}`);
    }

    this.voices.delete(voiceId);
  }

  private decodeAudio(buffer: ArrayBuffer): Float32Array {
    // Decode based on format
    if (this.config.format.encoding === 'pcm') {
      return new Float32Array(buffer);
    }

    // For other formats, would need decoder
    // This is a placeholder
    return new Float32Array(buffer);
  }

  async dispose(): Promise<void> {
    this.voices.clear();
    this.isInitialized = false;
  }
}

// =============================================================================
// EMOTION PRESETS
// =============================================================================

export const EMOTION_PRESETS: Record<string, EmotionControlParams> = {
  // Positive emotions
  happy: {
    emotion: 'happy',
    intensity: 0.7,
    rate: 1.1,
    pitch: 2,
    volume: 1.1,
  },
  excited: {
    emotion: 'excited',
    intensity: 0.9,
    rate: 1.2,
    pitch: 4,
    volume: 1.2,
  },
  calm: {
    emotion: 'calm',
    intensity: 0.6,
    rate: 0.9,
    pitch: -1,
    volume: 0.9,
  },
  tender: {
    emotion: 'tender',
    intensity: 0.5,
    rate: 0.85,
    pitch: 0,
    volume: 0.85,
  },
  proud: {
    emotion: 'proud',
    intensity: 0.7,
    rate: 0.95,
    pitch: 1,
    volume: 1.05,
  },

  // Negative emotions
  sad: {
    emotion: 'sad',
    intensity: 0.6,
    rate: 0.8,
    pitch: -3,
    volume: 0.8,
  },
  angry: {
    emotion: 'angry',
    intensity: 0.8,
    rate: 1.15,
    pitch: 2,
    volume: 1.3,
  },
  fearful: {
    emotion: 'fearful',
    intensity: 0.7,
    rate: 1.2,
    pitch: 3,
    volume: 0.9,
  },
  surprised: {
    emotion: 'surprised',
    intensity: 0.8,
    rate: 1.1,
    pitch: 5,
    volume: 1.1,
  },
  disgusted: {
    emotion: 'disgusted',
    intensity: 0.6,
    rate: 0.9,
    pitch: -2,
    volume: 1.0,
  },

  // Neutral/Professional
  neutral: {
    emotion: 'neutral',
    intensity: 0.5,
    rate: 1.0,
    pitch: 0,
    volume: 1.0,
  },
  professional: {
    emotion: 'neutral',
    intensity: 0.3,
    rate: 0.95,
    pitch: -1,
    volume: 1.0,
  },
  friendly: {
    emotion: 'happy',
    intensity: 0.4,
    rate: 1.05,
    pitch: 1,
    volume: 1.05,
  },
};

// =============================================================================
// LANGUAGE SUPPORT (70+ languages)
// =============================================================================

export const FISH_SUPPORTED_LANGUAGES = [
  // Major languages
  { code: 'en', name: 'English', variants: ['en-US', 'en-GB', 'en-AU', 'en-IN'] },
  { code: 'zh', name: 'Chinese', variants: ['zh-CN', 'zh-TW', 'zh-HK'] },
  { code: 'es', name: 'Spanish', variants: ['es-ES', 'es-MX', 'es-AR'] },
  { code: 'fr', name: 'French', variants: ['fr-FR', 'fr-CA'] },
  { code: 'de', name: 'German', variants: ['de-DE', 'de-AT', 'de-CH'] },
  { code: 'ja', name: 'Japanese', variants: ['ja-JP'] },
  { code: 'ko', name: 'Korean', variants: ['ko-KR'] },
  { code: 'pt', name: 'Portuguese', variants: ['pt-BR', 'pt-PT'] },
  { code: 'it', name: 'Italian', variants: ['it-IT'] },
  { code: 'ru', name: 'Russian', variants: ['ru-RU'] },
  
  // Additional languages
  { code: 'ar', name: 'Arabic', variants: ['ar-SA', 'ar-EG'] },
  { code: 'hi', name: 'Hindi', variants: ['hi-IN'] },
  { code: 'bn', name: 'Bengali', variants: ['bn-BD', 'bn-IN'] },
  { code: 'vi', name: 'Vietnamese', variants: ['vi-VN'] },
  { code: 'th', name: 'Thai', variants: ['th-TH'] },
  { code: 'id', name: 'Indonesian', variants: ['id-ID'] },
  { code: 'ms', name: 'Malay', variants: ['ms-MY'] },
  { code: 'tl', name: 'Filipino', variants: ['tl-PH'] },
  { code: 'tr', name: 'Turkish', variants: ['tr-TR'] },
  { code: 'pl', name: 'Polish', variants: ['pl-PL'] },
  { code: 'nl', name: 'Dutch', variants: ['nl-NL', 'nl-BE'] },
  { code: 'sv', name: 'Swedish', variants: ['sv-SE'] },
  { code: 'da', name: 'Danish', variants: ['da-DK'] },
  { code: 'no', name: 'Norwegian', variants: ['no-NO'] },
  { code: 'fi', name: 'Finnish', variants: ['fi-FI'] },
  { code: 'cs', name: 'Czech', variants: ['cs-CZ'] },
  { code: 'el', name: 'Greek', variants: ['el-GR'] },
  { code: 'he', name: 'Hebrew', variants: ['he-IL'] },
  { code: 'uk', name: 'Ukrainian', variants: ['uk-UA'] },
  { code: 'ro', name: 'Romanian', variants: ['ro-RO'] },
  { code: 'hu', name: 'Hungarian', variants: ['hu-HU'] },
  { code: 'sk', name: 'Slovak', variants: ['sk-SK'] },
  { code: 'bg', name: 'Bulgarian', variants: ['bg-BG'] },
  { code: 'hr', name: 'Croatian', variants: ['hr-HR'] },
  { code: 'sr', name: 'Serbian', variants: ['sr-RS'] },
  { code: 'sl', name: 'Slovenian', variants: ['sl-SI'] },
  { code: 'lt', name: 'Lithuanian', variants: ['lt-LT'] },
  { code: 'lv', name: 'Latvian', variants: ['lv-LV'] },
  { code: 'et', name: 'Estonian', variants: ['et-EE'] },
  { code: 'fa', name: 'Persian', variants: ['fa-IR'] },
  { code: 'ur', name: 'Urdu', variants: ['ur-PK'] },
  { code: 'ta', name: 'Tamil', variants: ['ta-IN'] },
  { code: 'te', name: 'Telugu', variants: ['te-IN'] },
  { code: 'ml', name: 'Malayalam', variants: ['ml-IN'] },
  { code: 'kn', name: 'Kannada', variants: ['kn-IN'] },
  { code: 'mr', name: 'Marathi', variants: ['mr-IN'] },
  { code: 'gu', name: 'Gujarati', variants: ['gu-IN'] },
  { code: 'pa', name: 'Punjabi', variants: ['pa-IN'] },
  { code: 'sw', name: 'Swahili', variants: ['sw-KE'] },
  { code: 'am', name: 'Amharic', variants: ['am-ET'] },
  { code: 'zu', name: 'Zulu', variants: ['zu-ZA'] },
  { code: 'af', name: 'Afrikaans', variants: ['af-ZA'] },
];

// =============================================================================
// COMPARISON: FISH AUDIO vs ELEVENLABS
// =============================================================================

export const FISH_VS_ELEVENLABS = {
  fishAudio: {
    voices: '1000+ voices',
    languages: '70+ languages',
    emotionControl: 'Industry-leading fine-grained control',
    voiceCloning: 'Instant with minimal samples',
    quality: 'Studio-grade',
    pricing: '~$0.10-0.15 per 1K characters',
    streaming: 'Yes, WebSocket',
    customVoices: 'Easy API-based cloning',
  },
  elevenLabs: {
    voices: '1200+ voices',
    languages: '29 languages',
    emotionControl: 'Good but less granular',
    voiceCloning: '30+ seconds required',
    quality: 'Best-in-class',
    pricing: '~$0.30 per 1K characters',
    streaming: 'Yes, WebSocket',
    customVoices: 'Web interface or API',
  },
  advantages: [
    'Fish Audio is 2-3x cheaper',
    'Fish Audio supports 2.4x more languages',
    'Fish Audio has finer emotion control',
    'Fish Audio requires less audio for cloning',
    'ElevenLabs has slightly better raw quality',
    'ElevenLabs has more pre-built voices',
  ],
};
