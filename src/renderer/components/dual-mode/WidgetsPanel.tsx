/**
 * @fileoverview Widgets Panel Component
 * Slide-up panel with dashboard widgets, click to expand to full view
 * 
 * @module WidgetsPanel
 */

import React, { useEffect } from 'react';

// Icons as inline SVG
const CloseIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const ChevronRightIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

export type WidgetType = 'trading' | 'banking' | 'intelligence' | 'system' | 'activity';

export interface WidgetData {
  trading?: {
    portfolioValue: number;
    dailyPnL: number;
    dailyPnLPercent: number;
    openPositions: number;
  };
  banking?: {
    totalBalance: number;
    recentTransactions: number;
    budgetUsed: number;
  };
  intelligence?: {
    activeAgents: number;
    alerts: number;
    lastInsight?: string;
  };
  system?: {
    cpu: number;
    memory: number;
    uptime: string;
  };
}

interface WidgetsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenFullView: (view: WidgetType) => void;
  data: WidgetData;
}

/**
 * Formats currency for display
 */
function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

/**
 * Formats percentage for display
 */
function formatPercent(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

/**
 * Slide-up widgets panel with dashboard cards
 */
export const WidgetsPanel: React.FC<WidgetsPanelProps> = ({
  isOpen,
  onClose,
  onOpenFullView,
  data,
}) => {
  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);
  
  if (!isOpen) return null;
  
  const { trading, banking, intelligence, system } = data;
  
  return (
    <>
      {/* Overlay backdrop */}
      <div className="widgets-panel-overlay" onClick={onClose} />
      
      {/* Panel */}
      <div className="widgets-panel">
        <div className="widgets-panel__header">
          <h2 className="widgets-panel__title">Dashboard</h2>
          <button 
            className="widgets-panel__close" 
            onClick={onClose}
            aria-label="Close panel"
          >
            <CloseIcon />
          </button>
        </div>
        
        <div className="widgets-panel__content">
          <div className="widgets-panel__grid">
            {/* Trading Widget */}
            {trading && (
              <div 
                className="widget-card" 
                onClick={() => onOpenFullView('trading')}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && onOpenFullView('trading')}
              >
                <div className="widget-card__header">
                  <span className="widget-card__title">
                    <span className="widget-card__icon">📈</span>
                    Trading
                  </span>
                </div>
                <div className="widget-card__value">{formatCurrency(trading.portfolioValue)}</div>
                <div className={`widget-card__change ${trading.dailyPnL >= 0 ? 'widget-card__change--positive' : 'widget-card__change--negative'}`}>
                  {formatCurrency(trading.dailyPnL)} ({formatPercent(trading.dailyPnLPercent)}) today
                </div>
                <div className="widget-card__details">
                  <div className="widget-card__row">
                    <span className="widget-card__row-label">Open Positions</span>
                    <span className="widget-card__row-value">{trading.openPositions}</span>
                  </div>
                </div>
                <div className="widget-card__expand">
                  Open Trading View <ChevronRightIcon />
                </div>
              </div>
            )}
            
            {/* Banking Widget */}
            {banking && (
              <div 
                className="widget-card" 
                onClick={() => onOpenFullView('banking')}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && onOpenFullView('banking')}
              >
                <div className="widget-card__header">
                  <span className="widget-card__title">
                    <span className="widget-card__icon">🏦</span>
                    Banking
                  </span>
                </div>
                <div className="widget-card__value">{formatCurrency(banking.totalBalance)}</div>
                <div className="widget-card__details">
                  <div className="widget-card__row">
                    <span className="widget-card__row-label">Recent Transactions</span>
                    <span className="widget-card__row-value">{banking.recentTransactions}</span>
                  </div>
                  <div className="widget-card__row">
                    <span className="widget-card__row-label">Budget Used</span>
                    <span className="widget-card__row-value">{banking.budgetUsed}%</span>
                  </div>
                </div>
                <div className="widget-card__expand">
                  Open Banking View <ChevronRightIcon />
                </div>
              </div>
            )}
            
            {/* Intelligence Widget */}
            {intelligence && (
              <div 
                className="widget-card" 
                onClick={() => onOpenFullView('intelligence')}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && onOpenFullView('intelligence')}
              >
                <div className="widget-card__header">
                  <span className="widget-card__title">
                    <span className="widget-card__icon">🧠</span>
                    Intelligence
                  </span>
                </div>
                <div className="widget-card__value">{intelligence.activeAgents} Agents</div>
                {intelligence.alerts > 0 && (
                  <div className="widget-card__change widget-card__change--negative">
                    {intelligence.alerts} alert{intelligence.alerts !== 1 ? 's' : ''} pending
                  </div>
                )}
                {intelligence.lastInsight && (
                  <div className="widget-card__details">
                    <div className="widget-card__row">
                      <span className="widget-card__row-label">Latest Insight</span>
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--dm-text-secondary)', marginTop: 4 }}>
                      {intelligence.lastInsight}
                    </div>
                  </div>
                )}
                <div className="widget-card__expand">
                  Open Intelligence View <ChevronRightIcon />
                </div>
              </div>
            )}
            
            {/* System Widget */}
            {system && (
              <div 
                className="widget-card" 
                onClick={() => onOpenFullView('system')}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && onOpenFullView('system')}
              >
                <div className="widget-card__header">
                  <span className="widget-card__title">
                    <span className="widget-card__icon">⚙️</span>
                    System
                  </span>
                </div>
                <div className="widget-card__value">Healthy</div>
                <div className="widget-card__details">
                  <div className="widget-card__row">
                    <span className="widget-card__row-label">CPU</span>
                    <span className="widget-card__row-value">{system.cpu}%</span>
                  </div>
                  <div className="widget-card__row">
                    <span className="widget-card__row-label">Memory</span>
                    <span className="widget-card__row-value">{system.memory}%</span>
                  </div>
                  <div className="widget-card__row">
                    <span className="widget-card__row-label">Uptime</span>
                    <span className="widget-card__row-value">{system.uptime}</span>
                  </div>
                </div>
                <div className="widget-card__expand">
                  Open System View <ChevronRightIcon />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

export default WidgetsPanel;
