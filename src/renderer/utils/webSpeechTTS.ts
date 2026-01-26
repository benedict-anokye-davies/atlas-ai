/**
 * Atlas Desktop - Web Speech API TTS Fallback
 * Uses browser's built-in speech synthesis as fallback when native TTS is unavailable
 */

class WebSpeechTTS {
  private synthesis: SpeechSynthesis | null = null;
  private voice: SpeechSynthesisVoice | null = null;
  private enabled: boolean = true;
  private rate: number = 1.0;
  private pitch: number = 1.0;
  private volume: number = 1.0;

  constructor() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      this.synthesis = window.speechSynthesis;
      this.selectVoice();

      // Re-select voice when voices are loaded (they load async)
      window.speechSynthesis.onvoiceschanged = () => {
        this.selectVoice();
      };
    }
  }

  /**
   * Select the best voice for English
   */
  private selectVoice(): void {
    if (!this.synthesis) return;

    const voices = this.synthesis.getVoices();
    if (voices.length === 0) return;

    // Prefer a natural-sounding voice
    const preferredVoices = [
      'Microsoft Zira',
      'Microsoft David',
      'Google UK English Female',
      'Google US English',
      'Samantha',
      'Alex',
    ];

    for (const preferred of preferredVoices) {
      const match = voices.find((v) => v.name.includes(preferred));
      if (match) {
        this.voice = match;
        console.log('[WebSpeechTTS] Selected voice:', this.voice.name);
        return;
      }
    }

    // Fall back to any English voice
    const englishVoice = voices.find((v) => v.lang.startsWith('en'));
    if (englishVoice) {
      this.voice = englishVoice;
      console.log('[WebSpeechTTS] Selected fallback voice:', this.voice.name);
      return;
    }

    // Last resort: use default
    this.voice = voices[0];
    console.log('[WebSpeechTTS] Using default voice:', this.voice?.name);
  }

  /**
   * Check if Web Speech API is available
   */
  isAvailable(): boolean {
    return this.synthesis !== null && this.enabled;
  }

  /**
   * Configure TTS settings
   */
  configure(options: { enabled?: boolean; rate?: number; pitch?: number; volume?: number }): void {
    if (options.enabled !== undefined) this.enabled = options.enabled;
    if (options.rate !== undefined) this.rate = Math.max(0.1, Math.min(10, options.rate));
    if (options.pitch !== undefined) this.pitch = Math.max(0, Math.min(2, options.pitch));
    if (options.volume !== undefined) this.volume = Math.max(0, Math.min(1, options.volume));
  }

  /**
   * Speak text using Web Speech API
   */
  speak(text: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.synthesis || !this.enabled) {
        console.log('[WebSpeechTTS] Not available or disabled');
        resolve();
        return;
      }

      // Cancel any ongoing speech
      this.synthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = this.rate;
      utterance.pitch = this.pitch;
      utterance.volume = this.volume;

      if (this.voice) {
        utterance.voice = this.voice;
      }

      utterance.onend = () => {
        console.log('[WebSpeechTTS] Speech completed');
        resolve();
      };

      utterance.onerror = (event) => {
        console.error('[WebSpeechTTS] Speech error:', event.error);
        reject(new Error(event.error));
      };

      console.log('[WebSpeechTTS] Speaking:', text.substring(0, 50) + '...');
      this.synthesis.speak(utterance);
    });
  }

  /**
   * Stop any ongoing speech
   */
  stop(): void {
    if (this.synthesis) {
      this.synthesis.cancel();
    }
  }

  /**
   * Check if currently speaking
   */
  isSpeaking(): boolean {
    return this.synthesis?.speaking ?? false;
  }
}

// Singleton instance
export const webSpeechTTS = new WebSpeechTTS();
export default webSpeechTTS;
