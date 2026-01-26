/**
 * HuBERT Emotion Detection Module
 * T5-207: Detect emotions from voice using HuBERT-based models
 *
 * Uses HuBERT-large fine-tuned on SUPERB emotion recognition task
 * via Python subprocess for:
 * - Real-time emotion detection from audio
 * - Emotion history tracking per speaker
 * - Confidence scores for each emotion
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { PythonShell, Options as PythonOptions } from 'python-shell';
import { EventEmitter } from 'events';
import { createModuleLogger } from '../../utils/logger';

const logger = createModuleLogger('EmotionDetector');

// ============================================================================
// Emotion Types
// ============================================================================

/**
 * Detected emotion categories
 * Based on SUPERB emotion recognition categories
 */
export type EmotionCategory =
  | 'happy'
  | 'sad'
  | 'angry'
  | 'fearful'
  | 'surprised'
  | 'disgusted'
  | 'neutral'
  | 'stressed'
  | 'tired'
  | 'frustrated';

/**
 * Emotion detection result
 */
export interface EmotionResult {
  /** Primary detected emotion */
  emotion: EmotionCategory;
  /** Confidence score (0-1) */
  confidence: number;
  /** All emotion probabilities */
  probabilities: Record<EmotionCategory, number>;
  /** Speaker ID if known */
  speakerId?: string;
  /** Timestamp of detection */
  timestamp: Date;
  /** Audio duration analyzed (ms) */
  audioDurationMs: number;
  /** Arousal level (0-1, low to high energy) */
  arousal: number;
  /** Valence level (-1 to 1, negative to positive) */
  valence: number;
}

/**
 * Emotion history entry
 */
export interface EmotionHistoryEntry {
  result: EmotionResult;
  context?: string;
}

/**
 * Emotion detector configuration
 */
export interface EmotionDetectorConfig {
  /** Minimum audio duration for detection (ms) */
  minAudioDurationMs: number;
  /** Maximum audio duration to process (ms) */
  maxAudioDurationMs: number;
  /** Minimum confidence to report emotion */
  minConfidence: number;
  /** History size per speaker */
  historySize: number;
  /** Python executable path */
  pythonPath: string;
  /** HuggingFace token for model access */
  hfToken?: string;
}

/**
 * Default emotion detector configuration
 */
export const DEFAULT_EMOTION_CONFIG: EmotionDetectorConfig = {
  minAudioDurationMs: 500,
  maxAudioDurationMs: 30000,
  minConfidence: 0.3,
  historySize: 100,
  pythonPath: 'python',
  hfToken: undefined,
};

/**
 * Emotion detector events
 */
export interface EmotionDetectorEvents {
  initialized: () => void;
  error: (error: Error) => void;
  'emotion:detected': (result: EmotionResult) => void;
  'emotion:changed': (from: EmotionCategory, to: EmotionCategory, speakerId?: string) => void;
}

// ============================================================================
// Response Adjustments
// ============================================================================

/**
 * Response adjustment based on detected emotion
 */
export interface EmotionResponseAdjustment {
  /** Suggested tone for Atlas response */
  tone: 'calm' | 'energetic' | 'gentle' | 'patient' | 'celebratory' | 'neutral';
  /** Speaking rate adjustment (-1 to 1, slower to faster) */
  speakingRateAdjust: number;
  /** Response verbosity ('concise' | 'normal' | 'detailed') */
  verbosity: 'concise' | 'normal' | 'detailed';
  /** Suggested behaviors */
  behaviors: string[];
  /** Suggested phrases to use/avoid */
  phraseSuggestions: {
    use: string[];
    avoid: string[];
  };
}

/**
 * Get response adjustment based on emotion
 */
export function getEmotionResponseAdjustment(emotion: EmotionCategory): EmotionResponseAdjustment {
  switch (emotion) {
    case 'happy':
      return {
        tone: 'energetic',
        speakingRateAdjust: 0.1,
        verbosity: 'normal',
        behaviors: ['match energy', 'celebrate achievements', 'use positive language'],
        phraseSuggestions: {
          use: ["That's great!", 'Awesome!', 'I love that energy!'],
          avoid: ['calm down', "let's be serious"],
        },
      };

    case 'sad':
      return {
        tone: 'gentle',
        speakingRateAdjust: -0.15,
        verbosity: 'concise',
        behaviors: ['be supportive', 'offer help', 'acknowledge feelings'],
        phraseSuggestions: {
          use: ["I'm here for you", 'Take your time', 'How can I help?'],
          avoid: ['cheer up', "it's not that bad", 'look on the bright side'],
        },
      };

    case 'angry':
    case 'frustrated':
      return {
        tone: 'patient',
        speakingRateAdjust: -0.1,
        verbosity: 'concise',
        behaviors: ['stay calm', 'focus on solutions', "don't escalate", 'acknowledge frustration'],
        phraseSuggestions: {
          use: ['I understand', "Let's solve this", 'What would help?'],
          avoid: ['calm down', 'relax', "it's not a big deal"],
        },
      };

    case 'stressed':
      return {
        tone: 'calm',
        speakingRateAdjust: -0.2,
        verbosity: 'concise',
        behaviors: ['be reassuring', 'offer to help prioritize', 'reduce complexity'],
        phraseSuggestions: {
          use: ["Let's take this one step at a time", 'I can help with that', "Don't worry"],
          avoid: ['you need to', 'hurry', 'urgently'],
        },
      };

    case 'tired':
      return {
        tone: 'gentle',
        speakingRateAdjust: -0.15,
        verbosity: 'concise',
        behaviors: ['keep responses short', 'offer to handle tasks', 'suggest breaks'],
        phraseSuggestions: {
          use: ["I'll take care of it", 'Would you like a quick summary?', 'Rest well'],
          avoid: ['one more thing', 'also', 'in addition'],
        },
      };

    case 'fearful':
      return {
        tone: 'calm',
        speakingRateAdjust: -0.15,
        verbosity: 'normal',
        behaviors: ['be reassuring', 'provide information', 'offer support'],
        phraseSuggestions: {
          use: ["It's going to be okay", "I'm here to help", "Let's figure this out together"],
          avoid: ['worry', 'dangerous', 'risky'],
        },
      };

    case 'surprised':
      return {
        tone: 'energetic',
        speakingRateAdjust: 0,
        verbosity: 'normal',
        behaviors: ['acknowledge surprise', 'provide context', 'be helpful'],
        phraseSuggestions: {
          use: ['Yes!', 'Exactly!', 'Let me explain'],
          avoid: [],
        },
      };

    case 'disgusted':
      return {
        tone: 'neutral',
        speakingRateAdjust: 0,
        verbosity: 'concise',
        behaviors: ['acknowledge feeling', 'offer alternatives', 'be matter-of-fact'],
        phraseSuggestions: {
          use: ['I understand', 'Would you prefer...', "Let's try something else"],
          avoid: [],
        },
      };

    case 'neutral':
    default:
      return {
        tone: 'neutral',
        speakingRateAdjust: 0,
        verbosity: 'normal',
        behaviors: ['be helpful', 'be efficient'],
        phraseSuggestions: {
          use: [],
          avoid: [],
        },
      };
  }
}

// ============================================================================
// Emotion Detector Class
// ============================================================================

/**
 * HuBERT-based emotion detector
 * Uses Python subprocess to run the HuBERT model
 */
export class EmotionDetector extends EventEmitter {
  private config: EmotionDetectorConfig;
  private scriptsDir: string;
  private modelsDir: string;
  private isInitialized: boolean = false;
  private initPromise: Promise<void> | null = null;
  private history: Map<string, EmotionHistoryEntry[]> = new Map();
  private lastEmotions: Map<string, EmotionCategory> = new Map();

  constructor(config?: Partial<EmotionDetectorConfig>) {
    super();
    this.config = { ...DEFAULT_EMOTION_CONFIG, ...config };

    const userDataPath = app?.getPath?.('userData') || path.join(process.env.HOME || '', '.atlas');
    this.scriptsDir = path.join(userDataPath, 'ml', 'scripts');
    this.modelsDir = path.join(userDataPath, 'ml', 'models');

    this.ensureDirectories();
  }

  private ensureDirectories(): void {
    [this.scriptsDir, this.modelsDir].forEach((dir) => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }

  /**
   * Initialize the emotion detector
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this.doInitialize();
    return this.initPromise;
  }

  private async doInitialize(): Promise<void> {
    try {
      // Create Python script
      await this.createPythonScripts();

      // Test Python and dependencies
      await this.testPython();

      this.isInitialized = true;
      this.emit('initialized');
      logger.info('EmotionDetector initialized');
    } catch (error) {
      this.emit('error', error as Error);
      logger.error('Failed to initialize EmotionDetector', { error });
      throw error;
    }
  }

  /**
   * Create Python scripts for emotion detection
   */
  private async createPythonScripts(): Promise<void> {
    const emotionScript = `
"""
HuBERT Emotion Detection
Uses HuBERT-large fine-tuned on SUPERB emotion recognition
"""
import sys
import json
import numpy as np

# Model loading
EMOTION_MODEL = None
FEATURE_EXTRACTOR = None
DEVICE = None

# Emotion mapping from model output
EMOTION_MAP = {
    0: 'angry',
    1: 'happy',
    2: 'neutral',
    3: 'sad',
    4: 'fearful',
    5: 'surprised',
    6: 'disgusted',
}

# Extended emotions derived from base emotions + acoustic features
EXTENDED_EMOTIONS = ['stressed', 'tired', 'frustrated']

def load_model(hf_token=None):
    """Load HuBERT emotion model."""
    global EMOTION_MODEL, FEATURE_EXTRACTOR, DEVICE
    
    if EMOTION_MODEL is not None:
        return True
    
    try:
        import torch
        from transformers import Wav2Vec2FeatureExtractor, HubertForSequenceClassification
        
        DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
        
        # Use HuBERT-large fine-tuned for emotion recognition
        model_name = "superb/hubert-large-superb-er"
        
        FEATURE_EXTRACTOR = Wav2Vec2FeatureExtractor.from_pretrained(
            model_name,
            use_auth_token=hf_token
        )
        
        EMOTION_MODEL = HubertForSequenceClassification.from_pretrained(
            model_name,
            use_auth_token=hf_token
        ).to(DEVICE)
        
        EMOTION_MODEL.eval()
        
        return True
    except Exception as e:
        raise RuntimeError(f"Failed to load emotion model: {e}")

def detect_emotion(audio_path, hf_token=None):
    """Detect emotion from audio file."""
    import torch
    import librosa
    
    load_model(hf_token)
    
    # Load audio
    audio, sr = librosa.load(audio_path, sr=16000)
    duration_ms = len(audio) / sr * 1000
    
    # Extract features
    inputs = FEATURE_EXTRACTOR(
        audio,
        sampling_rate=16000,
        return_tensors="pt",
        padding=True
    ).to(DEVICE)
    
    # Get predictions
    with torch.no_grad():
        outputs = EMOTION_MODEL(**inputs)
        logits = outputs.logits
        probs = torch.softmax(logits, dim=-1)[0].cpu().numpy()
    
    # Map to emotion categories
    probabilities = {}
    for idx, prob in enumerate(probs):
        if idx in EMOTION_MAP:
            probabilities[EMOTION_MAP[idx]] = float(prob)
    
    # Get primary emotion
    primary_idx = int(np.argmax(probs))
    primary_emotion = EMOTION_MAP.get(primary_idx, 'neutral')
    confidence = float(probs[primary_idx])
    
    # Calculate arousal and valence
    # Arousal: how energetic/activated the emotion is
    # Valence: how positive/negative the emotion is
    arousal = calculate_arousal(probabilities)
    valence = calculate_valence(probabilities)
    
    # Detect extended emotions based on acoustic features and context
    extended = detect_extended_emotions(audio, sr, probabilities, arousal, valence)
    
    # Merge extended emotions into probabilities
    for ext_emotion, ext_prob in extended.items():
        probabilities[ext_emotion] = ext_prob
    
    # Check if extended emotion should be primary
    for ext_emotion, ext_prob in extended.items():
        if ext_prob > confidence:
            primary_emotion = ext_emotion
            confidence = ext_prob
    
    return {
        'emotion': primary_emotion,
        'confidence': confidence,
        'probabilities': probabilities,
        'arousal': arousal,
        'valence': valence,
        'audioDurationMs': duration_ms,
    }

def calculate_arousal(probabilities):
    """Calculate arousal level from emotion probabilities."""
    # High arousal emotions
    high_arousal = probabilities.get('angry', 0) + probabilities.get('surprised', 0) + probabilities.get('happy', 0) * 0.7
    # Low arousal emotions
    low_arousal = probabilities.get('sad', 0) + probabilities.get('neutral', 0) * 0.5
    
    return float(np.clip((high_arousal - low_arousal + 1) / 2, 0, 1))

def calculate_valence(probabilities):
    """Calculate valence level from emotion probabilities."""
    # Positive emotions
    positive = probabilities.get('happy', 0) + probabilities.get('surprised', 0) * 0.5
    # Negative emotions
    negative = probabilities.get('angry', 0) + probabilities.get('sad', 0) + probabilities.get('fearful', 0) + probabilities.get('disgusted', 0)
    
    return float(np.clip(positive - negative, -1, 1))

def detect_extended_emotions(audio, sr, base_probs, arousal, valence):
    """Detect extended emotions from acoustic features."""
    import librosa
    
    extended = {}
    
    # Calculate acoustic features
    rms = np.mean(librosa.feature.rms(y=audio))
    zcr = np.mean(librosa.feature.zero_crossing_rate(audio))
    tempo, _ = librosa.beat.beat_track(y=audio, sr=sr)
    spectral_centroid = np.mean(librosa.feature.spectral_centroid(y=audio, sr=sr))
    
    # Stressed: high arousal, negative valence, high speech rate
    if arousal > 0.6 and valence < 0 and tempo > 120:
        stress_prob = 0.3 + (arousal - 0.5) * 0.4 + (-valence) * 0.3
        extended['stressed'] = float(np.clip(stress_prob, 0, 1))
    else:
        extended['stressed'] = 0.0
    
    # Tired: low energy (rms), low arousal, slower speech
    if rms < 0.05 and arousal < 0.4 and tempo < 100:
        tired_prob = 0.3 + (0.5 - arousal) * 0.4 + (0.05 - rms) * 10
        extended['tired'] = float(np.clip(tired_prob, 0, 1))
    else:
        extended['tired'] = 0.0
    
    # Frustrated: mix of anger and sadness with repeated patterns
    if base_probs.get('angry', 0) > 0.2 and (base_probs.get('sad', 0) > 0.1 or valence < -0.2):
        frustrated_prob = base_probs.get('angry', 0) * 0.5 + abs(valence) * 0.3 + 0.2
        extended['frustrated'] = float(np.clip(frustrated_prob, 0, 1))
    else:
        extended['frustrated'] = 0.0
    
    return extended

if __name__ == '__main__':
    import argparse
    
    parser = argparse.ArgumentParser()
    parser.add_argument('--command', required=True, choices=['detect', 'test'])
    parser.add_argument('--audio', help='Path to audio file')
    parser.add_argument('--hf-token', help='HuggingFace token')
    
    args = parser.parse_args()
    
    try:
        if args.command == 'detect':
            result = detect_emotion(args.audio, args.hf_token)
            print(json.dumps({'success': True, **result}))
        
        elif args.command == 'test':
            load_model(args.hf_token)
            print(json.dumps({'success': True, 'message': 'Model loaded successfully'}))
    
    except Exception as e:
        print(json.dumps({'success': False, 'error': str(e)}))
        sys.exit(1)
`;

    fs.writeFileSync(path.join(this.scriptsDir, 'hubert_emotion.py'), emotionScript);
    logger.info('Emotion detection Python scripts created');
  }

  /**
   * Test Python installation
   */
  private async testPython(): Promise<void> {
    try {
      await PythonShell.runString('print("ok")', { pythonPath: this.config.pythonPath });
    } catch (err) {
      throw new Error(`Python not available: ${(err as Error).message}`);
    }
  }

  /**
   * Detect emotion from audio file
   */
  async detect(audioPath: string, speakerId?: string): Promise<EmotionResult> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (!fs.existsSync(audioPath)) {
      throw new Error(`Audio file not found: ${audioPath}`);
    }

    const hfToken = this.config.hfToken || process.env.HUGGINGFACE_TOKEN || '';

    const options: PythonOptions = {
      pythonPath: this.config.pythonPath,
      scriptPath: this.scriptsDir,
      args: ['--command', 'detect', '--audio', audioPath, '--hf-token', hfToken],
    };

    const results = await PythonShell.run('hubert_emotion.py', options);
    const result = JSON.parse(results?.[results.length - 1] || '{}');

    if (result.success) {
      const emotionResult: EmotionResult = {
        emotion: result.emotion as EmotionCategory,
        confidence: result.confidence,
        probabilities: result.probabilities,
        speakerId,
        timestamp: new Date(),
        audioDurationMs: result.audioDurationMs,
        arousal: result.arousal,
        valence: result.valence,
      };

      // Add to history
      this.addToHistory(speakerId || 'unknown', emotionResult);

      // Check for emotion change
      const lastEmotion = this.lastEmotions.get(speakerId || 'unknown');
      if (lastEmotion && lastEmotion !== emotionResult.emotion) {
        this.emit('emotion:changed', lastEmotion, emotionResult.emotion, speakerId);
      }
      this.lastEmotions.set(speakerId || 'unknown', emotionResult.emotion);

      this.emit('emotion:detected', emotionResult);
      logger.info('Emotion detected', {
        emotion: emotionResult.emotion,
        confidence: emotionResult.confidence,
        speakerId,
      });

      return emotionResult;
    } else {
      throw new Error(result.error || 'Unknown error');
    }
  }

  /**
   * Detect emotion from audio buffer
   */
  async detectFromBuffer(audioBuffer: Buffer, speakerId?: string): Promise<EmotionResult> {
    // Write buffer to temp file
    const tempDir = path.join(app?.getPath?.('userData') || process.cwd(), 'temp', 'emotion');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const tempPath = path.join(
      tempDir,
      `emotion_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.wav`
    );

    try {
      fs.writeFileSync(tempPath, audioBuffer);
      return await this.detect(tempPath, speakerId);
    } finally {
      // Cleanup temp file
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    }
  }

  /**
   * Add emotion result to history
   */
  private addToHistory(speakerId: string, result: EmotionResult): void {
    if (!this.history.has(speakerId)) {
      this.history.set(speakerId, []);
    }

    const history = this.history.get(speakerId)!;
    history.push({ result });

    // Trim history if too long
    while (history.length > this.config.historySize) {
      history.shift();
    }
  }

  /**
   * Get emotion history for a speaker
   */
  getEmotionHistory(speakerId: string, count?: number): EmotionResult[] {
    const history = this.history.get(speakerId) || [];
    const results = history.map((h) => h.result);
    return count ? results.slice(-count) : results;
  }

  /**
   * Get the most frequent emotion for a speaker
   */
  getDominantEmotion(speakerId: string): EmotionCategory | null {
    const history = this.getEmotionHistory(speakerId);
    if (history.length === 0) return null;

    const counts: Record<string, number> = {};
    for (const entry of history) {
      counts[entry.emotion] = (counts[entry.emotion] || 0) + 1;
    }

    let maxCount = 0;
    let dominant: EmotionCategory | null = null;
    for (const [emotion, count] of Object.entries(counts)) {
      if (count > maxCount) {
        maxCount = count;
        dominant = emotion as EmotionCategory;
      }
    }

    return dominant;
  }

  /**
   * Get average arousal and valence for a speaker
   */
  getAverageAffect(speakerId: string): { arousal: number; valence: number } | null {
    const history = this.getEmotionHistory(speakerId);
    if (history.length === 0) return null;

    const avgArousal = history.reduce((sum, h) => sum + h.arousal, 0) / history.length;
    const avgValence = history.reduce((sum, h) => sum + h.valence, 0) / history.length;

    return { arousal: avgArousal, valence: avgValence };
  }

  /**
   * Get response adjustment for current/last emotion
   */
  getResponseAdjustment(speakerId?: string): EmotionResponseAdjustment {
    const emotion = this.lastEmotions.get(speakerId || 'unknown') || 'neutral';
    return getEmotionResponseAdjustment(emotion);
  }

  /**
   * Get last detected emotion for a speaker
   */
  getLastEmotion(speakerId: string): EmotionCategory | undefined {
    return this.lastEmotions.get(speakerId);
  }

  /**
   * Clear history for a speaker
   */
  clearHistory(speakerId: string): void {
    this.history.delete(speakerId);
    this.lastEmotions.delete(speakerId);
  }

  /**
   * Clear all history
   */
  clearAllHistory(): void {
    this.history.clear();
    this.lastEmotions.clear();
  }

  /**
   * Check if detector is configured
   */
  isConfigured(): boolean {
    return !!(this.config.hfToken || process.env.HUGGINGFACE_TOKEN);
  }

  /**
   * Set Python path
   */
  setPythonPath(pythonPath: string): void {
    this.config.pythonPath = pythonPath;
  }

  /**
   * Get emotion trend (improving, worsening, stable)
   */
  getEmotionTrend(speakerId: string, windowSize: number = 5): 'improving' | 'worsening' | 'stable' {
    const history = this.getEmotionHistory(speakerId, windowSize * 2);
    if (history.length < windowSize * 2) return 'stable';

    const recentHalf = history.slice(-windowSize);
    const olderHalf = history.slice(0, windowSize);

    const recentValence = recentHalf.reduce((sum, h) => sum + h.valence, 0) / windowSize;
    const olderValence = olderHalf.reduce((sum, h) => sum + h.valence, 0) / windowSize;

    const diff = recentValence - olderValence;
    if (diff > 0.2) return 'improving';
    if (diff < -0.2) return 'worsening';
    return 'stable';
  }
}

// ============================================================================
// Singleton
// ============================================================================

let emotionDetector: EmotionDetector | null = null;

/**
 * Get or create the EmotionDetector instance
 */
export function getEmotionDetector(config?: Partial<EmotionDetectorConfig>): EmotionDetector {
  if (!emotionDetector) {
    emotionDetector = new EmotionDetector(config);
  }
  return emotionDetector;
}

/**
 * Cleanup emotion detector
 */
export function cleanupEmotionDetector(): void {
  if (emotionDetector) {
    emotionDetector.clearAllHistory();
    emotionDetector = null;
  }
}
