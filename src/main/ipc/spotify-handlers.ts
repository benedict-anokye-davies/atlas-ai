/**
 * IPC Handlers - Spotify Integration
 *
 * Bridges the Spotify Service with the renderer process
 */

import { ipcMain, BrowserWindow } from 'electron';
import { getSpotifyManager, SpotifyManager, CurrentPlayback } from '../integrations/spotify';
import { createModuleLogger } from '../utils/logger';
import { getKeychainManager } from '../security/keychain';

const logger = createModuleLogger('SpotifyIPC');

let spotifyInstance: SpotifyManager | null = null;

/**
 * Initialize Spotify manager with client credentials
 */
async function getOrInitSpotify(): Promise<SpotifyManager | null> {
  if (spotifyInstance?.getIsInitialized()) {
    return spotifyInstance;
  }

  try {
    // Get client ID from keychain or env
    const keychain = getKeychainManager();
    let clientId = await keychain.getKey('SPOTIFY_CLIENT_ID');
    
    if (!clientId) {
      clientId = process.env.SPOTIFY_CLIENT_ID || '';
    }

    if (!clientId) {
      logger.warn('Spotify client ID not configured');
      return null;
    }

    spotifyInstance = getSpotifyManager({ clientId });
    await spotifyInstance.initialize();
    
    logger.info('Spotify manager initialized');
    return spotifyInstance;
  } catch (error) {
    logger.error('Failed to initialize Spotify', { error: (error as Error).message });
    return null;
  }
}

export function registerSpotifyHandlers(): void {
  // Forward Spotify events to renderer
  const forwardEvent = (eventName: string, data?: unknown) => {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach(win => {
      win.webContents.send(`spotify:${eventName}`, data);
    });
  };

  // Initialize and set up event forwarding
  getOrInitSpotify().then(spotify => {
    if (spotify) {
      spotify.on('authenticated', () => forwardEvent('authenticated'));
      spotify.on('token-refreshed', () => forwardEvent('token-refreshed'));
      spotify.on('token-expired', () => forwardEvent('token-expired'));
      spotify.on('logged-out', () => forwardEvent('logged-out'));
      spotify.on('playback-changed', (data: CurrentPlayback) => forwardEvent('playback-changed', data));
      spotify.on('error', (error: Error) => forwardEvent('error', { message: error.message }));
    }
  });

  // ============================================================================
  // Authentication
  // ============================================================================

  ipcMain.handle('spotify:authenticate', async () => {
    try {
      const spotify = await getOrInitSpotify();
      if (!spotify) {
        return { success: false, error: 'Spotify not configured. Add SPOTIFY_CLIENT_ID to your .env file.' };
      }
      
      const tokens = await spotify.authenticate();
      return { success: true, data: { authenticated: true, expiresAt: tokens.expiresAt } };
    } catch (error) {
      logger.error('Spotify authentication failed', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('spotify:logout', async () => {
    try {
      const spotify = await getOrInitSpotify();
      if (spotify) {
        spotify.logout();
      }
      return { success: true };
    } catch (error) {
      logger.error('Spotify logout failed', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('spotify:getStatus', async () => {
    try {
      const spotify = await getOrInitSpotify();
      if (!spotify) {
        return { success: true, data: { initialized: false, authenticated: false, isPremium: false, playbackState: null, hasActiveDevice: false } };
      }
      return { success: true, data: spotify.getStatus() };
    } catch (error) {
      logger.error('Failed to get Spotify status', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // ============================================================================
  // Playback Control
  // ============================================================================

  ipcMain.handle('spotify:getCurrentPlayback', async () => {
    try {
      const spotify = await getOrInitSpotify();
      if (!spotify || !spotify.isAuthenticated()) {
        return { success: false, error: 'Not authenticated with Spotify' };
      }
      
      const playback = spotify.getCurrentPlayback();
      return { success: true, data: playback };
    } catch (error) {
      logger.error('Failed to get current playback', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('spotify:play', async (_, options?: { contextUri?: string; uris?: string[]; deviceId?: string }) => {
    try {
      const spotify = await getOrInitSpotify();
      if (!spotify || !spotify.isAuthenticated()) {
        return { success: false, error: 'Not authenticated with Spotify' };
      }
      
      await spotify.play(options);
      return { success: true };
    } catch (error) {
      logger.error('Failed to play', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('spotify:pause', async () => {
    try {
      const spotify = await getOrInitSpotify();
      if (!spotify || !spotify.isAuthenticated()) {
        return { success: false, error: 'Not authenticated with Spotify' };
      }
      
      await spotify.pause();
      return { success: true };
    } catch (error) {
      logger.error('Failed to pause', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('spotify:next', async () => {
    try {
      const spotify = await getOrInitSpotify();
      if (!spotify || !spotify.isAuthenticated()) {
        return { success: false, error: 'Not authenticated with Spotify' };
      }
      
      await spotify.next();
      return { success: true };
    } catch (error) {
      logger.error('Failed to skip to next', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('spotify:previous', async () => {
    try {
      const spotify = await getOrInitSpotify();
      if (!spotify || !spotify.isAuthenticated()) {
        return { success: false, error: 'Not authenticated with Spotify' };
      }
      
      await spotify.previous();
      return { success: true };
    } catch (error) {
      logger.error('Failed to go to previous', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('spotify:seek', async (_, positionMs: number) => {
    try {
      const spotify = await getOrInitSpotify();
      if (!spotify || !spotify.isAuthenticated()) {
        return { success: false, error: 'Not authenticated with Spotify' };
      }
      
      await spotify.seek(positionMs);
      return { success: true };
    } catch (error) {
      logger.error('Failed to seek', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('spotify:setVolume', async (_, volumePercent: number) => {
    try {
      const spotify = await getOrInitSpotify();
      if (!spotify || !spotify.isAuthenticated()) {
        return { success: false, error: 'Not authenticated with Spotify' };
      }
      
      await spotify.setVolume(volumePercent);
      return { success: true };
    } catch (error) {
      logger.error('Failed to set volume', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('spotify:setShuffle', async (_, state: boolean) => {
    try {
      const spotify = await getOrInitSpotify();
      if (!spotify || !spotify.isAuthenticated()) {
        return { success: false, error: 'Not authenticated with Spotify' };
      }
      
      await spotify.setShuffle(state);
      return { success: true };
    } catch (error) {
      logger.error('Failed to set shuffle', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('spotify:setRepeat', async (_, state: 'off' | 'track' | 'context') => {
    try {
      const spotify = await getOrInitSpotify();
      if (!spotify || !spotify.isAuthenticated()) {
        return { success: false, error: 'Not authenticated with Spotify' };
      }
      
      await spotify.setRepeat(state);
      return { success: true };
    } catch (error) {
      logger.error('Failed to set repeat', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // ============================================================================
  // Library
  // ============================================================================

  ipcMain.handle('spotify:saveTrack', async (_, trackId: string) => {
    try {
      const spotify = await getOrInitSpotify();
      if (!spotify || !spotify.isAuthenticated()) {
        return { success: false, error: 'Not authenticated with Spotify' };
      }
      
      await spotify.saveTrack(trackId);
      return { success: true };
    } catch (error) {
      logger.error('Failed to save track', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('spotify:removeTrack', async (_, trackId: string) => {
    try {
      const spotify = await getOrInitSpotify();
      if (!spotify || !spotify.isAuthenticated()) {
        return { success: false, error: 'Not authenticated with Spotify' };
      }
      
      await spotify.removeTrack(trackId);
      return { success: true };
    } catch (error) {
      logger.error('Failed to remove track', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('spotify:isTrackSaved', async (_, _trackId: string) => {
    // Note: This would require a Spotify API call to check saved status
    // For now, return false as the method isn't implemented in SpotifyManager
    return { success: true, data: false };
  });

  // ============================================================================
  // Search
  // ============================================================================

  ipcMain.handle('spotify:search', async (_, query: string, types?: string[], limit?: number) => {
    try {
      const spotify = await getOrInitSpotify();
      if (!spotify || !spotify.isAuthenticated()) {
        return { success: false, error: 'Not authenticated with Spotify' };
      }
      
      const results = await spotify.search(query, types as any, limit);
      return { success: true, data: results };
    } catch (error) {
      logger.error('Failed to search', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // ============================================================================
  // Devices
  // ============================================================================

  ipcMain.handle('spotify:getDevices', async () => {
    try {
      const spotify = await getOrInitSpotify();
      if (!spotify || !spotify.isAuthenticated()) {
        return { success: false, error: 'Not authenticated with Spotify' };
      }
      
      const devices = await spotify.getDevices();
      return { success: true, data: devices };
    } catch (error) {
      logger.error('Failed to get devices', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('spotify:transferPlayback', async (_, deviceId: string, play?: boolean) => {
    try {
      const spotify = await getOrInitSpotify();
      if (!spotify || !spotify.isAuthenticated()) {
        return { success: false, error: 'Not authenticated with Spotify' };
      }
      
      await spotify.transferPlayback(deviceId, play);
      return { success: true };
    } catch (error) {
      logger.error('Failed to transfer playback', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // ============================================================================
  // Playlists
  // ============================================================================

  ipcMain.handle('spotify:getPlaylists', async (_, limit?: number) => {
    try {
      const spotify = await getOrInitSpotify();
      if (!spotify || !spotify.isAuthenticated()) {
        return { success: false, error: 'Not authenticated with Spotify' };
      }
      
      const playlists = await spotify.getUserPlaylists(limit);
      return { success: true, data: playlists };
    } catch (error) {
      logger.error('Failed to get playlists', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('spotify:addToQueue', async (_, uri: string) => {
    try {
      const spotify = await getOrInitSpotify();
      if (!spotify || !spotify.isAuthenticated()) {
        return { success: false, error: 'Not authenticated with Spotify' };
      }
      
      await spotify.addToQueue(uri);
      return { success: true };
    } catch (error) {
      logger.error('Failed to add to queue', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // ============================================================================
  // Voice Commands
  // ============================================================================

  ipcMain.handle('spotify:executeVoiceCommand', async (_, command: string, args?: string) => {
    try {
      const spotify = await getOrInitSpotify();
      if (!spotify || !spotify.isAuthenticated()) {
        return { success: false, error: 'Not authenticated with Spotify' };
      }
      
      const result = await spotify.executeVoiceCommand(command, args);
      return { success: true, data: result };
    } catch (error) {
      logger.error('Failed to execute voice command', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  logger.info('Spotify IPC handlers registered');
}

export function unregisterSpotifyHandlers(): void {
  const channels = [
    'spotify:authenticate',
    'spotify:logout',
    'spotify:getStatus',
    'spotify:getCurrentPlayback',
    'spotify:play',
    'spotify:pause',
    'spotify:next',
    'spotify:previous',
    'spotify:seek',
    'spotify:setVolume',
    'spotify:setShuffle',
    'spotify:setRepeat',
    'spotify:saveTrack',
    'spotify:removeTrack',
    'spotify:isTrackSaved',
    'spotify:search',
    'spotify:getDevices',
    'spotify:transferPlayback',
    'spotify:getPlaylists',
    'spotify:addToQueue',
    'spotify:executeVoiceCommand',
  ];

  channels.forEach(channel => {
    ipcMain.removeHandler(channel);
  });

  logger.info('Spotify IPC handlers unregistered');
}
