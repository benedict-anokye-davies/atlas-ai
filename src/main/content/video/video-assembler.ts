/**
 * Video Assembler
 * T5-106: FFmpeg-based video assembly for content automation
 *
 * Combines video clips, audio tracks, and captions into final video output.
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import ffmpeg from 'fluent-ffmpeg';
import { createModuleLogger } from '../../utils/logger';
import type { VideoConfig, VideoClip, AudioTrack, CaptionTrack, CaptionStyle } from '../types';

const logger = createModuleLogger('VideoAssembler');

// Assembly result
export interface AssemblyResult {
  outputPath: string;
  duration: number;
  fileSize: number;
  resolution: { width: number; height: number };
  format: string;
}

// Progress callback
export type ProgressCallback = (progress: {
  percent: number;
  frames?: number;
  currentFps?: number;
  currentKbps?: number;
  targetSize?: number;
  timemark?: string;
}) => void;

// Assembler configuration
export interface AssemblerConfig {
  ffmpegPath?: string;
  ffprobePath?: string;
  tempDir?: string;
  outputDir?: string;
}

// Default resolution presets
export const RESOLUTION_PRESETS = {
  '4k': { width: 3840, height: 2160 },
  '1080p': { width: 1920, height: 1080 },
  '720p': { width: 1280, height: 720 },
  '480p': { width: 854, height: 480 },
  'youtube-short': { width: 1080, height: 1920 },
  tiktok: { width: 1080, height: 1920 },
  'instagram-reel': { width: 1080, height: 1920 },
  'instagram-post': { width: 1080, height: 1080 },
} as const;

/**
 * Video Assembler Class
 * Combines multiple video/audio sources into a final video
 */
export class VideoAssembler {
  private config: Required<AssemblerConfig>;
  private clips: VideoClip[] = [];
  private audioTracks: AudioTrack[] = [];
  private captions: CaptionTrack | null = null;
  private resolution: { width: number; height: number } = { width: 1920, height: 1080 };
  private fps: number = 30;
  private outputFormat: string = 'mp4';

  constructor(config?: AssemblerConfig) {
    const userDataPath = app?.getPath?.('userData') || path.join(process.env.HOME || '', '.atlas');

    this.config = {
      ffmpegPath: config?.ffmpegPath || 'ffmpeg',
      ffprobePath: config?.ffprobePath || 'ffprobe',
      tempDir: config?.tempDir || path.join(userDataPath, 'temp', 'video'),
      outputDir: config?.outputDir || path.join(userDataPath, 'videos'),
    };

    // Configure ffmpeg paths
    if (this.config.ffmpegPath !== 'ffmpeg') {
      ffmpeg.setFfmpegPath(this.config.ffmpegPath);
    }
    if (this.config.ffprobePath !== 'ffprobe') {
      ffmpeg.setFfprobePath(this.config.ffprobePath);
    }

    // Ensure directories exist
    this.ensureDirectories();
  }

  private ensureDirectories(): void {
    [this.config.tempDir, this.config.outputDir].forEach((dir) => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }

  /**
   * Set video resolution
   */
  setResolution(width: number, height: number): this {
    this.resolution = { width, height };
    return this;
  }

  /**
   * Set resolution from preset
   */
  setResolutionPreset(preset: keyof typeof RESOLUTION_PRESETS): this {
    this.resolution = RESOLUTION_PRESETS[preset];
    return this;
  }

  /**
   * Set frames per second
   */
  setFps(fps: number): this {
    this.fps = fps;
    return this;
  }

  /**
   * Set output format
   */
  setFormat(format: 'mp4' | 'webm' | 'mov' | 'avi'): this {
    this.outputFormat = format;
    return this;
  }

  /**
   * Add video clips
   */
  addClips(clips: VideoClip[]): this {
    this.clips.push(...clips);
    return this;
  }

  /**
   * Add a single video clip
   */
  addClip(clip: VideoClip): this {
    this.clips.push(clip);
    return this;
  }

  /**
   * Add audio tracks
   */
  addAudio(tracks: AudioTrack[]): this {
    this.audioTracks.push(...tracks);
    return this;
  }

  /**
   * Add a single audio track
   */
  addAudioTrack(track: AudioTrack): this {
    this.audioTracks.push(track);
    return this;
  }

  /**
   * Set captions
   */
  setCaptions(captions: CaptionTrack): this {
    this.captions = captions;
    return this;
  }

  /**
   * Clear all added media
   */
  clear(): this {
    this.clips = [];
    this.audioTracks = [];
    this.captions = null;
    return this;
  }

  /**
   * Assemble video from configuration
   */
  async assembleVideo(config: VideoConfig, onProgress?: ProgressCallback): Promise<AssemblyResult> {
    logger.info('Assembling video', {
      clips: config.clips.length,
      audio: config.audio.length,
      resolution: config.resolution,
    });

    // Set configuration
    this.resolution = config.resolution;
    this.fps = config.fps;
    this.clips = config.clips;
    this.audioTracks = config.audio;
    this.captions = config.captions || null;

    return this.assemble(config.outputPath, onProgress);
  }

  /**
   * Assemble video from added clips/audio
   */
  async assemble(outputPath?: string, onProgress?: ProgressCallback): Promise<AssemblyResult> {
    if (this.clips.length === 0) {
      throw new Error('No video clips added');
    }

    const finalOutputPath =
      outputPath || path.join(this.config.outputDir, `video_${Date.now()}.${this.outputFormat}`);

    logger.info('Starting video assembly', {
      clips: this.clips.length,
      audioTracks: this.audioTracks.length,
      hasCaptions: !!this.captions,
      output: finalOutputPath,
    });

    try {
      // Step 1: Prepare clips (trim, scale)
      const preparedClips = await this.prepareClips();

      // Step 2: Concatenate clips
      const concatenatedVideo = await this.concatenateClips(preparedClips);

      // Step 3: Add audio tracks
      let videoWithAudio = concatenatedVideo;
      if (this.audioTracks.length > 0) {
        videoWithAudio = await this.mixAudio(concatenatedVideo);
      }

      // Step 4: Add captions if present
      let finalVideo = videoWithAudio;
      if (this.captions) {
        finalVideo = await this.burnCaptions(videoWithAudio, this.captions);
      }

      // Step 5: Final encode
      await this.finalEncode(finalVideo, finalOutputPath, onProgress);

      // Get file info
      const stats = fs.statSync(finalOutputPath);
      const probeData = await this.probe(finalOutputPath);

      // Cleanup temp files
      await this.cleanupTemp([...preparedClips, concatenatedVideo, videoWithAudio]);

      const result: AssemblyResult = {
        outputPath: finalOutputPath,
        duration: probeData.duration,
        fileSize: stats.size,
        resolution: this.resolution,
        format: this.outputFormat,
      };

      logger.info('Video assembly complete', result);
      return result;
    } catch (error) {
      logger.error('Video assembly failed', { error });
      throw error;
    }
  }

  /**
   * Prepare clips (trim, scale to target resolution)
   */
  private async prepareClips(): Promise<string[]> {
    const preparedPaths: string[] = [];

    for (let i = 0; i < this.clips.length; i++) {
      const clip = this.clips[i];
      const outputPath = path.join(this.config.tempDir, `clip_${i}_${Date.now()}.mp4`);

      await new Promise<void>((resolve, reject) => {
        let command = ffmpeg(clip.path);

        // Set start time if specified
        if (clip.startTime > 0) {
          command = command.setStartTime(clip.startTime);
        }

        // Set duration if end time specified
        if (clip.endTime > clip.startTime) {
          command = command.setDuration(clip.endTime - clip.startTime);
        }

        command
          .videoFilters([
            // Scale to target resolution
            `scale=${this.resolution.width}:${this.resolution.height}:force_original_aspect_ratio=decrease`,
            // Pad to exact resolution (letterbox/pillarbox)
            `pad=${this.resolution.width}:${this.resolution.height}:(ow-iw)/2:(oh-ih)/2:black`,
            // Apply opacity if not 1
            ...(clip.opacity < 1 ? [`colorchannelmixer=aa=${clip.opacity}`] : []),
          ])
          .fps(this.fps)
          .outputOptions(['-c:v', 'libx264', '-preset', 'fast', '-crf', '23'])
          .output(outputPath)
          .on('end', () => resolve())
          .on('error', (err) => reject(err))
          .run();
      });

      preparedPaths.push(outputPath);
    }

    return preparedPaths;
  }

  /**
   * Concatenate clips using concat demuxer
   */
  private async concatenateClips(clipPaths: string[]): Promise<string> {
    const outputPath = path.join(this.config.tempDir, `concat_${Date.now()}.mp4`);
    const listPath = path.join(this.config.tempDir, `concat_list_${Date.now()}.txt`);

    // Create concat list file
    const listContent = clipPaths.map((p) => `file '${p.replace(/\\/g, '/')}'`).join('\n');
    fs.writeFileSync(listPath, listContent);

    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input(listPath)
        .inputOptions(['-f', 'concat', '-safe', '0'])
        .outputOptions(['-c', 'copy'])
        .output(outputPath)
        .on('end', () => {
          fs.unlinkSync(listPath);
          resolve();
        })
        .on('error', (err) => {
          fs.unlinkSync(listPath);
          reject(err);
        })
        .run();
    });

    return outputPath;
  }

  /**
   * Mix audio tracks with video
   */
  private async mixAudio(videoPath: string): Promise<string> {
    const outputPath = path.join(this.config.tempDir, `audio_mixed_${Date.now()}.mp4`);

    await new Promise<void>((resolve, reject) => {
      let command = ffmpeg().input(videoPath);

      // Add all audio inputs
      for (const track of this.audioTracks) {
        command = command.input(track.path);
      }

      // Build complex filter for audio mixing
      const filterParts: string[] = [];
      const audioInputs: string[] = [];

      for (let i = 0; i < this.audioTracks.length; i++) {
        const track = this.audioTracks[i];
        const inputIndex = i + 1; // 0 is video
        let audioLabel = `[${inputIndex}:a]`;
        const currentLabel = `audio${i}`;

        // Apply volume
        if (track.volume !== 1) {
          filterParts.push(`${audioLabel}volume=${track.volume}[vol${i}]`);
          audioLabel = `[vol${i}]`;
        }

        // Apply fade in
        if (track.fadeIn && track.fadeIn > 0) {
          filterParts.push(`${audioLabel}afade=t=in:st=0:d=${track.fadeIn}[fadein${i}]`);
          audioLabel = `[fadein${i}]`;
        }

        // Apply fade out (would need duration info)
        if (track.fadeOut && track.fadeOut > 0) {
          // This is simplified - proper implementation would need track duration
          filterParts.push(`${audioLabel}afade=t=out:st=0:d=${track.fadeOut}[fadeout${i}]`);
          audioLabel = `[fadeout${i}]`;
        }

        // Apply delay for start time
        if (track.startTime > 0) {
          filterParts.push(
            `${audioLabel}adelay=${track.startTime * 1000}|${track.startTime * 1000}[delay${i}]`
          );
          audioLabel = `[delay${i}]`;
        }

        filterParts.push(`${audioLabel}aresample=async=1[${currentLabel}]`);
        audioInputs.push(`[${currentLabel}]`);
      }

      // Mix all audio tracks
      if (audioInputs.length > 0) {
        filterParts.push(
          `${audioInputs.join('')}amix=inputs=${audioInputs.length}:duration=longest[aout]`
        );
      }

      const complexFilter = filterParts.join(';');

      command
        .complexFilter(complexFilter)
        .outputOptions([
          '-map',
          '0:v',
          '-map',
          '[aout]',
          '-c:v',
          'copy',
          '-c:a',
          'aac',
          '-b:a',
          '192k',
        ])
        .output(outputPath)
        .on('end', () => resolve())
        .on('error', (err) => reject(err))
        .run();
    });

    return outputPath;
  }

  /**
   * Burn captions into video
   */
  private async burnCaptions(videoPath: string, captions: CaptionTrack): Promise<string> {
    const outputPath = path.join(this.config.tempDir, `captioned_${Date.now()}.mp4`);

    const style = this.buildSubtitleStyle(captions.style);

    await new Promise<void>((resolve, reject) => {
      ffmpeg(videoPath)
        .videoFilters([
          `subtitles='${captions.srtPath.replace(/\\/g, '/')}':force_style='${style}'`,
        ])
        .outputOptions(['-c:a', 'copy'])
        .output(outputPath)
        .on('end', () => resolve())
        .on('error', (err) => reject(err))
        .run();
    });

    return outputPath;
  }

  /**
   * Build ASS/SSA style string from CaptionStyle
   */
  private buildSubtitleStyle(style: CaptionStyle): string {
    const parts: string[] = [];

    // Font
    parts.push(`FontName=${style.fontFamily || 'Arial'}`);
    parts.push(`FontSize=${style.fontSize || 24}`);

    // Colors (ASS format: &HBBGGRR&)
    const primaryColor = this.hexToAss(style.fontColor || '#FFFFFF');
    const backColor = this.hexToAss(style.backgroundColor || '#000000');
    parts.push(`PrimaryColour=${primaryColor}`);
    parts.push(`BackColour=${backColor}`);

    // Alignment based on position
    let alignment = 2; // Bottom center default
    if (style.position === 'top') alignment = 8;
    else if (style.position === 'center') alignment = 5;
    parts.push(`Alignment=${alignment}`);

    // Outline and shadow
    parts.push('Outline=2');
    parts.push('Shadow=1');

    // Bold
    parts.push('Bold=1');

    return parts.join(',');
  }

  /**
   * Convert hex color to ASS format
   */
  private hexToAss(hex: string): string {
    // Remove # if present
    hex = hex.replace('#', '');

    // Parse RGB
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);

    // ASS format is &HBBGGRR& (reversed)
    return `&H${b.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${r.toString(16).padStart(2, '0')}&`.toUpperCase();
  }

  /**
   * Final encode with optimized settings
   */
  private async finalEncode(
    inputPath: string,
    outputPath: string,
    onProgress?: ProgressCallback
  ): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const command = ffmpeg(inputPath)
        .outputOptions([
          '-c:v',
          'libx264',
          '-preset',
          'slow',
          '-crf',
          '18',
          '-c:a',
          'aac',
          '-b:a',
          '192k',
          '-movflags',
          '+faststart', // Enable streaming
        ])
        .output(outputPath);

      if (onProgress) {
        command.on('progress', (progress) => {
          onProgress({
            percent: progress.percent || 0,
            frames: progress.frames,
            currentFps: progress.currentFps,
            currentKbps: progress.currentKbps,
            targetSize: progress.targetSize,
            timemark: progress.timemark,
          });
        });
      }

      command
        .on('end', () => resolve())
        .on('error', (err) => reject(err))
        .run();
    });
  }

  /**
   * Get video metadata using ffprobe
   */
  private probe(filePath: string): Promise<{ duration: number; width: number; height: number }> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err, metadata) => {
        if (err) {
          reject(err);
          return;
        }

        const videoStream = metadata.streams.find((s) => s.codec_type === 'video');
        resolve({
          duration: metadata.format.duration || 0,
          width: videoStream?.width || 0,
          height: videoStream?.height || 0,
        });
      });
    });
  }

  /**
   * Cleanup temp files
   */
  private async cleanupTemp(files: string[]): Promise<void> {
    for (const file of files) {
      try {
        if (fs.existsSync(file)) {
          fs.unlinkSync(file);
        }
      } catch (error) {
        logger.warn('Failed to cleanup temp file', { file, error });
      }
    }
  }

  /**
   * Add voiceover to existing video
   */
  async addVoiceover(
    videoPath: string,
    audioPath: string,
    volume: number = 1.0,
    outputPath?: string
  ): Promise<string> {
    const output = outputPath || path.join(this.config.outputDir, `voiceover_${Date.now()}.mp4`);

    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input(videoPath)
        .input(audioPath)
        .complexFilter([`[1:a]volume=${volume}[a]`, '[0:a][a]amix=inputs=2:duration=first[aout]'])
        .outputOptions(['-map', '0:v', '-map', '[aout]', '-c:v', 'copy', '-c:a', 'aac'])
        .output(output)
        .on('end', () => resolve())
        .on('error', (err) => reject(err))
        .run();
    });

    return output;
  }

  /**
   * Add background music to video
   */
  async addBackgroundMusic(
    videoPath: string,
    musicPath: string,
    volume: number = 0.3,
    outputPath?: string
  ): Promise<string> {
    const output = outputPath || path.join(this.config.outputDir, `music_${Date.now()}.mp4`);

    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input(videoPath)
        .input(musicPath)
        .complexFilter([
          `[1:a]volume=${volume}[music]`,
          '[0:a][music]amix=inputs=2:duration=first:dropout_transition=3[aout]',
        ])
        .outputOptions(['-map', '0:v', '-map', '[aout]', '-c:v', 'copy', '-c:a', 'aac'])
        .output(output)
        .on('end', () => resolve())
        .on('error', (err) => reject(err))
        .run();
    });

    return output;
  }

  /**
   * Resize video to new resolution
   */
  async resize(
    videoPath: string,
    width: number,
    height: number,
    outputPath?: string
  ): Promise<string> {
    const output = outputPath || path.join(this.config.outputDir, `resized_${Date.now()}.mp4`);

    await new Promise<void>((resolve, reject) => {
      ffmpeg(videoPath)
        .videoFilters([
          `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
          `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black`,
        ])
        .outputOptions(['-c:a', 'copy'])
        .output(output)
        .on('end', () => resolve())
        .on('error', (err) => reject(err))
        .run();
    });

    return output;
  }

  /**
   * Trim video to specific duration
   */
  async trim(
    videoPath: string,
    startTime: number,
    duration: number,
    outputPath?: string
  ): Promise<string> {
    const output = outputPath || path.join(this.config.outputDir, `trimmed_${Date.now()}.mp4`);

    await new Promise<void>((resolve, reject) => {
      ffmpeg(videoPath)
        .setStartTime(startTime)
        .setDuration(duration)
        .outputOptions(['-c', 'copy'])
        .output(output)
        .on('end', () => resolve())
        .on('error', (err) => reject(err))
        .run();
    });

    return output;
  }

  /**
   * Extract audio from video
   */
  async extractAudio(videoPath: string, outputPath?: string): Promise<string> {
    const output = outputPath || path.join(this.config.outputDir, `audio_${Date.now()}.mp3`);

    await new Promise<void>((resolve, reject) => {
      ffmpeg(videoPath)
        .noVideo()
        .audioCodec('libmp3lame')
        .audioBitrate('192k')
        .output(output)
        .on('end', () => resolve())
        .on('error', (err) => reject(err))
        .run();
    });

    return output;
  }

  /**
   * Create video from image with duration
   */
  async imageToVideo(imagePath: string, duration: number, outputPath?: string): Promise<string> {
    const output = outputPath || path.join(this.config.outputDir, `image_video_${Date.now()}.mp4`);

    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input(imagePath)
        .inputOptions(['-loop', '1'])
        .outputOptions([
          '-c:v',
          'libx264',
          '-t',
          String(duration),
          '-pix_fmt',
          'yuv420p',
          '-vf',
          `scale=${this.resolution.width}:${this.resolution.height}:force_original_aspect_ratio=decrease,pad=${this.resolution.width}:${this.resolution.height}:(ow-iw)/2:(oh-ih)/2`,
        ])
        .output(output)
        .on('end', () => resolve())
        .on('error', (err) => reject(err))
        .run();
    });

    return output;
  }

  /**
   * Speed up or slow down video
   */
  async changeSpeed(videoPath: string, speed: number, outputPath?: string): Promise<string> {
    const output = outputPath || path.join(this.config.outputDir, `speed_${Date.now()}.mp4`);

    // Video filter for speed change
    const videoSpeed = 1 / speed;
    // Audio filter for speed change
    const audioSpeed = speed;

    await new Promise<void>((resolve, reject) => {
      ffmpeg(videoPath)
        .videoFilters([`setpts=${videoSpeed}*PTS`])
        .audioFilters([`atempo=${audioSpeed}`])
        .output(output)
        .on('end', () => resolve())
        .on('error', (err) => reject(err))
        .run();
    });

    return output;
  }

  /**
   * Get video info
   */
  async getVideoInfo(
    videoPath: string
  ): Promise<{ duration: number; width: number; height: number; fps: number; codec: string }> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(videoPath, (err, metadata) => {
        if (err) {
          reject(err);
          return;
        }

        const videoStream = metadata.streams.find((s) => s.codec_type === 'video');
        // Parse fraction format (e.g., "30000/1001" or "30/1") without eval
        const fps = videoStream?.r_frame_rate
          ? (() => {
              const parts = videoStream.r_frame_rate.split('/');
              if (parts.length === 2) {
                const num = parseFloat(parts[0]);
                const den = parseFloat(parts[1]);
                return den !== 0 ? num / den : 30;
              }
              return parseFloat(videoStream.r_frame_rate) || 30;
            })()
          : 30;

        resolve({
          duration: metadata.format.duration || 0,
          width: videoStream?.width || 0,
          height: videoStream?.height || 0,
          fps: Math.round(fps),
          codec: videoStream?.codec_name || 'unknown',
        });
      });
    });
  }
}

// Singleton instance
let videoAssembler: VideoAssembler | null = null;

/**
 * Get or create the video assembler instance
 */
export function getVideoAssembler(config?: AssemblerConfig): VideoAssembler {
  if (!videoAssembler) {
    videoAssembler = new VideoAssembler(config);
  }
  return videoAssembler;
}

/**
 * Assemble a video from configuration
 */
export async function assembleVideo(
  config: VideoConfig,
  onProgress?: ProgressCallback
): Promise<AssemblyResult> {
  const assembler = new VideoAssembler();
  return assembler.assembleVideo(config, onProgress);
}

/**
 * Quick helper to combine clips with voiceover
 */
export async function createVideoWithVoiceover(
  clips: VideoClip[],
  voiceoverPath: string,
  outputPath: string,
  resolution: { width: number; height: number } = { width: 1920, height: 1080 }
): Promise<AssemblyResult> {
  const config: VideoConfig = {
    outputPath,
    clips,
    audio: [{ path: voiceoverPath, startTime: 0, volume: 1.0 }],
    resolution,
    fps: 30,
  };

  return assembleVideo(config);
}
