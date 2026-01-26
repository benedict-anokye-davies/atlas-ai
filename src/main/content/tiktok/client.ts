/**
 * TikTok API Client
 * T5-109: TikTok upload integration
 *
 * Note: TikTok's API is more restrictive than YouTube.
 * This uses the Content Posting API (requires TikTok developer account).
 * For personal use, it can also use browser automation as a fallback.
 */

import * as fs from 'fs';
import * as path from 'path';
import { app, shell } from 'electron';
import { createServer, Server } from 'http';
import { URL } from 'url';
import { createModuleLogger } from '../../utils/logger';

const logger = createModuleLogger('TikTokClient');

// TikTok API endpoints
const TIKTOK_API_BASE = 'https://open.tiktokapis.com/v2';
const TIKTOK_AUTH_URL = 'https://www.tiktok.com/v2/auth/authorize';

// TikTok credentials
export interface TikTokCredentials {
  clientKey: string;
  clientSecret: string;
  redirectUri?: string;
}

// TikTok tokens
export interface TikTokTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope: string;
  openId: string;
}

// Video metadata for TikTok
export interface TikTokVideoMetadata {
  title?: string; // TikTok uses caption instead of title
  description: string; // Caption (max 2200 chars)
  privacyLevel: 'PUBLIC_TO_EVERYONE' | 'MUTUAL_FOLLOW_FRIENDS' | 'SELF_ONLY';
  disableComments?: boolean;
  disableDuet?: boolean;
  disableStitch?: boolean;
  videoCoverTimestamp?: number; // seconds into video for cover image
}

// Upload result
export interface TikTokUploadResult {
  shareId: string;
  videoId?: string;
  status: 'uploaded' | 'processing' | 'published' | 'failed';
  shareUrl?: string;
  error?: string;
}

// TikTok video info
export interface TikTokVideo {
  id: string;
  createTime: number;
  coverImageUrl: string;
  shareUrl: string;
  videoDescription: string;
  duration: number;
  width: number;
  height: number;
  title?: string;
  embedHtml?: string;
  embedLink?: string;
  likeCount?: number;
  commentCount?: number;
  shareCount?: number;
  viewCount?: number;
}

// User info
export interface TikTokUserInfo {
  openId: string;
  unionId?: string;
  avatarUrl: string;
  avatarUrlLarge?: string;
  displayName: string;
  bioDescription?: string;
  profileDeepLink?: string;
  isVerified?: boolean;
  followerCount?: number;
  followingCount?: number;
  likesCount?: number;
  videoCount?: number;
}

/**
 * TikTok API Client
 */
export class TikTokClient {
  private credentials: TikTokCredentials | null = null;
  private tokens: TikTokTokens | null = null;
  private tokenPath: string;
  private authServer: Server | null = null;

  constructor() {
    const userDataPath = app?.getPath?.('userData') || path.join(process.env.HOME || '', '.atlas');
    this.tokenPath = path.join(userDataPath, 'tiktok-tokens.json');
  }

  /**
   * Initialize the client with credentials
   */
  async initialize(credentials: TikTokCredentials): Promise<void> {
    this.credentials = credentials;

    // Try to load existing tokens
    await this.loadTokens();

    if (this.tokens && Date.now() < this.tokens.expiresAt - 60000) {
      logger.info('TikTok client initialized with existing tokens');
    } else if (this.tokens?.refreshToken) {
      await this.refreshAccessToken();
      logger.info('TikTok client initialized with refreshed tokens');
    } else {
      logger.info('TikTok client initialized, authorization required');
    }
  }

  /**
   * Check if the client is authorized
   */
  isAuthorized(): boolean {
    return this.tokens !== null && Date.now() < this.tokens.expiresAt;
  }

  /**
   * Get authorization URL
   */
  getAuthorizationUrl(): string {
    if (!this.credentials) {
      throw new Error('Client not initialized');
    }

    const redirectUri = this.credentials.redirectUri || 'http://localhost:8090/oauth2callback';

    const params = new URLSearchParams({
      client_key: this.credentials.clientKey,
      scope: 'user.info.basic,video.list,video.upload,video.publish',
      response_type: 'code',
      redirect_uri: redirectUri,
      state: this.generateState(),
    });

    return `${TIKTOK_AUTH_URL}?${params.toString()}`;
  }

  /**
   * Start OAuth flow (opens browser)
   */
  async startAuthFlow(): Promise<void> {
    if (!this.credentials) {
      throw new Error('Client not initialized');
    }

    const redirectUri = this.credentials.redirectUri || 'http://localhost:8090/oauth2callback';
    const url = new URL(redirectUri);
    const port = parseInt(url.port, 10) || 8090;

    return new Promise((resolve, reject) => {
      this.authServer = createServer(async (req, res) => {
        if (req.url?.startsWith('/oauth2callback')) {
          const urlObj = new URL(req.url, redirectUri);
          const code = urlObj.searchParams.get('code');
          const error = urlObj.searchParams.get('error');

          if (error) {
            res.writeHead(400, { 'Content-Type': 'text/html' });
            res.end(`<h1>Authorization Failed</h1><p>${error}</p>`);
            this.authServer?.close();
            reject(new Error(error));
            return;
          }

          if (code) {
            try {
              await this.exchangeCodeForTokens(code, redirectUri);
              res.writeHead(200, { 'Content-Type': 'text/html' });
              res.end('<h1>Authorization Successful!</h1><p>You can close this window.</p>');
              this.authServer?.close();
              resolve();
            } catch (err) {
              res.writeHead(500, { 'Content-Type': 'text/html' });
              res.end('<h1>Token Exchange Failed</h1>');
              this.authServer?.close();
              reject(err);
            }
          }
        }
      });

      this.authServer.listen(port, () => {
        logger.info('Auth server listening', { port });
        const authUrl = this.getAuthorizationUrl();
        shell.openExternal(authUrl);
      });

      this.authServer.on('error', (err) => {
        logger.error('Auth server error', { error: err });
        reject(err);
      });
    });
  }

  /**
   * Exchange authorization code for tokens
   */
  private async exchangeCodeForTokens(code: string, redirectUri: string): Promise<void> {
    if (!this.credentials) {
      throw new Error('Client not initialized');
    }

    const response = await fetch(`${TIKTOK_API_BASE}/oauth/token/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_key: this.credentials.clientKey,
        client_secret: this.credentials.clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }),
    });

    if (!response.ok) {
      throw new Error(`Token exchange failed: ${response.status}`);
    }

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error.message || data.error);
    }

    this.tokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000,
      scope: data.scope,
      openId: data.open_id,
    };

    await this.saveTokens();
    logger.info('TikTok tokens obtained');
  }

  /**
   * Refresh access token
   */
  private async refreshAccessToken(): Promise<void> {
    if (!this.credentials || !this.tokens?.refreshToken) {
      throw new Error('Cannot refresh: no credentials or refresh token');
    }

    const response = await fetch(`${TIKTOK_API_BASE}/oauth/token/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_key: this.credentials.clientKey,
        client_secret: this.credentials.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: this.tokens.refreshToken,
      }),
    });

    if (!response.ok) {
      throw new Error(`Token refresh failed: ${response.status}`);
    }

    const data = await response.json();

    if (data.error) {
      // Token expired, need to re-authorize
      this.tokens = null;
      throw new Error('Refresh token expired, re-authorization required');
    }

    this.tokens = {
      ...this.tokens,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };

    await this.saveTokens();
    logger.info('TikTok tokens refreshed');
  }

  /**
   * Upload video to TikTok
   */
  async uploadVideo(videoPath: string, metadata: TikTokVideoMetadata): Promise<TikTokUploadResult> {
    this.ensureAuthorized();

    if (!fs.existsSync(videoPath)) {
      throw new Error(`Video file not found: ${videoPath}`);
    }

    const fileSize = fs.statSync(videoPath).size;
    logger.info('Starting TikTok upload', { videoPath, fileSize });

    try {
      // Step 1: Initialize upload (get upload URL)
      const initResponse = await this.initializeUpload(fileSize);

      // Step 2: Upload video chunks
      await this.uploadVideoChunks(videoPath, initResponse.uploadUrl);

      // Step 3: Create post (publish video)
      const publishResult = await this.publishVideo(initResponse.publishId, metadata);

      logger.info('TikTok upload complete', { shareId: publishResult.shareId });

      return publishResult;
    } catch (error) {
      logger.error('TikTok upload failed', { error, videoPath });
      throw error;
    }
  }

  /**
   * Initialize video upload
   */
  private async initializeUpload(
    fileSize: number
  ): Promise<{ uploadUrl: string; publishId: string }> {
    const response = await fetch(`${TIKTOK_API_BASE}/post/publish/inbox/video/init/`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.tokens!.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        source_info: {
          source: 'FILE_UPLOAD',
          video_size: fileSize,
          chunk_size: fileSize, // Single chunk for simplicity
          total_chunk_count: 1,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to initialize upload: ${response.status}`);
    }

    const data = await response.json();

    if (data.error.code !== 'ok') {
      throw new Error(data.error.message || 'Upload initialization failed');
    }

    return {
      uploadUrl: data.data.upload_url,
      publishId: data.data.publish_id,
    };
  }

  /**
   * Upload video chunks
   */
  private async uploadVideoChunks(videoPath: string, uploadUrl: string): Promise<void> {
    const videoBuffer = fs.readFileSync(videoPath);

    const response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Range': `bytes 0-${videoBuffer.length - 1}/${videoBuffer.length}`,
      },
      body: videoBuffer,
    });

    if (!response.ok) {
      throw new Error(`Video chunk upload failed: ${response.status}`);
    }
  }

  /**
   * Publish uploaded video
   */
  private async publishVideo(
    publishId: string,
    metadata: TikTokVideoMetadata
  ): Promise<TikTokUploadResult> {
    const response = await fetch(`${TIKTOK_API_BASE}/post/publish/video/init/`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.tokens!.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        publish_id: publishId,
        post_info: {
          title: metadata.description.slice(0, 150), // TikTok title is limited
          description: metadata.description,
          privacy_level: metadata.privacyLevel,
          disable_comment: metadata.disableComments || false,
          disable_duet: metadata.disableDuet || false,
          disable_stitch: metadata.disableStitch || false,
          video_cover_timestamp_ms: (metadata.videoCoverTimestamp || 0) * 1000,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to publish video: ${response.status} - ${errorText}`);
    }

    const data = await response.json();

    if (data.error.code !== 'ok') {
      return {
        shareId: publishId,
        status: 'failed',
        error: data.error.message,
      };
    }

    return {
      shareId: data.data.share_id,
      status: 'processing', // Video needs to be processed
    };
  }

  /**
   * Check video publish status
   */
  async getPublishStatus(publishId: string): Promise<TikTokUploadResult> {
    this.ensureAuthorized();

    const response = await fetch(`${TIKTOK_API_BASE}/post/publish/status/fetch/`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.tokens!.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        publish_id: publishId,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch publish status: ${response.status}`);
    }

    const data = await response.json();

    const status = data.data.status;
    const statusMap: Record<string, TikTokUploadResult['status']> = {
      PROCESSING_UPLOAD: 'processing',
      PROCESSING_DOWNLOAD: 'processing',
      SEND_TO_USER_INBOX: 'uploaded',
      PUBLISH_COMPLETE: 'published',
      FAILED: 'failed',
    };

    return {
      shareId: publishId,
      videoId: data.data.video_id,
      status: statusMap[status] || 'processing',
      error: data.data.fail_reason,
    };
  }

  /**
   * Get user info
   */
  async getUserInfo(): Promise<TikTokUserInfo> {
    this.ensureAuthorized();

    const response = await fetch(`${TIKTOK_API_BASE}/user/info/`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.tokens!.accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get user info: ${response.status}`);
    }

    const data = await response.json();

    if (data.error.code !== 'ok') {
      throw new Error(data.error.message);
    }

    return {
      openId: data.data.user.open_id,
      unionId: data.data.user.union_id,
      avatarUrl: data.data.user.avatar_url,
      avatarUrlLarge: data.data.user.avatar_large_url,
      displayName: data.data.user.display_name,
      bioDescription: data.data.user.bio_description,
      profileDeepLink: data.data.user.profile_deep_link,
      isVerified: data.data.user.is_verified,
      followerCount: data.data.user.follower_count,
      followingCount: data.data.user.following_count,
      likesCount: data.data.user.likes_count,
      videoCount: data.data.user.video_count,
    };
  }

  /**
   * Get user's videos
   */
  async getVideos(
    cursor?: number,
    maxCount: number = 20
  ): Promise<{
    videos: TikTokVideo[];
    cursor: number;
    hasMore: boolean;
  }> {
    this.ensureAuthorized();

    const params = new URLSearchParams({
      fields:
        'id,create_time,cover_image_url,share_url,video_description,duration,width,height,title,embed_html,embed_link,like_count,comment_count,share_count,view_count',
    });

    if (cursor) {
      params.set('cursor', String(cursor));
    }
    params.set('max_count', String(maxCount));

    const response = await fetch(`${TIKTOK_API_BASE}/video/list/?${params.toString()}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.tokens!.accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get videos: ${response.status}`);
    }

    const data = await response.json();

    if (data.error.code !== 'ok') {
      throw new Error(data.error.message);
    }

    const videos: TikTokVideo[] = data.data.videos.map((v: Record<string, unknown>) => ({
      id: v.id,
      createTime: v.create_time,
      coverImageUrl: v.cover_image_url,
      shareUrl: v.share_url,
      videoDescription: v.video_description,
      duration: v.duration,
      width: v.width,
      height: v.height,
      title: v.title,
      embedHtml: v.embed_html,
      embedLink: v.embed_link,
      likeCount: v.like_count,
      commentCount: v.comment_count,
      shareCount: v.share_count,
      viewCount: v.view_count,
    }));

    return {
      videos,
      cursor: data.data.cursor,
      hasMore: data.data.has_more,
    };
  }

  /**
   * Ensure client is authorized
   */
  private ensureAuthorized(): void {
    if (!this.isAuthorized()) {
      throw new Error('Not authorized. Call startAuthFlow() first.');
    }
  }

  /**
   * Generate random state for OAuth
   */
  private generateState(): string {
    return Math.random().toString(36).substring(2, 15);
  }

  /**
   * Load tokens from file
   */
  private async loadTokens(): Promise<void> {
    try {
      if (fs.existsSync(this.tokenPath)) {
        const data = JSON.parse(fs.readFileSync(this.tokenPath, 'utf-8'));
        this.tokens = data;
      }
    } catch (error) {
      logger.warn('Failed to load TikTok tokens', { error });
    }
  }

  /**
   * Save tokens to file
   */
  private async saveTokens(): Promise<void> {
    try {
      fs.writeFileSync(this.tokenPath, JSON.stringify(this.tokens, null, 2));
    } catch (error) {
      logger.error('Failed to save TikTok tokens', { error });
    }
  }

  /**
   * Revoke tokens
   */
  async revokeTokens(): Promise<void> {
    if (!this.tokens) return;

    try {
      await fetch(`${TIKTOK_API_BASE}/oauth/revoke/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_key: this.credentials!.clientKey,
          client_secret: this.credentials!.clientSecret,
          token: this.tokens.accessToken,
        }),
      });

      this.tokens = null;

      if (fs.existsSync(this.tokenPath)) {
        fs.unlinkSync(this.tokenPath);
      }

      logger.info('TikTok tokens revoked');
    } catch (error) {
      logger.error('Failed to revoke TikTok tokens', { error });
    }
  }

  /**
   * Get current open ID
   */
  getOpenId(): string | null {
    return this.tokens?.openId || null;
  }
}

// Singleton instance
let tiktokClient: TikTokClient | null = null;

/**
 * Get or create the TikTok client instance
 */
export function getTikTokClient(): TikTokClient {
  if (!tiktokClient) {
    tiktokClient = new TikTokClient();
  }
  return tiktokClient;
}
