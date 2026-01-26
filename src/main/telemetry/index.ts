/**
 * Atlas Desktop - Telemetry Module
 * Crash reporting, error tracking, usage analytics, and session recovery
 *
 * This module provides:
 * - Crash reporting and error tracking
 * - Opt-in usage analytics (privacy-first)
 * - Session state management and recovery
 * - Performance metrics collection
 */

// Crash Reporter exports
export {
  // Classes
  CrashReporter,
  // Types
  CrashSeverity,
  CrashType,
  // Interfaces
  type CrashReport,
  type CrashReporterConfig,
  type SessionState,
  type SystemInfo,
  type AppState,
  type WindowState,
  // Functions
  getCrashReporter,
  initializeCrashReporter,
  shutdownCrashReporter,
  reportError,
  recordAction,
} from './crash-reporter';

// Analytics exports
export {
  // Classes
  AnalyticsManager,
  // Enums
  ConsentStatus,
  // Interfaces
  type AnalyticsConfig,
  // Functions
  getAnalytics,
  initializeAnalytics,
  shutdownAnalytics,
  trackEvent,
  trackFeature,
  isAnalyticsEnabled,
  setAnalyticsConsent,
} from './analytics';

// Event definitions exports
export {
  // Event Categories
  TelemetryCategory,
  // Event Types
  AppEvent,
  VoiceEvent,
  LLMEvent,
  TTSEvent,
  STTEvent,
  UIEvent,
  AgentEvent,
  MemoryEvent,
  ErrorEvent,
  PerformanceEvent,
  FeatureEvent,
  // Interfaces
  type TelemetryEvent,
  type TelemetryValue,
  type SessionAnalytics,
  type AppEventData,
  type VoiceEventData,
  type LLMEventData,
  type TTSEventData,
  type STTEventData,
  type AgentEventData,
  type ErrorEventData,
  type PerformanceEventData,
  type FeatureEventData,
  // Data Disclosure
  DATA_COLLECTION_DISCLOSURE,
  // Utilities
  validateEventData,
  sanitizeEventData,
} from './events';
