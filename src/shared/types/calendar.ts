/**
 * Atlas Desktop - Calendar Integration Types
 * Type definitions for calendar integration with Google Calendar and Microsoft Outlook
 */

/**
 * Supported calendar providers
 */
export type CalendarProvider = 'google' | 'microsoft';

/**
 * OAuth token data
 */
export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  tokenType: string;
  scope: string;
}

/**
 * OAuth configuration
 */
export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
}

/**
 * Calendar account information
 */
export interface CalendarAccount {
  id: string;
  provider: CalendarProvider;
  email: string;
  displayName: string;
  isDefault: boolean;
  tokens: OAuthTokens;
  createdAt: number;
  lastSyncAt: number | null;
}

/**
 * Calendar event attendee
 */
export interface CalendarAttendee {
  email: string;
  displayName?: string;
  responseStatus: 'needsAction' | 'declined' | 'tentative' | 'accepted';
  organizer?: boolean;
  self?: boolean;
}

/**
 * Calendar event reminder
 */
export interface CalendarReminder {
  method: 'email' | 'popup' | 'sms';
  minutes: number;
}

/**
 * Calendar event recurrence rule
 */
export interface CalendarRecurrence {
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval?: number;
  count?: number;
  until?: string;
  byDay?: string[];
  byMonth?: number[];
  byMonthDay?: number[];
}

/**
 * Calendar event
 */
export interface CalendarEvent {
  id: string;
  calendarId: string;
  provider: CalendarProvider;
  title: string;
  description?: string;
  location?: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
  timeZone: string;
  status: 'confirmed' | 'tentative' | 'cancelled';
  visibility: 'default' | 'public' | 'private' | 'confidential';
  attendees: CalendarAttendee[];
  reminders: CalendarReminder[];
  recurrence?: CalendarRecurrence;
  recurringEventId?: string;
  conferenceLink?: string;
  htmlLink?: string;
  created: string;
  updated: string;
  organizer?: CalendarAttendee;
  iCalUID?: string;
}

/**
 * Calendar (container for events)
 */
export interface Calendar {
  id: string;
  provider: CalendarProvider;
  accountId: string;
  name: string;
  description?: string;
  color?: string;
  primary: boolean;
  accessRole: 'freeBusyReader' | 'reader' | 'writer' | 'owner';
  timeZone: string;
  selected: boolean;
}

/**
 * Create event request
 */
export interface CreateEventRequest {
  calendarId?: string;
  title: string;
  description?: string;
  location?: string;
  startTime: string;
  endTime: string;
  allDay?: boolean;
  timeZone?: string;
  attendees?: string[];
  reminders?: CalendarReminder[];
  recurrence?: CalendarRecurrence;
  visibility?: 'default' | 'public' | 'private';
  conferenceRequest?: boolean;
}

/**
 * Update event request
 */
export interface UpdateEventRequest {
  eventId: string;
  calendarId?: string;
  title?: string;
  description?: string;
  location?: string;
  startTime?: string;
  endTime?: string;
  allDay?: boolean;
  attendees?: string[];
  reminders?: CalendarReminder[];
  recurrence?: CalendarRecurrence;
  status?: 'confirmed' | 'tentative' | 'cancelled';
}

/**
 * Delete event request
 */
export interface DeleteEventRequest {
  eventId: string;
  calendarId?: string;
  sendNotifications?: boolean;
}

/**
 * List events request
 */
export interface ListEventsRequest {
  calendarId?: string;
  timeMin?: string;
  timeMax?: string;
  maxResults?: number;
  singleEvents?: boolean;
  orderBy?: 'startTime' | 'updated';
  query?: string;
  showDeleted?: boolean;
}

/**
 * Free/busy time slot
 */
export interface FreeBusySlot {
  start: string;
  end: string;
}

/**
 * Free/busy request
 */
export interface FreeBusyRequest {
  timeMin: string;
  timeMax: string;
  calendars?: string[];
}

/**
 * Free/busy response
 */
export interface FreeBusyResponse {
  calendars: Record<string, FreeBusySlot[]>;
  timeMin: string;
  timeMax: string;
}

/**
 * Calendar sync state
 */
export interface CalendarSyncState {
  provider: CalendarProvider;
  accountId: string;
  lastSyncToken?: string;
  lastFullSync: number | null;
  lastIncrementalSync: number | null;
  syncInProgress: boolean;
  error?: string;
}

/**
 * Calendar notification
 */
export interface CalendarNotification {
  id: string;
  eventId: string;
  title: string;
  startTime: string;
  location?: string;
  minutesBefore: number;
  notifiedAt?: number;
  dismissed: boolean;
}

/**
 * Calendar manager status
 */
export interface CalendarManagerStatus {
  initialized: boolean;
  accounts: CalendarAccount[];
  selectedCalendars: string[];
  syncState: CalendarSyncState[];
  isOnline: boolean;
  offlineEventsCount: number;
  pendingChanges: number;
}

/**
 * Voice command intent for calendar
 */
export interface CalendarVoiceIntent {
  action: 'list' | 'create' | 'update' | 'delete' | 'find' | 'check_availability';
  title?: string;
  date?: string;
  time?: string;
  duration?: number;
  attendees?: string[];
  location?: string;
  description?: string;
  recurrence?: string;
}

/**
 * Calendar integration config
 */
export interface CalendarConfig {
  google?: {
    clientId: string;
    clientSecret: string;
  };
  microsoft?: {
    clientId: string;
    clientSecret: string;
    tenantId?: string;
  };
  defaultReminders: CalendarReminder[];
  defaultCalendarId?: string;
  syncIntervalMinutes: number;
  notificationMinutesBefore: number[];
  enableOfflineMode: boolean;
  maxEventsToCache: number;
}

/**
 * Calendar operation result
 */
export interface CalendarResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  offline?: boolean;
}

/**
 * Offline change record
 */
export interface OfflineChange {
  id: string;
  type: 'create' | 'update' | 'delete';
  eventData: Partial<CalendarEvent> | CreateEventRequest | UpdateEventRequest;
  timestamp: number;
  synced: boolean;
  error?: string;
}

/**
 * Natural language date/time parsing result
 */
export interface ParsedDateTime {
  date: string;
  time?: string;
  endDate?: string;
  endTime?: string;
  allDay: boolean;
  recurrence?: CalendarRecurrence;
  confidence: number;
}

/**
 * Event summary for voice response
 */
export interface EventSummary {
  count: number;
  events: Array<{
    title: string;
    time: string;
    location?: string;
    attendeeCount: number;
  }>;
  timeRange: string;
}
