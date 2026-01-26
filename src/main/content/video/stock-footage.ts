/**
 * Stock Footage Sourcing
 * T5-105: Source stock videos from Pexels and Pixabay
 */

import { createModuleLogger } from '../../utils/logger';
import { app } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { StockVideo, StockSearchParams } from '../types';

const logger = createModuleLogger('stock-footage');

/**
 * Pexels API response types
 */
interface PexelsVideoFile {
  id: number;
  quality: string;
  file_type: string;
  width: number;
  height: number;
  link: string;
}

interface PexelsVideo {
  id: number;
  width: number;
  height: number;
  duration: number;
  url: string;
  image: string;
  user: {
    name: string;
    url: string;
  };
  video_files: PexelsVideoFile[];
}

interface PexelsSearchResponse {
  page: number;
  per_page: number;
  total_results: number;
  videos: PexelsVideo[];
  next_page?: string;
}

/**
 * Pixabay API response types
 */
interface PixabayVideo {
  id: number;
  pageURL: string;
  type: string;
  tags: string;
  duration: number;
  picture_id: string;
  videos: {
    large: { url: string; width: number; height: number; size: number };
    medium: { url: string; width: number; height: number; size: number };
    small: { url: string; width: number; height: number; size: number };
    tiny: { url: string; width: number; height: number; size: number };
  };
  views: number;
  downloads: number;
  likes: number;
  comments: number;
  user_id: number;
  user: string;
  userImageURL: string;
}

interface PixabaySearchResponse {
  total: number;
  totalHits: number;
  hits: PixabayVideo[];
}

/**
 * Stock Footage Manager
 * Aggregates stock video search across multiple providers
 */
export class StockFootageManager {
  private pexelsApiKey: string | null = null;
  private pixabayApiKey: string | null = null;
  private downloadDir: string;
  private cache: Map<string, StockVideo[]> = new Map();
  private cacheTimeout: number = 30 * 60 * 1000; // 30 minutes

  constructor() {
    this.downloadDir = path.join(app.getPath('userData'), 'stock-footage');
    this.loadApiKeys();
  }

  /**
   * Load API keys from environment
   */
  private loadApiKeys(): void {
    this.pexelsApiKey = process.env.PEXELS_API_KEY || null;
    this.pixabayApiKey = process.env.PIXABAY_API_KEY || null;

    if (!this.pexelsApiKey && !this.pixabayApiKey) {
      logger.warn('No stock footage API keys configured');
    }
  }

  /**
   * Set API keys programmatically
   */
  setApiKeys(pexelsKey?: string, pixabayKey?: string): void {
    if (pexelsKey) this.pexelsApiKey = pexelsKey;
    if (pixabayKey) this.pixabayApiKey = pixabayKey;
  }

  /**
   * Ensure download directory exists
   */
  private async ensureDownloadDir(): Promise<void> {
    try {
      await fs.mkdir(this.downloadDir, { recursive: true });
    } catch (error) {
      logger.error('Failed to create download directory', { error });
    }
  }

  /**
   * Search for stock videos across all providers
   */
  async search(params: StockSearchParams): Promise<StockVideo[]> {
    const cacheKey = JSON.stringify(params);

    // Check cache
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    const results: StockVideo[] = [];

    // Search Pexels
    if (this.pexelsApiKey) {
      try {
        const pexelsResults = await this.searchPexels(params);
        results.push(...pexelsResults);
      } catch (error) {
        logger.error('Pexels search failed', { error });
      }
    }

    // Search Pixabay
    if (this.pixabayApiKey) {
      try {
        const pixabayResults = await this.searchPixabay(params);
        results.push(...pixabayResults);
      } catch (error) {
        logger.error('Pixabay search failed', { error });
      }
    }

    // Sort by relevance (interleave results)
    const sortedResults = this.interleaveResults(results);

    // Cache results
    this.cache.set(cacheKey, sortedResults);
    setTimeout(() => this.cache.delete(cacheKey), this.cacheTimeout);

    logger.info('Stock footage search completed', {
      query: params.query,
      totalResults: sortedResults.length,
    });

    return sortedResults;
  }

  /**
   * Search Pexels API
   */
  private async searchPexels(params: StockSearchParams): Promise<StockVideo[]> {
    if (!this.pexelsApiKey) return [];

    const url = new URL('https://api.pexels.com/videos/search');
    url.searchParams.set('query', params.query);
    url.searchParams.set('per_page', String(params.perPage || 15));
    url.searchParams.set('page', String(params.page || 1));

    if (params.orientation) {
      url.searchParams.set('orientation', params.orientation);
    }

    if (params.size) {
      url.searchParams.set('size', params.size);
    }

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: this.pexelsApiKey,
      },
    });

    if (!response.ok) {
      throw new Error(`Pexels API error: ${response.status}`);
    }

    const data: PexelsSearchResponse = await response.json();

    return data.videos
      .filter((video) => {
        // Filter by duration if specified
        if (params.minDuration && video.duration < params.minDuration) return false;
        if (params.maxDuration && video.duration > params.maxDuration) return false;
        return true;
      })
      .map((video) => this.mapPexelsVideo(video));
  }

  /**
   * Map Pexels video to StockVideo
   */
  private mapPexelsVideo(video: PexelsVideo): StockVideo {
    // Get the best quality video file
    const bestFile =
      video.video_files.find((f) => f.quality === 'hd') ||
      video.video_files.find((f) => f.quality === 'sd') ||
      video.video_files[0];

    return {
      id: `pexels_${video.id}`,
      source: 'pexels',
      url: video.url,
      downloadUrl: bestFile.link,
      width: bestFile.width,
      height: bestFile.height,
      duration: video.duration,
      thumbnail: video.image,
      user: video.user.name,
      tags: [], // Pexels doesn't provide tags in search results
    };
  }

  /**
   * Search Pixabay API
   */
  private async searchPixabay(params: StockSearchParams): Promise<StockVideo[]> {
    if (!this.pixabayApiKey) return [];

    const url = new URL('https://pixabay.com/api/videos/');
    url.searchParams.set('key', this.pixabayApiKey);
    url.searchParams.set('q', params.query);
    url.searchParams.set('per_page', String(params.perPage || 15));
    url.searchParams.set('page', String(params.page || 1));

    if (params.minDuration) {
      url.searchParams.set('min_duration', String(params.minDuration));
    }

    if (params.maxDuration) {
      url.searchParams.set('max_duration', String(params.maxDuration));
    }

    const response = await fetch(url.toString());

    if (!response.ok) {
      throw new Error(`Pixabay API error: ${response.status}`);
    }

    const data: PixabaySearchResponse = await response.json();

    return data.hits.map((video) => this.mapPixabayVideo(video));
  }

  /**
   * Map Pixabay video to StockVideo
   */
  private mapPixabayVideo(video: PixabayVideo): StockVideo {
    // Prefer large, fallback to medium
    const videoData = video.videos.large || video.videos.medium;

    return {
      id: `pixabay_${video.id}`,
      source: 'pixabay',
      url: video.pageURL,
      downloadUrl: videoData.url,
      width: videoData.width,
      height: videoData.height,
      duration: video.duration,
      thumbnail: `https://i.vimeocdn.com/video/${video.picture_id}_640x360.jpg`,
      user: video.user,
      tags: video.tags.split(',').map((t) => t.trim()),
    };
  }

  /**
   * Interleave results from different sources
   */
  private interleaveResults(results: StockVideo[]): StockVideo[] {
    const pexels = results.filter((r) => r.source === 'pexels');
    const pixabay = results.filter((r) => r.source === 'pixabay');

    const interleaved: StockVideo[] = [];
    const maxLen = Math.max(pexels.length, pixabay.length);

    for (let i = 0; i < maxLen; i++) {
      if (i < pexels.length) interleaved.push(pexels[i]);
      if (i < pixabay.length) interleaved.push(pixabay[i]);
    }

    return interleaved;
  }

  /**
   * Download a stock video
   */
  async download(video: StockVideo): Promise<string> {
    await this.ensureDownloadDir();

    const filename = `${video.id}_${Date.now()}.mp4`;
    const filepath = path.join(this.downloadDir, filename);

    logger.info('Downloading stock video', { id: video.id, url: video.downloadUrl });

    const response = await fetch(video.downloadUrl);
    if (!response.ok) {
      throw new Error(`Failed to download video: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    await fs.writeFile(filepath, Buffer.from(arrayBuffer));

    logger.info('Stock video downloaded', { id: video.id, filepath });

    return filepath;
  }

  /**
   * Download multiple videos in parallel
   */
  async downloadBatch(
    videos: StockVideo[],
    maxConcurrent: number = 3
  ): Promise<{ video: StockVideo; path: string }[]> {
    const results: { video: StockVideo; path: string }[] = [];

    for (let i = 0; i < videos.length; i += maxConcurrent) {
      const batch = videos.slice(i, i + maxConcurrent);
      const batchResults = await Promise.all(
        batch.map(async (video) => {
          try {
            const filepath = await this.download(video);
            return { video, path: filepath };
          } catch (error) {
            logger.error('Failed to download video', { id: video.id, error });
            return null;
          }
        })
      );

      results.push(
        ...batchResults.filter((r): r is { video: StockVideo; path: string } => r !== null)
      );
    }

    return results;
  }

  /**
   * Search and download matching videos
   */
  async searchAndDownload(
    params: StockSearchParams,
    count: number = 5
  ): Promise<{ video: StockVideo; path: string }[]> {
    const videos = await this.search(params);
    const toDownload = videos.slice(0, count);
    return this.downloadBatch(toDownload);
  }

  /**
   * Get curated videos for a topic (uses predefined keywords)
   */
  async getCuratedForTopic(topic: string): Promise<StockVideo[]> {
    // Map common topics to better search queries
    const topicKeywords: Record<string, string[]> = {
      technology: ['technology', 'computer', 'coding', 'digital', 'innovation'],
      business: ['business', 'office', 'meeting', 'success', 'corporate'],
      finance: ['finance', 'money', 'investment', 'trading', 'stock market'],
      nature: ['nature', 'landscape', 'forest', 'ocean', 'wildlife'],
      city: ['city', 'urban', 'skyline', 'traffic', 'street'],
      people: ['people', 'crowd', 'lifestyle', 'happy', 'working'],
      food: ['food', 'cooking', 'restaurant', 'kitchen', 'healthy'],
      fitness: ['fitness', 'gym', 'workout', 'running', 'health'],
      travel: ['travel', 'vacation', 'adventure', 'destination', 'tourism'],
      education: ['education', 'school', 'learning', 'books', 'classroom'],
    };

    const keywords = topicKeywords[topic.toLowerCase()] || [topic];
    const allResults: StockVideo[] = [];

    // Search for each keyword
    for (const keyword of keywords.slice(0, 3)) {
      const results = await this.search({
        query: keyword,
        perPage: 5,
      });
      allResults.push(...results);
    }

    // Remove duplicates
    const unique = Array.from(new Map(allResults.map((v) => [v.id, v])).values());

    return unique;
  }

  /**
   * Clean up downloaded files older than specified days
   */
  async cleanupOldDownloads(daysOld: number = 7): Promise<number> {
    try {
      const files = await fs.readdir(this.downloadDir);
      const cutoff = Date.now() - daysOld * 24 * 60 * 60 * 1000;
      let deleted = 0;

      for (const file of files) {
        const filepath = path.join(this.downloadDir, file);
        const stat = await fs.stat(filepath);

        if (stat.mtime.getTime() < cutoff) {
          await fs.unlink(filepath);
          deleted++;
        }
      }

      logger.info('Cleaned up old downloads', { deleted, daysOld });
      return deleted;
    } catch (error) {
      logger.error('Failed to cleanup downloads', { error });
      return 0;
    }
  }

  /**
   * Get download directory path
   */
  getDownloadDir(): string {
    return this.downloadDir;
  }

  /**
   * Check if API keys are configured
   */
  isConfigured(): boolean {
    return !!(this.pexelsApiKey || this.pixabayApiKey);
  }
}

// Singleton instance
let stockFootageManager: StockFootageManager | null = null;

/**
 * Get or create the stock footage manager instance
 */
export function getStockFootageManager(): StockFootageManager {
  if (!stockFootageManager) {
    stockFootageManager = new StockFootageManager();
  }
  return stockFootageManager;
}
