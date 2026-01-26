/**
 * Content Automation Types
 * T5 - Phase 9: Content Automation
 */

// YouTube Types
export interface YouTubeCredentials {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface YouTubeTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface TrendingVideo {
  id: string;
  title: string;
  description: string;
  channelId: string;
  channelTitle: string;
  publishedAt: string;
  thumbnailUrl: string;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  duration: string;
  tags: string[];
  categoryId: string;
}

export interface TrendData {
  keyword: string;
  searchVolume: number;
  trendScore: number;
  relatedQueries: string[];
  risingQueries: string[];
  timestamp: string;
}

export interface TopicSuggestion {
  topic: string;
  score: number;
  reasoning: string;
  keywords: string[];
  estimatedViews: string;
  competition: 'low' | 'medium' | 'high';
}

export interface VideoMetadata {
  title: string;
  description: string;
  tags: string[];
  categoryId: string;
  privacyStatus: 'private' | 'unlisted' | 'public';
  madeForKids: boolean;
  defaultLanguage?: string;
  defaultAudioLanguage?: string;
}

export interface UploadResult {
  videoId: string;
  title: string;
  status: 'uploaded' | 'processing' | 'published' | 'failed';
  publishedAt?: string;
  thumbnailUrl?: string;
  watchUrl: string;
}

export interface VideoAnalytics {
  videoId: string;
  views: number;
  likes: number;
  dislikes: number;
  comments: number;
  shares: number;
  averageViewDuration: number;
  averageViewPercentage: number;
  subscribersGained: number;
  estimatedRevenue?: number;
  period: {
    start: string;
    end: string;
  };
}

// Video Production Types
export interface VideoStyle {
  type: 'faceless' | 'avatar' | 'compilation' | 'reddit-story';
  tone: 'informative' | 'entertaining' | 'dramatic' | 'casual';
  pacing: 'slow' | 'medium' | 'fast';
  voiceStyle: string;
}

export interface Script {
  hook: string;
  sections: ScriptSection[];
  cta: string;
  estimatedDuration: number;
  voiceoverText: string;
}

export interface ScriptSection {
  title: string;
  content: string;
  visualNotes: string;
  duration: number;
}

export interface VideoConfig {
  outputPath: string;
  clips: VideoClip[];
  audio: AudioTrack[];
  captions?: CaptionTrack;
  resolution: {
    width: number;
    height: number;
  };
  fps: number;
}

export interface VideoClip {
  path: string;
  startTime: number;
  endTime: number;
  position: { x: number; y: number };
  scale: number;
  opacity: number;
}

export interface AudioTrack {
  path: string;
  startTime: number;
  volume: number;
  fadeIn?: number;
  fadeOut?: number;
}

export interface CaptionTrack {
  srtPath: string;
  style: CaptionStyle;
}

export interface CaptionStyle {
  fontFamily: string;
  fontSize: number;
  fontColor: string;
  backgroundColor: string;
  position: 'top' | 'center' | 'bottom';
  animation: 'none' | 'fade' | 'typewriter' | 'highlight';
}

// Stock Footage Types
export interface StockVideo {
  id: string;
  source: 'pexels' | 'pixabay';
  url: string;
  downloadUrl: string;
  width: number;
  height: number;
  duration: number;
  thumbnail: string;
  user: string;
  tags: string[];
}

export interface StockSearchParams {
  query: string;
  orientation?: 'landscape' | 'portrait' | 'square';
  size?: 'large' | 'medium' | 'small';
  minDuration?: number;
  maxDuration?: number;
  page?: number;
  perPage?: number;
}

// TikTok Types (limited API)
export interface TikTokTrend {
  hashtag: string;
  viewCount: number;
  videoCount: number;
  description: string;
  isPromoted: boolean;
}

// Content Scheduler Types
export interface ScheduledUpload {
  id: string;
  platform: 'youtube' | 'tiktok';
  videoPath: string;
  metadata: VideoMetadata;
  scheduledTime: Date;
  status: 'pending' | 'uploading' | 'completed' | 'failed';
  result?: UploadResult;
  error?: string;
}
