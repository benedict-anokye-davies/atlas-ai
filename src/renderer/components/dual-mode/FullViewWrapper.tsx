/**
 * @fileoverview Full View Wrapper Component
 * Modal wrapper for full Palantir views (Trading, Banking, Intelligence)
 * 
 * @module FullViewWrapper
 */

import React, { Suspense } from 'react';
import type { WidgetType } from './WidgetsPanel';

// Lazy load heavy Palantir views
const TradingView = React.lazy(() => 
  import('../palantir/TradingView').then(m => ({ default: m.TradingView }))
);
const BankingView = React.lazy(() => 
  import('../palantir/BankingView').then(m => ({ default: m.BankingView }))
);
const IntelligenceView = React.lazy(() => 
  import('../palantir/IntelligenceView').then(m => ({ default: m.IntelligenceView }))
);

// Icons
const ArrowLeftIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="19" y1="12" x2="5" y2="12" />
    <polyline points="12 19 5 12 12 5" />
  </svg>
);

interface FullViewWrapperProps {
  view: WidgetType | null;
  onClose: () => void;
}

/**
 * Gets the display title for a view type
 */
function getViewTitle(view: WidgetType): string {
  switch (view) {
    case 'trading': return 'Trading';
    case 'banking': return 'Banking';
    case 'intelligence': return 'Intelligence';
    case 'system': return 'System';
    case 'activity': return 'Activity';
    default: return 'View';
  }
}

/**
 * Loading fallback for views
 */
const ViewLoading: React.FC = () => (
  <div style={{
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    color: 'var(--dm-text-muted)',
  }}>
    Loading...
  </div>
);

/**
 * Full-screen wrapper for Palantir views
 * Provides header with back button and renders the appropriate view
 */
export const FullViewWrapper: React.FC<FullViewWrapperProps> = ({
  view,
  onClose,
}) => {
  if (!view) return null;
  
  // Placeholder data for views (would come from state/IPC in real implementation)
  const tradingData = {
    portfolioTotal: 24650,
    dailyPnL: 340,
    positions: [
      { id: '1', symbol: 'ETH-USD', side: 'long' as const, entryPrice: 3200, currentPrice: 3350, quantity: 2.5, pnl: 375, pnlPercent: 4.7 },
      { id: '2', symbol: 'SOL-USD', side: 'long' as const, entryPrice: 120, currentPrice: 135, quantity: 50, pnl: 750, pnlPercent: 12.5 },
      { id: '3', symbol: 'BTC-USD', side: 'short' as const, entryPrice: 45000, currentPrice: 44500, quantity: 0.1, pnl: 50, pnlPercent: 1.1 },
    ],
  };
  
  const bankingData = {
    bankBalance: 8450,
    bankChange: 2.3,
  };
  
  const renderView = () => {
    switch (view) {
      case 'trading':
        return (
          <Suspense fallback={<ViewLoading />}>
            <TradingView 
              portfolioTotal={tradingData.portfolioTotal}
              dailyPnL={tradingData.dailyPnL}
              positions={tradingData.positions}
            />
          </Suspense>
        );
      case 'banking':
        return (
          <Suspense fallback={<ViewLoading />}>
            <BankingView 
              bankBalance={bankingData.bankBalance}
              bankChange={bankingData.bankChange}
            />
          </Suspense>
        );
      case 'intelligence':
        return (
          <Suspense fallback={<ViewLoading />}>
            <IntelligenceView />
          </Suspense>
        );
      case 'system':
        // System view placeholder - could use existing SystemHealth component
        return (
          <div style={{ padding: 'var(--dm-spacing-lg)' }}>
            <p>System monitoring view coming soon.</p>
          </div>
        );
      case 'activity':
        // Activity view placeholder
        return (
          <div style={{ padding: 'var(--dm-spacing-lg)' }}>
            <p>Activity feed coming soon.</p>
          </div>
        );
      default:
        return null;
    }
  };
  
  return (
    <div className="full-view-overlay">
      <div className="full-view__header">
        <button className="full-view__back" onClick={onClose}>
          <ArrowLeftIcon />
          Back
        </button>
        <h1 className="full-view__title">{getViewTitle(view)}</h1>
        <div style={{ width: 80 }} /> {/* Spacer for centering */}
      </div>
      <div className="full-view__content">
        {renderView()}
      </div>
    </div>
  );
};

export default FullViewWrapper;
