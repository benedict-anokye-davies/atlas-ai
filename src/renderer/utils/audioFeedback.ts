/**
 * Audio Feedback - Synthesized audio cues for state changes
 * Uses Web Audio API to generate sounds without external files
 */

type SoundType =
  | 'listening-start'
  | 'listening-end'
  | 'thinking-start'
  | 'speaking-start'
  | 'speaking-end'
  | 'error'
  | 'wake';

interface AudioFeedbackOptions {
  enabled: boolean;
  volume: number; // 0-1
}

class AudioFeedbackManager {
  private audioContext: AudioContext | null = null;
  private options: AudioFeedbackOptions = {
    enabled: true,
    volume: 0.3, // Default volume (30%)
  };

  /**
   * Initialize or get the audio context
   */
  private getContext(): AudioContext {
    if (!this.audioContext) {
      this.audioContext = new AudioContext();
    }
    // Resume if suspended (browsers require user interaction first)
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }
    return this.audioContext;
  }

  /**
   * Set audio feedback options
   */
  configure(options: Partial<AudioFeedbackOptions>): void {
    this.options = { ...this.options, ...options };
  }

  /**
   * Check if feedback is enabled
   */
  isEnabled(): boolean {
    return this.options.enabled;
  }

  /**
   * Play a specific sound type
   */
  play(type: SoundType): void {
    if (!this.options.enabled) return;

    try {
      switch (type) {
        case 'listening-start':
          this.playListeningStart();
          break;
        case 'listening-end':
          this.playListeningEnd();
          break;
        case 'thinking-start':
          this.playThinkingStart();
          break;
        case 'speaking-start':
          this.playSpeakingStart();
          break;
        case 'speaking-end':
          this.playSpeakingEnd();
          break;
        case 'error':
          this.playError();
          break;
        case 'wake':
          this.playWake();
          break;
      }
    } catch (err) {
      console.warn('[AudioFeedback] Failed to play sound:', err);
    }
  }

  /**
   * Listening started - ascending two-tone chime (friendly "I'm ready")
   * Green-themed: Higher, brighter tones
   */
  private playListeningStart(): void {
    const ctx = this.getContext();
    const now = ctx.currentTime;
    const vol = this.options.volume;

    // First tone - lower
    this.playTone(ctx, 523.25, now, 0.08, vol * 0.6); // C5
    // Second tone - higher (ascending = ready/active)
    this.playTone(ctx, 659.25, now + 0.08, 0.12, vol * 0.8); // E5
  }

  /**
   * Listening ended - single soft descending tone
   */
  private playListeningEnd(): void {
    const ctx = this.getContext();
    const now = ctx.currentTime;
    const vol = this.options.volume;

    // Soft descending tone
    this.playTone(ctx, 523.25, now, 0.1, vol * 0.4); // C5
  }

  /**
   * Thinking started - gentle pulse/hum (processing indicator)
   * Purple-themed: Mysterious, mid-range
   */
  private playThinkingStart(): void {
    const ctx = this.getContext();
    const now = ctx.currentTime;
    const vol = this.options.volume;

    // Soft thinking tone
    this.playTone(ctx, 392.0, now, 0.15, vol * 0.4, 'sine'); // G4 - softer
  }

  /**
   * Speaking started - warm notification (gold/amber themed)
   * Two-tone descending (output mode)
   */
  private playSpeakingStart(): void {
    const ctx = this.getContext();
    const now = ctx.currentTime;
    const vol = this.options.volume;

    // Warm descending two-tone
    this.playTone(ctx, 587.33, now, 0.08, vol * 0.5); // D5
    this.playTone(ctx, 493.88, now + 0.08, 0.12, vol * 0.6); // B4
  }

  /**
   * Speaking ended - subtle completion tone
   */
  private playSpeakingEnd(): void {
    const ctx = this.getContext();
    const now = ctx.currentTime;
    const vol = this.options.volume;

    // Soft completion
    this.playTone(ctx, 440.0, now, 0.1, vol * 0.3); // A4
  }

  /**
   * Error - dissonant alert tone
   */
  private playError(): void {
    const ctx = this.getContext();
    const now = ctx.currentTime;
    const vol = this.options.volume;

    // Dissonant error tone
    this.playTone(ctx, 220.0, now, 0.15, vol * 0.5); // A3
    this.playTone(ctx, 233.08, now, 0.15, vol * 0.4); // Bb3 (dissonant)
  }

  /**
   * Wake word detected - bright attention chime
   */
  private playWake(): void {
    const ctx = this.getContext();
    const now = ctx.currentTime;
    const vol = this.options.volume;

    // Bright three-note ascending chime
    this.playTone(ctx, 523.25, now, 0.06, vol * 0.5); // C5
    this.playTone(ctx, 659.25, now + 0.06, 0.06, vol * 0.6); // E5
    this.playTone(ctx, 783.99, now + 0.12, 0.1, vol * 0.7); // G5
  }

  /**
   * Play a single tone
   */
  private playTone(
    ctx: AudioContext,
    frequency: number,
    startTime: number,
    duration: number,
    volume: number,
    type: OscillatorType = 'sine'
  ): void {
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, startTime);

    // Envelope: quick attack, sustain, quick release
    gainNode.gain.setValueAtTime(0, startTime);
    gainNode.gain.linearRampToValueAtTime(volume, startTime + 0.01);
    gainNode.gain.setValueAtTime(volume, startTime + duration - 0.02);
    gainNode.gain.linearRampToValueAtTime(0, startTime + duration);

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    oscillator.start(startTime);
    oscillator.stop(startTime + duration);
  }

  /**
   * Cleanup resources
   */
  dispose(): void {
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
  }
}

// Singleton instance
export const audioFeedback = new AudioFeedbackManager();

export type { SoundType, AudioFeedbackOptions };
