/**
 * Atlas Desktop - Spotify Integration Tool
 *
 * Provides Spotify playback controls, search, and playlist management.
 * Uses OAuth 2.0 PKCE flow for secure authentication.
 *
 * @module agent/tools/spotify
 */

import SpotifyWebApi from 'spotify-web-api-node';
import { shell } from 'electron';
import http from 'http';
import { URL } from 'url';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { AgentTool, ActionResult } from '../../../shared/types/agent';
import { createModuleLogger } from '../../utils/logger';
import { getErrorMessage } from '../../../shared/utils';

const logger = createModuleLogger('Spotify');

// ============================================================================
// Types
// ============================================================================

interface SpotifyTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope: string;
}

interface SpotifyTrack {
  id: string;
  name: string;
  artists: string[];
  album: string;
  albumArt?: string;
  durationMs: number;
  uri: string;
  isPlaying?: boolean;
  progressMs?: number;
}

interface SpotifyPlaylist {
  id: string;
  name: string;
  description?: string;
  owner: string;
  trackCount: number;
  uri: string;
  imageUrl?: string;
}

interface SpotifyDevice {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
  volumePercent: number;
}

interface SpotifySearchResult {
  tracks: SpotifyTrack[];
  albums: Array<{
    id: string;
    name: string;
    artists: string[];
    uri: string;
    imageUrl?: string;
  }>;
  artists: Array<{
    id: string;
    name: string;
    uri: string;
    imageUrl?: string;
    followers?: number;
  }>;
  playlists: SpotifyPlaylist[];
}

// ============================================================================
// Spotify Manager
// ============================================================================

const SPOTIFY_CONFIG_DIR = path.join(os.homedir(), '.atlas', 'spotify');
const SPOTIFY_TOKENS_FILE = path.join(SPOTIFY_CONFIG_DIR, 'tokens.json');
const REDIRECT_PORT = 8888;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`;

// Required scopes for full functionality
const SPOTIFY_SCOPES = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'user-read-recently-played',
  'playlist-read-private',
  'playlist-read-collaborative',
  'playlist-modify-public',
  'playlist-modify-private',
  'user-library-read',
  'user-library-modify',
  'streaming',
  'user-top-read',
];

class SpotifyManager {
  private spotifyApi: SpotifyWebApi | null = null;
  private tokens: SpotifyTokens | null = null;
  private authServer: http.Server | null = null;
  private codeVerifier: string | null = null;

  constructor() {
    this.loadTokens();
  }

  /**
   * Initialize the Spotify API client
   */
  async initialize(): Promise<void> {
    const clientId = process.env.SPOTIFY_CLIENT_ID;
    if (!clientId) {
      throw new Error('SPOTIFY_CLIENT_ID environment variable is not set');
    }

    this.spotifyApi = new SpotifyWebApi({
      clientId,
      redirectUri: REDIRECT_URI,
    });

    if (this.tokens && this.tokens.accessToken) {
      this.spotifyApi.setAccessToken(this.tokens.accessToken);
      this.spotifyApi.setRefreshToken(this.tokens.refreshToken);

      // Check if token needs refresh
      if (Date.now() >= this.tokens.expiresAt - 60000) {
        await this.refreshAccessToken();
      }
    }
  }

  /**
   * Check if authenticated
   */
  isAuthenticated(): boolean {
    return !!(this.tokens && this.tokens.accessToken && Date.now() < this.tokens.expiresAt);
  }

  /**
   * Load tokens from disk
   */
  private loadTokens(): void {
    try {
      if (fs.existsSync(SPOTIFY_TOKENS_FILE)) {
        this.tokens = fs.readJsonSync(SPOTIFY_TOKENS_FILE);
        logger.info('Loaded Spotify tokens from disk');
      }
    } catch (error) {
      logger.warn('Failed to load Spotify tokens:', error);
      this.tokens = null;
    }
  }

  /**
   * Save tokens to disk
   */
  private saveTokens(): void {
    try {
      fs.ensureDirSync(SPOTIFY_CONFIG_DIR);
      fs.writeJsonSync(SPOTIFY_TOKENS_FILE, this.tokens, { spaces: 2 });
      logger.info('Saved Spotify tokens to disk');
    } catch (error) {
      logger.error('Failed to save Spotify tokens:', error);
    }
  }

  /**
   * Generate PKCE code verifier and challenge
   */
  private generatePKCE(): { verifier: string; challenge: string } {
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    return { verifier, challenge };
  }

  /**
   * Start OAuth flow
   */
  async authenticate(): Promise<boolean> {
    if (!this.spotifyApi) {
      await this.initialize();
    }

    return new Promise((resolve, reject) => {
      // Generate PKCE values
      const { verifier, challenge } = this.generatePKCE();
      this.codeVerifier = verifier;

      // Create authorization URL
      const clientId = process.env.SPOTIFY_CLIENT_ID;
      const state = crypto.randomBytes(16).toString('hex');
      const authUrl = new URL('https://accounts.spotify.com/authorize');
      authUrl.searchParams.set('client_id', clientId!);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
      authUrl.searchParams.set('scope', SPOTIFY_SCOPES.join(' '));
      authUrl.searchParams.set('state', state);
      authUrl.searchParams.set('code_challenge_method', 'S256');
      authUrl.searchParams.set('code_challenge', challenge);

      // Start callback server
      this.authServer = http.createServer(async (req, res) => {
        const url = new URL(req.url!, `http://localhost:${REDIRECT_PORT}`);

        if (url.pathname === '/callback') {
          const code = url.searchParams.get('code');
          const error = url.searchParams.get('error');
          const returnedState = url.searchParams.get('state');

          if (error) {
            res.writeHead(400, { 'Content-Type': 'text/html' });
            res.end(
              '<html><body><h1>Authentication Failed</h1><p>You can close this window.</p></body></html>'
            );
            this.closeAuthServer();
            reject(new Error(error));
            return;
          }

          if (returnedState !== state) {
            res.writeHead(400, { 'Content-Type': 'text/html' });
            res.end(
              '<html><body><h1>State Mismatch</h1><p>Authentication failed. You can close this window.</p></body></html>'
            );
            this.closeAuthServer();
            reject(new Error('State mismatch'));
            return;
          }

          try {
            await this.exchangeCodeForTokens(code!);
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(
              '<html><body><h1>Authentication Successful!</h1><p>You can close this window and return to Atlas.</p></body></html>'
            );
            this.closeAuthServer();
            resolve(true);
          } catch (err) {
            res.writeHead(500, { 'Content-Type': 'text/html' });
            res.end(
              '<html><body><h1>Token Exchange Failed</h1><p>You can close this window.</p></body></html>'
            );
            this.closeAuthServer();
            reject(err);
          }
        }
      });

      this.authServer.listen(REDIRECT_PORT, () => {
        logger.info(`Spotify auth callback server listening on port ${REDIRECT_PORT}`);
        // Open auth URL in browser
        shell.openExternal(authUrl.toString());
      });

      // Timeout after 5 minutes
      setTimeout(() => {
        if (this.authServer) {
          this.closeAuthServer();
          reject(new Error('Authentication timed out'));
        }
      }, 300000);
    });
  }

  /**
   * Exchange authorization code for tokens
   */
  private async exchangeCodeForTokens(code: string): Promise<void> {
    const clientId = process.env.SPOTIFY_CLIENT_ID;

    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        client_id: clientId!,
        code_verifier: this.codeVerifier!,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Token exchange failed: ${errorText}`);
    }

    const data = await response.json();

    this.tokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000,
      scope: data.scope,
    };

    this.spotifyApi!.setAccessToken(this.tokens.accessToken);
    this.spotifyApi!.setRefreshToken(this.tokens.refreshToken);
    this.saveTokens();
    this.codeVerifier = null;
  }

  /**
   * Refresh access token
   */
  private async refreshAccessToken(): Promise<void> {
    if (!this.tokens?.refreshToken) {
      throw new Error('No refresh token available');
    }

    const clientId = process.env.SPOTIFY_CLIENT_ID;

    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: this.tokens.refreshToken,
        client_id: clientId!,
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to refresh access token');
    }

    const data = await response.json();

    this.tokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || this.tokens.refreshToken,
      expiresAt: Date.now() + data.expires_in * 1000,
      scope: data.scope,
    };

    this.spotifyApi!.setAccessToken(this.tokens.accessToken);
    if (data.refresh_token) {
      this.spotifyApi!.setRefreshToken(data.refresh_token);
    }
    this.saveTokens();
  }

  /**
   * Close auth server
   */
  private closeAuthServer(): void {
    if (this.authServer) {
      this.authServer.close();
      this.authServer = null;
    }
  }

  /**
   * Ensure authenticated and token is valid
   */
  private async ensureAuthenticated(): Promise<void> {
    if (!this.spotifyApi) {
      await this.initialize();
    }

    if (!this.isAuthenticated()) {
      throw new Error('Not authenticated with Spotify. Please run spotify_connect first.');
    }

    // Refresh if needed
    if (this.tokens && Date.now() >= this.tokens.expiresAt - 60000) {
      await this.refreshAccessToken();
    }
  }

  /**
   * Get currently playing track
   */
  async getCurrentlyPlaying(): Promise<SpotifyTrack | null> {
    await this.ensureAuthenticated();

    try {
      const response = await this.spotifyApi!.getMyCurrentPlayingTrack();
      if (!response.body || !response.body.item || response.body.item.type !== 'track') {
        return null;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const track = response.body.item as any;
      return {
        id: track.id,
        name: track.name,
        artists: track.artists.map((a: { name: string }) => a.name),
        album: track.album.name,
        albumArt: track.album.images[0]?.url,
        durationMs: track.duration_ms,
        uri: track.uri,
        isPlaying: response.body.is_playing,
        progressMs: response.body.progress_ms ?? undefined,
      };
    } catch (error) {
      logger.error('Failed to get currently playing:', error);
      throw error;
    }
  }

  /**
   * Play/resume playback
   */
  async play(options?: { uri?: string; context?: string; deviceId?: string }): Promise<void> {
    await this.ensureAuthenticated();

    try {
      // Build play options - using type assertion due to library type issues
      const playOptions: Record<string, unknown> = {};

      if (options?.deviceId) {
        playOptions.device_id = options.deviceId;
      }

      if (options?.context) {
        playOptions.context_uri = options.context;
      } else if (options?.uri) {
        playOptions.uris = [options.uri];
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await this.spotifyApi!.play(playOptions as any);
    } catch (error) {
      logger.error('Failed to play:', error);
      throw error;
    }
  }

  /**
   * Pause playback
   */
  async pause(): Promise<void> {
    await this.ensureAuthenticated();

    try {
      await this.spotifyApi!.pause();
    } catch (error) {
      logger.error('Failed to pause:', error);
      throw error;
    }
  }

  /**
   * Skip to next track
   */
  async next(): Promise<void> {
    await this.ensureAuthenticated();

    try {
      await this.spotifyApi!.skipToNext();
    } catch (error) {
      logger.error('Failed to skip to next:', error);
      throw error;
    }
  }

  /**
   * Go to previous track
   */
  async previous(): Promise<void> {
    await this.ensureAuthenticated();

    try {
      await this.spotifyApi!.skipToPrevious();
    } catch (error) {
      logger.error('Failed to go to previous:', error);
      throw error;
    }
  }

  /**
   * Set volume
   */
  async setVolume(volumePercent: number): Promise<void> {
    await this.ensureAuthenticated();

    try {
      const volume = Math.max(0, Math.min(100, Math.round(volumePercent)));
      await this.spotifyApi!.setVolume(volume);
    } catch (error) {
      logger.error('Failed to set volume:', error);
      throw error;
    }
  }

  /**
   * Seek to position
   */
  async seek(positionMs: number): Promise<void> {
    await this.ensureAuthenticated();

    try {
      await this.spotifyApi!.seek(positionMs);
    } catch (error) {
      logger.error('Failed to seek:', error);
      throw error;
    }
  }

  /**
   * Add track to queue
   */
  async addToQueue(uri: string): Promise<void> {
    await this.ensureAuthenticated();

    try {
      await this.spotifyApi!.addToQueue(uri);
    } catch (error) {
      logger.error('Failed to add to queue:', error);
      throw error;
    }
  }

  /**
   * Toggle shuffle
   */
  async setShuffle(state: boolean): Promise<void> {
    await this.ensureAuthenticated();

    try {
      await this.spotifyApi!.setShuffle(state);
    } catch (error) {
      logger.error('Failed to set shuffle:', error);
      throw error;
    }
  }

  /**
   * Set repeat mode
   */
  async setRepeat(mode: 'track' | 'context' | 'off'): Promise<void> {
    await this.ensureAuthenticated();

    try {
      await this.spotifyApi!.setRepeat(mode);
    } catch (error) {
      logger.error('Failed to set repeat:', error);
      throw error;
    }
  }

  /**
   * Search for tracks, albums, artists, or playlists
   */
  async search(
    query: string,
    types: ('track' | 'album' | 'artist' | 'playlist')[] = ['track'],
    limit: number = 10
  ): Promise<SpotifySearchResult> {
    await this.ensureAuthenticated();

    try {
      const response = await this.spotifyApi!.search(query, types, { limit });
      const result: SpotifySearchResult = {
        tracks: [],
        albums: [],
        artists: [],
        playlists: [],
      };

      if (response.body.tracks) {
        result.tracks = response.body.tracks.items.map((track) => ({
          id: track.id,
          name: track.name,
          artists: track.artists.map((a) => a.name),
          album: track.album.name,
          albumArt: track.album.images[0]?.url,
          durationMs: track.duration_ms,
          uri: track.uri,
        }));
      }

      if (response.body.albums) {
        result.albums = response.body.albums.items.map((album) => ({
          id: album.id,
          name: album.name,
          artists: album.artists.map((a) => a.name),
          uri: album.uri,
          imageUrl: album.images[0]?.url,
        }));
      }

      if (response.body.artists) {
        result.artists = response.body.artists.items.map((artist) => ({
          id: artist.id,
          name: artist.name,
          uri: artist.uri,
          imageUrl: artist.images[0]?.url,
          followers: artist.followers?.total,
        }));
      }

      if (response.body.playlists) {
        result.playlists = response.body.playlists.items
          .filter((p) => p !== null)
          .map((playlist) => ({
            id: playlist!.id,
            name: playlist!.name,
            description: playlist!.description ?? undefined,
            owner: playlist!.owner.display_name || playlist!.owner.id,
            trackCount: playlist!.tracks.total,
            uri: playlist!.uri,
            imageUrl: playlist!.images[0]?.url,
          }));
      }

      return result;
    } catch (error) {
      logger.error('Failed to search:', error);
      throw error;
    }
  }

  /**
   * Get user playlists
   */
  async getPlaylists(limit: number = 20): Promise<SpotifyPlaylist[]> {
    await this.ensureAuthenticated();

    try {
      const response = await this.spotifyApi!.getUserPlaylists({ limit });
      return response.body.items.map((playlist) => ({
        id: playlist.id,
        name: playlist.name,
        description: playlist.description ?? undefined,
        owner: playlist.owner.display_name || playlist.owner.id,
        trackCount: playlist.tracks.total,
        uri: playlist.uri,
        imageUrl: playlist.images[0]?.url,
      }));
    } catch (error) {
      logger.error('Failed to get playlists:', error);
      throw error;
    }
  }

  /**
   * Get available devices
   */
  async getDevices(): Promise<SpotifyDevice[]> {
    await this.ensureAuthenticated();

    try {
      const response = await this.spotifyApi!.getMyDevices();
      return response.body.devices.map((device) => ({
        id: device.id || '',
        name: device.name,
        type: device.type,
        isActive: device.is_active,
        volumePercent: device.volume_percent ?? 0,
      }));
    } catch (error) {
      logger.error('Failed to get devices:', error);
      throw error;
    }
  }

  /**
   * Transfer playback to device
   */
  async transferPlayback(deviceId: string, play: boolean = true): Promise<void> {
    await this.ensureAuthenticated();

    try {
      await this.spotifyApi!.transferMyPlayback([deviceId], { play });
    } catch (error) {
      logger.error('Failed to transfer playback:', error);
      throw error;
    }
  }

  /**
   * Get recently played tracks
   */
  async getRecentlyPlayed(limit: number = 20): Promise<SpotifyTrack[]> {
    await this.ensureAuthenticated();

    try {
      const response = await this.spotifyApi!.getMyRecentlyPlayedTracks({ limit });
      return response.body.items.map((item) => ({
        id: item.track.id,
        name: item.track.name,
        artists: item.track.artists.map((a) => a.name),
        album: item.track.album.name,
        albumArt: item.track.album.images[0]?.url,
        durationMs: item.track.duration_ms,
        uri: item.track.uri,
      }));
    } catch (error) {
      logger.error('Failed to get recently played:', error);
      throw error;
    }
  }

  /**
   * Disconnect and clear tokens
   */
  disconnect(): void {
    this.tokens = null;
    this.spotifyApi = null;
    try {
      if (fs.existsSync(SPOTIFY_TOKENS_FILE)) {
        fs.unlinkSync(SPOTIFY_TOKENS_FILE);
      }
    } catch (error) {
      logger.warn('Failed to delete tokens file:', error);
    }
    logger.info('Disconnected from Spotify');
  }
}

// Singleton instance
const spotifyManager = new SpotifyManager();

// ============================================================================
// Agent Tools
// ============================================================================

/**
 * Connect to Spotify (OAuth flow)
 */
export const spotifyConnectTool: AgentTool = {
  name: 'spotify_connect',
  description:
    'Authenticate with Spotify using OAuth. Opens a browser window for login. Must be called before other Spotify tools.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (): Promise<ActionResult> => {
    try {
      await spotifyManager.authenticate();
      return {
        success: true,
        data: { message: 'Successfully connected to Spotify' },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to connect to Spotify: ${getErrorMessage(error)}`,
      };
    }
  },
};

/**
 * Get currently playing track
 */
export const spotifyGetPlayingTool: AgentTool = {
  name: 'spotify_get_playing',
  description: 'Get information about the currently playing track on Spotify',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (): Promise<ActionResult> => {
    try {
      const track = await spotifyManager.getCurrentlyPlaying();
      if (!track) {
        return {
          success: true,
          data: { message: 'Nothing is currently playing' },
        };
      }
      return {
        success: true,
        data: track,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to get currently playing: ${getErrorMessage(error)}`,
      };
    }
  },
};

/**
 * Play track or resume playback
 */
export const spotifyPlayTool: AgentTool = {
  name: 'spotify_play',
  description:
    'Play a specific track, album, playlist, or resume playback. If no URI is provided, resumes current playback.',
  parameters: {
    type: 'object',
    properties: {
      uri: {
        type: 'string',
        description: 'Spotify URI of track to play (e.g., "spotify:track:xxx")',
      },
      context: {
        type: 'string',
        description: 'Spotify URI of album/playlist context (e.g., "spotify:album:xxx")',
      },
      deviceId: {
        type: 'string',
        description: 'Device ID to play on (optional)',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      await spotifyManager.play({
        uri: params.uri as string | undefined,
        context: params.context as string | undefined,
        deviceId: params.deviceId as string | undefined,
      });
      return {
        success: true,
        data: { message: 'Playback started' },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to play: ${getErrorMessage(error)}`,
      };
    }
  },
};

/**
 * Pause playback
 */
export const spotifyPauseTool: AgentTool = {
  name: 'spotify_pause',
  description: 'Pause current Spotify playback',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (): Promise<ActionResult> => {
    try {
      await spotifyManager.pause();
      return {
        success: true,
        data: { message: 'Playback paused' },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to pause: ${getErrorMessage(error)}`,
      };
    }
  },
};

/**
 * Skip to next track
 */
export const spotifyNextTool: AgentTool = {
  name: 'spotify_next',
  description: 'Skip to the next track on Spotify',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (): Promise<ActionResult> => {
    try {
      await spotifyManager.next();
      return {
        success: true,
        data: { message: 'Skipped to next track' },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to skip: ${getErrorMessage(error)}`,
      };
    }
  },
};

/**
 * Go to previous track
 */
export const spotifyPreviousTool: AgentTool = {
  name: 'spotify_previous',
  description: 'Go to the previous track on Spotify',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (): Promise<ActionResult> => {
    try {
      await spotifyManager.previous();
      return {
        success: true,
        data: { message: 'Went to previous track' },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to go to previous: ${getErrorMessage(error)}`,
      };
    }
  },
};

/**
 * Set volume
 */
export const spotifySetVolumeTool: AgentTool = {
  name: 'spotify_set_volume',
  description: 'Set Spotify playback volume (0-100)',
  parameters: {
    type: 'object',
    properties: {
      volume: {
        type: 'number',
        description: 'Volume level (0-100)',
      },
    },
    required: ['volume'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const volume = params.volume as number;
      await spotifyManager.setVolume(volume);
      return {
        success: true,
        data: { message: `Volume set to ${volume}%` },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to set volume: ${getErrorMessage(error)}`,
      };
    }
  },
};

/**
 * Search Spotify
 */
export const spotifySearchTool: AgentTool = {
  name: 'spotify_search',
  description: 'Search for tracks, albums, artists, or playlists on Spotify',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query',
      },
      types: {
        type: 'array',
        description: 'Types to search for: track, album, artist, playlist',
        items: { type: 'string' },
      },
      limit: {
        type: 'number',
        description: 'Maximum results per type (default: 10)',
      },
    },
    required: ['query'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const query = params.query as string;
      const types = (params.types as string[] | undefined) || ['track'];
      const limit = (params.limit as number | undefined) || 10;

      const results = await spotifyManager.search(
        query,
        types as ('track' | 'album' | 'artist' | 'playlist')[],
        limit
      );
      return {
        success: true,
        data: results,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to search: ${getErrorMessage(error)}`,
      };
    }
  },
};

/**
 * Add to queue
 */
export const spotifyAddToQueueTool: AgentTool = {
  name: 'spotify_add_to_queue',
  description: 'Add a track to the Spotify playback queue',
  parameters: {
    type: 'object',
    properties: {
      uri: {
        type: 'string',
        description: 'Spotify URI of the track to add (e.g., "spotify:track:xxx")',
      },
    },
    required: ['uri'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const uri = params.uri as string;
      await spotifyManager.addToQueue(uri);
      return {
        success: true,
        data: { message: 'Track added to queue' },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to add to queue: ${getErrorMessage(error)}`,
      };
    }
  },
};

/**
 * Get user playlists
 */
export const spotifyGetPlaylistsTool: AgentTool = {
  name: 'spotify_get_playlists',
  description: "Get the current user's Spotify playlists",
  parameters: {
    type: 'object',
    properties: {
      limit: {
        type: 'number',
        description: 'Maximum number of playlists to return (default: 20)',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const limit = (params.limit as number | undefined) || 20;
      const playlists = await spotifyManager.getPlaylists(limit);
      return {
        success: true,
        data: { playlists },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to get playlists: ${getErrorMessage(error)}`,
      };
    }
  },
};

/**
 * Play a playlist
 */
export const spotifyPlayPlaylistTool: AgentTool = {
  name: 'spotify_play_playlist',
  description: 'Play a Spotify playlist by URI or search for one by name',
  parameters: {
    type: 'object',
    properties: {
      uri: {
        type: 'string',
        description: 'Spotify playlist URI (e.g., "spotify:playlist:xxx")',
      },
      name: {
        type: 'string',
        description: 'Playlist name to search for (if URI not provided)',
      },
      shuffle: {
        type: 'boolean',
        description: 'Whether to shuffle the playlist',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      let uri = params.uri as string | undefined;
      const name = params.name as string | undefined;
      const shuffle = params.shuffle as boolean | undefined;

      // If no URI but name provided, search for playlist
      if (!uri && name) {
        const results = await spotifyManager.search(name, ['playlist'], 1);
        if (results.playlists.length === 0) {
          return {
            success: false,
            error: `No playlist found matching "${name}"`,
          };
        }
        uri = results.playlists[0].uri;
      }

      if (!uri) {
        return {
          success: false,
          error: 'Either uri or name parameter is required',
        };
      }

      if (shuffle !== undefined) {
        await spotifyManager.setShuffle(shuffle);
      }

      await spotifyManager.play({ context: uri });
      return {
        success: true,
        data: { message: 'Playlist started' },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to play playlist: ${getErrorMessage(error)}`,
      };
    }
  },
};

/**
 * Get available devices
 */
export const spotifyGetDevicesTool: AgentTool = {
  name: 'spotify_get_devices',
  description: 'Get available Spotify playback devices',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (): Promise<ActionResult> => {
    try {
      const devices = await spotifyManager.getDevices();
      return {
        success: true,
        data: { devices },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to get devices: ${getErrorMessage(error)}`,
      };
    }
  },
};

/**
 * Transfer playback to device
 */
export const spotifyTransferPlaybackTool: AgentTool = {
  name: 'spotify_transfer_playback',
  description: 'Transfer Spotify playback to a different device',
  parameters: {
    type: 'object',
    properties: {
      deviceId: {
        type: 'string',
        description: 'Target device ID',
      },
      play: {
        type: 'boolean',
        description: 'Whether to start playback on the new device (default: true)',
      },
    },
    required: ['deviceId'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const deviceId = params.deviceId as string;
      const play = (params.play as boolean | undefined) ?? true;
      await spotifyManager.transferPlayback(deviceId, play);
      return {
        success: true,
        data: { message: 'Playback transferred' },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to transfer playback: ${getErrorMessage(error)}`,
      };
    }
  },
};

/**
 * Disconnect from Spotify
 */
export const spotifyDisconnectTool: AgentTool = {
  name: 'spotify_disconnect',
  description: 'Disconnect from Spotify and clear saved authentication',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (): Promise<ActionResult> => {
    try {
      spotifyManager.disconnect();
      return {
        success: true,
        data: { message: 'Disconnected from Spotify' },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to disconnect: ${getErrorMessage(error)}`,
      };
    }
  },
};

/**
 * Get all Spotify tools
 */
export function getSpotifyTools(): AgentTool[] {
  return [
    spotifyConnectTool,
    spotifyGetPlayingTool,
    spotifyPlayTool,
    spotifyPauseTool,
    spotifyNextTool,
    spotifyPreviousTool,
    spotifySetVolumeTool,
    spotifySearchTool,
    spotifyAddToQueueTool,
    spotifyGetPlaylistsTool,
    spotifyPlayPlaylistTool,
    spotifyGetDevicesTool,
    spotifyTransferPlaybackTool,
    spotifyDisconnectTool,
  ];
}

// Export manager for direct access if needed
export { spotifyManager, SpotifyManager };
