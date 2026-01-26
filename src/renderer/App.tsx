/**
 * Atlas Desktop - Main App Component
 * Voice-first AI assistant with AGNT-style dashboard and strange attractor visualization
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { DashboardLayout } from './components/dashboard';
import { AtlasUI } from './components/AtlasUI';
import { Settings } from './components/Settings';
import { DebugOverlay } from './components/DebugOverlay';
import { DebugPanel } from './components/DebugPanel';
import { ErrorToastContainer } from './components/ErrorToast';
import { EnhancedCommandPalette } from './components/CommandPaletteEnhanced';
import { SpotifyWidget } from './components/SpotifyWidget';
import { ThemeCustomization } from './components/ThemeCustomization';
import { MobileCompanion } from './components/MobileCompanion';
import { RealTimeTranscript } from './components/RealTimeTranscript';
// ProactiveSuggestions - temporarily disabled, enable when feature is ready
// import { ProactiveSuggestions } from './components/ProactiveSuggestions';
import { FocusMode } from './components/FocusMode';
import { VoiceHistory } from './components/VoiceHistory';
import { QuickNotes } from './components/QuickNotes';
import { SystemStats } from './components/SystemStats';
import { ActivityTimeline } from './components/ActivityTimeline';
import { APIKeyManager } from './components/APIKeyManager';
import { DeveloperConsole } from './components/DeveloperConsole';
import { IntegrationsHub } from './components/IntegrationsHub';
import { ScreenContextPanel } from './components/ScreenContextPanel';
import { VoiceFeedbackSettings } from './components/VoiceFeedbackSettings';
import { ConversationExport } from './components/ConversationExport';
import { BackupRestore } from './components/BackupRestore';
import { LearningDashboard } from './components/LearningDashboard';
import { GestureControls } from './components/GestureControls';
import { AmbientMode } from './components/AmbientMode';
import { PluginSystem } from './components/PluginSystem';
import { MultiMonitorSupport } from './components/MultiMonitorSupport';
import { CustomWakeWords } from './components/CustomWakeWords';
import { PerformanceMonitor } from './components/PerformanceMonitor';
import NaturalLanguageAutomation from './components/NaturalLanguageAutomation';
import OfflineMode from './components/OfflineMode';
import ContextWindowDisplay from './components/ContextWindowDisplay';
import { KeyboardShortcuts, useKeyboardShortcuts, SkipLinks } from './components/common';
import {
  AccessibilityProvider,
  ScreenReaderAnnouncer,
  useAnnounce,
} from './components/accessibility';
import { useAtlasState, useCommands } from './hooks';
import { useAtlasStore } from './stores';
import { useDashboardStore } from './stores/dashboardStore';
import { ATLAS_STATE_DESCRIPTIONS } from '../shared/types/accessibility';
import './styles/App.css';

/**
 * Inner app content that uses accessibility hooks
 * Must be wrapped by AccessibilityProvider
 */
function AppContent() {
  const { state, isReady, start, stop, triggerWake, audioLevel: _audioLevel } = useAtlasState();
  const { settings, toggleSettings, updateSettings } = useAtlasStore();
  const { view, toggleOrbOnly, setView } = useDashboardStore();

  // Screen reader announcements
  const { announce } = useAnnounce();
  const previousStateRef = useRef(state);

  // Keyboard shortcuts modal
  const { isOpen: showShortcuts, close: closeShortcuts } = useKeyboardShortcuts();

  // Initialize command palette with default commands
  useCommands();

  // Local UI state
  const [autoStarted, setAutoStarted] = useState(false);
  const [navigationMode, setNavigationMode] = useState<'mouse' | 'keyboard'>('mouse');
  const [showDebugPanel, setShowDebugPanel] = useState(false);
  const [showThemeCustomization, setShowThemeCustomization] = useState(false);
  const [showMobileCompanion, setShowMobileCompanion] = useState(false);
  const [showSpotifyWidget, setShowSpotifyWidget] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showFocusMode, setShowFocusMode] = useState(false);
  const [showVoiceHistory, setShowVoiceHistory] = useState(false);
  const [showQuickNotes, setShowQuickNotes] = useState(false);
  const [showSystemStats, setShowSystemStats] = useState(false);
  const [showActivityTimeline, setShowActivityTimeline] = useState(false);
  const [showAPIKeyManager, setShowAPIKeyManager] = useState(false);
  const [showDeveloperConsole, setShowDeveloperConsole] = useState(false);
  const [showIntegrationsHub, setShowIntegrationsHub] = useState(false);
  const [showScreenContext, setShowScreenContext] = useState(false);
  const [showVoiceFeedback, setShowVoiceFeedback] = useState(false);
  const [showConversationExport, setShowConversationExport] = useState(false);
  const [showBackupRestore, setShowBackupRestore] = useState(false);
  const [showLearningDashboard, setShowLearningDashboard] = useState(false);
  const [showGestureControls, setShowGestureControls] = useState(false);
  const [showAmbientMode, setShowAmbientMode] = useState(false);
  const [showPluginSystem, setShowPluginSystem] = useState(false);
  const [showMultiMonitor, setShowMultiMonitor] = useState(false);
  const [showCustomWakeWords, setShowCustomWakeWords] = useState(false);
  const [showPerformanceMonitor, setShowPerformanceMonitor] = useState(false);
  const [showAutomation, setShowAutomation] = useState(false);
  const [showOfflineMode, setShowOfflineMode] = useState(false);
  const [showContextWindow, setShowContextWindow] = useState(false);

  // Toggle handlers
  const toggleThemeCustomization = useCallback(() => setShowThemeCustomization(prev => !prev), []);
  const toggleMobileCompanion = useCallback(() => setShowMobileCompanion(prev => !prev), []);
  const toggleSpotifyWidget = useCallback(() => setShowSpotifyWidget(prev => !prev), []);
  const toggleCommandPalette = useCallback(() => setShowCommandPalette(prev => !prev), []);
  const toggleFocusMode = useCallback(() => setShowFocusMode(prev => !prev), []);
  const toggleVoiceHistory = useCallback(() => setShowVoiceHistory(prev => !prev), []);
  const toggleQuickNotes = useCallback(() => setShowQuickNotes(prev => !prev), []);
  const toggleSystemStats = useCallback(() => setShowSystemStats(prev => !prev), []);
  const toggleActivityTimeline = useCallback(() => setShowActivityTimeline(prev => !prev), []);
  const toggleAPIKeyManager = useCallback(() => setShowAPIKeyManager(prev => !prev), []);
  const toggleDeveloperConsole = useCallback(() => setShowDeveloperConsole(prev => !prev), []);
  const toggleIntegrationsHub = useCallback(() => setShowIntegrationsHub(prev => !prev), []);
  const toggleScreenContext = useCallback(() => setShowScreenContext(prev => !prev), []);
  const toggleVoiceFeedback = useCallback(() => setShowVoiceFeedback(prev => !prev), []);
  const toggleConversationExport = useCallback(() => setShowConversationExport(prev => !prev), []);
  const toggleBackupRestore = useCallback(() => setShowBackupRestore(prev => !prev), []);
  const toggleLearningDashboard = useCallback(() => setShowLearningDashboard(prev => !prev), []);
  const toggleGestureControls = useCallback(() => setShowGestureControls(prev => !prev), []);
  const toggleAmbientMode = useCallback(() => setShowAmbientMode(prev => !prev), []);
  const togglePluginSystem = useCallback(() => setShowPluginSystem(prev => !prev), []);
  const toggleMultiMonitor = useCallback(() => setShowMultiMonitor(prev => !prev), []);
  const toggleCustomWakeWords = useCallback(() => setShowCustomWakeWords(prev => !prev), []);
  const togglePerformanceMonitor = useCallback(() => setShowPerformanceMonitor(prev => !prev), []);
  const toggleAutomation = useCallback(() => setShowAutomation(prev => !prev), []);
  const toggleOfflineMode = useCallback(() => setShowOfflineMode(prev => !prev), []);
  const toggleContextWindow = useCallback(() => setShowContextWindow(prev => !prev), []);

  // Track keyboard vs mouse navigation mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Tab' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        setNavigationMode('keyboard');
        document.body.setAttribute('data-navigation-mode', 'keyboard');
      }
    };

    const handleMouseDown = () => {
      setNavigationMode('mouse');
      document.body.setAttribute('data-navigation-mode', 'mouse');
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleMouseDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleMouseDown);
    };
  }, []);

  // Announce state changes for screen readers
  useEffect(() => {
    if (state !== previousStateRef.current) {
      const stateDesc = ATLAS_STATE_DESCRIPTIONS[state];
      if (stateDesc) {
        const priority = state === 'error' ? 'assertive' : 'polite';
        const message = stateDesc.instructions
          ? `${stateDesc.description} ${stateDesc.instructions}`
          : stateDesc.description;
        announce(message, priority, 'state-change');
      }
      previousStateRef.current = state;
    }
  }, [state, announce]);

  // Auto-start the voice pipeline on mount (if enabled)
  useEffect(() => {
    if (!autoStarted && !isReady && settings.autoStart) {
      setAutoStarted(true);
      start().catch((err) => {
        console.error('[Atlas] Failed to auto-start:', err);
      });
    }
  }, [autoStarted, isReady, start, settings.autoStart]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in an input field
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }

      switch (e.key) {
        case ' ': // Space - trigger wake / start listening
          e.preventDefault();
          if (state === 'idle' && isReady) {
            triggerWake();
          }
          break;

        case 'Escape': // Escape - stop / cancel
          e.preventDefault();
          if (state === 'listening' || state === 'thinking') {
            stop();
          }
          break;

        case ',': // Ctrl+, - open settings
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            toggleSettings();
          }
          break;

        case 'd': // Ctrl+D - toggle debug overlay, Ctrl+Shift+D - toggle debug panel
        case 'D':
          if ((e.metaKey || e.ctrlKey) && e.shiftKey) {
            e.preventDefault();
            setShowDebugPanel((prev) => !prev);
          } else if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            updateSettings({ showDebug: !settings.showDebug });
          }
          break;

        case 'F11': // F11 - toggle orb-only mode
          e.preventDefault();
          toggleOrbOnly();
          break;

        case 'F9': // F9 - toggle command center view
          e.preventDefault();
          setView(view === 'command-center' ? 'dashboard' : 'command-center');
          break;

        case 'p': // Ctrl+Shift+P - command palette
        case 'P':
          if ((e.metaKey || e.ctrlKey) && e.shiftKey) {
            e.preventDefault();
            toggleCommandPalette();
          }
          break;

        case 't': // Ctrl+Shift+T - theme customization
        case 'T':
          if ((e.metaKey || e.ctrlKey) && e.shiftKey) {
            e.preventDefault();
            toggleThemeCustomization();
          }
          break;

        case 'm': // Ctrl+Shift+M - mobile companion
        case 'M':
          if ((e.metaKey || e.ctrlKey) && e.shiftKey) {
            e.preventDefault();
            toggleMobileCompanion();
          }
          break;

        case 's': // Ctrl+Shift+S - spotify widget
        case 'S':
          if ((e.metaKey || e.ctrlKey) && e.shiftKey) {
            e.preventDefault();
            toggleSpotifyWidget();
          }
          break;

        case 'f': // Ctrl+Shift+F - focus mode
        case 'F':
          if ((e.metaKey || e.ctrlKey) && e.shiftKey) {
            e.preventDefault();
            toggleFocusMode();
          }
          break;

        case 'h': // Ctrl+Shift+H - voice history
        case 'H':
          if ((e.metaKey || e.ctrlKey) && e.shiftKey) {
            e.preventDefault();
            toggleVoiceHistory();
          }
          break;

        case 'n': // Ctrl+Shift+N - quick notes
        case 'N':
          if ((e.metaKey || e.ctrlKey) && e.shiftKey) {
            e.preventDefault();
            toggleQuickNotes();
          }
          break;

        case 'y': // Ctrl+Shift+Y - system stats
        case 'Y':
          if ((e.metaKey || e.ctrlKey) && e.shiftKey) {
            e.preventDefault();
            toggleSystemStats();
          }
          break;

        case 'a': // Ctrl+Shift+A - activity timeline
        case 'A':
          if ((e.metaKey || e.ctrlKey) && e.shiftKey) {
            e.preventDefault();
            toggleActivityTimeline();
          }
          break;

        case 'k': // Ctrl+Shift+K - API key manager
        case 'K':
          if ((e.metaKey || e.ctrlKey) && e.shiftKey) {
            e.preventDefault();
            toggleAPIKeyManager();
          }
          break;

        case 'j': // Ctrl+Shift+J - developer console
        case 'J':
          if ((e.metaKey || e.ctrlKey) && e.shiftKey) {
            e.preventDefault();
            toggleDeveloperConsole();
          }
          break;

        case 'i': // Ctrl+Shift+I - integrations hub
        case 'I':
          if ((e.metaKey || e.ctrlKey) && e.shiftKey) {
            e.preventDefault();
            toggleIntegrationsHub();
          }
          break;

        case 'x': // Ctrl+Shift+X - screen context panel
        case 'X':
          if ((e.metaKey || e.ctrlKey) && e.shiftKey) {
            e.preventDefault();
            toggleScreenContext();
          }
          break;

        case 'v': // Ctrl+Shift+V - voice feedback settings
        case 'V':
          if ((e.metaKey || e.ctrlKey) && e.shiftKey) {
            e.preventDefault();
            toggleVoiceFeedback();
          }
          break;

        case 'e': // Ctrl+Shift+E - conversation export
        case 'E':
          if ((e.metaKey || e.ctrlKey) && e.shiftKey) {
            e.preventDefault();
            toggleConversationExport();
          }
          break;

        case 'b': // Ctrl+Shift+B - backup/restore
        case 'B':
          if ((e.metaKey || e.ctrlKey) && e.shiftKey) {
            e.preventDefault();
            toggleBackupRestore();
          }
          break;

        case 'l': // Ctrl+Shift+L - learning dashboard
        case 'L':
          if ((e.metaKey || e.ctrlKey) && e.shiftKey) {
            e.preventDefault();
            toggleLearningDashboard();
          }
          break;

        case 'g': // Ctrl+Shift+G - gesture controls
        case 'G':
          if ((e.metaKey || e.ctrlKey) && e.shiftKey) {
            e.preventDefault();
            toggleGestureControls();
          }
          break;

        case 'o': // Ctrl+Shift+O - ambient mode
        case 'O':
          if ((e.metaKey || e.ctrlKey) && e.shiftKey) {
            e.preventDefault();
            toggleAmbientMode();
          }
          break;

        case 'u': // Ctrl+Shift+U - plugin system
        case 'U':
          if ((e.metaKey || e.ctrlKey) && e.shiftKey) {
            e.preventDefault();
            togglePluginSystem();
          }
          break;

        case 'q': // Ctrl+Shift+Q - multi-monitor
        case 'Q':
          if ((e.metaKey || e.ctrlKey) && e.shiftKey) {
            e.preventDefault();
            toggleMultiMonitor();
          }
          break;

        case 'w': // Ctrl+Shift+W - custom wake words
        case 'W':
          if ((e.metaKey || e.ctrlKey) && e.shiftKey) {
            e.preventDefault();
            toggleCustomWakeWords();
          }
          break;

        case 'r': // Ctrl+Shift+R - performance monitor
        case 'R':
          if ((e.metaKey || e.ctrlKey) && e.shiftKey) {
            e.preventDefault();
            togglePerformanceMonitor();
          }
          break;

        case '1': // Ctrl+Shift+1 - automation
          if ((e.metaKey || e.ctrlKey) && e.shiftKey) {
            e.preventDefault();
            toggleAutomation();
          }
          break;

        case '2': // Ctrl+Shift+2 - offline mode
          if ((e.metaKey || e.ctrlKey) && e.shiftKey) {
            e.preventDefault();
            toggleOfflineMode();
          }
          break;

        case '3': // Ctrl+Shift+3 - context window
          if ((e.metaKey || e.ctrlKey) && e.shiftKey) {
            e.preventDefault();
            toggleContextWindow();
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    state,
    isReady,
    triggerWake,
    stop,
    toggleSettings,
    updateSettings,
    settings.showDebug,
    toggleOrbOnly,
    view,
    toggleCommandPalette,
    toggleThemeCustomization,
    toggleMobileCompanion,
    toggleSpotifyWidget,
    toggleFocusMode,
    toggleVoiceHistory,
    toggleQuickNotes,
    toggleSystemStats,
    toggleActivityTimeline,
    toggleAPIKeyManager,
    toggleDeveloperConsole,
    toggleIntegrationsHub,
    toggleScreenContext,
    toggleVoiceFeedback,
    toggleConversationExport,
    toggleBackupRestore,
    toggleLearningDashboard,
    toggleGestureControls,
    toggleAmbientMode,
    togglePluginSystem,
    toggleMultiMonitor,
    toggleCustomWakeWords,
    togglePerformanceMonitor,
    toggleAutomation,
    toggleOfflineMode,
    toggleContextWindow,
    setView,
  ]);

  // Listen for IPC events to open settings
  useEffect(() => {
    const handleOpenSettings = () => toggleSettings();
    const unsubscribe = window.atlas?.on('atlas:open-settings', handleOpenSettings);
    return () => {
      unsubscribe?.();
    };
  }, [toggleSettings]);

  return (
    <div className="atlas-app" data-navigation-mode={navigationMode}>
      {/* Skip links for keyboard navigation */}
      <SkipLinks />

      {/* Main View - Dashboard or Command Center */}
      {view === 'command-center' ? (
        <AtlasUI />
      ) : (
        <DashboardLayout />
      )}

      {/* Settings Panel */}
      <Settings />

      {/* Error Toast Notifications */}
      <ErrorToastContainer />

      {/* Real-Time Transcript Overlay */}
      <RealTimeTranscript visible={settings.showRealTimeTranscript ?? true} />

      {/* Debug Overlay (dev mode only) */}
      <DebugOverlay
        visible={settings.showDebug ?? false}
        particleCount={settings.particleCount || 30000}
      />

      {/* Debug Panel - Full debugging dashboard */}
      <DebugPanel visible={showDebugPanel} onClose={() => setShowDebugPanel(false)} />

      {/* Keyboard Shortcuts Help */}
      <KeyboardShortcuts isOpen={showShortcuts} onClose={closeShortcuts} />

      {/* Screen reader announcer for accessibility */}
      <ScreenReaderAnnouncer />

      {/* Enhanced Command Palette (Ctrl+Shift+P) */}
      <EnhancedCommandPalette 
        isVisible={showCommandPalette} 
        onClose={() => setShowCommandPalette(false)} 
      />

      {/* Theme Customization Panel (Ctrl+Shift+T) */}
      <ThemeCustomization 
        isVisible={showThemeCustomization} 
        onClose={() => setShowThemeCustomization(false)} 
      />

      {/* Mobile Companion Settings (Ctrl+Shift+M) */}
      <MobileCompanion 
        isVisible={showMobileCompanion} 
        onClose={() => setShowMobileCompanion(false)} 
      />

      {/* Spotify Mini Player (Ctrl+Shift+S) */}
      {showSpotifyWidget && (
        <div className="spotify-widget-container">
          <SpotifyWidget isVisible={showSpotifyWidget} onClose={() => setShowSpotifyWidget(false)} />
        </div>
      )}

      {/* Proactive Suggestions - Now spoken via TTS, panel hidden */}
      {/* <ProactiveSuggestions /> */}

      {/* Focus Mode / Pomodoro Timer (Ctrl+Shift+F) */}
      <FocusMode
        isVisible={showFocusMode}
        onClose={() => setShowFocusMode(false)}
      />

      {/* Voice Command History (Ctrl+Shift+H) */}
      <VoiceHistory
        isVisible={showVoiceHistory}
        onClose={() => setShowVoiceHistory(false)}
      />

      {/* Quick Notes (Ctrl+Shift+N) */}
      <QuickNotes
        isVisible={showQuickNotes}
        onClose={() => setShowQuickNotes(false)}
      />

      {/* System Stats Widget (Ctrl+Shift+Y) */}
      <SystemStats
        isVisible={showSystemStats}
        onClose={() => setShowSystemStats(false)}
      />

      {/* Activity Timeline (Ctrl+Shift+A) */}
      <ActivityTimeline
        isVisible={showActivityTimeline}
        onClose={() => setShowActivityTimeline(false)}
      />

      {/* API Key Manager (Ctrl+Shift+K) */}
      <APIKeyManager
        isVisible={showAPIKeyManager}
        onClose={() => setShowAPIKeyManager(false)}
      />

      {/* Developer Console (Ctrl+Shift+J) */}
      <DeveloperConsole
        isVisible={showDeveloperConsole}
        onClose={() => setShowDeveloperConsole(false)}
      />

      {/* Integrations Hub (Ctrl+Shift+I) */}
      <IntegrationsHub
        isVisible={showIntegrationsHub}
        onClose={() => setShowIntegrationsHub(false)}
      />

      {/* Screen Context Panel (Ctrl+Shift+X) */}
      <ScreenContextPanel
        isVisible={showScreenContext}
        onClose={() => setShowScreenContext(false)}
      />

      {/* Voice Feedback Settings (Ctrl+Shift+V) */}
      <VoiceFeedbackSettings
        isVisible={showVoiceFeedback}
        onClose={() => setShowVoiceFeedback(false)}
      />

      {/* Conversation Export (Ctrl+Shift+E) */}
      <ConversationExport
        isVisible={showConversationExport}
        onClose={() => setShowConversationExport(false)}
      />

      {/* Backup/Restore (Ctrl+Shift+B) */}
      <BackupRestore
        isVisible={showBackupRestore}
        onClose={() => setShowBackupRestore(false)}
      />

      {/* Learning Dashboard (Ctrl+Shift+L) */}
      <LearningDashboard
        isVisible={showLearningDashboard}
        onClose={() => setShowLearningDashboard(false)}
      />

      {/* Gesture Controls (Ctrl+Shift+G) */}
      <GestureControls
        isVisible={showGestureControls}
        onClose={() => setShowGestureControls(false)}
      />

      {/* Ambient Mode (Ctrl+Shift+O) */}
      <AmbientMode
        isVisible={showAmbientMode}
        onClose={() => setShowAmbientMode(false)}
      />

      {/* Plugin System (Ctrl+Shift+U) */}
      <PluginSystem
        isVisible={showPluginSystem}
        onClose={() => setShowPluginSystem(false)}
      />

      {/* Multi-Monitor Support (Ctrl+Shift+Q) */}
      <MultiMonitorSupport
        isVisible={showMultiMonitor}
        onClose={() => setShowMultiMonitor(false)}
      />

      {/* Custom Wake Words (Ctrl+Shift+W) */}
      <CustomWakeWords
        isVisible={showCustomWakeWords}
        onClose={() => setShowCustomWakeWords(false)}
      />

      {/* Performance Monitor (Ctrl+Shift+R) */}
      <PerformanceMonitor
        isVisible={showPerformanceMonitor}
        onClose={() => setShowPerformanceMonitor(false)}
      />

      {/* Natural Language Automation (Ctrl+Shift+1) */}
      <NaturalLanguageAutomation
        isVisible={showAutomation}
        onClose={() => setShowAutomation(false)}
      />

      {/* Offline Mode (Ctrl+Shift+2) */}
      <OfflineMode
        isVisible={showOfflineMode}
        onClose={() => setShowOfflineMode(false)}
      />

      {/* Context Window Display (Ctrl+Shift+3) */}
      <ContextWindowDisplay
        isVisible={showContextWindow}
        onClose={() => setShowContextWindow(false)}
      />
    </div>
  );
}

/**
 * Main App component
 * Wraps AppContent with AccessibilityProvider
 */
function App() {
  return (
    <AccessibilityProvider>
      <AppContent />
    </AccessibilityProvider>
  );
}

export default App;
