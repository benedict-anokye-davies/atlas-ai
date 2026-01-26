/**
 * Unknown Voice Handler
 * T5-209: Handle unrecognized speakers with enrollment flow
 *
 * Implements the flow for unknown voices:
 * 1. Voice doesn't match any enrolled user
 * 2. Atlas: "I don't recognize your voice. What's your name?"
 * 3. User: "I'm [Name]"
 * 4. Atlas: "Nice to meet you, [Name]. Let me learn your voice. Please repeat after me..."
 * 5. Atlas plays 3 phrases for user to repeat
 * 6. Voice embedding extracted and stored
 * 7. Atlas: "Got it! I'll remember you now, [Name]."
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { createModuleLogger } from '../utils/logger';
import { getPyannoteBridge, type SpeakerResult, type EnrolledSpeaker } from './speaker-id';

const logger = createModuleLogger('UnknownVoice');

// ============================================================================
// Types
// ============================================================================

/**
 * Enrollment phrase for voice learning
 */
export interface EnrollmentPhrase {
  id: string;
  text: string;
  category: 'greeting' | 'command' | 'statement' | 'question';
}

/**
 * Unknown voice session state
 */
export type UnknownVoiceSessionState =
  | 'idle'
  | 'asking_name'
  | 'waiting_name'
  | 'confirming_name'
  | 'explaining_enrollment'
  | 'playing_phrase'
  | 'recording_phrase'
  | 'processing_phrase'
  | 'enrollment_complete'
  | 'enrollment_failed';

/**
 * Unknown voice session
 */
export interface UnknownVoiceSession {
  id: string;
  state: UnknownVoiceSessionState;
  detectedName?: string;
  confirmedName?: string;
  collectedSamples: string[];
  currentPhraseIndex: number;
  startedAt: Date;
  lastActivityAt: Date;
  error?: string;
}

/**
 * Unknown voice handler configuration
 */
export interface UnknownVoiceConfig {
  /** Number of phrases required for enrollment */
  requiredPhrases: number;
  /** Timeout for each step (ms) */
  stepTimeoutMs: number;
  /** Session timeout (ms) */
  sessionTimeoutMs: number;
  /** Minimum confidence to consider voice unknown */
  unknownThreshold: number;
  /** Path to store audio samples */
  samplesDir: string;
}

/**
 * Default configuration
 */
export const DEFAULT_UNKNOWN_VOICE_CONFIG: UnknownVoiceConfig = {
  requiredPhrases: 3,
  stepTimeoutMs: 30000,
  sessionTimeoutMs: 300000, // 5 minutes
  unknownThreshold: 0.5,
  samplesDir: '',
};

/**
 * Enrollment phrases to use
 */
export const ENROLLMENT_PHRASES: EnrollmentPhrase[] = [
  { id: 'greeting_1', text: 'Hey Atlas, good morning', category: 'greeting' },
  { id: 'command_1', text: 'Play some music for me', category: 'command' },
  { id: 'question_1', text: "What's the weather like today?", category: 'question' },
  { id: 'statement_1', text: 'I need to finish my work by five', category: 'statement' },
  { id: 'greeting_2', text: 'Atlas, I could use some help', category: 'greeting' },
  { id: 'command_2', text: 'Send a message to my friend', category: 'command' },
];

/**
 * Unknown voice handler events
 */
export interface UnknownVoiceEvents {
  'session:started': (session: UnknownVoiceSession) => void;
  'session:updated': (session: UnknownVoiceSession) => void;
  'session:completed': (session: UnknownVoiceSession, speaker: EnrolledSpeaker) => void;
  'session:failed': (session: UnknownVoiceSession, error: string) => void;
  'session:timeout': (session: UnknownVoiceSession) => void;
  'speak:request': (text: string, sessionId: string) => void;
  'listen:request': (sessionId: string) => void;
  'phrase:playing': (phrase: EnrollmentPhrase, index: number) => void;
  'phrase:recorded': (index: number, path: string) => void;
  error: (error: Error) => void;
}

// ============================================================================
// Unknown Voice Handler
// ============================================================================

/**
 * Handles unknown voice detection and enrollment flow
 */
export class UnknownVoiceHandler extends EventEmitter {
  private config: UnknownVoiceConfig;
  private currentSession: UnknownVoiceSession | null = null;
  private sessionTimeout: NodeJS.Timeout | null = null;
  private stepTimeout: NodeJS.Timeout | null = null;

  constructor(config?: Partial<UnknownVoiceConfig>) {
    super();

    const userDataPath = app?.getPath?.('userData') || path.join(process.env.HOME || '', '.atlas');
    const defaultSamplesDir = path.join(userDataPath, 'temp', 'enrollment-samples');

    this.config = {
      ...DEFAULT_UNKNOWN_VOICE_CONFIG,
      samplesDir: defaultSamplesDir,
      ...config,
    };

    this.ensureDirectories();
  }

  private ensureDirectories(): void {
    if (!fs.existsSync(this.config.samplesDir)) {
      fs.mkdirSync(this.config.samplesDir, { recursive: true });
    }
  }

  /**
   * Check if a speaker identification result indicates unknown voice
   */
  isUnknownVoice(result: SpeakerResult): boolean {
    return !result.isKnown && result.confidence < this.config.unknownThreshold;
  }

  /**
   * Start unknown voice handling session
   */
  async startSession(): Promise<UnknownVoiceSession> {
    // Cancel any existing session
    if (this.currentSession) {
      await this.cancelSession('New session started');
    }

    const session: UnknownVoiceSession = {
      id: `unknown_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      state: 'asking_name',
      collectedSamples: [],
      currentPhraseIndex: 0,
      startedAt: new Date(),
      lastActivityAt: new Date(),
    };

    this.currentSession = session;
    this.startSessionTimeout();
    this.emit('session:started', session);

    // Request Atlas to ask for name
    this.requestSpeak("I don't recognize your voice. What's your name?", session.id);

    this.updateState('waiting_name');
    return session;
  }

  /**
   * Handle user's name response
   */
  async handleNameResponse(name: string): Promise<void> {
    if (!this.currentSession || this.currentSession.state !== 'waiting_name') {
      logger.warn('No active session waiting for name');
      return;
    }

    this.currentSession.detectedName = name;
    this.currentSession.lastActivityAt = new Date();
    this.resetStepTimeout();

    // Confirm name
    this.updateState('confirming_name');
    this.requestSpeak(
      `Nice to meet you, ${name}! Let me learn your voice so I can recognize you next time. I'll play a few phrases - please repeat each one after me.`,
      this.currentSession.id
    );

    // After speaking, start enrollment
    this.currentSession.confirmedName = name;
    this.updateState('explaining_enrollment');

    // Start first phrase after a short delay
    setTimeout(() => {
      this.playNextPhrase();
    }, 500);
  }

  /**
   * Play the next enrollment phrase
   */
  private playNextPhrase(): void {
    if (!this.currentSession) return;

    const phraseIndex = this.currentSession.currentPhraseIndex;
    if (phraseIndex >= this.config.requiredPhrases) {
      // All phrases collected, complete enrollment
      this.completeEnrollment();
      return;
    }

    const phrase = ENROLLMENT_PHRASES[phraseIndex % ENROLLMENT_PHRASES.length];
    this.updateState('playing_phrase');
    this.emit('phrase:playing', phrase, phraseIndex);

    // Request Atlas to speak the phrase
    this.requestSpeak(
      `Phrase ${phraseIndex + 1} of ${this.config.requiredPhrases}: "${phrase.text}"`,
      this.currentSession.id
    );

    // After speaking, start listening
    setTimeout(() => {
      this.startListeningForPhrase();
    }, 500);
  }

  /**
   * Start listening for user to repeat phrase
   */
  private startListeningForPhrase(): void {
    if (!this.currentSession) return;

    this.updateState('recording_phrase');
    this.emit('listen:request', this.currentSession.id);
    this.startStepTimeout();
  }

  /**
   * Handle recorded phrase audio
   */
  async handlePhraseRecording(audioBuffer: ArrayBuffer | Buffer): Promise<void> {
    if (!this.currentSession || this.currentSession.state !== 'recording_phrase') {
      logger.warn('No active session recording phrase');
      return;
    }

    this.resetStepTimeout();
    this.updateState('processing_phrase');

    // Save audio to file
    const filename = `${this.currentSession.id}_phrase_${this.currentSession.currentPhraseIndex}.wav`;
    const filepath = path.join(this.config.samplesDir, filename);

    try {
      const buffer = Buffer.isBuffer(audioBuffer) ? audioBuffer : Buffer.from(audioBuffer);
      await fs.promises.writeFile(filepath, buffer);

      this.currentSession.collectedSamples.push(filepath);
      this.currentSession.lastActivityAt = new Date();
      this.emit('phrase:recorded', this.currentSession.currentPhraseIndex, filepath);

      logger.info('Phrase recorded', {
        sessionId: this.currentSession.id,
        phraseIndex: this.currentSession.currentPhraseIndex,
        filepath,
      });

      // Move to next phrase
      this.currentSession.currentPhraseIndex++;

      if (this.currentSession.currentPhraseIndex < this.config.requiredPhrases) {
        // More phrases needed
        this.requestSpeak('Great! Next phrase:', this.currentSession.id);
        setTimeout(() => {
          this.playNextPhrase();
        }, 500);
      } else {
        // All phrases collected
        this.completeEnrollment();
      }
    } catch (error) {
      logger.error('Failed to save phrase recording', { error });
      this.failSession('Failed to save voice sample');
    }
  }

  /**
   * Complete the enrollment process
   */
  private async completeEnrollment(): Promise<void> {
    if (!this.currentSession) return;

    this.updateState('enrollment_complete');

    try {
      const bridge = getPyannoteBridge();
      const speaker = await bridge.enrollSpeaker(
        this.currentSession.confirmedName || 'Unknown User',
        this.currentSession.collectedSamples
      );

      this.requestSpeak(
        `Got it! I'll remember you now, ${this.currentSession.confirmedName}. Nice to meet you!`,
        this.currentSession.id
      );

      logger.info('Enrollment complete', {
        sessionId: this.currentSession.id,
        speakerId: speaker.id,
        name: speaker.name,
        sampleCount: speaker.sampleCount,
      });

      this.emit('session:completed', this.currentSession, speaker);
      this.cleanupSession();
    } catch (error) {
      logger.error('Enrollment failed', { error });
      this.failSession('Failed to create voice profile');
    }
  }

  /**
   * Cancel current session
   */
  async cancelSession(reason: string): Promise<void> {
    if (!this.currentSession) return;

    logger.info('Session cancelled', {
      sessionId: this.currentSession.id,
      reason,
    });

    this.emit('session:failed', this.currentSession, reason);
    this.cleanupSession();
  }

  /**
   * Fail current session with error
   */
  private failSession(error: string): void {
    if (!this.currentSession) return;

    this.currentSession.state = 'enrollment_failed';
    this.currentSession.error = error;

    this.requestSpeak(
      "I'm sorry, I had trouble learning your voice. Let's try again later.",
      this.currentSession.id
    );

    logger.error('Session failed', {
      sessionId: this.currentSession.id,
      error,
    });

    this.emit('session:failed', this.currentSession, error);
    this.cleanupSession();
  }

  /**
   * Update session state
   */
  private updateState(state: UnknownVoiceSessionState): void {
    if (!this.currentSession) return;

    this.currentSession.state = state;
    this.currentSession.lastActivityAt = new Date();
    this.emit('session:updated', this.currentSession);
  }

  /**
   * Request Atlas to speak
   */
  private requestSpeak(text: string, sessionId: string): void {
    this.emit('speak:request', text, sessionId);
  }

  /**
   * Start session timeout
   */
  private startSessionTimeout(): void {
    this.clearSessionTimeout();
    this.sessionTimeout = setTimeout(() => {
      if (this.currentSession) {
        this.emit('session:timeout', this.currentSession);
        this.cancelSession('Session timeout');
      }
    }, this.config.sessionTimeoutMs);
  }

  /**
   * Clear session timeout
   */
  private clearSessionTimeout(): void {
    if (this.sessionTimeout) {
      clearTimeout(this.sessionTimeout);
      this.sessionTimeout = null;
    }
  }

  /**
   * Start step timeout
   */
  private startStepTimeout(): void {
    this.clearStepTimeout();
    this.stepTimeout = setTimeout(() => {
      if (this.currentSession) {
        // Retry current step or fail
        logger.warn('Step timeout', {
          sessionId: this.currentSession.id,
          state: this.currentSession.state,
        });

        if (this.currentSession.state === 'recording_phrase') {
          // Retry the phrase
          this.requestSpeak("I didn't catch that. Let's try again.", this.currentSession.id);
          this.playNextPhrase();
        } else {
          this.failSession('Step timeout');
        }
      }
    }, this.config.stepTimeoutMs);
  }

  /**
   * Clear step timeout
   */
  private clearStepTimeout(): void {
    if (this.stepTimeout) {
      clearTimeout(this.stepTimeout);
      this.stepTimeout = null;
    }
  }

  /**
   * Reset step timeout
   */
  private resetStepTimeout(): void {
    this.startStepTimeout();
  }

  /**
   * Cleanup session resources
   */
  private cleanupSession(): void {
    this.clearSessionTimeout();
    this.clearStepTimeout();

    // Clean up audio files
    if (this.currentSession) {
      for (const sample of this.currentSession.collectedSamples) {
        try {
          if (fs.existsSync(sample)) {
            fs.unlinkSync(sample);
          }
        } catch (error) {
          logger.warn('Failed to cleanup sample file', { path: sample, error });
        }
      }
    }

    this.currentSession = null;
  }

  /**
   * Get current session
   */
  getCurrentSession(): UnknownVoiceSession | null {
    return this.currentSession;
  }

  /**
   * Check if session is active
   */
  isSessionActive(): boolean {
    return this.currentSession !== null;
  }

  /**
   * Get session state
   */
  getSessionState(): UnknownVoiceSessionState | null {
    return this.currentSession?.state || null;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let unknownVoiceHandler: UnknownVoiceHandler | null = null;

/**
 * Get or create the UnknownVoiceHandler instance
 */
export function getUnknownVoiceHandler(config?: Partial<UnknownVoiceConfig>): UnknownVoiceHandler {
  if (!unknownVoiceHandler) {
    unknownVoiceHandler = new UnknownVoiceHandler(config);
  }
  return unknownVoiceHandler;
}

/**
 * Cleanup unknown voice handler
 */
export async function cleanupUnknownVoiceHandler(): Promise<void> {
  if (unknownVoiceHandler) {
    if (unknownVoiceHandler.isSessionActive()) {
      await unknownVoiceHandler.cancelSession('Cleanup');
    }
    unknownVoiceHandler = null;
  }
}
