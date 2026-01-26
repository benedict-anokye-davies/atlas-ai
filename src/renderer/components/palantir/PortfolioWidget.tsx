/**
 * Atlas Desktop - Portfolio Summary Widget
 * Compact portfolio overview with positions
 */
import React from 'react';
import { motion } from 'framer-motion';
import './PortfolioWidget.css';

export interface Position {
  id: string;
  symbol: string;
  side: 'long' | 'short';
  entryPrice: number;
  currentPrice: number;
  quantity: number;
  pnl: number;
  pnlPercent: number;
}

export interface PortfolioWidgetProps {
  totalValue: number;
  dailyPnL: number;
  dailyPnLPercent: number;
  positions: Position[];
  currency?: string;
  onPositionClick?: (position: Position) => void;
  onViewAll?: () => void;
}

const formatCurrency = (value: number, currency = '£'): string => {
  const absValue = Math.abs(value);
  if (absValue >= 1000000) {
    return `${currency}${(value / 1000000).toFixed(2)}M`;
  }
  if (absValue >= 1000) {
    return `${currency}${(value / 1000).toFixed(1)}k`;
  }
  return `${currency}${value.toFixed(2)}`;
};

const formatPnL = (value: number, currency = '£'): string => {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${formatCurrency(value, currency)}`;
};

const formatPercent = (value: number): string => {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
};

export const PortfolioWidget: React.FC<PortfolioWidgetProps> = ({
  totalValue,
  dailyPnL,
  dailyPnLPercent,
  positions,
  currency = '£',
  onPositionClick,
  onViewAll,
}) => {
  const isPositive = dailyPnL >= 0;

  return (
    <div className="portfolio-widget">
      {/* Header */}
      <div className="portfolio-widget__header">
        <div className="portfolio-widget__title-row pt-tech-header" style={{ marginBottom: 0, paddingBottom: 0, borderBottom: 'none' }}>
          <span className="portfolio-widget__title">PORTFOLIO_STATUS</span>
          <span className={`portfolio-widget__daily-pnl ${isPositive ? 'positive' : 'negative'} pt-tech-value`} style={{ marginLeft: 'auto' }}>
            {formatPnL(dailyPnL, currency)}
          </span>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="portfolio-widget__summary">
        <div className="portfolio-widget__total">
          <span className="portfolio-widget__total-label">Total Value</span>
          <span className="portfolio-widget__total-value">
            {formatCurrency(totalValue, currency)}
          </span>
        </div>
        <div className="portfolio-widget__change">
          <span className="portfolio-widget__change-label">Today</span>
          <span className={`portfolio-widget__change-value ${isPositive ? 'positive' : 'negative'}`}>
            {formatPercent(dailyPnLPercent)}
          </span>
        </div>
      </div>

      {/* Positions Table */}
      <div className="portfolio-widget__positions">
        <table className="portfolio-widget__table">
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Side</th>
              <th className="text-right">P&L</th>
              <th className="text-right">%</th>
            </tr>
          </thead>
          <tbody>
            {positions.slice(0, 5).map((position, index) => (
              <motion.tr
                key={position.id}
                className="portfolio-widget__position"
                onClick={() => onPositionClick?.(position)}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.05 }}
                whileHover={{ backgroundColor: 'var(--atlas-bg-hover)' }}
              >
                <td className="portfolio-widget__symbol">{position.symbol}</td>
                <td>
                  <span className={`portfolio-widget__side portfolio-widget__side--${position.side}`}>
                    {position.side}
                  </span>
                </td>
                <td className={`text-right ${position.pnl >= 0 ? 'positive' : 'negative'}`}>
                  {formatPnL(position.pnl, currency)}
                </td>
                <td className={`text-right ${position.pnlPercent >= 0 ? 'positive' : 'negative'}`}>
                  {formatPercent(position.pnlPercent)}
                </td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      {(positions.length > 5 || onViewAll) && (
        <div className="portfolio-widget__footer">
          <button className="portfolio-widget__view-all" onClick={onViewAll}>
            View all {positions.length} positions →
          </button>
        </div>
      )}
    </div>
  );
};

export default PortfolioWidget;
