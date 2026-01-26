/**
 * Content Automation Module
 * T5 - Phase 9: Content Automation
 *
 * This module provides tools for automated content creation and publishing:
 * - YouTube API integration (trending, upload, analytics)
 * - TikTok API integration (upload, analytics)
 * - Video script generation with LLM
 * - Voiceover generation with ElevenLabs
 * - Stock footage sourcing (Pexels, Pixabay)
 * - Video generation with FFmpeg
 * - Auto-captioning
 * - Content scheduling for optimal posting times
 */

// YouTube
export * from './youtube';

// TikTok
export * from './tiktok';

// Video
export * from './video';

// Scheduler
export {
  ContentScheduler,
  getContentScheduler,
  startContentScheduler,
  stopContentScheduler,
  type ContentSchedulerEvents,
} from './scheduler';

// Re-export types
export type {
  YouTubeCredentials,
  YouTubeTokens,
  TrendingVideo,
  TrendData,
  TopicSuggestion,
  VideoMetadata,
  UploadResult,
  VideoAnalytics,
  VideoStyle,
  Script,
  ScriptSection,
  VideoConfig,
  VideoClip,
  AudioTrack,
  CaptionTrack,
  CaptionStyle,
  StockVideo,
  StockSearchParams,
  TikTokTrend,
  ScheduledUpload,
} from './types';
