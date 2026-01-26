/**
 * Atlas Desktop - Calendar Integration
 * Provides unified interface for Google Calendar and Microsoft Outlook integration
 * Supports voice commands, offline sync, and reminder notifications
 */

import { EventEmitter } from 'events';
import { Notification, shell } from 'electron';
import { createModuleLogger } from '../utils/logger';
import { getOAuthManager, OAuthManager } from './oauth-manager';
import type {
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
} from '../../shared/types/calendar';

const logger = createModuleLogger('CalendarManager');

/**
 * Default calendar configuration
 */
const DEFAULT_CONFIG: CalendarConfig = {
  defaultReminders: [
    { method: 'popup', minutes: 10 },
    { method: 'popup', minutes: 30 },
  ],
  syncIntervalMinutes: 15,
  notificationMinutesBefore: [10, 30, 60],
  enableOfflineMode: true,
  maxEventsToCache: 500,
};

/**
 * Google Calendar API endpoints
 */
const GOOGLE_API = {
  calendars: 'https://www.googleapis.com/calendar/v3/users/me/calendarList',
  events: (calendarId: string) =>
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
  freeBusy: 'https://www.googleapis.com/calendar/v3/freeBusy',
};

/**
 * Microsoft Graph API endpoints
 */
const MICROSOFT_API = {
  calendars: 'https://graph.microsoft.com/v1.0/me/calendars',
  events: (calendarId: string) =>
    `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(calendarId)}/events`,
  freeBusy: 'https://graph.microsoft.com/v1.0/me/calendar/getSchedule',
};

/**
 * Calendar Manager
 * Unified interface for calendar operations across providers
 */
export class CalendarManager extends EventEmitter {
  private static instance: CalendarManager | null = null;
  private oauth: OAuthManager;
  private accounts: Map<string, CalendarAccount> = new Map();
  private calendars: Map<string, Calendar> = new Map();
  private events: Map<string, CalendarEvent> = new Map();
  private syncStates: Map<string, CalendarSyncState> = new Map();
  private offlineChanges: OfflineChange[] = [];
  private notifications: CalendarNotification[] = [];
  private config: CalendarConfig;
  private syncInterval: NodeJS.Timeout | null = null;
  private notificationInterval: NodeJS.Timeout | null = null;
  private initialized = false;
  private isOnline = true;

  private constructor(config?: Partial<CalendarConfig>) {
    super();
    this.oauth = getOAuthManager();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.setupEventListeners();
    logger.info('Calendar Manager created', { config: this.config });
  }

  /**
   * Get singleton instance
   */
  static getInstance(config?: Partial<CalendarConfig>): CalendarManager {
    if (!CalendarManager.instance) {
      CalendarManager.instance = new CalendarManager(config);
    }
    return CalendarManager.instance;
  }

  /**
   * Setup internal event listeners
   */
  private setupEventListeners(): void {
    this.oauth.on('account-added', (account: CalendarAccount) => {
      this.accounts.set(account.id, account);
      this.emit('account-added', account);
      this.syncAccount(account.id).catch((err) =>
        logger.error('Initial sync failed', { accountId: account.id, error: err })
      );
    });

    this.oauth.on('account-removed', (accountId: string) => {
      this.accounts.delete(accountId);
      // Remove associated calendars and events
      for (const [id, calendar] of this.calendars) {
        if (calendar.accountId === accountId) {
          this.calendars.delete(id);
        }
      }
      for (const [id, event] of this.events) {
        if (this.getEventAccountId(event) === accountId) {
          this.events.delete(id);
        }
      }
      this.emit('account-removed', accountId);
    });
  }

  /**
   * Initialize the calendar manager
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    logger.info('Initializing Calendar Manager');

    // Load stored accounts from OAuth manager
    const accountIds = await this.oauth.getAllAccountIds();
    for (const accountId of accountIds) {
      const provider = accountId.startsWith('google_') ? 'google' : 'microsoft';
      const tokens = await this.oauth.getTokens(accountId);
      if (tokens) {
        // Reconstruct account - in production would load from persistent storage
        this.accounts.set(accountId, {
          id: accountId,
          provider,
          email: '',
          displayName: '',
          isDefault: this.accounts.size === 0,
          tokens,
          createdAt: Date.now(),
          lastSyncAt: null,
        });
      }
    }

    // Start sync interval
    this.startSyncInterval();

    // Start notification checker
    this.startNotificationChecker();

    this.initialized = true;
    logger.info('Calendar Manager initialized', { accountCount: this.accounts.size });
    this.emit('initialized');
  }

  /**
   * Add a new calendar account
   */
  async addAccount(provider: CalendarProvider): Promise<CalendarResult<CalendarAccount>> {
    try {
      const account = await this.oauth.startAuthFlow(provider);
      this.accounts.set(account.id, account);

      // Set as default if first account
      if (this.accounts.size === 1) {
        account.isDefault = true;
      }

      return { success: true, data: account };
    } catch (error) {
      logger.error('Failed to add account', { provider, error });
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Remove a calendar account
   */
  async removeAccount(accountId: string): Promise<CalendarResult<void>> {
    try {
      const account = this.accounts.get(accountId);
      if (!account) {
        return { success: false, error: 'Account not found' };
      }

      await this.oauth.removeAccount(accountId, account.provider);
      this.accounts.delete(accountId);

      return { success: true };
    } catch (error) {
      logger.error('Failed to remove account', { accountId, error });
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Get all accounts
   */
  getAccounts(): CalendarAccount[] {
    return Array.from(this.accounts.values());
  }

  /**
   * List calendars for an account
   */
  async listCalendars(accountId?: string): Promise<CalendarResult<Calendar[]>> {
    try {
      const accounts = accountId
        ? ([this.accounts.get(accountId)].filter(Boolean) as CalendarAccount[])
        : Array.from(this.accounts.values());

      const calendars: Calendar[] = [];

      for (const account of accounts) {
        const accessToken = await this.oauth.getValidAccessToken(account.id, account.provider);
        const accountCalendars = await this.fetchCalendars(account, accessToken);
        calendars.push(...accountCalendars);
      }

      // Cache calendars
      for (const calendar of calendars) {
        this.calendars.set(calendar.id, calendar);
      }

      return { success: true, data: calendars };
    } catch (error) {
      logger.error('Failed to list calendars', { accountId, error });
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Fetch calendars from provider API
   */
  private async fetchCalendars(account: CalendarAccount, accessToken: string): Promise<Calendar[]> {
    const url = account.provider === 'google' ? GOOGLE_API.calendars : MICROSOFT_API.calendars;

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch calendars: ${response.statusText}`);
    }

    const data = await response.json();
    const items = account.provider === 'google' ? data.items : data.value;

    return (items || []).map((item: Record<string, unknown>) =>
      this.normalizeCalendar(item, account)
    );
  }

  /**
   * Normalize calendar data from different providers
   */
  private normalizeCalendar(raw: Record<string, unknown>, account: CalendarAccount): Calendar {
    if (account.provider === 'google') {
      return {
        id: raw.id as string,
        provider: 'google',
        accountId: account.id,
        name: (raw.summary as string) || 'Untitled',
        description: raw.description as string | undefined,
        color: raw.backgroundColor as string | undefined,
        primary: (raw.primary as boolean) || false,
        accessRole: (raw.accessRole as Calendar['accessRole']) || 'reader',
        timeZone: (raw.timeZone as string) || Intl.DateTimeFormat().resolvedOptions().timeZone,
        selected: (raw.selected as boolean) || true,
      };
    } else {
      return {
        id: raw.id as string,
        provider: 'microsoft',
        accountId: account.id,
        name: (raw.name as string) || 'Untitled',
        description: undefined,
        color: (raw.hexColor as string) || undefined,
        primary: (raw.isDefaultCalendar as boolean) || false,
        accessRole: raw.canEdit ? 'writer' : 'reader',
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        selected: true,
      };
    }
  }

  /**
   * List events from calendars
   */
  async listEvents(request: ListEventsRequest): Promise<CalendarResult<CalendarEvent[]>> {
    try {
      // Default time range: now to 7 days from now
      const timeMin = request.timeMin || new Date().toISOString();
      const timeMax =
        request.timeMax || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      const events: CalendarEvent[] = [];

      for (const account of this.accounts.values()) {
        const accessToken = await this.oauth.getValidAccessToken(account.id, account.provider);
        const calendars = Array.from(this.calendars.values()).filter(
          (c) => c.accountId === account.id && c.selected
        );

        for (const calendar of calendars) {
          if (request.calendarId && calendar.id !== request.calendarId) continue;

          const calendarEvents = await this.fetchEvents(
            account,
            calendar.id,
            accessToken,
            timeMin,
            timeMax,
            request.maxResults,
            request.query
          );
          events.push(...calendarEvents);
        }
      }

      // Sort by start time
      events.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

      // Cache events
      for (const event of events) {
        this.events.set(event.id, event);
      }

      return { success: true, data: events };
    } catch (error) {
      logger.error('Failed to list events', { request, error });

      // Return cached events if offline
      if (this.config.enableOfflineMode && !this.isOnline) {
        const cachedEvents = Array.from(this.events.values());
        return { success: true, data: cachedEvents, offline: true };
      }

      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Fetch events from provider API
   */
  private async fetchEvents(
    account: CalendarAccount,
    calendarId: string,
    accessToken: string,
    timeMin: string,
    timeMax: string,
    maxResults?: number,
    query?: string
  ): Promise<CalendarEvent[]> {
    let url: string;
    const params = new URLSearchParams();

    if (account.provider === 'google') {
      url = GOOGLE_API.events(calendarId);
      params.set('timeMin', timeMin);
      params.set('timeMax', timeMax);
      params.set('singleEvents', 'true');
      params.set('orderBy', 'startTime');
      if (maxResults) params.set('maxResults', maxResults.toString());
      if (query) params.set('q', query);
    } else {
      url = MICROSOFT_API.events(calendarId);
      params.set('$filter', `start/dateTime ge '${timeMin}' and end/dateTime le '${timeMax}'`);
      params.set('$orderby', 'start/dateTime');
      if (maxResults) params.set('$top', maxResults.toString());
      if (query) params.set('$search', `"${query}"`);
    }

    const response = await fetch(`${url}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch events: ${response.statusText}`);
    }

    const data = await response.json();
    const items = account.provider === 'google' ? data.items : data.value;

    return (items || []).map((item: Record<string, unknown>) =>
      this.normalizeEvent(item, account, calendarId)
    );
  }

  /**
   * Normalize event data from different providers
   */
  private normalizeEvent(
    raw: Record<string, unknown>,
    account: CalendarAccount,
    calendarId: string
  ): CalendarEvent {
    if (account.provider === 'google') {
      const start = raw.start as Record<string, string>;
      const end = raw.end as Record<string, string>;
      const attendees = (raw.attendees || []) as Array<Record<string, unknown>>;
      const reminders = raw.reminders as Record<string, unknown> | undefined;
      const organizer = raw.organizer as Record<string, string> | undefined;

      return {
        id: raw.id as string,
        calendarId,
        provider: 'google',
        title: (raw.summary as string) || 'Untitled',
        description: raw.description as string | undefined,
        location: raw.location as string | undefined,
        startTime: start.dateTime || start.date,
        endTime: end.dateTime || end.date,
        allDay: !start.dateTime,
        timeZone: start.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone,
        status: (raw.status as CalendarEvent['status']) || 'confirmed',
        visibility: (raw.visibility as CalendarEvent['visibility']) || 'default',
        attendees: attendees.map((a) => ({
          email: a.email as string,
          displayName: a.displayName as string | undefined,
          responseStatus:
            (a.responseStatus as 'needsAction' | 'declined' | 'tentative' | 'accepted') ||
            'needsAction',
          organizer: a.organizer as boolean | undefined,
          self: a.self as boolean | undefined,
        })),
        reminders:
          reminders?.useDefault === false
            ? ((reminders.overrides || []) as Array<{ method: string; minutes: number }>).map(
                (r) => ({
                  method: r.method as 'email' | 'popup' | 'sms',
                  minutes: r.minutes,
                })
              )
            : this.config.defaultReminders,
        conferenceLink: raw.hangoutLink as string | undefined,
        htmlLink: raw.htmlLink as string | undefined,
        created: raw.created as string,
        updated: raw.updated as string,
        organizer: organizer
          ? {
              email: organizer.email,
              displayName: organizer.displayName,
              responseStatus: 'accepted',
              organizer: true,
            }
          : undefined,
        iCalUID: raw.iCalUID as string | undefined,
      };
    } else {
      const start = raw.start as Record<string, string>;
      const end = raw.end as Record<string, string>;
      const attendees = (raw.attendees || []) as Array<Record<string, unknown>>;
      const organizer = raw.organizer as Record<string, unknown> | undefined;
      const onlineMeeting = raw.onlineMeeting as Record<string, string> | undefined;

      return {
        id: raw.id as string,
        calendarId,
        provider: 'microsoft',
        title: (raw.subject as string) || 'Untitled',
        description: (raw.bodyPreview as string) || (raw.body as Record<string, string>)?.content,
        location: (raw.location as Record<string, string>)?.displayName,
        startTime: start.dateTime,
        endTime: end.dateTime,
        allDay: (raw.isAllDay as boolean) || false,
        timeZone: start.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone,
        status: raw.isCancelled ? 'cancelled' : 'confirmed',
        visibility: (raw.sensitivity as string) === 'private' ? 'private' : 'default',
        attendees: attendees.map((a) => {
          const emailAddress = a.emailAddress as Record<string, string>;
          const status = a.status as Record<string, string>;
          return {
            email: emailAddress?.address || '',
            displayName: emailAddress?.name,
            responseStatus: this.mapMicrosoftResponseStatus(status?.response || 'none'),
            organizer:
              a.type === 'required' &&
              (a.emailAddress as Record<string, string>)?.address ===
                (organizer?.emailAddress as Record<string, string>)?.address,
          };
        }),
        reminders: raw.isReminderOn
          ? [{ method: 'popup', minutes: (raw.reminderMinutesBeforeStart as number) || 15 }]
          : [],
        conferenceLink: onlineMeeting?.joinUrl,
        htmlLink: raw.webLink as string | undefined,
        created: raw.createdDateTime as string,
        updated: raw.lastModifiedDateTime as string,
        organizer: organizer
          ? {
              email: (organizer.emailAddress as Record<string, string>)?.address || '',
              displayName: (organizer.emailAddress as Record<string, string>)?.name,
              responseStatus: 'accepted',
              organizer: true,
            }
          : undefined,
        iCalUID: raw.iCalUId as string | undefined,
      };
    }
  }

  /**
   * Map Microsoft response status to standard format
   */
  private mapMicrosoftResponseStatus(
    status: string
  ): 'needsAction' | 'declined' | 'tentative' | 'accepted' {
    const mapping: Record<string, 'needsAction' | 'declined' | 'tentative' | 'accepted'> = {
      none: 'needsAction',
      notResponded: 'needsAction',
      declined: 'declined',
      tentativelyAccepted: 'tentative',
      accepted: 'accepted',
    };
    return mapping[status] || 'needsAction';
  }

  /**
   * Create a new calendar event
   */
  async createEvent(request: CreateEventRequest): Promise<CalendarResult<CalendarEvent>> {
    try {
      // Get default calendar if not specified
      const calendarId = request.calendarId || this.getDefaultCalendarId();
      if (!calendarId) {
        return { success: false, error: 'No calendar specified and no default calendar found' };
      }

      const calendar = this.calendars.get(calendarId);
      if (!calendar) {
        return { success: false, error: 'Calendar not found' };
      }

      const account = this.accounts.get(calendar.accountId);
      if (!account) {
        return { success: false, error: 'Account not found for calendar' };
      }

      // Handle offline mode
      if (!this.isOnline && this.config.enableOfflineMode) {
        const offlineChange: OfflineChange = {
          id: `offline_${Date.now()}`,
          type: 'create',
          eventData: request,
          timestamp: Date.now(),
          synced: false,
        };
        this.offlineChanges.push(offlineChange);
        this.emit('offline-change', offlineChange);
        return {
          success: true,
          offline: true,
          data: this.createTemporaryEvent(request, calendarId, account.provider),
        };
      }

      const accessToken = await this.oauth.getValidAccessToken(account.id, account.provider);
      const event = await this.createEventApi(account, calendarId, accessToken, request);

      // Cache the event
      this.events.set(event.id, event);
      this.emit('event-created', event);

      return { success: true, data: event };
    } catch (error) {
      logger.error('Failed to create event', { request, error });
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Create event via API
   */
  private async createEventApi(
    account: CalendarAccount,
    calendarId: string,
    accessToken: string,
    request: CreateEventRequest
  ): Promise<CalendarEvent> {
    const url =
      account.provider === 'google'
        ? GOOGLE_API.events(calendarId)
        : MICROSOFT_API.events(calendarId);

    const body =
      account.provider === 'google'
        ? this.buildGoogleEventBody(request)
        : this.buildMicrosoftEventBody(request);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to create event: ${error}`);
    }

    const data = await response.json();
    return this.normalizeEvent(data, account, calendarId);
  }

  /**
   * Build Google Calendar event body
   */
  private buildGoogleEventBody(request: CreateEventRequest): Record<string, unknown> {
    const body: Record<string, unknown> = {
      summary: request.title,
      description: request.description,
      location: request.location,
    };

    if (request.allDay) {
      body.start = { date: request.startTime.split('T')[0] };
      body.end = { date: request.endTime.split('T')[0] };
    } else {
      body.start = { dateTime: request.startTime, timeZone: request.timeZone };
      body.end = { dateTime: request.endTime, timeZone: request.timeZone };
    }

    if (request.attendees?.length) {
      body.attendees = request.attendees.map((email) => ({ email }));
    }

    if (request.reminders?.length) {
      body.reminders = {
        useDefault: false,
        overrides: request.reminders.map((r) => ({
          method: r.method,
          minutes: r.minutes,
        })),
      };
    }

    if (request.conferenceRequest) {
      body.conferenceData = {
        createRequest: {
          requestId: `atlas_${Date.now()}`,
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      };
    }

    if (request.visibility) {
      body.visibility = request.visibility;
    }

    return body;
  }

  /**
   * Build Microsoft Graph event body
   */
  private buildMicrosoftEventBody(request: CreateEventRequest): Record<string, unknown> {
    const body: Record<string, unknown> = {
      subject: request.title,
      body: request.description ? { contentType: 'text', content: request.description } : undefined,
    };

    if (request.location) {
      body.location = { displayName: request.location };
    }

    body.isAllDay = request.allDay || false;
    body.start = {
      dateTime: request.startTime,
      timeZone: request.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
    body.end = {
      dateTime: request.endTime,
      timeZone: request.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    };

    if (request.attendees?.length) {
      body.attendees = request.attendees.map((email) => ({
        emailAddress: { address: email },
        type: 'required',
      }));
    }

    if (request.reminders?.length) {
      body.isReminderOn = true;
      body.reminderMinutesBeforeStart = request.reminders[0].minutes;
    }

    if (request.conferenceRequest) {
      body.isOnlineMeeting = true;
      body.onlineMeetingProvider = 'teamsForBusiness';
    }

    if (request.visibility === 'private') {
      body.sensitivity = 'private';
    }

    return body;
  }

  /**
   * Create a temporary offline event
   */
  private createTemporaryEvent(
    request: CreateEventRequest,
    calendarId: string,
    provider: CalendarProvider
  ): CalendarEvent {
    return {
      id: `temp_${Date.now()}`,
      calendarId,
      provider,
      title: request.title,
      description: request.description,
      location: request.location,
      startTime: request.startTime,
      endTime: request.endTime,
      allDay: request.allDay || false,
      timeZone: request.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone,
      status: 'tentative',
      visibility: request.visibility || 'default',
      attendees: (request.attendees || []).map((email) => ({
        email,
        responseStatus: 'needsAction',
      })),
      reminders: request.reminders || this.config.defaultReminders,
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
    };
  }

  /**
   * Update an existing event
   */
  async updateEvent(request: UpdateEventRequest): Promise<CalendarResult<CalendarEvent>> {
    try {
      const existingEvent = this.events.get(request.eventId);
      if (!existingEvent) {
        return { success: false, error: 'Event not found' };
      }

      const calendar = this.calendars.get(request.calendarId || existingEvent.calendarId);
      if (!calendar) {
        return { success: false, error: 'Calendar not found' };
      }

      const account = this.accounts.get(calendar.accountId);
      if (!account) {
        return { success: false, error: 'Account not found' };
      }

      // Handle offline mode
      if (!this.isOnline && this.config.enableOfflineMode) {
        const offlineChange: OfflineChange = {
          id: `offline_${Date.now()}`,
          type: 'update',
          eventData: request,
          timestamp: Date.now(),
          synced: false,
        };
        this.offlineChanges.push(offlineChange);
        this.emit('offline-change', offlineChange);
        return {
          success: true,
          offline: true,
          data: { ...existingEvent, ...request } as CalendarEvent,
        };
      }

      const accessToken = await this.oauth.getValidAccessToken(account.id, account.provider);
      const event = await this.updateEventApi(
        account,
        calendar.id,
        accessToken,
        request.eventId,
        request
      );

      // Update cache
      this.events.set(event.id, event);
      this.emit('event-updated', event);

      return { success: true, data: event };
    } catch (error) {
      logger.error('Failed to update event', { request, error });
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Update event via API
   */
  private async updateEventApi(
    account: CalendarAccount,
    calendarId: string,
    accessToken: string,
    eventId: string,
    request: UpdateEventRequest
  ): Promise<CalendarEvent> {
    let url: string;
    if (account.provider === 'google') {
      url = `${GOOGLE_API.events(calendarId)}/${eventId}`;
    } else {
      url = `${MICROSOFT_API.events(calendarId)}/${eventId}`;
    }

    const body =
      account.provider === 'google'
        ? this.buildGoogleEventBody(request as CreateEventRequest)
        : this.buildMicrosoftEventBody(request as CreateEventRequest);

    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to update event: ${error}`);
    }

    const data = await response.json();
    return this.normalizeEvent(data, account, calendarId);
  }

  /**
   * Delete an event
   */
  async deleteEvent(request: DeleteEventRequest): Promise<CalendarResult<void>> {
    try {
      const existingEvent = this.events.get(request.eventId);
      if (!existingEvent) {
        return { success: false, error: 'Event not found' };
      }

      const calendar = this.calendars.get(request.calendarId || existingEvent.calendarId);
      if (!calendar) {
        return { success: false, error: 'Calendar not found' };
      }

      const account = this.accounts.get(calendar.accountId);
      if (!account) {
        return { success: false, error: 'Account not found' };
      }

      // Handle offline mode
      if (!this.isOnline && this.config.enableOfflineMode) {
        const offlineChange: OfflineChange = {
          id: `offline_${Date.now()}`,
          type: 'delete',
          eventData: request,
          timestamp: Date.now(),
          synced: false,
        };
        this.offlineChanges.push(offlineChange);
        this.emit('offline-change', offlineChange);

        // Remove from local cache
        this.events.delete(request.eventId);
        return { success: true, offline: true };
      }

      const accessToken = await this.oauth.getValidAccessToken(account.id, account.provider);
      await this.deleteEventApi(
        account,
        calendar.id,
        accessToken,
        request.eventId,
        request.sendNotifications
      );

      // Remove from cache
      this.events.delete(request.eventId);
      this.emit('event-deleted', request.eventId);

      return { success: true };
    } catch (error) {
      logger.error('Failed to delete event', { request, error });
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Delete event via API
   */
  private async deleteEventApi(
    account: CalendarAccount,
    calendarId: string,
    accessToken: string,
    eventId: string,
    sendNotifications = true
  ): Promise<void> {
    let url: string;
    if (account.provider === 'google') {
      url = `${GOOGLE_API.events(calendarId)}/${eventId}?sendNotifications=${sendNotifications}`;
    } else {
      url = `${MICROSOFT_API.events(calendarId)}/${eventId}`;
    }

    const response = await fetch(url, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok && response.status !== 204) {
      const error = await response.text();
      throw new Error(`Failed to delete event: ${error}`);
    }
  }

  /**
   * Check free/busy status
   */
  async getFreeBusy(request: FreeBusyRequest): Promise<CalendarResult<FreeBusyResponse>> {
    try {
      const result: FreeBusyResponse = {
        calendars: {},
        timeMin: request.timeMin,
        timeMax: request.timeMax,
      };

      for (const account of this.accounts.values()) {
        const accessToken = await this.oauth.getValidAccessToken(account.id, account.provider);

        if (account.provider === 'google') {
          const freeBusy = await this.getGoogleFreeBusy(accessToken, request);
          Object.assign(result.calendars, freeBusy);
        } else {
          const freeBusy = await this.getMicrosoftFreeBusy(accessToken, request);
          Object.assign(result.calendars, freeBusy);
        }
      }

      return { success: true, data: result };
    } catch (error) {
      logger.error('Failed to get free/busy', { request, error });
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Get Google Calendar free/busy
   */
  private async getGoogleFreeBusy(
    accessToken: string,
    request: FreeBusyRequest
  ): Promise<Record<string, FreeBusySlot[]>> {
    const calendars =
      request.calendars ||
      Array.from(this.calendars.values())
        .filter((c) => c.provider === 'google')
        .map((c) => c.id);

    const response = await fetch(GOOGLE_API.freeBusy, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        timeMin: request.timeMin,
        timeMax: request.timeMax,
        items: calendars.map((id) => ({ id })),
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to get free/busy');
    }

    const data = await response.json();
    const result: Record<string, FreeBusySlot[]> = {};

    for (const [calId, calData] of Object.entries(data.calendars || {})) {
      const busy = (calData as { busy: Array<{ start: string; end: string }> }).busy || [];
      result[calId] = busy.map((b) => ({ start: b.start, end: b.end }));
    }

    return result;
  }

  /**
   * Get Microsoft Calendar free/busy
   */
  private async getMicrosoftFreeBusy(
    accessToken: string,
    request: FreeBusyRequest
  ): Promise<Record<string, FreeBusySlot[]>> {
    const accounts = Array.from(this.accounts.values()).filter((a) => a.provider === 'microsoft');
    const schedules = request.calendars || accounts.map((a) => a.email);

    const response = await fetch(MICROSOFT_API.freeBusy, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        schedules,
        startTime: { dateTime: request.timeMin, timeZone: 'UTC' },
        endTime: { dateTime: request.timeMax, timeZone: 'UTC' },
        availabilityViewInterval: 30,
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to get free/busy');
    }

    const data = await response.json();
    const result: Record<string, FreeBusySlot[]> = {};

    for (const schedule of data.value || []) {
      const items = (schedule.scheduleItems || []) as Array<{
        status: string;
        start: { dateTime: string };
        end: { dateTime: string };
      }>;
      result[schedule.scheduleId] = items
        .filter((item) => item.status !== 'free')
        .map((item) => ({
          start: item.start.dateTime,
          end: item.end.dateTime,
        }));
    }

    return result;
  }

  /**
   * Get upcoming events summary (for voice)
   */
  async getUpcomingEventsSummary(hours = 24): Promise<CalendarResult<EventSummary>> {
    const now = new Date();
    const end = new Date(now.getTime() + hours * 60 * 60 * 1000);

    const eventsResult = await this.listEvents({
      timeMin: now.toISOString(),
      timeMax: end.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });

    if (!eventsResult.success) {
      return { success: false, error: eventsResult.error };
    }

    const events = eventsResult.data || [];
    const summary: EventSummary = {
      count: events.length,
      events: events.slice(0, 5).map((e) => ({
        title: e.title,
        time: this.formatEventTime(e),
        location: e.location,
        attendeeCount: e.attendees.length,
      })),
      timeRange: hours === 24 ? 'today' : `the next ${hours} hours`,
    };

    return { success: true, data: summary };
  }

  /**
   * Format event time for voice response
   */
  private formatEventTime(event: CalendarEvent): string {
    const start = new Date(event.startTime);
    const now = new Date();
    const isToday = start.toDateString() === now.toDateString();
    const isTomorrow = start.toDateString() === new Date(now.getTime() + 86400000).toDateString();

    if (event.allDay) {
      if (isToday) return 'all day today';
      if (isTomorrow) return 'all day tomorrow';
      return `all day on ${start.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}`;
    }

    const timeStr = start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    if (isToday) return `at ${timeStr}`;
    if (isTomorrow) return `tomorrow at ${timeStr}`;
    return `on ${start.toLocaleDateString('en-US', { weekday: 'short' })} at ${timeStr}`;
  }

  /**
   * Sync an account
   */
  async syncAccount(accountId: string): Promise<CalendarResult<void>> {
    const account = this.accounts.get(accountId);
    if (!account) {
      return { success: false, error: 'Account not found' };
    }

    const syncState = this.syncStates.get(accountId) || {
      provider: account.provider,
      accountId,
      lastFullSync: null,
      lastIncrementalSync: null,
      syncInProgress: false,
    };

    if (syncState.syncInProgress) {
      return { success: false, error: 'Sync already in progress' };
    }

    syncState.syncInProgress = true;
    this.syncStates.set(accountId, syncState);
    this.emit('sync-start', accountId);

    try {
      // Fetch calendars
      await this.listCalendars(accountId);

      // Fetch events for next 30 days
      const now = new Date();
      const thirtyDaysLater = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      await this.listEvents({
        timeMin: now.toISOString(),
        timeMax: thirtyDaysLater.toISOString(),
      });

      // Sync offline changes
      if (this.isOnline) {
        await this.syncOfflineChanges(account);
      }

      syncState.lastFullSync = Date.now();
      syncState.syncInProgress = false;
      syncState.error = undefined;
      this.syncStates.set(accountId, syncState);

      // Update account sync timestamp
      account.lastSyncAt = Date.now();
      this.accounts.set(accountId, account);

      this.emit('sync-complete', accountId);
      logger.info('Account sync completed', { accountId });

      return { success: true };
    } catch (error) {
      syncState.syncInProgress = false;
      syncState.error = (error as Error).message;
      this.syncStates.set(accountId, syncState);
      this.emit('sync-error', accountId, error);
      logger.error('Account sync failed', { accountId, error });

      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Sync offline changes
   */
  private async syncOfflineChanges(_account: CalendarAccount): Promise<void> {
    const pending = this.offlineChanges.filter((c) => !c.synced);

    for (const change of pending) {
      try {
        if (change.type === 'create') {
          await this.createEvent(change.eventData as CreateEventRequest);
        } else if (change.type === 'update') {
          await this.updateEvent(change.eventData as UpdateEventRequest);
        } else if (change.type === 'delete') {
          await this.deleteEvent(change.eventData as DeleteEventRequest);
        }
        change.synced = true;
        logger.debug('Offline change synced', { changeId: change.id });
      } catch (error) {
        change.error = (error as Error).message;
        logger.warn('Failed to sync offline change', { changeId: change.id, error });
      }
    }

    // Clean up synced changes
    this.offlineChanges = this.offlineChanges.filter((c) => !c.synced);
  }

  /**
   * Start sync interval
   */
  private startSyncInterval(): void {
    if (this.syncInterval) return;

    this.syncInterval = setInterval(
      async () => {
        for (const accountId of this.accounts.keys()) {
          await this.syncAccount(accountId);
        }
      },
      this.config.syncIntervalMinutes * 60 * 1000
    );

    logger.debug('Sync interval started', { intervalMinutes: this.config.syncIntervalMinutes });
  }

  /**
   * Start notification checker
   */
  private startNotificationChecker(): void {
    if (this.notificationInterval) return;

    this.notificationInterval = setInterval(() => {
      this.checkAndSendNotifications();
    }, 60 * 1000); // Check every minute

    logger.debug('Notification checker started');
  }

  /**
   * Check and send event notifications
   */
  private checkAndSendNotifications(): void {
    const now = Date.now();

    for (const event of this.events.values()) {
      const startTime = new Date(event.startTime).getTime();

      for (const minutesBefore of this.config.notificationMinutesBefore) {
        const notifyTime = startTime - minutesBefore * 60 * 1000;
        const notificationId = `${event.id}_${minutesBefore}`;

        // Check if we should notify
        if (now >= notifyTime && now < notifyTime + 60 * 1000) {
          // Check if already notified
          const existing = this.notifications.find((n) => n.id === notificationId);
          if (existing?.notifiedAt) continue;

          // Send notification
          this.sendEventNotification(event, minutesBefore);

          // Record notification
          this.notifications.push({
            id: notificationId,
            eventId: event.id,
            title: event.title,
            startTime: event.startTime,
            location: event.location,
            minutesBefore,
            notifiedAt: now,
            dismissed: false,
          });
        }
      }
    }

    // Clean up old notifications (older than 24 hours)
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    this.notifications = this.notifications.filter(
      (n) => !n.notifiedAt || n.notifiedAt > oneDayAgo
    );
  }

  /**
   * Send event notification
   */
  private sendEventNotification(event: CalendarEvent, minutesBefore: number): void {
    const timeText =
      minutesBefore === 0
        ? 'now'
        : minutesBefore < 60
          ? `in ${minutesBefore} minutes`
          : `in ${Math.round(minutesBefore / 60)} hour(s)`;

    const notification = new Notification({
      title: event.title,
      body: `Starting ${timeText}${event.location ? ` at ${event.location}` : ''}`,
      silent: false,
    });

    notification.on('click', () => {
      if (event.htmlLink) {
        shell.openExternal(event.htmlLink);
      }
    });

    notification.show();
    this.emit('notification-sent', event, minutesBefore);
    logger.debug('Event notification sent', { eventId: event.id, minutesBefore });
  }

  /**
   * Get default calendar ID
   */
  private getDefaultCalendarId(): string | undefined {
    if (this.config.defaultCalendarId) {
      return this.config.defaultCalendarId;
    }

    // Find primary calendar of default account
    for (const account of this.accounts.values()) {
      if (account.isDefault) {
        for (const calendar of this.calendars.values()) {
          if (calendar.accountId === account.id && calendar.primary) {
            return calendar.id;
          }
        }
      }
    }

    // Fall back to first calendar
    const first = this.calendars.values().next().value;
    return first?.id;
  }

  /**
   * Get account ID for an event
   */
  private getEventAccountId(event: CalendarEvent): string | undefined {
    const calendar = this.calendars.get(event.calendarId);
    return calendar?.accountId;
  }

  /**
   * Set online status
   */
  setOnlineStatus(isOnline: boolean): void {
    const wasOffline = !this.isOnline;
    this.isOnline = isOnline;

    if (wasOffline && isOnline) {
      // Sync all accounts when coming back online
      for (const accountId of this.accounts.keys()) {
        this.syncAccount(accountId).catch((err) =>
          logger.error('Failed to sync on reconnect', { accountId, error: err })
        );
      }
    }

    this.emit('online-status-change', isOnline);
  }

  /**
   * Get manager status
   */
  getStatus(): CalendarManagerStatus {
    return {
      initialized: this.initialized,
      accounts: Array.from(this.accounts.values()),
      selectedCalendars: Array.from(this.calendars.values())
        .filter((c) => c.selected)
        .map((c) => c.id),
      syncState: Array.from(this.syncStates.values()),
      isOnline: this.isOnline,
      offlineEventsCount: this.offlineChanges.filter((c) => !c.synced).length,
      pendingChanges: this.offlineChanges.filter((c) => !c.synced).length,
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<CalendarConfig>): void {
    this.config = { ...this.config, ...config };

    // Restart intervals if timing changed
    if (config.syncIntervalMinutes) {
      if (this.syncInterval) {
        clearInterval(this.syncInterval);
        this.syncInterval = null;
      }
      this.startSyncInterval();
    }

    this.emit('config-updated', this.config);
    logger.info('Calendar config updated', { config });
  }

  /**
   * Shutdown manager
   */
  async shutdown(): Promise<void> {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }

    if (this.notificationInterval) {
      clearInterval(this.notificationInterval);
      this.notificationInterval = null;
    }

    await this.oauth.shutdown();
    this.removeAllListeners();
    CalendarManager.instance = null;

    logger.info('Calendar Manager shutdown');
  }
}

/**
 * Get calendar manager instance
 */
export function getCalendarManager(config?: Partial<CalendarConfig>): CalendarManager {
  return CalendarManager.getInstance(config);
}

/**
 * Initialize calendar manager
 */
export async function initializeCalendarManager(
  config?: Partial<CalendarConfig>
): Promise<CalendarManager> {
  const manager = getCalendarManager(config);
  await manager.initialize();
  return manager;
}

/**
 * Shutdown calendar manager
 */
export async function shutdownCalendarManager(): Promise<void> {
  const manager = CalendarManager.getInstance();
  await manager.shutdown();
}
