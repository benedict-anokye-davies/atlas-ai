/**
 * Atlas Desktop - Store Exports
 * Central export for all Zustand stores
 */

export {
  useAtlasStore,
  useAtlasStore as useNovaStore, // Alias for backward compatibility
  selectState,
  selectIsReady,
  selectAudioLevel,
  selectMessages,
  selectSettings,
  selectError,
  selectBudgetUsage,
  QUALITY_PRESETS,
  type Message,
  type AtlasSettings,
  type AtlasSettings as NovaSettings, // Alias for backward compatibility
  type QualityPreset,
  type QualityPresetConfig,
  type PersonalityPreset,
  type PersonalityTraits,
  // Orb visualization types (040-A)
  type AttractorType,
  type OrbColorTheme,
} from './atlasStore';

export {
  useCommandStore,
  selectIsOpen,
  selectSearchQuery,
  selectSelectedIndex,
  selectCommands,
  selectRecentCommands,
  type Command,
  type CommandCategory,
} from './commandStore';

// Transcript store exports
export {
  useTranscriptStore,
  formatTimestamp,
  formatSessionDate,
  selectMessages as selectTranscriptMessages,
  selectSearchQuery as selectTranscriptSearchQuery,
  selectSelectedMessageId,
  selectIsVisible as selectTranscriptVisible,
  selectIsExpanded as selectTranscriptExpanded,
  selectAutoScroll,
  selectCurrentSession,
  selectArchivedSessions,
  type TranscriptMessage,
  type TranscriptSession,
  type ExportFormat,
} from './transcriptStore';

// Dashboard store exports
export {
  useDashboardStore,
  selectMetrics,
  selectGoals,
  selectAgents,
  selectWorkflows,
  selectIntegrations,
  selectRunStats,
  selectView,
  selectActiveAgents,
  selectActiveWorkflows,
  selectHealthyIntegrations,
  selectGoalsByCategory,
  type DashboardMetrics,
  type Goal,
  type Agent,
  type Workflow,
  type Integration,
  type RunStats,
  type DashboardView,
} from './dashboardStore';
