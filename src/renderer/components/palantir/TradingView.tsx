import React, { useState } from 'react';
import './TradingView.css';

interface TradingViewProps {
  portfolioTotal: number;
  dailyPnL: number;
  positions: Position[];
}

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

export const TradingView: React.FC<TradingViewProps> = ({ portfolioTotal, dailyPnL, positions }) => {
  const [activeTab, setActiveTab] = useState<'chart' | 'orders'>('chart');
  const [selectedSymbol, setSelectedSymbol] = useState<string>('ETH-USD');

  return (
    <div className="pt-trading-view">
      <div className="pt-trading-grid">
        {/* LEFT COLUMN: Symbol List / Watchlist */}
        <div className="pt-tech-card pt-watchlist-panel">
          <div className="pt-card-header">
            <span className="pt-icon-bracket">[</span>
            MARKET_AWARENESS
            <span className="pt-icon-bracket">]</span>
          </div>
          <div className="pt-card-content pt-no-padding">
            <table className="pt-data-table">
              <thead>
                <tr>
                  <th>SYM</th>
                  <th className="pt-text-right">PRICE</th>
                  <th className="pt-text-right">%</th>
                </tr>
              </thead>
              <tbody>
                {['BTC-USD', 'ETH-USD', 'SOL-USD', 'TSLA', 'NVDA', 'GBP-USD'].map((sym) => (
                  <tr 
                    key={sym} 
                    className={selectedSymbol === sym ? 'pt-active-row' : ''}
                    onClick={() => setSelectedSymbol(sym)}
                  >
                    <td className="pt-mono">{sym}</td>
                    <td className="pt-mono pt-text-right">--.--</td>
                    <td className="pt-mono pt-text-right pt-positive">+0.00%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* MIDDLE: Main Chart Area */}
        <div className="pt-tech-card pt-chart-panel">
          <div className="pt-card-header">
            <span className="pt-icon-bracket">[</span>
            PRICE_ACTION :: {selectedSymbol}
            <span className="pt-icon-bracket">]</span>
            <div className="pt-header-controls">
              <button 
                className={`pt-control-btn ${activeTab === 'chart' ? 'active' : ''}`}
                onClick={() => setActiveTab('chart')}
              >
                CHART
              </button>
              <button 
                className={`pt-control-btn ${activeTab === 'orders' ? 'active' : ''}`}
                onClick={() => setActiveTab('orders')}
              >
                DEPTH
              </button>
            </div>
          </div>
          <div className="pt-card-content pt-chart-container">
            {/* Placeholder for high-tech chart */}
            <div className="pt-chart-placeholder">
              <div className="pt-grid-lines"></div>
              <div className="pt-chart-overlay">
                <div className="pt-chart-value pt-mono">
                  CURRENT_PRICE: <span className="pt-highlight">£0.00</span>
                </div>
                <div className="pt-chart-status">LIVE FEED :: ONLINE</div>
              </div>
            </div>
            
            {/* Order Entry Form Overlay */}
            <div className="pt-order-entry">
              <div className="pt-order-header">EXECUTION</div>
              <div className="pt-order-grid">
                <button className="pt-btn-buy">BUY</button>
                <button className="pt-btn-sell">SELL</button>
                <input type="number" className="pt-input" placeholder="SIZE" />
                <input type="number" className="pt-input" placeholder="LIMIT" />
              </div>
              <button className="pt-btn-submit">SUBMIT_ORDER</button>
            </div>
          </div>
        </div>

        {/* RIGHT: Portfolio Summary */}
        <div className="pt-tech-card pt-account-panel">
           <div className="pt-card-header">
            <span className="pt-icon-bracket">[</span>
            CAPITAL_ALLOCATION
            <span className="pt-icon-bracket">]</span>
          </div>
          <div className="pt-card-content">
             <div className="pt-metric-row">
                <span className="pt-label">EQUITY</span>
                <span className="pt-value pt-mono">£{portfolioTotal.toLocaleString('en-GB', { minimumFractionDigits: 2 })}</span>
             </div>
             <div className="pt-metric-row">
                <span className="pt-label">DAY_PNL</span>
                <span className={`pt-value pt-mono ${dailyPnL >= 0 ? 'pt-positive' : 'pt-negative'}`}>
                  {dailyPnL >= 0 ? '+' : ''}£{dailyPnL.toLocaleString('en-GB', { minimumFractionDigits: 2 })}
                </span>
             </div>
             <div className="pt-metric-row">
                <span className="pt-label">MARGIN_USED</span>
                <span className="pt-value pt-mono">12.4%</span>
             </div>
             <div className="pt-metric-row">
                <span className="pt-label">BUYING_POWER</span>
                <span className="pt-value pt-mono">£4,250.00</span>
             </div>
          </div>
        </div>

        {/* BOTTOM: Positions Table */}
        <div className="pt-tech-card pt-positions-panel">
          <div className="pt-card-header">
            <span className="pt-icon-bracket">[</span>
            OPEN_POSITIONS
            <span className="pt-icon-bracket">]</span>
          </div>
          <div className="pt-card-content pt-no-padding">
             {positions.length === 0 ? (
               <div className="pt-empty-state">NO_ACTIVE_POSITIONS</div>
             ) : (
               <table className="pt-data-table">
                <thead>
                  <tr>
                    <th>SIDE</th>
                    <th>SYMBOL</th>
                    <th className="pt-text-right">SIZE</th>
                    <th className="pt-text-right">ENTRY</th>
                    <th className="pt-text-right">MARK</th>
                    <th className="pt-text-right">PNL</th>
                    <th className="pt-text-right">%</th>
                  </tr>
                </thead>
                <tbody>
                  {positions.map((pos) => (
                    <tr key={pos.id}>
                      <td className={`pt-mono ${pos.side === 'long' ? 'pt-positive' : 'pt-negative'}`}>
                        {pos.side.toUpperCase()}
                      </td>
                      <td className="pt-mono">{pos.symbol}</td>
                      <td className="pt-text-right pt-mono">{pos.quantity}</td>
                      <td className="pt-text-right pt-mono">{pos.entryPrice}</td>
                      <td className="pt-text-right pt-mono">{pos.currentPrice}</td>
                      <td className={`pt-text-right pt-mono ${pos.pnl >= 0 ? 'pt-positive' : 'pt-negative'}`}>
                        {pos.pnl >= 0 ? '+' : ''}{pos.pnl.toFixed(2)}
                      </td>
                      <td className={`pt-text-right pt-mono ${pos.pnlPercent >= 0 ? 'pt-positive' : 'pt-negative'}`}>
                        {pos.pnlPercent >= 0 ? '+' : ''}{pos.pnlPercent.toFixed(2)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
               </table>
             )}
          </div>
        </div>
      </div>
    </div>
  );
};
