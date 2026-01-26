/**
 * Atlas Desktop - Spotify Types
 *
 * Shared type definitions for Spotify integration.
 * These types are used by both main and renderer processes.
 *
 * @module types/spotify
 */

// ============================================================================
// Authentication Types
// ============================================================================

/**
 * Spotify OAuth tokens
 */
export interface SpotifyTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope: string;
  tokenType: string;
}

/**
 * Spotify authentication configuration
 */
export interface SpotifyAuthConfig {
  clientId: string;
  clientSecret?: string;
  redirectPort?: number;
  scopes?: string[];
}

/**
 * Current authentication state
 */
export interface SpotifyAuthState {
  isAuthenticated: boolean;
  expiresAt: number | null;
  scope: string | null;
}

// ============================================================================
// Playback Types
// ============================================================================

/**
 * Spotify device information
 */
export interface SpotifyDevice {
  id: string;
  name: string;
  type: SpotifyDeviceType;
  isActive: boolean;
  isPrivateSession: boolean;
  isRestricted: boolean;
  volumePercent: number;
}

/**
 * Device types supported by Spotify
 */
export type SpotifyDeviceType =
  | 'computer'
  | 'smartphone'
  | 'speaker'
  | 'tv'
  | 'game_console'
  | 'cast_video'
  | 'cast_audio'
  | 'automobile'
  | 'unknown';

/**
 * Spotify artist information
 */
export interface SpotifyArtist {
  id: string;
  name: string;
  uri: string;
  href: string;
}

/**
 * Spotify album information
 */
export interface SpotifyAlbum {
  id: string;
  name: string;
  uri: string;
  images: SpotifyImage[];
  releaseDate: string;
  totalTracks: number;
}

/**
 * Spotify image (album art, playlist cover, etc.)
 */
export interface SpotifyImage {
  url: string;
  width: number;
  height: number;
}

/**
 * Spotify track information
 */
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

/**
 * Spotify playlist information
 */
export interface SpotifyPlaylist {
  id: string;
  name: string;
  uri: string;
  description: string;
  owner: SpotifyPlaylistOwner;
  isPublic: boolean;
  isCollaborative: boolean;
  totalTracks: number;
  images: SpotifyImage[];
}

/**
 * Playlist owner information
 */
export interface SpotifyPlaylistOwner {
  id: string;
  displayName: string;
}

/**
 * Current playback state
 */
export interface SpotifyPlaybackState {
  isPlaying: boolean;
  progress: number;
  shuffleState: boolean;
  repeatState: SpotifyRepeatMode;
  track: SpotifyTrack | null;
  device: SpotifyDevice | null;
  context: SpotifyPlaybackContext;
}

/**
 * Playback context (album, artist, playlist)
 */
export interface SpotifyPlaybackContext {
  type: 'album' | 'artist' | 'playlist' | null;
  uri: string | null;
}

/**
 * Repeat mode options
 */
export type SpotifyRepeatMode = 'off' | 'track' | 'context';

// ============================================================================
// Search Types
// ============================================================================

/**
 * Search results from Spotify API
 */
export interface SpotifySearchResults {
  tracks: SpotifyTrack[];
  artists: SpotifyArtist[];
  albums: SpotifyAlbum[];
  playlists: SpotifyPlaylist[];
}

/**
 * Search query options
 */
export interface SpotifySearchOptions {
  query: string;
  types?: SpotifySearchType[];
  limit?: number;
  offset?: number;
  market?: string;
}

/**
 * Searchable content types
 */
export type SpotifySearchType = 'track' | 'artist' | 'album' | 'playlist';

// ============================================================================
// Voice Command Types
// ============================================================================

/**
 * Result of a voice command execution
 */
export interface SpotifyVoiceCommandResult {
  success: boolean;
  message: string;
  data?: unknown;
  requiresPremium?: boolean;
}

/**
 * Supported voice commands for Spotify
 */
export type SpotifyVoiceCommand =
  | 'play'
  | 'pause'
  | 'stop'
  | 'resume'
  | 'next'
  | 'skip'
  | 'previous'
  | 'back'
  | 'volume'
  | 'shuffle'
  | 'repeat'
  | 'like'
  | 'save'
  | 'unlike'
  | 'unsave'
  | 'whats playing'
  | 'current'
  | 'now playing'
  | 'queue'
  | 'add to queue'
  | 'devices'
  | 'device'
  | 'switch device'
  | 'play on'
  | 'search';

// ============================================================================
// Error Types
// ============================================================================

/**
 * Spotify API error response
 */
export interface SpotifyError {
  status: number;
  message: string;
  reason?: string;
}

/**
 * Common Spotify error reasons
 */
export type SpotifyErrorReason =
  | 'PREMIUM_REQUIRED'
  | 'NO_ACTIVE_DEVICE'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'RATE_LIMITED'
  | 'SERVICE_UNAVAILABLE';

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Spotify integration configuration
 */
export interface SpotifyConfig {
  clientId: string;
  clientSecret?: string;
  market?: string;
  autoRefresh?: boolean;
  pollInterval?: number;
}

/**
 * Spotify integration state for renderer
 */
export interface SpotifyIntegrationState {
  isInitialized: boolean;
  isAuthenticated: boolean;
  isPremium: boolean;
  currentPlayback: SpotifyPlaybackState | null;
  devices: SpotifyDevice[];
  error: string | null;
}

// ============================================================================
// IPC Event Types
// ============================================================================

/**
 * Spotify events sent to renderer via IPC
 */
export type SpotifyIPCEvent =
  | { type: 'authenticated'; tokens: SpotifyTokens }
  | { type: 'token-refreshed' }
  | { type: 'token-expired' }
  | { type: 'logged-out' }
  | { type: 'playback-update'; playback: SpotifyPlaybackState | null }
  | { type: 'premium-status'; isPremium: boolean }
  | { type: 'error'; error: string };

/**
 * Spotify commands from renderer via IPC
 */
export type SpotifyIPCCommand =
  | { type: 'authenticate' }
  | { type: 'logout' }
  | { type: 'play'; query?: string }
  | { type: 'pause' }
  | { type: 'next' }
  | { type: 'previous' }
  | { type: 'volume'; level: number }
  | { type: 'shuffle'; state: boolean }
  | { type: 'repeat'; state: SpotifyRepeatMode }
  | { type: 'seek'; position: number }
  | { type: 'like' }
  | { type: 'unlike' }
  | { type: 'queue'; uri: string }
  | { type: 'transfer'; deviceId: string }
  | { type: 'search'; query: string };
