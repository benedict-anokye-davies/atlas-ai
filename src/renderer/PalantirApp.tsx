/**
 * Atlas Desktop - Palantir-Style App
 * Voice-first AI assistant with Palantir command center UI
 * 
 * STABILITY FEATURES:
 * - All IPC calls wrapped in try-catch with fallbacks
 * - Critical components wrapped in error boundaries
 * - Safe state management with mounted checks
 * - Graceful degradation when services unavailable
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { AnimatePresence } from 'framer-motion';
import {
  AppShell,
  Header,
  LeftNav,
  StatusBar,
  OrbWidget,
  FullScreenOrb,
  PortfolioWidget,
  ActivityFeed,
  MetricCard,
  SystemHealth,
  TradingView,
  BankingView,
  IntelligenceView,
  ViewId,
  OrbState,
  TranscriptEntry,
  FeedItem,
  Position,
  ServiceInfo,
} from './components/palantir';
import { Settings } from './components/Settings';
import { ErrorToastContainer } from './components/ErrorToast';
import { EnhancedCommandPalette } from './components/CommandPaletteEnhanced';
import {
  AccessibilityProvider,
  ScreenReaderAnnouncer,
  useAnnounce,
} from './components/accessibility';
import { ErrorBoundary } from './utils/error-boundary';
import { 
  SafeWidgetWrapper, 
  SafeOrbWrapper, 
  SafeModalWrapper,
  ComponentPlaceholder,
} from './utils/safe-wrappers';
import { safeAtlasCall, safeInvoke, createCleanupTracker } from './utils/stability';
import { useAtlasState } from './hooks';
import { useAtlasStore } from './stores';
import { ATLAS_STATE_DESCRIPTIONS } from '../shared/types/accessibility';
import './styles/palantir-theme.css';
import './styles/App.css';

// Map Atlas voice state to Orb state
const mapVoiceStateToOrbState = (state: string): OrbState => {
  switch (state) {
    case 'listening':
      return 'listening';
    case 'thinking':
    case 'processing':
      return 'thinking';
    case 'speaking':
      return 'speaking';
    case 'error':
      return 'error';
    default:
      return 'idle';
  }
};

/**
 * Main Palantir App Content
 */
function PalantirAppContent() {
  const { state, isReady, start, stop, triggerWake, audioLevel } = useAtlasState();
  const { settings, toggleSettings, isSettingsOpen } = useAtlasStore();

  // Track if component is mounted for safe state updates
  const isMountedRef = useRef(true);

  // Screen reader announcements
  const { announce } = useAnnounce();
  const previousStateRef = useRef(state);

  // View state
  const [activeView, setActiveView] = useState<ViewId>('dashboard');
  const [isNavExpanded] = useState(false);  // LeftNav manages expansion internally
  const [isContextPanelOpen, setIsContextPanelOpen] = useState(false);
  const [isFullScreenOrbOpen, setIsFullScreenOrbOpen] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [autoStarted, setAutoStarted] = useState(false);

  // Transcript state (will be populated by real voice pipeline)
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);

  // Real data states (fetched from IPC)
  const [portfolioTotal, setPortfolioTotal] = useState(0);
  const [dailyPnL, setDailyPnL] = useState(0);
  const [bankBalance, setBankBalance] = useState(0);
  const [bankChange, setBankChange] = useState(0);
  const [positions, setPositions] = useState<Position[]>([]);
  const [feedItems, setFeedItems] = useState<FeedItem[]>([]);
  const [services, setServices] = useState<ServiceInfo[]>([]);

  // Derived orb state from voice pipeline
  const orbState = mapVoiceStateToOrbState(state);

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Safe state setters that check if mounted
  const safeSetState = useCallback(<T,>(setter: React.Dispatch<React.SetStateAction<T>>, value: T) => {
    if (isMountedRef.current) {
      setter(value);
    }
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

  // Fetch real data from IPC on mount and periodically (with safe error handling)
  useEffect(() => {
    const cleanup = createCleanupTracker();
    let isActive = true;

    const fetchData = async () => {
      // Guard against unmounted state
      if (!isActive || !isMountedRef.current) return;

      // ========== Trading Portfolio (Safe) ==========
      try {
        const portfolioResult = await safeInvoke<{ 
          totalValue: number; 
          dailyPnL: number; 
          positions: Position[] 
        }>('trading:portfolio:summary');
        
        if (isActive && portfolioResult.success && portfolioResult.data) {
          safeSetState(setPortfolioTotal, portfolioResult.data.totalValue || 0);
          safeSetState(setDailyPnL, portfolioResult.data.dailyPnL || 0);
          
          if (portfolioResult.data.positions) {
            const mappedPositions = portfolioResult.data.positions.map((p, i) => ({
              id: `p${i}`,
              symbol: (p as { symbol?: string }).symbol || 'Unknown',
              side: (p as { side?: 'long' | 'short' }).side || 'long',
              entryPrice: (p as { entryPrice?: number }).entryPrice || 0,
              currentPrice: (p as { currentPrice?: number }).currentPrice || 0,
              quantity: (p as { quantity?: number }).quantity || 0,
              pnl: (p as { pnl?: number }).pnl || 0,
              pnlPercent: (p as { pnlPercent?: number }).pnlPercent || 0,
            }));
            safeSetState(setPositions, mappedPositions);
          }
        }
      } catch (err) {
        console.warn('[PalantirApp] Portfolio fetch skipped:', err);
      }

      // ========== Banking Balance (Safe) ==========
      try {
        const bankingResult = await safeInvoke<{ totalBalance: number; dailyChange: number }>(
          'banking:get-balance-summary'
        );
        
        if (isActive && bankingResult.success && bankingResult.data) {
          safeSetState(setBankBalance, bankingResult.data.totalBalance || 0);
          safeSetState(setBankChange, bankingResult.data.dailyChange || 0);
        }
      } catch (err) {
        console.warn('[PalantirApp] Banking fetch skipped:', err);
      }

      // ========== Service Health (Safe) ==========
      try {
        const connectivityData = await safeAtlasCall<{ 
          status: { latency?: number }; 
          services: Record<string, boolean> 
        } | null>('atlas.getConnectivity', null);
        
        if (isActive && connectivityData) {
          const servicesList: ServiceInfo[] = [
            {
              id: 's1',
              name: 'Voice Pipeline',
              status: isReady ? 'online' : 'offline',
              latency: Math.round(connectivityData.status?.latency || 0),
            },
            {
              id: 's2',
              name: 'LLM (Fireworks)',
              status: connectivityData.services?.fireworks ? 'online' : 'offline',
            },
            {
              id: 's3',
              name: 'TTS (ElevenLabs)',
              status: connectivityData.services?.elevenlabs ? 'online' : 'offline',
            },
            {
              id: 's4',
              name: 'STT (Deepgram)',
              status: connectivityData.services?.deepgram ? 'online' : 'offline',
            },
            {
              id: 's5',
              name: 'Internet',
              status: connectivityData.services?.internet ? 'online' : 'offline',
            },
          ];
          safeSetState(setServices, servicesList);
        }
      } catch (err) {
        console.warn('[PalantirApp] Connectivity fetch skipped:', err);
      }

      // ========== Activity Feed (Safe) ==========
      try {
        const history = await safeAtlasCall<Array<{ role: string; content: string; timestamp?: number }>>(
          'atlas.getConversationHistory',
          [],
          10
        );
        
        if (isActive && history.length > 0) {
          const feedFromHistory: FeedItem[] = history.slice(0, 5).map((entry, i) => ({
            id: `feed${i}`,
            type: entry.role === 'assistant' ? 'atlas' : 'system',
            title: entry.role === 'assistant' ? 'Atlas response' : 'User message',
            subtitle: entry.content.slice(0, 50) + (entry.content.length > 50 ? '...' : ''),
            timestamp: entry.timestamp || Date.now() - i * 60000,
          }));
          safeSetState(setFeedItems, feedFromHistory);
        }
      } catch (err) {
        console.warn('[PalantirApp] Activity feed fetch skipped:', err);
      }
    };

    // Fetch immediately and then every 30 seconds
    fetchData();
    const interval = setInterval(fetchData, 30000);
    cleanup.track(() => clearInterval(interval));
    
    return () => {
      isActive = false;
      cleanup.cleanup();
    };
  }, [isReady, safeSetState]);

  // Global keyboard shortcuts (with safe error handling)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      try {
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

          case 'Escape': // Escape - close fullscreen orb or stop
            e.preventDefault();
            if (isFullScreenOrbOpen) {
              setIsFullScreenOrbOpen(false);
            } else if (state === 'listening' || state === 'thinking') {
              stop();
            }
            break;

          case ',': // Ctrl+, - open settings
            if (e.metaKey || e.ctrlKey) {
              e.preventDefault();
              toggleSettings();
            }
            break;

          case 'p': // Ctrl+Shift+P - command palette
          case 'P':
            if ((e.metaKey || e.ctrlKey) && e.shiftKey) {
              e.preventDefault();
              setShowCommandPalette(prev => !prev);
            }
            break;

          case 'o': // Ctrl+Shift+O - toggle fullscreen orb
          case 'O':
            if ((e.metaKey || e.ctrlKey) && e.shiftKey) {
              e.preventDefault();
              setIsFullScreenOrbOpen(prev => !prev);
            }
            break;
        }
      } catch (err) {
        console.error('[PalantirApp] Keyboard handler error:', err);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [state, isReady, triggerWake, stop, toggleSettings, isFullScreenOrbOpen]);

  // Handlers
  const handleOrbClick = useCallback(() => {
    if (state === 'idle' && isReady) {
      triggerWake();
    }
  }, [state, isReady, triggerWake]);

  const handleOrbExpand = useCallback(() => {
    setIsFullScreenOrbOpen(true);
  }, []);

  const handleFullScreenClose = useCallback(() => {
    setIsFullScreenOrbOpen(false);
  }, []);

  const handleTextSubmit = useCallback((text: string) => {
    // Add user message to transcript
    const userEntry: TranscriptEntry = {
      id: Date.now().toString(),
      type: 'user',
      text,
      timestamp: Date.now(),
    };
    setTranscript(prev => [...prev, userEntry]);

    // Send to Atlas via IPC
    const atlasApi = window.atlas as unknown as { atlas?: { sendText?: (text: string) => Promise<void> } };
    atlasApi?.atlas?.sendText?.(text).then(() => {
      // Response will come through voice pipeline events
    }).catch((err: Error) => {
      console.error('[Atlas] Failed to send text:', err);
    });
  }, []);

  const handleViewChange = useCallback((view: ViewId) => {
    setActiveView(view);
  }, []);

  const handleSettingsClick = useCallback(() => {
    toggleSettings();
  }, [toggleSettings]);

  const handleFeedRefresh = useCallback(async () => {
    try {
      const historyResult = await window.atlas?.atlas?.getConversationHistory(10);
      if (historyResult?.success && historyResult.data) {
        const history = historyResult.data as Array<{ role: string; content: string; timestamp?: number }>;
        const feedFromHistory: FeedItem[] = history.slice(0, 5).map((entry, i) => ({
          id: `feed${i}`,
          type: entry.role === 'assistant' ? 'atlas' : 'system',
          title: entry.role === 'assistant' ? 'Atlas response' : 'User message',
          subtitle: entry.content.slice(0, 50) + (entry.content.length > 50 ? '...' : ''),
          timestamp: entry.timestamp || Date.now() - i * 60000,
        }));
        setFeedItems(feedFromHistory);
      }
    } catch (err) {
      console.warn('[PalantirApp] Failed to refresh feed:', err);
    }
  }, []);

  const handlePortfolioClick = useCallback(() => {
    setActiveView('trading');
  }, []);

  // Render main content based on active view (with safe wrappers)
  const renderMainContent = () => {
    switch (activeView) {
      case 'dashboard':
        return (
          <div className="palantir-dashboard">
            {/* Top Row - Orb + Key Metrics */}
            <div className="palantir-dashboard__top-row">
              <SafeOrbWrapper>
                <OrbWidget
                  state={orbState}
                  audioLevel={audioLevel}
                  onOrbClick={handleOrbClick}
                  onExpandClick={handleOrbExpand}
                />
              </SafeOrbWrapper>

              <SafeWidgetWrapper name="Bank Balance" minHeight={80}>
                <MetricCard
                  label="Bank Balance"
                  value={`£${bankBalance.toLocaleString('en-GB', { minimumFractionDigits: 2 })}`}
                  change={bankChange}
                  changeLabel="today"
                  icon={
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M10 2L2 6v2h16V6l-8-4zM4 10v6h3v-6H4zm4.5 0v6h3v-6h-3zM13 10v6h3v-6h-3zM2 18h16v2H2v-2z"/>
                    </svg>
                  }
                />
              </SafeWidgetWrapper>

              <SafeWidgetWrapper name="System Health" minHeight={80}>
                <SystemHealth services={services} />
              </SafeWidgetWrapper>
            </div>

            {/* Main Grid */}
            <div className="palantir-dashboard__grid">
              <div className="palantir-dashboard__widget palantir-dashboard__widget--portfolio">
                <SafeWidgetWrapper name="Portfolio" minHeight={200}>
                  <PortfolioWidget
                    totalValue={portfolioTotal}
                    dailyPnL={dailyPnL}
                    dailyPnLPercent={1.55}
                    positions={positions}
                    onViewAll={handlePortfolioClick}
                  />
                </SafeWidgetWrapper>
              </div>

              <div className="palantir-dashboard__widget palantir-dashboard__widget--feed">
                <SafeWidgetWrapper name="Activity Feed" minHeight={200}>
                  <ActivityFeed
                    items={feedItems}
                    onRefresh={handleFeedRefresh}
                  />
                </SafeWidgetWrapper>
              </div>
            </div>
          </div>
        );

      case 'trading':
        return (
          <SafeWidgetWrapper name="Trading View" minHeight={400}>
            <TradingView 
              portfolioTotal={portfolioTotal}
              dailyPnL={dailyPnL}
              positions={positions}
            />
          </SafeWidgetWrapper>
        );

      case 'banking':
        return (
          <SafeWidgetWrapper name="Banking View" minHeight={400}>
            <BankingView 
              bankBalance={bankBalance}
              bankChange={bankChange}
            />
          </SafeWidgetWrapper>
        );

      case 'intelligence':
        return (
          <SafeWidgetWrapper name="Intelligence View" minHeight={400}>
            <IntelligenceView />
          </SafeWidgetWrapper>
        );

      case 'projects':
        return (
          <SafeWidgetWrapper name="Projects View" minHeight={200}>
            <div className="palantir-placeholder">
              <h2>Projects View</h2>
              <p>Project management interface coming soon...</p>
            </div>
          </SafeWidgetWrapper>
        );

      default:
        return null;
    }
  };

  return (
    <div className="palantir-app" data-navigation-mode="mouse">
      <AppShell
        header={<Header title="Atlas" subtitle={activeView} />}
        leftNav={
          <LeftNav
            activeView={activeView}
            isExpanded={isNavExpanded}
            onViewChange={handleViewChange}
            onSettingsClick={handleSettingsClick}
            items={[
              {
                id: 'dashboard',
                label: 'Dashboard',
                icon: <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path d="M3 3h6v6H3V3zm0 8h6v6H3v-6zm8-8h6v6h-6V3zm0 8h6v6h-6v-6z"/></svg>
              },
              {
                id: 'trading',
                label: 'Trading',
                icon: <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path d="M3 17V7l4 4 4-6 6 8v4H3z"/></svg>,
                badge: positions.length
              },
              {
                id: 'banking',
                label: 'Banking',
                icon: <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path d="M10 2L2 6v2h16V6l-8-4zM4 10v6h3v-6H4zm4.5 0v6h3v-6h-3zM13 10v6h3v-6h-3zM2 18h16v2H2v-2z"/></svg>
              },
              {
                id: 'intelligence',
                label: 'Intelligence',
                icon: <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm0 2a6 6 0 1 1 0 12 6 6 0 0 1 0-12z"/></svg>
              },
              {
                id: 'projects',
                label: 'Projects',
                icon: <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path d="M2 4a2 2 0 0 1 2-2h5l2 2h5a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4z"/></svg>
              },
            ]}
          />
        }
        statusBar={
          <StatusBar
            connectionStatus={isReady ? 'online' : 'connecting'}
            voiceState={orbState === 'idle' ? 'idle' : orbState === 'listening' ? 'listening' : orbState === 'thinking' ? 'thinking' : 'speaking'}
            llmProvider="Fireworks"
            cpuUsage={23}
            memoryUsage={45}
            fps={60}
          />
        }
        showContextPanel={isContextPanelOpen}
        onContextPanelToggle={(show) => setIsContextPanelOpen(show)}
      >
        {renderMainContent()}
      </AppShell>

      {/* Full Screen Orb Modal - Wrapped for safety */}
      <AnimatePresence>
        {isFullScreenOrbOpen && (
          <SafeModalWrapper name="Full Screen Orb">
            <FullScreenOrb
              isOpen={isFullScreenOrbOpen}
              state={orbState}
              audioLevel={audioLevel}
              transcript={transcript}
              onClose={handleFullScreenClose}
              onTextSubmit={handleTextSubmit}
            />
          </SafeModalWrapper>
        )}
      </AnimatePresence>

      {/* Settings Modal - Wrapped for safety */}
      {isSettingsOpen && (
        <SafeModalWrapper name="Settings">
          <Settings />
        </SafeModalWrapper>
      )}

      {/* Command Palette - Wrapped for safety */}
      {showCommandPalette && (
        <SafeModalWrapper name="Command Palette">
          <EnhancedCommandPalette
            isVisible={showCommandPalette}
            onClose={() => setShowCommandPalette(false)}
          />
        </SafeModalWrapper>
      )}

      {/* Error Toast */}
      <ErrorToastContainer />
    </div>
  );
}

/**
 * Main Palantir App with Accessibility Provider
 * Wrapped in ErrorBoundary for bulletproof stability
 */
export default function PalantirApp() {
  return (
    <ErrorBoundary
      fallback={
        <div style={{
          minHeight: '100vh',
          background: '#0a0a0f',
          color: '#00ffff',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'JetBrains Mono, monospace',
          padding: '2rem'
        }}>
          <h1 style={{ fontSize: '2rem', marginBottom: '1rem' }}>ATLAS</h1>
          <p style={{ opacity: 0.7, marginBottom: '2rem' }}>System encountered an error</p>
          <button
            onClick={() => window.location.reload()}
            style={{
              background: 'rgba(0, 255, 255, 0.1)',
              border: '1px solid rgba(0, 255, 255, 0.3)',
              color: '#00ffff',
              padding: '0.75rem 2rem',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: '0.875rem'
            }}
          >
            RELOAD SYSTEM
          </button>
        </div>
      }
      onError={(error, errorInfo) => {
        console.error('[PalantirApp] Root error boundary caught:', error, errorInfo);
      }}
    >
      <AccessibilityProvider>
        <ScreenReaderAnnouncer />
        <PalantirAppContent />
      </AccessibilityProvider>
    </ErrorBoundary>
  );
}
