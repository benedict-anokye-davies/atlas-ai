/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Atlas Desktop - Spotify Integration
 *
 * Full-featured Spotify playback control via voice commands.
 * Supports playback, search, playlists, volume control, and more.
 *
 * Premium limitations are handled gracefully with user feedback.
 *
 * @module integrations/spotify
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import {
  SpotifyAuthManager,
  SpotifyTokens,
  getSpotifyAuthManager,
  shutdownSpotifyAuth,
} from './spotify-auth';

const logger = createModuleLogger('Spotify');

// ============================================================================
// Types
// ============================================================================

export interface SpotifyConfig {
  clientId: string;
  clientSecret?: string;
  market?: string;
  autoRefresh?: boolean;
}

export interface SpotifyDevice {
  id: string;
  name: string;
  type:
    | 'computer'
    | 'smartphone'
    | 'speaker'
    | 'tv'
    | 'game_console'
    | 'cast_video'
    | 'cast_audio'
    | 'automobile'
    | 'unknown';
  isActive: boolean;
  isPrivateSession: boolean;
  isRestricted: boolean;
  volumePercent: number;
}

export interface SpotifyArtist {
  id: string;
  name: string;
  uri: string;
  href: string;
}

export interface SpotifyAlbum {
  id: string;
  name: string;
  uri: string;
  images: Array<{ url: string; width: number; height: number }>;
  releaseDate: string;
  totalTracks: number;
}

export interface SpotifyTrack {
  id: string;
  name: string;
  uri: string;
  href: string;
  durationMs: number;
  explicit: boolean;
  isPlayable: boolean;
  artists: SpotifyArtist[];
  album: SpotifyAlbum;
  trackNumber: number;
  discNumber: number;
}

export interface SpotifyPlaylist {
  id: string;
  name: string;
  uri: string;
  description: string;
  owner: { id: string; displayName: string };
  isPublic: boolean;
  isCollaborative: boolean;
  totalTracks: number;
  images: Array<{ url: string; width: number; height: number }>;
}

export interface CurrentPlayback {
  isPlaying: boolean;
  progress: number;
  shuffleState: boolean;
  repeatState: 'off' | 'track' | 'context';
  track: SpotifyTrack | null;
  device: SpotifyDevice | null;
  context: {
    type: 'album' | 'artist' | 'playlist' | null;
    uri: string | null;
  };
}

export interface SearchResults {
  tracks: SpotifyTrack[];
  artists: SpotifyArtist[];
  albums: SpotifyAlbum[];
  playlists: SpotifyPlaylist[];
}

export interface SpotifyError {
  status: number;
  message: string;
  reason?: string;
}

export type RepeatMode = 'off' | 'track' | 'context';

export interface VoiceCommandResult {
  success: boolean;
  message: string;
  data?: unknown;
  requiresPremium?: boolean;
}

// ============================================================================
// Constants
// ============================================================================

const SPOTIFY_API_BASE = 'https://api.spotify.com/v1';

/** Commands that require Spotify Premium */
const PREMIUM_FEATURES = new Set([
  'play',
  'pause',
  'next',
  'previous',
  'seek',
  'setVolume',
  'setShuffle',
  'setRepeat',
  'transferPlayback',
  'addToQueue',
]);

// ============================================================================
// SpotifyManager Class
// ============================================================================

/**
 * Spotify Integration Manager
 *
 * Provides a high-level API for Spotify playback control suitable for
 * voice command integration. Handles authentication, API calls, and
 * Premium/Free account differences.
 *
 * @example
 * ```typescript
 * const spotify = new SpotifyManager({
 *   clientId: 'your-client-id'
 * });
 *
 * await spotify.initialize();
 * await spotify.authenticate();
 *
 * // Voice command examples
 * await spotify.executeVoiceCommand('play', 'Bohemian Rhapsody');
 * await spotify.executeVoiceCommand('pause');
 * await spotify.executeVoiceCommand('next');
 * await spotify.executeVoiceCommand('volume', '50');
 * ```
 */
export class SpotifyManager extends EventEmitter {
  private config: SpotifyConfig;
  private authManager: SpotifyAuthManager | null = null;
  private isInitialized = false;
  private isPremium = false;
  private currentPlayback: CurrentPlayback | null = null;
  private playbackPollInterval: NodeJS.Timeout | null = null;
  private lastActiveDevice: string | null = null;

  constructor(config: SpotifyConfig) {
    super();
    this.config = {
      market: 'US',
      autoRefresh: true,
      ...config,
    };
  }

  /**
   * Initialize the Spotify manager
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    this.authManager = getSpotifyAuthManager({
      clientId: this.config.clientId,
      clientSecret: this.config.clientSecret,
    });

    // Forward auth events
    this.authManager.on('authenticated', (tokens: SpotifyTokens) => {
      this.emit('authenticated', tokens);
      this.checkPremiumStatus();
      this.startPlaybackPolling();
    });

    this.authManager.on('token-refreshed', () => {
      this.emit('token-refreshed');
    });

    this.authManager.on('token-expired', () => {
      this.emit('token-expired');
      this.stopPlaybackPolling();
    });

    this.authManager.on('logged-out', () => {
      this.emit('logged-out');
      this.stopPlaybackPolling();
      this.isPremium = false;
    });

    this.authManager.on('error', (error: Error) => {
      this.emit('error', error);
    });

    this.isInitialized = true;
    logger.info('Spotify manager initialized');
  }

  /**
   * Check if the manager is initialized
   */
  getIsInitialized(): boolean {
    return this.isInitialized;
  }

  /**
   * Check if user is authenticated
   */
  isAuthenticated(): boolean {
    return this.authManager?.isAuthenticated() ?? false;
  }

  /**
   * Check if user has Premium account
   */
  hasPremium(): boolean {
    return this.isPremium;
  }

  /**
   * Get current playback state
   */
  getCurrentPlayback(): CurrentPlayback | null {
    return this.currentPlayback;
  }

  /**
   * Get overall status of the Spotify integration
   */
  getStatus(): {
    initialized: boolean;
    authenticated: boolean;
    isPremium: boolean;
    playbackState: CurrentPlayback | null;
    hasActiveDevice: boolean;
  } {
    return {
      initialized: this.isInitialized,
      authenticated: this.isAuthenticated(),
      isPremium: this.isPremium,
      playbackState: this.currentPlayback,
      hasActiveDevice: this.currentPlayback?.device?.isActive ?? false,
    };
  }

  /**
   * Start authentication flow
   */
  async authenticate(): Promise<SpotifyTokens> {
    if (!this.authManager) {
      throw new Error('Spotify manager not initialized');
    }
    return this.authManager.authenticate();
  }

  /**
   * Restore session from stored tokens
   */
  restoreSession(tokens: SpotifyTokens): void {
    if (!this.authManager) {
      throw new Error('Spotify manager not initialized');
    }
    this.authManager.setTokens(tokens);
  }

  /**
   * Get stored tokens for persistence
   */
  getTokens(): SpotifyTokens | null {
    return this.authManager?.getTokens() ?? null;
  }

  /**
   * Logout from Spotify
   */
  logout(): void {
    this.authManager?.logout();
    this.isPremium = false;
    this.currentPlayback = null;
    this.stopPlaybackPolling();
  }

  // =========================================================================
  // API Request Helpers
  // =========================================================================

  /**
   * Make an authenticated request to the Spotify API
   */
  private async apiRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    if (!this.authManager) {
      throw new Error('Spotify manager not initialized');
    }

    const accessToken = await this.authManager.getAccessToken();
    if (!accessToken) {
      throw new Error('Not authenticated with Spotify');
    }

    const url = endpoint.startsWith('http') ? endpoint : `${SPOTIFY_API_BASE}${endpoint}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    // Handle rate limiting
    if (response.status === 429) {
      const retryAfter = parseInt(response.headers.get('Retry-After') || '1', 10);
      logger.warn('Spotify rate limit hit', { retryAfter });
      await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
      return this.apiRequest<T>(endpoint, options);
    }

    // Handle errors
    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      const error: SpotifyError = {
        status: response.status,
        message: errorBody.error?.message || response.statusText,
        reason: errorBody.error?.reason,
      };

      // Check for Premium requirement
      if (response.status === 403 && error.reason === 'PREMIUM_REQUIRED') {
        logger.warn('Premium required for this action');
        throw new Error('PREMIUM_REQUIRED');
      }

      throw new Error(`Spotify API error: ${error.status} - ${error.message}`);
    }

    // Handle 204 No Content
    if (response.status === 204) {
      return {} as T;
    }

    return response.json();
  }

  /**
   * Check if user has Spotify Premium
   */
  private async checkPremiumStatus(): Promise<void> {
    try {
      const profile = await this.apiRequest<{ product: string }>('/me');
      this.isPremium = profile.product === 'premium';
      logger.info('Spotify account status', { isPremium: this.isPremium });
      this.emit('premium-status', this.isPremium);
    } catch (error) {
      logger.error('Failed to check premium status', { error });
      this.isPremium = false;
    }
  }

  // =========================================================================
  // Playback Polling
  // =========================================================================

  /**
   * Start polling for playback updates
   */
  private startPlaybackPolling(): void {
    if (this.playbackPollInterval) return;

    // Poll every 5 seconds for current playback
    this.playbackPollInterval = setInterval(async () => {
      try {
        await this.updateCurrentPlayback();
      } catch (error) {
        // Silently handle errors during polling
      }
    }, 5000);

    // Immediate first poll
    this.updateCurrentPlayback();
    logger.debug('Playback polling started');
  }

  /**
   * Stop polling for playback updates
   */
  private stopPlaybackPolling(): void {
    if (this.playbackPollInterval) {
      clearInterval(this.playbackPollInterval);
      this.playbackPollInterval = null;
      logger.debug('Playback polling stopped');
    }
  }

  /**
   * Update current playback state
   */
  private async updateCurrentPlayback(): Promise<void> {
    try {
      const data = await this.apiRequest<any>('/me/player');

      if (!data || Object.keys(data).length === 0) {
        this.currentPlayback = null;
        this.emit('playback-update', null);
        return;
      }

      const playback: CurrentPlayback = {
        isPlaying: data.is_playing,
        progress: data.progress_ms,
        shuffleState: data.shuffle_state,
        repeatState: data.repeat_state,
        track: data.item ? this.parseTrack(data.item) : null,
        device: data.device ? this.parseDevice(data.device) : null,
        context: {
          type: data.context?.type || null,
          uri: data.context?.uri || null,
        },
      };

      // Remember last active device
      if (playback.device?.id) {
        this.lastActiveDevice = playback.device.id;
      }

      this.currentPlayback = playback;
      this.emit('playback-update', playback);
    } catch (error) {
      // Not an error if no active device
    }
  }

  // =========================================================================
  // Data Parsers
  // =========================================================================

  private parseTrack(data: any): SpotifyTrack {
    return {
      id: data.id,
      name: data.name,
      uri: data.uri,
      href: data.href,
      durationMs: data.duration_ms,
      explicit: data.explicit,
      isPlayable: data.is_playable ?? true,
      artists: data.artists.map((a: any) => this.parseArtist(a)),
      album: this.parseAlbum(data.album),
      trackNumber: data.track_number,
      discNumber: data.disc_number,
    };
  }

  private parseArtist(data: any): SpotifyArtist {
    return {
      id: data.id,
      name: data.name,
      uri: data.uri,
      href: data.href,
    };
  }

  private parseAlbum(data: any): SpotifyAlbum {
    return {
      id: data.id,
      name: data.name,
      uri: data.uri,
      images: data.images || [],
      releaseDate: data.release_date,
      totalTracks: data.total_tracks,
    };
  }

  private parseDevice(data: any): SpotifyDevice {
    return {
      id: data.id,
      name: data.name,
      type: data.type?.toLowerCase() || 'unknown',
      isActive: data.is_active,
      isPrivateSession: data.is_private_session,
      isRestricted: data.is_restricted,
      volumePercent: data.volume_percent,
    };
  }

  private parsePlaylist(data: any): SpotifyPlaylist {
    return {
      id: data.id,
      name: data.name,
      uri: data.uri,
      description: data.description || '',
      owner: {
        id: data.owner.id,
        displayName: data.owner.display_name || data.owner.id,
      },
      isPublic: data.public,
      isCollaborative: data.collaborative,
      totalTracks: data.tracks?.total || 0,
      images: data.images || [],
    };
  }

  // =========================================================================
  // Playback Control
  // =========================================================================

  /**
   * Play music (resumes current or starts new)
   */
  async play(options?: {
    contextUri?: string;
    uris?: string[];
    offsetPosition?: number;
    offsetUri?: string;
    positionMs?: number;
    deviceId?: string;
  }): Promise<void> {
    const body: Record<string, unknown> = {};

    if (options?.contextUri) {
      body.context_uri = options.contextUri;
    }
    if (options?.uris) {
      body.uris = options.uris;
    }
    if (options?.offsetPosition !== undefined) {
      body.offset = { position: options.offsetPosition };
    } else if (options?.offsetUri) {
      body.offset = { uri: options.offsetUri };
    }
    if (options?.positionMs !== undefined) {
      body.position_ms = options.positionMs;
    }

    const endpoint = options?.deviceId
      ? `/me/player/play?device_id=${options.deviceId}`
      : '/me/player/play';

    await this.apiRequest(endpoint, {
      method: 'PUT',
      body: Object.keys(body).length > 0 ? JSON.stringify(body) : undefined,
    });

    logger.debug('Playback started', options);
  }

  /**
   * Pause playback
   */
  async pause(deviceId?: string): Promise<void> {
    const endpoint = deviceId ? `/me/player/pause?device_id=${deviceId}` : '/me/player/pause';

    await this.apiRequest(endpoint, { method: 'PUT' });
    logger.debug('Playback paused');
  }

  /**
   * Skip to next track
   */
  async next(deviceId?: string): Promise<void> {
    const endpoint = deviceId ? `/me/player/next?device_id=${deviceId}` : '/me/player/next';

    await this.apiRequest(endpoint, { method: 'POST' });
    logger.debug('Skipped to next track');
  }

  /**
   * Skip to previous track
   */
  async previous(deviceId?: string): Promise<void> {
    const endpoint = deviceId ? `/me/player/previous?device_id=${deviceId}` : '/me/player/previous';

    await this.apiRequest(endpoint, { method: 'POST' });
    logger.debug('Skipped to previous track');
  }

  /**
   * Seek to position in track
   */
  async seek(positionMs: number, deviceId?: string): Promise<void> {
    let endpoint = `/me/player/seek?position_ms=${positionMs}`;
    if (deviceId) {
      endpoint += `&device_id=${deviceId}`;
    }

    await this.apiRequest(endpoint, { method: 'PUT' });
    logger.debug('Seeked to position', { positionMs });
  }

  /**
   * Set volume (0-100)
   */
  async setVolume(volumePercent: number, deviceId?: string): Promise<void> {
    const volume = Math.max(0, Math.min(100, Math.round(volumePercent)));
    let endpoint = `/me/player/volume?volume_percent=${volume}`;
    if (deviceId) {
      endpoint += `&device_id=${deviceId}`;
    }

    await this.apiRequest(endpoint, { method: 'PUT' });
    logger.debug('Volume set', { volume });
  }

  /**
   * Set shuffle state
   */
  async setShuffle(state: boolean, deviceId?: string): Promise<void> {
    let endpoint = `/me/player/shuffle?state=${state}`;
    if (deviceId) {
      endpoint += `&device_id=${deviceId}`;
    }

    await this.apiRequest(endpoint, { method: 'PUT' });
    logger.debug('Shuffle set', { state });
  }

  /**
   * Set repeat mode
   */
  async setRepeat(state: RepeatMode, deviceId?: string): Promise<void> {
    let endpoint = `/me/player/repeat?state=${state}`;
    if (deviceId) {
      endpoint += `&device_id=${deviceId}`;
    }

    await this.apiRequest(endpoint, { method: 'PUT' });
    logger.debug('Repeat mode set', { state });
  }

  /**
   * Add track to queue
   */
  async addToQueue(uri: string, deviceId?: string): Promise<void> {
    let endpoint = `/me/player/queue?uri=${encodeURIComponent(uri)}`;
    if (deviceId) {
      endpoint += `&device_id=${deviceId}`;
    }

    await this.apiRequest(endpoint, { method: 'POST' });
    logger.debug('Added to queue', { uri });
  }

  /**
   * Transfer playback to another device
   */
  async transferPlayback(deviceId: string, play = true): Promise<void> {
    await this.apiRequest('/me/player', {
      method: 'PUT',
      body: JSON.stringify({
        device_ids: [deviceId],
        play,
      }),
    });
    logger.debug('Playback transferred', { deviceId });
  }

  // =========================================================================
  // Search & Discovery
  // =========================================================================

  /**
   * Search for tracks, artists, albums, and playlists
   */
  async search(
    query: string,
    types: Array<'track' | 'artist' | 'album' | 'playlist'> = ['track'],
    limit = 10
  ): Promise<SearchResults> {
    const params = new URLSearchParams({
      q: query,
      type: types.join(','),
      limit: String(limit),
      market: this.config.market || 'US',
    });

    const data = await this.apiRequest<any>(`/search?${params.toString()}`);

    return {
      tracks: data.tracks?.items?.map((t: any) => this.parseTrack(t)) || [],
      artists: data.artists?.items?.map((a: any) => this.parseArtist(a)) || [],
      albums: data.albums?.items?.map((a: any) => this.parseAlbum(a)) || [],
      playlists: data.playlists?.items?.map((p: any) => this.parsePlaylist(p)) || [],
    };
  }

  /**
   * Get user's available devices
   */
  async getDevices(): Promise<SpotifyDevice[]> {
    const data = await this.apiRequest<{ devices: any[] }>('/me/player/devices');
    return data.devices.map((d) => this.parseDevice(d));
  }

  /**
   * Get user's playlists
   */
  async getUserPlaylists(limit = 50): Promise<SpotifyPlaylist[]> {
    const data = await this.apiRequest<{ items: any[] }>(`/me/playlists?limit=${limit}`);
    return data.items.map((p) => this.parsePlaylist(p));
  }

  /**
   * Get currently playing track info (simplified)
   */
  async getCurrentlyPlaying(): Promise<SpotifyTrack | null> {
    try {
      const data = await this.apiRequest<any>('/me/player/currently-playing');
      if (data?.item) {
        return this.parseTrack(data.item);
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Add track to user's liked songs
   */
  async saveTrack(trackId: string): Promise<void> {
    await this.apiRequest(`/me/tracks?ids=${trackId}`, {
      method: 'PUT',
    });
    logger.debug('Track saved', { trackId });
  }

  /**
   * Remove track from user's liked songs
   */
  async removeTrack(trackId: string): Promise<void> {
    await this.apiRequest(`/me/tracks?ids=${trackId}`, {
      method: 'DELETE',
    });
    logger.debug('Track removed', { trackId });
  }

  /**
   * Add track to a playlist
   */
  async addToPlaylist(playlistId: string, trackUri: string): Promise<void> {
    await this.apiRequest(`/playlists/${playlistId}/tracks`, {
      method: 'POST',
      body: JSON.stringify({ uris: [trackUri] }),
    });
    logger.debug('Added to playlist', { playlistId, trackUri });
  }

  // =========================================================================
  // Voice Command Interface
  // =========================================================================

  /**
   * Execute a voice command
   *
   * This is the main entry point for voice-controlled playback.
   * Handles parsing of natural language commands and error handling.
   *
   * @param command - The voice command type
   * @param args - Optional arguments for the command
   * @returns Result object with success status and message
   *
   * @example
   * ```typescript
   * // "Play music"
   * await spotify.executeVoiceCommand('play');
   *
   * // "Play Bohemian Rhapsody by Queen"
   * await spotify.executeVoiceCommand('play', 'Bohemian Rhapsody by Queen');
   *
   * // "Pause"
   * await spotify.executeVoiceCommand('pause');
   *
   * // "Next track"
   * await spotify.executeVoiceCommand('next');
   *
   * // "Volume 50"
   * await spotify.executeVoiceCommand('volume', '50');
   *
   * // "Shuffle on"
   * await spotify.executeVoiceCommand('shuffle', 'on');
   * ```
   */
  async executeVoiceCommand(command: string, args?: string): Promise<VoiceCommandResult> {
    logger.info('Executing voice command', { command, args });

    // Check authentication
    if (!this.isAuthenticated()) {
      return {
        success: false,
        message: "I'm not connected to Spotify. Would you like me to connect your account?",
      };
    }

    // Check Premium requirement for playback control
    const normalizedCommand = command.toLowerCase().trim();
    if (PREMIUM_FEATURES.has(normalizedCommand) && !this.isPremium) {
      return {
        success: false,
        message:
          'This feature requires Spotify Premium. You can still search for music and view your playlists.',
        requiresPremium: true,
      };
    }

    try {
      switch (normalizedCommand) {
        case 'play':
        case 'resume':
          return await this.handlePlayCommand(args);

        case 'pause':
        case 'stop':
          await this.pause();
          return {
            success: true,
            message: 'Paused.',
          };

        case 'next':
        case 'skip': {
          await this.next();
          // Wait briefly for track to change
          await new Promise((r) => setTimeout(r, 500));
          await this.updateCurrentPlayback();
          const nextTrack = this.currentPlayback?.track;
          return {
            success: true,
            message: nextTrack
              ? `Now playing: ${nextTrack.name} by ${nextTrack.artists[0]?.name}`
              : 'Skipped to next track.',
            data: nextTrack,
          };
        }

        case 'previous':
        case 'back': {
          await this.previous();
          await new Promise((r) => setTimeout(r, 500));
          await this.updateCurrentPlayback();
          const prevTrack = this.currentPlayback?.track;
          return {
            success: true,
            message: prevTrack
              ? `Now playing: ${prevTrack.name} by ${prevTrack.artists[0]?.name}`
              : 'Went back to previous track.',
            data: prevTrack,
          };
        }

        case 'volume':
          return await this.handleVolumeCommand(args);

        case 'shuffle':
          return await this.handleShuffleCommand(args);

        case 'repeat':
          return await this.handleRepeatCommand(args);

        case 'like':
        case 'save':
          return await this.handleLikeCommand();

        case 'unlike':
        case 'unsave':
          return await this.handleUnlikeCommand();

        case 'whats playing':
        case 'current':
        case 'now playing':
          return await this.handleCurrentCommand();

        case 'queue':
        case 'add to queue':
          return await this.handleQueueCommand(args);

        case 'devices':
          return await this.handleDevicesCommand();

        case 'device':
        case 'switch device':
        case 'play on':
          return await this.handleSwitchDeviceCommand(args);

        case 'search':
          return await this.handleSearchCommand(args);

        default:
          return {
            success: false,
            message: `I don't recognize that Spotify command. Try "play", "pause", "next", "volume", or "what's playing".`,
          };
      }
    } catch (error) {
      const errorMessage = (error as Error).message;

      if (errorMessage === 'PREMIUM_REQUIRED') {
        return {
          success: false,
          message: 'This feature requires Spotify Premium.',
          requiresPremium: true,
        };
      }

      logger.error('Voice command failed', { command, args, error: errorMessage });
      return {
        success: false,
        message: `Sorry, I couldn't ${command}. ${errorMessage}`,
      };
    }
  }

  private async handlePlayCommand(args?: string): Promise<VoiceCommandResult> {
    // No args = resume playback
    if (!args) {
      await this.play();
      const track = this.currentPlayback?.track;
      return {
        success: true,
        message: track ? `Resuming: ${track.name} by ${track.artists[0]?.name}` : 'Playing.',
      };
    }

    // Search for the requested music
    const results = await this.search(args, ['track', 'artist', 'playlist']);

    // Try to find best match
    if (results.tracks.length > 0) {
      const track = results.tracks[0];
      await this.play({ uris: [track.uri] });
      return {
        success: true,
        message: `Playing "${track.name}" by ${track.artists[0]?.name}`,
        data: track,
      };
    }

    // Try playing from artist
    if (results.artists.length > 0) {
      const artist = results.artists[0];
      await this.play({ contextUri: artist.uri });
      return {
        success: true,
        message: `Playing music by ${artist.name}`,
        data: artist,
      };
    }

    // Try playing a playlist
    if (results.playlists.length > 0) {
      const playlist = results.playlists[0];
      await this.play({ contextUri: playlist.uri });
      return {
        success: true,
        message: `Playing playlist: ${playlist.name}`,
        data: playlist,
      };
    }

    return {
      success: false,
      message: `I couldn't find "${args}" on Spotify. Try being more specific.`,
    };
  }

  private async handleVolumeCommand(args?: string): Promise<VoiceCommandResult> {
    if (!args) {
      const volume = this.currentPlayback?.device?.volumePercent;
      if (volume !== undefined) {
        return {
          success: true,
          message: `Volume is at ${volume}%.`,
          data: { volume },
        };
      }
      return {
        success: false,
        message: 'No active device to check volume.',
      };
    }

    // Parse volume level
    let volume: number;
    const lower = args.toLowerCase();

    if (lower === 'up' || lower === 'louder') {
      volume = Math.min(100, (this.currentPlayback?.device?.volumePercent || 50) + 10);
    } else if (lower === 'down' || lower === 'quieter') {
      volume = Math.max(0, (this.currentPlayback?.device?.volumePercent || 50) - 10);
    } else if (lower === 'mute') {
      volume = 0;
    } else if (lower === 'max' || lower === 'full') {
      volume = 100;
    } else {
      volume = parseInt(args, 10);
      if (isNaN(volume)) {
        return {
          success: false,
          message: 'Please specify a volume level (0-100) or say "up", "down", "mute", or "max".',
        };
      }
    }

    await this.setVolume(volume);
    return {
      success: true,
      message: `Volume set to ${volume}%.`,
      data: { volume },
    };
  }

  private async handleShuffleCommand(args?: string): Promise<VoiceCommandResult> {
    const lower = args?.toLowerCase() || '';
    let state: boolean;

    if (lower === 'on' || lower === 'enable' || lower === 'yes') {
      state = true;
    } else if (lower === 'off' || lower === 'disable' || lower === 'no') {
      state = false;
    } else {
      // Toggle
      state = !this.currentPlayback?.shuffleState;
    }

    await this.setShuffle(state);
    return {
      success: true,
      message: `Shuffle is now ${state ? 'on' : 'off'}.`,
      data: { shuffle: state },
    };
  }

  private async handleRepeatCommand(args?: string): Promise<VoiceCommandResult> {
    const lower = args?.toLowerCase() || '';
    let mode: RepeatMode;

    if (lower === 'off' || lower === 'disable' || lower === 'no') {
      mode = 'off';
    } else if (lower === 'track' || lower === 'song' || lower === 'one') {
      mode = 'track';
    } else if (lower === 'all' || lower === 'playlist' || lower === 'context' || lower === 'on') {
      mode = 'context';
    } else {
      // Cycle through modes
      const current = this.currentPlayback?.repeatState || 'off';
      mode = current === 'off' ? 'context' : current === 'context' ? 'track' : 'off';
    }

    await this.setRepeat(mode);
    const modeText = mode === 'off' ? 'off' : mode === 'track' ? 'repeat one' : 'repeat all';
    return {
      success: true,
      message: `Repeat is now ${modeText}.`,
      data: { repeat: mode },
    };
  }

  private async handleLikeCommand(): Promise<VoiceCommandResult> {
    const track = this.currentPlayback?.track;
    if (!track) {
      return {
        success: false,
        message: 'No track is currently playing.',
      };
    }

    await this.saveTrack(track.id);
    return {
      success: true,
      message: `Saved "${track.name}" to your Liked Songs.`,
      data: track,
    };
  }

  private async handleUnlikeCommand(): Promise<VoiceCommandResult> {
    const track = this.currentPlayback?.track;
    if (!track) {
      return {
        success: false,
        message: 'No track is currently playing.',
      };
    }

    await this.removeTrack(track.id);
    return {
      success: true,
      message: `Removed "${track.name}" from your Liked Songs.`,
      data: track,
    };
  }

  private async handleCurrentCommand(): Promise<VoiceCommandResult> {
    await this.updateCurrentPlayback();
    const track = this.currentPlayback?.track;

    if (!track) {
      return {
        success: true,
        message: 'Nothing is currently playing on Spotify.',
      };
    }

    const progress = this.currentPlayback?.progress || 0;
    const progressMin = Math.floor(progress / 60000);
    const progressSec = Math.floor((progress % 60000) / 1000);
    const durationMin = Math.floor(track.durationMs / 60000);
    const durationSec = Math.floor((track.durationMs % 60000) / 1000);

    return {
      success: true,
      message:
        `Now playing: "${track.name}" by ${track.artists.map((a) => a.name).join(', ')}. ` +
        `${progressMin}:${progressSec.toString().padStart(2, '0')} of ${durationMin}:${durationSec.toString().padStart(2, '0')}.` +
        (this.currentPlayback?.isPlaying ? '' : ' (Paused)'),
      data: {
        track,
        progress,
        isPlaying: this.currentPlayback?.isPlaying,
      },
    };
  }

  private async handleQueueCommand(args?: string): Promise<VoiceCommandResult> {
    if (!args) {
      return {
        success: false,
        message: 'What would you like to add to the queue?',
      };
    }

    const results = await this.search(args, ['track']);
    if (results.tracks.length === 0) {
      return {
        success: false,
        message: `I couldn't find "${args}" to add to your queue.`,
      };
    }

    const track = results.tracks[0];
    await this.addToQueue(track.uri);

    return {
      success: true,
      message: `Added "${track.name}" by ${track.artists[0]?.name} to your queue.`,
      data: track,
    };
  }

  private async handleDevicesCommand(): Promise<VoiceCommandResult> {
    const devices = await this.getDevices();

    if (devices.length === 0) {
      return {
        success: true,
        message:
          'No Spotify devices found. Make sure Spotify is open on your phone, computer, or speaker.',
        data: { devices: [] },
      };
    }

    const deviceList = devices
      .map((d) => `${d.name} (${d.type})${d.isActive ? ' - active' : ''}`)
      .join(', ');

    return {
      success: true,
      message: `Available devices: ${deviceList}`,
      data: { devices },
    };
  }

  private async handleSwitchDeviceCommand(args?: string): Promise<VoiceCommandResult> {
    const devices = await this.getDevices();

    if (devices.length === 0) {
      return {
        success: false,
        message: 'No Spotify devices available.',
      };
    }

    if (!args) {
      // List devices
      return this.handleDevicesCommand();
    }

    // Find matching device
    const lower = args.toLowerCase();
    const device = devices.find(
      (d) => d.name.toLowerCase().includes(lower) || d.type.toLowerCase().includes(lower)
    );

    if (!device) {
      return {
        success: false,
        message: `Couldn't find a device matching "${args}". Available: ${devices.map((d) => d.name).join(', ')}`,
      };
    }

    await this.transferPlayback(device.id);
    return {
      success: true,
      message: `Switched playback to ${device.name}.`,
      data: device,
    };
  }

  private async handleSearchCommand(args?: string): Promise<VoiceCommandResult> {
    if (!args) {
      return {
        success: false,
        message: 'What would you like me to search for?',
      };
    }

    const results = await this.search(args, ['track', 'artist', 'album', 'playlist']);

    const parts: string[] = [];
    if (results.tracks.length > 0) {
      parts.push(
        `Tracks: ${results.tracks
          .slice(0, 3)
          .map((t) => `"${t.name}" by ${t.artists[0]?.name}`)
          .join(', ')}`
      );
    }
    if (results.artists.length > 0) {
      parts.push(
        `Artists: ${results.artists
          .slice(0, 3)
          .map((a) => a.name)
          .join(', ')}`
      );
    }
    if (results.playlists.length > 0) {
      parts.push(
        `Playlists: ${results.playlists
          .slice(0, 3)
          .map((p) => p.name)
          .join(', ')}`
      );
    }

    if (parts.length === 0) {
      return {
        success: true,
        message: `No results found for "${args}".`,
        data: results,
      };
    }

    return {
      success: true,
      message: `Found: ${parts.join('. ')}. Say "play" followed by what you'd like to hear.`,
      data: results,
    };
  }

  // =========================================================================
  // Cleanup
  // =========================================================================

  /**
   * Clean up resources
   */
  destroy(): void {
    this.stopPlaybackPolling();
    this.removeAllListeners();
    this.isInitialized = false;
    logger.info('Spotify manager destroyed');
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let spotifyManager: SpotifyManager | null = null;

/**
 * Get or create the Spotify manager singleton
 */
export function getSpotifyManager(config?: SpotifyConfig): SpotifyManager {
  if (!spotifyManager) {
    if (!config) {
      throw new Error('SpotifyManager not initialized. Provide config on first call.');
    }
    spotifyManager = new SpotifyManager(config);
  }
  return spotifyManager;
}

/**
 * Shutdown the Spotify manager
 */
export async function shutdownSpotify(): Promise<void> {
  if (spotifyManager) {
    spotifyManager.destroy();
    spotifyManager = null;
  }
  shutdownSpotifyAuth();
  logger.info('Spotify integration shutdown');
}

export default {
  SpotifyManager,
  getSpotifyManager,
  shutdownSpotify,
};
