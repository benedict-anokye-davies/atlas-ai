/**
 * Video Voiceover Generator
 * T5-104: Generate voiceovers from video scripts using ElevenLabs
 *
 * Creates high-quality voiceover audio files for video content automation.
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { getTTSManager, TTSManager } from '../../tts';
import { createModuleLogger } from '../../utils/logger';
import type { Script } from '../types';

const logger = createModuleLogger('Voiceover');

// Voiceover configuration
export interface VoiceoverConfig {
  /** Voice ID to use (ElevenLabs voice ID) */
  voiceId?: string;
  /** Output audio format */
  format?: 'mp3' | 'wav';
  /** Speed multiplier (0.5 to 2.0) */
  speed?: number;
  /** Stability setting (0 to 1) */
  stability?: number;
  /** Similarity boost (0 to 1) */
  similarityBoost?: number;
  /** Add pauses between sections (ms) */
  sectionPauseMs?: number;
  /** Output directory for audio files */
  outputDir?: string;
}

// Default voiceover config
const DEFAULT_CONFIG: Required<VoiceoverConfig> = {
  voiceId: 'EXAVITQu4vr4xnSDxMaL', // Default ElevenLabs voice (Sarah)
  format: 'mp3',
  speed: 1.0,
  stability: 0.5,
  similarityBoost: 0.75,
  sectionPauseMs: 500,
  outputDir: '',
};

// Voiceover result
export interface VoiceoverResult {
  /** Path to the generated audio file */
  audioPath: string;
  /** Duration in seconds */
  duration: number;
  /** Word count */
  wordCount: number;
  /** Number of sections */
  sectionCount: number;
  /** Timestamps for each section (for syncing with visuals) */
  sectionTimestamps: Array<{
    title: string;
    startTime: number;
    endTime: number;
  }>;
}

// Section audio with timing
interface SectionAudio {
  title: string;
  buffer: Buffer;
  duration: number;
}

/**
 * Voiceover Generator for video content
 */
export class VoiceoverGenerator {
  private tts: TTSManager;
  private config: Required<VoiceoverConfig>;

  constructor(config?: VoiceoverConfig) {
    this.tts = getTTSManager();
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Set default output directory
    if (!this.config.outputDir) {
      const userDataPath =
        app?.getPath?.('userData') || path.join(process.env.HOME || '', '.atlas');
      this.config.outputDir = path.join(userDataPath, 'voiceovers');
    }

    // Ensure output directory exists
    if (!fs.existsSync(this.config.outputDir)) {
      fs.mkdirSync(this.config.outputDir, { recursive: true });
    }
  }

  /**
   * Generate voiceover from a complete script
   */
  async generateFromScript(script: Script, filename?: string): Promise<VoiceoverResult> {
    logger.info('Generating voiceover from script', {
      sections: script.sections.length,
      estimatedDuration: script.estimatedDuration,
    });

    const outputFilename = filename || `voiceover_${Date.now()}.${this.config.format}`;
    const outputPath = path.join(this.config.outputDir, outputFilename);

    try {
      // Generate audio for each part of the script
      const sectionAudios: SectionAudio[] = [];
      let totalDuration = 0;

      // Generate hook audio
      const hookAudio = await this.generateSectionAudio('Hook', script.hook);
      sectionAudios.push(hookAudio);
      totalDuration += hookAudio.duration;

      // Generate section audios
      for (const section of script.sections) {
        const sectionAudio = await this.generateSectionAudio(section.title, section.content);
        sectionAudios.push(sectionAudio);
        totalDuration += sectionAudio.duration;
      }

      // Generate CTA audio
      const ctaAudio = await this.generateSectionAudio('CTA', script.cta);
      sectionAudios.push(ctaAudio);
      totalDuration += ctaAudio.duration;

      // Combine all audio with pauses
      const combinedBuffer = this.combineAudioBuffers(sectionAudios);

      // Write to file
      fs.writeFileSync(outputPath, combinedBuffer);

      // Calculate section timestamps
      const sectionTimestamps = this.calculateTimestamps(sectionAudios);

      const result: VoiceoverResult = {
        audioPath: outputPath,
        duration: totalDuration,
        wordCount: script.voiceoverText.split(/\s+/).length,
        sectionCount: script.sections.length + 2, // +2 for hook and CTA
        sectionTimestamps,
      };

      logger.info('Voiceover generated successfully', {
        audioPath: outputPath,
        duration: totalDuration,
        sections: sectionTimestamps.length,
      });

      return result;
    } catch (error) {
      logger.error('Failed to generate voiceover', { error });
      throw error;
    }
  }

  /**
   * Generate voiceover from plain text
   */
  async generateFromText(text: string, filename?: string): Promise<VoiceoverResult> {
    logger.info('Generating voiceover from text', { textLength: text.length });

    const outputFilename = filename || `voiceover_${Date.now()}.${this.config.format}`;
    const outputPath = path.join(this.config.outputDir, outputFilename);

    try {
      const audioBuffer = await this.synthesizeText(text);
      fs.writeFileSync(outputPath, audioBuffer);

      const duration = this.estimateDuration(audioBuffer.length);

      const result: VoiceoverResult = {
        audioPath: outputPath,
        duration,
        wordCount: text.split(/\s+/).length,
        sectionCount: 1,
        sectionTimestamps: [
          {
            title: 'Content',
            startTime: 0,
            endTime: duration,
          },
        ],
      };

      logger.info('Voiceover generated from text', {
        audioPath: outputPath,
        duration,
      });

      return result;
    } catch (error) {
      logger.error('Failed to generate voiceover from text', { error });
      throw error;
    }
  }

  /**
   * Generate voiceover for multiple texts (batch processing)
   */
  async generateBatch(
    items: Array<{ id: string; text: string }>
  ): Promise<Map<string, VoiceoverResult>> {
    logger.info('Generating batch voiceovers', { count: items.length });

    const results = new Map<string, VoiceoverResult>();

    for (const item of items) {
      try {
        const result = await this.generateFromText(item.text, `${item.id}.${this.config.format}`);
        results.set(item.id, result);
      } catch (error) {
        logger.error('Failed to generate voiceover for item', { id: item.id, error });
      }
    }

    return results;
  }

  /**
   * Preview the first few seconds of a voiceover
   */
  async preview(text: string, maxDuration: number = 5): Promise<Buffer> {
    // Truncate text to approximate max duration
    const wordsPerSecond = 2.5;
    const maxWords = Math.round(maxDuration * wordsPerSecond);
    const words = text.split(/\s+/);
    const previewText = words.slice(0, maxWords).join(' ');

    return this.synthesizeText(previewText);
  }

  /**
   * List available voices
   */
  async listVoices(): Promise<Array<{ id: string; name: string; category: string }>> {
    // ElevenLabs default voices
    return [
      { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah', category: 'Female' },
      { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel', category: 'Female' },
      { id: 'AZnzlk1XvdvUeBnXmlld', name: 'Domi', category: 'Female' },
      { id: 'MF3mGyEYCl7XYWbV9V6O', name: 'Elli', category: 'Female' },
      { id: 'TxGEqnHWrfWFTfGW9XjX', name: 'Josh', category: 'Male' },
      { id: 'VR6AewLTigWG4xSOukaG', name: 'Arnold', category: 'Male' },
      { id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam', category: 'Male' },
      { id: 'yoZ06aMxZJJ28mfd3POQ', name: 'Sam', category: 'Male' },
    ];
  }

  /**
   * Set voice for generation
   */
  setVoice(voiceId: string): void {
    this.config.voiceId = voiceId;
    logger.info('Voice set', { voiceId });
  }

  /**
   * Set speed multiplier
   */
  setSpeed(speed: number): void {
    this.config.speed = Math.max(0.5, Math.min(2.0, speed));
    logger.info('Speed set', { speed: this.config.speed });
  }

  // Private methods

  private async generateSectionAudio(title: string, content: string): Promise<SectionAudio> {
    const buffer = await this.synthesizeText(content);
    const duration = this.estimateDuration(buffer.length);

    return {
      title,
      buffer,
      duration,
    };
  }

  private async synthesizeText(text: string): Promise<Buffer> {
    // Use TTSManager to synthesize
    const result = await this.tts.synthesize(text);

    // The TTSManager returns audio data - convert to buffer if needed
    if (result.audio) {
      return Buffer.from(result.audio);
    }

    throw new Error('No audio data returned from TTS');
  }

  private combineAudioBuffers(sections: SectionAudio[]): Buffer {
    // Calculate pause buffer size (silence)
    const pauseSamples = Math.round((this.config.sectionPauseMs / 1000) * 44100) * 2; // 16-bit = 2 bytes
    const pauseBuffer = Buffer.alloc(pauseSamples);

    // Calculate total size
    let totalSize = 0;
    for (const section of sections) {
      totalSize += section.buffer.length;
      totalSize += pauseBuffer.length;
    }

    // Combine buffers
    const combined = Buffer.alloc(totalSize);
    let offset = 0;

    for (const section of sections) {
      section.buffer.copy(combined, offset);
      offset += section.buffer.length;
      pauseBuffer.copy(combined, offset);
      offset += pauseBuffer.length;
    }

    return combined;
  }

  private calculateTimestamps(
    sections: SectionAudio[]
  ): Array<{ title: string; startTime: number; endTime: number }> {
    const timestamps: Array<{ title: string; startTime: number; endTime: number }> = [];
    let currentTime = 0;
    const pauseDuration = this.config.sectionPauseMs / 1000;

    for (const section of sections) {
      timestamps.push({
        title: section.title,
        startTime: currentTime,
        endTime: currentTime + section.duration,
      });
      currentTime += section.duration + pauseDuration;
    }

    return timestamps;
  }

  private estimateDuration(bufferSize: number): number {
    // Assuming MP3 at 128kbps or PCM at 44100Hz 16-bit
    const bytesPerSecond = 16000; // Approximate for MP3 128kbps
    return bufferSize / bytesPerSecond;
  }
}

// Singleton instance
let voiceoverGenerator: VoiceoverGenerator | null = null;

/**
 * Get the voiceover generator singleton
 */
export function getVoiceoverGenerator(config?: VoiceoverConfig): VoiceoverGenerator {
  if (!voiceoverGenerator) {
    voiceoverGenerator = new VoiceoverGenerator(config);
  }
  return voiceoverGenerator;
}

/**
 * Generate voiceover from a script
 */
export async function generateVoiceover(
  script: Script,
  config?: VoiceoverConfig
): Promise<VoiceoverResult> {
  const generator = new VoiceoverGenerator(config);
  return generator.generateFromScript(script);
}

/**
 * Generate voiceover from plain text
 */
export async function generateVoiceoverFromText(
  text: string,
  config?: VoiceoverConfig
): Promise<VoiceoverResult> {
  const generator = new VoiceoverGenerator(config);
  return generator.generateFromText(text);
}
