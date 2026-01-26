/**
 * YouTube Module Exports
 * T5-101: YouTube API setup
 * T5-102: Trend analyzer
 */

export { YouTubeClient, getYouTubeClient, initializeYouTubeClient } from './client';
export {
  YouTubeTrendAnalyzer,
  getYouTubeTrendAnalyzer,
  getTrendingVideos,
  suggestContentTopics,
  VIDEO_CATEGORIES,
} from './trends';
