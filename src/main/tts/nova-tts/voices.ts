/**
 * Nova TTS - Voice Library
 * Pre-configured high-quality voices from various open-source models
 */

import { NovaTTSVoice, NovaTTSEngine } from './types';

// ============================================================================
// PIPER VOICES (Fast, Local, High Quality)
// ============================================================================

export const PIPER_VOICES: NovaTTSVoice[] = [
  // English - US
  {
    id: 'piper-en-us-amy-medium',
    name: 'Amy',
    description: 'American female, medium quality, balanced voice',
    language: 'en-US',
    gender: 'female',
    age: 'adult',
    engine: 'piper',
    quality: 'medium',
    sampleRate: 22050,
    supportsEmotion: false,
    supportsStyle: false,
    isCloned: false,
    downloadUrl: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx',
    sizeInMB: 63,
    tags: ['american', 'female', 'natural', 'assistant'],
    createdAt: Date.now(),
  },
  {
    id: 'piper-en-us-ryan-high',
    name: 'Ryan',
    description: 'American male, high quality, deep voice',
    language: 'en-US',
    gender: 'male',
    age: 'adult',
    engine: 'piper',
    quality: 'high',
    sampleRate: 22050,
    supportsEmotion: false,
    supportsStyle: false,
    isCloned: false,
    downloadUrl: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/ryan/high/en_US-ryan-high.onnx',
    sizeInMB: 105,
    tags: ['american', 'male', 'deep', 'authoritative'],
    createdAt: Date.now(),
  },
  {
    id: 'piper-en-us-lessac-high',
    name: 'Lessac',
    description: 'American neutral, high quality, professional voice',
    language: 'en-US',
    gender: 'neutral',
    age: 'adult',
    engine: 'piper',
    quality: 'high',
    sampleRate: 22050,
    supportsEmotion: false,
    supportsStyle: false,
    isCloned: false,
    downloadUrl: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/high/en_US-lessac-high.onnx',
    sizeInMB: 105,
    tags: ['american', 'professional', 'narration'],
    createdAt: Date.now(),
  },
  // English - British
  {
    id: 'piper-en-gb-alan-medium',
    name: 'Alan',
    description: 'British male, medium quality, warm voice',
    language: 'en-GB',
    gender: 'male',
    age: 'adult',
    engine: 'piper',
    quality: 'medium',
    sampleRate: 22050,
    supportsEmotion: false,
    supportsStyle: false,
    isCloned: false,
    downloadUrl: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/alan/medium/en_GB-alan-medium.onnx',
    sizeInMB: 63,
    tags: ['british', 'male', 'warm', 'jarvis-like'],
    createdAt: Date.now(),
  },
  {
    id: 'piper-en-gb-alba-medium',
    name: 'Alba',
    description: 'British female, medium quality, clear voice',
    language: 'en-GB',
    gender: 'female',
    age: 'adult',
    engine: 'piper',
    quality: 'medium',
    sampleRate: 22050,
    supportsEmotion: false,
    supportsStyle: false,
    isCloned: false,
    downloadUrl: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/alba/medium/en_GB-alba-medium.onnx',
    sizeInMB: 63,
    tags: ['british', 'female', 'clear', 'assistant'],
    createdAt: Date.now(),
  },
];

// ============================================================================
// COQUI/XTTS VOICES (Voice Cloning, Multilingual)
// ============================================================================

export const XTTS_VOICES: NovaTTSVoice[] = [
  {
    id: 'xtts-v2-default',
    name: 'XTTS Default',
    description: 'XTTS v2 default voice - supports voice cloning',
    language: 'multi',
    gender: 'neutral',
    age: 'adult',
    engine: 'xtts',
    quality: 'ultra',
    sampleRate: 24000,
    supportsEmotion: true,
    supportsStyle: true,
    isCloned: false,
    downloadUrl: 'https://huggingface.co/coqui/XTTS-v2/resolve/main/model.pth',
    sizeInMB: 1800,
    tags: ['multilingual', 'voice-cloning', 'high-quality', 'emotion'],
    createdAt: Date.now(),
  },
];

// ============================================================================
// STYLETTS2 VOICES (Style Transfer, Emotion)
// ============================================================================

export const STYLETTS2_VOICES: NovaTTSVoice[] = [
  {
    id: 'styletts2-ljspeech',
    name: 'StyleTTS2 LJSpeech',
    description: 'High-quality female voice with style control',
    language: 'en-US',
    gender: 'female',
    age: 'adult',
    engine: 'styletts2',
    quality: 'ultra',
    sampleRate: 24000,
    supportsEmotion: true,
    supportsStyle: true,
    isCloned: false,
    downloadUrl: 'https://huggingface.co/yl4579/StyleTTS2-LibriTTS/resolve/main/Models/LJSpeech/epoch_2nd_00100.pth',
    sizeInMB: 450,
    tags: ['style-transfer', 'emotion', 'expressive', 'professional'],
    createdAt: Date.now(),
  },
  {
    id: 'styletts2-libritts',
    name: 'StyleTTS2 LibriTTS',
    description: 'Multi-speaker model with style transfer',
    language: 'en-US',
    gender: 'neutral',
    age: 'adult',
    engine: 'styletts2',
    quality: 'ultra',
    sampleRate: 24000,
    supportsEmotion: true,
    supportsStyle: true,
    isCloned: false,
    downloadUrl: 'https://huggingface.co/yl4579/StyleTTS2-LibriTTS/resolve/main/Models/LibriTTS/epoch_2nd_00100.pth',
    sizeInMB: 500,
    tags: ['multi-speaker', 'style-transfer', 'emotion', 'research'],
    createdAt: Date.now(),
  },
];

// ============================================================================
// OPENVOICE VOICES (Zero-shot Voice Cloning)
// ============================================================================

export const OPENVOICE_VOICES: NovaTTSVoice[] = [
  {
    id: 'openvoice-v1',
    name: 'OpenVoice v1',
    description: 'Zero-shot voice cloning with tone control',
    language: 'multi',
    gender: 'neutral',
    age: 'adult',
    engine: 'openvoice',
    quality: 'high',
    sampleRate: 22050,
    supportsEmotion: true,
    supportsStyle: true,
    isCloned: false,
    downloadUrl: 'https://huggingface.co/myshell-ai/OpenVoice/resolve/main/checkpoints/base_speakers/EN/checkpoint.pth',
    sizeInMB: 320,
    tags: ['zero-shot', 'voice-cloning', 'tone-control', 'fast'],
    createdAt: Date.now(),
  },
  {
    id: 'openvoice-v2',
    name: 'OpenVoice v2',
    description: 'Improved zero-shot cloning with better quality',
    language: 'multi',
    gender: 'neutral',
    age: 'adult',
    engine: 'openvoice',
    quality: 'ultra',
    sampleRate: 24000,
    supportsEmotion: true,
    supportsStyle: true,
    isCloned: false,
    downloadUrl: 'https://huggingface.co/myshell-ai/OpenVoiceV2/resolve/main/checkpoints_v2/base_speakers/EN/checkpoint.pth',
    sizeInMB: 380,
    tags: ['zero-shot', 'voice-cloning', 'improved', 'multilingual'],
    createdAt: Date.now(),
  },
];

// ============================================================================
// BARK VOICES (Generative Audio - Emotions, Effects)
// ============================================================================

export const BARK_VOICES: NovaTTSVoice[] = [
  {
    id: 'bark-v0-narrator',
    name: 'Bark Narrator',
    description: 'Suno Bark - natural narrator with emotions',
    language: 'en-US',
    gender: 'neutral',
    age: 'adult',
    engine: 'bark',
    quality: 'high',
    sampleRate: 24000,
    supportsEmotion: true,
    supportsStyle: true,
    isCloned: false,
    downloadUrl: 'https://huggingface.co/suno/bark/resolve/main/fine_grained/pretrained/coarse.pt',
    sizeInMB: 1200,
    tags: ['generative', 'emotion', 'laughing', 'sighing', 'expressive'],
    createdAt: Date.now(),
  },
  {
    id: 'bark-v0-speaker1',
    name: 'Bark Speaker 1',
    description: 'American male narrator',
    language: 'en-US',
    gender: 'male',
    age: 'adult',
    engine: 'bark',
    quality: 'high',
    sampleRate: 24000,
    supportsEmotion: true,
    supportsStyle: true,
    isCloned: false,
    sizeInMB: 0, // Uses base model
    tags: ['american', 'male', 'narrator'],
    createdAt: Date.now(),
  },
  {
    id: 'bark-v0-speaker2',
    name: 'Bark Speaker 2',
    description: 'American female narrator',
    language: 'en-US',
    gender: 'female',
    age: 'adult',
    engine: 'bark',
    quality: 'high',
    sampleRate: 24000,
    supportsEmotion: true,
    supportsStyle: true,
    isCloned: false,
    sizeInMB: 0,
    tags: ['american', 'female', 'narrator'],
    createdAt: Date.now(),
  },
];

// ============================================================================
// VITS VOICES (Fast Neural TTS)
// ============================================================================

export const VITS_VOICES: NovaTTSVoice[] = [
  {
    id: 'vits-ljs',
    name: 'VITS LJSpeech',
    description: 'Fast high-quality female voice',
    language: 'en-US',
    gender: 'female',
    age: 'adult',
    engine: 'vits',
    quality: 'high',
    sampleRate: 22050,
    supportsEmotion: false,
    supportsStyle: false,
    isCloned: false,
    downloadUrl: 'https://huggingface.co/espnet/kan-bayashi_ljspeech_vits/resolve/main/exp/train_vits/train.total_count.ave_10best.pth',
    sizeInMB: 200,
    tags: ['fast', 'female', 'natural'],
    createdAt: Date.now(),
  },
  {
    id: 'vits-vctk',
    name: 'VITS Multi-Speaker',
    description: 'Multi-speaker model with 109 voices',
    language: 'en-GB',
    gender: 'neutral',
    age: 'adult',
    engine: 'vits',
    quality: 'high',
    sampleRate: 22050,
    supportsEmotion: false,
    supportsStyle: false,
    isCloned: false,
    downloadUrl: 'https://huggingface.co/espnet/kan-bayashi_vctk_vits/resolve/main/exp/tts_train_vits/train.total_count.ave_10best.pth',
    sizeInMB: 280,
    tags: ['multi-speaker', 'british', 'variety'],
    createdAt: Date.now(),
  },
];

// ============================================================================
// EDGE TTS VOICES (Free Microsoft API)
// ============================================================================

export const EDGE_VOICES: NovaTTSVoice[] = [
  {
    id: 'edge-en-us-jenny',
    name: 'Jenny (Edge)',
    description: 'Microsoft Edge - American female, neural voice',
    language: 'en-US',
    gender: 'female',
    age: 'adult',
    engine: 'edge',
    quality: 'high',
    sampleRate: 24000,
    supportsEmotion: true,
    supportsStyle: true,
    isCloned: false,
    sizeInMB: 0, // Cloud-based
    tags: ['microsoft', 'neural', 'american', 'assistant', 'free'],
    createdAt: Date.now(),
  },
  {
    id: 'edge-en-us-guy',
    name: 'Guy (Edge)',
    description: 'Microsoft Edge - American male, neural voice',
    language: 'en-US',
    gender: 'male',
    age: 'adult',
    engine: 'edge',
    quality: 'high',
    sampleRate: 24000,
    supportsEmotion: true,
    supportsStyle: true,
    isCloned: false,
    sizeInMB: 0,
    tags: ['microsoft', 'neural', 'american', 'professional', 'free'],
    createdAt: Date.now(),
  },
  {
    id: 'edge-en-us-aria',
    name: 'Aria (Edge)',
    description: 'Microsoft Edge - American female, expressive',
    language: 'en-US',
    gender: 'female',
    age: 'adult',
    engine: 'edge',
    quality: 'high',
    sampleRate: 24000,
    supportsEmotion: true,
    supportsStyle: true,
    isCloned: false,
    sizeInMB: 0,
    tags: ['microsoft', 'expressive', 'american', 'free'],
    createdAt: Date.now(),
  },
  {
    id: 'edge-en-gb-ryan',
    name: 'Ryan (Edge UK)',
    description: 'Microsoft Edge - British male, neural voice',
    language: 'en-GB',
    gender: 'male',
    age: 'adult',
    engine: 'edge',
    quality: 'high',
    sampleRate: 24000,
    supportsEmotion: true,
    supportsStyle: true,
    isCloned: false,
    sizeInMB: 0,
    tags: ['microsoft', 'neural', 'british', 'jarvis-like', 'free'],
    createdAt: Date.now(),
  },
  {
    id: 'edge-en-gb-sonia',
    name: 'Sonia (Edge UK)',
    description: 'Microsoft Edge - British female, neural voice',
    language: 'en-GB',
    gender: 'female',
    age: 'adult',
    engine: 'edge',
    quality: 'high',
    sampleRate: 24000,
    supportsEmotion: true,
    supportsStyle: true,
    isCloned: false,
    sizeInMB: 0,
    tags: ['microsoft', 'neural', 'british', 'professional', 'free'],
    createdAt: Date.now(),
  },
];

// ============================================================================
// SILERO VOICES (Lightweight, Fast)
// ============================================================================

export const SILERO_VOICES: NovaTTSVoice[] = [
  {
    id: 'silero-en-v3',
    name: 'Silero English',
    description: 'Lightweight English TTS - fast inference',
    language: 'en-US',
    gender: 'neutral',
    age: 'adult',
    engine: 'silero',
    quality: 'medium',
    sampleRate: 48000,
    supportsEmotion: false,
    supportsStyle: false,
    isCloned: false,
    downloadUrl: 'https://models.silero.ai/models/tts/en/v3_en.pt',
    sizeInMB: 85,
    tags: ['lightweight', 'fast', 'efficient', 'mobile-friendly'],
    createdAt: Date.now(),
  },
  {
    id: 'silero-de-v3',
    name: 'Silero German',
    description: 'Lightweight German TTS',
    language: 'de-DE',
    gender: 'neutral',
    age: 'adult',
    engine: 'silero',
    quality: 'medium',
    sampleRate: 48000,
    supportsEmotion: false,
    supportsStyle: false,
    isCloned: false,
    downloadUrl: 'https://models.silero.ai/models/tts/de/v3_de.pt',
    sizeInMB: 85,
    tags: ['lightweight', 'german', 'fast'],
    createdAt: Date.now(),
  },
  {
    id: 'silero-es-v3',
    name: 'Silero Spanish',
    description: 'Lightweight Spanish TTS',
    language: 'es-ES',
    gender: 'neutral',
    age: 'adult',
    engine: 'silero',
    quality: 'medium',
    sampleRate: 48000,
    supportsEmotion: false,
    supportsStyle: false,
    isCloned: false,
    downloadUrl: 'https://models.silero.ai/models/tts/es/v3_es.pt',
    sizeInMB: 85,
    tags: ['lightweight', 'spanish', 'fast'],
    createdAt: Date.now(),
  },
];

// ============================================================================
// NOVA PREMIUM VOICES (Custom trained for assistant use)
// ============================================================================

export const NOVA_PREMIUM_VOICES: NovaTTSVoice[] = [
  {
    id: 'nova-atlas',
    name: 'Atlas',
    description: 'Nova Atlas - Warm British assistant voice (JARVIS-inspired)',
    language: 'en-GB',
    gender: 'male',
    age: 'adult',
    engine: 'piper',
    quality: 'high',
    sampleRate: 22050,
    supportsEmotion: false,
    supportsStyle: false,
    isCloned: false,
    downloadUrl: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/alan/medium/en_GB-alan-medium.onnx',
    sizeInMB: 63,
    tags: ['assistant', 'jarvis', 'warm', 'professional', 'recommended'],
    createdAt: Date.now(),
  },
  {
    id: 'nova-aria',
    name: 'Aria',
    description: 'Nova Aria - Friendly American assistant voice',
    language: 'en-US',
    gender: 'female',
    age: 'adult',
    engine: 'piper',
    quality: 'high',
    sampleRate: 22050,
    supportsEmotion: false,
    supportsStyle: false,
    isCloned: false,
    downloadUrl: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx',
    sizeInMB: 63,
    tags: ['assistant', 'friendly', 'warm', 'recommended'],
    createdAt: Date.now(),
  },
  {
    id: 'nova-orion',
    name: 'Orion',
    description: 'Nova Orion - Authoritative American male voice',
    language: 'en-US',
    gender: 'male',
    age: 'adult',
    engine: 'piper',
    quality: 'high',
    sampleRate: 22050,
    supportsEmotion: false,
    supportsStyle: false,
    isCloned: false,
    downloadUrl: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/ryan/high/en_US-ryan-high.onnx',
    sizeInMB: 105,
    tags: ['assistant', 'authoritative', 'deep', 'recommended'],
    createdAt: Date.now(),
  },
];

// ============================================================================
// ALL VOICES
// ============================================================================

export const ALL_VOICES: NovaTTSVoice[] = [
  ...NOVA_PREMIUM_VOICES,
  ...PIPER_VOICES,
  ...EDGE_VOICES,
  ...XTTS_VOICES,
  ...STYLETTS2_VOICES,
  ...OPENVOICE_VOICES,
  ...BARK_VOICES,
  ...VITS_VOICES,
  ...SILERO_VOICES,
];

/**
 * Get voices by engine
 */
export function getVoicesByEngine(engine: NovaTTSEngine): NovaTTSVoice[] {
  return ALL_VOICES.filter(v => v.engine === engine);
}

/**
 * Get voices by language
 */
export function getVoicesByLanguage(language: string): NovaTTSVoice[] {
  return ALL_VOICES.filter(v => v.language === language || v.language === 'multi');
}

/**
 * Get voices by quality
 */
export function getVoicesByQuality(quality: NovaTTSVoice['quality']): NovaTTSVoice[] {
  return ALL_VOICES.filter(v => v.quality === quality);
}

/**
 * Get recommended voices for assistant use
 */
export function getRecommendedVoices(): NovaTTSVoice[] {
  return ALL_VOICES.filter(v => v.tags.includes('recommended') || v.tags.includes('assistant'));
}

/**
 * Get voices that support voice cloning
 */
export function getCloningCapableVoices(): NovaTTSVoice[] {
  const cloningEngines: NovaTTSEngine[] = ['xtts', 'openvoice', 'tortoise', 'coqui'];
  return ALL_VOICES.filter(v => cloningEngines.includes(v.engine));
}

/**
 * Get free voices (no cloud API costs)
 */
export function getFreeVoices(): NovaTTSVoice[] {
  // Edge TTS is free, and all local models are free to use
  return ALL_VOICES.filter(v => v.engine !== 'edge' || v.tags.includes('free'));
}

/**
 * Search voices by tag or name
 */
export function searchVoices(query: string): NovaTTSVoice[] {
  const lowerQuery = query.toLowerCase();
  return ALL_VOICES.filter(v => 
    v.name.toLowerCase().includes(lowerQuery) ||
    v.description?.toLowerCase().includes(lowerQuery) ||
    v.tags.some(t => t.toLowerCase().includes(lowerQuery))
  );
}
