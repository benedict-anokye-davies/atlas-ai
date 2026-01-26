/**
 * Atlas Voice Enrollment Module
 * Guided voice enrollment flow for creating voiceprints
 *
 * Features:
 * - 3-sample enrollment process with quality validation
 * - Real-time feedback during sample collection
 * - Consistency checking between samples
 * - Guided prompts for optimal enrollment
 * - Support for re-enrollment and voiceprint updates
 *
 * ENROLLMENT FLOW:
 * 1. Start session - initialize enrollment for user
 * 2. Collect samples - record 3 voice samples with prompts
 * 3. Validate samples - check quality and consistency
 * 4. Create voiceprint - average embeddings into template
 * 5. Register - store voiceprint and create user profile
 */

import { EventEmitter } from 'events';
import { sendToMainWindow } from '../utils/main-window';
import { createModuleLogger, PerformanceTimer } from '../utils/logger';
import { getVoiceIdManager, VoiceIdManager } from './voice-id';
import {
  EnrollmentSession,
  EnrollmentSample,
  EnrollmentProgress,
  EnrollmentResult,
  EnrollmentConfig,
  Voiceprint,
  VoiceUserProfile,
  VoiceEmbedding,
  VoiceUserPreferences,
  DEFAULT_ENROLLMENT_CONFIG,
} from '../../shared/types/voice-biometrics';

const logger = createModuleLogger('VoiceEnrollment');
const perfTimer = new PerformanceTimer('VoiceEnrollment');

// ============================================================================
// Enrollment Manager Events
// ============================================================================

/**
 * Enrollment manager events
 */
export interface EnrollmentManagerEvents {
  /** Session started */
  'session-started': (session: EnrollmentSession) => void;
  /** Progress update */
  progress: (progress: EnrollmentProgress) => void;
  /** Sample collected */
  'sample-collected': (sample: EnrollmentSample) => void;
  /** Sample rejected */
  'sample-rejected': (reason: string, sampleIndex: number) => void;
  /** Enrollment completed successfully */
  'enrollment-complete': (result: EnrollmentResult) => void;
  /** Enrollment failed */
  'enrollment-failed': (error: string) => void;
  /** Session cancelled */
  'session-cancelled': (sessionId: string) => void;
  /** Error occurred */
  error: (error: Error, context: string) => void;
}

// ============================================================================
// Enrollment Manager
// ============================================================================

/**
 * Voice enrollment manager
 * Handles the guided enrollment flow for creating voiceprints
 */
export class VoiceEnrollmentManager extends EventEmitter {
  private config: EnrollmentConfig;
  private voiceIdManager: VoiceIdManager;
  private currentSession: EnrollmentSession | null = null;
  private isProcessing: boolean = false;

  constructor(config?: Partial<EnrollmentConfig>) {
    super();
    this.config = { ...DEFAULT_ENROLLMENT_CONFIG, ...config };
    this.voiceIdManager = getVoiceIdManager();

    logger.info('VoiceEnrollmentManager created', {
      requiredSamples: this.config.requiredSamples,
      minSampleDuration: this.config.minSampleDurationMs,
    });
  }

  /**
   * Start a new enrollment session
   */
  async startSession(userId: string, userName: string): Promise<EnrollmentSession> {
    // Cancel any existing session
    if (this.currentSession) {
      await this.cancelSession();
    }

    const sessionId = `enroll-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    this.currentSession = {
      sessionId,
      userId,
      userName,
      stage: 'collecting_samples',
      samples: [],
      requiredSamples: this.config.requiredSamples,
      startedAt: Date.now(),
      timeoutMs: this.config.sessionTimeoutMs,
      status: 'waiting_for_speech',
    };

    logger.info('Enrollment session started', {
      sessionId,
      userId,
      userName,
      requiredSamples: this.config.requiredSamples,
    });

    this.emit('session-started', this.currentSession);
    this.emitProgress('Ready to begin voice enrollment. Please follow the prompts.');

    // Send first prompt
    this.sendPromptToRenderer(0);

    return this.currentSession;
  }

  /**
   * Submit a voice sample for enrollment
   */
  async submitSample(audio: Float32Array, sampleRate: number = 16000): Promise<boolean> {
    if (!this.currentSession) {
      throw new Error('No enrollment session active');
    }

    if (this.isProcessing) {
      logger.warn('Already processing a sample, please wait');
      return false;
    }

    if (this.currentSession.stage !== 'collecting_samples') {
      throw new Error(`Cannot submit sample in stage: ${this.currentSession.stage}`);
    }

    this.isProcessing = true;
    this.currentSession.status = 'processing_sample';
    const sampleIndex = this.currentSession.samples.length + 1;

    perfTimer.start(`sample-${sampleIndex}`);

    try {
      // Validate audio duration
      const durationMs = (audio.length / sampleRate) * 1000;

      if (durationMs < this.config.minSampleDurationMs) {
        this.rejectSample(
          `Sample too short: ${durationMs.toFixed(0)}ms (minimum ${this.config.minSampleDurationMs}ms)`,
          sampleIndex
        );
        return false;
      }

      if (durationMs > this.config.maxSampleDurationMs) {
        // Trim to max duration
        const maxSamples = Math.floor((this.config.maxSampleDurationMs / 1000) * sampleRate);
        audio = audio.slice(0, maxSamples);
      }

      // Extract embedding
      const embedding = await this.voiceIdManager.extractEmbedding(audio, sampleRate);

      // Check quality
      if (embedding.qualityScore < this.config.minSampleQuality) {
        this.rejectSample(
          `Audio quality too low (${(embedding.qualityScore * 100).toFixed(0)}%). Please speak more clearly.`,
          sampleIndex
        );
        return false;
      }

      // Check consistency with previous samples
      if (this.currentSession.samples.length > 0) {
        const consistencyResult = this.checkSampleConsistency(embedding);
        if (!consistencyResult.isConsistent) {
          this.rejectSample(
            consistencyResult.reason || 'Sample inconsistent with previous samples',
            sampleIndex
          );
          return false;
        }
      }

      // Create sample record
      const sample: EnrollmentSample = {
        index: sampleIndex,
        audio,
        durationMs,
        embedding,
        qualityScore: embedding.qualityScore,
        timestamp: Date.now(),
        promptText: this.config.enrollmentPrompts[sampleIndex - 1] || 'Please speak naturally',
        isValid: true,
      };

      // Add to session
      this.currentSession.samples.push(sample);
      this.currentSession.status = 'sample_accepted';

      const processingTime = perfTimer.end(`sample-${sampleIndex}`);

      logger.info('Sample accepted', {
        sampleIndex,
        durationMs: durationMs.toFixed(0),
        qualityScore: embedding.qualityScore.toFixed(2),
        processingTimeMs: processingTime.toFixed(0),
      });

      this.emit('sample-collected', sample);

      // Check if we have all samples
      if (this.currentSession.samples.length >= this.config.requiredSamples) {
        await this.finalizeEnrollment();
      } else {
        // Prompt for next sample
        this.currentSession.status = 'waiting_for_speech';
        const nextIndex = this.currentSession.samples.length;
        this.sendPromptToRenderer(nextIndex);
        this.emitProgress(
          `Sample ${sampleIndex} recorded. ${this.config.requiredSamples - sampleIndex} more needed.`
        );
      }

      return true;
    } catch (error) {
      perfTimer.end(`sample-${sampleIndex}`);
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('Failed to process sample', { error: err.message, sampleIndex });
      this.rejectSample(`Processing error: ${err.message}`, sampleIndex);
      this.emit('error', err, 'submitSample');
      return false;
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Check consistency of new sample with existing samples
   */
  private checkSampleConsistency(newEmbedding: VoiceEmbedding): {
    isConsistent: boolean;
    reason?: string;
  } {
    if (!this.currentSession || this.currentSession.samples.length === 0) {
      return { isConsistent: true };
    }

    // Compare with each existing sample
    let totalSimilarity = 0;
    let minSimilarity = 1;

    for (const sample of this.currentSession.samples) {
      if (!sample.embedding) continue;

      const similarity = this.cosineSimilarity(newEmbedding.vector, sample.embedding.vector);
      totalSimilarity += similarity;
      minSimilarity = Math.min(minSimilarity, similarity);
    }

    const avgSimilarity = totalSimilarity / this.currentSession.samples.length;

    // Check if new sample is too different from existing ones
    const consistencyThreshold = 1 - this.config.maxSampleVariance;

    if (minSimilarity < consistencyThreshold - 0.1) {
      return {
        isConsistent: false,
        reason: `Sample differs too much from previous samples (similarity: ${(minSimilarity * 100).toFixed(0)}%). Please ensure you're the same speaker.`,
      };
    }

    if (avgSimilarity < consistencyThreshold) {
      return {
        isConsistent: false,
        reason: `Sample not consistent enough (average similarity: ${(avgSimilarity * 100).toFixed(0)}%). Try speaking more naturally.`,
      };
    }

    return { isConsistent: true };
  }

  /**
   * Compute cosine similarity between vectors
   */
  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    return magnitude > 0 ? dotProduct / magnitude : 0;
  }

  /**
   * Reject a sample with feedback
   */
  private rejectSample(reason: string, sampleIndex: number): void {
    if (!this.currentSession) return;

    this.currentSession.status = 'sample_rejected';

    logger.warn('Sample rejected', { sampleIndex, reason });

    this.emit('sample-rejected', reason, sampleIndex);
    this.emitProgress(`Sample ${sampleIndex} rejected: ${reason}`);

    // Stay in collecting_samples stage, wait for retry
    this.currentSession.status = 'waiting_for_speech';

    // Re-send the same prompt
    this.sendPromptToRenderer(sampleIndex - 1);
  }

  /**
   * Finalize enrollment and create voiceprint
   */
  private async finalizeEnrollment(): Promise<void> {
    if (!this.currentSession) {
      throw new Error('No enrollment session active');
    }

    this.currentSession.stage = 'processing';
    this.currentSession.status = 'finalizing';
    this.emitProgress('Processing enrollment...');

    perfTimer.start('finalize');

    try {
      // Collect all embeddings
      const embeddings: VoiceEmbedding[] = [];
      for (const sample of this.currentSession.samples) {
        if (sample.embedding) {
          embeddings.push(sample.embedding);
        }
      }

      if (embeddings.length < this.config.requiredSamples) {
        throw new Error('Not enough valid samples for enrollment');
      }

      // Create voiceprint
      const avgEmbedding = this.voiceIdManager.averageEmbeddings(embeddings);
      const variance = this.voiceIdManager.computeVariance(embeddings, avgEmbedding);

      // Calculate overall quality
      const avgQuality = embeddings.reduce((sum, e) => sum + e.qualityScore, 0) / embeddings.length;

      const voiceprint: Voiceprint = {
        id: `vp-${this.currentSession.userId}-${Date.now()}`,
        userId: this.currentSession.userId,
        userName: this.currentSession.userName,
        embedding: avgEmbedding,
        enrollmentEmbeddings: embeddings,
        sampleCount: embeddings.length,
        variance,
        qualityScore: avgQuality,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isActive: true,
      };

      // Register voiceprint
      await this.voiceIdManager.registerVoiceprint(voiceprint);

      // Create user profile if it doesn't exist
      const existingProfile = this.voiceIdManager.getProfile(this.currentSession.userId);
      if (!existingProfile) {
        const profile: VoiceUserProfile = {
          id: this.currentSession.userId,
          name: this.currentSession.userName,
          voiceprint,
          preferences: this.createDefaultPreferences(),
          createdAt: Date.now(),
          identificationCount: 0,
          isPrimary: this.voiceIdManager.getProfiles().length === 0, // First user is primary
          status: 'active',
        };
        await this.voiceIdManager.registerProfile(profile);
      }

      const processingTime = perfTimer.end('finalize');

      // Create result
      const result: EnrollmentResult = {
        success: true,
        voiceprint,
        qualityScore: avgQuality,
        samplesCollected: embeddings.length,
        processingTimeMs: processingTime,
      };

      this.currentSession.stage = 'completed';
      this.currentSession.status = 'success';

      logger.info('Enrollment completed successfully', {
        userId: this.currentSession.userId,
        userName: this.currentSession.userName,
        qualityScore: avgQuality.toFixed(2),
        variance: variance.toFixed(3),
        processingTimeMs: processingTime.toFixed(0),
      });

      this.emit('enrollment-complete', result);
      this.emitProgress(
        `Enrollment complete! Your voice is now registered, ${this.currentSession.userName}.`
      );

      // Clean up session
      this.currentSession = null;
    } catch (error) {
      perfTimer.end('finalize');
      const err = error instanceof Error ? error : new Error(String(error));

      if (this.currentSession) {
        this.currentSession.stage = 'failed';
        this.currentSession.status = 'error';
        this.currentSession.errorMessage = err.message;
      }

      logger.error('Enrollment failed', { error: err.message });

      this.emit('enrollment-failed', err.message);
      this.emit('error', err, 'finalizeEnrollment');
    }
  }

  /**
   * Create default user preferences
   */
  private createDefaultPreferences(): VoiceUserPreferences {
    return {
      enablePersonalization: true,
      responseStyle: 'casual',
    };
  }

  /**
   * Cancel the current enrollment session
   */
  async cancelSession(): Promise<void> {
    if (!this.currentSession) {
      return;
    }

    const sessionId = this.currentSession.sessionId;
    this.currentSession = null;
    this.isProcessing = false;

    logger.info('Enrollment session cancelled', { sessionId });

    this.emit('session-cancelled', sessionId);
  }

  /**
   * Get current session
   */
  getSession(): EnrollmentSession | null {
    return this.currentSession ? { ...this.currentSession } : null;
  }

  /**
   * Check if enrollment is in progress
   */
  isEnrolling(): boolean {
    return this.currentSession !== null;
  }

  /**
   * Get current prompt for UI
   */
  getCurrentPrompt(): string | null {
    if (!this.currentSession) {
      return null;
    }

    const currentIndex = this.currentSession.samples.length;
    return this.config.enrollmentPrompts[currentIndex] || 'Please speak naturally';
  }

  /**
   * Get enrollment progress percentage
   */
  getProgressPercent(): number {
    if (!this.currentSession) {
      return 0;
    }

    return (this.currentSession.samples.length / this.config.requiredSamples) * 100;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<EnrollmentConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('Enrollment config updated', config);
  }

  /**
   * Get current configuration
   */
  getConfig(): EnrollmentConfig {
    return { ...this.config };
  }

  // ============================================================================
  // IPC / Renderer Communication
  // ============================================================================

  /**
   * Send prompt to renderer
   */
  private sendPromptToRenderer(promptIndex: number): void {
    const prompt = this.config.enrollmentPrompts[promptIndex] || 'Please speak naturally';

    try {
      sendToMainWindow('atlas:enrollment-prompt', {
        promptIndex,
        promptText: prompt,
        currentSample: promptIndex + 1,
        totalSamples: this.config.requiredSamples,
      });
    } catch (error) {
      logger.debug('Could not send prompt to renderer', { error });
    }
  }

  /**
   * Emit progress update
   */
  private emitProgress(message: string): void {
    if (!this.currentSession) return;

    const progress: EnrollmentProgress = {
      sessionId: this.currentSession.sessionId,
      stage: this.currentSession.stage,
      status: this.currentSession.status,
      currentSample: this.currentSession.samples.length,
      totalSamples: this.config.requiredSamples,
      progressPercent: this.getProgressPercent(),
      message,
      promptText: this.getCurrentPrompt() || undefined,
    };

    this.emit('progress', progress);

    // Send to renderer
    try {
      sendToMainWindow('atlas:enrollment-progress', progress);
    } catch (error) {
      logger.debug('Could not send progress to renderer', { error });
    }
  }

  // Type-safe event emitter methods
  on<K extends keyof EnrollmentManagerEvents>(
    event: K,
    listener: EnrollmentManagerEvents[K]
  ): this {
    return super.on(event, listener);
  }

  off<K extends keyof EnrollmentManagerEvents>(
    event: K,
    listener: EnrollmentManagerEvents[K]
  ): this {
    return super.off(event, listener);
  }

  emit<K extends keyof EnrollmentManagerEvents>(
    event: K,
    ...args: Parameters<EnrollmentManagerEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }
}

// ============================================================================
// Guided Enrollment Flow
// ============================================================================

/**
 * Start a guided enrollment flow
 * This is a higher-level API for the complete enrollment process
 */
export async function startGuidedEnrollment(
  userId: string,
  userName: string,
  options?: {
    onProgress?: (progress: EnrollmentProgress) => void;
    onPrompt?: (prompt: string, sampleIndex: number) => void;
    onComplete?: (result: EnrollmentResult) => void;
    onError?: (error: string) => void;
  }
): Promise<VoiceEnrollmentManager> {
  const manager = getVoiceEnrollmentManager();

  // Set up event handlers
  if (options?.onProgress) {
    manager.on('progress', options.onProgress);
  }

  if (options?.onComplete) {
    manager.on('enrollment-complete', options.onComplete);
  }

  if (options?.onError) {
    manager.on('enrollment-failed', options.onError);
  }

  // Start the session
  await manager.startSession(userId, userName);

  return manager;
}

// ============================================================================
// Singleton
// ============================================================================

let enrollmentManager: VoiceEnrollmentManager | null = null;

/**
 * Get or create the VoiceEnrollmentManager singleton
 */
export function getVoiceEnrollmentManager(
  config?: Partial<EnrollmentConfig>
): VoiceEnrollmentManager {
  if (!enrollmentManager) {
    enrollmentManager = new VoiceEnrollmentManager(config);
  }
  return enrollmentManager;
}

/**
 * Shutdown the enrollment manager
 */
export async function shutdownVoiceEnrollmentManager(): Promise<void> {
  if (enrollmentManager) {
    await enrollmentManager.cancelSession();
    enrollmentManager.removeAllListeners();
    enrollmentManager = null;
  }
}

export default VoiceEnrollmentManager;
