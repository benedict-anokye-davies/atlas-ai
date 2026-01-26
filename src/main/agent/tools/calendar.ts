/**
 * Atlas Desktop - Calendar Agent Tools
 * Voice-controlled calendar management via Google Calendar and Microsoft Outlook
 *
 * Features:
 * - List upcoming events
 * - Create new events
 * - Update existing events
 * - Delete events
 * - Find free time slots
 * - Set reminders
 *
 * @module agent/tools/calendar
 */

import { AgentTool, ActionResult } from '../../../shared/types/agent';
import { createModuleLogger } from '../../utils/logger';
import { getCalendarManager } from '../../integrations/calendar';
import type { CalendarEvent, CreateEventRequest } from '../../../shared/types/calendar';

const logger = createModuleLogger('CalendarTools');

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Format event for display
 */
function formatEventSummary(event: CalendarEvent): string {
  const startDate = new Date(event.startTime);
  const endDate = new Date(event.endTime);

  const dateStr = startDate.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

  const timeStr = event.allDay
    ? 'All day'
    : `${startDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} - ${endDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;

  let summary = `${event.title} - ${dateStr}, ${timeStr}`;

  if (event.location) {
    summary += ` @ ${event.location}`;
  }

  return summary;
}

/**
 * Parse natural language time into ISO string
 */
function parseNaturalTime(input: string, baseDate: Date = new Date()): Date {
  const lower = input.toLowerCase().trim();

  // Handle relative times
  if (lower === 'now') return new Date();
  if (lower === 'today') {
    const d = new Date(baseDate);
    d.setHours(9, 0, 0, 0);
    return d;
  }
  if (lower === 'tomorrow') {
    const d = new Date(baseDate);
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return d;
  }
  if (lower === 'next week') {
    const d = new Date(baseDate);
    d.setDate(d.getDate() + 7);
    d.setHours(9, 0, 0, 0);
    return d;
  }

  // Handle "in X hours/minutes/days"
  const inMatch = lower.match(/in (\d+) (hour|minute|day|week)s?/);
  if (inMatch) {
    const amount = parseInt(inMatch[1], 10);
    const unit = inMatch[2];
    const d = new Date(baseDate);
    switch (unit) {
      case 'minute':
        d.setMinutes(d.getMinutes() + amount);
        break;
      case 'hour':
        d.setHours(d.getHours() + amount);
        break;
      case 'day':
        d.setDate(d.getDate() + amount);
        break;
      case 'week':
        d.setDate(d.getDate() + amount * 7);
        break;
    }
    return d;
  }

  // Handle "at X:XX" or "at X pm/am"
  const atMatch = lower.match(/at (\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (atMatch) {
    let hours = parseInt(atMatch[1], 10);
    const minutes = atMatch[2] ? parseInt(atMatch[2], 10) : 0;
    const period = atMatch[3];

    if (period === 'pm' && hours < 12) hours += 12;
    if (period === 'am' && hours === 12) hours = 0;

    const d = new Date(baseDate);
    d.setHours(hours, minutes, 0, 0);
    return d;
  }

  // Try parsing as ISO date
  const parsed = new Date(input);
  if (!isNaN(parsed.getTime())) {
    return parsed;
  }

  // Default: return base date
  return baseDate;
}

// =============================================================================
// Agent Tools
// =============================================================================

/**
 * Get upcoming calendar events
 */
export const getUpcomingEventsTool: AgentTool = {
  name: 'calendar_get_upcoming',
  description:
    'Get upcoming calendar events for the next hours or days. Use this to check what meetings or events are scheduled.',
  parameters: {
    type: 'object',
    properties: {
      hours: {
        type: 'number',
        description: 'Number of hours to look ahead (default: 24)',
      },
      maxResults: {
        type: 'number',
        description: 'Maximum number of events to return (default: 10)',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const hours = (params.hours as number) || 24;
      const maxResults = (params.maxResults as number) || 10;

      const manager = getCalendarManager();
      const status = manager.getStatus();

      if (status.accounts.length === 0) {
        return {
          success: true,
          data: {
            message:
              'No calendar accounts connected. Please add a Google or Microsoft calendar account in Settings.',
            events: [],
          },
        };
      }

      // Use listEvents with date range
      const now = new Date();
      const endTime = new Date(now.getTime() + hours * 60 * 60 * 1000);

      const result = await manager.listEvents({
        timeMin: now.toISOString(),
        timeMax: endTime.toISOString(),
        maxResults,
        singleEvents: true,
        orderBy: 'startTime',
      });

      if (!result.success || !result.data) {
        return { success: false, error: result.error || 'Failed to fetch events' };
      }

      const formattedEvents = result.data.map((event) => ({
        id: event.id,
        title: event.title,
        start: event.startTime,
        end: event.endTime,
        location: event.location,
        description: event.description,
        allDay: event.allDay,
        summary: formatEventSummary(event),
      }));

      return {
        success: true,
        data: {
          eventCount: formattedEvents.length,
          timeRange: `Next ${hours} hours`,
          events: formattedEvents,
          message:
            formattedEvents.length > 0
              ? `Found ${formattedEvents.length} upcoming events`
              : 'No upcoming events scheduled',
        },
      };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to get upcoming events', { error: err.message });
      return { success: false, error: err.message };
    }
  },
};

/**
 * Create a new calendar event
 */
export const createEventTool: AgentTool = {
  name: 'calendar_create_event',
  description:
    'Create a new calendar event. Supports natural language times like "tomorrow at 3pm" or "in 2 hours".',
  parameters: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Event title (required)',
      },
      startTime: {
        type: 'string',
        description:
          'Start time - can be natural language (e.g., "tomorrow at 3pm", "in 2 hours") or ISO date',
      },
      endTime: {
        type: 'string',
        description: 'End time - defaults to 1 hour after start if not specified',
      },
      location: {
        type: 'string',
        description: 'Event location (optional)',
      },
      description: {
        type: 'string',
        description: 'Event description (optional)',
      },
      allDay: {
        type: 'boolean',
        description: 'Whether this is an all-day event (default: false)',
      },
      attendees: {
        type: 'array',
        description: 'List of attendee email addresses (optional)',
      },
    },
    required: ['title', 'startTime'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const title = params.title as string;
      const startTimeInput = params.startTime as string;
      const endTimeInput = params.endTime as string | undefined;
      const location = params.location as string | undefined;
      const description = params.description as string | undefined;
      const allDay = (params.allDay as boolean) || false;
      const attendeeEmails = (params.attendees as string[]) || [];

      const manager = getCalendarManager();
      const status = manager.getStatus();

      if (status.accounts.length === 0) {
        return {
          success: false,
          error: 'No calendar accounts connected. Please add a calendar account first.',
        };
      }

      // Parse times
      const startTime = parseNaturalTime(startTimeInput);
      const endTime = endTimeInput
        ? parseNaturalTime(endTimeInput, startTime)
        : new Date(startTime.getTime() + 60 * 60 * 1000); // Default 1 hour duration

      // Get default calendar
      const calendars = await manager.listCalendars();
      if (!calendars.success || !calendars.data || calendars.data.length === 0) {
        return { success: false, error: 'No calendars available' };
      }

      const defaultCalendar = calendars.data.find((c) => c.primary) || calendars.data[0];

      const eventRequest: CreateEventRequest = {
        calendarId: defaultCalendar.id,
        title,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        location,
        description,
        allDay,
        attendees: attendeeEmails,
        reminders: [{ method: 'popup' as const, minutes: 10 }],
      };

      const result = await manager.createEvent(eventRequest);

      if (!result.success || !result.data) {
        return { success: false, error: result.error || 'Failed to create event' };
      }

      return {
        success: true,
        data: {
          eventId: result.data.id,
          title: result.data.title,
          start: result.data.startTime,
          end: result.data.endTime,
          location: result.data.location,
          summary: formatEventSummary(result.data),
          message: `Created event: ${result.data.title}`,
        },
      };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to create event', { error: err.message });
      return { success: false, error: err.message };
    }
  },
};

/**
 * List events for a specific date range
 */
export const listEventsTool: AgentTool = {
  name: 'calendar_list_events',
  description: 'List calendar events for a specific date or date range.',
  parameters: {
    type: 'object',
    properties: {
      startDate: {
        type: 'string',
        description:
          'Start date - natural language (e.g., "today", "tomorrow", "next monday") or ISO date',
      },
      endDate: {
        type: 'string',
        description: 'End date - defaults to end of start date if not specified',
      },
      maxResults: {
        type: 'number',
        description: 'Maximum number of events to return (default: 20)',
      },
    },
    required: ['startDate'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const startDateInput = params.startDate as string;
      const endDateInput = params.endDate as string | undefined;
      const maxResults = (params.maxResults as number) || 20;

      const manager = getCalendarManager();
      const status = manager.getStatus();

      if (status.accounts.length === 0) {
        return {
          success: true,
          data: {
            message: 'No calendar accounts connected.',
            events: [],
          },
        };
      }

      // Parse dates
      const startDate = parseNaturalTime(startDateInput);
      startDate.setHours(0, 0, 0, 0);

      const endDate = endDateInput ? parseNaturalTime(endDateInput) : new Date(startDate);
      if (!endDateInput) {
        endDate.setHours(23, 59, 59, 999);
      }

      const result = await manager.listEvents({
        timeMin: startDate.toISOString(),
        timeMax: endDate.toISOString(),
        maxResults,
      });

      if (!result.success || !result.data) {
        return { success: false, error: result.error || 'Failed to list events' };
      }

      const formattedEvents = result.data.map((event) => ({
        id: event.id,
        title: event.title,
        start: event.startTime,
        end: event.endTime,
        location: event.location,
        allDay: event.allDay,
        summary: formatEventSummary(event),
      }));

      return {
        success: true,
        data: {
          eventCount: formattedEvents.length,
          dateRange: {
            start: startDate.toISOString(),
            end: endDate.toISOString(),
          },
          events: formattedEvents,
        },
      };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to list events', { error: err.message });
      return { success: false, error: err.message };
    }
  },
};

/**
 * Delete a calendar event
 */
export const deleteEventTool: AgentTool = {
  name: 'calendar_delete_event',
  description: 'Delete a calendar event by its ID or title.',
  parameters: {
    type: 'object',
    properties: {
      eventId: {
        type: 'string',
        description: 'Event ID to delete',
      },
      title: {
        type: 'string',
        description: 'Event title to search for and delete (if eventId not provided)',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const eventId = params.eventId as string | undefined;
      const title = params.title as string | undefined;

      if (!eventId && !title) {
        return { success: false, error: 'Either eventId or title is required' };
      }

      const manager = getCalendarManager();

      // If title provided, search for the event first
      let targetEventId = eventId;
      let eventTitle = title;

      if (!eventId && title) {
        // Search upcoming events for matching title (1 week = 168 hours)
        const now = new Date();
        const weekLater = new Date(now.getTime() + 168 * 60 * 60 * 1000);
        const upcoming = await manager.listEvents({
          timeMin: now.toISOString(),
          timeMax: weekLater.toISOString(),
          maxResults: 50,
          singleEvents: true,
          orderBy: 'startTime',
        });
        if (upcoming.success && upcoming.data) {
          const match = upcoming.data.find((e) =>
            e.title.toLowerCase().includes(title.toLowerCase())
          );
          if (match) {
            targetEventId = match.id;
            eventTitle = match.title;
          } else {
            return { success: false, error: `No event found matching "${title}"` };
          }
        }
      }

      if (!targetEventId) {
        return { success: false, error: 'Could not find event to delete' };
      }

      // Get event details to find calendar ID
      const calendars = await manager.listCalendars();
      if (!calendars.success || !calendars.data) {
        return { success: false, error: 'Could not access calendars' };
      }

      // Try to delete from each calendar
      for (const calendar of calendars.data) {
        const result = await manager.deleteEvent({
          eventId: targetEventId,
          calendarId: calendar.id,
        });
        if (result.success) {
          return {
            success: true,
            data: {
              deleted: true,
              eventId: targetEventId,
              title: eventTitle,
              message: `Deleted event: ${eventTitle}`,
            },
          };
        }
      }

      return { success: false, error: 'Failed to delete event' };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to delete event', { error: err.message });
      return { success: false, error: err.message };
    }
  },
};

/**
 * Find free time slots
 */
export const findFreeTimeTool: AgentTool = {
  name: 'calendar_find_free_time',
  description: 'Find available time slots in your calendar. Useful for scheduling meetings.',
  parameters: {
    type: 'object',
    properties: {
      date: {
        type: 'string',
        description: 'Date to check - natural language (e.g., "today", "tomorrow") or ISO date',
      },
      duration: {
        type: 'number',
        description: 'Required duration in minutes (default: 30)',
      },
      startHour: {
        type: 'number',
        description: 'Start of working hours (default: 9)',
      },
      endHour: {
        type: 'number',
        description: 'End of working hours (default: 17)',
      },
    },
    required: ['date'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const dateInput = params.date as string;
      const duration = (params.duration as number) || 30;
      const startHour = (params.startHour as number) || 9;
      const endHour = (params.endHour as number) || 17;

      const manager = getCalendarManager();
      const status = manager.getStatus();

      if (status.accounts.length === 0) {
        return {
          success: true,
          data: {
            message: 'No calendar accounts connected. All time slots are free!',
            freeSlots: [],
          },
        };
      }

      // Parse date
      const targetDate = parseNaturalTime(dateInput);
      const dayStart = new Date(targetDate);
      dayStart.setHours(startHour, 0, 0, 0);
      const dayEnd = new Date(targetDate);
      dayEnd.setHours(endHour, 0, 0, 0);

      // Get events for that day
      const events = await manager.listEvents({
        timeMin: dayStart.toISOString(),
        timeMax: dayEnd.toISOString(),
        maxResults: 50,
      });

      if (!events.success || !events.data) {
        return { success: false, error: 'Failed to fetch calendar events' };
      }

      // Find free slots
      const busySlots = events.data
        .filter((e) => !e.allDay)
        .map((e) => ({
          start: new Date(e.startTime).getTime(),
          end: new Date(e.endTime).getTime(),
        }))
        .sort((a, b) => a.start - b.start);

      const freeSlots: { start: string; end: string; durationMinutes: number }[] = [];
      let currentTime = dayStart.getTime();
      const durationMs = duration * 60 * 1000;

      for (const busy of busySlots) {
        if (busy.start > currentTime) {
          const gapDuration = busy.start - currentTime;
          if (gapDuration >= durationMs) {
            freeSlots.push({
              start: new Date(currentTime).toLocaleTimeString('en-US', {
                hour: 'numeric',
                minute: '2-digit',
              }),
              end: new Date(busy.start).toLocaleTimeString('en-US', {
                hour: 'numeric',
                minute: '2-digit',
              }),
              durationMinutes: Math.floor(gapDuration / 60000),
            });
          }
        }
        currentTime = Math.max(currentTime, busy.end);
      }

      // Check slot after last event
      if (currentTime < dayEnd.getTime()) {
        const gapDuration = dayEnd.getTime() - currentTime;
        if (gapDuration >= durationMs) {
          freeSlots.push({
            start: new Date(currentTime).toLocaleTimeString('en-US', {
              hour: 'numeric',
              minute: '2-digit',
            }),
            end: new Date(dayEnd).toLocaleTimeString('en-US', {
              hour: 'numeric',
              minute: '2-digit',
            }),
            durationMinutes: Math.floor(gapDuration / 60000),
          });
        }
      }

      return {
        success: true,
        data: {
          date: targetDate.toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
          }),
          workingHours: `${startHour}:00 - ${endHour}:00`,
          requiredDuration: `${duration} minutes`,
          freeSlotCount: freeSlots.length,
          freeSlots,
          message:
            freeSlots.length > 0
              ? `Found ${freeSlots.length} available time slots`
              : 'No available time slots matching your criteria',
        },
      };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to find free time', { error: err.message });
      return { success: false, error: err.message };
    }
  },
};

/**
 * Get calendar account status
 */
export const getCalendarStatusTool: AgentTool = {
  name: 'calendar_get_status',
  description: 'Get the status of connected calendar accounts and sync status.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (): Promise<ActionResult> => {
    try {
      const manager = getCalendarManager();
      const status = manager.getStatus();

      return {
        success: true,
        data: {
          initialized: status.initialized,
          isOnline: status.isOnline,
          accountCount: status.accounts.length,
          accounts: status.accounts.map((a) => ({
            provider: a.provider,
            email: a.email,
            isDefault: a.isDefault,
            lastSync: a.lastSyncAt ? new Date(a.lastSyncAt).toLocaleString() : 'Never',
          })),
          selectedCalendars: status.selectedCalendars.length,
          offlineEventsCount: status.offlineEventsCount,
          pendingChanges: status.pendingChanges,
          message:
            status.accounts.length > 0
              ? `${status.accounts.length} calendar account(s) connected`
              : 'No calendar accounts connected. Add one in Settings.',
        },
      };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to get calendar status', { error: err.message });
      return { success: false, error: err.message };
    }
  },
};

/**
 * Get all calendar tools
 */
export function getCalendarTools(): AgentTool[] {
  return [
    getUpcomingEventsTool,
    createEventTool,
    listEventsTool,
    deleteEventTool,
    findFreeTimeTool,
    getCalendarStatusTool,
  ];
}

export default {
  getUpcomingEventsTool,
  createEventTool,
  listEventsTool,
  deleteEventTool,
  findFreeTimeTool,
  getCalendarStatusTool,
  getCalendarTools,
};
