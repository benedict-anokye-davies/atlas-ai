/**
 * Calendar Extractor
 * Parses calendar events and extracts entities and relationships
 */

import { createModuleLogger } from '../../../utils/logger';
import { OntologyEntity, OntologyRelationship, PersonEntity, EventEntity, TaskEntity } from '../../types';
import {
  SemanticParser,
  CalendarParsedOutput,
  CalendarInput,
  MeetingPattern,
  RecurringEvent,
} from '../types';

const logger = createModuleLogger('CalendarExtractor');

// ============================================================================
// CALENDAR EXTRACTOR IMPLEMENTATION
// ============================================================================

export class CalendarExtractor implements SemanticParser<CalendarInput | CalendarInput[], CalendarParsedOutput> {
  readonly name = 'CalendarExtractor';
  readonly version = '1.0.0';
  readonly sourceTypes = ['calendar'] as const;

  // --------------------------------------------------------------------------
  // MAIN PARSE
  // --------------------------------------------------------------------------

  async parse(input: CalendarInput | CalendarInput[]): Promise<CalendarParsedOutput> {
    const events = Array.isArray(input) ? input : [input];
    logger.debug('Parsing calendar events', { count: events.length });

    const recurringEvents = this.detectRecurringEvents(events);
    const meetingPatterns = this.analyzeMeetingPatterns(events);

    // Calculate busy times
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);

    const weekEvents = events.filter(e => {
      const start = new Date(e.startTime);
      return start >= weekStart && start < weekEnd;
    });

    const busyHours = this.calculateBusyTime(weekEvents);

    const output: CalendarParsedOutput = {
      sourceType: 'calendar',
      parsedAt: new Date(),
      events,
      recurringEvents,
      meetingPatterns,
      busyTimes: {
        weeklyHours: busyHours,
        meetingsThisWeek: weekEvents.length,
        averageMeetingDuration: this.calculateAverageDuration(weekEvents),
      },
    };

    logger.info('Calendar parsing completed', {
      eventCount: events.length,
      recurringCount: recurringEvents.length,
      patternCount: meetingPatterns.length,
    });

    return output;
  }

  // --------------------------------------------------------------------------
  // RECURRING EVENT DETECTION
  // --------------------------------------------------------------------------

  private detectRecurringEvents(events: CalendarInput[]): RecurringEvent[] {
    const recurringMap = new Map<string, CalendarInput[]>();

    // Group by recurrence rule or similar titles
    for (const event of events) {
      if (event.recurrence) {
        const key = `recur_${event.recurrence}`;
        if (!recurringMap.has(key)) {
          recurringMap.set(key, []);
        }
        recurringMap.get(key)!.push(event);
      } else {
        // Group by normalized title for potential recurring events
        const normalizedTitle = this.normalizeEventTitle(event.title);
        const key = `title_${normalizedTitle}`;
        if (!recurringMap.has(key)) {
          recurringMap.set(key, []);
        }
        recurringMap.get(key)!.push(event);
      }
    }

    const recurringEvents: RecurringEvent[] = [];

    for (const [key, eventGroup] of recurringMap) {
      if (eventGroup.length < 2) continue;

      // Sort by start time
      eventGroup.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

      const pattern = this.detectRecurrencePattern(eventGroup);
      if (!pattern) continue;

      recurringEvents.push({
        baseEventId: eventGroup[0].id,
        title: eventGroup[0].title,
        recurrenceRule: pattern.rule,
        instances: eventGroup.map(e => new Date(e.startTime)),
        nextOccurrence: this.calculateNextOccurrence(eventGroup, pattern),
        attendees: this.mergeAttendees(eventGroup),
      });
    }

    return recurringEvents;
  }

  private normalizeEventTitle(title: string): string {
    return title
      .toLowerCase()
      .replace(/\d+/g, '') // Remove numbers (dates, versions)
      .replace(/\s+/g, ' ')
      .trim();
  }

  private detectRecurrencePattern(
    events: CalendarInput[]
  ): { rule: string; intervalDays: number } | null {
    if (events.length < 2) return null;

    // Calculate intervals between events
    const intervals: number[] = [];
    for (let i = 1; i < events.length; i++) {
      const prev = new Date(events[i - 1].startTime).getTime();
      const curr = new Date(events[i].startTime).getTime();
      intervals.push((curr - prev) / (1000 * 60 * 60 * 24)); // Days
    }

    // Find the most common interval
    const intervalCounts = new Map<number, number>();
    for (const interval of intervals) {
      const rounded = Math.round(interval);
      intervalCounts.set(rounded, (intervalCounts.get(rounded) || 0) + 1);
    }

    let mostCommon = 0;
    let maxCount = 0;
    for (const [interval, count] of intervalCounts) {
      if (count > maxCount) {
        maxCount = count;
        mostCommon = interval;
      }
    }

    if (maxCount < events.length * 0.5) return null; // Not enough consistency

    // Determine rule
    let rule: string;
    if (mostCommon === 1) rule = 'DAILY';
    else if (mostCommon === 7) rule = 'WEEKLY';
    else if (mostCommon >= 14 && mostCommon <= 16) rule = 'BIWEEKLY';
    else if (mostCommon >= 28 && mostCommon <= 31) rule = 'MONTHLY';
    else rule = `EVERY_${mostCommon}_DAYS`;

    return { rule, intervalDays: mostCommon };
  }

  private calculateNextOccurrence(
    events: CalendarInput[],
    pattern: { rule: string; intervalDays: number }
  ): Date | undefined {
    const lastEvent = events[events.length - 1];
    const lastDate = new Date(lastEvent.startTime);
    const nextDate = new Date(lastDate);
    nextDate.setDate(nextDate.getDate() + pattern.intervalDays);

    // Only return if in the future
    if (nextDate > new Date()) {
      return nextDate;
    }
    return undefined;
  }

  private mergeAttendees(events: CalendarInput[]): string[] {
    const attendees = new Set<string>();
    for (const event of events) {
      for (const attendee of event.attendees) {
        attendees.add(attendee.email.toLowerCase());
      }
    }
    return Array.from(attendees);
  }

  // --------------------------------------------------------------------------
  // MEETING PATTERN ANALYSIS
  // --------------------------------------------------------------------------

  private analyzeMeetingPatterns(events: CalendarInput[]): MeetingPattern[] {
    const patterns: MeetingPattern[] = [];

    // Analyze by attendee frequency
    const attendeeGroups = new Map<string, CalendarInput[]>();
    for (const event of events) {
      const attendeeKey = event.attendees
        .map(a => a.email.toLowerCase())
        .sort()
        .join(',');

      if (attendeeKey && !attendeeGroups.has(attendeeKey)) {
        attendeeGroups.set(attendeeKey, []);
      }
      if (attendeeKey) {
        attendeeGroups.get(attendeeKey)!.push(event);
      }
    }

    for (const [attendeeKey, groupEvents] of attendeeGroups) {
      if (groupEvents.length >= 2) {
        const avgDuration = this.calculateAverageDuration(groupEvents);
        const frequency = this.calculateMeetingFrequency(groupEvents);

        patterns.push({
          attendees: attendeeKey.split(','),
          averageDuration: avgDuration,
          frequency,
          commonTimes: this.findCommonTimes(groupEvents),
          topics: this.extractCommonTopics(groupEvents),
        });
      }
    }

    return patterns.sort((a, b) => {
      // Sort by frequency (more frequent first)
      const freqOrder = { daily: 0, weekly: 1, biweekly: 2, monthly: 3, occasional: 4 };
      return (freqOrder[a.frequency] || 5) - (freqOrder[b.frequency] || 5);
    });
  }

  private calculateMeetingFrequency(
    events: CalendarInput[]
  ): 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'occasional' {
    if (events.length < 2) return 'occasional';

    const firstDate = new Date(events[0].startTime);
    const lastDate = new Date(events[events.length - 1].startTime);
    const daySpan = (lastDate.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24);

    const avgInterval = daySpan / (events.length - 1);

    if (avgInterval <= 2) return 'daily';
    if (avgInterval <= 8) return 'weekly';
    if (avgInterval <= 16) return 'biweekly';
    if (avgInterval <= 35) return 'monthly';
    return 'occasional';
  }

  private findCommonTimes(events: CalendarInput[]): string[] {
    const dayTimeCounts = new Map<string, number>();

    for (const event of events) {
      const start = new Date(event.startTime);
      const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][start.getDay()];
      const hour = start.getHours();
      const key = `${day} ${hour}:00`;

      dayTimeCounts.set(key, (dayTimeCounts.get(key) || 0) + 1);
    }

    return Array.from(dayTimeCounts.entries())
      .filter(([_, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([time]) => time);
  }

  private extractCommonTopics(events: CalendarInput[]): string[] {
    const wordCounts = new Map<string, number>();
    const stopWords = new Set([
      'meeting', 'call', 'sync', 'catch', 'up', 'with', 'the', 'a', 'an',
      'and', 'or', 'for', 'to', 'on', 'at', 'in', 'of', 'weekly', 'daily',
      'monthly', 'team', 'group', 're', 'fwd',
    ]);

    for (const event of events) {
      const words = event.title
        .toLowerCase()
        .replace(/[^a-zA-Z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 2 && !stopWords.has(w));

      for (const word of words) {
        wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
      }
    }

    return Array.from(wordCounts.entries())
      .filter(([_, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([word]) => word);
  }

  // --------------------------------------------------------------------------
  // TIME CALCULATIONS
  // --------------------------------------------------------------------------

  private calculateBusyTime(events: CalendarInput[]): number {
    let totalMinutes = 0;

    for (const event of events) {
      const start = new Date(event.startTime);
      const end = new Date(event.endTime);
      totalMinutes += (end.getTime() - start.getTime()) / (1000 * 60);
    }

    return Math.round(totalMinutes / 60 * 10) / 10; // Hours, 1 decimal
  }

  private calculateAverageDuration(events: CalendarInput[]): number {
    if (events.length === 0) return 0;

    let totalMinutes = 0;
    for (const event of events) {
      const start = new Date(event.startTime);
      const end = new Date(event.endTime);
      totalMinutes += (end.getTime() - start.getTime()) / (1000 * 60);
    }

    return Math.round(totalMinutes / events.length);
  }

  // --------------------------------------------------------------------------
  // ENTITY EXTRACTION
  // --------------------------------------------------------------------------

  extractEntities(output: CalendarParsedOutput): OntologyEntity[] {
    const entities: OntologyEntity[] = [];
    const personMap = new Map<string, PersonEntity>();

    for (const event of output.events) {
      // Create Event entity
      const eventEntity: EventEntity = {
        id: `event_${event.id}`,
        type: 'Event',
        name: event.title,
        createdAt: new Date(),
        updatedAt: new Date(),
        sources: ['calendar'],
        confidence: 0.9,
        eventType: this.categorizeEvent(event),
        startDate: new Date(event.startTime),
        endDate: new Date(event.endTime),
        location: event.location,
        isRecurring: !!event.recurrence,
        recurrencePattern: event.recurrence,
        attendees: event.attendees.map(a => ({
          personId: `person_${a.email.toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
          role: a.organizer ? 'organizer' : 'attendee',
          rsvpStatus: a.responseStatus || 'pending',
        })),
        agenda: event.description,
        tags: [],
        relatedEntities: [],
      };

      entities.push(eventEntity);

      // Create Person entities from attendees
      for (const attendee of event.attendees) {
        const personId = `person_${attendee.email.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;

        if (!personMap.has(personId)) {
          const nameParts = this.parseAttendeName(attendee.name);

          const person: PersonEntity = {
            id: personId,
            type: 'Person',
            name: attendee.name || attendee.email.split('@')[0],
            createdAt: new Date(),
            updatedAt: new Date(),
            sources: ['calendar'],
            confidence: 0.7,
            firstName: nameParts.firstName,
            lastName: nameParts.lastName,
            emails: [{ email: attendee.email, type: 'work', primary: true }],
            phones: [],
            socialProfiles: [],
            addresses: [],
            tags: [],
          };

          personMap.set(personId, person);
          entities.push(person);
        }
      }

      // Create Task entity for events that look like todos
      if (this.isTaskLikeEvent(event)) {
        const task: TaskEntity = {
          id: `task_${event.id}`,
          type: 'Task',
          name: event.title,
          createdAt: new Date(),
          updatedAt: new Date(),
          sources: ['calendar'],
          confidence: 0.6,
          status: new Date(event.endTime) < new Date() ? 'completed' : 'in_progress',
          priority: 'medium',
          dueDate: new Date(event.endTime),
          tags: [],
          subtasks: [],
          dependencies: [],
          blockedBy: [],
        };

        entities.push(task);
      }
    }

    logger.debug('Extracted entities from calendar', {
      eventCount: output.events.length,
      personCount: personMap.size,
      taskCount: entities.filter(e => e.type === 'Task').length,
    });

    return entities;
  }

  private categorizeEvent(
    event: CalendarInput
  ): 'meeting' | 'deadline' | 'reminder' | 'personal' | 'travel' | 'other' {
    const title = event.title.toLowerCase();
    const desc = (event.description || '').toLowerCase();

    if (event.attendees.length > 1) return 'meeting';
    if (title.includes('deadline') || title.includes('due')) return 'deadline';
    if (title.includes('reminder') || title.includes('todo')) return 'reminder';
    if (title.includes('flight') || title.includes('travel') || title.includes('hotel')) return 'travel';
    if (title.includes('lunch') || title.includes('dinner') || title.includes('birthday')) return 'personal';

    return 'other';
  }

  private parseAttendeName(name?: string): { firstName?: string; lastName?: string } {
    if (!name || name.includes('@')) {
      return {};
    }

    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) {
      return { firstName: parts[0] };
    }

    return {
      firstName: parts[0],
      lastName: parts.slice(1).join(' '),
    };
  }

  private isTaskLikeEvent(event: CalendarInput): boolean {
    const title = event.title.toLowerCase();
    const taskKeywords = ['todo', 'task', 'deadline', 'due', 'submit', 'complete', 'finish'];
    return taskKeywords.some(kw => title.includes(kw)) && event.attendees.length <= 1;
  }

  // --------------------------------------------------------------------------
  // RELATIONSHIP EXTRACTION
  // --------------------------------------------------------------------------

  extractRelationships(output: CalendarParsedOutput): OntologyRelationship[] {
    const relationships: OntologyRelationship[] = [];
    const meetingRelMap = new Map<string, OntologyRelationship>();

    for (const event of output.events) {
      const eventId = `event_${event.id}`;

      // Link attendees to events
      for (const attendee of event.attendees) {
        const personId = `person_${attendee.email.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;

        relationships.push({
          id: `${personId}_attended_${eventId}`,
          sourceId: personId,
          sourceType: 'Person',
          targetId: eventId,
          targetType: 'Event',
          relationshipType: attendee.organizer ? 'ORGANIZED' : 'ATTENDED',
          createdAt: new Date(),
          strength: attendee.organizer ? 0.9 : 0.7,
          confidence: 0.9,
          properties: {
            responseStatus: attendee.responseStatus,
          },
        });
      }

      // Create MEETS_WITH relationships between attendees
      const attendeeEmails = event.attendees.map(a => a.email.toLowerCase());
      for (let i = 0; i < attendeeEmails.length; i++) {
        for (let j = i + 1; j < attendeeEmails.length; j++) {
          const person1 = `person_${attendeeEmails[i].replace(/[^a-z0-9]/g, '_')}`;
          const person2 = `person_${attendeeEmails[j].replace(/[^a-z0-9]/g, '_')}`;

          const relKey = [person1, person2].sort().join('_meets_');

          if (!meetingRelMap.has(relKey)) {
            meetingRelMap.set(relKey, {
              id: relKey,
              sourceId: person1,
              sourceType: 'Person',
              targetId: person2,
              targetType: 'Person',
              relationshipType: 'MEETS_WITH',
              createdAt: new Date(),
              strength: 0.5,
              confidence: 0.8,
              properties: {
                meetingCount: 1,
                lastMeeting: event.startTime,
              },
            });
          } else {
            const existing = meetingRelMap.get(relKey)!;
            existing.properties!.meetingCount = (existing.properties!.meetingCount as number) + 1;
            existing.properties!.lastMeeting = event.startTime;
            existing.strength = Math.min(1, existing.strength + 0.1);
          }
        }
      }
    }

    relationships.push(...meetingRelMap.values());

    logger.debug('Extracted relationships from calendar', { count: relationships.length });
    return relationships;
  }

  // --------------------------------------------------------------------------
  // EMBEDDING GENERATION
  // --------------------------------------------------------------------------

  async generateEmbeddings(output: CalendarParsedOutput): Promise<Map<string, number[]>> {
    const embeddings = new Map<string, number[]>();

    // Placeholder - would integrate with actual embedding model
    logger.debug('Embedding generation skipped (placeholder)', {
      eventCount: output.events.length,
    });

    return embeddings;
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let instance: CalendarExtractor | null = null;

export function getCalendarExtractor(): CalendarExtractor {
  if (!instance) {
    instance = new CalendarExtractor();
  }
  return instance;
}
