import React from 'react';
import './BankingView.css';

interface BankingViewProps {
  bankBalance: number;
  bankChange: number;
}

export const BankingView: React.FC<BankingViewProps> = ({ bankBalance, bankChange }) => {

  // Placeholder data for high-fidelity look
  const recentTransactions = [
    { id: 1, date: '2026-01-22', text: 'AWS EMEA S.A.R.L', amount: -142.50, category: 'INFRASTRUCTURE' },
    { id: 2, date: '2026-01-21', text: 'ANTHROPIC API', amount: -45.00, category: 'AI_SERVICES' },
    { id: 3, date: '2026-01-21', text: 'GITHUB*PRO', amount: -4.00, category: 'SOFTWARE' },
    { id: 4, date: '2026-01-20', text: 'CLIENT_PAYMENT_REF_882', amount: 2500.00, category: 'INCOME' },
    { id: 5, date: '2026-01-19', text: 'UBER *TRIP 2841', amount: -18.45, category: 'TRANSPORT' },
  ];

  return (
    <div className="pt-banking-view">
      <div className="pt-banking-grid">
        
        {/* Main Balance Card - Top Left */}
        <div className="pt-tech-card pt-balance-card">
          <div className="pt-card-header">
             <span className="pt-icon-bracket">[</span>
             LIQUIDITY_STATUS
             <span className="pt-icon-bracket">]</span>
          </div>
          <div className="pt-balance-content">
             <div className="pt-balance-label">TOTAL_AVAILABLE_FUNDS</div>
             <div className="pt-balance-huge pt-mono">
                £{bankBalance.toLocaleString('en-GB', { minimumFractionDigits: 2 })}
             </div>
             <div className={`pt-balance-change pt-mono ${bankChange >= 0 ? 'pt-positive' : 'pt-negative'}`}>
                {bankChange >= 0 ? '▲' : '▼'} £{Math.abs(bankChange).toFixed(2)} (24H)
             </div>
          </div>
        </div>

        {/* Analytics/Spend Card - Top Right */}
        <div className="pt-tech-card pt-spend-card">
          <div className="pt-card-header">
             <span className="pt-icon-bracket">[</span>
             CAPITAL_OUTFLOW
             <span className="pt-icon-bracket">]</span>
          </div>
          <div className="pt-spend-grid">
             <div className="pt-spend-metric">
                <div className="pt-label">MONTH_TO_DATE</div>
                <div className="pt-value pt-mono">£1,245.30</div>
                <div className="pt-bar"><div className="pt-fill" style={{ width: '45%' }}></div></div>
             </div>
             <div className="pt-spend-metric">
                <div className="pt-label">PROJECTED</div>
                <div className="pt-value pt-mono">£2,100.00</div>
                <div className="pt-bar"><div className="pt-fill warning" style={{ width: '65%' }}></div></div>
             </div>
          </div>
        </div>

        {/* Transaction Ledger - Bottom Splitting */}
        <div className="pt-tech-card pt-ledger-panel">
          <div className="pt-card-header">
             <span className="pt-icon-bracket">[</span>
             TRANSACTION_LEDGER
             <span className="pt-icon-bracket">]</span>
             <div className="pt-header-controls">
                <button className="pt-control-btn active">ALL</button>
                <button className="pt-control-btn">IN</button>
                <button className="pt-control-btn">OUT</button>
             </div>
          </div>
           <div className="pt-card-content pt-no-padding">
              <table className="pt-data-table">
                 <thead>
                    <tr>
                       <th>DATE</th>
                       <th>DESCRIPTION</th>
                       <th>CATEGORY</th>
                       <th className="pt-text-right">AMOUNT</th>
                    </tr>
                 </thead>
                 <tbody>
                    {recentTransactions.map(tx => (
                       <tr key={tx.id}>
                          <td className="pt-mono pt-text-muted">{tx.date}</td>
                          <td className="pt-mono">{tx.text}</td>
                          <td className="pt-mono"><span className="pt-tag">{tx.category}</span></td>
                          <td className={`pt-text-right pt-mono ${tx.amount > 0 ? 'pt-positive' : ''}`}>
                             {tx.amount > 0 ? '+' : ''}£{Math.abs(tx.amount).toFixed(2)}
                          </td>
                       </tr>
                    ))}
                 </tbody>
              </table>
           </div>
        </div>

      </div>
    </div>
  );
};
