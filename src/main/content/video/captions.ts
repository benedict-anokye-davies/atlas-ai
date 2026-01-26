/**
 * Auto-Captioning Module
 * T5-107: Generate and burn captions into videos
 *
 * Supports SRT generation from timestamps and FFmpeg caption burning.
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import ffmpeg from 'fluent-ffmpeg';
import { createModuleLogger } from '../../utils/logger';
import type { CaptionStyle } from '../types';

const logger = createModuleLogger('Captions');

// Caption entry
export interface CaptionEntry {
  id: number;
  startTime: number; // in seconds
  endTime: number; // in seconds
  text: string;
}

// Word-level timing
export interface WordTiming {
  word: string;
  start: number;
  end: number;
}

// Caption generation options
export interface CaptionOptions {
  /** Maximum characters per line */
  maxCharsPerLine?: number;
  /** Maximum lines per caption */
  maxLines?: number;
  /** Minimum duration for a caption (seconds) */
  minDuration?: number;
  /** Maximum duration for a caption (seconds) */
  maxDuration?: number;
  /** Gap between captions (seconds) */
  gapBetweenCaptions?: number;
}

// Default caption options
const DEFAULT_OPTIONS: Required<CaptionOptions> = {
  maxCharsPerLine: 42,
  maxLines: 2,
  minDuration: 1.0,
  maxDuration: 5.0,
  gapBetweenCaptions: 0.1,
};

// Caption style presets
export const CAPTION_STYLE_PRESETS = {
  youtube: {
    fontFamily: 'Arial',
    fontSize: 48,
    fontColor: '#FFFFFF',
    backgroundColor: '#000000',
    position: 'bottom' as const,
    animation: 'none' as const,
  },
  tiktok: {
    fontFamily: 'Arial Black',
    fontSize: 64,
    fontColor: '#FFFFFF',
    backgroundColor: '#000000',
    position: 'center' as const,
    animation: 'highlight' as const,
  },
  shorts: {
    fontFamily: 'Arial',
    fontSize: 56,
    fontColor: '#FFFF00',
    backgroundColor: '#000000',
    position: 'bottom' as const,
    animation: 'typewriter' as const,
  },
  minimal: {
    fontFamily: 'Helvetica',
    fontSize: 36,
    fontColor: '#FFFFFF',
    backgroundColor: 'transparent',
    position: 'bottom' as const,
    animation: 'fade' as const,
  },
  news: {
    fontFamily: 'Times New Roman',
    fontSize: 42,
    fontColor: '#FFFFFF',
    backgroundColor: '#003366',
    position: 'bottom' as const,
    animation: 'none' as const,
  },
} as const;

/**
 * Caption Generator Class
 * Generates SRT files and burns captions into videos
 */
export class CaptionGenerator {
  private options: Required<CaptionOptions>;
  private outputDir: string;

  constructor(options?: CaptionOptions) {
    this.options = { ...DEFAULT_OPTIONS, ...options };

    const userDataPath = app?.getPath?.('userData') || path.join(process.env.HOME || '', '.atlas');
    this.outputDir = path.join(userDataPath, 'captions');

    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  /**
   * Generate SRT from word timings
   */
  generateSRT(wordTimings: WordTiming[], outputPath?: string): string {
    const captions = this.createCaptionEntries(wordTimings);
    const srtContent = this.entriesToSRT(captions);

    const finalPath = outputPath || path.join(this.outputDir, `captions_${Date.now()}.srt`);
    fs.writeFileSync(finalPath, srtContent, 'utf-8');

    logger.info('SRT file generated', {
      path: finalPath,
      captionCount: captions.length,
    });

    return finalPath;
  }

  /**
   * Generate SRT from text and timestamps
   */
  generateSRTFromSegments(
    segments: Array<{ text: string; start: number; end: number }>,
    outputPath?: string
  ): string {
    const captions: CaptionEntry[] = segments.map((seg, i) => ({
      id: i + 1,
      startTime: seg.start,
      endTime: seg.end,
      text: this.wrapText(seg.text),
    }));

    const srtContent = this.entriesToSRT(captions);
    const finalPath = outputPath || path.join(this.outputDir, `captions_${Date.now()}.srt`);
    fs.writeFileSync(finalPath, srtContent, 'utf-8');

    logger.info('SRT file generated from segments', {
      path: finalPath,
      captionCount: captions.length,
    });

    return finalPath;
  }

  /**
   * Generate SRT from plain text with estimated timing
   */
  generateSRTFromText(text: string, totalDuration: number, outputPath?: string): string {
    const words = text.split(/\s+/).filter((w) => w.length > 0);
    const wordsPerSecond = words.length / totalDuration;
    const secondsPerWord = 1 / wordsPerSecond;

    // Create word timings
    const wordTimings: WordTiming[] = [];
    let currentTime = 0;

    for (const word of words) {
      const duration = secondsPerWord;
      wordTimings.push({
        word,
        start: currentTime,
        end: currentTime + duration,
      });
      currentTime += duration;
    }

    return this.generateSRT(wordTimings, outputPath);
  }

  /**
   * Create caption entries from word timings
   */
  private createCaptionEntries(wordTimings: WordTiming[]): CaptionEntry[] {
    const captions: CaptionEntry[] = [];
    let currentCaption: { words: string[]; start: number; end: number } | null = null;
    let captionId = 1;

    for (const timing of wordTimings) {
      if (!currentCaption) {
        // Start new caption
        currentCaption = {
          words: [timing.word],
          start: timing.start,
          end: timing.end,
        };
      } else {
        // Check if we should continue or start new caption
        const potentialText = [...currentCaption.words, timing.word].join(' ');
        const duration = timing.end - currentCaption.start;
        const lines = this.wrapText(potentialText).split('\n');

        const shouldSplit =
          duration > this.options.maxDuration ||
          lines.length > this.options.maxLines ||
          lines.some((line) => line.length > this.options.maxCharsPerLine);

        if (shouldSplit) {
          // Finalize current caption
          captions.push({
            id: captionId++,
            startTime: currentCaption.start,
            endTime: currentCaption.end,
            text: this.wrapText(currentCaption.words.join(' ')),
          });

          // Start new caption
          currentCaption = {
            words: [timing.word],
            start: timing.start + this.options.gapBetweenCaptions,
            end: timing.end,
          };
        } else {
          // Add word to current caption
          currentCaption.words.push(timing.word);
          currentCaption.end = timing.end;
        }
      }
    }

    // Don't forget the last caption
    if (currentCaption && currentCaption.words.length > 0) {
      captions.push({
        id: captionId,
        startTime: currentCaption.start,
        endTime: currentCaption.end,
        text: this.wrapText(currentCaption.words.join(' ')),
      });
    }

    // Apply minimum duration
    return captions.map((caption) => ({
      ...caption,
      endTime: Math.max(caption.endTime, caption.startTime + this.options.minDuration),
    }));
  }

  /**
   * Wrap text to fit caption constraints
   */
  private wrapText(text: string): string {
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let currentLine = '';

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;

      if (testLine.length > this.options.maxCharsPerLine && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }

    if (currentLine) {
      lines.push(currentLine);
    }

    // Limit to max lines
    return lines.slice(0, this.options.maxLines).join('\n');
  }

  /**
   * Convert caption entries to SRT format
   */
  private entriesToSRT(entries: CaptionEntry[]): string {
    return entries
      .map((entry) => {
        const startTimecode = this.secondsToTimecode(entry.startTime);
        const endTimecode = this.secondsToTimecode(entry.endTime);
        return `${entry.id}\n${startTimecode} --> ${endTimecode}\n${entry.text}\n`;
      })
      .join('\n');
  }

  /**
   * Convert seconds to SRT timecode format (HH:MM:SS,mmm)
   */
  private secondsToTimecode(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const millis = Math.round((seconds % 1) * 1000);

    return (
      `${hours.toString().padStart(2, '0')}:` +
      `${minutes.toString().padStart(2, '0')}:` +
      `${secs.toString().padStart(2, '0')},` +
      `${millis.toString().padStart(3, '0')}`
    );
  }

  /**
   * Parse SRT file to caption entries
   */
  parseSRT(srtPath: string): CaptionEntry[] {
    const content = fs.readFileSync(srtPath, 'utf-8');
    const blocks = content.trim().split(/\n\n+/);
    const entries: CaptionEntry[] = [];

    for (const block of blocks) {
      const lines = block.split('\n');
      if (lines.length < 3) continue;

      const id = parseInt(lines[0], 10);
      const timecodeMatch = lines[1].match(
        /(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})/
      );

      if (!timecodeMatch) continue;

      const startTime = this.timecodeToSeconds(timecodeMatch[1]);
      const endTime = this.timecodeToSeconds(timecodeMatch[2]);
      const text = lines.slice(2).join('\n');

      entries.push({ id, startTime, endTime, text });
    }

    return entries;
  }

  /**
   * Convert SRT timecode to seconds
   */
  private timecodeToSeconds(timecode: string): number {
    const [time, millis] = timecode.split(',');
    const [hours, minutes, seconds] = time.split(':').map(Number);
    return hours * 3600 + minutes * 60 + seconds + parseInt(millis, 10) / 1000;
  }

  /**
   * Burn captions into video using FFmpeg
   */
  async burnCaptions(
    videoPath: string,
    srtPath: string,
    style: CaptionStyle | keyof typeof CAPTION_STYLE_PRESETS = 'youtube',
    outputPath?: string
  ): Promise<string> {
    const finalStyle = typeof style === 'string' ? CAPTION_STYLE_PRESETS[style] : style;

    const output =
      outputPath ||
      path.join(
        path.dirname(videoPath),
        `${path.basename(videoPath, path.extname(videoPath))}_captioned.mp4`
      );

    logger.info('Burning captions into video', {
      video: videoPath,
      srt: srtPath,
      output,
    });

    const assStyle = this.buildAssStyle(finalStyle);

    await new Promise<void>((resolve, reject) => {
      // Escape path for FFmpeg subtitles filter
      const escapedSrtPath = srtPath.replace(/\\/g, '/').replace(/:/g, '\\:');

      ffmpeg(videoPath)
        .videoFilters([`subtitles='${escapedSrtPath}':force_style='${assStyle}'`])
        .outputOptions(['-c:a', 'copy'])
        .output(output)
        .on('end', () => {
          logger.info('Captions burned successfully', { output });
          resolve();
        })
        .on('error', (err) => {
          logger.error('Failed to burn captions', { error: err });
          reject(err);
        })
        .run();
    });

    return output;
  }

  /**
   * Build ASS style string from CaptionStyle
   */
  private buildAssStyle(style: CaptionStyle): string {
    const parts: string[] = [];

    // Font settings
    parts.push(`FontName=${style.fontFamily || 'Arial'}`);
    parts.push(`FontSize=${style.fontSize || 24}`);
    parts.push('Bold=1');

    // Colors (ASS format: &HAABBGGRR)
    const primaryColor = this.hexToAssColor(style.fontColor || '#FFFFFF');
    parts.push(`PrimaryColour=${primaryColor}`);

    // Background/outline
    const outlineColor = this.hexToAssColor(style.backgroundColor || '#000000');
    parts.push(`OutlineColour=${outlineColor}`);
    parts.push('Outline=3');
    parts.push('Shadow=1');

    // Position alignment
    let alignment = 2; // Bottom center
    if (style.position === 'top') alignment = 8;
    else if (style.position === 'center') alignment = 5;
    parts.push(`Alignment=${alignment}`);

    // Margin from edges
    parts.push('MarginV=40');
    parts.push('MarginL=20');
    parts.push('MarginR=20');

    return parts.join(',');
  }

  /**
   * Convert hex color to ASS format (&HAABBGGRR)
   */
  private hexToAssColor(hex: string, alpha: number = 0): string {
    hex = hex.replace('#', '');

    // Handle transparent
    if (hex === 'transparent') {
      return '&H80000000';
    }

    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);

    // ASS format: &HAABBGGRR (alpha, blue, green, red)
    const alphaHex = alpha.toString(16).padStart(2, '0').toUpperCase();
    const blueHex = b.toString(16).padStart(2, '0').toUpperCase();
    const greenHex = g.toString(16).padStart(2, '0').toUpperCase();
    const redHex = r.toString(16).padStart(2, '0').toUpperCase();

    return `&H${alphaHex}${blueHex}${greenHex}${redHex}`;
  }

  /**
   * Generate word-by-word highlight captions (TikTok style)
   */
  async generateHighlightCaptions(
    wordTimings: WordTiming[],
    highlightColor: string = '#FFFF00',
    normalColor: string = '#FFFFFF',
    outputPath?: string
  ): Promise<string> {
    // This creates an ASS file with word-by-word highlighting
    const assContent = this.generateAssWithHighlights(wordTimings, highlightColor, normalColor);

    const finalPath =
      outputPath || path.join(this.outputDir, `highlight_captions_${Date.now()}.ass`);
    fs.writeFileSync(finalPath, assContent, 'utf-8');

    logger.info('Highlight captions generated', {
      path: finalPath,
      wordCount: wordTimings.length,
    });

    return finalPath;
  }

  /**
   * Generate ASS subtitle file with word highlighting
   */
  private generateAssWithHighlights(
    wordTimings: WordTiming[],
    highlightColor: string,
    normalColor: string
  ): string {
    const header = `[Script Info]
Title: Generated Captions
ScriptType: v4.00+
WrapStyle: 0
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial Black,72,${this.hexToAssColor(normalColor)},${this.hexToAssColor(highlightColor)},&H00000000,&H80000000,1,0,0,0,100,100,0,0,1,3,1,5,20,20,40,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

    // Group words into phrases
    const phrases = this.groupWordsIntoPhrases(wordTimings);

    // Generate events for each phrase
    const events: string[] = [];

    for (const phrase of phrases) {
      const start = this.secondsToAssTime(phrase.start);
      const end = this.secondsToAssTime(phrase.end);

      // Create text with karaoke effect
      let text = '';
      for (let i = 0; i < phrase.words.length; i++) {
        const word = phrase.words[i];
        const duration = Math.round((word.end - word.start) * 100); // centiseconds
        text += `{\\kf${duration}}${word.word} `;
      }

      events.push(`Dialogue: 0,${start},${end},Default,,0,0,0,,${text.trim()}`);
    }

    return header + events.join('\n');
  }

  /**
   * Group words into display phrases
   */
  private groupWordsIntoPhrases(
    wordTimings: WordTiming[]
  ): Array<{ words: WordTiming[]; start: number; end: number }> {
    const phrases: Array<{ words: WordTiming[]; start: number; end: number }> = [];
    let currentPhrase: { words: WordTiming[]; start: number; end: number } | null = null;

    for (const word of wordTimings) {
      if (!currentPhrase) {
        currentPhrase = {
          words: [word],
          start: word.start,
          end: word.end,
        };
      } else {
        const duration = word.end - currentPhrase.start;
        const text = [...currentPhrase.words, word].map((w) => w.word).join(' ');

        if (duration > this.options.maxDuration || text.length > this.options.maxCharsPerLine * 2) {
          phrases.push(currentPhrase);
          currentPhrase = {
            words: [word],
            start: word.start,
            end: word.end,
          };
        } else {
          currentPhrase.words.push(word);
          currentPhrase.end = word.end;
        }
      }
    }

    if (currentPhrase && currentPhrase.words.length > 0) {
      phrases.push(currentPhrase);
    }

    return phrases;
  }

  /**
   * Convert seconds to ASS time format (H:MM:SS.cc)
   */
  private secondsToAssTime(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const centisecs = Math.round((seconds % 1) * 100);

    return (
      `${hours}:` +
      `${minutes.toString().padStart(2, '0')}:` +
      `${secs.toString().padStart(2, '0')}.` +
      `${centisecs.toString().padStart(2, '0')}`
    );
  }

  /**
   * Adjust caption timing (offset all captions)
   */
  adjustTiming(entries: CaptionEntry[], offsetSeconds: number): CaptionEntry[] {
    return entries.map((entry) => ({
      ...entry,
      startTime: Math.max(0, entry.startTime + offsetSeconds),
      endTime: Math.max(0, entry.endTime + offsetSeconds),
    }));
  }

  /**
   * Merge overlapping captions
   */
  mergeOverlapping(entries: CaptionEntry[]): CaptionEntry[] {
    if (entries.length === 0) return [];

    const sorted = [...entries].sort((a, b) => a.startTime - b.startTime);
    const merged: CaptionEntry[] = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
      const current = sorted[i];
      const previous = merged[merged.length - 1];

      if (current.startTime <= previous.endTime) {
        // Merge
        previous.endTime = Math.max(previous.endTime, current.endTime);
        previous.text = `${previous.text}\n${current.text}`;
      } else {
        merged.push({ ...current, id: merged.length + 1 });
      }
    }

    return merged;
  }

  /**
   * Get output directory
   */
  getOutputDir(): string {
    return this.outputDir;
  }
}

// Singleton instance
let captionGenerator: CaptionGenerator | null = null;

/**
 * Get or create the caption generator instance
 */
export function getCaptionGenerator(options?: CaptionOptions): CaptionGenerator {
  if (!captionGenerator) {
    captionGenerator = new CaptionGenerator(options);
  }
  return captionGenerator;
}

/**
 * Generate SRT from text with timing
 */
export function generateCaptions(text: string, duration: number, outputPath?: string): string {
  const generator = new CaptionGenerator();
  return generator.generateSRTFromText(text, duration, outputPath);
}

/**
 * Burn captions into video
 */
export async function burnCaptionsIntoVideo(
  videoPath: string,
  srtPath: string,
  style?: CaptionStyle | keyof typeof CAPTION_STYLE_PRESETS,
  outputPath?: string
): Promise<string> {
  const generator = new CaptionGenerator();
  return generator.burnCaptions(videoPath, srtPath, style, outputPath);
}
