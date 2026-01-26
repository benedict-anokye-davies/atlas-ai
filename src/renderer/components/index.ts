/**
 * Atlas Desktop - Component Exports
 * Centralized export for all UI components
 */

// Core Components
export { AtlasUI } from './AtlasUI';
export { ErrorBoundary } from './ErrorBoundary';
export { ErrorToastContainer as ErrorToast } from './ErrorToast';
export { StatusBar } from './StatusBar';

// Command & Navigation
export { CommandPalette } from './CommandPalette';
export { EnhancedCommandPalette } from './CommandPaletteEnhanced';

// Dashboard & Widgets
export { DashboardWidgets } from './DashboardWidgets';
export { SpotifyWidget } from './SpotifyWidget';
export { ProactiveSuggestions } from './ProactiveSuggestions';

// Settings & Configuration
export { Settings } from './Settings';
export { RoutinesSettings } from './RoutinesSettings';
export { ThemeCustomization } from './ThemeCustomization';
export { PrivacyDashboard } from './PrivacyDashboard';
export { ShortcutSettings } from './ShortcutSettings';
export { MobileCompanion } from './MobileCompanion';

// Notification & Tasks
export { NotificationCenter } from './NotificationCenter';
export { TaskIndicator } from './TaskIndicator';

// Git & Development Tools
export { GitHistory } from './GitHistory';
export { RepoStats } from './RepoStats';
export { DiffViewer } from './DiffViewer';
export { ConflictResolver } from './ConflictResolver';

// Memory & Debug
export { MemoryStats } from './MemoryStats';
export { MemoryGraph } from './MemoryGraph';
export { DebugPanel } from './DebugPanel';
export { DebugOverlay } from './DebugOverlay';
export { PerformancePanel } from './PerformancePanel';

// Voice & Transcript
export { TranscriptView } from './TranscriptView';
export { VoiceStudio } from './VoiceStudio';
export { WakeWordSetup } from './WakeWordSetup';

// Utility Components
export { ClipboardHistory } from './ClipboardHistory';

// Onboarding
export { Onboarding } from './Onboarding';

// Re-export common components
export * from './common';
