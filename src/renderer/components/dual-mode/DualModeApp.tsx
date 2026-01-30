/**
 * @fileoverview Dual Mode Application Root
 * Main component that orchestrates Chat Mode ↔ Orb Mode
 * 
 * @module DualModeApp
 * 
 * @description
 * This is the root component for Atlas's redesigned UI. It provides:
 * - Chat Mode (default): Text-based conversation interface
 * - Orb Mode: Full-screen immersive voice-first visualization
 * - Widgets Panel: Dashboard cards with full view access
 * 
 * The user can toggle between modes using the control buttons or Tab key.
 */

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { useAtlasState } from '../../hooks/useAtlasState';
import { ChatMode } from './ChatMode';
import { OrbMode, OrbState } from './OrbMode';
import { WidgetsPanel, WidgetType, WidgetData } from './WidgetsPanel';
import { FullViewWrapper } from './FullViewWrapper';
import { Message } from './MessageBubble';

// Import styles
import '../../styles/dual-mode.css';

// Icons
const ChatIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

const OrbIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <circle cx="12" cy="12" r="4" />
  </svg>
);

const GridIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7" />
    <rect x="14" y="3" width="7" height="7" />
    <rect x="14" y="14" width="7" height="7" />
    <rect x="3" y="14" width="7" height="7" />
  </svg>
);

type Mode = 'chat' | 'orb';

/**
 * Maps voice pipeline state to OrbState for visualization
 */
function mapVoiceStateToOrbState(voiceState: string): OrbState {
  switch (voiceState) {
    case 'listening':
      return 'listening';
    case 'processing':
    case 'thinking':
      return 'thinking';
    case 'speaking':
      return 'speaking';
    case 'error':
      return 'error';
    default:
      return 'idle';
  }
}

/**
 * Dual Mode Application
 * Root component managing mode switching and state
 */
export const DualModeApp: React.FC = () => {
  // Mode state - Chat is default
  const [mode, setMode] = useState<Mode>('chat');
  const [widgetsPanelOpen, setWidgetsPanelOpen] = useState(false);
  const [fullView, setFullView] = useState<WidgetType | null>(null);
  
  // Voice pipeline state from Atlas
  const atlasState = useAtlasState();
  
  // Message history (persisted in session)
  const [messages, setMessages] = useState<Message[]>([]);
  
  // Streaming state
  const [streamingResponse, setStreamingResponse] = useState<string>('');
  
  // Voice input state
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  
  // Initialize voice pipeline on mount
  useEffect(() => {
    const initVoicePipeline = async () => {
      try {
        // Start the voice pipeline so it can receive commands
        await atlasState.start();
        console.log('[DualModeApp] Voice pipeline started');
      } catch (error) {
        console.error('[DualModeApp] Failed to start voice pipeline:', error);
      }
    };
    
    initVoicePipeline();
    
    // Cleanup on unmount
    return () => {
      atlasState.stop().catch(console.error);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run on mount
  
  // Widget data (would be fetched from IPC in real implementation)
  const [widgetData, setWidgetData] = useState<WidgetData>({
    trading: {
      portfolioValue: 24650,
      dailyPnL: 340,
      dailyPnLPercent: 1.4,
      openPositions: 3,
    },
    banking: {
      totalBalance: 8450,
      recentTransactions: 12,
      budgetUsed: 67,
    },
    intelligence: {
      activeAgents: 5,
      alerts: 2,
      lastInsight: 'Market regime shifted to bullish',
    },
    system: {
      cpu: 23,
      memory: 45,
      uptime: '4d 12h',
    },
  });
  
  // Map Atlas state to orb state
  const orbState = useMemo((): OrbState => {
    return mapVoiceStateToOrbState(atlasState.state || 'idle');
  }, [atlasState.state]);
  
  // Sync streaming response from atlasState
  useEffect(() => {
    if (atlasState.response && atlasState.isThinking) {
      // Update streaming response while thinking
      setStreamingResponse(atlasState.response);
    }
  }, [atlasState.response, atlasState.isThinking]);
  
  // When response is complete (state goes from thinking to speaking/idle), add to messages
  const prevStateRef = React.useRef(atlasState.state);
  useEffect(() => {
    const prevState = prevStateRef.current;
    const currentState = atlasState.state;
    
    // Detect transition from thinking to speaking or idle
    // Note: 'processing' backend state maps to 'thinking' in AtlasState
    if (prevState === 'thinking' && 
        (currentState === 'speaking' || currentState === 'idle')) {
      if (atlasState.response) {
        // Add completed response to message history
        setMessages(prev => {
          // Avoid duplicates
          const lastMsg = prev[prev.length - 1];
          if (lastMsg?.content === atlasState.response && lastMsg?.role === 'assistant') {
            return prev;
          }
          return [...prev, {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            content: atlasState.response,
            timestamp: Date.now(),
          }];
        });
        setStreamingResponse('');
      }
    }
    
    // When transcript is finalized (listening ends), add user message
    if (prevState === 'listening' && currentState !== 'listening') {
      if (atlasState.transcript) {
        setMessages(prev => {
          // Avoid duplicates
          const lastMsg = prev[prev.length - 1];
          if (lastMsg?.content === atlasState.transcript && lastMsg?.role === 'user') {
            return prev;
          }
          return [...prev, {
            id: `user-${Date.now()}`,
            role: 'user',
            content: atlasState.transcript,
            timestamp: Date.now(),
          }];
        });
      }
    }
    
    prevStateRef.current = currentState;
  }, [atlasState.state, atlasState.response, atlasState.transcript]);
  
  // Fetch widget data periodically
  useEffect(() => {
    const fetchWidgetData = async () => {
      try {
        // Fetch system data
        if (window.atlas?.performance?.getData) {
          const result = await window.atlas.performance.getData();
          if (result.success && result.data?.metrics) {
            const m = result.data.metrics;
            // Handle metrics that may be objects with current/avg/min/max or plain numbers
            const getCpuValue = (cpu: unknown): number => {
              if (typeof cpu === 'number') return cpu;
              if (cpu && typeof cpu === 'object' && 'current' in cpu) {
                return (cpu as { current: number }).current;
              }
              return 0;
            };
            const getMemoryValue = (mem: unknown): number => {
              if (typeof mem === 'number') return mem;
              if (mem && typeof mem === 'object' && 'current' in mem) {
                return (mem as { current: number }).current;
              }
              return 0;
            };
            const getUptimeValue = (uptime: unknown): number => {
              if (typeof uptime === 'number') return uptime;
              if (uptime && typeof uptime === 'object' && 'current' in uptime) {
                return (uptime as { current: number }).current;
              }
              return 0;
            };
            
            setWidgetData(prev => ({
              ...prev,
              system: {
                cpu: Math.round(getCpuValue(m.cpu)),
                memory: Math.round(getMemoryValue(m.memory)),
                uptime: formatUptime(getUptimeValue(m.uptime)),
              },
            }));
          }
        }
      } catch (error) {
        console.warn('Failed to fetch widget data:', error);
      }
    };
    
    fetchWidgetData();
    const interval = setInterval(fetchWidgetData, 30000); // Every 30s
    
    return () => clearInterval(interval);
  }, []);
  
  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Tab to toggle mode (when not in input)
      if (e.key === 'Tab' && !isInputFocused()) {
        e.preventDefault();
        setMode(m => m === 'chat' ? 'orb' : 'chat');
      }
      
      // Escape to close full view or widgets panel
      if (e.key === 'Escape') {
        if (fullView) {
          setFullView(null);
        } else if (widgetsPanelOpen) {
          setWidgetsPanelOpen(false);
        }
      }
      
      // W to toggle widgets panel
      if (e.key === 'w' && e.ctrlKey) {
        e.preventDefault();
        setWidgetsPanelOpen(v => !v);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [fullView, widgetsPanelOpen]);
  
  // Send message handler
  const handleSendMessage = useCallback(async (text: string) => {
    // Add user message to history
    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, userMessage]);
    
    // Send to Atlas via IPC
    try {
      if (window.atlas?.atlas?.sendText) {
        await window.atlas.atlas.sendText(text);
      }
    } catch (error) {
      console.error('Failed to send message:', error);
      // Add error message
      setMessages(prev => [...prev, {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: 'Sorry, I encountered an error. Please try again.',
        timestamp: Date.now(),
      }]);
    }
  }, []);
  
  // Voice control handlers
  const handleStartVoice = useCallback(async () => {
    try {
      if (window.atlas?.atlas?.triggerWake) {
        await window.atlas.atlas.triggerWake();
        setIsVoiceActive(true);
      }
    } catch (error) {
      console.error('Failed to start voice:', error);
    }
  }, []);
  
  const handleStopVoice = useCallback(async () => {
    try {
      // Voice stop is handled automatically by VAD
      setIsVoiceActive(false);
    } catch (error) {
      console.error('Failed to stop voice:', error);
    }
  }, []);
  
  // Click orb to activate voice (in orb mode)
  const handleClickOrb = useCallback(() => {
    handleStartVoice();
  }, [handleStartVoice]);
  
  // Open full view from widget
  const handleOpenFullView = useCallback((view: WidgetType) => {
    setWidgetsPanelOpen(false);
    setFullView(view);
  }, []);
  
  return (
    <div className="dual-mode-app">
      {/* Mode Toggle Controls */}
      <div className="app-controls">
        <div className="mode-toggle">
          <button
            className={`mode-toggle__btn ${mode === 'chat' ? 'mode-toggle__btn--active' : ''}`}
            onClick={() => setMode('chat')}
            aria-label="Chat mode"
            title="Chat mode (Tab)"
          >
            <ChatIcon />
          </button>
          <button
            className={`mode-toggle__btn ${mode === 'orb' ? 'mode-toggle__btn--active' : ''}`}
            onClick={() => setMode('orb')}
            aria-label="Orb mode"
            title="Orb mode (Tab)"
          >
            <OrbIcon />
          </button>
        </div>
      </div>
      
      {/* Widgets Button */}
      <button
        className="widgets-btn"
        onClick={() => setWidgetsPanelOpen(true)}
        aria-label="Open dashboard"
        title="Dashboard (Ctrl+W)"
      >
        <span className="widgets-btn__icon"><GridIcon /></span>
        Dashboard
      </button>
      
      {/* Mode Container */}
      <div className="mode-container">
        {mode === 'chat' ? (
          <div className="mode-view">
            <ChatMode
              orbState={orbState}
              audioLevel={atlasState.audioLevel || 0}
              messages={messages}
              currentTranscript={atlasState.transcript || atlasState.interimTranscript}
              streamingResponse={streamingResponse}
              onSendMessage={handleSendMessage}
              onStartVoice={handleStartVoice}
              onStopVoice={handleStopVoice}
              isVoiceActive={isVoiceActive || orbState === 'listening'}
            />
          </div>
        ) : (
          <div className="mode-view">
            <OrbMode
              orbState={orbState}
              audioLevel={atlasState.audioLevel || 0}
              bass={atlasState.audioLevel ? atlasState.audioLevel * 0.8 : 0}
              treble={atlasState.audioLevel ? atlasState.audioLevel * 0.6 : 0}
              currentTranscript={atlasState.transcript || atlasState.interimTranscript || streamingResponse}
              onClickOrb={handleClickOrb}
            />
          </div>
        )}
      </div>
      
      {/* Widgets Panel */}
      <WidgetsPanel
        isOpen={widgetsPanelOpen}
        onClose={() => setWidgetsPanelOpen(false)}
        onOpenFullView={handleOpenFullView}
        data={widgetData}
      />
      
      {/* Full View Overlay */}
      <FullViewWrapper
        view={fullView}
        onClose={() => setFullView(null)}
      />
    </div>
  );
};

/**
 * Helper: Check if an input element is focused
 */
function isInputFocused(): boolean {
  const active = document.activeElement;
  return active instanceof HTMLInputElement ||
    active instanceof HTMLTextAreaElement ||
    active?.getAttribute('contenteditable') === 'true';
}

/**
 * Helper: Format uptime in human-readable format
 */
function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  
  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  
  return `${minutes}m`;
}

export default DualModeApp;
