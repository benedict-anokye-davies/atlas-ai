/**
 * Atlas Desktop - Palantir-Style UI Components
 * Export barrel for all command center components
 */

// Layout Components
export { AppShell } from './AppShell';
export type { AppShellProps } from './AppShell';

export { Header } from './Header';
export type { HeaderProps } from './Header';

export { LeftNav } from './LeftNav';
export type { LeftNavProps, NavItem, ViewId } from './LeftNav';

export { StatusBar } from './StatusBar';
export type { StatusBarProps, ConnectionStatus, VoiceState } from './StatusBar';

// Orb Components
export { OrbWidget } from './OrbWidget';
export type { OrbWidgetProps, OrbState } from './OrbWidget';

export { AsciiOrb } from './AsciiOrb';
export type { AsciiOrbState } from './AsciiOrb';

export { FullScreenOrb } from './FullScreenOrb';
export type { FullScreenOrbProps, SuggestedCommand, TranscriptEntry } from './FullScreenOrb';

// Widget Components
export { PortfolioWidget } from './PortfolioWidget';
export type { PortfolioWidgetProps, Position } from './PortfolioWidget';

export { ActivityFeed } from './ActivityFeed';
export type { ActivityFeedProps, FeedItem, FeedItemType } from './ActivityFeed';

export { MetricCard } from './MetricCard';
export type { MetricCardProps } from './MetricCard';

export { SystemHealth } from './SystemHealth';
export type { SystemHealthProps, ServiceInfo, ServiceStatus } from './SystemHealth';

export { MiniChart } from './MiniChart';
export { TerminalInput } from './TerminalInput';
export { StatusBadge } from './StatusBadge';

// Page Components
export { Dashboard } from './Dashboard';
export type { DashboardProps } from './Dashboard';

export { TradingView } from './TradingView';
export { BankingView } from './BankingView';
export { IntelligenceView } from './IntelligenceView';

// Boot Screen
export { BootScreen } from './BootScreen';
export type { BootScreenProps } from './BootScreen';

// Visual Effects
export { GlitchText, TypewriterText, DataStream, ScanLine } from './effects';

// Re-export theme CSS path for consumers
// Usage: import 'components/palantir/theme'
// Note: Consumers should import './palantir-theme.css' from styles folder
