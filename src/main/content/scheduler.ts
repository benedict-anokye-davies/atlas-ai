/**
 * Content Scheduler
 * T5-111: Schedule content uploads for optimal posting times
 *
 * Manages a queue of scheduled uploads for YouTube and TikTok.
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import { getErrorMessage } from '../../shared/utils';
import { getYouTubeClient } from './youtube';
import { getTikTokClient } from './tiktok';
import type { VideoMetadata, UploadResult, ScheduledUpload } from './types';
import type { TikTokVideoMetadata, TikTokUploadResult } from './tiktok';

const logger = createModuleLogger('ContentScheduler');

// Scheduler events
export interface ContentSchedulerEvents {
  'upload:started': (upload: ScheduledUpload) => void;
  'upload:completed': (upload: ScheduledUpload, result: UploadResult | TikTokUploadResult) => void;
  'upload:failed': (upload: ScheduledUpload, error: Error) => void;
  'upload:scheduled': (upload: ScheduledUpload) => void;
  'upload:cancelled': (uploadId: string) => void;
}

// Optimal posting times by platform and day
const OPTIMAL_TIMES: Record<string, Record<string, string[]>> = {
  youtube: {
    monday: ['12:00', '15:00', '21:00'],
    tuesday: ['12:00', '15:00', '21:00'],
    wednesday: ['12:00', '15:00', '21:00'],
    thursday: ['12:00', '15:00', '20:00'],
    friday: ['12:00', '15:00', '21:00'],
    saturday: ['10:00', '14:00', '20:00'],
    sunday: ['10:00', '14:00', '20:00'],
  },
  tiktok: {
    monday: ['06:00', '10:00', '22:00'],
    tuesday: ['02:00', '04:00', '09:00'],
    wednesday: ['07:00', '08:00', '23:00'],
    thursday: ['09:00', '12:00', '19:00'],
    friday: ['05:00', '13:00', '15:00'],
    saturday: ['11:00', '19:00', '20:00'],
    sunday: ['07:00', '08:00', '16:00'],
  },
};

/**
 * Content Scheduler Class
 * Manages scheduled uploads for YouTube and TikTok
 */
export class ContentScheduler extends EventEmitter {
  private scheduledUploads: Map<string, ScheduledUpload> = new Map();
  private timers: Map<string, NodeJS.Timeout> = new Map();
  private dataPath: string;
  private isRunning: boolean = false;
  private checkInterval: NodeJS.Timeout | null = null;

  constructor() {
    super();

    const userDataPath = app?.getPath?.('userData') || path.join(process.env.HOME || '', '.atlas');
    this.dataPath = path.join(userDataPath, 'scheduled-uploads.json');

    this.loadScheduledUploads();
  }

  /**
   * Start the scheduler
   */
  start(): void {
    if (this.isRunning) return;

    this.isRunning = true;
    logger.info('Content scheduler started');

    // Check for pending uploads every minute
    this.checkInterval = setInterval(() => {
      this.checkPendingUploads();
    }, 60000);

    // Initial check
    this.checkPendingUploads();
  }

  /**
   * Stop the scheduler
   */
  stop(): void {
    this.isRunning = false;

    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    // Clear all timers
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();

    logger.info('Content scheduler stopped');
  }

  /**
   * Schedule a YouTube upload
   */
  scheduleYouTubeUpload(
    videoPath: string,
    metadata: VideoMetadata,
    scheduledTime: Date
  ): ScheduledUpload {
    const upload: ScheduledUpload = {
      id: this.generateId(),
      platform: 'youtube',
      videoPath,
      metadata,
      scheduledTime,
      status: 'pending',
    };

    this.addScheduledUpload(upload);
    return upload;
  }

  /**
   * Schedule a TikTok upload
   */
  scheduleTikTokUpload(
    videoPath: string,
    metadata: TikTokVideoMetadata,
    scheduledTime: Date
  ): ScheduledUpload {
    const upload: ScheduledUpload = {
      id: this.generateId(),
      platform: 'tiktok',
      videoPath,
      metadata: {
        title: metadata.title || '',
        description: metadata.description,
        tags: [],
        categoryId: '',
        privacyStatus: metadata.privacyLevel === 'PUBLIC_TO_EVERYONE' ? 'public' : 'private',
        madeForKids: false,
      },
      scheduledTime,
      status: 'pending',
    };

    // Store TikTok-specific metadata
    (upload as unknown as { tiktokMetadata: TikTokVideoMetadata }).tiktokMetadata = metadata;

    this.addScheduledUpload(upload);
    return upload;
  }

  /**
   * Schedule upload for optimal time
   */
  scheduleForOptimalTime(
    videoPath: string,
    metadata: VideoMetadata,
    platform: 'youtube' | 'tiktok',
    preferredDay?: string
  ): ScheduledUpload {
    const optimalTime = this.getNextOptimalTime(platform, preferredDay);

    if (platform === 'youtube') {
      return this.scheduleYouTubeUpload(videoPath, metadata, optimalTime);
    } else {
      const tiktokMetadata: TikTokVideoMetadata = {
        description: metadata.description,
        privacyLevel: metadata.privacyStatus === 'public' ? 'PUBLIC_TO_EVERYONE' : 'SELF_ONLY',
      };
      return this.scheduleTikTokUpload(videoPath, tiktokMetadata, optimalTime);
    }
  }

  /**
   * Get next optimal posting time for a platform
   */
  getNextOptimalTime(platform: 'youtube' | 'tiktok', preferredDay?: string): Date {
    const now = new Date();
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const platformTimes = OPTIMAL_TIMES[platform];

    // Find next available optimal time
    for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
      const checkDate = new Date(now);
      checkDate.setDate(now.getDate() + dayOffset);

      const dayName = days[checkDate.getDay()];

      // Skip if preferred day is set and doesn't match
      if (preferredDay && dayName !== preferredDay.toLowerCase()) {
        continue;
      }

      const times = platformTimes[dayName];

      for (const timeStr of times) {
        const [hours, minutes] = timeStr.split(':').map(Number);
        const candidateTime = new Date(checkDate);
        candidateTime.setHours(hours, minutes, 0, 0);

        // Only consider future times
        if (candidateTime > now) {
          logger.info('Found optimal time', { platform, time: candidateTime, day: dayName });
          return candidateTime;
        }
      }
    }

    // Fallback: schedule for tomorrow at noon
    const fallback = new Date(now);
    fallback.setDate(now.getDate() + 1);
    fallback.setHours(12, 0, 0, 0);
    return fallback;
  }

  /**
   * Cancel a scheduled upload
   */
  cancelUpload(uploadId: string): boolean {
    const upload = this.scheduledUploads.get(uploadId);

    if (!upload) {
      return false;
    }

    if (upload.status === 'uploading') {
      logger.warn('Cannot cancel upload in progress', { uploadId });
      return false;
    }

    // Clear timer if exists
    const timer = this.timers.get(uploadId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(uploadId);
    }

    this.scheduledUploads.delete(uploadId);
    this.saveScheduledUploads();

    this.emit('upload:cancelled', uploadId);
    logger.info('Upload cancelled', { uploadId });

    return true;
  }

  /**
   * Get all scheduled uploads
   */
  getScheduledUploads(): ScheduledUpload[] {
    return Array.from(this.scheduledUploads.values());
  }

  /**
   * Get pending uploads
   */
  getPendingUploads(): ScheduledUpload[] {
    return this.getScheduledUploads().filter((u) => u.status === 'pending');
  }

  /**
   * Get completed uploads
   */
  getCompletedUploads(): ScheduledUpload[] {
    return this.getScheduledUploads().filter((u) => u.status === 'completed');
  }

  /**
   * Get failed uploads
   */
  getFailedUploads(): ScheduledUpload[] {
    return this.getScheduledUploads().filter((u) => u.status === 'failed');
  }

  /**
   * Reschedule a failed upload
   */
  rescheduleUpload(uploadId: string, newTime: Date): boolean {
    const upload = this.scheduledUploads.get(uploadId);

    if (!upload) {
      return false;
    }

    upload.scheduledTime = newTime;
    upload.status = 'pending';
    upload.error = undefined;

    this.scheduledUploads.set(uploadId, upload);
    this.saveScheduledUploads();
    this.scheduleUploadTimer(upload);

    logger.info('Upload rescheduled', { uploadId, newTime });
    return true;
  }

  /**
   * Add a scheduled upload
   */
  private addScheduledUpload(upload: ScheduledUpload): void {
    this.scheduledUploads.set(upload.id, upload);
    this.saveScheduledUploads();

    this.emit('upload:scheduled', upload);
    logger.info('Upload scheduled', {
      id: upload.id,
      platform: upload.platform,
      time: upload.scheduledTime,
    });

    // Schedule the timer
    this.scheduleUploadTimer(upload);
  }

  /**
   * Schedule a timer for the upload
   */
  private scheduleUploadTimer(upload: ScheduledUpload): void {
    // Clear existing timer
    const existingTimer = this.timers.get(upload.id);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const delay = upload.scheduledTime.getTime() - Date.now();

    if (delay <= 0) {
      // Already past scheduled time, execute immediately
      this.executeUpload(upload);
      return;
    }

    // JavaScript timers have a max of ~24 days, check periodically for longer delays
    if (delay > 2147483647) {
      logger.info('Upload scheduled too far in future, will check periodically', {
        id: upload.id,
      });
      return;
    }

    const timer = setTimeout(() => {
      this.executeUpload(upload);
    }, delay);

    this.timers.set(upload.id, timer);
  }

  /**
   * Check for pending uploads that need to be executed
   */
  private checkPendingUploads(): void {
    const now = Date.now();

    for (const upload of this.scheduledUploads.values()) {
      if (upload.status === 'pending' && upload.scheduledTime.getTime() <= now) {
        this.executeUpload(upload);
      } else if (upload.status === 'pending' && !this.timers.has(upload.id)) {
        // Timer might have been lost on restart, reschedule
        this.scheduleUploadTimer(upload);
      }
    }
  }

  /**
   * Execute an upload
   */
  private async executeUpload(upload: ScheduledUpload): Promise<void> {
    if (upload.status !== 'pending') {
      return;
    }

    // Clear timer
    const timer = this.timers.get(upload.id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(upload.id);
    }

    upload.status = 'uploading';
    this.saveScheduledUploads();

    this.emit('upload:started', upload);
    logger.info('Starting scheduled upload', { id: upload.id, platform: upload.platform });

    try {
      let result: UploadResult | TikTokUploadResult;

      if (upload.platform === 'youtube') {
        const client = getYouTubeClient();
        result = await client.uploadVideo(upload.videoPath, upload.metadata);
        upload.result = result as UploadResult;
      } else {
        const client = getTikTokClient();
        const tiktokMeta = (upload as unknown as { tiktokMetadata: TikTokVideoMetadata })
          .tiktokMetadata || {
          description: upload.metadata.description,
          privacyLevel: 'SELF_ONLY' as const,
        };
        result = await client.uploadVideo(upload.videoPath, tiktokMeta);
        upload.result = {
          videoId: result.videoId || result.shareId,
          title: upload.metadata.title,
          status: result.status === 'published' ? 'published' : 'processing',
          watchUrl: `https://www.tiktok.com/@user/video/${result.videoId || result.shareId}`,
        };
      }

      upload.status = 'completed';
      this.saveScheduledUploads();

      this.emit('upload:completed', upload, result);
      logger.info('Scheduled upload completed', { id: upload.id, result });
    } catch (error) {
      upload.status = 'failed';
      upload.error = getErrorMessage(error);
      this.saveScheduledUploads();

      this.emit('upload:failed', upload, error as Error);
      logger.error('Scheduled upload failed', { id: upload.id, error });
    }
  }

  /**
   * Load scheduled uploads from disk
   */
  private loadScheduledUploads(): void {
    try {
      if (fs.existsSync(this.dataPath)) {
        const data = JSON.parse(fs.readFileSync(this.dataPath, 'utf-8'));

        for (const upload of data.uploads || []) {
          // Convert date strings back to Date objects
          upload.scheduledTime = new Date(upload.scheduledTime);
          this.scheduledUploads.set(upload.id, upload);
        }

        logger.info('Loaded scheduled uploads', { count: this.scheduledUploads.size });
      }
    } catch (error) {
      logger.error('Failed to load scheduled uploads', { error });
    }
  }

  /**
   * Save scheduled uploads to disk
   */
  private saveScheduledUploads(): void {
    try {
      const data = {
        uploads: Array.from(this.scheduledUploads.values()),
        lastUpdated: new Date().toISOString(),
      };
      fs.writeFileSync(this.dataPath, JSON.stringify(data, null, 2));
    } catch (error) {
      logger.error('Failed to save scheduled uploads', { error });
    }
  }

  /**
   * Generate unique upload ID
   */
  private generateId(): string {
    return `upload_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Get scheduler statistics
   */
  getStats(): {
    total: number;
    pending: number;
    completed: number;
    failed: number;
    uploading: number;
  } {
    const uploads = Array.from(this.scheduledUploads.values());
    return {
      total: uploads.length,
      pending: uploads.filter((u) => u.status === 'pending').length,
      completed: uploads.filter((u) => u.status === 'completed').length,
      failed: uploads.filter((u) => u.status === 'failed').length,
      uploading: uploads.filter((u) => u.status === 'uploading').length,
    };
  }

  /**
   * Clear completed uploads older than specified days
   */
  clearOldUploads(daysOld: number = 30): number {
    const cutoff = Date.now() - daysOld * 24 * 60 * 60 * 1000;
    let cleared = 0;

    for (const [id, upload] of this.scheduledUploads.entries()) {
      if (upload.status === 'completed' && upload.scheduledTime.getTime() < cutoff) {
        this.scheduledUploads.delete(id);
        cleared++;
      }
    }

    if (cleared > 0) {
      this.saveScheduledUploads();
      logger.info('Cleared old uploads', { cleared, daysOld });
    }

    return cleared;
  }

  /**
   * Clear all failed uploads
   */
  clearFailedUploads(): number {
    let cleared = 0;

    for (const [id, upload] of this.scheduledUploads.entries()) {
      if (upload.status === 'failed') {
        this.scheduledUploads.delete(id);
        cleared++;
      }
    }

    if (cleared > 0) {
      this.saveScheduledUploads();
      logger.info('Cleared failed uploads', { cleared });
    }

    return cleared;
  }
}

// Singleton instance
let contentScheduler: ContentScheduler | null = null;

/**
 * Get or create the content scheduler instance
 */
export function getContentScheduler(): ContentScheduler {
  if (!contentScheduler) {
    contentScheduler = new ContentScheduler();
  }
  return contentScheduler;
}

/**
 * Start the content scheduler
 */
export function startContentScheduler(): void {
  getContentScheduler().start();
}

/**
 * Stop the content scheduler
 */
export function stopContentScheduler(): void {
  if (contentScheduler) {
    contentScheduler.stop();
  }
}
