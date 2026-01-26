/**
 * YouTube API Client
 * T5-101: YouTube API setup with OAuth for YouTube Data API v3
 *
 * Handles authentication, trending videos, uploads, and analytics.
 */

import { google, youtube_v3 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import * as fs from 'fs';
import * as path from 'path';
import { app, shell } from 'electron';
import { createServer, Server, IncomingMessage, ServerResponse } from 'http';
import { URL } from 'url';
import { createModuleLogger } from '../../utils/logger';
import type {
  YouTubeCredentials,
  YouTubeTokens,
  TrendingVideo,
  VideoMetadata,
  UploadResult,
  VideoAnalytics,
} from '../types';

const logger = createModuleLogger('YouTubeClient');

// YouTube API scopes required
const SCOPES = [
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.force-ssl',
  'https://www.googleapis.com/auth/youtubepartner',
];

// Default redirect URI for local OAuth
const DEFAULT_REDIRECT_URI = 'http://localhost:8089/oauth2callback';

/**
 * YouTube API Client with OAuth2 authentication
 */
export class YouTubeClient {
  private oauth2Client: OAuth2Client | null = null;
  private youtube: youtube_v3.Youtube | null = null;
  private tokens: YouTubeTokens | null = null;
  private credentials: YouTubeCredentials | null = null;
  private tokenPath: string;
  private authServer: Server | null = null;

  constructor() {
    // Store tokens in user data directory
    const userDataPath = app?.getPath?.('userData') || path.join(process.env.HOME || '', '.atlas');
    this.tokenPath = path.join(userDataPath, 'youtube-tokens.json');
  }

  /**
   * Initialize the client with credentials
   */
  async initialize(credentials: YouTubeCredentials): Promise<void> {
    this.credentials = credentials;

    this.oauth2Client = new google.auth.OAuth2(
      credentials.clientId,
      credentials.clientSecret,
      credentials.redirectUri || DEFAULT_REDIRECT_URI
    );

    // Try to load existing tokens
    await this.loadTokens();

    if (this.tokens) {
      this.oauth2Client.setCredentials({
        access_token: this.tokens.accessToken,
        refresh_token: this.tokens.refreshToken,
        expiry_date: this.tokens.expiresAt,
      });

      // Check if token needs refresh
      if (Date.now() >= this.tokens.expiresAt - 60000) {
        await this.refreshAccessToken();
      }

      this.youtube = google.youtube({ version: 'v3', auth: this.oauth2Client! });
      logger.info('YouTube client initialized with existing tokens');
    } else {
      logger.info('YouTube client initialized, authorization required');
    }
  }

  /**
   * Check if the client is authorized
   */
  isAuthorized(): boolean {
    return this.tokens !== null && this.youtube !== null;
  }

  /**
   * Get authorization URL for OAuth flow
   */
  getAuthorizationUrl(): string {
    if (!this.oauth2Client) {
      throw new Error('Client not initialized. Call initialize() first.');
    }

    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      prompt: 'consent', // Force to get refresh token
    });
  }

  /**
   * Start OAuth flow - opens browser and waits for callback
   */
  async authorize(): Promise<void> {
    if (!this.oauth2Client || !this.credentials) {
      throw new Error('Client not initialized. Call initialize() first.');
    }

    return new Promise((resolve, reject) => {
      const redirectUri = new URL(this.credentials!.redirectUri || DEFAULT_REDIRECT_URI);
      const port = parseInt(redirectUri.port) || 8089;

      // Create temporary server to receive OAuth callback
      this.authServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
        try {
          const reqUrl = new URL(req.url || '', `http://localhost:${port}`);

          if (reqUrl.pathname === '/oauth2callback') {
            const code = reqUrl.searchParams.get('code');
            const error = reqUrl.searchParams.get('error');

            if (error) {
              res.writeHead(400, { 'Content-Type': 'text/html' });
              res.end(`<h1>Authorization Failed</h1><p>${error}</p>`);
              this.authServer?.close();
              reject(new Error(`OAuth error: ${error}`));
              return;
            }

            if (code) {
              // Exchange code for tokens
              const { tokens } = await this.oauth2Client!.getToken(code);

              this.tokens = {
                accessToken: tokens.access_token!,
                refreshToken: tokens.refresh_token!,
                expiresAt: tokens.expiry_date || Date.now() + 3600000,
              };

              this.oauth2Client!.setCredentials(tokens);
              await this.saveTokens();

              this.youtube = google.youtube({ version: 'v3', auth: this.oauth2Client! });

              res.writeHead(200, { 'Content-Type': 'text/html' });
              res.end(`
                <html>
                  <body style="font-family: system-ui; text-align: center; padding: 50px;">
                    <h1>Authorization Successful!</h1>
                    <p>You can close this window and return to Atlas.</p>
                    <script>setTimeout(() => window.close(), 3000);</script>
                  </body>
                </html>
              `);

              this.authServer?.close();
              logger.info('YouTube authorization successful');
              resolve();
            }
          }
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'text/html' });
          res.end(`<h1>Error</h1><p>${err}</p>`);
          this.authServer?.close();
          reject(err);
        }
      });

      this.authServer.listen(port, () => {
        const authUrl = this.getAuthorizationUrl();
        logger.info(`Opening browser for YouTube authorization...`);
        shell.openExternal(authUrl);
      });

      // Timeout after 5 minutes
      setTimeout(() => {
        if (this.authServer) {
          this.authServer.close();
          reject(new Error('Authorization timeout'));
        }
      }, 300000);
    });
  }

  /**
   * Refresh the access token using refresh token
   */
  async refreshAccessToken(): Promise<void> {
    if (!this.oauth2Client || !this.tokens?.refreshToken) {
      throw new Error('No refresh token available');
    }

    try {
      this.oauth2Client.setCredentials({
        refresh_token: this.tokens.refreshToken,
      });

      const { credentials } = await this.oauth2Client.refreshAccessToken();

      this.tokens = {
        accessToken: credentials.access_token!,
        refreshToken: credentials.refresh_token || this.tokens.refreshToken,
        expiresAt: credentials.expiry_date || Date.now() + 3600000,
      };

      await this.saveTokens();
      logger.info('YouTube access token refreshed');
    } catch (error) {
      logger.error('Failed to refresh access token', { error });
      throw error;
    }
  }

  /**
   * Revoke authorization and clear tokens
   */
  async revokeAuthorization(): Promise<void> {
    if (this.oauth2Client && this.tokens?.accessToken) {
      try {
        await this.oauth2Client.revokeToken(this.tokens.accessToken);
      } catch (error) {
        logger.warn('Failed to revoke token remotely', { error });
      }
    }

    this.tokens = null;
    this.youtube = null;

    // Delete stored tokens
    try {
      if (fs.existsSync(this.tokenPath)) {
        fs.unlinkSync(this.tokenPath);
      }
    } catch (error) {
      logger.warn('Failed to delete token file', { error });
    }

    logger.info('YouTube authorization revoked');
  }

  /**
   * Get trending videos for a region
   */
  async getTrendingVideos(
    regionCode: string = 'US',
    categoryId?: string,
    maxResults: number = 25
  ): Promise<TrendingVideo[]> {
    this.ensureAuthorized();

    try {
      const params: youtube_v3.Params$Resource$Videos$List = {
        part: ['snippet', 'statistics', 'contentDetails'],
        chart: 'mostPopular',
        regionCode,
        maxResults,
      };

      if (categoryId) {
        params.videoCategoryId = categoryId;
      }

      const response = await this.youtube!.videos.list(params);

      return (response.data.items || []).map((item) => ({
        id: item.id!,
        title: item.snippet?.title || '',
        description: item.snippet?.description || '',
        channelId: item.snippet?.channelId || '',
        channelTitle: item.snippet?.channelTitle || '',
        publishedAt: item.snippet?.publishedAt || '',
        thumbnailUrl: item.snippet?.thumbnails?.high?.url || '',
        viewCount: parseInt(item.statistics?.viewCount || '0'),
        likeCount: parseInt(item.statistics?.likeCount || '0'),
        commentCount: parseInt(item.statistics?.commentCount || '0'),
        duration: item.contentDetails?.duration || '',
        tags: item.snippet?.tags || [],
        categoryId: item.snippet?.categoryId || '',
      }));
    } catch (error) {
      logger.error('Failed to get trending videos', { error, regionCode });
      throw error;
    }
  }

  /**
   * Search for videos by keyword
   */
  async searchVideos(
    query: string,
    maxResults: number = 25,
    order: 'relevance' | 'date' | 'viewCount' | 'rating' = 'relevance'
  ): Promise<TrendingVideo[]> {
    this.ensureAuthorized();

    try {
      // First search for video IDs
      const searchResponse = await this.youtube!.search.list({
        part: ['id'],
        q: query,
        type: ['video'],
        maxResults,
        order,
      });

      const videoIds = (searchResponse.data.items || [])
        .map((item) => item.id?.videoId)
        .filter((id): id is string => !!id);

      if (videoIds.length === 0) {
        return [];
      }

      // Then get full video details
      const videosResponse = await this.youtube!.videos.list({
        part: ['snippet', 'statistics', 'contentDetails'],
        id: videoIds,
      });

      return (videosResponse.data.items || []).map((item) => ({
        id: item.id!,
        title: item.snippet?.title || '',
        description: item.snippet?.description || '',
        channelId: item.snippet?.channelId || '',
        channelTitle: item.snippet?.channelTitle || '',
        publishedAt: item.snippet?.publishedAt || '',
        thumbnailUrl: item.snippet?.thumbnails?.high?.url || '',
        viewCount: parseInt(item.statistics?.viewCount || '0'),
        likeCount: parseInt(item.statistics?.likeCount || '0'),
        commentCount: parseInt(item.statistics?.commentCount || '0'),
        duration: item.contentDetails?.duration || '',
        tags: item.snippet?.tags || [],
        categoryId: item.snippet?.categoryId || '',
      }));
    } catch (error) {
      logger.error('Failed to search videos', { error, query });
      throw error;
    }
  }

  /**
   * Get video categories for a region
   */
  async getVideoCategories(regionCode: string = 'US'): Promise<{ id: string; title: string }[]> {
    this.ensureAuthorized();

    try {
      const response = await this.youtube!.videoCategories.list({
        part: ['snippet'],
        regionCode,
      });

      return (response.data.items || [])
        .filter((item) => item.snippet?.assignable)
        .map((item) => ({
          id: item.id!,
          title: item.snippet?.title || '',
        }));
    } catch (error) {
      logger.error('Failed to get video categories', { error, regionCode });
      throw error;
    }
  }

  /**
   * Upload a video to YouTube
   */
  async uploadVideo(videoPath: string, metadata: VideoMetadata): Promise<UploadResult> {
    this.ensureAuthorized();

    if (!fs.existsSync(videoPath)) {
      throw new Error(`Video file not found: ${videoPath}`);
    }

    try {
      const fileSize = fs.statSync(videoPath).size;
      logger.info('Starting YouTube upload', { videoPath, fileSize, title: metadata.title });

      const response = await this.youtube!.videos.insert({
        part: ['snippet', 'status'],
        requestBody: {
          snippet: {
            title: metadata.title,
            description: metadata.description,
            tags: metadata.tags,
            categoryId: metadata.categoryId,
            defaultLanguage: metadata.defaultLanguage,
            defaultAudioLanguage: metadata.defaultAudioLanguage,
          },
          status: {
            privacyStatus: metadata.privacyStatus,
            selfDeclaredMadeForKids: metadata.madeForKids,
          },
        },
        media: {
          body: fs.createReadStream(videoPath),
        },
      });

      const videoId = response.data.id!;

      logger.info('YouTube upload complete', { videoId, title: metadata.title });

      return {
        videoId,
        title: metadata.title,
        status: 'uploaded',
        publishedAt: response.data.snippet?.publishedAt || undefined,
        thumbnailUrl: response.data.snippet?.thumbnails?.default?.url || undefined,
        watchUrl: `https://www.youtube.com/watch?v=${videoId}`,
      };
    } catch (error) {
      logger.error('Failed to upload video', { error, videoPath });
      throw error;
    }
  }

  /**
   * Set custom thumbnail for a video
   */
  async setThumbnail(videoId: string, thumbnailPath: string): Promise<void> {
    this.ensureAuthorized();

    if (!fs.existsSync(thumbnailPath)) {
      throw new Error(`Thumbnail file not found: ${thumbnailPath}`);
    }

    try {
      await this.youtube!.thumbnails.set({
        videoId,
        media: {
          body: fs.createReadStream(thumbnailPath),
        },
      });

      logger.info('Thumbnail set successfully', { videoId });
    } catch (error) {
      logger.error('Failed to set thumbnail', { error, videoId });
      throw error;
    }
  }

  /**
   * Update video metadata
   */
  async updateVideoMetadata(videoId: string, metadata: Partial<VideoMetadata>): Promise<void> {
    this.ensureAuthorized();

    try {
      // First get current video data
      const current = await this.youtube!.videos.list({
        part: ['snippet', 'status'],
        id: [videoId],
      });

      if (!current.data.items?.length) {
        throw new Error(`Video not found: ${videoId}`);
      }

      const video = current.data.items[0];

      await this.youtube!.videos.update({
        part: ['snippet', 'status'],
        requestBody: {
          id: videoId,
          snippet: {
            ...video.snippet,
            title: metadata.title || video.snippet?.title,
            description: metadata.description || video.snippet?.description,
            tags: metadata.tags || video.snippet?.tags,
            categoryId: metadata.categoryId || video.snippet?.categoryId,
          },
          status: {
            ...video.status,
            privacyStatus: metadata.privacyStatus || video.status?.privacyStatus,
          },
        },
      });

      logger.info('Video metadata updated', { videoId });
    } catch (error) {
      logger.error('Failed to update video metadata', { error, videoId });
      throw error;
    }
  }

  /**
   * Get analytics for a video (requires YouTube Analytics API)
   */
  async getVideoAnalytics(
    videoId: string,
    startDate: string,
    endDate: string
  ): Promise<VideoAnalytics> {
    this.ensureAuthorized();

    try {
      // Get basic stats from videos.list (Analytics API requires separate setup)
      const response = await this.youtube!.videos.list({
        part: ['statistics'],
        id: [videoId],
      });

      if (!response.data.items?.length) {
        throw new Error(`Video not found: ${videoId}`);
      }

      const stats = response.data.items[0].statistics;

      return {
        videoId,
        views: parseInt(stats?.viewCount || '0'),
        likes: parseInt(stats?.likeCount || '0'),
        dislikes: 0, // No longer public
        comments: parseInt(stats?.commentCount || '0'),
        shares: 0, // Requires Analytics API
        averageViewDuration: 0, // Requires Analytics API
        averageViewPercentage: 0, // Requires Analytics API
        subscribersGained: 0, // Requires Analytics API
        period: {
          start: startDate,
          end: endDate,
        },
      };
    } catch (error) {
      logger.error('Failed to get video analytics', { error, videoId });
      throw error;
    }
  }

  /**
   * Get channel info for the authenticated user
   */
  async getMyChannel(): Promise<{
    id: string;
    title: string;
    subscriberCount: number;
    videoCount: number;
  } | null> {
    this.ensureAuthorized();

    try {
      const response = await this.youtube!.channels.list({
        part: ['snippet', 'statistics'],
        mine: true,
      });

      if (!response.data.items?.length) {
        return null;
      }

      const channel = response.data.items[0];

      return {
        id: channel.id!,
        title: channel.snippet?.title || '',
        subscriberCount: parseInt(channel.statistics?.subscriberCount || '0'),
        videoCount: parseInt(channel.statistics?.videoCount || '0'),
      };
    } catch (error) {
      logger.error('Failed to get channel info', { error });
      throw error;
    }
  }

  /**
   * Load tokens from disk
   */
  private async loadTokens(): Promise<void> {
    try {
      if (fs.existsSync(this.tokenPath)) {
        const data = fs.readFileSync(this.tokenPath, 'utf8');
        this.tokens = JSON.parse(data);
        logger.debug('Loaded YouTube tokens from disk');
      }
    } catch (error) {
      logger.warn('Failed to load tokens', { error });
      this.tokens = null;
    }
  }

  /**
   * Save tokens to disk
   */
  private async saveTokens(): Promise<void> {
    try {
      const dir = path.dirname(this.tokenPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.tokenPath, JSON.stringify(this.tokens, null, 2));
      logger.debug('Saved YouTube tokens to disk');
    } catch (error) {
      logger.error('Failed to save tokens', { error });
    }
  }

  /**
   * Ensure client is authorized before making API calls
   */
  private ensureAuthorized(): void {
    if (!this.youtube) {
      throw new Error('YouTube client not authorized. Call authorize() first.');
    }
  }
}

// Singleton instance
let youtubeClient: YouTubeClient | null = null;

/**
 * Get the YouTube client singleton
 */
export function getYouTubeClient(): YouTubeClient {
  if (!youtubeClient) {
    youtubeClient = new YouTubeClient();
  }
  return youtubeClient;
}

/**
 * Initialize YouTube client with credentials from environment
 */
export async function initializeYouTubeClient(): Promise<YouTubeClient> {
  const client = getYouTubeClient();

  const credentials: YouTubeCredentials = {
    clientId: process.env.YOUTUBE_CLIENT_ID || '',
    clientSecret: process.env.YOUTUBE_CLIENT_SECRET || '',
    redirectUri: process.env.YOUTUBE_REDIRECT_URI || DEFAULT_REDIRECT_URI,
  };

  if (!credentials.clientId || !credentials.clientSecret) {
    logger.warn('YouTube credentials not configured in environment');
  }

  await client.initialize(credentials);
  return client;
}
