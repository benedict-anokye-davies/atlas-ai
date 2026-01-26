/**
 * YouTube Trend Analyzer
 * T5-102: Fetch trending topics from YouTube
 *
 * Analyzes YouTube trends, keyword performance, and suggests content topics.
 */

import { getYouTubeClient, YouTubeClient } from './client';
import { createModuleLogger } from '../../utils/logger';
import type { TrendingVideo, TrendData, TopicSuggestion } from '../types';

const logger = createModuleLogger('YouTubeTrends');

// Video category IDs for YouTube
export const VIDEO_CATEGORIES: Record<string, string> = {
  'Film & Animation': '1',
  'Autos & Vehicles': '2',
  Music: '10',
  'Pets & Animals': '15',
  Sports: '17',
  'Short Movies': '18',
  'Travel & Events': '19',
  Gaming: '20',
  Videoblogging: '21',
  'People & Blogs': '22',
  Comedy: '23',
  Entertainment: '24',
  'News & Politics': '25',
  'Howto & Style': '26',
  Education: '27',
  'Science & Technology': '28',
  'Nonprofits & Activism': '29',
  Movies: '30',
  'Anime/Animation': '31',
  'Action/Adventure': '32',
  Classics: '33',
  Documentary: '35',
  Drama: '36',
  Family: '37',
  Foreign: '38',
  Horror: '39',
  'Sci-Fi/Fantasy': '40',
  Thriller: '41',
  Shorts: '42',
  Shows: '43',
  Trailers: '44',
};

// Popular niches for topic suggestions
const NICHE_KEYWORDS: Record<string, string[]> = {
  tech: [
    'ai',
    'artificial intelligence',
    'chatgpt',
    'coding',
    'programming',
    'software',
    'app',
    'gadgets',
    'review',
  ],
  finance: [
    'investing',
    'stocks',
    'crypto',
    'bitcoin',
    'trading',
    'money',
    'passive income',
    'financial freedom',
  ],
  gaming: ['gameplay', 'walkthrough', 'review', 'tips', 'speedrun', 'esports', 'stream highlights'],
  fitness: [
    'workout',
    'exercise',
    'gym',
    'bodybuilding',
    'weight loss',
    'nutrition',
    'meal prep',
    'transformation',
  ],
  lifestyle: ['vlog', 'day in life', 'routine', 'productivity', 'minimalism', 'self improvement'],
  education: [
    'tutorial',
    'how to',
    'explained',
    'learn',
    'course',
    'study',
    'tips',
    'guide',
    'for beginners',
  ],
  entertainment: ['funny', 'compilation', 'reaction', 'challenge', 'prank', 'story time', 'drama'],
  business: ['entrepreneur', 'startup', 'side hustle', 'marketing', 'ecommerce', 'dropshipping'],
};

/**
 * YouTube Trend Analyzer for content discovery
 */
export class YouTubeTrendAnalyzer {
  private client: YouTubeClient;

  constructor(client?: YouTubeClient) {
    this.client = client || getYouTubeClient();
  }

  /**
   * Get currently trending videos
   */
  async getTrending(
    region: string = 'US',
    category?: string,
    maxResults: number = 25
  ): Promise<TrendingVideo[]> {
    const categoryId = category ? VIDEO_CATEGORIES[category] : undefined;
    return this.client.getTrendingVideos(region, categoryId, maxResults);
  }

  /**
   * Get trending videos for multiple categories
   */
  async getTrendingByCategories(
    region: string = 'US',
    categories: string[] = ['Gaming', 'Entertainment', 'Science & Technology']
  ): Promise<Map<string, TrendingVideo[]>> {
    const results = new Map<string, TrendingVideo[]>();

    for (const category of categories) {
      try {
        const videos = await this.getTrending(region, category, 10);
        results.set(category, videos);
      } catch (error) {
        logger.warn(`Failed to get trends for category: ${category}`, { error });
        results.set(category, []);
      }
    }

    return results;
  }

  /**
   * Analyze keyword trends by searching for videos
   */
  async getKeywordTrends(keyword: string, maxResults: number = 50): Promise<TrendData> {
    const videos = await this.client.searchVideos(keyword, maxResults, 'viewCount');

    // Calculate trend metrics from search results
    const totalViews = videos.reduce((sum, v) => sum + v.viewCount, 0);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _avgViews = videos.length > 0 ? totalViews / videos.length : 0;

    // Extract common tags and topics
    const allTags: string[] = [];
    const titleWords: string[] = [];

    for (const video of videos) {
      allTags.push(...video.tags);
      titleWords.push(...video.title.toLowerCase().split(/\s+/));
    }

    // Count tag frequencies
    const tagCounts = this.countFrequencies(allTags);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _wordCounts = this.countFrequencies(titleWords);

    // Filter for meaningful related queries (3+ characters, not common words)
    const stopWords = new Set([
      'the',
      'a',
      'an',
      'and',
      'or',
      'but',
      'in',
      'on',
      'at',
      'to',
      'for',
      'of',
      'with',
      'by',
      'is',
      'it',
      'this',
      'that',
      'how',
      'what',
      'why',
      'when',
      'where',
      'who',
      '|',
      '-',
      '/',
      '&',
    ]);

    const relatedQueries = Object.entries(tagCounts)
      .filter(([tag]) => tag.length > 2 && !stopWords.has(tag.toLowerCase()))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([tag]) => tag);

    // Find rising queries (words appearing in recent videos)
    const recentVideos = videos.slice(0, 10);
    const recentTags: string[] = [];
    for (const video of recentVideos) {
      recentTags.push(...video.tags);
    }
    const recentTagCounts = this.countFrequencies(recentTags);

    const risingQueries = Object.entries(recentTagCounts)
      .filter(([tag]) => tag.length > 2 && !stopWords.has(tag.toLowerCase()))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([tag]) => tag);

    // Calculate trend score (0-100 based on view performance)
    const trendScore = this.calculateTrendScore(videos);

    return {
      keyword,
      searchVolume: totalViews, // Approximation based on top video views
      trendScore,
      relatedQueries,
      risingQueries,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Suggest content topics based on a niche
   */
  async suggestTopics(niche: string, count: number = 5): Promise<TopicSuggestion[]> {
    const suggestions: TopicSuggestion[] = [];
    const nicheKeywords = NICHE_KEYWORDS[niche.toLowerCase()] || [niche];

    // Get trending videos in the niche
    for (const keyword of nicheKeywords.slice(0, 3)) {
      try {
        const trendData = await this.getKeywordTrends(keyword, 20);
        const trendingVideos = await this.client.searchVideos(keyword, 10, 'date');

        // Analyze successful video titles
        const successfulTopics = this.extractTopicPatterns(trendingVideos);

        for (const topic of successfulTopics) {
          const avgViews =
            trendingVideos.reduce((sum, v) => sum + v.viewCount, 0) / trendingVideos.length;

          suggestions.push({
            topic,
            score: trendData.trendScore,
            reasoning: `Based on trending "${keyword}" videos with avg ${this.formatViews(avgViews)} views`,
            keywords: [keyword, ...trendData.relatedQueries.slice(0, 3)],
            estimatedViews: this.estimateViews(avgViews),
            competition: this.assessCompetition(trendingVideos),
          });
        }
      } catch (error) {
        logger.warn(`Failed to analyze niche keyword: ${keyword}`, { error });
      }
    }

    // Sort by score and dedupe
    const uniqueSuggestions = this.dedupeTopics(suggestions);
    return uniqueSuggestions.sort((a, b) => b.score - a.score).slice(0, count);
  }

  /**
   * Analyze a specific topic's potential
   */
  async analyzeTopicPotential(topic: string): Promise<{
    viability: 'high' | 'medium' | 'low';
    competition: 'low' | 'medium' | 'high';
    suggestedAngles: string[];
    keywordsToTarget: string[];
    avgViewsForTopic: number;
    topPerformers: TrendingVideo[];
  }> {
    const videos = await this.client.searchVideos(topic, 25, 'viewCount');
    const trendData = await this.getKeywordTrends(topic, 25);

    const avgViews = videos.reduce((sum, v) => sum + v.viewCount, 0) / (videos.length || 1);
    const topPerformers = videos.slice(0, 5);

    // Analyze title patterns for suggested angles
    const suggestedAngles = this.extractTitleAngles(videos);

    return {
      viability: trendData.trendScore > 70 ? 'high' : trendData.trendScore > 40 ? 'medium' : 'low',
      competition: this.assessCompetition(videos),
      suggestedAngles,
      keywordsToTarget: [...trendData.relatedQueries, ...trendData.risingQueries].slice(0, 10),
      avgViewsForTopic: avgViews,
      topPerformers,
    };
  }

  /**
   * Get video category trending topics
   */
  async getCategoryTrends(): Promise<
    {
      category: string;
      trending: TrendingVideo[];
      topTags: string[];
    }[]
  > {
    const categories = [
      'Gaming',
      'Science & Technology',
      'Entertainment',
      'Education',
      'Howto & Style',
    ];
    const results: { category: string; trending: TrendingVideo[]; topTags: string[] }[] = [];

    for (const category of categories) {
      try {
        const videos = await this.getTrending('US', category, 15);
        const allTags: string[] = [];
        for (const video of videos) {
          allTags.push(...video.tags);
        }
        const tagCounts = this.countFrequencies(allTags);
        const topTags = Object.entries(tagCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([tag]) => tag);

        results.push({
          category,
          trending: videos.slice(0, 5),
          topTags,
        });
      } catch (error) {
        logger.warn(`Failed to get category trends: ${category}`, { error });
      }
    }

    return results;
  }

  // Private helper methods

  private countFrequencies(items: string[]): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const item of items) {
      const normalized = item.toLowerCase().trim();
      if (normalized) {
        counts[normalized] = (counts[normalized] || 0) + 1;
      }
    }
    return counts;
  }

  private calculateTrendScore(videos: TrendingVideo[]): number {
    if (videos.length === 0) return 0;

    // Factors for trend score:
    // 1. Average engagement rate (likes / views)
    // 2. Recency of popular videos
    // 3. View count distribution

    const totalViews = videos.reduce((sum, v) => sum + v.viewCount, 0);
    const totalLikes = videos.reduce((sum, v) => sum + v.likeCount, 0);
    const engagementRate = totalViews > 0 ? totalLikes / totalViews : 0;

    // Base score from engagement (max 50 points)
    const engagementScore = Math.min(engagementRate * 1000, 50);

    // Recency score - more recent = higher score (max 30 points)
    const now = Date.now();
    const avgAgeHours =
      videos.reduce((sum, v) => sum + (now - new Date(v.publishedAt).getTime()) / 3600000, 0) /
      videos.length;
    const recencyScore = Math.max(0, 30 - avgAgeHours / 24); // Lose points after days

    // Volume score - more videos = more interest (max 20 points)
    const volumeScore = Math.min(videos.length * 2, 20);

    return Math.round(engagementScore + recencyScore + volumeScore);
  }

  private extractTopicPatterns(videos: TrendingVideo[]): string[] {
    const patterns: string[] = [];
    const commonPhrases: Record<string, number> = {};

    for (const video of videos) {
      // Extract potential topic hooks from titles
      const title = video.title.toLowerCase();

      // Common video title patterns
      const hooks = [
        /how (?:to|i) (.+?)(?:\s*[|\-[[]|$)/i,
        /(\d+) (?:ways|tips|tricks|things|reasons) (?:to|for) (.+)/i,
        /(.+?) (?:tutorial|guide|explained|review|vs)/i,
        /(?:why|what|when|how) (.+?) (?:is|are|works)/i,
        /the (?:best|ultimate|complete) (.+)/i,
      ];

      for (const pattern of hooks) {
        const match = title.match(pattern);
        if (match) {
          const phrase = match[1] || match[2];
          if (phrase && phrase.length > 5 && phrase.length < 50) {
            commonPhrases[phrase] = (commonPhrases[phrase] || 0) + 1;
          }
        }
      }
    }

    // Get top patterns
    const sortedPhrases = Object.entries(commonPhrases)
      .filter(([_, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    for (const [phrase] of sortedPhrases) {
      patterns.push(this.capitalizePhrase(phrase));
    }

    return patterns;
  }

  private extractTitleAngles(videos: TrendingVideo[]): string[] {
    const angles: string[] = [];
    const anglePatterns = [
      'How to',
      'Top 10',
      'Ultimate guide',
      "Beginner's guide",
      'In-depth review',
      'Comparison',
      'Tutorial',
      'Tips and tricks',
      'Common mistakes',
      'Hidden secrets',
    ];

    // Find which angles work for this topic
    for (const pattern of anglePatterns) {
      const matchingVideos = videos.filter((v) =>
        v.title.toLowerCase().includes(pattern.toLowerCase())
      );
      if (matchingVideos.length > 0) {
        const avgViews =
          matchingVideos.reduce((sum, v) => sum + v.viewCount, 0) / matchingVideos.length;
        if (avgViews > 10000) {
          angles.push(pattern);
        }
      }
    }

    // If no clear angles, suggest generic high-performing ones
    if (angles.length < 3) {
      angles.push('How to', 'Complete guide', 'For beginners');
    }

    return angles.slice(0, 5);
  }

  private assessCompetition(videos: TrendingVideo[]): 'low' | 'medium' | 'high' {
    if (videos.length === 0) return 'low';

    // Competition factors:
    // 1. Number of high-view videos (>100k views)
    // 2. Average subscriber count (approximated by views)
    // 3. Video recency

    const highViewVideos = videos.filter((v) => v.viewCount > 100000).length;
    const veryHighViewVideos = videos.filter((v) => v.viewCount > 1000000).length;

    if (veryHighViewVideos > 5) return 'high';
    if (highViewVideos > 10) return 'high';
    if (highViewVideos > 5) return 'medium';
    return 'low';
  }

  private formatViews(views: number): string {
    if (views >= 1000000) return `${(views / 1000000).toFixed(1)}M`;
    if (views >= 1000) return `${(views / 1000).toFixed(1)}K`;
    return views.toString();
  }

  private estimateViews(avgViews: number): string {
    // Conservative estimate: assume new channel gets 10-30% of avg
    const lowEstimate = Math.round(avgViews * 0.1);
    const highEstimate = Math.round(avgViews * 0.3);
    return `${this.formatViews(lowEstimate)} - ${this.formatViews(highEstimate)}`;
  }

  private capitalizePhrase(phrase: string): string {
    return phrase
      .split(' ')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  private dedupeTopics(topics: TopicSuggestion[]): TopicSuggestion[] {
    const seen = new Set<string>();
    return topics.filter((topic) => {
      const key = topic.topic.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}

// Singleton instance
let trendAnalyzer: YouTubeTrendAnalyzer | null = null;

/**
 * Get the YouTube trend analyzer singleton
 */
export function getYouTubeTrendAnalyzer(): YouTubeTrendAnalyzer {
  if (!trendAnalyzer) {
    trendAnalyzer = new YouTubeTrendAnalyzer();
  }
  return trendAnalyzer;
}

/**
 * Quick access to trending videos
 */
export async function getTrendingVideos(
  region: string = 'US',
  category?: string
): Promise<TrendingVideo[]> {
  const analyzer = getYouTubeTrendAnalyzer();
  return analyzer.getTrending(region, category);
}

/**
 * Quick access to topic suggestions
 */
export async function suggestContentTopics(
  niche: string,
  count: number = 5
): Promise<TopicSuggestion[]> {
  const analyzer = getYouTubeTrendAnalyzer();
  return analyzer.suggestTopics(niche, count);
}
