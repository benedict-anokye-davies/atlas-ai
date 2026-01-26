/**
 * Atlas Desktop - Integrations Index
 *
 * Third-party service integrations for Atlas.
 * Each integration provides voice-controllable access to external services.
 *
 * @module integrations
 */

// Figma Integration
export {
  FigmaIntegration,
  FigmaClient,
  FigmaCodeGenerator,
  getFigmaIntegration,
  initializeFigmaIntegration,
} from './figma';

// CI/CD Monitoring
export {
  CICDMonitor,
  getCICDMonitor,
} from './cicd-monitor';

// Project Management (Jira/Linear)
export {
  ProjectManagement,
  getProjectManagement,
} from './project-management';

// Spotify Integration
export {
  SpotifyManager,
  getSpotifyManager,
  shutdownSpotify,
  type SpotifyConfig,
  type SpotifyDevice,
  type SpotifyArtist,
  type SpotifyAlbum,
  type SpotifyTrack,
  type SpotifyPlaylist,
  type CurrentPlayback,
  type SearchResults,
  type SpotifyError,
  type RepeatMode,
  type VoiceCommandResult,
} from './spotify';

export {
  SpotifyAuthManager,
  getSpotifyAuthManager,
  shutdownSpotifyAuth,
  type SpotifyTokens,
  type SpotifyAuthConfig,
  type SpotifyAuthState,
} from './spotify-auth';

// Calendar Integration
export {
  CalendarManager,
  getCalendarManager,
  initializeCalendarManager,
  shutdownCalendarManager,
} from './calendar';

export { OAuthManager, getOAuthManager } from './oauth-manager';

// Re-export calendar types
export type {
  CalendarProvider,
  CalendarAccount,
  CalendarEvent,
  Calendar,
  CreateEventRequest,
  UpdateEventRequest,
  DeleteEventRequest,
  ListEventsRequest,
  FreeBusyRequest,
  FreeBusyResponse,
  FreeBusySlot,
  CalendarSyncState,
  CalendarNotification,
  CalendarManagerStatus,
  CalendarResult,
  OfflineChange,
  EventSummary,
  CalendarConfig,
  CalendarVoiceIntent,
  OAuthTokens,
  OAuthConfig,
  CalendarAttendee,
  CalendarReminder,
  CalendarRecurrence,
  ParsedDateTime,
} from '../../shared/types/calendar';

/**
 * Initialize all integrations with their configurations
 */
export interface IntegrationsConfig {
  spotify?: {
    enabled: boolean;
    clientId: string;
    clientSecret?: string;
  };
  calendar?: {
    enabled: boolean;
    google?: {
      clientId: string;
      clientSecret: string;
    };
    microsoft?: {
      clientId: string;
      clientSecret: string;
      tenantId?: string;
    };
  };
  // Future integrations can be added here
}

/**
 * Integration status summary
 */
export interface IntegrationStatus {
  spotify: {
    initialized: boolean;
    authenticated: boolean;
    isPlaying: boolean;
  };
  calendar: {
    initialized: boolean;
    accountCount: number;
    isOnline: boolean;
    pendingChanges: number;
  };
}

/**
 * Initialize all integrations
 */
export async function initializeAllIntegrations(
  config?: IntegrationsConfig
): Promise<void> {
  const promises: Promise<void>[] = [];

  // Initialize calendar if configured
  if (config?.calendar?.enabled) {
    const { initializeCalendarManager } = await import('./calendar');
    promises.push(
      initializeCalendarManager({
        google: config.calendar.google,
        microsoft: config.calendar.microsoft,
      }).then(() => undefined)
    );
  }

  await Promise.allSettled(promises);
}

/**
 * Shutdown all integrations
 */
export async function shutdownAllIntegrations(): Promise<void> {
  const results = await Promise.allSettled([
    import('./spotify').then((m) => m.shutdownSpotify()),
    import('./calendar').then((m) => m.shutdownCalendarManager()),
  ]);

  // Log any errors but don't throw
  for (const result of results) {
    if (result.status === 'rejected') {
      console.error('Integration shutdown error:', result.reason);
    }
  }
}

/**
 * Get status of all integrations
 */
export async function getIntegrationStatus(): Promise<IntegrationStatus> {
  const [spotifyModule, calendarModule] = await Promise.all([
    import('./spotify').catch(() => null),
    import('./calendar').catch(() => null),
  ]);

  const spotifyStatus = {
    initialized: false,
    authenticated: false,
    isPlaying: false,
  };

  const calendarStatus = {
    initialized: false,
    accountCount: 0,
    isOnline: false,
    pendingChanges: 0,
  };

  if (spotifyModule) {
    try {
      const manager = spotifyModule.getSpotifyManager();
      const status = manager.getStatus();
      spotifyStatus.initialized = true;
      spotifyStatus.authenticated = status.authenticated;
      spotifyStatus.isPlaying = status.playbackState?.isPlaying || false;
    } catch {
      // Spotify not initialized
    }
  }

  if (calendarModule) {
    try {
      const manager = calendarModule.getCalendarManager();
      const status = manager.getStatus();
      calendarStatus.initialized = status.initialized;
      calendarStatus.accountCount = status.accounts.length;
      calendarStatus.isOnline = status.isOnline;
      calendarStatus.pendingChanges = status.pendingChanges;
    } catch {
      // Calendar not initialized
    }
  }

  return {
    spotify: spotifyStatus,
    calendar: calendarStatus,
  };
}

export default {
  initializeAllIntegrations,
  shutdownAllIntegrations,
  getIntegrationStatus,
};
