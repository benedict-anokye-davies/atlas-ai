/**
 * Atlas Desktop - Feature Detection System
 * 
 * Unified feature availability detection with graceful degradation.
 * Shows which features are available/degraded in UI and provides
 * clear guidance on how to enable missing features.
 * 
 * @module utils/feature-detection
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from './logger';
import { getErrorMessage } from '../../shared/utils';

const logger = createModuleLogger('FeatureDetection');

// ============================================================================
// Types
// ============================================================================

export type FeatureName =
  | 'wake-word'
  | 'online-stt'
  | 'offline-stt'
  | 'online-tts'
  | 'offline-tts'
  | 'online-llm'
  | 'offline-llm'
  | 'screen-capture'
  | 'ocr'
  | 'media-control'
  | 'browser-automation'
  | 'git-tools'
  | 'calendar'
  | 'spotify';

export type FeatureStatus = 'available' | 'degraded' | 'unavailable' | 'unknown';

export interface FeatureInfo {
  name: FeatureName;
  displayName: string;
  description: string;
  status: FeatureStatus;
  degradedReason?: string;
  unavailableReason?: string;
  requiredConfig?: string[];
  enableGuide?: string;
  fallbackFeature?: FeatureName;
}

export interface FeatureCheckResult {
  available: boolean;
  reason?: string;
  fallback?: FeatureName;
}

export type FeatureChecker = () => Promise<FeatureCheckResult> | FeatureCheckResult;

// ============================================================================
// Feature Definitions
// ============================================================================

const FEATURE_DEFINITIONS: Record<FeatureName, Omit<FeatureInfo, 'status' | 'degradedReason' | 'unavailableReason'>> = {
  'wake-word': {
    name: 'wake-word',
    displayName: 'Wake Word Detection',
    description: 'Say "Hey Atlas" to activate voice input',
    requiredConfig: ['PORCUPINE_API_KEY'],
    enableGuide: 'Get a free API key from https://console.picovoice.ai/',
  },
  'online-stt': {
    name: 'online-stt',
    displayName: 'Online Speech Recognition',
    description: 'High-accuracy cloud-based speech-to-text via Deepgram',
    requiredConfig: ['DEEPGRAM_API_KEY'],
    enableGuide: 'Get an API key from https://console.deepgram.com/',
    fallbackFeature: 'offline-stt',
  },
  'offline-stt': {
    name: 'offline-stt',
    displayName: 'Offline Speech Recognition',
    description: 'Local speech-to-text via Vosk (works without internet)',
    enableGuide: 'Vosk models are downloaded automatically on first use',
  },
  'online-tts': {
    name: 'online-tts',
    displayName: 'Online Text-to-Speech',
    description: 'Premium voices via Cartesia (~90ms latency) or ElevenLabs',
    requiredConfig: ['CARTESIA_API_KEY', 'ELEVENLABS_API_KEY'],  // Either one works
    enableGuide: 'Get an API key from https://cartesia.ai/ (fastest) or https://elevenlabs.io/',
    fallbackFeature: 'offline-tts',
  },
  'offline-tts': {
    name: 'offline-tts',
    displayName: 'Offline Text-to-Speech',
    description: 'Local text-to-speech via Piper',
    enableGuide: 'Piper is bundled with Atlas and works offline',
  },
  'online-llm': {
    name: 'online-llm',
    displayName: 'Online AI (LLM)',
    description: 'Cloud-based language model via Fireworks AI (GLM-4.7 Thinking)',
    requiredConfig: ['FIREWORKS_API_KEY'],
    enableGuide: 'Get an API key from https://fireworks.ai/',
    fallbackFeature: 'offline-llm',
  },
  'offline-llm': {
    name: 'offline-llm',
    displayName: 'Offline AI (LLM)',
    description: 'Local language model via Ollama',
    enableGuide: 'Install Ollama from https://ollama.ai/ and run "ollama pull llama2"',
  },
  'screen-capture': {
    name: 'screen-capture',
    displayName: 'Screen Capture',
    description: 'Capture screenshots for analysis',
    enableGuide: 'Grant screen recording permission in system settings',
  },
  'ocr': {
    name: 'ocr',
    displayName: 'Text Recognition (OCR)',
    description: 'Extract text from images and screenshots',
    enableGuide: 'OCR is powered by Tesseract.js and works locally',
  },
  'media-control': {
    name: 'media-control',
    displayName: 'Media Control',
    description: 'Control music playback via system media keys',
    enableGuide: 'Media control works automatically on Windows',
  },
  'browser-automation': {
    name: 'browser-automation',
    displayName: 'Browser Automation',
    description: 'Control web browsers via Chrome DevTools Protocol',
    enableGuide: 'Requires Chrome or Brave browser installed',
  },
  'git-tools': {
    name: 'git-tools',
    displayName: 'Git Integration',
    description: 'Manage Git repositories with voice commands',
    enableGuide: 'Requires Git to be installed and available in PATH',
  },
  'calendar': {
    name: 'calendar',
    displayName: 'Calendar Integration',
    description: 'View and manage calendar events',
    enableGuide: 'Connect your Google or Microsoft calendar in Settings',
  },
  'spotify': {
    name: 'spotify',
    displayName: 'Spotify Control',
    description: 'Control Spotify playback',
    enableGuide: 'Spotify developer registrations are currently paused. Use media control instead.',
    fallbackFeature: 'media-control',
  },
};

// ============================================================================
// Feature Detection System
// ============================================================================

export class FeatureDetectionSystem extends EventEmitter {
  private featureStatus: Map<FeatureName, FeatureInfo> = new Map();
  private featureCheckers: Map<FeatureName, FeatureChecker> = new Map();
  private checkInProgress = false;

  constructor() {
    super();

    // Initialize all features as unknown
    for (const [name, definition] of Object.entries(FEATURE_DEFINITIONS)) {
      this.featureStatus.set(name as FeatureName, {
        ...definition,
        status: 'unknown',
      });
    }
  }

  /**
   * Register a checker function for a feature
   */
  registerChecker(feature: FeatureName, checker: FeatureChecker): void {
    this.featureCheckers.set(feature, checker);
  }

  /**
   * Check availability of a single feature
   */
  async checkFeature(feature: FeatureName): Promise<FeatureInfo> {
    const info = this.featureStatus.get(feature)!;
    const checker = this.featureCheckers.get(feature);

    if (!checker) {
      // No checker registered, assume available
      info.status = 'available';
      return info;
    }

    try {
      const result = await checker();

      if (result.available) {
        info.status = 'available';
        info.degradedReason = undefined;
        info.unavailableReason = undefined;
      } else {
        // Check if there's a fallback
        const fallback = result.fallback || info.fallbackFeature;
        
        if (fallback) {
          const fallbackInfo = await this.checkFeature(fallback);
          
          if (fallbackInfo.status === 'available') {
            info.status = 'degraded';
            info.degradedReason = `${result.reason}. Using ${FEATURE_DEFINITIONS[fallback].displayName} instead.`;
          } else {
            info.status = 'unavailable';
            info.unavailableReason = result.reason;
          }
        } else {
          info.status = 'unavailable';
          info.unavailableReason = result.reason;
        }
      }
    } catch (error) {
      info.status = 'unavailable';
      info.unavailableReason = getErrorMessage(error);
    }

    this.emit('feature-checked', info);
    return info;
  }

  /**
   * Check availability of all features
   */
  async checkAllFeatures(): Promise<FeatureInfo[]> {
    if (this.checkInProgress) {
      logger.warn('Feature check already in progress');
      return this.getAllFeatures();
    }

    this.checkInProgress = true;
    logger.info('Checking all feature availability...');

    const results: FeatureInfo[] = [];

    for (const feature of this.featureStatus.keys()) {
      const info = await this.checkFeature(feature);
      results.push(info);
    }

    this.checkInProgress = false;
    this.emit('all-features-checked', results);

    // Log summary
    const available = results.filter((f) => f.status === 'available').length;
    const degraded = results.filter((f) => f.status === 'degraded').length;
    const unavailable = results.filter((f) => f.status === 'unavailable').length;

    logger.info('Feature availability check complete', {
      available,
      degraded,
      unavailable,
      total: results.length,
    });

    return results;
  }

  /**
   * Get current status of a feature
   */
  getFeature(feature: FeatureName): FeatureInfo {
    return this.featureStatus.get(feature)!;
  }

  /**
   * Get all feature statuses
   */
  getAllFeatures(): FeatureInfo[] {
    return Array.from(this.featureStatus.values());
  }

  /**
   * Get available features
   */
  getAvailableFeatures(): FeatureInfo[] {
    return this.getAllFeatures().filter((f) => f.status === 'available');
  }

  /**
   * Get degraded features
   */
  getDegradedFeatures(): FeatureInfo[] {
    return this.getAllFeatures().filter((f) => f.status === 'degraded');
  }

  /**
   * Get unavailable features
   */
  getUnavailableFeatures(): FeatureInfo[] {
    return this.getAllFeatures().filter((f) => f.status === 'unavailable');
  }

  /**
   * Check if a feature is usable (available or degraded)
   */
  isFeatureUsable(feature: FeatureName): boolean {
    const info = this.featureStatus.get(feature);
    return info?.status === 'available' || info?.status === 'degraded';
  }

  /**
   * Get a summary for display
   */
  getSummary(): {
    available: number;
    degraded: number;
    unavailable: number;
    unknown: number;
    features: FeatureInfo[];
  } {
    const features = this.getAllFeatures();

    return {
      available: features.filter((f) => f.status === 'available').length,
      degraded: features.filter((f) => f.status === 'degraded').length,
      unavailable: features.filter((f) => f.status === 'unavailable').length,
      unknown: features.filter((f) => f.status === 'unknown').length,
      features,
    };
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let featureDetection: FeatureDetectionSystem | null = null;

/**
 * Get the feature detection system instance
 */
export function getFeatureDetection(): FeatureDetectionSystem {
  if (!featureDetection) {
    featureDetection = new FeatureDetectionSystem();
  }
  return featureDetection;
}

/**
 * Shutdown the feature detection system
 */
export function shutdownFeatureDetection(): void {
  if (featureDetection) {
    featureDetection.removeAllListeners();
    featureDetection = null;
  }
}

export { FeatureDetectionSystem as default };
