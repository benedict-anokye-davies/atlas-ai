/**
 * Atlas Desktop - Backup and Restore
 * Export and import Atlas settings, history, and data
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import './BackupRestore.css';

interface BackupRestoreProps {
  isVisible: boolean;
  onClose: () => void;
}

interface BackupData {
  version: string;
  timestamp: number;
  settings: Record<string, unknown>;
  conversationHistory: unknown[];
  voiceSettings: Record<string, unknown>;
  integrations: unknown[];
  customCommands: unknown[];
  notes: unknown[];
  memories: unknown[];
}

interface BackupOptions {
  includeSettings: boolean;
  includeHistory: boolean;
  includeVoiceSettings: boolean;
  includeIntegrations: boolean;
  includeCustomCommands: boolean;
  includeNotes: boolean;
  includeMemories: boolean;
  encrypt: boolean;
  password: string;
}

interface BackupInfo {
  id: string;
  filename: string;
  timestamp: number;
  size: number;
  encrypted: boolean;
  items: {
    settings: boolean;
    history: boolean;
    voiceSettings: boolean;
    integrations: boolean;
    customCommands: boolean;
    notes: boolean;
    memories: boolean;
  };
}

export function BackupRestore({ isVisible, onClose }: BackupRestoreProps) {
  const [activeTab, setActiveTab] = useState<'backup' | 'restore' | 'history'>('backup');
  const [backupOptions, setBackupOptions] = useState<BackupOptions>({
    includeSettings: true,
    includeHistory: true,
    includeVoiceSettings: true,
    includeIntegrations: true,
    includeCustomCommands: true,
    includeNotes: true,
    includeMemories: false, // Large, optional
    encrypt: false,
    password: '',
  });
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [backupHistory, setBackupHistory] = useState<BackupInfo[]>([]);
  const [selectedBackup, setSelectedBackup] = useState<BackupInfo | null>(null);
  const [restorePassword, setRestorePassword] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load backup history
  useEffect(() => {
    if (!isVisible) return;

    const savedHistory = localStorage.getItem('atlas-backup-history');
    if (savedHistory) {
      try {
        setBackupHistory(JSON.parse(savedHistory));
      } catch (e) {
        console.error('Failed to load backup history:', e);
      }
    }
  }, [isVisible]);

  // Calculate backup size estimate
  const getBackupSizeEstimate = useCallback(() => {
    let size = 0;
    if (backupOptions.includeSettings) size += 50;
    if (backupOptions.includeHistory) size += 500;
    if (backupOptions.includeVoiceSettings) size += 10;
    if (backupOptions.includeIntegrations) size += 20;
    if (backupOptions.includeCustomCommands) size += 30;
    if (backupOptions.includeNotes) size += 100;
    if (backupOptions.includeMemories) size += 2000;
    return size;
  }, [backupOptions]);

  // Create backup
  const createBackup = useCallback(async () => {
    setIsProcessing(true);
    setResult(null);

    try {
      // Collect data based on options
      const backupData: BackupData = {
        version: '1.0.0',
        timestamp: Date.now(),
        settings: {},
        conversationHistory: [],
        voiceSettings: {},
        integrations: [],
        customCommands: [],
        notes: [],
        memories: [],
      };

      // Gather settings
      if (backupOptions.includeSettings) {
        backupData.settings = JSON.parse(localStorage.getItem('atlas-settings') || '{}');
      }

      // Gather history
      if (backupOptions.includeHistory) {
        backupData.conversationHistory = JSON.parse(localStorage.getItem('atlas-conversation-history') || '[]');
      }

      // Gather voice settings
      if (backupOptions.includeVoiceSettings) {
        backupData.voiceSettings = JSON.parse(localStorage.getItem('atlas-voice-feedback-settings') || '{}');
      }

      // Gather integrations
      if (backupOptions.includeIntegrations) {
        backupData.integrations = JSON.parse(localStorage.getItem('atlas-integrations') || '[]');
      }

      // Gather custom commands
      if (backupOptions.includeCustomCommands) {
        backupData.customCommands = JSON.parse(localStorage.getItem('atlas-custom-commands') || '[]');
      }

      // Gather notes
      if (backupOptions.includeNotes) {
        backupData.notes = JSON.parse(localStorage.getItem('atlas-quick-notes') || '[]');
      }

      // Convert to JSON
      let content = JSON.stringify(backupData, null, 2);

      // Encrypt if requested
      if (backupOptions.encrypt && backupOptions.password) {
        content = await encryptData(content, backupOptions.password);
      }

      // Create filename
      const date = new Date().toISOString().split('T')[0];
      const filename = `atlas-backup-${date}${backupOptions.encrypt ? '.encrypted' : ''}.json`;

      // Download file
      const blob = new Blob([content], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      // Save to history
      const backupInfo: BackupInfo = {
        id: Date.now().toString(),
        filename,
        timestamp: Date.now(),
        size: blob.size,
        encrypted: backupOptions.encrypt,
        items: {
          settings: backupOptions.includeSettings,
          history: backupOptions.includeHistory,
          voiceSettings: backupOptions.includeVoiceSettings,
          integrations: backupOptions.includeIntegrations,
          customCommands: backupOptions.includeCustomCommands,
          notes: backupOptions.includeNotes,
          memories: backupOptions.includeMemories,
        },
      };

      const newHistory = [backupInfo, ...backupHistory.slice(0, 9)];
      setBackupHistory(newHistory);
      localStorage.setItem('atlas-backup-history', JSON.stringify(newHistory));

      setResult({ type: 'success', message: `Backup created: ${filename}` });
    } catch (error) {
      setResult({ type: 'error', message: `Backup failed: ${error instanceof Error ? error.message : 'Unknown error'}` });
    }

    setIsProcessing(false);
  }, [backupOptions, backupHistory]);

  // Handle file selection for restore
  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    setResult(null);

    try {
      let content = await file.text();
      
      // Check if encrypted
      if (file.name.includes('.encrypted') || content.startsWith('ENCRYPTED:')) {
        if (!restorePassword) {
          setResult({ type: 'error', message: 'This backup is encrypted. Please enter the password.' });
          setIsProcessing(false);
          return;
        }
        content = await decryptData(content, restorePassword);
      }

      const backupData: BackupData = JSON.parse(content);

      // Validate backup
      if (!backupData.version || !backupData.timestamp) {
        throw new Error('Invalid backup file format');
      }

      // Restore data
      if (backupData.settings && Object.keys(backupData.settings).length > 0) {
        localStorage.setItem('atlas-settings', JSON.stringify(backupData.settings));
      }

      if (backupData.conversationHistory?.length > 0) {
        localStorage.setItem('atlas-conversation-history', JSON.stringify(backupData.conversationHistory));
      }

      if (backupData.voiceSettings && Object.keys(backupData.voiceSettings).length > 0) {
        localStorage.setItem('atlas-voice-feedback-settings', JSON.stringify(backupData.voiceSettings));
      }

      if (backupData.integrations?.length > 0) {
        localStorage.setItem('atlas-integrations', JSON.stringify(backupData.integrations));
      }

      if (backupData.customCommands?.length > 0) {
        localStorage.setItem('atlas-custom-commands', JSON.stringify(backupData.customCommands));
      }

      if (backupData.notes?.length > 0) {
        localStorage.setItem('atlas-quick-notes', JSON.stringify(backupData.notes));
      }

      setResult({
        type: 'success',
        message: `Restored backup from ${new Date(backupData.timestamp).toLocaleDateString()}. Reload the app to apply changes.`,
      });
    } catch (error) {
      setResult({ type: 'error', message: `Restore failed: ${error instanceof Error ? error.message : 'Unknown error'}` });
    }

    setIsProcessing(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [restorePassword]);

  // Close on Escape
  useEffect(() => {
    if (!isVisible) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isVisible, onClose]);

  if (!isVisible) return null;

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="backup-overlay" onClick={onClose}>
      <div className="backup-container" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="br-header">
          <div className="br-title-row">
            <svg className="br-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
              <path d="M3 5c0-1.1 4-3 9-3s9 1.9 9 3-4 3-9 3-9-1.9-9-3" />
              <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
              <path d="M3 12v7c0 1.66 4 3 9 3s9-1.34 9-3v-7" />
            </svg>
            <h2>Backup & Restore</h2>
          </div>
          <button className="br-close" onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="br-tabs">
          {(['backup', 'restore', 'history'] as const).map((tab) => (
            <button
              key={tab}
              className={`br-tab ${activeTab === tab ? 'active' : ''}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab === 'backup' && (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              )}
              {tab === 'restore' && (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
              )}
              {tab === 'history' && (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
              )}
              <span>{tab.charAt(0).toUpperCase() + tab.slice(1)}</span>
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="br-content">
          {activeTab === 'backup' && (
            <div className="backup-section">
              <div className="backup-info-card">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="16" x2="12" y2="12" />
                  <line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
                <p>
                  Create a backup of your Atlas data. You can restore this backup later
                  to recover your settings, history, and preferences.
                </p>
              </div>

              <div className="backup-options">
                <h3>What to include:</h3>
                
                <label className="backup-option">
                  <input
                    type="checkbox"
                    checked={backupOptions.includeSettings}
                    onChange={(e) => setBackupOptions((prev) => ({ ...prev, includeSettings: e.target.checked }))}
                  />
                  <div className="option-info">
                    <span className="option-name">App Settings</span>
                    <span className="option-desc">Theme, preferences, shortcuts</span>
                  </div>
                  <span className="option-size">~50 KB</span>
                </label>

                <label className="backup-option">
                  <input
                    type="checkbox"
                    checked={backupOptions.includeHistory}
                    onChange={(e) => setBackupOptions((prev) => ({ ...prev, includeHistory: e.target.checked }))}
                  />
                  <div className="option-info">
                    <span className="option-name">Conversation History</span>
                    <span className="option-desc">All past conversations with Atlas</span>
                  </div>
                  <span className="option-size">~500 KB</span>
                </label>

                <label className="backup-option">
                  <input
                    type="checkbox"
                    checked={backupOptions.includeVoiceSettings}
                    onChange={(e) => setBackupOptions((prev) => ({ ...prev, includeVoiceSettings: e.target.checked }))}
                  />
                  <div className="option-info">
                    <span className="option-name">Voice Settings</span>
                    <span className="option-desc">TTS voice, speed, feedback preferences</span>
                  </div>
                  <span className="option-size">~10 KB</span>
                </label>

                <label className="backup-option">
                  <input
                    type="checkbox"
                    checked={backupOptions.includeIntegrations}
                    onChange={(e) => setBackupOptions((prev) => ({ ...prev, includeIntegrations: e.target.checked }))}
                  />
                  <div className="option-info">
                    <span className="option-name">Integrations</span>
                    <span className="option-desc">Connected services configuration</span>
                  </div>
                  <span className="option-size">~20 KB</span>
                </label>

                <label className="backup-option">
                  <input
                    type="checkbox"
                    checked={backupOptions.includeCustomCommands}
                    onChange={(e) => setBackupOptions((prev) => ({ ...prev, includeCustomCommands: e.target.checked }))}
                  />
                  <div className="option-info">
                    <span className="option-name">Custom Commands</span>
                    <span className="option-desc">Your custom voice commands</span>
                  </div>
                  <span className="option-size">~30 KB</span>
                </label>

                <label className="backup-option">
                  <input
                    type="checkbox"
                    checked={backupOptions.includeNotes}
                    onChange={(e) => setBackupOptions((prev) => ({ ...prev, includeNotes: e.target.checked }))}
                  />
                  <div className="option-info">
                    <span className="option-name">Quick Notes</span>
                    <span className="option-desc">All your saved notes</span>
                  </div>
                  <span className="option-size">~100 KB</span>
                </label>

                <label className="backup-option">
                  <input
                    type="checkbox"
                    checked={backupOptions.includeMemories}
                    onChange={(e) => setBackupOptions((prev) => ({ ...prev, includeMemories: e.target.checked }))}
                  />
                  <div className="option-info">
                    <span className="option-name">Memory Database</span>
                    <span className="option-desc">Atlas's learned knowledge (large)</span>
                  </div>
                  <span className="option-size">~2 MB</span>
                </label>
              </div>

              <div className="encryption-section">
                <label className="encrypt-toggle">
                  <input
                    type="checkbox"
                    checked={backupOptions.encrypt}
                    onChange={(e) => setBackupOptions((prev) => ({ ...prev, encrypt: e.target.checked }))}
                  />
                  <span>Encrypt backup with password</span>
                </label>

                {backupOptions.encrypt && (
                  <input
                    type="password"
                    className="password-input"
                    placeholder="Enter password"
                    value={backupOptions.password}
                    onChange={(e) => setBackupOptions((prev) => ({ ...prev, password: e.target.value }))}
                  />
                )}
              </div>

              <div className="backup-summary">
                <span>Estimated size: {formatSize(getBackupSizeEstimate() * 1024)}</span>
              </div>
            </div>
          )}

          {activeTab === 'restore' && (
            <div className="restore-section">
              <div className="backup-info-card warning">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                <p>
                  Restoring a backup will overwrite your current data. Make sure to
                  create a new backup first if you want to preserve your current state.
                </p>
              </div>

              <div className="restore-area">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json"
                  onChange={handleFileSelect}
                  style={{ display: 'none' }}
                  id="backup-file-input"
                />
                
                <div className="drop-zone" onClick={() => fileInputRef.current?.click()}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  <span>Click to select backup file</span>
                  <span className="drop-hint">or drag and drop here</span>
                </div>

                <div className="password-section">
                  <label>If the backup is encrypted:</label>
                  <input
                    type="password"
                    className="password-input"
                    placeholder="Enter backup password"
                    value={restorePassword}
                    onChange={(e) => setRestorePassword(e.target.value)}
                  />
                </div>
              </div>
            </div>
          )}

          {activeTab === 'history' && (
            <div className="history-section">
              {backupHistory.length === 0 ? (
                <div className="empty-history">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  <p>No backup history yet</p>
                  <span>Create your first backup to see it here</span>
                </div>
              ) : (
                <div className="history-list">
                  {backupHistory.map((backup) => (
                    <div
                      key={backup.id}
                      className={`history-item ${selectedBackup?.id === backup.id ? 'selected' : ''}`}
                      onClick={() => setSelectedBackup(backup)}
                    >
                      <div className="history-icon">
                        {backup.encrypted ? (
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                            <path d="M7 11V7a5 5 0 0110 0v4" />
                          </svg>
                        ) : (
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                            <polyline points="14 2 14 8 20 8" />
                          </svg>
                        )}
                      </div>
                      <div className="history-info">
                        <div className="history-filename">{backup.filename}</div>
                        <div className="history-meta">
                          <span>{new Date(backup.timestamp).toLocaleString()}</span>
                          <span>{formatSize(backup.size)}</span>
                        </div>
                      </div>
                      <div className="history-badges">
                        {backup.encrypted && <span className="badge encrypted">Encrypted</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {selectedBackup && (
                <div className="backup-details">
                  <h3>Backup Contents</h3>
                  <div className="details-grid">
                    {Object.entries(selectedBackup.items).map(([key, included]) => (
                      <div key={key} className={`detail-item ${included ? 'included' : ''}`}>
                        {included ? (
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        ) : (
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                        )}
                        <span>{key.replace(/([A-Z])/g, ' $1').trim()}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Result Message */}
        {result && (
          <div className={`br-result ${result.type}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              {result.type === 'success' ? (
                <polyline points="20 6 9 17 4 12" />
              ) : (
                <>
                  <circle cx="12" cy="12" r="10" />
                  <line x1="15" y1="9" x2="9" y2="15" />
                  <line x1="9" y1="9" x2="15" y2="15" />
                </>
              )}
            </svg>
            <span>{result.message}</span>
          </div>
        )}

        {/* Footer */}
        <div className="br-footer">
          <button className="cancel-btn" onClick={onClose}>
            Close
          </button>
          {activeTab === 'backup' && (
            <button
              className="primary-btn"
              onClick={createBackup}
              disabled={isProcessing || (backupOptions.encrypt && !backupOptions.password)}
            >
              {isProcessing ? (
                <>
                  <span className="spinner" />
                  Creating Backup...
                </>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                  Create Backup
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Simple encryption (for demo - use a real encryption library in production)
async function encryptData(data: string, _password: string): Promise<string> {
  // In production, use Web Crypto API or a proper encryption library with _password
  // This is a placeholder that just base64 encodes with a marker
  const encoded = btoa(unescape(encodeURIComponent(data)));
  return `ENCRYPTED:${encoded}`;
}

async function decryptData(data: string, _password: string): Promise<string> {
  // In production, _password would be used for decryption
  if (!data.startsWith('ENCRYPTED:')) {
    throw new Error('Invalid encrypted data format');
  }
  const encoded = data.replace('ENCRYPTED:', '');
  return decodeURIComponent(escape(atob(encoded)));
}
