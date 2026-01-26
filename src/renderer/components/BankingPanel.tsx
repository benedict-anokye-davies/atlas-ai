/**
 * Atlas Banking Panel
 *
 * UI component for managing bank connections, viewing balances,
 * and making payments. Supports UK banks via TrueLayer.
 */

import React, { useState, useEffect, useCallback } from 'react';
import './BankingPanel.css';

// Types
interface BankAccount {
  id: string;
  institutionId: string;
  name: string;
  officialName?: string;
  type: string;
  mask?: string;
  currentBalance: number;
  availableBalance?: number;
  currency: string;
  isPrimary: boolean;
  nickname?: string;
}

interface BankInstitution {
  id: string;
  name: string;
  logo?: string;
  primaryColor?: string;
  status: 'connected' | 'disconnected' | 'error' | 'pending';
  lastSync?: Date;
  error?: string;
}

interface BalanceSummary {
  totalBalance: number;
  totalAvailable: number;
  totalDebt: number;
  netWorth: number;
}

interface SpendingLimits {
  daily: { spent: number; limit: number; remaining: number };
  weekly: { spent: number; limit: number; remaining: number };
  monthly: { spent: number; limit: number; remaining: number };
}

interface Transaction {
  id: string;
  accountId: string;
  amount: number;
  currency: string;
  date: string;
  name: string;
  merchantName?: string;
  category?: { primary: string };
  status: string;
}

interface PaymentRequest {
  id: string;
  recipient: { name: string };
  amount: number;
  currency: string;
  status: string;
  description: string;
  createdAt: string;
  confirmationCode?: string;
}

// Get banking API from window
/* eslint-disable @typescript-eslint/no-explicit-any */
const getBankingApi = () => (window as any).atlas?.banking;
const getIpcRenderer = () => (window as any).atlas?.invoke || (window as any).electron?.ipcRenderer?.invoke;
/* eslint-enable @typescript-eslint/no-explicit-any */

// Helper to call banking API
async function callBankingApi<T>(method: string, ...args: unknown[]): Promise<T | null> {
  try {
    const banking = getBankingApi();
    if (banking && typeof banking[method] === 'function') {
      const result = await banking[method](...args);
      if (result?.success) {
        return result.data;
      }
      throw new Error(result?.error || 'API call failed');
    }
    
    // Fallback to direct IPC
    const invoke = getIpcRenderer();
    if (invoke) {
      const result = await invoke(`banking:${method}`, ...args);
      if (result?.success) {
        return result.data;
      }
      throw new Error(result?.error || 'IPC call failed');
    }
    
    return null;
  } catch (err) {
    console.error(`Banking API error (${method}):`, err);
    throw err;
  }
}

export const BankingPanel: React.FC<{ onClose?: () => void }> = ({ onClose }) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'accounts' | 'payments' | 'settings'>('overview');
  const [institutions, setInstitutions] = useState<BankInstitution[]>([]);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [balanceSummary, setBalanceSummary] = useState<BalanceSummary | null>(null);
  const [spendingLimits, setSpendingLimits] = useState<SpendingLimits | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [pendingPayments, setPendingPayments] = useState<PaymentRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  // Payment form state
  const [paymentForm, setPaymentForm] = useState({
    recipientName: '',
    sortCode: '',
    accountNumber: '',
    amount: '',
    reference: '',
  });
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [paymentSuccess, setPaymentSuccess] = useState<string | null>(null);

  // PIN setup state
  const [showPinSetup, setShowPinSetup] = useState(false);
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [hasPin, setHasPin] = useState(false);

  // Load data
  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Check if banking API is available
      const banking = getBankingApi();
      const invoke = getIpcRenderer();
      
      if (!banking && !invoke) {
        setError('Banking API not available. Make sure the app is properly initialized.');
        setLoading(false);
        return;
      }

      // Load all data in parallel
      const results = await Promise.allSettled([
        callBankingApi<BankInstitution[]>('getConnectedInstitutions'),
        callBankingApi<BankAccount[]>('getAccounts'),
        callBankingApi<BalanceSummary>('getBalanceSummary'),
        callBankingApi<SpendingLimits>('getSpendingLimits'),
        callBankingApi<Transaction[]>('getTransactions', { limit: 20 }),
        callBankingApi<PaymentRequest[]>('getPendingPayments'),
        callBankingApi<{ hasPin: boolean }>('hasPin'),
      ]);

      // Process results safely
      if (results[0].status === 'fulfilled' && results[0].value) {
        setInstitutions(results[0].value);
      }
      if (results[1].status === 'fulfilled' && results[1].value) {
        setAccounts(results[1].value);
      }
      if (results[2].status === 'fulfilled' && results[2].value) {
        setBalanceSummary(results[2].value);
      }
      if (results[3].status === 'fulfilled' && results[3].value) {
        setSpendingLimits(results[3].value);
      }
      if (results[4].status === 'fulfilled' && results[4].value) {
        setTransactions(results[4].value);
      }
      if (results[5].status === 'fulfilled' && results[5].value) {
        setPendingPayments(results[5].value);
      }
      if (results[6].status === 'fulfilled' && results[6].value) {
        setHasPin((results[6].value as { hasPin: boolean }).hasPin);
      }
    } catch (err) {
      console.error('Failed to load banking data:', err);
      setError('Failed to load banking data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Connect bank (TrueLayer for UK)
  const connectBank = async () => {
    setConnecting(true);
    setError(null);

    try {
      const state = `atlas_${Date.now()}`;
      const result = await (window as any).atlas?.ipcRenderer?.invoke('banking:get-truelayer-auth-url', state);

      if (!result?.success) {
        throw new Error(result?.error || 'Failed to get authorization URL');
      }

      // Open in external browser
      await (window as any).atlas?.ipcRenderer?.invoke('banking:open-bank-auth', result.data.authUrl);

      // Note: In a real implementation, you'd set up a local server to handle the callback
      // For now, show instructions
      setError('Complete the authorization in your browser. Then refresh this panel.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setConnecting(false);
    }
  };

  // Disconnect bank
  const disconnectBank = async (institutionId: string) => {
    if (!confirm('Are you sure you want to disconnect this bank?')) return;

    try {
      await (window as any).atlas?.ipcRenderer?.invoke('banking:disconnect-institution', institutionId);
      await loadData();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  // Sync bank
  const syncBank = async (institutionId: string) => {
    try {
      await (window as any).atlas?.ipcRenderer?.invoke('banking:sync-institution', institutionId);
      await loadData();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  // Make payment
  const makePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    setPaymentError(null);
    setPaymentSuccess(null);

    try {
      const amount = parseFloat(paymentForm.amount);
      if (isNaN(amount) || amount <= 0) {
        throw new Error('Please enter a valid amount');
      }

      const result = await (window as any).atlas?.ipcRenderer?.invoke('banking:initiate-uk-payment', {
        amount,
        recipientName: paymentForm.recipientName,
        sortCode: paymentForm.sortCode.replace(/-/g, ''),
        accountNumber: paymentForm.accountNumber,
        reference: paymentForm.reference || 'Atlas Payment',
      });

      if (!result?.success) {
        throw new Error(result?.error || 'Payment failed');
      }

      setPaymentSuccess(`Payment initiated! Complete authorization in your banking app.`);
      setPaymentForm({ recipientName: '', sortCode: '', accountNumber: '', amount: '', reference: '' });
      await loadData();
    } catch (err) {
      setPaymentError((err as Error).message);
    }
  };

  // Set PIN
  const setupPin = async () => {
    if (pin.length < 4) {
      setError('PIN must be at least 4 digits');
      return;
    }
    if (pin !== confirmPin) {
      setError('PINs do not match');
      return;
    }

    try {
      await (window as any).atlas?.ipcRenderer?.invoke('banking:set-pin', pin);
      setHasPin(true);
      setShowPinSetup(false);
      setPin('');
      setConfirmPin('');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  // Format currency
  const formatCurrency = (amount: number, currency = 'GBP') => {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency,
    }).format(amount);
  };

  // Format date
  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  };

  if (loading) {
    return (
      <div className="banking-panel">
        <div className="banking-loading">
          <div className="loading-spinner" />
          <p>Loading banking data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="banking-panel">
      <div className="banking-header">
        <h2>Banking</h2>
        <div className="banking-header-actions">
          <button onClick={loadData} className="refresh-btn" title="Refresh">
            <RefreshIcon />
          </button>
          {onClose && (
            <button onClick={onClose} className="close-btn">
              <CloseIcon />
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="banking-error">
          <span>{error}</span>
          <button onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      <div className="banking-tabs">
        <button
          className={activeTab === 'overview' ? 'active' : ''}
          onClick={() => setActiveTab('overview')}
        >
          Overview
        </button>
        <button
          className={activeTab === 'accounts' ? 'active' : ''}
          onClick={() => setActiveTab('accounts')}
        >
          Accounts
        </button>
        <button
          className={activeTab === 'payments' ? 'active' : ''}
          onClick={() => setActiveTab('payments')}
        >
          Payments
        </button>
        <button
          className={activeTab === 'settings' ? 'active' : ''}
          onClick={() => setActiveTab('settings')}
        >
          Settings
        </button>
      </div>

      <div className="banking-content">
        {/* Overview Tab */}
        {activeTab === 'overview' && (
          <div className="overview-tab">
            {institutions.length === 0 ? (
              <div className="no-banks">
                <BankIcon className="no-banks-icon" />
                <h3>No Banks Connected</h3>
                <p>Connect your UK bank account to get started</p>
                <button
                  onClick={connectBank}
                  disabled={connecting}
                  className="connect-bank-btn"
                >
                  {connecting ? 'Connecting...' : 'Connect Bank (UK)'}
                </button>
              </div>
            ) : (
              <>
                {/* Balance Summary */}
                {balanceSummary && (
                  <div className="balance-summary">
                    <div className="balance-card primary">
                      <span className="balance-label">Total Balance</span>
                      <span className="balance-value">
                        {formatCurrency(balanceSummary.totalBalance)}
                      </span>
                    </div>
                    <div className="balance-card">
                      <span className="balance-label">Available</span>
                      <span className="balance-value">
                        {formatCurrency(balanceSummary.totalAvailable)}
                      </span>
                    </div>
                    <div className="balance-card debt">
                      <span className="balance-label">Credit/Debt</span>
                      <span className="balance-value">
                        {formatCurrency(balanceSummary.totalDebt)}
                      </span>
                    </div>
                    <div className="balance-card net">
                      <span className="balance-label">Net Worth</span>
                      <span className="balance-value">
                        {formatCurrency(balanceSummary.netWorth)}
                      </span>
                    </div>
                  </div>
                )}

                {/* Spending Limits */}
                {spendingLimits && (
                  <div className="spending-limits">
                    <h3>Spending Limits</h3>
                    <div className="limit-bars">
                      <div className="limit-item">
                        <div className="limit-header">
                          <span>Daily</span>
                          <span>
                            {formatCurrency(spendingLimits.daily.spent)} /{' '}
                            {formatCurrency(spendingLimits.daily.limit)}
                          </span>
                        </div>
                        <div className="limit-bar">
                          <div
                            className="limit-fill"
                            style={{
                              width: `${Math.min(100, (spendingLimits.daily.spent / spendingLimits.daily.limit) * 100)}%`,
                            }}
                          />
                        </div>
                      </div>
                      <div className="limit-item">
                        <div className="limit-header">
                          <span>Weekly</span>
                          <span>
                            {formatCurrency(spendingLimits.weekly.spent)} /{' '}
                            {formatCurrency(spendingLimits.weekly.limit)}
                          </span>
                        </div>
                        <div className="limit-bar">
                          <div
                            className="limit-fill"
                            style={{
                              width: `${Math.min(100, (spendingLimits.weekly.spent / spendingLimits.weekly.limit) * 100)}%`,
                            }}
                          />
                        </div>
                      </div>
                      <div className="limit-item">
                        <div className="limit-header">
                          <span>Monthly</span>
                          <span>
                            {formatCurrency(spendingLimits.monthly.spent)} /{' '}
                            {formatCurrency(spendingLimits.monthly.limit)}
                          </span>
                        </div>
                        <div className="limit-bar">
                          <div
                            className="limit-fill"
                            style={{
                              width: `${Math.min(100, (spendingLimits.monthly.spent / spendingLimits.monthly.limit) * 100)}%`,
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Recent Transactions */}
                <div className="recent-transactions">
                  <h3>Recent Transactions</h3>
                  {transactions.length === 0 ? (
                    <p className="no-data">No recent transactions</p>
                  ) : (
                    <div className="transaction-list">
                      {transactions.slice(0, 10).map((tx) => (
                        <div key={tx.id} className="transaction-item">
                          <div className="tx-info">
                            <span className="tx-name">{tx.merchantName || tx.name}</span>
                            <span className="tx-category">{tx.category?.primary || 'Other'}</span>
                          </div>
                          <div className="tx-details">
                            <span className={`tx-amount ${tx.amount < 0 ? 'debit' : 'credit'}`}>
                              {formatCurrency(tx.amount, tx.currency)}
                            </span>
                            <span className="tx-date">{formatDate(tx.date)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* Accounts Tab */}
        {activeTab === 'accounts' && (
          <div className="accounts-tab">
            <div className="accounts-header">
              <h3>Connected Banks</h3>
              <button onClick={connectBank} disabled={connecting} className="add-bank-btn">
                + Add Bank
              </button>
            </div>

            {institutions.map((inst) => (
              <div key={inst.id} className="institution-card">
                <div className="institution-header">
                  {inst.logo ? (
                    <img src={inst.logo} alt={inst.name} className="institution-logo" />
                  ) : (
                    <div
                      className="institution-logo placeholder"
                      style={{ backgroundColor: inst.primaryColor || '#1a73e8' }}
                    >
                      {inst.name[0]}
                    </div>
                  )}
                  <div className="institution-info">
                    <h4>{inst.name}</h4>
                    <span className={`status ${inst.status}`}>{inst.status}</span>
                  </div>
                  <div className="institution-actions">
                    <button onClick={() => syncBank(inst.id)} title="Sync">
                      <RefreshIcon />
                    </button>
                    <button onClick={() => disconnectBank(inst.id)} title="Disconnect">
                      <CloseIcon />
                    </button>
                  </div>
                </div>

                <div className="institution-accounts">
                  {accounts
                    .filter((acc) => acc.institutionId === inst.id)
                    .map((acc) => (
                      <div key={acc.id} className="account-item">
                        <div className="account-info">
                          <span className="account-name">
                            {acc.nickname || acc.name}
                            {acc.isPrimary && <span className="primary-badge">Primary</span>}
                          </span>
                          <span className="account-type">
                            {acc.type} {acc.mask && `••${acc.mask}`}
                          </span>
                        </div>
                        <div className="account-balance">
                          <span className="current">{formatCurrency(acc.currentBalance, acc.currency)}</span>
                          {acc.availableBalance !== undefined && acc.availableBalance !== acc.currentBalance && (
                            <span className="available">
                              Available: {formatCurrency(acc.availableBalance, acc.currency)}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Payments Tab */}
        {activeTab === 'payments' && (
          <div className="payments-tab">
            {/* New Payment Form */}
            <div className="payment-form-card">
              <h3>Send Money</h3>
              <form onSubmit={makePayment}>
                <div className="form-row">
                  <label>
                    Recipient Name
                    <input
                      type="text"
                      value={paymentForm.recipientName}
                      onChange={(e) => setPaymentForm({ ...paymentForm, recipientName: e.target.value })}
                      placeholder="John Smith"
                      required
                    />
                  </label>
                </div>
                <div className="form-row two-col">
                  <label>
                    Sort Code
                    <input
                      type="text"
                      value={paymentForm.sortCode}
                      onChange={(e) => setPaymentForm({ ...paymentForm, sortCode: e.target.value })}
                      placeholder="12-34-56"
                      pattern="[0-9]{2}-?[0-9]{2}-?[0-9]{2}"
                      required
                    />
                  </label>
                  <label>
                    Account Number
                    <input
                      type="text"
                      value={paymentForm.accountNumber}
                      onChange={(e) => setPaymentForm({ ...paymentForm, accountNumber: e.target.value })}
                      placeholder="12345678"
                      pattern="[0-9]{8}"
                      required
                    />
                  </label>
                </div>
                <div className="form-row two-col">
                  <label>
                    Amount (GBP)
                    <input
                      type="number"
                      value={paymentForm.amount}
                      onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })}
                      placeholder="0.00"
                      min="0.01"
                      step="0.01"
                      required
                    />
                  </label>
                  <label>
                    Reference
                    <input
                      type="text"
                      value={paymentForm.reference}
                      onChange={(e) => setPaymentForm({ ...paymentForm, reference: e.target.value })}
                      placeholder="Payment reference"
                      maxLength={18}
                    />
                  </label>
                </div>
                {paymentError && <div className="form-error">{paymentError}</div>}
                {paymentSuccess && <div className="form-success">{paymentSuccess}</div>}
                <button type="submit" className="send-payment-btn">
                  Send Payment
                </button>
              </form>
            </div>

            {/* Pending Payments */}
            {pendingPayments.length > 0 && (
              <div className="pending-payments">
                <h3>Pending Payments</h3>
                {pendingPayments.map((payment) => (
                  <div key={payment.id} className="payment-item pending">
                    <div className="payment-info">
                      <span className="payment-recipient">{payment.recipient.name}</span>
                      <span className="payment-desc">{payment.description}</span>
                    </div>
                    <div className="payment-details">
                      <span className="payment-amount">
                        {formatCurrency(payment.amount, payment.currency)}
                      </span>
                      <span className="payment-status">{payment.status}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Settings Tab */}
        {activeTab === 'settings' && (
          <div className="settings-tab">
            {/* PIN Setup */}
            <div className="settings-section">
              <h3>Security PIN</h3>
              <p>Set a PIN to authorize payments</p>
              {hasPin ? (
                <div className="pin-status">
                  <span className="pin-set">PIN is set</span>
                  <button onClick={() => setShowPinSetup(true)}>Change PIN</button>
                </div>
              ) : (
                <button onClick={() => setShowPinSetup(true)} className="setup-pin-btn">
                  Set Up PIN
                </button>
              )}

              {showPinSetup && (
                <div className="pin-setup-form">
                  <label>
                    Enter PIN (4-8 digits)
                    <input
                      type="password"
                      value={pin}
                      onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
                      placeholder="Enter PIN"
                      pattern="[0-9]{4,8}"
                    />
                  </label>
                  <label>
                    Confirm PIN
                    <input
                      type="password"
                      value={confirmPin}
                      onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
                      placeholder="Confirm PIN"
                      pattern="[0-9]{4,8}"
                    />
                  </label>
                  <div className="pin-actions">
                    <button onClick={setupPin}>Save PIN</button>
                    <button onClick={() => setShowPinSetup(false)} className="cancel">
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Spending Limits */}
            <div className="settings-section">
              <h3>Spending Limits</h3>
              <p>Configure your spending limits for added security</p>
              {spendingLimits && (
                <div className="limits-config">
                  <div className="limit-config-item">
                    <label>Daily Limit</label>
                    <span>{formatCurrency(spendingLimits.daily.limit)}</span>
                  </div>
                  <div className="limit-config-item">
                    <label>Weekly Limit</label>
                    <span>{formatCurrency(spendingLimits.weekly.limit)}</span>
                  </div>
                  <div className="limit-config-item">
                    <label>Monthly Limit</label>
                    <span>{formatCurrency(spendingLimits.monthly.limit)}</span>
                  </div>
                </div>
              )}
            </div>

            {/* About */}
            <div className="settings-section">
              <h3>About</h3>
              <p>
                Atlas Banking uses secure Open Banking connections via TrueLayer to connect to UK
                banks. Your credentials are never stored - all authentication happens directly with
                your bank.
              </p>
              <p className="security-note">
                Your data is encrypted and stored securely on your device.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// Icons
const RefreshIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
    <path d="M17.65 6.35A7.958 7.958 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" />
  </svg>
);

const CloseIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
  </svg>
);

const BankIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" width="48" height="48" fill="currentColor" className={className}>
    <path d="M4 10h3v7H4zm6.5 0h3v7h-3zM2 19h20v3H2zm15-9h3v7h-3zm-5-9L2 6v2h20V6z" />
  </svg>
);

export default BankingPanel;
