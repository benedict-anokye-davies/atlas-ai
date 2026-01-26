/**
 * Atlas Desktop - Intelligence Module
 * Proactive intelligence features
 */

export {
  BackgroundResearchManager,
  getBackgroundResearchManager,
  shutdownBackgroundResearchManager,
  ResearchTopic,
  ResearchResult,
  ResearchState,
  ResearchConfig,
} from './background-research';

export {
  SmartNotificationsManager,
  getSmartNotificationsManager,
  shutdownSmartNotificationsManager,
  SmartNotification,
  NotificationPriority,
  NotificationType,
  NotificationAction,
  NotificationConfig,
  Suggestion,
} from './smart-notifications';

export {
  TaskScheduler,
  getTaskScheduler,
  shutdownTaskScheduler,
  ScheduledTask,
  TaskPriority,
  TaskRecurrence,
  RecurrenceType,
  ReminderConfig,
  TaskStatus,
  SchedulerConfig,
} from './task-scheduler';

export {
  DailyBriefingManager,
  getDailyBriefingManager,
  initializeDailyBriefingManager,
  shutdownDailyBriefingManager,
  DailyBriefing,
  CalendarSummary,
  MeetingInfo,
  TaskSummary,
  UnfinishedWork,
  SystemStatus,
  WeatherInfo,
  BriefingManager,
  BriefingConfig,
} from './daily-briefing';

export {
  ReminderManager,
  getReminderManager,
  shutdownReminderManager,
  Reminder,
  ReminderType,
  ReminderPriority,
  RecurrencePattern,
  CalendarEvent,
  WellnessConfig,
  ReminderManagerConfig,
} from './reminder-manager';

export {
  WrapupManager,
  getWrapupManager,
  shutdownWrapupManager,
  resetWrapupManager,
  DayWrapup,
  Accomplishment,
  AccomplishmentCategory,
  InProgressWork,
  DailyStats,
  ImpactLevel,
  WrapupConfig,
} from './day-wrapup';

export {
  PatternDetector,
  getPatternDetector,
  initializePatternDetector,
  shutdownPatternDetector,
  resetPatternDetector,
  UserAction,
  ActionType,
  DetectedPattern,
  PatternType,
  Automation,
  AutomationTrigger,
  AutomationAction,
  PatternDetectorConfig,
  IPatternDetector,
} from './pattern-detector';

export {
  LearningSuggester,
  getLearningSuggester,
  initializeLearningSuggester,
  shutdownLearningSuggester,
  resetLearningSuggester,
  LearningContext,
  Resource,
  LearningSuggestion,
  LearningProgress,
  Interest,
  LearningSuggesterConfig,
  ReadingListItem,
  ILearningSuggester,
} from './learning-suggester';

// ============================================================================
// ATLAS INTELLIGENCE PLATFORM
// Palantir-style personal intelligence system
// ============================================================================

// Platform manager & initialization
export {
  getIntelligencePlatformManager,
  initializeIntelligencePlatform,
  shutdownIntelligencePlatform,
  getIntelligencePlatformStatus,
  isIntelligencePlatformReady,
  type IntelligencePlatformStatus,
} from './platform-manager';

// Core types
export * from './types';

// Ontology layer (entity/relationship storage)
export {
  getOntologyStore,
  getEntityManager,
  getRelationshipManager,
} from './ontology';

// Semantic layer (data parsers)
export { getSemanticLayerManager } from './semantic';

// Entity resolution (deduplication)
export { getEntityResolutionEngine } from './entity-resolution';

// Knowledge graph (graph algorithms)
export { getKnowledgeGraphEngine } from './knowledge-graph';

// Temporal engine (time-based queries)
export { getTemporalEngine } from './temporal';

// Intelligence agents
export { getAgentRegistry, routeQuery } from './agents';

// Dynamic learning layer
export { getDynamicLayerManager } from './dynamic';

// Common Operating Picture
export { getCOPManager } from './cop';

// Playbook automation
export { getPlaybookManager } from './playbooks';

// Security layer
export { getSecurityManager } from './security';

// IPC handlers
export { registerIntelligenceIPC } from './ipc';
