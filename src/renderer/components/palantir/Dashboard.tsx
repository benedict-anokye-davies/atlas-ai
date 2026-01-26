/**
 * Atlas Desktop - Main Dashboard Page
 * Palantir-style command center integrating all widgets
 */
import React, { useState, useCallback, useEffect } from 'react';
import { AnimatePresence } from 'framer-motion';
import { OrbWidget, OrbState } from './OrbWidget';
import { FullScreenOrb, TranscriptEntry } from './FullScreenOrb';
import { PortfolioWidget, Position } from './PortfolioWidget';
import { ActivityFeed, FeedItem } from './ActivityFeed';
import { MetricCard } from './MetricCard';
import { SystemHealth, ServiceInfo } from './SystemHealth';
import { TerminalInput } from './TerminalInput';
import { ScanLine } from './effects';
import './Dashboard.css';

// Mock data - replace with real data from stores
const MOCK_POSITIONS: Position[] = [
  { id: 'p1', symbol: 'ETH', side: 'long', entryPrice: 2100, currentPrice: 2209.50, quantity: 1.5, pnl: 340.50, pnlPercent: 5.2 },
  { id: 'p2', symbol: 'SOL', side: 'long', entryPrice: 120, currentPrice: 123.72, quantity: 40, pnl: 125.00, pnlPercent: 3.1 },
  { id: 'p3', symbol: 'BTC', side: 'short', entryPrice: 67000, currentPrice: 68206, quantity: 0.05, pnl: -85.25, pnlPercent: -1.8 },
];

const MOCK_FEED_ITEMS: FeedItem[] = [
  { id: '1', type: 'trade', title: 'Closed ETH position', subtitle: '+£340.50 (5.2%)', timestamp: Date.now() - 1000 * 60 * 5 },
  { id: '2', type: 'atlas', title: 'Atlas completed task', subtitle: 'Analyzed TypeScript errors in project', timestamp: Date.now() - 1000 * 60 * 15 },
  { id: '3', type: 'bank', title: 'Payment received', subtitle: '+£2,500.00 from Client ABC', timestamp: Date.now() - 1000 * 60 * 30 },
  { id: '4', type: 'signal', title: 'New trading signal', subtitle: 'Breakout detected on BTC 4H chart', timestamp: Date.now() - 1000 * 60 * 45 },
  { id: '5', type: 'news', title: 'Rust 2024 Edition Released', subtitle: 'HackerNews - 523 points', timestamp: Date.now() - 1000 * 60 * 60, link: 'https://news.ycombinator.com' },
  { id: '6', type: 'github', title: 'Trending: denoland/deno', subtitle: '+1,234 stars today', timestamp: Date.now() - 1000 * 60 * 90, link: 'https://github.com/denoland/deno' },
  { id: '7', type: 'calendar', title: 'Team standup in 30 mins', subtitle: '10:00 AM - Google Meet', timestamp: Date.now() - 1000 * 60 * 5, link: 'https://meet.google.com' },
  { id: '8', type: 'system', title: 'Memory usage high', subtitle: 'Consider closing unused tabs', timestamp: Date.now() - 1000 * 60 * 120 },
];

const MOCK_SERVICES: ServiceInfo[] = [
  { id: 's1', name: 'Voice Pipeline', status: 'online', latency: 45 },
  { id: 's2', name: 'LLM (Fireworks)', status: 'online', latency: 120 },
  { id: 's3', name: 'TTS (ElevenLabs)', status: 'online', latency: 85 },
  { id: 's4', name: 'STT (Deepgram)', status: 'online', latency: 55 },
  { id: 's5', name: 'Trading Backend', status: 'online', latency: 32 },
  { id: 's6', name: 'Banking (TrueLayer)', status: 'degraded', latency: 350 },
];

export interface DashboardProps {
  className?: string;
}

export const Dashboard: React.FC<DashboardProps> = ({ className }) => {
  // State
  const [orbState, setOrbState] = useState<OrbState>('idle');
  const [audioLevel, setAudioLevel] = useState(0);
  const [isFullScreenOrbOpen, setIsFullScreenOrbOpen] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [portfolioTotal] = useState(24532.80);
  const [dailyPnL] = useState(380.25);
  const [bankBalance] = useState(12450.00);
  const [bankChange] = useState(2500.00);

  // Simulate orb state changes (replace with real voice pipeline integration)
  useEffect(() => {
    // Demo: cycle through states
    const states: OrbState[] = ['idle', 'listening', 'thinking', 'speaking'];
    let index = 0;
    
    const stateInterval = setInterval(() => {
      index = (index + 1) % states.length;
      setOrbState(states[index]);
    }, 5000);

    // Demo: simulate audio level
    const audioInterval = setInterval(() => {
      setAudioLevel(Math.random());
    }, 100);

    return () => {
      clearInterval(stateInterval);
      clearInterval(audioInterval);
    };
  }, []);

  // Handlers
  const handleOrbClick = useCallback(() => {
    if (orbState === 'idle') {
      setOrbState('listening');
      // TODO: Start voice recognition
    }
  }, [orbState]);

  const handleOrbExpand = useCallback(() => {
    setIsFullScreenOrbOpen(true);
  }, []);

  const handleFullScreenClose = useCallback(() => {
    setIsFullScreenOrbOpen(false);
  }, []);

  const handleTextSubmit = useCallback((text: string) => {
    const newEntry: TranscriptEntry = { id: Date.now().toString(), text, type: 'user', timestamp: Date.now() };
    setTranscript(prev => [...prev, newEntry]);
    setOrbState('thinking');
    
    // Simulate response
    setTimeout(() => {
      const responseEntry: TranscriptEntry = { 
        id: (Date.now() + 1).toString(),
        text: "I've received your message. Processing...", 
        type: 'atlas',
        timestamp: Date.now()
      };
      setTranscript(prev => [...prev, responseEntry]);
      setOrbState('speaking');
      
      setTimeout(() => setOrbState('idle'), 2000);
    }, 1500);
  }, []);

  const handleFeedRefresh = useCallback(() => {
    console.log('Refreshing feed...');
    // TODO: Fetch fresh data
  }, []);

  const handlePortfolioClick = useCallback(() => {
    console.log('Navigate to portfolio view');
    // TODO: Navigate or open modal
  }, []);

  return (
    <div className={`dashboard ${className || ''}`}>
      {/* Top Row - Orb + Key Metrics */}
      <div className="dashboard__top-row">
        <OrbWidget
          state={orbState}
          audioLevel={audioLevel}
          onOrbClick={handleOrbClick}
          onExpandClick={handleOrbExpand}
        />
        
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
        
        <SystemHealth services={MOCK_SERVICES} />
      </div>

      {/* Main Content Grid */}
      <div className="dashboard__grid">
        {/* Portfolio Widget - Takes 1 column */}
        <div className="dashboard__widget dashboard__widget--portfolio">
          <PortfolioWidget
            totalValue={portfolioTotal}
            dailyPnL={dailyPnL}
            dailyPnLPercent={1.55}
            positions={MOCK_POSITIONS}
            onViewAll={handlePortfolioClick}
          />
        </div>

        {/* Activity Feed - Takes 2 columns */}
        <div className="dashboard__widget dashboard__widget--feed">
          <ActivityFeed
            items={MOCK_FEED_ITEMS}
            onRefresh={handleFeedRefresh}
          />
        </div>
      </div>

      {/* Terminal Input - Command line at bottom */}
      <div className="dashboard__command-bar">
        <TerminalInput
          onSubmit={handleTextSubmit}
          placeholder="Ask Atlas anything..."
          prefix="λ"
          suggestions={[
            'Show my portfolio',
            'Check bank balance',
            'What is my PnL today?',
            'Search codebase for...',
            'Run backtest on momentum strategy',
          ]}
        />
      </div>

      {/* Full Screen Orb Modal */}
      <AnimatePresence>
        {isFullScreenOrbOpen && (
          <FullScreenOrb
            isOpen={isFullScreenOrbOpen}
            state={orbState}
            audioLevel={audioLevel}
            transcript={transcript}
            onClose={handleFullScreenClose}
            onTextSubmit={handleTextSubmit}
          />
        )}
      </AnimatePresence>

      {/* CRT Scan Line Overlay - Subtle Effect */}
      <div className="dashboard__scan-overlay">
        <ScanLine intensity="subtle" />
      </div>
    </div>
  );
};

export default Dashboard;
