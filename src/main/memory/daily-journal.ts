/**
 * Atlas Desktop - Daily Journal
 * Create and manage daily journal entries for Atlas
 */

import * as path from 'path';
import * as fse from 'fs-extra';
import { format, parseISO, startOfDay } from 'date-fns';
import { getVaultPath } from './obsidian-brain';
import { createNote, readNote, updateNote } from './note-writer';
import { createModuleLogger } from '../utils/logger';
import { getErrorMessage } from '../../shared/utils';
import { CalendarManager } from '../integrations/calendar';
import { EmailManager, Email } from '../integrations/email';
import { PortfolioManager } from '../trading/portfolio';

const logger = createModuleLogger('DailyJournal');

/**
 * Daily journal structure
 */
export interface DailyJournal {
  date: Date;
  path: string;
  tasks: JournalTask[];
  conversations: JournalConversation[];
  reflections: string[];
  briefing?: MorningBriefing;
}

/**
 * Task entry in journal
 */
export interface JournalTask {
  description: string;
  status: 'done' | 'pending' | 'cancelled';
  completedAt?: string;
}

/**
 * Conversation entry in journal
 */
export interface JournalConversation {
  summary: string;
  noteLink?: string;
  timestamp: string;
}

/**
 * Morning briefing content
 */
export interface MorningBriefing {
  generatedAt: string;
  schedule: BriefingSection;
  emails: BriefingSection;
  portfolio: BriefingSection;
  weather: BriefingSection;
  reminders: BriefingSection;
}

/**
 * Section of morning briefing
 */
export interface BriefingSection {
  title: string;
  items: string[];
  hasData: boolean;
}

/**
 * Get the daily directory path
 */
function getDailyPath(): string {
  return path.join(getVaultPath(), 'daily');
}

/**
 * Get the filename for a date
 */
function getJournalFilename(date: Date): string {
  return `${format(date, 'yyyy-MM-dd')}.md`;
}

/**
 * Get the path to a daily journal
 */
function getJournalPath(date: Date): string {
  return path.join(getDailyPath(), getJournalFilename(date));
}

/**
 * Get the relative path from vault root
 */
function getJournalRelativePath(date: Date): string {
  return `daily/${getJournalFilename(date)}`;
}

/**
 * Create a new daily journal for a specific date
 * Won't overwrite if it already exists
 */
export async function createDailyJournal(date: Date = new Date()): Promise<string> {
  const journalPath = getJournalPath(date);

  // Check if already exists
  if (await fse.pathExists(journalPath)) {
    logger.debug('Daily journal already exists', { date: format(date, 'yyyy-MM-dd') });
    return getJournalRelativePath(date);
  }

  const dateStr = format(date, 'yyyy-MM-dd');
  const dayName = format(date, 'EEEE');
  const fullDate = format(date, 'MMMM d, yyyy');

  const content = `## Overview

*A summary of today's activities and interactions.*

## Schedule

*Today's scheduled events and meetings.*

- No events scheduled

## Tasks

*Tasks completed and in progress.*

### Completed
- [ ] None yet

### In Progress
- [ ] None yet

## Conversations

*Summaries of conversations with the user.*

*No conversations yet today.*

## Reflections

*End of day reflections and learnings.*

*Reflections will be added at the end of the day.*

## Notes

*Miscellaneous notes and observations.*

---

[[_index|Daily Index]]

#daily #${format(date, 'yyyy')} #${format(date, 'MMMM').toLowerCase()}
`;

  // Create the note
  const relativePath = await createNote(
    'daily',
    dateStr,
    content,
    {
      type: 'daily',
      date: dateStr,
      day: dayName,
      fullDate: fullDate,
    },
    { overwrite: false }
  );

  logger.info('Created daily journal', { date: dateStr, path: relativePath });

  return relativePath;
}

/**
 * Get today's journal, creating it if it doesn't exist
 */
export async function getTodayJournal(): Promise<string> {
  return createDailyJournal(new Date());
}

/**
 * Generate a morning briefing
 * Integrates with calendar, email, portfolio, and weather services
 */
export async function generateMorningBriefing(): Promise<MorningBriefing> {
  const now = new Date();
  const startOfToday = startOfDay(now);
  const endOfToday = new Date(startOfToday);
  endOfToday.setDate(endOfToday.getDate() + 1);

  // Gather data from all services in parallel
  const [calendarData, emailData, portfolioData, weatherData] = await Promise.all([
    fetchCalendarEvents(startOfToday, endOfToday),
    fetchUnreadEmails(),
    fetchPortfolioSummary(),
    fetchWeatherData(),
  ]);

  const briefing: MorningBriefing = {
    generatedAt: now.toISOString(),
    schedule: calendarData,
    emails: emailData,
    portfolio: portfolioData,
    weather: weatherData,
    reminders: {
      title: 'Reminders',
      items: ['No reminders set'],
      hasData: false,
    },
  };

  logger.info('Generated morning briefing', {
    hasCalendar: calendarData.hasData,
    hasEmails: emailData.hasData,
    hasPortfolio: portfolioData.hasData,
    hasWeather: weatherData.hasData,
  });

  return briefing;
}

/**
 * Fetch calendar events for today
 */
async function fetchCalendarEvents(
  startDate: Date,
  endDate: Date
): Promise<BriefingSection> {
  try {
    const calendar = CalendarManager.getInstance();
    const status = calendar.getStatus();

    if (!status.isConnected || status.connectedAccounts === 0) {
      return {
        title: "Today's Schedule",
        items: ['No calendar connected'],
        hasData: false,
      };
    }

    const events = await calendar.listEvents({
      timeMin: startDate,
      timeMax: endDate,
      maxResults: 20,
    });

    if (!events.success || !events.data || events.data.length === 0) {
      return {
        title: "Today's Schedule",
        items: ['No events scheduled'],
        hasData: true,
      };
    }

    const items = events.data.map((event) => {
      const startTime = event.start
        ? format(new Date(event.start.dateTime || event.start.date), 'h:mm a')
        : 'All day';
      return `${startTime} - ${event.summary || 'Untitled'}`;
    });

    return {
      title: "Today's Schedule",
      items,
      hasData: true,
    };
  } catch (error) {
    logger.warn('Failed to fetch calendar events', {
      error: getErrorMessage(error),
    });
    return {
      title: "Today's Schedule",
      items: ['Unable to fetch calendar'],
      hasData: false,
    };
  }
}

/**
 * Fetch unread emails
 */
async function fetchUnreadEmails(): Promise<BriefingSection> {
  try {
    const emailManager = EmailManager.getInstance();
    const status = emailManager.getStatus();

    if (!status.isConnected || status.connectedAccounts === 0) {
      return {
        title: 'Unread Emails',
        items: ['No email connected'],
        hasData: false,
      };
    }

    const result = await emailManager.searchEmails({
      isUnread: true,
      maxResults: 10,
    });

    if (!result.success || !result.emails || result.emails.length === 0) {
      return {
        title: 'Unread Emails',
        items: ['No unread emails'],
        hasData: true,
      };
    }

    const items = result.emails.slice(0, 5).map((email: Email) => {
      const from = email.from?.name || email.from?.email || 'Unknown';
      const subject = email.subject || 'No subject';
      return `From ${from}: ${subject.substring(0, 50)}${subject.length > 50 ? '...' : ''}`;
    });

    if (result.emails.length > 5) {
      items.push(`...and ${result.emails.length - 5} more unread`);
    }

    return {
      title: 'Unread Emails',
      items,
      hasData: true,
    };
  } catch (error) {
    logger.warn('Failed to fetch emails', {
      error: getErrorMessage(error),
    });
    return {
      title: 'Unread Emails',
      items: ['Unable to fetch emails'],
      hasData: false,
    };
  }
}

/**
 * Fetch portfolio summary
 */
async function fetchPortfolioSummary(): Promise<BriefingSection> {
  try {
    // PortfolioManager is typically a singleton instance
    // If not instantiated, return placeholder
    let portfolio: PortfolioManager | null = null;
    try {
      portfolio = new PortfolioManager();
    } catch {
      // Portfolio manager not available
    }

    if (!portfolio || portfolio.getExchanges().length === 0) {
      return {
        title: 'Portfolio Summary',
        items: ['No portfolio connected'],
        hasData: false,
      };
    }

    const balance = await portfolio.getAggregatedBalance();
    const items: string[] = [];

    // Total value
    const totalValue = balance.totalUsdValue;
    items.push(`Total Value: $${totalValue.toFixed(2)}`);

    // Top holdings
    const sortedCurrencies = Array.from(balance.byCurrency.entries())
      .sort(([, a], [, b]) => b.minus(a).toNumber())
      .slice(0, 3);

    for (const [currency, amount] of sortedCurrencies) {
      items.push(`${currency}: ${amount.toFixed(4)}`);
    }

    return {
      title: 'Portfolio Summary',
      items,
      hasData: true,
    };
  } catch (error) {
    logger.warn('Failed to fetch portfolio', {
      error: getErrorMessage(error),
    });
    return {
      title: 'Portfolio Summary',
      items: ['Unable to fetch portfolio'],
      hasData: false,
    };
  }
}

/**
 * Fetch weather data
 */
async function fetchWeatherData(): Promise<BriefingSection> {
  try {
    // Use OpenWeatherMap or similar API
    const apiKey = process.env.OPENWEATHERMAP_API_KEY;
    const city = process.env.WEATHER_CITY || 'New York';

    if (!apiKey) {
      return {
        title: 'Weather',
        items: ['No weather API key configured'],
        hasData: false,
      };
    }

    const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${apiKey}&units=imperial`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Weather API error: ${response.status}`);
    }

    const data = await response.json();
    const temp = Math.round(data.main?.temp || 0);
    const feelsLike = Math.round(data.main?.feels_like || 0);
    const description = data.weather?.[0]?.description || 'Unknown';
    const humidity = data.main?.humidity || 0;

    const items = [
      `${city}: ${temp} F (feels like ${feelsLike} F)`,
      `Conditions: ${description.charAt(0).toUpperCase() + description.slice(1)}`,
      `Humidity: ${humidity}%`,
    ];

    return {
      title: 'Weather',
      items,
      hasData: true,
    };
  } catch (error) {
    logger.warn('Failed to fetch weather', {
      error: getErrorMessage(error),
    });
    return {
      title: 'Weather',
      items: ['Unable to fetch weather'],
      hasData: false,
    };
  }
}

/**
 * Format morning briefing as markdown
 */
export function formatBriefing(briefing: MorningBriefing): string {
  const sections: string[] = [];

  sections.push(
    `## Morning Briefing\n\n*Generated at ${format(parseISO(briefing.generatedAt), 'h:mm a')}*\n`
  );

  // Schedule
  sections.push(`### ${briefing.schedule.title}\n`);
  for (const item of briefing.schedule.items) {
    sections.push(`- ${item}`);
  }
  sections.push('');

  // Weather
  sections.push(`### ${briefing.weather.title}\n`);
  for (const item of briefing.weather.items) {
    sections.push(`- ${item}`);
  }
  sections.push('');

  // Emails
  sections.push(`### ${briefing.emails.title}\n`);
  for (const item of briefing.emails.items) {
    sections.push(`- ${item}`);
  }
  sections.push('');

  // Portfolio
  sections.push(`### ${briefing.portfolio.title}\n`);
  for (const item of briefing.portfolio.items) {
    sections.push(`- ${item}`);
  }
  sections.push('');

  // Reminders
  sections.push(`### ${briefing.reminders.title}\n`);
  for (const item of briefing.reminders.items) {
    sections.push(`- ${item}`);
  }

  return sections.join('\n');
}

/**
 * Add morning briefing to today's journal
 */
export async function addMorningBriefing(): Promise<void> {
  const journalPath = await getTodayJournal();
  const briefing = await generateMorningBriefing();
  const briefingMarkdown = formatBriefing(briefing);

  await updateNote(journalPath, {
    prepend: briefingMarkdown,
    metadata: {
      hasBriefing: true,
      briefingTime: briefing.generatedAt,
    },
  });

  logger.info('Added morning briefing to journal');
}

/**
 * Add a task to today's journal
 */
export async function addTaskToJournal(
  task: string,
  status: 'done' | 'pending' = 'pending'
): Promise<void> {
  const journalPath = await getTodayJournal();
  const checkbox = status === 'done' ? '[x]' : '[ ]';
  const timestamp = format(new Date(), 'HH:mm');

  const taskEntry = `- ${checkbox} ${task} *(${timestamp})*`;

  await updateNote(journalPath, {
    append: `\n${taskEntry}`,
  });

  logger.debug('Added task to journal', { task, status });
}

/**
 * Add a conversation summary to today's journal
 */
export async function addConversationToJournal(summary: string, noteLink?: string): Promise<void> {
  const journalPath = await getTodayJournal();
  const timestamp = format(new Date(), 'HH:mm');

  let entry = `- **${timestamp}**: ${summary}`;
  if (noteLink) {
    entry += ` [[${noteLink}|Full conversation]]`;
  }

  // Find and update the Conversations section
  const note = await readNote(journalPath);
  if (note) {
    const content = note.content;
    const conversationsMarker = '## Conversations';
    const nextSectionMarker = '## Reflections';

    const conversationsStart = content.indexOf(conversationsMarker);
    const nextSection = content.indexOf(nextSectionMarker);

    if (conversationsStart !== -1 && nextSection !== -1) {
      // Insert before the next section
      const beforeConversations = content.slice(0, nextSection);
      const afterConversations = content.slice(nextSection);

      const newContent = `${beforeConversations.trimEnd()}\n\n${entry}\n\n${afterConversations}`;

      await updateNote(journalPath, { content: newContent });
    } else {
      // Fallback: append to end
      await updateNote(journalPath, { append: `\n\n### Conversation at ${timestamp}\n\n${entry}` });
    }
  }

  logger.debug('Added conversation to journal', { summary: summary.slice(0, 50) });
}

/**
 * Add a reflection to today's journal
 */
export async function addReflection(text: string): Promise<void> {
  const journalPath = await getTodayJournal();
  const timestamp = format(new Date(), 'HH:mm');

  const reflection = `\n> *${timestamp}*: ${text}\n`;

  // Find and update the Reflections section
  const note = await readNote(journalPath);
  if (note) {
    const content = note.content;
    const reflectionsMarker = '## Reflections';
    const nextSectionMarker = '## Notes';

    const reflectionsStart = content.indexOf(reflectionsMarker);
    const nextSection = content.indexOf(nextSectionMarker);

    if (reflectionsStart !== -1 && nextSection !== -1) {
      // Insert before the next section
      const beforeSection = content.slice(0, nextSection);
      const afterSection = content.slice(nextSection);

      const newContent = `${beforeSection.trimEnd()}\n${reflection}\n${afterSection}`;

      await updateNote(journalPath, { content: newContent });
    } else {
      // Fallback: append to end
      await updateNote(journalPath, { append: `\n### Reflection\n${reflection}` });
    }
  }

  logger.debug('Added reflection to journal');
}

/**
 * Get journal for a specific date
 */
export async function getJournal(date: Date): Promise<DailyJournal | null> {
  const journalPath = getJournalPath(date);

  if (!(await fse.pathExists(journalPath))) {
    return null;
  }

  const note = await readNote(getJournalRelativePath(date));
  if (!note) return null;

  // Parse journal content
  // This is a simplified parser - a full implementation would parse all sections

  return {
    date: startOfDay(date),
    path: getJournalRelativePath(date),
    tasks: [], // Would parse from content
    conversations: [], // Would parse from content
    reflections: [], // Would parse from content
    briefing: note.metadata.hasBriefing ? undefined : undefined, // Would reconstruct from content
  };
}

/**
 * Check if today's journal exists
 */
export async function todayJournalExists(): Promise<boolean> {
  const journalPath = getJournalPath(new Date());
  return fse.pathExists(journalPath);
}

/**
 * Get recent journals
 */
export async function getRecentJournals(days: number = 7): Promise<string[]> {
  const dailyDir = getDailyPath();
  const journals: string[] = [];

  if (!(await fse.pathExists(dailyDir))) {
    return journals;
  }

  const files = await fse.readdir(dailyDir);

  // Filter and sort by date
  const journalFiles = files
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
    .sort()
    .reverse()
    .slice(0, days);

  for (const file of journalFiles) {
    journals.push(`daily/${file}`);
  }

  return journals;
}

/**
 * Create end-of-day summary
 */
export async function createEndOfDaySummary(): Promise<string> {
  const journalPath = await getTodayJournal();
  const note = await readNote(journalPath);

  if (!note) {
    return 'No journal found for today.';
  }

  // This would analyze the day's activities and generate a summary
  // For now, return a placeholder

  const summary = `
## End of Day Summary

*Generated at ${format(new Date(), 'h:mm a')}*

Today's journal has been updated with all conversations and tasks.

Review the full journal: [[${journalPath}|Today's Journal]]
  `.trim();

  // Add to reflections
  await addReflection('End of day summary generated.');

  return summary;
}
