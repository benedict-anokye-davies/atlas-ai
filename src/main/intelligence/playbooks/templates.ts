/**
 * Playbook Templates
 * Pre-built playbook templates for common workflows
 */

import { PlaybookTemplate, PlaybookCategory } from './types';

// ============================================================================
// PRODUCTIVITY TEMPLATES
// ============================================================================

export const MORNING_BRIEFING_TEMPLATE: PlaybookTemplate = {
  id: 'tpl-morning-briefing',
  name: 'Morning Briefing',
  description: 'Get a daily summary of your tasks, calendar, and important updates each morning',
  category: 'productivity',
  playbook: {
    name: 'Morning Briefing',
    description: 'Automated morning briefing with tasks, calendar, and alerts',
    category: 'productivity',
    status: 'active',
    triggers: [
      {
        id: 'trig-morning-time',
        type: 'time',
        enabled: true,
        schedule: {
          type: 'daily',
          value: '07:00',
        },
        description: 'Every morning at 7 AM',
      },
      {
        id: 'trig-morning-voice',
        type: 'voice',
        enabled: true,
        phrases: ['good morning', 'morning briefing', "what's on today"],
        description: 'Voice command trigger',
      },
    ],
    actions: [
      {
        id: 'act-greet',
        type: 'voice',
        name: 'Morning Greeting',
        config: {
          text: 'Good morning! Here\'s your briefing for today.',
        },
      },
      {
        id: 'act-calendar',
        type: 'run_query',
        name: 'Get Calendar',
        config: {
          query: "What's on my calendar today?",
          agentId: 'project',
          storeResultAs: 'calendar',
        },
      },
      {
        id: 'act-tasks',
        type: 'run_query',
        name: 'Get Priority Tasks',
        config: {
          query: 'What are my priority tasks for today?',
          agentId: 'project',
          storeResultAs: 'tasks',
        },
      },
      {
        id: 'act-speak-summary',
        type: 'voice',
        name: 'Speak Summary',
        config: {
          text: 'You have ${calendar.eventCount} events and ${tasks.count} priority tasks today.',
        },
      },
    ],
    actionOrder: ['act-greet', 'act-calendar', 'act-tasks', 'act-speak-summary'],
  },
  prompts: [
    {
      name: 'briefingTime',
      description: 'What time would you like your morning briefing?',
      type: 'string',
      default: '07:00',
      required: true,
      variablePath: 'triggers[0].schedule.value',
    },
  ],
};

export const FOCUS_MODE_TEMPLATE: PlaybookTemplate = {
  id: 'tpl-focus-mode',
  name: 'Focus Mode',
  description: 'Activate focus mode with notifications muted and context set',
  category: 'productivity',
  playbook: {
    name: 'Focus Mode',
    description: 'Enter deep focus mode',
    category: 'productivity',
    status: 'active',
    triggers: [
      {
        id: 'trig-voice-focus',
        type: 'voice',
        enabled: true,
        phrases: ['focus mode', 'need to focus', 'deep work'],
      },
      {
        id: 'trig-manual-focus',
        type: 'manual',
        enabled: true,
        buttonLabel: 'Enter Focus Mode',
      },
    ],
    actions: [
      {
        id: 'act-set-context',
        type: 'set_context',
        name: 'Set Focus Context',
        config: {
          contextType: 'focus',
          contextName: 'Deep Work',
          duration: 7200000, // 2 hours
        },
      },
      {
        id: 'act-notify',
        type: 'notify',
        name: 'Confirm Focus Mode',
        config: {
          title: 'Focus Mode Active',
          body: 'Notifications muted. Focus for the next 2 hours.',
          priority: 'low',
        },
      },
      {
        id: 'act-voice',
        type: 'voice',
        name: 'Confirm Voice',
        config: {
          text: 'Focus mode activated. I\'ll keep things quiet for the next 2 hours.',
        },
      },
    ],
    actionOrder: ['act-set-context', 'act-notify', 'act-voice'],
    cooldownMs: 300000, // 5 minute cooldown
  },
};

// ============================================================================
// TRADING TEMPLATES
// ============================================================================

export const MARKET_OPEN_TEMPLATE: PlaybookTemplate = {
  id: 'tpl-market-open',
  name: 'Market Open Routine',
  description: 'Get market overview and position status when markets open',
  category: 'trading',
  playbook: {
    name: 'Market Open',
    description: 'Daily market open briefing',
    category: 'trading',
    status: 'active',
    triggers: [
      {
        id: 'trig-market-time',
        type: 'time',
        enabled: true,
        schedule: {
          type: 'daily',
          value: '09:00', // Adjust for market timezone
        },
      },
    ],
    actions: [
      {
        id: 'act-positions',
        type: 'run_query',
        name: 'Get Positions',
        config: {
          query: 'Show my current positions and overnight changes',
          agentId: 'trading',
          storeResultAs: 'positions',
        },
      },
      {
        id: 'act-signals',
        type: 'run_query',
        name: 'Get Signals',
        config: {
          query: 'What signals triggered overnight?',
          agentId: 'trading',
          storeResultAs: 'signals',
        },
      },
      {
        id: 'act-brief',
        type: 'voice',
        name: 'Market Brief',
        config: {
          text: 'Markets are open. You have ${positions.count} positions. ${signals.count} new signals.',
        },
      },
    ],
    actionOrder: ['act-positions', 'act-signals', 'act-brief'],
  },
};

export const TRADE_ALERT_TEMPLATE: PlaybookTemplate = {
  id: 'tpl-trade-alert',
  name: 'Trade Execution Alert',
  description: 'Notify when a trade is executed',
  category: 'trading',
  playbook: {
    name: 'Trade Alert',
    description: 'Alert on trade execution',
    category: 'trading',
    status: 'active',
    triggers: [
      {
        id: 'trig-trade-event',
        type: 'event',
        enabled: true,
        eventName: 'trade:executed',
      },
    ],
    actions: [
      {
        id: 'act-notify-trade',
        type: 'notify',
        name: 'Trade Notification',
        config: {
          title: 'Trade Executed',
          body: '${_trigger.side} ${_trigger.amount} ${_trigger.symbol} at ${_trigger.price}',
          priority: 'high',
        },
      },
      {
        id: 'act-speak-trade',
        type: 'voice',
        name: 'Announce Trade',
        config: {
          text: 'Trade executed. ${_trigger.side} ${_trigger.symbol}.',
          interruptible: true,
        },
      },
    ],
    actionOrder: ['act-notify-trade', 'act-speak-trade'],
  },
};

// ============================================================================
// FINANCIAL TEMPLATES
// ============================================================================

export const WEEKLY_FINANCE_REVIEW_TEMPLATE: PlaybookTemplate = {
  id: 'tpl-weekly-finance',
  name: 'Weekly Finance Review',
  description: 'Weekly summary of spending, budget status, and savings',
  category: 'financial',
  playbook: {
    name: 'Weekly Finance Review',
    description: 'Review finances every Sunday',
    category: 'financial',
    status: 'active',
    triggers: [
      {
        id: 'trig-sunday',
        type: 'time',
        enabled: true,
        schedule: {
          type: 'weekly',
          value: 'sunday:10:00',
        },
      },
      {
        id: 'trig-voice-finance',
        type: 'voice',
        enabled: true,
        phrases: ['finance review', 'how did I spend this week', 'weekly spending'],
      },
    ],
    actions: [
      {
        id: 'act-spending',
        type: 'run_query',
        name: 'Get Spending Summary',
        config: {
          query: 'How much did I spend this week by category?',
          agentId: 'financial',
          storeResultAs: 'spending',
        },
      },
      {
        id: 'act-budget',
        type: 'run_query',
        name: 'Check Budgets',
        config: {
          query: 'Which budgets am I over or close to exceeding?',
          agentId: 'financial',
          storeResultAs: 'budgets',
        },
      },
      {
        id: 'act-summary',
        type: 'voice',
        name: 'Speak Summary',
        config: {
          text: 'This week you spent ${spending.total}. ${budgets.warning || "All budgets on track."}',
        },
      },
    ],
    actionOrder: ['act-spending', 'act-budget', 'act-summary'],
  },
};

export const BILL_REMINDER_TEMPLATE: PlaybookTemplate = {
  id: 'tpl-bill-reminder',
  name: 'Bill Payment Reminder',
  description: 'Remind about upcoming bill payments',
  category: 'financial',
  playbook: {
    name: 'Bill Reminder',
    description: 'Daily check for upcoming bills',
    category: 'financial',
    status: 'active',
    triggers: [
      {
        id: 'trig-daily-bills',
        type: 'time',
        enabled: true,
        schedule: {
          type: 'daily',
          value: '09:00',
        },
      },
    ],
    actions: [
      {
        id: 'act-check-bills',
        type: 'run_query',
        name: 'Check Upcoming Bills',
        config: {
          query: 'What bills are due in the next 3 days?',
          agentId: 'financial',
          storeResultAs: 'bills',
        },
      },
      {
        id: 'act-branch-bills',
        type: 'branch',
        name: 'Check If Bills Due',
        config: {
          condition: 'bills.count > 0',
          thenActions: ['act-notify-bills'],
          elseActions: [],
        },
      },
      {
        id: 'act-notify-bills',
        type: 'notify',
        name: 'Notify Bills',
        config: {
          title: 'Bills Due Soon',
          body: 'You have ${bills.count} bills due in the next 3 days totaling ${bills.total}',
          priority: 'high',
        },
      },
    ],
    actionOrder: ['act-check-bills', 'act-branch-bills'],
  },
};

// ============================================================================
// RELATIONSHIP TEMPLATES
// ============================================================================

export const BIRTHDAY_REMINDER_TEMPLATE: PlaybookTemplate = {
  id: 'tpl-birthday-reminder',
  name: 'Birthday Reminder',
  description: 'Get notified about upcoming birthdays',
  category: 'relationship',
  playbook: {
    name: 'Birthday Reminder',
    description: 'Check for birthdays daily',
    category: 'relationship',
    status: 'active',
    triggers: [
      {
        id: 'trig-morning-birthdays',
        type: 'time',
        enabled: true,
        schedule: {
          type: 'daily',
          value: '08:00',
        },
      },
    ],
    actions: [
      {
        id: 'act-check-birthdays',
        type: 'run_query',
        name: 'Check Birthdays',
        config: {
          query: 'Are there any birthdays today or this week?',
          agentId: 'relationship',
          storeResultAs: 'birthdays',
        },
      },
      {
        id: 'act-branch-birthday',
        type: 'branch',
        name: 'Has Birthdays',
        config: {
          condition: 'birthdays.today.length > 0',
          thenActions: ['act-notify-today'],
          elseActions: [],
        },
      },
      {
        id: 'act-notify-today',
        type: 'voice',
        name: 'Birthday Today',
        config: {
          text: "Don't forget - it's ${birthdays.today[0].name}'s birthday today!",
        },
      },
    ],
    actionOrder: ['act-check-birthdays', 'act-branch-birthday'],
  },
};

export const RECONNECT_REMINDER_TEMPLATE: PlaybookTemplate = {
  id: 'tpl-reconnect-reminder',
  name: 'Reconnect Reminder',
  description: 'Remind to reconnect with contacts you haven\'t talked to in a while',
  category: 'relationship',
  playbook: {
    name: 'Reconnect Reminder',
    description: 'Weekly check for dormant relationships',
    category: 'relationship',
    status: 'active',
    triggers: [
      {
        id: 'trig-weekly-reconnect',
        type: 'time',
        enabled: true,
        schedule: {
          type: 'weekly',
          value: 'monday:10:00',
        },
      },
    ],
    actions: [
      {
        id: 'act-check-dormant',
        type: 'run_query',
        name: 'Find Dormant Contacts',
        config: {
          query: 'Who should I reconnect with? People I haven\'t talked to in over a month',
          agentId: 'relationship',
          storeResultAs: 'dormant',
        },
      },
      {
        id: 'act-suggest',
        type: 'voice',
        name: 'Suggest Reconnection',
        config: {
          text: 'You might want to reach out to ${dormant[0].name}. It\'s been ${dormant[0].daysSince} days.',
        },
      },
    ],
    actionOrder: ['act-check-dormant', 'act-suggest'],
  },
};

// ============================================================================
// HEALTH TEMPLATES
// ============================================================================

export const BREAK_REMINDER_TEMPLATE: PlaybookTemplate = {
  id: 'tpl-break-reminder',
  name: 'Break Reminder',
  description: 'Remind to take regular breaks during work',
  category: 'health',
  playbook: {
    name: 'Break Reminder',
    description: 'Regular break reminders using Pomodoro technique',
    category: 'health',
    status: 'active',
    triggers: [
      {
        id: 'trig-pomodoro',
        type: 'time',
        enabled: true,
        schedule: {
          type: 'interval',
          value: 1500000, // 25 minutes
        },
      },
    ],
    actions: [
      {
        id: 'act-check-context',
        type: 'branch',
        name: 'Check If Working',
        config: {
          condition: 'context.type === "work"',
          thenActions: ['act-remind-break'],
          elseActions: [],
        },
      },
      {
        id: 'act-remind-break',
        type: 'voice',
        name: 'Break Reminder',
        config: {
          text: 'Time for a quick break. Stand up, stretch, rest your eyes for 5 minutes.',
          interruptible: true,
        },
      },
    ],
    actionOrder: ['act-check-context'],
    blockedContexts: ['meeting', 'focus'],
  },
};

export const HYDRATION_REMINDER_TEMPLATE: PlaybookTemplate = {
  id: 'tpl-hydration',
  name: 'Hydration Reminder',
  description: 'Remind to drink water throughout the day',
  category: 'health',
  playbook: {
    name: 'Hydration Reminder',
    description: 'Hourly water reminders',
    category: 'health',
    status: 'active',
    triggers: [
      {
        id: 'trig-hourly',
        type: 'time',
        enabled: true,
        schedule: {
          type: 'interval',
          value: 3600000, // 1 hour
        },
      },
    ],
    actions: [
      {
        id: 'act-remind',
        type: 'notify',
        name: 'Water Reminder',
        config: {
          title: '💧 Hydration',
          body: 'Remember to drink some water!',
          priority: 'low',
        },
      },
    ],
    actionOrder: ['act-remind'],
    allowedContexts: ['work', 'focus', 'general'],
  },
};

// ============================================================================
// RESEARCH TEMPLATES
// ============================================================================

export const RESEARCH_DIGEST_TEMPLATE: PlaybookTemplate = {
  id: 'tpl-research-digest',
  name: 'Research Digest',
  description: 'Daily summary of research topics and new information',
  category: 'research',
  playbook: {
    name: 'Research Digest',
    description: 'Daily research summary',
    category: 'research',
    status: 'active',
    triggers: [
      {
        id: 'trig-evening',
        type: 'time',
        enabled: true,
        schedule: {
          type: 'daily',
          value: '18:00',
        },
      },
    ],
    actions: [
      {
        id: 'act-get-topics',
        type: 'run_query',
        name: 'Get Active Topics',
        config: {
          query: 'What research topics have updates today?',
          agentId: 'research',
          storeResultAs: 'topics',
        },
      },
      {
        id: 'act-summarize',
        type: 'voice',
        name: 'Summarize',
        config: {
          text: '${topics.count} research topics have updates. ${topics.summary}',
        },
      },
    ],
    actionOrder: ['act-get-topics', 'act-summarize'],
  },
};

// ============================================================================
// SYSTEM TEMPLATES
// ============================================================================

export const DAILY_BACKUP_TEMPLATE: PlaybookTemplate = {
  id: 'tpl-daily-backup',
  name: 'Daily Backup',
  description: 'Automated daily backup of important data',
  category: 'system',
  playbook: {
    name: 'Daily Backup',
    description: 'Backup data daily',
    category: 'system',
    status: 'active',
    triggers: [
      {
        id: 'trig-backup-time',
        type: 'time',
        enabled: true,
        schedule: {
          type: 'daily',
          value: '02:00', // 2 AM
        },
      },
    ],
    actions: [
      {
        id: 'act-backup',
        type: 'run_tool',
        name: 'Run Backup',
        config: {
          toolName: 'system_backup',
          params: { type: 'incremental' },
          storeResultAs: 'backup',
        },
      },
      {
        id: 'act-log',
        type: 'notify',
        name: 'Log Result',
        config: {
          title: 'Backup Complete',
          body: 'Daily backup completed successfully',
          priority: 'low',
        },
        continueOnError: true,
      },
    ],
    actionOrder: ['act-backup', 'act-log'],
  },
};

// ============================================================================
// TEMPLATE REGISTRY
// ============================================================================

export const ALL_TEMPLATES: PlaybookTemplate[] = [
  // Productivity
  MORNING_BRIEFING_TEMPLATE,
  FOCUS_MODE_TEMPLATE,
  
  // Trading
  MARKET_OPEN_TEMPLATE,
  TRADE_ALERT_TEMPLATE,
  
  // Financial
  WEEKLY_FINANCE_REVIEW_TEMPLATE,
  BILL_REMINDER_TEMPLATE,
  
  // Relationship
  BIRTHDAY_REMINDER_TEMPLATE,
  RECONNECT_REMINDER_TEMPLATE,
  
  // Health
  BREAK_REMINDER_TEMPLATE,
  HYDRATION_REMINDER_TEMPLATE,
  
  // Research
  RESEARCH_DIGEST_TEMPLATE,
  
  // System
  DAILY_BACKUP_TEMPLATE,
];

export function getTemplatesByCategory(category: PlaybookCategory): PlaybookTemplate[] {
  return ALL_TEMPLATES.filter(t => t.category === category);
}

export function getTemplate(id: string): PlaybookTemplate | undefined {
  return ALL_TEMPLATES.find(t => t.id === id);
}
